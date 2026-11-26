---
id: DESIGN-child-process-write-fence
title: 子进程写入围栏技术设计
summary: 保留已批准的运行期目录授权设计；v4 增补包管理器缓存、全局安装、本人批准文件夹与用户配置契约，复用同一围栏权威；Homebrew 嵌套围栏入口未成立，增量保持草案。
kind: tech-design
status: draft
spec: SPEC-child-process-write-fence
spec_version: 4
review:
  rounds: 0
  reviewed_sha: ""
  verdict: ""
owners: [owner]
last_reviewed: 2026-11-26
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

本增量是送审草案，尚未冻结。前文 v2/v3 的决定与 R1–R3 收据保留；其当时 frontmatter 收据为 `spec_version: 3`、`status: approved`、`review.rounds: 3`、`reviewed_sha: 8370b2fa23`、verdict「R1/R2/R3 findings all dispositioned and corrected, frozen by orchestrator 2026-11-19」。以下只替代明确点名的旧结论。**Homebrew 的执行入口有阻塞，见本增量 §10；不能把本草案当成全量实施输入。**

## 1. 基线

- 批准输入：SPEC-child-process-write-fence v4，[提交 `9504dd7d9ab36b9ced3fdf70b355d1667685bf8d` 的 spec.md](https://github.com/impharaon/alpha%2Dcode/blob/9504dd7d9ab36b9ced3fdf70b355d1667685bf8d/docs/specs/child-process-write-fence/spec.md)（同目录 [当前规格](spec.md)）。覆盖 BR-05 修订、BR-07..BR-10、AC-09..AC-12、Windows 段及三条 v4 限制。无新增用户限制，无旧记录迁移。
- 代码读码基线 `9f08c506d9842d319616c7e45c33d3b9c3279e48`。只核实本增量依赖的路径、审批、围栏接口；不重审旧扩展签发矩阵。
- 体验沿用批准卡片、命令/改文件工具和已有失败说明，不增加页面、开关、确认或设计稿。两层含义保持分离：权限档决定是否执行；围栏决定进程最终能写哪里。全局清单在三档间相同，不能靠进程级围栏替代引擎权限判定。
- 接续讨论 P-06..P-08 的模拟证据与既有 probe。该记录不是应用真入口的通过结论。#1760 消费本增量的包管理器位置契约，不再定义第二份 uv/npm 缓存目录。

## 2. 地面真相

本次调查只回答：缓存变量是否被工具读取；主进程怎样给已启动的进程树放行；审批与放行之间缺什么端口；Homebrew 增加目录后是否足够。取得调用点或小探针对照即停止。

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

P07–P09 均用 `python3` 的 `tempfile.mkdtemp`、`subprocess.run(env=空主目录环境, capture_output=True, timeout=5)`；没有运行应用、Electron、系统选择器，没有真实主目录写入、秘密采样或包下载。P09 用的是另一种 profile 的嵌套，未重复旧设计已证明可重用的同字节策略。

外部工具定义取官方资料（2026-11-26 读取；只能支持变量与布局，不替代产品证据）：[Bun 缓存](https://bun.sh/docs/pm/global-cache)、[Bun 全局目录](https://bun.sh/docs/runtime/bunfig)、[Bun transpiler 缓存](https://bun.sh/docs/runtime/environment-variables)、[pnpm store](https://github.com/pnpm/pnpm/blob/main/pnpm/docs/settings/store.md)、[pnpm 其余目录](https://github.com/pnpm/pnpm/blob/main/pnpm/docs/settings/other.md)、[Yarn Classic 缓存](https://classic.yarnpkg.com/en/docs/cli/cache/)、[Yarn Classic 全局](https://classic.yarnpkg.com/en/docs/cli/global/)、[Yarn 现代版配置](https://yarnpkg.com/configuration/yarnrc/)、[npm 布局](https://docs.npmjs.com/cli/v9/configuring-npm/folders/)、[pip 缓存](https://pip.pypa.io/en/stable/topics/caching/)、[uv 存储](https://docs.astral.sh/uv/reference/storage/)、[Go 目录](https://pkg.go.dev/cmd/go)、[Cargo 环境](https://doc.rust-lang.org/cargo/reference/environment-variables.html)、[cargo install](https://doc.rust-lang.org/cargo/commands/cargo-install.html)、[Python 用户目录](https://docs.python.org/3.13/library/site.html)、[Git 全局配置](https://git-scm.com/docs/git-config)、[Homebrew 环境](https://docs.brew.sh/Manpage)。未安装的 Yarn、Go、Cargo 和 Windows 行属于文档依据/设计决定，非本机实测。

## 4. 接口契约

### 4.1 单一位置权威与环境

`process-fence-profile` 继续持有固定写集合、模板和 `WRITABLE_ROOT_IDS`。增加以下**已决定的新端口 R1**（尚不存在），由主进程在白名单过滤之后调用一次；不建立新配置系统、不运行未围栏的包管理器来探测配置、不更换 HOME 或整组 XDG 根。

```ts
type PackageManager = "bun" | "pnpm" | "yarn" | "npm" | "pip" | "uv" | "go" | "cargo" | "homebrew"
type PackageManagerPlatform = "darwin" | "linux" | "win32"
type PackageManagerLocationInput = {
  platform: PackageManagerPlatform
  home: string
  userDataPath: string
  configHome: string
  appData: string       // 主进程取得的 roaming/config 基目录
  localAppData: string  // 主进程取得的 local/cache 基目录
}
type PackageManagerLocations = {
  env: Readonly<Record<string, string>> // 只能包含下表列出的固定键
  writable: readonly {
    manager: PackageManager
    kind: "subpath" | "literal"
    path: string
    purpose: "cache" | "global-install"
  }[]
}
function resolvePackageManagerLocations(input: PackageManagerLocationInput): PackageManagerLocations
```

所有输入必填、无任意位置覆盖选项；输入来自主进程已有系统路径权威，必须为绝对路径。`C=<userDataPath>/package-managers`；cache/global 的路径先规划并 canonical 化，父目录由现有 planner 的 `mkdirp` 端口预建（不能靠围栏内 `mkdir` 去建立尚不可写的祖先）。CF/C1 与其真实目标、via/祖先冻结规则照旧优先；碰到保护位置不转成新可写根。main 的纯解析函数只产路径、不读用户配置或秘密、不执行工具。

| 工具 | 缓存/辅助数据：固定注入的键和值 | 全局安装决定 |
| --- | --- | --- |
| bun | `BUN_INSTALL_CACHE_DIR=C/bun/install-cache`；`BUN_RUNTIME_TRANSPILER_CACHE_PATH=C/bun/transpiler-cache` | 允许真实 `~/.bun/install/global` 和 `~/.bun/bin`；不以 `BUN_INSTALL` 重定向整个 Bun 安装 |
| pnpm | `npm_config_store_dir=C/pnpm/store`、`npm_config_cache_dir=C/pnpm/cache`、`npm_config_state_dir=C/pnpm/state` | 用真实平台 PNPM_HOME（下表）；global packages 与 bin 在它之下。仅设置固定 `PNPM_HOME`，不把 store 顺带留在 PNPM_HOME |
| yarn | `YARN_CACHE_FOLDER=C/yarn/cache`；现代版另设 `YARN_GLOBAL_FOLDER=C/yarn/berry`，其 metadata/mirror 也留在 C | Classic 的 global packages 在平台全局目录，bin 在固定 prefix/bin。现代 Yarn 没有 Classic `global add`；不虚构一个命令，BR-09 的该命令用 Classic 语义 |
| npm / npx | `npm_config_cache=C/npm/cache`（包括 `_npx`、logs） | 真实 prefix 的 `lib/node_modules`、`bin`（Windows 为 prefix 下 `node_modules` 和 shim）；不重定向用户全局安装到 C |
| pip | `PIP_CACHE_DIR=C/pip/cache` | 虚拟环境仍在项目；`--user` 写 Python 实际用户安装目录，缓存与其分开 |
| uv | `UV_CACHE_DIR=C/uv/cache`；`UV_PYTHON_INSTALL_DIR=C/uv/python` | `uv tool` 的真实用户 tools/bin（下表）；连接器专用安装由 #1760 消费本端口派生的 C/uv，不另放一份 HOME 缓存 |
| go | 保留 GOPATH 的开发工作区语义（默认 `~/go`）；显式 `GOMODCACHE=C/go/mod`、`GOCACHE=C/go/build`，下载工具链也在 module cache | 默认 GOBIN 为 `~/go/bin`；只放行 bin，不放行整个 GOPATH。显式 GOPATH/GOBIN 如已在项目/批准范围内照常使用，不因缓存修复把该根整体放开 |
| cargo | `CARGO_HOME=C/cargo/home`（registry/git 索引、crate cache 和安装临时数据）；project `target` 不改 | `CARGO_INSTALL_ROOT=~/.cargo`，实际写入只含 `bin`、`.crates.toml`、`.crates2.json`；RUSTUP_HOME 不重定向、不把整棵 `~/.rustup` 加入写集合 |
| Homebrew | 位置方向为 `HOMEBREW_CACHE=C/homebrew/cache`、`HOMEBREW_LOGS=C/homebrew/logs`、`HOMEBREW_TEMP=C/homebrew/tmp` | 使用真实安装 prefix；**执行契约未成立，§10 B1 阻塞，不冻结 Homebrew allow 清单** |

这些值是应用进程树的默认环境，不是命令黑名单；用户明确命令参数或项目配置仍按工具自身优先级解释，最终落盘受同一写集合约束。cache 重定向必须同时到达 shell、PTY、MCP 和 LSP 的真实 spawn；终端登录 rc 或连接器环境若覆盖这些默认值，缓存约定在最终 spawn 环境合成时重新投影。**已决定的新端口 R2**：环境合成消费 R1 的相同 `env`，只覆盖表内缓存键；不会清空用户 PATH、代理、registry 或凭据。不得通过修改机器上的 rc/npmrc 来安装这套环境。

缓存迁入 C 后撤掉真实 HOME 的 W7、W17、W18 放行（保留历史编号，不复用）；W8 历史文件不在本次改变内。旧缓存不拷贝、不删除、不热身下载。C 已在 W3 下；无须把整个应用状态根放开。

Cargo 改 CARGO_HOME 会改变用户全局 config 的查找位置。决定由主进程为 C/cargo/home 的 `config`/`config.toml` 建立指向原用户配置的只读读取链接，文件内容不复制、不记录；原配置的写入由 §4.3 精确清单承担。此读取桥不是旧数据迁移，也不为 cache 建链接。原 Cargo credentials 不搬入 C；私有 registry 的完整凭据解析尚未本机核实，见 §10 U2，不宣称已通过。

### 4.2 全局安装固定表

固定表是 R1 的组成部分，和 profile 同一个 owner；renderer、ext、#1760 不复制表。表列目录是包管理器安装树，**不是** HOME、`~/.config`、`~/.local`、`/usr/local` 或 `/opt/homebrew` 的整根放行。无版本上限；Python 的版本目录由其既有平台布局匹配，不钉死本机 3.9。

| 工具 | macOS / POSIX 固定路径模板（subpath，点名文件为 literal） | Windows 等价位置（仅环境/权限语义，不渲染 seatbelt） |
| --- | --- | --- |
| bun | `~/.bun/install/global`、`~/.bun/bin` | `%USERPROFILE%/.bun/install/global`、`.bun/bin` |
| pnpm | macOS `~/Library/pnpm` 的 `global`、bin 及该版本在 PNPM_HOME 根直接放的 shim；Linux `~/.local/share/pnpm` 同形；缓存仍由显式键到 C | `%LOCALAPPDATA%/pnpm/global`、PNPM_HOME 的 shim/bin |
| yarn Classic | `~/.config/yarn/global`（macOS/Linux）；`~/.yarn/bin`；prefix/bin 采用下面 npm 的固定 prefix 族 | `%LOCALAPPDATA%/Yarn/config/global`、`%LOCALAPPDATA%/Yarn/bin` |
| npm | prefix 族 `/opt/homebrew`、`/usr/local`、`~/.npm-global`、`~/.local` 各自的 `lib/node_modules`、`bin`，另含 node_modules 中工具自身的 install 元数据；prefix 自身不放行 | `%APPDATA%/npm`（node_modules 和 `.cmd`/`.ps1`/无后缀 shim） |
| pip --user | `~/Library/Python`（macOS framework）；`~/.local/lib/python*` 的 Python 用户安装树及 `~/.local/bin`（POSIX non-framework）；不得放开整个 `~/.local/lib` | `%APPDATA%/Python/Python<version>/site-packages` 与 `Scripts` |
| uv tool | `~/.local/share/uv/tools`、`~/.local/bin`；受管 Python 在 C/uv/python | `%APPDATA%/uv/tools`、用户 executable 目录；由 R1 用官方平台路径规则落成，不按盘符猜 |
| go | `~/go/bin`；用户指定且本来已可写的 GOBIN 不额外扩权 | `%USERPROFILE%/go/bin` |
| cargo | `~/.cargo/bin`；`~/.cargo/.crates.toml`、`~/.cargo/.crates2.json` 及 cargo 实际使用的同名原子写入伴随文件 | `%USERPROFILE%/.cargo` 下同样的 bin/安装元数据；缓存 C/cargo/home |
| Homebrew | 候选限 prefix 下 Cellar/Caskroom、链接树和安装元数据；**因 B1 未冻结，不能以整 prefix 放行代替决定** | Homebrew 无 Windows 原生对应；不引入另一种系统包管理器 |

已有/显式自定义 prefix 在表外且尚未获准时，仍可走 BR-08 的原有文件夹批准；没有新增“禁止自定义 prefix”的规则。固定表不改变操作系统所有权/ACL，也不赋予管理员权限。pnpm 根层 shim 必须编译为具体 shim 文件规则与其实际原子写入名称，不以整个 PNPM_HOME 的缓存树为代价；完整可执行名字从安装结果得出的动态列表与“随包固定表”是否能一致尚未证明，记 U3，不能把 `PNPM_HOME/**` 当成已裁决结果。

### 4.3 用户配置固定表与拒绝优先级

**已决定的新端口 R3**：在同一个 profile 权威内增加 `userConfigurationLocations(input: PackageManagerLocationInput): readonly ConfigFenceRule[]`，只输出下表的写 allow 条目（类型复用不等于把用户文件加入 CF 拒绝集）。该入口和 R1 共同提供给引擎策略作“常规用户位置”识别；不能借此自动批准包含该文件的整个父目录。环境里不增加位置开关。

| 类型 | POSIX（按实际 HOME/configHome） | Windows |
| --- | --- | --- |
| Git | `~/.gitconfig`、`<configHome>/git/config`，以及精确 `.lock` 伴随文件 | `%USERPROFILE%/.gitconfig`、Git for Windows 的 XDG config/git/config，同样的锁文件 |
| shell | `~/.zshenv`、`.zprofile`、`.zshrc`、`.zlogin`、`.zlogout`；`~/.bashrc`、`.bash_profile`、`.bash_login`、`.bash_logout`、`.profile`；`<configHome>/fish/config.fish`、fish/conf.d 下启动脚本 | PowerShell 的 CurrentUserAllHosts/CurrentUserCurrentHost profile（WindowsPowerShell、PowerShell 的 Documents 位置取系统已解析 Documents，不假设其没有重定向）；Git Bash 使用左列 HOME 文件；cmd 的 AutoRun 是 registry，本规格不引入 registry 写端口 |
| 常用开发工具 | `~/.npmrc`、`~/.yarnrc`、`~/.yarnrc.yml`、`~/.bunfig.toml`；`<configHome>/pip/pip.conf`、`~/.pip/pip.conf`、macOS `~/Library/Application Support/pip/pip.conf`；`<configHome>/uv/uv.toml`；`~/.cargo/config`、`~/.cargo/config.toml`；平台 Go 用户配置文件（macOS `~/Library/Application Support/go/env`，Linux `<configHome>/go/env`） | `%USERPROFILE%` 下 npm/yarn/bun 配置；`%APPDATA%/pip/pip.ini`、`%APPDATA%/uv/uv.toml`、`%APPDATA%/go/env`、`%USERPROFILE%/.cargo/config(.toml)` |

父目录由 main 预建；现有文件软链按真实目标落规则，同时保护路径绑定，不能因链接目标是引擎配置而放宽 CF/C1。文件写入包含原地修改及生产改文件工具实际采用的原子替换伴随名；Git 的 `.lock` 已由 P08 证实，其他工具的伴随名在真实入口证据中确定，不能为方便加 `~/.gitconfig*` 或 HOME 全局临时文件通配。第三方编辑器自己的备份约定不自动扩大这张固定表。

CF/C1 的权威仍为 `configFenceLocations`（`process-fence-profile.ts:122`）、`planConfigFence`（`process-fence-plan.ts:83`）、`planCredentialStores`（`process-fence-plan.ts:314`）和现有 credential stores 生产者；任何 cache/global/user-config allow 与 X1 之后，保留 `renderConfigFence`/`renderCredentialFence` 的原拒绝、真实目标与祖先节点规则。应用/引擎配置不进 R3；`~/.opencode`、`~/.zsh_sessions`、`~/.zcompdump*` 继续受既有保护。凭据保护指 Code Puppy 保存的凭据，不把整份用户 `.npmrc` 擅自列成不可写；向模型输出秘密的问题归对应规格。

### 4.4 本人批准目录：同一个登记与签发所有者

v4 替代前文「外部目录卡片批准永远不能登记」以及 S4 的“六个记录点”穷举；**新增一个明确的人类动作来源**，不把导航、SSE、命令或普通 permission reply 变成授权来源。X1 私有类及绑定当前引擎的签发、原生消费、运行内历史不变。

**已决定的新端口 R4**：现有审批卡的具体点击处理经 preload 调主进程；不放进工具 RPC 或 sidecar→main 协议。其语义是“将这次本人看到并批准的具体目录加入现有目录授权”，名字按域定义：

```ts
type DirectoryWriteApproval = {
  server: string
  sessionID: string
  requestID: string
  requestFingerprint: string
  decisionID: string
  decision: "once" | "always"  // reject 直接走原审批入口，不调用本端口
  directories: readonly string[] // 快照里逐项显示的具体绝对目录，不是 glob/save
}
type DirectoryWriteApprovalResult =
  | { outcome: "granted" | "no-fence" }
  | { outcome: "conflict" | "expired" }
  | { outcome: "failed"; reason: "home-or-app-state" | "protected-config" | "grant-failed" }
function approveDirectoryWrite(input: DirectoryWriteApproval): Promise<DirectoryWriteApprovalResult>
```

所有字段必填，目录数量不加上限。request/decision ID 复用已有审批身份；目录列表从同一已核验且正呈现的快照冻结，调用方不能补一个未显示的目标。`external_directory` 的生产请求新增 **R5**：`metadata.directoryAccess: { access: "read" | "write"; directories: readonly string[] }`，必填字段、无缺省、无数量上限；内容直接消费 `FileAccess.resolve` 的 `externalDirectory.directory`，与 resources 一一对应；不取 `save` 的较宽 root，不从 shell 文本猜路径。没有具体路径的第三方请求不能凭自述制造主进程授权；已有卡片须实际呈现具体目录才有可批准对象。

R4 的入口只允许现有应用 renderer 的 preload sender；精确点击处理是唯一生产调用点，不按最近一次用户输入/激活时限取资格。账本的 `current`/fingerprint 冲突与过期检查先完成，批准路径绑定该份快照、该 renderer 和当前本机引擎代际。**先记录资格、等现有 tracker.grantWrite 收到消费成功，再由原 ApprovalEngine.decide 发 permission reply**；因此原工具这一次即可继续落盘，不能依赖下一条命令重试。主进程的批准簿按 decisionID 幂等，相同决定重复消费同一结果，冲突/过期不登记、不签发。R4 返回 no-fence 时不伪造 grant。

批准源调用同一 `checkWorkspaceDirectory`、目录身份判定、`userOpened.register` 与 tracker `grantWrite`；其语义名称虽保留 `userOpened`，成员扩为“本人打开或本人批准”，不另造 registry。批准不创建项目 tab；运行内授权仍进入 `carriedWorkspaces`，后续同代/换代引擎可继续使用；不增加批准有效期或重启后的持久记忆。文件夹不存在时不得把其更宽祖先当作获准目标；主进程仅准备批准的具体目录，沿现有 canonical/保护判定校验其实际落点，再签发。此准备能力是 R4 的组成部分，不是引擎可任意调用的 mkdir 服务。

**已决定的新端口 R6**：ext 的现有 permission evaluate hook 消费主进程对具体目标给出的“已在集合中 / 需本人目录批准 / 受保护”结果。只读/既有 deny 优先。表内 global/user-config 不再因 `external_directory` 多问一次，命令/改文件审批仍按既有档位；未获准的表外写目标在全部批准档也保持 BR-08 的目录卡片。读操作不因本增量新增写授权要求；R5 的 `directoryAccess.access`，取自 FileAccess 的实际调用种类，不能从工具名猜。R6 是只读询问/投影，不允许 sidecar 用它登记目录或申请令牌。既有 session always 不能跳过尚未获得的 OS 目录授权。

用户拒绝时没有任何 grant；失败沿现有审批失败/重试呈现，不把卡片装成“批准成功”，不发允许回复。Home/状态/受保护位置沿已有一句说明，不能把失败变成让用户重启。远端审批不签发本机目录扩展。缓存/global/user-config 是静态集合，不伪装为本人批准记录。

### 4.5 能力 seam map（现有端口 / 已决定 raise / 阻塞）

| 依赖能力 | 可合法调用的现有符号或本次 raise | 状态 |
| --- | --- | --- |
| 路径/环境单一权威，#1760 复用 | R1 `resolvePackageManagerLocations`；R2 最终 spawn 环境合成；既有 `createSidecarEnv`（`sidecar-env.ts:221`）、`spawnLocalServer`（`server.ts:487`） | 已决定 raise；目前只有 uv 单点赋值 |
| 静态清单落到真策略 | `planProcessFence`（`process-fence-plan.ts:229`）、`renderProcessFenceProfile`（`process-fence-profile.ts:215`）、R1/R3 输出；原 planner deps.mkdirp/realpath/compile | 现有端口 + 已决定输入扩展；不增加第二个 renderer |
| 用户配置与固定安装位置权限投影 | R3 `userConfigurationLocations`、R6 只读 writable 判定；`registerPolicy`（`ext/src/policy/index.ts:75`）的 evaluate hook | 已决定 raise；权限档仍用现有 gate/catalog |
| 具体批准目标与读写语义 | R5 在 `FileAccess.authorizeExternal`（`core/src/file-access.ts:120`）携带 `directoryAccess`（directories/access）；卡片沿现有请求事实核验 | 已决定 raise；不把目前没有的 metadata 说成可用 |
| 本人点击到 main、授权先于允许回复 | R4 `approveDirectoryWrite`；`PermissionDialog` 点击（`:84-129`）、`ReceiptLedger.decide`（`contract/receipts.ts:102`）增加 pre-reply await 接缝 | 已决定 raise；不得在代际翻译器里做权限决定，不切换 session API 代际 |
| 资格/身份/历史 | `UserOpenedRegistry.register`（`process-fence-workspaces.ts:321`）、`checkWorkspaceDirectory`（`process-fence-profile.ts:589`）、`FenceWorkspaceTracker.grantWrite`（`:401`）及 carriedWorkspaces | 复用，R4 是唯一新增登记来源；保留现有竞争防护 |
| 活进程树放行 | `SidecarListener.grantWrite`（`server.ts:732`）、`FenceAddon.issueFileExtensionToProcess`（`process-fence-apply.ts:35`）、sidecar `grant-write`（`:157`） | 复用，不加原生签发方式 |
| 真实入口装载及保护优先 | `applyProcessFence`（`process-fence-apply.ts:86`）、CF/C1 既有 planner/renderer | 复用；目录合并后再走同一个生产入口 |
| Homebrew 在外层围栏内完整安装 | 内部 `Sandbox.run_or_fork`/`Sandbox.operation` 不能由本应用合法替换；未找到满足默认 prefix/普通用户的可调用端口 | **B1 未映射，阻塞；不是一个已决定 raise** |
| Windows | R1/R3 平台投影、既有权限 gate 和 no-fence 分支 | 不增 Windows 围栏；真机尚未验证 |

## 5. 数据与失败

包缓存和安装仍由包管理器写盘；不新建应用数据库、迁移历史缓存或复制用户凭据。主进程只准备清单目录与已本人批准的具体目录，资格仍属现有运行内所有者。前文运行内已可写历史、送出但答复不明的令牌、跨代引擎孤儿风险继续适用；新静态 global 根也必须被 `generationWrites` 从**实际 apply 的 profile**读到，不能手抄一份“已覆盖”判定。

目录授权与 permission reply 没有跨进程事务。关键窗口在授权成功后、HTTP reply 之前：用户已经批准该目录，它可以保持可写；原请求继续挂起，按相同 decisionID 重试回复即可，不能假称撤回已消费的扩展。原生消费失败不发 allow；过期/指纹冲突先于登记；只收到引擎 replied、甚至引擎自行移除 pending，都不能补登记。R4 成功结果绑定当时引擎代际；代际变化按 tracker 的运行内历史重新确认当前代，不拿旧消费确认解锁新请求。

CF/C1 优先于任何 allow，包括配置文件软链、安装脚本改名祖先和审批祖先目录。POSIX 权限不足、网络/registry 错误仍由原工具报错；不可把它们标成写围栏成功。B1 不能靠重试解决，不实现后台反复重启或未围栏代理。

## 6. 架构落点与真实入口证据边界

沿 `docs/architecture/modules.md:51` 的桌面宿主与 `:41` 的 Schema 边界：位置/固定值留 main 的 profile 权威，preload 只暴露本机批准动作及只读结果，renderer 不 import main；core/protocol 不依赖桌面，R5 只携带 FileAccess 已有域数据，ext 从宿主桥消费投影。R1 纯函数不要求 engine import main；#1760 的 main 侧消费者取得结果后将环境交给连接器。共享消息类型走既有 shared/schema 边界，不让 core 反向依赖 Server。没有新顶层模块目录。

K1：不另建权限档名单。K2：缓存、全局清单、用户配置位置都由同一 profile 所有者提供；授权复用 tracker、X1、CF/C1，不复制判断。R4 的 preload sender、具体点击调用点与旧记录点采用同一个信任面；目录扩大不能由工具 RPC、sidecar 回信或普通 HTTP 触发。未引入新的结构例外。

证据必须经过 `spawnLocalServer → planProcessFence → sidecar.start/applyProcessFence → 实际命令/PTY/MCP`，含最终环境；只测纯 resolver、只用讨论里的 HOME mimic 或只见退出 0，不能声称 AC-09..12 成立。以真实包管理器生成的项目/安装输入留来源，围栏外核对项目依赖、全局命令可调用、用户配置真实内容和原 HOME 缓存无变更。撤掉缓存 env 的 bun/go/cargo 对照必须失败；撤掉 global/config 清单的对应操作必须失败；Git 撤锁路径须失败。外部批准须在原请求上写成功、已有子进程和之后的子进程均可写、PID 不变；移除 R4 时同一写入失败且无落盘；拒绝、自回复、伪造/重放、深链接与 sidecar 消息不产生目录授权。加入新 allow 之后，CF/C1 与两处 shell 缓存负例仍须保持拒绝。上述是设计成立的可证伪标准，具体用例、命令编排和文件归 plan.md。

Windows 不运行 Seatbelt，也不宣称 CF/C1 有 OS 围栏保证；沿规格原有平台边界。相同命令与文件操作仍消费权限档：“全部批准”直接执行，“请求审批”先问，拒绝后无该次写入；真实目录来源必须使用 Windows 路径权威和大小写规则。Windows 实机、带签名生产进程树、本次各管理器全量安装均未执行，留给真实入口证明；不以 macOS 的临时目录探针代替。

被否决：放开真实 HOME 缓存（违反 AC-09）；把 HOME/XDG 整体指到 C（改变项目/配置查找）；在每个 connector 或 shell wrapper 复制路径表（违反 K2）；先回复后授权（原请求会竞态失败）；看到 permission.replied 自动登记（模型可制造）；围栏外 main 代跑安装（破坏 CF/C1 和进程树边界）；设置 Homebrew 的 nested 跳过变量作为通用解法（P09：默认 prefix 和常见用户组不支持）。

## 8. 拆分决定

同仓的所有权接缝只有 #1760：#1759 的 profile 所有者产 R1 的缓存位置、环境键与目录预建语义；#1760 的 launcher 所有者消费该结果，负责它自己的 Node/uv 启动器与 Python 版本、下载和准备状态。#1760 可以按 R1 开始设计，其真实围栏验收依赖同一实现与生产环境接线。两边不各持有 `uv-cache` 或 npm cache 常量；连接器单条环境不能把缓存改回 HOME。launcher 的运行时布局由其设计负责，不能通过本设计扩大到 HOME。不存在跨仓技术拆分；B1 不阻止独立缓存与目录批准的设计，但阻止整份 v4 冻结。

## 9. 回滚

不适用。没有数据迁移或不可逆数据变更；不设计兼容开关或旧缓存回退。

## 10. 裁决与审查结论

| 裁决 | 适用范围与依据 |
| --- | --- |
| 缓存统一进 C，真实全局位置分开，清单只有一个 owner | v4 AC-09/11，P01/P02/P07；R1/R2；不拷贝旧缓存 |
| 本人目录批准先 grant 后 permission reply，复用既有 X1/registry | v4 BR-05/08、AC-10，P03..P06；新增来源取代旧 S4 穷举，未放宽“模型不能登记” |
| 用户配置按文件/必要伴随名放行，CF/C1 最后拒绝 | AC-12，P08；既有保护规格仍是权威 |
| Windows 复用环境/权限，无 OS 围栏承诺 | spec v4 Windows 段与 AC-04；未实机验证 |
| B1：Homebrew 尚无合法执行接缝，v4 草案不能冻结 | P09；`BLOCKED: design — BR-09/AC-11 Homebrew 嵌套 Seatbelt — 需要一个不绕开现有围栏、不修改用户 Homebrew、不要求新增用户步骤，且支持默认 prefix 的可调用执行入口及实证` |

**待 owner 定：无已提出的产品裁决。** B1 首先需要技术入口证据，不能把它包装成 owner 已同意的“仅支持某种 Homebrew/仅安装 bottle/要求换 prefix/围栏外代跑”限制；若确需改变规格，再带具体后果返回 owner。本设计不采用这些限制。

**仍未验证的断言：** U1：除 P07 外各变量在安装/lifecycle scripts、终端 rc 和 MCP 覆盖环境之后仍生效；Yarn/Go/Cargo/uv 全局布局及锁/临时文件；U2：重定向 CARGO_HOME 后原用户 config 的读取桥、私有 registry 凭据及 rustup shim 可用性（尚无真实样本）；U3：pnpm 不同版本的根层 shim 与安装元数据能否被固定表精确表达。U1–U3 都不是已通过的 seam/行为证据，不能由实施方静默扩成父目录放行；涉及固定契约变化回本增量处理。Homebrew 的内核嵌套失败已实测，具体 brew 完整失败链仍是读码推断。

| 轮/版本与范围 | 检查方 | 结论与证据 | 遗留去向 |
| --- | --- | --- | --- |
| 作者交接 / 代码 `9f08c506d9842d319616c7e45c33d3b9c3279e48`，spec v4 pinned SHA，限本增量 | Codex（GPT-6，designer；无独立审查，无子代理） | 已读批准输入、沿用旧有效收据；P07/P08/P09 小探针；旧名称扫描 10 pass/0 fail；文档契约当前与 HEAD 基线均 72 个 error、无新增 finding（只更新本设计索引行，其余既有断链/索引问题未修）；`git diff --check` 通过；R1–R6 明确为新接缝；B1 无合法端口，送审草案，不标 approved | B1 回 #1759 调度方；U1–U3 在本节诚实保留，不宣称可直接实施 |
