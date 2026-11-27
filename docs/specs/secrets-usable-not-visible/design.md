---
id: DESIGN-secrets-usable-not-visible
title: 密钥文件程序可用、助手不可见 技术设计
summary: v3.5 冻结：消费规格 v6——命令里字面写出的项目外名单文件在 Shell create.before 登记、capture start 读出，第一段输出起遮盖；其余同 v3.4：项目外按项目规则命中的名单文件经 match 认定、读过后计入采集；env 只取凭据名变量与值里内嵌的连接地址密码；值里凭据名键的 key=value 段同样只遮其值；写回按位置换回每个遮盖符。SC-01/SC-02 与两处引擎授权不变。
kind: tech-design
status: frozen
design_version: "3.5"
spec: SPEC-secrets-usable-not-visible
spec_version: 6
review:
  rounds: 2
  reviewed_sha: "d336e59d04"
  verdict: "v3.5 frozen; spec v6 sync of §4.1/§4.3/§4.5 (literal command paths registered at create.before), no new seam or engine change; R2 receipt retained"
owners: [owner]
last_reviewed: 2026-11-27
---

# DESIGN-secrets-usable-not-visible｜密钥文件程序可用、助手不可见 技术设计

本设计对应 #1758；**v3.5 为 frozen，消费规格 v6**。v3.5 只把 §4.1/§4.3/§4.5 与规格 v6 BR-05 的 v6 句对齐：命令里字面写出的项目外名单文件在 Shell create.before 登记、capture start 读出，第一段输出起遮盖；公开签名只新增 `ProtectedFiles.named` 与 `SecretMask.command`，SC-01/SC-02 与授权不变，裁决见 §10「v3.5」。v3.4 只把 §4.1/§4.3/§4.3.1/§4.4 与规格 v5 的 BR-05、BR-06 对齐（项目外按项目规则命中的名单文件、env 只取凭据字段、值里内嵌的连接地址密码），公开签名、SC-01/SC-02 与授权不变，裁决见 §10「v3.4」。以下为 v3.3 增量说明：v3.3 只修订 SC-01 的单槽发布形状：同一 capture 回调可逐段 await Core 的 publish，不聚合全部安全字节。原顺序、背压、故障锁存与终态仅说明保证不变，沿用 U-38 的同一引擎接管，不新增 hook 或 owner 项。v3.2 的原 read 分页/after 安全视图及 U-42 不新增 SC-03 的说明文件边界继承；SC-02 及其余已定契约不变。review 轮数/版本保留真实 R2 收据，不冒报本轮独立审查。

## 1. 基线

- Spec：[SPEC-secrets-usable-not-visible v6](spec.md)，固定输入提交 `2e99186d59`（v6 只补 BR-05 的 v6 句、限制表一行与 AC-13，owner U-44 批准；其余与 v5 相同）。v5 固定输入提交 `3776643a6e84e1a7afd620a05b9b7f981da88e68`（v5 首版 `5d56d0cae1`；`d14b2e3c64` 补 BR-06 的内嵌密码句与 AC-12 扩写，`3776643a6e` 按代码审查 R1 第 6 项补「值里以 `Password=`、`?password=` 这类键写出的密码同样只遮这一段」，两次均注明批准行不变）。v4 固定提交 `0099c0c248` 的 U-42 说明文件限制在 v5 中不变；v1..v4 的有效证据继承。
- v3.4 输入：本工作树 `d14b2e3c64`（分支 feat/1758-i50-i51，未 push）；plan.md「⑥ 规格 v5」的改动表、偏离记录（plan.md:861-865）、实施收据（:867-877）与「⑥ 核对修正：值里内嵌的密码」（:879-886）；v3.4 修订再消费 `3776643a6e` 的「⑥ 审查 R1 修正（FIX-THEN-MERGE）」（plan.md:888-897），实现为红例 `099c3ec893`、修正 `fc825e9e6d`。只消费已实施的 BR-05/BR-06 v5 行为，不重开 v3.3 及更早决定；I-52 不在本增量。
- v3.5 输入：工作树 `/Users/pharaon/app/wt/alpha-code-feat-1758-i54-literal-paths` 的 `859207d427`（分支 feat/1758-i54-literal-paths，基线 origin/alpha `a56d861523`，未 push）；plan.md「⑦ 规格 v6」的改动表、风险、「设计待同步」、偏离记录与实施收据，实现为红例 `c425bed85b`、实现 `18f8f451b6`。只消费 BR-05 v6 句，不重开 v3.4 及更早决定。
- 覆盖：BR-01..BR-07、AC-01..AC-13（AC-11、AC-12 为 v5 新增，由 §4.1/§4.3/§4.4 的 v5 句保持；AC-13 为 v6 新增，由 §4.1/§4.3/§4.5 的 v3.5 句保持）。AC-09 由实时 flush 保持，AC-10 由逐 profile 凭据字段提取保持；成功结果 hook 沿用 §2 证据，本文探针不代替验收。
- 输入收据：owner 2026-11-26 的 U-38「好的。」已批准 SC-01、前后可读值边界及失败整次隐藏；U-39「这两个你的建议是什么，按你的建议吧。」批准实时逐段遮盖、先打印后写入的窄残留，以及非 env 格式只提取凭据字段，已落入规格 v3。继承 Windows 发布时真机验收和「复用工具卡文本区、无需 frames」约定。自动化仍消费 [SPEC-unattended-run-permissions v2](../unattended-run-permissions/spec.md) BR-03。
- 背景：规格[来源](spec.md#来源)所指的协调仓安全意图 I-45、讨论 P-06/P-08；不重开「程序可用」「全部批准读项目外文件不问」和原样匹配边界。
- r3 输入：独立 R2 审查 `582f056887..d336e59d04`，FIX-THEN-MERGE；本轮按六项 finding 与三项补充处置冻结。执行 `git fetch`、`git rebase origin/alpha`（上游 `d4a849e524`），无冲突，没有新增 merge；只改本文与必要索引行。
- v3.3 / r8 输入：当前工作树基线 `7ef8b89b30`，未 merge；实施④ `7908e114024baeec5c76cf92a9846c863353362c` 的 plan.md「④ r6 接缝收据：SC-01 单槽发布与长 escape」。仅核对 §4.5/§4.7/§5 的 AC-08/09 直接后果；U-38「好的。」所批 SC-01 的位置/职责不变，只改回调形状。
- r7 输入：v3.2 `176c6e8c6a`；owner 2026-11-27 在协调仓安全意图 U-42「同意。」与上述规格 v4，决定说明文件边界、不新增第三处引擎改动。当前仅更新设计裁决，保留原页 after 路径；没有待 owner 决定。
- v3.2 / r6 输入：v3.1 `832ab5a4f4` / #1780；实施③ `793fdff5db` 的 plan.md「③ r5 实施收据与接缝返回」。当前基线 `4d9392d6d3`，新工作树未 merge。只核对 BR-02/03/06/07、AC-01/04/06/07/08 的读取后果；未扩大权限档、格式或用户限制。SC-01/U-38 与 SC-02/U-40 是仅有的两处已批准引擎改动。
- r5 输入：v3.1 `4466819664`；本轮派单转录的协调仓安全意图 U-40，owner 2026-11-27「Cargo 选 1，第二处引擎改动允许，Supabase 报告批准」。本票只消费第二处引擎改动的批准，冻结既有 SC-02 契约，不扩大范围。
- v3.1 输入：已合入的设计 `66313542d3` / #1772；实施②的采集提交 `d14b17a2ea` 与接缝收据 `9a08725438`，其 `plan.md` 的「偏离记录 / ②实施检查收据」提供真实 Code Mode 反例。当前只处理 BR-03/BR-07 对进度、记录和模型的义务，不增加 AC 或改动其余实施段。新工作树基线 `a586b16fcac32702d2d14cda898c5a32bb71d02c`，未 merge。
- 代码证据基线：`9f08c506d9842d319616c7e45c33d3b9c3279e48`，引擎包版本 `2.2.5`，Bun `1.4.4`、Node `26.13.1`。r1 授权的合并为历史事实；r3 对 Core/Plugin/Ext 源码与 ANSI 权威执行 `git diff --stat 9f08c506d9842d319616c7e45c33d3b9c3279e48 HEAD -- packages/core/src packages/plugin/src packages/ext/src packages/session-ui/src/tools/ansi.ts`，输出为空，继承有效的行号/探针。

## 2. 地面真相

继承成功 hook、R1 的直播/Code Mode/写回/SQLite 证据。r3 的归一化/重复键/清理证据继承。v3.1 只追踪外层 progress → 发布缓存 → 实时卡/失败记录/模型的可达链路；停止条件是证实现有非引擎出口完整覆盖，或找到它无法覆盖的实际写入反例并定义最小所需接缝（已由 U-40 批准）。

| 已观察的事实 | 证据与结论 |
| --- | --- |
| 成功 hook 的改动会成为最终结果 | `packages/core/src/tool.ts:163-179` 把 `afterEvent.result` 交回调用者；`packages/plugin/src/promise/tool.ts:47-65` 允许替换 `result`。`packages/ext/src/plugin.ts:224-231` 已在成功分支替换不符云契约的结果。 |
| 结果进入历史之前还有截断和发布 | `packages/core/src/session/runner/step.ts:98-125` 先执行工具、再 `ToolOutput.truncate`、再发布；`packages/core/src/session/runner/publish-llm-event.ts:561-578` 发布成功正文和 metadata；`packages/core/src/session/projector.ts:1112` 投影成功事件；模型从 `packages/core/src/session/runner/to-llm-message.ts:114-137` 读取投影后的工具正文/错误。因此在执行后、发布前改写可同时覆盖模型、历史和终态卡片。 |
| MCP 与 Code Mode 子调用同样经过工具执行器 | `packages/core/src/tool/mcp.ts:67-146` 将 MCP 文本、structured、错误转成 Tool 结果；`packages/core/src/tool.ts:274-279,346-360` 的 Code Mode 子调用走 `run`，继而经过相同 before/after。不能只处理 `shell` 或 `content`。 |
| 进度早于 after，且外层 execute 绕过包装 | `packages/core/src/tool.ts:272-278,313-314` 在 registry transforms 之外合成/执行 CodeModeTool；`codemode/tool.ts:126,220-222` 直接将子调用 input 发布为 toolCalls。`packages/ext/src/policy/display.ts:43-70` 的 ToolEditor 包装只覆盖已注册工具，不能覆盖该外层。进度的缓存/发布入口仍是 `session/runner/publish-llm-event.ts:548-558`。 |
| shell 另有实时出口和后台持久化 | `packages/core/src/shell.ts:333-355` 将 `handle.all` 原字节写文件；`:208-235` 的 `output` 读取该文件。`packages/session-ui/src/tools/tool-renderer.tsx:2262-2277` 跟随输出，`packages/app/src/shell/routes/session-ui-provider.tsx:212` 接到 `api.shell.output`。`packages/core/src/tool/plugin/shell.ts:210-239` 将捕获文本交给 Job，`:144-173` 又直接产生 synthetic 通知。只遮盖 after 会漏实时卡片、Job 与后台通知。 |
| shell 暂无输出改写 hook | `packages/plugin/src/effect/shell.ts:11-13` 与 Promise 对应契约只有 `create.before`。`PluginHooks.trigger` 顺序执行并保留原事件对象（`packages/core/src/plugin/hooks.ts:88-96`），宿主 `packages/core/src/plugin/host.ts:500` 和 Promise adapter `:660-662` 已泛型转发 shell hook；新增输出事件无需另建 IPC。 |
| 受保护路径目前只是风险探针 | `packages/ext/src/policy/risk.ts:149-164` 的凭据路径正则只有抬风险用途，并非读文件或结果遮盖规则。其余系统文件风险不能因提取密钥名单消失。 |
| read 可前置说明或后置安全页，但有旁路 | `packages/plugin/src/promise/tool.ts:25-35` 可包装原执行器；non-env 保护文件前置返回说明。env 的原 read 先完成分页/输出编码，再进入 after；它还会在 `packages/core/src/tool/plugin/read.ts:127-158` 先加载邻近 AGENTS.md，不能据 after 推导所有发布都已遮盖。 |
| 项目外 ask 不区分读写 | `packages/ext/src/external-directory-rule.ts:20,38-52` 给 build 与询问档注入相同 `external_directory` ask；`packages/ext/src/plugin.ts:412-418` 消费它。整条删除会同时放松写和 shell 的目录审批，超出 BR-05。 |
| deny 不能被 evaluate hook 放宽 | `packages/core/src/permission.ts:232-247` 在 hook 前返回已配置 deny。保留删除交互 `.env` 专用规则的既有决定；non-env 保护读取前置说明，env 使用项目内受保护路径后置处理；不翻转其它显式 deny。 |
| 自动化有独立的现成识别权威 | `packages/ext/src/policy/unattended.ts:30-42` 的 `unattendedProfile` 同时识别在册会话和请求 agent；档位来自 `packages/schema/src/codepuppy-unattended.ts:5-9`。不得靠新建 agent 名单或单看名字推断自动化。 |

### 成功结果探针：规格「待决」已解决

在临时目录建探针，复用 `packages/core/test/tool-registry.test.ts:41-54` 的真实 Tool/PluginHooks layer 及 `packages/core/test/lib/permission.ts`。Image 只提供一个未被调用的报错实现；工具执行器、结果校验、hook 分发和 `snapshot.execute` 都用生产实现，不用手写引擎替身。输入是进程内生成的 UUID，不读取用户文件，不输出值。

命令（工作目录 `packages/core`）：`bun test /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-design-probe-163ty__y/hook.test.ts`，exit **0**，`1 pass / 0 fail / 5 expect() calls`。临时文件不入仓。探针核心为：

```ts
// 注册返回同一 UUID 的 text、output.value、metadata.value，且先 progress({ value })。
const control = yield* snapshot.execute(call("control"))
expect(JSON.stringify(control)).toContain(value)
const registration = yield* hooks.register("tool", "execute.after", (event) =>
  Effect.sync(() => {
    if (event.status !== "completed") return
    event.result = {
      content: [{ type: "text", text: "[REDACTED]" }],
      output: { value: "[REDACTED]" },
      metadata: { value: "[REDACTED]" },
    }
  }),
)
const rewritten = yield* snapshot.execute(call("rewritten"))
expect(JSON.stringify(rewritten)).not.toContain(value)
expect(rewritten.output).toEqual({ value: "[REDACTED]" })
expect(progress[1]).toEqual({ value }) // after 没有保护更早的 progress
yield* registration.dispose
expect(JSON.stringify(yield* snapshot.execute(call("disabled")))).toContain(value)
```

**观察**：成功结果确实可改写，去掉 hook 的对照重新暴露输入，结论能被证伪。**推断**：将遮盖接入这个时点后，持久化和模型将消费遮盖结果；完整三消费者的真引擎证据仍属于实施验收。after 本身不需要接管引擎。

### 文件采集反例：不能冒充全称保证

另一临时探针用真子进程一次完成：创建 `.env` → 写入随机 TOKEN → 原样输出文件 → 删除文件。父进程在命令前、后各检查一次文件。命令 `node /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-snapshot-probe-qh3gl5eb/probe.mjs`，exit **0**，只输出：`beforePresent=false, afterPresent=false, capturedValue=true, childExit=0`。没有输出或复制 TOKEN。

**观察**：原样输出也可能从未被前后两次采集见到。此反例在 r0 是规格缺口，现已由规格 v2 BR-03 和限制表明确排除；加密保存、由程序解密后才输出的值同样排除。普通 watcher 不成为明文采集权威，也不新增 watcher。§4 按前后可读值实现，不再要求超出 v2 的全称保证。

**R1 推翻 r1 的发布时点结论**：`packages/core/src/tool/plugin/shell.ts:24-25,95,188` 明确支持运行中读取输出和无时限后台命令；`packages/core/src/session/shell.ts:10-24` 直接用户 shell 的 timeout=0；卡片 `packages/session-ui/src/tools/tool-renderer.tsx:2262-2282` 持续跟随。等待整个进程结束会使长期服务一直没有输出。U-38 没有批准去掉直播，r2 恢复逐段发布；r3 的规格 v3 已批准 LIVE-01 的先打印后写入窗口。

**调用键不是子调用标识**：`packages/core/src/codemode/tool.ts:147-150` 把外层 context（包括 id）传给每个子工具；`packages/core/src/tool.ts:181-182,307` 触发同形 before/after。因此 `(sessionID,messageID,id)` 只标识最外层事务，不能让每个子工具 begin/end。

**写回接缝**：`packages/ext/src/policy/gate.ts:259-264` 深冻结已审批 input；`ToolEditor.update` 可包装已有 execute（`packages/plugin/src/promise/tool.ts:25-35`）。`write` 接收 path/content（`packages/core/src/tool/plugin/write.ts:19-24`），`edit` 接收 path/oldString/newString（`:24-33`）；`patch` 使用既有 `Patch.parse`（`packages/util/src/patch.ts:49`），旧/新行在 `Patch.Hunk`/`UpdateFileChunk`（`:27-42`）可区分。恢复只能在执行器包装中构造局部副本，不能修改被 pin 的事件，也不另建文件写入器。

### R1 SQLite 来源与可失败证据

不读取用户的任何凭据库。本次读取 [Google 官方组件元数据](https://dl.google.com/dl/cloudsdk/channels/rapid/components-2.json)（594.0.1），下载其 [core 源码包](https://dl.google.com/dl/cloudsdk/channels/rapid/components/google-cloud-sdk-core-20261121205138.tar.gz)。包 SHA-256 为 `f3d680f1d2bcf89b575bbba309305f2d897236d19b82e7d78462cf632ee2252d`，与元数据一致；`lib/googlecloudsdk/core/credentials/creds.py` SHA-256 为 `af6b60dd4e30c7438af090b0556812814881967a90f483a3c294db96da7bc878`。

该文件 `:397-401` 定义 `credentials(account_id TEXT PRIMARY KEY,value BLOB)`；`:573-600,665-671` 定义 access_tokens 表并区分 token、过期时间与账户字段；`:1320-1393` 把 credentials.value 序列化为 credential JSON。下面 §4.1 冻结实际凭据列，不采集 account_id、expiry、策略和格式字段。

临时探针以 Python AST 直接读取官方 `AccessTokenCache._COLUMNS` 生成 SQLite DDL，再写入进程生成的测试值；没有手写另一套 gcloud schema。命令 `node /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-gcloud-source-nnq2qb0l/sqlite-probe.mjs /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-gcloud-source-nnq2qb0l/sample-access-tokens.db`，exit **0**。只报告：凭据单元格 3 个；metadata 列未收集；只读 DELETE 被拒；整文件对照漏遮；单元格替换成功；`0 1 json v1 {}` 保持原样。未打印任何测试值，探针不入仓。

读取能力使用 [`node:sqlite.DatabaseSync({readOnly:true})`](https://nodejs.org/api/sqlite.html)，无新依赖。仓内 Node SQLite driver 已使用同一内建模块（`packages/core/src/database/sqlite.node.ts:1`，安装包 `@effect/sql-sqlite-node/src/SqliteClient.ts:36`）；[Electron 42.3.3](https://releases.electronjs.org/release/v42.3.3) 的 Node 为 24.15.0。本机 Node 探针证明只读行为，不冒充出货 Electron/Windows 的验证。

同一临时目录执行 `node /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-gcloud-source-nnq2qb0l/spill-probe.mjs /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-gcloud-source-nnq2qb0l/sample.spool`，exit **0**：实际 Node crypto 完成 32-byte key 的 AES-256-GCM 文件往返，密文不含原值，改坏 tag 的对照被拒，BigInt stat 提供 dev/ino/size/mtimeNs/ctimeNs。只输出四个布尔断言，不输出 key/明文；这验证依赖原语，不声称 SC-01 或完整流算法已实现。

### R2 的定向事实与最小探针

`packages/session-ui/src/tools/ansi.ts:1-7` 的纯函数 `stripAnsi` 已同时处理 CSI、OSC 及其它已支持的 escape；`:1` 明确不是仅颜色。`ansi.test.ts:4-17` 已有实际样本。扩展窄引用这个源文件的函数，不引 UI barrel/组件、不复制正则、不新增包依赖。Node `util.parseEnv` 对重复键只保留最后一次值，不能用其最终 map 恢复每一行；词法出现序列必须另行保留。Core 现有 `Shell.cleanup`（`packages/core/src/shell.ts:91-125`）已在全局 cleanupNode 启动并周期清理捕获目录，孤立密文清理扩入这一权威。

临时目录探针 `node /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-r3-probe-ibgw2row/probe.mjs`，exit **0**。输入仅为进程生成的测试值、R2 指定的 `Listening on http://localhost:3000` 和仓内 `ansi.test.ts` 的 CSI/OSC 样本，不读用户凭据。七项布尔断言全真：长匹配单位下普通末行立即可发；固定 L−1 对照发不出；测试值每个切分点都保留完整秘密前缀并遮盖；直接调用共用 ANSI 函数覆盖 CSI/OSC；parseEnv 的重复键后值覆盖前值；按出现序号保住两个不同 RHS；真实 rename 后文件只有说明、没有原前缀。**观察**仅支持算法原则与现成原语，尚不是 SC-01/流式 matcher 或全消费者实现证明。

字段依据限定为一手资料：[Kubernetes OIDC](https://kubernetes.io/docs/reference/access-authn-authz/authentication/#openid-connect-tokens) 明列 `auth-provider.config.id-token`；[botocore tokens.py](https://raw.githubusercontent.com/boto/botocore/develop/botocore/tokens.py) 的 `SSOTokenProvider._attempt_create_token` 写 accessToken/clientSecret/refreshToken；[credentials.py](https://raw.githubusercontent.com/boto/botocore/develop/botocore/credentials.py) 的 `SSOCredentialFetcher._get_credentials` 写 Credentials 下三项凭据；[Azure identity.py](https://raw.githubusercontent.com/Azure/azure-cli/dev/src/azure-cli-core/azure/cli/core/auth/identity.py) 的 `get_entry_to_persist` 区分 client_secret/client_assertion 与证书路径，[persistence.py](https://raw.githubusercontent.com/Azure/azure-cli/dev/src/azure-cli-core/azure/cli/core/auth/persistence.py) 的 file_extensions 区分 `.json`/`.bin`。只据此补发布数据，不采集 account/region/expiry/证书路径或尝试解密。

### v3.1 外层进度的边界证据

1. **实时与持久边界不同。** `packages/schema/src/session-event.ts:524-532` 将 Tool.Progress 定义为 ephemeral，Core projector 不登记它（`packages/core/src/session/projector.ts:1109-1113`）；但 publisher 在 `publish-llm-event.ts:551` 先缓存原 update。取消/defect 时 `packages/core/src/session/runner/step.ts:152-155,227-235` 进入 failUnsettledTools，`packages/core/src/session/runner/publish-llm-event.ts:109-112,350-374` 的 failureSnapshot 把缓存 metadata 合进 durable Tool.Failed。`packages/core/src/tool.ts:142-145` 只将 Tool.Error 转成 after 事件；中断/defect 不保证经过该 after，因此不能依靠 after 清空 toolCalls。
2. **桌面出口晚于这一写入。** `packages/ui-mac/src/engine-adapter/opencode2/events.ts:159,427-431` 的 createProjector 可在 progress map/卡片之前遮盖；projectEventStream（`:482-497`）却只是公开事件订阅。扩展的 `Context.event.subscribe` 也只有观察能力（`packages/plugin/src/promise/event.ts:6-9`、`packages/core/src/plugin/host.ts:268-284`）。Core `bus.ts:400-431,464-475` 先在事务中投影/按配置记录 durable event，才通知订阅者；`message-updater.ts:368-384` 已将失败 metadata 放进会话消息。后置遮盖或另写修正事件不能使首次写入的原值从未进记录；本票不增加事后清洗。
3. **模型当前不直接消费这份 metadata。** `SessionModelRequest` 在 `packages/core/src/session/model-request.ts:126` 经 toLLMMessages 降层；`runner/to-llm-message.ts:114-139,190-204` 的 toolResult 只用终态 content/error，不读 state.metadata，也不将 running progress 降层。Code Mode JS 仍从已遮盖的 child 结果取值（`codemode/tool.ts:147-158`）。模型另发工具查询/读取所得内容仍必须过 §4.5 的结果收口；不能据「直接降层不消费」豁免持久记录和实时卡。此判断只针对当前 Code Mode 进度链，不扩成所有 metadata 永远不会影响模型的承诺。

已重跑实施会话真实 PluginHost/Promise adapter/Tool/Code Mode 探针：从该会话的 `packages/ext` 执行 `bun test /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/codemode-mask-seam-el22rvgw/seam.test.ts`，exit **0**、1 pass / 0 fail，事实仍为 `virtualExecuteListed=false, liveContainsKnownValue=true, terminalContainsKnownValue=false`。它是缺口反例，不是隐私验收通过。

另在临时目录复用 `packages/core/test/session-runner-tool-events.test.ts:140-170` 的真实 AppNodeBuilder、Bus.configured({persist:true})、Database、SessionProjector 与 publisher；payload 行形状来自上述实际 Code Mode 探针，只将值换成进程内 UUID；直接调用 runner 取消路径实际使用的 failUnsettledTools，不用替身实现该收尾。命令（实施会话 `packages/core`）：`bun test /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/codemode-progress-r4-lhto64kj/record.test.ts`，exit **0**、1 pass / 0 fail / 2 expect。六项事实全真：桌面副本可遮；progress 无 durable row；随后取消的失败事件含原值；会话消息含原值；真实模型降层不含该值；在 publisher 接到 progress **之前**替换的干预对照使该失败记录不含值。只输出布尔值，不打印 UUID、不读取用户凭据。**观察**证明桌面单独遮盖不足；前置干预仅证明所需时点，不冒充已有 hook 或 SC-02 实现。

新工作树无安装依赖；未安装或改动环境，以上探针在已有依赖的实施会话执行。`git diff --stat HEAD 9a08725438 -- packages/core/src/bus.ts packages/core/src/session/projector.ts packages/core/src/session/message-updater.ts packages/core/src/session/runner packages/core/src/codemode/tool.ts packages/core/src/tool.ts packages/plugin/src` 在本设计基线上输出为空，所测生产链与本轮代码相同。初次在新工作树运行临时探针仅遇 import 缺依赖，未计为行为证据。

### v3.2：分页可复用，但 after 不是 read 的唯一发布口

**观察**：`packages/core/src/tool/read-filesystem.ts:292-328` 的 textPage/clampLine 为私有函数，行/字节/单行常量同属该 reader（`:14-20`）；扩展不能导入其服务实现，也不另抄分页器。原 read 的 `toModelContent`（`packages/core/src/tool/plugin/read.ts:258-293`）已经生成行号、页眉和 continuation；raw read 无 progress 调用，权限请求只含路径/来源（`:100,155-169`、`packages/core/src/file-access.ts:139-154`）。after 在输出校验之后、normalizeImages/截断/持久化/模型降层之前（`packages/core/src/tool.ts:142-179`、§2 原探针）；因此原页和原格式可以作为已完成的输入消费，勿复制或重新计算分页。

**反例**：原 read 的 `:127-152` 在返回前调用 SessionInstructions.load。`packages/core/src/session/instructions.ts:58-81` 读取邻近文件，并直接发布含全文的 durable Synthetic；`Context.session.hook("context")` 是模型请求阶段，`Context.event.subscribe` 在提交之后，均不能阻止这份原文进入记录。现有 SessionHooks 只有 prompt/context/compaction 等，没有这一发布前接口（`packages/plugin/src/promise/session.ts:191-207`）。SC-02 只处理根 progress，不覆盖该 synthetic。

临时探针复用 `packages/core/test/tool-read.test.ts:29-42,109-123` 的注册方式，使用真实 ReadTool、ReadToolFileSystem、本地 Environment、SessionInstructions、Bus/Database/SessionProjector 和真实 execute.after；只将权限问答与图像服务按原测试层替代。临时项目的 `.env` 取自实施②的 `fixtures/secret-files/node-env.txt`（provenance.json 记录 Node v24 官方 valid.env），只将一个既有赋值换成进程生成 UUID；邻近 AGENTS.md 复用该仓真实 AGENTS.md 并追加同一测试值。不读取用户凭据，不手写另一套引擎消息或外部格式。命令（实施工作树的 `packages/core`）：`bun test /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/safe-read-r6-zk4rkq5q/read.test.ts`，exit **0**、1 pass / 0 fail / 1 expect，六项事实全真：原 read 到达 after；after 整份替换后终态无值；无 read progress；权限预览无文件字节；synthetic 已存原值；真实 toLLMMessages 将其交给模型。只输出布尔值。探针初次缺测试图的 Database/PluginHooks 导出节点，补齐后测得上述行为；不把搭层错误当产品证据。

`git diff --stat HEAD 793fdff5db -- packages/core/src/tool/plugin/read.ts packages/core/src/tool/read-filesystem.ts packages/core/src/session/instructions.ts packages/core/src/file-access.ts` 为空；上述承重实现与本设计基线一致，复用已有依赖运行探针，未改本工作树生产代码。**裁决更新**：上述观察继承；r6 据此提出 SC-03，U-42/规格 v4 已将说明文件中的值不遮盖明确列入限制，因此不再要求补这个发布前口。after 负责既有 read 工具结果的安全视图；说明文件的初始加载、附带 synthetic 及模型消费沿原链路，按该限制处理。保持原分页与原指令加载能力，不新增分页出口、指令预处理、事后清洗或 Core 服务依赖。

### v3.3 / r8：单槽发布不足与流式写盘原语

本次只回答：同一 SC-01 回调怎样在不聚合密文余量的前提下发布多段安全文本；停止证据为原 normalizer 的反例、真实 writer 的顺序/背压原语以及合法 hook 分派口。实施④ `7908e114024b` 的 plan.md:337-343 已返回单槽接缝；`git diff --stat HEAD 7908e114024b -- packages/core/src/shell.ts packages/core/src/plugin/hooks.ts packages/plugin/src/effect/shell.ts packages/plugin/src/promise/shell.ts packages/session-ui/src/tools/ansi.ts` 为空。另查 Promise adapter，仅末尾 toolHook 增加 SC-02 的 execute.progress；shell 的泛型分派未变。

**观察**：Core 当前 pump（`packages/core/src/shell.ts:333-355`）顺序读取合并 stdout/stderr，逐块写入、累计字节/换行，关闭 writer 后打开 outputDone；SC-01 尚未实现。`PluginHooks.trigger`（`packages/core/src/plugin/hooks.ts:88-95`）逐个 await 回调、返回原事件；Promise shell adapter（`packages/plugin/src/promise/adapter.ts:660-662`）直接传同一事件，未复制或序列化它。因此可以在原事件提供进程内 Promise 函数，不必改 trigger/adapter 或增加发布后 hook。

临时原语探针命令（当前 `packages/core`）：`bun /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-r8-publish-6cfh4f78/probe.ts`，exit **0**。输入沿实施④合成控制字节：1 MiB 的 `ESC ] + x`，生产 `stripAnsi` 在补 BEL 后输出为空、补无效 `ESC X` 后完整保留；不读取用户数据、不复制正则。另用真实 createWriteStream（仅探针以 highWaterMark=1 强制背压）顺序 await 两次 publish，确认第一次内容在回调结束前已可读、第二次不越过 drain、字节/行数只计实际安全写入。五项布尔断言全真，不打印正文。此为 normalizer/writer 原语证据，**不是** Core SC-01、认证 spool 或全消费者故障实现证明。

**裁决**：单个 Uint8Array 必须聚合已消歧余量，块数组也保留全部安全余量；都不能成为长未闭合 escape 的正确出口。§4.5 改为回调存续期内的 publish 函数，每次解密/归一化/匹配出一段便 await 写盘，之后才读取下一帧；总长度不决定一次堆内聚合量。保留同一 start/chunk/end、同一 withheld 锁存及 end 原子替换，不另加异步迭代器的回调外消费生命周期。

### v3.4：规格 v5 的已实施事实

只回答：v3.3 §4.1/§4.3/§4.3.1/§4.4 中哪些句子与已实施的规格 v5 矛盾；停止条件是每条 v5 行为都对到一个现有 callable。均为 `3776643a6e` 的**观察**，正反证据见 plan.md:867-897 的红例与移除臂。

| 已观察的事实 | 证据与结论 |
| --- | --- |
| 项目外文件经 match 按项目规则判定，sources 不含 | `packages/schema/src/codepuppy-protected-files.ts:273-276` 在定位规则后追加 `outsideProjectRules`；`:388-399` 只对项目外路径生效，以该路径的文件系统根为根，复用 PROJECT 规则（固定位置加 `**/` 前缀）、示例排除与 DEPENDENCIES 剪枝，规则 ID 不变；`sources`（`:257-271`）只遍历 `locatedRules`。`probe`（`:292-311`）经 match 同时认它。 |
| 读过的项目外名单文件计入采集，不列目录 | `packages/ext/src/secret-mask.ts:229-232` 的 read 先 `files.track(input.file)`；`packages/ext/src/secret-files.ts:120-125` 在每次 refresh 对已 track 文件独立 stat/采集，`:146-148` 登记，`:162-166` dispose 清空；没有对其目录 readdir。 |
| env 只取凭据名与内嵌凭据字段，同一函数供三处 | `packages/schema/src/codepuppy-protected-files.ts:85` `CredentialFields.env = { names: "credential" }`；秘密词表 `:58-71` 含 `PWD`，`isCredentialName`（`:313-320`）对以秘密词结尾的名字片段也成立。`packages/ext/src/secret-values.ts:39-67` `embeddedFields` 不用 `URL.parse`，从原文逐处取 `scheme://` 授权段（止于 `/ ? #` 或空白）中最后一个 `@` 前、第一个 `:` 后的密码，空密码记 `whole`，并取凭据名键的 key=value 段的值；`:70-83` 解码失败只保留书写形；`:86-90` `embedded`、`:109-121` `envView`、`:123-125` `envSecret`。采集 env `:142-147`、assignments `:186`、结构化叶子 `:193-205` 都追加内嵌字段；read 视图 `packages/ext/src/secret-read.ts:76`、错误恢复判定 `secret-mask.ts:295` 消费同一函数。 |
| 写回按位置恢复只遮内嵌字段的值 | `packages/ext/src/secret-mutations.ts:136-158` 的 `restoreFields`：赋值值不是整个遮盖符、且当前同键同序号值的 envView 为 embedded 时，按出现顺序把每个遮盖符换回当前字段原文，其余文本保留助手所写；`:159-182` 的模板按同一视图匹配，后续位置按实际替换长度计偏移。项目外 env 经 `resolveProtectedFile`（`secret-files.ts:11-19`）随 match 覆盖。 |

## 4. 接口契约

### 4.1 单一名单与非密钥规则

共享纯契约放在现有 Schema 模块的 Code Puppy 自有文件，命名空间 `ProtectedFiles`。名单、示例排除、格式与 BR-06 判定同一权威、随应用发布；不增加用户设置、环境开关或第二份扩展名单。read、采集、风险分类都调用它。实现可选择私有的数据结构，以下消费边界固定：

```ts
type PathPlatform = "darwin" | "win32"
type ProtectedFormat = "env" | "ini" | "json" | "assignments" | "netrc" | "credential-url" | "sqlite" | "opaque"
type CredentialProfile = "env" | "credential-document" | "private-key" | "aws" | "docker" | "kube" | "npm" | "pypi" | "netrc" | "git-credentials" | "gcp-adc" | "gcp-credentials" | "gcp-access-tokens" | "azure" | "chromium-state" | "chromium-logins" | "chromium-cookies" | "firefox-logins" | "firefox-cookies" | "encrypted-store"
type ProtectedPathVariable = "AWS_SHARED_CREDENTIALS_FILE" | "AWS_CONFIG_FILE" | "DOCKER_CONFIG" | "KUBECONFIG" | "GNUPGHOME" | "GOOGLE_APPLICATION_CREDENTIALS" | "CLOUDSDK_CONFIG" | "AZURE_CONFIG_DIR"
type ProtectedRoots = {
  platform: PathPlatform
  project: string
  directory: string
  home: string
  appData: string       // win32：Roaming；darwin：Library/Application Support
  localAppData: string  // win32：Local；darwin：Library
  pathVariables: Readonly<Partial<Record<ProtectedPathVariable, string>>>
}
type ProtectedFile = {
  rule: string
  path: string
  format: ProtectedFormat
  profile: CredentialProfile
  view: "variables" | "notice"
}
// 同一份规则同时提供发现范围、路径匹配、命令载荷中的路径风险匹配。
declare const ProtectedFiles: {
  sources(roots: ProtectedRoots): readonly {
    root: string; include: readonly string[]; exclude: readonly string[]
  }[]
  match(input: { path: string; roots: ProtectedRoots }): ProtectedFile | undefined
  // v3.5（编排器裁决）：命令文本里的字面路径（绝对路径、去重），即 named 交给 match 的同一组候选
  literalPaths(input: { text: string; roots: ProtectedRoots }): readonly string[]
  // v3.5：命令文本里路径词经同一 match 命中的文件，按 path 去重；相对路径以 roots.directory 为基准
  named(input: { text: string; roots: ProtectedRoots }): readonly ProtectedFile[]
  probe(input: { text: string; roots: ProtectedRoots }): readonly string[] // named 命中文件的 rule ID（去重）
  isPublicValue(input: { name: string; value: string | number | boolean | null }): boolean
}
```

roots 全部必填，由宿主实际目录事实提供，不从工具输出或模型参数覆盖；没有机器绝对路径默认值。路径传入仍遵守现有 read 输入校验。`match` 是总函数：不适用返回 undefined，不读取文件，不请求权限。`named` 只对命令载荷中的路径词（引号内整段与按空白拆出的词，以及（v3.5 审查 R1）按 POSIX shell 规则还原的整词——去引号、还原反斜杠转义、反斜杠换行接行、相邻引号段与裸段相接，如 `../x/\.env`、`"../x y"/.env`；去掉 `--opt=`/`NAME=` 前缀与 `@`，`$HOME`/`${HOME}` 展开为 roots.home）调用同一 `match` 做词法探测，不读文件、不请求权限；原有候选全部保留，`probe` 对原已识别输入的结果不变；`probe` 取其结果的 rule ID（因而两者都与 match 同样认下文的项目外范围），不能另抄受保护路径正则；无法从命令推断某个动态路径属于既有风险标注能力的边界，不影响匹配已解析文件。

现有 `classifyPermissionRequest` 的输入增加必填 `protectedRoots: ProtectedRoots`；permission、patterns、always、metadata 的形状与结果维持原契约。调用方从同一 Location 的 SecretMask 路径事实供数，不在分类器里做 IO，也不从审批 metadata 反推可信根。现有 gate 和能力轴调用共同消费这一个参数，不能让无根调用退回另一张旧正则表。

首版名单与 profile 是同一份发布数据。项目的递归文件名规则只发现项目自己的文件；默认剪枝 `node_modules`、`vendor`、`.venv`、`venv`、`site-packages` 这类依赖树，不因依赖自带 `.env` 把第三方样本纳入匹配集。名单中的显式文件/目录位置或已支持的显式凭据路径变量仍优先，即使落在依赖树内也直接处理；这种例外由同一名单判定，不增加用户配置。match、sources、probe 消费相同的规则、示例排除与依赖树剪枝，不能只剪枝采集而让读工具持有另一套名单。其它项目目录不因 `.gitignore` 跳过，按真实身份去重以终止符号链接环。

**项目外范围（v3.4，规格 v5 BR-05）**：路径落在 `roots.project` 之外时，`match` 在全部定位规则之后再用同一份项目规则判定——项目文件名规则原样、项目固定位置（如 `config/master.key`）加 `**/` 前缀，以该路径的文件系统根为根，沿用同一示例排除与依赖树剪枝，返回的 `rule` ID 与项目内相同；因而另一个项目的 `.env` 得 env/variables，项目外 `*.pem` 等得 opaque/notice，与项目内一致。`sources` **不含**这一范围：不预先扫描、不遍历其目录；这类文件只在读文件工具读过之后，或（v3.5，规格 v6 BR-05）shell 命令里字面写出其路径时，由 §4.3 的已登记文件来源计入采集。`ProtectedFiles` 签名不变；风险标注、结果里的文件引用和 §4.3.1 写回都经 match 自然覆盖它。

| 位置 / 文件族 | 格式与直接读视图 |
| --- | --- |
| 项目任意层级 `.env`、`.env.*`；末尾为 `.example`、`.sample`、`.template` 的示例除外 | env / variables；排除必须先于 include |
| 项目任意层级 `.envrc`、`secret.env`、`secrets.env` | env / env profile / variables；静态解析 `export K=V`，按下述 env 凭据字段规则取值（凭据名变量与值里内嵌的连接地址密码）；不执行 shell、命令替换或变量展开 |
| 项目任意层级 `secret` 或 `secrets` 的 `.json/.yaml/.yml/.toml`、`credentials.json` | JSON 或 assignments / credential-document / notice；不执行 YAML 标签/插值 |
| 项目的 `config/master.key`、`config/credentials/*.key`、`config/credentials*.yml.enc`；项目私钥容器 `*.pem/*.p12/*.pfx` | opaque / notice |
| 项目及主目录的 `.netrc`、`_netrc`、`.npmrc`、`.pypirc`、`.git-credentials` | 对应 netrc、npm、pypi、git-credentials profile；notice |
| 主目录 `.ssh/**`，公开文件 `*.pub`、`authorized_keys`、`known_hosts`、`config` 除外 | opaque / notice；非默认文件名的私钥仍能发现 |
| 主目录 `.aws/credentials`、`.aws/config`、`.aws/sso/cache/**`、`.aws/cli/cache/**`、`.docker/config.json`、`.kube/config` | INI/JSON 的 aws、docker、kube profile；notice；AWS 两类登录缓存也是显式保护目录 |
| 主目录 `.azure/msal_token_cache*`、`.azure/accessTokens.json`、`.azure/service_principal_entries.*`；gcloud 目录的 `application_default_credentials.json`、`credentials.db`、`access_tokens.db` | JSON 对应 azure/gcp-adc；两个 gcloud 数据库用 sqlite 的 gcp-credentials/gcp-access-tokens profile；加密缓存用 encrypted-store；notice |
| GnuPG 目录的 `private-keys-v1.d/**`、`secring.gpg`；macOS `Library/Keychains/**`、`*.keychain`、`*.keychain-db` | opaque / notice |
| 浏览器 profile 的 `Login Data`、`Cookies`、`Network/Cookies`、Firefox `cookies.sqlite`、`logins.json`、`key4.db`，以及其 SQLite `-wal/-shm`；Chromium 的 `Local State` | 分别使用 chromium-logins/chromium-cookies/firefox-cookies 的 sqlite profile、firefox-logins/chromium-state 的 JSON profile；key4.db 为 encrypted-store。均 notice；不纳入全部缓存/历史 |
| Windows 用户凭据目录 `Microsoft/Credentials/**`、`Microsoft/Vault/**`、`Microsoft/Protect/**` | opaque / notice；Roaming 与 Local 两个根分别匹配 |

主目录产品路径具体展开见 §4.2。现有风险器中 `/etc/passwd`、`/etc/shadow`、`/etc/sudoers` 的系统风险仍由原风险权威持有，不冒充本名单中的密钥文件。风险器只移除已归入 ProtectedFiles 的重复路径定义，其余规则与风险档位不变；命中本名单仍通过原有 `credential-path` 信号抬到已有风险档。

凭据值提取也由这份发布数据持有：**（v3.4，规格 v5 BR-06）env 与 credential-document 同一判定 `CredentialFields.env = { names: "credential" }`**——只有名字含秘密词（下述同一 `isCredentialName`）的变量的值是秘密，其它变量的值原样，不再每个值默认秘密；非 env 只提取该文件 profile 的凭据字段，不把每个标量、非空行、整个 JSON 文本或整库字节作为匹配单位。

**值里内嵌的凭据字段（v3.4，规格 v5 BR-06；审查 R1 修订）**：以下两类值内片段是凭据字段，不论变量或字段名，从原文直接取跨度，不用 `URL.parse`：

1. **连接地址密码**：值中每一处 `scheme://`（scheme 为 `[a-z][a-z0-9+.-]*`，大小写不敏感）之后的授权段止于 `/`、`?`、`#` 或空白；用户信息取到授权段内**最后一个** `@`，其中第一个 `:` 之后到该 `@` 之前为密码。因此多主机地址、一个值里的多个地址、未编码的 `@` 都按整段密码各自取出；没有 `@` 或用户信息里没有 `:` 的不是凭据形状。形状成立但密码为空（`user:@host`）时**整值为秘密**。
2. **凭据名键的 key=value 段**：值中位于开头或 `;`、`&`、`?`、空白之后的 `键=值` 段，键通过下述同一 `isCredentialName` 时（例如 ADO/ODBC 的 `Password=…;`、`Pwd={…}`，查询参数 `?password=`、`&pwd=`），只取该段的值；值可为双引号、单引号、花括号包裹（取包裹内）或止于 `;`、`&`、空白、`#`。

匹配单位为每个字段的书写形与 `decodeURIComponent` 解码形；解码失败（如 `%9A`）只保留书写形，不使本次采集失败。字段以字段名 `password` 交同一 `secretScalar`，因此不享受公开豁免。它在 env 的每次赋值、credential-document/JSON profile 的每个叶子、assignments profile 的每行值上一并采集；sqlite、netrc、credential-url 与原始单位 profile 不变。env 的直接读视图、diff 投影与错误恢复共用同一个 env 视图判定（`envView`，§2 v3.4）：凭据名 → 整值遮盖；否则有空密码形状 → 整值遮盖；有内嵌字段 → 只把这些字段在 RHS 原文中的跨度换成遮盖符，主机、用户名等其余原样；RHS 去掉外层引号后取出的字段与解析值的字段不一致（引号/转义改变了字段）时整值遮盖，不猜测；都不是 → 原样。不新增配置、不对其它 URL 部件或任意值做识别。未列中的字段不贡献值；结构化解析失败进入遮盖失败处理，不能退回「整段 opaque 文本」来制造短匹配项。

| profile | 只提取的字段 / 单元格 |
| --- | --- |
| chromium-state | `os_crypt.encrypted_key` |
| docker | `auths.*.auth`、`auths.*.identitytoken`；不提取 `credsStore`、`credHelpers`、版本/主机名 |
| kube | `users[*].user.token`、`client-key-data`、`password`，以及该 user 的 `auth-provider.config` 中 access-token/refresh-token/client-secret/id-token；不提取 apiVersion、kind、cluster/server、证书路径或布尔开关 |
| aws | INI 各 section 的 `aws_access_key_id`、`aws_secret_access_key`、`aws_session_token`、`session_token`、`security_token` 和 `aws_*_key`；sso/cache JSON 的 accessToken、refreshToken、clientSecret；cli/cache JSON 的 `Credentials.AccessKeyId` / SecretAccessKey / SessionToken。region、output、account、expiry 不贡献匹配项 |
| npm / pypi / netrc / git-credentials | npm 的 `_authToken`（含 registry 前缀）、`_auth`、`_password`、password；pypirc 的 password；netrc 的 password；git 凭据 URL 的 password。用户名、registry、机器名不贡献匹配项 |
| gcp-adc / gcp-credentials JSON | refresh_token、client_secret、private_key、password、access_token、id_token、rapt_token；不提取 type/client_id/project_id/token_uri、空对象或 metadata |
| azure | accessToken/access_token、refreshToken/refresh_token、secret、client_secret；service_principal_entries.json 数组项的 client_secret、client_assertion；`.bin` 按 encrypted-store 不解密。不提取 account、realm、target、expiry、certificate 路径或开关 |
| firefox-logins | `logins[*].encryptedUsername` / `encryptedPassword`；不尝试解密 |
| credential-document（secrets/credentials JSON/YAML/TOML） | 只取语法上秘密字段的标量（同一秘密词规则）；不取整个文档或任意标量；envrc 不属于此 profile |
| private-key / encrypted-store | 私钥完整块及正文行；其它不透明加密存储只匹配原始字节单位，不解密、不切出任意短字符串 |
| gcp-access-tokens（sqlite） | `access_tokens.access_token`、`rapt_token`、`id_token`；account_id、token_expiry、regional_access_boundary、regional_access_boundary_expiry 不提取 |
| gcp-credentials（sqlite） | `credentials.value` 作为 credential JSON 解码后仅取上列字段，不把整个 BLOB 或每个 JSON scalar 当作秘密 |
| chromium-logins / chromium-cookies / firefox-cookies（sqlite） | `logins.password_value`；`cookies.value` / `encrypted_value`；`moz_cookies.value`。加密 BLOB 不解密，明文单元格直接贡献值 |

SQLite 始终以主库路径 `new DatabaseSync(path,{readOnly:true,allowExtension:false})` 打开，用固定发布表/列与 `prepare(...).iterate()` 流式读取，完成后关闭。只允许 SELECT/只读 schema 检查，不执行库中提供的 SQL、写 PRAGMA、迁移或扩展加载；不设 immutable 绕开 WAL。伴随 `-wal/-shm` 仍是受保护位置，但采集通过主库正常 SQLite 快照读取，不把日志页拆成秘密；缓存身份包含主库及伴随文件。schema 列名来自发布数据，值绝不拼进 SQL。[Chromium 密码列](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/password_manager/core/browser/password_store/login_database.cc)、[cookie 列](https://chromium.googlesource.com/chromium/src/+/643cdf61903e99f27c3d80daee67e217e9d280e0/net/extras/sqlite/sqlite_persistent_cookie_store.cc)及 [Firefox cookie 源码](https://raw.githubusercontent.com/mozilla-firefox/firefox/main/netwerk/cookie/CookiePersistentStorage.cpp)支持浏览器列的落点；gcloud 的固定版本与实测见 §2。

BR-06 在**所有格式**应用。先按 camelCase/非字母数字拆出键名词；秘密词为 KEY/TOKEN/SECRET/PASS/PASSWORD/PASSWD/PWD/CREDENTIAL/CREDENTIALS/AUTH/AUTHORIZATION/PRIVATE（大小写不敏感；`PWD` 为 v3.4 审查 R1 修订所加）。名字片段等于秘密词，或（v3.4 审查 R1 修订）以秘密词**结尾**（如 `PGPASSWORD`、`APIKEY`、`SECRETKEY`、`ACCESSTOKEN`、`oauth`），都算有秘密词；env 与结构化文件共用这一判定。键名有秘密词时不授予下述公开豁免，例如 `PASSWORD=1234` 仍是秘密。没有秘密词时：

| 明显非密钥的发布规则 | 公开值 |
| --- | --- |
| 空值与类型标量 | 空/null、boolean、有限数值及其十进制/科学记数法字符串 |
| 开关 | true/false、yes/no、on/off（大小写不敏感）；0/1 已由数值规则覆盖 |
| loopback 主机名/地址 | localhost、localhost.localdomain、`.localhost` 名称、127/8、`::1`（含方括号）；不把含凭据的任意 URL 当主机名 |
| 日志级别 | trace/debug/info/warn/warning/error/fatal/off/silent（大小写不敏感） |
| 环境名 | NODE_ENV/APP_ENV/ENVIRONMENT 下的 development/dev/test/testing/staging/stage/production/prod/local |

先选凭据字段、再按同一公开规则筛选；因此 Local State/AWS/Kube/Docker 的普通 `0`、`1`、`json`、`v1`、`{}` 从来不进入匹配集。env 中非凭据名变量的值只贡献内嵌密码（v3.4），凭据名变量的非空值没有公开豁免，也没有最短长度或熵阈值。若真正秘密字段的值恰好等于普通文本，仍按规格的同值误遮边界处理；不能为了掩盖错误的字段提取而添加长度门槛。

### 4.2 Windows 与 macOS 路径

Windows 的 home 使用宿主 `os.homedir()`（一般为 USERPROFILE）；APPDATA、LOCALAPPDATA 使用宿主进程的实际值，缺席时分别以 home 下 `AppData/Roaming`、`AppData/Local` 推导。比较使用 `path.win32`：统一 `/` 和 `\`、盘符/路径大小写、`.` / `..`、UNC 与 `\\?\` 表示；按完整路径段匹配，不能用字符串前缀把 `.ssh-copy` 算作 `.ssh`。macOS 保持本平台路径语义，不把 Windows 的不区分大小写规则无条件套到 Unix 路径上。

物理读取前同时判定词法路径与 `realpath` 目标，任一命中即保护；发现符号链接/Windows reparse point 时用真实身份去重。程序看到的文件和链接都不改动。Windows 上真实文件身份、junction/短文件名需要真机证明，纯 `path.win32` 推断不能充当这份证据。

| 内容 | macOS 根 | Windows 根 |
| --- | --- | --- |
| SSH、AWS、Docker、Kubernetes | home 下 `.ssh/.aws/.docker/.kube` | home 下同名目录；Kubernetes 文档明确使用 USERPROFILE |
| GCP / Azure | `~/.config/gcloud`、`~/.azure` | `%APPDATA%/gcloud`、`~/.azure` |
| GnuPG | `~/.gnupg` | `%APPDATA%/gnupg`；另识别 `~/.gnupg` |
| 钥匙串 / 用户凭据 | `~/Library/Keychains` | `%APPDATA%/Microsoft/{Credentials,Vault,Protect}` 与 `%LOCALAPPDATA%/Microsoft/{Credentials,Vault,Protect}` |
| Chrome / Chromium / Edge / Brave | `~/Library/Application Support/{Google/Chrome,Chromium,Microsoft Edge,BraveSoftware/Brave-Browser}` 下每个 profile | `%LOCALAPPDATA%/{Google/Chrome,Chromium,Microsoft/Edge,BraveSoftware/Brave-Browser}/User Data` 下每个 profile |
| Firefox | `~/Library/Application Support/Firefox/Profiles` | `%APPDATA%/Mozilla/Firefox/Profiles` |

已查公开一手依据：[OpenSSH 配置根](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-server-configuration)、[AWS 凭据位置](https://docs.aws.amazon.com/sdkref/latest/guide/file-location.html)、[GCP ADC](https://docs.cloud.google.com/docs/authentication/application-default-credentials)、[Azure 配置根](https://learn.microsoft.com/en-us/cli/azure/azure-cli-configuration)、[Kubernetes 用户配置](https://kubernetes.io/docs/tasks/access-application-cluster/configure-access-single-cluster/)、[Chromium 数据目录](https://github.com/chromium/chromium/blob/main/docs/user_data_dir.md)、[Firefox profile](https://support.mozilla.org/en-US/kb/profiles-where-firefox-stores-user-data)、[GnuPG 厂商位置说明](https://www.gnupg.com/kb/backup-restore.html)、[Microsoft 用户凭据目录](https://learn.microsoft.com/en-gb/fslogix/concepts-container-types)。Edge/Brave 的具体目录、Vault/Protect 的组合与各格式提取尚未真机核验，不能宣称 AC-07 已通过。

应用不增加凭据路径设置。已有工具的显式路径环境变量（如 AWS_SHARED_CREDENTIALS_FILE、DOCKER_CONFIG、KUBECONFIG、GNUPGHOME、GOOGLE_APPLICATION_CREDENTIALS）由同一名单解析；KUBECONFIG 使用运行平台的 `path.delimiter` 拆成多个路径（Windows 为 `;`、macOS 为 `:`），忽略空项并逐个规范化、注册来源，不能把整个字符串当成一个文件。跨平台样本用对应 `path.win32.delimiter` / `path.posix.delimiter`，不会按宿主分隔符拆坏 Windows 盘符。宿主当前环境的这些路径补充默认根而不是替换默认保护，不把环境变量的值发给模型；名单之外不新增任意命令参数、注册表或子进程临时环境的路径发现器。

### 4.3 采集、外层事务与私有材料

扩展为每个 Location 建一个私有 SecretMask，按名单 profile 读取两类来源：`sources` 给出的项目/主目录（含显式路径变量），以及（v3.4，规格 v5 BR-05）本 Location 内读文件工具已读过的项目外名单文件——SecretMask.read 先登记该 ProtectedFile，以及（v3.5，规格 v6 BR-05）shell 命令字面写出的这类文件——Shell `create.before` 时由 `SecretMask.command` 以该命令的工作目录（相对 Location 目录解析，开头 `~` 按 roots.home 展开，与引擎解析 `workdir` 同义）为相对路径基准调用 `ProtectedFiles.named` 并逐个登记；已登记文件（read 与命令登记共用）每次在 stat/采集前同样经 SPEC5-04 的逐级字面软链边界（`packages/ext/src/secret-files.ts:150-151`、`literalTarget` `:209-227`），按字面逐级算出的目标离开所有采集来源的软链不 stat、不采集，不是软链的项目外名单文件照常采集（v3.5 审查 R1）；命令写出的字面路径本身是软链时（v3.5 编排器裁决，规格 v6 限制表的软链行），`SecretMask.command` 对 `ProtectedFiles.literalPaths` 的每个路径调用 `files.trackLink`（`packages/ext/src/secret-files.ts` 的 `trackLink`），用同一 `literalTarget` 逐级 readlink、不 realpath、不 stat 中间目标，且只读采集来源之内或本身是名单文件的那一跳；最终字面目标是名单文件即登记该目标、在 capture start 读出，名单外、断链、成环或读不了则跳过。因此指向来源之外普通位置（例如应用自有凭据存放点）的软链一跳也不碰，名单形状但读不了的目标只在登记时 readlink 一次、不登记、之后不再碰；项目扫描的 SPEC5-04 不变；登记同步、不读文件，读取发生在随后 capture start 的采集（Core 顺序为 create.before → capture start → spawn，`packages/core/src/shell.ts:303,343,363`），因此该命令的第一段输出起即按其值遮盖。登记的文件之后每次采集与其它来源一起处理，Location 释放时清空；不预先扫描项目外、不对其目录 readdir。create.before 早于 Core 自己的工作目录解析与审批，被拒的命令也已登记其文件，只会多遮、不放出内容；已在 sources 内的路径重复登记只多一次 stat。边界按规格 v6 限制表：变量或其它命令拼出的路径、先 `cd` 再写的相对路径不认，这类项目外名单文件在读文件工具读过或被字面写出之前不贡献值；经按字面指向所有来源之外的软链打印的文件不遮盖（SPEC5-04 边界，规格 v6 限制表编排器补记行）。不是模型可调用工具，不把值放入 main/UI/storage。Schema 只持有发布规则与固定说明。每次根工具调用前采集，普通工具/连接器结果到达时再采集；shell start 前采集、每个直播 flush 前检查目录变化并重读变化来源、end 再采集。读到的值保留至 Location 释放，不在并发输出仍可能引用旧值时撤销。

允许跳过未变来源的重读，唯一缓存键为 `(dev,ino,size,mtimeNs,ctimeNs)`，取 `fs.stat({bigint:true})`；任一不同就读内容，不能仅看 mtime。SQLite 同时纳入主库、WAL、SHM 的身份；发现/消失也算变化。新受保护文件的发现使用目录五元组缓存：首次按 sources 建立已发现目录/候选文件集合；每次 flush stat 已发现目录，只对目录 stat 变化的那一层 readdir，新增子目录首次发现时按同一剪枝规则遍历。不存在的发布根保留最近现存父目录的变化检测；子目录各自 stat，不能用祖先目录未变推断整棵树未变。已知文件仍独立 stat，不能漏掉不改变目录 stat 的原地写入；已读的项目外名单文件只以文件自身 stat 五元组判定变化，沿用同一缺失/不可读重试；不逐 chunk 全量递归 readdir，也不依赖 watcher。没有 TTL 或自行选择的数量/长度上限。ENOENT/EACCES/EPERM 表示该次缺失/不可读，不贡献新值，后续仍重试判定；其它无法完成采集/解析/匹配的异常进入本次隐藏分支。

`(sessionID,messageID,id)` **仅作外层事务键**。begin 放在现有 `policy.seal()` 登记的尾部 execute.before 回调（`packages/ext/src/policy/index.ts:248-264`）内，confirm/pin 完成后的最后一步，而不是较早的 plugin.ts:195 回调：审批拒绝尚未创建遮盖事务，begin 自身不向闸门抛错。普通根调用建立普通状态；合成 execute 根调用建立 Code Mode 外层状态。该键已有活动 execute 时，随后的子工具 before 不 begin；子工具 after 只做**无调用状态的** Location retained-values + 结果时重读/遮盖，不 end/delete 外层，也不把子工具故障锁存到其它子工具。正常完成只有外层 execute 的 after 结束它；根中断/defect 的回收用现成 Context.event.subscribe 收到对应 Tool.Success/Failed 后按 `(sessionID,assistantMessageID,id)` 释放根缓存，Location 释放仍清所有材料。此订阅只作进程内清理，不能承担遮盖或阻止原值入库。child input/update 不写外层的进度缓存；原引擎也已把 child progress 设为空。shellID 的捕获状态是独立的进程流生命周期，多个 Code Mode shell 子调用各有 shellID，不能与共享工具事务键混用。

```ts
import type { Tool } from "@opencode/schema/tool"

type MaskCall = { sessionID: string; messageID: string; id: string }
type EnvMutation =
  | { operation: "write"; path: string; content: string }
  | { operation: "edit"; path: string; oldString: string; newString: string; replaceAll?: boolean }
  | { operation: "patch"; patchText: string }
type SecretMask = {
  begin(input: { call: MaskCall; kind: "tool" | "execute" }): Promise<void>
  read(input: { call: MaskCall; file: ProtectedFile; result: Tool.Result }): Promise<Tool.Result>
  result(input: { call: MaskCall; tool: string; result: Tool.Result }): Promise<Tool.Result>
  error(input: { call: MaskCall; tool: string; error: Tool.Error }): Promise<Tool.Error>
  progress(input: { call: MaskCall; update: Tool.Metadata }): Promise<Tool.Metadata>
  prepareMutation(input: EnvMutation): Promise<EnvMutation>
  stream(input: ShellCapture): Promise<ShellCapture>
  command(input: { command: string; cwd: string }): void // v3.5：create.before 时登记字面路径命中的文件
}
```

这些是明确决定的扩展能力；read 消费原工具已经编码的 Tool.Result，不重声明 TextPage/输出 schema。§4.9 的说明文件链路按规格 v4 限制处理，不新增 instructions 接口；其余接口授权不变。result/error 根据活动外层与事件 tool 判定根/子，不依靠不存在的独立子调用 ID。begin 自身采集失败只标记根事务，不阻止原工具执行；子调用只把本次无法遮盖的结果换说明，外层仍可继续。固定 `MASKING_FAILED_TEXT = "这次输出没能遮盖，已隐藏"` 归 Schema 同一权威，不再经过 masker。

env（包括 `.envrc`）静态解析用 `node:util.parseEnv` 读取可识别的赋值，并由同一 env 解析边界保留每个键的**出现序号及原 RHS 词法跨度**；`export K=V` 与普通赋值同义，安全变量视图按源文件顺序保留重复键，采集每次出现中按 §4.1 env 凭据字段规则选中的值（凭据名变量的值与内嵌连接地址密码）而非只用最终 map。未识别的 `.envrc` shell 语句不执行、不返回原文；不执行 shell、include、命令替换或变量展开。其它格式仅按 §4.1 的 profile 提取；SQLite 单元格/JSON 字段不是整个文件，也不把 JSON 错误退化为不透明全文匹配。私钥与真正加密容器仍按其专用原始单位，解密后才出现的值沿用 v2 排除。

原值、匹配材料和加密 key 不出该引擎进程。普通工具当前结果占用原有执行器结果内存；shell 不在内存积累全量原文，按 §4.5 加密落临时文件，内存只保留当前 chunk、匹配尾部与必要解析状态。不得把原文、值的 hash、私钥或 key 写入诊断/trace；JS 字符串释放不等于可证明擦除，仍不抵抗原生插件/调试器读进程内存。

### 4.3.1 env 写回保值

仅包装身份权威确认的内置 write/edit/patch。执行器包装位于 `tool.transform`，在 before/pin 之后调用原 execute 时传**局部恢复副本**，不改已冻结 event.input。prepareMutation 无子调用事务状态，只用目标文件当前可读文本，不从 Location 的跨文件匹配集合猜值，不另写文件、不绕过原审批/锁/formatter。

- write：对 env-format 受保护目标，完整赋值行的值恰为 `[REDACTED]`（含语法引号）时，以该文件**同一键第 n 次出现的当前 RHS（n 为该键在对应文件中的出现序号）**替换；新给出的真实值、非 env 文件和不相干行不变。
- （v3.4，审查 R1 修订）只遮内嵌字段的值：赋值的值含 `[REDACTED]` 但不是整个遮盖符，且对应文件同键第 n 次出现的当前值按 §4.1 env 视图是「只遮内嵌字段」时，**按位置恢复**：所写值里的遮盖符按出现顺序依次换成当前值中对应内嵌字段（密码或凭据名键段的值）的原文，助手对主机、用户名、其余参数等的改动原样保留；遮盖符多于当前字段数时，多出的保持原文。当前值不是这种视图（整值秘密或公开）时不按此规则恢复，继续原工具语义（write 照写所给文本；edit/patch 定位不到时沿用 `secret-mutations.ts:61` 的具名定位错误）。write/edit/patch 三者共用此规则；edit/patch 定位 oldString 与上下文行时，模板同样按该视图生成，长于一个遮盖符的视图之后的位置按实际替换长度计偏移。不跨键或跨文件猜值。
- edit：按原 edit 的定位语义，把 oldString 的行映射到目标全文的键出现序号，再恢复 oldString/newString 的对应占位符；replaceAll 的每个匹配分别映射，不能把片段里第一个键误当全文第一次。前者才能匹配真实源文本，后者才能保住未修改秘密。
- patch：先用既有 Patch.parse 区分 add/update/delete、源/移动目标和 oldLines/newLines；上下文/删除行用源文件对应键出现序号的当前值，新增/保留行按 hunk 与完整目标文本定位对应出现序号；移动到尚不存在的目标时沿用源文件相应出现序号。由包装内唯一的序列化逻辑按已有 Patch.Hunk 语法重建原 patch，路径、删除/移动操作、普通行、行尾和 BOM 保持原语义，不手写第二个 patch parser。

恢复索引是 `(目标文件, 键, 出现序号)`，不能用 parseEnv 的最后一值覆盖同键各行；用当前文件词法记录取得 RHS，绝不从结果 map 丢失序号后猜回。对应键的该次出现必须实际存在；目标/该次出现确实不存在时不跨文件/跨键或用旧快照捏造恢复，继续原工具语义。读取/解析现有键失败沿用原工具的具名 IO/格式错误，不将尚未解析的既有键占位符写盘；不另加确认或权限策略。恢复读取发生在执行器准备原调用时，沿用原工具对外部并发修改的既有语义，不承诺新增跨进程写事务。原始 RHS 的引号、转义、多行值由同一 env 词法跨度恢复，不是字符串替换全局 `[REDACTED]`。恢复值同时加入 Location retained values；写入后的结果/diff 和审批预览仍遮盖，不能把真实 RHS 经 metadata 反送给助手。

权限预览消费现有 `Context.permission.hook("evaluate")`，在请求发布前用已采集值原位替换 metadata 的动态 diff/files；不修改权限 effect。遮盖失败只使预览正文显示固定说明，不改变原写入审批结局。写回仍完全由原 execute/FileWrite/FileMutation/Patch 完成，既有 read view 使助手看不到恢复出的值。

### 4.4 直接读：前置说明、原页后置变量视图

仅包装身份权威确认的内置 read；自动化先走原拒绝，整只工具被停用仍由策略权威拒绝。前置使用同一词法路径/realpath 保护判定，不调用 Core 服务，不修改 pin 后的 event.input。

1. **non-env 保护文件**：保留原设计的执行前说明分流，不调用原 read/authorizeRead，不读出附件或私钥正文，不发 read/external_directory 卡片。说明结果由原注册 tool.output codec 解码固定说明 DTO 后交原输出编码，不手写 TextPage 类/schema；已有实施 codec 探针证明这一路合法，不需要构造器接管。不存在/不可读来源保留具名读失败，不假装文件存在。
2. **env 保护文件**：改为调用原 execute，offset/limit 不改；原 reader 负责行/字节/单行裁剪、EOF/越界、TextPage 或 utf8 FileContent、行号/页眉/续页提示。env profile 的路径在项目内，或（v3.4）是 §4.1 项目外范围按项目规则命中的 env 文件，后者以其自身路径执行；若只是项目外别名的 realpath 命中项目 env，则原 execute 的局部副本使用同一已核实项目目标路径，前后展示仍为原请求路径。词法项目 env 指向外部的链接仍按其词法保护路径执行。此为同文件路径归一化，不换 agent、不生成 grant、不松开只读档的普通外读 deny；非 env 的外部保护文件始终走上一分流。
3. **安全页投影**：在最终 execute.after、通用投影之前，SecretMask.read 同时改写 output 与 content，说明置于正文页外。`type/mime/offset/truncated/next` 作为分页结构消费，安全正文不重新触发原物化 URI/附件。消费原 output 的类型、offset/truncated/next 和原 content 的公开行号格式（read 的 description 明示 `<line>: <content>`），保留引擎生成的页眉、行号及 continuation；不重新数行、限页、裁字节或从完整文件补回未选中的内容。通用结果收口最后仍执行，不重新用 read 输出 codec 拒绝已经安全的结果。
4. **按源位置生成变量视图**：用同一 envAssignments 的键出现序号/RHS 词法跨度和调用前后可核实的源快照，对原页中可见区间逐行投影。已识别赋值保留可见变量名，按 §4.1 env 视图判定：凭据名变量的 RHS 为遮盖符，含内嵌凭据字段的 RHS 只把这些字段换成遮盖符（v3.4），其它值原样；跨页的引号/多行 RHS、仅剩前缀的长行同样按源跨度遮盖，不能只 exact-match 页面里的完整值。注释/未解析内容不透传；保留原页的行槽和前缀，不重排重复键或把下一页内容塞进本页。页与源快照无法对应时整次隐藏，不猜测为公开值。
5. **错误、附件及其它读取**：原 read 的正常 IO/二进制/越界错误没有文件正文，仍经已有 error 收口去 cause；投影/解析失败只返回固定隐藏说明。若声明为 env 的文件实际返回 media/base64/list 等非文本结果，删除整份原 output/content/附件，换说明，不能交给后续 normalizeImages。未命中保护的 read 保留原实现与通用结果遮盖。原 read 仍会先发布邻近指令；§4.9 按规格 v4 明确这条说明文件链路不遮盖，不将其视为遮盖步骤故障。工具结果的 output/content、错误和附件继续按本节及通用收口处理。

保留删除交互 `.env` ask/deny 注入的既有决定；引擎原 build 底座的 `.env` ask 在已核实受保护 env 调用（项目内，或 v3.4 起 §4.1 项目外范围命中的 env）的 permission.evaluate 中按同一读关联改为 allow，询问/只读档删冲突条目后按原 read allow。三档的 non-env 保护读不触发授权；自动化原 `.env` deny 不变。不得把项目外普通 read 的 BR-05 例外扩大到其它档位/写操作，也不翻转用户已有的其它显式 deny。

### 4.5 通用工具结果与 shell 捕获

遮盖符固定为 `[REDACTED]`，说明固定为规格原句；没有新配置键。源文件/子进程环境/传给程序的入参不改动。

通用结果在现有 `execute.after` 的扩展处理尾部，**所有现有云校验、错误归因与 display metadata 附加之后**执行。成功结果同时处理 content、output、metadata；错误重建 `Tool.Error`，遮盖 message、metadata，移除可能携带原文的内层 error/cause；没有捕获失败后返回原对象的分支。结构化 output 的标量若命中秘密可变为遮盖字符串，不能重新跑原工具输出 schema 把这份安全结果拒掉；当前执行器正是在输出校验之后运行 after（§2 已观察）。

文本按原样、左到右、同位置最长值优先替换；一次替换不递归处理新遮盖符，避免值重叠泄漏或二次遮盖污染。覆盖嵌套 JSON 的字符串和数值标量、动态键名、metadata；协议 envelope 的 type、调用 ID 等引擎结构字段保持合法，不能因误遮把 Tool.Content 判别联合破坏。动态键名遮盖产生碰撞时，该对象以一个遮盖符代替，不能把两个不同字段拼成新的泄漏内容。

Tool.Content 的文本、文件 uri/name 都属于处理面。内联 data URI 先按协议还原载荷再查原样值；文本载荷可替换后重编码；二进制载荷命中时以一个 text 遮盖符替换该文件 content，避免把损坏的图/PDF交给模型。文件引用如果指向受保护文件则换说明；非保护文件的内联字节同样检查。只检查原始字节，不承诺 OCR、解密、解压或程序额外编码的识别。MCP 非内联二进制资源已保存到普通工具产物时，后续读取仍经过同一结果遮盖，不能把产物路径当作安全证明。

普通已注册工具的进度继续用现成 tool.transform 包装，可信运行标识/display 立即发布；输出字段用当前 retained values 加重读处理，失败隐藏该 update。**外层 execute 不在该包装范围，改由 §4.8 的已批准 SC-02 承担发布前遮盖；现有接口尚不能闭合此保证。** Code Mode children 不建进度/结果事务；child 结果在交给 JS 前无状态遮盖，外层终态仍在 after 重遮盖，不能让 child after 清掉 outer。不得把成功终态已遮盖当成外层直播/取消记录已安全。

**已批准接管 SC-01** 保留 shell.capture，规则仍在扩展。v3.3 将单槽改为回调内多段 publish；同一 Core Shell 生命周期、终态文件替换及 Effect/Promise 两面同形不变：

```ts
import type { Shell } from "@opencode/schema/shell"
import type { ShellCreateBefore } from "@opencode/plugin/promise/shell"

type ShellCapture = {
  readonly id: Shell.ID
  readonly phase: "start" | "chunk" | "end"
  readonly file: string // Core 给出的实际捕获文件，决定加密暂存目录
  readonly withheld: boolean
  readonly bytes: Uint8Array // 仅为本 phase 的原始输入；start/end 为空，不作为安全输出槽
  readonly publish: (chunk: Uint8Array) => Promise<void> // Core 提供，仅本次 chunk/end trigger 存续期有效
  disposition: "hold" | "withhold" | "replace"
  replacement?: { file: string; size: number; newlines: number }
}
interface ShellHooks {
  readonly "create.before": ShellCreateBefore
  readonly capture: ShellCapture
}
```

创建时以已有 PluginHooks.has 判定是否进入 capture 模式；无 hook 的裸引擎保留普通路径。已进入模式后 disposition 默认 hold：仅表示不自动发布输入 bytes，不撤回已由 publish 写出的安全段；不能因重载失去回调而透传。（v3.5）扩展另以既有 `ShellHooks["create.before"]` 只读消费 `command`/`cwd` 交 `SecretMask.command`，不改该事件，注册在 `policy.seal` 内与 capture 同处（`packages/ext/src/policy/index.ts:292-293`）；ShellHooks 接口不变。扩展只设置原事件的 disposition/replacement，安全字节改经 publish，返回新对象不会被 hooks.trigger 自动采用。start 在 spawn 前只初始化；chunk 顺序处理合并 stdout/stderr，end 覆盖原进程结束/超时/取消后的流关闭；没有新增命令超时。

#### 回调内发布、顺序与背压

Core 在每次 chunk/end trigger 内提供调用期限定的 publish。扩展按源流顺序零次或多次 `await input.publish(safeChunk)`；Effect 回调用现有 Effect.promise 承接同一 Promise，Promise adapter 无须转换函数。每次只传当前已认证、归一化及遮盖的安全段，允许零长度（无写入、无计数）；不能传全部块数组、拼接整个余量、并发/脱离回调发布，或在 Promise 完成前修改/复用所传字节。start 不发布正文。

Core 逐段写入自己持有的捕获 writer；publish 的 Promise 在该段 write 回调成功、size/newlines 更新、且 write 返回 false 时的 drain 已满足后才 resolve，不承诺每段 fsync。计数只扫描该安全段的实际字节/换行，Shell.output 的 cursor 继续消费此安全 size；不计原 bytes 或密文大小，不等待整个 capture 回调结束才让文件可读。Core 在本回调及其在途写入收口前不处理下一原始 chunk、不进入 end/replace；扩展也不预取并排队全部解密帧，内存只需当前帧、真前缀尾部及必要状态，不加段数、输出量或时限上限。

publish 的写入错误先由 Core 锁存 withheld，再 reject 无正文的内部错误；回调随后捕获错误或设置 replace 都不能清除此锁存。并发发布属于契约故障，同样锁存，不建立无界 Promise 队列；trigger 正常或异常结束即撤销本次函数的发布能力，过期调用 reject 且不写盘/计数。Core 收妥在途写入后执行既有故障路径；callback reject/defect、注册消失、ext reload 亦同。已完成的安全段属于既有直播前缀，单次回调不是原子发布事务；剩余段不发布，终态仍按下述 BR-07 原子替换为仅说明。

#### 直播 flush

start 做前采集并创建 shellID 的私有材料。每次 flush 先按 §4.3 检查来源目录变化/重读变化文件，再对「上次未决尾部 + 本 chunk」归一化后匹配。直播和终态都窄引用 **`packages/session-ui/src/tools/ansi.ts:6` 的 `stripAnsi`**：覆盖该实现支持的全部 CSI/OSC 等 escape，不限于颜色，不另写 strip 正则。增量适配仅保留尚未完整解码的 UTF-8 与未闭合 escape 片段，完整文本交给同一函数；shell 的文本匹配单位也经同一函数归一化，归一化为空不注册空模式。end 将残段按该函数的 EOF 语义归一化后再匹配。长 escape 残段同样用密文 spool，不能在堆上无界积累。

归一化后的匹配流只保留**尚未消费文本的最长后缀，且该后缀是某个当前匹配单位的真前缀**；可用 Aho-Corasick 的有效前缀状态深度表达，不再固定保留最长值 L−1 字节。其它已确定文本在当前 flush 立即发布。完整匹配按左到右、同起点最长值优先输出遮盖符并整段消费；若同起点仍可能延长成另一匹配单位，则暂不决议。完整跨度跨发布边界时整段替换，不切开原值；在已消费跨度后重算剩余尾部，遮盖符不重新进入 matcher。保留的是实际未决字节与状态，不是任意长的历史窗口。

因此，即使集合含数 KB 的私钥块，`Listening on http://localhost:3000` 这类不以秘密前缀结尾的末行也在本 chunk 发布，空闲期间无需等下一个 chunk 或退出，不加 idle 定时器/等待阈值。确实以某个秘密真前缀结尾的片段只等消歧或 EOF；EOF 对余下完整值遮盖并释放其它尾部。集合变化时用新集合重新扫描尚未发布尾部，已发布的未知值不能追回，属于下述已批准 LIVE-01。

已确定的安全段在当前 flush 内逐次 await publish，即刻追加捕获文件；若无效 escape 使长密文尾部成为普通文本，扩展逐帧认证解密、交给同一归一化/matcher，再逐段发布，不整份回填 bytes。若后续终止符使 OSC 完整，则整段丢弃，不发布其正文。Core 按实际安全写入更新 size/cursor/行数，现有 Shell.output、实时卡和模型运行中读文件的能力继续可用；既不延到下一 chunk/退出，也不加容量或运行时限。

#### 加密暂存与终态重遮盖

为了结束后应用前后并集，所有原始 chunk 在变换前写入捕获文件同目录的**加密 spool**，不把整份原文保留内存或明文临时文件。每 shell 用 `node:crypto.randomBytes(32)` 生成仅进程内持有的 AES-256-GCM key；每帧用唯一 12-byte nonce，序号/Shell ID 作认证关联数据，记录长度、nonce、密文及认证 tag；进程另持有预期帧数和总原文字节数，结束读取必须全部吻合，不能把截断到某个完整帧当作正常 EOF。`createCipheriv/update/final/getAuthTag` 加密，`createDecipheriv/setAAD/setAuthTag/update/final` 验证后才把该帧解密明文交给 matcher。不得在 tag 校验失败时使用未认证输出。key 不写文件、metadata、日志、storage 或 IPC。

spool 顺序流式写入，内存只有当前原始帧、实际真前缀尾部及必要解析状态；总输出增长只增加密文文件，不增加全量原文内存或用户输出上限。帧格式为私有临时数据，不是持久契约或可恢复凭据存储。正常完成后流式解密，用前后/运行中 retained values 并集调用同一 stripAnsi 和尾部 matcher，再流式写同目录安全 staging；整个过程中不拼接完整原文。

end 成功设置 replace + staging 文件路径/安全 size/行数；Core 先关闭旧输出 writer，原子替换最终捕获文件并更新计数，再打开 outputDone。replace 只允许在 end，staging 必须是本次 capture 目录内已完成的安全文件。Shell.result、Job、后台 synthetic 通知、模型终态与存储记录只在此后消费同一最终文件；普通模型结果、根包装保存的进度和外层 Code Mode 结果也再用结束集合重投影，不能把运行时截取的旧正文带回终态。

前景终态卡原有 saved 状态消费最终结果（`packages/session-ui/src/tools/run-machine.ts:22-36,60-104`）；直播 follower 是追加缓存，不能撤回用户已经看到的内容。先打印后落盘的残留在规格 v3 限制表内；已按当时集合遮盖的直播前缀留在缓存，不等于允许终态文件、Job、模型或记录保留故障前缀。

#### 遮盖故障与终态收口

| 时点 | 确定行为 |
| --- | --- |
| 第一次 publish 以前失败 | 锁存 withheld，运行文件只发布一次固定说明；命令照常运行。end 仍完成下述仅说明文件替换。 |
| 已发布若干段后失败 | 立刻锁存 withheld，丢弃未发布尾部/当前原文，停止继续暂存/发布原字节；运行文件可在已有遮盖前缀后追加一次说明，之后持续 drain 并丢弃进程输出。已见直播卡/缓存不回撤；**不得据此保留终态前缀**。 |
| end 的重读、解密认证、重遮盖或安全 staging 失败 | 同样锁存 withheld；删除不完整 staging/spool 并释放 key，由 Core 生成仅含固定说明的安全文件，原子替换原捕获文件，不把旧运行文件当作最终结果。 |
| publish reject、callback reject/defect、注册消失或 ext reload 丢失 key | Core 用 Effect.exit 收口非外部取消的回调故障；发布/写盘故障即时锁存 withheld，收妥在途写入后不再发布其它段。之后只 drain，end 的仅说明替换不依赖扩展或 masker。故障不停止/取消/重跑命令；真正用户取消维持原行为。 |

**withheld 一旦锁存（包括 ext reload），end 无条件走仅说明终态**：Core 关闭 writer，以 Schema 常量 `MASKING_FAILED_TEXT` 写同目录安全 staging，原子替换最终 capture 文件，size/行数改为该说明的实际计数，再完成 outputDone。所有终态消费者 Shell.result、Job、后台通知、工具终态卡、模型和存储记录读取/投影这个仅说明文件，不能重新附带运行中缓存或故障前缀。Core 自己生成说明，不再调用故障 masker；若连说明文件的 IO 都失败，终态出口保持 withheld 并直接生成同一句安全正文，绝不回读旧文件/半份 staging 或发布其正文引用。真实 exit/signal/timeout 不变。已经发布到直播卡/缓存的遮盖前缀仍在，但它不是终态文件或终态记录的来源；这不构成 BR-07 的产品例外。

**LIVE-01（规格 v3 已批准）**：某个值先被打印、后才写入受保护文件，打印当下的 flush 不认识它，可能已出现在直播卡/缓存以及助手可读的运行输出文件；成功结束的并集重遮盖修正最终文件、模型终态和存储记录，不能撤回当时已见内容。U-39「这两个你的建议是什么，按你的建议吧。」已批准并写入规格限制表。此条只指先打印后落盘的窄窗口；遮盖失败仍遵守上述 BR-07 终态仅说明契约。

#### 孤立密文清理

正常结束或故障时扩展 unlink spool、释放 key；ext reload 不能用新 key 解旧 spool。崩溃后的清理归 **Core 现有 `Shell.cleanup` / 全局 `cleanupNode`（`packages/core/src/shell.ts:91-125`）**，与 SC-01 同一接管面内增加专用临时材料识别。加密 spool 使用 capture 文件名加 `.pending.<pid>.<bootNonce>.enc` 后缀（nonce 非秘密）；下次引擎/应用启动的首次 cleanup 扫描和已有周期 cleanup 都只清理该专用命名且 owner 进程确定已退出的孤立文件，不等旧 `.out` 保留期、不增加 TTL。活跃进程或身份不明的不删；以 Node `process.kill(pid,0)` 仅探测存活，EPERM 视为仍存活，不发送终止信号。扩展清理失败留下的密文也由此回收。孤立内容只有认证密文，无可恢复 key，不做解密、历史恢复或迁移，也不删用户来源文件。

SC-01 的接管仍仅是 Core Shell 捕获生命周期和 Effect/Promise ShellHooks 同一事件；没有新增 synthetic、模型或 UI takeover。扩展负责采集、profile、匹配、加密暂存和安全 staging；Core 只做发布/替换、计数、故障收口和专用捕获材料清理，依赖 Schema 固定说明，不复制匹配规则。登记范围仍见 §10。

### 4.6 只取消全部批准档的项目外读取 ask

不删 build 的整条 external_directory 规则。由现有 `external-directory-rule` 权威持有其读操作例外，扩展现有 permission.evaluate 消费；不在 UI、gate、风险器各建档位表。

执行前只为根内置 read 记录既有身份事实与 `(sessionID, messageID, id)`，根结束/失败后删除。read 原注册的 codemode=false（`packages/core/src/tool/plugin/read.ts:47`）；子调用不建立同键 read 记录或覆盖 execute 外层事务。permission 事件只有同时满足「source.type=tool、完整调用键对应已核实内置 read、agent 为既有全部批准载体、action=external_directory、当前 effect=ask、非自动化」才改为 allow。最终匹配的是执行中的调用而不是 metadata 自报工具名。不改变显式 deny、不写持久 grant、不放宽无 source 的请求。

询问档仍走原目录 ask，只读档对普通项目外文件仍由原 deny 处理；安全视图的名单内读取走 §4.4。write/edit/patch/shell 等动作在原 external_directory 规则下运行。风险分类始终仅提供说明，不能以「高风险」重新增加一次审批。

### 4.7 能力接缝图

「新增」表示本设计已经决定的实现能力；「raise」表示引擎缺口与接管决定，不能伪装为现有 callable。表只映射能力和合法边界，不是文件改动清单或工作单元。

| 所依赖的能力 | 合法 callable / 明确新增或 raise | 消费者与边界 |
| --- | --- | --- |
| 修改正常返回或 Tool.Error 终态 | `Context.tool.hook("execute.after", ...)`，`packages/plugin/src/promise/tool.ts:47-71`；`Tool.executeTool`，`packages/core/src/tool.ts:155-179`，已实测 | 扩展 SecretMask；覆盖内置、插件、MCP、Code Mode 子调用与外层的正常返回/Tool.Error；中断/defect 无 after，需发布前安全缓存 |
| 已注册工具的运行期进度 | `Context.tool.transform` / `ToolEditor.update`，`packages/plugin/src/promise/tool.ts:25-35`；既有 `wrapForDisplay`，`packages/ext/src/policy/display.ts:43` | 仅覆盖 registry 工具；不能声称包含合成 execute |
| 中断根缓存回收 | 现有 `Context.event.subscribe`（`packages/plugin/src/promise/event.ts:6-9`）；根键对应终态事件的 sessionID/assistantMessageID/id | 只释放私有缓存，不改事件/数据库；不能当作发布前遮盖接缝 |
| 外层 execute 进度与取消记录 | **raise SC-02，U-40 已批准**：§4.8 `tool.execute.progress`，根调用 context.progress 交给 publisher 前由扩展改写 | 现有 callable 缺失；非引擎 createProjector/Context.event.subscribe 只能护桌面副本，不能护已提交的失败记录；按冻结契约实施并登记接管 |
| 外层 begin / 子调用无状态 | **新增** SecretMask.begin 接在 `policy.seal` 的尾部 execute.before 回调内（`packages/ext/src/policy/index.ts:248-264`），confirm/pin 后最后一步；共享 context 的证据为 `packages/core/src/codemode/tool.ts:147-150` | 根 execute 建/结束唯一事务；活动键下 child before 不 begin，child after 只重读并转换自己的结果 |
| non-env 前置说明 / env 安全页 | 原注册 `ToolEditor.update`/tool.output codec；原 `execute.after`；**修订** SecretMask.read（§4.4） | 前者解码说明 DTO；后者消费原页 output/content 并投影，不复制 TextPage schema 或分页，不 import Core 服务 |
| 页边界、行号、续页 | 原 read 执行器（`packages/core/src/tool/plugin/read.ts:94-101,155-158,258-293`）及其私有 reader | 调用已有 execute，消费生成结果；不把私有 textPage 冒充 callable，不增加分页出口 |
| read 附带说明文件 | 现有 `SessionInstructions.load`，`packages/core/src/session/instructions.ts:58-81`；规格 v4/U-42 | 原加载/发布链不改；说明文件中的值不遮盖，不新增 hook 或遮盖保证 |
| 判定路径 / 凭据字段 / 非密钥 | **新增** ProtectedFiles.sources/match/probe/isPublicValue 及 §4.1 profile 发布数据 | Schema 一份权威；相同依赖树边界、KUBECONFIG 拆分和列/字段选择由所有消费者共用 |
| 采集与变化检测 | **新增** §4.3 的 SecretMask 方法；Node `fs/promises.readdir/realpath/readFile/stat({bigint:true})`、`node:util.parseEnv` | 文件/目录 stat 五元组缓存；变目录逐层 readdir 发现新来源，已知文件独立 stat；已读项目外名单文件经 `createSecretFiles().track`（`packages/ext/src/secret-files.ts:146-148`）只 stat 不 readdir；SQLite 含 WAL/SHM；不收集任意 scalar |
| SQLite 明文单元格 | 已有 Node 内建 `DatabaseSync` 的 readOnly、prepare/iterate/close；仓内使用点 `packages/core/node_modules/@effect/sql-sqlite-node/src/SqliteClient.ts:36`；**新增**发布 profile 查询投影 | 扩展直接用 Node 内建，只读打开来源库；官方 gcloud schema 与只读/反例探针见 §2 |
| env 写回恢复 | 已有 ToolEditor.update/execute 包装；write Input `packages/core/src/tool/plugin/write.ts:19-24`、edit Input `:24-33`、Patch.parse/Hunk `packages/util/src/patch.ts:27-49`；**新增** SecretMask.prepareMutation | 传局部恢复副本给原执行器，不改 pin 后事件；old/new/context 按对应文件的键出现序号恢复；只遮内嵌字段的值按 §4.3.1 v3.4 句经 `envView` 按位置恢复（`packages/ext/src/secret-mutations.ts:136-182`）。重建 patch 的私有序列化能力明确在扩展写回边界新增，不声称 Patch 已有 format API |
| 实时 shell / 最终文件 / 后台通知 | **raise SC-01（U-38）**：§4.5 ShellHooks.capture 的 start/chunk/end + 回调内 publish/replace；原 pump/writer/outputDone 为 `packages/core/src/shell.ts:333-355` | 同一捕获生命周期提供多段 Promise 发布、逐段背压/计数及安全文件替换；outputDone 前成功重遮盖或故障仅说明，说明文件 IO 失败的终态也由同一 Core withheld 状态直接生成说明，不回读旧文件；不依赖 synthetic hook |
| ANSI 归一化与实时尾部 | 已有 `stripAnsi`，`packages/session-ui/src/tools/ansi.ts:6`；**新增**扩展的增量边界适配和真前缀尾部 matcher | 窄引用纯函数，不依赖 UI barrel、不复制 CSI/OSC 语义；直播/终态均先归一化再匹配，普通末行立即发布 |
| 加密 spill / 流式终态重写 | **新增** §4.5 私有 spool；Node `crypto.randomBytes/createCipheriv/createDecipheriv`、认证 tag，`fs.createReadStream/createWriteStream` 与 `fs/promises.rename/unlink` | event.file 提供合法捕获目录；key 只留进程，原文仅当前帧/匹配尾部，不加输出上限 |
| 遮盖故障，命令继续 | **新增**总回调收口和固定说明；SC-01 采用已有 PluginHooks.has（`packages/core/src/plugin/hooks.ts:43-47,97-102`）、Effect.exit | 未发布部分丢弃；end 由 Core 原子替换为仅说明文件，所有终态读同一文件；已见直播缓存不用于终态 |
| 崩溃后孤立密文清理 | 现有 `Shell.cleanup` / `cleanupNode`，`packages/core/src/shell.ts:91-125`；Node `process.kill(pid,0)` 与 unlink；**新增** SC-01 内专用 spool 识别 | 下次启动首次扫描及现有周期清理；只删确定已退出 owner 的专用密文，不读/恢复明文、不删活动文件 |
| 真实退出码继续可见 | `Shell.result`（`packages/core/src/shell.ts:238-267`）保留实际 info，`ShellResult.metadata`（`packages/core/src/shell/result.ts:36-42`）投影 exit/signal/timeout | 隐藏只替换正文，不把遮盖错误写入进程退出状态，不从第三方自报字段伪造真实退出码 |
| 识别自动化并保留原拒绝 | `createUnattendedState().unattendedProfile`，`packages/ext/src/policy/unattended.ts:30` | 沿用现有在册状态和 AUTOMATION_PROFILES |
| 取消读目录 ask、保留其它权限 | `Context.permission.hook("evaluate", ...)`，`packages/plugin/src/promise/permission.ts:18-32`；`externalDirectoryRules/placeAfterBase`，`packages/ext/src/external-directory-rule.ts:38,59` | 新增读调用关联与该权威的操作判定；不声称可翻转已提前返回的 deny |
| 风险标注与当前卡片呈现 | `classifyPermissionRequest`，`packages/ext/src/policy/risk.ts:730`；`attachTerminal`，`packages/ext/src/policy/display.ts:67` | 复用既有风险信号和 Tool.Content 文本，末尾再遮盖 |
| 存储和模型消费 | `publisher.toolExecution`，`packages/core/src/session/runner/publish-llm-event.ts:561`；`toolResult`，`packages/core/src/session/runner/to-llm-message.ts:114` | 消费现有安全结果，不增加持久 schema、重放补丁或 UI 接缝 |

### 4.8 v3.1：已批准第二接缝 SC-02

**SC-02 由 U-40 单独批准，不挪用 SC-01 的授权。** 最小所需能力是在 Core `Tool.snapshot.execute` 已完成 before/确认及有效工具名解析、构造根执行 context 时，包装传入的 progress：每次先执行扩展可改写事件，再将安全 metadata 交回原 `input.progress`。位置必须早于 `publisher.progress` 的缓存与发布，不是 bus 订阅回调。普通根与合成 execute 共用这个位置，child 仍由引擎现有 noop progress 隔离，不引入第二个 Code Mode runtime、子调用状态或新的限额。

已冻结的最小接口（Effect/Promise 的 ToolHooks 同形；其它既有事件不变）：

```ts
import type { Tool } from "@opencode/schema/tool"

type ToolProgress = Pick<Tool.Context, "sessionID" | "agent" | "messageID" | "id"> & {
  readonly tool: string // before 后解析出的有效工具名
  metadata: Tool.Metadata
}
interface ToolHooks {
  readonly "execute.progress": ToolProgress
}
```

事件按现有 hook 语义替换其 metadata 字段，不采用返回新事件对象；SecretMask 生成安全副本，不改 Code Mode 内部 calls 或子工具真实 input；Effect 的 `ToolFailures["execute.progress"]` 为 never。规则、重读、根事务与故障隐藏仍唯一归扩展 SecretMask.progress（§4.3），Core 不持名单/秘密值。采用此公共根出口后，已注册工具包装保留 display 等原职责，进度遮盖在此统一执行一次；不能让多层 masker、第三方后续 hook 或旧原 metadata 回填绕过最终安全值。BR-07 的总收口须覆盖回调 reject/defect 和注册失效，不能因 hook 本身故障透传 update 或终止命令；继续复用 §4.3/§5 的安全进度/终态说明投影，不新增原文 fallback；真实故障注入仍待实施验证，不在本次冒称完成。

最小新增面是 **Core Tool.snapshot.execute 的根 progress 包装、Plugin 的 Effect/Promise ToolHooks/失败类型，以及 Promise adapter 的 toolHook 分派**（现成分派仅列 before/after，`packages/plugin/src/promise/adapter.ts:686-692`）；现有 host.tool.hook/PluginHooks.trigger 仍负责注册与转发。无须修改 Core CodeModeTool、publisher、Bus、持久 projector、模型降层或桌面投影；它们统一消费入口已处理的 metadata。U-40 已批准这一第二处引擎改动；实施与接管登记消费 §10，不增加其它引擎改动。

### 4.9 v3.2：说明文件边界（规格 v4 / U-42）

owner 2026-11-27「同意。」：不为 read 附带的 AGENTS.md 等说明文件新增第三处引擎改动；写进这些给助手看的说明文件的密钥值不遮盖。依据为规格 v4「用户会碰到的限制」新增行及 U-42 批准记录。

说明文件继续由原 SessionInstructions.load 发布 synthetic，初始加载及后续附带内容仍交给模型。移除 r6 的 SC-03 接口、注册失效保护状态与 SecretMask.instructions 候选，不改 loader、PluginHooks 或两面 SessionHooks。普通工具结果仍执行既有遮盖，不为说明文件另加名单或旁路通用结果投影；额外遮盖保证不覆盖上述说明文件加载链路。该边界是已批准的规格取舍，不是 BR-07 的失败分支，不自动隐藏指令或让 read 失败。

## 5. 数据与失败

不新增业务数据库、会话 schema、历史清洗或凭据存储。正常返回/Tool.Error 的终态仍在 after 后经原事件投影事务写入；根中断/defect 的记录直接来自 publisher 的缓存（外层 execute 的安全缓存由 SC-02 保证，尚待实施验证），不宣称它经过 after；直播文件逐段含当前集合处理的文本，成功结束从加密原文 spool 用并集重写，失败结束原子替换为仅说明文件。直播与终态是两个明确的发布边界，终态绝不复用旧正文绕过收口。

普通根工具/连接器的未发布结果若处理失败，整份动态 content/output/metadata/附件/error cause 换固定说明，保留可信执行状态。子工具使用同一安全替换形状，但不创建/销毁外层状态；外层 Code Mode 正常返回在自己的 after 终结，中断缓存清理按 §4.3。没有调用 ID 去重把不同 child 当作重试，也不会漏第二个/并发子调用。

```ts
const hiddenResult: Tool.Result = {
  content: [{ type: "text", text: MASKING_FAILED_TEXT }],
  // 只另附宿主确定的 display/实际执行状态，不保留原动态 payload。
}
```

安全 read 投影出错以 content-only 的固定说明替换原 output/content/metadata/附件；non-env 的执行前说明仍由注册 output codec 构造；工具自身已失败时保留 Tool.Error 类型，message 只有说明，移除 cause。shell 不论第一次 publish 前还是中途故障，**最终文件和该次终态正文都只有说明**；中途已经发出的遮盖前缀仅留直播卡/缓存，不能持久化成失败终态。命令照常完成、exit/signal/timeout 真实可见，不自动重跑、不加确认、时限或容量上限。

对可包装的已注册根工具，终态 metadata 连同根包装保存的最后 progress 以结束集合重投影并覆盖同名键；不能只删 error.metadata，让 publisher 的 `failureSnapshot`（`packages/core/src/session/runner/publish-llm-event.ts:109-113`）再次合并旧正文。shell withheld 时正文引用换成最终仅说明文件，动态键覆盖为安全空值，只保留可信执行字段；Code Mode 自有 toolCalls 摘要在故障终态置空，避免共享 ID 使父级回填原文。历史已见直播缓存不作为这一投影的输入。**外层 execute 的取消/defect 可绕过 after 并复制 publisher 缓存；该路径只有发布前 SC-02 才能保证缓存已安全，不能靠本段的 after 覆盖假装解决。**

| 失败窗口 | 收口与消费者 |
| --- | --- |
| 前采集/首次输出之前 | 普通结果或 shell 文件只有说明，原工具/进程继续；单来源缺失/不可读按 §4.3 的来源边界处理。 |
| 直播 flush、spill 加密/写入、匹配、publish 或回调错误 | 锁存 withheld，丢弃未发布及后续原文，清理 cipher/key；仅已见直播缓存保留已发遮盖前缀。end 原子写仅说明文件，Shell.result、Job、后台通知、模型和记录均只消费说明。 |
| end 的采集、认证、重遮盖、staging 构建失败 | 删除不完整 staging，由 Core 生成仅说明文件并原子替换最终 capture；outputDone 在收口之后，不能保留运行文件前缀作为终态，也不重调故障 masker。 |
| end 成功 | 关闭 writer、替换完整安全文件、更新计数、完成 outputDone；Job/后台 synthetic、Shell.result 和存储消费同一重遮盖终态。 |
| env 恢复 | 原 writer 前按文件/键/出现序号恢复局部副本，保持权限/原错误契约；不从 parseEnv 的末值或跨键历史补写。错误/输出/审批预览也遮盖。 |
| 并发与 ext reload | 根事务键与 shellID 分区。重载丢失 key/状态即锁存 withheld；后台进程继续 drain，end 由 Core 不依赖扩展替换为仅说明文件。新调用不继承旧调用锁存。 |
| 崩溃 | key 随进程丢失；Core 在下次启动首次 cleanup 和既有周期清理回收确定孤立的专用密文，无恢复/迁移或新 TTL。 |

所有源文件/SQLite 库只读采集；只有用户授权的原 write/edit/patch 写目标，env 恢复使对应每次赋值继续保存真实 RHS。源文件轮换与外部程序没有共同事务；仅 LIVE-01 的先打印后落盘窗口属于新增已批准直播残留，不扩大既有编码/拆分、临时生成后删除与程序解密边界。遮盖失败的终态不保留前缀，不新增第二项 LIVE-01 残留。

## 6. 架构落点

对应现有 [模块地图](../../architecture/modules.md) 与 [架构约束](../../architecture/constraints.md)。均在已有包内增加自有职责，不新增包或顶层模块；不移动主进程的凭据存储权威，不调用另一代引擎 API。

| 责任 | 模块位置与依赖 | 复用权威 / 约束结论 |
| --- | --- | --- |
| 保护名单、公开值判定、平台路径匹配 | Schema 的纯 Code Puppy 契约；不依赖 Core/Server/UI | K2 收敛：风险器、read 和遮盖不再各持名单 |
| 凭据字段/SQLite 采集、安全 read、env 写回恢复、输出遮盖与加密 spool | Ext 的 Location 生命周期；依赖 Schema、公开 Plugin API、Node IO/crypto/sqlite 及现成 stripAnsi 纯函数 | 不 import Electron main 私有模块、不增加包依赖；ANSI 只窄引用原纯函数，不引 UI 运行时；原 writer、Patch.parse、身份和自动化仍为权威 |
| shell 捕获出口 | Core 调用已有 PluginHooks，事件类型归 Plugin；不反向依赖 Ext；复用自己的 cleanup | SC-01 由 U-38 批准；SC-02 由 U-40 另行批准；规则仍归扩展 |
| 根工具进度入口 | Core/Plugin 只增加可改写事件，Ext 继续持有 SecretMask | SC-02 已由 U-40 批准；不绕过权限/代际权威、不复制名单，不以桌面过滤替代持久记录保证 |
| 档位注入与项目外审批 | UI main 消除交互 `.env` 专用冲突；Ext 原权限权威解释操作例外 | K1 不新建档位载体列表；自动化原规则和非读取 ask 保持原义 |
| read 页与说明文件 | 原 read/分页为权威；Ext 投影工具结果；原指令 loader 不改 | U-42/规格 v4 明确说明文件中的值不遮盖；无 SC-03，不复制分页或导入 Core 服务 |
| 历史、模型与卡片 | 现有投影、终态降层和直播跟随文本区 | 直播继续，终态成功重遮盖、故障仅说明；已见缓存不回撤、不写回终态；先打印后落盘仅 LIVE-01；不添 UI redactor/frames/客户端协议 |

复用原则：固定名单是业务常量，roots 是已有宿主路径事实，均不是新增用户配置；跨平台路径在共享权威实现一次；所有数据错误不含秘密。现有风险探针的输入扫描 cap 不得继承给秘密结果遮盖，不能借性能理由新加秘密长度或结果长度限制。

被否决的替代：

- OS 拒读名单：程序也读不到，违反 BR-04。
- 只遮盖模型请求或 UI：数据库或另一消费者仍保留原值，违反 BR-03。
- 只写 after：shell 与 Code Mode 探针证明直播先漏，取消/defect 又可绕过 after 把缓存进度写进记录。
- 只在桌面 createProjector 或扩展事件订阅遮盖：可护卡片副本，但 §2 的真实失败记录反例仍含原值；后置改记录不能满足原值不进入记录。禁用 Code Mode 或删直播也不是已批准替代。
- 只删 build 的 external_directory ask：同时放松写入类目录审批，超出 BR-05。
- 只按 API key 前缀/长度识别：普通密码、短值、自定义 token 不满足保证；BR-06 必须按发布规则而非猜测。
- 依靠 watcher 承诺覆盖命令内部临时值：超出 v2 已批准范围且没有证明。
- r1 的整段延迟发布：未经批准地移除了长期/后台命令的直播能力；R1-B1 接受并改为直播 + 诚实残留，不再把推导当作 owner 同意。
- 全标量/整 JSON/整 SQLite 文件匹配：R1-B2/M4 的反例证明会误遮普通文本或漏掉查询出的 token；改为同一发布数据中的凭据字段/单元格。
- 在内存保留全部 shell 原文：改为逐帧认证加密 spill，不用新增限额规避资源问题。
- 遮盖失败后返回原文、只隐藏终态卡或停止命令：分别违反 BR-07 或 BR-04；v2 只授权本次输出隐藏，不授权新确认和停执行。
- （v3.4）把项目外范围加入 `sources` 递归发现：规格 v5 BR-05 明确不预先扫描；改为 match 判定 + 读过后登记。
- （v3.4）内嵌密码整值遮盖或按名字放行：前者遮住主机/用户名，违反 BR-06 v5「只遮这一段」；后者让 `DATABASE_URL` 一类的密码原样交给助手，AC-12 的对照臂即此反例。

安全边界：可信方是宿主、发布名单、引擎/扩展实现及进程内存；不可信输入包括模型发起的命令、文件内容、工具/MCP 返回值。连接器执行时照常读文件，服务器与程序已经接触值不属于「未给模型」的证明。已批准的残留是原样同值误遮、程序编码/拆分、前后不可读的临时生成后删除值、加密存储经程序解密才输出的值，以及 LIVE-01 的先打印后落盘直播窗口；用户粘贴、应用自有凭据和阻止程序联网按规格排除。任意原生插件读内存、外部程序直接联网、OS 数据库解密没有在本票得到新的防护承诺。

不变量：不为遮盖改写来源文件；授权 env 写回按当前文件/键/出现序号恢复值；秘密集合/key 不出进程，spool 只含认证密文；直播只发布按当时已知集合处理的文本；成功终态用前后并集再次遮盖模型结果、记录和最终文件；故障终态仅说明且不停止命令；名单/字段与公开值只有一份权威；ANSI 归一化复用同一函数。直播已见缓存不是终态记录，不承诺追回已见内容或全时刻零泄漏；LIVE-01 继承规格 v3 的窗口，说明文件加载/附带内容另按规格 v4 的已批准限制不遮盖。

## 8. 拆分决定

不适用跨仓拆分；Schema、Ext、Core、Plugin、桌面宿主在同一仓。SC-01 是上游接管权限边界，不是另开跨仓接口或顺序 Task。后续实施需消费经裁决和审查冻结的 §4；SC-01/SC-02 授权继承；U-42 已决定不新增 SC-03，安全 read 按既有分页/after 契约实施，没有第三处接管依赖。

## 9. 回滚

不适用。没有数据迁移、不可逆数据改动或规格要求的回退路径；不设计旧版本行为或兼容期。

## 10. 裁决与审查结论

### v3.5：规格 v6 同步（U-44）

| 裁决 | 依据 / 后果 |
| --- | --- |
| SPEC6-01：命令里字面写出的项目外名单文件在 Shell create.before 登记、capture start 读出，第一段输出起遮盖；拼出的路径与先 `cd` 再写的相对路径不认 | 产品依据为规格 v6 BR-05（`2e99186d59`）：协调仓安全意图 I-54，owner 2026-11-27 U-44 选「补上：命令里写出的路径先登记（推荐）」；拼出路径不认与「这条命令的输出要多等一次文件读取」两项均列入规格 v6 限制表，同一原话批准。设计后果：§4.1 新增 `ProtectedFiles.named`，`probe` 改取其 rule ID（结果不变）；§4.3 新增已登记来源 `SecretMask.command({command, cwd})`；§4.5 扩展只读消费既有 `create.before`。不新增引擎接缝、hook 或配置，SC-01/SC-02 及 U-38/U-40 授权不变；不新增规格外的用户步骤、选项或限制。v3.4 及更早裁决不重开。 |

| 本增量收据 | 检查方 / 结论 | 遗留去向 |
| --- | --- | --- |
| v3.5 / 工作树 `859207d427`，规格 v6 `2e99186d59` + plan.md ⑦（红 `c425bed85b` → 实现 `18f8f451b6`，提交 `e9b97938cb`）；v3.5 审查 R1 修订 / 工作树 `904fcd14d6`：Codex 只读审查 R1 两项 Major，编排器全部接受，`66f38603df`（named 加 shell 整词）与 `fbcb8e47fa`（已登记文件过 SPEC5-04 软链边界），plan.md「⑦ 审查 R1 修正」 | Claude Opus 5.5 设计方定向同步：按 plan.md ⑦「设计待同步」三项及 R1 修正的两项逐句对照 §4.1/§4.3/§4.5 与实现（`packages/schema/src/codepuppy-protected-files.ts:293-349` 的 `named`/`probe`/`shellWords`，`packages/ext/src/secret-files.ts:150-151,209-227` 的已登记分支软链边界，`packages/ext/src/secret-mask.ts:251-257` 的 `command`，`packages/ext/src/policy/index.ts:292` 的注册，`packages/core/src/shell.ts:303,343,363` 的顺序），只改这些句子与基线/元数据；行为证据继承 plan.md ⑦ 实施收据与「⑦ 审查 R1 修正」的红例、移除臂与场景，本轮未重跑测试；design_version 保持 3.5。没有新增独立审查轮次，review 元数据保留 R2 真实收据 | **v3.5 frozen**；无 owner-only 决定。plan.md ⑦ 注明本节未经编排器单独核对、由审查时核对。 |

### v3.4：规格 v5 同步（U-43 与编排器核对修正）

| 裁决 | 依据 / 后果 |
| --- | --- |
| SPEC5-01：项目外名单文件经 match、读过后计入；env 只取凭据字段，值里内嵌的连接地址密码也是凭据字段、只遮该段 | 产品依据为规格 v5 BR-05、BR-06：I-50、I-51 由 owner 2026-11-27 在协调仓安全意图 U-43 批准，原话「intent 全部按照你的建议。」；内嵌密码句来自编排器（Claude Opus 5.5）2026-11-27 对 I-51 的核对修正（plan.md:818、:881），写入规格 v5 `d14b2e3c64`，该提交注明批准行不变，本文不把这一句记作 owner 对它的单独批准。设计后果：§4.1 项目外范围与内嵌密码规则、§4.3 已读项目外文件来源、§4.3.1 只遮密码段的写回恢复、§4.4 env 视图与权限关联；`ProtectedFiles`、`SecretMask`、`EnvMutation` 签名，SC-01/SC-02 及 U-38/U-40 授权都不变，不新增用户步骤、选项或限制。v3.3 及更早裁决不重开；I-52 已延后，不在本增量。 |
| SPEC5-02（审查 R1 修订）：内嵌字段逐处从原文取、空密码形状整值秘密、解码失败只留书写形、凭据名键的 key=value 段只遮其值、秘密词以结尾计并加 `PWD`、写回按位置换回遮盖符 | 来源：#1758 代码审查 R1（Claude Opus 5.5，独立只读，FIX-THEN-MERGE，7 项），编排器全部接受（plan.md:888-897）；实现红例 `099c3ec893`、修正 `fc825e9e6d`；key=value 段一句由编排器写入规格 v5 BR-06（`3776643a6e`，注明批准行不变），本文不把它记作 owner 单独批准。理由：`URL.parse` 门在多主机/多地址/未编码 `@` 上漏取或抛错，精确词匹配漏 `PGPASSWORD` 等拼接名，「仅逐字相等才恢复」使助手只改主机时把遮盖符写进密码。后果只在 §4.1 字段提取/秘密词与 §4.3.1 恢复规则；签名、SC-01/SC-02 与授权不变，不新增用户步骤、选项或限制。审查第 7 项（Code Mode 子调用读另一项目 `.env`）为核实、非缺陷，不改设计。 |
| SPEC5-03（#1804，2026-11-27 编排器裁决）：Location 释放分两步——先标记「正在关闭」，不再接纳新调用；本 Location 内已开始的工具调用照常走完遮盖（结果或错误）后，再清空密钥值、已跟踪文件与调用状态；shell 捕获的私有材料仍在释放时立即清理。没有在跑的调用时立即清空；进程退出时一并清空。 | 来源：#1804 夜间检查 #1647 AC1 二分到 #1758 的 82e96edcca。停引擎先关 Location、SecretMask 立即释放，之后引擎才拒掉待批请求，正在跑的 Code Mode 调用结束时只能按遮盖失败隐藏并置空 toolCalls，与 #1647 AC1「停引擎后记下那次调用为 error」冲突。延后到在跑调用结束再清空，两者同时成立；代价只是密钥值在本进程内存里多留到在跑调用结束，不新增用户步骤、等待或限制。§4.3「Location 释放时清空」按本条理解。 |
| SPEC5-04（#1804，2026-11-27 编排器裁决）：采集器遇到软链先用 `readlink` 按字面逐级算出目标（只读链本身、不碰目标）；目标落在某个采集来源之内才往下走或做 realpath，否则跳过该链。来源内部的别名照旧识别为同一受保护身份。 | 来源：#1804 stored-credentials-fence 二分到 #1758 的采集接入刷新：采集器顺着工作区里指向 Code Puppy 自有凭据存放点（C1）的软链做 stat/realpath，每次刷新在引擎 pid 上留下数百条拒绝，淹没「引擎零读存放点」判据，且是无收益的探测。跳过范围外目标与规格 v5 BR-05 一致：项目外文件不预先扫描，读文件工具读过后由 track 接管（经软链的 shell 打印同属 INT-safety I-54 已登记的边界）。不改 main↔引擎契约、不放宽判据，不新增用户步骤或限制。 |

| 本增量收据 | 检查方 / 结论 | 遗留去向 |
| --- | --- | --- |
| v3.4 / 工作树 `d14b2e3c64`，规格 v5 + plan.md ⑥ 实施与核对修正（提交 `25eaac5a2b`）；v3.4 审查 R1 修订 / 工作树 `3776643a6e`，`099c3ec893`..`fc825e9e6d` 与 plan.md ⑥ 审查 R1 收据 | Claude Opus 5.5 设计方定向同步：逐句对照 §4.1/§4.3/§4.3.1/§4.4/§4.7 与 §2「v3.4」所列实现 `file:line`（R1 修订后行号已重核），只改矛盾句与直接后果；行为证据继承 plan.md:867-897 的红例、绿例与移除臂，本轮未重跑测试或探针。design_version 保持 3.4。没有新增独立审查轮次，review 元数据保留 R2 真实收据 | **v3.4 frozen**；无 owner-only 决定。规格 v5 批准记录所列边界（命令打印读文件工具尚未读过的项目外名单文件时不遮）由编排器回流意图，不在本设计处理。 |

本轮检查：`python3 scripts/check-doc-links.py docs/specs/secrets-usable-not-visible/design.md` 与 `git diff --check` 见提交收据；只提交 design.md，不改 spec/plan/索引/生产代码，不 push。

### v3.3 / r8：SC-01 回调形状修订（沿用 U-38）

| 裁决 | 依据 / 后果 |
| --- | --- |
| CAPTURE-01：同一回调逐段 publish | 采纳实施④的接缝返回；§4.5 的 readonly bytes 只作输入，Core 提供 `publish(chunk): Promise<void>`，替代单个输出 bytes / publish disposition。每段 await 后才解下一帧，不使用全量数组、不直写 Core 文件或增加 hook。§2 的原 normalizer 与 writer 探针 exit 0。 |
| 顺序、计数与背压沿用 | 原本就是按源流顺序发布安全前缀，现在同一回调可以发布多个前缀；Core 仍独占 writer/size/newlines，逐段完成 write/drain 后应答，下一输入及终态替换等本次收口。不得用安全输出总长决定内存聚合或延迟到下次输出。 |
| BR-07 保证不变 | 任一段失败即锁存 withheld；已发布安全前缀仅留直播，余下不发布，end 无条件换成仅说明文件，所有终态消费者同源；即便扩展捕获 publish 错误也不能恢复普通终态。此为原有“已发布若干段后失败”分支，未添加回调原子性或新的产品例外。 |
| 授权与登记不增加 | U-38（2026-11-26，owner「好的。」）已批的 SC-01 内修订 callback 形状；仍只接管 Core Shell 捕获/清理和两面 ShellHooks。沿原 ADR-050 的 SC-01 小节与 registry `secrets-output-capture` 更新实际契约/mechanism/proof，不增加第三个接管 ID；本轮不改登记资产。SC-02/U-40 与不新增 SC-03/U-42 不变。 |
| 状态：frozen | 顺序、背压及失败的对外保证未改变，只补足同一回调释放多帧的合法口，按本轮派单无需 frozen-pending-review。保留真实 R2 review 轮数/版本，不记新独立审查或新增 owner 批准；无 owner-only 项。 |

本轮收据：Codex / GPT-6 作者定向核对，依据规格 v4、v3.2 与实施④ `7908e114024b`；本文仅 §2、§4.5/4.7、§5 与直接元数据/裁决变化。SC-01 尚未实现；新回调的真引擎顺序/多段 IO 故障与终态消费者证明留实施④/⑤，原语探针不替代这些证明。消费面检索 `rg -l 'ShellCapture|ShellHooks.capture|shell\.capture' docs/specs -g design.md` 只命中本文；旧单槽在 §4.5 与 §4.7 已同步替换，实施 plan 的旧输入收据由实施方消费本增量后更新，本轮不改计划。检查：临时原语探针 exit **0**；`packages/ui-mac` 下 `bun test src/main/old-name-scan.test.ts` exit **0**、10 pass / 0 fail；本文文档契约 findings **0**，元数据/链接及 `git diff --check` 通过。`affected-tests --list` exit **0**，scope line：`affected tests: 19 of 687 test files`（仅列范围，未运行全套）。只提交 design.md，不 merge、不更新索引/plan/运行资产，不派发子会话。

### v3.2 / r6、r7：READ-01 与 U-42 冻结裁决

| 裁决 | 依据 / 后果 |
| --- | --- |
| READ-01：保留既有 after 安全视图，不新增分页出口 | 原 reader 负责页选择、裁剪及 toModelContent；§4.4 消费原页，offset/next/行号不重算。不导入 Core 服务，不复制分页/schema/常量；non-env 仍执行前用注册 output codec 返回说明，保护原附件通道。 |
| READ-02：原指令发布事实继承，按规格 v4 限制处理 | §2 探针证明终态遮盖不影响先发布的 synthetic；U-42 已接受说明文件中的值不遮盖。此事实不再构成安全 read 的待决阻塞，也不作为 BR-07 故障注入失败或新接口需求。 |
| **SC-03：不实施，owner 已决定** | 2026-11-27，协调仓安全意图 U-42，owner 原话「同意。」；规格 v4 `0099c0c248` 的新增限制行明确：写进 AGENTS.md 这类给助手看的说明文件的密钥值不遮盖，不为此再改引擎。移除 r6 待批 hook/状态/扩展接口，保留 §4.4 原 read 分页后的 execute.after 改写。 |
| 授权与登记 | 引擎改动仍只有 U-38/SC-01 与 U-40/SC-02；既有 ADR/authority registry 只按这两处已批契约登记，不新增 SC-03 或 secrets-instructions-output 条目。本轮不改运行规则或登记资产，无待 owner 项。 |

| 本增量收据 | 检查方 / 结论 | 遗留去向 |
| --- | --- | --- |
| r6 / `176c6e8c6a`，分页与 read 指令反例 | Codex / GPT-6 作者定向核对；真实 read/指令/记录/模型探针 1 pass、exit 0 的观察继承 | 原 SC-03 待决由 U-42/规格 v4 解决，候选不实施。 |
| r7 / `176c6e8c6a` + 规格 v4 `0099c0c248` / U-42 | Codex / GPT-6 作者核对规格限制与 owner 原话，仅移除未采纳接口并更新范围；没有新增独立审查轮次 | **v3.2 frozen**；无 owner-only 决定；分页投影、多行/长行/别名与三档端到端仍待实施验证。 |

本轮只提交 design.md，按派单不更新生成索引、不合并上游；继承 r6 的代码证据，不重跑未改变的引擎探针。新增引擎面已取消，按 r6 派单条件由编排器记录本增量 review not-required，review 轮数/版本保留 R2 的真实历史收据；不伪造新审查通过。r7 检查：`packages/ui-mac` 下 `bun test src/main/old-name-scan.test.ts` exit **0**、10 pass / 0 fail；本文文档契约 findings 为 **0**，元数据、范围核对与 `git diff --check` 通过。`affected-tests --list` exit **2**：本工作树缺 `.gate-tests`，无 scope line（stderr：`/tmp/secrets-1758-r7-affected-scope.txt`），不扩项修复。规格 v4 是当前产品基线，说明文件限制仅按 U-42 消费，不增加其它限制或历史清洗。

### v3.1 / r4、r5 裁决与批准

**PROGRESS-01：接受实施②的 SEAM-CHANGE-NEEDED。** 原 §4.5/§4.7 把 ToolEditor 当成所有根进度出口，前提已被真实 Code Mode 探针否定。本次只重开这一边界及取消/记录/模型的直接后果；R1/R2 的其它结论与规格 v3 不重开。

| 裁决 | 依据 / 处置 |
| --- | --- |
| 不采用桌面出口作为完整纠正 | §2 六项真实 Bus/DB 事实：卡片副本虽可遮盖，取消后的失败事件和消息已含原值。createProjector/Context.event.subscribe 都晚于 durable commit；只能做显示保护，不能实现 BR-03 的记录义务。 |
| 不以仅终态 after 或模型降层代替 | 成功终态可遮盖、直接模型降层不读 progress metadata 均为真，但取消/defect 绕过 after，failureSnapshot 先落原值。两项真事实不构成全消费者保证。 |
| **SC-02 — U-40 已批准（2026-11-27）** | 已批准 §4.8 的第二处根工具 progress 发布前 hook：在 Tool.snapshot.execute 包装根 context.progress，扩展改写 metadata 后原 publisher 才缓存/发出。Effect/Promise ToolHooks 和 Promise 分派同形补接口；名单、采集、匹配仍归扩展。不修改 Code Mode runtime、Bus/投影器或桌面协议。 |
| 授权边界与结果 | 本轮派单转录的协调仓安全意图 U-40，owner 2026-11-27 原话：「Cargo 选 1，第二处引擎改动允许，Supabase 报告批准」。本票只消费「第二处引擎改动允许」，批准 §4.8 的 SC-02，不包含其它业务事项。U-38 的 SC-01 与 U-40 的 SC-02 分别记授权来源，不把第二处冒充第一处既有授权。无需再问 owner。 |
| 登记与派工 | SC-02 与 SC-01 使用同一现有运行规则 ADR 命名空间及接管权威册：在 `.claude/rules/adrs/ADR-050-secrets-output-capture.md` 中单列 SC-02/U-40；在 `docs/architecture/codepuppy-authority-registry.json` 单独登记 ID `secrets-tool-progress`、`adr: ["ADR-050"]`。该条 takeovers 仅覆盖 §4.8 的根进度包装、Effect/Promise ToolHooks 及 Promise 分派，mechanism 指向实际扩展遮盖实现；SC-01 的 `secrets-output-capture` 条目保持独立。相关上游准入逐文件沿用 `scripts/north-star-guard.sh` 的 UPSTREAM_EXCLUDES（与 SC-01 同一 CI 权威），不加包级豁免。登记及真实 proof 随 SC-02 实现生效；本轮仅提交设计，不伪造 ADR/registry 已写入或机制已实现。 |

| 本增量收据 | 检查方 / 结论 | 遗留去向 |
| --- | --- | --- |
| v3.1，`66313542d3` 设计 + `d14b17a2ea`/`9a08725438` 实施反例 | Codex / GPT-6 作者定向核对；重跑原反例 1 pass，真实 Bus/DB 新探针 1 pass，均 exit 0；生产链定向 diff 为空。没有实施生产代码、没有新独立审查结论 | r4 待批状态由 r5 的 U-40 解决；证据继承，不重审其它范围。 |
| r5 / `4466819664` + U-40，授权与登记 delta | Codex / GPT-6 作者核对；按 owner 原话确认批准来源，仅消除待批标记、固定登记归属，无新增独立审查轮次 | **frozen**；无 owner-only 决定；SC-02 实现与端到端证明仍留实施。 |

本轮检查：`packages/ui-mac` 执行 `bun test src/main/old-name-scan.test.ts`，exit **0**、10 pass / 0 fail；按已解析 delivery profile 调用 `check_repo(..., changed_since="HEAD")`，本文 findings 为 **0**，元数据/本地链接/旧名词元及 `git diff --check` 通过。文档检查只针对本次增量；按本轮「commit only the design」不更新索引，也不把现有 index.stale 报成全仓通过。尚未验证 SC-02 的实际接线/回调故障、完整 live card 和各消费者端到端；现有探针证明的是旧接缝不足及所需前置边界，不能宣称第二 hook 已经生效。没有新增产品限制或规格取舍。

### R1 处置（继承，受 R2 修正的部分以下文为准）

独立 R1：Claude Opus 5.5，只读，审查 `582f056887`，BLOCKED（2 Blocker、4 Major、1 Minor）。编排器全部接受，r2 已修正；R2 进一步纠正其故障终态、固定尾部和 env 分类，不继承旧的错误推导。

| finding / 处置 | 有效决定与证据 |
| --- | --- |
| R1-B1：整段延迟发布移除直播；接受 | 保留每 flush 直播和 end 并集重遮盖（§2/§4.5）；R2 将固定 L−1 改为真前缀尾部，并把故障终态收敛为仅说明。LIVE-01 的先打印后落盘窗口由规格 v3 批准。 |
| R1-B2：全 scalar/全文短项污染全部输出；接受 | §4.1 只提取逐 profile 凭据字段，所有格式统一公开值规则；默认剪枝依赖树、显式保护路径例外。R2 补 envrc 属 env、云登录缓存与 OIDC 字段。 |
| R1-M1：Code Mode 共享调用 ID；接受 | §4.3/§4.7 指定 policy.seal 的 confirm/pin 后根 begin；children 仅 retained values + 结果时重读，不建独立状态/清理。 |
| R1-M2：无界原文内存；接受 | §4.5 逐 shell 内存 key、逐帧认证加密 spill、流式终态重写；无输出上限。R2 明确孤立密文归既有 Core cleanup。 |
| R1-M3：env 写回会存遮盖符；接受 | §4.3.1 在原 write/edit/patch 前恢复局部副本，不改 pin 后事件；R2 冻结按键出现序号恢复，不能用末值。 |
| R1-M4：SQLite 明文查询漏遮；接受 | §2 官方 594.0.1 源码哈希/实际 DDL 的只读及对照探针 exit 0；§4.1 凭据列及 Firefox cookies.sqlite。 |
| R1-m1：KUBECONFIG 是路径列表；接受 | §4.2 按 path.delimiter 逐项解析，Windows 与 Unix 样本各用本平台语义。 |
| OPTIONAL 三项；接受 | stat 五元组缓存；ANSI 先归一化再匹配（R2 指定共用 stripAnsi）；ext reload 隐藏运行后台 shell 输出（R2 指定 end 仅说明）。 |

### R2 处置与冻结

独立 R2：Claude Opus 5.5，只读，范围 `582f056887..d336e59d04`，FIX-THEN-MERGE（3 Major、3 Minor）。编排器当轮要求纠正后直接 frozen、不追加同轮复审；v3.1 因后续实施新证据单独重开。本表是修正/核对收据，不伪造独立复审通过。

| finding / 处置 | 最小修正与证据 | 结论 |
| --- | --- | --- |
| R2-M1：中途故障前缀落入最终文件/记录，违反 BR-07；接受 | §4.5/§5：withheld 含 ext reload 一经锁存，Core 在 end 生成仅说明 staging 并原子替换最终 capture，再完成 outputDone；Shell.result、Job、后台通知、模型、记录消费同一文件。直播已见缓存不回撤、不得用于终态。探针真实 rename 后只有说明 | corrected / frozen |
| R2-M2：固定 L−1 尾部阻塞空闲进程末行，损害 AC-09；接受 | §4.5 只保留最长真前缀后缀（Aho-Corasick 状态深度），其它文本即时 publish；无 idle 定时器。§2 的普通末行及每切分点探针为正例，旧固定尾部为失败对照 | corrected / frozen |
| R2-M3：envrc 错列 credential-document；接受 | §4.1/§4.3/§4.4：envrc 是 env profile，静态 export 赋值、每个值默认秘密并用同一公开规则；直接读为变量视图，绝不执行 shell | corrected / frozen |
| R2-m1：kube OIDC 缺 id-token；接受 | §4.1 加 `users[*].user.auth-provider.config.id-token`；§2 引 Kubernetes 一手 OIDC 文档 | corrected / frozen |
| R2-m2：只去颜色与卡片归一化不一致；接受 | §4.5/§4.7 复用 `ansi.ts:6` 纯 stripAnsi，全部已支持 CSI/OSC，直播和终态均先归一化；探针直接调用该真实函数，未复制正则 | corrected / frozen |
| R2-m3：重复键恢复误用末值；接受 | §4.3.1 按 `(文件,键,出现序号)` 取当前 RHS，edit/patch 先定位全文序号；§2 探针证明 parseEnv 后值覆盖与逐次 RHS 不同 | corrected / frozen |
| 补充：孤立 spool 清理、新文件发现、云登录缓存；全部接受 | §4.5 Core 下次启动/既有周期 cleanup 清孤立专用密文；§4.3 目录 stat 变化才 readdir、已知文件独立 stat；§4.1 加 AWS sso/cache、cli/cache、Azure service_principal_entries.* 并以一手源码定字段 | corrected / frozen |

**LIVE-01 已解决，无待 owner 项。** 2026-11-26 U-39，owner「这两个你的建议是什么，按你的建议吧。」；规格 v3 / #1769 已批准先打印后写入受保护文件的值可能出现在实时卡/运行文件，结束后并集重遮盖，并批准非 env 只提凭据字段。原 LIVE-01 关于中途故障可保留前缀到终态的另一半删除；BR-07 没有改动，按 R2-M1 收口。不以 U-38 冒认直播残留授权，也不再请求相同确认。

### 已有 Owner 裁决与接管登记

**O-1 已批准，不重开。** 2026-11-26 U-38，owner 对引擎改动等问题回答「好的。」。SC-01 的同一 Core 捕获生命周期与 Effect/Promise capture 面、规则仍在扩展的边界不变；直播 flush、终态 replace/withheld 和捕获临时材料清理都在该面内，不新增模型、synthetic 或 UI 接管。

**O-2 已由规格 v2 解决并由 v3 继承。** `834e269da9` / #1765 明确前后可读值范围与故障整次隐藏；没有批准取消直播或保留故障终态前缀。U-39/规格 v3 单独解决实时逐段遮盖与先打印后落盘窗口。技术修正不增加用户确认、配额、等待步骤或停执行。

SC-01 的登记权威固定如下；这是架构边界决定，本设计提交不修改规则或运行登记资产：

- 新增接管 ADR 落在现有运行规则 ADR 命名空间，使用当前空闲的 `.claude/rules/adrs/ADR-050-secrets-output-capture.md`，记录 U-38/U-39、规格 v3、公开 hook 不足及三个最小接管面；不重写已批准的 ADR-047 代际决定。
- 唯一权威册 `docs/architecture/codepuppy-authority-registry.json` 新增决策 ID `secrets-output-capture`。`takeovers` 只列 SC-01 的 Core Shell 捕获/清理生命周期与两个 ShellHooks 面，`mechanism` 指向实际持有遮盖规则的扩展；`adr`/来源关联 ADR-050、#1758 与 U-38/U-39。真实实现/证明到位时按已有格式登记 proof，不填不存在的测试、不登记成 blocked 项。
- 上游准入逐文件登记在 `scripts/north-star-guard.sh:124` 的 `UPSTREAM_EXCLUDES`；CI 的 `.github/workflows/codepuppy-ci.yml:126-133` 调同一脚本，不重建第二张 CI excludes 表。沿用 parity/authority judge，不加包级豁免、不以设计文字替代登记。守卫 `:117-118` 的旧双表说明与当前调用接线不符，仍只消费实际单一权威，不修旁观注释。

登记与 SC-01 实现同一行为变更生效；本轮只冻结决定与授权，不伪造已实现机制或验证。实施消费规格 v4、本节来源与 §4/§5；原 ANSI 纯函数只是已有 callable 复用，不构成新的 UI 接管。

### 检查收据

| 轮 / 版本与范围 | 检查方 | finding 与结论 | 遗留去向 |
| --- | --- | --- | --- |
| r0 / `ef920c7580`，成功 hook 与采集反例 | Codex / GPT-6 作者自查 | 真引擎成功 hook 的正反探针继承；采集反例由后续规格界定 | O-1/O-2 已由 U-38 处置 |
| **R1 / `582f056887` / §2、§4、§5、§10** | **Claude Opus 5.5，独立只读** | **BLOCKED：2 Blocker、4 Major、1 Minor；全部接受，r2 纠正，部分技术推导再由 R2 纠正** | 无未处置 finding，历史审查结论不改写为 pass |
| r2 / `d336e59d04`，规格 v2 / R1 delta | Codex / GPT-6 作者自查 | gcloud schema/只读对照与 crypto/stat 探针 exit 0；Code Mode、写回和直播接缝继承 | 原 owner 项由规格 v3 解决，其余错误推导按 R2 表修正 |
| **R2 / `582f056887..d336e59d04` / 六项 delta 与直接消费者** | **Claude Opus 5.5，独立只读** | **FIX-THEN-MERGE：3 Major、3 Minor；编排器接受并要求 fix-then-freeze** | 全部本轮纠正；明确无第三轮 |
| r3 / 本文、规格 v3 / R2 delta | Codex / GPT-6 作者自查 | §2 七项定向探针 exit 0；§4.7 新能力逐项落现成 callable、明确新增或 SC-01；六项 finding/三项补充与 owner 来源已核对 | frozen；无 owner-only 决定；未实现/真机证明留实施验收 |

文档验证（r3）：在 `packages/ui-mac` 执行 `bun test src/main/old-name-scan.test.ts`，exit **0**、`10 pass / 0 fail`。按已解析 delivery profile 调用 `check_repo(..., changed_since="HEAD")`（全仓读取、按本文路径核对），本文 findings 为 **0**；仓级仍有既有 index.stale、链接/元数据及跨仓 ID 告警，不宣称仓级文档门通过。review 元数据、章节编号、本地链接、旧名词元、ADR 号空闲与 `git diff --check` 自查通过；只从生成器提取本文索引行，不扩项重写全仓索引。

**实施注记（已接受补充，不是工作单元/测试清单）**：重读缓存使用文件与目录 stat，SQLite 含 WAL/SHM；跨 chunk 的归一化边界适配只调用共用 stripAnsi；匹配仅保留真正未决前缀。ext reload 使运行后台 shell 的后续输出隐藏，进程继续，最终文件/记录只有说明；已见直播缓存不回撤，丢失 key 后绝不透传/换 key 恢复旧 spool。孤立密文清理归 Core 既有 cleanup。

**仍未核验**：SC-01、增量归一化/matcher、env 写回包装、各 profile 解析与 spill/staging 尚未实现；全消费者真引擎故障注入、真实并发/目录变化与出货 Windows/Node SQLite 验收仍属实施证明。本机临时原语/算法探针不冒充出货验证，也不承诺 LIVE-01 窗口内新值从未被已见直播消费。

**留档**：入口索引与守卫旧说明保持原处置，不改运行规则/权威册。R1/R2 的历史 finding 已处置；当前产品以规格 v5 为准（v3.4 同步）。SC-01/SC-02 授权继承；v3.2 的 SC-03 候选已由 U-42 决定不实施，v3.3 仅补 SC-01 的多段发布形状；无待 owner 项，不伪造新增独立审查或已完成实施。
