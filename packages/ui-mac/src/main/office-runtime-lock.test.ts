// #1564 AC2:随包 Office 运行时的两平台 lock 覆盖 requirements.in 七个顶层包的**完整**传递依赖闭包,每条带哈希;
// 运行时本身(python-build-standalone)按 URL + sha256 钉死。
//
// 依赖图来自 office-runtime.lock 的 requires —— 那份图不是手写的替身:build-office-runtime.ts 每次全新安装都把它
// 与已装发行包的 METADATA(按随包解释器求值 marker)逐项比对,不一致即拒绝出产物。判据函数 lockClosureProblems
// 是构建脚本安装前跑的同一个函数。先证明它能红:从真 lock 里删掉一个传递依赖、或塞进一个闭包外的包,它都点名。
import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { homedir, tmpdir } from "node:os"
import { OFFICE_RUNTIME_DOWNLOAD_CACHE, OFFICE_RUNTIME_LOCK_DIR, holdingOfficeRuntimeBuild, lockClosureProblems, parseRequirementsLock, readOfficeRuntimeLock } from "../../scripts/build-office-runtime"

const read = (name: string) => readFileSync(join(OFFICE_RUNTIME_LOCK_DIR, name), "utf8")
const requirementsIn = read("requirements.in")
const lock = readOfficeRuntimeLock()

/** 从 uv pip compile 的输出里删掉一个发行包的整段(pin 行 + 它的 hash 行 + via 注释)。 */
function withoutDistribution(text: string, name: string): string {
  const lines = text.split("\n")
  const start = lines.findIndex((line) => line.startsWith(`${name}==`))
  if (start < 0) throw new Error(`${name} is not in the lock`)
  const end = lines.findIndex((line, index) => index > start && /^[A-Za-z0-9]/.test(line))
  return [...lines.slice(0, start), ...lines.slice(end < 0 ? lines.length : end)].join("\n")
}

describe("document runtime locks", () => {
  test("requirements.in names the pinned document packages the four formats import, each pinned", () => {
    expect([...parseRequirementsLock(requirementsIn)].map(([name, pin]) => `${name}==${pin.version}`).sort()).toEqual([
      "openpyxl==3.1.5",
      "pydantic==2.14.4",
      "pypdf==6.16.1",
      "pypdfium2==5.0.0",
      "python-docx==1.2.0",
      "python-pptx==1.0.2",
      "reportlab==5.0.0",
    ])
  })

  for (const arch of ["arm64", "win32-x64"] as const) {
    test(`requirements-${arch}.lock is the complete hashed closure of requirements.in`, () => {
      const text = read(`requirements-${arch}.lock`)
      expect(lockClosureProblems(requirementsIn, text, lock.requires)).toEqual([])
      // 闭包实测 16 个发行包(方案 §1.3:七个顶层包只是其中一部分)。
      expect(parseRequirementsLock(text).size).toBe(16)
      // 两份 lock 都由 uv pip compile 按各自的目标平台与 Python 3.11 生成(文件头记着命令)。
      expect(text).toContain(`--python-version 3.11 --python-platform ${arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-pc-windows-msvc"} --generate-hashes`)
    })

    test(`requirements-${arch}.lock: deleting one transitive dependency, or adding one outside the closure, is named`, () => {
      const text = read(`requirements-${arch}.lock`)
      expect(lockClosureProblems(requirementsIn, withoutDistribution(text, "et-xmlfile"), lock.requires)).toEqual([
        "et-xmlfile: required (via office-runtime.lock requires) but missing from the lock",
      ])
      expect(lockClosureProblems(requirementsIn, withoutDistribution(text, "lxml"), lock.requires)).toEqual([
        "lxml: required (via office-runtime.lock requires) but missing from the lock",
      ])
      expect(lockClosureProblems(requirementsIn, `${text}\nsix==1.17.0 \\\n    --hash=sha256:${"0".repeat(64)}\n`, lock.requires)).toEqual([
        "six: in the lock but outside the closure of requirements.in",
      ])
      const unhashed = text.replace(/(xlsxwriter==\S+) \\\n(\s+--hash=sha256:[0-9a-f]{64}( \\)?\n)+/, "$1\n")
      expect(lockClosureProblems(requirementsIn, unhashed, lock.requires)).toEqual(["xlsxwriter: no sha256 hash"])
    })
  }

  test("the runtime itself is a python-build-standalone CPython 3.11 pinned by URL + sha256 per architecture", () => {
    expect(lock.python.version).toMatch(/^3\.11\.\d+$/)
    for (const [arch, triple] of [["arm64", "aarch64-apple-darwin"], ["win32-x64", "x86_64-pc-windows-msvc"]] as const) {
      const pin = lock.python[arch]
      expect(pin.url).toBe(
        `https://github.com/astral-sh/python-build-standalone/releases/download/${lock.python.release}/cpython-${lock.python.version}%2B${lock.python.release}-${triple}-install_only_stripped.tar.gz`,
      )
      expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(lock.python.arm64.sha256).not.toBe(lock.python["win32-x64"].sha256)
    // 下载缓存本机所有 worktree 共用,不在任何一个 checkout 里(新 worktree 不必再经代理下载一遍)。
    expect(OFFICE_RUNTIME_DOWNLOAD_CACHE).toBe(join(homedir(), "Library", "Caches", "codepuppy", "office-runtime"))
    expect(OFFICE_RUNTIME_DOWNLOAD_CACHE.startsWith(join(OFFICE_RUNTIME_LOCK_DIR, "..", ".."))).toBe(false)
  })
})

// The PR gate runs the files that build this runtime in parallel workers; two builders of one target share
// `<dir>.staging`, and without exclusion the second deletes the first one's tree mid-pip or mid-compileall.
describe("office runtime build exclusion", () => {
  const holder = `
    import { appendFileSync } from "node:fs"
    import { holdingOfficeRuntimeBuild } from ${JSON.stringify(join(import.meta.dir, "../../scripts/build-office-runtime.ts"))}
    const [dir, log, name] = process.argv.slice(-3)
    holdingOfficeRuntimeBuild(dir, () => {
      appendFileSync(log, "enter " + name + "\\n")
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400)
      appendFileSync(log, "exit " + name + "\\n")
    })`

  test("two builder processes of one target never mutate it at the same time", async () => {
    const root = mkdtempSync(join(tmpdir(), "office-runtime-exclusion-"))
    try {
      const log = join(root, "log")
      const builders = ["a", "b"].map((name) => Bun.spawn([process.execPath, "-e", holder, join(root, "arm64"), log, name], { stderr: "pipe" }))
      expect(await Promise.all(builders.map((builder) => builder.exited))).toEqual([0, 0])
      const lines = readFileSync(log, "utf8").trim().split("\n")
      expect(lines.map((line) => line.split(" ")[0])).toEqual(["enter", "exit", "enter", "exit"])
      expect(lines[0]!.split(" ")[1]).toBe(lines[1]!.split(" ")[1])
      expect(existsSync(join(root, "arm64.lock"))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("a lock left by a builder that no longer runs is taken over", async () => {
    const root = mkdtempSync(join(tmpdir(), "office-runtime-exclusion-"))
    try {
      const gone = Bun.spawn(["true"])
      await gone.exited
      writeFileSync(join(root, "arm64.lock"), String(gone.pid))
      expect(holdingOfficeRuntimeBuild(join(root, "arm64"), () => readFileSync(join(root, "arm64.lock"), "utf8"))).toBe(String(process.pid))
      expect(existsSync(join(root, "arm64.lock"))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
