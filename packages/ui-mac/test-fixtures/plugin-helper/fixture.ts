import { createHash } from "node:crypto"
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Capture, TreeNode } from "../../src/shared/host-extension-package-contract/plugin-conversion"
import provenance from "./provenance.json"
import codex from "./codex/provenance.json"
import opencode from "./opencode/provenance.json"
import whole from "./whole/provenance.json"
import standard from "./standard/provenance.json"

// Keep foreign Markdown only in pinned archives; all consumers read the same temporary tree.
export const fixtureRoot = mkdtempSync(join(tmpdir(), "plugin-helper-samples-"))
process.once("exit", () => rmSync(fixtureRoot, { recursive: true, force: true }))
cpSync(import.meta.dir, fixtureRoot, { recursive: true })
for (const tree of [
  { root: "", archive: provenance.archive },
  { root: "codex", archive: codex.archive },
  { root: "whole", archive: whole.archive },
  { root: "standard", archive: standard.archive },
  ...opencode.trees.map(tree => ({ root: join("opencode", tree.root), archive: tree.archive })),
]) {
  const target = join(fixtureRoot, tree.root)
  mkdirSync(target, { recursive: true })
  const extracted = Bun.spawnSync(["tar", "-xzf", join(import.meta.dir, tree.root, tree.archive.path), "-C", target, "--strip-components=1"])
  if (extracted.exitCode !== 0) throw new Error(`Cannot unpack pinned fixture ${tree.root}: ${extracted.stderr.toString()}`)
}
export const fixtureCommit = provenance.commit
export const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const

/** Real package members, including original directory/file modes; selection never invents source bytes. */
export async function captureWholeFixture(name: string, select?: (path: string) => boolean): Promise<Capture> {
  const sample = whole.samples.find(sample => sample.name === name)!
  const root = join(fixtureRoot, "whole", sample.root)
  const nodes: TreeNode[] = sample.files.filter(file => !select || select(file.path)).map(file =>
    file.kind === "directory" ? { kind: "directory", path: file.path, mode: file.mode }
      : file.kind === "symlink" ? { kind: "symlink", path: file.path, target: "target" in file ? String(file.target) : "" }
      : { kind: "file", path: file.path, mode: file.mode, bytes: "bytes" in file ? Number(file.bytes) : 0, digest: `sha256:${"sha256" in file ? file.sha256 : ""}` })
  return {
    source: { kind: "marketplace", locator: sample.repository, repository: sample.repository, commit: sample.commit, pluginPath: sample.pluginPath, entryName: sample.name, ecosystem: sample.ecosystem as "claude" | "codex" },
    materialization: "copy",
    nodes,
    readFile: async path => new Uint8Array(await Bun.file(join(root, path)).arrayBuffer()),
  }
}

/** Captures our boundary from the recorded upstream files, with explicit controlled byte/path variants. */
export async function captureFixture(plugin: string, changes: Record<string, string | null> = {}, ecosystem: "claude" | "codex" | "opencode" = "claude"): Promise<Capture> {
  const recorded = ecosystem === "opencode" ? opencode.trees.find((tree) => tree.root === plugin)! : ecosystem === "codex" ? codex : provenance
  const root = ecosystem === "opencode" ? join(fixtureRoot, "opencode", plugin) : ecosystem === "codex" ? join(fixtureRoot, "codex") : fixtureRoot
  const files = new Map<string, Uint8Array>()
  for (const file of recorded.files.filter((file) => ecosystem === "opencode" || file.path.startsWith(`${plugin}/`)))
    files.set(ecosystem === "opencode" ? file.path : file.path.slice(plugin.length + 1), new Uint8Array(await Bun.file(join(root, file.path)).arrayBuffer()))
  for (const [path, text] of Object.entries(changes)) {
    if (text === null) files.delete(path)
    else files.set(path, new TextEncoder().encode(text))
  }
  const nodes: TreeNode[] = [...files].map(([path, bytes]) => ({ kind: "file", path, mode: 0o644, bytes: bytes.length, digest: digest(bytes) }))
  return {
    source: { kind: "marketplace", locator: recorded.repository, repository: recorded.repository, commit: recorded.commit, pluginPath: plugin, ecosystem },
    materialization: "copy",
    nodes,
    readFile: async (path) => {
      const bytes = files.get(path)
      if (!bytes) throw new Error(`fixture file missing: ${path}`)
      return bytes
    },
  }
}

/** Pinned compatibility-report samples; only recorded source members and explicit controlled variants. */
export async function captureStandardFixture(name: string, changes: Record<string, string | null> = {}): Promise<Capture> {
  const sample = standard.samples.find(sample => sample.name === name)!
  const files = new Map(await Promise.all(sample.files.map(async file => [file.path, await Bun.file(join(fixtureRoot, "standard", sample.root, file.path)).bytes()] as const)))
  for (const [path, value] of Object.entries(changes)) {
    if (value === null) files.delete(path)
    else files.set(path, new TextEncoder().encode(value))
  }
  return {
    source: { kind: "marketplace", locator: sample.repository, repository: sample.repository, commit: sample.commit, pluginPath: sample.pluginPath, entryName: name.split(":")[1], ecosystem: sample.ecosystem as "claude" | "codex" },
    materialization: "copy",
    nodes: [...files].map(([path, bytes]) => ({ kind: "file", path, mode: sample.files.find(file => file.path === path)?.mode ?? 0o644, bytes: bytes.length, digest: digest(bytes) })),
    readFile: async path => { const bytes = files.get(path); if (!bytes) throw Error("Missing sample file"); return bytes },
  }
}
