---
id: PLAN-video-understanding
title: 视频与录音理解桌面实施计划
summary: alpha-code 的 D1–D5 交付切片，以及 D1 媒体附件、D2 完整本机处理与持久结果的文件、顺序、风险和证明。
kind: plan
status: active
spec: impharaon/alpha-work:SPEC-video-understanding
design: impharaon/alpha-work:DESIGN-video-understanding
owners: [owner]
last_reviewed: 2026-11-26
---

# PLAN-video-understanding｜视频与录音理解桌面实施计划

本文件属于 `impharaon/alpha-code`，执行票为 [#1775](https://github.com/impharaon/alpha-code/issues/1775)。规格与设计由 `impharaon/alpha-work` 拥有：

- [规格 v1：docs/specs/video-understanding/spec.md](https://github.com/impharaon/alpha-work/blob/25afeda6285b66b3de9d83531fa2e5a6cafa468f/docs/specs/video-understanding/spec.md)。
- [冻结设计：docs/specs/video-understanding/design.md](https://github.com/impharaon/alpha-work/blob/870002ed698f1a83efa9d6ecb359ea5a0d0d41af/docs/specs/video-understanding/design.md)，包括 §10 的 R1 处置及 L1/L2 接收收据；下称「视频设计」。
- [连接器启动器 v2：VIDEO-L1-v2](https://github.com/impharaon/alpha-code/blob/f7424aa45225a6d02d1958f4b4f72d247f99acc4/docs/specs/connector-launchers/design.md)，消费其 v2 §4.2/§4.3、§6、§10；下称「启动器设计」。
- [固定文件设计：切片四 L2](https://github.com/impharaon/alpha-work/blob/982e25800f9d8c5e302b88c14c1c94a499222c0e/docs/specs/domestic-cloud-connectivity/design.md)，消费其 §4.11、§6 及 L2 接收；下称「固定文件设计」。

读码基线为 alpha-code `f7424aa45225a6d02d1958f4b4f72d247f99acc4`。初始 PLAN 提交只写本文件；D1 以后的切片只列范围与依赖，各自实施前再展开相应小节。交付状态仍在 Issue/Alpha Delivery。本文件不重述冻结决定。

## 切片总览

| 切片 | 交付范围 | AC 归属与集成依赖 |
| --- | --- | --- |
| D1 原路径媒体附件与第一方服务接入 | 拖入/选择视频与录音、附件条与消息 metadata、ext 本机读取指令；提供视频服务代码实物和同一随包清单条目，自动注入本机服务 | AC-01 的入口与零手动安装、AC-02；AC-13 的用户入口、AC-16 的来源错误、AC-17 的两平台附件接线。实际服务启动/身份集成消费 #1760，实现不归本票；完整回答待 D2–D4，云回答待 D5 |
| D2 完整本机处理与持久结果 | info、完整转写/语种/说话人、精确取帧/场景帧/OCR、search、跨会话缓存、字幕/逐字稿/帧导出、clip/GIF、网站下载及 understand 的本机准备 | AC-01、03、04、05、06、08、09、10、11、12、14、16；AC-07 的 OCR producer。消费 D1、D3 的实际组件入口；不等待平台云实现 |
| D3 按需组件、固定文件与分发 | 实际 pin、资产配方、两平台 native/helper 构建与打包、许可和署名；消费 VIDEO-L1-v2 与固定文件清单，接入下载进度/取消/原调用继续 | AC-01、04、14、15、17、18；#1760 实现与 L2 清单/入口投影为集成依赖，公开资产发布由编排器承接 |
| D4 处理进度与帧的模型投影 | MCP 处理进度进入现有卡片；在原 vision authority 登记帧与 OCR、非视觉模型先 OCR 再按需识图 | AC-04、07、14、16；消费 D2 帧/OCR 和 D3 准备进度，不另建识图客户端 |
| D5 平台视频理解桌面接线 | understand 外层执行器、ext→main 窄桥、原上传状态 authority 的二进制运输、上传显示/取消、完整结果读取、持久在途记录与成功缓存、自动本机缩小/分片 | AC-13 的桌面部分及 AC-09 的云结果复用；消费 alpha-platform#621 生产的 VideoUnderstandingV1 固定产物与 D2 准备产物，资金与云工具由平台验收 |

执行顺序为 D1 → D2 → D3 → D4 → D5；D2 的组件相关实物证明在 D3 集成后补齐。AC-17 是 Windows 包发布前对 AC-01/04/06/12/15 的集体验收，不因 Mac 测试通过而完成。AC-01/04/14/15/18 的安装包证据、AC-02 的 2 GB 实测及 AC-13 的真实付费端到端均按各片的后续 brief 执行；本次 PLAN 不启动应用、下载大模型或联系生产。

## D1 原路径媒体附件与第一方服务接入

- 依据：规格 v1 BR-01/02、体验约定，AC-01/02 及上述 D1 分工；视频设计 §4.1、§5、§6 D1、§8/§10 @ `870002ed698f1a83efa9d6ecb359ea5a0d0d41af`；启动器设计 v2 §4.2/§4.3、§10 @ `f7424aa45225a6d02d1958f4b4f72d247f99acc4`；alpha-code#1775 当前正文（2026-11-26）。界面复用规格批准的文档附件条和工具卡片，不另出稿。
- 核对：Phase: IMPLEMENT — `56ab1074db` · Claude Opus 5.5（orchestrator）· plan accepted；D1–D5 的 AC 归属、D1 具名证明及 #1760 集成依赖已核对，通过；无冻结决定变更。

### 改动

下表路径相对本仓。新文件名是本片的实现落点；如实施因真实调用链需要调整，在同一提交更新本节。只消费启动器的新声明输出，不改其 schema、摘要算法、handler 或权限判定。

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/src/shared/media-attachment.ts`（新）及同目录 `media-attachment.test.ts`（新模块） | 视频设计 §4.1 的 `codepuppy.media` metadata 及纯解析/媒体分类共享定义；renderer、main、ext 消费同一份，保留与文档相对路径不同的语义 |
| `packages/ui-mac/src/main/composer-media-attachment.ts`（新）及同目录测试（新模块） | 用户本次选择的来源登记、真实路径/stat/只读打开校验及 metadata 返回；只处理附件来源，不持有转写或云派发状态。异步时长探测消费 D2/D3 的就绪能力，未就绪保持 null |
| `packages/ui-mac/src/main/ipc.ts`、`src/main/attachment-picker.ts` 及 `attachment-picker.test.ts`（新，现有模块无测试；均在 `packages/ui-mac/`） | 在既有选择授权与 IPC 中接入媒体来源；媒体不进入文档的正文读取预算，原文档读取仍走原 authority；跨 sender/非本次选择的来源不能借本入口打开 |
| `packages/ui-mac/src/preload/index.ts`、`src/preload/types.ts` | preload 内从真实 File 取得 `webUtils.getPathForFile` 路径，连接主进程登记与异步 metadata 更新；不把 File 或媒体字节通过 IPC 传递 |
| `packages/ui-mac/src/renderer/codepuppy-ui/composer-attachments-core.ts`、`codepuppy-composer.tsx` 及既有 `composer-attachments-core.test.ts` | 接入媒体分类、选择器 accept、拖入/选择流程、草稿附件与发送 parts；在现有 `arrayBuffer`/FileReader 分支之前处理媒体；探测未完成也能发送，旧 draft 的异步结果不写入新 draft |
| `packages/ui-mac/test-component/codepuppy-composer-model.cases.ts`、`attachment-cards.cases.ts`（复用既有组件层） | 挂真实 composer，触发 drop/input 与发送；通过 preload 边界控制尚未完成的登记，断言真实附件卡出现、发送可用且 File 正文读取未被调用，覆盖跨草稿接续及已知/未知时长；不复制 readFiles 逻辑到测试 |
| `packages/ui-mac/src/renderer/codepuppy-ui/attachment-cards.tsx`、`session-timeline/timeline-attachments.ts` 及既有 `session-timeline/timeline-model.test.ts` | 复用附件条/消息文件卡显示名称、大小、已知时长与本机读取事实；消费媒体 metadata，不能把单纯已附上显示成已转写或已理解 |
| `packages/ui-mac/src/renderer/i18n/zh.ts`、`en.ts` | 沿现有 i18n authority 添加本片实际需要的媒体时长、来源失败和读取文案；使用既有 fallback，不扩展新页面 |
| `packages/ui-mac/src/engine-adapter/opencode2/v1-shapes.ts`、既有 `src/engine-adapter/staged-attachment.test.ts` | 在当前适配器的附件投影中接通媒体 metadata 的发送/存储/读回；只运送小 metadata，不让媒体原字节进入 prompt；不切换引擎 API 代际 |
| `packages/ext/src/staged-attachment-part.ts`、`attachment-reader-hooks.ts`、`context-injection.ts` 及既有 `attachment-reader-hooks.test.ts`、`context-injection.test.ts` | 沿现有 metadata 载体和 context hook 接入媒体读取指令，指向同一个视频服务的 info/transcript；媒体原路径不拼文档隐藏目录；文件名/内容继续作为不可信材料 |
| `packages/ui-mac/resources/video-mcp/tools.ts`、`server.ts`（新） | 从视频设计 §4.1 导出工具 schema，提供随包代码实物和轻量 initialize/tools/list 入口；D2/D5 接续执行实现。本片不以空结果或准备 payload 冒充工具执行成功，不在握手时准备模型 |
| `packages/ui-mac/scripts/build-video-mcp.ts`（新）、`scripts/gen-office-mcp-tools.ts`、`resources/office-mcp/tools.json`、`electron-builder.config.ts`、`package.json` | 将视频入口构建为随包 Node 可执行产物并纳入资源；向启动器拥有的同一 manifest producer 贡献视频条目/codeSha256/tools（配方具体 ID/成员由 D3 补齐），不另做视频清单解析器；只接本片 build 命令，不新增依赖或运行期安装 |
| `packages/ui-mac/src/main/codepuppy-video.ts`（新）、`codepuppy-config-injection.ts` 及既有 `codepuppy-config-injection.test.ts`、`office-mcp-tools-snapshot.test.ts` | 从宿主资源/launcher authority 派生服务位置，接入既有 mcp.servers 注入、禁用与权限投影，用户无需在定制中心安装；不复制 Office 安装迁移或首方身份判定 |
| `docs/architecture/modules.md`、`docs/specs/video-understanding/plan.md` | IMPLEMENT 中为新增视频资源目录补职责和既有 authority 引用；从续派填写核对行并记录实际偏离。本次 PLAN 只新增 plan.md |

读码定位：`composer-attachments-core.ts:95` 尚无媒体分类；`codepuppy-composer.tsx:990` 非图片会读完整 File；`main/ipc.ts:246` 的 picker 统一执行文档预算；`opencode2/v1-shapes.ts:125` 仅搬运文档 metadata；`core/src/mcp/codepuppy-first-party-mcp.ts:46` 当前仍是旧返回形状。最后一项是 #1760 已明确承担的 raise，不在 D1 复制或绕过；同名第三方不能成为测试中的可信视频服务。

### 顺序

1. **媒体来源与发送（实现提交一）**：先运行既有附件纯核、适配器往返测试；在各自模块文件加入媒体分类、真实来源校验、metadata 往返用例，为尚无测试的 picker 模块和 composer 附件交互层新增测试，再实现 shared/main/preload/composer 接线。真实 composer 用例须让正文读取/复制路径一旦被调用即失败，探测 promise 未完成时附件卡及发送结果已存在。结束时完整跑这些改变行为的测试文件一次。
2. **显示与模型读取入口（实现提交二）**：补附件卡/时间线投影和 ext/context-injection；以生产发送投影经过当前适配器再到 context hook 的结果断言工具及原路径。覆盖附件单独发送、切换草稿/目录、移除后迟到探测、失败来源和已知/未知时长。结束时跑附件纯核、适配器、时间线及 ext hook 的相关文件一次。
3. **随包接入（实现提交三）**：加入轻量服务/工具定义及 build 资源，贡献同一随包清单条目并接入配置注入；快照必须由真实 producer 生成。#1760 新声明器尚未到位时只完成独立代码与条目产物，不为使当前旧解析器通过而保留旧 schema 或另写声明器；身份/实际启动证明在该依赖集成后运行。同步模块地图和本节实际文件/核对记录。
4. **一次相关扩展核对**：搜索测试对变更导出的 import/mock，以及对附件类别、manifest formats、首方工具、打包资源的枚举；实际命中的相关文件列入返回证据，运行一次。`bun typecheck` 仅从受影响包目录执行；core 的声明器若未修改，只跑依赖集成所需的指定用例，不跑 core 全套。

每步迭代只跑正在改的 case（`bun test <file> -t '<case>'`），结束再跑该步行为文件。D1 是新增能力；若实施中另确认已有缺陷，按 red-first 单独记录并修正必要调用链，不顺带清理。PLAN 阶段只做文档、路径和差异核对；下述产品证据均是待实施验证项。

### 风险

- **依赖尚未实现**：本基线只有 VIDEO-L1-v2 冻结设计，不能把它当现成函数。D1 消费最终 producer 的条目形状；#1760 集成后用同一声明器验证真实构建产物，未集成明确报告该项未验，不扩到宿主端口实现。
- **大文件路径退回全量读盘**：拖入和原生选择器均必须覆盖；对文档预算、File.arrayBuffer、stage/复制加调用边界断言，2 GB 真实媒体的 UI 实测另记实际用时。
- **消息与草稿异步丢附件**：metadata 需要通过实际适配器才能到 ext；以已有真实引擎夹具 `src/engine-adapter/fixtures/read-tool.json` 的载体形状为来源，IMPLEMENT 集成时补采真实媒体元数据消息，不能手编另一个引擎 wire 格式。
- **时长与身份产生第二个权威**：时长消费 D2 的实际媒体探测与 D3 就绪入口；本片不在附上时拉取模型。身份/环境/cwd/代码摘要的反例只通过 #1760 核验器断言，不能让测试私有替身自己宣布可信。

### 证明

以下命令均从指定包目录执行；case 名在实施时落在列出的模块测试文件内，不以票号命名。文件名仅在新增模块没有既有测试文件时新增。

| AC / D1 分工 | 测试/证据与命令 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-02 媒体附上/可发送 | `cd packages/ui-mac && bun test src/renderer/codepuppy-ui/composer-attachments-core.test.ts src/main/attachment-picker.test.ts src/main/composer-media-attachment.test.ts`；另执行 `bun test ./test-component/codepuppy-composer-model.cases.ts -t "media attachments"`；纯核及 DOM 用例分别检查 2 GB size 分类、真实拖入/选择后卡片与发送、无正文读/复制、未完成探测不阻止发送。另在有界面的后续验收 brief 中用真实 2 GB 视频拖入并记录「已附上且可发送」耗时 ≤3 秒（一次性证据） | 当前分类会拒绝媒体；picker 会触发文档预算；若真实 readFiles 走全量读取或等待探测，DOM 用例的调用/未完成发送断言失败。组件测试不替代 3 秒实测 |
| AC-01 入口/读取指令，AC-13 用户入口 | `cd packages/ui-mac && bun test src/shared/media-attachment.test.ts src/engine-adapter/staged-attachment.test.ts src/renderer/codepuppy-ui/session-timeline/timeline-model.test.ts`；`cd packages/ext && bun test src/attachment-reader-hooks.test.ts src/context-injection.test.ts`；覆盖视频、MP3、只有附件的消息、原路径及 info/transcript 工具引用 | metadata 在适配器丢失、被当文档相对路径拼接、或 hook 没产生读取指令时失败；完整 AC-01 的时间引用回答待 D2–D4，AC-13 云结果待 D5 |
| AC-01 零手动安装/可信服务 | `cd packages/ui-mac && bun test src/main/codepuppy-config-injection.test.ts src/main/office-mcp-tools-snapshot.test.ts`；#1760 集成后：`cd packages/core && bun test test/codepuppy-mcp-runtime.test.ts -t 'bundled'`，`cd packages/ext && bun test src/policy/identity.test.ts`，以真实构建视频代码与同一清单校验 initialize/tools/list 无下载、定义一致；改命令/代码/显式 environment/cwd 的反例不产生首方 binding | 漏注入会没有可用服务；漏随包实物或摘要不符会无声明；仅按服务名授信将错误接受反例。未集成时不能宣称身份通过 |
| AC-16 来源错误部分 | `cd packages/ui-mac && bun test src/main/composer-media-attachment.test.ts`；真实临时文件的不存在、不可读、非本次选择、跨 sender、选择后变化用例；断言原因/动作及无媒体读取副作用 | 无来源校验或失败被吞会错误附上/空白。损坏容器、格式、磁盘满的完整三条工具用例归 D2/D3，不以这里替代 |
| AC-17 两平台 D1 接线部分 | 上述 shared/preload/picker 用例覆盖两平台路径；依赖集成后分别检查 darwin-arm64、win32-x64 构建产物内的视频入口/声明及 Node 路径，记录 build 命令和实物清单 | 硬编码 Mac 路径、缺 Windows 资源或源码未构建会导致清单/启动失败；Windows 完整指定 AC 仍待发布前实测 |

本片一次返回前的相关集至少包括上表实际改变行为的文件；补跑通过搜索发现的直接消费者，不能直接运行 `bun test src`。改 build/资源后补 `bun typecheck`（`packages/ui-mac`、`packages/ext`）；文档检查及 `git diff --check` 留命令与输出。真实引擎/应用、计时和打包测量只作后续明确 brief 下的一次性证据或已有 scenario 层，不加进轻量测试。不得运行 `bin/check`、`gate run`、全项目测试或改 gate。

### 偏离记录

2026-11-26 · D1 第一步（`f9787813ba`）：原路径登记、媒体分类、preload 与适配器往返已实现；本地相关测试 26 pass / 0 fail（五文件）。真实时长探测依赖 D2/D3，D1 只传 null，不新增空探测器；完整时长补回仍待集成。

2026-11-26 · 组件测试复用既有 `test-component/codepuppy-composer-model.cases.ts` 和 `attachment-cards.cases.ts`，没有新建重复宿主；新增两条上下文 wrapper 后机械同步 `packages/ext/src/context-injection-inventory.snapshot.txt`（必要的同一调用链文件）。时长未知不挡发送，已知时长卡片投影已有测试；实际时长探测未接 D2/D3，不宣称完成。

启动器设计 v2 §4.3/V2-R4 已接管视频设计早期文字中的「扩声明器属 D1」：按视频设计 §10 的 L1 接收收据，D1 只供条目/代码，原声明器改动由 #1760 承担；这是消费最终冻结输入，不是本计划另作设计裁决。


### D1 本轮实施证据与阻塞

- 原路径登记、媒体分类、preload、消息往返：`cd packages/ui-mac && bun test src/shared/media-attachment.test.ts src/main/composer-media-attachment.test.ts src/main/attachment-picker.test.ts src/renderer/codepuppy-ui/composer-attachments-core.test.ts src/engine-adapter/staged-attachment.test.ts` → 26 pass / 0 fail（第一步）。大文件夹具是临时 sparse 普通文件，只验 stat/open 与原路径，不声称它是有效视频或 AC-02 实测。
- 真实 composer：`cd packages/ui-mac && bun test ./test-component/codepuppy-composer-model.cases.ts` → 125 pass / 0 fail；其中本片 drop/input、发送 metadata、跨草稿接续三条；附件卡 `bun test ./test-component/attachment-cards.cases.ts` → 16 pass / 0 fail，含未知/已知/零时长及来源失败。
- 消息/附件投影：`cd packages/ui-mac && bun test src/renderer/codepuppy-ui/session-timeline/timeline-model.test.ts src/engine-adapter/staged-attachment.test.ts src/renderer/codepuppy-ui/composer-attachments-core.test.ts src/shared/media-attachment.test.ts` → 100 pass / 0 fail。
- ext：`cd packages/ext && bun test src/attachment-reader-hooks.test.ts src/context-injection.test.ts` → 51 pass / 0 fail。首次因新增 wrapper 未同步库存快照而红，运行 `bun packages/ext/scripts/context-injection-inventory.ts --write` 后通过；无断言放宽。
- 一次相关扩展集：`cd packages/ui-mac && bun test src/engine-adapter/boundary.test.ts src/engine-adapter/event-projection.test.ts src/engine-adapter/projection-parity.test.ts src/shared/attachment-path.test.ts src/main/old-name-scan.test.ts` → 48 pass / 0 fail；`cd packages/ext && bun test src/plugin-host.test.ts` → 52 pass / 0 fail。通过 import/枚举搜索选取；真实引擎/Office roundtrip/scenario 不在本片运行。
- 类型：`cd packages/ui-mac && bun typecheck`、`cd packages/ext && bun typecheck` 均 exit 0。首轮 ui-mac 发现媒体分类判别联合无法收窄，拆成 video/audio 两个判别项后通过。
- **BLOCKED: design — VIDEO-L1-v2 v2 §4.3 的 Node 命令绑定不完整。** 启动器设计 `:67-73` 同时允许资源树内 Node 和 userData 下的已校验归档入口；`:566` 要求 command 沿用现有受信模板匹配。实际 `packages/core/src/mcp/codepuppy-first-party-mcp.ts:27-38` 仅替换 resources，或将 workspace 槽匹配任意绝对路径，没有 LauncherEnvironment.node 的受信槽/投影。不能把 workspace 当 Node 槽，否则任意绝对可执行路径也会匹配。此处是冻结约定的缺口，区别于已知的声明器/handler 尚未实现。
- 只读探针：在 `packages/core` 用 `bun -e` import 实际 `commandMatchesTemplate`，同一视频模板依次传资源树 Node、userData 归档 Node、workspace 充当 Node 且实参为 `/tmp/untrusted-node`，输出 `{"direct":true,"archive":false,"workspaceSlotAlsoMatchesAnyAbsoluteExecutable":true}`，exit 0；没有执行这些路径的任何程序。
- **SEAM-CHANGE-NEEDED**：请 #1760 原 authority 明确视频受保护清单如何引用/核验 `LauncherEnvironment.node`，覆盖资源树与归档两种已批准形态、darwin-arm64/win32-x64，并保持同一声明器/main 重验。D1 不新增占位符、解析器、运行时路径表或宽松可执行匹配。因此本轮停止服务清单/自动注入接线，未创建假可用服务或部署产物；这些以及可信身份/实际启动断言仍 pending，不能按 D1 完成验收。
- AC-01 完整内容回答、AC-02 真实 2 GB 界面计时、AC-13 平台结果、AC-17 安装包验收未执行；本片没有窗口、下载、付费调用、生产接触、全量门或 gate 修改。


### 删除对照（一次性验证，未加入永久测试）

在 `d059f0236e` 的已提交代码上，逐臂只改一个生产入口，执行下列指定 case；各臂结束立即 `git restore -- <该文件>`。每臂均是断言失败，不是编译/装载失败。全部恢复后再跑同一组 case，共 6 pass / 0 fail。完整输出在本机 `/tmp/video-d1-removal-<arm>.log`，汇总 `/tmp/video-d1-removal-arms.json`。

| arm / 移除的行为 | 包目录内的命令 | 结果 |
| --- | --- | --- |
| media-classification：跳过媒体分类 | ui-mac `bun test src/renderer/codepuppy-ui/composer-attachments-core.test.ts -t 'media has no document limit'` | exit 1，1 fail |
| media-wire-projection：不将媒体 metadata 投影为 prompt 附件 | ui-mac `bun test src/engine-adapter/staged-attachment.test.ts -t 'media metadata round-trips'` | exit 1，1 fail |
| composer-original-path-branch：跳过真实 composer 的媒体分支，落到 File 正文读取 | ui-mac `bun test ./test-component/codepuppy-composer-model.cases.ts -t 'attaches large media'` | exit 1，2 fail（drop、picker） |
| media-context-instruction：context hook 不识别媒体载体 | ext `bun test src/attachment-reader-hooks.test.ts -t 'media metadata becomes'` | exit 1，1 fail |
| source-change-check：不核对登记时真实文件大小 | ui-mac `bun test src/main/composer-media-attachment.test.ts -t 'source validation'` | exit 1，1 fail |

已核：Codex / GPT-6；依据本节固定输入及 checked plan `56ab1074db`，仅核对已完成的 D1 附件调用链，结论为部分代码已验证、D1 未完成。已定勿重开：视频设计 §10。下一步与遗留去向：Node 模板缺口 → #1760 原设计/编排器；服务实物、清单和自动注入须在该缺口关闭后续做，原 #1760 声明器/handler 的实际集成断言继续 pending；D2–D5 未动。没有新增 owner 决策或限制。

## D2 完整本机处理与持久结果

- 依据：impharaon/alpha-work:SPEC-video-understanding v1 @ `25afeda6285b66b3de9d83531fa2e5a6cafa468f`；视频设计 §4.1/§4.2（库与已准备组件的消费边界）/§4.3/§5/§6 D2/§10 @ `870002ed698f1a83efa9d6ecb359ea5a0d0d41af`；alpha-code#1775 r2 续派。覆盖 AC-01/03/04/05/06/08/09/10/11/12/14/16 的本机段，AC-07 的 OCR producer、AC-13 的本机片段准备、AC-17 的跨平台处理段；AC-15/18 的组件分发与许可仍归 D3。
- 核对：Phase: IMPLEMENT — `129df72433` · Claude Opus 5.5（orchestrator）· D2 plan accepted：文件、顺序、风险、样本来源和逐 AC 证明通过；实际组件仅消费 pin 准备结果，缺少的样本/测量不宣称通过。

本节读码基线为 `31d4cacaf0`。r2 已接受 D1 三个提交所覆盖的附件/metadata/读取指令；上述 D1 记录保留为历史证据。`FIRST-PARTY-NODE-v2.1` 仍在审查，本节不把它写成已冻结或已实现，也不改 D1 的待集成断言。D2 可先实现/验证独立的本机处理模块，不等待 L1 handler 或平台云实现；真实组件取得与 MCP 宿主集成证据分别在 D3、D1 接线后完成。

### 改动

下表的新模块均为视频设计 §6 D2 的内部实现分工，不新增服务框架、宿主业务桥或用户配置。处理函数消费宿主已准备的组件入口及原调用的 signal/progress；模型、ffmpeg/ffprobe、OCR 数据和网站运行环境仍只由固定文件清单/既定准备 authority 提供。不扫描 PATH、系统安装或 pilot 目录找生产组件，不直接 fetch 模型，不往 MCP 参数中塞模型/缓存路径。

| 文件（相对本仓；标新者当前不存在） | 改什么 |
| --- | --- |
| `packages/ui-mac/resources/video-mcp/contracts.ts`（新）、`tools.ts`、`server.ts`（随 D1 接续） | 从视频设计 §4.1 实现一份严格 schema、类型与工具定义，登记 info/transcript/frames/search/export/clip/gif/download 的真实执行器；同一 schema 用于校验和 tools/list。服务运输、声明、构建仍复用 D1，不实现 #1760 的 client handler。understand 的内部准备与最终公开 output 分开，D5 未接入前不把准备 payload 当答案 |
| `packages/ui-mac/resources/video-mcp/process.ts`（新） | 组件子进程的 argv、流式 stdin/stdout、取消与真实退出/errno 归因；消费已准备入口，所有媒体解析留在独立进程/其围栏内子进程；转发本机处理进度。不给主进程发送任意命令，不改变现有出网/文件权限 authority |
| `packages/ui-mac/resources/video-mcp/source.ts`、`cache.ts`（新） | MediaRef 解析、实际容器探测、源时间轴；流式内容指纹、文件 identity/stat 索引、配方/资产摘要 key、跨进程锁、chunk/frame 完成清单与原子发布/恢复。复用 `packages/util/src/flock.ts` 的 `Flock.withLock/acquire`，锁目录由缓存根派生，等待随原调用取消/截止，不把默认五分钟锁超时变成媒体处理限制 |
| `packages/ui-mac/resources/video-mcp/audio.ts`、`transcript.ts`（新） | PCM 解码/按块读取、完整覆盖的切点、真实 LID/ASR/diarization 调用、源毫秒与 token/句子/说话人对齐；转写缓存与范围投影。库 API 沿冻结设计 F-04..F-06，pilot 只作既有输入/回执参考，不能复制其短尾跳过或机器路径 |
| `packages/ui-mac/resources/video-mcp/frames.ts`、`ocr.ts`（新） | 实际 PTS 的时点/间隔/场景选帧、图像旋转/宽高比、帧缓存、OCR 调用与统一坐标输出；生成有序 MCP image 与 OCR/时间信息，供 D4 消费，不在此增加云识图客户端 |
| `packages/ui-mac/resources/video-mcp/helpers/vision.swift`（新） | macOS Vision helper 的识别与坐标输出源码；Windows OCR 的 Tesseract/Leptonica 及模型消费在 `ocr.ts`。helper 的实际构建、签名、目标架构和随包许可证属于 D3，不让用户安装工具链 |
| `packages/ui-mac/resources/video-mcp/search.ts`、`export.ts`（新） | 在同一已发布 transcript 上做文本/时间范围检索、上下文投影；由同一结果输出 SRT/VTT、TXT/MD、帧图片及时间清单；写入当前项目的真实目标，返回实际文件名。输出不再次识别、不覆盖源媒体、不发布半成品 |
| `packages/ui-mac/resources/video-mcp/clip.ts`、`prepare.ts`（新） | 精确解码/重编码、GIF 调色板及可解码产物；understand 的本机准备复用裁切/探测/缓存，产出完成片段、摘要、原时间范围和来源敏感事实。平台模型描述由 D5 的已解码 producer 契约传入，不复制 VideoUnderstandingV1 DTO、模型行、体积界或价格，不保存云派发/账单状态 |
| `packages/ui-mac/resources/video-mcp/download.ts`（新） | 调用已准备的 yt-dlp/Python/Node/EJS，完成后汇入同一个本机 source/cache；argv、固定运行组件与原 egress proxy 按设计 §5「网站」，实际网页/CDN/重定向的批准沿原 authority。仅下载用户给的视频内容，不能用该模块取模型或自行更新组件 |
| `packages/ui-mac/src/shared/project-artifact-path.ts`（新）、`src/main/codepuppy-workdir.ts`（均在 ui-mac） | 从既有路径 owner 提取 D2 必需的路径净化、边界/软链检查与命名实现，main 保留现有导出并消费同一实现，视频服务也消费它；显式目标仍按设计允许的当前项目范围解析，不把 `.codepuppy` 变成新增目标限制。默认名字冲突消费实际占用事实，不能继承云产物“同一件重下可覆盖”的语义去覆盖媒体导出 |
| `packages/ui-mac/src/shared/project-directory-identity.ts`（新）、`packages/ext/src/project-config.ts` | 仅把既有 `projectDirectoryIdentity`/`withProjectDirectoryIdentity` 及其所需只读判定提到可独立消费的 Node 模块，ext 原接口保持；视频服务避免 import 当前 `project-config.ts` 的 main 信任模块闭包。main 的项目迁移和已登记身份判定偏离保持原样，不在 D2 合并或重写 |
| `packages/ui-mac/src/main/video-{contracts,source,cache,audio,transcript,frames,ocr,search,export,clip,prepare,download,tools}.*test.ts`（新，按下述实际层级）、既有 `codepuppy-workdir.test.ts`、`packages/ext/src/project-config.test.ts` | 每个新增视频处理模块一个对应测试文件，纯算法/schema 用 `.fast.test.ts`，文件系统/小媒体/本机站点接线用 `.test.ts`；旧 owner 的断言在原测试文件保留。使用实际捕获的外部回执，不能手写 ffprobe/sherpa/Whisper/Tesseract/yt-dlp 的替身格式 |
| `packages/ui-mac/src/main/fixtures/video/`（新） | 小份真实 WAV/MP3/MP4/录屏裁片、真实工具回执和与实物绑定的标注/许可证；`provenance.json` 记录来源版本/URL/原文件与裁片 SHA-256、原记录 ID、起止时间、转换命令、标注来源。该目录不放模型、ffmpeg 或其它运行组件 |
| `packages/ui-mac/scripts/verify-video.ts`（新）、`docs/verification/video-understanding-local.md`（实测时才新增） | 可复现的质量/说话人/时间点/长片性能及对照臂评分命令，消费已准备的固定组件与固定样本清单；命令、实际值、失败和产物摘要落在一次性验收证据。不能因本机已有 pilot 组件就绕过 pin 校验，也不能靠旧分数生成“通过” |
| `packages/ui-mac/package.json`、`tsconfig.json`、`bun.lock`、既有视频 build 脚本（必要时） | 仅登记冻结设计选定的 sherpa/Whisper 构建依赖及其锁定版本，复用仓内已锁定的 MCP 运输依赖；组件发布/native 构建归 D3。其余依赖不在本片新增，锁文件由包管理器生成并检查机械变更；现有 tsconfig 显式纳入资源目录内的服务源码，使 `bun typecheck` 真正检查它，生产服务仅用 Node 可执行的 API |
| `docs/architecture/modules.md`、`docs/specs/video-understanding/plan.md` | IMPLEMENT 中标明视频资源、共享路径函数和只读项目身份的 owner/依赖，核对 K1/K2；在本节补续派核对与实际偏离。PLAN 本轮只修改 plan.md |

读码定位：现有视频资源目录尚未创建；`core/src/mcp/stdio.ts` 经环境 spawner 启动服务，D2 不另起 main 执行入口。`ui-mac/src/main/codepuppy-workdir.ts:35/50/77/191` 已拥有产物命名/路径操作；`ext/src/project-config.ts:31/75` 已有只读项目身份，但文件顶层 `:13-14` 引入 main 信任模块，所以只提取所需现有实现，不能让服务直接 import 该文件。`util/src/flock.ts:309/341` 可复用跨进程锁。已登记的 main/ext 项目根判定差异留在 constraints 原处，本片不新增一份判定。

### 顺序

1. **契约、来源与持久缓存**：先补严格 schema/工具定义、source/probe、cache；完成必要的路径/只读身份提取并在原 owner 测试证明行为未变。加入小真实媒体与来源清单；覆盖错误参数、同字节不同路径、源变化、缺失/半写项、新进程读回、同 key 写者/等待者取消。结束时跑 `video-contracts.fast.test.ts`、`video-source.test.ts`、`video-cache.test.ts` 和被提取 owner 的原测试文件一次。
2. **完整音轨、转写与说话人**：先以真实 PCM/捕获的库回执测试覆盖、语言码和源时间换算，再接 sherpa/Whisper 与整轨说话人处理、段落投影、缓存及搜索。结束时跑 `video-audio.fast.test.ts`、`video-transcript.fast.test.ts`、`video-search.fast.test.ts`；涉及实际模型的证据只在已准备固定文件后执行并记录，不用伪 ASR 回调宣称真实转写通过。
3. **画面与本机 OCR**：实现选帧/PTS/归一化和 OCR helper 源码、调用及缓存，按实际媒体和 helper 输出落真实回执。结束时跑 `video-frames.test.ts`、`video-ocr.fast.test.ts`；实际 helper 接线用 `video-ocr.test.ts`。没有所需已准备组件时明确缺少该集成证据，不回退系统 ffmpeg、系统 tesseract 或云识图。
4. **导出、剪辑/GIF 与 understand 准备**：由相同已发布数据实现 search/export/clip/prepare，完成项目路径、冲突、源文件保护及失败原子性。结束时跑 `video-export.test.ts`、`video-clip.test.ts`、`video-prepare.test.ts`；检查产物真实可解析/可解码及源时间，而不是只看命令参数或文件扩展名。
5. **网站与工具往返**：本机站点提供真实小视频页/媒体、拒绝访问页和重定向，接 yt-dlp 与既有 egress；把已完成函数接到同一工具路由、structuredContent/MCP image/取消/进度。结束时跑 `video-download.test.ts`、`video-tools.test.ts`；实际 stdio 的轻量 tools/list/call 往返另作真实 SDK 集成证据，不要求启动 Electron 或进行模型付费请求。
6. **一次相关扩展核对与验收记录**：搜索变更导出的 import/mock、tools/schema/产物类型枚举；只运行实际直接消费者及被提取 owner 的相关测试，列出实际文件和结果。`bun typecheck` 从 ui-mac 执行；只有 ext 只读身份入口发生变化时加 ext 的 `bun typecheck`。然后按 IMPLEMENT brief 明确命名的评分/测量 case 执行一次，不把整个样本集/性能重跑混进每步测试。

迭代只跑正在改的 case（`bun test <file> -t '<case>'`）；每步结束跑该步行为文件一次，相关扩展集仅在返回前跑一次。文件名中的 `video-*` 指模块，不用票号/AC 命名。需要永久保留的真实引擎/长片流程只进现有 scenario 层；一次性评分/测量记录命令与输出，不另造永久重型测试。不得改 gate、跑全包/全项目、`bin/check` 或 `gate run`。

### 样本与证据准备

- **已存在且可复查的语音来源**：沿视频设计 F-04..F-07 和 alpha-work 的讨论「真人录音补测」。本机取证坐标为 `/Users/pharaon/.cache/alpha-orch/2026-11-25/video-pilot/real/fleurs-{zh,en}/dev.tsv`、原 `dev/*.wav`、`real/work/{zh,en}_real.wav` 与对应 `.ref.txt`；拼接来源由 `scripts/fleurs_build.py` 可复查。正式入库夹具取原始单句/短裁片并记录 hash/原 TSV 行，不把该机器路径写进产品或可移植测试的默认值。语料作者与许可从 [Google FLEURS 原仓](https://huggingface.co/datasets/google/fleurs) 固定版本保留；小 WAV、MP3、MP4 转换只使用已准备的 pin 组件，保留实际转换命令和源时间关系。
- **质量与性能样本分开**：AC-03 使用既有中文 ≥20 分钟、英文 ≥15 分钟的固定真人集合及原文，先固定 20 句的人工开口标注/选择规则；同一集合跑完整覆盖和仅 VAD 对照，分别输出错误率、原文覆盖/长度和起始时间误差。pilot 的 `score.py` 仅作已有算法/口径取证，实际评分对新结果执行；若要调整其输入适配，不改变阈值、不删除失败句。AC-04 的中/英/法 60 分钟真人材料在指定验收前固定来源与 hash；法语可从同一 FLEURS 原语料取，长素材不放轻量夹具目录，不拿循环一个短句或合成讲话代替真实长片证据。
- **说话人**：不能把 FLEURS 的 gender 当作说话人 identity。使用 [VoxConverse 原作者标注仓](https://github.com/joonson/voxconverse) 的固定版本实际 RTTM/音频，先按恰有两人、每人至少五轮、清晰且无重叠的规格条件锁定片段与原标签（许可证和来源见[原数据说明](https://mm.kaist.ac.kr/datasets/voxconverse/)）；小回归裁片和完整 AC-05 评分记录分开。输出标签与参考人名作一次一致映射，按标注讲话时长计正确归属，不能只数标签个数或用性别替代人名。
- **画面/容器/错误**：小帧样本由实际六页录屏裁取，锁定可辨页码、已知 PTS 和只出现在画面上的数字；当前 pilot 的 `video/zh_test.mp4` 可作已有解码回归来源，但它的合成讲话不能证明 ASR，四处切换也不能代替 AC-06 六页证据。坏文件由真实媒体作可复现截断/破坏并保留操作记录；不支持格式使用真实有效的非媒体样本；磁盘不足用写盘边界的实际 ENOSPC 证据/指定隔离文件系统，不耗尽 owner 的磁盘。不得手编容器、ffprobe/RTTM/yt-dlp 输出或外部模型回执。
- **准备与取证边界**：本次 PLAN 未取模型、未执行推理、未生成媒体。D2 的真实组件测试使用固定文件 authority 已校验/展开的产物；没有 pin/对应实物时只完成不依赖它的代码及真实记录解析测试，并把对应实物断言标 pending，不能复制 pilot 的 ffmpeg/模型或将系统程序当生产准备成功。D3 接线后在同一测试入口补齐证据，不新增下载器。每个回执 JSON/TSV/文本夹具保留实际工具版本、调用及原样输出摘要，期望值来自样本标注或独立解析器，不来自被测输出本身。

### 风险

- **覆盖与时间的假通过**：pilot 有短尾跳过分支，ASR 与源容器还可能有非零起点/音画偏移。通过 source/audio 的完整样本域和真实 token/PTS 回执断言兜住；逐字稿起始时间不能由字数均摊，也不能只检查 chunk 的时间。
- **外语/说话人真实效果**：继承冻结选型，不用重跑 pilot 来重新选模型；整轨 diarization 的时间/内存、法语总用时及 AC-05 仍需新实现实测。若新事实否定冻结设计，返回受影响小节，不降准确率/性能数字、不改为用户安装或云转写。
- **缓存与取消互相破坏**：跨进程锁、已完成项摘要、源变化复核和真实新进程测试一起验证；取消一个调用只解除它自己的处理/等待，其他订阅仍可继续或消费已发布块。不能用会话内 Map 证明跨会话/重启复用，也不能为 cache 加 TTL/容量清理策略。
- **路径 helper 意外扩大改动**：只移动 D2 确实要调用的现有实现，保留 main/外层 ext 的原接口/行为与原测试；视频模块不 import main。若实际实现需要改项目身份语义、迁移、权限或另造路径 authority，就停下回报，不顺带清理 constraints 中的旧偏离。
- **二进制与平台证据缺席**：D2 代码可独立推进，实际 H.264 编码、Windows OCR/进程围栏和原生 addon 以 D3 的目标产物为准；现有 LGPL pilot 未含 OpenH264，不能用 MPEG-4 输出证明冻结的 H.264/AAC 路线。Windows 与最终签名/许可仍分别验收，不能从 Mac 或源码存在推断通过。
- **本机准备冒充云成功**：prepare 只返回已完成本机产物供 D5 包装；平台模型表、上传/重启意图/账单和结果归原 producer/D5，不在本机缓存另写一份云调用状态。

### 证明

下列文件均为计划中的新模块测试，实际创建时按层级落位；命令从 `packages/ui-mac` 执行。表内带「一次性」的脚本 case 只在续派明确命名且组件/样本就绪后执行，本次 PLAN 不运行。删除对照只临时移除相应生产行为，跑对应 case 后恢复并确认转绿，不把对照臂留成额外产品分支。

| AC / D2 分工 | 具名测试或一次性证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01 本机工具链、AC-16 合法输入/错误 | `bun test src/main/video-contracts.fast.test.ts src/main/video-source.test.ts src/main/video-tools.test.ts`：实际 info/transcript 路由、相对路径/已开过的 id、音频无视频流、无音轨说明、strict 字段/range、typed isError；小真实媒体与实际错误回执 | 错 schema/范围或把失败当成功会违反输出断言；只返回文件 metadata 而无真实转写不能通过模型/样本证据。D1+D3+D4 集成后的 AC-01 视频/MP3 真引擎时间引用仍另验 |
| AC-03 完整覆盖与时间点（轻量回归） | `bun test src/main/video-audio.fast.test.ts src/main/video-transcript.fast.test.ts`：从真实 PCM 取无 VAD span、连续讲话、极短尾及语种转换边界；断言原样本域恰好覆盖一次、padding 不计入源时间；真实 token/segment/diarization 回执的时间/语言/转折投影 | 移除非讲话域/短尾识别、仅用 SenseVoice 判所有语种、均摊时间或用 chunk 起点代替真实 token，分别破坏 coverage/路由/句级时间断言 |
| AC-03 质量与对照（一次性） | `bun scripts/verify-video.ts --case transcript-quality --samples <固定样本清单>`：中/英实物评分，分别要求 CER ≤8%、WER ≤12%、输出字数 ≥原文 95%，20 句中 ≥18 句起点误差 ≤2 秒；同集仅 VAD 对照臂须记录英文不达标事实，不能作生产选项 | 删除完整覆盖会在原文长度/英文评分暴露；伪造时间不能通过开口标注。真实达不到即失败，不从已有 pilot 分数推导通过 |
| AC-04 进度与处理用时 | `video-audio.fast.test.ts`/`video-tools.test.ts` 断言处理进度随实际已覆盖源时间递增、取消不记故障；一次性 `bun scripts/verify-video.ts --case transcript-performance --samples <60分钟中英法清单>`，记录 Apple 芯片 Mac 中文/英文各 ≤3 分钟、法语 ≤15 分钟及内存/模型摘要；Windows 另记机器与实际用时 | 删除处理进度会缺少中间事实；遗漏说话人/LID 后的耗时、只计缓存命中或仅计一块不算首次全片。卡片呈现和安装包实测等 D3/D4 集成 |
| AC-05 说话人 | 轻量 `video-transcript.fast.test.ts` 检查真实说话人区间与 token 的重叠投影、稳定标签、未知归属不丢文字；一次性 `bun scripts/verify-video.ts --case speakers --samples <两人五轮标注清单>`，正确归属时长 ≥80% | 把所有话归同一人、按窗口重置身份或用 diarization span 裁掉 ASR 文字会失败；只出现两个标签不能证明时长正确率 |
| AC-06 取帧 | `bun test src/main/video-frames.test.ts`：真实录屏已知时点/PTS、请求顺序、interval 与场景首帧/切换帧、旋转/显示尺寸；一次性 `--case frames` 核对 02:00 画面及六页各至少一帧 | 移除实际 seek/PTS 或只抄 requestedMs、漏初帧/切换会与独立帧/页码锚不一致；四页 pilot 不当六页验收 |
| AC-07 本机 OCR producer | `bun test src/main/video-ocr.fast.test.ts src/main/video-ocr.test.ts`：实际 helper 回执/实际图片上的仅画面数字、归一坐标、空 OCR 与有字区分、Mac/Windows 同一输出；禁止走网络替代 OCR | 移除 OCR 或方向转换会缺数字/错坐标；仅把 image 搬到 MCP 不能满足文字断言。两种模型的真引擎回答和零云识图扣费仍由 D4 集成证明 |
| AC-08 检索 | `bun test src/main/video-search.fast.test.ts`：真实转写中的唯一词、Unicode/大小写、时间重叠交集、前后句数/边界；一次性 `--case search` 在固定已处理 60 分钟样本上核实际词位置误差 ≤5 秒 | 重新造时间或仅全文包含判断不能给出正确 match/before/after；文本与范围取并集会返回额外命中 |
| AC-09 持久复用 | `bun test src/main/video-cache.test.ts`：真实新进程/不同会话上下文读同一发布结果且无二次 ASR、同字节异路径汇合、文件变化失效、半写与缺文件不命中、源移走后只答已缓存内容；一次性 `--case cache-restart` 在真引擎核 10 秒内开始回答且没有第二次转写 | 换成内存 Map、仅路径 key、跳过摘要/源变化或重启后重转写均失败；本机函数立即返回不冒充真引擎 10 秒证据 |
| AC-10 导出 | `bun test src/main/video-export.test.ts`：独立解析真实导出的 SRT/VTT、TXT/MD、图片/时间清单并与同一已发布 segment/frame 对齐，全部产物存在且可读；重复导出命名/源保护/错误无半件 | 假写文件、时间单位错、第二次转写改变结果或漏帧清单会失败；只断言文件名后缀不算证据 |
| AC-11 网站 | `bun test src/main/video-download.test.ts`：已准备的真实 yt-dlp 对本机站点公开页/拒绝页、重定向/CDN 的原 egress 允许或拒绝结果；一次性 `--case public-url` 固定一个真实公开链接并记录实际下载及后续本机结果 | 只拼 argv 或手写 yt-dlp JSON 不算下载；绕代理会触发零未批准内容连接的断言，拒绝页必须终结并说明原因。完整回答随 AC-01 集成 |
| AC-12、AC-13 本机准备 | `bun test src/main/video-clip.test.ts src/main/video-prepare.test.ts`：精确起止的实际可解码 MP4/H.264/AAC、M4A/AAC、GIF；01:00–01:30 时长 30±1 秒；完成片段的范围偏移、bytes/sha256/缓存引用及原来源事实一致，内部 payload 不冒充最终回答；系统播放器一次人工播放留待有界面验收 brief | stream copy 造成关键帧误差、伪 H.264/只改扩展名、缺 GIF palette/实际解码、错原时间偏移或丢原敏感来源都会失败；AC-13 上传/答案/资金归 D5/平台 |
| AC-14、AC-16、AC-17 本机边界 | `video-source.test.ts`/`video-tools.test.ts`/输出模块用例：坏实物、有效非媒体、不足空间分别有 code/message/action，取消无成功 ready；一次性 `--case offline-egress` 使用已缓存 pin，断网处理及联网处理出网记录没有转写/取帧/OCR 内容。Windows 在指定包上复跑原 AC，不能用路径字符串测试替代 | 失败字符串当成功、半件被发布、自动云转写/任意下载/上传都会被 typed 结果与出网记录拒绝；安装包、围栏和 Windows 未实测时不能写通过 |

### 偏离记录

暂无。本轮仅展开 D2 计划；没有改 D1 已接受代码、冻结设计或其它仓。样本许可/外部数据说明链接是取证来源，最终夹具须固定实物版本和摘要；本轮不宣称已取得新说话人/六页/法语长片样本，也不把所需测量列为已经通过。

## D3 按需组件、固定文件与分发

待本片 PLAN 展开；范围、AC 和依赖见总览，实施依据为视频设计 §4.2/§6 D3 与许可决定，以及启动器设计 VIDEO-L1-v2、固定文件设计 L2。

## D4 处理进度与帧的模型投影

待本片 PLAN 展开；范围、AC 和依赖见总览，实施依据为视频设计 §4.3/§5 卡片进度/§6 D4。

## D5 平台视频理解桌面接线

待本片 PLAN 展开；范围、AC 和依赖见总览，实施依据为视频设计 §4.4/§4.5/§5/§6 D5。平台契约只消费 producer 固定产物，不在桌面定义副本。

### r3 D2 第一步实施记录

2026-11-26 · 新增严格工具 schema、Node 组件进程执行、源内容/路径索引与原子持久缓存；实际音频夹具为 FLEURS en_us/dev 的原始 WAV，来源与 TSV 行/摘要在 fixtures/video/provenance.json。路径命名与只读身份按计划提取，同一实现由旧 owner 和服务消费。相关四文件 50 pass / 0 fail；ext project-config 28 pass / 0 fail。没有运行未钉住的 ffmpeg 或模型；实际媒体探测与新进程/组件集成断言仍按样本和 D3 就绪情况补齐。

### r3 D1 接缝续接记录

2026-11-26 · 消费 FIRST-PARTY-NODE-v2.1 @ origin/alpha `a586b16fca`，已 fetch/read，未 merge/rebase。新增同一 manifest 的 video 条目、Node 服务源码/构建资源和自动注入消费点；首项仅 `{codepuppyNode}`，不实现展开、matcher、resolveAssets 或重锚。当前 producer 尚未提供 launchers/expandFirstPartyCommand，消费点保持未就绪、不回退解释器；#1760 集成后才核实际自动注入、冷 Node 身份/准备和已持久条目重锚，断言 pending。

构建复用仓内已锁定的 MCP SDK 2.3.1 与 zod，ui-mac 仅增加直接构建依赖声明，bun.lock 仅三条 workspace 声明变化；未引入新版本。新增 `.gitignore` 的 dist-video 规则与 `scripts/prebuild.ts` 构建接线为必要同一调用链文件。清单保留未改的现有 Office producer，#1760 的 v2 producer schema 转换仍归其拥有者，不在本票添加旧版本解析分支。

`bun test src/main/codepuppy-config-injection.test.ts` 在组合运行中通过；服务/快照初测暴露 SDK 高层类无 setRequestHandler，改用其真实 Server 后，`bun test src/main/video-service.test.ts src/main/office-mcp-tools-snapshot.test.ts` 为 4 pass / 0 fail。实际 SDK InMemoryTransport 往返列出同一 schema，未准备工具不冒充执行成功。`bun typecheck` exit 0；服务源码将随 D2 纳入显式类型检查。
