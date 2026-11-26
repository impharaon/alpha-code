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
