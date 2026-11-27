// Integration layer: the sidecar's ConnectorLaunchHost and main's bridge over one paired port (structured clone on every hop),
// with the real connector-launch state and dependency reader. No Electron, engine or network.
import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { connectorDiagnosticTranscript, type LauncherEnvironment, type LaunchSnapshot } from "../../../util/src/codepuppy-connector-launch"
import { createConnectorLaunchMainBridge } from "./connector-launch-host"
import { createConnectorLaunchSidecarHost } from "./connector-launch-sidecar"
import { createConnectorLaunchState } from "./connector-launch-state"
import { connectorRuntimeDependencyReader } from "./connector-runtime-dependencies"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

function pair(overrides: Partial<Parameters<typeof createConnectorLaunchMainBridge>[0]> = {}, generation = "4") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "connector-launch-port-"))); roots.push(root)
  const runtimeRoot = join(root, "connector-runtime")
  const launchers: LauncherEnvironment = {
    platform: "darwin-arm64", pinSet: "f".repeat(64), uv: "/app/l/uv/uv", uvx: "/app/l/uv/uvx", node: "/app/l/node/bin/node", npmCli: "/app/l/node/lib/node_modules/npm/bin/npm-cli.js", npxCli: "/app/l/node/lib/node_modules/npm/bin/npx-cli.js",
    runtimeRoot, pythonFileId: "python/darwin-arm64/3.12.16-20261124", packageManagerEnv: { UV_PYTHON_INSTALL_DIR: join(root, "package-managers", "uv", "python") }, environment: { UV_PYTHON: "3.12.16" }, firstPartyCacheRoots: {},
  }
  const state = createConnectorLaunchState(generation, {
    retry: async () => ({ ok: true }), diagnostic: async () => ({ ok: false, error: "unavailable" }), openNetworkApproval: async () => ({ ok: false, error: "unavailable" }), chooseWorkspace: async () => ({ ok: false, error: "unavailable" }),
  })
  const ended: unknown[] = []
  let toSidecar: (message: unknown) => void = () => {}
  const main = createConnectorLaunchMainBridge({
    sidecarGeneration: generation, runtimeRoot, changed: state.changed,
    resolveAssets: async () => launchers,
    runtimeDependencies: connectorRuntimeDependencyReader({ installed: async () => ({ runtimeDep: ["uv", "git"], command: ["uvx", "mcp-server-git"] }), environment: () => ({ PATH: "" }) }, { platform: "darwin", developerDirectory: async () => undefined }),
    beginEgress: async (identity) => ({ proxyEnvironment: { HTTPS_PROXY: `http://${identity.attempt}:x@127.0.0.1:4433` } }),
    endEgress: (identity) => void ended.push(identity),
    post: (message) => queueMicrotask(() => toSidecar(structuredClone(message))),
    ...overrides,
  })
  const sidecar = createConnectorLaunchSidecarHost({ sidecarGeneration: generation, launchers, post: (message) => queueMicrotask(() => main.receive(structuredClone(message))) })
  toSidecar = (message) => void sidecar.receive(message)
  return { root, runtimeRoot, launchers, state, main, sidecar, ended }
}
const identity = { directory: "/project", server: "git", attempt: "attempt-1" }

test("snapshots reach the current projection, and the host's requests are answered by main's own authorities", async () => {
  const p = pair()
  const snapshot: LaunchSnapshot = { identity, sidecarGeneration: "4", sequence: 1, state: { phase: "preparing", stage: "launcher", progress: { unit: "activity", detail: "Verifying bundled launchers" } } }
  p.sidecar.host.changed(snapshot)
  p.sidecar.host.changed({ ...snapshot, sidecarGeneration: "3", identity: { ...identity, attempt: "old" } })
  await tick()
  expect(await p.state.api.list("/project")).toEqual([snapshot])
  expect(await p.sidecar.host.runtimeDependencies(identity)).toEqual({ runtimeDep: ["uv", "git"], executables: {}, missing: ["git"] })
  expect(await p.sidecar.host.resolveAssets()).toBe(p.launchers)
})

test("a descriptor main did not build, a failing authority and malformed facts all reject in the sidecar", async () => {
  const p = pair({
    resolveAssets: async () => ({ ...pair().launchers, node: "/usr/local/bin/node" }),
    runtimeDependencies: async () => { throw new Error("installed declaration unreadable") },
  })
  await expect(p.sidecar.host.resolveAssets()).rejects.toThrow("differ from this generation's descriptor")
  await expect(p.sidecar.host.runtimeDependencies(identity)).rejects.toThrow("installed declaration unreadable")
  const malformed = pair({ runtimeDependencies: async () => ({ runtimeDep: ["git"], executables: { git: "git" }, missing: [] }) })
  await expect(malformed.sidecar.host.runtimeDependencies(identity)).rejects.toThrow("invalid runtime dependency facts")
})

test("egress evidence reaches only the attempt that began attribution and is gone after it ends", async () => {
  const p = pair()
  const other = { ...identity, attempt: "attempt-2" }
  expect(await p.sidecar.host.beginEgress(identity)).toEqual({ proxyEnvironment: { HTTPS_PROXY: "http://attempt-1:x@127.0.0.1:4433" } })
  p.main.evidence({ identity, host: "registry.npmjs.org", port: 443, outcome: "refused" })
  p.main.evidence({ identity: other, host: "pypi.org", port: 443, outcome: "refused" })
  await tick()
  expect(await p.sidecar.host.egressEvidence(identity)).toEqual([{ identity, host: "registry.npmjs.org", port: 443, outcome: "refused" }])
  expect(await p.sidecar.host.egressEvidence(other)).toEqual([])
  p.sidecar.host.endEgress(identity)
  await tick()
  expect(p.ended).toEqual([identity])
  expect(await p.sidecar.host.egressEvidence(identity)).toEqual([])
})

test("main's diagnostic query returns this attempt's own transcript and nothing at another path or identity", async () => {
  const p = pair()
  const file = connectorDiagnosticTranscript(p.runtimeRoot, identity.attempt)
  mkdirSync(dirname(file), { recursive: true })
  const stored = { identity, requestedCommand: ["uvx", "mcp-server-git"], effectiveCommand: ["/prepared/bin/mcp-server-git"], cwd: "/project", exitCode: 23, signal: null, stderr: "fatal: not a git repository", stage: "running", transcriptFile: file, error: "spawn detail" }
  writeFileSync(file, JSON.stringify(stored))
  const { error: _error, ...diagnostic } = stored
  expect(await p.main.diagnostic(identity)).toEqual({ ok: true, value: diagnostic })
  expect(await p.main.diagnostic({ ...identity, attempt: "never-ran" })).toEqual({ ok: false, error: "unavailable" })
  writeFileSync(file, JSON.stringify({ ...stored, identity: { ...identity, server: "other" } }))
  expect(await p.main.diagnostic(identity)).toEqual({ ok: false, error: "unavailable" })
  writeFileSync(file, JSON.stringify({ ...stored, transcriptFile: join(p.root, "elsewhere.json") }))
  expect(await p.main.diagnostic(identity)).toEqual({ ok: false, error: "unavailable" })
  writeFileSync(file, "{ torn")
  expect(await p.main.diagnostic(identity)).toEqual({ ok: false, error: "unavailable" })
})

test("stopping either end settles every waiter, and another generation's replies are ignored", async () => {
  const p = pair({ resolveAssets: () => new Promise(() => {}) })
  const waiting = p.sidecar.host.resolveAssets()
  await tick()
  p.sidecar.receive({ type: "codepuppy.connector-launch.reply", id: 1, sidecarGeneration: "3", ok: true, value: p.launchers })
  p.sidecar.close()
  await expect(waiting).rejects.toThrow("closed")
  await expect(p.sidecar.host.runtimeDependencies(identity)).rejects.toThrow("closed")
  const q = pair()
  const query = q.main.diagnostic(identity)
  q.main.dispose()
  expect(await query).toEqual({ ok: false, error: "unavailable" })
})
