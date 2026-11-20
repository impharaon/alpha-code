---
id: PLAN-engine-config-fence
title: 对话改不了决定运行什么程序、哪些工具免问、凭据交给谁的配置 实施计划
summary: 片 ①:引擎不再采用引擎库里的项目级已存批准、会话行上的 allow / ask 规则与 wellknown 缓存的配置文档(L1–L3),只改两个已接管的引擎文件;片 ②——受保护配置集渲染进围栏 profile 末尾，运行期放行认得拒写块，资格判定拦受保护位置之内，围栏内写者移到主进程；片 ④——计划文件移到引擎数据目录(接管上游 plan.ts 的路径一值)，`~/.opencode` 整个受保护、谁都不建，删 W16；其余各片另起一节。
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
- 2026-11-20 · `packages/ext/src/policy/unattended-policy.test.ts` 登记进 `scripts/gate-files.tsv`(精确条数 20):闸门文件 `session-row-rules.test.ts` 的正文提到它,而它既未登记、也不在 `NOT_GATES` / `REFERENCED_BUT_UNREGISTERED`,`gate-file-registry.test.ts` 的分类绊线因此红(编排器合并 ⓪ + ① 时发现)。按编排器裁决把它当闸门登记:本片改过它两条,其中 T1 那条是审查依据的证据;它也是登记册 `unattended-run-permissions` 的证明文件 · 提交 J。
- 2026-11-20 · 引擎适配器夹具重采(`packages/ui-mac/src/engine-adapter/fixtures/*.json`):本片改了引擎源码,夹具记下的引擎身份(`packages/core` 的 tree id)对不上,`fixture-identity.test.ts` 红(合并 ⓪ + ① 的门里发现;本片早先 M6 里 `sample.ts:212` 记作「不是测试、不动」,判断错了 —— 它写的就是这些夹具)。不改采样器时重采,`approval-actions` 剧本直接失败(会话行上的 `ask *` 已不起作用,引擎回 allow)。改为:那个会话照旧最先建(其余剧本记下的会话清单形状不变),三条审批请求挪到最后、在一个只给采样器用、规则全是 ask 的 agent(`approval-ask`)下经公开审批 API 建;这个 agent 等其余剧本都采完才写进全局配置,目录类夹具的 agent 清单因此不变。重采后 17 个夹具与旧版逐个比对(屏蔽 id / 时间 / 端口 / 临时目录 / slug 后):帧类型与条数逐个相同;其余差别全是环境与时序 —— 联网取的 opencode 免费模型目录少了一个 `inkling-2-small-free`、采样所在 worktree 的路径与分支、OAuth 回调端口、PTY 票据、消息页抓取那一刻工具部件的进度、`approval-actions` 的 `_source` 文案;没有因 L1–L3 改变的记录 · 提交 K。
- 2026-11-20 · 重采后的 `events.json` 记下的是采样所在 worktree 的 CLI 路径(含仓库名),`scripts/old-name-exceptions.tsv` 里那条 external-anchor 例外的词元随之换成新路径,处数同为 21(整轮闸门登记簿里 `old-name-scan.test.ts` 两个方向红,修后 10/10) · 提交 L。
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

## 片 ②：受保护配置集与认得它的运行期放行，围栏内写者移到主进程

- 依据：规格 `docs/specs/engine-config-fence/spec.md` v1(owner 2026-11-20「两份都批准」)的 BR-01、BR-03(不含工具策略)、BR-04、BR-05，AC-01、AC-02、AC-04(不含工具策略)、AC-05 第一句、AC-06，以及「用户会碰到的限制」第二条那句说明；冻结设计 `docs/specs/engine-config-fence/design.md` @ `3f36883278`(approved，两轮审查)的 §1 (a)(c)、§2、§4.1 CF-1–8 与 CF-10、§4.2、§4.3、§4.4、§4.7、§5、§6 的 I1/I2/I4/I5 与 E1、E2、E3(无 A3)、E5、E7、E8、E9，§10 D2/D3/D5/D6/D11/D12 ②/D14；意图 impharaon/alpha-work `docs/intents/INT-safety.md` I-13。两份文件另行合入主线，本分支不复制，所以下文按路径@提交引用，不建链接。读码基线 `bd206c6bca`(`origin/alpha` `887748b52c` + 片 ⓪)。不在本片：CF-9、W16 与计划目录(片 ④)，CF-11 与工具策略写消息(片 ③)，L1–L3(片 ①)。
- 核对：Phase: IMPLEMENT — plan `5c1525b1a9` · 编排器 / Claude Fable 5.2 · 通过(对 SPEC v1 与冻结设计核对；D-1…D-6 全部接受，D-6 附条件：启动文档内容与计划出的 profile 对任何输入都不变，既有一致性记录不重采；按单元 A → B+C 两次审查点推进)。

路径前缀 `main/` = `packages/ui-mac/src/main/`，`ui/` = `packages/ui-mac/src/renderer/codepuppy-ui/`，`i18n/` = `packages/ui-mac/src/renderer/i18n/`。PLAN 阶段只提交本文件；下列命令都是实施安排，尚未运行。约定沿用 [child-process-write-fence 的计划](../child-process-write-fence/plan.md)：先提交红测试再提交实现，宿主 `*.test.ts` 起同名 `.cases.ts`，`.cases.ts` 不单独执行。

### 改动

**生产代码**

| 文件 | 改什么 |
| --- | --- |
| `main/process-fence-profile.ts` | ① `ConfigFenceRule` 与 `ProcessFenceProfileInput.configFence`(§4.2 的形状，必填；列表为空时两块都不渲染，生产计划器恒给非空)。② 纯函数 `configFenceLocations({ userDataPath, appStateRoot, codepuppyGlobalRoot, engineConfigDirectory, configHome, home })` 给出 CF-1–8、CF-10 的原始位置；名字取 `USER_DATA_LAYOUT`、`SETTINGS_STORE` 与新常量 `UPDATER_STORE`，`*.dat` 一类是 `dat-files`；两个配置目录相同只列一份。③ 两块渲染在 N4 之后，上级目录块按每条规则的锚点逐级去重(§4.2)。④ 删 W2、W6 两行及 `WRITABLE_ROOT_IDS` 两项，文件头注释同步。⑤ `processFenceWriteRules` 返回 `{ allow, deny }`，文法照 §4.2；另外第一个拒写块之后再出现任何 `(allow file-write*`(含 X1 行)、空拒写块，都按「其余含 `file-write` 的写法」抛。⑥ `processFenceRulesCover` 收 `{ allow, deny }`，判据照 §4.2。⑦ `WorkspaceUnionInput` 与由它 Pick 出的 `WorkspaceDirectoryInput` 加必填 `configFenceRoots`(§4.3)；`checkWorkspaceDirectory` 在既有 HOME、应用状态根两种关系之后加「与某个 CF 目录根是同一对象或在其内」(dev+ino 沿祖先链，与状态根「在内」同一判法；根不在盘上跳过)，返回新原因 `protected-config`(差异 D-1)。既有关系与先后不变。 |
| `main/process-fence-plan.ts` | 输入加 `engineConfigDirectory`(§4.3)。新导出 `planConfigFence(input, { realpath, mkdirp })`：取 `configFenceLocations`，目录位置先 `mkdirp`(并入既有预建循环，从不建 `~/.opencode`)，每个位置写成「`realpath(父目录)` + 名字」，位置存在且 `realpath` 解析到别处时再加真实目标；环境根的真实路径落在状态根真实路径之内时不另列(§4.1 CF-1)；`realpath` 报 `ENOENT` = 位置不存在，其它错误照常抛(既有「计划失败 ⇒ 拒 fork」)。`planProcessFence` 用它的结果渲染，把 `configFenceRoots`(全部 subpath 规则的路径，含真实目标)交给并集选择并放进 `ProcessFencePlan`，planned 日志加 CF 条数。手渲染 profile 的测试夹具也调 `planConfigFence`，不手写 CF。 |
| `main/server.ts` | ① `buildCodePuppyBootstrap` 那段整体提到计划围栏之前(它不依赖计划)。② 紧接着调 `writeEngineConfigForFork(bootstrap)`(见下一行)；抛 ⇒ `[I-13] engine config files could not be written — refusing to fork: <message>` 并抛，与密钥同步、目录钉选同一条拒 fork 路径；返回的用户文件解析问题照旧记 `[alpha-code#1667] … is not valid …`。③ 写完立即用它返回的输入起 `watchExplicitSources`(log 进 main 日志)；本代子进程 `exit` 时停；模块级记住当前这份，下一次 spawn 开始先停上一份(盖住 fork 前失败)。④ `ProductionFenceInput` 加 `engineConfigDirectory = engineGlobalConfigDirectory(exported.env, exported.home)`(与启动文档同一个值)，`planProductionFence` 交给计划器；`PlannedFence` 加可选 `configFenceRoots`。⑤ 模块级记住最近一次计划的 `configFenceRoots`，导出 `currentConfigFenceRoots()`；本运行尚未计划时用同一纯函数按主进程环境现算(`app.getPath("userData")`、冻结环境的 `casBaseRoot`、`codepuppyGlobalRoot()`、`engineGlobalConfigDirectory(process.env, homedir())`)；非 darwin 为空。⑥ `writeRules` 换成 `ProcessFenceWriteRules`，`generationWrites` 传 `{ allow: [...writeRules.allow, ...本代已放行 / 放行中目录], deny: writeRules.deny }`；解析失败的既有处理不变。 |
| `main/engine-explicit-config.ts` | 新增冻结的 `engineModelsPath`、`EngineConfigFiles`、`writeEngineConfigFiles`(§4.4；先种子，再显式文件，再写或删 `models.json`；IO 错误原样抛，Node 的错误消息带路径与 errno、不含内容)。`governedModelsBase`(连同两个投影类型)、`explicitSkillDirs`、`PROJECT_SKILLS_ENTRY` 从注入模块原样搬来(差异 D-3)，`explicitSkillDirs` 改为显式收 `(factoryDirs, root)`。新私有函数 `writeEngineConfigForFork(bootstrap)`：按 §4.4 从启动文档算 `models` 与 layer，调 `writeEngineConfigFiles`，返回 `{ files, watch }`(`watch` = `watchExplicitSources` 除 `log` 外的输入)。`server.ts` 与测试宿主共用它，这套算法只有一处。 |
| `main/codepuppy-config-injection.ts` | 删种子写入(只留 `file = userConfig`)、`materializeGovernedModelsBase`、`writeExplicitConfig` 调用、layer 计算与结果里的 `explicit`；`config.file = explicitConfigPath(userData)`，`models.file = existsSync(engineModelsPath(userData)) ? 该路径 : 缺席`(§4.4)。注入失败分支照旧把用户文件给显式槽。去掉随之不用的 import。 |
| `main/sidecar.ts` | 删 `:171` 起监听那一行与它的两个 import。 |
| `main/process-fence-workspaces.ts` | `:238` 传 `{ allow: <别的代带来的目录>, deny: [] }`；`WorkspaceEligibility` 联合与 `:348`、`:369`、`:377` 三处原因映射透传 `protected-config`(收成一个小函数)。 |
| `main/workspace-write-probe.ts` | `WorkspaceOpenRecordResult.reason`、`WorkspaceWriteProbeResult.reason` 两个联合加 `protected-config`。`ipc.ts:105`、`preload/types.ts:105` 原样透传同一类型，不改。 |
| `main/index.ts` | `:979` 的 eligibility 加 `configFenceRoots: currentConfigFenceRoots`(设计 §6 落点表已点名)。 |
| `main/store-keys.ts`、`main/updater.ts` | 新常量 `UPDATER_STORE = "opencode.updater"`，`updater.ts:72` 改用它(差异 D-4)。 |
| `ui/workspace-writable.ts` | `workspaceReadonlyMessage` 加 `protected-config` → 新键。显示处只有 `ui/session-workspace/session-workspace-shell.tsx:194` 与 `ui/workspace-chip.tsx:79`，都原样传原因，不改。 |
| `i18n/zh.ts`、`i18n/en.ts` | 新键 `codepuppy.workspace.readonlyProtectedConfig`。zh 逐字取规格：「这个文件夹是 Code Puppy 或引擎存放配置的位置，对话里不能写入。」en 按同组三句的写法译作 "This folder is where Code Puppy or the engine keeps its configuration, so conversations can't write to it."。只有这两个语言有那三句。 |
| `scripts/process-fence-write-sites.tsv` | 注入模块的种子、模型底表各行随代码消失；`engine-explicit-config.ts` 各行(含新增的写种子、写 / 删模型底表)根改 `main-only`；`codepuppy-installs.ts`、`ext-receipt-v2.ts` 的 W2 行改 `main-only`(§4.7)。`packages/ext/src/policy/store.ts` 四行不动(片 ③)。签名用 `bun packages/ui-mac/scripts/process-fence-write-sites.ts --write` 重生，根人工填。 |
| `docs/architecture/2026-09-09-req159-process-fence.md` | 事实同步：可写行列表删 W2、W6；加 CF 两块(位置、按真实路径与软链目标渲染、放在最后)、运行期放行认得拒写块、写者在主进程；`:95`、`:132` 两处「W2 只放行 env/<env>」改写；测试表加新宿主、改 W2 控制臂的描述。其它历史设计文件不改。 |
| `scripts/gate-files.tsv`；`scripts/wall-clock-assertions.tsv`(只在新增耗时断言时) | 新宿主各一行；改动过的测试按实测精确条数写回。 |

**测试与夹具**

| 文件 | 改什么 |
| --- | --- |
| `main/process-fence-profile.test.ts` | 逐行全等形状：删 W2/W6，CF 两块在 N4 之后(规则、`[dD][aA][tT]`、上级目录去重)，空 CF 不出块；id 集合 = 新 `WRITABLE_ROOT_IDS`。E9 往返：生产渲染(含 CF)→ 解析 → `deny` 与渲染输入(规则 + 上级目录)逐条相等；CF + C1 样本(按兄弟设计 `docs/specs/stored-credentials-fence/design.md` §4.5 的两块文字代入假路径，含块尾 `; C1` 与收尾括号落在最后一条条目行末)同样逐条相等。拒绝形状逐条抛：未知表头、未知条目、块内注释、空块、拒写块之后的放行行、X1 行写在 CF 之后。覆盖判定：在 allow 下且被 subpath/regex deny 盖住 ⇒ 不覆盖；literal deny 只在等于目录时算。`trimUntilCompiles` 丢工作区时 CF 原样。`configFenceLocations` 清单(两个配置目录相同只列一份)。`checkWorkspaceDirectory`：CF 根本身与之内 ⇒ `protected-config`；包含 CF 根 ⇒ 合格；真盘上 firmlink 写法与软链指向 CF 根 ⇒ 同样拒；根不在盘上跳过；HOME / 状态根原因不变。并集输入加 `configFenceRoots`。 |
| `main/process-fence-plan.test.ts` | 输入加 `engineConfigDirectory`；CF 目录预建(状态根、环境根、CF-2、CF-6、两个配置目录)且从不建 `~/.opencode`；真实上级目录 + 名字；位置是软链 ⇒ 多一条真实目标；环境根在状态根之内不另列、在外另列；`ENOENT` 只写位置；其它 `realpath` 错误 ⇒ 抛；计划里的 `configFenceRoots` 与渲染同一份；真源里落在 CF 根之内的条目被排除并记账。 |
| `main/process-fence-workspaces.test.ts` | eligibility 加 `configFenceRoots`；CF 之内的目录 register / probe 回 `protected-config`、零签发；既有 HOME / 状态根用例原因不变。 |
| `main/engine-explicit-config.test.ts` | `writeEngineConfigFiles`：缺席才写种子、逃生阀(无 `userConfig`)不写；显式文件内容 = `composeExplicitDocument`；模型底表写入；`models` 缺席或底表为空 ⇒ 删除(盘上留着上一代文件的逃生阀臂)；写 / 删失败抛，消息含路径与 errno、不含内容。`writeEngineConfigForFork` 的 layer 与今天注入算出的同形(两层 policies 一致；`/init`、`/review`；skills = 出厂 ∪ 当前代 ∪ 项目入口；提示词逃生门下无命令)。删 `:164` 锚 `sidecar.ts` 起监听的 ANCHOR 用例，行为改由 `server.test.ts` 真执行。 |
| `main/server.test.ts` | AC-05 两臂：写失败(引擎配置目录换成普通文件)、删失败(`models` 缺席而 `models.json` 是非空目录)⇒ `spawnLocalServer` 拒绝、fork 替身零调用、日志恰一行 `[I-13] engine config files could not be written — refusing to fork:` 且带路径。E7 接线：fork 之后手改 `codepuppy.jsonc` ⇒ 显式文件由 main 重写；子进程退出后再改 ⇒ 不再重写。 |
| `main/codepuppy-config-injection.test.ts` | 辅助函数与生产同序：先 `writeEngineConfigForFork(codepuppyBootstrap())` 再注入；原来读 `result.explicit` 的断言改读它的输出。`#613`「models.json 写不进」那一臂改为「注入不写盘」：注入前后 `codepuppy-engine-config/` 与种子零变化，`models.file` 随文件在缺而定。 |
| 依赖注入写盘的测试接线：`main/codepuppy-config-injection-engine.cases.ts`、`main/config-injection-throat.test.ts`、`main/composer-tier-matrix.engine.cases.ts`、`main/package-hub-lifecycle.engine.cases.ts`、`main/plugin-entrypoints.engine.cases.ts`、`main/engine-plugin-policy.engine.cases.ts`、`main/bootstrap-launch-parity.engine.cases.ts`、`main/package-command-engine-visibility.engine.cases.ts`、`test-component/package-plugin.wiring.cases.ts`、`test-component/codepuppy-engine.ts`、`test-fixtures/process-fence/engine-embed-driver.ts` 与宿主 `main/process-fence-engine.test.ts`、`test-fixtures/net-failure/engine-driver.ts` | 只改接线：与生产同序先跑 `writeEngineConfigForFork`(围栏内的驱动由宿主在装围栏前跑)；`injection.explicit`、`explicitSkillDirs()` 改用它的输出与新签名；共享宿主 `codepuppy-engine.ts` 的返回值加 `explicit`。各用例的断言意图不变。 |
| 直接调 `renderProcessFenceProfile` 的 17 个文件 | 加 `configFence`。围栏 / 引擎整链夹具(`project-writable.engine.cases.ts` 手渲染臂、`fence-write-denied.engine.cases.ts`、`process-fence-extension.cases.ts`、`native/codepuppy-fence/test/packaged-main.ts`、`packaged-window-main.ts`)经 `planConfigFence` 取生产 CF；只判别的轴的(`process-fence-compile`、`process-fence-apply`、`network-egress-fence`、`workspace-write-probe-fence`、`process-fence-wiring`、`process-fence-zsh-startup.cases`、`test-component/official-connectors.cases`、五个真源测试)传 `[]`。依赖 W2 可写的控制臂改指仍可写的行：`custom-provider-truth-fence`、`project-trust-truth-fence` 的「先在可写处造好再 mv」第一步改落 W3，标题与注释里过时的 W2 说法同步(`project-trust-truth-fence` 审计臂的「W2 根挪得动」只记日志不断言，改措辞)；`custom-provider-truth` 的固定行 id 由 15 个变 13 个，`mcp-server-truth`、`egress-grant-truth` 的规则条数下界随之减 2；三者「W2 罩着 `codepuppy.jsonc`」的正对照改为「W3 罩着 userData 里的文件」。 |
| `WorkspaceDirectoryInput` 的其余构造点 | `project-writable.engine.cases.ts`(2 处)、`workspace-identity.cases.ts`、`project-writable-ipc.cases.ts`、`workspace-identity-firmlink.fixture.ts`、`native/codepuppy-fence/test/packaged-window-main.ts` 加 `configFenceRoots`。 |
| `main/process-fence-write-sites.test.ts` | `:53` 的 `main-only` 允许名单从只有 `codepuppy-environment.ts` 扩到加 `engine-explicit-config.ts`、`codepuppy-installs.ts`、`ext-receipt-v2.ts`(§4.7)；根合法性用例把 `W2`、`W6` 列为非法，合法样例换掉 `W2+W6+W1`。 |
| `main/source-text-anchors.ts` | 删 `engine-explicit-config.test.ts` 那条锚的登记(锚随行为一起删)。 |
| 新 `main/process-fence-config-fence.test.ts` + 同名 `.cases.ts` + `native/codepuppy-fence/test/config-fence-ops.c` | E1 / E2，见「证明」。C 程序按设计期 `~/.cache/alpha-orch/2026-11-19/config-fence-design/src/wops.c` 的手法逐条回报 `OK` / `errno`(追加、截断、同目录新文件改名覆盖、工作区文件改名覆盖、`RENAME_SWAP`、改名移走、往目录里硬链 / `clonefile` / 软链、`chmod`、删除、建兄弟 / 子目录、改名上级目录)，宿主现编，不进产品。 |
| `main/project-writable.engine.cases.ts`(宿主 `project-writable.engine.test.ts`) | E9 三臂，见「证明」；eligibility 用 `currentConfigFenceRoots`。 |
| 新 `main/engine-config-fence.engine.test.ts` + 同名 `.cases.ts` | E3、E5、E8 与 AC-06，见「证明」。 |
| `ui/workspace-writable-ui-census.test.ts`、`test-component/session-workspace.cases.ts`、`ui/session-workspace/session-workspace-test-runtime.tsx` | 第四句逐字合同；组件臂：原因 `protected-config` ⇒ 显示这一句、无按钮，位置同另外三句；测试运行时的原因类型改用生产类型。 |

**供计划核对的设计差异**(实施前请编排器确认；不改任何冻结的产品或安全决定)

| 编号 | 差异 | 依据与最小改动 |
| --- | --- | --- |
| D-1 | 新资格原因 `protected-config`，不复用 `home-or-app-state` | 设计 D14 复用既有原因，规格 v1 要一句独立说明，派单要求最小区分。全部消费点：`process-fence-profile.ts` 的 `WorkspaceDirectoryCheck`(定义)；`process-fence-workspaces.ts` 的 `WorkspaceEligibility` 与三处映射；`workspace-write-probe.ts` 的两个联合(`ipc.ts`、`preload/types.ts` 透传)；`ui/workspace-writable.ts` 的消息映射；两条 i18n；测试运行时类型。状态根本身与其内照旧是 `home-or-app-state`(既有关系先判)，派单写明那句旧说明继续管主目录与应用数据根。 |
| D-2 | `writeEngineConfigFiles` 的返回值多一个可选 `userError` | 冻结签名只回两条路径；§5 要求用户文件解析不了时留既有日志，那行原来由注入打，现在只有 main 知道。其余形状不变。替代：`server.ts` 调用前自己再解析一次用户文件(重复一次解析)。 |
| D-3 | `governedModelsBase`、`explicitSkillDirs`、`PROJECT_SKILLS_ENTRY` 从注入模块原样搬到 `engine-explicit-config.ts` | 它们今天住在 sidecar 的注入模块里，主进程不 import 那个模块(它读 sidecar 才发布的启动文档)。§6 已列 `engine-explicit-config.ts` 依赖 `codepuppy-models`、`factory-paths`、`codepuppy-prompts`、`gen-skill-paths`。只搬家，`explicitSkillDirs` 改为显式收出厂目录与根。 |
| D-4 | `store-keys.ts` 加 `UPDATER_STORE`，`updater.ts` 改用 | `opencode.updater` 今天是 `updater.ts:72` 的字面量，§4.3 要求名字取 store 常量。两个文件不在派单初始枚举里，各改一行。 |
| D-5 | CF 位置纯函数暂不收 `dataHome` | 只有 CF-11 用它，片 ③ 加；本片不加没有用处的参数。 |
| D-6 | 启动文档构建提到计划之前 | §4.4 要求调用点在计划之前、平台输入取启动文档的同一组值；基线上文档在计划之后才构建。构建本身不变。 |

### 顺序

同一个 PR 内三个顺序工作单元。每个单元末尾相关检查全绿，交编排器看一次；PR 只在单元 C 完成后可送审。

**单元 A：写者移到主进程(围栏不变；单独看也是可用状态)**

1. 红(按构造必红)：`engine-explicit-config.test.ts`、`server.test.ts`、`codepuppy-config-injection.test.ts` 的新用例。新导出不存在、注入仍写盘，所以红；红输出存证。
2. 绿：`engine-explicit-config.ts`、`server.ts`(启动文档前移、写配置、监听)、`codepuppy-config-injection.ts`、`sidecar.ts`；全部依赖注入写盘的测试接线；写盘登记簿与 `process-fence-write-sites.test.ts`；锚登记删除。跑检查组 A，再把共享宿主 `test-component/codepuppy-engine.ts` 的其余消费者在后台串行跑一次(检查组 A′)。

**单元 B：受保护集、放行解析、资格与说明(依赖 A：删 W2 之前 sidecar 必须已不写种子)**

3. 红(按构造必红)：`process-fence-profile.test.ts`、`process-fence-plan.test.ts`、`process-fence-workspaces.test.ts` 的新用例。
4. 绿：`process-fence-profile.ts`、`process-fence-plan.ts`、`server.ts`、`process-fence-workspaces.ts`、`workspace-write-probe.ts`、`index.ts`、`store-keys.ts`、`updater.ts`，全部渲染 / 并集 / eligibility 调用点，W2 控制臂，登记簿根合法性。CF 渲染与解析器、覆盖判定必须同一提交(§10 D12 ②：分开则本代运行期放行被停)。跑检查组 B。
5. 红(按构造必红)：census 第四句与组件臂。
6. 绿：`ui/workspace-writable.ts` 与两条 i18n。跑检查组 C。

**单元 C：实证、登记与收口**

7. E1 / E2 宿主、cases 与 C 程序(生产臂与已知坏臂在同一宿主)。
8. E9 三臂(`project-writable.engine.cases.ts`)。
9. E3 / E5 / E8 与 AC-06 宿主(`engine-config-fence.engine.*`)。
10. 事实文档、`gate-files.tsv`、本节偏离记录与证据路径；最后跑 ui-mac `bun typecheck`、`git diff --check`、受影响的检查组复跑、签名形态宿主一次。

变异运行(不提交，用 `git restore` 复原，输出存 `~/.cache/alpha-orch/2026-11-19/impl-fence-slice2/mutations/`)：M1 `processFenceWriteRules` 换回基线写法(放行块后见拒写即抛)；M2 去掉 CF 资格关系；M3 `server.ts` 不起监听；M4 只在底表为空时删 `models.json`；M5 注入里保留 `writeExplicitConfig`。每个变异都要让「证明」表里点名的用例变红。

### 风险

- **共享引擎宿主的消费者面**：44 个文件经 `test-component/codepuppy-engine.ts`，接线一变它们都相关。单元 A 末尾后台串行只跑一次，失败按单个宿主归因；冷缓存 `ENOTCACHED` 先按包名 `npm cache add` 再重跑。
- **两次模型配置计算**：main(`writeEngineConfigForFork`)与 sidecar 注入读同一份启动文档、同一批文件，单元 A 用例钉住两边 policies 一致；出网派生那一次仍按既有方式读 main 环境，不动。
- **监听生命周期**：按代停、下一次 spawn 先停。计划期在 `node_modules/.cache/cf-plan-probe/` 实测：`bun test` 带着未关的 `fs.watch` 与 `fs.watchFile` 照常退出，不会挂住测试进程。
- **测试布局假绿**：`/private/tmp`、`$TMPDIR` 在 W11/W12 下。E1 的假 HOME、userData、状态根放在 worktree `node_modules/.cache/config-fence/`，先用 `processFenceRulesCover` 证明它们不在任何放行之下，宿主在围栏外读盘判定。
- **身份判定**：CF 根与目录的关系一律按 dev+ino(firmlink 写法同一对象)，每次判定现解析；真实路径只用 `realpathSync.native`。
- **字节墙**：CF 约 20 条加上级目录；`trimUntilCompiles` 只丢工作区，形状用例钉住 CF 原样，试编译用真 `sandbox-exec`。
- **内核沙箱日志**：E3 / E5 用 `log show` 取运行窗口内的拒绝，按 pid 区分引擎进程与攻击命令；取不到日志 ⇒ 该项判红，不当成零条。
- **悬空软链(观察，不加机制)**：CF 位置本身是悬空软链时 `realpath` 报 `ENOENT`，按「不存在」只保护链本身，链指向的、尚不存在的目标不在规则里。围栏内建不出这种链(位置本身被拒)，只有改动前的会话或用户自己能留下它，与 R6 / R8 同类，作为观察返回。
- **机器纪律**：其它 lane 与全门在跑时真引擎宿主串行、并发不超过 2；任何一臂都不碰真实 userData、`~/.config/opencode`、`~/.opencode`、shell rc 或凭据。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01 | `main/process-fence-config-fence.test.ts` → cases。生产计划器 + 生产渲染 + 生产 addon(`applyProcessFence` 装在 bun 子进程上)。假 HOME 下 CF 每个位置(状态根里的 `codepuppy.jsonc`、CF-2 的显式文件与 `models.json`、CF-3/4/5、CF-6 里一条记录、CF-7 两个 literal 与 `default.dat` / 新建 `.DAT`、两个配置目录里的 `opencode.json`、CF-10 两个文件)× C 程序的全部手法，另经软链写法、大小写变体、firmlink、`/.vol/<dev>/<ino>`、改名任一上级目录；某个位置预先是指向工作区的软链时，其真实目标同样被拒；事后在围栏外逐字节比对原样。E2：同一 profile 下引擎 state、库与 `-wal`、日志、缓存、`~/.npm`、`uv-cache`、工作区、userData 其余文件的建改删，以及 `mkdir -p` 已存在的受保护目录，全部成功。保证外对照(不计失败，R8)：受保护目录里用户自建、指向工作区的嵌套软链，写入落到链目标。 | 已知坏各臂在同一宿主里必须翻转，否则宿主红：去掉 CF(`configFence: []` 且补回 W2/W6 行)⇒ W2/W3/W6 下的位置全部写得进(CF-10 与状态根本身今天就写不进，设计 §4.1 已注明)；CF 两块挪到放行块之前 ⇒ 写得进；删上级目录块 ⇒ 改名上级目录成功；X1 行挪到 CF 之后并给包含 CF 位置的目录签发 ⇒ 写进 CF；软链位置不加真实目标 ⇒ 经目标写入成功。 |
| AC-02 | ① 真引擎 `main/project-writable.engine.test.ts`(生产计划器臂，profile 含 CF)：本运行新登记的项目签发一次、模型写入落盘、引擎 pid 不变；CF 目录根之内的文件夹 `workspace-open-record` 回 `{ recorded: false, reason: "protected-config" }`，probe 回 `ineligible` / `protected-config`，零 `grant-sent`；包含 CF 目录根的文件夹(假 HOME 下的 `.config`)签发，`other-app/x` 落盘，其中 `opencode/opencode.json` 写入 EPERM、零文件。② 单元：`process-fence-profile.test.ts` 往返与资格用例，`process-fence-workspaces.test.ts` 透传。③ 界面：`session-workspace` 组件臂显示那一句、无按钮；census 逐字。 | M1(解析器回退)⇒ server 记「runtime grants are disabled」、新项目写入失败，往返用例同时抛；M2(去掉 CF 资格关系)⇒ CF 之内被签发，零签发断言红；把 CF 关系写成「包含也拦」⇒ `.config` 臂不签发；缺消息映射 ⇒ 组件里没有那一句。 |
| AC-04(不含工具策略) | `main/engine-config-fence.engine.test.ts` → cases。假 HOME / userData；cases 进程用生产计划器 + 生产 addon 把自己关进围栏；引擎配置由生产 `writeEngineConfigForFork` 在装围栏前写好；装围栏前起一个围栏外的「main」辅助进程，跑生产 `watchExplicitSources` 并代写 `codepuppy.jsonc`。change 臂经引擎自己的 shell 工具做 A1a(改显式文件里连接器命令)、A1b(改 `codepuppy.jsonc`)、A2(显式文件与全局配置目录 `opencode.json` 给带密钥的 provider 写 `package: file://…`)⇒ 全部 EPERM，连接器仍跑原命令、假令牌未外泄，主进程读法读到原命令，模块未装载、假密钥未送达。同时模型调用、连接器调用、经 main 的安装 / 停用 / 启用(写 `codepuppy.jsonc` → main 监听重写显式文件 → 引擎热重载)、引擎重启都正常；运行窗口内路径在 CF 内、pid 是引擎进程的沙箱拒绝为零(攻击命令自己的拒绝另计)。 | control 臂(同一宿主另起一个进程：生产 profile 去掉 CF、补回 W2/W6)三项攻击全部成功；任一项在 control 臂没成功 ⇒ 宿主红，证明手段测得出。 |
| AC-05 第一句 | `main/server.test.ts` 写失败、删失败两臂；`main/engine-explicit-config.test.ts`(错误消息带路径与 errno、不含内容)。对照臂(围栏内直接写)：E5 臂里在围栏内调 `writeExplicitConfig` ⇒ EPERM，「退回围栏内写」走不通。 | 去掉 `server.ts` 的拒 fork ⇒ fork 替身被调用；M4(只在底表为空时删)⇒ 逃生阀臂留下旧文件、`models.file` 指向它。 |
| AC-06 | `main/engine-config-fence.engine.test.ts`：① 0.2.6 形状冷启动(预置带连接器的 `codepuppy.jsonc`、上一版写法留下的显式文件与 `models.json`、工具策略文档、界面设置存储文件)⇒ 连接器、模型清单、工具策略判定与预置一致；② 手改 `codepuppy.jsonc` 加连接器、main 写技能允许集与当前代指针 ⇒ 引擎不重启就看到连接器与技能；③ 全新机器形状(没有 `<XDG_DATA_HOME>/opencode`、没有 `~/.opencode`)⇒ 计划器预建、引擎起来，`~/.opencode` 仍不存在。另有 `server.test.ts` 的 E7 接线；既有 `package-effect.engine.test.ts`、`created-plugin.engine.test.ts` 照样绿。 | 不预建臂(计划器的 `mkdirp` 跳过 CF 目录)⇒ 引擎在 Global mkdir 处 EPERM、起不来，宿主断言它失败；M3(main 不起监听)⇒ ② 看不到改动。 |
| E5(I2) | `main/engine-config-fence.engine.test.ts` 的 sidecar 形状臂：装围栏之后在同一进程跑生产 `injectCodePuppyConfig` ⇒ `ok: true`，CF 内字节与 mtime 零变化，`config.file` = main 写的路径，`models.file` 随文件在缺；账本里放一条坏条目 ⇒ 无证据文件；窗口内零 CF 拒绝。单元：`codepuppy-config-injection.test.ts` 注入零写盘与逃生阀臂。 | M5(注入里保留 `writeExplicitConfig`)⇒ EPERM、`ok: false`；M4 见上。 |
| 修订 2 A(CF-4 的 `$CODEPUPPY_ENV_FILE`) | 单元：`process-fence-plan.test.ts` 设置 / 不设 / 与 userData 那份同一份 / 本身是软链 / 上级目录不在盘上(最深一级已存在祖先的真实路径接上余下部分)/ 解析出错与引号路径不让计划失败 / 文件在工作区里(工作区照常，只有那份文件与路径上的目录节点被拒)/ 一个来源(`userEnvFile` 与 `loadCodePuppySecrets` 读同一份，相对按 cwd)；`server.test.ts` 计划输入带同一份路径(绝对 / 相对 / 不设)。真围栏：`process-fence-config-fence.test.ts` 的 E1 臂(追加 `CODEPUPPY_PLATFORM_URL=…`、改名覆盖、删除、改名路径上的目录 ⇒ EPERM；同一项目文件夹里的兄弟文件落盘；指向尚不存在目录下的文件 ⇒ 计划照常、建不出目录与文件)。 | 去掉这一行(CF 不含 env 文件)⇒ E1 臂写入成功；去掉 server 的接线 ⇒ 计划输入用例红。 |
| 修订 2 B(上级目录节点沿配置路径再算一遍) | 单元：`process-fence-plan.test.ts` XDG_CONFIG_HOME 是项目里的软链 ⇒ 链节点与它上面的项目文件夹进上级目录块、规则只有真实路径、链下面的节点按身份不另列、无重复、项目照常可写(走签发路径)；大小写变体按身份去重；配置路径与真实路径相同 ⇒ 不带 `via`；经软链的 userData ⇒ 链节点只在上级目录块里。`process-fence-profile.test.ts` 渲染带 `via` 的规则 ⇒ 节点接在真实路径节点之后、去重、往返原样、引号拒绝。真围栏：E1 臂(删掉重建、`ln -sfn`、改名移走后建目录、改名上面的项目文件夹 ⇒ EPERM；项目里的普通写入落盘)。修订 2 C：坏软链目录位置 ⇒ 计划抛错(只钉住)。 | 上级目录只按真实路径算(去掉 `via`)⇒ E1 臂四种都成功、计划器用例红。 |
| E9 形状 | `main/process-fence-profile.test.ts`：CF 两块在 N4、X1 之后，真实路径，含软链目标与全部上级目录；往返(CF；CF + C1 样本)。 | 渲染与文法任一侧单独改动 ⇒ 往返不等或抛。 |

**相关检查命令**(都在 `packages/ui-mac` 下执行，只传宿主 `*.test.ts`)

- A：`bun test src/main/engine-explicit-config.test.ts src/main/server.test.ts src/main/codepuppy-config-injection.test.ts src/main/config-injection-throat.test.ts src/main/process-fence-write-sites.test.ts src/main/sidecar-env.test.ts src/main/gate-file-registry.test.ts`(后者是 `source-text-anchors.ts` 的判官)；真引擎：`bun test src/main/codepuppy-config-injection-engine.test.ts src/main/composer-tier-matrix.engine.test.ts src/main/package-hub-lifecycle.engine.test.ts src/main/plugin-entrypoints.engine.test.ts src/main/engine-plugin-policy.engine.test.ts src/main/bootstrap-launch-parity.engine.test.ts src/main/package-command-engine-visibility.test.ts src/main/package-effect.engine.test.ts src/main/created-plugin.engine.test.ts src/main/package-plugin.wiring.test.ts src/main/process-fence-engine.test.ts src/main/net-failure-real-stack.test.ts`。
- A′：`grep -rl "test-component/codepuppy-engine" src test-component native` 得出的 cases 对应的其余宿主，后台串行一次。
- B：`bun test src/main/process-fence-profile.test.ts src/main/process-fence-plan.test.ts src/main/process-fence-workspaces.test.ts src/main/process-fence-compile.test.ts src/main/process-fence-apply.test.ts src/main/process-fence-wiring.test.ts src/main/process-fence-write-sites.test.ts src/main/workspace-write-probe.test.ts src/main/workspace-write-probe-fence.test.ts src/main/network-egress-fence.test.ts src/main/custom-provider-truth.test.ts src/main/custom-provider-truth-fence.test.ts src/main/mcp-server-truth.test.ts src/main/egress-grant-truth.test.ts src/main/project-trust-truth-fence.test.ts src/main/process-fence-zsh-startup.test.ts src/main/process-fence-extension.test.ts src/main/workspace-identity.test.ts src/main/project-writable-ipc.test.ts src/main/official-connectors.test.ts src/main/server.test.ts`；真引擎：`bun test src/main/fence-write-denied.engine.test.ts src/main/project-writable.engine.test.ts src/main/process-fence-engine.test.ts`。
- C：`bun test src/renderer/codepuppy-ui/workspace-writable-ui-census.test.ts src/renderer/codepuppy-ui/workspace-writable-core.test.ts src/renderer/codepuppy-ui/session-workspace/codepuppy-session-workspace.test.ts src/renderer/codepuppy-ui/new-session-workspace.component.test.ts src/renderer/route-composition.test.ts`。
- D：`bun test src/main/process-fence-config-fence.test.ts src/main/engine-config-fence.engine.test.ts src/main/project-writable.engine.test.ts`。
- 收口：`bun typecheck`；`git diff --check`；签名形态一次 `CODEPUPPY_TEST_SIGNED_FENCE=1 bun test src/main/process-fence-extension-packaged.test.ts`(本地构建并签名，约 10–15 分钟)。不跑全仓 suite、`bin/check` 或全门。

**计数钉与登记行**：`gate-files.tsv` 里 `process-fence-profile`(27)、`process-fence-plan`(11)、`process-fence-workspaces`(18)、`process-fence-write-sites`(12)、`custom-provider-truth`(10)以及 `engine-explicit-config`、`codepuppy-config-injection`、`server`、`mcp-server-truth`、`egress-grant-truth`、`project-trust-truth-fence`、`custom-provider-truth-fence`、`workspace-writable-ui-census`、`project-writable.engine` 各行，按各宿主实测输出写回精确条数并改写描述里过时的 W2 / W6 说法；三个新宿主(`process-fence-config-fence`、`engine-config-fence.engine` 与已存在的 `project-writable.engine` 的子用例数)按 darwin 行既有格式登记，cases 不单列。

### 体量与时间

- 文件：生产 14 个(含两条 i18n、登记簿与事实文档)；测试与夹具约 45 个，其中约 25 个只是一两行接线；新建 5 个(两个宿主、两个 cases、一个 C 程序)。合计约 60 个。
- 实质行数：生产新增约 400 行、删除约 120 行，另有约 90 行从注入模块原样搬到 `engine-explicit-config.ts`；测试约 1,500 行(新宿主约 800，改写约 700)。
- 时间：单元 A 约 2.5 小时(含共享宿主消费者重跑约 40 分钟)；单元 B 约 2.5 小时；单元 C 约 4 小时(两个真围栏 / 真引擎宿主是主要风险)，签名形态 15–30 分钟。合计约 9–10 小时，超过一次连贯会话(约 15 个文件 / 800 行)，所以按上面 A → B → C 三个单元顺序做，同一个 PR。
- 模块体量：`packages/ui-mac/src/main` 树基线 65,177 行，今天实测 68,465 行(已超 3,288)。本片预计净增约 200 行(profile 约 +110、plan 约 +35、server 约 +40、`engine-explicit-config.ts` 约 +120(其中约 90 行是从注入模块搬来的)、注入模块约 −110、sidecar −3、其余约 +5)。不改棘轮行，在 PR 里如实报告。

### 偏离记录

- 2026-11-20 · 单元 A 开头加一个纯搬家提交(不在原顺序里)：`PROJECT_SKILLS_ENTRY`、`explicitSkillDirs`、`governedModelsBase`(连同两个投影类型与 `#857` 注释)搬到 `engine-explicit-config.ts`，另把同块的 `materializeGovernedModelsBase` 一起搬(D-3 名单外，同样逐字节不变，只加 `export` 供注入模块引用；单元 A 的 `writeEngineConfigFiles` 复用它写模型底表)。importer 只改 import 行；写盘登记簿里随代码换文件的三行根仍是 W3(根在后一个提交改)。逐字节核对：从 `bd206c6bca` 的注入模块取原 24 行与 92 行，与新文件同一段逐行比较全等，唯一差别是 `export `(`~/.cache/alpha-orch/2026-11-19/impl-fence-slice2/evidence/move-byte-equivalence.txt`)。
- 2026-11-20 · 单元 A 绿提交的落点细节(不改任何决定)：`materializeGovernedModelsBase` 的路径改由 `engineModelsPath` 给(同一个值，路径只有一处)；`writeEngineConfigFiles` 在 `models` 缺席时删 `models.json`，有 `models` 时复用 `materializeGovernedModelsBase`(底表为空它本来就删)。`process-fence-write-sites.ts` 里 `isValidRoot` 的注释随 `main-only` 名单改写(扫描器模块，初始枚举未列；只改注释)。`package-hub-lifecycle.engine.cases.ts` 的「sidecar 换代」路径也先跑 main 那一步(与生产换代同序)；`net-failure-real-stack.test.ts` 与 `process-fence-engine.test.ts` 两个宿主在起驱动前用同一份启动文档跑 main 那一步。`codepuppy-config-injection.test.ts` 的 gate 行 27 → 28(删「models.json 写不进 ⇒ 注入 ok:false」，加「注入不写盘」与 E5 逃生阀臂)。`engine-explicit-config.test.ts`、`server.test.ts` 在 `gate-files.tsv` 里本来没有行，不新增。
- 2026-11-20 · 单元 A 证据：红 `f32d9a5245`(两份测试文件因新导出不存在而装不上，server 三条新用例红；`evidence/unitA-red.log`)；绿 `f14bad620a`。`server.test.ts` 的 E7 用例在绿提交里多了一臂「main 装一个技能(生成目录 + `current.json` + 允许集)⇒ main 的监听把它写进显式文件的 skills」，补上 AC-06 中句里「main 装技能」那一半在 `spawnLocalServer` 这条路径上的证据(红提交里只有手改 `codepuppy.jsonc` 一臂)。变异运行(`mutations/`，均已 `git restore` 复原)：M3(main 不起监听)⇒ E7 红；M4(只在底表为空时删)⇒ 三处 E5 逃生阀臂与删失败臂红(4 条)；M-AC05(写失败后照样 fork)⇒ server 两条 AC-05 红；M5-lite(注入仍自己写种子)⇒「注入不写盘」红。一致性记录 `bootstrap-launch-parity.record.json` 未重采即通过(D-6 的条件)。检查组 A 的 14 个宿主与共享宿主 `codepuppy-engine.ts` 其余 39 个消费者宿主全部绿(`evidence/unitA-engine/summary.txt`、`evidence/unitA-harness-consumers/summary.txt`)。
- 2026-11-20 · 单元 A 检查点审查(FIX-THEN-MERGE)的处置,新提交、不改旧提交:
  1. (Major)显式文件的合成从「启动文档之后、计划围栏之前」挪到「官方连接器恢复与允许集重发(`await officialAvailabilityPublished()`)之后、fork 之前」,只合成一次,监听在它之后起;合成失败先清掉这一代的官方连接器运行期目录,再走同一条 `[I-13]` 拒 fork 路径;fork 抛出时也当场停掉这一代的监听。为什么仍守 §4.4 的契约:写者在 main、在 fork 之前,失败响亮拒 fork、不退回 sidecar;计划围栏不读这几个文件(受保护目录 CF-2 由计划器自己预建,真实路径只取目录),所以挪到计划之后不改变 profile;而引擎在 fork 之后才读,此刻文件已是最终内容 —— 恰恰是放在计划之前才会在恢复改写 `codepuppy.jsonc` 之后变旧。设计 §4.4 原文「计划围栏之前」由编排器在修订里改述;启动文档仍在计划之前构建(计划器要它的 `engineConfigDirectory`)。证据:`official-connectors-recovery.cases.ts` 新用例(真 spawnLocalServer,fork 那一刻显式文件里的 DSN 引用 = 恢复后 `codepuppy.jsonc` 里的那条且文件在;修复前实测指向已被清掉的上一代文件)。
  2. 引擎配置目录在 `writeEngineConfigFiles` 开头以 0700 建(全新机器,有无模型底表两种都断言);写盘登记簿多一行 `mkdirSync path.join(input.userDataPath, USER_DATA_LAYOUT.engineConfig)`(main-only)。
  3. `main-only` 行按完整签名钉住;另加两条结构判据(扫描器算出的 sidecar 闭包):除 `engine-explicit-config.ts` 自己没有文件拿到五个写函数(含整块 import);对账本的值 import 只许 `readPackageLedgerStateV1` / `readLedgerV2`,两处调用都带 `sideEffectFree: true`。变异证明:临时往 `sidecar.ts` 加 `watchExplicitSources` 的 import、把 `ext-disabled-injection.ts` 的 `sideEffectFree` 改成 false ⇒ 两条判据各自红(`mutations/R3-…log`)。
  4. `watchExplicitSources` 给 FSWatcher 挂 `error` 监听:记一行 `[alpha-code#1667] stopped watching <根> for engine config inputs: <原因>`,不抛;用例对监听器 emit `error` 断言。
  5. 查 `writeEngineConfigForFork` 里非 IO 的计算有没有可达的抛出:模型投影的读法都退化不抛(已应用目录坏 ⇒ 随包 / 空,自定义节点真源坏 ⇒ 记一行、空,密钥文件读不了 ⇒ 当没有),`skillGenerationLiveDirs` 读不了 ⇒ 空,`applyPromptTakeover` 纯函数,`composeExplicitDocument` 接住解析错误,`disabledPackageComponents` 以 `sideEffectFree` 读、坏了 ⇒ 空。没有找到可达的抛出;日志措辞不改:设计 §5 钉的就是 `[I-13] engine config files could not be written — refusing to fork:` 这一行,AC-05 两条用例断言它,改成「could not be prepared」会动冻结的日志行与断言的含义。
- 2026-11-20 · 单元 B 落点与证据:
  - 偏离:环境根恒列进受保护集(状态根之内时是一条冗余规则),不再按真实路径判「在状态根之内就不另列」—— 省掉一次按字符串判包含,规则只多不少;计划用例相应写成「环境根恒列」。
  - `process-fence-compile.test.ts` 的生产形状改由 `planConfigFence`(恒等 realpath、不建目录)给出受保护集,两块拒写也进真 `sandbox-exec` 试编译;`process-fence-extension.cases.ts`、`fence-write-denied.engine.cases.ts`、`project-writable.engine.cases.ts` 手渲染臂、两个签名形态夹具经 `planConfigFence` 带生产受保护集;只判别的轴的测试传空集。`project-trust-truth-fence` 的审计臂改为断言「环境根在围栏里挪不动」(W2 删后的新事实),`custom-provider-truth` 注入的伪造行标签由 W2 改 W99。网络行形状用例改在空受保护集上判(有受保护集时网络行紧贴两块之前)。测试运行时的原因类型改用生产联合。
  - 红 `de36104d6c`(`evidence/unitB-red.log`)→ 绿 `2d5130179e`;界面红 `d2ea3e2606`(`evidence/unitB-ui-red.log`)→ 绿(本提交)。变异:M1(解析器换回「放行块后见拒写即抛」)⇒ profile / plan 五条往返与覆盖用例红,真引擎 `project-writable.engine` 里本运行新登记的项目拿不到放行(5 条子用例红,`mutations/M1-…`);M2(去掉受保护位置资格判定)⇒ 资格、并集、计划、跟踪器四条红,跟踪器那条即「受保护位置之内被登记 / 签发」(`mutations/M2-…`)。
- 2026-11-20 · 观察(已有缺陷，不属本片)：`packages/ui-mac/src/main/server.test.ts:875` 的「`OPENCODE_CONFIG_DIR="."` 被忽略」用例用 `"."` 做「日志里不带值」的判据，worktree 里没有构建 `packages/ext/dist` 时，`codepuppy-ext: NOT loaded — … dist/server.js` 那一行恰好含 `.`，用例转红；`bun run build`(packages/ext,产物被 git 忽略)之后转绿。实施期按此构建了 ext dist。
- 2026-11-20 · 观察(编排器裁决：记录、不加机制，设计另加留档)：CF 位置本身是悬空软链时 `realpath` 报 `ENOENT`，计划器按「不存在」只保护链本身，链指向的、尚不存在的目标不在规则里。围栏内建不出这种链(位置本身被拒)，只有改动前的会话或用户自己能留下它，与残留 R6 / R8 同类。
- 2026-11-20 · 实现期修订 2 A(设计修订片段 `~/.cache/alpha-orch/2026-11-19/config-fence-design/r4/design-delta.md`，编排器采纳)：`$CODEPUPPY_ENV_FILE` 指向的那份并入 CF-4。唯一来源 `codepuppy-secrets.ts` 的 `userEnvFile(env)`(相对路径按 cwd，与 `readFileSync` 一致)，`loadCodePuppySecrets` 与 `server.ts` 交给计划器的值都取它；`configFenceLocations` 收可选 `envFile`，排在 CF-4 那条之后；`planConfigFence` 对这一项从不失败(上级目录不在盘上取最深一级已存在祖先的真实路径接上余下部分；解析出错按设置的路径写；写不进 profile 的路径不写)，本身是软链加真实目标。文件：`codepuppy-secrets.ts`、`process-fence-profile.ts`、`process-fence-plan.ts`、`server.ts`。红 `81e4f92f8c`(`evidence/deltaA-red-*.log`)→ 绿(本提交；红提交里「上级目录不在盘上」用例的假 realpath 把整个 HOME 映到别处，默认工作区随之「不在盘上」，绿提交改成只把最深一级已存在祖先映到别处，断言不变)。变异：去掉 server 接线 ⇒ 计划输入用例红(`mutations/deltaA-no-wiring.log`)。
- 2026-11-20 · 实现期修订 2 B / C(同一份设计修订片段)：`ConfigFenceRule` 多一个可选 `via`(位置配置路径上、不在真实路径上的目录节点，计划器按身份去重：已存在且不是软链的节点取真实写法，软链或尚不存在的节点取「真实上级目录 + 自己的名字」)，渲染器把它接在该规则真实路径节点之后进上级目录块，解析与覆盖判定不变(literal 只在等于目录时算 ⇒ 这样的节点作为项目走签发路径)。配置路径与真实路径相同时不带 `via`，profile 字节不变。C 不改代码：坏软链目录位置让预建抛错、计划失败(Electron Node 报 ENOENT，bun 报 EEXIST)，用例钉住。文件：`process-fence-profile.ts`、`process-fence-plan.ts`。红 `26d13bf0de`(`evidence/deltaB-red.log`)→ 绿(本提交)。
- 2026-11-20 · 单元 C 落点与证据(含两轮插入的审查修复与修订 2):
  - E1 / E2 `fd4c55145b` + `cd1c97419a`:宿主内层 11 条。生产臂 43 处位置 / 写法 × 280 次尝试 0 次落地，事后围栏外读盘不变；已知坏(同一宿主)去掉受保护集补回 W2 / W6 236 次落地、受保护块写在放行块前 195 次、没有上级目录块 userData 整个被改名移走、软链位置不加真实目标 25 次、X1 写在受保护块后受保护位置被写。审查列的点名臂都单独断言：literal 挡新建(六种建法)、`.DAT` 大小写、HOME / userData / `~/.config` 节点冻结而 W8 改名覆盖照常、软链位置的真实目标、userData 本身是软链、`~/.config` 作为项目(其余文件落盘、`opencode/` EPERM)、上级目录节点走签发路径并签两次无害。修订 2 A / B 臂见对应证明行；变异「渲染器丢掉 via」⇒ B 臂与 userData 软链臂红。
  - E9 `3f67013307`:`project-writable.engine` 内层 14 → 15。M2 ⇒ 本条红(`mutations/M2-engine-e9.log`)。偏离：包含受保护位置的文件夹用导出到写根之外的引擎全局配置目录的父目录(`run/user-config`),`~/.config` 作为项目的那一臂在 E1 的 X1 用例里(真 .node 签发)。
  - E3 / E5 / E8 `60bfe78c02`:四个 cases 进程(production 4 / fresh 1 / control 1 / noprecreate 1)。系统沙箱日志(production 运行窗口，按受保护规则判路径):引擎 pid 0 条，攻击子进程 5 条作校准；已知坏「注入里吞掉错误地碰一下显式文件」⇒ cases 全绿而日志判据红(`mutations/E5-swallowed-engine-write.*`)。偏离与说明：0.2.6 形状里「上一版留下的显式文件与 models.json」放的是不带 Code Puppy 那一层的旧显式文件与空底表(判 main 在 fork 前把它们换掉，不判字节相同);工具策略文档的分区按引擎对非版本库文件夹的项目 id(`directory:<路径>` 的哈希)预置，运行时断言与 ext 算出的分区相等；fresh 臂按生产顺序先跑 `planConfigFence` 再让宿主写配置(审查 B 第 1 条要的 0700 在这一臂断言);日志判据只判 production 臂；bun test 以 TZ=UTC 运行，日志窗口带 `+0000` 交给 `log show`。
  - 审查 B(Unit B 检查点)三条，新提交、红 → 绿：1 `1abad2c809`(0700 在生产顺序里不生效 ⇒ 建完 chmod;红 `evidence/reviewB1-red.log`:448 vs 493);2 `e59c7d1feb`(计划前受保护目录与计划器同一来源 `preplanConfigFenceRoots` / `usableExportedPaths`;红 `evidence/reviewB2-red.log`:四条红);3 `565588d2aa`(解析器拒通配 `file*`;红 `evidence/reviewB3-red.log`)。注释更正随 2 一起提交。
  - 修订 2 A 红 `81e4f92f8c` → 绿 `964d2f19e3`;B 红 `26d13bf0de` → 绿 `dec6ffd9ae`;C 只钉住(同在 B 红提交里)。
  - 收口：事实文档与 `gate-files.tsv` `0ecfd84019`(两个新宿主各 1 行；改动行按实测写回条数，过时的 W2 说法改掉)。登记层检查与 15 个改动行的 `bun-test-floor.sh =N` 全绿(`evidence/floor/`);ui-mac `tsgo -b` 干净；`git diff --check` 干净。签名形态宿主一次：宿主 1 pass / 0 fail,内层 3 pass / 0 fail,734 s(`evidence/unitC-signed-form.log`)。
  - 模块体量：`packages/ui-mac/src/main` 实测 68,861(片起点 68,465,单元 B 结束 68,767;本单元 +94,主要是 `preplanConfigFenceRoots`、`userEnvFile`、计划器的 env 文件与配置路径节点);不改棘轮行。
  - 观察(不属本片，未改):计划器的 `homeDir` 用 `os.homedir()`,启动文档用 `usableExportedPaths` 的 HOME;只有 HOME 被导出为相对路径时两者不同(审查 B 第 2 条只要求计划前的资格判定与计划器同源，这一处没动)。
- 2026-11-20 · 终审(`c7fd4eefdf..3af6988000`)处置,新提交:
  1. B-2 用例不再对 bun 启动时的真实 HOME 跑 mkdir / realpath:集合比较改比计划器那一步的输入位置,诚实项目那条用假 HOME(`d2e4b5c681`)。
  2. `$CODEPUPPY_ENV_FILE` 的真实路径落在 `/dev` 下(含经软链)⇒ 不出这一行;红 `evidence/final2-red-*.log`(三项实测 EPERM)→ 绿(本提交)。
  3. 配置路径每个节点所在真实位置的上级链也进上级目录块(两跳软链的中间真实目录);红 `evidence/final3-red-*.log`(生产臂实测换掉、读到 evil)→ 绿(本提交)。
  4. 写不进 profile 的配置路径节点(引号等)逐个丢,规则与其余节点照留(env 文件的 literal 不再整条丢;配置目录经这样的软链时计划不再失败);红 `evidence/final4-red.log` → 绿(本提交)。
  6a. 配置路径节点「同一对象」按 device + inode(`lstat`,计划器依赖里新增可选的 `lstat`,生产默认 `lstatSync` bigint),不再按小写字符串;红 `evidence/final6a-red.log` → 绿(本提交)。
  5 / 6b / 6c. 写入矩阵:已放行的 `~/.config` 本身改名(生产拒、X1 在后的已知坏通过);每次攻击的结果集合与矩阵逐条相等;去掉受保护集的已知坏臂里文件 / 目录 / 新建各一个位置与两种 firmlink 写法的每种手法都 OK(`a9e8de01ba`)。
  7. 措辞:真引擎宿主的对照臂经 W12 落地(沙箱在系统临时目录下),不是补回的 W2 / W6;写入矩阵覆盖的写法按位置写明;`custom-provider-truth.test.ts` 的固定 id 数改成 13。`gate-files.tsv`:`process-fence-plan` 22 → 26,`process-fence-config-fence` 内层 11 → 13。
- 2026-11-20 · 确认审查 R2(`3af6988000..611815ad0e`,RECOMMEND MERGE)处置,新提交:
  1. env 文件是指到 `/dev` 下的软链时只丢 `/dev` 下那条,链节点 literal 与路径节点照留(上一轮钉住的「链本身也不冻结」改正);红 `evidence/r2-1-red-*.log`(删链、换成普通文件都成功)→ 绿(本提交;经链写入照样到 `/dev/null`,删链 / 改名覆盖 EPERM)。
  3. 计划器用例在假路径上一律注入假 `lstat`(`5847dc202a`)。
  2. 残留(编排器裁决，不再在本片补这一族):**R10** —— 只出现在某条软链**存放的目标文字**里、本身又是可写项目里另一条软链的目录(例:`XDG_CONFIG_HOME=/W/a`,`/W/a → /W/s/t`,`/W/s → /W/real-s` 时的 `/W/s`)不冻结;冻结的是配置路径的每个节点、真实路径的每个节点、以及每个配置路径节点所在真实位置的上级链。闭合 = INT-safety I-27(一次逐段解析，收集走过的每个目录项)。写入矩阵宿主里有一条与 R8 并列的保证外对照臂(断言落地，I-27 闭合时翻转)。**R11** —— 绝对路径含 `"`、`\` 或控制字符的 `via` 节点写不进 profile，不冻结(位置自己的规则不受影响;env 文件自己的路径写不进时同样不保护);计划时记一行 `process fence: protected configuration — N path(s) cannot be written into the profile … : "<路径>", …` 逐个点名(红 `evidence/r2-r11-red.log` → 绿)。
  计数:`process-fence-plan` 26 → 27,`process-fence-config-fence` 内层 13 → 15。

## 片 ④：计划文件移到引擎数据目录，`~/.opencode` 整个受保护、谁都不建

- 依据：规格 `docs/specs/engine-config-fence/spec.md` v3(owner 2026-11-20 批准)的 BR-07、AC-08 与「用户会碰到的限制」第四条；冻结设计 `docs/specs/engine-config-fence/design.md`(approved；读的是参考树 `feat/config-fence-core` @ `7e2c8a098d`)§1 (a) 末句、§2 P-13 / P-14、§4.1 CF-9、§4.2 W 行(删 W16)、§4.3(不预建 `~/.opencode`；资格判定)、§4.8、§6 I4 / E2 / E11、§10 D12 ④ / D13(D4 已撤回)；意图 impharaon/alpha-work `docs/intents/INT-safety.md` I-13。这次新增上游接管的同意：owner 2026-11-20 回复编排器给的三个选项「我建议 A：改存到引擎数据目录」(A = 计划文件改存到引擎数据目录)。派单没有给 Issue 编号。读码基线是参考树 `7e2c8a098d`(主线 `6fd2f359a1` + 片 ②)。实施工作树从片 ② 合入后的主线建，下文行号都按参考树。
- 核对：Phase: IMPLEMENT — plan(临时文件 `~/.cache/alpha-orch/2026-11-19/impl-fence-slice4/plan-section.md`)· 编排器 / Claude Fable 5.2 · 通过(对 BR-07 / AC-08 与冻结设计核对)。裁决：`plan.test.ts` 按成对接管(改 `:27`、两条都进清单)；ADR-047「精确接管面」加一行获准，逐字引用 owner 同意原话，`.claude/rules` 下不改别处(权威保持表的计数照旧不动)；`server.ts:215-216`、`network-egress-derived.ts:23-24` 两处过时注释准在文档 / 登记那个提交里只改注释；CF-9 的预建跳过与 M4 必做，fresh 臂在完整启动之后与写计划之后都断言 `~/.opencode` 不存在；`CODEPUPPY_JSONC_TRUTH_DISABLE=1` 的观察不写代码，记进本节观察，另核一件事并回报(见「观察」)。实施工作树 `feat/config-fence-plan-dir` 从 `origin/alpha` `69c1267835`(片 ② 已合入,#1735)建，与参考树 `7e2c8a098d` 的树相同，行号不变。

PLAN 阶段按派单写在临时文件里，没有提交；本节由实施阶段第一次提交放进 plan.md。路径前缀 `main/` = `packages/ui-mac/src/main/`。下面的命令都是实施安排，还没有在实施分支上运行。约定沿用片 ①、片 ②：先提交红测试，再提交实现；宿主 `*.test.ts` 起同名 `.cases.ts`。

### 计划阶段核过的代码事实(只读参考树)

| 编号 | 事实 | 对本片的影响 |
| --- | --- | --- |
| F1 | `packages/core/src/plugin/plan.ts:31` 是唯一的目录值。`:14-21` 的提醒、`:40` 的编辑放行、`:50` 的拒绝文案都取同一个 `directory`。这个文件与上游父 `33f94fce96` 逐字相同 | 接管只改 `:31` 一行 |
| F2 | 引擎的 `global.data` = `<XDG_DATA_HOME>/opencode`(`packages/util/src/global-roots.ts`)。Global 装载时会递归建它(`packages/util/src/global.ts:63-73`)。计划器的父目录预建循环本来就建它(`main/process-fence-plan.ts:233-240`)。写文件工具会自动建缺失的上级目录(`packages/core/src/tool/plugin/write.ts:51`) | 计划器不用为新位置多建任何东西 |
| F3 | `main/process-fence-plan.ts:88` 的预建循环对清单里**每一个** subpath 位置都调 `mkdirp` | CF-9 是 subpath。不排除它，就会把 `~/.opencode` 建出来，所以必须显式跳过 |
| F4 | `packages/core/test/plugin/plan.test.ts` 的六处钉都从 `:27` 的 `planDirectory` 派生。接管之后只有 `:164`、`:252`、`:287` 三条会变红，钉的分别是提醒正文、编辑放行、拒绝文案。`:245`(激活时不建目录)和 `:264`(external_directory 放行)换了路径照样绿 | 按仓库先例，被接管的值所在的上游测试随源文件成对接管(`oauth/page.ts` 与 `oauth-page.test.ts`；`to-session-error.ts` 与 `session-runner-retry.test.ts`)，设计 §4.8 也是这样写的。片 ① 的钉住已知红名单用于「大量上游用例间接依赖被改行为」(64 条)，不适用这里。改法：只把 `:27` 改成 `path.join(Global.make().data, "plan")`。测试交给插件的 Global 服务本来就是 `Global.make()` 展开(`:104`)，数据根来自测试隔离预载的临时根 |
| F5 | 登记册里的每个证明文件，都必须在 `scripts/gate-files.tsv` 有一行写明精确条数(`scripts/assert-authority-proofs.sh`)。`plan.test.ts` 今天不在闸门里，共 12 条 | 新增一行，条数 12 |
| F6 | 引擎适配器夹具记下了 `packages/core` 的 tree id，由 `packages/ui-mac/src/engine-adapter/fixture-identity.test.ts` 核对。17 个夹具今天都等于参考树的 `01c91dddf7`。引擎路径有未提交改动时，采样器拒绝运行 | 改了 core，就要在接管提交**之后**全量重采。三份样本里有旧路径(`catalog`、`passthrough`、`routes` 里计划助手的 `edit <沙箱 HOME>/.opencode/plan/*`)。它们只是数据，夹具的消费方不断言它 |
| F7 | 写盘登记簿 `scripts/process-fence-write-sites.tsv` 里没有落在 W16 的行；sidecar 闭包里也没有写 `~/.opencode` 的写者 | 登记簿的行不变，只把 W16 加进根合法性用例的非法名单 |
| F8 | 资格判定用的受保护根，都取自同一份位置清单：计划之后是计划器的 `configFenceRoots`，计划之前是 `main/server.ts:319` 的 `preplanConfigFenceRoots` | CF-9 进了清单就进了资格判定，资格判定的代码不改 |
| F9 | 引擎这一侧只有 `plan.ts` 会建 `.opencode`(在 `packages/core/src`、`packages/server/src`、`packages/util/src` 里 grep `"\.opencode"`)。ext 的「工作区外先问」只加在 build 与 codepuppy-ask 上(`packages/ext/src/external-directory-rule.ts:20`)，计划助手保留引擎底座的 external_directory 放行 | 真引擎用例里，计划助手写新位置预期不会弹审批 |
| F10 | 真引擎宿主 `main/engine-config-fence.engine.cases.ts` 的 fresh 臂已经是全新机器形状(没有数据目录、没有 `~/.opencode`)，用生产计划器 + 生产 .node 把进程关进围栏，引擎跑在围栏里。引擎沙箱在系统临时目录下(W12 之下)，所以那里的 `~/.opencode` 只靠 CF-9 挡。围栏里的进程只许向代理端口出网 | 真引擎用例放在 fresh 臂；适配器接在 `running.fetch` 上做进程内分发，不走网络 |

### 改动

**生产代码**

| 文件 | 改什么 |
| --- | --- |
| `packages/core/src/plugin/plan.ts` | 把 `:31` 改成 `path.join(global.data, "plan")`，行尾加 `codepuppy(I-13 D13)` 标注(一句理由，指向设计 §4.8)。提醒、放行、拒绝文案跟着同一个值走，不另改文字 |
| `main/process-fence-profile.ts` | ① 新增导出 `homeOpencodeDirectory(home)` = `join(home, ".opencode")`。这是 CF-9 路径唯一的写法，清单与计划器共用。② `configFenceLocations` 在 CF-8 之后、CF-10 之前(`:139` 与 `:140` 之间)加 `{ kind: "subpath", path: homeOpencodeDirectory(input.home) }`；函数说明(`:109-111`)同步改。③ 删掉渲染行 `:226` 的 W16 与 `WRITABLE_ROOT_IDS.W16`(`:66`)，`:48-52` 的说明与文件头 `:12` 同步 |
| `main/process-fence-plan.ts` | `planConfigFence` 的预建循环(`:88`)跳过 `homeOpencodeDirectory(input.roots.home)`(F3)；文件头 `:14-21` 改述：W16 已删，`~/.opencode` 是 CF-9，谁都不建 |

**接管登记(ADR-029 §3 / ADR-047 / ADR-048)**

| 文件 | 改什么 |
| --- | --- |
| `scripts/north-star-guard.sh` | `UPSTREAM_EXCLUDES` 末尾加 `packages/core/src/plugin/plan.ts`、`packages/core/test/plugin/plan.test.ts` 两条。前置注释写明：I-13 D13、owner 原话、为什么挂不了钩子、改动面(源文件一行 + 测试 `:27` 一行)、判据 |
| `.claude/rules/adrs/ADR-047-opencode2-engine-generation.md` 「精确接管面」 | 只追加一行，不改别的行(编排器核对时批准;逐字引用 owner 同意原话「我建议 A：改存到引擎数据目录」,2026-11-20,A = 计划文件改存到引擎数据目录)。五列：路径两条；为什么挂不了钩子(目录在插件内部算出，同一个值写进存档的提醒、编辑放行与拒绝文案；插件能另加一条放行，改不了告诉模型往哪写的那句提醒)；守卫(`UPSTREAM_EXCLUDES` 两条；对上游原文件，`plan.test.ts` 三条与真引擎 fresh 臂会红)；回滚(两个文件换回 `33f94fce96` 的版本，再删掉两条清单；必须与 CF-9、W16 在同一个提交里回退，D12 ④)；归属(I-13 片 ④)。「权威保持表」的计数不改(片 ① 已交编排器) |
| `docs/architecture/codepuppy-authority-registry.json` | 新增一项 `plan-directory-in-engine-data`：decision；adr `ADR-047`、`ADR-048`；lane；takeovers 两条；approval(quote「我建议 A：改存到引擎数据目录」，2026-11-20，by owner(经编排器转达)，reason)；mechanism 是 `packages/core/src/plugin/plan.ts`，ladder 为 L3 的一值接管；tests 是 `plan.test.ts` 的三条用例名(`injects enter and leave reminders on agent switches`、`allows edits only inside the Plan directory`、`rewrites blocked mutation failures with the Plan directory`)加真引擎宿主 `main/engine-config-fence.engine.test.ts` 的宿主用例名；note 写反向臂与复现命令 |
| `scripts/gate-files.tsv` | 新增一行 `12	packages/core	test/plugin/plan.test.ts`(登记册的证明文件)。`process-fence-config-fence` 15 → 17；`engine-config-fence.engine` 的 fresh 1 → 2。`process-fence-profile`、`process-fence-plan`、`process-fence-write-sites`、`custom-provider-truth` 这几行只改描述里的 W16、固定 id 数(13 → 12)和受保护集说法，条数不变，按实测写回 |
| `main/server.ts:215-216`、`main/network-egress-derived.ts:23-24`(编排器准改) | 只改注释:这三条配置路径(`codepuppy.jsonc`、`<XDG_CONFIG_HOME>/opencode`、`~/.opencode`)现在都在受保护配置集里、围栏内不可写,不再说它们在可写集 W2 / W6 / W16 之下;主进程不读它们的理由照旧 |
| `docs/architecture/2026-09-09-req159-process-fence.md` | 事实同步：`:54` 写明 W16 已删；受保护配置集一段(`:56-62`)加 CF-9(整个 `~/.opencode`，不预建)；加一句计划文件在引擎数据目录(W4 之下)；测试表里 `process-fence-profile`、`process-fence-plan`、`process-fence-config-fence`、`engine-config-fence.engine` 四行补上本片的判据 |

**测试与夹具**

| 文件 | 改什么 |
| --- | --- |
| `packages/core/test/plugin/plan.test.ts` | 只改 `:27`(F4)。12 条 |
| `main/process-fence-profile.test.ts` | 逐行形状去掉 W16(`:122`)；`CF_LINES` 在 `.config/opencode` 之后加 `(subpath "${HOME}/.opencode")`(上级目录块不变，HOME 本来就在)；id 集合去掉 W16(`:207`)；往返用例的 ALLOW 去掉 `.opencode`(`:257`)；「位置清单」用例(`:163`)改成断言 CF-9 在清单里、排在 CF-8 之后，用例名去掉「不含 ~/.opencode」。条数不变，35 |
| `main/process-fence-plan.test.ts` | 日志条数 `configFence=14` → 15(`:81`)、15 → 16(`:234`)；两处 `configFenceRoots` 精确列表加 `${HOME}/.opencode`(`:184`、`:219`)；BR-05 用例(`:450`)的真源再放 `~/.opencode` 与 `~/.opencode/proj`，两条都应进 excluded，并点名 `${HOME}/.opencode`。`:68` 的精确 `made` 列表、`:86` 与 `:221` 的「不建 `.opencode`」断言都不动，它们就是「不预建」的判据。条数不变，27 |
| `main/process-fence-write-sites.test.ts` | 根合法性用例(`:196-198`)把 W16 列为非法，用例名同步。条数不变 |
| `main/custom-provider-truth.test.ts` | `FIXED_ROW_IDS` 去掉 W16(`:82`)；`:97` 用例名里的「13 个」改成「12 个」。条数不变 |
| `packages/ui-mac/native/codepuppy-fence/test/config-fence-ops.c` | 新模式 `create-dir <path>`，`path` 是一个尚不存在的受保护目录位置。三种手法：`mkdir-p`(先建它，再建 `plan`)；`rename-dir-into`(把工作区里备好的目录改名过去，里面装着 `opencode.json` 与 `plugin/x.js`)；`clone-dir-at`(把同一个目录 `clonefile` 过去)。哪种成功了，就按已知结构拆掉，下一种单独判。注释里不写缓存路径 |
| `main/process-fence-config-fence.cases.ts` | `OPS` 加 `"create-dir"`。`granted()` 加一个可选的 `prepare`：在 build 之后、起围栏子进程之前，在围栏外运行，用来预置 `~/.opencode`。新增两条用例(见「证明」AC-08 ① ②)和两种已知坏变换：`todaysRows`(在放行块 W15 之后补回 W16 行，并删掉受保护块里 CF-9 那一行)；`withoutCf9`(只删 CF-9 那一行，W16 仍然删掉)。宿主 `main/process-fence-config-fence.test.ts` 的钉 15 → 17 |
| `main/engine-config-fence.engine.cases.ts` | fresh 臂改成在 `beforeAll` 里起机器与引擎，在 `afterAll` 里收；原 AC-06 ③ 用例的断言不变。新增 AC-08 用例(见「证明」)。头注释的 fresh 一段补一句。宿主 `ARMS.fresh` 1 → 2，宿主用例名加上 AC-08 |
| `packages/ui-mac/src/engine-adapter/fixtures/*.json`(17 个)、`scripts/old-name-exceptions.tsv` | 用 README 里的采样器全量重采(F6)，逐个比对，每一类差异都写进偏离记录。`events.json` 里采样 CLI 的路径词元会随新工作树改变，旧名例外那一行跟着换，同片 ① 的处理 |

不改：资格判定代码(F8)；写盘登记簿的行(F7)；`codepuppy-config-injection.ts` 与 ext(F9)；采样器脚本；「清除数据」；任何文案与配置。

### 顺序

1. **C0 计划**：本节进 plan.md，front-matter 的 summary 加上片 ④，并填好「核对」行。
2. **C1 测试先红(按构造必红)，不改生产代码**：表里所有测试与夹具改动(夹具除外)，包括 C 程序的新模式。在未改的代码上运行，红输出存进 `~/.cache/alpha-orch/2026-11-19/impl-fence-slice4/evidence/c1-red-*.log`：
   - `cd packages/core && bun test test/plugin/plan.test.ts`：3 红(`:164`、`:252`、`:287`)、9 绿；
   - ui-mac 单元：profile(形状、id、CF 清单、往返)、plan(条数、列表、BR-05)、write-sites(W16 仍合法)、custom-provider-truth(固定 id)都红；
   - 写入矩阵宿主：AC-08 production 红(W16 在，`~/.opencode` 建得出来)，known bad 绿；
   - 真引擎 fresh 臂(直接以 `CODEPUPPY_CF_ENGINE_ARM=fresh CODEPUPPY_CF_ENGINE_ROOT=<worktree>/node_modules/.cache/engine-config-fence/run` 跑 cases，省掉其余三臂)：AC-08 红(提醒点名 `<HOME>/.opencode/plan`，文件写到了那里，`~/.opencode` 被建出)。
   - `bash scripts/north-star-guard.sh` 点名 `plan.test.ts`(C1 改了上游测试、清单还没加)，这一步也是按构造必红。
3. **C2 实现(D12 ④ 的原子单元，三件事同一个提交)**：`plan.ts`、`process-fence-profile.ts`、`process-fence-plan.ts`、守卫两条、ADR-047 一行、登记册一项、`gate-files.tsv`、事实文档。之后跑下面的相关检查组 A–D，全绿。只有 `fixture-identity.test.ts` 按构造是红的：core 的 tree id 变了，C3 修复。
4. **C3 重采夹具**：采样器要求引擎路径没有未提交改动，所以放在 C2 之后。采样大约 30 秒，会联网取 opencode 免费模型目录，与片 ① 相同。重采后 17 个夹具逐个比对(屏蔽 id、时间、端口、临时目录与 slug)。预期只有这几类差别：`_engine`；三份样本里计划助手的放行从 `<沙箱 HOME>/.opencode/plan/*` 变成 `<沙箱 HOME>/.local/share/opencode/plan/*`；工作树路径与分支；联网模型目录的漂移；时序。逐类写进偏离记录，再跑检查组 E 与 `old-name-scan.test.ts`。
5. **变异运行(不提交，每次只改一处，用 `git restore` 复原；输出存 `~/.cache/alpha-orch/2026-11-19/impl-fence-slice4/mutations/`)**：
   - M1：`plan.ts` 换回上游原文件(`git show 33f94fce96:packages/core/src/plugin/plan.ts`)⇒ `plan.test.ts` 三条红，真引擎 fresh 臂 AC-08 红。这也是登记册的反向臂。
   - M2：清单去掉 CF-9(W16 仍删)⇒ plan BR-05、profile `CF_LINES`、写入矩阵的 X1 子臂红。
   - M3：补回 W16 行(保留 CF-9)⇒ profile 形状与 id、custom-provider-truth、write-sites 红。
   - M4：去掉预建跳过 ⇒ `process-fence-plan.test.ts:68` 与 `:221` 红。
6. **收口**：core 与 ui-mac 类型检查、`git diff --check`、新增与改动的闸门行各跑一次 `bun-test-floor.sh`。登记层检查和每一个闸门步骤，等编排器给出 `GATE_ALLOW_FULL` 时再逐个跑。签名形态宿主跑一次(`CODEPUPPY_TEST_SIGNED_FENCE=1 bun test src/main/process-fence-extension-packaged.test.ts`，约 12 分钟)，因为它的夹具经 `planConfigFence` 带上了 CF-9。

**相关检查**(都在 `packages/ui-mac` 下执行，只传宿主 `*.test.ts`；机器上有完整门在跑时，bun 加 `--max-concurrency 2`)：

- A core：`cd packages/core && bun test test/plugin/plan.test.ts`；`bun run --cwd packages/core typecheck`。
- B 单元：`bun test src/main/process-fence-profile.test.ts src/main/process-fence-plan.test.ts src/main/process-fence-write-sites.test.ts src/main/custom-provider-truth.test.ts src/main/process-fence-workspaces.test.ts src/main/server.test.ts src/main/process-fence-compile.test.ts src/main/process-fence-apply.test.ts src/main/process-fence-wiring.test.ts src/main/workspace-write-probe.test.ts src/main/workspace-write-probe-fence.test.ts src/main/network-egress-fence.test.ts src/main/mcp-server-truth.test.ts src/main/egress-grant-truth.test.ts src/main/project-trust-truth-fence.test.ts src/main/custom-provider-truth-fence.test.ts src/main/process-fence-zsh-startup.test.ts src/main/process-fence-extension.test.ts src/main/engine-explicit-config.test.ts`。其中 `server.test.ts` 核对计划器与计划前的受保护根是同一份；`process-fence-compile` 把受保护集交给真 `sandbox-exec` 试编译。
- C 围栏 / 真引擎宿主(串行)：`bun test src/main/process-fence-config-fence.test.ts src/main/engine-config-fence.engine.test.ts src/main/fence-write-denied.engine.test.ts src/main/project-writable.engine.test.ts src/main/engine-db-records.engine.test.ts src/main/process-fence-engine.test.ts`。
- D 守卫与登记：`bun test src/main/north-star-guard.test.ts src/main/local-gate-parity.test.ts src/main/north-star-drift-metrics.test.ts src/main/sync-upstream-owned-files.test.ts src/main/sync-upstream-takeover-isolation.test.ts src/main/gate-file-registry.test.ts`；`bash scripts/north-star-guard.sh`(仓根)；`cd packages/ext && bun test src/policy/authority-registry.test.ts`。
- E 夹具：`bun test src/engine-adapter/fixture-identity.test.ts src/engine-adapter/contract-cases.test.ts src/engine-adapter/projection-parity.test.ts src/engine-adapter/passthrough-reads.test.ts src/engine-adapter/routes-coverage.test.ts src/main/old-name-scan.test.ts`，以及采样器 README 列出的九个适配器测试。
- 收口：`bun run --cwd packages/ui-mac typecheck`(ui-mac 的类型检查不含 `*.test.ts` / `*.cases.ts`，所以 B–E 必须实际跑)；`git diff --check`；`bash scripts/bun-test-floor.sh <N> <目录> <文件>` 对新行与改过的行各跑一次。

### 风险

- **预建陷阱(F3)**：CF-9 进了清单，现有循环就会建出 `~/.opencode`。跳过它和 CF-9 在同一个提交里。精确 `made` 列表(`process-fence-plan.test.ts:68`)与 M4 能看见漏掉跳过的情况。
- **与片 ③ 改同一组位置**：两片都会改位置清单、`CF_LINES`、计划器的条数与列表、`gate-files.tsv` 的行。后合入的那一片按实测重算这些数，不手抄。
- **真引擎的计划回合可能遇到策略询问**：F9 推断不会问。如果实测问了，用例记下 `asked` 并失败，我把它作为发现交回。不自动批准，也不加规则。
- **夹具重采**：会有联网目录的漂移和工作树路径的变化，每一类差异都要解释；还要同步旧名例外一行。
- **写入矩阵的已知坏 `todaysRows`**：它依赖「HOME 的上级目录 literal 只冻结节点本身，不挡在 HOME 里新建条目」。片 ② 的 E2 已经证明 `.zsh_history` 的改名覆盖在这条 literal 下照常。如果实测被挡，就是测量结果，我交回，不放宽断言。
- **真引擎宿主耗时与机器负载**：C1 的红只跑 fresh 臂；完整宿主在 C2 之后跑一次、M1 再跑一次；按机器纪律串行运行，有门在跑时限并发。
- **受保护资产**：ADR-047 在 `.claude/rules` 下。按派单只追加一行，编排器核对计划时确认。
- **模块体量**：生产代码在 `packages/ui-mac/src/main` 约 +6 行，测试约 +200 行。不改棘轮行，在回执里如实报告。
- **待决意图项 I-30(计划目录换成软链 + 路径串放行)在新位置上的样子**：`<XDG_DATA_HOME>/opencode` 在 W4 之下，围栏里照样能把 `plan` 建成或换成软链，与今天 `~/.opencode/plan` 在 W16 之下一样。计划助手的放行仍是路径串 `<数据目录>/plan/*`：`FileAccess` 只做词法归一，不解析软链，`plan/../x` 归一后不匹配这条放行，所以经链写入落在链目标上，由目标所在位置的围栏规则判定。链到工作区时落地，与今天相同(`DOT3.out` e1)；链到受保护位置时按解析后的路径被拒(e3–e5)，今天 P0 下这三种都成功，所以比今天好。链到引擎数据目录里的其他文件，与今天经 `~/.opencode/plan` 链过去的结果相同；而且能建这条链的命令本来就能直接写那里。结论：没有变坏，本片也不碰它。

### 证明

| AC | 测试 / 证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-08 ①：`~/.opencode` 不存在时，任何形式都建不出它，事后仍不存在 | `process-fence-config-fence.test.ts` → cases 新用例「AC-08 production」：生产计划器 + 生产渲染 + 生产 .node；假 HOME 里没有 `~/.opencode`。`create` 模式六种(普通文件、软链、mkdir、文件改名过去、硬链、文件 clone)加 `create-dir` 模式三种(mkdir -p、备好的目录改名过去、备好的目录 clone 过去)全部 `FAIL 1`；事后在围栏外 `lstat` 得到 ENOENT | 同一宿主的「AC-08 known bad」：在 `todaysRows`(今天的规则：W16 在，没有 CF-9)下，这九种全部 `OK`，这是正向对照，事后由助手程序拆掉。去掉预建跳过(M4)⇒ 精确 `made` 列表红 |
| AC-08 ②：`~/.opencode` 已存在时，其下任何写入被拒，读取照常 | 同一条新用例：在围栏外预置 `~/.opencode/{opencode.json, plan/old.md, plugin/}`。`file` 模式(`plan/old.md`、`opencode.json`)和 `dir` 模式(`~/.opencode`、`plan/`)全部 `FAIL 1`；围栏内 `cat plan/old.md` 读出原文；事后字节、目录列表与权限都不变。再用运行期放行(X1)签发 `~/.opencode` 本身之后写入，仍然 `FAIL 1` | `todaysRows` 下，追加、截断、新建再改名覆盖、删除、在目录里新建都 `OK`。`withoutCf9`(W16 仍删)加 X1 ⇒ 写入 `OK`，说明 CF-9 那一行本身是承重的 |
| AC-08 ③：在「全部批准」档选「计划」并要求写计划时，文件写在 `~/.local/share/opencode/plan/`，写文件卡片显示这个路径 | `engine-config-fence.engine.test.ts` fresh 臂的新用例。环境：全新机器形状；生产计划器 + 生产 .node 把进程关进围栏；真嵌入式引擎 + 真 ext + 生产注入。请求按界面的方式发出：用生产 `buildPromptRequest({ perm: "allow", agent: "plan" })` 构造(先断言 `permLocksAgent("allow")` 为 false，即计划可选)，经生产 `createEngineFetch`(接在 `running.fetch` 上)与 v2 客户端发出。第一轮发「写一份计划」，从模型桩收到的请求里取出计划提醒点名的目录，断言它等于 `<XDG_DATA_HOME>/opencode/plan` 且不含 `.opencode`。第二轮让模型桩照这个目录写 `cf-plan.md`。断言：没有审批请求；盘上文件内容正确；经适配器读回的 v1 消息里，写文件部件的 `state.input.filePath` 正是该路径且状态为完成；生产卡片模型 `toolCardHeadOf` 给出 `{ kind: "write", status: "success", target: "cf-plan.md", detail: "<XDG_DATA_HOME>/opencode/plan/" }`；`~/.opencode` 仍不存在。在真实主目录下，卡片的 `redactPath` 会把 `/Users/<名>` 写成 `~`，显示为 `~/.local/share/opencode/plan/` | M1(换回上游 `plan.ts`)：提醒点名 `<HOME>/.opencode/plan`，模型桩照提醒写过去，被 CF-9 拒绝(F10：沙箱在 W12 之下，只有 CF-9 挡)。新位置没有文件，卡片显示失败 ⇒ 用例红；`plan.test.ts` 三条同时红 |
| BR-07：谁都不建 `.opencode` | `process-fence-plan.test.ts:68` 的精确预建列表，以及 `:86`、`:221`；fresh 臂在完整启动之后(AC-06 ③)与写完计划之后(AC-08)都断言 `~/.opencode` 不存在 | M4 ⇒ 精确列表红 |
| BR-07 / BR-05：`~/.opencode` 或它里面的文件夹当项目 | `process-fence-plan.test.ts` BR-05 用例：真源里的 `~/.opencode` 与 `~/.opencode/proj` 都进 excluded，并点名 `${HOME}/.opencode`。资格判定用的是生产清单给出的根，界面文案沿用既有的 `protected-config` 那一句 | M2(清单去掉 CF-9)⇒ 两条都进了 workspaces，用例红 |
| 接管登记 | `bash scripts/north-star-guard.sh`：加清单之前点名两个文件，加两条之后零命中；`authority-registry.test.ts` 绿；`bun-test-floor.sh 12 packages/core test/plugin/plan.test.ts` 精确 12 条 | 清单少一条 ⇒ 守卫点名那个文件；登记册的用例名写错 ⇒ 判官红；证明文件不在闸门登记簿里 ⇒ `assert-authority-proofs.sh` 红 |
| 删 W16(放行块如实反映可写范围) | `process-fence-profile.test.ts` 的形状与 id 集合；`custom-provider-truth.test.ts` 的固定 id；`process-fence-write-sites.test.ts` 把 W16 判为非法 | M3 ⇒ 三者都红。在围栏实验里 CF-9 写在 W16 之后，补回 W16 不改变拒绝结果；删这一行是为了让放行块如实，理由同片 ② 删 W2 / W6 |
| 夹具对得上引擎源码 | `fixture-identity.test.ts` 与检查组 E | C2 之后、C3 之前按构造必红(core 的 tree id 变了) |

### 体量与时间

- 文件：生产 3 个；接管登记与文档 5 个(守卫、ADR-047、登记册、`gate-files.tsv`、事实文档)；测试 7 个加 1 个 C 程序；plan.md；17 个重采夹具加旧名例外一行。人工改动大约 20 个文件。
- 行数：生产约 +8 / −4；登记与文档约 +60；测试约 +260 / −15(写入矩阵两条用例约 110，C 程序约 35，真引擎用例约 90，其余是一两行的同步)；本节约 130。
- 时间：C1 约 1.5 小时(含两个宿主的红运行)；C2 约 1 小时；C3 约 45 分钟；变异约 1 小时(含一次真引擎宿主)；收口约 1 小时，另加签名形态宿主约 12 分钟。合计约 5–6 小时，符合 M。

### 观察(不属本片,不改代码)

- `packages/ui-mac/src/main/ext-config.ts:121-139`、`:436`:运维逃生阀 `CODEPUPPY_JSONC_TRUTH_DISABLE=1` 置位时,主进程把安装物写进 `~/.opencode/opencode.jsonc`,并递归建出 `~/.opencode`。BR-07 的字面是「任何进程，包括应用自己，都不在任何层级创建 `.opencode`」;设计 CF-9 一行只点名已退役的旧桥(`bridgeItem` 在源码里没有调用方)。编排器裁决:本片不改代码,由编排器记进设计留档与意图待决项。本片另核一件事并回报:CF-9 在场且置了这个开关时,主进程那次写入是否照常成功(主进程在围栏外),围栏内是否因此有原来能用、现在失败的东西(结果写在偏离记录)。

### 偏离记录

证据目录:`~/.cache/alpha-orch/2026-11-19/impl-fence-slice4/evidence/`(下称 `EV/`)与 `…/mutations/`(下称 `MU/`)。

- 2026-11-20 · 红 `f304e031c0`(`EV/c1-red-*.log`):core `plan.test.ts` 3 红 9 绿;ui-mac 单元 15 红;写入矩阵 AC-08 两条红(受保护集里没有 `~/.opencode`;已知坏的变换找不到 CF-9 那一行);真引擎 fresh 臂 AC-08 红,计划提醒点名 `<沙箱 HOME>/.opencode/plan`;北极星守卫点名 `plan.test.ts`。真引擎的红是直接跑 cases(`-t "fresh machine"`)得到的,不经宿主;这样跑会多一条「(unnamed)」失败:测试隔离预载的临时根在围栏里删不掉,因为它是受保护位置的上级目录节点。经宿主跑没有这一条(宿主把已隔离的环境传给子进程)。绿 `29471f04af`;夹具 `8edc690501`。
- 2026-11-20 · 计划里的检查组 B 有一条 `server.test.ts` 用例(`OPENCODE_CONFIG_DIR="."`)在新工作树上红,原因是没有构建 `packages/ext/dist`,与片 ② 偏离记录里那条观察相同;`bun run build`(packages/ext,产物被 git 忽略)之后转绿。
- 2026-11-20 · M3(补回 W16)发现提交 `f304e031c0` 里 BR-05 用例的一条断言写宽了:`/…\.opencode(\/proj)?"\)\s+; W1/` 会匹配 W16 行的 `; W16`。改成行尾锚定 `; W1$`(`m` 标志)· 本提交。
- 2026-11-20 · 变异(`MU/`,每次只改一处,用 `git restore` 复原):M1 换回上游 `plan.ts` ⇒ `plan.test.ts` 三条红;真引擎 fresh 臂 AC-08 红(提醒点名 `~/.opencode/plan`)。另做一次 M1 探针(临时把断言改成打印):模型照提醒往 `~/.opencode/plan/cf-plan.md` 写,写文件卡片是失败态,原文 `Unable to write …/.opencode/plan/cf-plan.md` 加「The system refused this write (operation not permitted)」;新位置没有文件;`~/.opencode` 仍不存在,尽管沙箱在 W12 之下,挡住它的只有 CF-9。设计 P-13 原来是由代码推出、未在真引擎上跑的一句,至此实测成立(`MU/M1-probe-fresh.log`)。M2 清单去掉 CF-9 ⇒ 计划器 5 条红(含 BR-05 资格判定)、profile 7 条红,写入矩阵 AC-08 两条红,红在结构断言上;CF-9 那一行在行为上承重,由已知坏臂「只去掉 CF-9 + 运行期放行 ⇒ 写入落地」证明。M3 补回 W16 ⇒ profile 形状与 id、往返两条、custom-provider-truth、write-sites 共 6 条红,写入矩阵 AC-08 production 红在「放行块里没有 `~/.opencode`」那条断言上;围栏行为不变,因为 CF-9 写在后面。M4 去掉预建跳过 ⇒ 计划器两条红(精确预建列表、`:221`),真引擎 fresh 臂两条都红(完整启动之后、写完计划之后 `~/.opencode` 都存在了)。
- 2026-11-20 · 夹具重采(`8edc690501`,`EV/c3-fixture-diff.txt`,比对脚本 `EV/c3-fixture-diff.py`):因本片改变的只有 catalog、passthrough、routes 里计划助手的放行路径各一处。其余差异逐类写在提交说明里。与片 ① 的一点不同:`events.json` 115 帧的类型集合相同,但三个 Location 并发重载的广播(帧 76–92)交错顺序不同;回放它的适配器测试照绿。
- 2026-11-20 · 编排器要求核的一件事(`CODEPUPPY_JSONC_TRUTH_DISABLE=1`,`MU/truth-disable-probe.log`;探针在 worktree 的 `node_modules/.cache` 下用假 HOME,不提交):主进程的安装物写入 `mcpPluginTargetPath()` → `~/.opencode/opencode.jsonc` 照常成功,并建出 `~/.opencode`(主进程不在围栏里,CF-9 只在 sidecar 的 profile 里)。之后用同一台假机器的生产计划围栏子进程核对:读这份文件照常;追加它、在 `~/.opencode` 里新建文件都是 EPERM,这正是 CF-9 要的拒绝。围栏内没有原来能用、现在失败的东西:写盘登记簿里没有任何 sidecar 写者落在 W16 / `~/.opencode`;引擎里唯一建 `.opencode` 的是 `plan.ts`,已移走;引擎读插件目录只 stat,不写(`config/plugin/source.ts`);主进程之后的写入(安装、停用)仍在主进程。探针中途发现一件事:这个运行时里改 `process.env.HOME` 不会让 `os.homedir()` 跟着变,第一次尝试解析到了真实主目录,断言在写入之前停下,真实主目录没有被碰(事后核对 `~/.opencode` 仍不存在)。第二次改用桥的测试覆盖变量 `CODEPUPPY_OPENCODE_HOME` 指向假主目录。


### 可选(不做)

- 给计划目录另写一个 Code Puppy 自有的 core 判官。现在上游测试接管后只改了一行，加上真引擎用例已经够用。
- 加一条单元断言：真实主目录下卡片显示 `~/.local/share/opencode/plan/`。这是卡片既有的脱敏行为，不是本片的改动。
