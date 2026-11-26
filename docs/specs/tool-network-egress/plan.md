---
id: PLAN-tool-network-egress
title: 对话内联网批准实施计划
summary: 分两片交付对话联网增量；本轮展开卡片、站点记忆、即时撤销和模型说明的文件、顺序、风险与证明。
kind: plan
status: active
spec: SPEC-tool-network-egress
design: DESIGN-tool-network-egress
owners: [owner]
last_reviewed: 2026-11-26
---

# PLAN-tool-network-egress｜对话内联网批准实施计划

按 #1757 的 PLAN 派发编写。冻结输入为 [规格 v2](spec.md) 与 [设计](design.md)；本文件只安排实施，不重新裁决接口或产品行为。文档影响为 architecture/decision，本轮唯一写入路径是本文件；实施、验收状态留在 Issue。

## 交付切片

| 切片 | 覆盖 | 边界与依赖 |
| --- | --- | --- |
| 一：对话决定、记住与撤销 | AC-07、AC-09、AC-10、AC-11、AC-12；设计 N1/N2/N3/N4/N6 | 闭合真实工具活动 → CONNECT → 对话决定 → 受保护站点真源 → 模型结果的路径，复用当前直连拨号。首片的卡片必须包含全部三个决定，不能留下无效的记住按钮。 |
| 二：全部批准通放与系统代理 | AC-08、AC-13；N5/N7，消费首片 N1/N2/N3/N4 | 在首片之上接入异步隧道就绪合同、公网目标检查、逐连接记录和设置聚合。该片另写本文件的实施节；不在本轮展开文件与提交计划。 |

拆分理由：第二片改变拨号就绪边界，并引入 HTTP(S)/SOCKS 上游握手及解析结果过滤；与首片的审批状态机分开落地、验证，避免同一次调试跨越两套独立时序。两片仍属于同一票、同一冻结设计，不新增配置或交付票。首片完成不能宣称 AC-08、AC-13 或整票已完成；所有档位在尚无第二片能力时继续走现有询问路径。后片集成后，再共同核对设计 §4.2 的判定顺序。

## 切片一：对话决定、记住与撤销

- 依据：[规格 v2 / AC-07、AC-09 至 AC-12](spec.md) @ `adba35744395860dcb736642d9263b5d29d1e1de`；[冻结设计 §4.1–§4.6、§4.8、§5、§6、§10](design.md) @ `4948d952f353d69764b370f91f595f24d36ee270`（#1763）；#1757 的本次 PLAN brief。继承 §10 的全部 R1 处置，不重开 ARCH-8 或无活动对话时的投递范围。读码基线同该冻结提交。
- 核对：Phase: IMPLEMENT — 25b6edee4e · Claude Opus 5.5 (orchestrator) · plan accepted for slice one: AC-07, AC-09, AC-10, AC-11, AC-12 each have a named test and a removal/known-bad control that turns red at the real entry point; files stay within the design's N1–N4/N6 surfaces plus the named same-call-chain registrars (main/index.ts, settings.tsx); no frozen decision restated or changed; slice two (AC-08, AC-13) stays a separate plan section.

以下为获核对时的实施安排；实际执行证据见偏离记录。路径缩写 `main/`、`shared/`、`preload/`、`renderer/` 相对于 `packages/ui-mac/src/`，`ui/` 表示 `renderer/codepuppy-ui/`。新文件名是本片的落点安排，其私有辅助函数不升为冻结合同。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `shared/network-egress-wire.ts`（新） | 放置 N1–N4/N6 的纯 wire 类型与严格解码，供 main、preload、renderer 和 ext 共用；N3 返回值包含完整的设置/放行摘要形状，N5 记录生产者留后片，不复制 main 判定。 |
| `shared/permission-tier.ts`（新）、`ui/composer-state.ts`、`main/codepuppy-config-injection.ts` | 搬移并消费 N1 点名的纯档位定义和 carrier 常量；不重写其它 carrier、助手规则或自动化权威。 |
| `main/network-egress-activity.ts`（新） | main 当前代活动与可信提交档位的持有者；消费 N2 增量/完整快照、现有引擎查询和自动化在册身份，提供审批收件人快照。 |
| `main/network-egress-grants.ts`、`main/network-egress-derived.ts` | 复用既有准入/授权并集；临时授权与站点授权接新审批服务，替换明确被 v2 废止的并发上限与拒绝冷却。N7 的 allow-all 专用地址检查留后片。 |
| `main/network-egress-approval.ts`（新） | main 单一审批请求簿及串行决定点；实现 N3 调用所需的 list、决定、设置、撤销和失效发布，连接站点 store、活动快照与 N6 notice。 |
| `main/network-egress-proxy.ts`、`shared/egress-denial.ts` | 在真实 CONNECT 入口连接上述服务，传递设计 §5 的原因与连接存活事实；保留本片现有拨号/隧道实现，并在建隧道前复核可变授权。 |
| `main/network-egress-sites.ts`（新）、`main/egress-grant-truth.ts`、`main/egress-grant-truth-write.ts`、`main/egress-grant-records.ts` | main 唯一站点计算，替换旧精确记录的读写绑定为 N4 文档与环境路径；复用原子写形态，不读旧记录、不做转换。写端仍不进入 sidecar 闭包。 |
| `packages/ui-mac/package.json`、`bun.lock` | 只加入设计 §4.4 已决定的直接依赖 `tldts@7.5.5`；核对 PRIVATE/通配/例外/IDNA 的实际运行结果。 |
| `main/network-egress-ipc.ts`（新）、`main/index.ts`、`preload/index.ts`、`preload/types.ts` | 公开 N3，落实产品窗口/main frame、当前代及输入校验，挂接 main 服务；preload 只转发公开 wire 与失效通知。 |
| `main/server.ts`、`main/hub-view.ts`、`main/codepuppy-sidecar-messages.ts` | 生产代理、当前 child 的 attach/receive/detach 和 N2/N6 桥接线；去掉旧 native approval 绑定。保持现有单代理及代际所有权。 |
| `main/egress-approval-dialog.ts` | 随生产接线替换删除已无消费者的旧联网 native dialog 实现；不改其它系统对话框。 |
| `packages/ext/src/hub-bridge.ts`、`packages/ext/src/network-egress.ts`（新） | 在现有进程级桥持有 N2 发送队列、跨 Location 活动和 N6 notice；复用现有传输，不另建监听通道。 |
| `packages/ext/src/plugin.ts`、`packages/ext/src/policy/index.ts`、`packages/ext/src/policy/display.ts` | 将 N2 接在真实 execute 外层及 shell 事件流，N6 接现有 context/execute.after 输出边界；取消/错误使用同一 finally 路径。 |
| `packages/ext/src/context-injection.ts`、`packages/ext/src/context-injection-inventory.snapshot.txt` | 定义、登记并生成 N6 两个 sink 的同一固定说明；只由真实有效 notice 触发。 |
| `ui/network-egress.ts`（新）、`ui/codepuppy-composer.tsx`、`renderer/sidebar/use-projects.ts`、`ui/session-timeline/session-timeline.tsx` | 绑定当前代会话身份与 N3；在现有提交分叉处及显式继续入口接 N1。覆盖首页/新会话、后续发送、编辑重发、斜杠和 `!command`；不在 adapter 猜档位。 |
| `ui/network-egress-card.tsx`（新）、`ui/session-workspace/session-composer-dock.tsx`、`ui/permission-dialog.css` | 在现有 dock 挂接真实联网卡片，消费独立 N3 feed；复用 `Button`、`RiskTag` 和审批样式。现有引擎权限 feed/决定合同不改。 |
| `ui/settings-network-egress.tsx`（新）、`ui/settings.tsx`、`ui/settings-tools.test.ts`、`ui/settings-test-runtime.tsx` | 在现有工具设置区域挂联网清单及直接撤销，复用列表/行内失败样式。独立组件避免改动已有 915 行工具策略组件的判定；后片接入放行聚合内容。 |
| `renderer/i18n/zh.ts`、`renderer/i18n/en.ts` | 为卡片、记住范围、连接到期、存储失败与撤销补产品文案；模型固定说明仍只由 ext 登记。 |
| 上述模块已有 `*.test.ts`；新模块的同名 `*.test.ts` | 用例按下文证明表和提交单元归属；旧上限/冷却/精确记住/重启撤销断言同次替换，不保留互相矛盾的两套行为。 |
| `packages/ui-mac/test-component/{session-workspace,new-session-workspace,session-timeline,session-second-send,use-projects}.cases.ts`、`preload-stub.ts` 及各自 runtime/stub | 在现有真实 Solid 宿主覆盖提交绑定、dock 与继续入口；只扩展需要的 preload 边界。 |
| `main/network-egress.engine.cases.ts`（新）、`main/engine-cases.scenario.test.ts`、`test-component/network-egress-engine-peer.ts`（新）、`test-component/codepuppy-engine.ts` | 为联网模块增加缺少的真引擎/真围栏 scenario 层；复用已有 engine sandbox、生产配置、真实 ext 与本地模型桩，不另建通用 harness。宿主只新增本模块一行。模块专用 peer 用进程 IPC 适配既有 parentPort；共享夹具传入实际代理地址，生产 profile 不增例外。 |
| `scripts/gate-files.tsv`、`scripts/process-fence-write-sites.tsv` | 仅按实际新增宿主/受托 cases、用例数或写点做机械登记；由本片规则允许的同步覆盖，不改 gate 脚本、选测、阈值或预算。新 main 写者若不在 sidecar 闭包，不虚登记为围栏内可写根。 |

**现有入口核对。** `codepuppy-composer.tsx:1835` 已冻结 `submittedPerm`，`:1877` 附近交首页 `startChat`；`use-projects.ts:447` 持有建成的 sessionID，须在此先绑定再发首条；`session-timeline.tsx:275` 有独立继续入口。编辑重发只回填 composer。adapter 的 `routes.ts:356` 与 `core/src/session/shell.ts:13` 是用户 shell 的真实路径，只读消费，不改 Core/Server 或切引擎代次。`plugin.ts:68` 的进程级 bridge 与 `hub-view.ts:501` 的 host 是跨 Location 持有点。

`main/index.ts` 是 IPC 注册者、`settings.tsx` 是工具区挂载者，二者是设计 N3 的必要同调用链文件。其余未列出的生产文件若实施时确有需要，先按派发的 Handling problems 判断；不能扩成相邻模块整理。`process-fence-profile.ts` 的 CF 能力沿用冻结设计 §2 的既有证明，本片不计划修改 profile、原生 addon 或扩大可写根。

### 顺序

1. **纯合同与站点。** 一起落 shared wire/档位纯定义、配置消费者、N4 站点计算及依赖，先验证 `siteForHost/siteContains` 的真实库结果。生产存储替换放在步骤 3 与其消费者同改。运行新 `src/shared/network-egress-wire.test.ts`、`src/main/network-egress-sites.test.ts`、现有 `src/renderer/codepuppy-ui/composer-state.test.ts`、`src/main/codepuppy-config-injection.test.ts` 的相关用例与文件。
2. **真实活动与代际桥。** 一起接 main activity、ext 队列、真实 wrapper finally、全部带 sessionID 的 shell、快照恢复及生产 host 的 N2 接收/应答；这里还不替换生产批准入口。运行新 activity/ext network 模块测试及现有 `hub-bridge.test.ts`、`policy/display.test.ts`、`codepuppy-sidecar-messages.test.ts`、`hub-view.test.ts`。
3. **审批服务与真实 CONNECT。** 一起替换 grants 编排和 N4 生产原子读写、实现 approval 服务/IPC/preload、生产 server/host 批准接线并移除 native 实现；旧记录断言随消费者同次替换。加入新 approval/IPC 模块测试与真实代理批准用例，运行 `egress-grant-truth.test.ts`、`network-egress-grants.test.ts`、`network-egress-proxy.test.ts`、`shared/egress-denial.test.ts` 及新模块文件。先在 Electron-free 服务层证明并发决定、晚到允许、超时、不可用和授权覆盖，再把相同事实交给 renderer。
4. **对话卡片和设置。** 同一提交闭合 feed、dock 三个决定、全窗口同步、重绑、工具设置撤销及各提交/继续入口的 N1 绑定；运行新 `ui/network-egress.test.ts`、`ui/network-egress-card.test.ts`、已有 `ui/settings-tools.test.ts`，并只运行受改动的 workspace/new-session/timeline 宿主相关用例。卡片与设置都调用生产服务的同一 API，不把界面 stub 的返回值当联网验据。
5. **模型结果与登记。** 接 notice → 原错误/成功文本结果、后续 context，生成注入库存；运行 `packages/ext` 的 `src/network-egress.test.ts`、`src/policy/display.test.ts`、`src/context-injection.test.ts`。从该包运行 `bun scripts/context-injection-inventory.ts --write`，再 `--check`；检查实际库存 diff，不手改字节统计。
6. **真引擎、真围栏与对照。** 加联网模块 scenario cases 并接现有宿主；按下文执行一次本片正反臂。记录每条 AC 的结果、PID、代理/模型/DOM 证据；仅机械同步必要登记。之后跑一次受影响的较宽相关集、包检查和文档检查，再提交本片证据及任何计划偏离。

每个单元实现与其测试同提交；若发现需要按缺陷处理的现有 bug，遵循 red-first 单独先提交复现，不把普通功能测试伪报为回归修复。迭代只跑 `-t` 指定用例，每步结束对改变行为的测试文件完整跑一次，较宽集合只在本片返回前跑一次。真实引擎场景不在每步反复运行。

### 风险

- **活动漏报或清错。** 最先覆盖 Code Mode 共 callID 的不同 invocation、子会话、跨 Location、取消与拒绝路径、用户 `!command` 和后台 shell；断序/拒收/超时/换代恢复按设计 §4.2 的同队列合同测。不得由测试直接捏造“正在运行”的集合来代替真引擎臂。
- **并发与撤销穿透。** 在服务/代理层交错排列同目标连接、站点覆盖其它 pending、不同连接截止时间、相反点击、过期后允许、撤销后的旧 requestID 与拨号前复核；控制时钟的快速用例覆盖状态分支，真实 45 秒无人决定仅在下述场景跑一次。
- **结果说明丢失或串会话。** 在丢弃代理正文的客户端、后台 shell 返回、leave 屏障、allowed 清理和换代上测原始模型请求；普通无 notice 回合及 Windows 分支必须没有说明。按设计 §10 Major-2 处理，不提前结束正在执行的工具。
- **站点过宽或写错地方。** PSL 用设计 §2 的真实样本及其来源；库运行结果、环境隔离和读坏/写失败都在模块层验证。真围栏用宽项目根与别名覆盖攻击，正反臂只改本次隔离临时数据；不改真实用户记录。
- **无窗口证据边界。** 所有本片自动化使用 Bun/Node、happy-dom 和本地测试端点，不启动应用、Electron 或窗口。真实进程桥在测试宿主仅替换传输适配为进程 IPC，消息由生产 build/parse 和真实 ext 生命周期产生；批准仍走生产 main 服务。不得声称这已证明 Electron 原生 IPC 或 Windows 安装包实机展示，后者由编排器的发布验收核对。
- **登记与文档。** 只同步本片实际改变的事实。PLAN 派发仅允许本文件，因此本轮不改文档索引；基线索引已陈旧（冻结设计末尾亦有记录），不扩成文档治理。实施若需要同步受保护历史设计或其它冻结文件，返回其输入缺口，不自行改写。

### 证明

下列用例名与命令是实施目标；实际创建/执行结果见偏离记录。`U = packages/ui-mac`，`E = packages/ext`；表内命令均在对应包目录运行。新增用例进入模块测试文件；真实引擎、多步重启和真实计时只进入 `.scenario.test.ts` 所承载的层，日常 PR 不执行这一层。

PSL 样本来源继承设计 §2：2026-11-26 的原始清单 SHA-256 `9015c5fa9b4b4953dbd47b9f7811ed1b3a577aee627f50b202dc9b491250a6c8` 中的 PRIVATE `github.io`、`s3.amazonaws.com` 及 `*.ck` / `!www.ck`；用随包库判定这些真实条目，不编造另一份平台后缀格式。引擎模型请求从现有 `scriptedModel().requests` 捕获；存储 fixture 从生产序列化器产生。

| AC | 测试/证据与相关命令 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-07 | U 的 `network-egress-approval.test.ts`、`network-egress-proxy.test.ts`：真实 CONNECT 的允许/拒绝/无人决定原因、合并/副本/晚到处理；`ui/network-egress-card.test.ts`：真实 Solid 组件的地址、unknown、点击、到期状态和两个会话。命令：`bun test src/main/network-egress-approval.test.ts src/main/network-egress-proxy.test.ts src/renderer/codepuppy-ui/network-egress-card.test.ts`。真实路径见下文 scenario `对话联网批准` 的 ask、双会话和卡片移除臂。 | 删除生产 CONNECT→请求簿或 feed→dock 任一接线，真实请求没有对应 DOM 卡片；允许后同命令重试收不到靶站字节，拒绝/到期缺少结构化原因。卡片移除臂由相同“有卡片”判据确认失败；不以 service 被调用代替可见卡片。 |
| AC-09 | U 新 `network-egress-sites.test.ts` 的表驱动 `站点范围与托管租户隔离`，以及改后的 `egress-grant-truth.test.ts`：`a.example.com`、兄弟/主域不同端口、另一站点、`github.io`、S3、PSL 通配/例外与 IDNA；命令：`bun test src/main/network-egress-sites.test.ts src/main/egress-grant-truth.test.ts`。scenario `对话联网批准` 记住后销毁并重建 main 服务和真引擎，沿用同一隔离状态根，重新连接并接收靶站字节。 | 精确 host:port 的旧行为使兄弟/另端口重新发卡；只用 ICANN 会误放另一租户；不持久化或未重读则重启臂发卡。各反向目标也必须实际收到 CONNECT，不能把没有请求当作未询问。 |
| AC-10 | U `egress-grant-truth.test.ts` 继续检查 main-only 闭包；scenario `对话联网批准` 在初始化后、记住前后比较项目树/文件哈希，真 shell 与写工具攻击隔离的 sites 文件、临时文件及父路径。生产 CF 臂写入失败且字节不变，去 CF 的对照在同一可写宽根下确实改写成功。命令：`bun test src/main/engine-cases.scenario.test.ts -t '对话联网批准'`。 | 改成项目存储会改变快照；若围栏未覆盖真源/别名，生产臂字节发生改变。去保护臂必须由同一拒写判据检出坏结果，不能只断言 profile 文本。 |
| AC-11 | U 已有 `ui/settings-tools.test.ts` 增 `撤销站点后下一条连接重新询问` 的真实渲染点击：服务返回的列表变化、失败展示和无保存动作；新 approval 测试交错撤销与待拨号/迟到决定。命令：`bun test src/renderer/codepuppy-ui/settings-tools.test.ts src/main/network-egress-approval.test.ts`。scenario `对话联网批准` 通过同一设置 API 撤销，保持 main/引擎 PID 不变，下一次真实 CONNECT 等卡片。 | 只删除磁盘而保留内存、或复用旧授权/请求ID，会让下一次连接直接穿过；只改 UI 列表也不能满足真实 CONNECT 的等待判据。 |
| AC-12 | E `context-injection.test.ts` 的登记/预算/库存断言；`network-egress.test.ts` 与 `policy/display.test.ts` 从生产 notice 接收、wrapper 和输出边界断言失败 message/成功 content、原 metadata、有效状态消费与会话隔离。命令：`bun test src/network-egress.test.ts src/policy/display.test.ts src/context-injection.test.ts`，另 `bun scripts/context-injection-inventory.ts --check`。scenario 从本地模型桩实际收到的 tool/system 消息核对说明。 | 缺登记使库存检查失败；只登记而没接结果/context 时，模型请求字节中没有说明。去掉注入调用的临时对照由同一模型请求断言判红；无 notice/allowed 后的反例防止静态无条件注入假通过。 |

**真实场景的最小接法与一次性对照。** 扩展现有 `engine-cases.scenario.test.ts` 一行，目标为 `src/main/network-egress.engine.cases.ts`，匹配名 `对话联网批准`。复用 `test-component/engine-sandbox.ts`、`codepuppy-engine.ts` 的配置/真实 ext/本地 scripted model，以及 `engine-config-fence.engine.cases.ts` 的生产围栏规划与 apply 顺序。宿主 main 服务/策略代理在围栏外，真实引擎和工具在隔离子进程围栏内；记录两边 PID、apply 结果、CONNECT/决定/靶站字节及模型请求。测试域名仍通过生产 authority/站点计算；仅在已有拨号依赖边界把受控测试目标送往本地回显服务，不替换批准判定或 proxy server。

DOM 臂编译生产 dock/联网卡片，用实际 main 服务的 N3 API 适配 preload 传输；双会话分别绑定同一 requestID 并断言两棵 DOM。现有 `PermissionDialog.test.ts` 与 `settings-tools.test.ts` 的 vite + happy-dom 是复用依据，不启动浏览器。shell 事件、取消、后台移交不得手工模拟 N2 来充当引擎证明。

首次实施验据运行上述过滤的 scenario **一次**，包括真实 45 秒无人决定、单/双会话、`!command`/后台 shell、记住后重建和撤销不重启。卡片通路移除、CF 移除、模型注入移除是一次性临时对照：改动只在隔离临时副本中，使用同一断言得红，保留命令/退出码/输出，不加产品开关，不永久保留票级变异框架。正臂必须全绿，对照必须指出预期的缺失；不得把任意崩溃计为对照有效。永久 suite 只保留模块行为与最低限度真实接线场景。之后只有改动、失败或未解决疑点才重跑相关部分。

**本片返回前的较宽相关集。** 用 `rg -n 'network-egress|egress-grant|hub-bridge|context-injection|composer-state|permission-tier'` 在实际变更导出的消费者测试中找 mock、枚举与钉住行为。已确认候选是 U 的 `network-egress-derived.test.ts`、`network-egress-registry.test.ts`、`network-egress-disclosure.test.ts`、`hub-view.test.ts`、`codepuppy-sidecar-messages.test.ts`、`process-fence-write-sites.test.ts`、`gate-file-registry.test.ts`、`ui/surface-seam-contract.test.ts`、`ui/settings-surface-ratchet.test.ts`，E 的 `plugin-host.test.ts`、`plugin-process-singleton.test.ts`、`plugin-reload-wiring.test.ts`。只对确实受改动的文件选一次并在回执列出实际命令；已于步骤中完整跑过且之后未改的文件不重复。`network-egress-fence.test.ts` 仅在代理/profile 接口确有影响时补相关臂，不扩跑其它围栏功能。

U/E 各运行 `bun typecheck`，仅处理本片造成的问题；若包已有适用的 lint 命令，按实际文件运行。U 提交前运行 `bun test src/main/old-name-scan.test.ts`；文档运行 `python3 scripts/check-doc-links.py docs/specs/tool-network-egress/plan.md`、所属 profile 的只读 `check-docs-contract --changed-since origin/alpha` 和 `git diff --check`。不得运行整包测试、全项目、`bin/check` 或 `gate run`。测试前若已有 gate 活动，限制本片测试并发；本轮 PLAN 不运行以上尚未存在的行为用例。

### 偏离记录

2026-11-26 r1：步骤 1 在依赖安装处阻塞，尚未产生实施代码。12:17 +0800 开始，先在 `packages/ui-mac` 运行 `bun test src/renderer/codepuppy-ui/composer-state.test.ts src/main/codepuppy-config-injection.test.ts`，退出 0，45 pass / 0 fail。随后同目录执行 `bun add --exact tldts@7.6.0`，退出 1：`No version matching "7.6.0" found for specifier "tldts" (blocked by minimum-release-age: 259200 seconds)`。仓库 `bunfig.toml:4` 为 `minimumReleaseAge = 259200`，`:5` 的既有豁免列表不含 tldts；安装失败后 `git status --short` 为空，manifest/lock 未改动。

本次只补入编排器核对原文和上述阻塞证据，步骤 1 未完成。需要编排器明确允许为已批准的固定依赖进行本次安装的发布年龄豁免，或由设计阶段提供符合现有安装规则的冻结依赖版本；实施者不降低筛选值、不改仓库安装规则、不自行换版。N4 是卡片实际记住范围及站点真源的前置，不能用手写 PSL 或无效按钮绕过。其余步骤与一次性 scenario/对照均未运行，保留其运行授权。

2026-11-26 r2：tldts 7.5.5 instead of 7.6.0: repo minimumReleaseAge; orchestrator ruling 2026-11-26。依赖精确安装成功，未添加豁免；设计 §4.4 仅改版本并于 §10 留一行裁决。步骤 1 的实际库样本结果由同名站点测试核对。

步骤 1 验据（2026-11-26 r2）：在 `packages/ui-mac` 执行 `bun test src/shared/network-egress-wire.test.ts src/main/network-egress-sites.test.ts src/renderer/codepuppy-ui/composer-state.test.ts src/main/codepuppy-config-injection.test.ts src/main/old-name-scan.test.ts`，退出 0，57 pass / 0 fail。PRIVATE、PSL 通配/例外、IDNA 全部通过；7.5.5 的直接运行结果符合设计 §2，r1 安装阻塞解除。

步骤 2 验据：U 执行 `bun test src/main/network-egress-activity.test.ts src/main/codepuppy-sidecar-messages.test.ts src/main/hub-view.test.ts src/main/old-name-scan.test.ts`，退出 0，45 pass / 0 fail；E 执行 `bun test src/network-egress.test.ts src/hub-bridge.test.ts src/policy/display.test.ts`，退出 0，22 pass / 0 fail。新增同调用链文件 `main/codepuppy-unattended.ts` 仅给既有 main 在册名单增加只读 `has(sessionID)`，供 N1 排除自动化，避免从工具 metadata 猜身份。

步骤 3 验据：U 执行 `bun test src/main/egress-grant-truth.test.ts src/main/network-egress-grants.test.ts src/main/network-egress-approval.test.ts src/main/network-egress-ipc.test.ts src/main/network-egress-proxy.test.ts src/shared/egress-denial.test.ts src/main/old-name-scan.test.ts`，退出 0，58 pass / 0 fail。真实 CONNECT 经生产审批服务放行后收到回显字节；同一拨号前复核判据拒绝已撤销授权。旧上限/冷却和精确持久化断言已按新行为替换。生产服务由 `main/index.ts` 在 fork 前初始化，`server.ts` 只消费既有代理默认授权出口，避免在代理启动与 IPC 各建一份批准状态。

步骤 4 验据：U 执行 `bun test --max-concurrency 2 src/renderer/codepuppy-ui/network-egress.test.ts src/renderer/codepuppy-ui/network-egress-card.test.ts src/renderer/codepuppy-ui/settings-tools.test.ts src/main/old-name-scan.test.ts`，退出 0，27 pass / 0 fail。`src/renderer/subprocess-cases.test.ts -t '会话内连发三条|use-projects|新对话页工作区选择器'` 的前两宿主通过（内部 11、17 条）；补齐新对话的 N3 夹具后仅重跑该宿主，退出 0，1 pass（内部 64 条）。真实生产入口的定向用例另验证首页 1、会话命令 1、继续 4 条；会话命令在 main 应答前保持零请求。

步骤 4 的同调用链补充为 `test-component/use-projects.cases.ts`、`session-second-send.cases.ts`、`preload-stub.ts`：前两者才是首页真实 startChat 与会话真实 composer 的现有行为宿主，后者必须分类新增 preload 键。renderer 复用现有 `codepuppy-app/src/utils/server-scope.ts` 的纯判定处理本地 sidecar 身份，不复制其映射、不改冻结应用。包级 `bun typecheck`：U/E 均退出 0；U 检查中暴露的本片宿主类型遗漏已修正为消费 `CodePuppySidecarHost` 原类型。

步骤 4 检查边界：时间线与 workspace 两文件合跑曾为 25 pass / 1 fail（时间线宿主 5 秒超时）。按失败处理，只对该宿主在隔离副本的冻结基线 `4948d952f3` 比较：初次副本缺少包级 Babel 依赖，补齐同版本包级依赖目录后，基线单文件 12 pass / 0 fail（6.11 s）；当前单文件相同命令 12 pass / 0 fail（5.77 s）。命令为 `bun test --max-concurrency 2 src/renderer/codepuppy-ui/session-timeline/session-timeline.test.ts`；没有放宽阈值或改宿主。合跑超时仍作为运行组合观察交编排器，不声称已修复。一次测试命令曾误从根目录执行并被既有 root guard 拦下（未执行测试）；此后测试均在包目录执行。


步骤 5 验据：E `bun test --max-concurrency 2 src/network-egress.test.ts src/policy/display.test.ts src/context-injection.test.ts`，退出 0，56 pass / 0 fail；`bun scripts/context-injection-inventory.ts --write` 后 `--check` 退出 0；`bun typecheck` 退出 0。U 提交前 old-name-scan 10 pass / 0 fail。新测试证明 notice 经 leave 屏障进入错误 message/成功 content，保留 cause/metadata、同 callID 的 invocation 隔离、waiting 的后台上下文、allowed 清除、终态消费及换代清理。现有上下文钩子登记数量断言由 2 改为 3（增加按事实注入的 context 回调，原四路共用组装回调仍居末尾），库存机械同步两个固定 ID。迭代中发现 Tool.Error 的 Schema 构造会过滤 metadata 的 Symbol；因此错误关联放在私有 WeakMap，成功结果用不可序列化 Symbol 穿过 Core 的浅拷贝，均不增加公共 metadata 字段。普通 ENOTFOUND 无 notice 时不附保护说明。


步骤 6 验据（2026-11-26 r2）：

| 运行 | 命令（在 U，控制臂在各自隔离副本的 U） | 退出码与输出 |
| --- | --- | --- |
| 全部正臂 | `bun test --max-concurrency 2 src/main/engine-cases.scenario.test.ts -t '对话联网批准'` | 首次夹具失败后，仅修复该故障再跑：退出 0，宿主 1 pass / 0 fail / 7 filtered；宿主四个断言核对子进程退出 0、6 pass、0 fail、1 file；51.62 s。包含实际 45 s 无人决定、单/双会话、允许/拒绝、记住/重建/撤销、两种 shell 与后台 context。日志 `/tmp/egress-scenario-positive-repaired.log`。 |
| 卡片移除 | `bun test --max-concurrency 2 ./src/main/network-egress.engine.cases.ts -t 'AC-07'` | 退出 1，0 pass / 1 fail / 5 filtered，19.21 s；同一 `click` 判据报 `missing conversation decision button`，实际 main 已有 waiting notice，无 DOM 按钮；没有执行到 45 s 臂。main/引擎 PID 2259/2266。日志 `/tmp/egress-control-card-cleanup.log`。 |
| CF 移除 | `bun test --max-concurrency 2 ./src/main/network-egress.engine.cases.ts -t 'AC-10'` | 退出 1，0 pass / 1 fail / 5 filtered，3.87 s；`protected sites bytes` 的原记录被真实 shell 改成 `CORRUPTED`。仅隔离副本 `renderConfigFence(configFence)` 改为 `renderConfigFence([])`，C1 仍在。main/引擎 PID 1110/1117，实际 profile 4566 B。日志 `/tmp/egress-control-fence.log`。 |
| 注入移除 | `bun test --max-concurrency 2 ./src/main/network-egress.engine.cases.ts -t 'AC-12'` | 退出 1，0 pass / 1 fail / 5 filtered，2.96 s；`actual model tool result must contain network notice` 变红；main 有 waiting/denied，模型只收到 curl 403 与 exit 22，没有固定说明。main/引擎 PID 1449/1451，实际 profile 9007 B。日志 `/tmp/egress-control-notice.log`。 |
| 产物/清理补证 | `bun test --max-concurrency 2 ./src/main/network-egress.engine.cases.ts -t 'AC-10|AC-12'` | 退出 0，2 pass / 0 fail / 4 filtered，57 expect，3.57 s；main/引擎 PID 2260/2265，profile 9007 B；生产 CF 下记录原样，模型收到说明。未重跑实际 45 s 臂。日志 `/tmp/egress-scenario-artifact.log`。 |

控制副本由 `/tmp/egress-create-controls.py` 复制当前 U/ext 源码、共享已安装依赖后仅做三处具名移除，位于本机临时 `egress-controls-9anaf53p/{card,fence,notice}`；没有产品开关或永久变异框架。检查了 `node_modules/.cache/egress-outside-{2259,1110,1449,2260}/evidence.json`：分别保留 main/引擎 PID、真实代理事件、N6 事实、模型实际请求及 sites 字节。注入对照有 waiting/denied 且模型没有说明，正臂有说明；CF 对照字节为 CORRUPTED，正臂仍是生产序列化的空站点文档。模型桩也通过同一个 CONNECT 端口，生产围栏的唯一网络出口没有为夹具放宽。

步骤 6 偏离/迭代：增加模块专用 `test-component/network-egress-engine-peer.ts`（真实引擎与 main 服务必须分进程，且不能启动 Electron）；共享 `codepuppy-engine.ts` 仅透传实际 `egressProxy` 给既有 bootstrap，`network-egress-test-runtime.tsx` 导出已有设置组件供同一真引擎撤销臂使用。初次 scenario 的 happy-dom 替换了全局 HTTP Response，Bun 模型桩无法返回它，退出 1；修复夹具恢复原生 fetch/Request/Response/Headers 后上表六臂通过，不计初次崩溃为任何行为证据。初次卡片对照主断言已正确变红，但提前失败后的 permission 轮询遇到 service_stopping（额外 1 error）；夹具现在在停止引擎前收齐在途回合，只复核该对照，最终无额外 error。正臂宿主成功时不转印子输出，原临时产物又会随测试隔离根清理，因此把产物保存移到既有围栏外 cache 根；仅对不含 45 s 的 AC-10/12 补证并实际检查上述 JSON。两次未带 `./` 的 cases 控制命令只得到 Bun 的无匹配提示，未启动用例，不作红臂证据。

返回前较宽相关集：U `bun test --max-concurrency 2 src/main/network-egress-derived.test.ts src/main/network-egress-registry.test.ts src/main/network-egress-disclosure.test.ts src/main/process-fence-write-sites.test.ts src/main/gate-file-registry.test.ts src/renderer/codepuppy-ui/surface-seam-contract.test.ts src/renderer/codepuppy-ui/settings-surface-ratchet.test.ts src/renderer/i18n/locale-regression.test.ts`，退出 0，95 pass / 0 fail；E `bun test --max-concurrency 2 src/plugin-host.test.ts src/plugin-process-singleton.test.ts src/plugin-reload-wiring.test.ts`，退出 0，54 pass / 0 fail。`hub-view.test.ts`、`codepuppy-sidecar-messages.test.ts` 已在步骤 2 全文件跑过且之后未改，不重复。两包 `bun typecheck` 均退出 0；没有适用的包级 lint 命令。scenario 表的 gate-files 下界随实际 7→8 行机械同步，没有改 gate 选测或逻辑。


最终检查：U 提交前 `bun test --max-concurrency 2 src/main/old-name-scan.test.ts` 退出 0，10 pass / 0 fail；`python3 scripts/check-doc-links.py docs/specs/tool-network-egress/plan.md docs/specs/tool-network-egress/design.md` 与 `git diff --check`。所属 profile 的 `check-docs-contract --changed-since origin/alpha --format json` 退出 1，为 70 errors / 252 warnings（基线 69 / 253）；逐条比较仅设计文件既有的 `ref.unknown-id`（设计第 23 行既有的未登记意图引用） 因本轮获准版本编辑而由 warning 升为 error，没有新增语义问题。既有 docs/README.md 索引、旧链接及该意图登记问题交编排器，不扩修。r2 从 12:21 至 13:25 +0800 约 64 分钟，覆盖既定六步；未执行全包、全套或 gate。


### r3：代码审查 R1 修正证据

2026-11-26，按编排器 r3 的四项 Minor 和已接受的 OPTIONAL 修正；代码审查来源为 Claude Opus 5.5（R1，MERGE）。沿用切片一范围，没有 rebase、没有展开切片二或增加审查轮次。文档影响仅为本节的修正实现与验证记录。

| R1 项 | 最小修正及回归判据 |
| --- | --- |
| 1 已决卡片积累 | `listApprovals` 在既有串行队列里交付已决快照一次并释放对应请求/回执；退休前重复决定仍取原回执，退休后身份为 not-found。dock 只渲染 pending/connection-expired；保存失败提示移到同一 dock 的单个行内反馈，卡片消失后仍可见。主服务回归核对读取后清空、旧 ID 退休及新卡不带历史；真实 Solid 双会话回归核对两个副本都移除；原保存失败断言继续通过。 |
| 2 上报失败挡住发送 | `setSessionNetworkTier` 对 unavailable 与异常只写 console.warn 后返回；调用方继续原发送路径。Vite 编译的真实 renderer 用例分别使 main 上报返回 unavailable、IPC reject，断言 helper 均完成、日志各一次且 main tier 仍为 unknown。已有首页、会话命令、继续入口同时核对正常绑定顺序。 |
| 3 准入失败误发等待说明 | `admitUserEgressGrant` 拒绝时直接返回 not-asked，不产生 N6 notice；回环和私网用例在真实活动集合下断言卡片与 notice 均为空。代理/IPC 相关回归核对既有拒绝路径继续工作。 |
| 4 平台根覆盖 PRIVATE 租户 | domain 匹配除域边界外，还要求目标的完整 PSL registrable domain 等于被记住的 site.value；host 精确匹配保持原样。用真实 tldts 7.5.5 核对 sts.amazonaws.com → amazonaws.com，但 victim.s3.amazonaws.com → victim.s3.amazonaws.com，后者不被前者授权。 |
| OPTIONAL | `approvalFixture` 改为测试文件私有；没有引入其它可选工作。 |

先红：提交 `8e102cd5b7` 仅含回归测试（含被替换的旧已决卡片断言），未改生产代码。U `bun test --max-concurrency 2 src/main/network-egress-approval.test.ts src/main/network-egress-sites.test.ts -t '已决结果读取|准入失败|记住平台根'` 退出 1：0 pass / 3 fail；`bun test --max-concurrency 2 src/renderer/codepuppy-ui/network-egress-card.test.ts -t '档位上报失败|真实 main 批准'` 退出 1：0 pass / 2 fail。分别命中未清空已决列表、准入拒绝仍有 notice、PRIVATE 租户被覆盖、双会话已决 DOM 未移除及档位失败仍抛错。日志为 `/tmp/egress-r3-red-main.log`、`/tmp/egress-r3-red-ui.log`；修复提交未修改这些测试。

转绿及步骤末：U `bun test --max-concurrency 2 src/main/network-egress-approval.test.ts src/main/network-egress-sites.test.ts src/renderer/codepuppy-ui/network-egress-card.test.ts src/renderer/codepuppy-ui/network-egress.test.ts` 退出 0，14 pass / 0 fail；随后将请求退休也纳入既有串行队列，只复核受影响的 `network-egress-approval.test.ts`、`network-egress-card.test.ts`，退出 0，11 pass / 0 fail。日志 `/tmp/egress-r3-green.log`、`/tmp/egress-r3-retirement.log`。

一次较宽相关集：U `bun test --max-concurrency 2 src/main/network-egress-ipc.test.ts src/main/network-egress-proxy.test.ts src/renderer/codepuppy-ui/settings-tools.test.ts` 退出 0，39 pass / 0 fail。三个发送入口分别执行 `bun test --max-concurrency 2 ./test-component/use-projects.cases.ts -t '首页斜杠命令的 session.command'`（1 pass）、`./test-component/session-second-send.cases.ts -t '会话内 /review'`（1 pass）、`./test-component/session-timeline.cases.ts -t '全部批准下停止后切到'`（4 pass），均退出 0。`bun typecheck` 从 U 执行通过；提交前 `bun test --max-concurrency 2 src/main/old-name-scan.test.ts` 退出 0，10 pass；链接 4 条通过、`git diff --check` 通过。文档检查仍为 70 errors / 252 warnings，与 r2 检查无新增语义问题；报告对设计既有未登记意图的说明改为设计第 23 行定位，避免计划重复引用同一未知 ID。没有重跑 scenario/实际 45 s/对照臂，没有全包、bin/check 或 gate。


### r4：ship gate 三项新红的处置证据

输入为编排器提供的 `1757-gate-fail.log`（2026-11-26 review 缓存）。保留 ship 已生成的 merge `2339b9daf3`，没有 rebase 或 push。仅修本轮两处产品边界及具名包用例的同步点，不改 gate/known-fails 或任何断言和阈值。

基线：`git worktree add --detach /tmp/egress-r4-alpha-20261126 origin/alpha`，实际 HEAD `a586b16fcac32702d2d14cda898c5a32bb71d02c`；独立 `bun install --frozen-lockfile --ignore-scripts` 安装成功，未借用支线 workspace 模块。基线 U `bun test --max-concurrency 2 src/main/engine-cases.test.ts -t 'desktop package lifecycle|无人值守运行的真实入口证据'` 退出 0，2 pass / 0 fail（内部包 7、无人值守 16）。完成后已执行 `git worktree remove /tmp/egress-r4-alpha-20261126`，目录与登记均移除。基线日志 `/tmp/egress-r4-alpha-engines.log`。

| 失败 | 原因与修正 | 红/绿证据 |
| --- | --- | --- |
| preload 装载路径 | 产品代码错误：新增直接 shared 类型 import 越过 preload 的既有 import 白名单。事件类型改用既有的 `Parameters<typeof listener>[0]` 模式，经 ElectronAPI 类型推导；单一 exposeInMainWorld 和 N3 IPC 转发保持原状。测试未改。 | 原 gate 在 ext-security-boundaries:134 判红；U `bun test --max-concurrency 2 src/main/ext-security-boundaries.test.ts` 退出 0，8 pass。 |
| 无人值守 metadata | 产品代码错误：ext 的新增运行时相对导入 `schema/src/tool` 被本地插件源码热加载器递归加入重载图，invalidate 了宿主共享 schema，使 Tool.Error 的类身份分裂，SDK 转换后丢掉拒绝 metadata。改为宿主提供的 `@opencode/plugin/promise/tool` Error 构造器；相对 schema 引用只保留 type，原生 Error 显式使用 globalThis.Error。没有改无人值守规则、N6 文案或断言。 | 支线修复前同基线命令为 1 pass / 1 fail：无人值守内部 13 pass / 3 fail，正是 AC-04、U-3、投影夹具；关掉 wrapper/非围栏网络绑定的有界诊断均未消除错误，已恢复这些诊断改动。仅修共享构造器后，`bun test --max-concurrency 2 ./src/main/unattended-run.engine.cases.ts` 退出 0，16 pass / 0 fail。红日志 `/tmp/egress-r4-branch-red.log`，绿日志 `/tmp/egress-r4-unattended-green.log`。 |
| 包生命周期 | 夹具同步缺口：原 action 在 main 安装返回后立即断言 wire 已 post；前一项连接器 refresh 可已 detach。既有 reload-coordinator 的合同允许此时入队，在 attach 时重发。仅在该已有断言前用现有 until 等待同一个 request 送达，保留原 global/非 force 断言、15 秒上界、重载报告与真实 connector 移除检查。没有给产品路径增加等待，也未将业务断言改成另一种行为。 | 原 gate 为内部 6 pass / 1 fail（line 77）；本地基线和支线修复前包宿主均曾通过，故不声称原 gate 当时已捕获 detach。隔离临时用例明确 detach 后，安装成功但 `posted:[]`，同一断言红（0 pass / 1 fail）；重新 attach 后实际发出 generation 1 的 global request，同断言及 connector 移除通过（1 pass）。延后 attach 到下一 microtask 的临时扩展臂通过了原送达断言，但其后 removal reload reported 未收齐（0 pass / 1 fail），不计为完整绿证据；没有据此扩大修复范围。实际包宿主修正后 1 pass（内部 7），日志 `/tmp/egress-r4-package-green.log`；临时机制证据 `/tmp/egress-r4-wire-control.log`、`/tmp/egress-r4-wire-reattach.log`、`/tmp/egress-r4-wire-await.log`。 |

完整具名宿主文件：U `bun test --max-concurrency 2 src/main/engine-cases.test.ts` 退出 0，26 pass / 0 fail（69.27 s）；后续只有包夹具同步改动，按受影响文件重跑包行（完整内部 7 条），其它 25 行没有再次运行。没有修改宿主表或计数。日志 `/tmp/egress-r4-engine-all.log`。

相关集：E `bun test --max-concurrency 2 src/network-egress.test.ts src/policy/display.test.ts src/hub-bridge.test.ts src/context-injection.test.ts src/plugin-host.test.ts src/plugin-process-singleton.test.ts src/plugin-reload-wiring.test.ts` 退出 0，123 pass / 0 fail。U 执行 activity、approval、sites、IPC、proxy、derived、registry、disclosure、write-sites、gate-file-registry、renderer network feed/card、settings-tools、surface-seam/settings-ratchet、locale、old-name 共 17 个具名文件：159 pass / 1 fail，唯一失败是 network-egress-card.test.ts:15 与 locale-regression.test.ts:227 在同一进程重复注册 happy-dom（合并了此前分开的测试组）。仅把该 locale 文件单独进程验证，`bun test --max-concurrency 2 src/renderer/i18n/locale-regression.test.ts` 为 10 pass / 0 fail；未改夹具或断言。记录为命令分组问题，不归因产品，不作为第三项根因。日志 `/tmp/egress-r4-ui-related.log`、`/tmp/egress-r4-locale-alone.log`。

两包 `bun typecheck` 退出 0；三个发送入口依 r3 同名命令分别 1、1、4 pass，提交前旧名扫描 10 pass，链接 4 条和 diff 检查通过。文档检查仍为 70 errors / 252 warnings，与 r3 逐条比较新增 0、消失 0。临时端口对照最初的 import/mock 路径问题均在 /tmp 内修正，未计为行为红证据；所有产品诊断输出均已撤掉。没有执行 gate、bin/check、整包套件或重复 45 s scenario。

### r5：gate-files 精确计数同步

输入为编排器提供的 `1757-gate-fail2.log`。四项错误都是登记数未随切片一的测试增删同步；仅修改 `scripts/gate-files.tsv` 的第一列，不改测试、委派、精确比较规则、平台条件或 gate 实现。保留 ship 的 merge，不 rebase。

| 登记文件（相对各包） | 原数 → 实测 | 已有变化的依据 |
| --- | --- | --- |
| E `src/context-injection.test.ts` | 43 → 44 | 新增 N6 notice 的 system/result 共用登记说明用例。 |
| U `src/main/network-egress-proxy.test.ts` | 23 → 24 | 新增真实 CONNECT 经对话决定、撤销后复核的用例。 |
| U `src/main/network-egress-grants.test.ts` | 18 → 5 | 保留四条地址准入，新增消费 main 服务的授权并集用例；原批准编排随步骤 3 转到 `network-egress-approval.test.ts`，v2 已废止的冷却/上限断言一并替换。本轮没有删除测试或降低判定方式。 |
| U `src/main/egress-grant-truth.test.ts` | 11 → 7 | 保留三条围栏路径判据；旧精确记录测试随步骤 3 替换为三条站点记录/原子写表驱动用例，加一条 main 写端闭包判据。表内仍验证坏记录、坏时间、重复站点及 rename 失败。 |

本轮独立测量：U `bun test --max-concurrency 2 --reporter=junit --reporter-outfile=/tmp/egress-r5-measured/ui-mac.integration.xml src/main/network-egress-grants.test.ts src/main/egress-grant-truth.test.ts src/main/network-egress-proxy.test.ts` 退出 0，36 pass / 0 fail；E `bun test --max-concurrency 2 --reporter=junit --reporter-outfile=/tmp/egress-r5-measured/ext.integration.xml src/context-injection.test.ts` 退出 0，44 pass / 0 fail。`python3 scripts/junit-file-counts.py /tmp/egress-r5-measured` 实读分别为 5、7、24、44，与原 gate 日志的实测一致。原 gate 的 JUnit 已清理；按 r5 明确授权直接运行登记步骤，日志 `/tmp/egress-r5-registry-direct.log`。

登记步骤：`CODEPUPPY_TEST_LAYERS='fast integration' bash scripts/assert-gate-files.sh` 完成，退出 2（脚本既有的非阻断条件未验证档）。实际汇总：`303 个闸门文件在位且真的跑过(条数与登记精确一致);另 1 个条件闸的保证本次未验证`；条件项为 `process-fence-extension-packaged.test.ts`，未设置签名验收条件，自报 0 与标注相符；10 个 scenario 登记在本次范围外。四项修正分别实跑 44、24、5、7 pass，登记簿自身用例 25 pass，提交前旧名扫描 10 pass，均由此命令实际运行且通过。未执行 gate 或 bin/check。

文档影响为本片验证证据更新，落在本节。所属 profile 的 `check-docs-contract --changed-since origin/alpha --format json` 退出 1，仍为 70 errors / 252 warnings，与 r4 的 findings 逐条一致；既有问题继续交编排器。`python3 scripts/check-doc-links.py docs/specs/tool-network-egress/plan.md docs/specs/tool-network-egress/design.md` 通过（8 条链接）；`git diff --check` 通过。

## 切片二：全部批准通放与系统代理

- 依据：#1757 r6；[规格 v2 / AC-08、AC-13](spec.md)，[冻结设计 §4.2、§4.5、§4.7、§4.8、§5、§10](design.md) @ `4948d952f3`（tldts 补丁版裁决已随切片一合入）。代码基线 `cd8649b31a`，切片一已经合入。
- 核对：计划 `ba413f12a3`；r6 明确授权先提交本节，再在同轮实施；如出现未决设计问题则只交 PLAN-READY。实机系统代理证据由编排器另行安排，本轮只做路由注入，不改本机设置、不启动应用或 Electron。

### 改动

路径 U 为 `packages/ui-mac/`，E 为 `packages/ext/`。

| 文件 | 改什么 |
| --- | --- |
| U `src/main/network-egress-grants.ts` 及已有测试 | N7 的数字目标归一与唯一公网地址判据，消费 IANA 2025-10-09 原表及 fake-IP 例外；旧卡片准入保持既有合同。 |
| U `src/main/network-egress-upstream.ts`、`.test.ts`（新） | N7 路由解码、system Session 查询、异步原始隧道；目标 lookup 固定地址、公网检查、HTTP(S)/SOCKS 握手、取消及失败分层。 |
| U `src/main/network-egress-proxy.ts` 及已有测试 | 消费 N7 就绪合同，串联政策判定、路由查询后授权复核、期限与隧道字节流；逐次政策事件关联连接 ID、拒非公网与自身代理循环。 |
| U `src/main/network-egress-approval.ts` 及已有测试 | 从 N2 完整非空快照读取可信档位；空/不完整 pending 恢复时重新判定；N5 记录接入现有 settings revision 与持久化状态。 |
| U `src/main/network-egress-passes.ts`、`.test.ts`（新），`egress-grant-records.ts`，`index.ts` | N5 环境隔离的 main-only 追加/读取绑定、严格完整行解码、按 ID 去重和设置聚合；复用既有状态根和日志出口。 |
| U `src/shared/network-egress-wire.ts` | 补 N5 的 EgressPass 纯类型，已有 settings summary 合同不变。 |
| U `src/renderer/codepuppy-ui/settings-network-egress.tsx`、已有 `network-egress-card.test.ts`，`src/renderer/i18n/{zh,en}.ts` | 在已批准的联网清单里复用行样式展示首次/最近政策放行与次数、记录写入失败；沿用设置订阅。 |
| U `src/main/network-egress.engine.cases.ts`、`test-component/network-egress-engine-peer.ts`（如需），已有 `engine-cases` scenario 宿主 | 在既有真引擎/真围栏夹具内增加通放、混合档、私网拒绝与注入系统代理路由；只跑新用例，不重跑 45 秒臂。 |
| U 已有代理消费者测试：`network-egress-fence.test.ts`、`process-fence-{engine,wiring}.test.ts`、`net-failure-real-stack.test.ts`、`relay-wiring.cases.ts`、`endpoint-route.engine.cases.ts`、`test-component/official-connectors.cases.ts` | 同调用链机械同步原同步 dial 为 N7 异步就绪合同；不改变这些用例原判据。Electron 宿主不在本轮运行。 |
| `scripts/gate-files.tsv`，U 已有写点/登记/披露测试 | 仅按实际用例数和受托方同步登记，不运行完整登记步骤或 gate。新 main-only 写者不能进入 sidecar 闭包。 |

### 顺序

1. **公网判据与异步上游。** 实现 grants/N7 和代理接线，一起同步受影响的 dial 消费者。先跑新增用例，再完整跑 grants、upstream、proxy 三文件各一次；保持原失败层和 head/背压/静默行为。
2. **通放决定与记录。** 一起接全 allow 快照、pending 恢复、N5 真实磁盘绑定及设置投影，完整跑 approval、passes、proxy 相关文件。记录失败不阻断已获准拨号。
3. **设置与真实入口证明。** 增补既有 renderer 测试和 scenario 用例；窄跑新的设置用例，再完整跑 `network-egress-card.test.ts`。一次运行新增真引擎/真围栏用例（按 `-t '通放与混合档|通放拒绝非公网|系统路由注入'`），包含 AC-08 的三条情形和 AC-13 日常代理记录；不重跑旧 45 秒臂。对照在隔离临时副本运行同一判据：去掉全 allow 判断时通放用例出现卡片而红；绕过注入路由时代理记录/目标响应判据红；去掉地址过滤时非公网判据红。每臂只运行所覆盖的新用例一次，保留命令、输出和退出码。
4. **一次较宽相关集及登记。** 以 rg 查消费变动导出的测试和枚举项，运行 activity、IPC、derived、registry、disclosure、write-sites、gate-file-registry、shared wire；E 的 network-egress/context-injection（若 N6 消费没有改动，不重跑其它 E 宿主）。分别运行受影响的 relay/endpoint/official-connectors 具名 cases，不运行整个 engine-cases 宿主。U `bun typecheck`；locale 独立进程；旧名扫描在每次提交前运行。只同步实际计数，禁止完整 suite/bin/check/gate。

### 风险

- 旧 dial 在多个真实夹具里使用，漏同步会导致其它用例把 TCP 连接误当隧道就绪；通过类型检查、rg 消费者清单及具名调用链测试捕获。
- DNS 重绑定、短数字与混合地址集：公网判据只在 grants 一处；lookup 测试用 Node 对 localhost 的实际返回结构，生产隧道使用检查过的地址，代理握手核对收到固定 IP。
- 活动在异步检查中变化、路由等待期间撤销：按 revision 验证档位快照，在真正拨号前复核授权；测试控制这些异步边界，不能从旧快照放宽。
- 握手提前回 200、额外字节丢失和取消后迟到拨号：真实本地协议 peer 延后应答、带尾字节，并核对无后续连接。JSONL 的半行和写失败分别验证，不把 I/O 失败变成网络拒绝。
- 预计四个实现单元、约 90 分钟；若规模/时间翻倍按执行规则返回。AC-13 实机验收不计为本轮已证明。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-08 | `network-egress.engine.cases.ts`「通放与混合档」：真引擎与真围栏运行命令，独占 allow 无卡、真实目标响应及日志/settings 计数；再加 ask 的真实活动后同目标出卡。隔离副本去掉全 allow 判断。 | 无档位旁路时独占 allow 等待卡片，响应和 policy-pass 均缺失；误用缓存全局授权时混合档没有卡。 |
| AC-08 | 同文件「通放拒绝非公网」，真实工具连接短写/私网；grants 表覆盖 IANA 最长前缀、mapped/IPv6/fake-IP；upstream 真实 CONNECT peer 核对 DNS 混合返回被拒、零上游连接与固定目标地址，去掉过滤对照红。 | 目标准入或 lookup 被删，实际握手可达私网、出现政策放行；误拒 fake-IP 会使正例失败。 |
| AC-08 | `network-egress-passes.test.ts`「逐次落盘与设置聚合」及 renderer 真实设置「通放记录展示」；唯一 ID、重启重读、半行、I/O 失败。 | 漏写一次、错误去重或无订阅投影时实际 JSONL 行数、first/last/count 或 DOM 不符。 |
| AC-13 | `network-egress-upstream.test.ts` 的真实 HTTP(S)/SOCKS peer、显式 DIRECT/失败后备/取消；`network-egress.engine.cases.ts`「系统路由注入」用真引擎/真围栏及注入的本地测试上游代理，核对代理记录与目标响应，绕过路由对照红。 | 路由被丢弃、未完成握手就回 200、代理未收到 CONNECT、取消后仍拨号，均在实际入口红。 |
| AC-13 | 编排器另安排：实机设测试系统代理 → 真引擎/真围栏连接仅经该代理可达的目标；保留代理记录，并对照无系统代理。 | 日常注入不能证明 Chromium 读取系统设置；缺实机命令和记录时该部分仍未验证。 |

### 偏离记录

暂无。基线相关三文件为 `bun test --max-concurrency 2 src/main/network-egress-grants.test.ts src/main/network-egress-approval.test.ts src/main/network-egress-proxy.test.ts`：36 pass / 0 fail（日志 `/tmp/egress-s2-baseline.log`）。


切片二步骤 1（2026-11-26）：N7 已接到真实代理，测试夹具同步异步就绪合同；新增 `test-component/egress-upstream-fixture.ts` 是初始清单之外的同调用链测试文件，为九个已有 TCP peer 复用 connect-event → Promise 就绪适配，只供测试，不参与 allow-all 判据。N7 的协议测试使用真实生产请求，HTTP/HTTPS 由 Node server 解析；SOCKS peer 按 RFC 1928 与 SOCKS4 回复；HTTPS 证书由本次 openssl 生成、仅子进程加入 CA；Electron system Session 在隔离子进程验证 API 接线，没有启动 Electron。

U `bun test --max-concurrency 2 src/main/network-egress-grants.test.ts src/main/network-egress-upstream.test.ts src/main/network-egress-proxy.test.ts`：38 pass / 0 fail（`/tmp/egress-s2-step1.log`）；其中原代理 24 条先单独通过，新增两条路由撤销/迟到/循环边界窄跑 2 pass。U `bun typecheck` 退出 0。旧名扫描最初误从根目录执行被根守卫拒绝，从 U 重跑为 10 pass；不计错误命令为通过。文档检查基线 69 errors / 253 warnings，沿用既有问题，不扩修。


切片二步骤 2：完整非空活动快照的档位解析按 activity revision 核对，待批窗口恢复到全 allow 时继续；通放不写用户授权集合。N5 复用现有环境状态根追加逐次 JSONL，设置按唯一 ID 投影；实际 readonly 文件导致的 append 失败只影响记录状态，真实 CONNECT 仍成功。新增改动范围为 `egress-grant-truth.ts` 的 UTC 判据提取（N4/N5 共用同一时间合同，避免复制校验）；其余均在初始列表。三条旧代理夹具把 loopback 伪装成可批准目标，按设计 §4.2 改为公开形状的测试名映射到本地 TCP peer，原拒绝/批准/迟到断言保持；连接 ID 按 N5 改为运行 UUID + 序号，旧计数断言同步 string。

U `bun test --max-concurrency 2 src/main/network-egress-approval.test.ts src/main/network-egress-passes.test.ts src/main/network-egress-proxy.test.ts`：37 pass / 0 fail（`/tmp/egress-s2-step2.log`）；`bun typecheck` 退出 0。初次新 passes 夹具遗漏父目录创建，2 fail，补齐夹具后窄跑 4 pass；这是夹具错误，不记作产品移除臂。新增 N7/passes 测试均为 integration：依赖通过静态 import 可追踪，普通受影响 PR 可选中；真引擎增量仍放已有 scenario 宿主，只由夜间运行，本轮验收按具名用例单次执行。返回前将执行 `affected-tests --list` 报告 scope。


步骤 2 的后续窄复核在提交 `0c83296409` 后读到 HTTPS 失败（`/tmp/egress-s2-step2-upstream.log`，1 pass / 1 fail）：Bun https.request 会从新设的 CONNECT Host 头推导 SNI，把目标域名用于代理证书校验。显式将 HTTPS 的 servername 绑定路由代理 host（IP 不发域名 SNI），保持目标 authority 为 CONNECT Host。原测试不改，U `bun test --max-concurrency 2 src/main/network-egress-upstream.test.ts` 转为 6 pass / 0 fail（`/tmp/egress-s2-https-green.log`）。如实记录前一提交的验证缺口，未合并或推送。


N7 循环边界补正：先以 `cbfedbb99b` 仅提交扩大 IPv6/IPv4-mapped 别名的回归输入，U `bun test --max-concurrency 2 src/main/network-egress-proxy.test.ts -t '系统代理指回'` 为 0 pass / 1 fail（展开式 IPv6 错归 ERR_INVALID_URL，`/tmp/egress-s2-loop-red.log`）。随后把 WHATWG/mapped 归一提到 grants 的内部导出 `canonicalEgressHost`，公网判断与代理循环共用；卡片准入未改。代理自身端口的名称还检查本次 lookup 的 loopback 地址，避免名称别名回指自身。原回归测试未改，grants/proxy 两文件 32 pass / 0 fail（`/tmp/egress-s2-loop-green.log`）；补齐名称解析后代理文件再核对为 26 pass / 0 fail（`/tmp/egress-s2-loop-proxy-final.log`），typecheck 与提交前旧名扫描通过。
