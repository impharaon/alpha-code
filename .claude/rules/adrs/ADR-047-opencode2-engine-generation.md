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

## 决策 1 —— 全部链路一次切到 OpenCode 2,不留任何 v1 链路

会话发送、事件流、审批、配置、模型目录、MCP、工具执行、持久化,全部到达 OpenCode 2 的接口面;同一条用户流程的所有入口处在同一代次
([[ADR-037]] 决策 5)。前端投影 `packages/{app,ui}` 的 pin 在切换时与引擎是同一个 SHA,之后保持同一代次(照 [[ADR-034]] 月更,不冲突)。为 v2 读侧另写一份配置的桥
(`codepuppy-config-injection.ts` 的 `OPENCODE_CONFIG_DIR` 剥 key 段)随之删除。

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

#1662 L4 落定(2026-11-09;编排器裁决 #1666 评论 6737732975)。旧清单 49 条不继承:34 条随文件消失删除;仍存在的 15 条逐条重判。
下表是换代后的全部接管:v1 已接管过的文件,在 2.x 上接管它的对应文件,是同一个权威换个接法。它们承载的决定逐条登记在下方「权威保持表」里,没有一条被静默放弃。

| 路径 | 为什么挂不了钩子 | 守卫 | 回滚 | 归属 |
| --- | --- | --- | --- | --- |
| `packages/core/src/oauth/page.ts`、`packages/core/test/oauth-page.test.ts`(ADR-042) | OAuth 回环成功/失败页由引擎直出,插件 Context 没有改写它的挂点;ADR-007 的 Vite 品牌变换到不了引擎页 | `scripts/north-star-guard.sh` 的 `UPSTREAM_EXCLUDES` 逐文件两条;`packages/core/test/oauth-page.test.ts` 的两条品牌用例对上游原版页会红 | 用 `33f94fce96` 的两个文件覆盖并从清单删掉两条(改动面只有产品名与字标) | L4(#1666);同步时按 `takeover upgrade review required` 人工移植 |
| `packages/core/src/permission.ts`(ADR-038;v1 接管的是 `packages/opencode/src/permission/index.ts`) | 2.x `Permission.assert` 对回复无限期等待;插件只能改判定,改不了等多久;插件侧看门狗回 reject 会级联整个会话(ADR-038 否决过) | `UPSTREAM_EXCLUDES` 一条;改动只在 `codepuppy(ADR-038)` 标注块;`packages/ext/src/policy/ask-deadline.test.ts`(去掉有界等待 ⇒ 前两条红,改成级联 ⇒ 第二条红) | 用 `33f94fce96` 的文件覆盖并删掉清单一条;回到无期限等待 | L4(#1666) |
| `packages/core/src/mcp/{client,connection,index}.ts`(#1563、#1565、#1572、ADR-041;v1 接管的是 `packages/opencode/src/mcp/index.ts`) | MCP 运行时没有插件挂点:启动、重连、并发、连接前的随包声明、失败归因都在 core 内部 | `UPSTREAM_EXCLUDES` 三条;规则本体在 Code Puppy 自有的 `codepuppy-startup.ts`、`codepuppy-first-party-mcp.ts`,三个上游文件只在 `codepuppy(...)` 标注处调用;`packages/core/test/codepuppy-mcp-runtime.test.ts`(去掉重连 / 许可 / 声明 / 重名拒绝 / 具名归因,各自那条转红) | 用 `33f94fce96` 的三个文件覆盖并删掉清单三条;回到上游的无重连、无并发上限、连上才列工具、后写覆盖 | L4(#1666) |
| `packages/core/src/session/to-session-error.ts`、`packages/core/test/session-runner-retry.test.ts`(#1572 settle;v1 接管的是 `packages/opencode/src/session/processor.ts`) | 模型请求的失败在 `toSessionError` 里结算成公开的 `Session.StructuredError`;`session.hook.retry` 的 `error` 是只读的,插件改不了分类 | `UPSTREAM_EXCLUDES` 两条;改动只在 Transport 分支的 `codepuppy(#1572)` 标注块,调 Code Puppy 自有的分类器并把层作为登记码前缀写进 `message`(`packages/schema/src/codepuppy-net-failure.ts`);上游测试只改 `toSessionError` 那条断言的两处期望;`packages/core/test/codepuppy-net-failure-settle.test.ts`(去掉分类调用或前缀 ⇒ 前三条红) | 用 `33f94fce96` 的两个文件覆盖并删掉清单两条;回到上游的无分层文本 | L4(#1666) |
| `packages/core/src/tool/mcp.ts`(ADR-041 决策 2;#1666 裁决 6756103246 第 4 项) | MCP 工具注册进工具注册表时用上游的后写覆盖(`tool.ts` 的 `editor.add`),插件挂点到不了 McpTool 自己的那次注册;MCP 服务器 `opencode` 的工具会撞上 `opencode` 命名空间下的内置工具 | `UPSTREAM_EXCLUDES` 一条;改动只在注册循环的 `codepuppy(ADR-041)` 标注块(有效名已被更早的注册占用 ⇒ 不注册并记错);`packages/core/test/codepuppy-mcp-tool-collision.test.ts`(去掉检查 ⇒ 内置先注册那条红) | 用 `33f94fce96` 的文件覆盖并删掉清单一条;回到后写覆盖 | L4(#1666) |

清单为空时(将来某次重判把这一组也退回 L0),每日同步照常走:同步读守卫自报的 `UPSTREAM_EXCLUDES_COUNT`,条数为 0 即无可核对、继续;
读不出条数才中止(与「守卫没跑出结果」分开,`sync-upstream-takeover-isolation.test.ts` 的 F10 三条)。

#### 权威保持表

今天由 Code Puppy 决定的每一项,换代后仍由 Code Puppy 决定(编排器 2026-11-09 转 owner 原话:「不可以因为 opencode 更新把经 codepuppy 拿回的唯一权威再封掉。」)。
机器可读的唯一真源是 [`docs/architecture/codepuppy-authority-registry.json`](../../../docs/architecture/codepuppy-authority-registry.json),
判官 `packages/ext/src/policy/authority-registry.test.ts`:49 条旧接管每条都要映射到一项决定;已握住的项必须有机制文件与会在拿掉机制时变红的测试;
未握住的项(blocked)让判官红,直到编排器裁决;删掉任何一项而没有带 owner 原话与日期的 `retired` 记录同样红。下表是登记册的摘要,以登记册为准。

已握住 34 项:

| 登记 id | 决定 | 2.x 上的握法(阶梯) | 证明它的测试 |
| --- | --- | --- | --- |
| `tool-policy-execution-gate` | Every tool call passes Code Puppy's tool policy before it runs; a deny is a named refusal decided before any other hook or side effect (#725 B, #1129). | `packages/ext/src/policy/gate.ts`(L0 (execute.before via registerPolicy)) | `register-policy.test.ts`「B1 MCP deny ⇒ named refusal and the call never reaches the tool」; `register-policy.test.ts`「deny is decided first: the extension's own execute.before never sees a denied call」 等 |
| `tool-policy-unknown-identity` | A call whose tool identity cannot be established is refused (baseline S1: unknown identity defaults to deny). | `packages/ext/src/policy/gate.ts`(L0) | `register-policy.test.ts`「unknown tool identity is refused by default」 |
| `tool-policy-approved-input-pinned` | Hooks running after Code Puppy's approval cannot rewrite the approved tool or input (baseline S1, ruling R8 option 2). | `packages/ext/src/policy/gate.ts`(L0 (seal tail + pin)) | `register-policy.test.ts`「reverse arm ②: a plugin after seal() that rewrites the input cannot run the call」; `register-policy.test.ts`「reverse arm ② control: the same late plugin leaving input alone lets the call run」 等 |
| `tool-policy-catalog-gate` | The model never sees a tool the policy denies, neither as a direct tool nor in the Code Mode catalog (#725 A, ruling F6). | `packages/ext/src/policy/catalog.ts`(L0 (agent rules after configured ones + session.hook.context)) | `register-policy.test.ts`「A4 + F6: one MCP tool denied ⇒ gone from the Code Mode catalog too; its sibling stays」; `register-policy.test.ts`「F6 reverse arm: without Code Puppy's catalog rules the denied MCP tool is back in Code Mode」 等 |
| `tool-policy-three-state-ask` | A document-axis ask waits for the user through OpenCode's permission engine with Code Puppy's identity envelope; nothing runs before approval; once/always keep their meaning; no other plugin's evaluate hook can turn Code Puppy's ask into allow. | `packages/ext/src/policy/catalog.ts`(L0 (tail ask rule; gate.ts holdAsk from the early evaluate hook)) | `register-policy.test.ts`「document-axis ask ⇒ one identity request with the I7a envelope; reject keeps the count at 0」; `register-policy.test.ts`「approved once ⇒ the call runs exactly once」 等 |
| `tool-policy-session-grants` | An always approval is bound to the service binding and the policy revision; any policy write asks again (#1128, #1574). | `packages/ext/src/policy/gate.ts`(L0) | `register-policy.test.ts`「an always approval discharges the next ask for the same binding and revision; a policy write re-asks」 |
| `tool-policy-deny-ceiling` | Deny is a ceiling: a ruleset deny on the exact identity folds into the cap, and no user enable or saved approval opens it (#1128 / #724 §4). | `packages/ext/src/policy/gate.ts`(L0) | `register-policy.test.ts`「ruleset-axis identity deny (agent rule on the canonical) hides the tool the same way」; `resolver.test.ts`「R8/R9/R10/R11 fail-closed 族:非法 identity / quarantine / managed unreadable / 冲突记录 ⇒ disabled」 |
| `tool-policy-managed-cap` | Organisation (managed / MDM) denies are an unbreakable cap — a project agent rule cannot out-rank them. | `packages/ext/src/policy/managed.ts`(L0 (reads OpenCode 2 managed documents itself)) | `resolver.test.ts`「M1 a managed deny is a cap even when the merged agent ruleset ends with a project allow (why the reader exists)」; `resolver.test.ts`「M4 a corrupt managed file, or a JSONC one this reader cannot parse, makes the whole layer unreadable ⇒ disabled」 |
| `tool-policy-document` | The user policy document: three states, exact tool > service > class, binding guard, whole-document quarantine on any bad record (#1128 / #724 §2–§5). | `packages/ext/src/policy/resolver.ts`(L0) | `resolver.test.ts`「R6 binding guard:service/tool enabled 只在 digest 逐字相等时生效,变了/缺了回 ask(§5)」; `resolver.test.ts`「T3 坏文档整份 quarantine:损坏 JSON / 未知版本 / 部分非法记录 / 分区不符 / selector 重复」 |
| `tool-policy-partitions` | Policy is partitioned per signed-in account and per folder (outside git) / per project (inside git) (#1575, #1644). | `packages/ext/src/policy/index.ts`(L0) | `resolver.test.ts`「AC2 subdirectories of one git project share its grant; different git projects stay isolated」; `resolver.test.ts`「VI1 the account partition follows CODEPUPPY_POLICY_ACCOUNT: account B never reads account A's enable」 |
| `tool-policy-tier-default` | The composer tier's tool-policy-default decides whether class-default asks apply (I9, #1638). | `packages/ext/src/policy/catalog.ts`(L0) | `register-policy.test.ts`「I9: tool-policy-default allow waives the class-default ask; ask keeps it」 |
| `tool-policy-settings-api` | Settings reads and writes the tool policy through Code Puppy's API (v1 routes /api/permission/tool-policy/*; OpenCode 2 plugin RPC codepuppy.tool-policy, I5). | `packages/ext/src/policy/rpc.ts`(L0 (plugin RPC)) | `tool-policy-rpc.test.ts`「inventory returns a document that decodes as ToolPolicyInventoryV1」; `inventory.test.ts`「I2 the badge tells the truth: a tool the inventory shows disabled is refused by the production executor」 等 |
| `tool-renames` | Renamed builtins (bash→shell, task→subagent, apply_patch→patch): saved records under the old name keep applying and are reported; classification knows both names (K5 / S4). | `packages/ext/src/policy/resolver.ts`(L0) | `register-policy.test.ts`「a saved deny under the v1 name refuses the renamed tool, and the record is reported」; `register-policy.test.ts`「a deny under the new name refuses the call」 |
| `risk-classification` | Every approval request carries Code Puppy's rule-based risk classification, overriding what a tool reports (#1285 / REQ-158). | `packages/ext/src/policy/risk.ts`(L0 (permission.hook.evaluate)) | `risk.test.ts`「a forged metadata.codepuppyRisk is overwritten: shell `rm -rf /` claims low, the pending request says high/destructive」; `risk.test.ts`「the premise check is not empty: a synthetic engine that creates a request without evaluating fails it」 等 |
| `adr041-identity-derivation` | Each tool's identity (source, origin, name) is decided by Code Puppy from registration facts, never from aliases or titles. | `packages/ext/src/policy/identity.ts`(L0 (early registry + MCP config + bundled manifest)) | `identity.test.ts`「an MCP tool: config key as origin, remote tool name, de-secreted binding, remote location and transport」; `identity.test.ts`「a tool in the early registry is a builtin with the constant application binding and local location」 等 |
| `adr041-authority-minting` | Only Code Puppy mints codepuppy-cloud / codepuppy-bundled authority, and only from the verified definition or the bundled manifest (ADR-041 §5, #1578). | `packages/ext/src/policy/identity.ts`(L0) | `identity.test.ts`「the exact verified cloud definition mints codepuppy-cloud with a sha256 evidence digest」; `identity.test.ts`「a look-alike (same URL, other key; or same key, other URL) is not asserted」 等 |
| `adr041-display-snapshot` | Each tool call carries Code Puppy's immutable display snapshot (identity, technicalId, authority, location) — OpenCode 2 state.metadata.codepuppyDisplay (I7b). | `packages/ext/src/policy/display.ts`(L0 (tool.transform progress + execute.after + deny metadata)) | `register-policy.test.ts`「running (progress) and completed (result metadata) carry the snapshot」; `register-policy.test.ts`「a refused call's error carries the snapshot」 等 |
| `adr041-location` | Where a tool runs (local, or the remote MCP host) is decided by Code Puppy from the de-secreted effective definition (#1576, #1617). | `packages/ext/src/policy/identity.ts`(L0) | `identity.test.ts`「a local MCP tool: local location, command transport, binding over command + cwd」; `register-policy.test.ts`「document-axis ask ⇒ one identity request with the I7a envelope; reject keeps the count at 0」 |
| `contract-authority-names` | Authority and class values are codepuppy-* only, and the schema is their single definition (#1568 AC3). | `packages/schema/src/tool-identity.ts`(Code Puppy-owned file (ADR-043)) | `codepuppy-authority-names.test.ts`「OpenCode 2's generated client types carry no copy of ToolAuthority (the schema is the only one)」 |
| `mcp-workspace-argv` | A {workspace} token in an MCP command is replaced with the current folder when the server starts (#1011 / REQ-134). | `packages/ext/src/policy/index.ts`(L0 (mcp.transform)) | `register-policy.test.ts`「{workspace} in a local MCP command becomes the Location directory (#1011); without the policy it stays literal」 |
| `mcp-branched-schema` | MCP tools whose input schema branches at the root stay usable by the model (#793). | `packages/core/src/tool/runtime.ts`(upstream-native (OpenCode 2 passes JSON schemas through), pinned) | `upstream-pins.test.ts`「a root-branched schema reaches the model unchanged and forbids none of its branch fields」; `upstream-pins.test.ts`「the check is not empty: the v1-style closed root names every branch field it forbade」 |
| `mcp-tool-list-tolerance` | One malformed MCP tool does not drop the server's other tools (codepuppy-tool-discovery.ts tolerant listing). | `packages/core/src/mcp/client.ts`(upstream-native, pinned by upstream's own test) | `mcp.test.ts`「skips unusable tools and keeps the rest of the server's tools」 |
| `adr042-oauth-brand` | OAuth loopback success/error pages show the Code Puppy product identity (#1047). | `packages/core/src/oauth/page.ts`(L3 (re-taken: no plugin seam reaches engine-served callback HTML)) | `oauth-page.test.ts`「#1047: success page uses the Code Puppy product identity, not OpenCode」; `oauth-page.test.ts`「#1047: error page uses the Code Puppy product identity」 |
| `adr043-owned-file-predicate` | Code Puppy-owned files living under upstream paths are recognised by name or marker, and a copied marker does not exempt an upstream file (ADR-043). | `scripts/north-star-guard.sh`(guard predicate (L2)) | `north-star-guard.test.ts`「名字不合约定、靠文件里的 marker 自报家门 ⇒ 绿(migration / tool-identity.ts 那一类)」; `north-star-guard.test.ts`「把 marker 抄进一个真上游文件 ⇒ 仍然红(自报家门不是可伪造的通行证)」 |
| `adr033-receipt-premises` | The OpenCode 2 engine facts Code Puppy's receipt derivation relies on stay true: a pending request's payload cannot change under its id, one reply emits a replied event for every request it resolves, and a second reply is NotFound (ruling item 1 measurements). | `packages/core/src/permission.ts`(upstream-native, pinned) | `permission-reply-premises.test.ts`「(i) a pending request's payload never changes under its id: a second admission with the same id is refused」; `permission-reply-premises.test.ts`「(ii) one always reply emits a replied event for every request it resolves, and only those」 等 |
| `adr038-ask-deadline` | An unanswered approval request fails by name after a deadline (300 s default, CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS override, invalid values fall back to the default) and never auto-allows; only that request ends (#668). | `packages/core/src/permission.ts`(L3 (re-taken: the wait on the reply is inside the kernel; a plugin watchdog's reject cascades)) | `ask-deadline.test.ts`「an unanswered request fails by name at the deadline, its card is retracted, and nothing is allowed」; `ask-deadline.test.ts`「only that request ends: another pending request of the same session is still waiting (no cascade)」 等 |
| `mcp-independent-startup` | One MCP server failing or hanging never blocks the others; a starting server is visible as starting (#1563 AC1). | `packages/core/src/mcp/index.ts`(upstream-native on OpenCode 2 (asynchronous initial connections), pinned) | `codepuppy-mcp-runtime.test.ts`「ok is connected and listed while hang is still pending」 |
| `mcp-named-start-failures` | A server that cannot start fails with a named cause (workspace_missing / dependency_missing / spawn_failed / handshake_timeout …) (#1563 AC2). | `packages/core/src/mcp/codepuppy-startup.ts`(L3 (re-taken client.ts names the cause; re-taken index.ts prefixes `Mcp.Status.Failed.error` through `withFailureCode`, read back by `parseFailureCode`, packages/schema/src/codepuppy-net-failure.ts)) | `codepuppy-mcp-runtime.test.ts`「a missing working directory, a missing command, a refused remote」; `codepuppy-mcp-runtime.test.ts`「the failed status the desktop reads carries the named cause」 |
| `mcp-reconnect-backoff` | A failed server reconnects in the background after 30 s, doubling to 10 min (#1563 AC3). | `packages/core/src/mcp/codepuppy-startup.ts`(L3 (re-taken packages/core/src/mcp/index.ts schedules it on failed/closed)) | `codepuppy-mcp-runtime.test.ts`「a 5xx answer (501) reconnects after 30 s, then after 60 s more」; `codepuppy-mcp-runtime.test.ts`「an auth answer stays failed」 |
| `mcp-start-concurrency` | At most four MCP servers start (spawn + handshake + tools/list) at once (#1563 AC5). | `packages/core/src/mcp/codepuppy-startup.ts`(L3 (re-taken packages/core/src/mcp/connection.ts takes the shared permit)) | `codepuppy-mcp-runtime.test.ts`「six slow servers never overlap more than four deep」 |
| `mcp-declared-tools-before-connect` | A bundled Office server still starting is offered from its bundled declaration; a contradicting server drops the declaration (#1565). | `packages/core/src/mcp/codepuppy-first-party-mcp.ts`(L3 (re-taken packages/core/src/mcp/index.ts tools() / callTool)) | `codepuppy-mcp-runtime.test.ts`「offered while starting; the third party is not; the listing replaces it once connected」; `codepuppy-mcp-runtime.test.ts`「a contradicting connection fails the planned call and drops the declaration」 |
| `mcp-net-failure-runtime` | MCP connection failures are classified with Code Puppy's layered network classifier (#1572 N1, #1547). | `packages/core/src/mcp/codepuppy-startup.ts`(L3 (re-taken packages/core/src/mcp/client.ts calls classifyNetFailure at the source)) | `codepuppy-mcp-runtime.test.ts`「a missing working directory, a missing command, a refused remote」; `codepuppy-mcp-runtime.test.ts`「the failed status the desktop reads carries the named cause」 等 |
| `l1r-net-failure-settle` | Network failures of a model request settle with Code Puppy's named classification (#1572 settle). | `packages/core/src/session/to-session-error.ts`(L3 (re-taken Transport branch calls classifyNetFailure and leads the message with the layer through `withFailureCode`, read back by `parseFailureCode`)) | `codepuppy-net-failure-settle.test.ts`「a refused request settles as provider.transport with tcp ahead of upstream's text」; `codepuppy-net-failure-settle.test.ts`「a transport failure the classifier does not attribute keeps upstream's text, with no code」 等 |
| `l2r-auth-fail-closed` | A model route whose deployment declared no credential refuses before the socket opens instead of sending an unauthenticated request (#652, owner ruling 2026-07-28 per the v1 source comment). | `packages/ai/src/route/auth-options.ts`(upstream-native on OpenCode 2: every provider entry resolves its credential with Auth.optional / Auth.config, which fail before the socket opens; pinned) | `codepuppy-auth-fail-closed.test.ts`「the provider entries are enumerated (an empty list would make the pin vacuous)」; `codepuppy-auth-fail-closed.test.ts`「every provider entry built with no credential sends nothing without one」 |

未握住、待编排器裁决 13 项(选项见登记册每项的 `blocked.options`):

| 登记 id | 决定 | 为什么按现有接口握不住 | 归属 |
| --- | --- | --- | --- |
| `adr033-decision-receipt` | Code Puppy owns the approval reply contract: a sha256 fingerprint of the displayed request, a DecisionReceipt for every reply listing the requests it resolved, idempotent replay, and a 409 on a stale reply (#433 / REQ-090 AC3/AC8). | Held by derivation in the L6 adapter (measurements passed, no kernel re-take; no production reader needs persisted history after a restart): spec in docs/architecture/2026-11-09-1662-permission-reply-measurements.md. Waiting on L6 to implement it. | L6 (#1668) per ruling item 1 |
| `adr041-collision-rejection` | Alias / identity collisions are rejected, never last-wins (ADR-041 decision 2). | Ruling item 3 holds it by reachability: the non-builtin registration paths on OpenCode 2 are the extension's own tools and its project-plugin fan-out (L3 refuses duplicate effective names before registering), MCP tools (refused in L4's MCP re-take: packages/core/src/mcp/index.ts tools(), both members of a colliding pair) the upstream Browser plugin (pinned: packages/core/test/codepuppy-browser-tool-names.test.ts), and an MCP tool against a builtin's effective name (refused in L4's re-take of packages/core/src/tool/mcp.ts; pinned: packages/core/test/codepuppy-mcp-tool-collision.test.ts). Registered as held once the orchestrator registers L3's fan-out mechanism at integration. | L4 (#1666) + L3 (#1665) per ruling item 3 (c) |
| `adr041-history-display-conversion` | Display snapshots persisted on v1 tool parts stay attached to those calls after the move to OpenCode 2 (ADR-041 §4: never overwritten, never inferred). | The v1→v2 conversion (v1-migration.bun.ts, run through the Node shim R14) reads v1 parts with the upstream v1 schema; Code Puppy's part.display is not carried into v2 state.metadata, so converted history loses its provenance. | L4/L5 — needs orchestrator decision |
| `adr035-websearch` | Web search fails honestly (E7) and the cloud leg exists only when the account signal says so; the sovereignty gate covers every executable copy (ADR-035 / ADR-046). | Owned by L3 on OpenCode 2 (websearch.transform / execute.before in the extension); not delivered on the integration branch this lane started from. | L3 (#1665) per lane seams §5 (L5r) |
| `l1r-platform-credential-header` | The platform credential header is added only to platform-provider requests (P6 / S5). | Request assembly belongs to L3 on OpenCode 2 (session.hook model.request / http.request / context); if a hook cannot hold it, L3 hands it back for an L4 re-take. Not delivered on the integration branch this lane started from. | L3 (#1665) per lane seams §5 (L1r) |
| `l1r-output-caps` | Platform and BYOK output caps (temperature / max output) are applied by Code Puppy (P5). | Request assembly belongs to L3 on OpenCode 2 (session.hook model.request / http.request / context); if a hook cannot hold it, L3 hands it back for an L4 re-take. Not delivered on the integration branch this lane started from. | L3 (#1665) per lane seams §5 (L1r) |
| `l1r-naming-resume` | Session naming resumes per Code Puppy's rules (codepuppy-naming-resume). | Request assembly belongs to L3 on OpenCode 2 (session.hook model.request / http.request / context); if a hook cannot hold it, L3 hands it back for an L4 re-take. Not delivered on the integration branch this lane started from. | L3 (#1665) per lane seams §5 (L1r) |
| `l1r-telemetry-credential` | Telemetry never carries the credential (codepuppy-telemetry-credential). | Request assembly belongs to L3 on OpenCode 2 (session.hook model.request / http.request / context); if a hook cannot hold it, L3 hands it back for an L4 re-take. Not delivered on the integration branch this lane started from. | L3 (#1665) per lane seams §5 (L1r) |
| `l1r-subtask-attachment-policy` | Subtask attachments follow Code Puppy's attachment policy (codepuppy-subtask-attachment-policy). | Request assembly belongs to L3 on OpenCode 2 (session.hook model.request / http.request / context); if a hook cannot hold it, L3 hands it back for an L4 re-take. Not delivered on the integration branch this lane started from. | L3 (#1665) per lane seams §5 (L1r) |
| `l1r-review-turn-supply` | Review turns are supplied per Code Puppy's rules (codepuppy-review-turn-supply). | Request assembly belongs to L3 on OpenCode 2 (session.hook model.request / http.request / context); if a hook cannot hold it, L3 hands it back for an L4 re-take. Not delivered on the integration branch this lane started from. | L3 (#1665) per lane seams §5 (L1r) |
| `l1r-command-model-priority` | A model the user explicitly picked out-ranks a command's or its agent's recommended model (#1560). | Request assembly belongs to L3 on OpenCode 2 (session.hook model.request / http.request / context); if a hook cannot hold it, L3 hands it back for an L4 re-take. Not delivered on the integration branch this lane started from. | L3 (#1665) per lane seams §5 (L1r) |
| `hub-install-ask` | Installing from the Customization Center always asks (and is denied to automated agents) (I10). | Owned by L3 (hub-tools.ts permission.assert + permission.hook.evaluate); not delivered on the integration branch this lane started from. | L3 (#1665) per lane seams I10 |
| `sidecar-stop-drains` | Stopping the engine drains connections before exit (codepuppy-sidecar-stop; OOR-2: /global/dispose is 404 on 2.x). | Owned by L5 (sidecar-stop.ts); not delivered on the integration branch this lane started from. | L5 (#1667) |

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
