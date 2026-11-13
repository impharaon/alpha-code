// `#1697`(I-04,设计 docs/specs/upgrade-ui-contract/design.md §4.1、§4.3、§4.8):界面与引擎之间的路由目录 —— Code Puppy 自有的约定,
// 代际无关。冻结界面与 Code Puppy 自己的界面经 engineFetch 发出的每个引擎请求,只能落在这里的三张表之一:
//   · SERVED          服务的路由(今天的路由表,不增不减);其中 FIXED 三条由约定侧直答,其余交当前代翻译器(TranslatedKey);
//   · UNSUPPORTED     声明不支持:不会有 handler,运行时 501 + console.error;
//   · PROBE_FALLBACK  探活回退:调用方先试它、失败即回退到已服务的路由,约定侧固定回 501 信封、不记错误日志(UC-19)。
// 三张表都不命中的请求同样 501 + console.error。覆盖由 engine-adapter/routes-coverage.test.ts 从冻结界面与 renderer 的源码扫描来判。
// 目录项的类型按设计 §4.3 规则 1 引用发出它的冻结客户端的生成类型,不复制:v1 SDK 的 `<Op>Responses` / `<Op>Data`,冻结 app
// 自带的 1.17.13 客户端的 `<Op>Output`;两个客户端都发的取交。请求体只给翻译器读它的那些路由定型,直通的不读请求体。
// 翻译器经 `RouteContext.reply` 出 JSON 时,body 的类型就是这里的响应类型(设计 §4.4、§4.8)。
import type * as Legacy from "@opencode-ai/client/promise"
import type * as V1 from "@opencode-ai/sdk/v2/client"
import type { ContractFrame } from "./events"

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
/** "<METHOD> <模板>";`:name` 取一段,`*name` 取余下全部。 */
export type RouteKey = `${Method} /${string}`
/** 目录项只在编译期携带类型。 */
export type Served<Response, Body = undefined> = { readonly __response?: Response; readonly __body?: Body }
const entry = <Response = unknown, Body = undefined>(): Served<Response, Body> => ({})
/** v1 SDK 的 `<Op>Responses` 按状态码分;成功的那一个。 */
type Ok<Responses> = Responses[Extract<keyof Responses, 200 | 201 | 204>]
/** 1.17.13 客户端声明 `void` 的操作只核状态码、不读响应体(设计 P-09),与另一个客户端的类型取交时不加约束。 */
type LegacyOk<Output> = [Output] extends [void] ? unknown : Output
type BodyOf_<Data> = NonNullable<Data extends { body?: infer Body } ? Body : never>
/** SSE 事件流,帧格式见 contract/events.ts。 */
export type ContractEventStream = AsyncIterable<ContractFrame>

/** 服务的路由,顺序即匹配顺序(先列的先匹配,如 `GET /session/status` 在 `GET /session/:sessionID` 之前)。 */
export const SERVED = {
  "GET /global/health": entry<Ok<V1.GlobalHealthResponses>>(),
  "POST /instance/dispose": entry<Ok<V1.InstanceDisposeResponses>>(),
  "GET /global/event": entry<ContractEventStream>(),
  "GET /path": entry<Ok<V1.PathGetResponses>>(),
  "GET /global/config": entry<Ok<V1.GlobalConfigGetResponses>>(),
  "GET /config": entry<Ok<V1.ConfigGetResponses>>(),
  "GET /project": entry<Ok<V1.ProjectListResponses>>(),
  "GET /project/current": entry<Ok<V1.ProjectCurrentResponses>>(),
  "GET /api/project/current": entry<LegacyOk<Legacy.ProjectCurrentOutput>>(),
  "PATCH /project/:projectID": entry<Ok<V1.ProjectUpdateResponses>, BodyOf_<V1.ProjectUpdateData>>(),
  "POST /project/git/init": entry<Ok<V1.ProjectInitGitResponses>>(),
  "GET /session": entry<Ok<V1.SessionListResponses>>(),
  "GET /experimental/session": entry<Ok<V1.ExperimentalSessionListResponses>>(),
  "POST /session": entry<Ok<V1.SessionCreateResponses>, BodyOf_<V1.SessionCreateData>>(),
  "GET /session/status": entry<Ok<V1.SessionStatusResponses>>(),
  "GET /session/:sessionID": entry<Ok<V1.SessionGetResponses>>(),
  "PATCH /session/:sessionID": entry<Ok<V1.SessionUpdateResponses>, BodyOf_<V1.SessionUpdateData>>(),
  "DELETE /session/:sessionID": entry<Ok<V1.SessionDeleteResponses>>(),
  "POST /session/:sessionID/fork": entry<Ok<V1.SessionForkResponses>, BodyOf_<V1.SessionForkData>>(),
  "POST /session/:sessionID/abort": entry<Ok<V1.SessionAbortResponses>>(),
  "POST /session/:sessionID/prompt_async": entry<Ok<V1.SessionPromptAsyncResponses>, BodyOf_<V1.SessionPromptAsyncData>>(),
  // UC-17:这条命令那个回合的助手消息;命令没开回合时回 {}
  "POST /session/:sessionID/command": entry<Ok<V1.SessionCommandResponses> | Record<string, never>, BodyOf_<V1.SessionCommandData>>(),
  // 翻译器回 {}(2.x 的 shell 只受理);v1 SDK 声明的是那个回合的消息,但没有消费方读响应体
  // (codepuppy-app/src/utils/server-compat.ts 的 shell 只 await;prompt-input/submit.ts 走 /api/session/:id/shell 直通)
  "POST /session/:sessionID/shell": entry<Record<string, never>, BodyOf_<V1.SessionShellData>>(),
  "POST /session/:sessionID/summarize": entry<Ok<V1.SessionSummarizeResponses>>(),
  "POST /session/:sessionID/revert": entry<Ok<V1.SessionRevertResponses>, BodyOf_<V1.SessionRevertData>>(),
  "POST /session/:sessionID/unrevert": entry<Ok<V1.SessionUnrevertResponses>>(),
  "GET /session/:sessionID/message": entry<Ok<V1.SessionMessagesResponses>>(),
  "GET /session/:sessionID/todo": entry<Ok<V1.SessionTodoResponses>>(),
  "GET /session/:sessionID/message/:messageID": entry<Ok<V1.SessionMessageResponses>>(),
  "GET /agent": entry<Ok<V1.AppAgentsResponses>>(),
  "GET /command": entry<Ok<V1.CommandListResponses>>(),
  "GET /provider": entry<Ok<V1.ProviderListResponses>>(),
  "GET /mcp": entry<Ok<V1.McpStatusResponses>>(),
  "GET /experimental/resource": entry<Ok<V1.ExperimentalResourceListResponses>>(),
  "GET /vcs": entry<Ok<V1.VcsGetResponses>>(),
  "GET /vcs/status": entry<Ok<V1.VcsStatusResponses>>(),
  "GET /vcs/diff": entry<Ok<V1.VcsDiffResponses>>(),
  "GET /file": entry<Ok<V1.FileListResponses>>(),
  "GET /file/content": entry<Ok<V1.FileReadResponses>>(),
  "GET /find/file": entry<Ok<V1.FindFilesResponses>>(),
  "POST /mcp/:name/connect": entry<Ok<V1.McpConnectResponses>>(),
  "POST /mcp/:name/disconnect": entry<Ok<V1.McpDisconnectResponses>>(),
  "POST /api/mcp/:server/connect": entry<LegacyOk<Legacy.McpConnectOutput>>(),
  "POST /api/mcp/:server/disconnect": entry<LegacyOk<Legacy.McpDisconnectOutput>>(),
  "POST /mcp/:name/auth/authenticate": entry<Ok<V1.McpAuthAuthenticateResponses>>(),
  "GET /permission": entry<Ok<V1.PermissionListResponses>>(),
  "POST /permission/:requestID/reply": entry<Ok<V1.PermissionReplyResponses>, BodyOf_<V1.PermissionReplyData>>(),
  "POST /session/:sessionID/permissions/:permissionID": entry<Ok<V1.PermissionRespondResponses>, BodyOf_<V1.PermissionRespondData>>(),
  "POST /api/session/:sessionID/permission/:requestID/reply": entry<Ok<V1.V2SessionPermissionReplyResponses> & LegacyOk<Legacy.PermissionReplyOutput>, BodyOf_<V1.V2SessionPermissionReplyData>>(),
  "GET /api/session/:sessionID/permission": entry<Ok<V1.V2SessionPermissionListResponses>>(),
  "GET /question": entry<Ok<V1.QuestionListResponses>>(),
  "POST /question/:requestID/reply": entry<Ok<V1.QuestionReplyResponses>, BodyOf_<V1.QuestionReplyData>>(),
  "POST /question/:requestID/reject": entry<Ok<V1.QuestionRejectResponses>>(),
  "GET /pty": entry<Ok<V1.PtyListResponses>>(),
  "POST /pty": entry<Ok<V1.PtyCreateResponses>, BodyOf_<V1.PtyCreateData>>(),
  "GET /pty/shells": entry<Ok<V1.PtyShellsResponses>>(),
  "GET /pty/:ptyID": entry<Ok<V1.PtyGetResponses>>(),
  "PUT /pty/:ptyID": entry<Ok<V1.PtyUpdateResponses>, BodyOf_<V1.PtyUpdateData>>(),
  "DELETE /pty/:ptyID": entry<Ok<V1.PtyRemoveResponses>>(),
  "POST /pty/:ptyID/connect-token": entry<Ok<V1.PtyConnectTokenResponses>>(),
  "GET /api/agent": entry<Ok<V1.V2AgentListResponses>>(),
  // 发出的是 2.x 的模型清单(只剥标题用的 none 档):模型与 1.17.13 客户端的 ModelListOutput 同形,location 信封是 2.x 的
  // { directory, workspaceID? }。两个冻结客户端都声明了引擎不发的 location.project,v1 SDK 的 V2ModelList(上游 1.18.35)还多声明
  // 模型的 api / request。消费方只读 data 里两边都有的字段(renderer/codepuppy-ui/model-contract.ts:id、providerID、name、enabled、
  // status、capabilities.input、variants[].id、limit),所以按实际发出的形状登记
  "GET /api/model": entry<Omit<Legacy.ModelListOutput, "location"> & { location: { directory: string; workspaceID?: string } }>(),
  "GET /api/provider/:providerID": entry<Ok<V1.V2ProviderGetResponses>>(),
  "GET /api/reference": entry<Ok<V1.V2ReferenceListResponses>>(),
  "GET /api/session": entry<Ok<V1.V2SessionListResponses> & LegacyOk<Legacy.SessionListOutput>>(),
  "POST /api/session": entry<LegacyOk<Legacy.SessionCreateOutput>>(),
  "GET /api/session/active": entry<LegacyOk<Legacy.SessionActiveOutput>>(),
  "GET /api/session/:sessionID": entry<Ok<V1.V2SessionGetResponses> & LegacyOk<Legacy.SessionGetOutput>>(),
  "DELETE /api/session/:sessionID": entry<LegacyOk<Legacy.SessionRemoveOutput>>(),
  "POST /api/session/:sessionID/model": entry<Ok<V1.V2SessionSwitchModelResponses>>(),
  "POST /api/session/:sessionID/fork": entry<LegacyOk<Legacy.SessionForkOutput>>(),
  "POST /api/session/:sessionID/compact": entry<LegacyOk<Legacy.SessionCompactOutput>>(),
  "POST /api/session/:sessionID/shell": entry<LegacyOk<Legacy.SessionShellOutput>>(),
  "POST /api/session/:sessionID/rename": entry<LegacyOk<Legacy.SessionRenameOutput>, Omit<Legacy.SessionRenameInput, "sessionID">>(),
  "GET /api/fs/find": entry<LegacyOk<Legacy.FileFindOutput>>(),
  "GET /api/vcs/status": entry<LegacyOk<Legacy.VcsStatusOutput>>(),
  "GET /api/vcs/diff": entry<LegacyOk<Legacy.VcsDiffOutput>>(),
  "POST /api/pty": entry<LegacyOk<Legacy.PtyCreateOutput>>(),
  "GET /api/pty/:ptyID": entry<LegacyOk<Legacy.PtyGetOutput>>(),
  "PUT /api/pty/:ptyID": entry<LegacyOk<Legacy.PtyUpdateOutput>>(),
  "DELETE /api/pty/:ptyID": entry<LegacyOk<Legacy.PtyRemoveOutput>>(),
  "GET /api/integration/:integrationID": entry<LegacyOk<Legacy.IntegrationGetOutput>>(),
  "POST /api/integration/:integrationID/connect/key": entry<LegacyOk<Legacy.IntegrationConnectKeyOutput>>(),
  "POST /api/integration/:integrationID/connect/oauth": entry<LegacyOk<Legacy.IntegrationOauthConnectOutput>>(),
  "GET /api/integration/:integrationID/connect/oauth/:attemptID": entry<LegacyOk<Legacy.IntegrationOauthStatusOutput>>(),
  "POST /api/integration/:integrationID/connect/oauth/:attemptID/complete": entry<LegacyOk<Legacy.IntegrationOauthCompleteOutput>>(),
} as const satisfies Record<RouteKey, Served<unknown, unknown>>

export type ServedKey = keyof typeof SERVED
export type ResponseOf<K extends ServedKey> = NonNullable<(typeof SERVED)[K]["__response"]>
export type BodyOf<K extends ServedKey> = NonNullable<(typeof SERVED)[K]["__body"]>

/**
 * 规则 5(设计 §4.3、§4.10 d):翻译器原样转发的路由(直通),消费方实际读什么。路径以 HTTP 响应体为根:`data[].id` = data 数组
 * 每一项的 id,`data.*.type` = data 对象每个值的 type,结尾 `?` = 消费方容忍缺失;`fields: []` = 只看状态码。或者登记一个冻结
 * 消费函数(`at` 指它吃响应体的哪一部分)。读点是 packages/ 下的路径。一致性 d 在真引擎样本上逐条核(passthrough-reads.test.ts)。
 */
export type ReadSet =
  | { readonly fields: readonly string[]; readonly sites: readonly string[] }
  | { readonly consumer: "normalizeSessionInfo"; readonly at: "data" | "data[]"; readonly sites: readonly string[] }

export const READS = {
  "GET /api/agent": {
    fields: ["data[].id", "data[].mode", "data[].hidden", "data[].description?"],
    sites: ["ui-mac/src/renderer/codepuppy-ui/composer-autocomplete.tsx:184,282-289"],
  },
  "GET /api/provider/:providerID": { fields: ["data.id"], sites: ["ui-mac/src/renderer/codepuppy-ui/model-contract.ts:277-286"] },
  "GET /api/reference": {
    fields: ["data[].name", "data[].path", "data[].hidden?", "data[].description?", "data[].source.type"],
    sites: ["codepuppy-app/src/context/global-sync/bootstrap.ts:324", "codepuppy-app/src/components/prompt-input.tsx:566-579"],
  },
  "GET /api/session": {
    consumer: "normalizeSessionInfo",
    at: "data[]",
    sites: [
      "codepuppy-app/src/context/directory-sync.ts:127-129",
      "codepuppy-app/src/context/global-sync/home-session-index.ts:131",
      "codepuppy-app/src/components/command-palette.ts:149",
      "codepuppy-app/src/pages/home/home-sessions-controller.tsx:70",
    ],
  },
  "POST /api/session": { consumer: "normalizeSessionInfo", at: "data", sites: ["codepuppy-app/src/components/prompt-input/submit.ts:407-411"] },
  "GET /api/session/active": {
    fields: ["data.*.type"],
    sites: ["codepuppy-app/src/context/server-sync.tsx:168-176,256-258"],
  },
  "GET /api/session/:sessionID": {
    consumer: "normalizeSessionInfo",
    at: "data",
    sites: ["codepuppy-app/src/components/titlebar.tsx:210-212", "ui-mac/src/renderer/codepuppy-ui/model-contract.ts:383-387"],
  },
  "DELETE /api/session/:sessionID": { fields: [], sites: ["codepuppy-app/src/pages/session/timeline/message-timeline.tsx:873-875"] },
  "POST /api/session/:sessionID/model": { fields: [], sites: ["ui-mac/src/renderer/codepuppy-ui/model-contract.ts:393-396"] },
  "POST /api/session/:sessionID/fork": { fields: ["data.id"], sites: ["codepuppy-app/src/components/dialog-fork.tsx:75-80"] },
  "POST /api/session/:sessionID/compact": { fields: [], sites: ["codepuppy-app/src/pages/session/use-session-commands.tsx:409"] },
  "POST /api/session/:sessionID/shell": { fields: [], sites: ["codepuppy-app/src/components/prompt-input/submit.ts:500-508"] },
  "GET /api/fs/find": {
    fields: ["data[].path"],
    sites: [
      "codepuppy-app/src/context/file.tsx:217",
      "codepuppy-app/src/components/directory-picker-domain.ts:378",
      "codepuppy-app/src/components/dialog-select-directory-v2.tsx:107-111",
    ],
  },
  "GET /api/vcs/status": { fields: ["data"], sites: ["codepuppy-app/src/pages/layout.tsx:1524-1527,1592-1595"] },
  "GET /api/vcs/diff": {
    fields: ["data[].file", "data[].additions", "data[].deletions", "data[].patch"],
    sites: ["codepuppy-app/src/pages/session.tsx:699-701,719,733-736,747-755"],
  },
  "POST /api/pty": { fields: ["data.id", "data.command"], sites: ["codepuppy-app/src/context/terminal.tsx:288-297,339-348"] },
  "GET /api/pty/:ptyID": { fields: ["data.status"], sites: ["codepuppy-app/src/components/terminal.tsx:563-564"] },
  "PUT /api/pty/:ptyID": { fields: [], sites: ["codepuppy-app/src/context/terminal.tsx:262", "codepuppy-app/src/components/terminal.tsx:263"] },
  "DELETE /api/pty/:ptyID": { fields: [], sites: ["codepuppy-app/src/context/terminal.tsx:448"] },
  "GET /api/integration/:integrationID": {
    fields: ["data.methods[].type", "data.methods[].id"],
    sites: ["codepuppy-app/src/components/dialog-connect-provider.tsx:420-429,545"],
  },
  "POST /api/integration/:integrationID/connect/key": { fields: [], sites: ["codepuppy-app/src/components/dialog-connect-provider.tsx:824"] },
  "POST /api/integration/:integrationID/connect/oauth": {
    fields: ["data.attemptID", "data.url", "data.mode", "data.instructions?"],
    sites: ["codepuppy-app/src/components/dialog-connect-provider.tsx:554-563,957,975,1014,1042,1171"],
  },
  "GET /api/integration/:integrationID/connect/oauth/:attemptID": {
    fields: ["data.status", "data.message?"],
    sites: ["codepuppy-app/src/components/dialog-connect-provider.tsx:1053-1071"],
  },
  "POST /api/integration/:integrationID/connect/oauth/:attemptID/complete": {
    fields: [],
    sites: ["codepuppy-app/src/components/dialog-connect-provider.tsx:954-962"],
  },
} as const satisfies Partial<Record<ServedKey, ReadSet>>

/** 答复不依赖引擎的路由,由约定侧直接答(UC-14,R8)。 */
export const FIXED = {
  // v1 的配置对象在 2.x 拆成多份配置文档;冻结 app 的 v2 支路对配置给的就是空对象,v1 路径上读它的只有默认模型回落与客户端
  // 自动回复判断(`config.permission === "allow"`,空对象 ⇒ 不自动回复,审批由引擎与 ext 决定)。
  "GET /global/config": () => ({}),
  "GET /config": () => ({}),
  // 0.1.26 的 v2 审批通道在 2.x 上没有对应:请求全部经 v1 通道交给界面。这里若照搬 2.x 列表,同一请求会以缺 subject/scope 的
  // v2 形状再进一次审批面,严格核验不过即被自动拒绝(PermissionDialog onMount)。
  "GET /api/session/:sessionID/permission": () => ({ data: [] }),
} as const satisfies Partial<Record<ServedKey, () => unknown>>

export type TranslatedKey = Exclude<ServedKey, keyof typeof FIXED>

/**
 * 冻结源码里扫得到、但约定**不服务**的引擎请求,每条一个理由(设计 §4.8 五组)。这些请求真发出来时由管道回 501 + console.error;
 * 要让任何一条变成「服务」,需要改约定,并按 ADR-048 把用户可见的部分交 owner。
 */
export const UNSUPPORTED = {
  "DELETE /auth/:providerID": "U5:上游设置页的凭证增删,Code Puppy 界面挂不上(设置入口 settings.open 由 codepuppy-sidebar.tsx 注册到 Code Puppy 设置页);BYOK 由主进程管",
  "PUT /auth/:providerID": "U5:同上(另一个发出点 server-compat.ts 的 integration.connect.key 只被上游连接对话框调用)",
  "POST /global/dispose": "U5:只在上游设置页的凭证增删之后调用",
  "GET /provider/auth": "U5:只在 server-compat.ts 的 integration.get(上游连接对话框)里调用",
  "POST /provider/:providerID/oauth/authorize": "U5:上游连接对话框的 OAuth",
  "POST /provider/:providerID/oauth/callback": "U5:上游连接对话框的 OAuth",
  "GET /lsp": "U4:2.x 只有 lsp.updated 事件、没有查询端点;请求由冻结 app 的数据层发出,显示它的状态弹层只挂在上游会话头与新会话页,Code Puppy 界面挂不上(编排器 2026-11-09 认可进本单)",
  "POST /session/:sessionID/share": "R6:owner 裁定拿掉「分享对话」;不把会话发到任何外部地址",
  "DELETE /session/:sessionID/share": "R6:取消分享,随「分享对话」一起拿掉(上游 use-session-commands / message-timeline 里的入口 Code Puppy 界面挂不上)",
  "PATCH /global/config": "U5:只被上游设置页与自定义 provider 对话框调用(server-sync.tsx updateConfig 的全部调用方),Code Puppy 界面挂不上",
  "POST /experimental/worktree": "U4:worktree 增删重置只在上游 LegacyLayout(pages/layout.tsx)里,它只挂在 /:dir 路由下,Code Puppy 不导航到那里(app.tsx:321 那条只在 newLayoutDesigns 关时走,codepuppy-defaults.ts 恒开)",
  "GET /experimental/worktree": "U4:同上(server-compat.ts 的 project.directories → layout.tsx:1188)",
  "DELETE /experimental/worktree": "U4:worktree 删除,同在上游 LegacyLayout(layout.tsx:1392)",
  "POST /experimental/worktree/reset": "U4:同上;2.x 也没有 reset",
  "GET /api/project/:projectID/directories": "U4:同上;2.2.x 已删",
  "POST /api/session/:sessionID/question/:requestID/reply": "v1 模式下 createCompatibleApi 改走 v1 的 /question/:id/reply(server-compat.ts:508);2.2.x 已删",
  "POST /api/session/:sessionID/question/:requestID/reject": "v1 模式下改走 /question/:id/reject(server-compat.ts:514);2.2.x 已删",
  // `#1662`:扫描改成不依赖排版(跨行写的链)之后才扫出的五条,都只在冻结 app 判定引擎是 v2 协议时发出;适配器的 /global/health 答
  // healthy:true(本表首条),detectServerProtocol 因此恒判 v1(utils/server-protocol.ts:29)。
  "GET /api/event": "v2 支路:server-sdk.tsx:268-272 只在协议不是 v1 时订阅 1.17.13 的 /api/event,v1 走 /global/event(已接)",
  "GET /api/permission/request": "v2 支路:permission.tsx:264-269 与 global-sync/bootstrap.ts:447-450 在 v1 协议下改走 v1 的 GET /permission(已接)",
  "GET /api/question/request": "v2 支路:global-sync/bootstrap.ts:483-486 在 v1 协议下改走 v1 的 GET /question(已接)",
  "GET /api/fs/list": "只经 createCompatibleApi 的 api.file.list 发出(directory-picker-domain.ts:345、dialog-select-directory-v2.tsx:130、home-controller.ts:96);v1 协议下它被 createV1Api 改写成 v1 的 GET /file(server-compat.ts:360-363,已接)",
  "GET /api/model/default": "v2 支路:global-sync/bootstrap.ts:232-241 在 v1 协议(且传了 legacy 客户端,三个生产调用方都传)下改走 v1 的 GET /provider(已接)",
  // `#1697` R16(编排器 2026-11-13):这两条原是直通,只在冻结 app 判定引擎是 v2 协议时经 1.17.13 客户端发出;协议恒为 v1(UC-01),
  // createCompatibleApi 把它们改写成 v1 的 POST /session/:id/abort 与 POST /session/:id/command(已接)。真引擎也答不上冻结客户端的形状。
  "POST /api/session/:sessionID/interrupt":
    "v2 支路:codepuppy-app/src/utils/server-compat.ts createV1Api 的 interrupt 在 v1 协议下改走 v1 的 POST /session/:id/abort(已接);2.x 回 200 {interrupted},1.17.13 客户端声明 204",
  "POST /api/session/:sessionID/command":
    "v2 支路:createV1Api 的 command 在 v1 协议下改走 v1 的 POST /session/:id/command(已接);1.17.13 客户端发 {command, arguments},2.x 要 {name, text}(400)",
} as const satisfies Record<RouteKey, string>

/** 探活回退(UC-19、R15):冻结的健康检查先试它、失败即回退,失败本身就是约定,所以不放进「不支持」,也不记错误日志。 */
export const PROBE_FALLBACK = {
  "GET /api/health":
    "codepuppy-app/src/utils/server-health.ts 的 checkServerHealth 先发它,失败后回退 GET /global/health;utils/server-protocol.ts 的 detectServerProtocol 只在 /global/health 失败后才探它",
} as const satisfies Record<RouteKey, string>

type Compiled<Key extends string> = { key: Key; method: string; segments: string[] }

function compile<Key extends string>(keys: readonly Key[]): Compiled<Key>[] {
  return keys.map((key) => {
    const [method, path] = key.split(" ") as [string, string]
    return { key, method, segments: path.split("/").filter(Boolean) }
  })
}

/** 按「方法 + 路径模板」匹配:模板段 `:name` 取一段,`*name` 取余下全部(fs.read 那种带斜杠的路径)。 */
function matcher<Key extends string>(keys: readonly Key[]) {
  const compiled = compile(keys)
  return (method: string, pathname: string): { key: Key; params: Record<string, string> } | undefined => {
    const parts = pathname.split("/").filter(Boolean)
    for (const entry of compiled) {
      if (entry.method !== method) continue
      const params: Record<string, string> = {}
      let ok = true
      for (let index = 0; index < entry.segments.length; index++) {
        const segment = entry.segments[index]!
        if (segment.startsWith("*")) {
          params[segment.slice(1)] = parts.slice(index).map(decodeURIComponent).join("/")
          index = entry.segments.length
          break
        }
        const part = parts[index]
        if (part === undefined) {
          ok = false
          break
        }
        if (segment.startsWith(":")) params[segment.slice(1)] = decodeURIComponent(part)
        else if (segment !== part) {
          ok = false
          break
        }
      }
      if (!ok) continue
      if (!entry.segments.some((segment) => segment.startsWith("*")) && parts.length !== entry.segments.length) continue
      return { key: entry.key, params }
    }
    return undefined
  }
}

const keysOf = <Table extends object>(table: Table) => Object.keys(table) as Array<keyof Table & string>

export const matchServed = matcher(keysOf(SERVED))
export const matchUnsupported = matcher(keysOf(UNSUPPORTED))
export const matchProbeFallback = matcher(keysOf(PROBE_FALLBACK))
export const isFixed = (key: ServedKey): key is keyof typeof FIXED => key in FIXED
