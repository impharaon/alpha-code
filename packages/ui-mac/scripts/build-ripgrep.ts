#!/usr/bin/env bun
// build-ripgrep — DESIGN-domestic-cloud-connectivity §4.8:搜索工具(grep / glob)随包带 ripgrep,装好的应用在没有 `rg` 的机器上
// 第一次搜索不再向 GitHub 下载(国内不开代理时那次下载基本下不完,设计 §2.5.2 E1)。
//
// 版本与 sha256 的唯一权威是引擎的 packages/core/src/ripgrep/binary.ts(`RipgrepBinary` 的 VERSION 与 PLATFORM 表):这里只读那份文件,
// 不另抄一份 —— 引擎升级 ripgrep 时随包的跟着变。产物落 native/ripgrep/build/<arch>/(rg + 发行包自带的三份许可文件),
// electron-builder 的 darwin extraResources 把它装成 <Resources>/ripgrep/,随应用一起签名;afterPack 用 target-arch.ts 的
// checkBundledRipgrep 核对。运行期 server.ts 把 <资源根>/ripgrep 追加到引擎 PATH 末尾,引擎的 `which` 先找到它。
//
// 步骤:下载(本机缓存,所有 worktree 共用;命中仍校验)→ sha256 与 binary.ts 不符即拒 → 解出 rg 与许可文件到 staging → 含目标架构片
// → 换上。任何一步失败都删掉半成品再抛。只在 darwin 构建(与随包 Office 运行时同一范围);别的平台打印一行并 no-op。
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { RIPGREP_BUILD_DIR, machOArchs, resolveTargetArch, type TargetArch } from "./target-arch"

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..")
/** 引擎钉住 ripgrep 版本与各平台 sha256 的那份文件(唯一权威)。 */
export const RIPGREP_PIN_SOURCE = resolve(packageDir, "..", "core", "src", "ripgrep", "binary.ts")
/** ripgrep 发行包随带的许可文件(MIT / Unlicense 双许可,COPYING 说明二者关系),随 rg 一起进包。 */
export const RIPGREP_LICENSE_FILES = ["COPYING", "LICENSE-MIT", "UNLICENSE"] as const
const DOWNLOAD_CACHE = join(homedir(), "Library", "Caches", "codepuppy", "ripgrep")

export type RipgrepPin = { version: string; platform: string; sha256: string; url: string }

/** 从 binary.ts 的文本读出目标架构(darwin)的钉住值;读不到就抛,不猜。下载地址与引擎拼法相同。 */
export function readRipgrepPin(arch: TargetArch, source: string = readFileSync(RIPGREP_PIN_SOURCE, "utf8")): RipgrepPin {
  const version = /const VERSION = "([0-9][^"]*)"/.exec(source)?.[1]
  if (!version) throw new Error(`${RIPGREP_PIN_SOURCE}: no ripgrep VERSION constant`)
  const key = `${arch}-darwin`
  const entry = new RegExp(`"${key}":\\s*\\{\\s*platform:\\s*"([^"]+)",\\s*extension:\\s*"tar\\.gz",\\s*sha256:\\s*"([0-9a-f]{64})"`).exec(source)
  if (!entry) throw new Error(`${RIPGREP_PIN_SOURCE}: no "${key}" entry with a tar.gz sha256`)
  const [, platform, sha256] = entry as unknown as [string, string, string]
  return { version, platform, sha256, url: `https://github.com/BurntSushi/ripgrep/releases/download/${version}/ripgrep-${version}-${platform}.tar.gz` }
}

/** 校验归档 sha256,解出 rg 与许可文件,原子换到 dir。sha256 不符或归档缺文件 ⇒ 抛,dir 不出现。 */
export function installRipgrep(input: { archive: string; pin: RipgrepPin; dir: string }): void {
  const got = sha256(input.archive)
  if (got !== input.pin.sha256) throw new Error(`${input.pin.url}: sha256 ${got} != pinned ${input.pin.sha256}`)
  const scratch = mkdtempSync(join(tmpdir(), "codepuppy-ripgrep-"))
  const staging = `${input.dir}.staging`
  try {
    run("tar", ["-xzf", input.archive, "-C", scratch])
    const top = join(scratch, `ripgrep-${input.pin.version}-${input.pin.platform}`)
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(staging, { recursive: true })
    for (const name of ["rg", ...RIPGREP_LICENSE_FILES]) {
      if (!existsSync(join(top, name))) throw new Error(`${input.pin.url}: archive has no ${name}`)
      copyFileSync(join(top, name), join(staging, name))
    }
    chmodSync(join(staging, "rg"), 0o755)
    rmSync(input.dir, { recursive: true, force: true })
    mkdirSync(dirname(input.dir), { recursive: true })
    renameSync(staging, input.dir)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
    rmSync(staging, { recursive: true, force: true })
  }
}

export function buildRipgrep(options: { arch?: TargetArch } = {}): { dir: string; reused: boolean } {
  if (process.platform !== "darwin") throw new Error("the bundled ripgrep builds on darwin only")
  const arch = options.arch ?? resolveTargetArch()
  const pin = readRipgrepPin(arch)
  const dir = join(packageDir, RIPGREP_BUILD_DIR, arch)
  // 戳记放在目录旁边(不进包):记着装进去的是哪个 sha256 的发行包,钉住值变了就重装。
  const stamp = `${dir}.stamp`
  // 复用要求 rg 与三份许可文件都在 —— NOTICE.txt 说许可文本随 rg 一起进包,缺一份就重装。
  const reused = readText(stamp) === pin.sha256 && ["rg", ...RIPGREP_LICENSE_FILES].every((name) => existsSync(join(dir, name)))
  if (!reused) {
    installRipgrep({ archive: download(pin), pin, dir })
    writeFileSync(stamp, pin.sha256)
  }
  const archs = machOArchs(readFileSync(join(dir, "rg")).subarray(0, 4096))
  if (!archs?.includes(arch)) throw new Error(`${join(dir, "rg")} has [${archs?.join(", ") ?? "no Mach-O"}], not ${arch}`)
  console.log(`[alpha:ripgrep] ${arch}: ripgrep ${pin.version} (${pin.platform}, sha256 ${pin.sha256.slice(0, 12)}…)${reused ? " [reused]" : ""} at ${dir}`)
  return { dir, reused }
}

function download(pin: RipgrepPin): string {
  mkdirSync(DOWNLOAD_CACHE, { recursive: true })
  const file = join(DOWNLOAD_CACHE, `${pin.sha256}.tar.gz`)
  if (existsSync(file) && sha256(file) === pin.sha256) return file
  const partial = `${file}.partial`
  rmSync(partial, { force: true })
  run("curl", ["-fsSL", "--retry", "4", "--retry-all-errors", "--retry-delay", "3", "--max-time", "600", "-o", partial, pin.url])
  renameSync(partial, file)
  return file
}

function run(cmd: string, args: string[]) {
  const result = spawnSync(cmd, args, { encoding: "utf8", stdio: "pipe" })
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${result.status ?? result.signal}:\n${result.stderr || result.error?.message || ""}`)
  return result.stdout
}

function sha256(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function readText(file: string) {
  return existsSync(file) ? readFileSync(file, "utf8") : undefined
}

if (import.meta.main) {
  if (process.platform !== "darwin") console.log(`[alpha:ripgrep] skipped on ${process.platform} — the bundled ripgrep ships in mac packages only`)
  else buildRipgrep()
}
