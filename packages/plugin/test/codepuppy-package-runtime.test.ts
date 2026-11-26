import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { registerPackageInstructionRenderer, renderPackageInstruction } from "../src/codepuppy-package-runtime"

test("instruction renderer follows the Location lifetime across module consumers", async () => {
  const root = await mkdtemp(join(tmpdir(), "package-runtime-"))
  const location = { directory: root }
  const input = { parts: ["source"], syntax: "claude" as const, rawArguments: "", arguments: [], cwd: root }
  const first = registerPackageInstructionRenderer(location, async value => value.parts.join(""), async () => ({ executable: "sh", argv: ["first"], env: { FIRST: "value" } }))
  try {
    const build = await Bun.build({ entrypoints: [join(import.meta.dir, "../src/codepuppy-package-runtime.ts")], outdir: root, target: "bun" })
    expect(build.success).toBe(true)
    const other: typeof import("../src/codepuppy-package-runtime") = await import(join(root, "codepuppy-package-runtime.js"))
    expect(await other.renderPackageInstruction(location, input)).toBe("source")
    expect(await other.bindPackageShellCommand(location, { parts: ["source"] })).toEqual({ executable: "sh", argv: ["first"], env: { FIRST: "value" } })
    await expect(other.renderPackageInstruction({ ...location, workspaceID: "other" }, input)).rejects.toThrow("runtime-failed")
    const current = other.registerPackageInstructionRenderer(location, async () => "replacement", async () => ({ executable: "sh", argv: ["replacement"], env: {} }))
    first.dispose()
    expect(await renderPackageInstruction(location, input)).toBe("replacement")
    expect((await other.bindPackageShellCommand(location, { parts: [] })).argv).toEqual(["replacement"])
    current.dispose()
    await expect(renderPackageInstruction(location, input)).rejects.toThrow("runtime-failed")
    await expect(other.bindPackageShellCommand(location, { parts: [] })).rejects.toThrow("runtime-failed")
  } finally {
    first.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
