import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect, Layer, Logger, PlatformError, References, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import type { LauncherEnvironment } from "@opencode/util/codepuppy-connector-launch"
import { Environment } from "@opencode/core/environment/index"
import {
  installConnectorPython,
  publishConnectorPreparation,
  readConnectorPreparation,
  connectorRunnerEnvironment,
} from "@opencode/core/mcp/codepuppy-connector-launch"
import { hostEnvironmentLayer, recordingEnvironmentLayer, transformEnvironmentFiles } from "./fixture/environment"
import { observeConnectorLaunch } from "@opencode/core/mcp/codepuppy-connector-diagnostic"
import { McpClient } from "@opencode/core/mcp/client"
import { ConfigMCP } from "@opencode/schema/config/mcp"

// Integration layer, affected PR/nightly. Own process fixtures reproduce the actual uv 0.13.10
// optional install_name_tool invocation captured in plan.md r3; no large uv/Python archive in the suite.
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function launcherEnvironment(root: string): LauncherEnvironment {
  const bundled = path.join(root, "bundled")
  return {
    platform: "darwin-arm64",
    pinSet: "a".repeat(64),
    uv: path.join(bundled, "uv"),
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
}
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
  const launchers = launcherEnvironment(root)
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
    value: {
      key,
      runner,
      packages: { "own-process-fixture": "1.0.0" },
      entries: { service: entry },
      required: [prefix],
    },
  }
}

// Integration layer: these are our private receipts and process fixtures, not invented npm/uv metadata.
for (const runner of ["uv-tool", "npm-exec"] as const)
  test(`${runner} receipt reload skips package processes and binds current invocation inputs`, async () => {
    const f = packagePreparation(runner)
    const source = {
      ...f.value,
      cwd: "/old/project",
      environment: { CURRENT_KEY: "old-secret" },
      argv: ["old-argument"],
    }
    await Effect.runPromise(
      publishConnectorPreparation({ runtimeRoot: f.root, preparation: source }).pipe(
        Effect.provide(hostEnvironmentLayer),
      ),
    )
    const spawns: ChildProcess.Command[] = []
    const loaded = await Effect.runPromise(
      readConnectorPreparation({ runtimeRoot: f.root, key: f.value.key, runner }).pipe(
        Effect.provide(recordingEnvironmentLayer(spawns)),
      ),
    )
    expect(loaded).toEqual(f.value)
    expect(spawns).toEqual([])
    const persisted = JSON.parse(readFileSync(path.join(f.prefix, "ready.json"), "utf8"))
    expect(Object.keys(persisted).sort()).toEqual(
      ["schema", "ready", "key", "runner", "packages", "entries", "required"].sort(),
    )
    expect(JSON.stringify(persisted)).not.toContain("old-secret")
    const cwd = path.join(f.root, "current-project")
    mkdirSync(cwd)
    const output = Bun.spawnSync([loaded!.entries.service!, "current-argument"], {
      cwd,
      env: { CURRENT_KEY: "current-secret" },
    })
    expect(output.exitCode).toBe(0)
    expect(output.stdout.toString().split("\n").slice(0, 3)).toEqual([cwd, "current-secret", "current-argument"])
  })

test("incomplete, corrupt and missing-entry preparations never produce an offline hit", async () => {
  const f = packagePreparation("npm-exec")
  const read = () =>
    Effect.runPromise(
      readConnectorPreparation({ runtimeRoot: f.root, key: f.value.key, runner: f.value.runner }).pipe(
        Effect.provide(hostEnvironmentLayer),
      ),
    )
  expect(await read()).toBeUndefined()
  writeFileSync(path.join(f.prefix, "ready.json"), "{unfinished")
  expect(await read()).toBeUndefined()
  await Effect.runPromise(
    publishConnectorPreparation({ runtimeRoot: f.root, preparation: f.value }).pipe(
      Effect.provide(hostEnvironmentLayer),
    ),
  )
  const wrongRunner = await Effect.runPromise(
    readConnectorPreparation({ runtimeRoot: f.root, key: f.value.key, runner: "uv-tool" }).pipe(
      Effect.provide(hostEnvironmentLayer),
    ),
  )
  expect(wrongRunner).toBeUndefined()
  rmSync(f.entry)
  expect(await read()).toBeUndefined()
  await expect(
    Effect.runPromise(
      publishConnectorPreparation({ runtimeRoot: f.root, preparation: f.value }).pipe(
        Effect.provide(hostEnvironmentLayer),
      ),
    ),
  ).rejects.toMatchObject({ kind: "unknown" })
})

test("receipt publication is atomic and removes its partial file if rename fails", async () => {
  const f = packagePreparation("uv-tool")
  const layer = transformEnvironmentFiles(() => ({
    move: (from, to) =>
      Effect.gen(function* () {
        expect(existsSync(to)).toBe(false)
        expect(JSON.parse(readFileSync(from, "utf8"))).toMatchObject({ ready: true, key: f.value.key })
        return yield* Effect.fail(new Environment.Failed({ path: to, cause: "own fixture rename failure" }))
      }),
  }))
  await expect(
    Effect.runPromise(
      publishConnectorPreparation({ runtimeRoot: f.root, preparation: f.value }).pipe(Effect.provide(layer)),
    ),
  ).rejects.toMatchObject({ kind: "unknown" })
  expect(readdirSync(f.prefix)).toEqual(["service"])
  const outside = { ...f.value, entries: { service: process.execPath } }
  await expect(
    Effect.runPromise(
      publishConnectorPreparation({ runtimeRoot: f.root, preparation: outside }).pipe(
        Effect.provide(hostEnvironmentLayer),
      ),
    ),
  ).rejects.toMatchObject({ kind: "unknown" })
})

// Integration: actual child handles. Splitting actual stderr bytes at the Location seam forces every credential across chunks.
function diagnosticLayer() {
  return Layer.effect(
    Environment.Service,
    Effect.gen(function* () {
      const current = yield* Environment.Service
      return Environment.Service.of({
        ...current,
        spawner: ChildProcessSpawner.make((command) =>
          current.spawner
            .spawn(command)
            .pipe(
              Effect.map((handle) =>
                ChildProcessSpawner.makeHandle({
                  ...handle,
                  stderr: handle.stderr.pipe(
                    Stream.flatMap((bytes) => Stream.fromIterable([...bytes].map((byte) => Uint8Array.of(byte)))),
                  ),
                }),
              ),
            ),
        ),
      })
    }),
  ).pipe(Layer.provide(hostEnvironmentLayer))
}
function diagnosticInput() {
  const root = mkdtempSync(path.join(tmpdir(), "connector-diagnostic-"))
  roots.push(root)
  return {
    identity: { directory: root, server: "own-crash", attempt: "own/../attempt" },
    requestedCommand: ["own-service", "known-secret"],
    cwd: root,
    runtimeRoot: root,
    secrets: ["known-secret", "cross\nline-secret"],
  }
}

test("connector diagnostics tee complete masked stderr before stdio and preserve real exit facts", async () => {
  const input = diagnosticInput()
  const logs: string[] = []
  const stderr =
    "first héllo 🙂\nknown-secret\ncross\nline-secret\nAuthorization: Basic unknown-auth\nhttps://user:password@own.invalid/path?sig=signed-value&ordinary=retained\n" +
    "original-detail ".repeat(400) +
    "last"
  const value = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const observed = yield* observeConnectorLaunch(input)
        observed.stage("running")
        const handle = yield* observed.environment.spawner.spawn(
          ChildProcess.make(
            process.execPath,
            [
              "-e",
              "process.stderr.write(process.env.OWN_STDERR);process.stdout.write('protocol-output');process.exitCode=23",
              "known-secret",
            ],
            { cwd: input.cwd, env: { OWN_STDERR: stderr }, extendEnv: false },
          ),
        )
        const [code, out, err] = yield* Effect.all(
          [handle.exitCode, Stream.mkUint8Array(handle.stdout), Stream.mkUint8Array(handle.stderr)],
          { concurrency: "unbounded" },
        )
        const diagnostic = yield* observed.diagnostic
        return { code, out: new TextDecoder().decode(out), err: new TextDecoder().decode(err), diagnostic }
      }),
    ).pipe(
      Effect.provide(diagnosticLayer()),
      Effect.provideService(
        References.CurrentLoggers,
        new Set([
          Logger.make((options) => {
            logs.push(JSON.stringify(options.message))
          }),
        ]),
      ),
      Effect.provideService(References.MinimumLogLevel, "Debug"),
    ),
  )
  expect(Number(value.code)).toBe(23)
  expect(value.out).toBe("protocol-output")
  expect(value.diagnostic).toMatchObject({
    identity: input.identity,
    exitCode: 23,
    signal: null,
    stage: "running",
    stderr: value.err,
    requestedCommand: ["own-service", "[redacted]"],
  })
  expect(value.err).toBe(
    "first héllo 🙂\n[redacted]\n[redacted]\nAuthorization: [redacted]\nhttps://[redacted]@own.invalid/path?sig=[redacted]&ordinary=retained\n" +
      "original-detail ".repeat(400) +
      "last",
  )
  const persisted = readFileSync(value.diagnostic.transcriptFile, "utf8")
  expect(JSON.parse(persisted).stderr).toBe(value.err)
  expect(value.diagnostic.transcriptFile.startsWith(path.join(input.runtimeRoot, "diagnostics") + path.sep)).toBe(true)
  expect(logs.some((line) => line.includes("spawning connector process"))).toBe(true)
  for (const secret of ["known-secret", "line-secret", "unknown-auth", "password", "signed-value"])
    expect([JSON.stringify(value.diagnostic), persisted, ...logs].join("\n")).not.toContain(secret)
})

test("connector diagnostics keep null exit before spawn and observe the actual terminating signal", async () => {
  const input = diagnosticInput()
  const value = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const observed = yield* observeConnectorLaunch(input)
        const before = yield* observed.diagnostic
        expect(before.exitCode).toBeNull()
        expect(before.signal).toBeNull()
        const missing = yield* observed.environment.spawner
          .spawn(ChildProcess.make(path.join(input.cwd, "missing-known-secret"), [], { cwd: input.cwd }))
          .pipe(Effect.exit)
        expect(missing._tag).toBe("Failure")
        const failed = yield* observed.diagnostic
        expect(failed.exitCode).toBeNull()
        expect(readFileSync(failed.transcriptFile, "utf8")).not.toContain("known-secret")
        const handle = yield* observed.environment.spawner.spawn(
          ChildProcess.make(process.execPath, ["-e", "process.stdout.write('ready');process.stdin.resume()"], {
            cwd: input.cwd,
          }),
        )
        // Readiness is an output event, not a timed sleep or latency assertion.
        yield* Stream.runForEach(handle.stdout.pipe(Stream.take(1)), () => Effect.void)
        yield* handle.kill({ killSignal: "SIGTERM" })
        yield* handle.exitCode.pipe(Effect.ignore)
        return yield* observed.diagnostic
      }),
    ).pipe(Effect.provide(hostEnvironmentLayer)),
  )
  expect(value.exitCode).toBeNull()
  expect(value.signal).toBe("SIGTERM")
})

test("connector diagnostics retain the full crash and mask the bytes production MCP stdio can log", async () => {
  const input = diagnosticInput()
  const logs: string[] = []
  const chunks: string[] = []
  const stderr = "known-secret " + "original crash detail ".repeat(150) + "last crash line"
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const observed = yield* observeConnectorLaunch(input)
        observed.stage("handshake")
        // Stdio runs in its own Effect.runPromise and keeps only its Scope, so a caller logger is
        // not its logger. Capture the actual bytes it reads immediately before its debug-log tap.
        const stdioEnvironment = Environment.Service.of({
          ...observed.environment,
          spawner: ChildProcessSpawner.make((command) =>
            observed.environment.spawner.spawn(command).pipe(
              Effect.map((handle) =>
                ChildProcessSpawner.makeHandle({
                  ...handle,
                  stderr: handle.stderr.pipe(
                    Stream.tap((bytes) =>
                      Effect.sync(() => {
                        chunks.push(new TextDecoder().decode(bytes))
                      }),
                    ),
                  ),
                }),
              ),
            ),
          ),
        })
        const failure = yield* McpClient.connect({
          server: input.identity.server,
          directory: input.cwd,
          config: new ConfigMCP.Local({
            type: "local",
            command: [process.execPath, new URL("./fixture/codepuppy-mcp-startup-stdio.ts", import.meta.url).pathname],
            environment: { CODEPUPPY_MCP_EXIT_STDERR: stderr },
          }),
        }).pipe(Effect.provideService(Environment.Service, stdioEnvironment), Effect.exit)
        expect(failure._tag).toBe("Failure")
        return yield* observed.diagnostic
      }),
    ).pipe(
      Effect.provide(diagnosticLayer()),
      Effect.provideService(
        References.CurrentLoggers,
        new Set([
          Logger.make((options) => {
            logs.push(JSON.stringify(options.message))
          }),
        ]),
      ),
      Effect.provideService(References.MinimumLogLevel, "Debug"),
    ),
  )
  expect(result).toMatchObject({
    stage: "handshake",
    exitCode: 3,
    signal: null,
    stderr: stderr.replace("known-secret", "[redacted]") + "\n",
  })
  expect(result.stderr.length).toBeGreaterThan(1000)
  expect(chunks.join("")).toBe(result.stderr)
  expect(logs.join("\n")).not.toContain("known-secret")
  expect(readFileSync(result.transcriptFile, "utf8")).not.toContain("known-secret")
})

test("connector diagnostics flush unterminated stderr on pipe failure without exposing a known secret", async () => {
  const input = diagnosticInput()
  const layer = Layer.effect(
    Environment.Service,
    Effect.gen(function* () {
      const current = yield* Environment.Service
      return Environment.Service.of({
        ...current,
        spawner: ChildProcessSpawner.make((command) =>
          current.spawner
            .spawn(command)
            .pipe(
              Effect.map((handle) =>
                ChildProcessSpawner.makeHandle({
                  ...handle,
                  stderr: handle.stderr.pipe(
                    Stream.concat(
                      Stream.fail(
                        PlatformError.systemError({
                          _tag: "Unknown",
                          module: "ChildProcess",
                          method: "read",
                          description: "own pipe failure known-secret",
                        }),
                      ),
                    ),
                  ),
                }),
              ),
            ),
        ),
      })
    }),
  ).pipe(Layer.provide(hostEnvironmentLayer))
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const observed = yield* observeConnectorLaunch(input)
        const handle = yield* observed.environment.spawner.spawn(
          ChildProcess.make(process.execPath, ["-e", "process.stderr.write('unterminated known-secret')"], {
            cwd: input.cwd,
          }),
        )
        const [exit, stream] = yield* Effect.all(
          [handle.exitCode, Stream.runDrain(handle.stderr).pipe(Effect.exit), Stream.runDrain(handle.stdout)],
          { concurrency: "unbounded" },
        )
        expect(Number(exit)).toBe(0)
        expect(stream._tag).toBe("Failure")
        return yield* observed.diagnostic
      }),
    ).pipe(Effect.provide(layer)),
  )
  expect(result.stderr).toBe("unterminated [redacted]")
  expect(readFileSync(result.transcriptFile, "utf8")).not.toContain("known-secret")
})

test("connector diagnostics continue observing a real MCP process after connection succeeds", async () => {
  const input = diagnosticInput()
  const pidFile = path.join(input.runtimeRoot, "child.pid")
  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const observed = yield* observeConnectorLaunch(input)
        const connection = yield* McpClient.connect({
          server: input.identity.server,
          directory: input.cwd,
          config: new ConfigMCP.Local({
            type: "local",
            protocol: "legacy",
            command: [process.execPath, new URL("./fixture/codepuppy-mcp-startup-stdio.ts", import.meta.url).pathname],
            environment: { CODEPUPPY_MCP_PID_FILE: pidFile },
          }),
        }).pipe(Effect.provideService(Environment.Service, observed.environment))
        expect((yield* connection.tools()).map((tool) => tool.name)).toEqual(["echo"])
        observed.stage("running")
        const closed = new Promise<void>((resolve) => {
          connection.onClose(() => resolve())
        })
        process.kill(Number(readFileSync(pidFile, "utf8")), "SIGTERM")
        yield* Effect.promise(() => closed)
        return yield* observed.diagnostic
      }),
    ).pipe(Effect.provide(hostEnvironmentLayer)),
  )
  expect(result).toMatchObject({ stage: "running", exitCode: null, signal: "SIGTERM" })
})

// Pure layer: owned LauncherEnvironment data only; no file, process or global-environment mutation.
for (const runner of ["uv-tool", "npm-exec"] as const)
  test(`${runner} environment keeps bundled runtimes ahead of old PATH and binds current business inputs`, () => {
    const launchers = launcherEnvironment(path.resolve("owned-runtime"))
    const input = { runner, launchers, key: "d".repeat(64), inherited: { PATH: "/old/bin:/shared/bin", HOME: "/own/home", NODE_OPTIONS: "--require old-host", PYTHONHOME: "/old/python", PYTHONPATH: "/old/modules", VIRTUAL_ENV: "/old/venv", UV_CACHE_DIR: "/r1/cache", XDG_CONFIG_HOME: "/user/config", NPM_CONFIG_IGNORE_SCRIPTS: "false" }, declared: { PATH: "/declared/bin:/shared/bin", PRIVATE_KEY: "current-secret", npm_config_registry: "https://registry.invalid", npm_config_ignore_scripts: "false", NODE_OPTIONS: "--require declared-module" }, packageBins: ["/prepared/bin"], python: "/pinned/python/bin/python3" }
    const before = structuredClone(input)
    const env = connectorRunnerEnvironment(input)
    expect(env.PATH?.split(":")).toEqual(["/prepared/bin", path.dirname(input.launchers.uv), "/pinned/python/bin", "/declared/bin", "/shared/bin", "/old/bin"])
    expect(env).toMatchObject({ HOME: "/own/home", NODE_OPTIONS: "--require declared-module", PRIVATE_KEY: "current-secret", npm_config_registry: "https://registry.invalid", UV_CACHE_DIR: "/r1/cache", XDG_CONFIG_HOME: "/user/config", UV_PYTHON: "3.12.16" })
    for (const key of ["PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV"]) expect(env).not.toHaveProperty(key)
    if (runner === "uv-tool") expect(env).toMatchObject({ UV_TOOL_DIR: path.join(input.launchers.runtimeRoot, "prepared", input.key, "uv/tools"), UV_TOOL_BIN_DIR: path.join(input.launchers.runtimeRoot, "prepared", input.key, "uv/bin") })
    if (runner === "npm-exec") {
      expect(env).toMatchObject({ npm_config_prefer_offline: "true", npm_config_ignore_scripts: "true", npm_config_update_notifier: "false" })
      expect(env).not.toHaveProperty("NPM_CONFIG_IGNORE_SCRIPTS")
      expect(env).not.toHaveProperty("UV_TOOL_DIR")
    }
    expect(input).toEqual(before)
    const preparation = connectorRunnerEnvironment({ ...input, declared: {}, packageBins: [], python: undefined })
    expect(preparation.PATH?.startsWith(path.dirname(input.launchers.uv))).toBe(true)
    expect(preparation).not.toHaveProperty("NODE_OPTIONS")
  })

test("Windows runner environment merges case-insensitive keys and PATH without retaining old runtime controls", () => {
  const launchers = { ...launcherEnvironment(path.resolve("owned-runtime")), platform: "win32-x64" as const, runtimeRoot: "C:\\app-data\\connector-runtime", uv: "C:\\app-data\\uv\\uv.exe", node: "C:\\app-data\\node\\node.exe" }
  const env = connectorRunnerEnvironment({ runner: "npm-exec", launchers, key: "e".repeat(64), inherited: { Path: "C:\\old;C:\\shared", Node_Options: "--require old", pythonpath: "C:\\old-modules", Home: "C:\\own-home", KEY: "old-secret" }, declared: { PATH: "c:\\shared;C:\\declared", key: "current-secret" }, packageBins: ["C:\\prepared\\bin"], python: "C:\\python\\python.exe" })
  expect(env.PATH).toBe("C:\\prepared\\bin;C:\\app-data\\uv;C:\\app-data\\node;C:\\python;c:\\shared;C:\\declared;C:\\old")
  expect(env).toMatchObject({ key: "current-secret", Home: "C:\\own-home" })
  for (const key of ["Path", "KEY", "Node_Options", "pythonpath"]) expect(env).not.toHaveProperty(key)
})
