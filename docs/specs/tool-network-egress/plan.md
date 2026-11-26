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

以下是待实施安排，不是已取得的行为证据。路径缩写 `main/`、`shared/`、`preload/`、`renderer/` 相对于 `packages/ui-mac/src/`，`ui/` 表示 `renderer/codepuppy-ui/`。新文件名是本片的落点安排，其私有辅助函数不升为冻结合同。

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
| `packages/ui-mac/test-component/{session-workspace,new-session-workspace,session-timeline}.cases.ts` 及各自 runtime/stub | 在现有真实 Solid 宿主覆盖提交绑定、dock 与继续入口；只扩展需要的 preload 边界。 |
| `main/network-egress.engine.cases.ts`（新）、`main/engine-cases.scenario.test.ts` | 为联网模块增加缺少的真引擎/真围栏 scenario 层；复用已有 engine sandbox、生产配置、真实 ext 与本地模型桩，不另建通用 harness。宿主只新增本模块一行。 |
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

下列用例名与命令是实施目标，当前尚未创建/执行。`U = packages/ui-mac`，`E = packages/ext`；表内命令均在对应包目录运行。新增用例进入模块测试文件；真实引擎、多步重启和真实计时只进入 `.scenario.test.ts` 所承载的层，日常 PR 不执行这一层。

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

## 切片二：全部批准通放与系统代理

本轮仅保留交付边界，后续 PLAN 再展开。AC-08 的真引擎/真围栏三条及去档位判断对照、AC-13 的系统代理证明仍为整票必需证据。AC-13 按设计 §4.7、§10：日常从 `resolveEgressRoutes` 注入路由并走真实上游握手；另由编排器安排**一次**真实机器已设本地测试系统代理的真引擎/真围栏验收，连接仅经它可达的目标，保留测试代理连接记录，并对照无系统代理。日常注入不计作系统配置读取已验证。本片不启动 Electron、不改本机系统代理；缺少那次实机记录时，最终 AC-13 不能记为通过。
