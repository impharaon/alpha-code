import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { assertReleaseSource } from "../../scripts/release-source"

const packageDir = path.resolve(import.meta.dir, "../..")
const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })))

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", ["-c", "user.name=Release Test", "-c", "user.email=release@example.invalid", ...args], { cwd, encoding: "utf8" })
  expect(result.status, result.stderr).toBe(0)
  return result.stdout.trim()
}

// Git 格式由真实裸仓/克隆生成;打包配置及其依赖逐字复制本仓文件,不伪造配置。
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codepuppy-release-source-"))
  dirs.push(dir)
  git(dir, "init", "--bare", "origin.git")
  git(dir, "clone", path.join(dir, "origin.git"), "work")
  const cwd = path.join(dir, "work")
  git(cwd, "switch", "-c", "alpha")
  for (const file of ["electron-builder.config.ts", "scripts/target-arch.ts", "scripts/release-source.ts", "src/shared/route-manifest.ts", "src/main/release-sbom.ts"]) {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
    fs.copyFileSync(path.join(packageDir, file), path.join(cwd, file))
  }
  fs.writeFileSync(path.join(cwd, ".gitignore"), "node_modules\n")
  git(cwd, "add", ".")
  git(cwd, "commit", "-m", "release source snapshot")
  git(cwd, "push", "-u", "origin", "alpha")
  fs.symlinkSync(path.join(packageDir, "node_modules"), path.join(cwd, "node_modules"))
  return cwd
}

function advance(cwd: string) {
  git(path.dirname(cwd), "clone", "--branch", "alpha", path.join(path.dirname(cwd), "origin.git"), "upstream")
  const upstream = path.join(path.dirname(cwd), "upstream")
  git(upstream, "commit", "--allow-empty", "-m", "trunk advanced during packaging")
  git(upstream, "push", "origin", "alpha")
  return git(upstream, "rev-parse", "HEAD")
}

describe("assertReleaseSource", () => {
  test("最新且干净返回完整 SHA;忽略文件不算脏", () => {
    const cwd = fixture()
    expect(assertReleaseSource(cwd)).toBe(git(cwd, "rev-parse", "HEAD"))
  })
  test("落后:fetch 看见主线新提交并列出差异", () => {
    const cwd = fixture()
    const sha = advance(cwd)
    expect(() => assertReleaseSource(cwd)).toThrow(new RegExp(String.raw`HEAD\.\.origin/alpha[\s\S]*${sha.slice(0, 7)} trunk advanced during packaging`))
  })
  test("领先:列出本地独有提交", () => {
    const cwd = fixture()
    git(cwd, "commit", "--allow-empty", "-m", "local release change")
    expect(() => assertReleaseSource(cwd)).toThrow(/origin\/alpha\.\.HEAD[\s\S]*local release change/)
  })
  for (const tracked of [true, false])
    test(tracked ? "已跟踪文件改动拒绝并点名" : "未跟踪文件拒绝并点名", () => {
      const cwd = fixture()
      const file = tracked ? ".gitignore" : "untracked.txt"
      fs.appendFileSync(path.join(cwd, file), "changed\n")
      expect(() => assertReleaseSource(cwd)).toThrow(` ${file}`)
      expect(() => assertReleaseSource(cwd)).toThrow("同步到最新主线 origin/alpha 后重新打包")
    })
  test("origin 不可达:fetch 失败即拒绝", () => {
    const cwd = fixture()
    git(cwd, "remote", "set-url", "origin", path.join(cwd, "missing-origin"))
    expect(() => assertReleaseSource(cwd)).toThrow("git fetch origin alpha 失败")
  })
})

describe("#1631 真实 beforePack", () => {
  for (const channel of ["prod", "beta", "dev"])
    for (const sign of ["1", "0"])
      test(`${channel} sign=${sign}:脏检出只拦 beta/prod 签名包,且先于架构检查`, () => {
        const cwd = fixture()
        fs.writeFileSync(path.join(cwd, "untracked.txt"), "dirty\n")
        const result = spawnSync(process.execPath, ["-e", `
          Object.defineProperty(process, "platform", { value: "darwin" })
          const { Arch } = await import("electron-builder")
          const config = (await import(${JSON.stringify(path.join(cwd, "electron-builder.config.ts"))})).default
          await config.beforePack({ electronPlatformName: "win32", arch: Arch.x64 })
          await config.beforePack({ electronPlatformName: "darwin", arch: Arch.x64 })
        `], { cwd, encoding: "utf8", env: { ...process.env, OPENCODE_CHANNEL: channel, CODEPUPPY_SIGN: sign, GITHUB_ACTIONS: "false", CODEPUPPY_TARGET_ARCH: "arm64" } })
        expect(result.status).toBe(1)
        expect(result.stderr).toContain(channel !== "dev" && sign === "1" ? "工作区有未提交改动" : "正在打 x64 包")
      })
})

describe("#1631 manifest CLI", () => {
  for (const channel of ["prod", "beta"])
    test(`${channel}:打包途中主线前进,produce 拒绝且不产出 manifest`, () => {
      const cwd = fixture()
      const sha = advance(cwd)
      const dist = path.join(path.dirname(cwd), "dist")
      const result = spawnSync(process.execPath, [path.join(packageDir, "scripts/release-manifest.ts"), "produce", "--channel", channel, "--dist", dist], {
        cwd, encoding: "utf8", env: { ...process.env, CODEPUPPY_TARGET_ARCH: "arm64" },
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(`${sha.slice(0, 7)} trunk advanced during packaging`)
      expect(fs.existsSync(path.join(dist, "codepuppy-release-manifest.json"))).toBe(false)
    })
})
