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

## 标准插件的配置与数据

`packages/ui-mac/src/main/plugin-package-config.ts` 是包选项的唯一写入方：设置沿现有文件事务提交，敏感值复用版本化 MCP secret resource，公开授权状态只含普通值和秘密是否已设置。`src/shared/installed-plugin-settings.ts` 持有私有设置形状、DATA 路径派生及模型可见普通选项读取；设置与 immutable generation/CAS 分开。

共享 `plugin-conversion.ts` 持有源 Invocation、工具规则词法和实际 skill 目录下 `agents/openai.yaml` 的转换。YAML policy 与 frontmatter 任一显式 false 都关闭自动调用；展示字段、MCP 工具依赖与命令/助手控制进入同一严格包模型，生成的 ESM 与宿主 decoder/schema 同步。

`plugin-package-data.ts` 消费 server 从实际 sidecar 围栏快照发布的 dataHome，创建和清理各包 DATA；更新/关闭保留，整包卸载不跟随目录内符号链接。`src/shared/plugin-mcp-config.ts` 在运行边界绑定规范化 MCP 的 Text/argv、选项和环境，随后消费 ext 的唯一 `projectServerConfig`。启动注入把 pluginTree MCP 保持为关闭的中和条目，ext 不解除该关闭；每次 engine ready 均经原 `convergeManagedMcp` 绑定并连接，磁盘模板不直接启动。`packages/ext/src/plugin-package-tools.ts` 在 awaited context hook 改长 MCP 函数的模型别名，保留定义对象和原执行身份。

本机 MCP 的私有网络绑定由 `packages/ui-mac/src/main/plugin-mcp-proxy.ts` 持有，已安装定义经主进程运行收敛铸造后，只走受控 sidecar 内存消息。既有 `network-egress-proxy.ts` 对绑定端点提供鉴权 HTTP pipe/CONNECT；各绑定单独跟踪和撤销流，不进入通用 host:port 表。显式 SSE 的 SDK POST 经实例私有代理头登记实际 URL；main 校验该代的已声明流、同源与源传输，先登记精确 POST 地址再转发，控制头不送服务端，流关闭/绑定撤销同步清除端点。私有代理拒连沿原 dial-failed 状态和登记前缀保留 TCP 层，桌面显示本机服务未运行；真实远端 HTTP 错误仍是 HTTP。`packages/util/src/codepuppy-plugin-mcp.ts` 在单个 MCP 实例提供 per-fetch 代理，保留 `NO_PROXY` 和普通出网权威。精确的 engine Fetch 组合点及会变红的证据见 `codepuppy-authority-registry.json` 的 `plugin-local-mcp`。

同根同时包含 plugin 与 marketplace 清单时，直接来源准备返回市场，原 `./` 根条目可选；未列出根插件时追加同一 capture 的根候选，不增加选择流程。

`plugin-package-config.ts` 的同一设置/DATA preparation 同时服务直接来源和签名 profile 的现有 admission。可选 MCP 版本沿声明的 floating token 位置绑定；清空恢复源 argv，建议由现有来源模块读取 metadata，缺席先返回、完成后由 hub 事件刷新，不阻塞授权读取。未绑定定义保留源文本；MCP 调用期复用严格 process renderer，缺环境变量只失败该 connector。非本机 plain-HTTP 地址同样保留在包定义中，运行收敛按原地址判据返回该 connector 的错误。模型别名映射同时交回 ext 的唯一 policy facts 查询，原 canonical identity 的停用/询问规则继续生效。

`packages/schema/src/mcp.ts` 单独持有 remote MCP 的可选传输轴（缺席/HTTP 与显式 SSE）；main 包投影和真源、ext 的唯一投影将其交给既有 `core/src/mcp/client.ts` 的 SDK 选择，不建立第二连接器客户端。S-12 的精确接管见 registry `plugin-mcp-transport`。内容入口 `createSourceInstaller` 在提交结果返回后的事件轮次调用原 state writer，再收敛 MCP/重载；同一入口取消被显式包状态动作取代的待激活任务，state writer 的校验、写盘和锁顺序不变。

`@opencode/plugin/codepuppy-package-runtime` 持有同进程、按 Location 分区且按代释放的 S-01 反向 renderer 与 S-04…S-07 固定 runtime 槽。`core/src/config/plugin/command.ts` 随 Location 注册/释放，原生和包指令共用源码先编译、后绑定值的 shell/process 原语；参数名顺序由 Invocation 传入，语法轴由 converter 合同生成，ext 不导入 core 执行器。

整包 command/agent 与 skill/MCP 进入同一 PackageGraph/declarations。`ext-package-tx-builders.ts` 的包指令 builder 只生成 receipt 及 agent 启停 config 项，正文仍由 live 树的统一指令描述持有；共享 converter 的 `pluginInstructionDefinition` 负责 metadata/body 分离，不在运行端重写 YAML。

`packages/ext/src/plugin-package-invocation.ts` 将已安装包的 command/agent/skill 接到原 command、skill 与 subagent 执行器，沿唯一 PackageAllowSetV3 检查分项和项目范围。调用期工具规则由既有 policy 绑定，下一用户输入/idle 清除；paths 用实际文件工具完成事件，preload 与 memory 在子会话上下文绑定，模型建议/effort 从原模型目录解析。指令模板只经 S-01 的 core renderer，源 shell 规则匹配复用纯 ShellScan，未新增执行循环或模板解释器。


S-06 只在原生 compaction 的实际采用前和成功发布后 await 同一 Location runtime；后台预计算不触发。手动拒绝/自动跳过/溢出失败由原生结果渠道呈现；通知在窗口持久化后运行，原生 opaque window 不伪造可读摘要。

S-08 由 ext 既有 awaited context/idle 屏障按实际 assistant message ID 收集终态工具批次，成功与校验失败都从原消息读取并交同一源身份投影。初始化历史作为水位，处理中与完成集合共用；空批次不发，附加上下文在下一请求前送达，idle 继续仍走原 synthetic。

S-04 在 core 配置读取及技能 watcher/重扫的发布链选取文件修订；被拒的旧字节继续经过原解析和当前项目信任，不回写用户文件，托管策略不可阻止。ext 同一 hook runner 按 occurrence/会话/处理器复用结果，当前包停用或更换即不再维持其拒绝。初次加载不冒充文件变更。

共享 converter 同时归一化 package/skill/agent hooks 与 session monitor 声明；`plugin-package.ts`、profile schema 和生成 ESM 保持同一形状。纯 `plugin-hook-events.ts` 持有事件名及五项无宿主时机原因，renderer 复用它展示逐项原因。该转换层不启动进程；S-01 的 bind-only shell 端口现与指令渲染共用 core 绑定函数，返回当前 executable/argv/每次调用的 env，值不进入命令源码；ext 的包进程消费者在同一运行边界接入。PackageAllowSetV3 的 bundle 根使用既有 root/effect/claim 算法表达整包活动与项目范围，不显示为组件行。


`packages/ext/src/plugin-package-process.ts` 消费 S-01 bind-only 结果与既有 AppProcess；`shared/plugin-mcp-config.ts` 的同一 process config 持有 OPTION/default/secret/DATA 绑定，MCP 与包进程复用。hook 的会话资源由 `plugin-package-hooks.ts` 管理，当前接通 package command 的 SessionStart/UserPromptSubmit awaited 阶段与原生 idle 上的 Stop（block/reason 由同 Session synthetic 继续），按真实历史生成私有 JSONL。PreToolUse 位于既有 policy 的 deny 与 confirm/pin 之间，复用 identity 的源工具/字段转换；allow/ask 仅绑定本次 session/message/call、最终输入及服务/包代际，ask 胜 allow，硬 deny 与安装询问保持原权威。UserPromptExpansion 在原命令/手动技能展开前执行；可提前指定的真实原生 message ID 贯穿 prompt_id，不另造会话输入。技能/助手 hooks 由同一 Invocation 的激活/释放管理，scoped 进程与迟到结果跟随 scope 撤销；Stop 继续同任务时延续该 scope。CLAUDE_SKILL_DIR 仍由同一个 process config 绑定。源文件路径在 identity 按真实 Location 解析为 Claude 格式。PermissionRequest 在原 policy 的真实 ask 产生卡片前消费当前工具调用，源 command JSON 的 allow/deny 沿最终绑定重判，BR-10 与硬 deny 仍保持原权威。PostToolUse 从真实 completed 工具终态取源工具输入/响应并将输出放回同一任务的下一次 context；PostToolUseFailure 消费 execute.after error，保留真实错误及中断标志。StopFailure 只消费 session.execution.failed 的真实 type/message，不当正常 Stop 或按 asyncRewake 产生恢复循环，异步上下文留待原会话下一次输入消费。prompt PreToolUse 沿同一 runner 先匹配，使用现有无工具 generate.text 与有效用户模型；ok=true 不生成放行。拒绝先留下原生工具错误，continueOnBlock=false 再于同任务下一次 awaited context 屏障结束，不丢理由或多跑一轮模型。包/配置/代际与会话生命周期收回进程和迟到上下文。`shared/plugin-package-runtime.ts` 是桌面连接状态投影的唯一列表，安装结果不把尚未接通的事件或 monitor 当已运行。
