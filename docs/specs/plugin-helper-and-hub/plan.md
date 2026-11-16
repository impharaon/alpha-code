---
id: PLAN-plugin-helper-and-hub
title: 一句话安装插件与统一管理实施计划
summary: 切片 A 的 Claude 来源、统一安装入口、对话安装与时间线证据，以及对切片 H 的接缝依赖
kind: plan
status: active
spec: SPEC-plugin-helper-and-hub
design: DESIGN-plugin-helper-and-hub
owners: [owner]
last_reviewed: 2026-11-16
---

# PLAN-plugin-helper-and-hub｜一句话安装与统一管理实施计划

## 切片 A

- 依据：[Issue #1724](https://github.com/impharaon/alpha-code/issues/1724)；[SPEC-plugin-helper-and-hub v3](https://github.com/impharaon/alpha-work/blob/8663fb2a982eaf7c626bfee3bcd8b20b870f2577/docs/specs/plugin-helper-and-hub/spec.md) AC-01；[DESIGN-plugin-helper-and-hub v3](https://github.com/impharaon/alpha-work/blob/8663fb2a982eaf7c626bfee3bcd8b20b870f2577/docs/specs/plugin-helper-and-hub/design.md) §2、§4.1–4.4、§4.6–4.7、§5–6、§8 A、§10；转换类型与发现规则继承 [DESIGN-local-plugin-install §4.1/4.5](https://github.com/impharaon/alpha-work/blob/8663fb2a982eaf7c626bfee3bcd8b20b870f2577/docs/specs/local-plugin-install/design.md)。沿用两轮设计处置，只返回下述新实测及 H 接缝缺口。
- 核对：b46a8702d4 · orchestrator/Claude Fable 5.2 · plan check passed for A1–A3（AC-01 chain has failing-capable proof per stage, files inside the allowed scope, no frozen decision restated, no restriction added）；A4 stays pending the H seam delta。r1 的 Phase: IMPLEMENT 本轮仅授权 A1；A2–A3 等 H 合入与分支刷新，A2 另等 runtime 设计修订提交。
- 代码基线：本车道 `265c42529e`，工作树 `alpha-code-feat-helper-install-slice-a`，派定分支 `feat/helper-install-slice-a`；Bun 1.4.4。H 只读基线为 `feat/hub-package-one-row@f4b5a10424`（含 `8a8e0f4d19`），另有 renderer 在途修改，观察于 2026-11-16；消费其[计划「片 1 · 桌面」](../local-plugin-install/plan.md)，不修改该工作树。
- UI：[11-15 批准帧](../../design/2026-11-15-plugin-package-install-and-card/frame.html#install) @ `265c42529e` 的装后反馈及现有时间线卡片/动作组件；时间线事实、状态与动作按设计 §4.7。不另画稿，不制作登录/token 动作（切片 C）。
- 预计规模：约 28–34 个生产/生成文件、16–22 个测试/夹具文件，约 2,000–2,800 行实质改动（不计真实样本及生成字节），实施与相关验证约 6–8 小时。明显超过 15 文件/800 行，按下述 A1–A4 的真实边界顺序提交，不省掉 AC 的任一环；每段结束核对规模/用时，超过估算两倍返回编排器。
- 本阶段文档影响为实施计划，仅新增本文件；不更新索引、其他规格/设计或在途 H 文件。实施只做 AC-01；B–E 的来源、页面、制作、范围隔离和出厂助手继续由各自切片承担。A 查询目录和 Claude 市场，不把尚未查询的其他来源报告为“已查、没有”，不注册制作工具。完整来源类型沿冻结合同，不实现 Codex/OpenCode 取源。

### 改动

路径除特别标明外均相对 `packages/ui-mac/`。下面是 A 的修改范围；H 的行、菜单、管理页、包根状态及凭据小窗只消费其接缝，缺口单列，不在 A 内重写或修改。表内文件名为实施落点；偏离须在同笔实施提交更新本节。

| 段 | 文件 | 改什么 |
| --- | --- | --- |
| A1 | `src/shared/host-extension-package-contract/plugin-conversion.ts`、`plugin-conversion.mjs`、`plugin-conversion.d.mts`（新增） | 在设计指定的 host artifact 内实现 Claude 的 `readMarketplace`、`convertPluginTree` 与相应冻结类型；manifest/MCP/技能读取只有这一份。ESM 自包含打包现有 `ConfigMarkdown` 解析，不把 Core 服务或 Electron 带进主进程运行闭包。其他提供方的转换入口留各自切片，不产假结果。 |
| A1 | `src/shared/host-extension-package-contract/generate-artifact.ts`、`host-extension-package-artifact.v1.json`、`host-extension-package-artifact.test.ts` | 将转换 ESM/声明及必要源文件纳入既有 artifact 生成和摘要校验。只同步文件集/摘要，不改发布信封、profile、权限 schema，不改 alpha-web 或消费方 pin。 |
| A1 | `src/main/plugin-sources.ts`（新增） | `searchSources` 的目录/Claude 路径、main 候选表、成功索引缓存、固定提交字节缓存及 codeload capture；私有 tar 读取用内建 zlib，实际来源语义调用转换库。候选持有取源信息，侧车不传 URL/路径。 |
| A1 | `src/shared/host-extension-package-contract/plugin-conversion.test.ts`、`src/main/plugin-sources.test.ts`、`test-fixtures/plugin-helper/`（新增） | 用下述固定真实语料验证检索、取源、发现、摘要与故障；记录每个文件的来源和摘要，不手写 marketplace/plugin/MCP 格式。 |
| A2 | `src/main/install-from-source.ts`（新增） | 实现冻结入口中 A 可达的 catalog/candidate 调用链：转换、宿主命名、提交前运行身份比对、映射、事务、图/声明、自动开启与结果。目录分支调用现有 admission/H 安装能力；不再产另一个提供方安装器。技能复用 CAS、多文件 generation 与探针。 |
| A2 | `src/main/ext-package-tx-builders.ts` | 按设计 §4.1 增加 MCP 叶子输入，复用既有版本化密钥资源、同名占用检查和配置事务；签名目录载荷仍走同一 builder。 |
| A2 | `src/main/ext-package-ledger-v3.ts`、`src/main/package-declarations.ts`（新增） | 只扩展设计 §4.4 的图字段、严格解码及摘要；`resolvePackageDeclarationsV1` 读取目录的已验声明或非目录图声明。全部项目保持 effect 缺席；不实施允许集 v2 或记录迁移。落账仍只经 `commitTransactionLedger`。 |
| A2 | `src/main/ext-ipc.ts`、`src/main/ext-write-channels.ts` | 将 A 的目录/候选安装接到同一个入口、恢复写闸及账本屏障；保留 H 的自动开启函数作为被调用能力。`installedPackages` 转发安全的 source/notRunning/声明展示数据；非目录授权读取经声明读取接缝返回真实需求，不另存一份。 |
| A2 | `src/main/package-mcp-activation.ts`（新增） | 提交并自动开启后通过现有 `engineClient`、`debug.location.list` 和 `experimental.mcp.add/connect` 应用 MCP；覆盖请求目录及已加载 Location，以引擎回读决定可用。v1 叶子到运行配置复用 `packages/ext/src/engine-transforms.ts:projectServerConfig`，不抄第二份字段翻译。技能仍走既有非 force 重载；不为纯 MCP 安装发整 Location 重载。 |
| A2 | `src/main/install-from-source.test.ts`、`package-mcp-activation.test.ts`、`install-from-source.engine.cases.ts` / `.test.ts`（新增），既有 `ext-package-ledger-v3.test.ts`、`test-component/package-builders-wiring.cases.ts` | 真临时盘验证入口/图/配置/CAS/密钥资源与更新去重；真实引擎验证 MCP 热接入、第二个 Location、以后重建读回持久配置以及失败时的真实状态。宿主按实际执行用例计数，不只匹配进程成功。 |
| A3 | `src/main/codepuppy-sidecar-messages.ts`、`src/main/hub-view.ts` | 冻结查找/安装消息成对 build/parse；main 立即受理后经同一写闸安装、main 独占推进阶段、阶段变化复用既有推送。非目录包视图按图中的真实组件核验，不要求它先成为目录条目；可用性不从提交成功推出。 |
| A3 | `packages/ext/src/hub-bridge.ts`、`hub-tools.ts`、`context-injection.ts`、`policy/index.ts`、`plugin.ts` | search 访问 main 来源；install 只递 main 的 ID，受理后查阶段、输出 metadata.requestId/packageId。删除 `permission.assert` 确认运输和 `asksForItself` 安装特例，移除 ask 钉子，保留自动化 deny 及普通档位判定；不改权限 evaluator。 |
| A3 | `src/preload/types.ts`、`src/preload/index.ts`、`src/renderer/extensions/ext-ipc.ts` | 接只读 `hubRequest`，删除 `hubRequestStage` 写阶段调用；来源、结果与图展示字段引用同一合同。 |
| A3 | `src/renderer/codepuppy-ui/permission-watcher.tsx`、`hub-install-watcher.tsx` 及其专用 runtime/stub，`src/renderer/extensions/install-confirm.tsx` / `use-extensions.ts` 的聊天运输残余 | 退役聊天确认守望者与 `metadata.codepuppyHub` 分流，普通审批仍在原单一呈现面；仅移除已无人调用的聊天运输，不改变 H 的装后凭据组件或文件夹入口。 |
| A3 | `packages/ext/src/{hub-bridge,hub-tools,context-injection}.test.ts` 及直接相关 policy 用例，`src/main/{codepuppy-sidecar-messages,hub-view,ext-write-channels}.test.ts`，既有 watcher/单一审批面用例 | 改测真实消息→入口→阶段链；保留普通审批、自动化 deny、畸形消息拒绝、不带秘密、受理后超时不撤销安装等断言。替换明确编码旧确认流程的场景，不以删断言取得通过。 |
| A4 | `src/renderer/codepuppy-ui/session-timeline/timeline-model.ts`、`session-timeline-view.tsx`、`cards/hub-install-card.tsx`（新增） | 将安装工具 part 投影为 `hubInstall`；查找/安装进度、已添加/正在生效、真实可用与错误只读 main 阶段及包/引擎视图。记录淘汰或重启后按 part.packageId 读取；缺少两者则仅用工具结果。管理动作消费 H 接缝。 |
| A4 | `src/renderer/i18n/zh.ts` / `en.ts`，`resources/factory-skills/customize-codepuppy/SKILL.md` 的安装段 | 按已批准措辞更新查找/安装/结果；安装段引导现有 search/install 工具，不写项目配置或用 register 安装。保留技能其余用途，不在此添加切片 D 的出厂助手。来源文字只映射真实 source。 |
| A4 | `src/renderer/codepuppy-ui/session-timeline/timeline-model.test.ts`、`test-component/hub-install-card.cases.ts` 及对应 DOM 宿主（新增），H 既有 `test-component/hub-three-pages.cases.ts` 的集成证据 | 生产投影与 DOM 验证阶段增量、结果回读、重挂载、管理目标、无安装确认；H 的既有包行验证同一包只有一行、来源准确。A 不接管 H 的行/管理实现。 |

**H 接缝核对与返回**（在实施续派前对合入后的 H delta 重核，不重审 H）：

| 接缝/既有权威 | 已核事实与消费方式 | 交接条件 |
| --- | --- | --- |
| `package-admission.ts:421` `installDesktopPackageV1`；`ext-install-planner.ts:setPackageStateV1` | H 已将内容提交与自动开启分开，`:442` 调同一包根动作。目录分支复用前者，非目录提交后复用后者；A 不另写组件循环开关。 | 保持图/root/组件状态语义；A 的 runtime 激活不调用 H 的菜单 force IPC，以免打断请求安装的会话。 |
| `ext-ipc.ts:372` `installedPackages`；`InstalledPackageV1`；H 的 `InstalledPackageRow`、`InstalledPackageDetail` | 图/root 已能给非目录包一行及整包菜单。A 从 main 提供冻结 source/notRunning 数据；H 保留一行归属、菜单与管理页。 | **当前缺口**：H WIP `extension-detail.tsx:107` 只按 `origin === "catalog"` 二选一显示来源；`extension-hub.tsx:1591` 的已装包行没有 source 呈现接缝。按当前代码接入，Claude 市场包会在管理页被标为本机导入。 |
| `ext-hub-state.ts:35` `openExtHubAt(section, target)`；H `extension-hub.tsx:414` `managedPackageId` | 既有 target 只定位/高亮已装组件行（`:223`），H 的包管理选择仍是组件内部私有状态。时间线需要以本次 packageId 打开 H 的同包管理页。 | **当前缺口**：未找到可从时间线调用的包管理定位入口；不能在 A 复制管理页或以名称/前缀猜包身份。 |
| H `packageAuthorization` / `savePackageSecrets` / `authenticateMcp` 及 `InstalledPackageDetail` 的装后小窗 | A 持久化非目录 declarations，playwright 无登录/令牌需求；本片只读真实状态。H 凭据动作与小窗不改，非目录凭据写入和时间线登录/token 动作由切片 C 接入。 | 不把 H 当前只读已验目录声明的实现当作已支持所有非目录账户操作。 |

`SEAM-CHANGE-NEEDED: H 包呈现与管理定位 — 上表两处当前缺口 — 请 H 消费设计 §4.4 已冻结的 source/notRunning 展示数据，并提供按 packageId 打开现有管理页的可调用接缝；不改变包状态、菜单或凭据权威。` 本计划不替 H 定新签名。编排器回传 H delta 后再核 A4 的调用文件/相关用例；在禁止 A 编辑 H 页面的范围下，当前不能将这一集成项标为可实施。

### 顺序

1. **A1 · 真实来源到规范化包**：先将 pinned 样本及新入口的可失败用例提交，再实现 converter/artifact 与来源模块，跑 converter、artifact、sources 三组相关测试。目录无 playwright 的实际数据与真实市场命中作为同一检索用例，不能只测数组排序。
2. **A2 · 规范化包到持久安装及运行 MCP**：先加入口/事务/命名/图/热接入的红例，后完成入口、叶子 builder、声明持久化、自动开启和 runtime add。目录与候选都走真实入口；在现有锁与写闸内完成提交前身份比对，不另建事务或账本。跑本段新例和已有 builder、图、admission、状态/卸载回归。以真实引擎用例落实下述限时探测，再证明重建后仍读同一持久配置。
3. **A3 · 对话真正能发起安装**：先加 bridge/main/tool 的连通用例，再接新消息、只读阶段与普通档位路径，同笔退役确认运输及其死调用。查找来源失败、未知候选、桥超时、失败事务、重复 requestId 都有行为断言；已有确认场景替换为直装及普通审批对照，其他审批不变。跑消息、bridge、hub-tools、policy、hub-view 与所有改导出的直接调用方测试。
4. **A4 · 时间线与 H 统一结果**：取得上表 H 接缝 delta 后，落卡片投影/订阅、管理动作、来源文案、customize-codepuppy 安装段及生产 DOM 证据；不带入搜索框、市场列表或账户动作。跑 timeline-model、卡片 DOM、H 既有一行包集成及普通审批单一面回归。最后仅跑实际修改包的 `bun typecheck` 和文档检查；编排器随后收集构建应用中的真实自然语言与浏览器任务证据。

### 风险

- **H 尚在实施**：上述观察是 `f4b5a10424` 加在途 renderer 的事实，不冒充已冻结的合入 API。来源呈现与管理定位缺口先返回 H；收到 delta 才补 A4 的具体调用，不修改 H 页面对冲依赖。
- **runtime 路径的设计回写**：本次真实探测成立，按派发要求计划 MCP 使用既有 add/connect；设计 §4.1 第 8 步、§5 重载时机及 §10 留档须由编排器/设计方依据本证据作相应修订并在 IMPLEMENT 续派钉版本。此处不改批准设计，也不把技能和登录/令牌路径的未测行为推成成立。
- **热接入与持久状态一致**：安装事务/自动开启先完成，运行配置按已提交的同一叶子派生，普通工具权限仍按原权威。对每个已加载 Location 应用并回读；以后加载的 Location 从持久配置得到它。任何启动/连接失败保留已装包，卡片按实态显示，不把 committed 当 available。相关引擎例还要覆盖中途出现工具的 policy inventory 与重建后相同配置。
- **第三方字节**：固定 pax 提交、在归档内复核市场条目和选定子目录，语义统一交 converter；畸形 JSON/tar、越界路径、链接、缺入口或绑定包内文件都用设计已有类别处理。安装阶段不执行仓库脚本；秘密原件不入 CAS、图或日志；零可运行组件时零持久写入。
- **相关检查影响面**：artifact 文件清单、消息/写通道枚举、旧确认运输调用方、工具集合与 timeline row 穷举都会受影响，按实际变更同步相关断言；不放宽检查。若出现新增侧车闭包写盘点，仅机械同步既有写点登记，不扩大可写根；除此之外的范围扩张返回编排器。

### 证明

AC-01 拆为下列同一条端到端路径的断言，不增 AC。表中仓库用例均为**拟执行**；PLAN 未运行仓库测试、typecheck、gate 或 bin/check。

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01 · 目录没有也继续找真实插件 | `plugin-sources.test.ts`：`catalog miss continues to the pinned Claude playwright entry`；`plugin-conversion.test.ts`：`real bare-map playwright becomes one stdio MCP`。用真实目录读取确认未收录，再处理 pinned 市场与归档。 | 只查目录、伪造候选或不支持裸 map 时，找不到 main 候选/真实 command；来源失败对照必须报告 failed，不能变成“查无结果”。 |
| AC-01 · 单一入口、装好自动开启 | `install-from-source.test.ts`：`chat candidate and hub catalog reach the same install entry`、`playwright commits one graph and enables its root`；实际 builder/事务/CAS/账本/配置接线用例。 | 绕入口、逐组件漏账、MCP-only root 不是真组件、未自动开启，都会使真实盘面/图/root 状态断言失败；异常事务对照须无半包。 |
| AC-01 · 来源身份和内容不乱 | 同文件 `same runtime identity returns the installed package`、`host-name collision preserves the user's existing MCP and rewrites the installed skill name`；`ext-package-ledger-v3.test.ts` 严格解码/摘要覆盖 source/notRunning/declarations。 | 再装第二份会多图/组件；宿主名碰撞会覆盖旧配置或使真实 skill probe 拒绝；字段缺失、篡改或秘密值混入公开图会被相应断言抓住。 |
| AC-01 · 不强迫确认或等待重进 | `hub-tools.test.ts`、`hub-bridge.test.ts`、main host 集成：`install is accepted before slow fetch finishes and settles without permission transport`；普通档位/自动化 deny 对照；卡片 DOM 的无安装确认断言。 | 保留 assert 运输会发审批 metadata/等守望者；等完整安装才答 bridge 会过早超时；拿掉普通档位或自动化 deny 则对照失败。工具中止/桥断连不得取消 main 已受理的安装。 |
| AC-01 · 工具实际可见、可调用 | `install-from-source.engine.test.ts` 宿主 → `install-from-source.engine.cases.ts`：真实 ext 激活、已有会话和另一已加载 Location，安装后工具清单含 `playwright_browser_navigate`，同会话调用真实 `browser_close`；移除 runtime add 的对照为缺工具。再重建证明持久配置一致。 | 单落盘/单开启/单报 connected 不足以满足工具清单和执行断言；整 Location reload 会改变 observer setup 或取消受控审批；只给默认目录 add 会漏第二个 Location。 |
| AC-01 · 一包一行且来源准确 | 卡片 DOM + H `hub-three-pages` 生产组件：图的同一 packageId 只有一行，source 显示「Claude 插件市场」，结果管理动作到该 packageId。`hub-view.test.ts` 核验非目录 MCP。 | 源标签仍读 origin 会出现“本机导入”；组件未收敛会多行；错包/只开 hub 的动作不能命中管理页；非目录必须有目录 entry 才可用的旧逻辑会让结果一直未载入。此项等 H 接缝修复后才能执行。 |
| AC-01 · 卡片状态诚实且可恢复 | `timeline-model.test.ts` + `hub-install-card` DOM：submitted、committed/pending、available、failed、notRunning；推送重读；阶段被淘汰后 metadata.packageId 恢复。 | 以模型文本或 committed 报成功，会在引擎仍 pending 的对照中错误显示已可用；只靠阶段簿则重挂载/淘汰后结果丢失。 |
| AC-01 · 没改项目、没换项目 | 真实入口临时项目的文件树及所有原有文件 bytes/digest 前后相等，空项目无新增 `.codepuppy`/`.mcp.json`/技能目录；已有 sessionID 和 Location setup 不变。 | 落项目配置/技能目录、要求重新进入或强制重建 Location 会改变快照或会话/observer 证据。 |
| AC-01 · 构建应用中的完整请求 | 编排器：目录实际无 playwright 的隔离应用，新对话说「帮我安装 playwright」，留检索/安装工具 part、真实浏览器任务调用及定制中心同包来源截图；前后项目快照。 | 模型没有走查找/安装工具、抛路线、假报安装、工具未进入真实任务或包行不出现，都不能通过。临时引擎探测不能代替这一验收。 |

**相关命令（IMPLEMENT，全部从包目录执行测试）**：

- A1，ui-mac：`bun test src/shared/host-extension-package-contract/plugin-conversion.test.ts src/shared/host-extension-package-contract/host-extension-package-artifact.test.ts src/main/plugin-sources.test.ts`。
- A2，ui-mac：`bun test src/main/install-from-source.test.ts src/main/package-mcp-activation.test.ts src/main/install-from-source.engine.test.ts src/main/ext-package-ledger-v3.test.ts src/main/package-builders-wiring.test.ts src/main/ext-set-state-tx.test.ts src/main/ext-package-ledger-uninstall.test.ts src/main/package-admission.test.ts src/main/package-admission.wiring.test.ts src/main/package-admission.parity.test.ts`。若改 builders 导出，补其直接 mock 消费者 `package-mixed-bundle.wiring.test.ts` / `package-secret-recovery-wiring.test.ts`；若触及 H OAuth 接缝，补 `package-mcp-oauth.wiring.test.ts` / `.engine.test.ts`，不运行未触及面。
- A3，ext：`bun test src/hub-bridge.test.ts src/hub-tools.test.ts src/context-injection.test.ts`，另跑实际受改导出影响的 policy、plugin-host 用例；ui-mac：`bun test src/main/codepuppy-sidecar-messages.test.ts src/main/hub-view.test.ts src/main/ext-write-channels.test.ts src/renderer/extensions/ext-ipc-chokepoint.test.ts src/renderer/extensions/use-extensions-ipc.test.ts src/renderer/codepuppy-ui/permission-mount-ratchet.test.ts src/renderer/codepuppy-ui/session-workspace/permission-single-surface.test.ts`，以及替换旧 watcher 场景后的宿主。
- A4，ui-mac：`bun test src/renderer/codepuppy-ui/session-timeline/timeline-model.test.ts src/renderer/codepuppy-ui/session-timeline/hub-install-card.test.ts src/renderer/extensions/hub-three-pages.test.ts src/renderer/extensions/local-package-renderer.test.ts`；相关 preload/IPC/row 穷举按实际导出追加。两个改动包各运行 `bun typecheck`；有全 gate 在跑时将测试并发限制到 2，不另起全 gate。
- 文档，仓库根：`python3 scripts/check-doc-links.py docs/specs/plugin-helper-and-hub/plan.md`、`git diff --check`。PLAN 仅执行这两条及以下临时探测。

**真实样本与摘要**

来源为 [anthropics/claude-plugins-official @ b5b01ac4f889fec0c4c6bb89f27ca7c8574473f6](https://github.com/anthropics/claude-plugins-official/tree/b5b01ac4f889fec0c4c6bb89f27ca7c8574473f6)。2026-11-16 只读取得 raw 市场清单与 codeload `refs/heads/main`，tar pax `comment` 固定到该提交，归档内清单与 raw 清单摘要相同；317 个条目，playwright 的 source 是 `./external_plugins/playwright`。实施夹具从该 pinned 归档截取原字节，源/摘要元数据跟夹具同放，不复制 8 MB 全库进测试。

| 样本（相对上游根） | bytes | SHA-256 |
| --- | --- | --- |
| 本次 codeload gzip | 8,404,791 | `20eee39640588b8987519372c29607f36468e903fe0efee5b69cc29761074df6` |
| `.claude-plugin/marketplace.json` | 191,699 | `414a31a148c83b7293c17b464b518425455e9c43413c24f77d9f262354dcb693` |
| `external_plugins/playwright/.claude-plugin/plugin.json` | 295 | `f2d7c0f611b93287ebb07454255d0cccf3a343d7095b7f8f763ff21d1995c096` |
| `external_plugins/playwright/.mcp.json` | 87 | `b6fd7e9ccee1682af353854195516826da6970026b68c86ad800ff4d931d3250` |
| `plugins/frontend-design/.claude-plugin/plugin.json` | 202 | `d45be5b9f5e729dd8dd545d97b46800f50c2791cb053c480495d1195ce2052be` |
| `plugins/frontend-design/skills/frontend-design/SKILL.md` | 9,390 | `d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3` |
| `plugins/explanatory-output-style/.claude-plugin/plugin.json` | 290 | `8e195dd839cb704af2ec926bbd822996398ea4cf310be1363d7ab791ba2242ae` |
| `plugins/explanatory-output-style/hooks/hooks.json` | 323 | `f941cedcbac07688675fb8d0fad741e9ba13900d73416409861001efe3fedba9` |

无 manifest、wrapped/inline MCP、同名和坏输入对照从这些真实样本及同 pinned 库中对应实样派生，记录差异，不手造提供方结构。临时 probe 的 observer 是自有测试插件，不是第三方格式夹具；目录输入直接来自本仓实际目录读取。

**PLAN 限时实测：新 MCP 是否免重载**

2026-11-16，`265c42529e` + Bun 1.4.4，在临时目录起生产 `startEngine`/`buildEngineServerOptions`/`engineClient`，沿现有 `engine-sandbox` 与测试 preload 隔离 HOME、全部 XDG、配置和数据库，并由引擎 `Global.Path` 断言隔离。载入本仓真实 `CodePuppyExt` 和临时 observer；等 ext、MCP 配置及 policy 插件 active，先创建会话、确认浏览器工具为空，再按真实 `.mcp.json` 原 command `npx @playwright/mcp@latest` 调 `experimental.mcp.add`，未调用 reload。

- 命令（cwd `packages/ui-mac`）：`bun test --timeout 120000 /tmp/helper-install-plan-YCXgtv/runtime-mcp.test.ts`，最终 exit 0，1 pass / 0 fail / 5 assertions，约 10 秒；日志 `/tmp/helper-install-plan-YCXgtv/runtime-mcp-short-socket.log`。临时脚本 SHA-256 `cb4867f0f5a9ab66339fc4dfa80c60ed4033fdc5c20b9dfa6443dd30466aaca4`，日志 SHA-256 `288b71c82469a989ff52fdadf938a799cab690bbe4a68ed99a24d3e795802eab`。
- 观察：同一 Location 的 observer setup 始终为 1；原有会话所在工具清单从 0 变为 25 个真实 playwright 工具，含 `playwright_browser_navigate`、`playwright_browser_close`，仍是原有 MCP namespace/codemode。原 sessionID 调用 `browser_close` 成功，返回 `No open tabs. Navigate to a URL to create one.`；disconnect 后工具清单回空，Location reload 计数为 0。拿掉 runtime add 会令新增工具断言失败，拿掉 disconnect 则清空断言失败。
- 首次探测的工具清单也成功，但工具执行因 macOS 临时根过长触发 Playwright socket 路径错误。最终只将探测环境 `PWTEST_SOCKETS_DIR` 指向上述短临时目录，真实插件命令不变；不把这个本机探测设置加成产品配置。
- 结论范围：**既有 runtime MCP add/connect 路径足以让已有会话所在 Location 的工具表更新并实际调用，无需整 Location 重载**。本次未执行模型请求、浏览器导航、安装事务、忙时审批、第二个 Location 或 H 页面；不得将它们记作已验收。按派发约定该工具清单证据足以决定 A 的 MCP 计划路径，其余由 A2 引擎回归和编排器真实应用验收覆盖。
- 交回设计方：以上新证据对应设计 G-20/§10 留档，申请按派发已指定分支修订受影响小节；不重开其余两轮处置。

PLAN 文档检查（2026-11-16）：`python3 scripts/check-doc-links.py docs/specs/plugin-helper-and-hub/plan.md` exit 0，2 条相对链接可达；`git diff --check` exit 0；提交前另查暂存差异。工作树只有本文件新增；未跑仓库测试或全 gate。开始于 05:55:58 UTC，本阶段约 18 分钟（派发预计 45 分钟），限时探测未超过 30 分钟。

计划作者已核：Codex（GPT-6），核对上述冻结版本、A 的入口/构建器/图/消息/时间线调用链及 H 接缝快照；临时引擎前提成立，**H 来源呈现与包管理定位需接缝补充，尚不能交付 PLAN-READY**。遗留去向：两处接缝返回编排器/H；runtime 新证据返回设计 §10；真实模型/浏览器任务验收仍归编排器；OPTIONAL：无。

### 偏离记录

2026-11-16 r1 · A1 可恢复实现：新增纯 converter 与自包含 ESM/声明，artifact 生成/校验纳入这份产物；新增只读来源查询、候选及 codeload capture。未接安装/IPC/页面，也未进入 A2–A4。三文件 A1 命令（同上）exit 1：29 pass / 2 fail；日志 `/tmp/helper-install-plan-YCXgtv/a1-first-green.log`。converter 12 条及既有 artifact 11 条均通过；来源 8 条中 6 条通过，两个目录夹具前提错误，见下段。生成器使用局部 Bun build 类型声明，避免引入 Bun ambient 类型污染 Electron fetch/stream；修正后 ui-mac `bun typecheck` exit 0，artifact 单文件复核 exit 0（11 pass / 0 fail）。相应日志为 `/tmp/helper-install-plan-YCXgtv/a1-typecheck-final.log`、`a1-artifact-final.log`。

`BLOCKED: A1 已提交测试的目录夹具前提错误 — plugin-sources.test.ts:20 断言内置目录不含 playwright，实际 codepuppy-catalog.json 有 id=mcp:playwright；:38 以 GitHub 查询要求首项来自目录，但该真实内置 entries 没有 GitHub 条目 — 需编排器纠正两条测试输入/断言后续跑。` 原始红例 a821d9386a 中第一项已经因该错误失败；实现没有修改已提交断言，也没有过滤生产目录来满足测试。规格允许从真实记录副本控制未收录情形，可用这种明确标注的目录变体证明继续搜索，并用真实含 GitHub 的签名目录样本证明优先级；本轮不自行改红例，不将 A1 或 AC-01 报完成。生产新增文件尚未接入产品安装链，先提交保存。H 与 runtime 设计后续依赖继续按续派回执处理，OPTIONAL 无。

2026-11-16 r1 · A1 首笔实施提交填入续派核对回执；真实夹具扩为同一 pinned 库的 context7（wrapped MCP）与 github（凭据占位）实样，18 个原始文件逐一记录摘要，另存保留真实成员/全局 pax 的裁剪 tar。ui-mac `bun test --max-concurrency 2 src/shared/host-extension-package-contract/plugin-conversion.test.ts src/shared/host-extension-package-contract/host-extension-package-artifact.test.ts src/main/plugin-sources.test.ts` exit 1：12 pass / 19 fail；首报把 19 项都归因于入口缺失不准确，复核为 18 项入口缺失，另 1 项已是下述目录夹具断言有误，既有 artifact 及真实夹具摘要检查通过。日志 `/tmp/helper-install-plan-YCXgtv/a1-red.log`。尚无生产变更，后续实现不改这批断言。

2026-11-16 · PLAN 新证据：按派发的限时分支实测成功，MCP 生效计划采用现有 runtime add/connect，代替该组件的非 force Location 重载；技能路径沿冻结设计。设计由其拥有方回写，本阶段只记录证据。H 的来源展示及管理定位缺口只读返回，不越界改页；其余无偏离。
