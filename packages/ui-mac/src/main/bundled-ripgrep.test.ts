// DESIGN-domestic-cloud-connectivity §4.8:搜索工具随包带 ripgrep。构建步骤(scripts/build-ripgrep.ts)从引擎的唯一权威
// packages/core/src/ripgrep/binary.ts 读版本与目标架构的 sha256,不另抄一份;sha256 不符即构建失败,半成品不落盘。
//
// 归档的目录形状取自引擎自己的解包路径(binary.ts:`ripgrep-<VERSION>-<platform>/rg`)与 ripgrep 发行包随带的三份许可文件;
// 字节是本测试现做的小归档 —— 真实发行包在构建时按钉住的 sha256 校验,随包结果另在打包产物上核对(plan.md 证明表)。

import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { RIPGREP_LICENSE_FILES, installRipgrep, readRipgrepPin } from "../../scripts/build-ripgrep"

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })))
const tmp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundled-ripgrep-"))
  dirs.push(dir)
  return dir
}

describe("§4.8 随包 ripgrep 的钉住值取自引擎 binary.ts", () => {
  test("arm64 / x64 的版本、平台名、sha256 与下载地址", () => {
    expect(readRipgrepPin("arm64")).toEqual({
      version: "15.1.0",
      platform: "aarch64-apple-darwin",
      sha256: "378e973289176ca0c6054054ee7f631a065874a352bf43f0fa60ef079b6ba715",
      url: "https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/ripgrep-15.1.0-aarch64-apple-darwin.tar.gz",
    })
    expect(readRipgrepPin("x64")).toMatchObject({ version: "15.1.0", platform: "x86_64-apple-darwin", sha256: "64811cb24e77cac3057d6c40b63ac9becf9082eedd54ca411b475b755d334882" })
  })

  test("binary.ts 里读不到版本或该架构的条目 ⇒ 抛错,不猜", () => {
    // 与 binary.ts 同形的最小文本(同样的 VERSION 常量与 PLATFORM 条目写法),只改坏要判的那一处。
    const source = `const VERSION = "15.1.0"\nconst PLATFORM = {\n  "arm64-darwin": {\n    platform: "aarch64-apple-darwin",\n    extension: "tar.gz",\n    sha256: "${"a".repeat(64)}",\n  },\n}\n`
    expect(readRipgrepPin("arm64", source)).toMatchObject({ version: "15.1.0", platform: "aarch64-apple-darwin", sha256: "a".repeat(64) })
    expect(() => readRipgrepPin("arm64", source.replace('const VERSION = "15.1.0"', "const VERSION = undefined"))).toThrow(/VERSION/)
    expect(() => readRipgrepPin("arm64", source.replace('"arm64-darwin"', '"arm64-darwin-gone"'))).toThrow(/arm64-darwin/)
    expect(() => readRipgrepPin("arm64", source.replace("a".repeat(64), "not-a-digest"))).toThrow(/arm64-darwin/)
  })
})

describe("§4.8 installRipgrep", () => {
  function archive(pinVersion: string, platform: string) {
    const root = tmp()
    const top = path.join(root, `ripgrep-${pinVersion}-${platform}`)
    fs.mkdirSync(top)
    fs.writeFileSync(path.join(top, "rg"), "#!/bin/sh\necho 'ripgrep 15.1.0'\n", { mode: 0o755 })
    for (const name of RIPGREP_LICENSE_FILES) fs.writeFileSync(path.join(top, name), `${name} text\n`)
    fs.writeFileSync(path.join(top, "README.md"), "readme\n")
    const file = path.join(root, "rg.tar.gz")
    const tar = spawnSync("tar", ["-czf", file, "-C", root, path.basename(top)])
    expect(tar.status, tar.stderr?.toString()).toBe(0)
    return { file, sha256: createHash("sha256").update(fs.readFileSync(file)).digest("hex") }
  }

  test("sha256 相符 ⇒ 装出带执行位的 rg 与三份许可文件,别的不带", () => {
    const pin = readRipgrepPin("arm64")
    const made = archive(pin.version, pin.platform)
    const dir = path.join(tmp(), "out")
    installRipgrep({ archive: made.file, pin: { ...pin, sha256: made.sha256 }, dir })
    expect(fs.readdirSync(dir).sort()).toEqual(["rg", ...RIPGREP_LICENSE_FILES].sort())
    expect(fs.statSync(path.join(dir, "rg")).mode & 0o111).not.toBe(0)
  })

  test("sha256 不符 ⇒ 抛错,目标目录不出现", () => {
    const pin = readRipgrepPin("arm64")
    const made = archive(pin.version, pin.platform)
    const dir = path.join(tmp(), "out")
    expect(() => installRipgrep({ archive: made.file, pin, dir })).toThrow(/sha256/)
    expect(fs.existsSync(dir)).toBe(false)
  })
})
