// Integration layer (real files, real PATH lookup): R5's one dependency predicate (design §4.5) for the install precheck and the
// pre-spawn read. Marker programs prove the predicate never runs what it judges.
import { afterEach, expect, test } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkConnectorRuntimeDependencies, connectorRuntimeDependencyReader, installedConnectorDeclaration } from "./connector-runtime-dependencies"
import { addReceipt } from "./codepuppy-installs"
import type { CatalogEntry } from "../renderer/extensions/catalog-types"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const temporary = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "connector-deps-")))
  roots.push(root)
  return root
}
/** A program that leaves a marker if anything executes it; `shim` makes it look like the developer-tools xcrun shim. */
const program = (directory: string, name: string, marker: string, shim = false) => {
  mkdirSync(directory, { recursive: true })
  const file = join(directory, name)
  writeFileSync(file, `#!/bin/sh\n${shim ? "# __xcrun_shim\n" : ""}touch '${marker}'\n`)
  chmodSync(file, 0o755)
  return file
}
const system = (input: { developer?: string; platform?: NodeJS.Platform } = {}) => ({ platform: input.platform ?? ("darwin" as const), developerDirectory: async () => input.developer })
const predicate = (input: { developer?: string; platform?: NodeJS.Platform } = {}) => ({
  checkConnectorRuntimeDependencies: (value: Parameters<typeof checkConnectorRuntimeDependencies>[0]) => checkConnectorRuntimeDependencies(value, system(input)),
})

test("git behind the developer-tools shim is missing without developer tools and is never executed", async () => {
  const root = temporary()
  const marker = join(root, "executed")
  program(join(root, "usr-bin"), "git", marker, true)
  const facts = await predicate().checkConnectorRuntimeDependencies({ runtimeDep: ["git"], environment: { PATH: join(root, "usr-bin") } })
  expect(facts).toEqual({ runtimeDep: ["git"], executables: {}, missing: ["git"] })
  expect(existsSync(marker)).toBe(false)
})

test("with developer tools the shim resolves to the developer directory's git; a real git elsewhere needs no developer tools", async () => {
  const root = temporary()
  const marker = join(root, "executed")
  program(join(root, "usr-bin"), "git", marker, true)
  const developer = join(root, "CommandLineTools")
  const real = program(join(developer, "usr", "bin"), "git", marker)
  const viaTools = await predicate({ developer }).checkConnectorRuntimeDependencies({ runtimeDep: ["git"], environment: { PATH: join(root, "usr-bin") } })
  expect(viaTools.executables).toEqual({ git: real })
  expect(viaTools.missing).toEqual([])
  const homebrew = program(join(root, "homebrew", "bin"), "git", marker)
  const direct = await predicate().checkConnectorRuntimeDependencies({ runtimeDep: ["git"], environment: { PATH: [join(root, "usr-bin"), join(root, "homebrew", "bin")].join(":") } })
  expect(direct.executables).toEqual({ git: homebrew })
  expect(existsSync(marker)).toBe(false)
})

test("uv and Node come from the bundled launchers only for their runner role; an old copy on PATH changes nothing", async () => {
  const root = temporary()
  const marker = join(root, "executed")
  program(join(root, "old"), "uv", marker)
  const runner = await predicate().checkConnectorRuntimeDependencies({ runtimeDep: ["uv", "uv"], runner: "uv-tool", environment: { PATH: join(root, "old") } })
  expect(runner).toEqual({ runtimeDep: ["uv"], executables: {}, missing: [] })
  const npm = await predicate().checkConnectorRuntimeDependencies({ runtimeDep: ["node"], runner: "npm-exec", environment: { PATH: "" } })
  expect(npm.missing).toEqual([])
  const native = await predicate().checkConnectorRuntimeDependencies({ runtimeDep: ["uv", "docker"], environment: { PATH: join(root, "old") } })
  expect(native.missing).toEqual(["docker"])
  expect(native.executables.uv).toBe(join(root, "old", "uv"))
  expect(existsSync(marker)).toBe(false)
})

test("Windows accepts only a real git.exe and keeps the other executable suffixes for other programs", async () => {
  const root = temporary()
  writeFileSync(join(root, "git.cmd"), "@echo off\r\n")
  writeFileSync(join(root, "docker.exe"), "MZ")
  const windows = predicate({ platform: "win32" })
  const before = await windows.checkConnectorRuntimeDependencies({ runtimeDep: ["git", "docker"], environment: { Path: root } })
  expect(before.missing).toEqual(["git"])
  expect(before.executables.docker).toBe(join(root, "docker.exe"))
  writeFileSync(join(root, "git.exe"), "MZ")
  expect((await windows.checkConnectorRuntimeDependencies({ runtimeDep: ["git"], environment: { Path: root } })).executables.git).toBe(join(root, "git.exe"))
})

test("the pre-spawn read uses the installed card version's declaration and its runner role, never the newest card", async () => {
  const root = temporary()
  const global = join(root, "global")
  const project = join(root, "project")
  mkdirSync(global, { recursive: true })
  mkdirSync(project, { recursive: true })
  const card = (version: string, runtimeDep: string[]): CatalogEntry => ({ id: "mcp:git", type: "mcp", name: "git", displayName: "Git", description: "", source: "official", category: "dev", version, installSpec: { kind: "mcp", mcpType: "local", command: ["uvx", "mcp-server-git", "--repository", "{workspace}"], runtimeDep } } as CatalogEntry)
  const receipt = (version: string) => ({ id: "mcp:git", name: "git", type: "mcp" as const, scope: "global" as const, version, installedAt: "2026-11-27T00:00:00.000Z", origin: "catalog" as const })
  expect(addReceipt(global, receipt("1.0.0")).ok).toBe(true)
  const catalog = async () => ({ entries: [card("2.0.0", ["uv", "git", "docker"]), { ...card("1.0.0", ["uv", "git"]), id: "mcp:other" }], version: "2026-11-27" })
  const identity = { directory: project, server: "git", attempt: "a1" }
  expect(await installedConnectorDeclaration({ identity, roots: [project, global], catalog })).toBeUndefined()
  expect(addReceipt(project, receipt("2.0.0")).ok).toBe(true)
  const declared = await installedConnectorDeclaration({ identity, roots: [project, global], catalog })
  expect(declared?.runtimeDep).toEqual(["uv", "git", "docker"])
  const marker = join(root, "executed")
  program(join(root, "usr-bin"), "git", marker, true)
  const facts = await connectorRuntimeDependencyReader(
    { installed: (value) => installedConnectorDeclaration({ identity: value, roots: [project, global], catalog }), environment: () => ({ PATH: join(root, "usr-bin") }) },
    system(),
  )(identity)
  expect(facts.missing).toEqual(["git", "docker"])
  expect(existsSync(marker)).toBe(false)
  const none = await connectorRuntimeDependencyReader({ installed: async () => undefined, environment: () => ({}) }, system())({ ...identity, server: "user-added" })
  expect(none).toEqual({ runtimeDep: [], executables: {}, missing: [] })
})
