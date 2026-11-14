---
id: PLAN-unattended-run-permissions
title: 没人在场的任务不再空等批准 实施计划
summary: alpha-code#1699 用一个交付段闭合名单登记、工具即时裁决、失败记录与补充信息取消,列出提交顺序、并行合并风险和逐项验收证据
kind: plan
status: active
spec: SPEC-unattended-run-permissions
design: DESIGN-unattended-run-permissions
owners: [owner]
last_reviewed: 2026-11-14
---

# PLAN-unattended-run-permissions｜没人在场的任务不再空等批准 实施计划

## 无人值守运行的即时裁决与记录

- 依据:[alpha-code#1699](https://github.com/impharaon/alpha-code/issues/1699) 当前正文;[规格 v2 @ 8573c17dd8](https://github.com/impharaon/alpha-code/blob/8573c17dd8/docs/specs/unattended-run-permissions/spec.md),AC-01 至 AC-08;[冻结设计 @ a00ed8792f](https://github.com/impharaon/alpha-code/blob/a00ed8792f/docs/specs/unattended-run-permissions/design.md) §4.1—§4.5、§5、§6、§8、§10。
- 核对:待编排器核对计划提交;恢复实施后的第一个实现提交从续派 brief 的 `Phase:` 行补入提交、核对者/模型及结论。

一个交付段足够。名单、裁决和记录共用同一次运行及同一拒绝合同,拆成独立交付会留下无法独立验收的中间状态;段内按下列提交单元顺序实施,不另拆 Issue。下文仅定文件、私有实现落点、顺序与证据;契约、规则表和边界直接消费上述设计。

计划探查基线为 `04562a7ced`(指定基点 `3a8e25d6b8` 已合入设计分支),工作区起始干净。冻结设计文件与指定提交一致;现树规格相对指定提交仅修正批准记录中的外仓链接,BR、AC 和体验文案相同。计划阶段从 2026-11-14 12:01 UTC 开始,只读代码,未运行测试或启动引擎。

### 改动

路径均相对仓库根。标为「新增」的是既有包内的叶文件,不增加目录或架构模块。

| 文件 | 改什么 |
| --- | --- |
| `packages/schema/src/codepuppy-unattended.ts`、`codepuppy-unattended.test.ts`(新增) | 按设计 §4.1 落共享定义;测试真实 schema 的有效/无效解码及文案函数,不改包清单或根 barrel。 |
| `packages/ui-mac/src/main/codepuppy-sidecar-messages.ts`、`codepuppy-sidecar-messages.test.ts` | 增补 §4.2 消息对及穷举分发,命名 `buildUnattendedLive` / `parseUnattendedLive`、`buildUnattendedAck` / `parseUnattendedAck`;补坏输入、方向及往返判据。 |
| `packages/ui-mac/src/main/codepuppy-unattended.ts`、`codepuppy-unattended.test.ts`(新增) | `createUnattendedRuns` 管理 main 的名单、发送口与待回执;导出 main 共用的 `unattendedRuns` 实例。登记/注销只由两个运行入口调用;提供 `register`、`unregister`、`acknowledge`、`attach` 私有包内入口供接线和测试使用。 |
| `packages/ui-mac/src/main/hub-view.ts`、`hub-view.test.ts`、`codepuppy-sidecar-wiring.test.ts` | 在现有 host 的 `receive` 分派回执,`attach` 同时接上名单与重载的发送口,断开时分别收尾。沿用 `server.ts` 已有接线,无需修改 `server.ts`、`ext-ipc.ts` 或 `index.ts`。 |
| `packages/ext/src/policy/unattended.ts`、`unattended.test.ts`(新增) | `createUnattendedState` 管理 ext 快照及已退出的 `promptID`;`unattendedProfile` 按 §4.2 求档位,`preparePrompt` 在已有 prompt 钩子最前面处理退出。状态由现有进程级 `hubBridge` 持有,不另建全局单例。 |
| `packages/ext/src/hub-bridge.ts`、`hub-bridge.test.ts` | `createHubBridge` 持有上述状态,在现有进程级监听的独立分支同步安装快照并发回执;这一路不进入按数字 id 结算的请求簿。 |
| `packages/ext/src/plugin.ts` | 保留 `registerPolicy` 首个 await / `seal` 最后注册的次序,把 `processState().hubBridge` 持有的无人值守状态传给 `registerPolicy`;不改其余启动、环境和注入逻辑。 |
| `packages/ext/src/policy/gate.ts`、`index.ts` | 在 `gate.ts` 放 `unattendedGateVerdict` 和 T2 的属性钉法 `holdUnattendedDeny`;由现有 `decide`、`confirm`、`gateWithoutToolCall` 及 evaluate 钩子调用。在 `index.ts` 的 Location 内保存尚未结束的 Code Mode 调用及第一条拒绝,用真实外层 id 关联。 |
| `packages/ext/src/policy/display.ts` | 增加 `attachUnattendedDenial`,在现有 `execute.after` 路径补记外层终态并清除本次簿记;保留已有显示、网络错误和底层 error 字段。 |
| `packages/ext/src/policy/unattended-policy.test.ts`(新增) | 复用 `policy-host.cases.ts` 的真实权限服务、Promise 适配器及工具执行链,新增 T1/T2、无工具调用断言、Code Mode、档位/生命周期的行为判据;不复制规则实现。 |
| `packages/ext/src/policy/register-policy.test.ts`、`tool-policy-rpc.test.ts`、`risk.test.ts`、`inventory.test.ts` | 仅调整 `registerPolicy` 的宿主接线,每个测试宿主显式传入自己的空状态;这是新增必需依赖的直接调用点同步,现有断言保留。 |
| `packages/ui-mac/src/main/engine-session-turn.ts`、`engine-session-turn.test.ts` | 给包内 `promptAndWait` 的输入增加 `id?: string`,按有值才编码的现有风格传给 `session.prompt`;原有等待与回复处理不变。 |
| `packages/ui-mac/src/main/automation-run-outcome.ts`、`automation-run-outcome.test.ts`、`unattended-run.messages.fixture.json`(新增) | `readAutomationDenial` 经真实客户端按 `cursor.next` 拉全这次会话消息,`firstAutomationDenial` 负责 §4.4 的单一投影实现;读失败只日志。JSON 样本从下述真引擎用例的消息导出,附生成命令、用例名与源码版本,不手写引擎消息替身。 |
| `packages/ui-mac/src/main/automation-elicitation.ts`、`automation-elicitation.test.ts`(新增) | `watchAutomationElicitations` 做运行期间的项目表单发现与取消,保存本次实际取消的首个连接器名,返回停止/清理入口;发现策略和时钟证据见下文。 |
| `packages/ui-mac/src/main/automation-scheduler.ts` | 在 `executeTask` 接入登记、带 id 的 prompt、全结局投影、表单取消和 `finally` 收尾;统一形成 `AutomationRunRecord` 与 `status.json`,保留成功回合的 `report.md`。握手失败使用 §4.2 的现有未就绪路径。 |
| `packages/ui-mac/src/main/automation-llm.ts` | 在 `llmParseAutomation` 接入登记、会话 permissions、prompt id 和注销,保持现有解析结果形状与临时会话清理。 |
| `packages/ui-mac/src/shared/automation-types.ts`、`automation-schedule.ts`、`automation-schedule.test.ts` | 前者让 `AUTOMATION_DEFAULTS` 的两项载体取值消费共享表;后者仅让 `shouldTripBreaker` 消费已有 `reasonCode`。两处是设计 §4.1/§4.2 指定事实的现有消费者,必须随主进程调用链同步。 |
| `packages/ui-mac/src/main/codepuppy-config-injection.ts`、`codepuppy-config-injection.test.ts` | 两个自动化 agent 的对象键和相应文本索引消费载体权威;规则内容照旧,不动 `CODEPUPPY_INJECTED_AGENTS`。 |
| `packages/ui-mac/src/main/moderation-automation.cases.ts` | 现有两个入口的测试宿主补真实名单桥的回执与表单列表接线,仅适配新增必经调用,不替换/删减原断言。 |
| `packages/ui-mac/src/main/unattended-run.engine.test.ts`、`unattended-run.engine.cases.ts`(新增) | 子进程宿主验证真正的 `runAutomationNow`、调度触发和 `llmParseAutomation`,连接沙箱真引擎、生产 ext/客户端、脚本模型与本机 MCP 服务;按证据表核对工具副作用、审批事件、磁盘记录及连接器回执。 |
| `docs/architecture/codepuppy-authority-registry.json` | 增加本决定的一条 held 登记,引用实际机制文件和实际测试名称;不增加 takeover。 |
| `docs/architecture/constraints.md` | 只更新 K1 对应行中本次两个自动化载体的权威及可达性,注明本票;保留设计 §10 O-4 等剩余范围,不宣称整行偏离消失。 |
| `docs/specs/unattended-run-permissions/plan.md` | 首个实现提交补核对行;发生实施偏离时在同一提交更新本段。 |

补充信息采用立即检查一次、随后每 250 ms 一次的单个不重叠轮询,间隔为该文件私有常量。每次只处理 §4.5 的目标表单;停止后不再开启请求,中断并收妥本次在途检查。列表传 `form.list({ location: { directory } })`;取消经 `session.form.cancel` 的 request options 传 `x-opencode-directory: encodeURIComponent(directory)`。当前客户端取消输入没有 `location` 字段(`packages/client/src/promise/generated/types.ts:3770`),请求头是它已有的定位入口,同包生产先例为 `packages/client/src/solid/data.ts:197`、`:2009`;这落实 §4.5 的项目定位,不扩生成客户端合同。

### 顺序

1. **基线与可失败的回归。** 实施开始后先串行跑 C1—C4、C6—C8 中已有测试,再跑三个包的适用 typecheck;重复确认的基线失败按 brief 返回。先提交能在未修复生产代码上执行的 AC-01、AC-02、AC-07 核心回归用例,只调用已有入口,不 import 尚不存在的模块。以实际 `Permission.Event.Asked` 与运行结局的事件竞争立刻暴露空等,红因必须是行为缺失,不能是缺导出或加载错误。修复提交不改这些红例的断言。
2. **共享定义、通道和运行生命周期。** 落 schema、消息对、main 登记簿、ext 快照、现有 host 接线、prompt id、两个入口与熔断消费点;同步载体取值。把状态从现有 `processState().hubBridge` 传入策略注册,先接 T2 和外来 prompt 退出。补 schema/桥/状态/时钟判据,跑 C1—C3、C5/C6 中本单元涉及项及 C7/C8。此提交中的失败记录只用既有未就绪结果,不创造中间业务规则。
3. **工具裁决与记录闭环。** 在现有闸补 T1,接 Code Mode 第一条拒绝补记与完整消息投影,把成功、失败、中断都接到同一运行记录形成处。跑 C3—C5 及新 outcome 单测,核对前述回归转绿,并补齐 AC-03/04/08 与 AC-06 的真路径证据。同期落实 U-2、U-3,不另开设计调查。
4. **补充信息与收口。** 接入 watcher、取消原因回落及 `finally` 清理,用 C5 的真实 MCP 回执落实 U-1,用 C6 的受控时钟证据守住轮询时限。更新 authority registry 的真实证据名及 K1 行,跑 C9;跑所有本段新增/修改测试和尚未通过的相关测试,三个包各执行 `bun typecheck`,检查最终 diff。已经通过且本单元未受影响的检查不重复跑。

上述为顺序提交单元,不是可独立发布的切片。每完成一条 AC 记录实际测试名、命令、退出码并核对用时;命中 brief 的尺寸/时间停止条件就返回,不扩查旁支。PLAN 阶段只提交本文件,不提前执行上述命令。

### 风险

| 风险 | 用什么控制 |
| --- | --- |
| ext 模块按 Location/重载重新求值,状态若建在策略注册内会丢或串目录 | 状态挂在现有进程级 hubBridge,测试两个 Location 与重载后仍消费同一快照;Location 内仅存本次 Code Mode 的暂态簿记。 |
| 回执、旧快照、人工插话与运行完成的排序问题 | 用受控双向 port 和准备输入的真实钩子覆盖 §6 I-1、I-7—I-9;按 seq/nonce 两轴分别造错,不借共享自增查询 id。 |
| T2 与已有 `holdAsk` 对同一属性的不可配置钉法冲突,或遗漏后续 allow→ask | 在册分支在既有 holdAsk 前处理并退出;C4 覆盖初值三种和后续所有写法,未登记的原有分支沿用现有判据。 |
| Code Mode 子调用和外层共用 id,错误又可能变成外层成功;早期拒绝落在最近 50 条之外 | 真 Code Mode 的外层成功/失败都查持久化 metadata,保留第一条拒绝;投影测试多页、早期拒绝和无效 metadata,绝不复用 `promptAndWait` 的 50 条回复窗口。 |
| 轮询造成重复取消、晚到响应污染下一次运行,或 global 表单落到 scratch | 每个运行独立 watcher、请求不重叠、在途按 id 去重、finally 收尾;C5/C6 断言两个项目的真实定位、取消竞争和结束后无请求。250 ms 用虚拟时钟证据,不加真实耗时上界断言。 |
| 握手未完成就发 prompt,或未运行记录触发连败停用 | C2/C5 的 withheld/wrong ack 先证明没有 prompt,虚拟 20 s 到期后检查既有失败码、删空会话和注销;C8 混合成功/失败/未就绪/skip 的真实判定。每日计数保持现有断言。 |
| AC-03/08 的输入样本误扩设计已经裁定的范围 | 按 §10 O-1/O-2 取样:只读写工具以默认询问/每次询问触发,另留「已启用照旧」控制臂;停用用先取得工具再停用的真实竞态,不把已隐藏的工具重新塞入模型清单。 |
| 与「界面数据约定重构放回」线合并 | 本计划无 `packages/ui-mac/src/engine-adapter/**` 改动;本地 main 仍直接用当前客户端。其合入后由编排器复核 C5/C7 的实际消息与审批面证据,不在本票改适配器。 |
| 与 #1713 项目配置同意线可能同改 | 明确交叉文件:`packages/ui-mac/src/main/codepuppy-sidecar-messages.ts`、`codepuppy-sidecar-messages.test.ts`、`codepuppy-sidecar-wiring.test.ts`;若它的注入接线落在现有配置生产方,还涉及 `codepuppy-config-injection.ts`、`codepuppy-config-injection.test.ts`。保留两方消息分支,按编排顺序集成后核对 C2/C5/C7。 |
| 与 #1698 typed bootstrap 线可能同改 | 明确交叉文件:`packages/ext/src/plugin.ts`、`packages/ui-mac/src/main/codepuppy-config-injection.ts`、`codepuppy-config-injection.test.ts`;相关注册顺序由 `plugin-setup-order.test.ts` 核对。`plugin.ts` 的本票改动仅为传入既有进程对象,避免扩大相交 hunk。 |
| 三线都可能同步架构登记 | 共享冲突点:`docs/architecture/codepuppy-authority-registry.json`、`docs/architecture/constraints.md`。保留各自新增登记和事实,不整份覆盖;最终由 C9 核验。 |

测试只用既有安装依赖。真引擎用例在独立子进程里先建立 `engineSandbox` 并调用 `assertEngineSandboxed`,再装载引擎;模型/MCP 只监听回环随机端口,所有文件和凭据均为沙箱哨兵。所有测试命令串行前台完成,不调用安装应用,不使用真实数据、keychain 或外部服务。

### 证明

以下均是**实施阶段待新增/运行的证据**,计划阶段没有测试通过声明。单测验证具体裁决与逻辑时限,真引擎用例验证入口接线、适配器、消息持久化和运行落盘,两者共同覆盖一条 AC。

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01 | C4「标准档默认询问的 MCP 工具直接执行,零 Asked」及「已启用工具保持可执行」;C5「标准档连接器成功写入运行记录」,通过实际 MCP 调用日志、`getAutomation` 历史、磁盘 `status.json` 和 `report.md` 判定。 | 未接 T1 则真实总线出现 Asked,或工具调用计数为零;只改 gate 而漏接调度器,运行记录仍不成功。 |
| AC-02 | C4「标准档每次询问直接执行,零 Asked」;C5「每次询问的连接器在自动化里成功」,策略经真实 store 写入,与 AC-01 用同一工具。 | 漏掉 user ask 分支即产生 Asked/停在 assert;只伪造成功摘要则 MCP 日志仍为空。 |
| AC-08 | C4「来源变化立即具名拒绝」及「工具选出后被停用立即具名拒绝」;C5「直接调用和 Code Mode 拒绝都进入运行失败原因」。比对 `identity.name`、共享原因结构、终态 metadata、记录与 `status.json.error`。采用 D1。 | 保留原先询问则 D1 捕获 Asked;错放行则副作用计数增加;遗漏 Promise 错误 metadata 或外层补记则运行记录无法得到文案一。 |
| AC-03 | C4「只读档写入 MCP 的默认询问与每次询问都立即拒绝」;C5「只读拒绝后模型正常收尾,运行仍记失败且保留报告」。另有已启用工具控制臂。采用 D1。 | 把 readonly 当 standard 则写副作用发生;只让模型看到错误而漏投影则 idle succeeded 被误记 ok;误收紧既有已启用工具则控制臂红。 |
| AC-04 | C4「标准档敏感文件、子任务、项目外目录维持拒绝」,使用真实 ReadTool/SubagentTool/目录断言及生产注入规则;C5 核对 `permission.rejected` 的运行失败投影。`.env` 只在临时项目写无密钥哨兵。采用 D1。 | 放宽配置 deny 会执行读/子任务/目录动作;只验证抛错而丢记录会使 `status.json.error` 或共享投影断言失败。 |
| AC-05 | C6「最不利轮询相位仍在虚拟 250 ms 取消表单」;C5「项目 MCP form/URL 补充信息收到 cancel 后任务可收尾」。真 MCP SDK 记录 `{ action: "cancel" }`,另测连接器因 cancel 失败时的原因回落和成功时不误记失败。采用 D2。 | 不取消会留 pending、连接器无回执;目录遗漏会取消不到 global 表单;只改摘要会在真实 MCP 回执断言失败;多等一秒会在虚拟时间判据失败。 |
| AC-06 | C4「未登记的询问档仍产生 Asked 并等待人工回复」;C5 用同一连接器检查权限列表存在请求,手工 reply 后才见副作用。另测只有载体名/伪造 metadata 的普通会话、运行后续聊及运行中插话;C3/C4 覆盖外来输入退出。C4 相关回归含现有 `ask-deadline.test.ts`。 | 按 agent/metadata 冒认、错误扩大名单或新钉法侵入交互分支,会缺卡或提前执行;漏掉退出/防重装,在旧快照重放后不会重新等待。 |
| AC-07 | C4「none 档初值 allow 后被后续安装钩子改 ask 仍立即拒绝」及无工具调用断言;C5「一句话解析登记后才发指定 id,询问立即拒绝且 finally 注销删会话」。覆盖正常解析与明确 unavailable,检查不产生子会话。采用 D1。 | 只处理初值 ask 会漏掉后续钩子;漏登记会产生 Asked;漏会话 subagent deny 会产生子会话;错误回执仍能 prompt 会使顺序证据红。 |

时限与生命周期的共同判据:

- **D1(AC-03/04/07/08,兼用于 AC-01/02)。** 在真实 policy host 使用 `it.effect` 的 TestClock,登记/插件激活完成后冻结逻辑时钟,执行真实工具/权限入口,以执行结局和实际 Asked 事件作竞争。期望操作在**不推进任何计时器**时已经完成,Asked 总数为零、pending 为空、禁止动作副作用为零;若缺修复而创建请求,事件竞争立即红。若实现偷偷等待计时器,冻结时钟下不能完成,测试不会靠调小审批超时变绿。测试宿主的普通防挂超时只用于结束坏例,不拿真实耗时与 1 秒比较。
- **D2(AC-05)。** 用 Bun 1.4.4 的 `vi.useFakeTimers` 驱动生产 watcher。第一次空列表返回后立即出现表单是最坏相位;只推进 249 ms 时尚未新查,推进至 250 ms 后实际客户端请求必须包含取消,取消 Promise 已完成且表单不再 pending,期间不再推进时钟。测试等待受控列表/取消 Promise 的交接完成,不以固定次数的微任务 flush 或真实 sleep 猜时序;延迟到 1000 ms 才完成的实现不能通过。另测初次已有表单、多个表单、取消 404/409、其他错误日志和 stop 时的在途清理。真引擎的 MCP 回执验证真实通道,不承担机器负载敏感的秒数断言。
- **名单与握手(C2/C3/C5)。** 「没有正确 ack 不发 prompt」「错误 nonce、错误 seq 和跨连接晚回执不能结算登记」「20 s 虚拟到期用既有未就绪结果」「attach 重推、detach 只断自己那代」「陌生 unattended 消息不改 main 名单」。分别检查线上消息、真实 prompt 次数、删空会话与 finally 注销;不是只测内部 Map。
- **I-5/I-7/I-9(C3/C4/C5)。** 覆盖 agent 不一致/缺省时读当前 agent、原 prompt 不退出、外来 prompt 在 `catalog.ensureTail` 前退出、后续快照不能装回同一个 promptID、新一轮新 promptID 可登记;通过真实 fork/子会话/会话更新及外来 prompt 调用检查未登记会话仍需审批。引擎进程内 JS 绕过不在测试边界。
- **投影(C5/C6)。** 真引擎消息提供直接 Tool.Error、Code Mode 外层 completed/error、`permission.rejected` 的样本,验证顺序上第一条、跨分页、无效 metadata 不崩、idle failed/interrupted 也读取、超时优先、消息读取失败只日志,以及 `summary`/`status.json.error` 一致。断言缺失结构或漏读首段时必须红,不从错误文案反推类型。

夹具来源:权限规则消费 `injectCodePuppyConfig` 的实际输出,策略记录经生产 store 写入;工具/消息的形状取真实 SDK、引擎返回或同名真引擎用例捕获。MCP echo 复用 `packages/core/test/fixture/codepuppy-mcp-startup-stdio.ts`;补充信息服务在新的 `.cases.ts` 内使用已安装 MCP SDK,参照 `packages/core/test/mcp.test.ts:220-254` 的实际 `elicitInput` 用法生成非空 form 和 URL 请求,不手写另一套协议报文。纯投影单测使用这些沙箱样本并标注来源。

检查命令索引(均在实施阶段执行):

每个 shell 先执行 `export PATH=$HOME/.bun-versions/1.4.4/bin:$PATH` 与 `bun --version`,输出必须为 `1.4.4`;下表的工作目录为包目录。一个命令结束后才执行下一个,多项命令逐条运行。

| 索引 | 工作目录 | 命令 |
| --- | --- | --- |
| C1 | `packages/schema` | `bun test src/codepuppy-unattended.test.ts` |
| C2 | `packages/ui-mac` | 分别运行 `bun test src/main/codepuppy-sidecar-messages.test.ts`、`bun test src/main/codepuppy-unattended.test.ts`、`bun test src/main/hub-view.test.ts`、`bun test src/main/codepuppy-sidecar-wiring.test.ts`。 |
| C3 | `packages/ext` | 分别运行 `bun test src/hub-bridge.test.ts`、`bun test src/policy/unattended.test.ts`。 |
| C4 | `packages/ext` | 分别运行 `bun test src/policy/unattended-policy.test.ts`、`bun test src/policy/register-policy.test.ts`、`bun test src/policy/tool-policy-rpc.test.ts`、`bun test src/policy/risk.test.ts`、`bun test src/policy/inventory.test.ts`、`bun test src/policy/ask-deadline.test.ts`、`bun test src/plugin-setup-order.test.ts`。 |
| C5 | `packages/ui-mac` | `bun test src/main/unattended-run.engine.test.ts`(宿主启动自己的隔离 `.cases.ts`,不另开并行测试)。 |
| C6 | `packages/ui-mac` | 分别运行 `bun test src/main/automation-run-outcome.test.ts`、`bun test src/main/automation-elicitation.test.ts`。 |
| C7 | `packages/ui-mac` | 分别运行 `bun test src/main/engine-session-turn.test.ts`、`bun test src/main/moderation-automation.test.ts`、`bun test src/main/codepuppy-config-injection.test.ts`、`bun test src/main/codepuppy-config-injection-engine.test.ts`。 |
| C8 | `packages/ui-mac` | `bun test src/shared/automation-schedule.test.ts`。 |
| C9 | `packages/ext` | `bun test src/policy/authority-registry.test.ts`。K1 文档证据为实际差异与所引路径检查,不加标题/措辞断言测试。 |
| 包检查 | 依次为 `packages/schema`、`packages/ext`、`packages/ui-mac` | 各执行 `bun typecheck`。 |

PLAN 验证只做文件/diff 的只读检查并提交本文件。实现后的全量 gate、推送、PR、合并和打包版核对归编排器;本段不提前运行这些动作。

### 偏离记录

暂无。
