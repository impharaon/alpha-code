---
title: alpha-code#1669 打包版换代回归与撤回演练 —— 第一轮:打包构建失败,未启动应用
kind: verification
status: active
owners:
  - alpha-code desktop maintainers
last_reviewed: 2026-11-12
---

# alpha-code#1669 打包版回归与撤回演练(L7)—— 第一轮

依据:方案基线 [§5.1、§5.2、§6.2、§2.8](../../design/2026-11-08-1662-opencode2-generation-switch-baseline.md),
票面 `impharaon/alpha-code#1669`,派发书里的七个补充格 a–g 与八条硬规矩。

## 结论

1. **打包构建失败,所以没有可测的包。** `bun run build` 的前两段(prebuild、引擎包)成功,第三段 `electron-vite build`
   打主进程时报 `The symbol "__cjs_mod__" has already been declared`,`package:mac` 没有执行到。同一命令重跑一次,结果相同。
   依赖打包版的格子全部 NOT-RUN(被构建失败挡住)。详见「构建」。
2. **隔离闸已就绪,两条故意做坏的臂都被拒绝,正常臂通过。** 闸没有绑到任何一次应用启动上,因为本轮没有启动应用。
3. **第二个阻断,与构建无关:硬规矩 2(ii) 的沙箱与产品的进程围栏不能同时成立。** 应用跑在隔离沙箱里时,引擎 sidecar 装围栏
   (`sandbox_init`)被内核拒绝(`Operation not permitted`),而 sidecar 装不上围栏就拒绝启动。所以构建修好之后,
   凡是需要引擎的格子,在派发书现有规矩下也跑不了。需要编排器先定做法(见「第二个阻断」里的三个选项)。
4. **登录需要 owner。** 打包版不认 `DEV_PLATFORM_TOKEN`,平台凭据只能来自网站登录(浏览器 + 验证码)。
5. 本轮付费模型调用 0 次;没有启动任何 Code Puppy 实例;没有碰 `/Applications/Code Puppy.app` 与 owner 的数据目录;
   隔离闸与探针运行后 `pgrep -x SecurityAgent` 为 0,没有出现系统框。

计数(90 个格子):PASS 0 / FAIL 0 / NOT-RUN 90。前置项:构建 FAIL,隔离闸 PASS,单实例核对 NOT-RUN。

## 构建

| 项 | 值 |
| --- | --- |
| 检出 | worktree `alpha-code-verify-1669-packaged-regression`,分支 `verify/1669-packaged-regression` |
| 构建 SHA | `e0fbe507207fe8378e4d4d662122df257bc59c18`(运行时等于 `origin/alpha`) |
| 与派发书的差异 | 派发书写的是 `a7d71dd5a9`(#1694 合并)。HEAD 多一个提交 #1695;失败涉及的四处(`electron.vite.config.ts`、`scripts/build-engine.ts`、`packages/cli/vite.node.config.ts`、`packages/ui-mac/engine/`)在两者之间没有改动(`git diff --stat a7d71dd5a9 e0fbe50720 -- <这四处>` 为空),所以在 `a7d71dd5a9` 上同样会失败(推断,没有单独构建) |
| 命令 | `export PATH=~/.bun-versions/1.4.4/bin:$PATH HUSKY=0; cd packages/ui-mac; env -u CODEPUPPY_SIGN OPENCODE_CHANNEL=prod bun run build`,成功后接 `env -u CODEPUPPY_SIGN OPENCODE_CHANNEL=prod bun run package:mac`(未签名,不碰钥匙串) |
| 结果 | **FAIL**,exit 1。日志:[results/build.log](results/build.log),重跑:[results/build-rerun.log](results/build-rerun.log) |
| 已过的段 | prebuild:`gen-db-expected: 59 ids + 2 retired`,围栏原生模块双架构(`buildId=fence-20261113T013304094Z`),Office 运行时 arm64;引擎包 `dist-engine/engine.mjs (OpenCode 2.2.5, node24, 38 native assets)` |
| 失败的段 | `electron-vite build`(main):`chunks/engine-!~{004}~.js:8:7: ERROR: The symbol "__cjs_mod__" has already been declared` |
| 0.1.26 的对应行为 | 0.1.26 同一流程能打出包(v0.1.26 已于 2026-11-05 发布) |

原始错误(摘自 [results/build.log](results/build.log)):

```
[vite:esbuild-transpile] Transform failed with 1 error:
chunks/engine-!~{004}~.js:8:7: ERROR: The symbol "__cjs_mod__" has already been declared
6  |  const require = __cjs_mod__.createRequire(import.meta.url);
7  |
8  |  import __cjs_mod__, { createRequire, registerHooks } from 'node:module';
```

**观察:** 引擎包自带一段 CommonJS 垫片,第 46 行 `import __cjs_mod__ from "node:module"`、第 54 行
`const require = __cjs_mod__.createRequire(import.meta.url)`。它来自上游 `packages/cli/vite.node.config.ts:161-170` 的 banner,
`packages/ui-mac/scripts/build-engine.ts:67,80` 只去掉了 shebang、其余照留。主进程构建又给每个 chunk 加一段同名垫片
(`packages/ui-mac/electron.vite.config.ts:59-66` 的 `output.banner`)。引擎所在的 chunk 里两段都在,esbuild 报重复声明。
逐行摘录:[results/engine-shim-lines.txt](results/engine-shim-lines.txt)。

**推断:** #1667(L5,把 OpenCode 2 嵌进 sidecar)之后没有人跑过完整的打包构建 —— 方案基线 §9 也写着「打包形态仍未测,归 L7」。
修法归 #1667 那条 lane,本轮不改产品代码。

worktree 在本轮开始前就有一处未提交改动:`bun.lock` 去掉了一批 `"libc"` 字段(没有版本号变化)。本轮没有碰它,也没有提交它。

## 隔离闸(硬规矩 2)

工具:[tools/isolation-gate.sh](tools/isolation-gate.sh) + [tools/mach-probe.c](tools/mach-probe.c)。每一步只在前一步通过后才跑,
任何一步失败就退出 1,并打印「不得启动」。所有钥匙串命令都跑在 guard 沙箱里;临时钥匙串的口令是随机一次性的,从不打印;不读任何条目内容。

| 检查 | 内容 |
| --- | --- |
| 1 guard-files | 真实 `~/Library/Keychains`:沙箱外 `ls` 成功(探针不瞎),沙箱内被拒 |
| 2 guard-agent | `com.apple.authd`、`com.apple.security.agent`、`com.apple.security.agent.login`:沙箱外可查到,沙箱内 `kr=1100` 查不到(只查找,不发消息,不会唤起服务) |
| 3 keychain | 沙箱内、HOME 与 CFFIXED_USER_HOME 改到临时根:用户域搜索列表**恰好一项**,就是临时根里新建的钥匙串;默认钥匙串也是它;已解锁、不自动上锁 |
| 4 real-domain | 真实用户域的搜索列表与默认钥匙串前后逐字相同(只比哈希) |

先跑两条故意做坏的臂,再跑正常臂:

| 臂 | 做坏的方式 | 结果 | 输出 |
| --- | --- | --- | --- |
| 坏臂 1 | 不建临时钥匙串(2026-11-01 事故的形态) | 第 3 步拒绝:`search list has 0 entries`,exit 1 | [results/gate-broken-keychain.txt](results/gate-broken-keychain.txt) |
| 坏臂 2 | guard 里去掉 mach-lookup 的拒绝行 | 第 2 步拒绝(沙箱内三项都 `reachable`),在任何钥匙串命令之前退出 1 | [results/gate-broken-guard.txt](results/gate-broken-guard.txt) |
| 正常臂 | — | 四步全过,exit 0;收尾删掉临时钥匙串与临时根 | [results/gate-good.txt](results/gate-good.txt) |

还没证明的一处(推断,没测):文件钥匙串的解锁框与访问授权框,可能由 `securityd` 代客户端去请求 SecurityAgent,
而不是客户端自己去查 SecurityAgent。guard 挡住的是客户端自己的路径(authd、security.agent)和真实钥匙串文件,
证明不了「临时钥匙串上由 securityd 发起的框」一定弹不出来。去实测它,就要故意触发那个框,所以没测。下一轮启动时的缓解:
临时钥匙串已解锁且不自动上锁,Chromium 加 `--use-mock-keychain`(不碰钥匙串)。

## 第二个阻断:隔离沙箱与产品进程围栏不能同时成立

探针 [tools/fence-nest-probe.cjs](tools/fence-nest-probe.cjs) 做的就是 sidecar 装围栏的那一步(加载本轮构建出的 `codepuppy_fence.node`,
调 `apply()`)。传的是全放行的 profile,所以如果被拒,原因只能是嵌套。输出:[results/fence-nest-probe.txt](results/fence-nest-probe.txt)。

| 运行环境 | 沙箱外(对照) | 隔离闸的 guard 沙箱内 |
| --- | --- | --- |
| Node v22.22.3 | `rc 0` | `rc -1`,`Operation not permitted` |
| Electron 42.3.3 / Node v24.15.0(sidecar 用的运行时,run-as-node) | `rc 0` | `rc -1`,`Operation not permitted` |

代码事实:darwin 上 sidecar 装不上围栏就拒绝启动(`packages/ui-mac/src/main/sidecar.ts:224-233`,
`process-fence-apply.ts` fail-closed);`process-fence-profile.ts:15` 写明「嵌套 seatbelt 只在编译后策略完全相同时放行」;
#1554 的夹具也是同一结论(`docs/verification/2026-11-05-1554-sync-hang/fixture/run-dev-repro.mjs:8-10`)。

后果:把打包版放进 guard 沙箱,主进程和界面能跑,引擎起不来。不需要引擎的格子(G10 启动预检、演练里「库超前」那一半、
部分冒烟格)可以在 guard 下做;需要引擎的格子在派发书现有规矩下做不了。

给编排器的三个选项:

- **A. 引擎格不套外层沙箱,其余隔离照旧。** HOME / CFFIXED_USER_HOME / XDG_* 改道,临时钥匙串(闸的第 1、3、4 步照旧强制),
  Chromium `--use-mock-keychain`,另起 SecurityAgent 看门狗,一出现新的 SecurityAgent 就停。同一个包先在 guard 下跑一次「预检」
  (引擎会被拒),从系统日志数主进程和界面碰钥匙串 / authd 被拒的次数,证明它们根本不去找钥匙串。剩余风险:框可能在看门狗停下之前已经弹出。
  这偏离硬规矩 2(ii),需要编排器明确放宽。
- **B. 引擎格放进 owner 在场的那一次。** owner 本来就要来做登录(验证码),框弹出时他在场、知道是什么。用 A 的同一套脚本。
- **C. 加一个只在测试时跳过围栏的开关。** 不建议:测的不是出货的产品,G8 也就没有意义。

建议 A + B:用 A 的脚本,登录与第一次引擎启动放在 owner 在场时做;之后的引擎格是否继续在 owner 不在场时跑,由编排器决定。

## 登录与测试账号

- 打包版忽略 `DEV_PLATFORM_TOKEN`(`packages/ui-mac/src/main/codepuppy-auth.ts:172-179`)。平台凭据只来自登录:未登录时
  `applyAuthEnv` 删掉 `CODEPUPPY_API_KEY`(`codepuppy-auth.ts:352-363`),凭据文件只镜像这个环境变量(`codepuppy-secret-files.ts`)。
  所以长期生产测试 key(`sk-alpha-`)放不进打包版的平台凭据通道。
- 登录是网站上的浏览器授权(`codepuppy-auth.ts:5-7`,`shell.openExternal` 打开的是 owner 的默认浏览器),要收验证码 ⇒ 需要 owner。
  本轮没有点登录,也没有读那把 key。

## 单实例与身份(硬规矩 3)—— NOT-RUN(没有包)

下一轮启动前要核的静态事实:

- userData 由代码定为 `<appData>/ai.opencode.desktop`(`packages/ui-mac/src/main/index.ts:494-497`),在 `requestSingleInstanceLock()`
  (`index.ts:573`)之前设好,所以锁跟着 appData 走;appData 是否随 HOME / CFFIXED_USER_HOME 改道,要在启动后用 lsof 实测,不能假设。
  `--user-data-dir` 不起作用,会被这次 `setPath` 覆盖。
- bundle id 同为 `com.tide.codepuppy`:要直接执行包里的二进制,不走 `open`,免得 LaunchServices 把启动转给 owner 那个实例。
- 调试口写死 9222(`index.ts:568`),启动前确认这个端口没人占。
- 包的版本号 0.1.26 等于最新发布版本,预期不会去下载更新;启动后读更新日志核实。

## §5.1 合并闸

| 闸 | 结果 | 说明 |
| --- | --- | --- |
| G1 发送 | NOT-RUN | 被构建失败挡住;还需要引擎(第二个阻断)与登录(owner) |
| G2 审批 | NOT-RUN | 同上 |
| G3 工具策略 | NOT-RUN | 同上 |
| G4 MCP / 云工具 | NOT-RUN | 同上(云 MCP 要登录) |
| G5 BYOK | NOT-RUN | 被构建失败挡住;还需要引擎,以及 owner 的 DeepSeek Key |
| G6 历史连续 | NOT-RUN | 被构建失败挡住;还需要引擎 |
| G7 生态隔离 | NOT-RUN | 同上 |
| G8 围栏 | NOT-RUN | 同上 |
| G9 凭证不导入 | NOT-RUN | 同上 |
| G10 前进前备份 | NOT-RUN | 被构建失败挡住(不需要引擎,可以在 guard 下做) |

## §5.2 行为基线(0.1.26 回归矩阵,alpha-work#129 的格子)

| 格子 | 结果 | 说明 |
| --- | --- | --- |
| 重跑(引擎相关,44 格):N01、N02、N18、N03、N04、N05、N06、N07、N08、N19、N09、N15、N16、N10、N11、N17、N12、R08、R09、R10、R11、R12、R13、R14、R15、R16、R17、R18、R19、R20、R22、R23、W02、W03、W04、W07、W08、W09、W10、W11、W22、W23、W24、W25 | NOT-RUN | 被构建失败挡住;需要引擎的格子还被第二个阻断挡住 |
| 新增格(裁决书 R19):首启转换时 `~/Documents` 下会话的系统授权框 | NOT-RUN | 被构建失败挡住;这是系统级授权框,需要 owner |
| 冒烟(23 格):R04、R05、R06、R07、W01、W12、W13、W05、W20、W21、W06、W14、W15、W16、W17、W18、W19、W26、W27、N00、N13、N14、W28 | NOT-RUN | 被构建失败挡住 |

## 补充格 a–g

| 格 | 结果 | 说明 |
| --- | --- | --- |
| a 随包 ext 装载、引擎报就绪 | NOT-RUN | 被构建失败挡住;还需要引擎 |
| b 模型链就绪、选择器列出平台模型、发一条并收到回复 | NOT-RUN | 被构建失败挡住;还需要引擎与登录 |
| c 平台模型请求带上用户凭据(引擎日志里没有占位串) | NOT-RUN | 同 b |
| d 生成会话标题 | NOT-RUN | 同 b |
| e 网页搜索可用,或失败时给出具名原因 | NOT-RUN | 同 b |
| f 审批卡、「本次会话内允许」、超时卡 | NOT-RUN | 同 b |
| g 首次健康探测失败时界面不卡死 | NOT-RUN | 被构建失败挡住;还需要引擎 |

## §6.2 撤回演练

| 步 | 结果 | 说明 |
| --- | --- | --- |
| 0 独立 userData 生效(备份目录落在临时 userData 下) | NOT-RUN | 被构建失败挡住 |
| 1 合成 v1 库副本,记录 1.x 打包版看到的会话数与最新一条 | NOT-RUN | 被构建失败挡住(没有 2.x 包,演练无从开始);1.x 打包版的引擎同样有围栏,也受第二个阻断限制 |
| 2 2.x 打包版:先确认安全带备份生成,再记迁移、会话数、能否续写 | NOT-RUN | 被构建失败挡住;迁移与续写还需要引擎 |
| 3 模拟合并 → `revert -m 1` → 1.x 包:「库超前」阻断 → 按 §6.1 第 4 条手工恢复 → 会话数一致 | NOT-RUN | 依赖第 2 步 |
| 4 证据落盘 | NOT-RUN | 依赖第 1–3 步 |

## 文件

- [tools/isolation-gate.sh](tools/isolation-gate.sh)、[tools/mach-probe.c](tools/mach-probe.c):隔离闸
- [tools/fence-nest-probe.cjs](tools/fence-nest-probe.cjs):围栏嵌套探针
- `results/`:构建日志(已把 home 路径换成 `~`)、闸三条臂的输出、探针输出、垫片逐行摘录
- 没有截图:本轮没有启动应用
