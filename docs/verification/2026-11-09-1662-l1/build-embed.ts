// alpha-code#1662 L1a — bundle embed-entry.ts for Node with upstream's OWN node build config
// (packages/cli/vite.node.config.ts `mainConfig`: same plugins, `node` conditions, node prelude, native assets).
// Overrides only: the entry, the output name, `target: node24` (Electron 42.3.3 ships Node 24.15), no minify,
// and — for the E3 variant — where `#v1-migration` resolves.
//
// Run from ${OC2}/packages/cli after build.sh copies this file to script/ and the entry to src/:
//   bun script/ac1662-build-embed.ts [--v1-migration | --v1-migration-raw]
// Output: dist-node/embed.mjs (default: upstream's node noop), dist-node/embed-v1mig.mjs (bun impl + both node
// shims), or dist-node/embed-v1mig-raw.mjs (negative control: bun impl, bun:sqlite shim only, Bun.CryptoHasher left).
import path from "node:path"
import { rm } from "node:fs/promises"
import { build } from "vite"
import { mainConfig } from "../vite.node.config"
import { nodeTarget } from "../src/node/target"
import { collectNodeAssets, copyNodeAssets, hashNodeAssets } from "./node-assets"
import { bundledModelsSnapshot } from "../../core/script/models-snapshot"

const dir = path.resolve(import.meta.dirname, "..")
const raw = process.argv.includes("--v1-migration-raw")
const v1mig = raw || process.argv.includes("--v1-migration")
const outName = raw ? "embed-v1mig-raw.mjs" : v1mig ? "embed-v1mig.mjs" : "embed.mjs"
process.chdir(dir)
const target = nodeTarget(process.platform, process.arch)
const assets = await collectNodeAssets(target)
if (!v1mig) {
  await rm("dist-node", { recursive: true, force: true })
  await copyNodeAssets(assets)
}
const config = mainConfig({
  version: "2.2.6-ac1662",
  channel: "local",
  modelsSnapshot: await bundledModelsSnapshot(),
  assetHash: await hashNodeAssets(assets),
  target,
})
const core = path.resolve(dir, "..", "core", "src", "database")
const shims = path.resolve(dir, "src", "ac1662-shims")
config.plugins = [
  ...(v1mig
    ? [
        {
          // ADR-029 L1 build-time transform, as baseline §2.8 step 2 proposes: `#v1-migration` → the bun
          // implementation, upstream source untouched; its two bun-only calls get Node shims.
          name: "ac1662:v1-migration-on-node",
          enforce: "pre" as const,
          resolveId(id: string) {
            if (id === "#v1-migration") return path.join(core, "v1-migration.bun.ts")
            if (id === "bun:sqlite") return path.join(shims, "bun-sqlite.ts")
          },
          transform(code: string, id: string) {
            if (raw || !id.endsWith("/v1-migration.bun.ts")) return
            // Bun.CryptoHasher(...).update(s).digest("hex") ≡ node:crypto createHash(...).update(s).digest("hex").
            const next = code.replace('new Bun.CryptoHasher("sha256")', '__ac1662CreateHash("sha256")')
            if (next === code) throw new Error("Bun.CryptoHasher call site not found — upstream moved; re-read v1-migration.bun.ts")
            if (/\bBun\./.test(next)) throw new Error("another Bun.* call appeared in v1-migration.bun.ts — the shim set is stale")
            return `import { createHash as __ac1662CreateHash } from "node:crypto"\n${next}`
          },
        },
      ]
    : []),
  ...(config.plugins ?? []).filter((plugin) => !(plugin && "name" in plugin && plugin.name === "opencode:simulation-graph")),
]
config.build = {
  ...config.build,
  ssr: "src/ac1662-embed-entry.ts",
  target: "node24",
  minify: false,
  rollupOptions: {
    ...config.build?.rollupOptions,
    output: { ...(config.build?.rollupOptions?.output as object), entryFileNames: outName },
  },
}
await build(config)
console.log(`built dist-node/${outName}`)
