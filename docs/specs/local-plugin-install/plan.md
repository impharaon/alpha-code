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

## 片 1 · 桌面：一个包一张卡，安装、授权与启停

- 依据：[spec v3 @ 0267a7a](https://github.com/impharaon/alpha-work/blob/0267a7acd725bba3b066d97d9da21d689ae3e5f3/docs/specs/local-plugin-install/spec.md) 的 BR-01/03/05/09/13；[冻结 design v2 @ 6d0bc73](https://github.com/impharaon/alpha-work/blob/6d0bc7354e5d9035a0415636c1417735cebff85b/docs/specs/local-plugin-install/design.md) §4.2、§4.5、§5、§6、§8 片 1；父项 [alpha-work#138](https://github.com/impharaon/alpha-work/issues/138)。本段以 2026-11-15 派发的 a–d 为执行边界，关联 AC-03 前两句、AC-13/14 的技能和连接器分项；不宣称完成 AC-08 的来源转换诊断或其他片的整树/导入能力。
- 核对：待编排器核对；首次实施提交从续派 brief 的 `Phase:` 行填入计划提交、核对者/模型与结论。本轮只提交本文件，不开始实施。
- 基线：alpha-code `14f23a83994e57e4c6510cd4d148f4250d3ed0d3`，Bun 1.4.4；owner 的本地 0.2.0 / catalog 2026-11-15.1 观察作为复现输入，不当作本轮实跑结果。UI 复用 [当前定制中心组件](../../design/current/customization-center/components.md) 与 [活稿](../../design/current/customization-center/design.html) 的卡行、开关、组成列表、Dialog、密码框、Button、链接和错误提示；不绘稿、不消费待合并的导入预览草稿。
- 预计规模：约 20–24 个生产文件、18–22 个测试/夹具文件，净改动约 1,200–1,800 行，实施及相关验证约 4–6 小时。每完成 a/b/c/d 检查用时与规模；达到预计上界两倍时停止并返回具体原因。

### 改动

下表路径均相对 `packages/ui-mac/`；同一行列出的文件各自只承担所述接线。预期不改宿主发布 schema、Protocol/HttpApi 或引擎执行器，不引入依赖。

| 文件 | 改什么 |
| --- | --- |
| `src/shared/package-admission.ts`、`src/shared/catalog-package-view.ts` | 在既有安全 DTO 中统一 secret / mcp-oauth / Connection 的前置视图，供安装计划、目录详情和装后包授权共同消费；只携声明、输入用途、既有说明及安全状态，不传秘密、路径或原始 payload。 |
| `src/main/package-installability.ts`、`src/main/package-admission.ts` | 复用已解码前置声明生成上述视图；确认计划不再只列 secret。按本段技能/连接器范围让首装落关闭，未完成登录仍能保存内容；安装本身不启动 OAuth probe。装后密钥修改复用已有 admission/builders/事务资源，保持包图与开关，未改字段保留现有凭据，不让 renderer 提交配置或文件位置。 |
| `src/main/package-mcp-oauth.ts` | 将安装期主动 add/probe 与显式登录动作分开；就绪从真实引擎状态/集成连接读回。关闭包的定义经同名 disabled 配置投影，不走当前 active `experimental.mcp.add`。不自建 OAuth attempt、callback 或 token store。 |
| `src/main/ext-install-planner.ts`、`src/main/ext-receipt-v2.ts`、`src/main/ext-package-tx-builders.ts` | 包状态操作从既有 graph/root 找全组件，复用锁、配置写入、账本写器与技能允许集发布；一个用户动作写入 root 意图并派生本段组件投影，避免 renderer 逐项循环开关。凭据写入沿版本化 prepared resource，改 token 不改变包的启停状态。 |
| `src/main/ext-ipc.ts`、`src/main/ext-write-channels.ts` | 已安装投影带 root 状态、组成和安全授权视图；包状态/装后密钥写动作接现有写闸、恢复与重载通道。main 依据包身份重读图和已验声明，调用方不能指定 server URL、任意 config 或秘密文件。卸载仍走 `uninstallPackageV1`。 |
| `src/preload/types.ts`、`src/preload/index.ts`、`src/renderer/extensions/ext-ipc.ts` | 串接包状态及装后授权动作，统一引用安全 DTO；只增加本片所需的桌面内部动作，不新增发布者合同。 |
| `src/renderer/extensions/use-extensions.ts`、`src/engine-adapter/opencode2/routes.ts` | 包启停/授权后刷新同一包视图，并沿现有重载与 MCP 连接/断开路径使运行态收敛；复用 `authenticateMcp`。OAuth complete 且 server disabled 能判为授权完成；failed/expired 仍返回失败，不用 connected 代表所有授权成功，也不把 disabled 当失败。保持现有路由和返回联合，不换代引擎 API。 |
| `src/renderer/extensions/extension-hub.tsx` | 按 main 包图和 scope 归属过滤顶层组件，在包卡中显示组成、唯一开关、凭据操作及整包移除；GitHub、Supabase、SQLite、云端图片同用此路径。跨页进入时也加载包归属；同名项目条目和无包归属条目照原路径显示。浏览卡的已装状态与这张包卡相认。 |
| `src/renderer/extensions/install-confirm.tsx`、`src/renderer/extensions/ext-authz.tsx`、`src/renderer/extensions/extension-detail.tsx` | 安装页与包卡复用前置展示/输入逻辑和现有组件；能力行显示人话及已有图标，内部 profile token 不作为正文、图标回退或 tooltip。token 说明指出它供哪个连接器认证、会被保存；包声明的领取说明/链接从已有 `listing.longDescription` / `websiteUrl` 展示，不根据变量名猜服务地址，不把任意官网谎称为令牌生成页。登录项渲染操作而非密码框，没登录可先装好。 |
| `src/renderer/i18n/zh.ts`、`src/renderer/i18n/en.ts` | 补齐保存凭据、用途、待授权、登录/更改凭据、包状态与真实失败的产品文案；不要求用户增加新资料或确认步骤。 |
| `test-component/hub-three-pages.cases.ts`、`test-component/local-package-renderer.cases.ts`、`test-component/ext-package-detail-wiring.cases.ts`、`test-component/mcp-needs-auth-wiring.cases.ts` | 以生产 Solid DOM 编译、真 `useExtensions` / `ExtensionHub` / `InstallConfirm` 验证 a–c。更新明确编码旧平铺/组件开关行为的用例；修复用新回归用例先红，不能只把旧断言删掉。对应 `src/renderer/extensions/{hub-three-pages,local-package-renderer,ext-package-detail-wiring,mcp-needs-auth-wiring}.test.ts` 仅在实际子用例跑齐后同步宿主计数。 |
| `src/main/ext-set-state-tx.test.ts`、`src/main/package-admission.test.ts`、`src/main/package-mcp-oauth.wiring.test.ts`、`src/main/package-mcp-oauth.engine.cases.ts`、`src/engine-adapter/mcp-auth.test.ts` | 真临时盘验证整包状态与凭据事务；沙箱真引擎验证 disabled OAuth、无安装期连接、启停后的工具和技能实际可见性及两次调用均询问。`package-mcp-oauth.engine.test.ts` 宿主按实际用例同步。 |
| `test-component/package-builders-wiring.cases.ts`、`test-component/package-install-engine-reload.cases.ts`、`src/main/ext-package-ledger-uninstall.test.ts`、`src/main/ext-write-channels.test.ts` | 校准改动导出所影响的 mock/通道枚举，验证真实 IPC→builder→事务→配置/账本/secret store 与移除后的盘面；对应既有宿主按实际用例同步，不放宽检查。 |
| 本文件 | 首次实施填核对，实际偏离随发生偏离的提交记录。其他文档若出现必需修订，先列具体错误和同调用链理由再更新本段，不顺带维护保护资产。 |

### 顺序

1. **回归证据提交**：从下述实样构造可复现输入；在现有 DOM harness 添加 a/b/c 的具名失败用例，在临时盘/真引擎 harness 添加 d 和关闭包登录用例。单独提交新增回归及红色命令结果；不夹带生产修复。旧用例改为新要求的同步在修复提交进行，已提交的新回归不改断言。
2. **包状态及授权事务提交**：先统一前置安全投影与 root 状态写入，再接 IPC/preload；安装不主动连接、装后 secret 写入及关闭包 OAuth 同时落相关证据。运行 main/共享/adapter 的对应具名测试。没有登录凭据也能完成内容安装，不以 token 或服务失败删减技能。
3. **用户入口提交**：包卡归属过滤、唯一开关和内嵌组成；安装说明、密码编辑及登录动作共用既有组件。跑 DOM harness 的新增用例、原有相关用例和受影响的安装 watcher/详情宿主；只更新编码旧行为或子用例数的断言。
4. **运行证据与收口提交**：在临时 HOME/XDG/数据库中走真实 IPC 安装→关闭态授权→开启→调用→关闭→移除；以同一样本的启用正对照证明观测有效。跑适用类型检查和文档链接检查，检查范围、diff 与 plan 偏离。只 commit，不执行 gate、push、PR、合并、上架或 owner 账号授权。

### 风险

- **归属过滤漏页或误吞同名项目项**：当前包 resource 仅在连接器页触发（`extension-hub.tsx:204`），包行与平铺行分别渲染（`:2254`）；a 的回归必须直接打开技能页，并放入同名 project/独立条目作对照。SQLite/云图片不能靠名字特判消重；云组件仍沿其 receipts-only 路径，不伪造成 MCP。
- **看起来是一个开关，实际上仍部分启用**：当前包行只有移除菜单（`extension-hub.tsx:1599`），单条 state 写入只作用一个 record（`ext-receipt-v2.ts:1315`）。d 必须检查 root、子记录、技能允许集、MCP config 和真引擎，而非只数 IPC 次数；错误不能报告整包已开启。
- **关闭包登录误启动或误报失败**：可复用接缝已在 `packages/core/src/mcp/index.ts:259/731/735/778` 核到；目前 `package-mcp-oauth.ts:43` 主动 add，`use-extensions.ts:796` 只认 connected。c/d 必须包含 disabled→登录完成→仍 disabled 且零工具/进程，以及失败后仍可重试的路径；不另造活跃临时服务器。
- **凭据变更丢值或泄露**：检查专用版本资源、原引用保留与新版本提交/失败清理，真实配置/日志/DTO 不出现测试 canary。安装/装后都只让用户填写原本声明的需求，不把 OAuth 变成密码框。领取指引只消费既有公开声明；若实际输入需要新增逐 secret 的发布字段，返回 `SEAM-CHANGE-NEEDED`，不扩展冻结宿主 schema 或手造 provider recipe。
- **范围与冻结设计**：未发现所需引擎接缝与设计的事实矛盾；现有 active probe、逐组件状态和 UI 回退属于待改行为。K1/K2 的权威继续是现有权限、账本、secret store 和 engine integration。BR-14…16、命令/助手/hooks、整树脚本、直接 folder/Git、原生入口不在本段；不改适用的已冻结权限规则，不迁移旧记录。
- **真实服务验收边界**：自动证据使用真实包的声明/技能字节，外部网络与 OAuth 服务器在现有边界替换；不将替身登录计为 Supabase/GitHub 实际授权。owner 的真实账号/token 使用是集成验收证据，本轮不会读取或代填。

### 证明

以下名称是实施时增加的具名用例；命令均从 `packages/ui-mac/` 执行，并使用派发要求的 Bun PATH。测试用独立子进程和已有隔离 preload；机器有 gate 在跑时顺序执行宿主，`bun test --max-concurrency 2`，不并发开启多套引擎。

| 项目 / AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| a · BR-01/13，AC-13 的包管理 | `hub-three-pages.cases.ts`：`catalog package owns one installed row across pages`；用 GitHub、Supabase、SQLite、云图片实样形成图与收据，DOM 中各包恰一张卡、恰一个开关，展开可见实际组件；先打开技能页；同名 project/独立条目仍可见。命令：`bun test --max-concurrency 2 src/renderer/extensions/hub-three-pages.test.ts src/renderer/extensions/local-package-renderer.test.ts`。 | 去掉 graph/scope 归属过滤会出现重复顶层卡；漏技能页加载会重新出现组件；只隐藏组成或移除开关也会使用户操作/DOM 断言失败。实际点击唯一开关后整包状态需随 main 回读变化。 |
| b · BR-03/05 | `ext-package-detail-wiring.cases.ts`：`package confirm explains and collects declared credentials`；打开真实安装框，用 DOM 检查用途/保存说明、password 控件、声明的说明链接及其 openLink 目标；输入 canary 后点击原确认按钮，真 admission/secret resource 接到值；页面正文、tooltip 无 profile token，OAuth 行没有 password。命令：`bun test --max-concurrency 2 src/renderer/extensions/ext-package-detail-wiring.test.ts src/main/package-admission.test.ts`。 | 删说明会缺用途/保存段；删链接处理不会打开声明地址；删 input/onInput 或 secret 运输时实际保存值不符；只给词汇表加文字而未接生产安装框不能过。不是源码含字检查。 |
| c · BR-03/05/13 | `local-package-renderer.cases.ts`：`installed package edits its connector secret while off and on`；从包卡进入编辑，保存新 canary，重读配置仍是版本引用、运行时解析到新值；关闭状态不变，开启后再改同样生效，未改字段保留；真实写失败显示失败且旧值可用。并以 `mcp-needs-auth-wiring.cases.ts` 的 `package login remains available while off` 点击待授权动作。命令：`bun test --max-concurrency 2 src/renderer/extensions/local-package-renderer.test.ts src/renderer/extensions/mcp-needs-auth-wiring.test.ts src/main/package-builders-wiring.test.ts`。 | 删除卡上动作、凭据写链或刷新任一环会使点击、盘面/解析值或状态断言失败；借“开启”才登录会在 disabled 行找不到可操作按钮。 |
| c/d · §4.5，AC-13/14 连接器分项 | `package-mcp-oauth.engine.cases.ts`：`disabled package OAuth stores a credential without starting MCP`；沿生产 disabled 配置登记同名服务，调用真实 integration OAuth 与既有 adapter，确认真实 credential connection 就绪、MCP 保持 disabled、工具列表为空、MCP 握手/调用计数为零；再开启同名服务可连接并调用。补 `mcp-auth.test.ts` 的 complete/failed/expired × disabled 分支。命令：`bun test --max-concurrency 2 src/main/package-mcp-oauth.engine.test.ts src/main/package-mcp-oauth.wiring.test.ts src/engine-adapter/mcp-auth.test.ts`。 | 使用 active add 会产生握手/工具；登录后偷偷开启会破坏 disabled 断言；仍只认 connected 会报登录失败；未保存真实凭据时开启后仍 needs_auth。正对照必须测到同一服务握手与工具执行。 |
| d · BR-09，AC-13 技能/连接器分项 | `ext-set-state-tx.test.ts`：`one package switch projects every skill and connector`，以及真引擎用例 `package lifecycle changes the callable inventory`；开启后实际读取包技能路径并调用连接器工具，关闭后技能清单/工具库存不再含本包，MCP disabled；重开仍可用。在 `package-install-engine-reload.cases.ts` 点真实开关，不只验证 planner。命令：`bun test --max-concurrency 2 src/main/ext-set-state-tx.test.ts src/main/package-mcp-oauth.engine.test.ts src/renderer/extensions/package-install-engine-reload.test.ts`。 | 只改开关样式或 root record，技能允许集、连接器配置、真引擎清单至少一项不变；只重载技能或只断开 MCP 不能同时满足正反两臂。 |
| d · BR-10，AC-14 技能/连接器分项 | `package-builders-wiring.cases.ts`：`content install is inert until package enable`；安装真实声明与技能内容时计数实际 spawn、动态 shell 求值及 MCP 请求，均为零；不点登录时无授权请求。随后对同一样本开启并调用，计数为正。命令：`bun test --max-concurrency 2 src/main/package-builders-wiring.test.ts src/main/package-mcp-oauth.engine.test.ts`。 | 恢复 admission 的 active OAuth probe、意外启动 MCP 或提前求值会使零副作用断言红；没有启用正对照则该证据不成立，不声称覆盖后续脚本/hooks。 |
| d · BR-09，AC-13 移除分项 | `ext-package-ledger-uninstall.test.ts` 和 `local-package-renderer.cases.ts`：`removing package clears owned artifacts and secrets`；经原移除入口检查 generation/技能文件、MCP config、图/claims、包专用 secret 版本均不存在，运行清单不再暴露本包；已有 shared Connection 保留对照。命令：`bun test --max-concurrency 2 src/main/ext-package-ledger-uninstall.test.ts src/renderer/extensions/local-package-renderer.test.ts`。 | 删任一清理步骤会留下对应真实文件、条目、凭据版本或可调用入口；不能用“返回 ok”代替清理。 |
| AC-03 前两句 | 在上述真引擎生命周期样本中加载生产 Code Puppy policy，经 Session 的工具执行路径发起两次同一 connector 工具调用，两次分别产生 permission ask；各回复 once 才执行一次，计数依次 0→1→2。不是直接请求 MCP `tools/call` 后自造 ask；不修改权限 evaluator，不回复 always。命令：`bun test --max-concurrency 2 src/main/package-mcp-oauth.engine.test.ts`。 | 包启用/登录若误写持久 allow，第二次不会出现 ask；若只测状态不执行工具，不算证据。 |

**夹具出处**：GitHub/Supabase 从 alpha-web 的 `catalog-src/packages/package.github/1.0.1/codepuppy-package.json`、`package.supabase/1.0.0/codepuppy-package.json` 及对应已编译 envelope/payload/技能资产取样，固定 producer commit、相对路径和字节摘要；SQLite/云图片从本仓随包 `resources/extension-seed/extension-seed.snapshot.json` 与 `src/renderer/extensions/codepuppy-catalog.json` 的对应实际条目取样。样本只读进入临时目录；本片新增 fixture 记录出处，不手写第三方 manifest/MCP 格式。领取指引正例只修改实样允许的既有 listing 展示段，标明是测试变体，不伪称线上已声明。现有 mixed-bundle corpus 继续复用，不能拿它冒充真实插件的使用验收。

**相关回归和检查**：按每次修改的实际导出，运行上表宿主及 `src/main/{package-installability,package-admission.parity,package-admission.wiring,package-mixed-bundle.wiring,package-secret-recovery-wiring,ext-write-channels}.test.ts`、`src/shared/package-secret-prerequisite.test.ts`、`src/renderer/extensions/{ext-ipc-chokepoint,use-extensions-ipc,ext-package-presentation,install-scope-wiring}.test.ts`、`src/renderer/codepuppy-ui/hub-install-watcher.test.ts`；涉及 adapter 路由实现再跑 `src/engine-adapter/{routes-coverage,contract-cases}.test.ts`。从包目录运行 `bun typecheck`；文档运行 `python3 scripts/check-doc-links.py docs/specs/local-plugin-install/plan.md` 和 `git diff --check`。不运行全仓 suite、bin/check 或 gate。

**计划阶段已核的基线**（2026-11-15，均 exit 0；没有新增行为通过的含义）：

- `bun test src/renderer/extensions/hub-three-pages.test.ts src/renderer/extensions/mcp-needs-auth-wiring.test.ts src/renderer/extensions/ext-package-detail-wiring.test.ts src/renderer/extensions/package-install-engine-reload.test.ts`：4 个宿主通过，其生产 DOM 子用例均执行。
- `bun test --max-concurrency 2 src/main/ext-set-state-tx.test.ts src/main/package-admission.test.ts src/main/package-mcp-oauth.wiring.test.ts src/main/ext-package-ledger-uninstall.test.ts src/shared/package-secret-prerequisite.test.ts`：111 pass，0 fail。
- `bun test --max-concurrency 2 src/main/package-mcp-oauth.engine.test.ts src/renderer/extensions/local-package-renderer.test.ts src/main/package-builders-wiring.test.ts src/main/package-mixed-bundle.wiring.test.ts`：4 个宿主通过，含沙箱真引擎及生产事务。

计划文档检查：`python3 scripts/check-doc-links.py docs/specs/local-plugin-install/plan.md` exit 0，2 条相对链接均可达；`git diff --check` exit 0。`check-docs-contract --profile <临时单仓 profile> --changed-since 14f23a8399 --format json` 使用 Alpha 的 `governance/delivery-profile.yml`，仅筛选 alpha-code 并将 checkout 定位本 worktree，exit 1：69 errors / 216 warnings，本计划 0 条 finding。已命名原因包括 `docs/README.md:105` 的生成索引不同步、`docs/architecture/modules.md:24` 等未改文件的失效目标及既有非标准文档目录。按本次只写/提交计划的范围，不改索引、合同或其他文档，也不重跑未改变的检查；交回仓库文档治理。

计划作者已核：Codex（GPT-6）核对上述冻结版本、a–d 调用链、现有组件与测试入口；未发现所需接缝与冻结设计的事实矛盾。该自核不代替本段「核对」所留的编排器检查。

### 偏离记录

暂无实施偏离。本轮仅创建本段计划；工作区原有 `bun.lock` 改动保留、不纳入提交。

记录观察（不实施）：`packages/ui-mac/src/renderer/extensions/extension-hub.tsx:1753` 的「立即生效」仍使用既有待重载/加载状态；owner 报告点击跳页且按钮保留。本片不改变其语义，建议交回定制中心生效状态的独立 intent item；不以该观察阻塞 a–d。
