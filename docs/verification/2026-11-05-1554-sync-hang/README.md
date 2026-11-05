---
title: alpha-code#1554 第一步:「正在同步」的 dev 复现夹具与 netlog 判定工具
kind: verification
status: active
owners:
  - alpha-code desktop maintainers
last_reviewed: 2026-11-05
---

# alpha-code#1554 第一步:dev 复现夹具、H1 三前提、netlog 判定工具

票面 AC1、AC4 的 dev 侧证据,以及 AC2、AC3 打包版取样要用的工具。这一轮没有碰 `/Applications/Code Puppy.app`,
没有读 owner 的数据,没有发模型调用。这里只记数据,不下 H1 / H2 的总结论,那要打包版样本。

## 结果

| 项 | 结果 |
| --- | --- |
| AC1 夹具,当前主线 `2d94951af`(0.1.25) | **不复现**:配了 MCP 的 9 轮 0 次超过 10 秒,模型读取 6–24 ms,MCP 收到连接但不应答(状态 `pending`,握手超时后 `failed` 并后台重连)。按票面规则,这棵树上这个夹具不能用来判「修前红」 |
| AC1 夹具,#1563 之前 `380b9a9e8`(0.1.22 之后、0.1.23 之前) | **稳定复现**:3 轮 3 次,模型读取 42.0–42.1 秒,`probeTimeouts` 41–42,与 owner 现场样本(`probes=42 probeTimeouts=41`)同形。同一棵树去掉 MCP:2 轮 0 次,6–9 ms |
| AC4 同源 6 连接上限 | **成立** |
| AC4 SSE 流计入 | **成立**,产品实测 3 条事件流,含上游会话同步那条 |
| AC4 排队请求取消后重发落到队尾 | **成立**,另测出一条票面没写的:被取消请求的预检不会撤销,还留在队里 |
| 实际运行的 Chromium | `process.versions.chrome` = **148.0.7778.218**,Electron 42.3.3,与票面相同 |
| netlog 判定脚本 | 在故意造的样本上判对 13/13;期望对调时会红 |

读这张表要带着两句话:

- **夹具没瞎。** 同一个驱动、同一个判据,在 #1563 之前的树上 3/3 红,所以当前主线的 0/9 是这棵树的结果,不是夹具测不出来。
- **机制没消失,只是这条触发路径没了。** 6 连接上限和探针排队都还在,当前主线上 `/command` 不再等 MCP,所以这个夹具喂不饱连接池。
  还有没有别的东西能喂饱,这个夹具回答不了(见下面的「冷启动窗口」和「没覆盖的」)。

## AC4:H1 三个前提

两层证据。合成层用真实 Electron 二进制和本进程 Node 服务,到没到以服务端为准,不依赖 Chromium 自报
([`fixture/h1-premises.main.cjs`](fixture/h1-premises.main.cjs),[`results/h1-premises.json`](results/h1-premises.json))。
页面在 `oc://renderer`,目标 `http://127.0.0.1:<port>`,与产品相同;每项分无预检和带 `Authorization`(有预检,产品的形状)两种,结果一致。
产品层是 dev 实例里的真实引擎 origin([`results/ac1`](results/ac1))。

| 前提 | 结论 | 合成层 | 产品层 |
| --- | --- | --- | --- |
| 对照:量具能看见 6 条以上吗 | 能 | 12 个请求打 12 个 origin,12 个全到 | — |
| 同源 6 连接上限 | 成立 | 发 12 个不答请求,到 6 个,TCP 6 条;放开 1 个到第 7 个;全放开 12 个都到,TCP 仍 6 条 | netlog 同时占连接峰值恒为 6;超出后记 `SOCKET_POOL_STALLED_MAX_SOCKETS_PER_GROUP`,组 `pm/http://127.0.0.1:<port>` |
| SSE 流计入 | 成立 | K=0…6 条进行中的流,不答请求到达数恰为 6−K;K=6 时本该立刻答的请求 3 秒不答,关一条流后 27–30 ms 答;K=5 对照 26–28 ms 答 | 在真实实例里再开 `/global/event`:产品已有 3 条时再开 3 条就排队,此时 `/global/health` 3 秒不答 |
| 取消重发落到队尾 | 成立 | FIFO 对照:A、B、C 按序到。A 取消后重发 A2:3 轮都是 B、C、A2。屏障形状(1 秒 abort 换新请求):前 8 个探针一个没到,排在前面的 3 条全到之后才到 | #1563 之前的树上,探针 42–43 条全部 `waiting-socket:pool-stalled`;最后一条 `/command` 结束后 0–3 ms 探针放行(owner 现场样本是 19 / 25 ms) |

**连接计数,含上游那条。** 每条 `/global/event` 的调用栈经 sourcemap 映回源文件([`fixture/attribute-streams.mjs`](fixture/attribute-streams.mjs),结果在各轮 `*.streams.attr.json`):

| 开流的代码 | 条数 |
| --- | --- |
| `packages/ui-mac/src/renderer/sidebar/use-projects.ts:608` | 1 |
| `packages/ui-mac/src/renderer/codepuppy-ui/cloud-run-watcher.tsx:60` | 1 |
| `packages/app/src/context/server-sdk.tsx:281`(上游会话同步) | 1 |

合计 3 条,占 6 条名额中的一半。部分轮次在测量那一刻上游那条还没重连,此时是 2 条,能再开 4 条,加起来仍是 6。
`use-extensions.ts` 那条只在打开定制中心后才有,这几轮没打开,所以不在内。
引擎日志的 `global event connected` 每代数到 4,比这里多 1 条,那条是 main 的 chat-archive,走 undici,不占 renderer 的名额。

**预检不撤销**(票面没问,但会影响判定)。`fetch` 被 abort 后,还在排队的 CORS 预检不会跟着撤销。合成层 3 轮都看到
`OPTIONS:A` 在 A 被取消之后照样到达服务端;产品层复现的 3 轮每轮 49–50 条这样的预检,最长滞留 42 秒。它们答得快,不长期占连接,
但每次重试都往队里多塞一条。判定脚本因此按主请求结束的时刻截断预检,这段滞留另列 `orphanPreflightMs`,否则 1 秒的探针会被算成「等了 5 秒、答了」。

## AC1:复现夹具

### 夹具协议

驱动是 [`fixture/run-dev-repro.mjs`](fixture/run-dev-repro.mjs),每轮一个隔离实例:

1. 冷启动,等第一个输入框。
2. 开 N 个目录,每个目录一条草稿(新对话 → chip →「打开项目…」)。这时还没配 MCP。
3. 经产品自己的 IPC 写一条远程 MCP 记录,换一代引擎。
4. 点新对话,量模型读取。判据不放宽:有输入框的模型读取超过 10 秒未返回,算这一轮复现。

MCP 是本机 LAN 地址上的只收不回的监听(`https://<lan-ip>:<port>/mcp`),连接数和收到的字节数都记录,
TLS 的 ClientHello 到了但永远等不到回应。按钮点击都是页面内 DOM 事件,不是系统合成点击。

`--open-more` 这一臂在第 4 步之后再开 N 个没开过的目录,让 N 个目录同时在等 MCP。默认协议下,换代后真正重建实例的只有默认目录一个。

### 每轮数据

**当前主线(`2d94951af`)**

| 轮次 | 目录数 | MCP 连接数 | 最慢输入框读取 | 判定 | 屏障最大 probeTimeouts | /command 最慢 | 单条模型读取最慢 / 等 socket 条数 | 记过 stall 的请求 | MCP 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| more-n4-r1 | 4+4 | 17 | 14 ms | 未复现 | 0 | 69 ms | 10 ms / 0 | 68 | pending/failed |
| more-n4-r2 | 4+4 | 17 | 24 ms | 未复现 | 0 | 58 ms | 21 ms / 0 | 71 | pending/failed |
| more-n4-r3 | 4+4 | 17 | 17 ms | 未复现 | 0 | 41 ms | 14 ms / 0 | 73 | pending/failed |
| n4-nomcp-r1 | 4 | 无 | 6 ms | 未复现 | 0 | 16 ms | 3 ms / 0 | 0 | 无 MCP |
| n4-r1 | 4 | 4 | 7 ms | 未复现 | 0 | 20 ms | 5 ms / 0 | 11 | pending |
| n4-r2 | 4 | 4 | 7 ms | 未复现 | 0 | 16 ms | 4 ms / 0 | 0 | pending |
| n4-r3 | 4 | 4 | 8 ms | 未复现 | 0 | 20 ms | 5 ms / 0 | 0 | pending |
| n8-r1 | 8 | 4 | 7 ms | 未复现 | 0 | 15 ms | 3 ms / 0 | 0 | pending |
| n8-r2 | 8 | 4 | 7 ms | 未复现 | 0 | 18 ms | 3 ms / 0 | 0 | pending |
| n8-r3 | 8 | 4 | 6 ms | 未复现 | 0 | 17 ms | 3 ms / 0 | 0 | pending |

| 轮次 | 退出码 | netlog 收尾 | 孤儿进程 | lsof 泄漏(开始/收工) | SecurityAgent 事件 | 还能再开几条流,之后排队 | 占满后 /global/health |
| --- | --- | --- | --- | --- | --- | --- | --- |
| more-n4-r1 | 0 | true | 0 | 0/0 | 无 | 3 条,其余 5 条排队 | no-answer-in-3000ms |
| more-n4-r2 | 0 | true | 0 | 0/0 | 无 | 3 条,其余 5 条排队 | no-answer-in-3000ms |
| more-n4-r3 | 0 | true | 0 | 0/0 | 无 | 3 条,其余 5 条排队 | no-answer-in-3000ms |
| n4-nomcp-r1 | 0 | true | 0 | 0/0 | 无 | 3 条,其余 5 条排队 | no-answer-in-3000ms |
| n4-r1 | 0 | true | 0 | 0/0 | 无 | 4 条,其余 4 条排队 | no-answer-in-3000ms |
| n4-r2 | 0 | true | 0 | 0/0 | 无 | 3 条,其余 5 条排队 | no-answer-in-3000ms |
| n4-r3 | 0 | true | 0 | 0/0 | 无 | 3 条,其余 5 条排队 | no-answer-in-3000ms |
| n8-r1 | 0 | true | 0 | 0/0 | 无 | 4 条,其余 4 条排队 | no-answer-in-3000ms |
| n8-r2 | 0 | true | 0 | 0/0 | 无 | 3 条,其余 5 条排队 | no-answer-in-3000ms |
| n8-r3 | 0 | true | 0 | 0/0 | 无 | 3 条,其余 5 条排队 | no-answer-in-3000ms |

**#1563 之前的树(`380b9a9e8`),对照臂**

| 轮次 | 目录数 | MCP 连接数 | 最慢输入框读取 | 判定 | 屏障最大 probeTimeouts | /command 最慢 | 单条模型读取最慢 / 等 socket 条数 | 记过 stall 的请求 | MCP 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pre1563-n4-nomcp-r1 | 4 | 无 | 9 ms | 未复现 | 0 | 18 ms | 4 ms / 0 | 0 | 无 MCP |
| pre1563-n4-nomcp-r2 | 4 | 无 | 6 ms | 未复现 | 0 | 18 ms | 3 ms / 0 | 0 | 无 MCP |
| pre1563-n4-r1 | 4 | 4 | 42064 ms | **复现** | 42 | 42075 ms | 1003 ms / 43 | 46 | err:AbortError |
| pre1563-n4-r2 | 4 | 4 | 42003 ms | **复现** | 41 | 42018 ms | 1004 ms / 42 | 47 | err:AbortError |
| pre1563-n4-r3 | 4 | 4 | 42072 ms | **复现** | 42 | 42081 ms | 1006 ms / 42 | 47 | err:AbortError |

| 轮次 | 退出码 | netlog 收尾 | 孤儿进程 | lsof 泄漏(开始/收工) | SecurityAgent 事件 | 还能再开几条流,之后排队 | 占满后 /global/health |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pre1563-n4-nomcp-r1 | 0 | true | 0 | 0/0 | 无 | 4 条,其余 4 条排队 | no-answer-in-3000ms |
| pre1563-n4-nomcp-r2 | 0 | true | 0 | 0/0 | 无 | 3 条,其余 5 条排队 | no-answer-in-3000ms |
| pre1563-n4-r1 | 0 | true | 0 | 0/0 | 无 | 3 条,其余 5 条排队 | no-answer-in-3000ms |
| pre1563-n4-r2 | 0 | true | 0 | 0/0 | 无 | 3 条,其余 5 条排队 | no-answer-in-3000ms |
| pre1563-n4-r3 | 0 | true | 0 | 0/0 | 无 | 3 条,其余 5 条排队 | no-answer-in-3000ms |

当前主线「记过 stall 的请求」不为 0 的几轮(`n4-r1` 11 条,`--open-more` 68–73 条)都是短暂排队:这些轮次点新对话之后,除收工探针外没有一条请求等够 1 秒(`engine.slow` 里查得到)。开目录时请求一下子涌上来,连接池确实满过,只是很快就空了。

当前主线的 MCP 连接数说明黑洞确实收到了连接:默认协议 4 条(一个目录的实例在重试),`--open-more` 17 条,字节数对得上 TLS ClientHello。

### 修复前卡住时,连接被谁占着

`pre1563-n4-r1`([`results/ac1-control/pre1563-n4-r1.classify.json`](results/ac1-control/pre1563-n4-r1.classify.json)):

| 占着连接的 | 状态 | 等了多久 |
| --- | --- | --- |
| 3 条 `/global/event` | 已答,流式进行中 | 一直 |
| `/command`、`/mcp`、`/experimental/resource`(同一个目录) | 已发出无响应 | 43.5 秒 |
| 模型读取探针 43 条,以及 `/session`、`/config`、`/project/current` 等 | 等 socket | 探针每条 1 秒后 abort,其余 43.5 秒 |

**一个目录就够了。** 这三条都是默认目录发的,3 条事件流加这 3 条正好是 6。票面写的 N 个目录在这个协议里不是必要条件:
N=4 的 4 个目录在换代后都没重建实例(引擎日志里 `ws1…ws4` 的 `creating instance` 都发生在放行之后,由收工时的状态查询触发)。

同一个样本同时含两层:`/command` 等的是引擎里的 MCP(已发出无响应),探针等的是 renderer 的连接池(等 socket)。
所以单看「模型读取」这一路是等 socket,单看 `/command` 这一路是引擎在等。打包版判定时两路都要列,不能只看探针。

### 冷启动窗口(不算结论)

两棵树每轮冷启动,在配 MCP 之前,引擎都有一段时间不回 `/project`、`/provider`、`/path`、`/session/status`(`responseWaitMs`:当前主线 10–35 秒,对照臂 14–18 秒)。
这 4 条加 3 条事件流超过 6 条,其余请求等 socket,模型读取探针也在其中。当前主线 `n4-r1` 那一轮读取被拖了 23 秒才被重挂取消。

这几轮每次都是全新的临时根,引擎日志同窗有 `downloading ripgrep`。没有做对照,不知道这段等待是不是下载造成的,
也不能搬到 owner 机上(他那边 ripgrep 已缓存)。列在这里,是因为它说明当前主线上「连接池被占满 → 探针等 socket」这条链仍然走得通,
打包版冷启动样本要盯这一段。

## netlog 判定工具

[`netlog-classify.mjs`](netlog-classify.mjs) 读 netlog,对引擎 origin 的每个请求判状态;给了 `startup-timeline.log` 就抽各阶段耗时和 `probeTimeouts`,
并把每个慢样本的时间窗对上 netlog,给出「等 socket / 已发出无响应 / 混合」的判定表。

| 判定 | 含义 |
| --- | --- |
| `waiting-socket:pool-stalled` | 一个字节没发,连接池记了 `SOCKET_POOL_STALLED_MAX_SOCKETS_PER_GROUP` |
| `waiting-socket:connecting` | 一个字节没发,池没满,还在连 |
| `sent-no-response` | 请求已发出,到结束或截止都没等到响应头 |
| `answered` | 收到响应头;之前等在哪一段看 `socketWaitMs` / `responseWaitMs` |
| `failed:net_error=N` | 没等到响应就以网络错误结束,如换代时连接被拒 |

**先证明能判对**:`sh samples/selftest.sh`。样本由合成层在真实 Electron 上录得,期望值来自服务端地面真相,
含排队中被 abort、发出后被 abort、连接被拒。三臂结果:

```
arm true-labels: rc=0 (want 0) | expect: 13 tags, 0 mismatches
arm swapped-labels: rc=1 (want 1) | 2 mismatches
arm truncated-file: rc=0 (want 0) flagged-unfinalized=yes (want yes)
selftest: PASS
```

输出不含请求头,查询串的值只留短哈希。netlog 只记 Chromium 网络栈,引擎进程自己的出网不在里面:上游等待在输出里单独列在 `upstream`,
只含 renderer / main 直接发出的请求,引擎那一侧要看 `opencode.log`。

## 打包版取样(AC2、AC3)

工具 [`packaged-sample.sh`](packaged-sample.sh)。这一轮只在 dev 的 `Electron.app` 上跑过(启动、抓包、拒绝二次启动、正常退出、判定),
**没有在打包的 `Code Puppy.app` 上跑过**,`--log-net-log` 在打包版上生效与否未验证;抓不到时 `start` 会在 10 秒后报 `NOT CAPTURING` 并非零退出。

```sh
D=docs/verification/2026-11-05-1554-sync-hang
APP="/Applications/Code Puppy.app"
bash $D/packaged-sample.sh start    --app "$APP" --out /tmp/1554-pkg/cold-1
# 等输入框和模型状态稳定,或等「正在同步」结束
bash $D/packaged-sample.sh stop     --app "$APP" --out /tmp/1554-pkg/cold-1
bash $D/packaged-sample.sh classify --out /tmp/1554-pkg/cold-1
```

踩过的,工具已处理,手动跑时别绕开:

- **走 `open -n`,不直接执行二进制。** 直接执行会继承当前 shell 的 env(代理、key),与 owner 点图标启动不是一个环境。
- **只能正常退出。** 整组杀进程时网络服务先死,主进程把它重启,重启的网络服务把 netlog 截断重写,实测整份只剩 11 个事件。`stop` 只给主进程发 SIGTERM;输出里 `finalized=false` 的样本不要用。
- **App 开着时新实例会丢单实例锁并立刻退出,参数白传**,所以 `start` 看到同路径实例就拒绝。
- **不用 `osascript` 退出**,那会在 owner 屏幕上弹「想要控制」的授权框。
- netlog 全文的查询串里有 owner 的目录路径。只留在 `--out`,判定后删除;进仓的只有 `classify.json`。

## 隔离

实例环境:环境变量白名单(不继承 owner 的 env)、`HOME` 与 `CFFIXED_USER_HOME` 改到临时目录、`TMPDIR` 改到临时目录、
`OPENCODE_TEST_ONBOARDING=1`、`--use-mock-keychain`、CDP 口随机。也传了独立的 `--user-data-dir`,但产品会用 `app.setPath` 覆盖它(`main/index.ts:490`),真正把数据挪走的是 `OPENCODE_TEST_ONBOARDING`,落在 `<临时目录>/opencode-onboarding-<uuid>/`。
远程端点全部指向本机桩,桩只回 404。例外:全新临时根上引擎会从 GitHub 下载 ripgrep(日志里的 `downloading ripgrep`),没有 key,不是模型调用。

- **闸先证明能拦**:lsof 判定器喂已知坏文本必须判红(`isolation.lsofVerdictProof`)。每轮启动后和收工前各判一次,碰到 owner 路径立刻停。所有轮次 0 泄漏。
- 日志里出现的 owner 家目录路径,当前主线 0 条,对照臂只有它自己那棵 worktree(`~/app/alpha-code/.worktrees`)。
- **`sandbox-exec` 包不住整个实例**:产品的进程围栏不能嵌套(`sandbox_apply: Operation not permitted`),而且 fail-closed,引擎起不来。所以它只用于单独一次
  `--guarded-preflight`:把主进程和 renderer 关进禁读钥匙串、禁连 authd 的沙箱跑 20 秒,核系统日志:应用 0 条相关拒绝;同一沙箱里故意读一次钥匙串目录,日志查得到,所以这个 0 算数([`results/isolation/preflight.json`](results/isolation/preflight.json))。
- **SecurityAgent 看门狗**:新进程出现就问 authd 是谁要的,只有 owner 解锁屏幕放行,其余立刻停。实测误报过一次,authd 日志写明是 `loginwindow` 要 `system.login.screensaver`,已按这个判据放行并记录。
- 引擎进程的文件读取没有沙箱证明,lsof 只看得见打开着的文件,瞬时读取看不见。这一面靠 `HOME` 改道和日志里没有 owner 路径,强度低一档。

## 怎么重跑

```sh
# 在证据目录下。一次只开一个实例;每轮约 100 秒。先构建(跳过 office 运行时,这里用不到):
# (cd packages/ui-mac && bun ./scripts/predev.ts && bun ./scripts/gen-db-expected.ts && bun ./scripts/patch-server-version.ts \
#    && bun ./scripts/patch-plugin-internal-models.ts && bun ./scripts/launch.ts build)
sh samples/selftest.sh                                    # 判定脚本自证
sh fixture/run-rounds.sh results/ac1 4 3 --hold-ms 170000 # 当前树 N=4 三轮
LABEL_PREFIX=more- sh fixture/run-rounds.sh results/ac1 4 3 --open-more --hold-ms 170000
# 对照臂:bash scripts/worktree-bootstrap.sh 1554-pre1563 --detach --base 380b9a9e8,同样构建,然后
LABEL_PREFIX=pre1563- sh fixture/run-rounds.sh results/ac1-control 4 3 --app-root <对照树> --hold-ms 170000
LABEL_PREFIX=pre1563- sh fixture/run-rounds.sh results/ac1-control 4 2 --no-mcp --app-root <对照树> --hold-ms 170000
bun fixture/tabulate.mjs results/ac1 results/ac1-control  # 上面的表由它生成
```

## 2026-07-12 的同类实验

[`docs/audits/2026-07-10-s39-req083/verify.md`](../../audits/2026-07-10-s39-req083/verify.md) 记录那次判决实验未完成:靠 kill 引擎碰运气,6 个循环 1 次,且手段是僵死瞬间从外部 curl。
这次没有重复:触发是确定的(不应答的 MCP),手段是 netlog,不需要抓「僵死瞬间」。

## 没覆盖的

- **打包版**:AC2、AC3 全部未做,H1 / H2 没有结论。
- **当前主线上,除了 MCP 还有什么能占满连接池**:未测。冷启动窗口是一个线索,不是结论。
- **dev 与打包版的差别**:这里的渲染页和引擎是 dev 构建,窗口透明、不抢前台;网络栈是同一个 Electron 42.3.3。REQ-556 报告的本机到 `alpha-cloud` / `alpha-gateway` 建连失败率(51/60、50/60)在这里测不到,所有远程端点都是本机桩。
- **令牌续期换代**:夹具用 `retryEngine` 换代(对照臂的树没有这个 IPC,杀引擎进程走崩溃自愈)。按票面 2026-10-31 的评论,0.1.24 起续期不再让引擎重启,打包版上这个场景是否还存在要当场核。
- **N 的影响**:`--open-more` 下 N=4 没有拖住读取,更大的 N 只在默认协议下跑到 8。
