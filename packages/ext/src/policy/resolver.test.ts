// #1128 (REQ-131) — layered tool policy resolver / selector / persistence / managed cap, on OpenCode 2.
// Moved from packages/opencode/test/permission/codepuppy-tool-policy.test.ts with the family (#1662 L4). Groups S, R
// and T are unchanged (pure); the managed cap group follows the OpenCode 2 reader (managed.ts: system directory + MDM,
// both rule shapes, JSONC fail-closed); the service groups run against the plain store the extension uses.
//
// Anchor discipline: expected values are hand-written literals (canonical strings, paths, default states), never
// derived from the module under test; the last anchor case checks the literals the other way round.
import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  classDefaultState,
  classifyTool,
  parseToolPolicyDocument,
  selectorKey,
  selectorMatches,
  toPermissionAction,
  type ToolPolicyRecord,
  type ToolPolicySubject,
} from "../../../schema/src/codepuppy-tool-policy"
import { managedCapDenies, readManagedPolicy, systemManagedPolicyDir } from "./managed"
import { createToolPolicyStore, mcpBindingDigest, resolveToolPolicy, ToolPolicyWriteError } from "./resolver"
import { loadPolicyDocument, policyFilePath, resetPolicyDocument, savePolicyDocument } from "./store"
import { policyWorkspace } from "./index"

const ID_MCP_PAID = "mcp:policy:paid_action"
const DIGEST_A = `sha256:${"a".repeat(64)}`
const DIGEST_B = `sha256:${"b".repeat(64)}`

const mcpSubject = (bindingDigest?: string): ToolPolicySubject => ({
  identity: { source: "mcp", origin: "policy", name: "paid_action" },
  authority: { kind: "not-asserted" },
  bindingDigest,
})

const cloudSubject = (evidenceDigest: string): ToolPolicySubject => ({
  identity: { source: "mcp", origin: "alpha", name: "web_search" },
  authority: { kind: "codepuppy-cloud", bindingId: "mcp:alpha", evidenceDigest },
})

const bundledSubject = (bindingDigest?: string): ToolPolicySubject => ({
  identity: { source: "mcp", origin: "codepuppy-word", name: "read_docx" },
  authority: { kind: "codepuppy-bundled", bindingId: "mcp:codepuppy-word", evidenceDigest: DIGEST_B },
  bindingDigest,
})

const NO_CAPS = { managed: { status: "ok", ruleset: [], sources: [] } } as const
const NO_USER = { status: "absent" } as const

const tmpdirs: string[] = []
function tmpdir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpdirs.push(dir)
  return dir
}
afterEach(() => {
  while (tmpdirs.length > 0) fs.rmSync(tmpdirs.pop()!, { recursive: true, force: true })
})

const PARTITION = { account: "acct-1", workspace: "ws-1" }

// ═══ S. 分类与 selector(§2/§3)═══════════════════════════════════════════════
describe("classify + selector matcher", () => {
  test("S1 四类分类只认 identity.source 与 verified authority", () => {
    expect(classifyTool({ identity: { source: "builtin", origin: "", name: "write" }, authority: { kind: "not-asserted" } })).toBe("builtin")
    expect(classifyTool({ identity: { source: "builtin-v2", origin: "", name: "write" }, authority: { kind: "not-asserted" } })).toBe("builtin")
    expect(classifyTool({ identity: { source: "host", origin: "", name: "list_mcp_resources" }, authority: { kind: "not-asserted" } })).toBe("builtin")
    expect(classifyTool(cloudSubject(DIGEST_A))).toBe("codepuppy-cloud")
    expect(classifyTool(mcpSubject())).toBe("third-party-mcp")
    expect(classifyTool({ identity: { source: "plugin", origin: "probe", name: "default" }, authority: { kind: "not-asserted" } })).toBe("plugin")
    // identity 铸不出 canonical(空 name)⇒ 无类可归。
    expect(classifyTool({ identity: { source: "mcp", origin: "x", name: "" }, authority: { kind: "not-asserted" } })).toBeUndefined()
    expect(classDefaultState("builtin")).toBe("enabled")
    expect(classDefaultState("codepuppy-cloud")).toBe("ask")
    expect(classDefaultState("third-party-mcp")).toBe("ask")
    expect(classDefaultState("plugin")).toBe("ask")
  })

  test("S2 手拼 wildcard 不是一个层级:`mcp:policy:*` 被 schema 拒绝;name=`*` 只匹配那个字面工具", () => {
    // 非规范形(裸 `*` 应编码为 %2A)⇒ decode loud fail,不落成一条永不命中的死记录。
    expect(() =>
      parseToolPolicyDocument({
        version: 1,
        partition: PARTITION,
        records: [{ selector: { level: "tool", canonical: "mcp:policy:*" }, state: "disabled" }],
      }),
    ).toThrow()
    // 真有个名字叫 `*` 的工具:canonical 是 mcp:policy:%2A,只匹配它自己。
    const starTool: ToolPolicySubject = {
      identity: { source: "mcp", origin: "policy", name: "*" },
      authority: { kind: "not-asserted" },
    }
    const starSelector = { level: "tool", canonical: "mcp:policy:%2A" } as const
    expect(selectorMatches(starSelector, starTool)).toBe(true)
    expect(selectorMatches(starSelector, mcpSubject())).toBe(false)
  })

  test("S3 service selector 结构匹配一台 server 的全部工具,不匹配别台", () => {
    const service = { level: "service", source: "mcp", origin: "policy" } as const
    expect(selectorMatches(service, mcpSubject())).toBe(true)
    expect(
      selectorMatches(service, {
        identity: { source: "mcp", origin: "policy", name: "free_action" },
        authority: { kind: "not-asserted" },
      }),
    ).toBe(true)
    expect(
      selectorMatches(service, {
        identity: { source: "mcp", origin: "other", name: "paid_action" },
        authority: { kind: "not-asserted" },
      }),
    ).toBe(false)
    expect(toPermissionAction("enabled")).toBe("allow")
    expect(toPermissionAction("ask")).toBe("ask")
    expect(toPermissionAction("disabled")).toBe("deny")
  })
})

// ═══ R. 纯合成核(§4)═══════════════════════════════════════════════════════
describe("resolveToolPolicy", () => {
  const resolve = resolveToolPolicy

  test("R1 默认:本地 enabled;Alpha Cloud / 第三方 MCP / plugin 一律 ask", () => {
    const builtin = resolve({
      subject: { identity: { source: "builtin", origin: "", name: "write" }, authority: { kind: "not-asserted" } },
      caps: NO_CAPS,
      user: NO_USER,
    })
    expect(builtin).toEqual({ state: "enabled", action: "allow", reason: { kind: "default", class: "builtin" } })
    expect(resolve({ subject: cloudSubject(DIGEST_A), caps: NO_CAPS, user: NO_USER }).state).toBe("ask")
    expect(resolve({ subject: mcpSubject(), caps: NO_CAPS, user: NO_USER }).state).toBe("ask")
    expect(
      resolve({
        subject: { identity: { source: "plugin", origin: "probe", name: "default" }, authority: { kind: "not-asserted" } },
        caps: NO_CAPS,
        user: NO_USER,
      }).state,
    ).toBe("ask")
  })

  // #1578 AC2(策略半边):删掉 classifyTool 的 codepuppy-bundled 分支 ⇒ 分类回到 third-party-mcp,当场红;
  // 插件即使带同一种 authority 也仍是 plugin(AC5「保留插件来源与原权限默认」)。
  test("#1578 AC2: an codepuppy-bundled document tool is class codepuppy-bundled and asks by default; a bundled plugin tool stays plugin", () => {
    expect(classifyTool(bundledSubject())).toBe("codepuppy-bundled")
    expect(classDefaultState("codepuppy-bundled")).toBe("ask")
    expect(resolve({ subject: bundledSubject(DIGEST_A), caps: NO_CAPS, user: NO_USER })).toEqual({
      state: "ask",
      action: "ask",
      reason: { kind: "default", class: "codepuppy-bundled" },
    })
    const bundledPlugin: ToolPolicySubject = {
      identity: { source: "plugin", origin: "/Applications/Code Puppy.app/Contents/Resources/codepuppy-ext/plugin.js", name: "codepuppy_ping" },
      authority: { kind: "codepuppy-bundled", bindingId: "plugin:codepuppy-ext", evidenceDigest: DIGEST_B },
    }
    expect(classifyTool(bundledPlugin)).toBe("plugin")
    expect(resolve({ subject: bundledPlugin, caps: NO_CAPS, user: NO_USER }).reason).toEqual({ kind: "default", class: "plugin" })
    // 用户的「Code Puppy 文档工具」整组设置只作用于这一类。
    const records: ToolPolicyRecord[] = [{ selector: { level: "class", class: "codepuppy-bundled" }, state: "disabled" }]
    expect(resolve({ subject: bundledSubject(), caps: NO_CAPS, user: { status: "ok", records } }).state).toBe("disabled")
    expect(resolve({ subject: mcpSubject(), caps: NO_CAPS, user: { status: "ok", records } }).state).toBe("ask")
  })

  test("R2 同层优先级:exact tool > service > class(§3)", () => {
    const classRec: ToolPolicyRecord = { selector: { level: "class", class: "third-party-mcp" }, state: "disabled" }
    const serviceRec: ToolPolicyRecord = {
      selector: { level: "service", source: "mcp", origin: "policy" },
      state: "enabled",
      bindingDigest: DIGEST_A,
    }
    const toolRec: ToolPolicyRecord = { selector: { level: "tool", canonical: ID_MCP_PAID }, state: "ask" }
    const subject = mcpSubject(DIGEST_A)
    const all = resolve({ subject, caps: NO_CAPS, user: { status: "ok", records: [classRec, serviceRec, toolRec] } })
    expect(all).toEqual({ state: "ask", action: "ask", reason: { kind: "user", level: "tool" } })
    const noTool = resolve({ subject, caps: NO_CAPS, user: { status: "ok", records: [classRec, serviceRec] } })
    expect(noTool).toEqual({ state: "enabled", action: "allow", reason: { kind: "user", level: "service" } })
    const onlyClass = resolve({ subject, caps: NO_CAPS, user: { status: "ok", records: [classRec] } })
    expect(onlyClass).toEqual({ state: "disabled", action: "deny", reason: { kind: "user", level: "class" } })
  })

  test("R3 managed cap deny 压过用户 enabled(cap 在第 1 步,§4)", () => {
    const result = resolve({
      subject: mcpSubject(DIGEST_A),
      caps: { managed: { status: "ok", ruleset: [{ action: ID_MCP_PAID, resource: "*", effect: "deny" }], sources: ["managed"] } },
      user: {
        status: "ok",
        records: [{ selector: { level: "tool", canonical: ID_MCP_PAID }, state: "enabled", bindingDigest: DIGEST_A }],
      },
    })
    expect(result).toEqual({ state: "disabled", action: "deny", reason: { kind: "cap-managed" } })
  })

  test("R4 entitlement 缺失/deny 与 sovereignty/kill-switch deny 都是 cap ⇒ disabled", () => {
    expect(resolve({ subject: cloudSubject(DIGEST_A), caps: { ...NO_CAPS, entitlement: "missing" }, user: NO_USER }))
      .toEqual({ state: "disabled", action: "deny", reason: { kind: "cap-entitlement", verdict: "missing" } })
    expect(resolve({ subject: cloudSubject(DIGEST_A), caps: { ...NO_CAPS, entitlement: "deny" }, user: NO_USER }).state).toBe("disabled")
    expect(
      resolve({ subject: mcpSubject(), caps: { ...NO_CAPS, hardDeny: ["web-search-kill-switch"] }, user: NO_USER }),
    ).toEqual({ state: "disabled", action: "deny", reason: { kind: "cap-hard-deny", sources: ["web-search-kill-switch"] } })
    // entitlement allow 只是必要条件,不产生 enabled:默认仍是 ask。
    expect(resolve({ subject: cloudSubject(DIGEST_A), caps: { ...NO_CAPS, entitlement: "allow" }, user: NO_USER }).state).toBe("ask")
  })

  test("R6 binding guard:service/tool enabled 只在 digest 逐字相等时生效,变了/缺了回 ask(§5)", () => {
    const record: ToolPolicyRecord = {
      selector: { level: "service", source: "mcp", origin: "policy" },
      state: "enabled",
      bindingDigest: DIGEST_A,
    }
    const user = { status: "ok", records: [record] } as const
    expect(resolve({ subject: mcpSubject(DIGEST_A), caps: NO_CAPS, user }).state).toBe("enabled")
    expect(resolve({ subject: mcpSubject(DIGEST_B), caps: NO_CAPS, user })).toEqual({
      state: "ask",
      action: "ask",
      reason: { kind: "binding-changed", level: "service" },
    })
    // 当前 binding 不可得 ⇒ 不放行(fail-closed),回 ask。
    expect(resolve({ subject: mcpSubject(undefined), caps: NO_CAPS, user }).state).toBe("ask")
    // disabled 不因 rebind 失效:收紧是安全方向。
    const disabledRec: ToolPolicyRecord = { selector: { level: "service", source: "mcp", origin: "policy" }, state: "disabled" }
    expect(resolve({ subject: mcpSubject(DIGEST_B), caps: NO_CAPS, user: { status: "ok", records: [disabledRec] } }).state).toBe("disabled")
  })

  test("R7 Alpha Cloud 的 binding 就是 verified evidenceDigest:换了证据 ⇒ 回 ask", () => {
    const record: ToolPolicyRecord = {
      selector: { level: "tool", canonical: "mcp:alpha:web_search" },
      state: "enabled",
      bindingDigest: DIGEST_A,
    }
    const user = { status: "ok", records: [record] } as const
    expect(resolve({ subject: cloudSubject(DIGEST_A), caps: NO_CAPS, user }).state).toBe("enabled")
    expect(resolve({ subject: cloudSubject(DIGEST_B), caps: NO_CAPS, user })).toEqual({
      state: "ask",
      action: "ask",
      reason: { kind: "binding-changed", level: "tool" },
    })
  })

  test("R8/R9/R10/R11 fail-closed 族:非法 identity / quarantine / managed unreadable / 冲突记录 ⇒ disabled", () => {
    expect(
      resolve({
        subject: { identity: { source: "mcp", origin: "x", name: "" }, authority: { kind: "not-asserted" } },
        caps: NO_CAPS,
        user: NO_USER,
      }).reason.kind,
    ).toBe("invalid-identity")
    expect(
      resolve({ subject: mcpSubject(), caps: NO_CAPS, user: { status: "quarantined", reason: "broken" } }),
    ).toEqual({ state: "disabled", action: "deny", reason: { kind: "quarantine", detail: "broken" } })
    expect(
      resolve({
        subject: mcpSubject(),
        caps: { managed: { status: "unreadable", reason: "corrupt", source: "s" } },
        user: NO_USER,
      }).reason.kind,
    ).toBe("cap-managed-unreadable")
    const dup: ToolPolicyRecord = { selector: { level: "tool", canonical: ID_MCP_PAID }, state: "enabled", bindingDigest: DIGEST_A }
    const conflicting = resolve({
      subject: mcpSubject(DIGEST_A),
      caps: NO_CAPS,
      user: { status: "ok", records: [dup, { ...dup, state: "disabled", bindingDigest: undefined }] },
    })
    expect(conflicting.state).toBe("disabled")
    expect(conflicting.reason.kind).toBe("quarantine")
  })
})

// ═══ T. versioned 持久化 + quarantine(§5)═══════════════════════════════════
describe("policy store", () => {
  test("T1 roundtrip + 原子写 + 分区文件名不含明文", () => {
    const dir = tmpdir("codepuppy-policy-t1-")
    const records: ToolPolicyRecord[] = [
      { selector: { level: "tool", canonical: ID_MCP_PAID }, state: "disabled" },
      { selector: { level: "class", class: "plugin" }, state: "enabled" },
    ]
    savePolicyDocument(dir, PARTITION, records)
    const file = policyFilePath(dir, PARTITION)
    expect(path.basename(file)).toMatch(/^[0-9a-f]{64}\.json$/)
    expect(path.basename(file)).not.toContain("acct-1")
    const loaded = loadPolicyDocument(dir, PARTITION)
    expect(loaded.status).toBe("ok")
    if (loaded.status !== "ok") return
    expect(loaded.doc.version).toBe(1)
    expect(loaded.doc.records).toEqual(records)
    // 没有半截 tmp 残留。
    expect(fs.readdirSync(dir).filter((name) => name.includes(".tmp-"))).toEqual([])
  })

  // #1578 AC4(方案 §2.6-7 数据回退):回退只撤分类、铸造与设置组,schema 的 `codepuppy-bundled` 字面量保留。一份当时写下
  // `class:"codepuppy-bundled"` 记录的文档(按落盘形状手写)照常 `ok`;撤回后同一工具铸成 not-asserted ⇒ 记录不匹配、
  // 吃第三方默认,不触发整份 quarantine。删掉 ToolClass 里的这个字面量 ⇒ 这里 quarantined,当场红。
  test("#1578 AC4: with classification withdrawn but the literal kept, a document holding a class codepuppy-bundled record loads ok", () => {
    const dir = tmpdir("codepuppy-policy-1578-")
    const file = policyFilePath(dir, PARTITION)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        partition: PARTITION,
        records: [
          { selector: { level: "class", class: "codepuppy-bundled" }, state: "enabled" },
          { selector: { level: "tool", canonical: ID_MCP_PAID }, state: "disabled" },
        ],
      }),
    )
    const loaded = loadPolicyDocument(dir, PARTITION)
    expect(loaded.status).toBe("ok")
    if (loaded.status !== "ok") return
    const withdrawn: ToolPolicySubject = {
      identity: { source: "mcp", origin: "codepuppy-word", name: "read_docx" },
      authority: { kind: "not-asserted" },
      bindingDigest: DIGEST_A,
    }
    expect(
      resolveToolPolicy({ subject: withdrawn, caps: NO_CAPS, user: { status: "ok", records: loaded.doc.records } }),
    ).toEqual({ state: "ask", action: "ask", reason: { kind: "default", class: "third-party-mcp" } })
    // 同一份文档里的其它记录照常生效(不是整份被忽略)。
    expect(
      resolveToolPolicy({ subject: mcpSubject(), caps: NO_CAPS, user: { status: "ok", records: loaded.doc.records } }).state,
    ).toBe("disabled")
  })

  test("T2 文件不存在 = 首次使用(absent),不是错误", () => {
    expect(loadPolicyDocument(tmpdir("codepuppy-policy-t2-"), PARTITION)).toEqual({ status: "absent" })
  })

  test("T3 坏文档整份 quarantine:损坏 JSON / 未知版本 / 部分非法记录 / 分区不符 / selector 重复", () => {
    const dir = tmpdir("codepuppy-policy-t3-")
    const file = policyFilePath(dir, PARTITION)
    fs.mkdirSync(path.dirname(file), { recursive: true })

    fs.writeFileSync(file, "{ not json")
    expect(loadPolicyDocument(dir, PARTITION).status).toBe("quarantined")

    fs.writeFileSync(file, JSON.stringify({ version: 2, partition: PARTITION, records: [] }))
    expect(loadPolicyDocument(dir, PARTITION).status).toBe("quarantined")

    // 一条非法(service enabled 缺 bindingDigest)⇒ 整份坏,不是丢那一条。
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        partition: PARTITION,
        records: [
          { selector: { level: "tool", canonical: ID_MCP_PAID }, state: "disabled" },
          { selector: { level: "service", source: "mcp", origin: "policy" }, state: "enabled" },
        ],
      }),
    )
    expect(loadPolicyDocument(dir, PARTITION).status).toBe("quarantined")

    // 把别的分区的文件拷过来 ⇒ 文档体内分区核不上 ⇒ quarantine。
    const other = { account: "acct-2", workspace: "ws-1" }
    savePolicyDocument(dir, other, [])
    fs.copyFileSync(policyFilePath(dir, other), file)
    const stolen = loadPolicyDocument(dir, PARTITION)
    expect(stolen.status).toBe("quarantined")

    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        partition: PARTITION,
        records: [
          { selector: { level: "tool", canonical: ID_MCP_PAID }, state: "disabled" },
          { selector: { level: "tool", canonical: ID_MCP_PAID }, state: "ask" },
        ],
      }),
    )
    expect(loadPolicyDocument(dir, PARTITION).status).toBe("quarantined")
  })

  test("T4 reset:坏文件挪去带时间戳备份(可恢复),加载回到 absent(批准默认)", () => {
    const dir = tmpdir("codepuppy-policy-t4-")
    const file = policyFilePath(dir, PARTITION)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, "{ broken")
    const { backup } = resetPolicyDocument(dir, PARTITION)
    expect(backup).toBeDefined()
    expect(fs.existsSync(backup!)).toBe(true)
    expect(fs.readFileSync(backup!, "utf8")).toBe("{ broken")
    expect(loadPolicyDocument(dir, PARTITION)).toEqual({ status: "absent" })
  })

  test("T5 写入前校验:selector 重复与非法记录在写入者手里 loud fail,不落盘", () => {
    const dir = tmpdir("codepuppy-policy-t5-")
    const rec: ToolPolicyRecord = { selector: { level: "tool", canonical: ID_MCP_PAID }, state: "disabled" }
    expect(() => savePolicyDocument(dir, PARTITION, [rec, { ...rec, state: "ask" }])).toThrow()
    expect(() =>
      savePolicyDocument(dir, PARTITION, [
        { selector: { level: "service", source: "mcp", origin: "policy" }, state: "enabled" } as ToolPolicyRecord,
      ]),
    ).toThrow()
    expect(loadPolicyDocument(dir, PARTITION)).toEqual({ status: "absent" })
  })

  test("T6 分区隔离:账户 A 的记录不出现在账户 B / 别的工作区的文档里", () => {
    const dir = tmpdir("codepuppy-policy-t6-")
    savePolicyDocument(dir, PARTITION, [{ selector: { level: "tool", canonical: ID_MCP_PAID }, state: "enabled", bindingDigest: DIGEST_A }])
    expect(loadPolicyDocument(dir, { account: "acct-2", workspace: "ws-1" })).toEqual({ status: "absent" })
    expect(loadPolicyDocument(dir, { account: "acct-1", workspace: "ws-2" })).toEqual({ status: "absent" })
    const own = loadPolicyDocument(dir, PARTITION)
    expect(own.status).toBe("ok")
  })
})

// ═══ M. managed cap 负向闸(本票必修)══════════════════════════════════════════
describe("managed cap (OpenCode 2 managed documents)", () => {
  function writeManaged(dir: string, document: Record<string, unknown>, file = "opencode.json") {
    fs.writeFileSync(path.join(dir, file), JSON.stringify(document))
  }

  test("M1 a managed deny is a cap even when the merged agent ruleset ends with a project allow (why the reader exists)", async () => {
    const systemDir = tmpdir("codepuppy-managed-system-")
    writeManaged(systemDir, { permissions: [{ action: ID_MCP_PAID, resource: "*", effect: "deny" }] })
    const result = await readManagedPolicy({ systemDir, preferences: null })
    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    expect(managedCapDenies(ID_MCP_PAID, result.ruleset)).toBe(true)
    const effective = resolveToolPolicy({
      subject: mcpSubject(DIGEST_A),
      caps: { managed: result },
      user: { status: "ok", records: [{ selector: { level: "tool", canonical: ID_MCP_PAID }, state: "enabled", bindingDigest: DIGEST_A }] },
    })
    expect(effective).toEqual({ state: "disabled", action: "deny", reason: { kind: "cap-managed" } })
  })

  test("M2 the legacy v1 `permission` object in a managed document is still read (OpenCode 2 normalizes it too)", async () => {
    const systemDir = tmpdir("codepuppy-managed-system-")
    writeManaged(systemDir, { permission: { [ID_MCP_PAID]: "deny", "mcp:extra:*": { "*": "deny" } } })
    const result = await readManagedPolicy({ systemDir, preferences: null })
    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    expect(managedCapDenies(ID_MCP_PAID, result.ruleset)).toBe(true)
    expect(managedCapDenies("mcp:extra:tool", result.ruleset)).toBe(true)
    expect(managedCapDenies("mcp:other:tool", result.ruleset)).toBe(false)
  })

  test("M3 a managed allow only means the ceiling does not block: it never widens a user record", async () => {
    const systemDir = tmpdir("codepuppy-managed-system-")
    writeManaged(systemDir, { permissions: [{ action: ID_MCP_PAID, resource: "*", effect: "allow" }] })
    const result = await readManagedPolicy({ systemDir, preferences: null })
    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    expect(managedCapDenies(ID_MCP_PAID, result.ruleset)).toBe(false)
    const effective = resolveToolPolicy({
      subject: mcpSubject(),
      caps: { managed: result },
      user: { status: "ok", records: [{ selector: { level: "tool", canonical: ID_MCP_PAID }, state: "disabled" }] },
    })
    expect(effective.state).toBe("disabled")
  })

  test("M4 a corrupt managed file, or a JSONC one this reader cannot parse, makes the whole layer unreadable ⇒ disabled", async () => {
    const corrupt = tmpdir("codepuppy-managed-system-")
    fs.writeFileSync(path.join(corrupt, "opencode.json"), "{ broken")
    const result = await readManagedPolicy({ systemDir: corrupt, preferences: null })
    expect(result.status).toBe("unreadable")
    const effective = resolveToolPolicy({ subject: mcpSubject(), caps: { managed: result }, user: NO_USER })
    expect(effective.state).toBe("disabled")
    expect(effective.reason.kind).toBe("cap-managed-unreadable")

    const jsonc = tmpdir("codepuppy-managed-system-")
    fs.writeFileSync(path.join(jsonc, "opencode.jsonc"), '{ // comment\n "permissions": [] }')
    expect((await readManagedPolicy({ systemDir: jsonc, preferences: null })).status).toBe("unreadable")
  })

  test("M5 an MDM preferences deny is a cap too (highest-priority source)", async () => {
    const systemDir = tmpdir("codepuppy-managed-system-")
    writeManaged(systemDir, {})
    const result = await readManagedPolicy({
      systemDir,
      preferences: { source: "mobileconfig:test", text: JSON.stringify({ permissions: [{ action: ID_MCP_PAID, resource: "*", effect: "deny" }] }) },
    })
    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    expect(managedCapDenies(ID_MCP_PAID, result.ruleset)).toBe(true)
  })

  test("M6 the production system directory is a platform constant (independent literal anchor)", () => {
    expect(systemManagedPolicyDir("darwin")).toBe("/Library/Application Support/opencode")
    expect(systemManagedPolicyDir("linux")).toBe("/etc/opencode")
  })
})

describe("store service (what registerPolicy and the RPC share)", () => {
  const store = (baseDir: string, account = "acct-service", workspace = "ws-service") =>
    createToolPolicyStore({ baseDir, account: () => account, workspace: () => workspace, managed: async () => ({ status: "ok", ruleset: [], sources: [] }) })
  const resolveWith = async (policy: ReturnType<typeof store>, subject: ToolPolicySubject) => {
    const snapshot = await policy.snapshot()
    return resolveToolPolicy({ subject, caps: { managed: snapshot.managed }, user: snapshot.user })
  }

  test("V1 the partition comes from the account and the workspace; setRecord takes effect; removeRecord returns to default", async () => {
    const policy = store(tmpdir("codepuppy-policy-service-"))
    expect((await policy.snapshot()).partition).toEqual({ account: "acct-service", workspace: "ws-service" })
    expect((await resolveWith(policy, mcpSubject())).state).toBe("ask")
    await policy.setRecord({ selector: { level: "tool", canonical: ID_MCP_PAID }, state: "disabled" })
    expect(await resolveWith(policy, mcpSubject())).toEqual({ state: "disabled", action: "deny", reason: { kind: "user", level: "tool" } })
    await policy.removeRecord({ level: "tool", canonical: ID_MCP_PAID })
    expect((await resolveWith(policy, mcpSubject())).state).toBe("ask")
  })

  // Review R1 #9 (K5): a record saved under the v1 name `builtin::bash` is replaced and removed through `builtin::shell`.
  test("V1b with a v1-name record on disk, writing the new name leaves one record and removing it leaves none", async () => {
    const baseDir = tmpdir("codepuppy-policy-service-")
    const partition = { account: "acct-service", workspace: "ws-service" }
    savePolicyDocument(baseDir, partition, [{ selector: { level: "tool", canonical: "builtin::bash" }, state: "disabled" }])
    const policy = store(baseDir)
    await policy.setRecord({ selector: { level: "tool", canonical: "builtin::shell" }, state: "ask" })
    const written = loadPolicyDocument(baseDir, partition)
    expect(written.status === "ok" ? written.doc.records : written).toEqual([{ selector: { level: "tool", canonical: "builtin::shell" }, state: "ask" }])
    const snapshot = await policy.snapshot()
    expect(snapshot.user).toEqual({ status: "ok", records: [{ selector: { level: "tool", canonical: "builtin::shell" }, state: "ask" }] })
    savePolicyDocument(baseDir, partition, [{ selector: { level: "tool", canonical: "builtin::bash" }, state: "disabled" }])
    await policy.removeRecord({ level: "tool", canonical: "builtin::shell" })
    const removed = loadPolicyDocument(baseDir, partition)
    expect(removed.status === "ok" ? removed.doc.records : removed).toEqual([])
  })

  test("V2 a quarantined document refuses writes until reset; resolution stays disabled meanwhile", async () => {
    const baseDir = tmpdir("codepuppy-policy-service-")
    const policy = store(baseDir)
    const file = policyFilePath(baseDir, { account: "acct-service", workspace: "ws-service" })
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, "{ broken")
    expect((await resolveWith(policy, mcpSubject())).reason.kind).toBe("quarantine")
    const write = await policy.setRecord({ selector: { level: "tool", canonical: ID_MCP_PAID }, state: "ask" }).catch((error) => error)
    expect(write).toBeInstanceOf(ToolPolicyWriteError)
    expect((write as ToolPolicyWriteError).kind).toBe("quarantined")
    expect((await policy.reset()).backup).toBeDefined()
    expect((await resolveWith(policy, mcpSubject())).state).toBe("ask")
    await policy.setRecord({ selector: { level: "tool", canonical: ID_MCP_PAID }, state: "ask" })
    expect((await resolveWith(policy, mcpSubject())).reason).toEqual({ kind: "user", level: "tool" })
  })

  test("VI1 the account partition follows CODEPUPPY_POLICY_ACCOUNT: account B never reads account A's enable", async () => {
    const baseDir = tmpdir("codepuppy-policy-service-")
    let account = "anonymous"
    const policy = createToolPolicyStore({ baseDir, account: () => account, workspace: () => "ws", managed: async () => ({ status: "ok", ruleset: [], sources: [] }) })
    const enable = { selector: { level: "tool", canonical: ID_MCP_PAID }, state: "enabled", bindingDigest: DIGEST_A } as const
    await policy.setRecord(enable)
    expect((await resolveWith(policy, mcpSubject(DIGEST_A))).state).toBe("enabled")
    account = "acct:aaaa"
    expect((await resolveWith(policy, mcpSubject(DIGEST_A))).state).toBe("ask")
    await policy.setRecord(enable)
    account = "acct:bbbb"
    expect((await resolveWith(policy, mcpSubject(DIGEST_A))).state).toBe("ask")
    account = "acct:aaaa"
    expect((await resolveWith(policy, mcpSubject(DIGEST_A))).state).toBe("enabled")
  })
})

test("literal anchors match the production encoding", () => {
  expect(selectorKey({ level: "tool", canonical: ID_MCP_PAID })).toBe(JSON.stringify(["tool", ID_MCP_PAID]))
  expect(mcpBindingDigest("policy", { type: "remote", url: "https://x.test/mcp" })).toMatch(/^sha256:[0-9a-f]{64}$/)
  const base = mcpBindingDigest("policy", { type: "remote", url: "https://x.test/mcp" })
  const withSecret = mcpBindingDigest("policy", { type: "remote", url: "https://x.test/mcp", headers: { authorization: "Bearer s3cret" } } as never)
  const rebound = mcpBindingDigest("policy", { type: "remote", url: "https://evil.test/mcp" })
  expect(withSecret).toBe(base)
  expect(rebound).not.toBe(base)
})

// #1644: grants are partitioned per folder outside git and per project inside git; Settings and the executor share it.
const folderGrant = { selector: { level: "tool", canonical: "mcp:dbhub-readonly:execute_sql" }, state: "enabled", bindingDigest: DIGEST_A } as const
const folderSubject: ToolPolicySubject = {
  identity: { source: "mcp", origin: "dbhub-readonly", name: "execute_sql" },
  authority: { kind: "not-asserted" },
  bindingDigest: DIGEST_A,
}
const location = (directory: string, project: string) =>
  ({ directory, project: { id: project, directory, canonical: directory } }) as never

describe("#1644 grant partitions", () => {
  const storeFor = (baseDir: string, at: ReturnType<typeof location>) =>
    createToolPolicyStore({ baseDir, account: () => "acct-service", workspace: () => policyWorkspace(at), managed: async () => ({ status: "ok", ruleset: [], sources: [] }) })
  const state = async (policy: ReturnType<typeof storeFor>) => {
    const snapshot = await policy.snapshot()
    return resolveToolPolicy({ subject: folderSubject, caps: { managed: snapshot.managed }, user: snapshot.user }).state
  }

  test("AC1 folders outside git isolate grants; the old global partition stays unread", async () => {
    const baseDir = tmpdir("codepuppy-policy-1644-")
    savePolicyDocument(baseDir, { account: "acct-service", workspace: "global" }, [folderGrant])
    const a = storeFor(baseDir, location("/work/a", "global"))
    const b = storeFor(baseDir, location("/work/b", "global"))
    expect(await state(a)).toBe("ask")
    await a.setRecord(folderGrant)
    expect((await a.snapshot()).partition.workspace).toBe("/work/a")
    expect(await state(a)).toBe("enabled")
    expect(await state(b)).toBe("ask")
    expect(loadPolicyDocument(baseDir, { account: "acct-service", workspace: "global" })).toMatchObject({ status: "ok", doc: { records: [folderGrant] } })
  })

  test("AC2 subdirectories of one git project share its grant; different git projects stay isolated", async () => {
    const baseDir = tmpdir("codepuppy-policy-1644-")
    const parent = storeFor(baseDir, location("/repo/a", "prj_a"))
    const child = storeFor(baseDir, location("/repo/a/child", "prj_a"))
    const other = storeFor(baseDir, location("/repo/b", "prj_b"))
    await parent.setRecord(folderGrant)
    expect(await state(child)).toBe("enabled")
    expect(await state(other)).toBe("ask")
    expect((await child.snapshot()).partition).toEqual((await parent.snapshot()).partition)
    expect((await parent.snapshot()).partition.workspace).toBe("prj_a")
  })

  test("AC3 revoking in one folder's partition leaves another folder's grant", async () => {
    const baseDir = tmpdir("codepuppy-policy-1644-")
    const a = storeFor(baseDir, location("/work/a", "global"))
    const b = storeFor(baseDir, location("/work/b", "global"))
    await a.setRecord(folderGrant)
    await b.setRecord(folderGrant)
    await a.removeRecord(folderGrant.selector)
    expect(await state(a)).toBe("ask")
    expect(await state(b)).toBe("enabled")
  })
})

void [classDefaultState, classifyTool, parseToolPolicyDocument, selectorMatches, toPermissionAction, resetPolicyDocument, PARTITION, cloudSubject, bundledSubject, NO_CAPS, NO_USER]
