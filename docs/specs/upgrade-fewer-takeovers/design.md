---
id: DESIGN-upgrade-fewer-takeovers
title: 少改上游文件、留下的接管同步更省事(I-05)技术设计
summary: 逐项裁定 12 个上游接管文件与文本级权宜做法的去留;「本次会话内允许」做进已接管的权限内核(连带只限本会话、不放行 Code Puppy 策略请求),读目录卡改由扩展从结构化结果生成;失败码保留文字前缀并统一读法;接管块形状与记录在案的上游基准、构建期改写登记与上游挂点需求清单
kind: tech-design
status: draft
version: 1
spec: ""            # 内部工作(INT-upstream-upgrade-readiness I-05,标签 dev),没有 spec;依据见 §1
spec_version: ""
review:
  rounds: 1           # R1:Codex gpt-6.1-sol,会话 01a1ced5,只读;FIX-THEN-MERGE,3 条 Major 全部采纳并已改(§10)
  reviewed_sha: "98c4983437"
  verdict: "pass-with-notes"
owners: [owner]
last_reviewed: 2026-11-12
review_after: 2027-05-12
---

# DESIGN-upgrade-fewer-takeovers｜少改上游文件、留下的接管同步更省事(I-05)技术设计

本文只写决定:契约、落点、失败处理、回滚与切片。改哪些文件、提交顺序与测试归各切片的 plan.md。

## 1. 基线

- Spec:无。I-05 是内部工作(标签 dev),依据是意图
  [impharaon/alpha-work:INT-upstream-upgrade-readiness@4c1b2c6](https://github.com/impharaon/alpha-work/blob/4c1b2c624b53619de97fa6bfa5679024d07abf17/docs/intents/INT-upstream-upgrade-readiness.md)
  的 I-05(U-02 同意做)与 U-03(调查得出的两项并入本方案)。本方案单独送 owner 批。界面不变,不消费 UX 稿。
- 覆盖:I-05 全部 ——
  ① 现有接管逐项判「留 / 换成已有插件挂点 / 向上游要具名挂点」;
  ② U-03 (a)「本次会话内允许」做进已接管的 `packages/core/src/permission.ts`;
  ③ U-03 (b) 读目录卡由扩展从结构化结果生成;
  ④ 失败原因用文字前缀还是结构化字段;
  ⑤ `to-session-error.ts` 能否换成 Code Puppy 的 fetch 包装;
  ⑥ 留下的接管怎么让同步便宜(标注块形状、钉住测试);
  ⑦ 交付切片排序。
- 背景:owner 原话(逐字)「界面当前的 alpha 才是唯一权威吧」「不可以因为 opencode 更新把经 codepuppy 拿回的唯一权威再封掉」;
  新能力默认归 OpenCode、只在交界处最小接线(ADR-048 决定 2)。
  调查依据 `docs/architecture/2026-11-12-1662-takeover-candidates.md`(换代分支,下称「调查」):代码未变处沿用其读码结论;
  本方案重核了调查的 A1、B1、C1、D 第 1 行,以及调查之后才加入的两个接管 `session/diff.ts`、`filesystem/location-watcher.ts`。
- 代码坐标:`E@` = `engine/1662-opencode2@b32116b2bc`;`A@` = `origin/alpha@01dbb1041a`(0.1.26 线);上游基 `33f94fce96`。
  标记:[读码] 读源码得出;[实测] 跑过命令;[推断] 没有运行。

## 2. 地面真相

- **F-01 0.1.26 的「本次会话内允许」= 内存里的会话放行,重启即失。** 能力轴请求的 v1 `always`「引擎按 `(会话, permission, always 的每一项)` 记在进程内存里,引擎或应用重启即失」(`A@packages/app/src/context/permission-v1-adapter.ts:90-91`)。
  内核:`SessionGrant` 带 sessionID(`A@packages/opencode/src/permission/index.ts:94-104`),存在 `InstanceState`(`:138-143`);
  deny/allow 先由规则集判定,放行只能了结 ask(`:170-176`);`always` 记放行后只连带同一会话(`:284-306`)。
  `clearGrants` 只有定义(`:313`),全仓无调用(`git grep -n clearGrants origin/alpha -- packages`)。
  工具策略请求(`metadata.policy`)不带 `save`,不给「本次会话内允许」,持久授权写工具策略设置(`permission-v1-adapter.ts:92-93`)。[读码]
- **F-02 换代分支今天的做法与 F-01 有三处不同。** 适配器把 `always` 做成「读会话规则 → 追加 `save` 每项一条 allow → PATCH 整份 → 回 `once` → 用复制的 `Wildcard.match`/`evaluate` 重判同会话其余请求」
  (`E@packages/ui-mac/src/engine-adapter/permission-replies.ts:151-209`、`:253-270`)。会话规则在 `configured` 里排在 agent 规则之后(`E@packages/core/src/permission.ts:211-216`),
  deny 判定对这份合并表取最后命中(`:218-219`、`:228`)⇒ 追加的会话 allow 会盖过同一动作上已配置的 deny [读码,未端到端实测];
  子会话创建时继承父会话规则(`E@packages/core/src/session.ts:311-314`)⇒ 之后建的子会话也被放行 [读码];规则写在会话行里 ⇒ 跨重启。
- **F-03 2.x 内核。** 项目保存的规则排在 `configured` 之后,且在 deny 判定之后才并入(`permission.ts:226-231`);`always` 写项目级保存(`:402-408`);
  回复后重判**全部**待审请求(循环 `:413-424` 不看会话),凡重判为 allow 的都放行并各发 `permission.replied{reply:"always"}`。此文件已在 `UPSTREAM_EXCLUDES`(ADR-038 标注块 `:96-134`、`:314-333`)。[读码;R1 复核]
- **F-04 内核拿不到 `Session` 服务。** `Session` 的依赖含 `Instance.node`(`E@packages/core/src/session.ts:554`),`Instance` 图含 `Permission.node`(`E@packages/core/src/instance.ts:96`)⇒ 权限内核依赖 `Session` 即成环;
  内核现有的 `SessionStore`(`permission.ts:180`)只读与认领,不写会话规则(`E@packages/core/src/session/store.ts:54-91`)。[读码]
- **F-05 钉住的引擎前提按项目级写。** premise (ii) 断言一条 `always` 放行了另一会话里被覆盖的请求(`E@packages/ext/src/policy/permission-reply-premises.test.ts:78-101`);
  测量文档回执推导第 3 条写「for `always` across sessions」(`E@docs/architecture/2026-11-09-1662-permission-reply-measurements.md:75-81`)。[读码]
- **F-06 read 的结构化结果到得了扩展。** read 返回 `output`(`ListPage`)、给模型的文字与 `metadata:{truncated}`(`E@packages/core/src/tool/plugin/read.ts:155-158`);
  `ListPage` = `{type:"list-page", entries:[{path,type}], truncated, next?}`,目录项以分隔符结尾(`E@packages/core/src/tool/read-filesystem.ts:90-101`、`:259-290`)。
  `execute.after` 收到 `result.output`(`E@packages/core/src/tool.ts:163-176`);扩展已在 `execute.after` 写 `result.metadata` 并随工具成功落库
  (`E@packages/ext/src/policy/display.ts:1-10`、`:64-80`;`E@packages/ext/src/policy/index.ts:206-210`);`execute.after` 不许失败(`E@packages/core/src/plugin/hooks.ts:23`)。[读码;promise 适配层透传同一事件对象未单独实跑]
- **F-07 读目录卡今天靠反解模型文字。** 适配器按 `Read directory …` 首行与续读行把文字解回条目(`E@packages/ui-mac/src/engine-adapter/v1-shapes.ts:204-226`),
  已有 `metadata.display` 时原样透传(`:245-246`);上游措辞在 `read.ts:258-280`。冻结卡只读 `type`/`entries`/`truncated`/`offset`
  (`E@packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/cards/tool-card-model.ts:779-788`);0.1.26 的形状见 `A@packages/opencode/src/tool/read.ts:38-46`、`:285-295`。[读码]
- **F-08 失败码前缀:一处定义,一处漏读。** 定义 `E@packages/schema/src/codepuppy-net-failure.ts:209-220`;生产方只在接管里(`E@packages/core/src/mcp/index.ts:499-501`、`:520`;`E@packages/core/src/session/to-session-error.ts:55-59`);
  适配器经 `parseFailureCode` 读(`v1-shapes.ts:357`、`:364`);`E@packages/ui-mac/src/main/engine-session-turn.ts:19` 把 `idle.error.message` 原样拼进异常,
  自动化把它写进运行记录的失败摘要(`E@packages/ui-mac/src/main/automation-scheduler.ts:307-320`)⇒ 前缀原样落盘、显示 [读码]。
  `Session.StructuredError` 没有空闲字段(`E@packages/schema/src/session-error.ts:7-14`);`Mcp.Status.Failed` 只有 `error: string`(`E@packages/schema/src/mcp.ts:86`)。
- **F-09 fetch 层注入的前缀留不在开头。** fetch 失败的 `TransportError.message` 取根因的 message,message 不含 code 时前面加 `code: `(`E@packages/ai/src/route/executor.ts:168-204`);
  不可达类 code 在 `toSessionError` 里被包成 `Can't reach <host>. … (<原文>)`(`to-session-error.ts:132-138`,判定 `E@packages/core/src/model-retry.ts:48-49`)。
  `ServerOptions.fetch` 覆盖模型请求与远程 MCP(`E@packages/server/src/options.ts:29-33`)。[读码,未实跑]
- **F-10 接管清单与同步代价。** `bash scripts/north-star-guard.sh --print-takeover` 列 12 条路径;上游动到任一条,每日同步停下等人工移植(`E@docs/architecture/upstream-integration.md:151-160`)。
  90 天上游改动数(`git log --oneline --since="90 days ago" 33f94fce96 -- <path> | wc -l`)/ 文件行数 / 我方改动(`git diff --numstat 33f94fce96 HEAD`)见 §10 逐项表。[实测]
- **F-11 标注约定靠自觉已经走样。** 对 12 条路径的改动行逐行判「是否在 `codepuppy(…) ──`…`── end` 块内或本行带 codepuppy 标注」:9 条路径有未标注的改动行
  (`oauth/page.ts` 22/23、`mcp/index.ts` 41/122、`permission.ts` 22/63、`tool/mcp.ts` 9/20 等;`session/diff.ts` 0)。[实测,内联启发式脚本;单行注释开头的块被计为未标注,数字是上限]
- **F-12 没有可替换的现有挂点。** 插件的 MCP 域只有 `list`/`transform`/`reload`(`E@packages/plugin/src/promise/mcp.ts:14-16`);
  上游 `/api/experimental/fs/watch` 只监视单个文件(`E@packages/core/src/filesystem/file-watch.ts:35-39`、`E@packages/protocol/src/groups/fs.ts:99-111`);
  diff 锚点在 `SessionDiff.turn` 内判定、命令换模型在命令体内、工具注册后写覆盖、OAuth 页由引擎直出(ADR-047「精确接管面」表与调查 §D,代码未变)。[读码]
- **F-13 构建期改写是没登记的接管。** `packages/core/src/database/v1-migration.bun.ts` 由 `E@packages/ui-mac/engine/v1-migration-transform.ts` 在构建时改写,锚点须恰好出现一次否则构建失败(`:1-14`);
  不在 `UPSTREAM_EXCLUDES`,不在 ADR-047 接管表;登记册 `adr041-history-display-conversion` 仍为 `blocked`。[读码]
- **F-14 换代尚未发布。** `origin/alpha@01dbb1041a` 仍是带 v1 引擎(`packages/opencode`)的 0.1.26 线;换代分支的会话数据只在开发构建里。[读码]
- **F-15 重判会放行 Code Puppy 的策略请求。** 扩展闸门发出或改写的请求带 `metadata.policy`(`E@packages/ext/src/policy/gate.ts:146`;无工具调用的子任务命令由 `:196-199` 原地写进请求的 metadata);
  扩展的 evaluate 钩子见到 `metadata.policy` 只调 `holdAsk` 就返回(`E@packages/ext/src/policy/index.ts:153`),而 `holdAsk` 对进入时已是 allow 的事件不锁定(`gate.ts:224-225`)。
  所以 F-03 的连带重判一条策略请求时,只要规则本身给 allow,它就被内核放行 —— 例如挂起中的 `/review` 子任务命令随即建子会话(`E@packages/core/src/config/plugin/command.ts:89`)。
  今天适配器从不发 `always`,这条连带走不到;A 让它走得到。[R1 用生产函数只读探针复现 ask → allow,exit 0]
- **F-16 守卫的上游基准合入 alpha 后就找不到。** `scripts/north-star-guard.sh` 只在 `origin/alpha..HEAD` 的合并里找「上游父」(`E@scripts/north-star-guard.sh:341-359`),
  注释写明合入 alpha 后候选消失、退回 `origin/alpha` 基准;只读模式 `--print-takeover` 只打印路径(`:70`、`:213-218`)。[读码;R1 只读模拟合入后状态得 0 个候选]

## 4. 接口契约

### API

只有一条公开路由的语义变化,形状不变:

| 路由 | 请求 / 响应 / 错误 | 变化 | 归属 |
| --- | --- | --- | --- |
| `POST /api/session/:sessionID/permission/:requestID/reply` | `{ decision: "once" \| "always" \| "reject"; message?: string }` → 204;待审请求不存在 → `PermissionNotFoundError`(404) | `always` 由「写项目级保存的批准」改为「本会话内放行」(契约 A) | Code Puppy(已接管的内核) |

### 契约 A —— 会话内放行(权限内核第二个标注块)

```ts
// packages/core/src/permission.ts —— codepuppy(#1128 §4.4, I-05) 标注块
// 存放:Permission 服务实例(每个 Location 一份)闭包里的内存表。不落库、不跨 Location、不随子会话继承。
const sessionGrants = new Map<SessionSchema.ID, Permission.Rule[]>() // 每条 effect 恒为 "allow"

// reply(…) 的 always 分支 —— 取代上游的 saved.add({ projectID, … }),其余不动
if (input.reply === "always" && existing.request.save?.length) {
  const added = existing.request.save.map((resource) => ({ action: existing.request.action, resource, effect: "allow" as const }))
  sessionGrants.set(existing.request.sessionID, [...(sessionGrants.get(existing.request.sessionID) ?? []), ...added])
}

// evaluateInput —— deny 仍只用 configured 判;放行与项目保存的规则并列,排在其后
const all = [...rules, ...(yield* savedRules()), ...(sessionGrants.get(input.sessionID) ?? [])]

// reply(…) 的连带循环(上游 :413-424)—— 只在循环头加两道筛,重判与发布逻辑不动
for (const [id, item] of pending) {
  if (item.request.sessionID !== existing.request.sessionID) continue // codepuppy(I-05):连带只限本会话
  if (isCodePuppyPolicyRequest(item.request.metadata)) continue       // codepuppy(I-05):Code Puppy 策略请求只由它自己的卡片了结
  // …上游原样:evaluateInput → allow 才发 replied{reply:"always"} 并放行
}

// close(finalizer)里:sessionGrants.clear()
```

```ts
// packages/schema/src/codepuppy-tool-policy.ts(Code Puppy 自有,纯数据与纯函数;ext 与 core 都已 import 这个包)
/** 扩展闸门发出或改写的审批请求在 metadata 里带的键;写方只有 ext 闸门(gate.ts confirm 与 gateWithoutToolCall)。 */
export const TOOL_POLICY_REQUEST_KEY = "policy"
/** 这条审批请求是不是 Code Puppy 工具策略的请求。读方:内核连带的筛(上)与 ext evaluate 钩子的分流(index.ts:153)。 */
export function isCodePuppyPolicyRequest(metadata: unknown): boolean {
  return typeof metadata === "object" && metadata !== null && TOOL_POLICY_REQUEST_KEY in metadata
}
```

不变式(每条有一条会红的测试;登记册新增一条在役项,机制 = 本标注块,反向臂 = 换回上游原文件 ⇒ 红):

1. 只有 `save` 非空的请求回 `always` 才产生放行;条目 = (`action`, `save` 的每一项),匹配用上游 `evaluate` / `Wildcard.match`。
2. 放行只能了结 ask,赢不过任何已配置的 deny(deny 判定在放行并入之前;同 0.1.26 #1122 B9)。
3. 只对同一个 `sessionID` 生效:别的会话、之后创建的子会话照常询问。
4. 引擎停止(服务 finalizer)即失;不写会话行,不写 `PermissionSaved`。
5. **连带只处理同一会话**:循环先按 `sessionID` 筛,再重判;另一会话的待审请求即使此刻重判为 allow 也不动、不发 replied(同 0.1.26 `A@…/permission/index.ts:293`)。
6. **连带永不放行 Code Puppy 策略请求**:带 `metadata.policy` 的待审请求被跳过,只能由用户在它自己的卡片上回复了结 —— 是否放行仍只由 ext 闸门决定(F-15)。
   选跳过而不选「连带时重跑整套身份轴判定」:跳过不在内核里复制 ext 的判定,ext 仍是唯一权威;代价只是那张卡要用户单独点一次。
   能力轴放行的动作名(如 `edit`)碰不到策略请求的 `source:origin:name` 动作(`E@packages/schema/src/tool-identity.ts:109`),所以被跳过的只是「规则本身就给 allow、靠钩子改成 ask」的那类。
7. 直接判定(非连带)不变:`permission.hook.evaluate` 照旧在放行之后运行;新到的子任务命令请求由 `gateWithoutToolCall` 把 allow 改回 ask(`gate.ts:191-202`),工具调用的策略请求在 `confirm` 后再判一次。
8. 项目级保存的批准照旧被读取(`savedRules` 不动),只是不再写入 —— 与今天一致(今天的适配器从不发 `always`,`permission-replies.ts:253`)。
9. 键名只有一处定义(上面的 schema 常量);ext 的写方与读方、内核的筛都用它 —— 改名不会让筛悄悄失效。

证明(各带反向臂,真引擎 + 真 ext,不用替身):
- 第 6 条:配置 `* allow`、`read ask`,子任务工具策略设为 ask;同会话挂起一条 `/review` 子任务请求与一条 read 请求;对 read 回 `always` ⇒ read 放行,策略请求仍在 `permission.list()`、没有它的 replied、没有建子会话。反向臂:去掉跳过 ⇒ 策略请求被放行(R1 复现的形态)。
- 第 5 条:会话 B 挂起一条请求,等待期间让它重判为 allow(插件 evaluate 钩子改判);会话 A 回 `always` ⇒ B 仍待审、没有 B 的 replied。反向臂:去掉会话筛 ⇒ B 被放行。
- 第 2–4 条与 premise (ii) 的改写同在 A 的测试里;具体测试名归 plan.md。

消费方(`packages/ui-mac/src/engine-adapter/permission-replies.ts`):

- 界面决定 `always` 原样发给引擎;删除 `allowForSession`、`releaseCovered`、`wildcardMatch`、`evaluateRules`。
- 回执 `resolvedRequestIDs` = 目标 + 发出后到达、同会话、`reply` 等于本次决定的 `permission.replied` 的请求。
  收窗(`always` 与 `reject` 同一条):HTTP 回复返回后重读本会话待审列表;「回复前在、回复后不在」的每一条都收到 replied,或到 `SETTLE_MS`(2 s)即收窗;到点仍未确认的不进回执。
- 不变:快照指纹、回复前重读的过期(404)与冲突(409)、`decisionID` 幂等、没有 `save` 的 `always` 回冲突。
- 引擎前提改写:premise (ii) 与测量文档第 3 条改为「一条 `always` 只放行同一会话里被覆盖的请求,另一会话的仍待审」(F-05)。

### 契约 B —— 读目录卡的显示数据(扩展写,冻结卡读)

```ts
// 写入方:packages/ext 现有的 tool.hook("execute.after");写到 Tool.Result.metadata.display
type DirectoryDisplay = {
  type: "directory"
  path: string          // 这次 read 调用的 input.path,原样
  entries: string[]     // ListPage.entries[].path,引擎顺序;目录项以路径分隔符结尾
  offset: number        // input.offset 是正整数时取它,否则 1
  truncated: boolean    // ListPage.truncated
  totalEntries?: number // 仅 truncated === false:offset - 1 + entries.length(2.x 截断时不给总数,不编)
}
```

- 触发:`event.tool === "read"`、`event.status === "completed"`、`event.result.output?.type === "list-page"`、`entries` 是数组、`event.result.metadata?.display === undefined`,同时满足才写;否则什么都不写(卡片回落读文件卡,与今天认不出首行时相同)。
- 形状与键名 = 0.1.26 read 的 `Display` 目录分支(F-07);转换来的旧对话也是这个键,新旧历史走同一个读取点。
- 只加 `metadata.display`,不改 `output` 与给模型的文字;钩子内不抛错(F-06)。
- 适配器删除 `directoryDisplay` 与两条正则,`metadata.display` 原样透传(已有逻辑);保留与否的唯一例外见 §5「历史」。
- 归属:形状由扩展里这个写入点持有;读取方是冻结卡 `dirDisplayOf`(不改)。

### 契约 C —— 失败原因的登记码(沿用,补齐读法)

- 生产方仍只有两个接管:`to-session-error.ts` 的 Transport 分支(`Session.StructuredError.message`)与 `mcp/index.ts`(`Mcp.Status.Failed.error`),都经 `withFailureCode`;
  形状 `[codepuppy:<code>] <原文>` 只在 `packages/schema/src/codepuppy-net-failure.ts` 定义。不新增生产方。
- Code Puppy 里任何读这两个字段、再给人看或写盘的地方,先经 `parseFailureCode` 取去掉前缀的原文:适配器已是;
  `packages/ui-mac/src/main/engine-session-turn.ts` 改为拼去掉前缀的原文(自动化失败摘要不再出现 `[codepuppy:…]`)。
- 不改成结构化字段(§10 R-05)。

### 契约 D —— 接管块形状与登记(让同步便宜)

- 接管文件里的每一行改动,要么在 `// codepuppy(<ADR 或票号>) ── <为什么>` 与 `// codepuppy ── end` 之间,要么本行行尾带 `// codepuppy(<ADR 或票号>)`;
  删掉的上游行所在的 hunk 必须碰到一个标注处。测试文件同样适用。
- 超过「一次调用 / 一个条件」的逻辑放进 Code Puppy 自有的同目录文件 `codepuppy-*.ts`(ADR-043 自有文件判定),接管文件只调用。先例:
  `mcp/codepuppy-startup.ts`、`mcp/codepuppy-first-party-mcp.ts`、`filesystem/codepuppy-project-watch.ts`、`packages/schema/src/codepuppy-net-failure.ts`。
- 每个接管一条钉住测试,反向臂 = 换回上游原文件 ⇒ 红(ADR-047 表「守卫」列、ADR-048 决定 4,已有,不新增机制)。
- 机器核对的比较基准是**记录在案的上游 SHA**,不靠在分支历史里找(F-16):
  ```bash
  # scripts/north-star-guard.sh,紧挨 UPSTREAM_EXCLUDES(接管清单仍只有这一处)
  UPSTREAM_TAKEOVER_BASE=33f94fce967367888bd3108682b22d557c119102   # 接管文件最近一次对齐的上游提交;初值 = #1662 M0 的上游父
  # 只读模式:bash scripts/north-star-guard.sh --print-takeover-base  → 打印这一个 SHA,不跑任何 git 命令
  ```
  - 谁推进:受审上游集成(人工移植,按 `ci.md` §4 以真合并落地)在同一个 PR 里把它改成本次合入的上游 SHA。
    每日同步的自动合并可以不动它:进得了自动合并,说明这次上游没碰任何接管路径(intake 检查,`upstream-integration.md:151-160`),新旧基准下接管文件内容相同。
  - 可得性:真合并保留上游祖先,合入 `alpha` 后基准仍在历史里,与 `origin/alpha..HEAD` 无关。`git cat-file -e <基准>^{commit}` 失败 ⇒ 红(「基准取不到:要完整历史」),**从不跳过**。
    因此 #1662 合入 `alpha` 必须是真合并(受审集成本来的规矩)。
  - 核对范围:**提交与工作树都判** —— 每条接管路径的 `HEAD:<path>` 与工作树文件各自对 `<基准>:<path>` 求差,任一版本有不合规的改动行即红,以 `path:line` 报出;干净检出(CI、干净树上的 pre-push)两份相同,只判一次。与守卫「提交差 ∪ 工作树差」同一口径。
  - 普通 PR:不碰接管路径 ⇒ 差异就是已补齐标注的那份,绿;改了接管文件且带标注 ⇒ 绿;不带 ⇒ 红。
  - 集成分支合入了更新的上游、上游又改了某条接管路径,而没推进基准 ⇒ 上游自己的新行显得「未标注」⇒ 红,提示「把 `UPSTREAM_TAKEOVER_BASE` 推进到本次合入的上游 SHA」。这是要求移植的人申明新基准,不是误报。
  - 清单里某条路径在基准里不存在 ⇒ 红(改接管清单时一并处理)。
  - 与守卫同在本地门里跑。已知坏样本:任一接管文件加一行不带标注的改动 ⇒ 红;把基准改成取不到的 SHA ⇒ 红。上线时先把 F-11 的 9 个文件补齐标注(只动注释与标注位置,不改行为)。
- 构建期改写算接管的一类:在 ADR-047「精确接管面」表登记 `packages/core/src/database/v1-migration.bun.ts`(改写方 `packages/ui-mac/engine/v1-migration-transform.ts`;
  守卫 = 锚点恰好一次、构建即抛 + `engine-v1-history-display.cases.ts`;回滚;归属)。不进 `UPSTREAM_EXCLUDES`:树里那份保持上游原样,上游改进照常进来,锚点漂移在构建时响亮失败。
  登记册条目由 I-02 的登记工作写。
- ADR-047 表 `permission.ts` 一行随契约 A 改:两个标注块;守卫加会话放行的钉住测试;回滚栏写明不得只回退本文件(§9)。

### 数据

无库表、无迁移。会话放行只在内存。

### 事件 / 配置

`permission.replied` 形状不变;无新配置键。

## 5. 数据与失败

- **A 的写入边界。** 放行写在 `reply` 的不可中断块里、`Deferred.succeed` 与连带之前,纯内存、无 I/O;两张卡快速连点各自往同一张表追加,不会丢规则
  (今天适配器跨请求不串行地读改写整份会话规则,可能丢一条:调查 A1 [推断])。显示与决定之间引擎重启 ⇒ 重读 404 ⇒ 过期(不变)。
  回执唯一可达的未确认窗口是事件流断开,按 2 s 上限少报、不猜(不变)。
- **B 的写入边界。** 只在成功的目录读取上加一个键;条件不满足就不写。无重试、无新失败态。
- **A 的连带。** 连带只看同一会话、跳过 Code Puppy 策略请求(契约 A 第 5、6 条);被跳过的策略请求照常挂着,到 ADR-038 期限仍无人答就按名失败,不会被静默放行。
- **历史(B)。** B 可以在 #1662 首次发布之后落地(§8)。那样首发之后、B 之前记录的目录读取没有 `display`:文本解析保留,只用于没有 `display` 的记录
  (那些正文落库时就定了,不再随上游措辞变);新记录都走 `display`。B 若赶在首发前落地,解析可删尽。
- **已写入的会话规则(A)。** A 在 #1662 内、首次发布前落地(§8),用户机器上就不会出现旧适配器写进会话行的放行规则(F-02),不需要清理。
  若顺序被打破:A 无法事后清理 —— 按规则内容分不出哪些是「本次会话内允许」写的。
- C、D 无数据面。

## 6. 架构落点

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| 会话放行与连带的两道筛(契约 A) | `packages/core/`(`docs/architecture/modules.md:26`),已接管的 `src/permission.ts` 第二个标注块 | 本文件已有的 `evaluate` / `Wildcard`;`@opencode/schema` 的 `isCodePuppyPolicyRequest`(core 已依赖 schema);不依赖 `Session`(F-04) | 上游 `evaluateInput` 的判定顺序与连带(`permission.ts:226-252`、`:411-425`);策略请求的判定仍只在 ext 闸门 |
| 策略请求的键与判定函数(契约 A) | `packages/schema/`(`modules.md:41`)Code Puppy 自有的 `src/codepuppy-tool-policy.ts` | 无新依赖(纯函数) | 工具策略共享合同的现有归处;ext 的写方 / 读方与内核的筛共用一份 |
| 适配器删减(契约 A 消费方) | `packages/ui-mac/`(`modules.md:51`)渲染进程引擎适配器 | 引擎 `/api/*` | 引擎的判定与连带;删掉的是手写替身 |
| 读目录显示数据(契约 B) | `packages/ext/`(`modules.md:32`)现有 `execute.after` | 插件接口的 `Tool.Result` | 上游 read 的 `ListPage`;0.1.26 的 `Display` 形状 |
| 失败码读法(契约 C) | `packages/ui-mac/` 主进程 | `packages/schema/`(`modules.md:41`) | `parseFailureCode` |
| 标注核对、记录在案的上游基准、构建期改写登记(契约 D) | 与 `scripts/north-star-guard.sh` 同处的本地门;ADR-047 表 | 守卫的 `--print-takeover` 与新的 `--print-takeover-base` | 接管清单唯一来源 `UPSTREAM_EXCLUDES`(`upstream-integration.md:147-150`);基准与清单放在同一处 |

- 新目录/新模块:无。
- 收敛:A 删除渲染进程里 `Wildcard.match`/`evaluate` 的副本与第二个判定器;B 删除对模型文字的反向解析。其余已知偏离不动(`ext/src/policy/gate.ts` 重述 `evaluate` 已登记在 constraints.md,不变)。
- 架构约束:K2 —— A、B 变好(去掉替身),C、D 不变;无新增偏离,无需例外。
- 工程标准:第 5 条 —— 失败码是 Code Puppy 自定、一处定义一处解析的契约,读法统一到 `parseFailureCode`;不为此新建错误框架。
- 被否决的替代:见 §10 R-01、R-02、R-04、R-05、R-06、R-08。
- 安全面(A 改审批):边界 = 一次「本次会话内允许」能放行什么,不变式见契约 A 第 1–6 条。Code Puppy 自己的工具策略请求(`metadata.policy`)既不被连带放行(第 6 条),
  也不在界面上产生会话放行:冻结审批卡把它们分流到「在此项目中始终允许」(写工具策略设置后回 `once`,`PermissionDialog.tsx` 的 `allowInProject`),A 不碰这条路。

## 8. 拆分决定

无跨仓或归属拆分(全部在 alpha-code、同一负责方)。下表是派发书要求的交付切片排序:同仓、各自可独立合并;文件、提交顺序与测试归各切片的 plan.md。

**落点(编排器 2026-11-12 裁决,R-14):A 与 C 必须在 #1662 之内、#1662 首次发布之前落地;B 与 D 可以在 #1662 之后跟进。**
A 去掉一处经审查确认的、与 0.1.26 不同的审批行为(会话放行盖过已配置的禁止等,F-02);C 去掉一处会写进用户自动化记录的内部前缀。B、D 不改变用户可见行为,后到只影响 §5「历史」那条回落。

| 顺序 | 切片 | 内容 | 价值 | 落点与依赖 |
| --- | --- | --- | --- | --- |
| 1 | A 会话内放行进内核 | 契约 A(含连带的会话筛与策略请求筛、schema 里的键与判定函数);登记册新增在役项;premise (ii) 与测量文档同步 | U-03 (a);删掉渲染进程里的匹配副本与第二个判定器;放行回到 0.1.26 语义 | **#1662 内、首发前**。与 I-04 同改适配器,先于 I-04 实施则 I-04 少背约 70 行 |
| 2 | C 失败码读法 | 契约 C | 自动化失败记录不再露出内部前缀 | **#1662 内、首发前**。无其他依赖 |
| 3 | B 读目录卡由扩展生成 | 契约 B | U-03 (b);不再依赖上游给模型的措辞 | #1662 之后可跟进;后到则保留无 `display` 记录的文本回落(§5) |
| 4 | D 接管块形状与登记 | 契约 D(标注补齐、记录在案的上游基准与核对、构建期改写登记) | 同步停下时人工只对标注处移植;接管面登记完整;合入 `alpha` 后核对仍有基准 | #1662 之后可跟进;在 A 之后(A 改 `permission.ts` 标注);登记册条目可与 I-02 同 PR |
| — | 上游挂点需求 | §10 R-11 清单 | 被接受后对应接管可退回 L0 | 是否提交待 owner(§10) |

## 9. 回滚

- A:整切片一个提交回退 ⇒ 适配器回到读改写会话规则 + 回 `once`,内核 `always` 回到项目级保存;放行在内存,回退不留数据。
  **不得只回退 `permission.ts` 而保留新适配器**:那样「本次会话内允许」会变成项目级永久批准。ADR-047 回滚栏照此写。
- B:回退恢复文本解析;已写入 `display` 的记录仍被透传,无数据后果。
- C:回退只让失败摘要重新带前缀。
- D:标注补齐只改注释,核对与 `UPSTREAM_TAKEOVER_BASE` 可一起单独回退;构建期改写的登记是文档行。
- 上游挂点被接受后:按 ADR-048 决定 3 换接法(L3 → L0),登记册条目保留并改写握法,不交回上游默认。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| R-01 会话放行放内存,不跨重启 | 0.1.26 就是内存、重启即失(F-01);持久化要经 `Session` 造成层循环(F-04)或绕过会话写路径。否决:由内核调 `Session.setPermissions` |
| R-02 放行与项目保存的规则并列、排在 deny 判定之后,不写进会话规则 | 0.1.26 放行只能了结 ask(F-01);写进会话规则会盖过已配置 deny、被子会话继承、跨重启(F-02,[读码,未端到端实测])。否决保留适配器读改写:第二个判定器 + 渲染进程副本(K2)+ 并发丢规则 [推断] |
| R-03 `always` 连带只放行同一会话,由连带循环头的会话筛保证(R1 #2 后改为明写在契约里) | 0.1.26 同(`A@…/permission/index.ts:293`);上游循环不分会话(F-03);F-05 的钉住测试与文档随改 |
| R-04 读目录卡由扩展在 `execute.after` 从 `ListPage` 写 `metadata.display`(0.1.26 形状、同一键) | F-06、F-07。否决「Code Puppy 命名空间新键 + 适配器再映射」:0.1.26 与转换来的旧对话已用 `display`,一个形状一个读取点 |
| R-05 失败原因保留文字前缀;向上游要结构化 `code`(U2) | 结构化字段要接管 `packages/schema/src/session-error.ts`、`packages/schema/src/mcp.ts` 并重生成 `protocol/openapi.json` 与 `client` 两份生成文件(调查 C1、F-08)⇒ 多 5 条接管、每次接口变化都冲突;前缀一处定义、两端有测试 |
| R-06 `to-session-error.ts` 不换 fetch 包装,接管保留 | F-09:fetch 层注入的前缀会被上游放进句子中间,且要依赖 `executor.ts` 与 `to-session-error.ts` 两处上游文字拼法;现接管只有 +9/-3 一个标注块 |
| R-07 所有读方经 `parseFailureCode`(契约 C) | F-08 有一处漏读 |
| R-08 12 个接管全部保留,逐项见下表 | F-10、F-12;无一能换成现有挂点。否决:主进程自建项目监视替代 `location-watcher.ts`(新增 IPC 与生命周期,大于 33 行、90 天 7 次改动的接管);MCP 重连挪到主进程(文件仍要接管,调查 §D) |
| R-09 接管块形状 + 机器核对(契约 D);比较基准 = 守卫里记录在案的 `UPSTREAM_TAKEOVER_BASE`,提交与工作树都判(R1 #3 后补) | F-11:无核对时 9/12 已偏离;F-16:在分支历史里找上游父,合入 `alpha` 后就找不到。否决:沿用守卫的上游父发现(合入后静默)、用 `origin/dev` 求 merge-base(镜像会陈旧,2026-11-09 仍停在 1.x,守卫 `:339-340` 注释) |
| R-10 构建期改写登记为接管的一类,不进排除清单 | F-13;调查 §D 末行 |
| R-11 上游挂点需求按能省下的同步停顿排序(下表 U1–U8) | F-10 的 90 天改动数 |
| R-12 连带跳过 Code Puppy 策略请求(`metadata.policy`),键与判定函数放 `packages/schema/src/codepuppy-tool-policy.ts` 共用(R1 #1 后补) | F-15。否决「连带时对策略请求重跑整套身份轴判定」:要在内核里复制或回调 ext 的判定,ext 不再是唯一权威;跳过只让那张卡等用户单独回复 |
| R-13 判定函数共用一份 | 键名若只在内核里写死,ext 改名后筛会悄悄失效、绕过重现(K2) |
| R-14 A、C 在 #1662 内首发前落地;B、D 可后续 | 编排器 2026-11-12 裁决(派发更正);依据 F-02(R1 用生产 `Permission.evaluate` 复现会话 allow 盖过 agent deny)与 F-08 |

逐项去留(改动数 = 上游 90 天提交数 / 上游文件行数;我方 = 相对 `33f94fce96` 的增删行):

| 接管路径 | 去留 | 挂不了现有钩子的原因 | 改动数 · 我方 | 向上游要的具名挂点 |
| --- | --- | --- | --- | --- |
| `packages/core/src/mcp/index.ts`、`client.ts`、`connection.ts` | 留 | 插件 MCP 域只有 list/transform/reload(F-12) | 40/1002 · +122/-8;29/626 · +55/-9;4/268 · +12/-2 | U1 MCP 运行时策略:重连退避与启动并发两项配置;`Mcp.Status.Failed` 可选 `code`;失败状态与日志不带远端正文与 stderr;未连上时可用插件声明的工具;调用前核对工具定义是否换代 |
| `packages/core/src/session/to-session-error.ts`、`packages/core/test/session-runner-retry.test.ts` | 留(R-06) | `session.hook.retry` 的 error 只读 | 23/144 · +9/-3;4/130 · +10/-4 | U2 `Session.StructuredError` 可选 `code`,或失败落库前可加注的钩子 |
| `packages/core/src/permission.ts` | 留并扩展(契约 A) | 等待与回复语义在内核里;插件侧 reject 会级联整个会话 | 18/388 · +63/-1 | U3 审批期限配置(到点只结束这一条);`always` 的会话作用域 |
| `packages/core/src/tool/mcp.ts` | 留 | 注册表后写覆盖,扩展只见幸存者 | 17/177 · +20/-1 | U4 工具重名注册报错而非覆盖;调用前比对工具定义 |
| `packages/core/src/config/plugin/command.ts` | 留 | 换模型与建子会话发生在命令体内 | 16/216 · +23/-4 | U5 命令不覆盖会话已选模型(或命令执行前可否决换模型的钩子) |
| `packages/core/src/filesystem/location-watcher.ts` | 留 | 上游 fs watch 只认单个文件(F-12) | 7/108 · +33/-2 | U6 `/api/experimental/fs/watch` 接受目录(递归 + 忽略表) |
| `packages/core/src/session/diff.ts` | 留 | 锚点判定在 `SessionDiff.turn` 内 | 2/149 · +8/-3 | U7 synthetic 开启的回合可作 diff 锚点 |
| `packages/core/src/oauth/page.ts`、`packages/core/test/oauth-page.test.ts` | 留 | 页面由引擎直出 | 0/276 · +23/-31;0/15 · +16/-0 | 不提:零改动,无同步成本 |

文本级权宜做法:

| 做法 | 去留 | 依据 |
| --- | --- | --- |
| 失败码文字前缀 | 留 + 契约 C | R-05、R-07 |
| 读目录卡反解模型文字(`v1-shapes.ts:204-226`) | 换(契约 B) | R-04 |
| 适配器的匹配器副本与读改写(`permission-replies.ts:151-209`) | 删(契约 A) | R-02 |
| 构建期改写 `v1-migration.bun.ts` | 留 + 登记(契约 D) | R-10 |
| 扩展闸门重述 `Permission.evaluate`(`ext/src/policy/gate.ts:21`、`:31-44`) | 留 | 8 行,有逐例对照真函数的测试,wildcard 90 天 0 改动(调查 C7;constraints.md 已登记) |
| 托管 deny 上限由扩展自读托管文件(`ext/src/policy/managed.ts`) | 留;U8 托管权限排在 agent 规则之后 | 上游排序缺陷(调查 E1) |
| shell 输出轮询、v1 事件投影、四类请求同一回调、按消息切模型、扩展最后运行、OAuth 轮询、sidecar 就绪轮询、嵌入宿主形状、项目命令重渲染 | 留 | 调查 C2/C5/C6/C11/C12/E2–E4/C9 沿用(代码未变);事件投影属 I-04 |
| 模型服务白名单与出厂命令/技能合成显式配置(调查 C8) | 留 | 真正的简化是数据目录归属(R5 已暂缓),属 I-07 启动配置范围 |

**待 owner 决定(未批,不阻塞本方案的其余部分)**

| 事项 | 依据与后果 |
| --- | --- |
| 是否把 U1–U8 提交到上游 `anomalyco/opencode` | 公开、以 owner 身份对外。不提 ⇒ 接管照留,同步代价如 F-10;提了且被接受 ⇒ 对应接管按 §9 末条退回 L0,登记册保留 |

(原先的「#1662 首发是否等 A、B」一项已由编排器裁决 R-14 取代:A、C 必须在首发前,B、D 可后续;发布本身仍按既有规矩另需 owner 授权。)

**送 owner 的用户可见变化**:相对当前正式版 0.1.26 —— 无。相对未发布的换代分支 —— 「本次会话内允许」重启后失效、不再带进之后新建的子会话、不再盖过已配置的禁止;自动化失败摘要不再出现 `[codepuppy:…]`。都是回到 0.1.26 的行为。

| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| R1 · `98c4983437`(原路径 `docs/specs/upstream-upgrade-readiness/design-i05.md`)· 全文 | Codex gpt-6.1-sol,会话 01a1ced5,只读;建议 FIX-THEN-MERGE | **#1 Major 连带绕过策略 ask**:A 让连带走得到,重判时带 `metadata.policy` 的请求因 ext 提前返回、`holdAsk` 不锁 allow 而被放行(F-15)—— 采纳,当前工作修 | 契约 A 连带循环加策略请求筛 + 第 6、9 条不变式 + schema 共用判定函数;证明见契约 A「证明」第 1 条(反向臂 = 去掉筛即放行)。R1 生产函数只读探针 ask → allow,exit 0 | 无 |
| 同上 | 同上 | **#2 Major 连带不分会话**:按会话存放行 ≠ 连带只处理本会话,上游循环遍历全部待审(F-03)—— 采纳,当前工作修 | 契约 A 连带循环头加会话筛 + 第 5 条不变式;证明见「证明」第 2 条(反向臂 = 去掉筛即放行 B) | 无 |
| 同上 | 同上 | **#3 Major 核对基准合入后取不到**:守卫只在 `origin/alpha..HEAD` 里找上游父(F-16)—— 采纳,当前工作修 | 契约 D:`UPSTREAM_TAKEOVER_BASE` 记录在守卫里、受审集成推进、取不到即红从不跳过;提交与工作树都判;未推进基准时上游新行报红并提示推进 | 无 |
| 同上 | 同上 | 复核成立:F-01 四项、F-02 三项(会话 allow 盖过 agent deny 由生产 `Permission.evaluate` 探针复现;继承 `session.ts:314`;落库 `session/projector.ts:988`)、切片 B(promise 适配层 `:548` 直接传同一事件对象,读码) | 无需改;F-02、F-06 的「未实测 / 未单独实跑」由 R1 的探针与读码补强 | 无 |
| 派发更正(编排器,同日) | — | 路径改为 `docs/specs/upgrade-fewer-takeovers/design.md`、id 改为 `DESIGN-upgrade-fewer-takeovers`(文档合同:功能目录只放 spec/design/plan);A、C 落点 R-14 | `git mv` + 重生成 `docs/README.md` 索引 | 无 |

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| 项目里导入的技能目录在 2.x 不加载(调查 B2) | 调查按读码链推断,未实测;若属实是用户可见回归 | 不在 I-05 / U-03 范围;是 #1662 的回归候选,交编排器 | 编排器实测确认后按 #1662 缺陷处理 |
| 待办路由每次读整段会话找最后一次 `todowrite`(调查 C 末段) | 适配器本地性能 | 与接管无关 | I-04 改适配器时 |
| `packages/plugin/src/alpha-cloud-authority.ts` 可删(ADR-047 后果) | 清理 | 不是接管 | — |
