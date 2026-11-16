import { createHash } from "node:crypto"
import { join } from "node:path"
import type { Capture, TreeNode } from "../../src/shared/host-extension-package-contract/plugin-conversion"
import provenance from "./provenance.json"
import codex from "./codex/provenance.json"

export const fixtureRoot = import.meta.dir
export const fixtureCommit = provenance.commit
export const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const

/** Captures our boundary from the recorded upstream files, with explicit controlled byte/path variants. */
export async function captureFixture(plugin: string, changes: Record<string, string | null> = {}, ecosystem: "claude" | "codex" = "claude"): Promise<Capture> {
  const recorded = ecosystem === "codex" ? codex : provenance
  const root = ecosystem === "codex" ? join(fixtureRoot, "codex") : fixtureRoot
  const files = new Map<string, Uint8Array>()
  for (const file of recorded.files.filter((file) => file.path.startsWith(`${plugin}/`)))
    files.set(file.path.slice(plugin.length + 1), new Uint8Array(await Bun.file(join(root, file.path)).arrayBuffer()))
  for (const [path, text] of Object.entries(changes)) {
    if (text === null) files.delete(path)
    else files.set(path, new TextEncoder().encode(text))
  }
  const nodes: TreeNode[] = [...files].map(([path, bytes]) => ({ kind: "file", path, mode: 0o644, bytes: bytes.length, digest: digest(bytes) }))
  return {
    source: { kind: "marketplace", locator: recorded.repository, repository: recorded.repository, commit: recorded.commit, pluginPath: plugin, ecosystem },
    nodes,
    readFile: async (path) => {
      const bytes = files.get(path)
      if (!bytes) throw new Error(`fixture file missing: ${path}`)
      return bytes
    },
  }
}
