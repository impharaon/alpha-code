# OpenCode 2 引擎嵌进 Code Puppy 的 Electron 能不能跑 —— L1a 勘破(合成数据,`#1662`)

> 勘破记录。下面的数字都是 2026-11-09 实跑出来的,不是推断;只靠读代码得出的结论单独标了「读码」。
> 环境:`origin/alpha` = `e56ae0c036`;上游合并目标 `33f94fce96`(= v2.2.6 的代码,基线 §2.1);
> Electron 42.3.3(Node 24.15.0,modules 146,取自本 worktree 的 `packages/ui-mac/node_modules/electron`);
> 上游用 bun 1.4.4 构建(只装在临时目录);macOS arm64。
> 回答的是方案基线 `docs/design/2026-11-08-1662-opencode2-generation-switch-baseline.md`(在 `design/1662-opencode2-baseline` 分支上,
> 尚未进 `alpha`)§2.4 里 H1 的三条退出条件。本 lane 不读 owner 的真库;真库副本那一半(L1b)不在这里。
> 实验脚本:[`docs/verification/2026-11-09-1662-l1/`](../verification/2026-11-09-1662-l1/)。

## 0. 结论:定 H1

| 退出条件 | 结论 | 证据 |
| --- | --- | --- |
| ① 先装好 Code Puppy 的进程围栏,再在 `utilityProcess` 里启动 2.x 引擎,经 `/api/session/:id/prompt` 拿到一条回复 | **满足**。围栏下 0.32 s 启动,回复走的是生产出网代理 | §3 的 armC、armFfence |
| ② 进程内的 fetch 和监听端口用的是**同一张应用图** | **满足,两条路都行**:`start()` 的 `Transform` 钩子,或者 `ServerFetch.make` 加 Code Puppy 自己的监听 | §4 |
| ③ 旧版对话转成新版,在 Node 下有可行的补法 | **满足**。构建时把 `#v1-migration` 指到上游的 bun 实现,加两个 Node 薄适配;合成库 3 个会话、13 条消息全部转换 | §5 |

H1 要成立,L5 必须保留下面三条前提。它们都实测过,而且**去掉任何一条,都有一个实验臂会失败**:

1. **装围栏之后、导入引擎之前,要调用 `http.setGlobalProxyFromEnv()`**(`sidecar.ts:148,267-269` 的 `useEnvProxy`)。
   不调的话,2.x 的模型请求会绕开 `HTTPS_PROXY` 直接连目标:在围栏下 DNS 失败,代理一条记录都收不到(armCraw)。
2. **引擎自己连自己的回环端口会被围栏拒掉**(EPERM,和 `#1531` 是同一种情况)。
   所以 ext 这类在进程内的调用方,只能用 §4 的进程内 fetch。
3. **v1 旧对话的转换,必须用 `#v1-migration` 的构建期改道,外加 `Bun.CryptoHasher` 适配**。上游 node 构建原样不动的话,
   旧会话**一条都看不到**,而且状态接口照样报 `completed`,完全没有提示(e3noop)。
   去掉 `CryptoHasher` 适配,转换会卡在第一个用过改名工具的会话上(e3raw)。

## 1. 怎么复跑

```bash
cd docs/verification/2026-11-09-1662-l1
bash snapshot.sh before          # owner 路径快照,只取元数据
bash build.sh                    # 临时 bun 1.4.4、上游 worktree(33f94fce96)、HUSKY=0 安装、三个 Node 包、围栏装载器
bash v1-seed.sh                  # 用今天的 1.18.35 引擎在临时数据目录里造合成 v1 库
for a in armA armB armC armCraw armF armFfence e3 e3fence e3next e3noop e3raw; do bash run-electron.sh $a; done
bash snapshot.sh after           # 与 before 逐行对比
```

每个实验臂的原始输出都在 `/private/tmp/ac1662-l1/iso-<臂>/out/`:`result.json`(每一步的 HTTP 状态和响应体)、`result.utility.log`、
`stub.log`(模型桩收到的每个请求)、`proxy.log`(生产出网代理的结构化记录)。

## 2. 隔离证明

**引擎和 Electron 写过的路径**(以 armC 为例,`find -maxdepth 4`;每个臂的结构都一样,全部在 `/private/tmp/ac1662-l1/iso-<臂>/` 下面):

| 写入方 | 路径 |
| --- | --- |
| 2.x 引擎 | `xdg/data/opencode/{opencode.db,log,repos,shell,snapshot}`、`xdg/cache/opencode/bin`、`xdg/config/opencode`、`xdg/state/opencode`、`tmp/opencode`、`home/.npm` |
| 围栏计划器(生产代码) | `codepuppy-state/env/dev`、`userData/engine-scratch-cwd`、`fence.sb` |
| Electron main | `electron/session/Local State`(`app.setPath` 把 `userData`/`sessionData`/`logs`/`crashDumps` 都指到了临时目录) |

**owner 路径快照**(`snapshot.sh`,用 `stat` 只取 mtime、大小、权限,不读内容):

- `~/.local/share/opencode`:前后各 3,688 个条目(文件加目录),**逐行一致**。`~/.config/opencode`、`~/.cache/opencode`、`~/.local/state/opencode`
  也一致;全局 `~/.bun` 仍是 1.3.14,没有变;共享 `.git/config` 的 `core.hooksPath` 前后都是 `.githooks`。
- 有两处不同,如实列出:
  - `~/Library/Preferences/com.github.Electron.plist` 的 mtime 变了,大小不变(972 B)。这是 Electron 默认 bundle id 的偏好文件,
    由 cfprefsd 写,不认 `$HOME`。本来可以用 `CFFIXED_USER_HOME` 把它也改道,但那样会连钥匙串的查找路径一起改走,
    正是 11-01 系统框弹到 owner 屏幕那次的情形,所以**故意没用**。这个文件 11-05 就被别的 lane 写过,里面不是 owner 的数据。
  - `~/Library/Keychains/login.keychain-db` 的 mtime 在 00:25:34 变了,大小不变。统一日志显示,00:25:32 有一个 `security` CLI
    进程依次调了 `SecKeychainItemCopyContent`,然后是一次 `SecKeychainItemModifyContent`,前后有几个 `git` 进程。
    那一刻本 lane 唯一在跑的是 `bun install`(它在 00:20:00 就拉完了唯一一个 github 依赖)。14 次 Electron 运行(00:36–00:51)
    之后,mtime 没有再动过。日志里没找到父进程,**无法 100% 排除是本 lane**;读码判断,更像是机器上别的 agent 在刷新凭证。
    没有出现系统框:每次检查 `SecurityAgent` 都不在。

**钥匙串防护**(没有一步走 Code Puppy 的凭证读取路径:没跑 ui-mac 主进程,也没调 `injectCodePuppyConfig`):

- Electron 以 `--use-mock-keychain` 启动。`main.mjs` 的守卫在缺这个开关、或者 `HOME`/`XDG_*` 不在临时目录下时,直接退出(退出码 3)。
  用两种已知会出问题的启动方式实测,两次都被拒:`REFUSING TO RUN: --use-mock-keychain missing` 和
  `REFUSING TO RUN: HOME=/Users/tide is outside /private/tmp/ac1662-l1`。被拒后 `~/Library/Application Support/ac1662-l1-probe` 不存在。
- 不建 BrowserWindow,不用 `session`/`net`/`safeStorage`。
- `git grep -i -E "keychain|keytar|find-generic-password|SecItem|safeStorage"`:上游 `33f94fce96` 的 core/server/cli/protocol/schema/util 零命中;
  本树的 `packages/opencode/src`、`packages/core/src` 只命中一条风险分类正则。

## 3. E1:围栏下起引擎并完成一条回复

**引擎包怎么来的**:用上游自己的 Node 构建配置(`packages/cli/vite.node.config.ts` 的 `mainConfig`:同一套插件、`node` 解析条件、
node 前导代码、原生资源)。只改了四处:入口换成 `embed-entry.ts`,它按上游 CLI(`cli/src/server-process.ts`)的同一层栈调
`@opencode/server/process` 的 `start()`;`target: node24`;不压缩;去掉只对 CLI 成立的 simulation 图检查。
产物 `embed.mjs` 23.5 MB。它在 Electron 的 Node 24.15 里运行,**没加** `--experimental-ffi`/`--use-system-ca`。
armC 的 398 行 utility 日志里没有一行 WARN 或 ERROR。

utilityProcess 里的顺序和 `sidecar.ts:137-149` 一样:先 `applyProcessFence`(Code Puppy 的 `process-fence-apply.ts` 原样打包,
profile 由生产代码 `planProcessFence` 渲染,并经真 `sandbox-exec` 试编译;原生模块用本树的 `codepuppy_fence.node`),
再 `setGlobalProxyFromEnv()`,最后才 `import` 引擎。模型端是本机桩(`model-stub.mjs`,OpenAI 兼容,只回固定文本),没有发过一次真实模型请求。

| 臂 | 围栏 | 模型桩怎么连 | 结果(原始输出) |
| --- | --- | --- | --- |
| armA | 无 | `http://127.0.0.1:<桩>` | 启动 1.0 s(冷)/0.33 s;回复 `ac1662-stub-reply: hello from the loopback stub`;桩收到 1 个请求 |
| armB | 有 | 同上(在 `NO_PROXY` 里,直连) | 启动 0.32 s,`/api/info` 200;回复**没有出来**:`retry.error = {"type":"provider.transport","message":"connect EPERM 127.0.0.1:47760"}`;桩收到 0 个请求。说明围栏挡住了回环,不是引擎的问题 |
| armC | 有 | `https://ac1662-stub.invalid/v1` 走生产出网代理;代理注入两个测试接缝:`authorize` 只放行这一个目标,`dial` 把它接到桩上;证书是临时自签,经 `NODE_EXTRA_CA_CERTS` 信任 | **有回复**;`proxy.log`:`CONNECT ac1662-stub.invalid:443 verdict=allow status=200`,隧道 `bytesUp=28888 bytesDown=2853`;没登记的 `ac1662-egress-probe.invalid:443` 被 `deny unregistered 403` |
| armCraw | 有 | 和 armC 一样,只是**不调** `setGlobalProxyFromEnv()` | 没有回复:`getaddrinfo ENOTFOUND ac1662-stub.invalid`;`proxy.log` 0 行,桩 0 个请求 |
| armF / armFfence | 无 / 有 | 和 armA / armC 一样,引擎换成 §4 的路线 2 | 都有回复;armFfence 的代理 allow 1 次 |

围栏确实生效了:`applyProcessFence` 返回 `buildId=fence-20261109T050911332Z libsandbox=/usr/lib/libsandbox.1.dylib profileBytes=2123`;
它自己的双向自证通过(集合外写不进,cwd 写得进);进程内自连 `/api/info` 得到 `fetch failed; cause=EPERM`。

## 4. E2:同一张应用图

**判别方法**:2.x 的 `GET /api/event` 订阅的是**每张图各自一份的内存事件总线**(`server/src/event-feed.ts` 订阅 `Bus`;
`core/src/bus.ts:194-205` 每次建层都新建一个 PubSub),不从库里回放。所以做法是:main 经 HTTP 订阅监听端口上的事件流,
然后在 utility 里用候选的进程内 fetch 建一个会话,看监听端口上有没有收到这次的 `session.created`。
反向对照组是**另建一张图**(`ServerFetch.make`,用同一个库)。如果用「HTTP 能不能查到这个会话」来判,另一张图也能查到,区分不了两者。

| 路线 | 进程内创建,监听端口收到事件 | 另一张图创建,监听端口收到事件 | 另一张图建的会话经 HTTP 查 | HTTP 创建,进程内查 |
| --- | --- | --- | --- | --- |
| 路线 1:`start()` + `Transform`(钩子拿到的是监听端口的 dispatch app,再经 `HttpEffect.toWebHandler` 转成 fetch) | **true** | false | 200 | 200 |
| 路线 2:`ServerFetch.make` 只建一张图,Code Puppy 自己用 `node:http` 在它前面监听,进程内直接调同一个 handler | **true** | false | 200 | 200 |

两条路线在有围栏时都实测过(armC、armFfence),结果和上表一样。

**两条路线的差异**:

- **Schedule runner**:实测过。建一个 5 秒后触发的一次性计划,等 25 秒。路线 1:`status=done runCount=1`,桩多收到 1 个请求。
  路线 2:`status=active runCount=0`,`nextDueAt` 已经过了,桩没有收到新请求。依赖它的功能是计划任务,
  也就是 `/api/experimental/schedule*` 和给模型用的计划工具(`core/src/tool/plugin/schedule.ts`):在路线 2 下能建,但永远不会触发。
  它受 `experimental.schedules` 开关控制,默认开关只在 `app.channel` 为 `local`/`dev` 时打开(读码:`core/src/flag.ts:26,70`)。
  本实验传的是 `local`,所以这里是开的。Code Puppy 今天没有这个功能。
- **重启续跑**(读码,未实测):`ServerFetch.make` 每次启动都会续跑未释放的会话(`fetch.ts:50`)。
  `start()` 只在传了 `lifecycle` 时才续跑(`process.ts:113-114`),而路线 1 按 CLI 默认模式**不传**。
- **其它**(读码):路线 1 带启动期状态(启动中 `/api/info` 返回 503 加 `retry-after`)、压缩和错误日志中间件;
  路线 2 要 Code Puppy 自己写监听适配,本实验写了 27 行(`electron/utility.mjs` 的 `serveFetchOnly`)。

## 5. E3:v1 旧对话在 Node 下转换

**合成库**:`v1-seed.sh` 用本树的 `packages/opencode`(1.18.35 加 Code Puppy 迁移,bun 直接跑源码)在临时数据目录里建 3 个会话、每个两轮。
会话 3 的第一轮,桩会回一次 `bash` 工具调用(`echo`,在临时工作区里执行)。得到的库:`session=3 message=13 part=27`,
有一个 `tool part|bash|completed`;`migration` 表 40 行,包含 alpha 独有的 `20260720085655_permission-decision-receipt` 和
`20260720094009_permission-request-admission`;**没有** `__drizzle_migrations` 表。

**补法**(`build-embed.ts --v1-migration`,上游源码一个字不动):在 vite 的 `resolveId` 里把 `#v1-migration` 指到
`core/src/database/v1-migration.bun.ts`,`bun:sqlite` 指到 `shims/bun-sqlite.ts`(26 行,基于 `node:sqlite`);
再用 transform 把 `:1170` 的 `new Bun.CryptoHasher("sha256")` 换成 `node:crypto` 的 `createHash("sha256")`。
transform 找不到原调用,或者文件里又出现别的 `Bun.` 调用时,构建直接失败。

| 臂 | 引擎包 | 转换后的状态接口 | v1 表(前 → 后) | 转换结果 | 列表接口能看到的会话 |
| --- | --- | --- | --- | --- | --- |
| e3 | `embed-v1mig.mjs` | `running 0/3` → `completed` | 3/13/27 → 3/13/27 | `session_v2=3`;`session_message` user 6、assistant 7、system 1 | 3 个,每个的消息数分别是 6/4/4 |
| e3fence | 同上,有围栏 | 同上 | 同上 | 同上 | 同上 |
| e3next | 同上,数据目录里另放一个不是 v2 格式的 `opencode-next.db` | 同上 | 同上 | 同上;日志有 `Skipped incompatible opencode-next.db`,说明 `bun:sqlite` 适配被调用了 | 同上 |
| e3noop(对照组) | 上游原样的 node 构建(`#v1-migration` → noop) | 直接报 `completed` | 不变 | `session_v2=0` | **0 个** |
| e3raw(对照组) | bun 实现,但**不做** `CryptoHasher` 适配 | `error: Bun is not defined` | 不变 | `session_v2=2`;游标停在会话 2;会话 3(带工具调用的那个)和它后面的都没转换 | 2 个 |

转换后的消息条数对照:v1 一共 13 条,v2 一共 14 条,多出的是会话 3 末尾一条 `system` 提示:
`The available tools have changed. The `bash` tool is now `shell` and must be called by that name.`
内容逐条保留了用户原文和助手的回复文本,工具调用保留了输入和输出(`echo ac1662-tool-ran` → `ac1662-tool-ran\n`)。
2.x 自己的 schema 迁移只补了缺的 21 条(`migration` 表 40 → 61 行);alpha 独有的两条迁移记录和 `permission_decision`/`permission_request` 两张表都还在,没有报错。

## 6. 方案基线要订正或补上的事实

| # | 基线原文 | 实测 / 读码 | 坐标 |
| --- | --- | --- | --- |
| 1 | §1.4「转换时把工具改名:`bash`→`shell`、`task`→`subagent`、`apply_patch`→`patch`」 | **历史里不改名**。转换后的工具项仍是 `"name":"bash"`,`RENAMED_TOOLS` 只用来在会话末尾加一条给模型看的 `system` 提示。所以 UI 工具卡、身份账本要**同时认新旧两个名字**,不是只换一个(K5) | `v1-migration.bun.ts:996,1005-1030`;e3 库里会话 3 的消息 |
| 2 | §1.4 / §9「旧的无名 `__drizzle_migrations` 表里有对不上已知迁移的时间戳 ⇒ 直接 die」 | 今天的 1.18.35 建出来的库**没有**这张表,用的是 `migration` 表。2.x 遇到它只补缺的那几条,不认识的 id(alpha 的两条)就留着,不会 die。只有 `migration` 为空、而且有无名旧表的库才会走到 die 分支。真库属于哪一种,要 L1b 去查 | `core/src/database/migration.ts:55-104`;e3 `migration` 40 → 61 |
| 3 | §2.8「`:808` 动态 import `bun:sqlite`」需要 Node 适配 | 这个分支**只在** `<data>/opencode-next.db` 存在时才执行。owner 数据目录按文件名列出来,没有这个文件(只看了名字,没读内容),而现在唯一的用户就是 owner 本机。适配已经写好并测过(e3next),但对现有用户来说这条路走不到 | `v1-migration.bun.ts:799-830` |
| 4 | §2.8 只说两处 bun 专有调用要适配 | 补一条:`:1170` 只有在会话里用过被改名/改参数/删掉的工具,或者用户消息带 synthetic 部分时才会执行。合成库要是只有纯文本,这个适配根本不会被调用,缺了也测不出来(本 lane 第一版种子就是这样)。缺了它,迁移会卡在那个会话上,并且停止转换后面的所有会话 | `v1-migration.bun.ts:371,455`;e3raw |
| 5 | §1.3「`#v1-migration` 的 node 分支是空实现」 | 补充用户能看到的后果:状态接口 `/api/experimental/migration/v1` 照样报 `completed`,UI 拿不到任何「旧对话没接上」的信号 | e3noop |
| 6 | §2.4 H1 的代价一栏没写出网前提 | 补一条:2.x 的模型请求只有在 `http.setGlobalProxyFromEnv()` 之后才走 `HTTPS_PROXY`。L5 换引擎时必须保留 `sidecar.ts:148` 这一步,而且要在 import 引擎之前 | armC 对比 armCraw |
| 7 | §2.7 配置一节没提构建渠道 | `start()` 的 `app.channel` 是 `local`/`dev` 时,`todo`/`schedules`/`media_blob`/`artifacts`/`background_compaction` 这几个实验开关默认打开。Code Puppy 必须传发布渠道,或者显式关掉 | `core/src/flag.ts:26,70`;`schema/src/config/flag.ts:6-17` |
| 8 | §1.3 说 2.x 的 Node 目标是 26.4 + `--experimental-ffi` | 实测:用上游配置、把 target 改成 node24 构建,在 Electron 的 Node 24.15 里不带这两个参数也能跑 E1–E3,日志里没有 WARN 或 ERROR。基线 §9 第一条「没跑」可以划掉 | §3 |
| 9 | §2.8 第 1 条「第一次以 2.x 启动时,DB 安全带看到 21 条待前进迁移,先做 `opencode-backup-*` 备份」 | **在真库副本上不成立**:库是 WAL 模式,干净关闭后没有 `-wal`/`-shm`,`db-safety` 的只读读法返回 exit 14,判定变成 `skip`,开机备份同样失败;既不拦截也不备份。判定逻辑本身(期望里含 alpha 两条)是对的 | §9.2;`db-safety.ts:58-79`、`db-safety-boot.ts:74-87` |

## 7. 没做,或仍是推断

- **打包形态没测**:asar、签名公证、hardened runtime 都没测。本实验跑的是 dev 版 Electron 二进制,加一个没打包的 main。基线退出条件 ① 写的是「打包形态」,这部分归 L7。
- ext 插件没装进 2.x;插件装载顺序(S1「最后一个回调」)没测。
- 真库副本的前进迁移和转换(L1b)没做;owner 数据只按文件名和元数据看过。
- 重启续跑的差异(§4)只读了代码。

## 8. L1b 做法:在 owner 真库的只读副本上实测(本轮只交做法,没有复制、没有打开 owner 的任何数据文件)

下一轮要回答三件事:①真库用的是哪种迁移记账,各有多少行,有没有 alpha 那两条 id;②用 §3 的 node24 上游构建对副本做前进迁移和 v1 转换,
会话数、消息数前后对照;③用 Code Puppy 的 `db-safety`(`decidePlan` 一族)判副本,分别用「2.x 支持面」和「2.x 支持面 + alpha 两条退役 id」两种期望。
本节每一步都**先在合成库上跑过**(`l1b-copy-proof.sh`、`l1b-copy-dryrun.sh`、`run-electron.sh l1b`),下面写的是实测结果。

### 8.1 要复制的源文件

2026-11-09 01:10 用 `ls -la ~/.local/share/opencode/` 只看了文件名、大小和时间:

| 文件 | 大小 | mtime | 处置 |
| --- | --- | --- | --- |
| `opencode.db` | 21,921,792 B | 11-06 04:01 | 复制(打包版 Code Puppy 的库就是这个:`db-safety.ts:46-50` `resolveDbPath`) |
| `opencode.db-wal` | 当时不存在 | — | 复制那一刻如果存在,一起复制(里面有还没写回主库的提交) |
| `opencode.db-shm` | 当时不存在 | — | **不复制**。它只是共享内存索引,SQLite 打开副本时会从 `-wal` 重建 |

不复制:同目录下其它 `opencode-<分支名>.db`(dev 和各 lane 的库,不是 Code Puppy 正式版的)、`mcp-auth.json`、`auth.json`(当时也不存在)。

### 8.2 复制方式:只用 `cp` 读源文件

`l1b-copy-proof.sh` 在合成 WAL 库上实测了四种做法,源库分两种状态。「安静」是干净关闭、没有 `-wal`/`-shm`,和 owner 现在的状态一样;
「在写」是另一个进程开着库,`-wal` 里有还没写回主库的行。「源库不变」的判法是三个文件的大小和纳秒级 mtime 前后一致:

| 做法 | 安静:能不能复制 | 安静:源库不变 | 在写:副本完整(应为 1500 行) | 在写:源库不变 |
| --- | --- | --- | --- | --- |
| **`cp opencode.db [opencode.db-wal]`** | 能 | 是 | **1500** | 是 |
| `sqlite3 -readonly … "VACUUM INTO"`(Code Puppy 自己的备份写法) | **失败**:`unable to open database file (14)` | 是 | 1500 | 是 |
| `sqlite3 'file:…?mode=ro' .backup` | **失败**:同上 | 是 | 1500 | 是 |
| `sqlite3 'file:…?mode=ro&immutable=1' .backup` | 能 | 是 | **1000,少了 `-wal` 里的提交** | 是 |

结论是用 `cp`:它不经 SQLite 打开源库,不加锁,不写任何东西,两种状态下都完整。只读打开的两种做法在 owner 现在的状态下根本打不开;
`immutable=1` 在应用正在写时会漏数据。

`l1b-copy.sh` 的步骤:

1. 目标必须在 `/private/tmp` 下,而且不能已经存在,建成 0700,建完核一次权限。
2. 看 owner 应用,只查进程表:`pgrep -f "/Applications/Code Puppy.app/Contents/MacOS/Code Puppy"`,外加 `lsof -t -- <源库>`。
   lsof 只读内核的文件表,不打开源库。dry run 证明它能查到占用者:在写那一档报出了写进程的 PID。
3. 复制前后各记一次源库的指纹(主库和 `-wal` 的大小加纳秒 mtime),然后 `cp` 主库,有 `-wal` 就一起 `cp`。
   前后指纹一致才算这次复制成功;不一致就等 2 秒重试,最多 5 次。5 次都不一致就报 `BLOCKED`,让下一轮另找时间,**不碰 owner 的应用**。
4. 复制出来的文件 chmod 600,放在 `pristine/`,**之后谁都不打开它**。要读就从它克隆一份到 `work/` 或实验目录,每次读都有自己的克隆:
   SQLite 打开一个文件就会改变它的文件组成(比如生成 `-wal`/`-shm`),一改,db-safety 的生产读法就测不准了(见 8.6)。

**Code Puppy 正式版正在运行时怎么办**:照样走上面的流程。`cp` 不拿 SQLite 的锁,不会挡住应用,也不会被应用挡住。
应用要是正在写,指纹比对会让这次复制作废并重试;重试成功之后,副本还要在 `work/` 克隆上过 `PRAGMA integrity_check`,结果必须是 `ok`。
不要求 owner 关应用,也不替他关;5 次都不稳定,就停下改天再来。

两种状态的 dry run(`l1b-copy-dryrun.sh`,合成源库按 owner 的目录结构摆放):两次都是第一次就稳定、`integrity_check: ok`、源库指纹不变;
在写那一档的副本里有写进程新建的表,说明 `-wal` 里的内容一起进来了。

### 8.3 副本放在哪,怎么输出,怎么删

- 根目录 `/private/tmp/ac1662-l1b/`,权限 0700(`l1b-copy.sh` 自己建,也自己核)。下面有 `pristine/`(不打开)、`work/`(数数用的克隆),
  以及引擎实验目录 `iso-l1b/`(`ISO_BASE=/private/tmp/ac1662-l1b bash run-electron.sh l1b`;脚本发现 `ISO_BASE` 不对就拒绝运行)。
- 只输出计数和表名:`l1b-counts.sh` 只打印 journal_mode、integrity_check、表名、两种记账表的行数和 alpha 两条 id 在不在、各表行数、
  `session_message` 按类型的计数,不打印任何一行内容;路径不在 `/private/tmp` 下就拒绝运行。
  `run-electron.sh l1b` 打开只计数模式:不写会话标题,不取消息样本,utility 日志只留行数和 WARN/ERROR 的条数,不落盘原文。
  在合成副本上验证过:用已知的合成标题、用户原文和工具输出去 grep 只计数模式的全部输出文件,命中 0 个;同样的 grep 在普通 e3 臂上命中 1 个(对照组)。
- 做完删掉:`rm -rf /private/tmp/ac1662-l1b`(写死的路径)。

### 8.4 前后快照

沿用 `snapshot.sh`(只用 stat):复制前 `bash snapshot.sh l1b-before`,复制后**马上**、在启动 Electron 之前 `bash snapshot.sh l1b-after-copy l1b-before`。
判定标准:`~/.local/share/opencode` 那一节(今天是 3,688 个条目)必须逐行一致。
快照里另外两行会因为别人变化,要单独说明来源:`login.keychain-db` 会被机器上别的 agent 改(§2);`com.github.Electron.plist` 只在 Electron 跑过之后才会变。

### 8.5 可能碰到钥匙串或 owner 应用的地方,以及怎么避开

| 步骤 | 碰到什么 | 怎么避开 |
| --- | --- | --- |
| `cp` 源文件 | 只读源文件 | 不经 SQLite,不加锁;源文件不会出现新的 `-wal`/`-shm` |
| `pgrep` / `lsof` | 只读进程表和内核文件表 | 不连接、不发信号给 owner 的应用 |
| 2.x 引擎跑在副本上(Electron) | Chromium 的 OSCrypt 会读钥匙串 | 和 §2 一样:必须带 `--use-mock-keychain`,`HOME`/`XDG_*` 必须在临时目录下,否则守卫拒绝运行;不建窗口,不用 `session`/`net`/`safeStorage`;不设 `CFFIXED_USER_HOME` |
| 2.x 迁移 `20260805200742_import_legacy_credentials` | 会读 `<data>/auth.json` | 实验数据目录里没有这个文件(不复制,源目录里本来也没有),所以导入不到任何东西 |
| db-safety 判定 | 调用 `/usr/bin/sqlite3` | 只对 `/private/tmp` 下的克隆调用(`l1b-db-safety.ts` 和 `l1b-counts.sh` 都会拒绝别的路径) |
| Code Puppy 正式版 | — | 不启动、不关闭、不替换 `/Applications/Code Puppy.app`;不跑 ui-mac 主进程,所以不走 Code Puppy 的凭证读取路径 |

### 8.6 下一轮的命令顺序,和一个已经在合成库上测出来的问题

```bash
cd docs/verification/2026-11-09-1662-l1
bash snapshot.sh l1b-before
bash l1b-copy.sh                                            # 回答①:记账表、行数、alpha 两条 id、会话/消息/部件计数
bash snapshot.sh l1b-after-copy l1b-before                  # 只看 ~/.local/share/opencode 那一节
/private/tmp/ac1662-l1/bun-1.4.4/bin/bun l1b-db-safety.ts /private/tmp/ac1662-l1b/pristine/opencode.db /private/tmp/ac1662-l1/oc2 /private/tmp/ac1662-l1b/backups   # 回答③
ISO_BASE=/private/tmp/ac1662-l1b bash run-electron.sh l1b   # 回答②:迁移、转换,以及转换后的计数
rm -rf /private/tmp/ac1662-l1b
```

`l1b-db-safety.ts` 会报两种读法,而这两种读法在合成库上给出的答案**不一样**:

- **逻辑读**:用可写的克隆读出 id,再交给 `decidePlan`。合成库(40 条 id,含 alpha 两条)的结果:期望 A 得到 `db-ahead`,unknown 正好是 alpha 那两条 id;
  期望 B 得到 `migrate-ahead`,pending 21 条;备份成功。这正是审计 F1 预期的结果。
- **生产读**:和 `db-safety-boot.ts:74-80` 完全一样,对一个按源库结构摆放(只有 `.db`)的克隆跑 `sqlite3 -readonly … "SELECT id FROM migration"`。
  结果是 `exit=14 unable to open database file`,期望 A 和 B **都得到 `skip`**(「水位读取失败,fail-open」);
  照开机流程做的那次备份也失败了(`VACUUM INTO 失败:exit=14`)。

原因:引擎把库设成了 WAL 模式(`packages/core/src/database/database.ts:27`)。干净关闭之后,`-wal`/`-shm` 被删掉,而只读连接打不开没有这两个文件的 WAL 库。
owner 现在的库正是这个状态。所以很可能出现的情况是:每次在干净关闭之后启动,db-safety 都静默跳过,升级到 2.x 那一次既不拦截、也不备份。
`db-safety.test.ts` 里用真 sqlite 跑的用例(`itSql`)建的都是非 WAL 库,所以这个情况一直没被覆盖。
**这条目前只在合成库上实测过**;真库是不是 WAL、生产读会不会同样返回 14,下一轮的 `l1b-counts.sh`(journal_mode)和 `l1b-db-safety.ts`(production 一栏)会直接给出答案。

## 9. L1b 结果:在 owner 真库的只读副本上实测(2026-11-09 01:13–01:17)

按 §8.6 原样执行。整个过程只输出计数、表名和迁移 id,没有打印任何会话标题、正文或消息内容。原始输出:
`/private/tmp/ac1662-l1/l1b-copy.out`、`l1b-db-safety.out`、`l1b-run.out`(都只有计数)。

### 9.1 ① 真库的形态

复制时的状态:Code Puppy 没在运行,没有进程占用这个库;源目录里只有 `opencode.db`(21,921,792 B),没有 `-wal`/`-shm`;第一次复制就稳定。

| 项 | 实测 |
| --- | --- |
| journal_mode | **wal** |
| integrity_check | ok |
| 迁移记账 | **`migration` 表,40 行**;没有 `__drizzle_migrations` |
| alpha 那两条 id | **两条都在**(`20260720085655_permission-decision-receipt`、`20260720094009_permission-request-admission`;最新一条就是后者) |
| v1 计数 | `session` 119、`message` 597(user 198、assistant 399)、`part` 1,765 |
| 其它 | `session_message` 35(都是 `model-switched`)、`project` 2、`permission_decision` 0、`permission_request` 0;没有 `session_v2` |

### 9.2 ② db-safety 判定:只读打开失败在真库上复现了

| 读法 | 读到的结果 | 期望 A(2.x 支持面,59 条) | 期望 B(A + alpha 两条) | 备份 |
| --- | --- | --- | --- | --- |
| 生产读(`db-safety-boot.ts:74-80` 原样调用,克隆和源库一样只有 `.db`) | `exit=14 unable to open database file` | **`skip`**(fail-open) | **`skip`**(fail-open) | 照开机流程备份:**失败**,`VACUUM INTO … exit=14` |
| 可写克隆 | 40 条 id | `db-ahead`,unknown 就是 alpha 那两条 | `migrate-ahead`,pending 21 条 | 成功,21,553,152 B,`integrity_check` 通过 |

**结论**:审计 F1 预期的判定逻辑在真库的 id 上成立。但在 owner 现在的状态下(干净关闭的 WAL 库),生产路径**连判定都走不到**:
升级到 2.x 那次启动,db-safety 会静默跳过,既不拦截,也不做迁移前备份。
另外,L2 生成的 `db-expected-migrations.json` 如果只列 2.x 的 59 条,读法一旦修好,启动就会被 `db-ahead` 拦住。所以 alpha 两条退役 id 要一起列进去(期望 B)。

### 9.3 ③ node24 上游构建对副本做前进迁移和 v1 转换

`ISO_BASE=/private/tmp/ac1662-l1b bash run-electron.sh l1b`:Electron 42.3.3 utilityProcess,没有围栏,用 `embed-v1mig.mjs`。

- **启动**:0.35 s;转换状态从 `running 4/119` 变成 `completed`(轮询 2 次,整个臂跑完约 20 s);utility 日志 55 行,**WARN 0、ERROR 0**;没出现 `SecurityAgent`。
- **schema 迁移**:`migration` 从 40 行变成 61 行(补了 2.x 缺的 21 条);alpha 两条 id 和 `permission_decision`/`permission_request` 两张表都还在;`integrity_check` ok。
- **会话、消息前后对照**(以数据库计数为准):

| | v1(转换前) | v2(转换后) |
| --- | --- | --- |
| 会话 | 119 | `session_v2` **119** |
| 有消息的会话 | 118 | 118 |
| 消息 | 597(user 198、assistant 399) | `session_message` **662**:user 196、assistant 399、synthetic 27、system 40 |
| v1 原表 | — | 不变:119 / 597 / 1,765 |

- **逐会话核对**:118 个有消息的会话里,116 个会话的「v2 user + assistant 条数」和 v1 消息条数相同。另外 2 个会话各有一条 v1 用户消息,
  里面全是 synthetic 文本(全库正好 2 条),转换后成了 `synthetic` 行,不是 `user` 行。所以 v1 user 198 = v2 user 196 + 2,**没有消息丢失**。
  `system` 40 条是给 40 个会话各加的一条「工具已改名」提示(§6 第 1 条);`project` 从 2 变成 4,是转换时为非 git 目录下的会话找到了归属项目。
- HTTP 列表接口只回了 100 个会话,因为请求里写了 `limit=100`,不是丢了会话;以数据库计数为准。
- **偏离(必要的脚本修正)**:转换会对每个没有归属项目的会话目录做 stat。副本里有 4 个会话(1 个不同目录)位于 macOS 隐私保护的文件夹下(`~/Documents`),
  在那里 stat 可能让系统权限框弹到 owner 屏幕上。所以 `run-electron.sh l1b` 在**实验克隆**里把这 4 行的 `directory` 改成一个不存在的临时路径
  (只打印行数,不打印路径)。影响:这 4 个会话留在 global 项目下,没有被解析到归属项目;会话数和消息数不受影响。`pristine/` 副本没有改动。

### 9.4 ④ 快照与删除证明

- `snapshot.sh l1b-before` 对比 `l1b-after-copy`:**SNAPSHOT IDENTICAL**,3,724 行全部一致,其中 `~/.local/share/opencode` 3,688 个条目。
- 引擎跑完后再拍 `l1b-after-run` 对比 `l1b-before`:`~/.local/share/opencode` 一节仍然一致;唯一不同的是 `com.github.Electron.plist` 的 mtime,
  这是 Electron 跑过之后的已知变化(§2)。`login.keychain-db` 没有变。
- 删除:`du -sh` 显示 84M,`rm -rf /private/tmp/ac1662-l1b` 退出码 0,之后 `ls -la /private/tmp/ac1662-l1b` 输出
  `No such file or directory`。`/private/tmp` 下名字以 `ac1662-l1b` 开头的只剩 `ac1662-l1b-proof`,里面全是合成数据。
