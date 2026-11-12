---
id: PLAN-1662-opencode2-parity
title: OpenCode 2 换代 —— v1 测过、2.x 还没有证明的行为 实施计划
summary: alpha-code#1662 对账遗留的九项行为(web search 失败诚实与「没搜 / 没搜到」、三档权限矩阵与两条委派入口、长期记忆接缝、云连接器凭据现读、平台凭据错误不重试、改名后的三条续写、停止释放待审批回合、web search 副本普查与账户态工具表合成)逐项在 2.x 上补证明或实测报告;外加六个仍指向已删 v1 引擎的测试移植到 2.x 宿主
kind: plan
status: active
spec: ""
design: docs/design/2026-11-08-1662-opencode2-generation-switch-baseline.md
owners: [alpha-code desktop maintainers]
last_reviewed: 2026-11-12
---

# PLAN-1662-opencode2-parity｜v1 测过、2.x 还没有证明的行为 实施计划

由实施会话在计划阶段写,编排器核对后由同一会话实施。每项一节;决定只链接、不重述;实施中偏离某节,在同一个提交里改那一节。

- 依据:Issue [alpha-code#1662](https://github.com/impharaon/alpha-code/issues/1662)(正文 updatedAt 2026-11-12T06:42:12Z);派发书 `par-parity`(九项 + 六个坏测试);owner 2026-11-09 原话(编排器转述):「不可以因为 opencode 更新把经 codepuppy 拿回的唯一权威再封掉」。v1 的位置一律取 `origin/alpha` @ `9ca7514ca7`;退役注释在 `scripts/gate-files.tsv`(第 192–213、358–378 行一带)与 [plan-i09](../upstream-upgrade-readiness/plan-i09.md)。基点 `lane/1662-parity-proofs` @ `ab31da3d24`。
- 核对:`a1dcc2f276` · 编排器 · 通过(续派发书「IMPLEMENT plan a1dcc2f276」:先实测再定,实测不成立的项不提交证明;第 3 项 E4、第 8 项按裁决修;第 1–2、5 项先报告;第 4 项只写接缝前提探针;按组交回)。

## 共用约定

**判法**。每项二选一:(a) 2.x 上机制存在 ⇒ 写一条走生产代码的证明测试,带「已知的坏」臂,登记(Code Puppy 的决定进 `docs/architecture/codepuppy-authority-registry.json`;测试文件进 `scripts/gate-files.tsv`,条数用 `bash scripts/bun-test-floor.sh =N` 实测)。(b) 不成立 ⇒ 停在这一项,报告 2.x 实际做了什么(真跑出来的输出)、用户能看到的后果、最小的接法(插件钩子 / main / 适配层 / 具名接管)。**不实现新接管,不提交断言坏行为的测试,不弱化、不伪造证明。** (b) 的实测探针写在工作树里跑,跑完删除,不进提交;回执给出命令与输出。

**下面每节的「2.x 现状」是读码结论,不是实测**。实施时先实测;实测推翻读码,按实测走,并在该节「偏离记录」写明。

**三种证明宿主**(都已在仓里,不新造框架):

| 代号 | 宿主 | 用在 |
| --- | --- | --- |
| H1 | `packages/ext/src/policy/policy-host.cases.ts`:进程内真 OpenCode 2(Plugin、Tool、Permission、Agent、Session、SessionPrompt、命令插件),ext 的 `registerPolicy` | 第 3 项 |
| H2 | ui-mac 引擎沙箱:`test-component/engine-sandbox.ts` + `engine-server-options.ts` + `engine/engine-embed.ts`(打包 sidecar 嵌的同一个入口),`.cases.ts` 由同名 `.test.ts` 起独立 `bun test` 子进程;模型桩沿用 `engine-session-turn.cases.ts` 的本机 OpenAI 兼容桩;配置来自生产 `injectCodePuppyConfig`(同 `codepuppy-config-injection-engine.cases.ts`) | 第 5–9 项、B4–B6 |
| H3 | `packages/core/test` 里上游 websearch 测试(`tool-websearch.test.ts`、`plugin/websearch.test.ts`)的同款装配:真 `WebSearchTool` + 真 `WebSearchExa` + 真 `WebSearch` 服务,只把 HttpClient 换成回放仓内实抓件(`docs/verification/2026-09-24-1445-exa-mcp-response-shapes/results/`) | 第 1、2 项 |

H3 不用 H2 的理由:Exa 端点是编译期常量(`packages/core/src/plugin/websearch/exa.ts:9`),沙箱引擎没有把它改指本机的接缝;被判的是「响应体 → 模型面文字」,这一段在 H3 里全是生产代码。

**每个提交后**跑:本项新改的测试、`packages/ui-mac` 的 `bun test src/main/gate-file-registry.test.ts src/main/old-name-scan.test.ts`(`gate-files.tsv` 在旧名扫描面里)、动了登记册就跑 `packages/ext` 的 `bun test src/policy/authority-registry.test.ts`。一项一个提交;变异实测结果写进提交信息,用 `git restore` 还原。

---

## 第 1 项 — `#1449` AC1:Exa 返回 `isError: true` 不当成搜索结果

- **v1 在哪里握住**:`git show origin/alpha:packages/core/src/tool/websearch.ts` 的 `parseResponse`(认 `isError` ⇒ `WebSearchFailure(provider_error)`)与 legacy `packages/opencode/src/tool/mcp-websearch.ts`;测试 `packages/core/test/codepuppy-websearch-failure.test.ts`(26)、`packages/opencode/test/tool/codepuppy-websearch-failure.test.ts`(45),判据是「HTTP 200 SSE + isError:true ⇒ 具名 error(不是结果、不是 NO_RESULTS、不是通用文案)」。
- **2.x 现状(读码)**:上游 `exa.ts:16-24` 的 `McpOutput` 没有 `isError` 字段,Effect Schema 的 Struct 默认忽略多余键,所以照样解码;`exa.ts:44-45` 取第一段文本交给 `parseResults`(`:51-69`),它只认带 `URL:` 行的块。三条实抓的 in-band 错误文本(`arms.json` 的 `inband-*`,例如 `web_search_exa error (401): Invalid API key…`)都没有 `URL:` 行 ⇒ 结果为空 ⇒ `packages/core/src/tool/plugin/websearch.ts:151-161` 给模型 `NO_RESULTS`(「No search results found. Please try a different query.」)。字面上「原文不会被当成结果」成立,但模型看到的是「搜了、没搜到」,正是 v1 判据明令排除的那一句(`not.toBe(NO_RESULTS)`)。
- **可达性(未实测的前提)**:Code Puppy 默认走 keyless Exa(`packages/ext/src/plugin.ts:73-74`、`:304-306`),sidecar 剥掉 `EXA_API_KEY`(`packages/ui-mac/src/main/sidecar-env.ts:9`),所以「无效 key」这一臂经环境变量到不了;另两条实抓是协议错误,我们固定的调用发不出来。keyless 下 Exa 的上游故障是否也走 in-band `isError` 没有实抓件。回执里写明这一点,不替它下结论。
- **预判:(b)**。
- **实测**:H3 探针,回放三条 `inband-*` 实抓件,记下模型面文字与工具结果类型;同一探针加一条真结果实抓(`success-arm-sample.log`)当对照,证明这条链是活的。
- **最小接法(报告用,不实现)**:① 接管上游 `exa.ts`:`McpOutput` 加可选 `isError`,为真时以 `RequestError` 失败(约 5 行,进 north-star 例外与 ADR-047 接管表)——推荐;② ext 的 `websearch.transform` 用 `editor.remove("exa")` 换上 Code Puppy 自己的 exa 供应商 —— 等于在本仓新增一份可执行的 web search 副本,第 9 项的普查要多登记一份,代码也更多;③ ext 的 `execute.after` 只看得到解析后的空结果,看不到 `isError`,不可行。
- **登记**:无(不成立的项不写登记册;登记册判官不允许 blocked 条目)。回执里另列:登记册 `adr035-websearch` 的 decision 写着「Web search fails honestly (E7)」,在本项实测为 (b) 时它与事实不符,交编排器处置。
- **规模**:探针约 60 行,30 分钟;无提交。

## 第 2 项 — `#1445` AC1:「没搜」与「搜了、没搜到」对模型可区分

- **v1 在哪里握住**:同上两份传输;测试 `packages/core/test/codepuppy-websearch-nokey-outcomes.test.ts`(22)、`packages/opencode/test/tool/codepuppy-websearch-nokey-outcomes.test.ts`(23)。无 key 路径的三种结局 —— C(429 限流)、D(200 + 非 `isError` 的 246 字额度提示,`ticket-payload.json`)、Z / Z2(真零命中)—— 在模型面两两不同;D 是把 vendor 原文逐字交给模型。
- **2.x 现状(读码)**:C ⇒ `filterStatusOk` 失败 ⇒ `RequestError` ⇒ 「Web search rate limited (HTTP 429)」,与零命中不同;kill-switch ⇒ ext 的 `execute.before` 拒,文字是 Code Puppy 的拒绝理由(已有 `plugin-host.test.ts`「权威 · 联网搜索准入(L5r)」),与零命中不同;Z、Z2 ⇒ `NO_RESULTS`;**D ⇒ 没有 `URL:` 行 ⇒ `NO_RESULTS`,与 Z 同一句**;第 1 项的 in-band 错误也落到同一句。
- **预判:(b)**(D 与第 1 项的 B 臂);C 与 kill-switch 成立。
- **实测**:同一个 H3 探针加 C、D、Z、Z2 四份实抓件,输出一张「结局 → 模型面文字」表;kill-switch 那一格引用已有的 `plugin-host.test.ts` 用例,不重写。
- **为什么不提交「成立的一半」**:只钉 C / kill-switch / Z 两两不同,会让这道闸看起来绿,而缺的恰好是 D 那一格。按派发书,这一项整体报告。
- **最小接法(报告用)**:改动点同第 1 项的 `exa.ts`。2.x 的结果结构(`WebSearch.Result`:url / title / content)没有放原文的位置,D 该以什么形状到模型面是一个设计选择(v1 AC3 已排除按关键字认文案),需要裁决,本线不选。
- **规模**:并在第 1 项的探针里;无提交。

## 第 3 项 — 三档权限端到端映射到 2.x Permission(R1–R12),两条委派入口与直接路径同判

- **v1 在哪里握住**:`packages/opencode/test/permission/codepuppy-tier-tool-matrix.test.ts`(28,方案 `docs/design/req236-permissions-and-provenance.md` §2.2 R1–R12 逐格)、`codepuppy-composer-tiers.test.ts`(4,真 `injectCodePuppyConfig` → 真 Agent → 真 `Permission.ask`)、`codepuppy-tier-delegation.test.ts`(20,E1–E4 四条入口);v1 机制是注入的 `codepuppy-ask` / `codepuppy-readonly` agent 加 v1 `session/prompt.ts` 里 E2/E4 的 `askDelegation`。
- **2.x 现状(读码)**:三档的载体仍是注入的 agent,动作名已是 2.x 的(`packages/ui-mac/src/main/codepuppy-config-injection.ts:374-433`:`shell`、`subagent`、`mcp:*` / `plugin:*` ask)。已有的 2.x 证明只到规则层的片段(`register-policy.test.ts` 的 I9、document / ruleset 轴、`/review` 三态),没有「真注入 → 2.x 引擎」逐格。两条委派入口:
  - **E2 带 agent 附件的 prompt**:2.x 把 `agents` 附件存进用户消息(`packages/core/src/session/prompt.ts:48`、`:84`),读码没找到任何跳过检查的分支;模型据此发出的 subagent 调用走 `tool/plugin/subagent.ts:144` 的权限断言 ⇒ 预判 (a)。
  - **E4 自带其它助手的非子任务命令**:`packages/core/src/config/plugin/command.ts:115-118` 直接 `switchAgent` 到命令的助手,没有任何权限检查(只有子任务分支 `:77-88` 的 codepuppy 块断言了 subagent 权限)。「只读」档里一条声明 `agent: build` 的命令会把会话切到 build,按 build 的规则跑 ⇒ 预判 (b)。
- **证明**:新文件 `packages/ext/src/policy/tier-matrix.test.ts`,宿主 H1。agent 段取自真 `injectCodePuppyConfig(临时目录).config.agents`,经 2.x 生产的配置 → agent 路径(`packages/core/src/config/plugin/agent.ts`,`@opencode/schema/config` 解码)装进宿主,不手抄规则。逐格判三种结局:放行(调用真执行,计数 1)、询问(出现一条待批请求;拒绝后计数 0)、拒绝(具名拒绝,计数 0,无待批请求)。覆盖 R1、R2(规则层那一半:`external_directory`)、R3、R4、R5、R6a(subagent 工具)、R6b(E2)、R6c(E4)、R6d(子任务命令)、R8、R9–R11(只读档:每次询问且没有「始终」)、R12(文档轴停用)。R7 与 R2 的围栏一半不是规则层,同 v1 不在本文件判。
- **已知的坏**:① 「全部批准」列本身是对照:「请求审批」「只读」与它不同的每一格,换成 build 就变放行,证明探针分得出三种结局;② 变异实测:把注入里 `codepuppy-ask` 的 `shell: "ask"` 改成 `"allow"` ⇒ R5 询问格红;删掉 `codepuppy-readonly` 的 `subagent` 规则 ⇒ R6a 只读格红;E2 格:同一 prompt 在 build 档建出子会话。
- **E4 若实测为 (b)**:矩阵照常提交但不含 R6c 的两格(不写断言坏行为的用例),回执报告实测、后果(只读 / 请求审批档被一条命令升成全权)与最小接法:在 `command.ts` 现有的 `codepuppy` 标注块里,`switchAgent` 之前补一条与子任务分支相同的 `ctx.permission.assert({ action: SubagentTool.name, resources: [agent], … })`。该文件已是接管文件(`#1129` / `#1560` 块),但这是生产改动,等裁决。
- **登记**:登记册新增一项 `composer-tier-matrix`(decision:三档按 REQ-236 §2.2 映射到 OpenCode 2 Permission,委派入口取本档的判决;机制 `packages/ui-mac/src/main/codepuppy-config-injection.ts`,阶梯 main(注入的 agent);tests 列新文件的用例);ADR-047「权威保持表」加一行、「已握住 52 项」改 53。`gate-files.tsv` 新增一行。
- **规模**:约 300 行,90 分钟。

## 第 4 项 — ADR-045 长期记忆的注入接缝在 2.x 上

- **前提更正(要报告)**:v1 **从未把长期记忆注入对话**。`origin/alpha` 上 ext 与 ui-mac main 没有任何 memory-context 路径(`git grep` 零命中,`git log -S memory-context` 只有 ADR 本身与改名映射表);接线票 #425 没有落地。v1 留下的只有 ADR-045 §1 的接缝前提探针 `packages/opencode/test/session/codepuppy-427-memory-seam-probe.test.ts`(3:插件推进 `cfg.instructions[]` 的文件每步重读、删即失效)。「字节上限」在 `packages/ext/src/context-injection.ts` 里登记的是 ui-mac 写的身份 / 行为说明文件,不是记忆;记忆没有渲染器,也就没有登记过的上限。
- **2.x 现状(读码)**:配置里的 `instructions` 由 `packages/core/src/config/plugin/instruction.ts` 装,每个文件都被监听(`:60`、`:139`),变化后重扫并 `discovery.reload()`(`:216`、`:221`);`instruction-discovery.ts` 渲染 `Instructions from: <path>`,并对删除 / 修改产出增量文字(`:127-147`);`session/context.ts:155` 把它并进模型上下文。ADR-045 依赖的「放一个文件进配置 ⇒ 进上下文,删掉 ⇒ 不再生效」在 2.x 上换了机制,预判仍成立 ⇒ (a)。
- **证明**:新文件 `packages/core/test/codepuppy-memory-seam.test.ts`(Code Puppy 自有,文件名声明归属),沿用上游 `instruction-discovery.test.ts` / `session-instructions.test.ts` 的装配:① 配置里列一个文件 ⇒ 选出的上下文恰好有一段 `Instructions from: <path>`;② 删掉文件 ⇒ 下一次选出的上下文不再带它(同时记下 2.x 产出的删除增量原文,写进测试名与回执);③ 写回 ⇒ 又出现。
- **已知的坏**:对照臂:同一文件不列进配置 ⇒ 0 段。
- **登记**:不是 Code Puppy 握着的机制(记忆没接线),不进登记册;`gate-files.tsv` 一行(前提探针)。ADR-045 §5 的 proposed 形态不由本线改写,回执里点出「2.x 的接缝是配置 instructions + 文件监听」供 #425 用。
- **规模**:约 90 行,40 分钟。

## 第 5 项 — 云连接器在请求边界读凭据

- **v1 在哪里握住**:v1 `connectRemote` 对治理条目给 MCP SDK transport 一个 fetch 包装器 `governedCredentialFetch`(`packages/plugin/src/alpha-cloud-authority.ts:79`),每个请求从 `CODEPUPPY_CLOUD_MCP_DEF` 里的 `{file:}` 引用现读;测试 `packages/opencode/test/mcp/codepuppy-cloud-credential-hot.test.ts`(3:换文件后 POST / GET-SSE 重连 / 404 会话恢复都带新凭据,删文件 ⇒ 认证错误零出网)。
- **2.x 现状(读码)**:ext 的 `installCloudMcp` 在 `mcp.transform` 里把 `{file:}` **解析一次**,把字面令牌写进 server 配置(`packages/ext/src/cloud-websearch-kill.ts:405-450`,`:430`);`governedCredentialFetch` 在 2.x 上没有任何调用方。ui-mac 的热应用说明(`packages/ui-mac/src/main/codepuppy-secret-files.ts:153-155`)仍写着「云 MCP … 在请求边界现读」,在 2.x 上已不是事实。换账户与登出会改变热凭据的在场集合 ⇒ `needs-structural` ⇒ 重启引擎 ⇒ 重新 transform ⇒ 重新读(`:173-176`),所以**跨账户不会串**;同一身份续期走热写、不重启 ⇒ 预判 (b):云连接器继续发旧令牌,直到下一次重载。后果(推论,待实测):旧令牌过期后,云工具以认证错误失败,直到引擎重启。
- **实测**:H2:沙箱引擎 + 真 ext + 本机 streamable-HTTP MCP 桩记录每个请求的 Authorization;ARM / DEF 由生产注入给出;令牌 A ⇒ 调一次;生产 `applyPlatformCredentialsHot` 写入令牌 B ⇒ 再调(POST),看记录;删文件 ⇒ 再调,看是否出网。另跑一次换身份(在场集合变化)确认 `needs-structural`。
- **若实测为 (a)**:提交为 `packages/ui-mac/src/main/cloud-credential-hot.engine.{test,cases}.ts`,反向臂:同一桩、不装 ext ⇒ 中和条目、零请求。
- **最小接法(报告用)**:① 在 2.x 远端 MCP transport(`packages/core/src/mcp/client.ts`,L4 已接管)对治理条目接上现成的 `governedCredentialFetch` —— 与 v1 等价、改动小,推荐;② main 在热写 `applied` 后发一次现有的重载请求(作用域 mcp),让 ext 重跑 `mcp.transform` —— 不动引擎,但每次续期都重连,写入与重载之间有窗口;③ 把 MCP 令牌续期判成 `needs-structural` —— 代码最少,但每次续期重启引擎,等于撤回 #1562。
- **规模**:探针约 120 行(与 B4 共用宿主),40 分钟;(b) 无提交。

## 第 6 项 — 平台凭据错误不按退避重试(401 / 403 一次失败、具名)

- **v1 在哪里握住**:v1 `SessionRetry.retryable` 对非 APIError 做关键词匹配,ext 的措辞刻意避开;测试 `packages/opencode/test/session/codepuppy-platform-credential-error.test.ts`(2,含「换成含 unavailable 的措辞 ⇒ 判可重试」对照)。
- **2.x 现状(读码)**:ext 在 `session.hook("model.request")` 里读不到凭据就抛 `LoadAPIKeyError`(`packages/ext/src/plugin.ts:224-228`);session 域钩子没有失败通道(`packages/core/src/plugin/hooks.ts:23-26`),抛出会以缺陷形式出来,不是 `AIError`;`ModelRetry.retry` 只对 `AIError` 且 `isRetryable` 的失败重试(`packages/core/src/model-retry.ts:92-102`)。401 / 403 ⇒ `AIError` 的 Authentication ⇒ `provider.auth`,是否可重试待实测。预判 (a);缺陷那条路径上用户看到的名字没量过,可能是一句通用错误 —— 由证明决定。
- **证明**:与 B4 共用 H2 宿主(真 ext + 本机假网关 + 生产 `buildCodePuppyModelConfig` / `syncSecretFiles`),新文件 `packages/ui-mac/src/main/platform-credential-error.engine.{test,cases}.ts`:① 凭据文件缺席 ⇒ 这一轮失败一次;假网关 0 个请求;引擎记下的失败文字含 ext 那句「Code Puppy platform credential could not be read」;耗时小于 2 秒(退避的第一个间隔是 2 秒,`model-retry.ts:22-28`);② 网关回 401 ⇒ 恰好 1 个请求,类型 `provider.auth`;403 同判。
- **已知的坏**:同一宿主让网关回 503 ⇒ 请求数 ≥ 2,证明计数看得见退避重试(这一臂多花约 2–3 秒)。
- **若 ① 的失败没有名字**:按 (b) 报告实测文字与最小接法,不改 ext 措辞凑绿。
- **登记**:`l1r-platform-credential-header` 的 tests 追加;`gate-files.tsv` 一行。
- **规模**:约 120 行,45 分钟(宿主在 B4 里搭好)。

## 第 7 项 — 0.1.24 改名迁移后的三条续写路径

- **v1 在哪里握住**:`packages/opencode/test/session/codepuppy-naming-resume.test.ts`(5):继续生成、压缩后续写、溢出重放后续写,外加不迁移 / 迁移 SQL 漏改最近一条用户消息(R18)两条对照。
- **2.x 现状(读码)**:改名在引擎一次性的 v1 → 2.x 转换之前跑在 v1 表上,转换后 2.x 会话的 agent / model 与工具卡快照都是新名(`naming-before-v1-conversion.cases.ts`,登记册 `l1r-naming-resume`)。2.x 上的三条路:继续 = 往该会话发 prompt,运行器按 `session.agent` 选(`packages/core/src/session/runner/model.ts:75-80`);压缩 = `session/compaction.ts`;溢出 = 供应商判上下文过长 ⇒ `compact({ reason: "overflow" })` 后在同一轮重试(`runner/llm.ts:238-371`)。2.x 没有 v1 R18 那种「重放复制最近一条用户消息」。预判 (a)。
- **证明**:新文件 `packages/ui-mac/src/main/naming-resume.engine.{test,cases}.ts`,沿用 `naming-before-v1-conversion.cases.ts` 的种库与生产顺序(真 `runNamingMigrationDbStep` → 沙箱引擎转换);配置里只有新名的 `codepuppy` 供应商(指向模型桩)与 `codepuppy-readonly`。① 继续 ⇒ 这一轮以桩的文字完成;② 0.1.24 留下的压缩触发消息经转换后 ⇒ 压缩并续写完成(实测转换把它变成什么,写进用例名;若转换丢掉它,这一臂改为 2.x 的压缩入口,并在偏离记录写明);③ 桩第一次回上下文过长(用 `compaction.ts:8` 的 `isContextOverflowFailure` 认得的形状)⇒ 压缩 ⇒ 完成。
- **已知的坏**:反向顺序(先转换、后改名)⇒ ① 以找不到 agent / 供应商具名失败。
- **登记**:`l1r-naming-resume` 的 tests 追加;`gate-files.tsv` 一行。
- **规模**:约 200 行,75 分钟。

## 第 8 项 — `#1647` AC1:停止引擎释放等待审批的回合

- **v1 在哪里握住**:`packages/opencode/test/server/codepuppy-sidecar-stop.test.ts`(1):停止时工具部件结束为 error 且有结束时间;助手消息 `MessageAbortedError` 且有完成时间;待批列表为空;真实 MCP `tools/call` 为 0。
- **2.x 现状(读码)**:停止 = 关掉 `start()` 的作用域(`packages/ui-mac/src/main/sidecar-stop.ts`,`engine/engine-embed.ts:42`)。Code Puppy 刻意不传 `lifecycle`(`engine-embed.ts:17`,裁决 N1),所以下次启动不会续跑未释放的执行认领;而 2.x 的优雅关闭**有意保留**认领(`packages/core/src/session/execution/restart.ts:39`、`:50`)。中断时运行器有没有给工具部件与助手消息写终态,读码判断不了。预判:不确定,倾向 (b)(部件停在 running、认领永不释放)。
- **实测 / 证明**:H2:沙箱引擎 + 真 ext + 模型桩发一次对 stdio MCP 桩工具的调用(桩把每次 `tools/call` 记进文件,同 `packages/core/test/fixture/codepuppy-mcp-startup-stdio.ts` 的做法);助手用 `codepuppy-ask` 档让它询问;等到待批请求出现 ⇒ 走生产停止路径关引擎 ⇒ 同一库重启 ⇒ 读消息:工具部件状态与结束时间、助手错误与完成时间、待批列表、调用记录,另看该会话能否接下一条 prompt。
- **已知的坏**:停止前先回复 once ⇒ 调用记录有 1 次。
- **若成立**:提交为 `packages/ui-mac/src/main/sidecar-stop-pending-approval.engine.{test,cases}.ts`,登记册 `sidecar-stop-drains` 的 tests 追加,`gate-files.tsv` 一行。
- **若不成立**:报告实测状态、用户能看到的后果(例如工具卡一直转圈、会话收不了新消息)与最小接法:① 停止前由 main → sidecar 经引擎现有的会话中止接口中止运行中的回合,再关作用域(不接管);② 启动时把孤儿认领经现有接口终结(先量有没有这样的接口);③ 具名接管 execution 层。
- **规模**:约 180 行,75 分钟。

## 第 9 项 — web search 副本普查;「真 fork env → 模型工具表」合成判据

- **v1 在哪里握住**:`git show origin/alpha:packages/ui-mac/src/main/websearch-copies.test.ts` 的普查网(注册为 websearch 的工具恰好两份;引用 Exa / Parallel 端点的文件恰好是两条带闸传输加登记过的纯说明)与 `server.test.ts` 的 `#1411` 一组(真 `forkSidecar()` env → v1 `RuntimeFlags` / `webSearchEnabled` / `Permission.disabled` → 模型工具表)。两者在 I-09 退役(`gate-files.tsv` 第 89 行、`server.test.ts:342-348` 的注释)。
- **2.x 现状(读码)**:一个 `websearch` 工具(`packages/core/src/tool/plugin/websearch.ts`)经 `WebSearch.Service` 前置五个上游供应商(`packages/core/src/plugin/websearch/{exa,firecrawl,parallel,tavily,tinyfish}.ts`);主权闸是 ext 按工具名在 `execute.before` 拒(加 MCP 工具名判别);注入仍按 agent 写 websearch 的 permission deny(`codepuppy-config-injection.ts:249-264`)。普查与合成两张网在 2.x 上都没有 ⇒ 机制在,缺判据 ⇒ (a)。
- **证明 ① 普查**(改写 `packages/ui-mac/src/main/websearch-copies.test.ts`):网 A —— 生产 TypeScript(`git ls-files`,排除测试)里注册 websearch 供应商(`WebSearchProvider.register`、`websearch.transform` 里的 `editor.add`)或调用 `WebSearch.Service` 查询的文件,恰好是列出的集合(五个供应商、websearch 工具、`config/plugin/websearch.ts`、ext `plugin.ts` 的默认选择);网 B —— 含供应商端点字面量(`mcp.exa.ai` 等)的文件恰好是列出的集合。任何新增都点名,停下来分类。**已知的坏**:两张网各在一份临时副本里塞一个新文件跑一次,必须点名它。
- **证明 ② 合成**(新文件 `packages/ui-mac/src/main/websearch-account-tool-table.engine.{test,cases}.ts`):真 `forkSidecar()` 给出三种账户态的 env(登录代付 / 登出 / kill-switch)→ 真 `injectCodePuppyConfig` → H2 沙箱引擎 + 真 ext + 本机云 MCP 桩(工具表取 `packages/ui-mac/src/main/fixtures/cloud-mcp-tools`)→ 模型桩记下第一次模型请求的 `tools` → 判 `websearch` 与 `cloud_web_search` 的在场性:代付 ⇒ 两个都在;登出 ⇒ 只有 websearch;kill-switch ⇒ 都不在(期望取自 ADR-046 D1 与 `#1411` 的退出条件,不从被测代码派生)。**已知的坏**:kill-switch 下去掉注入的 `applyWebSearchDenies` ⇒ `websearch` 回到表里。若实测 2.x 不按 permission deny 把工具摘出模型工具表(只在执行时拒),kill-switch 一格改判「在表里但执行被拒」,并按 (b) 报告「模型会被提供一个注定被拒的工具」这一后果,不改断言凑绿。
- **登记**:两条都追加到 `adr035-websearch` 的 tests;`gate-files.tsv`:`websearch-copies.test.ts` 条数随改写实测写回(受托列按新内容更新),合成文件新增一行;`source-text-anchors.ts` 里 `websearch-copies.test.ts` 的行数机械同步(I-09 段 2 的先例)。
- **规模**:普查约 80 行,30 分钟;合成约 220 行,75 分钟。

---

## 坏测试移植(B1–B6)

每个都保留原断言的意图,改到 2.x 宿主;做不到的说明行为为什么已不存在,不删断言凑绿。

| # | 文件 | 现状 | 移植 | 规模 |
| --- | --- | --- | --- | --- |
| B1 | `packages/ui-mac/src/main/server.test.ts` 的 `#1443` 组(4 红) | 辅助函数 `injectUnderSidecarEnv` 读 v1 的 `{ ok: true }` 与 `OPENCODE_CONFIG_CONTENT`;2.x 的 `injectCodePuppyConfig` 返回 `{ config, explicit }` | 改读 `config`(先证明注入真跑成:`plugins` / `agents` 非空),形状换成 2.x 的 `permissions` 数组与 `mcp.servers`;归属仍由真 `computeMcpOwnership`,判决仍是 ext 钩子首行那个函数。4 条断言意图不变 | 30 分钟 |
| B2 | `packages/ui-mac/src/main/naming-migration-wiring.test.ts`(整文件起不来) | 它导入的 `packages/ui-mac/scripts/export-codepuppy-names.ts:18` 导入已删的 `opencode/src/mcp/catalog`(派发书写的 `scripts/export-codepuppy-names.ts` 指的就是这份) | 换成 2.x 引擎自己的 MCP 工具名函数 `name()`(`packages/core/src/tool/mcp.ts:24-25`);若导入它会把整张引擎图拖进脚本,改用它组合的 `effectiveName` / `normalizedName`(`packages/core/src/tool/runtime.ts`)。2.x 的名字与 v1 有差的,导出产物与 `codepuppy-names-export.test.ts` 的快照机械同步,回执列 diff。之后整文件跑一遍,新暴露的红按规则处置 | 30 分钟 |
| B3 | `packages/ui-mac/src/main/stream-read-hygiene.test.ts`(实测 3 pass / 5 fail) | workspace 根清单变了(`packages/console/` 等)、提到禁用名的文件集合变了、两条「这处提及是禁令不是调用」指向已删的 v1 `read.ts` / `mcp-websearch.ts` | 根清单与提及集合按 2.x 的树实测更新;两条 v1 文件的臂退役,退役注释写明 2.x 上有没有对应的提及(实测);全仓禁令本身不动 | 20 分钟 |
| B4 | `packages/ui-mac/src/main/token-hot-apply.engine.test.ts` | 起已删的 `packages/opencode/src/index.ts serve` | 改到 H2(进程内 2.x 引擎 + 真 ext + 本机假网关 + 生产 `buildCodePuppyModelConfig` / `syncSecretFiles` / `applyPlatformCredentialsHot`):令牌 A ⇒ 每个请求带 A;热写 B ⇒ 下一条全是 B;删文件 ⇒ 失败且网关零请求;反向臂(不装 ext ⇒ 网关收到占位值被拒);哨兵臂(令牌不出现在引擎输出与响应体)。第 5、6 项复用这个宿主 | 60 分钟 |
| B5 | `packages/ui-mac/src/main/image-input-capability.test.ts` | 起已删引擎跑 `models --verbose` | 改用 H2 引擎的 `GET /api/provider`(同 `codepuppy-config-injection-engine.cases.ts` 的 C7),逐模型读 `capabilities.input`;反向臂 ①(删掉 `modalities` ⇒ 直连 kimi 回到 false)照旧;反向臂 ②(id 叫 `openai` 的自定义节点从 models.dev 继承 image:true)先实测 2.x 还回不回落,不回落就说明这一臂的对象在 2.x 上不存在,只留 ① | 45 分钟 |
| B6 | `packages/ui-mac/src/renderer/extensions/use-extensions-recovery.cases.ts:57` | 起已删引擎 | 引擎改由 H2 起(回环监听),4 条用例的意图不变(sidecar 重启后恢复、被拒请求计数、迟到错误臂);先核对 hook 打的 `statusPath` 在 2.x 上存在,若它打的是 v1 才有的路由,报告行为已经移到哪里 | 45 分钟 |

B1、B3 属 web search 一组;B4 属凭据一组;B2、B5、B6 单独一组。每个一个提交,`gate-files.tsv` 对应行的条数实测写回。

---

## 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/src/main/composer-tier-matrix.engine.{test,cases}.ts`(新;原计划 `packages/ext/src/policy/tier-matrix.test.ts`,见偏离记录) | 第 3 项:三档 × R1–R12 与 E2 / E4,在 H2 的嵌入式引擎上判 |
| `packages/core/src/config/plugin/command.ts` | 第 3 项 E4(编排器裁决授权):现有 `codepuppy` 标注块里,换助手之前走 subagent 的权限路径 |
| `packages/ui-mac/src/main/codepuppy-config-injection.ts`(+ `config-injection-throat.test.ts`、`codepuppy-config-injection.test.ts`) | 第 3 项 R2(编排器裁决授权):build 与 codepuppy-ask 追加 v1 的 `external_directory` 规则 |
| `packages/ext/src/policy/gate.ts` | 第 3 项 R11(编排器裁决授权):没有绑定摘要时不写 `metadata.policy.bindingDigest` |
| `packages/ui-mac/src/main/memory-seam.engine.{test,cases}.ts`(新;原计划 core 测试,见偏离记录) | 第 4 项:2.x 配置 instructions 接缝的前提探针 |
| `packages/ui-mac/src/main/platform-credential-error.engine.{test,cases}.ts`(新) | 第 6 项 |
| `packages/ui-mac/src/main/naming-resume.engine.{test,cases}.ts`(新) | 第 7 项 |
| `packages/ui-mac/src/main/sidecar-stop-pending-approval.engine.{test,cases}.ts`(新,仅当第 8 项成立) | 第 8 项 |
| `packages/ui-mac/src/main/cloud-credential-hot.engine.{test,cases}.ts`(新,仅当第 5 项成立) | 第 5 项 |
| `packages/ui-mac/src/main/websearch-copies.test.ts` | 第 9 项普查 |
| `packages/ui-mac/src/main/websearch-account-tool-table.engine.{test,cases}.ts`(新) | 第 9 项合成 |
| B1–B6 列出的六个文件,以及 `packages/ui-mac/scripts/export-codepuppy-names.ts` | 移植 |
| `docs/architecture/codepuppy-authority-registry.json`、`.claude/rules/adrs/ADR-047-opencode2-engine-generation.md` | 新增 `composer-tier-matrix`;`adr035-websearch`、`l1r-platform-credential-header`、`l1r-naming-resume`、`sidecar-stop-drains`(成立时)追加测试;ADR-047 保持表同步 |
| `scripts/gate-files.tsv`、`packages/ui-mac/src/main/source-text-anchors.ts`、`scripts/old-name-exceptions.tsv` | 新测试行与条数;受托列;机械同步 |

生产代码:无计划内改动。证明暴露的缺陷先报告。

## 顺序

1. **web search**:B3 → B1 → 第 9 项普查 → 第 9 项合成 → 第 1、2 项实测(无提交,进回执)。约 2.5 小时。
2. **权限**:第 3 项(E4 先实测;(b) 则矩阵不含 R6c 两格)。约 1.5 小时。
3. **凭据**:B4(搭 H2 假网关宿主)→ 第 6 项 → 第 5 项实测。约 2.5 小时。
4. **生命周期**:第 4 项 → 第 7 项 → 第 8 项。约 3 小时。
5. **其余移植**:B2 → B5 → B6。约 2 小时。

每一步结束记时;某一组超过预计一倍就停下回 PARTIAL,已完成的提交保留。

## 风险

- **H2 子进程的耗时**:每台引擎启动 1–3 秒;一个 cases 文件尽量复用一台引擎,只在必须换库 / 换配置时重起。
- **隔离**:H2 一律在 `beforeAll` 里调 `assertEngineSandboxed`,不在沙箱就整份不跑;绝不碰 `~/.local/share/opencode`。
- **(b) 项被写成「绿」**:不提交断言坏行为的测试,也不提交只钉成立一半、看起来完整的测试(第 2 项已写明)。
- **登记表耦合**:`gate-files.tsv` 在旧名扫描面里,每次改它都重跑旧名判官;`websearch-copies.test.ts` 的行数变化同步到 `source-text-anchors.ts`。
- **模型桩的形状**:工具调用、上下文过长两种回应要用 2.x 认得的形状;先用一个最小用例证明桩触发了预期分支(例如 overflow 真的走了压缩),再写判据。
- **已知假红**:bootstrap 过的工作树缺 Electron 二进制时 `process-fence-apply.test.ts`、`network-egress-fence.test.ts` 定点红,不在本线文件内,遇到不诊断。

## 证明

| 项 | 测试 / 证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| 1 | H3 探针输出(命令 + 三条 in-band 实抓件的模型面文字),无提交 | —(报告项) |
| 2 | 同一探针的「结局 → 模型面文字」表 | —(报告项) |
| 3 | `composer-tier-matrix.engine.test.ts`(21 条);四处变异实测 | 注入的档位规则被放宽,对应询问 / 拒绝格当场变放行;build 列证明三种结局分得开 |
| 4 | `memory-seam.engine.test.ts`(2 条) | 接缝不在,配置里的文件不进上下文或删了仍在,①②红;对照臂证明判官看得见「没接」 |
| 5 | H2 实测(或成立时的 `cloud-credential-hot.engine`) | 热写后仍发旧令牌 ⇒ 记录里出现 A |
| 6 | `platform-credential-error.engine` | 被退避重试 ⇒ 请求数 > 1 或耗时 ≥ 2 秒;503 臂证明计数看得见重试 |
| 7 | `naming-resume.engine` | 反向顺序留下旧名 ⇒ 续写具名失败 |
| 8 | H2 实测(或成立时的 `sidecar-stop-pending-approval.engine`) | 停止不释放 ⇒ 部件无终态或认领不放;once 臂证明调用计数是活的 |
| 9 | `websearch-copies.test.ts` 普查两网;`websearch-account-tool-table.engine` | 新副本不登记 ⇒ 网点名;注入的 deny 去掉 ⇒ kill-switch 下 `websearch` 回到表里 |
| B1–B6 | 各文件 0 fail,条数实测写回 | 各自原断言的意图 |

## 偏离记录

- 2026-11-12 · 第 3 项的宿主由 H1 改为 H2,文件改为 `packages/ui-mac/src/main/composer-tier-matrix.engine.{test,cases}.ts` · 实测嵌入式引擎里 agent 的有效规则(`GET /api/agent`)前面有 H1 不装的底座 `*: allow` 与 `.env` 询问,H1 判的会是一份生产不用的规则集(「夹具顶替供数方」);编排器也要求 E4 在嵌入式引擎上实测。能力轴改走探针插件上下文的 `permission.assert`(工具体内同一个服务),入口走引擎 HTTP 路由,身份轴走模型桩发出的真工具调用经 ext 执行闸;真 ext 以本地目录插件装进引擎(入口 `server.js` 转出 `packages/ext/src/plugin.ts`)。
- 2026-11-12 · 第 3 项 E4 实测不成立(只读档会话跑 `agent: build` 的非子任务命令 ⇒ 204、会话 agent 变成 build、零询问),按编排器裁决在 `command.ts` 的 `codepuppy(#1560)` 块里加 `codepuppy(#1573 E4)`:换助手之前以会话自己的 agent 走 subagent 权限断言。去掉它 ⇒ R6c 两条红(实测)。
- 2026-11-12 · 第 3 项两处格子在 2.x 上实测未握住,不进矩阵、交编排器:① R2「全部批准 / 请求审批 ⇒ 询问」—— 两档对 `external_directory`(`<目录>/*`)都直接放行,来源是引擎底座的 `*: allow`(只读档拒绝照常);② R11 请求审批档与只读档的询问格 —— 引擎确实建了待批请求,但 `GET /api/session/:id/permission` 编码失败(`Expected JSON value at ["data"][0]["metadata"]["policy"]`),因为 `packages/ext/src/policy/gate.ts:146` / `:199` 对没有绑定摘要的工具(插件、内置)写了 `bindingDigest: undefined`,引擎只剥掉 metadata 顶层的 undefined;桌面的审批面经 `v2.session.permission.list` 读这条列表(`packages/codepuppy-app/src/context/permission-v1-adapter.ts:163`)。R9 / R10 的身份轴与 R11 同一道执行闸,本文件不另起云 MCP / 第三方 MCP。
- 2026-11-12 · 编排器裁决(第二轮)后补齐上面两处:① R2 照现行正式版 —— v1(`origin/alpha` 的矩阵测试 R2 = ASK / ASK / DENY;v1 引擎默认 agent 的 `external_directory: { "*": "ask", <截断输出、临时、技能、引用目录>: "allow" }`)⇒ 注入给 build 与 codepuppy-ask 追加同一条规则(`externalDirectoryAsk`:引擎的 `tool-output`、解析过符号链接的 `os.tmpdir()/opencode`、注入时的出厂与已启用技能目录;注入没有配引用目录,不列);`config-injection-throat.test.ts` 与 `codepuppy-config-injection.test.ts` 机械同步 build 这一项(build 只带 permissions)。已知局限:技能翻代后新一代的目录要到下一次注入(fork)才放行,在那之前读它会问,不会静默放行。② R11 —— `gate.ts` 两处在没有摘要时不写 `bindingDigest`,补两个询问格;另加「审批请求的整条路径」一组(5 条)。坏的状态下实测事件流照常送达 `permission.asked`(事件编码时 undefined 键被丢掉),只有列表路由 500;桌面的通道源在列表失败时抛错(`permission-v1-adapter.ts:163-166`),卡片能否只凭事件出现没有实测。R10 加一格(用户在 codepuppy.jsonc 里加的本地 stdio MCP,MCP 工具默认进 Code Mode,模型经 `execute` 调);R9 不起受治理的远端 MCP,理由写在登记册 note。矩阵 15 → 21 条。
- 2026-11-12 · 第 4 项宿主由 H3 风格的 core 测试改为 H2:`packages/ui-mac/src/main/memory-seam.engine.{test,cases}.ts`(嵌入式引擎 + 模型桩,判模型请求本身;编排器要求在嵌入式引擎上量)。实测:配置里的文件进上下文;原地改写、改名替换都生效;删掉 ⇒ 新会话里没有,在跑的会话旧正文留在基线里、下一次请求带 `<system-update>` 的「不再适用」(与 v1 每步重读不同);**删掉后再写回同一路径不会被重新装载**(10 秒内的新会话都没有),不断言,交编排器(#425 的渲染器清空时应写空文件)。
- 2026-11-12 · 第 8 项实测成立,不需要改 `sidecar-stop.ts`:关掉 `start()` 的作用域时引擎的 Permission 服务把待批请求一律拒掉,运行器给这一轮写下终态;重启后(不传 `lifecycle`,不续跑)工具部件 error(aborted,「Interaction cancelled because the location shut down」)且有结束时间、助手消息 aborted(「Step interrupted」)、待批为空、`/api/session/active` 里没有它、工具零执行、会话接得住下一句。另量了编排器给的做法(先经回复路由拒绝再等收尾)与 `POST /api/session/:id/interrupt`,结局相同(后者另写 idle 与 outcome interrupted),没有采用。经 Code Mode 的 MCP 工具:真 tools/call 为 0、不挂,但 `execute` 部件以 completed 收尾(内容 Tool.Error)、助手消息不带 aborted —— 不断言,交编排器。文件:`sidecar-stop-pending-approval.engine.{test,cases}.ts`;三份引擎用例共用的宿主抽到 `packages/ui-mac/test-component/codepuppy-engine.ts`(第 3 项的矩阵同一提交改用它,21 条照旧全绿)。
- 2026-11-12 · 第 7 项成立,文件按计划(`naming-resume.engine.{test,cases}.ts`),宿主改用共用的 `test-component/codepuppy-engine.ts`(加了 `databasePath`、`platformModels` 两个选项;模型桩认得引擎的压缩请求、按模板标题回摘要,`CP-OVERFLOW-ONCE` 让第一次请求回 400 `context_length_exceeded`)。实测与计划的差别:① 0.1.24 留下的压缩只有「触发 + 已完成摘要」那种被转换(成 2.x 的压缩消息),未完成的触发被丢掉,续写时不补跑,所以 ② 改判「转换出的压缩之后续写」加「手动压缩并续写」;③ 溢出触发的压缩引擎记作 `auto`,另判这一轮真的发了压缩请求。
- 2026-11-12 · B4(编排器第四轮裁决授权 ext 修复):移植后先跑出红 —— 凭据文件在场、ext 已装,网关收到的 Authorization 恰好是注入的占位 apiKey(路由层 `packages/ai/src/route/auth.ts` 在 `model.request` 之后按 apiKey `Headers.setAll`)。凭据头移到 ext 的 `session.hook["http.request"]`(新判据 `platformRequestCredentialHeader`:请求地址在 `CODEPUPPY_BASE_URL` 之下,按路径段认)。实测顺序:http.request 拿到的是鉴权之后的请求(改后网关收到令牌,不是占位值);在那里读不到就抛 ⇒ 请求不发出、这一轮以 ext 的具名错误失败(网关零请求)。`plugin-host.test.ts` 的 P6/S5 改为触发 http.request;`platform-credential-header.test.ts` 加一条,登记条数写回实测 5(基点登记的 6 本就与实测 4 不符)。共用宿主加 `ext: false` 选项。
- 2026-11-12 · 第 6 项按计划成立(`platform-credential-error.engine.{test,cases}.ts`,5 条):读不到 ⇒ 零请求、具名、2 秒内;401 / 403 ⇒ 一次 provider.auth;503 已知的坏 ⇒ 不止一次(等到第二次请求后经 `POST /api/session/:id/interrupt` 收住,不等完整退避)。
- 2026-11-12 · 第 5 项(编排器第四轮裁决选项 1):先写 `cloud-credential-hot.engine.{test,cases}.ts`,改之前 ② 红(热应用 B 后重新连接带的仍是 A)、③ 红(删掉文件照样连上);在已接管的 `packages/core/src/mcp/client.ts` 里加 `codepuppy(#1562)` 块,远端连接的 fetch 对治理条目经 plugin 包里现成的 `governedCredentialFetch`(与 v1 `mcp/index.ts:566-567` 等价),之后 3 条全绿。`codepuppy-secret-files.ts:153-155` 的说明改成 2.x 的两处机制;登记册新增 `cloud-connector-credential-per-request`,ADR-047 保持表加一行(54 项)。core 的 MCP 相关测试(codepuppy-mcp-runtime、mcp、mcp-import-boundary、mcp-oauth)156 / 0。
- 2026-11-12 · R2 规则顺序(编排器第四轮裁决):注入追加的那条撤掉(`codepuppy-config-injection.ts` 与两份注入测试回到 R2 之前的样子,注入里留一句指向 ext 的说明),改由 ext 的 agent 变换(`packages/ext/src/external-directory-rule.ts`,在 `plugin.ts` 里于第一次 prompt 时注册)把 `external_directory` 先问 + 白名单插在引擎底座之后、所有配置规则之前,只给 build 与 codepuppy-ask。第一次 prompt 才注册,是因为 OpenCode 的配置 agent 插件在激活之后才建出 codepuppy-ask(激活时注册的变换看不到它,实测 codepuppy-ask 那一格变成放行);时机与策略目录的尾规则相同。白名单在变换里现算(技能目录读 `CODEPUPPY_FACTORY_SKILL_DIRS` 与 `CODEPUPPY_GLOBAL_DIR` 下已启用的那一代),上一轮记的「技能翻代要等下次注入」随之消失。矩阵加 5 格(四处用户放行各一台引擎 ⇒ allow / allow / deny,外加技能翻代不必重新注入),每台引擎先跑一轮 prompt(生产里第一句 prompt 总在工具调用之前)。已知的坏:规则改成追加在末尾 ⇒ 四处用户放行 4 条红。矩阵 21 → 26 条。
- 2026-11-12 · 第 1、2 项(编排器第五轮裁决选项 2,不接管上游):ext 新增 `packages/ext/src/exa-websearch.ts`(Code Puppy 自己的 exa 供应商,传输照上游:JSON-RPC `web_search_exa`、JSON / SSE、256 KiB、25 秒、integration 里的 key),在 `plugin.ts` 现有的 `websearch.transform` 里以同一个 id `add` 进去 —— 注册表按 id 存,后加的覆盖上游那份,不需要改上游文件。`isError` / JSON-RPC error ⇒ 0.1.26 的「Web search failed: the provider reported an error. Cause: …」;非 2xx ⇒ 0.1.26 的按状态归类(429 ⇒「unexpected HTTP status (HTTP 429)」);200、解析不出结果但有文本(D)⇒ 原文作为失败消息逐字交给模型(结果结构没有放原文的位置,当成一条结果就是伪装成搜索结果);没有文本 ⇒ 零条结果。2.x 的 websearch 工具把供应商失败包成「Unable to search the web for …」,ext 的 `execute.after` 在失败分支里认出这个类型并换回原话(判决里没有文案匹配)。选哪个供应商、kill-switch 的判决都没动。证明 `websearch-honest.engine.{test,cases}.ts` 7 条(起引擎前换掉进程 fetch,不出网);已知的坏在用例里(不装 ext ⇒ 塌成「没搜到」),另实测去掉改写 ⇒ 4 条红。端点与上游逐字相同由 `packages/ext/src/exa-websearch.test.ts` 钉住。登记册 `adr035-websearch` 改成现在握住的样子(L0 插件钩子)。已知局限:用户把选择设成 random 时,上游按 HttpClientError 429 做的冷却不再对 exa 生效(Code Puppy 默认选 exa,不走 random)。
- 2026-11-12 · 编排器 r5 补充(审批超时卡):先在嵌入式引擎上实测复现 —— 期限 500 ms 的一次审批到期后,经桌面适配器 `normalizeSessionMessages` 得到的工具部件,卡片模型 `toolCardHeadOf` 的 `askTimedOut` 缺席(2.x 内核块写的是英文)。按裁决只改 `packages/core/src/permission.ts` 的 codepuppy(ADR-038) 块的消息文字:照写 0.1.26 的四行(首行「审批请求等待 N 秒无人应答,已按 fail-closed 结束:本次操作**没有**被放行。」、请求的动作与资源、常见原因、回到该会话页重试的指引),卡片与它的正则不动。新证明 `permission-ask-timeout.engine.{test,cases}.ts`(改前红,改后绿;另判模型读到的 message 逐字是那四行,2.x 把工具失败包成 `{"error":{"type":"tool.execution","message":…}}` 是上游的统一形状)。卡片契约测试 `tool-card-provenance-gates.test.ts` 的 `#1214` 两条原本 import 已删的 v1 引擎(`opencode/src/permission/index`),改为 import 2.x 内核块的 `unansweredError`(53 条全绿,登记条数不变);`packages/ext/src/policy/ask-deadline.test.ts` 两处断言写的是英文措辞,机械同步成中文首行。
- 2026-11-12 · 第 9 项普查(`websearch-copies.test.ts` 6 → 9 条):网 A 实测比计划多三类文件 —— `packages/core/src/plugin/provider/opencode.ts`(OpenCode Console 托管搜网,连了 Console 账户且远端开了才注册)、`packages/core/src/plugin/internal.ts`(内置插件清单)、`packages/core/src/config/plugin/policy.ts`(托管策略重载),都逐条分类写进表里。
- 2026-11-12 · B1 按计划:`server.test.ts` 的 `#1443` 组辅助函数改读 2.x 注入的 `{ config: { content } }`(先证明 agents 非空),归属快照取 ext 在 mcp.transform 里同形的 `{ mcp: <servers> }`;四条照判(kill-switch 那条就是已知的坏),整文件 25 / 0。
- 2026-11-12 · 变异实测从两处改为三处:去掉 E4 断言(R6c 两条红)、`codepuppy-ask` 的 `shell` 改 allow 并删掉只读档的 `subagent` 规则(6 条红)。
