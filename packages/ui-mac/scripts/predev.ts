import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.OPENCODE_CHANNEL ?? "dev"}`

// REQ-159(`#1321`):进程围栏的原生模块(dev 下 sidecar 从 native/codepuppy-fence/build/ 加载;没有它引擎不起)。
await $`bun ./scripts/build-fence-addon.ts`

// Bundle @codepuppy/ext to self-contained ESM so the embedded Node server can load it
// without resolving raw TS at runtime (see .claude/rules/DECISIONS.md ADR-006).
await $`cd ../ext && bun run build`

// `#1667`(#1662 L5,清点表 H2):与 prebuild 同一个 OpenCode 2 引擎包(上游 Node 构建配置 + engine/engine-embed.ts)。
await $`bun ./scripts/build-engine.ts`

// #1229:Office 版式预览宿主页(跑在隔离 WebContentsView 里,与主渲染世界零共享)。
// 单独打包的理由见该脚本文件头;产物落 out/office-preview/,由 rail-preview-host 按固定资产表服务。
await $`bun ./scripts/build-office-preview.ts`
