---
id: PLAN-1662-opencode2
title: OpenCode 2 换代 实施计划
summary: alpha-code#1662 各实施线的分段计划;目前含 L4(#1666)Unit B —— MCP 具名启动失败与模型请求的网络失败分类让桌面看得见
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
- 核对:待编排器核对。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/schema/src/codepuppy-net-failure.ts` | 只加导出:MCP 非网络层的启动失败名(workspace_missing / dependency_missing / spawn_failed / handshake_timeout / auth / protocol / transport)与九个 `NetFailureLayer` 合成的登记码类型 `CodepuppyFailureCode`、`isCodepuppyFailureCode`;生产方 `withFailureCode(code, text)`,消费方 `parseFailureCode(text) → { code, text } \| undefined`(交给 L6)。前缀的字面形状只在本模块(拟定 `[codepuppy:<code>] `);解析只认登记码,普通文本、未登记的码、长得像的前缀一律 `undefined`(模块已有的 I4 纪律)。分类器本身不动。 |
| `packages/core/src/mcp/codepuppy-startup.ts` | `StartFailure.code` 改用 `CodepuppyFailureCode` 类型:引擎侧产出一个没登记的码,typecheck 就红。 |
| `packages/core/src/mcp/index.ts` | `failed` 与 `closed` 两个事件写 `Mcp.Status.Failed` 时,`error` 经 `withFailureCode(cause.code, …)` 加前缀(`codepuppy(#1563, #1564)` 标注块内)。`closed` 先算 cause 再写状态。`needs_auth` 不动;`Mcp.Status` 形状不变。 |
| `packages/core/src/mcp/connection.ts` | 去掉非法 URL 分支上的 `{ code: "invalid_url" }`(第 173 行),恢复成上游原样。行为不变:没有 cause 本来就不会重连,上游原文「Invalid MCP server URL: …」已经说明原因。v1 也没有给它具名(当时记作 `transport`)。这样上游 `mcp.test.ts:1891` 的逐字断言不用改,也不必接管那个 3500 行的上游测试。 |
| `packages/core/src/session/to-session-error.ts` | 新的最小接管,只动 Transport 分支(第 52–54 行):用 `classifyNetFailure(cause.reason, engineNetFailurePath(cause.reason.url, process.env))` 分类,认出了层,就给 `unreachable()` / `providerError()` 的 `message` 加该层的前缀;认不出就保持原文。`type` 与其余字段不变。 |
| `packages/core/test/codepuppy-net-failure-settle.test.ts`(新,Code Puppy 自有) | 替代 v1 的 `packages/opencode/test/session/codepuppy-net-failure-settle.test.ts`。错误来自真实的 `@opencode/ai` 路径,不是手搓:真 `RequestExecutor.fetchLayer` 请求一个已关闭的本机端口,得到 ECONNREFUSED;同一执行器的映射处理原生 DNS 失败,得到 ENOTFOUND,走 `unreachable` 子分支。另加一条无码的传输失败(不加前缀,原文不变)。 |
| `packages/core/test/codepuppy-mcp-runtime.test.ts` | AC2 加一条:在生产 `Mcp.Service.servers()` 上,缺命令 / 缺工作目录 / 被拒的远端三台的 failed 状态,经 `parseFailureCode(status.error)` 分别读出 dependency_missing / workspace_missing / tcp。 |
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

暂无
