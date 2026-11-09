/**
 * #1565 (REQ-236 §2.3): the four first-party Office servers are discoverable before they are executable.
 *
 * Main points the engine at the bundled manifest (`<resources>/office-mcp/tools.json`, exported from server.py's
 * `tools_for()` at build time and checked in) through `CODEPUPPY_OFFICE_MCP_MANIFEST`. The manifest carries, per format,
 * the bundled command template (`{codepuppyResources}` slots) and its tool definitions, plus server.py's sha256.
 *
 * An MCP entry gets a format's declared definitions only when its command equals that format's bundled command token
 * for token (the template with `{codepuppyResources}` = the manifest's resource root) and the bundled server.py next to
 * the manifest still hashes to the manifest's digest. Anything else — another command, an extra token, a server.py
 * the manifest was not exported from, no manifest at all — gets nothing and is listed only once it has connected.
 * A declaration is never a connection: the engine still runs initialize + tools/list before executing one (I9).
 *
 * `name` (the MCP key) is not part of the binding; the engine derives the tools' identity from it either way.
 */

import { createHash } from "node:crypto"
import path from "node:path"

export const OFFICE_MCP_MANIFEST_ENV = "CODEPUPPY_OFFICE_MCP_MANIFEST"

const RESOURCES_SLOT = "{codepuppyResources}"

type Manifest = {
  serverSha256: string
  formats: Record<string, { command: string[]; tools: unknown[] }>
}

export function declaredFirstPartyTools(
  _name: string,
  entry: unknown,
  env: Record<string, string | undefined>,
  readFile: (file: string) => Uint8Array,
): unknown[] | undefined {
  const manifestPath = env[OFFICE_MCP_MANIFEST_ENV]
  if (!manifestPath || !entry || typeof entry !== "object") return undefined
  const { type, command } = entry as { type?: unknown; command?: unknown }
  if (type !== "local" || !Array.isArray(command)) return undefined
  try {
    const manifest = JSON.parse(new TextDecoder().decode(readFile(manifestPath))) as Manifest
    const officeDir = path.dirname(manifestPath)
    const resources = path.dirname(officeDir)
    const format = Object.values(manifest.formats).find(
      (candidate) =>
        candidate.command.length === command.length &&
        candidate.command.every((token, index) => token.split(RESOURCES_SLOT).join(resources) === command[index]),
    )
    if (!format) return undefined
    const digest = createHash("sha256")
      .update(readFile(path.join(officeDir, "server.py")))
      .digest("hex")
    return digest === manifest.serverSha256 ? format.tools : undefined
  } catch {
    // Missing or unreadable manifest / server.py: nothing is declared; the server is listed once it connects.
    return undefined
  }
}

/** A declared definition in the shape `tools/list` produces (packages/core/src/mcp/client.ts `Tool`). */
export interface DeclaredTool {
  readonly name: string
  readonly title?: string
  readonly description?: string
  readonly inputSchema: { readonly type: "object"; readonly [key: string]: unknown }
  readonly outputSchema?: Record<string, unknown>
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** The bundled declaration as listed tools, or undefined when the entry is not bound to the bundle. */
export function declaredListedTools(
  name: string,
  entry: unknown,
  env: Record<string, string | undefined>,
  readFile: (file: string) => Uint8Array,
): DeclaredTool[] | undefined {
  const tools = declaredFirstPartyTools(name, entry, env, readFile)?.flatMap((tool): DeclaredTool[] => {
    if (!record(tool) || typeof tool.name !== "string" || tool.name === "" || !record(tool.inputSchema)) return []
    return [
      {
        name: tool.name,
        ...(typeof tool.title === "string" ? { title: tool.title } : {}),
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        inputSchema: { ...tool.inputSchema, type: "object" },
        ...(record(tool.outputSchema) ? { outputSchema: tool.outputSchema } : {}),
      },
    ]
  })
  return tools && tools.length > 0 ? tools : undefined
}

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item) =>
    record(item) ? Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))) : item,
  )

const definition = (tool: { name: string; description?: string; inputSchema: unknown; outputSchema?: unknown }) =>
  canonical({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema })

/** Whether a connected server's listed tool is the declared one (what the model planned against). */
export const sameTool = (
  a: { name: string; description?: string; inputSchema: unknown; outputSchema?: unknown },
  b: { name: string; description?: string; inputSchema: unknown; outputSchema?: unknown },
) => definition(a) === definition(b)

/** Whether a connected server lists exactly its declaration; anything else refutes the declaration. */
export const listsDeclaration = (
  declared: ReadonlyArray<DeclaredTool>,
  listed: ReadonlyArray<{ name: string; description?: string; inputSchema: unknown; outputSchema?: unknown }>,
) =>
  declared.length === listed.length &&
  declared.every((tool) => listed.some((live) => live.name === tool.name && sameTool(tool, live)))
