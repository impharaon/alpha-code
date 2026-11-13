// `#1697`(I-04,设计 docs/specs/upgrade-ui-contract/design.md §4.1、§4.3、§4.8):界面与引擎之间的路由目录 —— Code Puppy 自有的约定,
// 代际无关。冻结界面与 Code Puppy 自己的界面经 engineFetch 发出的每个引擎请求,只能落在这里的三张表之一:
//   · SERVED          服务的路由(今天的路由表,不增不减);其中 FIXED 三条由约定侧直答,其余交当前代翻译器(TranslatedKey);
//   · UNSUPPORTED     声明不支持:不会有 handler,运行时 501 + console.error;
//   · PROBE_FALLBACK  探活回退:调用方先试它、失败即回退到已服务的路由,约定侧固定回 501 信封、不记错误日志(UC-19)。
// 三张表都不命中的请求同样 501 + console.error。覆盖由 engine-adapter/routes-coverage.test.ts 从冻结界面与 renderer 的源码扫描来判。
// 目录项的响应 / 请求体类型在 M2b 按设计 §4.3 规则 1、2 填(引用发出它的冻结客户端的生成类型);这里先只定成员。

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
/** "<METHOD> <模板>";`:name` 取一段,`*name` 取余下全部。 */
export type RouteKey = `${Method} /${string}`
/** 目录项只在编译期携带类型。 */
export type Served<Response, Body = undefined> = { readonly __response?: Response; readonly __body?: Body }
const entry = <Response = unknown, Body = unknown>(): Served<Response, Body> => ({})

/** 服务的路由,顺序即匹配顺序(先列的先匹配,如 `GET /session/status` 在 `GET /session/:sessionID` 之前)。 */
export const SERVED = {
  "GET /global/health": entry(),
  "POST /instance/dispose": entry(),
  "GET /global/event": entry(),
  "GET /path": entry(),
  "GET /global/config": entry(),
  "GET /config": entry(),
  "GET /project": entry(),
  "GET /project/current": entry(),
  "GET /api/project/current": entry(),
  "PATCH /project/:projectID": entry(),
  "POST /project/git/init": entry(),
  "GET /session": entry(),
  "GET /experimental/session": entry(),
  "POST /session": entry(),
  "GET /session/status": entry(),
  "GET /session/:sessionID": entry(),
  "PATCH /session/:sessionID": entry(),
  "DELETE /session/:sessionID": entry(),
  "POST /session/:sessionID/fork": entry(),
  "POST /session/:sessionID/abort": entry(),
  "POST /session/:sessionID/prompt_async": entry(),
  "POST /session/:sessionID/command": entry(),
  "POST /session/:sessionID/shell": entry(),
  "POST /session/:sessionID/summarize": entry(),
  "POST /session/:sessionID/revert": entry(),
  "POST /session/:sessionID/unrevert": entry(),
  "GET /session/:sessionID/message": entry(),
  "GET /session/:sessionID/todo": entry(),
  "GET /session/:sessionID/message/:messageID": entry(),
  "GET /agent": entry(),
  "GET /command": entry(),
  "GET /provider": entry(),
  "GET /mcp": entry(),
  "GET /experimental/resource": entry(),
  "GET /vcs": entry(),
  "GET /vcs/status": entry(),
  "GET /vcs/diff": entry(),
  "GET /file": entry(),
  "GET /file/content": entry(),
  "GET /find/file": entry(),
  "POST /mcp/:name/connect": entry(),
  "POST /mcp/:name/disconnect": entry(),
  "POST /api/mcp/:server/connect": entry(),
  "POST /api/mcp/:server/disconnect": entry(),
  "POST /mcp/:name/auth/authenticate": entry(),
  "GET /permission": entry(),
  "POST /permission/:requestID/reply": entry(),
  "POST /session/:sessionID/permissions/:permissionID": entry(),
  "POST /api/session/:sessionID/permission/:requestID/reply": entry(),
  "GET /api/session/:sessionID/permission": entry(),
  "GET /question": entry(),
  "POST /question/:requestID/reply": entry(),
  "POST /question/:requestID/reject": entry(),
  "GET /pty": entry(),
  "POST /pty": entry(),
  "GET /pty/shells": entry(),
  "GET /pty/:ptyID": entry(),
  "PUT /pty/:ptyID": entry(),
  "DELETE /pty/:ptyID": entry(),
  "POST /pty/:ptyID/connect-token": entry(),
  "GET /api/agent": entry(),
  "GET /api/model": entry(),
  "GET /api/provider/:providerID": entry(),
  "GET /api/reference": entry(),
  "GET /api/session": entry(),
  "POST /api/session": entry(),
  "GET /api/session/active": entry(),
  "GET /api/session/:sessionID": entry(),
  "DELETE /api/session/:sessionID": entry(),
  "POST /api/session/:sessionID/model": entry(),
  "POST /api/session/:sessionID/fork": entry(),
  "POST /api/session/:sessionID/interrupt": entry(),
  "POST /api/session/:sessionID/command": entry(),
  "POST /api/session/:sessionID/compact": entry(),
  "POST /api/session/:sessionID/shell": entry(),
  "POST /api/session/:sessionID/rename": entry(),
  "GET /api/fs/find": entry(),
  "GET /api/vcs/status": entry(),
  "GET /api/vcs/diff": entry(),
  "POST /api/pty": entry(),
  "GET /api/pty/:ptyID": entry(),
  "PUT /api/pty/:ptyID": entry(),
  "DELETE /api/pty/:ptyID": entry(),
  "GET /api/integration/:integrationID": entry(),
  "POST /api/integration/:integrationID/connect/key": entry(),
  "POST /api/integration/:integrationID/connect/oauth": entry(),
  "GET /api/integration/:integrationID/connect/oauth/:attemptID": entry(),
  "POST /api/integration/:integrationID/connect/oauth/:attemptID/complete": entry(),
} as const satisfies Record<RouteKey, Served<unknown, unknown>>

export type ServedKey = keyof typeof SERVED

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
