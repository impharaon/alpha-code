import { bindPluginMcpProxy, revokePluginMcpProxy } from "./plugin-mcp-proxy"
import { canonicalJson, sha256Hex } from "./ext-manifest-v2"
import { basename, dirname } from "node:path"
import { bindPluginMcp } from "../shared/plugin-mcp-config"
import { readInstalledPluginSettings } from "../shared/installed-plugin-settings"
import { installedPluginDescription } from "./plugin-package-config"
import { collectMcpFileRefPaths } from "./codepuppy-mcp-secrets"
import { pluginEnvironment } from "./plugin-package-data"
import { Schema } from "effect"
import { ToolIdentity } from "@opencode/schema/tool-identity"
import { realpathSync, statSync } from "node:fs"
import { resolveConnectorLeaf, type CodePuppyCredentials } from "@opencode/util/codepuppy-credentials"
import { readPackageAllowSet } from "../../../ext/src/gen-skill-paths"
import { managedMcpAllowedHere } from "../../../ext/src/package-scope"
import { projectDirectoryIdentity } from "../../../ext/src/project-config"
import { projectServerConfig } from "../../../ext/src/engine-transforms"
import type { EngineConnection } from "./engine-authorization"
import { engineClient } from "./engine-client"
import { launchedByPackageRunner, RUNNER_FIRST_FETCH_STARTUP_MS } from "./engine-explicit-config"
import { readMcpLeafStrict } from "./ext-config"
import { projectScopeIdentity, readPackageLedgerStateV1 } from "./ext-receipt-v2"
import type { PackageGraphV1 } from "./ext-package-ledger-v3"
import { credentialStores, readCredentialTable, readRegularFileNoFollow } from "./codepuppy-secret-files"
import { isOfficialConnector } from "./official-connector-names"
import { officialRuntimeParent } from "./official-connector-recipes"
import { officialAvailabilityPublished, settleOfficialConnectorCredential } from "./official-connector-resources"
import { credentialReferenceGuard, planCredentialStores } from "./process-fence-plan"

export type PackageMcpActivationV1 = { directory: string; name: string; status: string; detail?: string }

export type ManagedMcpConvergenceDeps = {
  root(): string
  awaitServer(): Promise<EngineConnection>
  /** Main's own Location; converged even before anything loaded it, next to every loaded Location. */
  directory(): string
  /** Code Puppy's userData: where the credential stores live (DESIGN-stored-credentials-fence §4.3). */
  userDataPath(): string
  /** Names only, never values: credential references this path refused to read (design §5). */
  log?(line: string): void
}

/** MCP names of an installed package (by package ID) or of one standalone record (by record ID). */
export function managedMcpNamesOf(root: string, id: string): string[] {
  const state = readPackageLedgerStateV1(root, { sideEffectFree: true })
  if (!state.ok) return []
  const graph = state.packageGraphs.find((entry) => entry.packageId === id)
  const nodes = graph ? [graph.root, ...graph.children] : state.records.filter((record) => record.id === id)
  return nodes.filter((node) => node.kind === "mcp").map((node) => node.name)
}

/**
 * design v9 §4.4「运行时收敛」: the only main entry for runtime operations on managed global MCP. Same name runs
 * serially; a request during a run schedules exactly one rerun (coalesced); different names never wait for each
 * other. Every run reads its inputs when it starts — the published allow-set, the ledger and the loaded
 * Locations — and never the requester's intent, so the last run starts after the last publication.
 */
export function createManagedMcpConvergence(deps: ManagedMcpConvergenceDeps) {
  const tails = new Map<string, Promise<unknown>>()
  const queued = new Map<string, Promise<PackageMcpActivationV1[]>>()
  const request = (name: string): Promise<PackageMcpActivationV1[]> => {
    const waiting = queued.get(name)
    if (waiting) return waiting
    const run = (tails.get(name) ?? Promise.resolve()).then(() => {
      queued.delete(name)
      return converge(name, deps)
    })
    queued.set(name, run)
    const tail = run.catch(() => undefined)
    tails.set(name, tail)
    void tail.then(() => {
      if (tails.get(name) === tail) tails.delete(name)
    })
    return run
  }
  return async function convergeManagedMcp(names: readonly string[]): Promise<PackageMcpActivationV1[]> {
    return (await Promise.all([...new Set(names)].map(request))).flat()
  }
}

async function converge(name: string, deps: ManagedMcpConvergenceDeps): Promise<PackageMcpActivationV1[]> {
  const directory = deps.directory()
  const state = readPackageLedgerStateV1(deps.root(), { sideEffectFree: true })
  if (!state.ok) return [{ directory, name, status: "unavailable", detail: "Package state could not be read" }]
  const record = state.records.find((entry) => entry.kind === "mcp" && entry.name === name && entry.scope.kind === "global")
  const graph = state.packageGraphs.find((entry) => [entry.root, ...entry.children].some((node) => node.kind === "mcp" && node.name === name))
  if (!record || record.desiredState === "disabled") revokePluginMcpProxy(name)
  const official = record && isOfficialConnector(name) ? name : undefined
  // Official recipe: materialize before applying an enabled intent, and clear after disconnecting a disabled one.
  const materialized = official && record?.desiredState === "enabled" ? settleOfficialConnectorCredential(official, "enabled") : true
  if (official && record?.desiredState === "enabled") await officialAvailabilityPublished()
  const allowSet = readPackageAllowSet(deps.root())
  let results: PackageMcpActivationV1[]
  try {
    const client = engineClient(await deps.awaitServer())
    const directories = [...new Set([directory, ...(await client.debug.location.list()).map((location) => location.directory)])]
    // Read once per run, and only when some Location applies an enabled definition (a disable never opens a store).
    let read: ConnectorCredentials | undefined
    const credentials = () => (read ??= connectorCredentials(deps))
    results = await Promise.all(directories.map((target) => applyAt(client, target, name, record, graph, allowSet, credentials, deps.root())))
  } catch {
    results = [{ directory, name, status: "unavailable", detail: "Engine is unavailable; installed content is retained" }]
  }
  if (official && record?.desiredState === "disabled") {
    settleOfficialConnectorCredential(official, "disabled")
    await officialAvailabilityPublished()
  }
  return materialized ? results : results.map((result) => ({ ...result, detail: "official-connector-needs-reentry" }))
}

async function applyAt(
  client: ReturnType<typeof engineClient>,
  target: string,
  name: string,
  record: { desiredState: string } | undefined,
  graph: PackageGraphV1 | undefined,
  allowSet: ReturnType<typeof readPackageAllowSet>,
  credentials: () => ConnectorCredentials,
  root: string,
): Promise<PackageMcpActivationV1> {
  const location = { directory: target }
  try {
    const servers = (await client.mcp.list({ location })).data
    const listed = servers.some((server) => server.name === name)
    const project = projectDirectoryIdentity(target)
    if (!record) {
      if (listed) await client.experimental.mcp.remove({ server: name, location })
    } else if (managedMcpAllowedHere(name, allowSet, project.status === "project" ? project.directory : undefined)) {
      const leaf = readMcpLeafStrict(name)
      if (!leaf.ok || !leaf.value)
        return { directory: target, name, status: "unavailable", detail: "Installed connector definition is unavailable" }
      // The credential table is read only for a definition that references a file (review R1 item 3: one unreadable store entry must not
      // make a connector without credentials unavailable).
      const installed = graph?.pluginTree && installedPluginDescription(root, graph)
      const settings = graph?.pluginTree && readInstalledPluginSettings(root, graph.pluginTree.storeKey)
      const entry = installed && installed.description.entries.find(entry => entry.kind === "mcp" && installed.hostNames[entry.id] === name)
      const refs = collectMcpFileRefPaths(leaf.value)
      const bound = installed && settings && entry?.kind === "mcp" ? bindPluginMcp({ description: installed.description, entry, settings, pluginRoot: installed.pluginRoot, projectDir: target,
        resolveEnvironment: pluginEnvironment,
        resolveOptionSecret: reference => (resolveConnectorLeaf({ server: graph!.root.name, leaf: { environment: { value: reference } }, ...credentials() }) as { environment: { value: string } }).environment.value,
        resolveSecret: id => refs.find(file => basename(file) === id) ? "{file:" + refs.find(file => basename(file) === id)! + "}" : undefined,
      }) : leaf.value
      const resolved = JSON.stringify(bound).includes("{file:") ? resolveConnectorLeaf({ server: name, leaf: bound, ...credentials() }) : bound
      if (installed && settings && entry?.kind === "mcp" && bound.type === "remote" && typeof bound.url === "string") await bindPluginMcpProxy(name, {
        packageId: graph!.packageId, entryId: entry.id, generation: basename(dirname(installed.pluginRoot)),
        definitionDigest: ("sha256:" + sha256Hex(canonicalJson([entry, settings.values, settings.versions]))) as `sha256:${string}`,
        serverUrl: resolved && typeof resolved === "object" && "url" in resolved && typeof resolved.url === "string" ? resolved.url : bound.url,
      })
      const config = projectServerConfig(resolved)
      if (!config) return { directory: target, name, status: "failed", detail: "Installed connector definition is invalid" }
      const startup = launchedByPackageRunner(config) && !config.timeout ? { timeout: { startup: RUNNER_FIRST_FETCH_STARTUP_MS } } : {}
      await client.experimental.mcp.add({ server: name, config: { ...config, ...startup, disabled: false }, location })
      await client.experimental.mcp.connect({ server: name, location })
    } else {
      // Rejecting this connector's own pending approvals is best effort: one the user answered meanwhile is already
      // gone and the engine refuses the reply. That must never stop the disconnect below (Codex R1 #1).
      const pending = await client.permission.request.list({ location }).then((response) => response.data, () => [])
      const replied = new Set<string>()
      for (const request of pending) {
        const identity = request.metadata?.identity
        if (!Schema.is(ToolIdentity)(identity) || identity.source !== "mcp" || identity.origin !== name || replied.has(request.sessionID)) continue
        const rejected = await client.permission.reply({ sessionID: request.sessionID, requestID: request.id, decision: "reject" }).then(() => true, () => false)
        if (rejected) replied.add(request.sessionID)
      }
      if (listed) await client.experimental.mcp.disconnect({ server: name, location })
      else if (record.desiredState === "disabled" && packageAppliesAt(graph, target)) {
        // A skill/config reload can remove a runtime-only server. Keep its disabled
        // definition visible without resolving or opening any credential file.
        const leaf = readMcpLeafStrict(name)
        const config = leaf.ok && leaf.value ? projectServerConfig(leaf.value) : undefined
        if (config) await client.experimental.mcp.add({ server: name, config: { ...config, disabled: true }, location })
      }
    }
    const server = (await client.mcp.list({ location })).data.find((entry) => entry.name === name)
    return {
      directory: target,
      name,
      status: server?.status.status ?? "not-loaded",
      ...(server?.status.status === "failed" ? { detail: server.status.error } : {}),
    }
  } catch {
    return { directory: target, name, status: "unavailable", detail: "Connector could not be applied; installed content is retained" }
  }
}

export function packageAppliesAt(graph: Pick<PackageGraphV1, "effect"> | undefined, directory: string): boolean {
  if (!graph?.effect) return true
  const project = projectDirectoryIdentity(directory)
  if (project.status !== "project") return false
  const identity = projectScopeIdentity(project.directory)
  return identity.ok && identity.scope.projectPath === graph.effect.projectPath && identity.scope.projectPathHash === graph.effect.projectPathHash
}

export type ConnectorCredentials = Omit<Parameters<typeof resolveConnectorLeaf>[0], "server" | "leaf">

/**
 * DESIGN-stored-credentials-fence §4.3 / (d): the table of Code Puppy's credential stores, read now, and the store-target test built from
 * the same real-target list the fence's C1 uses. A reference into a store is substituted only as this connector's own credential field in
 * its exact spelling; every other reference into a store becomes an empty string and its file is never opened (resolveConnectorLeaf).
 * The only leaf is main's registered, validated one; never a renderer/sidecar-supplied file path.
 */
export function connectorCredentials(deps: Pick<ManagedMcpConvergenceDeps, "root" | "userDataPath" | "log">): ConnectorCredentials {
  let runtimeParent: string | undefined
  try {
    runtimeParent = officialRuntimeParent(deps.root())
  } catch {
    runtimeParent = undefined // no official runtime storage point here (design §4.5: the entry is simply not given)
  }
  const stores = credentialStores({ userDataPath: deps.userDataPath(), ...(runtimeParent ? { officialRuntimeParent: runtimeParent } : {}) })
  const realpath = (p: string) => realpathSync.native(p)
  const identities = new Set<string>()
  const table: CodePuppyCredentials = readCredentialTable(stores, deps.log, identities)
  const guard = credentialReferenceGuard(planCredentialStores(stores, { realpath }), identities, {
    realpath,
    stat: (p) => statSync(p, { bigint: true }),
    readRegular: readRegularFileNoFollow,
    ...(deps.log ? { log: deps.log } : {}),
  })
  return { table, isStoreTarget: guard.isStoreTarget, readFile: guard.readFile, ...(deps.log ? { log: deps.log } : {}) }
}
