---
id: DESIGN-unattended-run-permissions
title: 没人在场的任务不再空等批准 技术设计
summary: 桌面主进程记着「此刻正在跑的无人值守会话」(本地自动化运行与一句话解析),扩展只在会话带指针、且经既有的主进程↔引擎进程窄消息确认在册时,按自动化载体档位当场裁决(标准档放行未停用的工具,含「每次询问」;只读档与身份变化、已停用一律拒绝),其余询问一律立即拒绝;拒绝原因经结构化字段或引擎已记的拒绝类型由调度器写进运行记录,Code Mode 里的拒绝由扩展补到外层结果上;运行期间连接器的补充信息请求带项目目录立即取消;不改任何上游文件
kind: tech-design
status: draft
spec: SPEC-unattended-run-permissions
spec_version: 1
review:
  rounds: 1           # R1:Codex gpt-6.1-sol xhigh,会话 01a1d2c7,只读,审 46ce5f39f6;BLOCK,1 Blocker + 6 Major,处置见 §10
  reviewed_sha: "46ce5f39f6"
  verdict: ""
owners: [owner]
last_reviewed: 2026-11-13
review_after: 2027-05-13
---

# DESIGN-unattended-run-permissions｜没人在场的任务不再空等批准 技术设计

本文只写决定:契约、落点、失败处理、裁决。改哪些文件、提交顺序与测试归实现会话的 plan.md。§3、§7 已退役,编号不复用。

## 1. 基线

- Spec:[SPEC-unattended-run-permissions v1](https://github.com/impharaon/alpha-code/blob/c01ea14919/docs/specs/unattended-run-permissions/spec.md) @ `c01ea14919`(owner 2026-11-12 批准,规格「批准记录」v1)。
- 覆盖:AC-01 至 AC-08(BR-01 至 BR-06)。BR-06 需要的两句文案规格里没有,见 §10 G-1(补充信息)、G-3(固定拒绝)。
- 背景:INT-upstream-upgrade-readiness I-11;BR-02 的 owner 裁决「放行」。规格的现状盘点基于 `engine/1662-opencode2` @ `713727444b`;本文的事实全部在 `origin/alpha` @ `c01ea14919` 上重核(§2),与盘点不同的一处:项目外目录的「先问」已改为扩展的 agent 变换,且只加给 `build` 与 `codepuppy-ask`(P-04),自动化载体仍是配置里的 deny。

## 2. 地面真相

问题:自动化回合里的每个询问能在哪里当场裁决而不新接管上游文件;裁决原因怎样到达运行记录;谁能把一个有人在场的会话变成「无人值守」。范围:权限内核、扩展工具策略、调度器、一句话解析、MCP 补充信息、会话 metadata、主进程↔引擎进程通道、Code Mode。停止条件:每个决定都找到既有挂点或确认没有。以下均为 `c01ea14919` 上读代码的观察;标「推断」的除外。

| ID | 事实 | 证据 |
| --- | --- | --- |
| P-01 | 审批请求的有界等待:默认 300 s,超时抛 `QuestionTool.CancelledError` 子类,结束这一步。属 ADR-038 已接管面。 | `packages/core/src/permission.ts:97-137`、`:324-344`;`scripts/north-star-guard.sh:132-135` |
| P-02 | 判定顺序:先看已配置规则的 deny(命中即拒,不经插件钩子)→ 合并保存的批准与本会话放行 → 触发插件钩子 `permission.evaluate`(可改 `effect`/`message`)→ 才轮到引擎自己的 `Unattended`。只有最终 `effect === "ask"` 才创建请求、发 `Permission.Event.Asked`(出卡)。钩子给 `deny` ⇒ `BlockedError(reason = message)`。 | `permission.ts:237-263`、`:301-324`、`:315-321` |
| P-03 | 引擎的 `Permission.Unattended` 只在引擎自己的定时检查里提供;会话回合跑在协调器建层时捕获的运行时上,从调用方外面提供不到回合里(观察 + 推断:提供它要接管会话执行或 server 处理器)。 | `packages/core/src/schedule/check.ts:285,310,420`;`packages/server/src/handlers/schedule.ts:35`;`packages/core/src/session/run-coordinator.ts:67`(`FiberSet.makeRuntime`) |
| P-04 | 两个自动化载体:`tool-policy-default: ask`;`read *.env*`、`external_directory`、`question`、`subagent`、`doom_loop` 为 deny;agent 底座 `"*": "allow"`。项目外目录的 ask 只加给 `build`、`codepuppy-ask`。 | `packages/ui-mac/src/main/codepuppy-config-injection.ts:356-378`、`:464-519`;`packages/schema/src/agent.ts:46-51`;`packages/ext/src/external-directory-rule.ts:19-20` |
| P-05 | 询问的三种来源:非内置工具的类别默认是 ask(`reason: default`),`tool-policy-default: ask` 不豁免它;用户设「每次询问」(`reason: user`);用户启用后服务定义变了(`reason: binding-changed`)。停用 = `reason: user` 的 deny;管控/授权/隔离/身份无效是另几种 deny。 | `packages/schema/src/codepuppy-tool-policy.ts:164-166`;`packages/ext/src/policy/catalog.ts:34`、`:49-50`;`packages/ext/src/policy/resolver.ts:61-70`、`:111-144` |
| P-06 | 扩展的闸:链首 `decide`(deny 即具名拒绝)、链尾 `confirm`(身份轴 `permission.assert`,带 `metadata.policy`)、`permission.evaluate` 钩子对 Code Puppy 自己的询问 `holdAsk`(后注册的钩子只能改成 deny)。装扩展工具另有一个 evaluate 钩子,按 agent 前缀 `codepuppy-automation` 判 deny、否则判 ask,注册在策略之后。 | `packages/ext/src/policy/gate.ts:122-167`、`:227-238`;`packages/ext/src/policy/index.ts:145-147`、`:167-182`、`:203-216`;`packages/ext/src/hub-tools.ts:47`、`:56-59` |
| P-07 | 调度器建会话只带 `location/title/agent/model`,不带 metadata;回合结局读最新 `idle`;失败摘要写 `summary` 与 `status.json`;运行历史行显示 `summary`。载体名取自 `AUTOMATION_DEFAULTS`,面板按档位选。全局并发 1。 | `packages/ui-mac/src/main/automation-scheduler.ts:123`、`:165`、`:270-279`、`:307-331`;`packages/ui-mac/src/main/engine-session-turn.ts:14-28`;`packages/ui-mac/src/shared/automation-types.ts:13-24`、`:105-107`;`packages/ui-mac/src/renderer/automations/automation-panel.tsx:296`、`:809-810` |
| P-08 | 一句话解析建临时会话不带 agent(引擎默认 agent `build`,允许 `subagent`),结束删会话。 | `packages/ui-mac/src/main/automation-llm.ts:52`、`:58`、`:78-95`;`packages/core/src/plugin/agent.ts:56-61`、`packages/schema/src/agent.ts:46-51` |
| P-09 | 项目文档里的命令可带 `agent:`,执行时先以会话当前 agent 判一次 `subagent`,再 `switchAgent` —— 「全部批准」档(`build`)直接放行。「全部批准」档提交不带 agent,会话保持原 agent。`subagent` 工具拒绝 `mode: primary` 的 agent(两个载体都是 primary)。 | `packages/core/src/config/plugin/command.ts:115-131`;`packages/ui-mac/src/renderer/codepuppy-ui/composer-state.ts:45-49`;`packages/core/src/tool/plugin/subagent.ts:142-143` |
| P-10 | **(R1 订正)** 会话 metadata 谁都写得进:渲染进程的 `POST /api/session` 原样直通(可带 `agent`、`metadata`),服务端照收;插件可 `session.update`;子会话与分叉复制父会话的 `agent` 与 `metadata`。项目插件拿到的 `permission` 被代理,`reply` 被拒(原稿「插件本来就能 reply」不成立)。引擎 API 的口令只在 main。 | `packages/ui-mac/src/engine-adapter/routes.ts:554`、`:559`;`packages/server/src/handlers/session.ts:102-116`;`packages/plugin/src/promise/adapter.ts:639`;`packages/core/src/session.ts:313`;`packages/core/src/session/projector.ts:175-177`;`packages/ext/src/plugin-fanout.ts:130-150`;`packages/ui-mac/src/main/engine-client.ts:2`、`server.ts:743-746` |
| P-11 | 链上 `Tool.Error` 的 `metadata` 原样落到失败工具的 `state.metadata`(`namedDeny` 的 `codepuppyDisplay` 走的就是这条)。 | `packages/core/src/session/runner/step.ts:124-128`;`packages/core/src/session/runner/publish-llm-event.ts:109-113`、`:350-364`;`packages/schema/src/session-message.ts:156-163`;`gate.ts:80-85` |
| P-12 | 带类型的拒绝(`BlockedError`、`Tool.Error`)是模型看得到的工具失败,回合继续;只有 `DeclinedError` / `CancelledError`(含包在 `Tool.Error.error` 里的)结束这一步,而这两个类只有引擎自己能造出。 | `packages/core/src/session/model-request.ts:418-436`;`step.ts:218-283`;`permission.ts:345-351` |
| P-13 | 补充信息未答复 ⇒ 答给连接器 `{ action: "cancel" }`;取消接口的 `sessionID` 参数是普通字符串。 | `packages/core/src/mcp/index.ts:328-395`;`packages/protocol/src/groups/session.ts:780-783` |
| P-14 | 已批准契约:`[codepuppy:<code>]` 失败码前缀「不新增生产方」。 | `docs/specs/upgrade-fewer-takeovers/design.md:189-195`(契约 C) |
| P-15 | 设置 → 工具 用 `identity.name` 标示一个工具。 | `packages/ui-mac/src/renderer/codepuppy-ui/settings-tools.tsx:560`、`:596` |
| P-16 | 主进程↔引擎进程(Electron utilityProcess 的 `parentPort`)已有一族 `codepuppy.*` 窄消息,一份合同、穷举、build/parse 成对、parse 失败即丢;ext 侧已有按 id 记账、带超时的请求簿记;main 侧在 `child.on("message")` 上挂 `codepuppySidecar.receive(message, post)`。发往 ext 的消息只来自 main;ext → main 的消息只做只读查询(S12)。 | `packages/ui-mac/src/main/codepuppy-sidecar-messages.ts:1-18`;`packages/ext/src/hub-bridge.ts:46-110`、`:147-149`;`packages/ui-mac/src/main/server.ts:128-131`、`:579-580` |
| P-17 | MCP 工具默认进 Code Mode;子调用用外层调用的 `context`,所以子调用的 `execute.before/after` 带外层调用的 `id`;子调用失败变成给程序的 `ToolFailure`,外层结果是成功形状,metadata 只有 `toolCalls`(每行 `tool/status/input`)与 `error`,子调用的 metadata 丢失。ext 已在 `execute.after` 改写调用终态的 metadata。 | `packages/core/src/tool/mcp.ts:67`;`packages/core/src/codemode/tool.ts:30-43`、`:146-152`、`:175-192`;`packages/core/src/tool.ts:127`、`:151`;`packages/ext/src/policy/display.ts:64-104`;`packages/ext/src/policy/index.ts:221-226`;`packages/ext/src/policy/identity.ts:77`(`CODE_MODE_TOOL = "execute"`) |
| P-18 | 已配置的 deny(及插件钩子给的 deny)在工具失败上记为 `state.error.type === "permission.rejected"`:`toSessionError` 逐层拆开 `ToolFailure.error` / `Tool.Error.error`,`BlockedError` ⇒ `permission.rejected`。例:读 `.env` 被拒,`read` 包成 `ToolFailure({ message: "Unable to read …", error: BlockedError })`,落盘类型仍是 `permission.rejected`。 | `packages/core/src/session/to-session-error.ts:79-87`;`packages/core/src/tool/plugin/read.ts:160-170` |
| P-19 | `sessionID === "global"` 的表单请求不查会话行,按查询参数 `location[directory]`、请求头 `x-opencode-directory`、否则引擎进程 cwd 定位;桌面引擎进程的 cwd 是 scratch 目录;客户端以 `{ location: { directory } }` 传位置。 | `packages/server/src/middleware/form-location.ts:26-31`;`packages/server/src/location.ts:71-79`;`packages/ui-mac/src/main/server.ts:551`;`packages/ui-mac/src/engine-adapter/routes.ts:62` |
| P-20 | 本引擎的**全部** MCP 补充信息(表单与 URL 两种)都挂在 `"global"` 上,不归属任何会话;上游注释称其为临时出口、待补会话归属。Code Puppy 正式版的界面(`codepuppy-app`、`codepuppy-session-ui`、`ui-mac` 渲染进程)没有任何 `mcp-elicitation` 的渲染(检索零命中);会渲染它的是上游 `packages/app`,Code Puppy 不用;别的客户端没有引擎口令,连不上桌面引擎。 | `packages/core/src/mcp/index.ts:144-146`、`:343-346`、`:371-374`;`form-location.ts:28-30`;`packages/app/src/session/requests/model.ts:123-129`;`scripts/north-star-guard.sh:107-108`;P-10 口令 |

未核实(有界;plan 的证明表各给一条能失败的证据后即止):

- U-1 `session.form.cancel` 带 `location[directory]` 与 `sessionID: "global"` 端到端取消得了项目里的表单(参数、所有权、定位都已读,未实跑)。
- U-2 闸内裁决含一次 `parentPort` 往返,耗时 < 1 s(本机进程间消息,推断,未量)。
- U-3 Promise 插件 `execute.before` 抛出的 `Tool.Error` 的 `metadata` 经适配器到达 `state.metadata`(P-11 是引擎侧;适配器 `adapter.ts:680-689` 对 `Tool.Error` 原样返回,推断成立)。

## 4. 接口契约

### 4.1 共享定义(schema)

自动化载体、指针、拒绝原因与文案的唯一出处。新文件 `packages/schema/src/codepuppy-unattended.ts`:Code Puppy 自有(north-star 结构谓词:`origin/dev` 无此路径 ∧ basename `codepuppy-*`),只有纯数据与纯函数,与 `codepuppy-tool-policy.ts`、`codepuppy-net-failure.ts` 同包同形。

```ts
import { Schema } from "effect"

/** 自动化载体 agent → 档位。载体名单只在这里(K1);ui-mac 的注入键与 AUTOMATION_DEFAULTS 取自它,ext 据它判档位。 */
export const AUTOMATION_PROFILES = {
  "codepuppy-automation": "readonly",
  "codepuppy-automation-standard": "standard",
} as const satisfies Record<string, "readonly" | "standard">
export type AutomationAgentID = keyof typeof AUTOMATION_PROFILES
/** "none":在册但不是载体(一句话解析跑引擎默认 agent),或运行中途 agent 被换掉。 */
export type UnattendedProfile = (typeof AUTOMATION_PROFILES)[AutomationAgentID] | "none"

/** 会话 metadata 键 —— 只是指针:告诉 ext「值得去问 main」,本身不授予任何东西(§4.2)。 */
export const UNATTENDED_SESSION_KEY = "codepuppyUnattended"
export const UnattendedPointer = Schema.Struct({ version: Schema.Literal(1) })

/** 拒绝原因键:写在工具调用终态的 metadata 上,运行记录据它写原因。 */
export const UNATTENDED_DENIAL_KEY = "codepuppyUnattendedDenial"
export const UnattendedDenial = Schema.Struct({
  version: Schema.Literal(1),
  reason: Schema.Literals(["needs-confirmation", "readonly", "refused"]),
  /** 设置 → 工具 显示的名字(ToolIdentity.name,P-15);引擎工具用其工具名。 */
  tool: Schema.String,
  /** = unattendedDenialCopy(reason, tool);模型与运行记录读同一句。 */
  message: Schema.String,
})
export type UnattendedDenial = typeof UnattendedDenial.Type

/** 文案一、二逐字取自规格「体验约定」;文案三待规格补入(§10 G-3)。 */
export function unattendedDenialCopy(reason: UnattendedDenial["reason"], tool: string): string {
  if (reason === "readonly") return `这个任务是只读档,不能使用「${tool}」。`
  if (reason === "refused") return `自动化任务不能使用「${tool}」做这一步。`
  return `「${tool}」需要你先确认(它的来源发生了变化或已被停用),自动化任务运行时没有人可以确认。到 设置 → 工具 处理后,下次运行即可使用。`
}
```

### 4.2 无人值守的权威:主进程的在册登记(R1 改)

**权威是一件活着的事实,不是会话上的字段**:「这个会话属于一次此刻正在跑的无人值守运行」只由桌面 main 知道,经既有的 `parentPort` 窄消息交给 ext。会话 metadata 里的指针只决定「要不要去问」。

登记簿(ui-mac main,落点由 plan 定):

```ts
/** 此刻在跑的无人值守会话。唯一权威;只在 main 内存里,main 重启即空。 */
type LiveUnattended = Map<string /* sessionID */, { readonly agent?: string /* main 建会话时给的 agent */ }>
```

| 唯一写入口 | 登记 | 注销 |
| --- | --- | --- |
| 本地运行 `executeTask` | `session.create` 返回之后、`promptAndWait` 之前:`set(sessionID, { agent: task.target.agent })`。建会话时同时写指针 `metadata: { [UNATTENDED_SESSION_KEY]: { version: 1 } }` | `finally` |
| 一句话解析 `llmParseAutomation` | 同上,`set(sessionID, {})`(不带 agent ⇒ 档位 none);建会话时另带会话规则 `permissions: [{ action: "subagent", resource: "*", effect: "deny" }]`,不产生子会话(子会话不在册) | `finally`(既有删会话之前) |

窄消息(加入 `codepuppy-sidecar-messages.ts` 的穷举族,build/parse 成对、parse 失败即丢,与族内既有消息同形):

```ts
//   ext → main  codepuppy.unattended.query  只读:这个会话是不是在册
export type UnattendedQuery = { type: "codepuppy.unattended.query"; id: number; sessionID: string }
//   main → ext  codepuppy.unattended.reply  live = 在登记簿里;agent = 登记时的 agent(解析会话不带)
export type UnattendedReply = { type: "codepuppy.unattended.reply"; id: number; live: boolean; agent?: string }
```

main 的应答只读登记簿,同步给出。ext 用 hub-bridge 的同一套按 id 记账与超时(P-16),这一种查询超时 1 s。

ext 判档位(`undefined` = 有人在场,行为与今天相同):

```ts
async function unattendedProfile(
  sessionID: string,
  session: { agent: string; metadata?: Record<string, unknown> },
  requestAgent: string | undefined,
): Promise<UnattendedProfile | undefined> {
  if (Option.isNone(Schema.decodeUnknownOption(UnattendedPointer)(session.metadata?.[UNATTENDED_SESSION_KEY])))
    return undefined                                   // 没有指针:不问 main
  const reply = await bridge.unattended(sessionID)     // 无 parentPort / 超时 / 应答坏 ⇒ 当作不在册
  if (!reply.ok || !reply.live) return undefined
  const agent = requestAgent ?? session.agent          // 与 permission.ts:225 同一取法
  return reply.agent !== undefined && reply.agent === agent && Object.hasOwn(AUTOMATION_PROFILES, agent)
    ? AUTOMATION_PROFILES[agent as AutomationAgentID]
    : "none"
}
```

于是:分叉、子会话、崩溃后恢复的会话、运行结束后的续聊,都有新的会话 id 或已被注销,不在册 ⇒ 今天的行为;伪造的指针只换来一次「不在册」的应答;运行中途被换 agent ⇒ none,只会更严。

### 4.3 判定规则(冻结的规则表;函数名与落点由 plan 定)

以下只在 `unattendedProfile(...) !== undefined`(在册)的会话里生效。

**T1 工具策略的询问与停用(扩展的闸:`decide` / `confirm`,以及无工具调用的同类断言)。** 替代今天的「发身份轴 assert 并等」:

```ts
type GateSubject = {
  readonly effective: EffectiveToolPolicy             // resolver.ts:72-77,本次调用重读
  readonly rulesetAsks: boolean                       // rulesetIdentityEffect(canonical, ruleset) === "ask"(gate.ts:139)
  readonly tool: string                               // facts.identity.name
}
type GateVerdict = { kind: "unchanged" } | { kind: "allow" } | { kind: "deny"; denial: UnattendedDenial }

function unattendedGateVerdict(profile: UnattendedProfile, s: GateSubject): GateVerdict {
  const e = s.effective
  if (e.action === "deny")
    return e.reason.kind === "user" && profile !== "none"
      ? deny("needs-confirmation", s.tool)            // BR-03 已停用 → 文案一
      : { kind: "unchanged" }                         // 管控/授权/隔离/身份无效:今天的具名拒绝
  if (e.action !== "ask" && !s.rulesetAsks) return { kind: "unchanged" } // 已启用:今天就不问
  if (profile === "none") return deny("refused", s.tool)
  if (e.action === "ask" && e.reason.kind === "binding-changed") return deny("needs-confirmation", s.tool) // BR-03
  if (profile === "readonly") return deny("readonly", s.tool)            // BR-04
  if (s.rulesetAsks) return deny("refused", s.tool)                      // 用户/项目配置里写的 ask
  return { kind: "allow" }                            // BR-02:类别默认询问与「每次询问」都放行
}
// deny(r, tool) = { kind: "deny", denial: { version: 1, reason: r, tool, message: unattendedDenialCopy(r, tool) } }
```

执行形状:`deny` 在链上抛 `Tool.Error({ message: denial.message, metadata: { codepuppyDisplay, [UNATTENDED_DENIAL_KEY]: denial } })`;`allow` 不调 `permission.assert`。

| 档位 | 已启用 | 类别默认询问 | 每次询问 | 身份变化 | 已停用 | 配置里的 ask | 其它 deny |
| --- | --- | --- | --- | --- | --- | --- | --- |
| standard | 照旧放行 | **放行** | **放行** | 拒,文案一 | 拒,文案一 | 拒,文案三 | 照旧 |
| readonly | 照旧放行 | 拒,文案二 | 拒,文案二 | 拒,文案一 | 拒,文案一 | 拒,文案二 | 照旧 |
| none | 照旧放行 | 拒,文案三 | 拒,文案三 | 拒,文案三 | 照旧 | 拒,文案三 | 照旧 |

**T2 其余一切求值(扩展的 `permission.evaluate` 钩子;R1 改:不论初值)。** 在册会话里的**每一次**求值,进入 Code Puppy 钩子时就钉住 `effect`(与 `holdAsk` 同一种属性钉法):

- 初值 `ask` ⇒ 当场改 `deny`;
- 此后任何钩子写 `ask` ⇒ 落为 `deny`;写 `deny` ⇒ 生效;写 `allow` ⇒ 不生效;
- 落成 `deny` 时 `message = unattendedDenialCopy(profile === "readonly" ? "readonly" : "refused", action)`。

初值为 `allow` 的也钉:例,解析会话里装扩展的断言初值 `allow`,其后 `hubInstallEvaluate` 写 `ask`(`hub-tools.ts:58`)⇒ 落为 `deny`,不出卡。初值 `deny` 的照旧;今天 Code Puppy 钩子给出的拒绝照旧。已配置的 deny 根本到不了钩子(P-02),AC-04 的三项原样且即时。

### 4.4 拒绝原因 → 运行记录(R1 改)

**Code Mode 里的拒绝(ext):** 在册会话里,ext 记下它在一次 Code Mode 调用(`CODE_MODE_TOOL`,该调用尚未结束)的 id 之下给出的第一条拒绝(T1 抛出的 `denial`;T2 以请求的 `source.id` 归到同一 id,原因同 T2 文案)。这次 Code Mode 调用到达 `execute.after` 时,把这条拒绝写进它终态的 `metadata[UNATTENDED_DENIAL_KEY]`:成功写 `result.metadata`,失败写 `error.metadata`。做法与 `attachTerminal` / `attachNetFailure` 相同(P-17)。不改上游 Code Mode。

**调度器投影(规则冻结):** 输入是这次运行会话的全部消息(会话为本次新建;回合成功、失败、中断都读)。按时间顺序取第一个满足下列之一的工具调用:

- (a) 任意终态,`Schema.decodeUnknownOption(UnattendedDenial)(part.state.metadata?.[UNATTENDED_DENIAL_KEY])` 为 Some ⇒ 原因 = `denial.message`(T1 直接调用、Code Mode 外层);
- (b) `part.state.status === "error" && part.state.error.type === "permission.rejected"` ⇒ 原因 = `unattendedDenialCopy(profile === "readonly" ? "readonly" : "refused", part.name)`。`profile = AUTOMATION_PROFILES[task.target.agent]`。覆盖已配置的 deny(读 `.env`、派子任务、项目外目录、只读档的写入与命令、标准档的破坏类命令)与 T2 的直接调用拒绝(P-18)。今天记下的类型已能区分,不加新标记。

命中且不是这次运行的超时 ⇒ 运行记录 `status: "failed"`、`summary: <原因>`;`status.json` 的 `status: "failed"`、`error: <原因>`;回合成功时 `report.md` 照写。未命中,且本次运行取消过补充信息表单(§4.5),且回合没有成功 ⇒ 同上,原因 = G-1 句(连接器名 = 表单 `metadata.server`;待规格补句后生效)。其余与今天完全相同;超时照旧记 `timeout`。

不新增 `reasonCode` 与界面文案:历史行显示 `summary`(P-07),即规格说的「已有的失败原因一行」。连败熔断照旧计入。

### 4.5 连接器补充信息(BR-05;R1 改)

- 生产方:ui-mac main 调度器,只在一次本地运行在册期间(§4.2 登记到注销)。
- 对象:这次运行的项目(`task.target.projectDir`)里 `metadata.kind === "mcp-elicitation"` 的待答表单。
- 动作:`form.list` 与 `session.form.cancel({ sessionID: form.sessionID /* "global" */, formID: form.id })` 都带 `location: { directory: task.target.projectDir }`。中间件据此定位(P-19);不带就落到引擎进程的 scratch cwd,找不到表单。引擎把取消答给连接器为 `{ action: "cancel" }`(P-13)。
- 时限:表单出现起 1 s 内。发现方式(引擎事件流或轮询表单列表)由 plan 定。
- 错误:已结束/不存在忽略;其它错误记日志,不改变运行结局。
- 归属:本引擎没有任何补充信息带会话归属(P-20),真实连接器全部落在这一种。按项目取消是能做到的最小归属。同一项目里有人在场会话的同类表单也会被取消,但正式版没有任何界面能显示或回答它们,也没有别的客户端连得上(P-20)。被取消的只是一个本来会挂到工具被中止的表单。R1 F5 的「有人正在另一客户端作答」在正式版不可达,见 §10。

### API

不新增 HTTP 接口。用既有接口:`session.create` 的 `metadata` 与 `permissions`、`message.list`、`form.list`、`session.form.cancel`;以及 §4.2 的一对 `parentPort` 窄消息(进程内通道,不是 HTTP)。

### 数据

无表结构与迁移。两个新键都在引擎不解读的 metadata 里(会话 metadata 的指针、调用终态 metadata 的拒绝);登记簿只在 main 内存。

### 事件 / 配置

不新增配置。300 s 默认与 `CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS` 不变(只作用于不在册的会话)。查询超时 1 s 是固定常量,不是选项。

| 配置键 | 类型 | 默认 | 必填 | 读取入口 |
| --- | --- | --- | --- | --- |
| 无 | — | — | — | — |

### AC 覆盖

| AC | 由哪条契约成立 |
| --- | --- |
| AC-01 | 已启用 ⇒ 今天就不问;类别默认询问 ⇒ T1 standard 放行,不调 assert,无请求 |
| AC-02 | 每次询问 ⇒ T1 standard 放行 |
| AC-03 | T1 readonly ⇒ 文案二 + 4.4 (a);Code Mode 里同样经外层 metadata |
| AC-04 | 已配置的 deny 先于钩子(P-02),拒绝本身不改;记录经 4.4 (b)(文案三待 G-3) |
| AC-05 | 4.5(带项目目录) |
| AC-06 | §6 I-4:没有指针或不在册的会话不进入任何新分支,`permission.ts` 不改 |
| AC-07 | 解析会话在册、档位 none ⇒ T1/T2 一律立即拒绝(含初值 allow 被后续钩子改成 ask 的);不产生子会话 |
| AC-08 | T1 身份变化/已停用 ⇒ 文案一 + 4.4 (a)(已停用的那一支见 §10 O-1) |

## 5. 数据与失败

- 登记发生在 `session.create` 返回之后、发 prompt 之前。回合里的任何判定都晚于登记,没有「已在跑、未在册」的窗口。注销在 `finally`。
- main 重启或引擎进程重启:登记簿为空或 ext 拿到的都是「不在册」。只会回到今天的询问与 300 s,不会放宽。
- 查询失败(无 `parentPort`、超时 1 s、应答形状不对):当作不在册,同上。
- 指针解不开、ext 读会话失败:当作没有指针(读会话失败时引擎随后的 `configured()` 本来就报 NotFound,`permission.ts:222-224`)。
- 投影读消息失败:记日志,运行记录按今天的规则写,不阻断。
- 表单取消竞态:表单已被答复或已结束 ⇒ 忽略。

## 6. 架构落点

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| 4.1 共享定义 | `packages/schema/`(「共享 schema、权限和工具分类」,`modules.md:41`) | 无 | 同包先例 `codepuppy-tool-policy.ts`、`codepuppy-net-failure.ts` |
| 4.2 登记簿、两个写入口、查询应答 | `packages/ui-mac/` main | ui-mac → schema(既有 `@opencode/schema/*` 引入) | `executeTask`、`llmParseAutomation`;`codepuppySidecar.receive`(`server.ts:128-131`) |
| 4.2 消息对 | `packages/ui-mac/src/main/codepuppy-sidecar-messages.ts`(两侧共用的唯一合同,ext 经相对路径引入,既有先例) | 无 | 同族既有消息 |
| 4.2 查询、4.3 T1/T2、4.4 Code Mode 补记 | `packages/ext/` 工具策略 | ext → schema、→ 消息合同(既有相对路径引入) | `decide`/`confirm`(`gate.ts:122-167`)、`EffectiveToolPolicy`(`resolver.ts:72-77`)、`permission.evaluate` 挂点(`permission.ts:243-251`)、`holdAsk` 钉法(`gate.ts:227-238`)、hub-bridge 请求簿记(`hub-bridge.ts:46-110`)、`execute.after` 改写(`display.ts:64-104`) |
| 4.4 投影、4.5 取消 | `packages/ui-mac/` main 调度器 | ui-mac → schema、引擎客户端 | `promptAndWait`、`AutomationRunRecord` |
| 载体名取值 | ui-mac 的 `AUTOMATION_DEFAULTS.agent/agentStandard` 与注入里两个自动化 agent 的键 | ui-mac → schema | 4.1 `AUTOMATION_PROFILES` |
| 决定登记 | `docs/architecture/codepuppy-authority-registry.json` 新增一条 held 条目(无接管) | — | 登记簿「一条决定一条」(判官 `authority-registry.test.ts`) |

- 新目录/新模块:无。`modules.md` 不变。
- 上游文件:**不改任何上游文件,不新增接管**,无需 owner 级架构例外。已接管的 `permission.ts`(ADR-038)与 `mcp/index.ts`(ADR-041)都不碰。ADR-038 的「无人应答到期具名失败、绝不自动放行」对不在册的会话原样成立:在册会话根本不创建请求,标准档的放行来自规格 BR-02 的 owner 裁决,不是到期放行。
- 架构约束:K1 **变好**:两个自动化载体的名单与档位只定义一次,做判定的 ext 读得到。实现时同 PR 更新 `constraints.md` 的 K1 行;`CODEPUPPY_INJECTED_AGENTS` 与 `hub-tools.ts:47` 的前缀判断不在范围,见 O-4。K2 不变:文案只在 4.1 一处,不再复述引擎原句。契约 C(P-14)遵守:不写 `[codepuppy:…]` 前缀,原因走结构化 metadata 与引擎已有的错误类型。
- 工程标准:第 5 条,调用方读结构化字段与引擎的错误类型,不解析文案;不新增错误框架、不新增配置。
- 被否决的替代:
  - 把引擎的 `Permission.Unattended` 提供到回合里:回合跑在捕获的运行时上(P-03),要接管会话执行或 server 处理器(新接管),而插件钩子就在它前一行(P-02)。
  - 扩展已接管的 `permission.ts`(在册即 0 秒到期 / 结束这一步):仍会先建请求出卡,且扩大 ADR-038 登记的接管面;挂点已够。
  - 只按 agent 或只按会话 metadata 判无人值守(原稿 R-02,R1 F1/F2 否决):项目命令能切 agent(P-09),渲染进程直通、插件 `session.update`、分叉都能写或复制 metadata(P-10);到期时间证明不了运行还活着。
  - main 主动推送在册集合:推送与 prompt 走两条通道,先后无保证;查询在判定当时读 main 的权威,无竞态。
  - 拒绝时结束这一步(回合中断):插件造不出引擎的 `CancelledError`(P-12),只能接管内核;记录改由投影。
  - 改上游 Code Mode 保留子调用 metadata:要新接管;ext 在外层 `execute.after` 补记即可(P-17)。
  - 在 `mcp/index.ts` 里处理补充信息,或自建补充信息归属:表单不归属任何会话(P-20),要扩大接管面或另建归属设施。
- 安全面(权限):
  - 威胁边界:授予无人值守裁决的只有 main 的登记簿。**渲染进程**能经 `POST /api/session` 直通写 `agent`、`metadata`(P-10),**项目插件**能 `session.update`,**分叉/子会话**会复制指针。这些都进不了登记簿,只换来一次「不在册」。**模型**没有写 metadata 或登记簿的途径,`subagent` 拒绝 primary 载体。**项目文档**能切 agent、改规则,同样进不了登记簿。引擎进程里的 JS 若在语言层篡改 `parentPort` 对象或 ext 模块状态,不在本边界内,与 ext 现有的每个决定、hub-bridge(S12)相同。
  - I-1 登记簿只有两个写入口:`executeTask`、`llmParseAutomation`。登记在发 prompt 之前,注销在 `finally`;ext 只经 `codepuppy.unattended.query/reply` 读它。
  - I-2 在册会话里不创建任何审批请求(零 `Permission.Event.Asked`)。
  - I-3 判定只把「询问」改成放行或拒绝:已配置的 deny 先于钩子、策略的 deny 不放宽;readonly 与 none 对询问从不放行。
  - I-4 没有指针的会话不发查询,Code Puppy 的钩子与闸逐字节不变;有指针但不在册的,一次查询之后同样不变;`permission.ts` 不改 ⇒ AC-06。
  - I-5 档位只来自登记时的 agent,且须与本次请求的 agent 一致;不一致 ⇒ none。
  - I-6 在册会话里,不论初值,后续钩子只能把结果改成拒绝。
  - I-7 分叉、子会话、恢复的会话、运行结束后的续聊都不在册。

## 8. 拆分决定

不适用:单仓(alpha-code),无归属拆分。

## 9. 回滚

不适用(非 L、无迁移)。回退代码后,已写入会话的指针是引擎不解读的 metadata,没有副作用;自动化回到今天的 300 s 行为。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| R-01 机制:扩展的闸与 evaluate 钩子当场裁决;不改上游文件 | P-02、P-03、P-06;`c01ea14919` |
| R-02(R1 改)无人值守的权威 = main 的在册登记,经既有 `parentPort` 窄消息查询;会话 metadata 只作指针 | R1 F1/F2;P-10、P-16 |
| R-03 档位由登记时的 agent 经 `AUTOMATION_PROFILES` 决定,且须与本次请求的 agent 一致 | K1;防中途换 agent 放宽 |
| R-04 规则表(4.3):「启用状态」读作「未停用」,类别默认询问与「每次询问」在 standard 一并放行 | 推断:BR-03 是封闭的拒绝清单且不含默认询问;AC-01 的「未单独设为询问」即默认状态;R1 无反对证据 |
| R-05 配置里写的 ask 与其余询问在在册会话里立即拒绝,文案三(只读档用文案二) | BR-02 只说设置 → 工具;引擎自己的无人值守语义也是拒绝(`permission.ts:252-262`) |
| R-06 拒绝是带类型的工具失败(模型继续);运行记录经结构化原因或 `permission.rejected` 记为失败并写文案 | P-11、P-12、P-14、P-18;AC-03/AC-08、BR-06 |
| R-07 补充信息由 main 在运行在册期间按项目、带目录立即取消 | P-19、P-20 |
| R-08 一句话解析在册、档位 none,会话规则禁止子会话 | AC-07;P-08 |
| R-09 不新增配置、`reasonCode`、界面文案 | 规格「不新增界面」;历史行已显示 `summary`(P-07) |

| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| R1 · `46ce5f39f6` · 全稿,对 spec v1 | Codex gpt-6.1-sol xhigh,只读,会话 `01a1d2c7-7cdd-7832-ac11-e2a3bc6ca786`;编排器处置 | **F1 Blocker 标记可伪造**:采纳。另订正原稿依据:项目插件的 `reply` 实际被拒(`plugin-fanout.ts:130-150`) | §4.2 改为 main 在册登记 + 窄消息查询,metadata 只作指针;P-10 订正、P-16 新增;§6 安全面 I-1/I-4/I-5/I-7 | — |
| 同上 | 同上 | **F2 Major 真标记越过运行生命周期**(分叉复制 `agent`+`metadata`,`projector.ts:175-177`;崩溃恢复):采纳 | 同 F1;去掉到期时间与收回;I-7 | — |
| 同上 | 同上 | **F3 Major T2 漏掉 allow→ask**(解析会话 + `hub-tools.ts:58`):采纳 | §4.3 T2 改为不论初值都钉;I-6 | — |
| 同上 | 同上 | **F4 Major global 取消缺 Location**(`form-location.ts:26-31` → `location.ts:71-79`,cwd = scratch,`server.ts:551`):采纳 | §4.5 列表与取消都带 `location.directory`;P-19;U-1 改为带目录的端到端证据 | — |
| 同上 | 同上 | **F5 Major 按项目取消会改变交互会话**:前提一半成立。同项目有人在场会话的表单确实也会被取消。「有人正在另一客户端作答」在正式版不可达:正式版界面零渲染,上游 `packages/app` 不随 Code Puppy 发布,别的客户端无引擎口令。另,本引擎的补充信息**全部**不可归属(P-20)。按 F5 收窄,AC-05 将对所有真实连接器都不成立。 | §4.5 保留按项目取消,补「归属」说明与 P-20 证据 | 交编排器裁:若仍按收窄,用 G-2 替换 §4.5 |
| 同上 | 同上 | **F6 Major Code Mode 吞掉结构化拒绝**(`mcp.ts:67`;`codemode/tool.ts:152`、`:189`):采纳 | §4.4 ext 在外层 Code Mode 调用的 `execute.after` 补记第一条拒绝;投影读任意终态;P-17 | — |
| 同上 | 同上 | **F7 Major BR-03 既有 deny 没有记录原因**(`permission.ts:239`;`read.ts:160`):采纳。今天记下的 `permission.rejected` 已能与普通工具错误区分(`to-session-error.ts:79-87`),不加新标记 | §4.4 (b);P-18;文案三待规格(G-3) | G-3 交编排器补规格 |

本轮改动的小节(确认轮只看这些及其直接后果):frontmatter(summary、review)、§1 覆盖行、§2(P-07 证据、P-08、P-10 订正、P-13 收窄、P-16 至 P-20、U-1、U-2)、§4.1(指针、`refused`、文案三)、**§4.2 全节**、§4.3(T1 原句换文案三;**T2 全段**)、**§4.4 全节**、**§4.5 全节**、§4 API/数据/配置、AC 覆盖、§5、§6(落点表、被否决的替代、**安全面全段**)、§10。F1/F2 的确认轮核心:§4.2、§6 安全面,直接后果 §4.3 T2、§5。

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| G-1(规格缺口)BR-06 要求 BR-05 失败的那一步写原因,体验约定没有这一句。建议补:「「<连接器名>」要补充信息,运行时没人能填。」 | §4.4 已按此句设好生效条件(本次运行取消过表单且回合没成功) | 文案归规格 | 编排器补进规格后生效 |
| G-2(备用规格缺口,仅当编排器仍按 F5 收窄时启用)「AC-05 只对能归属到本次运行的补充信息成立;不能归属的,运行在既有时限结束。」本引擎全部补充信息都不能归属(P-20),启用即意味着 AC-05 对所有真实连接器都不成立 | 用它替换 §4.5,G-1 随之作废 | 证据表明按项目取消在正式版不伤有人在场的作答(F5 行) | 编排器或 owner 裁收窄 |
| G-3(规格缺口)BR-06 要求 BR-03 固定拒绝(读 `.env`、派子任务、项目外目录等)写「工具名和放行办法」。这些没有放行办法,体验约定的两句都不适用。建议补:「自动化任务不能使用「<工具名>」做这一步。」 | 文案三;只读档仍用文案二 | 文案归规格 | 编排器补进规格 |
| O-1 AC-08 的「已停用」一支:已停用的工具不出现在模型的工具清单里(`catalog.ts:1-17`,F6 既有),常见情形是模型根本不调用、回合可能成功、记录没有失败行 | 只有调用真的到达闸时(按名调用、清单与停用之间的竞态)才出文案一 | 让模型看见停用工具会推翻 F6 裁决,超出规格(BR-03「本规格不改」) | owner 要求「任务需要已停用的工具时也写原因」 |
| O-2 AC-03 的「写入类连接器工具」:系统没有连接器工具的读写分类(`risk.ts` 无 MCP 写入规则);用户在设置里启用过的连接器工具,只读档今天就直接执行(载体规则无 `mcp:*`,P-04;R1 核对一致) | AC-03 对未启用(默认询问/每次询问)的连接器工具成立;已启用的照旧执行 | BR-04「只读档不变」 | owner 要求只读档拒绝一切连接器工具 |
| O-3 项目文档可在后加载的层给载体 agent 追加规则(`config/plugin/agent.ts:74-103`),加载先后未核实 | 可能放宽载体的静态规则;本设计不读规则定档位,放行只作用于询问,不碰已配置的 deny | 既有面,与本规格无关 | 另有证据表明项目层排在注入层之后 |
| O-4 `hub-tools.ts:47` 按前缀判自动化载体 | K1/K2 的又一份载体知识 | 不在本 AC 内;在册时 T2 已兜住 | 下一次改载体名单 |
| O-5 运行在册期间,用户在「全部批准」档往这个正在跑的自动化会话里发话,按无人值守裁决(该档不带 agent,P-09) | 只到运行注销为止;会话此时正忙于本次运行 | 登记簿已把窗口压到运行本身 | 出现真实反馈 |
