#!/usr/bin/env bun
import { $ } from "bun"

import { resolveChannel } from "./utils"

const channel = resolveChannel()
await $`bun ./scripts/copy-icons.ts ${channel}`
await $`bun ./scripts/copy-metainfo.ts ${channel}`

// S17 T3(C17):派生 DB 迁移支持面清单 → resources/db-expected-migrations.json(extraResources 进包;
// db-safety 预检据此判定「DB 超前 / 将前进迁移」。构建期生成 = 不运行时 import core,守 ARCHITECTURE 硬约束②)
await $`bun ./scripts/gen-db-expected.ts`
// #1229:Office 版式预览宿主页(跑在隔离 WebContentsView 里,与主渲染世界零共享)。
// 单独打包的理由见该脚本文件头;产物落 out/office-preview/,由 rail-preview-host 按固定资产表服务。
await $`bun ./scripts/build-office-preview.ts`


// REQ-159(`#1321`):引擎进程围栏的原生模块 —— fat(arm64 + x86_64)N-API .node,darwin-only;
// 缺片 / 空壳片脚本自己红。extraResources 把它带进包(codepuppy-fence/),sidecar 在 import 引擎前 dlopen。
await $`bun ./scripts/build-fence-addon.ts`

// #1564:四个文档工具(Word/Excel/PowerPoint/PDF)的随包 Python 运行时 —— 目标架构一份,按 resources/office-runtime/
// 的 lock 以哈希校验安装,并在构建期验证四种格式真能读写;打印本架构实际体积。extraResources 把它带进包(office-runtime/)。
await $`bun ./scripts/build-office-runtime.ts`

// Bundle @codepuppy/ext to self-contained ESM so the embedded Node server can load it
// without resolving raw TS at runtime (see .claude/rules/DECISIONS.md ADR-006).
await $`cd ../ext && bun run build`

// `#1667`(#1662 L5,清点表 H2 / H3):OpenCode 2 引擎包(上游 Node 构建配置 + Code Puppy 的嵌入入口,见脚本头)。
// v1 时代的三个产物补丁(版本号、#857 共享路由层、内部模型目录先发布)随 v1 产物一起删除:版本由构建期 define 写入;
// 「进程内调用与监听共用一张图」由 `start()` 的 Transform 直接拿到(sidecar-engine-host.test.ts)。
await $`bun ./scripts/build-engine.ts`
