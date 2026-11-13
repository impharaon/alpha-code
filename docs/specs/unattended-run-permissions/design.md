---
id: DESIGN-unattended-run-permissions
title: 没人在场的任务不再空等批准 技术设计
summary: 调度器建的自动化会话(含一句话解析)带一个只有主进程写得进的无人值守标记;扩展的工具策略闸按会话的自动化载体档位当场裁决(标准档放行未停用的工具,含「每次询问」;只读档与身份变化、已停用一律拒绝),其余询问在这类会话里一律立即拒绝;拒绝原因以结构化字段落在工具失败上,由调度器写进运行记录;连接器的补充信息请求在运行期间由主进程立即取消;不改任何上游文件
kind: tech-design
status: draft
spec: SPEC-unattended-run-permissions
spec_version: 1
review:
  rounds: 0
  reviewed_sha: ""
  verdict: ""
owners: [owner]
last_reviewed: 2026-11-12
review_after: 2027-05-12
---

# DESIGN-unattended-run-permissions｜没人在场的任务不再空等批准 技术设计

本文只写决定:契约、落点、失败处理、裁决。改哪些文件、提交顺序与测试归实现会话的 plan.md。§3、§7 已退役,编号不复用。

## 1. 基线

- Spec:[SPEC-unattended-run-permissions v1](https://github.com/impharaon/alpha-code/blob/c01ea14919/docs/specs/unattended-run-permissions/spec.md) @ `c01ea14919`(owner 2026-11-12 批准,规格「批准记录」v1)。
- 覆盖:AC-01 至 AC-08(BR-01 至 BR-06)。BR-06 对 BR-05 的那一半没有文案,见 §10 G-1。
- 背景:INT-upstream-upgrade-readiness I-11;BR-02 的 owner 裁决「放行」。规格的现状盘点基于 `engine/1662-opencode2` @ `713727444b`;本文的事实全部在 `origin/alpha` @ `c01ea14919` 上重核(§2),与盘点不同的一处:项目外目录的「先问」已改为扩展的 agent 变换,且只加给 `build` 与 `codepuppy-ask`(P-04),自动化载体仍是配置里的 deny。

## 2. 地面真相

问题:自动化回合里的每个询问能在哪里当场裁决而不新接管上游文件;裁决原因怎样到达运行记录;谁能把一个有人在场的会话变成「无人值守」。范围:权限内核、扩展工具策略、调度器、一句话解析、MCP 补充信息、会话 metadata。停止条件:每个决定都找到既有挂点或确认没有。以下均为 `c01ea14919` 上读代码的观察;标「推断」的除外。

| ID | 事实 | 证据 |
| --- | --- | --- |
| P-01 | 审批请求的有界等待:默认 300 s,超时抛 `QuestionTool.CancelledError` 子类,结束这一步。属 ADR-038 已接管面。 | `packages/core/src/permission.ts:97-137`、`:324-344`;`scripts/north-star-guard.sh:132-135` |
| P-02 | 判定顺序:先看已配置规则的 deny(命中即拒,不经插件钩子)→ 合并保存的批准与本会话放行 → 触发插件钩子 `permission.evaluate`(可改 `effect`/`message`)→ 才轮到引擎自己的 `Unattended`。只有最终 `effect === "ask"` 才创建请求、发 `Permission.Event.Asked`(出卡)。钩子给 `deny` ⇒ `BlockedError(reason = message)`。 | `permission.ts:237-263`、`:301-324`、`:315-321` |
| P-03 | 引擎的 `Permission.Unattended` 只在引擎自己的定时检查里提供;会话回合跑在协调器建层时捕获的运行时上,从调用方外面提供不到回合里(观察 + 推断:提供它要接管会话执行或 server 处理器)。 | `packages/core/src/schedule/check.ts:285,310,420`;`packages/server/src/handlers/schedule.ts:35`;`packages/core/src/session/run-coordinator.ts:67`(`FiberSet.makeRuntime`) |
| P-04 | 两个自动化载体:`tool-policy-default: ask`;`read *.env*`、`external_directory`、`question`、`subagent`、`doom_loop` 为 deny;agent 底座 `"*": "allow"`。项目外目录的 ask 只加给 `build`、`codepuppy-ask`。 | `packages/ui-mac/src/main/codepuppy-config-injection.ts:356-378`、`:464-519`;`packages/schema/src/agent.ts:46-51`;`packages/ext/src/external-directory-rule.ts:19-20` |
| P-05 | 询问的三种来源:非内置工具的类别默认是 ask(`reason: default`),`tool-policy-default: ask` 不豁免它;用户设「每次询问」(`reason: user`);用户启用后服务定义变了(`reason: binding-changed`)。停用 = `reason: user` 的 deny;管控/授权/隔离/身份无效是另几种 deny。 | `packages/schema/src/codepuppy-tool-policy.ts:164-166`;`packages/ext/src/policy/catalog.ts:34`、`:49-50`;`packages/ext/src/policy/resolver.ts:61-70`、`:111-144` |
| P-06 | 扩展的闸:链首 `decide`(deny 即具名拒绝)、链尾 `confirm`(身份轴 `permission.assert`,带 `metadata.policy`)、`permission.evaluate` 钩子对 Code Puppy 自己的询问 `holdAsk`(后注册的钩子只能改成 deny)。装扩展工具另有一个 evaluate 钩子,按 agent 前缀 `codepuppy-automation` 判 deny、否则判 ask,注册在策略之后。 | `packages/ext/src/policy/gate.ts:122-167`、`:227-238`;`packages/ext/src/policy/index.ts:145-147`、`:167-182`、`:203-216`;`packages/ext/src/hub-tools.ts:47`、`:56-59` |
| P-07 | 调度器建会话只带 `location/title/agent/model`,不带 metadata;回合结局读最新 `idle`;失败摘要写 `summary` 与 `status.json`;运行历史行显示 `summary`。载体名取自 `AUTOMATION_DEFAULTS`,面板按档位选。全局并发 1。 | `packages/ui-mac/src/main/automation-scheduler.ts:270-279`、`:307-331`;`packages/ui-mac/src/main/engine-session-turn.ts:14-28`;`packages/ui-mac/src/shared/automation-types.ts:13-24`、`:105-107`;`packages/ui-mac/src/renderer/automations/automation-panel.tsx:296`、`:809-810` |
| P-08 | 一句话解析建临时会话不带 agent(引擎默认 agent),结束删会话。 | `packages/ui-mac/src/main/automation-llm.ts:52`、`:58`、`:78-95` |
| P-09 | 项目文档里的命令可带 `agent:`,执行时先以会话当前 agent 判一次 `subagent`,再 `switchAgent` —— 「全部批准」档(`build`)直接放行。「全部批准」档提交不带 agent,会话保持原 agent。`subagent` 工具拒绝 `mode: primary` 的 agent(两个载体都是 primary)。 | `packages/core/src/config/plugin/command.ts:115-131`;`packages/ui-mac/src/renderer/codepuppy-ui/composer-state.ts:45-49`;`packages/core/src/tool/plugin/subagent.ts:142-143` |
| P-10 | 会话 metadata:宿主写、引擎不解读;子会话与分叉继承父会话的 metadata。`session.create` 收 `metadata`。渲染进程经引擎适配器建/改会话只转 `parentID/title/archived`。引擎 API 的口令只在 main。插件可 `session.update`,也可 `permission.reply` 任意待答请求。 | `packages/schema/src/session-metadata.ts:3-10`;`packages/core/src/session.ts:313`;`packages/core/src/session/projector.ts:177`;`packages/server/src/handlers/session.ts:102-116`;`packages/ui-mac/src/engine-adapter/routes.ts:258-282`;`automation-scheduler.ts:246`;`packages/plugin/src/promise/adapter.ts:484`、`:639` |
| P-11 | 链上 `Tool.Error` 的 `metadata` 原样落到失败工具的 `state.metadata`(`namedDeny` 的 `codepuppyDisplay` 走的就是这条)。 | `packages/core/src/session/runner/step.ts:124-128`;`packages/core/src/session/runner/publish-llm-event.ts:109-113`、`:350-364`;`packages/schema/src/session-message.ts:156-163`;`gate.ts:80-85` |
| P-12 | 带类型的拒绝(`BlockedError`、`Tool.Error`)是模型看得到的工具失败,回合继续;只有 `DeclinedError` / `CancelledError`(含包在 `Tool.Error.error` 里的)结束这一步,而这两个类只有引擎自己能造出。 | `packages/core/src/session/model-request.ts:418-436`;`step.ts:218-283`;`permission.ts:345-351` |
| P-13 | MCP 补充信息按 Location 而不按会话:表单的 `sessionID` 恒为 `"global"`,等到有人答复或 MCP 请求被中止;未答复 ⇒ 答给连接器 `{ action: "cancel" }`。桌面只把 `metadata.kind === "question"` 的表单交给界面,`mcp-elicitation` 表单今天没有人能答。取消接口的 `sessionID` 参数是普通字符串,只校验与表单的 `sessionID` 相等。 | `packages/core/src/mcp/index.ts:144-146`、`:328-395`;`packages/ui-mac/src/engine-adapter/v1-shapes.ts:388-390`;`packages/protocol/src/groups/session.ts:780-783`;`packages/server/src/handlers/session.ts:45-50`、`:698-708` |
| P-14 | 已批准契约:`[codepuppy:<code>]` 失败码前缀「不新增生产方」。 | `docs/specs/upgrade-fewer-takeovers/design.md:189-195`(契约 C) |
| P-15 | 设置 → 工具 用 `identity.name` 标示一个工具。 | `packages/ui-mac/src/renderer/codepuppy-ui/settings-tools.tsx:560`、`:596` |

未核实(有界;plan 的证明表各给一条能失败的证据后即止):

- U-1 `session.form.cancel` 以 `sessionID: "global"` 经 `formLocationMiddleware` 端到端成功(只读了参数与所有权校验,未实跑)。
- U-2 闸内裁决耗时 < 1 s(全是本进程/本机调用,推断,未量)。
- U-3 Promise 插件 `execute.before` 抛出的 `Tool.Error` 的 `metadata` 经适配器到达 `state.metadata`(P-11 是引擎侧;适配器 `adapter.ts:680-689` 对 `Tool.Error` 原样返回,推断成立)。

## 4. 接口契约

### 4.1 共享定义(schema)

自动化载体、标记、拒绝原因与文案的唯一出处。新文件 `packages/schema/src/codepuppy-unattended.ts`:Code Puppy 自有(north-star 结构谓词:`origin/dev` 无此路径 ∧ basename `codepuppy-*`),只有纯数据与纯函数,与 `codepuppy-tool-policy.ts`、`codepuppy-net-failure.ts` 同包同形。

```ts
import { Schema } from "effect"
import { PositiveInt } from "./schema.js"

/** 自动化载体 agent → 档位。载体名单只在这里(K1);ui-mac 的注入键与 AUTOMATION_DEFAULTS 取自它,ext 据它判档位。 */
export const AUTOMATION_PROFILES = {
  "codepuppy-automation": "readonly",
  "codepuppy-automation-standard": "standard",
} as const satisfies Record<string, "readonly" | "standard">
export type AutomationAgentID = keyof typeof AUTOMATION_PROFILES
/** "none":标记有效但 agent 不是载体(一句话解析跑引擎默认 agent;其子会话)。 */
export type UnattendedProfile = (typeof AUTOMATION_PROFILES)[AutomationAgentID] | "none"

/** 会话 metadata 键。只由 ui-mac main 在 session.create 时写(§6 I-1)。 */
export const UNATTENDED_SESSION_KEY = "codepuppyUnattended"
export const UnattendedMarker = Schema.Struct({
  version: Schema.Literal(1),
  /** UTC 毫秒;到点(含)起标记作废。 */
  expiresAt: PositiveInt,
})
export type UnattendedMarker = typeof UnattendedMarker.Type

/** 工具失败 metadata 键:运行记录要写出的拒绝。 */
export const UNATTENDED_DENIAL_KEY = "codepuppyUnattendedDenial"
export const UnattendedDenial = Schema.Struct({
  version: Schema.Literal(1),
  reason: Schema.Literals(["needs-confirmation", "readonly"]),
  /** 设置 → 工具 显示的名字(ToolIdentity.name,P-15)。 */
  tool: Schema.String,
  /** = unattendedDenialCopy(reason, tool);模型与运行记录读同一句。 */
  message: Schema.String,
})
export type UnattendedDenial = typeof UnattendedDenial.Type

/** 规格「体验约定」的两句文案,逐字。 */
export function unattendedDenialCopy(reason: UnattendedDenial["reason"], tool: string): string {
  return reason === "readonly"
    ? `这个任务是只读档,不能使用「${tool}」。`
    : `「${tool}」需要你先确认(它的来源发生了变化或已被停用),自动化任务运行时没有人可以确认。到 设置 → 工具 处理后,下次运行即可使用。`
}
```

### 4.2 标记:谁写、何时作废、怎样读

写方只有 ui-mac main:

| 入口 | 写入 | 收回 |
| --- | --- | --- |
| 本地运行 `executeTask` | `session.create({ …, metadata: { [UNATTENDED_SESSION_KEY]: { version: 1, expiresAt: 建会话前的 Date.now() + task.budget.maxDurationMin * 60_000 } } })` —— 到期点就是这次运行既有的强制中断点 | `finally` 里去掉这个键、保留其余键写回;失败记日志,由到期兜底 |
| 一句话解析 `llmParseAutomation` | 同形;`expiresAt = Date.now() + AUTOMATION_DEFAULTS.maxDurationMin * 60_000`(既有常量,不新增) | 既有的 `finally` 删除会话 |

读方是 ext,判出本次请求的档位(`undefined` = 有人在场,行为与今天逐字节相同):

```ts
function unattendedProfile(
  session: { agent: string; metadata?: Record<string, unknown> },
  requestAgent: string | undefined,
  now: number,
): UnattendedProfile | undefined {
  const marker = Schema.decodeUnknownOption(UnattendedMarker)(session.metadata?.[UNATTENDED_SESSION_KEY])
  if (Option.isNone(marker) || marker.value.expiresAt <= now) return undefined
  const agent = requestAgent ?? session.agent // 与 permission.ts:225 同一取法
  return Object.hasOwn(AUTOMATION_PROFILES, agent) ? AUTOMATION_PROFILES[agent as AutomationAgentID] : "none"
}
```

标记不带档位:档位只由 agent 决定,伪造标记得不到比该 agent 的档位更宽的结果。

### 4.3 判定规则(冻结的规则表;函数名与落点由 plan 定)

**T1 工具策略的询问与停用(扩展的闸:`decide` / `confirm`,以及无工具调用的同类断言)。** 在 `unattendedProfile(...) !== undefined` 的会话里替代今天的「发身份轴 assert 并等」:

```ts
type GateSubject = {
  readonly effective: EffectiveToolPolicy             // resolver.ts:72-77,本次调用重读
  readonly rulesetAsks: boolean                       // rulesetIdentityEffect(canonical, ruleset) === "ask"(gate.ts:139)
  readonly tool: string                               // facts.identity.name
  readonly canonical: string
}
type GateVerdict =
  | { kind: "unchanged" }                             // 走今天的路径,原样
  | { kind: "allow" }                                 // 不发 assert,不产生审批请求
  | { kind: "deny"; message: string; denial?: UnattendedDenial }

function unattendedGateVerdict(profile: UnattendedProfile, s: GateSubject): GateVerdict {
  const e = s.effective
  if (e.action === "deny")
    return e.reason.kind === "user" && profile !== "none"
      ? denyWith("needs-confirmation", s.tool)        // BR-03 已停用 → 文案一
      : { kind: "unchanged" }                         // 管控/授权/隔离/身份无效:今天的具名拒绝
  if (e.action !== "ask" && !s.rulesetAsks) return { kind: "unchanged" } // 已启用:今天就不问
  if (profile === "none") return { kind: "deny", message: unanswered(s.canonical) }
  if (e.action === "ask" && e.reason.kind === "binding-changed") return denyWith("needs-confirmation", s.tool) // BR-03
  if (profile === "readonly") return denyWith("readonly", s.tool)            // BR-04
  if (s.rulesetAsks) return { kind: "deny", message: unanswered(s.canonical) } // 用户/项目配置里写的 ask
  return { kind: "allow" }                            // BR-02:类别默认询问与「每次询问」都放行
}
// denyWith(r, tool) = { kind: "deny", message: unattendedDenialCopy(r, tool), denial: { version: 1, reason: r, tool, message } }
// unanswered(x)    = `Permission ${x} needs approval, and nobody is present to give it`(permission.ts:260 的原句)
```

执行形状:`deny` 在链上抛 `Tool.Error({ message, metadata: { codepuppyDisplay, [UNATTENDED_DENIAL_KEY]: denial } })`(无 `denial` 时不带该键);`allow` 不调 `permission.assert`。

| 档位 | 已启用 | 类别默认询问 | 每次询问 | 身份变化 | 已停用 | 配置里的 ask | 其它 deny |
| --- | --- | --- | --- | --- | --- | --- | --- |
| standard | 照旧放行 | **放行** | **放行** | 拒,文案一 | 拒,文案一 | 拒(原句) | 照旧 |
| readonly | 照旧放行 | 拒,文案二 | 拒,文案二 | 拒,文案一 | 拒,文案一 | 拒,文案二 | 照旧 |
| none | 照旧放行 | 拒(原句) | 拒(原句) | 拒(原句) | 照旧 | 拒(原句) | 照旧 |

**T2 其余一切询问(扩展的 `permission.evaluate` 钩子)。** 在有标记的会话里:进入钩子时 `effect === "ask"` ⇒ `deny`、`message = unanswered(action)`;此后任何钩子把 `effect` 写成 `ask` 也落为 `deny`(同一句),写成 `allow` 不生效,写成 `deny` 生效(与 `holdAsk` 同一种属性钉法,方向是「询问只能落成拒绝」)。进入时为 `allow` / `deny` 的不改;今天 Code Puppy 钩子给出的拒绝(无工具调用的具名拒绝、装扩展)照旧。覆盖:引擎工具自带的断言、配置规则的 ask、后注册钩子造出的 ask(例:装扩展钩子对非载体 agent 判 ask,P-06)。已配置的 deny 根本到不了钩子(P-02),AC-04 的三项原样且即时。

### 4.4 拒绝原因 → 运行记录

生产方:4.3 T1 的两类文案拒绝(带 `UnattendedDenial`)。T2 与「原句」拒绝不带,不进记录(BR-06 只给了两句文案)。

调度器投影(规则冻结):

- 输入:这次运行会话的全部消息(会话为本次新建,全部属于本次;回合成功、失败、中断都读)。
- 取时间顺序第一个 `part.type === "tool" && part.state.status === "error"` 且 `Schema.decodeUnknownOption(UnattendedDenial)(part.state.metadata?.[UNATTENDED_DENIAL_KEY])` 为 Some 的工具调用。
- 命中且不是这次运行的超时 ⇒ 运行记录 `status: "failed"`、`summary: denial.message`;`status.json` 的 `status: "failed"`、`error: denial.message`;回合成功时 `report.md` 照写。超时照旧记 `timeout`。
- 未命中 ⇒ 与今天完全相同。
- 不新增 `reasonCode` 与界面文案:历史行显示 `summary`(P-07),即规格说的「已有的失败原因一行」;列表行照旧。连败熔断照旧计入。

### 4.5 连接器补充信息(BR-05)

- 生产方:ui-mac main 调度器,只在一次本地运行的 `[session.create 成功, finally)` 区间内。
- 对象:这次运行的 location(`task.target.projectDir`)里 `metadata.kind === "mcp-elicitation"` 的待答表单。
- 动作:`session.form.cancel({ sessionID: form.sessionID /* "global" */, formID: form.id })`,引擎把它答给连接器为 `{ action: "cancel" }`(P-13)。
- 时限:表单出现起 1 s 内。发现方式(引擎事件流或轮询表单列表)由 plan 定。
- 错误:已结束/不存在忽略;其它错误记日志,不改变运行结局。不进运行记录(§10 G-1)。

### API

不新增。只用既有接口:`session.create` 的 `metadata`、`session.update` 的 `metadata`、`message.list`、`form.list`、`session.form.cancel`。

### 数据

无表结构与迁移。两个新键都在引擎不解读的 metadata 里(会话 metadata、工具失败 metadata)。

### 事件 / 配置

不新增配置。300 s 默认与 `CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS` 不变(只作用于有人在场的会话)。

| 配置键 | 类型 | 默认 | 必填 | 读取入口 |
| --- | --- | --- | --- | --- |
| 无 | — | — | — | — |

### AC 覆盖

| AC | 由哪条契约成立 |
| --- | --- |
| AC-01 | 已启用 ⇒ 今天就不问;类别默认询问 ⇒ T1 standard 放行,不调 assert,无请求 |
| AC-02 | 每次询问 ⇒ T1 standard 放行 |
| AC-03 | T1 readonly ⇒ 文案二 + 4.4 投影 |
| AC-04 | 已配置的 deny 先于钩子(P-02),不改 |
| AC-05 | 4.5 |
| AC-06 | §6 I-4:无标记的会话不进入任何新分支,`permission.ts` 不改 |
| AC-07 | 解析会话带标记、档位 none ⇒ T1/T2 一律立即拒绝;解析按既有路径返回结果或 `unavailable` |
| AC-08 | T1 身份变化/已停用 ⇒ 文案一 + 4.4 投影(已停用的那一支见 §10 O-1) |

## 5. 数据与失败

- 标记在建会话的同一次调用里写入,没有「会话已建、标记未写」的窗口。
- 收回失败或进程中途退出:标记留在会话上,到期点(这次运行既有的强制中断点)后作废。窗口内的风险见 §10 O-5。
- 标记解不开(形状不对):按「无标记」处理 —— 走今天的询问与 300 s,不放宽。
- ext 读会话失败:按「无标记」处理(引擎随后的 `configured()` 对不存在的会话本来就报 NotFound,`permission.ts:222-224`)。
- 投影读消息失败:记日志,运行记录按今天的规则写,不阻断。
- 表单取消竞态:表单已被答复或已结束 ⇒ 忽略。
- 时钟:写方(main)与读方(sidecar 里的 ext)同一台机器,UTC 毫秒;不跨机。

## 6. 架构落点

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| 4.1 共享定义 | `packages/schema/`(「共享 schema、权限和工具分类」,`modules.md:41`) | 无 | 同包先例 `codepuppy-tool-policy.ts`、`codepuppy-net-failure.ts` |
| 4.3 T1 裁决与标记读取 | `packages/ext/` 工具策略 | ext → schema(既有相对路径引入) | `decide`/`confirm`(`gate.ts:122-167`)、`EffectiveToolPolicy`(`resolver.ts:72-77`)、`namedDeny` 的 metadata 形状(`gate.ts:80-85`) |
| 4.3 T2 | `packages/ext/` 工具策略的 evaluate 钩子 | 同上 | 插件挂点 `permission.evaluate`(`permission.ts:243-251`)、`holdAsk` 钉法(`gate.ts:227-238`) |
| 4.2 写/收标记、4.4 投影、4.5 取消 | `packages/ui-mac/` main 的调度器与一句话解析 | ui-mac → schema(既有 `@opencode/schema/*` 引入)、引擎客户端 | `executeTask`、`promptAndWait`、`AutomationRunRecord` |
| 载体名取值 | ui-mac 的 `AUTOMATION_DEFAULTS.agent/agentStandard` 与注入里两个自动化 agent 的键 | ui-mac → schema | 4.1 `AUTOMATION_PROFILES` |
| 决定登记 | `docs/architecture/codepuppy-authority-registry.json` 新增一条 held 条目(无接管) | — | 登记簿「一条决定一条」(判官 `authority-registry.test.ts`) |

- 新目录/新模块:无。schema 里的新文件属既有模块,`modules.md` 不变。
- 上游文件:**不改任何上游文件,不新增接管**,无需 owner 级架构例外。已接管的 `permission.ts`(ADR-038)与 `mcp/index.ts`(ADR-041)都不碰;ADR-038 的「无人应答到期具名失败、绝不自动放行」对有人在场的会话原样成立 —— 有标记的会话根本不创建请求,标准档的放行来自规格 BR-02 的 owner 裁决,不是到期放行。
- 架构约束:K1 **变好** —— 两个自动化载体的名单与档位只定义一次,做判定的 ext 读得到;实现时同 PR 更新 `constraints.md` 的 K1 行(`CODEPUPPY_INJECTED_AGENTS` 与 `hub-tools.ts:47` 的前缀判断不在本次范围,见 O-4)。K2 不变:`unanswered()` 的句子与 `permission.ts:260` 字面相同,是同一种情形的同一句话,ext 不能引入该模块(`constraints.md` 已有同类登记);文案只在 4.1 一处。契约 C(P-14)遵守:不写 `[codepuppy:…]` 前缀,原因走结构化 metadata。
- 工程标准:第 4 条,`expiresAt` 是 UTC 毫秒;第 5 条,调用方读结构化字段而不是解析文案;不新增错误框架、不新增配置。
- 被否决的替代:
  - 把引擎的 `Permission.Unattended` 提供到回合里:回合跑在捕获的运行时上(P-03),要接管会话执行或 server 处理器(新接管),而插件钩子就在它前一行(P-02)。
  - 扩展已接管的 `permission.ts`(有标记即 0 秒到期 / 结束这一步):仍会先建请求出卡,且扩大 ADR-038 登记的接管面;挂点已够。
  - 只按 agent 判无人值守(在 catalog 里给 standard 载体免询问):项目命令能把有人在场的会话切到载体(P-09),会静默绕过用户的「每次询问」。
  - 拒绝时结束这一步(回合中断):插件造不出引擎的 `CancelledError`(P-12),只能接管内核;记录改由结构化原因投影。
  - 在 `mcp/index.ts` 里处理补充信息:表单不归属任何会话(P-13),内核里归因不比 main 好,还要扩大接管面。
  - 不给连接器声明补充信息能力:连接按 Location 共享,会连带有人在场的会话。
- 安全面(权限):
  - 威胁边界:**项目文档**能加 agent 规则、能设默认 agent、能用命令切 agent,写不了会话 metadata ⇒ 得不到标记(P-09、P-10)。**模型**没有写 metadata 的工具,`subagent` 拒绝 primary 载体;有标记会话的子会话继承标记,档位为 none ⇒ 只会更严。**渲染进程**经适配器建/改会话不转 metadata(P-10)。**插件**在同一进程、本来就能 `permission.reply` 任意请求(P-10),写标记不给它新能力 —— 插件仍在信任边界之内,与今天相同。引擎 API 口令只在 main。
  - I-1 只有 ui-mac main 的两个入口写 `UNATTENDED_SESSION_KEY`。
  - I-2 有标记的会话里不创建任何审批请求(零 `Permission.Event.Asked`)。
  - I-3 判定只把「询问」改成放行或拒绝:已配置的 deny 先于钩子、策略的 deny 不放宽;readonly 与 none 对询问从不放行。
  - I-4 无标记(或已作废)的会话:Code Puppy 的钩子与闸行为逐字节不变(`holdAsk`、风险分类、无工具调用的闸),`permission.ts` 不改 ⇒ AC-06。
  - I-5 档位只来自 agent 与 4.1 的表;标记不携带档位。
  - I-6 后注册的钩子只能把有标记会话里的结果改成拒绝。

## 8. 拆分决定

不适用:单仓(alpha-code),无归属拆分。

## 9. 回滚

不适用(非 L、无迁移)。回退代码后,已写入会话的标记是引擎不解读的 metadata,没有副作用;自动化回到今天的 300 s 行为。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| R-01 机制:扩展的闸与 evaluate 钩子按会话标记当场裁决;不改上游文件 | P-02、P-03、P-06;`c01ea14919` |
| R-02 无人值守 = 会话 metadata 里的标记,main 建会话时写、运行结束收回、以运行的强制中断点作废 | P-09(只按 agent 判会被项目命令绕过)、P-10;收回 + 到期是为了把标记限在调度器自己的回合内 |
| R-03 档位只由 agent 经 `AUTOMATION_PROFILES` 决定 | K1;防伪造标记放宽只读档 |
| R-04 规则表(4.3):「启用状态」读作「未停用」,类别默认询问与「每次询问」在 standard 一并放行 | 推断:BR-03 是封闭的拒绝清单且不含默认询问;AC-01 的「未单独设为询问」即默认状态;规格背景 U-12「全部批准的权限就应该不要询问」 |
| R-05 配置里写的 ask 与其余询问在有标记会话里立即拒绝,用引擎 `Unattended` 的原句,不进记录 | BR-02 只说设置 → 工具;引擎自己的无人值守语义也是拒绝(`permission.ts:252-262`) |
| R-06 拒绝是带类型的工具失败(模型继续),运行记录经结构化原因记为失败并写文案 | P-11、P-12、P-14;AC-03/AC-08 要求「运行记录的失败原因」 |
| R-07 补充信息由 main 在运行区间内按 location 立即取消 | P-13;并发的有人在场会话的同类表单今天本来无人能答(O-5) |
| R-08 一句话解析会话带标记、档位 none | AC-07「按拒绝处理」;P-08 |
| R-09 不新增配置、`reasonCode`、界面文案 | 规格「不新增界面」;历史行已显示 `summary`(P-07) |

| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| 待编排器按 delivery-review 对抗审计 | — | — | — | — |

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| G-1(规格缺口)BR-06 写了「因 BR-05 失败的那一步写明工具名和放行办法」,但体验约定没有这一句,AC-05 也不要求 | 补充信息被取消后,连接器怎么返回由它决定;运行记录不为此写新原因 | 不自造文案;AC-05 按写的可满足 | owner 要这一句时走规格变更 |
| O-1 AC-08 的「已停用」一支:已停用的工具不出现在模型的工具清单里(`catalog.ts:1-17`,F6 既有),常见情形是模型根本不调用、回合可能成功、记录没有失败行 | 只有调用真的到达闸时(按名调用、清单与停用之间的竞态)才出文案一 | 让模型看见停用工具会推翻 F6 裁决,超出规格(BR-03「本规格不改」) | owner 要求「任务需要已停用的工具时也写原因」 |
| O-2 AC-03 的「写入类连接器工具」:系统没有连接器工具的读写分类(`risk.ts` 无 MCP 写入规则);用户在设置里启用过的连接器工具,只读档今天就直接执行(载体规则无 `mcp:*`,P-04) | AC-03 对未启用(默认询问/每次询问)的连接器工具成立;已启用的照旧执行 | BR-04「只读档不变」 | owner 要求只读档拒绝一切连接器工具 |
| O-3 项目文档可在后加载的层给载体 agent 追加规则(`config/plugin/agent.ts:74-103`),加载先后未核实 | 可能放宽载体的静态规则;本设计不读规则定档位,放行只作用于询问,不碰已配置的 deny | 既有面,与本规格无关 | 另有证据表明项目层排在注入层之后 |
| O-4 `hub-tools.ts:47` 按前缀判自动化载体 | K1/K2 的又一份载体知识 | 不在本 AC 内;有标记时 T2 已兜住 | 下一次改载体名单 |
| O-5 运行区间内:同一项目里有人在场会话的补充信息表单也会被取消;用户在「全部批准」档往一个仍在区间内的自动化会话里继续发话,按无人值守裁决(该档不带 agent,P-09) | 前者今天本来无人能答(P-13);后者只到运行结束或到期点 | 收回 + 到期已把窗口压到运行本身 | 出现真实反馈 |
