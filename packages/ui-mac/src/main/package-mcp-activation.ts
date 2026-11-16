import { readFileSync } from "node:fs"
import { projectServerConfig } from "../../../ext/src/engine-transforms"
import type { EngineConnection } from "./engine-authorization"
import { engineClient } from "./engine-client"
import { readMcpLeafStrict } from "./ext-config"
import { readPackageLedgerStateV1 } from "./ext-receipt-v2"
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
          .filter((target) => packageAppliesAt(graph, target))
          .map(async (target) => {
            const location = { directory: target }
            return Promise.all(
              names.map(async (name): Promise<PackageMcpActivationV1> => {
                try {
                  if (!enabled) {
                    const servers = (await client.mcp.list({ location })).data
                    if (servers.some((server) => server.name === name))
                      await client.experimental.mcp.disconnect({ server: name, location })
                  }
                  if (enabled) {
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
                    await client.experimental.mcp.add({ server: name, config, location })
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
  ].filter((target) => packageAppliesAt(graph, target))) {
    const location = { directory: target }
    const servers = (await client.mcp.list({ location })).data
    for (const node of [graph.root, ...graph.children].filter(
      (node) => node.kind === "mcp" && servers.some((server) => server.name === node.name),
    ))
      await client.experimental.mcp.remove({ server: node.name, location })
  }
}

export function packageAppliesAt(graph: Pick<PackageGraphV1, "effect"> | undefined, directory: string): boolean {
  return graph?.effect === undefined || graph.effect.projectPath === directory
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
