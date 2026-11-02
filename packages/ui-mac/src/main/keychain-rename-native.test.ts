// ac#1571 AC4 —— 钥匙串改名原生函数只改 `svce` / `acct`,不请求秘密、不提交秘密。
//
// 两条互相独立的证据(派发书:本阶段不碰任何钥匙串,AC4 只用「读源码 + 编到临时目录 dlopen 取键名」):
//   ① 读 keychain_rename.c(构建脚本实际编译的那一份):方案 §6 的禁用标识符零命中;`SecItemUpdate`
//      在代码里(去掉注释后)恰好调用一次,第一参来自 build_query(、第二参来自 build_update_attributes(。
//   ② 用生产构建脚本把模块编到临时目录,在本进程 dlopen,调 keychainUpdateAttributeKeys() —— 它用占位值
//      调**同一个** build_update_attributes,返回更新字典的真实键名,必须恰为 acct / svce;再用 `nm -u`
//      看两片二进制实际引用的 Security 函数恰为 SecItemCopyMatching / SecItemUpdate。这一步不碰钥匙串。
// 每条判据先过已知坏的样本(同文件的自检用例),不会红的判据不算证据。
// 非 darwin 或没有 clang 时 ② 响亮跳过(打印原因),① 照跑。

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FENCE_ADDON_ARCHS, FENCE_ADDON_KEYCHAIN_SOURCE, buildFenceAddon } from "../../scripts/build-fence-addon"

const SOURCE = readFileSync(FENCE_ADDON_KEYCHAIN_SOURCE, "utf8")

/** 方案 §6 的禁用清单:要求返回秘密 / 提交秘密 / 增删条目 / 旧式读秘密的 API。 */
const FORBIDDEN = [
  "kSecReturnData",
  "kSecValueData",
  "kSecReturnRef",
  "kSecReturnPersistentRef",
  "SecItemAdd",
  "SecItemDelete",
  "SecKeychainFindGenericPassword",
  "SecKeychainItemCopyContent",
  "SecKeychainItemCopyAttributesAndData",
]

const canBuild = process.platform === "darwin" && Boolean(Bun.which("clang")) && Boolean(Bun.which("nm"))
if (!canBuild)
  console.warn(
    `[SKIP] keychain-rename-native ②:需要 darwin + clang + nm(当前 platform=${process.platform}, clang=${Boolean(Bun.which("clang"))})—— 只跑源码判据 ①`,
  )

describe("AC4 ① 源码:只改属性,不碰秘密 (ac#1571)", () => {
  test("禁用标识符零命中", () => {
    expect(forbiddenHits(SOURCE)).toEqual([])
  })

  test("SecItemUpdate 恰好调用一次:第一参来自 build_query(,第二参来自 build_update_attributes(", () => {
    expect(updateCallViolations(SOURCE)).toEqual([])
  })

  test("自检:判据对已知坏的源码会红", () => {
    expect(forbiddenHits(`${SOURCE}\nCFDictionarySetValue(query, kSecReturnData, kCFBooleanTrue);`)).toEqual(["kSecReturnData"])
    expect(forbiddenHits(`${SOURCE}\nSecItemDelete(query);`)).toEqual(["SecItemDelete"])
    const secondUpdate = `${SOURCE}\nstatic void again(CFDictionaryRef q, CFDictionaryRef a) { SecItemUpdate(q, a); }`
    expect(updateCallViolations(secondUpdate).join("\n")).toContain("恰好一次")
    const wrongDictionary = SOURCE.replace("SecItemUpdate(query, attributes)", "SecItemUpdate(query, query)")
    expect(wrongDictionary).not.toBe(SOURCE)
    expect(updateCallViolations(wrongDictionary).join("\n")).toContain("build_update_attributes(")
    // 注释里提到的不算调用:去掉注释后再数
    expect(updateCallViolations(`${SOURCE}\n// SecItemUpdate(a, b) in prose\n/* SecItemUpdate(c, d) */`)).toEqual([])
  })
})

describe.skipIf(!canBuild)("AC4 ② 编出来的模块:更新字典只有 acct / svce (ac#1571)", () => {
  test(
    "生产构建脚本编到临时目录 → dlopen → keychainUpdateAttributeKeys() 恰为 [acct, svce];两片只引用 SecItemCopyMatching / SecItemUpdate",
    () => {
      const scratch = mkdtempSync(join(tmpdir(), "codepuppy-keychain-rename-"))
      try {
        const built = buildFenceAddon({ out: join(scratch, "codepuppy_fence.node"), buildId: `ac1571-${Date.now()}` })
        const addon: { exports: { keychainUpdateAttributeKeys?: () => string[] } } = { exports: {} }
        process.dlopen(addon, built.out)
        expect(typeof addon.exports.keychainUpdateAttributeKeys).toBe("function")
        expect(addon.exports.keychainUpdateAttributeKeys!().sort()).toEqual(["acct", "svce"])
        for (const arch of FENCE_ADDON_ARCHS) {
          const nm = spawnSync("nm", ["-u", "-arch", arch, built.out], { encoding: "utf8" })
          expect(nm.status).toBe(0)
          const security = nm.stdout
            .split("\n")
            .map((line) => line.trim())
            .filter((symbol) => symbol.startsWith("_Sec"))
            .sort()
          expect(security, `${arch} 片引用的 Security 函数`).toEqual(["_SecItemCopyMatching", "_SecItemUpdate"])
        }
      } finally {
        rmSync(scratch, { recursive: true, force: true })
      }
    },
    60_000,
  )
})

function forbiddenHits(source: string): string[] {
  return FORBIDDEN.filter((name) => new RegExp(`\\b${name}\\b`).test(source))
}

function updateCallViolations(source: string): string[] {
  const code = stripComments(source)
  const calls = [...code.matchAll(/\bSecItemUpdate\s*\(\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]\w*)\s*\)/g)]
  const mentions = code.match(/\bSecItemUpdate\b/g)?.length ?? 0
  if (calls.length !== 1 || mentions !== 1) return [`SecItemUpdate 应在代码里恰好一次、两参都是变量;实际调用 ${calls.length} 处、出现 ${mentions} 次`]
  const query = calls[0]![1]!
  const attributes = calls[0]![2]!
  return [
    ...(new RegExp(`\\b${query}\\s*=\\s*build_query\\(`).test(code) ? [] : [`第一参 ${query} 不是由 build_query( 构造的`]),
    ...(new RegExp(`\\b${attributes}\\s*=\\s*build_update_attributes\\(`).test(code)
      ? []
      : [`第二参 ${attributes} 不是由 build_update_attributes( 构造的`]),
  ]
}

/** 去掉 C 注释(保留字符串字面量;本文件没有含 `//` 的字符串,但别靠这个碰巧)。 */
function stripComments(source: string): string {
  return source.replace(/"(?:\\.|[^"\\\n])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match) => (match.startsWith('"') ? match : " "))
}
