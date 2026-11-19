---
id: DESIGN-stored-credentials-fence
title: 会话里的命令与工具读不到 Code Puppy 存的凭据 技术设计
summary: 凭据文件留在原处;围栏对 Code Puppy 的凭据存放点与崩溃转储目录一律拒读拒写,连同它们的真实目标,并禁止改名其上的每一级目录(profile 最后的文件规则);引擎进程的值只来自主进程:启动消息带全表,续期后推全表,每次引擎配置装载各自向主进程拉全表再解析,只在一张封闭清单的凭据位置代入(内联文档 / 同名连接器条目);主进程不替别名读凭据;经可写引擎配置改变交付去向的一类残留由 INT-safety I-13 关闭;配置里的 {file:} 引用一字不变;用户无感
kind: tech-design
status: approved
spec: SPEC-stored-credentials-fence
spec_version: 1
review:
  rounds: 3           # R1 审 0c2483fda7(F1–F7 采纳);R2 确认 ..1b51d972a8(R2-1–R2-3 采纳,R2-4 裁决 D9);R3 确认 ..2fccc6ae65(R3-1 并入 D10 残留类,R3-2–R3-4 采纳);Codex(GPT-6)会话 01a1f358
  reviewed_sha: "044c5076df"
  verdict: "R1–R3 的 finding 均已处置(§10);声明按编排器裁决 D10 收窄;残留类由 INT-safety I-13 关闭;编排器在 R3 后冻结"
owners: [owner]
last_reviewed: 2026-11-19
---

# DESIGN-stored-credentials-fence｜会话里的命令与工具读不到 Code Puppy 存的凭据 技术设计

只写决定。文件清单、提交顺序与测试由实现方的 plan.md 写。§3、§7 已退役,编号不复用。标注:**测** = 实测(假值、临时目录);**读** = 读代码 / 文档(版本见 §1);**推** = 推断,未测。

## 1. 基线

- Spec:**没有**。现有规格都不承载本结果的 AC(见下方「返还缺口」G1);spec delta 由编排器写,本设计不写规格。`spec` 字段先占 `SPEC-stored-credentials-fence` v0。
- Owner 授权(2026-11-19,逐字):编排器的建议「密钥只留在应用主进程里，用到时由主进程代办，围栏内的进程一律读不到这个目录。这样用户完全无感，但要先出技术方案。」owner 回答「按照你的建议，不要设计的过于复杂。」——后半句作为硬约束:只做让结果成立的最小机制,不造通用凭据代理、不加选项、不为假想需求加层。
- 本设计覆盖的结果(spec 落地前的工作编号):
  - **R-1** 对话里运行的命令与工具(shell、工具、连接器 / MCP 子进程、脚本),在任何权限档都读不到 Code Puppy 在本机存的凭据:用户自己的模型密钥、连接器令牌、Code Puppy 登录凭据。
  - **R-2** 同一批进程改不了、删不掉、挪不走这些凭据文件。
  - **R-3** 模型调用、连接器、登录 / 登出、运行中增删密钥与连接器、续期热应用照常;用户已存的密钥与登录升级后照常可用。
  - **R-4** 用户看不到任何变化:没有新步骤、提示、等待或设置。
  - R-1–R-3 由下面「本设计的保证」(a)–(d) 落实;经可写引擎配置改变凭据交付去向的那一类不在其内(D10)。
- 代码基线:`origin/alpha` @ `a20dadb942`(0.2.4)。平行设计:`design/project-writable`(DESIGN-child-process-write-fence 的 X1/X2),不依赖,落地位置见 §4.5。
- 相邻意图 INT-safety I-13(引擎配置与全局配置目录在围栏内可写):不在范围;它与本设计的交点写在 §6 残留里。

**返还缺口(给编排器,不需要 owner)**

- **G1 没有承载本结果的规格。** 核过:`SPEC-tool-write-fence`、`SPEC-child-process-write-fence`(只管写)、`SPEC-tool-network-egress`(只管网)、`SPEC-custom-provider-keychain`(AC-03/AC-04 只讲自定义密钥离开钥匙串的通路)、`SPEC-project-engine-config-takeover`(第 47 行把配置里的 `{file:}` 列为「读普通内容不设闸」)、alpha-work `SPEC-purpose-bound-cloud-credentials` AC-04。「同用户进程能读这些文件」今天只作为代码注释里的已接受风险存在(`packages/ui-mac/src/main/codepuppy-secret-files.ts:19-21`)。
- **G2 引擎自己保存的第三方远程连接器 OAuth 令牌不在本设计内。** 它们在引擎数据库的凭据表里(`packages/core/src/mcp/oauth.ts:289-330`),引擎进程本身在围栏里、每次连接都要读写它(P-01)。规格措辞宜写成「Code Puppy 自己的凭据存放点」(§4.3 的清单),把引擎库里的令牌写进残留;覆盖它是另一件事。
- **G3 用途绑定规格 AC-04 的措辞。** 它把桌面云 MCP 令牌的取用点写成「文件通道」。本设计后文件仍是唯一来源(主进程读它),引擎进程里的取用点换成由它喂出的内存表;「取用点唯一」不变。措辞是否要改由编排器定。

**本设计的保证(编排器裁决 D10,逐字供规格与告知 owner 使用)**

- (a) 被围栏的进程树里,任何进程都读不到、拷不走、挪不走、改不了 Code Puppy 存在本机的凭据文件(C1:凭据存放点及其真实目标拒读拒写,其上每一级目录拒写,崩溃转储目录拒读拒写)。
- (b) 引擎与 ext 拿到的凭据值只来自内存里的一张表;引擎每次装载配置之前,各自向主进程拉一次这张表(不合并;出错、超时、端口关闭都不用旧表,走既有的恢复路径)。
- (c) 指向凭据存放点的引用,只在一张封闭清单的凭据位置被代入,并且:`codepuppy-secrets/` 下的凭据只从内存里的内联文档代入,连接器令牌只在同名的连接器条目里代入;在其它任何位置,它按普通读取处理,被拒绝。
- (d) 主进程绝不替一个经别名(软链、相对路径、大小写变体、firmlink 写法)指向凭据文件的引用去读它。

**不在本设计保证内的一类残留(D10)**:「对话改写围栏内可写的引擎配置,就能改变一份被合法代入的凭据被送到哪里(换掉连接器的命令、覆盖模型的 `package`,以及任何同类做法)。」关闭它的是 INT-safety I-13(引擎配置在围栏内不可写),由编排器排为下一份设计;本设计不设计它。已知的可写入口列在 §6 安全面,作为 I-13 的输入。R2 留下的「本地连接器凭据是否在保证内」由这条裁决吸收,不另需决定。

## 2. 地面真相

**P-01 围栏只管写与网,读不受限;引擎、ext 与注入同在一个被围栏的进程里,子进程继承。**(读)profile 由 `renderProcessFenceProfile` 唯一渲染:`(allow default)` → `(deny file-write*)` → `(allow file-write* W1…W19)` → N1–N4(`packages/ui-mac/src/main/process-fence-profile.ts:150-180`)。sidecar 在 `start()` 第一句装围栏(`packages/ui-mac/src/main/sidecar.ts:141-145`、`:234-245`)。⇒ 一条普通的拒读规则会连引擎与 ext 一起拦住(P-11)。

**P-02 今天在被围栏的进程里读凭据的代码,全集。**(读;范围 = sidecar 的 import 闭包 117 个文件 + 引擎 core 的 `{file:}` 读者)

| 编号 | 位置 | 读什么 | 何时 |
| --- | --- | --- | --- |
| C-a | `packages/core/src/config.ts:172`(显式文件)、`:294`(内联内容)→ `packages/core/src/config/variable.ts:40-81` | 配置文本里的 `{file:}`:BYOK / 自定义节点 apiKey、云 MCP 生产分支的 Authorization、远程 MCP 真源的 headers / client_secret(含官方 GitHub 连接器)、`codepuppy.jsonc` 里本地连接器的 environment(含官方数据库连接器的 DSN) | 每次配置装载 / 重载 |
| C-b | `packages/core/src/mcp/client.ts:378` | 云 MCP 令牌 | 每次请求 |
| C-c | `packages/ext/src/platform-credential-header.ts:32` | 平台凭据 | 每次模型请求 |
| C-d | `packages/ext/src/cloud-websearch-kill.ts:380`、`cloud-vision.ts:91`、`cloud-vision-hooks.ts:106` | 云 MCP 令牌 | kill-switch 装载 / 每次识图 |
| C-e | `packages/ext/src/cloud-access.ts:13` | 云 MCP 令牌是否存在 | 每次判定 |
| C-f | `packages/ui-mac/src/main/codepuppy-models.ts:108-115`、`:199`;`codepuppy-config-injection.ts:246` | 各凭据是否存在、是否非空 | 每次注入 |

闭包里没有代码碰 `codepuppy.env`、`codepuppy-auth.json`、`codepuppy-byok-keys.json`、`codepuppy-pkce.json`(按 `USER_DATA_LAYOUT` 键名 grep)。

**P-03 引擎配置装载读不到 `{file:}` 时代入空串并记 warning,不抛。**(读)`variable.ts:63-73`;代入值按 JSON 转义(`:76`);`{env:}` 先于 `{file:}` 代入(`:27-37`)。内联内容经 `start()` 选项进引擎、只在内存里(`packages/ui-mac/src/main/engine-server-options.ts:51-54`)。显式文件是 sidecar 把 `codepuppy.jsonc` 合成后写在 userData 下的盘上文件,带着连接器的 `{file:}` 引用(`engine-explicit-config.ts:11-17`);它与 `codepuppy.jsonc` 都在围栏可写集里(`engine-explicit-config.ts:71`、`process-fence-profile.ts:156-157`)。

**P-04 凭据存放点的全部写者,以及引擎今天怎么看到变化。**(读;`grep` 每个写函数的调用方,§4.3 的写者表逐条给出位置)平台凭据与云 MCP 令牌约每 10 分钟续期一次,主进程原子重写、不重启(`codepuppy-secret-files.ts:153-189`,接线 `index.ts:798`)。登录 / 登出 / 换号、增删 BYOK 与自定义节点:结构性重启(`sidecar-lifecycle.ts:10-21`)。扩展包连接器:先写版本目录里的密钥(`codepuppy-mcp-secrets.ts:250-282`),再提交配置,再发重载请求,不重启(`ext-ipc.ts:166-177`)。**官方连接器在运行中**由主进程直接物化或清空运行期明文、再用主进程自己解析出的值调引擎 `mcp.add`(`package-mcp-activation.ts:72`、`:84`、`:109-113`、`:151-162`;保存凭据走 `ext-ipc.ts:1462-1470`),不经过重启,也不经过两个 MCP 写入口。引擎之后的任何配置重载都会再从文件解析一次。主进程这条直接应用路径读出整片叶子(远程的从远程真源,本地的从 `codepuppy.jsonc`,`ext-config.ts:537-549`),再无条件解析其中每一个 `{file:}`(`package-mcp-activation.ts:109`、`:154-164`);启停投影只改 `enabled`、保留其它字段(`ext-install-planner.ts:3503-3506`)。

**P-05 既有的主进程↔sidecar 窄消息与进程内交接。**(读)启动消息只在内存里带一个秘密(`password`,`sidecar.ts:81-99`;发送 `server.ts:665-673`)。main→sidecar 命令分发在 `sidecar.ts:122-139`、`:294-313`;sidecar→main 的请求 / 按 id 回复已有先例(`codepuppy.hub.view.request` 等,`codepuppy-sidecar-messages.ts:88-96`,主进程在 `server.ts:589-593` 的 `child.on("message")` 上接收)。启动文档挂在 `globalThis[Symbol.for("codepuppy.bootstrap")]`,三个 bundle 读同一个槽(`packages/util/src/codepuppy-bootstrap.ts:161-162`、`:241-262`)。

**P-06 Code Puppy 的凭据存放点与明文副本面。**(读)前六项在 userData 下(W3 可写集);第七项在主进程临时目录下(W12);第八项是崩溃转储目录。

| 存放点 | 内容 | 写 / 读 |
| --- | --- | --- |
| `<userData>/codepuppy-secrets/` | 平台凭据、云令牌、MCP 令牌、BYOK 与自定义节点密钥的明文镜像 | 主进程写;今天引擎进程现读 |
| `<userData>/codepuppy-mcp-secrets/` | 扩展包连接器令牌,明文,按版本目录;唯一存放处 | 主进程写;引擎经 `{file:}` 读 |
| `<userData>/codepuppy.env` | 用户手写的明文密钥文件(`codepuppy-secrets.ts:5-24`) | 主进程启动时读 |
| `<userData>/codepuppy-auth.json` | 登录凭据,safeStorage 密文(`data-clear.ts:56`) | 主进程 |
| `<userData>/codepuppy-byok-keys.json` | BYOK / 自定义密钥库,safeStorage 密文 | 主进程 |
| `<userData>/codepuppy-pkce.json` | 登录握手临时凭证(`data-clear.ts:57`) | 主进程 |
| `<realpath(tmpdir)>/codepuppy-connectors-<uid>-<hash>/`(`official-connector-recipes.ts:27-56`) | 官方 GitHub 令牌、官方数据库 DSN 的**运行期明文**(密文在 `<appData>/codepuppy-state/connector-secrets/`,`official-connector-resources.ts:154-180`、`:206-226`) | 主进程写;引擎经 `{file:}` 读 |
| `<userData>/Crashpad/`(`logging.ts:42-46`) | 各进程的崩溃转储;调试导出会打包它(`logging.ts:73`) | 崩溃处理进程写(由主进程启动,不在围栏里) |

**P-07 真引擎复现原发现,且写也挡不住。**(测;真嵌入引擎 + 生产注入 + 真 ext + 真围栏 addon,整个测试进程用生产渲染的 profile 围栏;`~/.cache/alpha-orch/2026-11-19/secrets-design/engine/c-probe.test.ts`,`engine/out/C-control.json`、`R1-C-control.json`)全部批准档 shell 不问即读到三份假值;请求审批档问一次 shell 后读到;读文件工具问一次「工作区外目录」后读到;只读档读不到。C 探针(`run/P0.out`)另证:围栏内能追加写、新建、`RENAME_SWAP`、改名、删除、硬链、克隆。

**P-08 seatbelt 规则顺序。**(测;`src/render.ts` 用生产渲染器出各臂,`src/fence-run.c` 用与生产 addon 相同的 `sandbox_init`;`run/P1–P3.out`、`run/P5.out`)`(allow default)` 是兜底、不参与先后(P3);显式规则之间后写的胜出:拒写放在 W3 放行之前就失效(P2);平行设计 X1 在 C1 之后则写凭据成功(P5b),之前则 EPERM(P5a)⇒ C1 必须是最后的文件规则。

**P-09 规则里的路径必须是真实路径。**(测)经软链拼出的 C1 一条都不匹配(P4);大小写变体照样匹配(P6)。

**P-10 C1 拦住围栏内能做出的全部途径。**(测;`run/P1.out`)直接读、大小写变体、`dir/../dir/file`、`//./`、软链(到文件 / 到目录)、硬链、克隆、列目录、写、新建、`RENAME_SWAP`、改名、删除:全 EPERM;盘上原样。另有两类见 P-17。

**P-11 只加 C1、不换读法 ⇒ 引擎断。**(测;`engine/out/C-denyonly.json`)模型请求零次到达,回合以具名错误失败。

**P-12 进程模型:值只经消息到达。**(测;`src/main-model.mjs` + `src/sidecar-model.mjs`;`run/B-P1.json`、对照 `run/B-P0.json`)sidecar 与其子进程读文件 EPERM、环境里无值;用表里的值发请求,桩收到假值;更新后收到新值;含 `{env:HOME}"\` 的值经预处理原样往返。注:这个模型等了回执,F5 另测无回执的情形(P-18)。

**P-13 存在性测试仍看得到文件名。**(测)C1 下 node / bun 的 `existsSync` 为 true,`stat` / `ls` / `test -e` 被拒。设计不依赖它:引擎进程里在场性只问表。

**P-14 其它副本与导出面。**(读 + 测)
- `codepuppy-shell-env.json`:登录 shell 输出,最小环境探测(`shell-env.ts:42-56`),只含用户 shell 配置自己导出的值 ⇒ 残留。
- 日志:fork 只记名字(`server.ts:420`);`variable.ts` 的 warning 记路径;ext 的错误文字不含路径与内容(`platform-credential-header.ts:16`);引擎 MCP 各条日志只带服务名与已脱敏的错误(`packages/core/src/mcp/client.ts:275`、`:426-444`;`index.ts:491`、`:507`),唯一例外是 debug 级的连接器 stderr 原文(`stdio.ts:185`)。
- 盘上配置只含引用(`codepuppy-mcp-secrets.ts:147-151`)。
- 引擎的已解析配置接口(`packages/server/src/handlers/config.ts:9`):围栏内的子进程连不上引擎端口(测:围栏内 curl 一个回环监听 ⇒ 连接失败,围栏外对照拿到内容;`run/F7-port.txt` 与本节命令输出),出网代理不放行回环目的地(`network-egress-registry.ts:69-80`、`:119-126`),接口还要口令(`sidecar.ts:85-86`)。
- 崩溃转储:见 P-19。
- 引擎自己的凭据库:见 G2。

**P-15 北极星。**(读)`config.ts` 与 `mcp/client.ts` 已登记接管(`scripts/north-star-guard.sh:140`、`:175`);`client.ts` 已有按票标注的多处块(`client.ts:3`、`:37-38`、`:61-75`)。`packages/util/src/` 下 `codepuppy-*` 命名的新文件按 ADR-043 属 Code Puppy 自有。

**P-16 写盘登记簿。**(读)`codepuppy-secret-files.ts` 的写盘点今天登记在 W3(`scripts/process-fence-write-sites.tsv:27-35`)。

**P-17 围栏外预先存在的别名,与改名上级目录。**(测;`src/f4.sh`、`src/f4b.sh`、`src/p7.py`;`run/F4-P1.out`、`run/F4-ancestors.out`)

| 途径(假值) | C1(R0) | C1 + 上级目录写禁止(R1) |
| --- | --- | --- |
| 围栏外预建在工作区的硬链 | 读到 | 读到 |
| 围栏外预建的 APFS 克隆 | 读到 | 读到 |
| `/.vol/<dev>/<ino>`,该 inode 另有别名 | 读到 | 读到 |
| `/.vol/<dev>/<ino>`,没有别名 | EPERM | EPERM |
| firmlink 写法 `/System/Volumes/Data/…` | EPERM | EPERM |
| 经软链的上级目录写法(同 `/var` → `/private/var`) | EPERM | EPERM |
| **在围栏内把 userData 整个改名搬进工作区,再读** | **读到** | EPERM(改名被拒) |
| 改名临时目录式存放点的上级(在可写根内) | 读到 | EPERM |
| userData 里新建 / 改名 / 删文件、`mkdir -p` 已有目录、node 递归 mkdir | 照常 | 照常 |

前三行的别名在本改动生效之后,围栏内已做不出(P-10);生效之前,0.2.4 的会话就能做出并留下它们(P-07 的对照臂 `run/P0.out`)。按编排器 R2-4 裁决,生效前做出的别名是既有暴露,不在保证内(§10)。改名上级目录是 R1 发现的真缺口,由 §4.5 的上级目录写禁止关闭。

**P-18 推送没有回执时,顺序不成立;拉取成立。**(测;真 Electron 42.3.3 主进程 + utilityProcess `parentPort`,隔离 userData;`f5/main.js`、`f5/utility.js`;`f5/F5-F7-result.json`、`f5/F5-F7.log`)每轮:主进程写新密钥 → 推送整表(push 臂)→ 原子改写一份被监听的配置 → 发一个 HTTP 请求。

| 臂 | 文件监听触发的「重载」看到旧值 | 紧随的请求看到旧值 |
| --- | --- | --- |
| push,utility 空闲 | 0/10 | 0/10 |
| push,utility 主线程忙 300 ms | **20/20** | **19/20** |
| pull(重载 / 请求先向主进程要表、等回复),忙 300 ms | 0/20 | 0/20 |

⇒ 主线程忙时,先发出的 `parentPort` 消息排在之后到达的文件事件与 HTTP 请求之后处理;「先推后提交」不保证消费者看到新表。

**P-19 崩溃转储。**(测;`f5/crasher.js`、`f5/crasher-fenced.js`、`f5/f7main.js`;`f5/F5-F7-result.json`、`f5/F7-fenced.out`)持有假凭据(已发布表、已解析配置、使用中的值)的 utility 进程崩溃后,757 KB 原始 MDMP 转储里没有假值(ASCII 与 UTF-16 都搜过;同一搜索能找到 `Electron`、`utility`)。转储只收线程栈及其引用的内存,不能排除崩溃瞬间栈上的值(推)。同一 utility 先用真 addon 装上「生产 profile + C1 含 `Crashpad`」再崩溃:它自己读 / 列 `Crashpad` 为 EPERM,新转储照样写出;去掉这一行则读得到。

**P-20 续期提前量。**(读)访问令牌在到期前 min(5 分钟, 寿命/3) 续期(`codepuppy-auth-clock.ts:7-8`、`:24-26`),提前续期时旧令牌仍有效(`codepuppy-auth.ts:800-801`);已过期才续期时平台本来就处于「恢复中」。

**P-21 每类凭据的接收方由哪份记录定义,那份记录围栏能不能改。**(读;R2-1)

| 凭据 | 接收方的定义在哪 | 围栏内可写? | 谁用凭据发请求 |
| --- | --- | --- | --- |
| 平台凭据、云 MCP 令牌 | 启动文档,主进程在内存里构建(`codepuppy-bootstrap-build.ts:85`、`:92`) | 否 | 引擎进程(ext、core) |
| BYOK 密钥 | App 内置适配器表 × 已应用目录(`codepuppy-models.ts:157-191`),sidecar 写进内存里的内联文档 | 否 | 引擎进程 |
| 自定义节点密钥 | 自定义节点真源 `<appData>/codepuppy-state/custom-providers/<env>.json`(`codepuppy-models.ts:260-278`) | 否 | 引擎进程 |
| 远程连接器令牌(扩展包远程 MCP、官方 GitHub) | 远程 MCP 真源 `<appData>/codepuppy-state/mcp-servers/<env>.json`,只有主进程写,「引擎写不到的家」并有围栏判据(`mcp-server-truth.ts:1-12`);所有远程条目都只写这里(`ext-config.ts:501`、`:639`;`official-connector-resources.ts:396`),主进程读叶子时先读它(`ext-config.ts:543-546`) | 否 | 引擎进程(到真源里写定的 url) |
| 扩展包 / 目录里的本地连接器令牌 | `codepuppy.jsonc` 与安装账本 `installs.json`,都在 `<codepuppyGlobalRoot>` 下(`engine-config-truth.ts:20-22`、`ext-receipt-v2.ts:3`、`:100`)= W2 | **是** | 连接器子进程(环境变量) |
| 用户自己填的本地连接器令牌 | `codepuppy.jsonc`(`ext-uncurated-bodies.ts:72`) | **是** | 连接器子进程 |
| 官方数据库连接器 DSN | 封闭配方写在代码里(`official-connector-resources.ts:154-180`),叶子投影进 `codepuppy.jsonc`(`:388-392`);启动的程序是 `npx -y @bytebase/dbhub@1.5.0`(`official-connector-recipes.ts:79`),npm 缓存 `~/.npm` 是 W7(`process-fence-profile.ts:162`) | 叶子**是**;配方否;程序所在缓存**是** | 连接器子进程 |

账本的防篡改摘要是可重算的 sha256(`ext-package-ledger-v3.ts:279-292`、`:361`),不是对会话的边界。「会话把伪造的包放进 `~/.npm/_npx` 后 `npx -y` 直接用它」未实测(推)。

**P-22 别名在主进程眼里怎么认。**(测;`run/R3-realpath.out`)`fs.realpathSync.native` 能把工作区软链、相对路径、大小写变体都解析到存放点的真实路径,但 firmlink 写法 `/System/Volumes/Data/…` 原样返回;同一目录的三种写法(原路径、firmlink、大小写变体)`stat` 得到同一个 设备号/inode。⇒ 判断「是否指向存放点」要按设备号 + inode 比,不按路径前缀比。

**P-23 模型级 `package` 能盖过 provider 级。**(读;Codex R3 指出,本设计抽查确认)配置里给某个模型写 `package`,装配时 `model.package` 优先于 `provider.package`(`packages/core/src/model.ts:210`;`packages/core/src/config/plugin/provider.ts:229`);内联投影只给 provider 级写包(`codepuppy-models.ts:311-324`);所选模型的模块拿到含密钥的 settings(`packages/core/src/model-resolver.ts:246`、`:296-303`)。⇒ 改写可写的引擎配置能把合法代入的 provider 密钥交给会话放的模块 —— 与 R2-1 的「换连接器命令」同属一类(D10)。

## 4. 接口契约

### 4.1 进程内凭据表(新文件 `packages/util/src/codepuppy-credentials.ts`)

只 import `node:path`、`node:os` 与 core 已依赖的 `jsonc-parser`;不碰文件系统。与启动文档同一种交接:一个 `globalThis` 槽,三个 bundle 各编一份读法。

```ts
// north-star: codepuppy-* 命名,ADR-043
/** 一项凭据:值,以及它的接收方由哪份记录定义(主进程建表时判定,§4.3;依据 P-21)。 */
export type CodePuppyCredentialEntry = {
  value: string // 文件原文(不 trim;读者照今天的做法 trim)
  use:
    | { kind: "inline" }                    // codepuppy-secrets/*:平台、云、BYOK、自定义节点 —— 只从内存里的内联文档代入
    | { kind: "connector"; server: string } // 连接器存放点里的文件 —— 只在名字为 `server` 的连接器条目里代入
}
/** 键 = path.resolve 之后的绝对路径(与各处产出的 `{file:}` 引用同一写法)。 */
export type CodePuppyCredentials = Readonly<Record<string, CodePuppyCredentialEntry>>

/** 校验消息字段:不是普通对象、键非绝对或不等于 path.resolve(键)、值形状不对 ⇒ 抛 Error(消息不含值)。{} 合法。 */
export function parseCodePuppyCredentials(value: unknown): CodePuppyCredentials
/** 整表替换(冻结后挂到 globalThis[Symbol.for("codepuppy.credentials")])。 */
export function publishCodePuppyCredentials(table: CodePuppyCredentials): void
/** sidecar 启动时装上:向主进程要整表并等回复(§4.2)。没装(仓内 CLI、core 单测)⇒ refresh 什么都不做。 */
export function installCodePuppyCredentialSource(pull: () => Promise<CodePuppyCredentials>): void
/** 拉整表、发布、再返回。每次调用各发一个请求、只认自己那个 id 的回复,调用之间不合并、不复用在途回复(R2-2)。
 *  主进程回错误、10 秒没有回复、或端口关闭 ⇒ 抛(R2-3);超时那一种另向主进程发 `credentials.unavailable`(§4.2)。
 *  抛出时调用方这次装载把清单位置当作「表里没有」,绝不用已发布的旧表完成装载。 */
export function refreshCodePuppyCredentials(): Promise<void>
/** 只给读启动文档引用的读者(C-b–C-e):`~/` 展开、path.resolve、精确查;返回值,不看 use;没有 ⇒ undefined。 */
export function codepuppyCredential(path: string): string | undefined
/** 同上,没有就抛 Error("Code Puppy credential is not available")——不带路径与值;现有 readFile 形参的直接替身。 */
export function readCodePuppyCredential(path: string): string
/** 引擎配置装载用(§4.4)。只在封闭清单的位置上、且条目的 use 允许该位置时,把整串或串内的 `{file:<路径>}` 换成值
 *  (JSON 转义,值里每个 "{" 写成 \u007b,引擎随后的 {env:}/{file:} 两遍碰不到它);其余位置、其余记号一字不动,
 *  留给引擎自己的 {file:} 读法(C1 下读凭据路径 = EPERM = 空串 + warning)。按解析树定位,文本解析不了 ⇒ 原样返回。 */
export function resolveCodePuppyCredentialRefs(text: string, document: "inline" | "explicit"): string
/** 主进程直接应用路径(`package-mcp-activation.ts:109`)用:对一片 MCP 叶子按同一套规则解析 `{file:}`,取代今天无条件解析的
 *  `resolveFileReferences`(`:154-164`)。每个引用先问 isStoreTarget(p):
 *    · 指向存放点、且 path.resolve(p) 正是表里某条的键、条目为 connector 且 server 等于本叶子的名字、字段为 environment.* /
 *      headers.* / oauth.clientSecret(真源叶子是 v1 形状,`mcp-server-truth.ts:89`)/ oauth.client_secret ⇒ 代入值;
 *    · 指向存放点的其它一切(inline 条目、别的 server、别的字段、经别名的写法)⇒ 代入空串并记名字,绝不读那个文件;
 *    · 不指向存放点 ⇒ readFile(今天的行为)。 */
export function resolveConnectorLeaf(input: {
  server: string
  leaf: Record<string, unknown>
  table: CodePuppyCredentials
  /** 主进程按 §4.5 给 C1 的同一份真实目标清单实现:把 p 求成真实路径(求不出 ⇒ 当作指向存放点),它自己或它的任一上级目录的
   *  设备号 + inode 等于清单里某一项 ⇒ true(P-22:firmlink 写法的真实路径不同、inode 相同)。 */
  isStoreTarget: (path: string) => boolean
  readFile: (path: string) => string
}): Record<string, unknown>
```

### 4.2 主进程 ↔ sidecar 的消息(既有窄通道)

```ts
// main → sidecar
type StartCommand = { /* 既有字段 */ credentials: unknown }  // 必填,{} 合法;start() 在注入与 import 引擎之前 parse + publish;
                                                             // 坏了走「darwin 缺围栏 / 启动文档坏了」同一条路:error IPC + exit(1)
type CredentialsMessage =
  | { type: "credentials"; credentials: CodePuppyCredentials }               // 续期推送(T2),无 id
  | { type: "credentials"; id: number; credentials: CodePuppyCredentials }   // 回复拉取
  | { type: "credentials"; id: number; error: string }                       // 主进程读不出表(不含值)
// sidecar → main
type CredentialsRequest = { type: "credentials.request"; id: number }
type CredentialsUnavailable = { type: "credentials.unavailable"; id: number }   // 这个 id 的拉取 10 秒没等到回复
```

主进程在 `server.ts:589-593` 的 `child.on("message")` 上、与写探针并列接收这两条:`credentials.request` **同步**建表并回复(收到与回复之间没有 await),建表失败 ⇒ 回 `error` 并请求既有 `credential-change` 重启;`credentials.unavailable` ⇒ 请求同一个重启(重启走既有队列与自愈阶梯,`sidecar-lifecycle.ts:24-39`,有界)。sidecar 端:每个请求按自己的 id 记账,迟到的回复不发布;子进程端口关闭时在途请求以错误结束(这时这一代本就在结束,下一代从 T1 起重新装载);形状不对的 `credentials` 消息记一行(不含值)并丢弃。

### 4.3 存放点清单、表、三个交接点与写者表

`packages/ui-mac/src/main/codepuppy-secret-files.ts`(Electron-free,已是凭据目录的权威)增加:

```ts
export type CredentialStore = {
  path: string               // 与该存放点的 `{file:}` 引用同一写法的绝对路径
  kind: "dir" | "file"
  table: "secrets" | "connector-by-server" | "connector-by-run" | false   // 怎么进表;false = 只拦、不进表
  // 实现方另由这份清单的真实目标(§4.5)得出 isStoreTarget(§4.1),C1 与主进程别名判断用同一份清单
}
/** userData 下六项(名字取自 USER_DATA_LAYOUT)+ `<userData>/Crashpad`(false)+ 官方连接器运行期目录
 *  (调用方算出才给;本模块不 import 官方连接器模块,那会把钥匙串带进 sidecar 闭包)。 */
export function credentialStores(input: { userDataPath: string; officialRuntimeParent?: string }): CredentialStore[]
/** 只读 table !== false 的目录下的**普通文件**(lstat;根以下不跟随任何软链,遇到软链条目只记名字、不进表),跳过 "." 开头的条目。
 *  use:codepuppy-secrets/<名> ⇒ { kind: "inline" };codepuppy-mcp-secrets/<server>/… ⇒ { kind: "connector", server };
 *  <运行期目录>/<run>/<name>/… ⇒ { kind: "connector", server: name }。目录不存在 = 没有条目;其它 IO 错误抛出。不记录值。 */
export function readCredentialTable(stores: readonly CredentialStore[]): Record<string, CodePuppyCredentialEntry>
```

三个交接点(没有别的):

| 交接点 | 何时 | 谁读它 | 失败 |
| --- | --- | --- | --- |
| T1 种子 | `server.ts` fork 之后发 `start` 时同步建表(在 `restoreCommittedOfficialConnectors`(`server.ts:555`)之后) | 注入的在场判断、ext 与云的首读 | 建表抛 ⇒ 杀子进程、本代失败 |
| T2 续期推送 | `applyPlatformCredentialsHot` 写入与回读摘要通过之后,推整表 | C-b–C-e 每请求现读 | 没有子进程 ⇒ 跳过;发送抛 ⇒ `needs-structural` |
| P 装载前拉取 | 引擎每次装载显式文件或内联内容、且文档里有清单位置上的 `{file:}` 时,先 `refreshCodePuppyCredentials()`;每次装载各自请求,不合并 | C-a | 回错误 / 超时 / 端口关闭 ⇒ 这次按「表里没有」解析,绝不用旧表;错误与超时都接既有 `credential-change` 重启,新一代重新装载 |

为什么 C-a 用拉取、C-b–C-e 留推送:配置引用的凭据有十余个写者、在运行中任何时候变(下表),而 P-18 证明推送无法排在消费者前面;拉取让每一次装载都看到装载那一刻盘上的内容,写者不需要任何钩子,也不存在「推送失败后缓存了空串」的窗口。C-b–C-e 只读平台凭据与云 MCP 令牌,它们在运行中只有续期一个写者;续期提前 5 分钟,推送晚到期间旧令牌仍有效(P-20),改成每请求拉取要在五处同步读法上加异步往返,不划算。

写者表(F3,逐个 grep 调用方):

| 存放点 | 写者(位置) | 何时 | 引擎何时看到 |
| --- | --- | --- | --- |
| `codepuppy-secrets/` | `syncSecretFiles`(`server.ts:418`) | 每次 fork 前 | T1 |
| | `applyPlatformCredentialsHot` → `writeSecretFileAtomic`(`codepuppy-secret-files.ts:169-189`;`index.ts:798`) | 续期 | T2(配置里引用它的云 MCP 头在下次装载时 P) |
| | 数据清除删除(`data-clear-boot.ts`) | 清除后随登出重启 | T1 |
| `codepuppy-mcp-secrets/` | `writeMcpSecretVersioned`:`ext-package-tx-builders.ts:448`、`ext-install-planner.ts:1425`(接线 `ext-ipc.ts:975`)、`fileifyMcpSecretsVersioned`(`codepuppy-mcp-secrets.ts:170` ← `ext-uncurated-bodies.ts:72`) | 安装 / 保存密钥 | P |
| | `removeMcpSecretVersionDir`(`ext-install-planner.ts:1396`、`:1409`、`:1416`、`:1427`、`:1581`;`codepuppy-mcp-secrets.ts:523`;`ext-uncurated-bodies.ts:75`、`:87`、`:105`)、`removeMcpServerSecrets`(`ext-ipc.ts:201`)、`removeMcpServerSecretsStrict`(`ext-ipc.ts:759`、`:886`、`:996`)、`gcMcpSecretVersionsLocked`(`ext-config.ts:698`) | 失败清理 / 卸载 / GC | P(下次 fork T1) |
| | `writeMcpSecret`(`codepuppy-mcp-secrets.ts:48`) | 当前无调用方 | — |
| 官方运行期目录 | `restoreOfficialConnector` ← `restoreCommittedOfficialConnectors`(`server.ts:555` → T1;`package-admission.ts:1299` → P)、← `prepareOfficialConnector`(`ext-package-tx-builders.ts:440` → P)、← `settleOfficialConnectorCredential`(`package-mcp-activation.ts:72` 启用、`:84` 停用 → P) | fork 前 / 运行中 | 见左 |
| | `clearOfficialConnectorRuntime`(`server.ts:400`、`:567`;`official-connector-resources.ts:136`)、`clearOfficialConnectorRuntimeOnExit`(`index.ts:720`;`server.ts:596`)、`sweepOfficialConnectorRuntime`(`official-connector-resources.ts:103`、`:354`)、`removeOfficialConnectorVersion`(`:260`、`:267`、`:283`)、`removeOfficialConnector`(`ext-ipc.ts:877`、`:985`) | 清理 / 卸载 | P / T1 |

主进程运行中直接调引擎 `mcp.add` 的那条路(`package-mcp-activation.ts:109-113`)改用 `resolveConnectorLeaf`(§4.1):用同一张表、同一套规则解析叶子,不再无条件读出叶子里每个 `{file:}`,也不替经别名指向存放点的引用读文件(保证 (d))。顺序照旧:先解析、后 `projectServerConfig`,所以两种 OAuth 字段写法都认。之后的配置重载走 P。

### 4.4 引擎进程里的读者与凭据代入位置(封闭清单)

规则:sidecar 进程里,凭据的值与在场性**只**从 §4.1 的表来;没有一条代码路径从盘上读存放点。主进程照旧读盘。

C-a 的代入只在下列位置(F1);两份文档以外(全局、项目、托管、wellknown)一律不代入:

| 位置 | 文档 | 允许的条目 |
| --- | --- | --- |
| `providers.<id>.settings.apiKey` | 内联 | `inline` |
| `mcp.servers.<n>.headers.<h>` | 内联 | `inline`(云 MCP 的 Authorization);`connector`,server = n |
| `mcp.<n>.headers.<h>`、`mcp.servers.<n>.headers.<h>` | 显式 | `connector`,server = n |
| `mcp.<n>.environment.<V>`、`mcp.servers.<n>.environment.<V>` | 内联、显式 | `connector`,server = n |
| `mcp.<n>.oauth.clientSecret`、`mcp.servers.<n>.oauth.client_secret` | 内联、显式 | `connector`,server = n |

两条便宜的绑定(保证 (c)):`inline` 条目只从内存里的内联文档代入 —— 平台、云、BYOK、自定义节点的凭据永不从围栏可写的显式文件代入;`connector` 条目只在同名条目里代入 —— A 连接器条目引用 B 连接器的令牌不会被代入。清单之外的任何位置(例如 `agents.<名>.system`)上指向存放点的 `{file:}`,以及不满足绑定的引用,都留给引擎自己读 ⇒ EPERM ⇒ 空串 + warning,值永不从表里出来。指向普通文件的 `{file:}` 照常工作。被合法代入之后,凭据最终交给哪个程序或模块,由围栏可写的引擎配置决定 —— 那是 D10 的残留类,本设计不再加接收方绑定。

| 读者 | 改法 | 表里没有时(既有行为) |
| --- | --- | --- |
| C-a | `config.ts:172`(显式文件)与 `:294`(内联内容)两处,先 `refreshCodePuppyCredentials()`,再把交给 `ConfigVariable.substitute` 的文本过 `resolveCodePuppyCredentialRefs`;新的 `codepuppy(#<票号>)` 标注块 | 空串 + warning |
| C-b | `client.ts:378` 读法换成 `readCodePuppyCredential`(包成 Promise) | 本地 401 |
| C-c | 默认读法换成 `readCodePuppyCredential` | `LoadAPIKeyError` |
| C-d | 三处默认读法换成 `readCodePuppyCredential` | 不装 / `credential-unreadable` |
| C-e | 默认存在性判断换成 `codepuppyCredential(p) !== undefined` | `credential-missing` |
| C-f | 在 sidecar 里问表(T1);同一组函数在主进程照旧读盘(形参或读法由实现方定,不许靠「读盘失败当不存在」) | provider 不注入、云 MCP 不登记 |

### 4.5 围栏 profile:C1

渲染器 `renderProcessFenceProfile` 增加输入 `credentialStores: readonly { path: string; kind: "dir" | "file" }[]`(已是真实路径),由 `process-fence-plan.ts` 从 §4.3 的 `credentialStores()` 得到:对每个存放点,写入「真实上级目录 + 名字」;若该位置已存在且解析到别处(软链),再写入它的真实目标(F2)。userData 的真实路径用计划已有的 `deps.realpath`(`fs.realpathSync.native`);求不出 ⇒ 拒绝 fork。`officialRuntimeParent()` 抛 ⇒ 不给该项。渲染两块,都放在 **profile 最末(N4 之后)**:

```
(deny file-read* file-write*
  (subpath "<R>/codepuppy-secrets")
  (subpath "<R>/codepuppy-mcp-secrets")
  (literal "<R>/codepuppy.env")
  (literal "<R>/codepuppy-auth.json")
  (literal "<R>/codepuppy-pkce.json")
  (literal "<R>/codepuppy-byok-keys.json")
  (subpath "<R>/Crashpad")
  (subpath "<T>/codepuppy-connectors-<uid>-<hash>")
  … 已存在且解析到别处的存放点,再加它的真实目标)
(deny file-write*
  (literal "<祖先>") …)      ; C1
```

- 第二块:上面每条路径的每一级上级目录(从它的父目录起,到 `/` 之前为止,去重),只禁写不禁读 —— 挡住「把 userData 或临时目录整个改名搬走」(P-17);在其中新建、改名、删除文件照常(P-17 末行;真引擎三档回合照常完成,`engine/out/R1-C-change.json`)。
- 位置:C1 两块是全文最后的文件规则(P-08)。X1/X2 落在「`(allow file-write* …)` 块之后、网络行之前」,C1 在网络行之后;两处改动在渲染数组里隔着网络行,任一顺序落地 C1 都在 X1 之后。
- 两份密文、PKCE 与 `codepuppy.env` 在 C1 里:它们在 W3 之下,今天会话删得掉(删登录文件 = 被登出,删密钥库 = BYOK 密钥丢失)。`Crashpad` 在 C1 里:转储由围栏外的崩溃处理进程写,围栏内不需要它,拒读不影响转储写出(P-19)。
- 不拦存在性测试(P-13):文件名不是凭据。
- 非 darwin 没有围栏(既有声明),表与拉取照样生效,C1 不渲染。
- 写盘登记簿:`codepuppy-secret-files.ts` 那九行的根从 `W3` 改为 `main-only`(P-16)。

### 配置

无新增配置键、无新开关。10 秒的拉取等待上限是代码常量。

## 5. 数据与失败

不做迁移:存放点的位置、格式、权限都不变,升级后第一次 fork 由 T1 从既有文件建表 ⇒ 已存密钥与登录照常(R-3)。

| 失败窗口 | 结果 | 日志 |
| --- | --- | --- |
| 拉取时主进程读不出表 | 这次装载按「表里没有」解析;主进程请求既有 `credential-change` 重启,新一代 T1 重建(仍读不出 ⇒ 拒 fork,既有响亮失败);用户无需操作 | 主进程错误一行 |
| 拉取 10 秒无回复(主进程卡住) | 这次装载按「表里没有」解析,不用旧表;sidecar 发 `credentials.unavailable`,主进程处理到它时请求同一个 `credential-change` 重启,新一代重新装载(R2-3) | 错误一行 |
| 拉取时端口关闭 | 这次装载按「表里没有」解析;这一代本就在结束,下一代从 T1 起重新装载 | 一行 |
| 另一处装载拉取的回复迟到 | 每次装载只认自己的 id,迟到回复不发布、不被别的装载复用(R2-2) | — |
| 位置上的条目不在表里 / use 不允许 / 不在清单位置 | 空串;provider 在注入时已按表判过不会被注入;连接器报认证失败 | 引擎 warning,记路径不记值 |
| 主进程叶子里的引用经别名指向存放点,或求不出真实路径 | 空串,主进程不读那个文件 | 记名字 |
| 启动消息缺表或形状不对 | 拒绝启动,本代失败 | error IPC |
| 续期推送时没有子进程 / 发送抛 | 跳过,下一次 fork 带上 / `needs-structural` → 既有重启 | 既有 |
| 已过期才续期时,推送晚到前的请求 | 带旧令牌,与今天「过期到续期写完」同一个恢复中窗口,只多 sidecar 处理消息的时间(P-20) | 既有 |
| fork 时建表失败 / 真实路径求不出 | 拒绝 fork | 既有 |
| 存放点里出现软链条目 | 不进表 | 记名字 |

任何失败都不会落回可读文件。任何日志都不写值。

## 6. 架构落点

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| 进程内凭据表、拉取、位置解析 | `packages/util/src/codepuppy-credentials.ts`(新文件,Code Puppy 自有) | `node:path`、`node:os`、`jsonc-parser` | 启动文档的 `globalThis` 槽交接(`codepuppy-bootstrap.ts:161-162`) |
| 启动 / 推送 / 拉取消息 | `sidecar.ts` | util | 启动命令带秘密的先例(`sidecar.ts:85-86`);sidecar→main 按 id 回复的先例(`codepuppy-sidecar-messages.ts:88-96`) |
| T1、回复拉取 | `server.ts` | `codepuppy-secret-files.ts`、`official-connector-recipes.ts:27` | `child.postMessage` 与 `child.on("message")`(`server.ts:589-593`、`:665`) |
| 存放点清单、读表、T2 | `codepuppy-secret-files.ts` | `user-data-layout.ts` | 凭据目录与热应用的现有权威;`USER_DATA_LAYOUT` |
| C1 渲染 | `process-fence-profile.ts`、`process-fence-plan.ts` | `codepuppy-secret-files.ts` | 唯一渲染点(`process-fence-profile.ts:138`);计划的 `realpath` 依赖 |
| 配置装载前拉取 + 位置解析 | `packages/core/src/config.ts`(已登记接管) | util | 接管文件里按票标注块的先例(`client.ts`) |
| 云 MCP 读法 | `packages/core/src/mcp/client.ts:378`(已登记接管) | util | 既有 `#1562` 块 |
| ext 五处默认读法 | `packages/ext/src/` | util | 各处既有可注入的 `readFile` / `exists` 形参 |

- 新目录 / 新模块:无新目录。新文件 `codepuppy-credentials.ts` 住在启动文档旁边,core、ext、ui-mac 三方都已依赖 `packages/util`。
- 收敛:引擎进程里的凭据读法从五处各自读盘收成一个读者(K2 更好)。写者不加任何钩子。
- 架构约束:不新增接管文件;`config.ts` 多一处标注块,实现时在 `north-star-guard.sh:171-175` 那段注释里补记(与 `client.ts` 多块并存同形)。是否另写 ADR 由编排器定。
- 工程标准:不新增配置;值不进日志;错误沿用各读者既有的具名错误。
- 被否决的替代:
  - 装围栏之前自己读文件再拒读:运行中仍要主进程交值 ⇒ 两套机制;还要挪后「装围栏是第一句」。
  - 把值写进内联配置内容:配置内容带值;盘上的显式文件解决不了。
  - 改用 `{env:}`:值进 sidecar 环境,被每个子进程继承。
  - BYOK / 自定义节点改占位 apiKey + 请求时补头:认证头各异,连接器解决不了。
  - 主进程代发请求(凭据代理):新子系统。
  - 在 sidecar 里全局替换 `fs` 读函数:隐式、脆弱。
  - **R0 的「写入时推送(T3)+ 端口先进先出」**:P-18 实测推送排在文件监听与请求之后;补救要给十余个写者加回执与提交前等待(F3、F6)。
  - 推送后由 sidecar 触发配置重载:续期每 10 分钟一次也会重载,连接器反复重连。
  - 每次请求都拉:每个模型 / 云 MCP 请求多一次进程间往返,五处同步读法改异步;续期提前量已覆盖推送晚到(P-20)。
  - R0 的「全文预处理」:把围栏可写的显式文件变成取值入口(F1)。
  - R1 的「并发拉取合成一次」:先发的回复可能是提交新版本之前的快照,被后一个 Location 的装载复用(R2-2)。
  - 逐类追加「接收方绑定」(R2 的 `remote` 归属、官方配方叶子比对、R3-1 提出的模型包钉死与最终接收方核对):每一轮都冒出一种经可写引擎配置改变交付去向的新做法,根在 INT-safety I-13;按 D10 收窄声明,不再追加。R2 加的 `remote` 归属一并撤掉(R3-2):它挡的「伪造同名本地条目」本身就属 D10 残留类,留着它还要多读一次远程真源、多一种失败形态,却不支撑保证里的任何一条。
  - 删掉明文镜像 `codepuppy-secrets/`:结果不需要动存放(§10 留档)。
- 安全面:
  - 威胁边界:对话启动的、被围栏的引擎进程树里的任何进程,经任何路径(软链、硬链、克隆、`/.vol`、firmlink、另一种路径写法、改名上级目录、Code Puppy 自己写在别处的副本、让未围栏的主进程替它读)读、改、挪 §4.3 清单里的存放点。保证 = §1 的 (a)–(d);不保证 = §1 的 D10 残留类。
  - 必须守住的不变量:
    - **I1** 被围栏的进程打不开清单里任何存放点及其真实目标,读写都不行;挪不动它们的任何上级目录;C1 是最后的文件规则、按真实路径渲染。
    - **I2** 凭据值不出现在 sidecar 环境、任何子进程环境(连接器自己配置的环境变量除外)、配置文本、Code Puppy 写在围栏可读处的任何文件、任何日志里。
    - **I3** sidecar 进程里的凭据值只来自主进程的 `start` / `credentials` 消息;sidecar 不读盘上的存放点。
    - **I4** 配置里的凭据只在 §4.4 的封闭位置代入;`inline` 条目只从内存里的内联文档代入,`connector` 条目只在同名条目里代入;主进程直接应用路径守同一条规则。
    - **I5** 每次配置装载解析的是它自己那次拉取时盘上的内容(P);拉取不成功的装载不用旧表;续期之外,主进程不靠推送让引擎看到变化。
    - **I6** 主进程不替经别名(软链、相对路径、大小写变体、firmlink 写法)指向存放点的引用读文件:按 C1 的同一份真实目标清单,以设备号 + inode 判断(P-22)。
  - 残留(每条一行,不设计缓解):
    - 连接器子进程合法拿到的、写在它自己环境里的令牌,它与它派生的进程看得到;连接器把令牌打到自己 stderr 时,引擎 debug 日志会记下(`stdio.ts:185`)。
    - **D10 残留类**:对话改写围栏内可写的引擎配置,就能改变一份被合法代入的凭据被送到哪里(换掉连接器的命令、覆盖模型的 `package`,以及任何同类做法)。关闭它的是 INT-safety I-13。本轮查到的可写入口(I-13 的输入):
      - `<codepuppyGlobalRoot>/codepuppy.jsonc`(W2):sidecar 合成显式文件(`engine-explicit-config.ts:11-17`、`:61-72`);主进程 `readMcpLeafStrict` 读本地连接器叶子(`ext-config.ts:537-549`)→ 直接应用路径(`package-mcp-activation.ts:106-113`)。本地连接器的命令、参数、cwd、environment、headers 都在这里(P-21)。
      - `<userData>/codepuppy-engine-config/codepuppy-explicit.json`(W3):引擎显式槽,`config.ts:172` 装载;能写连接器条目与模型级 `package`(P-23)。
      - 引擎全局配置目录 `<XDG_CONFIG_HOME>/opencode`(W6,`engine-paths.ts:34-36`):引擎按全局文档装载,同样能写 provider / 模型覆盖(推:与显式文件同一套逐文档合并)。
      - `<codepuppyGlobalRoot>/installs.json`(W2):安装账本,主进程启停投影与连接器收敛据它决定应用哪些条目(`ext-receipt-v2.ts:3`、`:100`;`package-mcp-activation.ts:66-69`;`ext-install-planner.ts:3490-3506`)。
      - `<codepuppyGlobalRoot>/skills-enabled.json`(W2):允许集,ext 的 MCP 收口与主进程收敛据它决定放行(`packages/ext/src/gen-skill-paths.ts:46-49`;`package-mcp-activation.ts:74`)。
      - 项目里的 OpenCode 配置(工作区 W1):只在用户允许过的项目里放行可执行字段(ADR-049,`config.ts:277-281`)。
      - 不是配置、但决定交付去向的程序位置:npm 缓存 `~/.npm`(W7,官方数据库连接器经 `npx` 启动,`official-connector-recipes.ts:79`)、uv 缓存 `<userData>/uv-cache`(W3,`server.ts:468`)。
    - 改动生效前做出的别名(硬链、APFS 克隆、拷贝,以及该 inode 的 `/.vol` 写法)仍可读(P-17):是生效前的既有暴露,不在保证内(编排器 R2-4 裁决);不做 inode 重建或密钥轮换。
    - 引擎进程内存:表与已解析的配置都在 sidecar 堆里;崩溃瞬间栈上的值可能进转储,转储目录对围栏内不可读,但用户主动导出的调试包(写到「下载」)带着转储与日志。
    - 用户自己装进引擎进程的插件,能调用同一个读者。
    - Code Puppy 存放之外的东西:用户 shell 配置导出的值(含 `codepuppy-shell-env.json` 里的那份)、`CODEPUPPY_ENV_FILE` 指到别处的文件、其它应用、钥匙串条目本身、官方连接器密文目录 `connector-secrets/`(只有密文、围栏内不可写)。
    - 引擎数据库里第三方远程连接器的 OAuth 令牌(G2)。
    - 文件名的存在性可被测试(P-13)。
    - 非 darwin 平台没有围栏(既有声明不变)。
  - 实现须出示的证据(每条都要能失败,入口是真的):
    - **E1** 真引擎 + 生产渲染的 profile(含 C1)+ 真 ext + 真 addon:三档 × shell `cat` / 读文件工具 × 清单里每个存放点放的假值(含已恢复的官方运行期文件与一份转储)⇒ 零命中;shell 再试软链、硬链、克隆、大小写变体、覆盖写、删除、把 userData 与临时目录改名搬走 ⇒ 全失败,事后在围栏外读盘原样。已知的坏:去掉 C1 ⇒ 红(P-07);去掉上级目录那块 ⇒ 改名读到(P-17)。
    - **E2** 平台模型请求带 `Bearer <假平台凭据>`,值只经 T1 到达。已知的坏:不发布表 ⇒ 零请求、具名错误(P-11)。
    - **E3** BYOK 节点只在表里有非空值时注入,请求带该密钥。已知的坏:去掉位置解析 ⇒ 请求不带凭据发出。
    - **E4** 显式文件里本地连接器的 environment 引用解析为假值。已知的坏:去掉拉取或解析 ⇒ 空串 + warning。
    - **E5** 续期:平台凭据与云 MCP 令牌换新后,下一次模型请求与云 MCP 请求带新值,重启 0 次。已知的坏:去掉 T2 ⇒ 旧值。
    - **E6** 运行中(不重启):装一个带密钥的扩展包连接器;启用、停用官方连接器并保存它的新凭据 —— 之后每一次配置重载里,连接器拿到的都是盘上当前值(停用后为空)。已知的坏:把 P 换成写入时推送、sidecar 忙时 ⇒ 旧值(P-18)。
    - **E7** profile 以 C1 两块结尾、路径为真实路径、含已存在存放点的软链目标与全部上级目录。已知的坏:让 `codepuppy-secrets` 成为指向工作区的软链且渲染不含目标 ⇒ 读到(F2);经软链的 userData 不求真实路径 ⇒ 读到(P4)。
    - **E8** 带着既有登录与已存密钥的 userData 冷启动(不迁移任何文件):登录态、模型列表、连接器与升级前相同。
    - **E9** 跑完 E1–E6 后,主进程、sidecar、引擎日志里搜假值零命中(同一搜索在桩收到的请求头记录里能命中);围栏内连引擎端口失败;围栏内读 `Crashpad` 为 EPERM。
    - **E10** 引用规则(保证 (c)(d)),经真实入口:会话把显式文件改成在 `agents.build.system` 写 `{file:<平台凭据路径>}`、在本地连接器 A 的 environment 里写平台凭据、BYOK 密钥与连接器 B 令牌的引用,再在设置里启用 A ⇒ 模型请求、引擎配置装载、主进程直接应用路径都只给空串,不是值;再在 A 里分别用「工作区里指向存放点的软链」「相对路径」「大小写变体」「`/System/Volumes/Data/…` 写法」引用 A 自己的令牌,经真实主进程应用路径 ⇒ 全部空串,主进程没有读那个文件(只记名字);远程真源叶子带 v1 `oauth.clientSecret` 时,经主进程应用路径后引擎拿到正确的 `client_secret`(R3-4)。已知的坏:全文预处理 ⇒ 值进模型请求(F1);主进程照旧无条件 `readFileSync` ⇒ 别名写法读到令牌(R3-3);只认 `client_secret` ⇒ 远程 OAuth 客户端密钥被换成空串(R3-4)。
    - **E11** 两个 Location 装载:延迟第一个装载那次拉取的回复 → 其间提交一个新连接器版本 → 第二个 Location 装载 ⇒ 第二个拿到新值。已知的坏:合并在途拉取 ⇒ 旧值(R2-2)。
    - **E12** 让主进程对某次拉取超过 10 秒不回复 ⇒ 这次装载里凭据位置为空(不是旧值),随后发生一次 `credential-change` 重启,新一代里该连接器拿到盘上当前值;端口关闭时同样不出现旧值。已知的坏:超时后用已发布的表 ⇒ 旧值留在配置里(R2-3)。

## 8. 拆分决定

不适用:全部在 alpha-code 一个仓、一个负责方。

## 9. 回滚

不适用:没有数据迁移,存放不变。

## 10. 裁决与审查结论

| 送审前裁决(R1 后的当前版本) | 依据与适用版本 |
| --- | --- |
| D1 引擎进程的值只来自主进程:T1 启动种子、T2 续期推送、P 配置装载前拉取;不在装围栏前读盘 | P-04、P-05、P-12、P-18、P-20;`a20dadb942` |
| D2 `{file:}` 引用一字不变;C-a 只在 §4.4 封闭位置代入,`inline` 只从内联文档、`connector` 只在同名条目;主进程直接应用路径守同一规则并按设备号 + inode 拒绝别名(`resolveConnectorLeaf`);其余读者换成表读法 | P-02、P-03、P-22;F1、R3-2、R3-3、R3-4 |
| D3 C1 = 清单存放点 + 已存在位置的真实目标(拒读拒写)+ 全部上级目录(拒写),放在 profile 最末、按真实路径渲染 | P-06、P-08、P-09、P-10、P-17、P-19 |
| D4 表 = 进表目录里普通文件的全文,带 use;写者不加钩子 | P-04 写者表;§4.3 |
| D5 失败沿用既有具名降级;拉取的错误、超时、端口关闭都不用旧表完成装载,错误与超时接既有 `credential-change` 重启;每次装载独立拉取;绝不落回可读文件 | P-03、P-11、P-18;§5;R2-2、R2-3 |
| D6 在场性只问表 | P-13 |
| D7 不拦存在性测试、不动存放位置、不删镜像 | owner「不要设计的过于复杂」 |
| D8 引擎库里的 OAuth 令牌不在本设计内,返还为 G2 | `oauth.ts:289-330` |
| D9(编排器裁决 R2-4)保证从本改动装上那一刻起算。装上之前对话做出的硬链、克隆或拷贝是既有暴露:做出它的进程当时就能不受限地读到值,留下的别名不再透露任何新东西,对现有文件的任何规则也收不回已经离开它们的值。因此:不声称这些别名「只能由围栏外做出」;不加 inode 重建或任何轮换步骤(重建 inode 清不掉旧内容,轮换用户自己的密钥不能做成隐含的实现步骤);§2 照录实测(P-17)。owner 由编排器用白话告知此限;若要让旧副本失效,是另一条意图(需要轮换密钥) | 编排器 2026-11-19 对 R2-4 的裁决;P-07、P-17 |
| D10(编排器裁决,R3)声明收窄。本设计保证且只保证 §1 的 (a)–(d);「对话改写围栏内可写的引擎配置,就能改变一份被合法代入的凭据被送到哪里(换掉连接器的命令、覆盖模型的 `package`,以及任何同类做法)」作为一类残留,不由本设计关闭,关闭它的是 INT-safety I-13(owner 2026-11-14 已批,尚未建),由编排器排为下一份设计。依据:R2-1、R3-1 连续三轮出现经可写配置改道的新做法,根在 I-13;在根打开时,接收方绑定关不住一个开放的类;owner「不要设计的过于复杂」。R2 的「本地连接器凭据是否在保证内」并入这条残留,不另需决定。不加包钉死或最终接收方核对 | 编排器对 R3 的裁决;P-21、P-23 |


| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| R1 / `0c2483fda7` / 全文 | Codex(GPT-6),会话 01a1f358,只读 | F1 [Major] 全文预处理把可写显式文件变成取值入口 —— 采纳 | §4.1 `resolveCodePuppyCredentialRefs` 按解析树只在封闭位置代入,条目带 use(连接器按名字绑定,`codepuppy-secrets` 只在内联文档);§4.4 封闭清单;I4;E10 | 改写可写配置换掉连接器命令 → 残留(I-13 前提) |
| 同上 | 同上 | F2 [Major] 存放点自身是软链时 C1 不匹配真实目标 —— 采纳 | §4.5 写入已存在位置的真实目标;§4.3 读表只认普通文件、不跟随根以下的软链;删去 R0 留档里「只覆盖升级前历史状态、不做」那一行;E7 | — |
| 同上 | 同上 | F3 [Major] 官方连接器运行中物化 / 清空不经两个写入口 —— 采纳 | 重列全部写者(§4.3 写者表);C-a 改为装载前拉取,写者无需钩子;删去 T3 | — |
| 同上 | 同上 | F4 [Major] 预存别名、`/.vol`、firmlink、`/private`、改名上级目录未证 —— 采纳并补测 | P-17:firmlink / 软链上级 / 无别名 `/.vol` 被拒;**改名 userData 能绕过 R0** ⇒ 新增上级目录拒写块,复测被拒、正常写照常,真引擎复测零泄漏(`run/F4-P1.out`、`run/F4-ancestors.out`、`engine/out/R1-C-change.json`) | 预存硬链 / 克隆 / 有别名的 `/.vol` 仍可读 → 依据见 R2-4 裁决(本行原依据「只能由围栏外预先做出」不成立) |
| 同上 | 同上 | F5 [Major] FIFO 不能证明先于文件监听 / 请求处理 —— 采纳并补测 | P-18:真 Electron parentPort,utility 忙时推送 20/20、19/20 看到旧值,拉取 0/20 ⇒ C-a 改为「拉取完成后再解析」(`f5/F5-F7-result.json`) | C-b–C-e 留推送,理由 P-20 |
| 同上 | 同上 | F6 [Major] T3 失败后推送不会触发 `Config.reload` —— 采纳 | T3 删除;拉取让每次装载自取当前表;拉取失败接既有 `credential-change` 重启(§5) | — |
| 同上 | 同上 | F7 [Major] 转储、配置接口、日志未证 —— 采纳并补测 | P-14、P-19:转储里未见假值,配置接口围栏内连不上,日志只记名字;`Crashpad` 加入 C1(转储照写,围栏内 EPERM);E9 查日志、配置接口与转储(`f5/F7-fenced.out`) | 栈上值可能进转储、用户导出的调试包、连接器 stderr debug 日志 → 残留 |
| R2 / `0c2483fda7..1b51d972a8` / 修订部分 | Codex(GPT-6),会话 01a1f358,只读 | R2-1 [Major] 名字绑定仍把凭据交给被替换的程序;主进程直接应用路径无条件解析可写叶子 —— 采纳 | P-21 逐类列出接收方记录及其可写性;表条目改为 `inline` / `remote` / `local` 三类(`remote` 由远程 MCP 真源 `mcp-servers/<env>.json` 判定,`mcp-server-truth.ts:1-12`);`inline` 与 `remote` 只在内联文档代入;主进程路径改用 `resolveConnectorLeaf` 同一套绑定;E10 加主进程路径 | 本地连接器凭据 → 后由 D10 并入残留类 |
| 同上 | 同上 | R2-2 [Major] 合并并发拉取会复用旧快照 —— 采纳 | §4.1 `refreshCodePuppyCredentials` 改为每次装载独立请求、只认自己的 id;§4.3 P 行;§5 迟到回复一行;§6 被否决的替代;E11 | — |
| 同上 | 同上 | R2-3 [Major] 超时用旧表完成装载、没进恢复链 —— 采纳 | §4.1 超时 / 端口关闭也抛;§4.2 新增 `credentials.unavailable` → 主进程请求既有 `credential-change` 重启;§5 两行;D5;E12 | — |
| 同上 | 同上 | R2-4 [Major] 预存别名的范围依据不成立 —— 编排器范围裁决 | D9 记裁决与依据;P-17 末段与 §6 残留改写为「生效前的既有暴露」;R1 F4 行的旧依据标为不成立;删去留档里「清空旧 inode」一行 | 旧副本失效若要做 → 另一条意图(需轮换密钥),由编排器转告 owner |
| R3 / `1b51d972a8..2fccc6ae65` / 只看 R2-1 | Codex(GPT-6),会话 01a1f358,只读 | R3-1 [Major] 显式文件里的模型级 `package` 能把含密钥的 settings 交给会话放的模块 —— 按 D10 归入残留类 | P-23 记事实;§1、§6 残留类与 I-13 输入清单;不加包钉死或最终接收方核对 | 由 INT-safety I-13 关闭 |
| 同上 | 同上 | R3-2 [Major] `remote` 归属会把旧版本降成 `local`、真源读错会折叠成空表 —— 采纳,取「撤掉 `remote` / `local` 分类」 | 表条目只剩 `inline` / `connector`;`readCredentialTable` 不再读远程真源;`resolveConnectorLeaf` 去掉 origin;理由见 §6 被否决的替代 | — |
| 同上 | 同上 | R3-3 [Major] 主进程普通文件回退没有挡住别名 —— 采纳 | §4.1 `isStoreTarget` 用 C1 的同一份真实目标清单、按设备号 + inode 判断;P-22 实测 firmlink 写法 realpath 不同、inode 相同(`run/R3-realpath.out`);I6;E10 加软链、相对路径、大小写变体、firmlink 四种写法 | — |
| 同上 | 同上 | R3-4 [Major] 真源叶子是 v1 `oauth.clientSecret`,只认 `client_secret` 会把合法密钥换成空串 —— 采纳 | §4.1 / §4.4 两种写法都认,顺序照旧先解析后 `projectServerConfig`;E10 加用例 | — |

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| 删掉明文镜像 `codepuppy-secrets/`,主进程直接从环境 / 钥匙串建表 | 盘上少一份明文镜像;收益只在围栏外的同用户进程那一侧 | 结果不需要;改动面大 | 范围扩到围栏外的同用户进程时 |
| 临时目录式存放点的上级目录拒写(`<T>`、`/private/var/folders/<a>/<b>` 等)尚未在真引擎里跑过 | P7b 用可写根内的仿制目录证了改名被拒、写照常 | 机制与 userData 一行相同 | E1 / E7 覆盖 |
| INT-safety I-13 | C1 不覆盖;与本设计的交点见残留 | 不在本次授权内 | 由 I-13 自己的授权推进 |
