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

PLAN 阶段暂无；r3 实施的必要文件接线、测试层级调整和待组件实测边界见下方实施记录。样本许可/外部数据说明链接是取证来源，最终夹具须固定实物版本和摘要；未取得的新说话人/六页/法语长片样本及测量不列为已经通过。

## D3 按需组件、固定文件与分发

- 依据：impharaon/alpha-work:SPEC-video-understanding v1 @ `25afeda6285b66b3de9d83531fa2e5a6cafa468f`，AC-15/18 及 AC-01/04/09/14/16/17 的组件与分发段；视频设计 §4.2/§5/§6 D3/§10 @ `870002ed698f1a83efa9d6ecb359ea5a0d0d41af`；本仓 launcher 设计 `VIDEO-L1-v2`、`FIRST-PARTY-NODE-v2.1` @ `a586b16fca`；固定文件设计 L2 @ impharaon/alpha-work `982e258` 的 `docs/specs/domestic-cloud-connectivity/design.md` §4.11/§10；#1775 r4 续派。
- 核对：Phase: IMPLEMENT D3 — #1775 r5 · Claude Opus 5.5（orchestrator）续派，消费 `FIRST-PARTY-CACHE-v2.2` @ `9757157380`：专用 argv 槽交付同代宿主派生的稳定服务缓存根；#1760 expander 未实施的集成断言 pending。r4 已接受 D1+D2 `54ce411e2a..768649a187` 与收据 `b41df39997`；继承其证据，不重复验收。

### 计划发现的输入缺口

下述为 r4 的历史取证与返回；r5 已由本仓 launcher design v2.2 `FIRST-PARTY-CACHE-v2.2` @ `9757157380` 选择专用槽并结束该问题。D3 只给模板增加 `--cache-root`/`{codepuppyCacheRoot}`，调用同一展开器传受保护条目 ID `video`，实际 Node 入口读 argv 原值；不派生应用路径或实现 expander/matcher。

**问题仅为宿主路径如何合法送达独立视频进程，不是 #1760 handler 尚未实现。** 已冻结的 L1 方法可以直接编码为消费端并把集成留 pending；但是它没有提供持久媒体缓存根，当前也没有其它已决定的外部进程读取面：

| 事实 / 固定依据 | 对 D3 的影响 |
| --- | --- |
| 视频设计 §5 要求缓存根由 launcher/userData authority 派生、跨项目/会话持久；`resources/video-mcp/runtime.ts:5–15` 的 D2 私有上下文因此必需 cacheRoot | 不能把项目目录或临时目录当持久根，也不能根据 HOME 自行猜应用 userData |
| `src/shared/video-service.ts:1` 的已提交命令只有 Node、资源内 server.js、workspace；`resources/video-mcp/server.ts:38–39` 的独立入口尚未收到 runtime | D3 必须给实际 stdio 入口接可信 runtime，而不只是给测试注入上下文 |
| `a586b16fca:docs/specs/connector-launchers/design.md` v2 §4.2 的 ManagedPinnedFilesResult 成功只有 `{id,path}`；v2 §4.3 的协议 metadata 只有 call/deadline，业务参数只收 ids | 不能给 ensure 方法私加 cacheRoot/环境字段，不能从 `<runtimeRoot>/assets/...` 的布局倒推根并复制 launcher 的路径 authority |
| 同一设计 v1 §4.3 的 LauncherEnvironment.runtimeRoot 只经宿主 bootstrap 交 sidecar；`packages/util/src/codepuppy-bootstrap.ts:165–166` 是进程内 Symbol 槽，不随 spawn 传入外部 MCP | 在 server.ts import bootstrap 不能取得父进程已发布对象 |
| 同一设计 v2 §4.3 要求显式 environment/cwd 逐字匹配声明，当前 video environment 是 `{}`；v2.1 §4.2 继续保持该规则且不把原生 Node 改作 npm/uv runner | 不能只往配置塞机器路径、借 workspace 槽承载缓存根，或套包运行器的 XDG 覆盖绕过身份核验 |
| `src/main/sidecar-env.ts:58–76,221–246` 不再继承 Code Puppy 路径变量；#1759 R1 的固定包管理器键也没有视频缓存根 | 不能恢复退役的 CODEPUPPY_GLOBAL_DIR，或把普通 XDG/某包管理器缓存反推成 userData |

**交回原设计的问题：给受管视频服务补哪一个只读的宿主运行上下文接缝，至少让 host-derived cacheRoot 在实际 spawn 后可达？**

1. 推荐：在同代已核验首方启动链中投影只读视频运行上下文；根由现有 userData/launcher 路径 authority 产生，明确传输载体及覆盖次序，保持显式配置 environment/cwd 的严格身份规则。消费者不接收 URL/命令/任意目标，不改 L1 的固定文件语义。
2. 或在同一命令展开/匹配 authority 接纳专用缓存根槽；原设计明确它的路径来源、展开签名与精确 matcher，D3 消费该槽，不借 workspace 通配。

两者都不新增用户设置或操作。推荐第一项是为了让目录仍由原 authority 交付、避免增加位置推导。尚未验证的是实际宿主投影及进程围栏可达性；本轮不擅自选择载体或扩展冻结接口。按 r4 的例外，本轮完成本节并返回 PLAN-READY，确认前不写 D3 实现。

### 改动

下表是缺口确认后的执行文件范围；文件名为本片内部实现分工，最终接缝文件以原设计确认的 owner 为准。D3 不实现 #1760 的 downloader、expander、handler、解包、摘要算法或启动状态机，不修改其它仓/relay，不发布资产。

| 文件（相对本仓） | 改什么 |
| --- | --- |
| `packages/ui-mac/resources/pinned-files.json`（新；若 #1760 先落地则合并其现有表） | 仅贡献实际视频模型、ffmpeg 与 OCR 条目，沿同一 PinnedFiles/ocr-model 域；准确 bytes/sha256/originUrl/provenanceUrl 来自真实发布元数据与实物，不覆盖其它 owner 条目，不手写另一套 schema/下载器 |
| `packages/ui-mac/resources/video-mcp/asset-recipes.ts`（新）、`scripts/gen-office-mcp-tools.ts` | 唯一视频配方只存 PinnedFileId、archive、相对 entry/required；把同一配方投影到已存在的 video manifest 项。角色→归档内成员消费同一配方；版本/摘要/URL/下载量只从 pinned-files 读，不能在角色表复制 |
| `packages/ui-mac/resources/video-mcp/assets.ts`（新）、`server.ts`、`runtime.ts` | 消费 L1 的实际 SDK 自定义请求与原调用 metadata/deadline/signal，按工具/实际语言按需取入口，准备完成在同一次 call 继续；取得已确认的可信缓存根后创建 D2 上下文，recipe 指纹包含实际 pin/随包依赖摘要。启动/initialize/list 不准备模型。无直连下载/系统程序回退 |
| `packages/ui-mac/resources/video-runtime/`（新） | 原生依赖/自建源码与网站 wheel 的构建锁及许可证原件；它们是随包构建输入，不能在这里另登一份运行期模型/ffmpeg pin。锁住冻结选定版本、源码摘要、构建命令、对应源材料，不把预编译 macOS 15 Whisper addon 当最低目标构建 |
| `packages/ui-mac/scripts/build-video-runtime.ts`、`build-video-components.ts`（新）、`build-video-mcp.ts`、`prebuild.ts` | 构建 darwin-arm64/win32-x64 原生闭包、Mac Vision/Windows Tesseract helper；制作 LGPL+OpenH264 ffmpeg/ffprobe 两平台归档及对应源代码/许可材料，输出供 orchestrator 发布的实物/摘要，不调用上传。生产安装不跑编译/postinstall；不生成 Intel Mac 行 |
| `packages/ui-mac/electron-builder.config.ts`、`scripts/target-arch.ts` 及各自既有测试 | asar 外只装目标平台的 native/helper/依赖与完整许可；复用现有架构检查/签名链验证 Mach-O/PE、执行位、依赖落点。Mac 最低部署目标消费已有应用目标（本机 Electron Info.plist 为 12.0），不抬高要求；实际发布目标以同次构建的应用事实核对 |
| `packages/ui-mac/resources/NOTICE.txt`、`resources/video-runtime/licenses/`（新）、现有许可证展示读取点（仅必要同链） | 注册 SenseVoice 名称、署名、模型许可全文，以及 sherpa/ONNX Runtime、Whisper、ffmpeg/OpenH264、OCR、网站闭包的各自许可；应用清单与可下载组件内都能核实际材料。沿已有 About/NOTICE 路径，不新增界面 |
| `packages/ui-mac/src/main/video-assets.fast.test.ts`、`video-assets.test.ts`（新）、既有 video-service/tools/snapshot 与构建/架构测试 | 配方/按需集合纯算法用 fast；实际 SDK 嵌套请求/取消/原 call 继续、临时构建/实物清单用 integration；实际模型/包/两地下载测量仅一次性证据或 scenario，不进入轻量测试。外部 metadata/归档夹具必须从原发布捕获并记 provenance |
| `docs/specs/video-understanding/plan.md`、`docs/verification/video-understanding-local.md`（实测才创建）、`docs/architecture/modules.md`（owner 变化时） | 本节记录实际 pins、构建/许可产物、差异与 pending 证据；真实测量才写 verification，不用代码存在宣称验收通过 |

### 顺序

1. **接缝与 pin 数据**：确认上述一个路径输入缺口；只读核对 #1760 已冻结类型/声明形状。用临时目录获取所选模型/源码/许可/构建实物，计算完整 bytes/SHA-256、列归档成员，填唯一 pinned-files 与只引用 ID 的配方。先贡献原厂已有文件；自建/转存件必须有实际字节和目标公开 release 位置，未发布不假称可下载。提交这一单元及同源纯配方断言。
2. **两平台构建与许可**：按平台产出 native/helper、ffmpeg 归档和 source/license 材料，接入已有 prebuild/packaging/signing/架构检查。每个平台的下载总量按真实压缩交付字节求和；中文/英文不取 turbo，其它 script 按锁定 tessdata_fast 集合按需。Mac/Windows 的真实构建/加载分别留证，无机器或产物时明确 pending，不写假 PE/Mach-O 当外部格式夹具。
3. **L1 与原调用接线**：server handler 在同一调用捕获 `_meta["codepuppy/pinned-files.call"]` 与原 deadline，严格只发送 ids；嵌套 request 使用剩余预算和同一取消。返回完整入口后继续 D2 操作。准备进度由 #1760 report authority 归原 call；失败映射 download/disk/cancelled，不改成握手失败/新调用/自动重发用户问题。
4. **相关核对与发布交接**：每步仅跑本模块行为文件；返回前只扩展一次到配方/首方清单/构建目标/许可证枚举的实际消费者及包 typecheck。#1760 handler 未实施仍为集成依赖，不能代写其实现。发布次序沿 L2：orchestrator 先将自建/转存实物附加到已有公开正式 release，再部署快照、逐条 release probe，最后发布消费应用；本会话只交实物与 pin，不执行这些动作。

### 取证后的 pin 表入口

本轮因路径接缝待确认，**没有获取模型/ffmpeg 字节或生成实际 pin**；下表是采集范围，不是可发布清单，不能用待取证值填入运行期 JSON。准确 entry、bytes、sha256 与许可须共同绑定实际交付实物。

| 资产 / 目标 | 选定来源与版本（只引用冻结设计） | pin/实物状态 |
| --- | --- | --- |
| SenseVoice int8 + tokens / any | sherpa asr-models，2024-07-17 | 未取证；设计 F-07 的 163002883 B 只是基线，不当本轮摘要证明 |
| tiny multilingual LID encoder/decoder / any | 同一 asr-models 的已选 int8 tiny 归档 | 未取证；设计 F-07 的 116204861 B 同上 |
| Silero VAD / any | 同一 asr-models 的已选文件 | 未取证；设计 F-07 的 643854 B 同上 |
| pyannote segmentation int8、3dspeaker embedding / any | sherpa speaker-segmentation-models / speaker-recongition-models 的已选模型 | 未取证；真实许可、文件摘要/长度及成员待取得 |
| Whisper turbo q5 / any | ggml-large-v3-turbo-q5_0.bin，原字节转存已有自有正式 release | 未取证/未发布；不能把 provenance 原址当运行期退路 |
| ffmpeg/ffprobe / darwin-arm64、win32-x64 | 自建 9.1 LGPL + OpenH264 2.7.0，沿冻结构建许可边界 | 尚未构建，故没有归档摘要/长度或公开资产 URL |
| 默认 zh/en/OSD 与已有 script 集合 / win32-x64 | tessdata_fast 固定 4.1.0，逐原件转存自有正式 release | 未取证/未发布；映射从该固定集合生成，不手写不完整语言白名单 |

Node/uv、Python 的 pin 仍归 #1760；两平台 native/helper 与 yt-dlp 2026.11.23/配套 EJS 属第一方构建锁/产物闭包，不能混入一个虚构的运行期 family。

### 风险

- 真正的跨进程缓存根输入没有被冻结；先完成本节并交回这一点，不把已有 host 内存对象当成外部 Node 的可用端口，不以路径猜测制造 K2 偏离。
- 原厂模型归档可能包含未用权重、缺随附许可或 release tag 后续被覆盖；只能按完整压缩交付物测量、实物摘要锁定并补齐许可。若所有首次必需归档超过 AC-15 的 400 MB，回报实际数值及受影响输入，不能漏算说话人/LID/ffmpeg 或新增用户等待政策。
- Mac 低部署目标 Whisper 原生构建、Windows OCR/native 闭包和真正 LGPL+OpenH264 产物仍未证实；不能改用 pilot、GPL encoder 或抬高系统版本。失败只退回受影响设计条款，不代换已冻结选型。
- #1760 尚无实现是已知集成依赖；本票测试真实 SDK 消费行为与产物，handler 归属/同代取消/换源续传须在其接入后验证，不能在服务里补第二个 downloader/解包器或状态机。
- 当前没有发布权限：本轮可以计算真实 pin、交付归档与源码材料；没有公开副本就不能宣称香港/原址上线可达。发布者须按固定顺序取证。

### 证明

| AC / D3 分工 | 具名测试或一次性证据（命令从 ui-mac 执行） | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01/15 按需且原调用继续 | `bun test src/main/video-assets.fast.test.ts src/main/video-assets.test.ts src/main/video-service.test.ts src/main/video-tools.test.ts`：真实 SDK 嵌套 ensure，初始化/list 零准备，tools/call 才请求正确 ID/原 meta；准备后同一 call 继续，失败/取消没有假成功 | 急切取 turbo/所有 OCR、丢 call 关联或重启新调用会使请求集合/往返断言失败。宿主实际归属与首次原问题回答仍待 #1760 集成/安装包 |
| AC-09/14 已备离线复用 | 相同资产/配方在新进程由真实已发布入口读回；无准备 URL/系统程序回退；一次性断网包实测 | 用内存目录/临时根、组件未完整即 ready 或联网回退不能通过重启/出网证据。缓存根首先依赖上面的输入确认 |
| AC-15 体积/国内/续传/切源 | 从实际 pinned-files 与配方求两平台中文/英文首次唯一归档集合和准确总字节；缺任何必需角色即失败。北京与 owner 各一次实际组件下载；断点/HK 不可用用例归共享 downloader 的真实入口 | 漏算 diarization/LID、把解压体积当下载量会与 pin 实物不符；源码表不证明国内到达。不得为本票再测伪 downloader；#1760/发布就绪前 pending |
| AC-17 目标闭包 | 构建模块与 target-arch 既有测试补目标产物；实际 Mac Mach-O/deployment target、Windows PE/DLL 闭包及包内真实文件核对；两个平台分别执行 native/helper 加载 | 错平台、未解包 native、缺依赖/执行位、macOS 15 预编译冒充已有目标会失败。Windows 真运行不能由 Mac 字符串断言代替 |
| AC-18 全文/署名 | 实际产物 license inventory 比对：SenseVoice 名称/署名/许可原文摘要，native/模型/编码器/OCR/网站各闭包许可；比对安装资源和已准备目录的真实文件 | 只有 NOTICE 一行、漏模型全文或下载归档无许可不会通过文件/摘要核对；不写断言文案/标题数量的文档测试 |
| AC-04/16 准备进度/失败 | `video-assets.test.ts` 的原 signal/deadline、准备期间进度与 disk/network/integrity/cancelled 分类；安装包核实际原 call metadata | 固定 SDK 短默认超时、延长 deadline、取消后发布 ready 或丢 disk 类别会变红；D4 的界面呈现及真转写性能分开验收 |

计划的删除对照：去掉 lazy 请求集合、去掉 call/deadline 透传、去掉取消传递、漏首次必需归档、装入错误平台 native、漏 SenseVoice 全文，各自须有具名断言红，再恢复转绿。只在实施有真实行为/产物后执行；本轮 PLAN 未执行，不能继承 D1/D2 的七臂作为 D3 证明。

### 偏离记录

2026-11-26 · r4 允许计划后同轮实施，也明确「计划发现冻结设计未定的决定则停止并返回 PLAN-READY」。本轮在真实 server 的 cacheRoot 注入处发现上述一个契约缺口，完成计划后停止；只修改本节，不改冻结设计/其它仓/应用实现，没有生成虚假 pin、构建或测量结果。推荐与替代的载体都交原设计确认，不在此冻结新契约。

本轮收据：Codex / GPT-6，核对 D3 计划与上述固定输入、真实 stdio/spawn/bootstrap 读取面；结论为计划已备、路径交付接缝待原设计确认。通过原 alpha profile 调 canonical `check_docs_contract.check_repo(本 worktree, "impharaon/alpha-code", profile.coordination_repo, profile.project.url, "HEAD")`：本文件 0 finding；仓级 69 errors / 253 warnings，继承既有基线，不顺修。`git diff --check` exit 0。D3 行为测试 PASS 计数与删除对照均为未执行；本轮没有下载组件/新增实际 pin，没有把 D1/D2 证据计入 D3。遗留只交回原设计的缓存根消费面，其余计划待该输入确认后原顺序执行。

### r5 实施接收与首批实物记录

`FIRST-PARTY-CACHE-v2.2` @ `9757157380` 已用 git show 读取，未 merge/rebase。消费者给同一模板增加专用缓存 argv，并把受保护 declarationId `video` 交原 expander；服务从实际 argv 读入 cacheRoot，不建立应用路径推导。L1 消费端只发 ids 与原调用 call/deadline 元数据，嵌套请求使用同一 signal/剩余预算，不使用独立短超时；准备后继续原 Promise，磁盘/取消/完整性分类分别保留。#1760 真 expander/声明/handler 仍为集成 pending。

首批五个原厂模型已在临时目录通过原地址实际下载、完整 SHA-256/长度及归档成员核对，未调用推理，未复制 pilot 模型。下面是实际交付压缩字节，总计 **326403804 B**；它尚不包含 ffmpeg/Windows OCR，不能单独证明 AC-15。唯一运行期记录落在 resources/pinned-files.json，配方只引用 ID/成员；原厂 mutable tag 不作为字节身份。

| ID | bytes | SHA-256 |
| --- | ---: | --- |
| speech-model/any/whisper-tiny-lid | 116204861 | `c46116994e539aa165266d96b325252728429c12535eb9d8b6a2b10f129e66b1` |
| speech-model/any/silero-vad | 643854 | `9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6` |
| speech-model/any/sensevoice-2024-07-17-int8 | 163002883 | `7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e` |
| speech-model/any/pyannote-segmentation-3-0 | 6958444 | `24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488` |
| speech-model/any/3dspeaker-eres2net-base | 39593762 | `f1ee61be04000b50392a63442e5dd9feaea7e81dddd494d3647cf1c3d88a1498` |

实际 SenseVoice 归档的 LICENSE 只有 71 B 的原厂链接，不能当成许可全文。已沿模型卡明确的 FunASR MODEL_LICENSE 取得全文，署名保留 FunASR/Alibaba，原文入 resources/video-runtime/licenses/SenseVoiceSmall.txt；pyannote LICENSE 直接取本次原厂归档。其余许可闭包、构建产物、完整 pin 与结果核对随下个实施单元补齐。


### r5 完整 pin、构建与打包实物

本轮完成 D3 consumer/build producer。唯一运行期 pin 表是 `packages/ui-mac/resources/pinned-files.json`：49 项（6 speech、2 ffmpeg、41 OCR）；Python 仍由 #1760 贡献，视频 recipe 引用其固定 ID，不复制其记录。下表是本轮实际字节证据，不宣称尚未上传的自有 release URL 可用。原厂五项可沿原 URL 获取；turbo、41 OCR 原件和两平台 ffmpeg 共 44 项的自有 release 副本，以及两份对应源码资产，须由 orchestrator 发布后再部署 relay 快照/probe；本会话没有上传或部署。

| ID | bytes | SHA-256 |
| --- | ---: | --- |
| `speech-model/any/whisper-tiny-lid` | 116204861 | `c46116994e539aa165266d96b325252728429c12535eb9d8b6a2b10f129e66b1` |
| `speech-model/any/silero-vad` | 643854 | `9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6` |
| `speech-model/any/sensevoice-2024-07-17-int8` | 163002883 | `7d1efa2138a65b0b488df37f8b89e3d91a60676e416f515b952358d83dfd347e` |
| `speech-model/any/pyannote-segmentation-3-0` | 6958444 | `24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488` |
| `speech-model/any/3dspeaker-eres2net-base` | 39593762 | `f1ee61be04000b50392a63442e5dd9feaea7e81dddd494d3647cf1c3d88a1498` |
| `speech-model/any/whisper-turbo-q5` | 574041195 | `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2` |
| `ocr-model/win32-x64/chi_sim-4.1.0` | 2469156 | `a5fcb6f0db1e1d6d8522f39db4e848f05984669172e584e8d76b6b3141e1f730` |
| `ocr-model/win32-x64/chi_tra-4.1.0` | 2366642 | `529c5b5797d64b126065cd55f2bb4c7fd7b15790798091b1ff259941a829330b` |
| `ocr-model/win32-x64/eng-4.1.0` | 4113088 | `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2` |
| `ocr-model/win32-x64/osd-4.1.0` | 10562727 | `9cf5d576fcc47564f11265841e5ca839001e7e6f38ff7f7aacf46d15a96b00ff` |
| `ocr-model/win32-x64/script-Arabic` | 9311038 | `47c262ac4e843c024df87ffa1363b77a821a843c069c71ef7650f4d2ecfea1e8` |
| `ocr-model/win32-x64/script-Armenian` | 7879909 | `e94e3cfcb79dc6bc24b819ce01340b690f2aabe4c5ac295545ae1bca5d7472f4` |
| `ocr-model/win32-x64/script-Bengali` | 5712242 | `d04c2064bd0ffcd18488c4048d40d88ab056185f3462c2337b52f9e6c51158e5` |
| `ocr-model/win32-x64/script-Canadian_Aboriginal` | 7180795 | `ec11e31e65541a2040982ee8a08514278f850127908df71553f0958cd02609f8` |
| `ocr-model/win32-x64/script-Cherokee` | 4231619 | `76df30145426bde13c7ab07a2cb9a27b415a7d703472424801b35c3c3da3aab7` |
| `ocr-model/win32-x64/script-Cyrillic` | 29252466 | `a80325ebb1c7aa2dca5002ec05b15052a51dcb2e9e65373c264a3df7ac284358` |
| `ocr-model/win32-x64/script-Devanagari` | 17943870 | `3bbb87c1de2a6a2ef0a97dc041e6eea2723a1c22d638f5e38157a5cd441c12b7` |
| `ocr-model/win32-x64/script-Ethiopic` | 9074416 | `4856c53285f9dd28dd130228316cdd506a5172505c99f367d63d84e6467c15f4` |
| `ocr-model/win32-x64/script-Fraktur` | 10915632 | `ac985c3020e42986f8a19e07f1c1b501d47ed7d8e96de69f685bb907aa8db55c` |
| `ocr-model/win32-x64/script-Georgian` | 6949865 | `8da5cc7e2af2c8da04d126ab1f2604904305e548bc3fc20d3c0bae6d519ca013` |
| `ocr-model/win32-x64/script-Greek` | 3041556 | `52e201e4a22336d89ee202b579aca04f15ffd6e5e6af1fe164498f2c7de898e6` |
| `ocr-model/win32-x64/script-Gujarati` | 5017100 | `94643022c1dc06a6b1a96f7dbc3bcc77f455b38e6843cc115a4c9c460b0b32aa` |
| `ocr-model/win32-x64/script-Gurmukhi` | 4213597 | `34c36da0fc59198f009ebbe8646708255fa3ca2553e62645a7b584cbceca8b24` |
| `ocr-model/win32-x64/script-HanS` | 5972903 | `d03c250faaa48015bfde2213f3d7d5bda82bcee93422fceac5906a32073d9152` |
| `ocr-model/win32-x64/script-HanS_vert` | 5429738 | `b555a9a60c88e5e27ddd34541d055200c05492d1f184732518a721faf1db979b` |
| `ocr-model/win32-x64/script-HanT` | 5448070 | `29588327f0d830b5c112209045d826b9be014138266b20f2b08843aac2730fbb` |
| `ocr-model/win32-x64/script-HanT_vert` | 5448267 | `ec4e31daec478e61216b1d9f34e0441fc1fcefacfe4fb28f1ea8bcfcc97ba302` |
| `ocr-model/win32-x64/script-Hangul` | 4845849 | `cae2d12b8cdac6b62643b65915bec347e80970adc55228ca42ac1ec8909b198a` |
| `ocr-model/win32-x64/script-Hangul_vert` | 4725034 | `8fbbd6366654e043038bbcf78b2b8e031c64c2b65f133593d097edee6c7e2ea8` |
| `ocr-model/win32-x64/script-Hebrew` | 4866337 | `4f4f3405404a61e21e5c16316ed5c3052ddb3572a75e0b3dc3fe118b12dea76e` |
| `ocr-model/win32-x64/script-Japanese` | 5877645 | `c176cdca0c17e9be97bda854ac91baea90b92e2813b45749ad05e409477ba8b2` |
| `ocr-model/win32-x64/script-Japanese_vert` | 6445356 | `1d463a4811f3ae174e11b3f87773e07130c1c6aca042f31f7a90c41d939f1538` |
| `ocr-model/win32-x64/script-Kannada` | 6777791 | `1252172cbbe99d27e5e52009a0e79444d555329b82e0b88d6e1f2a601a1b7d86` |
| `ocr-model/win32-x64/script-Khmer` | 4476365 | `330366535d1155974af0f99630df3060c9a98c657b1e4b29f458125f1d10e44a` |
| `ocr-model/win32-x64/script-Lao` | 10103937 | `6bdca344c3ed9ecf405e2f8b5eb0af9832c1de7d92af2f4891867549c1d1fb63` |
| `ocr-model/win32-x64/script-Latin` | 89384811 | `6dbdaf8ecc6c40f025c2648bf3b3f3fbffe073e1fd2df2047fde2e2b2f020d53` |
| `ocr-model/win32-x64/script-Malayalam` | 9007302 | `822ad7ed9fb2eba0b0da5c788ed8710eba651d91777fc659ce0d700cfb99be06` |
| `ocr-model/win32-x64/script-Myanmar` | 7840489 | `78f95e6033824b7c197a099e9fdef55e0742146619d822c9b8d81f933f2b27df` |
| `ocr-model/win32-x64/script-Oriya` | 5744929 | `39fc17f9e30eee261ac08b2d9d3c82bf28e69cff7c38d0a3aea19f1023410ade` |
| `ocr-model/win32-x64/script-Sinhala` | 4782577 | `ce202bfbdc65e677abd76f5349f4765296b3d2b01c87608f49154ad7fa12ec4a` |
| `ocr-model/win32-x64/script-Syriac` | 5803220 | `a89964433928a74de707e6fb61df1e933660de19c969f5301e8195e0219ea9bc` |
| `ocr-model/win32-x64/script-Tamil` | 7089032 | `6857e222c6977986915bd073f669c2cde33039dedde26603ed6be87b0a8d62bb` |
| `ocr-model/win32-x64/script-Telugu` | 6485174 | `615dd18355098058d77a45ee3bacc5d36aca574880c1b6099011f2aca09f2d1c` |
| `ocr-model/win32-x64/script-Thaana` | 6048323 | `aae14e808cc783e00fe37af8afa67ff09c8d01b454065b7633e014eb2b5b6e2d` |
| `ocr-model/win32-x64/script-Thai` | 4249016 | `d9e34be94556ddb65fd7e04892ff606e1a5b696d0eb422b5a7efc6859943702d` |
| `ocr-model/win32-x64/script-Tibetan` | 5699531 | `0c869d52597d5b03eb6f52c5d0c217514e883259ead05765c0329e5a536538ae` |
| `ocr-model/win32-x64/script-Vietnamese` | 1667794 | `30546eea618459e79761f962391e6879778b026ad7b4459a11664a1b654758bd` |
| `ffmpeg/darwin-arm64/9.1-openh264-2.7.0` | 21408316 | `fa3bb967e71c7bb934924822799d2f633197e6b972430961cbbf8a651bdaf98f` |
| `ffmpeg/win32-x64/9.1-openh264-2.7.0` | 22408571 | `5b42585b521c1e4dd708ec01b2c1f02812c3f254d8cc658ff9989bd314aebffe` |

首次完整中文/英文处理按压缩交付物去重：Mac = 326403804 + 21408316 = **347812120 B**（6 项）；Windows 再计默认 OCR 19511613 B，总计 **368323988 B**（10 项）。两者均小于 400000000 B；不取 turbo 或其它 script。`firstVideoPins()` 同时用于精确集合/体积核对，缺任一角色/pin 即失败。这不是北京/owner 网络速度或首次回答实测。

构建锁 `resources/video-runtime/build.lock.json` 只登记随包构建输入，运行期不读取它下载模型/codec：Whisper wrapper 来自 npm 1.1.3 的 gitHead `3e05649a6aab6c52bb566ef731231ba5296b7885`，完整源码仓为 mybigday/whisper.node；cpp submodule `978113305b2ead22249b881deafa131dc8884911`。Mac 实际自建 Metal/CPU N-API 6、min macOS 12.0；Windows 实际 LLVM-MinGW x64 CPU 自建，关闭 host-native 与 AVX/AVX2/FMA/F16C 的编译基线依赖。sherpa 2.0.3 的 JS/native 原包按现有 bun.lock SHA-512 获取；网站闭包为 yt-dlp 2026.11.23 + 它要求的 EJS 0.8.0 wheel，无安装时编译/postinstall/系统程序退路。

Windows OCR 已从真实 Tesseract 5.5.2 / Leptonica 1.85.0 / libjpeg-turbo 3.1.2 静态构建，内部帧为 JPEG，保留 OSD 所需 legacy engine。交叉构建显式使用已关闭 TIFF 的返回事实，启用 `_USE_MATH_DEFINES`，不是改写上游输出格式。Mac Vision helper 实际编译为 arm64/min12；没有引入新用户选项。FFmpeg 9.1 + OpenH264 2.7.0 两平台实际编译、归档，仅交付程序与许可证/来源；构建明确 `--disable-gpl --disable-nonfree --disable-autodetect --enable-libopenh264 --disable-network`。原始源码与可重放 `BUILD.sh` 分开同 release 分发，不计入首次下载量。归档关闭 AppleDouble 元数据。

| 对应源码实物 | bytes | SHA-256 |
| --- | ---: | --- |
| `video-ffmpeg-9.1-openh264-2.7.0-darwin-arm64-source.tar.gz` | 72899604 | `e7038a3f43b9222b2443b3f54015ff69abeca4b0d993061aba3658dca8d44c2a` |
| `video-ffmpeg-9.1-openh264-2.7.0-win32-x64-source.tar.gz` | 72899721 | `b08d6c4f3b9300d46879e20bcc9cec90aaae8961e774f8d5c337da7de06d1012` |

构建命令（ui-mac；临时根保存在 `/tmp/video-d3-r5-root.txt`，产物未发布）：`bun scripts/build-video-runtime.ts darwin-arm64 <temporary-root>` 与 `win32-x64` 均成功，实际目标产物分别落 ignored `native/video-runtime/build/mac-arm64` / `win-x64`；`bun scripts/build-video-components.ts <target> <temporary-root> <temporary-root>/release` 两平台成功。最后只按同一 tar 命令排除 AppleDouble 重打包，表中摘要对应最终实物。发布者从临时根的 `release/`、`sources/ggml-large-v3-turbo-q5_0.bin`、`ocr-models/` 取实际字节；原始 OCR 路径/对应摘要见该根 `ocr-evidence.json`。

实际只读产物检查：`otool -l` 的五个 Mac native/helper 最低版本为 11.0/12.0，没有 macOS 15 addon；`otool -L` 只有同目录两个 sherpa dylib与系统库/框架。Node 26.13.1 / N-API 10 实际加载完整 sherpa JS 与自建 whisper JS/native，`OfflineRecognizer` 和 `initWhisper` 均为 function；这是 ABI/闭包加载，不是模型准确率或转写速度证据。`llvm-objdump -p` 核 Windows 6 个 native/helper：两个应用内 DLL 关系闭合，其余为 Windows 系统/UCRT DLL；没有缺失 VC runtime 依赖。Windows 本机加载/实际播放和安装包验收仍 pending。`ffmpeg -version/-L/-encoders` 确认 9.1、LGPL、libopenh264/GIF encoder；没有执行未由 pinned preparation 提供的媒体推理。

许可 `licenses.json` 对 20 份真实全文记录来源/摘要，包含 SenseVoice 的 5306 B Model License（FunASR/Alibaba）与 ONNX Runtime 1.28.2 的 MIT/325054 B ThirdPartyNotices。后者来自 sherpa 2.0.3 自己 CMake 指定的 csukuangfj/onnxruntime-libs 1.28.2 归档，完整归档 SHA `d9e5c0c79929e201f5b8eb095e6809a91ce78be9866a1bca0dfab7e20b40ae40`，不使用不存在的同号 npm 包/上游 tag 冒充来源。许可随 native/helper 一起进入 `video-mcp/`，NOTICE 沿既有读取面指向完整材料。

必要同链补充：`scripts/video-runtime-artifacts.ts` 统一持有产物/平台/全文检查及签名后摘要封装；新测试在该模块独立文件，real header 夹具由这次两平台真实 Whisper addon 截取并记录完整产物/片段摘要，没有发明 PE/Mach-O。`prebuild` 先产 native 闭包再生成同一 tools.json 的 codeSha256。额外修改 `.gitignore` 是隔离目标构建目录；`scripts/old-name-exceptions.tsv` 仅登记本轮固定 release 外部 URL 的机械新命中。

签名会改写 native 字节；因此 Mac 沿 electron-builder 已有 signer/entitlements/identity，在子文件签名之后、父 app seal 之前刷新 inventory 与同一 video 声明摘要。未配证书时改用该 signer 的 `identity: "-"`，取代 fuse 深签的独立 ad-hoc 步骤，避免摘要更新后再被深签改写；没有改变签名身份或围栏权限。Windows 在 afterSign 刷新。临时复制真实 Electron.app（ditto 保留相对 symlink），加实际 native/服务资源后调用配置里的 signer，`codesign --verify --deep --strict` 与 `checkVideoRuntime()` 都通过；没有启动应用/访问生产。初次 Node cp 把框架 symlink 改为绝对路径，探针失败后改用 ditto，通过的是第二份临时副本；不把第一次失败当成应用缺陷。完整 Code Puppy 包/Developer ID/Windows 签名仍待发布侧。

### r5 测试与接收边界

新增 fast 为纯配方/集合/压缩字节算术；integration 为真实 SDK 嵌套请求/取消、文件摘要/真实目标 header/许可全文及签名封装边界。测试静态 import 被测模块，读取的 pin/许可/fixture 路径为 literal，按受影响 PR 跑；不把真实构建、签名、模型质量/性能/国内网络测量加入 PR 永久套件。Office snapshot 保留 Office 全声明、video 源码/schema/配方的一致性，并验证实际 inventory 中所有文件均进入 codeSha256；native 字节由 producer/包前包后校验，不在每次轻测重新构建。

步骤核对：`bun test src/main/video-assets.fast.test.ts src/main/video-assets.test.ts src/main/video-runtime-artifacts.test.ts src/main/office-mcp-tools-snapshot.test.ts` **11 PASS / 0 FAIL**；service/tools/snapshot 相关步骤 **7 PASS / 0 FAIL**；旧名登记补齐后 `bun test src/main/old-name-scan.test.ts` **10 PASS / 0 FAIL**。`bun typecheck` exit 0。初次 SDK 探针修正为已安装 2.3.1 的 custom-schema handler 和第二参数 request options 后通过；没有改 SDK/放松断言。

`affected-tests --list` 已执行但此分支不存在 `.gate-tests`，输出 `affected-tests: [Errno 2] No such file or directory: '<worktree>/.gate-tests'`，没有生成 scope line；按本票 gate frozen 交编排器/门控维护者，不在本票添加配置或跑全量。新测试不修改 global setup、runner 或 dependencies。最终相关集合和删除对照在下一收据追加，不用上述步骤计数冒充最终结果。

| AC / D3 边界 | 本轮已核 / 待接收 |
| --- | --- |
| AC-01/04/15 | lazy/原 call 关联、原 deadline/signal、真实 SDK 取消和失败分类已核；#1760 expander/declarer/handler、正常准备进度/继续原问题的真实调用 pending |
| AC-09/14 | cacheRoot argv 原值、持久配方含实际 pin/native 摘要已核；跨重启无二次转写/断网包/出网记录为真实集成 pending |
| AC-15 | 两平台精确首次集合/字节已核；44 个副本+2 源码资产未发布，HK/原址/续传与两地实测 pending，归 orchestrator/#1760 |
| AC-16 | disk/cancelled/network/integrity 分类与同一 call 的返回已核；D4 界面/真实损坏样本的包体验收接续 |
| AC-17 | 两平台真实构建、Mac ABI/最低版本、Windows PE/DLL 核对已核；Windows 本机执行和完整安装包 pending |
| AC-18 | 完整许可及应用资源投影、下载 ffmpeg 归档中的许可/对应源码已核；最终安装包清单仍须发布侧验收 |



### r5 最终核对收据

D3 代码/实物提交：`9929af424c`、`6bc8ccbf0a`；本收据提交继续包含最终同链修正。最终相关范围由实际 import/清单读方确定：14 个 video 模块文件，office snapshot、mac-target-arch、release-source、config injection、bootstrap builder、old-name scan，共 20 文件；`bun test` 逐一显式列出这些文件（原命令/输出保存在 `/tmp/video-d3-related-final.log`）为 **142 PASS / 0 FAIL / 3278 assertions**。`packages/util` 下 `bun test src/codepuppy-bootstrap.test.ts` 为 **20 PASS / 0 FAIL / 118 assertions**。这些为最终集合计数，不与步骤计数累加。`packages/ui-mac` 下 `bun typecheck` exit 0；`git diff --check` exit 0。

相关集合首次发现本票引入的 10 个红：before/afterPack 的新检查抢在既有发布/架构失败之前、旧包夹具缺视频资源，以及旧 ad-hoc 机制断言。修正为先守原发布/引擎架构检查，再加载 video validator；视频打包/签名 helper 为分支内 lazy import，配置拷贝夹具无需复制与自己失败面无关的构建模块。更新已被替换的 Windows no-op/签名断言，包夹具增加真实截取的两平台 header 和完整许可。`bun test src/main/mac-target-arch.test.ts src/main/release-source.test.ts src/main/video-runtime-artifacts.test.ts` 完整 **57 PASS / 0 FAIL**，继而最终集合全绿。新增必要同链文件 `src/main/fixtures/video/runtime.ts` 仅供两个模块复用自己的 inventory fixture；`release-source.test.ts` 删除 Windows 以前无操作的前置调用，使该测试继续只验证原有 Mac 发布先行规则。没有放松架构/完整性/许可阈值，没有修理全仓。

删除对照均在已提交实现在单一具名用例中执行，每臂 exit 1 且恰为 1 FAIL，随后 `git restore` 该文件；最后上述集合为绿：

| 删除臂 | 具名命令（ui-mac） | 红的事实 |
| --- | --- | --- |
| 提前准备 turbo | `bun test src/main/video-assets.test.ts -t "component preparation is lazy"` | 1 FAIL / exit 1 |
| 丢 call/deadline metadata | `bun test src/main/video-assets.test.ts -t "component preparation is lazy"` | 1 FAIL / exit 1 |
| 替换原取消 signal | `bun test src/main/video-assets.test.ts -t "component preparation is lazy"` | 1 FAIL / exit 1 |
| 漏 speaker embedding 首次归档 | `bun test src/main/video-assets.fast.test.ts -t "first complete"` | 1 FAIL / exit 1 |
| 跳过真实 native 平台检查 | `bun test src/main/video-runtime-artifacts.test.ts -t "wrong-platform"` | 1 FAIL / exit 1 |
| 跳过全文许可校验 | `bun test src/main/video-runtime-artifacts.test.ts -t "full SenseVoice"` | 1 FAIL / exit 1 |
| 签名封装不更新 native 摘要 | `bun test src/main/video-runtime-artifacts.test.ts -t "signature finalization"` | 1 FAIL / exit 1 |

文档按 alpha-work/governance/delivery-profile.yml 调 canonical `check_docs_contract.check_repo(本 worktree, "impharaon/alpha-code", coordination_repo, project.url, "HEAD")`：69 errors / 253 warnings，与既有记录相同；本 plan 0 finding，modules.md 的 13 个已知失效包路径保持未改。没有把这些基线项目当成本票新缺陷。

遗留去向（record and continue，不顺修）：

- `packages/ui-mac/src/main/codepuppy-sidecar-wiring.test.ts:38` — 第一条最终联集在既有 Electron mock 的模块导入阶段触发依赖 `electron/index.js:8` 的 install.js 自动下载，已终止自己那条安装/测试进程，没有运行 Electron/app；该文件和同样直接导入 server 的 sidecar-bootstrap-gate 未计入最终 PASS。`docs/runbooks/ci.md` 指向 bin/setup/native-prepare，但本票不跑安装或修此依赖状态，交测试环境维护者。其余集合单独完成，不以重跑该红/挂起项赌结果。
- `<worktree>/.gate-tests` — `affected-tests --list` 最后再次执行，仍报 No such file，未产出 scope line；交 orchestrator/gate owner，本票 gate frozen，不添加替代选择器或全量跑。
- `docs/architecture/modules.md:24` 等 — 13 个既有目标失效，整体文档 checker 基线 69/253；交文档治理，不修。
- `docs/runbooks/ci.md:15` — 仍写 pre-push 全量，与本次 owner「只跑相关/全量夜间」指令不符；只按本次明确指令执行，交文档维护者，不改运行规则。

非阻塞待接收仍按上表：#1760 的真实 expander/declarer/ensure 及冷 Node、缓存 argv 身份、进度/断点/换源/原调用继续；orchestrator 发布 44 副本与两份源码、部署 relay/probe；真模型准确率/速度/说话人、北京与 owner 网络、断网/出网与完整安装包/Windows 真实运行。D4/D5 未实施。本轮没有 paid call、上传、生产联络、push/PR/merge 或 app/window 启动。OPTIONAL：无。已核：Codex / GPT-6；冻结设计与接缝未变。


## D4 处理进度与帧的模型投影

- 依据：impharaon/alpha-work:SPEC-video-understanding v1 @ `25afeda6285b66b3de9d83531fa2e5a6cafa468f` 的 AC-04/07/14/16；冻结视频设计 §4.3、§5「卡片进度」、§6 D4、§10 @ `870002ed698f1a83efa9d6ecb359ea5a0d0d41af`；#1775 r6 续派。D3 的 pins、原调用/SDK 取消与真实组件证明继承 `9929af424c`、`6bc8ccbf0a`、`07d05e8291`，不重跑模型/构建/签名测量。
- 核对：计划 `0c5739736e`；#1775 r6「Now D4 … Append D4's plan section and implement it in the same round unless it reveals an undecided design question」授权同轮实施。Codex / GPT-6 自检冻结输入与实际路径；未发现需改变冻结设计的分叉，不自称独立审查通过。

### 改动

本片只接处理通知、已有卡片与同一 vision authority；不实现 #1760 preparation/expander/generation 机制，不建视频云识图客户端，不实施 D5。沿 delivery-implement / delivery-docs 的既有工作流，文档影响落本节及必要的模块职责行。

| 文件（相对本仓） | 改什么 |
| --- | --- |
| `packages/schema/src/codepuppy-video-progress.ts`（新） | 持有本仓视频处理进度的类型、窄 metadata 键与纯校验；服务、core、UI 消费同一份，不能各列一份 phase/unit 或接受通知自填 callId |
| `packages/ui-mac/resources/video-mcp/runtime.ts`、`server.ts`、既有 `src/main/video-service.test.ts` / `video-tools.test.ts` | 服务发送完整 phase/completed/total?/unit，经真实 MCP token 关联；同一调用的通知顺序与完成边界不伪造百分比，不在取消后继续发布处理状态 |
| `packages/core/src/mcp/codepuppy-video-progress.ts`（新）、既有 `mcp/client.ts` / `mcp/index.ts` / `tool/mcp.ts` | 自有 helper 消费 SDK progress 的视频 metadata；现有已收编 MCP 文件仅作标注的小接线，从本次 Tool.Context 捕获 Effect context，逐层交本次 SDK request，不借 initialize 的 Location，也不修改 #1760 冻结 preparation 签名。生命周期沿 SDK 当前 request/signal，旧请求不写另一调用 |
| `packages/core/test/codepuppy-mcp-runtime.test.ts`、`test/fixture/codepuppy-mcp-startup-stdio.ts`（必要时） | 用现有真实 MCP/Location harness 核处理进度到本次 Tool.Context、并发调用/取消/终态的归属；不手写 SDK 格式夹具，不加入时间性能/容量用例 |
| `packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/cards/tool-card-model.ts` / `tool-cards.tsx`、既有模型与组件测试、`src/renderer/i18n/{zh,en}.ts` | 在已有卡片/步骤复用现有文字和事实行呈现 phase、真实时间/字节/项；无 total 不显示百分比。只对已持久化首方视频 display snapshot 显示视频解释；已治理 vision 调用的帧来源显示实际时间点，不让同名第三方冒充 |
| `packages/ext/src/cloud-vision-hooks.ts`、`cloud-vision.ts`、`plugin.ts`、必要的 `policy/index.ts` | 同一登记/投影 authority 接入 frames 的真实 image、frameId/sourceId/actualMs/OCR；沿现有 policy facts 判已核验工具，不能凭 namespace 授信。当前模型能看图就保留图与 OCR；不能看图只给 OCR/时间及按需引用，空 OCR 也不自动上传。vision 追问沿现有压缩/路由/缓存，并将实际帧时间交原工具卡 metadata |
| `packages/ext/src/context-injection.ts`、既有 inventory snapshot / `cloud-vision.test.ts` / `context-injection.test.ts` / policy 相关测试 | 注册必要的 OCR 不可信内容 wrapper 与 frameId 追问说明；在模块既有测试中核零自动网络、按需原 vision 路线、图文模型、空 OCR、多个帧引用与重建。仅同步实际登记条目，不放宽内容注入上限/来源规则 |
| `docs/specs/video-understanding/plan.md`、`docs/architecture/modules.md`（必要时）、既有 manifest producer 输出 | 记录实际接线、删除对照、范围与 pending；服务编译字节变化时由 D3 producer 同步 codeSha256，不手改摘要、不重建 native |

### 顺序

1. 提交本计划。进度先走 producer → 真实 SDK → 原 MCP/Tool.Context → 已有卡片；在已收编文件内只加消费自有 helper 的调用/参数，不新增上游接管路径、公共 HTTP/Server API 或第二个进度状态机。D3 的 preparing 仍由 #1760 接收。
2. 在原 vision authority 接 frames。结果内容从 D2 schema 与实际 MCP 转换路径读取；文本正文继续是不可信材料。登记帧引用不能被现有普通图片的 32 项内存淘汰规则默默截掉；按帧这个域处理，不为视频加新配额，也不改变普通图片的既有行为。
3. 将按需 vision 的实际 frame 引用/时间映射到原卡片，完成组件行为验证。最后仅扩展到真实 import/枚举读方一次，执行包 typecheck、affected-tests --list、文档核对和删除对照，提交收据。不跑 gate/全包/应用/真实模型或付费上游。

### 风险

- MCP client 当前 `onprogress: () => {}`；插件 API 只提供 MCP 配置 editor，没有通知 hook。读取已收编文件和 ADR-047 精确接管面后，在原 MCP 链上加本次调用 callback；若实施证明需要新增未收编上游路径或改变 #1760 的冻结接口，停止回报具体接缝，不绕到新连接/IPC。
- core 与模型历史的 ToolResult 内容不是原始 MCP structuredContent 形状；以实际转换源码与 SDK/真消息类生成结果核对，不能把自制 payload 误认成外部格式。frame 元数据必须与同一次返回的图片按顺序/身份绑定，不按文件名猜图。
- VisionSession 当前按内容去重并限制普通图片登记数；同字节不同时间点的帧仍需各自 frameId 引用，不能覆盖时间点、丢后面的帧或把 OCR 成功视为视觉理解。
- 首方 identity 的 #1760 producer 尚未实施；本片消费该 authority 的真实判定面并明确 pending，不伪造 bundled 证据让同名服务通过。真实包/模型/出网记录仍不由轻测代替。

### 证明

| AC / D4 分工 | 具名证据 / 命令（从相应包执行） | 层与运行时机 | 删除行为为什么会失败 |
| --- | --- | --- | --- |
| AC-04 处理进度 | `ui-mac: bun test src/main/video-service.test.ts src/main/video-tools.test.ts` 的真实 SDK 处理通知；`core: bun test test/codepuppy-mcp-runtime.test.ts -t "video progress"` 的本次 Context/并发/取消归属 | integration；受影响 PR 与 nightly | 去掉完整 metadata、client callback 或 Tool.Context 接线，通知/归属断言变红；不会用 server 自报 callId 或 initialize context 填补 |
| AC-04/16 既有卡片 | tool-card-model 既有文件与 `test-component/session-timeline.cases.ts` 中具名视频进度/无 total/第三方/取消状态断言 | fast 或 integration；按既有 runner 的受影响 PR 与 nightly | 去掉 phase/实数投影、制造百分比、接受无首方 display，会使模型/真实 DOM 断言变红 |
| AC-07 能看图模型 | `ext: bun test src/cloud-vision.test.ts -t "video frame"`：真消息类/生产 context hook 保留图+OCR，桩 endpoint 请求数为 0 | integration；受影响 PR 与 nightly | 自动 transcribe、丢 OCR 或图片运输/注册会让内容与零请求断言失败 |
| AC-07 非视觉先 OCR | 同文件：有 OCR 与空 OCR 都只本机投影，frameId/source/time 完整；正文定界符按原 wrapper 安全规则处理 | integration；受影响 PR 与 nightly | 删除 OCR 分支会出网或只留下 unsupported media，断言失败；不靠模型桩“答对”伪造 AC-07 真引擎验收 |
| AC-07 按需 vision | 同文件：后续按 frameId 调原 vision，走原压缩/固定模型/缓存面，当前卡片 metadata 是实际帧时间；同字节多个 frameId 可分别引用 | integration；受影响 PR 与 nightly | 不登记 frameId、错误去重时间、复制新云客户端或丢卡片来源会失败 |
| AC-14 本机默认不出网 | 上述 frame context 的桩 endpoint 计数 + 无访问凭据情况下仍能获得 OCR；既有普通贴图/Read 用例保持原行为 | integration；受影响 PR 与 nightly；真实出网/断网包为一次性 pending | 视频 OCR 路径若依赖 cloudVisionAccess/transcribeEntry 即变红；不宣称这些轻测已证明 OS 出网记录 |

计划删除对照：去掉 producer 完整 progress、切断 client→Tool.Context、去掉卡片来源/计数、让视频重新走自动 transcribe、去掉 frameId 登记、丢按需 vision 的时间 metadata。每个以具名断言变红后恢复；不继承 D3 的七臂当作本片证据。

### 偏离记录

- 原计划 Tool.Context 归属证明落在既有 `core/test/codepuppy-mcp-tool-collision.test.ts` 的真实 McpTool/Tool registry harness；SDK 并发通知仍在 runtime 既有文件。新增自有 helper 的 fast 文件随模块命名，不按票命名。
- 必要同链 `ui-mac/src/main/codepuppy-video.ts` 使用已有 `codemode:false` 让本机视频工具直接调用；`core/src/codemode/tool.ts:150-156` 明确将内部 progress 置空，且外层只保留 execute 输出/文件、丢帧所属工具身份。没有改 Code Mode、增加选项或另接状态机。声明断言在既有 video-service 测试；#1760 冷身份/自动注入仍 pending。
- 同一 `cloud-vision.ts` 内提取 `describeEntry` 供原自动图片转写与主动帧追问共用压缩/HTTP/错误/缓存；问题参与原缓存键，避免相同帧的另一问题拿旧答案。没有新增视觉客户端。新 frame 引用/时间共用 schema 的窄 metadata，普通图片行为不变。
- 视觉投影用仓内原始 `packages/ai/test/fixtures/images/edit-source.jpg`（128×128 JFIF、Lavc60.31.102）不改字节，配 D2 output schema 与实际 Message/ToolResultPart 类；仅证明投影/路由，不称它是 OCR/ffmpeg 实测样本。没有新增虚构媒体格式。
- 服务 JS 字节变化由 D3 原 producer 重生同一清单；组件/native/pin 不重建。组件集合初次外层命令触发 Bun 默认 5 秒超时（75 PASS、1 timeout）；具名原因是嵌套集合的外层时限，按既有 runner 单独执行 cases 完成 125 PASS / 6.07 秒，最终用命令行 `--timeout 30000` 检查受影响集合，不改断言或生产限制。

- 最终联集首次 core 225 PASS / 1 FAIL：`mcp.test.ts` 的既有请求数据精确断言遇到新增 callback 字段。尝试同步其两条期望后单文件 107 PASS，但 north-star 指出该上游测试不在接管面；已恢复该文件，未改 gate/ADR。最终把本次运行期 callback 与请求数据分开，以 `callTool(input, videoProgress?)` 沿已收编链传递；原上游请求字段和测试均不改，SDK/本次 Context/原断言定向 3 PASS，最终相关集另核。这是 callback 的私有传递位置调整，没有 #1760 preparation 字段/协议更改、兼容分支或新工具参数。

r6 允许同轮计划后实施；本节不重作冻结技术决定，不新增界面稿。D3 接缝/发布/真模型/Windows 实测仍 pending；D5 不在本轮。

### r6 D4 实施与返回收据

已核：Codex / GPT-6，按 r6 授权实现自检。计划 `0c5739736e`；实现 `38a22d7d9e`；运行期 callback 独立于请求数据 `a60a5af67a`。`核对` 已在第一实施提交填写。只完成 D4，没有实施 D5、改冻结设计/接缝或新增视觉客户端。

| D4 AC 分工 | 具名证据与结果 | 仍待实物/集成 |
| --- | --- | --- |
| AC-04 处理进度 | `local video progress carries full processing facts…` 真 SDK producer；`video progress follows each real SDK request…` 并发 token；`video progress binds the whole current invocation context…` 当前 Effect Context；fast helper 核取消/非法/迟到通知；`verified video progress…` 与 `video progress updates the existing card…` 核真实覆盖时间、无 total 字节、首方来源、终态与 DOM 更新 | #1760 generation/prepare、冷 Node 的真实通知与原调用继续；60 分钟真模型速度/打包产物进度 |
| AC-07 / AC-14 的帧投影 | `video frame OCR is local for both model capabilities…` 两模型能力/空 OCR/离线均零 HTTP；实际 Message/ToolResultPart、D2 schema、原 JPEG；`video frame vision runs only on demand…` 原 `/v1/tools/vision`、千问/禁 fallback、压缩、同图不同实际时间、相同问题缓存/重建、不同问题再取、402 typed 失败 | 真六页录屏/OCR 数字与模型答案；打包产物断网及完整出网记录。上述零 HTTP 仅证明此投影路径，不冒充全应用断网验收 |
| AC-16 的本片边界 | SDK typed cold failure、取消后不发布状态与 frame vision 失败沿已有错误合同；坏输入 metadata 不冒充进度/实际帧，第三方同名不获卡片解释/帧登记 | D2/D3 已列的损坏媒体/不支持格式/空间不足真实组件用例仍 pending，不把本片轻测当作三项实测 |

最终相关集按实际 import、MCP 服务 mock、卡片 kind/工具枚举、上下文注入清单和 producer 摘要读方选取；并行命令各用 `--max-concurrency 2`（机器当时存在其它 gate 进程），没有全包测试、bin/check 或 gate run。命令均从对应包执行：

```bash
# packages/core — 226 PASS / 0 FAIL，10 文件，825 assertions，33.74 秒
bun test test/codepuppy-video-progress.fast.test.ts test/codepuppy-mcp-tool-collision.test.ts test/codepuppy-mcp-runtime.test.ts test/codepuppy-mcp-tool-generation.test.ts test/mcp.test.ts test/mcp-attach.test.ts test/mcp-instructions.test.ts test/mcp-oauth.test.ts test/codepuppy-command-model-priority.test.ts test/schedule.test.ts --max-concurrency 2 --timeout 30000
# packages/ui-mac — 209 PASS / 0 FAIL，11 文件，4171 assertions，8.73 秒
bun test src/main/video-service.test.ts src/main/video-tools.test.ts src/main/office-mcp-tools-snapshot.test.ts src/main/codepuppy-config-injection.test.ts src/main/config-injection-throat.test.ts src/main/old-name-scan.test.ts src/renderer/codepuppy-ui/session-timeline/cards/tool-card-model.test.ts src/renderer/codepuppy-ui/session-timeline/cards/tool-card-provenance-gates.test.ts src/renderer/codepuppy-ui/session-timeline/cards/cards-contract.test.ts src/renderer/codepuppy-ui/session-timeline/process-fold.test.ts src/renderer/codepuppy-ui/session-timeline/session-timeline.test.ts --max-concurrency 2 --timeout 30000
# packages/ext — 247 PASS / 0 FAIL，9 文件，1369 assertions，9.74 秒
bun test src/cloud-vision.test.ts src/context-injection.test.ts src/plugin-host.test.ts src/plugin-setup-order.test.ts src/plugin-fanout.test.ts src/policy/register-policy.test.ts src/policy/inventory.test.ts src/project-config.test.ts src/register.test.ts --max-concurrency 2 --timeout 30000
```

UI 的既有 wrapper 实际运行 `test-component/session-timeline.cases.ts`，子集合 **125 PASS / 0 FAIL，986 assertions**（单独完整验证 6.07 秒），不是只核字符串或跑新例。外层首次默认 5 秒超时及 core 初次参数精确断言的红/修正见偏离记录；最终 source/test 不含未授权上游测试变更。只有 core 调整 callback 位置后重跑该受影响集合，其余已绿集合没有再次重复跑。

`bun typecheck` 在 schema（143 files）、core（2048 files / 2 projects）、ext、ui-mac 各 exit 0。`bun scripts/build-video-mcp.ts` 与 `bun scripts/gen-office-mcp-tools.ts` exit 0；同一 manifest 仅 video `codeSha256` 同步，snapshot 真实临时构建通过，没有重建 native/pins。`bash scripts/north-star-guard.sh` 最终 exit 0；`git diff --check` exit 0。

七个生产删除对照均为具名 expect 断言红、exit 1，逐个恢复自身文件后才跑最终绿集；最终 callback 位置调整后仅重核 SDK/call-context 两臂。临时记录 `/tmp/video-d4-removal-arms.json` 与逐臂日志不充当安装包/真实模型验收：

| 删除臂 | 对应包 / 文件 / `-t` | 红的实际原因 |
| --- | --- | --- |
| producer-meta | ui-mac / video-service.test.ts / `local video progress` | 真实 SDK 收不到完整 phase/completed/total/unit |
| sdk-callback | core / codepuppy-mcp-runtime.test.ts / `video progress` | 两个真实调用的处理数组为空 |
| invocation-context | core / codepuppy-mcp-tool-collision.test.ts / `video progress` | 本次 Context 未收到更新 |
| card-count | ui-mac / tool-card-model.test.ts / `verified video progress` | 源覆盖时间变成零，实数断言失败 |
| automatic-upload | ext / cloud-vision.test.ts / `video frame OCR` | 非视觉模型的视频帧走自动转写，零 HTTP 断言失败 |
| frame-id | ext / cloud-vision.test.ts / `video frame OCR` | 两个实际时间的 frameId 不再能查到 |
| frame-time | ext / cloud-vision.test.ts / `video frame vision` | 主动选帧的回显时间变成零 |

单独移除 video 分派的一重 authority 检查未红，因为上层通用 authority 闸仍挡住第三方；未把该无效切除计入七臂，改切实际数字投影证明卡片行为。无断言删除或阈值放宽。

遗留去向（record and continue）：

- `<worktree>/.gate-tests` — `affected-tests --list` exit 2，`No such file or directory`，**未产出 scope line**；与 D3 相同，交 orchestrator/gate owner，不改 frozen gate 或补一个假 selector。
- 文档 canonical checker `check_repo(worktree, "impharaon/alpha-code", coordination_repo, project.url, "HEAD")`：**69 errors / 253 warnings**，本 plan 0 finding，与 D3 基线相同；modules 的 13 个旧失效包路径交文档治理，本票仅补 schema authority 的模块职责行。
- #1760 真实 declarer/expander/身份/缓存 argv、generation/preparation/断点换源与原调用继续仍交 #1760；D3 发布/relay、真实模型与完整打包/Windows 测量继承原 pending，不以本片 mock authority 或本机轻测宣称通过。

本轮未启动 app/Electron/window，未真实模型/付费调用、上传/部署、push/PR/merge 或 merge/rebase。OPTIONAL：无。下一片由 orchestrator 续派 D5；D4 没有新设计问题。

## D5 平台视频理解桌面接线

- 依据：impharaon/alpha-work:SPEC-video-understanding v1 @ `25afeda6285b66b3de9d83531fa2e5a6cafa468f` 的 AC-13 桌面入口/上传显示/最终结果，及本片涉及的 AC-09/14/16/17 边界；冻结视频设计 @ `870002ed698f1a83efa9d6ecb359ea5a0d0d41af` §4.1、§4.4、§4.5、§5、§6 D5、§10；#1775 r7 允许同轮计划与实施，但出现未定设计问题时先返计划。D4 已由 r7 接受，继承其进度/vision/卡片证据，不再审查 D1..D4。
- 核对：本节为 r7 的计划产物；尚未实施，待下述唯一运输预算接缝处置。续派后首个实施提交填写本计划 commit 与检查收据，不自称独立审查通过。

### 改动

本片文档影响为 interface/data 的实施计划与验证证据，canonical 落本节；实际 producer 契约仍由平台拥有。冻结设计的类型、错误、资金与权限规则只引用，不另定 DTO/schema、价目或上游参数。

| 文件（相对本仓） | 改什么 |
| --- | --- |
| `packages/codepuppy-contracts-consumer/scripts/vendor-codepuppy-contracts.ts`、独立 `alpha-platform-video-understanding.lock.json` / `vendor/alpha-platform-video-understanding/`（新） | 仿现有 capability-scoped/commitBound pin：视频 schema、producer 正负 fixtures 与必要的运输权威产物一起固定 Git commit/路径/SHA；不推动其它已锁 bundle。具体运输产物待下述接缝回复，不能把私有实现当作新公开 contract |
| 该包 `src/decode.ts` / `types.ts` / 既有 `contracts.test.ts` | 四种视频值统一从该 pin 校验，包含 source_range 半开区间、模型默认值/声明、usage 安全整数等语义；导出的类型只是 consumer 投影，不在 ext/main 各写 schema。完整结果文件读出的对象走 decoder，不能错误套用控制信封文本 reader 的容量界 |
| `packages/ui-mac/resources/video-mcp/contracts.ts` / `tools.ts` / `prepare.ts` / `clip.ts`，既有 `video-service.test.ts` / `video-tools.test.ts` / `video-contracts.fast.test.ts` | 增加 understand 的产品输入/最终输出与内部 prepare 执行结果；内层仅准备完成 clip/来源引用。自动分片继续使用同一受限服务/真实组件和源时间，不让 main 新起 ffmpeg 或从模型参数取得可执行路径。必要的压缩参数按平台实际运输界派生；不加总时长/片长用户帽 |
| `packages/ext/src/video-understanding.ts`（新）/ `plugin.ts` / 既有 policy facts reader | 用 ToolEditor.update 包住实际已核验的首方 understand；可信 session/agent/callId 从本次 Tool.Context 注入，原 signal/progress 贯穿 prepare 与 bridge。未核验同名工具不获 main 上传入口；CLI 无 parentPort 返回明确原因。内部准备 payload 不作为最终答案返回模型 |
| `packages/ext/src/hub-bridge.ts`、`packages/ui-mac/src/main/codepuppy-sidecar-messages.ts` / `hub-view.ts` / `ext-ipc.ts`（必要 composition wiring）、既有两端消息/host 测试 | 扩展同一 parentPort 请求簿记与消息族 `codepuppy.video.understand`，先回持久 requestId，查询/订阅/取消关联同一调用；长上传不塞入 20 秒 RPC。main 只接受可信路由和宿主根内该调用已完成的 clip，不接受自填 authority、任意原文件读取或新 L1 业务通道 |
| `packages/ui-mac/src/main/codepuppy-video-cloud.ts`（新） | main 独占 §5 云请求记录/原子写/同 key 文件锁：读取已有记录后继续原 attempt/job，回执前与回执后的持久化顺序、未知结果的同字节重放、重启重接、分片结果/usage/jobIds 顺序合并、成功缓存及 tenant 隔离；不保存 token/consent。仅在原 job 已确认为失败/无扣费后建立新 attempt。并发订阅合并，取消一订阅不损坏其它订阅 |
| `packages/ui-mac/src/main/codepuppy-upload.ts` / `codepuppy-upload-manifest.ts` / `cloud-ipc.ts`、既有上传测试 | 扩展原上传状态 authority 的 typed 视频分支，复用 pending/confirm/cancel、当前身份/租户、敏感签发与消费。快照仅用宿主完成记录核过的 bytes/SHA/MIME，来源敏感性取宿主附件事实或已经授权原路径；保留原名/路径标记，不扫描二进制冒充文本，也不把所有视频一概判敏感。不复制另一套隐私状态 |
| `packages/ui-mac/src/main/codepuppy-cloud-jobs.ts`、必要窄 `codepuppy-video-transport.ts`（新）、既有 cloud jobs cases | 现有发现/认证/错误咽喉下读模型描述、流式 multipart、同控制字节重接、进度/取消；不继承 JSON 派发的 15 秒整体超时。控制字段与文件长度按实际序列化核算；运输精确上游界消费 producer 权威数据，当前缺口不能补常量。状态/取消沿原 job API，产物沿 listCloudArtifacts/downloadCloudArtifactTo/artifact.read，不新增出网 client 或资金写者 |
| `packages/ui-mac/src/preload/{types,index}.ts`、`src/renderer/index.tsx` 的宿主挂载、既有 `renderer/extensions/upload-consent-dialog.tsx` / 测试与 `i18n/{zh,en}.ts`（必要时） | sender/session 从可信调用恢复；原上传确认卡复用视频目的/范围，普通内容无确认，不开选择文件框。沿原入口公开安全预览和 confirm/cancel，不把 token/manifest 泄露给 renderer。UI 只复用已有批准组件/工具卡，编辑前核 PAGE-MAP 与相应复用依据，不创建新视觉方向 |
| `packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/cards/tool-card-model.ts` / 既有模型与组件测试 | 将已持久化首方 understand 加到既有视频工具规则；同卡显示上传实际字节、理解进度和所有实际 jobIds 对应结果/账本关联，不把内部准备或截短文本显示为完成。原 D4 metadata authority 不重建 |
| 对应既有 `codepuppy-upload*.test.ts`、`codepuppy-cloud-jobs.cases.ts`、`codepuppy-sidecar-messages.test.ts` / `hub-view.test.ts`、`ext/src/hub-bridge.test.ts`；新 owner 的 `codepuppy-video-cloud.test.ts` / `codepuppy-video-transport.test.ts` / `ext/src/video-understanding.test.ts` | 在最低可捕捉层验证下表；新文件仅因新 module 尚无测试。跨系统消息用真实 producer bytes，内部请求/持久状态由实际代码产生，禁止编造 ffprobe/平台回执。只跑相关文件与最终真实导入/mock/枚举读方 |
| `packages/ui-mac/resources/office-mcp/tools.json`（原 producer 输出）与 `docs/specs/video-understanding/plan.md`，必要 `docs/architecture/modules.md` 职责行 | understand 定义/服务代码变化后通过既有 build/gen 脚本同步同一 manifest；不手改 SHA、不重建 D3 native/pins、不改 gate 或受保护 ADR |

### 顺序

1. 仅提交本计划。先由平台 producer/设计者处置下述精确预算缺口；本轮不选一个新公开字段或在桌面复制私有上游表，不触碰其它仓。修正后按原 vendor producer 同步视频独立 pin/真实 fixture，并在第一实施提交填核对行；先跑该 decoder 的具名正负例。
2. 内层 understand prepare 与 ext 外层、main 窄桥一起建立；先核已验证身份/完成产物/可信调用归属、进度和取消，再连实际 HTTP。main 的 clip 打开/realpath/长度/SHA 复核与来源敏感判定属于准入，不靠 connector 自报 safety。
3. 扩原上传 authority 和 binary transport；先持久化原 attempt/envelope/manifest/clip，再派发，先写真实 jobId，再等待。原状态/产物读取返回完整结果；已有记录分别核未知/在途/完成/明确失败/取消，不为了重启刷新键或重传已 ready 字节。
4. 接运输超界、非 JSON 413 和 provider_timeout 的自动本机压缩/连续分片，范围带原偏移并按顺序合并；确认原作业失败/不扣费后才重试新字节。最后复用原隐私卡/工具卡，不增用户步骤。恢复命中只用完整且摘要正确的 clip/结果。
5. 每步仅改动用例/行为文件；末尾按 import、服务 mock、工具枚举、manifest/snapshot 与上下文登记读方扩一次相关集、包 typecheck、affected-tests --list、north-star/旧名及文档核对；删除对照恢复后跑绿并提交收据。无付费调用/窗口/完整 gate 或整包测试。真安装包与 Windows 场景留既有验收路径。

### 风险与需处置的唯一设计问题

**SEAM-CHANGE-NEEDED：VideoUnderstandingV1 的上游请求精确预算数据。**

冻结设计 `impharaon/alpha-work:docs/specs/video-understanding/design.md:280` 要求桌面发送前用实际 `prefixBytes + 4*ceil(videoBytes/3) + suffixBytes` 校验。当前固定候选 schema 只公开 `upstream_request_bytes_limit`；没有 prefix/suffix、固定 JSON 开销或可调用的同权威 serializer。opaque revision 不能反推这些字节。实际前后缀由平台私有 `videoUpstreamJsonParts(row, question, mime)` 依赖上游模型/推理参数生成，而这些参数明确不由桌面另定。`upload_media_bytes_exclusive` 的 producer 算式只交集 inline 与 multipart 入站界，不能把它当作已扣除上游 base64/JSON 开销的界。

只读证据已结束该调查（不扫描其它平台模块）：

- 平台工作分支 `feat/621-video-cloud-tool` @ `1331acbf742b17d1bf371bf747a7d3e55f7e89ef`；schema 首次引入 `a2f3c43851a1e9c8c4f1ebd24493ed246d0bdeba`；`git show HEAD:contracts/v1/video-understanding.schema.json` 的 SHA-256 为 r7 指定的 **f7e20441ea3c07e681bf3003abee3655ba840cbf8f6ce76a5f29cbd88a2d6d66**。这三个相关源文件无未提交差异。`origin/main` @ `dfd8a1bb2141a61bd65f42cf2a08773f5c0dfd6a` 尚无该 artifact；当前候选必须说明来自未合并分支，不假称来自主线。已读该 repo 的 origin/main，未 merge/rebase/改平台代码。
- `impharaon/alpha-platform:packages/gateway/src/lib/video-models.ts:91-94` 的 `videoUploadMediaBytesExclusive` 只减控制/入站 framing；`:115-122` 的实际公开投影没有出站 serializer 数据；`packages/gateway/src/lib/video-transport.ts:53-71` 依赖私有 row 的模型参数构造 prefix/suffix 并计数。schema 的 `$defs.VideoModelsV1.properties.models.items.properties`（同 SHA 产物）只有 `key,label,revision,mimes,inline_media_bytes_exclusive,upload_request_bytes_limit,upload_media_bytes_exclusive,upstream_request_bytes_limit,context_tokens,output_tokens,price`。
- 一次性 Python 读取该 schema 输出：`upstream serializer/budget data: []`；纯整数算式 `raw_bytes=78643200; base64_bytes=104857600; upstream_limit=104857600; JSON_overhead_remaining=0`。因此不能只对比 base64 长度与上限；也不能加一块自选余量冒充实际前后缀。未下载模型、未运行媒体引擎/上游、未发付费调用。

需要的最小处置（二选一，由原设计/producer 拥有者决定，本计划不裁决）：

1. **建议：平台从同一 serializer 派生并发布可固定的精确预算数据/纯计算产物**，能由模型行/revision、实际 question 的 JSON/UTF-8 编码、MIME 与视频字节数算出完整上游请求长度；保持上游参数唯一归属平台。D5 pin 该修正产物/fixture 后照冻结精确校验实施，无用户可见变化。
2. 原设计明确改为桌面仅精确核入站，出站交平台预检及 413 后自动分片；会改变冻结设计 :280 的桌面职责，且可能多传一轮媒体。未经该处置不能把它作为本票普通实现选择。

未验证前提：不存在另一份已批准、可固定且已向桌面公开的运输预算产物；若平台提供它的路径/版本，即可用同一 pin 消费结束问题，不必新增字段或重作其它设计。这里没有要求新增模型/报价、用户配置、限制或确认。

其余实施风险沿既定方案处理，不新开问题：主进程不能信任随机 clip 名带来的宽松敏感事实；已落盘请求的未知结果不能当作失败；取消与重启不能重复付费；完整结果 artifact 不能被通用 inline scrub/控制信封 reader 截掉；本机准备与最终模型答案 schema 必须分开；D3/#1760 真身份集成继续 pending，不用 mock 冒充集成通过。

### 证明

| AC / 本片行为 | 具名证据 / 对应命令（从包目录） | 层与运行时机 | 去掉行为为什么红 |
| --- | --- | --- | --- |
| AC-13 契约与完成答案 | contracts-consumer 的 `contracts.test.ts` 加 `video producer fixtures decode through the pinned schema`；main 新 owner 的 `video full result follows the registered artifact reference`，读取 producer 的 inline/artifact/负 usage/未知字段真实 fixture | fast decoder / integration 本机 HTTP 与文件；受影响 PR 与 nightly | 错模型/负 token/额外字段被接受，或 artifact 分支只返回 ID/截短文本，断言失败 |
| AC-13 原工具/桥归属 | ext `video-understanding.test.ts` 的 `verified understand wraps preparation and returns the final cloud result`；既有 `hub-bridge.test.ts` / `codepuppy-sidecar-messages.test.ts` / `hub-view.test.ts` 的 video request/query/cancel case | integration，实际 ToolEditor/消息簿记，受影响 PR 与 nightly | 去掉 authority/可信调用关联、把 prepare 冒充答案、长任务占住首个 RPC、错误/取消仍报成功会红 |
| AC-13 上传与隐私 | `codepuppy-upload.test.ts` / `codepuppy-upload-manifest.test.ts` 的 `video uses the same sender and tenant bound consent state`；`video binary transport preserves control bytes and streams the real file` | integration，本机 server + 真实媒体文件；受影响 PR 与 nightly | 源敏感路径被 clip 名冲掉、跨 sender/tenant 确认、无同意上传敏感内容、任意/变更/逃逸文件、JSON/base64 控制体或伪字节数会红；普通视频确认次数须为零 |
| AC-09 / AC-13 重启与缓存 | `codepuppy-video-cloud.test.ts` 的 `video resumes a persisted dispatch or job without minting another attempt`、`video successful cache is tenant and model revision scoped` | integration，实际文件记录/锁与新服务实例；受影响 PR 与 nightly | 先派发后落盘、丢响应换键/控制字节、已有 job 重派发、未知结果当失败、换号命中旧答案、失败写成功 cache 均红 |
| AC-13 自动缩片 | `codepuppy-video-cloud.test.ts` / `codepuppy-video-transport.test.ts` 的 `video size and timeout recovery preserves source coverage and original jobs` | fast 预算/范围算法 + integration 本机 HTTP；受影响 PR 与 nightly | 边界少算 JSON/base64、忽略非 JSON 413、在原 job 未失败时重派、丢偏移/片段/usage/jobIds，或要求用户重发会红 |
| AC-13 上传显示/取消，AC-16 错误 | 原 upload dialog、tool-card-model 与 session-timeline cases 追加 video 目的、实际上传字节/无 total、继续原卡片、所有在途取消和迟到成功不入 cache | fast 模型 / integration Solid 与 main 调用；受影响 PR 与 nightly | 无上传进度、错误空白、取消只停 UI、失败或内部 prepare 被显示为成功会红。平台失败是否真正零扣费仍由 #621 的 settlement 证明 |
| AC-14 本机默认与 AC-17 两平台 | 继续 D4 零自动 HTTP；桥/stream 不依赖单平台路径；真实无讲话按钮录屏、本机包 Mac/Windows 的成功/上游失败/未登录/余额不足各次 | 真实场景/收费验收为 nightly 或授权一次性记录；本轮不执行 | 无有效结果/次序/原账本事实或完整产物就不得记通过，不能用 mock 结算代替平台证明 |

样本只使用平台 producer 的 `contracts/v1/fixtures/video-understanding/{input,result,job-inline,job-artifact,models-test-price,input-unknown-model,input-unknown-field,result-negative-usage}.json` 等原字节与来源说明。binary 流/摘要测试候选是平台已有真实 `packages/gateway/test/fixtures/video-understanding/sample.mp4`（1019 B，SHA-256 `c0f31876d4a3763354a8b1979f0b5c48b54f7e700100a7e945841bad932c142a`），provenance 同目录 JSON 记录原 zh_test.mp4 摘要与真实 ffmpeg 命令；取用时与产物同 commit 固定，不编造容器或解码输出。它仅证明真实字节传输，不冒充三按钮动作识别样本或 D3 pinned 编码器实测。

实施后的删除对照至少覆盖：verified wrapper、原字节/attempt 持久化、已有 job 重接、同租户成功缓存、上游精确字节开销、敏感来源沿同 authority、完整 artifact 读取、范围覆盖与取消全部在途 job。逐臂具名 expect 红后恢复，最终只扩相关集。当前为计划阶段，**未运行这些用例、0 新 PASS、0 删除对照**，不继承 D4 的七臂冒充 D5 证据。

### 偏离记录与 r7 计划收据

2026-11-26 · 只读阶段已确认上述跨仓预算输入缺口，按 r7「unless an undecided design question appears」停在 PLAN；本轮只写本 D5 节，没有写业务代码、vendor/pin 或修改冻结设计。候选 pin 来自未合并分支的事实已记录，实际 pin 等同权威运输数据被指明/补齐再提交。

已核：Codex / GPT-6，核对 r7、冻结 §4.4 :280、平台候选 schema SHA、实际投影/serializer 与现有 bridge/upload-state/artifact seam；不是设计重审。已定勿重开：D1..D4、原桥、同一上传/身份/敏感确认 authority、main 独占云状态、平台资金及价目归属。下一步交 orchestrator/平台 producer 或原 designer 仅处置上述预算数据，然后续派 D5 实施；其余原接缝/付费/包/Windows pending 继承，不顺修全仓问题。

本轮检查：canonical `check_docs_contract.check_repo(worktree, "impharaon/alpha-code", coordination_repo, project.url, "HEAD")` 为既有 **69 errors / 253 warnings**，本 plan **0 finding**；`git diff --check` exit 0。`affected-tests --list` exit 2，仍因本 worktree 缺 `.gate-tests` 未产出 scope line，遗留交 orchestrator/gate owner，不改 gate。只有本 plan 变更，没有测试/类型检查/业务改动，故没有新增 PASS 或删除臂可报。

### r3 D2 第一步实施记录

2026-11-26 · 新增严格工具 schema、Node 组件进程执行、源内容/路径索引与原子持久缓存；实际音频夹具为 FLEURS en_us/dev 的原始 WAV，来源与 TSV 行/摘要在 fixtures/video/provenance.json。路径命名与只读身份按计划提取，同一实现由旧 owner 和服务消费。相关四文件 50 pass / 0 fail；ext project-config 28 pass / 0 fail。没有运行未钉住的 ffmpeg 或模型；实际媒体探测与新进程/组件集成断言仍按样本和 D3 就绪情况补齐。

### r3 D1 接缝续接记录

2026-11-26 · 消费 FIRST-PARTY-NODE-v2.1 @ origin/alpha `a586b16fca`，已 fetch/read，未 merge/rebase。新增同一 manifest 的 video 条目、Node 服务源码/构建资源和自动注入消费点；首项仅 `{codepuppyNode}`，不实现展开、matcher、resolveAssets 或重锚。当前 producer 尚未提供 launchers/expandFirstPartyCommand，消费点保持未就绪、不回退解释器；#1760 集成后才核实际自动注入、冷 Node 身份/准备和已持久条目重锚，断言 pending。

构建复用仓内已锁定的 MCP SDK 2.3.1 与 zod，ui-mac 仅增加直接构建依赖声明，bun.lock 仅三条 workspace 声明变化；未引入新版本。新增 `.gitignore` 的 dist-video 规则与 `scripts/prebuild.ts` 构建接线为必要同一调用链文件。清单保留未改的现有 Office producer，#1760 的 v2 producer schema 转换仍归其拥有者，不在本票添加旧版本解析分支。

`bun test src/main/codepuppy-config-injection.test.ts` 在组合运行中通过；服务/快照初测暴露 SDK 高层类无 setRequestHandler，改用其真实 Server 后，`bun test src/main/video-service.test.ts src/main/office-mcp-tools-snapshot.test.ts` 为 4 pass / 0 fail。实际 SDK InMemoryTransport 往返列出同一 schema，未准备工具不冒充执行成功。`bun typecheck` exit 0；服务源码将随 D2 纳入显式类型检查。

### r3 D2 音轨与持久结果实施记录

新增 `speech-worker.ts`：同一独立服务内的原生推理 worker，避免同步 diarization/ASR 阻塞 MCP 的取消；这是 audio.ts 的必要执行文件，不增加宿主执行入口。冻结的 sherpa 2.0.3 与 Whisper 1.1.3 以 `bun install --ignore-scripts` 锁定，未运行 postinstall/下载模型；原生库的随包构建仍归 D3。完整样本域切块、tiny LID 分路、实际 token/segment 时间、整轨说话人稳定标签、完成 chunk 的持久恢复和搜索已接入；重叠说话保留未知，不删除文字。私有 `runtime.recipe` 由准备者提供算法与该平台实际 pin/随包资产摘要的指纹，不能用版本标签代替。

补充 source/probe 的前后 identity 复核、发布值/引用文件摘要、新进程读取、取消锁等待者与流式子进程失败清理。新增 `video-process.test.ts` 是字节传输/取消的真实子进程用例，不模拟编解码器；`video-transcript.test.ts` 因实际写缓存而使用文件系统层命名，代替计划中的 `.fast.test.ts`。命令 `bun test src/main/video-contracts.fast.test.ts src/main/video-source.test.ts src/main/video-cache.test.ts src/main/video-process.test.ts src/main/video-audio.fast.test.ts src/main/video-transcript.test.ts src/main/video-search.fast.test.ts`：13 pass / 0 fail，50 assertions。缓存投影数据为本机内部 schema，未冒充 sherpa/ffprobe 回执。真实模型的 AC-03/04/05 与对照评分、长片性能仍 pending；没有用 pilot 模型绕过 pin。

### r3 D2 画面、输出与工具实施记录

新增 frames/OCR、Vision helper 源码、精确 clip/GIF、项目导出、网站与 understand 内部准备；同一源时间/缓存结果接 info/transcript/frames/search/export/clip/gif/download。工具入参严格校验，返回经过同一 output schema，frames 按原顺序携带真实图片与 OCR/时间；内部 prepare 未冒充 understand 最终答案。组件、缓存根、资产指纹和策略代理只来自可信私有运行上下文，尚无 D3 准备者时返回 typed 未就绪。服务器将原调用取消与本机进度接入 MCP；D4 的 metadata/模型投影另验。Node native addon 由 D3 随包提供，不运行时安装。

`bun test src/main/video-service.test.ts src/main/video-tools.test.ts src/main/video-frames.test.ts src/main/video-export.test.ts src/main/office-mcp-tools-snapshot.test.ts`：10 pass / 0 fail，53 assertions；含实际 SDK stdio 子进程发现/未就绪调用、缓存工具往返、源时间选帧算法、独立字幕时间解析、产物存在/冲突/逃逸与软链。stdio 用测试进程 Bun 检查 wire/build，不宣称已验证 launcher Node。移开自身忽略的 dist-video 后，原 snapshot 因 ENOENT 为红；改为在临时目录构建服务/worker再重新生成清单，两个 snapshot 转绿，干净检出无需预存构建结果。

必要同链同步：`scripts/build-video-mcp.ts` 构建 worker，清单同一 `codeSha256` 登记两个 JS；`office-mcp-tools-snapshot.test.ts` 消费临时构建路径；`scripts/old-name-exceptions.tsv` 仅把已存在的两处词元登记移动到提取后的 owner。扫描初测为 41 pass / 2 fail（新位置未登记/旧位置处数失效）；修正后与 snapshot 合跑 12 pass / 0 fail。没有删除或放宽守卫。

`scripts/verify-video.ts` 已提供真实结果的质量/说话人离线评分入口：校验实物/原文/实际结果 SHA-256 与 sourceId、两臂与固定 20 句、时长门槛、时长计说话人一致映射，输出计算口径及实际分数；不接受旧分数作为输入。当前标准化明确为 NFKC/小写、中文字符和字母数字词、英文保留词内撇号；尚未取得完整固定验收样本，不声称 pilot 的归一化分数可直接比较。`bun build ./scripts/verify-video.ts --target=bun --outfile=/tmp/codepuppy-video-verifier-r3.js` exit 0。性能/安装包/出网/网站/播放器一次性测量入口须随 D3 的实际准备上下文及样本接线，不能用不受 pin authority 管理的路径补成可运行的假验证。

| 本片 AC 证据边界 | 当前状态 / 遗留去向 |
| --- | --- |
| AC-01/03/04/05/08/09 | schema、完整覆盖/真实时间算法、稳定说话人投影、检索、持久结果/新进程/取消等待者已有轻量证据；真实中文/英文/法语、20 句标注、两人五轮、首次性能、真引擎回答与缓存 10 秒仍待 D3 准备后原 AC 实测 |
| AC-06/07 | 时点/scene 首帧/顺序算法及 Mac/Windows OCR producer 源码已落地；固定六页/真实 PTS、实际 helper/TSV 回执与只在画面数字尚未取得，对应 OCR/实际帧集成测试文件暂不创建，交 D3/D4 接线验收 |
| AC-10/12/13 本机段 | 字幕解析/输出/源保护与内部片段准备代码已落地；真实 LGPL+OpenH264/AAC、GIF 解码与系统播放、prepare 实物摘要/范围仍待 pinned 编码产物，不用参数断言替代 |
| AC-11/14/16/17 | 网站 argv/代理与 typed 失败、取消/空间 errno、缓存及源变化边界已落地；真实 yt-dlp 本机站点/公开 URL、坏媒体/不支持格式的实际 probe、隔离空间不足、断网/出网与 Windows 包仍 pending；已有 WAV 为唯一新增媒体夹具，不声称其它夹具已取得 |

以上是已接受「没有已准备组件时只验证独立模块、实物断言 pending」的实施边界，未更改冻结设计/AC。真正的安装包、质量与平台答案不由源码存在推断通过。

### r3 返回前核对收据

已核：Codex / GPT-6，实现自检，依据 spec v1、冻结设计 `870002ed69`、已核 D2 plan `129df72433` 与 r3 FIRST-PARTY-NODE-v2.1 续派。实现提交 `54ce411e2a`（D1 消费端）、`c234e76753`（来源/缓存/共用 owner）、`d5f73f4ab4`（音轨/转写/搜索）、`768649a187`（画面/输出/工具）。未 push、未 merge/rebase、未启动应用或付费调用。

返回前按 import/工具枚举/旧名登记的相关集只扩展运行一次：ui-mac **270 pass / 0 fail，21 文件，3143 assertions**；ext **39 pass / 0 fail，2 文件，109 assertions**。ui-mac 与 ext 分别 `bun typecheck`，exit 0。命令分别在对应包目录执行：

```bash
bun test src/main/video-contracts.fast.test.ts src/main/video-source.test.ts src/main/video-cache.test.ts src/main/video-process.test.ts src/main/video-audio.fast.test.ts src/main/video-transcript.test.ts src/main/video-search.fast.test.ts src/main/video-frames.test.ts src/main/video-export.test.ts src/main/video-tools.test.ts src/main/video-service.test.ts src/main/office-mcp-tools-snapshot.test.ts src/main/codepuppy-config-injection.test.ts src/main/codepuppy-workdir.test.ts src/main/artifact-manifest.test.ts src/main/codepuppy-artifact-download.test.ts src/main/artifact-service.test.ts src/main/cloud-artifact-guard.fast.test.ts src/main/codepuppy-root-retirement.test.ts src/main/visible-brand-copy.test.ts src/main/old-name-scan.test.ts
bun test src/project-config.test.ts src/register.test.ts
```

以下删除对照各只改一处生产行为、`bun test <文件> -t '<case 前缀>'`，每个 exit 1 且为具名断言红；逐个 `git restore -- <自身文件>` 恢复，六个相关文件合跑 **12 pass / 0 fail，53 assertions**，再进入上述相关扩展集。临时日志在 `/tmp/video-r3-removal-<arm>.log`，不作为仓库内验收实物。

| arm / 去掉什么 | 文件与 case 前缀 | 实际失败含义 |
| --- | --- | --- |
| coverage / 最短尾覆盖 | video-audio.fast.test.ts / audio coverage retains | 单样本域未被识别窗覆盖 |
| token-time / 使用实际 token 起点 | video-audio.fast.test.ts / visible text retains | 600/2400 ms 句起点变成 0 |
| file-digest / 验引用文件内容摘要 | video-cache.test.ts / published media results require | 同长度变更的文件仍被当成完成项 |
| source-change / 原路径 identity 核对 | video-source.test.ts / source identity hashes | 已改变的原文件仍可被打开作旧内容 |
| frame-pts / 使用实际呈现帧 | video-frames.test.ts / frame selection preserves | 把请求 79 ms 冒充实际 40 ms |
| search-range / 时间交集 | video-search.fast.test.ts / transcript search intersects | 区间外唯一词仍被返回 |
| subtitle-ms / 保留毫秒余数 | video-export.test.ts / subtitle exports parse | 独立解析的时间不再与源 segment 一致 |

文档影响落在同一 plan 与 modules map。调用 canonical `check_frontmatter/check_id_references/check_local_links` 检查这两文件：frontmatter/ID 与 plan 链接无问题；modules 的链接检查为红，13 个失效目标全部在 `129df72433:docs/architecture/modules.md` 原样存在（一次基线确认）。`docs/architecture/modules.md:24`（以及 25/28/29/30/31/37/38/43/47/49/56/60）— 旧包/目录链接已不存在 — 建议去向：编排器后续 docs governance，当前只记录，不在本票修复。此前全仓文档检查的既有错误不据此清理。`git diff --check` exit 0。

已定勿重开：本地/平台分工、实际库/许可证路线、VIDEO-L1-v2、FIRST-PARTY-NODE-v2.1 和唯一 pinned-file authority。下一步由编排器安排 D3 PLAN；#1760 接入后补真实身份/冷 Node/自动注入，D3 后补上表实际组件/样本证据，D4/D5 分别负责进度投影/平台答案。无新增设计分叉或 OPTIONAL 产品项。
