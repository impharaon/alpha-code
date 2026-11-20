---
id: DESIGN-engine-config-fence
title: 对话改不了决定程序、放行与凭据去向的引擎配置 技术设计
summary: 围栏 profile 最末加一块只拒写的 CF(一张封闭清单:Code Puppy 状态根、合成的引擎配置目录、登录 shell 环境快照与密钥环境文件、端点钉选、连接记录、界面设置存储、引擎全局配置目录、~/.opencode(计划目录除外)、主目录级 opencode.json、工具策略文档),连同各自真实目标与每一级上级目录节点;W2/W6 行删掉、W16 收窄到计划目录;原来在围栏里写这些位置的写者(合成显式文件与模型底表、种子 codepuppy.jsonc、显式文件监听、ext 的工具策略写入)改在主进程,工具策略写入复用既有 codepuppy.* 窄消息;引擎库里三类会让授权或配置活过本回合的记录(已存批准、会话行上的放行规则、wellknown 缓存文档)在引擎装载时不再生效;用户无感
kind: tech-design
status: draft
spec: SPEC-engine-config-fence
spec_version: 0
review:
  rounds: 0
  reviewed_sha: ""
  verdict: ""
owners: [owner]
last_reviewed: 2026-11-20
---

# DESIGN-engine-config-fence｜对话改不了决定程序、放行与凭据去向的引擎配置 技术设计

只写决定。文件清单、提交顺序与测试由实现方的 plan.md 写。§3、§7 已退役,编号不复用。标注:**测** = 实测(假数据、临时目录,原始输出在 `~/.cache/alpha-orch/2026-11-19/config-fence-design/`,下称 `CFD/`);**读** = 读代码(版本见 §1);**推** = 推断,未测。

## 1. 基线

- Spec:**没有**。现有规格都不承载本结果的 AC(见「返还缺口」G1);`spec` 字段先占 `SPEC-engine-config-fence` v0。本设计不写规格。
- 授权:INT-safety I-13(owner 2026-11-14 以 [U-10](https://github.com/impharaon/alpha-work/blob/2ead902/docs/intents/originals/INT-safety.chat.md#u-10) 批准),原文「智能体获批的一次写文件就能改掉插件放行策略的输入」,方向「这些位置从围栏可写范围里拿掉或改为只读,必要的写入改由主进程代办」。旧票 alpha-code#1530 与旧计划 #1542 已于 2026-11-15 退役,本设计只继承结果、不继承旧机制。owner 对这一族工作的硬约束(2026-11-19,逐字):「不要设计的过于复杂。」
- 结果(spec 落地前的工作编号):
  - **R-1** 被围栏的进程树里的任何进程(模型调用的工具、shell 命令、连接器子进程及其后代)改不了决定「运行什么程序、哪些工具不问就放行、凭据交给谁」的引擎配置。
  - **R-2** 用户安装 / 启用 / 停用连接器与扩展包、添加模型与密钥、改设置、应用自己的启动,都与今天一样;没有新步骤、提示、等待或设置。
  - **R-3** 原来在围栏里成功、现在被拒的写入,失败要响亮、具体(日志),绝不静默丢掉用户的设置。
- 代码基线:`origin/alpha` @ `a20dadb942`(0.2.4)。
- 平行设计(都改 `packages/ui-mac/src/main/process-fence-profile.ts`,本设计不依赖任何一个先合入,落点见 §4.2):
  - DESIGN-child-process-write-fence 的 X1/X2(`fix/batch-025-fixes`,实现在 `403f112ee9`):放在 `(allow file-write* …)` 块之后、网络行之前。
  - DESIGN-stored-credentials-fence 的 C1(`design/secrets-main-only` @ `6450ac5549`):放在网络行之后。它的 §6 把「对话改写围栏内可写的引擎配置,就能改变被合法代入的凭据被送到哪里」作为残留类交给本设计(D10)。

**返还缺口(给编排器,不需要 owner)**

- **G1 没有承载本结果的规格。** 核过:`SPEC-project-engine-config-takeover` 第 49 行把「进程围栏的可写范围(INT-safety I-13)」列为不做;`SPEC-tool-write-fence`、`SPEC-child-process-write-fence` 只管「写不出去」;`SPEC-tool-permission-policy` / `SPEC-tool-policy-settings` 只管策略本身。建议规格逐字采用下面「本设计的保证」(a)–(c) 作为 AC 的结果句,残留照 §6 列。
- **G2 I-24(自动化任务文件在围栏内可写)会被本设计顺带关闭。** 它们在 Code Puppy 状态根下(`codepuppy-automations.ts:16-17`),本设计把整个状态根划出可写集(D2),原因是同一根下的 `codepuppy.jsonc` / 账本 / 允许集 / 技能指针,不是采纳 I-24。用户看不到任何变化(这些文件只由主进程写)。编排器裁决(2026-11-20):I-24 保持原条目,本设计合入后在该条记「随 I-13 关闭」。

**本设计的保证(封闭陈述)**

- (a) 被围栏的进程树里,任何进程都不能新建、修改、替换、改名、删除、硬链或克隆 §4.1 清单 CF 里的任何位置,也不能新建、改名、删除它们任何一级上级目录节点;已存在且是软链的位置,其真实目标同样受保护;这一点不受工作区并集、运行期项目放行(X1)或其它可写行影响。
- (b) 引擎库里三类会让授权或配置活过本回合的记录,引擎不再据以放行或装载:项目级已存批准、会话行上的 `allow` / `ask` 规则、wellknown 缓存的配置文档。
- (c) 原来在围栏里写 CF 位置、且有调用方的每一个写者,现在都在主进程;它的失败响亮(具名日志 + 既有失败路径),不落回围栏内写入。唯一没有搬的是引擎 `Config.update`:它在 Code Puppy 里没有调用方(P-05)。

保证外的残留逐条列在 §6 安全面,每条带前提与处置(关闭或接受)。

**对话侧会遇到的拒绝(用户自己的流程不变)。** 对话里的工具与命令写 CF 位置会得到 EPERM,例如让助手直接改 `~/.config/opencode/`、`~/.opencode/`(计划目录除外)或 `codepuppy.jsonc`。依据是 I-13 的 owner 批准原话「这些位置从围栏可写范围里拿掉或改为只读,必要的写入改由主进程代办」,它点名了合成的引擎配置、`codepuppy-shell-env.json`、引擎全局配置目录与 `~/.opencode`。CF 里另外几项(界面设置存储、端点钉选、连接记录、工具策略文档、`codepuppy.env`、主目录级 `opencode.json`、Code Puppy 状态根)是同一结果「改不了策略输入」的输入,今天只由主进程或用户在应用外写,用户经设置页、定制中心或应用外编辑的路径都不变。这几项不另取 owner 原话(§10 D3 编排器裁决);对话侧的拒绝写进规格「用户会碰到的限制」。

## 2. 地面真相

**P-01 围栏结构与规则先后。**(读 + 测)profile 由 `renderProcessFenceProfile` 唯一渲染:`(allow default)` → `(deny file-write*)` → `(allow file-write* W1…W19)` → N1–N4(`process-fence-profile.ts:138-181`)。显式规则后写者胜:拒写块放在放行块之前完全失效(测 `CFD/run/ATT-Kearly.out`,10/11 项攻击成功);X1 若写在拒写块之后,会把受保护目录重新放开(测 `CFD/run/ATT-KXwrong-config.out`、`ATT-KXwrong-ud.out`);X1 在前、拒写块最后则不能(`ATT-KX-config.out`、`ATT-KX-ud.out`:令牌目录里别处可写,受保护位置 EPERM)。

**P-02 引擎装载哪些配置文档、哪些今天围栏可写。**(读;`packages/core/src/config.ts:270-375`、`config/discovery.ts:59-167`)设置后加载者胜;policy 先加载者胜(`engine-explicit-config.ts:3-9`)。

| 文档 | 来源 | 今天围栏内可写 | 信任闸 |
| --- | --- | --- | --- |
| 内联 | sidecar 内存,经 `start()` 选项 | 否 | — |
| 显式文件 | `<userData>/codepuppy-engine-config/codepuppy-explicit.json`(`config.ts:286`) | W3 | 无 |
| 全局目录 | `engineGlobalConfigDirectory`(`engine-paths.ts:34-36`)= `OPENCODE_CONFIG_DIR` 或 `<XDG_CONFIG_HOME>/opencode`;`opencode.json(c)` 加 `plugin(s)/`、`tool(s)/`、`agent(s)/`、`mode(s)/`、`command(s)/`(`plugin/source-directory.ts:7`、`config/plugin/agent.ts:24-28`、`config/plugin/command.ts:156-162`) | W6(XDG 那一份) | 无 |
| `~/.opencode`、`~/opencode.json(c)` | 项目上溯到 HOME 时发现(`discovery.ts:78-82`);闸把「父目录 realpath 是 HOME」的当用户全局,不经信任闸(`codepuppy-project-gate.ts:17`、`:342`、`:419-421`) | `~/.opencode` = W16 | 无 |
| 项目上溯文档 | 会话目录及其 HOME 以下的各级祖先 | W1 | 按会话目录的信任放行(ADR-049,`codepuppy-project-gate.ts:327-341`、`:419-425`) |
| wellknown 文档 | 引擎库 KV 的来源表与缓存(`wellknown.ts:105-139`、`:209-212`);拉取失败或无凭据时用缓存(`config.ts:183-190`) | 库在 W4 | 无 |
| 托管 | `/Library/...` | 否 | — |

**P-03 今天的改道与放行,真引擎实测成功。**(测;真嵌入引擎 + 生产注入 + 真 ext + 真围栏 addon,整个测试进程用生产渲染的 profile 围栏,攻击经引擎自己的 shell 工具发出;`CFD/engine/k-probe.test.ts`,结果 `CFD/engine/out/K-control.json`,日志 `control.log`)

| 编号 | 做法 | 结果(control 臂) |
| --- | --- | --- |
| A1a | 改写显式文件里 `mcp.probe.command` 为工作区脚本 | 引擎热重载后连接器跑的是那个脚本,脚本拿到配置里的令牌 `FAKE-CONNECTOR-TOKEN-k13` |
| A1b | 改写 `codepuppy.jsonc` 里同一条命令 | 主进程直接应用路径的读法 `readMcpLeafStrict`(`ext-config.ts:536-555`,接 `package-mcp-activation.ts:106-113`)读到的就是被换的命令 |
| A2 | 在显式文件与全局目录 `opencode.json` 给一个带密钥的 provider 的模型写 `package: "file://<工作区>/evil-provider.mjs"` | 引擎装载了该模块,模块收到 settings 里的 `apiKey`(`FAKE-BYOK-KEY-k13`),真接收方零请求 |
| A3 | 往工具策略目录拷一份文档:`{selector:{level:"class",class:"third-party-mcp"},state:"enabled"}` | 「请求审批」档调用第三方 MCP 工具从「问」变成「不问」 |
| A4 | `sqlite3` 往引擎库 `permission` 表插一行 `shell / *` | 「请求审批」档的 shell 不再问 |
| A4b | `sqlite3` 把本会话行的 `permission` 改成 `[{shell,*,allow}]` | 同上 |

class 级 `enabled` 记录不需要绑定摘要(`packages/schema/src/codepuppy-tool-policy.ts:78-92`);ext 每次判定都从盘上现读文档(`packages/ext/src/policy/resolver.ts:232-235`)。

**P-04 Code Puppy 自己的决定输入。**(读;全表与写者在 §4.1)四个不显然的:
- 登录 shell 环境快照 `codepuppy-shell-env.json` 由主进程在每次 fork 前套进自己的环境(`server.ts:346-348`),随后成为 sidecar 环境;官方数据库连接器的 `node` / `npx` 按这个 PATH 解析(`official-connector-recipes.ts:58-79`);只剥离一小撮会话控制键(`shell-env-cache.ts:25-37`),`CODEPUPPY_*_URL`、`NODE_OPTIONS`、`npm_config_*` 都不在内。
- `codepuppy.env` 里任何没被设置的键都进主进程环境(`codepuppy-secrets.ts:48-58`)。
- 端点钉选与发现文件决定平台地址,任何 https 主机都接受(`codepuppy-endpoints.ts:1-45`)—— 平台凭据随之去那里。
- 界面设置存储:「自动批准权限」开关(`codepuppy-app/src/context/permission.tsx:333-339`)与按目录 / 会话的自动应答表(`:194-226`)都在 userData 根下的 electron-store 文件里(`store.ts:12-27`;名字:`opencode.settings`、`opencode.updater`、`default.dat`、`opencode.global.dat`、`opencode.workspace.*.dat`、`opencode.draft.*.dat`、`opencode.window.*.dat`,`store-keys.ts:1-2`、`codepuppy-app/src/utils/persist.ts:27-28`、`:349-364`)。开关打开即「零 UI 放行」(`permission.tsx:320-331`)。

**P-05 今天在围栏里写这些位置的写者,全集。**(读 + 测)
- sidecar 注入:种子 `codepuppy.jsonc`(`codepuppy-config-injection.ts:229-235`);显式文件(`:665-666` → `engine-explicit-config.ts:105-110`);模型底表 `models.json`(`:777-787`)。身份 / 行为说明文件(`:263-268`)不在 CF。
- sidecar 监听用户文件与技能变化后重写显式文件(`sidecar.ts:154` → `engine-explicit-config.ts:126-184`)。
- ext 写工具策略文档(`policy/store.ts:84-111` ← `resolver.ts:249-282`),由设置页经引擎插件 RPC 触发(`policy/rpc.ts:1-3`)。
- 引擎 `Config.update` 写全局 `opencode.jsonc`(`config.ts:470-490`);它唯一的路由 `PATCH /global/config` 在 Code Puppy 不服务(`engine-adapter/contract/routes.ts:239`)⇒ 不需要。
- 引擎 Global 启动时 `mkdir -p` 全局配置目录、数据目录等(`packages/util/src/global.ts:66-72`)。目录已存在时被拒写也照常(测 `CFD/run/KF.out`「node mkdirSync / fs.promises.mkdir / mkdir -p (exists)」OK);**不存在**时 EPERM,引擎起不来(测 `CFD/engine/out/change-noprecreate.log`)。
- 引擎「计划」助手写 `~/.opencode/plan/*`(`packages/core/src/plugin/plan.ts:31-40`);用户可选计划助手(`composer-state.ts:58-61`),「请求审批」档也放行 `plan_enter`。
- sidecar 闭包里登记为 W2 的另外两个写盘模块(`codepuppy-installs.ts`、`ext-receipt-v2.ts`,`scripts/process-fence-write-sites.tsv`):闭包 117 个文件里没有调用方(grep `readLedger(|listInstalls(|addReceipt(|removeReceipt(` 只命中定义文件);ext 只读账本、允许集与技能指针(`packages/ext/src/gen-skill-paths.ts:9-66`)。
- 真引擎 change 臂全程(启动、模型调用、连接器调用、主进程写配置后的热重载、策略求值、重启)内核沙箱日志里**没有一条**来自引擎进程的保护集拒绝;5 条拒绝全部来自攻击命令的进程(测 `CFD/engine/out/sandbox-denials-change-timed.txt`)。

**P-06 引擎库里的授权、配置与会话状态。**(读 + 测)
- 已存批准:每次判定都读 `permission` 表并当作 `allow`(`permission.ts:207-214`、`:235`);Code Puppy 从不写它 —— 「本次会话内允许」只在内存(`permission.ts:183-188`、`:409-412`)。
- 会话行规则:每次判定都从库里现读会话行(`session/store.ts:141-143`)并排在 agent 规则之后(`permission.ts:217-222`),后者胜;Code Puppy 唯一的写法是自动化解析会话的一条 `deny`(`automation-llm.ts:54`)。
- wellknown:来源表、清单、配置文档都在 KV(`wellknown.ts:105-139`、`:209-212`),拉不到就用缓存装载成配置文档,policy 排在托管之后、高于所有用户层(`config.ts:183-205`、`:353-372`)。Code Puppy 没有登记 wellknown 来源的入口:登记路由 `POST /api/experimental/integration/wellknown`(`packages/protocol/src/groups/integration.ts:46` → `packages/server/src/handlers/integration.ts:89-95`)不在引擎适配器的路由表里,`packages/ui-mac/src` 与 `packages/codepuppy-app/src` 里 grep `wellknown` 为零;唯一的历史来源 —— 独立 OpenCode 的 `auth.json` 导入迁移 —— 主进程在 fork 前拒绝(`server.ts:509-513`)。
- 会话所用的 agent:每一步重新装载上下文时从库里读会话行的 agent(`session/context.ts:133`、`session/runner/llm.ts:242`),重启后续跑也读它(`packages/server/src/process.ts:250-251`);界面每发一条消息先 `switchAgent` 到该档位(`engine-adapter/opencode2/routes.ts:126-135`)。
- 测:A4 / A4b 在 change 臂照样成功(`K-change.json`)—— 围栏关不住引擎库,必须在引擎读取处处理。

**P-07 程序本体所在的缓存。**(读)引擎装非内置 provider / 插件包到 `<XDG_CACHE_HOME>/opencode/npm`(`packages/util/src/npm.ts:139`);`rg` 等先按 PATH 找、找不到才用 `<cache>/opencode/bin`(`packages/core/src/util/which.ts:5-14`、`ripgrep/binary.ts:69`);官方数据库连接器是 `npx -y @bytebase/dbhub@1.5.0`(`official-connector-recipes.ts:79`),npm 缓存 `~/.npm` = W7;uvx 缓存 `<userData>/uv-cache`(`server.ts:468`)。Code Puppy 注入的 provider 包(`aisdk:@ai-sdk/*`)映射到随引擎打包的模块,不经缓存(`provider.ts:183-206`、`aisdk-native.ts:69-79`)。

**P-08 seatbelt 行为。**(测;`CFD/src/fence-run.c` 与生产 addon 同一个 `sandbox_init`,`CFD/src/render.ts` 用生产渲染器出各臂)
- 只拒写的 `subpath` / `literal` 挡住:追加、截断、同目录写新文件再改名覆盖、工作区文件改名覆盖、`RENAME_SWAP`、改名移走、往目录里硬链 / 克隆 / 建软链、`chmod`、删除;经软链写法、大小写变体、firmlink `/System/Volumes/Data/…` 写法同样被拒(`CFD/run/KF.out`;对照 `P0.out` 全部成功)。
- `literal` 对**尚不存在**的文件同样挡住新建(`CFD/run/LIT-absent.out`)。
- `(require-all (subpath A) (require-not (subpath A/plan)))` 有效:`~/.opencode/plan` 可写,`~/.opencode` 其余与把 `plan` 改名成 `agent` 都被拒(`KF.out`)。
- `(regex #"^<userData>/[^/]+\.dat$")` 挡住修改与新建任意 `.dat` 存储文件(`KF.out`)。
- 受保护位置本身是软链时,只写软链路径的规则不保护目标(`CFD/run/LINK-target.out`)。
- 不加上级目录节点拒写时,把 userData 或 `~/.local/share/opencode` 整个改名移走成功(`CFD/run/ATT-KnoAnc.out`);加上则被拒,目录里新建 / 改名 / 删文件照常(`KF.out`)。
- 围栏内硬链一个**不可写**的文件被拒(`CFD/run/HL2-P0.out`、`HL2-KF.out`);但改动生效前就存在的硬链别名,经工作区那个名字仍能写进受保护文件(`CFD/run/HL-KF.out`)—— seatbelt 按路径判,不按 inode。

**P-09 接收方与出网。**(读)BYOK 的 `npm` / `baseURL` 只取随 App 的适配器表,目录只决定模型清单(`codepuppy-models.ts:47-79`、`:147-160`);出网放行集合由主进程从注入投影与主进程独写的真源派生(`server.ts:236-262`)。

**P-10 主进程已在 fork 前预建目录。**(读)计划器在渲染前 `mkdirp` 数据、缓存、配置目录与 `~/.npm`(`process-fence-plan.ts:84-94`);路径归一用 `realpathSync.native`(`server.ts:285-286`)。

## 4. 接口契约

### 4.1 受保护集 CF(唯一清单)

**在 CF 里**(围栏内不可写;「写者」= 今天的全部写者;† = 今天在围栏内执行、本设计移到主进程):

| # | 位置(真实路径渲染) | 规则 | 决定什么 | 写者 | 读者 | 围栏内不能写之后 |
| --- | --- | --- | --- | --- | --- | --- |
| CF-1 | Code Puppy 状态根 `<appData>/codepuppy-state`(计划器的 `appStateRoot`);若当前环境根 `codepuppyGlobalRoot` 不在其下,另加它 | subpath | `codepuppy.jsonc`(本地连接器命令 / 参数 / cwd / 环境 / 头,是显式文件的用户层)、`installs.json`、`skills-enabled.json`、`ext-store/*/current.json`、`instructions/`、`automations/`;以及早已主进程独写的真源(自定义节点、远程 MCP、项目信任、出网授权、围栏工作区、官方连接器配置) | 主进程(`engine-config-truth-boot.ts`、`ext-config.ts`、`ext-receipt-v2.ts`、`codepuppy-automations.ts` 等);† sidecar 种子 `codepuppy-config-injection.ts:229-235` | sidecar 合成与注入、ext、主进程直接应用路径 | 种子由主进程在 fork 前做(D6);其余写者本来就在主进程 |
| CF-2 | `<userData>/codepuppy-engine-config/` | subpath | 显式文件(引擎配置的一层)与模型底表 `models.json`(provider 包与地址的底表) | † sidecar 注入、† sidecar 监听 | 引擎 | 主进程在 fork 前写、主进程跑监听(D6) |
| CF-3 | `<userData>/codepuppy-shell-env.json` | literal | sidecar 环境(含 PATH ⇒ 哪个 `node` / `npx` / `uvx` 被执行) | 主进程 `server.ts:361`、`:369` | 主进程 `server.ts:346` | 无 |
| CF-4 | `<userData>/codepuppy.env` | literal | 主进程环境里任意未设置的键 | 用户手写(围栏外) | 主进程 | 无(C1 另有读写拒绝,不冲突) |
| CF-5 | `<userData>/codepuppy-endpoints.json`、`<userData>/codepuppy-discovered-endpoints.json` | literal | 平台 / 账户 / 云 / MCP 地址 ⇒ 平台凭据去向 | 主进程(发现);用户手写钉选(围栏外) | 主进程 | 无 |
| CF-6 | `<userData>/codepuppy-connections/` | subpath | 连接记录与扩展包绑定(哪个包用哪个提供方授权) | 主进程 `codepuppy-connection-store.ts` | 主进程 | 无 |
| CF-7 | `<userData>/opencode.settings`、`<userData>/opencode.updater`、userData 根下全部 `*.dat` | literal ×2 + regex | 界面设置(含「自动批准权限」)、自动应答表、更新设置 | 主进程 electron-store(`store.ts:12-27`) | 主进程、经 IPC 的渲染进程 | 无 |
| CF-8 | 引擎全局配置目录:`engineGlobalConfigDirectory(env, home)` 与 `<XDG_CONFIG_HOME>/opencode`(二者不同则都列) | subpath | 用户全局 opencode 配置与插件 / 工具 / agent / 命令目录;主进程启动对账还从 XDG 那份抬升 `provider`(`engine-config-truth-boot.ts:131-182`) | 主进程(`engine-config-truth-boot.ts`、`ext-config.ts`);用户(围栏外);引擎 `Config.update`(无调用方);引擎 Global mkdir(已存在 ⇒ EEXIST) | 引擎、sidecar 默认拒绝枚举、主进程 | 主进程预建目录(D6) |
| CF-9 | `~/.opencode` 除 `~/.opencode/plan` | require-all / require-not | 不经信任闸的用户全局配置目录 | 引擎计划助手只写 `plan/`(保留);主进程旧桥(已退役) | 引擎 | 计划目录照常可写;主进程预建 `~/.opencode/plan`(D6) |
| CF-10 | `~/opencode.json`、`~/opencode.jsonc` | literal | 不经信任闸的主目录级配置 | 用户(围栏外) | 引擎 | 无(今天 HOME 也不可写;列入是为了让保证不依赖 W 行的细节) |
| CF-11 | `<XDG_DATA_HOME>/opencode/codepuppy-tool-policy/` | subpath | 每个工具「启用 / 每次询问 / 停用」 | † ext `policy/store.ts:84-111` | ext 每次判定 | 写入经窄消息由主进程执行(D7) |

**不在 CF 里**(保持可写;每行一句理由):

| 位置 | 理由 |
| --- | --- |
| `<userData>/opencode/`(引擎 state:锁、持久 PTY)、`engine-scratch-cwd`、`codepuppy-identity.md`、`codepuppy-behavior.md` | 引擎 / sidecar 运行时要写;说明文件是模型读的正文,不决定程序、放行或接收方 |
| `<userData>/codepuppy-live-models.json`、`codepuppy-applied-catalog.json`、`codepuppy-byok-catalog.json` | 只决定模型清单;BYOK 接收方取适配器表(P-09) |
| `<userData>/` 其余(Electron 自身、日志、库备份、诊断) | 不是 R-1 的决定输入;凭据存放点归 C1 |
| `<XDG_DATA_HOME>/opencode/` 其余(引擎库、日志、工具输出、仓库缓存) | 引擎要写;库里的三类记录由 §4.6 处理,其余见 §6 残留 R4 |
| `<XDG_CACHE_HOME>/opencode`、`~/.npm`、`<userData>/uv-cache`、bun 缓存、`/private/tmp`、`$TMPDIR` | 包管理器与引擎要写;程序本体替换见残留 R2 |
| 工作区(W1)与运行期放行(X1) | 项目内容;已允许项目的配置见残留 R1 |

### 4.2 profile 渲染(唯一渲染点 `renderProcessFenceProfile`)

```ts
// packages/ui-mac/src/main/process-fence-profile.ts
/** CF 的一条,路径都已是真实路径(计划器负责,§4.3)。 */
export type ConfigFenceRule =
  | { kind: "subpath" | "literal"; path: string }
  | { kind: "subpath-except"; path: string; keep: string } // CF-9:~/.opencode 除 ~/.opencode/plan
  | { kind: "dat-files"; dir: string }                    // CF-7:dir 下一层的 *.dat
export type ProcessFenceProfileInput = { /* 既有字段不变 */ configFence: readonly ConfigFenceRule[] } // 必填;darwin 上恒非空
```

渲染两块,放在 N4 之后:

```
(deny file-write*
  (subpath "<p>") | (literal "<p>")
  (require-all (subpath "<path>") (require-not (subpath "<keep>")))
  (regex #"^<regexLiteral(dir)>/[^/]+\.dat$"))                ; CF
(deny file-write* (literal "<ancestor>") …)                   ; CF ancestors
```

- 第二块:每条规则锚点(`path`;`dat-files` 取 `dir/x`)的每一级上级目录,从父目录起到 `/` 之前,去重;只拒写节点本身,目录里新建 / 改名 / 删文件照常(P-08)。
- 位置与三份设计的合入顺序:CF 两块写在 N4 之后,与 C1 同侧;X1/X2 在放行块之后、N1 之前。任一合入顺序下 CF 都在 X1 之后;CF 与 C1 都只含拒绝,彼此先后无关。约束只有一条:**任何放行文件写入的规则都不得渲染在 CF 之后。**
- W 行:删 W2(当前环境根)与 W6(`<XDG_CONFIG_HOME>/opencode`)两行;W16 改为 `(subpath "<home>/.opencode/plan")`。CF 末尾拒绝本来就盖过它们,删行是让放行块如实反映「围栏可以写什么」;`WRITABLE_ROOT_IDS` 同步。
- `trimUntilCompiles` 只裁工作区,CF 是固定部分、每次试编译都带着。
- 非 darwin 不渲染(既有声明)。

### 4.3 计划器(`process-fence-plan.ts`)

```ts
export type PlanProcessFenceInput = { /* 既有字段 */ engineConfigDirectory: string } // = server.ts 交给启动文档的同一个值(engineGlobalConfigDirectory(exported.env, exported.home))
```

- CF 位置清单由一个纯函数给出(住在 `process-fence-profile.ts`,输入:userData、appStateRoot、codepuppyGlobalRoot、两个引擎配置目录、home、dataHome;名字取 `USER_DATA_LAYOUT` 与 store 常量),计划器把每个位置写成「真实上级目录 + 名字」;位置已存在且解析到别处(软链)时,再加真实目标(同一种规则)—— 与 C1 的 F2 同一条规则(P-08 软链一项)。真实路径用既有 `deps.realpath`;求不出 ⇒ 拒绝 fork(既有计划失败路径)。
- 「父目录预建」循环(`process-fence-plan.ts:84-94`)增加:CF 里的每个目录位置(CF-1 的两个根、CF-2、CF-6、CF-8 两个、`~/.opencode/plan`、CF-11)。这一步同时让 CF ancestors 冻结的每个节点都已存在,引擎与子进程只会对它们得到 EEXIST(P-05、P-08)。预建失败 ⇒ 抛 ⇒ 拒绝 fork(既有)。

### 4.4 主进程在 fork 前写引擎配置文件,并跑显式文件监听

```ts
// packages/ui-mac/src/main/engine-explicit-config.ts(只在主进程执行)
export type EngineConfigFiles = { explicitConfig: string; models?: string }
/** fork 前调用:合成并原子写显式文件;写或删模型底表;codepuppy.jsonc 缺席且未置逃生阀时先写种子 `{ $schema }`。
 *  layer 与今天注入那一次计算同源(codepuppy-config-injection.ts:329-366):policies = engineModelConfig(buildCodePuppyModelConfig(userData, 平台输入)).policies,
 *  commands = 出厂命令(promptRebrandDisabled 时空),skills = 出厂技能目录 ∪ 已启用技能当前代 ∪ PROJECT_SKILLS_ENTRY;平台输入取启动文档用的同一组值。
 *  任何 IO 错误抛出(消息含路径与 errno,不含内容)。 */
export function writeEngineConfigFiles(input: {
  userDataPath: string
  root: string                 // codepuppyGlobalRoot
  userConfig?: string          // 启动文档 paths.userConfig;缺席 = 逃生阀
  layer: ExplicitLayer
  models: CodePuppyModelConfig | undefined
}): EngineConfigFiles
```

- 调用点:`spawnLocalServer` 里 `pinAppliedCatalog` 之后、计划围栏之前(`server.ts:441` 之后)。抛出 ⇒ 记一行 `[I-13] engine config files could not be written — refusing to fork: <message>` 并拒绝 fork(与 `codepuppy-secrets sync` / `applied model catalog pin` 同一条路径)。
- 启动文档增加两项(`packages/util/src/codepuppy-bootstrap.ts` 的 `paths` 与其校验):`engineExplicitConfig: string`(必填,绝对路径)、`engineModels?: string`(缺席 = 本代没有模型底表)。sidecar 注入用它们填 `config.file` / `models.file`,**不再写** CF-1 / CF-2 里的任何文件;注入失败时显式槽照旧给用户的 `codepuppy.jsonc`。
- 监听:主进程在写完显式文件后用同一个 `watchExplicitSources`(输入照旧:文件、根、用户文件、本代 layer、skills 现算)起监听,本代子进程退出时停掉,下一代 fork 时以新 layer 重起。sidecar 不再起监听(`sidecar.ts:154` 删除)。监听写失败沿用既有日志 `[alpha-code#1667] could not rewrite …` 并保留上一份(引擎继续用上一份好的配置)。

### 4.5 工具策略写入经主进程(既有 `codepuppy.*` 窄消息)

```ts
// packages/ui-mac/src/main/codepuppy-sidecar-messages.ts
export type ToolPolicyWriteRequest =
  | { type: "codepuppy.tool-policy.write.request"; id: number; op: "save"; partition: ToolPolicyPartition; records: ToolPolicyRecord[] }
  | { type: "codepuppy.tool-policy.write.request"; id: number; op: "reset"; partition: ToolPolicyPartition }
export type ToolPolicyWriteReply =
  | { type: "codepuppy.tool-policy.write.reply"; id: number; ok: true; backup?: string }
  | { type: "codepuppy.tool-policy.write.reply"; id: number; error: string } // 不含文档内容

// packages/ext/src/policy/resolver.ts
export type ToolPolicyWriter = {
  save(partition: ToolPolicyPartition, records: readonly ToolPolicyRecord[]): Promise<void>
  reset(partition: ToolPolicyPartition): Promise<{ backup?: string }>
}
export interface ToolPolicyStoreOptions { /* 既有字段 */ readonly write?: ToolPolicyWriter } // 缺省 = 直接调 savePolicyDocument / resetPolicyDocument(CLI、单测)
```

- ext:`registerPolicy` 在有 `process.parentPort` 时传主进程写者;每个请求按自己的 id 等回复;回 `error` 或端口关闭 ⇒ 抛 `ToolPolicyWriteError("io", message)` ⇒ 既有 RPC 错误 `writeFailed` ⇒ 设置页既有失败显示。`mutate` 的「先读、隔离判断、再写」顺序不变,读仍在 ext。
- 主进程:在既有 `codepuppySidecar.receive` 链上接收(`server.ts:589-593`);`baseDir = defaultPolicyBaseDir(join(本代 sidecar 环境算出的 dataHome, "opencode"))`;调用同一组 `savePolicyDocument` / `resetPolicyDocument`(它们先过 `parseToolPolicyDocument` 再原子写,`policy/store.ts:84-111`);写完再回复。形状不对的请求回 `error` 并记一行。
- 顺序:ext 收到 `ok` 之后的下一次 `snapshot` 从盘上读到新文档(主进程先写后回),没有推送时序问题。

### 4.6 引擎读取处的三条规则(已接管文件内的 `codepuppy` 标注块)

| 编号 | 位置 | 规则 | 依据 |
| --- | --- | --- | --- |
| L1 | `packages/core/src/permission.ts:207-214`、`:235` | 判定不再并入 `permission` 表的已存批准(`savedRules` 不参与) | Code Puppy 从不写它(P-06);写它只来自直接改库 |
| L2 | `packages/core/src/permission.ts:217-222` | 会话行上的规则只取 `effect === "deny"` 的条目参与 `configured()` | Code Puppy 只写 `deny`(P-06);`ask` 也去掉,因为它排在 agent 规则之后能把只读档的静态拒绝放松成询问 |
| L3 | `packages/core/src/config.ts:353-372` | 不装载 wellknown 文档(不调 `loadWellknown`,该层为空) | Code Puppy 无登记入口,历史导入被主进程拒绝(P-06) |

`PermissionSaved` 服务与它的 list / update 路由、会话 `setPermissions` 路由原样保留,只是不再使判定放宽。三条都不依赖围栏,非 darwin 同样生效。北极星:两文件均已登记接管(`scripts/north-star-guard.sh:135`、`:175`),新增标注块按既有形状。

### 4.7 写盘登记簿

`scripts/process-fence-write-sites.tsv` 里 `codepuppy-config-injection.ts` 的种子与模型底表两组、`engine-explicit-config.ts` 一组、`packages/ext/src/policy/store.ts` 一组、`codepuppy-installs.ts` 与 `ext-receipt-v2.ts` 的 W2 行,根改为 `main-only`;W2 从 `WRITABLE_ROOT_IDS` 删除后,任何登记在 W2 / W6 的新行都过不了登记簿判据。

### 配置

无新增配置键、开关或常量。

## 5. 数据与失败

不做迁移:所有文件的位置、格式不变;用户已有的 `codepuppy.jsonc`、全局 opencode 配置、`~/.opencode`、工具策略文档、界面设置原样被读。

| 失败窗口 | 结果 | 日志 |
| --- | --- | --- |
| fork 前写显式文件 / 模型底表 / 种子失败 | 拒绝 fork,既有失败与自愈阶梯 | `[I-13] engine config files could not be written — refusing to fork: <路径> <errno>` |
| 预建 CF 目录失败、真实路径求不出 | 拒绝 fork(既有计划失败路径) | 既有 `process fence plan FAILED` |
| 运行中监听重写显式文件失败 | 保留上一份,引擎用上一份好的配置 | 既有 `[alpha-code#1667] could not rewrite …` |
| 用户的 `codepuppy.jsonc` 解析不了 | 只写 Code Puppy 那一层(启动)/ 保留上一份(运行中) | 既有 |
| 工具策略写入:主进程写失败 | 设置页显示写入失败,盘上旧文档不变,不重试 | 主进程一行(路径 + errno);ext 抛 `ToolPolicyWriteError("io")` |
| 工具策略写入:端口关闭(这一代在结束) | 同上;用户重试落在下一代 | 一行 |
| 对话里的工具或命令写 CF | 该工具调用得到 EPERM,如同写任何不可写路径;配置不变 | 工具输出里的错误;内核沙箱日志 |
| 改动之前已存在的硬链别名、仍在运行的旧代进程 | 见残留 R6 | — |

主进程写 CF 不受围栏影响(主进程不在围栏里),所以 R-2 的保存路径没有新的失败形态。

## 6. 架构落点

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| CF 渲染、位置清单、W 行调整 | `packages/ui-mac/src/main/process-fence-profile.ts` | `user-data-layout.ts`、store 常量 | 唯一渲染点(`:138`);`regexLiteral`、`assertSeatbeltSafePath` |
| 真实路径 / 软链目标、预建目录、引擎配置目录输入 | `process-fence-plan.ts`、`server.ts` | 同上 | `deps.realpath`(`.native`)、父目录预建循环、`engineGlobalConfigDirectory` |
| fork 前写显式文件 / 模型底表 / 种子;主进程监听 | `engine-explicit-config.ts`、`server.ts` | `codepuppy-models.ts`、`ext/src/factory-paths`、`ext/src/codepuppy-prompts`、`ext/src/gen-skill-paths` | `writeExplicitConfig`、`watchExplicitSources`、`composeExplicitDocument`、`governedModelsBase` 原样复用 |
| 启动文档两项路径 | `packages/util/src/codepuppy-bootstrap.ts`、`codepuppy-bootstrap-build.ts` | — | 既有 `paths` 校验 |
| sidecar 注入不写盘、不起监听 | `codepuppy-config-injection.ts`、`sidecar.ts` | 启动文档 | — |
| 工具策略写消息 | `codepuppy-sidecar-messages.ts`、主进程 `codepuppySidecar` 接收链、`packages/ext/src/policy/{resolver,index}.ts` | `packages/ext/src/policy/store.ts` | 既有 sidecar→main 按 id 回复的先例(`codepuppy.hub.view.request`) |
| L1、L2 | `packages/core/src/permission.ts`(已接管) | — | 既有 `codepuppy(I-05)` 块 |
| L3 | `packages/core/src/config.ts`(已接管) | — | 既有 `codepuppy(ADR-049)` 块形状 |

- 新目录 / 新模块:无。
- 收敛:「围栏能写什么 / 不能写什么」都在 `process-fence-profile.ts` 一处(约束 K2 更好);显式文件、模型底表与工具策略文档的写者各只剩主进程一处。
- 架构约束:约束 K1(运行权限档位单一权威)无变化;约束 K2 更好。`ext` 不依赖 Electron main 私有模块的约束不变 —— 主进程 import ext 的纯函数,方向与今天一致(`engine-explicit-config.ts:21` 已有先例)。
- 工程标准:不新增配置;错误沿用既有具名错误与日志,不写文件内容。
- 被否决的替代:
  - 把 W3 改成只列引擎需要的子目录(按构造封闭):子进程继承 `XDG_STATE_HOME=<userData>`,第三方工具会在其下写自己的状态,名字无法枚举,会出现用户可见的写失败;按决定输入列拒写清单,对 R-1 已封闭。
  - 用装载期规则忽略围栏可写文档里的可执行 / 放行 / 接收方字段:围栏一种机制已足够;且会让用户自己在全局目录里写的合法插件、agent 失效(拿掉能力)。
  - 让引擎进程比子进程多写库:嵌套沙箱只在策略完全相同时放行,扩展令牌对整棵树生效 —— 同一 seatbelt 树里分不开;在装围栏前打开库要改「装围栏是第一句」,且 SQLite 会按需新开 `-wal` / `-shm`。
  - 在内联层钉死每个注入模型的 `package`(R3-1 的建议):文件已被围栏关住后,剩下的可写配置只有已允许项目的文档,而已允许项目本来就能放插件(在引擎进程内运行),钉包关不住它。
  - 签名或摘要校验配置文件:新子系统。
  - 启动时把链接数大于 1 的受保护文件重写成新 inode:见 §10 留档。
- 安全面:
  - **威胁边界。** 被围栏的引擎进程树里的任何进程 —— 包括引擎自己代模型执行的写文件工具、shell 命令、工具与连接器的子进程及其后代(含脱离父进程者)—— 用任何文件操作(写、建、覆盖改名、交换、删、硬链、克隆、软链、`chmod`、改名上级目录、另一种路径写法)或直接改引擎库,去改变 R-1 的三类决定。可信计算基:主进程;引擎进程本身及它从受保护配置装载的代码(用户自己装的插件在引擎进程内运行,能做引擎能做的一切)。
  - **必须守住的不变量。**
    - **I1** CF 的每个位置及其真实目标在围栏内不可写;它们的每一级上级目录节点不可写;CF 是 profile 里最后的文件规则之一,之后没有任何放行文件写入的规则。
    - **I2** sidecar 进程不写 CF 的任何位置;CF 的写者只在主进程。
    - **I3** 引擎判定权限时不并入已存批准,会话行规则只取 `deny`;引擎不装载 wellknown 文档。
    - **I4** 引擎与子进程需要在其中新建条目的每个被冻结目录节点,在 fork 前已存在。
  - **残留(每条带前提与处置)。**
    - **R1 已允许项目的配置。** 在用户允许过的项目里,会话目录及其 HOME 以下祖先的 opencode 文档按装载时的内容生效,包括对话在那里写进去的改动(放行规则、MCP 命令、模型包)。前提:用户允许过该项目,且对话在那个文件夹有一次获批或自动批准的写入。处置:接受 —— 这就是 ADR-049 的信任本身;关闭它需要「项目配置一变就重新确认」,那是新步骤,作为意图候选交编排器,本设计不加。
    - **R2 缓存里的程序本体与包管理器输入。** 对话能替换一个之后会被执行的包或二进制:引擎的 `npm` / `bin` 缓存(PATH 上没有 `rg` 时用 `bin/rg`)、`~/.npm/_npx`(官方数据库连接器)、`uv-cache`(uvx 连接器)、bun 缓存(仅开发态),以及连接器在项目目录启动时读的项目级 `.npmrc` / uv 配置。这类程序在围栏内运行,收到的是它的配置本来给它的东西(例如官方数据库连接器的 DSN)。前提:一次写入该缓存 + 之后运行同一个包。处置:接受 —— 关闭要由主进程代下载 / 代安装,是新子系统;作为意图候选交编排器。
    - **R3 PATH 里的可写目录。** 用户自己的 PATH 若含工作区内的目录,放在那里的同名程序会被主进程 / 引擎解析到。前提:用户的 PATH 选择。处置:接受。
    - **R4 引擎库里其余记录。** 会话所用的 agent(在已配置的 agent 之间切换,例如从「请求审批」切到默认助手;界面每发一条消息都会重新设置它,所以影响到本回合剩余步骤、重启后续跑的那一个回合与续跑的子任务)、凭据表(在用户已配置的接收方之间换绑)、项目身份行(让另一个文件夹套用用户在某项目里给的工具策略)、插件存储、仓库 / 产物缓存、KV 里的模型目录缓存(只在没有模型底表时读,即运维逃生阀 `CODEPUPPY_MODELS_DISABLE` 之下)。它们自己不定义程序、放行规则或接收方;写它们本身要先有一条获批的命令(「请求审批」档会问,「只读」档拒绝,「全部批准」档本来就不问)。处置:接受。
    - **R5 正文。** 身份 / 行为说明文件、技能正文、项目里的 AGENTS.md 是模型读的文字,不改变程序、放行或接收方,权限照常生效。处置:接受。
    - **R6 改动生效之前留下的东西。** 0.2.4 下对话写进这些位置的内容原样保留(本设计不审计、不修复,无迁移);那时做出的硬链别名仍能写进受保护文件(P-08);那时启动、至今仍在运行的脱离进程保持旧 profile。前提:改动之前的会话。处置:按 §10 D11 接受;旧代脱离进程在重启机器后结束。
    - **R7 非 darwin 没有围栏**(既有声明);L1–L3 与主进程写者照样生效。
  - **实现须出示的证据**(每条都要能失败,入口是真的):
    - **E1** 生产渲染的 profile(含 CF)+ 生产 addon:CF 每个位置 × {追加、截断、同目录写新再改名覆盖、工作区文件改名覆盖、`RENAME_SWAP`、改名移走、往目录硬链 / 克隆 / 软链、`chmod`、删除、建同目录兄弟 / 子目录} 全部 EPERM,事后围栏外读盘原样;经软链写法、大小写变体、firmlink 写法、改名任一上级目录全部失败;某个位置是软链时其真实目标同样被拒。已知的坏(各自必须红):去掉 CF(`P0.out` 全通过);CF 放在放行块之前(`ATT-Kearly.out`);去掉 ancestors 块(`ATT-KnoAnc.out`);X1 渲染在 CF 之后(`ATT-KXwrong-*.out`);软链位置只写链路径(`LINK-target.out`)。
    - **E2** 同一 profile 下这些写入照常:引擎 state、库及 `-wal`、日志、引擎缓存、`~/.npm`、`uv-cache`、计划目录、工作区、userData 里其余文件的新建 / 改名 / 删除;`mkdir -p` / 递归 `mkdirSync` 已存在的受保护目录。全新机器形状(没有 `~/.local/share/opencode`、没有 `~/.opencode`)下引擎正常起来;已知的坏:不预建 ⇒ 引擎在 Global mkdir 处 EPERM 退出(`change-noprecreate.log`)。
    - **E3** 真引擎(sidecar 形状:生产注入、真 ext、真 addon、生产 profile):A1a、A1b、A2(显式文件与全局目录两处)、A3 在 change 臂全部失败,同时模型调用、连接器调用、经主进程的安装 / 停用 / 启用、经主进程的工具策略修改、引擎重启全部正常;运行窗口内内核沙箱日志里来自引擎进程的保护集拒绝为零。已知的坏:control 臂四项全部成功(`K-control.json`)。
    - **E4** L1–L3 经真实入口:被围栏的 shell 用 `sqlite3` 插已存批准、改会话行为 `allow`、写入 wellknown 来源 / 清单 / 缓存文档(文档里带一个本地 MCP 服务器)之后,「请求审批」档 shell 仍问、该 MCP 服务器不出现。已知的坏:去掉 L1 / L2 ⇒ 不问(`K-change.json` 的 A4 / A4b);去掉 L3 ⇒ 服务器出现。
    - **E5** sidecar 启动全程不写 CF:生产形状的 sidecar 启动时内核沙箱日志零 CF 拒绝;引擎拿到的 `config.file` / `models.file` 等于启动文档里主进程写的路径;已知的坏:保留 sidecar 里的 `writeExplicitConfig` ⇒ 出现 EPERM 拒绝且注入失败。
    - **E6** 工具策略:设置页的 setRecord / removeRecord / reset 经消息由主进程写入并在下一次判定生效;令主进程对该目录写失败 ⇒ RPC `writeFailed`、盘上旧文档不变;已知的坏:ext 在 sidecar 里直接写 ⇒ EPERM。
    - **E7** 主进程监听:用户手改 `codepuppy.jsonc`、主进程装一个技能 ⇒ 显式文件由主进程重写、引擎不重启即生效(既有 `package-effect.engine.cases.ts`、`created-plugin.engine.cases.ts` 改为主进程起监听后照样绿)。
    - **E8** 带着 0.2.4 形状的 userData、状态根、全局 opencode 配置、`~/.opencode`、工具策略文档冷启动:连接器、模型、设置、工具策略与升级前相同。
    - **E9** profile 形状:CF 两块在 N4 之后、在 X1 之后(若已合入),路径为真实路径,含软链位置的目标与全部上级目录;`trimUntilCompiles` 丢工作区时 CF 原样。

## 8. 拆分决定

不适用:全部在 alpha-code 一个仓、一个负责方。仓内分片见 §10 D12(由 plan.md 落实)。

## 9. 回滚

不适用:没有数据迁移,文件位置与格式不变。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| D1 声明封闭在 §1 (a)–(c);§6 的 R1–R7 是保证外的残留,不再逐类追加 | sibling D10 的教训;owner「不要设计的过于复杂」;`a20dadb942` |
| D2 一种机制:围栏末尾只拒写的 CF + ancestors,渲染自真实路径与软链目标;W2、W6 删行,W16 收窄到计划目录 | P-01、P-08;`CFD/run/*.out` |
| D3 CF = §4.1 的 11 项;判据是「决定 R-1 三类之一、且今天围栏内可写(或可经 W1 / X1 落到)」;正文、缓存、引擎自身数据不在内。对话侧拒绝的授权:I-13 原话覆盖它点名的四类(合成的引擎配置、`codepuppy-shell-env.json`、引擎全局配置目录、`~/.opencode`);其余几项不另取 owner 原话 —— **编排器裁决(2026-11-20)**:I-13 获批条文的对象是「策略的输入」,且条文自己写明「受保护文件清单…仍待补」,清单由本设计给出;CF-4 / CF-5 / CF-6 决定凭据去向,依据 I-20(owner U-16)与 sibling D10 交来的残留类。对话侧的拒绝写进规格「用户会碰到的限制」,随规格送 owner 批准 | P-02–P-05、P-09;I-13 原文 |
| D4 `~/.opencode` 用 `require-not` 留出 `plan/`,不用拒写名单 | P-05 计划助手写者;P-08 `require-not` 有效;名单开放、`require-not` 封闭 |
| D5 界面设置存储按「userData 根下的 `*.dat` + `opencode.settings` + `opencode.updater`」整类保护(regex),不逐个列名 | P-04 存储名由渲染进程按工作区 / 草稿 / 窗口生成 |
| D6 原来在围栏内的写者移到主进程:fork 前写显式文件 / 模型底表 / 种子,主进程跑同一个监听;启动文档加两项路径;fork 前预建 CF 目录(复用计划器的预建循环) | P-05、P-10;`change-noprecreate.log`;失败照「密钥文件同步」一样拒绝 fork |
| D7 工具策略写入经既有 `codepuppy.*` 窄消息由主进程执行,读仍在 ext | P-03 A3;P-05;既有 sidecar→main 按 id 回复先例 |
| D8 引擎库:围栏关不住,只在读取处处理三类会活过本回合的记录(L1–L3);其余记录列为 R4 | P-06;A4 / A4b 两臂都成功 |
| D9 L2 只保留 `deny`(不保留 `ask`) | P-06;`ask` 排在 agent 规则之后会放松只读档的拒绝 |
| D10 缓存里的程序本体不在保证内(R2) | P-07;关闭需要主进程代下载 = 新子系统 |
| D11 改动之前留下的内容、硬链别名与仍在运行的旧代脱离进程不在保证内;不做 inode 重建、不审计旧内容 | P-08 `HL-KF.out`;同一窗口里对话本可直接写入任意内容,只关别名不能让那段时间留下的状态变可信;无迁移(用户级原则 6)。与 sibling D9 同向。**编排器确认(2026-11-20)**:接受,不做 inode 重建、不审计旧内容 |
| D12 体量 L;三片,各自留下可用产品:① L1–L3(只改引擎两个已接管文件);② CF(暂不含 CF-11)+ W 行 + 计划器预建 + 主进程写显式文件 / 模型底表 / 种子与监听 + 启动文档两项 + 登记簿 —— 必须一次合入,否则 sidecar 的写入会被拒;③ 工具策略写消息 + 把 CF-11 加进 CF | 依赖关系见 §4 |

| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| (尚未送审) | | | | |

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| fork 前把链接数大于 1 的受保护文件重写成新 inode,切断改动前的硬链别名 | 只对顶层决定文件便宜;状态根下有 CAS 与扩展包目录,整树扫描代价未测 | D11 | 编排器若要求关闭 R6 的别名部分 |
| 凭据替换:对话往引擎凭据表写自己的 key / OAuth 令牌,让用户对已配置 provider 或远程 MCP 的请求改用攻击者账户 | 读码所得(`model-resolver.ts:283-304` 凭据优先于配置的 apiKey),未实测;不改变用户凭据的去向,不在 R-1 内 | 不在授权结果内 | 作为意图候选交编排器 |
| 目录缓存的撤销清单是否签名 | `readRevokedTargets` 未核实;只影响会话级授权包的判定 | 与 R-1 无直接关系 | 有人改动 `ext-curation-policy.ts` 时 |
| 对话可删除引擎库或在数据目录放 `auth.json` 让下一次 fork 被拒 | 可用性 / 数据丢失,不是配置改道 | 不在授权结果内 | — |
