---
id: DESIGN-engine-config-fence
title: 对话改不了决定程序、放行与凭据去向的引擎配置 技术设计
summary: 围栏 profile 最末加一块只拒写的 CF(一张封闭清单:Code Puppy 状态根、合成的引擎配置目录、登录 shell 环境快照与密钥环境文件、端点钉选、连接记录、界面设置存储、引擎全局配置目录、整个 ~/.opencode、主目录级 opencode.json、工具策略文档),连同各自真实目标与每一级上级目录节点;运行期放行的解析器认得 CF,放行判定扣掉拒写位置;W2/W6/W10/W16/W19 行删掉;计划助手的计划目录改到引擎数据目录(接管上游 plan.ts 的路径一行,owner 2026-11-20 选定),谁都不再建 ~/.opencode;原来在围栏里写这些位置的写者(合成显式文件与模型底表、种子 codepuppy.jsonc、显式文件监听、ext 的工具策略写入)改在主进程,工具策略写入复用既有 codepuppy.* 窄消息;引擎库里三类会让授权或配置活过本回合的记录(已存批准、会话行上的放行规则、wellknown 缓存文档)在引擎装载时不再生效;用户无感
kind: tech-design
status: approved
spec: SPEC-engine-config-fence
spec_version: 2
review:
  rounds: 2           # R1 审 4875af11e2 全文;R2 审 4875af11e2..6e372bc83f 修订范围(同一 Claude Opus 审查员,只读,非作者)
  reviewed_sha: "6e372bc83f"
  verdict: "R2 FIX-THEN-MERGE;三处更正已落到本版(§10 R2 行);D13 owner 2026-11-20 定为计划目录移到引擎数据目录;规格 v1 经 owner 2026-11-20 批准后由编排器冻结;冻结后落入实现期修订 1(会话行三处只取 deny 并接管 session/context.ts 一行、资格判定专属原因 protected-config、片 ② 计划核对的契约事实、片 ⓪ 的 oh-my-zsh 例外),依据 owner 2026-11-20「两件都同意」"
owners: [owner]
last_reviewed: 2026-11-20
---

# DESIGN-engine-config-fence｜对话改不了决定程序、放行与凭据去向的引擎配置 技术设计

只写决定。文件清单、提交顺序与测试由实现方的 plan.md 写。§3、§7 已退役,编号不复用。标注:**测** = 实测(假数据、临时目录,原始输出在 `~/.cache/alpha-orch/2026-11-19/config-fence-design/`,下称 `CFD/`);**读** = 读代码(版本见 §1);**推** = 推断,未测。

## 1. 基线

- Spec:[SPEC-engine-config-fence](spec.md) v1(owner 2026-11-20 批准:「两份都批准」),由编排器按本设计的保证 (a)–(c) 与 §6 残留写成(返还缺口 G1 由此关闭)。本设计不写规格。
- 授权:INT-safety I-13(owner 2026-11-14 以 [U-10](https://github.com/impharaon/alpha-work/blob/2ead902/docs/intents/originals/INT-safety.chat.md#u-10) 批准),原文「智能体获批的一次写文件就能改掉插件放行策略的输入」,方向「这些位置从围栏可写范围里拿掉或改为只读,必要的写入改由主进程代办」。旧票 alpha-code#1530 与旧计划 #1542 已于 2026-11-15 退役,本设计只继承结果、不继承旧机制。owner 对这一族工作的硬约束(2026-11-19,逐字):「不要设计的过于复杂。」
- 结果(spec 落地前的工作编号):
  - **R-1** 被围栏的进程树里的任何进程(模型调用的工具、shell 命令、连接器子进程及其后代)改不了决定「运行什么程序、哪些工具不问就放行、凭据交给谁」的引擎配置。
  - **R-2** 用户安装 / 启用 / 停用连接器与扩展包、添加模型与密钥、改设置、应用自己的启动,都与今天一样;没有新步骤、提示、等待或设置。
  - **R-3** 原来在围栏里成功、现在被拒的写入,失败要响亮、具体(日志),绝不静默丢掉用户的设置。
- 代码基线:R0 读 `origin/alpha` @ `a20dadb942`(0.2.4);R1 处置所涉的事实按 `origin/alpha` @ `887748b52c`(0.2.6,已含 X1/X2 与运行期放行)重读,文中这些引用都按 `887748b52c` 标行号,其余未动小节的行号仍是 `a20dadb942` 的。
- 平行设计(都改 `packages/ui-mac/src/main/process-fence-profile.ts`,本设计不依赖任何一个先合入,落点见 §4.2):
  - DESIGN-child-process-write-fence 的 X1/X2 与运行期放行:**已随 0.2.6 合入**(`process-fence-profile.ts:180-181`;放行判定 `server.ts:621-632`)。它的解析器今天见到任何拒写块都会停掉放行(P-11),本设计 §4.2 负责让二者共存。
  - DESIGN-stored-credentials-fence 的 C1(`design/secrets-main-only` @ `6450ac5549`):放在网络行之后。它的 §6 把「对话改写围栏内可写的引擎配置,就能改变被合法代入的凭据被送到哪里」作为残留类交给本设计(D10)。

**返还缺口(给编排器,不需要 owner)**

- **G1 没有承载本结果的规格。** 核过:`SPEC-project-engine-config-takeover` 第 49 行把「进程围栏的可写范围(INT-safety I-13)」列为不做;`SPEC-tool-write-fence`、`SPEC-child-process-write-fence` 只管「写不出去」;`SPEC-tool-permission-policy` / `SPEC-tool-policy-settings` 只管策略本身。建议规格逐字采用下面「本设计的保证」(a)–(c) 作为 AC 的结果句,残留照 §6 列。
- **G2 I-24(自动化任务文件在围栏内可写)会被本设计顺带关闭。** 它们在 Code Puppy 状态根下(`codepuppy-automations.ts:16-17`),本设计把整个状态根划出可写集(D2),原因是同一根下的 `codepuppy.jsonc` / 账本 / 允许集 / 技能指针,不是采纳 I-24。用户看不到任何变化(这些文件只由主进程写)。编排器裁决(2026-11-20):I-24 保持原条目,本设计合入后在该条记「随 I-13 关闭」。

**本设计的保证(封闭陈述)**

- (a) 被围栏的进程树里,任何进程都不能新建、修改、替换、改名、删除、硬链或克隆 §4.1 清单 CF 里的任何位置,也不能新建、改名、删除它们任何一级上级目录节点;清单里的位置**本身**是软链时,其真实目标同样受保护;这一点不受工作区并集、运行期项目放行(X1)或其它可写行影响。用户自己在受保护目录**里面**放的、指向清单之外的软链,引擎会跟着走,链目标归它所在位置的规则管,不在本条内(残留 R8)。`~/.opencode` 整个在 CF 里:它不存在时围栏内以任何形式都建不出它,存在时其下任何东西都写不了;计划目录已移到引擎数据目录(D13)。
- (b) 引擎库里三类会让授权或配置活过本回合的记录,引擎不再据以放行或装载:项目级已存批准、会话行上的 `allow` / `ask` 规则、wellknown 缓存的配置文档。
- (c) 原来在围栏里写 CF 位置、且有调用方的每一个写者,现在都在主进程;它的失败响亮(具名日志 + 既有失败路径),不落回围栏内写入。唯一没有搬的是引擎 `Config.update`:它在 Code Puppy 里没有调用方(P-05)。

保证外的残留逐条列在 §6 安全面,每条带前提与处置(关闭或接受)。

**对话侧会遇到的拒绝(用户自己的流程不变)。** 对话里的工具与命令写 CF 位置会得到 EPERM,例如让助手直接改 `~/.config/opencode/`、`~/.opencode/`(整个,含旧计划目录)或 `codepuppy.jsonc`。依据是 I-13 的 owner 批准原话「这些位置从围栏可写范围里拿掉或改为只读,必要的写入改由主进程代办」,它点名了合成的引擎配置、`codepuppy-shell-env.json`、引擎全局配置目录与 `~/.opencode`。CF 里另外几项(界面设置存储、端点钉选、连接记录、工具策略文档、`codepuppy.env`、主目录级 `opencode.json`、Code Puppy 状态根)是同一结果「改不了策略输入」的输入,今天只由主进程或用户在应用外写,用户经设置页、定制中心或应用外编辑的路径都不变。这几项不另取 owner 原话(§10 D3 编排器裁决);对话侧的拒绝写进规格「用户会碰到的限制」。把受保护位置本身或其**里面**的文件夹当项目打开时,写入状态显示专属的一句「这个文件夹是 Code Puppy 或引擎存放配置的位置，对话里不能写入。」(§4.3;状态根里的文件夹仍显示既有那句);包含这些位置的文件夹照常可写,只有里面那一处不可写。

**计划文件的位置(给规格的用户可见变化;owner 2026-11-20 选定,D13)。** 计划文件改存到 `~/.local/share/opencode/plan/`;`~/.opencode/plan/` 里已有的文件不搬,对话里仍能读、不能再改;「清除数据」勾选引擎数据时计划文件一并删除(`data-clear.ts:189-196`)。

## 2. 地面真相

**P-01 围栏结构与规则先后。**(读 + 测)profile 由 `renderProcessFenceProfile` 唯一渲染:`(allow default)` → `(deny file-write*)` → `(allow file-write* W1…W19)` → X1/X2 → N1–N4(`887748b52c`:`process-fence-profile.ts:143-188`)。显式规则后写者胜:拒写块放在放行块之前完全失效(测 `CFD/run/ATT-Kearly.out`,10/11 项攻击成功);X1 若写在拒写块之后,会把受保护目录重新放开(测 `CFD/run/ATT-KXwrong-config.out`、`ATT-KXwrong-ud.out`);X1 在前、拒写块最后则不能(`ATT-KX-config.out`、`ATT-KX-ud.out`:令牌目录里别处可写,受保护位置 EPERM)。

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

**P-05 今天在围栏里写这些位置的写者,全集。**(读 + 测;R1 按 `887748b52c` 重核,引用文件除两处行号外未变)
- sidecar 注入:种子 `codepuppy.jsonc`(`codepuppy-config-injection.ts:230-236`);显式文件(`:671-672` → `engine-explicit-config.ts:105-110`);模型底表 `models.json`(`:783-793`)。身份 / 行为说明文件(`:264-269`)不在 CF。
- sidecar 监听用户文件与技能变化后重写显式文件(`sidecar.ts:171` → `engine-explicit-config.ts:126-184`)。
- ext 写工具策略文档(`policy/store.ts:84-111` ← `resolver.ts:249-282`),由设置页经引擎插件 RPC 触发(`policy/rpc.ts:1-3`)。
- 引擎 `Config.update` 写全局 `opencode.jsonc`(`config.ts:470-490`);它唯一的路由 `PATCH /global/config` 在 Code Puppy 不服务(`engine-adapter/contract/routes.ts:239`)⇒ 不需要。
- 引擎 Global 启动时 `mkdir -p` 全局配置目录、数据目录等(`packages/util/src/global.ts:66-72`)。目录已存在时被拒写也照常(测 `CFD/run/KF.out`「node mkdirSync / fs.promises.mkdir / mkdir -p (exists)」OK);**不存在**时 EPERM,引擎起不来(测 `CFD/engine/out/change-noprecreate.log`)。
- 引擎「计划」助手写 `~/.opencode/plan/*`(`packages/core/src/plugin/plan.ts:31-40`);用户在「全部批准」档可选计划助手(`composer-state.ts:46-61`,P-13)。
- sidecar 闭包里登记为 W2 的另外两个写盘模块(`scripts/process-fence-write-sites.tsv:24-25`、`:55-58`,`887748b52c`):`codepuppy-installs.ts` 的写函数在闭包里没有调用方(grep `readLedger(|listInstalls(|addReceipt(|removeReceipt(` 只命中它自己);`ext-receipt-v2.ts` 的账本读法 sidecar **会调**,而这个读法在遇到坏条目时会在状态根下写一份证据文件 `installs.json.evidence-<hex12>`(`ext-receipt-v2.ts:551-555`)—— 这是它唯一的写,带 `sideEffectFree: true` 时跳过;sidecar 侧的两处调用都带了它(`engine-explicit-config.ts:188`、`ext-disabled-injection.ts:33`)。ext 只读账本、允许集与技能指针(`packages/ext/src/gen-skill-paths.ts:9-66`)。
- 真引擎 change 臂全程(启动、模型调用、连接器调用、主进程写配置后的热重载、策略求值、重启)内核沙箱日志里**没有一条**来自引擎进程的保护集拒绝;5 条拒绝全部来自攻击命令的进程(测 `CFD/engine/out/sandbox-denials-change-timed.txt`)。

**P-06 引擎库里的授权、配置与会话状态。**(读 + 测)
- 已存批准:每次判定都读 `permission` 表并当作 `allow`(`permission.ts:207-214`、`:235`);Code Puppy 从不写它 —— 「本次会话内允许」只在内存(`permission.ts:183-188`、`:409-412`)。
- 会话行规则:每次判定都从库里现读会话行(`session/store.ts:141-143`)并排在 agent 规则之后(`permission.ts:217-222`),后者胜;Code Puppy 唯一的写法是自动化解析会话的一条 `deny`(`automation-llm.ts:54`)。
- wellknown:来源表、清单、配置文档都在 KV(`wellknown.ts:105-139`、`:209-212`),拉不到就用缓存装载成配置文档,policy 排在托管之后、高于所有用户层(`config.ts:183-205`、`:353-372`)。Code Puppy 没有登记 wellknown 来源的入口:登记路由 `POST /api/experimental/integration/wellknown`(`packages/protocol/src/groups/integration.ts:46` → `packages/server/src/handlers/integration.ts:89-95`)不在引擎适配器的路由表里,`packages/ui-mac/src` 与 `packages/codepuppy-app/src` 里 grep `wellknown` 为零;唯一的历史来源 —— 独立 OpenCode 的 `auth.json` 导入迁移 —— 主进程在 fork 前拒绝(`server.ts:509-513`)。
- 会话所用的 agent:每一步重新装载上下文时从库里读会话行的 agent(`session/context.ts:133`、`session/runner/llm.ts:242`),重启后续跑也读它(`packages/server/src/process.ts:250-251`);界面每发一条消息先 `switchAgent` 到该档位(`engine-adapter/opencode2/routes.ts:126-135`)。
- 测:A4 / A4b 在 change 臂照样成功(`K-change.json`)—— 围栏关不住引擎库,必须在引擎读取处处理。
- 会话行还有两处读者(读 + 测,`887748b52c`;实现期返还):
  - **ext**:`packages/ext/src/policy/index.ts:123-132` 的 `ruleset()` 把「agent 规则 + 会话行规则」交给闸门,闸门用它算身份轴的最后一条(`gate.ts:49-50`、`:55-61` 的 `hardDeny`)与「规则要问」(`:163`、`:226`)。交互分支读 `session.data.permissions`,而插件的 `session.get` 返回会话本身(`plugin/host.ts:586`),这个读法拿不到东西;无人值守分支读 `session.permissions`,拿得到。实测(`CFD/r3/SESSION-ROW.out`):交互会话里会话行的 deny 由引擎拒绝、会话行的 allow 盖不过 agent 规则里的身份 deny;**无人值守会话里,会话行的 allow 盖过 agent 规则里的身份 deny,工具照常执行**(`ran writes=1`;无人值守的放行不再调引擎判定,`gate.ts:171`、`:329`)。
  - **引擎会话上下文**:`packages/core/src/session/context.ts:136` 直接把会话行并在 agent 规则之后,决定本次请求里有哪些工具(含 Code Mode 目录,`tool.ts:251-259`、`:381-384` 的 `whollyDisabled`)、技能与连接器说明,不经过 `Permission.configured`。实测(`CFD/r3/SNAPSHOT-ROW.out`):agent 规则拒了某个插件工具的权限动作,会话行写一条 allow 之后,这个工具出现在请求里并执行成功;没有会话行时它不可用。插件工具自己不调引擎判定,整工具拒绝只靠这一处。
  - `schedule/check.ts:301` 属于实验开关 schedules,注入配置固定为关(ADR-047 决策 3);子会话建时复制父会话的规则(`session.ts:314`),之后经同样的读取。

**P-07 程序本体所在的缓存。**(读)引擎装非内置 provider / 插件包到 `<XDG_CACHE_HOME>/opencode/npm`(`packages/util/src/npm.ts:139`);`rg` 等先按 PATH 找、找不到才用 `<cache>/opencode/bin`(`packages/core/src/util/which.ts:5-14`、`ripgrep/binary.ts:69`);官方数据库连接器是 `npx -y @bytebase/dbhub@1.5.0`(`official-connector-recipes.ts:79`),npm 缓存 `~/.npm` = W7;uvx 缓存 `<userData>/uv-cache`(`server.ts:468`)。Code Puppy 注入的 provider 包(`aisdk:@ai-sdk/*`)映射到随引擎打包的模块,不经缓存(`provider.ts:183-206`、`aisdk-native.ts:69-79`)。

**P-08 seatbelt 行为。**(测;`CFD/src/fence-run.c` 与生产 addon 同一个 `sandbox_init`,`CFD/src/render.ts` 用生产渲染器出各臂)
- 只拒写的 `subpath` / `literal` 挡住:追加、截断、同目录写新文件再改名覆盖、工作区文件改名覆盖、`RENAME_SWAP`、改名移走、往目录里硬链 / 克隆 / 建软链、`chmod`、删除;经软链写法、大小写变体、firmlink `/System/Volumes/Data/…` 写法同样被拒(`CFD/run/KF.out`;对照 `P0.out` 全部成功)。
- `literal` 对**尚不存在**的文件同样挡住新建(`CFD/run/LIT-absent.out`)。
- `(require-all (subpath A) (require-not (subpath A/plan)))` 有效:`~/.opencode/plan` 可写,`~/.opencode` 其余与把 `plan` 改名成 `agent` 都被拒(`KF.out`)。
- `(regex #"^<userData>/[^/]+\.dat$")` 挡住修改与新建任意 `.dat` 存储文件(`KF.out`)。
- 受保护位置本身是软链时,只写软链路径的规则不保护目标(`CFD/run/LINK-target.out`)。
- 用户放在受保护目录**里面**、指向可写目录的软链(`~/.config/opencode/plugin` → 工作区里的 dotfiles 目录):经链路径写入照常落到链目标,引擎按 `~/.config/opencode/plugin/x.js` 读它(`CFD/r1/run/NESTED.out`,改前改后都 OK)—— 规则判的是解析后的路径,保证不覆盖这一类(R8)。
- `/.vol/<dev>/<ino>` 写法(R1 第 5 项,`887748b52c` 的 profile + CF):对 subpath 行(显式文件)、literal 行(shell 环境快照)、regex 行(`default.dat`)各试经 `/.vol/<dev>/<文件 inode>` 追加、经 `/.vol/<dev>/<目录 inode>/<名字>` 改名覆盖,另在 subpath 目录里经 `/.vol` 新建 —— 全部 EPERM,对照臂 P0 全部成功(`CFD/r1/run/VOLCASE.out`)。不需要另加规则。
- 大小写(R1 第 6 项):在 userData 新建 `*.DAT` / `*.Dat`、改名覆盖成 `DEFAULT.DAT`、经 `DEFAULT.DAT` 追加;literal 行经 `CODEPUPPY-SHELL-ENV.JSON` 追加、改名覆盖成 `Codepuppy-Shell-Env.json`、以大写名新建尚不存在的 `codepuppy-endpoints.json` —— 全部 EPERM,P0 全部成功。按大小写敏感写的 `\.dat$` 对照臂同样拒绝 `.DAT`(这台机器的卷上 seatbelt 按大小写不敏感匹配);§4.2 仍写成显式的 `\.[dD][aA][tT]$`,不依赖这一点(`CFD/r1/run/VOLCASE.out`)。
- `vnode-type` 过滤(R1 第 4 项):`(allow file-write-create (require-all (literal "~/.opencode") (vnode-type DIRECTORY)))` 编译通过,让 `~/.opencode` 只能以目录的形式被 `mkdir` 出来(软链、普通文件都被拒),但**同一条规则也放行**把工作区里预备好、已经装着 `opencode.json` 与 `plugin/` 的目录**改名**或**克隆**到尚不存在的 `~/.opencode`(`CFD/r1/run/DOT.out` 的 f、g 两臂)。seatbelt 在这里分不出「新建空目录」与「搬来一棵树」。
- 不加上级目录节点拒写时,把 userData 或 `~/.local/share/opencode` 整个改名移走成功(`CFD/run/ATT-KnoAnc.out`);加上则被拒,目录里新建 / 改名 / 删文件照常(`KF.out`)。
- 围栏内硬链一个**不可写**的文件被拒(`CFD/run/HL2-P0.out`、`HL2-KF.out`);但改动生效前就存在的硬链别名,经工作区那个名字仍能写进受保护文件(`CFD/run/HL-KF.out`)—— seatbelt 按路径判,不按 inode。

**P-09 接收方与出网。**(读)BYOK 的 `npm` / `baseURL` 只取随 App 的适配器表,目录只决定模型清单(`codepuppy-models.ts:47-79`、`:147-160`);出网放行集合由主进程从注入投影与主进程独写的真源派生(`server.ts:236-262`)。

**P-10 主进程已在 fork 前预建目录。**(读,`887748b52c`)计划器在渲染前 `mkdirp` 数据、缓存、配置目录与 `~/.npm`(`process-fence-plan.ts:93-101`);路径归一用 `realpathSync.native`(`server.ts:313`)。

**P-11 运行期放行今天见到拒写块就整代停掉。**(读 + 测,`887748b52c`)放行判定先把本代 profile 解析成可写规则(`server.ts:621-627` 调 `processFenceWriteRules`),「已覆盖」的目录不签发(`:631-632` 的 `generationWrites` → `processFenceRulesCover`,`process-fence-profile.ts:236-241`)。解析器对放行块之后出现的任何 `(deny file-write*` 直接抛(`process-fence-profile.ts:207-233`,判据 `process-fence-profile.test.ts:193-195`),`server.ts` 接住后记一行、本代停掉全部运行期放行。实测:0.2.6 的解析器对 0.2.6 生产 profile 解析出 22 条;加上 CF 两块即抛;加上 C1 的上级目录块同样抛;而 C1 的 `(deny file-read* file-write*` 块它**不抛也不解析**,静默放过(`CFD/r1/run/PARSER.out`)。资格判定 `checkWorkspaceDirectory`(`process-fence-profile.ts:413-487`)今天只拦 HOME / 祖先 / 根与应用状态根(同一、在内、包含),原因写 `home-or-app-state`。

**P-12 W10、W19 是两个不依赖引擎配置的出口。**(读 + 测;假 HOME,`CFD/r1/run/Z.out`)`/etc/zshrc` 在 `TERM_PROGRAM` 有值时载入 `/etc/zshrc_$TERM_PROGRAM`(`/etc/zshrc:74`);Apple Terminal 那份在交互式 zsh 启动时执行 `~/.zsh_sessions/$TERM_SESSION_ID.session` 再删掉它(`/etc/zshrc_Apple_Terminal` 的 Resume 段)。今天的生产 profile 下,围栏内写 `~/.zsh_sessions/x.session` 与 `~/.zcompdump` 都成功,之后**围栏外**的 `zsh -i`(`TERM_PROGRAM=Apple_Terminal TERM_SESSION_ID=x`)执行了植入的标记;rc 里有 `compinit -C -d ~/.zcompdump` 时同样执行。删掉两行后两次写入 EPERM,标记都没有执行。应用自己的终端是 `zsh -l`、环境取 sidecar 的(`packages/core/src/pty.ts:166-184`),而 sidecar 白名单不含 `TERM_PROGRAM` / `TERM_SESSION_ID`(`sidecar-env.ts:30-62`);按这个形状在 PTY 里起围栏内的 `zsh -l`,rc 分别为空、`compinit`、`compinit -C -d ~/.zcompdump`,删行前后输出逐字相同;两种情况下都没有出现 `.zcompdump`(实测);不写会话文件是由系统 rc 推出的(sidecar 环境里没有 `TERM_PROGRAM`,Apple Terminal 那份 rc 不被载入),没有单独计数;历史照常写进 `~/.zsh_history`(W8)。实现期复核(片 ⓪,分支 `fix/fence-drop-zsh-rows` 提交 `18c897b7d7`,宿主测试 `process-fence-zsh-startup.test.ts`,5 个内层用例):上面三种 rc 形状按构造就不会有差别 —— `compdump` 在转储所在目录不可写时提前返回,而 `$HOME` 本身从来不在可写集里;另加的第四种、仿 oh-my-zsh 的形状(**重建**这段顺序:比对转储里的 `#omz revision` / `#omz fpath`,不一致就 `command rm -f "$ZSH_COMPDUMP"`,再 `compinit -i -d`,再追加那两行;种子是一份真实的 compinit 转储加不一致的元数据)在生产 profile 下 shell 启动时恰好多出一行 `rm: <home>/.zcompdump-x-5.9: Operation not permitted`,别无其他;元数据一直不一致时每次启动都会出现这一行(推;只测了一次启动)。owner 2026-11-20「两件都同意」:保留这项修复,在规格里写明这个例外。

**P-13 计划助手什么时候写 `~/.opencode`。**(读,`887748b52c`)用户在输入框选「计划」(chip、Shift+Tab 或装配弹窗的计划行)时引擎以计划助手运行;「请求审批」「只读」两档强制自己的助手,计划 chip 置灰(`composer-state.ts:46-61`),所以只在「全部批准」档可选;2.x 引擎没有让模型自己进计划模式的工具(`grep -rn plan_enter packages/core/src` 零命中)。计划助手只在用户明确要求时写计划文件,且只许写 `~/.opencode/plan/`(提示词 `plugin/plan.ts:14-20`,放行规则 `:40`);插件启动时只算路径、不建目录(`:30`)。写文件工具自动创建缺失的上级目录(`tool/plugin/write.ts:51`),任何写失败都结算成 `Unable to write <路径>`(`:65`)—— 这不是权限拒绝,所以 `plan.ts:44-53` 那句改写不生效。不改计划目录时,若围栏不许创建 `~/.opencode`,用户在时间线上看到一张失败的写文件工具卡,原文 `Unable to write ~/.opencode/plan/<文件>` 带 EPERM,计划正文仍在对话里(推:由代码读出,未在真引擎上跑)。ADR-019 的 owner 裁决(2026-07-07)「alpha 在任何层级不再创建任何 `.opencode`」;owner 的机器上 `~/.opencode` 不存在(编排器 2026-11-20 核对)。

**P-14 计划目录从哪来、谁用它。**(读 + 测,`887748b52c`)`plan.ts:31` 写死 `path.join(global.home, ".opencode", "plan")`(`global.home` = `OPENCODE_TEST_HOME` 或 `os.homedir()`,`packages/util/src/global.ts:16-17`);同一个 `directory` 变量带进提醒正文(`:14-21`,经 `:57-92` 作为合成消息存进会话)、编辑放行(`:40`)与拒绝文案(`:50`)。没有配置项,文件名由模型定。该文件不在接管清单(`scripts/north-star-guard.sh:124` 起),与上游父 `33f94fce96` 逐字相同;上游测试 `packages/core/test/plugin/plan.test.ts:27`、`:164`、`:245`、`:252`、`:264`、`:287` 钉着旧路径。Code Puppy 侧只有三份录下的引擎样本带这个路径(`engine-adapter/fixtures/{catalog,passthrough,routes}.json`,回放时只当数据);没有界面列出计划文件(产物页只列会话目录之内,`local-artifacts.ts:41-46`、`:105`);代码从不读计划文件。已开会话里存的旧提醒与新提醒文本不同,`plan.ts:57-73` 会在下一次请求补一条新提醒(`lastReminder` 只认当前文本,`:110-115`)。引擎自己的工作文件都放在 `global.data` 下(`artifact.ts:216`、`snapshot.ts:96`、`tool-output.ts:57`、`shell.ts:94`、`worktree/strategies.ts:51`),`global.data` = `<XDG_DATA_HOME>/opencode`(`global.ts:13-23`,即 W4,启动时建好 `:68`);完整「清除数据」勾选引擎数据时整个目录被删(`data-clear.ts:189-196`)。CF-9 为整个 `~/.opencode`、删 W16 的 profile(KF3)下,`CFD/r1/run/DOT3.out` 全部按要求(E11)。

## 4. 接口契约

### 4.1 受保护集 CF(唯一清单)

**在 CF 里**(围栏内不可写;「写者」= 今天的全部写者;† = 今天在围栏内执行、本设计移到主进程):

| # | 位置(真实路径渲染) | 规则 | 决定什么 | 写者 | 读者 | 围栏内不能写之后 |
| --- | --- | --- | --- | --- | --- | --- |
| CF-1 | Code Puppy 状态根 `<appData>/codepuppy-state`(计划器的 `appStateRoot`);若当前环境根 `codepuppyGlobalRoot` 不在其下,另加它 | subpath | `codepuppy.jsonc`(本地连接器命令 / 参数 / cwd / 环境 / 头,是显式文件的用户层)、`installs.json`、`skills-enabled.json`、`ext-store/*/current.json`、`instructions/`、`automations/`;以及早已主进程独写的真源(自定义节点、远程 MCP、项目信任、出网授权、围栏工作区、官方连接器配置) | 主进程(`engine-config-truth-boot.ts`、`ext-config.ts`、`ext-receipt-v2.ts`、`codepuppy-automations.ts` 等);† sidecar 种子 `codepuppy-config-injection.ts:230-236` | sidecar 合成与注入、ext、主进程直接应用路径 | 种子由主进程在 fork 前做(D6);其余写者本来就在主进程 |
| CF-2 | `<userData>/codepuppy-engine-config/` | subpath | 显式文件(引擎配置的一层)与模型底表 `models.json`(provider 包与地址的底表) | † sidecar 注入、† sidecar 监听 | 引擎 | 主进程在 fork 前写、主进程跑监听(D6) |
| CF-3 | `<userData>/codepuppy-shell-env.json` | literal | sidecar 环境(含 PATH ⇒ 哪个 `node` / `npx` / `uvx` 被执行) | 主进程 `server.ts:361`、`:369` | 主进程 `server.ts:346` | 无 |
| CF-4 | `<userData>/codepuppy.env` | literal | 主进程环境里任意未设置的键 | 用户手写(围栏外) | 主进程 | 无(C1 另有读写拒绝,不冲突) |
| CF-5 | `<userData>/codepuppy-endpoints.json`、`<userData>/codepuppy-discovered-endpoints.json` | literal | 平台 / 账户 / 云 / MCP 地址 ⇒ 平台凭据去向 | 主进程(发现);用户手写钉选(围栏外) | 主进程 | 无 |
| CF-6 | `<userData>/codepuppy-connections/` | subpath | 连接记录与扩展包绑定(哪个包用哪个提供方授权) | 主进程 `codepuppy-connection-store.ts` | 主进程 | 无 |
| CF-7 | `<userData>/opencode.settings`、`<userData>/opencode.updater`、userData 根下全部 `*.dat`(扩展名不分大小写) | literal ×2 + regex | 界面设置(含「自动批准权限」)、自动应答表、更新设置 | 主进程 electron-store(`store.ts:12-27`) | 主进程、经 IPC 的渲染进程 | 无 |
| CF-8 | 引擎全局配置目录:`engineGlobalConfigDirectory(env, home)` 与 `<XDG_CONFIG_HOME>/opencode`(二者不同则都列) | subpath | 用户全局 opencode 配置与插件 / 工具 / agent / 命令目录;主进程启动对账还从 XDG 那份抬升 `provider`(`engine-config-truth-boot.ts:131-182`) | 主进程(`engine-config-truth-boot.ts`、`ext-config.ts`);用户(围栏外);引擎 `Config.update`(无调用方);引擎 Global mkdir(已存在 ⇒ EEXIST) | 引擎、sidecar 默认拒绝枚举、主进程 | 主进程预建目录(D6) |
| CF-9 | `~/.opencode`(整个) | subpath | 不经信任闸的用户全局配置目录 | 引擎计划助手(今天写 `plan/`,改为写引擎数据目录,§4.8);主进程旧桥(已退役) | 引擎 | 计划目录在 `<XDG_DATA_HOME>/opencode/plan`(§4.8);谁都不新建、不预建 `~/.opencode` 或其下任何东西(ADR-019) |
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
| `~/.zsh_history*`(W8) | 登录 shell 写历史要它;zsh 启动只把它读进历史列表,不执行其中任何一行(W10、W19 不同:它们的内容会被围栏外的 zsh 当代码执行,已删行,D15) |

### 4.2 profile 渲染(唯一渲染点 `renderProcessFenceProfile`)

```ts
// packages/ui-mac/src/main/process-fence-profile.ts
/** CF 的一条,路径都已是真实路径(计划器负责,§4.3)。 */
export type ConfigFenceRule =
  | { kind: "subpath" | "literal"; path: string }
  | { kind: "dat-files"; dir: string }                    // CF-7:dir 下一层的 *.dat,扩展名不分大小写
export type ProcessFenceProfileInput = { /* 既有字段不变 */ configFence: readonly ConfigFenceRule[] } // 必填;darwin 上恒非空
```

渲染两块,放在 N4 之后:

```
(deny file-write*
  (subpath "<p>") | (literal "<p>")
  (regex #"^<regexLiteral(dir)>/[^/]+\.[dD][aA][tT]$"))       ; CF
(deny file-write* (literal "<ancestor>") …)                   ; CF ancestors
```

- 第二块:每条规则锚点(`path`;`dat-files` 取 `dir/x`)的每一级上级目录,从父目录起到 `/` 之前,去重;只拒写节点本身,目录里新建 / 改名 / 删文件照常(P-08)。
- 位置与三份设计的合入顺序:CF 两块写在 N4 之后,与 C1 同侧;X1/X2 在放行块之后、N1 之前。任一合入顺序下 CF 都在 X1 之后;CF 与 C1 都只含拒绝,彼此先后无关。约束只有一条:**任何放行文件写入的规则都不得渲染在 CF 之后。**
- 大小写:扩展名写成显式的 `[dD][aA][tT]`,不依赖卷的大小写规则(P-08 大小写一项)。
- W 行:删 W2(当前环境根)与 W6(`<XDG_CONFIG_HOME>/opencode`)两行 —— CF 末尾拒绝本来就盖过它们,删行是让放行块如实反映「围栏可以写什么」;另删 W10(`~/.zsh_sessions`)与 W19(`~/.zcompdump*`)两行 —— 它们的内容会被围栏外的 zsh 执行(P-12),这一步不依赖 CF,单独成片先落(D15、D12 ⓪)。删 W16(`~/.opencode`):计划目录移到引擎数据目录后,围栏里没有任何写者需要它(D13;与 `plan.ts` 接管同在片 ④)。`WRITABLE_ROOT_IDS` 同步。
- `trimUntilCompiles` 只裁工作区,CF 是固定部分、每次试编译都带着。

**运行期放行的解析与判定(R1 第 1 项)。** 0.2.6 的解析器见到放行块之后的任何拒写块就抛,`server.ts` 接住后整代停掉运行期放行(P-11),所以 CF 与解析器必须同一片落地(D12 ②):

```ts
// packages/ui-mac/src/main/process-fence-profile.ts(改写 887748b52c 的 :198-241)
export type ProcessFenceWriteRule = { kind: "subpath" | "literal" | "regex"; value: string }
export type ProcessFenceWriteRules = { allow: ProcessFenceWriteRule[]; deny: ProcessFenceWriteRule[] }
/** 渲染的严格逆:放行块之后只认 renderProcessFenceProfile 写出的拒写块 ——
 *  · 表头在行首,恰为 `(deny file-write*`(CF、CF ancestors、C1 的上级目录块)或 `(deny file-read* file-write*`(C1);
 *  · 条目只有渲染点写出的三种:`(subpath "…")`、`(literal "…")`、`(regex #"…")`(CF 用全部三种;C1 两块用前两种);
 *  · 块在括号配平处结束(只数引号与 `#"…"` 之外的括号):收尾括号可以落在最后一条条目的行末,其后可带 `;` 注释;
 *    整块写在一行(如 CF ancestors 的 `(deny file-write* (literal …) …)`)同样合法;
 *  · 条目解析进 deny。其余任何含 `file-write` 的行、表头或条目都抛,调用方照旧按「本代不签发」处理。
 *  C1 按兄弟设计的渲染(stored-credentials-fence §4.5,同一种收尾写法)落在这条规则里,无需另立文法。 */
export function processFenceWriteRules(profile: string): ProcessFenceWriteRules
/** 已覆盖 = 某条 allow 盖住 directory 或其祖先,且没有 deny 盖住它:subpath / regex 盖住 directory 或其祖先、literal 等于 directory。
 *  大小写折叠照旧(折叠只会让 deny 多盖,结果是多签一次;X1 盖不过 CF,多签不放开任何位置)。 */
export function processFenceRulesCover(rules: ProcessFenceWriteRules, directory: string): boolean
```

- `server.ts:621-632`:`writeRules` 换成上面的结构,`generationWrites` 传 `{ allow: [...writeRules.allow, ...本代已放行 / 放行中目录], deny: writeRules.deny }`;解析失败的既有处理(记一行、整代不签发)不变。另一个调用方 `process-fence-workspaces.ts:238`(别的代带过来的放行)传 `{ allow: <那组>, deny: [] }` —— CF 之内的文件夹在那之前已被资格判定拦下(§4.3)。
- C1 与 CF 的合入顺序无关:两份设计都经同一个渲染函数、以同一种排版写拒写块;后合入的那份把自己的块加进解析器的往返测试(渲染 → 解析 → 与输入逐条相等)。今天的解析器对 C1 的读写块不抛也不解析(P-11),加进来之后它同样进 deny。
- 文法与渲染不许各走各的:E9 的往返检查(生产渲染的 profile,含 CF;含 CF + C1 → 解析 → deny 与渲染输入逐条相等)在任一侧单独改动时必须变红。
- 非 darwin 不渲染(既有声明)。

### 4.3 计划器(`process-fence-plan.ts`)

```ts
export type PlanProcessFenceInput = { /* 既有字段 */ engineConfigDirectory: string } // = server.ts 交给启动文档的同一个值(engineGlobalConfigDirectory(exported.env, exported.home))
```

- CF 位置清单由一个纯函数给出(住在 `process-fence-profile.ts`,输入:userData、appStateRoot、codepuppyGlobalRoot、两个引擎配置目录、home、dataHome;名字取 `USER_DATA_LAYOUT` 与 store 常量;`opencode.updater` 的存储名只有一个权威常量 `UPDATER_STORE`,store 与本清单都取它),计划器把每个位置写成「真实上级目录 + 名字」;位置已存在且解析到别处(软链)时,再加真实目标(同一种规则)—— 与 C1 的 F2 同一条规则(P-08 软链一项)。真实路径用既有 `deps.realpath`;求不出 ⇒ 拒绝 fork(既有计划失败路径)。
- 「父目录预建」循环(`887748b52c`:`process-fence-plan.ts:93-101`)增加:CF 里的每个目录位置(CF-1 的两个根、CF-2、CF-6、CF-8 两个、CF-11)。**谁都不新建、不预建 `~/.opencode` 或其下任何东西**(ADR-019;计划目录在引擎数据目录下,这一循环本来就预建数据目录,`plan` 由写文件工具懒建,D13)。这一步同时让 CF ancestors 冻结的每个节点都已存在,引擎与子进程只会对它们得到 EEXIST(P-05、P-08)。预建失败 ⇒ 抛 ⇒ 拒绝 fork(既有)。
- 资格判定(R1 第 1 项):CF 的目录位置并入 `checkWorkspaceDirectory`(`887748b52c`:`process-fence-profile.ts:413-487`)的受保护关系,只拦「同一对象或在其内」:

```ts
// process-fence-profile.ts:WorkspaceUnionInput(:300 起)与由它 Pick 出的 WorkspaceDirectoryInput 增加一项(必填)
configFenceRoots: () => readonly string[] // 最近一次计划算出的 CF 目录位置(与渲染同一份,含真实目标;状态根已由 appStateRoot 覆盖,不在其下的环境根照列);
                                          // 本运行尚未计划时由同一纯函数按主进程环境现算;非 darwin 为空
```

  - directory 与某个根是同一对象,或沿 directory 的祖先链遇到该根(dev + ino,与 app 状态根「在内」同一判法)⇒ `{ eligible: false, reason: "protected-config", detail: "inside the protected engine configuration location <root>" }`。这一判定排在既有 HOME / 状态根判定**之后**,所以状态根里的文件夹仍得到 `home-or-app-state` 与既有那句。根不在盘上 ⇒ 里面不可能有东西,跳过。
  - 新原因值 `protected-config` 进入原因联合类型的每一个消费者(片 ② 计划所列):`process-fence-profile.ts` 里的定义;`process-fence-workspaces.ts` 里跟踪器的资格类型与它的三处映射;`workspace-write-probe.ts` 里的两个结果类型;`workspace-writable.ts` 的 `workspaceReadonlyMessage`;zh / en 两份文案;测试运行时的类型。界面句子取规格原文:「这个文件夹是 Code Puppy 或引擎存放配置的位置，对话里不能写入。」
  - 包含某个根 ⇒ 不拦,照常签发;CF 渲染在 X1 之后,里面那一处照旧不可写(`CFD/r1/run/ATT-KF2-X1-config.out`:X1 放行 `~/.config` 后,其中 `other-app/x` 落盘,对 CF 位置与其上级目录的 11 项攻击全部被拒)。
  - 签发前的资格检查(`process-fence-workspaces.ts:369`、`:377`)、W1 选择与开项目登记都走这一个函数,所以在 CF 位置之内的文件夹永不签发,用户看到 §1 那句专属提示。

### 4.4 主进程在 fork 前写引擎配置文件,并跑显式文件监听

```ts
// packages/ui-mac/src/main/engine-explicit-config.ts(只在主进程执行)
export type EngineConfigFiles = { explicitConfig: string; models?: string; userError?: string } // 前两项 = explicitConfigPath(userDataPath) / engineModelsPath(userDataPath);
                                                                                                  // userError:用户的 codepuppy.jsonc 解析不了时带上,主进程照旧记既有那一行「… is not valid …」
export function engineModelsPath(userDataPath: string): string // 新导出,与既有 explicitConfigPath(:32)同模块;两端共用
/** fork 前调用:合成并原子写显式文件;写或删模型底表;codepuppy.jsonc 缺席且未置逃生阀时先写种子 `{ $schema }`。
 *  layer 与今天注入那一次计算同源(codepuppy-config-injection.ts:330-367):policies = engineModelConfig(buildCodePuppyModelConfig(userData, 平台输入)).policies,
 *  commands = 出厂命令(promptRebrandDisabled 时空),skills = 出厂技能目录 ∪ 已启用技能当前代 ∪ PROJECT_SKILLS_ENTRY;平台输入取启动文档用的同一组值。
 *  `governedModelsBase`、`explicitSkillDirs`、`PROJECT_SKILLS_ENTRY` 原样搬进本模块。任何 IO 错误抛出(消息含路径与 errno,不含内容)。 */
export function writeEngineConfigFiles(input: {
  userDataPath: string
  root: string                 // codepuppyGlobalRoot
  userConfig?: string          // 启动文档 paths.userConfig;缺席 = 逃生阀
  layer: ExplicitLayer
  models: CodePuppyModelConfig | undefined
}): EngineConfigFiles
```

- 调用点:`spawnLocalServer` 里 `pinAppliedCatalog` 之后、计划围栏之前(`887748b52c`:`server.ts:466` 之后)。启动文档挪到计划围栏之前构建(内容不变),配置写入在计划之前就用上它的值。抛出 ⇒ 记一行 `[I-13] engine config files could not be written — refusing to fork: <message>` 并拒绝 fork(与 `codepuppy-secrets sync` / `applied model catalog pin` 同一条路径)。
- 启动文档**不加字段**(R1 第 10 项):sidecar 已持有 `userDataPath`,用同一对路径函数得到 `config.file = explicitConfigPath(userDataPath)`,`models.file = existsSync(engineModelsPath(userDataPath)) ? 该路径 : 缺席`(今天这两处在 sidecar 里就是这样算的,`887748b52c`:`codepuppy-config-injection.ts:669-671`、`:783-795`)。主进程每次 fork 前:`models` 在 ⇒ 写;`models` 缺席(含运维逃生阀 `CODEPUPPY_MODELS_DISABLE`,`codepuppy-models.ts:137`)或底表为空 ⇒ **删除** `models.json`;删除失败与写失败同一路径,响亮拒绝 fork。今天 sidecar 在 `models` 缺席时既不删旧文件也不传路径(`codepuppy-config-injection.ts:669`、`:677`),改成按「文件在」判之后,只有主进程这一步删除能保证逃生阀不被上一代留下的文件架空;CF-2 让围栏内建不出它,所以「文件在」就等于「本代有模型底表」。sidecar 注入**不再写** CF-1 / CF-2 里的任何文件;注入失败时显式槽照旧给用户的 `codepuppy.jsonc`。
- 监听:主进程在写完显式文件后用同一个 `watchExplicitSources`(输入照旧:文件、根、用户文件、本代 layer、skills 现算)起监听,本代子进程退出时停掉,下一代 fork 时以新 layer 重起。sidecar 不再起监听(`887748b52c`:`sidecar.ts:171` 删除)。监听写失败沿用既有日志 `[alpha-code#1667] could not rewrite …` 并保留上一份(引擎继续用上一份好的配置)。

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
- 串行(R1 第 7 项):今天 `mutate` 的读与写之间没有 `await`(`887748b52c`:`policy/resolver.ts:248-262`),写改成等主进程回复之后就有了 —— 两次改写会各自读到同一份旧文档、后回的覆盖先回的。`createToolPolicyStore` 内只留一条 promise 链:`setRecord`、`removeRecord`、`reset` 都接在链尾,一次「读 → 判断 → 等写回复」做完才开始下一次;前一次失败不中断链(各自的调用方拿到各自的错误)。
- 主进程:在既有 `codepuppySidecar.receive` 链上接收(`887748b52c`:`server.ts:682-686`);`baseDir = defaultPolicyBaseDir(join(本代 sidecar 环境算出的 dataHome, "opencode"))`;调用同一组 `savePolicyDocument` / `resetPolicyDocument`(它们先过 `parseToolPolicyDocument` 再原子写,`policy/store.ts:84-111`);写完再回复。形状不对的请求回 `error` 并记一行。
- 顺序:ext 收到 `ok` 之后的下一次 `snapshot` 从盘上读到新文档(主进程先写后回),没有推送时序问题。

### 4.6 引擎读取处的三条规则(已接管文件内的 `codepuppy` 标注块)

| 编号 | 位置 | 规则 | 依据 |
| --- | --- | --- | --- |
| L1 | `packages/core/src/permission.ts:207-214`、`:235` | 判定不再并入 `permission` 表的已存批准(`savedRules` 不参与) | Code Puppy 从不写它(P-06);写它只来自直接改库 |
| L2 | `packages/core/src/permission.ts:217-222`;`packages/core/src/session/context.ts:136`;`packages/ext/src/policy/index.ts:123-132`(`ruleset()` 的返回) | 会话行上的规则只取 `effect === "deny"` 的条目 —— 同一条规则落在会话行的三处读取:引擎判定(`configured()`)、本次请求里有哪些工具 / 技能 / 连接器说明(会话上下文)、ext 闸门(交互与无人值守两个分支同一个返回点) | Code Puppy 只写 `deny`(P-06,`automation-llm.ts:54`);`ask` 也去掉,因为它排在 agent 规则之后能把只读档的静态拒绝放松成询问;三处只改一处,另两处仍让会话行的 allow 生效(P-06 实测) |
| L3 | `packages/core/src/config.ts:353-372` | 不装载 wellknown 文档(不调 `loadWellknown`,该层为空) | Code Puppy 无登记入口,历史导入被主进程拒绝(P-06) |

`PermissionSaved` 服务与它的 list / update 路由、会话 `setPermissions` 路由原样保留,只是不再使判定放宽。三条都不依赖围栏,非 darwin 同样生效。北极星:`permission.ts` 与 `config.ts` 已登记接管(`scripts/north-star-guard.sh:135`、`:175`),新增标注块按既有形状。`packages/core/src/session/context.ts` 是新的上游接管,只改 `:136` 这一行(`codepuppy(I-13 L2)` 标注);owner 2026-11-20「两件都同意」即这次接管的同意。实现片按 ADR-029 §3 / ADR-047「精确接管面」加一行(为什么挂不了钩子:这次合并在会话上下文内部完成,插件钩子在它之后才拿到工具表,改不了合并顺序)、`UPSTREAM_EXCLUDES` 加一条、ADR-048 登记册加一项带反向臂(换回上游原文件 ⇒ E4 的快照臂红)。ext 那一处是 Code Puppy 自有代码,不涉及接管。

### 4.7 写盘登记簿

`scripts/process-fence-write-sites.tsv` 里 `codepuppy-config-injection.ts` 的种子与模型底表两组、`engine-explicit-config.ts` 一组、`packages/ext/src/policy/store.ts` 一组、`codepuppy-installs.ts` 与 `ext-receipt-v2.ts` 的 W2 行(`887748b52c`:`:24-25`、`:55-58`),根改为 `main-only`。`ext-receipt-v2.ts` 的读法 sidecar 会调,但两处调用都带 `sideEffectFree: true`,不写证据文件(P-05);那次证据写本身是尽力而为、失败被吞(`ext-receipt-v2.ts:551-558`),所以即使以后漏带,围栏的拒绝也不改变读的结果。W2、W6、W10、W19 从 `WRITABLE_ROOT_IDS` 删除后,任何登记在它们上的新行都过不了登记簿判据。

### 4.8 计划目录移到引擎数据目录(D13;片 ④)

```ts
// packages/core/src/plugin/plan.ts:31(新接管,`codepuppy(I-13 D13)` 标注;原文 path.join(global.home, ".opencode", "plan"))
const directory = path.join(global.data, "plan") // = <XDG_DATA_HOME>/opencode/plan
```

- 接管面只有这一个值:提醒正文(`:14-21`)、编辑放行(`:40`)、拒绝文案(`:50`)都取同一个 `directory`,跟着改,不另动文字。已开会话下一次请求补新提醒(P-14)。`plan` 由写文件工具懒建(`write.ts:51`);数据目录节点被 CF-11 的上级目录块冻结,只冻节点本身,在里面新建照常(`DOT3.out` p1、p2)。
- 实现片的义务(owner 同意:2026-11-20 回复三选一「我建议 A：改存到引擎数据目录」,A 即本设计的计划目录移到引擎数据目录):按 ADR-029 §3 在 ADR-047「精确接管面」加一行(路径、为什么挂不了钩子、守卫、回滚、归属);`scripts/north-star-guard.sh` 的 `UPSTREAM_EXCLUDES` 加 `plan.ts` 与随源的上游测试 `packages/core/test/plugin/plan.test.ts`(只改期望里的目录);ADR-048 登记册加一项,带反向臂(换回上游原文件 ⇒ 计划助手的编辑放行指向 `~/.opencode/plan`,该测试红)。为什么挂不了钩子:目录在插件内部算出并写进存档的提醒、放行与拒绝文案,插件钩子能另加一条放行,改不了告诉模型往哪写的那句提醒。
- 待决意图项「计划目录换成软链 + 路径串放行」在新位置上:链到工作区与今天相同(`DOT3.out` e1),链到 CF 位置按解析后路径被拒、比今天好(e3–e5;P0 下都成功)。
- 用户可见变化见 §1「计划文件的位置」。

### 配置

无新增配置键、开关或常量。

## 5. 数据与失败

不做迁移:所有文件的位置、格式不变;用户已有的 `codepuppy.jsonc`、全局 opencode 配置、`~/.opencode`、工具策略文档、界面设置原样被读。

| 失败窗口 | 结果 | 日志 |
| --- | --- | --- |
| fork 前写显式文件 / 模型底表 / 种子失败,或删模型底表失败 | 拒绝 fork,既有失败与自愈阶梯 | `[I-13] engine config files could not be written — refusing to fork: <路径> <errno>` |
| 预建 CF 目录失败、真实路径求不出 | 拒绝 fork(既有计划失败路径) | 既有 `process fence plan FAILED` |
| 运行中监听重写显式文件失败 | 保留上一份,引擎用上一份好的配置 | 既有 `[alpha-code#1667] could not rewrite …` |
| 用户的 `codepuppy.jsonc` 解析不了 | 只写 Code Puppy 那一层(启动)/ 保留上一份(运行中) | 既有 |
| 工具策略写入:主进程写失败 | 设置页显示写入失败,盘上旧文档不变,不重试 | 主进程一行(路径 + errno);ext 抛 `ToolPolicyWriteError("io")` |
| 工具策略写入:端口关闭(这一代在结束) | 同上;用户重试落在下一代 | 一行 |
| 对话里的工具或命令写 CF | 该工具调用得到 EPERM,如同写任何不可写路径;配置不变 | 工具输出里的错误;内核沙箱日志 |
| 本代 profile 里出现解析器不认识的文件写法 | 本代不签发运行期放行(既有路径);渲染与解析同模块、有往返测试,正常不会发生 | 既有 `process fence: cannot read this generation's write rules — runtime grants are disabled for it` |
| 要设为可写的文件夹是 CF 位置或在其之内 | 不签发,显示「这个文件夹是 Code Puppy 或引擎存放配置的位置，对话里不能写入。」(§1、§4.3) | 既有资格判定日志,detail 带受保护位置 |
| 改动之前已存在的硬链别名、仍在运行的旧代进程 | 见残留 R6 | — |

主进程写 CF 不受围栏影响(主进程不在围栏里),所以 R-2 的保存路径没有新的失败形态。

## 6. 架构落点

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| CF 渲染、位置清单、W 行调整 | `packages/ui-mac/src/main/process-fence-profile.ts` | `user-data-layout.ts`、store 常量 | 唯一渲染点(`887748b52c`:`:143`);`regexLiteral`、`assertSeatbeltSafePath` |
| 放行解析认得拒写块、覆盖判定扣掉拒写、资格判定拦 CF 之内(原因 `protected-config`) | `process-fence-profile.ts`、`server.ts`、`process-fence-workspaces.ts` 的 eligibility 输入与三处映射、`index.ts:979`、`workspace-write-probe.ts`、`renderer/codepuppy-ui/workspace-writable.ts`、zh / en 文案 | 同上 | 既有 `processFenceWriteRules` / `processFenceRulesCover` / `checkWorkspaceDirectory`(唯一身份与资格规则),不另立判定 |
| 真实路径 / 软链目标、预建目录、引擎配置目录输入 | `process-fence-plan.ts`、`server.ts` | 同上 | `deps.realpath`(`.native`)、父目录预建循环、`engineGlobalConfigDirectory` |
| fork 前写显式文件 / 模型底表 / 种子;主进程监听 | `engine-explicit-config.ts`、`server.ts` | `codepuppy-models.ts`、`ext/src/factory-paths`、`ext/src/codepuppy-prompts`、`ext/src/gen-skill-paths` | `writeExplicitConfig`、`watchExplicitSources`、`composeExplicitDocument`、`governedModelsBase` 原样复用 |
| sidecar 注入不写盘、不起监听 | `codepuppy-config-injection.ts`、`sidecar.ts` | `engine-explicit-config.ts` 的两个路径函数 | `explicitConfigPath`;启动文档不变 |
| 工具策略写消息与 `mutate` 串行 | `codepuppy-sidecar-messages.ts`、主进程 `codepuppySidecar` 接收链、`packages/ext/src/policy/{resolver,index}.ts` | `packages/ext/src/policy/store.ts` | 既有 sidecar→main 按 id 回复的先例(`codepuppy.hub.view.request`) |
| L1、L2 | `packages/core/src/permission.ts`(已接管) | — | 既有 `codepuppy(I-05)` 块 |
| L2 的另两处读取 | `packages/core/src/session/context.ts:136`(新接管一行)、`packages/ext/src/policy/index.ts` 的 `ruleset()` | — | 同一条「只取 deny」规则 |
| L3 | `packages/core/src/config.ts`(已接管) | — | 既有 `codepuppy(ADR-049)` 块形状 |
| 计划目录 | `packages/core/src/plugin/plan.ts:31`(新接管)与随源的上游测试 | — | `global.data`(引擎自己存工作文件的目录) |

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
  - 放行解析遇到拒写块就跳过(R1 第 1 项):CF 位置之内的文件夹会被判「已覆盖」、界面显示可写而写不进去;读成 deny 才如实。
  - 复用既有原因 `home-or-app-state`:那句提示的后半句「请打开里面的具体文件夹」对受保护位置之内的文件夹不成立;规格 v1 要求专属一句,改用 `protected-config`(§4.3)。
- 安全面:
  - **威胁边界。** 被围栏的引擎进程树里的任何进程 —— 包括引擎自己代模型执行的写文件工具、shell 命令、工具与连接器的子进程及其后代(含脱离父进程者)—— 用任何文件操作(写、建、覆盖改名、交换、删、硬链、克隆、软链、`chmod`、改名上级目录、另一种路径写法)或直接改引擎库,去改变 R-1 的三类决定。可信计算基:主进程;引擎进程本身及它从受保护配置装载的代码(用户自己装的插件在引擎进程内运行,能做引擎能做的一切)。
  - **必须守住的不变量。**
    - **I1** CF 的每个位置及其真实目标在围栏内不可写;它们的每一级上级目录节点不可写;CF 是 profile 里最后的文件规则之一,之后没有任何放行文件写入的规则。
    - **I2** sidecar 进程不写 CF 的任何位置(它对账本的读取带 `sideEffectFree: true`,不落证据文件);CF 的写者只在主进程。
    - **I3** 引擎判定权限时不并入已存批准;会话行上的规则在每一处读取都只取 `deny` —— 引擎的 `configured()`、会话上下文(本次请求里有哪些工具、技能与连接器说明)、ext 的 `ruleset()`;引擎不装载 wellknown 文档。
    - **I4** 引擎与子进程需要在其中新建条目的每个被冻结目录节点,在 fork 前已存在。`~/.opencode` 不预建:计划目录移走之后,围栏里没有任何写者需要在其中新建条目(D13)。
    - **I5** 运行期放行与 CF 共存:解析器把 CF(与 C1)的拒写块读成 deny,覆盖判定扣掉它们;CF 位置之内的文件夹永不签发,包含它们的文件夹照常签发。
  - **残留(每条带前提与处置)。**
    - **R1 已允许项目的配置。** 在用户允许过的项目里,会话目录及其 HOME 以下祖先的 opencode 文档按装载时的内容生效,包括对话在那里写进去的改动(放行规则、MCP 命令、模型包)。前提:用户允许过该项目,且对话在那个文件夹有一次获批或自动批准的写入。处置:接受 —— 这就是 ADR-049 的信任本身;关闭它需要「项目配置一变就重新确认」,那是新步骤,作为意图候选交编排器,本设计不加。
    - **R2 缓存里的程序本体与包管理器输入。** 对话能替换一个之后会被执行的包或二进制:引擎的 `npm` / `bin` 缓存(PATH 上没有 `rg` 时用 `bin/rg`)、`~/.npm/_npx`(官方数据库连接器)、`uv-cache`(uvx 连接器)、bun 缓存(仅开发态),以及连接器在项目目录启动时读的项目级 `.npmrc` / uv 配置。这类程序在围栏内运行,收到的是它的配置本来给它的东西(例如官方数据库连接器的 DSN)。前提:一次写入该缓存 + 之后运行同一个包。处置:接受 —— 关闭要由主进程代下载 / 代安装,是新子系统;作为意图候选交编排器。
    - **R3 PATH 里的可写目录。** 用户自己的 PATH 若含工作区内的目录,放在那里的同名程序会被主进程 / 引擎解析到。前提:用户的 PATH 选择。处置:接受。
    - **R4 引擎库里其余记录。** 会话所用的 agent(在已配置的 agent 之间切换,例如从「请求审批」切到默认助手;界面每发一条消息都会重新设置它,所以影响到本回合剩余步骤、重启后续跑的那一个回合与续跑的子任务)、凭据表(在用户已配置的接收方之间换绑 —— 这句今天成立的前提是 `provider.use` 白名单(`codepuppy-models.ts:359-361`)不放行那些从凭据元数据推出请求地址的上游 provider 插件:`plugin/provider/credential-settings.ts:28-52`、`gitlab.ts:268-272` 的 `instanceUrl`、`cloudflare-ai-gateway.ts:51` 的 `accountId` / `gatewayId`;以后改这张白名单就是动了本条残留)、项目身份行(让另一个文件夹套用用户在某项目里给的工具策略)、插件存储、仓库 / 产物缓存、KV 里的模型目录缓存(只在没有模型底表时读,即运维逃生阀 `CODEPUPPY_MODELS_DISABLE` 之下)。它们自己不定义程序、放行规则或接收方;写它们本身要先有一条获批的命令(「请求审批」档会问,「只读」档拒绝,「全部批准」档本来就不问)。处置:接受。
    - **R5 正文。** 身份 / 行为说明文件、技能正文、项目里的 AGENTS.md 是模型读的文字,不改变程序、放行或接收方,权限照常生效。处置:接受。
    - **R6 改动生效之前留下的东西。** 0.2.4 下对话写进这些位置的内容原样保留(本设计不审计、不修复,无迁移);那时做出的硬链别名仍能写进受保护文件(P-08);那时启动、至今仍在运行的脱离进程保持旧 profile。前提:改动之前的会话。处置:按 §10 D11 接受;旧代脱离进程在重启机器后结束。
    - **R7 非 darwin 没有围栏**(既有声明);L1–L3 与主进程写者照样生效。
    - **R8 受保护目录里用户自己放的软链。** 保证 (a) 的软链一句只管 CF 位置**本身**。用户在受保护目录里面放了指向围栏可写处的软链(例:`~/.config/opencode/plugin` → 作为项目打开的 dotfiles 仓库里的目录),对话经链目标写进去的内容,引擎照样当作全局配置读(`CFD/r1/run/NESTED.out`:改前改后都落盘)。链目标归它所在位置的规则管。前提:用户自己建了这样的链,且链目标在围栏可写范围内。owner 机器上 `~/.config/opencode` 是空的真实目录、`~/.opencode` 不存在(编排器核对)。处置:接受;关闭需要每次 fork 遍历用户管理的目录树找链 —— 作为意图候选交编排器(用户级原则 6;「不要设计的过于复杂。」)。
    - **R9 登记过的 wellknown 来源仍会被请求。** 引擎库里登记的 wellknown 来源,在启动、凭据切换(`config.ts:432-442`)与每 10 分钟(`config.ts:450-466`)仍会收到不带凭据的 manifest 请求(`wellknown.ts:65-72`、`:153-166`),照常经过出网闸。响应里的 `auth.command` 会被登记成该集成的「命令登录」方式(`wellknown/plugin.ts:14-29`),只在有人调用 `connect/command` 时执行(`integration.ts:615-675`)—— Code Puppy 的接法界面只提供密钥与 OAuth(`dialog-connect-provider.tsx:430`),引擎适配路由表里没有这条路由(`engine-adapter/contract/routes.ts:119-123`),所以不会执行。带凭据与 `{env:}` 替换的 `remote_config` 请求只在装载 wellknown 文档时发出(`config.ts:178-186`),L3 之后不再发生。前提:有人往引擎库写了来源。处置:接受 —— 请求本身不带凭据、不改变 R-1 三类决定;以后若有界面接入命令登录,这一条就变成「运行什么程序」,届时重开。
  - **实现须出示的证据**(每条都要能失败,入口是真的):
    - **E1** 生产渲染的 profile(含 CF)+ 生产 addon:CF 每个位置 × {追加、截断、同目录写新再改名覆盖、工作区文件改名覆盖、`RENAME_SWAP`、改名移走、往目录硬链 / 克隆 / 软链、`chmod`、删除、建同目录兄弟 / 子目录} 全部 EPERM,事后围栏外读盘原样;经软链写法、大小写变体、firmlink 写法、改名任一上级目录全部失败;某个位置是软链时其真实目标同样被拒。已知的坏(各自必须红):去掉 CF(`P0.out` 全通过);CF 放在放行块之前(`ATT-Kearly.out`);去掉 ancestors 块(`ATT-KnoAnc.out`);X1 渲染在 CF 之后(`ATT-KXwrong-*.out`);软链位置只写链路径(`LINK-target.out`)。另有三组写法(R1 第 5、6 项,设计期已跑,`CFD/r1/run/VOLCASE.out`):经 `/.vol/<dev>/<inode>` 追加、经 `/.vol/<dev>/<目录 inode>/<名字>` 改名覆盖与新建(subpath / literal / regex 各一行);`*.DAT` / `*.Dat` 新建、改名覆盖成 `DEFAULT.DAT`、经大写名追加与新建 literal 位置 —— change 臂全部 EPERM,P0 臂全部成功。**保证外对照**(不算失败,R8):受保护目录里用户自建的嵌套软链,经链写入照常落到链目标(`NESTED.out`)。
    - **E2** 同一 profile 下这些写入照常:引擎 state、库及 `-wal`、日志、引擎缓存、`~/.npm`、`uv-cache`、计划目录 `<XDG_DATA_HOME>/opencode/plan`(懒建)、工作区、userData 里其余文件的新建 / 改名 / 删除;`mkdir -p` / 递归 `mkdirSync` 已存在的受保护目录。全新机器形状(没有 `~/.local/share/opencode`、没有 `~/.opencode`)下引擎正常起来;已知的坏:不预建 ⇒ 引擎在 Global mkdir 处 EPERM 退出(`change-noprecreate.log`)。
    - **E3** 真引擎(sidecar 形状:生产注入、真 ext、真 addon、生产 profile):A1a、A1b、A2(显式文件与全局目录两处)、A3 在 change 臂全部失败,同时模型调用、连接器调用、经主进程的安装 / 停用 / 启用、经主进程的工具策略修改、引擎重启全部正常;运行窗口内内核沙箱日志里来自引擎进程的保护集拒绝为零。已知的坏:control 臂四项全部成功(`K-control.json`)。
    - **E4** L1–L3 经真实入口:被围栏的 shell 用 `sqlite3` 插已存批准、改会话行为 `allow`、写入 wellknown 来源 / 清单 / 缓存文档(文档里带一个本地 MCP 服务器)之后,「请求审批」档 shell 仍问、该 MCP 服务器不出现。已知的坏:去掉 L1 / L2 ⇒ 不问(`K-change.json` 的 A4 / A4b);去掉 L3 ⇒ 服务器出现。另加两臂,会话行同样由 `sqlite3` 写入:(i)自动化会话(无人值守标准档),agent 规则拒了某个连接器工具的身份,会话行写一条同身份的 allow ⇒ 仍被拒(`cap-hard-deny`)、零副作用;已知的坏:ext 不过滤会话行 ⇒ 工具执行(`CFD/r3/SESSION-ROW.out`,`ran writes=1`)。(ii)「全部批准」档,agent 规则拒了某个插件工具的权限动作,会话行写一条 allow ⇒ 这个工具不在本次请求的工具表里、调用不可用;已知的坏:会话上下文不过滤 ⇒ 出现并执行成功(`CFD/r3/SNAPSHOT-ROW.out`)。
    - **E5** sidecar 启动全程不写 CF:生产形状的 sidecar 启动时内核沙箱日志零 CF 拒绝(含一份带坏条目的账本:sidecar 侧读取不落证据文件);引擎拿到的 `config.file` / `models.file` 等于主进程写的那两个路径,模型底表被主进程删掉的一代 `models.file` 缺席;逃生阀臂:盘上留着上一代的 `models.json`、置 `CODEPUPPY_MODELS_DISABLE` 启动 ⇒ fork 前文件已删、`models.file` 缺席(已知的坏:主进程只在底表为空时删 ⇒ 旧文件留下、`models.file` 指向它);已知的坏:保留 sidecar 里的 `writeExplicitConfig` ⇒ 出现 EPERM 拒绝且注入失败。
    - **E6** 工具策略:设置页的 setRecord / removeRecord / reset 经消息由主进程写入并在下一次判定生效;令主进程对该目录写失败 ⇒ RPC `writeFailed`、盘上旧文档不变;已知的坏:ext 在 sidecar 里直接写 ⇒ EPERM。并发臂:不等前一个回复连发两次 setRecord(两个不同工具)⇒ 两条记录都在盘上;已知的坏:去掉串行 ⇒ 后回的那次覆盖掉前一条。
    - **E7** 主进程监听:用户手改 `codepuppy.jsonc`、主进程装一个技能 ⇒ 显式文件由主进程重写、引擎不重启即生效(既有 `package-effect.engine.cases.ts`、`created-plugin.engine.cases.ts` 改为主进程起监听后照样绿)。plan.md 注意(R1 第 9 项,实测更正):E7 点名的六个引擎用例与 `official-connectors.cases.ts:1044` 在 L1–L3 下照样通过,不用改。受影响的是:ext 的两个证明用例 `session-grant.test.ts`、`session-grant-restart.test.ts`(它们的已知坏臂依赖会话行的 allow 生效,改为断言只有 deny 生效);钉住上游已知红的清单 `session-grant-upstream-reds.test.ts` 从 10 条变为 74 条;core `config.test.ts` 里 5 条没有闸门的上游 wellknown 用例(L3)。
    - **E8** 带着 0.2.4 形状的 userData、状态根、全局 opencode 配置、`~/.opencode`、工具策略文档冷启动:连接器、模型、设置、工具策略与升级前相同。
    - **E9** profile 形状:CF 两块在 N4 之后、在 X1 之后,路径为真实路径,含软链位置的目标与全部上级目录;`trimUntilCompiles` 丢工作区时 CF 原样。运行期放行与 CF 共存(R1 第 1 项):生产 profile(含 CF)+ 真引擎,本运行新打开一个项目 ⇒ 它拿到放行、对话写进去的文件落盘;在 CF 位置之内的文件夹 ⇒ 资格判定拒绝、零签发;包含 CF 位置的文件夹 ⇒ 签发,里面那一处仍 EPERM;解析器对 CF 两块与 C1 两块的往返逐条相等。已知的坏:解析器不改 ⇒ 本代放行被停、新项目写入失败(设计期已证前半:0.2.6 解析器对含 CF 的 profile 抛,对 C1 上级目录块抛,`CFD/r1/run/PARSER.out`)。
    - **E10** W10 / W19(D15,D12 ⓪,设计期已跑,`CFD/r1/run/Z.out`,假 HOME):今天的生产 profile 下,围栏内写 `~/.zsh_sessions/x.session` 与 `~/.zcompdump` 成功,之后围栏外 `zsh -i`(`TERM_PROGRAM=Apple_Terminal TERM_SESSION_ID=x`;rc 带 `compinit -C -d ~/.zcompdump`)执行了植入内容 —— 这是已知的坏;删两行后两次写入 EPERM、植入内容不执行;应用终端形状(围栏内 PTY 里的 `zsh -l`,sidecar 形状环境,rc 为空 / `compinit` / `compinit -C`)删行前后输出逐字相同(`Z-pty-*.norm`;不出现 `.zcompdump` 是实测,不写会话文件由系统 rc 推出;三种形状按构造无差别,见 P-12)。实现期在生产 addon 上重跑同一组,另加仿 oh-my-zsh 的第四臂:生产 profile 下启动只多出一行 `rm: <home>/.zcompdump-x-5.9: Operation not permitted`(`18c897b7d7` 的 `process-fence-zsh-startup.test.ts`)—— 这是规格写明的例外(owner 2026-11-20「两件都同意」),不是失败。plan.md 注意:片 ⓪ 要改的测试 —— `packages/ui-mac/src/main/process-fence-profile.test.ts:80-81`、`:172-173`;`process-fence-write-sites.test.ts:105`;`custom-provider-truth.test.ts:81`。
    - **E11** 计划目录与 CF-9(D13,片 ④):KF3 臂(`CFD/r1/run/DOT3.out`,设计期已跑)—— `~/.opencode` 不存在时 mkdir、递归 mkdir、软链、普通文件、改名搬入(f)、克隆(g)、硬链(g2)全部 EPERM,事后仍不存在;存在时其下写、建、追加、改名移走、chmod、往里搬全部 EPERM,读照常(d5);新位置懒建并写入落盘(p1、p2);P0 臂全部成功(已知的坏)。真引擎臂(实现须出示,**待证**,今天由代码推出):「全部批准」档选「计划」并要求写计划文件 ⇒ 文件落在 `<XDG_DATA_HOME>/opencode/plan/`,写文件工具卡显示该路径;已知的坏:不接管 `plan.ts` ⇒ 写 `~/.opencode/plan/…` 失败。登记册反向臂见 §4.8。

## 8. 拆分决定

不适用:全部在 alpha-code 一个仓、一个负责方。仓内分片见 §10 D12(由 plan.md 落实)。

## 9. 回滚

不适用:没有数据迁移,文件位置与格式不变。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| D1 声明封闭在 §1 (a)–(c);§6 的 R1–R7 是保证外的残留,不再逐类追加 | sibling D10 的教训;owner「不要设计的过于复杂」;`a20dadb942` |
| D2 一种机制:围栏末尾只拒写的 CF + ancestors,渲染自真实路径与软链目标;W2、W6 删行(W10、W19 见 D15;W16 见 D13) | P-01、P-08;`CFD/run/*.out`、`CFD/r1/run/MATRIX-KF2.out`(0.2.6 上重跑) |
| D3 CF = §4.1 的 11 项;判据是「决定 R-1 三类之一、且今天围栏内可写(或可经 W1 / X1 落到)」;正文、缓存、引擎自身数据不在内。对话侧拒绝的授权:I-13 原话覆盖它点名的四类(合成的引擎配置、`codepuppy-shell-env.json`、引擎全局配置目录、`~/.opencode`);其余几项不另取 owner 原话 —— **编排器裁决(2026-11-20)**:I-13 获批条文的对象是「策略的输入」,且条文自己写明「受保护文件清单…仍待补」,清单由本设计给出;CF-4 / CF-5 / CF-6 决定凭据去向,依据 I-20(owner U-16)与 sibling D10 交来的残留类。对话侧的拒绝写进规格「用户会碰到的限制」,随规格送 owner 批准 | P-02–P-05、P-09;I-13 原文 |
| D4(撤回,D13)~~`~/.opencode` 用 `require-not` 留出 `plan/`~~:计划目录已移出,CF-9 为整个 `~/.opencode`,不留口 | D13 |
| D5 界面设置存储按「userData 根下的 `*.dat` + `opencode.settings` + `opencode.updater`」整类保护(regex),不逐个列名 | P-04 存储名由渲染进程按工作区 / 草稿 / 窗口生成 |
| D6 原来在围栏内的写者移到主进程:fork 前写显式文件 / 模型底表 / 种子,主进程跑同一个监听;启动文档不加字段,两端共用路径函数(R1 第 10 项);fork 前预建 CF 目录(复用计划器的预建循环);谁都不建 `~/.opencode` 或其下任何东西(R1 第 4 项、D13) | P-05、P-10、P-13;`change-noprecreate.log`;失败照「密钥文件同步」一样拒绝 fork |
| D7 工具策略写入经既有 `codepuppy.*` 窄消息由主进程执行,读仍在 ext | P-03 A3;P-05;既有 sidecar→main 按 id 回复先例 |
| D8 引擎库:围栏关不住,只在读取处处理三类会活过本回合的记录(L1–L3);其余记录列为 R4 | P-06;A4 / A4b 两臂都成功 |
| D9 L2 只保留 `deny`(不保留 `ask`) | P-06;`ask` 排在 agent 规则之后会放松只读档的拒绝 |
| D10 缓存里的程序本体不在保证内(R2) | P-07;关闭需要主进程代下载 = 新子系统 |
| D11 改动之前留下的内容、硬链别名与仍在运行的旧代脱离进程不在保证内;不做 inode 重建、不审计旧内容 | P-08 `HL-KF.out`;同一窗口里对话本可直接写入任意内容,只关别名不能让那段时间留下的状态变可信;无迁移(用户级原则 6)。与 sibling D9 同向。**编排器确认(2026-11-20)**:接受,不做 inode 重建、不审计旧内容 |
| D12 体量 L;五片,各自留下可用产品:⓪ 删 W10、W19 两行(独立,先落,D15);① L1–L3(引擎两个已接管文件 + 新接管 `session/context.ts:136` 一行 + `packages/ext/src/policy/index.ts` 的 `ruleset()` 返回点过滤);② CF(暂不含 CF-9、CF-11)+ W2 / W6 删行 + 放行解析器认得拒写块、覆盖判定扣掉拒写、资格判定拦 CF 之内 + 计划器预建 + 主进程写 / 删显式文件、模型底表、种子与监听 + 登记簿 —— 必须一次合入,否则 sidecar 的写入会被拒、本代运行期放行会被停;③ 工具策略写消息 + `mutate` 串行 + 把 CF-11 加进 CF;④(在 ② 之后)`plan.ts` 接管与其登记(§4.8)+ CF-9 为整个 `~/.opencode` + 删 W16 —— 三者同一片,已有 `~/.opencode/plan` 的机器在旧路径不可写的同一刻拿到新路径;单独成片是为了让 ② 不夹带上游接管、保持原子 | 依赖关系见 §4;P-11、P-12、P-14 |
| D13 **owner 定(2026-11-20)**:计划目录移到引擎数据目录 `<XDG_DATA_HOME>/opencode/plan`(`path.join(global.data, "plan")`),接管 `packages/core/src/plugin/plan.ts` 的这一个路径值(§4.8);CF-9 为整个 `~/.opencode`,删 W16,谁都不建 `~/.opencode`(ADR-019 对计划助手也成立)。owner 原话(回复编排器的三选一,A = 改存到引擎数据目录):「我建议 A：改存到引擎数据目录」—— 同时是这次新增上游接管的同意。落选:允许围栏内只以目录形式建出 `~/.opencode` —— 预备好的目录树可改名或克隆进来(`DOT.out` f、g);主进程预建 `~/.opencode/plan` —— 与 ADR-019 owner 裁决冲突;不许建也不搬 —— 在没有 `~/.opencode` 的机器上拿掉计划文件这项能力 | P-08 `vnode-type` 一项、P-13、P-14;`DOT.out`、`DOT3.out`;ADR-019(2026-07-07);R1 第 4 项 |
| D14 运行期放行与 CF 共存:解析器只认渲染点写出的两种拒写表头与三种条目、按括号配平定块尾,读成 deny;已覆盖 = 在某条 allow 下且不在任何 deny 下;CF 的目录位置并入 `checkWorkspaceDirectory` 的受保护关系,只拦同一或在内,原因取专属值 `protected-config`(排在既有 HOME / 状态根判定之后),界面一句「这个文件夹是 Code Puppy 或引擎存放配置的位置，对话里不能写入。」(规格 v1) | P-11;`PARSER.out`、`ATT-KF2-X1-*.out`;R1 第 1 项 |
| D15 删 W10、W19:二者的内容会被围栏外的 zsh 执行,删行后围栏内写入 EPERM;应用终端输出不变,唯一例外是 oh-my-zsh 形状的启动多一行 `rm: … Operation not permitted`(owner 2026-11-20「两件都同意」:保留修复,规格写明例外);W8(历史,只读进历史列表)保留 | P-12;`CFD/r1/run/Z.out`、`Z-pty-*.norm`;`18c897b7d7` `process-fence-zsh-startup.test.ts`;R1 第 3 项 |
| D16 会话行「只取 deny」落在会话行的每一处读取:引擎 `configured()`(既有 L2)、会话上下文 `session/context.ts:136`(新接管一行,owner 2026-11-20「两件都同意」即同意)、ext `ruleset()`(返回点过滤,交互与无人值守同一处);`schedule/check.ts:301` 在固定关闭的实验开关后面,不改。当时的退路(只在 ext 里补,Code Mode 目录里仍可能列出被拒的工具)不再需要 | P-06(实现期追加三条);`CFD/r3/SESSION-ROW.out`、`SNAPSHOT-ROW.out`;实现期返还 2026-11-20 |

| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| R1 · 4875af11e2 · 全文 | Claude Opus 审查员(只读,非作者) | 1 Blocker:0.2.6 解析器见到放行块后的拒写块即抛,CF 落地后新项目永远拿不到放行 → **采纳** | §2 P-11;§4.2 解析与覆盖契约;§4.3 资格判定;§5 两行;§6 I5、E9;§10 D12 ②、D14。`r1/parser.ts` → `PARSER.out`:0.2.6 解析器对 P0 解析出 22 条,对 KF2 与 C1 上级目录块抛(已知的坏成立),对 C1 读写块静默放过;`ATT-KF2-X1-config.out`:X1 放行包含 CF 位置的目录后 11 项攻击仍拒、6 项普通写入落盘 | E9 的「改后放行照常、文件落盘」一臂要实现后在真引擎上跑 |
| R1 · 4875af11e2 · 全文 | Claude Opus 审查员(只读,非作者) | 2 Major:保证 (a) 的软链一句写宽了 → **收窄宣称,不加机制** | §1 (a) 改写;§2 P-08 加一项;§6 R8;E1 加保证外对照。`r1/reset.sh` + 嵌套链臂 → `NESTED.out`:P0、KF2 两臂经 `~/.config/opencode/plugin` 写入都落到链目标 | 关闭 R8 需逐 fork 遍历用户目录树 —— 意图候选,交编排器 |
| R1 · 4875af11e2 · 全文 | Claude Opus 审查员(只读,非作者) | 3 Major:W10 是出口,W19 同类 → **采纳,独立成片 ⓪ 先落** | §2 P-12;§4.1 不在 CF 表加 W8 一行;§4.2 W 行;§4.7;§6 E10;§10 D12 ⓪、D15。`r1/z.sh` + `z-render.ts` → `Z.out`(假 HOME):(i) 生产 profile 下两处写入成功,围栏外 zsh 执行了植入内容 —— 通过;(ii) 删两行后 EPERM、不执行 —— 通过;(iii) 应用终端形状三种 rc 删行前后输出逐字相同 —— 通过,无新可见消息。系统 rc 实读:`/etc/zshrc:74` 载入 `/etc/zshrc_$TERM_PROGRAM`,后者在启动时 source 会话文件再删 | 无 |
| R1 · 4875af11e2 · 全文 | Claude Opus 审查员(只读,非作者) | 4 Major:不得预建 `~/.opencode`(ADR-019) → **采纳冲突;返还编排器** | §1 (a) 末句;§2 P-08 `vnode-type` 一项、P-13;§4.1 CF-9;§4.2 W16;§4.3 预建撤回;§6 I4、E2;§10 D4、D6、D13。`r1/dot.sh` → `DOT.out`:KF2 下 mkdir 字面量成功(a、a2)、字面量处软链与普通文件被拒(b、c)、懒建后 `opencode.json` / `plugin/` 被拒而 `plan/x.md` 落盘(d1–d3)、`plan` 换成软链后按解析后路径判(e1 落、e2/e3 拒)、改名移走与 chmod 被拒(h)、替换空 `~/.opencode` 被拒(i)—— 规定臂全部通过;但把预备好的目录改名(f)或克隆(g)到不存在的 `~/.opencode` 成功 —— 没有 profile 形式能表达要求,按处置不造机制 | D13 当时待定;计划助手流程、所在档位、用户所见写在 P-13。R2 期间 owner 定为计划目录移到引擎数据目录(D13、§4.8) |
| R1 · 4875af11e2 · 全文 | Claude Opus 审查员(只读,非作者) | 5 Major:`/.vol/<dev>/<ino>` 写法 → **实测,无需加规则** | §2 P-08 一项;§6 E1。`r1/volcase.sh` → `VOLCASE.out`:subpath / literal / regex 三行各自经 `/.vol` 追加与改名覆盖,另加 subpath 目录里经 `/.vol` 新建 —— KF2 与 KF2datCS 全部 EPERM、目标不变;P0 对照全部成功;改后在 0.2.6 上重跑全矩阵 `MATRIX-KF2.out`、`HL-KF2.out`(硬链结论同 P-08,R6) | 无 |
| R1 · 4875af11e2 · 全文 | Claude Opus 审查员(只读,非作者) | 6 Minor:`*.dat` 行的大小写 → **采纳显式写法** | §2 P-08 一项;§4.1 CF-7;§4.2 正则。`VOLCASE.out`:`.DAT` / `.Dat` 新建、改名覆盖成 `DEFAULT.DAT`、经大写名追加、literal 行三种大小写写法 —— 全部 EPERM,P0 全部成功;大小写敏感写法的对照臂 KF2datCS 同样拒绝(本机卷上 seatbelt 不分大小写),设计仍写显式 `[dD][aA][tT]` | 无 |
| R1 · 4875af11e2 · 全文 | Claude Opus 审查员(只读,非作者) | 7 Minor:ext `mutate` 两行改写互相覆盖 → **采纳** | §4.5 串行一条;§6 架构表、E6 并发臂。依据 `policy/resolver.ts:248-262`(读写之间今天无 await) | 并发臂要实现后跑 |
| R1 · 4875af11e2 · 全文 | Claude Opus 审查员(只读,非作者) | 8 Minor:`ext-receipt-v2.ts` 读法会写证据文件 → **改措辞** | §2 P-05;§4.7;§6 I2、E5。`ext-receipt-v2.ts:551-558`(仅 `!sideEffectFree` 时写、失败被吞);sidecar 两处调用 `engine-explicit-config.ts:188`、`ext-disabled-injection.ts:33` 都带 `sideEffectFree: true` | 无 |
| R1 · 4875af11e2 · 全文 | Claude Opus 审查员(只读,非作者) | 9 Minor:引擎用例在会话行写 `allow *` → **记给 plan.md(只改测试)** | §6 E7 加一句 | plan.md 落实 |
| R1 · 4875af11e2 · 全文 | Claude Opus 审查员(只读,非作者) | 10 Optional:去掉启动文档两项路径 → **采纳** | §4.4;§6 架构表;§10 D6。sidecar 今天就在用 `explicitConfigPath(userDataPath)` 与同目录 `models.json`(`codepuppy-config-injection.ts:669-671`、`:783-795`);模型底表以文件存在判 | 无 |
| R1 · 4875af11e2 · 全文 | Claude Opus 审查员(只读,非作者) | 11 ARCH-NOTE:W2 / W6 删行 → **不改** | — | — |
| R1 · 4875af11e2 · 全文 | Claude Opus 审查员(只读,非作者) | 12 Out-of-round:(a) R4 前提;(b) 计划目录软链 + 计划助手路径串放行;(c) C1 行 → **(a) 采纳;(b) 核对;(c) 由第 1 项覆盖** | (a) §6 R4 加 `provider.use` 白名单前提(`codepuppy-models.ts:359-361`、`credential-settings.ts:28-52`、`gitlab.ts:268-272`、`cloudflare-ai-gateway.ts:51`);(b) `DOT.out`:`plan` 换成指向工作区的软链后写入落到链目标,P0 与 KF2 相同(e1);指向 `~/.config/opencode` 时 P0 写入成功、KF2 按解析后路径拒绝(e3)—— 第 4 项的结果没有让它变坏;定下的 D13(计划目录移到引擎数据目录)同样不放宽(`DOT3.out` e1、e3–e5);(c) §4.2 解析文法含 C1 两种表头与往返测试 | (b) 的意图待决项由编排器记;(c) 指向兄弟设计的说明由编排器加 |
| R2 · 6e372bc83f · 修订范围 | Claude Opus 审查员(只读,非作者) | 1 Major:§4.2 解析文法(要求单独一行 `)` 收尾)与本设计自己渲染的块、兄弟设计的 C1 块、实验 profile 的收尾写法相反,照文法实现会对自己的块抛错、退回 R1 Blocker → **采纳** | §4.2 文法改为:行首表头两种;条目只有渲染点写出的三种;块在引号外括号配平处结束,收尾括号可在最后一条条目行末、可带 `;` 注释;单行块合法;其余含 `file-write` 的一律抛;C1 按兄弟设计的渲染同样适用。保留 E9 往返检查(含 CF;含 CF + C1),文法与渲染任一侧单独改动必须变红;D14 同步 | 无 |
| R2 · 6e372bc83f · 修订范围 | Claude Opus 审查员(只读,非作者) | 2 Minor:D13 未定却有多处默认了某个选项 → **采纳;随后 owner 2026-11-20 定 D13(计划目录移到引擎数据目录),按定下的形状统一改写,不再逐处标「随 D13」** | front-matter summary;§1 (a)、对话侧拒绝一句、新增「计划文件的位置」一行(给规格);P-14;§4.1 CF-9;§4.2 渲染类型与草图去掉留口形状、删 W16;§4.3 不预建;新增 §4.8(接管 `plan.ts:31` 与登记义务);§6 架构表、I4、E2、E11;§10 D2、D4(撤回)、D6、D12(片 ④:`plan.ts` 接管 + CF-9 整个 + 删 W16 同片,② 保持原子)、D13(已定,落选项各留一句)。证据 `CFD/r1/run/DOT3.out`(KF3 全部按要求、P0 全部成功) | 真引擎臂(计划文件落在新位置、工具卡显示该路径)待实现出示 |
| R2 · 6e372bc83f · 修订范围 | Claude Opus 审查员(只读,非作者) | 3 Minor:「文件在 = 本代有模型底表」会让 `CODEPUPPY_MODELS_DISABLE` 失效(今天缺席时不删旧文件,`codepuppy-config-injection.ts:669`、`:677`;`codepuppy-models.ts:137`) → **采纳** | §4.4:`models` 缺席或底表为空时主进程 fork 前删除 `models.json`,删除失败响亮拒绝 fork;§5 失败表同一行;E5 加逃生阀臂(旧文件留下即红) | 无 |
| R2 · 6e372bc83f · 修订范围 | Claude Opus 审查员(只读,非作者) | 精确性备注:Z 实验(iii)「不写会话文件」是推断,「不出现 `.zcompdump`」是实测;片 ⓪ 要改的测试 → **采纳** | P-12、E10 改措辞;E10 加 plan.md 注意:`process-fence-profile.test.ts:80-81`、`:172-173`,`process-fence-write-sites.test.ts:105`,`custom-provider-truth.test.ts:81` | 无 |
| 实现期返还 · 片 ① 计划 · §4.6 与保证 (b) | 实现方(片 ① 计划,实验在临时副本) | (a) ext 自己读会话行,无人值守分支不调引擎判定 → **采纳并扩大**:另查出引擎会话上下文也直接读会话行;(b) wellknown 来源仍收到 manifest 请求 → **保证外,记残留** | P-06 追加;§4.6 L2 改为三处读取并接管 `session/context.ts:136`(owner 2026-11-20「两件都同意」);I3;E4 加两臂;E7 更正;R9;D16;D12 ①。证据 `CFD/r3/SESSION-ROW.out`(7 臂)、`SNAPSHOT-ROW.out`(2 臂) | 无 |
| 实现期返还 · 片 ② 计划核对 · 契约文字 | 实现方(片 ② 计划) | 规格 v1 要求受保护位置之内的文件夹有专属一句 → **采纳**:原因值 `protected-config`;`writeEngineConfigFiles` 结果带 `userError`;三项原样搬进 `engine-explicit-config.ts`;`UPDATER_STORE` 唯一权威;启动文档先于计划围栏构建;坏掉的软链 → **留档** | §1;§4.3(资格判定与消费者清单、`UPDATER_STORE`);§4.4;§5;§6 被否决的替代;D14;留档删「交给规格」一行、加坏软链一行 | 无 |
| 实现期返还 · 片 ⓪ 实测 · P-12 / E10 / D15 | 实现方(片 ⓪,`fix/fence-drop-zsh-rows` `18c897b7d7`) | 三种 rc 形状按构造无差别;仿 oh-my-zsh 形状多一行 `rm` 报错 → **owner 选定保留修复、规格写明例外**(owner 2026-11-20「两件都同意」) | P-12、E10、D15;留档加 `ZSH_COMPDUMP` 一行(意图候选) | 无 |

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| fork 前把链接数大于 1 的受保护文件重写成新 inode,切断改动前的硬链别名 | 只对顶层决定文件便宜;状态根下有 CAS 与扩展包目录,整树扫描代价未测 | D11 | 编排器若要求关闭 R6 的别名部分 |
| 凭据替换:对话往引擎凭据表写自己的 key / OAuth 令牌,让用户对已配置 provider 或远程 MCP 的请求改用攻击者账户 | 读码所得(`model-resolver.ts:283-304` 凭据优先于配置的 apiKey),未实测;不改变用户凭据的去向,不在 R-1 内 | 不在授权结果内 | 作为意图候选交编排器 |
| 目录缓存的撤销清单是否签名 | `readRevokedTargets` 未核实;只影响会话级授权包的判定 | 与 R-1 无直接关系 | 有人改动 `ext-curation-policy.ts` 时 |
| 对话可删除引擎库或在数据目录放 `auth.json` 让下一次 fork 被拒 | 可用性 / 数据丢失,不是配置改道 | 不在授权结果内 | — |
| 应用终端的环境设置 `ZSH_COMPDUMP`,指向应用私有、围栏可写的路径(oh-my-zsh 尊重预设值),消掉 oh-my-zsh 启动时那一行 `rm` 报错 | 未实测;只影响 oh-my-zsh 用户在应用终端里看到的那一行 | owner 选择保留修复、规格写明例外(D15);不建机制 | 作为意图候选交编排器 |
| 受保护位置本身是**坏掉的**软链:`realpath` 当它不存在,只保护链本身,之后出现的目标不受保护 | 片 ② 计划核对时读出;围栏内的代码建不出这样的链 | 与 R6 / R8 同类(围栏之外、用户自己留下的状态),不加机制 | — |
