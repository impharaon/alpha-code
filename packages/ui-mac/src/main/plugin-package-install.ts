import { INSTALLED_PLUGIN_PACKAGE_FILE, PLUGIN_TREE_DIRECTORY, type InstalledPluginPackageV1 } from "../shared/installed-plugin-package"
import { createHash } from "node:crypto"
import { dirname, isAbsolute, posix, relative, resolve } from "node:path"
import { renderInstalledSkill } from "../shared/host-extension-package-contract/plugin-conversion.mjs"
import {
  canonicalPluginJson,
  pluginTreeDigest,
  renderPluginText, validPluginPackage,
  type Entry,
  type Text,
  type PluginPackage,
  type TreeNode,
} from "../shared/host-extension-package-contract/plugin-package"
import type { McpConfigLeafV1 } from "../shared/plugin-install"
import { materializePluginTreeFromCas, putCasBlobFromBuffer } from "./ext-cas"
import { extensionHealthProbeRouter } from "./ext-health-probe-router"
import { probeLedgerForWrite, type UpsertInput } from "./ext-receipt-v2"
import type { PackageTxBuildV1 } from "./ext-package-tx-builders"

/** One captured package becomes one generation and receipt-only skill registrations. */
export async function buildPluginPackageTxItems(input: {
  root: string
  casBaseRoot: string
  key: string
  receipt: UpsertInput
  description: PluginPackage
  hostNames: ReadonlyMap<string, string>
  skillReceipts: UpsertInput[]
  readFile(path: string): Promise<Uint8Array>
}): Promise<
  | { ok: true; build: PackageTxBuildV1; description: PluginPackage; manifestDigest: string }
  | { ok: false; reason: string }
> {
  if (!validPluginPackage(input.description)) return { ok: false, reason: "Plugin package description is invalid" }
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
  const description = { ...input.description, tree, treeDigest: pluginTreeDigest(tree) }
  const metadata: InstalledPluginPackageV1 = { description, hostNames: Object.fromEntries(input.hostNames) }
  const metadataBytes = Buffer.from(canonicalPluginJson(metadata))
  const generationTree: TreeNode[] = [
    { kind: "directory", path: PLUGIN_TREE_DIRECTORY, mode: 0o755 },
    ...tree.map((node) => ({ ...node, path: PLUGIN_TREE_DIRECTORY + "/" + node.path })),
    {
      kind: "file",
      path: INSTALLED_PLUGIN_PACKAGE_FILE,
      mode: 0o600,
      bytes: metadataBytes.length,
      digest: `sha256:${hash(metadataBytes)}`,
    },
  ]
  for (const [path, bytes] of [...files, [INSTALLED_PLUGIN_PACKAGE_FILE, metadataBytes] as const]) {
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

/** Existing v1 MCP leaf projection for the converter's normalized entries. */
export function pluginMcpConfig(entry: Extract<Entry, { kind: "mcp" }>): McpConfigLeafV1 {
  const render = (text: Text) => renderPluginText(text, { pluginRoot: "${CLAUDE_PLUGIN_ROOT}", projectDir: "${CLAUDE_PROJECT_DIR}" })
  return entry.transport === "stdio"
    ? {
        type: "local",
        command: entry.command.map(render),
        environment: Object.fromEntries(Object.entries(entry.environment).map(([key, value]) => [key, render(value)])),
        ...(entry.cwd ? { cwd: render(entry.cwd) } : {}),
        ...(entry.timeoutMs === undefined ? {} : { timeout: entry.timeoutMs }),
      }
    : {
        type: "remote",
        url: render(entry.url),
        headers: Object.fromEntries(Object.entries(entry.headers).map(([key, value]) => [key, render(value)])),
        ...(entry.timeoutMs === undefined ? {} : { timeout: entry.timeoutMs }),
        ...(entry.oauth === false
          ? { oauth: false }
          : entry.oauth?.oauth
            ? {
                oauth: {
                  ...(entry.oauth.oauth.clientId ? { clientId: entry.oauth.oauth.clientId } : {}),
                  ...(entry.oauth.oauth.clientSecret ? { clientSecret: render(entry.oauth.oauth.clientSecret) } : {}),
                  ...(entry.oauth.oauth.scopes ? { scope: entry.oauth.oauth.scopes.join(" ") } : {}),
                },
              }
            : {}),
      }
}

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
