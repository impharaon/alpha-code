// `#1412` —— 用户批准的出网目的地真源(读端 + 写端 + 闭包)的判据,与 mcp-server-truth.test.ts 同形:
//   ① I3:真源路径 `<casBaseRoot>/egress-grants/<env>.json` 不在可写集任何**固定行**之下 —— 对着生产渲染器渲染的(受保护集 CF 按空渲染:本文件只判别的行)
//      profile 枚举 `(allow file-write*` 块里每条规则的 W-id,默认 base / 覆盖 base / 两种 XDG_STATE_HOME 都过。
//      这一条是整个方案的地基:放在可写根之下 = 围栏内的代码可以给自己批准出网(confused deputy)。
//      对照臂:同一批规则里 W3 确实罩着 userData 里的文件 —— 证明这个手段判得出「覆盖」(W2 已删,SPEC-engine-config-fence D2)。
//   ② I8 严格读:缺失 = 没批准过(ok、absent、空清单、零日志);坏 JSON / 版本不对 / grants 不是数组 /
//      字段不合法 / 同一 host:port 重复 / 多余的键 ⇒ ok:false(**不是空数组**)且日志恰一行说得出原因。
//   ③ 写:落盘字节固定字面量、无临时文件残留、原子(rename 中途抛 ⇒ 盘上仍是旧内容)、坏记录不落盘(连目录都不建)。
//   ④ 写模块与生产读写绑定**不进 sidecar 的 import 闭包**;读端零 fs(连 import 都没有)。
// 全平台、electron-free、真文件系统(临时目录)。期望值手写字面量。

import { describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { mkdirSync, renameSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative, resolve } from "node:path"
import { environmentMutableRoot } from "./codepuppy-environment"
import { egressGrantTruthPath, readEgressGrantTruth, type EgressGrantRecord } from "./egress-grant-truth"
import { writeEgressGrantTruth } from "./egress-grant-truth-write"
import { mcpServerTruthPath } from "./mcp-server-truth"
import { relativeImportClosure, sidecarSourceFiles } from "./process-fence-write-sites"
import { renderProcessFenceProfile, type ProcessFenceProfileInput } from "./process-fence-profile"

const repoRoot = resolve(import.meta.dir, "../../../..")
const HOME = "/Users/alpha"
const DEFAULT_STATE_ROOT = `${HOME}/Library/Application Support/codepuppy-state`
const OVERRIDE_STATE_ROOT = `${HOME}/dev/codepuppy-base`
const USER_DATA = `${HOME}/Library/Application Support/ai.opencode.desktop`

function withTemp<T>(run: (dir: string) => T): T {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "egress-grants-")))
  try {
    return run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── I3:位置 ────────────────────────────────────────────────────────────────────

type Rule = { id: string; kind: "subpath" | "literal" | "regex"; value: string }

/** 取 `(allow file-write*` 块里每条规则与它的 `; Wn` 注释。解析不出来当场抛 —— 手段瞎了不算「没覆盖」。 */
function fileWriteRules(profile: string): Rule[] {
  const lines = profile.split("\n")
  const start = lines.indexOf("(allow file-write*")
  const end = lines.indexOf(")", start)
  if (start < 0 || end < 0) throw new Error("profile has no (allow file-write* … ) block")
  const rules: Rule[] = []
  for (const line of lines.slice(start + 1, end)) {
    const id = /;\s*(W\d+)\b/.exec(line)?.[1]
    if (!id) throw new Error(`file-write line without a W-id comment: ${line}`)
    const found = [...line.matchAll(/\((subpath|literal) "([^"]*)"\)|\(regex #"([^"]*)"\)/g)]
    if (!found.length) throw new Error(`file-write line with no parsable rule: ${line}`)
    for (const m of found) rules.push(m[3] !== undefined ? { id, kind: "regex", value: m[3] } : { id, kind: m[1] as "subpath" | "literal", value: m[2]! })
  }
  return rules
}

/** 词法覆盖判据,**偏向判「覆盖」**(fail-closed):大小写不敏感(APFS)、按路径段比。 */
function covers(rule: Rule, target: string): boolean {
  if (rule.kind === "regex") return new RegExp(rule.value, "i").test(target)
  const v = rule.value.toLowerCase()
  const t = target.toLowerCase()
  if (rule.kind === "literal") return v === t
  const rel = relative(v, t)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
}

const describeRule = (r: Rule) => `${r.id} ${r.kind} ${r.value}`

const profileFor = (stateRoot: string, env: "prod" | "dev", over: Partial<ProcessFenceProfileInput> = {}) =>
  renderProcessFenceProfile({
    workspaces: [`${HOME}/code-puppy`, `${HOME}/app/alpha-code`],
    codepuppyGlobalRoot: environmentMutableRoot(env, stateRoot),
    userDataPath: USER_DATA,
    stateHome: USER_DATA,
    roots: { home: HOME, dataHome: `${HOME}/.local/share`, cacheHome: `${HOME}/.cache`, configHome: `${HOME}/.config` },
    egressProxyPort: 4443,
    configFence: [],
    credentialStores: [],
    ...over,
  })

describe("真源位置(I3):<casBaseRoot>/egress-grants/<env>.json 不在可写集任何固定行之下", () => {
  test("路径 = <casBaseRoot>/egress-grants/<env>.json;与 env 根、mcp-servers/、cas/ 同级(相对每个都以 .. 开头)", () => {
    expect(egressGrantTruthPath(DEFAULT_STATE_ROOT, "prod")).toBe("/Users/alpha/Library/Application Support/codepuppy-state/egress-grants/sites.prod.json")
    expect(egressGrantTruthPath(DEFAULT_STATE_ROOT, "beta")).toBe("/Users/alpha/Library/Application Support/codepuppy-state/egress-grants/sites.beta.json")
    expect(egressGrantTruthPath(OVERRIDE_STATE_ROOT, "dev")).toBe("/Users/alpha/dev/codepuppy-base/egress-grants/sites.dev.json")
    for (const env of ["prod", "beta", "dev"] as const) {
      const truth = egressGrantTruthPath(DEFAULT_STATE_ROOT, env)
      for (const sibling of [
        environmentMutableRoot(env, DEFAULT_STATE_ROOT),
        join(DEFAULT_STATE_ROOT, "cas"),
        join(DEFAULT_STATE_ROOT, "fence-workspaces"),
        join(DEFAULT_STATE_ROOT, "custom-providers"),
        join(DEFAULT_STATE_ROOT, "mcp-servers"),
      ]) {
        expect(relative(sibling, truth).startsWith(".."), `${env}: ${sibling}`).toBe(true)
      }
      // 与远程 MCP 真源是同一个父目录下的两个文件,不是同一个文件(两种记录形状不同)
      expect(relative(mcpServerTruthPath(DEFAULT_STATE_ROOT, env), truth)).toBe(join("..", "..", "egress-grants", `sites.${env}.json`))
    }
  })

  test("默认 base 与覆盖 base、两种 XDG_STATE_HOME:没有任何固定行覆盖真源文件或它的目录(W1 除外);对照:W3 罩着 userData 里的文件", () => {
    for (const [stateRoot, env] of [
      [DEFAULT_STATE_ROOT, "prod"],
      [OVERRIDE_STATE_ROOT, "dev"],
    ] as const) {
      for (const stateHome of [USER_DATA, `${HOME}/.local/state`]) {
        const rules = fileWriteRules(profileFor(stateRoot, env, { stateHome })).filter((r) => r.id !== "W1")
        expect(rules.length, `${stateRoot}/${env}/${stateHome}`).toBeGreaterThanOrEqual(15)
        const truth = egressGrantTruthPath(stateRoot, env)
        const dir = join(stateRoot, "egress-grants")
        expect(rules.filter((r) => covers(r, truth)).map(describeRule), `truth file ${truth}`).toEqual([])
        expect(rules.filter((r) => covers(r, dir)).map(describeRule), `truth dir ${dir}`).toEqual([])
        expect(rules.filter((r) => covers(r, join(USER_DATA, "codepuppy-identity.md"))).map(describeRule)).toEqual([`W3 subpath ${USER_DATA}`])
      }
    }
  })

  test("控制臂:profile 里多一行罩住状态根 ⇒ 同一判据当场点名它(证明这个手段判得出覆盖)", () => {
    const rules = fileWriteRules(profileFor(DEFAULT_STATE_ROOT, "prod")).filter((r) => r.id !== "W1")
    const planted: Rule[] = [...rules, { id: "W99", kind: "subpath", value: DEFAULT_STATE_ROOT }]
    const truth = egressGrantTruthPath(DEFAULT_STATE_ROOT, "prod")
    expect(planted.filter((r) => covers(r, truth)).map(describeRule)).toEqual([`W99 subpath ${DEFAULT_STATE_ROOT}`])
  })
})

// ── I8:严格读 ─────────────────────────────────────────────────────────────────

function readWithLog(path: string) {
  const lines: string[] = []
  const read = readEgressGrantTruth(path, { readFileSync, log: (line) => { lines.push(line) } })
  return { read, lines }
}

// Records are produced from the frozen N4 shape, with production serialization for persisted fixtures.
const A: EgressGrantRecord = { site: { kind: "domain", value: "example.com" }, at: "2026-11-26T00:00:00.000Z" }
const B: EgressGrantRecord = { site: { kind: "domain", value: "alice.github.io" }, at: "2026-11-26T00:01:00.000Z" }

describe("严格站点文档与原子替换", () => {
  test("缺失与 unreadable 分开；重启重读站点，只有用户级环境文件改变", () => {
    withTemp((dir) => {
      const path = egressGrantTruthPath(dir, "prod")
      expect(readWithLog(path).read).toEqual({ ok: true, absent: true, sites: [] })
      writeEgressGrantTruth(path, [A, B], { mkdirSync, writeFileSync, renameSync, rmSync })
      expect(readWithLog(path).read).toEqual({ ok: true, absent: false, sites: [A, B] })
      expect(readFileSync(path, "utf8")).toBe(JSON.stringify({ v: 1, sites: [A, B] }) + "\n")
      expect(readdirSync(join(dir, "egress-grants"))).toEqual(["sites.prod.json"])
      expect(egressGrantTruthPath(dir, "prod")).not.toBe(egressGrantTruthPath(dir, "dev"))
    })
  })
  test("多余字段、旧精确记录、坏站点、坏 UTC 和重复站点拒绝，不冒充空清单", () => {
    const invalid: unknown[] = [
      null, { v: 2, sites: [] }, { v: 1, grants: [] }, { v: 1, sites: [], project: "x" }, { v: 1, sites: {} },
      { v: 1, sites: [null] }, { v: 1, sites: [{ ...A, port: 443 }] },
      { v: 1, sites: [{ ...A, site: { kind: "domain", value: "*.com" } }] },
      { v: 1, sites: [{ ...A, at: "2026-02-31T00:00:00.000Z" }] },
      { v: 1, sites: [{ ...A, at: "2026-11-26T00:00:00+08:00" }] }, { v: 1, sites: [A, A] },
    ]
    withTemp((dir) => {
      const path = join(dir, "sites.prod.json")
      for (const value of invalid) {
        writeFileSync(path, JSON.stringify(value))
        const result = readWithLog(path)
        expect(result.read.ok).toBe(false)
        expect(result.lines).toHaveLength(1)
      }
      writeFileSync(path, "bad json")
      expect(readWithLog(path).read.ok).toBe(false)
    })
  })
  test("坏记录不写，rename 失败保留原字节并清理临时文件", () => {
    withTemp((dir) => {
      const path = egressGrantTruthPath(dir, "prod")
      const fs = { mkdirSync, writeFileSync, renameSync, rmSync }
      expect(() => writeEgressGrantTruth(path, [{ ...A, at: "bad" }], fs)).toThrow()
      expect(existsSync(join(dir, "egress-grants"))).toBe(false)
      writeEgressGrantTruth(path, [A], fs)
      const before = readFileSync(path, "utf8")
      expect(() => writeEgressGrantTruth(path, [B], { ...fs, renameSync: () => { throw new Error("rename exploded") } })).toThrow("rename exploded")
      expect(readFileSync(path, "utf8")).toBe(before)
      expect(readdirSync(join(dir, "egress-grants"))).toEqual(["sites.prod.json"])
    })
  })
})

test("main 站点写端不进入 sidecar 闭包，读端消费共享校验但没有写盘权", () => {
  const files = sidecarSourceFiles(repoRoot)
  expect(files).toContain("packages/ui-mac/src/main/codepuppy-config-injection.ts")
  for (const name of ["egress-grant-truth-write", "egress-grant-records", "network-egress-approval"]) expect(files).not.toContain(`packages/ui-mac/src/main/${name}.ts`)
  const closure = relativeImportClosure(join(repoRoot, "packages/ui-mac/src/main/egress-grant-truth.ts"))
  expect(closure.some((path) => path.endsWith("egress-grant-truth-write.ts"))).toBe(false)
})
