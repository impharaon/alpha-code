import { afterEach, expect, test } from "bun:test"
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  rmSync,
  copyFileSync,
  symlinkSync,
  cpSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { gunzipSync } from "node:zlib"
import { connectorPreparationKey } from "@opencode/core/mcp/codepuppy-connector-key"
import {
  parseUvToolSettings,
  readUvLaunchDeclaration,
  uvToolInstallArguments,
  parseUvResolvedValue,
  readUvLaunchEnvironment,
  normalizeUvLaunchDeclaration,
  checkUvPinnedPythonRequest,
  uvEditableInstallArguments,
} from "@opencode/core/mcp/codepuppy-uv-launch"
import { UV_TOOL_SETTINGS, UV_SERVICE_COMMAND } from "./fixture/uv-tool-settings"
import { readNpmLaunchDeclaration, normalizeNpmLaunchDeclaration, installNpmConnector } from "@opencode/core/mcp/codepuppy-npm-launch"
import { Deferred, Effect, Fiber, Layer, Logger, Option, PlatformError, References, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/process"
import type {
  ConnectorLaunchHost,
  LaunchSnapshot,
  LauncherEnvironment,
  PreparedLaunch,
} from "@opencode/util/codepuppy-connector-launch"
import { connectorDiagnosticTranscript, isConnectorLaunchFailure } from "@opencode/util/codepuppy-connector-launch"
import { Environment } from "@opencode/core/environment/index"
import {
  installConnectorPython,
  publishConnectorPreparation,
  readConnectorPreparation,
  connectorRunnerEnvironment,
  captureNpmConnectorPreparation,
  preparedNpmEntry,
  bindConnectorLaunch,
  prepareConnectorLaunch,
} from "@opencode/core/mcp/codepuppy-connector-launch"
import { hostEnvironmentLayer, recordingEnvironmentLayer, transformEnvironmentFiles } from "./fixture/environment"
import { observeConnectorLaunch } from "@opencode/core/mcp/codepuppy-connector-diagnostic"
import { McpClient } from "@opencode/core/mcp/client"
import { McpConnection } from "@opencode/core/mcp/connection"
import { START_CONCURRENCY, startPermits, classifyStartFailure } from "@opencode/core/mcp/codepuppy-startup"
import { ConfigMCP } from "@opencode/schema/config/mcp"
import { readConnectorSource } from "@opencode/core/mcp/codepuppy-connector-content"

// Integration layer: the real client/stdio/Location executes the prepared entry. The own
// stdio fixture reports the current business inputs; no npm/uv resolver or registry is involved.
test("prepared MCP launch directly executes the entry with current argv cwd and isolated environment", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "connector-prepared-client-"))
  roots.push(root)
  const launchFile = path.join(root, "launch.json")
  const commands: ChildProcess.Command[] = []
  const prepared: PreparedLaunch = {
    runner: "npm-exec",
    key: "a".repeat(64),
    command: [
      process.execPath,
      new URL("./fixture/codepuppy-mcp-startup-stdio.ts", import.meta.url).pathname,
      "--business",
      root,
    ],
    cwd: root,
    environment: { PATH: process.env.PATH!, CODEPUPPY_MCP_LAUNCH_FILE: launchFile, CONNECTOR_CURRENT_KEY: "rotated" },
  }
  const options = {
    server: "prepared",
    directory: tmpdir(),
    prepared,
    config: new ConfigMCP.Local({
      type: "local",
      protocol: "legacy",
      command: ["must-not-run-npx"],
      environment: { CODEPUPPY_MCP_EXIT_STDERR: "wrong environment" },
    }),
  }
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* McpClient.connect(options)
        expect((yield* client.tools()).map((tool) => tool.name)).toEqual(["echo"])
      }),
    ).pipe(Effect.provide(recordingEnvironmentLayer(commands))),
  )
  expect(JSON.parse(readFileSync(launchFile, "utf8"))).toEqual({
    argv: ["--business", root],
    cwd: root,
    key: "rotated",
    homePresent: false,
  })
  expect(commands).toHaveLength(1)
  expect(commands[0]).toMatchObject({ command: process.execPath, options: { extendEnv: false } })
})

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
          current.spawner.spawn(command).pipe(
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
    "first héllo 🙂\nknown-secret\ncross\nline-secret\nAuthorization: Basic unknown-auth\nhttps://user:password@own.invalid/path?sig=signed-value&%70assword=query-credential&credentialRef=private-ref&authVersion=private-version&ordinary=retained\n" +
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
    "first héllo 🙂\n[redacted]\n[redacted]\nAuthorization: [redacted]\nhttps://[redacted]@own.invalid/path?sig=[redacted]&%70assword=[redacted]&credentialRef=[redacted]&authVersion=[redacted]&ordinary=retained\n" +
      "original-detail ".repeat(400) +
      "last",
  )
  const persisted = readFileSync(value.diagnostic.transcriptFile, "utf8")
  expect(JSON.parse(persisted).stderr).toBe(value.err)
  expect(value.diagnostic.transcriptFile.startsWith(path.join(input.runtimeRoot, "diagnostics") + path.sep)).toBe(true)
  expect(logs.some((line) => line.includes("spawning connector process"))).toBe(true)
  for (const secret of [
    "known-secret",
    "line-secret",
    "unknown-auth",
    "password",
    "signed-value",
    "query-credential",
    "private-ref",
    "private-version",
  ])
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
          current.spawner.spawn(command).pipe(
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
// Integration layer: a real McpConnection + SDK + stdio. The host is the frozen transport
// boundary; its dependency/asset results stand in for the root assembly waiting on #1759.
function launchConnection(input: {
  root: string
  snapshots: LaunchSnapshot[]
  spawns: ChildProcess.Command[]
  missing?: string[]
  prepare?: NonNullable<McpConnection.Input["localLaunch"]>["packagePreparation"]
  firstParty?: NonNullable<McpConnection.Input["localLaunch"]>["firstParty"]
  assets?: () => Promise<LauncherEnvironment>
  command?: string[]
  cwd?: string
  environment?: Record<string, string>
}) {
  return Effect.gen(function* () {
    const environment = yield* Environment.Service
    const scope = yield* Effect.scope
    const closed = yield* Deferred.make<void>()
    const failures: McpConnection.Failure[] = []
    const unused = async (): Promise<never> => {
      throw Error("unused host port")
    }
    const host: ConnectorLaunchHost = {
      changed: (snapshot) => input.snapshots.push(structuredClone(snapshot)),
      runtimeDependencies: async () => ({
        runtimeDep: input.missing ?? [],
        executables: {},
        missing: input.missing ?? [],
      }),
      resolveAssets: input.assets ?? unused,
      ensureFile: unused,
      beginEgress: unused,
      egressEvidence: unused,
      endEgress() {},
      prepareFiles: unused,
    }
    const connection = McpConnection.make({
      name: "attempt-service",
      directory: input.root,
      config: new ConfigMCP.Local({
        type: "local",
        protocol: "legacy",
        command: input.command ?? [
          process.execPath,
          new URL("./fixture/codepuppy-mcp-startup-stdio.ts", import.meta.url).pathname,
        ],
        environment: input.environment,
        cwd: input.cwd,
      }),
      authProvider: Effect.succeed(undefined),
      elicitation: { create: () => Effect.die("unused elicitation"), complete: () => Effect.void },
      environment: {
        ...environment,
        spawner: ChildProcessSpawner.make((command) => {
          input.spawns.push(command)
          return environment.spawner.spawn(command)
        }),
      },
      fetch: globalThis.fetch,
      scope,
      lock: (effect) => effect,
      callbacks: (effect) => Effect.runFork(effect),
      fork: (effect) => Effect.runFork(effect),
      events: {
        connecting: Effect.void,
        connected: Effect.void,
        settled: Effect.void,
        changed: () => Effect.void,
        failed: (failure) =>
          Effect.sync(() => {
            failures.push(failure)
          }),
        closed: () => connection.stop.pipe(Effect.andThen(Deferred.succeed(closed, undefined))),
      },
      localLaunch: {
        sidecarGeneration: "generation-r5",
        runtimeRoot: input.root,
        secrets: ["current-secret"],
        host,
        packagePreparation: input.prepare,
        firstParty: input.firstParty,
      },
    })
    return { connection, closed, failures }
  })
}
/** The attempt's persisted diagnostic, at the one derivation main and the sidecar read (§4.6); no connection API exposes it. */
function transcript(root: string, identity: LaunchSnapshot["identity"]) {
  return JSON.parse(readFileSync(connectorDiagnosticTranscript(root, identity.attempt), "utf8"))
}

function connectionRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "connector-attempt-"))
  roots.push(root)
  return root
}

test("connector preparation runs before permits and publishes progress before the real handshake", async () => {
  const root = connectionRoot()
  const snapshots: LaunchSnapshot[] = []
  const spawns: ChildProcess.Command[] = []
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const ready = yield* Deferred.make<void>()
        const preparing = yield* Deferred.make<boolean>()
        const current = yield* launchConnection({
          root,
          snapshots,
          spawns,
          command: ["must-not-run-uvx"],
          prepare: ({ preparing: report, runtimeDep }) =>
            Effect.gen(function* () {
              expect(runtimeDep.missing).toEqual([])
              const available = Option.isSome(yield* startPermits.withPermitsIfAvailable(START_CONCURRENCY)(Effect.void))
              report("python", { unit: "bytes", completed: 42, total: 100 })
              yield* Deferred.succeed(preparing, available)
              yield* Deferred.await(ready)
              return {
                runner: "uv-tool" as const,
                key: "b".repeat(64),
                cwd: root,
                environment: { PATH: process.env.PATH! },
                command: [
                  process.execPath,
                  new URL("./fixture/codepuppy-mcp-startup-stdio.ts", import.meta.url).pathname,
                ] as [string, ...string[]],
              }
            }),
        })
        const fiber = yield* Effect.forkScoped(current.connection.start)
        expect(yield* Deferred.await(preparing)).toBe(true)
        expect(spawns).toHaveLength(0)
        expect(snapshots.map((row) => row.state.phase)).toEqual(["preparing", "preparing"])
        expect(snapshots[1].state).toEqual({
          phase: "preparing",
          stage: "python",
          progress: { unit: "bytes", completed: 42, total: 100 },
        })
        yield* Deferred.succeed(ready, undefined)
        yield* Fiber.join(fiber)
        expect(current.failures).toEqual([])
        expect(snapshots.map((row) => row.state.phase)).toEqual(["preparing", "preparing", "connecting", "connected"])
        expect(snapshots.map((row) => row.sequence)).toEqual([1, 2, 3, 4])
        expect(new Set(snapshots.map((row) => row.identity.attempt)).size).toBe(1)
        expect(spawns).toHaveLength(1)
        // The prepared entry ran in place of the declared runner command.
        expect(spawns[0]).toMatchObject({ command: process.execPath })
        yield* current.connection.stop
        expect(snapshots.at(-1)?.state.phase).toBe("disabled")
      }),
    ).pipe(Effect.provide(hostEnvironmentLayer)),
  )
})

test("connector dependency and download failures do not spawn and preserve a single failure fact", async () => {
  for (const failure of ["dependency", "download"] as const) {
    const root = connectionRoot()
    const snapshots: LaunchSnapshot[] = []
    const spawns: ChildProcess.Command[] = []
    let prepared = false
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const current = yield* launchConnection({
            root,
            snapshots,
            spawns,
            missing: failure === "dependency" ? ["git"] : [],
            prepare: () =>
              Effect.suspend(() => {
                prepared = true
                return Effect.fail({ kind: "download", detail: "interrupted current-secret" } as const)
              }),
          })
          yield* current.connection.start
          expect(prepared).toBe(failure === "download")
          expect(spawns).toHaveLength(0)
          expect(current.failures).toHaveLength(1)
          expect(snapshots.at(-1)?.state).toMatchObject({ phase: "failed", failure: { kind: failure } })
          const diagnostic = transcript(root, snapshots[0].identity)
          expect(diagnostic).toMatchObject({ identity: snapshots[0].identity, exitCode: null, signal: null, effectiveCommand: [] })
          expect(JSON.stringify(snapshots)).not.toContain("current-secret")
        }),
      ).pipe(Effect.provide(hostEnvironmentLayer)),
    )
  }
})

test("connector cancellation during preparation prevents a late result from spawning or publishing failure", async () => {
  const root = connectionRoot()
  const snapshots: LaunchSnapshot[] = []
  const spawns: ChildProcess.Command[] = []
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const preparing = yield* Deferred.make<void>()
        const pending = Promise.withResolvers<PreparedLaunch>()
        const current = yield* launchConnection({
          root,
          snapshots,
          spawns,
          prepare: () =>
            Deferred.succeed(preparing, undefined).pipe(Effect.andThen(Effect.promise(() => pending.promise))),
        })
        const fiber = yield* Effect.forkScoped(current.connection.start)
        yield* Deferred.await(preparing)
        yield* Fiber.interrupt(fiber)
        const length = snapshots.length
        pending.resolve({
          runner: "npm-exec",
          key: "c".repeat(64),
          command: ["must-not-run-late"],
          cwd: root,
          environment: {},
        })
        yield* Effect.promise(() => pending.promise)
        yield* Effect.yieldNow
        expect(spawns).toHaveLength(0)
        expect(snapshots).toHaveLength(length)
        expect(snapshots.at(-1)?.state.phase).toBe("disabled")
        expect(snapshots.some((row) => row.state.phase === "failed")).toBe(false)
        expect(current.failures).toEqual([])
      }),
    ).pipe(Effect.provide(hostEnvironmentLayer)),
  )
})

test("connector production attempt records a crash after connection with complete stderr and real exit", async () => {
  const root = connectionRoot()
  const snapshots: LaunchSnapshot[] = []
  const spawns: ChildProcess.Command[] = []
  const output = "actual-crash current-secret " + "x".repeat(7000)
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const current = yield* launchConnection({
          root,
          snapshots,
          spawns,
          environment: { CODEPUPPY_MCP_CRASH_STDERR: output },
        })
        yield* current.connection.start
        expect(current.connection.client).toBeDefined()
        yield* current.connection.client!.callTool({ name: "crash", args: {} }).pipe(Effect.ignore)
        yield* Deferred.await(current.closed)
        expect(snapshots.map((row) => row.state.phase)).toEqual(["connecting", "connected", "failed"])
        const diagnostic = transcript(root, snapshots[0].identity)
        expect(diagnostic).toMatchObject({
          exitCode: 17,
          signal: null,
          stage: "running",
          stderr: output.replace("current-secret", "[redacted]") + "\n",
        })
        expect(diagnostic!.effectiveCommand[0]).toBe(process.execPath)
        expect(readFileSync(diagnostic!.transcriptFile, "utf8")).not.toContain("current-secret")
      }),
    ).pipe(Effect.provide(hostEnvironmentLayer)),
  )
})

test("first-party Node waits for the trusted assets without entering package preparation or a permit", async () => {
  const root = connectionRoot()
  const snapshots: LaunchSnapshot[] = []
  const spawns: ChildProcess.Command[] = []
  const launchers = { ...launcherEnvironment(root), node: process.execPath }
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const resolving = yield* Deferred.make<void>()
        const assets = Promise.withResolvers<LauncherEnvironment>()
        const current = yield* launchConnection({
          root,
          snapshots,
          spawns,
          firstParty: {
            launchers,
            declaration: { tools: [], declarationSha256: "a".repeat(64), recipeSha256: "b".repeat(64) },
          },
          assets: () => {
            Effect.runSync(Deferred.succeed(resolving, undefined))
            return assets.promise
          },
        })
        const fiber = yield* Effect.forkScoped(current.connection.start)
        yield* Deferred.await(resolving)
        expect(Option.isSome(yield* startPermits.withPermitsIfAvailable(START_CONCURRENCY)(Effect.void))).toBe(true)
        expect(spawns).toHaveLength(0)
        expect(snapshots.map((row) => row.state)).toEqual([
          { phase: "preparing", stage: "launcher", progress: { unit: "activity", detail: "Verifying bundled Node" } },
        ])
        assets.resolve(launchers)
        yield* Fiber.join(fiber)
        expect(current.failures).toEqual([])
        expect(snapshots.map((row) => row.state.phase)).toEqual(["preparing", "connecting", "connected"])
        expect(spawns).toHaveLength(1)
        expect(spawns[0]).toMatchObject({ command: process.execPath, options: { extendEnv: true, env: {} } })
        yield* current.connection.stop
      }),
    ).pipe(Effect.provide(hostEnvironmentLayer)),
  )
})

test("first-party Node refuses an asset result from a different trusted descriptor", async () => {
  const root = connectionRoot()
  const snapshots: LaunchSnapshot[] = []
  const spawns: ChildProcess.Command[] = []
  const launchers = { ...launcherEnvironment(root), node: process.execPath }
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const current = yield* launchConnection({
          root,
          snapshots,
          spawns,
          firstParty: {
            launchers,
            declaration: { tools: [], declarationSha256: "a".repeat(64), recipeSha256: "b".repeat(64) },
          },
          assets: async () => ({ ...launchers, node: path.join(root, "different-node") }),
        })
        yield* current.connection.start
        expect(spawns).toHaveLength(0)
        expect(snapshots.at(-1)?.state).toMatchObject({
          phase: "failed",
          failure: { kind: "unknown", detail: "Bundled Node changed during connector preparation" },
        })
      }),
    ).pipe(Effect.provide(hostEnvironmentLayer)),
  )
})

test("connector missing workspace is reported before package preparation or service spawn", async () => {
  const root = connectionRoot()
  const snapshots: LaunchSnapshot[] = []
  const spawns: ChildProcess.Command[] = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const current = yield* launchConnection({ root, snapshots, spawns, cwd: path.join(root, "missing"),
      prepare: () => Effect.die("must not prepare without a workspace"),
    })
    yield* current.connection.start
    expect(spawns).toHaveLength(0)
    expect(snapshots.at(-1)?.state).toMatchObject({ phase: "failed", failure: { kind: "workspace", reason: "missing" } })
  })).pipe(Effect.provide(hostEnvironmentLayer)))
})

// Integration layer, affected PR/nightly. These THREE sources + LICENSE are unmodified
// npm 11.20.0 files from the verified Node 26.13.1 archive (plan.md r2/r5); definitions,
// config and npa are the repository's existing util dependencies (10.8.1 / 13.0.2).
// The pinned 10.13.0/npm 11.20.0 combination is additionally verified by the real probe.
// No fake npm grammar or external-format fixture is written here.
function npmDeclarationFixture() {
  const root = connectionRoot()
  const npm = path.join(root, "npm")
  for (const dir of ["bin", "lib/utils", "node_modules/@npmcli"]) mkdirSync(path.join(npm, dir), { recursive: true })
  copyFileSync(new URL("./fixture/npm-launch/npx-cli.js", import.meta.url), path.join(npm, "bin/npx-cli.js"))
  copyFileSync(new URL("./fixture/npm-launch/npm-cli.js", import.meta.url), path.join(npm, "bin/npm-cli.js"))
  copyFileSync(new URL("./fixture/npm-launch/cmd-list.js", import.meta.url), path.join(npm, "lib/utils/cmd-list.js"))
  const util = createRequire(new URL("../../util/package.json", import.meta.url))
  const config = util.resolve("@npmcli/config/package.json")
  symlinkSync(path.dirname(config), path.join(npm, "node_modules/@npmcli/config"), "dir")
  symlinkSync(path.dirname(util.resolve("npm-package-arg/package.json")), path.join(npm, "node_modules/npm-package-arg"), "dir")
  symlinkSync(path.dirname(createRequire(config).resolve("abbrev/package.json")), path.join(npm, "node_modules/abbrev"), "dir")
  copyFileSync(new URL("../../util/package.json", import.meta.url), path.join(root, "package.json"))
  mkdirSync(path.join(root, "home"))
  return {
    root,
    launchers: { ...launcherEnvironment(root), node: process.execPath, npmCli: path.join(npm, "bin/npm-cli.js"), npxCli: path.join(npm, "bin/npx-cli.js") },
    environment: { HOME: path.join(root, "home"), PATH: process.env.PATH! },
  }
}
test("official npx boolean switches preserve the service argument boundary and repeated package specs", async () => {
  const input = npmDeclarationFixture()
  const parse = (args: string[]) => Effect.runPromise(Effect.scoped(readNpmLaunchDeclaration({ ...input, cwd: input.root, syntax: "npx", arguments: args })).pipe(Effect.provide(hostEnvironmentLayer)))
  const implicit = await parse(["--yes", "one@1.2.3", "--package=business-argument"])
  expect(implicit.arguments).toEqual(["one@1.2.3", "--package=business-argument"])
  expect(implicit.packages).toEqual([])
  const explicit = await parse(["--yes", "-p", "@scope/one@1.2.3", "--package=two@npm:three@^4", "--", "my-bin", "--package=service-flag"])
  expect(explicit.arguments).toEqual(["my-bin", "--package=service-flag"])
  expect(explicit.packages).toEqual([{ specification: "@scope/one@1.2.3", name: "@scope/one", type: "version" }, { specification: "two@npm:three@^4", name: "two", type: "alias" }])
})

test("official npm exec aliases and call syntax are parsed without executing the service", async () => {
  const input = npmDeclarationFixture()
  const marker = path.join(input.root, "must-not-execute")
  writeFileSync(path.join(input.root, ".npmrc"), "@private:registry=https://registry.example.invalid/\n//registry.example.invalid/:_authToken=own-fixture-secret\n")
  const parse = (args: string[]) => Effect.runPromise(Effect.scoped(readNpmLaunchDeclaration({ ...input, cwd: input.root, syntax: "npm-exec", arguments: args })).pipe(Effect.provide(hostEnvironmentLayer)))
  const call = await parse(["exec", "--package=one@1.2.3", "--call", `printf ran > ${marker}`])
  expect(call.call).toBe(`printf ran > ${marker}`)
  expect(call.arguments).toEqual([])
  expect(call.options["@private:registry"]).toBe("https://registry.example.invalid/")
  expect(call.options["//registry.example.invalid/:_authToken"]).toBe("own-fixture-secret")
  const alias = await parse(["x", "--package=one@1.2.3", "--", "my-bin", "-p", "business-value"])
  expect(alias.arguments).toEqual(["my-bin", "-p", "business-value"])
  expect(existsSync(marker)).toBe(false)
})

test("connector native spawn failure publishes the actual missing executable as its dependency fact", async () => {
  const root = connectionRoot()
  const snapshots: LaunchSnapshot[] = []
  const spawns: ChildProcess.Command[] = []
  const program = path.join(root, "missing-program")
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const current = yield* launchConnection({ root, snapshots, spawns, command: [program] })
        yield* current.connection.start
        expect(snapshots.at(-1)?.state).toMatchObject({ phase: "failed", failure: { kind: "dependency", program } })
        expect(transcript(root, snapshots[0].identity)).toMatchObject({
          exitCode: null,
          effectiveCommand: [program],
        })
      }),
    ).pipe(Effect.provide(hostEnvironmentLayer)),
  )
})

// Pure layer: original captured uv 0.13.10 output + original service argv. No IO or clock.
test("official uv settings preserve command escapes and every requirement input", () => {
  const result = parseUvToolSettings(UV_TOOL_SETTINGS)
  expect(result.command).toEqual(UV_SERVICE_COMMAND)
  expect(result.from).toBe("foo-bar[read]==1.0")
  expect(result.with).toEqual(["packaging==24.0"])
  expect(result.fields.with_requirements).toContain("/requirements.txt")
  expect(result.fields.constraints).toContain("/constraints.txt")
  expect(result.fields.overrides).toContain("/overrides.txt")
  expect(result.fields.build_constraints).toContain("/build-constraints.txt")
  expect(result.withEditable).toEqual([expect.stringMatching(/\/editable$/)])
  expect(result.noEnvironmentFiles).toBe(true)
  expect(result.fields.settings).toContain('"value],}"')
  expect(result.fields.settings).toContain("index_locations:")
})

test("uv settings reject incomplete metadata without echoing the credential-bearing input", () => {
  expect(() => parseUvToolSettings("not uv metadata")).toThrow("Missing uv ToolRunSettings")
  try {
    parseUvToolSettings(UV_TOOL_SETTINGS.slice(0, -20))
    throw Error("must reject incomplete settings")
  } catch (error) {
    expect(String(error)).not.toContain("fixture-token")
    expect(String(error)).toContain("uv")
  }
})

// Module layer: input argv and parsed settings come from the pinned uv probe above.
test("uv install conversion preserves resolver syntax and separates current service arguments", () => {
  const declaration = parseUvToolSettings(UV_TOOL_SETTINGS)
  const resolver = [
    "--with",
    "packaging==24.0",
    "--with-requirements",
    "requirements.txt",
    "-c",
    "constraints.txt",
    "--overrides=overrides.txt",
    "--build-constraints",
    "build.txt",
    "--with-editable",
    "editable",
    "--config-setting",
    "key=value],}",
  ]
  for (const syntax of ["uvx", "uv"] as const) {
    const prefix = syntax === "uv" ? ["--directory", "project", "tool", "run"] : []
    const args = [
      ...prefix,
      "--from=" + declaration.from,
      ...resolver,
      "--isolated",
      "--env-file",
      "business.env",
      "--env-file=other.env",
      "--no-env-file",
      "--",
      ...UV_SERVICE_COMMAND,
    ]
    expect(uvToolInstallArguments({ syntax, arguments: args, declaration })).toEqual([
      ...(syntax === "uv" ? ["--directory", "project", "tool", "install"] : ["tool", "install"]),
      ...resolver,
      "--",
      declaration.from!,
    ])
  }
  // Removing only --from changes the source, while the explicit console command stays execution-only.
  expect(
    uvToolInstallArguments({
      syntax: "uvx",
      arguments: ["--from", declaration.from!, ...UV_SERVICE_COMMAND],
      declaration,
    }),
  ).toEqual(["tool", "install", "--", declaration.from!])
  const implicit = { ...declaration, from: null }
  expect(uvToolInstallArguments({ syntax: "uvx", arguments: UV_SERVICE_COMMAND, declaration: implicit })).toEqual([
    "tool",
    "install",
    "--",
    UV_SERVICE_COMMAND[0]!,
  ])
  expect(() =>
    uvToolInstallArguments({ syntax: "uvx", arguments: [...UV_SERVICE_COMMAND, "unexpected"], declaration }),
  ).toThrow("does not match")
})

// Integration layer: only the binary boundary is substituted with a real process emitting the
// captured output. The one-time pinned-binary probe independently proves the CLI/settings format.
test("uv declaration parsing forwards original uv and uvx syntax on the Location execution plane", async () => {
  const root = connectionRoot()
  const commands: ChildProcess.Command[] = []
  const layer = Layer.effect(
    Environment.Service,
    Effect.gen(function* () {
      const current = yield* Environment.Service
      return Environment.Service.of({
        ...current,
        spawner: ChildProcessSpawner.make((command) => {
          commands.push(command)
          return current.spawner.spawn(
            ChildProcess.make(
              process.execPath,
              ["-e", "process.stdout.write(" + JSON.stringify(UV_TOOL_SETTINGS) + ")"],
              command._tag === "StandardCommand" ? command.options : {},
            ),
          )
        }),
      })
    }),
  ).pipe(Layer.provide(hostEnvironmentLayer))
  for (const syntax of ["uvx", "uv"] as const) {
    const args =
      syntax === "uvx"
        ? ["--from", "foo-bar[read]==1.0", ...UV_SERVICE_COMMAND]
        : ["--directory", root, "tool", "run", "--from", "foo-bar[read]==1.0", ...UV_SERVICE_COMMAND]
    const result = await Effect.runPromise(
      Effect.scoped(
        readUvLaunchDeclaration({
          syntax,
          arguments: args,
          cwd: root,
          environment: { PATH: root },
          launchers: launcherEnvironment(root),
        }),
      ).pipe(Effect.provide(layer)),
    )
    expect(result.command).toEqual(UV_SERVICE_COMMAND)
    expect(commands.at(-1)).toMatchObject({
      command: path.join(root, "bundled/uv"),
      args: ["--show-settings", ...(syntax === "uvx" ? ["tool", "run"] : []), ...args],
      options: { cwd: root, env: { PATH: root }, extendEnv: false },
    })
  }
})

// Pure layer: our normalized resolution-fact contract. Invocation context is deliberately
// extra data here, proving it cannot accidentally become a key axis through object spreading.
test("connector content keys exclude invocation state credentials and runtime locations", () => {
  const first = {
    runner: "npm-exec" as const,
    launchers: launcherEnvironment("/first-runtime"),
    requirements: [{ kind: "registry" as const, name: "own", version: "1.2.3", extras: ["b", "a"] }],
    options: {
      registry:
        "https://first:credential@packages.invalid/?channel=stable&%73ig=one&%70assword=first&credentialRef=first-ref&authVersion=one",
      cache: "/first-cache",
      prefix: "/first-project",
      _authToken: "first-token",
    },
    configuration: [
      {
        purpose: "constraints" as const,
        value: {
          requires: ["own==1.2.3"],
          registry: "https://one:secret@packages.invalid/?token=first&channel=stable",
          credentialRef: "first-ref",
          nested: { apiKey: "first-key", enabled: true },
        },
      },
    ],
    cwd: "/first-project",
    identity: { directory: "/first-project", server: "first", attempt: "one" },
    command: ["own", "/first-project"],
    environment: { KEY: "first-business-key" },
  }
  const second = {
    ...first,
    launchers: launcherEnvironment("/second-runtime"),
    requirements: [{ ...first.requirements[0]!, extras: ["a", "b", "a"] }],
    options: {
      registry:
        "https://second:rotated@packages.invalid/?sig=two&channel=stable&password=second&credentialRef=second-ref&authVersion=two",
      cache: "/second-cache",
      prefix: "/second-project",
      _authToken: "second-token",
    },
    configuration: [
      {
        purpose: "constraints" as const,
        value: {
          requires: ["own==1.2.3"],
          registry: "https://two:rotated@packages.invalid/?channel=stable&token=second",
          credentialRef: "second-ref",
          nested: { apiKey: "second-key", enabled: true },
        },
      },
    ],
    cwd: "/second-project",
    identity: { directory: "/second-project", server: "second", attempt: "two" },
    command: ["own", "/second-project"],
    environment: { KEY: "rotated-business-key" },
  }
  expect(connectorPreparationKey(first)).toBe(connectorPreparationKey(second))
  expect(connectorPreparationKey(first)).toMatch(/^[a-f0-9]{64}$/)
})

test("connector content keys track resolution contents and platform pins", () => {
  const input = {
    runner: "uv-tool" as const,
    launchers: launcherEnvironment("/runtime"),
    requirements: [{ kind: "registry" as const, name: "own", version: "==1.2.3" }],
    options: { index_strategy: "FirstIndex", refresh: "volatile time is not resolution content" },
    configuration: [{ purpose: "constraints" as const, value: ["dependency==1.0"] }],
  }
  const key = connectorPreparationKey(input)
  for (const changed of [
    { ...input, requirements: [{ ...input.requirements[0]!, version: "==1.2.4" }] },
    { ...input, options: { index_strategy: "UnsafeBestMatch" } },
    { ...input, configuration: [{ purpose: "constraints" as const, value: ["dependency==2.0"] }] },
    { ...input, launchers: { ...input.launchers, pinSet: "b".repeat(64) } },
    { ...input, launchers: { ...input.launchers, platform: "win32-x64" as const } },
  ])
    expect(connectorPreparationKey(changed)).not.toBe(key)
  expect(connectorPreparationKey({ ...input, options: { ...input.options, refresh: "another time" } })).toBe(key)
  // These names come from the pinned npm 11.20.0 definitions/Arborist. Relative
  // release age is a semantic input; its derived wall-clock `before` is not.
  const npm = { ...input, runner: "npm-exec" as const, options: {} }
  for (const options of [
    { minReleaseAge: 7 },
    { minReleaseAgeExclude: ["@own/*"] },
    { packageLock: false },
    { lockfileVersion: 2 },
  ])
    expect(connectorPreparationKey({ ...npm, options })).not.toBe(connectorPreparationKey(npm))
})

test("connector content keys canonicalize remote git and local content requirements", () => {
  const input = {
    runner: "npm-exec" as const,
    launchers: launcherEnvironment("/runtime"),
    options: {},
    configuration: [],
    requirements: [
      { kind: "remote" as const, url: "https://one:private@own.invalid/package.tgz?key=one&content=v1" },
      {
        kind: "git" as const,
        url: "git+https://one:private@git.invalid/repository?token=one",
        revision: "commit-a",
        subdirectory: "pkg",
      },
      { kind: "content" as const, sha256: "a".repeat(64), name: "own-local" },
    ],
  }
  const key = connectorPreparationKey(input)
  expect(
    connectorPreparationKey({
      ...input,
      requirements: [
        { kind: "content", sha256: "a".repeat(64), name: "own-local" },
        {
          kind: "git",
          url: "git+https://two:rotated@git.invalid/repository?token=two",
          revision: "commit-a",
          subdirectory: "pkg",
        },
        { kind: "remote", url: "https://two:rotated@own.invalid/package.tgz?content=v1&key=two" },
      ],
    }),
  ).toBe(key)
  expect(
    connectorPreparationKey({
      ...input,
      requirements: [{ kind: "content", sha256: "b".repeat(64), name: "own-local" }],
    }),
  ).not.toBe(key)
})

// Integration layer: effective options really come from the official npm config parser,
// including each project's .npmrc and per-project runtime/config paths. No hand-written npm output.
test("connector content key reuses identical effective npm resolution in another project after key rotation", async () => {
  const keys: string[] = []
  for (const token of ["first", "rotated"]) {
    const input = npmDeclarationFixture()
    writeFileSync(
      path.join(input.root, ".npmrc"),
      `registry=https://packages.invalid/\n@private:registry=https://private.invalid/\n//private.invalid/:_authToken=${token}\n`,
    )
    const parsed = await Effect.runPromise(
      Effect.scoped(
        readNpmLaunchDeclaration({
          ...input,
          cwd: input.root,
          syntax: "npx",
          arguments: ["--package=own@1.2.3", "--", "own-bin", input.root],
        }),
      ).pipe(Effect.provide(hostEnvironmentLayer)),
    )
    keys.push(
      connectorPreparationKey({
        runner: "npm-exec",
        launchers: input.launchers,
        requirements: [{ kind: "registry", name: "own", version: "1.2.3" }],
        options: parsed.resolutionOptions,
        configuration: [],
      }),
    )
  }
  expect(keys[0]).toBe(keys[1])
})

// Integration layer: the real npm Config reads own .npmrc files and CLI precedence.
test("official npm resolution facts preserve relative release age without a clock in the key", async () => {
  const input = npmDeclarationFixture()
  // The shared fixture uses Config 10.8.1. Load the pinned 10.13.0's complete
  // unmodified Config sources in this child's directory, retaining all assertions.
  const util = createRequire(new URL("../../util/package.json", import.meta.url))
  const configModule = path.join(path.dirname(path.dirname(input.launchers.npmCli)), "node_modules/@npmcli/config")
  rmSync(configModule) // Only the symlink created by npmDeclarationFixture.
  const sources: Record<string, string> = JSON.parse(
    gunzipSync(readFileSync(new URL("./fixture/npm-launch/npm-config-source.json.gz", import.meta.url))).toString(),
  )
  for (const [file, source] of Object.entries(sources)) {
    const target = path.join(configModule, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, source)
  }
  symlinkSync(
    path.resolve(path.dirname(util.resolve("@npmcli/config/package.json")), "../.."),
    path.join(configModule, "node_modules"),
    "dir",
  )
  const config = path.join(input.root, ".npmrc")
  const parse = (args: string[] = []) =>
    Effect.runPromise(
      Effect.scoped(
        readNpmLaunchDeclaration({ ...input, cwd: input.root, syntax: "npx", arguments: [...args, "own@1.2.3"] }),
      ).pipe(Effect.provide(hostEnvironmentLayer)),
    )
  const key = (options: Record<string, unknown>) =>
    connectorPreparationKey({
      runner: "npm-exec",
      launchers: input.launchers,
      requirements: [{ kind: "registry", name: "own", version: "1.2.3" }],
      options,
      configuration: [],
    })
  writeFileSync(config, "min-release-age=7\nmin-release-age-exclude[]=@own/*\n")
  const first = await parse()
  expect(first.resolutionOptions.before).toEqual({ kind: "relative-age", days: 7 })
  expect(first.resolutionOptions.minReleaseAgeExclude).toEqual(["@own/*"])
  const second = await parse()
  expect(key(second.resolutionOptions)).toBe(key(first.resolutionOptions))
  const absolute = await parse(["--before=2020-01-01T00:00:00.000Z"])
  expect(absolute.resolutionOptions.before).toEqual({ kind: "before", date: "2020-01-01T00:00:00.000Z" })
  expect(key(absolute.resolutionOptions)).not.toBe(key(first.resolutionOptions))
  writeFileSync(config, "before=2020-01-01T00:00:00.000Z\nmin-release-age=7\n")
  const override = await parse(["--min-release-age=14"])
  expect(override.resolutionOptions.before).toEqual({ kind: "relative-age", days: 14 })
  expect(key(override.resolutionOptions)).not.toBe(key(first.resolutionOptions))
  const disabled = await parse(["--min-release-age=0"])
  expect(disabled.resolutionOptions.before).toBeNull()
})

// Integration layer: prefix metadata and bin-selector sources are unmodified captures from
// pinned npm 11.20.0 install --prefix (r6 actual semver tarball probe). Package code comes
// from the already-installed repository dependency; no registry or extra dependency is used.
function npmCaptureFixture() {
  const f = npmDeclarationFixture()
  const key = "c".repeat(64)
  const prefix = path.join(f.launchers.runtimeRoot, "prepared", key)
  mkdirSync(path.join(prefix, "node_modules/.bin"), { recursive: true })
  copyFileSync(
    new URL("./fixture/npm-launch/installed-package.json", import.meta.url),
    path.join(prefix, "package.json"),
  )
  copyFileSync(
    new URL("./fixture/npm-launch/installed-package-lock.json", import.meta.url),
    path.join(prefix, "package-lock.json"),
  )
  const npm = path.dirname(path.dirname(f.launchers.npmCli))
  mkdirSync(path.join(npm, "node_modules/libnpmexec/lib"), { recursive: true })
  copyFileSync(
    new URL("./fixture/npm-launch/libnpmexec-package.json", import.meta.url),
    path.join(npm, "node_modules/libnpmexec/package.json"),
  )
  copyFileSync(
    new URL("./fixture/npm-launch/get-bin-from-manifest.js", import.meta.url),
    path.join(npm, "node_modules/libnpmexec/lib/get-bin-from-manifest.js"),
  )
  const util = createRequire(new URL("../../util/package.json", import.meta.url))
  const installed = createRequire(util.resolve("@npmcli/config/package.json"))
  symlinkSync(
    path.dirname(installed.resolve("@npmcli/package-json/package.json")),
    path.join(npm, "node_modules/@npmcli/package-json"),
    "dir",
  )
  const semver = path.dirname(installed.resolve("semver/package.json"))
  cpSync(semver, path.join(prefix, "node_modules/semver"), { recursive: true })
  symlinkSync("../semver/bin/semver.js", path.join(prefix, "node_modules/.bin/semver"))
  return {
    ...f,
    key,
    prefix,
    version: JSON.parse(readFileSync(path.join(semver, "package.json"), "utf8")).version as string,
  }
}

test("npm capture records actual package bins and its receipt survives an offline reread", async () => {
  const f = npmCaptureFixture()
  const spawns: ChildProcess.Command[] = []
  const preparation = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const value = yield* captureNpmConnectorPreparation({ ...f, cwd: f.root })
        yield* publishConnectorPreparation({ runtimeRoot: f.launchers.runtimeRoot, preparation: value })
        expect(spawns).toHaveLength(1)
        const cached = yield* readConnectorPreparation({
          runtimeRoot: f.launchers.runtimeRoot,
          key: f.key,
          runner: "npm-exec",
        })
        expect(cached?.packages).toEqual({ semver: f.version })
        expect(cached?.entries).toEqual(value.entries)
        expect(spawns).toHaveLength(1)
        return value
      }),
    ).pipe(Effect.provide(recordingEnvironmentLayer(spawns))),
  )
  const entry = path.join(f.prefix, "node_modules/semver/bin/semver.js")
  expect(preparedNpmEntry(preparation, { kind: "package", name: "semver" })).toBe(entry)
  expect(preparedNpmEntry(preparation, { kind: "bin", name: "semver" })).toBe(entry)
  expect(preparation.required).toContain(path.join(f.prefix, "package-lock.json"))
})

test("npm capture uses the official package-name default among distinct bins", async () => {
  const f = npmCaptureFixture()
  const manifest = JSON.parse(readFileSync(new URL("./fixture/npm-launch/npm-package.json", import.meta.url), "utf8"))
  // Counterfactual ordering of the actual npm manifest: first-key selection would choose npx.
  manifest.bin = { npx: manifest.bin.npx, npm: manifest.bin.npm }
  const root = JSON.parse(readFileSync(path.join(f.prefix, "package.json"), "utf8"))
  root.dependencies = { npm: manifest.version }
  writeFileSync(path.join(f.prefix, "package.json"), JSON.stringify(root))
  mkdirSync(path.join(f.prefix, "node_modules/npm/bin"), { recursive: true })
  writeFileSync(path.join(f.prefix, "node_modules/npm/package.json"), JSON.stringify(manifest))
  for (const bin of ["npm", "npx"]) {
    copyFileSync(
      path.join(path.dirname(f.launchers.npmCli), `${bin}-cli.js`),
      path.join(f.prefix, `node_modules/npm/bin/${bin}-cli.js`),
    )
    symlinkSync(`../npm/bin/${bin}-cli.js`, path.join(f.prefix, `node_modules/.bin/${bin}`))
  }
  const value = await Effect.runPromise(
    Effect.scoped(captureNpmConnectorPreparation({ ...f, cwd: f.root })).pipe(Effect.provide(hostEnvironmentLayer)),
  )
  expect(preparedNpmEntry(value, { kind: "package", name: "npm" })).toBe(
    path.join(f.prefix, "node_modules/npm/bin/npm-cli.js"),
  )
  expect(preparedNpmEntry(value, { kind: "bin", name: "npx" })).toBe(
    path.join(f.prefix, "node_modules/npm/bin/npx-cli.js"),
  )
})

test("npm capture rejects a bin link outside the prepared prefix", async () => {
  const f = npmCaptureFixture()
  const outside = path.join(f.root, "outside.js")
  writeFileSync(outside, "/* owned outside entry */")
  // Replace only our own generated link, retaining the actual package/bin metadata.
  rmSync(path.join(f.prefix, "node_modules/.bin/semver"))
  symlinkSync(outside, path.join(f.prefix, "node_modules/.bin/semver"))
  const failure = await Effect.runPromise(
    Effect.scoped(captureNpmConnectorPreparation({ ...f, cwd: f.root })).pipe(
      Effect.flip,
      Effect.provide(hostEnvironmentLayer),
    ),
  )
  expect(failure).toMatchObject({ kind: "unknown", detail: expect.stringContaining("escaped its prefix") })
})

// Component layer: official pinned libnpmpack sources plus already-installed real
// Arborist/Pacote dependencies; input package bytes are the real semver publication.
function npmSourceFixture() {
  const input = npmCaptureFixture()
  const npm = path.dirname(path.dirname(input.launchers.npmCli))
  const util = createRequire(new URL("../../util/package.json", import.meta.url))
  const arborist = createRequire(util.resolve("@npmcli/arborist/package.json"))
  const pacote = createRequire(arborist.resolve("pacote/package.json"))
  const runScript = createRequire(arborist.resolve("@npmcli/run-script/package.json"))
  const config = createRequire(util.resolve("@npmcli/config/package.json"))
  const modules = {
    "@npmcli/arborist": path.dirname(util.resolve("@npmcli/arborist/package.json")),
    "@npmcli/run-script": path.dirname(arborist.resolve("@npmcli/run-script/package.json")),
    "@npmcli/promise-spawn": path.dirname(runScript.resolve("@npmcli/promise-spawn/package.json")),
    "proc-log": path.dirname(arborist.resolve("proc-log/package.json")),
    "ci-info": path.dirname(config.resolve("ci-info/package.json")),
    pacote: path.dirname(arborist.resolve("pacote/package.json")),
    "make-fetch-happen": path.dirname(pacote.resolve("make-fetch-happen/package.json")),
    cacache: path.dirname(pacote.resolve("cacache/package.json")),
    "npm-packlist": path.dirname(pacote.resolve("npm-packlist/package.json")),
    tar: path.dirname(pacote.resolve("tar/package.json")),
    semver: path.dirname(util.resolve("semver/package.json")),
  }
  for (const [name, directory] of Object.entries(modules)) {
    const target = path.join(npm, "node_modules", name)
    if (existsSync(target)) continue
    mkdirSync(path.dirname(target), { recursive: true })
    symlinkSync(directory, target, "dir")
  }
  const sources: Record<string, string> = JSON.parse(gunzipSync(readFileSync(new URL("./fixture/npm-launch/npm-source-helpers.json.gz", import.meta.url))).toString())
  for (const [file, source] of Object.entries(sources)) {
    const target = path.join(npm, "node_modules", file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, source)
  }
  return { ...input, python: process.execPath, temporary: path.join(input.root, "sources"), environment: { ...input.environment, npm_config_cache: path.join(input.root, "cache") } }
}

test("npm requirements retain aliases git revisions and remote source identities without execution inputs", async () => {
  const input = npmSourceFixture()
  const declaration = await Effect.runPromise(Effect.scoped(normalizeNpmLaunchDeclaration({ ...input, cwd: input.root, syntax: "npx", arguments: [
    "--package=owned@npm:semver@v7.8.5", "--package=git+https://own:fixture-secret@git.invalid/source.git#main", "--package=https://own:fixture-secret@packages.invalid/source.tgz?token=first", "--call", "own /current-workspace",
  ] })).pipe(Effect.provide(hostEnvironmentLayer)))
  expect(declaration.selection).toBe("call")
  expect(declaration.requirements[0]).toEqual({ kind: "registry", name: "semver", version: "7.8.5", alias: "owned" })
  expect(declaration.requirements[1]).toMatchObject({ kind: "git", revision: "main" })
  const key = connectorPreparationKey({ runner: "npm-exec", launchers: input.launchers, requirements: declaration.requirements, options: declaration.resolutionOptions, configuration: declaration.configuration })
  expect(key).toMatch(/^[a-f0-9]{64}$/)
  expect(declaration.installSpecs).toHaveLength(3)
})

test("npm local source fingerprints follow the official packlist and survive project and credential changes", async () => {
  const inputs = [npmSourceFixture(), npmSourceFixture()]
  const keys: string[] = []
  for (const [index, input] of inputs.entries()) {
    const local = path.join(input.prefix, "node_modules/semver")
    const manifest = JSON.parse(readFileSync(path.join(local, "package.json"), "utf8"))
    manifest.publishConfig = { registry: `https://own:credential-${index}@packages.invalid/?token=secret-${index}`, credentialRef: `ref-${index}` }
    writeFileSync(path.join(local, "package.json"), JSON.stringify(manifest))
    writeFileSync(path.join(local, ".npmrc"), `//packages.invalid/:_authToken=private-${index}\n`)
    const result = await Effect.runPromise(Effect.scoped(normalizeNpmLaunchDeclaration({ ...input, cwd: input.root, syntax: "npx", arguments: [local, input.root] })).pipe(Effect.provide(hostEnvironmentLayer)))
    expect(result.requirements[0]?.kind).toBe("content")
    expect(result.installSpecs[0]?.startsWith("file:" + input.temporary)).toBe(true)
    keys.push(connectorPreparationKey({ runner: "npm-exec", launchers: input.launchers, requirements: result.requirements, options: result.resolutionOptions, configuration: result.configuration }))
  }
  expect(keys[0]).toBe(keys[1])
  const input = inputs[0]!
  const local = path.join(input.prefix, "node_modules/semver")
  const bin = path.join(local, "bin/semver.js")
  writeFileSync(bin, readFileSync(bin, "utf8") + "\n// changed owned source\n")
  const changed = await Effect.runPromise(Effect.scoped(normalizeNpmLaunchDeclaration({ ...input, cwd: input.root, syntax: "npx", arguments: [local] })).pipe(Effect.provide(hostEnvironmentLayer)))
  expect(connectorPreparationKey({ runner: "npm-exec", launchers: input.launchers, requirements: changed.requirements, options: changed.resolutionOptions, configuration: changed.configuration })).not.toBe(keys[0])
})

test("npm product installer forwards resolved configuration and owned prefix without the service command", async () => {
  const input = npmSourceFixture()
  const npm = path.dirname(path.dirname(input.launchers.npmCli))
  // Own trace at the CLI-dispatch seam, not an imitation of npm installation output.
  writeFileSync(path.join(npm, "lib/cli.js"), "module.exports = process => process.stdout.write(JSON.stringify({ arguments: process.argv.slice(2), cache: process.env.npm_config_cache }))\n")
  const cache = path.join(input.root, "bound-cache")
  const launchers = { ...input.launchers, packageManagerEnv: { npm_config_cache: cache } }
  const result = await Effect.runPromise(Effect.scoped(installNpmConnector({ ...input, launchers, cwd: input.root, syntax: "npx", arguments: ["--cache", path.join(input.root, "unbound-cache"), "--registry=https://registry.invalid/", "--package=semver@7.8.5", "--call", "must-not-run"], key: input.key, installSpecs: ["semver@7.8.5"], environment: { ...input.environment, npm_config_cache: cache } })).pipe(Effect.provide(hostEnvironmentLayer)))
  expect(result.exitCode).toBe(0)
  const trace = JSON.parse(result.stdout)
  expect(trace.arguments.slice(0, 1)).toEqual(["install"])
  expect(trace.arguments).toContain("--registry=https://registry.invalid/")
  expect(trace.arguments).toContain("--ignore-scripts=true")
  expect(trace.arguments).toContain(input.prefix)
  expect(trace.arguments).not.toContain("--cache=" + path.join(input.root, "unbound-cache"))
  expect(trace.arguments.join(" ")).not.toContain("must-not-run")
  expect(trace.cache).toBe(cache)
})

// Module layer: actual uv0.13.10 Debug sample, including nested map keys and Rust escapes.
test("uv resolved settings retain nested resolver semantics without treating display metadata as CLI syntax", () => {
  const declaration = parseUvToolSettings(UV_TOOL_SETTINGS)
  expect(parseUvResolvedValue(declaration.fields.options!)).toMatchObject({ kind: "record", name: "ResolverInstallerOptions", fields: {
    config_settings: { kind: "tuple", name: "Some", items: [{ kind: "tuple", name: "ConfigSettings", items: [{ kind: "record", fields: { key: { kind: "tuple", name: "String", items: ["value],}"] } } }] }] },
  } })
  expect(parseUvResolvedValue(declaration.fields.command!)).toEqual({ kind: "tuple", name: "Some", items: [UV_SERVICE_COMMAND] })
  expect(() => parseUvResolvedValue(declaration.fields.options!.slice(0, -1))).toThrow()
})

// Integration layer: own metadata protocol at the uv process boundary. The flag meanings
// are verified against pinned uv0.13.10 `tool run --help` (-C is config-setting).
test("uv execution environment keeps build config settings out of directory options", async () => {
  const root = connectionRoot()
  const commands: ChildProcess.Command[] = []
  const layer = Layer.effect(Environment.Service, Effect.gen(function* () {
    const current = yield* Environment.Service
    return Environment.Service.of({ ...current, spawner: ChildProcessSpawner.make(command => {
      commands.push(command)
      return current.spawner.spawn(ChildProcess.make(process.execPath, ["-e", "process.stdout.write(JSON.stringify({cwd:process.cwd(),environment:process.env}))"], command._tag === "StandardCommand" ? command.options : {}))
    }) })
  })).pipe(Layer.provide(hostEnvironmentLayer))
  const declaration = parseUvToolSettings(UV_TOOL_SETTINGS)
  const value = await Effect.runPromise(Effect.scoped(readUvLaunchEnvironment({
    syntax: "uvx", arguments: ["-C", "key=value", "--directory", root, "--from", declaration.from!, ...declaration.command],
    declaration, launchers: launcherEnvironment(root), cwd: root, environment: { OWN_CURRENT: "current" },
  })).pipe(Effect.provide(layer)))
  expect(commands[0]).toMatchObject({ args: ["--directory", root, "run", "--offline", "--no-config", "--no-project", "--no-env-file", "--", launcherEnvironment(root).node, "--input-type=commonjs", "-e", expect.any(String)] })
  expect(value).toMatchObject({ cwd: root, environment: { OWN_CURRENT: "current" } })
})

// Component layer: the pinned Python parser's actual r8 replies are replayed at its
// own JSON boundary; Node's content traversal and config/requirement adapters run unchanged.
test("uv content facts retain requirements config and editable contents across Location changes", async () => {
  const capture: {
    root: string; declaration: ReturnType<typeof parseUvToolSettings>;
    replies: { input: string; output: string }[];
    sourceFiles: Record<string, string>; requirementsFiles: Record<string, string>;
  } = JSON.parse(readFileSync(new URL("./fixture/uv-requirements.json", import.meta.url), "utf8"))
  const prepare = async (root: string, business: string) => {
    const input = npmSourceFixture()
    const declaration: typeof capture.declaration = JSON.parse(JSON.stringify(capture.declaration).replaceAll(capture.root, root))
    for (const [name, content] of Object.entries({ ...capture.requirementsFiles, ...Object.fromEntries(Object.entries(capture.sourceFiles).map(([file, value]) => ["source/" + file, value])) })) {
      const file = path.join(root, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, content)
    }
    const python = path.join(root, "python-parser")
    writeFileSync(python, '#!/usr/bin/env node\nconst fs=require("node:fs");const input=fs.readFileSync(0,"utf8");const data=' + JSON.stringify(capture.replies) + ';const result=data.find(value=>value.input===input);if(!result)throw Error("Uncaptured Python input");process.stdout.write(result.output)\n', { mode: 0o755 })
    const layer = Layer.effect(Environment.Service, Effect.gen(function* () {
      const current = yield* Environment.Service
      return Environment.Service.of({ ...current, spawner: ChildProcessSpawner.make(command => command._tag === "StandardCommand" && command.command === input.launchers.uv
        ? current.spawner.spawn(ChildProcess.make(process.execPath, ["-e", "process.stdout.write(JSON.stringify({cwd:process.cwd(),environment:process.env}))"], command.options))
        : current.spawner.spawn(command)) })
    })).pipe(Layer.provide(hostEnvironmentLayer))
    const call = (current = declaration) => Effect.runPromise(Effect.scoped(normalizeUvLaunchDeclaration({ ...input, python, temporary: path.join(root, "stage"), cwd: root, environment: { ...input.environment, OWN_BUSINESS_KEY: business }, syntax: "uvx", arguments: ["--offline", "--no-config", "--with-requirements", path.join(root, "requirements.txt"), ...current.with.flatMap(value => ["--with", value]), ...current.withEditable.flatMap(value => ["--with-editable", value]), ...(current.from ? ["--from", current.from] : []), ...current.command], declaration: current })).pipe(Effect.provide(layer)))
    return { input, declaration, call, value: await call() }
  }
  const firstRoot = connectionRoot()
  const secondRoot = connectionRoot()
  const first = await prepare(firstRoot, "first-current-value")
  const second = await prepare(secondRoot, "rotated-current-value")
  const key = (value: typeof first.value) => connectorPreparationKey({ runner: "uv-tool", launchers: first.input.launchers, ...value })
  expect(key(first.value)).toBe(key(second.value))
  expect(first.value.requirements).toEqual([
    { kind: "registry", name: "pip", version: ">=26.0", extras: ["read"], marker: 'python_version >= "3.12"' },
    { kind: "git", name: "named", url: "git+https://git.invalid/project.git", revision: "main", subdirectory: "src", extras: ["feature"] },
  ])
  expect(first.value.sourceBindings).toMatchObject([{ path: path.join(firstRoot, "source"), editable: true }])
  const facts = JSON.stringify({ requirements: first.value.requirements, options: first.value.options, configuration: first.value.configuration })
  for (const value of [firstRoot, "owned-fake-secret", "owned-first", "first-current-value"]) expect(facts).not.toContain(value)
  expect(facts).toContain('"version":"<25"')
  expect(first.value.installArguments).toEqual(["tool", "install", "--offline", "--no-config", "--with", first.value.declaration.with[0]!, "--with-requirements", first.value.requirementFiles[path.join(firstRoot, "requirements.txt")]!, "--", first.value.declaration.from!])
  expect(first.value.installArguments).not.toContain("--business")
  expect(first.value.options.resolution).toBe("Highest")
  expect(key({ ...first.value, options: { ...first.value.options, resolution: "Lowest" } })).not.toBe(key(first.value))
  const main = first.value.requirements.find(value => value.kind === "registry")!
  const git = first.value.requirements.find(value => value.kind === "git")!
  expect(key({ ...first.value, requirements: [{ ...main, marker: 'python_version >= "3.11"' }, ...first.value.requirements.slice(1)] })).not.toBe(key(first.value))
  expect(key({ ...first.value, requirements: [main, { ...git, name: "another-project" }] })).not.toBe(key(first.value))
  const local = { kind: "content" as const, sha256: first.value.sourceBindings[0]!.sha256 }
  expect(key({ ...first.value, requirements: [local] })).not.toBe(key({ ...first.value, requirements: [{ ...local, editable: true }] }))
  // Counterfactual own parsed DTO: the package request is implicit, with the same
  // genuine PEP508 parser input. uv's Target/ToolRequirement preserves this spelling.
  const implicit = await first.call({ ...first.declaration, from: null, command: [first.declaration.from!, ...first.declaration.command.slice(1)] })
  expect(implicit.declaration.commandName).toBe("Pip")
  expect(key(implicit)).toBe(key(first.value))
  writeFileSync(path.join(firstRoot, "requirements.txt"), capture.requirementsFiles["requirements.txt"]!.replace("-r nested.txt", "-r=nested.txt"))
  expect(key(await first.call())).toBe(key(first.value))
  const runtime = await first.call({ ...first.declaration, from: null, command: ["python", "-m", "owned_editable"], with: [], withEditable: ["./source"] })
  expect(runtime.requirements[0]).toEqual({ kind: "interpreter", request: "python" })
  expect(runtime.runtimeRequest).toBe("python")
  expect(runtime.declaration.commandName).toBe("python")
  expect(runtime.installArguments.at(-1)).toMatch(/ensurepip[\\/]_bundled[\\/]pip-26\.3-py3-none-any\.whl$/)
  expect(runtime.installArguments.at(-1)).not.toBe("python")
  expect(uvEditableInstallArguments({ installArguments: first.value.installArguments, python: "/bound/bin/python", sources: [path.join(secondRoot, "source")] })).toEqual(["pip", "install", "--no-config", "--offline", "--no-deps", "--reinstall", "--python", "/bound/bin/python", "--editable", path.join(secondRoot, "source")])
  expect(readFileSync(first.value.requirementFiles[path.join(firstRoot, "requirements.txt")]!, "utf8")).toContain("requirements-1.txt")
  writeFileSync(path.join(firstRoot, "source/src/owned_editable/__init__.py"), "SOURCE_VERSION = 'changed'\n")
  expect(key(await first.call())).not.toBe(key(first.value))
})

// Integration layer: execute our real metadata JS while substituting only uv's selected PATH.
test("uv interpreter compatibility checks the selected managed directory without package resolution", async () => {
  const root = connectionRoot()
  const pin = path.join(root, "pin/bin")
  const cache = path.join(root, "uv-cache/bin")
  const other = path.join(root, "other/bin")
  mkdirSync(pin, { recursive: true }); mkdirSync(other, { recursive: true }); mkdirSync(cache, { recursive: true })
  writeFileSync(path.join(pin, "python3.12"), "owned metadata target")
  writeFileSync(path.join(other, "python"), "another metadata target")
  symlinkSync(path.join(pin, "python3.12"), path.join(cache, "python"))
  for (const selected of [cache, other]) {
    const commands: ChildProcess.Command[] = []
    const layer = Layer.effect(Environment.Service, Effect.gen(function* () {
      const current = yield* Environment.Service
      return Environment.Service.of({ ...current, spawner: ChildProcessSpawner.make(command => {
        commands.push(command)
        if (command._tag !== "StandardCommand") throw Error("Expected interpreter probe")
        return current.spawner.spawn(ChildProcess.make(process.execPath, command.args.slice(command.args.indexOf("--input-type=commonjs")), { ...command.options, env: { PATH: selected + path.delimiter + process.env.PATH } }))
      }) })
    })).pipe(Layer.provide(hostEnvironmentLayer))
    const result = await Effect.runPromise(Effect.scoped(checkUvPinnedPythonRequest({ launchers: launcherEnvironment(root), python: path.join(pin, "python3.12"), cwd: root, environment: {}, request: { tool: "python@3.12", python: null } })).pipe(Effect.result, Effect.provide(layer)))
    expect(result._tag).toBe(selected === cache ? "Success" : "Failure")
    expect(commands[0]).toMatchObject({ args: ["tool", "run", "--offline", "--no-config", "--from", "python@3.12", "--", launcherEnvironment(root).node, "--input-type=commonjs", "-e", expect.any(String), path.join(pin, "python3.12")] })
  }
})

// Integration layer: our SDK stdio fixture is imported by the ready package entry.
// npm's real run-script assembly supplies the environment; its dispatch is intercepted, never executed during binding.
test("bound package entries use current argv cwd environment and real npm script metadata", async () => {
  const input = npmSourceFixture()
  const entry = path.join(input.prefix, "node_modules/semver/bin/semver.js")
  writeFileSync(entry, `void import(${JSON.stringify(new URL("./fixture/codepuppy-mcp-startup-stdio.ts", import.meta.url).href)})\n`)
  const preparation = await Effect.runPromise(Effect.scoped(captureNpmConnectorPreparation({ ...input, cwd: input.root })).pipe(Effect.provide(hostEnvironmentLayer)))
  const other = path.join(input.root, "current-project")
  mkdirSync(other)
  const file = path.join(input.root, "current-launch.json")
  const environment = { ...input.environment, CODEPUPPY_MCP_LAUNCH_FILE: file, CONNECTOR_CURRENT_KEY: "current-business-value" }
  const declared = await Effect.runPromise(Effect.scoped(readNpmLaunchDeclaration({ ...input, environment, cwd: other, syntax: "npx", arguments: ["semver@7.8.5", "--current-argument", other] })).pipe(Effect.provide(hostEnvironmentLayer)))
  const bound = await Effect.runPromise(Effect.scoped(bindConnectorLaunch({ ...input, environment, cwd: other, preparation, source: { runner: "npm-exec", syntax: "npx", arguments: ["semver@7.8.5", "--current-argument", other], declaration: declared } })).pipe(Effect.provide(hostEnvironmentLayer)))
  expect(bound.command).toEqual([input.launchers.node, entry, "--current-argument", other])
  expect(bound.cwd).toBe(other)
  expect(bound.environment.INIT_CWD).toBe(other)
  expect(bound.environment.npm_lifecycle_event).toBe("npx")
  expect(bound.environment.npm_lifecycle_script).toBe("'semver'")
  expect(bound.environment.CONNECTOR_CURRENT_KEY).toBe("current-business-value")
  expect(bound.environment.PATH!.split(path.delimiter)[0]).toBe(path.join(input.prefix, "node_modules/.bin"))
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const client = yield* McpClient.connect({ server: "current-input", config: new ConfigMCP.Local({ type: "local", protocol: "legacy", command: ["must-not-run-npx"] }), directory: other, prepared: bound })
    expect((yield* client.tools()).map(tool => tool.name)).toEqual(["echo"])
  })).pipe(Effect.provide(hostEnvironmentLayer)))
  const observed = JSON.parse(readFileSync(file, "utf8"))
  expect(observed).toMatchObject({ cwd: other, argv: ["--current-argument", other], key: "current-business-value" })
})

test("npm call binding keeps shell syntax and current business values out of the package receipt", async () => {
  const input = npmSourceFixture()
  const preparation = await Effect.runPromise(Effect.scoped(captureNpmConnectorPreparation({ ...input, cwd: input.root })).pipe(Effect.provide(hostEnvironmentLayer)))
  await Effect.runPromise(publishConnectorPreparation({ runtimeRoot: input.launchers.runtimeRoot, preparation }).pipe(Effect.provide(hostEnvironmentLayer)))
  const call = `'${input.launchers.node}' -e 'process.stdout.write(process.env.OWN_CALL_VALUE)'`
  for (const current of ["first-business-value", "second-business-value"]) {
    const environment = { ...input.environment, OWN_CALL_VALUE: current }
    const declaration = await Effect.runPromise(Effect.scoped(readNpmLaunchDeclaration({ ...input, environment, cwd: input.root, syntax: "npx", arguments: ["--package=semver@7.8.5", "--call", call] })).pipe(Effect.provide(hostEnvironmentLayer)))
    const bound = await Effect.runPromise(Effect.scoped(bindConnectorLaunch({ ...input, environment, cwd: input.root, preparation, source: { runner: "npm-exec", syntax: "npx", arguments: ["--package=semver@7.8.5", "--call", call], declaration } })).pipe(Effect.provide(hostEnvironmentLayer)))
    const child = Bun.spawn(bound.command, { cwd: bound.cwd, env: bound.environment, stdout: "pipe", stderr: "pipe" })
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: current, stderr: "" })
  }
  const receipt = readFileSync(path.join(input.prefix, "ready.json"), "utf8")
  expect(receipt).not.toContain("business-value")
  expect(receipt).not.toContain("OWN_CALL_VALUE")
})

// Component layer: real local source bytes from the r8 setuptools/uv probe.
test("Python source identity excludes dotenv business credentials", async () => {
  const input = npmSourceFixture()
  const capture = JSON.parse(readFileSync(new URL("./fixture/uv-requirements.json", import.meta.url), "utf8")) as { sourceFiles: Record<string, string> }
  const source = path.join(input.root, "source")
  mkdirSync(source)
  writeFileSync(path.join(source, "module.py"), capture.sourceFiles["src/owned_editable/__init__.py"]!)
  writeFileSync(path.join(source, ".env"), "OWN_BUSINESS_KEY=first-current-value\n")
  const read = () => Effect.runPromise(Effect.scoped(readConnectorSource({ ...input, cwd: input.root, sources: [{ path: source, manager: "python" }] })).pipe(Effect.provide(hostEnvironmentLayer)))
  const before = await read()
  writeFileSync(path.join(source, ".env"), "OWN_BUSINESS_KEY=rotated-current-value\n")
  expect(await read()).toEqual(before)
})

// Module/Location boundary: dependency facts are authoritative before any launch,
// and an absent working directory needs no host registration or package preparation.
test("connector preparation preflights dependencies and the current workspace before the host", async () => {
  const root = connectionRoot()
  const spawns: ChildProcess.Command[] = []
  const input = { runner: "uv-tool" as const, identity: { directory: root, server: "owned", attempt: "preflight" }, command: ["uvx", "owned"] as const, cwd: root, environment: {}, runtimeDep: { runtimeDep: ["git"], executables: {}, missing: ["git"] } }
  expect(await Effect.runPromise(Effect.scoped(prepareConnectorLaunch(input)).pipe(Effect.flip, Effect.provide(recordingEnvironmentLayer(spawns))))).toEqual({ kind: "dependency", program: "git" })
  expect(spawns).toEqual([])
  expect(await Effect.runPromise(Effect.scoped(prepareConnectorLaunch({ ...input, cwd: path.join(root, "absent"), runtimeDep: { runtimeDep: [], executables: {}, missing: [] } })).pipe(Effect.flip, Effect.provide(hostEnvironmentLayer)))).toEqual({ kind: "workspace", reason: "missing" })
})

// Fast logic over this module's own source-reader failure representation, including
// concrete transient facts and a negative coarse-network control.
test("preparation failures retry only concrete transport and temporary HTTP evidence", () => {
  for (const status of [403, 404, 429, 503, 600]) {
    const stderr = "Requirement source HTTP " + status + " https://registry.invalid"
    expect(classifyStartFailure(undefined, { type: "local" }, { preparation: { stderr } }).failure).toEqual({ kind: status === 429 || status === 503 ? "download" : "unknown", detail: stderr })
  }
  for (const [stderr, kind] of [["Connector source code ECONNREFUSED\nowned connection failure", "download"], ["Connector source code ETIMEDOUT\nowned timeout", "download"], ["network failed", "unknown"], ["Package resolver conflict", "unknown"]] as const) {
    expect(classifyStartFailure(undefined, { type: "local" }, { preparation: { stderr } }).failure?.kind).toBe(kind)
  }
})

// Integration layer, affected PR/nightly. Isolate the process-global Host; the real
// preparation transaction uses npm Config/content/capture/binding and Location IO.
async function preparationTransaction(scenario: string) {
  const input = npmSourceFixture()
  const child = Bun.spawn([process.execPath, new URL("./fixture/connector-preparation.ts", import.meta.url).pathname, JSON.stringify({ root: input.root, scenario, launchers: input.launchers, version: input.version, source: path.join(input.prefix, "node_modules/semver") })], { stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
  return JSON.parse(stdout) as { cached?: boolean; merged?: boolean; cancelled?: boolean; recovered?: boolean; installCount: number; downloads: number; pythonInstalls: number; failure?: { kind: string; host?: string; port?: number }; progress: Record<string, number>; begun: string[]; ended: string[] }
}

test("connector preparation repairs missing Python and a damaged standard library", async () => {
  for (const scenario of ["damaged-python", "damaged-stdlib"]) {
    expect(await preparationTransaction(scenario)).toMatchObject({ cached: true, pythonInstalls: 1, downloads: 1, installCount: 1 })
  }
})

// Component layer: real HTTP, npm's actual cache client, actual pinned uv metadata
// and pinned packaging/pip JSON replies. No invented external-format fixture.
test("uv remote requirements keep credential rotation offline and detect changed source contents", async () => {
  const input = npmSourceFixture()
  const capture = JSON.parse(readFileSync(new URL("./fixture/uv-requirements.json", import.meta.url), "utf8")) as { remoteSettings: string; remoteOfflineSettings: string; remoteOrigin: string; remoteArguments: string[]; replies: { input: string; output: string }[] }
  let requests = 0, status = 200, body = "packaging<25\n"
  const authorizations: string[] = []
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) { requests++; authorizations.push(request.headers.get("authorization") ?? ""); return new Response(body, { status, headers: { "cache-control": "max-age=0, must-revalidate" } }) } })
  try {
    const origin = "http://127.0.0.1:" + server.port
    const python = path.join(input.root, "python-parser.cjs")
    writeFileSync(python, '#!/usr/bin/env node\nconst fs=require("node:fs");const input=fs.readFileSync(0,"utf8");const data=' + JSON.stringify(capture.replies) + ';const result=data.find(value=>value.input===input);if(!result)throw Error("Uncaptured Python input "+input);process.stdout.write(result.output)\n', { mode: 0o755 })
    const layer = Layer.effect(Environment.Service, Effect.gen(function* () {
      const current = yield* Environment.Service
      return Environment.Service.of({ ...current, spawner: ChildProcessSpawner.make(command => command._tag === "StandardCommand" && command.command === input.launchers.uv
        ? current.spawner.spawn(ChildProcess.make(process.execPath, ["-e", "process.stdout.write(JSON.stringify({cwd:process.cwd(),environment:process.env}))"], command.options))
        : current.spawner.spawn(command)) })
    })).pipe(Layer.provide(hostEnvironmentLayer))
    const launchers = { ...input.launchers, environment: { ...input.launchers.environment, XDG_CACHE_HOME: path.join(input.root, "owned-cache") } }
    const invoke = (offline: boolean, token: string, version = "one") => {
      const replace = (value: string) => value.replaceAll(capture.remoteOrigin.slice("http://".length), origin.slice("http://".length)).replaceAll(capture.remoteOrigin.split(":").at(-1)!, String(server.port)).replaceAll("owned-first", token).replaceAll("version=one", "version=" + version)
      return Effect.runPromise(Effect.scoped(normalizeUvLaunchDeclaration({ ...input, launchers, python, cwd: input.root, environment: { ...input.environment, HTTPS_PROXY: "", HTTP_PROXY: "", NO_PROXY: "127.0.0.1", XDG_CACHE_HOME: path.join(input.root, "unbound-cache"), BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(input.root, "test-bun-cache") }, syntax: "uvx", arguments: [...(offline ? ["--offline"] : []), ...capture.remoteArguments.map(replace)], declaration: parseUvToolSettings(replace(offline ? capture.remoteOfflineSettings : capture.remoteSettings)) })).pipe(Effect.provide(layer)))
    }
    const key = (value: Awaited<ReturnType<typeof invoke>>) => connectorPreparationKey({ runner: "uv-tool", launchers, ...value })
    const first = await invoke(false, "owned-first")
    expect(requests).toBe(1)
    expect(authorizations).toEqual(["Basic " + Buffer.from("own:owned-fake-secret").toString("base64")])
    const cached = await invoke(true, "owned-rotated")
    expect(key(cached)).toBe(key(first))
    expect(requests).toBe(1)
    expect(existsSync(path.join(input.root, "unbound-cache"))).toBe(false)
    const miss = await invoke(true, "owned-rotated", "missing").then(() => undefined, error => isConnectorLaunchFailure(error) && "detail" in error ? error.detail : String(error))
    expect(miss).toContain("offline")
    expect(requests).toBe(1)
    body = "packaging<24\n"
    expect(key(await invoke(false, "owned-first"))).not.toBe(key(first))
    expect(requests).toBe(2)
    status = 403
    const denied = await invoke(false, "owned-denied").then(() => undefined, error => isConnectorLaunchFailure(error) && "detail" in error ? error.detail : String(error))
    expect(denied).toContain("Requirement source HTTP 403")
    expect(requests).toBe(3)
    const facts = JSON.stringify({ requirements: cached.requirements, options: cached.options, configuration: cached.configuration })
    expect(facts).not.toContain("owned-first")
    expect(facts).not.toContain("owned-fake-secret")
  } finally { server.stop(true) }
})

test("connector preparation merges simultaneous requests and fans out actual installer progress", async () => {
  expect(await preparationTransaction("merge")).toMatchObject({ merged: true, installCount: 1, downloads: 0 })
})

test("connector preparation releases cancelled subscribers and recovers after the owner is interrupted", async () => {
  expect(await preparationTransaction("cancel-waiter")).toMatchObject({ merged: true, installCount: 1 })
  for (const scenario of ["cancel-owner", "cancel-owner-peer"]) expect(await preparationTransaction(scenario)).toMatchObject({ cancelled: true, recovered: true, installCount: 2 })
})

test("connector preparation aborts downloads and ignores late asset and progress results", async () => {
  for (const scenario of ["resolve-cancel", "download-cancel"]) expect(await preparationTransaction(scenario)).toMatchObject({ cancelled: true, installCount: 0, pythonInstalls: 0 })
})

test("connector preparation retries transient downloads and installers once and preserves deterministic failures", async () => {
  expect(await preparationTransaction("download-recover")).toMatchObject({ cached: true, downloads: 2, installCount: 1 })
  expect(await preparationTransaction("recover")).toMatchObject({ cached: true, installCount: 2 })
  expect(await preparationTransaction("failed")).toMatchObject({ installCount: 2, failure: { kind: "download" } })
  expect(await preparationTransaction("deterministic")).toMatchObject({ installCount: 1, failure: { kind: "unknown" } })
  expect(await preparationTransaction("download-deterministic")).toMatchObject({ downloads: 1, installCount: 0, failure: { kind: "unknown" } })
})

test("connector preparation names egress only for the current attempt directory server host and port", async () => {
  expect(await preparationTransaction("egress")).toMatchObject({ installCount: 1, failure: { kind: "egress", host: "registry.invalid", port: 443 } })
  for (const field of ["attempt", "directory", "server", "host", "port"]) expect(await preparationTransaction("egress-other-" + field)).toMatchObject({ installCount: 2, failure: { kind: "download" } })
})

test("connector preparation replaces incomplete readiness and succeeds on a later retry", async () => {
  for (const scenario of ["missing-entry", "invalid-receipt"]) expect(await preparationTransaction(scenario)).toMatchObject({ cached: true, installCount: 2 })
  expect(await preparationTransaction("failure-restart")).toMatchObject({ recovered: true, installCount: 3, failure: { kind: "download" } })
})
