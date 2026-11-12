// Code Puppy tool identity on OpenCode 2 (ADR-041): who registered a tool, which authority vouches for it, where it
// runs. Replaces the v1 takeovers of tool/registry.ts, plugin/index.ts and mcp/index.ts that stamped identity at
// registration (#1662 L4).
//
// What OpenCode 2 gives a plugin: the registry (`tool.list()` / `tool.transform` editors) keyed by effective name,
// with `options.namespace`, and the configured MCP servers (`mcp.transform` editors). It does not record which plugin
// registered a tool. So identity is derived from facts the extension can observe:
//
//   · mcp      — the tool's namespace is the normalized name of a configured MCP server and the MCP layer registered
//                it for that server (its mark verifies, slice E2: packages/core/src/tool/codepuppy-mcp-tool-mint.ts)
//                ⇒ `mcp:<server>:<tool>`. For a server bound to the bundled Office manifest the tool must also be one the
//                attested declaration lists (slice E). Any other tool in that namespace is someone else's: it gets the
//                plugin identity below, never the server's identity or authority.
//   · builtin  — the tool was already in the registry when the extension's first transform ran, i.e. it came from
//                OpenCode's internal plugins that activate before configured plugins ⇒ `builtin::<id>`
//                (`host::<id>` for the two MCP resource tools, the identity v1 gave them, so saved records keep
//                matching). If any non-builtin plugin activates before the extension, early tools cannot be told
//                apart from that plugin's, so they fall to the next rule instead (fail-closed: plugin class asks).
//   · plugin   — everything else ⇒ `plugin:<origin>:<id>`; the extension's own tools carry the extension's module path
//                as origin (v1 used the loader spec, which is that path) and `codepuppy-bundled` authority only when
//                the bundled manifest verifies; any other tool's origin is unknown ("").
//
// Limits recorded in ADR-047 (authority registry `adr041-registration-identity`): OpenCode 2 keeps the last
// registration of an effective name, so a later plugin replacing an earlier tool cannot be detected from a plugin.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { governedMcpEvidence } from "../../../plugin/src/alpha-cloud-authority"
import type { ToolAuthority, ToolIdentity, ToolLocation } from "../../../schema/src/tool-identity"
import { registeredByMcpLayer } from "../../../schema/src/codepuppy-tool-policy"
import { declaredFirstPartyTools } from "../../../core/src/mcp/codepuppy-first-party-mcp"
import { bundledPluginTools, type BundledPluginTools } from "./bundled-plugin"
import { canonicalJsonDigest } from "./store"
import { mcpBindingDigest, type McpEntry } from "./resolver"
import type { ToolTransportFact } from "./risk"

/** Registry entry as the promise plugin API lists it. */
export interface RegisteredTool {
  readonly id: string
  readonly name: string
  readonly options?: { readonly namespace?: string; readonly permission?: string; readonly codemode?: boolean }
}

export interface ToolFacts {
  /** Effective (advertised) name: the registry key and the `execute.before` `tool` value. */
  readonly technicalId: string
  /** Whole-tool permission action OpenCode filters the snapshot by (`options.permission ?? id`). */
  readonly permission: string
  readonly identity: ToolIdentity
  readonly authority: ToolAuthority
  readonly bindingDigest?: string
  readonly location?: ToolLocation
  readonly transport?: ToolTransportFact
  /** #1568: display identifier of a verified bundled extension tool. */
  readonly readable?: string
}

/** OpenCode 2 `normalizedName` (packages/core/src/tool/runtime.ts:288), restated; `identity.test.ts` pins it to upstream. */
export function normalizeToolName(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_")
}

/** OpenCode 2 registry namespace of an MCP server's tools (packages/core/src/tool/mcp.ts `namespace`). */
export function mcpNamespace(server: string) {
  return normalizeToolName(server).replaceAll(".", "_")
}

/** OpenCode 2 effective name of an MCP tool (`effectiveName` with namespace = normalized server name). */
export function mcpEffectiveName(server: string, tool: string) {
  return `${mcpNamespace(server)}_${normalizeToolName(tool)}`
}

/** v1 identities of the MCP resource tools; OpenCode 2 ships them as internal tools under the same names. */
const HOST_TOOLS = new Set(["list_mcp_resources", "read_mcp_resource"])

/** The Code Mode runner is rebuilt per snapshot and never registered; its calls reach `execute.before` as `execute`. */
export const CODE_MODE_TOOL = "execute"

export interface IdentityInput {
  /** Effective names present before the extension's first transform; undefined = not captured yet. */
  readonly early: ReadonlySet<string> | undefined
  /** True when a non-builtin plugin activates before the extension (early tools are then ambiguous). */
  readonly earlyAmbiguous: boolean
  /** Configured MCP servers (`mcp.transform` view after the extension's own entries). */
  readonly mcp: ReadonlyMap<string, McpEntry & Record<string, unknown>>
  /** The extension's own verified tools (bundled manifest), if any. */
  readonly bundled: BundledPluginTools | undefined
  /** Origin written for the extension's own tools. */
  readonly extOrigin: string
  readonly env: Record<string, string | undefined>
}

export function mcpLocation(entry: McpEntry | undefined): ToolLocation | undefined {
  if (!entry) return undefined
  if (entry.type === "local") return { kind: "local" }
  const host = URL.canParse(entry.url) ? new URL(entry.url).hostname : ""
  return host ? { kind: "remote", host } : undefined
}

export function mcpTransportFact(entry: McpEntry | undefined): ToolTransportFact | undefined {
  if (!entry) return undefined
  if (entry.type === "remote") return { kind: "mcp-remote", url: entry.url }
  return { kind: "mcp-local", command: [...entry.command] }
}

export function authorityForMcp(name: string, entry: McpEntry, env: Record<string, string | undefined>): ToolAuthority {
  return mcpAuthority(name, entry, env).authority
}

/** The server's authority and, for a server bound to the bundled manifest, the tool names that manifest declares. */
function mcpAuthority(name: string, entry: McpEntry, env: Record<string, string | undefined>): { authority: ToolAuthority; declared?: ReadonlySet<string> } {
  const evidence = governedMcpEvidence(name, entry, env)
  if (evidence)
    return {
      authority: {
        kind: "codepuppy-cloud",
        bindingId: `mcp:${encodeURIComponent(name)}`,
        evidenceDigest: `sha256:${createHash("sha256").update(evidence).digest("hex")}`,
      },
    }
  const declared = declaredFirstPartyTools(name, entry, env, readFileSync)
  if (!declared || entry.type !== "local") return { authority: { kind: "not-asserted" } }
  return {
    authority: {
      kind: "codepuppy-bundled",
      bindingId: `mcp:${encodeURIComponent(name)}`,
      evidenceDigest: canonicalJsonDigest({ kind: "codepuppy-bundled-mcp", name, command: entry.command, tools: declared }),
    },
    declared: new Set(declared.map((tool) => (tool as { name?: unknown } | null)?.name).filter((tool): tool is string => typeof tool === "string")),
  }
}

/** Identity, authority and transport facts for one registered tool. */
export function toolFacts(tool: RegisteredTool, input: IdentityInput): ToolFacts {
  const technicalId = tool.id
  const permission = tool.options?.permission ?? tool.id
  const namespace = tool.options?.namespace
  let borrowed = false
  if (namespace !== undefined) {
    // Several configured servers can normalize to one namespace (`docs.svc`, `docs_svc`): each is tried; the tool is a
    // plugin tool only when none of them registered it (review R1/2).
    for (const [server, entry] of input.mcp) {
      if (mcpNamespace(server) !== namespace.replaceAll(".", "_")) continue
      // slice E2 (ADR-041): registered by the MCP layer for this server, under the effective name the registry gave it
      // then. The key does not move afterwards, while a listed tool's `options` (namespace included) is shared and
      // writable through a plugin's editor.get (review R1/1) — so the key, not the namespace, says whose tool it is.
      if (technicalId !== mcpEffectiveName(server, tool.name) || !registeredByMcpLayer(tool, server, tool.name)) {
        borrowed = true
        continue
      }
      const { authority, declared } = mcpAuthority(server, entry, input.env)
      // slice E (ADR-041): not one of the tools the bundled server's MCP layer registers ⇒ not that server's tool.
      if (declared && !declared.has(tool.name)) {
        borrowed = true
        continue
      }
      return {
        technicalId,
        permission,
        identity: { source: "mcp", origin: server, name: tool.name },
        authority,
        bindingDigest: mcpBindingDigest(server, entry),
        location: mcpLocation(entry),
        transport: mcpTransportFact(entry),
      }
    }
  }
  if (!borrowed && input.early?.has(technicalId) && !input.earlyAmbiguous)
    return {
      technicalId,
      permission,
      identity: HOST_TOOLS.has(tool.name)
        ? { source: "host", origin: "", name: tool.name }
        : { source: "builtin", origin: "", name: technicalId },
      authority: { kind: "not-asserted" },
      bindingDigest: APP_BUILTIN_BINDING_DIGEST,
      location: { kind: "local" },
    }
  const own = input.bundled?.tools.has(technicalId) ? input.bundled : undefined
  return {
    technicalId,
    permission,
    identity: { source: "plugin", origin: own ? input.extOrigin : "", name: technicalId },
    authority: own ? own.authority : { kind: "not-asserted" },
    bindingDigest: own ? own.authority.evidenceDigest : undefined,
    location: { kind: "local" },
    ...(own?.readable.get(technicalId) ? { readable: own.readable.get(technicalId) } : {}),
  }
}

/** The Code Mode runner's identity: a builtin. Its child calls are judged one by one. */
export function codeModeFacts(): ToolFacts {
  return {
    technicalId: CODE_MODE_TOOL,
    permission: CODE_MODE_TOOL,
    identity: { source: "builtin", origin: "", name: CODE_MODE_TOOL },
    authority: { kind: "not-asserted" },
    bindingDigest: APP_BUILTIN_BINDING_DIGEST,
    location: { kind: "local" },
  }
}

/**
 * Builtins ship with the application and have no rebind lifecycle: a constant binding, so service/tool enabled records
 * survive version upgrades (§5). Same value v1 used.
 */
export const APP_BUILTIN_BINDING_DIGEST = canonicalJsonDigest({ kind: "codepuppy-app-builtin" })

/** The extension's module file: the bundle at runtime (`dist/plugin.js`), this source file under test. */
export function extModulePath(moduleUrl: string): string {
  return moduleUrl.startsWith("file:") ? fileURLToPath(moduleUrl) : moduleUrl
}

export function loadBundledTools(moduleUrl: string, env: Record<string, string | undefined>) {
  return bundledPluginTools({ source: "file", entry: moduleUrl }, env, readFileSync)
}
