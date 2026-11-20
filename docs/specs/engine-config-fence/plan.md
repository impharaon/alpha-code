---
id: PLAN-engine-config-fence
title: 对话改不了决定运行什么程序、哪些工具免问、凭据交给谁的配置 实施计划
summary: 片 ①:引擎不再采用引擎库里的项目级已存批准、会话行上的 allow / ask 规则与 wellknown 缓存的配置文档(L1–L3),只改两个已接管的引擎文件;其余各片另起一节。
kind: plan
status: active
spec: SPEC-engine-config-fence
design: DESIGN-engine-config-fence
owners: [owner]
last_reviewed: 2026-11-20
---

# PLAN-engine-config-fence｜对话改不了决定运行什么程序、哪些工具免问、凭据交给谁的配置 实施计划

## 片 ①:引擎不认三类库内记录(L1–L3)

- 依据:SPEC-engine-config-fence v1(owner 2026-11-20 批准)BR-02、AC-03,以及 BR-04 中本片可能碰坏的部分;DESIGN-engine-config-fence §2 P-06、§4.6、§6 I3 / E4 / E7、§10 D8、D9、D12 ①(两份文件 @ `3f36883278`,在 `docs/credential-and-config-fence` 工作树,另行合入主线,所以这里不写链接);INT-safety I-13;派单没有给 Issue 编号。实施期设计返还 D16(设计方修订片段 `~/.cache/alpha-orch/2026-11-19/config-fence-design/r3/design-delta.md` §1–8,证据 `r3/SESSION-ROW.out`、`r3/SNAPSHOT-ROW.out`):会话行「只取 deny」落在会话行的每一处读取 —— 引擎 `configured()`、ext `ruleset()` 的返回点、引擎会话上下文 `session/context.ts:136`;编排器 2026-11-20 把前两处放进本片;第三处是新的上游接管,owner 2026-11-20 同意(经编排器转达:「两件都同意」),也在本片。读码基线 `origin/alpha` @ `887748b52c`。
- 核对:Phase: IMPLEMENT — plan `7694dc2aa0` · orchestrator / Claude Fable 5.2 · 通过(L1、L2 在引擎判定点、L3)。裁决:ADR-047「精确接管面」两行按 I-05 先例追加,获准,`.claude/rules` 下不改别处;三个 ext 证明测试、`KNOWN_RED` 10 → 74、登记册与闸门行按计划,增补名单的提交要逐文件写明为何变红、并说明怎样核对过没有夹带别的原因的红;E7 前提不成立,七个用例不改,记入偏离;`config.test.ts` 的 5 条只列名、不加判官;`sample.ts:212` 不动,记入偏离;ext 自读会话行与 wellknown 刷新两项交设计方,本片不碰 `packages/ext` 生产代码。

PLAN 阶段只提交本文件。下面的命令与结论分两类:「实测」是本阶段在临时克隆(`cp -cR` 克隆本工作树、只改克隆里的两个文件)里跑出来的,原始输出在 `IMP/` = `~/.cache/alpha-orch/2026-11-19/impl-fence-slice1/exp/out/`;其余是实施安排,还没有在本分支上运行。

### 计划阶段实测(临时克隆,同一机器上另有一个完整门在跑)

| 编号 | 做法 | 结果 |
| --- | --- | --- |
| M1 | L3 的效果(派单要求补测):嵌入式真引擎 + 生产注入 + 真 ext,不加围栏;引擎首次启动建库后停掉,往库里写 `wellknown:sources = ["http://127.0.0.1:9"]`、`wellknown:manifest:<来源> = {}`、`wellknown:config:<来源> = [{ mcp: { planted: { type: "local", command: [bun, -e, 写标记文件] } } }]`,再启动 | 没有 L3:`/api/mcp` 列出 `planted:pending`,命令真的执行了(标记文件出现)(`IMP/l3-base.log`)。有 L3:列表里没有它,命令没执行(`IMP/l3-mut.log`) |
| M2 | 打上 L1+L2 后跑派单点名的七个在会话行上写 `allow *` 的真引擎宿主:package-effect、created-plugin、install-from-source、package-mcp-oauth、plugin-entrypoints、endpoint-route,外加设计没点名的 `test-component/official-connectors.cases.ts:1044`(宿主 `official-connectors.test.ts`) | 七个全绿、条数不变(`IMP/eng-*.log`、`IMP/official.log`)。这些会话行不承重:用例里的工具调用本来就被 build 助手放行。**设计 E7「不改就会停在审批上」的前提不成立,本片不改这七个用例。** |
| M3 | 打上 L1+L2 后跑 `session-grant-upstream-reds.test.ts` 钉住的三个上游文件 | `permission.test.ts` 新红 44 条、`tool-shell.test.ts` 新红 20 条(都只由 L1 引起,只打 L2 时与基线同为 11 红,`IMP/core-perm-l2.log`);`server/test/permission-saved.test.ts` 不变。名单在 `IMP/new-reds.txt`。core 两个文件耗时从 7 s 涨到 111 s(20 条 tool-shell 用例各等满 5 s 的询问) |
| M4 | 打上 L3 后跑引用 wellknown 的 core 测试 | `test/config/config.test.ts` 新红 5 条(`layers integration documents below remote and user config and reloads when they change`、`keeps only the policies of documents from integrations managed policy denies`、`tolerates unavailable authenticated wellknown config and reloads it later`、`keeps the last resolved wellknown config across failures and restarts until its source is removed`、`logs redacted source-aware diagnostics for every config source`);基线 52/52 绿。这个文件不在门里 |
| M5 | 打上 L1–L3 后跑 ext 的相关测试 | 只有三条红,都是把旧行为当作对照臂写的:`session-grant.test.ts` 两条 known-bad arm、`session-grant-restart.test.ts` 的会话规则对照(`IMP/ext-mut.log`、`IMP/ext-restart-mut.log`)。`unattended-policy`、`register-policy`、`permission-reply-premises`、`ask-deadline` 全绿 |
| M6 | 打上 L1–L3 后跑其余引用已存批准或会话权限的上游测试(core:browser-attach、plugin/plan、plugin/provider-opencode、schedule、session-create、skill/instructions、subagent-lifetime、config/agent;server:config、fetch、session-instances) | 全绿 |

### 真实流程核对(派单要求:有没有产品流程依赖 L1 / L2 / L3 关掉的东西)

结论:没有。

- 「始终允许」:审批卡回 `always`,经适配器原样发给引擎(`engine-adapter/opencode2/routes.ts:492-511`),落在权限服务内存里的会话内放行(`permission.ts:182-187` 与 `:407-412`,I-05),不写会话行,也不写已存批准。设置页的「启用 / 每次询问 / 停用」写 ext 的工具策略文档。两者都不受 L1 / L2 影响。
- 已存批准:`PermissionSaved.add` 在源码里没有调用方(`grep` 只命中它自己 `permission/saved.ts:69`);服务端只有 list / update / remove 路由;适配器的路由表里没有它们。旧 v1 的 `permission` 表在迁移里删掉后重建为空表(`20260601202201_amazing_prowler`、`20260602002951_lowly_union_jack`),没有导入。
- 会话行:产品唯一的写法是自动化解析会话的那条 `deny`(`automation-llm.ts:54`),L2 照样生效。适配器建会话、改会话都不带权限(`opencode2/routes.ts:293-301`、`:309-315`)。ext 不经插件接口建会话,也不改会话权限。子会话继承父会话的会话行(`session.ts:314`),而产品里的父会话会话行只会是空或 `deny`。
- wellknown:`packages/ui-mac/src`、`packages/codepuppy-app/src`、`packages/ext/src` 里没有任何登记或读取它的代码,只有 `engine-explicit-config.ts:3` 一行讲装载顺序的注释;适配器不服务登记路由;唯一的历史来源 `auth.json` 导入,主进程在 fork 前就拒绝了(`server.ts:517`、`:534`)。
- 0.2.6 的「助手查找与查状态不再弹审批」用的是档位的 agent 级 allow,不是会话行或已存批准。

### L2 的落点(审查 R1 第 9 项;D16 修订)

计划阶段的结论(下面的 D16 修订已把 ext 读取处并进来):L2 在引擎判定处生效:`permission.ts` 的 `configured()`(`:217-222`)。不在两处共同读取的地方(`SessionStore` / `session/info.ts:49` 或 `session/context.ts:136`)。理由:

1. 共同读取处都是没有接管的上游文件,改它们要另立 ADR(ADR-029 §3),超出派单两个文件的范围;在 store 层过滤,还会改变冻结路由返回的内容和子会话继承到的内容。
2. 可见性只按「整个工具被拒」筛(`tool.ts:381-384` 的 `whollyDisabled`)。被植入的 allow / ask 最多让一个 agent 拒掉的工具出现在模型面前;真正执行时,引擎内置工具与 MCP 工具在自己的执行体里调 `Permission.assert`(如 `tool/plugin/shell.ts:127`、`tool/mcp.ts:74`),交互档里 ext 的 `confirm` 对每次调用都以 canonical 身份调一次 `assert`(`ext/src/policy/gate.ts:186`)。`assert` 走 `configured()`,只认 `deny`,所以 agent 的拒绝照旧成立。
3. 只读档:植入的 `ask edit *` / `allow edit *` 能让编辑工具出现,但调用时只读档的静态 `deny` 照样拒绝(core 用例 L2 断言 `deny`)。
4. 子助手:子会话继承父会话的会话行(`session.ts:314`),判定时经同一个 `configured()`,所以继承来的 allow 不放行。改过的 `session-grant.test.ts` 第二条在真内核上断言这一点(子会话照问,同时断言会话行确实复制过去了)。

**D16 修订(2026-11-20)。** 上面第 1–4 条只说到引擎判定处。设计方查实会话行还有两处读者,改为三处都只取 deny:

- **ext `ruleset()`**(`packages/ext/src/policy/index.ts:123-136`,返回在 `:135`,本片):在返回点过滤一次,交互与无人值守两个分支共用这一处。交互分支读 `session.data.permissions`,插件的 `session.get` 返回会话本身(`plugin/host.ts:586`),今天就读不到东西,这里不改它的读法。无人值守分支读得到会话行;闸门判定放行后直接返回,不再调引擎判定(`gate.ts:171`、`:329`)。所以今天被植入的会话行 allow 能盖过 agent 规则里的身份 deny,工具照常执行(`SESSION-ROW.out` 的 `ran writes=1`)。
- **引擎会话上下文**(`packages/core/src/session/context.ts:136`,本片,新接管一行):它决定本次请求里有哪些工具(含 Code Mode 目录)、技能和连接器说明,不经过 `configured()`;插件工具自己不调引擎判定,整工具拒绝只靠这一处(`SNAPSHOT-ROW.out`)。那一行同样只并入会话行的 deny,行尾标注 `codepuppy(I-13 L2)`;接管登记见「改动」。
- `schedule/check.ts:301` 在固定关闭的实验开关后面,不改(D16)。
- wellknown 来源仍会收到不带凭据的 manifest 请求:设计方记为残留 R9,接受,L3 不变。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/core/src/permission.ts` | **L1**:删掉 `saved` 绑定(`:180`)和 `savedRules`(`:207-215`),`evaluateInput` 的 `all`(`:235`)不再并入已存批准,原位留一个 `codepuppy(I-13 L1)` 标注块(一句理由,指向设计 §4.6);行尾标注改为 `codepuppy(I-05, I-13 L1)`。`PermissionSaved` 的 import 与 `node` 的依赖不动:服务与路由照旧,接管文件里少动一行。**L2**:`configured()`(`:221`)里的 `session.permissions` 只取 `effect === "deny"` 的条目,用 `codepuppy(I-13 L2)` 标注。两处都按既有标注块的形状写 |
| `packages/core/src/config.ts` | **L3**:load 链(`:353-367`)不再调 `loadWellknown`,`gate.finish` 列表删掉 `...wellknownDocuments.flat()`(`:372`),原位留一个 `codepuppy(I-13 L3)` 标注块。core 开了 `noUnusedLocals`(`packages/core/tsconfig.json`),所以同时删掉只服务于它的 `loadWellknownEntry`(`:178-213`)和 `loadWellknown`(`:215-228`),原位留一行标注指向 load 链。`WellKnown` 服务、wellknown 插件、`Credential.Event.Switched` / `WellKnown.Event.Updated` 订阅、10 分钟刷新都不动 |
| `packages/core/test/codepuppy-engine-db-records.test.ts`(新) | 在引擎真实服务上判 L1–L3,共 3 条。每条带一个对照,证明植入的那条记录如果被采用就会放宽或装载:**L1** 往 `permission` 表插 `shell / *`,判定仍是 `ask`;已存批准照样能列出(冻结的服务不变);对照是用引擎自己的 `Permission.evaluate`、按上游的并入方式算同一条记录,得到 `allow`。**L2** 会话行 `allow shell *` ⇒ 仍是 `ask`;agent `deny edit *` 加会话行 `ask edit *` / `allow edit *` ⇒ 仍是 `deny`;agent `allow *` 加会话行 `deny subagent *` ⇒ `deny`(自动化解析会话的写法照常生效);对照同样用 `Permission.evaluate`。**L3** 真 `WellKnown` 服务 + 持久 KV 里放来源、缓存清单与带本地 MCP 的缓存配置文档 ⇒ `Config.entries()` 里没有这个 MCP;对照是把同一份文档作为内联文档(`Config.configured({ content })`,即 Code Puppy 注入用的那一层)交给配置 ⇒ 有。环境搭法照抄上游 `test/permission.test.ts` 与 `test/config/config.test.ts`(持久 KV + `AppNodeBuilder`) |
| `packages/ui-mac/src/main/engine-db-records.engine.cases.ts` + `engine-db-records.engine.test.ts`(新) | AC-03 的真引擎用例:整个子进程装生产渲染的围栏 profile 与真 `.node`,外加真引擎、真 ext 和模型桩,形状同 `fence-write-denied.engine.{cases,test}.ts`,只在 darwin 上跑。全部植入都由引擎自己的 shell 工具在「全部批准」档执行(这就是被围栏的 shell):`sqlite3 <库> < <测试写好的 .sql>`。3 条用例:**已存批准**(项目 id 取自 `GET /api/session/:id`)、**会话行 allow**(植入后 `GET /api/session/:id` 能读到这条规则)、**wellknown 三件套**(来源指向关着的本机端口,清单与配置文档同 M1)。前两条接着在「请求审批」档(`codepuppy-ask`)让模型调一次 shell,断言出现了 `shell` 询问,而且命令没有执行;第三条重启引擎(在同一个库上 `close` 再 `start`,即「重新装载配置」),断言 `/api/mcp` 里没有它、标记文件不存在。每条先从测试进程只读打开库,确认记录真的写进去了,保证用例不是空跑。宿主钉住 3 pass / 0 fail |
| `packages/ext/src/policy/index.ts`(D16 加入) | `ruleset()` 的返回点只把会话行里 `effect === "deny"` 的条目并到 agent 规则之后,交互与无人值守两个分支共用这一处;读法不变 |
| `packages/core/src/session/context.ts`(D16 第三处,新接管) | `:136` 一行:会话行只把 `deny` 条目并进决定本次请求工具表 / 技能 / 连接器说明的规则,行尾标注 `codepuppy(I-13 L2)`;文件其余不动 |
| 接管登记(D16 第三处) | `scripts/north-star-guard.sh` 的 `UPSTREAM_EXCLUDES` 加一条(注释带 owner 原话「两件都同意」);ADR-047「精确接管面」加一行(为什么挂不了钩子:合并发生在会话上下文内部,插件钩子在那之后才拿到工具表);登记册 `engine-db-records-not-honoured` 补上接管文件、批准原话、机制与证明(反向臂:换回上游原文件 ⇒ 会话上下文那条红) |
| `packages/ext/src/policy/session-row-rules.test.ts`(新,D16) | ext 读取处的 L2,共 4 条,环境同 `unattended-policy.test.ts`(生产权限服务 + Promise 适配器 + 执行链;工具带 MCP 身份、执行体不调引擎判定):对照,无人值守标准档里没有规则拒绝时工具照常执行;**E4 第一臂**,agent 规则拒了工具身份,植入会话行同身份 allow ⇒ 仍被拒(`cap-hard-deny`)、零副作用;会话行 deny(自动化解析会话自己写的那种)在交互档(引擎 `Permission denied`)与无人值守档(`cap-hard-deny`)都照样拒绝。会话行经会话存储写入 —— 与 `sqlite3` 改的是同一列;无人值守会话只在自动化运行当中存在,真引擎宿主里插不进去。D16 第三处再加 3 条(共 7 条),经真 `SessionContext.select` 与选出的工具执行:对照,没有规则拒绝时两个插件工具(一个直接、一个在 Code Mode 目录里)都出现并执行;**E4 第二臂**,agent 规则拒了它们的权限动作,植入会话行 allow ⇒ 不在请求里、不在 Code Mode 目录里、调用不执行;会话行 deny 照样把它们拿掉 |
| `packages/ext/src/policy/unattended-policy.test.ts`(D16 带出) | 「`standard {"sessionAsk":true}` 立即具名拒绝」把规则轴上的 ask 写在会话行上;ext 过滤之后会话行的 ask 不参与,这条就不再拒绝。改为把同一条 ask 写在 agent 规则里(选项改名 `agentAsk`),规则轴 ask 在标准档立即拒绝这项保证不变;无人值守分支确实读当前会话行,由 `session-row-rules.test.ts` 的无人值守 deny 那条证明。条数不变 |
| `packages/ext/src/policy/session-grant.test.ts` | 两条 known-bad arm 写的正是 L2 取代的旧行为。改成断言新行为并改名:`… the same allow written as a session rule does not override it either (I-13 L2)`(期望 `deny`);`… a child inherits a session-rule allow, which allows nothing (I-13 L2)`(先断言子会话的会话行就是那条 allow,再期望 `ask`)。条数不变 |
| `packages/ext/src/policy/session-grant-restart.test.ts` | 对照改用会话行上的 `deny read a.env`:重启前、重启后都是 `deny`,同样证明用的是同一个库。用例名不变,头注释同步 |
| `packages/ext/src/policy/session-grant-upstream-reds.test.ts` | `KNOWN_RED` 增加一组「I-13 L1」:M3 实测的 64 条名字,按文件列。用例名与头注释里的「ten」改为不带数字的说法,并写明两组来源(I-05 裁决甲、I-13 L1)。容忍组不变 |
| `docs/architecture/codepuppy-authority-registry.json` | `permission-session-grant`:同步两条改过名的测试名;`note` 补上 I-13 L1 的已知红与复现命令。新增一项 `engine-db-records-not-honoured`:写明决定、依据(ADR-047、ADR-048)、I-13、两个接管文件、批准原话(owner 2026-11-14 U-10「全部按你的推荐。」;规格 v1 2026-11-20「两份都批准」);机制文件 `packages/core/src/permission.ts`,阶梯 L3,ladder 文本写明 L3 在 `config.ts`;证明测试是新 core 测试 3 条、AC-03 宿主和 `session-grant.test.ts` 改名后的两条 |
| `scripts/gate-files.tsv` | 新增两行:`packages/core test/codepuppy-engine-db-records.test.ts`(精确条数 3)、`packages/ui-mac src/main/engine-db-records.engine.test.ts`(1,带 `[平台:darwin]`)。同步三行的保证文字:`session-grant-upstream-reds`(登记的红从 10 条改为 10 + 64 条)、`session-grant`(对照臂的说法)、`session-grant-restart`(对照臂改为 deny)。这三行条数不变 |
| `scripts/north-star-guard.sh` | 只改注释:`:132-135`(permission.ts)与 `:171-175`(config.ts)的接管面说明各补上 I-13 的标注块。`UPSTREAM_EXCLUDES` 一行不改,条数不变 |
| `.claude/rules/adrs/ADR-047-opencode2-engine-generation.md` 的「精确接管面」两行(`:172` permission.ts、`:181` config.ts) | **需要编排器在核对时明确同意**:这个目录是受保护的运行期规则资产(仓库 `AGENTS.md`)。在「守卫」列只追加不改写:补上 I-13 标注块、证明测试、已知红(L1:钉住文件里的 64 条;L3:`config.test.ts` 的 5 条,不在门里)和回滚说明(整片一个提交回退)。先例是 I-05 提交 `f344a2bdb1`,它在同一个功能提交里改了同一行。如果不同意,就删掉这一行改动,记录只留在登记册的 `note` 里 |

不改(实测过):M2 的七个真引擎用例;`test-fixtures/engine-adapter-sampler/sample.ts:212`(在会话行上写 `ask *`,是录样本的脚本,不是测试,没有跑,记作观察)。

### 顺序

1. **测试先红(提交 A)**:新 core 测试、AC-03 宿主与用例、`gate-files.tsv` 两条新行;同一个提交里填好本节的「核对」行。在未修复的代码上运行:
   - `cd packages/core && bun test test/codepuppy-engine-db-records.test.ts`:三条规则的断言都红,对照都绿;
   - `cd packages/ui-mac && bun test src/main/engine-db-records.engine.test.ts`:子进程 3 fail(植入的记录全部生效)。
   红色输出摘要写进提交说明。
2. **修复(提交 B,不改提交 A 的测试)**:`permission.ts` 的 L1 / L2、`config.ts` 的 L3,以及同一事实要同步的全部内容:三个 ext 测试、`KNOWN_RED`、登记册、`gate-files.tsv` 的保证文字、守卫注释、ADR-047 两行(经同意时)。登记册里的测试名与测试文件必须同一个提交改,否则 `authority-registry.test.ts` 红。跑下面的相关检查,全绿。
3. **每条规则各自的反向臂(不提交)**:每次只撤掉一条规则(临时改,再用 `git restore` 恢复那一个文件),跑 core 测试和 AC-03 宿主:撤 L1 ⇒ L1 两条红;撤 L2 ⇒ L2 两条红;撤 L3 ⇒ L3 两条红;其余保持绿。结果写进回执。

4. **D16 · ext 读取处,测试先红(提交 C)**:`session-row-rules.test.ts` 与它的闸门行(精确条数 4)。在没有过滤的 ext 上运行,E4 第一臂红(工具执行了,`writes` 为 1),其余三条绿。
5. **D16 · ext 过滤(提交 D,不改提交 C 的测试)**:`index.ts` 的返回点过滤、登记册 `engine-db-records-not-honoured` 补上机制与证明、本节的 D16 修订。跑 `session-row-rules.test.ts`、`unattended-policy.test.ts`、`register-policy.test.ts`、`authority-registry.test.ts` 与 ext 类型检查。撤掉这一处过滤 ⇒ E4 第一臂红。
6. **AC-03 反向臂隔离(提交 E)**:「已存批准」那条用完即经引擎路由删掉植入的记录(见偏离记录)。
7. **会话上下文(提交 F / G;owner 2026-11-20「两件都同意」)**:F 先提交 E4 第二臂(红,`direct` / `catalogue` 为 true、`runs` 为 2),G 再提交 `:136` 一行加接管登记,不改 F 的测试。复查:钉住的上游已知红名单不变(判官 2/2);core 里引用会话权限或会话上下文的上游测试 9 个文件 178 条全绿;M2 的七个真引擎宿主与 AC-03 宿主复跑。
8. **小修(提交 H)**:两处过时注释(`ui-mac/src/main/engine-explicit-config.ts:3`、`ext/src/policy/gate.ts:11`),只改注释。

相关检查(只跑这些,不跑整包、不跑门;机器上有门在跑时 bun 加 `--max-concurrency 2`):

- `cd packages/core && bun test test/codepuppy-engine-db-records.test.ts`
- `cd packages/ext && bun test src/policy/session-grant.test.ts src/policy/session-grant-restart.test.ts src/policy/session-grant-upstream-reds.test.ts src/policy/authority-registry.test.ts src/policy/permission-reply-premises.test.ts src/policy/ask-deadline.test.ts src/policy/register-policy.test.ts src/policy/unattended-policy.test.ts`(`session-grant-upstream-reds` 在子进程里跑 core 的 `permission.test.ts`、`tool-shell.test.ts` 与 server 的 `permission-saved.test.ts`,要求恰好是登记的那些红)
- `cd packages/ui-mac && bun test src/main/engine-db-records.engine.test.ts src/main/north-star-guard.test.ts src/main/local-gate-parity.test.ts src/main/old-name-scan.test.ts`,另在本分支上复跑 M2 的七个宿主一次:`package-effect`、`created-plugin`、`install-from-source`、`package-mcp-oauth`、`plugin-entrypoints`、`endpoint-route`(`*.engine.test.ts`)和 `official-connectors.test.ts`
- 对新行与改过文字的行,各用 `bash scripts/bun-test-floor.sh <条数> <目录> <文件>` 核对精确条数
- `bash scripts/north-star-guard.sh`
- `bun run --cwd packages/core typecheck`、`bun run --cwd packages/ext typecheck`、`bun run --cwd packages/ui-mac typecheck`

### 风险

- **L1 让钉住的上游名单从 10 条涨到 74 条,判官变慢**:core 子进程实测 111 s(机器有负载),用例时限是 240 s。实施时再量;超过 200 s 就停下,把数字交给编排器,不自己放宽时限。
- **L3 让 `config.test.ts` 五条上游用例变红**:这个文件不在门里,所以不会拦住门。按 I-05 裁决甲的同一种处置:不接管上游测试,记进 ADR-047 / 登记册。要不要再给它钉一个判官,写在「可选」里,不在本片做。
- **围栏宿主**:要编 `.node`、只在 darwin 上跑、装上就拆不掉,所以必须是独立子进程(照搬 `fence-write-denied`)。wellknown 插件启动时会对植入的来源发一次清单 GET:来源指向关着的本机端口,马上失败,退回缓存清单;围栏下的出网代理本来也会拒绝。
- **接管面变大**:删掉两个只服务于 wellknown 的辅助函数,会让上游同步时 `config.ts` 这一段需要人工移植。ADR-047 那一行和守卫注释会写明这一点。
- **没有修的残留**(记作观察):植入的 wellknown 来源仍会让引擎在启动、凭据切换和 10 分钟刷新时对它发不带凭据的清单 GET;如果清单带 `auth`,wellknown 插件还会登记一个 command 类登录方法,而适配器不服务 command 登录。ext 自己读会话行(见上文「L2 的落点」)。

### 证明

| AC | 测试 / 证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-03 / BR-02 已存批准(L1) | `codepuppy-engine-db-records.test.ts` 的 L1 条;AC-03 宿主「已存批准」条 | 没有 L1:判定并入已存批准,`shell` 不再询问(设计实测 `K-change.json` A4;提交 A 的红输出;步骤 3 撤 L1 那一臂) |
| AC-03 / BR-02 会话行(L2) | core L2 条(allow 不放宽、ask 不放松只读档的 deny、deny 照常生效);AC-03 宿主「会话行 allow」条;`session-grant.test.ts` 改名后的两条 | 没有 L2:会话行的 allow 排在 agent 规则之后获胜,`shell` 不询问(A4b);`ask` 把 `deny` 放松成询问;子会话继承的 allow 放行(步骤 3 撤 L2 那一臂) |
| AC-03 / BR-02 wellknown(L3) | core L3 条;AC-03 宿主「wellknown」条 | 没有 L3:重启后 `planted` 出现在 `/api/mcp`,命令真的执行了(M1 `IMP/l3-base.log`;步骤 3 撤 L3 那一臂) |
| AC-03 / BR-02 会话行(L2,ext 读取处,D16) | `session-row-rules.test.ts` 的 E4 第一臂;同文件两条会话行 deny | 没有 ext 过滤:无人值守标准档里植入的会话行 allow 盖过 agent 的身份 deny,工具执行(`SESSION-ROW.out`;提交 C 的红输出);过滤如果连 deny 也滤掉,无人值守那条 deny 就不再拒绝 |
| AC-03 / BR-02 会话行(L2,会话上下文,D16) | `session-row-rules.test.ts` 的 E4 第二臂;同文件的会话行 deny 那条 | 没有那一行:agent 拒掉的插件工具在植入会话行 allow 之后出现在请求与 Code Mode 目录里并执行(`SNAPSHOT-ROW.out`;提交 F 的红输出);连 deny 一起滤掉 ⇒ deny 那条红 |
| BR-02 冻结的面 | core L1 条断言已存批准照样能列出;AC-03 宿主断言 `GET /api/session/:id` 照样返回会话行规则 | 改动如果误伤了服务或路由,列出或读取就会失败 |
| BR-04(本片能碰坏的部分) | core L2 条断言会话行 `deny` 照样拒绝;`session-grant*.test.ts` 断言「始终允许」的会话内放行照常;M2 七个宿主复跑全绿 | L2 如果把 `deny` 也滤掉,自动化解析会话的 `deny subagent` 就失效,core 断言红;会话内放行一旦受影响,`session-grant` 的前几条就红 |

### 反向臂实测(步骤 3,2026-11-20,每次只撤一条,用 `git restore` 恢复;日志在 `IMP/ko-*.log`)

| 撤掉 | core `codepuppy-engine-db-records.test.ts` | AC-03 宿主子进程 | 其他 |
| --- | --- | --- | --- |
| L1 | L1 条红,2 pass / 1 fail | 「已存批准」条红(`asked` 为 `[]`),2 pass / 1 fail | — |
| L2 | L2 条红,2 pass / 1 fail | 「会话行」条红(`asked` 为 `[]`),2 pass / 1 fail | `session-grant.test.ts` 改名后的两条红 |
| L3(`config.ts` 换回 `887748b52c`) | L3 条红,2 pass / 1 fail | 「wellknown」条红(`/api/mcp` 里有 `planted`),2 pass / 1 fail | — |
| ext 过滤 | — | — | `session-row-rules.test.ts` 的 E4 第一臂红(`writes` 为 1),3 pass / 1 fail(当时 4 条) |
| `session/context.ts:136`(换回 `887748b52c` 的文件) | — | — | `session-row-rules.test.ts` 的 E4 第二臂红,其余 6 条绿(`IMP/ko-CTX-ext.log`) |

### 偏离记录

- 2026-11-20 · core 测试 L3 的对照由「集成文档」改为「内联文档」 · 集成文档会丢掉本地服务器(`packages/core/src/config/integration.ts:115-120`),拿它作对照永远看不到连接器,对照就不成立 · 提交 A。
- 2026-11-20 · L1 另删掉 `permission.ts:177` 的 `const location = yield* Location.Service` · 它只服务于被删的 `savedRules`,不删就过不了 core 的 `noUnusedLocals`;`Location` / `PermissionSaved` 的 import 与 `node` 依赖照旧不动 · 提交 B。
- 2026-11-20 · L1 删掉的 `saved` 绑定(`permission.ts:180`,`const saved = yield* PermissionSaved.Service`)同样只服务于 `savedRules`;两处删除原位各补一行 `codepuppy(I-13 L1)` 标注,写明上游原来那一行(审查 Minor:ADR-047 说本文件只在标注处改动,上游同步靠这些标注) · 提交 I。
- 2026-11-20 · 审查 Minor:`unattended-policy.test.ts`「T1 allow 对无工具调用的原始 ask 与直接 return 不等价」把原始动作的 ask 写在会话行上,L2 之后引擎第一次判定已是 allow,删掉 `gate.ts` 的回写它也照绿,证明失效;改为写在 agent 规则里(选项 `agentRawAsk`),删回写 ⇒ 红(`IMP/ko-WRITEBACK-new.log`;旧写法同一突变下照绿,`IMP/ko-WRITEBACK-old.log`) · 提交 I。
- 2026-11-20 · 审查 Minor:AC-03 的 wellknown 那条在判「列表里没有 planted」之前,先断言 `/api/mcp` 回 200 且 `data` 是数组,错误响应不再让它空过 · 提交 I。
- 2026-11-20 · 设计 §6 E7 的前提不成立(编排器裁决 3):M2 七个在会话行上写 `allow *` 的真引擎用例(package-effect、created-plugin、install-from-source、package-mcp-oauth、plugin-entrypoints、endpoint-route 与 `test-component/official-connectors.cases.ts:1044`)在 L1–L3 之后照样全绿,本片不改它们;提交 B 之后在本分支上复跑确认。设计 E7 那句「改成在 agent 层给放行」请设计方更正 · 提交 B。
- 2026-11-20 · `test-fixtures/engine-adapter-sampler/sample.ts:212` 在会话行上写 `ask *`,L2 之后不再强制询问;它是录样本的脚本,不是测试,按裁决 5 不动,以后重录样本时注意 · 提交 B。
- 2026-11-20 · `config.test.ts` 的 5 条已知红(名单见 M4)按裁决 4 只列名、不加判官;同一份名单写进登记册 `engine-db-records-not-honoured` 的 `note` 和 ADR-047 config.ts 那一行 · 提交 B。

- 2026-11-20 · 设计返还 D16(编排器批准扩大范围):`packages/ext/src/policy/index.ts` 与新测试 `session-row-rules.test.ts` 加入本片;`session/context.ts:136` 待 owner 同意,本片不碰 `packages/core/src/session/` · 提交 C、D。
- 2026-11-20 · AC-03 用例「已存批准」那条结束时经引擎自己的路由 `DELETE /api/permission/saved/:id` 删掉植入的记录,并先断言 `GET /api/permission/saved` 列得出它 · 第一次撤 L1 时,这条项目级记录留到了下一条「会话行」,两条一起红,反向臂就分不开;删掉之后撤 L1 只红它自己。修复之前的代码上三条照样全红 · 提交 E。
- 2026-11-20 · D16 第三处获准(owner「两件都同意」):`packages/core/src/session/context.ts:136` 一行与接管登记加入本片,由「待定」改为已做 · 提交 F、G。
- 2026-11-20 · ADR-047「权威保持表」的计数(编排器准改 58 → 59)没有改:这张表在本片之前就落后于登记册 —— 登记册当时已握住 61 项,表里 58 行,缺 `unattended-run-permissions`、`chat-install-main-owned`、`provider-allowlist`、`package-disable-pending-mcp-requests`,还有一行 `hub-install-ask` 在登记册里不是在役项。写 59 仍然不对,交回编排器定 · 记于提交 G,提交 H 不碰它。
- 2026-11-20 · D16 带出 `unattended-policy.test.ts` 一条:它用会话行上的 ask 证明标准档的规则轴 ask 立即拒绝,写的正是被取代的行为(没有任何产品写者会在会话行上写 ask)。改为写在 agent 规则里,保证不变,用例名里的选项随之改名;该用例名不在登记册与闸门登记簿里 · 提交 D。

### 可选(不做)

- 给 `packages/core/test/config/config.test.ts` 也钉一个「恰好这些红」的判官,让 L3 的五条已知红在上游改动时也能被看见。
