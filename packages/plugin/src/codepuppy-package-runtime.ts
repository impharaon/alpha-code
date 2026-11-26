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
type Renderer = (input: PreparedInstruction) => Promise<string>
const slot = Symbol.for("codepuppy.package.instruction-renderers.v1")
const processScope = globalThis as typeof globalThis & { [slot]?: Map<string, Renderer> }
const renderers = processScope[slot] ??= new Map<string, Renderer>()
const key = (location: RuntimeLocation) => JSON.stringify([location.directory, location.workspaceID ?? null])

export function registerPackageInstructionRenderer(location: RuntimeLocation, render: Renderer): { dispose(): void } {
  const id = key(location)
  renderers.set(id, render)
  return { dispose() { if (renderers.get(id) === render) renderers.delete(id) } }
}

export async function renderPackageInstruction(location: RuntimeLocation, input: PreparedInstruction): Promise<string> {
  const render = renderers.get(key(location))
  if (!render) throw new Error("runtime-failed: package instruction renderer is unavailable for this Location")
  return render(input)
}
