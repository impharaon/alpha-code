import { Schema } from "effect"
import { ToolIdentity } from "@opencode/schema/tool-identity"
import { readFileSync } from "node:fs"
import { readPackageAllowSet } from "../../../ext/src/gen-skill-paths"
import { scopedPackageAllowedHere } from "../../../ext/src/package-scope"
import { projectDirectoryIdentity } from "../../../ext/src/project-config"
import { projectServerConfig } from "../../../ext/src/engine-transforms"
import type { EngineConnection } from "./engine-authorization"
import { engineClient } from "./engine-client"
import { launchedByPackageRunner, RUNNER_FIRST_FETCH_STARTUP_MS } from "./engine-explicit-config"
import { readMcpLeafStrict } from "./ext-config"
import { projectScopeIdentity, readPackageLedgerStateV1 } from "./ext-receipt-v2"
import type { PackageGraphV1 } from "./ext-package-ledger-v3"

export type PackageMcpActivationV1 = { directory: string; name: string; status: string; detail?: string }

/** Runtime overrides are applied only after durable package state, then observed through the engine's own routes. */
export async function applyPackageMcpV1(
  packageId: string,
  directory: string,
  deps: { root(): string; awaitServer(): Promise<EngineConnection> },
): Promise<PackageMcpActivationV1[]> {
  const state = readPackageLedgerStateV1(deps.root(), { sideEffectFree: true })
  if (!state.ok) return [{ directory, name: "", status: "unavailable", detail: "Package state could not be read" }]
  const graph = state.packageGraphs.find((graph) => graph.packageId === packageId)
  const nodes = graph ? [graph.root, ...graph.children] : state.records.filter((record) => record.id === packageId)
  const root = graph
    ? state.records.find((record) => record.kind === graph.root.kind && record.name === graph.root.name)
    : nodes[0]
  const enabled = root && "desiredState" in root && root.desiredState === "enabled"
  const names = nodes.filter((node) => node.kind === "mcp").map((node) => node.name)
  if (!names.length) return []
  try {
    const client = engineClient(await deps.awaitServer())
    const directories = [
      ...new Set([directory, ...(await client.debug.location.list()).map((location) => location.directory)]),
    ]
    return (
      await Promise.all(
        directories
          .map(async (target) => {
            const location = { directory: target }
            return Promise.all(
              names.map(async (name): Promise<PackageMcpActivationV1> => {
                try {
                  const project = graph?.effect ? projectDirectoryIdentity(target) : undefined
                  const activeHere = enabled && packageAppliesAt(graph, target) && (
                    !graph?.effect || scopedPackageAllowedHere(
                      "mcp", name, readPackageAllowSet(deps.root()),
                      project?.status === "project" ? project.directory : undefined,
                    )
                  )
                  if (!activeHere) {
                    const pending = (await client.permission.request.list({ location })).data
                    const replied = new Set<string>()
                    for (const request of pending) {
                      const identity = request.metadata?.identity
                      if (!Schema.is(ToolIdentity)(identity) || identity.source !== "mcp" || identity.origin !== name || replied.has(request.sessionID)) continue
                      await client.permission.reply({ sessionID: request.sessionID, requestID: request.id, decision: "reject" })
                      replied.add(request.sessionID)
                    }
                    const servers = (await client.mcp.list({ location })).data
                    if (servers.some((server) => server.name === name))
                      await client.experimental.mcp.disconnect({ server: name, location })
                    else if (!enabled && packageAppliesAt(graph, target)) {
                      // A skill/config reload can remove a runtime-only server. Keep its disabled
                      // definition visible without resolving or opening any credential file.
                      const leaf = readMcpLeafStrict(name)
                      const config = leaf.ok && leaf.value ? projectServerConfig(leaf.value) : undefined
                      if (config) await client.experimental.mcp.add({ server: name, config: { ...config, disabled: true }, location })
                    }
                  }
                  if (activeHere) {
                    const leaf = readMcpLeafStrict(name)
                    if (!leaf.ok || !leaf.value)
                      return {
                        directory: target,
                        name,
                        status: "unavailable",
                        detail: "Installed connector definition is unavailable",
                      }
                    const config = projectServerConfig(resolveFileReferences(leaf.value))
                    if (!config)
                      return {
                        directory: target,
                        name,
                        status: "failed",
                        detail: "Installed connector definition is invalid",
                      }
                    const startup = launchedByPackageRunner(config) && !config.timeout ? { timeout: { startup: RUNNER_FIRST_FETCH_STARTUP_MS } } : {}
                    await client.experimental.mcp.add({ server: name, config: { ...config, ...startup, disabled: false }, location })
                    await client.experimental.mcp.connect({ server: name, location })
                  }
                  const server = (await client.mcp.list({ location })).data.find((server) => server.name === name)
                  return {
                    directory: target,
                    name,
                    status: server?.status.status ?? "not-loaded",
                    ...(server?.status.status === "failed" ? { detail: server.status.error } : {}),
                  }
                } catch {
                  return {
                    directory: target,
                    name,
                    status: "unavailable",
                    detail: "Connector could not be applied; installed content is retained",
                  }
                }
              }),
            )
          }),
      )
    ).flat()
  } catch {
    return names.map((name) => ({
      directory,
      name,
      status: "unavailable",
      detail: "Engine is unavailable; installed content is retained",
    }))
  }
}

/** Removal uses the captured, previously committed graph; reading after removal would lose its component identity. */
export async function removePackageMcpV1(
  graph: {
    root: { kind: string; name: string }
    children: { kind: string; name: string }[]
    effect?: PackageGraphV1["effect"]
  },
  directory: string,
  awaitServer: () => Promise<EngineConnection>,
): Promise<void> {
  const client = engineClient(await awaitServer())
  for (const target of [
    ...new Set([directory, ...(await client.debug.location.list()).map((location) => location.directory)]),
  ]) {
    const location = { directory: target }
    const servers = (await client.mcp.list({ location })).data
    for (const node of [graph.root, ...graph.children].filter(
      (node) => node.kind === "mcp" && servers.some((server) => server.name === node.name),
    ))
      await client.experimental.mcp.remove({ server: node.name, location })
  }
}

export function packageAppliesAt(graph: Pick<PackageGraphV1, "effect"> | undefined, directory: string): boolean {
  if (!graph?.effect) return true
  const project = projectDirectoryIdentity(directory)
  if (project.status !== "project") return false
  const identity = projectScopeIdentity(project.directory)
  return identity.ok && identity.scope.projectPath === graph.effect.projectPath && identity.scope.projectPathHash === graph.effect.projectPathHash
}

function resolveFileReferences(value: Record<string, unknown>): Record<string, unknown> {
  const resolve = (input: unknown): unknown => {
    if (typeof input === "string")
      return input.replace(/\{file:([^}]+)\}/g, (_match, file: string) => readFileSync(file, "utf8"))
    if (Array.isArray(input)) return input.map(resolve)
    if (input && typeof input === "object")
      return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, resolve(item)]))
    return input
  }
  // The only input is main's registered, validated leaf; never a renderer/sidecar-supplied file path.
  return resolve(value) as Record<string, unknown>
}
