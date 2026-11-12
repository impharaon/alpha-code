// B6(=G1):ext 装载路径解析单测。契约:packaged 走 resourcesPath/codepuppy-ext,dev 走仓内 dist;
// 逃生开关短路;缺文件必须给出 reason(调用方 loud warn,不许静默丢工具)。
// `#1667`:OpenCode 2 只装目录形式的本地插件 ⇒ 返回的是**目录**,在场判据是目录里的入口 `server.js`(接口文档 I2 改形)。

import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { resolveExtPluginPath } from "./codepuppy-ext-plugin"

const base = {
  resourcesPath: "/App.app/Contents/Resources",
  moduleDir: "/repo/packages/ui-mac/out/main",
  disabled: false,
}

describe("resolveExtPluginPath", () => {
  test("packaged → <resources>/codepuppy-ext(目录),在场判据是目录里的 server.js", () => {
    const probed: string[] = []
    const r = resolveExtPluginPath({ ...base, packaged: true, exists: (p) => (probed.push(p), true) })
    expect(r.path).toBe(join("/App.app/Contents/Resources", "codepuppy-ext"))
    expect(probed).toEqual([join("/App.app/Contents/Resources", "codepuppy-ext", "server.js")])
  })

  test("dev → 仓内 packages/ext/dist(目录,out/main 相对三跳)", () => {
    const r = resolveExtPluginPath({ ...base, packaged: false, exists: () => true })
    expect(r.path).toBe(join("/repo/packages/ext/dist"))
  })

  test("CODEPUPPY_EXT_DISABLE=1 → 不装载,带原因", () => {
    const r = resolveExtPluginPath({ ...base, packaged: true, disabled: true, exists: () => true })
    expect(r.path).toBeUndefined()
    expect(r.reason).toContain("CODEPUPPY_EXT_DISABLE")
  })

  test("bundle 缺失 → 无 path 且 reason 含具体路径(anti-B11,调用方必须 loud warn)", () => {
    const r = resolveExtPluginPath({ ...base, packaged: true, exists: () => false })
    expect(r.path).toBeUndefined()
    expect(r.reason).toContain("codepuppy-ext")
  })
})
