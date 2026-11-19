---
id: DESIGN-local-session-artifacts
title: 产物页收录助手在本对话里于本机生成的文档 技术设计
summary: 右栏「产物」在云端任务结果之外，列出助手在本次对话(含子代理会话)里用第一方 Office 工具或引擎 write/patch 写成的文档;来源只读引擎已持久化的消息 part，不新建记录;打开走文件面板现成的查看器;文件挪走或删掉时如实显示「文件缺失」
kind: tech-design
status: draft
spec: ""                 # 无已批 spec。来源:owner 2026-11-19 选项原话(见 §1);用户可见改动缺 spec 一事已在交回信封里报给编排器
spec_version: ""
review:
  rounds: 0
  reviewed_sha: ""
  verdict: ""
owners: [owner]
last_reviewed: 2026-11-19
---

# DESIGN-local-session-artifacts｜产物页收录本机生成的文档 技术设计

只写决定。文件清单、提交顺序与测试由实现方的 plan.md 写。§3、§7 已退役，编号不复用。
事实坐标全部钉在 alpha-code `origin/alpha` = `66966bcfbb`(0.2.3)。

## 1. 基线

- Spec:无。owner 2026-11-19 选了这一项(选项原文):「让产物页也收录本机生成的文档」，选项说明「助手在本对话里生成的文档也出现在「产物 → 本次对话」，和云端文件并列;算一项新功能，先做方案再开发」。
- 覆盖(以 owner 原话为准，下文记作 O-1..O-3):
  - O-1 助手在本对话里生成的文档出现在「产物 → 本次对话」;
  - O-2 和云端文件并列;
  - O-3 不加新步骤、新设置、新上限(派发书;CLAUDE.md 原则 1)。
- 相关既有规格(只引用，不改):`docs/specs/session-results-workspace/spec.md` AC-02(从各处打开的对象来源可追溯)、AC-04(右栏各面用各自的 typed adapter，renderer 不读任意本地路径);`docs/specs/timeline-artifact-links/spec.md`(对话内产物链接行，本设计不扩展它)。
- 体验输入:没有已批准的 UX 稿。§4.4 只定数据、顺序、状态与文案键;版面细节(间距、滚动收纳)交 `delivery-ux` 出稿，见 §10「待定」。

## 2. 地面真相

| # | 事实 | 坐标 |
| --- | --- | --- |
| F-01 | 产物页只读云端 run:`projectUsage` → `projectArtifactUsage` 扫 `.codepuppy/runs/<job>`;面板以 run 为单位，选中一次 run 再列卡片、置顶预览 | `packages/ui-mac/src/renderer/codepuppy-ui/session-rail/artifacts/session-rail-artifacts.tsx:73-83,180-236`;`packages/ui-mac/src/main/artifact-service.ts:1772` |
| F-02 | `ArtifactSource` 枚举里的 `"local"` 是与 alpha-platform 共用的线上契约值;descriptor 必填 `contentRef: { kind: "http-stream"; url; auth: "bearer" }` 与 `provenance: { producer: "pipeline" \| "bounded-agent"; jobId }` | `packages/ui-mac/src/shared/cloud-artifact-descriptor.ts:31`;`packages/codepuppy-contracts-consumer/src/types.ts:135-157` |
| F-03 | manifest 登记要求文件位于 `.codepuppy/runs/<runId>/` 下(`savedPath` 相对 run 目录，realpath 圈禁) | `packages/ui-mac/src/main/artifact-service.ts:1105-1121` |
| F-04 | 四个第一方 Office 工具的写入口是 `write_docx` / `write_xlsx` / `write_pptx` / `write_pdf`;`path` 必须是会话工作区内的绝对路径、扩展名对得上，返回 `{"path": …}`;出错时回 `isError: true` | `packages/ui-mac/resources/office-mcp/server.py:282-313,340,606,650,683,108-115` |
| F-05 | 引擎把 MCP 的 `isError` 当工具失败;Code Mode(`execute`)把每次内层调用记进 `state.metadata.toolCalls[]`,形如 `{ tool: "<服务名>.<工具名>", status: "running"\|"completed"\|"error", input }`,随 part 持久化 | `packages/core/src/tool/mcp.ts:105-112`;`packages/core/src/codemode/tool.ts:29-33,189-192`(状态映射见同文件 progressHooks) |
| F-06 | 已有一份「从 part 认出第一方 Office 调用」的实现：同时认 `execute` 内层调用与直接 MCP 调用(按 identity),附件「已读取」靠它判定;引擎实测用例已证明 Code Mode 路径 | `packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/timeline-attachments.ts:86-99`;`packages/ui-mac/src/engine-adapter/attachment-codemode-read.engine.cases.ts` |
| F-07 | 第一方 Office 的服务名、格式、扩展名唯一登记在 `CODEPUPPY_OFFICE_CONNECTORS`;读取工具名表 `ATTACHMENT_READ_TOOL` | `packages/ui-mac/src/shared/office-advisories.ts:78-101`;`packages/ui-mac/src/shared/attachment-path.ts:37-47` |
| F-08 | 引擎 `write`、`patch`、`edit` 都是直接工具(`codemode: false`),不会进 `execute`。`write` 入参 `path`(适配器另给 `filePath`);`patch` 的 `metadata.files[]` 在 v1 投影里带 `type: "add"\|"update"\|"delete"` 与 `relativePath`;路径语义：工作区内为相对路径，工作区外为绝对路径 | `packages/core/src/tool/plugin/write.ts:17-22,49`;`packages/core/src/tool/plugin/patch.ts:82,313-325`;`packages/core/src/file-access.ts:36-37,91-110`;`packages/ui-mac/src/engine-adapter/opencode2/v1-shapes.ts:309-314`;`packages/ui-mac/src/engine-adapter/opencode2/messages.ts:35-38` |
| F-09 | 内建工具的身份闸是 `toolCardDispatchOf`(只有引擎铸的 builtin identity 才命中;`write`→`write`、`patch`→`apply_patch`);子代理子会话 id 的唯一读法是 `taskCardInfoOf(part).childSessionID` | `packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/cards/tool-card-model.ts:165-185,354,1716-1728` |
| F-10 | v1 `session.messages({ sessionID })` 不带 `limit` 时返回整条会话的全部消息(适配器按 200 条一页升序拉全);renderer 已加载的同步 store 只有分页窗口 | `packages/ui-mac/src/engine-adapter/opencode2/session-cache.ts:17-33`;`packages/ui-mac/src/engine-adapter/opencode2/routes.ts:170-175`;既有调用 `packages/ui-mac/src/renderer/sidebar/use-projects.ts:560` |
| F-11 | 完成态 tool part 有 `state.time.end`(适配器以引擎 `tool.time.completed` 填) | `packages/ui-mac/src/engine-adapter/opencode2/messages.ts:278-284` |
| F-12 | 文件面板查看器：renderer 只交工作区相对路径，main 做相对性、realpath 圈禁、拒 symlink;呈现计划复用产物 renderer 注册表(Markdown/CSV/HTML/PDF/Office/图片);跨面板打开入口是 `rail.openFileViewer(file)`(审查卡「查看整份文件」已在用),文件不存在时查看器显示读取失败，不崩 | `packages/ui-mac/src/main/workspace-file-service.ts:58-89,253`;`packages/ui-mac/src/renderer/codepuppy-ui/session-rail/files/file-viewer-core.ts:35-57`;`packages/ui-mac/src/renderer/codepuppy-ui/session-workspace/session-workspace-shell.tsx:85,462-472`;`packages/ui-mac/src/renderer/codepuppy-ui/session-rail/files/file-viewer-state.ts:120-127` |
| F-13 | 文件读取会话每个窗口最多 4 个并发(`FILE_VIEWER_MAX_READS`),没有只查存在与否的通道 | `packages/ui-mac/src/shared/file-viewer.ts:21-22`;`packages/ui-mac/src/preload/types.ts:1280-1287` |
| F-14 | 面板经注入拿引擎能力：工作区把 `parentOf`(v1 `session.get`)注入产物面板;面板本身不碰 serverSDK | `packages/ui-mac/src/renderer/codepuppy-ui/session-workspace/codepuppy-session-workspace.tsx:125-131,195` |
| F-15 | 现有空态文案:项目级「还没有产物 / 助手生成的文档会出现在这里。」;本次对话级「这次对话还没有生成过文件 / 让助手画图、写报告或做表格，结果会出现在这里。…」 | `packages/ui-mac/src/renderer/i18n/zh.ts:1578-1579,1889-1891` |
| F-16 | 引擎自带的 `Artifact` 服务是实验功能，默认关闭(`experimental.artifacts`),要模型主动调 artifact 工具才有记录 | `packages/core/src/artifact.ts:85-89`;`packages/core/src/tool/plugin/artifact.ts` |

推断(未实测):F-08 的 `patch` 新建文件在 v1 投影里是 `type: "add"`,由 `PATCH_TYPES` 映射推出(`v1-shapes.ts:289`),没有用真引擎跑过一次 patch 新建文档来看投影结果。plan 的证明里要有这一格。

## 4. 接口契约

### 4.1 什么算「本机产物」

一份本机产物 = 本次对话里，助手经下列三条之一**成功写成**、且落在会话目录内的一份文档。只认引擎已持久化的事实，不认模型说了什么。

| 来源 | 准入(全部满足) | 路径取自 |
| --- | --- | --- |
| A. 第一方 Office 写入 | F-06 那份匹配器认出的调用：服务名 ∈ `CODEPUPPY_OFFICE_CONNECTORS[].name`,工具名 = 该格式的写工具(新增 `OFFICE_WRITE_TOOL`,见下);`status === "completed"`;`input.path` 是字符串 | `input.path`(绝对路径) |
| B. 引擎 `write` | `toolCardDispatchOf(part)` 为 `kind: "write"` 且非 `metadataOnly`;`state.status === "completed"`;入参 `path`(或 `filePath`)是字符串;文件属于「文档类型」 | 入参路径，相对路径按会话目录解析 |
| C. 引擎 `patch` 新建 | `toolCardDispatchOf(part)` 为 `kind: "apply_patch"` 且非 `metadataOnly`;`state.status === "completed"`;`metadata.files[]` 中 `type === "add"` 的项;文件属于「文档类型」 | 该项 `relativePath` |

- **文档类型**(只对 B、C;A 本身就是文档):`viewerPlanFor(name)`(F-12)的结论为 `office`、`overlay`(html/pdf)、`image`,或 `text` 且 `view ∈ {"markdown","csv","text"}`。`code`、`json`、`unsupported` 不算：那是项目源码与配置，已在「审查」面板。
- **会话目录内**:候选路径与会话目录都先把 `\` 换成 `/`,再经 `normalizePosixPath`(`shared/attachment-path.ts:60`);候选路径必须以 `<目录>/` 开头，去掉前缀后得到相对路径。不在目录内的不收录(理由见 §6)。
- **不收录**:`edit`(改已有文件，属审查)、shell 或脚本间接写出的文件(part 里没有可判定的事实)、第三方 MCP/插件工具、未完成或失败的调用。
- **本次对话的范围**:当前会话，加上经子代理调用派生的子会话(`taskCardInfoOf(part).childSessionID`,F-09),逐层向下，深度上限沿用 `SCOPE_ANCESTRY_MAX_DEPTH`(16,`artifacts-core.ts:151`),已访问集合防环。与云端「本次对话(含子对话)」同口径。
- **身份与去重**:身份 = 会话目录内的相对路径。同一路径被写多次只留一行，时刻取最近一次。
- **时刻**:写成它的那条 part 的 `state.time.end`(F-11);A 类取所在 `execute` part 的 `state.time.end`(内层调用没有单独时刻)。

新增的第一方事实，与 F-07 同一个权威文件:

```ts
// packages/ui-mac/src/shared/office-advisories.ts(紧挨 CODEPUPPY_OFFICE_CONNECTORS)
/** 第一方 Office 服务的写工具名(resources/office-mcp/server.py tools_for 的写入口)。 */
export const OFFICE_WRITE_TOOL: Readonly<Record<CodePuppyOfficeFormat, string>> = Object.freeze({
  word: "write_docx",
  excel: "write_xlsx",
  powerpoint: "write_pptx",
  pdf: "write_pdf",
})
```

### 4.2 推导(纯函数，renderer)

```ts
// packages/ui-mac/src/renderer/codepuppy-ui/session-rail/artifacts/local-artifacts.ts(新增;零 DOM、零 window.api)
import type { Message, Part } from "../../../../engine-adapter/contract/v1"

/** v1 `session.messages` 的单项形状;同步 store 也按此拼。 */
export type SessionMessageWithParts = { info: Message; parts: readonly Part[] }

export interface LocalArtifact {
  /** 会话目录内的 POSIX 相对路径(无前导 /,无 . 或 .. 段)。同一对话内唯一;也是 stat 与 openFileViewer 的入参。 */
  path: string
  /** 末段文件名。 */
  name: string
  /** 最近一次写成的时刻,UTC epoch 毫秒。 */
  writtenAt: number
  /** 写成它的 part 所在会话(当前会话或其子会话)与 part id。 */
  sessionID: string
  partID: string
}

export interface LocalArtifactScan {
  /** 本会话这批消息里认出的产物(未跨会话去重)。 */
  items: LocalArtifact[]
  /** 这批消息里子代理调用指向的子会话 id(去重,保持首见顺序)。 */
  childSessionIDs: string[]
}

/** 不抛:形状不对的 part 一律跳过(健壮性，不是限制)。 */
export function scanLocalArtifacts(
  directory: string,
  sessionID: string,
  messages: readonly SessionMessageWithParts[],
): LocalArtifactScan
```

- 跨会话合并的规则(私有实现，规则冻结):按 `path` 去重留 `writtenAt` 最大者;结果按 `writtenAt` 降序，同刻按 `path` 升序。
- F-06 的匹配器(`timeline-attachments.ts:86-99` 的 `readCallsOf`)改成接受任意 `(server, tool)` 并导出，附件判定与本推导共用这一份;按路径过滤留在附件调用方。不另写第二份匹配(K2)。
- 类型角标复用 `timeline-attachments.ts:56` 的 `labelOf`(导出共用),目录暗示复用 `splitViewerPath`(`file-viewer-core.ts:87`)。

### 4.3 数据来源与刷新(工作区注入)

```ts
// session-rail-artifacts.tsx 的 props 增量
export type SessionMessagesOf = (sessionID: string) => Promise<readonly SessionMessageWithParts[]> // 读不到即 reject

export function SessionRailArtifacts(props: {
  live: CodePuppySessionLiveContext
  rail: SessionRailApi
  parentOf?: SessionParentOf
  /** 生产 = v1 `client.session.messages({ sessionID })`,不带 limit(F-10)。缺席 = 不显示本机产物区。 */
  messagesOf?: SessionMessagesOf
  /** 生产 = 用 scanLocalArtifacts 扫同步 store 里当前会话得到的 `path@writtenAt` 串;变了就重读。 */
  localRevision?: Accessor<string>
}): JSX.Element
```

- 工作区(`codepuppy-session-workspace.tsx`,与 `sessionParentOf` 同处)造这两个注入:`messagesOf` 走 `serverSDK().client.session.messages`;`localRevision` 由 `serverSync().session.data.message[sessionID]` 与 `data.part[messageID]` 拼成 `SessionMessageWithParts[]` 后扫出。
- 面板内一份本机资源，键 = (`tick`, `localRevision()`):读当前会话全量 → 扫描 → 按 `childSessionIDs` 逐层读子会话 → 合并。**任一会话读失败，整份结果为失败**(不出半份清单)。
- 刷新时机：面板挂载、刷新按钮(既有 `tick`)、同步 store 里出现新的写成事实(`localRevision` 变化;回合进行中写出的文档因此即时出现)。不轮询。

### 4.4 面板怎么并列显示

结果类型与阶段:

```ts
// artifacts-core.ts 增量
export type LocalArtifactsResult = { ok: true; items: LocalArtifact[] } | { ok: false }

export type ArtifactsPhase = /* 既有成员不变 */ | "local-only"

artifactsPhaseOf(input: {
  /* 既有字段不变 */
  /** undefined = 还没回答。 */
  local?: LocalArtifactsResult
}): ArtifactsPhase
```

`runId === undefined` 那一支(既有 `artifactsPhaseOf` 第 49 行)改为:`local` 未回答 → `loading`;`local.ok === false` → `error`;有本机产物 → `local-only`;否则照旧 `empty-scope` / `empty`。`runId` 有值的各支不变。

行模型与视图增量:

```ts
export type LocalFileState = "present" | "missing" | "unknown"

export interface LocalArtifactRow {
  path: string                 // 身份;点击时原样交给 rail.openFileViewer
  name: string
  dir: string                  // splitViewerPath 的 dir,根目录为 ""
  label: string                // DOCX / PDF / HTML / MD …
  moment: RunMoment | null     // runMomentOf(new Date(writtenAt).toISOString(), now)
  file: LocalFileState
}

// SessionRailArtifactsView props 增量
local: { status: "loading" } | { status: "error" } | { status: "ready"; rows: LocalArtifactRow[] }
onOpenLocal: (path: string) => void
```

- **位置与顺序**:本机产物区在范围切换条之下、云端 run 条之上;区内按最近写成在前。云端部分以 run 为组、带切换与置顶预览，无法与逐份文档按时间穿插，所以两区并列、各自按时间排。
- **来源标注**:区标题新文案键 `codepuppy.session.artifactsLocalTitle`(zh「在本机生成」，en "Made on this computer")。「项目全部」下，标题旁复用既有 `codepuppy.session.artifactsOwnerThis`(「本次对话」)标签。区内只列本次对话的本机产物(其他对话的不在本设计内，见 §10 留档)。
- **行**:类型角标 + 文件名 + 目录暗示 + 写成时刻(复用 `artifactsRun{Today,Yesterday,Date,DateYear}` 文案)。
- **打开与预览**:点 `present` / `unknown` 行 → `props.rail.openFileViewer(row.path)`,进入文件面板的查看器(现成 renderer、现成的「用默认应用打开 / 在访达中显示 / 另存副本」)。不新开预览通道，不复制文件。
- **文件挪走或删掉**:`missing` 行保留文件名与位置，挂既有 `codepuppy.wb.state.missing`(「文件缺失」)标签，不可点(文件已不在，点进去只会是读取失败)。`unknown`(stat 通道本身出错，或 symlink、越出工作区等其他拒绝码)照常可点，由查看器显示它自己的准确状态。任何情况都不抛进 SurfaceBoundary。
- **读取失败**:本机清单读不到、云端有 run 时，本机区显示既有 `codepuppy.wb.listFailed` + `codepuppy.wb.retry`(重试 = 既有 `tick`);两边都没有内容时走既有 `error` 阶段。
- **空态文案：不改。** 「助手生成的文档会出现在这里。」和「让助手画图、写报告或做表格，结果会出现在这里。」在收录本机产物之后都成了真话;`empty-scope` 只在项目里确有别的对话的云端 run 时出现，「其他对话的结果在「项目全部」」仍然成立。
- **不加**:设置、开关、数量上限、确认、新步骤。

### 4.5 文件状态通道(决定新增，main)

F-13:现有通道只有「开一个读取会话」,并发上限 4,拿它探存在与否要逐个开、关 fd。新增一个只读的批量状态查询，守卫与查看器打开时**同一个**函数，保证行上的状态与点进去的结果一致。

```ts
// packages/ui-mac/src/shared/file-viewer.ts
export type WorkspaceFileStatResult = { ok: true; size: number } | { ok: false; code: FileViewerRefusal }

// packages/ui-mac/src/main/workspace-file-service.ts
/** 逐项 = resolveWorkspaceFile(workspaceDir, rel);非字符串项 → invalid-path。与入参同序同长。不读内容、不开 fd。 */
export function statWorkspaceFiles(workspaceDir: string, relPaths: readonly unknown[]): WorkspaceFileStatResult[]

// IPC(registerWorkspaceFileIpcHandlers 内):
//   "workspace-file-stat"(dir: unknown, rels: unknown) → WorkspaceFileStatResult[]
//   dir 非字符串 → 每项 invalid-path;rels 非数组 → []
// preload(window.api.workspaceFile):
stat: (directory: string, relPaths: string[]) => Promise<WorkspaceFileStatResult[]>
```

映射:`ok` → `present`;`code === "not-found"` → `missing`;其余拒绝码或 IPC 抛错 → `unknown`。每次本机清单更新后、以及刷新时各查一次。绝对路径不过 IPC(沿用 `shared/file-viewer.ts` 的路径纪律)。

### API / 数据 / 事件与配置

- 无 HTTP API、无持久化数据、无新配置键。引擎、ext、云端契约都不动;`ArtifactSource` 的 `"local"` 不使用、不改。

## 5. 数据与失败

- 全程只读：不写 manifest、不写新记录、不复制文件。重开对话、重启应用后由引擎持久化的 part 重新推出同一份清单。
- 可达失败窗口:(1) 任一会话消息读失败 → 本机结果失败，可重试，不出半份清单;(2) stat 出错 → `unknown`,点开由查看器给真状态;(3) 推导后到点击之间文件被删 → 查看器显示读取失败;(4) 面板开着时用户在访达里删文件 → 行状态到下一次刷新或下一次写成事实才更新(不订阅文件监视，见留档)。
- 形状异常(缺字段、类型不对、路径解析失败)一律跳过该项，不抛。

## 6. 架构落点

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| `scanLocalArtifacts` 与合并规则 | `packages/ui-mac` renderer,`session-rail/artifacts/` | renderer 内:tool-card-model、timeline-attachments、file-viewer-core、shared | `toolCardDispatchOf` / `taskCardInfoOf`(`tool-card-model.ts:354,1716`);Office 调用匹配器(`timeline-attachments.ts:86`);`viewerPlanFor`(`file-viewer-core.ts:35`);`normalizePosixPath`(`attachment-path.ts:60`) |
| `OFFICE_WRITE_TOOL` | `packages/ui-mac/src/shared/office-advisories.ts` | 无 | `CODEPUPPY_OFFICE_CONNECTORS`(同文件 78-101) |
| 阶段与行模型增量 | `session-rail/artifacts/artifacts-core.ts` | 同上 | `artifactsPhaseOf`(35-56)、`runMomentOf`(76)、`SCOPE_ANCESTRY_MAX_DEPTH`(151) |
| 面板与视图增量 | `session-rail-artifacts.tsx`、`artifacts-panel-view.tsx` | `SessionRailApi` | `rail.openFileViewer`(`session-workspace-shell.tsx:462`) |
| `messagesOf` / `localRevision` 注入 | `session-workspace/codepuppy-session-workspace.tsx` | `@opencode-ai/sdk` v1 客户端、同步 store | `sessionParentOf` 的注入写法(125-131) |
| `statWorkspaceFiles` + IPC + preload | `main/workspace-file-service.ts`、`shared/file-viewer.ts`、`preload/` | main 内 | `resolveWorkspaceFile`(58) |

- 新目录/新模块：无。`local-artifacts.ts` 是既有 `session-rail/artifacts/` 下的新文件。
- 北极星：全部落在自有包 `packages/ui-mac`,不碰上游文件、不改引擎。
- 架构约束:K2 ——「认出第一方 Office 调用」只留一份(附件与本机产物共用 F-06 的匹配器);Office 写工具名与服务名同在 `office-advisories.ts`;状态判定与查看器同用 `resolveWorkspaceFile`。本改动对 K2 是**更好**(把私有的 `readCallsOf` 提成共用)。`modules.md` 第 51 行「渲染进程不得直接依赖 main 私有模块」:不变，renderer 只经 preload。
- 工程标准：时刻存 UTC epoch 毫秒，显示时按本地日历转换(`runMomentOf`);错误走既有拒绝码枚举，不解析散文。
- 被否决的替代:
  - 复用 manifest / descriptor 写 `source: "local"`:descriptor 是跨仓线上契约，必填 http-stream 内容引用与云端 jobId(F-02),manifest 只收 run 目录里的文件(F-03);要么伪造 jobId/URL,要么改平台契约并把用户文件复制进 run 目录(两份字节会分叉)。
  - ext 在 `tool.execute.after` 另记一份清单：新存储加一套生命周期，而 part 已持久化同样的事实。
  - 引擎自带 `Artifact` 服务(F-16):默认关闭，且要模型主动调用，清单会取决于模型行为;它也是上游文件。
  - 只扫 renderer 已加载的同步 store:只有分页窗口，长对话会漏掉早先的文档(与 REQ-236 方案否决「归属从已加载消息现算」同理)。同步 store 只用来触发重读。
  - 把查看器嵌进产物面板：多一个叠放预览宿主区和一套读取会话;`openFileViewer` 是已在用的跨面板入口。
  - 用引擎 `file.list` 列父目录判存在：是否滤掉 gitignore 项未核实，且与查看器打开时的守卫不是同一判定，行状态可能和点进去的结果不一致。
  - 收录 `edit` 与所有文件类型：编码对话里会被源码改动淹没，这些已在审查面板。
  - 收录会话目录外的文档：要么把绝对路径交过 IPC(违反 AC-04 与 `file-viewer.ts` 路径纪律),要么列出却打不开也查不了状态。Office 工具本身只能写工作区内(F-04);引擎写到工作区外要额外授权，少见。
- 安全面:renderer 只持相对路径;存在性与读取都在 main 经 realpath 圈禁、拒 symlink;不新增任何读取内容的通道。

## 8. 拆分决定

不适用。只改 alpha-code 一个仓的 `packages/ui-mac`,无跨仓或跨负责人拆分。

## 9. 回滚

不适用。没有数据迁移，不写任何持久化数据。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| 本机产物 = Office 写工具成功调用 + 引擎 `write` 成功 + `patch` 新建，后两者限文档类型;`edit`、shell 间接产物、第三方工具不收 | §4.1;F-04..F-09 @66966bcfbb。「文档类型」的划法是对 owner「文档」一词的解读(推断) |
| 记录不新建，只从引擎持久化的 part 推导;不用 `ArtifactSource "local"` | F-02、F-03、F-10、F-16 |
| 本次对话含子代理子会话，深度 16 | F-09;与云端「本次对话」同口径(`artifacts-core.ts:147-186`) |
| 数据源 = 全量 `session.messages`;同步 store 只做重读触发 | F-10 |
| 打开 = `rail.openFileViewer`,复用文件面板查看器 | F-12 |
| 新增 `workspace-file-stat` 批量只读通道(决定新增) | F-13;守卫 = `resolveWorkspaceFile` |
| 本机区在云端区之上，各自按时间倒序;标题「在本机生成」;空态文案不改 | §4.4;F-01、F-15 |
| 会话目录外的文档不收录 | §6 被否决的替代末条(推断：派发书没有点名) |

**待定(交编排器，不是本设计能定的)**

| 项 | 证据 | 不定的后果 |
| --- | --- | --- |
| 用户可见改动没有已批 spec | 本文 §1;规则「M/L 用户可见工作须有已批 spec」 | 若定级为 M,Ready 缺 spec;若按派发书的 small 处理，以 owner 选项原话为范围依据 |
| 本机产物区没有已批 UX 稿 | §1;PAGE-MAP 第 59 行该面现行稿为 `current/session-workspace/design.html#direction-2026-11` | 版面细节(间距、滚动收纳、行样式)无依据;§4.4 只冻结数据、顺序、状态与文案键 |

| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| — | 尚未送审 | — | — | — |

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| 「项目全部」也列其他对话的本机产物 | 要读项目内每个会话的全量消息 | owner 原话只说「本次对话」 | owner 提出要看全项目的本机文档 |
| 订阅文件监视事件，即时更新「文件缺失」 | 面板开着时在访达里删文件，要等刷新才变 | 刷新按钮与下一次写成事实已覆盖;面板不持有 serverSDK | 用户反馈状态滞后 |
| 跟踪被 `patch` 挪动的文档 | 挪动后旧路径显示「文件缺失」,新路径不列 | 少见;挪动不是「生成」 | 出现实际案例 |
| Windows 盘符大小写不一致时的路径比较 | `C:` 与 `c:` 不同会被判为目录外而不列 | 与附件判定同一套规范化，不另造平台分支 | Windows 实机发现漏列 |
| 对话内的本机产物链接行(`timeline-artifact-links` BR-01) | 现只对云端产物出行 | 不在本次 owner 原话内 | owner 要求 |
