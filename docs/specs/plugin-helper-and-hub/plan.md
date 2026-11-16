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

- 依据：[Issue #1724](https://github.com/impharaon/alpha-code/issues/1724)；[SPEC-plugin-helper-and-hub v3](https://github.com/impharaon/alpha-work/blob/8663fb2a982eaf7c626bfee3bcd8b20b870f2577/docs/specs/plugin-helper-and-hub/spec.md) AC-01；[DESIGN-plugin-helper-and-hub v5](https://github.com/impharaon/alpha-work/blob/8bd3075040befdcfcb62e616b7004ec2edd0d744/docs/specs/plugin-helper-and-hub/design.md) §2、§4.1–4.4、§4.6–4.7、§5–6、§8 A、§10；转换类型与发现规则继承 [DESIGN-local-plugin-install §4.1/4.5](https://github.com/impharaon/alpha-work/blob/8663fb2a982eaf7c626bfee3bcd8b20b870f2577/docs/specs/local-plugin-install/design.md)。沿用两轮设计处置，只返回下述新实测及 H 接缝缺口。
- 核对：b46a8702d4 · orchestrator/Claude Fable 5.2 · plan check passed for A1–A3（AC-01 chain has failing-capable proof per stage, files inside the allowed scope, no frozen decision restated, no restriction added）；A4 stays pending the H seam delta。r1 的 Phase: IMPLEMENT 本轮仅授权 A1；A2–A3 等 H 合入与分支刷新，A2 另等 runtime 设计修订提交。
- r3 续派核对：编排器已将本分支重放到 H 已提交主进程头 `d1320c131e`，本车道现有提交为 `d406a13e44`、`7550abac5e`、`abb0287faf`、`8e40a921ec`；本轮授权 A2 先于 H 合入实施，设计 v4 @850fd2a。A3–A4、H 页面冻结；`plugin-conversion.*`、artifact 生成集和 `plugin-sources.ts` 归 `feat/helper-sources`，本轮只读。消费的 H 主进程接缝若变化由编排器回传 delta。
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

1. **A1 · 真实来源到规范化包**：先将 pinned 样本及新入口的可失败用例提交，再实现 converter/artifact 与来源模块，跑 converter、artifact、sources 三组相关测试。以真实目录未收录的 context7 证明继续搜索与固定提交取源；以目录和市场均收录的 playwright 证明目录优先。两例各自断言真实前提，不能只测数组排序。
2. **A2 · 规范化包到持久安装及运行 MCP**：先加入口/事务/命名/图/热接入的红例，后完成入口、叶子 builder、声明持久化、自动开启和 runtime add。目录与候选都走真实入口；在现有锁与写闸内完成提交前身份比对，不另建事务或账本。跑本段新例和已有 builder、图、admission、状态/卸载回归。以真实引擎用例落实下述限时探测，再证明重建后仍读同一持久配置。
   r5 按实际边界将 A2 的生产提交依次分为：A2.1 既有远程真源／读取／注入保留冻结叶子字段；A2.2 规范化入口、声明读取、宿主副本及既有 artifact 同步；A2.3 runtime 激活／断开与写通道 IPC 接线。合计约 15 个生产／生成文件、约 900 行增删（含生成与格式展开；不含已在 r4 完成的 builder／图基础），较原 A2 表增加 r5 明授的真源链与相关回归，不扩展 AC 或进入 A3–A4。
3. **A3 · 对话真正能发起安装**：先加 bridge/main/tool 的连通用例，再接新消息、只读阶段与普通档位路径，同笔退役确认运输及其死调用。查找来源失败、未知候选、桥超时、失败事务、重复 requestId 都有行为断言；已有确认场景替换为直装及普通审批对照，其他审批不变。跑消息、bridge、hub-tools、policy、hub-view 与所有改导出的直接调用方测试。
4. **A4 · 时间线与 H 统一结果**：取得上表 H 接缝 delta 后，落卡片投影/订阅、管理动作、来源文案、customize-codepuppy 安装段及生产 DOM 证据；不带入搜索框、市场列表或账户动作。跑 timeline-model、卡片 DOM、H 既有一行包集成及普通审批单一面回归。最后仅跑实际修改包的 `bun typecheck` 和文档检查；编排器随后收集构建应用中的真实自然语言与浏览器任务证据。

### 风险

- **H 尚在实施**：上述观察是 `f4b5a10424` 加在途 renderer 的事实，不冒充已冻结的合入 API。来源呈现与管理定位缺口先返回 H；收到 delta 才补 A4 的具体调用，不修改 H 页面对冲依赖。
- **runtime 路径的依据**：r2 已收到设计 v4 @850fd2a；仅消费 §4.1 第 8 步、§5「生效方式」、§10 修订行的变更及直接后果，其余冻结处置不重开。A2 按该版本实施，A1 不改运行时路径；技能和登录/令牌的未测行为不因此视为已验证。
- **热接入与持久状态一致**：安装事务/自动开启先完成，运行配置按已提交的同一叶子派生，普通工具权限仍按原权威。对每个已加载 Location 应用并回读；以后加载的 Location 从持久配置得到它。任何启动/连接失败保留已装包，卡片按实态显示，不把 committed 当 available。相关引擎例还要覆盖中途出现工具的 policy inventory 与重建后相同配置。
- **第三方字节**：固定 pax 提交、在归档内复核市场条目和选定子目录，语义统一交 converter；畸形 JSON/tar、越界路径、链接、缺入口或绑定包内文件都用设计已有类别处理。安装阶段不执行仓库脚本；秘密原件不入 CAS、图或日志；零可运行组件时零持久写入。
- **相关检查影响面**：artifact 文件清单、消息/写通道枚举、旧确认运输调用方、工具集合与 timeline row 穷举都会受影响，按实际变更同步相关断言；不放宽检查。若出现新增侧车闭包写盘点，仅机械同步既有写点登记，不扩大可写根；除此之外的范围扩张返回编排器。

### 证明

AC-01 拆为下列同一条端到端路径的断言，不增 AC。表中仓库用例均为**拟执行**；PLAN 未运行仓库测试、typecheck、gate 或 bin/check。

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01 · 目录没有也继续找真实插件 | `plugin-sources.test.ts`：`catalog miss continues to the pinned Claude context7 entry`；`plugin-conversion.test.ts`：`real bare-map playwright becomes one stdio MCP`。context7 例先断言真实目录未收录、固定市场已收录，再核候选来源/ID、pax 提交、全部节点与真实 wrapped MCP 字节；Playwright 裸 map 转换证据保留。 | 只查目录、伪造候选或不支持裸 map 时，找不到 main 候选/真实 command；来源失败对照必须报告 failed，不能变成“查无结果”。 |
| AC-01 · 真实 Playwright 目录优先 | `plugin-sources.test.ts`：`catalog candidates precede marketplace candidates; names alone do not claim sameAs`。先断言真实目录含 `mcp:playwright`、固定市场含 playwright；再核目录候选排在市场候选之前，同名不产生 `sameAs`。 | 目录删项会使前提断言红；倒转来源顺序或只凭同名标为同一项会使结果断言红，不再把缺席的 GitHub 当目录优先证据。 |
| AC-01 · 单一入口、装好自动开启 | `install-from-source.test.ts`：`chat candidate and hub catalog reach the same install entry`、`catalog playwright and marketplace context7 each commit one enabled package`；Playwright 走统一入口的目录分支，context7 走市场取源→转换→同一入口；实际 builder/事务/CAS/账本/配置接线用例。 | 绕入口、逐组件漏账、MCP-only root 不是真组件、未自动开启，都会使真实盘面/图/root 状态断言失败；异常事务对照须无半包。 |
| AC-01 · 来源身份和内容不乱 | 同文件 `same runtime identity returns the installed package`、`host-name collision preserves the user's existing MCP and rewrites the installed skill name`；`ext-package-ledger-v3.test.ts` 严格解码/摘要覆盖 source/notRunning/declarations。 | 再装第二份会多图/组件；宿主名碰撞会覆盖旧配置或使真实 skill probe 拒绝；字段缺失、篡改或秘密值混入公开图会被相应断言抓住。 |
| AC-01 · 不强迫确认或等待重进 | `hub-tools.test.ts`、`hub-bridge.test.ts`、main host 集成：`install is accepted before slow fetch finishes and settles without permission transport`；普通档位/自动化 deny 对照；卡片 DOM 的无安装确认断言。 | 保留 assert 运输会发审批 metadata/等守望者；等完整安装才答 bridge 会过早超时；拿掉普通档位或自动化 deny 则对照失败。工具中止/桥断连不得取消 main 已受理的安装。 |
| AC-01 · 工具实际可见、可调用 | `install-from-source.engine.test.ts` 宿主 → `install-from-source.engine.cases.ts`：真实 ext 激活、已有会话和另一已加载 Location，安装后工具清单含 `playwright_browser_navigate`，同会话调用真实 `browser_close`；移除 runtime add 的对照为缺工具。再重建证明持久配置一致。 | 单落盘/单开启/单报 connected 不足以满足工具清单和执行断言；整 Location reload 会改变 observer setup 或取消受控审批；只给默认目录 add 会漏第二个 Location。 |
| AC-01 · 一包一行且来源准确 | 卡片 DOM + H `hub-three-pages` 生产组件：图的同一 packageId 只有一行，Playwright 目录包显示「定制中心」，context7 市场包显示「Claude 插件市场」，结果管理动作到该 packageId。`hub-view.test.ts` 核验非目录 MCP。 | 源标签仍读 origin 会出现“本机导入”；组件未收敛会多行；错包/只开 hub 的动作不能命中管理页；非目录必须有目录 entry 才可用的旧逻辑会让结果一直未载入。此项等 H 接缝修复后才能执行。 |
| AC-01 · 卡片状态诚实且可恢复 | `timeline-model.test.ts` + `hub-install-card` DOM：submitted、committed/pending、available、failed、notRunning；推送重读；阶段被淘汰后 metadata.packageId 恢复。 | 以模型文本或 committed 报成功，会在引擎仍 pending 的对照中错误显示已可用；只靠阶段簿则重挂载/淘汰后结果丢失。 |
| AC-01 · 没改项目、没换项目 | 真实入口临时项目的文件树及所有原有文件 bytes/digest 前后相等，空项目无新增 `.codepuppy`/`.mcp.json`/技能目录；已有 sessionID 和 Location setup 不变。 | 落项目配置/技能目录、要求重新进入或强制重建 Location 会改变快照或会话/observer 证据。 |
| AC-01 · 构建应用中的完整请求 | 编排器：真实目录已收录 playwright，新对话说「帮我安装 playwright」经同一入口目录分支安装，留检索/安装工具 part、真实浏览器任务调用及定制中心同包来源截图；另以真实未收录的 context7 留市场→取源→转换→安装链证据及来源截图。两支均核前后项目快照；不再假定 Playwright 在当前目录缺席。 | 模型没有走查找/安装工具、抛路线、假报安装、工具未进入真实任务或包行不出现，都不能通过。临时引擎探测不能代替这一验收。 |

**相关命令（IMPLEMENT，全部从包目录执行测试）**：

- A1，ui-mac：`bun test src/shared/host-extension-package-contract/plugin-conversion.test.ts src/shared/host-extension-package-contract/host-extension-package-artifact.test.ts src/main/plugin-sources.test.ts`。
- A2，ui-mac（r5 实际相关集合）：`bun test --max-concurrency 2 src/main/install-from-source.test.ts src/main/install-from-source.engine.test.ts src/main/ext-package-ledger-v3.test.ts src/main/package-builders-wiring.test.ts src/main/ext-set-state-tx.test.ts src/main/ext-package-ledger-uninstall.test.ts src/main/package-admission.test.ts src/main/package-admission.wiring.test.ts src/main/package-admission.parity.test.ts src/main/package-mixed-bundle.wiring.test.ts src/main/package-secret-recovery-wiring.test.ts src/main/ext-write-channels.test.ts src/main/mcp-server-truth.test.ts src/main/mcp-server-derivation.test.ts src/main/codepuppy-config-injection.test.ts src/main/ext-config.test.ts src/shared/host-extension-package-contract/plugin-conversion.test.ts src/shared/host-extension-package-contract/host-extension-package-artifact.test.ts src/main/plugin-sources.test.ts`。runtime 单元模拟合并到真实引擎 cases，不另建只测模拟 HTTP 的 `package-mcp-activation.test.ts`。真实 Playwright 依赖使用下文临时 npm 缓存环境；H OAuth 接缝未修改，不额外跑其测试。
- A3，ext：`bun test src/hub-bridge.test.ts src/hub-tools.test.ts src/context-injection.test.ts`，另跑实际受改导出影响的 policy、plugin-host 用例；ui-mac：`bun test src/main/codepuppy-sidecar-messages.test.ts src/main/hub-view.test.ts src/main/ext-write-channels.test.ts src/renderer/extensions/ext-ipc-chokepoint.test.ts src/renderer/extensions/use-extensions-ipc.test.ts src/renderer/codepuppy-ui/permission-mount-ratchet.test.ts src/renderer/codepuppy-ui/session-workspace/permission-single-surface.test.ts`，以及替换旧 watcher 场景后的宿主。
- A4，ui-mac：`bun test --max-concurrency 2 src/renderer/codepuppy-ui/session-timeline/timeline-model.test.ts src/renderer/codepuppy-ui/session-timeline/hub-install-card.test.ts src/renderer/codepuppy-ui/session-timeline/cards/tool-card-model.test.ts src/renderer/codepuppy-ui/session-timeline/cards/tool-card-provenance-gates.test.ts src/renderer/extensions/hub-three-pages.test.ts src/renderer/extensions/local-package-renderer.test.ts src/renderer/extensions/ext-package-presentation.test.ts src/renderer/extensions/ext-ipc-chokepoint.test.ts src/renderer/i18n/locale-regression.test.ts src/main/factory-skills.test.ts src/main/codepuppy-factory-skill-hygiene.test.ts src/main/codepuppy-skill-packaging-census.test.ts`；直接视图消费者补 `session-timeline.test.ts`、`session-timeline-selection.test.ts`、`process-live.test.ts`、`cards/cards-contract.test.ts`（同目录，日志见 r6）。两个改动包各运行 `bun typecheck`；全部测试并发 2，不另起全 gate。
- 文档，仓库根：`python3 scripts/check-doc-links.py docs/specs/plugin-helper-and-hub/plan.md`、`git diff --check`。PLAN 仅执行这两条及以下临时探测。

**真实样本与摘要**

来源为 [anthropics/claude-plugins-official @ b5b01ac4f889fec0c4c6bb89f27ca7c8574473f6](https://github.com/anthropics/claude-plugins-official/tree/b5b01ac4f889fec0c4c6bb89f27ca7c8574473f6)。2026-11-16 只读取得 raw 市场清单与 codeload `refs/heads/main`，tar pax `comment` 固定到该提交，归档内清单与 raw 清单摘要相同；317 个条目，playwright 的 source 是 `./external_plugins/playwright`，context7 的 source 是 `./external_plugins/context7`。r2 核对实际内置目录：已有 `mcp:playwright`、没有 context7；因此真实 Playwright 请求按 BR-02 装目录项，市场回退链改由已在本夹具中的 context7 证明，不需要新增或改造第三方样本。实施夹具从该 pinned 归档截取原字节，源/摘要元数据跟夹具同放，不复制 8 MB 全库进测试。

| 样本（相对上游根） | bytes | SHA-256 |
| --- | --- | --- |
| 本次 codeload gzip | 8,404,791 | `20eee39640588b8987519372c29607f36468e903fe0efee5b69cc29761074df6` |
| `.claude-plugin/marketplace.json` | 191,699 | `414a31a148c83b7293c17b464b518425455e9c43413c24f77d9f262354dcb693` |
| `external_plugins/playwright/.claude-plugin/plugin.json` | 295 | `f2d7c0f611b93287ebb07454255d0cccf3a343d7095b7f8f763ff21d1995c096` |
| `external_plugins/playwright/.mcp.json` | 87 | `b6fd7e9ccee1682af353854195516826da6970026b68c86ad800ff4d931d3250` |
| `external_plugins/context7/.claude-plugin/plugin.json` | 427 | `9c61f72909301338f08025cafa67a7055e55572ba1bb76ba68f74d4d21c9c682` |
| `external_plugins/context7/.mcp.json` | 142 | `e5dfed1749b361fbb2d0ad64a3792a28622e788c3c058fa0f0c923991f941c17` |
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
- 设计收据：以上新证据对应 G-20/§10 留档，已由设计 v4 @850fd2a 采纳；r2 收到修订提交，留本段为原实测证据，不重开其余两轮处置。

PLAN 文档检查（2026-11-16）：`python3 scripts/check-doc-links.py docs/specs/plugin-helper-and-hub/plan.md` exit 0，2 条相对链接可达；`git diff --check` exit 0；提交前另查暂存差异。工作树只有本文件新增；未跑仓库测试或全 gate。开始于 05:55:58 UTC，本阶段约 18 分钟（派发预计 45 分钟），限时探测未超过 30 分钟。

计划作者已核：Codex（GPT-6），核对上述冻结版本、A 的入口/构建器/图/消息/时间线调用链及 H 接缝快照；临时引擎前提成立，**H 来源呈现与包管理定位需接缝补充，尚不能交付 PLAN-READY**。遗留去向：两处接缝返回编排器/H；runtime 新证据返回设计 §10；真实模型/浏览器任务验收仍归编排器；OPTIONAL：无。

### 偏离记录

r6 A4 完成：查找进行态与安装工具 part 通过持久快照中的 plugin identity、已验随包 authority 及 manifest readable ID 准入；同名第三方／坏证明不读 metadata。新增 `hubInstall` 行与生产 `HubInstallCard`，沿用既有 `.a-tc-safe`／`.a-tc-actions`／`.a-tc-open`，挂载／main 变化即读取阶段和包／引擎／账户只读视图，仍在生效时定时重读；metadata.packageId 支持 main 重启／阶段淘汰后重挂载。source/notRunning 仅消费 H 的 `installedPackagePresentation(pack)`；可用及错误态的管理只调用 `openPackageManagement(packageId)`。卡片不接安装或审批写通道，不加登录／令牌动作。`customize-codepuppy/SKILL.md` 的安装段、描述及连接器安装旁路同步到同一 search/install 入口；创建项目内容的原职责保持。人工读回实际指南 diff，确认默认全部项目、无路线／安装确认、秘密不过聊天、MCP 可用即可在本会话使用、技能待生效不作时间承诺；没有新增断言文档措辞的测试。

A4 相关 12 文件命令（计划四文件加 `cards/{tool-card-model,tool-card-provenance-gates}.test.ts`、`ext-package-presentation.test.ts`、`ext-ipc-chokepoint.test.ts`、`locale-regression.test.ts`、factory／hygiene／census）exit 1：266 pass／2 fail／1257 assertions（`a-r6-a4-related.log`）。两失败为基线 H 的 `codepuppy.ext.packageSourceOpenCode` 真实来源文案及 `ext-package-presentation` 使用该真实名称未被 `locale-regression.test.ts:162/189` 旧品牌扫描豁免；单次 `git show HEAD` 确认 en/zh 字节在 A4 前已存在，本片新增文案无该 token。返回 H／编排器，不改其来源文案或放宽扫描，不重跑不变的失败。

A4 追加直接消费者 6 文件（card DOM、session-timeline、selection、process-live、cards-contract、factory）首跑 exit 1：60 pass／1 fail（`a-r6-a4-consumers.log`）；失败为新卡片的**纯类型** `PackageAuthorizationResultV1` import 命中 cards-contract 的宽 token 扫描。改为直接推导既有 preload 只读 API 的返回类型，不复制 DTO、不增加 runtime 权限依赖，扫描规则未改。定点 `hub-install-card.test.ts`／`cards-contract.test.ts` exit 0：10 pass／0 fail／51 assertions（`a-r6-a4-card-final.log`），宿主严格核内部 7 DOM 场景；第七例不发重载通知只改引擎实态，去掉 pending 重读便失败。其他 5 个消费文件的已通过行为未再改动。模型／指南最终定点命令 `bun test --max-concurrency 2 src/renderer/codepuppy-ui/session-timeline/timeline-model.test.ts src/main/factory-skills.test.ts` exit 0（97 pass／0 fail／475 assertions，`a-r6-a4-model-skill-final.log`）。ui-mac `bun typecheck` exit 0（`a-r6-a4-ui-typecheck-final.log`）；ext 的 A3 最终 typecheck exit 0，A4 未再改 ext。所有测试并发 2，无 gate／bin/check。

A4 同调用链偏离仅 `cards/tool-card-model.ts`（复用快照权威的准入函数）与既有 `factory-skills.test.ts`（移除明确钉旧安装确认／下一条消息等待的四条措辞断言，其他秘密／项目信任断言保留；新安装行为由实际 main／host／DOM 证明）。本段含先行红例约 12 文件／650 行，未编辑 H 页面或其本轮并行修复文件。r6 08:47 UTC 起，约 55 分钟；已核 Codex（GPT-6），继承 v5／r6 及已验 A1–A2，A3–A4 作者自查完成。遗留去向：基线语言扫描→H／编排器；this-project 的持久解释与隔离→E2/E3（A 仅按冻结签名运输，不宣称该能力已验）；真实模型自然语言及构建应用浏览器任务→编排器最终验收。AC-01 默认全局链已有 A1 查源／A2 真引擎／A3 真 host 与 main／A4 DOM 及 H 一行集成证据，未冒充已跑应用模型验收。OPTIONAL 无。

r6 A4 红例先行：`timeline-model.test.ts` 新例验证可信随包工具的查／装投影、requestId/packageId 重挂载和同名第三方拒绝；`bun test --max-concurrency 2 --test-name-pattern 'A4' src/renderer/codepuppy-ui/session-timeline/timeline-model.test.ts` exit 1（1 pass／1 fail，缺 hubInstall 投影，`a-r6-a4-model-red.log`）。新增生产卡片 DOM 六场景与严格计数宿主；宿主命令 exit 1（卡片模块缺席，`a-r6-a4-dom-red.log`）。六场景分别移除阶段重读、即时引擎可用性、持久 metadata 身份、来源／管理接缝、真实失败或账户需求中的任一行为即转红；不靠模型文本声称成功。卡片只显示账户状态，登录／令牌动作仍留 C。身份资格复用 `cards/tool-card-model.ts` 的完整快照校验及随包 authority/readable，不从别名或路径前缀猜；该文件为原 timeline 同调用链必要落点，相关专用卡／来源测试补跑。

A3 补齐直接消费者：`composer-tier-matrix.engine.cases.ts:431` 仍编码“普通身份询问后还必须出现安装确认”。先运行该场景 exit 1（0 pass／1 fail，实际第一普通审批出现，第二旧安装确认不再出现；`a-r6-a3-composer-old-red.log`）。此处按原计划明确替换旧确认流程为一次普通审批、协议 JSON 往返、无安装运输 metadata 及结束后零待批；调用参数 catalogId→id 为 r6 允许的 API 形状纠正，未改普通权限求值。相关矩阵宿主 `bun test --max-concurrency 2 src/main/composer-tier-matrix.engine.test.ts` exit 0（宿主 1 pass／0 fail，严格核内部 27 场景全部通过；`a-r6-a3-composer-final.log`）。

r6 A3 完成：红例提交 `1c5a5de6f5`（main 消息／受理阶段）及 `a2b2436e36`（工具生产 bridge）先于生产改动；工具红命令 `bun test --max-concurrency 2 --test-name-pattern 'A3 tools search' src/hub-tools.test.ts` exit 1，旧实现只返回 hub 视图，未发来源消息（`a-r6-a3-tools-red.log`）。生产链现由 main 候选表解析 ID，sidecar 即时 ACK，经既有写闸安装，main 独占 submitted／committed／failed；只读 `hubRequest` 替代 renderer 写阶段。非目录图进入同一即时引擎核验视图，不从 committed 推断 available。普通工具审批保留在单一原面；移除 chat 的 permission.assert 运输、ask 钉子、asksForItself 特例和已死守望者。

A3 最终命令（均 `--max-concurrency 2`）：上节 ui-mac 七文件集合加 `ext-package-ledger-v3.test.ts` exit 0（108 pass／0 fail／561 assertions，`a-r6-a3-ui-final.log`）；ext 的 bridge／tools／context 加 `policy/register-policy.test.ts`、`plugin-host.test.ts` exit 0（166 pass／0 fail／1016 assertions，`a-r6-a3-ext-final.log`）。两包 `bun typecheck` exit 0（`a-r6-a3-{ui,ext}-typecheck.log`）。真实 plugin host 证明全权 0 ask、询问档恰 1 普通 ask、自动化 0 ask 且 deny；生产 ext 工具→bridge→真 main→统一 catalog 入口的金丝雀用例证明秘密只留 main 专用文件，结果带 packageId，stage 不可由 renderer 写入。去掉来源消息、直装受理、metadata 身份或普通审批分流中的任一环，对应用例变红。

A3 文件偏离均为同调用链：`src/shared/plugin-install.ts` 增加冻结 outcome 的 wire 校验；`plugin-sources.ts` 增加仅查 main 已铸 ID 的解析接缝；`renderer/index.tsx` 删除退役 watcher 的死 prop；`test-component/ext-install-catalog-result.cases.ts` 改测同一真 main 安装直达链；context inventory 快照机械同步；ledger display-only 消费白名单加入 hub-view 的纯展示读取。退役 watcher 的三生产文件及专用旧确认测试整体删除，原单一审批面／pin／秘密行为分别在普通审批、宿主及 main 连通证据保留；不删其他审批能力。A3 共 32 个代码／测试文件，约 +808／−1953（主要减少旧确认运输及专测），无新增依赖；生产的 H 共享文件仅 `ext-ipc.ts`（main sidecar 接线／通知），`use-extensions.ts`／`install-confirm.tsx` 仅移死参数／注释，不改 H 页面。H 本轮列出的并行修复文件未编辑。

A3 的 `scope` 按冻结消息原样运输；当前 A2 入口尚未持久解释 this-project，E2／E3 尚未到齐，此依赖已返回编排器，不能将项目范围能力记为本片已验。AC-01 默认 all-projects 的真实入口和运行证据不依赖该项。A4 现在消费 H 已交的两个原名接缝，不实现其页面或 E 的范围逻辑。

r6 A2 闭合：夹具清理后单文件 6 pass / 0 fail（32 assertions，`a-r6-a2-isolation.log`）；同一原 19 文件集合完整复核 369 pass / 0 fail（2127 assertions，exit 0，`a-r6-a2-final.log`），真实引擎内部 2 cases 通过。A3 首批红例为 `codepuppy-sidecar-messages.test.ts` 的来源查／装消息成对及畸形 ref 拒绝、`hub-view.test.ts` 的 main 立即受理与异步 submitted→committed；`bun test --max-concurrency 2 --test-name-pattern 'A3 source search|A3 main accepts' src/main/codepuppy-sidecar-messages.test.ts src/main/hub-view.test.ts` exit 1（2 fail；消息 builder 缺席、main 未识别 install 消息），日志 `a-r6-a3-main-red.log`。其余 A3 断言继承已核计划，不改普通审批求值器。

r6 A2 纠正后的单文件检查补记：上条记录的“单文件 exit 0”在命令结束前写入，实际首跑为 5 pass / 1 fail；新注入例首次执行到 `injectedMcp()` 后留下了已发布 bootstrap，令下一条既有位置隔离用例不再读取其控制环境。未改任何行为断言，给测试 fixture 增加 afterEach 的现有 `unpublishTestBootstrap` 清理，防止跨用例泄漏；此前 baseline 的 void 异常使这个路径未执行。完整结果待命令结束后记，不能把提前写入的收据视为通过。

r6 收据：编排器重放至 H `09a83a515a` 并叠加 D/E 独立步骤，头 `1a218e8a2e`；A2 已由编排器核过，继承其结论。首条命令复跑 A2 19 文件：368 pass / 1 fail，exit 1，唯一仍是 `mcp-server-derivation.test.ts:105/108` 的 void API 误用，无新失败（`a-r6-a2-baseline.log`）。按 r6 明授，仅把这两处分别改为 not.toThrow／toThrow；`mcp-server-truth-write.ts:24` 的真实签名为 void，失败抛错，未改任何字段／引用／注入行为断言。单文件复核 exit 0（6 pass / 0 fail，`a-r6-a2-correction.log`）。H 已交来源呈现 `installedPackagePresentation` 与按 packageId 管理跳转 `openPackageManagement`，A4 接缝依赖解除；D/E 已交文件本片只读。08:47:08 UTC 开始 A3/A4；H 同时修改的文件如需改动逐项留本节，不改其页面或 generation 分配。

r5 结束收据（08:43 UTC，约 39 分钟）：生产按边界提交为 `fd8f340272`（真源链）、`88527c654c`（入口／声明／副本与 artifact）、`38ddbce46c`（runtime／IPC）；相关红例先于各段实现提交，原 r4 红例未改。已核：Codex（GPT-6），继承设计 v5 @8bd3075、叠加来源头 @733032e676 及本轮明授 delta。上述 19 文件最终检查为 368 pass / 1 fail，唯一失败是本会话误读 void API 的新测试；真实引擎 2 cases 通过，ui-mac `bun typecheck` exit 0，文档相对链接检查与 `git diff --check` exit 0。**BLOCKED（A2 验证收口）**：请求纠正 `fcf1f0ea2e` 的两处测试调用，未收到答复前保留红例，不能报 DONE。下一步仅需编排器允许该窄纠正后复核该用例及相关集合；遗留去向：该测试错误→本片即时修正（待授权），在线浮动 npm 元数据握手时限→验收环境记录，真实模型应用验收→编排器，H 双技能 generation 已知项→H（本片未触发、未修改）。已定勿重开：真源字段映射、runtime 生效决定及 A3–A4 冻结范围；OPTIONAL 无。无迁移、无 push／PR／gate，工作树提交后保持干净。

2026-11-16 r5 · A2.1 已按明授 delta 扩展 `mcp-server-truth.ts` 的严格字段、确定性写出和唯一 `remoteMcpLeaf` 投影；`ext-config.ts` 的持久化／读回消费同一判据，`codepuppy-config-injection.ts` 原来只复制 URL/headers，现经同一投影及现有 `projectServerConfig` 将 timeout/OAuth 交引擎，转换权威不复制。OAuth clientSecret 拒明文，只接专用存储引用；仍拒 enabled 与未批准字段。旧 `ext-config.test.ts` 中明确编码“拒 timeout/oauth”的用例按本轮裁定改为保留并读回，enabled／平台保留名拒绝对照保留；`mcp-server-truth.test.ts` 的导入闭包清单只追加无 I/O 的共享校验文件，写模块仍被排除。原 `bac7678005` 红例未改并已转绿。

r5 测试纠错及未闭合项：`4855c79409` 单独纠正 npm 输入选择；`opencode/npm/provenance.json:4` 固定的是 `opencode-skills-hub`，真实搜索页还含其他包，不能以第一个 npm 结果代表该归档；仅改选择字面名称并增加前提，零写入／nothing-runnable 行为断言未改。另有**本会话写错的已提交测试调用**：`fcf1f0ea2e` 的 `mcp-server-derivation.test.ts:105/108` 读取 `writeMcpServerTruth(...).ok`，实际 `mcp-server-truth-write.ts:24` 返回 void、失败抛错。这不属于 pinned 样本字面纠错授权；已请求只将成功调用改为 not.toThrow、拒绝明文改为 toThrow，保留注入字段与秘密引用全部断言，答复未到前不改已提交行为断言，不为测试改变生产 API。独立临时 artifact 检查 `a2-r5-truth-artifact.test.ts` 正确调用同一 void API，实际检查写出字节、读回、生产注入及明文拒绝：exit 0（1 pass / 6 assertions），不是对该仓库红例的修复或豁免。

r5 A2.2／A2.3：新增 `install-from-source.ts`、`package-declarations.ts`、`package-mcp-activation.ts`，沿既有 CAS、多文件 builder、claim diff、事务和 `commitTransactionLedger`；候选复用 `convertCandidate` 缓存，main 不重读 provider 定义。`plugin-sources.ts` 仅新增已装声明复用同一身份算法的适配及转交已核 namespace publisher，避免复制来源判定。`plugin-conversion.ts` 仅新增安装副本宿主名／结构化 MCP 引用渲染，发现规则不变；`renderInstalledSkill` 的红例在 `990d3df526`，ESM／声明／摘要由生成器同步。声明读取保持设计的同步返回合同；main 向它提供既有 admission 最近读取的已验目录快照，非目录只读包图，不取目录、不另存声明。图 displayName 只投影给结果显示；身份比较读 source 与声明，枚举减速带仅追加这个新的显示消费者，不放宽图校验。

r5 IPC：`ext-install-from-source` 在唯一写表登记，走既有 global 恢复 gate 与 ledgerReady；H 的 `ext-install-package` 也委托同一入口，不改 H 页面。目录分支沿 `runCatalogInstallWithPackagePreflight`，签名包交 `installDesktopPackageV1`／H 整包开启；实际 Playwright 是 legacy catalog 单 MCP，交既有 `installCatalog`／`setInstallStateByKey`，主进程仅从已验条目派生安装动作的 capabilities，不要求聊天或 renderer 再确认。非目录交 H `setPackageStateV1`。MCP-only 不请求 Location 重载；技能仍走既有非 force 调度。包启停／卸载及更新离场组件使用同一 runtime 断开／移除路径，账户纯读面经图声明回真实需求。A3 的侧车协议／工具／阶段与 preload、A4 页面和 H generation 分配均未改。

r5 已执行证据（ui-mac，均测试并发 2，日志在 `/tmp/helper-install-plan-YCXgtv/`）：入口四红 `a2-r5-entry-red.log` exit 1（入口缺席）；runtime 宿主红 `a2-r5-engine-red.log` exit 1（激活模块缺席）；写通道红 `a2-r5-ipc-red.log` exit 1（通道缺席）；技能副本红 `a2-r5-skill-render-red.log` exit 1（渲染入口缺席）。相关旧预期同步后，最终命令为计划 A2 既有用例及两个 builder mock 消费者，加本轮触及的 `ext-write-channels.test.ts`、`mcp-server-truth.test.ts`、`mcp-server-derivation.test.ts`、`codepuppy-config-injection.test.ts`、`ext-config.test.ts`、converter/artifact/sources 三文件与真实引擎宿主，共 19 文件；`a2-r5-final.log` exit 1：368 pass / 1 fail、2122 assertions，**唯一失败为上面的 void API 测试调用错误**。生产类型检查 exit 0；完整 A2 不标绿。

r5 真实引擎：宿主 `install-from-source.engine.test.ts` 确认实际执行 2 条 cases。第一条从真实 pinned Claude Playwright 走入口／事务／H 开启／runtime add，两个已加载 Location 出现 browser_navigate，原会话执行 browser_close，setup 计数不变且重载 0 次；关闭引擎后从同一持久文件重建仍有工具，关闭包清空工具、移除清空运行时条目。第二条只将真实 Playwright 定义的 command/args 控制改为 node／不存在的入口，经同一安装路径，真实引擎回 failed／spawn_failed，包和 enabled 记录仍在。原始命令浮动 latest 的在线 npm 元数据读取曾超出引擎握手时间（`a2-r5-engine-first.log`、`a2-r5-engine-final.log`），并非可用；没有改产品超时或命令。为隔离 npm 网络，把实际包预取到临时 npm cache，再以 `npm_config_cache=/tmp/helper-install-plan-YCXgtv/npm-cache npm_config_offline=true bun test --max-concurrency 2 src/main/install-from-source.engine.test.ts` 复核：exit 0（宿主 1 pass，内部 2 pass / 0 fail，`a2-r5-engine-offline.log`）；同一环境纳入上列最终命令也通过。此环境仅用于真实运行依赖，不写项目配置或产品选项；不声称验证冷缓存联网稳定性或真实模型任务。

2026-11-16 r5 收据：叠加来源车道至 `733032e676`，首轮 converter/artifact/sources 三文件 `bun test --max-concurrency 2` exit 0（61 pass / 0 fail，407 assertions），ui-mac `bun typecheck` exit 0。编排器授权既有远程真源及同调用链保留冻结映射的 timeout/oauth，原 `bac7678005` 红例保持不变；来源车道关闭，必要来源改动归本片，A3–A4、H 页面与 generation 分配仍冻结。新增入口红例 4 条（真实来源提交/幂等、宿主碰撞、零可运行诊断、未知 ID），命令 `bun test --max-concurrency 2 --test-name-pattern 'A2 marketplace|A2 host-name|A2 zero runnable|A2 unknown' src/main/install-from-source.test.ts` exit 1（0 pass / 4 fail，入口模块缺席），日志 `a2-r5-entry-red.log`。测试 fetch helper 从已有来源真实夹具路由提取到 `test-fixtures/plugin-helper/source-fetch.ts`，没有新造第三方格式。远程真源增加字段时同步 `codepuppy-config-injection.ts`（当前投影仅复制 URL/headers），共用严格投影，不另存运行配置真源。08:04:01 UTC 开始。

r4 安全子集提交：`ext-package-tx-builders.ts` 增加冻结 leaf 变体并复用既有版本化密钥资源；`ext-package-ledger-v3.ts` 扩展四个可选字段的严格解码、节点声明对应关系及摘要；新增 `src/shared/plugin-install.ts` 为同调用链共享冻结 DTO 与纯校验（3 个生产文件，约 150 行增删，不含文档/测试）。先前 `7131d8eac6` 的两个红例均转绿，未改断言；原 H 技能包自动开启红例也保持通过。入口、声明读取与 runtime 草稿未接线、未经验证，暂存在 `/tmp/helper-install-plan-YCXgtv/a2-unfinished/`，不作为实现交付或留在工作树。

r4 检查收据：ui-mac `bun test --max-concurrency 2 --test-name-pattern 'A2 MCP leaf builder|A2 graph metadata|A2 automatic enable' src/main/install-from-source.test.ts` exit 0（3 pass / 0 fail，15 assertions；`a2-r4-core-final.log`）；计划 A2 已有的八文件加两个 builder 直接 mock 消费者（`package-mixed-bundle.wiring.test.ts`、`package-secret-recovery-wiring.test.ts`）合并运行 exit 1（130 pass / 1 fail，849 assertions；`a2-r4-related.log`），唯一失败即下述持久叶子接缝红例，无其他既有回归。`bun typecheck` exit 0（`a2-r4-typecheck-final.log`）。这些日志均在 `/tmp/helper-install-plan-YCXgtv/`。`package-mcp-activation.test.ts`、真实引擎安装宿主尚未建立/运行，不以原 PLAN 探测代替 A2 证据。Codex（GPT-6）已核设计 v5、本轮 H 基线及安全子集；A2 未完成，下一步及遗留去向为编排器/设计与真源拥有方处置下述合同缺口；H 双技能项未触发验证，A3–A4 未实施，OPTIONAL 无。本续段 07:55:42 UTC 开始，约 6 分钟；未扩大本段范围或运行 gate。

2026-11-16 r4 · A2 新接缝红例 `install-from-source.test.ts`：`A2 remote MCP leaf retains timeout and OAuth policy through main truth publication`。从同一 pinned context7 转换结果取得真实 http URL，附加**本方规范化叶子合同**中的 `timeout: 7890` / `oauth: false`，调用现有 `persistMcp`，要求成功并经 `readMcpLeafStrict` 保持相同叶子；没有手造第三方输入格式。ui-mac `bun test --max-concurrency 2 --test-name-pattern 'A2 remote MCP leaf retains' src/main/install-from-source.test.ts` exit 1（0 pass / 1 fail，真实样本 transport 前提通过），日志 `/tmp/helper-install-plan-YCXgtv/a2-r4-remote-truth-red.log`。实回 `{ok:false, reason:"remote MCP server carries key(s) the truth file does not hold: timeout, oauth"}`。

`SEAM-CHANGE-NEEDED: 远程 MCP 持久叶子合同 — 设计 v5 §4.1 的叶子含 timeout/oauth，§5 要求重建后来自同一持久配置；ext-config.ts:462 的 REMOTE_RECORD_LEAF_KEYS 及 mcp-server-truth.ts:36/55 仅接 url/headers，现有 package-admission.ts:553 的发布权威删掉 enabled 后仍调用 persistMcp，无法持久这两个已批准字段 — 请设计/真源拥有方回传在既有远程真源及读取/注入链中保留 timeout/oauth 的最小合同 delta，或指定不重复权威的已批准落点。` 不静默丢字段、不改冻结的真源 schema、不把包图授权声明另作运行配置真源；本轮在此停止后续入口/IPC/真实引擎实施。此例只针对真实可达的规范化叶子边界，不推翻原始 context7 无这些字段时的可安装性；A2 完整证明尚未完成。

2026-11-16 r4 · 编排器重放到 H `5b46447823`，本车道头 `b45664681b`；原技能包红例未改。A2 八文件基线（r3 七文件加 `install-from-source.test.ts`，均 `--max-concurrency 2`）exit 0：126 pass / 0 fail，日志 `/tmp/helper-install-plan-YCXgtv/a2-r4-baseline.log`，H 零配置编辑与远程发布阻塞闭合。接收设计 v5 @8bd3075（本轮指定工作树）：按 §4.1 第 6 步消费结构化 diagnostics，零可运行结果带 notRunning，不改 converter 或 sources。H 已知双技能 generation 碰撞不在本片修复；若直接引擎断言受其阻断，独立返回该项依赖。

r4 新红例：ui-mac `bun test --max-concurrency 2 src/main/install-from-source.test.ts` exit 1（1 pass / 2 fail，8 assertions），日志 `/tmp/helper-install-plan-YCXgtv/a2-r4-red.log`；原技能包激活例通过，新例分别因 MCP builder 尚不接受 leaf 输入、图 schema 尚无 source/notRunning/declarations 而失败。拟新增 `src/shared/plugin-install.ts` 作为 A2 图/构建器/入口共用的冻结 DTO 与严格校验落点，避免图纯数据模块反向依赖主进程声明读取器；这是同调用链必要落点，不更改合同。

2026-11-16 r3 · A2 在重放头 `8e40a921ec` 开始，先跑计划中的既有七文件回归：ui-mac `bun test --max-concurrency 2 src/main/ext-package-ledger-v3.test.ts src/main/package-builders-wiring.test.ts src/main/ext-set-state-tx.test.ts src/main/ext-package-ledger-uninstall.test.ts src/main/package-admission.test.ts src/main/package-admission.wiring.test.ts src/main/package-admission.parity.test.ts` exit 1（123 pass / 2 fail），日志 `/tmp/helper-install-plan-YCXgtv/a2-baseline.log`。两处报告均来自 H 已提交 `package-admission.test.ts:145` 的同一回归（直接执行和 wiring 宿主）：Supabase 安装返回成功，但主进程远程 MCP 真源没有 supabase；该例由 `089d0e1a7e` 引入，不是本轮新增失败，不称为 flaky，不修改 H 断言或发布权威。

本轮新增计划内 `src/main/install-from-source.test.ts` 的接缝红例：使用原 pinned frontend-design 的真实文件，经 `promotePayloadToCas`、`buildSkillTxItems`、`runExtensionTransaction` 和 `commitTransactionLedger` 成功提交完整关闭态技能包，再调用设计指定的 H `setPackageStateV1` 自动开启。ui-mac `bun test --max-concurrency 2 src/main/install-from-source.test.ts` exit 1（0 pass / 1 fail，6 assertions），实际返回 `{ok:false, reason:"config tx has no edits"}`，事务提交及初始账本断言已通过，日志 `/tmp/helper-install-plan-YCXgtv/a2-root-state-red.log`。测试根遵循 `<base>/env/dev`，不读 owner 数据；树、generation 与探针均为实际生产路径，不手造第三方技能。

`BLOCKED: H 包根状态接缝仍有主进程缺口 — ext-install-planner.ts:2904 对纯技能包的空 edits 无条件调用 prepareConfigTx，ext-config-tx.ts:60 因空 edits 拒绝，先于 :2906 的账本状态写入；remote truth 已发布、无 JSONC 编辑的包也经过同一分支 — 需 H 修复零配置编辑时的整包状态动作，并回传主进程 delta。` 最小修正保持同一包根/账本/配置权威，零配置编辑时仍执行现有整包状态更新，不另造 A2 自动开启路径或加用户操作。远程 publication 的已提交基线失败一并返回 H；不在本片改它。此阻塞直接影响 A2 的纯技能/碰撞与远程包自动开启证明，因此尚未写安装入口、叶子 builder、声明或激活生产代码；后续 A2 红例/真实引擎用例尚未执行，不能报 A2 完成。

r3 回执：Codex（GPT-6）核对计划、重放版本与上述真实接缝红例；仅新增 A2 红例和更新本计划，未改来源车道、H 权威或 A3–A4。ui-mac `bun typecheck` exit 0；文档链接及 `git diff --check` exit 0。06:48:38 UTC 开始，约 10 分钟；遗留去向为编排器/H 修正主进程接缝后续派 A2，OPTIONAL 无。

2026-11-16 r2 · 按本轮编排器裁定，仅纠正 a821d9386a 中两条目录红例：原“Playwright 目录缺席”不成立，原“GitHub 目录优先”缺少真实目录条目。目录缺席例改用现有固定样本 context7，保留来源顺序/状态、候选身份、固定提交、节点和真实 MCP 内容，并补原字节相等；目录优先例改用两处都有的 playwright。两例各自显式断言目录及 pinned 市场前提，未来目录变化会先令前提红；未过滤生产目录、未放宽结果。计划证明行、样本说明和真实请求路径同步：Playwright 经统一入口目录分支，市场→取源→转换→安装覆盖用 context7；未修改规格或产品行为。此笔为独立测试纠错提交，不含生产代码。设计版本收据更新为 v4 @850fd2a，A2–A4 本轮仍冻结。

r2 验证：ui-mac `bun test --max-concurrency 2 src/shared/host-extension-package-contract/plugin-conversion.test.ts src/shared/host-extension-package-contract/host-extension-package-artifact.test.ts src/main/plugin-sources.test.ts` exit 0（31 pass / 0 fail / 230 assertions）；`bun typecheck` exit 0。文档链接检查及 `git diff --check` exit 0。r1 的 A1 红例阻塞解除；本轮 A1 完成，完整 AC-01 的入口/运行/页面验收仍归后续 A2–A4 与编排器。开始于 06:39:42 UTC，约 5 分钟。已核：Codex（GPT-6）；遗留去向：H 接缝/合入与 A2 启动→编排器，OPTIONAL 无。

2026-11-16 r1 · A1 可恢复实现：新增纯 converter 与自包含 ESM/声明，artifact 生成/校验纳入这份产物；新增只读来源查询、候选及 codeload capture。未接安装/IPC/页面，也未进入 A2–A4。三文件 A1 命令（同上）exit 1：29 pass / 2 fail；日志 `/tmp/helper-install-plan-YCXgtv/a1-first-green.log`。converter 12 条及既有 artifact 11 条均通过；来源 8 条中 6 条通过，两个目录夹具前提错误，见下段。生成器使用局部 Bun build 类型声明，避免引入 Bun ambient 类型污染 Electron fetch/stream；修正后 ui-mac `bun typecheck` exit 0，artifact 单文件复核 exit 0（11 pass / 0 fail）。相应日志为 `/tmp/helper-install-plan-YCXgtv/a1-typecheck-final.log`、`a1-artifact-final.log`。

`BLOCKED: A1 已提交测试的目录夹具前提错误 — plugin-sources.test.ts:20 断言内置目录不含 playwright，实际 codepuppy-catalog.json 有 id=mcp:playwright；:38 以 GitHub 查询要求首项来自目录，但该真实内置 entries 没有 GitHub 条目 — 需编排器纠正两条测试输入/断言后续跑。` 原始红例 a821d9386a 中第一项已经因该错误失败；实现没有修改已提交断言，也没有过滤生产目录来满足测试。规格允许从真实记录副本控制未收录情形，可用这种明确标注的目录变体证明继续搜索，并用真实含 GitHub 的签名目录样本证明优先级；本轮不自行改红例，不将 A1 或 AC-01 报完成。生产新增文件尚未接入产品安装链，先提交保存。H 与 runtime 设计后续依赖继续按续派回执处理，OPTIONAL 无。

2026-11-16 r1 · A1 首笔实施提交填入续派核对回执；真实夹具扩为同一 pinned 库的 context7（wrapped MCP）与 github（凭据占位）实样，18 个原始文件逐一记录摘要，另存保留真实成员/全局 pax 的裁剪 tar。ui-mac `bun test --max-concurrency 2 src/shared/host-extension-package-contract/plugin-conversion.test.ts src/shared/host-extension-package-contract/host-extension-package-artifact.test.ts src/main/plugin-sources.test.ts` exit 1：12 pass / 19 fail；首报把 19 项都归因于入口缺失不准确，复核为 18 项入口缺失，另 1 项已是下述目录夹具断言有误，既有 artifact 及真实夹具摘要检查通过。日志 `/tmp/helper-install-plan-YCXgtv/a1-red.log`。尚无生产变更，后续实现不改这批断言。

2026-11-16 · PLAN 新证据：按派发的限时分支实测成功，MCP 生效计划采用现有 runtime add/connect，代替该组件的非 force Location 重载；技能路径沿冻结设计。设计由其拥有方回写，本阶段只记录证据。H 的来源展示及管理定位缺口只读返回，不越界改页；其余无偏离。

## 来源扩展（B/C 的转换与查询层）

- 依据：[Issue #1724](https://github.com/impharaon/alpha-code/issues/1724)；[SPEC-plugin-helper-and-hub v3](https://github.com/impharaon/alpha-work/blob/8663fb2a982eaf7c626bfee3bcd8b20b870f2577/docs/specs/plugin-helper-and-hub/spec.md) AC-02、AC-05、AC-15 的查找、取源和转换部分；[DESIGN-plugin-helper-and-hub v5](https://github.com/impharaon/alpha-work/blob/8bd3075040befdcfcb62e616b7004ec2edd0d744/docs/specs/plugin-helper-and-hub/design.md) §4.2、§4.3、§4.9，及 §4.1/§4.8 的来源、身份比较部分，按 §8 B/C 分工；继承 [DESIGN-local-plugin-install §4.1/4.2/4.5](https://github.com/impharaon/alpha-work/blob/8663fb2a982eaf7c626bfee3bcd8b20b870f2577/docs/specs/local-plugin-install/design.md) 的转换类型、捕获及秘密处理规则。§10 处置与 owner 两项决定不重开。
- 核对：Phase: IMPLEMENT — b4c822f9f5 · orchestrator/Claude Fable 5.2 · plan check passed for S1, S3 and S4 (per-source ok/failed, identity after conversion, real pinned samples, failing-capable proofs; no restriction added); S2's native-module record waits for the design amendment。r1 授权 S1→S3，已提交 ed09d6baa8…fa397202a2；r2 续派已收到 design v5 @8bd3075，核对 §4.3/§4.9/§4.1/§10 的修订，授权 S2→S4 及 Diagnostic 类型增量；安装入口等其他车道仍冻结。
- 代码基线：`8e40a921ec09cc95d8580142fd45af760d3599d1`，派定工作树 `alpha-code-feat-helper-sources`、分支 `feat/helper-sources`，Bun 1.4.4。沿用上节 A1 的 converter/artifact、main 候选表与只读 capture；开工不依赖 A2，安装集成等待 A2。
- 文档影响：实施计划；本阶段只追加本节，保留上节历史证据，不改变 frontmatter、索引、规格、设计或其他 lane 文件。安装入口、builders、账本、IPC/preload/ext、renderer/i18n、UI 与真实服务调用均由其他 lane 承担。本机目录捕获沿 `Source.kind: folder`，不向固定的远端搜索来源枚举加第六项。
- 预计规模：6 个生产/生成文件（下表），3 个测试文件，约 20–30 个真实夹具/来源记录文件；约 1,200–1,800 行实质改动，不计上游原字节与生成产物，实施及相关验证约 4–6 小时。拆成 S1–S4 顺序提交；每段核对规模/用时，达到估算两倍即返回。PLAN 从 2026-11-16 06:48:37 UTC 开始，预算 40 分钟。

**接缝已关闭（r2）**：design v5 @8bd3075 已明确原生模块只经 `Diagnostic.code: native-js-plugin`、`sourceName`（该 code 必填）和 `path` 传递；不新增 Entry，不解析 message。S2 按 §4.9 的真实路径/入口发现与命名规则实施，S4 交出同一规范化结果；零可运行包的 `nothing-runnable/notRunning` 安装结果由 A2 消费，本 lane 只证明空 entries 与结构化诊断。历史返回及收据见本节偏离记录与 b4c822f9f5。

### 改动

路径相对 `packages/ui-mac/`。下表只列本车道可改文件；新私有函数放在既有所有者文件内，不另建提供方框架或安装器。

| 文件 | 改什么 |
| --- | --- |
| `src/shared/host-extension-package-contract/plugin-conversion.ts` | 补齐 Codex 市场及插件发现、OpenCode 文件树发现、`convertMcpServerDefinition`；沿现有 `Capture`、`PluginPackage`、`Text`、凭据/替换字节与摘要权威。Codex `.app.json` 保留具名诊断；OpenCode JSON/JSONC MCP 使用同一标准化结果。原生模块通道只在上述接缝冻结后实施。 |
| `src/shared/host-extension-package-contract/plugin-conversion.mjs`、`plugin-conversion.d.mts`、`host-extension-package-artifact.v1.json` | 每段经现有生成器同步 ESM、声明和摘要，不手改产物，不改发布信封/profile，不重钉其他仓消费者。 |
| `src/shared/host-extension-package-contract/generate-artifact.ts` | 仅在新增的真实解析依赖须纳入既有生成摘要文件集时机械同步；JSONC 复用仓内已有 `jsonc-parser`，无新依赖。converter 运行闭包保持自包含，不带 Electron、网络或 Core 服务。无需变更文件集时不改此文件。 |
| `src/main/plugin-sources.ts` | 在现有唯一 `PLUGIN_SOURCE_ORDER`、main 候选表及捕获缓存上补 Codex/npm/Registry 查询与取源、本机目录捕获；GitHub 复用 codeload，npm 校验真实 tarball integrity 并处理其实际归档根，不把 npm 当成必须有 pax 提交的 codeload。用转换后的定义产出同名比较数据并共享缓存；供 A2 提交前再比较，不在此安装。市场语义只调 `readMarketplace`。 |
| `src/shared/host-extension-package-contract/plugin-conversion.test.ts` | 实际 provider 树→规范化包、秘密替换与摘要、坏定义局部诊断、Registry 映射及 source/ESM 等价；原生模块的可判失败断言等待接缝回传。 |
| `src/main/plugin-sources.test.ts` | 五源查询/排序/逐源状态、失败重查、固定版本捕获、本机目录与 Git/npm 相同内容转换、同名身份对照、缓存及前置比较数据。既有仅枚举两源/请求计数的断言按五源真实请求同步，保留 A1 的真实目录前提与 Claude 捕获内容断言。 |
| `src/shared/host-extension-package-contract/host-extension-package-artifact.test.ts` | 对照生成器及真实转换结果核验发布文件/声明/摘要；保留现有拒绝漂移与不引入运行依赖的检查。 |
| `test-fixtures/plugin-helper/` | 按下述 pinned 原字节增加 Codex、npm、OpenCode、Registry、正式目录样本；来源记录含 URL、提交/版本、取得时间、长度/摘要，npm 另记 integrity。裁剪归档只机械保留真实成员与必要原始头，另记原包和裁剪包摘要；完整 npm tarball 校验用原包。受控缺项、损坏或入口搬移对照记录与原件的差异，不手写第三方格式。 |

### 顺序

1. **S1 · Codex 市场与包**：先加入 pinned 清单、Figma 技能/MCP 与 `.app.json` 真实语料及可失败用例，再补 `readMarketplace(..., "codex")` 和 Codex 插件树转换；随后在来源模块复用 codeload 捕获、重读清单及子目录核验。覆盖 `.codex-plugin/plugin.json`，根 manifest 对照从实样机械搬移并注明差异。保留 Claude 用例；此时未实现的来源仍不可假报已查。重生 artifact 后跑本节三文件相关测试。
2. **S2 · OpenCode/npm 与本机目录**：加入真实 npm 搜索/定版 metadata/完整 tarball、OpenCode 配置及技能树，先补查询、integrity、目录捕获和配置转换用例，再落查询与只读捕获。相同内容分别以 folder/Git/npm 的 `Capture` 进入同一转换入口；真实 JSONC 的注释/尾逗号不另写解析器。包名、版本、integrity/提交进入已有 source 元数据。技能/MCP、命令/助手的发现按冻结章节实施；JS 只读字节、不 import、求值或安装依赖。原生模块的具名记录及 JS-only 包结果等待接缝冻结，不以丢弃文件取得通过。
3. **S3 · 官方 MCP Registry**：加入 GitHub 固定版本定义和真实 namespace/meta、npm/pypi/oci 定义样本；补查询与版本详情请求、publisher 推导、remote 优先/stdio 回退、模板和秘密占位用例，再实现 `convertMcpServerDefinition` 与来源捕获。定义不要求插件 manifest，输出仍为同一 `PluginPackage`；首次查询结果与定版详情的名字/版本须相符。失败按既有类别返回，不补造地址或把其他来源包装成官方。
4. **S4 · 五源合并与 A2 数据交接**：补齐五源并行查询、来源顺序/逐源失败、同名实际取源转换、身份相同/不同和搜索→捕获缓存复用的整条只读链。目录比较数据从现有已验目录/载荷取得，携带原 catalogId/packageId/version；不从候选名猜身份，不复制 payload decoder。同一份转换结果与已取字节交给 A2，A2 仍拥有提交前比较及目录重定向、安装/自动开启。核对所有 `plugin-sources`/converter 导出的直接测试调用者，跑相关三文件测试、生成器 `--check` 与 ui-mac `bun typecheck`；最后跑文档链接检查及 `git diff --check`。不跑全套/gate/bin/check，不接 UI/IPC。

每段对应同一组命令（cwd `packages/ui-mac`）：`bun test --max-concurrency 2 src/shared/host-extension-package-contract/plugin-conversion.test.ts src/shared/host-extension-package-contract/host-extension-package-artifact.test.ts src/main/plugin-sources.test.ts`；生成用 `bun src/shared/host-extension-package-contract/generate-artifact.ts`，检查加 `--check`。这些是**实施时拟执行**的检查，PLAN 未运行生产测试或 typecheck。

### 风险

- **规范化合同缺口**：见上方 `SEAM-CHANGE-NEEDED`。不能由本 lane 悄加 schema、让 A2 从字符串猜原因，或另建 OpenCode reader；设计回传后更新本节核对/偏离并增加具名回归。
- **实际样本与目录前提**：内置目录的 legacy `entries[]` 没有 GitHub，不代表正式目录 `packages[]` 没有。AC-02 使用下表正式签名目录及匹配载荷；`github-official` 的额外 header 集合作为不合并对照，不能只凭名字/URL 合并。目录缺席按规格允许在真实记录副本中删去该条并记录差异，生产目录不被过滤。
- **源缓存及分页**：远端分页索引需按实际响应继续取得本次查询匹配，不能人为截断候选；npm 搜索缓存按查询隔离，不能将一个关键词的响应当作整个索引。逐源网络/HTTP/格式失败不缓存为成功或空集；捕获失败不污染已固定版本缓存。并行查询的完成先后不决定候选顺序。
- **不同归档形状与本机树**：codeload 的 pax 提交和 npm `package/` 根/integrity 各自核验；只捕获、不执行。目录路径/链接/重复成员/摘要失配沿既有 Capture 规则，原文件字节及 mode 不因扫描改变。本机选择器和市场页面仍由 B 的安装/UI lane 接线，本 lane 不增用户输入条件。
- **秘密与部分有效定义**：复用已有 secret/replacements/digest 通道；OpenCode 环境/headers 与 Codex OAuth 字段从真实样本映射，公开包不含凭据原值。坏定义只诊断对应项，不让一个坏 MCP 丢掉其他合法技能。Registry 返回不能表达的定义仍按冻结诊断处理，不假造可运行 entry。
- **边界与证明强度**：同名合并及提供给 A2 的比较数据在此验证；真实聊天/「+」安装只装目录版本、事务去重、工具调用、管理页、开关/移除及项目字节不变仍需 A2/B/C 的集成验收，不能由 source 的内存结果代签。

### 证明

| AC | 测试/证据（拟新增名称） | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-02 · 真实目录优先与完整顺序 | `plugin-sources.test.ts`：`signed GitHub package and external definition supply the catalog identity and version`、`recorded source misses preserve catalog Claude Codex OpenCode order`。先验证正式目录中 `package:github@1.0.1` 及载荷摘要，再从真实记录副本逐次移除较高来源的匹配项，核候选身份/来源/顺序与每源 matched 状态。 | 目录样本缺项/变版首先使前提红；只查前两源、异步完成顺序排序或未保留目录版本使结果红。本 lane 不把此例冒称已从聊天/「+」安装。 |
| AC-02 · 身份来自取源与转换 | 同文件：`equal converted GitHub definitions fold to catalog while readonly headers stay distinct`、`same name with changed runtime definition remains separate`、`search comparison and later capture reuse pinned bytes`。比较真实 Claude GitHub 与正式目录普通 GitHub，并以 GitHub 官方配方额外 header 集合作对照；再从实样改变 URL/技能集合做具名对照。 | 用名称或索引直接写 `sameAs`、漏 header/技能集合、未取源转换或安装前重新下载漂移字节，都使身份/请求次数/摘要断言红。对比失败保持不折叠，不伪造相同身份。 |
| AC-02 · 每源无结果与失败有别 | 同文件：`every queried source distinguishes zero matches from network http and format failure`、`failed source retries without discarding successful siblings`。五源分别以真实空查询记录、损坏记录或传输失败对照，保留其余来源结果；覆盖 npm/Registry 实际分页与不同查询的缓存。 | 某源没查却报 ok、失败伪装 matched 0、缓存失败或一源失败吞掉其他结果会红；未知候选仍不能发起任意下载。 |
| AC-02 · Codex 规范化与固定来源 | `plugin-conversion.test.ts`：`pinned Codex Figma keeps skill MCP and provider metadata`、`real app identifiers stay unresolved without inventing MCP`；`plugin-sources.test.ts`：`Codex local entry captures only its pinned subtree and rechecks marketplace membership`。 | 缺 Codex parser/provider、漏技能/MCP、把 app id 当 URL、取错子目录或漏清单变化核验，都会使内容/诊断/commit 断言红；既有 Claude 等价用例保留。 |
| AC-05 · 独立官方定义可转换 | `plugin-sources.test.ts`：`GitHub registry candidate has namespace publisher and exact version detail`；`plugin-conversion.test.ts`：`registry GitHub without plugin manifest becomes one remote MCP with a Bearer secret need`、`registry remote preference and real npm pypi oci fallbacks preserve commands`。核固定版本详情与查询中 server 内容相同，检查 SecretNeed 的目标、模板及公开字节不含原值。 | 要求 plugin manifest、丢版本/publisher、从聊天地址产官方身份、秘密被写成普通 header 或命令映射不对会红；无可表达定义的对照须空 entries 加具名诊断。真实授权/调用与生命周期归 C/A2。 |
| AC-15 · OpenCode 技能/MCP同一转换 | `plugin-conversion.test.ts`：`pinned OpenCode JSONC and skills use the shared package model`；`plugin-sources.test.ts`：`folder and pinned Git captures preserve equal OpenCode entries and original bytes`、`npm version and integrity bind the captured package`。实样机械搬移覆盖 `skill`/`skills` 及 `.opencode/` 入口，记明变体；完整 npm tarball 单字节损坏对照须拒绝。 | 只支持 Claude、只支持 JSON、目录壳另产形状、遗漏源版本/摘要或不验 integrity 会红。测试逐文件比较扫描前后字节，并检查捕获/转换没有安装盘面副作用；不把它替代后续安装后的项目字节证明。 |
| AC-15 · JS 记录但不执行 | 接缝回传后新增 `OpenCode native modules remain visible with native-js-plugin while skills survive`、`native-only npm exposes no runnable entry`。真实 superpowers 模块和 npm 入口只读捕获；从实样派生带可观察写文件标记的执行对照，转换/捕获后该标记不存在，同时检查具名记录仍在。 | 单断言“不执行”不能防静默丢掉 JS；必须同时具名记录、保留技能与无执行副作用，撤掉任一行为均红。当前无冻结表示，尚不能确定该断言的字段读取位置；返回设计，不以弱断言顶替。 |
| 三项 AC · 发布产物一致 | 既有 `the published converter is self-contained ESM with the same conversion result` 扩到本节实样，并核 Registry 新导出；artifact 测试及生成器 `--check`。 | 只更新 TS、漏新导出/声明/摘要或运行产物仍用旧 parser，会与真实转换结果或发布文件摘要不一致而红。 |

**PLAN 已取得的真实语料**

2026-11-16 只读 GET，原件暂存于本机临时目录 `helper-sources-plan-su2r1brs`（系统临时根下）；PLAN 不向仓库加入夹具。实施时从固定提交/版本取原字节，逐文件记录来源及摘要。下表 archive 的版本由真实 tar 全局 pax `comment` 读得，npm 原包由 metadata 的 sha512 integrity 复核；不是运行/安装证据。

| 来源/样本 | 固定版本及已核事实 | SHA-256 |
| --- | --- | --- |
| [Codex 清单](https://raw.githubusercontent.com/openai/plugins/d420d13051bffe4543ed39e30fa46b87148e47dd/.agents/plugins/marketplace.json) | `openai/plugins@d420d13051bffe4543ed39e30fa46b87148e47dd`；18,951 B，raw 与同次 codeload 内原件相同 | `62ed7a1c906a7e486a84ee3f2f7eba048d075e360e355072e1b0823a128f432e` |
| Codex codeload 原包 | 同上；25,797,809 B；Figma 有实际 skills 与 `.mcp.json`，GitHub 有 `.app.json` | `7eafbb993eb7baafb213b88d85213efacaaea192279e48068410f72d4a8ffa36` |
| Codex Figma `.codex-plugin/plugin.json` / `.mcp.json` | 同上；1,677 B / 163 B；Figma 插件版本 `2.0.20` | `4a94826aedb047fed25d2a7b16a07aaf5bc4fb1238d47e51d71985fa3336010d` / `5ad3583f97d28e3dd065c38e024cef9eaf78f2b191930ead29021666ccc14466` |
| [npm 查询记录](https://registry.npmjs.org/-/v1/search?text=skills%20keywords:opencode-plugin&size=15) | 本次查询范围 `skills keywords:opencode-plugin`、size=15；17,004 B；仅作真实记录范围，不把 15 当产品限制 | `c1a13ee113d9d35c1e02404efeb5af0de7666d2e04788a10bd2f8be447fa212f` |
| [npm 定版 metadata](https://registry.npmjs.org/opencode-skills-hub/0.0.5) / tarball | `opencode-skills-hub@0.0.5`；2,143 B / 496,109 B；原包 sha512 integrity 一致；真实入口 `dist/index.js`，只有原生模块、无 SKILL.md | `60edbb9ba64b9104acf36acc7f023f9225b5d3a97047d4ed7eaace7bbac38464` / `200328d2a4066a8cfe5ae7307fc09faa5973d3405f4e755248d6967ecde9fdaf` |
| [OpenCode 源仓](https://github.com/InseeFrLab/opencode-onyxia/tree/bb5996565f7198c22dfe16acc0adfde98877d3e6) codeload / `opencode.jsonc` | `bb5996565f7198c22dfe16acc0adfde98877d3e6`；69,736 B / 16,585 B；归档有 15 个真实 SKILL.md 与 MCP 配置 | `417ee4da62b3e6d0c1bc62d5fffe97d303eba827557e506a48ea042601929142` / `bd2e8a4647da112e974c4f5f1f455e21533145486322ffc566d9f959fbd4bedd` |
| [superpowers 源仓](https://github.com/obra/superpowers/tree/22f0b463e7a5e579904dd6211a520321035526f7) codeload | `22f0b463e7a5e579904dd6211a520321035526f7`；542,813 B；含 `skills/using-superpowers/SKILL.md` 和 `.opencode/plugins/superpowers.js` | `fbb262b662873eca70bfc4152c688852e97f93c811e9635d490453941fecad05` |
| [GitHub Registry 定版详情](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.github%2Fgithub-mcp-server/versions/2.1.0) | `io.github.github/github-mcp-server@2.1.0`；1,505 B；与同次 latest 查询中的 server 相同，含 remote 与 OCI 定义，无插件清单 | `042afbd02aab3c0906d22d2d0b6861e47453bb5c6a390bc9bb60fd08d6bbf599` |
| [Registry npm 实样](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.microsoft%2Fplaywright-mcp/versions/0.0.85) | `io.github.microsoft/playwright-mcp@0.0.85`；630 B | `f25dcc6e540608783c4fab55e22bae71feaac720ca677d2c7ac2ce8f40ab00c6` |
| [Registry pypi 实样](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.bch1212%2Fagentfetch/versions/1.0.1) | `io.github.bch1212/agentfetch@1.0.1`；1,058 B；来自本次 `search=fetch&version=latest&limit=100` 返回的真实 pypi 定义 | `4685d3aa065ed3921e898e88c2d63a760241169b29165b11e4a054d69efe5654` |
| [正式目录](https://codepuppy.cn/catalog/v1/releases/2026-11-15.1/catalog.json) | `2026-11-15.1`；90,305 B；与 stable 指针 sha256/bytes 一致；指针和目录签名以仓内内置 Ed25519 公钥验证均 true | `abc42734f02cfe666dc0c12cd3884b5598b3f20fdc334020c15cee90c7a63db3` |
| 正式 `package:github@1.0.1` / `package:github-official@1.0.0` 的 MCP 载荷 | 326 B / 433 B，均与目录 payloadRef 摘要一致；同 URL，header 名集合分别为 `Authorization` / `Authorization,X-MCP-Readonly,X-MCP-Toolsets`，用作相同/不同身份对照 | `d242835ad2e7177222eeb403e543556b2c449d11da5ab1dcb6295769c2685d80` / `0a91f683ab6ccafba2b9480a14c5557b5990937c176a27203f434d02a0883222` |

### 偏离记录

2026-11-16 · 本次只写计划，生产与夹具文件均未改。AC-15 的原生 JS 记录因规范化表示缺口返回设计；其他来源的步骤与证明保留，未自定新合同。Issue 当前正文「依据/交接」仍钉 design v3 @8663fb2；本派发和代码上节收据钉 v4 @850fd2a，且 v4 §10 明确其余来源章节不变；引用差异返回编排器更新有效正文，本 lane 不改 Issue、不读取评论另择版本。安装、UI 与真实服务验收仍归其他车道。OPTIONAL：无。

PLAN 检查（2026-11-16）：`python3 scripts/check-doc-links.py docs/specs/plugin-helper-and-hub/plan.md` exit 0（2 条相对链接）；`git diff --check` exit 0。额外用 `check-docs-contract` 的只读 `check_repo`、Alpha 真实 profile 与 `changed_since=HEAD` 检查本工作树，exit 1：72 errors / 217 warnings（索引 1、README Project 链接 1、旧链接 28、旧目录 35、既有规格额外文件 4、跨仓规格/设计 ID 3）。原计划是工作文件未改的前缀，frontmatter 相同，3 个跨仓 ID 在 HEAD 已有；不修改范围外文档或撤掉引用。明细在上述临时目录 `docs-contract.json`，遗留去向为编排器/文档治理，非本片新增阻塞。原生 JS 合同缺口单独返回，其他检查不得被报告成全部通过。未跑生产测试、typecheck 或全门。本阶段约 18 分钟，仅新增本节 81 行；已核为计划作者 Codex（GPT-6）自查，不代替编排器核对。

2026-11-16 r1 / S1 红例 · 按续派填入核对回执，仅实施 S1→S3；新增 Codex 真实选择夹具（固定提交、9 个原文件及裁剪归档摘要）。三文件相关测试命令 exit 1，29 pass / 9 fail / 245 assertions，日志 `/tmp/helper-sources-s1-red.log`：7 个新增 Codex 行为失败，另 2 个既有请求计数已按新增 Codex 查询更新、实现尚未发请求；未改生产代码。

2026-11-16 r1 / S1 完成 · 实现 Codex local 清单、固定 codeload 子树、逐源失败重查、manifest/技能/MCP 与 app-id 诊断；同一声明文件去重避免凭据重复解析。Figma 实样的 oauth_resource 增加独立红例（0d10a838fa；17 pass / 1 fail，日志 `/tmp/helper-sources-s1-resource-red.log`）后保留为 LoginNeed 元数据，安装层仍按冻结规则报告 applicability。最终三文件测试 exit 0：39 pass / 0 fail / 271 assertions；artifact --check exit 0（17 files）；ui-mac `bun typecheck` exit 0。Bun 1.4.4 的 `bun run --max-concurrency 2 typecheck` 报 Script not found 2，实际使用标准包命令，测试始终 --max-concurrency 2。生产仅 converter/main sources 与生成 ESM/摘要；S2、S4 未实施。本轮开始 07:08:55 UTC，S1 约 8 分钟。

2026-11-16 r1 / S3 红例 · 新增 Registry 原始查询/定版响应（GitHub、Figma、Playwright/npm、agentfetch/pypi、真实空查询），逐文件记录 URL、版本、长度和摘要；分页/坏命名空间等对照由真实响应作具名受控变体。三文件测试 exit 1，新增 Registry 导出、取源和查询未实现；结果见 `/tmp/helper-sources-s3-red.log`。安装和 S2/S4 仍冻结。

2026-11-16 r1 / S3 完成 · 红例提交 61db45f45f：三文件测试 exit 1，36 pass / 11 fail / 271 assertions（8 个新增 Registry 行为，以及 3 个已有来源枚举/请求数等待 Registry 查询接入）。实现逐查询缓存、真实 cursor 分页、命名空间 publisher、定版详情与版本校验；captureCandidate 仍返回既有 Capture，Registry 提供 source.kind=mcp-registry 和 server.json，A2 按冻结 §4.1 调独立转换入口。转换覆盖 remote 优先、npm/pypi/OCI stdio、headers/runtimeArguments/environmentVariables、模板/非密待填变量的既有授权占位及私有凭据；共用 SecretNeed/LoginNeed 生成，未增加公开字段或依赖。最终三文件命令 exit 0：47 pass / 0 fail / 322 assertions；artifact --check exit 0（17 files）；ui-mac bun typecheck exit 0，文档链接与 diff --check exit 0。仅 named tests 直接消费这些导出，未跑全套或 gate。

本轮实际 S1→S3 共约 18 分钟，5 笔提交（S1 两笔红例和一笔实现，S3 红例和实现）；生产代码 +227/−61 行、相关测试 +212/−5 行及 15 个真实原文件/两份 provenance/一份裁剪归档与夹具 helper 调整，生成文件另计。执行顺序由续派调整为先 S1、S3；S2 原生模块表示等设计提交，S4 身份合并/安装前比较及 OpenCode 查询仍冻结。已核：Codex（GPT-6）作者自查；遗留去向：设计 amendment、S2/S4 续派及 A2 集成→编排器；安装/UI/真实调用证明继续由各 lane 收集；既有文档治理问题沿 PLAN 记录，不重查不修复。OPTIONAL：无。

2026-11-16 r2 / S2 红例 · 07:28:27 UTC 开始；接收并仅核 v5 @8bd3075 的四处修订，更新核对与接缝收据。加入 pinned superpowers 原生模块/技能、onyxia JSONC/15 个技能、完整 npm tarball/metadata/搜索记录，以及补充的真实 OpenCode local MCP 配置（archibate/dotfiles-opencode@46b6b23087de595d20df792bb4cbd769d3dfe20f）。本轮新增的规范化原生诊断、目录/Git/npm 路径与 integrity 红例，三文件命令 exit 1：44 pass / 10 fail / 339 assertions，日志 `/tmp/helper-sources-s2-red.log`；包含 7 个新行为失败和 3 个既有来源枚举/请求数等待第五源接入。npm 未命中对照从真实响应副本控制 objects/total=0，未手造外部格式。

2026-11-16 r2 / S2 可恢复实现 · OpenCode 技能/MCP/原生诊断、npm 第五源与完整包 integrity、目录/Git 捕获已实现；原生模块严格使用 v5 Diagnostic，tree 保留原字节，测试执行标记不存在。JSONC 直接复用已有依赖的 ESM 入口，避免 UMD 的动态 require 残留到发布产物（首轮 bundle Cannot find module ./impl/format 已修复）。三文件测试 exit 1：53 pass / 1 fail / 373 assertions，日志 `/tmp/helper-sources-s2-bundle-fixed.log`；唯一失败为本轮已提交红例断言错误：plugin-conversion.test.ts:31 期待 https://mcp.excalidraw.com/mcp，固定 onyxia 样本实际为 https://api.excalidraw.com/api/v1/mcp。依执行规则未修改该断言、未改源 URL 迎合测试，返回编排器纠正。artifact --check exit 0、ui-mac bun typecheck exit 0。其他相关行为已通过，S2 不报 DONE，独立 S4 继续。

2026-11-16 r2 / S4 红例 · 增加正式签名目录 GitHub 普通/官方载荷、来源和摘要记录，使用既有 evaluatePackageForHost 的 accepted 事实而非另写 decoder。准备通过 catalogPackage 私有依赖取得 PackageAcceptedFactsV1；新增比较数据与转换缓存方法供 A2 调用，不改变冻结的查询/转换类型。S4 红例覆盖目录身份版本、相同/不同 header、转换后身份、缓存与真实记录缺席顺序、stdio 版本规整和全部技能集合。三文件测试 exit 1，详见 `/tmp/helper-sources-s4-red.log`；S2 已知 URL 断言仍保留。

2026-11-16 r2 / S4 核对补充 · 目录身份只需已验内容，不应依赖 Electron 密钥就绪。正式官方包的测试准备函数原用 evaluatePackageForHost 会因 package-prerequisite-invalid 拿不到内容；已将准备函数改为既有 envelope/payload decoder 和真实摘要检查，不改任何结果断言。catalogPackage 私有输入取既有事实的 envelope 与 payload 最小投影，A2 仍可直接给完整已验事实。另新增真实 npm Capture 仅改来源为 folder 的回归，exit 1（provider 错为 claude-code），日志 `/tmp/helper-sources-folder-red.log`；需补无专用目录标记时的包入口发现，才能保证同树不同来源语义一致。

2026-11-16 r2 / S4 完成（本轮总体 PARTIAL）· 主进程先取源并经同一 converter 规范化，再按冻结公式比较，目录之间不合并；同名取源/转换失败保留不折叠。convertCandidate 缓存并返回同一 Capture、package、replacements、privateCredentials 和 runtimeIdentity；catalogComparisons(name) 返回 catalogId/packageId/version/runtimeIdentity，pluginRuntimeIdentity 为同一身份算法出口，供 A2 提交前比较已安装定义。catalogPackage(id, version) 为 main 内部依赖，接收既有已验事实的最小内容投影（envelope 与 components[].payload），不添加 IPC/安装公共合同，也不要求登录/密钥环境才可读取定义。技能名仍由同一 converter 从已验 SKILL.md 取得，不从组件 ID 前缀推导。目录载荷解码/验签权威、builder、账本及安装动作未复制或更改。

S4 红例 0f97d78bd3：三文件 exit 1，55 pass / 5 fail / 390 assertions（4 个新 S4 失败及已知 S2 错误断言）；真实目录准备函数的修正不改变结果断言。补充 folder 红例 3f48a4ed49 已转绿。最终三文件命令 exit 1：60 pass / 1 fail / 406 assertions，日志 `/tmp/helper-sources-r2-final.log`，唯一失败仍为 plugin-conversion.test.ts:31 的 URL 断言，固定语料实际 URL 见 opencode/onyxia/opencode.jsonc。单独运行相同来源/artifact 两文件，exit 0：35 pass / 0 fail / 263 assertions；generator --check exit 0（17 files），ui-mac bun typecheck exit 0，文档链接与 git diff --check exit 0。未跳过、放宽或更改失败断言，未跑 gate/bin/check。

本轮约 28 分钟，生产 TS +311/−88 行、相关测试 +252/−3 行（不计原始语料/生成字节）；文件均在授权范围。计划 delta：v5 的原生模块 Diagnostic 接缝已关闭；按真实输入补充 local MCP 配置及 npm→folder 等价回归；S4 使用既有已验内容的最小投影，避免把内容身份绑到账号就绪。本轮新增红例 URL 写错由作者负责，按 brief 返回编排器纠正并复跑；S2 功能代码已保存但不宣称验收通过。S4 查找/比较链完成，A2 的 nothing-runnable/notRunning、提交前去重及安装/运行/UI 结果仍由安装车道集成。已核：Codex（GPT-6）作者自查；遗留去向：这一条断言纠正和 A2 接线→编排器；OPTIONAL：无。

2026-11-16 r3 / 来源车道完成 · 收到编排器对固定实样的裁定，仅把 plugin-conversion.test.ts:31 的 URL 字面量纠正为 opencode/onyxia/opencode.jsonc:392 的 https://api.excalidraw.com/api/v1/mcp（该样本固定于 bb5996565f7198c22dfe16acc0adfde98877d3e6，SHA-256 bd2e8a4647da112e974c4f5f1f455e21533145486322ffc566d9f959fbd4bedd）。其余断言、生产代码和样本字节不变。三文件命令 `bun test --max-concurrency 2 src/shared/host-extension-package-contract/plugin-conversion.test.ts src/shared/host-extension-package-contract/host-extension-package-artifact.test.ts src/main/plugin-sources.test.ts`（cwd ui-mac）exit 0：61 pass / 0 fail / 407 assertions；`bun src/shared/host-extension-package-contract/generate-artifact.ts --check` exit 0（17 files）；`bun typecheck` exit 0。文档链接与 diff 检查 exit 0。r2 唯一测试阻塞解除，S1–S4 的本 lane 查找/捕获/转换/比较工作完成；安装/UI/真实服务验收仍归 A2/A3/B/C。已核：Codex（GPT-6）作者自查；OPTIONAL：无。

A2/A3 接线收据：主进程每次应用运行创建一份 `createPluginSources`；`catalog` 提供已验目录候选，`catalogPackage(id, version)` 提供既有已验事实的 envelope 与 components[].payload 内容投影。实例 `searchSources` 返回五源状态/候选；`captureCandidate`、`captureFolder`、`captureGit` 只读捕获；`convertCandidate` 返回缓存的 Capture、规范化包、replacements、privateCredentials 和 runtimeIdentity；`catalogComparisons(name)` 给出目录 catalogId/packageId/version/runtimeIdentity。独立导出 `pluginRuntimeIdentity` 供提交前比对复用。转换运行时统一导入 `plugin-conversion.mjs` 的 `readMarketplace`、`convertPluginTree`、`convertMcpServerDefinition`，类型由同目录 TS/声明文件提供；查询类型为 `PluginSourceIdV1`、`SourceStatusV1`、`CandidateV1`、`SourceSearchResultV1`。转换合同为 `Source`、`Capture`、`PluginPackage`、`Entry`、`Diagnostic`、`Text`、`SecretNeed`、`LoginNeed`；A2 仅从 Diagnostic 的 code/path/sourceName 生成 notRunning，不解析 message，零可运行时由 A2 返回 v5 的 nothing-runnable 结果。

## 切片 D

- 依据：[Issue #1724](https://github.com/impharaon/alpha-code/issues/1724)；[SPEC-plugin-helper-and-hub v3](https://github.com/impharaon/alpha-work/blob/8663fb2a982eaf7c626bfee3bcd8b20b870f2577/docs/specs/plugin-helper-and-hub/spec.md) AC-04、AC-08、AC-09、体验约定；[DESIGN-plugin-helper-and-hub v4](https://github.com/impharaon/alpha-work/blob/850fd2a61f220596fb10922c8b2e477c7475fac4/docs/specs/plugin-helper-and-hub/design.md) §4.4–4.6、§5、§8 D、§10。消费 §4.1 的唯一入口及 A1 转换产物，不重定合同、来源顺序或 owner 决定。
- 核对：Phase: IMPLEMENT — e2b26e5ecd · orchestrator/Claude Fable 5.2 · plan check passed (AC-04/08/09/16 each have failing-capable proof including the debounce-window isolation case; steps that wait name their seam; no restriction added). r1 仅授权 D1、D2、E1，其他步骤继续等待具名接缝。 r3 已接收完整 A1–A4、H 与来源车道（基线 f876922949），授权 E3→D3→D4→D5；D5 真实模型验收交编排器。
- 基线：`8e40a921ec09cc95d8580142fd45af760d3599d1`，派定工作树/分支沿本次 brief；A1 已有 converter、真实语料和 `createPluginSources`，A2–A4 尚未接入。本次仅追加 D/E 两节，不修改 A 的记录、规格、冻结设计、规则或 H 页面。
- 预计实施：约 9–12 个生产/资源文件、6–9 个测试/夹具文件，600–1,000 行实质改动（不计真实记录），3–5 小时；按下列提交单元推进，每个 AC 后核对用时和证据。等待合入不计作已实现。

### 改动

路径除 `packages/ext/` 外均相对 `packages/ui-mac/`；标为“新增”的文件在本基线不存在。共享文件等生产方合入后再改，消费其导出，不复制实现。

| 文件 | 改什么 |
| --- | --- |
| `resources/factory-skills/plugin-helper/SKILL.md`（新增） | 编写可直接随包使用的完整技能：模型触发说明；PS 必要的一问；检索、语义匹配、已有包安装与无匹配制作；项目范围参数；登录/令牌动作及真实状态短报。工具名、参数与职责引用设计 §4.5/4.6，使用规格原句，不以占位正文交付。 |
| `src/main/factory-skills.ts`、`factory-skills.test.ts` | 在既有 `FACTORY_SKILL_IDS` 与 `factorySkillSources` 登记 `plugin-helper`，验证 dev/packaged 路径与实际 reconcile 注入。出厂资源仍直达应用资源，不制造用户安装记录。 |
| `src/main/created-plugin.ts`、`created-plugin.test.ts`（新增） | 将冻结 `CreatedPluginDraftV1` 的文件转为 converter 的真实 capture，并生成插件 manifest；只负责自制输入的组装/形状与 RelPath 校验，提供方语义仍交 A1 converter。不实现另一套技能安装器、事务或路径规则。 |
| `src/main/plugin-sources.ts`、`plugin-sources.test.ts` | 在同一个 main 来源实例内留存实际 `searchId` 对应的来源状态，供制作分支读取；用来源拥有方的适用集合校验查询完成，不复制来源名单。A1 当前只有目录/Claude 返回值，且没有搜索记录查阅能力；D 补记录消费，不把这两个来源的成功当成全部适用来源成功。 |
| `src/main/install-from-source.ts`、`install-from-source.test.ts` | 接入冻结 `source.kind: created`：先核 main 记录，再转换并走 A2 的宿主命名、去重、事务、图、自动开启及生效路径。`source.kind: created` / `origin: created` 的结果仍由入口生成；错误沿既有 `not-searched`、`invalid-draft` 等类别。 |
| `packages/ext/src/hub-tools.ts`、`context-injection.ts` 及对应测试；`src/main/codepuppy-sidecar-messages.test.ts` | 在 A3 的同一 bridge、普通工具判定和阶段读取上登记 `codepuppy_hub_create`，复用其 created 消息合同、requestId 与结果 metadata；参数不加秘密、确认或路线字段。同步真实工具清单/上下文快照及直接 mock 消费者。 |
| `src/renderer/extensions/extension-hub.tsx` 的 `FactorySkillRow` 回退、`src/renderer/i18n/zh.ts` / `en.ts`；`src/renderer/extensions/plugin-helper.test.ts` 与 `test-component/plugin-helper.cases.ts`（新增） | H 合入后仅接出厂技能键的名称/说明：「插件助手」「查找并安装插件和 MCP」。生产 DOM 验证「系统」行；自制包的行、菜单、来源和管理页消费 H/A4 已有接缝，不重写 H 页面。 |
| `src/main/created-plugin.engine.test.ts` / `created-plugin.engine.cases.ts`（新增）、`test-fixtures/plugin-helper/` 的新增查询记录及 provenance | 真实入口→安装→技能载入/执行→整包移除；记录查询 URL/范围、时间、上游固定版本及每份原始字节 SHA-256。既有第三方语料引用 A1 `provenance.json`，不手写市场、manifest 或 MCP 的替身。自制草稿是本应用输入，不冒称第三方样本。 |

### 顺序

1. **D1 · 仅新增文件，可立即并行**：只写新的 `resources/factory-skills/plugin-helper/SKILL.md`。按 §4.5 的职责分工逐项写出实际操作：清楚目标直接查；歧义 PS 用「你要读取 PSD 文件，还是操作 Photoshop？」；先 search、后 install/create；无匹配用「在本次查询的来源中没有找到现成插件，正在为你制作一个自己的插件。」；只在用户明说时传项目范围；不提前建环境/写技能、不用 register 安装、不在聊天要令牌、不假报官方或已可用。本提交暂未接出厂注册，不据此声称 AC-09 完成；资源可达性普查待 D2 一起通过。
2. **D2 · 含既有文件，可独立于 A2–A4/H 开始**：登记 factory IDs/资源路径，补真实资源的 reconcile 与零账本证据；运行 factory、打包资源可达性、非空壳检查。此步不修改 renderer、不改 A4 拥有的 `customize-codepuppy` 安装段。构建应用的行为验收仍等 D4/D5。
3. **D3 · 等 A2、A3 合入，并在 B/C 的来源 delta 上集成**：接缝是 A2 `installFromSource`/converter/自动开启、A3 `CreatedPluginDraftV1`/bridge/阶段与普通权限路径、同一 main 来源实例。先落制作资格、坏草稿、真实整包安装的可失败用例，再补创建 capture、搜索记录与工具接线。未知 searchId、任何适用来源失败或未查询都须在写盘前返回 `not-searched`；不能仅用返回数组的 `every(ok)` 放行缺来源的 A1 结果。匹配与否仍由助手按目标判断，不能新增“候选数组必须为空”的限制。B/C 未合入时只做其已存在接缝的代码，不宣称完整无匹配链可用。
4. **D4 · 等 H、A4 合入**：接缝是 H 的 `FactorySkillRow`/包行/整包状态与移除、A4 的 source 呈现及 `hubInstall` 对 create part 的投影。只补出厂文案回退及 D 的生产 DOM/自制来源集成例；复用已合入时间线订阅、按 packageId 管理和移除。若接缝缺失，按 A 节已有返回向编排器报告，不在 D 复制页面或卡片。
5. **D5 · 等 D3/D4 及 B/C 的完整查询/独立 MCP 链**：跑创建引擎回归、受影响包 typecheck；向编排器交构建应用的四份验收脚本/所需证据：歧义 PS、已明确 PSD、清楚任务且全来源无匹配、已有匹配/来源失败对照。由编排器在实际模型会话收集顺序、提问数、真实任务与界面证据；使用出厂技能分别装插件和独立 MCP。未取得模型行为证据不能只凭技能正文报 AC-04/08/09 通过。

### 风险

- **来源完整性与语义判断不同**：工具校验实际查询记录，助手判断能力是否匹配。无匹配正例必须保留各适用来源真实联网记录；已有匹配、同名不同用途和失败记录分别对照，不用删除生产目录或伪造空市场得到正例。B/C 的来源增量是完整验收依赖，本车道不实施其查询器。
- **提示词不能代替行为证据**：内容审读与出厂非空壳检查只能证明资源质量；PS 只问一次、先查后写、无第二次同意、优先现成包、真实任务使用必须从实际工具 part/会话与盘面证明。失败查询绝不触发制作原句；来源标签由 main 的事实给出。
- **接缝与命名**：草稿中的路径/内容经生产转换与 A2 的宿主名称映射处理，保留重名对照；不再手写第三方解析。自制技能依赖包内资料能否运行沿既有 converter/物化能力，如实显示 `notRunning`，正例选本增量可运行的独立技能。零可运行内容、事务失败和阶段中止沿 A 的行为验证，无新增大小/次数/有效期限制。

### 证明

下列均为 **IMPLEMENT 拟执行**，PLAN 不把它们记为已运行。实际模型验收归编排器，保留请求、工具序列、来源原字节/摘要、产物、引擎结果与界面证据，不新增“检查文字是否包含某句”的文档测试。

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-04 | 构建应用重放「帮我安装 ps 插件」→回答读取 PSD；对照直接说读取 PSD。核实际问题次数（1/0）、search 返回的所有适用来源、第一笔自制动作的先后顺序；匹配正例安装已有候选，无匹配正例按约定句制作；来源/包行不冒称官方 Photoshop。 | 反复提问、用含糊品牌直接制作、查找前建 Python 环境/写技能、遇到匹配仍制作都会在会话序列或盘面失败；明确 PSD 仍提问也失败。 |
| AC-08 · 制作资格 | `created-plugin.test.ts` / `install-from-source.test.ts`：`complete successful search admits created draft`、`unknown failed or incomplete search has no writes`；完整状态由真实查询记录驱动，分别删去一项来源、换未知 ID、使用实际失败记录。助手的有匹配对照留在模型验收。 | 拿掉 main 的 searchId 校验会令失败/缺来源对照落账；只检查已有返回项全 ok 会错误放行不完整记录；把语义匹配强加成 candidates.length=0 又会错误拒绝有无关候选的任务。 |
| AC-08 · 装好、使用、移除 | `created-plugin.engine.test.ts`：`created skill installs through the shared entry and runs`；真实临时盘上检查同一 packageId、真实 root/组件、enabled、技能目录被引擎发现并可通过技能工具读取/执行明确任务；H DOM/构建应用显示「我的插件」、一包一行、整包移除后入口与专有内容消失。安装前后项目文件树/原有文件 bytes 相同。 | 旁路安装、仅写散落 SKILL.md、未开启、仅返回成功文字、不能用于任务、来源读包前缀、移除留下组件或写项目文件都会使对应实际断言失败。 |
| AC-08 · 无二次同意 | 同一无匹配任务的真实模型会话：约定句后直接 create/install；已匹配和任一来源失败两个对照均无自制动作；普通工具档位检查沿 A3 的相关用例。 | 新增“是否同意制作”或把普通工具审批误当安装确认，会改变会话/工具序列；失败源冒称无结果、先创建后补查会被对照抓住。 |
| AC-09 | `factory-skills.test.ts`、资源 census/hygiene；新引擎从真实出厂目录发现 `plugin-helper` 并能读到完整技能；干净应用「系统」行显示精确名称/说明，用户账本没有 helper 包。再经助手分别安装真实插件与 C 的独立 MCP，H 各一包一行。 | 少资源、漏 registry、未进入显式技能注入或只有空壳分别被资源/引擎断言抓住；依赖另装 helper 包会在干净数据根失败；只测 registry 不能替代两类真实安装。 |

**相关命令（IMPLEMENT）**：ui-mac 内运行 `bun test --max-concurrency 2 src/main/created-plugin.test.ts src/main/plugin-sources.test.ts src/main/install-from-source.test.ts src/main/codepuppy-sidecar-messages.test.ts`；`bun test --max-concurrency 2 src/main/factory-skills.test.ts src/main/codepuppy-skill-packaging-census.test.ts src/main/codepuppy-factory-skill-hygiene.test.ts src/main/created-plugin.engine.test.ts src/renderer/extensions/plugin-helper.test.ts`。ext 内运行 `bun test --max-concurrency 2 src/hub-tools.test.ts src/hub-bridge.test.ts src/context-injection.test.ts`；工具清单、自动化 deny/普通权限及 changed exports 的直接 mock 消费者按实际 delta 补跑。A4 的 `timeline-model.test.ts` / `hub-install-card.test.ts` 和 H 的 `hub-three-pages.test.ts` 只跑 create/source 直接相关文件。两包各 `bun typecheck`，不跑全 gate/bin/check。PLAN 只运行末尾两项文档检查。

### 偏离记录

2026-11-16 r1 · D2：登记 factory ID/资源路径；新增 dev、packaged 两例，使用本仓真实技能原字节和引擎 SkillScan/SkillFile 发现链，packaged 例按生产 electron-builder `extraResources` 的 from/to 复制整目录，核对零新建全局根及已有空账本字节/文件集不变。未运行整包构建/签名或模型任务。新例注册前 exit 1（2 fail，均缺 plugin-helper），注册后 ui-mac 三组 factory/census/hygiene 命令 exit 0（63 pass、289 assertions）；`naming-migration-wiring.test.ts` exit 0（9 pass、74 assertions）；`brand-guard.test.ts` exit 0（25 pass、89 assertions），均 `--max-concurrency 2`。机械同步 census 的新出厂项枚举，未改打包配置或其他资源。`bun typecheck --max-concurrency 2` 被 tsgo 拒绝（TS5072，exit 2），改用 `GOMAXPROCS=2 bun typecheck` exit 0；这是工具参数适配，不改变产品或冻结合同。其余无偏离，AC-04/08/09 尚未验收。

2026-11-16 r1 · D1：新增完整 `plugin-helper/SKILL.md`；尚未登记出厂路径，资源可达性待 D2。首笔实施提交按续派 Phase 行填入 D/E 核对回执；未改其余接缝。ui-mac `bun test --max-concurrency 2 src/main/codepuppy-factory-skill-hygiene.test.ts` exit 0（24 pass、0 fail、68 assertions）；文档链接与 `git diff --check` exit 0。实际资源审读覆盖本节 D1 的工具/文案与边界，未用正文字符串断言代替模型验收。原输入缺口已由编排器同步 Issue 的 design v4 引用（本轮回执），不再待办。无计划偏离。

## 切片 E

- 依据：[Issue #1724](https://github.com/impharaon/alpha-code/issues/1724)；[SPEC-plugin-helper-and-hub v3](https://github.com/impharaon/alpha-work/blob/8663fb2a982eaf7c626bfee3bcd8b20b870f2577/docs/specs/plugin-helper-and-hub/spec.md) AC-16、体验约定及已定的提案 A；[DESIGN-plugin-helper-and-hub v5](https://github.com/impharaon/alpha-work/blob/8bd3075/docs/specs/plugin-helper-and-hub/design.md) §4.4、§4.6、§5、§8 E、§10 R2-F2 与生效修订。r2 已核 §4.4 相对原计划不变，§5 的作用域/断开路径由后续 E3 消费；不增加范围选择步骤或重定默认。
- 核对：Phase: IMPLEMENT — e2b26e5ecd · orchestrator/Claude Fable 5.2 · plan check passed (AC-04/08/09/16 each have failing-capable proof including the debounce-window isolation case; steps that wait name their seam; no restriction added). r1 仅授权 D1、D2、E1，其他步骤继续等待具名接缝。 r2 续派仅授权 E2；重栈基线 1a218e8a2e，消费 design v5 @8bd3075（§4.4 不变、§5 的 Location/断开说明已核），E3 与 D3–D5 继续冻结。 r3 基线 f876922949 已接收 A3/A4 与 H 最终接缝，现授权 E3，合并原 E4 的范围展示与 E5 的自动化隔离证明；不新增范围编辑控件。
- 基线：同 D 的 `8e40a921ec`。已核现状：`ext-receipt-v2.ts:586–735` 是允许集唯一发布方；`packages/ext/src/gen-skill-paths.ts` 只读 v1 keys；main 的 `explicitSkillDirs` 直接复用它；`engine-explicit-config.ts:133` 以 100 ms 去抖刷新；`plugin.ts` 已有 post 段后的 agent/provider tail，可复用机制。上述是 E 的改动落点，不据此重审冻结方案。
- UI：沿 A 节链接的批准帧 `#manage` 和现有 H 管理页，仅接「生效范围」及「我的所有项目」/「仅当前项目」展示；本片不新增范围编辑控件、安装前提问或 H 页面。
- 预计实施：约 10–13 个生产文件、7–10 个测试文件，800–1,200 行实质改动，4–6 小时；每项隔离证明后核对时间/规模，明显翻倍则交回，不扩成配置/权限重构。

### 改动

路径约定同 D；与 D 共用文件时先完成 D 的提交再集成 E 的范围行为，不同时写同一文件。

| 文件 | 改什么 |
| --- | --- |
| `packages/ext/src/package-scope.ts`、`package-scope.test.ts`（新增） | 实现设计已冻结的 `PackageAllowSetV2` 单一类型/解码与 `managedSkillAllowedHere` 正向成员判断；相同的项目匹配供 MCP 消费。仅依赖自身合同/路径基础库，可先开发；不另建配置文件、账本 decoder 或副本规则。 |
| `src/main/ext-package-ledger-v3.ts`、`ext-package-ledger-v3.test.ts` | 在 A2 已扩展的图上加入 effect 的严格解码/摘要覆盖，消费既有 `projectScopeIdentity`；记录仍全局物理安装。 |
| `src/main/ext-receipt-v2.ts`、`ext-receipt-v2.test.ts` | 沿同一允许集发布点由真实 records/包图生成 v2；测试 tuple 交集收窄、账本提交、完整发布和 `projectionLag`/启动重算。类型消费 ext 的同一合同；不另存范围真源、不兼容旧投影。 |
| `packages/ext/src/gen-skill-paths.ts` / `.test.ts`、`src/main/codepuppy-config-injection.test.ts`、`engine-explicit-config.test.ts` | 技能注入读取 v2 的 keys 与 scoped(skill) 的并集，沿现有 live generation 和 main 调用链；更新明确编码旧版本的断言，保留未知版本/坏文件失败对照。实际 watcher 的输入和去抖机制复用，不为测试增加产品开关。 |
| `packages/ext/src/plugin.ts`、`plugin-host.test.ts` | MCP transform 在配置 MCP 已存在后仅启用匹配 scoped 项；受管技能使用 postActivationTail 收口，`plugin.updated` 后重放；setup evaluate 使用同一个 `managedSkillAllowedHere`。识别受管目录后才套成员规则，出厂/原生/项目自带技能保持原判定。 |
| `src/main/install-from-source.ts`、`ext-package-tx-builders.ts`、`ext-install-planner.ts` 及对应入口/builder/状态测试 | 将 A3 的 this-project 请求经 main 项目身份解析写图 effect；全局 MCP 物化与包根开启均保持项目项的持久停用，启用状态仍由包根/允许集表达。默认请求消费既有 all-projects，不写项目配置。 |
| `src/main/package-mcp-activation.ts` / `.test.ts`、`hub-view.ts` / `.test.ts` | 在 A2 运行时接入的同一路径中按 effect 选择已加载 Location；关包、移除或收窄时撤掉不再匹配的运行时项，后加载 Location 读持久停用配置并由 ext 匹配。按当前目录实际工具/状态回读可用性。 |
| `src/main/ext-ipc.ts`、`src/renderer/extensions/ext-ipc.ts`、`extension-detail.tsx`、`src/renderer/i18n/zh.ts` / `en.ts`，H 的 `test-component/hub-three-pages.cases.ts` | H 合入后通过既有 installedPackages 只读投影传图的 effect，管理页接范围字段与精确文案。复用 H 的包身份、权限/账户/关于及整包动作，不承接 H 的页面建设或新写 IPC。若 preload 类型是该视图导出的直接消费者，只做同笔机械类型同步。 |
| `src/main/package-effect.engine.test.ts` / `package-effect.engine.cases.ts`（新增） | 复用 A2 真引擎宿主及真实安装产物，证明两个已加载 Location、后加载/重建、技能执行与真实 MCP 工具可见性；包含关包/改范围的旧显式配置窗口。每个用例核隔离数据根和项目快照。 |

### 顺序

1. **E1 · 仅新增文件，可立即并行**：新增 `packages/ext/src/package-scope.ts` 与单元测试，直接消费冻结形状。先钉住正向/反向成员、未知项目/坏允许集、同名不同项目、空但合法 v2、keys 成员与 scoped 成员对照；尤其是条目已离开 scoped 的合法文件。此时不改 main 发布方、现有 gen-skill-paths 或 plugin 接线，不能把纯函数通过当作 AC-16 验收。
2. **E2 · 等 A2 合入**：接缝是扩展后的包图/摘要、`installFromSource`、MCP 叶子 builder 与包根状态。先补 effect/投影/全局 MCP 恒停用的红例，再接 v2 唯一写方及 gen-skill-paths 读方，同笔更新所有直接编码 v1 的相关断言。不迁移记录、不双读两版；沿原发布顺序实现并证明范围变更的 tuple 交集。A3 的 scope 运输可尚未调用，本步直接从真实入口测试驱动。
3. **E3 · 等 A3、H 合入；运行时部分同时等 A2**：A3 接缝为 install/create 的 scope 与 Location.directory，H 接缝为同一 `setPackageStateV1`/卸载/自动生效动作。接 main 身份复核、ext MCP transform、技能尾巴/evaluate 与 A2 runtime 接入的 Location 过滤；跑真正插件宿主和跨 Location 引擎例。D 已实现 create 后补其 this-project 对照，不复制 D 的创建入口。尾巴、权限兜底只能共用 E1 判断；不改 Core/Server 或引擎代次。
4. **E4 · 等 H、A4 合入**：接缝为 `InstalledPackageV1` 安全只读投影、H 同包管理页与 A4 真实可用状态。仅增加 effect 的展示与对应 DOM 证据；项目乙即使能管理同一全局包，也不能将仅甲的组件报告成可用工具。缺接缝只返回编排器，不在本片重做包行/管理页。
5. **E5 · 等上述接入及 B/C 的真实来源样本**：完成 AC-16 的默认全局、显式项目、缺投影、合法收窄、去抖窗口和重建用例；跑直接相关回归/包 typecheck。向编排器交构建应用两项目普通请求、明确项目请求及管理页/真实任务证据脚本。不可用来源或未跑真实 MCP 的例子如实留未验收，不用 stub 代替通过。

### 风险

- **允许集暂态**：不能只按技能 key 求交集而忽略 kind/name/projectPath，全部项目→项目甲或项目甲→项目乙都须先撤后增。用现有 final-publish 注入点验证失败仍停在窄态、回报 projectionLag，再由生产启动对账恢复；不是新增恢复协议。
- **已解析技能会回来**：配置插件持有旧技能路径，即使新允许集合法且没有该条目，也会在 watcher 刷新前重建。尾巴须在真实 post 段之后，未安置时的 evaluate 也必须拒绝不再是正向成员的受管技能。测全局 keys 移除和 scoped 移除两支，不能只测“scoped 存在但项目不同”。
- **运行时与持久状态**：MCP 热接入不能无视 effect 给所有 Location add；H 再开启不能把项目 MCP 的全局 enabled 改成 true。用安装、关包/再开、移除和范围收窄的真实链校验，而不把 recordingMcp 记账服务当作真实隔离证据。
- **窗口证据不能空跑**：引擎用例先证明旧配置确已解析该技能、技能曾可用，且新允许集已落而显式配置仍旧，再触发重建。以实际前提/屏障定位窗口，不靠 sleep 后猜时序；没命中旧配置窗口就失败，不跳过。scope 更新由真实包图 mutation/账本提交驱动，不为构造反例新增面向用户的 scope 编辑能力。

### 证明

所有实现用例拟执行，当前 PLAN 只做代码阅读。真实第三方输入复用 A1 `test-fixtures/plugin-helper/provenance.json` 固定的 Claude `b5b01ac4…`：`frontend-design` 技能、context7 插件、Playwright MCP；独立 MCP 的注册表原字节/版本/摘要消费 C 的真实语料。新格式只允许为本应用的 v2 合同/草稿构造状态，不手写第三方格式。各测试先断言样本的真实类型/无需凭据和不同运行身份，再断言范围结果，避免去重掉“另一包”而空跑隔离。

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-16 · 默认所有项目 | `package-effect.engine.test.ts`：`default plugin and standalone MCP are usable in both projects`。干净数据根从甲普通请求分别安装 frontend-design 插件和 C 的真实独立 Playwright MCP；甲乙真实引擎都发现并可调用技能/浏览器工具，账本只有各自同一个 packageId。 | 默认错误写 project effect、仅向请求 Location 热接入或在乙复制安装，会分别使乙调用/工具清单、同一包计数失败。仅有 config 或 connected 状态不能通过。 |
| AC-16 · 明确仅项目 | 同宿主从甲明确只在本项目装另一 context7 包，真实工具在甲可用、乙无可用入口；另一个隔离数据根以真实 frontend-design 验证项目技能在甲可读/使用、乙不在技能清单且实际 skill 请求不放行。检查项目身份 realpath 与无项目 Location 对照；重建/后加载乙结果相同。 | 把技能路径注入当最终隔离、只在 setup 早删、未知目录当全局、MCP 全局启用或 runtime add 不过滤，都会在乙实际清单/执行断言暴露；仅改 UI 标签无效。 |
| AC-16 · 允许集发布/失败 | `ext-receipt-v2.test.ts`：`scope shrink publishes intersection before ledger`、`final publish failure remains narrower and reconciles`；用真实安装派生 v2，核全部→甲、甲→乙、关包、移除；读取缺失、未知版本/畸形文件对照。 | 只比较 keys、提前扩容或失败时解释成全局会留下可运行成员；记录/图/投影次序及 ext 读回断言失败。移除所有数据后仍保留旧成员也会失败。 |
| AC-16 · 去抖窗口关包 | `package-effect.engine.test.ts`：`disabled managed skill stays absent with stale explicit config`；先真实安装并可用，再开生产 watcher，经 H 同一包根动作关闭，在允许集已更新而显式文件仍含旧 generation 的窗口触发生产配置技能重建。尾巴完成后清单不含该技能；尾巴未安置子场景实际 evaluate 不放行。keys/scoped 两类均覆盖。 | 撤掉尾巴或改成“只删除不匹配 scoped 条目”的旧规则，合法允许集不再含该条目时会把已解析技能加回；撤掉 evaluate 则尾巴未安置的真实执行对照失败。 |
| AC-16 · 去抖窗口改范围 | 同文件 `scope change cannot revive a parsed skill in another project`：乙已解析全局技能，实际包图提交将 effect 收窄到甲，v2 仍合法；在乙显式配置未刷新时重建并尝试 skill。另测甲→乙，确认旧项目撤回且新项目可用；MCP 由同一范围提交触发既有 runtime 撤销路径。 | 没测曾经可用的乙、仅看磁盘、只删显式目录或只测坏 JSON 都会漏错；合法 scoped 已删除/换项目仍放行时，旧 Location 的真实清单/调用断言变红。 |
| AC-16 · 管理与项目零写入 | H 生产 `hub-three-pages.test.ts` 从同一 packageId 打开管理页，显示精确范围；构建应用甲乙各执行真实调用，安装/关开/移除前后所有已有配置 bytes/digest 相等，空项目无新增配置/技能目录；数据根只见全局包。 | 展示安装落点而非 effect、误报乙可用、分成两包、向 `.codepuppy` / `.mcp.json` / 项目技能目录落文件会令 DOM、包身份或全树快照失败。 |

**相关命令（IMPLEMENT）**：ext 内运行 `bun test --max-concurrency 2 src/package-scope.test.ts src/gen-skill-paths.test.ts src/engine-transforms.test.ts src/plugin-host.test.ts`。ui-mac 内运行 `bun test --max-concurrency 2 src/main/ext-package-ledger-v3.test.ts src/main/ext-receipt-v2.test.ts src/main/ext-set-state-tx.test.ts src/main/ext-package-ledger-uninstall.test.ts src/main/install-from-source.test.ts src/main/package-mcp-activation.test.ts src/main/package-effect.engine.test.ts src/main/hub-view.test.ts`；`bun test --max-concurrency 2 src/main/codepuppy-config-injection.test.ts src/main/engine-explicit-config.test.ts src/main/package-builders-wiring.test.ts src/renderer/extensions/hub-three-pages.test.ts`。改动 MCP builder 导出时补现有 mock 消费者 `package-mixed-bundle.wiring.test.ts` / `package-secret-recovery-wiring.test.ts`；直接类型/消息消费者按实际 delta 同步并跑对应测试。两包各 `bun typecheck`；这些命令限制并发 2，不另跑全仓套件/gate/bin/check。

### 偏离记录

2026-11-16 r2 · E2 实现：candidate 安装先用既有 projectScopeIdentity 取得规范路径/hash 并写图 effect；原有图类型/严格解码/摘要由 A2 提供，本轮只补其合同证据。唯一写方 ext-receipt-v2 以真实 records/graph/claims 派生 v2，按完整 (kind,name,projectPath) 收窄后写账本、再发布完整下一版，保留 standalone 所有权的全项目成员；读写都不兼容 v1，也不迁移记录。最终发布失败留更窄投影、原有 warnings 携带 projectionLag，启动重算恢复。gen-skill-paths 复用 E1 解码，注入 keys 与 scoped(skill) 并集；不注入 scoped MCP。

Hub 重叠生产文件仅 ext-install-planner.ts 的 computeEnableProjectionEdit：全局文件中的项目 MCP 恒停用（远程真源定义保持原位，仅写 enabled:false 覆盖），包根开关和启动对账共用同一判断。没有修改 hub 正在改的云/命令逻辑、package-admission、codepuppy-config-injection.ts、凭据写入口或 renderer；没有修改 builders、package-mcp-activation.ts、bridge/policy/plugin.ts、源语义或 Core。catalog 的 effect 适配、对话 scope 运输及真正 Location 启用/撤回仍属后续接缝，本轮只证明 candidate 入口与持久写读，不冒充端到端项目隔离。

初始 E2 文件表之外的必要机械同步：`src/main/ext-boot-reconcile.test.ts`、`config-injection-throat.test.ts`、`composer-tier-matrix.engine.cases.ts`、`codepuppy-config-injection-engine.cases.ts` 及 `test-component/package-mixed-bundle.wiring.cases.ts`；原因均为其直接写入或逐字断言旧 v1 允许集，只有 v→2 与 scoped:[] 同步，原行为断言保留。表内 config-injection、watcher、set-state、gen-paths 的同类夹具也一并同步。gen-paths 的非法键正例改为形状合法的 v2 字符串数组，仍断言非法字符串不注入、有效键保留；非字符串结构由已接受的 E1 解码负例与读侧坏形状对照拒绝。提交的 E2 行为红例不改断言；读取面纠错已独立提交。新增 standalone 所有权对照仅证明该现有能力不因范围投影而丢失。

实施验证（各自包目录，测试均 --max-concurrency 2；没有全 gate/bin/check）：

- ui-mac `bun test --max-concurrency 2 src/main/install-from-source.test.ts src/main/ext-receipt-v2.test.ts src/main/ext-package-ledger-v3.test.ts src/main/ext-set-state-tx.test.ts src/main/ext-boot-reconcile.test.ts` exit 0（169 pass、759 assertions）；随后只跑新增 `--test-name-pattern 'E2 a standalone' src/main/ext-receipt-v2.test.ts` exit 0（1 pass、3 assertions）。新 E2 顺序用例实际观察原子 rename；先收窄、账本失败仍窄、final publish 失败及启动重算均过。
- ui-mac `bun test --max-concurrency 2 src/main/codepuppy-config-injection.test.ts src/main/config-injection-throat.test.ts src/main/ext-boot-safety.test.ts src/main/ext-session-grants.test.ts src/main/claude-plugin-install.test.ts src/main/package-admission.test.ts src/main/package-builders-wiring.test.ts src/main/ext-package-ledger-uninstall.test.ts src/main/package-mcp-activation.test.ts src/main/package-mixed-bundle.wiring.test.ts` exit 0（164 pass、1,823 assertions；mixed 宿主包含全部 7 个子用例）。
- ui-mac `bun test --max-concurrency 2 src/main/engine-explicit-config.test.ts src/main/config-injection-throat.test.ts` exit 0（22 pass、822 assertions），日志 `/tmp/helper-e2-r2-config-checks.log`；throat 随 watcher 命令重复运行了一次，不作为额外覆盖计数。
- ui-mac `bun test --max-concurrency 2 --timeout 90000 --test-name-pattern '已安装技能翻代|没有监听重写显式文件' ./src/main/codepuppy-config-injection-engine.cases.ts` exit 0（2 pass、44 assertions）；同命令 `--test-name-pattern '技能翻代' ./src/main/composer-tier-matrix.engine.cases.ts` exit 0（1 pass、2 assertions），日志 `/tmp/helper-e2-r2-composer.log`。仅跑受 v2 夹具影响的真实引擎用例，不改宿主条数要求，不跑无关会话矩阵。
- ui-mac 的直接读侧 DOM 宿主 `bun test --max-concurrency 2 src/renderer/extensions/local-package-renderer.test.ts` exit 0（1 pass、3 assertions；日志 `/tmp/helper-e2-r2-local-renderer.log`），未修改该页面或宿主。
- ext `bun test --max-concurrency 2 src/gen-skill-paths.test.ts src/package-scope.test.ts` exit 0（40 pass、107 assertions）。两包各 `GOMAXPROCS=2 bun typecheck` exit 0（沿 r1 已确认的 tsgo 参数适配）。文档链接和 `git diff --check` exit 0。

本轮从 16:47 CST 开始，约 39 分钟；实际 4 个生产文件，附上述直接消费者测试/证据，没有扩大产品范围或新增配置/接口。已核：Codex（GPT-6），E2 通过；依据 spec v3、design v5、已核计划及 A2 接缝。AC-16 尚未满足，真实 watcher 去抖窗口中的 Location 隔离、尾巴/evaluate、对话/目录接线和管理展示仍待 E3–E5；其余授权外步骤不做。遗留去向：所列接缝及 hub 同文件集成→编排器/后续切片；OPTIONAL：无。

2026-11-16 r2 · E2 红例：续派仅授权 E2，重栈基线 `1a218e8a2e`，设计 v5 @8bd3075。先跑原入口/图/账本/状态四文件 130 pass（607 assertions）及 ext scope/gen-paths 38 pass（105 assertions），再新增范围、v2 顺序/失败及读取红例；未改生产代码。ui-mac `bun test --max-concurrency 2 --test-name-pattern E2 src/main/install-from-source.test.ts src/main/ext-receipt-v2.test.ts src/main/ext-package-ledger-v3.test.ts` exit 1（1 pass、9 fail、34 assertions），证明 A2 effect 图合同已有，而项目请求未落 effect、MCP 未恒停用、writer 未发布 scoped。ext 同参数 `src/gen-skill-paths.test.ts` exit 1（0 pass、2 fail），证明尚不读 v2 且仍读 v1。日志 `/tmp/helper-e2-r2-ui-red.log` / `helper-e2-r2-ext-red.log`，SHA-256 分别为 `567e76e941e39a389ec478505e5d469a9576e36b020212bb038fee9a60ee3b70` / `1f526e5f71524f05d04763370a538a62dcc431581996d0463ee819dfe41bfac1`。同步原子 rename 的窄观察/故障注入仍执行真实 fs，仅用来证明既有 final-publish seam 看不到的账本前收窄时序；无新产品或测试 API。红例准备期修正了自有 seed 的 origin/digest 组合，保留行为断言；提交的红例均因 E2 行为缺失而红。与 hub 重叠的生产修改仅预期 `ext-install-planner.ts` 的项目 MCP 开关投影条件；其余尚未接线。AC-16 未验收。

2026-11-16 r2 · 按 standing ruling 单独纠正红例的读取面：`ext-config.ts:530–536` 的 readMcpLeafStrict 优先返回远程真源定义，`install-from-source.ts:411–416` 会将远程定义发布到真源并清掉配置副本；真源没有 enabled 状态，原 `install-from-source.test.ts:75/122` 用它判断全局配置停用是 API 读取面误用。改读真实 codepuppy.jsonc 的 MCP 叶，enabled:false 行为断言保持；未改 provider 字节或放宽结果。两例仍 exit 1（2 fail、6 assertions，配置里缺停用叶），说明行为红例仍有效；生产修正会在全局配置写项目 MCP 的停用覆盖，不扩展远程真源合同。

2026-11-16 r2 · 补启动路径红例：`ext-install-planner.ts:3572` 的启动对账同样调用 `computeEnableProjectionEdit`，仅修改包根调用点会在重建后剥离项目 MCP 的 enabled:false；因此最小修改落在同文件的公共私有投影函数（包根开关/启动共用），不改 hub 的云/命令动作。ui-mac `bun test --max-concurrency 2 --test-name-pattern 'E2 startup' src/main/install-from-source.test.ts` exit 1（1 fail、3 assertions），真实 context7 叶未保持停用。先提交此红例，断言在实现提交中不改。

2026-11-16 r1 · E1：仅新增 `packages/ext/src/package-scope.ts` / `.test.ts`，实现 v2 结构解码、正向技能成员判断及技能/MCP 共用的项目精确匹配；未接 main、gen-skill-paths、plugin 或 renderer。测试状态是本应用自己的冻结投影，不冒充第三方语料。ext `bun test --max-concurrency 2 src/package-scope.test.ts` exit 0（27 pass、0 fail、86 assertions），`GOMAXPROCS=2 bun typecheck` exit 0。首跑有一项测试框架超时：Bun 将 test.each 的裸 undefined 行解释为 done 回调；行包装为对象后保留所有断言并通过，未修改生产判定迎合测试。

可失败实证：将两份新文件复制到 `/tmp/helper-scope-mutant-5xb0enp5/`，只在临时副本将正向成员改回“排除不匹配 scoped 项”的错误规则，同一测试命令 exit 1（21 pass、6 fail）；合法空投影中的移除、keys 撤回及无关条目对照均失败。日志 `result.log` SHA-256 `15321927f65fa48a8e6fb525f5f2bb15900beeb95e1b97e4b54b738ac118137e`。工作树生产文件未为此改动。真实 watcher 去抖窗口、尾巴/evaluate 及双 Location 隔离仍待 E2/E3/E5，纯函数通过不等于 AC-16 验收。

本轮已核：Codex（GPT-6），D1/D2/E1 的范围、真实出厂资源发现及纯函数证据通过；spec v3/design v4 与已定裁决不变。AC-04/08/09/16 均尚未满足。遗留去向：Issue 版本引用已按续派回执同步；H/A/B/C 接缝合入与构建应用真实模型/任务验收→各片及编排器。除上列 tsgo 参数适配及 census 机械同步外无偏离；OPTIONAL：无。

本轮 D/E PLAN 开始于 2026-11-16 14:48:39 CST，约 13 分钟（预算 45 分钟）；只改本文件的这两节。`python3 scripts/check-doc-links.py docs/specs/plugin-helper-and-hub/plan.md` exit 0（2 条相对链接可达），`git diff --check` exit 0；原有计划 33,609 bytes 逐字节保持，提交前另核暂存范围。未执行仓库测试、typecheck、全 gate 或功能验收。

2026-11-16 r3 / E3 红例 · 17:44:53 CST 开始。重栈后先复跑 E2：ui-mac 170 pass / 762 assertions、另组 166 pass / 1838 assertions，ext 40 pass / 107 assertions；技能翻代引擎 2 pass / 44 assertions 与 composer 1 pass / 2 assertions，两包 `GOMAXPROCS=2 bun typecheck` 均 exit 0。不存在 `package-mcp-activation.test.ts` 的旧命令过滤项未计作已运行，此轮补真实测试文件。新增宿主的正向技能撤销与 MCP Location 成员两例 exit 1（2 fail / 4 assertions，`/tmp/helper-de-r3-scope-red.log`）；真实路径身份复核例 exit 1（1 fail / 1 assertion，`/tmp/helper-de-r3-runtime-red.log`）。技能用 pinned frontend-design 原文件并经生产 ConfigSkillPlugin 解析；已确认初始技能可用后才测撤销，不用正文断言。

2026-11-16 r3 / E3 宿主红例形状校正 · 本轮已提交的 `packages/ext/src/plugin-host.test.ts:1299` 把本应用的 `Mcp.ServerConfig` 写成 `enabled`；真实 `packages/plugin/src/promise/mcp.ts:7` 绑定的 schema 使用 `disabled`（现有 `engine-transforms.ts` 负责从配置 `enabled:false` 翻译）。改为 `disabled:true/false`，仍断言匹配项目开启、非匹配项目关闭、无关项不变；不改行为断言，按 standing ruling 单独提交。

2026-11-16 r3 / E3 追加红例与引擎证明 · main 项目软链在 capture 后换向的红例 exit 1（`/tmp/helper-de-r3-main-red.log`）；H 真 DOM 的两种范围红例 exit 1（`/tmp/helper-de-r3-scope-dom-red.log`）；hub-view 在范围外仍声称可用的红例 exit 1（`/tmp/helper-de-r3-hub-red.log`）；签名目录 effect、远程真源发布保留停用、sidecar 全局停用注入各一条红例均 exit 1（`catalog-red`、`remote-red`、`injection-red` 同前缀日志）。新 `package-effect.engine.cases.ts` 用实际入口/固定 frontend-design 与 Playwright 输入，覆盖 keys/scoped 关包、全局→项目收窄、实时 add/connect/disconnect/remove、重建和后加载 Location；旧显式 bytes + 实际 watcher 的 refresh 回调计数共同定位 100 ms 窗口，并等待回调确实发生，防止无监听时空过。临时将生产正向谓词换成 exclusion，实际子进程 exit 1（2 fail：global/project 关包，1 pass：收窄；`/tmp/helper-de-r3-exclusion-mutant.log`），已逐字恢复生产文件。新增 own-format scope/宿主状态不是第三方格式夹具。

E3 接缝待处置（AC-16 尚未完成）：`src/main/ext-ipc.ts:1164` 将 legacy `catalog.entries` 与包目录一并发给新入口，`:1197` 的 legacy 分支只调用旧 `installCatalog(intent, planner)`；`ext-install-planner.ts:214` 的严格 `CatalogInstallIntent` 只有物理 `InstallScope`，`:1179` 的 project 分支沿项目配置写入，且此分支没有可挂逻辑 effect 的包图。签名 package admission 可消费新 effect，本轮补齐；legacy 需要 A2/编排器给出沿唯一包图准入的逻辑 effect 接缝，不能借旧 project scope 写项目、装后再收窄制造暂时全局可用，或在 E 复制一份包图准入器。本轮不增加拒绝/确认/筛除来源来掩盖缺口。D3–D5 未据此报完成。

2026-11-16 r3 / E3 安全完成部分 · 技能尾巴/evaluate 共用 E1 正向规则；MCP 配置 transform 与 main runtime 均要求匹配 v2 scoped，真实 root 身份未知不匹配，撤销覆盖所有已加载 Location；恢复走 add/connect，工具注册表异步更新用实际工具出现作屏障。签名目录入图前携带 effect；真实远程发布与 sidecar 注入保留全局停用；安全 installedPackages 投影及 H 管理 DOM 显示精确范围。没有项目写入、范围编辑控件、Core 改动或来源筛除。

文件偏离（必要同链路）：增加原表未列的 `src/main/package-admission.ts` / `.test.ts`（签名目录的 effect 与凭据更新），`ext-config.ts`（发布远程真源时原子保留范围停用，避免删掉 override），`ext-disabled-injection.ts` / `.test.ts`（sidecar 不能把项目 MCP 注成全局开启），`package-admission.wiring.test.ts`（子用例实际 24 项；原 pin 21 已落后基线 22，新加 2 项，按变更事实同步）。`src/preload/types.ts` 是表内预告的机械直接消费者；E4 展示并入本次 E3，来自 r3 明示授权。并行共享文件实际为 `ext-ipc.ts`、`install-from-source.ts`、`package-mcp-activation.ts`、`extension-detail.tsx`、中英 i18n 和本计划；另修改 H 已完成的 admission/config 注入消费点，没有改 H 页面结构或 B/C 搜索/时间线区域。

相关检查（ui-mac/ext 均在包目录，test `--max-concurrency 2`）：`install-from-source.test.ts package-admission.test.ts package-mcp-activation.test.ts ext-disabled-injection.test.ts hub-view.test.ts package-builders-wiring.test.ts` exit 0，71 pass / 434 assertions；ext `plugin-host.test.ts package-scope.test.ts gen-skill-paths.test.ts` exit 0，84 pass / 313 assertions；ui-mac 的 `ext-config.test.ts ext-mcp-policy.test.ts engine-plugin-seal.test.ts mcp-server-truth.test.ts ext-write-channels.test.ts ext-uncurated-bodies.test.ts` exit 0，179 pass / 768 assertions。`test-component/hub-three-pages.cases.ts` exit 0，28 pass / 967 assertions。`package-effect.engine.test.ts` 宿主 exit 0（1 pass / 2 assertions），校验实际引擎子进程 4 pass / 0 fail；3 条技能窗口例和 1 条 Playwright 隔离/撤销/恢复/重建/后加载例，实际 skill/browser_close 调用，项目快照不变。`package-admission.wiring.test.ts` 同步后 exit 0。两包 `GOMAXPROCS=2 bun typecheck` exit 0；不跑 gate/bin/check。详见 `/tmp/helper-de-r3-final-main.log`、`final-ext.log`、`config-related.log`、`dom-all.log`、`effect-wrapper-final.log`、`admission-wiring-green.log`（同 helper-de-r3 前缀）。

遗留去向（不改无关行为断言）：`packages/ext/src/context-injection.test.ts:304` — 空 MCP editor 仍期待生成云定义；`f876922949:packages/ext/src/plugin.ts:335` 已只补已有云项，非本片改动；6 文件相关命令 exit 1（145 pass / 1 fail，`/tmp/helper-de-r3-ext-callers.log`），交 H/编排器修正其测试前提。`src/main/codepuppy-sidecar-wiring.test.ts:131` — 调已删除的 `requests.record` 并用旧 confirming 阶段；A3 新 `createHubRequestStages` 仅 submit/get，11 文件相关命令 exit 1（202 pass / 2 fail，`/tmp/helper-de-r3-receipt-wiring.log`）；其中本片直接相关的 admission 数量 pin 已机械同步，余此项交 A3/编排器，不重跑无变化红例。ARCH: `src/shared/package-admission.ts:10` 与 `src/shared/plugin-install.ts:10` 已分别定义 PackageSourceV1；本片不新增副本，交编排器/intent item。AC-04/08/09/16 均不报已验收，D3–D5 未实施；AC-16 仍需上述 legacy 目录接缝及应用验收。

E3 收据补充：最终 `bun test --max-concurrency 2 src/main/install-from-source.engine.test.ts` exit 0（实际 A2 两个引擎子例，由宿主核 2 pass / 0 fail）；日志 `/tmp/helper-de-r3-a2-engine-final.log`。`python3 scripts/check-doc-links.py docs/specs/plugin-helper-and-hub/plan.md` 与 `git diff --check` exit 0。r3 本段 17:44:53→18:40 CST，约 55 分钟；相对 f876922949 为 27 文件、566 增/35 删（含测试/计划），15 个生产文件，比原 E 表多出的同链路文件已逐项说明；未扩到 legacy 新准入/迁移，也未开始 D3–D5。已核为 Codex（GPT-6）自查；本次状态 PARTIAL，legacy 逻辑 effect 接缝交编排器/A2，余 D 步骤须续派；没有推送、PR 或 merge。

2026-11-16 r4 · 18:42:34 CST 开始。E3 已提交部分获接收；续派明确：目录分支的逻辑 effect 是冻结 §4.4 的实施，不是新合同，直接 `installCatalog` 调用方保留物理 scope 行为，helper/hub 入口统一全局落盘并在同次包图准入记录 effect。故先关闭此缺口，后做 D3→D4→D5。新增真实随包 Playwright 目录项捕获与来源/字节摘要（`test-fixtures/plugin-helper/catalog-scope/`）；`ext-install-planner.test.ts` 的 native MCP 原子 graph/effect、skill graph 两条红例，`bun test --max-concurrency 2 --test-name-pattern 'helper catalog' src/main/ext-install-planner.test.ts` exit 1（2 fail / 6 assertions，`/tmp/helper-de-r4-catalog-red.log`）。记录组件与图必须同次落盘；不通过装后补图或旧物理 project scope 实现。

2026-11-16 r4 / 目录范围接缝关闭 · native catalog 与签名包两臂都通过实际 `installCatalogFromSource` 进入全局安装；入口专属准入参数携带既有 `PackageEffectV1`，由实际 root item 的冻结 `PackageMutationEnvelopeV1` 随组件同一次 `commitTransactionLedger` 落账。未改变外部 direct `installCatalog` 的物理 project 行为；新入口不使用物理 project scope。native 绑定取已验目录原始条目集的 canonical digest，整包启停重验同一条目集；不在签名包失配时降格为 legacy 校验。真实输入从 bundled↔cache 切换仍以同一内容绑定验证。更新使用已有 diff/claim/removal 判定，departing 清配置随同一事务，实际已去账的组件再由原清理接缝移除。

必要同链路文件：`ext-skill-generations.ts`、`ext-agent-install.ts` 原有载体只落组件，现可接同一 frozen mutation carrier，并用唯一提交方；其他 direct 调用仍走原逻辑。不是新增 schema、迁移或另一套账本写方。`install-from-source.ts` 拥有可被真实引擎调用的目录臂，`ext-ipc.ts` 仅组合现有依赖，避免用手写测试 adapter 复刻范围逻辑。并行共享文件本步为 `install-from-source.ts`、`ext-ipc.ts`，其余共享区域未改。

检查：ui-mac `bun test --max-concurrency 2 src/main/ext-install-planner.test.ts src/main/ext-skill-generations.test.ts src/main/ext-set-state-tx.test.ts src/main/install-from-source.test.ts src/main/agent-md-entry.test.ts src/main/package-builders-wiring.test.ts src/main/package-admission.test.ts` exit 0（245 pass / 1348 assertions，`/tmp/helper-de-r4-catalog-related.log`）；覆盖 native MCP/skill/agent/cloud/bundle 同图准入、MCP 恒停用、原有直接调用，以及目录事实变更不放行、同内容从随包通道重验。`bun test --max-concurrency 2 src/main/package-effect.engine.test.ts` exit 0（实际 5 个引擎子例全部通过，宿主 1 pass / 2 assertions，`/tmp/helper-de-r4-effect-wrapper.log`）。新增原生目录 Playwright@0.0.77 臂实际调用 browser_close，甲有工具、乙无工具，整包关开仍隔离，两项目已有 JSONC 与文件树字节不变；单独命令 `--test-name-pattern 'catalog item' ./src/main/package-effect.engine.cases.ts` exit 0（1 pass / 10 assertions，`/tmp/helper-de-r4-catalog-engine.log`）。两包 `GOMAXPROCS=2 bun typecheck` exit 0；未跑 gate/bin/check。此接缝不再阻塞，后续进入 D3；真实应用/模型 AC 仍不由这些检查代替。

2026-11-16 r4 / D3 红例 · 目录接缝已关闭，开始 D3。新增 `created-plugin.test.ts`（本应用自制输入，不伪装第三方样本）；实际入口的成功制作、未知/缺失/失败来源记录无写入、坏草稿及 project-only 制作三例：`bun test --max-concurrency 2 --test-name-pattern '^D3' src/main/install-from-source.test.ts` exit 1（3 fail / 5 assertions，`/tmp/helper-de-r4-create-red.log`）。来源记录读取/完整性一例 exit 1（`/tmp/helper-de-r4-search-record-red.log`）；新 create 工具的冻结 payload、无自问同意、自动化先拒及真权限宿主共三例 exit 1（`/tmp/helper-de-r4-create-tools-red.log`）。成功查询取既有真实 pinned frontend-design 查询响应，保留无关候选，不能用“候选必须为空”替代语义判断。

D3 红例设置校正：`plugin-sources.test.ts:403` 新例缺少 createPluginSources 绑定，原红例在 lookup 前是 ReferenceError；补同模块已有导出的 import，不改任何完成性/失败性断言，单独提交。实际入口三条已提交红例不受此设置错误影响。

D3 真权限例的宿主前提校正：`plugin-host.test.ts:1313` 未装 main 注入的 tier-carrier agents，就调用 codepuppy-ask；该 fixture 的实际注入在同文件 hubHost（约 :555–565）。补用既有 hubHost(manifest:false) 构造真实应用前提，不改 allow=0 ask、ask=1 普通审批、automation=0 ask 且 deny 的任何断言；修正后该例通过。不是在 ext 中另写一套档位规则。

2026-11-16 r4 / D3 完成（自动化部分）· 同一 createPluginSources 实例保留实际查询状态；完整性函数消费 PLUGIN_SOURCE_ORDER，缺任一适用来源或任一失败即 not-searched。保留返回结果的副本，渲染结果数组的改动不改变 main 记录；无 TTL/条数上限、候选空集要求或第二次同意。草稿只在内存组装 own manifest/capture，路径、重复与提供方规则交 A1 converter；坏草稿在 CAS/账本前 invalid-draft。入口复用原 builder/事务/自动开启/生效，source 与 origin 为 created、ID 为 mine namespace；不同名字的用户插件保持独立图。created 的 this-project 同样只写全局并挂 effect。

create 工具与 install 共用同一 bridge、阶段轮询、结果与 requestId/packageId metadata，使用冻结 files 参数。新增的 `policy/index.ts` 修改是必要同链路：同一个 automation guard 覆盖两种写工具；普通 allow/ask 判定未加特例。`context-injection-inventory.snapshot.txt` 由 `bun scripts/context-injection-inventory.ts --write` 机械重生，未改预算。未改 renderer 搜索/结果或 B/C 的凭据/时间线动作。

具名检查：ui-mac `bun test --max-concurrency 2 src/main/created-plugin.test.ts src/main/install-from-source.test.ts src/main/plugin-sources.test.ts src/main/codepuppy-sidecar-messages.test.ts src/main/created-plugin.engine.test.ts` exit 0（63 pass / 327 assertions，`/tmp/helper-de-r4-create-final-main.log`）；ext `bun test --max-concurrency 2 src/hub-tools.test.ts src/plugin-host.test.ts src/hub-bridge.test.ts` exit 0（60 pass / 278 assertions，`/tmp/helper-de-r4-create-ext-related.log`）。真实引擎子例先从 factory 注册/原资源目录发现并加载 plugin-helper，确认零 helper 账本；创建后通过生产 watcher 热发现，实际 skill→shell→Node 运行自制 summarize.mjs，得到柚子=7|苹果=3，随后整包移除且记录、图、generation 全消失，项目文件树不变（`created-plugin.engine.cases.ts` exit 0，1 pass / 14 assertions，`/tmp/helper-de-r4-created-engine.log`）。侧车真实 parser 保留 131072 字节的 own 文本，不设内容帽，坏形状被丢弃。两包 `GOMAXPROCS=2 bun typecheck` exit 0。

额外相关组 `context-injection.test.ts policy/unattended-policy.test.ts` exit 1（62 pass / 1 fail / 663 assertions）；只余已知 `context-injection.test.ts:304` 空云 editor 前提，编排器已说明在 H@4d9e40f187 修复、待重栈，不在本片改。A3 的 `codepuppy-sidecar-wiring.test.ts:131` 遗留仍交 A3：断言调用已删除的 requests.record 并要求 confirming 阶段；这是 A3 移除确认运输/阶段、更换 request-stage API 的直接消费者，不属于 D/E 的新行为。上述都不冒称全绿。AC-04/08/09 真实模型的顺序/语义判断/无二次同意仍由 D5 交验，未验收。

2026-11-16 r4 / D4 红例 · 复用既有 H 的真实 DOM 宿主，避免另复制一套 plugin-helper 测试环境：新增出厂行文案/零安装控件与 created 来源→整包移除两例；后者已通过，前者在原始 ID 文案失败。`bun test --max-concurrency 2 --test-name-pattern '^D4' ./test-component/hub-three-pages.cases.ts ./src/renderer/codepuppy-ui/session-timeline/timeline-model.test.ts` exit 1（1 pass / 1 fail，timeline 名称含 describe 前缀而被过滤，未计为运行）。单独 `--test-name-pattern D4 ./src/renderer/codepuppy-ui/session-timeline/timeline-model.test.ts` exit 1，可信 create 尚未成为既有安装卡。新增例保留来源信任负例、持久 requestId/packageId、重挂及不泄漏草稿正文的断言；只扩已有投影，不复制卡片或 H 页面。日志 `/tmp/helper-de-r4-d4-red.log`、`/tmp/helper-de-r4-d4-timeline-red.log`。

2026-11-16 r4 / D4 完成 · FactorySkillRow 只为无目录条目的 plugin-helper 回退出厂中英文名称/用途，不新增开关、安装记录或页面。create 可信身份复用 A4 的 install 卡操作，名称取草稿 name，仍按 main requestId/packageId 重挂、管理；不把 files 带入卡片，不改 B/C 登录/令牌动作。H 已有 created 来源呈现/整包移除无需重写，新增真 DOM 例验证来源不取 ID 前缀，也不标官方。

计划偏离：原定新增 plugin-helper.test.ts / plugin-helper.cases.ts 改为复用现有 hub-three-pages 真生产 DOM 宿主，避免重复环境；另补 A4 同链路 timeline-model.ts / cards/tool-card-model.ts 及其直接测试。宿主旧 pin 26 已落后 E3 新增的 2 项，本步再添 2 项，实跑 30 项后同步到 30，未删行为断言。wrapper 子进程补 --max-concurrency 2。共享文件：extension-hub.tsx 的 FactorySkillRow、中英 i18n、A4 timeline-model.ts / cards/tool-card-model.ts 与测试；不改现有卡片 UI。

ui-mac `bun test --max-concurrency 2 src/renderer/extensions/hub-three-pages.test.ts src/renderer/codepuppy-ui/session-timeline/timeline-model.test.ts src/renderer/codepuppy-ui/session-timeline/cards/tool-card-model.test.ts src/renderer/codepuppy-ui/session-timeline/hub-install-card.test.ts` exit 0（132 pass / 565 assertions；H 子进程 30 项、既有卡片子进程 7 项，`/tmp/helper-de-r4-d4-related.log`）。`GOMAXPROCS=2 bun typecheck` exit 0（`/tmp/helper-de-r4-d4-ui-type.log`）。D5 继续交验，不以 DOM 代替真实模型提问/语义行为。

2026-11-16 r4 / D5 交付 · 四份构建应用真实模型重放脚本作为本计划的 `assets/` 文本附件（不是已执行证据，也不另建验收状态台账）：

- [歧义 PS](assets/acceptance-ps-ambiguous.txt)：唯一能力问题、按回答联网查询、查询完成前零自建、真实来源与无第二次同意。
- [明确 PSD](assets/acceptance-psd-explicit.txt)：真实 PSD 样本/摘要与独立读取结果，零重复澄清及实际读取对照。真实 PSD 样本由编排器从实际样本库选择并固定来源，不编造文件格式或把自动重放夹具当联网证据。
- [全来源无匹配后制作](assets/acceptance-create-own-plugin.txt)：本应用自有 harvest-net-v1 任务、真实完整查询、语义无匹配、约定原句、创建/自动开启/实际任务、我的插件、跨项目同包及整包移除。若实有匹配或来源失败，明确该分支未覆盖，不删候选来强造无匹配。
- [已有匹配、来源失败、双项目范围](assets/acceptance-existing-and-source-failure.txt)：真实现成插件/独立 MCP 优先、隔离进程真实网络失败的禁止自制对照，默认全项目及显式项目范围的目录/外部来源臂；甲乙工具名单/调用与原始配置字节对照。精确去抖窗口继续引用已验真实引擎和 exclusion 变异，不加产品范围编辑控件。

四份已读回全文并检查具体 prompt、事件顺序、可失败判据与交回证据；未做仅断言文案/标题数量的伪测试，未启动收费模型/真实应用会话。B/C 集成后的真实模型/真实联网结果由编排器按这些文件收集。故 D3–D5 自动化实现及交接完成，AC-04/08/09/16 均未报已验收。

D5 相关回归 ui-mac `bun test --max-concurrency 2 src/main/created-plugin.engine.test.ts src/main/package-effect.engine.test.ts src/main/factory-skills.test.ts src/main/codepuppy-skill-packaging-census.test.ts` exit 0（41 pass / 220 assertions，`/tmp/helper-de-r4-d5-engines-factory.log`）：创建引擎子例 1 项、范围引擎子例 5 项，含目录 Playwright arm，资源实际可达/零账本证据仍通过。类型检查复用 D3 ext 与 D4 ui-mac 的最终 exit 0，本步只增加脚本/记录，无重复全套。没有 gate/bin/check。

文档偏离：新脚本归本计划可选 assets，避免在 verification 目录制造尚未执行的“证据”；`docs/README.md` 由 canonical docs_index.py 机械同步两条缺失的本功能/H 计划索引，不手改块或清理其他文档。第一次尝试不存在的 ~/.local/bin/docs_index.py exit 2；沿 check-docs-contract 的真实 symlink 找到 skill 脚本后执行，未安装或变更工具。

额外相关检查 ui-mac `bun test --max-concurrency 2 src/renderer/i18n/locale-regression.test.ts` exit 1（8 pass / 2 fail / 35 assertions，`/tmp/helper-de-r4-d4-i18n.log`）。遗留去向：该测试 :162/189 的旧品牌白名单未消费真实 OpenCode 市场来源，命中 packageSourceOpenCode（en/zh）及 ext-package-presentation(.test).ts；`git show 27a5997580:<file>` 已确认在本轮之前存在，D4 只增加 Plugin helper/MCP 文案，不改白名单；交来源车道/编排器同步规则判据，不在本片修。其余遗留沿 D3 收据：context-injection.test.ts:304 待 H 已完成修复重栈，sidecar-wiring.test.ts:131 交 A3。OPTIONAL：无。

D5 文档检查收据：`python3 scripts/check-doc-links.py docs/specs/plugin-helper-and-hub/plan.md docs/README.md` exit 0（424 条相对链接）；canonical `docs_index.py --check` exit 0。依 alpha profile 复用 canonical `check_docs_contract.py:check_repo`，只检查当前工作树（changed-since bda9ea62d7，不扫描其他仓）exit 1：72 errors / 217 warnings，日志 `/tmp/helper-de-r4-doc-contract.log`。错误为现有根 README 项目引用、旧断链/角色目录/额外 plan 文件，以及本计划原有跨仓裸 SPEC/DESIGN ID；新增 assets 未命中错误。`git show bda9ea62d7:docs/specs/plugin-helper-and-hub/plan.md` 已确认 :7/8 和旧链接文字存在，不为本片改其他节/全仓修文档；遗留交编排器的文档治理队列。生成索引已当前，不能把合同总体检查报绿。

r4 本轮约 77 分钟（18:42:34→19:59 CST）；范围接缝→D3→D4→D5 依序提交。实际增加目录准入同链路与 A4 投影文件的原因已在各步逐项记录，无迁移、无新依赖、无项目写入、无 Core 改动。已核：Codex（GPT-6）自查，spec v3/design v5 与 r4 授权范围；本轮实现/交接 DONE，AC-04/08/09/16 完整真实应用验收仍交编排器，未报通过。并行共享生产文件汇总：plugin-sources.ts、install-from-source.ts、ext-ipc.ts、ext/hub-tools.ts、extension-hub.tsx（只 FactorySkillRow），另 i18n 和 A4 timeline-model.ts / cards/tool-card-model.ts；本轮未改 package-mcp-activation.ts、extension-detail.tsx、B/C 搜索/凭据/时间线动作。

## 切片 B/C · 其余入口与时间线授权

- 依据：[Issue #1724](https://github.com/impharaon/alpha-code/issues/1724)；[SPEC-plugin-helper-and-hub v3 @8663fb2](https://github.com/impharaon/alpha-work/blob/8663fb2a982eaf7c626bfee3bcd8b20b870f2577/docs/specs/plugin-helper-and-hub/spec.md) AC-02、03、05、11、15 及 AC-06/07/14 的时间线部分；[DESIGN-plugin-helper-and-hub v5 @8bd3075](https://github.com/impharaon/alpha-work/blob/8bd3075040befdcfcb62e616b7004ec2edd0d744/docs/specs/plugin-helper-and-hub/design.md) §4.1–4.4、§4.6–4.9、§5、§8 B/C、§10。继承其冻结处置与上节 A、来源车道的已验实现，不重新设计转换、来源顺序、权限、账本或范围模型。
- 核对：Phase: IMPLEMENT — 8c4bd680bc · orchestrator/Claude Fable 5.2 · plan check passed (AC-02/03/05/11/15 and the timeline parts of AC-06/07/14 each have failing-capable proof; the old skill-by-skill hub import path is retired in the same step that replaces it; overlap with the D/E lane is named; no restriction added). r8 授权 BC1→BC2a→BC2b→BC3→BC4→BC5；D/E 与 Core 仍冻结。
- 基线：`feat/helper-install-slice-a@f876922949`；已接 H 最终头 `93c0a4765f` 与 D/E 的 E2，A 经编排器验收。文档影响为本节实施计划；实施时仅同步实际受影响的既有当前说明，不建立另一份规格或状态台账。
- UI：[11-15 批准帧](../../design/2026-11-15-plugin-package-install-and-card/frame.html#search) `#search/#install/#manage` @265c42529e；逐项对照 spec「体验约定」的搜索、来源、动作及账户文案。沿用现有列表行、菜单、时间线动作、Dialog、密码输入与链接，不另画稿。关于单条选择、默认范围及安装动作的处置直接消费本轮 brief 与冻结设计。
- 预计规模：约 20–26 个生产／运输文件（含退役旧调用）、14–20 个新增或直接相关测试文件，约 1,700–2,400 行实质新增／修改，另删除旧逐技能导入／确认运输的死实现；真实样本与生成字节另计，约 4–6 小时。超过一提交单元，按 BC1–BC5 的真实边界顺序实施，每步先提交可失败用例；每段核实际规模／用时，达到原估算两倍返回编排器，不静默扩张。

### 改动

路径未标包名时相对 `packages/ui-mac/`。已有五源查询／捕获／转换与 A 的安装、运行生效保持唯一实现；不是重新开发来源层。BC 的新私有 helper 只承接可达入口，不改 §4 的冻结 DTO、消息联合、错误、宿主发布 schema 或权限 evaluator。

| 段 | 文件／入口 | 改什么 |
| --- | --- | --- |
| BC1 · 搜索接线 | `src/main/ext-ipc.ts`、`ext-write-channels.ts`、`src/preload/index.ts`／`types.ts` | 注册设计 §4.8 的只读 `sourcesSearch` 到 A 的同一 `pluginSources.searchSources` 单例；搜索写入动作仅调用已有 gated `installFromSource`。读取不过写闸，安装保持账本屏障／恢复准入；未知或过期候选保留真实失败。 |
| BC1 · 搜索显示 | `src/renderer/extensions/extension-hub.tsx`、`use-extensions.ts`；新增 `plugin-source-results.tsx`、`plugin-source-results.test.ts` | 同一个页头 query 请求真实五源结果，替换“只筛当前页目录”的搜索呈现；用 main 已排序结果与已证实的 sameAs 呈现行、逐源失败／查无结果及单条安装进度。响应落后于当前 query 时不盖掉新结果。新组件供搜索和市场清单共用现有行／动作，不造第二套包管理。 |
| BC1 · 来源呈现 | `src/renderer/extensions/ext-package-presentation.ts`、`src/renderer/i18n/zh.ts`／`en.ts` | 既有来源显示投影供候选与已装包共同消费，`installedPackagePresentation(pack)` 接缝保持；不在列表再写一份来源标签表，不从名称／前缀推 provenance。已装候选从真实 packageId 进入 H 的同一菜单／管理。搜索占位和读屏按 spec 文案。 |
| BC2 · 直接捕获及市场清单 | `src/main/plugin-sources.ts`、`install-from-source.ts`、`ext-ipc.ts`；`src/main/plugin-sources.test.ts`／`install-from-source.test.ts` | 把已有 `captureFolder`、`captureGit` 和 `readMarketplace` 接入 main 候选／捕获／转换缓存；直接 Git 地址在 main 捕获并铸私有 candidateId，安装仍使用冻结 candidate 分支，文件夹接冻结 folder 分支。市场只准备各条目的 ID 和安全展示事实，选择前零账本／运行入口；安装只取所选子来源。第三方文法仍只交 `plugin-conversion.mjs`。 |
| BC2 · 文件夹／Git 页面入口 | `src/renderer/extensions/extension-hub.tsx`、`use-extensions.ts`；preload／主进程的既有导入接线；`src/renderer/extensions/plugin-source-results.tsx` | 复用现有添加菜单、main 目录选择器及 Git 地址输入；Git 地址指向官方市场仓库时列其条目，本机文件夹中的市场清单同样列出；取消仍在既有选择器外层零提交，选择器不跨事务锁。来源目录只留 main，捕获后进同一入口；市场目录的读前准备沿既有只读 intake/preview 边界，返回的是可选择条目而不是装前确认清单，安装 ID 仅由 main 持有的捕获产生。局部运输只返回 main 编号及安全显示事实，Capture、路径、字节和私有凭据都留 main；不向 CandidateV1.source 伪造第六个远端源，也不把本机清单假标为线上市场。 |
| BC2 · 退役旧本机安装链 | `src/main/ext-ipc.ts`、`ext-write-channels.ts`、`src/preload/index.ts`／`types.ts`、`src/renderer/extensions/extension-hub.tsx`／`use-extensions.ts`；`src/main/local-package-preview.ts`、`local-package-install-port.ts`、`claude-plugin-intake.ts`、`claude-plugin-install.ts` 中仅旧入口拥有的运行实现 | 撤下 hub 的逐技能导入分支、`importClaudePluginConfirm` 通道、一次预览再确认安装的控制器及死调用；有活跃非 hub 消费者的纯类型／命名合同不搬动，公共 host schema 不变。原生文件按引用纳管／其他生态导入不在本片，不为它另保留一条 hub 安装旁路；若发现不能分离的同调用链依赖，具名返回，不能改 project-only 行为。 |
| BC2 · 旧调用方证明 | `src/main/claude-plugin-intake.ipc.test.ts`、`claude-plugin-import-matrix.test.ts`、`ext-write-channels.test.ts`；`test-component/local-package-channel.cases.ts`、`local-package-renderer.cases.ts`、`claude-plugin-import-matrix.cases.ts` 及各自宿主 | 将明确钉旧确认／逐技能安装的用例改到 picker/Git→捕获→统一入口→一包图，保留目录边界、秘密、失败零部分写入、卸载／同名碰撞等行为对照。只删随已退役实现失去主体的专测，替代证据在同笔提交；有其他调用的 intake／installer 测试不借此删除。 |
| BC3 · 装后账户真源 | `src/main/package-admission.ts`、`package-declarations.ts`、`ext-ipc.ts`；必要的 `ext-package-tx-builders.ts` 同调用链 | 已装目录和非目录的账户读取／保存均消费 `resolvePackageDeclarationsV1`。当前 ext-ipc 已有非目录只读投影，但 `savePackageSecretsV1` 仍止于 catalog facts；把装后动作接到同一读取接缝，不另存声明。非目录按存储的 MCP leaf／needId 调既有 builder、事务、包图更新和版本化 dedicated store；保持 H 已完成的包拥有权、旧密钥版本清理与并发前置核验。 |
| BC3 · 运行收敛 | `src/main/ext-ipc.ts`、`package-mcp-activation.ts` | 凭据更新后复用 A 的运行 MCP apply／read-back，使原包立即按实态收敛；登录继续调用原引擎 OAuth integration/系统浏览器路径，不新建 main OAuth listener／token store，不切引擎代次。管理／关闭／移除保持 H 的同一 packageId 和资源拥有关系。 |
| BC3 · 账户证明 | 新增 `src/main/plugin-package-accounts.test.ts`；已有 `package-admission.test.ts`、`package-admission.wiring.test.ts`、`package-secret-recovery-wiring.test.ts`、`package-builders-wiring.test.ts`／`package-mixed-bundle.wiring.test.ts`；`test-component/package-secret-recovery-wiring.cases.ts` | 真临时盘验证非目录读取、首次保存、部分需求保存、更换及失败不改旧有效状态；回读 actual encrypted/file-ref 版本及包图，秘密金丝雀扫描正反臂。若 builder 导出改变，直接 mock 消费者同笔同步且执行。 |
| BC4 · 同一账户组件 | `src/renderer/extensions/extension-detail.tsx`；新增 `package-account-dialog.tsx` 与 `package-account-dialog.test.ts`／`test-component/package-account-dialog.cases.ts`；`use-extensions.ts` | 将 H 内联的装后密码 Dialog 提取为管理页与时间线共用组件，复用原输入／用途／链接／保存动作；不复制字段状态和凭据写方。登录直接复用已有 `authenticateMcp` 的当前目录 SDK→adapter→system-browser 路径；必要的窄动作复用从 use-extensions 移到这条同调用链，不再实例化一套 hub 数据层。 |
| BC4 · 时间线动作 | `src/renderer/codepuppy-ui/session-timeline/cards/hub-install-card.tsx`、`cards/timeline-intents.ts`、`session-timeline.tsx`；`src/renderer/i18n/zh.ts`／`en.ts`；现有 `hub-install-card.test.ts`／`test-component/hub-install-card.cases.ts`、`session-timeline-test-runtime.tsx` | 把既有只读待登录／待填令牌状态接到一个有效动作：登录按钮直接发起系统浏览器，不先弹第二个登录确认；令牌按钮打开上述同包组件。绑定 packageId＋组件／需求 ID，由 main 重读声明；关闭／取消后包保留、可续做；成功后回读同包，不重装。metadata 淘汰恢复和 manage 仍用 A／H 接缝。生产 intents 接线也测试，不只测注入了假 handler 的卡片。 |
| BC5 · 真实链与资料 | 新增 `src/main/plugin-entrypoints.engine.cases.ts`／`.test.ts`；扩展 `test-component/hub-three-pages.cases.ts`、`hub-install-card.cases.ts`；`test-fixtures/plugin-helper/` | 真实来源经聊天／搜索／folder/Git 到实际入口和引擎，覆盖独立 Registry、OpenCode、关闭／移除及 JS 零执行；复用隔离 engine harness，宿主严格计内部用例数。补真实查询／包树／版本原字节及 provenance，最终模型与真实账号验收交编排器，不把局部 DOM 或本机模型桩当作真实第三方授权成功。 |

**已核接缝与并行文件**

- A：`createPluginSources` 的五源结果、main ID 表、捕获／转换缓存、运行身份；`createSourceInstaller`、`InstallRequestV1`／`InstallOutcomeV1`；`package-mcp-activation.ts` 的 runtime apply/disconnect；只读 `hubRequest` 及推送。直接复用，缺少入口接线不解释成需要另一套安装器。
- H：`installedPackages`／`packageAuthorization`／`savePackageSecrets`，`installedPackagePresentation(pack)`，`openPackageManagement(packageId)`；`InstalledPackageDetail` 中现有账户 Dialog、`useExtensions.authenticateMcp` 与 `savePackageSecrets`。H 最终基线已在本树，本片只做上表的提取／消费及非目录分支，不重做行、菜单、权限编辑器或账户存储。
- D/E 预期重叠：`src/main/plugin-sources.ts`（D searchId/create 捕获记录）、`install-from-source.ts`（D created、E effect）、`ext-ipc.ts`（D/E 同一入口接线）、`package-mcp-activation.ts`（E Location 过滤）、`src/renderer/extensions/extension-hub.tsx`／`extension-detail.tsx`（E 范围显示）、本 `plan.md`。BC 的改动局限在上表区段，后续续派按编排器重放版本核 delta；不改 D 的助手／create 校验或 E 的范围成员判定。
- `packages/ext/src/{hub-tools,hub-bridge,context-injection}.ts`、`plugin.ts`、`engine-transforms.ts` 当前无需 B/C 新消息或生产改动：现有 ID-only search/install 已能承载 Registry／其他五源；账户动作在 renderer 复用现有通道。D/E 拥有这些文件的 create／scope 变更；若实测发现本片必须改，先具名返回最小接缝，不顺手重写。`packages/core`、host 发布 schema、权限 evaluator、D/E 源文件职责均冻结。

### 顺序

1. **BC1 · 单搜索框到同一入口**：先提交只读 IPC／五源排序与折叠／来源失败／慢响应／“+”真入口的红例；接 main 单例、preload 与生产结果组件及既有菜单。真实 GitHub 正式目录和同能力外源点击两条路径，锁内仍只落目录身份／版本。此步不等文件夹或账户小窗，可与 D/E 分区并行。
2. **BC2a · main 捕获到单条候选**：先加真实 marketplace 清单的两个可安装条目、固定 Git 树、main picker 的连通红例，再接 private 捕获登记及 folder/Git 的统一入口。清单打开／选中之前只读，点击一条只安装那条；列表准备和安装共用捕获缓存。单技能目录仍成为一包，不退回旧单技能写方。**BC2b · 同笔撤旧可达路径**：切换 hub 添加菜单、撤旧确认与逐技能通道，再跑旧路径的直接消费者替代证据；两步各为可审提交，最终不并存两条 hub 安装链。
3. **BC3 · 装后账户到专用存储／现有引擎**：先以真实独立 GitHub Registry 定义提交非目录保存红例，再统一声明读取和 H 的保存函数；沿原事务更新包拥有的密钥版本，接 runtime apply。目录凭据更换／旧版本清理和失败／恢复用例保持，默认全局不触及 E 的范围解释。
4. **BC4 · 时间线一个登录动作与同包令牌窗**：BC3 接缝到齐后，先加生产 DOM／adapter 的“一击系统浏览器”、取消重开、保存金丝雀、返回原包的红例，再提取 H 组件、接生产 timeline intents。提取与两个调用方同一提交，不临时留下两份实现。无安装确认、无聊天令牌字段。
5. **BC5 · 各入口真实引擎闭环**：扩展受影响 engine／hub DOM 用例，再收齐 AC 证据；安装、开启、实际工具或技能调用、关闭撤入口、移除清专有内容分别看真实状态。最后只跑变更／直接相关测试和两包类型检查，编排器在构建应用收自然语言、真实 GitHub token／Supabase OAuth 与屏幕证据。未做真实账号操作的部分保持未验，不发出登录／写外部数据动作。

### 风险

- **旧入口不是整包管线**：`ext-ipc.ts:1519` 仍接旧 intake→预览确认；Git 仍调逐技能 importer。替换范围以上表可达链为界，不能在 UI 另加一个新入口后让旧的继续接用户安装，也不能顺带改原生项目文件纳管。marketplace 的路径解释只在已捕获树和共享 converter，renderer 不提供重放路径。
- **H 账户能力目前只完整覆盖已验目录**：`package-admission.ts:502` 的非目录分支没有 catalog facts 就不能保存，而 `ext-ipc.ts:458` 已有非目录只读声明投影。BC3 统一在既有装后动作权威内补齐，不把只读“待令牌”误当已有可用保存能力；不为非目录另建密钥表或直接改运行 JSON。
- **真实样本的正向前提**：现有 `opencode/npm/opencode-skills-hub@0.0.5` 是 JS-only，适合作零可运行反例，不能拿它证明技能／MCP 正向。BC5 保留 pinned `obra/superpowers` 技能和 `onyxia` MCP 树作既有转换语料；正向入口使用实际 npm `@unfrgivn/opencode-config@3.0.6` 及同版本 Git/folder 树，固定 gitHead `6970d6f3f957358bfb1fc36a260fb7b2e4cb5a78`；实际前提先断言，不虚构 npm 收录。缺少真实正向样本时返回这一项证据缺口，不换成手写包。
- **Figma／官方标签**：当前库已有 Codex Figma 和 Registry 1.0.3 的来源记录，它们不是实时可达或账号可用证明。准确的两句来自 [22ea013 原案例](https://github.com/impharaon/alpha-work/blob/22ea013/docs/specs/local-plugin-install/spec.md)：先「帮我安装figma 插件」，再「帮我安装 figma 官方mcp 服务」。查询记录与 publisher 的事实分别留档；不从旧聊天地址、插件名字或空 app ID 造“官方”。没有定义和来源失败的文字不能混同；不改 D 的助手行为来偷换模型验收。
- **凭据／异步状态**：输入只进共用密码窗，提交后清空临时值；秘密值不进 part、预览、图、日志或配置明文。窗口关闭、授权取消、包同时删除／替换、旧 callback 晚到分别有对照；回读 main 声明／当前图防止改另一个包。OAuth 的 discovery、PKCE、回调与 token 仍由既有引擎 integration 处理，BC 不另加超时、等待、字段要求或连接器版本限制。
- **并行及基线红项**：按下方 r7 收据处理 H 的夹具／宿主计数及已知语言扫描；本片不代修。实现阶段返回的同调用链修正必须列实际文件和理由；D/E 的新 commits 只核接缝 delta，不重新审设计。

### 证明

以下为 IMPLEMENT 的拟执行用例／Acceptance，PLAN 未把未实现的 B/C 行为报通过。每个对照先核真实前提，红例在实现前单独提交；仅将真实记录副本的缺席／故障明确标成控制臂，不造第三方格式。

| AC／行为 | 命名证据 | 去掉什么会使它失败 |
| --- | --- | --- |
| AC-02 · 聊天与“+”目录身份 | `install-from-source.test.ts` 的 `BC catalog identity wins from chat and search selection`；`plugin-source-results` 生产 DOM 经真 main 的正式 GitHub/Supabase catalog fixture | 去掉提交前运行身份比较，外部候选会多一张图；去掉搜索“+”统一入口，目录 packageId／版本或仅一条事务／一行断言失败。与 `sameAs` 缺席的未折叠对照一起测，不能只测默认首行。 |
| AC-02 · 来源优先级 | 继承并扩展 `plugin-sources.test.ts` 的 `recorded source misses preserve catalog Claude Codex OpenCode order`，以真实查询记录机械缺项的逐级对照；源失败单列 | 任一来源被跳过、用完成先后排序或失败假装查无，首个有效候选／逐源状态断言红。助手实际选源由后述模型证据核，不把数组排序冒充模型已正确选择。 |
| AC-11 · 一个搜索框／不误并 | 新 `plugin-source-results.test.ts`／生产 DOM：`BC one query searches all sources, keeps distinct runtime identities and ignores late replies` | 只筛目录、仅按名字折叠、陈旧响应覆盖当前搜索，实际可见行数／来源／请求 query 失败；两个同名不同 URL/header/技能集合的记录保留两行。 |
| AC-11 · 市场只安装选定项 | `plugin-sources.test.ts` + `test-component/local-package-renderer.cases.ts`：`BC marketplace selection commits only the chosen real plugin`；官方 raw 清单和本机同份清单两臂 | 从 pinned 市场选择一个真实插件后，枚举全部其他条目的图、账本组件和 engine inventory 都为空；去掉单条选择约束、退回批量 fan-out 或只改界面都会红。打开清单本身零写，取源／转换失败也不安装其他项。 |
| AC-03 · 两次 Figma 查询 | 新真实查询记录与 `plugin-sources.test.ts`／来源转换：`BC Figma plugin and explicit official MCP retain verified target and source status`；编排器重放两句原请求 | 只搜目录、把 `.app.json` 当已核服务、忽略 registry publisher 或把网络失败当没有，会改变捕获记录、诊断和输出；取得定义的臂核 main 安装 packageId，实际未取得的臂核零安装。模型留工具 part/query/来源/短结果及项目快照，不抛路线或编造成功。 |
| AC-05 · 独立官方 MCP | 新 `plugin-entrypoints.engine`：`BC registry-only GitHub definition becomes one package before authorization`；随后真实 GitHub 授权任务由编排器 | 输入仅现有 pinned `github-registry-version.json`，没有 plugin manifest；检查 source/publisher/version、单图 root MCP、一个管理项、真实需求；去掉 registry→入口映射，包不能落账。授权后读 inventory 并调用一个获授权的真实只读工具；关闭／移除后再次调用失败。项目原配置摘要前后相同。 |
| AC-15 · 三入口同管理模型 | `plugin-entrypoints.engine`：`BC real OpenCode package installs from chat, folder and Git with usable entries`；同版本真实包／来源分别留 provenance | 每条路径核 source/version、同一 graph 模型、至少一个实际技能读取／MCP 工具调用；关闭后入口消失，移除后图、专有 generation／密钥／运行入口消失，项目配置 bytes 不变。退回只导入一个技能、目录路径依赖原件、未热接入或未清理都会红；共享资源按现有 claims 仍在，不用“全目录消失”误杀共享项。 |
| AC-15 · JS 不执行且有原因 | 同一真实混合包的 native module 监视／管理页 + 现有 JS-only npm 反例：`BC native JS never loads while runnable entries remain usable` | 对真实模块路径的装载点设拦截哨兵；正臂只触发同一路径的装载请求，由拦截器返回安全空模块，不求值原字节，以证明监测能看见。安装／启用过程零装载，管理页显示结构化 native-js-plugin 原因。若加载它、静默漏诊断或把 JS-only 包记成已装都红；不执行不明第三方脚本来预取来源。 |
| AC-06 · 一个登录动作 | `package-account-dialog`／`hub-install-card` 生产 DOM + 现有 `src/engine-adapter/mcp-auth.test.ts`、`package-mcp-oauth.engine.test.ts`：`BC timeline sign-in opens system browser once and returns to its package` | 点击一次即从生产 intents 到实际 adapter 的 openLink，URL 取引擎 attempt；不多弹确认、不走应用内网页。取消后同图仍在，可续登录；complete 后回读同名组件＋URL／packageId。去掉生产接线、另开第二确认或回错包都红。真实 Supabase 浏览器授权另由编排器留证。 |
| AC-07 · 同包令牌保存／更换 | `plugin-package-accounts.test.ts`、`package-secret-recovery-wiring`、生产共用 Dialog：`BC timeline token save changes only its package-owned secret version` | 在 password 输入金丝雀，真保存／重读引用／版本目录正臂看见，聊天／tool part／预览／config 明文／日志／包图负臂零命中；更换清旧专有版本、失败保留旧有效版本。去掉包拥有权或把值经聊天／配置运输都会红；提交未知 needId／已移除包不改其他安装。 |
| AC-14 · 同一安装身份 | `hub-three-pages` + 卡片重挂载／关闭小窗／旧回调：`BC timeline and management keep package identity through account actions` | timeline.metadata.packageId、H 管理目标、账户提交的 packageId／needId 和 main 图必须一致；安装调用计数仍为 1。以名称挑行、淘汰后丢身份、关窗重装、重复删除任一项均被对照抓住。 |

**样本与实际验收安排**

- 继承 `test-fixtures/plugin-helper/` 的 Claude b5b01ac4…、Codex d420d130…、正式签名 GitHub catalog／载荷、Registry GitHub 2.1.0／Figma 1.0.3、OpenCode superpowers/onyxia、JS-only npm 0.0.5 的原字节与各 `provenance.json`。正式 GitHub 同名另用途、Claude GitHub 同能力、Supabase（若采用）都先核完整 MCP/header／技能集合与目录身份／版本；不凭索引名字断言相同。
- 实施时补同版本的正向 OpenCode 可检索记录／树及 Git 捕获（完整性前提先过）、Figma 两目标的实际五源查询记录、市场第二个真实可运行插件与必要实际 OAuth／MCP 交互记录。每个新原件留 URL／query、版本或提交、取得时间、bytes／digest；归档裁剪留原包摘要与成员清单，控制缺项／错误臂说明机械差异。不得把现有 Codex Figma 的**不完整裁剪树**当完整插件可运行证明。
- 自动检查只能证明入口、存储、状态和可调用链。自然语言的择源／不抛路线，真实 GitHub 令牌后的任务、Supabase 系统浏览器登录、以及构建应用与批准帧的实际对照，由编排器在接到实现后收集；凭据值不进入证据报告。受账号／定义可达性影响的未验项逐 AC 返回，不以 mock 结果标 DONE。

**相关命令（IMPLEMENT，包目录执行；并发 2）**

- BC1／BC2，ui-mac：`bun test --max-concurrency 2 src/main/plugin-sources.test.ts src/main/install-from-source.test.ts src/main/ext-write-channels.test.ts src/renderer/extensions/plugin-source-results.test.ts src/renderer/extensions/ext-package-presentation.test.ts src/renderer/extensions/ext-ipc-chokepoint.test.ts src/renderer/extensions/use-extensions-ipc.test.ts src/renderer/extensions/hub-three-pages.test.ts src/renderer/extensions/local-package-renderer.test.ts src/main/claude-plugin-intake.ipc.test.ts src/main/claude-plugin-import-matrix.test.ts`。retire 的专测按实际主体更新；保留的 `claude-plugin-intake.test.ts`／`claude-plugin-install.test.ts`／`local-package-preview.test.ts`／`ext-uncurated-import.test.ts`／`ecosystem-import.test.ts` 只在相关调用变更时执行，明确列结果，不跑全仓。
- BC3／BC4，ui-mac：`bun test --max-concurrency 2 src/main/plugin-package-accounts.test.ts src/main/package-admission.test.ts src/main/package-admission.wiring.test.ts src/main/package-secret-recovery-wiring.test.ts src/main/package-builders-wiring.test.ts src/main/package-mixed-bundle.wiring.test.ts src/main/package-mcp-oauth.wiring.test.ts src/main/package-mcp-oauth.engine.test.ts src/engine-adapter/mcp-auth.test.ts src/renderer/extensions/package-account-dialog.test.ts src/renderer/codepuppy-ui/session-timeline/hub-install-card.test.ts src/renderer/codepuppy-ui/session-timeline/session-timeline.test.ts src/renderer/codepuppy-ui/session-timeline/cards/cards-contract.test.ts src/renderer/extensions/hub-three-pages.test.ts`；preload／秘密／builder 直接 mock 或表枚举消费者按实际改导出追加。
- BC5，ui-mac：`bun test --max-concurrency 2 src/main/plugin-entrypoints.engine.test.ts src/main/install-from-source.engine.test.ts src/main/ext-package-ledger-uninstall.test.ts src/main/ext-set-state-tx.test.ts`；真实 MCP 运行依赖先放临时缓存，使用 A 已记录的测试隔离环境，不改产品命令／超时。
- 若 D/E 集成改到现有 ext 查询／安装导出，再在 ext 跑 `bun test --max-concurrency 2 src/hub-tools.test.ts src/hub-bridge.test.ts src/context-injection.test.ts src/plugin-host.test.ts`；本片不借此实现 create／scope。每个实际修改包各 `bun typecheck`，文档仍只 `python3 scripts/check-doc-links.py docs/specs/plugin-helper-and-hub/plan.md` 与 `git diff --check`；无 gate／bin/check。

### 偏离记录

2026-11-16 r7 PLAN · 编排器已接受 A，重放至 f876922949。本轮先按 A 已记录集合合并复跑 ui-mac 41 文件（全部 `--max-concurrency 2`）：735 pass／4 fail，exit 1（`/tmp/helper-install-plan-YCXgtv/a-r7-ui-base.log`）；ext 五文件 165 pass／1 fail，exit 1（`a-r7-ext-base.log`）；两包 `bun typecheck` 均 exit 0（`a-r7-{ui,ext}-typecheck.log`）。未改任何代码／测试或放宽检查。

- 已知两红：`locale-regression.test.ts:162/189` 的 H OpenCode 来源名称扫描，沿 r7 裁定交 H，不调查／修复。
- 新宿主计数红：`package-admission.wiring.test.ts:46` 仍要求 21，实际子进程 22 pass／0 fail。新增 H 凭据例未同步宿主计数；返回 H／编排器，不在 PLAN 改测试。
- 新夹具接线红：`context-injection.test.ts:304` 仍预期从空 MCP editor 新增 cloud；H `plugin.ts:334` 的实际关闭修正只重臂 main 已注入的服务，而 `extWrites():248` 仍创建空 Map。命名原因后单例确认命令 `bun test --max-concurrency 2 --test-name-pattern '云 MCP 定义落在' src/context-injection.test.ts` exit 1（0 pass／1 fail；`a-r7-cloud-confirm.log`），返回 H 同步夹具，不称为 flaky，也不改关闭语义。
- 初次真 Playwright 场景 `install-from-source.engine.cases.ts:82` 报 spawn_failed（受控失败场景通过）。按 A 已有环境办法，先在临时 cache 执行实际 `npx @playwright/mcp@latest --version`（offline，exit 0，实际补齐可执行安装 0.0.85，`a-r7-playwright-command.log`），再只复核同一 engine 宿主：`npm_config_cache=/tmp/helper-install-plan-YCXgtv/npm-cache npm_config_offline=true bun test --max-concurrency 2 src/main/install-from-source.engine.test.ts` exit 0（宿主 1 pass，严格核内部 2 pass／0 fail；`a-r7-engine-cache-confirm.log`）。保留初红，不宣称冷缓存稳定；产品／测试文件均未改。

上述基线变化已在开始本节规划前报告：未发现另需修改 A 冻结行为的证据；H 两处测试接线和既定语言扫描由其车道处置。BC 真账号／实时 Figma／正向 OpenCode 样本的证明按上表实施或验收取得，不把 PLAN 当作验收。已核：Codex（GPT-6），核 f876922949、H 接缝与设计 v5，本节待编排器检查。PLAN 09:44:36 UTC 开始，约 20 分钟；文档链接检查与 `git diff --check` 均 exit 0，仅本文件新增本节。OPTIONAL：无。


2026-11-16 r8 · BC1 10:11:05 UTC 开始，基线 8c4bd680bc，H 的四处基线红例不在此修正。BC1 同调用链补 main `CandidateV1.installed` 的实际投影：当前来源函数从未填该字段，外部包在重新查询／重挂载后会误回“+”；复用账本／已解析声明的既有运行身份算法，不按显示名猜已装。此小段提前触及 `plugin-sources.ts` 及 `install-from-source.ts` 的身份 helper 调用，仍在本节已列文件内，D/E 重叠逐项报告；不改其 created/effect 分支。

BC1 红例收据：`ext-write-channels.test.ts` 的只读搜索通道、`ext-install-catalog-result.cases.ts` 的 renderer→同源 ID→实际单入口／已装投影、`plugin-source-results.test.ts` 的生产 DOM 四场景、`hub-three-pages.cases.ts` 的同一搜索框／单入口各命令均 exit 1；日志 `bc1-{main,entry,dom,hub}-red.log`（同 A 临时日志目录）。分别缺 sourcesSearch、缺 main handler、缺生产组件、现有占位仍仅当前分类搜索；尚无生产改动。每条保留其失败断言，后续只替换明确编码旧占位／宿主计数的直接消费者。

BC1 补充红例：空候选且某源失败时，不得同时声称查无匹配；IPC 拒绝也要留在行内错误。`plugin-source-results.test.ts` exit 1（内部 4 pass／2 fail，`bc1-empty-error-red.log`），分别实际显示了矛盾的 no-match 提示、resource 错误抛出。生产改动仍未提交，新增这两例后再修；四个先行行为断言未改。正式签名 GitHub 连通证据补入真 main 宿主，边界 mock 使用实际 packageViews 求值与 provenance 的 snapshot digest，不改签名输入或安装行为；固定 1.0.1 的聊天／“+”两支实际均落同一目录包，无外源第二图。

BC1 实施：只读 `sourcesSearch` 与 renderer 的 `installFromSource` 接线到既有单例／写闸；搜索不再按 tab 限于本地目录。已装外源回读账本并复用现有声明运行身份，H 的既有已装行／菜单直接渲染；来源标签同一纯显示函数供新结果与原包行使用。`installedPackageIdentity` 的输入采用共享的纯图注解和 root.name，避免完整 main ledger 类型的 import 闭包把下载／Bun ambient 类型拖进 ext 的 typecheck（首跑出现 ReadableStream 类型冲突，已在本调用链消除；未改下载器）。源码仅新增一个结果组件，无依赖／开关。

BC1 实际检查：八文件命令同本节 BC1 清单去掉尚未改动的 local/import matrix，加已有全部 source/install 回归，`bc1-final.log`；真 main 宿主严格计 11 条，Hub 宿主 27 条，结果行宿主 6 条。真实引擎单独复核 `npm_config_cache=/tmp/helper-install-plan-YCXgtv/npm-cache npm_config_offline=true bun test --max-concurrency 2 src/main/install-from-source.engine.test.ts` exit 0（内部 2 cases；`bc1-engine-final.log`）。ext `bun typecheck` exit 0（`bc1-ext-typecheck-final.log`），ui-mac typecheck 见 `bc1-ui-typecheck-final.log`。基线四红未修、未跑全 gate。共享生产文件本步为 plugin-sources.ts、install-from-source.ts、ext-ipc.ts、extension-hub.tsx；其他为计划的 preload／只读注册、use-extensions、显示投影／翻译。下一步 BC2a→BC2b，尚不宣称本机／市场条目列表或账户动作完成。

BC1 最终收据：`bun test --max-concurrency 2 src/main/plugin-sources.test.ts src/main/install-from-source.test.ts src/main/ext-write-channels.test.ts src/renderer/extensions/plugin-source-results.test.ts src/renderer/extensions/ext-package-presentation.test.ts src/renderer/extensions/ext-ipc-chokepoint.test.ts src/renderer/extensions/use-extensions-ipc.test.ts src/renderer/extensions/hub-three-pages.test.ts` exit 0（83 pass／0 fail，491 assertions；`bc1-final.log`）；ui-mac typecheck exit 0。main 的两个 BC1 实际入口子例均通过，来源结果六场景包含空失败／IPC 拒绝，普通 H 27 场景保持。约 22 分钟，生产约 230 行增删、13 文件（含双语言／preload），加直接消费者与先行红例；没有改 D/E 语义。已核 Codex（GPT-6），BC1 作者自查通过；AC-02 聊天／“+”目录身份和版本／无第二图已在真 main 连通，AC-11 的统一搜索显示已有自动证据，市场单条／本机／账户仍待后段。遗留去向为后段 BC2–BC5 和编排器实际应用验收；OPTIONAL 无。

BC2a 红例先行：`install-from-source.test.ts` 新增两个真实捕获例（本机 frontend-design 与 context7 不互相替换；固定官方市场只安装选定 context7）。`bun test --max-concurrency 2 --test-name-pattern 'BC2a' ./src/main/install-from-source.test.ts` exit 1（0 pass／2 fail，缺 prepareCapture；`bc2a-red.log`）。原始第三方字节沿既有 fixture/provenance；本机来源目录由原 Capture 原字节机械物化，未手写格式。此步只准备 main 私有 ID 和调用现有 candidate 入口，用户侧旧入口直到 BC2b 一次切换，不增加并行可达的安装路线。

r8 BC2a 在实际接缝分为 BC2a.1（本笔 main 捕获／市场候选准备、candidate 安装）与 BC2a.2（main picker／Git 外层运输和冻结 folder 分支接线，与 BC2b 的旧入口替换一起收口）。本笔没有暴露新的 renderer 本机安装路径；BC2a 整段及 AC-15 不能标完成，避免把私有取源能力误报成用户已可达。

BC2a.1：`prepareCapture` 用既有候选表持有私有捕获 thunk，捕获／转换缓存共用，不创建另一安装器。市场条目只给 main 编号和显示事实，不将未取到的远端 Git 提交写成已核提交；本机清单标本机来源，不改冻结远端 source 枚举。安装的 folder/Git 捕获映射为设计已有 local-folder 展示源；同名空间内的不同本机包按各自 packageId 更新，避免第一个本机 source 标记吞掉第二个不同包。源 provider 决定已有 imported/imported-claude origin，完整包内诊断仍交原转换器。共享生产文件仅 `plugin-sources.ts` 与 `install-from-source.ts` 的已列来源段。

BC2a.1 验证：四文件 `bun test --max-concurrency 2 src/main/plugin-sources.test.ts src/main/install-from-source.test.ts src/shared/host-extension-package-contract/plugin-conversion.test.ts src/shared/host-extension-package-contract/host-extension-package-artifact.test.ts` exit 0（80 pass／0 fail／522 assertions；`bc2a-final.log`）。两先行红例保持原断言；新增移走原目录后仍能安装、逐文件读回实际源 bytes 不变的正向证据，捕获若改为安装时重新读取原路径便失败。两包 `bun typecheck` exit 0（`bc2a-ui-typecheck-final.log`、`bc2a-ext-typecheck.log`）；文档链接和 diff 检查 exit 0。生产约 100 行增删、2 文件，无生成产物／依赖变化。BC1→本笔约 35 分钟；已核 Codex（GPT-6）作者自查，未执行账户登录或外部写入。

r8 下一步准确边界：BC2a.2 与 BC2b 尚未接 main 选择器／Git IPC、未撤旧 hub 逐技能／确认运输；BC3 非目录令牌保存、BC4 时间线账户动作、BC5 OpenCode 真实可检索正向样本／引擎／模型验收均未完成。构建应用真实账号与自然语言证据继续归编排器，H 四处基线红项不在此处理。工作树在本 main 能力边界提交后交回；不把本机或市场 UI、独立 MCP 授权后的真实使用、AC-06/07/14/15 报通过。OPTIONAL 无。


r9 BC2a.2 红例先行：生产 `ext-install-catalog-result.cases.ts` 新增 main 目录选择、路径／字节不跨线、准备零写入、取消／伪造路径零提交，以及 Git 市场清单只装所选 context7。真实 frontend-design 与市场原字节沿既有 provenance；Git HEAD 在网络边界映射到同一固定提交 archive。`bun test --max-concurrency 2 --test-name-pattern BC2a.2 ./test-component/ext-install-catalog-result.cases.ts` exit 1（0 pass／2 fail，缺 `ext-prepare-plugin-source`，`bc2a2-red.log`）。

r9 指定先跑 `bun test --max-concurrency 2 src/main/codepuppy-sidecar-wiring.test.ts` exit 1（5 pass／1 fail）：`codepuppy-sidecar-wiring.test.ts:131` 仍调用 A3 已移除的 `requests.record`，并断言旧 `confirming`；现行 `HubRequestStages` 为 submit/settleInstall/get 与 submitted。修正会改变阶段期望，本轮明确将行为断言交编排器裁定，原例保持；不为旧测试恢复已退役运输。其他 BC 工作独立继续。


BC2a.2 实施收据：main 新增私有只读取源准备通道 `preparePluginSource`（folder/Git），目录选择和捕获都在恢复 mutex 外；返回既有 prepared 的编号与安全展示事实，取消零写盘，拒收 renderer 路径。Git 通过已有 codeload 固定实际提交，支持仓库根与 GitHub tree 地址，不运行 clone/hook/script。冻结 folder 安装请求在 main 选择并捕获后映射到同一 candidate 写闸；同 requestId 复用捕获，写入／结果幂等仍由既有 installer 持有。市场通过只读准备清单逐条选择；直接 folder 请求若取得市场而非单包，不安装市场本身。

`bun test --max-concurrency 2 src/main/ext-write-channels.test.ts src/main/plugin-sources.test.ts src/main/install-from-source.test.ts` exit 0（57 pass／0 fail，326 assertions；`bc2a2-main.log`，生产 IPC 子进程严格 13 场景）；ui-mac/ext 各 `bun typecheck` exit 0（`bc2a2-ui-typecheck.log`、`bc2a2-ext-typecheck.log`）。共享生产文件 `ext-ipc.ts` 的取源/入口外层与 `plugin-sources.ts` 的私有准备类型；另为既列 preload/注册表。生产约 60 行增删、6 文件，无冻结 DTO 改动。本笔未切换 hub 菜单，用户可达链在 BC2b 同笔撤旧收口；本片整体及 AC-15 仍未标完成。已核 Codex（GPT-6）作者自查；下一步 BC2b，OPTIONAL 无。


BC2b 红例先行：生产 IPC 明确断言旧 folder/Git/Claude preview/cancel/confirm 五条运输不再注册、普通 agent confirm 仍在；真实 Hub DOM 以固定 frontend-design／317 项官方市场 prepared 投影证明文件夹直接安装整包无确认、Git 列表选择前零安装且仅所点 ID 出站。`bun test --max-concurrency 2 --test-name-pattern BC2b ./test-component/ext-install-catalog-result.cases.ts ./test-component/hub-three-pages.cases.ts` exit 1（0 pass／3 fail，`bc2b-red.log`）；旧菜单仍调用旧通道，清单未出现。


BC2b 收据：添加菜单现通过 main picker/Git 准备整包；单包无需确认直接到统一入口，市场显示逐条来源与「+」，只提交所选 main ID。`PluginSourceChoices` 从已有搜索行提取供两处实际复用，已装结果复用 H 原行／菜单。Hub、useExtensions、preload、main 写表同时撤下旧 skill folder/Git 与 Claude preview/cancel/confirm 五条运输。`ecosystem-import` 的项目／原生来源链与 ext-fs-installer 原语不变；`claude-plugin-intake` 的纯类型／命名及真实语料检查保留，不重写公共命名合同。

清理范围补记：删除只属于旧两段式入口的 `local-package-preview.ts`、`local-package-install-port.ts`、`claude-plugin-install.ts` 及其专测；删除旧 `claude-plugin-intake.ipc` 与 `local-package-renderer` 两对宿主／cases、旧 local-package-channel 的 preview/confirm 子宿主与 cases。它们钉的逐技能／预览确认／默认关闭链已被替换；替代生产 IPC 15 场景、Hub DOM 29 场景与 A2 整包事务／碰撞／失败／私密文件用例在同树执行，公开 namespace 子宿主仍保留。除计划所列文件外，仅旧 installer/preview 的 `.test.ts` 专测随主体删除，原因同上。实际约 26 文件、约 100 行新增／4,500 行退役，符合计划的旧实现删除项；不是扩大新功能。

执行中撤旧的块边界曾误删相邻普通 reload 注册；提交新增红例 `BC2b ordinary reload transport stays active`（`bc2b-reload-red.log`，exit 1）后恢复，生产注册集合对照最终仅减少上述五条；普通 agent confirmation 与 reload 均保留。`bun test --max-concurrency 2 src/main/ext-write-channels.test.ts src/main/plugin-sources.test.ts src/main/install-from-source.test.ts src/main/claude-plugin-import-matrix.test.ts src/renderer/extensions/plugin-source-results.test.ts src/renderer/extensions/hub-three-pages.test.ts src/renderer/extensions/use-extensions-ipc.test.ts src/renderer/extensions/ext-ipc-chokepoint.test.ts src/renderer/extensions/ext-package-presentation.test.ts src/renderer/extensions/hub-copy.test.ts` exit 0（91 pass／0 fail，1353 assertions，`bc2b-related-final.log`）。ui-mac/ext `bun typecheck` 各 exit 0（`bc2b-*-types-final.log`）；未跑 gate/bin/check。

另一次具名相关集含保留的 `local-package-channel.test.ts` 时，namespace 子例 `test-component/local-package-namespace.cases.ts:225` 仅因 Object.keys 钉值缺少 H 已有 desiredState 而红（内部 4 pass／1 fail；`bc2b-related-first.log`）；该测试字段与生产投影在此步前已如此，`git show 70a5af8951:packages/ui-mac/src/main/ext-ipc.ts` 的原投影已有 desiredState。本轮不修改 H 行为期望，去向编排器／H。连同前述 sidecar confirming 红项，两条原例均保留，不宣称相关全集全绿。共享本步文件为 `ext-ipc.ts`（撤旧接线）、`extension-hub.tsx`（菜单／清单段）、本计划；未改 D/E 的分支、effect 或 Locations 过滤。已核 Codex（GPT-6）作者自查，BC2b 自动证据通过；BC3–BC5 与实际应用／真实账户验收尚待，OPTIONAL 无。


BC3 红例先行：`plugin-package-accounts.test.ts` 复用 provenance 中 GitHub 2.1.0 与 agentfetch 1.0.1 独立 Registry 定义；后者真实 environmentVariables 有 JINA_API_KEY、FIRECRAWL_API_KEY、REDIS_URL 三个绑定，转换后的三需求不缩减。查询边界只把已录 search envelope 的 server 换成该真实 version 记录。`bun test --max-concurrency 2 src/main/plugin-package-accounts.test.ts` exit 1（0 pass／3 fail，`bc3-accounts-red.log`）：非目录账户读取为空／保存被拒。断言覆盖专用存储金丝雀正反臂、同包图/claims、旧版本清理、失败保留旧值、未声明需求零改写、部分更新保留其他需求。


BC3 补证与窄修正：生产账户保存→同包 runtime apply 红例 `bc3-runtime-red.log` exit 1（应用调用为空；主进程仍只请求 reload）已先提交。补充范围保持例时误把 `readMcpLeafStrict` 的返回形状当作 JSONC 禁用投影；`ext-config.ts:529–532` 优先返回 `remoteMcpLeaf(record)`，该定义没有 enabled，第一条前置断言即红、尚未执行保存（`bc3-projection-red.log`）。依 r6/r9 关于 API 返回形状误用的 standing ruling，单独修正该例的两个读取表达式，改读实际 JSONC；行为期望仍为保存凭据保留已存在的全局禁用投影与同包身份，不改变期望、scope 或正式契约。


r9 BC3 实施／未决收据：账户读取与保存现共同消费已有 `createPackageDeclarationResolver` 的安装身份／声明；非目录以已存 MCP leaf/needId 调原 builder、版本化专用存储与包拥有的单次账本事务。读取非目录不取目录事实；目录沿原验签事实与摘要复核，装后更换不重装、不改 graph/claims。部分更新用现有 `releasePreparedMcpSecretVersion` 保留仍引用的旧版本，完整替换清理旧版本，失败回滚仍用 H 原事务。main 保存成功后调用原 `applyPackageMcpV1` 并通知真实视图，不再请求 Location reload。

必要同调用链文件 delta：`ext-config.ts` 的远端 `persistMcp` 发布原会清掉 project-only 的全局 disabled 覆盖，修正读取表达式后的红例已到达保存后断言（`bc3-projection-corrected-red.log`，exit 1，保存后覆盖缺席）。凭据事务按现存 graph.effect 保留 disabled；既有配置写方只留下 graph.effect 要求的 `{enabled:false}` 覆盖，远端定义仍只在 main truth。普通全局包保持 H 无 JSONC 状态编辑的行为；没有改 effect 的决定、v2 allow-set、Location 过滤或 `packages/ext/src/package-scope.ts`。这是 BC3 必需的发布链修复，新增约 13 行，不另设配置写方、选项或 schema。共享文件新增 `package-admission.ts`（账户／已装声明段）与 `ext-config.ts`（远端发布段），请编排器在 D/E/H restack 对照。

验证（包目录 ui-mac，均 `--max-concurrency 2`）：

- `bun test --max-concurrency 2 src/main/plugin-package-accounts.test.ts src/main/package-admission.test.ts src/main/package-secret-recovery-wiring.test.ts src/main/package-builders-wiring.test.ts src/main/package-mixed-bundle.wiring.test.ts src/main/ext-write-channels.test.ts src/main/install-from-source.test.ts` exit 0：62 pass／0 fail／452 assertions（`bc3-related-final.log`）；生产 IPC 子宿主严格 16 场景，包括保存→runtime apply 同 packageId、回读 saved 与零 reload；四个账户例包含私密文件正向金丝雀／配置与账本负向扫描、部分保存、旧版本、更换失败、既有范围投影与项目目录零文件。
- 因 `persistMcp` 行为变化，运行其直接消费者：`bun test --max-concurrency 2 src/main/ext-config.test.ts src/main/ext-config-tx.test.ts src/main/mcp-server-truth.test.ts src/main/mcp-server-derivation.test.ts src/main/ext-seed-install.test.ts src/main/engine-plugin-seal.test.ts src/main/ext-project-residuals.test.ts src/main/ext-install-planner.test.ts src/main/codepuppy-environment.test.ts src/main/ext-security-boundaries.test.ts` exit 0：403 pass／0 fail／3273 assertions（`bc3-config-consumers.log`）。public exports、签名与冻结 DTO 均无变化。
- ui-mac/ext 各 `bun typecheck` exit 0（`bc3-ui-types-final.log`、`bc3-ext-types-final.log`）。具名 `package-admission.wiring.test.ts` 已跑，仍因编排器已接管的 21→22 宿主计数失败，内部 22 pass／0 fail（`bc3-related-with-pin.log`）；未更改该钉值。
- **未决，不报引擎全绿**：原 A2 `install-from-source.engine.test.ts` 首次当前树 exit 1，内部一场景通过，一场景在 `install-from-source.engine.cases.ts:82` 的 Playwright MCP 进程启动处 `spawn_failed`（`bc3-engine.log`）。只将本轮四份生产／机械同步改动保存为临时 patch 并 scoped restore，对照 HEAD 的同一宿主 exit 0、严格内部 2 场景通过（`bc3-engine-base.log`）；随后恢复 patch，显式离线缓存 `npx @playwright/mcp@latest --version` exit 0（0.0.85），当前树同宿主仍 exit 1、同一启动处失败（`bc3-engine-warm.log`）。未隔离因果，不宣称是环境／flaky，也未修改 Core、真实样本命令、超时或断言；这项当前树与基线差异交编排器处理，BC3 的真实引擎复核保持未完。

r9 在本可恢复边界交回：BC2a.2／BC2b 完成；BC3 账户主链与生产 IPC／存储证明已提交，以上 A2 真引擎差异未决；BC4 同包令牌组件／时间线一个登录动作、BC5 Figma 实查记录／OpenCode 可检索正向样本／完整引擎与模型验收均未开始。不要把 AC-03/05/06/07/14/15 报完整通过。最先指定的 A3 旧 confirming 断言与新发现 H namespace 字段钉值均待编排器裁定／H，同既有 21→22 钉值不在此修复。已核 Codex（GPT-6），作者自查结论为 PARTIAL；依据版本仍为本节 spec v3／design v5 和 r8/r9 授权，已定勿重开不变；OPTIONAL 无。未执行真实账号登录、外部写入、gate/bin/check、push/PR/merge；所有前台命令已结束。


r10 决定 1 核验（2026-11-16，起始 11:23:40 UTC，约 8 分钟）：按 brief 先对三个生产提交做单一失败场景对照。仅临时物化三提交所改生产文件在各节点的字节，每次执行后 finally 恢复原始字节；分支／index 不移动。命令均在 ui-mac：`npm_config_cache=/tmp/helper-install-plan-YCXgtv/npm-cache npm_config_offline=true bun test --max-concurrency 2 --test-name-pattern '^A2 real package installation updates two loaded Locations' ./src/main/install-from-source.engine.cases.ts`。

| 生产节点 | 单场景结果 | 日志（`/tmp/helper-install-plan-YCXgtv/`） |
| --- | --- | --- |
| `0404f0add5` 当前 | exit 0，1 pass，14 assertions | `r10-bisect-0404f0add5.log` |
| `389de63aca` | exit 0，1 pass，14 assertions | `r10-bisect-389de63aca.log` |
| `70a5af8951` | exit 0，1 pass，14 assertions | `r10-bisect-70a5af8951.log` |
| `ed19756043` 本轮生产改动前 | exit 0，1 pass，14 assertions | `r10-bisect-ed19756043.log` |

因四节点均通过，未发现可二分到三提交某一改动的失败。继续只改变离线缓存做因果对照，临时 npx 包装器只把 stderr 分流到临时文件、保持原命令/参数/stdin/stdout 和退出码：当前树空缓存 exit 1（`r10-empty-cache.log`），两个 npx 子进程实报 `ENOTCACHED`，缺 `https://registry.npmjs.org/@playwright%2fmcp` 的缓存响应；同一空缓存下 `ed19756043` 也 exit 1、同一 spawn_failed 点（`r10-empty-base-ed19756043.log`）。当前树换回已准备缓存 exit 0（`r10-prepared-cache.log`）；只复制既有 `_cacache`、不复制 `_npx` 的冷解包缓存亦 exit 0（`r10-unpacked-cold-cache.log`）。运行条件是 offline 模式的缓存必须有 npm 解析元数据及相应包内容；可用临时缓存执行真实 `npx @playwright/mcp@latest --version` 准备，不能用“空 offline cache”当产品回归证据。没有改真实样本命令/版本、timeout、Core 或任何生产投影。

最终当前树完整宿主 `npm_config_cache=/tmp/helper-install-plan-YCXgtv/npm-cache npm_config_offline=true bun test --max-concurrency 2 src/main/install-from-source.engine.test.ts` exit 0，宿主 1 pass，严格内部 2 场景（`r10-engine-current-final.log`），最终已移除 PATH/stderr 包装器；证明两已载入 Locations、工具回读/调用、重建与断开原断言仍通过。带诊断包装器的完整宿主也 exit 0（`r10-engine-current-full.log`）。已证明同一失败类型不依赖本轮提交、由空离线缓存独立触发；r9 原始 stderr 未留存，不能声称其两次历史失败一定为 ENOTCACHED。继承这项历史归因限制，不宣称冷网络验收已完成。决定 1 的当前树引擎核验关闭，BC3 不再因该项悬置；后续 BC4/BC5 仍按原计划推进。已核 Codex（GPT-6），作者核验；剩余真实应用／账号验收归编排器，OPTIONAL 无。


r10 决定 2：按本轮裁定直接替换 `codepuppy-sidecar-wiring.test.ts` 中旧 renderer-recorded confirming 断言，生产行为不改。真 host 经真子进程分发受理 install 后，读取 submitted；只有 main 安装回调完成后读到 committed。旧 stage 写消息与畸形只读消息均拒绝，不改变 main 记录、不发伪回复；子进程 ready/attach、reload 排队与退出断开原断言保留，出站及日志金丝雀扫描零泄漏、无 confirming。`bun test --max-concurrency 2 src/main/codepuppy-sidecar-wiring.test.ts` exit 0，6 pass／0 fail／62 assertions（`r10-sidecar.log`）。原红已在 r9 指定命令留档，本笔属明确编码被替换行为的旧断言同步。已核 Codex（GPT-6），通过；普通审批面未改，下一步 BC4。


BC4 红例先行：时间线三个具名场景 exit 1（无登录／连接动作，`r10-bc4-card-red.log`）；生产 `CodePuppySessionTimeline`→当前 SDK→既有 OAuth adapter→system-browser 的接线例 exit 1（按钮缺席，`r10-bc4-binding-red.log`），测试端点只模拟本仓引擎 API，不登录真实服务。独立共享密码组件三例宿主 exit 1（组件尚不存在，`r10-bc4-dialog-red.log`）；断言同包重读需求、部分提交、无 required、失效需求零写、失败不泄漏。旧 A4「没有时间线动作」断言随明确替换行为同步，原状态／金丝雀／manage 断言保持；生产 adapter 的目录参数形状已用实际 SDK 探测为 `location[directory]` 后写入断言，未手造第三方格式。


BC4 测试运输窄修正：新生产绑定例的 SDK mock 原把 mcp 错放进 `ensureDirSdkContext().client`，而生产 `session-timeline.tsx` 消费 `serverSDK().client`；故按钮已出现后、尚未到 adapter 即失败，观测引擎请求数组为空。按 standing API 调用形状修正规则单独将 mock 移至实际根 client，并将该例两微任务 flush 改为等到实际按钮挂载后断言（上限 1s，断言与一击授权行为不变）；不改变 SDK/生产签名、动作或成功条件。原红例仍能检测缺少动作／生产 intent 接线。


BC4 收据：`PackageAccountDialog` 从 H 的实际密码窗提取，管理页与时间线共用 main 需求读取／同一个 savePackageSecrets 写方，按 packageId＋needId 绑定，仅显示同组件需求；字段无 required，部分值提交，关闭或身份变化清空输入，失败留窗且不泄漏。多需求字段采用 main 的实际 label 区分，不让不同凭据都只显示“令牌”。保留 H 的 GitHub/SQLite 帮助与既有 OAuth 小窗，不重做权限／管理页。必要私有动作文件 delta：新增 `package-account-auth.ts`，将现有 SDK authenticate＋status 回读收成一个被 useExtensions 和生产时间线两处实际消费的函数；不另开授权运输、listener 或 token store。

时间线从 main 的真实待授权事实给出「登录 {服务名}」「连接 {服务名}」；登录一次即经当前目录的现有 SDK/adapter 调 system-browser，取消仍保留原图和动作；令牌打开上述共享窗，保存后重读原 packageId，不重装。现有 `openPackageManagement` 继续处理管理动作。生产绑定例确实挂载 `CodePuppySessionTimeline`，再经真实 SDK 与 adapter 的公开引擎 API 模拟，检查只有一次 openLink、一次 OAuth connect、全部请求保留 location[directory]；没有登录真实账号。

追加先行红例 `r10-bc4-label-red.log`（多需求标签不可区分）与 `r10-bc4-identity-red.log`（切换目标包仍留旧密码）均 exit 1，再修组件；原有行为断言未放宽。共享生产文件本步仅 `extension-detail.tsx` 的密码窗提取／调用段，未改 D/E 范围展示；其余为计划中的 useExtensions／时间线／双语言和共享组件。新增 auth helper 名称是上表“必要的窄动作复用”的实际落点。

最终 ui-mac：`bun test --timeout 60000 --max-concurrency 2 src/renderer/extensions/package-account-dialog.test.ts src/renderer/codepuppy-ui/session-timeline/hub-install-card.test.ts src/renderer/codepuppy-ui/session-timeline/session-timeline.test.ts src/renderer/codepuppy-ui/session-timeline/timeline-model.test.ts src/renderer/codepuppy-ui/session-timeline/cards/cards-contract.test.ts src/renderer/extensions/hub-three-pages.test.ts src/renderer/extensions/ext-ipc-chokepoint.test.ts src/renderer/extensions/use-extensions-ipc.test.ts src/renderer/extensions/hub-copy.test.ts src/engine-adapter/mcp-auth.test.ts src/main/package-mcp-oauth.wiring.test.ts src/main/package-mcp-oauth.engine.test.ts` exit 0，137 pass／0 fail／1356 assertions（`r10-bc4-related-final.log`）；内部宿主严格核共享窗 4、卡片 10、生产时间线 123、H 29 场景。首跑原 5 秒默认测试执行预算触发整个时间线子宿主超时，后续用上述 60 秒 CLI 执行预算完成（总 26.32 秒）；未改产品超时、成功阈值或测试内期限。cards import 棘轮保持，通过既有只读 IPC 返回类型推导 AccountItem，未引入权限判定面或放宽静态检查。ui-mac/ext 各 `bun typecheck` exit 0（`r10-bc4-{ui,ext}-types-final.log`）。文档链接与 diff 检查 exit 0；已核 Codex（GPT-6）作者自查，BC4 自动证据通过，真实 Supabase 登录及完整应用输入／模型任务仍交编排器。下一步 BC5，OPTIONAL 无。


BC5 先行资料与用例：新增 `test-fixtures/plugin-helper/entrypoints/`，保留 35 份公开 HTTP 原始响应（npm 查询原文 gzip 存放），来源／状态／时间／原始与压缩摘要在 `provenance.json`；没有运行下载内容、脚本或依赖安装。正向 npm 包 `@unfrgivn/opencode-config@3.0.6`（tar SHA-256 `2ea46359046667c9048affc7e0a4eeae069d960ed8373d488b6713ac714c8e07`，上表 gitHead）有 37 个技能及原生 `dist/index.js` 声明；npm 搜索测试只从真实响应选该记录作受控成员集，不声称是完整线上查询。Git 原始树保留 304 节点，没有构建 dist，须如实标 missing-entry。Figma 插件固定其真实市场记录的 `figma/mcp-server-guide@f2789420e7e8b4e2465dfeb1e12e1fc6a31397e5`（16 技能＋MCP），官方 Registry 查询实际返回 `com.figma.mcp/mcp@1.0.3` 与 `https://mcp.figma.com/mcp`；两次 npm 查询全分页及 Registry 全分页分别留档，不编造未找到结果。

`bun test --max-concurrency 2 src/main/plugin-sources.test.ts` exit 0，26 pass／135 assertions（`r10-bc5-sources.log`），新增两例核真实样本摘要、版本、原生 JS 诊断、Git 同版本，以及 Figma 两种目标的来源／定义；删除来源发现或替换查询目标将转红。新增严格五场景宿主 `plugin-entrypoints.engine.test.ts`／`.cases.ts` 首跑 exit 1（`r10-bc5-engine-first.log`），第一个聊天安装已提交但 37 技能没有进入引擎库存，随后场景因残留图级联，不计独立缺陷；先单例定位运输与库存。原生入口监测以 Bun onLoad 拦截实际 dist/index.js、替换为无操作导出，正向控制计数 1，测试绝不执行第三方 JS。独立 GitHub MCP 只用仓库原有 echoMcpHandler 模拟已授权协议，不声称真实 GitHub 账号工具成功；实际账号／自然语言验收仍归编排器。此提交保存先行红例，生产未改；已核 Codex（GPT-6），BC5 尚未通过。


BC5 宿主接线修正（独立测试提交）：首红的 main 重载请求和 ext 的 reloaded 回报均正常，库存仍只有内置技能；新宿主漏了生产 `sidecar.ts:154` 的 `watchExplicitSources`，且 `codepuppyEngine` 默认 filewatcher=false（引擎不重读显式文件）。仅在新 cases 的启动中接同一个生产监听／`explicitSkillDirs` 算法并使用生产启用的文件监听，不手工拼技能目录、不加重启、不改变任何库存／关闭／移除断言。正向原生 JS 监测与真实 npm 树准备移到 beforeAll，单独筛 folder/Git 例也能独立运行。`bun test --max-concurrency 2 --test-name-pattern '^BC5 chat installs' ./src/main/plugin-entrypoints.engine.cases.ts` exit 0，1 pass／61 assertions（`r10-bc5-chat-watching.log`）；没有修改生产。

遗留去向：`package-hub-lifecycle.engine.cases.ts:266` — 用现有 H 宿主作一次对照时 action 在等待 refreshes 增量处超时，日志 `r10-bc5-harness-control.log`（同名筛选 0 pass／1 fail）；该宿主既有刷新计数前提由 H／编排器处置，本轮不调查或修改，未把它当作通过证据。


BC5 固定样本字面期望更正（单独提交，standing ruling）：`plugin-entrypoints.engine.cases.ts:188/241` 原把 Git 树不存在的构建入口期待为 plugin／包名；真实 `repository.tar.gz`（provenance 所记 gitHead）里的 package.json 声明 main `dist/index.js`，树没有此文件。按 design v5 §4.1 对 missing-entry 的既定映射，图项实际是 definition／index.js／missing-entry。只改这一字面三元组，仍断言同版本、缺失入口真实原因与 JS 零加载，npm/folder 的 native-js-plugin 三元组不变。`r10-bc5-engine-watching.log` 2 pass／3 fail，其中首红为此字面，其余均残留图级联，不作为行为变化或独立缺陷。


BC5 原生入口监测的测试接线修正：单独 Registry 例停在 pending 且传输收到 0 请求；先尝试全局 fetch 与既有 engine fetch 注入口两种控制都保持 pending，不能将其归因于 fetch 捕获。实际记录的 onLoad 路径显示，新监测器 `/dist/index.js` 还拦了引擎已锁定依赖 `eventsource@3.0.7`／`eventsource-parser@3.1.1`，错误地拿它们与包入口摘要比较（`r10-bc5-registry-monitor.log`）。仅在回调内按摘要返回 undefined 仍 pending；将 Bun filter 本身限定到隔离 sandbox 的输入／托管目录后，依赖不再过这条钩子，Registry 单例 exit 0（`r10-bc5-registry-monitor-filter.log`，1 pass／23 assertions）。实际包入口仍被无操作替换，正控制 1、各安装过程 0；没有加载第三方 JS、修改生产行为、去掉或放宽断言。

新 cases 为封闭协议运输，直接把现有 ServerOptions.fetch 注入口传给原 `startEngine`（使用 `codepuppyEngine` 的原注入配置／ext／数据库／probe），而非给生产添加选项或更改引擎。必要测试启动代码仅留在此新文件，不改共享 harness 或 Core。失败诊断只记 URI 路径／认证布尔值和公开库存，不记令牌值。此提交只修正测试宿主形状，额外实际技能调用与专有令牌文件清理断言下一笔追加。


BC5 当前收据／未闭环（r10）：补了实际技能工具调用及正负凭据证据，不只读列表：真 session 的 `skill` 工具返回固定样本正文；Registry 令牌正臂在专用目录恰有 1 文件，图／消息／日志／config 负臂零命中，移除后该文件消失。新增库存判断同时要求 ext、config.skill、probe 都 active，避免把重载期间暂时的空表当作“关闭生效”；场景入口也先核已载入的桌面 Location。这是加强原有关闭／移除语义，没有改产品等待、状态或阈值。

此强化暴露 **AC-15 尚未通过**：`bun test --max-concurrency 2 --test-name-pattern '^BC5 chat installs' ./src/main/plugin-entrypoints.engine.cases.ts` exit 1（`r10-bc5-off-state.log`）。主进程关闭返回 ok；15 秒后 37 张账本记录全为 disabled，`skills-enabled.json` 为 `{v:2,keys:[],scoped:[]}`；合成显式文件仍有 38 条 skills（37 受管目录＋项目路径），完整已载入引擎仍有 37 技能。失败点 `plugin-entrypoints.engine.cases.ts` 的 `OpenCode skills off`。前面的短暂空表与较弱谓词曾得到绿，**这些日志不再作为 AC-15 关闭／完整生命周期通过证据**；`r10-bc5-engine-full.log`／`r10-bc5-engine-settled.log` 已留实际整组失败，不用隔离或重启绕过去。

当前定位到“账本／v2 允许集已收窄，显式配置未撤路径”的既有接缝；`codepuppy-config-injection.ts:112` 的 explicitSkillDirs、`engine-explicit-config.ts:101` 的 watchExplicitSources 和生产 `sidecar.ts:154` 为同一投影链。尚未鉴别为生产监听还是新宿主运输差异，不把它宣称为已证实的 Core／H 缺陷；本轮没有旁路其单一算法、写第二份配置或修改 H 状态／D/E／Core。下一步准确范围是核这条显式配置更新接缝，让上述原红例在 loaded 状态撤完技能，再完成三入口 off/on/remove 五例宿主；BC5 在此可恢复红例边界交回，BC4 完成，不报 BC5 完成。

已完成的独立证据：

- `bun test --max-concurrency 2 --test-name-pattern '^BC5 standalone official|^BC5 Figma plugin' ./src/main/plugin-entrypoints.engine.cases.ts` exit 0，2 pass／40 assertions（`r10-bc5-independent-final.log`）。GitHub 是独立 Registry 公共定义、单图、同包专用令牌、真引擎发现／调用 echo 协议工具、关闭／移除有效；只模拟 MCP 运输，未使用真实账号。Figma 插件聊天查询与明确官方 MCP 的搜索查询进入各自 main 安装，source／commit／publisher／version／URL 均来自已捕获定义，官方 MCP 保留待登录，不报已授权。两例项目字节均不变。
- `bun test --max-concurrency 2 src/shared/host-extension-package-contract/plugin-conversion.test.ts src/shared/host-extension-package-contract/host-extension-package-artifact.test.ts src/main/plugin-sources.test.ts` exit 0，64 pass／434 assertions（`r10-bc5-sources-final.log`）。去掉 npm/OpenCode 发现／Git 取源、换 Figma 查询目标或丢官方 URL／发布者都会红；原字节逐一验摘要。
- `npm_config_cache=/tmp/helper-install-plan-YCXgtv/npm-cache npm_config_offline=true bun test --max-concurrency 2 src/main/plugin-entrypoints.engine.test.ts src/main/install-from-source.engine.test.ts src/main/ext-package-ledger-uninstall.test.ts src/main/ext-set-state-tx.test.ts` exit 1，65 pass／1 fail（`r10-bc5-related-final.log`）；唯一红宿主为上述 BC5，内部首红技能关闭，其余残留图级联不计独立缺陷。A2 完整宿主（严格内部两例）、账本卸载与状态事务仍绿，决定 1 没有回退。
- ui-mac／ext 各 `bun typecheck` exit 0（`r10-final-{ui,ext}-types.log`）；BC4 的 137 pass 与 sidecar 6 pass 收据如上。文档链接与 diff 检查在最终提交前执行。

规模／偏离：r10 到 12:39 UTC 约 76 分钟，生产为 BC4 的 9 文件约 245 行增删；BC5 零生产改动、新 engine 宿主／cases、sources 两例与 35 份原响应（共约 3.2 MB，摘要／压缩另记）。私有 auth helper、测试宿主初始化、固定 Git missing-entry 字面与 JS 监测钩子形状修正均已逐笔留档，没有放宽行为断言。H/D/E 共享生产文件本轮只触及 `extension-detail.tsx` 的密码窗提取／调用段，另共同计划文件；未动 plugin-sources.ts／install-from-source.ts／ext-ipc.ts／package-mcp-activation.ts／extension-hub.tsx 的并行段。

已核：Codex（GPT-6）作者自查，PARTIAL。依据仍为 spec v3／design v5 和 r8/r10 授权；已定勿重开不变。遗留去向：BC5 技能显式配置生效差异→编排器接回／下一轮；H 现有生命周期宿主 refreshes 超时→H／编排器（上述单次对照，不修）；构建应用的两句 Figma 自然语言、真实 GitHub 授权只读任务、Supabase 系统浏览器登录与时间线屏幕证据→编排器实际验收。未做真实账号登录、外部写入、gate/bin/check、push/PR/merge；OPTIONAL 无。

最终文档验证：`python3 scripts/check-doc-links.py docs/specs/plugin-helper-and-hub/plan.md` exit 0（3 个相对链接）；`git diff --check` exit 0。本轮所有前台命令已结束；以保留可复现红例的提交交回，不把 BC5 宿主报绿。


r11 组装收据（2026-11-16，12:48:13 UTC 开始）：按本轮例外接手已有 rebase，在 `1ac2e61d8b` 上完成 `f876922949..979fe21266` 的全部 28 个提交；`git range-diff --no-patch` 逐项仍为 1→28，无 skip、无丢提交。接手前 5 笔机械并集按交接保留（plan、cases、导入、双语言键与临时 pin）；接手后停止点与解决如下。

| 原提交 | 冲突文件（packages/ui-mac/ 下） | 解决与验证 |
| --- | --- | --- |
| `ed19756043` | `src/main/install-from-source.ts`、`src/main/plugin-sources.ts` | 保留 created/mine/created origin 与 local-folder/local/provider origin 的联合；同源 id 双分支；guarded publisher；searchedSources 与 prepareCapture 并存 |
| `70a5af8951` | `src/main/ext-ipc.ts` | 导入并集：PreparePluginSourceResultV1 与 D/E installCatalogFromSource 同留；目录物理全局/逻辑 effect 与 departing cleanup 未动 |
| `389de63aca` | `src/renderer/extensions/hub-three-pages.test.ts`、`src/renderer/i18n/en.ts`、`src/renderer/i18n/zh.ts` | 双语言保留 effect 与 marketplaceTitle 键并集；宿主暂31，末尾执行核钉值 |
| `0404f0add5` | `src/main/ext-config.ts`、`src/main/package-admission.ts` | 远端 MCP 真源保存保留 D/E 原子 disabled override（同一作用域语义且无 enabled 空隙）；imports 并集；credential builder 保留 effect + BC3 definition |
| `e609c854bd` | `src/main/plugin-sources.test.ts` | append-only 保留 D3 五来源记录完整性测试与 BC5 两个真实样本测试，未改断言 |

来源前提复核：`created-plugin.ts:14` 构造的 capture.source.kind 恒为 created；`plugin-sources.ts:308/317` 的捕获分别恒为 folder/git，不把自制 capture 冒充本机捕获。两 kind 的同源 lookup 都要求 proposed packageId，created→mine/created origin，本机→local/provider origin；publisher 读法保留 guarded form。`ext-config` 保留 D/E 原子写 disabled 覆盖再清 legacy 副本，BC3 的远程定义／凭据真源、same-package save 和 runtime apply 并存；未回退为先删后写的暂时 enabled 空隙。`package-admission` 的 effect 与 BC3 definition 参数同时保留。所有行为断言都保留，只有执行计数 pin 机械校正。

初始组装 HEAD `86cab56974`，`origin/alpha` 为 `23546fd5b1`；`git diff --quiet origin/alpha -- bun.lock` exit 0，无需 bin/setup；初始两包 bun typecheck 均 exit 0。新宿主实跑为 BC5 wrapper 1（内部 5）、账户窗 wrapper 1（内部 4）、搜索结果 wrapper 1（内部 6）；Hub 三页真实子例 33 而非临时 31，先行 pin 红日志 `hosts-counts-first.log`（16 pass/1 fail，内部 33 pass/0 fail），校正为 33；卡片内部 10、生产时间线内部 123、main IPC 内部 16、保留 namespace 内部 5 的 pin 亦由对应宿主实跑通过。

登记首红：`bun test --max-concurrency 2 src/main/gate-file-registry.test.ts` exit 1（18 pass/5 fail；`registry-red.log`），指出两个已退役宿主、三个未登宿主及一条已删 cases 的源码锚。`chore(assembly)` 同笔删除两条退役 TSV 记录，登记上述三个新宿主（精确 wrapper count=1），移除 `source-text-anchors.ts` 中已删除 local-package-renderer.cases 的死记录，并同步 Hub pin/登记说明。`bun test --timeout 60000 --max-concurrency 2 src/main/gate-file-registry.test.ts src/renderer/extensions/hub-three-pages.test.ts` exit 0（24 pass/179 assertions；`registry-counts-green.log`）。没有跑 assert-gate-files 的全登记执行或 gate/bin/check。

AC-15 在组装树已关闭，无新增产品修补：保留的 `BC5 chat installs…` 原用例在任何改动前即 exit 0（1 pass/64 assertions；`ac15-assembled-red.log` 文件名保留为首轮采集名称，内容实际为 green）。r10 的原因是已解析的受管技能在旧显式路径窗口又被配置层加回；本次 base 已有 D/E E3 修正：`ext/plugin.ts` 的 skillAllowed 复用正向成员事实，post-activation tail 撤掉未允许技能，evaluate 在尾巴未安置时也拒绝，二者消费同一判定。临时仅将该判定改为 true、原字节 finally 恢复：同一保留用例 exit 1，15 秒后仍报 OpenCode skills off，账本 disabled/允许集空但技能可见（`ac15-membership-negative.log`）；恢复后 exit 0（`ac15-restored-green.log`）。这证明闭环来自既有 D/E 正向成员修正，而非改用例、重启或把重载空表当成功；没有把“显式文件去抖期暂留路径”当作须另造配置写方的问题。BC5 完整严格五例宿主在 main 相关集通过，聊天/folder/Git 的启用、真实 skill 工具读取、关闭后拒读、重开与移除均仍按原断言。

环境差异另行归因，不改产品／断言：main 相关集首跑 894 pass/1 fail（`main-related-first.log`），唯一红是 D/E package-effect 宿主，内部两个 Playwright 场景 spawn_failed。临时 npx stderr 包装器记录 `ENOTCACHED`，缺临时 cache 的 playwright-core 与 playwright `1.62.0-alpha-2026-06-29.tgz`（`effect-diagnostic.log`／`catalog-cache-diagnostic.log`）；正式目录实样命令固定 `npx -y @playwright/mcp@0.0.77`，不同于 A2 市场样本的 latest。仅向既有临时 cache 补原 URL 字节，并在 /tmp 以 ignore-scripts、联网填充该固定 CLI 的 `--version`（exit 0，0.0.77，`catalog-cache-prepare.log`）；最终检查均移除 PATH 包装器、offline 运行。未改版本、timeout、命令、项目文件或仓库依赖。

最终具名相关集合（日志统一 `/tmp/helper-install-r11/`；下列命令在对应包执行）：

- packages/ui-mac：`npm_config_cache=/tmp/helper-install-plan-YCXgtv/npm-cache npm_config_offline=true bun test --timeout 60000 --max-concurrency 2 src/shared/host-extension-package-contract/plugin-conversion.test.ts src/shared/host-extension-package-contract/host-extension-package-artifact.test.ts src/main/plugin-sources.test.ts src/main/install-from-source.test.ts src/main/install-from-source.engine.test.ts src/main/plugin-entrypoints.engine.test.ts src/main/plugin-package-accounts.test.ts src/main/created-plugin.test.ts src/main/created-plugin.engine.test.ts src/main/package-effect.engine.test.ts src/main/ext-package-ledger-v3.test.ts src/main/ext-receipt-v2.test.ts src/main/ext-set-state-tx.test.ts src/main/ext-package-ledger-uninstall.test.ts src/main/ext-write-channels.test.ts src/main/ext-install-planner.test.ts src/main/ext-skill-generations.test.ts src/main/ext-boot-reconcile.test.ts src/main/agent-md-entry.test.ts src/main/package-admission.test.ts src/main/package-admission.wiring.test.ts src/main/package-admission.parity.test.ts src/main/package-builders-wiring.test.ts src/main/package-mixed-bundle.wiring.test.ts src/main/package-secret-recovery-wiring.test.ts src/main/package-mcp-activation.test.ts src/main/package-mcp-oauth.wiring.test.ts src/main/package-mcp-oauth.engine.test.ts src/main/codepuppy-sidecar-messages.test.ts src/main/codepuppy-sidecar-wiring.test.ts src/main/mcp-server-truth.test.ts src/main/mcp-server-derivation.test.ts src/main/ext-config.test.ts src/main/codepuppy-config-injection.test.ts src/main/engine-explicit-config.test.ts src/main/config-injection-throat.test.ts src/main/ext-boot-safety.test.ts src/main/ext-session-grants.test.ts src/main/ext-uncurated-import.test.ts src/main/ecosystem-import.test.ts src/main/claude-plugin-intake.test.ts src/main/claude-plugin-import-matrix.test.ts src/main/local-package-channel.test.ts src/main/hub-view.test.ts src/main/factory-skills.test.ts src/main/codepuppy-skill-packaging-census.test.ts` exit 0（895 pass/0 fail，5891 assertions；main-related-final.log）。
- packages/ui-mac：`bun test --timeout 60000 --max-concurrency 2 src/renderer/extensions/ext-package-presentation.test.ts src/renderer/extensions/ext-ipc-chokepoint.test.ts src/renderer/extensions/use-extensions-ipc.test.ts src/renderer/extensions/hub-three-pages.test.ts src/renderer/extensions/plugin-source-results.test.ts src/renderer/extensions/package-account-dialog.test.ts src/renderer/extensions/hub-copy.test.ts src/renderer/codepuppy-ui/session-timeline/hub-install-card.test.ts src/renderer/codepuppy-ui/session-timeline/session-timeline.test.ts src/renderer/codepuppy-ui/session-timeline/timeline-model.test.ts src/renderer/codepuppy-ui/session-timeline/cards/tool-card-model.test.ts src/renderer/codepuppy-ui/session-timeline/cards/cards-contract.test.ts src/renderer/i18n/locale-regression.test.ts src/engine-adapter/mcp-auth.test.ts` exit 0（201 pass/0 fail，1772 assertions；renderer-related.log）。
- packages/ext：`bun test --timeout 60000 --max-concurrency 2 src/hub-tools.test.ts src/hub-bridge.test.ts src/context-injection.test.ts src/plugin-host.test.ts src/package-scope.test.ts src/gen-skill-paths.test.ts src/engine-transforms.test.ts src/policy/unattended-policy.test.ts` exit 0（181 pass/0 fail，1134 assertions；ext-related.log）。

以上是 A/B/C 与 D/E 的已列相关集合并集，已剔除已退役专测，不是全仓套件。初始／最终两包各 `bun typecheck` exit 0（`{ui,ext}-types-{first,final}.log`）。r7/r9 旧 namespace desiredState、locale 扫描、host count、cloud 空 editor 的已知前提均在本次相关集合通过，未恢复旧运输、修改断言意义或新增限制。真实联网查找的自然语言选择、GitHub 真实账号只读任务、Supabase 浏览器登录、时间线输入与管理同身份的构建应用屏幕证据，仍由编排器按既有 D5 验收材料收集；本轮没有登录账号或外部写入。

本轮新提交只作 assembly 元数据收口：scripts/gate-files.tsv、退役源码锚记录、Hub count pin 与本计划；其余修改均在原 replay 提交中解决，D/E 共享文件已逐行列上表，未改 Core。已核 Codex（GPT-6）作者自查，组装相关自动证据 DONE；依据仍 spec v3/design v5、r11 裁定，已定勿重开不变。遗留去向仅上述真实应用验收→编排器；OPTIONAL 无。文档链接／diff／独立 registry 的最终收据在提交前核验。

最终收口检查：独立 `bun test --max-concurrency 2 src/main/gate-file-registry.test.ts` exit 0（23 pass/176 assertions；registry-final.log）；`python3 scripts/check-doc-links.py docs/specs/plugin-helper-and-hub/plan.md` exit 0（7 个相对链接），`git diff --check` exit 0；AC-15 cases 与原 979fe21266 的文件 diff 为零，临时 mutation 无残留。`1ac2e61d8b` 是 HEAD 祖先，28 笔 replay 完整保留；另以一个 chore(assembly) 提交收口。所有前台命令完成，无 gate/bin/check/push/PR/merge 或真实账号动作。

r12 代码审查处置（2026-11-16 13:27:38 UTC 开始）：独立一轮，Claude Opus 5.5 只读审查 `origin/alpha@23546fd5b1...6377955826`；part A/B 均 FIX-THEN-MERGE，编排器采纳 A1–A10/B1–B12，原报告为 session-f35ed133 的 r2-findings-A.md、r2-findings-B.md。按 r12 顺序逐项核前提、红例先行，修正仍消费 spec v3/design v5，不重审既定决定；part C 待下一续派，不计本轮已收。

B1 前提属实：原 hub-install-ask 的三条 proof 名与 hubInstallEvaluate 均已退役，登记未同步。先行原有行为闸 `cd packages/ext && bun test --max-concurrency 2 src/policy/authority-registry.test.ts` exit 1（4 pass/1 fail，三条 test not found，`/tmp/helper-install-r12/b1-red.log`）；现有已提交闸就是本项红例，不另造只测文案的测试。已读 ADR-048 决定 3/4，随后按其 retired.quote/date/by 形状保留旧条目，并登记仍在役的 automation deny/ordinary tier/main ID 权威与现有真实正反例。

B1 FIXED：旧条目保留并按 ADR-048 写 retired.quote/date/by（原话、2026-11-16、Codex/GPT-6 与编排器）；新增 chat-install-main-owned 在役条目指向现有 ordinary allow/ask、automation deny、main 未发行 ID 无写入的真实测试。`cd packages/ext && bun test --max-concurrency 2 src/policy/authority-registry.test.ts src/hub-tools.test.ts src/plugin-host.test.ts` exit 0（58 pass/269 assertions，`b1-green.log`）；原红闸未改。登记没有将安装交回上游默认，也没有恢复确认面。

A1/B5 红例前提核验：真实 main IPC 把 convertCandidate 与 activateMcp 都放在 root recovery mutex 中；sources 的 get 没有 abort，查询同名比较还在所有源结果后串行下载；resource 直接跟原始输入，bridge search 复用 20s。新增真实主 IPC 两例分别悬置捕获／运行时边界，期间普通 reload 写通道须仍可受理；新增真实 fixture 来源三例测单 fetch abort、整源期限（含目录 callback）、同名 archive 比较失败隔离；DOM 测初次查询立即、连续输入合并；bridge 测普通读仍 20s、search 不被该预算截断。命令在 ui-mac `bun test --max-concurrency 2 --test-name-pattern '^R12' ./test-component/ext-install-catalog-result.cases.ts ./test-component/plugin-source-results.cases.ts` exit 1（3 fail，a1-lock-b5-dom-red.log）；sources 同筛选三例 exit 1（a1-b5-sources-red.log），ext bridge 同筛选 exit 1（b5-bridge-red.log）。来源字节均来自原 provenance 夹具；受控 Promise 只模拟应用网络/引擎边界，没有手造第三方格式。

本步计划值：单请求 10 分钟、整源 15 分钟、search bridge 20 分钟；普通 bridge 20 秒保持，初次搜索不去抖、连续输入 250ms。审查留证最大真实下载 25.8MB、约 300s；请求预算为该观测上界两倍，整源额外留比较/分页空间，bridge 再留消息返回空间。它们不是等待阶段，正常请求立即返回；命中只标该来源 failed:network，其他来源仍显示。共享时间常量由同一个 shared 文件持有，不加产品选项。单次转换与目录身份下载在锁前预热，锁内重读同一 main 缓存；运行时连接在统一提交返回、root mutex 释放后完成。

A1/B5 FIXED：main 单例在恢复写锁前预热同一候选转换及目录身份下载，锁内仍通过原 candidateId/缓存重读；创建输入也在锁前准备，并保留 project 身份的前后复验。统一 source entry 在提交释放后完成 runtime MCP 接入/技能重载，聊天、Hub 包行和候选通道共用；包根开关与令牌保存的 MCP 接入也移到锁后。未改旧 catalog primitive 的 scope/授权合同。来源请求含 abort 和 10 分钟期限，源级 15 分钟覆盖 callback/分页/比较，过期停止该源分页、标 failed:network，保留其他结果；搜索消息单独 20 分钟，普通读仍 20 秒。时间常量同源于新增 shared/plugin-source-timing.ts（main/ext 两消费者所需，避免复制预算），无产品选项。

原 6 条 red cases 未改断言，`cd packages/ui-mac && bun test --max-concurrency 2 --test-name-pattern '^R12' ./src/main/plugin-sources.test.ts ./test-component/ext-install-catalog-result.cases.ts ./test-component/plugin-source-results.cases.ts` exit 0（6 pass/13 assertions，a1-b5-new-green.log）；ext bridge 全部 8 pass（b5-bridge-green.log）。私有 WeakSet 仅保留 timeout 出错来源，不在冻结 wire 上加字段；索引已查询但比较内容未收录于裁剪 fixture 的情况仍不伪装成整源未查询。旧过期响应 DOM 例仅等到去抖后的第二查询真正发出，再保留全部原断言；IPC 宿主实跑 18、搜索结果宿主实跑 7 并同步 pin，子命令并发 2。

相关 main/UI 九文件命令（plugin-sources/install-from-source/ext-write-channels/plugin-package-accounts/codepuppy-sidecar-wiring/codepuppy-sidecar-messages/plugin-source-results/hub-three-pages/use-extensions-ipc，--timeout 60000 --max-concurrency 2）exit 0，109 pass/620 assertions（a1-b5-related-final.log）；真实引擎 plugin-entrypoints/created-plugin/package-effect 三宿主 exit 0（严格内部 5/1/5，a1-b5-engine.log，使用已留临时 offline npm cache）；ext hub-bridge/hub-tools/plugin-host/context-injection/authority-registry 五文件 exit 0，109 pass/889 assertions（a1-b5-ext-related.log）。两包 bun typecheck exit 0。A2 的解压同步/资源上界另按下一步处理，不把它报已修。

A2 前提属实：readArchive 直接 gunzipSync，get 无字节上界。三条真实市场/tar 受控变体红例：声明超大 content-length、未声明而流式附加 gzip 允许的零填充、原生异步 gunzip 的 maxOutputLength/overflow 传播；压缩/清单前缀仍来自固定样本，原生边界测试只将测试里的 zlib 上界调低以避免分配 512MiB。`bun test --timeout 60000 --max-concurrency 2 --test-name-pattern '^R12 A2' src/main/plugin-sources.test.ts` exit 1（3 fail，a2-red.log），旧实现把超大捕获仍报 source ok、未调用异步 gunzip。

A2 预算取下载 128MiB、解压 512MiB：对审查记录的最大 25.8MB 压缩库分别约 5 倍和 20 倍（解压还留更多余量），对已捕获 npm 正向样本 0.3MB 更高三个数量级；普通技能/MCP 包、已核市场均远低于它们。不限制候选/技能/包数，不删任何可安装类型；命中只令该来源 failed:format，其他结果保留，异步解压不阻塞主进程事件循环。

A2 FIXED：get 同时核 content-length 与真实流式计数，128MiB 以上立即取消 body；没有完整缓冲后再检查。gzip 走异步 gunzip，maxOutputLength=512MiB，原生 ERR_BUFFER_TOO_LARGE 转为该源 failed:format；私有失败 provenance 改用 WeakMap 保留 network/format，不改公开错误字段。原三条红例未改，a2-green-first.log 3 pass/10 assertions；四文件 plugin-sources/plugin-conversion/host-extension-package-artifact/install-from-source 94 pass/599 assertions，exit 0（a2-related.log）。两包 bun typecheck exit 0（a2-{ui,ext}-types.log）。没有新增产品限制、确认或依赖；未执行下载内容。

A3 前提属实：SourceChanged 只删 capture，不删 marketplace index 或 main archive。真实 manifest 的 description 作一次显式 stale 变体、实际 tar 保持 pinned 原字节，重搜应拿到更新后的真实 index 并重取 archive；`bun test --max-concurrency 2 --test-name-pattern '^R12 A3' src/main/plugin-sources.test.ts` exit 1（1 fail；a3-red.log），旧缓存第二次仍报 source-changed。红例断言原输入格式不改。

A3 FIXED：SourceChanged 同时淘汰该市场 index、市场 refs/heads/main archive；外部 Git 源还淘汰本次实际 revision 的错误 archive。第二次 search 读取当前 index，再次捕获核同一已验提交，不需要重启。完整 plugin-sources.test.ts exit 0（34 pass，a3-green.log），原重试红例不改断言；未给缓存新增 TTL/容量或改 source-changed 错误合同。

A4 前提属实：重复运行身份分支在比较 effect 前就返回 alreadyInstalled。同一技能包 project A→all→project B 的红例 exit 1（a4-red.log）；真实 MCP 同一包从 A 扩至 all，B 已加载 Location 在 15 秒后仍无 browser_close，exit 1（a4-engine-red.log）。两例均保持包身份单一、物理全局与项目文件零改动，未改变已有 scope 断言。

A4 FIXED：同一运行身份且 effect 相等才返回 alreadyInstalled；effect 不同复用原包 id 走更新，沿用既有全局物理安装、项目逻辑 effect、声明与运行时接入。unit 相关集 exit 0（a4-unit-green.log）；真实 package-effect/plugin-entrypoints 两宿主 exit 0（内部 5/5，a4-engine-green.log），两 Location 扩至全局/缩回项目均实测工具库存。连续更新后旧 close 调用仍保持，在调用前显式等 A 的工具库存恢复，以覆盖真实配置去抖窗口而非把瞬时断连当稳定态；首轮该窗口日志保留于初次输出。未改行为断言。ui-mac bun typecheck exit 0（a4-ui-types.log）。

A5 前提属实：仅 OpenCode 单数目录有 discovery。补充 pr-review-toolkit 的真实 commands/agents 与 manifest（来自原完整 codeload、pax comment 与原固定 b5b01ac4… 提交相符）；provenance 逐文件 digest 与 selection archive 同步，未手造格式、未执行 hook。Claude 原树及同字节 Codex 来源受控变体保留六 agent/一 command，既有 explanatory-output-style 保留 SessionStart hook；main nothing-runnable 具名原因且零账本写。两红例 exit 1（a5-red.log），原 converter 均漏项。

A5 FIXED：三生态复用 Markdown agent/command 解析，Claude/Codex 的标准复数目录得以具名；hooks/hooks.json 的命令事件转换成 Hook entry，默认字段沿既有提供方合同（UserPromptSubmit 30 秒，其余列明事件 600 秒），此增量仍不执行 hooks。现有 install entry 将不支持的 entry 映成 kind-not-supported-yet，hooks-only/commands-only 均有原因且不写账本。生成 converter ESM 与 artifact 清单，未改发布 schema；四文件 converter/artifact/sources/install entry exit 0（98 pass/638 assertions，a5-related.log），ui-mac bun typecheck exit 0。真实夹具新增 1,300 余行均为固定上游字节，产品改动约 30 行；非扩大运行范围。

B2 前提属实：!pack 无条件轮询、无包无阶段按 installing 展示。生产 DOM 红例覆盖失败后重启/已装后移除，结束工具结果须可见且轮询读数不再增长；exit 1（b2-red.log）。

B2 FIXED：轮询仅在 submitted 或工具仍 running 时继续，failed 阶段不轮询；已结束且包不存在时只显示工具结果，不再伪装正在安装/生效。正常 pending 仍由原 running 轮询与主视图通知更新。原 DOM 红例未改，卡片/timeline model/registry 三文件 exit 0（97 pass/474 assertions，b2-green.log），卡片内部实跑 11，host pin 与 TSV 说明同步。

B3 SEAM-CHANGE-NEEDED（设计 §4.6 冻结侧车读合同）：已核 ext/hub-bridge.ts:47–56 仅 view/search/install/request，无包授权读；ui-mac/codepuppy-sidecar-messages.ts:32–50 的 authorization 仅 none/secret:<变量>/platform-login，HubRequestRecord:70–75 也无授权事实。main 的实际 saved/authenticated/status 由 package-admission.ts:468–483 计算，经 ext-ipc.ts:350–353 的 renderer-only ext-package-authorization 返回。现有 ext 终读无法区分令牌未存、登录未就绪与普通 MCP 启动失败，不能猜测这些状态或解析引擎错误词冒充专用存储事实。最小请求：在 §4.6 允许只读侧车 packageAuthorization(packageId)，复用现有 PackageAuthorizationResultV1 安全投影及 readPackageAuthorizationV1（无凭据值），build/parse 成对；无新写面/确认/权限。该接缝未获冻结合同 delta 前在 B3 边界收口，未新增运输或改合同。

本次 r12 边界：B1、A1/B5、A2、A3、A4、A5、B2 已修；B3 等只读接缝；B4、B6、A6–A10、B7–B12 尚未开始，不冒充反证或已处置。后续仍按原顺序，B12 的生产 DOM 与两项 recorded verify 均未完成。

r12 遗留（记录去向，无本轮旁修）：
- A recorded：plugin-sources.ts 的 archive/capture bytes 保留整个应用运行期 — 依裁定仅记录，去向编排器。
- A recorded：applyPackageMcp 使用 workspace 而非请求 Location — 依裁定仅记录，去向编排器。
- A recorded：runtime {file:} 未 trim 与引擎处理不同 — 依裁定仅记录，去向编排器。
- A recorded verify：official connector 取消 connectorChange restart 后须补真实引擎验证 — 尚未执行，随 B3 后续步骤继续，不先恢复 restart。
- B recorded：Registry GitHub 无 get-token 链接，现有 SecretNeed 无 URL — 依裁定仅记录，去向编排器。
- B recorded verify：folderSelections 入口是否不可达，核 public folder 合同与实际调用再删 — 尚未执行，随后续继续。
- B recorded：automation deny 的普通 Error 无 unattended-denial metadata — 依裁定仅记录，去向编排器。
- B recorded：pending 卡片每秒 hubView 重算 — B2 已将轮询约束到 submitted/running；无额外重构。

r12 本边界最终检查（日志 /tmp/helper-install-r12）：复跑上列 r11 两 lane 的明确相关命令并集，main 46 文件 exit 0（905 pass/5948 assertions，main-related-partial.log），renderer 14 文件 exit 0（201 pass/1772 assertions，renderer-related-partial.log），ext 8 文件 exit 0（182 pass/1138 assertions，ext-related-partial.log）。其中真实引擎使用已准备的临时 offline npm cache；不是未准备缓存的联网替身，未用 PATH wrapper。A5 converter/artifact/sources/install entry 四文件另已 exit 0（98 pass）。两包 bun typecheck exit 0（{ui,ext}-types-partial.log）。独立 authority-registry 5 pass exit 0、gate-file-registry 23 pass exit 0（authority-partial-final.log、registry-partial-final.log）；计数 pins 为实际子例 18/7/11，登记无增漏。所有测试命令均 --max-concurrency 2，无 gate/bin/check。文档链接 7 个均存在、git diff --check exit 0。

已核 Codex（GPT-6）作者自查；本轮约 52 分钟，完成八项（A1/A2/A3/A4/A5、B1/B2/B5），在冻结 B3 读接缝处返回，其他事项没有改变断言或擅自提前修复。每项红命令 exit 1 与 green 结果见本节，红例仍保留；记录项目均标去向。真实构建应用/真实账号验收仍交编排器，未执行登录或外部写入；没有 push/PR/merge。OPTIONAL 无。


r13 审查续修（2026-11-16 14:22:29 UTC 开始）：已完整读取 part C，范围仍为 origin/alpha@23546fd5b1...6377955826，Claude Opus 5.5 一轮只读；编排器采纳全部 C1–C9 及 cheap OPTIONAL evidence fixes。r12 已修八项不重审，仅按本轮搜索期限裁定修正 A1/B5。

偏离记录·编排器批准接缝 delta（r13 决定 1）：§4.6 侧车新增一个只读 packageAuthorization(packageId)，main 仅接受账本存在的包，复用 renderer 所用 PackageAuthorizationResultV1 安全投影；只含状态/身份/标签，不含值、路径或 raw declaration，build/parse 成对并拒绝坏输入。设计 §4.6/§10 由编排器按变更程序落档，本 lane 不改设计。

B3/C1 红例：恢复 committed+pending/not-loaded/空视图、partly-running、already-installed、login/token、saved-token 的模型结果表；恢复 status 的三种 cloud reason、priceNote 原样与 warning 隐藏。B3 补桥往返/坏投影拒绝、生产 main 对已存在/不存在包授权读。C2 同笔将 canary 聊天请求改为已持有该密钥的 canaryEntry.id，原 args/result/asks/wire/toSidecar 零命中与秘密文件正命中断言不减。ext 两文件 exit 1（b3-c1-red.log）、main message/生产 canary 过滤例 exit 1（b3-main-red.log）；前者因缺 login/token 与新桥方法，后者因缺合同构造器/读口。原仍有效 C1 控制在现实现已绿，恢复后能守住删除分支的回归。

B3/C1 代码边界：实现 ledger-bound packageAuthorization 只读侧车问答，main 复用原 readPackageAuthorizationV1，构造器仅投影现有字段，parser 拒绝未知字段/坏形状；main 存在性检查先于授权读。ext 在同一 packageId 终读状态，区分 needs login/needs token。C1 恢复表与 status 证据：ext tools/bridge/authority-registry 三文件 exit 0（35 pass/112 assertions，b3-ext-boundary.log）；临时把结算一律改成 installed; available，原八条结果表中七条 exit 1（c1-availability-mutation.log），finally 恢复原字节。main codec/接线/Hub 三文件 exit 0（b3-main-contracts-green.log）；生产 IPC 除下述 canary 的其余 17 例 exit 0（b3-main-other-cases.log）。两包 typecheck exit 0（b3-{ui,ext}-types-final.log）。新增 required read seam 的现有 host 夹具补齐依赖，包括 unattended-run.engine.cases，不改原断言。

BLOCKED · 本 lane 新增行为断言前提错误，需编排器裁定：test-component/ext-install-catalog-result.cases.ts:433 在 C2 原用例里额外要求 packageAuthorization(canaryEntry.id).items[0].saved === true。该前置安装用的是旧 ext-install-catalog primitive（同文件 installTwice 与 :418），不是同一个已安装包的授权事实；原 readPackageAuthorizationV1 经 resolveInstalledPackage/resolveAcceptedPackage 需要包声明与已验 catalog snapshot，现夹具无 snapshotDigest 且只有 entries。保持现有 renderer 安全投影，实际返回 {ok:false, reason:"package admission: verified Catalog snapshot digest unavailable"}（b3-main-boundary.log）；不是侧车传输损坏。该额外断言超过 C2 的 canary 包输入/零泄漏/磁盘正命中要求，亦非 API 返回类型或 arity 误用，不能援引 standing ruling 自改已提交行为断言。建议允许撤去这条额外 saved:true 断言，B3 的正向授权投影另用当前声明包验证，C2 的 args/result/wire/toSidecar 零命中与磁盘正命中、canaryEntry.id 输入全保留。此前为满足它扩出的原生目录读／重复安装分支均属本 lane 未提交改动，已 scoped restore；没有为错误测试补旧记录兼容或复制身份权威。

边界实报：含 canary 的 ext-write-channels 宿主仍 exit 1（52 pass/1 fail，b3-main-boundary.log），C2 原末尾磁盘正命中在额外断言之后，尚未完成本次绿证，不报 FIXED。B3 已实现、C1 的正反控制已恢复，整体步骤未验收。A1/B5 的 30 秒/逐源显示裁定、A6–A10、B4/B6–B12、C3–C9/OPTIONAL 与 recorded verify 本轮尚未开始；C3 唯一授权 assert-gate-files.sh --update 留到恢复其余项后的最终收口，当前未运行，旧 exact counts 尚未写回。无 gate/bin/check、无 push/PR/merge、无账号登录或外部写入。

本边界独立 gate-file-registry exit 0（23 pass/176 assertions，registry-boundary.log），仅证明登记存在性，不冒充 C3 exact counts 通过；文档 7 链检查/diff check 均 exit 0。C1 结果表与状态控制已核 Codex（GPT-6）；因本 lane 额外 committed red 的前提问题按原规则返回 BLOCKED，所需输入是上述窄断言裁定，不需要放宽产品合同。全部前台进程已结束。


r14 续修（2026-11-16 14:37:00 UTC 开始）：编排器 r14 决定 1 允许撤去本 lane 在 r13 添加的 canary saved:true 额外断言；决定 2 扩大 own-assertion correction ruling，仅针对 r12 起本 lane 自增且前提/字面量/调用形状错误的断言，仍不改 AC/审查所需证明或 r12 前断言。该项独立提交，非放宽产品授权读。

own-assertion corrections：ext-install-catalog-result.cases.ts 原 :433 saved:true 假定旧 primitive 条目已具当前包声明；package-admission.ts:450–465/792–805 的现有读取需已验包 snapshot，该夹具无，r13 反证输出已记录。按 r14 明确裁定删除该额外断言，保留 canaryEntry.id、args/result/asks/wire/toSidecar 零泄漏和磁盘正命中原断言。另加 R14 B3 正向生产链：真实固定 Registry GitHub 定义经当前 source entry 安装，读取与 renderer 完全相等，专用存储保存后 saved:true，同双向消息无 token/路径/声明；不存在包仍拒绝。B3/C2 FIXED：ext-write-channels + sidecar-messages 两文件 exit 0（28 pass，内部实际 19；b3-c2-green.log），pin 同步 18→19，C2 磁盘正命中现已执行。没有旧记录迁移/兼容或新增 native 读权威。

A1/B5 deadline ruling 红例：真实来源 context7 在 Codex index 悬置时，main 须先发 Claude 候选、30 秒内最终报告 Codex failed:network；生产 DOM 须在悬置未解时已有可安装行；main IPC 进度须只发给请求 sender 并携带关联 ID。三例 exit 1（deadline-red.log），现有全源 Promise.all/长预算/无进度运输分别被击中。搜索私有进度只复用 SourceSearchResultV1 快照，不更改候选或安装合同。

A1/B5 deadline ruling FIXED：search 每源 30,000ms（包括比较），chat bridge 40,000ms 仅留 10 秒运输余量；普通读 20 秒保持。capture 单请求 10 分钟、下载 128MiB/解压 512MiB 保持。实测固定索引：Claude 191,699B、Codex 18,951B、Registry GitHub 查询 1,542B、npm 查询 17,004B；30 秒远高于这些小响应的正常处理时间。Hub 进度按 source 完成即时发布，仍由 main 铸 candidate/searchId；私有 renderer correlation id 只关联进度推送，发送对象仅本次 event.sender，不是安装身份。preload/extIpc 同一路径订阅后再 invoke、finally 退订；组件按查询/代次拒过时快照，原 250ms 输入去抖保持，未回答完不宣称无匹配。比较在来源到达时并行做已知身份比较，30 秒到时未完成的候选保留未折叠；提交前防重不变。选择候选后的捕获超过 60 秒仍可完成，有专门正向证明。

原三 red 未改，主 sources/生产 DOM/IPC 新例 exit 0（deadline-new-green.log）。真实 ext tool + bridge × main sources 的聊天悬置源例在 30 秒假钟内返回 failed:network，未被桥截断，bridge 全部 10 pass（deadline-chat.log）。六文件 sources/install-from-source/ext-write-channels/source-results/hub-three-pages/use-extensions-ipc exit 0（95 pass/467 assertions，deadline-related-final.log；IPC 内部 20，来源 DOM 内部 8，pins 同步）；ext tools/bridge/plugin-host 74 pass exit 0（deadline-ext.log，新增聊天例另已过）。两包 typecheck exit 0（deadline-{types,ext-types}-final.log）。共享编辑区域：plugin-sources 的 search 与 shared timing、ext-ipc 只读查询、preload/index/types、extension-hub 搜索调用、source-results 呈现；未改 D/E 制作或 scope 行为、未改 Core。

B4 前提属实：实际 runtime-loaded customize-codepuppy 的 description 与第 4 项仍教 type=mcp 注册及项目连接器。先将既有 runtime 指令守卫中被本 AC 替换的旧等待句去掉，加入 MCP 注册反控制和 this-project 托管路由正控制；命名 #1532 AC5 两例 exit 1（b4-red.log）。这是运行时技能内容回归，另对实际 SKILL.md 工件逐段检查，不拿普通 docs 的标题/措辞计数作产品证明。

B4 FIXED：实际出厂 SKILL.md description 不再声称创建项目连接器，第 4 项删 type=mcp/额外连接器等待指引，第 2 项明确 hub_install scope:this-project，项目位置表不再教项目连接器配置。工件实读保留 agent/command/skill 原用途及既有插件信任边界；没有封禁旧通用 register 工具或增授权面。factory-skills/packaging-census 两文件 exit 0（b4-green.log），原 #1532 新反控制未改。

B6 前提属实：prepare 的 hostname===github.com 排除了既有 validGitUrl 的另四个 forge。额外核同链 cloneSkillGitToTmp：它还要求根/唯一子目录有 SKILL.md，不能直接承接整包 MCP；其旧唯一子目录技能能力须保留在共享 converter 发现方，不能通过复制识别规则修补。三条 red（四主机复用真实固定 Playwright 树、实际 Hub Git 错误呈现、真实技能字节的旧单子目录变体）exit 1（b6-red.log）。clone 边界只模拟 git 的进程 I/O；不声称所换主机上的镜像实际存在，不进行外部写入。

B6 FIXED：非 github.com 地址走既有 validGitUrl/cloneSkillGitToTmp（原 allowlist/subdomain/redirect/进程参数策略原样），捕获整个临时仓库后 prepareCapture，finally 清理；GitHub codeload 现有入口保持。clone 不再技能专用定位；原唯一子目录技能布局由同一共享 converter 增补发现（仅无 manifest 的单 loose SKILL），没有第二份格式判断。该必要同链文件 ext-fs-installer 与 converter/artifact 已列；无额外参数/选项/依赖。真实固定 Playwright 的四 forge 路由、清理与转换后 MCP 安装均绿；非法 localhost 未进 clone。Hub Git/文件夹失败按操作类型取 i18n，不外发 main detail。

六文件 ext-write-channels/ext-import-validate/ext-uncurated-import/hub-three-pages/converter/artifact exit 0（104 pass，b6-final.log），ui-mac typecheck exit 0（b6-ui-types.log）。内部 IPC 21、Hub 34 的两个输出 pin 均按执行值同步；前两次仅漏改第二条机械 count pin 的失败已核，不改任何行为断言。三个原红例断言保留。共享文件 ext-ipc 仅 prepare 分支、extension-hub 仅 prepare 错误、locale 新两键、converter 唯一发现方；未改 Hub 管理页、scope 或 Core。

A6 CONTRARY EVIDENCE：给定 whole ${VAR} URL 在当前生产链已在写前拒绝，未改生产。真实 Context7 配置只替换 URL 为 ${WHOLE_URL} 并显式 oauth:false，新用例首跑即 exit 0（a6-red.log 名沿采集，实际 1 pass）；结果 transaction-failed、records/graphs 空、remote leaf 不存在。ext-package-tx-builders.ts:403–405 已有 validateServer(config)，ext-config.ts:299–305 通过 classifyBaseUrl:new URL 拒该地址；blame 分别 7b9a20cec8c/ad386420617，均早于审查范围。临时只撤去这道 builder 校验，原用例 exit 1 且出现 committed MCP record（a6-guard-mutation.log），finally 原字节恢复。因此不会为未复现的前提再叠 invalidMcpServerRecord 门或改变合法来源能力；保留反证回归，交编排器据此关闭/修正 finding。

A7 前提属实：catalog helper 与主 entry 锁后回调均只看 skill。派生自既有 mixed-bundle 生产方语料的单 agent/单 command 两臂，以及真实随包 agent:code-reviewer 的完整 main IPC 一臂，安装成功后都无 reload；三例 exit 1（a7-red.log）。后者同时断言非 force，保留 MCP/cloud 即时路径。

A7 FIXED：catalog helper 与 main 锁后生效均为非 MCP/非 cloud 内容请求原 non-force reload，故 agent/command 不再漏调度；MCP 仍 runtime add/connect。三个原红断言保留，install-from-source/ext-write-channels/package-command-engine-visibility 三文件 exit 0（a7-green.log，含真实命令可见与执行宿主），ui-mac typecheck exit 0（a7-types.log）；IPC 内部实跑 22，同步 pin。

A8 前提属实：任一 strict V3 失败使整段 disabled 注入跳过。两个真账本 red 从实际 applyPackageMutation 生成项目包，再分别加入不可归属坏 record／破坏 claims 不变量，已关远端和仅项目远端都被错留 enabled；exit 1（a8-red.log）。应保留 readLedgerV2 的可读记录；graph 不可用时复用 skills-enabled v2 正向成员投影的现有唯一读方，不另解账本或复制项目判定。

A8 FIXED：disabled 循环恢复只读 readLedgerV2 的已解记录；strict graph 不可用时项目 MCP 集合回退到既有 readPackageAllowSet 的 v2 scoped 投影，正常图仍读 strict state。账本与项目投影单一写/读权威未改、无原始 JSON 二次 decoder，注入不改损坏文件。两个原 red 保留，disabled-injection/config-injection/boot-safety 三文件 exit 0（a8-green.log），ui-mac typecheck exit 0（a8-types.log）。

A9 前提属实：renderer source 写口可递交 created 与 project effect；两条完整 main IPC red 使用全源已查询记录、真实技能字节的自制草稿与真实目录项，旧 handler 都接受，exit 1（a9-red.log）。拒绝范围只落 renderer handler，sidecar/common entry 保留制作/项目 scope；无用户能力收窄。

A9 FIXED：renderer handler 在任何准备/写入前拒 created 或非 all-projects，via 由主进程写为 hub；共同 installFromSource 与 sidecar 不改，制作和逻辑项目 scope 仍走聊天。原两 red 保留，ext-write-channels/sidecar-wiring/install-from-source 三文件 exit 0（a9-green.log），ui-mac typecheck exit 0（a9-types.log）；IPC 实跑 24，pin 同步。

A10 前提属实：catalogComparisons 只消费上次 search 的 catalogRows；没有 search 或上次目录失败就返回空。三 red 覆盖两种前提及请求级准备缓存（同请求锁内复用、下一请求必须重新读目录），exit 1（a10-red.log）。直接改成每次调用都联网会回退 A1；本步以既有 requestId 为私有比较缓存键，查询使用 searchId，准备时读 deps.catalog 当前事实，提交复用同一准备 Promise。不是产品选项，不改冻结 DTO/安装入参。

A10 FIXED：catalogComparisons 从 deps.catalog 当前已验目录取得表，不再依赖 catalogRows；查询与安装分别用既有 searchId/requestId 固定本次比较准备 Promise。main 锁外预热与 entry 锁内比较传同一 requestId，因此仍无目录联网进入写锁，下一请求重新取目录。catalogPackage 身份仍复用既有 id@version 校验，不复制身份算法。三条原 red 未改，sources/install-from-source/ext-write-channels 三文件 exit 0（a10-green.log），ui-mac typecheck exit 0（a10-types.log）；额外同链修改 install-from-source/ext-ipc 仅传入已存在请求身份，不改公开 DTO 或 scope。

C6/C8/C9 FIXED（仅证据，无产品分支改动）：C6 在既有 converter provenance loop 校验 npm 五文件与 local-config.jsonc 的 bytes/sha256；根 provenance 补 fetchedAt=2026-11-16（原完整 codeload 本机创建日期同日，未虚构精确时分）。C8 卡片 harness 的 installFromSource/installCatalog 实际边界记录调用，登录/令牌后由零 calls 替换自持数组长度控制；包身份断言仍在。C9 不完整搜索的原拒绝用例增加整个 h.temporary 的递归路径/内容 digest 前后快照，旧 ledger/ext-store 断言保留，覆盖 CAS 及其他持久位置。

逐项负控制：只给 npm metadata 加一个换行→digest 例 exit 1（c6-digest-negative.log）；临时在卡片 login 中插入真实 extIpc.installFromSource 调用→零写调用断言 exit 1（c8-install-negative.log）；临时把 search 完整性门挪到 CAS 提升之后→全树快照在新增 CAS 节点处 exit 1、旧两路径断言仍过（c9-cas-negative.log）。全部 finally 原字节恢复。四文件 install-from-source/converter/artifact/hub-install-card exit 0（c6-c8-c9-green.log）；不把本来绿色的实现报作新产品修复。

C6 新核数据补充：npm empty-search.json 的真实记录是 286,376B，高于 r13 brief「最大 pinned index 不足 200KB」的前提；它被 fixtureFetch 变成无匹配受控页时响应较小。上段列举的四份索引尺寸仍正确，固定原样本最大现应按 286,376B（约 280KiB）报告，30 秒查询预算仍留充分余量。仅事实更正，未改期限裁定或编排器设计。

B10/B11 前提属实：errored hub_search 仍生成 searching 行；空查询的真实固定市场有超过 25 个 Claude 候选，工具无裁剪原样 JSON 输出。两个命名 red 分别 exit 1（b10-red.log、b11-red.log）。B11 仅模型输出取各源前 25 个，完整 main 结果与 matched/skipped/失败状态保留，Hub 仍全部可见/可安装；不是包/用户数量限额。

B10/B11 FIXED：error search 回到普通工具的真实错误呈现，不再保留搜索卡；模型候选每源前 25 个，保留原 main 结果和各源完整状态/计数及 searchId，Hub 不裁剪。25 是模型列表预算，具体目标样本通常只命中少量，宽泛/空查询的完整目录仍能在 Hub 或按目标查询获得；无插件内容/安装数量限制、无新参数。timeline-model 74 pass exit 0（b10-green.log），ext tools/bridge/plugin-host/authority-registry 81 pass exit 0（b11-green.log），两包 typecheck exit 0。两个原 red 均未改。

B12 VERIFY→REPRODUCED：生产 Hub 非搜索 mcp:fetch 添加实际打开旧确认框并显示「未经审核,装好后默认关闭」（b12-catalog-red.log exit 1）；第三方真实 Claude 候选的 + 单独宿主首跑 exit 0（b12-third-party-first.log）。初次把两个 DOM cases 混在一个子进程引起 delegated-event 宿主冲突，已按各自既有独立 host 单跑确认，不改断言。修正只把 MCP/bundle 的新增安装调用接到既有 ext.installPackage→统一 main entry，借此退役 + 的旧确认调用；既有更新/权限流程不动，不删除仍供它们使用的 locale/authority。

B12 FIXED：MCP/bundle 的新增目录添加（含详情安装按钮）调用既有 ext.installPackage 适配到统一入口，不再触发旧安装确认，故 + 上不会显示默认关闭文案。没有删除仍供既有更新/审批流程使用的 locale 权威，也没有把它们放宽；真实已装状态仍由原读方呈现。目录/第三方两个 DOM 断言保留，四文件 Hub/source-results/use-extensions/chokepoint exit 0（23 pass，b12-green.log，内部 35/9），ui-mac typecheck exit 0（b12-types.log），pins 已同步。共享 extension-hub 仅添加调用适配，未另建管理或账户页。

B8 前提属实：host.submit 只记 submitted，不含 main 已知名称。真实目录/Claude 候选两臂在 runtime 暂停期间读阶段，期望主表 displayName（并确认它不是 id），均 exit 1（b8-red.log）。不让 renderer 从输入猜名字，沿冻结 HubRequestRecord.displayName 现有字段补值。

B8 FIXED：source table 提供只读 displayNameForId（捕获包在既有转换时记其真实名），host 从 main 表/随包目录取名或自制草稿名，在 submit 即写现有 displayName 字段，失败终态也保留目标名。无新侧车字段或 renderer 猜测。两条原 red 保留，sources/hub-view/sidecar-wiring/ext-write-channels 四文件 exit 0（b8-green.log），ui-mac typecheck exit 0（b8-types.log）；IPC 内部实跑 26，pin 同步，现有 fake host 补必需 name 读方（含 unattended fixture）。

- r14 B7 FIXED：统一搜索继续呈现按查询过滤的本地文件夹包、我的插件和用户助手，复用既有安装行/菜单；按 packageId 排除重复来源行，同名包不合并。红例 `review B7 one search finds own agents and local/created packages across tabs` 删除本地结果即 0/2 行；`bun test --max-concurrency 2 ./test-component/hub-three-pages.cases.ts` 36 pass、ui-mac typecheck exit 0。自身断言修正 `25dc6cc380`：新例的 120 ms 轮询短于既有 250 ms 防抖，保留无命中断言并等待实际查询。

- r14 B9 FIXED：搜索来源按 `reason`、安装结果按 `code` 映射中英文文案，文件夹安装失败同样消费代码；时间线未安装成功使用「未能安装」，已安装但运行失败仍保留实际运行状态。修改的是审核明确替代的原始英文断言，红例命中三处来源/候选/卡片；四个 renderer 相关宿主与 ui-mac typecheck exit 0（`/tmp/helper-install-r14/b9-green.log`）。

- r14 C4 FIXED：两个真实 Playwright 宿主从独有空 npm 缓存起步；每个公开包用空 npmrc、官方 registry、零重试、45 s 请求/120 s 进程界限预取，失败报告 `ENGINE_NPM_PREFETCH_FAILED`。预取实际 `@latest`（本轮 0.0.85）与 scope 用的 0.0.77，随后所有引擎子进程固定此缓存并 `offline=true`，运行中不再解析上游 dist-tag；真实样本 `npx @playwright/mcp@latest` 字节未改。空离线缓存对照 `c4-red.log` spawn_failed；修复后两个宿主及内层 2+5 真引擎用例通过，ui-mac typecheck exit 0；不依赖人工预热目录。

- r14 C5 FIXED：真实 Codex Figma（先 MCP config、后一个 skill generation）在技能写出后注入 populate 失败，零 records/graph、零激活；成功臂全部组件共用一个非空 transaction.id。新增真实 Context7 与用户已有远程 MCP 同名例确实变红：`listConfiguredMcpServerNamesStrict` 漏读独立真源，沿既有严格读端补入名称后新包自动避让且用户叶原值不变。相关 `install-from-source/ext-config/mcp-server-derivation` 133 pass、typecheck exit 0。自身断言修正 `5334d225ed`：config action 不调用 populate，失败点改到实际的唯一 generation；仍在 MCP 已 staging 后，保留所有回滚与身份断言。

- r14 C7 FIXED：慢 RPC 对照（150 ms > 既有 100 ms 去抖）使三个旧时间窗用例全部变红；宿主显式暂停 watcher 后关停/缩窄包，在陈旧显式路径下重建、读取/使用，仍证 tail/evaluate 拒绝，再恢复真实 watcher 并以用户层同字节写入产生真实输入事件，等待刷新。该停顿仅在测试组合层，不改生产等待；`package-effect.engine.test.ts` 内部 5 pass、typecheck exit 0（c7-green.log）。

- r14 C OPTIONAL FIXED：native JS onLoad 正控制使用独立复制路径，避免 Bun 模块缓存吞掉后续错误导入；Figma 401 明标本机 transport stand-in，不声称真实可达/已授权；两处旧 intake IPC/确认阶段注释修正。`plugin-entrypoints.engine/ext-write-channels/claude-plugin-intake` 68 pass（内层真实入口 5 pass），exit 0。
- r14 AC-11 文件夹市场补证：当前真实固定市场清单及原始成员复制到临时文件夹，`captureFolder → prepareCapture → 单条 main ID → install`；300+ 真实可选项仅 Context7 留下唯一 graph/record/激活入口，Playwright/GitHub/Frontend 无记录，source 为本地文件夹。`review AC11 local marketplace folder installs only the selected real plugin` 1 pass、exit 0，结合既有同一选择 DOM/文件夹 picker 链，填补旧删除用例的证据缺口。
- r14 B recorded verify 反证：`folderSelections` 不是不可达死入口。冻结 `InstallSourceRefV1` 仍含 folder，`ext-ipc.ts` 经公开 ext-install-from-source 分派它；保留的 `BC2a.2 main picker captures a whole package without exposing its path or writing before selection` 实际以 source.kind=folder 安装成功（最新 ext-write-channels 宿主绿）。renderer 当前菜单先 prepare 再 candidate 不改变此可调用合同，故未删除；缓存生命周期继续仅记录，去向编排器。AC-16 Registry 独立 MCP 在项目 B 的真实工具调用仍为记录项，交真实应用验收。

- r14 A recorded verify 已核：真实已固定 GitHub 官方 envelope/payload（先验 SHA）+ AES-GCM OS 边界 + 真引擎/本机 echo transport，安装后待令牌、保存后工具可调用、更换令牌产生携新凭据的建连、关闭库存清空、重开恢复；同一 observer setup、0 Location reload。没有真实 PAT/远端写入，不声称 GitHub 线上验收。`official-connectors.test.ts` 内层 14 pass、typecheck exit 0。新引擎用例放独立子进程，避免 HOME/XDG 沙箱改变既有 OS HOME 排除控制的前提，原断言未改。自身断言修正 `05ccc47509`：新用例初版在 connect 后同步断库存；异步投影需读回轮询，保留全部凭据/启停/工具/零重载断言。
- r14 收口相关集：main 47 文件 928 pass / 0 fail，renderer 14 文件 202 pass / 0 fail，ext 8 文件 197 pass / 0 fail；ext typecheck 与 authority-registry exit 0。真实 Playwright 宿主已自备缓存，收口命令没有使用手工缓存路径。下面单次条数脚本另记，不把相关集冒充 full gate。


r14 最终边界 / C3 PARTIAL（2026-11-17 北京时间）：按授权仅一次执行 `bash scripts/assert-gate-files.sh --update`，通过继承 bash 函数给其 bun test 子调用附 `--max-concurrency 2`（脚本及测试逻辑未改）。第 1/2 行 27/11 pass；第 3 行 `packages/codepuppy-contracts-consumer/src/extension-package-artifact.test.ts` 6 pass / 1 fail，exit 1。失败断言 :119：vendored host manifest 文件 SHA `ef5eda81b5d3d5cf1f4089381cf9a64923d25c6bd35103411d9552ca7176c0ae`，live `695d69af7d047b2f0f4561237a815a0f74423ba1fbc32c9dd3f567b6d1116c5a`。具名原因是跨仓 producer pin 仍基于旧 host（vendor 与 origin/alpha 对应字节一致），不是 npm/机器问题；本 lane 的 converter/artifact 修改需要发布端重固定。脚本 all-or-nothing，**没有任何条数前→后写回**，不伪报 C3 已绿；唯一调用已使用，未再跑。

SEAM-CHANGE-NEEDED：alpha-web extension producer 的 host-contract pin / re-publication — 本仓 consumer 测试 :119 及 `alpha-web-extension-package.lock.json` 固定 alpha-web a7f79c667c71b03a4ae54350dd061a116a2c4080；不得手改 vendor/manifest/SHA 冒充该真实提交的产物 — 编排器安排发布端以新 host 工件重固定后按既有机制 re-vendor，并追加一次计数脚本授权。alpha-web、公共 pin 与发布动作不在本 lane 授权中。未弱化消费者断言，未写另一个计数脚本绕过一次调用边界。

C3 已完成的文字同步逐行核对：card 宿主 1→1，叙述保持实测内层 11；permission-mount 8→8，移除旧 HubInstallWatcher 存在保证，改为聊天无确认挂载；permission-single-surface 5→5，改为普通唯一审批、零安装阶段写；local-package-channel 登记仍 2→2（待脚本量改），文字修正为现存 local namespace 单宿主及原 preview/confirm 替代证据；official-connectors 宿主 1→1，内层 10→14 的文字改为实际 14、补无重启 runtime 证据。其余 C3 点名的 11 个 exact count 行均待成功脚本写回，未凭声明数/聚合数猜改数字。

本轮处置总表：A1/B5 以短 search/长 capture 分阶段修复；A2–A5、B1/B2 维持 r12 通过证据；A6 现有 validator 反证（含去守卫红控制），A7–A10、B3/B4/B6–B12、C1/C2/C4–C9 均已具名修复/补证；C3 与跨仓 pin 留给编排器 fix now。recorded-only 条目按前列逐项保留，两个 verify 已执行（官方 runtime 通过；folder 合同入口仍可调用，未删）。AC-11 本地市场臂已补。已核 Codex（GPT-6）；审查范围及 Claude Opus 5.5 A/B/C 审计来源沿 r12 记录，无重开设计。

own-assertion corrections 全表：`eb699846b0` 旧 primitive 的额外 saved:true；`25dc6cc380` 新本地查询例等待短于既有防抖；`5334d225ed` Figma config action 不调用 populate；`05ccc47509` connect 与工具库存异步。各自独立提交且保留审核要求的行为断言；官方 probe 的进程级隔离修复另在 `5b10e9a65c`，既有 HOME 排除断言未改。

仍待真实应用验收：编排器收集 built application 的真实模型请求、真实服务授权及任务调用；本轮本机 transport/OAuth 替身不是线上账户证据。AC-16 Registry MCP 在项目 B 的真实调用仍为记录项，去向该验收。无新产品限制、无项目配置写入、无真实账户登录/外部写、无 gate/bin/check、无 push/PR/merge。


r15 · host publication artifact 边界裁定（2026-11-17 北京时间；本轮开始 2026-11-16 16:22:07 UTC）：编排器说明 Alpha Web 当前未消费转换器，采纳「转换库仍在当前位置且唯一解析第三方格式，本增量不属于 host artifact」；跨仓发布转换器延到实际消费者接线时。此裁定替代 r14 C3 的跨仓重固定路线，不再要求发布或重签现有目录。没有把这项裁定归于 owner 原话；design §10 由编排器按其变更程序登记。

r15 实施偏离：`generate-artifact.ts` 本身也是 artifact 成员，单删其表中三个文件仍会改变 generator 的 SHA，因此将原有 Bun build / TypeScript declaration / drift-check 逻辑原样搬到同目录 `generate-plugin-conversion.ts`，host generator 与 manifest 一并恢复 origin/alpha 精确字节；这是裁定所需同链文件，没有新转换实现、运行时分支、依赖或发布端变更。独立生成/核验命令分别为 `bun src/shared/host-extension-package-contract/generate-plugin-conversion.ts` / `--check`，原 host `generate-artifact.ts --check` 只负责其原有 14 个文件。源 `.ts` 与运行时 `.mjs`/声明 `.d.mts` 均保留，所有原 converter/source 测试保留。

r15 红/绿：先提交 `3a0a181241`，两个行为红例为 host 清单排除转换器，以及独立 CLI 核验；原树 39 pass / 2 fail（artifact-red.log，exit 1）。改动后 host --check、standalone --check 均 exit 0；新增 drift 负控制在临时副本分别改坏 `.mjs` 和 `.d.mts`，两次都必须拒绝。`bun test --max-concurrency 2 src/shared/host-extension-package-contract/plugin-conversion.test.ts src/shared/host-extension-package-contract/host-extension-package-artifact.test.ts src/main/plugin-sources.test.ts` 80 pass / 0 fail（artifact-green.log）。`git diff --exit-code origin/alpha -- <host manifest> <host generator>` exit 0；consumer vendor/locks 未改。

r15 打包加载核对：`src/main/index.ts:27` 静态引入 ext-ipc，后者消费 plugin-sources / install-from-source；三个运行时模块均以相对路径直接导入 `plugin-conversion.mjs`。`electron.vite.config.ts` 的 main Rollup index 入口为 `src/main/index.ts`，转换器随这条静态图编入 `out/main/index.js`（若 Rollup 形成共享 chunk，一同位于 out/main）；`package.json` 的 Electron main 就是 `./out/main/index.js`，`electron-builder.config.ts` 的 files 包含 `out/**/*`，随 app.asar 带入。没有 manifest 查找、artifact 文件集读取或需要复制的独立转换器 resource 路径。进一步将真实 `.mjs` 单独复制到只含脚本和库的临时目录，在 Node 下转换固定 Playwright 原始样本，产出 claude-code / 一个 MCP，exit 0（node-runtime.log）；该目录没有 host artifact 或 registry，证明 Node 库加载不依赖其成员身份。此证据是加载链/独立库运行，不冒充最终签名应用验收。

r15 新授权诊断（按 codepuppy-check.sh [5/14] 对应子命令，仅追加并发 2）：`bun run --cwd packages/codepuppy-contracts-consumer check:vendor` exit 0；`bash scripts/bun-test-floor.sh 15 packages/codepuppy-contracts-consumer --max-concurrency 2` 65 pass / 0 fail、exit 0（consumer-step.log）；`bash scripts/bun-test-floor.sh 100 packages/ext --max-concurrency 2` 626 pass / 0 fail、exit 0（ext-step.log）。vendor 检查如实提示没有 staged upstream checkout，故本次仅锁↔vendor 字节及 producer aggregate 验证，不声称重新验证外仓 provenance；没有 vendor/pin 修改。ui-mac/ext `bun typecheck` 均 exit 0。未运行 ui-mac/app whole-package、bin/check 或 gate run。


r15 C3 PARTIAL · 唯一授权计数调用的实报：`bash scripts/assert-gate-files.sh --update`（给 bun test 子调用追加并发 2）已实际执行一次，第 3 行 consumer artifact 比对已通过，不再有 host pin 漂移；第 41/357 行 `packages/ui-mac/src/main/package-hub-lifecycle.engine.test.ts` exit 1，内层 0 pass / 5 fail（gate-files-update.log）。首个具名失败是 cases.ts:64 的 action 固定等待 `refreshes > before`，:266 安装 Supabase 后超时 `did not settle: ext-install-package`；随后技能读取缺项并有其它 refresh/库存超时。未据此声称生产正确，也不把问题称为 flaky。

依 Handling problems §2 与 delivery-ship §3 只做一次具名基线对照：临时恢复 e9d2b0725a 的 host generator/manifest，执行 `bun test --max-concurrency 2 --test-name-pattern 'real Supabase package exposes' ./src/main/package-hub-lifecycle.engine.cases.ts`，同一 cases.ts:64/:266 失败（0 pass / 1 fail / 4 filtered，exit 1，hub-lifecycle-base-control.log），finally 恢复 r15 文件；因此该失败在本轮 artifact 拆分前已经存在。原宿主及所有行为断言均未改，未展开根因扫描；遗留去向：编排器 fix now，裁定这条 H 生命周期宿主与当前 reload/runtime 生效链的修复，再授权一次计数脚本。没有重跑计数脚本，没有用另一份脚本或手改数字绕过 all-or-nothing。

逐行 count diff：**无 before→after 行**；脚本因失败未写回任何行，`git diff --exit-code -- scripts/gate-files.tsv` exit 0。C3 所需自动条数写回仍未完成，不能宣称 DONE。此前 40 行的执行结果和第 41 行失败完整保存在 gate-files-update.log；不把部分测量当全登记簿通过。

r15 已核收口：`generate-plugin-conversion.ts` 默认生成及 `--check` 均 exit 0，未改变既有 `.mjs` / `.d.mts` 字节；host `generate-artifact.ts --check` exit 0（14 文件）；与 origin/alpha 的 host generator/manifest diff 为空，vendor/lock diff 为空。三文件 converter/source 80 pass；contracts-consumer 65 pass、ext whole-package 626 pass；ui-mac/ext typecheck 均 exit 0；gate-file-registry 23 pass、exit 0。已核 Codex（GPT-6），依据 r15 编排器裁定；下一步仅上述生命周期宿主处置及 C3 计数收口，真实应用验收仍归编排器。本轮无 own-assertion correction、无外仓改动/发布、无 ui-mac/app whole-package、无 gate run/bin/check、无 push/PR/merge。


r16 · 生命周期宿主归因与修复（开始 2026-11-16 16:39:02 UTC）：按 brief 首先在只读主 checkout `origin/alpha 23546fd5b1` 与本分支 `05592e59d0` 分别执行 `bun test --max-concurrency 2 src/main/package-hub-lifecycle.engine.test.ts`。alpha 内层 5 pass / 外层 1 pass、exit 0（control-alpha.log，4.53 s），分支内层 0 pass / 5 fail、exit 1（control-branch.log）；主 checkout 最终 git status 仍干净。r15 的「早于 r15」仅排除 artifact 拆分，不等于排除此增量，现已完成合并基线对照。

根因定位：`9f59750901` 将 package install/state/credential 从原 `connectorChange:true` 全引擎 refresh 改为 runtime MCP，这是 design v4 §5 对 MCP 的替代；`b46ef5636b` 后 runtime 工作移到恢复写门之外，当前技能仍发非 force reload，未丢请求。宿主却只等 officialRuntime.refresh 的 `refreshes`，并缺生产 sidecar.ts 已有的 `watchExplicitSources`/引擎 filewatcher。改为真实 reload report / 引擎库存读回，并接生产 watcher 后，两个 Supabase 技能的原断言通过；新增断言同时要求非 force 请求、实际 Location reload 与零 full-engine refresh。对照日志 skill-readback.log 证明只换等待但缺 watcher 时原技能断言仍红，未用手工 skill.reload 掩盖。

保留原断言还揭出此增量的真实回归：MCP-only disable 的原待批回合未取消；技能 Location reload 后 runtime-only MCP 条目丢失；cloud/agent/command 的原启动配置刷新也被一起移除了。修复仍沿原链：`package-mcp-activation.ts` 用权威 ToolIdentity schema 识别该包 MCP 请求，只通过已有 permission.reply 的字面 reject 释放相关会话；关闭态缺失条目仅在包有效 Location 注册 disabled 定义，不解引用凭据；`reload-coordinator.ts` 在成功的非 restart reload 后，经 main callback 对受影响包复用同一个 MCP apply（保留 source/effect 约束，写门外执行）；`ext-ipc.ts` 只对 cloud/agent/command 保留既有启动配置 refresh，MCP/skill 不走此分支。无 Core/引擎代次/权限 evaluator 改动，无新确认或等待要求。

测试修复边界：原宿主所有 expect 行对照 origin/alpha 均保留（移除数=0），仅替换过时等待、补接生产组合层并添加更强反控制。token 保存/关闭态重填/关闭待批 MCP 的 Location reload 数均保持不变；原两次审批、busy 取消、令牌零泄漏、技能/MCP/cloud/command 启停、整包移除断言仍执行。`5e3d7e63d7` 先记录 reload 观测红例；own-assertion correction `0e86467c4c` 修正新增 force:false 字面量（现有 wire 省略 false，改验 force !== true），未改审核/原 AC 断言。`8c89896add` 的新 coordinator 反控制在缺少重应用时红；permission-mount 新 main 入口先红再登记，严格只准 reject，once/always/变量仍拒。ADR-048 登记恢复的包关闭权威，未新增 grant 或第二审批面。

r16 必要同链文件超出最初宿主：`reload-coordinator.*`（成功重载后的包重应用及负控制）、`package-mcp-activation.ts`（关闭回合/disabled 条目）、`ext-ipc.ts`（接线与既有启动组件刷新）、permission-mount-ratchet.test.ts 和 authority registry（新增 reject-only 物理出口的机械登记与反控制）。没有改 Hub 页面、converter、artifact 或 public IPC/graph 契约。`bun test --max-concurrency 2 src/main/package-hub-lifecycle.engine.test.ts src/main/reload-coordinator.test.ts src/renderer/codepuppy-ui/permission-mount-ratchet.test.ts src/main/gate-file-registry.test.ts` 43 pass / 0 fail，内层生命周期 5 pass、exit 0（lifecycle-final.log）；A2 activation/install/effect 与写通道五文件 50 pass / 0 fail、exit 0（activation-related-final.log），包括两台真实 Playwright 宿主独立缓存/项目隔离；authority-registry 5 pass、两包 typecheck 均 exit 0。下面的计数调用另记，不冒充 full gate。

r16 计数脚本第 1 次（gate-files-update-1.log）在第 49/357 行退出 1；第 41 行生命周期已绿，all-or-nothing 因此未写数字。新停点 `ext-package-detail-wiring.cases.ts` 为 13 pass / 2 fail：一处仍在统一搜索时找旧 `data-package-card`，且用包 ID 代替现行按名称/描述的查询；另一处仍要求已在 B12 移除的 MCP「+」安装确认框。按本轮裁定仅更新被替代期待：夹具接真实 createPluginSources 与现有 pinned 五源 fetch、观察 main 查询完成及 `data-source-candidate`（两个 Generic Remote MCP 仍各占一行）；「+」直接交出 mcp:git ID，无确认/凭据字段。后者只声称请求出站，当前 package-only admission 夹具不声称安装了 legacy MCP。原空值不阻塞能力转到既有真实包装后令牌 DOM 例：初值空、非 required、保存可点、关闭不保存。安全视图、详情、真实包 admission/专用存储及其余 13 例保持，宿主仍执行 15 例；修复前脚本提供红证据，修复后 detail-wiring-2.log 外层 1 pass / 内层 15 pass、exit 0。
