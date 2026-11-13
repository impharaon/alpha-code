// `#1709` —— 项目扩展信任记录(读端 project-trust-truth.ts / 写端 project-trust-truth-write.ts)的判据:位置只由 main 派生的根算出、
// 严格读(形状不对整份拒;记录或它的目录是符号链接不跟)、按「规范目录 + inode」查找、写端原子且保留别的项目、写端不进 ext 的
// import 闭包;以及项目里指向记录的符号链接不能让 main 往记录里写。真文件系统(临时目录),期望值手写字面量。

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { __resetCodePuppyEnvironmentForTests } from "./codepuppy-environment"
import { writeProjectPrefs } from "./codepuppy-workdir"
import {
  locateProjectTrustTruth,
  parseProjectTrustTruth,
  projectTrustEntry,
  projectTrustIdentity,
  projectTrustTruthPath,
  readProjectTrustEntry,
  readProjectTrustTruth,
} from "./project-trust-truth"
import { recordProjectTrustDecision } from "./project-trust-truth-write"
import { relativeImportClosure } from "./process-fence-write-sites"

let root = ""
let stateRoot = ""
let record = ""
let saved: string | undefined

beforeEach(() => {
  __resetCodePuppyEnvironmentForTests()
  saved = process.env.CODEPUPPY_GLOBAL_DIR
  root = realpathSync(mkdtempSync(join(tmpdir(), "project-trust-")))
  stateRoot = join(root, "codepuppy-state")
  mkdirSync(join(stateRoot, "env", "dev"), { recursive: true })
  process.env.CODEPUPPY_GLOBAL_DIR = join(stateRoot, "env", "dev")
  record = join(stateRoot, "project-trust", "dev.json")
})
afterEach(() => {
  if (saved === undefined) delete process.env.CODEPUPPY_GLOBAL_DIR
  else process.env.CODEPUPPY_GLOBAL_DIR = saved
  rmSync(root, { recursive: true, force: true })
})

const project = (name: string) => {
  const dir = join(root, name)
  mkdirSync(join(dir, ".codepuppy"), { recursive: true })
  return projectTrustIdentity(dir)!
}
const quiet = () => {}

describe("位置:只由 main 派生的根算出", () => {
  test("`<casBaseRoot>/project-trust/<env>.json`;sidecar 的处境(无快照)由 CODEPUPPY_GLOBAL_DIR 逆映射,逐字等于手写路径", () => {
    expect(projectTrustTruthPath("/Users/u/Library/Application Support/codepuppy-state", "prod")).toBe(
      "/Users/u/Library/Application Support/codepuppy-state/project-trust/prod.json",
    )
    expect(locateProjectTrustTruth()).toEqual({ ok: true, path: record })
  })

  test("CODEPUPPY_GLOBAL_DIR 不是 `<base>/env/<env>` ⇒ 位置未知:不读、不写,读出来就是一个项目都不信任", () => {
    const me = project("p")
    expect(recordProjectTrustDecision(me, true, "2026-11-13T00:00:00.000Z", quiet)).toEqual({ ok: true })
    const odd = join(root, "odd-root")
    mkdirSync(odd)
    process.env.CODEPUPPY_GLOBAL_DIR = odd
    expect(locateProjectTrustTruth().ok).toBe(false)
    const lines: string[] = []
    expect(readProjectTrustEntry(me, (line) => lines.push(line))).toBeUndefined()
    expect(lines).toHaveLength(1)
    expect(recordProjectTrustDecision(me, true, "2026-11-13T00:00:00.000Z", quiet).ok).toBe(false)
  })
})

describe("严格读", () => {
  const good = { v: 1, projects: { "/a/p": { ino: "12", version: 1, granted: true, decidedAt: "2026-11-13T00:00:00.000Z" } } }

  test("合法形状读得回;每一种不对的形状都整份拒", () => {
    expect(parseProjectTrustTruth(JSON.stringify(good))).toEqual({ ok: true, projects: good.projects })
    const entry = good.projects["/a/p"]
    const bad: unknown[] = [
      "not json",
      [],
      { v: 2, projects: {} },
      { v: 1, projects: {}, extra: 1 },
      { v: 1, projects: [] },
      { v: 1, projects: { "relative/p": entry } },
      { v: 1, projects: { "/a/../p": entry } },
      { v: 1, projects: { "/a/p": { ...entry, ino: 12 } } },
      { v: 1, projects: { "/a/p": { ...entry, ino: "0x1" } } },
      { v: 1, projects: { "/a/p": { ...entry, version: 0 } } },
      { v: 1, projects: { "/a/p": { ...entry, granted: "yes" } } },
      { v: 1, projects: { "/a/p": { ...entry, decidedAt: "" } } },
      { v: 1, projects: { "/a/p": { ...entry, extra: true } } },
      { v: 1, projects: { "/a/p": { ino: "12", version: 1, granted: true } } },
    ]
    for (const value of bad) expect(parseProjectTrustTruth(typeof value === "string" ? value : JSON.stringify(value)).ok).toBe(false)
  })

  test("目录或文件不存在 ⇒ 没有决定(absent,不是错误);坏文件 ⇒ 拒并出声", () => {
    expect(readProjectTrustTruth(record)).toEqual({ ok: true, absent: true, projects: {} })
    mkdirSync(join(stateRoot, "project-trust"))
    expect(readProjectTrustTruth(record)).toEqual({ ok: true, absent: true, projects: {} })
    writeFileSync(record, "{")
    expect(readProjectTrustTruth(record).ok).toBe(false)
    const lines: string[] = []
    expect(readProjectTrustEntry(project("p"), (line) => lines.push(line))).toBeUndefined()
    expect(lines).toHaveLength(1)
  })

  test("记录文件是符号链接、或记录目录是符号链接 ⇒ 不跟过去,一个项目都不信任(指向的那份里明明写着同意)", () => {
    const me = project("p")
    const forged = join(root, "forged")
    mkdirSync(forged)
    writeFileSync(join(forged, "dev.json"), JSON.stringify({ v: 1, projects: { [me.directory]: { ino: me.ino, version: 1, granted: true, decidedAt: "x" } } }))
    // 先证明那份伪造记录本身是合法的:换成普通文件就会被接受
    expect(projectTrustEntry((readProjectTrustTruth(join(forged, "dev.json")) as { projects: never }).projects, me)?.granted).toBe(true)
    mkdirSync(join(stateRoot, "project-trust"))
    symlinkSync(join(forged, "dev.json"), record)
    expect(readProjectTrustTruth(record).ok).toBe(false)
    expect(readProjectTrustEntry(me, quiet)).toBeUndefined()
    rmSync(join(stateRoot, "project-trust"), { recursive: true })
    symlinkSync(forged, join(stateRoot, "project-trust"), "dir")
    expect(readProjectTrustTruth(record).ok).toBe(false)
    expect(readProjectTrustEntry(me, quiet)).toBeUndefined()
    // 写端也不往链接后面写
    expect(recordProjectTrustDecision(me, false, "y", quiet).ok).toBe(false)
    expect(JSON.parse(readFileSync(join(forged, "dev.json"), "utf8")).projects[me.directory].granted).toBe(true)
  })
})

describe("查找:规范目录逐字相等且 inode 相等", () => {
  test("同路径同 inode ⇒ 命中;同路径换了 inode(删掉后重建)⇒ 不命中;别的路径 ⇒ 不命中", () => {
    const me = project("p")
    const projects = { [me.directory]: { ino: me.ino, version: 1, granted: true, decidedAt: "x" } }
    expect(projectTrustEntry(projects, me)?.granted).toBe(true)
    rmSync(me.directory, { recursive: true })
    mkdirSync(me.directory)
    const recreated = projectTrustIdentity(me.directory)!
    expect(recreated.ino).not.toBe(me.ino)
    expect(projectTrustEntry(projects, recreated)).toBeUndefined()
    expect(projectTrustEntry(projects, { directory: `${me.directory}2`, ino: me.ino })).toBeUndefined()
    expect(projectTrustEntry({}, { directory: "__proto__", ino: "1" })).toBeUndefined()
  })
})

describe("写端", () => {
  test("落盘字节固定;第二个项目追加、同一项目覆盖、别的项目保留;目录里没有临时文件", () => {
    const a = project("a")
    const b = project("b")
    expect(recordProjectTrustDecision(a, true, "2026-11-13T01:00:00.000Z", quiet)).toEqual({ ok: true })
    expect(readFileSync(record, "utf8")).toBe(
      `{"v":1,"projects":{${JSON.stringify(a.directory)}:{"ino":"${a.ino}","version":1,"granted":true,"decidedAt":"2026-11-13T01:00:00.000Z"}}}\n`,
    )
    expect(recordProjectTrustDecision(b, false, "2026-11-13T02:00:00.000Z", quiet)).toEqual({ ok: true })
    expect(recordProjectTrustDecision(a, false, "2026-11-13T03:00:00.000Z", quiet)).toEqual({ ok: true })
    const read = readProjectTrustTruth(record)
    expect(read).toEqual({
      ok: true,
      absent: false,
      projects: {
        [a.directory]: { ino: a.ino, version: 1, granted: false, decidedAt: "2026-11-13T03:00:00.000Z" },
        [b.directory]: { ino: b.ino, version: 1, granted: false, decidedAt: "2026-11-13T02:00:00.000Z" },
      },
    })
    expect(readdirSync(join(stateRoot, "project-trust"))).toEqual(["dev.json"])
  })

  test("写端不进 ext 的 import 闭包,读端在(ext 只读不写)", () => {
    const repoRoot = resolve(import.meta.dir, "../../../..")
    const closure = relativeImportClosure(join(repoRoot, "packages/ext/src/plugin.ts")).map((file) => file.slice(repoRoot.length + 1))
    expect(closure).toContain("packages/ui-mac/src/main/project-trust-truth.ts")
    expect(closure).not.toContain("packages/ui-mac/src/main/project-trust-truth-write.ts")
  })

  test("审计 Minor 1:现有记录读不出来(I/O 错误,这里是 EACCES)⇒ 拒写、走「未能保存」,别的项目的决定原样留着", () => {
    const a = project("a")
    const b = project("b")
    expect(recordProjectTrustDecision(a, true, "2026-11-13T01:00:00.000Z", quiet)).toEqual({ ok: true })
    const before = readFileSync(record)
    chmodSync(record, 0o000)
    try {
      const written = recordProjectTrustDecision(b, true, "2026-11-13T02:00:00.000Z", quiet)
      expect(written.ok).toBe(false)
    } finally {
      chmodSync(record, 0o600)
    }
    expect(readFileSync(record).equals(before)).toBe(true)
    expect(readProjectTrustEntry(a, quiet)?.granted).toBe(true)
  })

  test("现有记录坏了 ⇒ 出一行原因、只留这一次的决定", () => {
    const a = project("a")
    mkdirSync(join(stateRoot, "project-trust"))
    writeFileSync(record, "{ broken")
    const lines: string[] = []
    expect(recordProjectTrustDecision(a, true, "t", (line) => lines.push(line))).toEqual({ ok: true })
    expect(lines).toHaveLength(1)
    expect(readProjectTrustEntry(a, quiet)?.granted).toBe(true)
  })
})

describe("项目里指向记录的符号链接不能让 main 写进记录", () => {
  test("项目 `.codepuppy/prefs.json` 链到记录文件 ⇒ main 往项目 prefs 写(externalImport 那条路)被拒,记录字节不变", () => {
    const me = project("p")
    expect(recordProjectTrustDecision(me, false, "2026-11-13T00:00:00.000Z", quiet)).toEqual({ ok: true })
    const before = readFileSync(record)
    symlinkSync(record, join(me.directory, ".codepuppy", "prefs.json"))
    const written = writeProjectPrefs(me.directory, { extensionsConsent: { version: 1, granted: true, decidedAt: "x" } })
    expect(written.ok).toBe(false)
    expect(readFileSync(record).equals(before)).toBe(true)
    expect(existsSync(join(me.directory, ".codepuppy", "prefs.json"))).toBe(true)
    expect(statSync(record).isFile()).toBe(true)
  })
})
