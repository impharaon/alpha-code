---
id: PLAN-local-plugin-install
title: 插件整包安装与授权实施计划
summary: 片 1 桌面部分：目录包合并展示、整包启停、安装授权说明及装后凭据操作的改动顺序和行为证据
kind: plan
status: active
spec: impharaon/alpha-work:SPEC-local-plugin-install
design: impharaon/alpha-work:DESIGN-local-plugin-install
owners: [owner]
last_reviewed: 2026-11-15
---

# PLAN-local-plugin-install｜插件整包安装与授权实施计划

规格与设计由协调仓 alpha-work 持有；本仓目前没有本功能的 spec、design 或 plan。本文件按本次派发放在实施仓 `docs/specs/local-plugin-install/plan.md`，只记录桌面片的执行计划，不复制两份上游权威。

## 片 1 · 桌面：一个包一行，安装与登录/令牌分开

- 依据：体验按 [SPEC-plugin-helper-and-hub v3 @ 8663fb2](https://github.com/impharaon/alpha-work/blob/8663fb2/docs/specs/plugin-helper-and-hub/spec.md) 的体验约定、BR-04…07/09，覆盖 AC-10/12/13（立即应用分支）、AC-14 列表管理与现有真实来源、AC-06/07 hub 侧；内容及生命周期保留 [local-plugin-install v3 @ 0267a7a](https://github.com/impharaon/alpha-work/blob/0267a7acd725bba3b066d97d9da21d689ae3e5f3/docs/specs/local-plugin-install/spec.md) BR-01/03/05/09/13、AC-03 前两句及 AC-13/14 技能/连接器分项的 a–d 证明。[冻结 design v2 @ 6d0bc73](https://github.com/impharaon/alpha-work/blob/6d0bc7354e5d9035a0415636c1417735cebff85b/docs/specs/local-plugin-install/design.md) §4.2/4.5/5/6 的技术合同继续适用，旧产品表述按 [2026-11-15 规格分域说明 @ 9f5ee3c](https://github.com/impharaon/alpha-work/blob/9f5ee3c/docs/specs/local-plugin-install/design.md#2026-11-15-规格分域说明) 被替代；父项 [alpha-work#138](https://github.com/impharaon/alpha-work/issues/138)。不扩展聊天/时间线、插件助手、在线查源/统一搜索、独立 MCP/自制插件、folder/Git 导入、commands/agents/hooks、OpenCode 原生包或 alpha-web；安装 scope 不变。
- 核对：IMPLEMENT — 59a729a8e2 · orchestrator/Claude Fable 5.2 · plan check passed with the owner-decided busy-time immediate-apply delta（2026-11-16 续派）。
- 基线：原计划代码 `14f23a8399`；本次从 `origin/alpha 265c42529e` 加已有 bad-port 红测 `1bd2b90913`、修复 `86bdbf6de9` 续作，Bun 1.4.4。复用这两笔提交，保持该回归断言不变，不重做禁用连接器定义保留。owner 本地 0.2.0 / catalog 2026-11-15.1 的观察仅作复现输入。UI 使用 [11-15 帧](../../design/2026-11-15-plugin-package-install-and-card/frame.html) `#list #menu #install #manage #copy #removed` 及其 [shots](../../design/2026-11-15-plugin-package-install-and-card/shots/list-light-1440.png)，复用 [当前组件](../../design/current/customization-center/components.md) 与 [活稿](../../design/current/customization-center/design.html) 的行、菜单开关、分组、Dialog、密码框、Button、链接和错误提示；不绘稿。精确文案与删除项以新 spec 的体验约定表及表后段落为准；owner 2026-11-16「按此稿开发」；#copy 的忙时等待文案不采用，忙时按已定的「立即生效」分支。
- 预计规模：约 20–24 个生产文件、18–22 个测试/夹具文件，净改动约 1,200–1,800 行，实施及相关验证约 4–6 小时。每完成 a/b/c/d 检查用时与规模；达到预计上界两倍时停止并返回具体原因。

### 改动

下表路径均相对 `packages/ui-mac/`；同一行列出的文件各自只承担所述接线。宿主发布 schema、Protocol/HttpApi、引擎执行器、权限 evaluator、账本和专用 secret store 权威及 alpha-web 目录数据均冻结，不引入依赖。包开关调用现有 force 路径，包含忙时；仅在同调用链需要时改 `packages/ext/` 调度/云 MCP 重装调用点及相关测试，不新增调度机制、轮询框架、确认或等待。

| 文件 | 改什么 |
| --- | --- |
| `src/shared/package-admission.ts`、`src/shared/catalog-package-view.ts` | 在既有安全 DTO 中统一 secret / mcp-oauth / Connection 视图，供直接安装结果、同一包管理和装后授权消费；只携声明、输入用途、既有说明及安全状态，不传秘密、路径或原始 payload。 |
| `src/main/package-installability.ts`、`src/main/package-admission.ts` | 「+」沿既有 binding/写闸校验直接提交内容，不再以安装确认或登录/token 就绪作保存前提；内容提交后自动开启包。缺凭据或真实载入失败按组件读回状态，不连带关闭/删减其余功能；安装阶段不执行包脚本或主动 OAuth probe。装后密钥修改复用 admission/builders/事务资源，保持包图与开关，未改字段保留，不让 renderer 提交配置或文件位置；不新增永久工具 allow。 |
| `src/main/package-mcp-oauth.ts` | 将安装期主动 add/probe 与显式登录动作分开；就绪从真实引擎状态/集成连接读回。关闭包的定义经同名 disabled 配置投影，不走当前 active `experimental.mcp.add`。不自建 OAuth attempt、callback 或 token store。 |
| `src/main/ext-install-planner.ts`、`src/main/ext-receipt-v2.ts`、`src/main/ext-package-tx-builders.ts` | 包状态操作从既有 graph/root 找全组件，复用锁、配置写入、账本写器与技能允许集发布；自动开启与菜单开关均由 root 意图派生组件投影，避免 renderer 逐项循环开关。尚缺 token 的连接器不阻断内容提交；凭据写入沿版本化 prepared resource，改 token 不改变包的启停状态。 |
| `src/main/ext-transaction.ts`、`src/main/ext-transaction.test.ts` | r3 授权：事务内以条目序号区分 generation 的八位十六进制后缀；不改现有读者文法、探针、core 或已落记录。新用例验普通/进位边界的唯一代号及读回/卸载。 |
| `src/main/engine-explicit-config.ts` / `.test.ts`、`src/main/codepuppy-config-injection.ts`、`src/main/{codepuppy-config-injection-engine,engine-plugin-policy.engine}.cases.ts` | r4 B1：由原账本读器按包 root 状态投影同图 disabled 组件；显式层撤下关闭包的 command/commands，启动注入不注册关闭云包的 MCP；只透传现有 root 到显式层写入/监听，不改存储内容、engine 或发布 schema。相关调用测试同步私有签名。 |
| `src/main/official-connector-resources.ts`、`src/main/official-connectors.test.ts`、`test-component/official-connectors.cases.ts`、`src/main/ext-package-tx-builders-command.test.ts` | r4 A/B2–4：复用原官方投影 writer 发布提交后的新引用，按密文版本判 saved；具名验证成功清旧/失败保旧。command builder 旧 disabled 拒绝例随真实有效声明投影替换，保留内容等待同包 root 开启。 |
| `../ext/src/plugin.ts`、`../ext/src/plugin-host.test.ts`、`../ext/src/context-injection.test.ts` | r4 B1 同链：既有 kill-switch rearm 仅重装 main 有效注入中存在的云 server；包 off 的缺席不会被重装。原身份测试补 main 真实 withheld 前像，既有断言不改。 |
| `../../scripts/gate-files.tsv`、`../../scripts/old-name-exceptions.tsv`、`src/renderer/i18n/locale-regression.test.ts`、`test-component/local-package-namespace.cases.ts` | r6 授权的登记同步：生命周期宿主及实际精确计数、真实样本外部锚点、外部生态来源名与既有安全 DTO 的 desiredState；不改变扫描正则/范围、地板或失败清单。 |
| `src/main/ext-config.ts` | 同调用链补严格读取：沿既有 main-only remote MCP 真值读取器取得已装定义，供装后凭据编辑保留原文件引用；不另建配置或 secret 权威。 |
| `src/main/ext-ipc.ts`、`src/main/ext-write-channels.ts` | 已安装投影带 root 状态、组成和安全授权视图；包状态/装后密钥写动作接现有写闸、恢复与重载通道。main 依据包身份重读图和已验声明，调用方不能指定 server URL、任意 config 或秘密文件。卸载仍走 `uninstallPackageV1`。 |
| `src/preload/types.ts`、`src/preload/index.ts`、`src/renderer/extensions/ext-ipc.ts` | 串接包状态及装后授权动作，统一引用安全 DTO；只增加本片所需的桌面内部动作，不新增发布者合同。 |
| `src/renderer/extensions/use-extensions.ts`、`src/engine-adapter/opencode2/routes.ts` | 包安装/启停/授权/移除后刷新同一包；沿现有重载、MCP 连接/断开及真实状态回读，使空闲操作自行收敛，不依赖「立即生效」或重进项目。复用 `authenticateMcp` 和系统浏览器；OAuth complete 且 server disabled 能判为授权完成，failed/expired 仍返回失败，授权完成不等于工具已可用。保持现有路由/返回联合；包开关经既有 force 路径立即应用，忙时如实回读中断/结果，不显示等待，不换代引擎 API。 |
| `src/renderer/extensions/extension-hub.tsx` | 按 main 包图及 scope 归属合成一行并过滤顶层组件；未装仅「+」，已装仅「…」，菜单「开启」开关/管理/移除；组成与登录/token 操作进入同一包管理页。GitHub、Supabase、SQLite、云图片同路，跨页加载归属，同名 project/独立条目保留；浏览结果与已装行相认。去掉该包的独立开启/去授权/立即生效按钮；管理页和菜单移除共用一次动作，移除后无残留组件/内部标识/可触发入口。 |
| `src/renderer/extensions/ext-presentation.tsx`、`src/renderer/extensions/extension-hub.css` | 同调用链复用 MoreMenu 承载帧内 switch 与包名读屏标签，补帧已有菜单/详情头的组合样式；不新增组件体系。 |
| `src/renderer/extensions/ext-package-presentation.ts` / `.test.ts`、`src/renderer/extensions/ext-hub-state.ts` | r3：按 [DESIGN-plugin-helper-and-hub v5 §4.4 @ 8bd3075](https://github.com/impharaon/alpha-work/blob/8bd3075/docs/specs/plugin-helper-and-hub/design.md) 的 source/notRunning 做只读呈现；沿原 Hub 状态开同一 packageId 的现有管理页。预加载安全 DTO 仅加该两项可选字段，字段权威类型在 shared/package-admission，main 数据由片 A 提供，不改包图/凭据写入、安装 scope 或增加入口状态。 |
| `src/renderer/extensions/install-confirm.tsx`、`src/renderer/extensions/ext-authz.tsx`、`src/renderer/extensions/extension-detail.tsx` | 本片列表「+」脱离安装确认墙，先装好再显示独立登录或 password 小窗；关闭后从原包管理页继续，不重装。管理页复用权限/账户/关于分组及既有权限编辑入口；人话显示能力、组成、真实账户/来源/版本，不泄露内部 profile token。token 说明用途、专用存储和真实领取位置：消费已有 listing 声明，真实 GitHub 包的领取帮助用下述官方文档来源，链接由详情入口一处持有；不按变量名猜地址、把官网冒称令牌页或改凭据解析。来源标签只展示现有证据，不把 Figma/Photoshop 或缺证据来源标为已验证。共享控制器保留聊天/时间线原入口语义。 |
| `src/renderer/i18n/zh.ts`、`src/renderer/i18n/en.ts` | 按新 spec 体验约定的精确文案/删除项更新本片列表、菜单、登录/token 小窗、管理页和真实失败文案；不新增资料或确认步骤，scope 不变。 |
| `test-component/hub-three-pages.cases.ts`、`test-component/local-package-renderer.cases.ts`、`test-component/ext-package-detail-wiring.cases.ts`、`test-component/mcp-needs-auth-wiring.cases.ts` | 以生产 Solid DOM 编译、真 `useExtensions` / `ExtensionHub` / 列表安装链验证 a–c：五态一行、菜单开关、直装、同包管理及授权取消/继续。更新明确编码旧平铺/确认墙/组件开关的用例；新回归先红，不能只删旧断言。对应 `src/renderer/extensions/{hub-three-pages,local-package-renderer,ext-package-detail-wiring,mcp-needs-auth-wiring}.test.ts` 仅在实际子用例跑齐后同步宿主计数。 |
| `src/main/ext-set-state-tx.test.ts`、`src/main/package-admission.test.ts`、`src/main/package-mcp-oauth.wiring.test.ts`、`src/main/package-mcp-oauth.engine.cases.ts`、`src/engine-adapter/mcp-auth.test.ts` | 真临时盘验证整包状态与凭据事务；沙箱真引擎验证 disabled OAuth、无安装期连接、启停后的工具和技能实际可见性及两次调用均询问。`package-mcp-oauth.engine.test.ts` 宿主按实际用例同步。 |
| `src/main/package-hub-lifecycle.engine.cases.ts` / `.test.ts` | 同链运行证据单独子进程，复用 engine-sandbox/codepuppy-engine 与 core 的既有 mcp-echo 实样；隔离真实 main IPC、ext force 调度、引擎/数据库及 policy，避免 OAuth 宿主与 main bootstrap 的全局状态互染。 |
| `test-component/package-builders-wiring.cases.ts`、`test-component/package-install-engine-reload.cases.ts`、`src/main/ext-package-ledger-uninstall.test.ts`、`src/main/ext-write-channels.test.ts`、`src/main/package-admission.wiring.test.ts` | 校准改动导出所影响的 mock/通道枚举，验证真实 IPC→builder→事务→配置/账本/secret store 与移除后的盘面；对应既有宿主按实际用例同步，不放宽检查。 |
| `packages/ext/src/plugin.ts`（同链调用点，如需）、`packages/ext/src/plugin-reload-wiring.cases.ts` / `.test.ts` | 保持已有 force 传递与调度器；真插件宿主补忙时包开关强制重载证据，不改调度规则。 |
| `test-component/hub-package.fixture.ts` / `.json` | 固定 alpha-web `0bb739ce` 的 GitHub/Supabase 真实信封、载荷及全部技能字节，逐 ref 校验 bytes/digest；供 main/DOM 共用。 |
| 本文件 | 首次实施填核对，实际偏离随发生偏离的提交记录。其他文档若出现必需修订，先列具体错误和同调用链理由再更新本段，不顺带维护保护资产。 |

### 顺序

1. **回归证据提交**：先继承 bad-port 的两笔提交；从下述实样在现有 DOM harness 添加 a/b/c 的具名失败用例，在临时盘/真引擎 harness 添加 d、关闭包登录及空闲自动收敛用例。单独提交新增回归与红色命令结果，不夹生产修复；旧行为断言在修复提交同步，新回归断言不改。
2. **包状态及授权事务提交**：先统一安全投影、root 状态和 IPC/preload；验证内容先提交再自动开启，未登录/未填 token 仍保有内容及可用技能；装后 secret、关闭包 OAuth 同时接通。运行 main/共享/adapter 对应具名测试，不改专用存储、账本、权限或引擎权威。
3. **用户入口提交**：包图归属合成一行，直装「+」与「…」菜单开关/管理/移除，同包管理及独立登录/token 小窗共用既有组件。接通空闲操作的真实状态回读，删除独立「立即生效」。跑新增和原有相关 DOM 用例、受影响的安装 watcher/详情宿主；聊天/时间线共享入口做不变回归。
4. **运行证据与收口提交**：临时 HOME/XDG/数据库中走真实 IPC 直装→自动开启→管理页取消/继续授权→调用→关闭→关闭态授权→重开→移除，检查自动收敛；同一样本正反对照。跑适用类型检查、文档链接与 diff 检查并记录偏离。只 commit，不执行 gate、push、PR、合并、上架或 owner 账号授权；本次 PLAN 只读探针并运行两项文档检查。

### 风险

- **归属过滤漏页或误吞同名项目项**：当前包 resource 仅在连接器页触发（`extension-hub.tsx:204`），包行与平铺行分别渲染（`:2254`）；a 的回归必须直接打开技能页，并放入同名 project/独立条目作对照。SQLite/云图片不能靠名字特判消重；云组件仍沿其 receipts-only 路径，不伪造成 MCP；来源标签从真实 receipt/listing 取，不由包名推断生态或官方身份。
- **看起来是一个开关，实际上仍部分启用**：当前包行只有移除菜单（`extension-hub.tsx:1599`），单条 state 写入只作用一个 record（`ext-receipt-v2.ts:1315`）。d 检查 root、子记录、技能允许集、MCP config 和真引擎；缺凭据不连带停掉技能，真实错误不报全部可用。既有 bad-port 回归保持启动时 disabled/零进程、重开后 connected/实际启动的断言，不重写修复。
- **内容提交、自动开启与状态回读混为一谈**：原「立即生效」回读路径（`extension-hub.tsx:1753`）本次纳入 AC-12；d 分别观测提交前零执行、提交后开启、空闲调度完成后真实清单和 DOM 状态。复用现有 reload scheduler 及 MCP 连接/断开，不加轮询框架或确认/等待步骤；包开关调用现有 force，忙时立即执行并回读真实中断/结果。接缝已核：main `reloads.request` → ext `plugin.ts:73` 原样传 force → `reload-scheduler.ts:179` 跳过忙时等待；仍保留既有未知状态/真实失败的如实结果。
- **关闭包登录误启动或误报失败**：可复用接缝已在 `packages/core/src/mcp/index.ts:259/731/735/778` 核到；目前 `package-mcp-oauth.ts:43` 主动 add，`use-extensions.ts:796` 只认 connected。c/d 必须包含 disabled→登录完成→仍 disabled 且零工具/进程，以及失败后仍可重试的路径；不另造活跃临时服务器。
- **凭据变更丢值或泄露**：检查专用版本资源、原引用保留与新版本提交/失败清理，聊天、真实配置/日志/预览/读回 DTO 不出现无效测试 canary；关闭小窗仍能从原包继续，写失败不报已保存。只填原声明需求，不把 OAuth 变成密码框；GitHub 帮助链接有官方实据，不需扩展发布 schema，通用 listing 测试变体不冒充线上证据。若实现仍需新增发布字段，返回 `SEAM-CHANGE-NEEDED`，不扩展冻结 schema 或手造 provider recipe。
- **范围与冻结设计**：未发现所需引擎接缝与设计的事实矛盾；现有 active probe、逐组件状态和 UI 回退属于待改行为。K1/K2 的权威继续是现有权限、账本、secret store 和 engine integration。BR-14…16、命令/助手/hooks、整树脚本、直接 folder/Git、原生入口不在本段；不改适用的已冻结权限规则，不迁移旧记录。
- **真实服务验收边界**：自动证据使用真实包的声明/技能字节，外部网络与 OAuth 服务器在现有边界替换；不将替身登录计为 Supabase/GitHub 实际授权。owner 的真实账号/token 使用是集成验收证据，本轮不会读取或代填。

### 证明

以下名称是实施时增加的具名用例；命令均从 `packages/ui-mac/` 执行，并使用派发要求的 Bun PATH。测试用独立子进程和已有隔离 preload；机器有 gate 在跑时顺序执行宿主，`bun test --max-concurrency 2`，不并发开启多套引擎。

| 项目 / AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| a · local BR-01/13、AC-13 包管理；hub AC-10/14 | `hub-three-pages.cases.ts`：`catalog package owns one installed row across pages`；用 GitHub/Supabase 实样覆盖五态（未装、已装、待登录、待填令牌、已关闭），SQLite/云图片也各包恰一行，未装仅「+」、已装仅「…」，菜单有唯一「开启」switch/管理/移除，管理「包含」与实际组件一致；先打开技能页，同名 project/独立条目仍在。按 spec 体验约定核读屏/删除项，并对照帧与 shots。命令：`bun test --max-concurrency 2 src/renderer/extensions/hub-three-pages.test.ts src/renderer/extensions/local-package-renderer.test.ts`。 | 去掉 graph/scope 归属会重复或误吞行，漏技能页加载会冒出组件；开关留在行上、少菜单动作或内部编号出现在产品 DOM 都会红。 |
| b · local BR-03/05；hub AC-10、AC-06/07 hub 侧 | `hub-three-pages.cases.ts`：`package plus installs directly before separate credentials without an installation wall`；`ext-package-detail-wiring.cases.ts`：`detail plus commits once without preview authorization and returns the same package management page`；点真实「+」不确认即 installed/root enabled，无安装墙/权限清单/默认关闭文字；Supabase 未登录、GitHub 未填 token 时各自内容仍在，Supabase 技能可用，关闭小窗后「…」→管理可继续。token DOM 验用途、专用存储说明、password、真实领取位置及 openLink 目标；无效 canary 由保存动作到真 secret resource，聊天/配置/日志/预览/错误/读回 DTO 不含值，OAuth 不画 password。命令：`bun test --max-concurrency 2 src/renderer/extensions/ext-package-detail-wiring.test.ts src/main/package-admission.test.ts`。 | 恢复确认或前置凭据校验会让「+」无法直接提交；未自动开启或缺凭据连带停技能会红；取消后入口消失、断开 input/写链、错链接或泄露 canary 均失败。 |
| c · local BR-03/05/13；hub AC-14、AC-06/07 hub 侧 | `ext-package-detail-wiring.cases.ts`：`installed secret entry writes the declared prerequisite to dedicated storage while off and on`；列表菜单进同一包管理页，权限/账户/来源与 receipt/图一致，既有权限编辑动作可达，来源无证据不标官方/已验证；保存新 canary 后配置仍为版本引用，运行时得新值，未改字段保留；off/on 均可更换，写失败保留旧值。`hub-three-pages.cases.ts`：`package login cancellation and failure keep the same installed package; disabled login can complete`，并保留 `mcp-needs-auth-wiring.cases.ts` 既有登录链回归，点击登录仅打开一次系统浏览器，取消/失败后内容和入口还在，重试回原包，未就绪不报可用。命令：`bun test --max-concurrency 2 src/renderer/extensions/local-package-renderer.test.ts src/renderer/extensions/mcp-needs-auth-wiring.test.ts src/main/package-builders-wiring.test.ts`。 | 丢安装身份、错权限/来源、重复安装/开浏览器、取消后无法继续或断写链/刷新任一环，DOM、调用计数、盘面/解析值或真实状态断言失败。 |
| c/d · design §4.5，local AC-13/14 连接器分项 | `package-mcp-oauth.engine.cases.ts`：`disabled package OAuth stores a credential without starting MCP`；沿生产 disabled 配置登记同名服务，调用真实 integration OAuth 与既有 adapter，确认真实 credential connection 就绪、MCP 保持 disabled、工具列表为空、MCP 握手/调用计数为零；再开启同名服务可连接并调用。补 `mcp-auth.test.ts` 的 complete/failed/expired × disabled 分支。命令：`bun test --max-concurrency 2 src/main/package-mcp-oauth.engine.test.ts src/main/package-mcp-oauth.wiring.test.ts src/engine-adapter/mcp-auth.test.ts`。 | 使用 active add 会产生握手/工具；登录后偷偷开启会破坏 disabled 断言；仍只认 connected 会报登录失败；未保存真实凭据时开启后仍 needs_auth。正对照必须测到同一服务握手与工具执行。 |
| d · local BR-09、AC-13 技能/连接器；hub AC-12/13（立即应用） | `package-admission.test.ts`：`one package switch projects every skill and connector from the package graph`，及 `ext-set-state-tx.test.ts` 事务回归；`package-hub-lifecycle.engine.cases.ts`：`real desktop package lifecycle asks twice, applies a busy switch, and removes runtime entries` 验真实连接器工具清单/执行与 busy 中断；`real Supabase package exposes both enabled generation skills` 验真实技能清单（当前失败，见阻塞；未把技能库存的启停/移除正反对照记通过）。`hub-three-pages.cases.ts`：`package idle switch converges from applying to off on the existing event and can turn on again` 和 `package switch reflects failed and completed main results without a second apply action`，点击真实菜单 switch，沿生产状态接线等到引擎与 DOM 同时收敛，无「立即生效」或导航；含真实失败显示；新增 `busy package switch forces the existing scheduler without a second reload action`（真 main IPC→现有调度器）及 ext 真宿主 `package state request with force reloads while an answer is still running`，回答仍 busy 时必须完成 reload，若等待即红；步骤 3 的 DOM 收敛与步骤 4 的真实 active Session/审批中断相接，不改调度机制。命令：`bun test --max-concurrency 2 src/main/ext-set-state-tx.test.ts src/main/package-hub-lifecycle.engine.test.ts src/renderer/extensions/package-install-engine-reload.test.ts`。 | 只改样式/root、只重载技能或只断 MCP 会破坏正反对照；状态停在待生效、依赖按钮/导航或伪造完成会使 DOM/真清单断言红。 |
| d · local BR-10、AC-14 技能/连接器；hub AC-10 | `package-admission.test.ts`：`desktop plus commits content before automatic package enable without login or token`，配合 `package-builders-wiring.cases.ts` 既有真实 builder/探针回归；真实声明/技能样本在内容事务提交前 spawn、动态 shell 求值、MCP 请求均零；提交后由自动开启动作正常加载，同一样本调用计数为正。不点「登录」不启动浏览器/OAuth 授权尝试，不能把自动开启后的正常 MCP 启动误记为安装执行脚本。命令：`bun test --max-concurrency 2 src/main/package-builders-wiring.test.ts src/main/package-mcp-oauth.engine.test.ts`。 | 提前 probe/启动 MCP/求值会使提交边界的零副作用断言红；不自动开启或不能实际调用会使正对照红；不声称覆盖后续脚本/hooks。 |
| d · local BR-09、AC-13 移除；hub AC-12/14 | `ext-package-ledger-uninstall.test.ts` 和 `local-package-renderer.cases.ts`：`removing package clears owned artifacts and secrets`；分别从列表/管理菜单移除，每次仅执行一次卸载；generation/技能文件、MCP config、图/claims、包专用 secret 版本及运行入口均无残留，DOM 无组件卡/内部 package 标识；shared Connection 保留。命令：`bun test --max-concurrency 2 src/main/ext-package-ledger-uninstall.test.ts src/renderer/extensions/local-package-renderer.test.ts`。 | 任一清理遗漏会留文件、凭据、可触发入口或 DOM 残留；双接线会让卸载计数大于一，不能用返回 ok 代替。 |
| local AC-03 前两句；hub AC-10 不新增永久工具允许 | 在上述真引擎生命周期样本中加载生产 Code Puppy policy，直装/自动开启/登录前后核对无新增永久工具 allow；经 Session 工具执行路径连续调用同一 connector，两次分别产生 permission ask，各回复 once 才执行一次，计数 0→1→2。不是直接 MCP `tools/call` 后自造 ask；不改 evaluator，不回复 always。命令：`bun test ./src/main/package-hub-lifecycle.engine.cases.ts -t 'real desktop package lifecycle asks twice'`。 | 直装/开启/登录若误写持久 allow，存储对照或第二次 ask 会失败；只测状态不执行工具不算证据。 |
| hub AC-12，既有 bad-port 回归 | 原样复用 `mcp-server-derivation.engine.cases.ts` 的 `disabled local MCP survives startup and the installed-list enable path connects its stdio definition` 及禁用注入单测；命令：`bun test --max-concurrency 2 src/main/mcp-server-derivation.test.ts src/main/ext-disabled-injection.test.ts`。 | 恢复占位端点会使重开后的 connected/进程断言红；保持 `1bd2b90913` 的断言，不以新用例代替。 |
| r3 · hub AC-14，片 A 呈现接缝 | `hub-three-pages.cases.ts`：`graph marketplace source and notRunning facts reach the installed row and the same management page`、`openPackageManagement opens the requested installed identity from another tab without installing`、`package management navigation survives a closed hub and a later reopen`；`ext-package-presentation.test.ts` 覆盖全部来源 kind、六种未运行原因和 source 缺席的原 origin 标签。命令：`bun test --max-concurrency 2 src/renderer/extensions/hub-three-pages.test.ts src/renderer/extensions/ext-package-presentation.test.ts`。 | 来源被 origin 覆盖、原因变成裸编号、打开另一包/打不开冷态 Hub 或误触安装/启停时，实际 DOM/调用计数失败。 |
| hub AC-06/07 真实服务验收（后收） | 编排器后收 owner 的 Supabase 系统浏览器登录→同包工具调用、取消登录→管理页继续，以及 GitHub 无效值无泄露/关闭后续填、有效凭据工具调用记录；不打印凭据。无需 owner 凭据作为计划/编码输入，自动替身证据不冒充此验收。 | 未实际接通、取消即丢内容、返回错误包或泄露值时，对应真实服务记录不成立。 |

**夹具出处**：GitHub/Supabase 从 alpha-web 的 `catalog-src/packages/package.github/1.0.1/codepuppy-package.json`、`package.supabase/1.0.0/codepuppy-package.json` 及对应已编译 envelope/payload/技能资产取样，固定 producer commit、相对路径和字节摘要；SQLite/云图片从本仓随包 `resources/extension-seed/extension-seed.snapshot.json` 与 `src/renderer/extensions/codepuppy-catalog.json` 的对应实际条目取样。样本只读进入临时目录；本片新增 fixture 记录出处，不手写第三方 manifest/MCP 格式。通用 listing 转发正例只修改实样允许的展示段，标明测试变体，不伪称线上已声明。GitHub 真实声明（alpha-web `553d24df`，blob `b99d6fd0`）仅有 token 需求，领取帮助引用 [GitHub MCP 官方 README @ 0663b830](https://github.com/github/github-mcp-server/blob/0663b830582af923e30fb14cb2e10dd3248baa86/README.md) 的 [真实令牌创建页](https://github.com/settings/personal-access-tokens/new)，不改发布数据或凭据机制。bad-port 继续用 `packages/core/test/fixture/mcp-modern-stdio.ts` 实样。现有 mixed-bundle corpus 继续复用，不能冒充真实插件使用验收。

**相关回归和检查**：按每次修改的实际导出，运行上表宿主及 `src/main/{package-installability,package-admission.parity,package-admission.wiring,package-mixed-bundle.wiring,package-secret-recovery-wiring,ext-write-channels}.test.ts`、`src/shared/package-secret-prerequisite.test.ts`、`src/renderer/extensions/{ext-ipc-chokepoint,use-extensions-ipc,ext-package-presentation,install-scope-wiring}.test.ts`、`src/renderer/codepuppy-ui/hub-install-watcher.test.ts`；涉及 adapter 路由实现再跑 `src/engine-adapter/{routes-coverage,contract-cases}.test.ts`。从包目录运行 `bun typecheck`；文档运行 `python3 scripts/check-doc-links.py docs/specs/local-plugin-install/plan.md` 和 `git diff --check`。不运行全仓 suite、bin/check 或 gate。

**原计划阶段已核的基线**（2026-11-15，均 exit 0；本轮未重跑，没有新增行为通过的含义）：

- `bun test src/renderer/extensions/hub-three-pages.test.ts src/renderer/extensions/mcp-needs-auth-wiring.test.ts src/renderer/extensions/ext-package-detail-wiring.test.ts src/renderer/extensions/package-install-engine-reload.test.ts`：4 个宿主通过，其生产 DOM 子用例均执行。
- `bun test --max-concurrency 2 src/main/ext-set-state-tx.test.ts src/main/package-admission.test.ts src/main/package-mcp-oauth.wiring.test.ts src/main/ext-package-ledger-uninstall.test.ts src/shared/package-secret-prerequisite.test.ts`：111 pass，0 fail。
- `bun test --max-concurrency 2 src/main/package-mcp-oauth.engine.test.ts src/renderer/extensions/local-package-renderer.test.ts src/main/package-builders-wiring.test.ts src/main/package-mixed-bundle.wiring.test.ts`：4 个宿主通过，含沙箱真引擎及生产事务。

原计划文档检查（2026-11-15）：链接检查 exit 0，当时 2 条相对链接可达；`git diff --check` exit 0。`check-docs-contract --profile <临时单仓 profile> --changed-since 14f23a8399 --format json` 使用 Alpha 的 `governance/delivery-profile.yml`，仅筛选 alpha-code 并将 checkout 定位本 worktree，exit 1：69 errors / 216 warnings，本计划 0 条 finding。已命名原因包括 `docs/README.md:105` 的生成索引不同步、`docs/architecture/modules.md:24` 等未改文件的失效目标及既有非标准文档目录。按本次只写/提交计划的范围，不改索引、合同或其他文档，也不重跑未改变的检查；交回仓库文档治理。

本轮 PLAN 检查（2026-11-16）：`python3 scripts/check-doc-links.py docs/specs/local-plugin-install/plan.md` exit 0，4 条相对链接可达；`git diff --check` exit 0。未跑测试、gate 或 bin/check。

计划作者已核（2026-11-16）：Codex（GPT-6）按新 spec/派发 delta 复核 a–d 调用链、既有帧/截图、组件和测试入口、bad-port 两笔提交；技术合同不变，原估算内仍是一条包状态/授权到行与管理页的连贯交付，无需拆片。该自核不代替本段「核对」所留的编排器检查。

### 偏离记录

2026-11-16 计划 delta：原「首装关闭/卡上开关/确认时收凭据」改为新规格的直装自动开启、菜单开关、同包管理与分开登录/token；原末尾「立即生效」观察纳入 AC-12，复用 bad-port 红测/修复，GitHub 领取帮助补官方实据；冻结技术权威与 a–d/实样来源保持。计划阶段仅修订本段。

2026-11-16 r1 · owner 决定「立即生效」——「拨了就应用，不让用户等；代价是正在进行的那轮回答或审批卡可能被中断。」（续派/spec v2 @ 64efa6d）：包开关复用现有 force 路径，纳入 AC-13 立即应用支，去掉本段保留忙时等待的旧句；scope 不变。本轮只做步骤 1–2。a–c 的新增 DOM 红测集中在既有 hub-three-pages harness，共用新增真实夹具；目录确认/聊天入口仍独立，不改变排除的聊天/时间线语义。

步骤 1 红证据（2026-11-16，生产未改）：ui-mac 包目录 `bun test --max-concurrency 2 src/main/package-admission.test.ts src/main/package-mcp-oauth.engine.test.ts src/engine-adapter/mcp-auth.test.ts` exit 1，20 pass / 6 fail：桌面安装/包状态/凭据入口及只读 OAuth 接缝缺失，disabled 的 failed/expired 被误作 disabled 返回。`bun test --max-concurrency 2 src/renderer/extensions/hub-three-pages.test.ts src/renderer/extensions/package-install-engine-reload.test.ts` exit 1：DOM 子集 14 pass / 3 fail（归属、+、管理），main/重载子集 13 pass / 1 fail（包动作通道缺失）。新增回归断言在后续修复提交保持；DOM 三条留步骤 3，完整运行/中断证据留步骤 4。

步骤 2 实施偏离与核对（2026-11-16，Codex / GPT-6）：新增表中 `ext-config.ts` 同链严格读取，因 remote MCP 的既有真值不在 JSONC；发布只消费已验 builder 结果。旧宿主计数按实际子用例同步（admission 17→20，reload 13→14），写通道枚举增加三条；没有 ext 生产改动，现有 force 传递足够。当前 12 个生产文件，约 50 分钟，仍在原估算内；未进入步骤 3–4。

- a/b/c 主进程证据：ui-mac `bun test --max-concurrency 2 src/main/package-admission.test.ts src/main/ext-set-state-tx.test.ts src/main/ext-write-channels.test.ts src/main/package-admission.wiring.test.ts src/main/package-admission.parity.test.ts src/main/package-mcp-oauth.wiring.test.ts src/main/package-builders-wiring.test.ts` exit 0，83 pass；具名新例覆盖先提交再开启、GitHub 关闭/开启态改密钥且不重装、root 驱动全部技能/连接器。相关配置/账本/安装/卸载七文件组 exit 0，434 pass；IPC/呈现/adapter 合同八文件组 exit 0，135 pass。
- d 主进程/force 证据：ui-mac `bun test --max-concurrency 2 src/renderer/extensions/package-install-engine-reload.test.ts src/main/package-installability.test.ts src/main/package-mixed-bundle.wiring.test.ts src/main/package-secret-recovery-wiring.test.ts src/shared/package-secret-prerequisite.test.ts src/engine-adapter/mcp-auth.test.ts` exit 0，69 pass；其中 `busy package switch forces the existing scheduler without a second reload action` 所在真 IPC 子集 14 pass，disabled OAuth complete/failed/expired adapter 子集 5 pass。ext `bun test src/plugin-reload-wiring.test.ts src/reload-scheduler.test.ts` exit 0，12 pass，含 `package state request with force reloads while an answer is still running`。
- bad-port 原断言保持：ui-mac `bun test --max-concurrency 2 src/main/mcp-server-derivation.test.ts src/main/ext-disabled-injection.test.ts` exit 0，12 pass；既有 `ext-package-detail-wiring.test.ts` / `mcp-needs-auth-wiring.test.ts` 两个 renderer 宿主 exit 0，2 pass。ui-mac `bun typecheck`、文档链接检查（4 条）与 `git diff --check` 均 exit 0。
- **PARTIAL · c/d 的关闭态 OAuth 真引擎证据**：新增 `package-mcp-oauth.engine.cases.ts:158` 未等配置插件就绪，实际宿主 exit 1（子用例 3 pass / 1 fail）。临时目录副本仅补就绪等待后，真实读回先 disabled/未登录、登录后 disabled/已登录，但 `:162` 的零请求断言失败（1 次）；计数包含引擎 `packages/core/src/mcp/oauth.ts:425–453` 必需的 OAuth `initialize` 发现请求，不能证明运行连接或工具启动。按 delivery-implement 红测规则，已提交的新断言有误应返回阻塞、不得自行修改；原测试与冻结引擎保持不动，交编排器纠正夹具就绪及运行请求计数边界后续证。上表该项的“握手为零”前提暂不成立，不将这条证明或真实服务验收记为通过。

2026-11-16 r2 · 编排器裁定仅纠正已提交的关闭态 OAuth 红测：先等配置插件就绪；未认证的 OAuth 发现请求单独计数，运行握手/调用仅计通过认证后的协议处理。经真实工具清单、credential connection、disabled 状态及同服务开启后实际工具执行作正反对照，未改产品或冻结引擎。临时观察插件只消费引擎公开插件工具面，运行在原 HOME/XDG/数据库沙箱；宿主按实际 4 个子用例同步。命令 `bun test src/main/package-mcp-oauth.engine.test.ts` exit 0（子用例 4 pass / 0 fail），解除 r1 的该项证据缺口；其他既有新回归断言不改。

r2 运行链补红（步骤 3 中发现步骤 2 缺口）：真实 Supabase 实样在初始化 main 环境后，remote 定义发布仍携带 `enabled:false`，被既有真值写器拒绝；发布成功后纯账本/技能投影也会碰到空 edits 的配置事务拒绝。新增 `package activation and switch work when main-owned remote definitions require no JSONC edits`：ui-mac `bun test src/main/package-admission.test.ts -t 'package activation and switch work when main-owned remote definitions require no JSONC edits'` exit 1，0 pass / 1 fail，真值列表未包含 supabase（Expected supabase / Received []）。该红测单独提交，随后修同调用链，不改专用真值、账本、配置事务权威或既有回归断言。

r2 重载状态补红：main 的包动作仅把 packageId 放进既有 reload items，而 Hub 的实际组件核验按 componentId 关联，失败报告无法归到包内运行状态。新增 `package reload requests address graph component identities`；ui-mac `bun test ./test-component/package-install-engine-reload.cases.ts -t 'package reload requests address graph component identities'` exit 1，0 pass / 1 fail（items 只有 package:supabase，缺真实图的三个 componentId）。同笔测试提交将旧桌面确认/前置填密钥断言改为直装与装后凭据动作，并隔离它们新增的连接刷新计数；保留 r1 的忙时 force 回归断言。


r2 步骤 3（2026-11-16，Codex / GPT-6）：以包图过滤全局组件行、保留同名项目条目；列表直装与同包管理、菜单开关/一次移除、分开 token/登录已接通。管理页「登录」一次点击即走原浏览器授权，关闭/失败后仍可继续；凭据字段使用规格精确文案，权限编辑复用现有设置面。包状态事件刷新实际 MCP/图，忙时复用 main 的 force 结果，不显示等待或另一个应用按钮。旧 standalone MCP、bundle、聊天/watcher 路线保持。补表外 `ext-presentation.tsx`/`extension-hub.css` 是批准帧的菜单 switch/读屏标签及两条组合样式所需，无新视觉方向；未改 install-confirm/ext-authz。修复前述两个已提交红测所揭示的 remote 真值 activation 字段、无 JSONC edits 的状态事务及 reload component 身份；本地导入的无目录声明包不再为读取账户去请求远程目录。旧平铺/安装确认断言改为直装/整包管理，toast 夹具通过真实关闭按钮清理，避免直接移除 DOM 破坏 Solid 所有权。实际生产文件累计 19 个（预计 20–24），r2 当前约 1.6 小时，未超估算。

- a/b/c 与 AC-10/14、AC-06/07 hub 侧：ui-mac `bun test --max-concurrency 2 src/renderer/extensions/hub-three-pages.test.ts src/renderer/extensions/local-package-renderer.test.ts src/renderer/extensions/ext-package-detail-wiring.test.ts src/renderer/extensions/package-install-engine-reload.test.ts`：exit 0，4 个宿主通过，分别实际执行 22/22/15/15 子用例。新增具名对照覆盖 五态单行、菜单唯一开关、真实用途/领取链接/password、关闭输入清空、无 canary 出现在 DOM/读回/配置/捕获日志、同包失败重试及一次移除。主进程七文件组（admission/wiring/parity/builders、state、write channels、ledger uninstall）exit 0，108 pass；相关 IPC/presentation/scope/watcher/auth 六文件组 exit 0，56 pass。OAuth 裁定修正后的宿主再次 exit 0，实际 4 个子用例；bad-port 文件和 r1 三个 DOM 新回归及 busy-force 新回归的断言逐段比较保持不变。
- 视觉核对：临时 `/tmp/hub-r2-visual/` harness 用真实 ExtensionHub/useExtensions/CSS、已验 GitHub/Supabase 安全视图及与 DOM 用例相同的边界替身，在 Chrome 1440px 实际渲染 list/menu/manage/token light + token dark；逐图对照批准帧/shot，未画新稿。待登录/令牌为名称旁提示，关闭/真实失败替换描述，菜单 switch、分组及密码 Dialog 沿用组件。截图保留临时目录供编排器复核，不将替身或截图计为真实服务验收。
- 命令偏离：曾误从仓根调用测试（root guard 直接拒绝、未执行测试）及 typecheck（exit 2：未改 `packages/codepuppy-ui/script/publish.ts:3` 的 `@opencode-ai/script` 解析失败）；没有修复/重跑全仓检查，本片证据仅取包目录命令。此观察交编排器，非本片修复项。


r2 步骤 4 · **PARTIAL / 技能运行身份范围阻塞**（2026-11-16）：新增表中独立生命周期宿主只为实际 main→ext→引擎证据，不新增产品机制或依赖。真实样本的下载/摘要、包图、配置/凭据及引擎均落临时 HOME/XDG/数据库；外部 MCP 传输复用 `packages/core/test/fixture/mcp-echo.ts` 的 SDK server，模型复用 scriptedModel，未手写第三方协议。main 的连接变更回调按生产同义重注入/重启同库引擎，通道实际进入既有 ext scheduler。包开关在真实 active Session 持有工具审批时完成应用，原审批清空、回答结束、工具没有被偷偷执行；未加等待机制。

- AC-10/12/13 连接器、local AC-03：`real desktop package lifecycle asks twice, applies a busy switch, and removes runtime entries`；ui-mac `bun test ./src/main/package-hub-lifecycle.engine.cases.ts -t 'real desktop package lifecycle asks twice'` exit 0，1 pass / 1 filtered out，52 个断言。真实 Session 调用同工具两次各出现 permission ask、逐次 reply once 后计数 0→1→2，生产 policy 用户记录前后相同；关闭后真工具清单为空，关闭态更换 token 没有新 initialize，重开工具可用；忙时开关实际中断，移除后同包 MCP/工具清单与图均无入口，Supabase 图/开启记录保留。此正对照不声称解决技能身份冲突。
- **未通过项及所需输入**：`real Supabase package exposes both enabled generation skills` 等 `opencode.config.skill` active 后，账本两个 skill 均 enabled，但 `/api/skill` 仅有 `supabase`，缺 `supabase-postgres-best-practices`。具名证明保留失败；完整新宿主 `bun test src/main/package-hub-lifecycle.engine.test.ts` exit 1（子用例 1 pass / 1 fail，54 个断言），失败唯一是上述缺项。最小证据链：`ext-transaction.ts:610` 的同事务、同首代 key 共用后缀，`packages/ext/src/gen-skill-paths.ts:77–80` 将这些真实 generation 目录交给引擎；`packages/core/src/config/plugin/skill-file.ts:44–47` 把 `SKILL.md` 的父目录名当 Skill.ID，`skill.ts:157–163` 以该 ID Map 去重，故两个同名 generation 静默覆盖一个。冻结包字节/目录投影不能在 renderer 修复；改变 generation 分配需修改未列入本片表的事务/账本权威，改 core 发现层则超出允许模块。未改这些权威、未伪造技能可用或跳过测试。需要编排器确认最小的托管技能稳定身份修复 owner/范围；修好后补齐同包全部技能启停/移除的真实库存对照。去向：当前片的 scope/contract 阻塞，不作为 OPTIONAL 或已完成行为。
- 步骤 3 已提交 `714aaabd53`；原三条 DOM 新回归、busy-force 和 bad-port 断言保持，唯一已提交断言修正仍只有 r2 裁定的 OAuth。其他新增额外文件/校准原因均已列表和上文。真实 Supabase 登录/GitHub token 由编排器后收，自动证据不冒充真实服务验收。没有推送、PR、merge、gate 或 bin/check。

收口检查（r2，2026-11-16）：ui-mac `bun typecheck` exit 0；文档链接检查 exit 0（4 条）；`git diff --check` exit 0。r2 实际约 1 小时 40 分钟，生产累计 19 文件，未超原规模/工时。步骤 3 已完成；步骤 4 除上述双技能运行身份及其全部技能启停/移除库存对照外已留运行证据，本片整体仍为 PARTIAL。


r3（2026-11-16）：编排器裁定 generation 身份冲突由本片的事务分配修复，core 保持冻结；沿现有八位十六进制后缀文法，在同事务以条目序号区分 generation 名称，无记录迁移。读取链只校验文法/指针/完整代号，未发现依赖共享后缀的 reader。新增真盘分配与全技能库存回归，既有 `real Supabase package exposes both enabled generation skills` 保持逐字不变。补红：ui-mac `bun test --max-concurrency 2 src/main/ext-transaction.test.ts -t 'skill generation names are distinct'` exit 1，0 pass / 2 fail（普通后缀及 ffffffff 边界均只有一个唯一代号）；`bun test --max-concurrency 2 ./src/main/package-hub-lifecycle.engine.cases.ts -t 'all package skills leave'` exit 1，0 pass / 1 fail（实际技能缺 supabase-postgres-best-practices）。继承原宿主亦 exit 1，原缺项重现。新用例复用真实包字节与既有事务内部夹具，先提交红证据再改分配；本轮仍按 `--max-concurrency 2` 运行相关检查。


r3 generation 修复：分配调用点已有 item index，以它对 tx 后缀作无符号加法；同一数组各 slot 的后缀唯一，含 ffffffff 进位，既有读者文法不变。ui-mac `bun test --max-concurrency 2 src/main/ext-transaction.test.ts src/main/ext-skill-generations.test.ts src/main/ext-receipt-v2.test.ts src/main/ext-package-ledger-uninstall.test.ts` exit 0，193 pass；真实引擎前两个既有用例均绿，双技能缺项已消除。新增全库存用例已走完双技能 off/on/移除，但最后发现更换 GitHub 凭据后的旧记录：`savePackageSecretsV1` 调 `commitTransactionLedger` 的 standalone 分支，`ext-receipt-v2.ts:1013` 会新增 standalone owner；包移除遂保留该 record。现有 package mutation 对相同 graph digest 在 `ext-receipt-v2.ts:1539` 直接 replay，不能拿不变图冒充一次凭据更新。该失败断言保留，不改写冻结账本权威；先完成独立呈现接缝，再交回明确的“包内凭据更新保留原 claim”写入接缝缺口。


r3 呈现接缝补红：ui-mac `bun test --max-concurrency 2 ./test-component/hub-three-pages.cases.ts -t 'graph marketplace source|openPackageManagement opens'` exit 1，0 pass / 2 fail；真实 Solid DOM 缺 Claude 来源标签，`openPackageManagement` 尚未导出。夹具复用真实 GitHub/Supabase 安全视图，在 main→renderer 边界按 DESIGN v5 §4.4 加受控 source/notRunning 字段变体（不是第三方 manifest）；仓库与短提交取设计 E-02 的捕获记录。具名用例同时要求 row/manage 显示原因、同一 packageId 的管理页与现有菜单路径一致，不触发安装/启停；旧回归断言不改。


r3 呈现实施偏离：按续派 v3 规格 @8663fb2、宽目标 design v5 @8bd3075 仅 §4.4 补 metadata；新增表内 ext-package-presentation/ext-hub-state 接线，preload 的 InstalledPackageV1 增 `source?: PackageSourceV1`、`notRunning?: PackageNotRunningV1[]`，两个类型及 NotRunningReasonV1 只在 shared/package-admission 定义，片 A main 可直接消费，未复制另一套来源判断。`installedPackagePresentation(pack: Pick<InstalledPackageV1, "source" | "origin" | "notRunning">)` 导出 sourceKey/sourceDetail 与 notRunning 的 sourceName/reasonKey；已装行与现有管理页复用，来源缺席沿当前 origin 标签，关于显示仓库/提交/路径、注册表名/版本或 npm 名/版本。六种未运行原因只翻译结构化 reason，不解析 message。`openPackageManagement(packageId: string): void` 从 ext-hub-state 导出；单次导航目标进入现有 managedPackageId，开 connectors 并打开精确安装身份，不调安装/启停/授权。关闭清掉未消费目标；未安装目标回列表，不打开另一包。补冷态测试使用与生产一致的 #root Portal 容器，无额外等待/调度机制。以上改动与本段同笔提交；其余 wider design 小节及来源搜索/主进程安装入口仍不在本片。


r3 收口（Codex / GPT-6，约 40 分钟，生产累计 22 文件，仍在 20–24 估算内）：

- 决定 1 / AC-12 技能：`bun test --max-concurrency 2 ./src/main/package-hub-lifecycle.engine.cases.ts -t 'all package skills leave'` exit 0，1 pass / 2 filtered out、14 个断言，真实两技能内容读取、整包关闭清空、重开恢复两项、移除清空技能/MCP/图/记录均成立；普通及后缀进位分配、generation probe/读者/清理四文件组 193 pass，配置/file/prepared/recovery/journal/uninstall 六文件组 122 pass，均 exit 0；ext 包 `bun test --max-concurrency 2 src/gen-skill-paths.test.ts` exit 0，11 pass。原 `real Supabase package exposes both enabled generation skills` 与新提交的 generation/全库存回归文件逐字保持，bad-port 原断言亦不变。
- 决定 2 / AC-14，AC-10 行与菜单：ui-mac `bun test --max-concurrency 2 src/renderer/extensions/hub-three-pages.test.ts src/renderer/extensions/ext-package-presentation.test.ts src/renderer/extensions/use-extensions-ipc.test.ts src/renderer/extensions/ext-ipc-chokepoint.test.ts src/renderer/extensions/install-scope-wiring.test.ts src/renderer/codepuppy-ui/hub-install-watcher.test.ts` exit 0，58 pass（Hub 实际 25 个子用例）；`ext-package-detail-wiring`/`local-package-renderer`/`package-install-engine-reload`/`mcp-needs-auth-wiring` 四宿主组 exit 0，4 pass；`src/renderer/sidebar/overlay-close.test.ts` 与 `src/renderer/codepuppy-ui/ext-trust-watcher.component.test.ts` 两宿主 exit 0，2 pass。关窗/冷态管理入口、已有管理/凭据/开关/原关闭流程均被实际 DOM 触达。共享 source/notRunning DTO 仅类型过线；片 A 负责真实 main 数据投影。
- **PARTIAL · 剩余 AC-12 凭据更换后的整包移除**：ui-mac `bun test --max-concurrency 2 src/main/package-hub-lifecycle.engine.test.ts` exit 1，子用例 2 pass / 1 fail、67 个断言；双技能发现及原 connector/两次审批/busy force 均通过，第三例最后 `after.records === []` 失败，遗留 `mcp:github`。宿主按已实际执行的三例把成功计数同步为 3，失败来自子用例，不跳过/放宽断言。这是本片新增 `savePackageSecretsV1` 使用 standalone upsert 的缺陷：事务 commit 未携 package mutation，`ext-package-ledger-commit.ts:26` → `ext-receipt-v2.ts:1013` 给原包组件新增 standalone owner；existing `applyPackageMutation` 又在 `:1539` 对同图直接 replay，无法沿它落一次同图凭据更新。最小所需合同：账本写入方允许包内凭据更新真正落记录且保留原 graph/claims，再由该调用链消费；不能伪改内容 digest、先写再删 claim 或在 renderer 补清理。r3 仅授权 generation 分配及同链 reader，未授权这一冻结写入合同，故未改写器。遗留交 #1724 编排器裁定该接缝后续作；这不是新的 generation 读者阻塞，也不是 OPTIONAL。
- `bun typecheck`、`python3 scripts/check-doc-links.py docs/specs/local-plugin-install/plan.md`（4 条）、`git diff --check` 均 exit 0。AC-06/07 既有授权/密码输入证据按 r2 已验收收据继承，真实服务验收仍后收；AC-13 立即应用由本次原生命周期子例再次验证。无 core、源数据、专用密钥存储或权限权威改动，无迁移、gate/bin/check、推送/PR/merge。


r4 A 补红（2026-11-16）：ui-mac `bun test --max-concurrency 2 src/main/package-admission.test.ts -t 'package credential replacement preserves'` exit 1，0 pass / 1 fail；仅经原包保存/更换令牌，claims 多出 standalone:mcp:github。新例同时要求 graph/claims 不变、成功后旧版本删除、exact replay 字节不变、落账失败旧值仍可用；继承 r3 全生命周期失败断言不改。r4 明确授权在现有单一账本写入及事务/恢复链表达同图凭据更新，未新增记录族或迁移。


r4 A 实施：同图的 MCP 凭据 update 由原 applyPackageMutation 按 child transaction identity 判新写/重放，保留原 graph/claims；savePackageSecretsV1 携既有 package mutation 进入原 journal/commit/recovery，不新增 writer/记录族。成功发布后沿原资源清理权威删除旧版本；失败不清理。`bun test --max-concurrency 2 src/main/package-admission.test.ts src/main/ext-package-ledger-v3.test.ts src/main/ext-package-ledger-commit.test.ts src/main/ext-receipt-v2.test.ts src/main/package-secret-recovery-wiring.test.ts` exit 0（实际四文件 112 pass）；`bun test --max-concurrency 2 src/main/package-admission.test.ts src/main/package-hub-lifecycle.engine.test.ts` exit 0（23 pass，生命周期实际三例全绿）；`bun typecheck` exit 0。继承 r3 生命周期失败断言未改。A 的原接缝阻塞解除，官方连接器发布/保存态审查项另续。


r4 B2/B3/B4 补红：`bun test --max-concurrency 2 ./test-component/official-connectors.cases.ts -t 'desktop official'` exit 1（0 pass / 2 fail）：missing-token 重启恢复后 saved 误为 true，official 安装带 reserved-name 发布警告。`bun test --max-concurrency 2 ./test-component/hub-three-pages.cases.ts -t 'official credential dialogs'` exit 1（0 pass / 1 fail）：真实随包 DBHub 条目的 DSN 说明缺失；同例要求 PAT 说明及凭据保存失败文案。测试复用既有官方 recipe 加密边界及真实 bundled catalog，不放宽原生命周期断言。


r4 审查处置（Claude Opus 5.5，只读 range `origin/alpha...5b46447823`，round 1/1，FIX-THEN-MERGE；本片只闭合已接受 finding）：B2 以官方引用版本的 `connector-secrets/<ver>/secret.enc` 判 saved，空 runtime 不再冒充凭据；B3 复用官方 DSN/PAT 两段说明与 placeholder，保存失败用凭据文案；B4 通用 publish 跳过 official，沿原 projectOfficialConnector 在 commit 后发布新引用再恢复/清旧版本（仅导出原函数，不添第二 writer；也修复 A 的官方更换版本同链引用）。新具名 official 三例 exit 0（3 pass），Hub 实际 26 例 exit 0。B5 删除两条 ledger “always” 无效断言及虚假测试名承诺，永久允许证明继续由真实生命周期 policy store 前后相同承担。B6 恢复详情页会装/不会装、必需/可选、逐字 skip reason 及两条 #765 flush 后 exactly-one toast。B7 真实 directory 路由下加入同名 project skill，断言 project 分组内仍有行。B8 保留 IPC 未完成时，用当前仍连接 DOM 的第二次已接纳 activation 验 guard，不再点击 detached 节点。临时摘除 packBusy guard 后具名 case exit 1（移除调用 2 次），恢复生产代码；Hub/detail 两个隔离宿主组 exit 0（2 pass，实际 26/15 子例），`bun typecheck` exit 0。新回归断言未改。

相关官方全文件检查暴露未改边界：`test-component/official-connectors.cases.ts:586` — 将 TMPDIR 设为 HOME 后 officialRuntimeRoot 未抛 needs-reentry，独立具名确认仍 exit 1（0 pass / 1 fail）；该运行目录实现本轮仅导出另一函数、此边界未改，不作为凭据修复通过证据。去向：编排器安排既有 runtime-root 环境边界问题；不扩修。

r4 仅记录的遗留（续派明确排除）：`package-admission.ts` — busy 时直装未 force，交 helper 片 runtime MCP add；`readPackageAuthorizationV1` — MCP 状态刷新逐包重取远程 catalog，交 intent；`resolveInstalledPackage` — 授权读取依赖已装版本仍在当前 catalog，交 intent；`ext-config.ts:536` — remote truth 损坏也会阻断 local MCP 严格读，交 intent。以上均无代码改动。


r4 B1 补红：`bun test --max-concurrency 2 ./src/main/package-hub-lifecycle.engine.cases.ts -t 'cloud-only package switch|package command switch'` exit 1（0 pass / 2 fail）：真实云 MCP 关闭后仍 connected；真实 mixed-bundle 的 command 在直装内容落关闭阶段被旧 R4-1 拒绝。夹具复用 HOST_EXTENSION_PACKAGE_CORPUS 的 cloud-v1 原字节、producer-derived mixedBundleFixture 与 core SDK echo handler；云 fixture 的 server 名用启动文档已支持的 hub-cloud，避开既有 codepuppy_echo 工具名碰撞，不改协议或引擎。新增两条 inventory 正反对照要求开→关→开的真实工具/command 清单；原三条生命周期行为断言保持。

B1 同链补充：`packages/ext/src/plugin.ts:333` 的既有 kill-switch rearm 也会从 bootstrap 重装云 MCP。把新生命周期夹具的既有 killSwitch 输入置 true（行为断言不改），具名 cloud switch 再次 exit 1，off 后仍 connected；修复需让该调用点消费 main 有效注入中 server 是否存在，不复制账本判断、不改 bootstrap schema。此 ext 同调用链由 r4 B1“真实 off”覆盖。


r4 B1 实施：在既有 engine-explicit-config 读取已验包图和 root 状态，一处派生 disabled 组件；云注入与 command 有效声明共同消费。command 内容保留、合成文件撤下，开启恢复；云 off 时无注入、on 时继续原 billing/kill-switch 条件，ext 只消费 main 有效条目的在场性而不重算账本。未新增 scheduler/轮询/flag、确认或等待，core 与 ext-config 未改。旧 command builder “disabled 即拒绝”断言正是本次取代的行为，改为验证内容保存；原 standalone 无启停面拒绝不动。表外文件均为上述有效声明调用点/同链测试，加入本表；原 22 个生产文件增加 engine-explicit-config、codepuppy-config-injection、official-connector-resources、ext/plugin 四个，共 26（r4 续派新增范围；另有复用 bad-port 的 2 个生产文件，相对 origin/alpha 共 28）。

- B1 正反对照：`bun test --max-concurrency 2 ./src/main/package-hub-lifecycle.engine.cases.ts -t 'cloud-only package switch|package command switch'` exit 0，2 pass / 13 断言，含 kill-switch rearm；关闭后实际云 server/工具消失、command 声明消失，重开恢复。新增夹具发现原 refresh 的 Object.assign 会保留本次缺席的启动键，已改成与 sidecar 一样替换整份 content；只修夹具前像，所有既有/新生命周期行为断言不改。
- B1 相关：explicit/builder/admission/parity/wiring 五文件组 exit 0，44 pass；注入/header/websearch/throat/derivation/bad-port/recovery/state/write-channel 九文件组 exit 0，117 pass。ext 云/host/reload 四文件组最初 82 pass / 1 fail，是身份测试缺 main withheld 前像；仅补该真实前像后 plugin-host exit 0，41 pass，原断言不改，ext `bun typecheck` exit 0。
- A 官方资源补证：`bun test --max-concurrency 2 ./test-component/official-connectors.cases.ts -t 'desktop official|real admission commits|package-owned encrypted'` exit 0，4 pass / 36 断言；实际加密版本连续更换后旧目录不存在，注入 ledger commit 失败后旧 runtime 值/密文仍可用、graph/claims 相同。官方宿主计数随实际测试定义增为 13，未绕过已有 TMPDIR 失败。
- 新证实的既有失败：`src/main/codepuppy-config-injection-engine.cases.ts:240` — C7 反向臂去掉 provider.use 后没有出现额外 provider（Expected true / Received false）。相关宿主 exit 1，23 pass / 1 fail；临时恢复本次改动的 injection/explicit/ext plugin 为 HEAD 基线再执行同一 24 例，仍 exit 1，23 pass / 1 fail，同一 :240（日志 `/tmp/hub-r4-injection-baseline.log`），随后已恢复本次改动。不修 provider/模型数据或该断言；去向：编排器安排既有 C7 证据缺口。其余真实引擎宿主（生命周期、插件 policy、command visibility）在该组均通过。
- B7 删除 project 分支的临时反向检验 exit 1（同名行数 0，期望 1），已恢复；B8 删除 guard 的反向检验亦红，故两个补证都能检出行为缺失。


r4 收口（Codex / GPT-6）：`bun test --max-concurrency 2 src/main/package-hub-lifecycle.engine.test.ts src/main/package-mcp-oauth.engine.test.ts src/renderer/extensions/hub-three-pages.test.ts src/renderer/extensions/ext-package-detail-wiring.test.ts` exit 0，4 宿主 / 0 fail，实际 5/4/26/15 子例。AC-10 五态单行/直装/无永久 allow、AC-12 全技能/连接器/云/command 启停及更换密钥后整包移除、AC-13 真实 busy force 中断、AC-14 同包管理/真实来源、AC-06/07 hub 的登录/token 分开与取消/继续均有具名证据；真实服务凭据验收仍由编排器后收。ui-mac 和 ext `bun typecheck` 均 exit 0；文档链接检查 4 条与 diff check exit 0。当前约 50 分钟，未达原 40 分钟的两倍；B1–B8 处置及新增范围已记录。没有 core、ext-config 新编辑、公开 schema/Protocol、权限 evaluator、迁移、发布或 gate/bin/check。已知两条独立失败保留原断言，交回其既有责任链，不影响本轮 AC 证据。


r5 C7 ship 前置修正（2026-11-16）：续派在干净 origin/alpha 的诊断确认 models.file 限定 ModelsDev 只读 Code Puppy 投影，旧反向臂的外部 provider 只可能来自机器上正在运行的 LM Studio/Ollama；这是测试前提缺失，非产品缺陷。仅在 codepuppy-config-injection-engine.cases.ts 提供 C7 使用的既有 LM Studio 发现样本（来自 core/test/plugin/provider-lmstudio.test.ts 首个 language-model 输入），文件 beforeAll 在任何引擎启动前提供 127.0.0.1:1234，文件 afterAll 在引擎关闭后只关闭自有 server；EADDRINUSE 时仍执行原真实发现/断言，消费已有服务。正向臂与原断言逐字不改，产品/core/投影 provider/model 数据不改。修前 `bun test --max-concurrency 2 ./src/main/codepuppy-config-injection-engine.cases.ts -t C7` exit 1（3 pass / 1 fail）；修后同命令 exit 0（4 pass），已有兼容监听服务的独立对照亦 exit 0（4 pass）。临时让反向臂保留 injection.config.content 的 provider.use（仍不传显式文件） 后同命令 exit 1（3 pass / 1 fail，外部 provider 仍不可见），已恢复变异。原 official-connectors TMPDIR/HOME 观察按 r5 收据消解：direct cases 的 Bun process-start HOME 造成假红，应运行既有宿主；宿主已由编排器确认绿，本轮不改该链。

修正过程补证：首次仅在 C7 组前启动时，C7 子集已绿，但完整宿主仍 exit 1（23 pass / 1 fail）；原因是前面的 S6 引擎已经把无本地服务缓存进进程级 discovery。最终 fixture 提前到文件 beforeAll、所有引擎之前；未改缓存实现、前置等待或断言。

最终宿主 `bun test --max-concurrency 2 src/main/codepuppy-config-injection-engine.test.ts` exit 0（1 宿主 pass，实际 24 子例 / 0 fail）；启动前 lsof 确认 1234/11434 均无监听。最终 setup 的已知坏变异只把反向臂 content 换回原注入内容、仍不传显式文件，同一 C7 命令 exit 1（3 pass / 1 fail，Expected true / Received false），已恢复。ui-mac `bun typecheck`、计划链接检查及 `git diff --check` exit 0。改动仅测试 setup 与本段证据，无 gate/bin/check 或产品变更。


r6 ship 前置（2026-11-16，按 Claude Opus 5.5 对照干净 origin/alpha 的 class B 分类及续派授权）：B1 判断是测试缺 main 前像，产品条件正确。`codepuppy-config-injection.ts` 在 owning root off 时不注入云 server；`ext/plugin.ts` 只重装有效条目正是避免关后复活。context-injection 的测试输入改用既有 WITHHELD_CLOUD_MCP 常量，原注入断言保留，并在同例证明无 main 条目时 server 缺席。修前 `bun test --max-concurrency 2 src/context-injection.test.ts` exit 1（42 pass / 1 fail），修后 exit 0（43 pass）；未改产品。B2/B3 注册生命周期宿主，实测外层 1 / 子例 5；B4 wiring 子计数同步 22，补 17→22 来由；B5/B6/B7 登记精确值同步为 22/6/5。B8 外部 LM Studio 协议 stub 的 pathname 与局部常量比较，保留 Alpha route-authority 棘轮原规则。B9 真实 hub fixture 的 impharaon/alpha-web 按 external-anchor 精确登记 1 处，不改样本字节。B10 安全 DTO 键表增加 desiredState 并断言 disabled。locale 按唯一 allowlist 注册外部生态来源 key，source scan 仅扣除登记翻译行与其字面 key 引用，保留其它文本扫描；临时未登记品牌 JSON probe 仍使该用例 exit 1（0 pass / 1 fail），已清理。

相关核对：ui-mac `bun test --max-concurrency 2 src/main/package-admission.wiring.test.ts src/main/gate-file-registry.test.ts src/shared/route-authority-ratchet.test.ts src/main/old-name-scan.test.ts src/main/local-package-channel.test.ts src/renderer/i18n/locale-regression.test.ts` exit 0（91 pass / 6 文件）；admission/presentation/mcp-auth/生命周期四文件组 exit 0（34 pass = 22+6+5+1）。ui-mac 与 ext `bun typecheck` 均 exit 0。

仅按 r6 授权各执行一次相应包级/逐文件步骤，进程带 `GATE_ALLOW_FULL="gate diagnosis: steps skipped by short-circuit in PR 1725 gate"`，未调用整个 gate：

- `bash scripts/bun-test-floor.sh 100 packages/ext` exit 0，585 pass / 0 fail（51 文件）。
- `CODEPUPPY_KNOWN_FAILS_FILE=scripts/known-fails.tsv bash scripts/bun-test-floor.sh 3000 packages/ui-mac src` exit 1，6666 pass / 1 skip / 3 fail（525 文件）；仅分类报告的 M1–M3，未发现新分支失败，未改 known-fails。日志 `/tmp/hub-r6-ui-whole.log`。
- `bash scripts/bun-test-app.sh` exit 0，整包 725 pass / 0 fail（105 文件），另 9 个补丁拥有测试文件 / 72 条逐一精确相符。
- `bash scripts/assert-gate-files.sh` exit 0，352 个文件全部在位、通过且精确计数一致；新生命周期宿主 1、admission 22、presentation 6、mcp-auth 5。日志 `/tmp/hub-r6-gate-files.log`。同轮此步骤的 network-egress-proxy / net-failure-real-stack / schema codepuppy-net-failure 分别 23/5/20 pass，均 exit 0；这是后续逐文件实测，不冒充前述 ui-mac 整包 exit 0，也不重跑已授权一次的整包。

M1–M3 本次整包的具名记录（去向：编排器的机器条件处置，本片不改 DNS 或共享主 checkout）：`其它失败形态各自可辨,且都不转发 > 登记了但解析不了(.invalid)⇒ 503 dial-failed ENOTFOUND:DNS 在代理进程里发生,失败也在这里可读`；`六个 webfetch 都经出网代理失败,并作为工具记录落库`；`持久化记录的 metadata.codepuppyNetFailure:policy / dns / tcp / tcp / tls-silent`。后两条父组为 `#1572 AC4 真栈:Electron 内嵌 node + 真出网代理 + 真 webfetch ⇒ 持久化的工具记录带层`。M4 本轮逐文件检查已绿。r6 偏离仅为授权的测试/登记同步与本段证据，无生产改动、依赖、接口、迁移或额外放宽；class B 全部闭合。已核 Codex / GPT-6。

## 片 2 · #1762：市场插件整树安装与技能路径

- 依据：#1762；local-plugin-install 规格 v4 @ `9f5ee3c`（内容批准于 v2/v3），AC-09、AC-02 的技能与资源部分；同名设计 v2 @ `9f5ee3c` §4.1、§4.2、§4.3 的技能语义、§8 第 2 片的桌面部分。并消费 plugin-helper-and-hub 设计 v9 @ `8721a7667f817503dc4ad6eaa4f942c881b398e6` §4.1、§4.3、§4.4 对当前入口、转换产物放置、宿主命名与范围的修订。权威链接沿用本文片 1 及[来源扩展计划](../plugin-helper-and-hub/plan.md)中的协调仓链接；不重述设计决定。
- 核对：IMPLEMENT — fea5b56acc · Claude Opus 5.5 (orchestrator) · plan accepted: every AC has a failing-without-behaviour proof from pinned real samples, files stay inside the allowed scope (the packages/ext files are justified same-call-chain), no frozen decision restated or changed.
- 本片只接市场 Claude/Codex 包的整树内容与技能运行路径。命令、助手、hooks 的文件随树保存，运行与相应诊断沿切片 3/5；不认领 AC-02 全项。renderer、folder/Git 取源入口、原生文件引用、市场列表、其他仓库和 gate 不在改动面。不处理已安装记录迁移；需要验证新装时用干净临时根。
- 基线：`HEAD = origin/alpha = 9f08c506d9842d319616c7e45c33d3b9c3279e48`，Bun 1.4.4。计划阶段起于 2026-11-26 10:59（UTC+08:00）；预计 45 分钟。实施预计 L，约 24–30 个手写生产/合同文件（按需项不一定同时改）及对应既有测试、压缩夹具，约 1,000–1,600 行手写改动，生成物另计；预计 4–6 小时。每完成下方一组 AC 证据核对规模与用时，达到预估上界两倍即返回具体原因。

### 当前代码核对

| 位置 | 本片依赖的事实与落点 |
| --- | --- |
| `packages/ui-mac/src/shared/host-extension-package-contract/plugin-conversion.ts:21–26,93–103` | 已有 `TreeNode`、`Capture`、`Text` 与 `convertPluginTree`，含目录 mode、文件 mode/digest、symlink target 和两种路径绑定；v9 G-04 是历史基线，不能据其零命中结论重写转换库。 |
| `packages/ui-mac/src/main/plugin-sources.ts:654`（`readArchive`）、`:386`（`captureFolder`） | 现有取源保有 mode、目录和 symlink。市场取源已在；本片复用捕获结果，不另建 reader，也不扩取源入口。 |
| `packages/ui-mac/src/main/install-from-source.ts:161–171,212–246,325–339,500–525` | 先按 `needsPluginFiles` 丢 entry，再逐技能只提升目录内普通文件；包图 root 是第一个组件。临时目录实际调用 `createSourceInstaller`：固定 remotion 共发现 12 技能，仅装 8，另 4 项为 `needs-plugin-files`；plugin-dev 7 技能仅装 3；claude-security 1 技能导致 `nothing-runnable`。不采用派工描述中的“8 个”作为固定总数，验收该提交的全部 12 个。 |
| `packages/ui-mac/src/main/ext-cas.ts:267`、`ext-transaction.ts:78,100,715–733,772–811`、`ext-health-probe-router.ts:73` | 文件清单没有 mode/链接节点，物化只写文件；事务 verify 拒所有 symlink，generation probe 一律按独立技能探测。整树须接入这些既有事务点，单改拒收条件不能通过安装。派工列的 `claude-plugin-install.ts` 在本基线已不存在，其现行责任在 `install-from-source.ts`。 |
| `packages/ui-mac/src/main/ext-package-ledger-v3.ts:72,291,304`、`ext-package-lifecycle.ts:35,55` | 账本已有 `bundle` kind，但尚无 `pluginTree`；profile→kind 的唯一表尚不含聚合 profile，必须同步其类型、解码、摘要和 builder 分派。 |
| `packages/ext/src/gen-skill-paths.ts:15,68`、`package-scope.ts:53`、`plugin.ts:143,493` | 技能发现与受管身份仅识别独立 `skill--…` generation；只把路径换到 bundle 会漏发现并绕过既有范围判定。已有 `skill.transform` 和 `SkillEditor.update`，可消费树内真实路径并渲染调用内容，无需改引擎 API 或换引擎代际。 |

上述是已批准整树能力的未实现点，没有发现冻结合同与当前调用面的事实矛盾。K1/K2（[架构约束](../../architecture/constraints.md)）要求继续复用唯一转换库、账本写器、健康探针路由和允许集判定；运行层不得重新发现 provider 清单或镜像账本 decoder。

### 改动

以下路径省略 `packages/ui-mac/` 前缀；明确写 `packages/ext/` 的行是必要的同调用链文件，理由是上表的技能发现、范围与调用绑定仍由它持有。

| 文件 | 改什么 |
| --- | --- |
| `src/shared/host-extension-package-contract/plugin-conversion.ts` 及生成的 `.mjs` / `.d.mts` | 复用规范化树与绑定，补足本片实际发现的技能/资料解析；普通资源不按脚本、目录或引用类型过滤。保留既有宿主名称转换，只在安装副本处理名称，绝对运行路径不写进公开转换结果；需要的新纯 helper 按插件/技能概念命名。 |
| 同目录 `registry.ts`、`host-extension-package.registry.v1.json`、`decoder.ts`、新 `profiles/plugin-package.v1.schema.json` | 实现设计 §4.2 已定聚合 profile 的接受边界；复用 `PluginPackage` 与 `PackagePayloadRefV1`，校验节点、树摘要、entry 与非空文件 blob 的对应，允许空文件/空目录。禁止另写一套 provider 格式。 |
| 同目录 `CONTRACT.md`、`generate-artifact.ts`、`testvectors/decoder-corpus.v1.json`、`host-extension-package-artifact.v1.json` 及必要的 envelope schema 枚举 | 同步新增 profile 的合同说明、真实样本派生语料、文件列表和摘要。转换器继续由自己的 generator 产出；不把它顺带发布给尚未接入的消费方。 |
| `src/main/ext-cas.ts`、`ext-transaction.ts`、`ext-health-probe-router.ts`；必要时 `ext-atomic-fs.ts` | 在现有 generation/journal 路径支持声明的完整树：内容寻址文件、目录、mode、链接；校验用 lstat/readlink，不跟链接写入或遍历，按已定链接语义重定位包内绝对目标。恢复使用同一树校验与 probe；不为整树复用技能 Markdown 资产上限或另加数量帽。 |
| 新 `src/main/plugin-package-install.ts`、`ext-package-tx-builders.ts`、`install-from-source.ts` | 新模块只负责把已转换的一个插件树和宿主映射构造成既有包事务，供来源入口及 profile 安装复用。一次准备 bundle 树和组件记录；技能引用树内目录，不再各复制一份。替换本片技能的 `needs-plugin-files` 分支，继续给真实无效定义和未接运行的种类原有结构化结果；安装不执行包内代码。 |
| `src/main/ext-package-ledger-v3.ts`、`ext-package-ledger-commit.ts`、`ext-package-lifecycle.ts`、`ext-receipt-v2.ts`、`ext-package-uninstall.ts`；`src/shared/plugin-install.ts`、`package-admission.ts` 的必要内部类型联动 | 接入已定 `pluginTree` 关联、bundle root、完整图摘要与 claims，root 状态驱动组件和原有允许集；树资源及规范化描述随同一 generation 提交/移除。装后返回仍只列可运行 skill/MCP，不把 bundle 当用户入口；不改 renderer DTO 形状，不另存包状态或新账本。 |
| `src/main/package-installability.ts`、`package-admission.ts` 及 `ext-package-lifecycle.ts` 的 profile 路由 | 新 profile 解码后的资源提升、admission 绑定和 builder 分派进入同一整树实现；绑定覆盖树、语义与 entry，不能只覆盖外层 root。仅补宿主内容安装接线，不做发布、签名或商店条目。 |
| `packages/ext/src/gen-skill-paths.ts`、`package-scope.ts`、`plugin.ts`；新 `packages/ext/src/plugin-package-skills.ts`（及所需纯共享绑定 helper） | 从已安装资源描述与 live 指针取得明确 skill entry 的真实目录；规范化描述和宿主映射跟同一树资源走，不在 ext 重读 manifest。包树路径进入现有受管技能正向判定；`skill.transform` 按每个包/技能渲染 instruction 的绑定，真实 `Skill.Info.path` 保持在对应树内。两包不得共享可变 ROOT/SKILL_DIR 环境；项目路径仍取当前 Location。新模块只收拢这段必要读取/绑定，不持第二份状态。 |
| `test-fixtures/plugin-helper/` 的归档、provenance、`fixture.ts`、`source-fetch.ts`；各受影响模块既有 `.test.ts` | 补下表固定提交的真实文件，归档保存原始层级、mode 和摘要，外来 Markdown 仍只在临时目录解压；补最小相关常驻回归，完整样本验收另记一次性命令/结果。`captureFixture` 目前把所有文件 mode 固定为 0644，改为消费归档元数据，不用它证明执行位。 |

**宿主 artifact 影响**：`plugin-package@1` 会改变本仓宿主 registry/decoder/schema/corpus 与 aggregate 摘要；后续消费仓必须单独升级 host pin 并验证其编译/发布路径，本片不改消费仓、不重签已发布内容。v9 §4.3 暂不把转换库加入发布 artifact 的安排继续适用；新增 profile 必需的类型依赖须在本仓 artifact 内自足，不能把 Electron、源码别名或协调仓路径带入产物。现有发布检查若要求合同版本递增，同步该版本与生成物，不修改检查。

### 顺序

1. **真实样本与红测**：按下表收录归档和 provenance；在 `plugin-conversion.test.ts`、`install-from-source.test.ts`、`ext-cas.test.ts` 的既有文件增加最小回归。先逐例运行并保存当前失败；回归测试独立提交，随后修复提交不改其正确断言。编码旧“拒绝带包内文件技能”的旧断言在替换行为时一并调整，不并存冲突语义。
2. **整树合同与事务**：实现 profile/decoder、完整树物化与 journal/verify/probe，补 `package-envelope-v1.test.ts`、`host-extension-package-artifact.test.ts`、`ext-transaction.test.ts` 的对应案例。先跑新增 case，完成后各行为文件完整跑一次；检查链接节点未被当 blob 读取、mode 在文件完成后恢复、错误不触碰 live 树。
3. **包安装与持久关联**：接入共用整树 builder、bundle root、图摘要/claims、admission、内容返回及既有开关/移除。跑本步改动的 `install-from-source.test.ts`、`ext-package-ledger-v3.test.ts`、`package-admission.test.ts`、`package-installability.test.ts`、`ext-package-ledger-uninstall.test.ts` 对应案例及文件；不扩展命令/助手/hooks 运行。
4. **技能路径与调用绑定**：接通 ext 的发现、受管身份、`skill.transform`，覆盖两包隔离、同名宿主映射、全部项目/仅当前项目和包关闭。按模块在 `gen-skill-paths.test.ts`、`package-scope.test.ts`、`plugin-host.test.ts` 与新模块对应测试中验证；从实际注册的路径/content 读取资料，不仅检查 outcome 的 enabled 字样。实施第一笔填本片“核对”，每笔偏离同时更新本片。
5. **一次性真实验收与收尾检查**：用完整固定样本从现有市场候选→安装入口完成下表验收，命令和输出交编排器，不把整个样本回放永久放进 PR 常驻测试。按实际改动导出查一次直接消费者（`rg -l 'createSourceInstaller|buildSkillTxItems|PackageProfilePayloadV1|packageChildKindV1|skillGenerationLiveDirs|managedSkillIdentity' src ../ext/src -g '*.test.ts'`，在 `packages/ui-mac`，按模块依赖确认并去重），返回前只跑一次较宽相关集，含 `package-child-kind.fast.test.ts`、`package-update.test.ts`、`package-admission.parity.test.ts`、`engine-explicit-config.test.ts` 和受改动影响的事务/GC 消费测试。各改动包执行 `bun typecheck`，两个 generator 执行 `--check`；运行 `bun test src/main/old-name-scan.test.ts`、文档合同检查及 `git diff --check`。不运行全包、全仓、gate 或 `bin/check`，不启动 App/Electron，不推送。

### 风险

- 完整树的隐蔽回归点是 staging/recovery 假定“全部常规文件”、typed probe 假定“generation 就是一个技能”，以及 CAS GC 对 journal 文件摘要的读取。以最小含空文件、目录、真实脚本和包内链接的样本测物化/校验/提交，恢复与正常提交消费同一声明；若 journal 表示联动，带上既有 `ext-cas-gc.test.ts` 的对应验证，不另开存储路径。
- 资源保留不能等于全部入口已运行：plugin-dev 的 command/agent 文件应读到，但 `notRunning` 仍如实标记切片 3/5 未接的入口。规范化树先经现有秘密 replacements 再入 CAS，不能因“原样复制”留回原始秘密文件；沿既有密钥测试验证这条链，不扩大本片凭据产品范围。
- 指到 bundle 后若没联动 ext 的受管身份，关闭/项目范围就会失效；因此路径注册与现有允许集判定同一步落地，不以临时放开受管识别作为过渡。只复用现有 `skill.transform`，不切换任何 `session.*`/`v2.session.*` 生产路径。
- 不用空脚本或自造插件证明可用。Superpowers 的跨技能脚本采用其真实计划作输入，在临时 Git 项目运行；构建与 `.git` 资料分别来自真实构建命令与 Git 产生的目录，不手写伪格式。链接/执行位变更只施加在真实包副本并记录。耗时整包回放只作一次性验收。

### 证明

计划阶段已取到三份 upstream 归档并核对 PAX 提交；实现阶段夹具须保存相同 commit、所选成员逐文件摘要/原 mode、归档摘要与受控改动。下载得到的完整 tar.gz 摘要仅记录此次字节，不能假定 codeload 永久输出相同压缩字节。

| 样本 | 固定来源与已核文件 |
| --- | --- |
| S1 | `anthropics/claude-plugins-official` @ `b5b01ac4f889fec0c4c6bb89f27ca7c8574473f6`，`plugins/plugin-dev`（7 skills、1 command、3 agents，87 节点）；`skills/skill-development/SKILL.md:609–614` 的六个兄弟目录，`skills/hook-development/scripts/` 的真实脚本与 references/examples。 |
| S2 | 同一上游提交的 `plugins/claude-security`（56 节点），`skills/claude-security/SKILL.md:21–25,42–53,69` 同时含 ROOT/SKILL_DIR；其 jobs/specs/role 和根 scripts 是真实目标，不运行安全扫描、hooks 或模型。 |
| S3 | `obra/superpowers` @ `22f0b463e7a5e579904dd6211a520321035526f7`，完整包含 `skills/executing-plans/scripts/task-start`、`skills/subagent-driven-development/scripts/task-brief`/`sdd-repo`/`sdd-workspace` 及 `docs/plans/2025-11-22-opencode-support-implementation.md`。真实 `task-start` 会调用兄弟技能中的工具，适合作为移走来源后的调用证据。 |
| S4 | `openai/plugins` @ `981b02c0c44058b595f3b4180002c3ae3c806d40`，`.agents/plugins/marketplace.json` 与完整 `plugins/remotion`（399 节点、12 skills）；`remotion-create`、`remotion-docs`、`remotion-interactivity`、`remotion-markup` 的真实跨技能链接。无需 Node/视频生成，#1760 的运行环境不作为本片前置。 |

| AC | 测试/证据（均从包原始文件派生） | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-09 · 树与元数据 | 常驻 integration：`ext-cas.test.ts` / `ext-transaction.test.ts` 的“plugin tree preserves modes and links”案例，取 S3 的真实脚本与资料组；在副本 chmod 可执行并加指向已存在文件的相对链接和包内绝对链接，比较 lstat.mode/readlink/字节摘要，空文件取 S3 的 `tests/hermes/__init__.py`，空目录取 Git 实际生成的目录；故意换目标或 mode 的反臂必须失败。迭代命令：`bun test src/main/ext-cas.test.ts src/main/ext-transaction.test.ts -t 'plugin tree'`。 | 旧物化丢 mode/空目录/链接，旧 verify 直接拒 symlink；只复制常规文件或把链接解引用均不能满足断言。 |
| AC-09 · 移走来源与兄弟资料 | 常驻 integration 在 `install-from-source.test.ts` 增加“whole plugin skill paths survive source removal”，只取 S1/S3 的必要真实成员；真实安装后 rename 来源副本，按注册技能路径读 S1 的六个兄弟 `SKILL.md`，并直接执行 S3 `task-start`，输入上表真实计划的 Task 1，检查提取 brief 的真实内容和 Git base。完整 S3 一次性补实际构建输出（在 S3 根运行 `bun build .opencode/plugins/superpowers.js --target=node --outdir dist`）与 Git 在真实副本生成的 `.git`（记录 `git init`/fixture commit 的命令及成员摘要），装后比较保留内容与链接。迭代命令：`bun test src/main/install-from-source.test.ts -t 'whole plugin'`。 | 旧独立 skill generation 下兄弟目录/包根资料缺失；只存来源路径会在 rename 后读取或执行失败；脚本失执行位或跨技能脚本没装会直接失败。 |
| AC-09 · 绑定且不串包 | `plugin-conversion.test.ts` 检查 S2 的两个 typed binding 原样保留；`packages/ext/src/plugin-host.test.ts` / 新模块测试“installed plugin skill bindings stay package-local”检查真正交给 SkillEditor 的 content/path，以 S2 与另一真实包副本同时注册，所有 ROOT 目标落本包 live 树、SKILL_DIR 目标落该技能目录，jobs/specs/role 可读；当前项目取另一个临时目录，仍保持其身份。涉及同名时仅改真实清单 name 字段并记录。分别从所属包运行 `bun test <该文件> -t 'plugin skill bindings'`。 | 旧逻辑整项拒装；统一 ROOT 或按来源目录绑定会分别命中他包/已移走来源，未展开变量时不能打开目标；仅检查转换 Text 而未接运行注册不能通过。 |
| AC-02 · 技能/资源与具体结果 | `plugin-conversion.test.ts`、`package-envelope-v1.test.ts` 的最小常驻案例分别钉 S1 的技能发现和 profile→description/blob 解码（含摘要/引用不符反臂）；一次性将 S1 完整市场候选交 `createSourceInstaller`，验证 7 技能均返回 installed、记录和实际 SkillEditor 注册齐全，目录/脚本/references/examples/根资料完整；command/agent 原文件可读且未冒报运行，具体 `notRunning` 仍供现有界面消费。运行各文件对应 `-t`，完整样本另记入口命令、7/7 和文件摘要比较结果。 | 当前结果仅 3/7；仅去掉拒收但继续逐技能复制时，根文件与跨目录引用仍丢失；虚报完整可运行会与 command/agent 的原诊断断言冲突。 |
| AC-09、AC-02 · remotion 真实回归 | S4 在 `plugin-conversion.test.ts` 保留最小跨技能成员常驻回归；完整包一次性从真实市场清单查询/捕获后走安装入口，核对该固定树全部 12 技能 installed/enabled、SkillEditor 注册路径都在同一树；移走来源后逐个读取真实包内链接目标，无 skill 的 `needs-plugin-files`。同一包关闭/仅当前项目仍用既有成员判定验证。命令沿 `install-from-source.test.ts` / ext 模块的 named case，完整 12/12 输出另交编排器。 | 计划阶段实际入口只有 8/12，四个相互引用技能被拒；只改返回状态或复制每技能局部文件会在实际注册/链接读取处失败。 |

计划阶段已运行：在 `packages/ui-mac` 执行 `bun test src/main/install-from-source.test.ts src/main/ext-cas.test.ts src/shared/host-extension-package-contract/plugin-conversion.test.ts src/main/old-name-scan.test.ts`，exit 0，90 pass / 0 fail。临时 probe 实际调用转换库与 `createSourceInstaller`，exit 0，观察到上表 8/12、3/7 和 `nothing-runnable`；这是旧行为复现，不是实施通过证据。旧名扫描单独复跑 exit 0（10 pass）。当前 worktree 的文档合同检查 exit 1：71 errors / 250 warnings，其中本文件两项为片 1 既有的跨仓 ID 未限定引用（已用 `git show origin/alpha:docs/specs/local-plugin-install/plan.md` 确认），其他为未改文件的索引/链接/布局等现状；本片新增章节未引入这些项。按派工只写本片，不修旁项，交编排器处置。另在临时 Git 项目直接运行 S3 `task-start <上述真实计划> 1`，exit 0，实际产生 `brief:` 与 `base:`；`bun build <S3>/.opencode/plugins/superpowers.js --target=node --outdir <临时产物目录>` exit 0，得到 9.54 KB 的真实构建文件。它们只证明拟用样本/命令可行，尚未证明整包安装。`git diff --check` exit 0。实现与完整样本验收尚未开始。

### 偏离记录

- 2026-11-26 · 步骤 1 红测提交 `8843cebac2`（0 pass / 3 fail）；本次只提交步骤 2 中独立可验证的 CAS/事务树能力，尚未完成任何完整 AC。计划核对漏掉了 `src/shared/package-admission.ts:133` 的冻结 `PackageAdmissionPlanItemV1.kind` 枚举：它不含 `bundle`，而 `src/main/package-admission.ts:758–766` 把 profile 路由的 kind 原样写入该 renderer DTO。已定 root 必须为 bundle，不能伪装成 skill，也不能在本片擅自放宽被冻结的 DTO。返回 `SEAM-CHANGE-NEEDED`：最小所需变更是允许该枚举表达既有 `bundle` kind（外层字段不变），并同步其既有解码/枚举验证；在续派明确该接缝后恢复步骤 2 的 profile 部分及步骤 3–5。宿主已发布 envelope/registry/manifest 与 aggregate 均未改，不需消费方此时重 pin。未完成 profile/schema/corpus 草稿及修改前 diff 已保存在临时实验目录的 `implementation-before-seam.patch`、`plugin-package-draft.ts` 与两个 JSON 中，不作为权威或已交付代码。

- 2026-11-26 · 局部验证：`bun test src/main/ext-cas.test.ts src/main/ext-transaction.test.ts` 96 pass / 0 fail；最终树案例 `-t "plugin tree"` 3 pass / 0 fail；`bun test src/shared/host-extension-package-contract/plugin-conversion.test.ts` 31 pass / 0 fail（路径文法复用本次纯 helper，避免第二份权威）。返回前较宽相关集一次：`ext-cas-gc.test.ts`、`ext-transaction-config.test.ts`、`ext-transaction-file.test.ts`、`ext-transaction-prepared.test.ts`、`package-child-kind.fast.test.ts`、`package-update.test.ts`、`package-admission.parity.test.ts`、`engine-explicit-config.test.ts`，125 pass / 0 fail，日志 `partial-wider-tests.log` 留在上述临时目录。`bun typecheck` exit 0，两个 generator `--check` exit 0，旧名扫描 10 pass，文档合同仍为既有 71 errors / 250 warnings。`install-from-source.test.ts -t "whole plugin"` 仍 0 pass / 2 fail，正是尚未实施的安装回归。S1 7/7、S3 装后移走来源运行、S4 12/12 与双变量绑定都未证明；不能据本次底层测试认领 AC-09 或 AC-02 完成。宿主 artifact aggregate 仍为 `0af4d2fbf62755e3510c7dba1ddca381d1b436e2903d47c5261a21ed91873437`，无合同版本变化。

- 2026-11-26 · seam amendment ruled by orchestrator 2026-11-26：允许 `PackageAdmissionPlanItemV1.kind` 与其唯一 profile→kind 表增加既有 `bundle` 取值；其他 DTO 字段不变。只联动 renderer 的组件展示过滤及对应回归，bundle root 不单列为组件。此前接缝阻断已解除，从步骤 2 继续。

- 2026-11-26 · 步骤 2–3 完成：新增 `plugin-package@1`，bundle root 与 entries 共用一次事务/图；来源安装和签名 profile admission 共用整树 builder。新 profile 不套旧技能资产/载荷/事务条数帽；现有 envelope header、网络超时和各旧 profile 的合同继续适用。`src/shared/installed-plugin-package.ts` 是文件表外的必要同调用链落点：main 与 ext 共同读取 generation 内的描述及宿主映射；它不随公共 host artifact 发布。renderer 仅按本次 amendment 排除 bundle 组件行；`upload-consent-test-runtime.ts` 增加测试导出，使既有 `upload-consent-dialog.test.ts` 能经实际控制器与 DOM 验证授权屏及已安装详情，未增加产品字段或交互。旧逐技能 generation/单记录断言随替代行为同步，红测提交的三项正确断言未改。
- 步骤 2–3 文件验证：在 `packages/ui-mac` 执行 `bun test src/main/install-from-source.test.ts src/main/ext-transaction.test.ts src/main/ext-package-ledger-v3.test.ts src/main/package-admission.test.ts src/main/package-installability.test.ts src/main/ext-package-ledger-uninstall.test.ts src/shared/host-extension-package-contract/package-envelope-v1.test.ts src/shared/host-extension-package-contract/host-extension-package-artifact.test.ts src/shared/host-extension-package-contract/plugin-conversion.test.ts src/renderer/extensions/upload-consent-dialog.test.ts`，415 pass / 0 fail。签名真实 Superpowers profile 入库/启用/关闭、整包移除不误删同名 flat skill、树/引用摘要反臂和 renderer bundle 行均有具名证据。`bun typecheck` 通过；新增模块 scoped oxlint 为 0 warnings / 0 errors。renderer 测试曾检出 shared 模块的 Node named import 构建失败，已调整导入使 Vite 可裁去未使用的后端摘要验证，实际组件构建与渲染转绿。
- 宿主合同：增加 `plugin-package@1`、其 schema/真实描述语料与自足的规范化模块；envelope/registry/artifact schema token 仍为 v1。envelope 的新 profile 载荷引用独立于旧 payload 字节帽；其他 profile 取值未放宽。转换器仍只由独立 generator 生成，不进入发布清单。当前 artifact aggregate 为 `1123e4f0837fbe98660aa3e90b47b3323fe117ab57ba9c82657d9e1794a1c245`，取代前述 `0af4d2fb…`；消费仓需单独重 pin，本片未改其他仓库。
- 步骤 4 完成，局部实现调整：core `skill-file.ts` 以源目录名生成技能 ID，两个真实包的同名源目录会碰撞。因此包树技能从已安装描述直接经 `SkillEditor.add` 按宿主名登记，真实 path 保持在 live tree；不再把包树重复交给文件扫描器。`gen-skill-paths.ts` 与新模块复用同一 live 指针读取。绑定测试增加原生技能反臂，曾出现 0 pass / 1 fail（原生同名 ID 被扫描器覆盖），修正后通过；既有技能不会因整包安装丢失。未改 core 或引擎接缝。`packages/ext` 执行 `bun test src/gen-skill-paths.test.ts src/package-scope.test.ts src/plugin-host.test.ts`，104 pass / 0 fail，含实际 SkillEditor 的两包 ROOT/SKILL_DIR 隔离、项目匹配/不匹配及关闭。该包 `bun typecheck` 通过。
- 步骤 5 真实验收：`packages/ui-mac` 下运行临时 `bun /tmp/plugin-package-plan.4YRctl/verify-whole.ts`，真实市场清单→候选→固定归档捕获→安装；S1 为 7/7 enabled（87 节点，command/agents 四项仍如实 not-running），S4 为 12/12 enabled（399 节点，跨技能链接全部可读，无 needs-plugin-files），S2 为 1/1（56 节点）。同目录 S3 副本运行 `git init`、空 fixture commit、`bun build .opencode/plugins/superpowers.js --target=node --outdir dist`；chmod 真实 task-start 为 0775，并增加两个指到该真实文件的相对/包内绝对链接。安装后 rename 来源目录，247 个非技能文件摘要一致，9424 字节构建输出及实际 `.git` 可读；链接关系、mode 与空文件/目录通过完整树校验。直接执行安装树的 `skills/executing-plans/scripts/task-start <安装树>/docs/plans/2025-11-22-opencode-support-implementation.md 1`，exit 0，产生真实 brief 和 Git base；没有运行命令/助手/hooks runtime。
- 实际运行注册另验：`packages/ext` 下 `bun test /tmp/plugin-package-plan.4YRctl/verify-runtime.test.ts`，1 pass / 0 fail、92 assertions；最终代码实际注册 S1 7、S4 12、S3 15、S2 1，共 35 个 Skill.Info，path 均在各自 installed tree，S1/S4 的实际兄弟链接可读，S2 两变量实际指到本包/本技能。来源移走/脚本用途与全包回放集中作一次性证据，常驻套件保留最小文件树、跨技能资源及运行注册回归，避免把该整段场景常驻到 PR 层；这是验证落点相对原表的调整。日志和可复核副本留在上述临时目录，未作为仓库运行依赖。
- 返回前较宽集只运行一次：在 `packages/ui-mac` 用 `bun test` 执行 `package-child-kind.fast.test.ts`、`package-update.test.ts`、`package-admission.parity.test.ts`、`engine-explicit-config.test.ts`、`ext-cas-gc.test.ts`、`ext-transaction-config.test.ts`、`ext-transaction-file.test.ts`、`ext-transaction-prepared.test.ts`、`ext-receipt-v2.test.ts`、`ext-skill-generations.test.ts`、`ext-package-lifecycle.test.ts`、`ext-package-lifecycle-permutations.test.ts`、`hub-view.test.ts`（均在 `src/main`），282 pass / 2 fail。两项失败都把本次新增的 bundle 当未知 kind；同提交同步这两项旧事实断言（未知 kind 的拒绝仍保留），只重跑这两个改动文件，28 pass / 0 fail，未重跑全宽集。它们属于 seam amendment 的机械枚举同步，非兼容旧拒绝行为。
- 收尾检查：两个包 typecheck、两个 generator `--check`、scoped oxlint 与 `git diff --check` 均通过，旧名扫描 10 pass / 0 fail。`check-docs-contract --profile /tmp/plugin-package-plan.4YRctl/docs-profile.yml --changed-since 9f08c506d9 --format json` 仍报告原有 71 errors / 250 warnings，未扩大修复面，交编排器处置。实施两轮约 70 分钟（不含计划/等待派工）；约 28 个生产 TS 文件、约 1,160 行新增（生成物/语料另计），未达到双倍边界。步骤 2–3 合并为内容/接缝提交，步骤 4 与收尾证据随后提交；未推送、未启动 App/Electron、未跑 gate/bin/check/全套。


## 片 4 · #1776：文件夹/Git/市场直装、配置与标准 MCP

- 依据：[Story #1776](https://github.com/impharaon/alpha-code/issues/1776) 当前正文；[local-plugin-install 规格 v5 @ 7278c10](https://github.com/impharaon/alpha-work/blob/7278c10/docs/specs/local-plugin-install/spec.md)；[local-plugin-install 设计 v3 @ 5ee9f55](https://github.com/impharaon/alpha-work/blob/5ee9f55a7e1fb09a915883a382cbcf1c94741a62/docs/specs/local-plugin-install/design.md) §4.8、§4.10、§4.13、§5、§6、§8、§10，沿其引用消费 D1/D2/D5。覆盖下表片 4 的 AC 分项；不重述或修改冻结决定。
- 核对：IMPLEMENT — ddb1fc34d3 · Claude Opus 5.5 (orchestrator) · slice-4 plan accepted with the remaining slices' AC ownership. S4-A/S4-B 已按 2026-11-26 r1 续派开放；变更留本分支提交，叠在片 2 之后。
- 基线：派发 worktree/分支保持原样，`HEAD=c4f213f461e6c93142155a22f028e783fb0f44ec`，叠在 #1762 片 2 上；集成使用 #1762 真正合入后的版本。alpha-work 的 `origin/main=5ee9f55`，其工作副本文档仍为旧版，本片读取 Git 对象。兼容性证据继承 `2026-11-26/plugin-compat/REPORT.md` §5.2/6/8 及 `plugins.csv`、`sources.json` 的固定样本，不把分析 worktree 的数字当当前代码的运行通过数。
- 计划起于 2026-11-26 13:50（UTC+08:00），预计 30–45 分钟；实施预计 6–10 小时、约 30–40 个手写生产/合同文件、2,000–3,000 行手写改动，生成物与真实压缩夹具另计。每完成一组 AC 核对用时/规模；达到上界两倍返回具体阻塞，不自行扩票。
- 本轮文档影响为执行计划，仅追加本节；片 1/2、frontmatter、索引与其他文件不改。实施阶段的合同说明、模块地图与 S-09 主权登记随对应实现提交；不改 gate。界面复用 spec v5 的体验约定及其引用的 helper 令牌/授权输入、包管理服务设置、市场逐条指定入口，不绘稿、不新增安装前确认。

### 余片及 AC 归属

集成顺序为 **4→3→5→7→8→9→6**；此表只索引归属，余片不在本节展开文件或步骤。

| 片 | AC 所有权与交接边界 |
| --- | --- |
| 4（本节） | 完整 AC-01/04/05/07/12/19/26/27；AC-03 出网部分、AC-13/14 直接安装入口部分；AC-20 的声明/值、AC-25 的目录/技能绑定。配置向进程送值及 hook DATA 的完整运行证据交片 5。 |
| 3 | AC-06/10；与片 2 合闭 AC-02 的命令、助手、整包预览；AC-13/14 命令/助手部分。Invocation、YAML、源工具规则的转换及运行属本片，不在片 4 顺手实现。 |
| 5 | AC-11/15、AC-03 hook 当次 allow；汇合并闭合原 AC-13/14 全部组件/入口；AC-20 hook OPTION、AC-22/23/24、AC-25 hook DATA/更新/移除、AC-30。无真实时机事件按设计逐项说明。 |
| 7 | 完整 AC-21，包括匹配文件懒启动、真实诊断、缺程序和关闭停止。 |
| 8 | 完整 AC-28/29，输出样式与默认主助手。 |
| 9 | 完整 AC-31，command 来源与真实 link；片 4 不执行 locator、不提前实现 link。 |
| 6 | BR-13 原生文件引用管理；关联 AC-13 停止/移除管理、AC-15 项目信任，不删除原文件，不认领已移交 helper 的 AC-18。 |

片 1 的 AC-08、AC-03 默认/连续询问和技能/MCP 生命周期，片 2 的 AC-09、AC-02 技能/资源与 AC-13/14 技能脚本证据均继承原收据；新增能力仍验自己的关闭/移除。alpha-web 是外部集成依赖：按设计 §8 一次收拢分叉 adapters、消费本仓同份 converter artifact、更新 host pin/compiler/公开载荷；本车道不改该仓、不签名/发布，也不为本机 MCP 建公开条目。交接须列本仓 commit、artifact aggregate/文件摘要与实际消费版本，未消费前不宣称 BR-12 跨仓等价已完成。

### 当前代码与冻结接缝

本片读取 [模块图](../../architecture/modules.md) 与 [K1/K2](../../architecture/constraints.md)，沿唯一 converter、账本/事务、专用密钥与出网权威接线。以下两个缺口是片 2 的冻结实现必须开放的最小接缝；没有另写安装器或命名算法绕过它们。

| 接缝/位置（上述 HEAD） | 已核事实、最小所需变更 |
| --- | --- |
| **S4-A · SEAM-CHANGE-NEEDED**：`packages/ui-mac/src/main/install-from-source.ts:92,159,282`，同链 `ext-ipc.ts:1412` | `wholePackage` 只认 marketplace；folder/Git 沿平铺技能路径且仍受 `needsPluginFiles` 筛除。需允许来源分派把选中的 folder/Git Claude/Codex/纯技能 capture 交同一 `buildPluginPackageTxItems`，继续使用片 2 原树物化/事务，不修改 mode/link/CAS/恢复算法。直接入口的预览、内容提交与提交后登记接线一并按 §5/BR-10 验证；`install-from-source.ts:393` 与 `ext-ipc.ts` 的 MCP 激活动作不得在内容安装阶段启动连接器。 |
| **S4-B · SEAM-CHANGE-NEEDED**：`packages/ui-mac/src/main/plugin-package-install.ts:141,160,165`；调用方 `install-from-source.ts:167,181,183`、`package-admission.ts:1035,1043,1223` | `pluginHostName` 保留大小写、只碰撞时加路径 hash；`pluginComponentId` 依赖 entry.id，direct receipt 另做 lowercase。MCP leaf 的 Text 渲染只支持旧绑定。需允许这些现有 helper/调用点统一消费 v3 §4.8 的逻辑身份及 §4.10/4.13 的绑定/投影，连同描述 validator 与 ext 技能 Text 消费点补已批准字段。catalog 仍沿已验证 envelope 身份。保留单一 owner，不新增第二映射表，不迁移已装记录。 |
| 已批准新增字段的落点 | `plugin-package.ts:26,315` 的 Text/renderer、description validator 与 profile schema 尚无 option/environment/DATA；按 v3 共享形状同步 generator/decoder/真实语料。这里只列落点，不另定字段或重开设计。该增量与 S4-B 的片 2 消费面一起交编排器核对。 |
| S-09 集成依赖 | `core/src/mcp/client.ts:372–392` 已有 loggedFetch/authProvider 组合点；main `network-egress-proxy.ts` 当前普通 HTTP 为 405，不能只改 URL validator。按设计 §6/§10 的既有 L3 增量登记 `plugin-local-mcp` 后接入；registry 与对应 guard 随实现同一提交，不把设计中的候选文字当已登记事实。 |

S4-A/S4-B 只申请落实已冻结 v3 的接缝范围，不申请新产品决定。编排器未开放前不修改片 2 代码；可独立核对/规划的部分保留如下。若实施遇到上述范围之外的冻结接口缺口，返回精确 `SEAM-CHANGE-NEEDED`，不改冻结树基础或增加旁路。

### 改动

下表为实施候选范围；路径省略 `packages/ui-mac/`，其他包写全。标注 S4-A/B 的行以接缝续派为前提。现有模块的回归加在其既有测试文件；新文件只在它拥有下述新增职责且没有合适现有 owner 时创建。

| 文件/入口 | 改什么 |
| --- | --- |
| `src/shared/host-extension-package-contract/plugin-package.ts`、`plugin-conversion.ts`、`generate-plugin-conversion.ts` 及生成 `.mjs/.d.mts` | 在唯一库落本片的 provider/portable 合并、市场组件声明、MCP 发现/传输、变量/default/forwarding/timeout、typed options/SecretNeed 与 DATA 语义；Text 求值复用同一 owner。Invocation 运行、hook/LSP/style/monitor runner 留对应片。 |
| 同目录 `profiles/plugin-package.v1.schema.json`、`decoder.ts`、`CONTRACT.md`、`generate-artifact.ts`、artifact manifest、相关 `testvectors/` | 同步本片共享形状与发布清单，首次把自包含 converter 及声明随 host artifact 提供给 W；真实样本派生解码语料。按仓库既有发布版本规则处理被改变的已发布定义，不伪造 aggregate，不增加另一套 schema。 |
| `src/main/plugin-sources.ts`；`src/main/install-from-source.ts`、`plugin-package-install.ts`（S4-A/B） | 复用 captureFolder/captureGit/prepareCapture 的完整快照；源生态、manifest 与市场声明只交 converter 判定。各直接来源进入同一 bundle builder，身份/receipt/声明同源；返回逐包真实结果及具体失败路径，保留其他可用 entry。 |
| `src/shared/plugin-install.ts`、`installed-plugin-package.ts`；`src/main/package-admission.ts`、`ext-package-tx-builders.ts`（S4-B 的描述/绑定消费） | 将规范化声明、名字映射、普通值/密钥引用接到现有 graph/claims/prepare 资源；同一 source 安装与 profile admission 不再各做子集投影。未改的选项/秘密及 OAuth 绑定保留，失败不发布半份新配置。账本写器和片 2 事务算法保持；如必须改变其冻结写入合同另返 seam。 |
| 新 `src/main/plugin-package-config.ts`、`plugin-package-data.ts`；`src/main/package-admission.ts`、`ext-package-uninstall.ts`、`ext-install-planner.ts` 必要同链调用 | 前者只持本包 typed 值/状态及既有版本化秘密资源的准备/保存；后者只按同一 fence roots 快照与 packageId 管理 DATA 创建/清理。值变更后走既有 MCP convergence；本包开关、更新、移除与失败清理不误动其他包或旧有效资源。复用现有密钥写器/归属，不另建 secret store/包 registry。 |
| `src/main/ext-config.ts`、`ext-mcp-policy.ts`、`package-mcp-activation.ts`、`engine-explicit-config.ts`；`packages/ext/src/engine-transforms.ts`、`cloud-websearch-kill.ts` 的 managed MCP 投影调用 | 在已管理包路径落实 v3 的 argv/依赖/URL 绑定与单一 `projectServerConfig`；移除设计已否决的程序头/参数形状拒收，保留真实 dependency/runtime 诊断。保留显式 SSE、cwd、分阶段 timeout/OAuth/环境转发，不通过全局出网放宽实现 loopback。 |
| `packages/ext/src/plugin.ts` 与 `plugin-package-skills.ts` 的声明读取/技能绑定；共享 `renderPluginText`（S4-B） | 消费 main 的同一有效配置/数据投影，实际 SkillEditor 内容展开本包非敏感值与 DATA；不重新读 manifest、不把敏感值注入模型，不提前实现片 3 Invocation。长 MCP 工具别名在既有 awaited context 消费同一映射及原对象，权限/执行仍用原身份。 |
| `src/main/network-egress-proxy.ts`、`server.ts`、`sidecar.ts`、`codepuppy-sidecar-messages.ts` 的既有内存引导/更新链；`packages/ext/src/hub-bridge.ts` 的现有 parentPort 桥 | 在同一代理及主进程已提交定义权威落实 §4.13；私有 McpProxyBinding 随有效代建立/撤销，经既有受控内存链到 MCP 实例。不得落进普通配置、env、日志或子进程；HTTP/SSE/CONNECT 流按同一绑定取消。sidecar 与 core 共用的内存绑定落在 `packages/util/src/` 自有具名模块，不落普通启动配置或凭据文件，不新造 RPC。 |
| `packages/core/src/mcp/client.ts` 的 fetch 组合点；现有 Code Puppy bootstrap 内存类型/接线；`docs/architecture/codepuppy-authority-registry.json`、`scripts/north-star-guard.sh` 的登记（S-09） | 只落实设计 §6/§10 的私有 MCP fetch 绑定，OAuth/原 transport 沿既有实例；同提交具名登记、行为 guard。不存在合法登记或需其他 engine 接管即返回，不改 oauth.ts、通用 fetch、NO_PROXY 或引擎代际。 |
| `src/shared/package-admission.ts`、`src/main/ext-ipc.ts`、`src/preload/index.ts` / `types.ts`、`src/renderer/extensions/ext-ipc.ts` / `ext-hub-state.ts`、`package-account-dialog.tsx` / `extension-hub.tsx` 及既有 i18n | 在既有账户/服务设置中贯通普通 typed 值、安全状态、敏感输入及选填版本；字段文案用源声明。版本只改 floatingVersion 指定 token，清空恢复原命令；关闭输入仍保留已安装包。市场继续逐条指定，只安装指定集合，无预选全市场或第二次确认。只增加必要 DTO/现有动作参数，不向 renderer 下发路径、配置原件或秘密读回值。 |
| `test-fixtures/plugin-helper/` 的已有 fixture/provenance/source-fetch、必要压缩成员；上述模块既有测试；`docs/architecture/modules.md` | 用下表实际固定来源保留最小回归及 provenance，旧拒收/平铺断言随替代行为同步；完整多包回放留一次性证据。模块图仅更新本片新增职责/owner，不治理无关旧偏离。 |

### 顺序

1. **先取得接缝续派，再落回归红测**：S4-A/B 及 S-09 具体登记范围由编排器接收；继承 #1762 已验树基础。provider、身份、变量/argv、portable 丢服务分别在原模块测试中以实样重现并单独提交失败证据；正确红测的断言在后续修复提交不改。旧行为断言在替代行为提交更新。
2. **转换与宿主合同**：落本片共享形状、converter、真实语料与 generator 产物；运行 `plugin-conversion.test.ts`、`package-envelope-v1.test.ts`、`host-extension-package-artifact.test.ts` 中改动项，再各受影响文件一次。生成检查与相同 capture 的 ESM/源码结果比较；W 只拿到明确 commit/aggregate 的交接，不在本车道修改。
3. **直接内容安装与配置/data**：按开放后的 S4-A/B 接现有 builder，贯通 typed 值/版本/秘密、DATA 生命周期与实际 skill 绑定；同提交带管理页/IPC的必要消费。依次验证 AC-01/04/05/07/12/19、AC-20/25 本片分项及内容零执行，相关测试文件各完成一次。无需真实凭据的自动证据先做，不等片 3/5 runner。
4. **标准 MCP 投影与本机传输**：落单一投影、绑定期校验/依赖诊断及显式 SSE；S-09 的 main 代理、私有 fetch、登记与 guard 同提交。用真实 SDK transport 经代理验证 POST/GET/DELETE、SSE/CONNECT、认证头不外泄、关闭/换代取消，以及普通工具出网反臂；闭合 AC-26/27 自动部分、AC-03 出网部分。
5. **一次整体验收及交接**：在临时 HOME/XDG/数据库/配置/secret 根中，回放本节固定样本的实际取源→安装→技能/MCP 运行读取。真实 Supabase/Cloudinary/Zoho 登录、Rill 服务、Docker/XcodeBuildMCP 等外部条件交编排器安排，分别记运行结果或未验证，绝不以 stub 充作真实服务通过。片 5 后补 OPTION/hook DATA 进程端证据。只提交本仓工作，不推送/开 PR/合并。

### 风险

- 冻结片 2 的接缝是本轮具体前置，不通过复制安装器/身份算法绕开；新 shape 的 decoder、schema、生成 ESM、main/ext 消费与发布字节必须同一版本，避免库能读而真实安装拒收。长工具名证据需执行原 executor，不能只断言长度。
- 原始明文可能在多个文件/字段重复出现。AC-05 从未经上架脱敏的真实副本起步，用同一无效 canary 扫安装树、CAS、配置、视图、错误与捕获日志；故意恢复一个目标原值的临时反臂应被检出。测试只输出存在与否，不输出 canary/真实凭据。
- 配置缺值/坏定义、程序缺失、loopback 无服务必须保留包及其他 entry；更新不能丢用户设置/秘密或 data，prepare 失败不能删旧目录。身份定义搬文件的反臂同时检查 component/secret/OAuth 归属。
- 本机能力必须真实经过现有代理。无绑定、错 entry/代/目标和撤销后的请求不得拨号；普通工具/脚本沿原网络权威。SDK 流、取消、OAuth 与 proxy-auth 去向一起验，不能用一次健康探测或仅 validator 变绿替代。
- 安装后默认开启与内容阶段零执行分别观测，现有测试若只 stub activateMcp 不算 AC-14。副本内可观察标记有直接触发的正对照；真实插件代码只在临时目录执行，应用/Electron/窗口不启动。

### 证明

以下是**待实施证据**，不是本轮已通过结果。具名 case 加在所列模块已有测试中；路径未加前缀时相对 `packages/ui-mac/src/`。新模块的首个测试文件分别为 `src/main/plugin-package-config.test.ts`、`src/main/plugin-package-data.test.ts`；既有 DOM case 使用 `test-component/package-account-dialog.cases.ts`、`plugin-source-results.cases.ts` 和 `hub-three-pages.cases.ts`，不重新创建已移除的 renderer 宿主测试。`U` 表示从 `packages/ui-mac` 执行 `bun test --max-concurrency 2`，`E` 从 `packages/ext` 执行同命令；迭代在命令后附 `-t '<具名 case>'`。实际 MCP 传输使用仓库 `packages/core/test/fixture/mcp-echo.ts`/现有 MCP SDK server 夹具，不手写协议或把断言副本当实现。

| 样本 | 固定来源/受控变化 |
| --- | --- |
| S1 | `openai/plugins@981b02c0c44058b595f3b4180002c3ae3c806d40`：完整 `plugins/supabase`、`plugins/build-ios-apps` 和 `.agents/plugins/marketplace.json`；直接取原 env/header 定义的副本注入无效测试密钥并记录改动。 |
| S2 | `anthropics/claude-plugins-official@0fbfda5a91f4adc311daca25acc99132f40f0b6e`：`plugins/plugin-dev`、`plugins/project-artifact` 与市场清单；无 manifest、自定义目录、mode/link 的反臂只对真实副本改目标字段/文件位置并记 provenance。不覆盖片 2 原夹具/收据。 |
| S3 | `grafana/ai-marketplace@6c28ba1961d502d82301cbd64d2322e6e960477c/plugins/grafana-mcp`；`langfuse/claude-observability-plugin@b5211009698fdfe79c6bbe90d6901ad255ea65d3`，保留原 userConfig 及缺省值。 |
| S4 | `cloudinary-devs/cloudinary-plugin@86be53409e3fb1c465cd5ff4d1dc937a2860f45c`、`catalystbyzoho/claude-plugin@9670b79d72fe4923cc845ca0414d009ef3684ccb`；根 mcp.json 的五项及 streamable-http 一项。 |
| S5 | `rilldata/agent-skills@adfce5762be435c026f4731f72e388520cb133cc`、`cockroachdb/claude-plugin@6c96c6394a61f366e8ec1b7cec2281e97507cbff`；本机服务地址与其他连接器一并保留。 |
| S6 | 缺陷矩阵按 REPORT/CSV 取 `CodSpeedHQ/codspeed@59cfc90540bb3717d8acf4ad03f7b5531c8e1a3d`、`mintlify/mintlify-claude-plugin@c1c1700d405dc375c2d90a1d4f8b283e6422b7ec`、`SAP-samples/hana-cli-claude-plugin@abadd0aba32792b6378ed784e9f6d3e5b25dfc2a`、`pydantic/skills@238d97102650c1caa51f35027aee13c469c59542/plugins/logfire`；provider 双 manifest 取 `supabase-community/supabase-plugin@2c6d02d4565babe784103ee4d446a93ae9b24151`。最小成员及原 mode/逐文件摘要/原 archive 摘要写 provenance，不重新跑全 381 包。 |

| AC / 本片缺陷合同 | 具名证据与相关命令 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01 | `folder Supabase installs skills and standard connector together`：`U src/main/plugin-sources.test.ts src/main/install-from-source.test.ts`，S1 实际 folder candidate→安装→回读图/整树及 SkillEditor；一次性由编排器补真实登录/工具清单命令及输出。 | 跨 kind 的 supabase 不得使图拒绝；走平铺入口或把 app 当 MCP 会缺标准服务/技能/已安装包。安装成功不等于真实登录通过。 |
| AC-04 | `connector version selection preserves the source argv`：`U src/main/package-admission.test.ts` 与 `U ./test-component/package-account-dialog.cases.ts`，S1 build-ios-apps 分别清空/精确版本保存，读回实际 MCP config，预填建议只用实际可取得结果。 | 不消费 floatingVersion 会无字段/改错 argv；强制版本会使清空分支失败；新增安装前确认由 DOM 反臂检出。 |
| AC-05 | `source secrets are absent from public artifacts and resolve at transport`：`U src/main/install-from-source.test.ts src/main/codepuppy-mcp-secrets.test.ts src/main/package-mcp-activation.test.ts`；S1/S3 原副本 env/header 同值及重复 targets，实际秘密 store 读回、受控 connector 边界比较值、全出口布尔扫描；另有保存失败不发布半份配置。 | 只收上架脱敏样本检不出原值泄漏；只脱敏不解引用时实际 transport 得不到相同值；漏任一目标会被扫描检出。 |
| AC-07 | `Git and folder install the same captured plugin tree`：`U src/main/plugin-sources.test.ts src/main/install-from-source.test.ts`；S2 同 commit 归档与其解包目录分别走 captureGit/captureFolder，比较去除来源/本机绑定后的 entries、字节/mode/link、实际技能路径；移走 folder 源后读取安装副本。 | 只取根 SKILL、逐技能平铺、丢 mode/link 或遗留来源路径均在真实读回处失败；不是只比 converter 返回值。 |
| AC-12 | `content discovery and selected marketplace packages keep their resources`：同上两文件及 `U ./test-component/plugin-source-results.cases.ts ./test-component/hub-three-pages.cases.ts`；S2 删除清单/按真实声明改目录的副本，真实市场中指定 plugin-dev 与另一条目，未指定条目不安装；一个实际坏定义不抹成功包事实。 | manifest 必需或默认目录硬编码会缺 entry；安装全市场、丢指定项引用或一个失败撤掉其他成功包都会使实际库存不符。 |
| AC-19 | `package options bind only their consuming connectors`：`U src/shared/host-extension-package-contract/plugin-conversion.test.ts src/main/package-admission.test.ts` 与 `U src/main/plugin-package-config.test.ts ./test-component/package-account-dialog.cases.ts`；S3 的标题/说明/两个必填项，测试 URL/无效 token 到真实运行投影，空填关闭仍装包且仅消费项待填。 | 把 URL 当 secret、把未填模板先送 validateServer 或只改 UI 都会在 config/逐项状态/秘密扫描处失败。缺 Docker 单记依赖，不因此拒包，不代装工具链。 |
| AC-20（声明/值） | `typed option defaults preserve false zero and empty values`：`U src/shared/host-extension-package-contract/plugin-conversion.test.ts`、`U src/main/plugin-package-config.test.ts ./test-component/package-account-dialog.cases.ts`；S3 Langfuse 11 项，经真实保存/读回检查 defaults、显式值、敏感状态与清空行为。 | truthy 丢值、数字/布尔转字符串、敏感默认漏脱敏或丢选填项都会失败；本片不把这些断言冒充 hook OPTION 进程证据，后者片 5 补。 |
| AC-25（目录/技能） | `package data is writable outside the content generation`：`U src/main/plugin-package-data.test.ts` 及 `E src/plugin-host.test.ts`；S2 project-artifact 的实际已注册 skill 正文指到存在可写目录，以第二真实包验证目录不同；同来源更新/关闭开启保持 sentinel，卸载不随 data 内链接删外部目标或他包 data。 | 绑定未展开、目录在 immutable generation 或错误 fence root 会使写入失败；更新换目录/跨包共用/误删均使 sentinel 或他包对照失败。hook 进程及联合 AC-25 闭合归片 5。 |
| AC-26 | `portable MCP discovery preserves all streamable HTTP servers`：`U src/shared/host-extension-package-contract/plugin-conversion.test.ts src/main/install-from-source.test.ts src/main/package-mcp-activation.test.ts`，S4 逐项六个 connector，显式 SSE 另走现有 SDK SSE 夹具；编排器补两个真实服务的登录/列工具结果。 | 不默认读 mcp.json 或丢 transport 时不满六项；只 HTTP fallback 无法通过显式 SSE 路径观测，不能以复制配置代替连通。 |
| AC-27、AC-03 出网 | `local MCP proxy is bound to one live definition`：`U src/main/network-egress-proxy.test.ts src/main/package-mcp-activation.test.ts`、`E src/engine-transforms.test.ts` 与 `packages/core` 中 `bun test --max-concurrency 2 test/mcp.test.ts` 的相关 case。S5 声明经过真实 transport/代理，服务先停再启无需重装；无/错/已撤销绑定不拨号，普通工具出网仍拦，MCP server 收不到 Proxy-Authorization。 | 只改校验会仍撞 HTTP 405/围栏；全局 host 放行使反臂拨号；凭据进 server header/普通 config 会被泄漏断言检出；只单次 probe 不能完成真实协议流和取消。真实 Rill Developer 工具另由编排器实测。 |
| AC-13/14（直接入口） | `source preview and content commit do not execute plugin content`：`U src/main/install-from-source.test.ts src/main/plugin-sources.test.ts`，S1/S2 完整真实副本添加受控可观察标记，folder/Git/指定市场分别观测包进程/文件副作用/连接器启动/可执行文件头；临时目录直接触发同一样本的正对照必须看到动作。已安装技能/MCP 另验关闭/移除及秘密/data 清理。 | 只有空 spy 而正对照也不动作不能通过；提前激活或求值真实包内容会出现标记。命令/助手/hooks runtime 全闭合仍留片 3/5。 |
| §4.8 provider/身份/变量/argv 与 §4.13 | 在 `plugin-conversion.test.ts`、`install-from-source.test.ts`、`package-admission.test.ts` 加同表缺陷回归：`provider selection keeps the chosen ecosystem`、`component identity survives definition relocation`、`environment defaults and argv retain source meaning`；运行各具名 `-t`。S1/S6 验跨 kind、大小写、MCP 搬定义仍同 secret/OAuth、portable/Claude 单边能力不被吞、括号规则测试留片 3；forward env 从运行端取，显式 env 覆盖，原 command[0]/带空格 argv/`-p` 不拆改。`E src/plugin-host.test.ts -t 'long MCP aliases execute the original tool'` 验长名仍调用原对象。 | 任一旧映射/简化 renderer/子集投影恢复会在实际图提交、运行参数或工具执行处失败；catalog 伪造源身份仍须失败。Docker/PHP/JBang 等只验合法定义接收及具名 dependency 状态，不把缺工具链当转换失败或扩大 #1760 范围。 |

验证按三层执行：纯转换/状态在 fast，真盘/代理/SDK 接线在 integration；完整真实包/引擎旅程只作一次性命令证据或既有 nightly scenario，不给 PR 加整包回放。每步先相关 `-t`，完成该步各改动行为文件完整运行一次；返回前只跑一次较宽相关集。用 `rg -l 'plugin-conversion|plugin-package-install|projectServerConfig|savePackageSecrets|startEgressPolicyProxy'` 搜受影响包测试中的 import/mock/枚举消费者，列实际文件后执行，初选为 `package-admission.parity.test.ts`、`package-update.test.ts`、`ext-package-lifecycle.test.ts`、`ext-package-ledger-uninstall.test.ts`、`engine-explicit-config.test.ts`、`ext-config.test.ts`、`ext-mcp-policy.test.ts`、`package-mcp-oauth.wiring.test.ts` 及 ext 的 `package-scope.test.ts`。只因实际新增 export/枚举改变补必要消费者，不跑全包/全仓或 gate/bin/check。相关包各 `bun typecheck`、改动 TS 的 scoped lint、两个 generator `--check`、文档合同/本文件链接与 `git diff --check`；机器 gate 在跑时保持两 worker。

### 偏离记录

暂无实施偏离。计划阶段具体返回 S4-A/S4-B 的冻结接缝缺口；本轮未改代码、未重新设计、未执行真实市场插件或真实账号授权。

计划自核（Codex / GPT-6）：已将片 4 每个 AC/缺陷合同映射到真实来源、实际入口及缺行为必失败的检查，并列清余片归属；编排器的实施核对仍待续派。计划阶段 `bin/setup` exit 0，`git config --get core.hooksPath` 为 `.githooks`；包目录 `bun test --max-concurrency 2 src/main/plugin-sources.test.ts src/main/install-from-source.test.ts src/shared/host-extension-package-contract/plugin-conversion.test.ts` exit 0，111 pass / 0 fail，属于当前基线而非本片完成证据。文档合同检查使用 Alpha profile 原值，仅把仓库集合限定为本 worktree（临时 profile：`/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/plugin-standard-plan-y2un84rb/docs-profile.yml`），`check-docs-contract --profile <该文件> --changed-since c4f213f461 --format json` exit 1：71 errors / 251 warnings；变更前为 69 errors / 253 warnings，finding 的 code/path/message 集合无新增，只因本文件被触及，片 1 第 19/45 行的两处既有跨仓 ID 引用由 warning 升为 error。原前缀及其他章节保持不动，遗留交编排器（既有文档治理），不认领合同检查通过。`python3 scripts/check-doc-links.py docs/specs/local-plugin-install/plan.md` exit 0（8 条相对链接），`git diff --check` exit 0。只追加本节；不运行应用/Electron/窗口或全量门。

实施 r1（2026-11-26，Codex / GPT-6，起于 14:02）：已接受 S4-A/S4-B。新增 `test-fixtures/plugin-helper/standard/` 固定归档及 provenance，只选兼容性报告真实控制定义和技能成员，不替换片 2 样本。回归红测：ui-mac `bun test --max-concurrency 2 src/main/install-from-source.test.ts -t 'folder and Git|source component names'` exit 1，0 pass / 2 fail（plugin-dev 3/7、Supabase 跨 kind 名称相同）；`bun test --max-concurrency 2 src/shared/host-extension-package-contract/plugin-conversion.test.ts -t 'chosen provider|typed options'` exit 1，0 pass / 2 fail（Claude 实样误选 Codex、Grafana options 缺席）。后续修复不修改这些已提交的正确断言。

r1 步骤 2 / S4-A/B：四条已提交新回归均转绿（install 两例 2 pass；converter 两例 2 pass）。原两文件完整运行最初检出 16 条旧身份/变量断言；按替代语义同步既有断言，并修正实际敏感环境变量回退、registry 占位及 OpenCode 引用的转换，未修改四条已提交回归断言。五文件组（install/conversion/envelope/artifact/admission）212 pass / 1 fail，唯一余项为 signed profile 的旧技能宿主名；同步该旧事实后该具名用例 1 pass / 0 fail。ui-mac `bun typecheck` exit 0；两个 generator `--check` exit 0（host 19 文件，converter 首次随同一 artifact 发布）。新增 Text 字段保留按协议缺省的可选声明，不迁移已有记录；catalog 内部身份仍由已验证 envelope 的 packageId 绑定，非 catalog receipt 使用同一个最终 hostName。代码/声明/validator/schema/生成物及消费者同提交。一步测试命令曾从仓根被 guard 拒绝，未执行测试；实际证据均取包目录命令。

r1 实样补红（AC-12）：直接捕获报告中的完整本地目录时，带自身市场清单的真实插件被 `prepareCapture` 当成市场且返回零候选。只补 CodSpeed 原市场文件入既有 standard 归档，保留原字节/provenance。ui-mac `bun test --max-concurrency 2 src/main/plugin-sources.test.ts -t 'a plugin root with its own marketplace'` exit 1，0 pass / 1 fail，Expected package / Received marketplace。此缺陷属本片来源识别，先提交正确红测后修复；早一轮草稿因漏动态 import 未到行为断言，已在提交前纠正，不把它作红证据。

r1 身份映射补红：真实 context7 定义先与一个已存在的同宿主键连接器碰撞，分配 11 位 hash；移除碰撞者再更新源定义时，旧实现重新分配成 10 位并改了组件身份。ui-mac `bun test --max-concurrency 2 src/main/install-from-source.test.ts -t 'allocated plugin host names survive removal'` exit 1，0 pass / 1 fail（Expected context7-de6dee1ccd5 / Received context7-de6dee1ccd）。修正消费已保存 declaration 的映射，不另造身份表。


r1 来源与身份收口：`prepareCapture` 在根插件清单存在时保留该插件候选，不因其自带市场清单而改走市场；真正市场根继续逐条指定。该具名红测转绿，`plugin-sources.test.ts` 全文件 46 pass / 0 fail。来源更新复用 declaration 中已分配的同逻辑组件 hostName；移除碰撞者后的更新红测转绿，未新增身份表。MCP 短前缀在长度截断后仍去尾部连字符。变更行为文件 `install-from-source.test.ts` 与 `package-admission.test.ts` 全文件 64 pass / 0 fail。

一次较宽相关集：ui-mac 的 `package-admission.parity.test.ts package-update.test.ts ext-package-lifecycle.test.ts ext-package-ledger-uninstall.test.ts engine-explicit-config.test.ts ext-config.test.ts ext-mcp-policy.test.ts package-mcp-oauth.wiring.test.ts`（均在 src/main），`bun test --max-concurrency 2 <上述文件>` exit 0，221 pass / 0 fail；ext 的 `src/package-scope.test.ts src/plugin-host.test.ts src/engine-transforms.test.ts` 同命令 exit 0，108 pass / 0 fail。两包 `bun typecheck` exit 0；四个主要改动生产模块 scoped oxlint 0 warnings / 0 errors。

删除行为反臂（临时改动、各一次、原字节已恢复）：恢复市场误判、撤回 folder/Git 整树分派、移除身份 hash 的 kind 维度，各自的具名回归均 exit 1 / 1 fail。日志为 `/tmp/plugin-standard-remove-market-root.log`、`/tmp/plugin-standard-remove-whole-source.log`、`/tmp/plugin-standard-remove-identity-kind.log`。它们分别验证来源入口、整树和跨 kind 身份的缺失会被检测。

实样内容验收：ui-mac 运行 `bun /tmp/plugin-standard-r1-real.ts`，最终 exit 0，结果与隔离安装根留在 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/plugin-standard-real-dZONcH/results.json`。直接用报告 sample.json 的完整目录，经过真实 captureFolder→prepareCapture→convertCandidate→createSourceInstaller→账本/树探针；十个包整树提交、共 62 个 skill/MCP 组件：Codex Supabase 3/3、build-ios-apps 10/10；Claude plugin-dev 7/7、Supabase 3/3、Cloudinary 8/8（5 MCP）、Catalyst 17/17（1 MCP）、CodSpeed 3/3、Mintlify 3/3、Logfire 7/7、project-artifact 1/1。命令/助手/hooks 原件保留且继续如实 not-running；OpenAI app 编号仍诊断不足。此验收不启动连接器/技能脚本，activate/reload 只记边界，不能作为真实服务连通或 AC-14 正反进程验收。

未完成实样如实保留：Grafana 仍被旧 docker 命令校验拒绝，SAP hana-cli 仍被旧 -p 校验拒绝，Langfuse 仅 hook/options 尚无内容入口；Rill 与 CockroachDB 仍被旧 loopback 校验拒绝。前两轮探测先暴露市场误判（首轮在第五包后结束，第二轮仅余项），修复来源识别后才做上述完整一轮，不把未完成探测写为通过。来源脚本与日志只在临时目录，不成为产品依赖。

**BLOCKED: design — §4.13 / §6 S-09 / §10 — 缺少显式 SSE 的合法运行合同。** 当前 `packages/schema/src/mcp.ts:57–74` 的 RemoteConfig 没有传输选择字段；`packages/core/src/mcp/client.ts:334,387–409` 只持有/构造 StreamableHTTPClientTransport，没有 SSEClientTransport 分支；`packages/plugin/src/promise/mcp.ts:15–18` 公开域仅 list/transform/reload，编辑器只接受该 ServerConfig，内部 MCP.attach 不是这个域的 callable port。冻结 §4.13 又明确要求显式 SSE 必须进入 SSE transport。现有 §10 对 S-09 的 ADR-029 理由只覆盖私有 fetch 组合点，不覆盖 schema 的新选择字段/新接管。不能在未冻结字段/合法端口下扩公开类型、增加隐藏传输开关、假借 attached 或另建 MCP/OAuth 实现。

最小所需输入：设计/编排器补齐显式 HTTP/SSE 选择的类型、传递至同一 McpClient 的端口与所需 ADR-029 精确登记范围（若采用 RemoteConfig 的 typed transport 字段，应同时包含 schema 与 client 及生成消费者），保留同一 OAuth/fetch 权威；只回这个合同缺口，不重开 D1–D17 或产品范围。S-09 的私有 fetch 与 transport 接入是同一运行链，待该合同后集成。AC-04/05/19、AC-20 值保存、AC-25 DATA 绑定、AC-26/27 运行、AC-03 出网及 AC-13/14 直接入口进程证据仍待完成；此轮只完成内容/转换/身份基础，不报 slice 4 DONE。

恢复点：未完成的配置/DATA 私有资源草稿在 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/plugin-standard-r1-draft-1f_hita_/`，含 tracked.patch 与三个新文件；已从工作区撤回，没有提交半成品。该草稿尚未实现凭据/运行接线，且 typecheck 曾指出 server 的 PlannedFence 未公开 roots，不是可验收代码；后续从冻结合同与已提交代码继续，按需参考草稿。已核：Codex / GPT-6，输入 spec v5 @7278c10、design v3 @5ee9f55、实施核对 ddb1fc34d3；结论为上述具体设计阻塞。遗留去向：设计/编排器接收 SSE 运行合同；其余未完成 AC 留 #1776，真实账号/本机服务验收仍由编排器安排；两条文档合同基线错误保持原样。未启动 App/Electron/窗口，未改其他仓库/引擎/主权登记/gate，未推送。

r1 最终静态检查：ui-mac 再次 `bun typecheck` exit 0；converter/host 两个 generator `--check` exit 0。当前 host artifact aggregate=`50bd6924443a901e15a3cabc780e0432531d296fe19c9320855b1d192a14a524`，不是 W 已消费/发布的声明。六个改动生产模块 scoped oxlint 0 warnings / 0 errors。Alpha 单仓 profile 的 `check-docs-contract --changed-since ddb1fc34d3` 仍 exit 1，71 errors / 251 warnings，与本轮已确认基线相同；未修那两条被提升的旧引用。链接检查 8 条、`git diff --check` 通过，hooks 保持 `.githooks`。S4-B 的长工具别名与完整运行绑定也仍待续作，未以短 server 名称测试冒称 ≤64 的最终模型工具名已经闭合。

实施 r2（2026-11-26 14:31，Codex / GPT-6）：按续派继续片 4，显式 SSE 选择及其绕过不实现，等待 alpha-work v3.1。其余配置保存/秘密、DATA、长工具名与 HTTP 本机 MCP 继续；原 v3 其余冻结合同、片 2 接缝授权及相关测试纪律不变。具名红测 `standard plugin content installs before configuration programs or local services are ready` 取既有 standard 真实样本，ui-mac `bun test --max-concurrency 2 src/main/install-from-source.test.ts -t 'standard plugin content installs before'` exit 1，0 pass / 1 fail（首个 Grafana 内容安装返回 false）。此断言先提交，后续修复不改。

r2 配置补红：`plugin service settings save typed values and keep sensitive values out of public state` 使用既有 Grafana/Langfuse 实样，ui-mac 具名命令 exit 1，0 pass / 1 fail（选项状态缺席）；日志 `/tmp/plugin-standard-r2-settings-red.log`。普通 false/0/空字符串、声明默认值和敏感字段无值回传为长期回归。

r2 配置/DATA/别名步骤：整树路径不再套连接器的命令头/-p 或 loopback 安装拒绝；root-only Langfuse 也提交 bundle。新增私有设置/主进程选项事务与 DATA 模块、共享 v1 MCP 投影及 ext 别名模块，均为本节步骤 3/4 的同调用链，不更改片 2 的树/CAS/账本/事务算法。设置复用文件 action + typed probe，敏感选项按 bundle root 在既有 D5 store 版本化保存；资源释放的引用收集同步消费这份设置。实际 sidecar 环境/dataHome 在 server 冻结发布；skill 正文只展开普通选项，主进程 MCP 收敛读取相同 Text 绑定并在内存边界取密钥。原声明默认敏感值也入 D5，转换器记录 root SecretNeed 与 JSON 消费位置。

具名配置红测及五个内容准入实样均转绿（2 pass）；新增 Grafana 实际 argv/普通设置/密钥/DATA 绑定与版本替换、准备失败保持旧值（1 pass）。`install-from-source.test.ts` 完整 41 pass / 0 fail；先前步骤全文件检查的 4 条失败中，两条旧断言（root-only 拒收、未填 URL 拒整包）按冻结替代语义更新，一条固定动作列表同步 settings file action，真实目录残留修正为包卸载显式清理私有设置；未放宽既有行为断言。最初三文件运行 73 pass / 4 fail 的日志 `/tmp/plugin-standard-r2-step-config.log` 保留。`plugin-package-accounts.test.ts`、`plugin-conversion.test.ts` 在该轮均通过；新增纯别名用例与真实 awaited context hook 用例各 1 pass，证明键 ≤64、大小写身份不同且原对象保留；ext 的 identity/engine-transforms 两文件 36 pass / 0 fail。两包 typecheck exit 0。运行服务连通、完整 HTTP 代理和显式 SSE 未以这些结果冒称通过；后续继续 HTTP 独立部分，SSE 仍等设计 v3.1。

r2 HTTP 接入步骤：S-09 的 L0 main 代理扩展与既有 L3 Fetch 组合点同提交登记 `plugin-local-mcp`。源码核对发现 `McpConnection.start` 的 input.fetch 正是原 client 的 provider scope；`index.ts` 的 connectProvider/显式 authorize 会以 layer 捕获值覆盖该服务，所以同一能力须在这两个已有组合点同时接入，未改 oauth.ts、public MCP schema 或新增 transport。此为精确调用链消费，不新增设计决定或修改 gate/excludes。main 只按当前启用包的绑定定义铸随机 256-bit capability，经受控引导/更新及 publication ack 交 sidecar；HTTP origin/path（query 沿原协议）、CONNECT 目标、generation/definition 及撤销流在原代理内核验。localhost 固定解析到两种真实 loopback，不进入普通授权表；Proxy-Authorization 只作为 Bun per-fetch 外层代理头。

HTTP 新具名两例 2 pass，覆盖无凭据/跨路径/跨 CONNECT 目标的拒绝、真实流与撤销、认证头不外泄；main controller 保留定义与换代/关闭/sidecar exit 撤销 1 pass。proxy/controller 两个行为文件全量一次 26 pass / 0 fail（日志 `/tmp/plugin-standard-r2-step-proxy.log`）。core 仅具名 `plugin local MCP uses its private proxy for HTTP sessions and keeps proxy auth off the server`，真实原 Mcp.Service＋SDK＋main proxy，POST/GET/DELETE 与工具调用均通过，1 pass / 0 fail；不运行该文件中既有重试计时/容量用例。首次草稿未等待异步连接，读到工具表尚为空，已按文件原 connected helper 修正探测时机；未将其当缺陷红测。ui-mac typecheck exit 0；core typecheck 首次指出本测试 fixture digest 的模板类型断言缺席，已修正，待最终再核。

r2 HTTP 静态收口：core `bun typecheck` exit 0（2,053 files / 2 projects），ui-mac `bun typecheck` exit 0，ext `authority-registry.test.ts` 5 pass / 0 fail。非 darwin 也启动同一个私有 MCP 代理，但不更改其普通代理环境；darwin 的 NO_PROXY/围栏端口沿原值。

r2 AC-04 补红：`connector version selection preserves the source argv when pinned or cleared` 从 standard 的真实 Codex build-ios-apps 取 XcodeBuildMCP，具名命令 exit 1，0 pass / 1 fail（版本字段缺席），日志 `/tmp/plugin-standard-r2-version-red.log`；后续只补实现，不改此正确断言。

r2 AC-04 与服务窗收口：来源模块沿唯一 npm registry/既有 source deadline 读取真实 metadata 作为可用建议，不下载或执行程序；建议不可取得时仍提供空的选填字段。MCP 版本覆盖保存于同一私有设置文件，只在原 floatingVersion.commandIndex 替换该 token，其他 argv 保持；显式清空保留用户选择并恢复源命令。该具名红测已转绿，`install-from-source.test.ts plugin-sources.test.ts` 两文件完整 89 pass / 0 fail；metadata 来源用既有真实 npm /latest 夹具正反验证。新增 ordinary/secret/版本 DTO 往返与过滤检查；服务小窗两条 DOM 用例覆盖源标题/描述、false/0/空串、瞬时密码、建议预填/清空且无 required 限制，`test-component/package-account-dialog.cases.ts` 完整 7 pass / 0 fail。`PluginMcpBindingError` 只携带缺失选项/环境依赖的公开名字，收敛不把配置错误吞成整包失败，旧服务先断开；敏感值不进入错误。版本/设置消费均为本节初始文件链；`plugin-sources.ts` 的 metadata helper 留唯一 registry 常量拥有者，没有新增依赖或其他来源配方。

S-09 main→sidecar update 另加生产 fork 消息的 ack 行为用例：`server.test.ts -t 'plugin MCP proxy publication waits'` 1 pass / 0 fail（51 filtered），证明 main 在 ack 前不返回、exit 撤销能力。不是只静态断言消息名称。

r2 别名权限补红：真实 core 的 ModelRequest 已验证同一对象别名执行原注册 executor（1 pass）；进一步把原 MCP canonical identity 的停用记录写进既有 policy store，真实 ext 宿主却在 `execute.before` 报 unknown-tool-identity，未读到原规则。恢复 HEAD 的三个别名生产模块后，具名 `long plugin MCP names...` exit 1，0 pass / 1 fail，日志 `/tmp/plugin-standard-r2-alias-policy-red.log`；正确断言要求拒绝消息使用原 MCP identity。先提交该回归，再让同一 awaited context 产出的映射被唯一 policy facts 查询消费，保持实际执行/权限/MCP 身份不变。

必要文件增量：`packages/ext/src/policy/index.ts` 超出初始文件列表，是上述回归的同调用链唯一 factsFor 拥有者；engine 的 execute.before 使用模型别名，不能另造权限 evaluator 或在后置 hook 事后改名。这里只登记本 Location 的已验证 MCP 名字映射并回查现有 allFacts，没有新增权限策略、公开端口或 engine 接管。

r2 设置/身份最终接线：直接来源与已存在的签名 profile admission 共用 `preparePluginSettings`，其 file action、root-owned secret resource、DATA prepare/discard 仅组合既有事务回调；未改树/CAS/账本/事务算法。profile 同样保留 MCP 的包内路径和原 argv，源更新消费既有 metadata hostNames；同步一条旧的 needs-plugin-files 拒收断言。`package-admission.test.ts` 的 profile 两例 2 pass；随 source 两文件完整 68 pass / 0 fail。DataHome 只从各自实际冻结快照注入，测试 harness 明确传临时根。profile 的设置/DATA 属本节已有消费者，不新增安装路径或数据库。

别名权限补红已转绿，真实 ext 宿主＋register-policy 两文件完整 123 pass / 0 fail；core ModelRequest shaping→原 tool snapshot executor 的完整文件 5 pass / 0 fail，原 executor 实际执行一次且返回原结果。最初测试错误地把 core `execute.before.tool` 当成会被还原的名字，实际它仍是模型别名；已在提交正确权限回归前纠正此探针假设，未修改已提交正确断言。policy map 仅由同一个 awaited context 中经过真实 MCP mark 核验的别名生产者登记，factsFor 回查现有 registry/allFacts，不另铸权威或第二份策略。

**PARTIAL / SEAM-CHANGE-NEEDED（AC-13/14 直接入口）**：完整 SAP hana-cli 临时副本增加受控 launcher，仅替换 `.mcp.json` 的 executable、保留源 argv；launcher 与安装树均在临时目录，只收到临时 HOME/PATH/marker 环境，未运行真实 npm 包或读取用户凭据。`bun /tmp/plugin-standard-r2-content-boundary.ts` exit 1：`installOk=true, markerObservedBeforeInstallReturned=true, directControlObserved=true`；结果 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/plugin-content-boundary-Il7wsp/result.json`，日志 `/tmp/plugin-standard-r2-content-boundary.log`。初稿错把真实 SAP 裸 map 当 wrapped，未进入行为探针，不算验收结果；正确 probe 的实际启动和直接触发正对照均可观察。

证据边界：`install-from-source.ts` 401–402 仍先 `setPackageStateV1(enabled)` 再等待 activateMcp，`ext-ipc.ts` 的 gated write 外包装同样在返回前等待 activatePackageMcp；`ext-install-planner.ts` 2975–2990 的 frozen state writer 将 logical desiredState 与 enabled config image 一起发布，单删一次 callback 不能保证并行 engine config watcher 不提前启动。现有 S4-A/B 没有开放该内容完成/运行激活接缝，不以异步排队抢时序或新增用户开关绕过。最小所需授权为 main 的 content-complete 与 runtime activation 分离及相应初始投影/admission 契约，保持默认开启、既有开关/权限/后续实际触发语义；交编排器定点开放此 frozen seam，再以同一探针闭合，不自行改片 2 的 state/gate。

遗留基线：`server.test.ts:1021` — OPENCODE_CONFIG_DIR 为 `.` 的旧断言把缺失 `packages/ext/dist/server.js` 的正常警告路径也判作坏值泄漏 — 控制文件组 66 pass / 1 fail，日志 `/tmp/plugin-standard-r2-step-control.log`；新 ack 用例单独 1 pass。已核对失败断言及本地缺少 dist 事实，未找到该症状对应的 local-setup runbook，不重复无因 rerun，不修旧断言或用构建掩盖此观察；交编排器处理构建/测试基线。


r2 最终代码核对：别名 executor 用例移入现有 ext `plugin-host.test.ts`，继续调用真实 core ModelRequest/Session/Tool registry；从 core 测试中撤出跨包宿主 helper 的导入，避免把 renderer 项目带入 core 检查。清理转换器同链失效的四个 type import，未修改未触及模块的检查规则。core、ext、ui-mac 各自 `bun typecheck` 均 exit 0；core 为 2,053 files / 2 projects。转换器＋artifact 行为文件最终 45 pass / 0 fail，直接安装文件最终 42 pass / 0 fail。

AC-25 目录正反证据补足：实际包 DATA 为 0700，定义更新后原文件保留，关闭后设置及 DATA 保留；移除只清理本包目录/设置/secret 版本，兄弟包目录和外部 symlink 指向均保留。以上断言在同一个既有 install 文件，不新建场景/票号测试。Ext 最终相关组 `bun test --max-concurrency 2 src/plugin-host.test.ts src/plugin-setup-order.test.ts src/package-scope.test.ts src/policy/register-policy.test.ts src/policy/tool-policy-rpc.test.ts src/policy/unattended-policy.test.ts` exit 0，191 pass / 0 fail。

r2 一次最终较宽相关集：ui-mac 的原八文件加 `mcp-server-truth.test.ts mcp-server-derivation.test.ts ext-write-channels.test.ts package-mcp-activation.test.ts plugin-package-accounts.test.ts` 共 13 文件，271 pass / 1 fail，日志 `/tmp/plugin-standard-r2-related-ui.log`。唯一父失败来自 IPC 子宿主缺少 server boot 发布的临时 DATA 快照，整树准备提前失败，runtime barrier 用例等不到 entered；与新同链的测试 harness 初始化有关，已在既有 `test-component/ext-install-catalog-result.cases.ts` 同步生产启动条件，只发布临时 DATA/Home（额外文件的必要原因）。受影响七例定向 7 pass / 0 fail；生产 DATA 根仍由 server 实际 fence roots 发布，不在 IPC 重推导，也未改 gate。前一次子宿主超时/四条提前失败均保留，不报基线或 flaky。其余 12 文件的 257 项已通过，不重复跑较宽集合。

写通道行为文件最终完整一次 `bun test --max-concurrency 2 src/main/ext-write-channels.test.ts` exit 0，15 pass / 0 fail（含原 IPC 子宿主 26 pass），日志 `/tmp/plugin-standard-r2-writer-final.log`；合并此次已完成相关集合为 272 pass / 0 fail，非再次运行 13 文件。


r2 实样收据（内容整包，不等同真实服务完整可用）：`bun /tmp/plugin-standard-r2-real.ts` exit 0，报告固定的 15 包均经过实际 captureFolder → prepareCapture → converter → SourceInstaller → 账本/generation 树回读，113/113 条本片 skill/MCP 记录；reload/activation 边界不执行第三方程序。结果 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/plugin-standard-r2-real-mCn3Ey/results.json`，日志 `/tmp/plugin-standard-r2-real.log`。版本、treeNodes 与暂不运行原因逐项在结果中。

| 报告样本 | 整树提交 | skill/MCP 实装/预期 | 后续边界 |
| --- | --- | --- | --- |
| `codex:supabase` | PASS | 3/3 | hosted app 属规格排除 |
| `codex:build-ios-apps` | PASS | 10/10 | 真实服务/工具链运行未验 |
| `claude:plugin-dev` | PASS | 7/7 | 助手交片 3；命令交片 3 |
| `claude:supabase` | PASS | 3/3 | 真实服务/工具链运行未验 |
| `claude:cloudinary` | PASS | 8/8 | 真实服务/工具链运行未验 |
| `claude:catalyst-by-zoho` | PASS | 17/17 | 命令交片 3；hook 交片 5 |
| `claude:codspeed` | PASS | 3/3 | 真实服务/工具链运行未验 |
| `claude:mintlify` | PASS | 3/3 | 真实服务/工具链运行未验 |
| `claude:logfire` | PASS | 7/7 | 命令交片 3 |
| `claude:project-artifact` | PASS | 1/1 | 真实服务/工具链运行未验 |
| `claude:grafana-mcp` | PASS | 2/2 | 真实服务/工具链运行未验 |
| `claude:langfuse-observability` | PASS | 0/0 | hook 交片 5；SessionEnd 定义诊断交片 5 |
| `claude:rill` | PASS | 11/11 | 真实服务/工具链运行未验 |
| `claude:cockroachdb` | PASS | 37/37 | 助手交片 3；hook 交片 5 |
| `claude:sap-hana-cli` | PASS | 1/1 | 真实服务/工具链运行未验 |

Langfuse 保留完整 root bundle、配置/脚本/hook 文件，0/0 不是空包拒收，也不声称 hook 已运行；其 `hooks/hooks.json` SessionEnd 的 invalid-definition 是已观察的后续 hook 兼容项，交片 5，不在本片修复。Rill、CockroachDB、SAP 的本机/程序依赖没有成为内容准入条件；没有启动真实 Rill/Docker/Xcode/JBang/PHP 或第三方云授权。

AC-05 一次性源密钥证据：`bun /tmp/plugin-standard-r2-secrets.ts` exit 0，在完整真实 SAP env 与 Cloudinary Authorization header 的临时副本中只填无效 canary；实际事务、CAS/树/配置/DTO 扫描与现有 credential guard 解引用。结果 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/plugin-source-secrets-BK2U9W/result.json`：两包 installedWhole/stored/runtimeMatches/originalRetained=true，persistentOutsideSecretStore=0，declarationLeaks=false；日志 `/tmp/plugin-standard-r2-secrets.log`。不输出或使用用户真实凭据。

r2 删除反臂：提交干净基线后 `python3 /tmp/plugin-standard-r2-removal-arms.py` 顺序临时删除以下行为，每臂各运行具名一次，每次用 literal path 的 `git restore` 恢复，全部 exit 1（0 pass / 1 fail）；最终工作区没有 mutation。

| 删除行为 / AC | 从包目录运行的具名命令 | 日志 |
| --- | --- | --- |
| 保存私有设置（AC-19/20） | ui-mac `bun test --max-concurrency 2 src/main/install-from-source.test.ts -t 'plugin service settings save typed values'` | `/tmp/plugin-standard-r2-arm-settings.log` |
| 创建 DATA（AC-25） | ui-mac 同文件 `-t 'whole plugin removal deletes'` | `/tmp/plugin-standard-r2-arm-data.log` |
| floatingVersion token 覆盖（AC-04） | ui-mac 同文件 `-t 'connector version selection preserves'` | `/tmp/plugin-standard-r2-arm-version.log` |
| 认证本机 HTTP 转发（AC-27/03） | ui-mac `bun test --max-concurrency 2 src/main/network-egress-proxy.test.ts -t 'plugin loopback HTTP requires'` | `/tmp/plugin-standard-r2-arm-http.log` |
| 连接实例私有 Fetch（AC-27/03） | core `bun test --max-concurrency 2 test/codepuppy-mcp-runtime.test.ts -t 'plugin local MCP uses its private proxy'` | `/tmp/plugin-standard-r2-arm-fetch.log` |
| 别名到原权限 identity 的映射（§4.8） | ext `bun test --max-concurrency 2 src/plugin-host.test.ts -t 'long plugin MCP names'`；此前恢复无映射版本的真实反臂已执行，不重复 | `/tmp/plugin-standard-r2-alias-policy-red.log` |

测试落点偏离：原计划新建 config/data 测试模块，本轮按最低真实层把这些用例放入既有 `install-from-source.test.ts`，DOM 放既有 account-dialog cases，主机身份/原 executor 放既有 plugin-host，不增加一次性回放到日常 suite。core 的 HTTP runtime 证据只跑本次具名 case，没有运行该文件已有容量/重试计时用例。最终消息 DTO 文件 `bun test --max-concurrency 2 src/main/codepuppy-sidecar-messages.test.ts` 15 pass / 0 fail；不重跑已命名原因的 server 基线红例。

r2 静态收口：三个包各 `bun typecheck` exit 0；两 generator `--check` exit 0；36 个实际改动非生成生产模块＋两个手写合同模块 scoped oxlint 均 0 warnings / 0 errors。host artifact aggregate=`9094c2712f8ec5901bf5976ee914ab5a4a6874fa4932317a7881b2c553eb188f`（19 文件摘要见同提交的 artifact JSON），交 alpha-web 消费/重 pin，未声明 W 已消费或公开发布。Alpha 单仓临时 profile 的 `check-docs-contract --changed-since ddb1fc34d3 --format json` 仍 exit 1，71 errors / 251 warnings，plan 的两条旧 unknown-id 保持；`python3 scripts/check-doc-links.py docs/specs/local-plugin-install/plan.md` 8 links PASS；`git diff --check` PASS，hooksPath=`.githooks`。本片累计 38 个手写生产/合同文件，942 行新增/233 行删除（相对 accepted plan commit，不含测试/生成物）；r2 14:31–15:51 约 80 分钟，未超原估算。

交接：依据 spec v5/design v3、accepted plan `ddb1fc34d3` 与 r1 S4-A/B/r2 续派；Codex / GPT-6 已核内容、配置、DATA、别名及 HTTP 独立部分，结论 **PARTIAL**。显式 SSE 等 designer v3.1；AC-13/14 内容完成/初始运行投影接缝交编排器定点续派；真实云/本机工具链验收交集成；SessionEnd/命令/助手交片 5/3；server 旧断言及 docs 基线交编排器，当前不修。已定的 provider、唯一 builder/身份/秘密/出网权威不重开；无额外 OPTIONAL、迁移、依赖或 gate 变更。所有命令前台收完，仅 commit，未推送/PR/merge/启动应用。


实施 r3（2026-11-26 15:52，Codex / GPT-6）：依据 alpha-work origin/main `3a0352e4e3306c0410e2bb680a07f6312d8bcf57` 的 design v3.1 §4.13/§6 S-12/§10，以及 r3 的 AC-14 顺序授权。先闭合 schema→main v1 leaf→ext 唯一投影→现有 SDK SSE，再处理内容函数返回后的默认开启/配置投影/运行收敛；不改已验非 SSE 能力、不新增用户步骤或传输 fallback。四个具名 SSE 红测分别为 schema `remote MCP transport preserves...`、ext `remote MCP projection preserves...`、ui-mac `remote plugin declarations retain...`、core `explicit SSE opens...`，各相关文件 `bun test <file> -t '<name>'` exit 1，均 0 pass / 1 fail，日志 `/tmp/plugin-standard-r3-{schema,projection,main,sse}-red.log`。源副本仅改真实 Cloudinary 声明的 transport 轴；core 正向检查真实 SDK 发出的 HTTP 方法/URL/Authorization，不手写 JSON-RPC server。

S-12 初始文件增量：`packages/schema/src/mcp.ts` 唯一可选 transport 字段、其既有 mcp 测试，core 原 client 与既有 runtime 测试，main `plugin-mcp-config.ts`/`plugin-install.ts`/config 持久化必要消费者，ext 原 engine-transforms。接管同实现提交登记唯一 registry 的 `plugin-mcp-transport`、ADR-047 的具名 accepted 增量及 north-star `UPSTREAM_EXCLUDES` 的 schema 单文件；不改 guard 算法或包级辖区，既有 parity 消费同一打印清单。后续 AC-14 只从既有 state writer 调用者调整顺序；若其合同本身不足则返回精确 seam。相关测试继续两 worker，不运行全包或 gate。


r3 S-12 实现收据：原 RemoteConfig 一字段、main typed leaf/真源/唯一投影、SDK 选择/HTTP 专用收尾已接通。`mcp-server-truth.test.ts` 新具名红测也先 0 pass / 1 fail（`/tmp/plugin-standard-r3-truth-red.log`），再转绿；canonical record 必须保留显式 transport，未增加缺省字段。schema mcp 全文件 3 pass；ext engine-transforms/registry 两文件 24 pass；ui-mac install/ext-config/truth 三文件该步 164 pass；core 具名 SSE GET 1 pass。core typecheck 2,053 files PASS；`packages/client` 的 `bun run generate` exit 0，只同步 promise/generated/types.ts 两处可选字段，没有手改生成物。

真实 SDK SSE 正向：一次性 `/tmp/plugin-standard-r3-runtime.test.ts` 由现有 core runtime harness 取同份生产模块，HTTP+SSE server 使用已安装 `@modelcontextprotocol/sdk@1.32.2` 的 Server/SSEServerTransport（沿 SDK simpleSseServer 的 GET 流＋/messages 结构，本探针 GET 路径为 /events，不手写 JSON-RPC）；没有新增依赖。core `bun test /tmp/plugin-standard-r3-runtime.test.ts -t 'SSE SDK whole protocol'` exit 0，1 pass，实际列 probe、调用 sse-probed、同一 Authorization、原 GET query、SSE 关闭且没有 DELETE，日志 `/tmp/plugin-standard-r3-sse-sdk-direct-close.log`。初稿曾因临时拷贝的 effect/http/import.meta.dir 路径未重定位未进入完整测量，已修正，不计为产品红测。

**SEAM-CHANGE-NEEDED（S-09 实际 SSE POST 端点）**：同一 SDK server 加现有私有 proxy binding 后，`SSE_PROBE_PROXY=1 bun test /tmp/plugin-standard-r3-runtime.test.ts -t 'SSE SDK whole protocol'` exit 1，0 pass / 1 fail；初始化、列工具与调用可完成，但请求观测器判实际 /messages?sessionId POST 没有 private proxy，而 /events GET 有。日志 `/tmp/plugin-standard-r3-sse-sdk-proxy.log`。`packages/util/src/codepuppy-plugin-mcp.ts` 的 pluginMcpEndpoint 只持冻结 binding.serverUrl 的 pathname；跨该路径即委托 base，main 的 EgressProxyHandle.bindPluginMcp 也只有初始 serverUrl，无 SDK 实际端点登记口。SDK 的真实 SSE endpoint 是私有 _endpoint，由 server endpoint event 设置。v3.1 要求“可信 transport 的实际 MCP 端点”经过同一代理，现有冻结契约不足以表达它。最小所需补口为 S-09 的该绑定/代内可信实际 SSE POST 端点登记、main 校验/发布完成后使用、关闭换代撤销；需明确其受控来源及调用边界。不放宽为任意同源路径，不解析第二份 SSE 协议，不访问 SDK 私部，不加 fallback。S-12 本身独立提交；该缺口交编排器/设计续派。


r3 同链 renderer 回归：直接消费者的 `ext-package-detail-wiring.cases.ts` 明确在其 renderer-only backend mock 中调用既有默认开启下一步，安装返回顺序仍由真实 IPC 用例证明。该文件运行 14 pass / 1 fail，唯一失败为旧 `closing token entry clears transient input...` 的 placeholder 断言（预期“粘贴令牌”、实际空串，`/tmp/plugin-standard-r3-renderer-related.log`）。确认 `package-account-dialog.tsx` 与 r2 accepted HEAD 同字节；这是本片 r2 把 secret/option/version 合窗时漏掉既有 secret placeholder 的回归，属本工作引入的同链问题，只恢复原 i18n 文案，不改正确旧断言或视觉方向。先提交该既有红例的运行证据。


r3 AC-14 顺序实现：source factory 是唯一的装后运行调度方，内容事务和不可运行默认投影先返回；其后一个事件轮次沿原 `setPackageStateV1`→main MCP 收敛→既有 reload 发布。folder/Git/marketplace、Registry、已解析 catalog 都沿该 factory；内部 `installDesktopPackageV1`/`installCatalogFromSource` 只提交内容，不重复提前开启。writer 的源文件/签名/锁/账本与配置顺序没有修改；factory 只补传 writer 已存在的 resolveEntry，保留原 native catalog 校验。幂等已安装请求收敛当前状态，不把已关闭包再开启。显式包状态动作成功后取消该包尚未执行的默认激活，避免返回后立即关闭被后台开启覆盖；这是现有 factory 的临时 timer 生命周期，不是新持久状态/权限权威。

永久具名红测 `source installation returns committed content...`（`/tmp/plugin-standard-r3-order-red.log`）0 pass / 1 fail 后转绿；立即关闭用例先移除 cancel 调用，真实 IPC 0 pass / 1 fail（`/tmp/plugin-standard-r3-cancel-red.log`），随后实现不改断言。直接原进程探针 `bun /tmp/plugin-standard-r3-content-boundary.ts` exit 0：`installOk=true, markerObservedBeforeInstallReturned=false, markerObservedAfterActivation=true, directControlObserved=true`，结果 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/plugin-content-boundary-AFCgdg/result.json`，日志 `/tmp/plugin-standard-r3-content-boundary.log`。仍只在完整真实 SAP 临时副本替换 executable、保留 argv，启动受控 launcher，不运行真实插件程序/用户凭据。

行为文件与消费者：source/admission 两文件 70 pass（随后 source/账户组合的 1 条旧 fixture 等待问题已在现有账户 helper 补明确下一事件轮次，账户文件 4 pass）；IPC 宿主 27 pass；最终真实写通道父文件 15 pass，内部恰 27 pass。旧 native-agent reload 测试改为等真正的 sidecar reload 消息，旧 submitted 阶段断言更新为 content committed；account/renderer/官方 SQLite 的 helper 测试明确建模装后默认开启，不更改状态写入断言。首次 61 pass / 9 fail 均是这些旧时序/回调归属断言（`/tmp/plugin-standard-r3-order-step.log`）。两个早期 IPC 运行等待了不匹配的 runtime（空 cleanup/已安装分支），有界终止 lane 自己的进程 exit 143；改为真实非空入口与 reload 完成事件，未声称 flaky 或重复无因运行。

表外同链文件：`plugin-package-accounts.test.ts`、`test-component/ext-install-catalog-result.cases.ts`、`ext-package-detail-wiring.cases.ts`、`official-connectors.cases.ts` 是实际消费被调整的内部安装 helper 的 fixture；只同步所依赖的提交/开启分界。官方文件仅相关 desktop 三例＋密钥版本一例，4 pass；其他真实引擎/stdio/容量/计时场景留 nightly，没有运行整个文件。schema 测试的 readonly literal 类型补全不改变已提交断言。token placeholder 旧断言已转绿；详情宿主最终 15 pass，账户窗独立进程 7 pass。误将两个 process-owned DOM harness 合跑，window.api 的 readonly 定义冲突导致账户窗 7 fail（`/tmp/plugin-standard-r3-dom-final.log`）；确认 shared fixture 的 readonly 定义后分进程执行为 7 pass，未改生产逻辑迎合冲突。


r3 最终相关集（只一次，后续仅改动文件收口）：ui-mac 的 package-admission.parity/package-update/ext-package-lifecycle/ext-package-ledger-uninstall/package-mcp-activation/mcp-server-derivation/sync-upstream-owned-files/local-gate-parity/ext-write-channels 九文件，初次 135 pass / 3 fail（`/tmp/plugin-standard-r3-related-ui.log`）。其中写通道子宿主的 native catalog reload 仍用了固定事件轮次；改为真实 sidecar reload 消息完成、在消息前保持 catalog fixture，最终父文件 15 pass / 0 fail（内部 27 pass，`/tmp/plugin-standard-r3-writer-final.log`），没有重复跑其余八文件。合计已完成范围 136 pass / 2 未决；两条未改动超时为 `local-gate-parity.test.ts:496` 的 required-context 退出码/未比对 fixture（5s）与 `:667` 的 Bun preflight shim（5s）。它们及 codepuppy-check.sh 相对 accepted r2 无改动，未声称 flaky，未改门或放宽阈值，交编排器维护本地检查基线。

core 原 HTTP query-fallback 具名集 `bun test --max-concurrency 2 test/mcp.test.ts -t 'query fallback|codemode'` 11 pass；原 runtime 文件只跑本次两例（SSE GET 与 absent/explicit HTTP）2 pass，不跑其中 nightly 容量/重试/计时。新 HTTP guard 草稿误把 loopback 当 hosted Code Mode，未提交前按原 rejectsUnknownQuery 的 loopback 规则修正 source query 期望；未把草稿当产品红测。S-12 清单打印/parity 的三例 3 pass，registry 判官在前述 ext 两文件中 5 pass；没有执行实际 gate 或完整 north-star run。

分层/选择器：新 schema 合同和 ext 投影属于 fast；main 真盘安装/真源、IPC/mock-runtime 与本地 SDK 的 GET/POST 选择属于 integration；完整 15 实样、受控 launcher、完整 SSE SDK 正反回放属于一次性证据，未加到 suite。永久用例均在原模块文件，以 imports 或原字面路径可追踪，不增加任何每 PR 必跑集或 gate 配置。按续派中的新 AGENTS 运行 `affected-tests --list`，exit 2：`No such file or directory: '<worktree>/.gate-tests'`（`/tmp/plugin-standard-r3-affected-list.log`）；没有可报告的 scope line，不编造范围，也不在冻结 gate 范围外补 manifest，交编排器接现有 selector。

r3 再验完整样本 `bun /tmp/plugin-standard-r3-real.ts` exit 0，15/15 整树、113/113 本片 skill/MCP；结果 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/plugin-standard-r3-real-vsf5Ot/results.json`，日志 `/tmp/plugin-standard-r3-real.log`。本节 r2 的十五行表逐项数量/暂不运行项保持，Langfuse 仍完整 root bundle 0/0；运行边界 callback 不执行第三方程序，不把内容成功计作真实服务/外部工具链可用。


r3 最终删除反臂：在干净 `9577dc76c3` 后运行 `python3 /tmp/plugin-standard-r3-removal-arms.py`，删除 SDK SSE 选择、取消事件轮次延后（变为立即执行）各使相应具名回归 0 pass / 1 fail，日志 `/tmp/plugin-standard-r3-arm-sse.log`、`/tmp/plugin-standard-r3-arm-order.log`；都以 `git restore -- <literal file>` 恢复，无 mutation 残留。立即关闭的 cancel 反臂继承本轮已执行的 `/tmp/plugin-standard-r3-cancel-red.log`；r2 六臂按续派收据继承，未重复运行。

r3 最终静态检查：schema `bun typecheck` 142 files、core 2,053 files / 2 projects、client 178 files、ext 与 ui-mac 均 exit 0；client generator 已在 S-12 同提交同步两处类型。11 个本轮改动手写生产/合同文件 scoped oxlint 0 warnings / 0 errors；host 两 generator `--check` PASS，aggregate 仍为 `9094c2712f8ec5901bf5976ee914ab5a4a6874fa4932317a7881b2c553eb188f`。plan/ADR-047 相对链接共 13 条 PASS，`git diff --check` PASS。docs contract 仍 71 errors / 251 warnings，两条旧 plan unknown-id 与其余基线不动；`affected-tests --list` 在当前提交再次 exit 2，缺 `.gate-tests`，没有 scope line。hooksPath 保持 `.githooks`。r3 约 42 分钟，11 个手写生产/合同文件 +52/-38 行（测试/生成物另计），没有超过原实施上界。

最终交接（r3）：依据 spec v5、design v3.1 `3a0352e4e3` 与 r3 顺序续派；已核为 Codex / GPT-6。S-12 字段/SDK 选择与 AC-14 直接内容返回顺序已完成，state writer 合同未改；整片结论仍 **SEAM-CHANGE-NEEDED: S-09 可信 SSE 实际 POST 端点登记**，以本节真实 SDK 经代理的失败和直接成功对照为证，不报告 DONE。下一步仅给该绑定/代内真实端点的受控登记及撤销端口，继续沿既有 proxy/client；已定的 HTTP 缺省、显式 SSE、原权限/密钥/出网权威不重开。遗留去向：S-09 补口交编排器/设计；两个未改本地检查宿主超时、缺 selector manifest 与 docs 基线交编排器；真实 SaaS/工具链与后续片保持原归属。没有新增 OPTIONAL、依赖、公开配置选择、state-writer 变更、迁移或 gate 算法改动。所有前台命令已收完，仅本分支 commit，未 push/PR/merge/启动应用。


## 片 3 · #1776：命令、子助手与调用语义

- 依据：[Story #1776](https://github.com/impharaon/alpha-code/issues/1776)；[spec v5 @ 7278c10](https://github.com/impharaon/alpha-work/blob/7278c10/docs/specs/local-plugin-install/spec.md) 的完整 AC-06/10、与片 2 合闭的 AC-02 命令/助手/预览、AC-13/14 命令/助手分项；[design v3.1 @ 3a0352e4e3](https://github.com/impharaon/alpha-work/blob/3a0352e4e3306c0410e2bb680a07f6312d8bcf57/docs/specs/local-plugin-install/design.md) §4.1/4.3/4.8/4.9/§5/§6 S-01/§8/§10（其中片 3 合同沿冻结 v3）。
- 核对：IMPLEMENT slice 3 per plan（r5 Phase）；Claude Opus 5.5（orchestrator）的 orchestrator ruling 2026-11-27 已定点补齐 S-01.arguments，Q1 关闭。片 4 的 15 实样、SSE 选择/真实连接、AC-14 延后与关闭取消、删除反臂按 r4 验收收据继承，不重开其历史问题。
- 起于 2026-11-26 16:36（UTC+08:00），基线 `88d40cb6df`、工作区干净、hooksPath=`.githooks`。实施预计 6–10 小时、20–28 个手写生产/合同文件、约 2,000–3,500 行（测试/生成物/真实夹具另计）；每组 AC 后核对实际规模/用时，达到上界两倍返回，不静默扩大。
- 集成顺序保持 4→3→5→7→8→9→6；片 5/7/8/9/6 的 AC 归属继承前节表。本片的调用身份/规则、实际 agent/command 与 Invocation 值成为片 5 的输入；alpha-web 的 converter 消费/重 pin 仍由外仓集成，不在此实现。

### 当前代码与来源核对

- `plugin-package.ts` 当前 Invocation 只有原控制字段，缺 §4.1 的 arguments/argumentSyntax/effort/paths/preloadSkills/memory/maxTurns/background；`plugin-conversion.ts:382–400` 的 invocation/toolRules 尚未补齐，strings 会在括号内部拆工具模式；实际 skill 目录的 openai.yaml 尚未进入转换器。
- `install-from-source.ts` 与 signed profile admission 仍只把 skill/MCP 作为可运行项；其他 entry 保存在同一 bundle 中。片 3 接既有 command/agent 记录和有效投影，不改变片 2 的树/CAS/事务/账本算法或另建包状态。
- `plugin-package-skills.ts` 已有唯一 installed metadata/live-generation 枚举；ext 已用 SkillEditor 注册真实树内技能，可复用该读端扩展命令/助手消费。现有 ToolEditor.update、AgentEditor.update、command.transform/reload 与 session prompt/context/idle 是 S-01 的 L0 接入点。
- `core/src/config/plugin/command.ts:196–260` 的原 evaluateTemplate 在参数替换后扫描 shellRegex，parseArguments 是 native parser；直接重用现状会改变 Claude 参数语义并重新识别插入数据。S-01 指定在同一既有 L3 原语内修正，不在 ext 复制 shell 执行。原 `codepuppy-command-model-priority.test.ts` 可覆盖该执行器/模型优先级，不为本票另建 core 测试文件。
- 真实兼容性报告 §5.2/6/8 的 command/agent、模型/工具及 YAML 失败作为缺陷来源；不是把分析基线的静态候选数字当本片 PASS。下表只列本轮实际检查的源文件数，尚未运行命令/委派。

| 实样 | 固定来源 | 源 command / agent / SKILL.md 数 | 本片证据落点 |
| --- | --- | --- | --- |
| feature-dev | anthropics/claude-plugins-official@0fbfda5a91f4，plugins/feature-dev | 1 / 3 / 0 | 用户命令、原助手指令/工具/模型与真实委派 |
| Codex Vercel | openai/plugins@981b02c0c440，plugins/vercel | 6 / 3 / 54 | commands/status.md、agents/*.md、各 skill 的 YAML |
| plugin-dev | anthropics/claude-plugins-official@0fbfda5a91f4，plugins/plugin-dev | 1 / 3 / 7 | 完整内容/预览、命令/助手注册及兄弟技能引用 |
| Temporal | openai/plugins@981b02c0c440，plugins/temporal | 0 / 0 / 4 | 三份 skill sidecar policy 与显式调用对照 |
| build-chatgpt-app | openai/plugins@981b02c0c440，plugins/openai-developers/skills/build-chatgpt-app | 0 / 0 / 1（整包 5 skills） | dependencies.tools 的 MCP 身份/定义与实际工具可达 |
| claude-security | anthropics/claude-plugins-official@0fbfda5a91f4，plugins/claude-security | 0 / 17 / 6 | ROOT/SKILL_DIR、agent 控制/作用域、显式调用与零提前执行 |

来源清单为兼容报告的 sample.json/plugins.csv；fixture 用现有 `test-fixtures/plugin-helper/{standard,whole}/provenance.json` 和 selection.tar.gz 补最小原件，记录文件摘要/commit；参数、坏规则和可观察 launcher 只对这些真实副本改目标字段。ralph-loop 的 AC-06 参数/脚本对照沿报告同仓固定 commit 取相应原件，不拿手写插件格式替代。

### 改动

| 文件/入口（未注前缀时位于 packages/ui-mac） | 改什么 |
| --- | --- |
| `src/shared/host-extension-package-contract/plugin-package.ts`、`plugin-conversion.ts`、`profiles/plugin-package.v1.schema.json` | 补冻结 Invocation/SkillDisplay/McpToolDependency 及对应严格验证；读取实际 skill sidecar YAML、源模型/工具规则与参数语法，使用同份转换器。只按设计补已有能力，不另写 provider reader。 |
| 同目录两个 generator、mjs/d.mts/artifact、testvectors/corpus；`test-fixtures/plugin-helper/fixture.ts` 与真实 provenance/archive | 类型/schema/ESM/fixture 同版本，syntax 轴生成到消费侧；发布校验指出已发布定义变更时沿仓库版本规则 bump，不另加旧记录迁移或兼容分支。只扩本片实际读取的原件。 |
| `src/main/install-from-source.ts`、`package-admission.ts`、`ext-package-tx-builders.ts`；`src/shared/plugin-install.ts`/`installed-plugin-package.ts` 的必要 typed consumers | 接 command/agent 记录、同树指令引用、有效声明/预览，沿包根启停和既有投影/卸载；保留 namespace、hostName/componentId 与本包依赖映射，使用片 4 已验的内容返回→自动开启顺序。树物化/事务算法不改。 |
| `packages/ext/src/plugin-package-skills.ts`、`plugin.ts`，新增 `plugin-package-invocation.ts` | 复用唯一 installed/live-generation 读端；同一 invoke 路径供用户命令、模型 skill、原 subagent executor 包装；绑定源指令/参数、依赖/路径激活、preload/memory/effort/background/maxTurns，实际任务仍交原 Session/SubagentJob/工具服务。新增模块只拥有这些包调用语义。 |
| `packages/ext/src/policy/{identity,index,gate,catalog}.ts`；`model-facts.ts` 既有模型事实消费者 | source ToolRule/本包 MCP/助手名进入现有身份与唯一 evaluator；可见集合与调用期 allow/deny 分别消费对应源字段；调用期规则清理、硬 deny、用户明确模型/effort 优先均沿原权威，不写永久权限。 |
| 新增 `packages/plugin/src/codepuppy-package-runtime.ts` 与同模块测试；`packages/core/src/config/plugin/command.ts` | 只落 S-01 实际需要的反向 renderer/Location 生命周期端口与同一原生执行原语；PreparedInstruction 依 Q1 定点补口后的冻结定义消费。后续 hook callbacks 不在本片预置空实现；同进程两 bundle 必须共享同 Location 槽。 |
| `docs/architecture/codepuppy-authority-registry.json`、ADR-047 的 S-01 窄增量、`docs/architecture/modules.md`、本节 | 同 engine 实现提交登记 plugin-invocation-semantics，并同步原 command-model-priority/project-opencode-config-trust 的实际能力说明与具名证明。command.ts 已在精确接管清单；只在确有新路径时做机械登记，不改 gate 算法/阈值。 |

### 顺序

1. **合同问题先定点返回（本次 PLAN）**：写入 Q1 与文件/证据计划，只有 plan.md 提交。设计补齐 S-01 后在首个实现提交填核对行，不先写一个自选 port shape。
2. **转换与合同红→绿**：具名实样重现规则误拆、命令/助手字段遗漏、YAML false/依赖遗漏；先独立提交正确红测，再补统一 converter/验证/schema 与生成物。只运行改动 case，随后转换/宿主合同各相关文件完整一次。
3. **S-01 renderer 红→绿**：同一 ConfigCommand 原语识别 source 语法后才绑定值；用户命令和包调用消费同一 renderer。端口/Location dispose/工作区隔离及原生参数/项目 gate 回归随同一提交；registry/ADR 与实际 engine 改动同提交。先跑新 -t，再跑对应原模块文件一次。
4. **安装与 L0 运行入口**：接命令/助手内容记录、启停/预览、统一 invocation 和原执行器包装；真实工具清单、Agent.Info/子会话指令与模型建议读回。preload/路径/记忆目录只在对应运行时创建/注入；完整树、ROOT/SKILL_DIR/DATA 消费片 2/4 的现有权威。
5. **同一权限/身份与运行收口**：真实调用绑定规则、可用工具集合和模型/effort，显式用户与 deny 反臂；关闭/移除、下一用户消息/完成清理。一次临时 HOME/XDG/数据根下回放六实样，实际源脚本只在临时目录中用受控标记运行，真实 SaaS/模型供应凭据和工具链留集成验收。最后只跑一次按实际改动 import/mock/枚举搜出的较宽相关集及适用包 typecheck/lint/generator/文档检查，commit only。

### 风险

- **S-01-Q1 冻结端口缺字段（当前停点）**：§4.1 Invocation.arguments 与 §4.9 的命名参数是本片必需输入，但 §6 `PreparedInstruction` 只有 parts/syntax/rawArguments/cwd。源字符串仍须保留 source；core 被指定先识别原模板参数/shell 节点再绑定值。当前形状中，body=`$target`、rawArguments=`first second`，arguments 分别为 `["target"]` 与 `["unused","target"]` 的两个合法声明会得到相同 renderer 输入，却应得到 first 与 second。renderer 无法从输入恢复参数名位置。ext 先展开或改写命名参数还涉及缺位 named 为空、indexed 保留的差别，并移走已冻结给 core 的解析责任。
- **Q1 建议最小补口**：在 `PreparedInstruction` 携带 Invocation 的有序参数名（建议 `arguments: readonly string[]`，原样传递），仍由 core 这一份 parser/renderer 解释；不新加解析器、上下文 registry 或旁路消息。需设计确认该字段/缺省和共享生成位置；本节不把建议写成已批准合同。
- **工具可见与授权混用**：agent.tools/availableTools 与 allowed-tools 的测试必须分别删行为变红，不能把后者变白名单或永久 allow；真实 deny/项目信任/出网继续有反臂。Task/Skill/MCP 源名映射跟同一 entry/hostName/generation，不能为长模型别名另造权限身份。
- **数据成为代码或参数缺位丢意图**：同一实际 renderer 验源静态 shell、含引号/反斜杠的参数、bound ROOT/值和用户注入的反引号/美元。原生 opencode 语法继续走其声明轴；不靠先 join/split 或 ext 自己跑 shell。
- **子会话并发/结束清理**：规则、effort、preload/memory 与 child/turn/task 的实际身份关联；前后台与 maxTurns 必须取原任务机制的真实结果。用下一用户消息、同包另一入口、另一 session 和换代/关闭反臂检出串用，不能只检查转换 JSON。
- **静态展示冒充运行与依赖**：根 YAML 不是子助手；skill YAML 的 false、MCP 工具依赖和资源相对位置需要走实际入口。缺依赖只报告消费项具体名字。默认提示只在用户从入口发起时预填，安装没有模型提交/脚本执行。

### 证明

命令 `U/E/C/P` 分别从 packages/ui-mac、ext、core、plugin 运行 `bun test --max-concurrency 2 <file> -t '<name>'`。新永久测试在既有模块文件；只有新端口模块新建同名测试。下面名称为待新增/调整的具名证据，不是 PASS 收据。

| AC/合同分项 | 具名证据与命令/宿主 | 层与运行时机 | 删除行为为什么会失败 |
| --- | --- | --- | --- |
| AC-02 命令/助手/预览 | U `src/main/install-from-source.test.ts`、`package-admission.test.ts`：`plugin-dev installs commands and agents from the same live bundle`；真实 7 skills/1 command/3 agents、资源/图/预览来源及 active 清单读回 | integration；受影响 PR＋nightly | 仍只接 skill/MCP、伪装为 skill、漏组件或引用错代时实际库存/指令不同 |
| AC-06 参数与 shell；Q1 | C `test/codepuppy-command-model-priority.test.ts`：`package instruction renders source nodes before bound values and arguments`、`declared argument names select their ordered values`；feature-dev/ralph-loop 副本只改目标参数字段，正向源脚本标记、含 !`/美元/引号数据的负向臂 | integration；受影响 PR＋nightly；完整样本执行为一次性命令证据 | 恢复旧 parse/参数后扫描会串位、吞尾参或执行数据；删名字字段传递会使 first/second 的同模板两臂混同 |
| AC-06 工具规则词法 | U `src/shared/host-extension-package-contract/plugin-conversion.test.ts`：`source tool rules retain quoted nested patterns and recover the next rule`；按真实声明字段做有界副本变体 | fast；受影响 PR＋nightly | 括号内空格/逗号被拆、坏规则吞其他合法项会在归一化规则及诊断定位处失败 |
| AC-10 助手/模型/实际工具集合 | E `src/plugin-host.test.ts`、`src/policy/register-policy.test.ts`；C 原 command-model-priority 的相关 case：`package agent delegates with its instructions and tool set`、`explicit user model wins over a package suggestion`；feature-dev/Vercel 的原执行器/真实 child 指令/离线模型请求读回 | integration；受影响 PR＋nightly；完整旅程一次性回放 | 少注册、只给 description、工具名错译、建议覆盖用户或另起执行循环会在真实 child/模型请求/工具执行处失败 |
| AC-10 YAML policy/依赖/显示 | U 原 converter 文件与 E `src/plugin-host.test.ts`：`skill sidecars preserve manual policy and resolve declared MCP dependencies`；Temporal 的 false 仍可用户显式调用，build-chatgpt-app 的工具依赖可达，根 interface 不造 agent，资源按 skill 目录解析 | fast＋integration；受影响 PR＋nightly | YAML 未读、false 被覆盖、只存依赖说明或把界面配置当 agent 会在入口/实际 MCP 身份处失败 |
| Invocation 运行字段 | E `src/plugin-host.test.ts`：`package invocation applies source effort paths preload memory and task controls`（按字段表驱动）；实际 read/edit/write 激活与显式调用对照、真临时目录内容、source maxTurns 的 partial/可继续、原前后台任务结果 | fast 的字段投影＋integration 的真实挂点；完整子任务旅程/时机测量只作一次性或既有 nightly | 去掉字段消费后不仅 JSON 不同，模型上下文/文件触发/目录与任务结果也必须改变；跨 session/下一用户消息的作用域反臂失败 |
| D3 调用期 allow/deny 与身份 | E `src/policy/register-policy.test.ts`、`identity.test.ts`、`src/plugin-host.test.ts`：`package invocation permissions expire without changing persistent rules`；命中普通 ask、硬 deny、availableTools、下一消息/结束/关闭、MCP 与助手源名同映射 | fast＋integration；受影响 PR＋nightly | 永久放宽、allow 充当可见白名单、holdAsk 抹掉合法来源 allow、错包名或残留状态均有实际拒绝/执行/可见性对照 |
| AC-13/14 命令/助手分项 | U 原 install/admission、E 原 plugin-host；一次性临时完整六样本的安装→调用→关闭→移除，安装阶段 marker/process/tool-call 为零，明确触发的同样本正向臂能观察；卸载本包运行入口/包内 memory 清理，项目共享记忆依原归属保留 | integration 的入口开关；整包旅程一次性命令＋输出（不加日常 suite） | 提前模板执行、只写 desiredState 却仍可委派/调用、移除漏注册或误删共享资料都会在可观察副作用/实际清单处失败 |
| S-01 单槽/同一原语 | P 新 `test/codepuppy-package-runtime.test.ts`：`instruction renderer follows the Location lifetime across module consumers`；C/E 上述真实调用链 | fast 的槽生命周期＋integration 的真实 renderer；受影响 PR＋nightly | 两 bundle 各存一份、漏 dispose/工作区串用或 ext 另写执行器不能满足真实绑定/释放及单一 renderer 反臂 |

实现时按导出与字段实际变化用 rg 找 import/mock/枚举/读文件消费者，初选 U 的 host artifact/envelope/install/admission/account/write-channel 文件，E 的 plugin-host/engine-transforms/policy register/identity，C 的 codepuppy-command-model-priority 与 tool-skill/tool-subagent 中相关具名 case。每步只改动 case 迭代、完成时对应行为文件一次；heavy/timing/容量的既有 case 留 nightly，不能因同文件而全跑。最后一次较宽相关集只补实际可达消费者，不跑全包/项目、bin/check 或 gate。永久用例 imports/字面路径可被 selector 追踪；按新 AGENTS 返回前执行 affected-tests --list，缺 manifest 如实报告，不在冻结 gate 外加配置。文档跑本文件链接/合同及 diff 检查；适用包各 bun typecheck、scoped lint、两个 generator --check。

### 偏离记录

2026-11-26 · 本轮按 r4 的“发现未裁决设计问题则停在 PLAN-READY”执行：只追加本节，没有实现代码、测试或 engine 登记改动。S-01-Q1 是冻结跨模块输入缺失，不能由本车道增字段/改责任来绕过；建议最小输入字段已列于风险，待编排器/设计裁决后进入第 2 步。片 4 accepted 及其他已定合同继续继承。

2026-11-27 · orchestrator ruling 2026-11-27（Claude Opus 5.5，r5）：S-01 的 PreparedInstruction 增加 `arguments: readonly string[]`，原样传 Invocation.arguments，未声明为 []；仍由 core 唯一 renderer 解析。Q1 已裁决，按 IMPLEMENT 继续，不在 ext 预展开参数。S-01 增量随 engine 实现同提交登记。

转换步骤证据：`9beb41bae1` 为三个具名红测（0 pass / 3 fail），真实六样本原件同提交固定。实现后 `bun test src/shared/host-extension-package-contract/{plugin-conversion,host-extension-package-artifact,package-envelope-v1}.test.ts`（ui-mac）154 pass / 0 fail，包内 `bun typecheck` exit 0。实际转换与严格模型/schema 同步，生成物/corpus 由原 generator 更新。两次类型检查误从根目录启动，触发范围外 turbo 检查并已结束（codepuppy-ui exit 2），不计作相关验证，也未调查/修复范围外错误；其后包内命令明确 workdir。

本轮 PLAN 收口（2026-11-26 16:47，Codex / GPT-6）：只读核对固定设计/真实样本/既有入口，约 11 分钟。`python3 scripts/check-doc-links.py docs/specs/local-plugin-install/plan.md` exit 0，8 条相对链接；`git diff --check` exit 0。单仓 docs profile 的 `check-docs-contract --changed-since 88d40cb6df --format json` exit 1，71 errors / 251 warnings，与已接受基线一致（`/tmp/plugin-standard-r4-plan-docs.json`）；按派发不修两条旧 unknown-id。`affected-tests --list` exit 2，缺 `.gate-tests`，无 scope line（`/tmp/plugin-standard-r4-plan-affected.log`）。未运行测试/应用/全量门，hooksPath=`.githooks`。已核依据 spec v5/design v3.1 与 r4；结论 PLAN-READY / Q1 待裁决。下一步由编排器/设计定点补 renderer 参数名输入；其余遗留维持原去向，无额外 OPTIONAL。

片 3 S-01 步骤：`3545ea2f8e` 的红测先报端口缺失（0 pass / 1 fail / 1 error）；实现后 core renderer 新 case 2 pass（10 assertions），对应既有 command 文件 7 pass，plugin 跨 bundle/Location/dispose 1 pass（5 assertions），registry 5 pass。包内 plugin typecheck 326 files exit 0；core 的两个新推断错误在同一行显式 flatMap 域类型消除，包内 typecheck 2,057 files / 2 projects exit 0。源码 AST 在值绑定前构建，S-01.arguments 原样输入；端口、core、registry/ADR 同提交。syntax 轴由现有 conversion generator 从唯一合同生成 `packages/plugin/src/codepuppy-package-syntax.ts`（必要的附加文件），没有手写第二份枚举。

### r5 实施收据与冻结接缝停点

**SEAM-CHANGE-NEEDED: PackageAllowSetV3** — 片 2 的 `packages/ext/src/package-scope.ts:5–35` 是 main/ext 共享且唯一解码的允许集，scoped.kind 及 scopedPackageAllowedHere 只接 skill/mcp；`packages/ui-mac/src/main/ext-receipt-v2.ts:621/632` 的唯一生产者过滤其他 kind、仅给 skill 生成全局 keys。两处属片 2（`git blame` 为 6fe4aeba8d、相关 package-scope 登记为 972650bab6），不在 r1 的 S4-A/B 例外内。本片运行项必须随根开关/项目范围变化；feature-dev 只有 1 command/3 agents，现投影不能承载其活动身份。一次只读 `decodePackageAllowSet` 探针输出 `skill true / mcp true / agent false / command false`（`/tmp/plugin-standard-r5-allowset-probe.log`）。现有 engine command 生效声明虽会在关包时撤下，但不是可供同一 Invocation 权限/作用域消费的 typed membership；ext 另读账本或伪造 skill key 都会绕开指定的唯一投影。

**最小需要**：授权在本分支增量修改上述片 2 两文件，让现有 keys 生产支持全局 command/agent、scoped.kind 与同一判定支持 command/agent，仍由现有 root/effect/claim 算法派生，启停写者和事务顺序不变，不另建状态/迁移。这是冻结片 2 合同的域轴增量，不是需要重新决定 Invocation 设计；S-01.arguments 的 r5 裁决已经实施且不重开。未擅改冻结生产者，尚未接 command/agent 安装/运行与本次调用期权限，不能报告整片 DONE。

| 固定实样 | 实际转换 command / agent / skill / MCP | 本轮读回及运行验收 |
| --- | --- | --- |
| feature-dev | 1 / 3 / 0 / 0 | 原声明完整；命令/委派运行待补口 |
| Codex Vercel | 6 / 3 / 54 / 1 | skill YAML 读回；命令/委派待补口；.app.json 仍是批准排除的 unresolved-app-id |
| plugin-dev | 1 / 3 / 7 / 0 | 规则与字段完整转换；命令/委派待补口 |
| Temporal | 0 / 0 / 4 / 0 | 三项 manual-only；独立 YAML false 反臂已红，整包调用旅程未跑 |
| build-chatgpt-app（openai-developers 整包） | 0 / 0 / 5 / 2 | 真实 YAML 的 MCP dependency/url/transport 保留并生成连接器声明；.app.json 仍单列排除，实际 SaaS 调用未验 |
| claude-security | 0 / 17 / 6 / 0 | 3 manual-only，源控制/模板保留；助手实际运行待补口 |

一次性读回命令：ui-mac 下 `bun -e` 导入原 fixture/converter，逐一 convert 六个 pinned captures，输出各 kind/manual/diagnostics；结果在 `/tmp/plugin-standard-r5-six-samples.jsonl`，未执行实样脚本/真实 SaaS。此表是转换证据，不把片 4 的既有整树安装验收或静态候选数字充当片 3 运行 PASS。

相关检查（2026-11-26 17:14，Codex / GPT-6，r5 起 16:55 约 19 分钟）：

- UI：一次较宽集合 `bun test src/shared/host-extension-package-contract/{plugin-conversion,host-extension-package-artifact,package-envelope-v1}.test.ts src/main/{install-from-source,plugin-sources,package-child-kind.fast,package-admission}.test.ts` 为 278 pass / 1 fail。唯一新失败为独立 converter 输出目录探针不含新增 SDK 文件；修其路径归属后，改动行为文件完整一次 **38 pass / 0 fail**（其余六文件先前 241 pass）。两个 generator --check exit 0，19-file artifact 校验通过；ui-mac 包内 typecheck exit 0。
- Core：S-01 文件初步 7 pass；发现 native `$ARGUMENTS[0]` 被 Claude 语法吞掉后，`d9db474def` 单独红测 0 pass / 1 fail，修后完整文件 **8 pass / 0 fail**。较宽相关 `test/config/command.test.ts test/command.test.ts` **35 pass / 0 fail**；包内 typecheck 2,057 files / 2 projects exit 0。
- Core 基线：`test/config/command-subagent.test.ts:92/116` 三条测试仍期望命令/助手模型覆盖父会话明确模型，与原 l1r-command-model-priority 实现相反。较宽首次 1 pass / 3 fail；按 delivery-ship §3 只做一次具名基线对照，用 `0c08b28836` 的原 command.ts 重跑该文件，仍 **1 pass / 相同 3 fail**（`/tmp/plugin-standard-r5-core-baseline.log`），随后逐字恢复当前实现。交编排器，未改未弱化旧断言。
- Plugin：新端口生命周期文件 **1 pass / 0 fail**，包内 typecheck 326 files exit 0。Ext：既有实际 SkillEditor 绑定 case **1 pass / 20 assertions**；随后对应宿主行为文件完整一次 **55 pass / 0 fail**；identity/authority-registry 文件 **24 pass / 0 fail**，包内 typecheck exit 0。没有包级 lint script，不跑根级 lint/gate。
- 六条删除反臂：丢参数名顺序、把 boundValue 变 source、提前插入原始参数、Claude 下标改为 1-based、删括号词法、忽略 YAML false，分别 **0 pass / 1 fail**；恢复后逐字 cmp。初次 YAML 删除反臂仍绿，证明原 case 的冗余 frontmatter 没剥掉（真实字段是 disable-model-invocation）；新增独立 YAML case 剥掉真实字段，反臂转红，恢复后该 case 1 pass。没有修改已提交红测的正确断言。
- 文档：plan 8 条相对链接通过；docs-contract 71 errors / 251 warnings，继承指定基线，两条旧 unknown-id 未动。`affected-tests --list` exit 2：缺 `.gate-tests`，无 scope line（`/tmp/plugin-standard-r5-affected.log`）；冻结 gate 未改。两次误从根启动 typecheck 的 turbo 均已结束，返回既有 codepuppy-ui 错误，未计 PASS/未调查；后续均指定包目录。

偏离：新增 SDK syntax 生成文件为同一语法轴的必要消费者；`plugin.ts` 的 display.description→shortDescription 为共享严格 SkillDisplay 变更的必要同链消费，frontmatter description 也进入该字段。初步类型检查的两个推断错误和 converter 临时输出目录回归均由本轮修正。没有新增依赖/选项、旧记录兼容、迁移或 engine 文件接管；S-01 登记与实现同提交，后续 native 语法修正同步补具名 proof。计划后续安装/L0 调用/权限/六样本运行旅程尚未实施，因上述冻结接缝停止。

交接：依据 spec v5 / design v3.1 / r5 arguments 裁决；已核 Codex（GPT-6），结论 SEAM-CHANGE-NEEDED，不是整片通过。已定勿重开为片 4 accepted 与 S-01.arguments；下一步编排器授权上述 PackageAllowSetV3 两文件增量后继续本片第 4/5 步。遗留去向：冻结补口 fix now；三条 baseline command-subagent 断言、缺 selector manifest、docs 基线交编排器；真实 SaaS/工具链仍 integration acceptance。OPTIONAL：无。

最终修正提交前再次 `git diff --check` exit 0、plan 相对链接 8 pass，hooksPath=.githooks；所有本车道前台测试/类型/生成器/文档命令均已结束。机器上其他 worktree 的 gate 不由本车道启动/处置；本车道 Bun 测试未启用并行文件。实际非生成生产变更约 7 文件/300 余行，尚未达到计划后续工作，停点由冻结合同触发，非规模/时间超限。

2026-11-27 · orchestrator ruling 2026-11-27（Claude Opus 5.5，r6）：授权扩展片 2 PackageAllowSetV3 的既有 keys/scoped kind 投影为 command/agent，仍沿原 root/effect/claim 算法。仅 package-scope.ts 与 ext-receipt-v2.ts 的该域轴增量，不增 DTO 字段/状态文件。r5 停点关闭，继续 IMPLEMENT 片 3；另按 r6 在临时 detached origin/alpha 实跑三条 command-subagent 断言，并在结束后移除该 worktree。

片 3 r6 基线核对：临时 detached `/tmp/alpha-code-1776-r6-alpha` 固定 origin/alpha `5c896630ab0ca03f2c364f88e281007c31f8d202`，bin/setup exit 0。包内 `bun test --max-concurrency 2 test/config/command-subagent.test.ts -t "runs native JSON|runs subagent mode|subagent: false"` 为 0 pass / 同名 3 fail（`/tmp/plugin-standard-r6-origin-alpha.log`），确认为 origin/alpha 已存在；未改断言/产品，临时 worktree 已移除。允许集新红测各 0 pass / 1 fail（b71376a3ce）；域轴扩展后 ext scope 文件 39 pass，生产者新 case 1 pass。旧“非投影记录”测试使用 agent，因本次 agent 进入投影而不再成立，同提交改用不贡献调用入口的 bundle，保留其 publish lag 断言。

片 3 r6 内容准入步骤：真实 plugin-dev 新具名用例 a21d9b522d 红（0 pass / 1 fail），接入后 1 pass / 15 assertions；install-from-source 行为文件 45 pass，package-admission 文件 26 pass（此前同组 70 pass / 1 fail，唯一旧断言把 command/agent 视为 unsupported，按本片行为改为校验 1 command/6 agents，hook 仍未运行）。新增 buildPackageInstructionTxItems 只复用 receipt/config 事务项：指令留唯一 live 树，agent 叶仅承载既有启停投影；没有改整树/CAS/事务或 state writer 算法。pluginInstructionDefinition 从统一 converter 读取 metadata/原 Text body，执行端不另写 YAML parser。shared declaration/outcome 只扩 approved command/agent kind，生成物同版本更新；ui-mac 包内 typecheck exit 0。


片 3 r6 L0 运行接线：沿原 command/skill/subagent executor 注册，同一 renderer、调用期 policy 与模型权威。新增 runtime 文件为计划中同一调用过程的承载；既有 ShellScan 纯叶仅用于 Bash 规则匹配原工具参数，未另造 shell parser/执行器。公开工具规则中的包路径沿唯一 Text binding 解析；多命令须逐项获得来源授权，硬 deny/安装询问不被覆盖，Edit/Write 共享原生权限 action 时按实际工具身份保留 Edit。新增 context memory/partial/dependency 文案登记在原 injection registry 与快照。没有新增 core takeover；原 S-01 登记在同一运行实现提交补上具名 proof。

新增控制旅程测试独立提交 0fdd1309b0；撤掉 L0 registration 后 preload/memory/effort/maxTurns、paths/manual、真实 YAML MCP dependency、skill 参数/下一轮 deny 四条均红（0 pass / 4 fail，`/tmp/plugin-standard-r6-fields-red.log`）。测试宿主改用真实 LocationServiceMap 图与 SDK 插件顺序，离线 LLM 仅代替模型服务；MCP 使用既有 SDK echoMcpHandler + 本地临时服务，原工具连接/执行/策略均真实。根会话显式 title 防止辅助命名请求消费工具响应，属于测试装配修正。测试中仅把真实 YAML URL 替换成本地回环端口，真实 SaaS 与密钥服务不启动。


片 3 r6 运行实现通过：ext 包内 `bun test --max-concurrency 2 src/plugin-host.test.ts src/policy/register-policy.test.ts` **135 pass / 0 fail / 558 assertions**（`/tmp/plugin-standard-r6-runtime-final.log`），`bun typecheck` exit 0。子任务 partial 读取原生 max-steps 常量对应的实际最终请求，steps 仍由 Agent.Info.steps 控制，不计数猜测/另造上限；已有子会话保留。模型显式 variant 优先与源 alias→实际目录两臂通过。manual-only 直接模型工具绕行新红测（b6c63743c7；0 pass / 1 fail）后已在统一调用点拒隐式、保留显式命令/附件。

六实样一次性旅程 `/tmp/plugin-standard-r6-real-samples.log` **6 pass / 0 fail**：feature-dev 1 command/3 agents（feature-dev/code-architect）、Vercel 6/3（status/ai-architect）、plugin-dev 1/3（create-plugin/agent-creator）、Temporal 0/0（temporal-cloud-setup 显式 skill）、claude-security 0/17（attack-surface-analysis/attack-surface-redactor）；全部源 command/agent 进入真实注册表，前五包关闭与移除后的旧入口重调均拒绝。第六为 build-chatgpt-app：真实 YAML 连接声明仅替 URL 为本地 SDK echo 服务，真实 MCP 客户端/工具执行 1 次，移除依赖后具名 dependency_missing。各原树保留，S4 15/15 安装结论继承；实 SaaS、完整安全扫描及模型质量不冒充本机验收。

AC-06 Ralph 原件一次性 `/tmp/plugin-standard-r6-ralph.log` **1 pass / 0 fail / 7 assertions**：复制兼容报告固定 anthropics/claude-plugins-official@0fbfda5a91f4/plugins/ralph-loop 到临时目录，经实际 command→离线模型选择原 shell 工具→原 setup-ralph-loop.sh，在临时项目生成 .claude/ralph-loop.local.md，读回 prompt/max_iterations=2/completion_promise=DONE。调用前无状态文件；Bash 包路径规则已绑定，canonical shell ordinary ask 被该源规则放行。hooks 停止循环归片 5，未在本片假装可用。一次性 probe 已从测试文件移除；实树 helper 补保留原 mode，第一次 probe 因 helper 丢 executable bit 失败，修测试装配后通过，生产 materializer 原已保留 mode。


### r6 完成收据（片 3）

已核：Codex（GPT-6），spec v5 @7278c10、design v3.1 @3a0352e4e3、r5/r6 orchestrator ruling 2026-11-27。结论 DONE。r6 从 2026-11-26 17:19 到 18:40（UTC+08:00）约 81 分钟；片 3 各轮累计约两小时，低于预计 6–10 小时，未达两倍停止线。原计划顺序/AC 归属未改；无新增 engine 接管，冻结 S-01/r6 allow-set 增量均同实现提交登记/记录。片 4 accepted 原结论继承，下一片由编排器续派。

- 最终较宽 UI：包内 `bun test --max-concurrency 2` 的 25 个具名相关文件（converter/artifact/envelope、install/admission/receipt/builder、kind、启停/ledger/boot/project/scope/update/presentation；完整命令在 `/tmp/plugin-standard-r6-ui-related.log` 对应执行收据）**734 pass / 0 fail**。signed whole-profile 的已有 plugin-dev case 后补 command=1/agent=3 真实 graph/receipt 与根开关 keys 断言；撤准入 command/agent 为 **0 pass / 1 fail**，恢复后该文件完整 **26 pass / 0 fail / 241 assertions**（`/tmp/plugin-standard-r6-signed-profile-final.log`）。未运行 lifecycle permutations/时机/容量/浏览器、whole package 或 project suite。
- 最终 Ext：8 文件相关集第一次 **260 pass / 1 fail**（`/tmp/plugin-standard-r6-ext-related.log`）；唯一失败为新增 idle 挂点及已有 S4 alias 回调后的库存旧精确值。保留总数精确断言和共用 request callback 身份断言，同步真实 4 个 context 回调；补真实 idle 事件无上下文改写的咽喉，未改分类/上限/门。context-injection 完整 **44 pass / 0 fail / 607 assertions**；最终宿主完整 **65 pass / 0 fail / 357 assertions**（`/tmp/plugin-standard-r6-host-final.log`），含 user/project/local 真实 memory、read 硬 deny 时模型零请求、idle/下一用户输入的权限过期。合并未重跑且未再改动的其余 6 文件 **155 pass**，当前 8 文件共 **264 pass**，不把重跑累计为新 PASS。
- Core：包内 `bun test --max-concurrency 2 test/codepuppy-command-model-priority.test.ts test/config/command.test.ts test/command.test.ts` **43 pass / 0 fail**（`/tmp/plugin-standard-r6-core-related.log`）；Plugin 端口文件 **1 pass / 0 fail**（`/tmp/plugin-standard-r6-plugin-related.log`）。三条 command-subagent 仅做上述 origin/alpha 固定 SHA 对照，仍为预存红，未改断言/产品，不计在绿色集合。
- UI/Ext 包内 `bun typecheck` 均 exit 0（`/tmp/plugin-standard-r6-{ui,ext}-typecheck.log`）；converter 与 19-file artifact 两个 generator --check exit 0；ext `bun run build` exit 0，Node 仅导入 dist 读回 `setup: function`，未启动应用/服务。新 runtime 文件 scoped prettier --check exit 0，无包级 lint script。没有跑 bin/check、gate run 或全量测试。
- 新删除反臂 **14 项均红**：preload、memory、effort、partial、paths、manual-only、缺 MCP dependency、关闭 membership、skill 参数、Bash 每条命令覆盖、共享 edit action 的实际工具身份、源模型 alias、idle 清理、signed whole-profile command/agent 准入。各为一次具名 **0 pass / 1 fail**，恢复用 scoped git restore 并逐字比较。日志 `/tmp/plugin-standard-r6-removal-results.jsonl` 及 `*-remove-{memory-strengthened,idle,signed-profile}.log`、`*-alias-red.log`。memory 初次反臂仍绿：后续主动 read 掩盖初始注入；984e63f6d7 收紧到首个请求 system 后转红。另保留 r5 的六条参数/词法/YAML 反臂，不重复运行。
- 文档：plan 相对链接 **8 pass**，diff --check exit 0；docs-contract 单仓 profile **71 errors / 251 warnings**，为已接受基线，两条 plan 旧 unknown-id 未改（`/tmp/plugin-standard-r6-docs.json`）。`affected-tests --list` exit 2：本基线缺 `.gate-tests`，无 scope line（`/tmp/plugin-standard-r6-affected.log`），冻结 gate 未动。机器存在其他 worktree 的 pre-push，本车道 Bun max-concurrency=2、不干预。

偏离/必要同链文件：上下文库存快照与现有 context-injection.test.ts 是新挂点的机械同步；现有 package-admission.test.ts 补签名入口真实准入/启停证据；测试 harness 采用真实 LocationServiceMap/SDK 生命周期，并只把模型换离线、MCP 连临时本地真实 SDK。两个 memory mode case 属 integration 层、受影响 PR＋nightly，imports/字面路径与既有 plugin-host 同依赖，不扩大每个 PR 的全局集。MAX_STEPS_PROMPT 仅消费 core 的既有纯常量，实际 steps 及执行循环仍全归 core；无需新端口。一次误从根发起的 Bun 测试命令被根 guard 拒绝，未计入结果，其后均指定包目录。

遗留去向：origin/alpha 的三条模型优先级旧断言 → 编排器处理；docs-contract/缺 selector manifest → 继承指定基线交编排器；真实 SaaS、工具链、扫描质量 → integration acceptance；alpha-web 共享 converter/pin → 外仓后续集成。没有独立发现的 ARCH 问题或 OPTIONAL。所有本车道前台命令结束，hooksPath 保持 .githooks；只 commit，不 push/PR/merge。

## 片 5 · #1776：hooks、扩展事件与会话监视

- 依据：[Story #1776](https://github.com/impharaon/alpha-code/issues/1776)；spec v5 @7278c10 的 AC-11/15、AC-03 hook 当次 allow、AC-13/14 其余运行入口、AC-20 hook OPTION、AC-22/23/24、AC-25 hook DATA 与生命周期、AC-30；[design v3.1 @8389b0f](https://github.com/impharaon/alpha-work/blob/8389b0f/docs/specs/local-plugin-install/design.md) §4.1/4.4/4.10/4.12/4.15、§5/6 S-03…S-08、§8/10。r5 arguments 与 r6 command/agent allow-set 的编排裁决继续有效，不因设计文字尚未镜像而撤回已接通行为。
- 核对：IMPLEMENT — 0192606eac · orchestrator / Claude Opus 5.5 · slice 5 plan accepted with the bundle allow-set seam（r8 Phase）。orchestrator ruling 2026-11-27 授权 keys/scoped 域和唯一生产者增加 bundle；无新字段、不显示为 UI component。R5-ROOT 已裁决，按本节计划继续实施；片 4/3 及 r7 rebase 收据继承。
- r7 起于 2026-11-26 18:42（UTC+08:00）；本片实施预计 8–12 小时、约 30–40 个手写生产/合同文件、3,500–5,500 行（测试/生成物另计）。每组 AC 核对实际范围/耗时，达到两倍停止线返回，不扩大到其他仓或门。
- 集成顺序仍为 4→3→5→7→8→9→6。本片不实现 LSP（片 7，AC-21）、style/default（片 8，AC-28/29）、source.command/link（片 9，AC-31）或原生引用/最终 UI（片 6，AC-02/08/09/13/15 的其余部分）；W 仅继承共享 converter/pin 的外仓依赖，不在此修改。

### r7 新基线与已完成验证

1. fetch 后 origin/alpha 固定为 `1db6a3bbf5963e8a58e57719e2a441a55da21b21`（#1762 squash）。按指定 `git rebase --onto origin/alpha c4f213f461 feat/1776-plugin-standard` 重放 42 个 #1776 提交，全部保留；原 821be82013 对应新 `3c41fa7a90`。`git range-diff c4f213f461..821be82013 origin/alpha..3c41fa7a90` 的 38 项补丁相同，4 项只因下列机械合并改变上下文；证据 `/tmp/plugin-standard-r7-range-diff.txt`。
2. 冲突仅四文件：server.ts 两次顶部新增 import 取并集；network-egress-proxy.test.ts 末尾分别追加的对话 CONNECT 与 plugin capability 用例都保留；context-injection-inventory.snapshot.txt 用合并后的唯一登记簿 generator 重建（仅总计冲突）；context-injection.test.ts 保留联网 notice 与 package idle 两项测试，实际 context 回调数量由 alpha 的 3 加本片前序的 2 得到 5，并保留共用 assembler 的同一对象/恰一次断言。没有取舍双方行为或变更 #1762 的 re-vendor/登记。
3. bun.lock 由 alpha 增量改变，`bun install --frozen-lockfile` 成功，2 packages installed；随后 core.hooksPath 复核为 `.githooks`，工作区干净。没有启动应用、Electron 或窗口。
4. 同 r6 的 25 UI＋8 Ext＋3 Core＋1 Plugin 文件/集合各重跑一次：UI **734 pass**、Ext **265 pass**、Core **43 pass**、Plugin **1 pass**，均 0 fail，合计 **1,043**，对照原 1,042 的 +1 来自 alpha 新增的联网 notice 登记测试。完整命令沿 r6 同组收据，日志 `/tmp/plugin-standard-r7-post-rebase-{ui,ext,core,plugin}.log`。
5. 另补片 4 改动行为：UI sources/truth/proxy/messages/write-channel 五文件 **103 pass**；proxy 具名 `plugin loopback HTTP requires|plugin CONNECT capabilities|真实 CONNECT 经 main` **3 pass**；Core 具名 `plugin local MCP uses its private proxy|explicit SSE opens|absent and explicit HTTP` **3 pass**，未跑该文件的容量/计时 case；Schema mcp 文件 **3 pass**；server 的 FakeChild/Electron mock 文件 **52 pass**，实际未启动 Electron；两个相关 renderer 子进程宿主 **2 pass**（内部 details 14、dialog 7），official 的 `desktop SQLite package without a DSN` **1 pass**。额外合计 **167 pass**，宿主与内部子用例不双计，日志同 `/tmp/plugin-standard-r7-post-rebase-*.log`。
6. renderer dialog 宿主初次 **1 pass / 1 fail**，错误仅预期 5 而实际 7（其 7 条子用例全部绿）：alpha 新 5 条加 S4 的 typed options/version 两条。`94b7c81d1f` 只把该行精确 pass 数同步到 7，未删用例/放宽结果检查；重跑该行 **1 pass / 0 fail**（`/tmp/plugin-standard-r7-dialog-host-green.log`）。这是现有组件宿主计数同步，不改 gate 脚本/manifest/门的标准。其他片 4/3 行为没有修改。
7. rebase 原样的 `affected-tests --list` 为 **affected tests: 358 of 689 test files**（`/tmp/plugin-standard-r7-affected{,-scope}.txt`）；同步 dialog 宿主后最终为 **affected tests: 359 of 689 test files**（`/tmp/plugin-standard-r7-affected-final{,-scope}.txt`），多选的是本轮直接改变的宿主文件。下表三条旧断言所在文件在两份列表均未选中，未改它们；相对 r6 固定 origin/alpha@5c896630ab 的该文件 diff 为零。

| 原已复验失败的精确测试名 | 文件与实际断言 | 本分支 PR gate 选择 |
| --- | --- | --- |
| `runs native JSON in the background without switching the parent` | `packages/core/test/config/command-subagent.test.ts:79` 的表驱动用例，`:92` 仍期待 model=override | 否，最终 359 项列表无该文件；当前 core runner roots 只纳管 codepuppy-* 与具名 plan/mcp/oauth 文件 |
| `runs subagent mode by default in the background without switching the parent` | 同文件 `:79/:92`，仍期待 model=child | 否，同上 |
| `subagent: false overrides subagent mode and the legacy alias` | 同文件 `:112/:116`，仍期待切父会话后 model=child | 否，同上 |

r6 在临时 detached origin/alpha@5c896630ab 的具名复验为同名 **0 pass / 3 fail**，worktree 已移除；r7 不重复该基线运行、不改断言或引擎模型优先级。它们不是本次 1,043 绿集合的成员，也不把 selector 未选当作修复。

### 当前代码与 R5-ROOT 冻结接缝

**SEAM-CHANGE-NEEDED: PackageAllowSetV3 的 bundle 根活动投影。** main 唯一生产者 `packages/ui-mac/src/main/ext-receipt-v2.ts:621` 只保留 skill/mcp/command/agent，bundle 根在计算启停/项目 effect 前就被过滤。唯一共享解码/判定 `packages/ext/src/package-scope.ts:5–35` 的 scoped.kind 也只有这四种。`packages/ext/src/plugin-package-skills.ts:27–39` 的 live metadata 枚举只证明内容存在，不带活动状态；不能把 current.json 存在当已开启，不能从“某个技能仍开着”反推包根允许，更不能在 ext 另读账本建立第二开关权威。

按原派发冻结的片 2 文件及 r6“只扩 command/agent、无其他 DTO 变化”裁决，本轮尚未获得 bundle 域增量。片 5 的纯 hook 包（实际 learning-output-style、Langfuse）或无其他运行成员的监视包必须能随根开关/项目范围登记、撤销及取消。没有此值，AC-11/13/14/15/20/25/30 共享的运行条件不能正确表达；先写一个常开 runner 或伪造 skill key 都违反已定合同。

一次性 temp 探针（真实 receipt/graph 写者，非另造 provider 格式）：`bun /tmp/plugin-standard-r7-root-scope-probe.ts` exit 0；同一 bundle-only graph 分别 global enabled、global disabled、project enabled 时，三次输出逐字同为 `{v:3,keys:[],scoped:[],mcp:[]}`（`/tmp/plugin-standard-r7-root-scope-probe.json`）。另从固定 Langfuse capture 读回当前归一化条目为零，符合片 4 留给本片的 hook 解析缺口；该 probe 不声称 hook 已接通、不运行插件代码，也不读取用户账本/凭据。

**提交给编排器的最小问题/建议**：是否将既有 keys/scoped kind 的域增加 `bundle`，由同一 root/effect/claim 算法投影已启用整树根（含没有可运行子项的包），ext 以已有 bundle store key/根身份消费？建议只增这个域，保持 v3 形状、事务/写者和已有四种子项判定不变；skill/agent 的局部 hooks 再叠加实际 Invocation 活跃期。无需给每个 hook/monitor 新建账本 kind、第二注册表或公开 DTO。若设计要独立分项开关，则请给出指定的权威投影合同，不能由本车道改用 native plugin/skill 记录冒充。待该接缝裁决，以下步骤才开始实施。

### 改动（裁决后的文件边界）

| 文件 | 本片改动；不另立权威 |
| --- | --- |
| `packages/ext/src/package-scope.ts`、`packages/ui-mac/src/main/ext-receipt-v2.ts` 与原测试 | **仅待 R5-ROOT 裁决的域增量**；消费已有根/范围/effect/claim，不改账本、事务顺序或迁移 |
| `packages/ui-mac/src/shared/host-extension-package-contract/{plugin-package,model,schema,plugin-conversion}.ts`、原 decoder/envelope 与 generator/产物 | 对齐 §4.1 Hook/Monitor；在同一 parser 接 manifest/default/custom 与 skill/agent frontmatter，扩事件/作用域/prompt/exec-form，保留 source order；未知协议及五项无时机给具体诊断 |
| `packages/ui-mac/src/main/{plugin-package-install,install-from-source,package-admission}.ts`、对应已有测试 | 同整树保存声明及真实 notRunning；事件 connected 只来自已接通能力，沿既有内容/默认开启的事务返回分界，不在 install/preview 注册或执行；不新建 hook receipt kind |
| 新 `packages/ext/src/plugin-package-hooks.ts`、新 `plugin-package-process.ts`、新 `plugin-package-transcript.ts` 及各模块同名测试 | 一个 Location runner；hook/monitor 共用真实进程与取消资源表、已知秘密脱敏/OPTION/ROOT/DATA、原消息的本机 transcript 投影；不是第二会话真源、第二 shell 模板解析器或另一模型循环 |
| 新 `packages/ext/src/plugin-package-monitors.ts` 及同名测试；既有 `plugin-package-invocation.ts`、`plugin.ts` | 沿同一真实会话/skill invoke 的挂点启动相应 monitor，按行通知与停止；skill/agent scoped hooks 与现有 Invocation 生命周期同清理，包/Location 取消共用资源归属 |
| `packages/ext/src/policy/{index,gate,identity}.ts` 与原测试 | 在唯一 policy 中接 hook 的当次输入/代/服务定义绑定决定，更新输入后重判，普通 ask 与合法 allow、硬 deny、安装询问和出网约束的现有归属保持 |
| `packages/plugin/src/codepuppy-package-runtime.ts` 与原 port 测试 | 只加冻结 §6 PackageRuntimeHandlers 的既定符号及 Location/dispose，同一 bundle 槽；保留已裁决 S-01 arguments，不改公共 SessionHooks/RPC |
| `packages/core/src/config.ts`；`config/plugin/instruction.ts`、`session/instruction-state.ts`、`session/instructions.ts`；`session/compaction.ts` | 分别 S-04/05/06 的实际阶段/来源元数据/await 窄调用及既有模块测试；算法、预算、重试与项目信任仍归原引擎 |
| `packages/core/src/mcp/{index,client,connection}.ts` 及既有 `codepuppy-mcp-runtime.test.ts`/相关 MCP 测试 | S-07 的实际 elicitation/request/result 归属；stdio 共享现有连接/进程，远程仅在真正会话使用且匹配 handler 时会话化，沿原 OAuth/Form/定义权威 |
| main 现有 `codepuppy-sidecar-messages.ts`、`hub-view.ts`、`server.ts`；renderer 当前会话 leave/通知生产者及其原测试 | 只连接 S-03 已定 PackageSessionMessage/reply 与真实通知/离场动作；在释放前 await；不新增 UI、伪事件、计时器或包可调用的事件入口 |
| `docs/architecture/codepuppy-authority-registry.json`、ADR-047 及原 takeover allowlist 的具名登记；`docs/architecture/modules.md` | S-03…S-07 的批准范围/阶梯理由随对应实现同提交登记；S-08 仅 L0，不接管 runner/step.ts；只登记精确候选，不改 gate 逻辑或测试选择标准 |
| `packages/ext/src/context-injection.ts`、其 snapshot/原测试，既有 `plugin-host.test.ts` 与 pinned fixture/provenance | 登记宿主自有错误/上下文包裹文案；供应方正文不改写为宿主文案。标准样本固定归档；相关测试/真实一次性回放分别归位 |

### 顺序

1. **先裁决 R5-ROOT**，在两个唯一生产/消费文件原测试补 hook-only/global/project/off/remove 的红臂，再做最小域增量。与片 3/4 公共 helper、key/代/claim 的相关文件一次收口；不先搭建绕过允许集的运行器。
2. 共享库 Hook/Monitor 形状、解析与诊断：先用报告固定 learning-output-style/hookify/ralph-loop/code-modernization/claude-security/Langfuse、dash0/stripe/paypal/convex 原件补最低层红测，再同步同一 model/schema/strict decoders、SDK 消费和生成物。无效一项不吞其他合法项。此步只定义，不启动。
3. 先接 command hook runner、transcript、真实生命周期与源工具映射；在 policy 中完成 PreToolUse/PermissionRequest 的当次决定与 updatedInput 重判。安装内容仍不执行；启用只登记。每个阶段先具名回归，普通 ask/hard deny/下一次调用、取消晚结果均有反臂。prompt 分支接原无工具 generate、结构化结果和事件原语，不等 LSP/style。
4. 分别落 S-04 ConfigChange、S-05 InstructionsLoaded、S-06 Compact、S-07 Elicitation；每个 engine 增量与其 ADR/registry/精确登记同提交，先在原模块测试看到真实阶段和元数据再接 runner；不可取得的字段不伪造。S-08 只从 awaited context/idle 聚合实际 assistantMessageID 工具终态，不修改 engine 批次端口。
5. 同一进程归属表接 monitor 与文件 watcher、OPTION/DATA/CLAUDE_ENV_FILE；main 真实 leave/notification 通道接入 runner，取消所有会话/包资源并核对代/活跃期后再投递，保持项目共享数据归属。每个功能完成时对应行为文件完整一次，不混入容量/计时/scenario。
6. 一次性临时整树旅程覆盖 spec 列举的 command/prompt hook、dash0 扩展事件与 Convex monitor 的相关真实时机；对照臂使用原样本可观测动作证明不是空观测。SaaS、付费模型质量、外部工具链无法验证时给实际结果，不冒称完整可用。最后一次相关 import/mock/枚举消费者集、适用 package type/lint、generator、文档及 affected-tests --list；不运行 gate/全包/全项目。

### 风险

- R5-ROOT 是共同前置冻结合同缺失，阻断的是包活动归属，不是产品范围/视觉选择；不得靠子项残余状态、读 ledger 或新确认绕过。
- S-05/06 为 §10 已论证的新接管候选，只有该精确增量可登记；若读取实际阶段发现给不出冻结输入，返回对应 seam，不伪造 config/指令/compact 元数据。S-08 不升级接管，stdio 不因 handler 兴趣扩进程。
- 并发 handler 结果、updatedInput、prompt no-decision、异步回投与关闭/换代存在真实竞态；测试直接观察原执行器/模型请求/进程与会话消息，不只断言转换 JSON。批次水位从已存在历史建立，源 event identity 去重，不建持久脚本重放账本。
- command hook 的 source shell、exec argv、选项秘密及 env 的绑定必须用指定单一权威；若现成 API 不能表达 stdin/取消或正确的单词绑定，先给具体输入/最小合同缺口，不复制 shell 解释器或泄露秘密。
- 源 code-modernization 本来有 YAML 未细分错误，实样运行仅报告实际合法入口；不借机修复外部仓。五项无时机沿冻结逐项原因，其他缺失不能假称 unavailable-trigger 来减 AC。

### 证明（拟实施；不是本轮已通过）

| AC / 行为 | 具名测试/证据落点 | 层与运行时机 | 删除行为为什么会失败 |
| --- | --- | --- | --- |
| AC-11/15、13/14 hook 安装/作用域 | 原 converter/install/admission/receipt tests；`plugin-host.test.ts`：`package hooks activate after installation and stop with their package`、`global package hooks preserve project plugin trust` | fast＋integration，受影响 PR/nightly；整包从预览到移除一次性临时回放 | 安装前动作、关闭后投递、项目脚本误启动或丢 global provenance 会在真实 marker/原工具/入口处变红 |
| AC-03、11 当次决定与源 I/O | 原 `policy/register-policy.test.ts`：`hook allow binds the final call without overriding hard deny`；新 runner 模块测试 command 输出/并发；原 plugin-host 真实工具 case | fast＋integration，受影响 PR/nightly | 普通 ask 永久抹掉、updatedInput 复用旧 allow、源工具字段错误、拒绝未阻止原工具或 transcript 空壳都会失去对照 |
| AC-11 Stop/async/transcript | 新 transcript/process 模块测试真实投影/进程；plugin-host 的原 idle/synthetic 上增加具名 case；Ralph/hookify 原脚本只在临时目录一次性执行 | fast 的输出归并＋integration 的本地进程/会话；完整脚本旅程一次性 | 真实最后 assistant/工具结果丢失、异步错会话、Stop 另起循环或关闭后回投都会在真实消息/进程处失败 |
| AC-20/25 OPTION/DATA | 既有 settings/账户/安装测试继承；新 process 模块：`package processes receive typed options and stable data without publishing secrets` | integration，受影响 PR/nightly；Langfuse/claude-security 原命令只换可观察标记的一次性 probe | false/number/default 消失、秘密进公开树或日志、换代丢数据、关包误删/移除删别包可直接观察 |
| AC-22 事件与无时机 | 原 converter 新参数化 source event case；各 S-04/05/06/07 原 core 测试和 runtime port 生命周期；plugin-host 子助手/leave/file/notification case | fast＋integration，受影响 PR/nightly；dash0 真实24项副本逐时机一次性回放 | 只改枚举、重复事件、错误 source/summary/会话归属、五项伪 connected 会在字段/实际顺序/次数处失败 |
| AC-23 PostToolBatch | 新 runner/原 plugin-host：`tool batches complete once before the next model request or idle` | integration，受影响 PR/nightly；Stripe 原脚本采样必中一次性 | 并行工具漏项、失败漏批、空批次触发、context/idle 双发或首轮模型未见上下文会失败 |
| AC-24 prompt | 新 runner prompt 分支与原 policy/plugin-host：`prompt success leaves approval unchanged and refusal follows the source event` | fast＋integration，受影响 PR/nightly；PayPal 原提示/拒绝变体一次性离线受控模型旅程 | ok:true 偷发 allow、拒绝未阻止 Edit、坏 JSON 当决定、Read 不匹配仍生成模型请求会失败 |
| AC-30 monitor | 新 monitor 模块与原 plugin-host：`skill monitors send lines to their session and stop on leave or disable` | integration 的有限本地进程/事件，受影响 PR/nightly；Convex 五项原配置只换标记命令一次性 | 安装先启动、design 启 quickstart、错会话行、残余行丢失、关闭/leave 后进程/通知仍在会失败 |
| 跨 bundle/Location/取消 | 原 `codepuppy-package-runtime.test.ts` 及各 core 原模块测试；main messages 与 renderer 原动作测试 | fast＋integration，受影响 PR/nightly | 两 bundle 槽不同、Location 串用、释放前没 await 或外部声明能伪造宿主动作会失败 |

新永久测试按模块而非工单命名：新模块才新建同名测试文件；实际 imports/字面 fixture 路径使 PR selector 可追踪。完整实样、测量、scale/capacity/时机场景不加入日常 PR 集，既有场景只在 brief 指定的具名运行或 nightly。新增任何案例不改 gate manifest/runner/全局 setup；若 selected scope 意外 all tests，先处理选择原因而非跑全量。

### 偏离记录与本轮收据

r7 仅完成获授权 rebase、片 4/3 相关复验与本节计划；机械 dialog 宿主计数单独提交 94b7c81d1f。R5-ROOT 是计划核对发现的冻结域缺失，遵照 r7“未定设计问题则 PLAN-READY”停点，不将未实现的片 5 写成通过，不扩大到后续片。没有修改片 2 生产者/解码、engine、gate、其他仓；未运行插件源码/真实凭据/付费服务来绕过接缝。

已核：Codex（GPT-6）；rebase 后实际基线 1db6a3bbf5、片 4/3 原已定合同及 spec v5/design v3.1＋r5/r6 裁决；片 4/3 复验通过，本片 PLAN-READY / R5-ROOT 待编排裁决。遗留去向：bundle allow-set 域 fix now 交编排器；三条旧模型断言不改、由编排器处理；其余真实 SaaS/工具链与外仓 pin 继承既有集成验收。OPTIONAL：无。


r7 收口静态证据（2026-11-26 18:56，约 14 分钟）：UI/Ext 包内 bun typecheck 均 exit 0（`/tmp/plugin-standard-r7-typecheck-{ui,ext}.log`）；plan 8 条相对链接通过，git diff --check exit 0。单仓 docs-contract（changed-since=origin/alpha）为 71 errors / 250 warnings，71 errors 仍属接受的基线，未修两条旧 unknown-id，也未拓展治理（`/tmp/plugin-standard-r7-docs.json`）。本片计划范围外只改已说明的精确计数一行；无 S5 生产代码、gate/selector 改动、push/PR/merge。hooksPath=.githooks，所有本车道前台命令均结束。


r8 orchestrator ruling 2026-11-27（Claude Opus 5.5）：接受 R5-ROOT，bundle 与 r6 command/agent 同属允许集域扩展；同原 root/effect/claim 算法，无新字段、UI 行或事务合同。设计 §10 镜像由编排器处理。新红测先独立提交，global enabled/disabled/project-enabled 与 scoped 解码两文件各 0 pass / 1 fail；原有精确 keys/scoped 断言随新根成员同步，旧“非投影”样本改用 cloud，不放宽比较。

### r8 已完成边界与 S-01 绑定接缝（2026-11-26）

r8 从 18:58（UTC+08:00）继续 IMPLEMENT。R5-ROOT 已由 0d7703948c 红测、eae36414a9 实现并登记，`a bundle-only package projects enabled disabled and project-enabled root membership` 与 `bundle root membership decodes without enabling its same-named instructions` 覆盖 global enabled、disabled、project-enabled 及 kind 隔离。原 receipt 文件 71 pass、scope 文件 40 pass。安装消费者两条旧精确 scoped 断言补上 bundle 根，原项目目录和 MCP 全局 disabled 断言保留。

共享转换步骤由 cb77b1f354 的真实声明红测（0 pass / 1 fail）推进：command/prompt union、exec argv、package/skill/agent scope、事件名、源顺序、五项无时机原因、monitor 的 always/skill 触发进入同一严格模型/schema。4761803747 的 Convex 双 manifest 受控变体先红（预期 6，实际 5），修正后保留次要来源独有项、同名主来源覆盖。pure `plugin-hook-events.ts` 为事件元数据唯一来源，生成 artifact 由 19 增至 20 文件；renderer 只复用现有 notRunning 展示逐项原因，没有 bundle 行或新交互。此步不报 connected、不启动 hook/monitor。

**SEAM-CHANGE-NEEDED: S-01 的安全 shell command 绑定结果。** 当前冻结 `PreparedInstruction` 仅含 parts/syntax/rawArguments/arguments/cwd，renderer 返回指令字符串（`packages/plugin/src/codepuppy-package-runtime.ts:5`）。core 的同一 renderer 在 `config/plugin/command.ts:260` 仅对静态 shell 节点引用 boundValue；普通文本直接插入。`:287–292` 的 shell 节点则立即调用 AppProcess.run，并固定 stdin=ignore，返回 stdout，不给 ext 安全绑定后的待执行 command。D13 的 hook stdin、timeout、取消与 monitor 流式归属不能由这个返回值表达；不能复制 quote/parser 到 ext、先执行再包装或把绑定值当 source。

一次性 core 探针在原 command 测试中运行后已恢复（`/tmp/plugin-standard-r8-shell-port-probe.log`，1 pass / 2 assertions）：source `printf '<%s>' ` 加 boundValue `two words; $(printf SHOULD_STAY_DATA)` 以 literal 渲染时返回未引用命令字符串；静态 Claude shell 节点则安全执行，返回 `<two words; $(printf SHOULD_STAY_DATA)>`。这只执行本车道 printf，不运行外部插件/凭据。现有 AppProcess 已有 stdin、AbortSignal、timeout 和进程组清理，不缺另一套 OS 执行器；缺口只在 source/value 安全绑定与当前 ShellSelect 的结果交接。

提交给编排器的最小增量：让 core 同一 renderer 提供**仅绑定、不执行**的 shell command 目标，输入保留原 source/boundValue 节点，输出当前 shell 的 executable/argv；ext 再消费现有 AppProcess 的 stdin/env/timeout/cancel/stream。请裁定该 typed target/反向端口的精确合同并登记 S-01 增量；本轮没有自行增加冻结签名或 engine takeover。该共同边界阻断第 3–5 步进程及运行接线，不能把转换通过视作整片 DONE。

实样一次性 artifact 检查：`bun /tmp/plugin-standard-r8-contract-probe.ts` exit 0，以下十包的 normalized description 同时通过 `validPluginPackage` 与现有 Ajv2020 profile schema；只检查归一化，不执行样本源码。完整捕获来自兼容报告固定 commit，新增八包及 Langfuse 完整树字节/模式记入同一 provenance/archive；此前 Langfuse fixture 只有入口控制文件，本轮扩到同 commit 的 67 文件。

| 实样 | 归一化 hooks / monitors | 运行结论 |
| --- | --- | --- |
| learning-output-style | 1 / 0 | 未接 runtime |
| hookify | 4 / 0 | 未接 runtime |
| ralph-loop | 1 / 0 | Stop 循环未执行 |
| code-modernization | 6 / 0 | 原 commands/modernize.md 无效 YAML、Claude UI modules 各保留诊断 |
| claude-security | 9 / 0（含 skill scope 1） | Claude UI modules 诊断；hook 未执行 |
| Langfuse | 2 / 0 | Stop/SessionEnd 未执行 |
| dash0 | 24 / 0 | 五项 unavailable-trigger 有具体原因，其余尚未接时机 |
| Stripe | 7 / 0 | exec argv/PostToolBatch 未运行 |
| PayPal | 1 prompt / 0 | 拒绝决定未运行 |
| Convex | 4 / 5 | design 2、quickstart 3，仅保留触发声明 |

AC 证据范围：AC-11/15 的解析与包作用域、AC-22 的解析/五项原因、AC-23 的 exec 声明、AC-24 prompt 声明、AC-30 monitor 声明已具名测试；这些 AC 的运行行为与 AC-03/13/14/20/25 的进程行为均未完成。继承片 3/4 的 accepted 收据，不重复声称其运行证据覆盖 hooks。

当前相关文件绿集合：UI 四个 converter/artifact/envelope/presentation 文件 164 pass（`/tmp/plugin-standard-r8-conversion-final-2.log`）；main 八个具名相关文件 229 pass（原 related-ui 227 pass/2 fail 的 install 文件经精确 bundle 同步后完整 45 pass，未重跑其余未改七文件）；Ext scope/host/registry/transforms 四文件 129 pass（`/tmp/plugin-standard-r8-related-ext.log`），合计 **522 pass / 0 fail**，不累加重跑。UI 包内 `bun typecheck` exit 0；converter/artifact --check 均 exit 0（20 files）。未运行全包/全层、bin/check、gate run 或 timing/scale。

同链文件偏离：计划的 model.ts/schema.ts 实际权威为现有 `plugin-package.ts`/profile JSON；新增纯事件模块随唯一 generator 清单发布。`shared/plugin-install.ts` 的原因域与 `package-admission.ts` 共享类型、renderer/i18n 及现有 presentation test 为同一诊断输出必要消费者；install-from-source.test.ts 为 bundle 新行为精确同步。没有新依赖/配置/公开 DTO 字段。剩余 runtime 模块没有先造空壳。

遗留去向：`packages/codepuppy-contracts-consumer/src/extension-package-artifact.test.ts:120` 的 live host ↔ alpha-web 已发布副本一致性为 **6 pass / 1 fail**（`/tmp/plugin-standard-r8-consumer.log`）；r7 accepted artifact 文件 SHA256=2be185a9426e76cb0ed52172ee2c59d9ed0875fdaca2f2ed3ba637a70b2afc9c，vendor 文件 SHA256=2d3b783ece9c7d59c465b2108b80202aea78941aa1ec21f75e894a61ef218a97，r8 前已不相同。交编排器已指定 alpha-web 发布/re-vendor，保留断言/真实 pin，不在本仓伪造外仓发布物。三条 core 旧断言与 docs 基线继承，不重新调查。已核 Codex（GPT-6）；OPTIONAL 无。

本次共享转换提交前：单仓 docs-contract（实际 worktree，changed-since=origin/alpha）71 errors / 250 warnings，与 r7 相同；两条已接受 plan unknown-id 未改。日志 `/tmp/plugin-standard-r8-docs-final.json`。git diff --check exit 0；所有生成物检查与 UI typecheck 通过。

r8 最终收口（19:26 UTC+08:00，约 28 分钟，未达原 8–12 小时预期的两倍线）：产品/合同安全子集提交 `de3b8e9558`；所有前台命令结束，只 commit。实际本轮为投影＋共享转换边界，非生成生产文件约 10 个，未扩大到 engine 运行接线。

- 删除反臂 `/tmp/plugin-standard-r8-removal-results.jsonl`：bundle producer、bundle decoder、command type、prompt handler、exec args、skill scope、source order、monitor entries、unavailable diagnostic、五项具体 UI 原因、双 manifest monitor union，共 **11 项**各具名 **0 pass / 1 fail**。每次仅移除对应生产行为，运行同名 case，随后 scoped git restore；恢复字节与原提交逐字相同。未用生成物 drift 代替业务失败，未重复此前片 3/4 的反臂。
- 最终相关绿集合 **522 pass**，另跨仓消费者 **6 pass / 1 个既有 pin fail**；没有将一次性 core 1 pass 或十包 schema probe 重复计入。三态 bundle 的先红证据继承 0d7703948c，修正与唯一 registry 登记同在 eae36414a9。共享 hook/monitor 声明先红证据为 cb77b1f354，双 manifest 先红为 4761803747。
- UI/Ext 包内 bun typecheck 均 exit 0；最终 converter --check 和 artifact --check（20 files）均 exit 0；恢复后的 git diff --exit-code 为 0，plan 相对链接 8 pass，hooksPath=.githooks。文档保持 71 errors / 250 warnings 基线，两条已接受 unknown-id 原样。
- `affected-tests --list` exit 0，**affected tests: 359 of 689 test files**（`/tmp/plugin-standard-r8-affected{,-scope}.txt`）；未扩大每 PR 的全局集、未动 `.gate-tests`。三条旧模型断言所在 command-subagent.test.ts 仍未选择，未修改/复跑。
- 已核 Codex（GPT-6）。结论 **SEAM-CHANGE-NEEDED / 片 5 部分完成**；下一输入为上述 core 单一绑定权威的 shell command 目标合同。没有把运行 AC 标完成。遗留去向：S-01 补口 fix now 交编排器；外仓发布/re-vendor 与旧断言/docs 基线交原归属；真实 SaaS/工具链维持 integration acceptance。无新增 ARCH 或 OPTIONAL 项。


## r9 · 片 4/3 审查修正与片 5 补口

核对：IMPLEMENT (review fixes)，编排器 / Claude Opus 5.5 r9，spec v5 / design v3.1 @f313990 及本轮明确裁决。按 B1/B2/B5 → S-01 bind-only → 片 5 runtime → 其余 A/B 的指定顺序；保留片 5 既有提交，外仓 pin/vendor 不改。本轮起于 2026-11-26 19:28 UTC+08:00；未指定完整 gate，只有相关文件与 A1 engine case 的 gate slot。

B1：2f43972024 独立回归先红（包内 `bun test --max-concurrency 2 test/codepuppy-command-model-priority.test.ts -t "fenced shell"`，0 pass / 2 fail，`/tmp/plugin-standard-r9-B1-red.log`）。真实 Ralph fenced 语法仅将 setup 命令换为可观测 printf；生产执行与项目插值闸门共用 source-before-values 识别器。未信任源文本原样保留、view 记录 command-run；绑定值中的 fence 不成为源码。现有 S-01 registry 同提交记增量；gate-files 5 的旧计数同步实际文件到 10（原本 8＋新增 2），不改标准/选择器。两条均 integration、现有 imports 可追踪，受影响 PR/nightly。

B1 完成：完整行为文件 10 pass / 0 fail（`/tmp/plugin-standard-r9-B1-green-final.log`）。初次修正后负臂因通用测试 host 默认 /workspace 与 Location.Service 不一致而仍红；e4d521cc4e 仅修装配为实际 Location，原产品基线复验仍 0 pass / 2 fail（`/tmp/plugin-standard-r9-B1-red-correct-location.log`），未修改断言/产品规避。生产 recognizer 接回后全文件绿。

B2：orchestrator review ruling r9（Claude Opus 5.5，2026-11-27）明确 shell `$ARGUMENTS`/原生 trailing rest 按 argv 逐项传递，替代旧整串一个 shell word 的该项语义；正文 raw 文本不变。4639eea822 独立回归先红 0 pass / 1 fail（`/tmp/plugin-standard-r9-B2-red.log`），生产修正后完整文件 11 pass / 0 fail（`/tmp/plugin-standard-r9-B2-green.log`）。本地 shell/真实 AppProcess 的 integration case，imports 可追踪，PR 仅受影响时运行；原 registry 和 gate-files 精确条数同提交同步到 11。下一步按 r9 B5 将所有绑定值传入每次调用独立环境引用，避免在复杂 shell 语法中用文字转义。

B5：7749386aed 独立回归先红 0 pass / 1 fail（`/tmp/plugin-standard-r9-B5-red.log`），实际输出含注入 printf 的 INJECTED，覆盖 nested command substitution、unquoted heredoc 与有空白/glob 的值。core 同一绑定函数改为每次随机独立 env slots；命令文本只有引用，原始值不经文字转义或二次识别。原静态源码仍决定 quote/command-substitution/heredoc 上下文；未信任项目仅做文本参数替换，不输出不可解析的私有 env 引用。修正后完整文件 12 pass / 0 fail（`/tmp/plugin-standard-r9-B5-green.log`），原参数/模型优先级断言全保留。现有 S-01 registry 与 gate-files 同提交同步到 12，无新增依赖/接管文件。此回归为有限本地进程 integration、受影响 PR/nightly。

S-01 补口：orchestrator ruling r9（Claude Opus 5.5，2026-11-27）接受原 r8 接缝，core 注册同一 Location renderer 的 bind-only shell target；输入为 source/boundValue parts，输出 executable/argv/env，不执行。ada9b9f7be 独立红测 core/port 各 0 pass / 1 fail（`/tmp/plugin-standard-r9-S01{,-port}-red.log`）；原 renderer 注册者和两个端口在同一槽释放，ext 不复制绑定器。新 reverse API `bindPackageShellCommand` 只交接当前 shell 的绑定结果，由原 AppProcess 保持 stdin/超时/取消/streams/围栏归属。既有 S-01 registry 同提交记录决定和具名 proof；gate-files 精确 core 条数 13，port 原单用例合并验证生命周期，不增重复 runtime build。r8 共同接缝关闭，下一步实施片 5 运行消费者。

S-01 补口完成：core 原行为文件 **13 pass / 0 fail**、plugin 端口原文件 **1 pass / 0 fail**（`/tmp/plugin-standard-r9-S01{,-port}-green.log`）；真实 marker 在 bind 后不存在、由 AppProcess 执行后才出现，带注入语法/空格的值逐字返回。core `bun typecheck` 修正测试路径为既有 AbsolutePath brand 后 exit 0（2,059 files，`/tmp/plugin-standard-r9-core-types-final.log`），plugin `bun typecheck` exit 0（326 files，`/tmp/plugin-standard-r9-plugin-types.log`）。这不是进程/handler 运行 AC 完成，仅关闭 r8 的 binding 边界。

### r9 片 5 进程与会话阶段增量

片 5 本轮只推进到可运行的基础边界，**不是整片 DONE**。bc85b46202 的新 process 模块回归先红 0 pass / 2 fail；75fd305188 的真实 SessionStart 旅程先红 0 pass / 1 fail（`/tmp/plugin-standard-r9-{process,hook-start}-red.log`）。`plugin-package-process.ts` 使用原 AppProcess 的 stdin/timeout/signal/stream，exec argv 与 shell source 分开，后者只调用 S-01。OPTION/default/secret/DATA 抽到现有 `plugin-mcp-config.ts` 的唯一 process config，MCP 保留原绑定路径和远程项不导出无关环境的行为，没有复制一套选项解析。敏感 argv 使用原 Redacted，控制 JSON 在私有端解码后才脱敏文字/日志，monitor 行与 stderr 仍脱敏；56bc2a2180 的真实 learning JSON 反例先红 0 pass / 1 fail（secret 恰为 SessionStart 时原输出错误地改坏 hookEventName，`/tmp/plugin-standard-r9-process-control-red.log`）。

`plugin-package-hooks.ts` 作为 L0 消费者接到真实 awaited prompt/context，当前支持 package scope 的 command SessionStart/UserPromptSubmit；不在安装或启用时启动。真实会话历史投影到 0700 目录/0600 JSONL，包根/项目作用域仍读唯一允许集；进程、上下文与当前 tree/settings/会话 lease 绑定，关闭/换代/配置变化收回旧资源，异步回投也检查 lease。源 matcher/if 复用工具规则 parser；source order 在各阶段内保持，SessionStart 的贡献先于 UserPromptSubmit。这里只证明本节明确列举的行为，不将其余 hook 阶段、agent/skill 作用域、prompt handler、权限决定、Stop/StopFailure、监视触发/通知、扩展事件或 S-04…07 标完成。

实际 Source readiness 由新增私有 `shared/plugin-package-runtime.ts` 单点投影，两个安装入口与运行端共用；仅已接通的上述阶段不再标 kind-not-supported-yet。bundle 仍无组件行，其他事件/monitor 保留具体未运行注释。install-from-source 的既有 R12 精确 hook 断言按此已定 D4 行为改为 connected；保留 graph/record 数与其他断言。context callback 精确计数 5→6，仍验证共用 assembler 恰一次；wrapper 与库存由原 generator 同步，不改预算/分类/门。gate-files 仅将实际改变文件的已有计数同步为 core 13、plugin-host 66、context-injection 45。

必要同链文件：共享 process config 是 MCP 与新进程共同的配置权威；私有 readiness 列表保证主进程注释与实际消费者一致；CONTRACT/modules 记录真实支持边界。`plugin-setup-order.cases.ts` 的事件 mock 原来永远不结束且忽略 signal，新增 await 清理后宿主 1 fail / 子例超时（`/tmp/plugin-standard-r9-ext-wider.log`）。2c704aeeba 只让 mock 遵守原 AbortSignal 合同，不改断言/延长 timeout；原宿主完整 1 pass（内部 2 pass），`/tmp/plugin-standard-r9-setup-green.log`。没有新增 engine takeover；S-01 增量已在 507735a2f6 同提交登记。

S-01 实际类型补口供设计镜像：PreparedShellCommand 只取 PreparedInstruction.parts；BoundShellCommand 为 `{executable:string, argv:readonly string[], env:Record<string,string>}`；`bindPackageShellCommand(location,input)` 返回该结果。原 registerPackageInstructionRenderer 增加必需的第三个 bind 回调，与 instruction 回调共享同一 Location 槽及释放。没有旧版兼容分支/执行器副本。

一次性实际样本（测试临时追加到既有 plugin-host 文件，运行后 scoped git restore，未加入套件）：包内 `bun test --max-concurrency 2 src/plugin-host.test.ts -t "temporary real sample probe"` **2 pass / 0 fail / 11 assertions**，`/tmp/plugin-standard-r9-real-probes.log`。Hookify 保留原脚本，仅以 observer exec wrapper 捕获实际 stdin 与 JSONL；第二次提交含正确 session_id/cwd/prompt，转录含真实首轮 user/assistant 及父 UUID，文件/目录 0600/0700，原 Python 脚本 exit 0。Ralph 使用原 command 的 fenced setup，直接由共享 renderer 执行原 setup-ralph-loop.sh，临时项目 state 含 max_iterations=2、DONE 与 literal test prompt；没有借模型再调用 Bash 来掩盖 B1。

| 实样 | 本轮实际执行 | 未完成/未验证 |
| --- | --- | --- |
| learning-output-style | 原 SessionStart script → 首个模型请求；bundle 关闭后的新会话无该贡献，永久旅程通过 | 其余无独立事件 |
| hookify | 原 UserPromptSubmit Python，真实 stdin/transcript，exit 0 | Pre/PostToolUse、Stop 尚未接线 |
| ralph-loop | 原 fenced command setup 写真实 state | Stop 循环尚未接线 |
| code-modernization / claude-security / Langfuse / dash0 / Stripe / PayPal / Convex | 继承 r8 声明/整树证据 | 本轮未做完整 runtime 旅程；不能称完整可用 |

截至本增量的相关文件集合 **407 pass / 0 fail**，重跑不累加：

- Core：原 changed behaviour 文件 13 pass，加 `bun test --max-concurrency 2 test/config/command.test.ts test/command.test.ts` 35 pass；Plugin 原 port 文件 1 pass。日志 `/tmp/plugin-standard-r9-{S01-green,core-wider,S01-port-green}.log`。
- Ext：`bun test --max-concurrency 2 src/plugin-host.test.ts src/plugin-package-process.test.ts src/context-injection.test.ts` **114 pass**（`/tmp/plugin-standard-r9-hooks-files-complete.log`）；registry 文件 5 pass（wider 原输出中的同一文件），setup 宿主修夹具后 1 pass，内部子例不双计。
- UI：install-from-source 文件 45 pass（`/tmp/plugin-standard-r9-install-green.log`）；一次较宽集合七文件 **193 pass**（`/tmp/plugin-standard-r9-ui-wider.log`）：converter/artifact/envelope、package-mcp-activation、connector-credential-read、plugin-package-accounts、package-admission。未把此前重复的 30 条再累加。
- core/plugin/ui-mac/ext 包内 bun typecheck 均 exit 0；最后 UI/Ext 为 `/tmp/plugin-standard-r9-{ui,ext}-types-complete.log`。根无测试，未跑整包/整层、bin/check/gate run、容量或测量。两项实样 probe 不计入 407。

### r9 未完成范围（交接，不作为通过）

B1/B2/B5 与 S-01 bind-only 已完成；片 5 尚需完成并给证据：调用/工具事件与 scoped hooks、PreToolUse/PermissionRequest 当次 allow/updatedInput、Post/Failure/Stop 与 async/rewake 完整旅程、prompt handler、monitor 的实际触发/通知和生命期、FileChanged/CLAUDE_ENV_FILE、真实 leave/notification、ConfigChange/InstructionsLoaded/Compact/Elicitation 及 PostToolBatch。基础层中已写的相关分支不等于这些 AC 通过。

按 r9 指定顺序，其余 A1–A9（包括 A9 的四项）及 B3/B4/B6/B7/B8 **尚未实施**，没有为它们写或运行红测；A1 的 engine case / gate slot 未执行，不声称冷启动已修复。下一步继续片 5 运行链，再执行这些已接受修正；无需重新裁决 S-01。外仓 consumer pin/vendor 完全未改，交编排器统一 checkpoint；三条 core 旧模型断言未改/未复跑。已核 Codex（GPT-6）；无新增设计决定或 OPTIONAL。

### r9 部分交付收口

本轮产品增量为 `02ea03cbce`；独立红测与 B1/B2/B5、S-01 的修正提交见上文。到 2026-11-26 20:44 UTC+08:00 约 76 分钟，r9 实际 27 个文件、983 additions / 102 deletions（含测试、生成物与本文），保留 r8 所有提交。按本轮执行预算返回 **PARTIAL**，不把尚未接线的运行 AC 或审计项记作完成；没有新的待裁决设计问题。

删除反臂 `/tmp/plugin-standard-r9-removal-results.json` 共 **8 项**各具名 **0 pass / 1 fail**：B1 fenced recognizer、B2 argv 列表、B5 shell env 引用、S-01 不执行、SessionStart 注册、bundle 关闭、process options env、私有 control JSON。分别只移除对应生产行为，运行上文已有同名 case；每次 scoped git restore，恢复字节与提交逐字相同。失败均为行为断言，非类型错误/生成物漂移。没有重跑旧片 3/4 或 r8 的反臂，也没有通过取消失效造成无限进程。恢复后 `git diff --exit-code` exit 0；相关绿集合保持 407 pass、一次性实样 2 pass，不累加反臂或重复运行。

本轮改变的测试文件（相对 r8 receipt `2164b0ecd1`）为：`packages/core/test/codepuppy-command-model-priority.test.ts`；`packages/ext/src/context-injection.test.ts`、`plugin-host.test.ts`、`plugin-package-process.test.ts`、`plugin-setup-order.cases.ts`；`packages/plugin/test/codepuppy-package-runtime.test.ts`；`packages/ui-mac/src/main/install-from-source.test.ts`。新增 process 测试是其新模块的原位测试文件，imports 可追踪；其余均在既有文件，setup 子例仍由原宿主选择。

`affected-tests --list` exit 0 的实际 scope line 是 **all tests: scripts/gate-files.tsv changed (gate or declared global input)**，列出 **678 个 PR 测试文件**（`/tmp/plugin-standard-r9-affected{,-scope}.txt`）。原因是 r9 获准同步的条数所在文件被既有 gate 声明为 global input；没有更改选择器/全局声明，也没有按此清单运行全套。原三条旧断言所在 `packages/core/test/config/command-subagent.test.ts` 仍未选中。此处不沿用 r8 的 359/689。

最终 converter --check 与 artifact --check（20 files）均 exit 0；单仓 docs-contract 仍 **71 errors / 250 warnings**（`/tmp/plugin-standard-r9-docs.json`），含两条已接受 plan unknown-id，未修基线。本文相对链接检查 8 pass；core/plugin/ext/ui-mac 包内 typecheck 均 exit 0，证据如上。A1 的指定 engine slot **NOT RUN**，该 Blocker 尚待修复。

交编排器统一 alpha-web checkpoint 的 host aggregate：**62fa9200debfe9248898c880aeb6e9f71f7ed12fab72e41a0e85504c45c5f79f**。相对新基座 `1db6a3bbf5`，artifact 成员改变恰为以下 9 项（共同前缀 `packages/ui-mac/src/shared/host-extension-package-contract/`）：

- CONTRACT.md
- generate-artifact.ts
- plugin-conversion.d.mts
- plugin-conversion.mjs
- plugin-hook-events.ts
- plugin-package.ts
- profiles/plugin-package.v1.schema.json
- testvectors/decoder-corpus.v1.json
- testvectors/plugin-package-description.v1.json

同目录 `host-extension-package-artifact.v1.json` 清单也改变；`plugin-conversion.ts` 是生成源而非 artifact 成员。精确清单及 aggregate 另见 `/tmp/plugin-standard-r9-host-artifact.json`。未修改 consumer pin 或 vendored copies。遗留去向：片 5 运行链及上述 A/B 修正继续本车道 fix now；alpha-web checkpoint 交编排器；旧断言/docs 基线维持原归属。已核 Codex（GPT-6），本轮 PARTIAL；已定 binding/allow-set/SSE 不重开，OPTIONAL 无。


## r10 · 审查修正续作

核对：IMPLEMENT，编排器 / Claude Opus 5.5 r10；spec v5 / design v3.1 @f313990 与 r9 已定裁决。2026-11-26 20:47 UTC+08:00 起，顺序 A1 → A2–A9 → B3/B4/B6/B7/B8 → 片 5 剩余运行验收；不重开已定 S-01/allow-set/SSE，不改 pin/vendor。本轮文档影响为运行证据，落同一 plan。

A1 ready 调度：41790bff15 单独回归先红（包内 `bun test --max-concurrency 2 src/main/reload-coordinator.test.ts -t "each ready engine"`，0 pass / 1 fail，`/tmp/plugin-standard-r10-A1-ready-red.log`）。沿现有 applyPackageMcp 入口在每次 attach 请求最终账本投影的重新绑定，不创建 reload generation、不重载 Location、不增加另一绑定器；启动 projection 仍待指定 engine case 验证后修正。纯调度 fast case 在原文件、imports 可追踪，受影响 PR/nightly；原文件完整 12 pass / 0 fail（`/tmp/plugin-standard-r10-A1-ready-green.log`）；该文件不在 gate-files 精确条数表，未增加条数登记。A1 engine 用例已通过 `gate slot --` 排队，未绕过共享 engine 槽。


A1 启动投影：真实 engine 红测（`gate slot -- bun test --max-concurrency 2 --timeout 180000 ./src/main/package-hub-lifecycle.engine.cases.ts -t "cold engine generations"`）0 pass / 1 fail，ready 前预期 disabled、实际 pending（`/tmp/plugin-standard-r10-A1-engine-red-boundary.log`）。命令初次漏 `./` 未进入 cases，随后夹具缺 server 发布的 DATA 根而停在安装，均不计为产品红测；夹具补同一发布函数后才得到上述行为红。真实固定 Grafana userConfig/环境声明只替换 Docker 为临时树 echo，原私有设置经真实 IPC 保存，主进程新协调器没有 install/reload 在途。

main 的启动注入只对 pluginTree 所属 MCP 放原中和条目；ext 保留这种关闭，同时保留 main 后续 bound override 的 enabled 状态，不挡原连接器重连。ready 与成功重载继续用原 convergence，运行配置绑定不写回磁盘模板。此修正未增加 engine takeover/公开 DTO。必要同链 `engine-cases.test.ts` 的宿主精确条数 7→8、modules 当前运行边界同提交更新；engine case 的字面路径由原宿主选择，未扩大每 PR 全局声明。下一步完整 engine 文件经同一 gate slot 收口。


A1 完整 engine 文件初次为 6 pass / 2 fail（`/tmp/plugin-standard-r10-A1-engine-green.log`）：新冷启动回归通过，两个原非插件包换代用例失败（随后 r9 基线复验也复现，不能归因于本轮 ready 动作）。ready 的授权对象是 pluginTree，故现有 callback 增加私有 phase 域（engine-ready/reload），前者只选 pluginTree、后者仍按原 items/全包语义；不改变状态 writer 或公开协议。该同链 `ext-ipc.ts` 的选图条件是必要消费者，未给非插件包新增冷启动动作。


A2：4defc86a9f 的原位回归先红 0 pass / 1 fail（`bun test --max-concurrency 2 src/shared/host-extension-package-contract/plugin-conversion.test.ts -t "real skill bodies retain"`，`/tmp/plugin-standard-r10-A2-red.log`）。固定 build-ios-apps 的原 ios-ettrace-performance / ios-memgraph-leaks SKILL.md 逐字比对，仅包路径可绑定；`${RUN_DIR:-}`、`${TMPDIR:-/tmp}` 与普通环境引用保留源文字，环境已设置也不注入正文。现有 pluginText 增加 process/instruction 的域参数，所有指令正文与 prompt handler 选择后者，进程字段的环境算法不改；同一 parser/renderer 仍唯一。完整 converter 文件 41 pass / 0 fail（`/tmp/plugin-standard-r10-A2-green.log`），fast、原位 imports 可追踪；条数表旧 31 同步实际 41。CONTRACT 与生成 converter/artifact 同提交；没有新运行选项、公开模型字段、依赖或 engine takeover。


A3：9f4c0cdbed 的真实私有代理＋MCP SDK 回归先红（0 pass / 1 fail，实际 ConnectError HTTP 502；`/tmp/plugin-standard-r10-A3-red.log`）；同提交的原 schema 前缀回归先红 0 pass / 1 fail（`/tmp/plugin-standard-r10-A3-prefix-red.log`）。代理按原 dialFailureStatus/denialBody 与 withFailureCode 输出具名 TCP 拒连，core 原 client 在已接管边界读取该已登记前缀、保留安全固定说明；唯一网络分类器先保留网络层再作 HTTP fallback，renderer 三个既有失败显示点消费同一说明。没有新增失败码、权限来源、网络放行或 DTO；真实 HTTP 502 不变成本机服务失败。

A3 迭代纠正：未提交的 util→schema 导入试改违反实际包依赖，已完全恢复 util 文件，解析留在已有 core client；没有加依赖或相对路径绕过。e4f1576a55 仅将测试类型 guard 从错误的缩写 tag 改为真实 exported ConnectError 类，原行为断言不改。该试改期间排队的 A1 完整回归进入槽而被 import 失败中断（`/tmp/plugin-standard-r10-A1-engine-green-final.log`），不计为产品/基线失败；提交后重跑，不再边排队边改其生产依赖。

A3 最终相关私有代理三例（`bun test --max-concurrency 2 src/main/network-egress-proxy.test.ts -t "plugin loopback|plugin CONNECT"`）3 pass / 0 fail，`/tmp/plugin-standard-r10-A3-green-complete.log`；原 schema 文件 21 pass / 0 fail，`/tmp/plugin-standard-r10-A3-prefix-green.log`。代理文件既有容量/计时场景不在本轮授权，不运行；新增用例位于原文件，imports 可追踪，有限本地 SDK integration。必要同链文件是 schema 的唯一原因解释、core client/既有 startup helper、renderer 现有原因函数和三个调用点以及双语文案；client takeover 增量与具名证据在原 plugin-mcp-transport registry 同提交登记，未新增 takeover 文件。gate-files 旧 24 同步实际 27。


### r10 部分交付收口

截至产品提交 `11e8383c82`，A1/A2/A3 已修正，未开始 A4–A9、B3/B4/B6/B7/B8 或片 5 剩余运行接线；本轮按执行预算返回 **PARTIAL**，没有新增待裁决设计问题。起于 20:47，收口约 21:35 UTC+08:00（约 48 分钟）。后续继续 r10 指定顺序，不将 r9 基础 hook/monitor 层当完整运行验收。

A1 的具名 engine 正向与移除验证均实际经过同一共享槽：`gate slot -- python3 /tmp/plugin-standard-r10-removal.py` exit 0，其中包内 `bun test --max-concurrency 2 --timeout 180000 ./src/main/package-hub-lifecycle.engine.cases.ts -t "cold engine generations"` **1 pass / 0 fail**（`/tmp/plugin-standard-r10-A1-named-green.log`）。8 个移除反臂各 **0 pass / 1 fail**：ready 绑定、main 启动中和、ext 保持关闭、正文不展开环境、代理 dial prefix、schema prefix、网络层优先级、本机服务文案。日志 `/tmp/plugin-standard-r10-removal.log`、结构化清单 `/tmp/plugin-standard-r10-removal-results.json`；每臂只改具名生产行为，scoped git restore 后字节与提交一致，未以生成物 drift 代替业务失败。

完整 engine 文件当前 **6 pass / 2 fail**（`/tmp/plugin-standard-r10-A1-engine-complete.log`）。按 delivery-ship Gate failure 规则做唯一一次 r9 基线复验：把本轮自己改变的文件临时置回 `1a6c7e1ac4` 原字节，在 gate slot 跑原文件，**5 pass / 同 2 fail**，最后恢复并验证当前全部字节一致（`/tmp/plugin-standard-r10-A1-r9-baseline.log`，`/tmp/plugin-standard-r10-A1-baseline.py`）。这证明两项早于 r10，**不声称 origin/alpha 也失败，不声称 flaky**：

- `packages/ui-mac/src/main/package-hub-lifecycle.engine.cases.ts:481` — `removing a package whose remote connector is in the engine launch config leaves no live connector`，`removal reload reported` 未到达；r9 基线对应 :479。
- `packages/ui-mac/src/main/package-hub-lifecycle.engine.cases.ts:498` — `cloud-only package switch withdraws and restores real engine tools`，`enabled cloud package connected` 未到达；r9 基线对应 :496。

上述两个观察转本 #1776 片 5 运行链继续处理（fix now），没有改断言、等待期限或全仓调查。A1 新回归在两次完整当前运行及独立具名运行均通过，正向与三条必要移除臂已闭合；先前把两项失败与全包 ready 动作关联的假设已被基线证据否定。phase 仍只表达本轮授权的 pluginTree ready 域，普通 reload 保留原语义。

最终当前相关集合共 **380 pass / 2 个上述 r9 基线 fail**（17 个测试文件，重复运行不累加）：

- 较宽集合 **307 pass**：`/tmp/plugin-standard-r10-related-results.json` 中逐项命令；UI 的 injection 28、reload 12、activation 2、wiring 4、server-derivation 6、FakeChild server 52、artifact 11、envelope 106；Ext host 66、registry 5；Core `test/mcp.test.ts -t "query fallback|codemode"` 11、原 runtime 文件四个缺依赖/401/503/本地 stderr 原因与脱敏用例 4。没有运行 runtime 文件的容量、重试测量或计时场景。
- Converter 41（A2）、Schema 原网络原因文件 21、私有代理相关三例 3（A3）、i18n 的键集合/缺值 fallback 两例 2（`/tmp/plugin-standard-r10-locales.log`），加 engine 当前 6；A1 单独 1 pass 与 ready 初次 12 pass 不重复计入。
- 较宽 wiring 初次在 Electron 包的路径解析触发 binary 下载而未进入任何 case，有界结束本车道的 Bun（exit -15，`/tmp/plugin-standard-r10-related-ui-3.log`）。`bin/setup` exit 0，frozen-lockfile 检查 2173 installs/no changes，二进制与 addon 就绪；只复验同一文件 **4 pass / 0 fail**（`/tmp/plugin-standard-r10-wiring-prepared.log`）。只解析/安装二进制路径，实际 fork 全由 RecordingChild 替代；未启动应用或 Electron。hooksPath 仍 `.githooks`，无依赖/锁文件变更。

本轮改变测试文件恰为 6 个：`packages/schema/test/codepuppy-net-failure.test.ts`；`packages/ui-mac/src/main/{engine-cases.test.ts,network-egress-proxy.test.ts,package-hub-lifecycle.engine.cases.ts,reload-coordinator.test.ts}`；`packages/ui-mac/src/shared/host-extension-package-contract/plugin-conversion.test.ts`。engine-cases 只同步所改内部文件的宿主计数 7→8，没有运行全部宿主/engine 层；测试仍由已有 imports、宿主字面路径和 `.gate-tests` 选择。

类型检查：core、schema、ui-mac、ext 包内 `bun typecheck` 均 exit 0；日志 `/tmp/plugin-standard-r10-A3-{core,schema,ui}-types.log`、`/tmp/plugin-standard-r10-A1-ext-types.log`（core 2,059 files）。converter --check 与 artifact --check（20 files）均 exit 0。单仓 docs-contract **71 errors / 250 warnings**，保持既有基线与两项已接受 plan unknown-id（`/tmp/plugin-standard-r10-docs.json`）；没有削弱检查。`affected-tests --list` exit 0：**all tests: scripts/gate-files.tsv changed (gate or declared global input)**，列 **678 个 PR 文件**（`/tmp/plugin-standard-r10-affected{,-scope}.txt`）；没有依清单运行全套，没有改选择器或全局输入。旧三条 command-subagent 断言未改/未复跑，其文件仍不在清单。

实样边界：继承 accepted 15/15 整树安装；本轮新增的 Grafana 原 userConfig/env 声明仅把 Docker 换为临时树 echo，真实主进程 IPC、选项秘密存储、冷启动 ROOT/DATA 绑定通过，不冒称 Grafana SaaS/Docker 验收。build-ios-apps 的原 ios-ettrace-performance 与 ios-memgraph-leaks 两份 SKILL.md 渲染逐字通过。Rill 身份仅用于本机代理拒连和权限边界测试，未声称启动真实 Rill；其余 SaaS/工具链及片 5 七包的运行验收未补。

Host artifact aggregate 再变为 **38d198d344f7c858959ec9a5ff7dbdfe768eea940cd4cc8aa934347f0934761f**。本轮相对 r9 只改变 artifact 成员 `CONTRACT.md`、`plugin-package.ts`、`plugin-conversion.mjs`，以及 `host-extension-package-artifact.v1.json` 清单（共同前缀同 r9）；`plugin-conversion.ts` 为生成源。相对 `1db6a3bbf5` 的累计成员仍为 r9 收口列出的恰 9 项，没有新增成员，精确清单另见 `/tmp/plugin-standard-r10-host-artifact.json`。consumer pin/vendor 未动，checkpoint 交编排器。

遗留去向：A4–A9、B3/B4/B6/B7/B8、片 5 剩余运行行为与上述两条 r9 失败继续本车道 fix now；跨仓 checkpoint 交编排器；docs 与三条旧模型断言沿原归属。后续 A5 应注意本分支 `plugin-source-timing.ts` 的 REQUEST 实值为 10 分钟，不能把替换 30 秒误报为缩短；r9 已允许的非阻塞分支尚未实现。本轮无新迁移、新依赖、公开 DTO、ARCH 或 OPTIONAL。已核 Codex（GPT-6），A1–A3 具名证据通过，整体 PARTIAL；已定的单一绑定/allow-set/SSE 合同不重开。


## r11 · 从 A4 继续审查修正

核对：IMPLEMENT，编排器 r11；spec v5 / design v3.1 @f313990 与 r9 的已定 S-12 裁决，保留 r10 收据。2026-11-26 21:40 UTC+08:00 开始，顺序 A4–A9 → B3/B4/B6/B7/B8 → 两条本分支 engine 失败 → 片 5 剩余运行验收。本文记录运行证据；pin/vendor、gate、已定单一绑定权威不变。

A4：d607a2c829 的原位真实 SDK 回归先红（`bun test --max-concurrency 2 src/main/plugin-mcp-proxy.test.ts -t "explicit SSE registers"`，0 pass / 1 fail，实际 GET 有 proxy、/messages?sessionId POST 无 proxy；`/tmp/plugin-standard-r11-A4-red.log`）。fixture 只解析 core 已安装 Claude Agent SDK 的 peer 来加载 lockfile 钉住的 SDK SSE server，不运行 agent SDK、不加依赖、不硬编码机器路径/包缓存 hash、不手写 JSON-RPC。两次真实 SSE 会话均列工具/调用，实际 sessionId 不同；通过同一 bearer，私有认证/登记头不进服务，未登记同源路径 405，撤销关闭流且旧端点拒绝。

落实 r9 已接受 S-12 补口：既有 main 代理 handle/绑定 helper 消费源 transport 轴，connection 把同一轴交给实例 fetch。SDK 的实际 JSON POST 通过该实例的私有 proxy headers 登记地址；main 先核对有效 capability、已声明 SSE 流、origin 与协议，再原子登记 exact URL 后 pipe 转发。登记随同一绑定/流生命周期清理，不使用同源通配授权，不解析第二份 SSE、不读 SDK 私部、不增加 RPC/公开 McpProxyBinding 字段。该局部登记复用原代理鉴权与代际，不新建网络/权限权威；普通 HTTP 与 auth fetch 继续原域。原 connection 接管增量及具名证据同提交登记于 plugin-local-mcp / plugin-mcp-transport。

完整原 proxy lifecycle 文件 2 pass / 0 fail（`/tmp/plugin-standard-r11-A4-green.log`）。测试为有限本地 SDK integration，原文件 imports 可追踪，受影响 PR/nightly；该文件未登记精确条数，无新增全局集。后续补核心连接消费者及最终类型/相关集/移除验证，未把其余审计项或片 5 标完成。

A4 证据加严：原用例改走实际 McpConnection.make（未预包装 fetch），保留原断言，完整原文件仍 2 pass / 0 fail（`/tmp/plugin-standard-r11-A4-connection-green.log`）；core、util、ui-mac 包内 `bun typecheck` 均 exit 0（`/tmp/plugin-standard-r11-A4-{core,util,ui}-types.log`）。该用例现在覆盖 transport 从 config 传入实例 fetch 的消费者；没有扩展产品合同。

A4 移除反臂（`/tmp/plugin-standard-r11-A4-removal.py`）：删除 connection transport 传递 / 删除 main 登记，各 0 pass / 1 fail；恢复原字节，结果 `/tmp/plugin-standard-r11-A4-removal.json`。

A5：479eed3f0c 先提交两条原位回归，held npm metadata 使授权读不返回（0 pass / 1 fail，`/tmp/plugin-standard-r11-A5-red.log`）；打开的版本表单不接收到达通知（0 pass / 1 fail，`/tmp/plugin-standard-r11-A5-dialog-red.log`）。fixture 后续把回包改为与 IPC 一致的新快照对象，断言未改；原对象原地变更不能代表真实 IPC。实现采用 r9 授权的非阻塞分支：设置权威缓存按 provider / 安装身份区分，inflight 去重且不加入授权关键路径；建议成功后复用 hub-view 通知，包行/打开的共享表单重读，不覆盖用户已填值。元数据 fetch 自身仍用现有 deadline，不把 10min REQUEST 常量误当缩短。新改动必要同链是 main provider composition 与两个 renderer 消费者，无新 DTO/IPC/公开配置。

A5 原 installer 文件 46 pass / 0 fail（`/tmp/plugin-standard-r11-A5-green.log`），原 dialog component 文件 8 pass / 0 fail（`/tmp/plugin-standard-r11-A5-dialog-complete.log`）；宿主精确条数 7→8。回归分别是文件/事务 integration 与现有 DOM component integration，imports/宿主字面路径可由 PR 选择器追踪，不加 timing 测试。A5 及 A4 类型/相关集合将在收口统一补齐，不把其余 finding 标完成。

A6：ad666cf618 先红，真实 GitHub MCP 声明的受控敏感路径变体显示 DATA 路径重复 token.json 后缀（0 pass / 1 fail，`/tmp/plugin-standard-r11-A6-red.log`）。唯一文本解析器现在按配对 `${…}` 读取嵌套默认值，credential 脱敏递归保护默认值字面量；公开 rewrite 对每个 binding 只写该节点的占位符，复用原 binding renderer。嵌套默认值按 OUTER / INNER / 私有 literal 的原优先序渲染，描述、rewrite 与 tree digest 不含该 literal。完整 converter 原文件 42 pass / 0 fail（`/tmp/plugin-standard-r11-A6-complete.log`）；generated conversion / artifact 同步，gate-files 条数 41→42，合同字段未新增，consumer pin 未动。

A7：388aa12f1f 原位回归先红（0 pass / 1 fail，canonical write 丢掉 timeouts；`/tmp/plugin-standard-r11-A7-red.log`）。canonical record 复制/保留 timeouts，仍走既有 validMcpConfigLeaf 校验，无第二份数字规则。原 truth 文件 26 pass / 0 fail（`/tmp/plugin-standard-r11-A7-green.log`），覆盖落盘、读回、engine leaf 投影及无效各阶段值不覆盖旧文件；gate-files 原登记 24 同步实际 26（包含先前未同步的 transport 用例），不改 gate 实现。该 fast/临时文件测试位于原文件，imports 可追踪。

A8：c4764987a2 原位回归先红（0 pass / 1 fail，URL 原样 `${PLUGIN_REMOTE_ENDPOINT}` 且未抛具名状态；`/tmp/plugin-standard-r11-A8-red.log`）。MCP 的未绑定持久化投影保留原用法，调用时改复用既有 process.render；投影字段列表只在同一私有 renderMcpConfig 内定义一次。普通 URL/args/env/header 缺值抛具名 dependency-missing，敏感 environment 的空 secret fallback 点名该环境变量；已有 activation catch 只断开/失败该 connector，不使安装事务回滚。配置 body/source 不改。原 installer 文件 47 pass / 0 fail（`/tmp/plugin-standard-r11-A8-complete.log`），真实 GitHub 受控 URL 及 Authorization 的缺值、补值和源保留均有断言。

A9-HTTP：3b42760f97 原位 install/convergence 回归先红（0 pass / 1 fail，非本机 HTTP 使整个事务失败；`/tmp/plugin-standard-r11-A9-http-red.log`）。plugin 的存储校验保留完整 HTTP(S) 源定义，main convergence 复用既有 validateServer 地址判据（本机例外仍归原 pluginMcpLoopback）；只断开并返回该连接器 failed，不提交到 engine、不访问该远端，其他 skill/整树已安装且图保留。回归用固定 context7 与 frontend-design 原文件，受控替换协议；本仓 API 假服务器只返回本仓 protocol/groups/debug,mcp 声明的 DTO，不模仿 MCP 协议。原 installer/config/activation 三文件共 146 pass / 0 fail（`/tmp/plugin-standard-r11-A9-http-complete.log`），无 engine 接管/API 变更。

A9-origin：66b9bc8ce4 初次 fixture 带旧 transaction id，被正确 exact-replay 拒；e300cd0f92 只把重加 fixture 置于新写入（移除旧 tx），断言不改。随后真实缺陷先红（0 pass / 1 fail，created 记录因图中同名而得到 plugin 放宽；`/tmp/plugin-standard-r11-A9-origin-red.log`）。persistMcp 现在先取该 MCP 实际 record，created 不获 plugin 语义，其他来源还须匹配 pluginTree 子项的 componentId，不采信调用方名或 meta 声称。原 installer/config 两文件 145 pass / 0 fail（`/tmp/plugin-standard-r11-A9-origin-green.log`），包含 imported plugin 合法任意 argv 的正臂与同名 custom 的命令/loopback 拒绝。

A9-marketplace 观察按 r9 原裁决保留：design v3.1 §4.8 定义 portable/Claude/Codex manifest 合并，但未定义同一仓库根同时有 plugin 与 marketplace manifest 时的 prepareCapture 分流；§4.14–4.16 也未补该选择。`plugin-sources.ts:356–357` 的 manifest && !plugin 仍将这种输入作为 plugin。未自行增产品选择/DTO 或改源行为；编排器/设计承接该输入定义。其余 A9 继续本车道。

A9-layer：将原 core runtime 的私有 HTTP 代理用例移到 ui-mac 原 plugin-mcp-proxy.test.ts，保留真实 SDK HTTP 会话、GET/POST/DELETE、tools/list/call、每请求 bearer、服务端无私密头的断言，入口改走真实 McpConnection；SDK server 从 core 已安装依赖解析，无新依赖或 MCP 模仿格式。原 core 文件已无 ui-mac import（`rg ui-mac packages/core/test/codepuppy-mcp-runtime.test.ts` 无匹配）。原 UI proxy 文件 3 pass / 0 fail（`/tmp/plugin-standard-r11-A9-proxy-move.log`）。这是测试归属修正，无产品行为可单独红；A4 移除臂同样验证新的连接入口，core 原容量/计时案例仍不运行。

B3：b396ce1cab 原位真实 host 回归先红（未知 hint 拒绝 command，0 pass / 1 fail，`/tmp/plugin-standard-r11-B3-red.log`）。model-facts 未匹配时复用调用链 log 记录具体 hint 并返回 undefined；command 与 delegation 保留当前/default 模型，不引入新的模型要求。具名绿 1 pass，原 host 文件 67 pass / 0 fail（`/tmp/plugin-standard-r11-B3-complete.log`），同例实际走 command 和子助手；两次日志均点名 missing-model-hint。gate-files 精确 66→67。变更仅 ext 私有解析与现有消费者，无新增 engine 接管。

B4：788cd8c518 原位真实 hookify writing-rules 回归先红（0 pass / 1 fail，`/tmp/plugin-standard-r11-B4-red.log`），比较真正 skill tool 输出文本与原正文（仅 ROOT 绑定）。replace 改为函数返回正文，使 `$` 替换模式保持数据。具名绿 1 pass，原 host 文件 68 pass / 0 fail（`/tmp/plugin-standard-r11-B4-complete.log`）；gate-files 精确 67→68。未新增模板/转义权威。

B6：ea9c142a7e 原位 host 回归先红（tool delegation 多出一次无 source 的 assert，0 pass / 1 fail，`/tmp/plugin-standard-r11-B6-red.log`）。私有 delegate 明确消费 command/tool 调用域，只为无 tool-call 的 command 入口做该 assert；tool 入口保留原 execute.before 与 native executor 的 sourced 权限链。真实 permission evaluate 观察正/反域，无 mock、无放宽策略。具名绿 1 pass，原 host 文件 69 pass / 0 fail（`/tmp/plugin-standard-r11-B6-complete.log`），command 的独立检查仍 1 次，gate-files 68→69。

B7：b8c0f9ed40 原位 agent delegation 回归先红（0 pass / 1 fail，`/tmp/plugin-standard-r11-B7-red.log`）。按冻结 §4.9 的 Claude skill/command 参数文法域与 r9 B7 裁决，converter 的 agent 一律 literal；金额 `$1,250.00` 与 `!` 示例在真实模型请求里逐字保留。原 converter 的旧 agent-claude 断言仅此字段同步为 literal（其余 Invocation 断言保留）；原文件 42 pass、host 70 pass / 0 fail（`/tmp/plugin-standard-r11-B7-{conversion-green,complete}.log`），gate-files 69→70。生成 ESM/artifact 同步，未改 core renderer/consumer pin。

B8：f5f2b161de 原位 path-skill 回归先红（同一输入两次文件读导致 setup 的 temp marker 为 xx，期望 x；0 pass / 1 fail，`/tmp/plugin-standard-r11-B8-red.log`）。自动路径激活先查询同 session 的既有活动 scope；已激活不再调用 renderer，新用户输入清除 scope 后可重激活。fixture 使用固定 Temporal 开发技能和 feature-dev 的受控组合，只在临时项目写 marker；无计时断言。原 host 文件 71 pass / 0 fail（`/tmp/plugin-standard-r11-B8-complete.log`），具名绿额外证明下一输入 marker 为 xx；gate-files 70→71。A9 测试归属的 registry 证明路径同步为 ui-mac（未变 engine takeovers）。

Engine-cloud：完整原 engine 文件经共享槽复现 6 pass / 2 fail（`/tmp/plugin-standard-r11-engine-diagnostic.log`），cloud 为 disabled/unresolved credential，不归咎基线。随后精确对照 r3 的激活迁移发现 outer IPC 原 `node.kind !== mcp` 重载条件被缩为排除 cloud，丢了原 startup refresh；89dcd64666 用 shipped cloud-v1 corpus 的原 installer 文件新增回归先红（0 pass / 1 fail，`/tmp/plugin-standard-r11-engine-cloud-fast-red.log`）。仅补回 deferred 回调的 cloud 域，不改 state writer 顺序、不提前激活。原 installer 50 pass / 0 fail；`gate slot -- bun test --max-concurrency 2 --timeout 180000 ./src/main/package-hub-lifecycle.engine.cases.ts -t "cloud-only package switch"` 1 pass / 0 fail（`/tmp/plugin-standard-r11-engine-cloud-green.log`）。曾创建 origin/alpha@6a55937acd 的临时 detached checkout，未 setup/未跑基线，因已定位本分支条件遗漏而移除；未声称基线失败，未 merge/rebase。卸载原整文件失败仍继续处理。

Engine-removal：同一完整原文件的红（r10 及 r11 diagnostic 均 removal reload reported）已提交在既有 case 中，不改其断言/等待。实际原因是 package hook cleanup 在 Location 自身关闭前 await 该 Location 的事件 iterator，留下旧默认目录实例，随后 session activity 探针超时。cleanup 仍先 abort 订阅/全部包进程；事件流的 scope 由 host 随 Location 关闭，不从它自己的 plugin cleanup 反向 join；AppProcess runtime 仍 await dispose，再删私有临时目录。既有本机 promise event 契约及 host scope 不变，无 engine 新接管、超时/重试/绕行。

`gate slot -- bun test --max-concurrency 2 --timeout 180000 ./src/main/package-hub-lifecycle.engine.cases.ts` **8 pass / 0 fail**（`/tmp/plugin-standard-r11-engine-green.log`），两条旧失败与 A1 cold generations 全部通过；原 host 文件 **71 pass / 0 fail**（`/tmp/plugin-standard-r11-engine-removal-host-complete.log`），相关 package SessionStart 1 pass 也通过。没有将 isolated removal 曾通过当完整证明。ui-mac/ext 包内 typecheck 在最终两项修正后再次 exit 0（`/tmp/plugin-standard-r11-{ui,ext}-types-final.log`），core/util 原最终代码检查 exit 0，未运行 gate run/bin/check/全层。

### r11 证据收口与续接边界

截至 59c0b0dcf1，A4–A8、A9-HTTP/origin/layer、B3/B4/B6/B7/B8 及两条本分支 engine 失败已闭合。A9 的混合根清单选择按 r9 允许保留观察，不自行裁决。片 5 其余运行尚未实施，本轮按执行预算返回 **PARTIAL**；21:40 起，收口约 22:33 UTC+08:00（约 53 分钟），不把现有基础层当完整运行验收。没有新的未决 binding/engine 接缝；现有审查修正没有进入 gate/pin/vendor，未 push/PR/merge/rebase 或启动 app/Electron。

移除反臂共 **16 条变红**：A4 connection transport、代理登记（两个磁盘 scoped 试改均恢复原字节），A5 refresh、A6 binding placeholder/嵌套默认值、A7 timeouts、A8 strict renderer、A9 runtime address/record origin、B3 default、B4 dollar、B6 sourceless check、B7 literal、B8 active scope、cloud refresh、hook stream cleanup。前 15 臂各具名 0 pass / 1 fail；cleanup 必需先运行原 busy lifecycle，相关两例为 1 pass / 1 fail，失败仍是 removal reload reported。`gate slot -- env PLUGIN_REMOVAL_SPEC=/tmp/plugin-standard-r11-engine-cleanup-removal-spec.json bun test --preload /tmp/plugin-standard-r11-removal-preload.ts --max-concurrency 2 --timeout 180000 ./src/main/package-hub-lifecycle.engine.cases.ts -t "real desktop package lifecycle|removing a package whose remote"` 的输出在 `/tmp/plugin-standard-r11-engine-cleanup-removal.log`；cloud fast 反臂在 `/tmp/plugin-standard-r11-engine-cloud-removal.log`。其余 12 臂用独立 Bun preload 对真实模块应用唯一文本变更，逐臂确认 applied marker 与业务断言失败，未写工作树/未以 artifact drift 代替失败（脚本与结构化结果 `/tmp/plugin-standard-r11-removal-preload{.py,-results.json}`）。排队 engine 期间使用进程内独立变更，不影响其生产依赖；没有边排队边改生产源码。A4 原两臂另见上述 JSON。

最终当前代码相关集合 **616 pass / 0 fail**，重复运行与移除臂不累加，27 个有限相关测试文件：

- changed behaviour 原文件：installer 50、ext-config 96、activation 2、converter 42、remote truth 26、proxy lifecycle 3、account dialog 8、ext host 71，共 298；最新完整文件输出分别在上述各步日志，最后 installer 为 `/tmp/plugin-standard-r11-engine-cloud-fast-green.log`、host 为 `/tmp/plugin-standard-r11-engine-removal-host-complete.log`。core runtime 文件的容量/计时部分没有运行，移动 case 的断言在 UI 原文件保留。
- 一次较宽相关集 310：UI 14 文件 **295**（config injection、MCP derivation、set-state tx、uncurated bodies、package accounts、admission 的 main/parity/wiring、network registry、egress grant truth、RecordingChild server、artifact/envelope、renderer IPC chokepoint；`/tmp/plugin-standard-r11-ui-related.log`）；Ext process/registry **8**；core 原 runtime 具名 working-dir/缺依赖/状态/显式 SSE/缺省 HTTP **4**；私有 HTTP/CONNECT/拒连 **3**（`/tmp/plugin-standard-r11-{ext,core,proxy}-related.log`）。命令均为包内 `bun test --max-concurrency 2 <这些文件>`，core 使用 `-t "a missing working directory|the failed status the desktop reads|explicit SSE opens|absent and explicit HTTP"`；proxy 使用 `-t "plugin loopback|plugin CONNECT"`。未扩大到同包/同层全套。
- engine 原生命周期文件 **8**，实际经过共享 `gate slot --`，日志 `/tmp/plugin-standard-r11-engine-green.log`。两条原失败、A1 cold start 均通过；隔离的 cloud 1 pass、早先 isolated removal 1 pass 与 wrapper 不另累加。

本轮永久改变的测试文件恰 8 个：core `test/codepuppy-mcp-runtime.test.ts`（移除跨层 case）；ext `src/plugin-host.test.ts`；UI `src/main/{install-from-source,mcp-server-truth,plugin-mcp-proxy}.test.ts`、`src/renderer/subprocess-cases.test.ts`（共享 dialog 计数）、`src/shared/host-extension-package-contract/plugin-conversion.test.ts`、`test-component/package-account-dialog.cases.ts`。没有 ticket-named 文件。新增各例均在原 fast/integration 层，以 imports/宿主字面路径追踪受影响 PR；测试外格式来自固定 source corpus/实际 SDK，mock 的本仓 API 使用本仓协议。临时 engine diagnostic 的代码恢复到原字节，未提交调试输出或改等待期限。

core/util/ui-mac/ext 包内 `bun typecheck` 全部 exit 0；最终两项 runtime 修正后 ui-mac/ext 再核 0。conversion generator `--check` 与 artifact `--check`（20 files）均 exit 0。docs-contract 使用临时 Alpha 单仓 profile 定位本 worktree（`/tmp/plugin-standard-r11-docs-profile.yml`），`--changed-since 1db6a3bbf5 --format json` 仍 **71 errors / 250 warnings**（`/tmp/plugin-standard-r11-docs.json`）；不修已接受基线。plan 相对链接 8 条可达，`git diff --check` 通过。`affected-tests --list` exit 0，scope 为 **all tests: scripts/gate-files.tsv changed (gate or declared global input)**，列 **678 个 PR 文件**（`/tmp/plugin-standard-r11-affected{,-scope}.txt`），没有依该清单运行全套。hooksPath 仍 `.githooks`。

实样边界：继承 accepted 15/15 整树。新增 hookify writing-rules 的真实 skill/tool 正文与 ROOT 绑定通过；feature-dev 的命令/agent 默认模型、委派权限、literal agent 经真实 host 通过；Temporal 真实技能的受控 Claude/path 组合验证每轮只做一次 setup。GitHub/context7 的配置与敏感默认值试样是受控变体；SSE/HTTP 为真实本地 SDK server，不冒称 Rill/Grafana 等 SaaS/工具链已跑通。learning-output-style SessionStart、hookify UserPromptSubmit、ralph-loop 原 setup 继承 r9 实际运行收据；**ralph-loop Stop 循环及 code-modernization / claude-security / Langfuse / dash0 / Stripe / PayPal / Convex 七包完整 runtime acceptance 尚未做**。其余 Pre/Post/Permission/Stop/StopFailure、prompt handler、monitor、async/rewake、FileChanged/CLAUDE_ENV_FILE、scope 生命周期、S-03…S-07 与 PostToolBatch 继续片 5，未新增伪 unavailable/connected 原因来减少 AC。

Host artifact aggregate 为 **13d81cbabb1164623595d3ed1aa18dbc1206e55ba8179cd74dadc09cd7d9b795**。相对 r10 本轮仅 artifact 成员 `CONTRACT.md`、`plugin-package.ts`、`plugin-conversion.mjs`，以及 `host-extension-package-artifact.v1.json` 清单改变。相对 1db6a3bbf5 累计恰 9 成员：`CONTRACT.md`、`plugin-package.ts`、`plugin-hook-events.ts`、`plugin-conversion.mjs`、`plugin-conversion.d.mts`、`generate-artifact.ts`、`profiles/plugin-package.v1.schema.json`、`testvectors/plugin-package-description.v1.json`、`testvectors/decoder-corpus.v1.json`；共同前缀 `packages/ui-mac/src/shared/host-extension-package-contract/`。精确快照 `/tmp/plugin-standard-r11-host-artifact.json`，consumer checkpoint 仍交编排器，未改 pins/vendor。

遗留去向：片 5 剩余行为 fix now 续本车道；混合 plugin/marketplace 根输入定义交编排器/设计；consumer checkpoint 交编排器；docs 基线及三条旧 command-subagent 断言沿原归属（未编辑/复跑）。已核 Codex（GPT-6），没有新增依赖、迁移、DTO、engine 接管、ARCH 或 OPTIONAL 项。最终以本节为实际交付范围，前面旧轮次的尚未实施描述只保留历史收据。

## r12 · 片 5 运行闭合

核对：IMPLEMENT，编排器 r12 / Claude Opus 5.5；继承 de4dc535d9，spec v5 / design v3.1 与既定裁决。2026-11-26 22:35 UTC+08:00 起，止于片 5，不开片 7。本轮文档影响为来源语义与运行证据，仍落本计划及本仓既有模块/主权登记。

偏离记录：**orchestrator ruling 2026-11-27（r12，Claude Opus 5.5）**——同根 plugin+marketplace 时作为市场，根插件未列出时追加为可选条目；没有新增用户步骤。6f8a50e225 替换原“只当包”断言并新增缺根变体先红（0 pass / 2 fail，`/tmp/plugin-standard-r12-mixed-red.log`）。固定 CodSpeed 本身已有 `./` 自条目，源解析器现在保留根路径；主进程沿同一 candidate/capture/converter 使每个条目可选，额外根只按根 path 是否已列出追加。第二例仅把固定 frontend-design 树放到该真实 repo 形状的 nested，并将原清单条目指向 nested；两项都能从 issued id 真实转换。原 source/converter 文件 90 pass / 0 fail（`/tmp/plugin-standard-r12-mixed-complete.log`）。没有新 DTO、确认或执行源代码；converter ESM/artifact 同步，consumer pin/vendor 仍由编排器协调。

Stop 运行步骤：8c4d1d3547 先提交真实 Ralph Stop 回归，具名 0 pass / 1 fail（只发生首轮，`/tmp/plugin-standard-r12-Stop-red.log`）。调用原 /ralph-loop 命令、原 fenced setup 与 stop-hook.sh，仅离线模型按固定两次响应；第一轮 block/reason 经 native idle→synthetic 进入同一 Session，第二轮原 completion promise 删除状态文件，第三次普通用户输入不再继续。没有替换原脚本、人工填写转录、开子会话或第二推理循环；本机 `/usr/bin/jq` 可用。公共 stdin 补真实 stop_hook_active/last_assistant_message；普通成功 stdout 作为文本保留，结构化 JSON 仍按实际解析错误处理。只有已接通的 package command Stop 加入 readiness，SubagentStop 的声明尚未报可用。原 host 72 pass、installer 50 pass / 0 fail（`/tmp/plugin-standard-r12-Stop-{complete,install}.log`），ext typecheck exit 0（`/tmp/plugin-standard-r12-Stop-types.log`）。L0 归属在唯一 registry 新增 plugin-hook-lifecycle，同提交，无新增 engine 接管；gate-files host 72。


工具阶段步骤（D4 / AC-11/13/14/15）：4e38129072 的真实 hookify 敏感文件规则只把 action warn 改 block，原位 native write 先红（0 pass / 1 fail），现在能拒绝 credentials.txt 且普通文件照写；源 Write.file_path 与运行时 write.path 交给既有 policy/identity 单点双向投影，MCP 源名也沿同一验证身份。79e57bd1e6 的原 Convex convex-lint.mjs advisory allow 先红（仍问一次），现消除同次普通 ask、保留原生 deny、bundle 关闭后再问。该测试的关闭输入修正为只撤 bundle（保留原 membership 的技能 keys）：首个 native write 同时按原路径激活了 Convex skill，撤所有技能会按片 3 的既定合同拒绝仍在活跃期的调用；没有改任何断言或片 3 的失效判定。原脚本曾因包进程未继承 PATH 退出 127，沿现有 stdio MCP/AppProcess 的 extendEnv 合并修正，不加工具查找或平台特例。

当次 hook 决定在原 policy 内绑定 session/message/call、最终输入摘要、当前服务摘要和包 generation/settings/启停闭包；tool after 清理，不写持久授权。ask 优于 source invocation allow；已有真实 deny、automation 与 install BR-10 仍由原 gate 决定。e3b11e0963 新增最低相关 integration 表（ask、changed-input、revoked），先 2 pass / 1 fail（ask 被 invocation allow 吞掉），后 3 pass / 0 fail；日志 `/tmp/plugin-standard-r12-policy-{red,green2}.log`。源 updatedInput 转换后由现有最终 policy 重判，真正执行前的输入 schema 仍归 core tool/runtime.ts decodeInput，没有另一份 validator。

此步骤完整原文件 host 74、register-policy 75、identity 19、package-process 3，共 **171 pass / 0 fail**（`bun test --max-concurrency 2 src/plugin-host.test.ts src/policy/register-policy.test.ts src/policy/identity.test.ts src/plugin-package-process.test.ts`，`/tmp/plugin-standard-r12-tool-complete.log`）；installer 原文件 **50 pass / 0 fail**（`/tmp/plugin-standard-r12-tool-install.log`）；ext 包内 `bun typecheck` exit 0（`/tmp/plugin-standard-r12-tool-types2.log`）。均按原 import/字面 fixture 路径可追踪，为 affected PR integration/fast；host gate-files 仅同步 72→74。L0 生命周期登记同步消费既有 tool/policy 挂点，无新增 engine takeover/公共 DTO。这里只将 package command PreToolUse 加入唯一 readiness，PermissionRequest/post/prompt/scope 仍待接通，不把本步骤当完整片 5 验收。


prompt 步骤（AC-24 / D13）：fab0823720 以固定 PayPal 原 hooks.json 与仅改 prompt 文本的拒绝变体先红（0 pass / 2 fail，`/tmp/plugin-standard-r12-paypal-red.log`）。同一个 runner 在源 matcher/工具字段映射后，按已定 D13 只替换源字符串中的 $ARGUMENTS 为本次 JSON（绑定值不再解释；无占位则附 JSON），路径/秘密/option 仍由同一个 pluginProcessConfig 绑定。使用现有 stateless generate.text，不传工具；用户有效模型优先、hint 复用唯一 model-facts 解析、结构化判断严格检查、超时/坏输出/模型错误沿源 onFailure。ok=true 是 no-decision，真实 native edit ask 仍问一次；ok=false 阻止 native write；Read 不产生判断请求。私有值在理由/错误投递前脱敏，包/会话失效的迟到判断丢弃。

6bc20d6f5b 再补同一个真实 native task 的 continueOnBlock false/true 两臂，先 1 pass / 1 fail：直接 interrupt 虽然停了任务，却把理由改成 Tool execution interrupted（`/tmp/plugin-standard-r12-paypal-task-first.log`）。修正使用已定 tool/context 原语：先让拒绝成为真实工具错误，false 在同任务下一个 awaited context 屏障、开始下一次模型请求前结束；true 走原工具反馈路径。原两项断言不改，最终 PayPal 四项 4 pass / 0 fail（`/tmp/plugin-standard-r12-paypal-task-green.log`），分别只发生 2 / 3 次模型调用，理由保留且文件未写。没有新增 engine 端口、第二模型循环、提示重入或审批步骤。

完整原 host 文件 **78 pass / 0 fail**（`/tmp/plugin-standard-r12-prompt-complete.log`），installer **50 pass / 0 fail**（`/tmp/plugin-standard-r12-prompt-install.log`），ext typecheck exit 0（`/tmp/plugin-standard-r12-prompt-types3.log`）。测试仍位于既有 integration 原文件，由 production imports 与固定 corpus 路径追踪；gate-files host 78、register-policy 实测 75 精确同步。L0 registry 在同提交登记现有无工具生成/awaited context 消费，readiness 只增加已验的 package prompt PreToolUse；其他 prompt 事件仍不冒称已接通。


D4 决定边界补核：caa4b35fab 在原 register-policy integration 文件增加“同一次工具实现另行 assert 另一已注册权限动作”反例，缺身份匹配时 read ask 被 write 的 hook allow 吞掉，具名 0 pass / 1 fail（`/tmp/plugin-standard-r12-hook-identity-red2.log`）；现在仅原工具自己的 permission/canonical 动作消费已确认决定，其他动作仍询问。最终 pin 前保存并重查原 prepared hook 对象，若此期间其活跃/输入/服务绑定失效，清掉该当次决定重新 confirm。完整原文件 **76 pass / 0 fail**（`/tmp/plugin-standard-r12-policy-complete-final.log`），gate-files 精确同步 76，不改变原生围栏、硬 deny 或其他动作能力。


PostToolUse 步骤（D4 / AC-11）：4fdba9a7b3 隔离固定 hookify 原 PostToolUse handler（仅从临时 manifest 撤 PreToolUse，防止前阶段假满足），运行原 posttooluse.py 与原敏感文件 warn 规则；真实模型工具 write 已完成，再一轮模型请求应带警告。具名先 0 pass / 1 fail，后 1 pass / 0 fail（`/tmp/plugin-standard-r12-post-{red,green}.log`）。现在从真正 tool.execute.after completed 取原输入和实际 output/content，源名/字段转换仍在原 identity；handler 错误留在同一个 runner 的 onFailure，未启用的包不会额外解析工具身份。警告只在写后出现且文件已写，不冒充前阶段 deny 或工具回滚。完整 host 原文件 **79 pass / 0 fail**（`/tmp/plugin-standard-r12-post-complete.log`），ext/ui-mac 包内 typecheck 均 exit 0（`/tmp/plugin-standard-r12-{ext,ui}-types.log`）。本步骤仅 command PostToolUse connected，未新增 engine 接管，L0 原登记、gate-files 79 同步。


较宽相关集核对发现并直接处理两项本轮引入的配套问题：原 context-injection `package idle cleanup preserves the context-bearing event unchanged` 在没有 Stop handler 时被新增的无条件 Session.get 拒绝（`/tmp/plugin-standard-r12-ext-related.log`）；idle 现在先看当前包的 Stop/SubagentStop 消费者，无消费者便不读会话、不改 context-bearing event。registry 的两条动态 PayPal 标题此前写成运行时展开的全名，原静态验证按源码 includes 找不到；只把登记名同步为原源码中稳定的测试前缀，不改验证器或测试断言。修后 context-injection / authority-registry / host 三个完整原文件 **129 pass / 0 fail**（`/tmp/plugin-standard-r12-idle-complete.log`），host 79 不另累加。

移除核对发现真实 hookify 的规则在 tool_name 不匹配时仍加载全部规则，因此只删源别名映射的臂仍绿；没有称它为有效反臂。在 identity 原 fast 文件补最小源/运行字段往返及验证 MCP 源身份，取现有 toolFacts/mint 的本仓注册事实，外部拼写来自已固定 hookify/Convex；完整 **20 pass / 0 fail**（`/tmp/plugin-standard-r12-identity-complete.log`）。该纯映射在原同名文件、无进程/网络/真实 runtime，imports 可追踪，为 affected PR fast。随后用这一最低层证据替代弱的别名移除观察；字段和权限的真实宿主回归仍保留。

### r12 收口证据与未完成边界

本轮去重相关集合 **530 pass / 0 fail**，16 个有限原测试文件。完整行为文件 source 48 + converter 42 + installer 50 + host 79 + register-policy 76 + identity 20 + process 3 = 318。一次较宽相关集 UI artifact/envelope 117（`/tmp/plugin-standard-r12-ui-related.log`）；ext 原 unattended-policy / unattended / session-row-rules / authority-registry / plugin-setup-order / plugin-fanout / context-injection 七文件最终 95，其中未失败五文件 45 继承 `/tmp/plugin-standard-r12-ext-related.log`，配套修正后两文件 50 见 `idle-complete` 的 129 减已计 host 79；没有为了求整集合再次复跑已绿文件。具名迭代、红测与 removal 输出不累加。r11 的 engine 8 pass / 整树 15/15 继承 accepted 收据，不计作本轮新运行，也没有 engine 修改需要复跑 engine case。

**14 个有效移除臂均红**，Bun child-only preload 精确命中并打印 REMOVAL_ARM_APPLIED，未改磁盘生产字节：mixed-marketplace、mixed-unlisted-root、Stop-same-task、PreTool-source-name（新增 fast 身份证据）、call-allow、ask-priority、final-input、live-generation、permission-identity、prompt-runtime、prompt-no-decision、prompt-turn-boundary、post-runtime、process-PATH。命令及每臂结果在 `/tmp/plugin-standard-r12-removal-results.json`，执行 `python3 /tmp/plugin-standard-r12-removal.py`；前 3 臂不重复，后 11 续跑。prompt-runtime 选择两条原回归而有 2 fail，其余各 1 fail；没有把较早仍绿的弱名字观察计入移除证明。每臂通过原具名断言观察缺失行为，不是只检查源码/标题。

ext / ui-mac 包内 `bun typecheck` 均 exit 0（最终 `/tmp/plugin-standard-r12-ext-types-final.log`、`/tmp/plugin-standard-r12-ui-types.log`）。conversion `--check`、artifact `--check` 均 exit 0（20 files）。docs-contract 用原 Alpha 单仓临时 profile，`--changed-since 1db6a3bbf5 --format json` exit 1，仍 **71 errors / 250 warnings**（`/tmp/plugin-standard-r12-docs.json`），按派发不修基线。`git diff --check` exit 0，hooksPath=`.githooks`；`affected-tests --list` exit 0，scope **all tests: scripts/gate-files.tsv changed (gate or declared global input)**，列 678 个 PR 文件（`/tmp/plugin-standard-r12-affected{,-scope}.txt`）。只同步派发允许的精确计数行，没有运行该全清单、全层、gate run 或 bin/check。

| 真样包 | 本轮实际运行证据 | 边界 / 片 5 尚未完成 |
| --- | --- | --- |
| ralph-loop | 原命令、fenced setup、原 Stop 脚本；同 Session 两次响应后 completion promise 结束、无 child，后续普通输入不再循环 | 此项通过；离线 TestLLM 验运行，不冒称真实模型任务质量 |
| hookify | 原 Pre/Post 脚本及原敏感文件规则；真实 write 被 block / 写后上下文；post 旅程亦实际执行原 Stop 脚本；UserPromptSubmit 继承 r9 | 基础 command hook 已有真实证据；完整扩展生命周期仍随共享 runner 待实施 |
| PayPal | 原 prompt + 仅文本拒绝变体、Read 不匹配；无工具生成、用户有效模型、原生审批、continueOnBlock 两臂均经真实宿主 | AC-24 本地运行语义通过；离线判断输出不代替付费模型质量/PayPal SaaS 验收 |
| Convex | 原 convex-lint.mjs advisory allow、原生 deny、bundle off 后再问，进程 PATH 与源字段真实消费 | 5 个 monitor 选择/通知/离场清理尚未接线；原 SessionStart/Stop 外部工具链未验，尚不能说到达其 SaaS 登录边界 |
| code-modernization | 固定声明/整树与共享 async/rewake 基础继承 | 未执行原 telemetry 全事件；PostToolUseFailure/StopFailure 仍待接线，不能记作 SaaS 阻塞 |
| claude-security | 片 3 原命令/agent 证据继承；本轮源声明只读核对 | Expansion、PermissionRequest、skill-scoped hooks 尚未接线；原 handlers 全运行未验 |
| Langfuse | 共享 package-process 原文件含真实 11 option 声明的 defaults/secret/DATA/stdin 与脱敏回归通过 | 原 hook 的 Stop/SessionEnd 全运行未验，SessionEnd 尚未接线；未冒称 Langfuse SDK/uv 或 SaaS 已跑到登录边界 |
| dash0 | 固定 24 声明与五项 unavailable 原因继承 | 有时机的实际事件全回放尚未验；Config/Instructions/Compact/Elicitation 等 S-04…S-07 未实施 |
| Stripe | 固定整树/声明继承 | S-08 PostToolBatch 尚未接线，原抽样脚本 always 变体未运行 |

Host aggregate 现为 **9eaf52305a08ccdf6cbba6131c6573228f304e6316671f510b952fc48c3668b7**；相对 r11，artifact 成员只变 `plugin-conversion.mjs`，以及自身清单 `host-extension-package-artifact.v1.json`（共同前缀 `packages/ui-mac/src/shared/host-extension-package-contract/`）。相对 base 累计 9 成员仍为 CONTRACT.md、plugin-package.ts、plugin-hook-events.ts、plugin-conversion.mjs、plugin-conversion.d.mts、generate-artifact.ts、profiles/plugin-package.v1.schema.json、testvectors/plugin-package-description.v1.json、testvectors/decoder-corpus.v1.json。精确快照 `/tmp/plugin-standard-r12-host-artifact.json`；未改 consumer pin/vendor，checkpoint 归编排器。

本轮结论 **PARTIAL**：片 3/4 accepted 继承；混合根问题已按 r12 裁决闭合；Ralph Stop 与上述 D4/PayPal/Post 增量完成。片 5 仍需原计划的 PermissionRequest、Expansion、PostToolUseFailure/StopFailure、skill/agent scope、S-03 leave/notification/FileChanged/子助手生命周期、S-04…S-07、S-08 与 monitor 实际激活/通知/取消，及表中七包剩余运行验收；不得把这些称为五项正式 unavailable 或外部 SaaS 限制。没有新增未决设计问题，本轮依执行边界返回具体状态，不开始片 7。

已核 Codex（GPT-6），spec v5 / design v3.1 + r12 orchestrator ruling。22:35 至 23:17 UTC+08:00 约 42 分钟，19 文件、718 additions / 72 deletions（最后收口文字前；含测试、生成物与证据）；没有新增依赖、迁移、公共 DTO 或 engine takeover。各实现增量已同提交登记原 L0 主权；只动计划边界和必要同调用链文件，tests-only 与修正分开。遗留去向：上述片 5 行为 fix now 续本车道；host consumer checkpoint 交编排器；docs 基线及三条旧 command-subagent 断言沿原归属；没有新增 ARCH / OPTIONAL 或仓外写操作。

## r13 · 片 5 运行接线续行

核对：IMPLEMENT，编排器 r13 / Claude Opus 5.5；继承 a9fe51d2ba 与 spec v5 / design v3.1 及现有 ruling，按片 5 原顺序，不开片 7。2026-11-26 23:19 UTC+08:00 起，文档影响为既有运行挂点与证据，落本节、modules 与唯一 L0 registry。

PermissionRequest（D4 / AC-11/22）：e69bad67d6 用固定 Claude Security 原 unanswered 脚本只把 UNANSWERED_AFTER_S 60→0，保留原 START_CONFIRMATION 文本/JSON 判定，实际 native question 请求先红（出现一张普通审批卡，`/tmp/plugin-standard-r13-permission-red.log`）。现在同一个 runner 在 policy 即将产生真实 ask 的 evaluate 点运行，真实 session/message/call 对应 tail 当前输入；源 AskUserQuestion/tool_input 从同一 identity 投影。原 JSON decision.behavior=deny 在卡出现前拒绝并显示原 message；identity-axis 和 native-axis 的有效 allow 均重新判最终输入/服务/包活跃，再消费本次决定，不写持久权限。无真实 ask 不触发；安装 BR-10、automation、硬 deny 和其他 permission action 不放松。原 60 秒计时未运行；这是有限 wiring integration，不把等待测量塞进 PR。原副本无 credentials/SaaS 请求。


PermissionRequest 步骤完整 host 80 + policy 78 = **158 pass / 0 fail**（`bun test --max-concurrency 2 src/plugin-host.test.ts src/policy/register-policy.test.ts`，`/tmp/plugin-standard-r13-permission-complete.log`）；installer 原文件 **50 pass / 0 fail**（`/tmp/plugin-standard-r13-permission-install.log`）；ext typecheck exit 0。新正向表验证两个真实审批轴只执行一次 handler、无卡、释放后下一次仍问；原安全脚本 deny 具名 **1 pass**。生产使用同一 policy.evaluate/current-call 表与 runner，只有已接通的 package command PermissionRequest 加入 readiness，无新 engine 接管/公共 DTO。相关用例在原 integration 文件、imports/固定 corpus 可追踪，gate-files 仅同步 host 80、policy 78；唯一 L0 registry 与 modules 同步。


Expansion/scope（D4 / AC-11/13/15/25）：11066c70a0 的固定 Claude Security threat-model 命令/skill scoped hook 先红，错误文件可写（`/tmp/plugin-standard-r13-scope-red-final.log`）。只在测试副本的原 turn/bound command 加 CLAUDE_CONFIG_DIR=本包 DATA，Python/脚本正文未改；最初测试前缀条件漏了原 `|| true`，补正为识别原 turn 子命令，未改断言；一次核对原用户目录未生成 notes，后续源状态均只在临时 DATA。真实 UserPromptExpansion 在展开前收到 namespaced 源身份/args/source/expansion_type；非 fork 命令提前用已有 SessionMessage.ID 分配其随后原生 prompt 的真实 id，沿现有 id 参数提交，前后 prompt_id 相同；手动附件使用原 SessionPrompt.messageID。fork 命令没有尚不存在的父 prompt_id，贡献跟随真实 child 的指令载体，未伪造父输入。

同一 Invocation 在原 bind/释放点管理 hooks，手动附件准备在同一个 runner 的用户阶段前执行，Stop 仍在释放前执行；scope 退出/代际与开关变化中止所属进程、丢迟到输出，CLAUDE_SKILL_DIR 沿现有 process config 绑定，没有第二模板 parser/范围权威。真实 source bound 还暴露相对 file_path 会被拒绝：d929d02786 新增 pure identity 红测（`/tmp/plugin-standard-r13-path-red.log`）；源路径现按已验证 native tool 的 Location 转绝对路径，逆向值仍表示同一文件，原 fast 夹具切成源协议使用的绝对路径。没有缩小 native 工具接受相对路径的能力。

同提交的 Ralph scope 红测显示 Stop 继续后权限被过早清掉（`/tmp/plugin-standard-r13-stop-scope-red.log`），现在只在真实结束而非 hook 继续时清理原 Invocation。四项具名 **4 pass / 0 fail**（`/tmp/plugin-standard-r13-scope-green3.log`）：Security 错误路径被拒、合法 threat-model.md 可写、普通下一轮可写；Ralph 继续仍保留 Write deny、真正结束后解除。完整 host 82 + identity 21 + process 3 **106 pass / 0 fail**（`/tmp/plugin-standard-r13-scope-complete.log`）；installer **50 pass**（`/tmp/plugin-standard-r13-scope-install.log`）；ext typecheck exit 0。process 原 option/stdin 用例同时检查 scoped 目录实际进子进程。均为原 fast/integration、生产 imports/固定来源追踪，host gate-files 82；L0 原主权同提交登记，未增 engine 接管或公开字段。


失败阶段（D4 / AC-11/22）：935e41905f 用固定 dash0 原 24 声明、仅替换处理命令为有限 stdin 观察程序（复用原 exec-form command/args）先红，真实无效 native write 没有 PostToolUseFailure（`/tmp/plugin-standard-r13-failure-red-final.log`）。现在 execute.after error 传实际 source tool/input/id、error/is_interrupt；session.execution.failed 传真实 error type/message，异步消费不阻塞关闭事件，失败处理器的异步输出不按 exit 2 再唤醒已失败任务。普通 Stop 不冒充失败。StopFailure 上下文暂存到原会话下一次真实输入，关闭会话即清理；不吞源进程退出失败。

具名 **1 pass / 0 fail**（`/tmp/plugin-standard-r13-failure-green.log`），真实 tool failure 与不可重试 provider rejection 各恰一次，失败会话无 Stop、无额外模型调用。完整 host 原文件 **83 pass / 0 fail**（`/tmp/plugin-standard-r13-failure-complete.log`），installer **50 pass**（`/tmp/plugin-standard-r13-failure-install.log`），ext typecheck exit 0（`/tmp/plugin-standard-r13-failure-types2.log`）。类型检查要求 subscription 初始化放在 runner 定义之后，已机械移动；行为不变，不重跑已绿整文件，后续相关集覆盖该消费。测试仍为原 integration 文件/固定 dash0 literal 来源路径，gate-files 83；command 失败事件的 readiness 与 L0 主权同提交同步，无新增 engine 接管。

较宽相关集发现 setup-order 的原隔离 mock 仍只返回 seal，缺本轮真实 PolicyRegistration.onPackagePermissionRequest；`plugin-setup-order.cases.ts:17` 作必要同调用链形状同步，未改顺序断言（`/tmp/plugin-standard-r13-ext-related.log` 94 pass / 1 fail）。补充真实 scope 脚本前的 DATA 标记，前任务两次 Write 恰执行两次，普通下一轮不再执行，即使原脚本自身 guard 无输出也能检测 scope 泄漏。修后原 host/setup-order 两文件 **84 pass / 0 fail**（`/tmp/plugin-standard-r13-scope-observer-complete.log`），其余六个已绿相关文件继承，不重复运行；这是验证配套增量，不改变生产行为或计数。

### r13 的 S-04 接缝返回与收口

**SEAM-CHANGE-NEEDED: S-04 的 skills 生产点。** 冻结 design v3.1 §6 接缝表 `:582` 与 §10 `:763` 仅授权既有 `core/src/config.ts` 的 Config.load/reload 发布前窄调用。实际 `packages/core/src/config.ts:365–376` 只比较 Document/兼容目录；技能正文不变更该 Document 时在 `:373` 直接返回。技能有独立 watcher：`packages/core/src/config/plugin/skill.ts:38–47` 直接将 update.path 发布给自身 PubSub，`:154–180` 重读技能、在 `:163` 替换 loaded.skills 后 ctx.skill.reload，不经过 Config.reload 的配置视图发布屏障。`:187–193` 的 config.updated 重扫也会重新读技能。只在 config.ts 插 beforeConfigChange 不能观察或阻止这条真实 skills 变更，更不能保证 block 后其他配置重扫仍保留旧技能视图。

该结论是对已命名两处生产调用链的只读核对（`nl -ba packages/core/src/config/plugin/skill.ts` / `config.ts` 与冻结表），未实现不充分的端口、未改 engine、未改冻结设计/§10，亦不在 ext/config.ts 再造一份技能解析或状态缓存。**建议的最小接缝增量**：签名/DTO 不变，将同一个 S-04 beforeConfigChange 的生产点明确扩至已接管的 ConfigSkillPlugin.refresh 发布边界，source="skills"、实际 filePath/occurrenceId；由该原生技能有效视图权威保留被拒文件的旧值，覆盖其 watcher 与 config.updated 重扫，避免同一修订重复事件/从旁路加载。项目同意/托管策略规则不变；engine 增量须在对应实现提交补 project-opencode-config-trust / plugin-hook-config-change 的 §10/registry 归属。仅“文件已是既有 L3”不足以替代本派发冻结的精确 S-04 调用位置，等待编排裁决后继续。

本轮已绿相关集合去重 **330 pass / 0 fail**，12 个有限原测试文件：host 83、policy 78、identity 21、package-process 3、installer 50，共 235；一次较宽 ext 七文件最终 95（先 94 pass/1 fail 的唯一 setup mock 由配套同步闭合，最终完整 host/setup 两文件 84 中仅新增计算 setup 1，其余六文件 94 沿原绿结果）。日志分别为 `/tmp/plugin-standard-r13-{permission-complete,scope-complete,failure-complete,scope-observer-complete,ext-related}.log` 与三个阶段的 install 日志；具名红/绿、迭代和移除臂不累加。r12 的 530 是另一个相关集合，本轮没有为对齐总数复跑 source/converter/未改变 artifact 读者。继承 r11/r12 accepted 整树 15/15、engine 8 pass，不计为本轮新运行。

**12 个移除臂全红**（临时 child-only preload，不改磁盘源字节）：request-stage、request-deny、request-allow（两条轴均红）、expansion-stage、scope-activate、scope-filter、scope-release、scope-Stop、source-absolute、scope-environment、tool-failure、execution-failure。命令 `python3 /tmp/plugin-standard-r13-removal.py`；每臂实际命中 production boundary 并经原具名行为断言变红，记录 `/tmp/plugin-standard-r13-removal-results.json` / `removal-summary.txt`。scope-filter/release 由真实 DATA 进程标记辨别，避免原脚本的自身 no-op guard 造成空观察。没有添加计时、容量或 sweep 运行。

ext、ui-mac 包内 `bun typecheck` exit 0（`/tmp/plugin-standard-r13-failure-types2.log`、`/tmp/plugin-standard-r13-ui-types.log`）；conversion 与 artifact `--check` exit 0（20 files），`git diff --check` exit 0；docs-contract 单仓临时 Alpha profile，`--changed-since 1db6a3bbf5 --format json` exit 1，仍 **71 errors / 250 warnings**（`/tmp/plugin-standard-r13-docs.json`），按派发保留基线。`affected-tests --list` exit 0，scope **all tests: scripts/gate-files.tsv changed (gate or declared global input)**，678 个 PR 文件（`/tmp/plugin-standard-r13-affected{,-scope}.txt`）；只同步派发允许的现有精确计数行，没有运行全清单/全层/gate run/bin/check。hooksPath=`.githooks`。

| 真样包 / 行 | r13 实际证据与仍未越过的边界 |
| --- | --- |
| Claude Security | 原 unanswered（只去 60 秒等待）在审批卡前 deny；原 turn/bound 脚本经命令展开、同一真实 prompt_id、技能作用域和普通下一轮退出通过；配置状态仅进临时 DATA。guard/banner/异步 metrics 的整包回放仍未做，不冒称 SDK/SaaS 已验。 |
| dash0 | 原 24 声明仅改观察命令，真实 tool failure 与 execution failure 各一次、错误字段及无普通 Stop/恢复通过。其余有时机事件的完整回放待 S-03…S-07，五项正式 unavailable 原因继承。 |
| ralph-loop | 原 Stop 继续/结束继承；新增实际继续轮内权限保留、真正结束后释放通过。 |
| code-modernization | PostToolUseFailure / StopFailure 运行挂点已接通，原 telemetry.sh/py 只读核对为本地计数/std-lib；原六 handler 回放尚未运行，不能将它标作 SaaS/toolchain 阻塞。 |
| Langfuse | 实际 option/default/secret/DATA/stdin 子进程证据继承并加 SKILL_DIR；原 Stop/SessionEnd hook 全运行仍未验，未声称已到 SDK/uv/SaaS 边界。 |
| Convex | lint 继承 accepted；monitor 激活/通知/离场取消尚未接通。 |
| Stripe | S-08 PostToolBatch 与原脚本必中采样运行尚未做。 |
| PayPal / hookify | r12 accepted 原 prompt / Pre/Post 行为由本轮完整 host 继续覆盖；未扩大为其余未实施生命周期的通过。 |

Host aggregate 保持 **9eaf52305a08ccdf6cbba6131c6573228f304e6316671f510b952fc48c3668b7**；相对 a9fe51d2ba **无 artifact 成员或清单变化**（`/tmp/plugin-standard-r13-host-artifact.json`）。未改 consumer pin/vendor，原 checkpoint 仍归编排器。

已核 Codex（GPT-6），spec v5 / design v3.1 + 已接受 rulings。本轮返回 **SEAM-CHANGE-NEEDED（S-04 skills 生产点）**，片 3/4 accepted 继承，片 5 只按上文增量通过。后续仍有 S-03 完整 leave/notification/FileChanged/子助手、S-04…S-07、其他 prompt 事件、S-08、monitors 与剩余包运行验收；未开始片 7。23:19 至 23:50 UTC+08:00 约 31 分钟，16 文件、555 additions / 115 deletions（本收口文字前，含 tests/docs）；未达原片 5 规模/工时两倍，本次停止原因是上述冻结接缝而非扩大工时。无新依赖、迁移、公开 DTO 或 engine 接管；必要表外文件仅 setup-order.cases.ts 的原 mock 形状同步。遗留去向：S-04 交编排裁决；其余片 5 fix now 续本车道；host checkpoint 交编排器；docs 基线/三条旧 command-subagent 断言沿原归属。无新增 ARCH / OPTIONAL 或仓外写操作。

### r14｜S-04 原生配置/技能发布边界

核对：IMPLEMENT — r14 / orchestrator Claude Opus 5.5（2026-11-27）接受 skills watcher/rescan 的 S-04 最小增量；spec v5 / design v3.1 及前述 rulings 不变。

偏离记录：**orchestrator ruling 2026-11-27** 将 S-04 同一 `beforeConfigChange` 调用扩至 `core/src/config/plugin/skill.ts` 自身发布链，覆盖 watcher 与 config.updated 重扫；拒绝只保留此前有效内容，签名/DTO 不变。`project-opencode-config-trust` 与 `plugin-hook-config-change` 在实现提交同时登记精确既有 L3 增量；设计 §10 的镜像归编排器。本轮新增私有 `config/codepuppy-plugin-config-change.ts` 是两处调用共用的文件修订选择器，不复制原生 trust/parser，不是第二份配置注册表。原 native 测试的 fixture 设置从跨包 converter import 改为该模块原有 upstream SKILL.md 字节，断言未改；消除新引入的 UI converter typecheck 范围，包格式/实际 dash0 由 ext 原 integration 覆盖。

红先：ba141d926b 的 Location runtime 共享槽用例 0 pass/1 fail；91f898440d 的三个 native config/skill/managed 用例 0 pass/3 fail（未通知/超时）；37df51ee62 的实际 dash0 声明变体 0 pass/1 fail（没有 runtime port）。日志 `/tmp/plugin-standard-r14-{port-red,core-red,config-host-red}.log`。增量口仍使用已有 `./*` workspace 子路径；跨 bundle 同 Symbol 槽、directory/workspace 隔离、旧代 dispose 不撤新代。

S-04 / AC-11/13/15/25：core 在原生变量展开、当前项目信任过滤和 parser 前选择 raw revision；拒绝后其他配置更新/技能 rescan 仍读旧字节，磁盘新内容保留；同一修订维持 occurrenceId。初次加载不伪造 ConfigChange，后续实际变更才调用。托管设置有通知但不受 apply=false 控制。ext 在真实 prompt 建立会话生命周期，通过同一 hook runner 执行 ConfigChange，给实际 source/file_path；同步 block/exit2 返回当前发布决定，不在 reload 内重入新配置。每个活跃 handler/会话/修订复用其结果；关闭会话清理，包停用/切代不再选其贡献，旧拒绝可释放。未接通的 S-05…S-07 端口保留冻结的无贡献默认，不报告 runtime-ready。

完成步骤相关文件：`packages/core` 的 `bun test --max-concurrency 2 test/config/reload.test.ts` **16 pass**；`packages/ext` 同命令 `src/plugin-host.test.ts` **84 pass**；`packages/plugin` 同命令 `test/codepuppy-package-runtime.test.ts` **2 pass**，共 **102 pass / 0 fail**，具名迭代不累加。对应 `/tmp/plugin-standard-r14-{core-complete,config-complete,port-complete}.log`。core/ext/plugin 包内 `bun typecheck` exit 0（core 第二次修正 SkillScan 的 string 路径集合；临时引入的 UI fixture import 去掉后无新类型错误）。native reload 文件属于既有上游测试目录，不在当前 PR selector 的 core roots；ext 真实 runner 和 plugin 槽用例在原 PR integration 文件内、imports 可追踪，没有改 `.gate-tests` 或拓宽门控根。`scripts/gate-files.tsv` 只同步已批准 host 83→84 精确计数。

S-04 五个移除臂全红：config-before-publish（配置/技能两例均红）、skill-before-publish、managed-authority、config-handler、config-revision-once。`python3 /tmp/plugin-standard-r14-removal.py`，每臂 child-only preload 实际命中唯一生产边界，日志与退出记录在 `/tmp/plugin-standard-r14-removal-{summary.txt,results.json}`，磁盘源文件未改。新增行为无需真实 SaaS、无真实凭据/工具链启动。

### r14｜S-08 真实工具批次与 Stripe 原脚本

S-08 / AC-11/13/22：f1fe2f8f41 新增原 host integration 红测，真实同一 assistant 的 Read 成功/Write 参数校验失败后无批次文件（0 pass/1 fail，`/tmp/plugin-standard-r14-batch-red.log`）。现在从原 session.context 的终态消息读取输入/响应/实际 error；只有整批终态才运行，按模型调用顺序交已有 policy 源身份投影，包含没有成功 execute.after 的调用。awaited context 在下一请求前写入同一上下文；idle drain 复用同一 pending/complete 状态，文本/阻止需要继续时走原 synthetic。空批次不发，初始真实历史作恢复水位，普通后续 prompt 不重放。stateless/没有实际 prompt 生命周期的 context 不读不存在会话，保留原有模型准备调用路径。

完整 host **85 pass / 0 fail**（`/tmp/plugin-standard-r14-batch-complete2.log`）；ext/ui-mac typecheck exit 0。首次整文件的五个原直接 context 测试暴露上述无 prompt 路径，修在生产边界，未改断言；具名六例与最终整文件均绿。四个移除臂全红：batch-stage、batch-context-barrier、batch-complete-once、batch-failed-calls；`python3 /tmp/plugin-standard-r14-batch-removal.py` / `batch-removal-results.json`，child-only preload，未改源字节。本步 84→85 精确 gate-files 计数，仍为原 integration，未新增全 PR 测试根或 engine 接管。registry 的 plugin-hook-tool-batch 为冻结 S-08 L0，无 runner/step.ts 接管或 afterToolBatch 端口。

**Stripe 实际一次性验收**：`bun test --max-concurrency 2 /tmp/plugin-standard-r14-runtime/plugin-runtime.test.ts -t 'one-time original Stripe'`（ext 包内）**1 pass / 0 fail**，`/tmp/plugin-standard-r14-stripe-runtime2.log`。保留固定原 `postToolBatch.mjs` / helpers / feedback 正文，仅抽样常量 0.001→1，并以同协议本地真实 MCP echo 代替 SaaS URL；只选本次原 PostToolBatch 声明。真实 MCP call 后，原脚本实际由 AppProcess 启动，下一模型请求同时收到源 feedback 与用户提交前须批准的原文。没有 Stripe 登录、网络工具或 CLI feedback 提交；SaaS/Stripe CLI 真业务仍是外部验收边界。临时复制的 host harness 位于 /tmp，未把整包旅程加入 PR 套件。首次临时 runner 未解析包级 @ai-sdk/provider 依赖（未执行 case），将 /tmp 的依赖 symlink 指向 ext/node_modules 后通过，无依赖/锁文件改动。

局部顺序偏离：S-04 后先闭合可独立验证的 S-08 L0 与 Stripe，S-05…S-07 未改合同、未冒充通过，仍续片 5；不开始片 7。

### r14｜S-06 采用/发布边界及原 telemetry/Stop 验收

S-06 / AC-11/13/22：09271de2f1 的原 native compaction 文件两例先红（0 pass/2 fail）；c3067eab60 的真实 host 用例先红（provider 在应被 veto 前已被调用）；1e708509b6 的预计算采用用例用 child-only 原 HEAD compaction 重放先红（0 pass/1 fail）。现在只在原 compact() 实际需要采用前 await PreCompact，覆盖手动/自动/overflow 与采用 held summary；尚未消费 held summary，不重写预算/重试算法。手动拒绝进原失败渠道、自动拒绝 skipped、overflow 为具名 compaction.blocked。publish() 成功持久化后 await 通知，opaque native window 不造 summary；后台预计算不发 hook。外部通知异常只诊断，不回滚已经提交的原生窗口。

PackageRuntime 只查当前真实 Session.location，无新增服务依赖/DTO；初版类型检查指出新增 Location 服务未声明，先补 node 后又收敛为实际 Session 自带 Location，原直接 layer 消费者不需扩合同。native 文件 **7 pass** 与原 manual Session.compact 文件 **3 pass**（`/tmp/plugin-standard-r14-compact-core-related.log`）；summary 原文件只跑新采用及手动/既有 hook 三例 **3 pass**（`compact-summary-final.log`），未运行该文件其他容量/缓存时间案例。完整 host **86 pass**（`compact-host-complete.log`），ext/core typecheck exit 0。native 观察回调另记录发布状态并在回调外断言，避免通知的错误隔离吞掉测试中的断言失败；移除 post 顺序即红。

六个移除臂全红：compact-before-decision、compact-post-publication、compact-precomputed-phase、compact-pre-stage、compact-post-stage、compact-after-order（`python3 /tmp/plugin-standard-r14-compact-removal.py` / `compact-removal-results.json`）。新增精确 L3 只有 session/compaction.ts；registry / ADR-047 / north-star 原 allowlist 同提交登记，S-04 reload 与 S-06 两个原模块测试成对登记，不改 gate 算法。native summary/native 测试不在 PR core runner roots，ext host 的真实执行链仍在原 PR integration 文件，gate-files 85→86。必要同调用链表外文件：setup-order.cases.ts 的原通用 mock 为新增 session.list 读操作返回真实 `{data:[],cursor:{}}` 空形状；顺序断言未改（原 related 8 pass/1 fail，修后该文件 1 pass）。

**code-modernization 实际一次性验收**：ext 包内 `bun test --max-concurrency 2 /tmp/plugin-standard-r14-runtime/plugin-runtime.test.ts -t 'one-time original code-modernization'` **1 pass**（`/tmp/plugin-standard-r14-modern-runtime2.log`）。固定原六条 telemetry.sh command/state/run/health/failure 在真实 session/user prompt/普通 Stop/tool failure/provider failure 中实际执行，七条 stdout metrics 的所有值均为数字，含 rules=3 与真实失败 api 计数。用固定上游 `test_telemetry.py` 的 workspace() 构造其原样本项目，不运行其测试套件；包 scripts 正文未改，外围观察器保留 stdin/stdout/exit。首次 probe 的自建 install fixture 没建 DATA，观察器写标记失败；补建同一 host helper 算出的临时 DATA 后通过，生产逻辑/断言未放宽。in-process UI module 仍是明确排除，不 import/执行；无网络和真实凭据。

**Langfuse 实际一次性边界**：同一临时 runner `-t 'one-time original Langfuse'` **1 pass**（`/tmp/plugin-standard-r14-original-runtime.log` 中另一个 telemetry fixture 先失败，不把整次命令标全绿）。原 Stop shell 与 langfuse_hook.py 正文未改，以明确的 `/usr/bin:/bin` PATH 验证源 Python fallback、清空 auth env、state 指向本包 DATA。真实日志说明缺少 langfuse SDK/uv PATH（原 fail-open 路径）；未安装外部 Python SDK、未用真实 Langfuse key 或发 SaaS trace，不将这个受控 fallback 称为默认 app PATH 的全链验收。SessionEnd 仍待 S-03。

相关回查：项目 trust 原两文件 **20 pass**，takeover/同步/本地 parity 五个原文件 **95 pass**。独立 north-star guard exit 1，现只剩本轮未改的 `packages/client/src/promise/generated/types.ts`、`packages/schema/test/mcp.test.ts`；`git diff 4e31bc4a3b -- <这两文件>` 为空，未扩大调查/修复它们，去向为编排器已有分支登记。core/ext/ui-mac/plugin 类型检查均 exit 0；conversion/artifact --check exit 0（20 文件）。Host artifact aggregate 仍 9eaf52305a08ccdf6cbba6131c6573228f304e6316671f510b952fc48c3668b7，成员/清单相对 r13 无变化。

### r14｜会话 monitors 与 Convex 原命令

AC-11/13/14/20/24/25：2c2d5677ff 的 Convex 声明变体先红（未启动任何 monitor），c641c79fcb 的首条输入直接 invoke 变体也先红（尚无 prompt epoch）。现在真实 prompt 才登记 always；真实 Invocation（包括第一条输入）建立会话活跃期并只启动指定 skill 的 monitor。以 packageId/entryId/sessionID 管一实例，换代/配置更换另查活跃所有权；同一会话普通后续 prompt 不重复启动，skill 的本轮 scope 结束后 monitor 继续归会话。hook 与 monitor 复用同一个 processSource/ROOT/DATA/OPTION/秘密表、原 core binding 和 AppProcess，不增加 parser/进程后门。

stdout 的 CRLF/LF、最后残行经已有流执行器进入原 synthetic/inbox，同名输出沿源 monitor 名展示并唤醒同一任务；stderr 不变成正常通知。包关闭/换代/移除、会话原 close 和 Location disposal 取消同一资源表的进程，异步启动前/排队行投递前再查代与会话有效性；非零退出用原脱敏诊断，不无限重启。新 registry `plugin-session-monitors` 为 L0。Notification hook 的宿主统一出口仍属未完成 S-03，不把 monitor 的原生 synthetic 通知等同该完整事件已接通。

完整 host **89 pass / 0 fail**（`/tmp/plugin-standard-r14-monitors-complete.log`）；installer **50 pass**（`monitors-install.log`）；ext/ui-mac typecheck exit 0。新增三个有限原 integration 用例分别证明 design 的两个进程/无 quickstart/真实流与残行/关包杀树和迟到丢弃、首条 skill 输入、always 不随安装与 session.create 启动且后续 prompt 不重启。来源为固定 Convex monitors.json，仅替换命令作有限观察程序或令一个原声明缺省 when；没有把 hand-written 外部协议当真实格式。gate-files 86→89 精确计数，仍在原 host 文件，不改 selector。

六个移除臂全红：monitor-ready、monitor-invocation、monitor-skill-filter、monitor-once、monitor-notification、monitor-cancel；`python3 /tmp/plugin-standard-r14-monitor-removal.py`，结果 `/tmp/plugin-standard-r14-monitor-removal-results.json`，每臂确认实际注入，源盘未改。加前述 S-04 五臂、S-08 四臂、S-06 六臂，本轮 **21 个移除臂全红**。

**Convex 原命令一次性验收**：ext 包内 `bun test --max-concurrency 2 /tmp/plugin-standard-r14-runtime/plugin-runtime.test.ts -t 'one-time original Convex'` **1 pass / 0 fail**（`/tmp/plugin-standard-r14-convex-original.log`）。原五条 monitor 命令正文保留，仅前置 temp PID 观察；首条 design Invocation 实际启动 runtime-errors / occ-insights 两条原 shell 循环，其余 quickstart 三条不运行。项目无 .env.local，实际走源自保护，无 npx/凭据/云请求；关包后两条原进程树退出，模型请求仍只有真实任务的一次。真实已关联部署的 npx 日志/insights、云权限与业务数据为外部验收边界；主动吐行的受控命令变体另证明宿主通知，不冒称静默原 guard 产生过 SaaS 错误行。

### r14 收口｜PARTIAL，续片 5

本轮去重相关集合 **294 pass / 0 fail**：host 89、native config reload 16、Location port 2、native/manual compaction 两文件 10、summary 具名三例 3、ext process/registry/setup 三文件 9、project trust 两文件 20、takeover/同步/parity 五文件 95、installer 50。具名迭代、初始红、移除臂、一次性实样与重复步骤的整文件不累加；计数清单 `/tmp/plugin-standard-r14-final-counts.json`。core/ext/plugin/ui-mac 包内 typecheck 通过；没有全包/全层、计时/容量 sweep、gate run、bin/check 或 app/Electron/window 启动。21 移除臂与四条已命名实样正向证据如前；Langfuse 的 positive case 来自混合初始 probe 中的 1 pass，整个初始 probe 曾因 telemetry fixture 缺 DATA 为 1 pass/1 fail，已明确区分。

最终 `affected-tests --list` scope：**all tests: scripts/gate-files.tsv changed (gate or declared global input)**，**678 个 PR test files**（`/tmp/plugin-standard-r14-affected{,-scope}.txt`）；仅列出，不执行全清单。docs-contract 单仓 Alpha profile、changed-since 1db6a3bbf5：仍 **71 errors / 250 warnings**（`/tmp/plugin-standard-r14-docs.json`），按派发保留基线。独立 north-star 仍报本轮未改的 generated client types / schema mcp test 两个旧接管登记缺口，去向交编排器，不改它们。`git diff --check` 通过，hooksPath=.githooks。Host aggregate **9eaf52305a08ccdf6cbba6131c6573228f304e6316671f510b952fc48c3668b7**；20 成员/manifest 相对 r13 均未变，consumer pin/vendor 未动，跨仓 checkpoint 仍归编排器。

| 真样包 | 本轮已实际观察 | 尚未验证/接通，不冒称整包 runtime DONE |
| --- | --- | --- |
| code-modernization | 六原 telemetry handlers，七条数值 metrics，含真实普通/工具失败/provider 失败阶段 | in-process UI module 明确排除；不声称运行它 |
| Langfuse | 原 Stop shell/Python fallback 实际到缺 SDK 的 fail-open 诊断，state 进 DATA；OPTION/default/secret 的 process 判据继承并在相关集覆盖 | uv/SDK 安装与真实 SaaS trace 是外部验收；SessionEnd 尚待 S-03 |
| Convex | 原 design 两条 monitor shell 循环实际启动、自保护与关包杀树；受控真实声明变体证明输出、残行、scope、首条 invoke/always/关闭迟到结果 | 已关联部署的 npx auth/logs/insights/featureRequests 为外部验收；原 quickstart 三条未单独回放，不声称收到云输出 |
| Stripe | 原 PostToolBatch.mjs 经真实本地 MCP 调用在下一模型请求前输出反馈，抽样率唯一改成 1 | 未提交 CLI feedback、未连 Stripe SaaS；不把本地 echo 当 Stripe 业务 |
| dash0 | 固定原声明的 ConfigChange/PreCompact/PostCompact 观察命令变体，经真实 watcher/admission/compaction 发布通过；失败事件继承 r13 | 其原采集脚本整包回放与未接通事件仍未完成 |
| Claude Security | accepted 原 unanswered/turn/bound 的真实 host 行为由完整 host 继续覆盖 | guard/banner/metrics 的其余整包回放仍未做 |
| ralph-loop / hookify / PayPal | accepted 原 Stop、Pre/Post、prompt 行为由完整 host 继续覆盖 | 不把这些证明扩大为未接通的其它生命周期 |

**下一轮精确状态**：S-04 已按 r14 ruling 完成；S-06 与 S-08 完成，monitors 原进程/会话 wiring 与本轮范围证据完成。片 5 仍有 **S-03** 的真实 leave/SessionEnd（含 main 在释放前 await）、统一 Notification、FileChanged/CLAUDE_ENV_FILE、完整 SubagentStart/Stop 来源字段；**S-05 InstructionsLoaded** 的真实 source/admission；**S-07 Elicitation/Result** 的 HTTP/SSE 会话与 stdio in-flight 归属；其余获准 prompt 事件与上表剩余原脚本验收。未开始片 7。无新设计裁决/公开合同问题被擅定；所有实现仅消费原 v3.1 与已接受 ruling。

已核 Codex（GPT-6）。本轮 2026-11-26 23:53 至 2026-11-27 00:42（UTC+08）约 49 分钟；截至本收口前 19 文件、868 additions / 84 deletions（含红测、原测试、registry/ADR/docs）。必要表外私部 helper 与 mock 同步原因已逐步记录；无新依赖/迁移/仓外写。遗留去向：剩余片 5 fix now 续本车道；两个旧 north-star 登记缺口与 host checkpoint 交编排器；docs 基线/三条旧 command-subagent 断言仍归原处置。无新增 OPTIONAL；本轮状态 **PARTIAL**，不将片 3/4 的 accepted 或本轮局部证明标作片 5 全部完成。

### r15｜继续片 5 与 S-12 配套登记

核对：IMPLEMENT — r15 / orchestrator Claude Opus 5.5，accepted r14 PARTIAL；片 5 原计划继续，spec v5 / design v3.1 + 已接受 rulings 不变。

派发要求的一次基线核查：相对 1db6a3bbf5，generated Promise types 有两处 transport 可选字段，schema mcp.test 有原 round-trip/非法值用例；分别由本车道 513e35a7c6 / 27595818cb 引入，确属本车道登记遗漏。原 guard 红输出 `/tmp/plugin-standard-r15-north-star-red.log`。在原 plugin-mcp-transport / ADR-047 与精确 allowlist 补登记这两个配套 artifact/proof；不改它们的字节/断言，不把配套文件误作新的 runtime L3，也不改 gate 算法。这修正 r14 将其移交编排器的处置，既有 SSE 决策未变。

S-12 登记修后：schema 原文件 3 pass、registry 原文件 5 pass，独立 north-star exit 0（`/tmp/plugin-standard-r15-{schema-proof,registry-proof,north-star-green}.log`）；没有重跑 SSE/engine 套件。S-05 定点只读事实：InstructionDiscovery.File schema 只有 path/content，editor.add 重建 File 且 load 用 Files codec；原生 constructor+codec 探针输出只有这两字段（没有元数据）。现阶段不在 ext/进程 Map 另造来源权威；保留该接缝核对，先完成独立行。

**剩余 prompt 事件的部分实现及验证阻塞**：`10b72352ac` 单独提交既有 host integration 文件的十条回归，格式从固定 PayPal hooks/hooks.json 取原 prompt/group，按事件轴调整，Expansion 用真实 feature-dev 命令。生产未改时 `bun test --max-concurrency 2 src/plugin-host.test.ts -t 'package prompt (Stop|PostToolUse|PostToolUseFailure|UserPromptSubmit|UserPromptExpansion|PermissionRequest|PostToolBatch)'` 为 **0 pass / 10 fail**（`/tmp/plugin-standard-r15-prompts-red.log`）。当前生产增量将 prompt 的 entry/batch 终止、post 反馈与 Stop 判定分开：已完成的 PostToolUse 不抛回工具执行错误；PermissionRequest 无权限决定；失败反馈继续原任务；UserPromptSubmit/Expansion 与 batch 不受 continueOnBlock 放宽。SubagentStop 仍待 S-03 的真实父子归属，不提前标 runtime-ready。

同一命令当前 **6 pass / 4 fail**（`/tmp/plugin-standard-r15-prompts-green.log`）：通过的是 PostToolUse 结束当前轮且保留完成写入、PostToolUseFailure 反馈、Expansion 拒绝、PermissionRequest 两种 judgment 均保留真实审批、PostToolBatch 结束当前轮。四红均由本人新测的三处观察断言阻塞：plugin-host.test.ts:2719 两个 Stop 将已有 JSON 载荷再次 stringify 后匹配未转义双引号；:2741 的 continueOnBlock=true 将临时模型反馈要求为持久 Session history；:2775 的 Submit 用 JSON.stringify(Exit) 读取不可枚举 Error.message。Stop 两例在失败前的请求数 4/2 与零工具断言已过，但不据此宣称整例通过。**不是产品应当新增持久记录或可枚举 Error 字段的理由**。delivery-implement §2 明确要求错误断言返回 BLOCKED、不编辑已提交红测；因此保留三处原断言，不伪造全绿，也不继续扩大实现。需要编排器裁决是否允许修正这三个观察点，随后按原业务语义重新验证。gate-files 89→99 仅同步现存用例数量，99 不是 PASS 数。收口按规则完整运行该行为文件一次，`bun test --max-concurrency 2 src/plugin-host.test.ts` 为 **95 pass / 4 fail**（`/tmp/plugin-standard-r15-host-complete.log`），原 89 例无新增红。未完成较宽相关集和移除臂，不能继承 r14 的通过数充作本轮结果。

**S-05 所需接缝增量**：冻结 §6/§10 只具名 `config/plugin/instruction.ts`、`session/instruction-state.ts`、`session/instructions.ts` 三处。实际来源值必须经过 `core/src/instruction-discovery.ts:11` 的 File schema、:65 的构造及 :82 的 codec；额外来源字段在此被删。`SEAM-CHANGE-NEEDED: S-05 — 允许同一 InstructionDiscovery.File/schema/editor/codec 保存来源元数据，并由已授权 producer/admission 传递；不新建平行来源表。` 三处原端口尚未实现，纯 AGENTS 不冒充 CLAUDE 加载。

**S-07 所需接缝增量**：固定 `plugin/src/codepuppy-package-runtime.ts:53` 只有 ext 注册/core 调用的阶段回调，无 ext 实际 SessionEnd 时调用 core 的释放口；主进程 S-03 leave 也不是 core archive/delete。设计要求 remote transport 随真实会话释放，不能以 idle/每次 call 关闭代替，更不能另起 stdio 单例。`SEAM-CHANGE-NEEDED: S-07 — 在同一 Location 进程槽允许 core 注册会话 MCP 释放函数，ext 在真实 SessionEnd cleanup 时 await；签名/登记由编排裁决。` stdio 的 SDK 真实 elicitation 探针先存 `073abfde30`，0 pass / 3 fail，随后自身测试提交以 `1eef3269d5` 撤回，避免留下无法闭合 remote 生命周期的半套 engine 改动；原探针 `/tmp/plugin-standard-r15-stdio-red-proof.patch` / `stdio-red.log` 可复用，不算当前测试或 removal 证据。尚无 S-07 生产接管增量。

S-03 本轮只读核对实际 main leave/notification、native subagent progress、FileChanged 与 env-file 链，未实现，不能列为完成；其他原脚本验收继承 r14 的已证据边界，本轮未新增 original-script PASS。片 3/4 accepted 不重开，片 5 未完成，片 7 未开始。

收口检查：ext / ui-mac 的 `bun typecheck` 均 exit 0（`/tmp/plugin-standard-r15-{ext,ui}-typecheck.log`）；`generate-artifact.ts --check` exit 0，20 members 均通过，aggregate 仍为 `9eaf52305a08ccdf6cbba6131c6573228f304e6316671f510b952fc48c3668b7`，本轮改变的 artifact members 为 **无**。docs contract 保持原 **71 errors / 250 warnings**（`/tmp/plugin-standard-r15-docs.json`），不清理基线；`git diff --check` exit 0。`affected-tests --list` exit 0，scope 原文 `all tests: scripts/gate-files.tsv changed (gate or declared global input)`，列出 **678** 个 PR 文件（`/tmp/plugin-standard-r15-affected-tests.log`），仅列举，未运行全套。当前唯一测试通过数 **103**＝host 95＋schema 3＋registry 5，另有上列 4 fail；窄测不重复累加。本轮 removal arms **0**，r14 已接受的 21 不冒作新证据。

已核 Codex（GPT-6），依据版本不变，结论 **BLOCKED**：新回归的三个观察点需编排器明确处置；S-05/S-07 的最小接缝增量回编排裁决，S-03 与剩余实样仍属片 5 后续，未扩大到其他片。当前 prompt 生产增量保留为可恢复的部分实现，不作为全绿交付。必要表外文件只有派发明确授权的两个 S-12 登记缺口及 gate-files 数字同步；无新依赖、迁移、公开合同更改或仓外写。00:44 至 01:10 UTC+08 约 26 分钟，因明确规则停止，未达到原片 5 工时两倍。遗留去向：上述三项 fix now/编排裁决；docs 基线与三条旧 command-subagent 断言沿既有处置；host checkpoint 仍由编排器协调。无新增 OPTIONAL。

### r16｜片 5 裁决续作

核对：IMPLEMENT — r16 / orchestrator Claude Opus 5.5（2026-11-27）；spec v5 / design v3.1 + 已接受 rulings 不变。偏离记录：**orchestrator ruling 2026-11-27** 允许修正 10b72352ac 新增测试的三个观察点，逐例移除证明；允许 S-05 的 InstructionDiscovery.File/schema/codec additive 来源元数据增量；S-07 仍由既有 MCP 权威持有生命周期，不新增平行释放机制。设计 §10 镜像由编排器负责。

观察断言修正单独提交：Stop 从真实 user text 读取事件 JSON，PostToolUse 继续分支从下一轮 system context 观察反馈，Submit 用 Cause.pretty 读取原生失败原因。拒绝/继续、模型请求数、零工具及已完成写入断言保持。原十例 **10 pass**，完整 host 文件 **99 pass / 0 fail**（`/tmp/plugin-standard-r16-{prompts-green,prompt-host-complete}.log`）。四个受修正用例逐一有移除臂：prompt-stop-continue、prompt-stop-impossible、prompt-post-feedback、prompt-submit-entry，均 **0 pass / 1 fail** 且 child-only loader 命中生产边界（`python3 /tmp/plugin-standard-r16-prompt-removal.py` / `prompt-removal-results.json`）；未改生产代码来迎合错误断言。新增用例数量/层级保持，仍为既有 PR integration 文件。

S-05 值边界先行：`d4e629fb14` 单独红测，`bun test --max-concurrency 2 test/instruction-discovery.test.ts -t 'preserves instruction source provenance'` **0 pass / 1 fail**（`/tmp/plugin-standard-r16-provenance-red.log`）。按 r16 ruling，原 File 的可选 source 保留 packageId/sourcePath/scope（memory scope），同一 native constructor/editor/codec 传递，没有平行 Map；既有无字段调用不变。同提交登记 plugin-hook-instructions、ADR-047、north-star 的精确 runtime 文件及原模块 proof。源 parser/admission 事件另按后续真实阶段闭合，此增量本身不宣称已触发 InstructionsLoaded。

该步完整原模块 **14 pass / 0 fail / 1 skip**（既有 skip，`/tmp/plugin-standard-r16-provenance-green.log`）；移除 source schema 字段后同名用例 **0 pass / 1 fail**（`provenance-removal.log`）。registry **5 pass**、core typecheck exit 0（2,050 files）、north-star exit 0，分别见 `/tmp/plugin-standard-r16-provenance-{registry,types,north-star}.log`。没有扩大 PR roots 或增加用例文件。

S-05 源/admission：`a1381f20a9` 的两个 native case、`2faf7ef783` 的 dash0 实际 runtime case、`eac0cd31f5` 的配置来源 case 均分别先红。实现落在冻结的三个源/入上下文边界，与既有 `InstructionDiscovery.key` 同源；共同私部 notifier 只从 Session 原表取实际 Location/父子身份，发布成功后将该次新增/改变的 File 转至同一个 ext runner，不另存来源/事件账本。嵌套 loader 沿原 synthetic ledger 去重；初始 admission 比较前后原生 blob，避免每轮请求重放未改变文件。实际配置读取端用原 project/system 归属及文件名保留 memory scope，直接 AGENTS 不造 Claude 事件；已有 native parser 没给 include/globs/compact 的事实不伪造。`config/codepuppy-instruction-source.ts` 为初始/延迟共享的纯来源判定，`session/codepuppy-instructions-loaded.ts` 为两处已发布值共享的通知，均是同链所需的 Code Puppy 私部文件，没有增加服务或第二个 binding/parser。

原三个 native 文件最终 **36 pass / 0 fail / 1 existing skip**，完整 host **100 pass / 0 fail**（`/tmp/plugin-standard-r16-instruction-files.log`、`instruction-host-complete.log`）；registry **5 pass**、ext/core typecheck exit 0（`instructions-{ext-types,core-types-green}.log`）。核心类型检查首次指出新测试期望数组的 scope 被 TS widen 为 string；仅补 `as const` 字面量类型，期望值和断言行为未变。五个 source/admission 移除臂全红：initial-instruction-admission、nested-instruction-admission、instruction-source-once、configured-source-provenance、instruction-handler（`python3 /tmp/plugin-standard-r16-instruction-removal.py` / `instruction-removal-results.json`）；首次 probe 的 native 名称锚点匹配 0 条不计证据，改用原唯一用例名称后逐臂 0 pass / 1 fail。与先前 source schema 移除及四个 prompt 移除合计本轮 **10** 个有效红臂。新增精确 L3 与模块 proof 同提交登记，host gate-files 99→100 仅同步数量。

S-03 子助手 L0：`698b994073` 先红（1 pass / 1 fail）；原生 subagent tool 的 awaited progress 给出真实 child ID，在该 child 首次/恢复 prompt 前消费归属，包 agent 源名由既有 installed entry 映射。Start 的上下文只进入该 child；Stop 使用同一个既有 transcript 投影函数分别取父/子，block 沿该 child synthetic 继续，stop_hook_active 由其真实继续状态派生。普通 parentID 会话不冒充子助手。`bun test --max-concurrency 2 src/plugin-host.test.ts -t 'subagent hooks bind real child|normal session with a parent'` **2 pass**，完整文件 **102 pass / 0 fail**（`/tmp/plugin-standard-r16-subagent-{green,host-complete}.log`），ext typecheck exit 0。真实 feature-dev code-reviewer + 固定 dash0 声明，经 native 工具/模型执行验证 before-model context、父子 transcript、源 matcher 与子任务继续；仅观察 command 换为受控 fixture，不声称跑过 dash0 SaaS 上报。

五个子助手移除臂逐一 **0 pass / 1 fail**：subagent-first-prompt、subagent-source-identity、subagent-parent-transcript、subagent-real-invocation-only、subagent-stop-continuation（`python3 /tmp/plugin-standard-r16-subagent-removal.py` / `subagent-removal-results.json`）。累计 **15** 个有效红臂。登记只扩原 plugin-hook-lifecycle 的 L0，未改 engine、固定 DTO 或原生 subagent 的派发/模型/权限；gate-files 100→102。SessionEnd/Notification/FileChanged/ENV_FILE 仍待其真实边界，不将此行扩大为 S-03 全部完成。

**原 Claude Security guard 同链缺口**：固定 `hooks/hooks.py` 的 Guard.AGENT_PREFIX 为 `claude-security:`，而普通工具 hook 没有 agent_type，新增子助手元数据还只给 entry 短名。依 D4 的源输入合同，复用同一 installed entry 解析完整 Claude 源名，所有实际工具事件获得真实 agent_type，只有 native subagent 调用归属才附 agent_id；原 guard 在 Shell 执行前给 interpreter 的真实拒绝。`08e4d66f49` 首次红误在 probe 的 Code Mode 可见性，**不是有效 identity 红证据**；`132b446b4b` 只补既有 codemode:false fixture 注册约定，断言不变，真实红 **0 pass / 1 fail（Expected true / Received false）** 见 `/tmp/plugin-standard-r16-security-guard-red2.log`。修后 guard 与子助手具名三例 **3 pass**，完整 host **103 pass / 0 fail**（`security-guard-green.log`、`guard-host-complete.log`）。原 guard/sh/Python 正文不改，tool body 是原生 Shell schema 的零执行 probe，不运行有害命令。

片内新增子助手功能用例的源 identity 期望/fixture matcher 同步为 `feature-dev:code-reviewer`，替换 raw entry 短名，依据是真样本的源命名空间，而非改动 guard 回归的断言。sourceAgentType 私部函数为 root/child 的共同解析点。`guard-source-field` 与 `subagent-qualified-identity` 两个移除臂各 **0 pass / 1 fail**（`python3 /tmp/plugin-standard-r16-guard-removal.py` / `guard-removal-results.json`）；后者替代原 raw identity 臂，最终为 **16 个有效语义移除臂**，不把被替换的臂重复计数。登记仍为 plugin-hook-lifecycle L0，gate-files 102→103。

同链 K2 核对：本模块原 expansion 的源名格式与新增 agent 格式合为一个 `sourceInstructionName`，两个实际消费者共用，未导出新 API。具名五例（guard/子助手/普通 parent/真实 security expansion/prompt Expansion）**5 pass**（`source-name-final.log`），ext typecheck 和 scoped oxlint 均 exit 0；qualified identity 的移除证据同步到此共同 owner，仍是移除命名空间后业务断言变红，不计重跑次数。其余四条子助手边界未改变。

**实样一次性回放（AC-13/20/22/25/30 当前边界）**：临时 runner `/tmp/plugin-standard-r16-runtime/plugin-runtime.test.ts` 从当前 host harness 复用真实服务及原 fixture，不提交整包 replay 到 PR。新增 original-script 证据与永久回归计数分开：

| 实样 | 本轮实际结果 | 剩余/外部边界 |
| --- | --- | --- |
| Claude Security | 原 guard 的 sh/Python 正文在永久 host 用例实际拒绝 interpreter，native Shell schema probe 零执行；原 banner 经真实 skill command、hooks.sh → python_check.py → hooks.py 到模型请求，**1 pass**，日志 `original-runtime.log` 中 `SECURITY_ORIGINAL_BANNER_PASS`。 | accepted unanswered/turn/bound 由完整 host 覆盖；metrics/tip 尚未整包回放。scan 的真实 SaaS/workflow 与 live UI module 不冒称执行，后者明确排除。 |
| Convex | 原 quickstart 三条 monitor 正文仅前置 PID 观察；首条真实 Invocation 准确启动 runtime-errors-quickstart、occ-insights-quickstart、feature-requests，design 两条不启动；原进程在无 .env.local 时按源自保护，关包后全部退出，**1 pass**（`convex-quickstart.log`）。结合 accepted r14 design 两条，五条原 monitor 已到各自 guard/释放边界。 | 已关联部署、真实 npx auth/logs/insights/featureRequests 是外部验收，不将无部署的静默循环当云输出。未执行源 12/30/600 秒轮询周期或计时测量。 |
| dash0 | 原样本直接执行 command 失败 **126**（`original-runtime.log`，与 banner 的同次 probe 合计 1 pass/1 fail）。唯一确认命令核对 `standard/provenance.json:7326` 及 tar header，脚本均为 **0644**。仅临时 generation 改执行位 0755 的受控变体，原脚本正文不变，SessionStart/UserPromptSubmit/Stop 经真实 AppProcess 三次 0 exit，到达缺 curl/wget 的原 fail-open guard，**1 pass**（`dash0-mode-variant.log`）。PATH 使用真实 OS bash/uname/tr/mkdir/rm，没有 stub、采集器下载或遥测请求。 | 原快照不是通过；0644 与 direct exec 的源输入缺陷回编排器处置。变体只证明正文到外部采集器准备边界。其余已接通阶段由声明变体/native phase 永久用例覆盖，SessionEnd/Notification/FileChanged/Elicitation 两阶段仍待接通。 |
| code-modernization | 继承 accepted r14 六条原 telemetry handler、七条本地数值 metrics；本轮完整 host 相关行为仍通过。 | in-process UI module 排除，本轮未重跑原六条。 |
| Langfuse | 继承 accepted r14 原 Stop shell/Python 到缺 SDK 的 fail-open 诊断，状态在 DATA。 | SDK/真实 SaaS trace 为外部验收；SessionEnd 仍待 S-03。 |
| Stripe | 继承 accepted r14 原 PostToolBatch.mjs 与真实本地 MCP 回放到下一模型请求前的反馈。 | 抽样率 0.001→1 为已记录受控变体；没有真实 Stripe API/CLI submission。 |
| ralph-loop / hookify / PayPal | 完整 host 103 例继续覆盖已接受的原 Stop loop、Pre/Post、prompt/审批；新增 prompt 与子助手证据如上。 | 不将其扩大成未接通生命周期的整包通过。 |

**收口检查**：三层规则中的较宽相关集只运行一次：ext `plugin-package-process.test.ts plugin-setup-order.test.ts policy/authority-registry.test.ts` **9 pass**，core `plugin/session-instructions.test.ts instance-vanilla.test.ts` **3 pass**，ui-mac `install-from-source.test.ts package-admission.test.ts` **76 pass**，plugin `codepuppy-package-runtime.test.ts` **2 pass**。这些是本轮新调用点、私部返回接线及 readiness 的直接消费者/格式约束；没有选整个 runner、图像容量、缓存/计时或全层套件。日志 `/tmp/plugin-standard-r16-{ext,core,ui,port}-related.log`。最终去重永久相关集 **229 pass / 0 fail / 1 existing skip**＝host 103＋native instruction 三文件 36＋上述 90，窄测/各步骤重复不再累加；一次性实样的三个 positive 与原 dash0 的一项 FAIL 分列，不混入永久集。

core/ext/ui-mac 类型检查均 exit 0，八个 touched production modules 的 scoped oxlint **0 warnings / 0 errors**；最终源名公共 owner 的增量 lint/type 亦通过。日志 `instructions-core-types-green.log`、`ext-source-name-types.log`、`ui-final-types.log`、`lint.log`（均在 `/tmp/plugin-standard-r16-` 前缀下）。north-star exit 0，docs-contract 维持基线 **71 errors / 250 warnings**，不清理无关项。`affected-tests --list` exit 0，scope 原文 **all tests: scripts/gate-files.tsv changed (gate or declared global input)**，**678** 个 PR files，只列举（`affected.log`）。`generate-artifact.ts --check` exit 0，20 members 校验通过；host aggregate 仍 `9eaf52305a08ccdf6cbba6131c6573228f304e6316671f510b952fc48c3668b7`。本轮改变的 artifact members：**无**；相对 1db6a3bbf5 累计九项为 CONTRACT.md、plugin-package.ts、plugin-hook-events.ts、plugin-conversion.mjs、plugin-conversion.d.mts、generate-artifact.ts、profiles/plugin-package.v1.schema.json、testvectors/plugin-package-description.v1.json、testvectors/decoder-corpus.v1.json。consumer checkpoint/pin/vendor 仍归编排器。

**精确未完成状态**：r16 S-07 裁决指向“core 现有 session MCP release port”，但当前树 `core/src/mcp/index.ts:168` Interface 只有 server connect/disconnect/remove，`plugin/src/codepuppy-package-runtime.ts:53` 固定阶段槽亦无 Session 释放口，core/plugin 定点搜索未见该符号。本轮已异步请求给出文件/符号，或明确在原 MCP authority/同一 Location 槽将真实 SessionEnd 接到现有 connection.stop 的最小调用；未收到答复，不新造独立释放机制。S-07 的 HTTP/SSE 会话连接、stdio in-flight elicitation/Result 尚未实施。S-03 仍缺 main 真实 leave/SessionEnd 与释放前 await、archive/delete/shutdown 结算、统一 Notification、FileChanged watcher/watchPaths 与 CLAUDE_ENV_FILE；没有把普通审批拒绝冒充正式无时机的 PermissionDenied。Claude Security metrics/tip 与上述生命周期对应的原脚本验收仍待完成；未开始片 7。

已核 Codex（GPT-6），spec v5 / design v3.1 + r16 rulings；结论 **PARTIAL**。本轮完成观察点修正、S-05 与子助手/公共 agent 输入的所述证据，未宣称片 5 全部闭合。约 01:11–01:55（UTC+08）44 分钟；每个引擎增量同提交登记，唯一新增可选字段为已裁决的 File.source，无新依赖/迁移/仓外写。遗留去向：S-07 入口指代回编排器；S-03 其余行/未完原脚本 fix now 续本车道；dash0 的源快照执行位缺陷交编排器决定输入处置；docs 基线与旧 command-subagent 断言沿既有归属。无新增 OPTIONAL。

### r17｜S-07 裁决纠正与片 5 续作

核对：IMPLEMENT — r17 / orchestrator Claude Opus 5.5；spec v5 / design v3.1 及既有 rulings 不变。偏离记录：orchestrator ruling r17 明确不存在旧 session MCP release port，S-07 自身引入匹配 HTTP/SSE 的 Session 连接及其释放；stdio 仍复用 Location。最小同进程反向口只将真实 SessionEnd 的释放转交 core MCP authority，不另造 transport owner。

核心回归先红：`4625d8ff0d` 恢复真实 SDK stdio 探针，单调用/同会话并发/跨会话歧义 **0 pass / 3 fail**（`/tmp/plugin-standard-r17-stdio-red.log`）；`1bbb32a1a0` 用真实 native Session 与 SDK HTTP transport 的实际 open/close 观察 **0 pass / 1 fail**，期望按 Session 创建第二连接而实际仅 Location 一个（`remote-red.log`）。现有 McpConnection.make/stop 复用认证/fetch/锁/scope；核心同一 Session Map 持有连接，native archive/delete 按 Session ID 收尾。跨 Location 删除事件在原 Bus 上携带调用方 Location，订阅仅去掉该过滤、仍只处理本 owner 已持有的 Session，不重发或伪造事件。精确登记 plugin-hook-elicitation，既有 index/client/test 接管增量；connection.ts 直接复用而无新字节改动。无公网/DTO/依赖变化。

该步六条具名 MCP case **6 pass / 0 fail**（`/tmp/plugin-standard-r17-mcp-step-green.log`），包括未匹配 handler 不加连接及真实 Form→Result 保留 owner；core typecheck **2,052 files / 0 errors**，registry **5 pass**。gate-files 原 MCP 数字 24→32 机械同步当前实际 32 例（含此前两条 SSE case），不改 selector。真实 ext SessionEnd 及包 handler 的接线仍待后续，直接反向释放调用不冒称完整离开事件。

ext Elicitation 两条真实 host/SDK stdio 回归 `b22b897f72`：正确 fixture 后 **0 pass / 2 fail**（`elicitation-host-red.log`；原来 native Form 为 global，hook 无响应）。沿既有 AppProcess/D4 runner 接入 command Elicitation/Result：原 MCP 来源名 matcher、原始字段、未作答保留 Form、直接作答跳过 Result、Result 在送服务器前修改用户值，decline 优先；无人值守读取同一 hubBridge 名单，不绕过既有即时取消/补充信息合同。新增 factory 私部参数 unattended 只消费当前权威；没有新 profile/名单。两条具名 **2 pass / 0 fail**（`elicitation-host-green.log`），ext typecheck exit 0；整文件结果见本轮收口。readiness 只增加这两个已接线 command 事件，不冒称 SessionEnd/FileChanged 已可运行。

handler 撤回补漏：`f3831d18a5` 单独红测 **0 pass / 1 fail**，同一 server 定义未变时 reload 原先不释放旧会话连接（`/tmp/plugin-standard-r17-handler-off-red.log`）。reconcile 仍调用同一 releaseEntrySessions/connection.stop，只释放已无匹配 handler 的 owned 远程连接；Location 连接继续可调用，Location scope 关闭再收尾（同名 green **1 pass**）。整 MCP 文件最终 **33 pass / 0 fail**（`mcp-file.log`）；**本次测试范围偏离**：负向名称过滤只匹配了 full test name 的开头，describe 前缀使计时/容量用例未被排除，实际跑了整文件一次，违反本轮明确排除。已向编排器透明记录，不重复该文件或这些用例，不把这次误跑当扩大后续授权。core typecheck 另行记录实际输出。

S-07 释放 / S-03 接收端：`12b4d745ed` 先提交真实 native Session + SDK stateful HTTP 的整链红测与 bridge 屏障红测，分别 **0 pass / 1 fail**（`session-end-red.log` / `session-wire-red.log`）。私部 fixed main message 通过同一 parentPort listener 路由至 Session 的实际 Location，await 包 SessionEnd handler，再 await core 唯一 releaseSession/connection.stop，最后 ack；重复 leave 不重跑已关闭 lifetime。Cleanup await 活跃 lifetime，archive/delete 的 transport 仍由 native core subscription 释放。入口 get 只读 native PublicRef 的 directory，不新加公开 workspace 字段；已保留的同进程端口仍按完整 Location 区分。bridge 原文件 **14 pass**，实链具名 **1 pass**，最终 host/类型检查见收口。新增 stateful SDK helper 放在 Code Puppy 自有 core/test/fixture/codepuppy-mcp-session.ts，供 ext 观察真正协议 DELETE/close；无 core→ext/ui import。该纯 SDK fixture 是现有测试无法观察 stateless handler 关闭的同链所需文件，不新增测试文件/运行时抽象。初置 upstream mcp-echo.ts 时 north-star 如实拒绝；已将唯一 helper 移到自有 fixture、恢复 upstream 字节，仅同步两处 import，不增加接管/allowlist 或修改守卫。单独的端口跨 bundle/generation 例 **1 pass**，完整 plugin port 文件 **3 pass**。无人值守 native Session/stdio 例按现有名单禁止 before/Result 自动答复，原生 Form 被取消、服务器实际收到 cancel，**1 pass**；不在此复制 main 取消机制或伪造无人值守权限。

**没有冒称完整 S-03**：本步原生 SessionEnd + 生产 receiver 的测试仅替换 Electron parentPort 这两样 OS transport API；main 的真实导航/退出发送端、释放前 await 及统一 Notification 来源仍待接线。Notification 的固定消息模型随设计保存，但未开放该事件的 readiness 或伪造通知。FileChanged/watchPaths/CLAUDE_ENV_FILE 未实施。native 删除后不保证能再读已删除 transcript；需原 main 删除前 await 接线闭合 SessionEnd 原脚本，不能把 core transport 清理冒称完整 handler 验收。

r17 dash0 原样核查：官方 [Hooks reference / Exec form and shell form](https://code.claude.com/docs/en/hooks#exec-form-and-shell-form) 明确无 args 时 macOS/Linux 用 sh -c，路径仍由 shell 执行。一次性 `/tmp/plugin-standard-r17-dash0-shell.ts` 从固定 `72a84179e6c64871ad5b6fceb09e00f502de415a` 保留原 0644 提取到 /tmp，用 `/bin/sh -c` 执行原 `${CLAUDE_PLUGIN_ROOT}/claude/claude-on-event.sh`：**exit 126 / Permission denied**（`dash0-shell.log`），无 chmod、无采集/联网/真实凭据。该实样原样失败为包自身模式边界；r16 的 0755 变体仍仅为已明确变体，不升格原样 PASS。

本步最终 host **107 pass / 0 fail**（`/tmp/plugin-standard-r17-host-final.log`；新增无人值守用例的首次未提交版本曾再次 stringify 已有 JSON，其观察读取在提交前改为解析 SDK text 后为 1 pass，未改产品迎合）。bridge **14 pass**、port **3 pass**；core/ext/plugin/ui-mac 包内 typecheck 均通过，scoped oxlint 八生产文件 **0 warnings / 0 errors**。fixture 移至自有路径后仅重验两个实际消费者具名各 1 pass，未重跑 MCP 整文件或计时/容量例。

移除验证 `python3 /tmp/plugin-standard-r17-removal.py`：**14 个独立语义臂全红**，每臂 child-only loader 命中单一生产边界、0 pass / 1 fail，不改磁盘业务/断言（`removal-results.json`）：remote-session-selection、stdio-inflight-ownership、stdio-ambiguity-diagnostic、result-before-send、native-session-removal、handler-withdrawal、elicitation-handler、result-handler、session-end-hook、session-end-release、session-end-awaited-reply、unattended-before、unattended-result、release-generation。分别保护 native actual transport、真实 Form、包处理器、前后自动答复隔离和 generation 释放；不是旧红数的累加。

SSE 专属收尾追加一个既有 MCP 文件内的 integration case：沿现有 plugin-mcp-proxy proof 的同一已锁 Claude Agent SDK peer 取得真正 legacy SSE server，未手写 JSON-RPC、未新增依赖。`bun test --max-concurrency 2 test/codepuppy-mcp-runtime.test.ts -t '^explicit SSE keeps a session'` **1 pass**（`sse-session-green.log`）：专属流在使用时打开、SessionEnd 释放后关闭，Location 流仍可调用。core 包内 typecheck 通过；只运行新增具名例，不重跑前面的 MCP 整文件/计时例。`python3 /tmp/plugin-standard-r17-sse-removal.py` 同一选择边界的 SSE 单独对照 **0 pass / 1 fail**，总有效移除臂 **15**。本步仅 core test/registry/gate-files 数字 33→34 和私部 endSession 参数复用 fixed leave reason union，业务没有新分支。

### r17 收口｜PARTIAL，片 5 尚未全部完成

本轮推进 **AC-22 的 S-07 / SessionEnd 子行**，不把其他 accepted AC 重开，也不将部分事件的证据扩为完整 AC-22。最终去重相关集 **270 pass / 0 fail**（`/tmp/plugin-standard-r17-counts.json`）：host 107、MCP 33＋新增 SSE 1、bridge 14、Location port 3、原生 elicitation 具名 6、MCP generation/collision 两文件 6、ext process/setup/registry 9、installer 50、admission 26、sidecar messages 15。MCP 的 33 中包含前述 **9 个未获本轮授权的计时/容量用例误跑**；其余普通相关集为 **261 pass / 0 fail**，不隐去误跑、不重复或据此放宽后续范围。具名迭代、红测、重复完整步骤和 registry 复核不累加。移除臂独立 **15 个全红**，未计为 PASS。没有全包/全层/全项目、gate run、bin/check 或 app/Electron/window 启动。

相关集合是本轮 changed module 的现有真实调用者及格式/入口枚举：`mcp.test.ts -t '[Ee]licitation'` 只六例，`codepuppy-mcp-tool-{generation,collision}.test.ts` 两文件六例；ext 的 `plugin-package-process.test.ts plugin-setup-order.test.ts policy/authority-registry.test.ts` 共九例；ui-mac 的 `install-from-source.test.ts` 50、`package-admission.test.ts` 26、`codepuppy-sidecar-messages.test.ts` 15。查询 mock/import consumers 后无新增 test roots 或 `.gate-tests reads`；所有新增 case 在原有 PR integration/fast 文件内，临时原样 shell 验证只记录命令/输出，不增加永久套件。首次相关 UI 命令误写 shared 路径，因此实际只选中了 installer 50；随后只补跑正确 main/admission 26，没有重复 installer。

core/ext/plugin/ui-mac typecheck 全通过（最终 core **2,053 files / 0 errors**；其他包的 tsgo/bun check 均 exit 0），八生产文件 scoped oxlint **0 warnings / 0 errors**。north-star 在纯自有 fixture 收口提交后 exit 0，未放宽守卫或精确白名单；docs-contract Alpha 单仓 changed-since 1db6a3bbf5 保持基线 **71 errors / 250 warnings**，留给原处置。`affected-tests --list` scope 原文 **all tests: scripts/gate-files.tsv changed (gate or declared global input)**，**678** 个 PR test files，仅列举（`/tmp/plugin-standard-r17-affected{,-scope}.log`）。`git diff --check` 通过，hooksPath=.githooks；无 push/PR/merge/rebase、消费 pin/vendor 或真实凭据。

Host artifact `generate-artifact.ts --check` **20 members checked**，aggregate 仍 **9eaf52305a08ccdf6cbba6131c6573228f304e6316671f510b952fc48c3668b7**；本轮改变的 artifact members **无**。相对 1db6a3bbf5 累计九项：CONTRACT.md、plugin-package.ts、plugin-hook-events.ts、plugin-conversion.mjs、plugin-conversion.d.mts、generate-artifact.ts、profiles/plugin-package.v1.schema.json、testvectors/plugin-package-description.v1.json、testvectors/decoder-corpus.v1.json；跨仓 checkpoint 仍归编排器。

| 实样包 | 本轮及已接受证据 | 保留的边界/尚未完成 |
| --- | --- | --- |
| dash0 | 固定原声明的 Elicitation/Result 观察变体经实际 stdio 请求和原生用户表单分别运行；固定 SessionEnd 声明经真实 native Session + 生产 parentPort receiver 先 hook、关远程连接再 ack；HTTP/SSE 核心生命周期各有真实 SDK 连接。 | main 导航发送端未接；原 0644 脚本按原宿主 sh -c 也返回 126，是包自身模式边界，不 chmod、不称原脚本 PASS。 |
| code-modernization | 继承 accepted r14 六原 telemetry handlers / 七条数值 metrics。 | 未接通的 S-03 时机不宣称已回放，in-process UI module 仍明确排除。 |
| Langfuse | accepted 原 Stop shell/Python 到缺 SDK 的 fail-open 边界、OPTION/default/secret/DATA 的既有真实 process 证据；相关 process/install 文件继续通过。 | 原 SessionEnd 尚未整链回放；SDK 与真实 SaaS trace 仍属外部集成验收。 |
| Convex | accepted 原 design 两条与 quickstart 三条 monitor 的 deployment guard、进程输出/关包取消。 | 已关联部署的 auth/logs/insights/featureRequests 是外部云边界，本轮不复跑。 |
| Claude Security | accepted 原 guard/banner/unanswered/turn/bound 及真实工具链/source agent 身份由 host 文件继续覆盖。 | 原 metrics/tip 仍未运行，本轮只定点读源码，不把它当验收，也不伪造 gitOperation。 |
| Stripe | accepted 原 PostToolBatch.mjs 在必中变体与真实本地 MCP 后给同任务反馈，由 host 文件继续覆盖。 | 没有 Stripe SaaS API/CLI submission；受控采样变体保持明示。 |
| ralph-loop / hookify / PayPal | accepted 原 Stop loop、Pre/Post、prompt/审批的既有真实 host case 继续通过。 | 不扩张为尚无真实来源的 S-03 生命周期已完成。 |

**下一轮精确状态**：S-04/S-05/S-06/S-08 与 monitors 保持 accepted；S-07 新增连接/请求归属/前后 runner/stdio 歧义/无人值守隔离、会话移除/Location dispose/handler 撤回及 SessionEnd receiver 释放已具名验证。片 5 仍需 **S-03 main 真实导航/退出/删除前 await**（SessionEnd 原脚本必须在原 Session/transcript 可读时完成，不可拿删除后事件伪造）、统一 Notification 的实际来源与身份去重、FileChanged/watchPaths/CLAUDE_ENV_FILE（沿真实 shell source，不用 dotenv parser），以及对应其余 prompt/事件 readiness 与原脚本验收，尤其 Security metrics/tip、Langfuse SessionEnd 及未接时机。无新设计 fork 或擅定接缝，未开始片 7。遗留去向：上述片 5 工作 fix now 续本车道；docs 基线/三条既有 command-subagent 断言沿原处置；host checkpoint 交编排器。无新增 OPTIONAL。

已核 Codex（GPT-6）。本轮从 2026-11-27 01:55:58 UTC+08 开始；收口约 02:40 UTC+08，约 44 分钟。必要表外文件只有自有 SDK stateful test fixture（原模块无 stateful close 观察点，恢复 upstream 字节后没有新增 takeover），类型/fixture import 机械同步不改已提交红测的业务断言。无新依赖、迁移或仓外产品写。状态 **PARTIAL**，片 5 仍须继续，片 3/4 已接受结论不重开。

### r18｜S-03 来源与片 5 收口续作

核对：IMPLEMENT — r18 派发 accepted r17，spec v5 / design v3.1 + 已接受 rulings 不变；不开始片 7。先接 main 真实来源/等待，再 Notification、FileChanged/watchPaths/ENV_FILE 与未回放原脚本；每步保留既有 source/argv/权限/fence 权威，不新建全项目 watcher、通知计时器或环境 parser。

main 生命周期：`14c18583c4` 两例先红（新 private requester 缺失），`5cfaa76e07` 的真实 Solid router 例在未改 sidebar 时 **0 pass / 1 fail**（`/tmp/plugin-standard-r18-navigation-red.log`），`e196a4bfda` 主停机屏障例先红。实现只在 main 自有 `plugin-session-lifecycle.ts` 保存 renderer 已知 view Session ID 和该 engine 代的 request/reply；epoch/是否结算仍由 ext 唯一 runner 决定。preload 仅投影冻结 PackageSessionMessage 的 leave 域，没有额外 engine action/公共 RPC。Sidebar 的真实 router before-leave 在 canonical 本机 Session 上 await main，重复 retry 绕过自己的屏障一次；删除在现有 delete 调用前 await，logout 在清理身份前 await。before-quit preventDefault 后 await 原 stopSidecars，再调用 app.quit；原强杀兜底预算不变。`sidecar-stop.ts` 抽出 main 的既有 stop body 为具名 requestSidecarStop 供真实 server listener 和原测试共同调用，六秒预算在 SessionEnd ack 后开始；不是新 stop 协议或第二个 engine 释放口。

具名 router **1 pass**，原 shell-commands 文件 **33 pass**；requester/view 两例 **2 pass**，主停机屏障 **1 pass**。原 main 三文件检查 **37 pass / 1 fail**：误带入既有 six-second fake-timer case（并非获准的计时运行），暴露本轮无会话时 unconditional await 推迟计时器注册；不是基线或 flaky。按原合同消除无贡献等待：`25799f31d1` 的功能性协议顺序回归 **0 pass / 1 fail** 后，在无 active requester/无 viewed Session 时不创建屏障，新的两个具名 stop 功能例 **2 pass**（`stop-functional-green.log`），未重跑任何 timer case，也未改旧断言/预算。此误跑与具名修正透明保留，不扩大后续测试授权。

必要表外文件：`plugin-session-lifecycle.ts` 隔离 child 代的 pending 账本，便于在不启动 Electron 的原 hub-view 文件测试真实固定消息；`sidecar-stop.ts` 是原 main/sidecar stop 形状的唯一权威，不另写停止逻辑。preload shared stub 和两个已有 headless runtime 的新 OS transport acknowledgements 是新增必需能力的机械同步，未用可选调用隐藏缺能力。main view 的 destroyed listener 每 renderer 只登记一次；消息 id/type 最后由 requester 写入，解析出来的固定 id 不覆盖它。ui-mac typecheck 最初准确指出共享桩未分类新键，已补同源 stub；后续类型结果列于本轮收口。以上 L0 登记 plugin-hook-lifecycle，与 runtime/driver 同提交；gate-files 只同步已存在行的 count，不改 gate/selector。

**Notification / ENV_FILE 的增量与真实边界**：`3ee782ee31` occurrence 去重先红，`a95e701d82` 原生通知先红；`136c21d309` 只将真实权限 fixture 从不存在的 ASK_AGENT 改为原 native build agent 的 ask rule，通知业务断言不变。main 在本代 ready 后消费原 native permission.asked / session.execution.succeeded / MCP form.created，携原事件 ID、真实 Session/title/message 经同一 private action 到 runner；不依赖桌面开关。child completion 不重复当成主任务通知；非 Session 的授权成功页不虚构 Session 关联。receiver 忽略 Notification 的阻断输出。实际权限问答和模型任务完成具名例通过，MCP form 源类型检查通过；真实 SaaS 登录成功通知没有执行验收。

`974963ca69` shell export 红测、`f0ccf30cf9` 实际 hook 生命周期红测均先于实现。SessionStart/FileChanged 才获得会话临时 0600 ENV_FILE，后续 hook/monitor 只继承该文件真正 source 后的 export/unset delta，不继承文件句柄；原 AppProcess/fence/取消/超时仍持有进程，source 与实际 command 共用原 timeout 预算（单调时钟计算剩余），没有 dotenv/shell 文本 parser 或 process.env 写入。绑定在 source 后读取 delta，受管 ROOT/OPTION 与原绑定参数仍优先。原模块四例最终 **4 pass**，覆盖 shell substitution/字面数据、unset、PATH 不累积、绑定值和宿主隔离（`/tmp/plugin-standard-r18-process-final.log`）；native Session 的 Start→Post→实际文件 change→Post→另一 Session 例通过（`hook-env-green.log`、`file-contract.log`）。

**S-01 待裁决，未绕过**：`PreparedInstruction`（`packages/plugin/src/codepuppy-package-runtime.ts:6`）只有 parts/syntax/rawArguments/arguments/cwd，`core/src/config/plugin/command.ts:278` 执行 inline shell 只传 node.env；ext `plugin-package-invocation.ts:129` 的 prepared 没有 Session 环境字段。故上述 ENV_FILE 目前只到 hook/monitor，尚未到 command/skill 的 inline shell。最小需要：PreparedInstruction 可选 environment: Record<string,string|undefined>，ext 从真实 Invocation Session 取同一 source 后的 delta，core 以 binding env 优先合入；仍由原 renderer 执行，不加第二 parser/RPC。已异步提交编排器，尚无 ruling，不实施该冻结字段变更。首次命令展开在 SessionStart 之前的现有顺序也须在该接线时闭合，不能仅加字段就报完整。

**FileChanged 实现与本轮新测观察错误**：源码现在用同一个 filePaths 权威为每个 handler 选择 watchPaths（有值即替换，包括 []）或原 `|` 字面 matcher；实际 native stat add/change/unlink 才调用 runner，按 handler 的实际集合投递，不从工具事件合成。撤销/SessionEnd/dispose 取消所属 native watcher，晚到事件核对 lifetime。`136c21d309` 新例却删除 observer 的 matcher，要求它收到其他 handler 的事件，并在替换后继续要求原静态文件事件（`plugin-host.test.ts:3162` 起）；最初宽广播/静态并集的实现使其通过，那是本人新实现/新测的错误，不能当设计或基线。对照 frozen design v3.1 §4.12:434 的“更新该 handler 的实际 watch 集，未给时保持原 matcher 字面文件集”，产品已收回到该合同；新例目前红，断言未改。依 `~/.claude/skills/delivery-implement/SKILL.md` Honest checks：“If the test's assertion itself is wrong, return BLOCKED instead of editing it.” 已请求单独纠正观察断言并补移除臂的授权，未收到答复。不是回归旧行为或放宽产品合同的理由；watchPaths/add/unlink 的完整证据仍待正确观察例。

本步原 host/bridge/registry 文件完整一次 **128 pass / 1 fail**（分别 host 109/1、bridge 14/0、registry 5/0，`/tmp/plugin-standard-r18-ext-final-files.log`）；唯一红就是上述本人本轮新增的错误观察例，不能称 pre-existing。较宽相关 main installer/admission/private-message 三文件 **91 pass**，四个 sidebar/Session-search/surface 真实 headless 消费文件 **60 pass**，hub-view **22 pass**，原导航文件 **33 pass**，两个具名 stop 功能例 **2 pass**。加 process 四例，去重永久用例合计 **340 pass / 1 fail**；不计初次误跑 timer 文件的结果、迭代重跑或临时脚本 probe。命令/输出分别为 `/tmp/plugin-standard-r18-{main-related,ui-related,hub-file,navigation-file,stop-functional-green,process-final}.log`。

有效移除臂 **14 个全红**：main-receiver-barrier、viewed-session-settlement、main-stop-barrier、empty-stop-is-synchronous、notification-occurrence、native-task-notification、native-permission-notification、notification-runner、real-file-source、file-runner、session-environment-forwarding、shell-environment-source、binding-after-session-environment、router-before-leave-barrier。前三类源/环境业务例各 0 pass / 1 fail，router 臂保留发送但去掉 await 后真实 Solid 导航提前变红；结束按 scoped git restore 恢复已提交 sidebar。命令为 `python3 /tmp/plugin-standard-r18-removal.py` 与 `python3 /tmp/plugin-standard-r18-router-removal.py`，JSON/各臂输出在同前缀 removal-results.json、removal-*.log、router-removal-summary.log。最初只移除 onPrompt reconcile 的探针仍绿（别的真实重算也会登记），不计有效臂；改为移除唯一 native watchFile 注册点后业务例红。source helper timeout 参数收口后只重核受影响的 shell-environment-source 臂，其余行为不变。

**原样脚本的一次性验收（与永久 PASS 分计）**：`bun test --max-concurrency 2 /tmp/plugin-standard-r18-runtime/plugin-runtime.test.ts -t '<对应 one-time 名称>'`，沿当前真实 native Session/ShellTool/AppProcess/main parentPort，原脚本正文不改，观察 wrapper 仅写临时结果。所有代码/仓库/输出都在临时目录，真实凭据与真实 SaaS 均未使用。

| 实样 | 实际证据 | 已命名边界/去向 |
| --- | --- | --- |
| ralph-loop | accepted r12/r13：原 setup 与 Stop 脚本完成同任务循环、completion promise 退出；本轮不重复运行。 | 无新增本地 runtime 遗留。 |
| code-modernization | accepted r14：原六 handler/七计数 telemetry 回放通过；本轮不重复。 | 无新增本地 runtime 遗留。 |
| Claude Security | 原 write_scan_meta.py 通过真实 ShellTool 运行、exit 0；原 hooks.sh/Python metrics 给出 scan_started。原 tip 经真实 `git push -u origin main`（仅临时 bare remote，exit 0）运行，读取原 tool_response 后静默，未伪造发布成功。一次性例 **1 pass / 8 expects**，`original-security-final.log`。 | metrics 的源 if 要求命令中路径含 `plugin` 且 `.py` 后空格；默认 fixture 路径/带引号调用不匹配。通过指向同一原树的临时 `plugins` 目录 symlink、合法无空格路径的不加引号调用，明确只证明匹配变体，不冒称生产路径已闭合。tip 原 hooks.py:1168 需要 tool_response.gitOperation；原生 ShellResult 没有此事实，实际 stdin 已确认。需编排器裁决源守卫边界或权威事实接缝；不解析 stdout/命令文本伪造 push/pr 成功。 |
| Langfuse | 原 SessionEnd command 经 main leave→runner→ack 完成；固定最小 PATH 走源码 python3 fallback，原日志确认 langfuse import failed。一次性 **1 pass**（`original-final.log` 中对应例；同次 metrics fixture 尚红不并入本例），无 SDK/真实 key/网络上报。 | SDK/uv 工具链与 SaaS 登录为外部验收。首次 marker 读错目录、随后误以为原 import 失败会写 stderr，均为临时观察错误；改读原 logger 的临时 state 文件。首次 uv 分支需要外部解析，probe 到 5 秒被测试 scope 取消；未宣称依赖安装成功。 |
| dash0 | accepted r17：源脚本 0644 在原宿主 sh -c 语义下 exit 126，未 chmod；受控执行位变体的三事件正文通过。 | 原包执行位边界；真实 token/上报为外部验收。 |
| Stripe | accepted r14：原 PostToolBatch 命令/源随机守卫执行；仅受控 sample-rate=1 变体验证实际报告内容。 | 不将默认抽样静默说成已上报；真实支付服务未调用。 |
| PayPal | accepted r12/r16：原 prompt handler 通过 native generate 的 approve/reject/反馈规则。 | SaaS 操作没有运行；prompt runtime 无新增遗留。 |
| Convex | accepted r14/r16：原 lint hook、两条 design 和三条 quickstart monitor 正文实际启动并按作用域释放。 | 无部署/.env.local 的源 guard 已验证；真实 npx auth/logs/insights 为外部验收。 |

**供 design §10 同步的片 3–5 engine/contract 增量摘要**：S-01 在同一个 core renderer 保留源码/值节点与 syntax，PreparedInstruction.arguments 原样传 Invocation 参数（无声明 []），另加 bind-only shell 返回 executable/argv/env，参数通过每次调用环境引用而非字符串 escaping；未接受的 Session environment 字段不在本摘要的已完成合同内。allow-set 的 command/agent/bundle 只扩原 keys/scoped 域和 ext-receipt kind filter，沿原 root/effect/claim 投影，bundle 不新增 UI 组件行。S-04 将 ConfigChange 的同一 beforeConfigChange 接到配置加载及 skills watcher/rescan 发布前，拒绝保留旧值、签名/DTO 不变；S-05 给 InstructionDiscovery.File 的 schema/constructor/editor/codec 增可选 source（packageId/sourcePath/scope），在真实加载和 admission 消费 provenance；S-06 为原 compaction 增前置许可、候选 summary 在 adopt/commit 前的替换/拒绝及完成通知；S-07 复用现有 MCP connection/client/auth/fetch，只有匹配 handler 的 HTTP/SSE transport 按真实 Session 持有，stdio 保留 Location 连接，实际 in-flight 请求贯穿 Elicitation/Result，歧义保留诊断/native Form，SessionEnd/删除/归档/dispose/handler 撤回沿同一 stop 释放。S-12 为 RemoteConfig.transport?:http|sse 的精确 schema L3 与已接管 client 选择/收尾窄增量，缺席保持 HTTP，SSE GET/重连/POST 共享原代理/凭据及代撤销；MCP 身份按原 tuple/case-sensitive hash 与 ≤64 alias 统一。S-03/S-08、主进程 ready 收敛/延后激活和 monitor 仍为已登记 L0，没有新 engine generation 切换。混合 plugin/marketplace 根按 ruling 先 marketplace、根插件若未列则附加候选，不增用户步骤。以上均在原 registry 对应提交登记；不改 frozen design 文件，交编排器镜像。

Host aggregate 保持 **9eaf52305a08ccdf6cbba6131c6573228f304e6316671f510b952fc48c3668b7**，本轮 artifact 成员 **0** 变化；`bun src/shared/host-extension-package-contract/generate-artifact.ts --check` exit 0（20 files）。相对 1db6a3bbf5 的九个变更成员为 CONTRACT.md、plugin-package.ts、plugin-hook-events.ts、plugin-conversion.mjs、plugin-conversion.d.mts、generate-artifact.ts、profiles/plugin-package.v1.schema.json、testvectors/plugin-package-description.v1.json、testvectors/decoder-corpus.v1.json。consumer pin/vendor 未改。

本轮收据暂为 **PARTIAL**：已核 Codex（GPT-6），依据 spec v5/design v3.1 + r18，片 3/4 accepted 不重开；下一步只续片 5 的 S-01 ENV_FILE 接缝、错误 FileChanged 新测观察、Security 源 if/tip 事实边界和真实授权通知外部验收，未开始片 7。遗留去向：以上 fix now/编排器裁决；docs 基线 71 errors/250 warnings 和旧 command-subagent 三断言沿已接受处置；host checkpoint 交编排器，无新增 OPTIONAL。完整最终核对/提交见本节后续收口行。

最终核对：ext/ui-mac 包内 `bun typecheck` 均 exit 0（`/tmp/plugin-standard-r18-{ext-commit-types,ui-final-types}.log`），11 个生产文件 scoped oxlint 0 warning/0 error，process 收口后单文件 oxlint 同样为 0。唯一 registry 文件在机制/证据同步后 **5 pass**；north-star exit 0，未扩大接管白名单。`check-docs-contract --profile /tmp/plugin-standard-r11-docs-profile.yml --changed-since 1db6a3bbf5 --format json` 保持既有 **71 errors / 250 warnings**，不修基线。`affected-tests --list` 原 scope line 为 **all tests: scripts/gate-files.tsv changed (gate or declared global input)**，678 个 PR test files，仅列举未运行。新增例均在原 fast/integration 文件；gate-files 仅 hub-view 21→22、host 107→110 数量同步，没有新的全局输入或测试 root。`git diff --check` exit 0、hooksPath=.githooks。02:40 至 03:40 UTC+08:00 约 60 分钟；未 push/PR/merge/rebase，未开应用/窗口。一次根目录误发的测试命令没有选中任何文件（未执行测试），随后仅从 ext 包目录执行具名例，所有实际结果均取正确包目录输出。

### r19｜片 5 的最终裁决与收口

核对：IMPLEMENT — r19，orchestrator / Claude Opus 5.5，2026-11-27；r18 14c18583c4..b2fc7741db accepted。本轮只收片 5，不开始片 7。沿 spec v5 / design v3.1 与既有 rulings；不改其他仓、pin/vendor 或 gate。

偏离记录（orchestrator ruling 2026-11-27）：① S-01 允许 PreparedInstruction 增可选 environment，消费该 Invocation Session 的 ENV_FILE export，并使首次 inline shell 等待 SessionStart；仍由 core 单一 renderer 执行，按既有 S-xx 增量登记。② 本轮可单独纠正 r18 FileChanged 新测的追加/广播观察错误；产品的 handler-owned replacement 不变。③ Claude Security tip 所需 gitOperation 是 Claude-Code-specific 原生工具结果字段，标准事件无此事实，作为原包边界记录，不合成该字段。

FileChanged 观察修正独立提交：保留两个真实 dash0 group 的声明结构，将第二 observer 也限定到其自己的字面 matcher；用 watched[1].txt 验证字面名，分别观察动态/静态 owner。验证第一个 handler 替换到 dynamic.txt、仅第二个保留静态集；动态输出 [] 撤回；实际静态 unlink/add；关闭包后不再投递。未提供 watchPaths 的第二 handler 保留原 matcher，未放宽产品过滤或改生产代码。具名例 **1 pass / 14 expects**（`/tmp/plugin-standard-r19-file-watch-green.log`）；移除 filePaths 的动态 replacement 后同例 **0 pass / 1 fail** 且 REMOVAL_ARM_APPLIED（`file-removal.log`，child-only loader，不改磁盘源码）。本步完整 host **110 pass / 0 fail**（`file-host-complete.log`），消除 r18 的唯一新测红；case 数量/PR 层级/selector 输入不变。

S-01 红先行：`81180ab648` 只加原 core/module host 两个 integration 例。`bun test --max-concurrency 2 test/codepuppy-command-model-priority.test.ts -t 'package inline shells receive'` 与 ext 的 `-t 'first command and attached skill shells'` 在实现前各 **0 pass / 1 fail**（`/tmp/plugin-standard-r19-environment-{core,host}-red.log`）；核心没有读 environment，首次 command 的 COMMAND_SESSION 为空，均为行为红而非 fixture/编译错误。实现后同名各 **1 pass**（`environment-{core,host}-green.log`）。fixture 来自固定 feature-dev command、Temporal SKILL.md 与 dash0 原 group；只增加 shell 观察正文，未声称其受控环境脚本就是原 SaaS 脚本。

实现落点：PreparedInstruction 的唯一声明增可选 environment；core 只把它合入原 ChildProcess env，原生成绑定槽优先。所有 prepared 调用沿真实 command/tool/attachment/path/preload/delegate Invocation 传 Session ID，复用原 PackageProcesses.environment 的 shell source delta，不另写 parser/进程执行或全局环境写器。该 owner 过滤受管包变量，继续持有 ROOT/OPTION；unset 仍以 undefined 传递。旧 SessionStart 块提为同一个 startSession promise，在真实首个展开/指令准备及原 prompt 中 await，继续保留 source、可用的 prompt_id、已有 context 与 once-per-lifetime 归属。native attachments 先登记本次全部作用域再展开，保留 scoped SessionStart 可见性；失败时收回当前及未完成的预登记作用域，已完成前项保持旧语义。新增 source 等待沿原 running/epoch/allowed 取消账本，关闭/撤销后不向 renderer 交晚到值。私部 processSource 的参数缩为其实际所需 item 投影，无 DTO/用户步骤变化。

R19 增量与 engine 登记在同一个实现提交：原 plugin-invocation-semantics / plugin-hook-lifecycle 记录 r19 ruling、同一 source/renderer 与具名 proof；ADR-047 的既有 S-01 段记录同一增量。只改已经接管的 command.ts，未增 upstream 文件、排除规则或 engine-generation 端点。plan 核对行与偏离记录已填上述原话来源；其他设计决定不重开。

最终行为证明：core 文件 **14 pass**；最终 host **111 pass**（`host-final.log`）、process **4 pass**（`runtime-files.log` 的该文件）；plugin port **3 pass**。首次 command/首次 attached skill 读取各自 SessionStart 导出，shell metacharacters 仍为数据；实际 FileChanged 后 command 读到更新值，两个 Session 的 Start 各一次，宿主环境未变。复核附件失败清理后只先跑具名例，再完整 host 一次；不是重复容量/计时运行。较宽相关集合来自 rg 的直接 module/import 与 pin 消费者：native command 的插值/加载 **24 pass**、native config reload 两个 command 消费例 **2 pass**、policy E6 五例 **5 pass**、project-gate upgrade **5 pass**、registry **5 pass**。命令/输出为 `/tmp/plugin-standard-r19-{core-file,runtime-files,host-final,port-file,native-command,native-reload,policy-command,project-upgrade,registry}.log`。去重永久用例合计 **173 pass / 0 fail**；不把 FileChanged 初步完整 110、迭代 green 或移除臂重复相加。native command 只用正向名称选择，未包含其 debounce/timing cases；既有 command-subagent 三断言未触碰、未重跑。

R19 有效移除臂 **4/4 全红**：FileChanged handler replacement（上文）、core-instruction-environment、first-session-start-barrier、invocation-environment-handoff。后三臂分别去掉 core env 合成、把唯一 Start await 变为不等待、移除 ext 的 environment 传递，均命中生产边界且各 **0 pass / 1 fail**（`python3 /tmp/plugin-standard-r19-removal.py`，`removal-results.json` / `removal-*.log`）。未为测试改变产品合同或修改已提交的 S-01 红测断言。

原样包验收收口：继承 r12–r18 的整树与原运行证明，不重新跑 SaaS/外部工具链。ralph-loop 原 setup/Stop loop、code-modernization 原 telemetry、PayPal 原 prompt、Convex 原 lint/五 monitor 到源部署 guard 已通过；dash0 的 0644/sh -c→126 仍为原包边界，未 chmod；Stripe 原抽样守卫与显式 rate 变体证据保持区分；Langfuse Stop/SessionEnd 到 SDK/凭据外部边界。Claude Security 原 guard/banner/metrics 已有实际证明，metrics 按原 if 条件执行；tip 经真实临时 bare remote push 进入原脚本，但标准 tool_response 没有 Claude-Code-specific gitOperation，按 r19 ruling **明确为该包边界，不是待加字段，也不合成该事实**。原脚本/真实 SaaS 的完成范围以 r18 表与本 ruling 为准，外部服务登录不冒称验证。

供 design §10 在 r18 累计摘要上新增的唯一合同项：S-01 `PreparedInstruction.environment?: Record<string,string|undefined>` 是每次真实 Invocation 的 Session ENV_FILE export delta；ext 以原 AppProcess source 取值，first command/skill shell 前 await 同一 SessionStart，core 的原 renderer 合成环境且绑定槽优先。既有 arguments、bind-only、S-04 watcher、S-05 provenance、S-06 compaction、S-07 Session remote transports、S-12 显式 SSE、allow-set 三 kind 与 mixed-root 裁决均沿 r18 摘要，不另起权威或改 frozen design。该 delta 已在唯一 registry/ADR 同提交登记，镜像由编排器完成。

Host artifact：`bun src/shared/host-extension-package-contract/generate-artifact.ts --check` exit 0（20 files）；aggregate **9eaf52305a08ccdf6cbba6131c6573228f304e6316671f510b952fc48c3668b7**，本轮成员变化 0。累计相对 1db6a3bbf5 的九成员仍为 CONTRACT.md、plugin-package.ts、plugin-hook-events.ts、plugin-conversion.mjs、plugin-conversion.d.mts、generate-artifact.ts、profiles/plugin-package.v1.schema.json、testvectors/plugin-package-description.v1.json、testvectors/decoder-corpus.v1.json；consumer pin/vendor 未改。

本轮已核 Codex（GPT-6），结论 **DONE：片 5 收口，片 3/4 accepted 继承，不开始片 7**。core/ext/plugin/ui-mac 包内 bun typecheck exit 0（core 2,053 files / 0 errors）；五生产文件 scoped oxlint 0 warning/0 error，附件清理收口后 ext typecheck 与单文件 lint 同样通过。north-star exit 0，无新接管或白名单放宽。下一步/遗留去向：片 5 审查、design §10 镜像与 host checkpoint 交编排器；上述真实 SaaS/toolchain/原包 source guard 为验收边界。docs 基线与三条旧断言沿原已接受处置，无新增 BLOCKED/SEAM 或 OPTIONAL。实际 03:41–04:00 UTC+08:00 约 19 分钟，相关检查最终 scope 与 docs 结果见收口行；无 push/PR/merge/rebase、应用/窗口或全量 gate。

收口核对：`affected-tests --list` 的原 scope line 为 **all tests: scripts/gate-files.tsv changed (gate or declared global input)**，678 个 PR test files，仅列举（`/tmp/plugin-standard-r19-affected{,-scope}.log`）。gate-files 仅原行 core 13→14、host 110→111；没有新 global/runner/selector 输入。`check-docs-contract --profile /tmp/plugin-standard-r11-docs-profile.yml --changed-since 1db6a3bbf5 --format json` 维持已接受基线 **71 errors / 250 warnings**（`r19-docs.json`）；不修其他文档。`git diff --check` exit 0、hooksPath=.githooks，所有前台命令已结束。主实现与 registry/ADR/本段证据同提交，代码红测保持 81180ab648 的原断言。

### r20｜片 5 两部分审查修复

核对：IMPLEMENT — r20 accepted findings，审查区间 94b7c81d1f..de4dc535d9 / de4dc535d9..dcb7ab90bc，两位 Claude Opus 5.5 / round 1/1；spec v5 / design v3.1 + rulings 不变。不开始片 7，每个缺陷独立红测与修复提交；相关文件/engine slot，不运行全层或 gate。

输入核对：A1–A5 与 `/Users/pharaon/.cache/alpha-orch/2026-11-26/briefs/impl-1776-fix-s5-B.md` 的 B1–B9 全部纳入本轮。B4/B5 的原官方文档可在兼容报告本地快照 `evidence/docs/4-hooks.md` 读取，index.json 标记 URL 为 https://code.claude.com/docs/en/hooks.md、retrievedAt 2026-11-26；按 [matcher patterns](https://code.claude.com/docs/en/hooks#matcher-patterns) 与 [exit-code-0](https://code.claude.com/docs/en/hooks#exit-code-0) 核对，不用二手说明代替。正常上下文 plaintext 的本版已批准事件是 SessionStart/UserPromptSubmit/UserPromptExpansion；官方另有本片未实现的 PostModelSwitch，PreCompact stdout 则属于 summary instructions 而非普通上下文。匹配字段以官方逐事件表核对，FileChanged 的实际字面 watch 集仍沿 frozen 合同。

文案漂移记录（交编排器 §10 镜像，未改设计）：design §4.9:367 仍将整个 ARGUMENTS 视为一个值，与已接受 r9 B2 的逐 parseArguments 参数语义不同；代码继续按 r9 B2，不回退也不重开裁决。

A1：`bdaf037dfb` 为独立 engine 红测。late Location 具名行为在 `A1-engine-red3.log` 中因 `late Location plugin MCP bound` 未到达而红；skills-only reload 在 `A1-reload-red.log` 中因 `unrelated plugin MCP restored after skills reload` 未到达而红。初始两次仅 fixture 缺 publishPluginDataHome，及一次未包含的 remotion fixture，都不计缺陷红；在提交前沿已有 cold case 初始化 DATA、使用已固定 Temporal 样本修正装配，业务断言未变。最初路径归因未获证据，已纠正，不将其当产品问题。

A1 实现：Location 的 ext setup 完成 seal 后，经既有 HubBridge/parentPort 发实际 directory 的 package Location readiness；同一个 main parser/host/reload coordinator 触发原 engine-ready 的 managed 收敛，debug Location cache keys 已包含构建中的新 Location，main RPC 等其完成后应用，发布端不等待，避免循环等待。所有 pluginTree MCP 图在 engine-ready/Location-ready/reload 都入选；非 pluginTree 图保留原 items 筛选。没有第二执行器、配置/允许集权威或 engine L3；registry plugin-local-mcp 同提交登记。两个具名 engine 例 **2 pass**；完整原文件通过 `gate slot -- bun test --max-concurrency 2 --timeout 180000 ./src/main/package-hub-lifecycle.engine.cases.ts` **10 pass / 0 fail**（`/tmp/plugin-standard-r20-A1-engine-file.log`）。必要消费文件：HubBridge/私部 message/parser/HubView/reload coordinator 与 ext setup；engine-cases 原宿主 count 8→10 为同链机械同步，不改 gate。

A1 相关 main coordinator/view/message 三文件 **49 pass**，ext bridge **14 pass**（`A1-main-files.log` / `A1-bridge.log`）。ui-mac 初次类型检查指出 ReloadCoordinator 的声明缺新方法，已同步同一个私部接口；原 wire/session/install DTO 未变。其余最终检查与后续 finding 的证据接本段，不以 A1 通过代表全审查完成。

A1 收口：最终 ext host **111 pass**，ui-mac/ext typecheck exit 0（`A1-host-file.log`、`A1-ui-types-green.log`、`A1-ext-types.log`）。A1 的原 engine 文件已完整一次，不在后续无改动时重跑；engine-cases 宿主只同步固定 pass count，没有运行整层 wrapper。
