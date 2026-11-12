---
id: PLAN-upgrade-fewer-takeovers
title: 少改上游文件、留下的接管同步更省事(I-05)实施计划
summary: I-05 本 lane 的三个切片:A「本次会话内允许」进已接管的权限内核(连带只限本会话、不放行 Code Puppy 策略请求,适配器删替身);C 失败码前缀的统一读法;B 读目录卡由扩展从结构化结果生成。切片 D 不在本 lane
kind: plan
status: active
spec: ""
design: DESIGN-upgrade-fewer-takeovers
owners: [alpha-code desktop maintainers]
last_reviewed: 2026-11-12
---

# PLAN-upgrade-fewer-takeovers｜少改上游文件、留下的接管同步更省事(I-05)实施计划

由实施会话在计划阶段写,编排器核对后由同一会话实施。决定只链接、不重述;实施中偏离本段,在同一个提交里改本段。
设计 `docs/specs/upgrade-fewer-takeovers/design.md` 在分支 `design/upgrade-i05-fewer-takeovers` @ `0a1d9d2fdd`,不在本 lane 的基线里,
所以下文按「设计 §x」引用、不写相对链接(否则文档门报死链)。代码坐标取 `lane/1662-i05-slices` @ `4198d1a484`。
派发书要求每个切片一个提交,按 A → C → B 落地。

## 切片 A — 「本次会话内允许」进权限内核

- 依据:无 spec(内部工作;意图 [INT-upstream-upgrade-readiness @ 4c1b2c6](https://github.com/impharaon/alpha-work/blob/4c1b2c624b53619de97fa6bfa5679024d07abf17/docs/intents/INT-upstream-upgrade-readiness.md) I-05 / U-03 (a))。
  设计 @ `0a1d9d2fdd`:§4 契约 A(代码块、不变式 1–9、证明、消费方)、§5「A 的写入边界」「A 的连带」「已写入的会话规则」、§6 安全面、§9 A、§10 R-01–R-03、R-12–R-14;
  编排器派发书 `par-i05-slices`(2026-11-12)。Issue alpha-code#1662 正文 2026-11-12T06:42:12Z 版只作归属。下文 A1–A6 = 契约 A 不变式 1–6,A-消费方 = 契约 A「消费方」四条。
- 核对:`ed81202805` · 编排器 · 通过(每条不变式有带已知坏臂的证明、范围守住、未重述决定;裁决:上游测试按甲并加一条钉住清单的 Code Puppy 测试,切片 B 删尽文本回落与 P6;设计已获 owner 批准,2026-11-12「同意，界面数据约定和减少改上游文件两份方案都批准」)

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/schema/src/codepuppy-tool-policy.ts` | 加 `TOOL_POLICY_REQUEST_KEY` 与 `isCodePuppyPolicyRequest`,形状照契约 A 第二个代码块 |
| `packages/core/src/permission.ts` | 第二个标注块 `codepuppy(#1128 §4.4, I-05)`:服务闭包里的 `sessionGrants`(`:183` 旁);`reply` 的 always 分支以写 `sessionGrants` 取代 `saved.add`(`:402-408`);`evaluateInput` 的 `all` 末尾并入本会话放行(`:229`,deny 判定 `:228` 不动);连带循环头两道筛(`:413`);`close` 里清空(`:186-198`)。单行插入用行尾 `// codepuppy(I-05)`,import 同。`savedRules` 只读不写,保持 |
| `packages/ext/src/policy/gate.ts` | `confirm`(`:146`)与 `gateWithoutToolCall`(`:199`)写 `metadata` 的键改用 `TOOL_POLICY_REQUEST_KEY`(不变式 9) |
| `packages/ext/src/policy/index.ts` | evaluate 钩子的分流(`:167`)改用 `isCodePuppyPolicyRequest` |
| `packages/ext/src/policy/policy-host.cases.ts` | 多导出 `PermissionSaved` 并把它的节点放进宿主层(只用于断言「没写项目级保存」) |
| `packages/ext/src/policy/session-grant.test.ts`(新) | A1–A5 在真插件宿主上的证明(生产内核 + Session + Agent + 插件钩子),每条带一条能红的对照臂;本会话 / 另一会话 / 之后建的子会话 / 已配置 deny / 不写会话行与保存 / 审查场景 2 |
| `packages/ext/src/policy/session-grant-restart.test.ts`(新) | A4 的重启半场:真嵌入式引擎(`packages/ui-mac/engine/engine-embed.ts` 的 `startEngine` + 生产 `buildEngineServerOptions` / `withEngineAuthorization`,沿用 ext 测试预载的隔离根并先过 `assertEngineSandboxed`),同一个库文件关掉再起 |
| `packages/ext/src/policy/register-policy.test.ts` | E6 子任务命令段加 A6(审查场景 1),复用该段的 `/review` 配置、`children`、`pending` |
| `packages/ext/src/policy/session-grant-upstream-reds.test.ts`(新,裁决甲) | 跑下一节的三个上游文件,要求恰好登记的 10 条红、其余全绿(`tool-shell` 两条 I-05 前就红的容忍);判官先对合成 junit 证明会红 |
| `packages/ext/src/policy/permission-reply-premises.test.ts` | premise (ii) 按设计 §4 消费方末条改写:`(ii) one always reply emits …` 与 `(ii) one always reply publishes …` 两条的连带请求改在同一会话,另一会话的覆盖请求照旧待审;头注同步。条数不变(6) |
| `packages/ui-mac/src/engine-adapter/permission-replies.ts` | 「本次会话内允许」原样发 `always`;删 `allowForSession`、`releaseCovered`、`wildcardMatch`、`evaluateRules` 与 `Rule`;收窗改成契约 A 消费方第 2 条(回复前记本会话待审 → HTTP 回复返回后重读 → 「回复前在、回复后不在」的每条都收到 replied 或到 `SETTLE_MS` 收窗;`always` 与 `reject` 同一条);回执 = 目标 + 发出后到达、同会话、`reply` 等于本次决定的 replied;头注第 19–22 行改写。指纹、404、409、幂等、无 `save` 的 `always` 回冲突不动 |
| `packages/ui-mac/src/engine-adapter/permission-reply.test.ts` | 假引擎按内核新语义回 `always`(本会话放行 + 只连带同会话、发 `replied{always}`),PATCH 只记录不生效;「本次会话内允许」一段改写;删匹配器逐条比对与只测 `evaluateRules` 的反向臂(被测函数已删);真引擎断言换成重采的夹具 |
| `packages/ui-mac/test-fixtures/engine-adapter-sampler/sample.ts`、`README.md` | 剧本 6–7 拆成可单跑的 `permission`;第三会话改为 C1 `a.env`、C2 `ab.env`(都 `save ["a*"]`),对 C1 经适配器 v2 入口回 `always` 后再记 C 的待审、会话规则、`a.env` 再问、`b.env` 再问、另一会话问 `a.env`;剧本 6 的注释与 README 第 3、4 步改成「适配器原样发 always」 |
| `packages/ui-mac/src/engine-adapter/fixtures/permission-reply.json` | `sample.ts permission` 重采(只重写这一份;reject 那半随之换新 id,测试按夹具读 id) |
| `docs/architecture/2026-11-09-1662-permission-reply-measurements.md` | 推导规格第 3 条「for `always` across sessions」改为同一会话,第 5 条去掉「always ruling 另行处理」(设计 §4 消费方末条点名) |
| `docs/architecture/codepuppy-authority-registry.json` | 新在役项 `permission-session-grant`(机制 = `permission.ts` 的 I-05 标注块,L3;takeovers 记 v1 `packages/opencode/src/permission/index.ts`,F-01 的会话放行就在那里;证明 = 上面三个测试文件的具名用例);`adr033-receipt-premises` 的决定文字(always 只连带本会话)与改名的测试名 |
| `.claude/rules/adrs/ADR-047-opencode2-engine-generation.md` | 「精确接管面」`permission.ts` 一行:两个标注块、守卫加本段测试、回滚写明不得只回退本文件(设计 §9 A);权威保持表 52 → 53 项、新增一行、`adr033` 一行同步 |
| `scripts/gate-files.tsv` | 新增 `session-grant.test.ts`(6)、`session-grant-restart.test.ts`(1)、`session-grant-upstream-reds.test.ts`(2)三行(精确条数;都是登记册证明文件,`assert-authority-proofs.sh` 要求有行);`register-policy.test.ts` 行 58 → 59 |

### 编排器已裁决(甲):十条上游测试随契约 A 转红,不接管

契约 A 不变式 4 不再写 `PermissionSaved`;上游自己的测试断言「回 always 就写项目级保存」。临时目录里用 Bun 装载插件把 `packages/core/src/permission.ts` 换成契约 A 草稿(工作树不动)实跑:

- `packages/core/test/permission.test.ts`:122 → 8 红(`stores and removes saved resources for a project` `:368`;`always allow covers repeat execution and narrows prefix scope` 7 个夹具 `:806`)。上游 90 天 19 次改动。
- `packages/core/test/tool-shell.test.ts`:基线已有 2 红(`conditional substitutions respect once/always`,与本段无关),草稿多 1 红(`declarations reuse approvals while substitutions retain reject/once/always behavior` `:286`,断言 always 后 `saved.list()`)。上游 90 天 43 次改动。
- `packages/server/test/permission-saved.test.ts`:1 → 1 红(`edits saved permissions through PATCH`,注释自述「Saved permissions are only created by answering "always"」)。

三个文件都不在 `UPSTREAM_EXCLUDES`,也都不在本地门里(门只跑 `gate-files.tsv` 登记的 core 文件,`scripts/codepuppy-check.sh:189-196`);改它们 = 新接管,超出本 lane 范围(派发书冻结其它接管,设计 §10 R-08 定 12 个)。

| 选项 | 做法 | 代价与后续 |
| --- | --- | --- |
| 甲(推荐) | 不改上游测试;在 ADR-047 `permission.ts` 一行与登记册新项里写明「这 10 条上游测试断言被替换的项目级写入,已知为红」,附复现命令 | 零新接管、零同步代价;代价是有人整包跑上游测试会看到这 10 条红,靠登记的说明认出。与设计不变式 8「只读不写、与今天一致」同向 |
| 乙 | 三个文件成对接管(先例:`session-runner-retry.test.ts` 随 `to-session-error.ts`),只在 `codepuppy(I-05)` 标注处改那几条断言 | 接管 12 → 15;`tool-shell.test.ts` 上游 90 天 43 次改动,每日同步会更常停下等人工移植 |
| 丙 | 只接管 `packages/core/test/permission.test.ts`(ADR-047 第 59 行本就写它随 `permission.ts` 归组),其余两条按甲登记 | 接管 12 → 13;8/10 条回绿 |

裁决(编排器 2026-11-12):甲。在 ADR-047 与登记册新项里写明具名清单与复现命令,另加一条 Code Puppy 测试钉住清单(上表 `session-grant-upstream-reds.test.ts`)。

### 顺序

一个提交(派发书:每切片一个提交)。提交内的工作顺序:

1. 先写证明、看它在旧内核上红:`session-grant.test.ts`、`session-grant-restart.test.ts`、E6 新用例、premise (ii) 改写。旧内核就是「换回上游原文件」那一臂;预期红:A3(另一会话、子会话被放行)、A4(写了保存、重启后仍放行)、A5、A6、premise (ii)。A1、A2 在旧内核上本就绿(项目级保存同样按 save、同样排在 deny 之后),它们靠对照臂与第 6 步的变异证明能红。记下这次运行的输出。
2. schema 键与判定函数 → 内核标注块 → ext 写方 / 读方。跑:`cd packages/ext && bun test src/policy/session-grant.test.ts src/policy/session-grant-restart.test.ts src/policy/permission-reply-premises.test.ts src/policy/register-policy.test.ts src/policy/ask-deadline.test.ts src/policy/risk.test.ts`(后两个同用这个内核)。
3. 适配器与它的测试;改采样器,`SAMPLER_ENGINE_PORT` / `SAMPLER_MODEL_PORT` 避开别的 lane,跑 `bun packages/ui-mac/test-fixtures/engine-adapter-sampler/sample.ts permission`,记下剧本 6 打印的 `sessionScopedAlways`。跑 README 列的九个适配器测试文件(含 `permission-reply.test.ts`、`event-projection.test.ts`、`permission-shape.test.ts`)。
4. 测量文档、登记册、ADR-047、`gate-files.tsv`。跑 `src/policy/authority-registry.test.ts`;逐个新 / 改登记行的文件实测条数与登记一致。
5. `bun run --cwd packages/{schema,core,ext,ui-mac} typecheck`。提交。
6. 变异(提交后改、跑、`git restore packages/core/src/permission.ts` 复原):M1 去掉会话筛 ⇒ A5 红;M2 去掉策略请求筛 ⇒ A6 红;M3 把本会话放行并进 `rules`(deny 判定之前)⇒ A2 红;M4 always 分支改按 `resources` 记 ⇒ A1 红。

### 风险

- 上游测试转红:见上一节,未裁决前按甲。
- 收窗靠回复后重读:2.x 在 HTTP 回复返回前已发完这次回复的全部 replied(前提 ii),SSE 与回复是两条连接,帧可以晚到;收窗等「前在后不在」的每一条到齐或 2 s。假引擎的 `repliedAfterResponse` 臂改成同样覆盖 `always`。
- 采样器重采改写整份 `permission-reply.json`:只跑 `permission` 剧本,其它五份夹具不动;端口冲突用环境变量换。
- 重启测试与插件宿主在同一个 ext 测试进程:放在单独文件,嵌入式引擎显式给库路径与配置目录,起之前过 `assertEngineSandboxed`;不碰 `~/.local/share/opencode`。
- A6 依赖 ext 的 `holdAsk` 对已是 allow 的事件不锁(F-15):测试先用 `permission.allows` 证明那条策略请求此刻重判就是 allow(前提臂),否则场景空转、测试作废。A5 同理先证明另一会话那条此刻重判为 allow。
- 直接对引擎回 `always` 的策略请求(`register-policy.test.ts:743` 那条)改记本会话放行;该用例同一会话,仍绿。界面从不对策略请求发 `always`(冻结 `permission-v1-adapter.ts:108` 不给它们 `save`)。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| A1 | `session-grant.test.ts`「an always reply grants the request's save patterns for its action in this session; a resource outside them and another action still ask」「an always reply to a request without save grants nothing: the same request asks again」 | M4(按 resources 记)⇒ save 覆盖的另一资源仍要问,红 |
| A2 | `session-grant.test.ts`「a configured deny outranks the grant; the same allow written as a session rule overrides it (known-bad arm)」 | M3 ⇒ deny 的资源被放行,红;对照臂在测试内证明「放行进了已配置规则之后」确实盖过 deny(F-02 的形态) |
| A3 | `session-grant.test.ts`「another session and a child session created after the grant still ask; a session rule is inherited by that child (known-bad arm)」 | 旧内核(项目级保存)⇒ 另一会话与子会话直接 allow,红;对照臂证明子会话确实继承会话规则 |
| A4 | `session-grant.test.ts`「the grant writes neither the session's rules nor a saved approval」;`session-grant-restart.test.ts`「an always grant is gone after the embedded engine restarts; a session rule in the same database survives the restart (control)」 | 旧内核 ⇒ `PermissionSaved` 有一行、重启后同资源 allow,红;对照臂证明重启后库还在(否则「重启后要问」是空转) |
| A5(审查场景 2) | `session-grant.test.ts`「the always cascade leaves another session's pending request pending even when it now evaluates to allow」:会话 B 挂起一条,插件 evaluate 钩子把它改判 allow 并经 `permission.allows` 证实;会话 A 回 always ⇒ B 仍在 `permission.list()`、没有 B 的 replied | M1 ⇒ B 被放行并发 replied,红 |
| A6(审查场景 1) | `register-policy.test.ts` E6「an always reply to a read leaves the pending /review policy ask pending: no replied event and no child session」:配置 `* allow`、`read ask`,`builtin::subagent` 设 ask;同会话挂起 `/review` 子任务请求与一条 read;对 read 回 always ⇒ 策略请求仍待审、无它的 replied、`children` 为空;前提臂 `permission.allows` 证明它此刻重判为 allow | M2 ⇒ 策略请求被放行、子会话建出,红(R1 复现的形态) |
| 不变式 9 | `git grep -n 'policy: {\|"policy" in' -- packages/ext/src/policy/gate.ts packages/ext/src/policy/index.ts packages/core/src/permission.ts` 由今天的 3 处(`gate.ts:146`、`:199`、`index.ts:167`)变为零(`askedBy` 的取值 `"policy"` 不是这个键,不动;命令与输出进回执);行为上 A6 走生产写方与内核筛 | 写方另用字面量而筛用常量 ⇒ A6 的场景里筛认不出,红 |
| premise (ii) | `permission-reply-premises.test.ts`「(ii) one always reply emits a replied event for every request it resolves: the covered requests of its own session only」与「(ii) one always reply publishes the target's replied event first, then the cascaded ones」 | 旧内核 ⇒ 另一会话的覆盖请求也被放行,红 |
| A-消费方 | `permission-reply.test.ts`「本次会话内允许」段:引擎收到 `{decision:"always"}`、无 PATCH、无 once;回执 = 目标 + 同会话连带(覆盖不到的 bash 不在其中,连带帧晚于响应也收齐);无 save ⇒ 409 不发;真引擎夹具 `sessionAlways`:回执 `[c1, c2]`、C 无待审、会话规则 `[]`、`a.env` 再问 allow、`b.env` 再问 ask、另一会话问 `a.env` ask | 适配器仍走旧路径 ⇒ 引擎收到 once 与 PATCH,红;收窗不重读 ⇒ 连带 id 缺失或被 bash 拖满 2 s 后缺失,回执断言红 |
| 已知为红的上游测试 | `session-grant-upstream-reds.test.ts`「exactly the ten pinned upstream cases fail in those three files; every other case passes」与判官自检「the judge is not empty…」 | 上游改了这 10 条(改名、删、改成通过)或三个文件出新红 ⇒ 红;旧内核 ⇒ 10 条全变绿 ⇒ 「now passes」,红 |
| 端到端(采样器) | `sample.ts permission` 剧本 6 打印 `sessionScopedAlways` 与 `expected` 一致;剧本 7 的夹具即上一行的真引擎数据 | 采样直接读真引擎,不经测试替身 |

### 偏离记录

- 2026-11-12 · 裁决甲新增 `session-grant-upstream-reds.test.ts` 与它的登记行、登记册 / ADR-047 里的具名清单 · 编排器核对时的裁决 · 本切片提交。
- 2026-11-12 · `policy-host.cases.ts` 除导出外还把 `PermissionSaved.node` 放进宿主层(不在层里时测试拿不到这个服务)· 同上。
- 2026-11-12 · 重启测试起引擎后先等 build agent 带上 `read *.env` 的 ask 再问(插件在启动后才激活,之前问到的是缺 agent 的 deny,两头都证明不了)· 同上。
- 2026-11-12 · 适配器回复后重读待审失败时,记一行错误并改等「回复前在」的每一条(仍以 `SETTLE_MS` 为限),不让已落定的回复因为重读失败而报错 · 同上。
- 2026-11-12 · `permission-reply.test.ts` 的 v1 卡片用例不再断言 feed 收卡:v1 回复入口的收据只列目标,连带经投影的 replied 帧到达 feed(该文件 reject 段第三条覆盖);v2 用例断言收据含连带 · 同上。
- 合并时要调的登记行(本分支没有这些行):整合分支 `scripts/gate-files.tsv` 的 `packages/ui-mac src/engine-adapter/permission-reply.test.ts` 16 → 14(「本次会话内允许」段 5 条改为 3 条),描述里会话规则 + once 的说法改为原样发 always。


## 切片 C — 失败码前缀的统一读法

- 依据:设计 @ `0a1d9d2fdd` §4 契约 C、F-08、§10 R-05、R-07、R-14;派发书 Slice C。
- 核对:`ed81202805` · 编排器 · 通过(每条不变式有带已知坏臂的证明、范围守住、未重述决定;裁决:上游测试按甲并加一条钉住清单的 Code Puppy 测试,切片 B 删尽文本回落与 P6;设计已获 owner 批准,2026-11-12「同意，界面数据约定和减少改上游文件两份方案都批准」)

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/src/main/engine-session-turn.ts` | `:19` 拼进异常的改为 `parseFailureCode(message)?.text ?? message`(`@opencode/schema/codepuppy-net-failure`);认不出前缀原样不动 |
| `packages/ui-mac/src/main/engine-session-turn.test.ts` | 加一条直接测试:桩 `EngineClient` 返回引擎存下的 idle 形状,`error.message` 用生产 `withFailureCode("tcp", …)` 生成;断言抛出的原因是原文、不含 `[codepuppy:`;无前缀的原因原样 |
| `scripts/gate-files.tsv` | `engine-session-turn.test.ts` 行 1 → 2 |

其它读方逐处核过(`git grep` 读 `idle` 结局、`Mcp.Status.Failed.error`、`StructuredError.message` 的 Code Puppy 代码):适配器 `v1-shapes.ts:357`、`:364` 已经 `parseFailureCode`;主进程 `ext-mcp-activation.ts:89-93`、`:178-186`、`package-mcp-oauth.ts:60-63` 只读 `status` 不读 `error`;ext、冻结界面没有直接读引擎这两个字段的地方。只改这一处。

### 顺序

一个提交:先加测试、在现码上红(异常里带 `[codepuppy:tcp]`),再改 `:19`,再跑 `cd packages/ui-mac && bun test src/main/engine-session-turn.test.ts src/engine-adapter/failure-code.test.ts`,`bun run --cwd packages/ui-mac typecheck`。

### 风险

真引擎上造前缀要走 Transport 失败,会话运行器按退避重试约 67–101 s(`packages/core/src/model-retry.ts:22-36`),不适合进门;所以用桩客户端,前缀由生产 `withFailureCode` 生成、形状与 `engine-session-turn.cases.ts` 的真引擎 idle 一致。
`packages/ui-mac/src/main` 的体积棘轮在基线上已是 65083 > 64700(与本段无关),本段净增 2 行(import 与取原文那一行)。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| C | `engine-session-turn.test.ts`「引擎记下的失败带登记码前缀 ⇒ 抛出的原因是去掉前缀的原文(自动化失败摘要里不出现 [codepuppy:…]);没有前缀的原样」 | 不经 `parseFailureCode` ⇒ 异常(即自动化失败摘要)含 `[codepuppy:tcp]`,红(先红后绿) |
| C 读方完整 | 上面 `git grep` 的命令与结果进回执 | — |

### 偏离记录

- 2026-11-12 · 体积棘轮的净增行数由 1 改为 2(取原文单独成一行,比内联进模板串更好读)· 本切片提交。

## 切片 B — 读目录卡由扩展从结构化结果生成

- 依据:设计 @ `0a1d9d2fdd` §4 契约 B、§5「B 的写入边界」「历史(B)」、§9 B、§10 R-04;F-06、F-07;派发书 Slice B。
- 核对:`ed81202805` · 编排器 · 通过(每条不变式有带已知坏臂的证明、范围守住、未重述决定;裁决:上游测试按甲并加一条钉住清单的 Code Puppy 测试,切片 B 删尽文本回落与 P6;设计已获 owner 批准,2026-11-12「同意，界面数据约定和减少改上游文件两份方案都批准」)

### 需要编排器确认:旧记录的文本回落删不删

设计 §5「历史」:B 赶在 #1662 首发前落地,解析可删尽;首发之后才落地,则保留解析、只用于没有 `display` 的记录。本 lane 从未发布的 `engine/1662-opencode2` 开出、并回同一分支(`origin/alpha` 仍是 0.1.26 的 v1 线,F-14),按「首发前」**删尽**。
若编排器打算在 B 合入前就发布 #1662,改为保留 `directoryDisplay` 只在 `metadata.display` 缺席时用,并保留 P6 探针。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ext/src/policy/display.ts` | 新 `execute.after` 体 `attachDirectoryDisplay`:触发条件、形状与键名照契约 B;只加 `metadata.display`,不改 `output` 与正文,不抛错 |
| `packages/ext/src/policy/index.ts` | 在 `seal()` 里现有的 `execute.after`(`:220-224`)调用它,放在 `attachTerminal` 之前(后者展开已有 metadata,两键并存) |
| `packages/ext/src/policy/policy-host.cases.ts` | 导出上游 `ReadTool`,宿主层加 `ReadToolFileSystem.node`、`SessionInstructions.node`(依赖都已在宿主里),让真上游 read 在宿主里跑 |
| `packages/ext/src/policy/register-policy.test.ts` | 新一段,真上游 read 读真目录:首页、截断页、不装 ext 的反向臂、读文件与已有 `display` 不动 |
| `packages/ui-mac/src/engine-adapter/v1-shapes.ts` | 删 `directoryDisplay`、`DIRECTORY_HEADER`、`CONTINUE_LINE` 与调用(`:204-227`、`:245-246`);read 分支只补 `filePath`,`metadata.display` 原样透传;`:190-194` 注释同步 |
| `packages/ui-mac/src/engine-adapter/tool-shapes.test.ts` | `parity.json`「读目录」一条改写:存下的 read 带扩展写的 `display` ⇒ 目录网格;同一条不带 ⇒ 读文件卡(证明不再反解正文) |
| `packages/ext/src/upstream-probes/turn.test.ts` | P6 已无用(适配器不再反解正文;依赖改为 read 的 `ListPage` 到达 `execute.after`,由上面真上游 read 的用例钉住,上游改 `ListPage` 即红):删 P6 段与头注第 7–9 行 |
| `scripts/gate-files.tsv` | `register-policy.test.ts` 行 59 → 63 |

### 顺序

一个提交:先写 `register-policy.test.ts` 新段(现码上首页 / 截断页两条红:没有 `display`),再加写入点并接线,再删适配器解析、改 `tool-shapes.test.ts`、删 P6。跑:
`cd packages/ext && bun test src/policy/register-policy.test.ts src/upstream-probes/turn.test.ts`;
`cd packages/ui-mac && bun test src/engine-adapter/tool-shapes.test.ts src/engine-adapter/tool-display.test.ts src/engine-adapter/event-projection.test.ts src/engine-adapter/turn-diffs.test.ts`;
`bun run --cwd packages/{ext,ui-mac} typecheck`。变异:去掉 `index.ts` 里那次调用 ⇒ 首页、截断页两条红,`git restore` 复原。

### 风险

- 宿主多挂两个节点可能影响 `register-policy.test.ts` 其它用例:整文件跑。
- 条目顺序取引擎顺序(契约 B),期望值手写,顺序以真上游 read 在测试目录上的实测为准,不从生产函数推。
- 开发构建里本分支在 B 之前存下的目录读取没有 `display`,删尽后回落读文件卡(设计 §5 认可);正式版用户没有这类记录(F-14)。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| B 首页 | `register-policy.test.ts`「a directory read carries the 0.1.26 directory display built from the listing: every entry, directories marked, offset 1 and the total」 | 没有写入点 ⇒ 无 `display`,红 |
| B 截断页 | 「a truncated page carries its offset, truncated true and no total」 | 同上;编造总数 ⇒ `totalEntries` 断言红 |
| B 反向臂 | 「reverse arm: without Code Puppy's extension the same directory read carries no display」 | 证明首页那条的 `display` 来自扩展而不是上游 |
| B 不越界 | 「a file read, and a read that already carries a display, are left as they are」 | 无条件写 ⇒ 文件读取多出目录卡或覆盖已有 `display`,红 |
| B 适配器 | `tool-shapes.test.ts` 改写那条:带 `display` ⇒ 目录网格(3 项、目录带标记);不带 ⇒ 读文件卡 | 保留文本反解 ⇒ 不带 `display` 那半仍出目录卡,红;透传坏了 ⇒ 带 `display` 那半红 |

### 偏离记录

暂无
