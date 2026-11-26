import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Layer } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import type { LauncherEnvironment } from "@opencode/util/codepuppy-connector-launch"
import { Environment } from "@opencode/core/environment/index"
import { installConnectorPython, publishConnectorPreparation, readConnectorPreparation } from "@opencode/core/mcp/codepuppy-connector-launch"
import { hostEnvironmentLayer, recordingEnvironmentLayer, transformEnvironmentFiles } from "./fixture/environment"

// Integration layer, affected PR/nightly. Own process fixtures reproduce the actual uv 0.13.10
// optional install_name_tool invocation captured in plan.md r3; no large uv/Python archive in the suite.
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function pythonInstallation(tools: "present" | "absent" | "missing-directory") {
  const root = mkdtempSync(path.join(tmpdir(), "connector-python-"))
  roots.push(root)
  const bundled = path.join(root, "bundled")
  const system = path.join(root, "system-bin")
  const developer = path.join(root, "developer")
  for (const directory of [bundled, system, developer]) mkdirSync(directory)
  const marker = path.join(root, "marker")
  const uv = path.join(bundled, "uv")
  writeFileSync(uv, "#!/bin/sh\ninstall_name_tool -id ignored 2>/dev/null || true\nprintf ready\n", { mode: 0o755 })
  writeFileSync(path.join(system, "install_name_tool"), '#!/bin/sh\nprintf invoked > "$MARKER_FILE"\n', { mode: 0o755 })
  const launchers: LauncherEnvironment = {
    platform: "darwin-arm64",
    pinSet: "a".repeat(64),
    uv,
    uvx: path.join(bundled, "uvx"),
    node: path.join(bundled, "node"),
    npmCli: path.join(bundled, "npm-cli.js"),
    npxCli: path.join(bundled, "npx-cli.js"),
    runtimeRoot: root,
    pythonFileId: "python/darwin-arm64/3.12.16-20261124",
    packageManagerEnv: {},
    environment: { UV_PYTHON: "3.12.16", UV_PYTHON_INSTALL_MIRROR: "file:///verified-mirror" },
    firstPartyCacheRoots: {},
  }
  const input = {
    launchers,
    cwd: root,
    environment: { PATH: [system, bundled, process.env.PATH].join(path.delimiter), MARKER_FILE: marker },
  }
  const commands: ChildProcess.Command[] = []
  const layer = Layer.effect(
    Environment.Service,
    Effect.gen(function* () {
      const current = yield* Environment.Service
      return Environment.Service.of({
        ...current,
        spawner: ChildProcessSpawner.make((command) => {
          commands.push(command)
          // xcode-select -p emits one absolute path plus newline (actual r4 host sample). Only its
          // result is replaced; stat and the preparation process use the real Location dependencies.
          if (command._tag === "StandardCommand" && command.command === "/usr/bin/xcode-select") {
            const stdout =
              tools === "absent" ? "" : (tools === "present" ? developer : path.join(root, "missing")) + "\n"
            return current.spawner.spawn(
              ChildProcess.make(
                process.execPath,
                ["-e", `process.stdout.write(${JSON.stringify(stdout)}); process.exit(${tools === "absent" ? 1 : 0})`],
                command.options,
              ),
            )
          }
          return current.spawner.spawn(command)
        }),
      })
    }),
  ).pipe(Layer.provide(hostEnvironmentLayer))
  return { input, marker, commands, layer }
}

test("Python installation preserves the planned PATH when developer tools are present", async () => {
  const f = pythonInstallation("present")
  const result = await Effect.runPromise(Effect.scoped(installConnectorPython(f.input)).pipe(Effect.provide(f.layer)))
  expect(result).toMatchObject({ exitCode: 0, stdout: "ready" })
  expect(existsSync(f.marker)).toBe(true)
  expect(f.input.environment.PATH).toContain("system-bin")
})

for (const tools of ["absent", "missing-directory"] as const)
  test(`Python installation excludes system tools when the developer probe is ${tools}`, async () => {
    const f = pythonInstallation(tools)
    const planned = f.input.environment.PATH
    const result = await Effect.runPromise(Effect.scoped(installConnectorPython(f.input)).pipe(Effect.provide(f.layer)))
    expect(result).toMatchObject({ exitCode: 0, stdout: "ready" })
    expect(existsSync(f.marker)).toBe(false)
    expect(f.input.environment.PATH).toBe(planned)
    const probe = f.commands.find(
      (command) => command._tag === "StandardCommand" && command.command === "/usr/bin/xcode-select",
    )
    expect(probe?._tag === "StandardCommand" ? probe.args : []).toEqual(["-p"])
  })

test("Windows Python installation does not probe Mac developer tools or replace PATH", async () => {
  const f = pythonInstallation("absent")
  f.input.launchers.platform = "win32-x64"
  const result = await Effect.runPromise(Effect.scoped(installConnectorPython(f.input)).pipe(Effect.provide(f.layer)))
  expect(result.exitCode).toBe(0)
  expect(existsSync(f.marker)).toBe(true)
  expect(
    f.commands.some((command) => command._tag === "StandardCommand" && command.command === "/usr/bin/xcode-select"),
  ).toBe(false)
})

function packagePreparation(runner: "uv-tool" | "npm-exec") {
  const root = mkdtempSync(path.join(tmpdir(), "connector-prepared-"))
  roots.push(root)
  const key = "a".repeat(64)
  const prefix = path.join(root, "prepared", key)
  mkdirSync(prefix, { recursive: true })
  const entry = path.join(prefix, "service")
  writeFileSync(entry, '#!/bin/sh\nprintf "%s\\n" "$PWD" "$CURRENT_KEY" "$1"\n', { mode: 0o755 })
  return {
    root,
    prefix,
    entry,
    value: { key, runner, packages: { "own-process-fixture": "1.0.0" }, entries: { service: entry }, required: [prefix] },
  }
}

// Integration layer: these are our private receipts and process fixtures, not invented npm/uv metadata.
for (const runner of ["uv-tool", "npm-exec"] as const)
  test(`${runner} receipt reload skips package processes and binds current invocation inputs`, async () => {
    const f = packagePreparation(runner)
    const source = { ...f.value, cwd: "/old/project", environment: { CURRENT_KEY: "old-secret" }, argv: ["old-argument"] }
    await Effect.runPromise(publishConnectorPreparation({ runtimeRoot: f.root, preparation: source }).pipe(Effect.provide(hostEnvironmentLayer)))
    const spawns: ChildProcess.Command[] = []
    const loaded = await Effect.runPromise(readConnectorPreparation({ runtimeRoot: f.root, key: f.value.key, runner }).pipe(Effect.provide(recordingEnvironmentLayer(spawns))))
    expect(loaded).toEqual(f.value)
    expect(spawns).toEqual([])
    const persisted = JSON.parse(readFileSync(path.join(f.prefix, "ready.json"), "utf8"))
    expect(Object.keys(persisted).sort()).toEqual(["schema", "ready", "key", "runner", "packages", "entries", "required"].sort())
    expect(JSON.stringify(persisted)).not.toContain("old-secret")
    const cwd = path.join(f.root, "current-project")
    mkdirSync(cwd)
    const output = Bun.spawnSync([loaded!.entries.service!, "current-argument"], { cwd, env: { CURRENT_KEY: "current-secret" } })
    expect(output.exitCode).toBe(0)
    expect(output.stdout.toString().split("\n").slice(0, 3)).toEqual([cwd, "current-secret", "current-argument"])
  })

test("incomplete, corrupt and missing-entry preparations never produce an offline hit", async () => {
  const f = packagePreparation("npm-exec")
  const read = () => Effect.runPromise(readConnectorPreparation({ runtimeRoot: f.root, key: f.value.key, runner: f.value.runner }).pipe(Effect.provide(hostEnvironmentLayer)))
  expect(await read()).toBeUndefined()
  writeFileSync(path.join(f.prefix, "ready.json"), "{unfinished")
  expect(await read()).toBeUndefined()
  await Effect.runPromise(publishConnectorPreparation({ runtimeRoot: f.root, preparation: f.value }).pipe(Effect.provide(hostEnvironmentLayer)))
  const wrongRunner = await Effect.runPromise(readConnectorPreparation({ runtimeRoot: f.root, key: f.value.key, runner: "uv-tool" }).pipe(Effect.provide(hostEnvironmentLayer)))
  expect(wrongRunner).toBeUndefined()
  rmSync(f.entry)
  expect(await read()).toBeUndefined()
  await expect(Effect.runPromise(publishConnectorPreparation({ runtimeRoot: f.root, preparation: f.value }).pipe(Effect.provide(hostEnvironmentLayer)))).rejects.toMatchObject({ kind: "unknown" })
})

test("receipt publication is atomic and removes its partial file if rename fails", async () => {
  const f = packagePreparation("uv-tool")
  const layer = transformEnvironmentFiles(() => ({
    move: (from, to) => Effect.gen(function* () {
      expect(existsSync(to)).toBe(false)
      expect(JSON.parse(readFileSync(from, "utf8"))).toMatchObject({ ready: true, key: f.value.key })
      return yield* Effect.fail(new Environment.Failed({ path: to, cause: "own fixture rename failure" }))
    }),
  }))
  await expect(Effect.runPromise(publishConnectorPreparation({ runtimeRoot: f.root, preparation: f.value }).pipe(Effect.provide(layer)))).rejects.toMatchObject({ kind: "unknown" })
  expect(readdirSync(f.prefix)).toEqual(["service"])
  const outside = { ...f.value, entries: { service: process.execPath } }
  await expect(Effect.runPromise(publishConnectorPreparation({ runtimeRoot: f.root, preparation: outside }).pipe(Effect.provide(hostEnvironmentLayer)))).rejects.toMatchObject({ kind: "unknown" })
})
