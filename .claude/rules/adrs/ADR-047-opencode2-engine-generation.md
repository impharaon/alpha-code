---
id: ADR-047
title: Code Puppy 引擎整体切到 OpenCode 2 —— 单一代次;树按上游重建、历史照常合并;主权层改挂 OpenCode 2 插件钩子;取代 ADR-036
status: proposed
date: 2026-11-08
supersedes: ADR-036
related: [ADR-005, ADR-015, ADR-029, ADR-033, ADR-034, ADR-037, ADR-041, ADR-043, ADR-044, ADR-046]
issue: https://github.com/impharaon/alpha-code/issues/1662
---

> 草案。依据与全部实测见方案基线
> [`docs/design/2026-11-08-1662-opencode2-generation-switch-baseline.md`](../../../docs/design/2026-11-08-1662-opencode2-generation-switch-baseline.md)
> 与能力清点表
> [`docs/design/2026-11-08-1662-opencode2-capability-inventory.md`](../../../docs/design/2026-11-08-1662-opencode2-capability-inventory.md)。
> 本 ADR 是 [[ADR-037]] 决策 2 第 3 条要求的「独立决策」;形状(独立票、独立 PR、能力清点、端到端判据、禁止半代次)仍归 ADR-037。

## 背景

上游 2026-10-09 在 `055d95bb` 切出 1.x 维护线,`dev` 从此是 OpenCode 2;`origin/alpha` 正停在这个公共点(1.18.35)。
OpenCode 2 删除了 Code Puppy 今天运行的整个 v1 引擎包(`packages/opencode`),HTTP 接口全部换成 `/api/*`,插件 API 换成按 domain
提供钩子与变换的一套。每日同步自 2026-10-11 起连续失败(`#1408`),根因即此。owner 2026-11-08:「我希望可以升级到 opencode 2 最新版本。」

[[ADR-036]] 把会话发送留在 v1,并给「迁到 v2」定了三条准入判据。在 OpenCode 2(`33f94fce96`)上三条都成立:
① MCP 运行时在 `packages/core/src/mcp/`(依赖 `@modelcontextprotocol/*` 2.3.1);② 钩子挂载点有 `tool.hook["execute.before"/"execute.after"]`
与 `session.hook.context`(含 `system`);③ 配置的 content 通道支持 `{file:}` 替换。且 2.x 里已没有 v1 可留,ADR-036 的前提不复存在。

## 权威划分

换代改的是引擎,不改谁说了算。三层,每一项只有一个权威(仓内约束 K2):

### 第 1 层 —— Code Puppy 权威:换代后仍是 Code Puppy 的,只允许换接法,不允许交回上游

**界面。** 全部用户可见界面只用 Code Puppy 的:`frontend/` 的 pin(`e11dbd02`)+ SOT 补丁(落点 `packages/codepuppy-{app,ui}`,决策 1)、
`packages/codepuppy-session-ui`、`packages/ui-mac/src/renderer/**`。OpenCode 2 的前端与桌面界面(上游 `packages/{app,ui,session-ui,desktop,gui-plugins}`)
留在树里、逐字等于上游,Code Puppy 不 import、不打包。品牌与文案同属此项。

**产品决定,与 Code Puppy 已从上游拿回的权威。** 下表按「它握住的决定」归组;每组列出今天握住它的接管路径(`scripts/north-star-guard.sh --print-takeover`
的 49 条,逐条见[清点表 §9](../../../docs/design/2026-11-08-1662-opencode2-capability-inventory.md))、ADR 与 ext / 主进程里的落点。
接管路径归到哪一组是按路径名与清点表各行读出来的,逐条核对由各 lane 的权威保持表给证据(本表最后一列)。

| 权威(Code Puppy 决定什么) | 今天握住它的地方 | 2.x 上换成什么接法(只换接法) | 证据落点 |
| --- | --- | --- | --- |
| 工具能不能执行、要不要审批(执行闸,未知身份默认拒) | ADR-033、ADR-038;接管 `packages/opencode/src/{permission/index,session/tools,tool/registry}.ts`、`packages/core/src/tool/{application-tools,registry}.ts`、`packages/core/src/{permission.ts,permission/}`、`packages/protocol/src/groups/permission.ts`、`packages/server/src/handlers/permission.ts`、`packages/schema/src/{permission,agent}.ts` 与对应测试;清点表 K2、K3、K8 | `tool.hook["execute.before"]` 唯一咽喉(决策 4) | 本 ADR「精确接管面」(L4) |
| 模型看得到哪些工具(目录闸,含 Code Mode 目录) | 接管 `packages/opencode/src/tool/code-mode.ts`、`tool/registry.ts`;清点表 K1、K7 | `session.hook.context` 工具表 + `tool.transform` + Code Mode snapshot(决策 4) | 「精确接管面」(L4) |
| 运行权限档位与档位载体名单(约束 K1) | `packages/ui-mac/src/main/codepuppy-builtin-policy.ts`、`codepuppy-config-injection.ts`;工具策略族(清点表 K4) | 注入配置的 `permissions` + ext 读 `tool-policy-default`(接口 I9) | 「精确接管面」(L4);L5 注入测试 |
| 工具身份与显示快照(谁的工具、显示成什么) | ADR-041;接管 `packages/opencode/src/session/tool-display.ts`(alpha 文件)、`packages/schema/src/v1/session.ts`;清点表 K5、K6 | `state.metadata.codepuppyDisplay`(I7b);UI 同时认新旧工具名 | 「精确接管面」(L4);L6 时间线测试 |
| 审批记录与准入(两条 alpha 迁移、`permission_decision`/`permission_request`) | 接管 `packages/core/src/database/{migration.gen,schema.gen}.ts`、`packages/core/schema.json`、`database-migration.test.ts`;清点表 D2、D3 | DB 安全带把两条退役 id 单列(决策 5) | L2 已落(R18、R19、N2) |
| 注入给模型的内容(系统提示品牌改写 ADR-015、上下文注入登记簿、委派判定) | 接管 `packages/opencode/src/session/{llm,llm/request,processor,prompt}.ts`;ext `plugin.ts:116-299`(P2–P5);`packages/ext/src/context-injection-inventory.snapshot.txt` | `session.hook.{prompt,context,"model.request"}`(L1r 切法) | L3 的权威保持表 |
| 模型请求走哪条腿、带哪张凭证(平台网关 / BYOK、输出封顶、平台凭证头) | ext `platform-credential-header.ts`、`platform-output-cap.ts`、`byok-output-cap.ts`(P5、P6);主进程模型投影(清点表 C5–C8) | `session.hook["model.request"]` + 注入 `providers` | L3、L5 的权威保持表 |
| 账户、计费、额度、云能力准入(云 MCP、云 websearch、云 Office) | ADR-035;接管 `packages/opencode/src/tool/{websearch,mcp-websearch}.ts`、`packages/core/src/tool/websearch.ts`;ext `cloud-websearch-kill.ts`;清点表 M3、L5r | ext 的 `websearch.transform` / `execute.before`(L5r 切法);注入的 MCP 定义 | L3 的权威保持表 |
| MCP 目录、第一方连接器、Office 命令模板 | 接管 `packages/opencode/src/mcp/index.ts`(ADR-041);alpha 文件 `codepuppy-first-party-mcp.ts` 等;清点表 M1、M2、M6 | `mcp.transform` + 注入定义 | 「精确接管面」(L4);L5 |
| 定制中心与扩展目录、第三方插件同意后才装载、外部技能默认拒 | 接管 `packages/opencode/src/plugin/index.ts`;ext 扇出 `plugin-fanout.ts`、`hub-tools.ts`(P8、P10);清点表 C9、C10 | 注入 `plugins` 的移除指令(决策 4)+ ext 扇出 + `permission.hook.evaluate`(I10) | L3、L5 的权威保持表 |
| 工具策略 API(`/api/permission/tool-policy/*`) | 接管 `packages/opencode/src/server/routes/instance/httpapi/public.ts`;生成类型 `packages/{client/src/generated*,sdk/js/src/**/gen}` 6 条 | 插件 RPC `TOOL_POLICY_RPC`(I5) | 「精确接管面」(L4) |
| OAuth 回环页品牌 | ADR-042;接管 `packages/core/src/oauth/page.ts` 与测试 | 仍在原文件(15 条「还在」之一),L4 重判 | 「精确接管面」(L4) |
| 数据目录与凭证归属(不导入非 Code Puppy 凭证、库前进前备份) | 主进程 `db-safety.ts`、`data-clear-boot.ts`;S2、S7 | 首启前处置 `auth.json`(决策 4)、DB 安全带(决策 5) | L2、L5 |
| 进程围栏、出网围栏、引擎宿主与渠道 | 主进程 `sidecar.ts`、REQ-159 围栏;清点表 H1–H9 | 嵌入式宿主(决策 3) | L5 |
| 哪些上游文件算 alpha 自有、接管怎么登记 | ADR-043、ADR-044;`scripts/north-star-guard.sh` | 守卫以上游父为基准(决策 2) | L2 已落 |

接管路径里 `packages/schema/test/contract-hygiene.test.ts`、`packages/core/test/{oauth-page,permission}.test.ts` 随所守的源文件归组。
**L3、L5 的权威保持表落在哪里,由编排器在其派发书里指定**;本表的「证据落点」一列在那之前只写 lane。

### 第 2 层 —— OpenCode 权威:Code Puppy 消费它的决定,不手写替身

引擎内部:会话运行与执行认领、模型请求组装之外的协议细节(`@opencode/ai`)、工具执行机制、MCP 运行时、存储与迁移执行器、
v1 旧对话转换、插件接口与钩子顺序、事件溯源模型。Code Puppy 经插件钩子、注入配置与 `/api/*` 消费这些决定(裁决书 ARCH-NOTE 3);
界面需要的 v1 形状由 Code Puppy 的引擎适配器从 2.x 的结果投影出来(决策 1),投影不重新判定任何事。

### 第 3 层 —— OpenCode 2 新增能力:默认由 OpenCode 持有,Code Puppy 不建接缝、直接享用

**本次换代不接线**([[ADR-037]] 决策 2:换代 PR 不夹带功能);换代后逐项另立票,由 owner 选。只在新能力碰到第 1 层权威的交界处做最小的事,
而且不是拿权威。标注:**无需动** / **需显示**(要给用户看,由 Code Puppy 界面显示)/ **需登记**(新工具要进 ADR-041 身份账本,否则被执行闸默认拒)/
**需经平台**(花钱或用凭证,必须经 Code Puppy 平台网关与账户)/ **实验开关**(正式渠道默认关,Code Puppy 注入固定为关只为防用户配置绕过;开哪项是 owner 的产品决定)。
坐标读自 `/Users/tide/app/wt/opencode2-ref` 上的 `33f94fce96`(下写 `v2:`)。

| 能力 | 引擎里是什么 | 本次处置 | 标注 | 将来经 Code Puppy 接线的面 |
| --- | --- | --- | --- | --- |
| 图像生成 API 与 `image-generate` 工具 | `v2:packages/protocol/src/groups/generate.ts:59`(`/api/experimental/generate/image`);工具 `v2:packages/core/src/tool/plugin/image-generate.ts:76`,有 image 型模型可用时挂上(`:95`) | 接受进引擎;注入的模型目录不含 image 型模型时工具不出现,出现了也因身份未登记被执行闸拒 | 需经平台、需登记、需显示 | 平台网关计费 → 主进程模型投影(C7)放出 image 型模型 → 账本登记 → 时间线显示生成结果 |
| 决策生成与文本生成 API | `generate.ts:73`(`/api/experimental/generate/decisions`);插件 `v2:packages/plugin/src/effect/plugin.ts:39`(`experimental.generate`) | 接受;Code Puppy 不调用 | 需经平台 | 平台网关 + ext 经插件 API 调用 |
| 会话键控指令(`ctx.session.instructions.entry.*`) | `v2:packages/plugin/src/effect/session.ts:29,219`;事件 `v2:packages/schema/src/session-event.ts:267` | 接受;ext 本次不改用 | 无需动 | 将来 ext 可把上下文注入改走它(少打 prompt cache),属第 1 层「注入给模型的内容」换接法 |
| 按 provider / model 的 prompt cache TTL | `v2:packages/ai/src/cache-policy.ts:40,57`;配置位 `v2:packages/schema/src/model.ts:59` | 接受;注入配置不设值,行为同上游默认 | 无需动 | 要设值 → 主进程模型投影(C7)写,影响缓存写入计费时同时经平台定价 |
| Todo 工具 | `v2:packages/core/src/tool/plugin/todo.ts:45,52` | 正式渠道默认关,注入固定为关(OOR-1) | 实验开关(开则需显示) | L6 方案 §8 U1:开 ⇒ 适配器投影 `todo.updated`,任务清单卡照旧 |
| schedules | `v2:packages/core/src/schedule.ts:226`、`tool/plugin/schedule.ts:57`;路由 `v2:packages/protocol/src/groups/schedule.ts:26` | 同上 | 实验开关(开则需登记、需显示) | Code Puppy 自动化面(今天是 Code Puppy 自己的云端自动化,另一回事) |
| media_blob | `v2:packages/core/src/session/blob.ts:266` | 同上 | 实验开关 | 存储格式,无界面;开前过 DB 安全带的备份判据 |
| artifacts | `v2:packages/core/src/artifact.ts:271`;路由 `v2:packages/protocol/src/groups/artifact.ts:56` | 同上 | 实验开关(开则需登记、需显示) | 会话右栏产物面板 |
| background_compaction | `v2:packages/core/src/config/plugin/compaction.ts:18` | 同上 | 实验开关(开则花 token,经平台计费) | 无界面 |
| 桌面(GUI)插件 | `v2:packages/protocol/src/groups/plugin.ts:24`(`/api/plugin/gui`);入口 `v2:packages/core/src/plugin/module.ts:122,136`;上游承载界面在 `packages/gui-plugins` | 不涉及:Code Puppy 界面不加载 GUI 插件包 | 无需动 | 要用 → Code Puppy 界面自建承载(第 1 层「界面」),插件经 ext 同意后装载 |
| 持久输入队列(session inbox) | `v2:packages/protocol/src/groups/session.ts:540`;事件 `session.inbox.*` | 接受;界面走 v1 数据路径,不显示排队 | 无需动 | 要显示 → 引擎适配器投影 + 输入框 |
| 新内置工具:`list_mcp_resources` / `read_mcp_resource`、会话改名/移动、`skill`、表单式提问 | `v2:packages/core/src/tool/plugin/mcp-resource.ts:11,19,49`、`opencode.ts:17-25`、`skill.ts`、`question.ts` | 接受;身份未登记的被执行闸拒 | 需登记(提问卡需显示,L6 已接) | ADR-041 账本逐个登记(L4) |
| 语音 | `v2:packages/protocol/src/groups/voice.ts:68` | 接受;不调用 | 需经平台 | 平台网关 + 界面 |
| OpenCode Console 用量上限 / 工作区配置层 | `v2:packages/protocol/src/groups/usage.ts:10`;`v2:packages/core/src/config/integration.ts:41` | 不涉及:不连 Console(首启处置 `auth.json`,决策 4) | 无需动 | 无(Code Puppy 计费以平台网关为准) |
| 持久 PTY、会话导出/导入/统计、fs 监视与写入、任务列表、会话环境 | `persistent-pty.ts:55`、`session.ts:146,188,206,796`、`fs.ts:83`、`job.ts:32`(均在 `v2:packages/protocol/src/groups/`) | 接受;界面不调用 | 无需动 | 按需另立票 |
| 配对(`/api/pair`) | `v2:packages/protocol/src/groups/server.ts:56` | 接受;界面不调用 | 无需动(L5 核它不绕过口令) | 无 |
| 插件 RPC | `v2:packages/protocol/src/groups/rpc.ts:14` | 已用作工具策略 API 的接法(I5) | 无需动 | — |
| 引擎记录的会话成本 | `session.usage.recorded`(`v2:packages/schema/src/session-event.ts`) | 接受;只作参考 | 无需动 | 计费以平台网关为准 |

## 决策 1 —— 全部链路一次切到 OpenCode 2,不留任何 v1 链路;界面不换代

会话发送、事件流、审批、配置、模型目录、MCP、工具执行、持久化,全部到达 OpenCode 2 的接口面;同一条用户流程的所有入口处在同一代次
([[ADR-037]] 决策 5)。为 v2 读侧另写一份配置的桥(`codepuppy-config-injection.ts` 的 `OPENCODE_CONFIG_DIR` 剥 key 段)随之删除。

**界面是 Code Puppy 权威,不随引擎换代**(owner 2026-11-09「界面当前的 alpha 才是唯一权威」「前端界面必须使用的是 codepuppy 的不应该使用opencode」):
换代后用户看到的界面与 0.1.26 一致,唯一例外是拿掉「分享对话」(R6)。前端 pin 留在 `e11dbd02`、SOT 补丁取 `origin/alpha`;
冻结界面的落点从 `packages/{app,ui}` 改到 Code Puppy 自有的 `packages/codepuppy-{app,ui}`(包名仍为 `@opencode-ai/{app,ui}`),
另把 0.1.26 用到的 `session-ui`、v1 SDK、五个 core 工具文件冻结在 `packages/codepuppy-{session-ui,sdk-v1,core-util}` ——
原位放回会让 2.x 工作区装不上(L6 方案 §1.3 实测)。上游 2.x 的 `packages/{app,ui,session-ui}` 逐字等于上游,north-star 守卫的 carve-out ② 撤掉,
每日同步不再还原前端;[[ADR-034]] 的月更前提(跟随上游前端)随之停用,pin + 补丁只作为冻结界面的出处与判据。

界面连 2.x 的唯一通路是 renderer 里 Code Puppy 自有的引擎适配器:冻结界面照旧走它在 0.1.26 里实际跑的 v1 数据路径,适配器按一张路由表把
v1 请求与 v1 事件流翻成 2.x `/api/*`(经 `@opencode/client`),表外请求响亮失败。这不是半代次 —— 引擎只有一代,适配器只是界面数据层的一部分。
做法、依赖清单与退出条件见 [L6 实施方案](../../../docs/design/2026-11-09-1668-l6-ui-stays-alpha.md)。

- 被否决:前端与引擎同一 SHA(本 ADR 草案原文;上游 2.x 界面不进,owner 裁);renderer 改用 `@opencode/client/solid` 重写数据层(组件跟着改);
  让冻结 app 跑它自带的 v2 支路(0.1.26 从没跑过,组件读另一套 store)。

## 决策 2 —— 集成形状:树按上游重建,历史照常合并

一次受审上游集成,落在一个真合并提交上,第二父是选定的上游 dev SHA(ci.md §4 第 3 条)。合并提交的树按规则构造:上游路径取上游原样
(上游删除的就删除),Code Puppy 自有路径取 alpha;此后在同一整合分支上把主权层改挂到 OpenCode 2 的接缝上。lane 不在 GitHub 上开 PR,
由编排器在本机整合,整合分支只推非分支引用 `refs/backup/1662/engine` 做备份(不触发 workflow);落地是**一个**进 `alpha` 的最终 PR,
`gh pr merge --merge` 合入 —— `alpha` 的 first-parent 上只多一个合并提交,撤回时 `revert -m 1` 有对象(裁决书 R16、N5)。

- 合并目标取最新发布标签在 dev 线上的父提交(今天是 v2.2.6 → `33f94fce96`),不取 dev 头,也不取标签本身。
- 上游祖先不得丢:合并提交在本机整合分支上直接提交;整合分支吸收 `alpha` 只用 merge,禁止 squash / rebase;
  `git merge-base --is-ancestor <上游 SHA> HEAD` 在每次推送与最终合并前为真,且有「squash 重放后必须红」的反向用例。
- 含受审上游合并的分支上,north-star 守卫的 `packages/` 辖区以该合并的上游父为基准判(不再以 `origin/alpha` 为基准);lane 推送不靠 `--no-verify`。
- `packages/` 之外逐文件定归属:上游来源的跟上游 SHA 增删,Code Puppy 的跟 alpha。随合并新出现的上游 workflow 先列清单(名称 + 触发器 + 权限);
  推最终 PR 的 head 分支之前逐个判它在 head 推送与 PR 上会不会以写权限触发,有则先处置;合入后立即逐个 `gh workflow disable` 并读回状态。
- 被否决:逐冲突移植(冲突表不是能力清点,且自动合入会静默混入旧改动);重新 fork(断掉 990 个提交的历史与 merge-base);
  先过 1.19.5(它在 1.x 维护线上,对到达 2.x 零推进)。

## 决策 3 —— 引擎宿主:嵌在 Electron `utilityProcess` 里;不用上游的机器级后台服务

在已装进程围栏的 `utilityProcess` 里 import `@opencode/server/process` 并启动(进程围栏、ext 的 `parentPort` 桥、进程内调用形状不变)。
L1a 实测(合成数据,勘破文档 `docs/architecture/2026-11-09-1662-l1-engine-host-spike.md`,提交 `0bfbdfb205`)在 Electron 42 的 Node 24.15 上
满足「能起并完成回复 / 进程内调用与监听共用一张应用图 / 旧对话转换可在 Node 下运行」三条,宿主据此定为嵌入式(裁决书 R13);
「打包上游 bun 编译的 CLI 作为围栏内私有子进程」只在这三条被推翻时才启用。实现必须同时守住:进程内接法取 `start()` + `Transform`,
**`start()` 不传 `lifecycle`**(裁决书 N1:传了会每次启动自动续跑未释放执行认领的会话 —— 平台计费、「全部批准」档下工具照常执行,今天 v1 没有
这条路 —— 且启动失败变成永久挂起;不传即上游 CLI 默认模式、L1a 实测形态),不取 `ServerFetch.make`;`http.setGlobalProxyFromEnv()` 与 `XDG_*`
都在 import 引擎之前定好,否则模型请求绕开出网代理、全局目录按错的根算;传给引擎的渠道是发布渠道,注入配置对五个实验开关显式写值,
继承给引擎的环境去掉 `OPENCODE_FLAGS`(`local`/`dev` 渠道、用户配置的 `experimental.*` / `all_flags`、环境变量 `OPENCODE_FLAGS` 都会打开它们;
裁决书 R13、R17、OOR-1)。**不得**使用上游的 `serve --service` 机器级共享服务:它与用户自装的
OpenCode 共用服务、库与凭证。

嵌入式下上游 CLI 宿主不在路径上,它做的「环境变量 → 选项」映射由 sidecar 自己做:构造 `ServerOptions`(含 `config.directory`、`database.path`,
服务端据 `config.directory` 自己建全局目录层);其中库路径的推导与 Code Puppy 的 DB 安全带共用一个函数,不再造一份上游宿主的决定(裁决书 N4)。

## 决策 4 —— 主权层的挂载与接管

- 按 [[ADR-029]] 阶梯自下而上找挂载点:先 L0(`@codepuppy/ext` 作为 OpenCode 2 插件、配置注入、`policies`),再 L1,最后 L3。
- 旧接管清单不继承。仍存在的 15 条路径逐条重判;随文件消失的 34 条删除。新清单在本 ADR 的「精确接管面」一节逐条写范围、守卫、回滚与归属,
  由实现 lane(基线 L4)在本 ADR 转 accepted 之前填齐。
- **权限咽喉的唯一形状:** 到达工具执行的唯一通路是 `Tool.execute` 的 `execute.before`(`packages/core/src/tool.ts`);Code Puppy 的执行闸挂在
  那里、对未知工具身份默认拒,且在它之后的任何钩子都不能改写已核准的输入或结论(OpenCode 2 的钩子按注册顺序串行执行并共享同一事件对象)。
  目录闸挂在 `session.hook.context` 的工具表与 `tool.transform` 上,并盖住 Code Mode 的目录(MCP 工具默认进 Code Mode):往 Code Mode 的
  snapshot 规则集注入 deny,或对 Code Puppy 管的 MCP server 注入 `codemode: false`,实现二选一。
- 工具改名(`bash`→`shell`、`task`→`subagent`、`apply_patch`→`patch`):策略与 agent 规则一次换成新名;身份账本([[ADR-041]])与 UI
  同时认新旧两个名字 —— 旧对话转换不改历史里的工具名,只追加一条给模型的提示。未知名字的规则加载时响亮报出。
- 外部生态默认拒绝不变:`.claude` 与 `~/.agents`、项目 `.agents` 两类技能只由内置插件 `opencode.config.compatibility` 装载,**唯一机制**是在注入配置的
  `plugins` 里写移除指令 `-opencode.config.compatibility`(L0;逃生开关置位时不注入;不另设 `config.claude = false`,裁决书 N3);
  第三方插件只经 ext 扇出、在同意之后装载。
- 引擎可用的凭证只来自 Code Puppy 的注入;不导入数据目录里不属于 Code Puppy 的凭证文件 —— 做法是首次以 OpenCode 2 启动前处置
  数据目录里的 `auth.json`(导入迁移不看配置,配置拦不住)。

### 精确接管面

(待基线 L4 填写:每行 = 路径 / 为什么挂不了钩子 / 守卫 / 回滚 / 归属。)

## 决策 5 —— 数据

- 第一次以 OpenCode 2 启动前由 DB 安全带做前进迁移备份;构建期迁移清单改由 OpenCode 2 的 `migration.gen.ts` 派生,Code Puppy 两条退役迁移的 id
  单列一个字段,只用来排除出「未知 id」、不计入「待前进」(裁决书 N2)—— 不排除,安全带把老用户的库判为「库比应用新」,每次启动都阻断且前进前不备份;
  若并进待前进,新装的 2.x 库每次启动都整库备份。DB 安全带在干净关闭的 WAL 库上只读打开失败、静默跳过的既有缺陷在本票内修(裁决书 R18)。
  owner 真库的只读副本上已实测:排除两个退役 id 后给出「待前进」21 条、备份成功(裁决书 R19)。
- v1 旧对话在新代次可见、可继续。OpenCode 2 的转换只在 bun 条件下运行、Node 条件下是空实现;嵌入式宿主下由构建期变换接上
  (上游源码逐字不动):`#v1-migration` 改指上游的 bun 实现,两处 bun 专有调用做 Node 薄适配,其中 `Bun.CryptoHasher` 那处必做
  (裁决书 R14;L1a 合成库实测全部转换;owner 真库的只读副本上会话 119 → 119、597 条用户 + 助手消息全部保留,裁决书 R19)。上游原版 Node 构建下旧对话静默全不可见而状态报 `completed`,所以这一步不可省。转换会删 `event` 表的行,并对每个
  被转换的会话先删它在 `session_message` 里已有的行再写入转换结果;旧格式的 `message`/`part` 不删。
- 新增的 Code Puppy 自有表名以 `_` 开头(OpenCode 2 约定嵌入方自有表用该前缀)。

## 缺项(ADR-037 决策 3:缺项必须点名并由 owner 拍板)

| 缺项 | 用户可观测后果 | 状态 |
| --- | --- | --- |
| 「分享对话」:OpenCode 2 没有分享接口,上游 1.x 维护线也已停掉分享 | 侧栏「分享」菜单项无法工作(该功能在 0.1.26 里今天已不可用:`https://opncd.ai`、`/api/share` 均返回 `410`) | owner 已裁决(2026-11-09,原话「路一」,见裁决书 R6):随换代拿掉该菜单项;以后要分享另立需求自建 |
| v1 旧对话转换(仅当决策 5 的补法与改宿主都不通时成立) | 升级后侧栏看不到旧对话(数据仍在库中) | 不触发(裁决书 R14,L1a 合成库实测补法可行);L1b 真库副本若推翻,按基线 §7 O1 重新递 owner |

## 后果

- ➕ 每日同步重新跟随上游主线;上游修复与新能力可经正常同步获得。
- ➕ ADR-036 登记的两项已知缺口随之闭合:审批停靠区只有一条事件通道;v2 的持久输入队列语义回来。
- ➕ 北极星偏离 `packages/plugin/package.json` 的 `./alpha-cloud-authority` 导出可移除(OpenCode 2 的 `@opencode/plugin` 有通配导出)。
- ➖ 主权层(ext、ui-mac 主进程接线、renderer 数据层、前端补丁)整体重写一次;量级见基线 §4.3。
- ➖ 撤回一个带上游祖先的合并,要同时暂停每日同步,重新落地要 revert 那次 revert(基线 §6)。
- ⚠️ Code Puppy 的库与数据目录仍与用户自装的 OpenCode 同路径;本 ADR 只保证不导入不属于 Code Puppy 的凭证;本票不搬目录(编排器已定,裁决书 R5),目录搬迁是一次独立的数据迁移,另行裁决。
- 🔁 [[ADR-036]] 被本 ADR 取代(accepted 时把 ADR-036 的状态改为 superseded)。
