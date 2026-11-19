---
id: DESIGN-child-process-write-fence
title: 用户亲手打开的项目当场可写(不重启引擎)技术设计
summary: 围栏 profile 在装上时多声明一条只认 Code Puppy 私有扩展类的写放行、并禁止围栏内签发该类;用户经「打开项目」或在应用里进入某个项目时,主进程用既有原生模块签发该目录的令牌、经既有的主进程↔引擎窄消息交引擎进程消费,整棵进程树(含已在跑的终端与 MCP)当场可写,不换代;放行资格与下一代可写集同一个判定(外部链接与检疫目录不算用户亲手打开);「只读」胶囊与「重新启动」按钮退出常规路径,只在三种剩余情形里各给一句话
kind: tech-design
status: draft
spec: SPEC-child-process-write-fence
spec_version: 1
review:
  rounds: 0
  reviewed_sha: ""
  verdict: ""
owners: [owner]
last_reviewed: 2026-11-19
---

# DESIGN-child-process-write-fence｜用户亲手打开的项目当场可写 技术设计

只放决定:契约、落点、失败处理、裁决。文件清单、提交顺序与测试归实施方的 `plan.md`。§3、§7 已退役,编号不复用。

坐标约定:`A` = `origin/alpha@a20dadb942`(0.2.4,本设计的读码基线)。「测」= 本设计跑过的命令(宿主 macOS 26.3.1 / 25D771280a,arm64,`/usr/bin/clang`;实验程序未签名、非 Electron、非 hardened runtime);「读」= 读码得出;「推」= 推断,未验证。实验源码与原始输出在本机 `~/.cache/alpha-orch/2026-11-19/fence-ext/`(`src/probe.c`、`src/probe2.c`、`src/probe3.c`、`result*.txt`),不入仓。

## 1. 基线

- Spec:[SPEC-child-process-write-fence v1](https://github.com/impharaon/alpha-code/blob/a20dadb9424bf4674fd61d0dddeae2694fa67ca0/docs/specs/child-process-write-fence/spec.md)(REQ-159 进程围栏的现行规格,给出本设计必须守住的安全承诺,见 §6 安全面)。**v1 里没有本增量的 AC**;本增量的需求来源是下面三段 owner 原话。规格补版本归编排者(`delivery-spec`),不阻塞本设计。
- 本增量要成立的结果(从 owner 原话直接读出,不是新 AC):①用户自己打开的项目当场可写,不重启引擎;②常规路径上不出现「只读」与「重新启动」;③只有用户本人的打开动作能扩大可写范围,模型与会话里的 shell 做什么都扩大不了;④真正无法当场可写的剩余情形,用一句白话说明。
- owner 原话(2026-11-19,经编排者转述,逐字):
  - 关于「打开新项目后空闲时自动重启引擎」:「做。」
  - 关于现状(新项目在 Code Puppy 重启前只读;标题栏「只读」胶囊带「重新启动」按钮):「这个是什么意思啊，这个交互逻辑我觉得有点乱。我希望可以尽量用户无感。不能因为一个文档生成要重启一次引擎吧。」
  - 关于两条路(第一条 = 空闲时后台换引擎;第二条 = 用户亲手打开的项目当场可写、完全不重启):「如果第二条可行，就选第二条，这样才是真正的无感，好的，如果这样我觉得可以。」
  - 读法:第三段在第二条可行时取代第一段的「做。」。§2 P-03 实测第二条可行 ⇒ 选第二条;第一条不实现、也不作为分层兜底。
- 背景(只引用、不重述):REQ-159 方案基线 `docs/design/2026-09-09-req159-process-fence-baseline.md` §三 I1、§四 U2;U2 决定书 `docs/architecture/2026-09-09-multi-workspace-fence-decision.md` §3、§4 第 3 条;落地形状 `docs/architecture/2026-09-09-req159-process-fence.md` §2、§3(5b/5c)、§8.2;披露设计 `docs/design/2026-09-10-req159-sandbox-disclosure/design.md`(owner 2026-09-10「保留弹层里的『重新启动 Alpha』按钮」—— 本路径上由 2026-11-19 原话取代,见 §10 第 6 条)。

## 2. 地面真相

**P-01 围栏 profile 的形状(读)。** `(allow default)` → `(deny file-write*)` → 一个 `(allow file-write* …)` 块(W1 每个工作区一条 `subpath`,其余 W2–W19 固定行)→ 四条网络行(`packages/ui-mac/src/main/process-fence-profile.ts:150-177`)。profile 里**没有任何引用沙箱扩展的规则**;`file-issue-extension` 落在 `(allow default)` 之下。

**P-02 基线 I1「装上之后无法放宽」只对 profile 文本成立(测)。** 若装上时 profile 已声明一条 `(extension "<类>")` 写放行,之后由未被围栏的进程签发、被围栏进程消费的令牌即可把写入放宽到该令牌指定的目录(下文 E1–E3)。今天的 profile 没有这条规则,所以今天消费任何令牌都放宽不了(E1 `none` 臂)。

**P-03 四组实验(测;每组都带会失败的一臂)。** 父进程(未被围栏,替身 = Electron 主进程)先用 `sandbox_extension_issue_file` 为目录 `outside` 签发令牌,再 `sandbox_init` 把自己关进与生产同形的 profile(`(allow default)`、`(deny file-write*)`、只放行 `allowed`),然后在围栏内消费、写盘。判据 = 文件是否落盘(`find` 实读)。

E1 `probe.c`,三臂只差 profile 尾部(`clang -O0 -o probe src/probe.c && probe <allowed> <outside> <other> <none|nodeny|deny>`):

| 臂(profile 尾部) | 消费前写 outside | 伪造令牌 | 消费主进程令牌后写 outside | 围栏内自签 `other` 并消费后写 | 消费后新 exec 的子进程写 outside |
| --- | --- | --- | --- | --- | --- |
| `none`(= 今天的生产形状) | EPERM | consume=-1,EPERM | **EPERM** | 签得出、消费=2,EPERM | EPERM |
| `nodeny`(+ `(allow file-write* (extension "com.apple.app-sandbox.read-write"))`) | EPERM | -1,EPERM | OK | **签得出、OK(洞)** | OK |
| `deny`(nodeny + `(deny file-issue-extension)`) | EPERM | -1,EPERM | OK | 签发返回 NULL(errno=1) | OK |

落盘实读:`none` 只有 `allowed/a-before.txt`;`nodeny` 多出 `other/x-after-self.txt`(自签放宽成功,即洞);`deny` 只有 `allowed/…`、`outside/o-after.txt`、`outside/late-child-exec.txt`。

E2 `probe2.c`:换成**私有扩展类** `app.codepuppy.workspace-write`,并测「围栏装上之后、消费之前就已 fork 出来的子进程」(继承同一个沙箱,= 已在跑的终端 / MCP):

| 臂 | 消费外类(app-sandbox read-write)令牌后写 | 消费本类令牌后写 | 消费前已在跑的子进程,父进程消费后写 | 消费后新 exec 子进程 mkdir + 写 |
| --- | --- | --- | --- | --- |
| 规则只认私有类 | consume=1,**EPERM** | OK | **OK** | OK |
| 对照:规则认 `com.apple.app-sandbox.read-write` | consume=1,**OK** | OK | OK | OK |

⇒ 消费对整棵进程树生效,包括消费之前就在跑的子进程;规则只认私有类时,任何别人签发的 app-sandbox 令牌都放宽不了我们的围栏;认苹果的类则会。(该臂子进程那行 `early-exec FAIL` 来自探针最小 profile 没放行 `/dev/null`,文件本身已落盘。)

E3 `probe3.c`:私有类写放行 + **只禁签发私有类** `(deny file-issue-extension (extension-class "app.codepuppy.workspace-write"))`:主进程令牌消费后写 OK;围栏内自签私有类 → NULL;自签 app-sandbox read-write → 签得出、消费=2,但写 `other` 仍 EPERM;自签 app-sandbox read → 签得出。落盘实读只有 `outside/after.txt`。⇒ 只禁私有类就足够,围栏内签发苹果自己那几类(LaunchServices 打开文件等流程可能用到,推)照旧不受影响。

E4 LaunchServices 在围栏内可达:`/usr/bin/sandbox-exec -f net.sb /usr/bin/open -g 'zzcpnotregistered://open-project?directory=/x'`(`net.sb` = 生产同形写规则 + 四条网络行 + `(deny file-issue-extension)`)→ `No application knows how to open URL … kLSApplicationNotFoundErr`,exit 1 —— 这是 LaunchServices 的绑定结论,不是沙箱拒绝;对照臂同一 profile 往 HOME 下写 → `Operation not permitted`。⇒ 被围栏的工具能把 URL 交给 LaunchServices;对已注册的 `codepuppy://open-project?directory=…` 会照常送达应用(推;为不惊动 owner 正在运行的应用,未对真协议实发)。

**P-04 「用户打开的工作区」真源(读 + 测)。** 真源 `<appData>/codepuppy-state/fence-workspaces/<env>.json` 只由主进程写,内容 = renderer tab 状态投影(recent → tab 栏 → info),每次 `store-set` / `store-delete` / `store-clear` 重算(`process-fence-workspaces.ts:170-235`,`ipc.ts:160-175`);boot 时「store 里有、真源里没有」的目录本会话检疫(`process-fence-workspaces.ts:176-183`、`:203-206`)。本机真源实读 3 条 = 当前开着的 tab(`/Users/pharaon/code-puppy` 与两个今日测试目录),日志 `workspace truth updated … (takes effect at the next engine generation)`。⇒ 关掉 tab 即出真源;从项目列表重新进入一个昨天关掉的项目,今天就是「只读直到重启」—— 这是现状里最常见的那一格。

**P-05 项目列表的来源(读)。** 首页 chip 与侧栏列的是引擎 `project.list`(`workspace-chip.tsx:98-113`,`codepuppy-sidebar.tsx:916-933` 注释);引擎库在 W4 之下,围栏内写得了 ⇒ 列表条目可被伪造(推)。会话页的目录 = 引擎回报的会话目录(`docs/architecture/2026-09-09-req159-process-fence.md` §8.2 表)。

**P-06 系统目录选择器(读)。** `ipc.ts:185-207` `open-directory-picker`:主进程弹系统对话框,返回用户选中的路径(`CODEPUPPY_OPEN_DIR` 环境变量短路,由启动者设定)。调用方:首页 / 新对话 chip「打开项目」(`workspace-chip.tsx:126`)、侧栏「打开项目」与 Cmd+O(`codepuppy-sidebar.tsx:922-933`、`:950`)、`app/src/workspaces/selection/picker.tsx:34`、插件宿主(`app/src/runtime/plugin/host-apis.tsx:326`)、自动化面板(`automation-panel.tsx:265`)、云端两个面板。

**P-07 深链接(读 + 测)。** 路由表 `shared/route-manifest.ts:70-90`:`new-session?directory&prompt`、`open-project?directory`;主进程入口 `index.ts:686-711`(`second-instance`、`open-url`)→ `deepLinks.ingest` → `deep-link-queue.ts:332` `decodeDeepLink`。四个仓里没有任何产品面产出项目深链接(`git grep -E "open-project|new-session\?directory|codepuppy://"` 于 alpha-code / alpha-web / alpha-platform / alpha-code-plugin:只有 `codepuppy://auth/callback`)。结合 E4:深链接分不出是用户点的还是被围栏的工具发的。

**P-08 拖放(读)。** `A` 上没有「把文件夹拖进来打开项目」的入口:输入框的 drop 是附件(`codepuppy-composer.tsx:2023`、`app/src/composer/attachments/attachments.ts:245`);主进程没有 `open-file` 处理(`index.ts` 无该事件)。本设计不新增拖放入口。

**P-09 重载后回原处(读)。** 0.2.2 的路由恢复存在本窗口 `sessionStorage`,只在 `PerformanceNavigationTiming.type === "reload"` 时使用,冷启动不用(`renderer/reload-place-store.ts:1-60`)⇒ 不是一条「无用户动作就把某目录变成当前工作区」的冷启动通路。

**P-10 写探针链路(读)。** 合同 `workspace-write-probe.ts:30-62`;sidecar 同步执行 `sidecar.ts:122-138`;主进程请求簿 `server.ts:586-600`、`:707`;IPC `ipc.ts:94-98` → `index.ts:994`;renderer 咽喉 `workspace-writable.ts:34`(会话页与新对话页 / 首页两个宿主各挂一次),核 `workspace-writable-core.ts:36-71`(按「引擎代 + 目录」缓存,只在 `sandboxApplied()` 时问)。

**P-11 现有只读界面(读)。** 顶栏胶囊 + 弹层 + 「重新启动 Code Puppy」(`session-workspace/session-workspace-shell.tsx:144-208`,动作 `relaunch` `:200`、`:261`、`:656-678`,= 整个应用重开);chip 尾标 `workspace-chip.tsx:41-80`;文案 `i18n/zh.ts:1925-1930`、`i18n/en.ts:1951-1956`。

**P-12 原生模块(读)。** `native/codepuppy-fence/codepuppy_fence.c` 今天只导出 `apply`(+ 钥匙串三函数);`FenceAddon` 类型 `process-fence-apply.ts:31-39`;主进程已加载同一个 `.node`(`index.ts:584`,`nativeKeychainPort` 惰性加载);sidecar 在 `start()` 第一句 apply(`sidecar.ts:234-245` → `process-fence-apply.ts:80`)。

**P-13 第一条路的代价(测,读本机出货包日志;只作背景)。** `~/Library/Application Support/ai.opencode.desktop/logs/*/startup-timeline.log`:

| 日志 / 触发 | recovering → fork 开始 | fork | → renderer 重载 → 根组件重挂 | 合计(到重挂) |
| --- | --- | --- | --- | --- |
| `20261118T024657` identity-change | 0.08 s | 901 ms | +0.12 s(随后模型表 0.12 s 就绪) | ≈1.2 s |
| `20261119T022517` connector-change | **5.08 s** | 1230 ms | +0.17 s | ≈6.4 s |
| `20261119T075413` connector-change | 0.03 s | 992 ms | 重挂在 3.2 s 之后(与紧随的第二次换代交叠) | ≈4.2 s |

每次都整页重载,并有 U2 §3.2 的损失(终端全灭、工具子进程变孤儿)以及其它对话里正在跑的回答被取消。这不是在真引擎 harness 上的测量:第二条可行之后耗时改变不了决定(`delivery-focus` 第 2 条),所以没跑。

**P-14 模型能逼出一次换代(推,未执行)。** 崩溃自愈在白名单里(`sidecar-lifecycle.ts:10-21`,`planSelfHeal` 1 s → 16 s);`(allow default)` 放行 signal,围栏内的 shell 能给自己的引擎进程发信号。⇒ 对攻击者而言,凡是能进真源的目录,等价于「现在就」能进可写集。§6 安全论证的底座就是这一条。

**P-15 「访问项目以外的文件夹」卡片(读)。** `packages/ext/src/external-directory-rule.ts:31-41`:批准只放行引擎层的 `external_directory` 权限,不动围栏。

## 4. 接口契约

### 原生模块(决定的新增能力)

同一个 `codepuppy_fence.node` 新增两个函数,从 `apply` 已经 dlopen 的同一个 libsandbox 里 dlsym;dlsym 失败按 `apply` 的同一条规矩抛 JS 异常(响亮,不返回假成功)。

```ts
// packages/ui-mac/src/main/process-fence-apply.ts —— FenceAddon 追加
export type FenceAddon = {
  // …既有字段不变
  /** 只在 main 调。为 path(含子树)签发一枚 extClass 类的沙箱扩展令牌。token=null 时 errno 为 libsandbox 置的码。 */
  issueFileExtension: (extClass: string, path: string) => { token: string } | { token: null; errno: number }
  /** 只在 sidecar 调(apply 之后)。handle ≥ 0 = 成功;-1 = 失败,errno 为码。 */
  consumeExtension: (token: string) => { handle: number; errno: number }
}
```

不导出 release:令牌随引擎进程生命期,项目关掉不收回(与 W1 同:本代开着的工作区整代可写)。

### profile 新增两行(唯一权威 `process-fence-profile.ts`)

```ts
export const WORKSPACE_WRITE_EXTENSION_CLASS = "app.codepuppy.workspace-write"
```

```
(allow file-write* (extension "app.codepuppy.workspace-write"))                   ; X1 用户本代亲手打开的项目
(deny file-issue-extension (extension-class "app.codepuppy.workspace-write"))     ; X2 围栏内签不出本类
```

位置:`(allow file-write* …)` 块之后、网络行之前(X1 必须在 `(deny file-write*)` 之后)。类名只在这一个常量里定义,签发方(main)与 profile 渲染都读它。形状闸(逐行全等)把 X1/X2 收进去;写入点登记簿里写探针那一处的根从 `W1` 改记 `W1+X1`。依据 E2、E3。

### main → sidecar 窄消息(与写探针同一种形态)

```ts
// 归 workspace-write-probe.ts 所在的「主进程↔引擎进程工作区写入」合同
export type WorkspaceWriteGrantCommand = { type: "grant-write"; id: number; token: string }
export type WorkspaceWriteGrantReply = {
  type: "grant-write-result"
  id: number
  outcome: "granted" | "failed"
  /** 人读原因(errno / 超时 / 子进程状态),只进日志 */
  detail?: string
}
```

- 解析与写探针相同:形状不对就当没有(sidecar 不回,main 侧超时)。
- sidecar 收到即同步 `consumeExtension`,不等引擎就绪(围栏在 `start()` 第一句已装好);非 darwin / 未装围栏的进程答 `failed`。
- main 侧请求簿与写探针同语义:5 s 超时、子进程退出、没有活着的 sidecar ⇒ `failed`。
- **方向只有 main → sidecar。** 没有任何 sidecar → main 消息会让 main 签发令牌。

### 放行资格:一个判定,两个消费者(K2)

```ts
// packages/ui-mac/src/main/process-fence-workspaces.ts(「用户打开的工作区」的权威)
export type WorkspaceEligibility =
  | { eligible: true; directory: string } // resolve 后的绝对路径
  | { eligible: false; reason: "home-or-app-state" | "not-opened-by-you" | "not-a-directory" }

export function workspaceEligibility(
  directory: string,
  ctx: {
    homeDir: string
    appStateRoot: string
    realpath: (p: string) => string
    isDirectory: (p: string) => boolean
    quarantined: ReadonlySet<string> // tracker 既有的检疫名单
    deepLinkedThisRun: ReadonlySet<string> // 本次应用运行里由深链接送来的目录
    pickedThisRun: ReadonlySet<string> // 本次应用运行里经系统目录选择器选中的目录
  },
): WorkspaceEligibility
```

- 规则 4 / 5 / 5b 复用 `selectWorkspaceUnion`(`process-fence-profile.ts:348-393`)的逐候选判定:抽成一个函数,`selectWorkspaceUnion` 与本函数都调它,不写第二份(K2)。规则 5/5b → `home-or-app-state`;规则 4 → `not-a-directory`。
- `deepLinkedThisRun` 或 `quarantined` 命中且不在 `pickedThisRun` → `not-opened-by-you`。`pickedThisRun` 能盖过这两条,盖不过规则 4/5/5b。
- 消费者一:**运行期放行**(下一小节)。消费者二:**真源 tracker 的 `recompute`** —— 新增目录先过本判定,`not-opened-by-you` 不进真源(检疫照旧;新增的是深链接一项)。⇒ 本代运行期能放行的,永远不比下一代 W1 会包含的更多(W1 的 K=32 / 字节封顶是尺寸裁剪,不是安全过滤)。
- `pickedThisRun`:`ipc.ts` 的 `open-directory-picker` 在把结果交回 renderer 之前把每个选中路径(含 `CODEPUPPY_OPEN_DIR` 短路)resolve 后记入。`deepLinkedThisRun`:`deep-link-queue.ts` 的 `ingest` 在 `decodeDeepLink` 得到 `directory` 的那一处记入(覆盖 `second-instance`、`open-url`、首启 argv 三条来路)。两者只在内存里,随应用运行结束。

### IPC:既有 `workspace-write-probe` 通道,语义扩成「能放行就先放行,再探」

通道名与 preload 方法名不变(`ipc.ts:94-98`,`workspaceWriteProbe`)。主进程处理一次请求:

1. 本代没有围栏(非 darwin / 未在线)→ 照旧答 `unknown`。
2. `workspaceEligibility(directory)`;不 eligible → 照旧探针,若答 `denied` 则带上 `reason`。
3. eligible 且本代放行账本里还没有它 → `issueFileExtension(WORKSPACE_WRITE_EXTENSION_CLASS, directory)` → `grant-write` → 等应答 → 记账本(只记成功的)。
4. 照旧发写探针,答案带回 renderer。

```ts
export type WorkspaceWriteProbeResult = {
  outcome: "writable" | "denied" | "unknown"
  detail?: string
  /** 只在 outcome = "denied" 时出现:为什么现在写不进去 */
  reason?: "home-or-app-state" | "not-opened-by-you" | "grant-failed"
}
```

- 放行试过、探针仍 `denied` → `grant-failed`(main 日志一行,带目录与失败原因)。eligible 但签发 / 消费失败 → 同上。
- 放行账本:main 内存里每代一份 `Set<目录>`,该代子进程退出即作废;renderer 的缓存本来就按引擎代分(`workspace-writable-core.ts:36`),换代后会重问,重问即重放行。
- 用户亲手打开的入口(§6 安全面 S4)全部会经过这个咽喉:系统目录选择器选中后,chip / 侧栏立刻把它变成当前工作区;从项目列表、侧栏、搜索结果、首页进入一个项目或它的对话,会话页 / 新对话页挂载即问。**本设计不在这些入口逐个加调用**,也不在发送路径上加等待(§5)。

### 界面

- 常规路径:咽喉先放行再探,探针答 `writable` ⇒ 顶栏胶囊与 chip 尾标都不出现(既有判据钩子 `data-codepuppy-workspace-readonly` / `data-codepuppy-workspace-chip-readonly` 缺席)。
- 剩余情形(`denied` 带 `reason`):保留「只读」胶囊与 chip 尾标,悬停 / 点击只给**一句话**;删掉弹层标题、脚注和「重新启动 Code Puppy」按钮,胶囊不再接 `relaunch`。

| reason | 中文(唯一一句) | 英文 |
| --- | --- | --- |
| `home-or-app-state` | 主目录和 Code Puppy 自己的数据目录不能整个作为项目写入，请打开里面的具体文件夹。 | Your home folder and Code Puppy's own data folder can't be written as a whole project — open a specific folder inside instead. |
| `not-opened-by-you` | 这个文件夹不是你在 Code Puppy 里亲手打开的，助手不会改动它；用「打开项目」选中它就能写入。 | This folder wasn't opened by you in Code Puppy, so the assistant won't change it — choose it with "Open project" to make it writable. |
| `grant-failed` | 这个文件夹暂时写不进去，下次打开 Code Puppy 后即可写入。 | This folder can't be written to right now; it will be writable the next time you open Code Puppy. |

- 文案键:新增 `codepuppy.workspace.readonlyHome` / `readonlyNotOpenedByYou` / `readonlyGrantFailed`,删除 `readonlyTitle` / `readonlyBody` / `readonlyFootnote` / `readonlyRestart`;`codepuppy.workspace.readonly`(胶囊上的「只读」二字)保留给剩余情形。`denied` 缺 `reason` 时按 `grant-failed` 那句。
- 终端脚条「沙箱开启」与它的悬停文案不变(`zh.ts` 终端那几键)。

### 数据 / 配置

无新持久化存储,真源文件形状不变;无新配置键。

## 5. 数据与失败

- **顺序。** 咽喉在工作区成为当前那一刻就等放行完成、再探;用户要在新项目里打字发送、模型往返之后才会第一次写盘,中间隔着人与模型的延迟。理论上的竞态窗口(放行没完成时工具已写)不另加防护:发送路径不加等待,不排队第一条消息(推:放行是一次 IPC 往返加两次内核调用,毫秒级;实施方报实测耗时)。
- **换代中途。** 用户在两代之间选中目录 ⇒ 没有活着的 sidecar,放行跳过;新一代起来后 W1 已含它(真源随 tab 更新),或咽喉换代重问时再放行。
- **幂等。** 每代账本只记成功;同代同目录不重复签发;重复消费无害。
- **失败。** 签发返回 null / 消费 -1 / 超时 / 子进程退出 ⇒ `failed`,main 日志一行 `process fence: workspace grant FAILED dir=<…> reason=<…>`;探针定结论;界面走 `grant-failed` 那句;下一代 W1 自然含它。不重试、不换代。
- **不收回。** 关掉项目不撤销本代令牌(与 W1 同)。
- **未验证。** 单进程可消费的扩展数是否有上限(推:每代用户打开的项目数量级很小);软链 / 大小写变形路径签发出的令牌是否与写入路径匹配 —— 写探针是唯一裁判,不手写替身(U2 §5.2)。

## 6. 架构落点

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| 签发 / 消费两函数 | `packages/ui-mac/native/codepuppy-fence`(既有原生模块) | libsandbox(同一个 dlopen 句柄) | `codepuppy_fence.c` 的 `apply` 加载路径;`process-fence-apply.ts:61` `loadFenceAddon` |
| X1 / X2 两行与类名常量 | `packages/ui-mac/src/main/process-fence-profile.ts` | 无 | 可写集唯一渲染点 `renderProcessFenceProfile`(`:138`) |
| 放行资格、两个本次运行集合、tracker 过滤 | `packages/ui-mac/src/main/process-fence-workspaces.ts` | `process-fence-profile.ts` 的逐候选判定 | 真源 tracker `bootFenceWorkspaceTruth`(`:170`)与检疫;`selectWorkspaceUnion` 规则 4/5/5b |
| `grant-write` 合同与 sidecar 消费 | 写探针合同所在处 + `sidecar.ts` 消息循环 | 原生模块 | `workspace-write-probe.ts:39-76` 的合同形态;`sidecar.ts:122-138` |
| 放行编排、账本 | `server.ts` 监听器(请求簿)+ `ipc.ts` 处理函数 | 上面三者 | `createWriteProbeRequester`(`server.ts:586`)、`listener.probeWrite`(`:707`) |
| 选中记录 / 深链接记录 | `ipc.ts` `open-directory-picker`;`deep-link-queue.ts` `ingest` | `process-fence-workspaces.ts` | `ipc.ts:185-207`;`deep-link-queue.ts:332` |
| 只读胶囊 / 尾标 / 文案 | renderer `session-workspace-shell.tsx`、`workspace-chip.tsx`、`workspace-writable-core.ts`、`i18n` | preload 既有 `workspaceWriteProbe` | `useWorkspaceWritable` 咽喉(`workspace-writable.ts:34`) |

- 新目录 / 新模块:无;`docs/architecture/modules.md` 的 `packages/ui-mac/` 行不变。
- 收敛:放行资格与真源过滤共用一个判定,比「两处各判一次」更好。
- 架构约束:K2 —— 规则 4/5/5b 只有一份实现(从 `selectWorkspaceUnion` 抽出共用),类名只有一个常量。不新增已知偏离。基线 I1 的措辞需改为「装上之后只能经主进程签发的私有类令牌加宽,且只加宽到用户本人打开的项目」—— 授权来自 owner 2026-11-19 选第二条(第二条的定义就是运行期加宽);同步更新 `docs/architecture/2026-09-09-req159-process-fence.md` §2/§7/§8.2 与基线 I1 的事实陈述,归实施方同一变更。
- 工程标准:无新配置;错误只进日志(结构化一行),呈现层只认 `reason` 枚举,不解析 `detail`。
- 被否决的替代:
  - 第一条(空闲时自动换代,忙时推迟,首条消息排队):每次 1.2–6.4 s 整页重载(P-13),杀终端、断其它对话的回答;第二条可行(E1–E3),owner 已选第二条。
  - 把 W1 预先放宽到用户的代码根目录或 HOME 去掉敏感目录:等于没有围栏(基线 I1、U2 §4 表「不定价」)。
  - 由主进程代引擎写文件:要接管所有写盘通路,面比本方案大一个量级。
  - 每个项目一个引擎进程:多引擎,远超本增量。
  - 每条命令外包一层新沙箱:嵌套 seatbelt 只在策略完全相同时放行(基线 I2),不可行。
  - 规则认苹果的 `com.apple.app-sandbox.read-write` 类:任何别人签发的该类令牌都能放宽我们的围栏(E2 对照臂)。
  - 一刀切 `(deny file-issue-extension)`:E1 证明它也能堵住自签,但会连带禁掉围栏内签发苹果自己那几类,LaunchServices 打开文件一类流程可能受影响(推);只禁私有类已足够(E3)。
  - 深链接也算用户打开:分不出是用户点的还是工具发的(E4),而且没有产品面产出项目深链接(P-07)。
  - 每个点击入口各自上报「这是用户点的」:入口多(侧栏、搜索、首页、通知……),漏一个就是只读;放在既有咽喉 + 排除无手势来路更简单。
  - 持久化「用户亲手选过的目录」并只认它:从项目列表重新进入一个从没经选择器打开过的项目会反复只读(P-04 那一格),违背「无感」。
- 安全面:
  - **威胁边界。** 被围栏的引擎进程树(运行模型产生的代码与命令)一侧;主进程、renderer(既有信任,与 `store-set` 同级)、系统 UI(目录选择器)另一侧。
  - **规格里的安全承诺(逐字)。** SPEC-tool-write-fence BR-01:「工具派生进程越界写文件时会失败。」SPEC-child-process-write-fence BR-02:「MCP stdio 派生的进程越界写入失败,而不是静默成功。」可写集的成员身份由 U2 决定书 §4 第 3 条定义:「用户打开集合外的新文件夹 ⇒ **不换代、不阻止、如实告知**(§5),并把该目录写进集合,**下次启动即生效**。」⇒ 用户打开的项目**本来就在承诺之内**(它是集合成员),本设计只把「下次启动生效」改成「当场生效」,不改变谁是成员。SPEC-tool-write-fence AC-02 那句「单一权威 = profile 文件本身」写的是已拆除的 REQ-138 `WORKDIR` 形状;第二条之后可写集 = profile 行 ∪ 本代主进程签发的私有类令牌,profile 仍声明 X1/X2,令牌的资格只有一个判定 —— 历史 AC 的措辞是否随规格补版本一并改写,归编排者。
  - **必须守住的不变量。** S1 只有主进程能签发本类令牌:围栏内签发本类被拒(E3),伪造令牌消费失败(E1)。S2 X1 只认本类,别人签发的 app-sandbox 令牌放宽不了围栏(E2、E3)。S3 运行期放行资格 = 真源资格,永不比下一代 W1 更宽;结合 P-14,本方案不给攻击者增加任何现有通路之外的能力。S4 只有用户本人的打开动作算数 —— 算:系统目录选择器选中(主进程见证);在应用里进入一个项目或它的对话(renderer 咽喉)。不算:深链接(`open-url` / `second-instance` / 首启 argv)、boot 时从 store 恢复的检疫目录、任何 sidecar → main 消息、「访问项目以外的文件夹」卡片的批准(请求由模型发起)。S5 HOME / 其祖先 / `/` / 应用状态根相关目录永不放行(规则 5/5b 复用)。
  - **顺带堵上的现有通路。** 今天:工具发一个 `codepuppy://open-project?directory=X` → renderer 开 tab → `store-set` → 真源加入 X → 工具逼一次崩溃自愈 → 新一代 W1 含 X(E4 + P-04 + P-14,整链未实跑,推)。资格判定同时用于真源过滤后,这条链断在第二跳;代价:只经外部链接到达、从没被用户在应用里亲手打开的文件夹不再自动变可写,直到用户用「打开项目」选它(没有产品面产出这种链接,P-07)。
  - **剩余风险(交 Codex 方案审)。** R-a 伪造的引擎项目 / 会话条目 + 用户点击:与今天的真源同一类(用户的点击落在模型布置的内容上),本方案不更宽(S3)。R-b 被围栏的工具能经 LaunchServices 让未被围栏的应用替它干活(例如打开一个 `.command` 让「终端」执行)—— 与本方案无关的现有围栏缺口,推,未实跑(会在 owner 机器上弹出终端)。R-c 签发在 hardened runtime 签名的 Electron 主进程里能否成功,本轮只在未签名程序里测过。R-d 单进程扩展数量上限未知。R-e 软链 / 大小写路径与令牌的匹配未测,写探针兜底裁判。
  - **实施必须拿出的证据(每条都要能失败)。**
    - V1 渲染出的 profile 逐行含 X1、X2;反向臂:去掉 X2 的同一 profile 下,围栏内自签本类并消费后写进集合外目录 —— 必须红(E1 `nodeny` 臂就是已知的坏)。
    - V2 真 seatbelt、生产 profile、生产 `.node`、Electron 内嵌 node:主进程令牌消费前 EPERM、消费后落盘;伪造令牌消费失败且不落盘;围栏内签本类被拒;消费一枚 app-sandbox read-write 令牌后仍 EPERM;消费前已在跑与消费后新起的子进程都能写进目标;另一个未放行目录仍 0 落盘。
    - V3 真引擎:打开一个不在 W1 的目录 → 咽喉放行 → shell 工具、终端、一个 MCP stdio 子进程都写得进;对照臂不放行 → EPERM 且 0 落盘。
    - V4 资格:选择器选中的目录放行;深链接送来的同一目录不放行、也不进真源,之后经选择器选中即放行;检疫目录同理;HOME / 祖先 / 状态根被拒并带 `home-or-app-state`;对照:同一目录不带深链接记录经 `store-set` 照常进真源。
    - V5 结构判据:sidecar → main 的消息解析里没有任何类型能走到签发;新加一条会签发的 sidecar 消息路径必须红。
    - V6 界面:可写路径上两个只读钩子都缺席、全应用没有「重新启动 Code Puppy」按钮;三种 `reason` 各出各自那一句;胶囊不再有任何动作。
    - V7 出货形态:本机发版命令打出的签名包上(U3 同形)主进程签发、引擎消费成功,集合外仍 0 落盘;sidecar 日志一行记录每次放行;报放行往返耗时。

## 8. 拆分决定

不适用:全部在 alpha-code 一个仓、一个负责方。

## 9. 回滚

不适用:无数据迁移、无不可逆数据变更。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| 1. 选第二条:运行期以私有类沙箱扩展当场放行,不换代;第一条不实现、不作兜底 | E1–E3(测,`A`,macOS 26.3.1);owner 2026-11-19「如果第二条可行，就选第二条」 |
| 2. 私有类 `app.codepuppy.workspace-write` + 只禁签发该类,而非苹果类或一刀切 | E2 对照臂(苹果类会被他人令牌放宽);E3(只禁私有类即可堵自签,苹果类照常可签) |
| 3. 触发点 = 既有写探针咽喉「先放行再探」;不在各入口加调用、不在选中时预放行、不在发送路径加等待 | P-10;§5 顺序推断;入口枚举见 P-06 |
| 4. 算数的打开动作:系统目录选择器、在应用里进入项目或其对话;不算:深链接、检疫目录、sidecar 消息、外部目录卡片批准;选择器可盖过深链接 / 检疫 | E4、P-05、P-07、P-09、P-15;S4 |
| 5. 真源 tracker 用同一资格判定过滤新增目录(新增深链接一项) | P-14 推断:不过滤则运行期排除形同虚设;代价见 §6「顺带堵上的现有通路」 |
| 6. 「只读」胶囊与 chip 尾标退出常规路径;剩余三种情形各一句话;删除「重新启动 Code Puppy」按钮 | owner 2026-11-19「这个交互逻辑我觉得有点乱。我希望可以尽量用户无感」取代 2026-09-10 批准原文 `保留弹层里的「重新启动 Alpha」按钮`;剩余情形里重启要么无效(home / not-opened-by-you),要么下次打开自然生效(grant-failed) |
| 7. 规格 v1 无本增量 AC;规格补版本与 SPEC-tool-write-fence AC-02 措辞归编排者 | `delivery-spec`;本设计不改规格 |

| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| R1(待送审) | Codex(编排者安排) | — | — | — |

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| 路径含 `"` / `\` / 控制字符的项目让下一代引擎起不来 | `selectWorkspaceUnion` 不滤这类路径,`renderProcessFenceProfile` 遇到即抛(`process-fence-profile.ts:122-139`)⇒ 计划失败、拒绝 fork(读,未实跑)。本方案的令牌不经 seatbelt 字面量,运行期能放行这类目录,但下一代整个引擎起不来 | 现有缺陷,不由本方案引入;建议编排者按 External Bug 处理(最小修法:规则 4 增加一条排除并出日志,运行期由令牌覆盖) | 立即(现存暴露) |
| 「访问项目以外的文件夹」批准后仍写不进 | 批准只放行引擎权限(P-15),工具写入得到 EPERM | 请求由模型发起,不属本增量的「用户亲手打开」 | owner 若希望批准即可写,经 intent 提出 |
| 被围栏的工具经 LaunchServices 借未被围栏的应用执行(R-b) | 推,未实跑 | 与本方案无关的现有围栏缺口 | 编排者按 External Bug 或 INT-safety 处理 |
| 自动化面板选的项目不在 tab 里 ⇒ 不在 W1 | 后台自动化写盘可能被拒(推,未核实) | 不在本增量的打开入口内 | 有自动化写盘失败的实例时 |
| 剩余情形里模型只拿到裸 EPERM | 模型无法向用户转述原因 | 用户侧已有一句话;模型侧提示不是本增量结果 | 有用户困惑实例时 |
