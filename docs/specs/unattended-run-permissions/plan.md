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
- 核对:`3cd17472e3` · 编排器(Claude Fable 5.2)· 通过。

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

实施证据(2026-11-14,本次实施从 12:30 UTC 计时):

- 单元 1 基线:C2 的消息合同 9 pass、hub-view 18 pass 沿用 r2;sidecar wiring 6 pass 沿用编排器 r3 回执。C3 既有 hub-bridge 5 pass;C4 既有 register-policy 68、RPC 5、risk 22、inventory 5、ask-deadline 5、setup-order 1 pass;C7 turn 2、moderation 1、注入 25、注入引擎 1 pass;C8 19 pass。上述对应索引命令退出均为 0(本轮加 `--only-failures` 抑制通过行)。三个包 `bun typecheck` 均退出 0。
- 单元 1 红证据:`cd packages/ui-mac && bun test src/main/unattended-run.engine.test.ts` 退出 1;子进程 AC-01、AC-02、AC-07 共 3 fail,三者都在 `withoutApproval` 的零 Asked 断言收到 `["mcp:probe:echo"]`。没有缺导出、加载或依赖错误。生产运行/解析入口、真实 ext 与真实 MCP 已走通;测试收到请求后立即拒掉,未改审批期限。
- 单元 2:C1 2、C2 消息 10 / 登记簿 4 / hub-view 18 / wiring 6、C3 bridge 6 / state+T2 3、C4 现有策略 68 / RPC 5 / risk 22 / inventory 5 / setup 1、C7 turn 2 / moderation 1 / 注入 25 / 注入引擎 1、C8 20 pass,均退出 0。AC-07 单独运行 `cd packages/ui-mac && bun test --only-failures ./src/main/unattended-run.engine.cases.ts -t AC-07` 为 1 pass / 0 fail(2 filtered out),退出 0,红例断言未改。三个包 typecheck 均退出 0;schema 的新测试曾因 `.js` 后缀和字面量推断报类型错误,已在本单元修正。AC-01/02 的 T1 放行留给单元 3。
- 单元 3:C4 新策略 14、既有策略 68 / RPC 5 / risk 22 / inventory 5、C3 state/终态 4、C6 outcome 4、C5 宿主 1(子进程 9)、C7 moderation 1 pass,索引命令加 `--only-failures`,均退出 0;ext/ui-mac `bun typecheck` 退出 0。C5 的 AC-01/02/07 原红断言未改,新增 AC-03/04/06/08 和 U-3 的持久化证据;D1 在 TestClock 不前进时通过。真实消息样本含 8 个场景及实际游标,已固化为同段 JSON 夹具。分页请求误带 order 的中间失败已修正,跨页测试会直接拒绝该已知坏请求。

- 单元 4:C1 2、C2 消息 10 / 登记簿 4、C3 bridge 6 / state+T2+外层错误 4、C4 新策略 19 / 既有策略 68 / ask-deadline 5、C5 宿主 1(子进程 14,89 个断言)、C6 outcome 5 / elicitation 5、C7 moderation 1、C9 registry 5 pass,相应索引命令退出均为 0;本单元未影响的 C2/C4/C7/C8 证据继承单元 2/3。三个包最终 `bun typecheck` 均退出 0。另用 `cd packages/ui-mac && bun test --timeout 90000 ./src/main/unattended-run.engine.cases.ts` 捕获真实消息/表单,退出 0;JSON 含 8 个运行场景、3 个实际表单及与最终生产文件一致的 SHA-256。原 AC-01/02/07 红例除排版外逐项比对相同。`git diff --check` 退出 0,实际差异核对无上游/新 takeover/排除文件改动。

逐 AC 的最终执行回执(下面 C4/C5/C6 均使用上方命令索引的包工作目录;实际测试命令加 `--only-failures`,不改变选择范围):

| AC | 实际测试名称与证据 | 命令及结果 |
| --- | --- | --- |
| AC-01 | C4「标准档默认询问的 MCP 工具直接执行,零 Asked」「standard 已启用的 MCP 工具照旧执行」;C5「AC-01 标准档默认询问的连接器成功写入运行记录,零 Asked」。 | C4 `bun test --only-failures src/policy/unattended-policy.test.ts` 19 pass,退出 0;C5 `bun test --only-failures src/main/unattended-run.engine.test.ts` 1 pass(子进程 14 pass),退出 0。 |
| AC-02 | C4「标准档每次询问的 MCP 工具直接执行,零 Asked」;C5「AC-02 每次询问的同一连接器在自动化里成功,零 Asked」。 | 同 C4/C5 命令,均退出 0。 |
| AC-08 | C4「standard {"disabled":true} 立即具名拒绝,没有计时器推进或副作用」「standard {"changed":true} 立即具名拒绝,没有计时器推进或副作用」,工具先选出再改 store;C5「AC-08 来源变化拒绝经过 Code Mode 外层成功终态进入运行记录」。 | 同 C4/C5 命令,均退出 0;D1 不推进 TestClock,实际 MCP 日志无新增。 |
| AC-03 | C4 readonly 默认/每次询问两条即时拒绝;C5「AC-03 只读拒绝后模型正常收尾,运行仍记失败且保留报告」「AC-03 回合失败仍投影先前拒绝,优先于模型错误」。 | 同 C4/C5 命令,均退出 0;D1,磁盘 error 与 summary 同值。 |
| AC-04 | C4「AC-04 配置禁止的读文件、子任务和项目外目录无计时等待」;C5「AC-04 敏感文件、子任务、项目外目录维持拒绝并写入原因」。 | 同 C4/C5 命令,均退出 0;D1 与三条真实工具 `permission.rejected`/磁盘原因互证。 |
| AC-05 | C6「最不利轮询相位仍在虚拟 250 ms 取消表单,global 请求带项目位置」;C5「AC-05 项目 MCP form 和 URL 补充信息均收到真实 cancel,任务继续」「AC-05 取消后回合失败时用连接器名写运行原因」。 | C6 `bun test --only-failures src/main/automation-elicitation.test.ts` 5 pass,退出 0;同 C5 命令退出 0;D2 在逻辑 250 ms 取消完成,真实 SDK 返回 cancel。 |
| AC-06 | C4「未登记的询问档产生 Asked 并保持等待,人工批准后才执行」「外来输入退出后旧快照不能重新授予自动化语义」「在册会话切换 agent 后仅按 none 拒绝,缺省 agent 也读真实当前会话」;C5 询问档与「AC-06 注销后的续聊、真实分叉和子会话不继承无人值守权限」。 | 同 C4/C5 命令均退出 0;`bun test --only-failures src/policy/ask-deadline.test.ts` 5 pass,退出 0。 |
| AC-07 | C4「none 档初值 allow 被后续钩子改 ask 仍立即拒绝,无工具调用的断言同样不等人」;C5 原 AC-07 红例、无通道时解析 unavailable 且不发 prompt/删空会话。 | 同 C4/C5 命令均退出 0;D1。C2 登记簿的错误 seq/nonce、20 s 虚拟超时与 abort 判据 4 pass,退出 0。 |

### 偏离记录

2026-11-14 · 在既定 `policy/index.ts` 内同步在册 T1 的 `session.get` 实际返回形状:该方法直接返回会话,原 `.data.permissions` 会漏掉会话配置的 ask;agent.get 仍使用它实际具有的 `.data` 外壳。单元 4 将这次读取限定于在册分支,未登记分支保留原读取路径,遵守 I-4/AC-06。新增的「standard {"sessionAsk":true} 立即具名拒绝」与真实切换 agent 测试证明本票路径需要实际会话字段,不改合同或上游文件。

2026-11-14 · AC-04 的 subagent 真实引擎夹具仅将工具清单筛选动作改为测试名,使已被清单隐藏的真实 SubagentTool 到达其原始 `subagent` 权限断言;自动化载体 deny 和工具实现均未改,断言未放宽。与 C4 的无计时器权限断言共同证明 AC-04。原红回归的三条用例和断言保持不变,同一 `.cases.ts` 只追加证据和沙箱样本导出。

2026-11-14 · 单元 4 给消息投影传入本次既有 AbortSignal,并在投影完成后再判定超时优先级,避免新增读取拖过任务期限;没有新期限或配置。补充信息测试使用真实 SDK 的 form/URL 和真实取消回执;模型 400 仅在沙箱内制造回合失败。新增/修改文件均在原「改动」表,其余变化为本票新增代码的排版与导入位置整理。

遗留去向:`packages/ext/src/policy/index.ts:123` — 未登记分支沿用原 `.data.permissions` 读取,而 `session.get` 实际直接返回会话;本票按 I-4 保留原行为,建议编排器转原意图项另行核对,不在本票修复。

实际交付规模:39 个文件(其中真实消息/表单 JSON 约 1,200 行,新增测试占主要篇幅);实施 12:30—13:33 UTC,约 63 分钟,在 100 分钟预算内。不涉及迁移。最终采用单段、四个顺序提交单元,没有增加设计分片。


2026-11-14 · R4 独立审查修正(依据编排器本轮回执,基点 `0a0862513a`;从 13:52 UTC 计时):

- 第 1/3 项的真实引擎回归在一次 Code Mode 调用中先停在测试工具,再向仍在册的同一会话发送 prompt 或 shell,释放后才执行每次询问的真实 MCP。用审批事件与运行结束竞争,没有秒数猜测。原「运行后续聊」更名为「注销后的续聊」,只声明其实际证明的范围。
- 红证据:`cd packages/ui-mac && bun test --timeout 90000 ./src/main/unattended-run.engine.cases.ts` 在生产代码 `0a0862513a` 上退出 1,14 pass / 2 fail。shell 插话例预期 `asked` 实得 `finished`;未就绪记录形状例多出 `durationMs`、`sessionID`、`runDir`。prompt 插话例基点通过;临时去掉 `unattended.preparePrompt(event)` 后,同命令加 `-t '在册运行收到 prompt'` 为 0 pass / 1 fail、退出 1,也是 `asked` 实得 `finished`;已用 scoped `git restore` 恢复该唯一生产变异,回归断言保留。
- 第 1 项的合同阻塞:已核实 `packages/core/src/session/session.ts:211-235` 先发布 `session.shell.started`,然后才把结果经 synthetic 入队。但 `packages/plugin/src/promise/event.ts:6-10` 只公开 AsyncIterable;`packages/plugin/src/promise/adapter.ts:51-72,331-344` 经 Promise/异步迭代适配,`packages/core/src/bus.ts:495-506,735-758` 向 unbounded PubSub 发布,不等待该 Promise 订阅者处理完成。扩展能异步观察已发布的启动事件,不能保证 I-9 所写的入队前同步退出。现有同步 `shell.create.before` 的输入(`packages/plugin/src/promise/shell.ts:3-9`)不含 sessionID,无法准确退出目标会话。需要可等待且带 sessionID 的 shell 输入钩子,或方案方明确另定异步观察时点;本轮不改上游/公共合同、不用一个偶然通过的事件流用例代替排序保证。真实 shell 红例保留为这项未完成的证据。
- 第 4 项不等价证据:实际 `Permission.assert` 输入可带动作名 `unattended_write` 的会话 ask,同时身份轴 `mcp:unattended:write` 不 ask,于是 standard 的 T1 为 allow 而引擎原始 effect 为 ask。新增「T1 allow 对无工具调用的原始 ask 与直接 return 不等价」基点 1 pass、退出 0;只把对应分支改成直接 return 后,`cd packages/ext && bun test --only-failures src/policy/unattended-policy.test.ts -t 'T1 allow 对无工具调用'` 为 0 pass / 1 fail、退出 1(成功变成拒绝),已 scoped restore。按本轮第 4 项处置保留生产分支,不改变此可达输入的既有结果。


R4 修正回执:

- 第 2 项:握手失败分支尽力删空会话后,直接返回 `{at,status,summary,reasonCode}`,不经过运行目录写入或失败投影,`finally` 仍注销并清理 timer。上面未就绪形状红例不改断言,转为通过;同例还核对 `.codepuppy/runs` 目录未增加、会话列表未增加、解析 unavailable、不发模型请求、每日计数仍增加。本次只改既定 scheduler 调用链,没有新增界面限制。
- 第 3 项:新增「AC-06 在册运行收到 prompt 插话后,下一个每次询问工具必须出卡」通过,并已证明删掉退出调用即红。旧的注销后续聊/分叉/子会话证据更名后仍通过,不再把它称为退出名单的证明。
- 第 1 项仍 BLOCKED:保留真实 shell 插话红例,没有加入不具备入队前排序保证的异步观察实现。所需合同见上段。`cd packages/ui-mac && bun test --only-failures src/main/unattended-run.engine.test.ts` 退出 1;子进程 15 pass / 1 fail,唯一失败是该 shell 例(`asked` 实得 `finished`),宿主对应 0 pass / 1 fail。第 2/3 项均通过,没有将已知红例 skip 或改成较弱断言。
- 第 4 项按不等价证据保留原分支;新增真实权限入口判据随 C4 通过。引擎进程插件直接调用 synthetic 仍在冻结边界之外,未增加入口或接管。
- 相关检查(上方 C2—C9 索引的包工作目录,逐条 `bun test --only-failures <该文件>`):C2 `src/main/codepuppy-unattended.test.ts` 4 pass;C3 `src/policy/unattended.test.ts` 4 pass;C4 `src/policy/unattended-policy.test.ts` 20 pass;C6 `src/main/automation-run-outcome.test.ts` 5 pass;C7 `src/main/engine-session-turn.test.ts` 2 pass、`src/main/moderation-automation.test.ts` 1 pass;C8 `src/shared/automation-schedule.test.ts` 20 pass;C9 `src/policy/authority-registry.test.ts` 5 pass。以上退出均为 0。schema、ext、ui-mac 三包分别 `bun typecheck`,均退出 0;`git diff --check` 退出 0。未受本轮影响的检查继承已接受的单元 1—4。
- 真实消息 JSON 随本轮同名沙箱用例重新导出,生产源码摘要已核对一致;没有手写协议输入。红例先提交 `177418ea5b`,修复提交不改该回归文件。文件均在原计划清单内,无上游文件或新 takeover。

本轮截至 14:11 UTC,约 19 分钟;完成第 2/3 项及第 4 项解释,第 1 项交编排器处理合同阻塞。


2026-11-14 · R6 owner 边界裁决及回执(基点 `6878b33344`,从 14:35 UTC 计时):

- 依据 owner 2026-11-14 所选选项原文「不算,发消息才算」,设计 §10 增补独立审查 finding、r4/r5 合同证据及裁决;§4.2、§5、§6 的对应表述与摘要明确区分 prompt 输入和会话内 shell 命令。prompt 仍在准备阶段退出名单;shell 不触发退出,其输出可进入仍按无人值守执行的回合。r5 的适配器机制已撤回,r4/r5 的阻塞按本轮裁决关闭。两处登记入口、T1/T2、其余威胁边界和已接受的第 2/3/4 项保持。
- C5 同一真实运行先暂停在工具内,再分别发送消息和 shell。用例明确命名为「AC-06 消息插话使在册运行退出名单,每次询问工具出卡」与「AC-06 shell 命令不接管在册运行,每次询问工具直接执行且零 Asked」。前者保留原审批事件、工具等待、人工批准后才执行的断言;后者按 owner 新边界重钉原 shell 红例,增加命令后 main 实际快照仍包含该会话、无审批事件/待批请求、真实 MCP 调用日志增加和运行状态 ok 的判据。生产代码未修改。
- `cd packages/ui-mac && bun test --timeout 90000 ./src/main/unattended-run.engine.cases.ts` → 16 pass / 0 fail,101 个断言,退出 0。C5 索引命令 `bun test --only-failures src/main/unattended-run.engine.test.ts` → 宿主 1 pass / 0 fail,退出 0。原 AC-01/02/07 三条红回归断言逐项比对未改。真实消息夹具的生产源码摘要仍一致,本轮无需重写 JSON。
- 本轮相关命令(沿用 C2—C9 的包工作目录,逐条 `bun test --only-failures <文件>`):C2 `src/main/codepuppy-sidecar-messages.test.ts` 10 pass、`src/main/codepuppy-unattended.test.ts` 4 pass;C3 `src/policy/unattended.test.ts` 4 pass;C4 `src/policy/unattended-policy.test.ts` 20 pass;C9 `src/policy/authority-registry.test.ts` 5 pass。以上均退出 0。schema、ext、ui-mac 三包各执行 `bun typecheck`,均退出 0。未受本轮影响的 C6—C8 等检查继承 r4 已接受回执;没有运行全量 gate/bin/check。
- 文档实际差异核对:owner 日期与引文按本轮原文记录;没有采用已撤回的 r5 写入口。`git diff --check` 退出 0。本轮除原清单内用例、plan 与新授权 design 外,仅多改 `docs/README.md` 中该 DESIGN 的一条生成索引摘要,机械同步实际变化的权威摘要;不改其他索引条目。这也是与其他文档更新线可能交叉的文件,合并时保留各自条目。
- 遗留去向:本轮无新增项;此前交编排器的既有意图项保持原去向。不新增通道、生产限制或接管。

本轮截至 14:41 UTC,约 6 分钟;本轮改动仅文档和真实引擎用例。

## batch F r3 — 接入已验收的单元 1–2(2026-11-14)

- 依据:r3 IMPLEMENT 组装派发;底座 `6b0c054e75` 已接受,指定输入 `feat/1699-unattended-run` @ `9dd7349975` 已审查。开始 15:03 UTC。只协调组合接缝,沿用 §10 的 owner 裁决,不重开 spec / design。
- 实际文本冲突只有 4 个文件:`packages/ext/src/plugin.ts` 保留 bootstrap 校验与全部既有钩子,只把 processState().hubBridge.unattended 交给 registerPolicy;`policy/display.ts`、`policy/index.ts` 合并两侧 import;`codepuppy-config-injection.ts` 同时保留 bootstrap 读取与 AUTOMATION_DEFAULTS。其它合并自动完成。语法树去注释比较确认两个自动化载体对象(含完整权限规则)与 `9dd7349975` 完全一致。#1713 移除的 managed plugin.use、allow-list 和宿主 allowance 没有恢复;#1700 七字段、R33 shell.create.before 输出保留。
- 消息分发逐项核对:`project-config-view` 由 sidecar.parseCommand → answerProjectConfigView 处理,`project-config-view-reply` 由 server 的 requester 先接收;`codepuppy.unattended.live` 由 ext hubBridge 独立安装,`codepuppy.unattended.ack` 经 main 封闭消息族 parser → hub-view.receive → acknowledge 处理。原 hub / reload 分支保留,attach / detach 同时接两套协调器。名单在 start 之后走消息,没有新增 launch 值。C2 的四个命令和 #1713 七文件组均通过。
- #1698 变量扫描:新增 `unattended-policy.test.ts` 曾写 CODEPUPPY_POLICY_ACCOUNT,导致策略读启动文档的 anonymous 分区、测试 store 读另一分区,C4 首次 15 pass / 5 fail。该输入改用已有 policy-host.cases.ts 的 publishPolicyAccount,测试 store 消费它的返回值;全部断言未改,C4 复核 20 pass / 0 fail。原清单 29 个 CODEPUPPY 键、两个 OPENCODE 引擎开关与退役常量别名的新增行扫描最终命中 **none**,原生产 AST 扫描也通过。
- 必要清单外协调:上述 C4 测试输入;同属 #1699 的 unattended-run.messages.fixture.json 用 C5 的真实捕获更新(8 场景 / 3 表单,字段形状无新增删除,生产摘要对应本次合并后的 gate/index/display);scripts/gate-files.tsv 补漏登的 unattended-run.engine.test.ts 宿主(自身实跑 1 条,子进程直接实跑 16 条);docs/README.md 由 canonical docs_index.py --write 重生成,新增计划索引行使旧名登记中既有仓库名词元由 11→12,按共享 hitTokens 实测同步。没有减少扫描面或放宽断言。
- 适配器生产文件、路由表与采样用例账目均无改动;后续若引擎身份要求重采,只用真实采样器更新样本,不增路由或事件。

### 本轮 C1–C9 回执

全部使用 Bun 1.4.4,从原命令索引指定包目录逐条前台串行运行,每条 exit 0(首轮 C4 的测试输入问题及登记补漏见上文):

| 索引 | 原索引命令的实际通过条数 |
| --- | --- |
| C1 | schema 2 pass / 0 fail。 |
| C2 | messages 10、main registry 4、hub-view 18、sidecar wiring 6 pass / 0 fail。 |
| C3 | hub-bridge 6、unattended state 4 pass / 0 fail。 |
| C4 | unattended-policy 20、register-policy 68、RPC 5、risk 22、inventory 5、ask-deadline 5、setup-order 1 pass / 0 fail。 |
| C5 | 原宿主命令 1 pass / 0 fail;另直接 `bun test --timeout 90000 ./src/main/unattended-run.engine.cases.ts`:16 pass / 0 fail、101 断言。消息插话退出、shell 命令不接管的两个真实用例均通过。 |
| C6 | outcome 5、elicitation 5 pass / 0 fail,实际捕获的结构化原因与投影断言一致。 |
| C7 | turn 2、moderation 1、注入 27、注入引擎 1 pass / 0 fail。 |
| C8 | schedule 20 pass / 0 fail。 |
| C9 | ext authority-registry 5 pass / 0 fail;K1 行与新增共享出处实际核对,原偏离保留。 |

### 组合验证(提交合并前)

- ui-mac 原派发 #1713 七文件命令:exit 0,11 pass / 0 fail,39 断言;含 custom-provider 5 条及 R33 宿主。没有宿主 allowance。
- ui-mac `bun test src/main/bootstrap-launch-parity.engine.test.ts src/main/codepuppy-bootstrap-build.test.ts src/main/sidecar-bootstrap-gate.test.ts src/main/bootstrap-env-readers.test.ts src/main/bootstrap-shell-env.engine.test.ts`:exit 0,25 pass / 0 fail;#1698 决定记录一字未改。util `bun test src/codepuppy-bootstrap.test.ts`:exit 0,16 pass / 0 fail。
- schema / core / ext / ui-mac 各自 `bun typecheck`:全部 exit 0。
- ui-mac `bun test src/main/gate-file-registry.test.ts src/main/old-name-scan.test.ts`:宿主补漏与索引词元计数同步后 exit 0,33 pass / 0 fail。

后续合并提交、适配器身份检查、生产构建与最终 HEAD 收据接在下方。

### 合并后最终复核

- 合并提交 `78bfbc4782`,父节点为已接受底座 `6b0c054e75` 与指定输入 `9dd7349975`。合并后适配器首次 201 pass / 1 fail,唯一失败是 17 份夹具的 schema 身份 `b1cacb270f → c24d8b246d`;core / plugin / util 身份不变。按身份测试提示只完整重采一次,exit 0,真实样本独立提交 `f566ed3dc6`。
- 重采逐份核对:路由用例键、所有字段形状、路由状态码与往返条数不变,无新增表项。差异为 ID / 时间 / 临时根 / 分页游标、OAuth PKCE 与 state、回环回调的随机端口(同一 /callback)、模型目录刷新(原生 models-dev 数据里的模型成员/参数,非转换器变化)、流式快照时序;parity 少一次 size/cursor 0 的早期轮询,后续输出保持。没有未解释的转换形状变化,未手改任何样本或身份。
- `cd packages/ui-mac && bun test src/engine-adapter/`:exit 0,202 pass / 0 fail、676 断言,31 文件;其中 turn-failure 宿主仍精确核对 9 pass / 0 fail。custom-provider 的 5 条已在 #1713 七文件组通过。重采 events 的 CLI 工作目录词元仍为原工作树 21 处,登记不需再改。
- 冻结输入核对:#1699 spec / design 与 `9dd7349975` 无差异;#1713 spec / design、bootstrap design / util schema、决定记录与 `6b0c054e75` 无差异。没有修改 adapter 生产文件、合同表或账目,没有新增 launch 环境通道、用户限制、配置或依赖。未运行 gate/bin/check,未启动安装应用或接触真实数据。
- 观察/遗留去向:`packages/ui-mac/src/main/unattended-run.engine.test.ts:21` 的既有宿主只断言子进程至少 3 条;本轮按派发直接验证实际 16/0,未在组装中改其已审断言。后续是否将计数钉为 16 交原票编排器,不影响本轮已实跑的 C5 结论。

- 最终构建:`cd packages/ui-mac && bun run build` exit 0,引擎 / ext / main / preload / renderer 产物已生成,未启动应用。最终重采与记录补齐后,ui-mac 两项登记命令复核 exit 0,33 pass / 0 fail;ext authority-registry 的 C9 为 5 pass / 0 fail。docs_index.py --check、416 个本轮变更文档相对链接与 git diff --check 通过。
- 已核:Codex(GPT-6),r3 IMPLEMENT 组装自检通过。依据版本为接受的 `6b0c054e75` 与 `9dd7349975`;AC-01–08 的 C1–C9 及两单元组合证据均通过,已审行为和 owner 的消息/shell 边界不重开。下一步交编排器独立审查及发布边界,未推送 / 开 PR。遗留去向仅上述 C5 计数观察交原票编排器;前两单元已登记的文档/环境问题沿原去向,本轮不扩查。无新增设计疑虑或限制提案。
- 本轮约 19 分钟(15:03–15:23 UTC),自身协调 4 个冲突文件与 6 个必要测试/样本/登记/文档文件;适配器真实重采 17 份产物另计。未安装依赖、未改冻结合同、未扩大到其它能力。


## batch F r4 — 吸收批次 E 最终修复及装配验证(2026-11-15 UTC)

- 依据:r4 IMPLEMENT 派发,从已接受的 `6e6c729830` 开始,03:25 UTC 计时。`git fetch origin` 后确认指定输入 `origin/batch/post-0-2-0-e` 为 `64a8355ee4`,合并提交 `7c8fcb5a3a`。仅 `engine-plugin-policy.engine.cases.ts` 与测试宿主 `codepuppy-engine.ts` 两处冲突:输入调整的是已由 #1713 明确删除的 managed deny-all / allowance,按原派发保留删除;其它 E 修复全部接入,没有恢复旧策略。
- 读取 gate 的 test stage 后,按 `origin/alpha...HEAD` 的触及包串行执行整包测试,未运行 gate/bin/check。consumer 使用 check:vendor 和地板 15,ext 地板 100,ui-mac 地板 3000;其余触及包为 schema/core/plugin/util/codepuppy-sdk-v1,另执行 gate 的 app 测试脚本。首次整包结果与后续复核续记下方。
- 三处装配修正:① `ext-project-adopt.test.ts` 的 #356 顺序锚同步 #1713 现有 rows 早退,不改顺序断言;② `permission-mount-ratchet.test.ts` 的生产扫描排除真实引擎宿主命名 `*.cases.*`,新增用真实 #1699 宿主源码生成的生产文件对照,证明生产同内容仍受扫描,先红提交 `ff5b92a2f4` 为 6 pass / 2 fail,修后 8 pass / 0 fail;③ ext `cloud-websearch-kill.test.ts` 的跨 Location 宿主补齐 #1699 所读 `agent.get` 的真实空权限返回形状,原断言不改,30 pass / 0 fail。前者单文件 9 pass / 0 fail。三处均为派发允许的组合破坏接缝,无生产行为或冻结合同变化。
- 登记验证:94 个变更文件对应行逐条使用仓库 `bun-test-floor.sh` 的 CODEPUPPY_TEST_COUNT_FILE 测量路径,92 行通过;两行属已放行网络失败(net-failure-real-stack / schema codepuppy-net-failure),保留原期望值。唯一计数变化由计数器实测为审批扫描 7→8,按测量结果机械写回,没有手写计数或放宽地板。E 的 consumer contracts 行实测仍为 27。
- 初次整包另外发现 core 15 条失败,逐文件在本树和只读基线 `alpha-code-probe-alpha-base` 单跑同红:tool-shell 56 pass / 11 skip / 3 fail、permission 114 pass / 8 fail、command-subagent 1 pass / 3 fail、compound-parity 576 pass / 1 fail。前 11 条要求 always 持久化,与已冻结会话内存授权相反;3 条要求子任务覆盖父模型,与 #1560 相反;最后 1 条为系统 /bin/bash 不支持样本语法。没有改未接管的上游测试或反改冻结生产语义,处置已向编排器提问,独立工作继续。

### r4 全量失败归因(首轮 22 条,逐测试列示)

本树的完整日志位于 `/tmp/batch-f-r4-*-wide.log`,单跑对照位于 `/tmp/batch-f-r4-alone-{1..5}-{here,base}.log`;本树源基点为 `7c8fcb5a3a`,基线只读 HEAD 为 `3a8e25d6b8`。网络失败只使用派发已有处置,未新增忽略清单。

| 包 / 文件 | 首轮失败显示名 | 类别 | 原因、修复或单跑结果 |
| --- | --- | --- | --- |
| ui / `src/main/ext-project-adopt.test.ts` | #356 wiring:触发面在 trust-check 两个早退之前(源文本合同) > ANCHOR (not a gate): adoption 调用位置先于「无 executable 早退」与「已有决策早退」 | a | #1713 后旧字符串锚失效;9acc2ab81f 同步当前早退,单文件 9/0。 |
| ui / `src/main/net-failure-real-stack.test.ts` | `#1572` AC4 真栈:Electron 内嵌 node + 真出网代理 + 真 webfetch ⇒ 持久化的工具记录带层 > 六个 webfetch 都经出网代理失败,并作为工具记录落库 | b | 派发已放行的网络/DNS 失败,不修改。 |
| ui / `src/main/net-failure-real-stack.test.ts` | `#1572` AC4 真栈:Electron 内嵌 node + 真出网代理 + 真 webfetch ⇒ 持久化的工具记录带层 > 持久化记录的 metadata.codepuppyNetFailure:policy / dns / tcp / tcp / tls-silent | b | 派发已放行的网络/DNS 失败,不修改。 |
| ui / `src/main/network-egress-proxy.test.ts` | 其它失败形态各自可辨,且都不转发 > 登记了但解析不了(.invalid)⇒ 503 dial-failed ENOTFOUND:DNS 在代理进程里发生,失败也在这里可读 | b | 派发已放行的网络/DNS 失败,不修改。 |
| ui / `src/renderer/codepuppy-ui/permission-mount-ratchet.test.ts` | 审批决定提交入口:单一引用面白名单棘轮(#619 R3 Blocker-2) > permission 决定提交入口(reply/respond,含方括号等义形态)只出现在白名单接线点 | a | 真实引擎测试宿主误入生产扫描;ff5b92a2f4 先红,9acc2ab81f 修正扫描范围并保留生产对照,单文件 8/0。 |
| ext / `src/cloud-websearch-kill.test.ts` | 跨 Location 隔离:治理归属按 setup 闭包,不串扰(#223 R7 Blocker) > B 记录一个 foreign `cloud_web` 后,A 的 cloud_web_search 仍按治理云工具判;反向同理 | c→a | 本树单跑 29/1、基线 30/0;测试宿主缺 agent.get 返回形状,9acc2ab81f 补齐,单文件 30/0。 |
| schema / `test/codepuppy-net-failure.test.ts` | AC3 映射表:经出网代理 / 其它路径两列 > Proxy response (503) 与 ENOTFOUND / EAI_AGAIN / EAI_NONAME ⇒ dns(两列相同) | b | 派发已放行的网络/DNS 失败,不修改。 |
| core / `test/tool-shell.test.ts` | ShellTool scanner permissions > declarations reuse approvals while substitutions retain reject/once/always behavior | c | 本树与基线单跑均 56 pass / 11 skip / 3 fail;未改冻结行为或未接管上游测试,待编排器处置。 |
| core / `test/tool-shell.test.ts` | ShellTool conditional process substitution > conditional substitutions respect once | c | 本树与基线单跑均 56 pass / 11 skip / 3 fail;未改冻结行为或未接管上游测试,待编排器处置。 |
| core / `test/tool-shell.test.ts` | ShellTool conditional process substitution > conditional substitutions respect always | c | 本树与基线单跑均 56 pass / 11 skip / 3 fail;未改冻结行为或未接管上游测试,待编排器处置。 |
| core / `test/permission.test.ts` | Permission > stores and removes saved resources for a project | c | 本树与基线单跑均 114 pass / 8 fail;未改冻结行为或未接管上游测试,待编排器处置。 |
| core / `test/permission.test.ts` | shell scanner permission impact > numeric npm script prefix: always allow covers repeat execution and narrows prefix scope | c | 本树与基线单跑均 114 pass / 8 fail;未改冻结行为或未接管上游测试,待编排器处置。 |
| core / `test/permission.test.ts` | shell scanner permission impact > numeric AWS option prefix: always allow covers repeat execution and narrows prefix scope | c | 本树与基线单跑均 114 pass / 8 fail;未改冻结行为或未接管上游测试,待编排器处置。 |
| core / `test/permission.test.ts` | shell scanner permission impact > substitution prefix: always allow covers repeat execution and narrows prefix scope | c | 本树与基线单跑均 114 pass / 8 fail;未改冻结行为或未接管上游测试,待编排器处置。 |
| core / `test/permission.test.ts` | shell scanner permission impact > redirect prefix: always allow covers repeat execution and narrows prefix scope | c | 本树与基线单跑均 114 pass / 8 fail;未改冻结行为或未接管上游测试,待编排器处置。 |
| core / `test/permission.test.ts` | shell scanner permission impact > assignment redirect prefix: always allow covers repeat execution and narrows prefix scope | c | 本树与基线单跑均 114 pass / 8 fail;未改冻结行为或未接管上游测试,待编排器处置。 |
| core / `test/permission.test.ts` | shell scanner permission impact > PowerShell method prefix: always allow covers repeat execution and narrows prefix scope | c | 本树与基线单跑均 114 pass / 8 fail;未改冻结行为或未接管上游测试,待编排器处置。 |
| core / `test/permission.test.ts` | shell scanner permission impact > PowerShell tab prefix: always allow covers repeat execution and narrows prefix scope | c | 本树与基线单跑均 114 pass / 8 fail;未改冻结行为或未接管上游测试,待编排器处置。 |
| core / `test/config/command-subagent.test.ts` | command subagents > runs native JSON in the background without switching the parent | c | 本树与基线单跑均 1 pass / 3 fail;未改冻结行为或未接管上游测试,待编排器处置。 |
| core / `test/config/command-subagent.test.ts` | command subagents > runs subagent mode by default in the background without switching the parent | c | 本树与基线单跑均 1 pass / 3 fail;未改冻结行为或未接管上游测试,待编排器处置。 |
| core / `test/config/command-subagent.test.ts` | command subagents > subagent: false overrides subagent mode and the legacy alias | c | 本树与基线单跑均 1 pass / 3 fail;未改冻结行为或未接管上游测试,待编排器处置。 |
| core / `test/shell-scan/compound-parity.test.ts` | real-shell compound syntax > bash: printf '%s' "$(probe() case value in value) scan_probe;; *) scan_other;; esac; probe)" | c | 本树与基线单跑均 576 pass / 1 fail;未改冻结行为或未接管上游测试,待编排器处置。 |

### r4 整包最终结果与报告修复

所有命令串行、Bun 1.4.4;整包输出保存在 `/tmp/batch-f-r4-<包>-wide.log`,ext 与 ui-mac 修复后输出另为 `*-final.log`。表中为末次完整包运行,没有用单文件通过冒充整包全绿。

| 包 | gate 实际命令 / 对触及包使用的命令 | 最后整包 pass / skip / fail | 退出 / 处置 |
| --- | --- | --- | --- |
| codepuppy-contracts-consumer | `bun run --cwd packages/codepuppy-contracts-consumer check:vendor`;`bash scripts/bun-test-floor.sh 15 packages/codepuppy-contracts-consumer` | 65 / 0 / 0 | 均 exit 0;vendor 字节与 pin 一致,远端 provenance 未提供暂存源的既有提示不冒充已核。 |
| ext | `bash scripts/bun-test-floor.sh 100 packages/ext` | 585 / 0 / 0 | 修复后 exit 0,地板通过;首轮 584/1。 |
| ui-mac | gate 等价内层 `cd packages/ui-mac && bun test --timeout 120000 --reporter=junit --reporter-outfile=/tmp/batch-f-r4-ui-final.xml src` | 6653 / 1 / 3 | 修复锚与扫描后完整运行 1057.30s,exit 1,3 条均为 b;pass 高于地板 3000。首轮原 gate 包装命令为 6650/1/5。报告标题问题及后续单文件复核见下。 |
| schema | `cd packages/schema && bun test --timeout 120000` | 119 / 0 / 1 | exit 1,唯一 DNS 用例为 b。 |
| core | `cd packages/core && bun run test --timeout=120000` | 7339 / 37 / 15 | exit 1;全部 15 条在两树单跑同红,四文件结果见上表,处置待编排器。 |
| plugin | `cd packages/plugin && bun test --timeout 120000` | 39 / 0 / 0 | exit 0。 |
| util | `cd packages/util && bun test --timeout 120000 --preload ../../scripts/test-isolation/preload.ts` | 156 / 0 / 0 | exit 0。 |
| codepuppy-sdk-v1 | `cd packages/codepuppy-sdk-v1 && bun test --timeout 120000 --preload ../../scripts/test-isolation/preload.ts` | 2 / 0 / 0 | exit 0。 |
| app(gate 另行执行) | `bash scripts/bun-test-app.sh` | 725 / 0 / 0 | exit 0,地板 600;另行点名的 9 个补丁文件精确 72 条也全部通过。 |

- 额外 a 类测量失败:首轮 gate 判官报 JUnit 非法 UTF-8,修复锚与扫描后的整包保留原报告,定位到 `PermissionDialog.test.ts:1151` 同一参数化标题的四个用例,原始 XML 第 8729–8732 行。`$name` 后含多字节中文的第二个 `$text` 插值让 Bun 1.4.4 输出坏字节;本树单文件 76/0 但 XML 解析失败,基线单文件 65/0 且 XML 有效。仅去掉第二个标题插值,没有改输入、产品文案或任何行为断言。修后同文件 76/0,真实 JUnit 严格解析出 76 个 testcase,原 known-fails-compare.py exit 0。完整原报告的坏字节均在这四个标题,诊断未见其它 XML 语法问题;没有改解析器、静默清洗报告或追加忽略项。整包计数保持上述实测值,标题修复后按派发仅复跑该文件。

- 收尾检查:`cd packages/ui-mac && bun test src/main/gate-file-registry.test.ts src/main/old-name-scan.test.ts` → 33 pass / 0 fail、exit 0;ext 整包包含 authority-registry 的全部既有判据并通过。docs_index.py --write 后索引没有文本差异,--check exit 0;git diff --check exit 0。
- 已核:Codex(GPT-6),核对 r4 指定输入 `64a8355ee4` 与本轮两个测试修复提交。已知装配失败均已修复;整体回执为 PARTIAL,core 15 条双树同红的冻结语义/未接管上游测试冲突仍待编排器明确处置,不将它们改成放行项,也不把整包失败报为全绿。网络项沿派发 b 类原处置,不新增待办机制。
- 已定勿重开:#1713 的策略删除、#1699 的已审权限与消息/shell 边界、#1698 的启动文档/R33、#1700 的字段和适配器合同均不改。没有新增生产限制、启动值、依赖、takeover 或协议转换。下一步:编排器处置 core 四个文件的 15 条基线失败后再决定 full gate。本轮没有 push/PR,没有运行 gate/bin/check。
- 偏离与范围:冲突外必要测试文件为 ext-project-adopt(旧锚)、permission-mount-ratchet(真实测试宿主扫描范围及回归)、cloud-websearch-kill(缺 stub)、PermissionDialog(JUnit 标题编码);均由本轮装配验证直接证明,理由与结果见上。登记只同步计数器测得的 1 行;业务回执只续记本 plan,索引由 generator 检查。本轮约 65 分钟(03:25–04:30 UTC),含 ui-mac 两轮完整运行约 34.6 分钟,没有扩大到 core 冻结行为或上游测试接管。无新增 OPTIONAL 或设计限制提案。
