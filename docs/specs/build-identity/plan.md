---
id: PLAN-build-identity
title: 报问题时复制构建身份 实施计划
summary: alpha-code#237 一段:账户浮层版本行可点复制一行构建身份,非正式发布包带标记
kind: plan
status: active
spec: SPEC-build-identity
design: ""
owners: [alpha-code desktop maintainers]
last_reviewed: 2026-11-12
---

# PLAN-build-identity｜报问题时复制构建身份 实施计划

由实施会话在计划阶段写,编排器核对后由同一会话实施。每个交付段一节;旧段留作证据。决定只链接、不重述;实施中偏离本段,在同一个提交里改本段。

路径相对 `packages/ui-mac/`。

## 段一:版本行复制构建身份与来源标记

- 依据:规格 `SPEC-build-identity` v1(owner 2026-11-12 批准,`docs/specs/build-identity/spec.md`),覆盖 BR-01…BR-03、AC-01…AC-04 与「体验约定」,原文以该文件为准;无 design.md;视觉沿用账户浮层现有版本行(alpha-code#1187)与现有小标签样式,不另出稿;Issue [alpha-code#237](https://github.com/impharaon/alpha-code/issues/237);基线 `origin/alpha` @ `c01ea14919`。
- 核对:(待编排器核对;实施首个提交回填)

### 已查实的事实(实施依据)

- 发布流水线已有的「这是正式发布」信号:`electron-builder.config.ts` 的 `shouldSign`(`GITHUB_ACTIONS=true` 或 `CODEPUPPY_SIGN=1`)与 `channel !== "dev"` 两者同时成立时,`beforePack` 才放行并调 `assertReleaseSource`(要求工作区干净且 HEAD == origin/alpha)。runbook(`docs/runbooks/distribution.md` ②)里 `build` 与 `package:mac` 在同一个 `source signing.env` 之后跑,所以这一对条件在 electron-vite 构建那一步同样可读。**本段取这一对条件作为「构建来源 = 正式发布」的事实**,在构建期写进主进程包;其余一切(开发服务器、未签名的本机 `package:mac`、`CODEPUPPY_SIGN` 未设)都是「本机构建」。运行时不猜。
- 现有 `app-version` IPC 由 `app-version-ipc.wiring.cases.ts` 钉死返回 `app.getVersion()` 实时值,不动它。
- 渲染端已有 `copyText`(优先 `window.api.writeClipboard`)与 `codepuppy.common.copied`=「已复制」;当前版本行是 `div.codepuppy-acct-version`,版本值取自 `window.api.appVersion()`;`account-version.cases.ts` 以 `.codepuppy-acct-version` 的文本含哨兵版本号为判据。
- `import.meta.env.<X>` 在构建时被 `define` 静态替换、在 `bun test` 下等于 `process.env`;所以 handler 每次调用时读它,测试换环境值即换真源。
- Electron 的 `process.getSystemVersion()` 给 macOS 版本号(`os.release()` 给的是内核号,不用)。

### 改动
| 文件 | 改什么 |
| --- | --- |
| `scripts/build-identity.ts`(新) | 构建期事实的唯一出处:`isReleaseBuild(channel, env)`(上述那一对条件)、`buildIdentityDefine(channel, env)`(返回 electron-vite `define` 条目:构建提交短编号 `git rev-parse --short=7 HEAD`,取不到为空串;构建日期 UTC `YYYY-MM-DD`;来源 `release`/`local`) |
| `electron.vite.config.ts` | `main.define` 并入 `buildIdentityDefine(channel, process.env)` |
| `electron-builder.config.ts` | `beforePack` 里 `channel !== "dev" && shouldSign` 改为调同一个 `isReleaseBuild`,避免「什么算正式发布」有两份判断;行为不变 |
| `src/main/env.d.ts` | `ImportMetaEnv` 增三个只读字段 |
| `src/shared/build-identity.ts`(新) | `BuildIdentity` 类型(version、channel、commit、date、origin、os、arch,缺失为空串)、`formatBuildIdentity`(BR-02 的一行,空字段写「未知」)、`buildMarker`(`dev` → 开发版;否则来源非 release → 本机构建;否则无) |
| `src/main/build-identity-ipc.ts`(新) | 注册 `build-identity` IPC:handler 每次调用现读 `app.getVersion()`、`CHANNEL`、三个构建事实、`process.getSystemVersion()`/`process.arch`,不含用户名、路径、账号、项目名 |
| `src/main/index.ts` | 紧随 `registerAppVersionIpcHandler()` 注册新 handler |
| `src/preload/index.ts`、`src/preload/types.ts` | 桥上加 `buildIdentity: () => Promise<BuildIdentity>` |
| `src/renderer/sidebar/codepuppy-sidebar.tsx` | 版本行改为 `button.codepuppy-acct-version`:点击取 `buildIdentity()`、经现有 `copyText` 复制 `formatBuildIdentity`,行内文字改为 `codepuppy.common.copied` 约 2 秒后恢复;版本号后按 `buildMarker` 渲染小标签;取不到身份时行仍显示版本,点击无动作 |
| `src/renderer/sidebar/account-popover.css` | 版本行改可点(去按钮默认样式、`cursor:pointer`);标签样式照 `.codepuppy-ext-chip` 的取值(该文件只随扩展页加载,不能直接引用) |
| `src/renderer/i18n/zh.ts`、`en.ts` | `codepuppy.sidebar.buildMarker.dev`=开发版 / `.local`=本机构建 |
| `test-component/preload-stub.ts` | 桥方法名清单加 `buildIdentity`(若该清单要求与 types 对齐) |
| 测试 | 见「证明」;并同步 `scripts/gate-files.tsv` 中两个子进程宿主的精确条数与说明 |

渠道「beta」:复制行写 `beta`(规格只定正式/开发);标记按上面的规则(非 dev,看来源)。

### 顺序
1. 本计划单独提交。
2. 构建期定义 + 共享格式化 + main IPC + preload 类型 + 测试(`bun test src/shared/build-identity.test.ts src/main/app-version-ipc.wiring.test.ts`,另跑 `src/main/release-source.test.ts`、`src/main/mac-target-arch.test.ts` 证明 `electron-builder.config.ts` 行为不变)。
3. 渲染端版本行 + 样式 + i18n + 组件测试(`bun test src/renderer/sidebar/account-version.test.ts`、`src/renderer/i18n/locale-regression.test.ts`),同步 gate-files.tsv。
4. `tsgo -b` 类型检查与 `old-name-scan.test.ts`。

### 风险
- 构建与打包若在不同环境变量下各跑一次,会出现「构建时是本机、打包时签名」:结果偏向把正式包标成「本机构建」(安全方向);反向(构建时带签名变量、打包不带)需要有人故意拆开跑,runbook 没有这种步骤。不在运行时补救。
- `git rev-parse` 取不到(源码包、无 git)时提交为空串 → 「未知」(AC-03),构建不失败。
- 开发服务器(`bun run dev`)读同一份配置,会嵌入当时的 HEAD 短编号并标「本机构建」;非 dev 渠道且无签名变量即如此。dev 渠道则显示「开发版」。
- 可视效果(标签位置、按钮化后的版本行外观)测试环境看不到,只能证明 DOM 状态与文案;真机截图留给验收。
- 版本行由 `div` 改 `button`,`account-version.cases.ts`、`account-quadrant.cases.ts` 的 `.codepuppy-acct-version` 选择器与账户浮层里其它按钮计数断言需回归。

### 证明
| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01 | `src/main/app-version-ipc.wiring.cases.ts` 增一条:真 `registerBuildIdentityIpcHandler`,换 `getVersion` 返回值与 `process.env` 里的三个构建事实,handler 返回随之变、`formatBuildIdentity` 的一行逐字等于预期;`test-component/account-version.cases.ts` 点击后捕获 `writeClipboard` 的实参等于同一事实喂进去得到的一行,且行内出现「已复制」、约 2 秒后恢复 | 把值写成字面量或复制别处,换源后断言即红;不写剪贴板、不显示「已复制」即红 |
| AC-02 | 组件用例:桥给三份身份(dev 渠道、prod+本机、prod+release),版本行标记依次为「开发版」「本机构建」、无标记;`src/shared/build-identity.test.ts` 逐格断言 `buildMarker` 与行内渠道/来源字段一致 | 标记规则缺一格即红 |
| AC-03 | `src/shared/build-identity.test.ts` 与 wiring 用例:commit 空 ⇒ 行内为「未知」其余字段不变;handler 在 `process.env` 无任何构建变量时不抛 | 省略字段、写成 `undefined`/空串,或抛错即红 |
| AC-04 | wiring 用例:以含用户名与家目录的 `process.env`(HOME、USER)与 `app.getPath` 替身运行,handler 返回与复制行都不含这些串;返回对象的键恰为约定的七个 | 任何泄漏个人信息的字段被加入即红 |
| 构建事实 | `scripts/build-identity.ts` 的测试:`isReleaseBuild` 四格(dev/非 dev × 签名有/无)、`buildIdentityDefine` 在无 git 目录的临时目录下提交为空串、在真仓库里为 7 位十六进制 | 来源判断写错或无 git 时抛错即红 |

### 偏离记录
暂无。
