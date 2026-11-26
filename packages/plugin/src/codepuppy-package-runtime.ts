// north-star:codepuppy-owned — S-01, same-process reverse port; no engine imports.
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
