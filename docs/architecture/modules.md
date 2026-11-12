---
id: ARCH-modules
title: Code Puppy 模块地图
kind: architecture
status: active
summary: 标明桌面宿主、引擎、共享契约和上游工作区包的边界。
owners: [owner]
last_reviewed: 2026-11-10
review_after: 2027-05-09
---

# Code Puppy 模块地图

同仓包一栏列出当前包清单里的依赖声明。具体运行路径见[架构概览](overview.md)；
新增依赖须符合[架构约束](constraints.md)和[上游边界](upstream-integration.md)。

| 模块 | 职责 | 当前同仓依赖 | 不许依赖 | 共享概念的权威文件 |
| --- | --- | --- | --- | --- |
| `packages/app/` | 上游应用界面和上下文 | `client`, `core`, `schema`, `session-ui`, `ui` | 见架构约束 | [入口](../../packages/app/package.json) |
| `packages/cli/` | 新引擎命令行入口 | `core`, `server`, `tui` | 见架构约束 | [入口](../../packages/cli/package.json) |
| `packages/client/` | 新引擎客户端和生成的协议接线 | `protocol`, `schema` | Core、Server 的运行时代码 | [入口](../../packages/client/package.json) |
| `packages/codemode/` | 工具编排的代码执行模块 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/codemode/package.json) |
| `packages/codepuppy-contracts-consumer/` | Code Puppy 消费跨仓固定契约的接线和测试 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/codepuppy-contracts-consumer/package.json) |
| `packages/console/` | 上游控制台 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/console/) |
| `packages/containers/` | 上游容器资料 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/containers/) |
| `packages/core/` | 新引擎核心会话逻辑 | `effect-drizzle-sqlite`, `effect-sqlite-node`, `llm`, `plugin`, `schema` | Server | [入口](../../packages/core/package.json) |
| `packages/desktop/` | 上游桌面宿主 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/desktop/package.json) |
| `packages/docs/` | 上游文档站 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/docs/) |
| `packages/effect-drizzle-sqlite/` | Effect 的 Drizzle SQLite 接线 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/effect-drizzle-sqlite/package.json) |
| `packages/effect-sqlite-node/` | Effect 的 Node SQLite 接线 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/effect-sqlite-node/package.json) |
| `packages/enterprise/` | 上游企业应用 | `core`, `session-ui`, `ui` | 见架构约束 | [入口](../../packages/enterprise/package.json) |
| `packages/ext/` | Code Puppy 宿主扩展及自有工具 | `codepuppy-contracts-consumer`, `plugin` | Electron main 私有模块 | [入口](../../packages/ext/package.json) |
| `packages/function/` | 上游后台函数 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/function/package.json) |
| `packages/http-recorder/` | HTTP 录制和回放 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/http-recorder/package.json) |
| `packages/httpapi-codegen/` | HTTP API 代码生成 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/httpapi-codegen/package.json) |
| `packages/identity/` | 上游身份模块 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/identity/) |
| `packages/llm/` | 新引擎模型协议和调用 | `schema` | 见架构约束 | [入口](../../packages/llm/package.json) |
| `packages/opencode/` | OpenCode 1 引擎入口与运行逻辑 | `codemode`, `llm`, `plugin`, `protocol`, `schema`, `script`, `server`, `tui` | 见架构约束 | [入口](../../packages/opencode/package.json) |
| `packages/plugin/` | 上游插件接口和类型 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/plugin/package.json) |
| `packages/protocol/` | 新引擎协议 | `schema` | Server | [入口](../../packages/protocol/package.json) |
| `packages/schema/` | 共享 schema、权限和工具分类 | 无已核实的同仓清单依赖 | Core、Protocol 或 Server | [入口](../../packages/schema/package.json) |
| `packages/script/` | 上游工作区脚本包 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/script/package.json) |
| `packages/sdk-next/` | 新引擎 SDK 组合 | `client`, `core`, `server` | 见架构约束 | [入口](../../packages/sdk-next/package.json) |
| `packages/sdk/` | 上游兼容 SDK | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/sdk/) |
| `packages/server/` | 新引擎服务入口 | `core`, `protocol` | 见架构约束 | [入口](../../packages/server/package.json) |
| `packages/session-ui/` | 上游会话组件 | `client`, `core`, `ui` | 见架构约束 | [入口](../../packages/session-ui/package.json) |
| `packages/slack/` | 上游 Slack 集成 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/slack/package.json) |
| `packages/stats/` | 上游统计工具 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/stats/) |
| `packages/storybook/` | 上游 UI 展示 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/storybook/package.json) |
| `packages/tui/` | 上游终端界面 | `core`, `plugin`, `ui` | 见架构约束 | [入口](../../packages/tui/package.json) |
| `packages/ui-mac/` | Code Puppy Electron 宿主、桌面 IPC 和产品界面 | `codepuppy-contracts-consumer` | 渲染进程不得直接依赖 main 私有模块 | [入口](../../packages/ui-mac/package.json) |
| `packages/ui/` | 上游共用 UI 组件 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/ui/package.json) |
| `packages/web/` | 上游 Web 应用 | 无已核实的同仓清单依赖 | 见架构约束 | [入口](../../packages/web/package.json) |
| `bin` | 本地辅助入口 | 见入口 | 见架构约束 | [入口](../../bin/) |
| `frontend` | 仓内前端资产 | 见入口 | 见架构约束 | [入口](../../frontend/) |
| `github` | 上游 GitHub 集成 | 见入口 | 见架构约束 | [入口](../../github/) |
| `infra` | 上游基础设施定义 | 见入口 | 见架构约束 | [入口](../../infra/) |
| `install` | 上游安装入口 | 见入口 | 见架构约束 | [入口](../../install) |
| `nix` | Nix 构建定义 | 见入口 | 见架构约束 | [入口](../../nix/) |
| `perf` | 性能测量 | 见入口 | 见架构约束 | [入口](../../perf/) |
| `script` | 上游工作区脚本 | 见入口 | 见架构约束 | [入口](../../script/) |
| `scripts` | Code Puppy 检查、构建和发布辅助 | 见入口 | 见架构约束 | [入口](../../scripts/) |
| `sdks` | SDK 源与分发辅助 | 见入口 | 见架构约束 | [入口](../../sdks/) |

## 依赖方向

新引擎以 Schema 为底层，Core 和 Protocol 在其上，Server 位于入口层。Client
消费 Schema 和 Protocol，SDK 组合由 sdk-next 持有。Code Puppy 桌面宿主通过已声明的
接缝使用引擎和 UI；渲染进程通过公开 IPC 访问宿主能力。上游包的工作状态不属于本组合的交付状态。
