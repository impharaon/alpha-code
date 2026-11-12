---
id: PLAN-1662-opencode2
title: OpenCode 2 换代 实施计划
summary: alpha-code#1662 各实施线的分段计划;目前含 L4(#1666)Unit B(具名失败原因到桌面)与 Unit C(MCP 与内置重名、子任务与附件、命令模型优先级、工具网络失败标记);以及整合 Unit 1(真策略进 ext、登记册握满、引擎开启回合的审阅 diff、接缝文档补记)
kind: plan
status: active
spec: ""
design: docs/design/2026-11-08-1662-opencode2-generation-switch-baseline.md
owners: [alpha-code desktop maintainers]
last_reviewed: 2026-11-12
---

# PLAN-1662-opencode2｜OpenCode 2 换代 实施计划

由实施会话在计划阶段写,编排器核对后由同一会话实施。每个交付段一节;旧段留作证据。决定只链接、不重述;实施中偏离本段,在同一个提交里改本段。

## Unit B — named failure causes(L4 #1666:具名失败原因到桌面)

- 依据:无 spec。Issue [alpha-code#1666](https://github.com/impharaon/alpha-code/issues/1666) 正文(2026-11-10T10:35:55Z 版);裁决评论 [6737732975](https://github.com/impharaon/alpha-code/issues/1666#issuecomment-6737732975) 第 5 项、[6737930969](https://github.com/impharaon/alpha-code/issues/1666#issuecomment-6737930969)(`l1r-net-failure-settle` 归 L4)、[6756103246](https://github.com/impharaon/alpha-code/issues/1666#issuecomment-6756103246) 第 2 项(选 (b):前缀与解析函数只在契约模块定义一次)。登记册 [`codepuppy-authority-registry.json`](../../architecture/codepuppy-authority-registry.json) 的 `mcp-named-start-failures`、`mcp-net-failure-runtime`、`l1r-net-failure-settle`;[ADR-047](../../../.claude/rules/adrs/ADR-047-opencode2-engine-generation.md)「精确接管面」;[接缝冻结](../../design/2026-11-09-1662-lane-seams.md) §4「MCP 状态种类」与 I6(契约模块只许加法)。以上均取 `lane/1666-l4-takeover` @ `e71d98f171`。
- 核对:`33d68fd266` · 编排器 · 通过(实施轮裁决:invalid_url 按计划;成对接管 retry 测试;头部 / 分块超时按 v1 归 timeout;AC1 超时本段修)。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/schema/src/codepuppy-net-failure.ts` | 只加导出:MCP 非网络层的启动失败名(workspace_missing / dependency_missing / spawn_failed / handshake_timeout / auth / protocol / transport)与九个 `NetFailureLayer` 合成的登记码类型 `CodepuppyFailureCode`、`isCodepuppyFailureCode`;生产方 `withFailureCode(code, text)`,消费方 `parseFailureCode(text) → { code, text } \| undefined`(交给 L6)。前缀的字面形状只在本模块(拟定 `[codepuppy:<code>] `);解析只认登记码,普通文本、未登记的码、长得像的前缀一律 `undefined`(模块已有的 I4 纪律)。分类器只加一条规则(编排器实施轮第 3 项):`code: "Timeout"` 且不带 cause ⇒ timeout。 |
| `packages/core/src/mcp/codepuppy-startup.ts` | `StartFailure.code` 改用 `CodepuppyFailureCode` 类型:引擎侧产出一个没登记的码,typecheck 就红。 |
| `packages/core/src/mcp/client.ts` | `ConnectError.code` 改为 `Schema.declare(isCodepuppyFailureCode)`,让源头产出的码同样受登记约束(否则 connection.ts 把 `string` 交给 `StartFailure` 过不了 typecheck)。 |
| `packages/core/src/mcp/index.ts` | `failed` 与 `closed` 两个事件写 `Mcp.Status.Failed` 时,`error` 经 `withFailureCode(cause.code, …)` 加前缀(`codepuppy(#1563, #1564)` 标注块内)。`closed` 先算 cause 再写状态。`needs_auth` 不动;`Mcp.Status` 形状不变。 |
| `packages/core/src/mcp/connection.ts` | 去掉非法 URL 分支上的 `{ code: "invalid_url" }`(第 173 行),恢复成上游原样。行为不变:没有 cause 本来就不会重连,上游原文「Invalid MCP server URL: …」已经说明原因。v1 也没有给它具名(当时记作 `transport`)。这样上游 `mcp.test.ts:1891` 的逐字断言不用改,也不必接管那个 3500 行的上游测试。 |
| `packages/core/src/session/to-session-error.ts` | 新的最小接管,只动 Transport 分支(第 52–54 行):用 `classifyNetFailure(cause.reason, engineNetFailurePath(cause.reason.url, process.env))` 分类,认出了层,就给 `unreachable()` / `providerError()` 的 `message` 加该层的前缀;认不出就保持原文。`type` 与其余字段不变。 |
| `packages/core/test/codepuppy-net-failure-settle.test.ts`(新,Code Puppy 自有) | 替代 v1 的 `packages/opencode/test/session/codepuppy-net-failure-settle.test.ts`。错误来自真实的 `@opencode/ai` 路径,不是手搓:真 `RequestExecutor.fetchLayer` 请求一个已关闭的本机端口,得到 ECONNREFUSED;同一执行器的映射处理原生 DNS 失败,得到 ENOTFOUND,走 `unreachable` 子分支。另加 ai `http.ts:99` 头部计时器形状 ⇒ timeout(实施轮第 3 项),和一条无码的传输失败(不加前缀,原文不变)。 |
| `packages/core/test/codepuppy-mcp-runtime.test.ts` | AC2 加一条:在生产 `Mcp.Service.servers()` 上,缺命令 / 缺工作目录 / 被拒的远端三台的 failed 状态,经 `parseFailureCode(status.error)` 分别读出 dependency_missing / workspace_missing / tcp。AC1 断言跑完后杀掉 `hang` 进程(编排器实施轮第 4 项);`until` 的类型改为对 R 泛型,修掉本文件既有的 7 条 typecheck 错误。 |
| `packages/core/test/fixture/codepuppy-mcp-startup-stdio.ts` | 加 `CODEPUPPY_MCP_PID_FILE`:启动时写下自己的 pid,测试据此杀掉挂起的服务器,而不是等它的握手超时。 |
| `packages/core/test/session-runner-retry.test.ts`(上游测试,随源文件接管) | 第 122–129 行 `toSessionError` 那条断言写的是旧行为(ENOTFOUND / ECONNREFUSED 的逐字 message),这正是本段替换掉的行为。只改这两处期望:改为经 `parseFailureCode` 读出码 dns / tcp 和原文。 |
| `packages/schema/test/codepuppy-net-failure.test.ts` | 加用例:每个登记码都能往返;上游原文、未登记的码、像前缀却不合格式的文本都解析为 `undefined`。 |
| `scripts/north-star-guard.sh` | `UPSTREAM_EXCLUDES` 加两条:`packages/core/src/session/to-session-error.ts`、`packages/core/test/session-runner-retry.test.ts`(先例:oauth 的 page.ts 与它的测试成对登记)。 |
| `.claude/rules/adrs/ADR-047-opencode2-engine-generation.md` | 接管表加 to-session-error 一行(为什么挂不了钩子:`session.hook.retry` 的 `error` 只读;守卫;回滚;归属)。`mcp-named-start-failures`、`l1r-net-failure-settle` 从未握住表移到权威保持表,两处计数同步(32→34、15→13)。 |
| `docs/architecture/codepuppy-authority-registry.json` | `mcp-named-start-failures`:去掉 `blocked`,补机制文件与两条证明测试,lane 改为 L4。`mcp-net-failure-runtime`:补新状态用例,删掉指向接缝问题的 note。`l1r-net-failure-settle`:去掉 `blocked`,机制文件改为 `packages/core/src/session/to-session-error.ts`,补证明测试,`takeovers` 保留 v1 两条并加上 2.x 文件,lane 改为 L4。 |
| `scripts/gate-files.tsv` | `codepuppy-mcp-runtime.test.ts` 8→9;`packages/schema test/codepuppy-net-failure.test.ts` 17→新条数;v1 `packages/opencode test/session/codepuppy-net-failure-settle.test.ts`(4)按已有格式写退役注释,并新增 `packages/core test/codepuppy-net-failure-settle.test.ts` 一行。 |

### 顺序

1. **契约**:改 schema 模块与 schema 测试,同步 gate-files 的 schema 那行。跑 `packages/schema` 的 `bun test test/codepuppy-net-failure.test.ts` 和 `bun run typecheck`。
2. **MCP**:改 codepuppy-startup.ts、connection.ts、index.ts,加 runtime 测试新用例;改登记册两项、ADR 保持表一行和 gate-files 的 runtime 那行。跑 `packages/core` 的 `bun test test/codepuppy-mcp-runtime.test.ts test/mcp.test.ts`、`bun run typecheck`。反向臂:去掉 index.ts 的 `withFailureCode`,新用例必须变红,然后用 `git restore` 恢复。
3. **会话结算**:改 to-session-error.ts,加新 settle 测试,改上游 retry 测试那两处期望;同步守卫两条排除、ADR 接管行与保持表、登记册 `l1r-net-failure-settle`、gate-files 的退役与新增行。跑 `packages/core` 的 `bun test test/codepuppy-net-failure-settle.test.ts test/session-runner-retry.test.ts test/session-error.test.ts test/session-execution.test.ts test/session-runner.test.ts`、`bun run typecheck`;再跑 `packages/ext` 的 `bun test src/policy/authority-registry.test.ts`(生产那条在所有 blocked 项裁决前按设计是红的,判据是三项 id 不再出现在问题清单里),以及 `packages/ui-mac` 的 `bun test src/main/gate-file-registry.test.ts`。反向臂:去掉 Transport 分支的分类调用,新 settle 测试的前两条必须变红,然后恢复。

### 风险

- **上游测试里写死旧文本**:逐一核过。必须改的只有 `session-runner-retry.test.ts:122-129`,随接管登记。`mcp.test.ts:1891`(非法 URL 逐字)靠改 connection.ts 避开。其余断言不受影响:`mcp.test.ts:876,3445` 用的是 `stringContaining`;`session-runner.test.ts:634-641`、`session-execution.test.ts:46`、`session-error.test.ts:44,326,344` 里的传输失败不带可分类的码,或者只断言 `type`。第 3 步跑这几个文件确认。
- **前缀出现在桌面以外的地方**:模型调已失败服务器的工具时看到的文本(`index.ts:93` 的 `unavailable()`)、TUI、`codemode/tool.ts:152` 与 `step.ts:127` 的工具失败文本都会带上前缀。这是选 (b) 的固有结果;桌面由 L6 经解析函数剥掉前缀。本段不为此加代码。
- **分类器认不出 2.x 的头部 / 分块超时**:实测 `http.ts:99/124` 产出 `code: "Timeout"` 且不带 cause 的 TransportError,`classifyNetFailure` 返回 `undefined`,所以不加前缀;走 Effect 超时那条路(cause 是 `TimeoutError`)能认出 `timeout`。v1 把 AbortSignal 超时算作 `timeout`。本段按派发书只用现有分类器,不改它。若要与 v1 对齐,可以在同一模块加一条识别规则,改动一行,需编排器决定。
- **运行时形状**:测试跑在 Bun 上,生产引擎跑在 Electron utilityProcess(Node/undici)里。执行器在两种运行时下都从 cause 链取原生错误码,分类器也沿 cause 走。本段没有重测 Node 真栈(ui-mac 的真栈测试不在本段范围)。
- **基线红**:`codepuppy-mcp-runtime.test.ts` 的 AC1「ok is connected and listed while hang is still pending」在本机连跑两次都超过 Bun 默认的 5 s(3/3 个 expect 都过了,时间耗在断言之后;当时负载约 20)。新用例与它独立;实施时如果仍然红,按基线问题报告,不去修它。
- **池化连接**:`pool.ts:163/316` 交回的失败不带 cause,所以不会加前缀。Code Puppy 从不设置 `pool`(ui-mac/ext 的 src 里 0 处),因此只记作观察项。
- **文件数**:约 13 个,超出预估的 6–10,多出来的是接管、登记册、ADR、gate-files 这类机械同步。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| `mcp-named-start-failures` | `codepuppy-mcp-runtime.test.ts` AC2 新用例(生产 `Mcp.Service.servers()`,读出 dependency_missing / workspace_missing);既有用例「a missing working directory, a missing command, a refused remote」 | 去掉 index.ts 的前缀,`parseFailureCode(status.error)` 返回 `undefined`;去掉源头的具名分类,读出的码不对 |
| `mcp-net-failure-runtime` | 同一新用例里被拒的远端读出 `tcp`;既有用例「an auth answer stays failed」 | 不调分类器时码是 `transport`;不加前缀时读不出任何码 |
| `l1r-net-failure-settle` | `codepuppy-net-failure-settle.test.ts`:真 fetch 被拒,`type` 仍是 `provider.transport`,读出 `tcp` 和原文;原生 DNS 失败读出 `dns`,且保留 `unreachable` 文案;无码的失败原文不变、没有码 | 去掉 Transport 分支的分类调用或前缀,前两条读出 `undefined`;对认不出的失败乱加前缀,第三条变红 |
| 契约(三项共用) | `packages/schema/test/codepuppy-net-failure.test.ts` 新用例 | 解析不认登记码,往返失败;解析接受任意 `xxx:` 文本,负例变红 |

### 偏离记录

- 2026-11-12 · 分类器加一条 `code: "Timeout"` 无 cause ⇒ timeout 的规则,及对应 schema 用例 · 编排器实施轮第 3 项新授权(v1 对齐) · `a60804124d`(该提交未同步本段,在此补记)。
- 2026-11-12 · 多改 `client.ts`(`ConnectError.code` 的类型)· `StartFailure.code` 收窄为登记码后,源头的 `string` 过不了 typecheck · 本提交。
- 2026-11-12 · settle 测试加头部计时器 ⇒ timeout 一条(共 4 条)· 随实施轮第 3 项 · 本段会话结算提交。
- 2026-11-12 · 多改 stdio 夹具与 runtime 测试的 AC1 收尾、`until` 类型 · 编排器实施轮第 4 项:AC1 收尾在等 `hang` 的握手超时(收尾时长随 `timeout.startup` 走:8 s ⇒ 10.3 s,默认 30 s ⇒ 32 s);同文件既有的 7 条 typecheck 错误一并修掉 · 本提交。

## Unit C — MCP/builtin collision, subtask & attachment, command model priority, tool net-failure metadata(L4 #1666)

- 依据:无 spec。Issue [alpha-code#1666](https://github.com/impharaon/alpha-code/issues/1666) 正文(2026-11-10T10:35:55Z 版);裁决评论 [6756103246](https://github.com/impharaon/alpha-code/issues/1666#issuecomment-6756103246) 第 4 项(MCP 与内置撞名)、[6737930969](https://github.com/impharaon/alpha-code/issues/1666#issuecomment-6737930969)(`l1r-subtask-attachment-policy` E6/E7、`l1r-command-model-priority` 归 L4);编排器 Unit C 派发书(webfetch 网络失败标记要握住)。登记册 [`codepuppy-authority-registry.json`](../../architecture/codepuppy-authority-registry.json) 的 `adr041-collision-rejection`、`l1r-subtask-attachment-policy`、`l1r-command-model-priority`;[ADR-047](../../../.claude/rules/adrs/ADR-047-opencode2-engine-generation.md)「精确接管面」。以上均取 `lane/1666-l4-takeover` @ `e737b760ca`。基线:`register-policy.test.ts` 35 过;core `config/command`、`config/reload`、`schedule`、`mcp-attach`、`mcp-instructions` 共 101 过;`mcp.test.ts` 107 过。
- 核对:`6bc34b3ce5` · 编排器 · 通过(撞名按 2.x 实例测;`adr041-collision-rejection` 本轮保持 blocked、补机制与测试,整合时翻;「明确选定」取会话 `model`,依赖 L6 每次发送前把会话模型切到所选)。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/core/src/tool/mcp.ts`(新的最小接管) | **第 1 项**。注册转换里,一个发现到的 MCP 工具,如果它的有效名(沿用上游 `name(server, tool)` → `effectiveName`)已经被更早的转换注册,就拒掉它、不注册,并用层内的 fork 运行时记一条 `logError`(与 `mcp/index.ts` 的 `refuseCollisions` 同法)。标注块 `codepuppy(ADR-041)`。原因:上游 `editor.add` 是后写覆盖(`tool.ts:213,377`),转换按注册顺序执行(`state.ts:197`)。 |
| `packages/core/src/config/plugin/command.ts`(新的最小接管) | **第 3 项**。直接执行路径(第 99–103 行):命令带 agent 或 model 时读一次会话;会话已有 `model`(用户选定的)时不再 `switchModel`,其余照旧。子任务路径(第 80 行):子会话模型改为 `parent.model ?? model ?? selected.info?.model`,用户选定的模型排在命令和 agent 推荐之前。会话里有 model 时,运行器先用它、不用 agent 的模型(`runner/model.ts:79-98`),所以切换 agent 不会盖掉用户的选择。标注块 `codepuppy(#1560)`。 |
| `packages/ext/src/policy/display.ts`、`packages/ext/src/policy/index.ts` | **第 4 项**,不接管 core。在 `seal()` 已有的 `execute.after` 里(`index.ts:196`),对 error 状态调一次新的 `attachNetFailure(event)`:用 `classifyNetFailure(event.error.error ?? event.error, engineNetFailurePath(input.url, process.env))` 分类;认出了层,就在替换后的 `Tool.Error` 的 metadata 上加 `codepuppyNetFailure: { layer, code }`(v1 的键,渲染层 `tool-card-model.ts:1050` 读的就是它),原有 metadata 保留;认不出就不动。数据是结构化的,不用文本前缀。可行的依据:`ToolFailure` 继承 `Tool.Error`(`ai errors.ts:245`),所以 webfetch 保留了原因的失败(`webfetch.ts:196`)能走到 `execute.after`(`tool.ts` 的 `catchTag("Tool.Error")`);替换后的 error 的 metadata 由 `step.ts:127` 写进工具部件;display 现在就是这样写快照的(`display.ts:70-76`)。分类器从 schema 契约模块 import(相对路径,与 `display.ts:12` 引 tool-identity 同法)。 |
| `packages/ext/src/policy/policy-host.cases.ts` | 宿主图加 `SubagentJob.node`:真 `subagent` 插件需要它(`subagent.ts:73`)。 |
| `packages/ext/src/policy/register-policy.test.ts` | `setup` 加 `internal` 选项:让上游真插件和 builtins 一起、在扩展之前激活,包法同 `internal.ts:316`,插件 effect 用测试的上下文 provide,因为激活时只给 Scope(`plugin.ts:83-87`)。新增:**E6** 三条、**E7** 两条、**第 4 项**两条(见「证明」)。 |
| `packages/core/test/codepuppy-mcp-tool-collision.test.ts`(新,Code Puppy 自有) | **第 1 项**。生产 `Tool.node` + `McpTool.node`,`Mcp` 用替身(上游 `mcp.test.ts:619` 的接法)。 |
| `packages/core/test/codepuppy-command-model-priority.test.ts`(新,Code Puppy 自有) | **第 3 项**。沿用上游 `config/command.test.ts` 的宿主:真 Command、Session、Agent、SubagentJob 服务,`SessionExecution` 用 noop。 |
| `docs/architecture/codepuppy-authority-registry.json` | `l1r-subtask-attachment-policy`、`l1r-command-model-priority` 去掉 `blocked`,补机制与测试。新增 `tool-net-failure-metadata`(决定:「A tool call that fails at the network layer carries Code Puppy's classification (layer and code) in its metadata (#1572 AC4).」;takeovers 填 v1 的 `packages/opencode/src/session/processor.ts`)。`adr041-collision-rejection` 的 blocked 原因补上 MCP 与内置撞名的机制与测试,其余不动(见风险第 1 条)。 |
| `.claude/rules/adrs/ADR-047-opencode2-engine-generation.md` | 接管表加 `tool/mcp.ts`、`config/plugin/command.ts` 两行;保持表加三行、未握住表减两行,计数改为 37 / 11;`adr041-collision-rejection` 的原因同步。 |
| `scripts/north-star-guard.sh` | `UPSTREAM_EXCLUDES` 加 `packages/core/src/tool/mcp.ts`、`packages/core/src/config/plugin/command.ts`,并写明理由。 |
| `scripts/gate-files.tsv` | `register-policy.test.ts` 35 → 新条数;新增两个 core 测试的行;v1 的 `packages/opencode test/session/codepuppy-subtask-attachment-policy.test.ts`(4)写退役注释,指向 E6/E7;Unit B 写的 settle 退役注释里「webfetch 无对应用例」改为指向第 4 项的用例。 |

### 顺序

1. **第 1 项**:改 `tool/mcp.ts`、加新测试,同步守卫、ADR、登记册与 gate-files 各一处。跑 `packages/core` 的 `bun test test/codepuppy-mcp-tool-collision.test.ts test/mcp.test.ts test/mcp-attach.test.ts test/mcp-instructions.test.ts test/schedule.test.ts` 和 `bun run typecheck`。反向臂:去掉检查,「内置先注册」那条必须变红,然后恢复。
2. **第 3 项**:改 `command.ts`、加新测试,同步守卫、ADR、登记册与 gate-files。跑 `bun test test/codepuppy-command-model-priority.test.ts test/config/command.test.ts test/config/reload.test.ts` 和 typecheck。反向臂:撤掉接管,「已选定」两条与子任务那条必须变红,然后恢复。
3. **第 2 项**:改宿主(`SubagentJob.node` 与 `internal` 选项),加 E6/E7,同步登记册、ADR 与 gate-files(含 v1 退役)。跑 `packages/ext` 的 `bun test src/policy/register-policy.test.ts`,外加 `ask-deadline`、`risk`、`identity` 三个用同一宿主的测试文件,确认宿主改动没有带坏它们。
4. **第 4 项**:改 `display.ts` / `index.ts`,加两条用例,同步登记册、ADR、gate-files。跑 `register-policy.test.ts`。反向臂:去掉 `attachNetFailure` 调用,tcp 那条必须变红,然后恢复。
5. 收尾:跑 ext 的 `authority-registry.test.ts`(问题清单里只剩 blocked 项,且不含本段三项)、ui-mac 的 `gate-file-registry.test.ts`(只有原有的 3 红)、`north-star-guard.sh --print-takeover`。

### 风险

- **第 1 项的事实修正,以及登记状态**:裁决举的例子 `apply_patch` 是 v1 的名字,2.x 已改名为 `patch`(`v1-migration.bun.ts:996`)。2.x 上真正走得到的撞名是:带 `namespace: "opencode"` 注册的 17 个内置工具(`tool/plugin/{artifact,mcp-resource,opencode,schedule}.ts`)(如 `opencode_session_rename`、`opencode_worktree_create`)对上名为 `opencode` 的 MCP 服务器;`experimental_image_generate` 对上服务器 `experimental` 的工具 `image_generate`。测试用前一种。`adr041-collision-rejection` 按它现在的 blocked 原因,要等你整合时登记 L3 的 fan-out 才能翻成已握住,所以本段只更新原因、不翻状态。你想现在翻的话,说一声即可。
- **第 1 项的顺序**:内置工具的转换如果注册在 MCP 之后,上游本来就是内置赢;本段补的是「内置先注册、MCP 后注册」这一序。测试两种顺序都钉。上游 `mcp.test.ts` 里「插件在 MCP 之后覆盖 MCP 工具」那条是上游有意保留的(后写的覆盖 MCP),本段不碰,跑一遍确认。
- **第 1 项的日志**:转换是同步的,所以拒绝日志要 fork 出去写。每次重建都会再记一次,与 `index.ts` 的 `refuseCollisions` 相同。
- **第 3 项的前提**:「用户明确选定的模型」按裁决原话取会话的 `model`。2.x 上它只经 create / `switchModel` 写入(用户、命令、子任务都会写)。一个用户从没选过模型的会话,第一次跑带模型的命令后,这个模型此后也算「已选定」;这是取会话 `model` 的固有结果,也意味着桌面要在用户选模型时写入会话 model(L6 的契约,不在本段)。
- **宿主能不能跑真插件**:真 `subagent` 插件要能一路走到它自己的权限检查(`subagent.ts:145`),这需要 `general` agent 能解析、Config 可读;真 webfetch 要 HttpClient,宿主里有 `LayerNodePlatform.httpClient`。E6 用替身就证明不了「排在上游检查之前」,所以真插件激活不了时,我停下报告,不换替身。第 4 项允许退一步:换一个同样包法的内置工具(真 Effect HTTP 请求 + `new ToolFailure({ message, error })`),改动记入偏离。
- **E7 的入口**:用 `SessionPrompt.prepare`(`prompt.ts:34`,`session.ts:171` 的 `Session.prompt` 就调它),不走 `Session.prompt`,因为后者的准入外壳要 Instance,宿主里没有。物化附件就发生在 `prepare` 里。
- **第 4 项的范围**:按 v1 的做法,任何工具失败都分类,不只限 webfetch(v1 `processor.ts` 的 `failToolCall`);认不出就不加,遵守模块的 I4 纪律。被拒的调用到不了 `execute.after`,不受影响。
- **文件数**:约 11 个,在预估之内。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| `adr041-collision-rejection`(MCP 与内置) | `codepuppy-mcp-tool-collision.test.ts`:内置 `opencode_session_rename`、`experimental_image_generate` 先注册时,MCP 服务器 `opencode` / `experimental` 的同名工具被拒,注册表在这两个名字下放的是内置;内置后注册,结果相同;近似名 `opencode_session_renamed`(MCP)照常注册 | 去掉检查,内置先注册的那一序里 MCP 覆盖内置:名字下放的是 MCP 工具 |
| `l1r-subtask-attachment-policy` E6 | `register-policy.test.ts`,真 `subagent` 插件:① Code Puppy deny `builtin::subagent` 时,`callRaw` 得到具名拒绝,待批请求为零、子会话为零;② Code Puppy ask,且 agent 规则也对 `subagent` ask 时,第一条待批是 Code Puppy 的身份请求,拒绝后从未出现上游的 `subagent` 请求,子会话为零;③ 反向臂:不装策略时,待批的是上游 `subagent` 那一条 | 策略不在上游检查之前跑:①会建出子会话或出现上游请求;②第一条待批是上游的;③证明这个判据分得清两种请求 |
| `l1r-subtask-attachment-policy` E7 | `register-policy.test.ts`:`SessionPrompt.prepare` 带一个真文件附件,同时禁用 `builtin::read`、agent 规则 deny `read`;探针插件数到的 `execute.before` 与 `permission` evaluate 都是 0,附件字节完整;前提臂:一次真 `callRaw` 让计数加 1 | 有人把工具或权限调用接进附件物化:计数大于 0,或附件被拒;前提臂证明计数器不是瞎的 |
| `l1r-command-model-priority` | `codepuppy-command-model-priority.test.ts`:已选定 + `command.model` 时不调 `switchModel`、照常发 prompt;已选定 + agent 带模型时同样不调;未选定时用命令模型 `switchModel`(上游行为保留);子任务命令下子会话模型等于父会话选定的;父会话未选定时用命令模型 | 撤掉接管:前两条会调 `switchModel`,子任务那条拿到的是命令模型 |
| `tool-net-failure-metadata`(#1572 AC4) | `register-policy.test.ts`,真 webfetch 请求刚关掉的本机端口:调用失败,error 的 metadata 带 `codepuppyNetFailure = { layer: "tcp", code: "ECONNREFUSED" }`,且不含 URL;非网络失败(`ftp://` 被 `assertHttpUrl` 拒)不带这个键 | 去掉 `attachNetFailure`:第一条缺键;对认不出的失败乱加:第二条变红 |

### 偏离记录

- 2026-11-12 · 第 1 项的测试读「注册表在该名字下放的是哪一个」(描述区分),不执行工具、不数 MCP 调用 · Code Mode 工具(`codemode: true`,真内置与 MCP 工具都是)不能按名字直接执行(`snapshot.execute` 回「No tool named …」);Code Mode 执行的就是该名字下注册的那一个 · 第 1 项提交。
- 2026-11-12 · 第 2 项:`internal` 里同时激活上游 `AgentPlugin`(否则 `general` 子 agent 不存在,`subagent.ts` 在权限检查之前就以「Unknown agent」失败);宿主另导出 `AgentPlugin` / `SubagentTool` / `WebFetchTool` / `SessionPrompt`;E7 前提臂对 ask 回 once(拒绝会在晚注册的探针钩子之前结束调用链,数不到 `execute.before`)· 第 2 项提交。

## Unit E — hold the four gaps unit D exposed(L4 #1666)

- 依据:编排器 Unit E 派发书(四项都「握住」;owner 2026-11-09 原话见派发书);Unit D 交回 `5f147ef650`、`c04d96466d`、`658d6c1f4c`;登记册 `mcp-reconnect-backoff`、`mcp-declared-tools-before-connect` 的 note。基于 `658d6c1f4c`。
- 核对:编排器派发即核对(本段与实现同轮)。

### 改动与证明

| 项 | 文件 | 改什么 | 证明(反向臂) |
| --- | --- | --- | --- |
| 1 tools/list 401 不重试 | `core/src/mcp/client.ts`、`connection.ts` | `failure()` 把 SDK 原错误挂在 `cause` 上;导出带 SDK 提示的命名函数(原 `startFailure`,先解开 `cause`),`connection.ts:232` 的 tools/list 分支改调它 | `codepuppy-mcp-runtime.test.ts`:tools/list 回 401,15 分钟(TestClock)后仍只 1 次请求、状态带 `auth`;去掉提示 ⇒ 2 次 |
| #1645 日志不含密文 | 同上测试 | 远端配置带 `Authorization` 头,401 失败的日志不含令牌与头名 | 把令牌塞进报错原文的对照臂证明扫描有效 |
| 2 真实 Office 命令认得出随包声明 | `core/src/mcp/codepuppy-first-party-mcp.ts` | 模板里 `{workspace}` 那一位接受标记本身或绝对路径(main 自己的契约,`office-advisories.ts:188`),core 声明与 ext 授权共用这一个判断 | 随包 `tools.json` + main 写的命令形状:标记与替换后的目录都拿到声明;ext 的 `toolFacts` 给出 `codepuppy-bundled`;旧比较 ⇒ 替换后为空。之后补真 python 跑真 `server.py` 的身份对照 |
| 3 AC6 定义变了的调用响亮失败 | `core/src/tool/mcp.ts` | 调用前把提供时的定义与当前列出的同名工具比(`sameTool`,同 #1565),不同 ⇒ 具名失败、不执行 | 新测试:服务换代后同名工具 schema 变了 ⇒ 旧定义下的调用具名失败、运行时零调用;定义不变 ⇒ 执行;去掉比较 ⇒ 第一条红 |
| 4 子任务命令过工具闸 | `core/src/config/plugin/command.ts` | 建子会话前走 `subagent` 工具同一条权限路径(`ctx.permission.assert`,action 取 `SubagentTool.name`,resources 为子 agent,同 `subagent.ts:145`);Code Puppy 停用 `subagent` 时 ext 追加的 deny 规则(`catalog.ts:45`)让它被拒,core 不另写策略 | `register-policy.test.ts` 真宿主:停用 `builtin::subagent` ⇒ `/review`(subtask)具名失败、零子会话;放行 ⇒ 建出子会话;不装 ext ⇒ 建出子会话;去掉这次 assert ⇒ 第一条红 |

同步:登记册(`mcp-reconnect-backoff`、`mcp-declared-tools-before-connect` 的 note 收口;`l1r-subtask-attachment-policy`、AC6 所属条目补测试)、ADR-047 保持表、gate-files 条数与退役注释。

### 偏离记录

- 2026-11-12 · #1645「日志不含密文」未承接:按 v1 样本让拒绝方的正文带令牌,实测正文原样进了 `client.ts:280`、`:406/:412` 与 `index.ts:497` 三处日志和公开的 failed 状态文本,按派发规则不放宽断言、交回;第 1 项提交只保留 401 不重试那条 · `1cd971615e`。
- 2026-11-12 · 第 2 项另加 ext `identity.test.ts` 一条(随包 tools.json + 替换后的命令 ⇒ `codepuppy-bundled`),gate-files 该行 16 → 17 · `15b8f87095`。
- 2026-11-12 · 第 3 项另立登记册条目 `mcp-generation-changed-call`(原无 AC6 条目)· `9ddff98c34`。
- 2026-11-12 · 第 4 项同步改了自己的 `codepuppy-command-model-priority.test.ts` 子任务用例的宿主(权限 assert 放行);宿主另导出 `ConfigCommandPlugin` / `Command` / `Config` / `ShellSelect` / `ConfigSchema` · 第 4 项提交。

## Unit F — no remote text in logs or status; review diff for engine-started turns; project-wide file events(L4 #1666)

- 依据:编排器 Unit F 派发书及其补充(第 2、3 项多接管两个上游文件,owner 2026-11-12 原话经编排器转达:「同意，多接管两个上游文件，需要再唯一权威中记录多接管的内容。」);基于 `a6021d654c`。
- 核对:编排器派发即核对(本段与实现同轮)。

### 改动与证明

| 项 | 文件 | 改什么 | 证明(反向臂) |
| --- | --- | --- | --- |
| 1 远端正文不进日志与状态 | `core/src/mcp/client.ts`、`connection.ts` | 只给日志与 failed 状态用的「无正文描述」:HTTP 失败只留 `HTTP <状态>`,本地进程退出只留退出码(不带 stderr 尾巴);`client.ts:280`、`:406/412` 的日志与连接、tools/list 两处 failed 状态都用它;`index.ts:497` 记的就是这段状态 | `codepuppy-mcp-runtime.test.ts`:远端 401 正文带 `synthetic-secret-1645` ⇒ 每条日志与 failed 状态都没有它、状态仍带 `[codepuppy:auth]` 与 `HTTP 401`;本地服务器往 stderr 写令牌后退出 ⇒ 同样没有;换回当前代码 ⇒ 出现 |
| 2 引擎合成消息开启的回合也能取 diff | `core/src/session/diff.ts`(新接管) | `resolve` 接受 `synthetic` 为锚点;回合起点把 `synthetic` 与 `user` 一起算作开启回合的消息 | 新测试走真 Session 服务:`user, assistant, idle, synthetic, assistant(改 b.txt), idle` ⇒ 从 synthetic 取得 b.txt、从 user 仍得前一回合;之后再来一个 user 回合也不影响;上游原文件 ⇒ 400 |
| 3 整个项目的文件变化事件 | `core/src/filesystem/location-watcher.ts`(新接管)、新 `core/src/filesystem/codepuppy-project-watch.ts` | 主进程打开的 `OPENCODE_EXPERIMENTAL_FILEWATCHER`(0.1.26 的开关,`ui-mac/src/main/server.ts:445` 默认开、尊重用户显式关闭)为真时,再订一个 `location.directory` 的目录监视(忽略 0.1.26 的那张表 + 配置的 watcher.ignore + 家目录保护名),发 `filesystem.changed`;上游测试不设开关,行为不变 | 新测试用真临时目录:增、改、删一个文件和一个子目录里的文件 ⇒ 各有对应种类的事件;`.git/`、`node_modules/` 下 ⇒ 无;上游原文件 ⇒ 无;开关关 ⇒ 无。后端:Parcel(darwin 为 fs-events) |

同步:两条新接管进守卫清单与 ADR-047 接管表(理由「界面与当前正式版一致」,附 owner 原话与日期);登记册两条新条目(同样附原话);gate-files 新增行。

### 偏离记录

- 2026-11-12 · 第 2 项另改了 `boundaries` 的类型(加 `synthetic`),并另加「之后再来一个 user 回合」一臂;只改锚点不改回合起点时这条红 · `e27bec1704`。
- 2026-11-12 · 第 3 项的测试按「每个动作都收到对应种类的事件」断言,不断言「恰好一条」(fs-events 会把创建与写入合并或拆分,逐条计数不稳),忽略目录按「零事件」断言 · 第 3 项提交。

## Review R1 fixes(L4 #1666;Codex 审查 gpt-6-astra,编排器裁定 9 收 1 弃)

- 依据:`~/.claude/orchestration/alpha-code/1662/l4-review.r2.out`(10 项 Major)与编排器 R1 派发书;基于 `fc06971055`。每项一个提交,测试走生产代码、带实际跑过的反向臂;编排器核对后合并,不再复审。
- 核对:编排器派发即核对。

### 逐项

| # | 位置 | 修法 | 证明(反向臂) |
| --- | --- | --- | --- |
| 1 | `ext/src/policy/catalog.ts` | 工具集合变了就刷新追加的规则;执行前文档轴的 ask 必须已生效 | `register-policy.test.ts`:首个 prompt 之后才注册的 MCP 工具,文档轴 ask ⇒ 执行前有一条 Code Puppy 待批、拒绝后零执行;去掉刷新 ⇒ 直接执行 |
| 2 | `core/src/config/plugin/command.ts` | 子任务命令走完整的身份轴判定与审批(与 `subagent` 工具同一条),不只查 `subagent` 动作 | `register-policy.test.ts`:`builtin::subagent` 为 ask ⇒ `/review` 先弹 Code Puppy 的审批,拒绝后零子会话;旧检查 ⇒ 直接建子会话 |
| 3 | `core/src/tool/mcp.ts` | 定义比对挪到审批之后、真正发送之前(含恢复重试前) | `codepuppy-mcp-tool-generation.test.ts`:审批等待期间 schema 变了 ⇒ 具名失败、零发送;旧位置 ⇒ 发出旧参数 |
| 4 | `core/src/mcp/client.ts` | 重试日志与其余失败日志都用无正文描述 | `codepuppy-mcp-runtime.test.ts`:503 正文带令牌、触发重试 ⇒ 所有日志行无令牌;旧代码 ⇒ 两条重试日志带正文 |
| 5 | `connection.ts:32` / `pool.ts:163,316` | 弃:Code Puppy 从不设 `pool`(`packages/ui-mac/src`、`packages/ext/src` 中 `pool` 一词只出现在无关代码里,2026-11-12 实查) | 无 |
| 6 | `core/src/mcp/index.ts` | 重连计时器绑定失败代次,触发时复核当前状态与重试资格,旧代次的计时器作废 | `codepuppy-mcp-runtime.test.ts`:501 ⇒ 手动重连得 401 ⇒ 再过 30 s 无第三次请求;旧代码 ⇒ 第三次请求 |
| 7 | `docs/architecture/2026-11-09-1662-permission-reply-measurements.md` | 回执窗口改成实测顺序:收集到同一次回复的级联请求都到齐为止(L6 适配层等同一会话的待批集合,最长 2 s) | `permission-reply-premises.test.ts`:钉住真实事件顺序 `[target, cascade]`;按旧规则(在目标事件处截止)会漏掉级联那条 |
| 8 | `ext/src/policy/display.ts` | 终态一律以本次决策保存的快照覆盖工具自报的 `codepuppyDisplay` | `register-policy.test.ts`:插件自报伪造快照 ⇒ 终态是可信快照;旧逻辑 ⇒ 保留伪造 |
| 9 | `ext/src/policy/resolver.ts` | 写入与删除前先把旧名 selector 规范化为新名 | `resolver.test.ts`:已有 `builtin::bash`,写 `builtin::shell` ⇒ 只剩一条、不冲突;删新名 ⇒ 旧记录也没了;旧逻辑 ⇒ 两条 / 删不掉 |
| 10 | 本线新增的 core 测试 | 改用完整的 `tempGlobalLayer`,逐个检查同类写法 | 改后 `Global.make` 的 log/repos 都在临时目录(断言) |

### 偏离记录

- 2026-11-12 · #2 的判定放在扩展的 `permission.hook.evaluate`(`gate.ts` `gateWithoutToolCall`):没有工具调用来源、动作是某个工具权限名的请求,按该工具的身份轴判定(deny 具名拒绝;ask 带 Code Puppy 身份信封并 holdAsk);core 的 `command.ts` 只改注释。这样 core 不写第二份策略 · `155a095c76`。
- 2026-11-12 · #3 不改 `Mcp.callTool` 的入参(上游 `mcp.test.ts` 逐字断言它):审批后、发送前的比对在 `tool/mcp.ts`;恢复会话后的重发在 `mcp/index.ts` 以首次发送时的定义为基准比对;`codepuppy-mcp-tool-generation.test.ts` 改为真 MCP 服务 + 真 stdio 服务器 · `06ea8ab4db`。
- 2026-11-12 · #10 的反向臂把 Global 换成只设 data 的版本跑过一次,log / repos 落到真实数据目录;两个目录早已存在(2026-07-06 创建,修改时间未变),mkdir 是空操作 · `547a5d1963`。
- 2026-11-12 · #9 顺带改了 `register-policy.test.ts`「a saved deny under the v1 name…」的夹具:store 的写入现在一律存新名,v1 留在盘上的文档改为直接写盘再读 · #9 提交。

## Integration unit 1 — 四条线接成一个产品:真策略进 ext、登记册握满、引擎开启回合的审阅 diff、接缝文档补记(#1662 整合)

- 依据:编排器派发书 `~/.claude/orchestration/alpha-code/1662/INT-unit1.full.md`(四项验收);[接缝冻结](../../design/2026-11-09-1662-lane-seams.md) I3、I6、§4;登记册 [`codepuppy-authority-registry.json`](../../architecture/codepuppy-authority-registry.json) 11 条 blocked 的 `blocked.options`;[ADR-047](../../../.claude/rules/adrs/ADR-047-opencode2-engine-generation.md)「精确接管面」「权威保持表」、决策 5;裁决 [#1666 评论 6737732975](https://github.com/impharaon/alpha-code/issues/1666#issuecomment-6737732975) 第 6 条(`adr041-history-display-conversion` 选 (a))、[6737930969](https://github.com/impharaon/alpha-code/issues/1666#issuecomment-6737930969) 第 1、2 条(`l1r-naming-resume`、`l1r-telemetry-credential` 归 L5);引擎侧 synthetic 锚点 `e27bec1704`。以上均取 `engine/1662-opencode2` @ `df748c16e7`。基线(bun 1.4.4):ext 里装载 `plugin.ts` 的 9 个测试文件 135 过 / 0 败。
- 核对:`e12a3be979` · 编排器 · 通过(规模按约 3 小时一段接受,顺序 3 → 1 → 2 → 4、每项一个提交;setup-order 改宿主 + 子进程接受;`l1r-output-caps` 按 max output 的证明登记,并把该条决定文字收窄到所证明的:输出上限由 Code Puppy 施加、temperature 不动;旧 400 夹具与构建期改写的引用按计划)。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ext/src/plugin.ts` | 第 1 项:`registerPolicy` 改从 `./policy/index.ts` import;注释去掉「桩」说法 |
| `packages/ext/src/policy-stub.ts` | 第 1 项:删除 |
| `packages/ext/src/plugin-setup-order.test.ts` → 宿主 + 新 `plugin-setup-order.cases.ts` | 第 1 项:原断言原样搬进 `.cases.ts`,`mock.module` 目标改为 `./policy/index.ts`;`.test.ts` 起独立 `bun test` 子进程跑它并判 `N pass / 0 fail`(同 `sidecar-env-otel` 的宿主写法)。原因见风险 R2 |
| `packages/ext/src/plugin-host.harness.ts` | 第 1 项:`recordingContext` 的列表类调用回真宿主的形状(`tool.list` → `[]`、`plugin.list` → `{ data: [] }` 等),让 `registerPolicy` 的真代码在记账 Context 上跑得通;真宿主 `activate` 先装上游内置 agent 插件(`packages/core/src/plugin/agent.ts` 的 `AgentPlugin`,`policy/policy-host.cases.ts` 用的同一个),与生产「内置插件先于 ext」一致,策略的 `agent.get` 才找得到调用所属 agent |
| `packages/ext/src/plugin-host.test.ts` | 第 1 项:直接触发 `execute.before` 却从没注册过的工具名(`websearch`、`exa_web_search_exa`、`codepuppy_dispatch` 等),按生产的方式注册(内置 / MCP 命名空间),让策略认得出身份、放行给后面的钩子去判;新增真宿主用例「权威 · 工具策略(I3)」(见证明) |
| `packages/ext/src/cloud-websearch-kill.test.ts`、`cloud-vision.test.ts` | 第 1 项:同上,真宿主用例里点名的工具(`cloud_web_search`、`codepuppy_vision` …)按生产形状登记,断言不动 |
| `packages/ext/src/project-config.test.ts` | 第 1 项:`tool.execute.before` 的条数从 1 改为 3(策略头、ext 自己、策略尾),仍证明项目扇出一条没注册 |
| `packages/ext/src/context-injection.test.ts` | 第 1 项:策略注册了 `session.prompt`(分类为载上下文,`context-injection.ts:643`),补它的咽喉:真宿主跑策略的 prompt 钩子,送出的每个字符串等于输入;已知的坏(prompt 钩子多塞一段)被点名;`THROATED` 加入 `session.prompt` |
| `scripts/gate-files.tsv` | `context-injection.test.ts` 行条数随新增用例改(41 → 42);别的行条数变了同步 |
| `packages/ui-mac/src/engine-adapter/v1-shapes.ts` | 第 3 项:`turnAnchor` 遇到 idle 之后由引擎 synthetic 开启的回合,回 `{ from: <synthetic id>, attach: <同一 id> }`;函数注释改成现状 |
| `packages/ui-mac/src/engine-adapter/turn-diffs.test.ts` | 第 3 项:假上游的 diff 判据改为与引擎一致(`user` 或 `synthetic` 可作 from,`e27bec1704`);「通知在 idle 之后自己开回合」改断言为从通知取 diff、面板读得到;F2 legacy 那半改断言为从 synthetic 取 diff;夹具里旧引擎录下的 `fromSynthetic` / legacy 400 不再当作引擎现状断言 |
| `docs/architecture/codepuppy-authority-registry.json` | 第 2 项:下表 11 条补 `mechanism` 与 `tests`、去掉 `blocked`;`adr041-history-display-conversion` 的 `takeovers` 加 `packages/core/src/database/v1-migration.bun.ts`,阶梯写「构建期改写(等同接管)」 |
| `.claude/rules/adrs/ADR-047-opencode2-engine-generation.md` | 第 2 项:「精确接管面」加一行 `v1-migration.bun.ts` 构建期改写(为什么挂不了钩子 / 守卫 / 回滚 / 归属 L5 #1667,依据 R14 与上面第 6 条裁决);「权威保持表」摘要改为已握住 52 项、未握住 0 项 |
| `docs/design/2026-11-09-1662-lane-seams.md` | 第 4 项(只加不改):§4 环境变量行补 `CODEPUPPY_POLICY_ACCOUNT`、`CODEPUPPY_EXT_BUNDLED_MANIFEST`、`CODEPUPPY_OFFICE_MCP_MANIFEST`(写方 `ui-mac/src/main/server.ts:492,500,503`,读方 ext policy / core);I6 补 L4 加的导出 `withFailureCode`、`parseFailureCode`、`isCodepuppyFailureCode`、`McpStartFailureCode`、`CodepuppyFailureCode`;新增 I11' 一节(暂存附件部件,`packages/ext/src/staged-attachment-part.ts`;L6 发、L3 认;裁决 #1665 评论 6737733672);main 写的 2.x 配置顶层键清单(`codepuppy-config-injection.ts:133-144` 与显式文件层的 `skills`、`commands`) |
| `docs/specs/1662-opencode2/plan.md` | 本段;frontmatter `summary` 加上本段 |

第 2 项逐条(机制文件;证明测试,名字在实施时从文件逐字取):

| 登记 id | 机制文件 | 证明测试 |
| --- | --- | --- |
| `adr033-decision-receipt` | `packages/ui-mac/src/engine-adapter/permission-replies.ts` | `permission-reply.test.ts`:收据形状 + 反向臂(无合成收据)、陈旧快照 409 两条、幂等重放、reject 连带收据 + 反向臂(只列目标) |
| `adr041-collision-rejection` | `packages/ext/src/plugin-fanout.ts`(阶梯写明另三处:core MCP 接管两处、Browser 钉) | `plugin-host.test.ts` ADR-041 冲突、改 / 删两条;`codepuppy-mcp-runtime.test.ts`「a.b/x and a_b/x share an effective name…」;`codepuppy-mcp-tool-collision.test.ts`「builtins registered first…」;`codepuppy-browser-tool-names.test.ts` 两条 |
| `adr041-history-display-conversion` | `packages/ui-mac/engine/v1-migration-transform.ts` | `engine-v1-history-display.test.ts`:套改写 ⇒ 快照在 `state.metadata.codepuppyDisplay`、反向臂(上游原样 ⇒ 全丢)、上游原文变了 ⇒ 抛错 |
| `adr035-websearch` | `packages/ext/src/cloud-websearch-kill.ts` | `plugin-host.test.ts` 联网搜索准入(L5r)、不在 kill-switch 照常放行、云工具准入;`cloud-websearch-kill.test.ts`「#1507 AC1:搜网拒绝理由…」与「放行覆盖不了 kill-switch(2.x 真宿主)」两条 |
| `l1r-platform-credential-header` | `packages/ext/src/platform-credential-header.ts` | `plugin-host.test.ts`「P6 / S5:…」 |
| `l1r-output-caps` | `packages/ext/src/platform-output-cap.ts`(阶梯带上 `byok-output-cap.ts`) | `plugin-host.test.ts`「P5:…」两条 |
| `l1r-naming-resume` | `packages/ui-mac/src/main/naming-migration-db.ts` | `naming-before-v1-conversion.test.ts`「#1569 会话库改名先于 v1 → 2.x 转换…」(cases 含生产顺序与反向臂) |
| `l1r-telemetry-credential` | `packages/ui-mac/src/main/sidecar-env.ts` | `sidecar-env-otel.test.ts` 原样、反向臂两条 |
| `l1r-review-turn-supply` | `packages/ui-mac/src/engine-adapter/v1-shapes.ts`(阶梯写回合边界取 diff 的 `events.ts` / `routes.ts`) | `turn-diffs.test.ts`「事件流 → 冻结归约器 → turnDiffsOf…」、「反向臂:不在回合边界取…」、第 3 项改过的那条 |
| `hub-install-ask` | `packages/ext/src/hub-tools.ts` | `plugin-host.test.ts`「权威 · 定制中心安装(I10)…」;`hub-tools.test.ts`「hubInstallEvaluate:…」「规则被绕过…」 |
| `sidecar-stop-drains` | `packages/ui-mac/src/main/sidecar-stop.ts` | `sidecar-stop.test.ts`「线上只发 { type: "stop" }…」、「#1647 AC2 a hung engine close…」 |

### 顺序

1. **第 3 项**(独立、最小):`v1-shapes.ts` + `turn-diffs.test.ts` 一个提交。跑 `packages/ui-mac` 的 `bun test src/engine-adapter/turn-diffs.test.ts`、`bun run typecheck`;手动反向臂(见证明)。
2. **第 1 项**:接线与全部测试适配同一个提交(只换 import 会让 24 条变红,不能分开落)。跑 `packages/ext` 里 9 个装载 `plugin.ts` 的文件(逐个点名)+ 新 `.cases.ts`;`plugin-setup-order.test.ts` 与 `src/policy/register-policy.test.ts` 同一次调用(前者在先)跑一次,证明 mock 不外泄;`bun run typecheck`;`bun ./scripts/build.ts`(产物在已忽略的 `dist/`,证明策略能打进自包含 bundle);`bun scripts/context-injection-inventory.ts --check`;手动反向臂(见证明)。
3. **第 2 项**:登记册 + ADR-047 一个提交。先逐个跑上表点名的测试文件(ext / ui-mac / core 各自目录),全绿才登记;任何一条红或证明不了那项决定 ⇒ 该项保留 blocked 并交回。再跑 `packages/ext` 的 `bun test src/policy/authority-registry.test.ts`。
4. **第 4 项**:接缝文档一个提交。证据命令见证明;`python3 scripts/check-doc-links.py` 判改动的 Markdown。

每个提交把本段的偏离记录一起改。全部用 `~/.bun-versions/1.4.4/bin` 在 PATH 首位;ext 有 `bunfig.toml` 预载隔离 HOME / XDG,ui-mac 的引擎类测试自带沙箱,不碰 `~/.local/share/opencode`。

### 风险

- **R1 第 1 项比预期大(已实测)。** 计划阶段用一个临时预载(`/tmp` 下,`Bun.plugin` 在装载时把 `plugin.ts` 的 import 换成真策略,不改工作树)跑上面 9 个文件里的 8 个:**110 过 / 24 败,分布在 6 个文件**。原因五类,都是测试宿主缺生产事实或写着桩时代的计数,没有一条指向策略或 ext 生产代码的缺陷:① 记账 Context 的 `tool.list` 不是数组(context-injection ②/③a/③a″、project-config 共约 10 条);② 真宿主没有内置 agent ⇒ 策略 `agent.get` 报 `Agent not found: build`(P1、I10、codepuppy_access、待批回复等);③ 用例对没注册的工具名直接触发 `execute.before` ⇒ 策略按「未知身份默认拒」(已登记的决定 `tool-policy-unknown-identity`)先拒(websearch、cloud_web_search、codepuppy_vision);④ 计数断言(project-config);⑤ 策略新注册的 `session.prompt` 没有咽喉(context-injection ②,该测试注释原文即预言了这种红)。把 ① 修掉后复测 context-injection + project-config:57 条里剩 3 败,与上面分类吻合。整段预计约 3 小时,而派发预期 90 分钟;适配只改测试与 harness,一旦某一类要动策略(L4 冻结)或 ext 生产代码 ⇒ 停下交回。
- **R2 `mock.module` 外泄(已实测)。** bun 1.4.4 下,一个测试文件的 `mock.module` 会作用于同一次 `bun test` 里之后的所有文件,连已 import 的模块也被改绑(`/tmp` 三文件对照:a 里 mock,b 里读到的是 mock)。原样把 setup-order 的 mock 改指 `./policy/index.ts`,同一次运行里排在它后面的 ext 文件(含 `policy/*.test.ts` 与门里的 `bun test src`)就拿到空策略。所以搬进子进程。
- **R3 登记的每一条都要在整合树上真绿。** 名字存在只是判官的下限;第 2 项在第 1 项之后做,ext 的证明测试(P5、P6、I10、websearch、冲突)是在真策略下跑绿的。`l1r-output-caps` 的决定文字写着 temperature / max output:v1 只断言 temperature 不被改动(锚点 `e56ae0c036` 的 gate 行 7、16);登记按 max output 的证明,决定文字不改,作为观察交回。
- **R4 第 3 项的夹具是旧引擎录的。** `parity.json` / `continue.json` 里从 synthetic 取 diff 的 400 录于 `e27bec1704` 之前;引擎侧新行为由 `packages/core/test/codepuppy-session-diff-synthetic.test.ts` 在真 Session 服务上证明,适配器测试只证明适配器发出 `from=<synthetic>` 并把结果挂上。不重采样:采样器整份重写 `parity.json`,别的适配器测试也读它。
- **R5 慢测试。** `engine-v1-history-display.test.ts` 两条各带 300 s 超时(真引擎);只跑一次。
- **R6 构建期改写登记为等同接管,依据是 R14 与上面第 6 条裁决,不挂 owner 原话**(没有对应原话;Unit F 那两条的 owner 原话不适用于它)。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| 1 真策略进 ext | `plugin-host.test.ts` 新增「权威 · 工具策略(I3)」:真宿主装 ext 默认导出,一个由旁路插件注册、带调用计数的工具,经生产 `createToolPolicyStore` 写入 `disabled` ⇒ 调用具名拒绝(含 canonical 身份)、计数 0;同一记录下不装 ext ⇒ 执行、计数 1。手动反向臂:把 `plugin.ts` 的 import 指回一个空的 `registerPolicy`(被删桩的内容)跑这条 ⇒ 红,再 `git restore`。另:9 个装载 `plugin.ts` 的文件 + 新 cases 全绿 | 没接线 ⇒ 被停用的工具照样执行,计数为 1 |
| 1 setup 顺序 | `plugin-setup-order.test.ts` → cases 子进程 `1 pass / 0 fail`;与 `policy/register-policy.test.ts` 同次运行仍全绿 | 把 `seal()` 挪到扇出之前 ⇒ cases 红;mock 若外泄 ⇒ register-policy 的 B 组红 |
| 2 登记册握满 | `authority-registry.test.ts`「the production registry…」由红(列出 11 条 blocked)变绿;上表点名的测试文件逐个跑绿;判官对合成登记册的各条规则已有红臂 | 任何一条留 blocked、机制文件或测试名不在 ⇒ 生产那条红并点名 |
| 3 引擎开启的回合有审阅 diff | `turn-diffs.test.ts`「通知在 idle 之后自己开回合」:发出一次 `from=<synthetic id>`、`turnDiffsOf` 读到改动;F2 legacy 同理。手动反向臂:`turnAnchor` 改回遇 idle 回 `undefined` ⇒ 两条红(零请求、面板空),再 `git restore` | 不从 synthetic 取 ⇒ 不发请求,面板「没有改动」 |
| 4 接缝文档补记 | 命令输出:三个环境变量的写方与读方 `grep`;五个契约模块导出与恢复提交 `8b970a62f5` 的差集;`packages/ui-mac` 的 `config-injection-throat.test.ts` 绿(它在 `:190-193` 把 2.x 键映射到登记簿已声明的引用,所以 ext 登记簿不需要加键);`context-injection-inventory.ts --check` 无差异;`check-doc-links.py` 通过 | 文档类,不写断言措辞的测试 |

### 偏离记录

- 2026-11-12 · 第 3 项:`turnAnchor` 只改「idle 之后的 synthetic」那一支;synthetic 之前既无 user 也无 idle(会话以 synthetic 开头)仍回 `undefined`,不扩到 AC 之外 · `b32116b2bc`。
- 2026-11-12 · 第 1 项:`plugin.ts` 的 import 写成 `./policy/index`(与该文件其余 import 同样不带扩展名);`plugin-setup-order.cases.ts` 的 mock 目标随之是 `./policy/index` · 第 1 项提交。
- 2026-11-12 · 第 1 项另改两处计划没点名的断言,都是真策略多注册的钩子让「最后一个 / 只有一个」不再成立:`cloud-websearch-kill.test.ts` 跨 Location 那条自带的 Context 原先取「最后注册的」execute.before 与 mcp.transform(此刻是策略的尾),改为按宿主的链依次跑全部 execute.before、依次喂全部 mcp.transform,工具表给出被问的工具;`context-injection.test.ts` ② 的 `session.context` 上有策略的目录闸 + ext 的组装回调两条,断言改为两条、组装回调取最后一条,其余三条请求钩子仍须是同一个回调 · 第 1 项提交。
- 2026-11-12 · 第 1 项:I10 用例另需宿主里有 main 注入的 `codepuppy-automation-standard` agent(策略按调用所属 agent 读规则),用一个旁路插件按生产形状建出;云工具准入那条加断言拒绝来自主权闸(`is unavailable`),防止它因策略的「未知身份」而假绿;新增 I3 用例的探针工具在装 ext 之前注册(同内置插件),策略认作 `builtin::probe_tool` · 第 1 项提交。
- 2026-11-12 · 第 1 项:`gate-files.tsv` 的 `context-injection.test.ts` 行在基线就是 41 而文件实跑 36(已过期,属 unit 2 那一类),按本提交实测改为 37;`cloud-websearch-kill.test.ts` 行 47 对实跑 30 同样过期,本段没改它的条数,留给 unit 2 · 第 1 项提交。
- 2026-11-12 · 第 2 项:`l1r-output-caps` 的决定文字按编排器核对收窄,但不写「temperature 不动」—— 实查 OpenCode 2 上没有任何测试断言 temperature(`grep temperature` 在 ext 的 P5 与两个 cap 测试里零命中),写上就比证明宽;改为只说输出上限,`note` 记下原因 · 第 2 项提交。
- 2026-11-12 · 第 2 项:同步更正 4 条的 `lane`(`adr041-history-display-conversion`、`l1r-naming-resume`、`l1r-telemetry-credential` 归 L5,`l1r-review-turn-supply` 归 L6),按的是 #1666 两条裁决与实际交付方;`sidecar-stop-drains` 的证明名取不含转义引号的子串(判官按子串比对) · 第 2 项提交。
