---
id: PLAN-error-message-lifetime
title: 界面报错信息的显示时长与恢复后的处理 实施计划
summary: alpha-code#1687 两段:弹出提示的去留与同因合并;未恢复问题入口与启动静默
kind: plan
status: active
spec: SPEC-error-message-lifetime
design: ""
owners: [alpha-code desktop maintainers]
last_reviewed: 2026-11-12
---

# PLAN-error-message-lifetime｜界面报错信息的显示时长与恢复后的处理 实施计划

由实施会话在计划阶段写,编排器核对后由同一会话实施。每个交付段一节;旧段留作证据。决定只链接、不重述;实施中偏离本段,在同一个提交里改本段。

共同依据(两段共用):

- 规格 `SPEC-error-message-lifetime` v1(owner 2026-11-12 批准),取 `spec/error-message-lifetime` @ `a962a66cd8` 的 `docs/specs/error-message-lifetime/spec.md`;AC-01…AC-11、BR-01…BR-05 原文以该文件为准,本计划不改写。
- 设计稿:`docs/design/current/shell-sidebar/design.html` @ `089669ea00` 锚点 `#problems`、`#toast-lifetime`(子帧 `frames/problems.html`、`frames/toast-lifetime.html`,渲染与类名在 `frames/error-lifetime.js` / `frames/error-lifetime.css`);增量稿 `docs/design/2026-11-12-error-message-lifetime/frame.html` @ `244a7c26ec`。无 design.md。
- Issue [alpha-code#1687](https://github.com/impharaon/alpha-code/issues/1687);基线分支 `engine/1662-opencode2` @ `df748c16e7`。
- 现状事实:[INT-error-message-lifetime 讨论记录](https://github.com/impharaon/alpha-work/blob/main/docs/intents/discussions/INT-error-message-lifetime.md)(alpha-code@039f7715e1 盘点)。本计划在 `df748c16e7` 上补核的三条见各段「风险」。

路径相对 `packages/ui-mac/src/renderer/`。

## 段一:弹出提示的去留与同因合并

- 依据:见上;覆盖 AC-01、AC-03、AC-04、AC-07、AC-10、AC-11 的提示一侧,BR-01、BR-03、BR-05。入口与静默在段二。
- 核对:`ebfcf0ae32` · 编排器 · 通过,只实施段一。裁决:R5 接受(静默窗口只压报错与后台问题,确认类照常);R2 按 BR-05 读(见段二风险 R2);R4 送 owner,AC-01/05/06 的观察件暂不做,段一用公开入口注册的测试来源证明 BR-01;R6 按帧;`#771` 断言改为新行为、不删。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `codepuppy-ui/Toast.tsx` | 提示分两类:后台状态类(带来源+原因的键,8 秒后收起,悬停/聚焦暂停沿用现有暂停机制;× 与到时都等于「收起」;可被「恢复」立即清除)与用户操作类(现行 `pushToast` 调用默认归此类:报错留到 × 或离开当前页面,info/success 仍 4 秒)。同键合并:正在显示则原地更新文字、不新增、不重新计时;已收起未恢复则不再弹出(收起后的去处由段二的问题仓接)。导出 `reportProblem`(登记/更新后台问题)、`resolveProblem(key)`(恢复)与离开页面的清除函数;`ToastItem.persistent` 改为由类别派生,`data-persistent` 投影保留。顶部注释里 `#1476` 的「出错一律常驻」改为现规则。 |
| `codepuppy-ui/toast-route-follower.tsx`(新) | 无界面子组件,挂在路由内:路径变化时清掉用户操作类的报错提示(BR-05「离开当前页面」)。单独成件是因为 `ToastViewport` 现在不在路由上下文里测试(`composer-a11y` 的 `ToastHarness` 不带 Router)。 |
| `index.tsx` | 在 `ToastViewport` 旁挂 `ToastRouteFollower`。 |
| `extensions/ext-ipc.ts` | 扩展警告从 `duration: 0` 的常驻 info 改为后台问题:键 = `ext-warning:` + 呈现后的文案,无恢复信号(见风险 R2)。抬头 `#771` 段注释改为新去留。 |
| `codepuppy-ui/cloud-run-watcher.tsx` | `runSaveFailed` 改为后台问题,键 = `cloud-run:` + directory + runId;同一 run 之后交付 `saved` 时 `resolveProblem` 再弹现有成功提示。`runSaved`/`runEnded` 不变。 |
| `codepuppy-ui/toast-lifetime-test-runtime.tsx`(新)、`codepuppy-ui/toast-lifetime.test.ts`(新) | 照 `composer-a11y.test.ts` 的 vite 构建 + happy-dom 写法,真挂 `ToastViewport` 与 `ToastRouteFollower`(MemoryRouter);计时用 bun 1.4.4 的 `jest.useFakeTimers()`(已在临时目录实测 `advanceTimersByTime` 同时推进 `Date.now`)。 |
| `codepuppy-ui/composer-a11y.test.ts` | 只在其 `#1476 toasts` 组与新规则冲突时改对应断言(报错常驻那条在新规则下仍成立,预期不动)。 |
| `extensions/ext-package-detail-wiring.test.ts` 及其用例文件 | `#771`「警告常驻」那条编码的是被 BR-02 替换的旧行为;实跑若红,改成「4 秒后仍在、到 8 秒收起」,不删断言。 |

### 顺序

1. Toast 两类 + 同键合并 + 恢复即清 + 路由跟随件与挂载 + `toast-lifetime.test.ts`;跑 `toast-lifetime.test.ts`、`composer-a11y.test.ts`、`surface-remount.test.ts`、`tsgo -b`。
2. `ext-ipc.ts`、`cloud-run-watcher.tsx` 改分类;跑 `ext-ipc-warning.test.ts`、`ext-ipc-chokepoint.test.ts`、`ext-package-detail-wiring.test.ts`、`cloud-run-core.test.ts`、`i18n/locale-regression.test.ts`。

### 风险

- R1 调用方「先报错后跳转」:同一处理函数里 `pushToast` 后紧接 `navigate` 会被路由跟随件立刻清掉。对策:只清「推出时所在路径 ≠ 新路径」的提示,推出时记录当时路径;测试含一条「推出后同 tick 跳转」用例。
- R2 无恢复信号的后台问题:扩展警告是一次性事件,规格写「恢复后从入口移除、不能手动删除」,但这类问题没有恢复信号 → 本次运行内一直留在入口,同因只计 1。属规格未覆盖的输入缺口,请编排器核对时确认或送回规格;不自行加「手动删除」或超时。
- R3 共享单例:提示仓是模块级单例,测试间残留会互相污染;每个用例 afterEach 清空(沿用 `composer-a11y` 的做法)。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01(提示侧) | `toast-lifetime.test.ts`「恢复后 1 秒内消失」:`reportProblem` 后 `resolveProblem`,推进 1 秒,DOM 无该 `.a-toast` | 不实现恢复即清,提示仍在 DOM |
| AC-03 | 「悬停超过 8 秒仍在,移开后才计时」:mouseenter、推进 9 秒仍在;mouseleave 后推进 7.9 秒仍在、再 0.2 秒收起;焦点同测一次 | 不暂停则 8 秒即收起;移开后不按剩余计时则时刻对不上 |
| AC-04(提示侧) | 「同键 1 秒内报 3 次只有一条且不重新计时」:三次 `reportProblem`(第三次改 detail),DOM 一条且文字为最新;从首次起推进 8 秒即收起 | 不合并则 3 条;合并但重计时则 8 秒时仍在 |
| AC-07 | 「用户操作报错超过 8 秒不消失,离开页面消失」:`pushToast({kind:"error"})`,推进 60 秒仍在;MemoryRouter 跳转后消失;同 tick 推出再跳转的那条仍在(R1) | 套用 8 秒则消失;路由跟随件不挂则跳转后仍在 |
| AC-10(提示侧) | 「已收起未恢复,同因再报不弹」:收起后再 `reportProblem` 同键,DOM 无提示 | 不记住已收起状态则再弹一条 |
| AC-11(提示侧) | 「点 × 关闭」:点 `.a-toast-x` 后提示消失,问题仍记为未恢复(段二断言入口计 1) | × 若不关闭则提示仍在 |
| BR-01 调用方 | `cloud-run-watcher` 同一 run 先 failed 后 saved:失败提示被清、出现成功提示(加在 `toast-lifetime.test.ts`,喂 `window.api.cloud.onRunState` 替身) | 不改分类则失败提示常驻与成功提示并存 |

### 偏离记录

- 2026-11-12 · `extensions/ext-ipc.ts` 不改成后台问题:按 R2 裁决扩展警告是 BR-05 项,仍为常驻的用户操作类提示(按 × 或离开页面关闭,同文字合并),只补注释;`ext-package-detail-wiring` 的 `#771`「警告常驻」断言因此就是新行为,实跑绿,未改。
- 2026-11-12 · R1 对策取消:`codepuppy-sidebar.tsx` 等调用点逐个看过,没有「先报错、同一处理里再跳转」的形态;离开页面 = 路径变化时关闭全部常驻的用户操作类提示,不记推出时路径。
- 2026-11-12 · BR-01 的证明改用公开入口 `reportProblem` / `resolveProblem` 注册的测试来源(R4 裁决);`cloud-run-watcher.tsx` 的失败 → 保存成功清除只由类型检查覆盖,行为用例要喂 SSE 与 facade 身份夹具,超出本段。
- 2026-11-12 · 未恢复问题的记录暂放 `Toast.tsx` 内部(只记键与是否已收起);段二建 `problems.ts` 时迁出。
- 2026-11-12 · 加一条生产挂载守卫:`toast-lifetime.test.ts` 核 `index.tsx` 在 `AppInterface` 内挂了 `ToastRouteFollower`(harness 自挂一份,删生产那行会假绿)。

## 段二:未恢复问题入口与启动静默

- 依据:见上;覆盖 AC-01(入口侧)、AC-02、AC-04(入口侧)、AC-05、AC-06、AC-08、AC-09、AC-10(入口侧)、AC-11(入口侧),BR-02、BR-04;界面对照 `#problems`、`#toast-lifetime`。
- 核对:`ebfcf0ae32` · 编排器 · 段一交回(`867aab286b`)后放行段二,工具服务连接来源除外:R4 待 owner 裁决,裁决前不建 `background-problem-watcher.tsx`、启动期不读 MCP 状态;仓与入口要让以后的连接器来源经同一公开入口两种接法(只进入口 / 先提示后入口)都能接上而不改它们;AC-05/06 的启动行为用「窗口内失败、随后恢复 / 一直失败」的测试来源证明。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `codepuppy-ui/problems.ts`(新) | 未恢复问题仓(模块级信号):键 → 原因、细节、可做的操作(标签 + 动作)。只有三个入口:收起时加入/更新、恢复时移除、静默窗口内的需要用户处理项直接加入。无删除接口(BR-02「不能手动删除」)。启动静默窗口常量 `STARTUP_QUIET_MS = 10_000` 与后台提示 `8_000` 放在这里或 `Toast.tsx` 一处定义。 |
| `codepuppy-ui/Toast.tsx` | 接上问题仓:后台问题收起(到时 / ×)时若未恢复则进仓;静默窗口内后台问题只记不弹、不进仓,窗口结束仍未恢复的各弹一条(之后按段一);窗口内的用户操作类报错不弹、直接进仓;info/success 确认类在窗口内照常(见 R5)。 |
| `codepuppy-ui/background-problem-watcher.tsx`(新) | 无界面子组件,挂在 `index.tsx`。① 工具服务连接:静默窗口结束时读一次 `mcp.status`,之后在引擎事件 `mcp*` 与运行时恢复 `ready` 时重读;`failed`(有错误、非 pending、非 needs_auth、非停用)→ `reportProblem("mcp:"+name)`,连上/消失/停用 → `resolveProblem`。复用 `extensions/use-extensions.ts` 的状态判别函数(由私有改为导出,不复制)。操作「查看」= `setExtHubOpen(true)`。② 平台模型目录:`createCatalogRefreshHealth()` 的 `platform` 非空 → `reportProblem("catalog:platform")`,细节用 `catalogFailureReason`,操作「重试」= `retryCatalogRefresh`;为空 → 恢复。 |
| `codepuppy-ui/ext-trust-watcher.tsx` | 给五处推送加稳定键(`trust:`+dir、`ext-claude-md:`+dir、`ext-skipped:`+dir+name),让静默窗口内进仓的条目同因只计 1;`trustPersistFailed` 在同一目录之后重查成功时 `resolveProblem`。窗口外行为不变(用户操作类)。 |
| `sidebar/problems-entry.tsx`(新) | 入口行 + 向上弹层,DOM 形状与类名照 `frames/error-lifetime.js` 的 `sidebarHTML`/`popHTML`:无问题不渲染;按钮 `aria-haspopup="dialog"`/`aria-expanded`;打开后焦点进第一条操作,Esc 与点外面关闭并把焦点还给入口;数量归零时弹层关闭。点外面/Esc 复用账户弹层已有的处理(`popover-hit.ts`、`overlay-stack.ts`),不另写。条目无 ×。 |
| `sidebar/codepuppy-sidebar.tsx` | footer 内账户按钮之上挂 `ProblemsEntry`;「显示侧边栏」按钮在侧栏收起且有问题时加 `data-problems`,title/aria-label 改为带数量的文案。 |
| `sidebar/sidebar.css` | 迁入 `frames/error-lifetime.css` 里的 `.codepuppy-problems-*` 与 `.codepuppy-topbar-btn[data-problems]` 规则(只用 `--a-*`);帧专用的 `.dz-*`、`.win` 规则不迁。`dz-fade` 关键帧随入口改名为本文件的命名。 |
| `i18n/zh.ts`、`i18n/en.ts` | 新键:入口「{{count}} 个问题未恢复」、弹层标题「未恢复的问题」与副标题「恢复后自动移除」、操作「查看」(「重试」复用现有键)、「显示侧边栏 · {{count}} 个问题未恢复」、连接器「「{{name}}」连接器未能连接」(设计稿文字,见 R4)。英文由同义译出,不出现开发者术语。 |
| `docs/design/current/shell-sidebar/frames/error-lifetime.css`、`components.md` | 实施时用 `git checkout spec/error-message-lifetime -- <path>` 带入;CSS 迁走后帧文件改为引用 `sidebar.css` 中的规则或保留帧专用部分;`components.md` 两行填实现票、落地提交与代码入口,状态改「已实现」。 |
| `sidebar/problems-entry-test-runtime.tsx`(新)、`sidebar/problems-entry.test.ts`(新) | 同段一写法:真挂 `ProblemsEntry` + `ToastViewport` + 顶栏按钮(经侧栏导出的最小宿主或直接挂 `CodePuppySidebar` 视运行时依赖定,实施时取能挂上的最小真组件),fake timers。 |
| `codepuppy-ui/background-problem-watcher.test.ts`(新) | 喂 `mcp.status` 与事件流替身、`window.api.models` 替身,断言问题仓与提示 DOM。 |

### 顺序

1. 问题仓 + Toast 接仓与静默窗口;扩展 `toast-lifetime.test.ts` 的入口侧断言(AC-02/04/10/11 入口侧、AC-09);跑它与段一的相关测试、`tsgo -b`。
2. 入口组件 + 侧栏挂载 + 顶栏小点 + CSS 迁移 + i18n + 设计台账;跑 `problems-entry.test.ts`、`i18n/locale-regression.test.ts`、`sidebar/menu-a11y.test.ts`、`sidebar/overlay-close.test.ts`、`codepuppy-ui/reduced-motion-ratchet.test.ts`、`codepuppy-ui/contrast-ratchet.test.ts`;对照帧截图(打包前用 dev 渲染,截入口三态与弹层)。
3. 后台问题观察件 + `ext-trust-watcher` 键 + 导出状态判别函数;跑 `background-problem-watcher.test.ts`、`extensions/use-extensions` 相关现有测试、`catalog-failure-banner.component.test.ts`。

### 风险

- R4 工具服务连接今天没有任何弹出提示:失败只出现在定制中心的行内状态行(`extensions/extension-hub.tsx:1753-1754`),而 `mcp.status` 按启动性能决定只在定制中心首次打开后才读(`extensions/use-extensions.ts:1051-1057`,`f61fa785a1`「lazy extension hub」)。AC-01/05/06 以「已有这条提示」为前提,所以本段新增观察件;为不推翻那条启动决定,首读放在静默窗口结束(10 秒)之后,启动期零新增请求。连接器提示文案在帧里标为「示例」(`frames/error-lifetime.js` 的 `P` 注释)。请编排器核对时确认这一新增与文案;不认可则 AC-01/05/06 退回规格。引擎侧是否真的自动重连不影响判据:观察件只看窗口结束时与之后的状态。
- R5 静默窗口内的确认类提示:帧表写「启动后 10 秒内不弹任何提示」,语境是报错;本计划只压报错与后台问题,info/success 确认照常 4 秒(否则用户头 10 秒内的「已复制」会丢)。若编排器要求字面执行,改一处判断。
- R6 平台目录失败已有 `#1557` 的使用点提示(输入框提示槽 / 选择器),本段只加入口条目与窗口后一次提示,不动那两处;已应用旧版本时也会进入口 —— 设计稿入口帧含此条,按帧做。
- R2 的读法(编排器裁决,2026-11-12):没有恢复信号的问题(扩展警告、跳过的导入项、外部说明文件冲突)按 BR-05「需要用户处理」项处理 —— 用户做了该条目的操作(「查看」打开它所在的位置、「重试」成功)即离开入口;不加手动删除按钮,不加超时。
- 顶栏小点与入口共用一个数量来源(问题仓),避免两处计数不一致。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01 | `background-problem-watcher.test.ts`:窗口后 `mcp.status` 报 failed → 提示出现;事件后重读为 connected → 推进 1 秒,提示与问题仓条目都没有 | 观察件不 resolve 则提示/条目残留;不新增观察件则一开始就没有提示 |
| AC-02 | `problems-entry.test.ts`:后台问题出现,推进 8 秒 → 提示消失、入口文字为 1 个、点开有原因与操作按钮 | 不收起则提示仍在;不进仓则入口不渲染 |
| AC-03 | 段一同名用例 | 同段一 |
| AC-04 | 段一用例扩展:3 次同键后收起,入口计 1 | 不按键合并则入口计 3 |
| AC-05 | `background-problem-watcher.test.ts`:启动后 0–9 秒 `mcp.status` 替身对两个服务报 failed,第 9 秒起报 connected;推进到 30 秒全程无 `.a-toast`、入口不渲染 | 无静默窗口则启动即弹;观察件在窗口内读状态则也会弹 |
| AC-06 | 同文件:一个服务始终 failed → 第 10 秒后出现一条提示,再推进 8 秒收进入口计 1 | 窗口结束不补弹则全程无提示;弹多次则 DOM 多条 |
| AC-07 | 段一同名用例 | 同段一 |
| AC-08 | `problems-entry.test.ts`:入口 2 条、弹层开着,恢复一条 → 数量 1、列表少一行;再恢复 → 入口与弹层都消失,收起侧栏时顶栏无 `data-problems` | 不随恢复移除则数量不变 |
| AC-09 | `toast-lifetime.test.ts`:静默窗口内推两条用户操作类报错(用 `ext-trust-watcher` 的真实键形)→ 10 秒内无 `.a-toast`;入口计 2,点开两条与「查看」 | 不分窗口则立即弹两条;不进仓则入口为空 |
| AC-10 | 段一用例扩展:收起后同键再报 → 无提示、入口仍计 1、条目文字更新 | 重弹或重复计数 |
| AC-11 | `problems-entry.test.ts`:提示显示中点 × → 提示消失、入口计 1;弹层内条目无 `.a-toast-x` / 删除按钮 | × 不进仓则入口为空;有删除按钮则断言失败 |
| 界面 | 帧对照:dev 渲染的入口三态(无 / 收起 / 展开)、恢复一条、侧栏收起的小点与帧 `entry-none`、`entry-count`、`entry-open`、`recover-one`、`narrow-dot` 截图并排,写入实施回报 | 类名/位置/文案偏离帧可见 |

### 偏离记录

- 2026-11-12 · 观察件只做平台模型目录一项,文件为 `codepuppy-ui/catalog-problem-watcher.tsx`(R6);工具服务连接那一半与 `background-problem-watcher.tsx` 按 R4 暂缓。以后接连接器:先提示后入口 = `reportProblem` / `resolveProblem`(Toast.tsx);只进入口 = `putProblem({ attention: false })`(problems.ts)+ `resolveProblem`。两种接法都有用例(`problems-entry.test.ts`),仓与入口不用改。
- 2026-11-12 · `problems.ts` 放两份记录:后台问题的去留阶段(暂存 / 显示中 / 已收起)与入口列表;公开入口仍是 Toast.tsx 的 `reportProblem` / `resolveProblem`(problems.ts 不反向依赖 Toast,无循环引用)。`pushToast` / `reportProblem` 多一个可选 `action`(条目上的操作,提示本身不显示)。
- 2026-11-12 · 静默窗口由 `index.tsx` 模块顶层 `beginStartupQuiet()` 在 renderer 启动时开始;测试里显式调用(否则每个用例都落在窗口内)。
- 2026-11-12 · BR-05 的读法补一条:静默窗口内进入口、**没有可做操作**的需要用户处理项(如头 10 秒内的「删除失败」)随离开当前页面离开入口,与它本该显示的提示同一去留;有操作的按 R2 做了操作才离开。后台问题不受换页影响。
- 2026-11-12 · 操作的去处:信任/导入那三类提示的「查看」打开定制中心对应分区(连接器 / 技能);扩展警告的「查看」打开定制中心;目录的「重试」= `retryCatalogRefresh`。
- 2026-11-12 · Toast.tsx 内部读提示列表改为不订阅(`untrack`):来源在 effect 里调 `reportProblem` 时,被跟踪的读会让那个 effect 随提示变化重跑并吞掉之后的恢复信号(目录用例实测红过)。
- 2026-11-12 · 测试落点:入口与静默的用例在 `codepuppy-ui/problems-entry.test.ts`(与段一共用 `toast-lifetime-test-runtime.tsx`,不另建 `sidebar/` 下的运行时);生产侧栏里的挂载位置与收起态小点加在已有的真实侧栏组合体 `test-component/overlay-close.cases.ts`(2 条,`overlay-close.test.ts` 的条数下界 16 → 18)。
- 2026-11-12 · 设计文档带入范围:除 `frames/error-lifetime.css`、`components.md` 外,一并带入 `frames/*.html`、`frames/error-lifetime.js`、`design.html` 的两节锚与增量稿目录 —— `components.md` 的相对链接与「锚」列指向它们,只带两个文件会断链。
- 2026-11-12 · 英文入口文案用「Unresolved problems: N」避免单复数;中文照帧。
- 2026-11-12 · 帧对照用无头 Chrome 渲染:帧页(spec 分支原样)与实现页(同一帧外框,入口与弹层换成真组件在测试运行时里产出的 DOM,样式来自本分支 `sidebar.css`,帧 CSS 已不含这些规则)并排,明暗各一,目视一致;截图在临时目录,不入仓。

## 段三:工具服务连接来源(spec v2,只进入口)

- 依据:`SPEC-error-message-lifetime` v2 —— owner 2026-11-12 裁决 R4:「工具服务提示选 A，核心包测试配置同意接管」(选 A = 连不上的工具服务不弹提示,只进「未恢复问题」入口,重连后自动移除)。v2 改写的 AC-01、AC-05、AC-06 以编排器转来的措辞为准(规格文本由编排器更新,本段不复述);其余 AC 与段一、段二相同。
- 核对:编排器 R4 放行(段一 `867aab286b`、段二 `d2201d2a37` 已验收并合入 `engine/1662-opencode2`;无操作的需要用户处理项随换页离开的读法已接受)· 只进入口的接法、首读在静默窗口之后、`needs_auth` 为要用户动手的项。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `codepuppy-ui/background-problem-watcher.tsx`(新) | 无界面子组件:静默窗口结束后才建 SDK 客户端、读一次 `mcp.status`,之后在引擎事件 `mcp*` / `server.instance.disposed` 与运行时恢复 `ready` 时重读。失败(非已连接、非停用、非启动中、非需登录)→ `putProblem({ attention: false })`,原因「「名字」未能连接」,操作「查看」打开定制中心连接器页;`needs_auth` → 要用户动手的项,操作「去授权」直接调引擎授权后重读;下一次读不到或已恢复 → `resolveProblem`。名字取随包目录的显示名,找不到用服务名。事件用自己的一条全局订阅(见风险)。 |
| `codepuppy-ui/Toast.tsx` | 加 `startupQuietEnded()`(窗口结束的 promise;没开窗口则立即),供来源推迟启动期读取。 |
| `extensions/use-extensions.ts` | 把 `isConnected` / `isDisabled` / `needsAuth` / `isPending` 由私有改为导出,观察件复用同一套状态判别,不复制。 |
| `index.tsx` | 挂 `BackgroundProblemWatcher`(与目录来源同层)。 |
| `i18n/zh.ts`、`i18n/en.ts` | `codepuppy.problems.connectorFailed`「「{{name}}」未能连接」、`codepuppy.problems.connectorNeedsAuth`「「{{name}}」需要重新登录」;操作文字复用 `codepuppy.problems.view`、`codepuppy.ext.mcpAuthorize`。 |
| `codepuppy-ui/background-problem-watcher.test.ts`(新)、`toast-lifetime-test-runtime.tsx` | 真挂观察件 + 提示视口 + 入口;状态来源是替身 fetch(`GET /mcp` 状态表、`GET /global/event` 可推送的 SSE),走观察件真实用的 SDK 客户端与订阅。 |

### 顺序

1. 一个提交:观察件 + 窗口结束 promise + 导出判别函数 + 挂载 + 文案 + 用例;跑 `background-problem-watcher.test.ts`、`problems-entry.test.ts`、`toast-lifetime.test.ts`、`locale-regression.test.ts`、`tsgo -b`,以及 `use-extensions` 的现有用例。

### 风险

- 订阅不共享:定制中心那条事件订阅活在 `useExtensions` 里、直到定制中心第一次打开才建立(`use-extensions.ts` 的 A2 lazy),没有应用级订阅可共享;观察件在窗口结束后自建第二条全局订阅(与 `cloud-run-watcher.tsx` 同法)。启动期零新增请求由用例钉住。
- 断开的发现:2.x 引擎在每次连接状态落定(已连接 / 失败 / 需登录 / 断开)时发 `mcp.status.changed`(`packages/schema/src/mcp-event.ts:22-27`),观察件按 `mcp*` 前缀重读,断开与重连都能及时反映。(本段初稿写「断开可能不发事件」,读源码后更正。)
- 「查看」打开的是定制中心连接器页(已安装一组在页顶),不是定位到那一行:定制中心今天没有按行定位的入口,加它是定制中心的新能力,不在本段。
- `needs_auth` 条目做了操作即离开(R2);授权没成功时,下一次读状态会把它放回来。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01 (v2) | `background-problem-watcher.test.ts`「a disconnected connector is listed without a toast; on reconnect it leaves the entry within 1 s」:已连接 → 事件后读到 failed → 入口计 1、原因与「查看」、推进 30 秒仍无提示;再报 connected + 事件 → 1 秒内入口消失 | 改用先提示接法(`reportProblem`)→ 出现提示,红;不 resolve → 入口残留,红;不跟事件 → 读不到重连,红 |
| AC-01 (v2) 操作 | 同文件「查看 opens the Customization Center on its connectors page」:先把分区置为技能,点「查看」→ 定制中心打开且在连接器页,条目仍在 | 不切分区 → 红 |
| AC-05 (v2) | 同文件:窗口内两个服务 failed、第 9 秒起 connected;0–9 秒逐秒断言零 `GET /mcp`、无提示、无入口;9–30 秒仍无提示、无入口;窗口后确有读取 | 窗口内就读状态 → 零请求断言红 |
| AC-06 (v2) | 同文件:一直 failed;第 9999 毫秒零请求、无入口;第 10000 毫秒首读,入口计 1、原因与操作;全程无提示 | 窗口内读 → 红;改用先提示接法 → 红 |
| 有意关闭不算问题 | 同文件「a service that is off on purpose is not a problem」:用户关掉的连接器与 kill-switch 下的云服务都报 `disabled` → 入口只列真正失败的那一个;把它也关掉后入口为空,全程无提示 | 去掉 `isDisabled` 跳过 → 计 3 而不是 1,红 |
| needs_auth | 同文件:条目文字「需要重新登录」,点「去授权」→ 引擎收到授权请求,条目离开 | 当成后台失败 → 文字与操作不符,红 |
| 生产挂载 | 同文件末条:`index.tsx` 在 `AppInterface` 内挂 `BackgroundProblemWatcher` | 删挂载行 → 红 |

### 偏离记录

- 2026-11-12 · 编排器更正:有意关闭的服务不进入口。用户关掉的连接器与 kill-switch 下的云服务在 2.x 都报 `{ status: "disabled" }`(配置 `disabled: true` → `packages/core/src/mcp/index.ts:602-605` 与 `:732-736`;用户关闭走 disconnect → `:844`;中和条目 `WITHHELD_CLOUD_MCP` 带 `disabled: true`,`packages/ui-mac/src/main/cloud-web-search.ts:75-80`,服务名 `codepuppy`),观察件已按 `isDisabled` 跳过,补用例钉住。
- 2026-11-12 · **停在一项上(未猜)**:kill-switch 下定制中心一打开,`use-extensions.ts:680-683` 的补连(`#1106`)会对 `disabled` 的云服务调 `/mcp/codepuppy/connect`;2.x 的 `connect` 不看 `disabled`,直接重启连接(`packages/core/src/mcp/index.ts:828-836`),连 `127.0.0.1:1` 失败后状态变成 `{ status: "failed", error: "[codepuppy:<码>] <传输层原文>" }`(`:497-501` / `:515-520`,前缀格式 `packages/schema/src/codepuppy-net-failure.ts:211-213`)—— 状态里**没有**区分「被开关关掉」与「真失败」的字段;renderer 也拿不到 kill-switch 状态(preload / shared / renderer 无此通道)。此时观察件会把它列成「未能连接」。需要编排器裁决接法(见交回)。
- 2026-11-12 · 编排器裁决接法 A,上一条停住的一项闭合:判决的唯一落点在 `packages/ui-mac/src/main/codepuppy-config-injection.ts` 写 `config.mcp` 的那一处(`cloud-web-search.ts` 只定义中和条目常量,不做判决)。那里改为先把判决记进 `cloudMcpWithheld`,再用同一个值选中和条目;每轮注入开头复位为 false(无云 URL 的分支不写云服务)。`isCloudMcpWithheld()` 只读它,经 `ext-ipc.ts` 的 `ext-cloud-withheld` 与 preload `ext.cloudWithheld()` 交给 renderer(照 `ext.configHealth` 的接法)。判决只在 sidecar fork 注入时变,引擎跑的就是那一轮的配置;观察件每次读状态都同时读这个值,运行时恢复 `ready` 已会触发重读,所以不另加推送。观察件在值为 true 时跳过云服务 `codepuppy`,不解释错误原文;定制中心的补连不动。云服务名在 renderer 按既有惯例用字面量(同 `cloud-facade-identity.ts`)。用例:renderer 两条(扣下 + 补连后 failed → 入口为空;放开后真失败 → 列出;去掉跳过即红),main 一条(五个分支上暴露值 = 是否写了中和条目,并自证真假两值都出现)。

