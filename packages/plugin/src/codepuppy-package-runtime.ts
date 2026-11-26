// north-star:codepuppy-owned — S-01, same-process reverse port; no engine imports.
import type { Schema } from "effect"
import type { ArgumentSyntax } from "./codepuppy-package-syntax"

export type RuntimeLocation = { directory: string; workspaceID?: string }
export type PreparedInstruction = {
  parts: readonly (string | { boundValue: string })[]
  syntax: ArgumentSyntax
  rawArguments: string
  arguments: readonly string[]
  cwd: string
}
export type PreparedShellCommand = Pick<PreparedInstruction, "parts">
export type BoundShellCommand = { executable: string; argv: readonly string[]; env: Record<string, string> }
type Renderer = {
  instruction: (input: PreparedInstruction) => Promise<string>
  shell: (input: PreparedShellCommand) => Promise<BoundShellCommand>
}
const slot = Symbol.for("codepuppy.package.instruction-renderers.v1")
const processScope = globalThis as typeof globalThis & { [slot]?: Map<string, Renderer> }
const renderers = processScope[slot] ??= new Map<string, Renderer>()
const key = (location: RuntimeLocation) => JSON.stringify([location.directory, location.workspaceID ?? null])

export function registerPackageInstructionRenderer(
  location: RuntimeLocation,
  render: Renderer["instruction"],
  bindShell: Renderer["shell"],
): { dispose(): void } {
  const id = key(location)
  const renderer = { instruction: render, shell: bindShell }
  renderers.set(id, renderer)
  return { dispose() { if (renderers.get(id) === renderer) renderers.delete(id) } }
}

export async function renderPackageInstruction(location: RuntimeLocation, input: PreparedInstruction): Promise<string> {
  const render = renderers.get(key(location))
  if (!render) throw new Error("runtime-failed: package instruction renderer is unavailable for this Location")
  return render.instruction(input)
}

export async function bindPackageShellCommand(location: RuntimeLocation, input: PreparedShellCommand): Promise<BoundShellCommand> {
  const render = renderers.get(key(location))
  if (!render) throw new Error("runtime-failed: package shell binding is unavailable for this Location")
  return render.shell(input)
}


export type RuntimeOccurrence = { sessionID: string; occurrenceId: string }
export type ConfigSource = "user_settings" | "project_settings" | "local_settings" | "policy_settings" | "skills"
type Json = Schema.Schema.Type<typeof Schema.Json>
export type ElicitationRequest = { server: string; message: string; mode: "form" | "url"; requestedSchema?: Json; url?: string; elicitationId?: string }
export type ElicitationAnswer = { action: "accept" | "decline" | "cancel"; content?: Json }
export type PackageRuntimeHandlers = {
  hasElicitationHandlers(server: string): boolean
  beforeConfigChange(input: { occurrenceId: string; source: ConfigSource; filePath: string }): Promise<{ apply: boolean; reason?: string }>
  instructionsLoaded(input: RuntimeOccurrence & { filePath: string; memoryType: "User" | "Project" | "Local" | "Managed"; loadReason: "session_start" | "nested_traversal" | "path_glob_match" | "include" | "compact"; globs?: string[]; triggerFilePath?: string; parentFilePath?: string; agentId?: string; parentSessionId?: string }): Promise<void>
  beforeCompaction(input: RuntimeOccurrence & { trigger: "manual" | "auto"; customInstructions: string | null }): Promise<{ proceed: boolean; reason?: string }>
  afterCompaction(input: RuntimeOccurrence & { trigger: "manual" | "auto"; summary?: string }): Promise<void>
  beforeElicitation(input: RuntimeOccurrence & ElicitationRequest): Promise<{ handled: false } | { handled: true; answer: ElicitationAnswer }>
  afterElicitationResult(input: RuntimeOccurrence & ElicitationRequest & { answer: ElicitationAnswer }): Promise<ElicitationAnswer>
}
const runtimeSlot = Symbol.for("codepuppy.package.runtime-handlers.v1")
const runtimeScope = globalThis as typeof globalThis & { [runtimeSlot]?: Map<string, PackageRuntimeHandlers> }
const handlers = runtimeScope[runtimeSlot] ??= new Map<string, PackageRuntimeHandlers>()

export function registerPackageRuntime(location: RuntimeLocation, handler: PackageRuntimeHandlers): { dispose(): void } {
  const id = key(location)
  handlers.set(id, handler)
  return { dispose() { if (handlers.get(id) === handler) handlers.delete(id) } }
}

export function packageRuntime(location: RuntimeLocation): PackageRuntimeHandlers | undefined {
  return handlers.get(key(location))
}

// S-07: this is only the reverse call into the MCP owner's existing connection lifecycle.
const mcpSlot = Symbol.for("codepuppy.package.mcp-session-runtime.v1")
type McpRuntime = { releaseSession(sessionID: string): Promise<void> }
const mcpScope = globalThis as typeof globalThis & { [mcpSlot]?: Map<string, McpRuntime> }
const mcpRuntimes = mcpScope[mcpSlot] ??= new Map<string, McpRuntime>()

export function registerPackageMcpRuntime(location: RuntimeLocation, runtime: McpRuntime): { dispose(): void } {
  const id = key(location)
  mcpRuntimes.set(id, runtime)
  return { dispose() { if (mcpRuntimes.get(id) === runtime) mcpRuntimes.delete(id) } }
}

export async function releasePackageSessionMcp(location: RuntimeLocation, sessionID: string): Promise<void> {
  await mcpRuntimes.get(key(location))?.releaseSession(sessionID)
}
