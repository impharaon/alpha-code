---
id: DESIGN-stored-credentials-fence
title: 会话里的命令与工具读不到 Code Puppy 存的凭据 技术设计
summary: 凭据文件留在原处;围栏对 Code Puppy 的凭据存放点(userData 下六项与官方连接器运行期明文目录)一律拒读拒写(profile 的最后一条文件规则,按真实路径渲染);引擎进程要用的值只由主进程经既有的主进程↔引擎进程窄消息交给它(启动消息带全表,续期热应用与连接器写密钥之后再推全表),进程内一份只读表供引擎配置装载、ext 与云连接器现读;配置里的 {file:} 引用一字不变;用户无感,不新增步骤、等待与设置
kind: tech-design
status: draft
spec: SPEC-stored-credentials-fence
spec_version: 0
review:
  rounds: 0
  reviewed_sha: ""
  verdict: ""
owners: [owner]
last_reviewed: 2026-11-19
---

# DESIGN-stored-credentials-fence｜会话里的命令与工具读不到 Code Puppy 存的凭据 技术设计

只写决定。文件清单、提交顺序与测试由实现方的 plan.md 写。§3、§7 已退役,编号不复用。标注:**测** = 本轮实测(假值、临时目录);**读** = 读代码 / 文档(版本见 §1);**推** = 推断,未测。

## 1. 基线

- Spec:**没有**。现有规格都不承载本结果的 AC(逐个核过,见下方「返还缺口」G1);spec delta 由编排器写,本设计不写规格。`spec` 字段先占 `SPEC-stored-credentials-fence` v0。
- Owner 授权(2026-11-19,逐字):编排器的建议「密钥只留在应用主进程里，用到时由主进程代办，围栏内的进程一律读不到这个目录。这样用户完全无感，但要先出技术方案。」owner 回答「按照你的建议，不要设计的过于复杂。」——后半句作为硬约束:只做让结果成立的最小机制,不造通用凭据代理、不加选项、不为假想需求加层。
- 本设计覆盖的结果(spec 落地前的工作编号):
  - **R-1** 对话里运行的命令与工具(shell、工具、连接器 / MCP 子进程、脚本),在任何权限档都读不到 Code Puppy 在本机存的凭据:用户自己的模型密钥、连接器令牌、Code Puppy 登录凭据。
  - **R-2** 同一批进程改不了、删不掉这些凭据文件。
  - **R-3** 模型调用、连接器、登录 / 登出、运行中增删密钥、续期热应用照常;用户已存的密钥与登录升级后照常可用。
  - **R-4** 用户看不到任何变化:没有新步骤、提示、等待或设置。
- 代码基线:`origin/alpha` @ `a20dadb942`(0.2.4)。
- 平行设计:`design/project-writable` @ `cadd657d29`(DESIGN-child-process-write-fence 的 X1/X2)。本设计不依赖它,两边各自落地的位置见 §4.5。
- 相邻意图 INT-safety I-13(引擎配置与全局配置目录在围栏内可写):不在范围,本设计的规则不覆盖它(§10 留档)。

**返还缺口(给编排器,不需要 owner)**

- **G1 没有承载本结果的规格。** 核过的候选:`SPEC-tool-write-fence`、`SPEC-child-process-write-fence`(只管写)、`SPEC-tool-network-egress`(只管网)、`SPEC-custom-provider-keychain`(AC-03/AC-04 只讲自定义密钥离开钥匙串的通路)、`SPEC-project-engine-config-takeover`(第 47 行把配置里的 `{file:}` 列为「读普通内容不设闸」)、alpha-work `SPEC-purpose-bound-cloud-credentials` AC-04(取用点唯一,见 G3)。「同用户进程能读这些文件」今天只作为代码注释里的已接受风险存在(`packages/ui-mac/src/main/codepuppy-secret-files.ts:19-21`)。
- **G2 引擎自己保存的第三方远程连接器 OAuth 令牌不在本设计内。** 它们在引擎数据库的凭据表里(`packages/core/src/mcp/oauth.ts:289-330` 读写 `Credential.Service`),引擎进程本身就在围栏里、每次连接都要读写它;围栏规则拦不住子进程而放过引擎(P-01)。这不是 Code Puppy 另写的一份副本,也不在 owner 认可的「这个目录」里。规格措辞宜写成「Code Puppy 自己的凭据存放点」(§4.5 的七项),把引擎库里的 OAuth 令牌写进残留;若要覆盖它,是另一件事,需要另行授权。
- **G3 用途绑定规格 AC-04 的措辞。** 它把桌面云 MCP 令牌的取用点写成「文件通道」。本设计后,文件仍是唯一来源(主进程读它),引擎进程里的取用点换成由它喂出的内存表;「取用点唯一」这一性质不变。措辞是否要改由编排器定。

## 2. 地面真相

**P-01 围栏只管写与网,读不受限;引擎、ext 与注入同在一个被围栏的进程里,子进程继承。**(读)profile 由 `renderProcessFenceProfile` 唯一渲染:`(allow default)` → `(deny file-write*)` → `(allow file-write* W1…W19)` → N1–N4(`packages/ui-mac/src/main/process-fence-profile.ts:150-180`)。sidecar 在 `start()` 第一句装围栏(`packages/ui-mac/src/main/sidecar.ts:141-145`、`:234-245`),之后同进程里注入、ext、引擎都在围栏里。⇒ 一条普通的拒读规则会连引擎与 ext 一起拦住(P-11 实测)。

**P-02 今天在被围栏的进程里读凭据文件的代码,全集如下。**(读;范围 = sidecar 的 import 闭包 117 个文件 + 引擎 core 里的 `{file:}` 读者;命令:`sidecarSourceFiles()` 产出清单后 grep 凭据目录名、`secretFilePath`、`hasSecretFile`、`credentialRef`、`resolveFileRefs`、`FILE_REF`,另 grep core 的 `ConfigVariable.substitute` 与 `governedCredentialFetch`)

| 编号 | 位置 | 读什么 | 何时 |
| --- | --- | --- | --- |
| C-a | `packages/core/src/config.ts:172`(显式文件)、`:294`(内联内容)→ `packages/core/src/config/variable.ts:40-81` | 配置文本里的 `{file:}`:BYOK / 自定义节点 apiKey、云 MCP 生产分支的 Authorization、远程 MCP 真源的 headers / clientSecret(含官方 GitHub 连接器)、`codepuppy.jsonc` 里本地连接器的 environment(含官方数据库连接器的 DSN) | 每次配置装载 / 重载 |
| C-b | `packages/core/src/mcp/client.ts:378` | 云 MCP 令牌 | 每次请求 |
| C-c | `packages/ext/src/platform-credential-header.ts:32` | 平台凭据 | 每次模型请求 |
| C-d | `packages/ext/src/cloud-websearch-kill.ts:380`、`cloud-vision.ts:91`、`cloud-vision-hooks.ts:106` | 云 MCP 令牌 | kill-switch 装载 / 每次识图 |
| C-e | `packages/ext/src/cloud-access.ts:13` | 云 MCP 令牌文件是否存在 | 每次判定 |
| C-f | `packages/ui-mac/src/main/codepuppy-models.ts:108-115`、`:199`;`codepuppy-config-injection.ts:246` | BYOK / 自定义 / 平台 / MCP 令牌是否存在、是否非空 | 每次注入 |

闭包里没有任何代码碰 `codepuppy.env`、`codepuppy-auth.json`、`codepuppy-byok-keys.json`、`codepuppy-pkce.json`(同一次 grep,按 `USER_DATA_LAYOUT` 的四个键名查)⇒ 拦住它们不影响引擎进程。

**P-03 引擎配置装载读不到 `{file:}` 时代入空串并记一条 warning,不抛。**(读)`variable.ts:63-73`;代入值按 JSON 字符串转义(`:76`);`{env:}` 先于 `{file:}` 代入(`:27-37`)。内联内容经 `start()` 选项进引擎、只在内存里(`packages/ui-mac/src/main/engine-server-options.ts:51-54`);显式文件是 sidecar 把用户 `codepuppy.jsonc` 合成后写在 userData 下的盘上文件,里面原样带着连接器的 `{file:}` 引用(`packages/ui-mac/src/main/engine-explicit-config.ts:11-17`)。

**P-04 运行中会变的凭据,今天怎么到引擎。**(读)
- 平台凭据与云 MCP 令牌续期(正式版约每 10 分钟一次,`platform-credential-header.ts:3-5`):主进程原子重写两份文件、不重启(`codepuppy-secret-files.ts:153-189`,接线 `packages/ui-mac/src/main/index.ts:798`);在场性变了或写失败 ⇒ `credential-change` 重启。
- 登录 / 登出 / 换号、增删 BYOK 密钥、增删自定义节点、官方连接器:结构性重启(`sidecar-lifecycle.ts:10-21`;`index.ts:1040`、`:1657-1663`),fork 前 `syncSecretFiles` 重写镜像(`server.ts:418`)。官方连接器的运行期明文每次 fork 前清掉再从密文恢复(`server.ts:400`、`:555`)。
- 扩展包里的连接器:主进程先写新版本目录里的密钥(`codepuppy-mcp-secrets.ts:250-282`,只增不覆盖),再提交配置,再经 parentPort 发 `codepuppy.reload.request`,不重启(`packages/ui-mac/src/main/ext-ipc.ts:166-177`、`reload-coordinator.ts:1-13`)。

**P-05 既有的主进程↔sidecar 窄消息与进程内交接。**(读)启动消息已经只在内存里带一个秘密(`password`,「永不进启动文档,也不进本进程环境」,`sidecar.ts:81-99`;发送 `server.ts:665-673`)。sidecar 的命令分发在 `sidecar.ts:122-139`、`:294-313`。启动文档挂在 `globalThis[Symbol.for("codepuppy.bootstrap")]`,sidecar、ext、引擎三个 bundle 各编一份读法、读同一个槽(`packages/util/src/codepuppy-bootstrap.ts:1-9`、`:161-162`、`:241-262`)。

**P-06 Code Puppy 的凭据存放点。**(读;userData 下的名字取自 `user-data-layout.ts:4-23`)前六项在 userData 下、今天都在 W3 可写集里;第七项在主进程的临时目录下、今天在 W12 可写集里。

| 存放点 | 内容与形态 | 谁写 / 谁读 |
| --- | --- | --- |
| `<userData>/codepuppy-secrets/` | 平台凭据、云令牌、MCP 令牌、BYOK 与自定义节点密钥的明文镜像,0600 | 主进程 fork 前与热应用时写;今天引擎进程现读(P-02) |
| `<userData>/codepuppy-mcp-secrets/` | 扩展包连接器令牌,明文 0600,按版本目录存;**唯一存放处** | 主进程写;引擎经 `{file:}` 读 |
| `<userData>/codepuppy.env` | 用户手写的明文密钥文件(`codepuppy-secrets.ts:5-24`) | 主进程启动时读 |
| `<userData>/codepuppy-auth.json` | 登录凭据,safeStorage 密文(`data-clear.ts:56`) | 主进程 |
| `<userData>/codepuppy-byok-keys.json` | BYOK / 自定义密钥库,safeStorage 密文(`codepuppy-byok-keys.ts:1-18`) | 主进程 |
| `<userData>/codepuppy-pkce.json` | 登录握手的临时凭证(`data-clear.ts:57`) | 主进程 |
| 官方连接器运行期目录 `<realpath(tmpdir)>/codepuppy-connectors-<uid>-<hash>/`(`official-connector-recipes.ts:27-56`) | 官方 GitHub 连接器的令牌、官方数据库连接器的 DSN 的**运行期明文**:密文在 `<appData>/codepuppy-state/connector-secrets/` 里,每次 fork 前解密写到这里,配置用 `{file:}` 引它(`official-connector-resources.ts:154-180`、`:206-226`) | 主进程写;引擎经 `{file:}` 读 |

**P-07 真引擎复现原发现,并证实「写也挡不住」。**(测;真嵌入引擎 + 生产注入 + 真 ext + 真围栏 addon,整个测试进程用生产渲染的 profile 围栏;假值;探针 `~/.cache/alpha-orch/2026-11-19/secrets-design/engine/c-probe.test.ts`,结果 `engine/out/C-control.json`)

| 档位 | shell `cat` | 读文件工具 |
| --- | --- | --- |
| 全部批准 | 不问,三份假值(平台凭据、连接器令牌、`codepuppy.env`)进了模型上下文 | 问一次「工作区外目录」,读到 |
| 请求审批 | 问一次 shell,读到 | 同上 |
| 只读 | 没有 shell 工具 | 拒绝 |

同一轮 shell 经软链、硬链、大小写变体都读到;C 探针(`run/P0.out`)另证:围栏内子进程能追加写、在目录里新建、`RENAME_SWAP` 换掉、改名移走、删掉这些文件,也能 `clonefile` 出一份。

**P-08 seatbelt 规则顺序,实测而不是假设。**(测;`src/render.ts` 用生产渲染器出各臂,`src/fence-run.c` 以与生产 addon 相同的 `sandbox_init` 装围栏再 exec;`run/P1–P3.out`、`run/P5.out`)
- `(allow default)` 是兜底,不参与先后:拒读写在 `(allow default)` 前面(P3)照样拒读。⇒ 依赖的不是「在 allow default 之后」。
- 显式规则之间后写的胜出:拒写放在 W3 的 `(allow file-write* …)` 之前(P2)⇒ 读仍被拒,写、改名照样成功;放在它之后(P1)⇒ 都被拒。
- 平行设计的 X1(私有类写扩展):主进程为 userData 签发令牌、围栏内消费后,C1 在 X1 之后 ⇒ 写凭据文件 EPERM(P5a);X1 在 C1 之后 ⇒ 写成功(P5b)。⇒ C1 必须是全文最后一条文件规则。

**P-09 规则里的路径必须是真实路径。**(测)C1 经一个指向 userData 的软链拼出(P4)⇒ 一条都不匹配,全部读写成功;C1 用大小写变体拼出(P6)⇒ 照样匹配(本机卷不区分大小写)。⇒ C1 按 `realpath(userData)` 渲染。

**P-10 C1 拦住全部途径。**(测;`run/P1.out`,假值文件在平台凭据与连接器令牌两处各跑一遍)直接读、大小写变体、`dir/../dir/file`、`//./`、`/.vol/<dev>/<ino>`(stat 被拒,拿不到 inode)、工作区软链到文件 / 到目录、硬链、`clonefile`、列目录、追加写、新建、`RENAME_SWAP`、改名移走、改目录名、删除:全部 `EPERM`;`codepuppy.env` / `codepuppy-auth.json` / `codepuppy-byok-keys.json` 的 cat、覆盖写、删除:全部 `EPERM`;盘上文件事后原样。userData 别处与工作区照常可写。真引擎同组(`engine/out/C-change.json`):三档 × shell / 读文件工具 × 三份假值,零泄漏;shell 里软链、硬链、大小写变体、覆盖写、`rm` 全部失败,事后在围栏外读盘原样。

官方连接器运行期目录(P-06 第七行)本轮未单独实测:它与 userData 下两个目录是同一种规则形状(C1 的拒绝 `subpath` 压过它之前的一条放行 `subpath`,只是放行来自 W12 而不是 W3),结论由 P1 推出(推);实现证据 E1 必须覆盖它。

**P-11 只加 C1、不换读法 ⇒ 引擎断。**(测;`engine/out/C-denyonly.json`)模型请求零次到达桩,回合以既有具名错误失败「Code Puppy platform credential could not be read — the request was not sent.」。系统日志里的 seatbelt 拒绝记录与此一致(`engine/out/sandbox-denials.txt`)。

**P-12 「值只经消息到达」的进程模型成立。**(测;`src/main-model.mjs`(未围栏,代主进程)+ `src/sidecar-model.mjs`(经 `fence-run` 用生产 profile + C1 围栏,代 sidecar);`run/B-P1.json`,对照 `run/B-P0.json`)主进程读两个凭据目录建表、随启动消息交出;sidecar 自己读两个文件 `EPERM`,它派生的 `sh` 里 `cat` 两个文件 `EPERM`、`env` 里没有值;用表里的值发出的请求,桩收到 `Bearer <假值>`;主进程原子重写平台凭据后推全表,下一次请求桩收到新值。配置文本预处理(§4.1)后:apiKey 与连接器 TOKEN 解析为原值,配置文本本身不含值,含 `{env:HOME}"\` 的值原样往返。对照臂(无 C1):sidecar 与子进程都读到。

**P-13 存在性测试仍看得到文件名。**(测)C1 下 node / bun 的 `existsSync` 为 true(`access(F_OK)` 不属 `file-read*`),`stat`、`ls`、`test -e` 被拒。本设计不依赖这一点:引擎进程里在场性也只问内存表(§4.4)。

**P-14 其它可能的副本。**(读)
- `codepuppy-shell-env.json`:登录 shell 的输出,探测时只传最小环境(`shell-env.ts:42-56`),里面只有用户自己 shell 配置导出的值,没有 Code Puppy 存的凭据 ⇒ 归残留「用户自己的 shell 配置」。
- 日志:fork 时只记名字(`server.ts:420`);`variable.ts` 的 warning 记路径不记内容;ext 的错误文字不含路径与内容(`platform-credential-header.ts:16`)。
- 盘上的引擎配置:显式文件与 `codepuppy.jsonc` 只含引用(连接器密钥「durable config 只含 {file:} 引用」,`codepuppy-mcp-secrets.ts:147-151`)。
- Code Puppy 自己写在别处的明文副本:官方连接器运行期目录(P-06 第七行)——今天在 W12 之下,围栏内可读可写,在范围内,由 C1 第七行覆盖。官方连接器的密文目录 `connector-secrets/` 不在任何可写根下,里面只有密文 ⇒ 归残留。
- 引擎自己的凭据库:见 G2。

**P-15 北极星。**(读)`packages/core/src/config.ts` 与 `packages/core/src/mcp/client.ts` 已登记为接管文件(`scripts/north-star-guard.sh:140`、`:175`);`client.ts` 在原 ADR 之外已有按票标注的块(`codepuppy(#1562)`、`codepuppy(#1645)` 等,`client.ts:3`、`:37-38`、`:61-75`),是「已接管文件里加一处标注块」的先例。`packages/util/src/` 下以 `codepuppy-` 命名的新文件按 ADR-043 属 Code Puppy 自有,不算新接管。

**P-16 写盘登记簿。**(读)`codepuppy-secret-files.ts` 的写盘点今天登记在 W3 之下(`scripts/process-fence-write-sites.tsv:27-35`)。

## 4. 接口契约

### 4.1 进程内凭据表(新文件 `packages/util/src/codepuppy-credentials.ts`)

只 import `node:path`、`node:os`;不碰文件系统。与启动文档同一种交接:一个 `globalThis` 槽,三个 bundle 各编一份读法。

```ts
// north-star: codepuppy-* 命名,ADR-043
/** 绝对路径(path.resolve 之后的形态)→ 主进程读到的文件原文(不 trim;读者照今天的做法自己 trim)。 */
export type CodePuppyCredentials = Readonly<Record<string, string>>

/** 消息字段的校验。不是普通对象、键不是绝对路径或不等于 path.resolve(键)、值不是字符串 ⇒ 抛 Error,
 *  消息只说哪一类不对,不含任何值。空对象合法(什么都没存)。 */
export function parseCodePuppyCredentials(value: unknown): CodePuppyCredentials

/** 只有 sidecar 调:整表替换(冻结后挂到 globalThis[Symbol.for("codepuppy.credentials")])。 */
export function publishCodePuppyCredentials(table: CodePuppyCredentials): void

/** 引擎进程里所有读者用它。`~/` 按 os.homedir() 展开(与 variable.ts:61 同)、path.resolve、按键精确查。
 *  没有发布过表 ⇒ undefined。 */
export function codepuppyCredential(path: string): string | undefined

/** 现有 `readFile` 形参的直接替身:有值返回原文,没有就抛 Error("Code Puppy credential is not available")
 *  —— 不带路径,不带值。 */
export function readCodePuppyCredential(path: string): string

/** 引擎配置装载的预处理。记号文法与 variable.ts 相同(`\{file:[^}]+\}`);路径在表里的记号换成
 *  JSON.stringify(value.trim()).slice(1, -1),其中每个 "{" 写成 \u007b(引擎随后的 {env:}/{file:} 两遍
 *  都碰不到值里的字符,解析后还原为 "{");不在表里的记号原样留给引擎。 */
export function substituteCodePuppyCredentialRefs(text: string): string
```

`\u007b` 那一步的理由:`variable.ts` 先代 `{env:}` 再代 `{file:}`,文件内容从不再被展开;预处理跑在它前面,不转义就会让含 `{env:` / `{file:` 的值被二次展开。P-12 用 `pa{env:HOME}ss"word\` 证过往返。

### 4.2 主进程 → sidecar 的两条消息(既有窄通道)

```ts
// sidecar.ts StartCommand 增加一个必填字段;与 bootstrap 同样,parseCommand 原样透传,start() 里解析
type StartCommand = {
  type: "start"; hostname: string; port: number; password: string; fence?: ProcessFenceStartInput; bootstrap: unknown
  /** 必填;什么都没存时是 {}。start() 里 parseCodePuppyCredentials → publishCodePuppyCredentials,
   *  在注入与 import 引擎之前;解析失败走与「darwin 缺围栏」「启动文档坏了」同一条路:error IPC + exit(1)。 */
  credentials: unknown
}

// 新命令:启动之后任何时候,整表替换
type CredentialsCommand = { type: "credentials"; credentials: CodePuppyCredentials }
// sidecar:parse → publish;形状不对 ⇒ console.error 一行(不含值),保留上一张表。无回执。
```

### 4.3 主进程的表与三次推送

`packages/ui-mac/src/main/codepuppy-secret-files.ts`(Electron-free,已是凭据目录的权威)增加凭据存放点的唯一清单与读表函数:

```ts
export type CredentialStore = {
  /** 与该存放点的 `{file:}` 引用同一种写法的绝对路径:userData 下的用 app.getPath("userData") 拼,
   *  官方连接器运行期目录用 officialRuntimeParent() 的返回值(它本身已是真实路径) */
  path: string
  kind: "dir" | "file"
  /** 引擎要用里面的值 ⇒ 进表;只需拦住、引擎从不需要的(codepuppy.env、两份密文、PKCE)⇒ 不进表 */
  engineReads: boolean
}
/** userData 下六项(名字取自 USER_DATA_LAYOUT 的 secrets、mcpSecrets、envFile、auth、pkce、byokKeys)
 *  + 官方连接器运行期目录(调用方算出才给;算不出 = 官方连接器在这台机器上起不来,也就没有运行期明文)。
 *  调用方是主进程(server.ts / process-fence-plan.ts);本模块不 import 官方连接器模块(那会把钥匙串带进 sidecar 闭包)。 */
export function credentialStores(input: { userDataPath: string; officialRuntimeParent?: string }): CredentialStore[]

/** 读 engineReads 的目录之下(任意深度)全部普通文件,跳过以 "." 开头的条目(写入中的临时文件)。
 *  键 = path.resolve(<store.path>/<相对路径>),与各处产出的 `{file:}` 引用同一写法;目录不存在 = 没有条目;
 *  其它 IO 错误抛出。从不记录值。 */
export function readCredentialTable(stores: readonly CredentialStore[]): Record<string, string>
```

主进程只在这三处把整表交出去(表永远等于 `engineReads` 那三个目录在盘上的当前内容,不做增量):

| 触发 | 位置与时机 | 失败 |
| --- | --- | --- |
| T1 fork | `server.ts` spawnLocalServer:fork 之后,先把这个子进程登记为「当前推送目标」,再**在同一个同步步骤里**建表并发出 `start` | 建表抛 ⇒ 杀子进程、本代失败(与 `syncSecretFiles` 失败同一条拒绝路) |
| T2 续期热应用 | `applyPlatformCredentialsHot` 两份写入与回读摘要都通过之后 | 当前没有子进程 ⇒ 跳过(下一次 fork 带上,与今天 `forked` 为空时返回 `applied` 同义);建表或发送抛 ⇒ 返回 `needs-structural` |
| T3 连接器写密钥 | `writeMcpSecretVersioned` / `writeMcpSecret` 成功 rename 之后、返回调用方之前 | 当前没有子进程 ⇒ 跳过;建表或发送抛 ⇒ 错误日志一行(不含值),下一次推送或 fork 补上 |

「当前推送目标」由 `server.ts` 持有(它拥有子进程),子进程退出即清除。T1 的同步步骤保证:建表之前写下的密钥在表里,之后写下的由 T3 推给这个子进程、排在 `start` 之后(同一端口先进先出)。T1 在官方连接器运行期明文恢复(`server.ts:555`)之后,所以表里有它们;官方连接器的增改本来就走重启,不需要另一个触发。T3 排在配置提交之前(P-04 的写序),所以由文件监听或重载请求触发的配置重载看到的已经是新表。删除密钥不推:路径按版本只增不复用,删掉的条目不会被任何新配置引用;在场性变化本来就走重启。

### 4.4 引擎进程里的读者(P-02 的每一处)

规则:在 sidecar 进程里,凭据的值与在场性**只**从 §4.1 的表来;没有一条代码路径从盘上读凭据存放点。主进程(出网放行派生等)照旧读盘。

| 读者 | 改法 | 表里没有时(都是今天的既有行为) |
| --- | --- | --- |
| C-a 引擎配置装载 | `config.ts` 只在**显式文件**(`start()` 的 `config.file`,Code Puppy 合成)与**内联内容**两处,把交给 `ConfigVariable.substitute` 的文本先过 `substituteCodePuppyCredentialRefs`;全局、项目、托管、wellknown 文档不过。新的 `codepuppy(#<票号>)` 标注块 | 记号留给 `variable.ts` ⇒ 读盘 EPERM ⇒ 代入空串 + warning(P-03) |
| C-b 云 MCP 请求 | `client.ts:378` 的读法换成 `readCodePuppyCredential`(包成 Promise) | 本地答 401,请求不出网 |
| C-c 平台模型请求 | 默认读法换成 `readCodePuppyCredential` | `LoadAPIKeyError`,请求不发出 |
| C-d kill-switch 装云 MCP、云识图 | 三处默认读法换成 `readCodePuppyCredential` | 不装并报错一行 / `credential-unreadable` |
| C-e 云访问状态 | 默认存在性判断换成 `codepuppyCredential(p) !== undefined` | `credential-missing` |
| C-f 注入的在场 / 非空判断 | 在 sidecar 里问表;同一组函数在主进程照旧读盘(形参或读法由实现方定,不许靠「读盘失败当不存在」) | provider 不注入、云 MCP 不登记,与今天文件缺席相同 |

只给 Code Puppy 自己的两份文档做预处理是有意的:项目配置里的 `{file:<凭据路径>}` 之后读到空串,不会借预处理拿到值。

### 4.5 围栏 profile:C1

渲染器 `renderProcessFenceProfile` 增加一个输入 `credentialStores: readonly { path: string; kind: "dir" | "file" }[]`,由 `process-fence-plan.ts` 从 §4.3 的 `credentialStores()` 得到,并对每一项求真实路径再交给渲染器:userData 用计划已有的 `deps.realpath`(`fs.realpathSync.native`)求出后拼名字,官方连接器运行期目录本身已是真实路径。userData 求不出 ⇒ 计划抛 ⇒ 拒绝 fork(既有失败路);`officialRuntimeParent()` 抛 ⇒ 这一项不给(官方连接器起不来,不会有运行期明文)。渲染器只渲染收到的清单,不另写名字;`dir` → `subpath`,`file` → `literal`,沿用 `assertSeatbeltSafePath`。

```
(deny file-read* file-write*
  (subpath "<R>/codepuppy-secrets")
  (subpath "<R>/codepuppy-mcp-secrets")
  (literal "<R>/codepuppy.env")
  (literal "<R>/codepuppy-auth.json")
  (literal "<R>/codepuppy-pkce.json")
  (literal "<R>/codepuppy-byok-keys.json")
  (subpath "<T>/codepuppy-connectors-<uid>-<hash>"))      ; C1
```

`<R>` = userData 的真实路径;`<T>/…` = `officialRuntimeParent(codepuppyGlobalRoot())`。

- 位置:**全文最后**,N4 之后。不变量:C1 是 profile 里最后一条文件规则(P-08)。
- 与平行设计:X1/X2 落在「`(allow file-write* …)` 块之后、网络行之前」,C1 落在网络行之后;两处改动在渲染数组里隔着网络行,文本上互不冲突,任一顺序落地 C1 都仍在 X1 之后(P5a)。
- 两份密文与 PKCE 也在 C1 里:它们在 W3 之下,今天会话删得掉、改得了(删登录文件 = 用户被登出,删密钥库 = BYOK 密钥丢失,R-2);拒读随同一条规则一起得到。`codepuppy.env` 是明文,两样都要。
- 不拦存在性测试(P-13):文件名不是凭据;多一条规则没有价值。
- 非 darwin 没有围栏(既有「如实声明」),表的机制照样生效,C1 不渲染。
- 写盘登记簿:`codepuppy-secret-files.ts` 那九行的根从 `W3` 改为 `main-only`(P-16;只有主进程执行这些写)。

### 配置

无新增配置键、无新开关。

## 5. 数据与失败

不做迁移:七个存放点的位置、格式、权限都不变,升级后第一次 fork 由 T1 从既有文件建表 ⇒ 已存的密钥与登录照常(R-3)。

| 失败窗口 | 结果 | 日志 |
| --- | --- | --- |
| 配置装载时表里没有某条引用(手写了另一种路径写法) | 空串;provider 在注入时已按表判过,不会被注入;连接器拿到空令牌,自己报认证失败 | 引擎 warning,记路径不记值 |
| 启动消息缺 `credentials` 或形状不对 | sidecar 拒绝启动,本代失败 | error IPC 原因 |
| 运行中 `credentials` 消息形状不对 | 保留上一张表 | 一行,不含值 |
| fork 时建表失败 / C1 求不出 userData 真实路径 | 拒绝 fork | 既有拒绝日志 |
| 热应用时没有子进程 / 推送失败 | 跳过并由下一次 fork 带上 / `needs-structural` → 既有 `credential-change` 重启 | 既有 |
| 连接器写密钥后推送失败 | 本代该连接器可能拿到空令牌;下一次推送或 fork 修好 | 错误一行 |
| 重启进行中写入连接器密钥 | T1 的同步步骤闭合此窗口(§4.3) | — |

任何失败都不会落回可读文件:围栏内这些路径根本读不了。任何日志(主进程、sidecar、引擎)都不写值。

## 6. 架构落点

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| 进程内凭据表 | `packages/util/src/codepuppy-credentials.ts`(新文件,Code Puppy 自有) | `node:path`、`node:os` | 启动文档的 `globalThis` 槽交接(`codepuppy-bootstrap.ts:161-162`) |
| 启动 / 凭据消息的接收 | `packages/ui-mac/src/main/sidecar.ts` | util | 启动命令带秘密的先例(`sidecar.ts:85-86`);启动文档在 `start()` 里解析的先例 |
| 推送目标与 T1 | `packages/ui-mac/src/main/server.ts` | `codepuppy-secret-files.ts` | 既有 `child.postMessage` 窄通道(`server.ts:585-588`、`:665`) |
| `credentialStores` / `readCredentialTable` 与 T2 | `packages/ui-mac/src/main/codepuppy-secret-files.ts` | `user-data-layout.ts` | 凭据目录与热应用的现有权威;userData 命名的唯一来源 `USER_DATA_LAYOUT` |
| T3 | `packages/ui-mac/src/main/codepuppy-mcp-secrets.ts` | 同上 | 连接器密钥唯一的两个写入口 |
| C1 渲染与真实路径 | `process-fence-profile.ts`、`process-fence-plan.ts` | `codepuppy-secret-files.ts`;计划还调 `officialRuntimeParent`(`official-connector-recipes.ts:27`) | 唯一渲染点(`process-fence-profile.ts:138`);计划已有的 `realpath` 依赖;官方连接器运行期目录的唯一算法 |
| 配置预处理调用 | `packages/core/src/config.ts`(已登记接管) | util | 接管文件里按票标注块的先例(`client.ts` 的 `#1562`、`#1645`) |
| 云 MCP 读法 | `packages/core/src/mcp/client.ts:378`(已登记接管,既有 `#1562` 块) | util | 同上 |
| ext 五处默认读法 | `packages/ext/src/` | util(与启动文档同样相对引入) | 各处既有可注入的 `readFile` / `exists` 形参 |

- 新目录 / 新模块:无新目录。新文件只有 `codepuppy-credentials.ts`,住在启动文档旁边,因为 core、ext、ui-mac 三方都要 import 它,`packages/util` 是三者都已依赖的那一层。
- 收敛:引擎进程里的凭据读法从五处各自 `readFileSync` 默认值收成一个读者(K2 更好)。
- 架构约束:北极星不新增接管文件;`config.ts` 多一处标注块,超出了 `north-star-guard.sh:173-175` 注释里「接管面只在 ADR-049 那条链上」的描述 —— 实现时在那段注释里补记这一块(与 `client.ts` 多块并存的写法一致)。若编排器认为这需要单独的 ADR,那是记录方式的选择,不改变本设计。
- 工程标准:不新增配置;值不进日志(第 5 条);错误沿用各读者既有的具名错误,不另造错误体系。
- 被否决的替代:
  - sidecar 在装围栏之前自己读文件再拒读:续期每 10 分钟一次、扩展包连接器不重启生效,运行中仍要主进程推送 ⇒ 两套机制;还要把「装围栏是 `start()` 第一句」挪后。
  - 把值直接写进内联配置内容:配置内容会带值(本轮约束不允许);盘上的显式文件与 `codepuppy.jsonc` 也解决不了。
  - 改用 `{env:}`:值进 sidecar 环境,上游以 `{...process.env}` 派生每个 MCP / LSP 子进程 —— A6 当初关掉的正是这条。
  - BYOK / 自定义节点也改成占位 apiKey + 请求时补头:各 SDK 认证头不同,连接器环境里的令牌照样解决不了,改动更大。
  - 主进程代发请求(凭据代理):新子系统,owner 明令不要复杂。
  - 在 sidecar 里全局替换 `fs` 读函数:隐式、脆弱,所有读盘都受影响。
  - 删掉明文镜像 `codepuppy-secrets/`、主进程直接从环境与钥匙串建表:结果不需要动存放,改动波及热应用、出网派生、数据清除与测试宿主(§10 留档)。
- 安全面:
  - 威胁边界:对话启动的、被围栏的引擎进程树里的任何进程(shell 命令、工具、连接器 / MCP 子进程、脚本),经任何路径(软链、硬链、克隆、另一种路径写法、Code Puppy 自己写在别处的副本)读或改 §4.5 的七个存放点。
  - 必须守住的不变量:
    - **I1** 被围栏的进程打不开七个存放点的任何路径,读写都不行;C1 是最后一条文件规则、按真实路径渲染。
    - **I2** 凭据值不出现在 sidecar 环境、任何子进程的环境(连接器自己配置的环境变量除外,见残留)、配置内容文本、Code Puppy 写在围栏可读处的任何文件、任何日志里。
    - **I3** sidecar 进程里的凭据值只来自主进程的 `start` / `credentials` 消息;sidecar 的任何代码路径都不读盘上的存放点。
    - **I4** 主进程交出的永远是进表的三个目录的当前全文;续期、登录 / 登出、增删密钥、连接器增改的生效方式与今天相同,用户看不到差别。
  - 残留(每条一行,不设计缓解):
    - 连接器子进程合法拿到的、写在它自己环境里的令牌,它与它派生的进程看得到。
    - 引擎进程内存:表与已解析的配置都在 sidecar 堆里。
    - 用户自己选择装进引擎进程的插件,能调用同一个读者。
    - Code Puppy 存放之外的东西:用户 shell 配置里导出的值(含它在 `codepuppy-shell-env.json` 里的那份输出)、用户用 `CODEPUPPY_ENV_FILE` 指到别处的文件、其它应用、系统钥匙串条目本身(由 macOS 自己的访问提示把关)。
    - 引擎数据库里第三方远程连接器的 OAuth 令牌(G2)。
    - 官方连接器的密文目录 `<appData>/codepuppy-state/connector-secrets/` 可读、不可写,里面只有密文,解密钥匙在系统钥匙串里。
    - 文件名的存在性可被测试(P-13),值不可。
    - 非 darwin 平台没有围栏(既有声明不变)。
  - 实现须出示的证据(每条都要能失败,入口是真的):
    - **E1** 真引擎 + 生产渲染的 profile(含 C1)+ 真 ext + 真 addon:三档 × shell `cat` / 读文件工具 × 七个存放点里放的假值(含一个已恢复的官方连接器运行期文件)⇒ 工具结果与模型请求里零命中;shell 再试软链、硬链、大小写变体、覆盖写、删除 ⇒ 全失败,事后在围栏外读盘原样。已知的坏:渲染器去掉 C1 的同一组用例必须红(即 P-07)。
    - **E2** 平台模型请求到达桩,带 `Bearer <假平台凭据>`,而这份值只经启动消息到达、盘上文件对引擎不可读。已知的坏:不发布表(或 ext 读法换回读盘)⇒ 零请求、具名错误(即 P-11)。
    - **E3** BYOK 节点只在表里有非空值时注入,请求带该密钥。已知的坏:去掉配置预处理 ⇒ 请求不带凭据发出。
    - **E4** `codepuppy.jsonc` 里经 `{file:}` 引用连接器令牌的本地 MCP,子进程拿到的值等于假值。已知的坏:去掉预处理 ⇒ 空串 + 引擎 warning。
    - **E5** 续期热应用:平台凭据与云 MCP 令牌换新后,下一次模型请求与云 MCP 请求带新值,重启次数 0。已知的坏:去掉 T2 ⇒ 旧值。
    - **E6** 运行中装一个带密钥的扩展包连接器(不重启),重载后连接器拿到令牌。已知的坏:去掉 T3 ⇒ 空串。
    - **E7** 渲染出的 profile 以 C1 结尾、路径是 userData 的真实路径。已知的坏:用经软链的 userData 不求真实路径渲染 ⇒ P4 那组读写成功。
    - **E8** 带着既有登录与已存密钥的 userData 冷启动(不迁移任何文件):登录态、模型列表、连接器与升级前相同。
    - **E9** 跑完 E1–E6 后,主进程、sidecar、引擎日志里搜假值零命中;同一搜索在桩收到的请求头记录里能命中(证明搜索本身能找到)。

## 8. 拆分决定

不适用:全部在 alpha-code 一个仓、一个负责方。

## 9. 回滚

不适用:没有数据迁移,存放不变。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| D1 引擎进程拿值的方式:主进程经既有窄消息交整表(启动消息 + `credentials` 命令),进程内一张只读表;不在装围栏前读盘 | P-04(运行中必须推送)、P-05(先例)、P-12(测);`a20dadb942` |
| D2 `{file:}` 引用一字不变,只换引擎进程里的解析处:配置预处理只用于显式文件与内联内容,其余读者换成表读法 | P-02、P-03、P-12;§4.1、§4.4 |
| D3 C1 拒读拒写七个存放点(含官方连接器运行期明文目录),放在 profile 最后、按真实路径渲染 | P-06、P-08、P-09、P-10(测) |
| D4 表的内容 = 进表的三个目录(两个 userData 目录 + 官方连接器运行期目录)的全文;主进程只在 T1/T2/T3 三处整表推送,不做增量、删除不推 | P-04 写序;§4.3 |
| D5 失败沿用各读者既有的具名降级;启动消息缺表即拒启动;绝不落回可读文件 | P-03、P-11;§5 |
| D6 在场性也只问表,不依赖 `existsSync` 在 C1 下仍为 true | P-13(测) |
| D7 不拦存在性测试、不动存放位置、不删镜像 | owner「不要设计的过于复杂」;P-13;§6 被否决的替代 |
| D8 引擎库里的 OAuth 令牌不在本设计内,返还为 G2 | P-14、`oauth.ts:289-330` |

| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| (待送审) | | | | |

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| 删掉明文镜像 `codepuppy-secrets/`,主进程直接从环境 / 钥匙串建表 | 盘上少一份明文镜像;收益只在围栏外的同用户进程那一侧 | 结果不需要;改动面大 | 范围扩到围栏外的同用户进程时 |
| `syncSecretFiles` 拒绝已被换成软链的 `codepuppy-secrets` | 升级前若已有会话把目录换成软链,镜像会写到别处;升级后围栏内已无法再这样做 | 只覆盖升级前的历史状态;按「不考虑旧状态」不做 | 出现这样的实例时 |
| INT-safety I-13(引擎配置与全局配置目录在围栏内可写) | C1 不覆盖 | 不在本次授权内 | 由 I-13 自己的授权推进 |
