---
id: DESIGN-upgrade-ui-contract
title: 界面只认 Code Puppy 自己的数据约定(I-04)技术设计
summary: 界面与引擎之间的请求、事件、错误和形状定成 Code Puppy 自有的一份约定;引擎适配器拆成代际无关的约定与管道加每代一个翻译器;翻译器不再引冻结界面内部函数,Code Puppy 自有代码只经约定模块接触冻结的两个客户端包;冻结界面零字节改动
kind: tech-design
status: approved
spec: ""            # 内部工作,没有 spec;已批准的输入是 alpha-work 意图 I-04(U-02),见 §1
spec_version: ""
review:
  rounds: 1
  reviewed_sha: "205c6c969aab3285197bd174eb7b9d22089c5e62"
  verdict: pass-with-notes   # R1 = Codex gpt-6.1-sol,会话 01a1cedc,建议 FIX-THEN-MERGE;3 Major + 3 Minor 全部采纳,本版已修正(§10)
owners: [owner]
last_reviewed: 2026-11-12
---

# DESIGN-upgrade-ui-contract｜界面只认 Code Puppy 自己的数据约定 技术设计

只放决定:契约、落点、失败处理、迁移与回滚、裁决。文件清单、提交顺序与测试归实施方的 `plan.md`。§3、§7 已退役,编号不复用。

坐标约定:`E` = `engine/1662-opencode2@4198d1a484`(换代整合分支,全部 lane 已并入;只读检出 `/Users/tide/app/alpha-code/.worktrees/1661-sync-v1195`)。送审版按 `df748c16e7` 引用;到 `4198d1a484` 为止,本文引用的文件里只有 `v1-shapes.ts` 的 `turnAnchor` 原位改动(行号不变)、`renderer/index.tsx` 与 `cloud-run-watcher.tsx` 行号后移(本版已更新),以及登记册变化(P-11)。I-04 在 #1662 合入 `alpha` 之后实施,下文事实都按 `E` 引用。「测」= 本设计跑过的命令;「读」= 读码得出;「推」= 推断,未验证。

## 1. 基线

- 依据(没有 spec,内部工作):[impharaon/alpha-work:INT-upstream-upgrade-readiness](https://github.com/impharaon/alpha-work/blob/4c1b2c624b53619de97fa6bfa5679024d07abf17/docs/intents/INT-upstream-upgrade-readiness.md) 的 I-04「界面只认 Code Puppy 自己的一份数据约定,引擎每换一代只换一层翻译」,owner 2026-11-12 U-02 批准;讨论记录 P-03。正文要求:「把这层翻译的输入输出定成 Code Puppy 自己的约定,去掉对上游旧客户端包和冻结代码内部转换函数的依赖」。
- 约束(owner 原话):「界面当前的 alpha 才是唯一权威吧」;「不可以因为 opencode 更新把经 codepuppy 拿回的唯一权威再封掉」;OpenCode 新增能力默认归 OpenCode,Code Puppy 只在交界处做最小接线(ADR-048 决定 2 第三层)。内部工作:用户可见行为不变,除非本文点名。
- 继承、不重开:L6 方案 `E:docs/design/2026-11-09-1668-l6-ui-stays-alpha.md` §2.2–§2.5(冻结界面始终走 0.1.26 的 v1 数据路径;适配器是界面到引擎的唯一通路,表外 501);ADR-047 决策 1;ADR-048 决定 2、3、5。
- 覆盖(派发书的七个决定,下文以 A1–A7 引用):
  - A1 约定是什么(只取装上的 Code Puppy 界面真用到的调用、事件与形状);
  - A2 约定定义在哪、怎么版本化;
  - A3 适配器怎么变成「每代引擎一个翻译器」;
  - A4 怎么去掉对 `packages/codepuppy-sdk-v1` 与冻结界面内部的依赖,像素不变,分片、每片可发;
  - A5 一致性怎么测(夹具从真引擎采样);
  - A6 不支持的路由怎么处置;
  - A7 哪些保持冻结。
- 相邻工作:I-05(少改上游文件,并行设计中)只改翻译器内部(§10 R13);回执权威在登记册里的落点随 M3 改指(§9 M3;登记册接进每日同步归 I-02)。

## 批准记录

- 2026-11-12,owner(编排器转达),逐字:「同意，界面数据约定和减少改上游文件两份方案都批准」
- 含义:本设计(审过并按 finding 修正的 `ab7fe5febe`)获批;编排器 2026-11-12 据这句原话把本设计标为 `approved`。

## 2. 地面真相

**P-01 适配器今天的结构**(读,E):
- `packages/ui-mac/src/engine-adapter/` 七个源文件:`index.ts` 155 行、`routes.ts` 643、`v1-shapes.ts` 481、`events.ts` 411、`permission-replies.ts` 315、`session-cache.ts` 74、`frozen-shapes.ts` 18。
- 代际无关的管道与 2.x 专属逻辑混在同一批文件里:
  - `index.ts` 同时持有引擎源登记(`:149-155`)、路由匹配(`:28-57`)、501(`:71-74`)这些通用部分,和 2.x 专属的部分:每请求建一个 2.x 客户端(`:93-98`)、按错误名里的 `NotFound` 判 404(`:77-82`)。
  - `routes.ts` 里路由身份(方法 + 路径)与 2.x 处理函数写在同一行(`:194-570`)。

**P-02 路由表规模**(测):
- `grep -c '^  route(' routes.ts` = 61,`grep -c '^  passthrough(' routes.ts` = 26,`grep -c '{ method: "' routes.ts` = 17。
- 服务 87 条,分三类:
  - 转换 58 条;
  - 原样直通 26 条(`E:routes.ts:539-569`);
  - 固定答复 3 条,答复不碰引擎:`GET /global/config`、`GET /config`(`:207-212`)、`GET /api/session/:sessionID/permission` 恒回 `{data:[]}`(`:478-481`,理由是防止同一审批经 v2 通道再进一次而被自动拒绝)。
- 声明不支持 17 条(`:576-594`)。派发书写的是 16,实测 17。扫描补全后,约定登记 18 条不支持,外加 1 条探活回退(P-03、§4.8)。

**P-03 覆盖扫描**(测):
- 有界探针:在 `/tmp/i04-probe` 用 bun 1.4.4、隔离的 HOME/XDG,导入 `routes-coverage.test.ts` 的扫描函数与 `matchRoute`。跑完换代检出无改动(`git status --short` 为空)。
- 结果:扫出 173 个调用点;v1 SDK 68 个方法,1.17.13 客户端 28 个方法(测试下限 60/20,`E:packages/ui-mac/src/engine-adapter/routes-coverage.test.ts:160-162`)。
- 扫描范围是 `codepuppy-app/src`、`codepuppy-session-ui/src`、`ui-mac/src/renderer`(`:133`)。「方法 → 路径」取自冻结包本身:sdk-v1 的 `sdk.gen.ts`(`:21`)与冻结 app 自带的 1.17.13 `client.js`(`:56-58`)。
- 落在不支持名单上的调用点全部在 `codepuppy-app`;renderer 没有一个调用点命中不支持路由。
- 173 不是完整的调用面(R1 审查发现,本设计复测):扫描器认不出三种调用形式,同一探针对这些文件的扫描结果是 `server-health.ts` → `[]`、`server-protocol.ts` → `[]`、`server-sdk.tsx` 只扫到 `:271`:
  - 直接链在客户端构造调用上的调用。`app.tsx:541` 的启动健康检查与 10 秒一轮的轮询(`utils/server-health.ts:117-164`)都走 `checkServerHealth`,它先发 `OpenCode.make({…}).health.get()` → 1.17.13 的 `GET /api/health`(`server-health.ts:88-104`;路径见 `client.js:131`),失败后才回退到 `createSdkForServer({…}).global.health()` → `GET /global/health`(`:107-109`)。`GET /api/health` 不在 87/17 里;今天它每次都落到表外 501,冻结客户端抛 `UnexpectedStatus`(`client.js:38-48`),健康检查靠这次失败回退。
  - 绑定到构造函数、却不叫 `api`/`client` 等名字的变量:`eventApi.event.subscribe` → `GET /api/event`(`server-sdk.tsx:195,272`;路径见 `client.js:873`),只在协议不是 v1 时走(`:269-272`)。
  - 路径是字面量的原始请求:`probe(server, fetch, "/global/health")` 与 `"/api/health"`(`utils/server-protocol.ts:28,31`;后者只在前者失败时才探),以及 `renderer/sidebar/use-projects.ts:679` 的 `fetch(new URL("/global/health", …))`。
- 诚实边界:扫描仍是正则;第二道核对是运行时对表外请求的 501 日志。

**P-04 翻译器复用的冻结转换函数**(读,另计数):
- `frozen-shapes.ts:11-18` 用相对路径转出冻结 app 的 6 个函数。调用处共 20 个 `as never`(`routes.ts` 12、`v1-shapes.ts` 3、`events.ts` 5)。原因:这些函数的入参按 1.17.13 的类型写(例 `E:packages/codepuppy-app/src/utils/session.ts:1-6`),翻译器喂进去的是 2.x 的值,编译期的形状检查恰好在这层边界上被关掉了。其中 `normalizeProjectInfo` 的转出在适配器里没有任何调用方。
- 每个函数按分支做两种不同的事:「代际转换」把 1.17.13/2.x 谱系的输入转成 v1 形状;「现用界面归一」是冻结 app 对已经是 v1 形状的数据本身做的处理。逐个看见下表。R1 审查纠正了送审版「另外 5 个原件不运行」的说法:provider 与 project 两个都有现用的界面归一。
- 2.x 的 `ProjectVcs` 是 `string`(`client/src/promise/generated/types.ts:283`),v1 的是 `"git"`(`codepuppy-sdk-v1/src/v2/gen/types.gen.ts:3248`);renderer 直接读翻译器给的项目,不调用 `normalizeProjectInfo`(grep renderer 零命中)。

| 函数 | 代际转换分支在现用路径上由谁跑 | 对 v1 输入的现用界面归一 |
| --- | --- | --- |
| `normalizeSessionMessages` | 只有翻译器;冻结侧只在 v2 存储那一支调用(`server-session.ts:553,590,693,911`,输入是 2.x 谱系的会话消息;R1 审查也没在现用 v1 路径上找到反例) | 没有 |
| `normalizeAgentList` | 只有翻译器(`bootstrap.ts:270` 在 v2 支路) | 原样返回(`context/global-sync/utils.ts:16`) |
| `normalizePermissionRequest` | 只有翻译器 | 原样返回(`utils.ts:40`) |
| `normalizeSessionInfo` | 翻译器,以及冻结 app 自己:2.x 直通的 `/api/session` 结果经它转换(`directory-sync.ts:129`、`utils/session.ts:33`、`titlebar.tsx:212`、`command-palette.ts:260`) | 原样返回(`utils/session.ts:6`) |
| `normalizeProviderList` | 三参分支只有翻译器(`bootstrap.ts:242` 在 v2 支路) | v1 分支在现用路径上始终运行:丢掉 `deprecated` 模型、建 `Map`(`bootstrap.ts:234` → `utils.ts:58-71`) |
| `normalizeProjectInfo` | 不适用(翻译器没有调用) | 每次加载或更新项目都运行(`bootstrap.ts:136`、`layout.tsx:583`、`edit-project.ts:92` → `utils.ts:167-171`);现用路径上收到的是翻译器给的 v1 项目,只把 `vcs` 收窄到 `"git" \| undefined` |

**P-05 对 v1 SDK 的依赖**(测):
- ui-mac 非测试文件里有 29 个 import `@opencode-ai/sdk/v2/client`:适配器 4 个、renderer 25 个。用到 26 个类型名,外加 `createOpencodeClient`。renderer 在运行时用它建客户端的地方有 3 处(`renderer/sidebar/use-projects.ts:661`、`renderer/extensions/use-extensions.ts:1062`、`renderer/codepuppy-ui/cloud-run-watcher.tsx:89`)。
- sdk-v1 是上游 1.18.35 的副本,Code Puppy 自有,已冻结,生成脚本不再跑(ADR-047 决策 1;`types.gen.ts` 13,788 行)。
- ui-mac 解析不到冻结 app 自带的 1.17.13 客户端:`ls packages/ui-mac/node_modules/@opencode-ai/` 得到 `app plugin schema sdk session-ui ui`。只有 `codepuppy-app` 与 `codepuppy-session-ui` 声明了它(`file:` 指向同一个 tgz)。
- 26 条直通路由里,6 条经 v1 SDK 的 `v2.*` 命名空间发出(`GET /api/agent`、`GET /api/provider/:providerID`、`GET /api/reference`、`GET /api/session`、`GET /api/session/:sessionID`、`POST /api/session/:sessionID/model`;其中 `GET /api/session` 两个客户端都发),其余 20 条只由 1.17.13 客户端发出(测,扫描调用点)。两个客户端都为这些操作生成了响应类型,例 `V2AgentListResponses`(`types.gen.ts:11469`)、`SessionListOutput`(`codepuppy-app/node_modules/@opencode-ai/client/dist/promise/generated/types.d.ts:3399`)。1.17.13 客户端也声明了 P-08 的 3 种事件(`types.d.ts:1411,1763,1775`)。

**P-06 翻译器里复制的引擎逻辑**(读):
- `wildcardMatch` / `evaluateRules`(`permission-replies.ts:150-173`)与 `allowForSession` / `releaseCovered`(`:176-210`):I-05 按 U-03 把「本次会话内允许」挪进已接管的 `core/src/permission.ts`,这些随之删除(接管调查第 1 行)。
- 目录读取卡解析写给模型的文本(`v1-shapes.ts:204-226`):I-05 按调查 B1 改由 ext `execute.after` 生成。
- 失败码前缀的读回(`v1-shapes.ts:347-368`):读法由 I-05 定。
- `canonicalJson`(`permission-replies.ts:30-43`):它算的是审批回执的快照指纹。注释里「与 ext 同一算法」是巧合,不是共用概念。送审版说指纹「只在本文件里生成、比较」,R1 审查指出这不对:v2 回复入口接收命令里的指纹并在收据里交回(`routes.ts:463-476`),采样器也按引擎原始请求算指纹去发命令(`test-fixtures/engine-adapter-sampler/sample.ts:310,325`)。生产路径上没有调用方发送或读取它(§4.8)。
- `shellPreview`(`events.ts:107-109`)复刻的是 0.1.26 引擎的截法。v1 引擎已不存在,这条截法现在是约定事实(UC-09)。

**P-07 唯一绕过翻译器的引擎路径**(读):冻结的终端地址拼接直连 `/api/pty/:id/connect`(`E:packages/codepuppy-app/src/utils/terminal-websocket-url.ts:13-21`,在 SOT 补丁里)。其余请求都经 `engineFetch`(`renderer/index.tsx:69,336,479,486-487`)。

**P-08 事件**(读):
- 翻译器发出约 31 种 v1 事件,来源有三类:直通集合(`events.ts:115-126`)、任意 `mcp.*`(`:290`)、改名与派生(`:262-376`)。
- 冻结 app 消费、但 sdk-v1 没有声明的有 3 种:
  - `session.usage.updated`(`codepuppy-app/src/context/global-sync/event-reducer.ts:204-212` 读 `sessionID`、`cost`、`tokens`);
  - `mcp.status.changed`、`mcp.resources.changed`(`context/server-sync.tsx:597-598` 只看类型)。

**P-09 冻结客户端不校验响应**(读):
- hey-api v1 SDK 拿到 JSON 原样交出。
- 1.17.13 客户端解析 JSON;状态码不等于描述里的 `successStatus` 就抛错(`codepuppy-app/node_modules/@opencode-ai/client/dist/promise/generated/client.js:48`)。
- 所以形状只在编译期有类型约束,运行时只核状态码。

**P-10 采样夹具**(读):
- `engine-adapter/fixtures/` 下 11 个夹具,每个的 `_source` 都写明采样器(`packages/ui-mac/test-fixtures/engine-adapter-sampler/sample.ts` 582 行,外加 mock 模型)与采样时的提交(`d60a30c32e`、`99cd1a5f58`、`023507c5c0`、`c261bba302`)。
- 采样方式:真 2.x 引擎(`packages/cli serve`,从源码运行,`sample.ts:60-61`)、隔离的 HOME/XDG、脚本化的 mock 模型。
- 夹具里没有可比较的引擎身份:采样时记的是 `HEAD` 短提交(`sample.ts:23`),任何无关提交都会改它;从源码运行时引擎版本恒报 `local`(`packages/cli/src/version.ts:8`),现有夹具记的也都是这个值。采样所跑入口 `packages/cli` 的 `workspace:` 依赖闭包,在 E 上实测是 17 个包:ai、cli、client、codemode、core、latex、merman、plugin、plugin-browser、protocol、schema、server、simulation、theme、tui、ui、util。

**P-11 回执权威**(读):登记册条目 `adr033-decision-receipt` 在 E 上已在役,机制指向 `packages/ui-mac/src/engine-adapter/permission-replies.ts`,证明测试在 `permission-reply.test.ts`。它由 `b74496994d` 补齐;送审版所据的 `df748c16e7` 上,这一条还是 `blocked`。规格在 `permission-replies.ts:1-21`:展示请求的指纹、逐次收据、幂等重放、陈旧回复 409。

**P-12 这层出过的错**(读,#1668 评论 6815984368):L6 代码审计找到 5 处界面拿到错误数据:工具卡的键没转全、「继续」之后回合改动被清空、文件变化通知被丢、命令应答恒空、取消信号没透传。五处都是界面依赖、却没有任何书面约定写明的翻译语义。

**P-13 不在本设计内**:
- 主进程直接调 2.x(`src/main/engine-client.ts:7`),不属于界面;启动配置由 I-07 处理。
- WSL 按版本装引擎(`src/main/wsl/runtime.ts:262`);ADR-047 规定只有一代引擎。

## 4. 接口契约

### 4.1 约定是什么(A1)

约定指界面与翻译器之间、经 `engineFetch` 的那一层 HTTP/SSE。这里的界面包括冻结界面和 Code Puppy 自己的界面。约定由五部分组成:

1. **路由目录**:服务的 87 条、声明不支持的 18 条(E 的 17 条,加上扫描补出的 `GET /api/event`)、探活回退 1 条(`GET /api/health`,UC-19)。服务的成员就是今天的路由表,不增不减(R1)。
2. **事件流**:`GET /global/event` 的帧格式与事件表。
3. **错误信封**。
4. **不变量** UC-01–UC-19:界面依赖、类型表达不出来的语义。
5. **审批回执账本**(ADR-033)及其引擎端口。

不属于约定的:引擎自己的 `/api/*` 面、主进程对引擎的调用、终端 WebSocket(具名例外,§4.9)。

### 4.2 模块与依赖方向(A2、A3)

```text
packages/ui-mac/src/engine-adapter/
  contract/    代际无关:路由目录、事件表、错误信封、不变量类型、固定答复、回执账本;冻结 v1 SDK 的唯一入口
  index.ts     代际无关的管道:引擎源登记、按约定目录匹配、501、取消、错误信封落地;静态选用当前那一个翻译器
  opencode2/   当前引擎代的唯一翻译器:路由处理、投影、事件投影、会话缓存、审批端口
```

| 谁 | 可以依赖 | 不许依赖 |
| --- | --- | --- |
| `contract/` | `@opencode-ai/sdk` 的类型,外加唯一一个运行时绑定 `createOpencodeClient`(`codepuppy-sdk-v1/src/v2/client.ts:50`,原样转出给 renderer);冻结 app 自带的 1.17.13 包 `@opencode-ai/client`(仅类型);冻结 app 的 `utils/session.ts`(仅规则 3 那一个函数,§4.3) | `opencode2/`、任何 `@opencode/*`、冻结 app 的其它源码 |
| `index.ts` | `contract/`、`opencode2/`(仅选用) | 冻结界面任何源码 |
| `opencode2/` | `contract/`、`@opencode/client`、`@opencode/schema/codepuppy-*`、`ext/src/staged-attachment-part`(既有) | 冻结界面任何源码、任何 `@opencode-ai/*` |
| `ui-mac/src/renderer/**` | `contract/`(v1 类型与 `createOpencodeClient`)、`index.ts`(`engineFetch`、`registerEngineOrigin`) | `@opencode-ai/sdk`、`@opencode-ai/client` |

renderer 对 `@opencode-ai/{app,ui,session-ui}` 的 import 是在挂载冻结界面,不受影响。ui-mac 为此增加一条对 1.17.13 包的仅类型依赖,指向 `codepuppy-session-ui` 已经在用的同一个 tgz。

### 4.3 形状从哪来(A1、A4)

1. **经冻结客户端发出的路由与事件**:请求体、响应体与事件载荷的类型,按引用取发出它的那个冻结客户端生成的类型,不复制:
   - v1 SDK:`<Op>Data` / `<Op>Responses`(例 `SessionPromptAsyncData`、`SessionListResponses`,`codepuppy-sdk-v1/src/v2/gen/types.gen.ts:10290,9613`;`v2.*` 命名空间如 `V2AgentListResponses`,`:11469`)和 `Event*`;
   - 1.17.13 客户端:`<Op>Output`(例 `SessionListOutput`、`ProjectCurrentOutput`,`types.d.ts:3399,4808`)和它的事件类型(P-08 的 3 种,P-05)。
   - 两个客户端都发的路由(`GET /api/session`),两边的类型都要满足。
2. **两个冻结客户端都没有声明的形状**,在约定里自声明,只写消费方读的字段,并逐项写明读点。今天只有 Code Puppy 的细化:UC-09、UC-10、UC-12、UC-16。
3. **冻结 app 在自己的现用路径上会对引擎谱系数据做的代际转换,约定直接复用,不另写一份**(K2)。今天只有 `normalizeSessionInfo` 一个(P-04 表)。约定导出 `toContractSession`,参数类型只列这个函数读的字段。唯一一处类型断言留在约定里,依据是该函数对缺失标题的容忍(`codepuppy-app/src/utils/session-title.ts:11-13`)。这样经 `GET /session` 和经 `/api/session` 直通看到的会话标题出自同一条规则。
4. **冻结 app 对 v1 形状做的现用界面归一,唯一权威就是冻结 app 里那段代码,翻译器不重做**:
   - provider:`normalizeProviderList` 的 v1 分支(丢 `deprecated` 模型、建 `Map`)是唯一权威。翻译器的 provider 代际转换只做「2.x providers + models + default → v1 `ProviderListResponse`」:数组形式,保留全部模型及其 `status`,按 v1 语义为每个 provider 算出 `default`;它不再自己丢 deprecated 模型。今天它借冻结的三参分支,顺带做了这一步。
   - project:翻译器的代际转换只做 `canonical → worktree`,并把 2.x 的 `vcs: string` 收窄到 v1 类型要求的 `"git" | undefined`(`v1-shapes.ts:304-307`)。renderer 直接读这份输出(P-04),所以收窄是约定类型的要求。冻结侧的 `normalizeProjectInfo` 仍是它那些调用方的归一,不动;`frozen-shapes` 里没人调用的那个转出删掉,不在翻译器里重写。
5. **原样直通的 26 条**:约定类型按规则 1 取发出它的客户端的响应类型。翻译器原样转发,编译期管不到响应体,所以约定另给每条登记消费方实际读的字段(`READS`,逐条写读点),或者登记一个冻结消费函数(如 `/api/session` 交给 `normalizeSessionInfo`)。一致性 d 在真引擎样本上逐项断言(§4.10)。

```ts
// contract/routes.ts(节选;完整 87 条逐条取自 E:routes.ts:194-570,不增不减。生成类型名以 sdk-v1 types.gen.ts 为准)
import type * as V1 from "@opencode-ai/sdk/v2/client"
import type * as Legacy from "@opencode-ai/client/promise"   // 冻结 app 自带的 1.17.13 客户端,仅类型

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
/** "<METHOD> <模板>";`:name` 取一段,`*name` 取余下全部(沿用 E:index.ts:27-57 的匹配法)。 */
export type RouteKey = `${Method} /${string}`
/** 目录项只在编译期携带类型。 */
export type Served<Response, Body = undefined> = { readonly __response?: Response; readonly __body?: Body }
/** SSE 事件流,帧格式见 §4.5。 */
export type ContractEventStream = AsyncIterable<ContractFrame>
declare function entry<Response, Body = undefined>(): Served<Response, Body>

export const SERVED = {
  "GET /global/health": entry<{ healthy: true; version: string }>(),                          // UC-01
  "GET /session": entry<V1.SessionListResponses[200]>(),
  "POST /session/:sessionID/prompt_async": entry<void, NonNullable<V1.SessionPromptAsyncData["body"]>>(),
  "GET /global/event": entry<ContractEventStream>(),                                         // §4.5
  "GET /api/project/current": entry<Legacy.ProjectCurrentOutput>(),                         // 规则 1,1.17.13 发出
  "GET /api/agent": entry<V1.V2AgentListResponses[200]>(),                                    // 规则 1 + 5,直通
  "GET /api/session": entry<V1.V2SessionListResponses[200] & Legacy.SessionListOutput>(),     // 两个客户端都发
  // …
} as const satisfies Record<RouteKey, Served<unknown, unknown>>

/** 规则 5:翻译器原样转发的路由,消费方实际读什么(一致性 d 在真引擎样本上逐项断言)。 */
export type ReadSet = { readonly fields: readonly string[]; readonly sites: readonly string[] } | { readonly consumer: string; readonly sites: readonly string[] }
export const READS = {
  "GET /api/agent": { fields: ["data[].id", "data[].mode", "data[].hidden", "data[].description"], sites: ["renderer/codepuppy-ui/composer-autocomplete.tsx:184,282-289"] },
  "GET /api/session": { consumer: "normalizeSessionInfo", sites: ["codepuppy-app/src/context/directory-sync.ts:129", "codepuppy-app/src/context/global-sync/home-session-index.ts:131"] },
  // … 26 条直通都要有
} as const satisfies Partial<Record<ServedKey, ReadSet>>

export type ServedKey = keyof typeof SERVED
export type ResponseOf<K extends ServedKey> = NonNullable<(typeof SERVED)[K]["__response"]>
export type BodyOf<K extends ServedKey> = NonNullable<(typeof SERVED)[K]["__body"]>

/** 答复不依赖引擎的路由,由约定侧直接答(UC-14)。 */
export const FIXED = {
  "GET /global/config": () => ({}),
  "GET /config": () => ({}),
  "GET /api/session/:sessionID/permission": () => ({ data: [] }),
} as const satisfies Partial<Record<ServedKey, () => unknown>>
export type TranslatedKey = Exclude<ServedKey, keyof typeof FIXED>

/** 声明不支持:不会有 handler;运行时 501 + console.error(§4.8)。 */
export const UNSUPPORTED = {
  "PUT /auth/:providerID": "U5:…",
  "GET /api/event": "v2 支路才订阅(codepuppy-app/src/context/server-sdk.tsx:269-272),协议恒为 v1(UC-01)",
  // … 共 18 条:E:routes.ts:576-594 的 17 条理由原样,加上面这条
} as const satisfies Record<RouteKey, string>

/** 探活回退:冻结调用方先试它、失败即回退到已服务的路由;约定侧固定回 501 信封,不记错误日志(UC-19)。 */
export const PROBE_FALLBACK = {
  "GET /api/health": "codepuppy-app/src/utils/server-health.ts:88-109 失败后回退 GET /global/health;server-protocol.ts:31 只在 /global/health 失败后才探",
} as const satisfies Record<RouteKey, string>

/** 规则 3:会话信息归一用冻结界面自己的那一条(冻结 app utils/session.ts)。 */
export type SessionLineage = {
  id: string; projectID: string; parentID?: string; subpath?: string; title?: string
  location: { directory: string; workspaceID?: string }
  cost: V1.Session["cost"]; tokens: V1.Session["tokens"]; time: V1.Session["time"]
  agent?: string; model?: V1.Session["model"]
  revert?: { messageID: string; partID?: string; snapshot?: string }
}
export declare function toContractSession(input: SessionLineage): V1.Session
```

### 4.4 API

- 面:renderer 进程内的 `fetch` 拦截。只有已登记的引擎源(`registerEngineOrigin`)走约定,别的源原样交给 `globalThis.fetch`,与 E 相同。
- 认证:管道与翻译器都不加凭据,`Authorization` 由 main 的 `onBeforeSendHeaders` 补上(UC-04)。
- 请求:路径参数取自模板;查询串原样;方法不是 GET/HEAD 时,body 按 JSON 解析,解析失败就保留原文(`E:index.ts:116-122`)。
- 目录作用域:见 UC-02。
- 响应:JSON 路由经 `reply<K>` 发出,body 的类型就是该路由的约定响应类型;204、SSE、二进制与直通返回原生 `Response`。
- 错误:§4.6。

### 4.5 事件流

```ts
// contract/events.ts
import type * as V1 from "@opencode-ai/sdk/v2/client"
/** SSE:每帧 `data: <JSON>\n\n`,JSON = ContractFrame;directory 为 "global" 表示不属于某个目录(E:events.ts:262-264)。 */
export type ContractFrame = { directory: string; payload: ContractEvent }
export type ContractEvent = { [T in keyof ContractEventMap]: { type: T; properties: ContractEventMap[T] } }[keyof ContractEventMap]
export type ContractEventMap = {
  "message.updated": V1.EventMessageUpdated["properties"]
  "message.part.updated": { part: ContractPart }                 // ContractPart = V1.Part 加上 UC-09 的细化
  "message.part.delta": V1.EventMessagePartDelta["properties"]
  "session.status": V1.EventSessionStatus["properties"]
  "permission.asked": V1.EventPermissionAsked["properties"]
  "session.usage.updated": { sessionID: string; cost: V1.Session["cost"]; tokens: V1.Session["tokens"] }  // 规则 2
  "mcp.status.changed": Record<string, unknown>                  // 规则 2:消费方只看类型
  "mcp.resources.changed": Record<string, unknown>
  // … 第 1 版 = 今天发出的全部类型,逐个列名(E:events.ts:115-126、:262-376);`mcp.*` 前缀直通改为逐个列名
}
```

### 4.6 错误信封

```ts
// contract/errors.ts —— 冻结界面认的错误体(E:index.ts:71-82、routes.ts:86-104)
export type ContractError =
  | { status: 400; body: { name: "BadRequest" | "UnknownError"; data: { message: string } } }
  | { status: 404; body: { name: "NotFoundError"; data: { message: string } } }
  | { status: 404; body: { _tag: "PermissionNotFoundError"; requestID: string; message: string } }
  | { status: 409; body: { _tag: "ConflictError"; resource: string; message: string } }
  | { status: 500; body: { name: string; data: { message: string } } }   // name 保留引擎声明的错误名
  | { status: 501; body: { name: "CodePuppyEngineAdapterUnsupported"; data: { method: string; path: string } } }
```

- 声明不支持的路由、目录之外的请求:都回 501,并 `console.error` 记方法与路径。
- 已取消的请求:不返回 Response,以取消原因拒绝(UC-03)。
- 引擎错误 → 信封:由翻译器的 `toContractError` 决定,因为错误怎么认是代际相关的。

### 4.7 不变量(界面依赖、类型表达不出来的语义)

每条都写明今天的实现位置(E);下一代翻译器必须满足同样的条件。

| # | 不变量 | 今天的实现与消费方 |
| --- | --- | --- |
| UC-01 | `GET /global/health` 回 `{healthy:true, version}`,冻结 app 探协议时据此选 v1 路径 | `routes.ts:196-199`;`codepuppy-app/src/utils/server-protocol.ts:28-29` |
| UC-02 | 目录取自查询串 `directory`、`location[directory]` 或头 `x-opencode-directory`(URI 解码),按此优先序 | `index.ts:59-69` |
| UC-03 | 为一个约定请求发出的每个引擎调用都带这个请求的取消信号;请求被取消时以取消原因拒绝 | `index.ts:91-98,112-113,139-141` |
| UC-04 | 管道与翻译器不持有、不添加引擎口令(seams I8) | `index.ts:8-10` |
| UC-05 | 同一条消息内,`part.id` 按字典序排列即显示顺序 | `v1-shapes.ts:30-38` |
| UC-06 | 正文与思考块:先发一条空文本的 `message.part.updated`,之后才有同一 `partID` 的 `message.part.delta`;结构性事件之后按存储重发快照,以快照为准 | `events.ts:1-15,321-345` |
| UC-07 | 回合开始发 `session.status busy`;结束发 `session.status idle` 后接 `session.idle`;失败时 `session.error` 在它们之前;重试发 `session.status retry{attempt,message,next}` | `events.ts:87-97,358-376` |
| UC-08 | 最近一个回合的改动挂在最近一条 v1 用户消息的 `info.summary.diffs` 上(消息首页与 `message.updated` 都挂);每处改动另发 `file.watcher.updated{file, event: add\|unlink\|change}` | `v1-shapes.ts:446-480`;`events.ts:194-219` |
| UC-09 | 工具卡读到的键:`display` = 引擎 `metadata.codepuppyDisplay`(有才带);`read` 带 `input.filePath`,读目录时带 `metadata.display{type:"directory",path,entries,offset,totalEntries?,truncated}`;`edit` 带 `metadata.diff`;`patch` 带 `metadata.files[]{relativePath,type:add\|update\|delete}`;`subagent` 带 `input.subagent_type`,运行中就带 `metadata.sessionId`,另有 `metadata.background`;运行中的 shell 带 `metadata.output`,取最后 30,000 字,截断时前缀 `"...\n\n"` | `v1-shapes.ts:192-286`;`events.ts:107-109,221-245` |
| UC-10 | 审批请求(`GET /permission` 与 `permission.asked`)是 v1 `PermissionRequest{id,sessionID,permission,patterns,always,metadata,tool?}`;`metadata` 原样透传(四个冻结键) | `v1-shapes.ts:437-451`;L6 方案 §2.5 I7a |
| UC-11 | 审批回复遵守 ADR-033 回执合同(§4.8)。`always` = 本会话内按请求的每个 `always` 模式放行,同会话里被新规则覆盖的其余待审请求一并放行,并列进收据;从不变成项目级的持久允许 | `permission-replies.ts:1-21` |
| UC-12 | MCP `failed` 状态带登记码 `code`,`error` 文本里不带前缀;回合错误是网络层原因时带 `data.metadata.codepuppyNetLayer` | `v1-shapes.ts:347-368` |
| UC-13 | 提问:`question.asked` 是 v1 `QuestionRequest`;回答 `answers: string[][]` 按题序;拒绝发 `question.rejected` | `v1-shapes.ts:393-430`;`events.ts:296-309` |
| UC-14 | 固定答复:配置对象为空(所以客户端不自动回复审批);v2 审批列表恒空(同一审批不会以缺字段的形状再进一次界面而被自动拒绝) | `routes.ts:207-212,478-481` |
| UC-15 | 全部 part 都是 synthetic 文本的发送(时间线的「继续」)会开新回合,读回时正文仍是 synthetic,不显示 | `routes.ts:123-134`;`v1-shapes.ts:141-153` |
| UC-16 | composer 的暂存附件 part(synthetic + `codepuppy.attachment` metadata)原样往返 | `v1-shapes.ts:52-90` |
| UC-17 | `POST /session/:id/command` 回这条命令那个回合的助手消息 `{info, parts}`;命令没开回合时回 `{}` | `routes.ts:172-191` |
| UC-18 | 任务清单(`GET /session/:id/todo` 与 `todo.updated`)取最近一次 todowrite 的输入,每项 `{content,status,priority:"medium"}` | `v1-shapes.ts:431-436`;`routes.ts:343-350` |
| UC-19 | `GET /api/health` 恒回非 2xx(501 信封)。冻结的健康检查(启动时与每 10 秒一轮)先试它,失败即回退到 `GET /global/health`;探协议时只有 `/global/health` 失败才会探它 | `codepuppy-app/src/utils/server-health.ts:88-109,117-164`;`utils/server-protocol.ts:28-34`。E 上它是落在表外的 501,本设计改为约定侧登记的固定答复(R15) |

### 4.8 翻译器接口、回执账本与不支持路由(A3、A6)

```ts
// contract/translator.ts —— 每代引擎一个实现;管道只认这个接口
import type * as V1 from "@opencode-ai/sdk/v2/client"

export type RouteContext<K extends TranslatedKey> = {
  readonly params: Readonly<Record<string, string>>
  readonly query: URLSearchParams
  readonly body: BodyOf<K> | undefined
  readonly directory?: string                       // UC-02
  readonly request: Request
  readonly signal: AbortSignal                      // UC-03
  readonly receipts: ReceiptLedger                  // 这个引擎源的回执账本
  /** JSON 路由经这里出:body 的类型就是该路由的约定响应类型。 */
  readonly reply: (body: ResponseOf<K>, init?: { status?: 200 | 204; headers?: Record<string, string> }) => Response
}

export interface Translator<Engine> {
  /** 一个约定请求一个引擎客户端;为这次请求发出的每个引擎调用都带 signal。 */
  connect(input: { origin: string; signal: AbortSignal; fetch: typeof globalThis.fetch }): Engine
  /** 恰好覆盖 TranslatedKey:少一条、多一条都是类型错误。 */
  readonly routes: { readonly [K in TranslatedKey]: (context: RouteContext<K>, engine: Engine) => Promise<Response> }
  /** 引擎调用失败 → 约定错误信封(取消不经这里)。 */
  toContractError(error: unknown): ContractError
  /** 回执账本用的审批端口。 */
  approvals(engine: Engine): ApprovalEngine
}

// contract/receipts.ts —— ADR-033 回执合同,代际无关(UC-11)
export interface ApprovalEngine {
  /** 按界面所见的形状重读一条待审请求;引擎已经没有这条请求 → undefined。 */
  current(input: { requestID: string; sessionID: string }): Promise<V1.PermissionRequest | undefined>
  /** 把决定交给引擎;返回这次决定了结的全部请求 id,目标排第一。`always` 的语义见 UC-11。 */
  decide(input: { requestID: string; sessionID: string; decision: V1.PermissionV2Decision; message?: string }): Promise<string[]>
}
export type DecisionInput = {
  requestID: string; sessionID?: string; decision: V1.PermissionV2Decision; message?: string
  decisionID: string; requestFingerprint?: string
}
export type DecisionOutcome =
  | { type: "receipt"; receipt: V1.PermissionV2DecisionReceipt } | { type: "conflict" } | { type: "expired" }
export interface ReceiptLedger {
  /** 交给界面的每一条请求都经这里(列表与 permission.asked 两处):记下会话与快照指纹,原样返回。 */
  show(request: V1.PermissionRequest): V1.PermissionRequest
  /** 已有收据 → 同决定原样交回(不碰引擎),不同 → conflict;重读不到 → expired;指纹变了 → conflict;否则调 decide 出收据。 */
  decide(engine: ApprovalEngine, input: DecisionInput): Promise<DecisionOutcome>
}
```

- 指纹的序列化:`requestFingerprint` = 小写十六进制的 sha256,输入是 `canonicalJson({sessionID, permission, patterns, always, metadata, tool})`。取值就是交给界面的那份 v1 `PermissionRequest`,即 `GET /permission` 与 `permission.asked` 投影之后的值:`always` 缺省为 `[]`,`metadata` 缺省为 `{}`,`tool` 只在来源是工具时出现,形如 `{messageID, callID}`(`v1-shapes.ts:442-451`;冻结 `context/global-sync/utils.ts:40-50`)。`canonicalJson` 沿用现行算法:键按 `localeCompare` 排序、丢掉 `undefined`、数组保序(`permission-replies.ts:31-43`)。这正是 ADR-033 写的「所显示请求的指纹」。
- 与 E 的行为差别。E 按引擎原始请求 `{sessionID, action, resources, save, metadata, source}` 计算(`permission-replies.ts:45-56`);v2 回复入口接收命令里的指纹,收据里也交回指纹(`routes.ts:463-476`);采样器同样按引擎原始请求算指纹去发命令(`sample.ts:310,325`)。改制之后:
  - 同一请求的收据指纹值变了。R1 审查在真夹具 `permission-reply.json` 上实测:`1a70c94f…` → `a48d3197…`;即便把字段名换回引擎的名字,补出的 `metadata:{}` 仍会改变哈希。
  - 带旧指纹的 v2 回复命令得到 409 ConflictError,不再出收据。
  - 生产路径没有调用方发送或读取指纹:冻结审批面对 v1 投影出的请求铸 `engine-v1:<id>` 指纹,改走 v1 回复入口(`codepuppy-app/src/context/permission-surface.tsx:70-71`、`permission-v1-adapter.ts:124,223`);v2 列表恒空(UC-14)。所以界面看不到差别。
  - M3 在同一片里迁移全部消费方:采样器改为按适配器 `GET /permission` 返回的请求、用账本导出的同一个函数算指纹;重采 `permission-reply.json`;改所有读夹具指纹的测试。
- v1 入口缺 `decisionID` 时派生 `pdec_v1_<requestID>`;收据寿命 = 窗口寿命,不落盘;回复之后等连带 replied 到齐的上限 `SETTLE_MS` = 2,000 ms,随账本一起搬。三点都与 E 相同(`permission-replies.ts:28,74`)。
- **不支持的 18 条**按理由分五组,都留在约定的声明清单里,运行时回 501,没有翻译器实现它们:
  - U5 上游设置页与连接对话框的凭证、OAuth、配置写入,共 7 条;
  - U4 LSP 状态、worktree 增删重置、项目目录列表,共 6 条;
  - R6 owner 裁定拿掉的分享,2 条;
  - v1 模式下改走 `/question/:id/*` 的两条 v2 提问回复;
  - 只有 v2 支路才订阅的 `GET /api/event`(扫描补出,P-03)。
- **探活回退 1 条**:`GET /api/health`。它在现用路径上每 10 秒就会被发一次,失败本身就是约定(UC-19),所以不放进「不支持」。由约定侧固定回 501 信封、不记错误日志;E 上它每次都记一条表外错误,会淹没真正的未知请求。
- 声明清单随约定代际无关,下一代翻译器直接继承。renderer 的调用点不得命中声明清单(§4.10 a):今天的命中数是 0(P-03)。要让任何一条变成「服务」,需要改约定,并按 ADR-048 把用户可见的部分交 owner。

### 4.9 具名例外:终端 WebSocket

冻结的 `terminal-websocket-url.ts` 自己拼出 OpenCode 2 的 `/api/pty/:id/connect?location[directory]&cursor&ticket`(P-07)。WebSocket 不经 `fetch`,翻译器拦不到。本设计不改这个冻结文件,而是在一致性里钉住它(§4.10 e):引擎在这个方法与路径上提供 PTY 连接。换到下一代时,如果引擎挪了这个路径,门就红;那时要做的是一次 SOT 补丁改动,不会静默失效。

### 4.10 一致性判据(A5)

- **a 覆盖**(静态,既有测试改目标):冻结界面与 renderer 扫出的每个调用,都必须命中 `SERVED`、`UNSUPPORTED` 或 `PROBE_FALLBACK`。另加一条:来自 `ui-mac/src/renderer/**` 的调用必须命中 `SERVED`,声明不支持与探活回退对 renderer 不算覆盖。
  - 扫描必须认出今天漏掉的三种调用形式(P-03):
    - 直接链在客户端构造调用上的调用,跨行、带嵌套括号也算;
    - 绑定到四个构造函数的任意变量。`OpenCode.make` 与 `createApiForServer` 构造的是 1.17.13 客户端,`createSdkForServer` 与 `createOpencodeClient` 构造的是 v1 SDK;
    - 把字面量引擎路径交给 `fetch`、`new URL` 或转发给 fetch 的本地函数(今天是 `server-protocol.ts` 的 `probe`)的原始请求。
  - 在 E 上,这三种形式补出的调用是:`GET /api/health`(探活回退)、`GET /global/health`(已服务)、`GET /api/event`(登记为不支持)。
  - 已知坏例:①往夹具源码写一个跨行的 `OpenCode.make({\n  baseUrl,\n}).health.get()`,必须扫成 `GET /api/health`;②往 renderer 加一个 `client.auth.set(...)` 调用,必须红。
- **b 完整**(编译期):`Translator.routes` 是 `TranslatedKey` 上的映射类型,翻译器少一条、多一条都是类型错误。管道只按约定目录匹配,所以「服务的就是约定里的」在结构上成立。
- **c 转换的路由与事件**(运行期,真引擎采样):每个 `TranslatedKey` 里非直通的路由、`ContractEventMap` 里的每种事件,都至少有一个用例。用例的输入来自本代采样器对真引擎的采样;断言写成 UC 不变量,或者交给冻结消费方自己的归一与归约函数去判(只在测试里 import,如 `event-reducer.ts`)。不许拿被测翻译器算出来的值当期望。迁移各片证明「行为没变」时,用全部夹具做前后差分(输出逐个相等)。这只证明等价,不证明正确。
- **d 直通**(运行期,真引擎采样):每条直通路由由采样器实调一次,断言两件事:
  - 应答状态码等于发出它的冻结客户端声明的成功状态码:1.17.13 取描述里的 `successStatus`,v1 SDK 取 2xx(P-09);
  - 响应带着 `READS` 为这条路由登记的每个消费字段;或者把样本交给登记的冻结消费函数(只在测试里 import),得到消费方要的结果。
  - 例:`GET /api/agent` 的 `@` 菜单读 `data[].id`、`data[].mode`、`data[].hidden`、`data[].description`(`renderer/codepuppy-ui/composer-autocomplete.tsx:184,282-289`)。已知坏例:从这份样本里删掉 `mode`,必须红。
- **e 夹具的出处**:采样器在每个夹具里记录引擎源码身份,一致性检查按同一规则从当前树重算,不等就红,提示重跑采样器。
  - 身份的定义:采样所跑入口(今天是 `packages/cli` 的 `serve`)按清单 `workspace:` 依赖求出的包闭包,每个包的 git tree id(E 上 17 个包,P-10),外加采样配置加载的插件包(如有)。这些路径有未提交改动时,采样器拒绝运行。
  - 不用 `ENGINE_VERSION`:从源码运行时它恒为 `local`。也不用采样时的 `HEAD`:任何无关提交都会改它(P-10)。
  - 每次上游进入(按 `docs/runbooks/upstream-update.md`「中」)都要重跑采样器,c、d 在新样本上跑。
  - 终端例外的路径核对放在这里,对照引擎协议的路由描述。
  - I-03 的上游行为探针可以把采样器这一跑收为自己的一项;I-04 只要求一致性跑在与当前源码身份一致的样本上。
- **f 边界**(静态 import 扫描):§4.2 表里的「不许依赖」都机器判。已知坏例:往 `opencode2/` 加一个指向 `codepuppy-app/src` 的相对 import,必须红。

### 4.11 版本(A2)

- 不设版本号,也不做运行时版本协商:约定的生产方(翻译器)和全部消费方(冻结界面、Code Puppy 界面)打在同一个 renderer 包里(`renderer/index.tsx:67,331`),不存在版本错开的组合。
- 约定的版本就是提交。约定的改动就是界面的改动:renderer 的新调用,或 SOT 补丁的改动。这样的改动必须在同一次变更里同时改目录与翻译器,并通过 a、b、f。
- 约定所描述的界面基准由 `frontend/frontend-pin.lock` 加 SOT 补丁固定,round-trip 脚本已经在判。

### 4.12 数据 / 配置

- 数据:不适用。约定不落盘;回执账本只活在窗口寿命里。
- 配置:不新增配置键。固定常量留在原主人那里:`SETTLE_MS` 随账本;`SHELL_PREVIEW_MAX` 进约定,作为 UC-09 的常量;轮询与快照窗口(`COMMAND_POLL_MS`、`MCP_AUTH_POLL_MS`、`SHELL_POLL_MS`、`SNAPSHOT_WINDOW`)随翻译器。

## 5. 数据与失败

- 没有持久化写入,也没有事务边界。约定与翻译器的状态都是内存态:收据、已发对象指纹、会话目录缓存。窗口关掉或引擎重启就清空,与 E 相同。
- 可达的失败窗口,全部沿用 E 的行为,本设计不新增失败状态:
  - 引擎调用失败 → `toContractError` → 信封;
  - 请求被取消 → 以取消原因拒绝;
  - 目录外或声明不支持 → 501 并记日志;
  - 单个事件投影失败 → 记日志,流继续;
  - 引擎事件流断开 → 记日志,关闭 SSE,冻结 app 照旧重连;
  - 回执等连带 replied 最多 `SETTLE_MS`;放行被覆盖的请求是尽力而为,失败的不进收据;
  - `GET /api/health` 由约定侧回 501,冻结的健康检查回退到 `GET /global/health`,与 E 相同,只是少了每 10 秒一条的表外错误日志(UC-19)。
- M3 之后,带旧指纹(按引擎字段算)的 v2 回复命令得到 409;生产路径上没有这样的调用方(§4.8)。
- M2 拿掉类型断言时可能暴露类型不一致(实测一例:2.x `SessionInfo.title` 可选,1.17.13 要求必填)。这不是运行时状态,在编译期处理。其中若有真实的运行时差异,属于翻译器的既有缺陷:按当前正式版的表现修,并在那一片的 PR 里列给 owner(§9)。

## 6. 架构落点

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| `engine-adapter/contract/`:路由目录、事件表、错误信封、不变量类型、固定答复、回执账本、`toContractSession`、`createOpencodeClient` 与 v1 类型的转出 | `packages/ui-mac/`(modules.md 已有此行) | sdk-v1(类型,外加 `createOpencodeClient` 一个运行时绑定);1.17.13 包(仅类型);冻结 app `utils/session.ts` 一个函数 | E 的路由表与不支持名单(`routes.ts:194-594`);ADR-033 回执合同(`permission-replies.ts:1-21`);冻结 app 的会话归一 |
| `engine-adapter/index.ts` 管道 | 同上 | `contract/`、`opencode2/` | `E:index.ts` |
| `engine-adapter/opencode2/` 翻译器 | 同上 | `contract/`、`@opencode/client`、`@opencode/schema/codepuppy-*`、ext 暂存附件(既有) | `E:routes.ts`、`v1-shapes.ts`、`events.ts`、`session-cache.ts`、`permission-replies.ts` 中的 2.x 部分 |
| renderer 对 v1 类型与客户端的 import 改指 `contract/` | `packages/ui-mac/` renderer | `contract/` | — |
| 采样器补齐 c、d、e | `packages/ui-mac/test-fixtures/engine-adapter-sampler/` | 真引擎 | 既有采样器 |

- 新目录:`contract/` 与 `opencode2/` 都在已有的 `engine-adapter/` 之下。分开的理由是,换代时只替换后者、前者原样保留(A3)。modules.md 按包立行,所以不用改。另记一条观察:origin/alpha 的 modules.md 还没有 #1662 新增的 `codepuppy-*` 冻结包,应随 #1662 或文档治理回填,不归本设计(§10 留档)。
- 架构约束:
  - K2(`docs/architecture/constraints.md:18`)变好,按 P-04 表逐分支分两类:
    - 代际转换:翻译器不再借 20 个 `as never` 把 2.x 数据喂给按 1.17.13 写的冻结函数。消息、agent、审批请求和 provider 的转换分支在现用路径上只有翻译器在跑,改由翻译器以 2.x 类型为入参自有实现;冻结侧的原件只在 v2 支路调用,不运行,保持逐字不变。会话信息的转换冻结 app 自己也在现用路径上跑,仍只有一份,由约定复用。
    - 现用界面归一:唯一权威留在冻结 app,即 `normalizeProviderList` 的 v1 分支与 `normalizeProjectInfo`。翻译器不重做:它的 provider 转换不再丢 deprecated 模型,没人调用的 `normalizeProjectInfo` 转出删掉、不重写。
  - 「alpha 组件经 `providers.ts` 借用冻结 app」规则:对冻结 `utils/session.ts` 的相对路径 import,从 `frozen-shapes.ts` 挪到 `contract/`。这属于不变的偏离,与已登记的 `PermissionDialog.tsx:12` 同类。`frozen-shapes.ts:8-10` 把它归为与已登记的 `PermissionDialog.tsx:12` 同类,但 constraints.md 里没有它自己的一行,M2 补登。
- 工程标准:不新增配置;错误沿用既有信封(标准 5);不新增对外 ID。
- 安全面:翻译器不做任何决定,审批、档位、目录闸都在引擎与 ext。回执账本的不变量:
  - 指纹按所显示的请求计算;
  - 同一 decisionID 重放交回原收据,不碰引擎;
  - 同一请求换了决定或 decisionID → 409;
  - 重读不到 → 404;
  - `always` 永不变成项目级持久允许。
  分享入口仍是 501(R6),不会把会话发到外部。
- 被否决的替代(各一句):
  - 把两个冻结客户端的类型复制进约定:同一形状出现第二份定义,是新的 K2 偏离;两边都冻结,复制换不来任何升级收益;而且去不掉 renderer 经 `createOpencodeClient` 对 sdk-v1 的运行时依赖(O-1)。
  - 把 `GET /api/health` 改成真服务:会改变健康检查与探协议的请求序列(`server-protocol.ts:33` 遇到 `{healthy:true}` 会直接判 v1),不是本设计的验收点(§10 留档)。
  - 从冻结的 1.x OpenAPI 子集生成约定的客户端与类型:为永不变化的形状加一条生成流水线和一批生成文件。
  - 生产路径上对翻译器输出做运行时形状校验:没有消费方需要;拦下来就是界面打不开,只记日志又是噪音;一致性由测试承担。
  - 单独立包 `@codepuppy/ui-contract`:ui-mac 之外没有消费方。
  - 放进 `packages/schema/src/codepuppy-*`:那里放与引擎、ext 共用的契约,界面约定不被它们消费;放进去会让 renderer 依赖上游包的布局。
  - 运行时按引擎代次选翻译器、保留旧翻译器:ADR-047 规定只有一代;换代变更直接替换翻译器。
  - 沿用 L6 的复用冻结转换函数:编译期检查被断言关掉;下一次换代时冻结代码改不动,投影会被拆在两层里(新证据 P-04)。
  - 现在就给终端地址开宿主接缝:为了省将来一次冻结改动,现在先改两个冻结文件;改为钉住(§4.9)。
  - 本设计里就把约定成员收紧到确证挂载的路由:需要逐条的可达性证据;收错一条就会把用户动作变成 501;没有验收点需要它(§10 留档)。
  - 约定版本号或握手:生产方与消费方同包发布,没有人读它。

## 8. 拆分决定

不适用:全部产出在 alpha-code 一个仓、同一负责方。与 I-05、I-02 的先后关系属于同仓开工依赖,写在 §9 与 §10 R13。

## 9. 回滚

**迁移切片**(派发书要求在本文给出;各片的文件与提交顺序归 plan.md)。

像素不变的论证:
- 冻结树零字节改动,round-trip 恒绿;
- renderer 的改动只限 import 说明符(M4);
- 翻译器输出在 M1–M3 前后逐个相等,用全部夹具做差分(§4.10 c)。有两处列明的例外,界面都看不到:
  - M2:`GET /provider` 的 HTTP 输出会带上 deprecated 模型。冻结消费方的 v1 分支照旧丢掉它们,所以这条路由在冻结消费方归一之后比较,结果相同;它唯一的现用消费方是 `bootstrap.ts:234`。
  - M3:收据里的 `requestFingerprint` 值变了;带旧指纹的 v2 回复改为 409。生产路径没有调用方,见 §4.8。

所以不需要额外的截图格。另一个可能的例外:M2 若查出既有的运行时缺陷,按当前正式版修复,并点名交 owner。

| 片 | 完成后成立的事 | 开工依赖 | 回滚 |
| --- | --- | --- | --- |
| M1 约定目录与管道分家 | `contract/` 有 `SERVED`(87)、`UNSUPPORTED`(18)、`PROBE_FALLBACK`(1)、事件表、错误信封、`FIXED`(3);管道只按约定匹配,探活回退不记错误日志;翻译器挪进 `opencode2/`,处理函数按 `TranslatedKey` 索引(b);覆盖测试改按约定目录,认出三种漏掉的调用形式,并加上 renderer 规则(a);夹具差分全等 | #1662 已合入 `alpha` | 回退该 PR |
| M2 翻译器自有投影 | `frozen-shapes.ts` 删除;`opencode2/` 不引任何冻结源码;`toContractSession` 在约定里;翻译器只做代际转换,现用界面归一留给冻结 app(§4.3 规则 4);没人调用的 `normalizeProjectInfo` 转出删掉、不重写;JSON 路由经 `reply<K>`;引擎类型与约定类型之间没有 `as never`;差分全等,`GET /provider` 按上面的例外比较。发现的真实差异按 §5 处理并在 PR 列出;constraints.md 补登 §6 那一行 | M1 | 回退该 PR |
| M3 回执账本归约定 | 账本在约定侧,行为按 UC-11;指纹按 §4.8 的序列化改制;同一片里迁移采样器的指纹算法、重采 `permission-reply.json`、改读夹具指纹的测试;差分全等,收据指纹与带旧指纹的 v2 命令按上面的例外;`opencode2/` 实现 `ApprovalEngine`;登记册 `adr033-decision-receipt` 的机制与证明测试改指账本及其测试(在 E 上它们指向 `permission-replies.ts` 与 `permission-reply.test.ts`) | M1;I-05(a) 已落地,或确定不做(R13) | 回退该 PR,连同采样器与夹具一起回退;账本只活在窗口寿命里,不留数据 |
| M4 Code Puppy 界面只经约定 | renderer 的 v1 类型与 `createOpencodeClient` 只从 `contract/` 取(同一绑定的转出,运行时不变);边界扫描(f) | M1 | 回退该 PR |
| M5 一致性补齐 | 每个转换路由与每种事件都有采样用例(c);26 条直通都登记了 `READS`,并有采样的状态与消费字段断言(d);ui-mac 声明对 1.17.13 包的仅类型依赖(按 O-1 推荐);夹具记录引擎源码身份,与当前树不等即红(e);升级手册「中」加一步「重跑采样器,c、d 在新样本上绿」 | M1;针对自有投影的用例要等 M2 | 回退该 PR(只有测试、清单与手册) |

- 回滚的后果:没有数据迁移、持久状态、引擎改动,冻结树也没动过。各片按依赖倒序就能单独回退。M4、M5 互不依赖;M2、M3 只依赖 M1。
- 冻结、本设计零改动的(A7):
  - `packages/codepuppy-app`、`packages/codepuppy-ui`(pin `e11dbd02` + SOT 补丁);
  - `packages/codepuppy-session-ui`;
  - `packages/codepuppy-sdk-v1`(冻结 app 的序列化器,也是约定形状的来源);
  - `packages/codepuppy-core-util`;
  - `codepuppy-app/vendor` 里的 1.17.13 客户端;
  - 冻结 app 的 v2 支路及其归一函数(Code Puppy 不运行它们,原件不变);
  - 终端地址拼接(§4.9 例外,钉住不改)。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| R1 约定 = 经 `engineFetch` 的 HTTP/SSE 一层;服务的成员 = 今天的路由表(87 条)与今天发出的事件类型,不增不减;登记 18 条声明不支持与 1 条探活回退。扫描补齐三种漏掉的调用形式之后,调用面才算完整(R1 审查第 2 项) | P-02、P-03(测,E;R1 审查独立复现 87/17/173/68/28);派发书要求「从 routes-coverage 与路由表推出,不从整个 v1 SDK 推」。收紧到确证挂载被否决,见 §6 |
| R2 约定定义在 `ui-mac/src/engine-adapter/contract/`,不另立包,不放 schema 包 | P-05:消费方全在 ui-mac(测);modules.md 的 ui-mac 行 |
| R3 不设版本号与协商;版本就是提交;约定的改动就是界面的改动,同一变更里过 a、b、f | `renderer/index.tsx:67,331`:生产方与消费方同包(读,E) |
| R4 形状按引用取发出它的冻结客户端的类型(v1 SDK 与冻结 app 自带的 1.17.13 包),不复制;自声明只限两者都没有的 Code Puppy 细化。约定模块另外原样转出 `createOpencodeClient` 这一个运行时绑定(R12),这一点不取决于 O-1。**类型取「引用」,owner 2026-11-12 已确认(O-1,见批准记录)** | P-05:两个包都已冻结、Code Puppy 自有,生成器不再跑(ADR-047 决策 1);复制会成为第二份定义(K2,constraints.md:18);翻译器与 renderer 照样不再直接 import 它们 |
| R5 一代一个翻译器:`opencode2/` 实现 `Translator`,管道静态选用。换代时在同一变更里新增下一代目录、切换选用、删除旧目录,不做运行时选择 | ADR-047 决策 1(只有一代);ADR-037(换代是独立变更) |
| R6 翻译器不引冻结界面,按分支划分:消息、agent、审批请求、provider 的代际转换由翻译器自有;会话信息的转换由约定按规则 3 复用;现用界面归一(provider 的 v1 分支、`normalizeProjectInfo`)的唯一权威留在冻结 app,翻译器不重做,没人调用的转出不重写 | P-04 表(测 20 处断言;读各分支的现用调用点;R1 审查第 4 项)。L6 的「复用」只在代际转换上翻案,新证据是:断言关掉了编译期检查,冻结代码在下次换代时改不动 |
| R7 回执账本归约定侧,翻译器只实现 `ApprovalEngine` 的两个调用;指纹改为按所显示的请求计算,序列化与行为差别见 §4.8;采样器、夹具和读夹具指纹的测试在 M3 同一片里迁移 | P-11;ADR-048 决定 3(换代不得丢权威);P-06 与 §4.8(R1 审查第 3 项):指纹经 v2 入口进出、采样器也在算,但生产路径没有调用方。字段一一对应,能否全部捕获陈旧见「仍是推断」 |
| R8 3 条固定答复归约定侧 | `routes.ts:207-212,478-481`:答复不依赖引擎,而且承载 Code Puppy 的决定(UC-14) |
| R9 18 条不支持(E 的 17 条加 `GET /api/event`)留在声明清单,运行时 501,不新增 handler;renderer 调用点不得命中 | P-02、P-03(测:renderer 命中 0;`GET /api/event` 只在 v2 支路);L6 的 U4、U5、R6 裁决不重开 |
| R10 终端 WebSocket 是唯一具名例外,不改冻结文件,由 e 钉住 | P-07;宿主接缝方案被否决(§6) |
| R11 一致性判据 a–f。a 认出三种漏掉的调用形式;d 断言直通样本的消费字段;e 比较引擎源码身份 | P-03、P-09、P-10、P-12;R1 审查第 1、2、6 项;「证据必须能失败」:a、d、f 带已知坏例,c 禁止同源期望,e 在源码身份变了时拒绝旧样本 |
| R12 Code Puppy 界面经约定模块取 v1 类型与 `createOpencodeClient`,不重写 renderer 的数据调用;`contract/` 对 sdk-v1 明确允许这一个运行时转出 | P-05:3 处运行时用法,转出的是同一绑定(`codepuppy-sdk-v1/src/v2/client.ts:50`);R1 审查第 5 项 |
| R13 I-04 的约定不依赖 I-05 的结果:I-05 只改翻译器内部(会话内允许、目录卡、失败码读法),约定字段 UC-09、UC-11、UC-12 不变。M3 等 I-05(a) 落地再开工,以免搬动即将删除的代码 | 接管调查第 1 行、B1、H 第 1 行(读,E) |
| R14 生产路径上不做运行时形状校验 | P-09:冻结客户端本来就不校验;没有消费方需要 |
| R15 `GET /api/health` 登记为探活回退:约定侧固定回 501 信封,不记错误日志,不改为服务 | P-03、UC-19:两个调用方都在失败后回退或从不先探它;改成服务会改变请求序列(§6 被否决的替代);R1 审查第 2 项 |

**owner 已裁决(2026-11-12)**:方案连同其中的推荐一并获批,O-1 取「引用」(按引用使用冻结客户端的类型,不复制)。下文是裁决前的原文。

- **O-1(R4)只问一件事:约定里的数据形状,是引用冻结客户端已有的类型定义,还是复制一份进来。** 意图正文写的是「去掉对上游旧客户端包…的依赖」。这里说的两个包是冻结 app 发请求用的:v1 SDK(`packages/codepuppy-sdk-v1`,上游 1.18.35 的冻结副本)和冻结 app 自带的 1.17.13 客户端。冻结界面靠它们发请求,它们与冻结界面同寿,怎么选都会留在仓里。另外,Code Puppy 自己的界面建客户端用的 `createOpencodeClient` 本来就来自 v1 SDK;约定模块原样转出它(R12),复制类型也去不掉这个运行时依赖,所以它不在这个问题里。
  - 引用(推荐):翻译器与 Code Puppy 自己的界面都不再直接碰这两个包,只经约定模块按引用使用它们的类型。不重复定义,换代时这两个包都不用动。
  - 复制:把用到的类型复制进约定,再加一个比对测试。代价是同一形状两份定义,是一条新的 K2 偏离;换来的只是字面上少了类型依赖,升级时没有任何收益。
  - 拖着不决的代价:M1–M3 不受影响(依赖方向一样);M4 里 renderer 改 import 的去向,以及 M5 加不加对 1.17.13 包的仅类型依赖,要等这个决定。

**仍是推断、没跑过的断言**

- M1–M3 前后翻译器输出逐个相等(§9 列明的两处例外除外):要靠各片在全部夹具上做差分来证明,本设计没有跑。
- 20 条只由 1.17.13 客户端发出的直通路由,冻结 app 里到底读了哪些字段:要在 M5 逐条找读点写进 `READS`,本设计只核了 `/api/agent` 与 `/api/session` 两条。
- 引擎源码身份按 `packages/cli` 的 `workspace:` 闭包算,足以覆盖采样所跑的引擎:是从入口与清单推出来的,采样配置会不会另外加载闭包外的插件,没有核。
- 按所显示请求算的指纹,能捕获按引擎字段算时捕获的全部陈旧:这是从字段一一对应推出来的。有两个缺省值会把「缺」与「空」合并(`always: save ?? []`、`metadata ?? {}`);只有引擎原地改一条待审请求时才会碰到,没有实测。指纹值本身会变,这一点 R1 审查已经实测(§4.8),不再是推断。
- 87 条服务路由里,有些可能只从 Code Puppy 没挂载的冻结组件发出,没有核实(候选见留档)。
- M2 拿掉断言后会暴露多少类型不一致、其中有几处是真实的运行时差异:未知。实测已知一例 `SessionInfo.title`,而冻结的归一函数会补标题,所以该例在运行时无害。
- M4 运行时不变:是从「转出同一绑定」推出来的,没有比对打包产物。
- I-05 尚未出方案;R13 的「互不依赖」是按它要改的代码位置推的。

| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| R1 · `205c6c969a` · 全文 | Codex gpt-6.1-sol(会话 01a1cedc,只读;独立复现 87/17/173/68/28) | 建议 FIX-THEN-MERGE。6 项全部采纳:①[Major] 直通没有响应体约定,d 只核状态码 → 修;②[Major] 调用面不完整,漏了 `GET /api/health` 等调用形式 → 修;③[Major] M3 的「全等」与指纹改制冲突 → 修;④[Minor] provider 与 project 有现用归一 → 修;⑤[Minor] `contract/` 对 SDK「仅类型」与 M4 的运行时转出矛盾 → 修;⑥[Minor] e 没有可比较的引擎身份 → 修 | ①§4.3 规则 1、5,`READS`,§4.10 d(已知坏例:删 `mode`);②P-03、UC-19、`PROBE_FALLBACK`、`GET /api/event` 进不支持、§4.10 a 三种形式与已知坏例、R15;③§4.8 序列化与行为差别、§9 例外、M3 同片迁移;④P-04 表、§4.3 规则 4、§6 K2、R6、M2;⑤§4.2 表、R4、R12、O-1 收窄;⑥P-10、§4.10 e。各项的复核命令与行号随正文 | 无;不再复审由编排器定 |

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| 把只从未挂载冻结组件发出的路由降为声明不支持 | 候选(按 P-03 的调用点,挂载与否未核实):`/api/integration/*` 5 条只来自 `dialog-connect-provider.tsx`;`GET /api/vcs/status` 只来自 `pages/layout.tsx`;`POST /api/session/:id/rename` 来自 `titlebar-tab-strip.tsx`、`message-timeline.tsx`;`POST /api/session`、`…/command`、`…/shell`、`…/interrupt` 来自 `prompt-input/submit.ts`;`GET /api/vcs/diff` 来自 `pages/session.tsx` | 要逐条拿出可达性证据;收错一条就会把用户动作变成 501;没有验收点需要它 | 某次换代让其中一条翻译起来变贵时 |
| `GET /session/:id/todo` 每次读整个会话 | 接管调查记了这一条(E `docs/architecture/2026-11-12-1662-takeover-candidates.md:55`) | 是翻译器本地的性能问题,不属于约定 | 会话变长、打开变慢有了实测时 |
| origin/alpha 的 modules.md 缺 #1662 新增的 `codepuppy-*` 冻结包 | 地图与包清单不一致 | 归 #1662 或文档治理回填 | #1662 合入时 |
| 冻结 app 探协议时,`/global/health` 一失败,`/api/health` 的 501 就会让它落到默认的 v2,走 Code Puppy 从不运行的那一支 | `utils/server-protocol.ts:28-34`(读)。只在连接时 `/global/health` 恰好失败才会碰到,可达性没有核 | 本设计不改请求序列(R15);没有实测发生过 | 出现过连上引擎后界面数据全空、日志里有 v2 支路请求时 |
| 把 `GET /api/health` 改为真服务(回 `{healthy:true, version}`) | 健康检查少一次请求;上一条的落点会变成 v1(`server-protocol.ts:33`) | 改变请求序列,不是本设计的验收点 | 上一条被证实可达时 |
