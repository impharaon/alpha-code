import { INSTALLED_PLUGIN_PACKAGE_FILE, PLUGIN_TREE_DIRECTORY, type CommandSourceBinding, type InstalledPluginPackageV1 } from "../shared/installed-plugin-package"
import { createHash } from "node:crypto"
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path"
import { renderInstalledSkill } from "../shared/host-extension-package-contract/plugin-conversion.mjs"
import {
  canonicalPluginJson,
  pluginTreeDigest,
  validPluginPackage,
  type Entry,
  type LinkedNode,
  type Text,
  type PluginPackage,
  type TreeNode,
} from "../shared/host-extension-package-contract/plugin-package"
import { materializePluginTreeFromCas, putCasBlobFromBuffer } from "./ext-cas"
import { extensionHealthProbeRouter } from "./ext-health-probe-router"
import { probeLedgerForWrite, type UpsertInput } from "./ext-receipt-v2"
import type { PackageTxBuildV1 } from "./ext-package-tx-builders"

/** One captured package becomes one generation and receipt-only skill registrations. */
export async function buildPluginPackageTxItems<D extends PluginPackage>(input: {
  root: string
  casBaseRoot: string
  key: string
  receipt: UpsertInput
  description: D
  hostNames: ReadonlyMap<string, string>
  skillReceipts: UpsertInput[]
  readFile(path: string): Promise<Uint8Array>
  /** Link mode: the converter's redacted bytes and the located directory's listing (never followed through links). */
  replacements?: ReadonlyMap<string, Uint8Array>
  readDirectory?(path: string): Promise<readonly LinkedNode[]>
  commandSource?: Omit<CommandSourceBinding, "identity">
}): Promise<
  | { ok: true; build: PackageTxBuildV1; description: D; manifestDigest: string }
  | { ok: false; reason: string }
> {
  if (!validPluginPackage(input.description)) return { ok: false, reason: "Plugin package description is invalid" }
  const content = input.description.materialization === "link"
    ? await linkedPluginView(input.description, input.replacements ?? new Map(), input.readDirectory)
    : await copiedPluginTree({ ...input, description: input.description })
  if (!content.ok) return content
  // The copy keeps its materialization; only installed skill copies and relocated links change its tree.
  const description = content.description as D
  const metadata: InstalledPluginPackageV1 = {
    description,
    hostNames: Object.fromEntries(input.hostNames),
    ...(description.materialization === "link" ? { view: content.tree } : {}),
    ...(input.commandSource ? { commandSource: { ...input.commandSource, identity: description.materialization === "link" ? description.link.bindingId : description.treeDigest } } : {}),
  }
  const metadataBytes = Buffer.from(canonicalPluginJson(metadata))
  const generationTree: TreeNode[] = [
    { kind: "directory", path: PLUGIN_TREE_DIRECTORY, mode: 0o755 },
    ...content.tree.map((node) => ({ ...node, path: PLUGIN_TREE_DIRECTORY + "/" + node.path })),
    {
      kind: "file",
      path: INSTALLED_PLUGIN_PACKAGE_FILE,
      mode: 0o600,
      bytes: metadataBytes.length,
      digest: `sha256:${hash(metadataBytes)}`,
    },
  ]
  for (const [path, bytes] of [...content.files, [INSTALLED_PLUGIN_PACKAGE_FILE, metadataBytes] as const]) {
    const put = putCasBlobFromBuffer(input.casBaseRoot, bytes, hash(bytes))
    if (!put.ok) return { ok: false, reason: "Plugin content could not be staged: " + path }
  }
  const manifestDigest = "sha256:" + hash(metadataBytes)
  const items = [
    {
      key: input.key,
      files: generationTree.flatMap((node) =>
        node.kind === "file"
          ? [{ path: node.path, sha256: node.digest.slice(7), size: node.bytes, mode: node.mode }]
          : [],
      ),
      tree: generationTree,
      receipt: input.receipt,
      manifestDigest,
      capabilities: [],
    },
    ...input.skillReceipts.map((receipt) => ({
      key: "skill--" + receipt.name,
      action: "receipt" as const,
      receipt,
      manifestDigest,
      capabilities: [],
    })),
  ]
  return {
    ok: true,
    description,
    manifestDigest,
    build: {
      items,
      receipt: input.receipt,
      populate: (_item, staging) => materializePluginTreeFromCas(input.casBaseRoot, generationTree, staging),
      precondition: () => probeLedgerForWrite(input.root),
      probe: extensionHealthProbeRouter(input.root),
    },
  }
}

/** Copy: the whole captured tree with installed-name skill copies and package-internal absolute links relocated. */
async function copiedPluginTree(input: {
  description: Extract<PluginPackage, { materialization: "copy" }>
  hostNames: ReadonlyMap<string, string>
  readFile(path: string): Promise<Uint8Array>
}): Promise<{ ok: true; description: PluginPackage; tree: TreeNode[]; files: Map<string, Buffer> } | { ok: false; reason: string }> {
  const files = new Map<string, Buffer>()
  const tree: TreeNode[] = []
  for (const node of input.description.tree) {
    if (node.kind !== "file") {
      // Capture locators for disk trees identify the original root. Archive links are already relative.
      const inside =
        node.kind === "symlink" && isAbsolute(node.target) && isAbsolute(input.description.source.locator)
          ? relative(input.description.source.locator, node.target)
          : undefined
      tree.push(
        node.kind === "symlink" &&
          inside !== undefined &&
          inside !== ".." &&
          !inside.startsWith("../") &&
          !isAbsolute(inside)
          ? {
              ...node,
              target:
                relative(
                  dirname(resolve(input.description.source.locator, node.path)),
                  resolve(input.description.source.locator, inside),
                ) || ".",
            }
          : node,
      )
      continue
    }
    const original = Buffer.from(await input.readFile(node.path))
    if (original.length !== node.bytes || hash(original) !== node.digest.slice(7))
      return { ok: false, reason: "Plugin file integrity mismatch: " + node.path }
    const entry = input.description.entries.find((entry) => entry.kind === "skill" && entry.sourcePath === node.path)
    const bytes =
      entry?.kind === "skill"
        ? Buffer.from(
            renderInstalledSkill(
              entry,
              original,
              new Map([
                ...input.hostNames,
                ...input.description.entries
                  .filter((entry) => entry.kind === "mcp" && input.hostNames.has(entry.id))
                  .map((entry) => [entry.sourceName, input.hostNames.get(entry.id)!] as const),
              ]),
            ),
          )
        : original
    files.set(node.path, bytes)
    tree.push({ ...node, bytes: bytes.length, digest: `sha256:${hash(bytes)}` })
  }
  return { ok: true, description: { ...input.description, tree, treeDigest: pluginTreeDigest(tree) }, tree, files }
}

/**
 * Link (DESIGN §4.16): the managed root links each top-level entry of the located directory, so ordinary files run in place. Only
 * the ancestors of a file whose redacted bytes replace a secret become real directories, their other children stay links, and the
 * redacted file itself is written — the sensitive original is never reachable through the installed view.
 */
async function linkedPluginView(
  description: Extract<PluginPackage, { materialization: "link" }>,
  replacements: ReadonlyMap<string, Uint8Array>,
  readDirectory: ((path: string) => Promise<readonly LinkedNode[]>) | undefined,
): Promise<{ ok: true; description: PluginPackage; tree: TreeNode[]; files: Map<string, Buffer> } | { ok: false; reason: string }> {
  const root = description.source.locator
  if (!isAbsolute(root) || !readDirectory) return { ok: false, reason: "Linked plugin source is not a local directory" }
  const files = new Map<string, Buffer>()
  const tree: TreeNode[] = []
  const place = async (node: LinkedNode): Promise<void> => {
    const replacement = replacements.get(node.path)
    if (replacement) {
      const bytes = Buffer.from(replacement)
      files.set(node.path, bytes)
      tree.push({ kind: "file", path: node.path, mode: node.kind === "file" ? node.mode : 0o644, bytes: bytes.length, digest: `sha256:${hash(bytes)}` })
      return
    }
    if ([...replacements.keys()].some((path) => path.startsWith(node.path + "/"))) {
      tree.push({ kind: "directory", path: node.path, mode: node.kind === "directory" ? node.mode : 0o755 })
      for (const child of await readDirectory(node.path)) await place(child)
      return
    }
    tree.push({ kind: "symlink", path: node.path, target: join(root, node.path) })
  }
  for (const node of description.link.topLevel) await place(node)
  return { ok: true, description, tree, files }
}
function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

export function pluginHostName(
  entry: { kind: string; sourceName: string; sourcePath: string },
  packageId: string,
  occupied: Set<string>,
  available: (name: string) => boolean,
): string {
  const identity = hash(Buffer.from(JSON.stringify([packageId, entry.kind, entry.sourceName])))
  const prefix = entry.sourceName.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "") || entry.kind
  const budget = entry.kind === "mcp" ? 24 : 43
  for (let length = 10; length < budget; length++) {
    const name = prefix.slice(0, budget - length - 1).replace(/-+$/, "") + "-" + identity.slice(0, length)
    if (occupied.has("identity:" + name + ":" + identity)) return name
    if (occupied.has(entry.kind + ":" + name) || !available(name)) continue
    occupied.add(entry.kind + ":" + name)
    occupied.add("identity:" + name + ":" + identity)
    return name
  }
  throw Error("Plugin component identity collision")
}

export function pluginComponentId(packageId: string, entry: { kind: string; sourceName: string }, hostName?: string, origin: "direct" | "catalog" = "direct"): string {
  if (origin === "catalog") return entry.kind + ":" + hash(Buffer.from(JSON.stringify([packageId, entry.kind, entry.sourceName]))).slice(0, 32)
  return "user:" + (hostName ?? pluginHostName({ ...entry, sourcePath: "" }, packageId, new Set(), () => true))
}

export { pluginMcpConfig } from "../shared/plugin-mcp-config"

export function needsPluginFiles(entry: Extract<Entry, { kind: "mcp" | "skill" }>, paths: string[]): boolean {
  const binding = (text: Text) =>
    text.some((part) => typeof part !== "string" && "binding" in part && part.binding !== "projectDir")
  if (entry.kind === "mcp")
    return entry.transport === "stdio"
      ? entry.command.some(binding) ||
          Object.values(entry.environment).some(binding) ||
          (!!entry.cwd && binding(entry.cwd)) ||
          entry.command.some(
            (text) => typeof text[0] === "string" && text[0].startsWith("./") && paths.includes(text[0].slice(2)),
          )
      : binding(entry.url) || Object.values(entry.headers).some(binding)
  return (
    binding(entry.instruction) ||
    entry.instruction.some(
      (part) =>
        typeof part === "string" &&
        [...part.matchAll(/\]\(([^)]+)\)/g)].some((match) => {
          const target = posix.normalize(posix.join(entry.directory, match[1]!))
          return paths.includes(target) && !target.startsWith(entry.directory + "/")
        }),
    )
  )
}
