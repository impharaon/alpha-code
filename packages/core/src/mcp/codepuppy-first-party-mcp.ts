/** Bundled declarations bind explicit configuration and protected resource bytes, never a server name. */
import type { DocumentPythonEnvironment } from "@opencode/util/codepuppy-document"
import type { BundledFirstPartyDeclaration, DeclaredFirstParty, LauncherEnvironment } from "@opencode/util/codepuppy-connector-launch"
import { canonicalJsonDigest } from "@opencode/util/codepuppy-hash"
import { createHash } from "node:crypto"
import path from "node:path"

const RESOURCES_SLOT = "{codepuppyResources}"
const WORKSPACE_SLOT = "{workspace}"
const NODE_SLOT = "{codepuppyNode}"
const CACHE_SLOT = "{codepuppyCacheRoot}"

export function expandFirstPartyCommand(template: readonly string[], resources: string, launchers: LauncherEnvironment, declarationId: string): string[] {
  return expandCommand(template, resources, launchers, declarationId)
}

function expandCommand(template: readonly string[], resources: string, launchers: LauncherEnvironment | undefined, declarationId: string): string[] {
  return template.map((token, index) => {
    if (token.includes(NODE_SLOT)) {
      if (index !== 0 || token !== NODE_SLOT || !launchers || !path.isAbsolute(launchers.node)) throw new Error("invalid bundled Node slot")
      return launchers.node
    }
    if (token.includes(CACHE_SLOT)) {
      const root = launchers?.firstPartyCacheRoots[declarationId]
      if (index === 0 || token !== CACHE_SLOT || !root || !path.isAbsolute(root)) throw new Error("invalid bundled cache slot")
      return root
    }
    if (token.includes(WORKSPACE_SLOT) && (index === 0 || token !== WORKSPACE_SLOT)) throw new Error("invalid bundled workspace slot")
    return token.split(RESOURCES_SLOT).join(resources)
  })
}

export function commandMatchesTemplate(template: readonly string[], command: readonly unknown[], resources: string, launchers: LauncherEnvironment, declarationId: string): boolean {
  return matchesCommand(template, command, resources, launchers, declarationId)
}

function matchesCommand(template: readonly string[], command: readonly unknown[], resources: string, launchers: LauncherEnvironment | undefined, declarationId: string) {
  try {
    const expanded = expandCommand(template, resources, launchers, declarationId)
    return expanded.length === command.length && expanded.every((token, index) => {
      const actual = command[index]
      if (index > 0 && token === WORKSPACE_SLOT) return actual === WORKSPACE_SLOT || (typeof actual === "string" && path.isAbsolute(actual) && !actual.split(/[\\/]/).includes(".."))
      return token === actual
    })
  } catch {
    return false
  }
}

const relativeMember = (value: unknown): value is string => typeof value === "string" && value !== "" && !value.includes("\\") && !value.includes(":") && !value.startsWith("/") && value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
const stringRecord = (value: unknown): value is Record<string, string> => record(value) && Object.values(value).every((item) => typeof item === "string")

function isDeclaration(value: unknown): value is BundledFirstPartyDeclaration {
  if (!record(value) || !Array.isArray(value.command) || value.command.length === 0 || !value.command.every((item) => typeof item === "string") || !stringRecord(value.environment) || !(value.cwd === null || typeof value.cwd === "string") || !record(value.codeSha256) || Object.keys(value.codeSha256).length === 0 || !Array.isArray(value.tools)) return false
  if (!Object.entries(value.codeSha256).every(([file, digest]) => relativeMember(file) && typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest))) return false
  if (value.recipe === undefined) return true
  if (!Array.isArray(value.recipe)) return false
  const ids = new Set<string>()
  return value.recipe.every((recipe) => {
    if (!record(recipe) || typeof recipe.id !== "string" || !relativeMember(recipe.id) || ids.has(recipe.id) || !["file", "zip", "tar.gz", "tar.bz2", "tar.xz"].includes(String(recipe.archive)) || !relativeMember(recipe.entry) || !Array.isArray(recipe.required) || !recipe.required.every(relativeMember) || !recipe.required.includes(recipe.entry)) return false
    ids.add(recipe.id)
    return true
  })
}

/** Missing launcher context can only attest resource-only native declarations while host composition is pending. */
export function declaredFirstPartyTools(
  _name: string,
  entry: unknown,
  manifestPath: string | undefined,
  readFile: (file: string) => Uint8Array,
  pythonEnvironment?: DocumentPythonEnvironment,
  launchers?: LauncherEnvironment,
): DeclaredFirstParty | undefined {
  if (!manifestPath || !record(entry) || entry.type !== "local" || !Array.isArray(entry.command)) return undefined
  if (entry.environment !== undefined && !stringRecord(entry.environment)) return undefined
  try {
    const manifest: unknown = JSON.parse(new TextDecoder().decode(readFile(manifestPath)))
    if (!record(manifest) || !record(manifest.formats)) return undefined
    const resources = path.dirname(path.dirname(manifestPath))
    for (const [id, declaration] of Object.entries(manifest.formats)) {
      if (!isDeclaration(declaration) || !matchesCommand(declaration.command, entry.command, resources, launchers, id)) continue
      // Only the native Office command receives the host's per-Location Python projection.
      const office = declaration.command.includes(`${RESOURCES_SLOT}/office-mcp/server.py`)
      const expectedEnvironment = { ...declaration.environment, ...(office && entry.disabled !== true ? pythonEnvironment : undefined) }
      if (canonicalJsonDigest(entry.environment ?? {}) !== canonicalJsonDigest(expectedEnvironment) || (entry.cwd ?? null) !== declaration.cwd) continue
      if (!Object.entries(declaration.codeSha256).every(([file, digest]) => createHash("sha256").update(readFile(path.join(resources, file))).digest("hex") === digest)) continue
      const recipeSha256 = canonicalJsonDigest({ kind: "codepuppy-pinned-entry-recipe", recipe: declaration.recipe ?? [] }).slice("sha256:".length)
      const declarationSha256 = canonicalJsonDigest({ kind: "codepuppy-bundled-mcp-declaration", command: declaration.command, environment: declaration.environment, cwd: declaration.cwd, codeSha256: declaration.codeSha256, tools: declaration.tools, recipeSha256 }).slice("sha256:".length)
      return { tools: declaration.tools, ...(declaration.recipe === undefined ? {} : { recipe: declaration.recipe }), declarationSha256, recipeSha256 }
    }
  } catch {
    // Invalid manifest / unreadable protected code is untrusted, not an application failure.
  }
  return undefined
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
  manifestPath: string | undefined,
  readFile: (file: string) => Uint8Array,
  pythonEnvironment?: DocumentPythonEnvironment,
  launchers?: LauncherEnvironment,
): DeclaredTool[] | undefined {
  const tools = declaredFirstPartyTools(name, entry, manifestPath, readFile, pythonEnvironment, launchers)?.tools.flatMap((tool): DeclaredTool[] => {
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
