---
id: PLAN-project-agent-fields
title: 项目里给助手写的开关、工具与温度设置都生效 实施计划
summary: alpha-code#1700 一段 —— 项目助手的 disable、temperature、top_p、steps(maxSteps)、hidden、color、variant 在 OpenCode 2 上生效,用不上的字段记一行日志,写坏的条目整条不装(tools 已由 #1693 交付)
kind: plan
status: active
spec: SPEC-project-agent-fields
design: ""
owners: [owner]
last_reviewed: 2026-11-12
---

# PLAN-project-agent-fields｜项目里给助手写的开关、工具与温度设置都生效 实施计划

## 其余字段与温度(alpha-code#1700)

- 依据:[SPEC-project-agent-fields](spec.md) v1(owner 2026-11-12 批准),AC-04 至 AC-10、BR-02 至 BR-06;AC-01 至 AC-03(`tools`)已由 alpha-code#1693 交付,本段不动。无 design;上游对照:`packages/core/src/v1/config/agent.ts`(v1 agent schema 与 `normalize`)、`packages/core/src/v1/config/migrate.ts` `migrateAgent` / `modelSelection`、`packages/core/src/config/plugin/agent.ts`(引擎把配置 agent 写进编辑器的做法)@ c01ea14919。Issue alpha-code#1700。
- 核对:0d215b6b7d · 编排器按派发书与实施结果一并核对(派发书:计划无待决则同一次运行直接实施)· 待核。

### 改动
| 文件 | 改什么 |
| --- | --- |
| `packages/ext/src/engine-transforms.ts` | `applyAgents` 照 `migrateAgent` + 引擎 agent 插件补齐字段:`disable: true` ⇒ `editor.remove`(其余字段不写);`steps ?? maxSteps` ⇒ `steps`;`hidden`;`color`(`#` 开头原样,主题名 ⇒ `#aaaaaa`);`variant` 只随合法 `model` 进 `model.variant`;`temperature` / `top_p` 写进 `agent.request.body`(引擎自己读 v1 agent 时放的同一位置)。`modelRef` 改用上游 `modelSelection` 的同一判据(含 `#` 的不收)。`malformedRules` 扩到上游 v1 agent schema 的全部字段(类型、`mode` 枚举、`color` 形状、正整数 `steps` / `maxSteps`、`options` 为对象……)。新增参数 `log`:每个未应用的字段(规格之外、上游也不认识的键,及 `options` / `name`)一行;写坏的条目一行。返回值加上被停用的 id。新增导出的纯函数:由 agent 的 `request.body` 与模型是否支持温度算出这一轮的 `temperature` / `topP`(不支持温度 ⇒ 不带温度,`topP` 照带,同 1.x `session/llm/request.ts`)。 |
| `packages/ext/src/model-facts.ts` | `ModelFacts` 加 `temperature`(引擎目录里的 `capabilities.temperature`;查不到 = 缺席)。同一调用链,`context` 钩子据此判模型是否支持温度。 |
| `packages/ext/src/plugin.ts` | ①agent transform 调用处传 `log`、记下被停用的 id;②既有的请求组装回调(`assembleRequest`)在带 agent 的请求上(context / compaction / generate;起标题的没有 agent)按该 agent(`context.agent.get`)的 `request.body` 设 `options.temperature` / `options.topP` —— 项目与全局来源都走这一处,因为引擎读全局 v1 agent 时也写在 `request.body`;③既有 `tool execute.before`:`subagent` 指向本项目停用的助手 ⇒ 抛一句「该助手在本项目已停用」(否则引擎只说 `Unknown agent`,AC-04 要求说明已停用)。不改其余结构。 |
| `packages/ext/src/project-config.ts` | 不改。新字段都不改权限或模型:`variant` 只随 `model` 生效(`model` 已在同意门内),`steps` / `hidden` / `color` / `temperature` / `top_p` 与恒加载的 `prompt` 同类。 |
| `packages/ext/src/engine-transforms.test.ts` | 与上游 `ConfigNormalize.normalize` 逐字段对比:disable、steps / maxSteps、hidden、color(hex 与主题名)、variant(有 / 无 model、含 `#`)、temperature / top_p 的 `request.body`;写坏样本(每个字段)上游给 invalid 诊断、ext 整条不装、其余照常;未知字段一行日志;温度纯函数两臂。 |
| `packages/ext/src/plugin-host.test.ts` | 真宿主:AC-04(已同意项目 `disable: true` ⇒ 引擎 agent 表里没有它、真 subagent 派发被拒且说明已停用;反向臂未同意 ⇒ 仍在);AC-05 / AC-06(真 `context` 钩子:项目 agent 与经引擎自己的 v1 迁移注册的全局 agent 都带上 0.2 / 0.9;不支持温度的模型不带温度;反向臂不装 ext ⇒ 都不带);AC-07 / AC-08(引擎 agent 表里 `steps: 3`、`hidden`、`color`、`model.variant`);AC-10(`mode` / `model` 写坏 + 放宽的 `permission` ⇒ 整条不装,内置规则不变,另一个助手照常)。 |
| `packages/ext/src/upstream-probes/engine.cases.ts` | 模型代理记下每个发往模型的请求体(只加记账,不改既有行为);模型 `m` 声明支持温度。 |
| `packages/ext/src/upstream-probes/agent-request.test.ts` | 新探针(真引擎、真 HTTP):全局 v1 agent 写 `temperature: 0.2, top_p: 0.9`、模型支持温度 ⇒ 引擎把它们存在 agent 的 `request.body`,发出的请求里没有(证明盘点的推断);对照臂:插件在 `context` 钩子设 `options.temperature / topP` ⇒ 发出的请求里有(ext 用的接缝真的到达线上,也是检查器能红的已知坏样本)。 |
| `scripts/gate-files.tsv` | engine-transforms / plugin-host 精确条数改为实测;登记新探针文件。 |

### 顺序
1. 本计划单独提交。
2. 先跑探针(`upstream-probes/agent-request.test.ts` + `engine.cases.ts` 记账)证明引擎不发助手级温度;若实测引擎已经发了,不加第二条路径,停在这里回报。
3. `engine-transforms.ts` 字段映射、整条校验、日志、温度纯函数 + `engine-transforms.test.ts`;跑 engine-transforms 与 project-config 测试。
4. `model-facts.ts` + `plugin.ts` 三处 + `plugin-host.test.ts`;跑 plugin-host、engine-transforms、探针。
5. `gate-files.tsv` 条数写回实测(随所在提交)。

### 风险
- 温度只在模型目录明确 `capabilities.temperature === true` 时发(1.x 同为真值判断);平台节点的模型目录不写这一能力,平台模型上助手温度因此不发 —— 与 1.x 一致,作为观察回报,不在本票扩。
- `context.agent.get` 在每轮请求组装里多一次进程内调用;失败只记日志,不影响请求。
- `modelRef` 收紧到上游判据(含 `#` 的 model 不再装),与引擎读同一份文档一致;比对测试钉住。

### 证明
| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-04 | plugin-host「项目 agent 的 disable」+ engine-transforms disable 对比 | 去掉 `remove` ⇒ agent 仍在表里、派发不被拒;去掉 execute.before 那句 ⇒ 错误文字只有 `Unknown agent` |
| AC-05 | plugin-host「助手温度」项目 / 全局两臂;探针对照臂 | 去掉钩子 ⇒ `options` 里没有 0.2 / 0.9(与反向臂同) |
| AC-06 | plugin-host 不支持温度的模型臂;温度纯函数单测 | 去掉能力判断 ⇒ 不支持的模型也带温度 |
| AC-07 | engine-transforms steps / maxSteps 对比 + plugin-host 引擎 agent 表 `steps: 3`;引擎按 steps 收尾由上游 `packages/core/test/session-runner.test.ts`(`agent.steps = 2` 各例)判 | 去掉映射 ⇒ `steps` 缺席,对比红 |
| AC-08 | engine-transforms hidden / color / variant 对比 + plugin-host 引擎 agent 表 | 去掉映射 ⇒ 对比红 |
| AC-09 | engine-transforms 未知字段日志用例(项目照常装) | 去掉日志 ⇒ 断言的那一行不在 |
| AC-10 | engine-transforms 写坏样本与上游诊断对比 + plugin-host `mode` / `model` 写坏 + 放宽 permission | 去掉整条校验 ⇒ 放宽的规则进了引擎,内置 deny 变 allow |
| BR-04 前提 | 探针 `agent-request.test.ts` | 引擎若开始发助手温度 ⇒ 前提臂红,提醒删掉 ext 这一路 |

### 偏离记录
- 2026-11-12 · 助手采样参数原计划另挂一个只在 `context` 上的钩子,改为写进四条请求钩子共用的 `assembleRequest`,在带 agent 的 context / compaction / generate 上都补 · `context-injection.test.ts` 钉住「`session.context` 上只有策略闸与 ext 的组装回调两个、组装回调四条共用」,另挂一个会破这条登记;1.x 的 `chat.params` 本来也在每次模型调用上带本次 agent 的温度 · 本提交。
