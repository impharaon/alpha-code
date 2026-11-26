---
id: PLAN-video-understanding
title: 视频与录音理解桌面实施计划
summary: alpha-code 的 D1–D5 交付切片及 D1 原路径媒体附件、第一方服务接入的文件、顺序、风险和证明。
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

待本片 PLAN 展开；范围、AC 和依赖见总览，实施依据为视频设计 §4.1/§4.3/§5/§6 D2。

## D3 按需组件、固定文件与分发

待本片 PLAN 展开；范围、AC 和依赖见总览，实施依据为视频设计 §4.2/§6 D3 与许可决定，以及启动器设计 VIDEO-L1-v2、固定文件设计 L2。

## D4 处理进度与帧的模型投影

待本片 PLAN 展开；范围、AC 和依赖见总览，实施依据为视频设计 §4.3/§5 卡片进度/§6 D4。

## D5 平台视频理解桌面接线

待本片 PLAN 展开；范围、AC 和依赖见总览，实施依据为视频设计 §4.4/§4.5/§5/§6 D5。平台契约只消费 producer 固定产物，不在桌面定义副本。
