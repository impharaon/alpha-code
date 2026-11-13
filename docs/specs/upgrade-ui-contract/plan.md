---
id: PLAN-upgrade-ui-contract
title: 界面只认 Code Puppy 自己的数据约定(I-04)实施计划
summary: I-04 的十个交付切片:M1a 翻译器搬进 opencode2/;M1b 约定目录与管道分家(覆盖 a、完整 b);M2a 翻译器自有投影;M2b 约定类型落地(reply<K>);M3 回执账本归约定;M4 Code Puppy 界面只经约定(边界 f);M5a 夹具的引擎源码身份(e)与终端钉住;M5b 直通的消费字段(d);M5c / M5d 转换路由与事件的采样用例(c)
kind: plan
status: active
spec: ""
design: DESIGN-upgrade-ui-contract
owners: [alpha-code desktop maintainers]
last_reviewed: 2026-11-12
---

# PLAN-upgrade-ui-contract｜界面只认 Code Puppy 自己的数据约定 实施计划

由实施会话在计划阶段写,编排器核对后由同一会话实施。决定只链接、不重述:「设计 §x」「UC-nn」「R-nn」都指
[DESIGN-upgrade-ui-contract](design.md) @ `c304b93c11`(approved;Issue alpha-code#1697 引的 `c01ea14919` 上内容相同)。
代码坐标 A = `origin/alpha @ c01ea14919`;设计的坐标 E = `4198d1a484`。Issue 的 AC-01–AC-04 是设计条目的摘要,下文证明表按设计条目写,
并标出对应的 Issue AC。实施中偏离某一段,在同一个提交里改那一段。

## 共用

### 对账:设计冻结之后 alpha 上已经落地的

| 落地 | 提交 | 对本计划的影响 |
| --- | --- | --- |
| 换代合入 alpha(#1694) | `a7d71dd5a9` | 设计按 E 引用的事实在 A 上成立,只有下面几行的差别。M1 的开工依赖「#1662 已合入」成立 |
| `GET /api/model` 接上 | `a2067cfc14` | A 的路由表服务 88 条(E 87 + 这一条,转换路由 `toV1ModelList`,发出点 `renderer/codepuppy-ui/model-contract.ts:367`)。约定 `SERVED` 取 88 条,见「待核对 1」 |
| 覆盖扫描不依赖排版 | `6e7a7d670f` | A 的 `UNSUPPORTED` 22 条 = E 17 + 设计补的 `GET /api/event` + 4 条 v2 支路(`GET /api/permission/request`、`GET /api/question/request`、`GET /api/fs/list`、`GET /api/model/default`,`routes.ts:604-610`)。三种漏扫形式(设计 P-03)里,只有「绑定到构造函数的变量」靠接收者名表认出了一部分(`eventApi` ⇒ `GET /api/event`);构造链调用与字面量原始请求仍漏。本计划的探针(临时目录,bun 1.4.4,只读):A 上 `utils/server-health.ts`、`utils/server-protocol.ts` 扫出 `[]`,`renderer/sidebar/use-projects.ts:679` 的 `/global/health` 没有扫出 |
| I-05 切片 A(本次会话内允许进内核) | `f344a2bdb1` | P-06 第 1 条已完成(`permission-replies.ts` 已无 `allowForSession` / `releaseCovered` / `wildcardMatch` / `evaluateRules`,`always` 原样发);**R13 里 M3 的开工条件「I-05(a) 已落地」成立**;`permission-reply.json` 已按新语义重采 |
| I-05 切片 B(读目录卡由 ext 生成) | `7a9aef3036` | P-06 第 2 条已完成(`v1-shapes.ts` 不再反解正文,`metadata.display` 原样透传) |
| I-05 切片 C(失败码统一读法) | — | 适配器本来就经 `parseFailureCode` 读(`v1-shapes.ts:350-362`),C 只改 main;P-06 第 3 条没有剩余工作 |
| I-05 切片 E / E2 | `ad361e473d`、`20f340e1c0` | 只动 core / ext,与适配器无关 |
| #1692 任务清单读取 | `e0fbe50720` | `GET /session/:id/todo` 从最近一页往前翻(`routes.ts:346-357`),与 UC-18 一致;`todo-route.test.ts` 经 `createEngineFetch` 走真入口,作 UC-18 的「行为不变」证明。设计留档第 2 行(每次读整个会话)已解决 |
| #1691 问题定位 | `e0fbe50720` | `background-problem-watcher.tsx` 没有新增引擎调用;它是 M4 改 import 的 renderer 文件之一 |
| `as never` | — | A 上非测试源码 22 处(E 20),M2a 全部拿掉 |
| 登记册 | — | 除设计点名的 `adr033-decision-receipt`(M3),`l1r-review-turn-supply` 的机制文件也指向 `engine-adapter/v1-shapes.ts`;登记册测试会核机制文件在不在(`packages/ext/src/policy/authority-registry.test.ts:56`),M1a 搬家时两条一起改指 |
| 登记簿 | — | `scripts/gate-files.tsv` 第 1 列是**精确条数**;`scripts/old-name-exceptions.tsv` 与旧名命中必须互为子集(`src/main/old-name-scan.test.ts`)。各片按改动同步,新加的门文件(断言本模块之外的东西)都登记 |

### 切片、顺序与依赖

| 片 | 对应设计 §9 | 开工依赖 | 预估文件 / 实质行 |
| --- | --- | --- | --- |
| M1a 搬家 | M1 前半 | — | 24 / ~200(其中 ~70 行只是 import 路径;另有新工具 `replay.ts` ~130 行) |
| M1b 约定目录与管道 | M1 | M1a | 11 / ~650 |
| M2a 翻译器自有投影 | M2 前半 | M1b | 13 / ~700 |
| M2b 约定类型落地 | M2 后半 | M2a | 6 / ~450 |
| M3 回执账本归约定 | M3 | M2a;I-05(a) 已落地 | 19 / ~550(其中 6 个测试文件各改一行) |
| M4 界面只经约定 | M4 | M2a、M3 | 29 / ~250(26 个文件只改 import 行) |
| M5a 引擎身份与终端钉住 | M5 的 e | M1a | 8 + 12 个重采夹具 / ~350 |
| M5b 直通消费字段 | M5 的 d | M2b、M5a | 6 / ~450 |
| M5c 转换路由用例 | M5 的 c(路由) | M2a、M5a | 6 / ~700 |
| M5d 事件用例与手册 | M5 的 c(事件) | M5c | 6 / ~500 |

按表中顺序落地,每片一个独立可合并的提交组。M4 排在 M2a、M3 之后:f 的 `opencode2/` 规则(不引冻结界面、不引 `@opencode-ai/*`)要等 `frozen-shapes.ts` 删掉,
M3 又会改 `opencode2/` 里引 v1 类型的文件,M4 最后统一改指,避免同一行改两遍。M3 排在 M2a 之后(设计只要求 M1):`ApprovalEngine.current` 用的是自有的审批请求投影,不再经冻结函数。M1a、M1b、M3、M4 超过 15 个文件,多出来的都是只改一行 import 的测试或 renderer 文件。

### 每片共用的「行为不变」检查

- **B1 适配器套件**(真入口为主;逐个列文件,本机钩子不许按目录跑):
  `cd packages/ui-mac && bun test src/engine-adapter/command-reply.test.ts src/engine-adapter/event-projection.test.ts src/engine-adapter/failure-code.test.ts src/engine-adapter/file-watcher.test.ts src/engine-adapter/mcp-auth.test.ts src/engine-adapter/permission-reply.test.ts src/engine-adapter/permission-shape.test.ts src/engine-adapter/projection-parity.test.ts src/engine-adapter/request-abort.test.ts src/engine-adapter/routes-coverage.test.ts src/engine-adapter/staged-attachment.test.ts src/engine-adapter/todo-route.test.ts src/engine-adapter/tool-display.test.ts src/engine-adapter/tool-shapes.test.ts src/engine-adapter/turn-diffs.test.ts src/engine-adapter/unsupported.test.ts src/renderer/engine-connection.test.ts src/main/net-failure-real-stack.test.ts src/renderer/codepuppy-ui/permission-mount-ratchet.test.ts`
  (`projection-parity` 自 M2a 起有;以后新加的适配器测试文件补进这一行)。
  经 `createEngineFetch` 的有 `command-reply`、`mcp-auth`、`permission-reply`、`permission-shape`、`request-abort`、`todo-route`、`turn-diffs`、`unsupported`、`event-projection`(末条)与 `engine-connection`。
- **B2 类型**:`bun run --cwd packages/ui-mac typecheck`(`tsgo -b`;注意测试文件不在类型检查范围,`tsconfig.json` 的 `exclude`)。
- **B3 夹具差分**(设计 §4.10 c、§9「翻译器输出在 M1–M3 前后逐个相等」):`replay.ts`(M1a 新加,`packages/ui-mac/test-fixtures/engine-adapter-sampler/`,同采样器一样不进门)
  用每个夹具的 2.x 数据做一个假上游,经生产的 `createEngineFetch` 发冻结界面会发的 v1 请求 ——
  每个消息数组(`final`、`tools.json` 五个会话、`parity.json` 三个会话)的 `GET /session/:id/message`(全量与 `limit=2` 翻页)、逐条 `GET /session/:id/message/:messageID`、`GET /session/:id/todo`;
  `question.json` 的 `GET /question`;`permission-asked.json` 与 `permission-reply.json` 的 `GET /permission`;`command.json` 的 `POST /session/:id/command`;
  带 `diff` 的夹具挂上 `/api/session/:id/diff` —— 再把每个带 `records` 的夹具逐帧喂投影器(做法同 `event-projection.test.ts`),全部输出按键排序写成一份 JSON。
  每片先在本片基线跑出 before(存临时目录),改完再跑 after,`diff` 必须为空;只许出现本片证明表里点名的例外。
  前后两次只有「怎样建投影器」那几行可以不同(M1a 挪了它、M3 改了它的第三个参数),在同一个提交里改。
- **B4 真引擎宿主**(动到管道、provider 或 renderer 客户端的片):`cd packages/ui-mac && bun test src/renderer/extensions/use-extensions-recovery.test.ts src/main/codepuppy-reasoning-badge-parity.test.ts`
  (前者经 `createEngineFetch` 连沙箱里的嵌入式 OpenCode 2,后者经适配器读 `GET /provider` 与 `GET /api/model`)。
- **登记同步**:改了登记册 ⇒ `cd packages/ext && bun test src/policy/authority-registry.test.ts`;改了旧名登记 ⇒ `cd packages/ui-mac && bun test src/main/old-name-scan.test.ts`;
  登记过的测试文件条数变了 ⇒ 单跑该文件核对条数并改 `gate-files.tsv`。
- **冻结树零字节**(设计 §9 A7):`git diff --stat <片基线> -- packages/codepuppy-app packages/codepuppy-ui packages/codepuppy-session-ui packages/codepuppy-sdk-v1 packages/codepuppy-core-util` 为空。

### 编排器裁决(2026-11-12,核对 `b2da433c56` 时)

1. 目录基数取 A 的表(88 服务、22 不支持),依据 AC-03;设计里过时的 87 / 18 记入 M1b 偏离记录,编排器在设计 §10 留注。
2. §4.5 代码块与 R4 冲突时以 §10 的 R4 为准:三种事件按引用取 1.17.13 的类型,在 M2b 依赖到位后改(M1b 先按 §4.5 自声明)。
3. f 只扫非测试源码:认可。
4. `bun.lock`:M2b 加依赖时只提交这条依赖在 ui-mac 段加的那几行,不带 setup 的版本漂移;提交前在回报里给出 `git diff --stat` 与那一段。

下面是核对前的原文。

这些不是本计划替设计做的决定,而是计划所依据的读法;核对时任何一条不认,只影响点名的那一片。

1. **目录基数**:设计 R1 / R9 写的是 E 上的 87 服务 / 18 不支持。A 上分别是 88 / 22(差别见对账表)。计划按 Issue AC-03「现有界面行为与换代后主线逐项一致」
   与 R1「服务的成员就是今天的路由表」取 A 的表:去掉 `GET /api/model` 会让 composer 的模型链一直 recovering;多出的 4 条不支持今天本来就是表外 501,登记进约定不改变运行时。
2. **三种事件的载荷类型**:设计 §4.5 代码块把 `session.usage.updated`、`mcp.status.changed`、`mcp.resources.changed` 写成规则 2 的自声明,
   而 §4.3 规则 1 与 R4 说 1.17.13 客户端已声明的形状按引用取(P-05 记了它声明这三种)。计划照 §4.5 代码块实现(冻结的可执行形状,运行时无差别);
   若按 R4 改为引用,M2b 依赖到位后改三行。`mcp.prompts.changed` 两个客户端都没声明,按规则 2 自声明(今天它经 `mcp.*` 前缀直通发出,§4.5 要求逐个列名)。
3. **f 的扫描范围**:§4.2 表写 `ui-mac/src/renderer/**`。计划只扫非测试源码,排除规则与 a 扫描同一条正则(`routes-coverage.test.ts:155`),
   与 P-05 的计数口径(「ui-mac 非测试文件」)一致;测试与测试宿主(含把 `@opencode-ai/sdk` 全前缀 alias 到录音替身的那几个)照旧直接引 SDK。
4. **1.17.13 包的仅类型依赖提前到 M2b**:设计 §9 把它写在 M5,但 M2b 的 `reply<K>` 已经要引 1.17.13 的类型(例 `GET /api/project/current` 的 `ProjectCurrentOutput`),只能提前。
   这条依赖要在 `bun.lock` 的 ui-mac 工作区块里加一行;派发书写「bun.lock 不提交」。建议放行这一行:基于 HEAD 的 `bun.lock` 只加这一行(不带 setup 产生的 libc 字段漂移)。
   不放行时 M2b 只能对 v1 SDK 发出的路由用 `reply<K>`,只由 1.17.13 发出的那几条转换路由(如 `GET /api/project/current`)留到依赖到位。

## M1a — 翻译器搬进 `opencode2/`(纯搬家)

- 依据:设计 §4.2 模块与依赖方向、§6 第 3 行、§9 M1「翻译器挪进 `opencode2/`」;Issue AC-03。
- 核对:`b2da433c56` · 编排器(Claude Fable 5.2)· 通过(十片拆分、仅类型依赖提前到 M2b、M3 排在 M2a 之后均认可;四条读法的裁决见「编排器裁决」)

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/src/engine-adapter/{routes,events,v1-shapes,session-cache,permission-replies}.ts` | `git mv` 到 `engine-adapter/opencode2/` 同名文件;内部相对 import 多一层(`../../../ext/…`、`../shared/…`、`./frozen-shapes` → `../frozen-shapes`),内容不动 |
| `engine-adapter/frozen-shapes.ts` | 不动(M2a 删除;不随搬,省一次旧名登记改动) |
| `engine-adapter/index.ts` | import 改指 `./opencode2/…` |
| `engine-adapter/` 下 11 个测试文件(`command-reply`、`event-projection`、`failure-code`、`file-watcher`、`permission-reply`、`permission-shape`、`routes-coverage`、`staged-attachment`、`tool-display`、`tool-shapes`、`turn-diffs`) | 只改 import 路径;测试文件留在原处,`gate-files.tsv` 的登记路径不变 |
| `src/main/net-failure-real-stack.test.ts` | `toV1Messages` 的 import 路径 |
| `test-fixtures/engine-adapter-sampler/sample.ts` | `requestFingerprint` 的 import 路径 |
| `test-fixtures/engine-adapter-sampler/replay.ts`(新) | B3 的夹具差分工具;职责与覆盖面见「共用 B3」 |
| `test-fixtures/engine-adapter-sampler/README.md` | 加一节 replay 的用法与「前后差分」做法 |
| `docs/architecture/codepuppy-authority-registry.json` | `adr033-decision-receipt` 与 `l1r-review-turn-supply` 的 `mechanism.file` 改指 `opencode2/` 下的新路径 |
| `src/renderer/codepuppy-ui/permission-mount-ratchet.test.ts` | 审批提交入口白名单按文件登记,`permission-replies.ts` 那一条改指新路径(偏离记录) |
| `packages/ext/src/upstream-probes/turn.test.ts` | `toV1Messages` 的 import 路径(偏离记录) |

### 顺序

1. 提交一:`replay.ts` + README 一节。在 A 上跑 `bun packages/ui-mac/test-fixtures/engine-adapter-sampler/replay.ts`,输出存为 before。
2. 提交二:搬家、改 import、登记册改指。跑 B1、B2、登记册测试、B3(after 与 before 比),`bun build --target=bun` 核 `sample.ts` 的 import 能解析(采样器不在类型检查里)。

### 风险

- 搬错一处相对路径只在运行时暴露(测试文件不过类型检查):B1 覆盖每个改过 import 的测试文件。
- 用 `git mv` 保住改名检测,审查只看到路径变化。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| §9 M1 搬家,AC-03 | B1 全绿;B3 差分为空 | import 指错 ⇒ 模块解析失败,对应测试文件红;搬家时改动了投影 ⇒ B3 非空 |
| 登记册在位 | `authority-registry.test.ts` | 机制文件不改指 ⇒ 报 `mechanism file missing` |
| A7 冻结树零字节 | 共用的 `git diff --stat` 为空 | — |

### 偏离记录

- 2026-11-12 · 多改两个文件:`permission-mount-ratchet.test.ts` 的审批提交入口白名单按文件路径登记 `permission-replies.ts`(不改指则该棘轮把搬走后的文件判为未登记的提交方);ext 的 I-03 探针 `upstream-probes/turn.test.ts` 直接 import `v1-shapes.ts`。计划阶段只搜了 ui-mac 内的引用,漏了这两处。两处都只改路径;探针测试名里写的依赖文件路径是给人看的标签,未改,记为观察 · M1a 搬家提交。

## M1b — 约定目录与管道分家

- 依据:设计 §4.1、§4.2、§4.4、§4.5、§4.6、§4.8(`Translator`、不支持 18 条的分组、探活回退)、§4.10 a / b、§9 M1、R1、R5、R8、R9、R15;UC-02、UC-03、UC-04、UC-14、UC-19;Issue AC-01、AC-03、AC-04。
- 核对:`b2da433c56` · 编排器(Claude Fable 5.2)· 通过(十片拆分、仅类型依赖提前到 M2b、M3 排在 M2a 之后均认可;四条读法的裁决见「编排器裁决」)

### 改动

| 文件 | 改什么 |
| --- | --- |
| `engine-adapter/contract/routes.ts`(新) | 路由目录:`SERVED` 88 键(A 的路由表逐条,本片目录项的响应 / 请求体类型先放 `unknown`,M2b 按规则 1、2 填);`FIXED` 3 条(答复照 A `routes.ts:212-213,488`);`UNSUPPORTED` 22 条(理由从 A `routes.ts:586-611` 原样搬);`PROBE_FALLBACK` 1 条;`RouteKey` / `ServedKey` / `TranslatedKey`;按模板匹配(沿用 A `index.ts:28-57` 的匹配法) |
| `contract/events.ts`(新) | `ContractFrame` / `ContractEvent` / `ContractEventMap`:33 种 = A `events.ts` 今天发出的全部类型(直通 9、`mcp.*` 四种、改名与派生 20);载荷按 §4.3 规则 1 引用 v1 SDK 的 `Event*`,四种自声明见「待核对 2」 |
| `contract/errors.ts`(新) | `ContractError` 与出信封的函数;不支持(501 + `console.error`)与探活回退(501,不记日志)两个出口 |
| `contract/translator.ts`(新) | `Translator<Engine>`、`RouteContext<K>`;`receipts` 随 M3、`reply` 随 M2b 加入 |
| `engine-adapter/index.ts` | 管道:只按约定目录匹配;`FIXED` 由约定侧直答、不建引擎客户端;`PROBE_FALLBACK` 回 501 信封、不记日志;其余表外 501 + `console.error`;翻译路由交给翻译器按键取出的处理函数(传入 `context` 与 `engine`);错误经 `toContractError`;取消照旧以取消原因拒绝。对外导出名不变 |
| `opencode2/index.ts`(新) | 当前代翻译器:`connect`(每请求一个 2.x 客户端,取消信号合并,照 A `index.ts:93-98`)、`routes`、`toContractError`(照 A `index.ts:77-82`)。A 里按引擎源记的审批回复状态在 M3 前留在翻译器实例里;管道每次 `createEngineFetch` 建一个实例,测试之间不串状态,与 A 相同 |
| `opencode2/routes.ts` | `ROUTES` 数组改成按 `TranslatedKey` 索引的处理函数表(b);`api` / `upstream` / `passthrough` / 审批状态改从 `engine` 取;删掉已搬进约定的 `UNSUPPORTED` 与 3 条固定答复 |
| `opencode2/events.ts` | `emit` 按 `ContractEvent` 定型;`mcp.*` 前缀直通改为逐个列名(2.x schema 只定义 `mcp.status.changed`、`mcp.resources.changed`、`mcp.tools.changed`、`mcp.prompts.changed`,运行时不变)。定型暴露的只能是纯类型问题(例 `question.replied` 的 `sessionID` 可能为 `undefined`),只做不改行为的类型收窄,不用 `as never` |
| `engine-adapter/routes-coverage.test.ts` | 改按约定三张表判;扫描补三种形式(§4.10 a);renderer 规则;两条已知坏例;真树断言 |
| `engine-adapter/unsupported.test.ts` | 加探活回退与固定答复的用例 |
| `scripts/gate-files.tsv` | `routes-coverage.test.ts` 的条数 4 → 实测 |

### 顺序

1. 提交一:`contract/` 四个文件 + `routes-coverage.test.ts` 改目标(此时管道未改,先让 a 在新目录上红绿正确:新形式在 A 的扫描上红,补扫描后绿)。
2. 提交二:管道与 `opencode2/index.ts`、`routes.ts`、`events.ts`;`unsupported.test.ts` 新用例先在提交一的代码上红(探活回退记了 `console.error`)再绿。跑 B1、B2、B3、B4、`gate-files.tsv` 条数。

### 风险

- `routes.ts` 改成按键索引是大段机械改写:靠 b 的映射类型(漏一条、多一条都编译不过)与 B3 差分兜住。
- 事件定型可能暴露真实的形状差异:按设计 §5 末条处理(真差异按当前正式版修,点名列出),不在本片顺手改行为。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| a 三种漏扫形式,AC-04 | `routes-coverage.test.ts` 新用例「构造链 / 绑定到四个构造函数的任意变量 / 字面量路径的原始请求都扫出」:已知坏例 ① `OpenCode.make({\n  baseUrl,\n}).health.get()` ⇒ `GET /api/health`;`const anyName = createSdkForServer(…)` 后 `anyName.global.health()` ⇒ `GET /global/health`;`probe(server, fetch, "/global/health")` 与 `fetch(new URL("/global/health", base))` ⇒ `GET /global/health` | A 的扫描对这几段返回 `[]`(对账表的探针),断言红 |
| a 真树 | 同文件「真树扫出 `server-health.ts` 的 `GET /api/health`、`server-protocol.ts` 的两条、`use-projects.ts:679` 的 `GET /global/health`,并全部被三张表覆盖」 | 扫描退化 ⇒ 调用点缺失 ⇒ 红;`PROBE_FALLBACK` 没登记 ⇒ `GET /api/health` 未覆盖 ⇒ 红 |
| a renderer 规则 | 同文件「renderer 的调用只许命中 `SERVED`」+ 已知坏例 ②:renderer 路径的样例源码里 `client.auth.set(...)` | 没有 renderer 规则 ⇒ ② 被 `UNSUPPORTED` 覆盖而不报 ⇒ 用例红 |
| R9 / R15 三表不重叠 | 同文件「三张表各有理由、互不重叠」 | 一个键进两张表 ⇒ 红 |
| b 完整,AC-01 | B2;变异证据(贴进提交说明):删一个处理函数 ⇒ TS2741 点名该键;多一个目录外的键 ⇒ TS2353 | 映射类型不在 ⇒ 两个变异都能编译 |
| UC-19、R15 | `unsupported.test.ts`「探活回退 `GET /api/health` ⇒ 501 同一信封、`console.error` 零次、引擎零请求」;同文件「冻结 `checkServerHealth`(只在测试里 import)经 `createEngineFetch`:先探 `/api/health` 得 501,回退 `/global/health` 判健康,`console.error` 零次」 | 不登记探活回退 ⇒ 每次探活一条 `console.error` ⇒ 红 |
| UC-14、R8 | `unsupported.test.ts`「三条固定答复:`/global/config`、`/config` 回 `{}`,`/api/session/:id/permission` 回 `{data:[]}`,上游零请求」;`permission-reply.test.ts` 既有「v2 审批通道列表为空」 | 交回翻译器或碰引擎 ⇒ 上游请求计数非零 ⇒ 红 |
| UC-02、UC-03、UC-04 | B1 的 `request-abort.test.ts`、`engine-connection.test.ts`(请求不带 authorization 头)与经 `createEngineFetch` 的各用例 | — |
| AC-03 | B1、B3(差分为空)、B4 | 管道漏接一条 ⇒ 501 ⇒ 对应用例红 |

### 偏离记录

- 2026-11-12 · 目录基数按编排器裁决 1 取 A 的表:`SERVED` 88、`UNSUPPORTED` 22、`PROBE_FALLBACK` 1。设计 R1 / R9 / §4.1 / §9 M1 写的 87 / 18 是 E 上的数(差别见「对账」),编排器在设计 §10 留注 · M1b 提交。
- 2026-11-12 · 投影器的 `emit` 本片只按事件名定型(`ContractEventType`),载荷按 `ContractEventMap` 定型挪到 M2b:按名定型已经能保证翻译器只发约定里的事件;按载荷定型时,A 的投影器对 `message.updated`、`session.created`、`session.updated`(只发 `info`)、`session.deleted`(`info` 可缺)、`message.part.updated`(只发 `part`)发的字段比 v1 SDK 声明的少,`question.replied` / `question.rejected` 的 `sessionID` 可能为空 —— 要么改投影(运行时变化,本片差分必须为空),要么按设计 §5 末条逐条判真伪,归 M2b 与路由类型一起处理 · M1b 提交。
- 2026-11-12 · `index.ts` 不再导出 `matchRoute`(唯一用户是覆盖测试);匹配由约定导出 `matchServed` / `matchUnsupported` / `matchProbeFallback`,算法照 A 的 `index.ts:28-57` · M1b 提交。
- 2026-11-12 · 覆盖扫描排除 `*.stories.*`:新加的字面量路径形式在 `codepuppy-session-ui` 的一个 story 里扫出 `POST /__playground/apply-css`(storybook 的开发服务器,不经 engineFetch)。证据:用 M1b 的扫描器对三个扫描根下 `git ls-files` 列出的 22 个 `*.stories.*` 文件逐个扫,结果只有 `timeline-playground.stories.tsx:1550` 这一条字面量请求,客户端调用为零;所以排除它们不丢旧扫描的任何结果 · M1b 提交。
- 2026-11-12 · 顺序里的两个提交合成一个:先红后绿改用变异证明(去掉探活回退登记 ⇒ `unsupported.test.ts` 两条与覆盖测试两条红;关掉构造链形式 ⇒ 真树与已知坏例 ① 红;renderer 加一个目录外调用 ⇒ 覆盖两条红),输出记在提交说明里 · M1b 提交。

## M2a — 翻译器自有投影

- 依据:设计 §4.3 规则 3、4,§6 K2 两类,§9 M2(含 `GET /provider` 例外)与像素不变论证,§5 末条,R6;P-04 表;UC-05、UC-06、UC-08、UC-09、UC-10、UC-15、UC-16;Issue AC-02、AC-03。
- 核对:`b2da433c56` · 编排器(Claude Fable 5.2)· 通过(十片拆分、仅类型依赖提前到 M2b、M3 排在 M2a 之后均认可;四条读法的裁决见「编排器裁决」)

### 改动

| 文件 | 改什么 |
| --- | --- |
| `opencode2/v1-shapes.ts`(消息投影可拆出 `opencode2/messages.ts`) | 消息投影改为翻译器自有、入参是 2.x `SessionMessageInfo`:把冻结 `normalizeSessionMessages` 在 2.x 输入上会走的分支(`codepuppy-app/src/utils/session-message.ts:48-366`)逐支移植,接上 A 已有的有序 id、暂存附件、工具键与「继续」处理;agent 照 `context/global-sync/utils.ts:15-38` 的 2.x 分支;审批请求照 `:40-52` 并入 A `v1-shapes.ts:437-440` 的 `source.id → callID`;provider 只做 2.x → v1 `ProviderListResponse`(保留全部模型与 `status`,`default` 按冻结三参分支的选法,不再丢 deprecated);`contentKeys` 等按 2.x 类型定型 |
| `contract/session.ts`(新) | `SessionLineage`、`toContractSession`(规则 3;唯一一处断言在这里,依据 `session-title.ts:11-13`);对冻结 `utils/session.ts` 的相对 import 从 `frozen-shapes.ts` 挪到这里 |
| `opencode2/routes.ts`、`opencode2/events.ts`、`opencode2/permission-replies.ts` | 会话信息改经 `toContractSession`;项目、agent、审批请求、`contentKeys` 的 `as never` 全部去掉(A 上 22 处) |
| `engine-adapter/frozen-shapes.ts` | 删除,连同没人调用的 `normalizeProjectInfo` 转出 |
| `engine-adapter/projection-parity.test.ts`(新,门文件) | 翻译器自有投影与冻结原件逐个相等(冻结原件只在测试里 import,作独立的旧行为基准);输入全部是真采样 |
| `test-fixtures/engine-adapter-sampler/sample.ts`、`README.md` | 加剧本 `catalog`:经适配器的上游 fetch 记下 `/api/agent`、`/api/provider`、`/api/model`、`/api/model/default` 的原始 2.x 响应,写 `fixtures/catalog.json`;采样配置加一个 `status: "deprecated"` 的模型 |
| `engine-adapter/fixtures/catalog.json`(新) | 采样产物 |
| `engine-adapter/fixtures/lineage.json`(新) | 采样产物(偏离记录) |
| `src/main/codepuppy-reasoning-badge-parity.engine.cases.ts` | 「已知的坏」一臂的 `normalizeProviderList` 改从冻结 app 原处 import(同一个函数;`frozen-shapes.ts` 删除后的必要改指) |
| `docs/architecture/constraints.md` | 补登设计 §6 点名的一行:`contract/session.ts` 对冻结 `utils/session.ts` 的相对 import(`providers.ts` 转口规则,不变的偏离,与 `PermissionDialog.tsx:12` 同类) |
| `scripts/old-name-exceptions.tsv` | 删 `frozen-shapes.ts` 一行(文件已删);`catalog.json` 的 `_source` 带仓库名则加一行 |
| `scripts/gate-files.tsv` | 登记 `projection-parity.test.ts`(精确条数) |

### 顺序

1. 提交一:剧本 `catalog` 与 `catalog.json`(`SAMPLER_ENGINE_PORT` / `SAMPLER_MODEL_PORT` 避开别的 lane);`projection-parity.test.ts` 先写成「冻结原件 vs 当前翻译器路径」,在 A 的实现上绿(那时两边是同一个函数)。
2. 提交二:自有投影、`contract/session.ts`、删 `frozen-shapes.ts`、去 `as never`、登记同步。跑 B1–B4、`projection-parity.test.ts`、`old-name-scan.test.ts`;对消息投影做一次变异(删掉 shell 消息分支)贴红。

### 风险

- 消息投影是近 300 行的移植,漏一支只在对应形状出现时才错:`projection-parity` 覆盖全部夹具里的每个消息数组(`final` 与每一帧的 `snapshot`),B3 再从 HTTP 入口比一次。
- 2.x 配置若不收 `status: "deprecated"`,沙箱里采不到 deprecated 模型:那时用真样本里的一个模型把 `status` 改成 `deprecated`,在测试里注明是派生输入。
- 类型断言拿掉后暴露的不一致:纯类型问题在编译期处理;真实的运行时差异按设计 §5 末条修并在 PR 列出,带一条经 `createEngineFetch` 先红后绿的用例。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| R6 / K2 代际转换自有,AC-02 | `rg -n "codepuppy-app/src" packages/ui-mac/src/engine-adapter/opencode2` 零命中;非测试源码 `rg -c "as never"` 为 0(A 上 22) | 仍借冻结函数 ⇒ 命中非零 |
| 消息投影等价,AC-03 | `projection-parity.test.ts`「全部夹具的每个消息数组:自有投影 == 冻结 `normalizeSessionMessages`」 | 漏移植一支 ⇒ 含该形状的夹具不等 ⇒ 红(变异证据见顺序 2) |
| agent、审批请求等价 | 同文件两条(`catalog.json` 的 `/api/agent`;`permission-asked.json` 的帧与列表) | 字段映射错 ⇒ 红 |
| 规则 4 provider 与 §9 例外 | 同文件「HTTP 输出保留 deprecated 模型及其 `status`;交冻结 v1 分支归一后 == 冻结三参分支对同一样本(剥过标题档)的结果,比较时去掉三参分支独有、今天 HTTP 输出也不带的 `defaultModel`」;再经 `createEngineFetch` 发 `GET /provider` 一次 | 翻译器仍丢 deprecated ⇒ 前半红;`default` 选到 deprecated ⇒ 后半红 |
| 规则 3 会话标题 | 经 `createEngineFetch`:同一个缺标题的会话(真样本 `session.created` 帧去掉 `title`,注明派生)经 `GET /session` 与经 `/api/session` 直通再交冻结 `normalizeSessionInfo`,标题相同 | 不经 `toContractSession`、直接用原始 `title` ⇒ `undefined` ⇒ 红 |
| UC-05/06/08/09/15/16 行为不变 | B1(`event-projection`、`tool-shapes`、`tool-display`、`turn-diffs`、`staged-attachment`、`command-reply`、`file-watcher`、`failure-code`) | — |
| AC-03 | B3 差分为空;B4(真引擎经 `GET /provider` 与 `GET /api/model`) | 投影差一个字节 ⇒ B3 非空 |

### 偏离记录

- 2026-11-12 · 消息投影放在新文件 `opencode2/messages.ts`(计划里写的可选拆分);provider、agent、审批请求的转换在 `v1-shapes.ts`。1.17.13 谱系有、2.x 没有的字段(推理块的 `state`、工具的 `providerState` / `providerResultState`)原件读到的恒为 undefined,序列化后不出现,自有投影不再写;2.x 工具文件内容的 `name` 可为 null,原样交出,用一处 `as string | undefined` 标明(v1 类型没有 null)。
- 2026-11-12 · 多加采样剧本 `lineage`(写 `fixtures/lineage.json`):原有夹具里没有 `agent-switched`、`shell`、`compaction` 三种消息,消息投影的这三支没有真样本可比。剧本经适配器带档位发送、压缩对话、发 `!` 命令,压缩放在 shell 之前(投影把压缩挂在最近一条用户消息上,shell 之后没有可挂的)。
- 2026-11-12 · 剧本 `catalog` 实测:2.x 的 provider 配置不收模型 `status`(声明 deprecated 回来仍是 active),按风险一节用真样本派生 deprecated 模型;另记一份新建会话之后的 `GET /api/session`(还没提问,2.x 不给标题),作会话标题那条证明的真输入,代替计划里写的「session.created 帧去掉 title」(那个帧不是完整的会话信息)。
- 2026-11-12 · 计划外多改一个文件:`permission-shape.test.ts` 的反向臂动态 import 了 `./frozen-shapes`,改为直接 import 冻结 app 原处(同一个函数)。`opencode2/events.ts` 的 `project.updated`、`permission.asked` 两支改用 2.x 带类型的事件取 `data`,以去掉 `as never`。
- 2026-11-12 · 顺序里的两个提交合成一个;先红后绿用变异证明(删消息投影的 shell 分支 ⇒ 消息等价与反向臂两条红;工具 part 的 callID 改取工具名 ⇒ 消息等价红)。

## M2b — 约定类型落地

- 依据:设计 §4.3 规则 1、2、5,§4.4「响应」,§4.8 `RouteContext.reply`,§9 M2「JSON 路由经 `reply<K>`」,§4.2 末段(ui-mac 对 1.17.13 包的仅类型依赖),R4(O-1 取引用),§5 末条;Issue AC-01。
- 核对:`b2da433c56` · 编排器(Claude Fable 5.2)· 通过(十片拆分、仅类型依赖提前到 M2b、M3 排在 M2a 之后均认可;四条读法的裁决见「编排器裁决」)

### 改动

| 文件 | 改什么 |
| --- | --- |
| `contract/routes.ts` | `SERVED` 每条填 `entry<Response, Body>()`:按发出它的冻结客户端的生成类型引用(v1 SDK `<Op>Responses` / `<Op>Data`,1.17.13 `<Op>Output`,两边都发的取交),两边都没声明的才自声明;`ResponseOf` / `BodyOf` |
| `contract/translator.ts` | `RouteContext<K>` 的 `body` 改为 `BodyOf<K>`,加 `reply` |
| `opencode2/routes.ts` | JSON 路由经 `context.reply`;请求体读约定类型,去掉局部 `as {…}` |
| `engine-adapter/index.ts` | `reply` 的实现;按路由定型的分派(`dispatch<K>`) |
| `packages/ui-mac/package.json` | 加 `"@opencode-ai/client": "file:../codepuppy-app/vendor/opencode-ai-client-1.17.13-v2.tgz"`,只作类型使用,与 `codepuppy-session-ui/package.json:41` 同一个 tgz(提前的理由见「待核对 4」) |
| `bun.lock` | 只提交这条依赖在 ui-mac 段加的那几行(裁决 4) |
| `contract/events.ts` | `session.usage.updated`、`mcp.status.changed`、`mcp.resources.changed` 三种改为引用 1.17.13 的事件类型(裁决 2) |
| `opencode2/events.ts` | `emit` 按 `ContractEventMap` 的载荷定型(从 M1b 挪来,见 M1b 偏离记录);少发的字段按设计 §5 末条逐条处理(纯类型问题在编译期处理,真实运行时差异按当前正式版修并在 PR 列出) |

### 顺序

一个提交:依赖与 lock 一行 → 目录类型 → `reply` → 处理函数逐条改。跑 B1、B2、B3;做一次变异(某路由回一个缺字段的 body)贴出 `tsgo` 的报错。

### 风险

- 类型一收紧可能暴露成批不一致(设计已实测一例 `SessionInfo.title`):纯类型的在编译期处理;真实运行时差异按 §5 末条处理并列出。数量超出本片预估一倍就停下回报,不扩大。
- 加依赖后要在本 worktree 跑一次 `bun install` 让 `packages/ui-mac/node_modules/@opencode-ai/client` 出现;只提交 lock 的那一行。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| §4.4 / §4.8 `reply<K>`,AC-01 | B2;变异:一条路由回缺字段的 body ⇒ 编译报错(贴输出) | 没有 `reply<K>` ⇒ 变异照样编译通过 |
| R4 引用、不复制 | `contract/` 里只有 `import type`,没有复制的生成类型定义(`rg` 输出) | — |
| AC-03 | B1、B3 差分为空 | — |

### 偏离记录

- 2026-11-12 · 响应类型按规则 1 引用发出它的冻结客户端;按编排器的规则(行为不变、登记实际发出的形状、不为凑旧 SDK 类型补字段)逐条处理类型不一致,每条都核了消费方读不读差出来的字段,没有一条需要按设计 §5 改运行时,所以没有 BLOCKED:
  - `POST /session/:sessionID/command`:UC-17 的「没开回合回 `{}`」登记成 `| Record<string, never>`;
  - `POST /session/:sessionID/shell`:翻译器回 `{}`,v1 SDK 声明的是那个回合的消息;消费方不读响应体(`codepuppy-app/src/utils/server-compat.ts` 的 shell 只 await),登记 `Record<string, never>`;
  - `GET /api/model`:模型与 1.17.13 的 `ModelListOutput` 同形,location 信封是 2.x 的 `{ directory, workspaceID? }`(两个冻结客户端都声明了引擎不发的 `location.project`,v1 SDK 还多声明模型的 `api` / `request`);消费方 `model-contract.ts` 只读 `data` 里两边都有的字段;
  - 1.17.13 声明 `void` 的操作只核状态码、不读响应体(设计 P-09),取交时按 `unknown`(`LegacyOk`)。
- 2026-11-12 · 事件载荷按实际发出的登记:`session.created`、`session.updated`、`message.updated` 只发 `info`(`Pick`),`session.deleted` 的 `info` 可缺;冻结 app 的 event-reducer 只读这些(`event-reducer.ts:131-179,272,313`)。`question.replied` / `question.rejected` 的 `sessionID` 改从 2.x 带类型的 `form.*` 事件取(2.x 恒带,值不变);运行中 shell 卡的重发把读回的 part 定成 v1 `Part` 并加 `type === "tool"` 判断(这个 id 只给过工具 part,恒为真)。三种事件按 R4 引用 1.17.13 的类型(裁决 2)。
- 2026-11-12 · 处理函数里 `(context.body ?? {}) as {…}` 这类局部读法保留:`?? {}` 的回落要这样写;请求体的类型已在目录里给出,翻译器读到的就是它。
- 2026-11-12 · `GET /session/:id/todo` 用 `todosOf(last)!`:todowrite 的入参还在流式阶段时 todosOf 回 undefined、`Response.json` 当场抛错、经错误信封回 500 —— A 上就是这样,行为不改,记为观察。
- 2026-11-12 · 仅类型依赖放在 ui-mac 的 `devDependencies`;`bun.lock` 只提交它的三行(ui-mac 工作区块一行,`ui-mac/@opencode-ai/client` 解析条目一行加空行),`bun install --frozen-lockfile` 在这份 lock 上退出 0,在不带这三行的 HEAD lock 上报 `lockfile had changes, but lockfile is frozen`。
- 2026-11-12 · `replay.ts` 加上 `lineage.json` 的消息读取与 `catalog.json` 上的 `GET /agent`、`/provider`、`/session`、`/experimental/session`、`/api/model`、`/api/agent`、`/api/session`;before 在 M2a 的代码上跑。

## M3 — 回执账本归约定

- 依据:设计 §4.8(`ApprovalEngine`、`DecisionInput`、`DecisionOutcome`、`ReceiptLedger`、指纹序列化、与 E 的行为差别、`SETTLE_MS` / `pdec_v1_` / 窗口寿命)、§6 安全面五条回执不变量、§9 M3、R7、R13(I-05(a) 已落地,`f344a2bdb1`)、P-11、ADR-033;UC-11;Issue AC-01、AC-03。
- 核对:`b2da433c56` · 编排器(Claude Fable 5.2)· 通过(十片拆分、仅类型依赖提前到 M2b、M3 排在 M2a 之后均认可;四条读法的裁决见「编排器裁决」)

### 改动

| 文件 | 改什么 |
| --- | --- |
| `contract/receipts.ts`(新) | 账本 `show` / `decide`(含同一请求的决定排队,照 A `permission-replies.ts:249-259`);「没有可记的模式的 always 回冲突」按 v1 形状读 `always`;`canonicalJson`、指纹函数、`SETTLE_MS`、`v1DecisionID` |
| `contract/errors.ts` | 结果 → 404 `PermissionNotFoundError` / 409 `ConflictError` / 400 `BadRequest` 信封(从 A `routes.ts:85-105` 搬来) |
| `contract/translator.ts` | `RouteContext.receipts`、`Translator.approvals` |
| `engine-adapter/index.ts` | 按引擎源持有账本(每个 `createEngineFetch` 一份,与 A 相同),放进 `RouteContext` |
| `opencode2/permission-replies.ts` → `opencode2/approvals.ts` | 只剩 `ApprovalEngine`:`current` 重读 2.x 请求并用自有投影转成 v1;`decide` 保留 A 的事件窗口、回复前后的待审比对与 `settle`,返回了结的 id(目标排第一) |
| `opencode2/routes.ts`、`opencode2/events.ts`、`opencode2/index.ts` | 三个回复入口、`GET /permission`、`permission.asked` 改经 `context.receipts`;投影器的第三个参数换成账本;翻译器实例不再持有按源的回复状态 |
| `test-fixtures/engine-adapter-sampler/sample.ts`、`README.md` | 指纹改为对适配器 `GET /permission` 交出的请求、用账本导出的同一个函数算 |
| `engine-adapter/fixtures/permission-reply.json` | `bun …/sample.ts permission` 重采 |
| `engine-adapter/permission-reply.test.ts` | 指纹 helper 改为对交出的 v1 请求算;建账本代替 `createPermissionReplies`;加下表两条 |
| `permission-shape.test.ts`、`event-projection.test.ts`、`failure-code.test.ts`、`file-watcher.test.ts`、`tool-shapes.test.ts`、`turn-diffs.test.ts` | 投影器第三个参数改传账本(每处一行) |
| `test-fixtures/engine-adapter-sampler/replay.ts` | 建投影器那一行跟着改 |
| `docs/architecture/codepuppy-authority-registry.json` | `adr033-decision-receipt` 的机制改指 `contract/receipts.ts`;证明测试仍在 `permission-reply.test.ts`,补上新测名 |
| `scripts/gate-files.tsv` | `permission-reply.test.ts` 14 → 实测;`old-name-exceptions.tsv` 按重采后的 `_source` 同步 |

### 顺序

1. 本片基线上跑 B3 存 before。
2. 一个提交:先在 `permission-reply.test.ts` 写两条新用例(在旧代码上红:指纹按引擎字段算),再搬账本与端口、改调用方、重采夹具、改测试与登记。跑 B1、B2、B3、登记册测试;采样器 `permission` 剧本打印的收据与夹具一致。

### 风险

- 收据指纹值会变(设计 §4.8 已列明):生产路径没有调用方发送或读取它;采样器、夹具与读夹具指纹的测试在同一个提交里一起迁移,回退也一起回退。
- 投影器签名改动波及六个测试文件:只改传参那一行,断言不动。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| UC-11 / ADR-033 全部行为,AC-01、AC-03 | `permission-reply.test.ts` 既有用例全绿(冻结消费方 → v1 SDK → `createEngineFetch`):收据形状、v1 / v2 入口、409、404、幂等重放、reject 连带、本次会话内允许 | — |
| §4.8 指纹序列化 | 新用例「收据指纹 = `GET /permission` 交出的 v1 请求按 §4.8 序列化的 sha256」,对重采的真夹具 | 仍按引擎原始字段算 ⇒ 值不等 ⇒ 红 |
| §4.8 与 E 的行为差别 | 新用例「按引擎字段算的旧指纹走 v2 入口 ⇒ 409,引擎零回复」 | 账本不比所显示的指纹 ⇒ 出收据 ⇒ 红 |
| 账本代际无关 | `rg` 显示 `contract/receipts.ts` 没有 `@opencode/` 与 `opencode2` 的 import | — |
| 登记册改指 | `authority-registry.test.ts` | 不改指 ⇒ 机制文件或测名缺失 ⇒ 红 |
| AC-03 | B1、B3 差分为空(B3 不含收据) | — |

### 偏离记录

- 2026-11-12 · 计划外多改一个文件:`permission-mount-ratchet.test.ts` 的审批提交入口白名单按文件登记,`permission.reply` 这个调用随端口搬到 `opencode2/approvals.ts`,登记改指那里。
- 2026-11-12 · 回复时引擎已经没有这条请求(回复本身 404)的情形,`ApprovalEngine.decide` 交回空集合,账本据「集合里没有目标」判过期 —— 设计的签名只回 `string[]`,没写这一种;写在 `contract/receipts.ts` 的接口注释里,行为与 A 相同(404 过期)。`Translator.approvals` 与路由用的是同一个函数(`opencode2/approvals.ts` 的 `approvals`)。
- 2026-11-12 · 指纹那条新证明另用 `permission-asked.json` 里带工具来源的真请求经账本走一遍:假引擎的请求没有 `source`,`tool` 缺省时不进序列化,只用它证明不了 `tool` 在指纹里(变异「指纹去掉 tool」起初没红,补上这一段后红)。
- 2026-11-12 · B3 在同一份夹具上比:`permission-reply.json` 本片重采,所以 after 先换回重采前的那份跑,再放回新的。

## M4 — Code Puppy 界面只经约定;边界扫描 f

- 依据:设计 §4.2 依赖表、R12、§4.10 f、§9 M4;P-05;Issue AC-01、AC-02、AC-04。
- 核对:`b2da433c56` · 编排器(Claude Fable 5.2)· 通过(十片拆分、仅类型依赖提前到 M2b、M3 排在 M2a 之后均认可;四条读法的裁决见「编排器裁决」)

### 改动

| 文件 | 改什么 |
| --- | --- |
| `engine-adapter/contract/v1.ts`(新) | renderer 与翻译器取 v1 类型的唯一入口:按名转出今天用到的类型,原样转出 `createOpencodeClient`(同一个绑定) |
| renderer 22 个非测试文件(除 `extensions/`、`sidebar/` 两个,都在 `renderer/codepuppy-ui/` 下) | `@opencode-ai/sdk/v2/client` 改为 `contract/v1` 的相对路径,只改 import 行:`PermissionDialog.tsx`、`background-problem-watcher.tsx`、`cloud-run-watcher.tsx`、`composer-autocomplete.tsx`、`composer-state.ts`、`hub-install-watcher.tsx`、`model-contract.ts`、`model-default-core.ts`、`model-picker-core.ts`、`pending-image-sends.ts`、`session-timeline/cards/tool-card-model.ts`、`session-timeline/cards/tool-cards.tsx`、`session-timeline/process-fold.tsx`、`session-timeline/process-live.ts`、`session-timeline/timeline-attachments.ts`、`session-timeline/timeline-model.ts`、`session-workspace/session-composer-dock.tsx`、`session-workspace/session-dock-core.ts`、`session-workspace/session-permission-feed.ts`、`session-workspace/session-question-card.tsx`、`extensions/use-extensions.ts`、`sidebar/use-projects.ts` |
| `opencode2/` 里引 v1 类型的文件 | 改从 `../contract/v1` 取 |
| `engine-adapter/boundary.test.ts`(新,门文件) | §4.2「不许依赖」的静态 import 扫描(扫描范围见「待核对 3」)+ 已知坏例 + 转出同一绑定 |
| `scripts/gate-files.tsv` | 登记 `boundary.test.ts` |

### 顺序

1. 提交一:`boundary.test.ts` 先在当前树上红(列出 renderer 与 `opencode2/` 的直引)。
2. 提交二:`contract/v1.ts` 与全部改指,`boundary.test.ts` 转绿。跑 B1、B2、B4,以及 renderer 里构造客户端或 alias SDK 的测试:`src/renderer/codepuppy-ui/model-contract.test.ts`、`src/renderer/codepuppy-ui/session-workspace/permission-single-surface.test.ts`、`src/renderer/codepuppy-ui/hub-install-watcher.test.ts`。

### 风险

- 测试 bundle 用 vite 把 `@opencode-ai/sdk` 全前缀 alias 到录音替身(`permission-single-surface.test.ts:62`、`hub-install-watcher.test.ts:32`);转出模块里的 `@opencode-ai/sdk/v2/client` 同样被 alias 命中,上面两个测试证明替身仍然接得住。
- 运行时不变是从「转出同一个绑定」推出来的(设计「仍是推断」):用同一绑定断言与 B4 的真引擎宿主兜住,不比打包产物。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| f,AC-02、AC-04 | `boundary.test.ts`「真树无违例」+ 已知坏例:`opencode2/` 路径的样例源码 `import … from "../../../../codepuppy-app/src/utils/session"` ⇒ 违例(设计 §4.10 f 点名);renderer 路径的 `import type { Session } from "@opencode-ai/sdk/v2/client"` ⇒ 违例;`contract/` 路径的 `import … from "../opencode2/routes"` ⇒ 违例 | 扫描不判 ⇒ 坏例不报 ⇒ 红;改指没做 ⇒「真树无违例」红(顺序 1) |
| R12 运行时不变,AC-01 | 同文件「`contract/v1` 的 `createOpencodeClient` 与 SDK 的是同一个绑定」;B4;上面三个 renderer 测试 | 转出被包一层 ⇒ 同一绑定断言红;alias 没接住 ⇒ 单一审批面闸门红 |
| AC-03 | B1、B2 | — |

### 偏离记录

- 2026-11-12 · 两个提交合成一个;先红后绿用变异证明(把 `use-projects.ts` 与 `opencode2/routes.ts` 的 import 改回 `@opencode-ai/sdk/v2/client` ⇒「真树无违例」红,逐个点名)。改指的是 22 个 renderer 文件加 4 个 `opencode2/` 文件,`contract/v1.ts` 按名转出它们用到的 28 个类型与 `createOpencodeClient`。
- 2026-11-12 · 已知坏例比计划多五条(翻译器直引 v1 SDK、renderer 动态 import、约定引冻结 app 的其它源码、约定按值引 1.17.13 客户端、管道引冻结 app),外加三条允许的对照;扫描排除规则沿用 M1b 之后的覆盖扫描(含 `*.stories.*`)。
- 2026-11-12 · B3 的 before 在 M3 的代码上跑(`git stash` 暂存本片改动跑完即恢复),after 在本片上跑,夹具相同。

## M5a — 夹具的引擎源码身份(e)与终端路径钉住

- 依据:设计 §4.10 e(含终端路径核对)、§4.9、R10、R11、§9 M5;P-10;Issue AC-04。
- 核对:`b2da433c56` · 编排器(Claude Fable 5.2)· 通过(十片拆分、仅类型依赖提前到 M2b、M3 排在 M2a 之后均认可;四条读法的裁决见「编排器裁决」)

### 改动

| 文件 | 改什么 |
| --- | --- |
| `test-fixtures/engine-adapter-sampler/engine-identity.ts`(新) | 身份按 §4.10 e 求:`packages/cli` 清单的 `workspace:` 依赖闭包,每个包的 git tree id(`git rev-parse HEAD:<dir>`),外加采样配置加载的插件包(今天没有);采样器与测试共用这一份规则 |
| `test-fixtures/engine-adapter-sampler/sample.ts`、`README.md` | 闭包路径有未提交改动 ⇒ 拒绝运行;每个夹具写入身份;`_source` 不再拿 `HEAD` 当身份 |
| `engine-adapter/fixtures/*.json`(12 个,含 `catalog.json`) | 全部重采 |
| `engine-adapter/fixture-identity.test.ts`(新,门文件) | 每个夹具的身份 == 按同一规则从当前树重算,不等即红并提示重跑采样器;终端:冻结 `terminalWebSocketURL` 拼出的路径与引擎协议 `packages/protocol/src/groups/pty.ts` 的 PTY 连接路由描述一致 |
| `scripts/gate-files.tsv`、`scripts/old-name-exceptions.tsv` | 登记新门文件;重采后 `_source` 的旧名计数同步 |
| 读死采样值的既有测试(若有) | 改为从夹具读 |

### 顺序

1. 提交一:`engine-identity.ts`、`fixture-identity.test.ts`(在现有夹具上红:没有身份字段)、采样器改动。
2. 提交二:全部重采,测试转绿。跑 B1、`fixture-identity.test.ts`、`old-name-scan.test.ts`;在临时副本改闭包里一个文件后跑采样器,贴出拒绝运行的输出。回报里写明全量重采的耗时,以及 e 红时是否逐个点名过时的夹具(编排器据此决定闭包要不要收窄)。

### 风险

- 闭包包含 core、server、schema 等 Code Puppy 也会接管修改的包:之后任何改到这些包的提交都要在同一 PR 重跑采样器,否则 e 红。这是 §4.10 e 的既定代价,见回报的设计关注。
- 全部重采会让夹具的 id 与时间全变:既有测试按夹具读 id 的不受影响;读死值的在本片改为读夹具。
- 终端核对引用引擎协议源文件:测试里按相对路径 import(ui-mac 没有声明 `@opencode/protocol` 依赖),只读不改。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| e,AC-04 | `fixture-identity.test.ts`「每个夹具的引擎身份等于当前树」;反向臂:夹具身份里改一个 tree id ⇒ 红,闭包少一个包 ⇒ 红;自检:A 上闭包是 17 个包且含 `packages/core`、`packages/server` | 不比身份 ⇒ 改坏的身份照样绿 ⇒ 反向臂红 |
| 采样器拒绝脏树 | 命令输出(顺序 2) | — |
| §4.9 / R10 终端钉住 | 同文件「冻结终端地址的路径 == 协议描述的 PTY 连接路由」;反向臂:把路由模板换一段 ⇒ 红 | — |
| AC-03 | B1 在重采的夹具上全绿 | 重采后形状变了而投影没跟上 ⇒ 红 |

### 偏离记录

暂无

## M5b — 直通的消费字段(d)

- 依据:设计 §4.3 规则 5(`READS`)、§4.10 d、§9 M5、R11;P-09;「仍是推断」第 2 条(20 条只由 1.17.13 发出的直通要逐条找读点);Issue AC-04。
- 核对:`b2da433c56` · 编排器(Claude Fable 5.2)· 通过(十片拆分、仅类型依赖提前到 M2b、M3 排在 M2a 之后均认可;四条读法的裁决见「编排器裁决」)

### 改动

| 文件 | 改什么 |
| --- | --- |
| `contract/routes.ts` | `READS`:26 条直通各登记消费方实际读的字段与读点(逐条在冻结 app 与 renderer 里找),或登记冻结消费函数(如 `/api/session` → `normalizeSessionInfo`);类型上要求覆盖全部直通键 |
| `test-fixtures/engine-adapter-sampler/sample.ts`、`README.md` | 剧本 `passthrough`:在沙箱里备好会话、PTY 与集成,经 `createEngineFetch` 对每条直通实调一次,写 `fixtures/passthrough.json`(带身份) |
| `engine-adapter/fixtures/passthrough.json`(新) | 采样产物 |
| `engine-adapter/passthrough-reads.test.ts`(新,门文件) | 每条:状态码 == 发出它的冻结客户端声明的成功码(1.17.13 解析 vendored `client.js` 的 `successStatus`,v1 SDK 为 2xx);`READS` 的每个字段都在样本里,或交登记的冻结消费函数(只在测试里 import)得到消费方要的结果 |
| `scripts/gate-files.tsv` | 登记 |

### 顺序

一个提交:先写 `READS` 与测试(样本不在 ⇒ 红),再加剧本、采样、转绿。跑 B1、B2、`passthrough-reads.test.ts`、`fixture-identity.test.ts`。

### 风险

- `/api/integration/*` 的 5 条要在沙箱里有一个能走完 OAuth 的集成。只用本机假服务(做法同 `mcp-auth.test.ts`),不连外网;本机做不到的条目报 `PARTIAL` 并附证据,不手写样本。
- 写操作的直通(删除、分叉、中断、命令、压缩、shell、PTY 增删改)只对沙箱里的会话与 PTY 发。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| d,AC-04 | `passthrough-reads.test.ts` 逐条;已知坏例:从 `/api/agent` 样本删掉 `mode` ⇒ 红(设计 §4.10 d 点名);把一条样本的状态码改成 500 ⇒ 红 | 只核状态码 ⇒ 删字段的坏例照绿 ⇒ 红 |
| `READS` 覆盖全部直通 | B2 + 测试里「26 条直通都有 `READS`」 | 少登记一条 ⇒ 红 |

### 偏离记录

暂无

## M5c — 转换路由的采样用例(c,路由)

- 依据:设计 §4.10 c(不许拿被测翻译器的输出当期望)、§9 M5、R11;P-12;Issue AC-04。
- 核对:`b2da433c56` · 编排器(Claude Fable 5.2)· 通过(十片拆分、仅类型依赖提前到 M2b、M3 排在 M2a 之后均认可;四条读法的裁决见「编排器裁决」)

### 改动

| 文件 | 改什么 |
| --- | --- |
| `test-fixtures/engine-adapter-sampler/sample.ts`、`README.md` | 剧本 `routes`:对每条非直通的翻译路由(A 上 59 条),经 `createEngineFetch` 发一次冻结界面会发的 v1 请求,用包在上游 fetch 外面的记录器存下 2.x 往返,写 `fixtures/routes.json` |
| `engine-adapter/fixtures/routes.json`(新) | 采样产物 |
| `engine-adapter/contract-cases.test.ts`(新,门文件) | 用例台账:每条非直通翻译路由 → 证明它的测试文件与测试名,既有用例直接登记;台账检查(每键有条目、文件在、测试名在文件里、没有目录外的键);尚无用例的路由在这里补:经 `createEngineFetch` 回放 `routes.json` 的 2.x 往返,断言写成 UC 不变量、交冻结消费方判,或与样本里的引擎原值逐字段比 |
| `scripts/gate-files.tsv` | 登记 |

### 顺序

1. 提交一:台账与检查(先只登记既有用例 ⇒ 列出缺口而红)。
2. 提交二:剧本、采样、补用例,转绿。跑 B1、`contract-cases.test.ts`;每类路由(会话、项目、文件、MCP、提问、终端)挑一条变异贴红。

### 风险

- 补的用例多(估计 40 余条):超过本片 800 行就把 PTY 与 MCP 两组挪进 M5d,在本段记偏离。
- 期望必须来自翻译器之外:每条用例写明期望的来源(UC、冻结消费方或引擎原值)。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| c 每条转换路由有用例,AC-04 | `contract-cases.test.ts`「台账覆盖每条非直通翻译路由」;反向臂:台账删一条 ⇒ 红;条目指向不存在的测试名 ⇒ 红;`SERVED` 多一条没有用例的键 ⇒ 红 | 没有台账 ⇒ 新路由没用例也不红 |
| 各路由用例 | 每条一个经 `createEngineFetch` 的回放用例 | 翻译器改坏 ⇒ 对应用例红(变异证据见顺序 2) |

### 偏离记录

暂无

## M5d — 事件的采样用例(c,事件)与升级手册

- 依据:设计 §4.10 c、§4.5(事件表第 1 版)、§9 M5「升级手册『中』加一步」、R11;Issue AC-04。
- 核对:`b2da433c56` · 编排器(Claude Fable 5.2)· 通过(十片拆分、仅类型依赖提前到 M2b、M3 排在 M2a 之后均认可;四条读法的裁决见「编排器裁决」)

### 改动

| 文件 | 改什么 |
| --- | --- |
| `engine-adapter/contract-cases.test.ts` | 台账扩到 `ContractEventMap` 的 33 种事件;尚无用例的(PTY 四种、`lsp.updated`、`vcs.branch.updated`、`reference.updated`、`global.disposed`、`mcp.*` 四种、`catalog.updated`、`server.instance.disposed`、`project.updated`、`session.deleted`、`session.usage.updated` 等)补用例:把采样帧经 `GET /global/event` 喂进翻译器,投影结果交冻结 app 的事件归约(只在测试里 import)或按 UC 判 |
| `test-fixtures/engine-adapter-sampler/sample.ts`、`README.md` | 剧本 `events`:在沙箱里触发上面这些事件并录帧,写 `fixtures/events.json` |
| `engine-adapter/fixtures/events.json`(新) | 采样产物 |
| `docs/runbooks/upstream-update.md` | 「中」加一步:重跑采样器,c、d 在新样本上绿 |
| `scripts/gate-files.tsv` | `contract-cases.test.ts` 条数同步 |

### 顺序

一个提交:台账扩到事件(先红)→ 剧本与采样 → 补用例转绿 → 手册一步。跑 B1、`contract-cases.test.ts`、`fixture-identity.test.ts`。

### 风险

- 个别事件在沙箱里可能触发不了(如 `global.disposed`、`reference.updated`):触发不了的报 `PARTIAL` 并附证据,不手写帧。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| c 每种事件有用例,AC-04 | `contract-cases.test.ts`「台账覆盖 `ContractEventMap` 每种事件」;反向臂同 M5c | 事件表多一种却没用例 ⇒ 红 |
| 各事件用例 | 冻结归约或 UC 判的回放用例 | 投影改坏 ⇒ 对应用例红 |
| 手册一步 | `docs/runbooks/upstream-update.md` 的改动;`python3 scripts/check-doc-links.py docs/runbooks/upstream-update.md` 退出 0 | — |

### 偏离记录

暂无
