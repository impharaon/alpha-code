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

## 7. 没做,或仍是推断

- **打包形态没测**:asar、签名公证、hardened runtime 都没测。本实验跑的是 dev 版 Electron 二进制,加一个没打包的 main。基线退出条件 ① 写的是「打包形态」,这部分归 L7。
- ext 插件没装进 2.x;插件装载顺序(S1「最后一个回调」)没测。
- 真库副本的前进迁移和转换(L1b)没做;owner 数据只按文件名和元数据看过。
- 重启续跑的差异(§4)只读了代码。
