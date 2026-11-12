/**
 * Slice E2 (ADR-041; orchestrator ruling 2026-11-12): the MCP layer mints the fact the extension's tool identity needs —
 * "this registry entry is a tool the MCP layer registered for this server". OpenCode 2's plugin API does not say which
 * layer registered a tool, and an MCP tool's registration shape is one any plugin can copy (name, namespace, options).
 *
 * `mcpToolMark` returns the property the MCP layer adds to each tool it registers (packages/core/src/tool/mcp.ts): a
 * fresh frozen object recorded here with its server and tool name. Registry entries and plugin listings are shallow
 * copies, so the same object reaches the extension. The verifier is published once, read-only and non-configurable,
 * under `MCP_TOOL_VERIFIER` (the only channel between the engine and the extension's separate bundle in one process); it
 * answers true only for an object issued here and only for the server and tool it was issued for. Issuing stays in this
 * module: a plugin can copy a mark from a listed tool but not issue one, and a copy on another tool does not verify.
 * If the verifier was already published (a second instance of this module), marks issued by this instance do not verify
 * — identity falls back to a plugin tool (fail closed), never the other way round.
 */
import { MCP_TOOL_MARK, MCP_TOOL_VERIFIER, type McpToolVerifier } from "@opencode/schema/codepuppy-tool-policy"

const issued = new WeakMap<object, { readonly server: string; readonly tool: string }>()

const verify: McpToolVerifier = (mark, server, tool) => {
  const bound = typeof mark === "object" && mark !== null ? issued.get(mark) : undefined
  return bound !== undefined && bound.server === server && bound.tool === tool
}

if (!Object.hasOwn(globalThis, MCP_TOOL_VERIFIER))
  Object.defineProperty(globalThis, MCP_TOOL_VERIFIER, { value: verify, enumerable: false, writable: false, configurable: false })

/** The property the MCP layer adds to the tool it registers for `server` (spread it into the registration). */
export function mcpToolMark(server: string, tool: string): { readonly [MCP_TOOL_MARK]: object } {
  const mark = Object.freeze({})
  issued.set(mark, { server, tool })
  return { [MCP_TOOL_MARK]: mark }
}
