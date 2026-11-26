// ADR-041 on OpenCode 2 — tool identity, authority and location as the extension derives them (identity.ts), plus
// pins on the upstream rules the derivation restates (name normalization, rule evaluation) and on upstream behaviour
// a v1 takeover used to supply. Replaces packages/opencode/test/tool/codepuppy-tool-identity.test.ts and
// packages/core/test/codepuppy-tool-identity.test.ts (#1662 L4). Expected identities are hand-written literals.
import { testCloudMcp } from "../../../ui-mac/test-component/codepuppy-bootstrap-fixture"
import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { E, isolate, mcpToolMark } from "./policy-host.cases"
import { evaluate } from "./gate"
import {
  APP_BUILTIN_BINDING_DIGEST,
  authorityForMcp,
  codeModeFacts,
  mcpEffectiveName,
  normalizeToolName,
  packageToolCall,
  toolFacts,
  type IdentityInput,
} from "./identity"
import { displaySnapshot } from "./display"
import { canonicalJsonDigest } from "./store"
import { canonicalToolIdentity } from "../../../schema/src/tool-identity"

isolate()
const core = path.resolve(import.meta.dir, "../../../core")
const runtime = await import(path.join(core, "src/tool/runtime.ts"))
const { Permission } = await import(path.join(core, "src/permission.ts"))
void E

const base = (over: Partial<IdentityInput> = {}): IdentityInput => ({
  early: new Set(["shell", "read", "opencode_list_mcp_resources", "todo"]),
  earlyAmbiguous: false,
  mcp: new Map([
    ["policy", { type: "remote", url: "https://mcp.example.test/policy" } as never],
    ["files", { type: "local", command: ["npx", "files-server"], cwd: "/srv" } as never],
  ]),
  bundled: undefined,
  extOrigin: "/Applications/Code Puppy.app/Contents/Resources/codepuppy-ext/plugin.js",
  ...over,
})

describe("upstream rules the derivation restates", () => {
  test("normalizeToolName / mcpEffectiveName equal OpenCode 2's normalizedName / effectiveName", () => {
    for (const name of ["read_docx", "my.tool", "web search", "ünïcode", "a/b", "ok-1"]) {
      expect(normalizeToolName(name)).toBe(runtime.normalizedName({ name }))
      expect(mcpEffectiveName("my.server", name)).toBe(runtime.effectiveName({ name, options: { namespace: runtime.normalizedName({ name: "my.server" }) } }))
    }
  })

  test("gate.evaluate equals OpenCode 2's Permission.evaluate", () => {
    const rules = [
      { action: "*", resource: "*", effect: "allow" as const },
      { action: "mcp:*", resource: "*", effect: "ask" as const },
      { action: "mcp:policy:paid_action", resource: "*", effect: "deny" as const },
      { action: "edit", resource: "src/*", effect: "deny" as const },
    ]
    for (const [action, resource] of [["mcp:policy:paid_action", "*"], ["mcp:other:x", "*"], ["builtin::read", "*"], ["edit", "src/a.ts"], ["edit", "docs/a.md"], ["unmatched", "x"]] as const)
      expect(evaluate(action, resource, rules)).toEqual(Permission.evaluate(action, resource, rules))
    expect(evaluate("anything", "x", [])).toEqual(Permission.evaluate("anything", "x", []))
    // Several rulesets flatten in order, so a later ruleset's match wins (agent rules, then session rules).
    const session = [{ action: "edit", resource: "src/*", effect: "allow" as const }]
    expect(evaluate("edit", "src/a.ts", rules, session)).toEqual(Permission.evaluate("edit", "src/a.ts", rules, session))
  })
})

describe("identity derivation", () => {
  test("an MCP tool: config key as origin, remote tool name, de-secreted binding, remote location and transport", () => {
    const facts = toolFacts({ id: "policy_paid_action", name: "paid_action", options: { namespace: "policy" }, ...mcpToolMark("policy", "paid_action") }, base())
    expect(canonicalToolIdentity(facts.identity)).toBe("mcp:policy:paid_action")
    expect(facts.bindingDigest).toBe(canonicalJsonDigest({ kind: "mcp-remote", name: "policy", url: "https://mcp.example.test/policy" }))
    expect(facts.location).toEqual({ kind: "remote", host: "mcp.example.test" })
    expect(facts.transport).toEqual({ kind: "mcp-remote", url: "https://mcp.example.test/policy" })
    expect(facts.authority).toEqual({ kind: "not-asserted" })
  })

  test("a local MCP tool: local location, command transport, binding over command + cwd", () => {
    const facts = toolFacts({ id: "files_list", name: "list", options: { namespace: "files" }, ...mcpToolMark("files", "list") }, base())
    expect(canonicalToolIdentity(facts.identity)).toBe("mcp:files:list")
    expect(facts.location).toEqual({ kind: "local" })
    expect(facts.transport).toEqual({ kind: "mcp-local", command: ["npx", "files-server"] })
    expect(facts.bindingDigest).toBe(canonicalJsonDigest({ kind: "mcp-local", name: "files", command: ["npx", "files-server"], cwd: "/srv" }))
  })

  test("the MCP rule wins over the early registry (a server whose tools registered before the extension is still MCP)", () => {
    const facts = toolFacts({ id: "policy_paid_action", name: "paid_action", options: { namespace: "policy" }, ...mcpToolMark("policy", "paid_action") }, base({ early: new Set(["policy_paid_action"]) }))
    expect(facts.identity.source).toBe("mcp")
  })

  test("a tool in the early registry is a builtin with the constant application binding and local location", () => {
    const facts = toolFacts({ id: "shell", name: "shell" }, base())
    expect(canonicalToolIdentity(facts.identity)).toBe("builtin::shell")
    expect(facts.bindingDigest).toBe(APP_BUILTIN_BINDING_DIGEST)
    expect(facts.location).toEqual({ kind: "local" })
  })

  test("the todo tool the injected flag turns on is a builtin, not an unknown identity", () => {
    expect(canonicalToolIdentity(toolFacts({ id: "todo", name: "todo" }, base()).identity)).toBe("builtin::todo")
  })

  test("the MCP resource tools keep the identity v1 gave them, so saved records keep matching", () => {
    const facts = toolFacts({ id: "opencode_list_mcp_resources", name: "list_mcp_resources", options: { namespace: "opencode" } }, base())
    expect(canonicalToolIdentity(facts.identity)).toBe("host::list_mcp_resources")
  })

  test("early tools become plugin tools of unknown origin when a non-builtin plugin activated before the extension", () => {
    const facts = toolFacts({ id: "shell", name: "shell" }, base({ earlyAmbiguous: true }))
    expect(canonicalToolIdentity(facts.identity)).toBe("plugin::shell")
    expect(facts.bindingDigest).toBeUndefined()
  })

  test("a tool registered after the extension and not in its manifest is a plugin tool of unknown origin", () => {
    const facts = toolFacts({ id: "browser_open", name: "browser_open" }, base())
    expect(canonicalToolIdentity(facts.identity)).toBe("plugin::browser_open")
    expect(facts.authority).toEqual({ kind: "not-asserted" })
  })

  test("the Code Mode runner (never registered) is the builtin execute", () => {
    expect(canonicalToolIdentity(codeModeFacts().identity)).toBe("builtin::execute")
  })
})

describe("authority minting (ADR-041 §5)", () => {
  // `#1698`:治理云 MCP 的名字与定义来自启动文档(main 用 materializeCloudMcpConfig 写的同一形状)
  const cloudMcp = testCloudMcp("https://cloud.codepuppy.test/mcp", "/tmp/token", "codepuppy-cloud")
  const cloudDef = cloudMcp.definition

  test("the exact verified cloud definition mints codepuppy-cloud with a sha256 evidence digest", () => {
    const authority = authorityForMcp("codepuppy-cloud", cloudDef as never, cloudMcp, undefined)
    expect(authority).toMatchObject({ kind: "codepuppy-cloud", bindingId: "mcp:codepuppy-cloud" })
    expect((authority as { evidenceDigest: string }).evidenceDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  test("the engine's empty merged timeout (OpenCode 2 adds `timeout: {}`) still mints; any real difference, a set timeout included, does not", () => {
    expect(authorityForMcp("codepuppy-cloud", { ...cloudDef, timeout: {} } as never, cloudMcp, undefined)).toEqual(authorityForMcp("codepuppy-cloud", cloudDef as never, cloudMcp, undefined))
    expect(authorityForMcp("codepuppy-cloud", { ...cloudDef, timeout: { execution: 1 } } as never, cloudMcp, undefined)).toEqual({ kind: "not-asserted" })
    expect(authorityForMcp("codepuppy-cloud", { ...cloudDef, timeout: {}, codemode: true } as never, cloudMcp, undefined)).toEqual({ kind: "not-asserted" })
  })

  test("a look-alike (same URL, other key; or same key, other URL) is not asserted", () => {
    expect(authorityForMcp("other-name", cloudDef as never, cloudMcp, undefined)).toEqual({ kind: "not-asserted" })
    expect(authorityForMcp("codepuppy-cloud", { ...cloudDef, url: "https://cloud.codepuppy.test.evil/mcp" } as never, cloudMcp, undefined)).toEqual({ kind: "not-asserted" })
  })

  const office = (() => {
    const resources = fs.mkdtempSync(path.join(os.tmpdir(), "codepuppy-office-"))
    const dir = path.join(resources, "office-mcp")
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, "server.py"), "print('office')\n")
    const sha = createHash("sha256").update(fs.readFileSync(path.join(dir, "server.py"))).digest("hex")
    const manifest = path.join(dir, "tools.json")
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        serverSha256: sha,
        formats: { word: { command: ["{codepuppyResources}/office-runtime/bin/python3", "{codepuppyResources}/office-mcp/server.py", "word"], tools: [{ name: "read_docx" }] } },
      }),
    )
    const command = [`${resources}/office-runtime/bin/python3`, `${resources}/office-mcp/server.py`, "word"]
    return { manifest, command, dir }
  })()

  test("the exact bundled Office command next to the attested server.py mints codepuppy-bundled", () => {
    const authority = authorityForMcp("codepuppy-word", { type: "local", command: office.command } as never, undefined, office.manifest)
    expect(authority).toMatchObject({ kind: "codepuppy-bundled", bindingId: "mcp:codepuppy-word" })
  })

  test("an extra token, or a server.py the manifest was not exported from, proves nothing", () => {
    expect(authorityForMcp("codepuppy-word", { type: "local", command: [...office.command, "--debug"] } as never, undefined, office.manifest)).toEqual({ kind: "not-asserted" })
    const tampered = fs.mkdtempSync(path.join(os.tmpdir(), "codepuppy-office-"))
    fs.cpSync(path.dirname(office.dir), tampered, { recursive: true })
    fs.writeFileSync(path.join(tampered, "office-mcp", "server.py"), "print('tampered')\n")
    const command = office.command.map((token) => token.replace(path.dirname(office.dir), tampered))
    expect(authorityForMcp("codepuppy-word", { type: "local", command } as never, undefined, path.join(tampered, "office-mcp", "tools.json"))).toEqual({ kind: "not-asserted" })
  })

  // #1666 Unit E: the shipped manifest (packages/ui-mac/resources/office-mcp) and the command main writes, after this
  // extension's mcp.transform replaced the {workspace} marker with the folder — what the identity actually sees.
  test("the shipped Office command, with {workspace} already replaced by the folder, mints codepuppy-bundled", () => {
    const shipped = path.resolve(import.meta.dir, "../../../ui-mac/resources/office-mcp")
    const resources = fs.mkdtempSync(path.join(os.tmpdir(), "codepuppy-office-shipped-"))
    fs.mkdirSync(path.join(resources, "office-mcp"))
    for (const name of ["server.py", "tools.json"]) fs.copyFileSync(path.join(shipped, name), path.join(resources, "office-mcp", name))
    const manifest = path.join(resources, "office-mcp", "tools.json")
    const template: string[] = JSON.parse(fs.readFileSync(manifest, "utf8")).formats.word.command
    const command = (workspace: string) =>
      template.map((token) => (token === "{workspace}" ? workspace : token.split("{codepuppyResources}").join(resources)))
    expect(authorityForMcp("codepuppy-word", { type: "local", command: command("/Users/someone/project") } as never, undefined, manifest)).toMatchObject({ kind: "codepuppy-bundled" })
    expect(authorityForMcp("codepuppy-word", { type: "local", command: command("relative/project") } as never, undefined, manifest)).toEqual({ kind: "not-asserted" })
  })

  test("the display snapshot is the schema's ToolDisplaySnapshotV1: identity + technicalId + authority + location", () => {
    const facts = toolFacts({ id: "files_list", name: "list", options: { namespace: "files" }, ...mcpToolMark("files", "list") }, base())
    expect(displaySnapshot(facts)).toEqual({
      identity: { source: "mcp", origin: "files", name: "list" },
      technicalId: "files_list",
      authority: { kind: "not-asserted" },
      location: { kind: "local" },
    })
  })
})

// MCP entries use the real engine issuer, including the otherwise unforgeable registration mark.
test("long plugin MCP aliases retain the original definition and case-sensitive tool identity", async () => {
  const { aliasPluginMcpTools } = await import("../plugin-package-tools")
  const server = { hostName: "cloudinary-a123456789", sourceName: "Cloudinary", packageId: "claude:cloudinary" }
  const names = ["get_asset_" + "details_".repeat(8), "Get_asset_" + "details_".repeat(8), "short"]
  const registered = names.map(name => ({ id: mcpEffectiveName(server.hostName, name), name, options: { namespace: server.hostName }, ...mcpToolMark(server.hostName, name) }))
  const definitions = names.map(() => ({ description: "MCP tool", input: { type: "object" } }))
  const tools = Object.fromEntries(registered.map((tool, index) => [tool.id, definitions[index]!]))
  aliasPluginMcpTools(tools, registered, [server])
  expect(Object.keys(tools)).toHaveLength(3)
  expect(Object.keys(tools).every(name => name.length <= 64)).toBe(true)
  expect(tools[registered[0]!.id]).toBeUndefined()
  expect(tools[registered[1]!.id]).toBeUndefined()
  expect(Object.values(tools).filter(value => value === definitions[0])).toHaveLength(1)
  expect(Object.values(tools).filter(value => value === definitions[1])).toHaveLength(1)
  expect(tools[registered[2]!.id]).toBe(definitions[2])
  expect(Object.keys(tools).filter(name => name.length === 64).every(name => /_[a-f0-9]{10}$/.test(name))).toBe(true)
})


test("package hook source names and fields use the verified tool identity", () => {
  // Claude spellings consumed by the pinned hookify pre/post scripts and Convex lint script.
  const input = base({ early: new Set(["write", "edit", "read", "shell"]) })
  for (const [native, source] of [["write", "Write"], ["edit", "Edit"], ["read", "Read"], ["shell", "Bash"]]) {
    const facts = toolFacts({ id: native!, name: native! }, input)
    const value = native === "shell" ? { command: "printf fixture" } : { path: "/project/fixture.ts", oldString: "before", newString: "after", replaceAll: false }
    const result = packageToolCall(facts, value, {}, "claude", "/project")
    expect(result.name).toBe(source)
    expect(result.input).toEqual(native === "shell" ? value : { file_path: "/project/fixture.ts", old_string: "before", new_string: "after", replace_all: false })
    expect(packageToolCall(facts, result.input, {}, "runtime", "/project").input).toEqual(value)
  }
  const mcp = toolFacts({ id: "policy_paid_action", name: "paid_action", options: { namespace: "policy" }, ...mcpToolMark("policy", "paid_action") }, input)
  expect(packageToolCall(mcp, { account: "fixture" }, { "mcp::source-server": "policy" }, "claude", "/project")).toEqual({ name: "mcp__source-server__paid_action", input: { account: "fixture" } })
})


test("Claude hook file paths resolve in the native tool call Location", () => {
  const facts = toolFacts({ id: "write", name: "write" }, base({ early: new Set(["write"]) }))
  expect(packageToolCall(facts, { path: "src/payment.ts", content: "fixture" }, {}, "claude", "/project").input).toEqual({ file_path: "/project/src/payment.ts", content: "fixture" })
})
