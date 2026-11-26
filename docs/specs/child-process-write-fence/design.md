---
id: DESIGN-child-process-write-fence
title: 子进程写入围栏技术设计
summary: 保留既有围栏、Homebrew 与 Cargo 裁决；v4.2 将 Go 的 GOPATH/sumdb 缓存迁入应用数据，并固定原生 GOBIN，保持全局安装目标与校验语义。
kind: tech-design
status: frozen
spec: SPEC-child-process-write-fence
spec_version: 6
review:
  rounds: 0
  reviewed_sha: ""
  verdict: "frozen-per-r8; scoped review flagged for Go install-location capture and coupled projection"
owners: [owner]
last_reviewed: 2026-11-27
---

# DESIGN-child-process-write-fence｜用户亲手打开的项目当场可写 技术设计

只放决定:契约、落点、失败处理、裁决。文件清单、提交顺序与测试归实施方的 `plan.md`。§3、§7 已退役,编号不复用。

坐标约定:`A` = `origin/alpha@a20dadb942`(0.2.4,本设计的读码基线)。「测」= 本设计跑过的命令(宿主 macOS 26.3.1 / 25D771280a,arm64,`/usr/bin/clang`;实验程序未签名、非 Electron);「测(编排者)」= 编排者跑过并留证的命令;「读」= 读码得出;「推」= 推断,未验证。实验源码与原始输出在本机 `~/.cache/alpha-orch/2026-11-19/fence-ext/`(`src/*.c`、`*result*.txt`),不入仓。

## 1. 基线

- Spec:[SPEC-child-process-write-fence v2](https://github.com/impharaon/alpha-code/blob/8593c2701d94d29b9a5de3de1db44639220fb637/docs/specs/child-process-write-fence/spec.md)(owner 2026-11-19 批准)。
- 覆盖:BR-03 至 BR-06,AC-05 至 AC-08;v1 的 BR-01 / BR-02 是必须守住的安全承诺(§6 安全面)。
- owner 原话(2026-11-19,经编排者转述,逐字):
  - 关于「打开新项目后空闲时自动重启引擎」:「做。」
  - 关于现状(新项目在 Code Puppy 重启前只读;标题栏「只读」胶囊带「重新启动」按钮):「这个是什么意思啊，这个交互逻辑我觉得有点乱。我希望可以尽量用户无感。不能因为一个文档生成要重启一次引擎吧。」
  - 关于两条路(第一条 = 空闲时后台换引擎;第二条 = 用户亲手打开的项目当场可写、完全不重启):「如果第二条可行，就选第二条，这样才是真正的无感，好的，如果这样我觉得可以。」
  - 读法:第三段在第二条可行时取代第一段的「做。」。§2 实测第二条在加宽 X2 与进程绑定令牌之后可行 ⇒ 选第二条;第一条不实现、也不作为分层兜底。
- 背景(只引用、不重述):REQ-159 方案基线 `docs/design/2026-09-09-req159-process-fence-baseline.md` §三 I1、§四 U2;U2 决定书 `docs/architecture/2026-09-09-multi-workspace-fence-decision.md` §3、§4 第 3 条;落地形状 `docs/architecture/2026-09-09-req159-process-fence.md` §2、§3(5b/5c)、§8.2;披露设计 `docs/design/2026-09-10-req159-sandbox-disclosure/design.md`(其批准原文 `保留弹层里的「重新启动 Alpha」按钮`,本路径上由 2026-11-19 原话取代,见 §10 送审前第 6 条)。

## 2. 地面真相

**P-01 围栏 profile 的形状(读)。** `(allow default)` → `(deny file-write*)` → 一个 `(allow file-write* …)` 块(W1 每个工作区一条 `subpath`,其余 W2–W19 固定行)→ 四条网络行(`packages/ui-mac/src/main/process-fence-profile.ts:150-177`)。没有任何引用沙箱扩展的规则;五种签发操作都落在 `(allow default)` 之下。

**P-02 基线 I1「装上之后无法放宽」只对 profile 文本成立(测)。** 装上时已声明 `(extension "<类>")` 写放行的 profile,之后可由未被围栏的进程签发、被围栏进程消费的令牌放宽到令牌指定的目录(E1–E3)。今天的 profile 没有这条规则,消费任何令牌都放宽不了(E1 `none` 臂)。

**P-03 送审前四组实验(测;每组都带会失败的一臂)。** 父进程(未被围栏,替身 = Electron 主进程)签发令牌,再 `sandbox_init` 进与生产同形的 profile,在围栏内消费、写盘;判据 = 文件是否落盘(`find` 实读)。

E1 `probe.c`(`probe <allowed> <outside> <other> <none|nodeny|deny>`):

| 臂(profile 尾部) | 消费前写 outside | 伪造令牌 | 消费主进程令牌后写 outside | 围栏内自签 `other`(file,flags=0)并消费后写 | 消费后新 exec 子进程写 outside |
| --- | --- | --- | --- | --- | --- |
| `none`(= 今天的生产形状) | EPERM | consume=-1,EPERM | **EPERM** | 签得出、消费=2,EPERM | EPERM |
| `nodeny`(+ 认 `com.apple.app-sandbox.read-write` 的写放行) | EPERM | -1,EPERM | OK | **签得出、OK(洞)** | OK |
| `deny`(nodeny + `(deny file-issue-extension)`) | EPERM | -1,EPERM | OK | NULL(errno=1) | OK |

E2 `probe2.c`(私有类 `app.codepuppy.workspace-write`;子进程在围栏装上之后、消费之前 fork):规则只认私有类时,消费外类(app-sandbox read-write)令牌后仍 EPERM、消费本类令牌后 OK、消费前已 fork 的子进程在父进程消费后写 OK;对照臂规则认苹果类时,外类令牌也能放宽。

E3 `probe3.c`(私有类 + 只禁 `file-issue-extension` 本类):主进程令牌消费后写 OK;围栏内 file 方式自签本类 → NULL;自签 app-sandbox 两类签得出但写仍 EPERM。**E3 只测了 file 方式、flags=0,不足以推出 S1 —— 见 E5。** R-c 已覆盖:同一 `probe3.c` 用 Developer ID 签名并开 hardened runtime(`flags=0x10000(runtime)`,`TeamIdentifier=RQX6X6A635`)结果与未签名一致(签发 OK、消费=1、围栏内自签本类 NULL、只有 `outside/after.txt` 落盘),证据 `fence-ext/rc-hardened/`(测(编排者))。

E4 LaunchServices 在围栏内可达:`/usr/bin/sandbox-exec -f net.sb /usr/bin/open -g 'zzcpnotregistered://open-project?directory=/x'` → `kLSApplicationNotFoundErr`,exit 1(绑定结论,不是沙箱拒绝);对照臂同一 profile 往 HOME 下写 → `Operation not permitted`。⇒ 被围栏的工具能把 URL 交给 LaunchServices(对真协议实发未做,推)。

**P-04 R1 实验 E5:围栏内所有签发方式(测)。** `r1.c` / `r1b.c` / `r1d.c`:每种方式在独立的被围栏子进程里为一个专属目录签发**本类**、消费、写盘(崩溃隔离)。可用的签发入口取自本机导出表(`dyld_info -exports /usr/lib/system/libsystem_sandbox.dylib`,`r1-symbols.txt`);签发操作名取自 dyld 共享缓存(`r1-dsc-issue-ops.txt`:`file-issue-extension`、`generic-issue-extension`、`iokit-issue-extension`、`ipc-posix-issue-extension`、`mach-issue-extension`;编译器对未知名报 `unbound variable`,`r1-opnames.txt`)。本机没有 posix-ipc 的签发函数导出。

| 签发方式(围栏内,本类) | 只禁 file 签发(= 送审稿 X2) | 禁五种签发(= 修订后 X2) |
| --- | --- | --- |
| `issue_file` flags=0 / `_to_self` / `_to_process`(审计令牌)/ `_to_process_by_pid` | NULL,0 落盘 | NULL,0 落盘 |
| `issue_related_file_to_process`(签名经 lldb 反汇编确认为 6 参:类、路径、相关路径、操作名、flags、审计令牌引用;`r1-related-dis.txt`)× 操作名 write-data / write-create / read-data | (此行测的是无 X2 臂)write 两种 NULL(签发方自己没有该写权限);read-data 签得出、消费=1、写 EPERM | 三种全 NULL |
| `issue_generic` / `_to_process` / `_to_process_by_pid` | **签得出、消费=1、集合外目录落盘(洞)** | NULL,0 落盘 |
| `issue_mach` ×3、`issue_iokit_registry_entry_class` ×3 | 签得出、消费=1、写 EPERM | NULL |
| 旧接口 `sandbox_issue_fs_extension` / `sandbox_issue_mach_extension`(只发苹果类) | 签得出、消费=1、写 EPERM | 同左(类不是本类,X1 不认) |
| `issue_file` 32 个单比特 flags | 0x1:签得出、handle=0、写 EPERM;其余能签得出的(0x2、0x10、0x20、0x40、0x2000、0x10000、0x20000)在 `nox2` 臂落盘,在只禁 file 臂 NULL | 0x1 同左(不放宽);其余全 NULL |
| `sandbox_extension_update_file(已消费句柄, 另一目录)` | -1 errno=22,另一目录 EPERM | 同左 |

落盘实读:只禁 file 签发臂多出 `t-generic*/landed.txt` 三个;禁五种签发臂除主进程签发的回放 / 绑定用例外 0 落盘(`r1-result.txt`、`r1-x2all-result.txt`、`r1d-result.txt`)。⇒ **通用(generic)扩展不带路径,一旦持有本类就满足 `(allow file-write* (extension "<本类>"))` 对任意路径的判定**;送审稿的 X2 堵不住它,必须五种签发一起禁。

**P-05 R1 实验 E6:令牌回放(测)。** 主进程用 `issue_file` 签的令牌(不绑进程):第一个被围栏进程消费后写 OK;它退出之后另一个独立的被围栏进程(新一代的替身)再消费 = 1、写 OK —— **令牌可被复制回放**。绑定进程签发(`issue_file_to_process`,审计令牌由目标进程自报 / 由主进程经 `task_name_for_pid` + `task_info(TASK_AUDIT_TOKEN)` 取得,两种都测;以及 `_by_pid`):目标进程消费 = 1、写 OK;同一令牌被未围栏进程消费 = -1;被另一个新的被围栏进程消费 = -1、写 EPERM。主进程对自己的子进程 `task_name_for_pid` = 0、`task_info` = 0(`r1-x2all-result.txt` 尾段)。

**P-06 R1 实验 E7:已 exec 并报 ready 的子进程、软链与大小写(测)。** `r2b.c` / `r2.c`,令牌由主进程绑定到被围栏的「引擎」进程签发:
- 引擎进程先 fork + exec 一个 `sh`,`sh` 输出 `ready` 并阻塞读;之后主进程签发、引擎消费,再通知 `sh` 写 → LANDED;对照臂不消费 → FAIL,0 落盘(`r2b-result.txt`)。
- 令牌签给真实目录 G:经 G 外的软链 `LG → G` 写、经大小写变形路径写都 LANDED;**负例**:G 里预置的软链 `G/esc → N`(N 未放行)写 → EPERM;被围栏代码自己在 G 里建软链 `G/esc2 → N`(建得成)再经它写 → EPERM;直接写 N → EPERM。令牌签给软链路径 `LG2 → G2` 时经真实路径与软链写都 LANDED;签给大小写变形路径时经真实路径写 LANDED(`r2-result.txt`)。

**P-07 R1 实验 E8:单进程累计可消费的扩展数(测,只是读数)。** `r3.c`:主进程签发 2 000 / 20 000 枚绑定令牌(每枚约 65 µs,20 000 枚 1.31 s,0 签发失败);引擎进程依次消费:2 000 枚全成功;20 000 枚时第 2 589 枚起消费失败 `errno=12`(ENOMEM),此后新目录写 FAIL、已消费的首个目录仍可写(`r3-result.txt`)。

**P-08 「用户打开的工作区」真源与它今天的洞(读 + 测)。** 真源 `<appData>/codepuppy-state/fence-workspaces/<env>.json` 只由主进程写,内容 = renderer tab 状态投影,每次 `store-set` 系列 IPC 重算(`process-fence-workspaces.ts:170-235`,`ipc.ts:160-175`);boot 检疫(`:176-183`、`:203-206`)。本机真源实读 3 条 = 当前开着的 tab ⇒ 关掉 tab 即出真源,从项目列表重新进入昨天关掉的项目今天是「只读直到重启」。tab 里会话的目录由 `rememberSessionInfo` 照引擎回报的 `session.directory` 写入(`packages/codepuppy-app/src/context/tabs.tsx:350-355`,调用方 `components/titlebar-tab-strip.tsx:143`;桌面 renderer 依赖的是 `@opencode-ai/app` = `packages/codepuppy-app`,`packages/ui-mac/package.json:53`;Code Puppy 外壳是否挂载这条 tab 栏未核实,推)。引擎库在 W4 之下,围栏内能改 `session_v2.directory`(`packages/core/src/session/sql.ts:41`,经 `session/info.ts:43` 投影,R1 Codex 读码)。⇒ **今天的真源有同一个洞**:改写当前会话的目录 → renderer 写回 tab → 真源收下 → 逼一次崩溃自愈(P-12)→ 下一代 W1 含该目录,全程没有用户动作。

**P-09 页面目录不是用户动作(读,R1 Codex)。** 会话的规范路由只绑定 server 与会话 ID,目录由会话记录取得(`session-workspace-core.ts:38`:`route.directory ?? session.directory`)。写探针咽喉有三个宿主:会话页 `codepuppy-session-workspace.tsx:155`(只传目录)、首页 `CodePuppyHome.tsx:66`(`activeWs`,来源分 chosen / project / default / none,`:67`)、新对话页 `codepuppy-new-session.tsx:74`。renderer 按「引擎代 + 目录」缓存一次答案(`workspace-writable-core.ts:53-54`),异常与 `unknown` 缓存为无标记(`:60-66`);IPC 不带 server(`ipc.ts:94`)。真源只收本机引擎的候选(`process-fence-profile.ts:308`、`:321`,`LOCAL_SIDECAR_SERVER_KEY = "sidecar"` `:215`)。

**P-10 打开入口(读)。** 系统目录选择器 `ipc.ts:185-207`(`CODEPUPPY_OPEN_DIR` 在 `:190-192` 短路对话框,值来自启动 Electron 主进程的那一方的环境)。调用方:chip「打开项目」(`workspace-chip.tsx:126`)、侧栏「打开项目」与 Cmd+O(`codepuppy-sidebar.tsx:922-933`、`:950`;选中后先 `startChat` 建会话再导航,`:902-908`)、`packages/codepuppy-app/src/components/directory-picker.tsx:27`、自动化面板(只写表单目录,`automation-panel.tsx:265-267`)、云端两个面板。深链接:`route-manifest.ts:70-90`;主进程入口 `index.ts:686-711` → `deep-link-queue.ts:332` `decodeDeepLink`(首启 argv、`second-instance`、`open-url` 三路同入);四个仓都没有产品面产出项目深链接(只有 `codepuppy://auth/callback`)。没有「拖文件夹进来打开项目」的入口(输入框 drop 是附件;主进程无 `open-file`)。重载后回原处只用 `sessionStorage`、只在重载时生效(`reload-place-store.ts:1-60`)。

**P-11 现有只读界面与原生模块(读)。** 胶囊 + 弹层 + 「重新启动 Code Puppy」(`session-workspace/session-workspace-shell.tsx:144-208`,`relaunch` `:200`、`:261`、`:656-678`);chip 尾标 `workspace-chip.tsx:41-80`;文案 `i18n/zh.ts:1925-1930`、`i18n/en.ts:1951-1956`。`codepuppy_fence.node` 今天只导出 `apply`(+ 钥匙串三函数),`FenceAddon` `process-fence-apply.ts:31-39`;主进程已加载它(`index.ts:584`);sidecar 在 `start()` 第一句 apply(`sidecar.ts:234-245`)。写探针合同 `workspace-write-probe.ts:30-76`,sidecar 同步执行 `sidecar.ts:122-138`,主进程请求簿 `server.ts:586-600`、`:707`,超时 / 退出答 `unknown`(`workspace-write-probe.ts:154-173`)。

**P-12 模型能逼出一次换代(推,未执行)。** 崩溃自愈在白名单里(`sidecar-lifecycle.ts:10-21`);`(allow default)` 放行 signal。⇒ 凡能进真源的目录,对攻击者等价于「现在就」能进可写集。自愈接线成立(R1 Codex 核过),signal 整链未实跑。

**P-13 第一条路的代价(测,本机出货包日志;只作背景)。** 三次换代到界面重挂约 1.2 s / 6.4 s / 4.2 s,每次整页重载,另有终端全灭、工具子进程变孤儿、其它对话的回答被取消(U2 §3.2)。不是真引擎 harness 测量:第二条可行后耗时不影响决定。

**P-14 「访问项目以外的文件夹」卡片(读)。** `packages/ext/src/external-directory-rule.ts:31-41`:批准只放行引擎层权限,不动围栏。

**P-15 通向三个宿主的导航 / 选择调用点(读,R2 枚举)。** 范围:`packages/ui-mac/src/renderer`(非测试)全部 `navigate(` / `hrefFor.*(` / `startChat(` / `startDraft(` / `promoteDraft(` / chip `onSelect` 调用,加上它挂载的 `packages/codepuppy-app/src` 里会改路由的上下文;原始清单 `~/.cache/alpha-orch/2026-11-19/nav-sites-uimac.txt`。

| 调用点 | 触发 | 目标目录从哪来 | 分类 |
| --- | --- | --- | --- |
| main `open-directory-picker`(`ipc.ts:185-207`) | 用户在系统对话框里选 | 选中路径 | **记录(M1)** |
| 侧栏 `startChat(worktree)`(`codepuppy-sidebar.tsx:887`;调用方 `:932` 打开项目、`:1365` 项目行「在此项目新对话」按钮) | 两处都是点击 / Cmd+O 菜单命令(`:950`) | 参数 worktree(选中路径 / 项目行的 worktree) | **记录(R1)**,第一个 await 之前 |
| 侧栏 `openSession(e, id)`(`:971-975`;唯一引用 `:1395` 会话行 `onClick`) | 点侧栏里的一条对话 | 该行 `session.directory`(`use-projects.ts:40-46`) | **记录(R2)** |
| chip `choose(directory)`(`workspace-chip.tsx:53-56`;引用 `:89` 默认工作区项、`:103` 项目列表项) | 在首页 / 新对话页的项目列表里点一项 | 所点项的 worktree | **记录(R3)** |
| 会话搜索 `go(href)`(`codepuppy-session-search.tsx:160-163`;引用 `:167` 点击、`:184` 回车) | 从搜索结果进入一条对话 | 结果所属会话的 `session.directory`(结果形状补 `directory`,`:70-82`) | **记录(R4)** |
| chip 选择器分支(`workspace-chip.tsx:126-128`) | 系统对话框 | 选中路径 | 已由 M1 记录 |
| 侧栏导航 `:908`(startChat 建会话后) | R1 之后 | 引擎创建的会话 | 只消费 |
| 首页发送后 `CodePuppyHome.tsx:173`、新对话页 `promoteDraft` `codepuppy-new-session.tsx:174` | 用户发送 | 发送时的工作区(已由 R3 / M1 记录,或默认工作区,或深链接带来的目录) | 只消费 |
| 自动化历史「打开会话」`openSession(task, rec)`(`automation-panel.tsx:338-349`;唯一引用 `:817` 按钮 `onClick`) | 用户点击 | 该运行所属任务的 `target.projectDir`(`shared/automation-types.ts:34-35`) | **记录(R5)**(R3 补) |
| 自动调度触发的运行(main 的调度器按 `target.projectDir` 建会话)、历史列表加载 | 定时器 / 面板打开时读取 | 任务文件 | 只消费(不导航、不登记) |
| 子任务卡进入子会话 `session-timeline.tsx:196`、子会话回父会话 `session-composer-dock.tsx:275` | 用户点击 | 引擎回报的会话目录 | 只消费(收窄:不产生新资格) |
| 后退 / 前进 / 主页 `codepuppy-sidebar.tsx:1114`、`:1115`、`:1267`;新对话 `:915` | 用户点击 | 历史条目 / 默认工作区 | 只消费 |
| 启动草稿 `codepuppy-sidebar.tsx:869` | 启动时自动 | 默认工作区(W1 恒含) | 只消费(恢复类) |
| 重载回原处 `reload-place.ts:11-17`(`RestoredMemoryRouter`,`index.tsx:544`) | 重载后自动 | 会话记录 | 只消费(恢复类) |
| 深链接 `index.tsx:184-191` | 外部 / 工具发 URL | 链接参数 | 只消费(深链接) |
| `codepuppy-app/src/context/tabs.tsx:152`、`:170`、`:219`、`:244`、`:277`、`:296`、`:341-342`、`:365-373`(tab 选择 / 关闭后跳下一个 / 会话被删后跳下一个 / server 消失回首页 / 新草稿) | 用户操作 tab 或**引擎事件**(会话删除、server 变化) | tab 记录 | 只消费(含引擎驱动) |
| `codepuppy-app/src/context/notification.tsx:363`、`:401`(通知点击) | 用户点系统通知,目标来自引擎事件 | 引擎会话 | 只消费(引擎驱动) |
| `codepuppy-app/src/pages/directory-layout.tsx:42`、`:67`、`:111`;`pages/session.tsx:219`、`:2161`;`components/titlebar.tsx:144`、`:151`、`:519` | 旧路由规范化 / 会话不存在回首页 / 上游标题栏 | 路由 / 引擎数据 | 只消费 |

结论:没有一个所有用户打开动作共用的窄点 —— 用户打开动作分布在 M1 与五个 renderer 函数(R1–R5)上;五个函数只被列出的 DOM 事件处理与菜单命令引用。**引擎来源的事件(SSE、会话事件、子任务会话、通知)与自动调度驱动的导航 / 会话都不经过 R1–R5 或 M1**(上表引擎驱动与只消费各行)。自动化任务文件在 `codepuppyGlobalRoot()/automations`(`main/codepuppy-automations.ts:16-17`),属 W2,围栏内写得了 ⇒ R5 记录的目录与侧栏会话行的目录同属 R-a 类(用户的点击落在可被模型改写的数据上)。

## 4. 接口契约

### profile 两行(唯一权威 `process-fence-profile.ts`)

```ts
export const WORKSPACE_WRITE_EXTENSION_CLASS = "app.codepuppy.workspace-write"
```

```
(allow file-write* (extension "app.codepuppy.workspace-write"))                       ; X1 用户本次运行亲手打开的项目
(deny file-issue-extension generic-issue-extension mach-issue-extension
      iokit-issue-extension ipc-posix-issue-extension
      (extension-class "app.codepuppy.workspace-write"))                               ; X2 围栏内五种方式都签不出本类
```

位置:`(allow file-write* …)` 块之后、网络行之前。类名只在这一个常量里定义。X2 的五个操作名来自本机 dyld 共享缓存(P-04);将来系统去掉其中某个名字时 profile 编译失败,走既有试编译 fail-closed(拒绝 fork,日志点名),不会静默变宽。形状闸逐行收进 X1/X2;写入点登记簿里写探针那一处的根改记 `W1+X1`。

### 原生模块(决定的新增能力)

```ts
// packages/ui-mac/src/main/process-fence-apply.ts —— FenceAddon 追加
export type FenceAddon = {
  // …既有字段不变
  /**
   * 只在 main 调。按 pid 取目标进程的审计令牌(task_name_for_pid + task_info(TASK_AUDIT_TOKEN)),
   * 再 sandbox_extension_issue_file_to_process —— 令牌只有该进程(含 pidversion)能消费。
   */
  issueFileExtensionToProcess: (
    extClass: string,
    path: string,
    pid: number,
  ) => { token: string } | { token: null; errno: number; step: "task_name_for_pid" | "task_info" | "issue" }
  /** 只在 sidecar 调(apply 之后)。handle ≥ 0 = 成功;-1 = 失败,errno 为码。 */
  consumeExtension: (token: string) => { handle: number; errno: number }
}
```

- 从 `apply` 已 dlopen 的同一个 libsandbox 里 dlsym;缺符号时按 `apply` 的规矩抛 JS 异常。
- **令牌只出现在一条 main → sidecar 的 `grant-write` 消息里**:不写日志(main 只记目录与结果)、不进 argv / env / 磁盘;sidecar 不回显;消息解析失败的日志不带消息体。复制出去的令牌在别的进程、退出后的新一代、未围栏进程里都消费不了(E6)。
- 不导出 release:令牌随引擎进程生命期;项目关掉在本次应用运行的任何一代都不收回(运行内可写历史随换代并入 W1,§10 第 9 条)。

### main → sidecar 窄消息(与写探针同一形态,归 `workspace-write-probe.ts` 所在合同)

```ts
export type WorkspaceWriteGrantCommand = { type: "grant-write"; id: number; token: string }
export type WorkspaceWriteGrantReply = {
  type: "grant-write-result"
  id: number
  outcome: "granted" | "failed"
  detail?: string // errno / 超时 / 子进程状态,只进日志
}
```

形状不对就当没有;sidecar 收到即同步 `consumeExtension`,不等引擎就绪;请求簿 5 s 超时 / 子进程退出 / 没有活着的 sidecar ⇒ `failed`。**方向只有 main → sidecar**;没有任何 sidecar → main 消息能让 main 登记资格或签发令牌。

### 用户打开资格:在打开动作处登记,两个消费者只消费(K2;R2 修订)

资格的唯一权威在 main(`process-fence-workspaces.ts`,「用户打开的工作区」的权威),**本次应用运行内**存活(renderer 重载、引擎换代都不清空)。

```ts
export type WorkspaceEligibility =
  | { eligible: true; server: typeof LOCAL_SIDECAR_SERVER_KEY; directory: string } // directory = resolve 后绝对路径
  | { eligible: false; reason: "not-local" | "home-or-app-state" | "not-a-directory" }

export type UserOpenedRegistry = {
  /** 只由记录点调用:main 的选择器处理函数直接调;renderer 的 R1–R5 经 `workspace-open-record` IPC。 */
  register(input: { server: string; directory: string }): WorkspaceEligibility
  /** 已登记(或 boot 时已在真源里)的「本机引擎 + 目录」。 */
  has(server: string, directory: string): boolean
}
```

- 判定顺序:`server !== LOCAL_SIDECAR_SERVER_KEY` → `not-local`(复用真源的本机判据,`process-fence-profile.ts:215/308/321`);规则 5/5b → `home-or-app-state`、规则 4 → `not-a-directory`(从 `selectWorkspaceUnion` `:348-393` 抽出逐候选判定,两处共用,不写第二份)。深链接与检疫目录不再需要单独的排除规则:它们到不了任何记录点(P-15)。
- boot 时真源里已有的目录视为本机已登记(它们本来就在 W1)。
- **消费者一:运行期放行**(下节)。只为 `has()` 为真的目录签发。
- **消费者二:真源 tracker**:`recompute` 只收 `has("sidecar", d)` 为真的新增目录(检疫照旧,成为第二道闸);`register` 成功后触发一次 `recompute`(tab 先写回、登记后到的顺序也收得下)。⇒ 引擎回报的目录变化(P-08)从此进不了真源。

### 记录点:用户打开动作发生的地方(R2 替换 R1 的「激活采样」)

记录发生在具体的打开动作里,记录的是该动作的具体目标;咽喉与真源只消费登记表,不从窗口状态、入口出现时机或页面后来解析出的目录推断任何资格。

| 记录点 | 位置 | 记录的 (server, directory) | 时机 |
| --- | --- | --- | --- |
| M1 | main `open-directory-picker`(`ipc.ts:185-207`) | (`sidecar`, 每个选中路径;含 `CODEPUPPY_OPEN_DIR` 短路) | 结果交回 renderer 之前(见「选择器路径」) |
| R1 | 侧栏 `startChat(worktree)`(`codepuppy-sidebar.tsx:887`) | (函数开头定格的 `props.serverKey()`, `worktree`) | 第一个 await(`createSession`)之前 |
| R2 | 侧栏 `openSession`(`:971-975`;改为接收该行会话,不只是 id) | (`props.serverKey()`, 该行 `session.directory`) | 导航之前 |
| R3 | chip `choose(directory)`(`workspace-chip.tsx:53-56`) | (宿主的 server, 所点项的目录) | `onSelect` 之前 |
| R4 | 会话搜索 `go`(`codepuppy-session-search.tsx:160-163`;改为接收结果,结果补 `directory`) | (serverKey, 该结果会话的 `session.directory`) | 导航之前 |
| R5 | 自动化历史「打开会话」`openSession(task, rec)`(`automation-panel.tsx:338-349`,唯一引用 `:817`) | (点击那一刻的 `props.serverKey()`, `task.target.projectDir`) | 导航之前(R3 补) |

```ts
// renderer → main,新通道 `workspace-open-record`;main 处理函数同步调用 register,不 await
export type WorkspaceOpenRecordRequest = { server: string; directory: string } // renderer 输入不可信:形状不对 ⇒ { recorded: false }
export type WorkspaceOpenRecordResult = { recorded: boolean; reason?: "not-local" | "home-or-app-state" | "not-a-directory" }
// renderer helper(唯一调用入口,只在 R1–R5 里调用):recordWorkspaceOpen(server: string, directory: string): Promise<void>
```

- R1–R5 先 `await recordWorkspaceOpen(...)`(一次 IPC 往返,毫秒级,界面无等待态),再导航 / 选择 / 建会话。登记按目录记,与会话创建、目录解析要多久无关 ⇒ 合法的打开无论引擎多慢都成立;宿主之后哪一刻解析出这个目录,咽喉都消费得到。
- 冻结:登记的就是动作那一刻的目标目录。之后会话目录被改写(SSE、重新取数、重载后从引擎重读)得到的新目录没有登记 ⇒ 不放行,显示 `not-opened-by-you` 那句。
- 恢复 / 重载 / 自愈 / 深链接 / 引擎驱动的导航:都直接设路由或调 `navigate` / `navigateTab`,从不调用 R1–R5 或 M1(P-15);自动调度触发的运行与历史加载同样不经过记录点;它们在 V5 的调用点登记簿里分别标为 restore / deep-link / engine,不产生任何记录。main 的登记表在本次运行内保留 ⇒ 诚实的重载照旧可写,被改写的目录不会变得有资格。
- **收窄后的认定(决定)。**算作「用户打开」的只有 M1 与 R1–R5,即 spec AC-05 的原文 `用户经「打开项目」选中它，或从项目列表、侧栏进入它或它的对话`,外加从搜索结果、自动化历史「打开会话」进入对话。经子任务卡、父子会话跳转、系统通知、tab 栏、后退 / 前进 / 主页、发送后的跳转到达的目录不产生新资格:它们若已登记(或在 W1)照常可写,否则显示 `not-opened-by-you` 那句。
- R1 的观测形状改动撤回:`WorkspaceWritableObservation` 保持 `{ sandbox, generation, server, directory }`,没有 `entry`、没有激活采样、没有草稿目录比较。
- `CODEPUPPY_OPEN_DIR`:只有启动 Electron 主进程的一方(开发 / 测试 harness / 操作者)能设;被围栏的进程树是主进程的子进程,改不了主进程的环境。它让对话框不出现,所以它是启动者的声明,不是系统 UI 的见证;在 M1 照样登记。

### IPC:既有 `workspace-write-probe` 通道

通道名与 preload 方法名不变(`ipc.ts:94-98`,`workspaceWriteProbe`);请求与回答改为:

```ts
export type WorkspaceWriteProbeRequest = { server: string; directory: string } // renderer 输入不可信:形状不对答 unknown;R2 去掉 open

export type WorkspaceWriteProbeResult = {
  outcome: "writable" | "denied" | "unknown" // 写探针
  detail?: string
  grant: "granted" | "failed" | "ineligible" | "not-local" | "no-fence"
  /** 有这一项且 outcome ≠ "writable" 时显示对应那句话 */
  reason?: "home-or-app-state" | "not-opened-by-you" | "grant-failed"
}
```

main 处理一次请求(本通道从不登记):①本代没有围栏 → `no-fence`,不探;②`server` 不是本机 → `not-local`,不签发、不探;③④`has()` 为假 → `ineligible`,理由:目录不过规则 5/5b 的按 `home-or-app-state`,其余按 `not-opened-by-you`,照旧探;⑤本代放行账本里没有它 → 取当前引擎进程的 pid → `issueFileExtensionToProcess` → `grant-write` → 等应答 → 只记成功;⑥照旧探。③–⑤ 中任何原生异常、`task_name_for_pid` / `task_info` / 签发失败、请求簿超时 / 退出 → `grant: "failed"`,`reason: "grant-failed"`(不依赖后续探针是否答 `denied`),main 日志一行(带目录、`step`、errno,不带令牌);IPC 不因这些拒绝。

### main → renderer:资格变化通知

```ts
// preload 新增订阅;main 在 register 使 has() 由假变真之后、或同一目录的放行由失败转成功之后发出
export type WorkspaceWritableChanged = { server: string; directory: string }
// preload: onWorkspaceWritableChanged(cb: (change: WorkspaceWritableChanged) => void): () => void
```

renderer tracker 收到后丢掉该 `(引擎代, server, directory)` 的缓存;有宿主正显示它就立即重问(重问即放行)。⇒ 「先被拒、后用选择器选中」在同一代、同一 renderer 里当场生效,不需要重载。缓存键从「引擎代 + 目录」改为「引擎代 + server + 目录」;`grant: "failed"` 的答案不是终态,换代或收到通知即重问。

### 选择器路径

`open-directory-picker` 在把结果交回 renderer **之前**:对每个选中路径(含 `CODEPUPPY_OPEN_DIR` 短路)`register({ server: "sidecar", directory })`(M1);本代围栏在线则立即放行(⑤),等到放行结束或 1 s 上限,再返回路径。自动化 / 云端面板的选择同样登记(用户亲手选的本机目录),不另分支。

### 界面

- 一个判定函数决定标记:`reason` 存在且 `outcome !== "writable"` ⇒ 显示「只读」胶囊 / chip 尾标与该 `reason` 那一句;否则无标记。IPC 意外拒绝 ⇒ 按 `grant-failed`。`not-local` / `no-fence` ⇒ 无标记。
- 常规路径:咽喉先放行再探,探针答 `writable` ⇒ 两个钩子(`data-codepuppy-workspace-readonly` / `data-codepuppy-workspace-chip-readonly`)都缺席。弹层只剩一句话:删掉标题、脚注与「重新启动 Code Puppy」按钮,胶囊不再接 `relaunch`。

| reason | 中文(唯一一句) | 英文 |
| --- | --- | --- |
| `home-or-app-state` | 主目录和 Code Puppy 自己的数据目录不能整个作为项目写入，请打开里面的具体文件夹。 | Your home folder and Code Puppy's own data folder can't be written as a whole project — open a specific folder inside instead. |
| `not-opened-by-you` | 这个文件夹不是你在 Code Puppy 里亲手打开的，助手不会改动它；用「打开项目」选中它就能写入。 | This folder wasn't opened by you in Code Puppy, so the assistant won't change it — choose it with "Open project" to make it writable. |
| `grant-failed` | 这个文件夹暂时写不进去，下次打开 Code Puppy 后即可写入。 | This folder can't be written to right now; it will be writable the next time you open Code Puppy. |

文案键:新增 `codepuppy.workspace.readonlyHome` / `readonlyNotOpenedByYou` / `readonlyGrantFailed`,删除 `readonlyTitle` / `readonlyBody` / `readonlyFootnote` / `readonlyRestart`;`codepuppy.workspace.readonly`(「只读」二字)留给剩余情形。终端「沙箱开启」不变。

### 数据 / 配置

无新持久化存储(登记表、深链接记录、放行账本都只在内存),真源文件形状不变,无新配置键。

## 5. 数据与失败

- **顺序(真正的保证)。**
  - O1 选择器:放行在选择器 IPC 返回之前完成(上限 1 s)⇒ 侧栏「打开项目」随后的 `startChat` 建会话、导航(`codepuppy-sidebar.tsx:902-908`)都在放行之后。
  - O2 列表 / 侧栏 / 首页进入:每个宿主的「开始工作」动作 —— 发送一条消息、新开一个终端 —— 先等本宿主当前 (server, directory) 的放行结束(tracker 暴露的 `whenSettled(server, directory)`),上限 1 s;上限内一般是毫秒级(签发约 65 µs,E8;消费微秒级;主要是一次 parentPort 往返,推,实施方报 p50 / p99)。界面不出现等待态。超过上限:动作照常进行,放行继续;之后成功则后续写入成功,失败则显示 `grant-failed` 那句;超限前已发生的写入得到 EPERM(只在放行异常慢时出现)。
  - O3 已在运行的工作(进入一个正在跑的会话、早先开着的终端、已启动的 MCP):放行落地那一刻起它们整棵进程树都能写(E2、E7 已 exec 子进程)。它们在用户进入之前的写入不是这次打开动作引起的,没有可排的顺序。
- **换代中途。** 两代之间没有活着的引擎 ⇒ 放行跳过;新一代起来后已登记的目录要么已在 W1(真源随 tab 更新),要么咽喉换代重问时再放行(账本按代)。
- **幂等。** 每代账本只记成功;同代同目录不重复签发;重复消费无害。
- **失败。** 见 IPC 第 ②–⑤ 步;不重试、不换代;界面走 `grant-failed`;下一代 W1 自然含已登记且在 tab 里的目录。
- **数量。** 单进程第 2 589 次消费起 ENOMEM(E8,只是读数,不设产品上限);每代账本去重,用户一代里打开的项目数远低于此;真撞上时该目录走 `grant-failed`。
- **软链 / 大小写。** 签给真实路径、软链路径或大小写变形路径都能写;经放行目录里的软链跳到未放行目录仍 EPERM(E7)。写探针仍是「能不能写」的唯一裁判。
- **不收回。** 关掉项目在本次应用运行的任何一代都不撤销:令牌随引擎进程生命期,运行内可写历史并入之后每一代的 W1(§10 第 9 条)。

## 6. 架构落点

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| 绑定进程签发 / 消费两函数 | `packages/ui-mac/native/codepuppy-fence`(既有原生模块) | libsandbox(同一 dlopen 句柄)、mach `task_name_for_pid` | `codepuppy_fence.c` 的 `apply` 加载路径;`loadFenceAddon`(`process-fence-apply.ts:61`) |
| X1 / X2 与类名常量 | `packages/ui-mac/src/main/process-fence-profile.ts` | 无 | 唯一渲染点 `renderProcessFenceProfile`(`:138`) |
| 资格登记表、`workspace-open-record` 处理函数、真源过滤 | `packages/ui-mac/src/main/process-fence-workspaces.ts` | `process-fence-profile.ts` 的逐候选判定与本机判据 | 真源 tracker `bootFenceWorkspaceTruth`(`:170`)与检疫;`selectWorkspaceUnion` 规则 4/5/5b;`LOCAL_SIDECAR_SERVER_KEY`(`:215`) |
| `grant-write` 合同与 sidecar 消费 | 写探针合同所在处 + `sidecar.ts` 消息循环 | 原生模块 | `workspace-write-probe.ts:39-76`;`sidecar.ts:122-138` |
| 放行编排、账本、资格变化通知 | `server.ts` 监听器(请求簿)+ `ipc.ts` 处理函数 + preload | 上面三者 | `createWriteProbeRequester`(`server.ts:586`)、`listener.probeWrite`(`:707`)、`ipc.ts:94-98`、`:185-207` |
| `recordWorkspaceOpen`、缓存键、`whenSettled`、标记判定 | renderer `workspace-writable-core.ts` / `workspace-writable.ts` | preload | 既有咽喉(三个宿主) |
| 五个记录点(侧栏 `startChat` / `openSession`、chip `choose`、搜索 `go`、自动化历史 `openSession`);三个宿主的「开始工作」等待;只读胶囊 / 尾标 / 文案 | `codepuppy-sidebar.tsx`、`workspace-chip.tsx`、`codepuppy-session-search.tsx`、`automations/automation-panel.tsx`、`codepuppy-session-workspace.tsx`、`CodePuppyHome.tsx`、`codepuppy-new-session.tsx`、`session-workspace-shell.tsx`、`i18n` | renderer 咽喉核 | 既有 `useWorkspaceWritable`;P-15 枚举 |

- 新目录 / 新模块:无;`docs/architecture/modules.md` 的 `packages/ui-mac/` 行不变。
- 收敛:运行期放行与真源过滤消费同一份登记表;本机判据、规则 4/5/5b、类名各只有一份(K2)。
- 架构约束:不新增已知偏离。基线 I1 的措辞改为「装上之后只能经主进程签发、绑定当前引擎进程的私有类令牌加宽,且只加宽到用户本次运行亲手打开的本机项目」—— 授权来自 owner 2026-11-19 选第二条;同步更新 `docs/architecture/2026-09-09-req159-process-fence.md` §2/§7/§8.2 与基线 I1 的事实陈述,归实施方同一变更。
- 工程标准:无新配置;错误只进日志(结构化一行,不含令牌),呈现层只认 `reason` 枚举。
- 被否决的替代:
  - 第一条(空闲时自动换代):每次 1.2–6.4 s 整页重载(P-13),杀终端、断其它对话;第二条可行,owner 已选第二条。
  - 只禁 file 签发(送审稿 X2):通用扩展可自签并对任意路径放行(E5)。
  - 一刀切 `(deny file-issue-extension)` 不限类:会连带禁掉围栏内签发苹果自己那几类(推:LaunchServices 打开文件一类流程可能用到);限本类、五种操作一起禁已足够(E5)。
  - 规则认苹果的 `com.apple.app-sandbox.read-write`:任何别人签发的该类令牌都能放宽(E2 对照臂)。
  - 不绑进程的令牌(`issue_file`):可被复制、在新一代回放(E6)。
  - 以「页面当前目录」作为用户打开的证据(送审稿):改写会话目录 + 重载即可无手势获得资格(P-08、P-09)。
  - R1 的见证(咽喉核在新入口出现时采样 `navigator.userActivation.isActive`):激活是窗口级的限时状态,不绑定导航目标 —— 重载等待期间点一下启动遮罩(`codepuppy-app/src/app.tsx:587`),会话叶等目录解析完才挂载(`pages/session.tsx:240`、`:261`),被改写的目录就带着激活被登记;反过来,慢引擎让合法打开超出激活窗口而被判成「不是你打开的」(R2)。
  - 主进程监听窗口输入事件作见证:同样不绑定目标。
  - 一个所有打开动作共用的窄点:P-15 枚举证明不存在;改为 M1 + R1–R5 六处记录,加 V5 登记簿兜住新增调用点。
  - 由主进程代写、每项目一个引擎、每条命令外包新沙箱、把 W1 预放宽到代码根目录:理由同送审稿(面过大 / 嵌套 seatbelt 不可行 / 等于没有围栏)。
- 安全面:
  - **威胁边界。** 被围栏的引擎进程树(运行模型产生的代码与命令,能改引擎库、能向 LaunchServices 发 URL、能逼出崩溃自愈)一侧;主进程、renderer(既有信任,与 `store-set` 同级)、系统 UI 另一侧。
  - **规格里的安全承诺(逐字)。** SPEC-tool-write-fence BR-01:「工具派生进程越界写文件时会失败。」SPEC-child-process-write-fence BR-02:「MCP stdio 派生的进程越界写入失败,而不是静默成功。」BR-05(v2):「只有用户本人的打开动作能扩大可写范围；模型、对话里的命令、连接器进程和外部链接都扩大不了。」可写集成员身份由 U2 决定书 §4 第 3 条定义:「用户打开集合外的新文件夹 ⇒ **不换代、不阻止、如实告知**(§5),并把该目录写进集合,**下次启动即生效**。」⇒ 用户打开的项目本来就是集合成员,本设计把「下次启动」改成「当场」,并把「谁算用户打开」收紧为登记表。
  - **必须守住的不变量。** S1 只有主进程能签发本类令牌:围栏内五种签发方式、全部 flags 都签不出(E5);伪造令牌消费失败(E1);`update_file` 不能改指向(E5)。S2 X1 只认本类(E2、E5 旧接口行)。S3 令牌绑定当前引擎进程:复制回放、新一代、未围栏进程都消费不了(E6)。S4 资格只在 M1 与 R1–R5 这六个记录点、按该动作的具体目标目录登记为「本机引擎 + 目录」;咽喉与真源只消费;SSE、恢复、重载、自愈、重挂、深链接、检疫目录、引擎驱动的导航、自动调度的运行、任何 sidecar → main 消息、外部目录卡片批准都到不了记录点(P-15),不产生资格;远端会话不产生本机资格。S5 运行期放行只给已登记目录,真源也只收已登记目录 ⇒ 运行期从不比下一代 W1 能含的更宽(W1 的 K=32 / 字节封顶只是尺寸裁剪)。S6 HOME / 祖先 / `/` / 应用状态根相关目录永不登记。
  - **今天的同类洞一并关闭。** P-08 的「改写会话目录 → tab 写回 → 真源 → 逼自愈」与 E4 的「工具发深链接 → tab → 真源」两条链,都在真源只收已登记目录这一步断开。代价(spec v2「用户会碰到的限制」已写):只经外部链接到达、用户没亲手打开过的文件夹不自动可写,用「打开项目」选中即可。
  - **剩余风险。** R-a 用户点击落在模型布置的内容上(伪造的项目条目、会话行显示的目录本身被改写、W2 下自动化任务文件里的 `target.projectDir` 被改写):用户确有动作,目录来自点击那一刻列表里的引擎数据;与今天的真源同类,本设计不更宽(S5)。点击之后才改写的目录、发送后引擎替换的目录都不在登记表里,不放行。R-b 被围栏的工具经 LaunchServices 让未被围栏的应用替它执行(推,未实跑),与本设计无关的现有围栏缺口。R-c 已由测(编排者)覆盖到签名 + hardened runtime 的普通程序;真正的签名 Electron main → utilityProcess + 生产 `.node` 形态由实施入口闸证明(下)。R-d、R-e 已测(E8、E7)。R-f 活过**应用重启**的被围栏孤儿进程仍持有旧沙箱:新一次运行里用户重新打开一个该孤儿写得进、却不在新运行 W1 里的目录时,对它的签发可被该孤儿竞态(在签发那一刻把路径换成软链)。攻击者所得:令牌落在软链目标上,不经任何校验 —— 任意目录,包括主目录;签发后的路径断言只迫使它「换过去、再换回来」。关闭它需要「没有被围栏进程活过应用」(进程树生命期),不在本切片;同一次运行之内由运行内可写历史的携带,连同同一代里「送出但未得到确定回答、可能已被消费」的令牌也计为覆盖,一起消除(§10 第 9 条)。
  - **实施入口闸(第一步,未过不进行其余实施)。** G0:用发版命令签名(Developer ID + hardened runtime + 生产 entitlements)的真 Electron 主进程 fork 生产 utilityProcess sidecar,加载生产 `.node`、装生产 profile;sidecar 先起一个已 exec 并报 ready 的子进程;主进程按 sidecar pid 绑定签发、sidecar 消费;已有子进程与新子进程都写进目标;集合外与未放行目录 0 落盘;sidecar 内五种方式自签本类全被拒;复制的令牌在另一个进程消费失败。**G0 不过 ⇒ 第二条在出货形态上不成立:实施方返回 `BLOCKED: design — G0 — <失败臂与原文>`,由编排者带给 owner;不自行改走第一条。**
  - **实施必须拿出的证据(每条都要能失败)。**
    - AC-05:V3 真引擎 —— 打开一个不在 W1 的目录;放行前已开着的终端、已启动的 MCP stdio 子进程与之后的 shell 工具都写得进;把放行人为延迟到上限之内,第一条消息与第一个新终端都排在放行之后;引擎不换代、renderer 不重载、另一个对话里正在跑的回答不中断;对照臂不放行 → EPERM、0 落盘。V4 —— 同一代、同一 renderer 里先被拒(`not-opened-by-you`),再用选择器选中 → 不重载即写得进;**打开响应超过任何激活窗口也必须放行**:把 R1 的 `createSession` 应答与会话目录解析各人为延迟到 8 s 以上,目录照样当场可写、无标记(对照:去掉 R1 的记录调用 → `not-opened-by-you`);**自动化历史「打开会话」**:任务的项目 X 不在本次启动的可写集、本次运行也没经选择器选过,点「打开会话」→ 当场可写、无标记(对照:去掉 R5 的记录调用 → `not-opened-by-you`);同一任务的自动调度运行与历史加载不产生登记。
    - AC-06:V6a 可写路径上两个只读钩子缺席,全应用没有「重新启动 Code Puppy」按钮。
    - AC-07:V1 渲染出的 profile 逐行含 X1、X2(五个操作名);已知的坏:只禁 file 签发的 X2 下围栏内 generic 自签落盘(E5 左列)、去掉 X2 时 file 自签落盘(E1 `nodeny`)——两臂必须红。V2 在生产 profile + 生产 `.node` + Electron 内嵌 node 下逐臂跑 E5,预期按臂定(R2 修订):本类的有效签发 —— file ×4(含 `_to_self` / `_to_process` / `_by_pid`)、`related_file` 三种操作名、generic ×3、mach ×3、iokit ×3、除 0x1 外每个能签的 flag 位 —— 一律返回 NULL;保留接口与空能力结果 —— 旧接口 `sandbox_issue_fs_extension` / `sandbox_issue_mach_extension`(只发苹果类)与 `issue_file` flags 0x1(handle=0)—— 允许返回令牌;**所有臂**消费后集合外 0 落盘(实读磁盘);伪造令牌失败;已知的坏:不绑进程的令牌在第二个进程回放落盘(E6),绑定令牌同样回放 → EPERM。V5 间接链 —— 改写当前会话的 `session_v2.directory` 为 X、逼一次崩溃自愈与 renderer 重载 → X 不放行、0 落盘、真源不收 X;**重载等待期间用户在窗口里点别处(启动遮罩、侧栏非记录区域)也不放行 X**;同一流程不改写目录(诚实重载)→ 原目录照旧可写;用户刚点击过别处后工具发深链接打开 X → 不放行;远端会话的同名本机目录 → 不放行;sidecar → main 任一消息都走不到登记或签发。结构判据:一份导航 / 选择调用点登记簿(P-15 那张表的机器可读形态,按 `navigate(` / `hrefFor.*(` / `navigateTab(` / `startChat(` / `startDraft(` / `promoteDraft(` / chip `onSelect` 扫 `packages/ui-mac/src/renderer` 与 `codepuppy-app` 的已挂载上下文),每个调用点标 record / consume(restore / deep-link / engine / user-consume);新增未登记调用点 ⇒ 红;`recordWorkspaceOpen` 只许在 R1–R5 里调用、R1–R5 只许被登记的 DOM 事件处理 / 菜单命令引用,新增调用或引用 ⇒ 红;控制臂:把 `recordWorkspaceOpen` 加进一个 restore 类调用点必须红。
    - AC-08:V6b 三种情形各自到达那一句:主目录 / 状态根;深链接送来的目录(含之后用选择器选中即当场可写);放行失败两种注入 —— 原生异常(如 `task_name_for_pid` 失败)与请求簿超时 —— 都显示 `grant-failed` 那句,而不是无标记。

## 8. 拆分决定

不适用:全部在 alpha-code 一个仓、一个负责方。

## 9. 回滚

不适用:无数据迁移、无不可逆数据变更。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| 1. 选第二条:运行期以私有类沙箱扩展当场放行,不换代;第一条不实现、不作兜底 | E1–E8(测,`A`,macOS 26.3.1);owner 2026-11-19「如果第二条可行，就选第二条」 |
| 2. 私有类 `app.codepuppy.workspace-write`;X2 限本类、五种签发操作一起禁(R1 修订) | E2 对照臂;E5 |
| 3. 令牌绑定当前引擎进程(审计令牌,经 `task_name_for_pid` 取得),只走 `grant-write` 消息(R1 新增) | E6 |
| 4. 资格在 M1 与 R1–R5 六个记录点按动作的具体目标登记为「本机引擎 + 目录」;运行期放行与真源都只消费登记表;恢复 / 深链接 / 引擎驱动导航 / 自动调度到不了记录点(R2 修订替换 R1 的激活采样;R3 补 R5) | P-08、P-09、P-15;§4「记录点」 |
| 5. 顺序:选择器在返回前放行;宿主的「开始工作」动作等放行结束,上限 1 s;已在运行的工作靠放行落地后继承(R1 修订) | E7 已 exec 子进程;E8 签发耗时;§5 |
| 6. 「只读」胶囊与 chip 尾标退出常规路径;剩余三种情形各一句话;删除「重新启动 Code Puppy」按钮 | owner 2026-11-19「这个交互逻辑我觉得有点乱。我希望可以尽量用户无感」取代 2026-09-10 批准原文 `保留弹层里的「重新启动 Alpha」按钮`;spec v2 BR-04、BR-06 |
| 7. 失败独立上报:main 捕获原生异常与超时,`grant: "failed"` 不依赖探针答 `denied`;失败答案非终态,资格变化通知使缓存失效并重问(R1 修订) | P-09、P-11 |
| 8. 真签名 Electron 形态作为实施第一步入口闸 G0;不过则停,不改走第一条 | 编排者 R1 指示;R-c 已覆盖普通签名程序 |
| 9. 要不要签发由 main 的静态包含决定:本代 apply 的 profile 写块、本代放行、其它目录在途放行、本代送出却未得到确定回答(超时 / 子进程退出 / 投递异常)的令牌,加上**本次应用运行**里任何一代因用户打开而可写过的目录(运行内可写历史:每代 W1 与每次签发尝试,只在内存、不跨重启);落在其中永不签发,下一代 planner 把运行内历史并入 W1 候选(同样经 `stored` 校验);若 W1 封顶把它挤掉,答 `grant-failed` 那一句,不另加机制。剩余 R-f(活过应用重启的孤儿)见 §6 | orchestrator ruling after code review R3,2026-11-20(上一代的工具子进程在换代后存活,P-13) |

| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| R1 / `15a54fe1a6` / 全文(代码 `a20dadb942`) | Codex(GPT-6)只读审计,RECOMMEND FIX-THEN-MERGE;编排者全部采纳 | F1 [Blocker] 页面当前目录不能证明用户打开(改 `session_v2.directory` + 重载即无手势放行)—— 修 | §4 新增登记表与单一见证点(入口键 + 用户激活采样,冻结首次解析目录);重载 / SSE / 恢复 / 重挂只送 `open: false`;真源只收已登记目录;P-08 写明今天的真源有同一个洞并由共用判定关闭;证据要求 V5 | R-a(用户点击落在模型布置的内容上)留作剩余风险,§6 |
| 同上 | 同上 | F2 [Major] 运行期资格比 W1 宽(远端会话可放行同名本机目录)—— 修 | IPC 带 `server`;复用真源本机判据 `LOCAL_SIDECAR_SERVER_KEY`,远端 → `not-local`,不登记不签发不探;缓存键含 server;V5 远端用例 | — |
| 同上 | 同上 | F3 [Major] 选择器盖过深链接 / 检疫后不当场生效(同代缓存)—— 修 | main → renderer `WorkspaceWritableChanged`;tracker 丢缓存并重问;选择器在返回前登记 + 放行;V4 同代同 renderer「先拒后选」 | — |
| 同上 | 同上 | F4 [Major] 人与模型的延迟不是顺序保证 —— 修 | §5 O1/O2/O3:选择器返回前放行;宿主「开始工作」等放行,上限 1 s 与超限行为;已在运行的工作经 E7 证明放行后可写;V3 延迟放行用例 | — |
| 同上 | 同上 | F5 [Major] 失败到不了那一句(原生异常拒 IPC、超时答 unknown、缓存成无标记)—— 修 | 回答新增 `grant` 字段;main 捕获原生异常 / 超时 → `grant-failed`;标记判定一处;IPC 拒绝按 `grant-failed`;失败非终态;V6b 两种注入 | — |
| 同上 | 同上 | F6 [Major] E3 推不出 S1,未证令牌随代失效 —— 测并修 | E5:只禁 file 时 generic 自签落盘(洞),X2 改为五种操作;E6:不绑进程令牌可回放,改为绑定当前引擎进程,令牌不落日志 / argv / env / 磁盘;V1、V2 已知的坏两臂 | posix-ipc 本机无签发函数,只在 X2 里禁其操作名 |
| 同上 | 同上 | F7 [Major] E2 没测到已 exec 的终端 / MCP;R-c/R-d/R-e 未测 —— 测 | E7:已 exec 并报 ready 的子进程消费后可写(对照 0 落盘);软链 / 大小写两向可写,软链跳出负例 EPERM;E8:第 2 589 次消费 ENOMEM(只是读数);R-c 引用测(编排者)`rc-hardened/`;真签名 Electron 形态改为入口闸 G0 | G0 由实施方第一步跑 |
| R2 / `15a54fe1a6..cadd657d29` / R1 修订部分 | Codex(GPT-6)只读审计,RECOMMEND FIX-THEN-MERGE;编排者两项都采纳;F2–F7 与 G0 本轮未发现新缺陷 | R2-1 [Blocker] 窗口近期有输入不等于用户打开了该入口(重载等待期点遮罩即登记被改写的目录;慢引擎让合法打开超出激活窗口)—— 修 | 撤回激活采样与入口键;§4 改为在打开动作处登记:M1 + R1–R4,`workspace-open-record` 新通道,`WorkspaceWriteProbeRequest` 去掉 `open`;P-15 枚举全部导航 / 选择调用点并分类,引擎驱动的路径都不经过记录点;收窄认定为 M1 + R1–R4;V4「响应超过激活窗口仍放行」、V5「重载等待期点别处不放行」与调用点登记簿结构判据 | R-a(点击那一刻列表里的引擎数据本身被伪造)仍是剩余风险 |
| 同上 | 同上 | R2-2 [Major] V2「全部方式全 NULL」与 E5 自己的证据冲突(旧接口两类与 flags 0x1 返回令牌但不放宽)—— 修 | V2 逐臂定预期:本类有效签发被拒(NULL);保留接口 / 空能力结果允许返回令牌;所有臂消费后集合外 0 落盘 | — |
| R3 / `cadd657d29..c0706d75b4` / R2 修订部分 | Codex(GPT-6)只读确认:R2-1、R2-2 已修好,无新安全发现(四个 renderer 记录函数的现有引用都来自点击 / 回车处理;没有恢复、深链接或引擎事件调用方;`CODEPUPPY_OPEN_DIR` 仍只来自主进程启动环境);编排者采纳下列一项后冻结 | R3-1 [Major] 自动化历史「打开会话」(`automation-panel.tsx:817` → `:338`)是普通的用户打开动作却没有记录点,项目不在启动可写集时被判「不是你打开的」—— 修 | 新增记录点 R5(记录该运行所属任务的 `target.projectDir`,导航之前);P-15 分类、§4 记录点表、S4、R-a、V5 调用点登记簿(R1–R5)与 V4 一臂同步;自动调度与历史加载仍只消费 | — |

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| 路径含 `"` / `\` / 控制字符的项目让下一代引擎起不来 | `selectWorkspaceUnion` 不滤这类路径,`renderProcessFenceProfile` 遇到即抛(`process-fence-profile.ts:122-139`)⇒ 拒绝 fork(读,未实跑);令牌不经 seatbelt 字面量,运行期能放行这类目录,但下一代整个引擎起不来 | 现有缺陷,不由本方案引入;建议编排者按 External Bug 处理(规则 4 增加一条排除并出日志) | 立即(现存暴露) |
| 「访问项目以外的文件夹」批准后仍写不进 | 批准只放行引擎权限(P-14) | 请求由模型发起,不属用户亲手打开 | owner 若希望批准即可写,经 intent 提出 |
| 被围栏的工具经 LaunchServices 借未被围栏的应用执行(R-b) | 推,未实跑 | 与本方案无关的现有围栏缺口 | 编排者按 External Bug 或 INT-safety 处理 |
| 自动化面板选的项目不在 tab 里 ⇒ 不在 W1 | 选中时已登记并放行本代;之后换代是否可写取决于 tab(推,未核实) | 不在本增量的打开入口内 | 有自动化写盘失败的实例时 |
| 剩余情形里模型只拿到裸 EPERM | 模型无法向用户转述原因 | 用户侧已有一句话 | 有用户困惑实例时 |
| `issue_file` flags 0x1 在禁签发下仍返回令牌 | handle=0,写 EPERM(E5),不放宽 | 无影响 | 系统升级后 V2 矩阵出现落盘时 |


# v4 增量｜缓存、全局安装、批准文件夹与用户配置（#1759）

本增量状态为 **frozen**：除「待 owner 定（B1）」的 Homebrew 行外，其余决定、R1–R8 接缝与证明义务冻结。独立审查 R1（Claude Opus 5.5，审查版本 `b49fa26f93`）原结论 FIX-THEN-MERGE；本次按编排者逐项处置完成设计修订，收据与原 verdict 见 frontmatter 和本增量 §10，不把设计修订当成实现已通过。前文 v2/v3 的决定与 R1–R3 收据保留；其当时 frontmatter 收据为 `spec_version: 3`、`status: approved`、`review.rounds: 3`、`reviewed_sha: 8370b2fa23`、verdict「R1/R2/R3 findings all dispositioned and corrected, frozen by orchestrator 2026-11-19」。以下只替代明确点名的旧结论。**Homebrew 的行及其执行接缝单独待 owner 定（B1），不进入本次冻结域；其余决定不依赖 B1 的选择。**

## 1. 基线

- 批准输入：SPEC-child-process-write-fence v4，[提交 `9504dd7d9ab36b9ced3fdf70b355d1667685bf8d` 的 spec.md](https://github.com/impharaon/alpha%2Dcode/blob/9504dd7d9ab36b9ced3fdf70b355d1667685bf8d/docs/specs/child-process-write-fence/spec.md)（同目录 [当前规格](spec.md)）。覆盖 BR-05 修订、BR-07..BR-10、AC-09..AC-12、Windows 段及三条 v4 限制；其中 BR-09/AC-11 的 Homebrew 子项仅记录 B1，其他部分冻结。无新增用户限制，无旧记录迁移。
- 代码读码基线 `9f08c506d9842d319616c7e45c33d3b9c3279e48`。只核实本增量依赖的路径、审批、围栏接口；不重审旧扩展签发矩阵。
- 体验沿用批准卡片、命令/改文件工具和已有失败说明，不增加页面、开关、确认或设计稿。两层含义保持分离：权限档决定是否执行；围栏决定进程最终能写哪里。全局清单在三档间相同，不能靠进程级围栏替代引擎权限判定。
- 接续讨论 P-06..P-08 的模拟证据与既有 probe。该记录不是应用真入口的通过结论。#1760 消费本增量的包管理器位置契约，不再定义第二份 uv/npm 缓存目录。

## 2. 地面真相

首次调查只回答：缓存变量是否被工具读取；主进程怎样给已启动的进程树放行；审批与放行之间缺什么端口；Homebrew 增加目录后是否足够。续接复用 P01–P09 与已提交决定，只核实 U1 的变量读取、U2 的 Cargo 配置/凭据入口和 U3 的 pnpm shim 位置；取得小探针对照或确认需要整套工具链下载即停止。

| 编号 | 观察及证据 | 本增量依赖的结论 |
| --- | --- | --- |
| V4-P01（读） | `process-fence-profile.ts:57` 的 `WRITABLE_ROOT_IDS` 是写集合权威；`:215` 的 `renderProcessFenceProfile` 在 `:242` 放行真实 `~/.npm`，`:249-250` 放行真实 bun 缓存；`:252-260` 先 X1 后 CF/C1 | 只加环境变量仍留下旧缓存的写口；AC-09 还要求撤掉这些缓存放行，CF/C1 末尾拒绝块不能移动 |
| V4-P02（读） | `server.ts:563-564` 在 `createSidecarEnv` 后只补 `UV_CACHE_DIR=<userData>/uv-cache`；`:644` 计划 profile，`:683` 把 env 交 fork；`sidecar-env.ts:31-63,67` 只有系统基础键及四种前缀，没有通用包管理器前缀 | 新环境值在主进程白名单过滤之后统一注入，planner、fork 和连接器消费同一结果；不能给 `NPM_`/`CARGO_` 等整个前缀放行 |
| V4-P03（读） | `bootFenceWorkspaceTruth`（`process-fence-workspaces.ts:203`）持有登记表；`userOpened.register`（`:321-332`）按本机身份规范化后登记；`settle`（`:346-394`）仅消费登记资格，复用运行内历史和当前代静态覆盖判定 | 新批准源进入同一目录授权所有者，不能新写一份签发或路径判定 |
| V4-P04（读） | `server.ts:732-777` 的 `SidecarListener.grantWrite` 调 `FenceAddon.issueFileExtensionToProcess`（`:748`）；`sidecar.ts:157-163` 消费 `grant-write`，`applyProcessFence`（`process-fence-apply.ts:86`）先于引擎 import | 现有私有类、进程绑定、消费确认和整树继承可复用；没有“批准目录后调用主进程”的现成端口 |
| V4-P05（读） | `PermissionDialog.tsx:84-129` 是具体点击提交；`contract/receipts.ts:83,102-127` 的 `createReceiptLedger` 重读/校验指纹后调用 `ApprovalEngine.decide`；`opencode2/approvals.ts:90-108` 最后发 `api.permission.reply`；这些都未调目录授权 | **先回 permission 再补 grant 会有竞态**；普通 HTTP 回复、SSE replied 或模型声称“已批准”均不能产生主进程资格 |
| V4-P06（读） | `FileAccess.ExternalDirectoryAuthorization`（`packages/core/src/file-access.ts:26`）有 concrete `directory`；`resolve`（`:107-115`）得出文件所属目录；`authorizeExternal`（`:120-136`）对外只送 resources/save；`registerPolicy`（`packages/ext/src/policy/index.ts:190-224`）有 `permission.hook("evaluate")` | 审批目标要携带该具体目录，不能把 save 的较宽项目根或任意 glob 反解成授权目录；全部批准档需要为尚不可写的外部目标保留 BR-08 的一次本人批准 |
| V4-P07（测） | macOS Darwin `25.3.0`，临时目录 `fence1759-e3x4szm_`，空 HOME，bun 1.4.4、npm 11.20.0、pnpm 10.32.1、uv 0.11.0。`npm_config_cache=<T>/data/npm npm config get cache`、`npm_config_store_dir=<T>/data/pnpm/store pnpm store path`、`npm_config_cache_dir=<T>/data/pnpm/cache pnpm config get cache-dir`、`UV_CACHE_DIR=<T>/data/uv uv cache dir`、`PIP_CACHE_DIR=<T>/data/pip python3 -m pip cache dir` 全部退出 0，均报告指定目录（pnpm store 加 `/v10`） | 证明本机这些版本读取变量，不证明安装成功；未执行依赖下载 |
| V4-P08（测） | 真实 `/usr/bin/git config --global fence1759.sample literal+lock`，HOME 为 `realpath(mkdtemp())/home`；profile 为 `(allow default)(deny file-write*)` 加 `/dev/null`、`.gitconfig`、`.gitconfig.lock` 的 literal allow：退出 0；只撤 `.lock` allow：退出 255，`could not lock config file ... Operation not permitted`。临时根 `fence1759-git-8cqzv68_` | 文件清单必须包含工具实际原子写入所需的精确伴随文件。第一次使用未 canonical 的 `/var` 拼写失败；最终结论取 canonical `/private/var` 对照，不把别名失败写成 Git 不支持 |
| V4-P09（测+读） | 最小命令 `/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny file-write* (subpath "<T>/home"))' /usr/bin/sandbox-exec -p '(version 1)(allow default)' /usr/bin/true`：退出 71，`sandbox-exec: sandbox_apply: Operation not permitted`。本机 Homebrew commit `3e47189a707c739ee1278a28a3b845f5834574e6` 的 `formula_installer.rb:1233,1466-1468,1538` 对 build、linkage、postinstall 再调 Sandbox；`sandbox.rb:111-130` 的 `HOMEBREW_AVOID_NESTED_SANDBOXING` 在默认 prefix 或 admin/staff 等组拒绝，`:178-192` 的 inherited 检查要求 Homebrew 专用 FD | 只放开 Homebrew 写目录不足以完成 BR-09。最小探针已证明内核前提失败；真实 brew 安装失败的完整链仍是读码推断，本次未安装或修改 Homebrew |
| V4-P10（续接，测） | 临时 canonical 根 `fence1759-resume-bcqple0j`，空 HOME。`BUN_INSTALL_CACHE_DIR=<C>/bun/install-cache bun pm cache`、`npm_config_cache=<C>/npm/cache npm config get cache`、pnpm store/cache 键、pip/uv cache 及 `UV_PYTHON_INSTALL_DIR=<C>/uv/python uv python dir` 均返回指定路径、退出 0。Yarn Classic 1.22.22 的 `YARN_CACHE_FOLDER=<C>/yarn/cache node bin/yarn.js cache dir` 返回 `<C>/yarn/cache/v6`；Yarn 4.9.2 同时设置两键后 `config get globalFolder` 返回 `<C>/yarn/berry`，`config get cacheFolder` 返回 `<C>/yarn/berry/cache`。`BUN_RUNTIME_TRANSPILER_CACHE_PATH=<C>/bun/transpiler-cache bun <真实 Yarn Classic 的 bin/yarn.js> --version` 返回 1.22.22、退出 0，并生成两个缓存文件 | U1：本机变量读取已证；现代 Yarn 默认 global cache 优先的具体落点闭合，不能声称它落在 Classic 那一份目录；最终生产环境接线/lifecycle scripts 尚待实施证明 |
| V4-P11（续接，测+读） | pnpm 10.32.1，以公开 semver 7.7.3 的原始 tarball 执行 `pnpm add -g <semver.tgz> --offline --ignore-scripts`：退出 0，安装树 `<PNPM_HOME>/global/5`，根层 regular shim `<PNPM_HOME>/semver`；直接调用 shim 返回 1.2.3、退出 0。临时 HOME 内 deny file-write*，仅给 `subpath(PNPM_HOME/global)` 与 `regex("^<escaped-PNPM_HOME>/[^/]+$")` 放行，同命令退出 0；撤根层 regex 后退出 1，`The CLI has no write access to the pnpm home directory`，无 shim；往 `PNPM_HOME/store/negative` 写入退出 1、0 落盘。实际包的 bin 字段来自 registry tarball，未手写包格式。已安装 pnpm 的 `dist/pnpm.cjs:16757-16761,18810-18825` 也显示 globalDirRoot 为 PNPM_HOME/global、bin 取 global-bin-dir 或 PNPM_HOME | U3：固定的是安装位置的一级节点模式与 global 子树，不需要动态 bin 名单；递归 store 仍不在集合中。该探针不是生产 profile 或 Windows 的通过结论 |

| V4-P12（R1，读+测） | 当前 `ShellTool.prepare`（`packages/core/src/tool/plugin/shell.ts:115-125`）只解析 cwd/cd 的外部目录；`pty.ts:169` 在 spawn 后加 -l。`shell-env.ts:51-57,92,102` 与 `shell-env-cache.ts:93-103` 都直接 spawn 用户 shell；`server.ts:438-462` 合回环境，`shell-env-cache.ts:25-37` 未排除 XDG 根。pnpm 的 `switchCliVersion`（本机 `pnpm.cjs:201127-201143`）安装到工具根 `PNPM_HOME/.tools`（`:180533`）。临时 HOME 中，pnpm 10.32.1 对 `pnpm_config_store_dir` / `pnpm_config_cache_dir` 的查询回到原 store / undefined；换为 npm 前缀即报告指定 C；npm 11.20.0 的 `config get cache` 对三键各报一条 Unknown env config，退出 0 | R1-F4..F8/P0 的实际入口前提；不能声称任意 -g prefix 自动问目录、PTY rc 仍受 spawn 前变量约束、或 npm 安装配置路径无噪声。官方 [pnpm 配置](https://github.com/pnpm/pnpm/blob/main/pnpm/docs/configuring.md#environment-variables) 的专用前缀与宿主实测差异明确记录 |
| V4-P13（R1，测） | 临时 HOME 中 `bun <T>/identity.ts` 直接 import 本仓 `checkWorkspaceDirectory`；正常 `~/.bun/bin` 返回 eligible:true，改成指向测试 HOME 的软链后返回 eligible:false / home-or-app-state，两臂进程退出 0。另用真实 `stat`：原本指向 chosen-A 的合法目录软链可解析；显示后改指 chosen-B，跟随链接的 dev+ino 对比为不同 | 既有排除可合法复用；目录软链本身不等于不合法，点击时必须核对所显示身份。未声称 R7 真源或 R4 IPC 已实现 |
| V4-P14（R1，测） | 临时 HOME 的 `.zshrc` 尝试写入一个测试围栏外目录，并 export XDG_CONFIG_HOME 指向假工作区。`/bin/zsh -il -c 'printf ... "$XDG_CONFIG_HOME"'` 在 open 臂落盘；以 `/usr/bin/sandbox-exec -p <小型测试 profile>` 先围栏再 exec 时，写入 EPERM、0 落盘，但仍输出假 XDG 值；两臂 shell 退出均为 0 | 只看 rc/探针退出 0 不足以证明安全；同一生产写围栏与可信根消费固定必须同时接线。小 profile 不替代 R8 正式入口证明 |

R1 的上述探针只用本机工具与临时根 `/private/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/fence1759-r1-g6wb_kqb/`，不运行用户真实 rc、不读出或记录秘密，不下载包、不运行应用；版本管理器布局仅查其官方文档/源码。P13/P14 的文件与 shell 输入就是本机实际目录、软链和命令，不是另一系统格式的手写替身。

续接探针只下载三个公开 npm 小包：`semver@7.7.3`（28,442 bytes）、`yarn@1.22.22`（1,238,429 bytes）、`@yarnpkg/cli-dist@4.9.2`（1,066,119 bytes），元数据来自 `https://registry.npmjs.org/<包>/<版本>`，归档用其中 dist.tarball、原样解包后调用其真实 CLI；没有执行它们的安装脚本。semver tarball SHA-256 为 `b49572086d1e04c9a014cafc232685cc74570320d4e7091c2e30a7138c8522bd`。原始 `results.json`、`fenced-results.json`、`bun-runtime.json` 和逐命令 logs 留在本机 `/private/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/fence1759-resume-bcqple0j/`，非仓内交付物。Go/Cargo/rustup/Yarn 不在本机 PATH；已知 Cargo/Rustup 与此前 probe 的工具缓存也未找到 Go/Cargo。Yarn 已用上述小包完成本次所需探针；Go/Cargo 不下载整套工具链，U1/U2 的真实工具验证按续接 brief 记为实施阶段义务。P09 沿用，不重复调查或运行 Homebrew。

P07–P09 均用 `python3` 的 `tempfile.mkdtemp`、`subprocess.run(env=空主目录环境, capture_output=True, timeout=5)`；没有运行应用、Electron、系统选择器，没有真实主目录写入、秘密采样或包下载。P09 用的是另一种 profile 的嵌套，未重复旧设计已证明可重用的同字节策略。

外部工具定义取官方资料（2026-11-26 读取；只能支持变量与布局，不替代产品证据）：[Bun 缓存](https://bun.sh/docs/pm/global-cache)、[Bun 全局目录](https://bun.sh/docs/runtime/bunfig)、[Bun transpiler 缓存](https://bun.sh/docs/runtime/environment-variables)、[pnpm store](https://github.com/pnpm/pnpm/blob/main/pnpm/docs/settings/store.md)、[pnpm 其余目录](https://github.com/pnpm/pnpm/blob/main/pnpm/docs/settings/other.md)、[Yarn Classic 缓存](https://classic.yarnpkg.com/en/docs/cli/cache/)、[Yarn Classic 全局](https://classic.yarnpkg.com/en/docs/cli/global/)、[Yarn 现代版配置](https://yarnpkg.com/configuration/yarnrc/)、[npm 布局](https://docs.npmjs.com/cli/v9/configuring-npm/folders/)、[pip 缓存](https://pip.pypa.io/en/stable/topics/caching/)、[uv 存储](https://docs.astral.sh/uv/reference/storage/)、[Go 目录](https://pkg.go.dev/cmd/go)、[Cargo 环境](https://doc.rust-lang.org/cargo/reference/environment-variables.html)、[cargo install](https://doc.rust-lang.org/cargo/commands/cargo-install.html)、[Python 用户目录](https://docs.python.org/3.13/library/site.html)、[Git 全局配置](https://git-scm.com/docs/git-config)、[Homebrew 环境](https://docs.brew.sh/Manpage)。Go/Cargo 与 Windows 的完整行为仍属文档依据/设计决定；Yarn 本次只实测 P10 的环境查询，未声称其完整安装已通过。

## 4. 接口契约

### 4.1 单一位置权威与环境

`process-fence-profile` 继续持有固定写集合、模板和 `WRITABLE_ROOT_IDS`。增加以下**已决定的新端口 R1**（尚不存在），由主进程在白名单过滤之后调用一次；不建立新配置系统、不运行未围栏的包管理器来探测配置、不更换 HOME 或整组 XDG 根。

```ts
type PackageManager = "bun" | "pnpm" | "yarn" | "npm" | "pip" | "uv" | "go" | "cargo"
type PackageManagerPlatform = "darwin" | "linux" | "win32"
type PackageManagerLocationInput = {
  platform: PackageManagerPlatform
  home: string
  userDataPath: string
  configHome: string
  appData: string       // 主进程取得的 roaming/config 基目录
  localAppData: string  // 主进程取得的 local/cache 基目录
  goInstallBin: string | null // v4.2：注入前 Go 原生有效安装目录；null 表示未取得
  bunInstall: string | null   // v4.3 F-b：用户可信环境快照中的 BUN_INSTALL；未设为 null
  xdgCacheHome: string | null // v4.3 F-b：用户可信环境快照中的 XDG_CACHE_HOME；未设为 null
}
type PackageManagerLocations = {
  env: Readonly<Record<string, string>> // 只能包含下表列出的固定键
  writable: readonly {
    manager: PackageManager
    rule: ProcessFenceWriteRule // 复用现有 literal/subpath/regex + value 形状
    purpose: "cache" | "global-install"
  }[]
}
function resolvePackageManagerLocations(input: PackageManagerLocationInput): PackageManagerLocations
```

所有输入必填、无任意位置覆盖选项；除 goInstallBin 按 v4.2 原生查询取得（可为 null）、bunInstall/xdgCacheHome 取自用户可信环境快照（未设为 null，不读应用自身为子进程改写的值）外，路径输入来自主进程已有系统路径权威，必须为绝对路径。`ProcessFenceWriteRule` 复用 `process-fence-profile.ts:313` 的现有形状；literal/subpath 的 value 是绝对路径，regex 的 value 是以已转义绝对根锚定的模式。Homebrew 未进入本冻结函数的 manager 值域，也不产出 env/writable；其余八种工具和 #1760 不等待该值域扩展。`C=<userDataPath>/package-managers`；cache/global 的路径先规划并 canonical 化，父目录由现有 planner 的 `mkdirp` 端口预建（不能靠围栏内 `mkdir` 去建立尚不可写的祖先）。CF/C1 与其真实目标、via/祖先冻结规则照旧优先；碰到保护位置不转成新可写根。main 的纯解析函数只产路径、不读用户配置或秘密、不执行工具。

| 工具 | 缓存/辅助数据：固定注入的键和值 | 全局安装决定 |
| --- | --- | --- |
| bun | `BUN_INSTALL_CACHE_DIR=C/bun/install-cache`；`BUN_RUNTIME_TRANSPILER_CACHE_PATH=C/bun/transpiler-cache` | **v4.3 F-b**：按 Bun 自身算法求用户真实根 `B` = bunInstall 已设取之，否则 `<xdgCacheHome>/.bun`，否则 `~/.bun`；只允许 `B/install/global` 和 `B/bin`，经 R7 绑定。不以 `BUN_INSTALL` 重定向整个 Bun 安装；用户未设 BUN_INSTALL 而应用自身为子进程设置了会移动 Bun 根的变量时，围栏子进程得到 `BUN_INSTALL=B`（还原真实位置，同 GOBIN 模式） |
| pnpm | store/cache/state 三键各同时投影 `pnpm_config_<name>_dir` 与 `npm_config_<name>_dir`，值同为 `C/pnpm/<name>`；命名噪声见下文 | 用真实平台 PNPM_HOME（下表）；global packages 与 bin 在它之下。仅设置固定 `PNPM_HOME`，不把 store 顺带留在 PNPM_HOME |
| yarn | `YARN_CACHE_FOLDER=C/yarn/cache`；现代版另设 `YARN_GLOBAL_FOLDER=C/yarn/berry`，默认 enableGlobalCache 下实际 cacheFolder 为 `C/yarn/berry/cache`，其 metadata/mirror 也留在 C（P10 实测） | Classic 的 global packages 在平台全局目录，bin 在固定 prefix/bin。现代 Yarn 没有 Classic `global add`；不虚构一个命令，BR-09 的该命令用 Classic 语义 |
| npm / npx | `npm_config_cache=C/npm/cache`（包括 `_npx`、logs） | 真实 prefix 的 `lib/node_modules`、`bin`（Windows 为 prefix 下 `node_modules` 和 shim）；不重定向用户全局安装到 C |
| pip | `PIP_CACHE_DIR=C/pip/cache` | 虚拟环境仍在项目；`--user` 写 Python 实际用户安装目录，缓存与其分开 |
| uv | `UV_CACHE_DIR=C/uv/cache`；`UV_PYTHON_INSTALL_DIR=C/uv/python` | `uv tool` 的真实用户 tools/bin（下表）；连接器专用安装由 #1760 消费本端口派生的 C/uv，不另放一份 HOME 缓存 |
| go | **v4.2 取代旧决定**：`GOPATH=C/go/gopath`、`GOMODCACHE=C/go/mod`、`GOCACHE=C/go/build`；sumdb 的 latest 因而也留在 C。GOPATH/GOBIN 成对注入，见文末 v4.2 | `GOBIN=goInstallBin`（v4.3 F-a：仅用户未显式设置 GOBIN 时注入），保留重定向前的原生安装目录；默认仍为 `~/go/bin`。只用既有 bin/项目/批准规则判写，不放开原 GOPATH 或其 pkg/sumdb |
| cargo | **v4.1 / spec v6 取代旧决定**：R1/R2 不再注入 CARGO_HOME，Cargo 原生使用真实 `~/.cargo`；仅放行下文 v4.1 的缓存/锁精确表。project `target` 及配置中的路径不改 | `CARGO_INSTALL_ROOT=~/.cargo`，实际写入只含 `bin`、`.crates.toml`、`.crates2.json`；RUSTUP_HOME 不重定向、不把整棵 `~/.rustup` 加入写集合 |
| Homebrew | **待 owner 定（B1）**；本次不确定其环境或执行方式 | **待 owner 定（B1）**；不产出 allow 清单，不影响其余行 |

这些值是应用进程树的默认环境，不是命令黑名单；用户明确命令参数或项目配置仍按工具自身优先级解释，最终落盘受同一写集合约束。**已决定的新端口 R2**：shell、PTY、MCP、LSP 的 spawn 环境合成消费 R1 的相同 `env`，在该次 spawn 前只覆盖表内缓存键及为保留安装位置而配套的 GOBIN（v4.2）与 BUN_INSTALL（v4.3 F-b，仅上表条件成立时）；不会清空用户 PATH、代理、registry 或凭据，不修改机器上的 rc/npmrc。**残留事实（R1-F6）**：PTY 在 spawn 后以 `-l` 运行用户 rc（`packages/core/src/pty.ts:169`），rc 后续 `export GOMODCACHE=...` 等仍能覆盖默认缓存键；Cargo 不再承诺迁入 C，见 v4.1；R2 不能在 exec 之前约束之后执行的 shell 代码，不宣称这种路径满足“缓存始终在 C”。不改 rc、不拦命令、不要求用户多做一步；真实入口证据分别报告默认路径与 rc 覆盖路径的结果。

**pnpm 通道（R1-F7）**：现行官方配置文档使用 `pnpm_config_*`；本机 pnpm 10.32.1 的实际同名查询忽略该前缀，而读取 `npm_config_*`（P12）。因此三对固定同值键由 R1 同时产生，无版本探测、切换或配置选项。npm 对 pnpm 专用前缀没有该噪声，但 npm 11.20.0 在实际读取配置时会对另三键逐项输出 `Unknown env config`，三条警告明确接受并保留，不称作无噪声；不把“--version 没有警告”当成安装路径的证据。真实入口必须核对缓存落点与这些警告，不通过压 stderr 隐藏。

缓存迁入 C 后撤掉真实 HOME 的 W7、W17、W18 放行（保留历史编号，不复用）；W8 历史文件不在本次改变内。旧缓存不拷贝、不删除、不热身下载。C 已在 W3 下；无须把整个应用状态根放开。

**v4.1 撤销 Cargo 读取桥决定。** 真实 Cargo 证明配置软链改变相对路径基准；include/按项目生成副本也不能覆盖已运行 shell 的跨目录行为。依据 SPEC v6 BR-07/AC-09 与 U-40，不重定向 CARGO_HOME，不为 config/config.toml 或 credentials/credentials.toml 建桥、复制、include 或翻译；让 Cargo 在原位置自行选择、合并并读取。配置写入仍归 §4.3，凭据不因缓存例外增加写 allow，CF/C1 与真实目标保护照旧。取代范围、精确缓存表及 U2 证据见文末 **v4.1 增量**。

### 4.2 全局安装固定表

固定表（Homebrew 的 B1 行除外）是 R1 的组成部分，和 profile 同一个 owner；renderer、ext、#1760 不复制表。表列目录是包管理器安装树，**不是** HOME、`~/.config`、`~/.local`、`/usr/local` 或 `/opt/homebrew` 的整根放行。无版本上限；Python 的版本目录由其既有平台布局匹配，不钉死本机 3.9。

| 工具 | macOS / POSIX 固定路径模板（默认 subpath；点名文件为 literal；pnpm 根层使用下文固定 regex） | Windows 等价位置（仅环境/权限语义，不渲染 seatbelt） |
| --- | --- | --- |
| bun | `B/install/global`、`B/bin`；`B` = `BUN_INSTALL` ‖ `<XDG_CACHE_HOME>/.bun` ‖ `~/.bun`，取用户可信环境快照（§4.1，v4.3 F-b） | `%USERPROFILE%/.bun/install/global`、`.bun/bin` |
| pnpm | macOS `~/Library/pnpm/global`、`~/Library/pnpm/bin`、`~/Library/pnpm/.tools` 与 PNPM_HOME 根层节点固定模式；Linux `~/.local/share/pnpm` 同形；`.tools` 供 switchCliVersion 安装项目钉住的 pnpm，缓存仍由显式键到 C（P11/P12） | `%LOCALAPPDATA%/pnpm/global`、`pnpm/.tools`、PNPM_HOME 的 shim/bin |
| yarn Classic | `~/.config/yarn/global`（macOS/Linux）；`~/.yarn/bin`；prefix/bin 采用 npm 的固定 prefix 族及下文版本管理器模板 | `%LOCALAPPDATA%/Yarn/config/global`、`%LOCALAPPDATA%/Yarn/bin` |
| npm | prefix 族 `/opt/homebrew`、`/usr/local`、`~/.npm-global`、`~/.local` 各自的 `lib/node_modules`、`bin`，以及下文版本管理器的固定模板；另含安装元数据，prefix 自身不整体放行 | `%APPDATA%/npm`（node_modules 和 `.cmd`/`.ps1`/无后缀 shim） |
| pip --user | `~/Library/Python`（macOS framework）；`~/.local/lib/python*` 的 Python 用户安装树及 `~/.local/bin`（POSIX non-framework）；不得放开整个 `~/.local/lib` | `%APPDATA%/Python/Python<version>/site-packages` 与 `Scripts` |
| uv tool | `~/.local/share/uv/tools`、`~/.local/bin`；受管 Python 在 C/uv/python | `%APPDATA%/uv/tools`、用户 executable 目录；由 R1 用官方平台路径规则落成，不按盘符猜 |
| go | `~/go/bin`；用户指定且本来已可写的 GOBIN 不额外扩权 | `%USERPROFILE%/go/bin` |
| cargo | `~/.cargo/bin`；`~/.cargo/.crates.toml`、`~/.cargo/.crates2.json` 及 cargo 实际使用的同名原子写入伴随文件 | `%USERPROFILE%/.cargo` 下同样的 bin/安装元数据；缓存按 v4.1 使用真实 Cargo Home |
| Homebrew | **待 owner 定（B1）**；全局位置及执行方式均不由本次决定 | Homebrew 无 Windows 原生对应；不引入另一种系统包管理器 |

固定表以模板覆盖版本管理器的同类全局位置，供 npm 与 Yarn Classic 共用：`H` 为可信 HOME，`V=[^/]+` 为一个版本目录分段（不设版本/条数上限）；模板中的根先由 R7 按具体目录绑定，之后才渲染锚定根的 regex，不能把未经验证的 realpath 接进模板。

| 管理器 / 官方布局 | 固定模板（POSIX；regex 展开后以 `^` 锚定，安装子树以 `(/.*)?$` 收尾） |
| --- | --- |
| nvm | `H/.nvm/versions/node/V/{lib/node_modules,bin}`；XDG 默认根 `<configHome>/nvm/versions/node/V` 同形；不放开 nvm 整根 |
| fnm | `H/Library/Application Support/fnm`（macOS）、`H/.local/share/fnm`、`H/.fnm` 下的 `node-versions/V/installation/{lib/node_modules,bin}`；不把 multishell 软链当新 prefix 授权 |
| volta | `H/.volta/tools/image/node/V/{lib/node_modules,bin}`；Volta 接管包安装还使用 `tools/image/packages`、`tools/user/packages`、`tools/user/bins`、`tools/shared`、`bin`、`tmp`、`log` 的安装树/元数据/暂存位置（均在 `H/.volta` 下，分别列规则，不开放整根与 cache） |
| asdf | `H/.asdf/installs/nodejs/V/{lib/node_modules,bin}`；`H/.asdf/shims` 是全局可执行入口 |
| mise | `H/.local/share/mise/installs/node/V/{lib/node_modules,bin}`、对应 `shims`；目录别名先通过 R7 绑定真实安装目标，不泛放 installs 根 |

布局依据：[nvm 的 NVM_DIR/NVM_BIN](https://github.com/nvm-sh/nvm#environment-variables)、[fnm 目录选择](https://github.com/Schniz/fnm/blob/master/src/directories.rs)、[fnm installations_dir](https://github.com/Schniz/fnm/blob/master/src/config.rs)、[Volta v4 位置权威](https://github.com/volta-cli/volta/blob/main/crates/volta-layout/src/v4.rs)、[Volta 包安装](https://github.com/volta-cli/volta/blob/main/crates/volta-core/src/tool/package/install.rs)、[asdf 数据根](https://asdf-vm.com/manage/configuration.html)、[asdf shims](https://asdf-vm.com/manage/versions.html#shims)、[mise 目录](https://mise.jdx.dev/directories.html)。这是读取官方布局后的决定，尚未实跑这些管理器；Windows 仍只作原生布局/权限语义验收，不把 POSIX regex 搬到盘符路径。

**更正 R1-F5**：不再声称“任意未列出的全局 prefix 会触发文件夹批准卡片”。`ShellTool.prepare`（`packages/core/src/tool/plugin/shell.ts:115-125`）只为 cwd/cd 解析到的目录调用 `authorizeExternal`，没有分析 `npm -g` 的实际写目标。表外路径保持既有围栏结果；已打开/已批准范围照常有效，本设计不新增 shell 的 prefix 识别机制、不新增询问或禁止自定义 prefix 的规则。上述固定模板覆盖已知默认布局；其真实调用仍须证明。

pnpm 的固定位置还包括 `subpath(PNPM_HOME/.tools)`（R1-F4；实际 `switchCliVersion` → `installPnpmToTools`，`pnpm.cjs:201127-201143`，工具根 `:180533`）。根层 shim 保留 P11 的一级节点 regex；递归 store/cache/state 没有相应 allow。主进程预建 PNPM_HOME，R7 绑定每个安装目录，不能用 `PNPM_HOME/**` 替代。`/opt/homebrew` 在 npm prefix 族里只是现有 Node 布局，不依赖 B1。

### 4.3 用户配置固定表与拒绝优先级

**已决定的新端口 R3**：在同一个 profile 权威内增加 `userConfigurationLocations(input: PackageManagerLocationInput): readonly ConfigFenceRule[]`，只输出下表的写 allow 条目（类型复用不等于把用户文件加入 CF 拒绝集）。该入口和 R1 共同提供给引擎策略作“常规用户位置”识别；不能借此自动批准包含该文件的整个父目录。环境里不增加位置开关。

| 类型 | POSIX（按实际 HOME/configHome） | Windows |
| --- | --- | --- |
| Git | `~/.gitconfig`、`<configHome>/git/config`，以及精确 `.lock` 伴随文件 | `%USERPROFILE%/.gitconfig`、Git for Windows 的 XDG config/git/config，同样的锁文件 |
| shell | `~/.zshenv`、`.zprofile`、`.zshrc`、`.zlogin`、`.zlogout`；`~/.bashrc`、`.bash_profile`、`.bash_login`、`.bash_logout`、`.profile`；`<configHome>/fish/config.fish`、fish/conf.d 下启动脚本 | PowerShell 的 CurrentUserAllHosts/CurrentUserCurrentHost profile（WindowsPowerShell、PowerShell 的 Documents 位置取系统已解析 Documents，不假设其没有重定向）；Git Bash 使用左列 HOME 文件；cmd 的 AutoRun 是 registry，本规格不引入 registry 写端口 |
| 常用开发工具 | `~/.npmrc`、`~/.yarnrc`、`~/.yarnrc.yml`、`~/.bunfig.toml`；`<configHome>/pip/pip.conf`、`~/.pip/pip.conf`、macOS `~/Library/Application Support/pip/pip.conf`；`<configHome>/uv/uv.toml`；`~/.cargo/config`、`~/.cargo/config.toml`；平台 Go 用户配置文件（macOS `~/Library/Application Support/go/env`，Linux `<configHome>/go/env`） | `%USERPROFILE%` 下 npm/yarn/bun 配置；`%APPDATA%/pip/pip.ini`、`%APPDATA%/uv/uv.toml`、`%APPDATA%/go/env`、`%USERPROFILE%/.cargo/config(.toml)` |

父目录由 main 预建；现有文件软链按真实目标落规则，同时保护路径绑定，不能因链接目标是引擎配置而放宽 CF/C1。文件写入包含原地修改及生产改文件工具实际采用的原子替换伴随名；Git 的 `.lock` 已由 P08 证实，其他工具的伴随名在真实入口证据中确定，不能为方便加 `~/.gitconfig*` 或 HOME 全局临时文件通配。第三方编辑器自己的备份约定不自动扩大这张固定表。

CF/C1 的权威仍为 `configFenceLocations`（`process-fence-profile.ts:122`）、`planConfigFence`（`process-fence-plan.ts:83`）、`planCredentialStores`（`process-fence-plan.ts:314`）和现有 credential stores 生产者；任何 cache/global/user-config allow 与 X1 之后，保留 `renderConfigFence`/`renderCredentialFence` 的原拒绝、真实目标与祖先节点规则。应用/引擎配置不进 R3；`~/.opencode`、`~/.zsh_sessions`、`~/.zcompdump*` 继续受既有保护。凭据保护指 Code Puppy 保存的凭据，不把整份用户 `.npmrc` 擅自列成不可写；向模型输出秘密的问题归对应规格。

### 4.3.1 固定位置的身份真源（R1-F1，新增端口 R7）

R1/R3 只定义候选；**main 每次规划先过 R7，再把已核验目标交给 profile**，不直接 realpath 后放行。R7 属现有围栏 planner/真源所有者，复用 `checkWorkspaceDirectory`（`process-fence-profile.ts:589`）排除目录真实目标为 HOME/祖先、应用状态根及其相关目录、受保护配置目录。literal 用户文件不把其父目录授予写权限：`~/.zshrc` 可以是 literal，不能因其父级是 HOME 而误拒正常文件编辑。

```ts
type WritableLocationTruth = {
  v: 1
  entries: readonly {
    sourcePath: string // R1/R3 固定候选的绝对写法，含具体版本目录；不可由 renderer 提供
    targetPath: string // main 第一次规划记录的 canonical 目标；后续不重指
    kind: "directory" | "file"
  }[]
}
function planWritableLocations(input: {
  candidates: readonly { sourcePath: string; kind: "directory" | "file" }[]
  truthPath: string
  eligibility: WorkspaceDirectoryInput
}): { locations: WritableLocationTruth["entries"]; excluded: readonly string[] }
```

该函数是**已决定 raise**，内部文件 I/O 仍在 main 的现有 planner/真源端口，不引入 renderer/sidecar 写面。真源为 `<casBaseRoot>/fence-workspaces/<env>-write-locations.json`，与现有 `<env>.json` 同级，整个目录在 CF-1 之下；复用 `fenceWorkspaceTruthPath` 的根（`process-fence-workspaces.ts:50`）与 `writeWorkspaceTruth`（`:113`）的 main 独占、临时文件+rename 写法，数据格式用上面的独立 schema，不改变 workspace 真源。字段必填，路径为绝对路径，按 sourcePath+kind 唯一；只收本轮固定候选，目录须通过上述既有排除，文件保留 CF/C1 最终拒绝优先级。真源不放用户数据/秘密、不靠 electron store；运行期消息不能增删记录。

首次规划在任何 v4 围栏树/探针开始之前：这些新放行的真实全局目录及用户配置此前不在可写表，main 把首次合法 realpath 目标写入真源后才能使用。缺失的目录由 main 在已核验父级下预建；缺失文件只记录“canonical 父级+文件名”的计划目标，不预写用户文件，不能等工具先建出软链再采信。后续规划无论来自重启、背景刷新或引擎换代，只接受当前解析仍等于首次 targetPath 的条目；后改的软链目标既不跟随，也不覆盖真源记录，仍保留合法的首次软链位置能力。文件正常原子替换不要求沿用旧 inode：固定真源绑定的是目标路径，不是把用户文件钉死在同一个 inode。

C 及 C 下每个实际发出的写规则同样经过 R7；由于 W3 本来可写，不能对 C 使用“此前不可写”的信任推断：main 固定其 app-data 锚、先核验 C/父级与目标仍在该锚下，再预建并记录，不能从已可写 W3 下的软链追到锚外。所有 regex 先按固定模板列出/准备具体安装根并绑定其真实目标，再在绑定根下展开后缀；不把任意新 realpath（如 HOME）变成 regex 根。真源写失败不使用尚未记录的新放行，读坏/读失败不从当前可写磁盘重建首次身份，走既有规划失败/日志路径；没有弹窗、确认、迁移或兼容分支。P13 已验证既有目录排除能挡 HOME；R7 持久化及重启接线仍由实施在真实 planner 证明。

### 4.4 本人批准目录：同一个登记与签发所有者

v4 替代前文「外部目录卡片批准永远不能登记」以及 S4 的“六个记录点”穷举；**新增一个明确的人类动作来源**，不把导航、SSE、命令或普通 permission reply 变成授权来源。X1 私有类及绑定当前引擎的签发、原生消费、运行内历史不变。

**已决定的新端口 R4**：现有审批卡在呈现时经 preload 只读请求 main 解析目录，显示**实际将授予的 real path**，可同时标明原始写法；点击继续使用同一个按钮，不因目标是合法软链而拒绝。

```ts
type DirectoryAccessTarget = {
  absolute: string // FileAccess.Target.absolute，文件或目录本身
  directory: string // FileAccess.externalDirectory.directory
}
type DirectoryAccessDescription = {
  snapshotID: string
  targets: readonly {
    absolute: string
    realTarget: string
    directory: string
    realDirectory: string
    dev: string // stat 跟随链接后的十进制 BigInt 字符串
    ino: string
  }[]
}
function describeDirectoryAccess(input: {
  server: string; sessionID: string; requestID: string; requestFingerprint: string
  targets: readonly DirectoryAccessTarget[]
}): Promise<DirectoryAccessDescription>
type DirectoryWriteApproval = {
  server: string; sessionID: string; requestID: string; requestFingerprint: string
  decisionID: string; decision: "once" | "always"
  snapshotID: string // main 发给正在呈现的卡片，身份事实由 main 留在内存
}
type DirectoryWriteApprovalResult =
  | { outcome: "granted" | "no-fence" }
  | { outcome: "conflict" | "expired" }
  | { outcome: "failed"; reason: "home-or-app-state" | "protected-config" | "grant-failed" }
function approveDirectoryWrite(input: DirectoryWriteApproval): Promise<DirectoryWriteApprovalResult>
```

所有字段必填，数量无上限。description 只读，不 mkdir、登记或签发；main 对正在呈现的已核验请求保存原路径、realDirectory 的 dev+ino 与 renderer/代际绑定，renderer 不能自行补一个未显示的目标。对缺失目录，main 只读记录最深存在祖先的 realpath/dev+ino 及待创建后缀，显示预计真实目标；批准时先核对同一个祖先，再准备准确目标，不能授予更宽祖先。snapshotID 复用请求生命期、不新增有效时限。

点击时 main 重解析原路径，realDirectory 的 dev+ino（缺失目录为该存在祖先的身份）与显示快照不一致 ⇒ `conflict`，不登记、不 mkdir、不签发，沿既有冲突刷新卡片；合法软链目标未变则照常批准（R1-F2，P13）。`current`/fingerprint 的既有冲突/过期检查同样先于任何写动作；idempotency 仍用 decisionID。**先比对显示身份，再登记资格，等 tracker.grantWrite 消费成功，最后才由原 ApprovalEngine.decide 回复 allow**。reject 不调用 R4，no-fence 不伪造 grant。主进程批准结果绑定当时本机引擎代际，sender 只允许现有应用 renderer 的 preload；具体点击是唯一登记来源，不靠近期输入时间或 sidecar 声称的已批准。

**R5（R1-F3 修订）**：`FileAccess.authorizeExternal` 的 metadata 形状冻结为：

```ts
type DirectoryAccessMetadata = {
  directoryAccess: {
    access: "read" | "write"
    targets: readonly DirectoryAccessTarget[]
  }
}
```

`absolute` 直接来自 `Target.absolute`，`directory` 来自同一个 Target 的 externalDirectory（内部目标取其实际所属目录）；与该次 resources 逐项对应，access 来自真实读写调用。不能仅传 directory，也不能从 save 的宽项目根、glob 或 shell 文本猜文件。卡片从 main 的 description 显示真实路径；无实际目标的第三方自述不会制造主进程授权。

批准源调用同一 `checkWorkspaceDirectory`、目录身份判定、`userOpened.register` 与 tracker `grantWrite`；其语义名称虽保留 `userOpened`，成员扩为“本人打开或本人批准”，不另造 registry。批准不创建项目 tab；运行内授权仍进入 `carriedWorkspaces`，后续同代/换代引擎可继续使用；不增加批准有效期或重启后的持久记忆。文件夹不存在时不得把其更宽祖先当作获准目标；主进程仅准备批准的具体目录，沿现有 canonical/保护判定校验其实际落点，再签发。此准备能力是 R4 的组成部分，不是引擎可任意调用的 mkdir 服务。

**R6（R1-F3/F8 修订）**：ext 的既有 evaluate hook 按 **target.absolute 的实际文件**查询 main 的有效写范围；例如 `~/.zshrc`、`~/.config/git/config`、`~/.cargo/config.toml` 命中 R3 的精确文件即可，不要求它们的 HOME/父目录可写，不为编辑这些文件批准 HOME。只读/既有 deny 与 CF/C1 优先；固定 global/user-config 文件不额外问 external_directory，命令/改文件工具仍按原权限档审批；表外写目标的目录批准保留 BR-08 行为，读操作不因本增量新增写授权。session always 不代替尚未得到的目录 OS 授权。

运行内已批准目录的查询明确走现有 `codepuppy.*` sidecar→main dispatch（`server.ts:779-802` → `CodePuppySidecarHost.receive`，`hub-view.ts:496,519`），ext 复用 `createHubBridge` 的 parentPort、请求 id 和超时机制（`ext/src/hub-bridge.ts:80`）；增加以下只读消息，不建立新通信通路：

```ts
type WriteScopeRequest = {
  type: "codepuppy.write-scope.request"
  id: number
  access: "read" | "write"
  targets: readonly DirectoryAccessTarget[]
}
type WriteScopeReply = {
  type: "codepuppy.write-scope.reply"
  id: number
  result: {
    revision: number
    targets: readonly {
      absolute: string
      outcome: "writable" | "needs-approval" | "protected" | "no-fence"
    }[]
  } | { error: "unavailable" }
}
```

id 为现有桥的非负整数，请求字段必填、路径绝对、结果与输入同序，无数量上限。main 的新 `readWriteScope` 消费 R1/R3 经 R7 验证的规则、CF/C1、实际代际 profile 及 tracker 的本运行目录授权；只投影每个目标的状态与授权/代际变化 revision，不更新任何状态。main/桥的消费方法统一为 `readWriteScope(request: Pick<WriteScopeRequest, "access" | "targets">): Promise<WriteScopeReply["result"]>`；消息不能含登记/签发请求或令牌；bad shape 被现有 parser 拒绝，不可用沿现有失败路径，不把失败解释为已获准。main parser/build、CodePuppySidecarInbound/Outbound 与 HubBridge 的只读调用是同一 R6 raise 的两端；query 只能读，批准仍只来自 R4。对应 wire 形状属于 `codepuppy-sidecar-messages.ts` 现有权威，不另写 ext 镜像。

用户拒绝时没有任何 grant；失败沿现有审批失败/重试呈现，不把卡片装成“批准成功”，不发允许回复。Home/状态/受保护位置沿已有一句说明，不能把失败变成让用户重启。远端审批不签发本机目录扩展。缓存/global/user-config 是静态集合，不伪装为本人批准记录。

### 4.4.1 环境探针也在围栏内（R1-P0，新增端口 R8）

原先“shell rc 只在用户下次打开外部终端时才绕过围栏”的前提不成立：`preferAppEnv` 每次启动都会在 main 派生 `-il`/`-l` shell，未装围栏，且结果可改 XDG 根。决定只作内部接线修正，保持规格限制行，不新增用户步骤，也不把该事实送回 owner 重新批准。

```ts
type ShellProbeFenceContext = {
  profile: string // 与引擎同一 planner/renderer 产生、已试编译的实际策略字节
  env: Readonly<Record<string, string>> // minimalProbeEnv + 固定根 + R1 缓存 + 同一代理 env
  roots: EngineRoots & { stateHome: string; engineConfigDirectory: string }
}
function prepareShellProbeFence(): Promise<ShellProbeFenceContext>
```

这是 main 启动协调层的已决定 raise：在任何 rc/缓存结果能合并之前，取系统 HOME、启动进程的显式路径环境与已初始化的 canonical 应用根作为唯一可信根快照，复用 `usableExportedPaths`、`resolveEngineRoots`、`engineGlobalConfigDirectory` 和 state 默认规则。先完成已有必须同步的主进程初始化，再用既有 `ensureEgressPolicyProxy` 得到真端口与 `sidecarEgressProxyEnv`，通过同一 `planProcessFence`、R7 真源、CF/C1 和工作区真源/运行内 carry 生成 probe 策略；没有端口/真源/有效 profile 就不运行未围栏探针。`initCodePuppyEnvironment` 及探针所需根准备必须在 `preferAppEnv` 之前完成（当前 `index.ts:627` 在 `:655` 前，需倒正这条依赖）；root 解析不再依赖探针，避免“先执行可写 rc 才能建立围栏”的环。

`loadShellEnv`/`probeShellEnvAsync` 都接收该 context，在 darwin 以 `/usr/bin/sandbox-exec -p profile <shell> -il/-l -c 'env -0'` 启动：**先装策略再执行 shell 的第一条 rc**，不用嵌套 sidecar，不加第二套 HOME allow，main 自身不进入围栏。缓存命中后的后台刷新也走相同入口；当前目录和最小 env 仍使用 main 已知的路径，超时与缓存命中语义沿用现有实现。正式签名产物上的该入口仍须实证，不假称本地小 profile 已证明出货形态。

缓存读取、异步 fresh 与同步 probe 的所有合并出口，只消费其非根环境；主进程的 `HOME`、`XDG_CONFIG_HOME`、`XDG_DATA_HOME`、`XDG_STATE_HOME`、`XDG_CACHE_HOME`、`OPENCODE_CONFIG_DIR`/`OPENCODE_CONFIG` 及数据位置 `OPENCODE_DB` 都不能被 probe/cache 改写，未设值也按可信快照的既有默认保留，不能重新从已污染的 `process.env` 解析。main 配置/工具策略写者、bootstrap、planner 和 sidecar 所见的 CF-8/CF-11/data/state 根必须是同一份快照，即使 probe 的 `env -0` 回吐指向工作区的 XDG 值也不消费；不以扩大写 allow 修复这种重定向。PATH 等工具发现照常消费；没有 root 新开关、旧缓存迁移或额外批准。非 darwin 保留无 Seatbelt 的原平台边界，但根来源仍一致。

R8 的 schema/入口、两类探针的 context 参数与根合并位置一并冻结；当前源码尚无该 context，实施不能把已有 `minimalProbeEnv` 当成围栏。P14 证明在 exec 前装 Seatbelt 能挡 rc 的越界写，但挡不住 rc 输出 XDG 字符串，因此根快照消费约束必须同时存在。

### 4.5 能力 seam map（现有端口 / 已决定 raise / 待 owner 定）

| 依赖能力 | 可合法调用的现有符号或本次 raise | 状态 |
| --- | --- | --- |
| 路径/环境单一权威，#1760 复用 | R1 `resolvePackageManagerLocations`；R2 最终 spawn 环境合成；既有 `createSidecarEnv`（`sidecar-env.ts:221`）、`spawnLocalServer`（`server.ts:487`） | 已决定 raise；目前只有 uv 单点赋值 |
| 静态清单落到真策略 | `planProcessFence`（`process-fence-plan.ts:229`）、`renderProcessFenceProfile`（`process-fence-profile.ts:215`）、R1/R3 输出；原 planner deps.mkdirp/realpath/compile | 现有端口 + 已决定输入扩展；不增加第二个 renderer |
| 用户配置与固定安装位置权限投影 | R3；R6 `readWriteScope` 经 `server.ts:779-802` → `createCodePuppySidecarHost`（`hub-view.ts:501`）及 `createHubBridge`（`ext/src/hub-bridge.ts:80`）；wire 见 §4.4；`registerPolicy` evaluate hook | 已决定只读消息/两端 raise；按目标文件判定，权限档仍用原 gate/catalog |
| 具体批准目标与读写语义 | R5 在 `FileAccess.authorizeExternal`（`core/src/file-access.ts:120`）携带 `directoryAccess`（targets.absolute/directory、access）；卡片沿现有请求事实核验 | 已决定 raise；不把目前没有的 metadata 说成可用 |
| 本人点击到 main、授权先于允许回复 | R4 `describeDirectoryAccess` / `approveDirectoryWrite`（显示 real path、点击核对 dev+ino）；`PermissionDialog` 点击（`:84-129`）、`ReceiptLedger.decide`（`contract/receipts.ts:102`）增加 pre-reply await 接缝 | 已决定 raise；不得在代际翻译器里做权限决定，不切换 session API 代际 |
| 资格/身份/历史 | `UserOpenedRegistry.register`（`process-fence-workspaces.ts:321`）、`checkWorkspaceDirectory`（`process-fence-profile.ts:589`）、`FenceWorkspaceTracker.grantWrite`（`:401`）及 carriedWorkspaces | 复用，R4 是唯一新增登记来源；保留现有竞争防护 |
| 活进程树放行 | `SidecarListener.grantWrite`（`server.ts:732`）、`FenceAddon.issueFileExtensionToProcess`（`process-fence-apply.ts:35`）、sidecar `grant-write`（`:157`） | 复用，不加原生签发方式 |
| 真实入口装载及保护优先 | `applyProcessFence`（`process-fence-apply.ts:86`）、CF/C1 既有 planner/renderer | 复用；目录合并后再走同一个生产入口 |
| 固定写位置的首次目标与重启防重指 | R7 `planWritableLocations`；`checkWorkspaceDirectory`（`process-fence-profile.ts:589`）、`fenceWorkspaceTruthPath`（`process-fence-workspaces.ts:50`）/原子真源写法（`:113`）；§4.3.1 冻结独立 schema | 已决定 main-only 真源 raise；R1/R3/C 均消费 |
| 登录 shell 的受围栏探测与可信根 | R8 `prepareShellProbeFence`；`loadShellEnv`（`shell-env.ts:86`）/`probeShellEnvAsync`（`shell-env-cache.ts:93`）接 context；`planProcessFence`、`ensureEgressPolicyProxy`（`server.ts:181`）、`minimalProbeEnv`（`shell-env.ts:42`） | 已决定启动依赖/context raise，原探针无围栏，不能冒充已实现 |
| Homebrew 执行方式 | **待 owner 定（B1）**；P09 接受为事实，不在本次选择执行入口 | **待 owner 定（B1）**；不属于其余已冻结接缝的依赖 |
| Windows | R1/R3 平台投影、既有权限 gate 和 no-fence 分支 | 不增 Windows 围栏；真机尚未验证 |

## 5. 数据与失败

包缓存和安装仍由包管理器写盘；不新建应用数据库、迁移历史缓存或复制用户凭据；新增的 R7 小型路径身份真源由 main 独占，格式与原子写边界见 §4.3.1。主进程只准备清单目录与已本人批准的具体目录，资格仍属现有运行内所有者。前文运行内已可写历史、送出但答复不明的令牌、跨代引擎孤儿风险继续适用；新静态 global 根也必须被 `generationWrites` 从**实际 apply 的 profile**读到，不能手抄一份“已覆盖”判定。

目录授权与 permission reply 没有跨进程事务。关键窗口在授权成功后、HTTP reply 之前：用户已经批准该目录，它可以保持可写；原请求继续挂起，按相同 decisionID 重试回复即可，不能假称撤回已消费的扩展。原生消费失败不发 allow；过期/指纹冲突与显示目录的 dev+ino 冲突都先于登记；只收到引擎 replied、甚至引擎自行移除 pending，都不能补登记。R4 成功结果绑定当时引擎代际；代际变化按 tracker 的运行内历史重新确认当前代，不拿旧消费确认解锁新请求。

CF/C1 优先于任何 allow，包括配置文件软链、安装脚本改名祖先和审批祖先目录。POSIX 权限不足、网络/registry 错误仍由原工具报错；不可把它们标成写围栏成功。Homebrew 的失败/执行契约单独待 owner 定（B1）；本节其余管理器及目录授权的失败处理不依赖该选择。

## 6. 架构落点与真实入口证据边界

沿 `docs/architecture/modules.md:51` 的桌面宿主与 `:41` 的 Schema 边界：位置/固定值留 main 的 profile 权威，preload 只暴露本机批准动作及只读结果，renderer 不 import main；core/protocol 不依赖桌面，R5 只携带 FileAccess 已有域数据，ext 从宿主桥消费投影。R1 纯函数不要求 engine import main；#1760 的 main 侧消费者取得结果后将环境交给连接器。共享消息类型走既有 shared/schema 边界，不让 core 反向依赖 Server。没有新顶层模块目录。

K1：不另建权限档名单。K2：缓存、全局清单、用户配置位置都由同一 profile 所有者提供；授权复用 tracker、X1、CF/C1，R7 是固定位置身份的单一真源，R8 的根快照也由该宿主协调，不能在 ext 复制判断。R4 的 preload sender、具体点击调用点与旧记录点采用同一个信任面；目录扩大不能由工具 RPC、sidecar 回信或普通 HTTP 触发。未引入新的结构例外。

证据必须经过 `spawnLocalServer → planProcessFence → sidecar.start/applyProcessFence → 实际命令/PTY/MCP`，含最终环境；只测纯 resolver、只用讨论里的 HOME mimic 或只见退出 0，不能声称 AC-09..12 成立。以真实包管理器生成的项目/安装输入留来源，围栏外核对项目依赖、全局命令可调用、用户配置真实内容和原 HOME 缓存无变更（Cargo 按 v4.1 / spec v6 例外）。撤掉缓存 env 的 bun/go 对照必须失败；Cargo 按 v4.1 撤掉真实缓存/锁规则作对照；撤掉 global/config 清单的对应操作必须失败；Git 撤锁路径须失败。外部批准须在原请求上写成功、已有子进程和之后的子进程均可写、PID 不变；移除 R4 时同一写入失败且无落盘；拒绝、自回复、伪造/重放、深链接与 sidecar 消息不产生目录授权。加入新 allow 之后，CF/C1 与两处 shell 缓存负例仍须保持拒绝；重启前把固定安装目录/用户文件/C 子项换成软链后，planner 不得放行 HOME 或新目标；真实卡片显示 real path，显示后换目录再批准必须 conflict，原合法软链批准仍成功。pnpm 项目钉版必须实际走 `.tools`，npm/Yarn Classic 的版本管理器全局前缀与 pnpm 环境键噪声也纳入真实入口。启动探针的缓存命中刷新和无缓存路径都须证明 rc 越界写失败、PATH 仍能发现工具、恶意 XDG 输出不能移动 CF-8/CF-11；反向撤围栏/根固定分别必须暴露越界写/根漂移。上述是设计成立的可证伪标准，具体用例、命令编排和文件归 plan.md。

Windows 不运行 Seatbelt，也不宣称 CF/C1 有 OS 围栏保证；沿规格原有平台边界。相同命令与文件操作仍消费权限档：“全部批准”直接执行，“请求审批”先问，拒绝后无该次写入；真实目录来源必须使用 Windows 路径权威和大小写规则。Windows 实机、带签名生产进程树（包括 R8 探针）、本次各管理器全量安装均未执行，留给真实入口证明；不以 macOS 的临时目录探针代替。

被否决：放开真实 HOME 缓存（违反 AC-09）；把 HOME/XDG 整体指到 C（改变项目/配置查找）；在每个 connector 或 shell wrapper 复制路径表（违反 K2）；先回复后授权（原请求会竞态失败）；看到 permission.replied 自动登记（模型可制造）。Homebrew 的两种产品取舍只在 §10 提问，本次不选择、设计或否决其中任何一种。

## 8. 拆分决定

同仓的所有权接缝只有 #1760：#1759 的 profile 所有者产 R1 的缓存位置、环境键与目录预建语义（均先经 R7 身份验证，使用 R8 的可信根）；#1760 的 launcher 所有者消费该结果，负责它自己的 Node/uv 启动器与 Python 版本、下载和准备状态。#1760 可以按 R1 开始设计，其真实围栏验收依赖同一实现与生产环境接线。两边不各持有 `uv-cache` 或 npm cache 常量；连接器单条环境不能把缓存改回 HOME。launcher 的运行时布局由其设计负责，不能通过本设计扩大到 HOME。共享接缝传播核对：`rg --files docs/specs | rg 'connector-launchers/(design|spec)\.md$'` 在本 checkout 只返回 spec.md，没有可修订的 #1760 design.md；并行设计的交接输入须消费本版 R1/R7/R8（不再复制未验证 C 根或未围栏 probe），不声称已修改另一 worktree。不存在跨仓技术拆分。缓存、非 Homebrew 全局位置、用户配置、目录批准、Windows 权限语义及 #1760 的 R1 消费均已独立冻结；B1 只挂在 Homebrew 的行和 seam 上，不作为这些部分的开工、审查或集成依赖。

## 9. 回滚

不适用。没有数据迁移或不可逆数据变更；不设计兼容开关或旧缓存回退。

## 10. 裁决与审查结论

| 裁决 | 适用范围与依据 |
| --- | --- |
| 其它七种缓存进 C；Cargo 由文末 v4.1 / spec v6 取代；真实全局位置分开，清单只有一个 owner | v4 AC-09/11 与 v6 Cargo 例外；P01/P02/P07、R1/R2；不拷贝缓存 |
| 本人目录批准先 grant 后 permission reply，复用既有 X1/registry | v4 BR-05/08、AC-10，P03..P06；新增来源取代旧 S4 穷举，未放宽“模型不能登记” |
| 用户配置按文件/必要伴随名放行，CF/C1 最后拒绝 | AC-12，P08；既有保护规格仍是权威 |
| Windows 复用环境/权限，无 OS 围栏承诺 | spec v4 Windows 段与 AC-04；未实机验证 |
| B1：Homebrew **待 owner 定（B1）**，其余增量 frozen | P09 的嵌套失败为已接受事实；编排者 Claude Opus 5.5 在本次续接 brief 裁决将其作为产品取舍交 owner，其余决定不依赖 B1，不继续调查 Homebrew 或选择路线 |

**B1 提请 owner 的问题（本次续接 brief 要求原样带回）：** Homebrew 在现有写入围栏里会再次启动自己的沙箱，已实测这种嵌套会失败。您选择哪一种：A，在「全部批准」档由应用替助手在围栏外运行 `brew`，保留对话中的安装能力，但 formula 安装脚本也会在围栏外运行，现有写入范围及凭据、联网围栏不能约束这些脚本；还是 B，对话里不提供 `brew install`，保留这部分围栏边界，但用户必须在应用外安装 Homebrew 软件，这会减少已批准的对话能力，需要您明确同意？本次不选择或设计 A/B；等待只影响 Homebrew，其余 v4 决定按 R1 处置冻结。

**U1–U3 的闭合与实施证明义务：** U1 的变量读取已由 P07/P10 的本机真实 CLI 查询闭合，Bun runtime cache 已实际生成；Yarn 两种语义明确区分。当时未找到 Go/Cargo；Go 的 GOMODCACHE/GOCACHE 与 install root、原 HOME 缓存无改动仍归实施证明。Cargo 后续真实验证及存储规则由文末 v4.1 / spec v6 取代；MCP 环境覆盖和 lifecycle scripts 的 spawn env 经 R2 真实入口证明，不以 CLI 查询替代；PTY 的 rc 在 spawn 后重新 export 的路径保留 R1-F6 残留说明，不把它写成已覆盖。U2 的原文件读取桥已由 v4.1 撤销；后续使用 Cargo 原生 Home 的真实入口证明配置/凭据选择、相对路径、镜像/认证、credential provider 与 rustup shim，不复制或输出真实秘密；已完成的小探针与仍未验证部分分列 v4.1。U3 的名字变化已由固定根层模式与 P11 正反臂解决，不留动态名单或 PNPM_HOME 整树放行的设计分叉；跨版本/Windows 仍属真实入口证据。Windows、生产签名进程树及全量安装尚未执行；另含 `packages/util/src/npm-config.ts:33` 失败返回空配置后回落 `~/.npm` 的负例；这些是验证既定决定的义务，不是等待 Homebrew 的设计分叉，也不增加用户步骤或限制。Homebrew P09 的内核失败已实测，完整 brew 安装链仍是读码推断；本轮不重跑。

| 轮/版本与范围 | 检查方 | 结论与证据 | 遗留去向 |
| --- | --- | --- | --- |
| 首轮作者交接（历史收据，当前结论见下一行）/ 代码 `9f08c506d9842d319616c7e45c33d3b9c3279e48`，spec v4 pinned SHA | Codex（GPT-6，designer；无独立审查，无子代理） | 已读批准输入、沿用旧有效收据；P07/P08/P09 小探针；旧名称扫描 10 pass/0 fail；文档契约当前与 HEAD 基线均 72 个 error、无新增 finding（只更新本设计索引行，其余既有断链/索引问题未修）；`git diff --check` 通过；R1–R6 明确为新接缝；B1 无合法端口，送审草案，不标 approved | B1 回 #1759 调度方；U1–U3 在本节诚实保留，不宣称可直接实施 |
| 续接冻结 / 输入设计 `403bfc16b7`；本增量非 Homebrew 部分与 R1–R6 | Codex（GPT-6，designer；独立审查由编排者另行安排） | 采纳续接 brief 的 B1 分离裁决；P10/P11 最小探针；U1/U2/U3 按上段闭合或转实施证明义务；`status: frozen-pending-review`，review rounds 仍为 0，未声明 pass | B1 为唯一 owner 选择；其余决定不依赖该选择 |


### R1 独立审查及编排者处置（适用本增量）

审查方：Claude Opus 5.5，只读；审查版本 `b49fa26f93`，原 verdict **FIX-THEN-MERGE**（1 Blocker、4 Major、3 Minor，另 1 个前提冲突）。编排者在本次 brief 逐项采纳，要求无新增用户步骤的最小修正；下面的“已修”均指设计修订，非产品实现/验收已完成。frontmatter 的 rounds=1、reviewed_sha、指定 verdict 据此记录；没有自行新增复审轮次，B1 不重开。

| finding / 处置 | 设计修正与依据 | 留下的证明 / 去向 |
| --- | --- | --- |
| R1-F1 Blocker，fix | §4.3.1 R7 main-only 身份真源；首次目标绑定、目录复用既有排除、后续不跟随重指，C 锚另核验；P13 | planner 真源持久化、软链替换后重启的真实入口证明 |
| R1-F2 Major，fix | §4.4 main 只读 description；卡片显示 real path，点击比对 dev+ino，变化返回 conflict，合法软链可批准；P13 | 真卡片及同一请求写入证明 |
| R1-F3 Major，fix | R5 带 Target.absolute 与 directory，R6 以文件命中 R3；编辑 shell/Git/Cargo 配置不授予 HOME | AC-12 三档真实编辑工具证明 |
| R1-F4 Major，fix | §4.2 增 PNPM_HOME/.tools，来源 switchCliVersion/安装工具根；P12 | 项目钉版触发真实 `.tools` 写入 |
| R1-F5 Major，fix | §4.2 统一补 nvm/fnm/volta/asdf/mise 固定模板和官方依据；删除任意 prefix 自动问目录的错误承诺；P12 | 已安装版本管理器的 npm/Yarn Classic 全局安装；没有新增 prefix 解析器 |
| R1-F6 Minor，record corrected claim | R2 和 §10 如实保留 PTY 登录 rc 的事后覆盖，不宣称 spawn 前注入可约束它 | 真实入口分别报告默认与 rc 覆盖；不改用户 rc |
| R1-F7 Minor，fix / accepted noise | P12 比较专用前缀与宿主实际消费；R1 发同值键，明确 npm 11 三条警告，不隐藏输出 | 缓存落点与噪声一起进入真实入口证据 |
| R1-F8 Minor，fix | R6 的只读 request/reply 已冻结，复用既有 `codepuppy.*` dispatch + HubBridge；无登记/签发字段 | 两端 parser、代际绑定、无副作用证明 |
| R1-P0 premise conflict，fix | §4.4.1 R8：先装同一生产写围栏再执行探针 rc；所有探针/缓存结果不能改可信 engine config/data/state 根；P12/P14 | 生产签名探针与 CF-8/CF-11 根不漂移证明；规格限制行保持原文，不向 owner 新提问 |

**仅留档，不修：** `server.ts:460-462` 无缓存同步探测目前跳过 `sanitizeCachedShellEnv`；本次只在 R8 的根消费边界解决根漂移，不顺带统一其它 session-control 键净化。**ARCH：** PNPM_HOME 一级 regex 在 `processFenceRulesCover`（`process-fence-profile.ts:400-407`）的保守祖先覆盖算法中会扩大“不签发”的判断；本轮只记该现有影响，不改算法、不把它当成按文件授权的正向判据。Optional 的 Cargo config 双读、npm-config load 失败负例已归 U2/真实入口证明义务，不加新 AC 或用户限制。

**本次交接核对：** 依据 spec v4 与审查输入 `b49fa26f93`；Codex（GPT-6，designer）按上述九项处置核对定义/所有者/已有调用点与 P12–P14 小探针，本轮旧名称扫描 10 pass/0 fail、`git diff --check` 通过；文档契约当前与输入 HEAD 均 72 个 error，无新增 finding，未修与本票无关的基线问题。结论为设计已修并 frozen。下一步由编排者按既有流程消费冻结设计；剩余产品选择只有 B1，实施证明义务留本节，不把本地探针当成生产实现已通过。


# v5 增量｜已获准的 Homebrew 命令由应用在围栏外执行（B1）

**本增量：frozen（R1 修订后）。** v4 在 `efc8ba3abd` 冻结的所有决定及 R1 处置逐字保留；其中“待 owner 定（B1）”和旧提问是当时记录，现在仅由本增量 §10 的 U-38 决定取代。v4 的审查收据仍为 rounds=1、reviewed_sha=`b49fa26f93`、verdict=`fix-then-merge; R1 1 Blocker 4 Major 3 Minor and one premise conflict, all corrected`；本文 frontmatter 只声明 v5 的审查状态：R1 审查 `176ba25a68`，两项 Blocker、两项 Minor 按编排者裁决全部修正。v4 的其它部分不重新送审或更换决定。

## 1. 基线

- 已批准输入：SPEC-child-process-write-fence **v5**，[提交 `834e269da977f6b4888c3b7a6a268bfe835d9cf5` 的规格](https://github.com/impharaon/alpha%2Dcode/blob/834e269da977f6b4888c3b7a6a268bfe835d9cf5/docs/specs/child-process-write-fence/spec.md)（#1765）。本次按 brief 执行 `git fetch -q origin && git show origin/alpha:docs/specs/child-process-write-fence/spec.md`，核对 BR-09 的 v5 句、限制段新增行和版本 5 批准记录；没有 merge/rebase 或修改本分支的 spec.md。
- 只覆盖 BR-09/AC-11 的 Homebrew 执行方式及对应 v5 限制；沿用普通命令卡、原审批、输出和取消，无新页面、按钮、批准卡或用户步骤。只读档仍不能运行命令。此 main 分流只在围栏在线的 darwin 启用；非 darwin 沿原命令通路，进程本来就在系统围栏之外，不为复用 helper 另起代理或声称已有系统围栏。
- owner（2026-11-26，意图 INT-safety U-38）：对「由应用替助手在围栏外运行 brew；代价是 Homebrew 软件包自带的脚本在围栏外运行」答「好的。」。引用来自本次 brief 与上述已批准规格，不把技术取舍记成 owner 的额外决定。
- 代码与既有设计基线：`efc8ba3abd585e5f3e6b2820ee4e73b96d2f1060`。不调查/修复其它进程通路，不把 B1 扩成通用的围栏外执行工具。

## 2. 地面真相

本轮只复核 R1 改变的安装身份、profile 覆盖、叶授权与 main 计划来源；原审批/结果接缝复用送审版证据。找到已有符号或决定所缺接缝即停止。P09 的嵌套 Seatbelt 退出 71 沿用，不重跑安装。

| 编号 | 已观察事实 | 决策影响 |
| --- | --- | --- |
| V5-P01（读） | `ShellTool.prepare`（`packages/core/src/tool/plugin/shell.ts:114-141`）先走 external_directory 与 `permission.assert`；`Shell.create`（`core/src/shell.ts:264-288`）先触发 create.before，再调用工具的 before/prepare，之后才 spawn（`:309-317`） | 现有 create.before 在命令审批之前，不能在该钩子里启动围栏外进程；当前 Shell metadata 只传 sessionID（`tool/plugin/shell.ts:196`），完整 Tool 调用身份和授权后接缝都是 H2 新增部分 |
| V5-P02（读） | `ShellScan.Result`（`core/src/shell/scan.ts:14-29`）给 commands/words/rawWords，现有权限解析也可能 opaque；`ShellParse.scan`（`core/src/shell/parse.ts:162`）是权限资源权威，未提供可直接使用的执行重写范围 | 不拿包含 brew 的字符串或权限 resource 当整段命令豁免；叶命令定位/保真重写是新的决定接缝，不伪称已可调用 |
| V5-P03（读） | `Shell.create` 捕获 handle.all 到现有 `.out`（`core/src/shell.ts:333-341`），等输出完成后发布退出（`:395-434`）；超时走 handle.kill，现有 forceKillAfter=3s（`:315-316,379-385`）；工具结果走 `ShellResult.output`（`tool/plugin/shell.ts:211-224`），中断调用 shell.remove | 保留原 Shell/Job/capture 体系，不能在 main 另造会话结果或成功通知 |
| V5-P04（读） | main 的 `codepuppy.*` 接收在 `server.ts:779-802`，`createCodePuppySidecarHost`（`hub-view.ts:501`）与 `createHubBridge`（`ext/src/hub-bridge.ts:80`）已有请求/回复；`startEgressPolicyProxy`（`network-egress-proxy.ts:228-246`）在现有唯一许可 loopback 端口监听，目前非 CONNECT 全答 405；退出钩子 `index.ts:715-726` 调 stopSidecars | 授权登记/取消复用已有 sidecar→main 通道；流式 helper 入口与 main 任务清理目前不存在，需决定 raise；不宣称已有任意 HTTP/RPC 执行口 |
| V5-P06（读） | `createSidecarEnv()` 在 `server.ts:562` 形成工具环境，`:588` 才覆盖 `sidecarEgressProxyEnv`；该函数（`sidecar-env.ts:266-282`）列出被应用替换的八个代理键 | H3 在覆盖前保存这一代的 PATH/代理快照是新增接线，复用现有环境权威，不从 main 的完整环境复制秘密 |
| V5-P07（读，R1） | v4 §4.2 允许 `/opt/homebrew/bin`、`/usr/local/bin`、`~/.local/bin`、`~/.cargo/bin` 等；`renderProcessFenceProfile`（`process-fence-profile.ts:236-261`）在 allow 后渲染显式拒写；其 CF 节点保护（`:266-286`）已有 literal 上级/软链节点语义 | 仅有路径/布局相同不足以授权；H1 增受保护的主进程安装身份及同一 profile 的精确拒写，不撤掉 npm bin allow |
| V5-P08（读） | ShellScan 的前置命令集合在 `core/src/shell/scan.ts:64-65`；该模块无服务层 import。Shell 的真实 PID 在 `core/src/shell.ts:323-326` 取自 spawn handle；原生 `IssueFileExtensionToProcess`（`native/codepuppy-fence/codepuppy_fence.c:97-123`）已取内核 audit token/pidversion，但没有 helper 专用交付口 | 复用单一 scanner；main 自己规划。PID 绑定和仅交给 helper 的能力交付是 H2/H4 新增接缝，不把旧原生扩展签发误当已有 helper RPC |
| V5-P09（测，本轮） | 临时 HOME/仅含 marker 的文件树里，以 `/usr/bin/sandbox-exec -f <denied.sb> /usr/bin/python3 -c <文件写/删/改名探针>` 验证：canonical 路径的 launcher literal、repository root literal、Library subpath 使写/删 brew、写 Library、改名 root 均 EPERM，而同 bin 新建 npm-probe 成功；撤掉 deny 时全部成功 | literal root 不等于 prefix subtree 拒写。首轮误用 `/var/folders` 别名发规则时全部写成功；改用真实 `/private/var/folders` 后上述拒写才成立，HB 必须规范化并保护 alias 节点；这不是生产围栏/真实 brew 安装证据 |
| V5-P05（测） | 临时 HOME/cache/logs/tmp 中，仅执行真实 `/opt/homebrew/bin/brew --version`，关闭自动更新/analytics，退出 0、stdout 为 `Homebrew 7.0.15`、stderr 空；本机探针使用的可执行路径为 `/opt/homebrew/bin/brew` | 只证明本机正常围栏外 CLI 可启动，不证明安装、代理、签名或取消已通过。没有运行应用、安装软件或读取用户真实 rc/秘密 |

V5-P09 原始 profile/输出在临时根 `fence1759-r4-canonical-fc33jhuy/{denied.sb,control.sb,result.json}`；文件内容只是 probe marker，不是伪造的 Homebrew 脚本/包格式。V5-P05 用 `python3 tempfile.mkdtemp/subprocess.run(timeout=15)`，原始输出在本机临时根 `fence1759-v5-r6_u3fj_/brew-version.json`；它不是产品证据。以下 H1–H4 是为 B1 决定的新增接缝，不是已实现功能。

## 4. 接口契约

### 4.1 H1：固定识别形态、安装身份与 main 计划

受控入口仍是**本机助手 shell 工具通过原权限判断之后、实际启动 shell 之前**。ext/`ShellTool.prepare` 判断原命令，卡片、`Shell.Info.command` 与输出记录保留原来源。main 自己消费原命令和自己的本代环境快照，调用同一 ShellScan 的纯规划入口；不采信 helper 给出的解析结果，不复制一个 shell 解析器。新增 source span、确定值规划及 helper 重写均是 H1 的决定 raise，方言沿 ShellSelect。

```ts
type PackageManagerKind = "homebrew"
type PackageManagerAssignment = {
  name: string; value: string // main 从下面 source span 确定的值
  origin: "prefix" | "export"
  start: number; end: number
}
type PackageManagerCommand = {
  nodeID: string
  start: number; end: number // 原可执行 word 的 UTF-16 code-unit 范围，end exclusive
  program: string // bare brew 或路径写法
  argv: readonly string[] // main 规划出的确定值，不留 caller expansion 槽
  cwd: string // main 从已批准初始 cwd 与源码里的确定 cd 推导的绝对路径
  assignments: readonly PackageManagerAssignment[]
}
function planPackageManagerExecution(input: {
  manager: PackageManagerKind; command: string; shell: string; cwd: string
  env: Readonly<Record<string, string>> // main 保存的本代工具环境；不是请求 env
}): readonly PackageManagerCommand[]
```

**识别形态钉住（R1-F3）：** 可执行位置上的裸 `brew`、引号/绝对/相对路径的 brew；可剥离的前置命令只复用 ShellScan 在 `scan.ts:64-65` 的既有集合（Bash：`builtin/command/time/coproc/!`；Zsh 再含 `noglob/nocorrect/exec/-`），另认只有 `NAME=VALUE` 操作数的 `env` 前置形式，不把 `env` 的选项/其它执行包装器自行扩成新名单。普通前缀赋值沿原 shell 语法。`echo brew`、注释、参数字符串不是入口。裸名按**该节点实际 PATH** 查找：main 本代快照加源码中可追溯的前缀赋值、literal export；不能用启动时 PATH 忽略该节点的显式覆盖。

argv、cwd、赋值都由 main 的同一计划决定；可从快照和 literal export 确定的变量引用由 main 解析，不在围栏外执行 shell source、`$()`、反引号或 caller 提交的展开值。赋值/cd 只有在到达该节点的控制流上值可确定时才入计划；不能盲目应用未执行分支里的 export。`cd p && brew install jq` 的 cwd 由 main 按该已批准源码中的确定 cd 推导；遇到动态 cd、不能确定的展开、会重复执行同一语法节点的循环或其它 opaque 形态，不作 helper 重写。每个静态 brew 节点至多分流一次，源码中多个 brew 节点各自独立；不把它改成用户配额。其它所有形态**仍在围栏内照常执行**，不拒绝原命令、不新增询问，也不以含有 brew 为由豁免整段命令。

**安装身份钉住（R1-F1）：** main 在安装围栏之前、于围栏外只读解析本机既有 Homebrew 安装并保存其身份；不执行尚未验证的候选脚本来探测身份。身份包含 prefix、canonical launcher、Homebrew repository root、`Library/Homebrew`，以及 launcher/路径节点的 realpath 与 dev+ino。默认 `/opt/homebrew`、`/usr/local` 布局沿现有平台工具发现（`platform/darwin.ts:5`、`platform/index.ts:24-30`）；不是对任何 caller 所给、长得像 Homebrew 的目录做即时登记。安装仓库/Library 不得来自已打开/已批准项目或其它围栏可写树；身份只在 main 本代安装快照建立，不从命令参数、项目 clone 或 helper 请求添加。每次命令规划可从这些已受保护的安装锚点刷新 launcher 当前元数据，容纳围栏外 brew 自更新，不因它换了文件 inode 就永久失去身份；刷新不接纳新的 caller/项目安装根。节点按自己的 PATH/cwd 解析后，必须与该安装快照的 launcher 身份一致；`~/.local/bin/brew`、`~/.cargo/bin/brew` 的同名脚本或项目内 cloned Homebrew 不因此获得豁免。路径限定写法也执行相同检查，不因在 PATH 外就免检。身份不符则原命令保持围栏内执行。

为使该身份在围栏启动后保持成立，在 `renderProcessFenceProfile` 的所有写 allow/X1 后、既有受保护拒写区域加入以下 **HB 精确拒写**，由现有 profile/planner 唯一持有，不改 v4 固定表原文：各已登记 prefix 的 `bin/brew` 用 literal；launcher 的真实目标及软链路径节点用 literal；repository root 节点用 literal；`Library/Homebrew` 用 subpath（连同其真实路径），其祖先/软链节点复用 CF 的 literal 节点保护。`repository root` 只拒改节点本身，不拒整棵 prefix：Apple Silicon 仓库与 prefix 同为 `/opt/homebrew` 时，npm 的 `bin`/`lib/node_modules` 仍可写。HB 不增加任何 allow，不把仓库别处已有写 allow 偷偷当作 Library/launcher 的可写许可。HB 路径先以 realpath 规范化，再补必要 alias 节点（V5-P09）。`ProcessFenceProfileInput` 新增必填 `homebrewFence: readonly ConfigFenceRule[]`（只接受既有 literal/subpath 两种分支，无 dat-files；无安装为 `[]`），值只由 main 的安装快照导出，不是用户配置或 sidecar 可提交的规则。profile 的 `processFenceWriteRules` 继续读取这份 deny；protected CF/C1 的拒写/拒读含义不变。此处只保护真实 brew 入口与实现，不冻结整个 bin，也不保护其它工具链软链。

复合命令只把符合 H1 的 brew 叶改成随包只读、无窗口的原生 helper。原 shell 继续在围栏内处理 cd、`&&/||`、pipeline、子 shell、重定向与非 brew 叶；main 不接收整段 `shell -c`。改写源仅含非秘密 execution/node ID、helper 地址与原叶的程序/参数材料，**不含授权能力**；这些原叶材料只供 helper 在必要时沿原围栏 exec，不是 main 的执行参数来源。节点在实际执行前身份复核不符时，H4 返回 fenced，helper 在原围栏内 exec 原叶；不能把身份失败变成围栏外的任意脚本执行。

### 4.2 H2：授权后登记、一次节点与真实 Shell 绑定

成功执行 before/prepare、分配真实 Shell.ID 后且 spawn 前新增 Plugin Shell 域的宿主委托口，ext 经既有 parentPort 桥连 main；原 create.before 不变成授权后口，Core 不 import Electron。所有者仍是原 Shell/Job。

```ts
type PreparedShellExecution = {
  shellID: string; sessionID: string; messageID: string; callID: string
  command: string; cwd: string; shell: string
}
type PackageManagerExecutionLease = {
  executionID: string
  nodes: readonly { nodeID: string }[]
  helperService: string // 非秘密的本代 native helper 交付地址
  executionSource: string // main 按 H1 计划产生的内部源，不含能力
}
function authorizePackageManagerExecution(
  input: PreparedShellExecution,
): Promise<PackageManagerExecutionLease>
function bindPackageManagerShell(input: { executionID: string; pid: number }): Promise<void>
function finishPackageManagerExecution(input: { executionID: string }): Promise<void>
function cancelPackageManagerExecution(input: {
  executionID: string
  reason: "cancelled" | "timeout" | "engine-disconnected" | "app-quitting"
}): Promise<void>
type PreparedShellDelegate = {
  executionSource: string // 只给内部 spawn；Info.command/卡片仍用原 command
  bindProcess(input: { pid: number }): Promise<void>
  cancel(reason: "cancelled" | "timeout"): Promise<void>
  finish(): Promise<void>
}
function delegatePreparedShell(handler: (
  input: PreparedShellExecution,
) => Promise<PreparedShellDelegate | undefined>): Promise<void>
```

Promise 侧契约按现有 Plugin adapter 转 Effect。ext 调 H2，main 用 H1 自己规划，返回由该计划产生的 helper source；没有合格节点则委托返回 undefined，继续原 spawn。`Shell.create` 取到真实 `handle.pid` 后经 bindProcess 绑定一次 main 的本代 PID/pidversion；它不是模型填写的 pid。H4 的叶交付须等此绑定，不在外层 Shell.env、全局 env 或 executionSource 安放 bearer。core 在自然结束/中断/超时时调用对应清理。

main 将 lease 绑定当前 sidecar 代、真实 Tool.Context（callID=context.id）和 Shell/会话身份、已通过原 gate/permission.assert 的 source/cwd 快照及 main 自己的 H1 计划。完整调用身份由 ShellTool 内部上下文传给 core，不从模型 tool input/metadata 猜测。登记/绑定/取消只接受真实 sidecar 宿主连接；helper 的公开数据口、`permission.replied`、`approved:true` 或 ID 字符串都不能登记 lease。授权登记不接受 caller env；本代普通工具环境来自 main 已保存的 `createSidecarEnv` + v4 R1/R2 投影。

**R1-F2：每个已批准 brew 节点只消费一次。** main 原子记录 pending → claimed（只交给一个 helper 进程身份）→ started → terminal；取消、身份失效或未到达节点可从未启动状态直接 terminal，不能再领能力；claim 后的能力只允许该节点的一次 spawn，不能换 invocationID 再领一次，也不因断连/错误恢复为 pending。不再有 caller 自定的无限实例 ID 或 expansion 槽。lease 容器随原 Shell/sidecar 生命期清理，尚未消费的节点不是可供其它叶任意构造执行材料的权限。

「全部批准」走原 gate 后直接登记；「请求审批」原卡批准及 prepare 成功后才登记；deny、拒绝和只读档不能登记/启动。没有新卡、工具、档位名单、独立有效期、持久重放或新运行超时；原命令仍是同一个 Shell/Job。

### 4.3 H3：main 仅使用自有计划运行 brew

main 以原工具同一 OS 用户身份 `child_process.spawn(executable, argv, { shell: false, cwd, env, detached: true })`，持有独立进程组。executable 只取 H1 受保护安装；argv/cwd 只取 main 保存的对应节点计划，**helper 请求不携带、更不能替换 argv/cwd/env**。执行前再次核对 launcher/路径身份；身份失效返回 fenced，由 helper 在原围栏 exec 原叶。缺失的 brew/其它普通启动错误仍在原叶到达时返回，不提前破坏 `&&/||`，不启动安装向导。

环境基线只用 main 为本代保存的普通工具快照（含 v4 R1/R2 缓存默认值），再应用 **H1 能用原 source span 追溯的前缀赋值与 literal export**；赋值值也由 main 从源码/快照确定，不从请求补键或补值。不可追溯的键忽略，不因此拒绝原命令。最后无条件剥离 `BASH_ENV`、`ENV`、所有 `BASH_FUNC_*`、`SHELLOPTS`、`BASHOPTS`、`PS4`，以及内部 helper 控制材料；即使这些键出现在快照或合法赋值中也不传给 brew。不是清空用户环境或新增命令禁令，而是避免 bash launcher 在执行已批准 argv 之前解释 caller 注入的启动代码。

不 spread main.process.env，不自动附加 provider/账户密钥或凭据内存表。main 在 `createSidecarEnv` 被 `sidecarEgressProxyEnv` 覆盖前保存八个代理键的值/缺席（V5-P06），H3 使用该原始用户代理快照而非应用策略代理；仅源码可追溯的用户代理赋值可覆盖它。Homebrew 缓存/prefix/日志保持自身正常环境，不增加 v4 的 Homebrew write allow；brew 不继承 H4 的能力。

stdin/stdout/stderr 与真实 exit/signal 流回原 helper；它将字节写回自己的标准流、以 brew 的真实退出状态/信号结束。原 Shell capture、ShellResult、Job、后台与取消机制继续工作；main 不写会话消息或合成成功。没有新增输出大小或时长限制，背压沿 pipe 语义，flush 后只发布一个终态。

```ts
type PackageManagerProcessRequest = { executionID: string; nodeID: string }
type PackageManagerProcessFrame =
  | { type: "stdout" | "stderr"; seq: number; dataBase64: string }
  | { type: "exit"; exitCode: number | null; signal: string | null }
  | { type: "fenced" } // 尚未 spawn，身份失效；helper 改在原围栏 exec 原叶
  | { type: "stopped"; reason: "cancelled" | "timeout" | "engine-disconnected" | "app-quitting" }
```

同一节点再次请求为 0 main spawn，不自动重放安装。伪造、过期代或节点不符为普通 helper 非零错误；不能通过新请求扩大节点、参数或环境。连接失效同样不重跑；新一次命令仍按原规则执行。

### 4.4 H4：能力只交给 helper 叶、流式结果与取消

授权登记/bind/finish/cancel 复用 `codepuppy-sidecar-messages` / `CodePuppySidecarHost.receive` / HubBridge，控制应答不等 brew 完成，也不成为安装超时。**替代送审版的 shell exported 控制环境**：新增 ui-mac native 的叶交付口，只有随包 helper 进程从 main 的私有 Mach request/reply 直接取得一次节点能力，使用内核消息 audit trailer 识别 peer，不接受消息自报 pid。该口只做下列交付，不提供执行任意程序、登记 lease 或改计划功能。

```ts
type PackageManagerNodeClaim = { executionID: string; nodeID: string }
type PackageManagerNodeGrant =
  | { kind: "delegated"; brokerPort: number; authorization: string }
  | { kind: "fenced" }
  | { kind: "error"; error: "unauthorized" | "inactive-execution" | "node-consumed" }
// 新 native 接缝；peer 来源是内核，不是可序列化的 caller 字段。
function claimPackageManagerNode(
  input: PackageManagerNodeClaim, peer: NativeHelperPeer,
): PackageManagerNodeGrant
type NativeHelperPeer = {
  pid: number; pidversion: number
  executable: string; signingIdentity: string
}
```

main 核对 peer 为受保护的随包 helper、生产签名/代码完整性且不容许注入，进程身份是 H2 已绑定的真实 Shell 自身（exec 形态）或其后代、当前代/节点尚未 claim，然后原子 claim；未知/重复/伪造 peer 只返回上述 error（helper 以 stderr/非零结束），不给能力、不启动 brew。helperService 地址与 node ID 不是能力。`NativeHelperPeer` 的内核身份/映像验证和私有 Mach 交付是**明确新增的 H4 raise**（V5-P08 只有 audit token 先例，没有现成端口）；由 ui-mac 原生模块与 main 同一个节点簿消费，能力只留该 helper 内存、仅用于其下一次数据请求。不得改成叶前缀文本里插入秘密、共享临时文件、继承 FD 给整棵 shell 或 exported env；外层 shell、其它叶及其孩子都不获得能力。Mach 交付不增加 TCP 端口，不能变成 BR-05 的扩权入口。

数据仍复用 N4 允许的唯一 loopback 端口：`startEgressPolicyProxy` 的非 CONNECT 分支只分派 `POST /codepuppy/package-manager/process`。请求头 `Authorization: Bearer <authorization>` 是该叶的一次能力，不进 URL、argv、环境、日志、bootstrap 或磁盘；成功启动时原子消费并从 helper 清除。请求/响应是 UTF-8 `application/x-ndjson` chunked 双向流，首行为仅含 ID 的 PackageManagerProcessRequest，之后只能 `{ type: "stdin", dataBase64: string }` / `{ type: "stdin-eof" }`，响应为 H3 帧。随包无窗口 helper 复用 native/resources 打包签名链，无需用户安装 Node/Python；main 不接收 caller 的 executable、argv、cwd、env 或展开值。原 CONNECT 策略、未知方法/路径的拒绝不变，无新联网卡。

首帧接受返回 200；400/`invalid-request` 为字段/帧不合法，401/`unauthorized` 为能力缺失/无效，403/`node-mismatch` 为节点/peer 绑定不符，409/`inactive-execution` 或 `node-consumed` 为执行已结束/节点已消费，均为 0 spawn。错误体 `{ error: 上述字符串枚举 }` 不回显材料，由 helper 转 stderr/非零；普通 brew 启动/运行错误仍用 200 流的真实输出/退出。身份在启动前失效以 fenced 终态回到原围栏，不冒充成功。流断开不重试。

main 按真实 ChildProcess/进程组绑定 lease，shell.remove、工具 abort、原 shell timeout、helper kill/流关闭均取消对应 brew 及其普通后代。沿原 TERM/forceKillAfter=3s 语义，不加安装限时，不按 caller 自报 pid 杀进程。正常应用退出清理见 §5；不对 main 崩溃/强退作同样保证。

### 4.5 seam map

| 依赖能力 | 可调用符号 / 明确决定的 raise | 所有者与边界 |
| --- | --- | --- |
| 原权限与真实执行身份 | `ShellTool.prepare`（`tool/plugin/shell.ts:114`）、Permission.assert；H2 新增 `delegatePreparedShell` 于 before 返回并分配 ID 后（`core/src/shell.ts:285-287`），真实 handle.pid 在 `:323-326`，新增 bindProcess/`bindPackageManagerShell` | Core/Plugin 给准备事实，ext 接桥；不信任模型布尔值/PID |
| main 自有计划与重写 | 同一 `ShellScan.scan`（`shell/scan.ts:227`）、纯模块/前置词表（V5-P08）；H1 新增确定 argv/cwd/赋值 source span 的规划入口；main 经该窄纯入口消费 | 不引服务层/复制 parser；不能确定就继续原围栏，不接收运行期展开 |
| Homebrew 身份与 HB profile | H1 新增 main 安装快照/身份核对；`renderProcessFenceProfile`（`process-fence-profile.ts:236-261`）/CF literal 节点保护（`:266-286`）/`processFenceWriteRules`（`:304` 起）消费 HB deny | 与 v4 R1/R7 同一 planner/profile；只保护 brew，不冻结 npm bin |
| 主进程环境 | `createSidecarEnv` / `sidecarEgressProxyEnv`（V5-P06）及 v4 R1/R2；H3 新增本代快照与源码赋值投影、固定剥离键 | main 是唯一值来源，helper 不供 env/cwd/argv |
| 既有控制往返 | `createHubBridge`（`ext/src/hub-bridge.ts:80`）、`createCodePuppySidecarHost`（`hub-view.ts:501`）、`server.ts:779-802`；H2 新增对应 request/reply | 原宿主连接，公开数据口不登记 lease |
| 仅叶能力交付 | H4 新增 `claimPackageManagerNode`、NativeHelperPeer 的内核 audit/映像签名核对和私有 Mach 交付；原生 audit token 先例（V5-P08）不是现成实现 | ui-mac native/main/helper；不把能力交给整个 Shell/任何非 brew 子进程 |
| 一次节点/流式运行 | H3/H4 新增 main 节点状态机/HTTP 精确路由，当前 `network-egress-proxy.ts:242` 只有 405；随包 helper 同链打包签名 | 不再有任意 invocationID；每节点至多一次，不重放 |
| 原结果/取消/退出 | `Shell.create`（`core/src/shell.ts:333-434`）、ShellResult.output、ShellTool interrupt → shell.remove（`:211-224`）、`index.ts:715-726`；H4 新增跨边界取消/正常退出清理 | 原 Shell/Job，main 持有句柄；崩溃残留如 §5 |

## 5. 数据与失败

仅本次执行的 main 内存安装/计划/节点簿，没有数据库、迁移、持久任务队列或自动恢复重跑。身份/形态不合格沿原围栏运行，不改 gate 结果、不拒绝原命令；因此仍可能遇到旧的 Homebrew 嵌套沙箱失败。brew 缺失返回 command-not-found（127），不可执行返回通常的启动失败（126）；其它 spawn/I/O 错误保留 stderr/非零，不合成成功；外层 `||`/pipeline 仍按原 shell 语义计算。

取消/退出竞态只发布一个终态，沿原命令超时。正常 before-quit 暂缓退出，停止新 lease，按原终止语义结束在途 brew 进程组，再清理传输/sidecar 后继续；重入/ will-quit 幂等，不依赖已退出的 sidecar 杀 main 的孩子。应用关闭后无法再给对话交付结果，不写 exit 0、不在下次启动重跑。**R1-F4 的诚实残留：** `detached: true` 的 brew 进程组在 main 崩溃或被 force-quit 时会继续运行；before-quit/will-quit 不能覆盖这种退出，不声称原取消钩子提供父进程死亡保证。本次不新增守护进程/崩溃回收机制。

**残留按 SPEC v5 限制原意声明（含 R1-P0）：** brew 命令及安装脚本在围栏外运行；brew 自身还能执行任意代码，如 `brew ruby -e`、`brew sh`、读取仓库 Brewfile 或 `--file=-` 的 `brew bundle`、`brew install ./x.rb`，以及从 PATH 找到的外部 `brew-<name>` 子命令。它们都是 owner 允许的“这条 brew 命令”，本设计不筛成只有 install 类子命令。应用的写入范围、已保存密钥保护与联网范围约束不了它们；main 不承诺过滤其写入、遮住凭据文件或限制网络。v4 的可写 `/opt/homebrew/bin` 等还允许围栏内代码替换其它工具链软链，围栏外 brew 随后可能调用它们；HB 仅保护 brew 身份，不消除这个残留，本次不增机制。复合命令的非 brew 叶、普通引擎/MCP/LSP/终端和 R8 探针仍在原围栏。

## 6. 架构落点与证据边界

沿 `modules.md` 的 Core/Plugin、ext、ui-mac 边界：Core 保有 Shell/Job/语法与权限；main 消费 ShellScan 的窄纯入口并自行持有计划，不依赖 Core 服务层，不另造 parser；Plugin 的 H2 由 ext 经既有桥消费。main 的 profile/planner 持有安装身份、HB 拒写、环境和节点簿，ui-mac native/helper 持有内核 peer 交付与字节转发。没有新顶层模块目录或包依赖，Core/Protocol 不依赖 Electron、ext 不 import main 私有实现。K1 档位名单不变，K2 同一概念仍只有一个判定权威；H3 在真实围栏派生通路的单一权威中登记为 **SPEC v5 BR-09 的 Homebrew 已知豁免**，不抹掉围栏断言。

实施证明仍从真实助手 shell 工具 → 原 gate/prepare → H2/main → 真实 brew；打包签名形态用来源可追溯且触发 Homebrew 内部 Sandbox 的真实 formula 安装，保留输出/退出/落盘。已知坏对照撤掉分流后，原围栏路径必须因嵌套沙箱失败（P09 exit 71）；--version、纯 resolver 或 mock 不替代。全批档无新卡、请求审批档只有原卡；拒绝/只读/伪造 lease 为 0 main spawn。

R1 的反向材料必须进入同一真实入口证明：改写/删除 launcher、重指 Intel 软链和替换 repository/Library 失败，同时普通 npm bin 安装仍成功；PATH 影子 brew、项目 clone 和不合格形态都实际在围栏内运行。`brew install jq && npm install` 的非 brew 叶及 postinstall 获得 0 能力；同 node 换任意 ID/重复请求仍只有一次 spawn，额外 env/cwd/argv/展开材料改变不了 main 计划。BASH_ENV/ENV/函数导出/选项/PS4 不进入 brew；可追溯 PATH/代理赋值与确定 cd 正确。仅对 helper 的 native 交付、签名/进程身份、防注入与 pidversion 绑定不能用 caller PID 字符串或共享 env 替代。其实现均尚未实跑，属于明确的 H1–H4 raise/实施证明义务。

复合/路径限定、pipeline/重定向、stdout/stderr/exit/signal、后台与大输出继续沿原结果机制；正常取消、超时、sidecar 断开/应用退出结束在途进程，force-quit 残留如 §5。具体语料/文件/顺序留 plan.md，不因证明义务添加新用户步骤。

被否决：整段命令移出围栏、sidecar 禁用沙箱、任意 executable RPC、再次批准卡（均超出 B1）；共享 shell 环境交付能力、caller 自供执行材料、给任意 Homebrew clone 认身份（R1 已证不成立）。只放行 install 类子命令未采纳，见 §10 留档。

## 8. 拆分决定

不新增跨仓或独立所有权拆分。H1/H2 属现有命令执行侧，H3/H4 属桌面宿主侧，是同一 B1 接缝的两端；不依赖 #1760 的新 Node 启动器，也不修改其缓存决定。v4 的身份真源、目录批准、环境探针和所有 R1 处置原样消费。

## 9. 回滚

不适用。无应用数据迁移或要求的兼容/回退路径。Homebrew 安装的真实外部副作用不能靠应用文档声称回滚；不自动重跑或卸载。

## 10. owner 决定、裁决与审查收据（v5）

| 裁决 | 来源 / 适用范围 |
| --- | --- |
| B1 已由 owner 选择 A；允许后由应用替助手在围栏外运行这条 brew | U-38（2026-11-26），对「由应用替助手在围栏外运行 brew；代价是 Homebrew 软件包自带的脚本在围栏外运行」答「好的。」；SPEC v5 BR-09/限制/批准记录，提交 `834e269da9` |
| main 只消费原批准节点的一次自有计划；原卡/结果/取消不增加步骤 | H1–H4 经 R1 修订；参数/环境不由 helper 提交，不把复合命令整体豁免 |
| v4 正文、所有 R1 处置仍 frozen；v5 经本轮 R1 修正后 frozen | v4 原文逐字保留；v5 收据 rounds=1、reviewed_sha=`176ba25a68`、verdict=`fix-then-freeze; R1 2 Blocker 2 Minor accepted and corrected`，依本次编排者明确处置，不声称修订稿又获独立复审 |

### R1 处置（审查 `176ba25a68` 的 v5 增量，原 :725-908）

审计方 Claude Opus 5.5（read-only），结论 FIX-THEN-MERGE；本次 brief 裁决四项接受修正及 premise note 留档。只修 v5 和其 profile 接缝，不改 v4 历史决定。

| finding / 处置 | 修订决定及原因 | 核对 / 尚待实施证明 |
| --- | --- | --- |
| R1-F1 Blocker，accepted / corrected | H1 以 main 预先解析且受 HB 拒写保护的 launcher/Library 身份为准；prefix/bin/brew、repository 节点精确 literal，Library subtree 拒写；不匹配走原围栏。消除可写 bin 脚本/影子命令/任意 clone 冒充 | V5-P07/P09 与 CF 既有节点语义；本轮 canonical marker 正反探针通过，真实入口仍须证明 launcher/仓库不可替换且 npm bin 可安装 |
| R1-F2 Blocker，accepted / corrected | H2/H4 仅给已绑定 helper 叶一次能力，不进 shell exported env；节点单次原子消费；H3 只用 main 的 argv/cwd/环境快照和可追溯赋值，固定剥离六类 shell 注入键，不拒绝不可追溯环境键 | 删除 expansion/env/cwd/invocationID 请求字段；新增叶私有交付/真实 PID 绑定 seams。真实 postinstall、重放和注入负例须 0 额外 spawn |
| R1-F3 Minor，accepted / corrected | H1 识别仅为 scanner 既有前置集合及只有 NAME=VALUE 的 env；节点自身 PATH 决定裸名候选，再过身份校验；其它形态照旧围栏内执行 | V5-P08；真实源码赋值/路径限定、影子和 opaque 对照 |
| R1-F4 Minor，accepted / corrected | §5 明说 main crash/force-quit 后 detached brew 组继续运行；只保留正常退出清理承诺 | 没有声称 quit 钩子覆盖强退，也没有新增守护机制 |
| R1-P0 premise note，record / 不收窄 | §5 点明 brew 自身子命令/本地 formula/Brewfile/stdin/外部命令可执行任意代码；仍属 owner 批准的“这条命令”。并记其它工具链软链可被 v4 bin allow 改写并供 brew 调用 | 不加 install 类过滤或保护其它工具链的新机制；收窄提议由编排者告知 owner、登记 pending intent，本次不是有效设计输入 |

**留档：** “只让安装类子命令围栏外运行”尚无 owner 批准，本次不实施、不形成限制/新 gate，也不将它记成 owner 决定。它不阻止按现有 SPEC v5 与本轮技术修正冻结；后续如 owner 改规格，再只重开受影响部分。

**交接收据：** 输入 SPEC v5 `834e269da9`、v4 `efc8ba3abd`、v5 送审版 `176ba25a68` 与本轮 R1/编排者处置。Codex（GPT-6，designer）核对上述符号与全部受影响 H1–H4 接缝，v1–v4 正文未改；V5-P09 的 canonical marker 正反探针通过（非 canonical 规则的失败观察也留档）；旧名称扫描 10 pass/0 fail，`git diff --check` 通过；文档契约相对输入 HEAD 仍为 72 error/249 warning、无新增 finding。生产实现/签名/真实安装和负向证明尚未执行，留 §6。结论为 v5 已修并 frozen，无本次交付需要等待的 owner 决定。未 merge/rebase、实现、push、PR 或变动 v4 裁决。


# v4.1 增量｜Cargo 使用真实 Home 的缓存与锁（SPEC v6）

**状态：frozen，按 r7 明确冻结。** 只取代 v4 的 Cargo CARGO_HOME/读取桥/缓存落点及其证明义务；bun、pnpm、yarn、npm、pip、uv、go 的缓存规则和 v5 Homebrew 决定不变。当前 frontmatter 声明本增量，未声称独立审查已运行；v5 原审查收据仍为 rounds=1、reviewed_sha=`176ba25a68`、verdict=`fix-then-freeze; R1 2 Blocker 2 Minor accepted and corrected`，v5 段落中“frontmatter 只属 v5”是当时记录。

## 1. 基线

- 批准输入：[SPEC-child-process-write-fence v6](https://github.com/impharaon/alpha%2Dcode/blob/7966eb280a7ed3c5341dbc98a1c5c690e6c20c5a/docs/specs/child-process-write-fence/spec.md)，提交 `7966eb280a`，覆盖 BR-07 / AC-09 的 Cargo 例外及 U2。已执行 `git fetch -q origin`、`git show origin/alpha:docs/specs/child-process-write-fence/spec.md` 并核对固定提交；未 merge，也未修改本分支 spec.md。
- owner 2026-11-27，INT-safety U-40 原话：「Cargo 选 1，第二处引擎改动允许，Supabase 报告批准」。本增量只消费“Cargo 选 1”：命令可写平常 `~/.cargo` 的缓存与锁，配置/镜像/凭据保持原含义；其余两项不进入本设计范围。cache 例外不改 BR-09/10 的全局安装与配置编辑审批。

## 2. 地面真相与停止边界

只验证真实 Cargo 写入所需的 Home 子项、原生配置含义和缓存/安装边界；明确固定集合并取得正反臂即停止。以下都不是应用真实入口通过的声明。

| 证据 | 已观察事实与决定影响 |
| --- | --- |
| C41-P01（实施方，已接受） | slice 2 `4897732d21..e013855a79` 的相对路径记录中，原 config 构建 0，生产软链桥构建 101；配置 SHA-256 未变。结果在该工作树 `packages/ui-mac/node_modules/.cache/package-manager-scenario-vf8vnnjs/cargo-relative/result.json`。桥改变的是定义位置，故撤销该桥，而非替用户修配置字节 |
| C41-P02（本会话 r5/r6） | Cargo 1.100.0 的 include 修复固定目录相对路径，却重复合并 HOME 内项目的数组；按项目分流并翻译路径的六个固定 cwd 样本成功、原 `.cargo` 未改，但同一 shell `cd` 跨 HOME 边界分别导致缺配置/重复合并。root 为 `fence1759-cargo41-6o12wedw` 与 `fence1759-cargo-r6-1umrorvv`；故不采用副本、include 或逐项目切换 Cargo Home |
| C41-P03（本轮测） | `cargo 1.100.0 (3acc79c0c 2026-11-05)`，不设 CARGO_HOME，临时 HOME 中经真实 Seatbelt 构建公开 `itoa=1.0.17` 和本地 Git crate；成功写 registry index/cache/src、git db/checkouts、`.package-cache`、`.package-cache-mutate`、`.global-cache`，镜像认证成功。分别撤掉 registry、git 或全部缓存规则，均 101 |
| C41-P04（本轮测） | 只允许 `.global-cache` 而漏掉 `.global-cache-journal`：Cargo 退出 0，但警告 `failed to auto-clean cache data`，数据库为 0 bytes / 0 tables；加入 journal 后无该警告，数据库 57,344 bytes，包含 registry/git 跟踪表。不需要放行 `-wal/-shm` 就完成本轮实际工作负载；不能把 exit 0 当作缓存完整成功 |
| C41-P05（本轮测） | HOME 内项目、同一 shell 双向 cd 均成功、relative env 读取正确，rustflags 标志只出现一次；config.toml/credentials.toml 哈希未变。cache-only 规则拒写 config、credentials、env、任意 Home 文件；bin 已存在时写入仍 EPERM。仅 cache 时 `cargo install --path` 为 101，加既有 bin/`.crates*` 安装规则后为 0，安装命令可调用 |

C41-P03–P05 命令为 `/usr/bin/sandbox-exec -f <profile.sb> <真实 cargo> run -vv` / `install --offline --debug --path <Cargo 生成的项目>`；原始 profiles、逐命令结果与摘要位于本机临时根 `fence1759-cargo-r7-5zvn2wj1/{result.json,summary.json}`，探针源码在 `/tmp/fence1759-cargo-r7-probe.py`。输入来自 r6 留存的真实公开 sparse-index 元数据与 SHA-256 校验通过的 itoa 归档；Git crate/manifest/凭据样本分别由真实 `cargo new/add`、`git init/commit`、`cargo login` 生成。认证只用本地隔离 registry/临时随机探针凭据，值未输出或复制进配置；未读真实账号/Keychain，未启动窗口或应用。

## 4. 接口契约

### 4.1 原生环境与精确写集合

`H = <真实 HOME>/.cargo`（Windows 为 `<USERPROFILE>/.cargo`）；这是目录路径，不是整根写 allow。**R1 的 env 不再产出 CARGO_HOME，R2 的 cacheEnv 不再覆盖它**，也不设置/更换 HOME；默认根及 config/config.toml、credentials/credentials.toml 的选择和路径解释交给 Cargo 本身。已明确传给命令的 CARGO_HOME 仍按 Cargo 语义使用，不由本增量重写或自动放行其它根。`CARGO_INSTALL_ROOT=H` 的既有默认与 BR-09 安装规则不变。项目 target 及用户配置的 target-dir/build-dir、registry/provider/镜像值不重写。

R1 的既有 `PackageManagerLocations` 返回形状不变，下表项都为 `manager: "cargo", purpose: "cache"`；由 `process-fence-profile` 的同一固定集合权威产生，R7/main 规划后送既有 renderer：

| rule | H 下精确位置 | 含义 |
| --- | --- | --- |
| subpath | `registry` | index、archive cache、解包 src 和该缓存树内部元数据 |
| subpath | `git` | db、checkouts 和该缓存树内部元数据 |
| literal | `.package-cache` | Cargo 原生共享缓存锁 |
| literal | `.package-cache-mutate` | Cargo 原生缓存变更锁 |
| literal | `.global-cache` | 原生访问/清理跟踪数据库 |
| literal | `.global-cache-journal` | C41-P04 实证所需的 SQLite rollback journal |

不使用 `H` 整根 subpath、`H/*`、`.global-cache*` 等兜底模式；本次不增加 `-wal/-shm` 或未观察到的任意根层文件。锁/数据库由 Cargo 初始化/更新，main 不打开、截断或重写内容。main 只预建必需目录，缺失的 literal 文件按既有 nearest-existing-ancestor 路径规划，不预写 SQLite 文件。

**缓存边界与其它既有授权：** config/config.toml 仍按 BR-10 / R3 的精确用户配置规则与 R6 判定编辑；credentials/credentials.toml 不新增写授权，不复制、不建立任何读取桥或环境 token；CF/C1 对受保护真实目标仍优先。`bin`、`.crates.toml`、`.crates2.json` 及既有安装元数据伴随文件只归 BR-09 / global-install 表，不归 cache。既有权限档行为继续：全部批准直接执行，请求审批仍在原命令批准后执行，只读档不能运行命令；不因这个例外新增卡片或档位名单。`env`、rustup 文件、其它 H 子项与 HOME 其它位置没有新增 cache allow。

### 4.2 main 规划与身份

**明确修订的接缝：** `planPackageManagerCaches` 不再假定 `purpose: cache` 全部位于应用数据根内，也不再把所有候选当目录。按既有 manager/rule 域区分：其它七种工具继续执行 C 下的 anchor 检查；Cargo 表项走 H 下的固定目录/文件候选，subpath 对应 directory、literal 对应 file，复用同一个 `planWritableLocations` / R7 身份真源与排除规则，不建立第二个表或新配置开关。R1/R2 的返回 env/cacheEnv 均移除重定向 CARGO_HOME，保留其它键原值。`prepareCargoConfigurationBridge` 及其调用撤销；没有替代加载器、生成配置或 cwd 切换协议。

Cargo 的 cache 候选不能经 symlink 变成 H 本身/祖先、bin、`.crates.toml`/`.crates2.json` 及既有安装元数据伴随文件、config/credentials 或 CF/C1 等受保护目标的可写授权。由 main 将真实 H 及这些保留位置的词法/真实路径作为 **cache 投影的排除条件**，目录不得覆盖它们、literal 不得命中它们；合法的外置 registry/git 缓存链接仍走 R7 的初次真实目标绑定和之后不跟随重指的规则。该排除只约束 cache 规则生成，不撤销 BR-03/08、BR-09 或 R3 已有授权。不把缺失/被重指的固定项扩大为 H 或 HOME allow；失败继续走现有 planner/fence 错误路径，不新增用户步骤。

## 5. 数据与失败

不搬配置、凭据或缓存，不复制 secret，不生成配置副本，不新增持久化模型。原生锁保留 Cargo 与应用外 Cargo 并用时的原语义；应用不替换锁、加配额/独立等待策略或“清理”共享缓存。Cargo 的实际报错/警告照原命令返回，不以退出 0 或隐藏 stderr 掩盖数据库写失败。配置中的其它写目标仍由既有项目/批准目录与围栏判定，不因保留路径语义而自动扩大。

## 6. 架构与 seam map

K1 的权限档权威、K2 的单一位置/身份权威均不变；沿 `modules.md` 的 main profile/planner、Core/Plugin/ext spawn 环境接缝消费，不新增模块目录、框架或依赖。下面 slice 2 符号坐标取 `e013855a79` 实施面；本设计 worktree 只修改设计，不合入实现。

| 能力 | 已有 callable / 决定的修订 | 所有者 |
| --- | --- | --- |
| 固定 env/写位置 | `resolvePackageManagerLocations`（`process-fence-profile.ts:227`）；修改 Cargo 返回项，不改 `PackageManagerLocations` 形状 | R1/profile |
| 两类 cache 规划 | `planPackageManagerCaches`（`process-fence-plan.ts:45-64`）；按 manager 分 anchor、按 rule 分目录/文件、剔除 bridge 调用是明确 raise | main planner |
| 真实目标与缺失文件 | `planWritableLocations`（`:88`）、`plannedWritableTarget`（`:135`）；加入 Cargo 保留位置的 cache 排除，复用既有真源 | R7/main |
| 围栏/运行环境消费 | `renderProcessFenceProfile`（`process-fence-profile.ts:328`）与已冻结 R2 的 shell/PTY/MCP/LSP 环境端口；原 grant/gate/CF/C1 不变 | main 与既有消费方 |
| 桥撤销 | `prepareCargoConfigurationBridge`（`process-fence-plan.ts:66`）及 `:62` 调用不再存在；无需新端口 | main |

实施证明仍须经过 `spawnLocalServer → planProcessFence → sidecar.start/applyProcessFence → 真实命令/PTY`，检查最终环境不再重定向 Cargo。HOME 内外、同一 shell cd、配置更新、相对 paths/env/target/source、镜像认证及原生凭据读取须保持含义；原配置/凭据内容不变，只有缓存/锁和已批准安装位置按用途改变。Windows、真实 rustup shim、外部 credential provider/OS Keychain、产品签名进程树本轮未验证，须在既有 CF/C1 保护下留真实入口证据，不能把临时 cargo:token 样本视作它们全部通过。

反向证明不能只跑无依赖项目：真实 registry/Git 依赖撤相应规则须失败；撤 journal 即使 exit 0，也须暴露清理警告/空数据库。仅 cache 的进程写 config/credentials/bin/其它 HOME 位置仍失败，R3/global-install 的独立授权再按原权限档验证；去掉安装规则后同一安装失败。改写 cache 项为指向 H、bin/安装元数据、配置、凭据或 CF/C1 的链接不得产出额外 cache 规则；其它七种工具的缓存环境、CF/C1 和既有目录批准行为保持原样。这里定义可证伪标准，具体文件/步骤归实施方 plan.md。

## 8. 拆分决定

无新增跨仓/所有权拆分。#1760 的 uv/npm 缓存继续消费同一 R1。传播核对 `rg -l 'CARGO_HOME|Cargo.*读取桥' docs/specs --glob design.md` 只有本设计命中；已修 §4.1 Cargo 行/读取桥、§4.2 Windows 缓存说明及 §6/§10 的 Cargo 证明义务，其余历史调查/审查记录保留，不是仍生效的读取桥决定。

## 9. 回滚

不适用；没有迁移或旧版本行为路径。

## 10. owner 决定与裁决（v4.1）

| 裁决 | 依据与适用范围 |
| --- | --- |
| 采纳选项 1，Cargo 原生 Home 缓存/锁可写；不再等待产品选择 | U-40 逐字原话与 SPEC v6 `7966eb280a`；只改变 Cargo，其他七种缓存仍隔离 |
| 撤销 config/credentials 读取桥、include 与翻译副本路线 | C41-P01/P02 已证语义漂移/跨 cwd 缺口；原生 Home 的 C41-P03/P05 正臂保留路径/认证/单次合并 |
| 精确 cache 表含 journal，不含整个 H、bin、配置或凭据 | C41-P03–P05 的实际落盘与消融；安装/配置编辑仍由 BR-09/10 决定 |
| v4.1 frozen；既有 v4/v5 审查结论只在其原范围继续有效 | 本次 r7 的明确冻结指令；本增量 rounds=0、未运行独立审查，不将 owner 规格批准或本地探针冒充独立审查通过 |

**交接收据：** 依据 SPEC v6 与 r7/owner U-40，Codex（GPT-6，designer）完成 C41-P03–P05 的真实 Cargo 1.100 临时 Seatbelt 正反探针；保留 P01/P02 的失败证据。旧名称扫描 10 pass/0 fail，`git diff --check` 通过；文档契约检查与输入 HEAD 同为 70 error/252 warning，无新增 finding，未修无关基线问题。本增量已冻结，无 owner 待决；产品真实入口、Windows、shim/外部 provider 及生产签名证明留 §6。只提交 design.md，不 merge、实现或发布；文档索引按本次“仅 design.md”范围不修改。


# v4.2 增量｜Go sumdb 留在应用数据，安装目标不变

**状态：frozen，按 r8 冻结决定。** 只取代 v4 §4.1 中“保留原 GOPATH，仅重定向 GOMODCACHE/GOCACHE”的决定，并补齐 R1 输入与 R2 投影；v4/v5 的其它裁决、R1 审查处置和 v4.1 Cargo 例外不变。v4.1 原收据为 rounds=0、verdict=`frozen-per-r7; no independent review claimed for v4.1`；当前 frontmatter 属本增量。本次不冒称独立审查通过；原安装目录的原生读取接缝超出单纯固定路径替换，依 r8 标记限定范围审查，见 §10。

## 1. 基线

- 批准输入仍为 [SPEC-child-process-write-fence v6](https://github.com/impharaon/alpha%2Dcode/blob/7966eb280a7ed3c5341dbc98a1c5c690e6c20c5a/docs/specs/child-process-write-fence/spec.md)（`7966eb280a`），本轮用 `git show origin/alpha:docs/specs/child-process-write-fence/spec.md` 核对 BR-07、BR-09、AC-09/11：Go 无 Cargo 的 HOME 缓存例外；二进制安装位置仍按 BR-09。规格不改，无 owner 待决。
- 新输入是实施方 `dabd56e112` 及后续提交的阻塞证据：其工作树 `packages/ui-mac/node_modules/.cache/package-manager-scenario-vf8vnnjs/r4/summary.json` 中，助手命令和 PTY 均失败；仅在实验臂增加原 `GOPATH/pkg/sumdb` allow 后成功。该实验 allow 不进入产品设计。

## 2. 地面真相与停止边界

仅核实 sumdb 写入归属、二进制目标和两入口的正反臂，得到能否决旧规则的证据即停止；不调查其它工具。G42-P02/P03 的输入是 Go CLI 生成的 module、真实公开 `rsc.io/quote@v1.5.2` 及其传递依赖；没有手写 registry 响应，没有读真实账号或凭据。

| 证据 | 已观察事实与影响 |
| --- | --- |
| G42-P01（读，真实 Go 1.27.4 源码） | 工具链 `src/cmd/go/internal/cfg/cfg.go:505,643` 将 SumdbDir 固定为第一个 GOPATH 下 `pkg/sumdb`；`src/cmd/go/internal/modfetch/sumdb.go:229,249-282` 在此读写有签名的 latest，而 `:286-309` 的 lookup/tile 缓存落在 GOMODCACHE。只迁后者不够。没有独立于 GOPATH 的 sumdb 本地目录设置；GOSUMDB 选择服务/信任，不是本地缓存路径 |
| G42-P02（测，两入口） | `go version go1.27.4 darwin/arm64`；生产 `spawnLocalServer → planProcessFence → Node IPC sidecar → session.shell / PTY`，真实 Seatbelt 与真实 Go。两入口 `go get rsc.io/quote@v1.5.2 && go run . && go install .` 均 0；latest 在 C/go/gopath，lookup/tile 在 C/go/mod；原 HOME/go/pkg 无新增或改动，二进制在原 HOME/go/bin，C/go/gopath/bin 无二进制。命令临时 `GOBIN=<项目>/explicit-bin go install .` 两入口也为 0 |
| G42-P03（测，消融/校验） | 同一正式 profile 与空缓存，撤 GOPATH 重定向的 Shell、PTY 均退出 1，点名原 HOME/go/pkg/sumdb/.../latest；该位置没有落盘。正臂保留 `GOSUMDB=sum.golang.org`、空 GONOSUMDB/GOPRIVATE；破坏 latest 签名并用全新 module cache 下载 go.sum 未记录的 quote v1.5.1，退出 1，报告 `invalid signature`。不能用已在 go.sum 的版本作为签名负臂 |
| G42-P04（测，原安装目录） | 用真实 `go env -w` 生成配置，覆盖默认、配置 GOBIN、配置 GOPATH 多目录、进程 GOBIN 覆盖配置、GOENV=off 五种情形。注入前 `go env -json GOBIN GOPATH` 取得原生目标；重定向 GOPATH 并固定该 GOBIN 后，`go list -f '{{.Target}}' .` 与之前逐字相同，`go install .` 均成功。不能只读进程 env 或硬写 HOME/go/bin，否则会覆盖 go env -w 的既有设置 |

G42-P01 工具链来自实施方上述 scenario 根的 `toolchains/go`，未重新下载工具链。[Go 模块校验文档](https://go.dev/ref/mod#authenticating)与[命令环境文档](https://pkg.go.dev/cmd/go#hdr-Environment_variables)补充解释；实际裁决以版本固定的源码和探针为证。G42-P02/P03 首轮通过命令前缀模拟新键，原始 `result.json` 在本工作树忽略的 `packages/ui-mac/node_modules/.cache/go42-proof-oxlt80q9/`。随后 `go42-bootstrap-ipscftwu/` 改为在既有 StartCommand.packageManagerEnvironment 中补 GOPATH/GOBIN，命令不再 export 这两键，确认当前生产投影能让两入口同样成功（24 断言）；仍保留签名负臂。执行命令均为在 packages/ui-mac 下 `bun test <临时根>/probe.test.ts`；首轮 32 断言通过。host 使用现有测试 Electron mock 和 Node fork，无 Electron/应用/窗口启动，只在实验 profile 中加入 BR-09 已定义的真实 bin 规则。

G42-P04 原始 `result.json` 位于系统临时根 `go42-install-input-jdrv4ddf/`；脚本 `/tmp/fence1759-go42-target-probe.py`。探针 HOME 与 GOENV 都隔离，未改用户配置。两入口最终证据的 HOME 刻意放在 W11/W12 通用临时写区域之外；早期临时 HOME 被 W12 盖住、PTY 复用完成标记和签名负臂命中既有 go.sum 的夹具结果均不作为产品结论。

## 4. 接口契约

### 4.1 R1 的 Go 环境与写规则

`C=<userDataPath>/package-managers` 不变。R1 仍为唯一包管理器位置权威；新增必填输入 `goInstallBin: string | null`，是 main 在重定向前读取的原生有效安装目录，不是用户路径覆盖选项。非 null 必须为绝对目录路径，R1 纯函数不执行工具或读取配置。

| 固定键 | R1 值 | 写规则用途 |
| --- | --- | --- |
| GOPATH | `C/go/gopath` | `manager: "go", purpose: "cache", rule: {kind: "subpath", value: ...}`，覆盖 pkg/sumdb/latest 及其锁/元数据 |
| GOMODCACHE | `C/go/mod` | 保留原 cache subpath；module、工具链、lookup/tile 缓存 |
| GOCACHE | `C/go/build` | 保留原 cache subpath |
| GOBIN | `goInstallBin`；用户显式设置 GOBIN 时不投影（v4.3 F-a） | 配套环境投影，**不是 cache allow**；global-install 固定表及已打开/批准目录判写照旧 |

GOPATH/GOBIN 必须成对生成与消费；不能先改 GOPATH，再从它推导安装目录。没有新增原 HOME/go/pkg/sumdb、原 GOPATH 或用户任意安装目录的 allow；自定义 GOBIN 原本在项目/批准范围内则照常用，不因读取此值而扩大写集合。C 下目录继续由 main 预建、canonical 化并走 R7 初次目标绑定/重指检查与 CF/C1，不把整个 HOME 或整个原 GOPATH 放开。其它 manager 的缓存、Cargo 原生 Home 和 #1760 的 uv/npm 消费契约不变。

**已决定的读取接缝 G42-R1a：** main 在最终缓存环境投影之前，从过滤后的原始命令环境 PATH 解析真实 Go 可执行文件；在 R8 的同一围栏 context 下执行该文件的 `env -json GOBIN GOPATH`，cwd 为 main 已预建的 C/go，不读取项目 go.mod。沿用原 HOME、GOENV 与非根环境；只对此查询设 `GOTOOLCHAIN=local`、`GOTELEMETRY=off`，避免查询触发工具链下载或遥测写入，不把这两键注入用户命令。由 Go 自己处理 go env -w、GOENV=off 及环境优先级，不维护第二份 Go 配置解析器。返回 JSON 的有效 GOBIN 为原安装目录；若工具返回空 GOBIN，按其原始 GOPATH 的第一个目录加 bin（平台路径列表分隔符），而不是用重定向后的 GOPATH。**v4.3 F-a 更正**：用户是否显式设置 GOBIN 以同一围栏内的 `go env -changed -json GOBIN` 判定（计算出的默认值非空，`go env GOBIN` 无法区分）；仅用户未设置时注入 GOBIN = 原 GOPATH 第一项/bin，用户已设置时不注入 GOBIN（GOPATH 照常重定向），由 Go 自己读取；结果为 null 时重新查询。只消费这些键，不读取/保存 registry token 或整份 Go 配置。

该接缝是**明确 raise**，尚无现成安装目录查询函数；归 main 启动协调层，复用 R8 context/进程取消，不创建未围栏的工具探针。围栏先用 R1 的 `goInstallBin: null` 形成，查询只需原生读配置；取得结果后再生成最终成对环境，策略写根不依赖查询结果，避免循环依赖。Go 不存在或查询非 0/JSON 无法得到绝对目录时，结果为 null，沿用既有启动诊断记录原因，不猜 HOME/bin 以覆盖用户配置；null 时 R1 不产 GOPATH/GOBIN 这对键，GOMODCACHE/GOCACHE 仍产出，其它工具不受阻。后续 Go 命令仍按原入口执行和报告实际错误；不退回未围栏查询、不新增卡片/批准步骤，不声称该失败分支已满足 Go 缓存修复。

### 4.2 R2 必须投影 GOBIN

R2 的环境不是单靠 `purpose: cache` 的路径值反查得出的键集合。Go 的缓存默认值必须包含配套 GOBIN（用户显式设置 GOBIN 时除外，v4.3 F-a）；经 R7 规划后的 GOPATH/GOMODCACHE/GOCACHE 指向 canonical C 下根，GOBIN 保留原生目标路径而非改写为缓存路径。StartCommand.packageManagerEnvironment、sidecar 的同一安装/投影端口和 Shell/PTY/MCP/LSP 合成均消费这份结果，不另算 Go 目录。显式命令前缀 `GOBIN=... go install` 仍按 Go 优先级覆盖 spawn 默认，最终受现有写集合约束。配置快照之后的 rc/命令修改仍有 v4 R1-F6 的覆盖残留；不承诺 shell 执行之后还能强制缓存键或热更新原生安装目标。

## 5. 数据与失败

不复制/迁移/删除旧 Go 缓存，不改 go env 文件或 shell rc。不改 GOPROXY、GOSUMDB、GONOSUMDB、GOPRIVATE 及现有网络策略；不能以关闭校验或放开原 sumdb 目录来让正臂通过。R7/CF/C1 规划拒绝的目标仍按既有失败处理，不放宽保护。写入失败、校验失败、命令取消与输出/退出码沿既有 Shell/PTY 通道；读取接缝失败的行为见 §4.1，不新增用户步骤。

## 6. 架构落点与证明义务

以下 `packages/ui-mac/src/` 坐标以实施方 `dabd56e112` 及 r4 后续代码为准；本分支当前尚无 slice 2 实现，不能将这些观察冒充本分支已具备的能力。

| 所需能力 | 现有 callable / 明确 raise | 权威 |
| --- | --- | --- |
| 固定 Go 路径与原安装目标输入 | `main/process-fence-profile.ts:226 resolvePackageManagerLocations`；按 §4.1 增字段及 quartet，是 R1 修订 | R1/main |
| 读取原安装目标 | **G42-R1a raise**：§4.1 的围栏内 Go 原生查询；R8 context 已冻结，尚无该查询函数。返回绝对 bin 或 null，不返回新写根 | main 启动协调层 |
| canonical cache 与真实目标绑定 | `main/process-fence-plan.ts:45 planPackageManagerCaches`、`:88 planWritableLocations`；增加 C/go/gopath 候选，沿 R7 真源 | 同一 planner |
| 配套 GOBIN 进入启动文档 | `main/process-fence-plan.ts:82` 当前 cacheEnv 只按 cachePaths 筛键，**明确修订为包含配套 GOBIN**；`main/server.ts:932` 发送同一 packageManagerEnvironment | R1/R2 |
| 两入口投影 | `main/sidecar.ts:187 parsePackageManagerEnvironment`、`:233 startEngine` 与 `shared/package-manager-environment.ts` 的 `installPackageManagerEnvironment` / `projectPackageManagerEnvironment`；后者无固定键枚举，复用现有消费者 | R2/main→sidecar→spawn |

K1/K2 不变：档位/审批照旧，固定位置仍只在 R1，消费者不推导安装目录；无需新模块权威、配置开关或所有权拆分。被否决的是单放行原 sumdb（违反 BR-07）、只重定向 GOMODCACHE（G42-P01/P03 失败）、GOPATH 重定向而不配套 GOBIN（改变安装目标），以及硬编码原 HOME/go/bin（G42-P04 配置样本反证）。

实施证明须在**未补丁的最终 R1/R2** 经 `spawnLocalServer → planProcessFence → sidecar.start/applyProcessFence → session.shell / PTY` 完成空缓存下载、签名校验和安装目标核对；这里的临时 StartCommand 注入证明现有投影可承载新键，尚未证明新输入查询与最终 planner 自动接线。撤 GOPATH 重定向的两入口仍须失败，不能让临时 HOME 被 W11/W12 或其它已批准根覆盖；原 HOME 工具缓存哈希/文件集合不变，bin 与 cache 分开核对。损坏签名必须在 go.sum 未信任的版本和新 module cache 上失败；不能只看 exit 0 或 GOSUMDB 字符串。配置安装目录、显式 GOBIN 和 null/失败查询分支也须经过实际接缝。产品签名 utilityProcess、Windows 和其它进程类别未在本轮实跑，沿原证明边界留证；不扩大本轮本机声明。

## 8. 拆分决定

无新增跨仓/所有权拆分。传播检查 `rg -n 'GOPATH|GOMODCACHE|GOBIN' docs/specs --glob design.md`；旧“保留 GOPATH”有效声明只在本设计，已更新 §4.1 Go 行/R1 输入/R2 配套投影，其余历史证据不改写。#1760 无独立 Go 规则；共享位置权威仍是 R1。

## 9. 回滚

不适用；无迁移或旧版本行为路径。

## 10. 裁决与审查结论（v4.2）

| 裁决 | 依据与范围 |
| --- | --- |
| 撤销“保留原 GOPATH”的缓存决定，迁 GOPATH 到 C/go/gopath，模块/构建缓存原规则不变 | G42-P01–P03；修复 BR-07 / AC-09，不采用 HOME sumdb allow，不关闭 checksum |
| 重定向前读取原生安装目录，成对投影 GOBIN，不据此扩权 | G42-P04；保留 BR-09 / AC-11 的安装目标，明确 G42-R1a 和 cacheEnv 过滤修订 |
| frozen；独立 review rounds=0、reviewed_sha 为空；限定范围审查标记而非 not-required | 单纯 quartet 符合 R1/R2 模式；但保留 go env -w 目标需要新增围栏内原生查询接缝，超出纯固定路径替换，故按 r8 的“flag otherwise”标记。只审 §4.1 原目录读取/失败分支及 §4.2 配套投影与其直接后果；不重开 v4/v5/v4.1 或规格决定。本地 Go/入口证据不能替代该接缝的独立审查 |

**交接收据：** Codex（GPT-6，designer）完成 G42-P02–P04；两个真实入口、bootstrap map 投影、安装目标与两个消融臂均有本机证据，签名负臂可失败。未声称新 planner/查询已实现、产品签名进程树或 Windows 已通过。旧名称扫描 10 pass/0 fail（2,347 断言），`git diff --check` 通过；文档契约检查与 HEAD 同为 70 error/252 warning，逐 finding 对比无新增。已运行 `affected-tests --list`，当前工作树缺 `.gate-tests`，工具返回缺文件错误、没有 scope 行，未将其记为范围检查通过。没有 owner 待决、规格变化或新增用户步骤；只修改本设计，未 merge、实现或发布。v4/v5 的审查与处置及 v4.1 Cargo 裁决保持原文。

**v4.2 限定范围审查与编排器处置（2026-11-27）**：独立审查（Claude Opus 5.5，只读）结论 MERGE，2 Minor 均采纳，用户无感：① 只在查询返回空 GOBIN 时才注入「原 GOPATH 第一项/bin」；返回非空时不注入，由 Go 自己读环境或配置（用户 `go env -w GOBIN` 立即生效）；判据已由下方 v4.3 F-a 更正。② 启动时查询结果为 null（尚未安装 Go）时，在下一次 Shell/PTY 环境合成前重新查询（会话中 `brew install go` 后无需重启）。观察留档：`GO111MODULE=off` 的 GOPATH 模式下，原 GOPATH/src 源码在重定向后不可见，不在本增量处理。

**v4.3 编排器裁决（2026-11-27，编排器 Claude Opus 5.5；实现 impharaon/alpha-code#1759）**：以下是已作出的裁决，本节只记录，不是新一轮审查；frontmatter 的 v4.2 收据不变。均不新增用户步骤、确认或限制。

| id / 日期 / 来源 | 裁决 | 依据与落点 |
| --- | --- | --- |
| F-a｜2026-11-27（更正 v4.2 审查处置①） | 用户显式设置的 GOBIN 以 `go env -changed -json GOBIN` 判定；计算出的默认值非空，`go env GOBIN` 无法区分。只有用户未设置 GOBIN 时才注入 GOBIN = 原 GOPATH[0]/bin；结果为 null 时重新查询。 | 处置①「查询返回空 GOBIN 才注入」的判据不成立。同步 v4 §4.1 Go 行、v4.2 §4.1 GOBIN 行与 G42-R1a、v4.2 §4.2。 |
| F-b｜2026-11-27｜#1759 r8 | Bun 全局位置按 Bun 自身算法计算：`BUN_INSTALL` 已设取之，否则 `<XDG_CACHE_HOME>/.bun`，否则 `~/.bun`，取用户可信环境快照；只放行 `<root>/install/global` 与 `<root>/bin`，经 R7 绑定；`PackageManagerLocationInput` 从快照携带 `XDG_CACHE_HOME`/`BUN_INSTALL`（字段 `xdgCacheHome`/`bunInstall`）。应用自身为子进程设置会移动 Bun 根的变量时，用户未设 BUN_INSTALL 的围栏子进程得到 `BUN_INSTALL=<用户真实 Bun 根>`（同 GOBIN 模式；还原真实位置，不是重定向整个 Bun 安装）。 | 原 §4.2 只写 `~/.bun/...`，与用户设置 BUN_INSTALL 或 XDG_CACHE_HOME 的真实位置不符。同步 v4 §4.1 类型/bun 行/R2 句与 §4.2 bun 行；Windows 列未改。 |

**传播核对**：`rg -n 'goInstallBin|GOBIN|\.bun/|BUN_INSTALL' docs/specs --glob design.md` 只命中本设计；#1760 无独立 Go/Bun 全局位置规则，共享位置权威仍为 R1。遗留：F-b 的字段名 `bunInstall`/`xdgCacheHome` 是本记录对「携带 XDG_CACHE_HOME/BUN_INSTALL」的具体化；用户已设 GOBIN 时的投影形态及 Bun 根还原的真实入口证据仍归 #1759 实施证明。
