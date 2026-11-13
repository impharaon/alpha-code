---
id: PLAN-cloud-job-form-preflight
title: 云任务表单在提交前显示额度与准入 实施计划
summary: alpha-code#1686 一段:拷入 AccountStatusV1、主进程只读预检 IPC、组件库卡片与名称 — 值列表(账户弹层改用)、两种发送框的预检区与按钮行右移
kind: plan
status: active
spec: SPEC-cloud-job-form-preflight
design: DESIGN-cloud-job-form-preflight
owners: [alpha-code desktop maintainers]
last_reviewed: 2026-11-13
---

# PLAN-cloud-job-form-preflight｜云任务表单在提交前显示额度与准入 实施计划

由实施会话在计划阶段写,编排器核对后由同一会话实施。规格与设计在 alpha-work,本计划只写本仓的文件、顺序、风险与证明;决定只链接、不重述。实施中偏离本段,在同一个提交里改本段。

## 段一:两种云发送框的提交前预检(alpha-code 半场)

- 依据:
  - 规格 [SPEC-cloud-job-form-preflight v2](https://github.com/impharaon/alpha-work/blob/aaea6a4/docs/specs/cloud-job-form-preflight/spec.md)(owner 2026-11-13 批准;本段只消费「体验约定」与 AC-02)。AC-02 原文:「Code Puppy 两类云表单在发起前调用该路由,显示额度、余额、「额度用完后用余额付」开关与首步准入结论;预留额如实标为预留而非报价;拒绝时给出原因与下一步」。
  - 设计 [DESIGN-cloud-job-form-preflight](https://github.com/impharaon/alpha-work/blob/aaea6a4/docs/specs/cloud-job-form-preflight/design.md) @ alpha-work `aaea6a4`:§4.1 `AccountStatusV1`、§4.4(IPC、状态表、字段表、按钮行、组件、取数时机、身份与乱序)、§5、§8、§10。
  - 契约:alpha-platform 合并提交 `491707f`(`contracts/v1/alpha-wire-contracts.schema.json` 的 `$defs/AccountStatusV1` 与 producer fixture `contracts/v1/fixtures/producer/account-status.json`);路由已在生产(alpha-cloud `c18151f0`)。
  - 界面稿(owner 2026-11-13 批准):alpha-code `a35bb81c26`(分支 `design/1686-cloud-form-preflight`,**未并入 alpha、无 PR**)——现行稿 `docs/design/current/customization-center/design.html#cloud-preflight`、增量稿 `docs/design/2026-11-13-1686-cloud-form-preflight-r3/frame.html`(含文案表与「给实现」表)、组件稿 `docs/design/2026-11-13-library-card-kv/frame.html`、`docs/design/system/components.md` 的 Pending 两行。
  - Issue [alpha-code#1686](https://github.com/impharaon/alpha-code/issues/1686);基线 `origin/alpha` @ `ee8dfa0c27`。
- 核对:`d76a8082d0` · 编排器(Claude Fable 5.2)· 通过。裁决:D0 合并画稿分支(本会话的合并被 lane 钩子拦下,改由编排器执行,见偏离记录);D1 owner 未答,按批准稿实现(只显示卡片),一行切换留在下方;D2 通过(签名加身份,纯续期仍不广播,换号时预检区与账户弹层都清空重取);第 7 步生产只读请求获准(一次,不进自动测试);按次定价句不实现;三处元格式化不在本票统一。

路径缩写:`R/` = `packages/ui-mac/src/renderer/`,`M/` = `packages/ui-mac/src/main/`,`C/` = `packages/codepuppy-contracts-consumer/`。

### 计划阶段查清的五件事

**1. 预检能返回哪些拒绝码、哪些有文案(alpha-platform `491707f`)**

- 200 里的结论只可能来自 account `/v1/preauth/check` → `preauthCheck`:`account-server.ts:477,485`;只有 `FAILURE_CODES` 成员能上 wire(`account.ts:2282` 的 `wire()` 经 `isFailureCode` 过滤),无码拒绝在投影里变成 503 `preauth_check_unavailable`(`lib/account-status.ts:36-38`)。
- `preauthCheck` 的有码结论只有四种:`account_suspended`、`account_wallet_insufficient`(含余额为负)、`account_allowance_exhausted`(`account.ts:2258-2266` 的 `evaluateAdmission`),以及首步快照的 `route_usage_stopped`(`lib/price-snapshot.ts:191`,只有 `price_source: model-route-pricing` 的首步会走到;`no_reachable_route` / `routes_expired` / `multimodal_unpriced` 不是 `FAILURE_CODES` 成员,被 `wire()` 去码,落 503)。`account_admission_rate_exceeded` 虽在 `FAILURE_CODES`(`failure-codes.ts:29`)、schema 允许(`billing.ts:66`),但 `preauthCheck` 不产出它。
- 按任务(首步来自 `lib/pipeline-registry.ts:90-171`、`lib/tier-router.ts` 的 `HARNESS_FIRST_BILLABLE`;计价来源 `billing-actions.ts:41-45`,全部 `allowance-then-wallet`):

| 任务键 | 首步 | 可能的 200 拒绝码 |
| --- | --- | --- |
| `research`、`code-review`、`docs`、`data-analysis`、`bugfix`、`migration`、`bounded-agent:openai_agents` | `model.invoke.chat`(model-route-pricing) | suspended · wallet_insufficient · allowance_exhausted · **route_usage_stopped** |
| `image-generation` | `tool.image_generate` | suspended · wallet_insufficient · allowance_exhausted |
| `bounded-agent:claude_code` | 无首步,只查账户三道闸 | suspended · wallet_insufficient · allowance_exhausted(两种表单都只派 `pipeline`,不会发这个键) |
| `office-report`、`html-generate` | 已停用 | 不到 200:400 `pipeline_kind_retired`(`lib/account-status.ts:27`) |
| 其余字符串 | — | 400 `unknown_pipeline_kind`(`lib/account-status.ts:25`) |

- 桌面 `failureCopy` 今天有文案的:`not-authenticated` / `unauthorized` / `account_allowance_exhausted` / `account_wallet_insufficient` / `account_suspended`(`R/extensions/cloud-failure-copy.ts:3-15`)。
- **没有文案、今天在代码上可达的只有 `route_usage_stopped`**(上表第一行七个任务键;本仓目录里的 `research` / `code-review` / `docs` 三个旧版条目都在其中)。触发条件是该首步模型的**每一条**可达 route 都带未复核的缺 usage 结算记录(人工复核才解除)。生产此刻有没有处在这个状态未测:要读生产 account 库的 `route_usage_suspended`,不在本票授权内。
- 处置:批准稿对无文案的码「只显示卡片、不下结论」,与 AC-02「拒绝时给出原因与下一步」字面不符(设计 §10 已报)。实现把它收在**一个判定点**(见下「决定点 D1」),两种结局都是一行改动。

**2. 不先退出就能换账号吗(设计留档里的未核实点)**

- 能。`completeAuth` 无条件整份覆盖 `stored`,不要求先登出(`M/codepuppy-auth.ts:572,599-625`);`startAuth` 本身不看登录态(`M/codepuppy-auth.ts:538`)。
- 已登录时仍可点到的登录入口:云表单错误行的「去登录」(`unauthorized` 时状态仍是 logged-in;`R/extensions/cloud-form-box.tsx:196`、`R/extensions/cloud-dispatch-box.tsx:270`)、回合错误卡的 `signIn`(`R/codepuppy-ui/session-timeline/session-timeline.tsx:239`)、模型选择的 `needs-login` 行(`R/codepuppy-ui/codepuppy-composer-model.tsx:461`),以及本票新增的预检提示条「去登录」。侧栏、定制中心、自动化的入口只在未登录时出现(`R/sidebar/codepuppy-sidebar.tsx:1420-1434`、`R/extensions/extension-hub.tsx:2193`、`R/automations/automation-panel.tsx:697-700`)。浏览器里网站登录的是 B 时,授权页回来的就是 B 的令牌。
- 换号时**不会**发 `auth-state`:`publish()` 的签名只含 status / mode / email / plan / platformStatus / refreshUnreachable(`M/codepuppy-auth.ts:316-324`),而 alpha-web 桌面令牌响应根本不带 email 与 plan(alpha-web `origin/main` `32a0708` `app/api/oauth/token/route.ts:72-83`),所以 A、B 两份 `stored.account` 都是 `{email: undefined, plan: undefined}`;status 仍 logged-in,mode 仍 platform,platformStatus 换号后仍 ready。签名不变,广播被吞。
- 空闲表单的后果:在途请求被主进程身份比对丢弃(设计 §4.4,本段实现),但**已显示的 A 的卡片与结论会留着**,直到下一个取数时机:窗口重新获得焦点且上次结果超过 30 秒(从浏览器授权页回来通常会触发,但不保证超过 30 秒)、下一次提交返回、或重新打开该条目。账户弹层同样不会刷新(它也靠 `auth-state`)。
- 处置见「决定点 D2」。

**3. 组件库两件**

- 位置与 API(组件稿 `#register`、`components.md` Pending 两行的名字):`R/codepuppy-ui/Card.tsx` + `card.css`(`<Card label?>` 只输出 `div.a-card`,`aria-label` 由调用方给,无外边距);`R/codepuppy-ui/KeyValueList.tsx` + `key-value-list.css`(`<KeyValueList rows={[{ label, value?, state? }]}/>` 输出 `dl.a-kv > div.a-kv-row > dt.a-kv-k + dd.a-kv-v`;`state: "pending" | "unavailable"` 时 `dd[data-state]`,不给 `value` 就画「…」/「—」并附只给读屏的「正在读取」/「暂时读不到」;给了 `value` 的灰字(弹层的「暂无数据」)不附读屏字)。样式逐字取组件稿 `.a-card` / `.a-kv*`,只用已有 `--a-*`,不加令牌;读屏隐藏类放在 `key-value-list.css` 内(`codepuppy-ui/` 今天没有通用的 sr-only 类)。
- 账户弹层改用:`R/sidebar/codepuppy-sidebar.tsx:1453-1513` 的五行换成 `<Card><KeyValueList/></Card>`,外层包一个带 `margin: 0 14px 12px` 的弹层自有容器;`R/sidebar/account-popover.css:138-162` 删 `.codepuppy-acct-card/-row/-k/-v/-pending`,新增该容器类。`pendingText()` 的「…」/「—」映射到 `state`。
- 允许的像素差异(在 headless Chrome 里打开组件稿 `#popover` 实测 `window.__popDiff`,浅深两色相同):卡片 282×162.9 → 282×164.5(+1.6);四个文字行 25.4 → 25.5;「近 14 天」行 35.4 → 36.5;读取中的值字号 11px → 11.5px。其余(位置、颜色、字重、圆角、边框、内边距 12)不变。
- 设计系统登记:`docs/design/system/components.md` 把 Pending 两行移进 Primitives 表;`docs/design/system/gallery.html` 加一节「Card · KeyValueList」(三种值状态、没有会员的两行、浅深两色;样例页按现有做法内联 CSS);`docs/design/current/shell-sidebar/components.md` 与 `current/customization-center/components.md` 两行台账「待实现」→「已实现(待合并)」。

**4. 按钮行右移(两种发送框一起)**

- CSS:`R/extensions/extension-hub.css:1304-1310` 的 `.codepuppy-ext-cloudrun` 加 `justify-content: flex-end`(只有这两个发送框用它)。定制中心按钮样式不动。
- `CloudFormBox`(`R/extensions/cloud-form-box.tsx:94-176`):行内顺序改为 字段 → 预检卡片 → 预检提示条 → 未登录提示 → 进行中状态字 → 「取消任务」/「正在取消」→ 主按钮 `[data-cloud-form-submit]`(最后一个)。预留行 `[data-cloud-hold]`(`:91-93`)只在预检 `unavailable` 或表单未就绪时显示。
- `CloudDispatchBox`(`R/extensions/cloud-dispatch-box.tsx:189-250`):输入框分支同上,主按钮 `[data-cloud-input]` 最后;代码审查分支预检两块放在按钮行**之前**(批准稿 `legacyBox` 的结构),行内顺序 未登录提示 → 「已直接发送」→「审查范围」→ 进行中状态字 → 取消 →「发送 Git 代码改动」→「选择文件并发送」(主按钮最后)。
- 各状态行(对照批准稿 `#rows`):发送中(卡片 + 「正在发送…」主按钮)、执行中(卡片 + 状态字 + 「取消任务」+ 主按钮)、正在取消(卡片 + 「正在取消…」+ 主按钮)、未登录(未登录提示 + 置灰主按钮,无预检两块)、旧版两按钮(次按钮在主按钮左边)。
- 测试定位:`cloud-form-box.test.ts` 用 `[data-cloud-form-submit]` / `[data-cancel-job]` / `[data-cloud-error-action]`;`cloud-dispatch-box.test.ts` 用 `[data-cloud-input]`、按按钮文字找代码审查两按钮(`:301`)、对话框确认用 `[role=dialog] button` 的最后一个(`:465`,对话框不在按钮行里)。都不依赖按钮行顺序,已核。

**5. 证明的工具与边界**

- 组件测试:沿用两份现有测试的 vite 构建 + happy-dom 写法(`R/extensions/upload-consent-test-runtime.ts` 已同时导出两个发送框)。
- 几何检查:本仓已有 headless Chrome 工具链——`playwright-core` + `packages/ui-mac/test-visual/vite.config.ts` + 本机 Chrome,先例 `R/codepuppy-ui/tooltip.browser.test.ts`(在 `bun test src` 里)。本段只复用它做**几何断言**(元素位置、尺寸),不做截图比对系统。
- 主进程:沿用 `M/codepuppy-cloud-jobs.cases.ts` 的假服务端(按 `claims.purpose === action` 判权)与子进程运行器。

### 决定点(实施前请编排器裁)

- **D0 画稿进本分支**:画稿只在 `design/1686-cloud-form-preflight`(无 PR)。建议本分支第一步 `git merge --no-ff a35bb81c26`(纯文档),让同一个 PR 带上现行稿、台账与 Pending 两行,之后由本段把台账翻成「已实现(待合并)」、把 Pending 移进 Primitives;几何测试也能直接读帧比对。不合并则这几处文档改动无处落,几何测试只能对照写死的数字。
- **D1 无文案的拒绝码(待 owner)**:默认按批准稿实现——`R/extensions/cloud-preflight.tsx` 里唯一一处 `refusalCopy(code) = failureCopy(code)`,为 `null` 时只显示卡片。owner 若选通用句(候选「平台现在不接受这项任务，请稍后再试。」),改成 `failureCopy(code) ?? { text: t(<新键>), action: null }` 一行,补中英两个键,并把 D1 那条测试的期望从「无提示条」翻成「warning + 该句」。默认不预埋这个键。今天可达的只有 `route_usage_stopped`(见第 1 条)。
- **D2 不先退出的换号**:建议在 `publish()` 的签名里加一项 `identity: getAuthIdentityTag()`(`M/codepuppy-auth.ts:316-324`,一行)。`sub` 跨续期稳定,纯续期仍不广播;真换号时所有订阅 `auth-state` 的面(预检区、账户弹层、模型选择)都会清空重取,正是设计 §4.4「身份变化」想要的前提。它改的是设计 P-15 描述的签名内容,所以列为决定点;不做则接受「空闲表单最多留到下一次焦点刷新」的残余,另起意向条目。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `C/scripts/vendor-codepuppy-contracts.ts` | V1 bundle 的 pin 从 `3f2f0dd` 前移到 `491707f`,`files` 加 `contracts/v1/fixtures/producer/account-status.json`,注释写明来由。已核 `3f2f0dd..491707f` 之间已钉的 22 个文件只有 wire schema 变,且只增不改(+342 行,新增 `$defs`)。 |
| `C/alpha-platform-contract.lock.json`、`C/vendor/alpha-platform/**` | 脚本重写:wire schema 新字节 + 新 fixture。 |
| `C/src/decode.ts`、`C/src/types.ts` | 新增 `AccountStatusV1` 校验器(`$ref …#/$defs/AccountStatusV1`,与其它云面同一个懒构建)与 TS 类型,登记进 `ContractValues`。 |
| `C/src/contracts.test.ts` | pin 期望(commit、文件数 22→23)更新;producer 列表加 `account-status.json`;新增「producer fixture 经桌面解码;多一个字段 / 不在 `FAILURE_CODES` 里的码被拒」。 |
| `packages/ui-mac/src/shared/codepuppy-config.ts` | `CODEPUPPY_PATHS.cloudAccountStatus = "/v1/cloud/account-status"`。 |
| `M/codepuppy-cloud-jobs.ts` | 新增 `getCloudAccountStatus(task)`:同步记下 `getAuthIdentityTag()` 后立即调 `authed(path?task=…, "account.read", undefined, decode AccountStatusV1 @ "cloud-http")`(`authed` 在第一次 `await` 之前同步取令牌,两者在同一时刻);返回时身份不同则丢弃结果,回 `{ error: "identity-changed" }`。不带 `format`。 |
| `M/cloud-ipc.ts` | `ipcMain.handle("cloud-account-status", …)`:只收字符串 task,交给上一行。 |
| `packages/ui-mac/src/preload/index.ts`、`preload/types.ts` | `cloud.accountStatus(task)`;类型 `CloudResult<AccountStatusV1>`(从 contracts-consumer 取类型)。 |
| `M/codepuppy-auth.ts` | 仅 D2 通过时:签名加 `identity`。 |
| `M/codepuppy-cloud-jobs.cases.ts`、`M/codepuppy-cloud-jobs.test.ts` | 假服务端加 `GET /v1/cloud/account-status` → `account.read`,200 体用钉住的 producer fixture;`./codepuppy-auth` 桩加可变的 `getAuthIdentityTag`;运行器的通过数随之更新。 |
| `R/codepuppy-ui/Card.tsx`、`card.css`、`KeyValueList.tsx`、`key-value-list.css`(新) | 见第 3 条。 |
| `R/sidebar/codepuppy-sidebar.tsx`、`R/sidebar/account-popover.css` | 弹层余额卡改用两件组件,外边距挪到弹层容器。 |
| `packages/ui-mac/test-component/account-quadrant.cases.ts` | 行选择器从 `.codepuppy-acct-row/-k/-v/-pending` 改为 `.a-kv-row` / `dt` / `dd`(取值时剔除读屏字),期望值不变。 |
| `R/extensions/cloud-preflight.tsx`(新) | 两种发送框共用的预检区:订阅 `auth.subscribe`(首次回调即「打开时取一次」;此后每次回调清空并在已登录时重取)、本表单递增序号、只采用「当前任务 + 最新序号」、窗口 `focus` 且结果超过 30 秒(常量)重取、提交返回后由宿主调用重取;状态按设计 §4.4 状态表;渲染 `Card` + `KeyValueList` + 现有 `Banner`(第二行说明作为 `Banner` 的 children 传入,`Banner` 不改)。`ready` 为假时不订阅、不请求、不渲染。忙时卡片保留最近一次结果、不显示提示条。D1 判定点在此。 |
| `R/extensions/cloud-failure-copy.ts` | 加 `pipeline_kind_retired` → 「这项云端功能已停用，请在本机生成。」,动作为无(提交后的同一码也改用这句)。 |
| `R/extensions/cloud-form-box.tsx`、`R/extensions/cloud-dispatch-box.tsx` | 插入预检区、按钮行改序(第 4 条)、提交返回后触发重取;目录表单预留行的显示条件。 |
| `R/extensions/extension-hub.css` | `.codepuppy-ext-cloudrun { justify-content: flex-end }`。 |
| `R/i18n/zh.ts`、`R/i18n/en.ts` | 新键:「现在可以发起」/ Ready to start、「现在发不了」/ Can't start now、已停用一句、预留句 ¥ 版(「预留 ¥{{yuan}},按实际用量结算;失败时已产生的费用仍会结算。」,英文照现有 `cloudHold` 句式)、卡片四个名称与「开」「关」、卡片读屏名「你的账户」、读屏字「正在读取」「暂时读不到」。中文逐字取批准稿文案表。 |
| `R/extensions/cloud-preflight.test.ts`(新) | 见「证明」。 |
| `R/extensions/cloud-form-box.test.ts`、`cloud-dispatch-box.test.ts`、`upload-consent-dialog.test.ts`、`cloud-failure-copy.test.ts` | 前三个的 `window.api` 桩补 `auth.subscribe` 与 `cloud.accountStatus`(默认回 `{ error: "network" }` = 查不到,既有断言语义不变);`cloud-failure-copy.test.ts` 加停用码一条。 |
| `packages/ui-mac/test-visual/cloud-preflight.html`、`cloud-preflight.tsx`(新)、`R/extensions/cloud-preflight.browser.test.ts`(新) | 用生产组件 + 生产 CSS 挂两种发送框各状态与弹层卡片(数据与 IPC 是桩),浏览器里量几何(见「证明」)。 |
| `docs/design/system/components.md`、`docs/design/system/gallery.html`、两份 `current/*/components.md` | 见第 3 条(依赖 D0)。 |

### 顺序

1. (D0 通过时)合并 `a35bb81c26`。不跑测试,只核 `git diff --stat` 全是 `docs/design/`。
2. 契约:vendor 脚本 pin + 拷入 + 解码器 + 类型 + 测试。拷入命令:`git -C <alpha-platform> archive 491707f contracts | tar -x -C <临时目录>`,然后 `CODEPUPPY_PLATFORM_CONTRACT_SOURCE=<临时目录> CODEPUPPY_PLATFORM_CLOUD_MCP_SOURCE=/Users/tide/app/alpha-platform CODEPUPPY_WEB_EXTENSION_PACKAGE_SOURCE=/Users/tide/app/alpha-web bun run vendor`(两条 commitBound pin 会从本机克隆按原 commit 重写同样的字节,已核两个 commit 本机可达),`git diff --stat` 只应动 V1 lock、wire schema 与新 fixture。相关测试:`C/` 下 `bun test`、`bun run check:vendor`(带临时目录做三方比对)、`bun run typecheck`。
3. 主进程与 preload:路径常量、`getCloudAccountStatus`、IPC、preload、(D2)签名一行。相关测试:`M/codepuppy-cloud-jobs.test.ts`、`M/ipc-channel-binding-census.test.ts`、`packages/ui-mac/src/shared/codepuppy-config.test.ts`、(D2)`M/auth-renewal.test.ts` 与 `codepuppy-auth` 相关测试;`ui-mac` typecheck。
4. 组件库两件 + 账户弹层改用 + 设计系统登记。相关测试:`R/sidebar/account-quadrant.test.ts`(子进程跑 cases)、typecheck。
5. 预检区 + 两个发送框改序 + 文案 + 组件测试 + 既有测试桩。相关测试:`cloud-preflight.test.ts`、`cloud-form-box.test.ts`、`cloud-dispatch-box.test.ts`、`upload-consent-dialog.test.ts`、`cloud-failure-copy.test.ts`、`R/i18n/locale-regression.test.ts`、`brand-residue-scan.test.ts`;customization-center 台账翻状态。
6. 几何测试 + harness 场景;同一次运行把各状态截图存到 `node_modules/.cache/1686-preflight/` 供核对(不入库、不比对)。
7. 联调证据(需编排器确认可用):用长期生产测试账号的凭证对生产 `GET /v1/cloud/account-status?task=research` 发一次只读请求,经桌面解码器解码,只记录状态码、字段名与 `task.admission.ok`,不打印凭证。凭证若不是带 `account.read` 的 API key(403),记录结果,联调留给 owner 侧打包回归。

### 风险

- **pin 前移的波及**:wire schema 是所有 V1 解码器共用的一份文件。已核 `3f2f0dd..491707f` 只增 `$defs`、不改既有定义;第 2 步的 `C/` 全部测试与 `M/` 里用到 V1 解码的测试(`codepuppy-cloud-jobs`、`cloud-ipc`)兜底。lock 里的 `repo: "jinjunnn/alpha-platform"` 是来源字符串,测试钉着它,不顺手改名。
- **契约失败的全局横幅**:`authed()` 解码失败会经 `reportContractFailure` 弹全局「平台契约不兼容」横幅(`R/codepuppy-ui/Banner.tsx` 的 `ContractFailureBanner`,`cloud-http` 面不被排除)。这是设计 §4.4「错误经现有咽喉」的既有行为,预检区本身按 `unavailable` 不加东西;只在日后平台改坏契约时出现。
- **既有挂载缺桩**:新增 `auth.subscribe` 与 `cloud.accountStatus` 调用后,任何以 `ready=true` 挂载发送框却没桩的测试会红。已知三份(上表),第 5 步按相关套件实跑再补,只补桩不改断言。
- **双重触发**:`ready` 变化与 `auth-state` 往往同时到;序号规则保证只采用最新响应,不另加去抖。
- **画稿不在本分支**:D0 不通过时,几何测试只能对照本段写下的数字,文档登记顺延到画稿合并之后。
- **价格句缺文案**:设计字段表写 `estimate.available === true` 时「以 `amount_fen` 写价格」,批准稿文案表没有这句。今天不可达——现役首步没有 `fixed-unit` 的(第 1 条表;设计 P-10)。实现对它不写预留句,也不新造文案;记为偏离候选,真出现按次定价的首步时回到界面稿。
- **元的格式化**:`¥(fen/100).toFixed(2)` 已在 `R/sidebar/codepuppy-sidebar.tsx:323` 与 `R/codepuppy-ui/codepuppy-composer-model.tsx:33` 各有一份私有实现;预检区再写一份同样的一行(不做跨文件重构),记为观察。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-02 调用路由(主进程) | `codepuppy-cloud-jobs.cases.ts`「account status uses account.read on GET /v1/cloud/account-status?task=… and decodes the pinned producer fixture」 | 用错 purpose → 假服务端 403 → 得到 `http-403` 而非载荷;路径或解码错 → 断言的字段对不上 |
| AC-02 调用路由(契约) | `C/src/contracts.test.ts`「AccountStatusV1 producer fixture decodes; an extra field or a non-FAILURE_CODES admission code is rejected」 | 没有校验器时 `validateFixture` 返回 false;校验器放宽时两条变体被接受 |
| AC-02 身份变化(主进程) | 同 cases 文件「identity tag changes while the request is in flight ⇒ { error: "identity-changed" } and no payload」+ 对照组「同一身份 ⇒ 原样返回」 | 去掉身份比对 → 返回的是上一身份的载荷 |
| AC-02 乱序与身份(渲染) | `cloud-preflight.test.ts`(两种发送框各跑):两次重叠请求后到先回 → 只显示最新;请求在途时收到 `auth-state` → 预检区立刻清空,旧响应(含 `identity-changed`)回来也不渲染 | 去掉序号或清空 → 旧值出现在卡片里 |
| AC-02 发起前调用 | 同文件:`ready` 为真挂载即以 `pipelineKind` 调 `accountStatus`、不带 format;`ready` 为假不调、不渲染;提交返回(受理与拒绝各一)后再调一次;焦点:30 秒内不调、超过才调(假时钟) | 去掉任一时机 → 调用次数/参数断言红 |
| AC-02 显示额度、余额、开关 | 同文件「能发」:卡片四行逐字(可用余额取 `available_fen`、额度「剩余 / 上限」千分位、开关「关」);`plan.status: none` → 只两行;查询中 → 四行「…」且无提示条 | 读错字段(如 `balance_fen`)或不画卡片 → 文本断言红 |
| AC-02 首步准入结论 + 预留如实标为预留 | 同文件:能发 → success「现在可以发起」+ 预留句(金额来自 `reserve.hold_fen`,¥ 两位);`reserve` 缺席 → 无预留句;目录表单有结果时 `[data-cloud-hold]` 不在、`unavailable` 时在 | 写成报价句或丢掉预留句 → 文本断言红 |
| AC-02 拒绝原因与下一步 | 同文件逐码:额度用完 →「打开余额支付」点击 → `openBillingPage("overflow")`;余额不够 → 原句 + 预留句 +「去充值」→ `recharge`;停用 → 无按钮;未登录(`not-authenticated` / `unauthorized`)→ 无卡片 + 「去登录」→ `auth.start`;`pipeline_kind_retired` → 停用句、无卡片;`unknown_pipeline_kind` →「要求已更新」句;`cloud-failure-copy.test.ts` 停用码一条 | 少接任一码 → 该行红 |
| AC-02 无文案的码(D1) | 同文件「route_usage_stopped ⇒ 卡片在、无提示条」(D1 若改,同一条翻期望) | D1 默认被改坏(例如回落到「未能确认…」通用句)→ 出现提示条即红 |
| AC-02 查不到不加东西 | 同文件对 `network`、`http-404`、`http-403`、`rate_limited`、`account_unavailable`、`preauth_check_unavailable`、`contract-incompatible`、`http-400` 逐个:无卡片无提示条 | 任一码被当成拒绝或画出卡片 → 红 |
| AC-02 只作提示、不拦提交 | 同文件:预检挂起不回 / 拒绝状态下,主按钮可点且点击即派发;忙时只留卡片、无提示条 | 主按钮被预检置灰或等待预检 → 红 |
| 按钮行(两种发送框) | 同文件:各状态下 `.codepuppy-ext-cloudrun` 最后一个元素是 `[data-variant=primary]`,代码审查的次按钮紧挨在它前面,状态字与「取消任务」在按钮之前;`cloud-preflight.browser.test.ts`:主按钮右边缘 = 行右边缘(±0.5px),预检两块在输入框之下、按钮行之上;D0 通过时再与 r3 帧 `#form-ok` / `#legacy-ok` 同浏览器量得的卡片高、提示条高、提示条到按钮行的间距比对(±0.5px) | 回退 DOM 顺序或 `justify-content` → 位置断言红 |
| 组件库 + 账户弹层 | `account-quadrant.test.ts`(行数、标签、值逐字不变);`cloud-preflight.browser.test.ts`:弹层容器内同内容的卡片高 164.5、文字行 25.5、走势行 36.5、读取中值字号 11.5px(第 3 条实测值) | 弹层没改用组件或样式偏离组件稿 → 尺寸断言红 |
| 联调 | 第 7 步的一次生产只读请求经桌面解码器解码的记录(若凭证可用) | 路由或契约与钉住的 fixture 不一致 → 解码失败 |

打包版才能证明、留给 owner 侧回归:真实登录令牌在打包版里打到生产路由、两种发送框的数值与网站账户页一致;去网站充值或打开余额支付后回到应用的焦点刷新;不先退出的换号(按 D2 的结局);侧栏账户弹层在真实应用浅深两色下与组件稿 `#popover` 一致;520 高窗口里发送按钮可见(批准稿 `#small-window`)。

### 偏离记录

暂无。
