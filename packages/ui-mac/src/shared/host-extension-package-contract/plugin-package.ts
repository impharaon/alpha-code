import type { TreeNode } from "./plugin-conversion.mjs"

export function pluginRelativePath(value: unknown): value is string {
  return typeof value === "string" && !!value && !value.includes("\0") && !value.includes("\\") && !value.startsWith("/") && !/^[A-Za-z]:/.test(value) && value.split("/").every(part => !!part && part !== "." && part !== "..")
}

/** Validate tree metadata for CAS and generation transactions; callers verify the actual bytes. */
export function validPluginTree(value: unknown): value is TreeNode[] {
  if (!Array.isArray(value)) return false
  const nodes = new Map<string, TreeNode>()
  for (const node of value) {
    if (!object(node) || !pluginRelativePath(node.path) || nodes.has(node.path)) return false
    if (node.kind === "symlink") {
      if (!keys(node, ["kind", "path", "target"]) || typeof node.target !== "string" || node.target.includes("\0")) return false
    } else {
      if (!Number.isInteger(node.mode) || Number(node.mode) < 0 || Number(node.mode) > 0o7777) return false
      if (node.kind === "directory") {
        if (!keys(node, ["kind", "path", "mode"])) return false
      } else if (node.kind !== "file" || !keys(node, ["kind", "path", "mode", "bytes", "digest"]) || !Number.isSafeInteger(node.bytes) || Number(node.bytes) < 0 || !digest(node.digest)) return false
    }
    nodes.set(node.path, node as TreeNode)
  }
  // A link/file cannot be an ancestor of a declared destination, regardless of node order.
  return [...nodes.values()].every(node => node.path.split("/").slice(0, -1).every((_, index, parts) => {
    const parent = nodes.get(parts.slice(0, index + 1).join("/"))
    return !parent || parent.kind === "directory"
  }))
}

function keys(value: Record<string, unknown>, allowed: string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)) }
function digest(value: unknown): boolean { return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value) }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) }
