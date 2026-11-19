---
id: PLAN-local-session-artifacts
title: 产物页收录本机生成的文档 实施计划
summary: 一段交付:右栏「产物 → 本次对话」列出助手在本对话(含子代理会话)里于本机写成的文档,和云端结果并列
kind: plan
status: active
spec: ""
design: DESIGN-local-session-artifacts
owners: [owner]
last_reviewed: 2026-11-19
---

# PLAN-local-session-artifacts｜产物页收录本机生成的文档 实施计划

由实施会话在计划阶段写,编排器核对后由同一会话实施。决定只链接、不重述;实施中偏离本段,在同一个提交里改本段。

## 本机生成的文档进入「产物」

- 依据:无 spec;范围以 owner 2026-11-19 选项原话为准(design §1 O-1..O-3)。[design.md](design.md) §4.1–§4.5、§5、§6 @ `70916c57c0`(编排器裁决:按原文接受,不送审)。UX:无新稿,行与区标题复用现有产物卡片行(`codepuppy-wb-card`)与区标签(`a-rart-label`、`a-rart-runrow-tag`、`a-wb-chip`)样式,不新增组件、不新增 token。
- 核对:`0f20f70f15` · 编排器 · 通过(派发书内联接受:设计小,计划与实施同一轮)。

### 改动
| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/src/shared/office-advisories.ts` | 加 `OFFICE_WRITE_TOOL`(design §4.1 原样) |
| `packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/timeline-attachments.ts` | `readCallsOf` 改为导出的 `officeCallsOf(part, server, tool)`(只认调用,不按路径过滤);附件判定在调用方按路径过滤;导出 `labelOf` |
| `packages/ui-mac/src/renderer/codepuppy-ui/session-rail/artifacts/local-artifacts.ts`(新) | 纯函数 `scanLocalArtifacts`(design §4.2)、跨会话合并 `mergeLocalArtifacts`、全量读取 `readLocalArtifacts(directory, sessionID, messagesOf)`(逐层子会话、深度 16、已访问集合、任一失败即失败)、`localArtifactsRevision`(同步 store 扫描串) |
| `packages/ui-mac/src/renderer/codepuppy-ui/session-rail/artifacts/artifacts-core.ts` | `LocalArtifactsResult`、`"local-only"` 阶段、`artifactsPhaseOf` 的 `local` 入参、`LocalFileState` / `LocalArtifactRow` 与行模型构造 |
| `packages/ui-mac/src/renderer/codepuppy-ui/session-rail/artifacts/session-rail-artifacts.tsx` | `messagesOf` / `localRevision` 入参;本机资源(键 = tick + revision)、stat 查询、`onOpenLocal → rail.openFileViewer` |
| `packages/ui-mac/src/renderer/codepuppy-ui/session-rail/artifacts/artifacts-panel-view.tsx` | `local` / `onOpenLocal` 入参;「在本机生成」区(范围条之下、run 条之上)、「项目全部」下的「本次对话」标签、「文件缺失」不可点、本机读失败的重试 |
| `packages/ui-mac/src/renderer/codepuppy-ui/session-workspace/codepuppy-session-workspace.tsx` | 造 `messagesOf`(v1 `session.messages` 不带 limit)与 `localRevision`(同步 store) |
| `packages/ui-mac/src/shared/file-viewer.ts`、`src/main/workspace-file-service.ts`、`src/preload/index.ts`、`src/preload/types.ts`、`test-component/preload-stub.ts`(若枚举需要) | `WorkspaceFileStatResult`、`statWorkspaceFiles`、IPC `workspace-file-stat`、`window.api.workspaceFile.stat` |
| `packages/ui-mac/src/renderer/i18n/zh.ts`、`en.ts` | `codepuppy.session.artifactsLocalTitle` |
| 测试:`local-artifacts.test.ts`(新)、`artifacts-core.test.ts` / `session-rail-artifacts.test.ts`(阶段与通道白名单随新行为改)、`artifacts-test-runtime.tsx` + `test-component/session-rail-artifacts.cases.ts`(容器用例)、`src/main/workspace-file-service.test.ts`、`src/engine-adapter/local-artifacts.engine.{cases,test}.ts`(新,真引擎) | 见「证明」 |

### 顺序
1. 计划提交(本文件)。
2. 推导:`OFFICE_WRITE_TOOL`、匹配器提取、`local-artifacts.ts` 与单元测试;跑 `timeline-attachments` 相关测试(附件读取判定不变)+ 新单元测试 + `attachment-codemode-read.engine.test.ts`。
3. 真引擎用例 `local-artifacts.engine.*`:同一会话里经 `execute` 调第一方 Word 写工具(真 stdio MCP 桩,服务名 `codepuppy-word`,列 `write_docx`)、引擎 `write` 写 `.html`、`patch` 新建 `.md`、`write` 写 `.ts` 与 `.json`、写会话目录外的 `.md`(审批经 v1 回复入口批准)、经 `subagent` 让子会话 `write` 一份 `.md`;经生产适配器 `GET /session/:id/message` 读回后跑 `readLocalArtifacts`。这里同时实测 `patch` 新建的投影(design 标「推断」的那一格)。
4. main 通道:`statWorkspaceFiles` + IPC + preload;`workspace-file-service.test.ts` 加用例。
5. 面板:阶段、行模型、容器、视图、工作区注入、文案;组件用例与白名单测试;`bun run typecheck`(ui-mac)。

### 风险
- 真引擎里子会话 id 的投影(`metadata.sessionID → sessionId`)或 `patch` 的 `file` 字段若是绝对路径:用例在第 3 步先暴露,推导按实测形状处理(相对路径按会话目录解析、绝对路径按前缀判定,两者都已在 design §4.1 内)。
- 同步 store 只触发重读:子代理在子会话里写成的文档要即时出现,revision 扫描同时走 store 里已有的子会话消息(同一个扫描函数,不新增数据源)。
- 面板既有 26 条组件用例与 `artifactsPhaseOf` 旧用例按旧阶段写;`runId` 为空那一支加了 `local` 入参,旧用例补 `local: { ok: true, items: [] }`,不删断言。
- 通道白名单测试(`session-rail-artifacts.test.ts`)是集合相等:加 `workspaceFile.stat` 一项,属该测试编码的旧行为被本 AC 替换。

### 证明
| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| O-1 `execute` 内 Office 写入、直接 `write` 的 `.html`、`patch` 新建的 `.md` 在重开会话后出现 | `local-artifacts.engine.cases.ts`「三条来源重开会话都列出」:真引擎 → 生产适配器消息页 → `readLocalArtifacts` | 去掉任一来源的识别,对应路径不在结果里;`patch` 投影不是 `type:"add"` 时该格红 |
| 代码 / JSON 不收 | 同上,`.ts`、`.json` 写成功但不在结果里;`local-artifacts.test.ts` 用同形 part 断言 | 去掉「文档类型」过滤,两项出现 |
| 会话目录外不收 | 同上,目录外 `.md` 写成功(文件存在)但不在结果里 | 去掉目录前缀判定,该项出现 |
| 子代理会话的文档出现 | 同上,子会话 `write` 的 `.md` 出现在父会话结果里;`local-artifacts.test.ts` 环与深度上限 | 不跟子会话 id 往下读,该项缺失 |
| 删除文件显示「文件缺失」 | `workspace-file-service.test.ts`:`statWorkspaceFiles` 真文件删前 `ok`、删后 `not-found`;组件用例:stat 回 `not-found` 的行带「文件缺失」、点击不调 `openFileViewer`,`present` 行点击调 `openFileViewer(path)` | 不查 stat 或不映射 `missing`,行可点、无标签 |
| O-2 并列显示、本次对话标签、空态不变 | 组件用例(真容器 + 真 shell):有 run 时本机区在 run 条之上、各自按时间倒序;「项目全部」下标「本次对话」;无本机产物且无 run 仍是原空态文案 | 区位置或标签缺失即红 |
| 任一会话读失败不出半份清单 | `local-artifacts.test.ts`:子会话读取 reject ⇒ 整份失败 | 吞掉子会话错误时返回部分清单 |

### 偏离记录
- 2026-11-19 · `test-component/preload-stub.ts` 不用改(只列键名)· 文件清单少一项 · 本提交。
- 2026-11-19 · 真引擎用例的 `patch` 回合点名 `gpt-5` 模型、其余回合点名 `m`:引擎只给 gpt-5 一类模型 `patch` 并同时拿走 `write` / `edit`(`packages/core/src/tool/plugin/patch.ts` context 钩子),不点名时沿用上一回合的模型 · 测试写法,不改设计 · 本提交。
- 2026-11-19 · `session-rail-artifacts.css` 加 `.a-rart-local` / `.a-rart-local-head` 两条容器规则(本机区与云端内容并列时不吃满高度、自己滚动;标题行放「本次对话」标签),无新 token;行本身仍是 `codepuppy-wb-card` · 版面细节仍待 `delivery-ux`(design §10 待定)· 本提交。
