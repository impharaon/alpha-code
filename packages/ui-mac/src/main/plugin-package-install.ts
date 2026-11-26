import { INSTALLED_PLUGIN_PACKAGE_FILE, PLUGIN_TREE_DIRECTORY, type InstalledPluginPackageV1 } from "../shared/installed-plugin-package"
import { createHash } from "node:crypto"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { renderInstalledSkill } from "../shared/host-extension-package-contract/plugin-conversion.mjs"
import {
  canonicalPluginJson,
  pluginTreeDigest,
  validPluginPackage,
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
  const safe =
    entry.sourceName
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/^[^a-zA-Z0-9]+/, "")
      .slice(0, 64) || "component"
  const name =
    occupied.has(entry.kind + ":" + safe) || !available(safe)
      ? safe.slice(0, 55) + "-" + hash(Buffer.from(packageId + entry.kind + entry.sourcePath)).slice(0, 8)
      : safe
  occupied.add(entry.kind + ":" + name)
  return name
}

export function pluginComponentId(packageId: string, entry: { kind: string; id: string }): string {
  return entry.kind + ":" + hash(Buffer.from(packageId + entry.id)).slice(0, 32)
}

/** Existing v1 MCP leaf projection for the converter's normalized entries. */
export function pluginMcpConfig(entry: Extract<Entry, { kind: "mcp" }>): McpConfigLeafV1 {
  const render = (text: Text) =>
    text
      .map((part) =>
        typeof part === "string"
          ? part
          : "secret" in part
            ? "{secret:" + part.secret + "}"
            : part.binding === "projectDir"
              ? "."
              : "",
      )
      .join("")
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
