#!/usr/bin/env bun
// `#1667`(#1662 L5,清点表 H2 / H9,基线 §2.4、§2.8 第 2 条):构建嵌进 sidecar 的 OpenCode 2 引擎包。
//
// 用上游**自己的** Node 构建配置(`packages/cli/vite.node.config.ts` 的 `mainConfig`:同一套插件、`node` 解析条件、
// node 前导代码与原生资源清单),只改 L1a 实测过的那几处(`docs/verification/2026-11-09-1662-l1/build-embed.ts`):
//   · 入口换成 Code Puppy 的 `engine/engine-embed.ts`(`start()` + `Transform`,不传 lifecycle);
//   · `target: node24`(Electron 42.3.3 自带 Node 24.15;L1a 实测不带 `--experimental-ffi` 也能跑);
//   · 不压缩;去掉只对 CLI 成立的 simulation 图检查;前导代码去掉 shebang(这份包被 electron-vite 再打进 out/main 的 chunk);
//   · `#v1-migration` 指到上游的 bun 实现,外加两处 Node 薄适配(裁决书 R14):`bun:sqlite` → 基于 `node:sqlite` 的 shim,
//     `new Bun.CryptoHasher("sha256")` → `node:crypto` 的 `createHash`。上游原版 Node 构建这里是空实现,旧对话**一条都看不到**
//     而状态接口照样报 `completed`(L1a e3noop);找不到原调用或又出现别的 `Bun.` 调用时构建直接失败,不静默产出空实现。
// 原生资源(node-pty、parcel watcher、fff、photon wasm …)按上游清单拷到产物旁的 `assets/`(前导代码按 `import.meta.url`
// 找它们);electron.vite.config.ts 再把它们拷到 out/main/chunks/assets。
import { copyFile, mkdir, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { build } from "vite"
import { mainConfig } from "../../cli/vite.node.config"
import { nodeTarget } from "../../cli/src/node/target"
import { collectNodeAssets, hashNodeAssets } from "../../cli/script/node-assets"
import { bundledModelsSnapshot } from "../../core/script/models-snapshot"

const uiMac = path.resolve(import.meta.dirname, "..")
export const ENGINE_OUT_DIR = path.join(uiMac, "dist-engine")
export const ENGINE_BUNDLE = "engine.mjs"
const entry = path.join(uiMac, "engine", "engine-embed.ts")
const v1Migration = path.resolve(uiMac, "..", "core", "src", "database", "v1-migration.bun.ts")
const bunSqliteShim = path.join(uiMac, "engine", "bun-sqlite-shim.ts")

const target = nodeTarget(process.platform, process.arch)
const assets = await collectNodeAssets(target)
const version = JSON.parse(await readFile(path.resolve(uiMac, "..", "core", "package.json"), "utf8")).version as string

await rm(ENGINE_OUT_DIR, { recursive: true, force: true })
await Promise.all(
  assets.map(async (asset) => {
    const file = path.join(ENGINE_OUT_DIR, "assets", asset.key)
    await mkdir(path.dirname(file), { recursive: true })
    await copyFile(asset.source, file)
  }),
)

const config = mainConfig({
  version,
  channel: "latest",
  modelsSnapshot: await bundledModelsSnapshot(),
  assetHash: await hashNodeAssets(assets),
  target,
})
config.plugins = [
  {
    name: "codepuppy:v1-migration-on-node",
    enforce: "pre" as const,
    resolveId(id: string) {
      if (id === "#v1-migration") return v1Migration
      if (id === "bun:sqlite") return bunSqliteShim
    },
    transform(code: string, id: string) {
      if (path.resolve(id) !== v1Migration) return
      const next = code.replace('new Bun.CryptoHasher("sha256")', '__codepuppyCreateHash("sha256")')
      if (next === code) throw new Error("Bun.CryptoHasher call site not found in v1-migration.bun.ts — upstream moved; re-read it")
      if (/\bBun\./.test(next)) throw new Error("another Bun.* call appeared in v1-migration.bun.ts — the Node shim set is stale")
      return `import { createHash as __codepuppyCreateHash } from "node:crypto"\n${next}`
    },
  },
  ...(config.plugins ?? []).filter((plugin) => !(plugin && "name" in plugin && plugin.name === "opencode:simulation-graph")),
]
const output = config.build?.rollupOptions?.output as { banner?: string } & Record<string, unknown>
config.build = {
  ...config.build,
  ssr: entry,
  outDir: ENGINE_OUT_DIR,
  emptyOutDir: false,
  target: "node24",
  minify: false,
  rollupOptions: {
    ...config.build?.rollupOptions,
    output: {
      ...output,
      entryFileNames: ENGINE_BUNDLE,
      banner: typeof output.banner === "string" ? output.banner.replace(/^#!.*\n/, "") : output.banner,
    },
  },
}
await build(config)
console.log(`built ${path.relative(uiMac, path.join(ENGINE_OUT_DIR, ENGINE_BUNDLE))} (OpenCode ${version}, node24, ${assets.length} native assets)`)
