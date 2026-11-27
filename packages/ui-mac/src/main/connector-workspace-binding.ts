import fs from "node:fs"
import path from "node:path"
import { parse } from "jsonc-parser"
import type { LaunchIdentity } from "@opencode/util/codepuppy-connector-launch"
import { projectDirectoryIdentity, withProjectDirectoryIdentity } from "../shared/project-directory-identity"
import { tryAcquireBundleLock } from "./ext-bundle-lock"
import { readMcpLeafStrict, rebindProjectMcpCwdInLock } from "./ext-config"
import { persistMcpWithPolicy } from "./ext-mcp-policy"
import type { ReloadRequestInput } from "./reload-coordinator"

export type ConnectorWorkspaceBinding = { kind: "cwd" } | { kind: "location" } | { kind: "failed"; detail: string }

const explicit = (leaf: unknown): leaf is Record<string, unknown> & { cwd: string } =>
  !!leaf && typeof leaf === "object" && !Array.isArray(leaf) && (leaf as Record<string, unknown>).type !== "remote" &&
  typeof (leaf as Record<string, unknown>).cwd === "string" && !((leaf as { cwd: string }).cwd.includes("{workspace}"))

/**
 * R8 "换文件夹": the effective definition of this connector at this Location is the global one when it exists (ext merges
 * project MCP only where the global config has no such name), else the project's own `.codepuppy/codepuppy.jsonc`. An
 * explicit cwd is rewritten in that source through its existing writer, every other field kept, and the existing reload
 * restarts the connector. `{workspace}` or no cwd follows the chosen Location.
 */
export function bindConnectorWorkspace(input: { identity: Pick<LaunchIdentity, "directory" | "server">; folder: string }, reload: (request: ReloadRequestInput) => unknown): ConnectorWorkspaceBinding {
  const { server, directory } = input.identity
  const reason = `connector ${server} working directory changed`
  const global = readMcpLeafStrict(server)
  if (!global.ok) return { kind: "failed", detail: global.reason }
  if (global.value) {
    if (!explicit(global.value)) return { kind: "location" }
    const written = persistMcpWithPolicy(server, { ...global.value, cwd: input.folder })
    if (!written.ok) return { kind: "failed", detail: written.reason }
    reload({ scope: "global", items: [{ id: `mcp:${server}`, scope: "global" }], reason })
    return { kind: "cwd" }
  }
  const project = projectDirectoryIdentity(directory)
  if (project.status !== "project") return { kind: "location" }
  const read = withProjectDirectoryIdentity(project, (root) => {
    const file = path.join(root, "codepuppy.jsonc")
    return fs.existsSync(file) ? (parse(fs.readFileSync(file, "utf8")) as { mcp?: Record<string, unknown> } | undefined)?.mcp?.[server] : undefined
  })
  if (!read.ok) return { kind: "failed", detail: read.reason }
  if (!explicit(read.value)) return { kind: "location" }
  const lock = tryAcquireBundleLock(project.root, { txId: "connector-workspace-binding" })
  if (!lock.ok) return { kind: "failed", detail: lock.reason }
  try {
    const written = rebindProjectMcpCwdInLock(project.root, server, input.folder)
    if (!written.ok) return { kind: "failed", detail: written.reason }
  } finally {
    lock.lock.release()
  }
  reload({ scope: { directory }, items: [{ id: `mcp:${server}`, scope: "project" }], reason })
  return { kind: "cwd" }
}
