// INT-upstream-upgrade-readiness I-03 — upstream configuration behaviours Code Puppy depends on, probed on the real
// engine (engine.cases.ts). Each test name starts with the Code Puppy file that breaks when the behaviour changes.
//
//   P3  Config documents load global → explicit (`config.file`) → project → inline content (core/src/config.ts, the
//       load return order); settings: the later document wins; policies: the first-loaded document wins
//       (core/src/managed-policy.ts). Code Puppy puts factory commands and the provider whitelist in the explicit
//       layer on exactly this order (packages/ui-mac/src/main/engine-explicit-config.ts).
//   P5  A relative `skills` entry resolves against the Location's directory and is watched (core/src/config/plugin/
//       skill.ts `sources()`): each project sees only its own `.codepuppy/skills`, new skills without a restart
//       (packages/ui-mac/src/main/codepuppy-config-injection.ts PROJECT_SKILLS_ENTRY).
//   P10 Each remote MCP registers one OAuth integration: `metadata.source = "mcp"`, `name` = the server name, id
//       `mcp_<sha1(name \0 url)[0:16]>` (core/src/mcp/index.ts register). The adapter finds it by source + name
//       (packages/ui-mac/src/engine-adapter/routes.ts authenticateMcp); stored MCP logins are keyed by the id, so a
//       changed derivation orphans them on upgrade.
//   P11 A higher document replaces a lower document's MCP server of the same name whole, no deep merge
//       (core/src/config/plugin/mcp.ts `servers.set`) — why Code Puppy neutralizes a server with a complete entry
//       (packages/ui-mac/src/main/mcp-default-deny.ts NEUTRALIZED_MCP_SERVER).
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { NEUTRALIZED_MCP_SERVER } from "../../../ui-mac/src/main/mcp-default-deny"
import { startProbeEngine, until, type ProbeEngine } from "./engine.cases"

const command = (layer: string) => ({ template: `probe ${layer}`, description: layer })
const provider = (name: string) => ({
  name,
  package: "@ai-sdk/openai-compatible",
  settings: { baseURL: "http://127.0.0.1:1/v1", apiKey: "x" },
  models: { m: { name: `${name} m` } },
})
const use = (resource: string, effect: "allow" | "deny") => ({ action: "provider.use", resource, effect })
const skill = (dir: string, name: string) => {
  fs.mkdirSync(path.join(dir, name), { recursive: true })
  fs.writeFileSync(path.join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} probe\n---\n\n${name}\n`)
}
const MCP_URL = "http://127.0.0.1:1/mcp"
const integrationID = (name: string, url: string) => "mcp_" + createHash("sha1").update(`${name}\u0000${url}`).digest("hex").slice(0, 16)

let engine: ProbeEngine
let projectA: string
let projectB: string

beforeAll(async () => {
  engine = await startProbeEngine({
    global: {
      commands: { a: command("global"), b: command("global"), c: command("global"), d: command("global") },
      providers: { p1: provider("p1"), p2: provider("p2"), p3: provider("p3") },
      mcp: {
        servers: {
          probe: { type: "remote", url: MCP_URL },
          "probe-twin": { type: "remote", url: MCP_URL },
          replaced: { type: "remote", url: "http://127.0.0.1:1/lower", oauth: false },
          neutralized: { type: "remote", url: "http://127.0.0.1:1/neutralized" },
        },
      },
    },
    explicit: {
      commands: { b: command("explicit"), c: command("explicit"), d: command("explicit") },
      policies: [use("p1", "deny"), use("p2", "allow")],
      skills: ["./.codepuppy/skills"],
    },
    content: {
      commands: { d: command("content") },
      mcp: { servers: { replaced: { type: "remote", url: "http://127.0.0.1:1/upper" }, neutralized: NEUTRALIZED_MCP_SERVER } },
    },
  })
  const projectDocument = (dir: string) =>
    fs.writeFileSync(
      path.join(dir, "opencode.json"),
      JSON.stringify({ commands: { c: command("project"), d: command("project") }, policies: [use("p1", "allow"), use("p2", "deny"), use("p3", "deny")] }),
    )
  projectA = engine.project("a", (dir) => {
    projectDocument(dir)
    skill(path.join(dir, ".codepuppy/skills"), "probe-a")
  })
  projectB = engine.project("b", projectDocument)
}, 60_000)

afterAll(async () => {
  await engine?.close()
})

/** Reads a list route until it contains `marker` and two reads agree (plugins finish activating asynchronously). */
async function settled(route: string, directory: string, key: string, marker: string): Promise<any[]> {
  let previous = ""
  return until(`${route} in ${path.basename(directory)} to list ${marker} and settle`, async () => {
    const response = await engine.call("GET", route, undefined, directory)
    const data = (response.body?.data ?? []) as any[]
    const current = JSON.stringify(data)
    const done = data.some((item) => item[key] === marker) && current === previous
    previous = current
    return done ? data : undefined
  })
}

/** Reads a list route until two reads 300 ms apart agree (for lists that must *not* contain something). */
async function steady(route: string, directory: string): Promise<any[]> {
  let previous: string | undefined
  return until(`${route} in ${path.basename(directory)} to settle`, async () => {
    const data = ((await engine.call("GET", route, undefined, directory)).body?.data ?? []) as any[]
    const current = JSON.stringify(data)
    const done = current === previous
    previous = current
    if (!done) await Bun.sleep(300)
    return done ? data : undefined
  })
}

// ── P3 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const LAYER_WINNERS = { a: "global", b: "explicit", c: "project", d: "content" }

function layerProblems(winners: Record<string, string | undefined>): string[] {
  return Object.entries(LAYER_WINNERS)
    .filter(([name, layer]) => winners[name] !== layer)
    .map(([name, layer]) => `command ${name} came from ${winners[name]}, expected ${layer}`)
}

describe("P3 config layer order", () => {
  test("[packages/ui-mac/src/main/engine-explicit-config.ts] settings: global < explicit < project < inline content, the later document wins", async () => {
    const commands = await settled("/api/command", projectA, "name", "d")
    const winners = Object.fromEntries(commands.filter((item) => item.name in LAYER_WINNERS).map((item) => [item.name, item.description]))
    expect(layerProblems(winners)).toEqual([])
  })

  test("[packages/ui-mac/src/main/engine-explicit-config.ts] policies: the first-loaded document wins (explicit over project, in both directions)", async () => {
    const ids = (await settled("/api/provider", projectA, "id", "p2")).map((item) => item.id)
    // p1: explicit deny, project allow ⇒ unavailable; p2: explicit allow, project deny ⇒ available (so it is not
    // "deny wins"); p3: project deny only ⇒ unavailable (project policies do apply).
    expect({ p1: ids.includes("p1"), p2: ids.includes("p2"), p3: ids.includes("p3") }).toEqual({ p1: false, p2: true, p3: false })
  })

  test("[packages/ui-mac/src/main/engine-explicit-config.ts] known bad: the checker rejects a reversed layer order", () => {
    expect(layerProblems({ a: "content", b: "project", c: "explicit", d: "global" })).toHaveLength(4)
  })
})

// ── P5 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("P5 relative skills entries", () => {
  test("[packages/ui-mac/src/main/codepuppy-config-injection.ts] `./.codepuppy/skills` resolves per project: A lists its skill, B (no such directory) does not", async () => {
    const inA = (await settled("/api/skill", projectA, "name", "probe-a")).map((item) => item.name)
    expect(inA).toContain("probe-a")
    const inB = (await steady("/api/skill", projectB)).map((item) => item.name)
    expect(inB).not.toContain("probe-a")
  }, 30_000)

  test("[packages/ui-mac/src/main/codepuppy-config-injection.ts] the resolved directory is watched: a skill written later appears without a restart", async () => {
    const before = ((await engine.call("GET", "/api/skill", undefined, projectA)).body?.data ?? []).map((item: any) => item.name)
    expect(before).not.toContain("probe-a-later")
    skill(path.join(projectA, ".codepuppy/skills"), "probe-a-later")
    const after = (await settled("/api/skill", projectA, "name", "probe-a-later")).map((item) => item.name)
    expect(after).toContain("probe-a-later")
  }, 30_000)
})

// ── P10 / P11 ─────────────────────────────────────────────────────────────────────────────────────────────────────
type Integration = { id: string; name: string; metadata?: { source?: string }; methods: Array<{ type: string }> }

const mcpIntegrations = async () => {
  const listed = await settled("/api/integration", projectA, "name", "probe-twin")
  return (listed as Integration[]).filter((item) => item.metadata?.source === "mcp")
}

function identityProblems(found: Integration[], name: string, url: string): string[] {
  const own = found.filter((item) => item.name === name)
  if (own.length !== 1) return [`${own.length} mcp integrations named ${name}`]
  const problems: string[] = []
  if (own[0]!.id !== integrationID(name, url)) problems.push(`${name}: id ${own[0]!.id}, expected ${integrationID(name, url)}`)
  if (!own[0]!.methods.some((method) => method.type === "oauth")) problems.push(`${name}: no oauth method`)
  return problems
}

describe("P10 remote MCP integration identity", () => {
  test("[packages/ui-mac/src/engine-adapter/routes.ts] one mcp integration per remote server, named after it, with an oauth method and id mcp_<sha1(name\\0url)[0:16]>", async () => {
    const found = await mcpIntegrations()
    expect(identityProblems(found, "probe", MCP_URL)).toEqual([])
    expect(identityProblems(found, "probe-twin", MCP_URL)).toEqual([])
  })

  test("[packages/ui-mac/src/engine-adapter/routes.ts] known bad: the checker rejects an id derived from another url", async () => {
    expect(identityProblems(await mcpIntegrations(), "probe", "http://127.0.0.1:2/mcp")).toHaveLength(1)
  })
})

describe("P11 MCP server entries are replaced whole", () => {
  /** Deep merge would keep the lower layer's `oauth: false`, so no integration; whole replacement registers one for the upper url. */
  function replacementProblems(found: Integration[]): string[] {
    return identityProblems(found, "replaced", "http://127.0.0.1:1/upper")
  }

  test("[packages/ui-mac/src/main/mcp-default-deny.ts] a key only the lower entry has (`oauth: false`) does not survive the upper entry of the same name", async () => {
    expect(replacementProblems(await mcpIntegrations())).toEqual([])
  })

  test("[packages/ui-mac/src/main/mcp-default-deny.ts] Code Puppy's complete neutralized entry turns the server off", async () => {
    const server = await until("the neutralized server in GET /api/mcp", async () => {
      const servers = ((await engine.call("GET", "/api/mcp", undefined, projectA)).body?.data ?? []) as Array<{ name: string; status: unknown }>
      return servers.find((item) => item.name === "neutralized")
    })
    expect(server.status).toEqual({ status: "disabled" })
    expect((await mcpIntegrations()).some((item) => item.name === "neutralized")).toBe(false)
  })

  test("[packages/ui-mac/src/main/mcp-default-deny.ts] known bad: the deep-merge outcome (no integration for the upper url) is rejected", async () => {
    const merged = (await mcpIntegrations()).filter((item) => item.name !== "replaced")
    expect(replacementProblems(merged)).toHaveLength(1)
  })
})
