// ac#1571 AC5 原生层 —— 在**隔离的临时钥匙串**里真跑改名函数:目标已存在 ⇒ -25299 且源条目属性不变;
// 删掉目标后改名成功、反向改名成功。
//
// **默认不跑**:只有 `CODEPUPPY_KEYCHAIN_ISOLATED=1` 且 darwin 时才执行,否则打印 SKIP 原因。它会在临时钥匙串里
// 建条目、改名、删除,所以必须由人显式打开(PR 上手动跑一次,结果贴 PR);门里永远是 SKIP。
//
// 隔离照搬第 0b 步实测过的做法(32 次运行零弹框),且每一道先自证、不成立就中止,不往下跑任何钥匙串操作:
//   ① 每条命令都跑在 sandbox-exec 里:禁读写真实 `~/Library/Keychains`、禁写真实 `com.apple.security.plist`、
//      禁连 authd / SecurityAgent(0b 事故的弹框路径:找不到钥匙串 → authd → SecurityAgent)。
//      自证:同一条 `ls ~/Library/Keychains` 不进沙箱能成功、进沙箱必须失败。
//   ② HOME 与 CFFIXED_USER_HOME 改道到临时目录,临时钥匙串是改道域里**唯一**的搜索项与默认钥匙串。
//      自证:回读搜索列表与默认钥匙串,不恰为这只临时钥匙串 ⇒ 中止(0b 事故正是这一步没生效还接着跑)。
//   ③ 预置条目用 `add-generic-password -A`(任何应用不经确认即可访问):存在性查询与改名结构上不可能请求授权。
//      0b 用的是「关交互」开关;生产模块刻意不导出那个开关,所以这里改用 -A 把授权需求本身去掉。
//   收尾:删临时钥匙串;真实用户域的搜索列表与默认钥匙串前后逐字相同(只读配置,不读任何条目)。
// 秘密只是测试自己写进临时钥匙串的占位串,任何一步都不取回它(`find-generic-password` 不带 -g / -w)。

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir, userInfo } from "node:os"
import { join } from "node:path"
import { buildFenceAddon } from "../../scripts/build-fence-addon"

const ENABLED = process.env.CODEPUPPY_KEYCHAIN_ISOLATED === "1" && process.platform === "darwin"
if (!ENABLED)
  console.warn(
    `[SKIP] keychain-rename-isolated:只在 CODEPUPPY_KEYCHAIN_ISOLATED=1 且 darwin 时运行(当前 flag=${process.env.CODEPUPPY_KEYCHAIN_ISOLATED ?? "未设"}, platform=${process.platform})—— 它在临时钥匙串里真改条目,默认不碰任何钥匙串`,
  )

// 第 0 步实测的迁移源 / 目标对(prod)。名字本身对本测试不承重,用真实的一对只是为了贴近生产。
const FROM = { service: "alpha-code Safe Storage", account: "alpha-code Key" }
const TO = { service: "Code Puppy Safe Storage", account: "Code Puppy Key" }
const ERR_SEC_ITEM_NOT_FOUND = -25300
const ERR_SEC_DUPLICATE_ITEM = -25299
const PLACEHOLDER_PASSWORD = "isolated-keychain-test-only"

type Item = { service: string; account: string }
type Op = { op: "status"; item: Item } | { op: "rename"; from: Item; to: Item }

describe.skipIf(!ENABLED)("AC5 原生层:隔离临时钥匙串里的改名 (ac#1571)", () => {
  test(
    "目标已存在 ⇒ -25299 且源条目属性不变;删目标后改名成功、反向改名成功",
    () => {
      const realHome = userInfo().homedir
      const realKeychains = join(realHome, "Library", "Keychains")
      const root = mkdtempSync(join(tmpdir(), "codepuppy-keychain-isolated-"))
      const home = join(root, "home")
      mkdirSync(join(home, "Library", "Keychains"), { recursive: true })
      mkdirSync(join(home, "Library", "Preferences"), { recursive: true })
      const keychain = join(home, "Library", "Keychains", "isolated.keychain-db")
      const guard = join(root, "guard.sb")
      writeFileSync(
        guard,
        [
          "(version 1)",
          "(allow default)",
          '(deny mach-lookup (global-name "com.apple.authd") (global-name "com.apple.security.agent") (global-name "com.apple.security.agent.login"))',
          `(deny file-read* file-write* (subpath ${JSON.stringify(realKeychains)}))`,
          `(deny file-write* (literal ${JSON.stringify(join(realHome, "Library", "Preferences", "com.apple.security.plist"))}))`,
        ].join("\n"),
      )
      const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", TMPDIR: tmpdir(), HOME: home, CFFIXED_USER_HOME: home }
      const sandboxed = (cmd: string[]) => spawnSync("sandbox-exec", ["-f", guard, ...cmd], { env, encoding: "utf8" })
      const must = (cmd: string[]) => {
        const result = sandboxed(cmd)
        if (result.status !== 0) throw new Error(`中止:${cmd.slice(0, 2).join(" ")} 失败(exit ${result.status}):${result.stderr}`)
        return result.stdout
      }
      const realDomainBefore = realUserDomain()
      let keychainCreated = false
      try {
        // ① 沙箱自证:手段能成功,进沙箱后必须被拦
        expect(spawnSync("/bin/ls", [realKeychains]).status, "不进沙箱时 ls 真实钥匙串目录应成功(否则这条自证测不出东西)").toBe(0)
        expect(sandboxed(["/bin/ls", realKeychains]).status, "进沙箱后 ls 真实钥匙串目录必须失败").not.toBe(0)

        // ② 临时钥匙串:改道域里唯一的搜索项 + 默认钥匙串,不自动锁定、已解锁
        must(["security", "create-keychain", "-p", PLACEHOLDER_PASSWORD, keychain])
        keychainCreated = true
        must(["security", "list-keychains", "-d", "user", "-s", keychain])
        must(["security", "default-keychain", "-d", "user", "-s", keychain])
        must(["security", "set-keychain-settings", keychain])
        must(["security", "unlock-keychain", "-p", PLACEHOLDER_PASSWORD, keychain])
        const accepted = new Set([keychain, realpathSync(keychain)])
        const search = keychainPaths(must(["security", "list-keychains", "-d", "user"]))
        const fallback = keychainPaths(must(["security", "default-keychain", "-d", "user"]))
        if (search.length !== 1 || !accepted.has(search[0]!) || fallback.length !== 1 || !accepted.has(fallback[0]!))
          throw new Error(`中止:改道域没有指向临时钥匙串(search=${search.join(",")} default=${fallback.join(",")})—— 不做任何钥匙串操作`)

        // ③ 预置源与目标(-A:无授权需求)
        for (const item of [FROM, TO])
          must(["security", "add-generic-password", "-A", "-s", item.service, "-a", item.account, "-w", PLACEHOLDER_PASSWORD, keychain])
        const attributes = (item: Item) => must(["security", "find-generic-password", "-s", item.service, "-a", item.account, keychain])

        const addon = buildFenceAddon({ out: join(root, "codepuppy_fence.node"), buildId: `ac1571-isolated-${Date.now()}` }).out
        const child = join(root, "child.mjs")
        writeFileSync(
          child,
          [
            "const [addonPath, opsJson] = process.argv.slice(2)",
            "const addon = { exports: {} }",
            "process.dlopen(addon, addonPath)",
            "const ops = JSON.parse(opsJson)",
            'console.log(JSON.stringify(ops.map((op) => op.op === "status" ? addon.exports.keychainItemStatus(op.item.service, op.item.account) : addon.exports.keychainRenameItem(op.from.service, op.from.account, op.to.service, op.to.account))))',
          ].join("\n"),
        )
        const run = (ops: Op[]) => JSON.parse(must([process.execPath, child, addon, JSON.stringify(ops)]).trim()) as number[]

        // 目标已存在:改名被拒,两条都在,源条目属性(含 mdat)逐字不变
        const before = attributes(FROM)
        expect(
          run([
            { op: "rename", from: FROM, to: TO },
            { op: "status", item: FROM },
            { op: "status", item: TO },
          ]),
        ).toEqual([ERR_SEC_DUPLICATE_ITEM, 0, 0])
        expect(attributes(FROM)).toBe(before)

        // 删掉目标后:改名成功,再反向改回成功
        must(["security", "delete-generic-password", "-s", TO.service, "-a", TO.account, keychain])
        expect(
          run([
            { op: "rename", from: FROM, to: TO },
            { op: "status", item: FROM },
            { op: "status", item: TO },
            { op: "rename", from: TO, to: FROM },
            { op: "status", item: FROM },
            { op: "status", item: TO },
          ]),
        ).toEqual([0, ERR_SEC_ITEM_NOT_FOUND, 0, 0, 0, ERR_SEC_ITEM_NOT_FOUND])
      } finally {
        if (keychainCreated) sandboxed(["security", "delete-keychain", keychain])
        rmSync(root, { recursive: true, force: true })
      }
      expect(realUserDomain(), "真实用户域的搜索列表与默认钥匙串必须前后逐字相同").toEqual(realDomainBefore)
    },
    120_000,
  )
})

function keychainPaths(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter(Boolean)
}

/** 只读真实用户域的钥匙串**配置**(搜索列表与默认钥匙串路径),不读任何条目。 */
function realUserDomain(): { search: string; fallback: string } {
  const read = (args: string[]) => spawnSync("security", args, { encoding: "utf8" }).stdout
  return { search: read(["list-keychains", "-d", "user"]), fallback: read(["default-keychain", "-d", "user"]) }
}
