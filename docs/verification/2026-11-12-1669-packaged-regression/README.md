---
title: alpha-code#1669 打包版换代回归与撤回演练 —— 第六轮(0.2.0 候选包):审批与失败回合已回到 0.1.26;R17 不派子任务、审批中追加消息不显示、附件 docx 标签错(FAIL);出网批准框打断了隐藏
kind: verification
status: active
owners:
  - alpha-code desktop maintainers
last_reviewed: 2026-11-13
---

# alpha-code#1669 打包版回归与撤回演练(L7)

依据:方案基线 [§5.1、§5.2、§6.2、§2.8](../../design/2026-11-08-1662-opencode2-generation-switch-baseline.md),
票面 `impharaon/alpha-code#1669`,派发书里的七个补充格 a–g 与八条硬规矩。第二轮在前,第一轮原文在后。

## 第六轮(2026-11-13 00:31–02:10 EST,新会话)—— 0.2.0 候选包,一次扫完

被测:编排器给的候选包 `alpha-code-fix-1669-g2-reject-hangs/packages/ui-mac/dist/mac-arm64/Code Puppy.app`(分支头 `0b404fc956`,0.2.0,prod,未签名),
`app.asar` sha256 `20388aaf…`,原样副本 `codesign --verify` 不过(同第二轮),测的是根内 ad-hoc 重签的副本(asar 字节不变)。
登录态沿用根 A(停 a4 → 旧副本移到 `<A>/app-old-a4/` → 候选副本放进 `<A>/app/` → 同根同闸启动 a5):**换包后直接是登录态**(`data-auth="in"`、「按量付费」,账户弹层底部「版本 0.2.0」)。
所有实例启动即隐藏;新根 E(全新数据)闸 [r6-gate-E](results/r6-gate-E.txt) 五步全过,看门狗沿用(sha `0abd0238…` 未改,A 在运行不跑诱饵)。原始事实:[results/r6-raw.txt](results/r6-raw.txt)。

### 第六轮结论

1. **启动(补充格 a)PASS**:`app starting {version:'0.2.0'}`、`db-safety: watermark equal`、`codepuppy-ext: loading plugin bundle`、`process fence applied`、`server ready`;界面事件流只有 **1 条** `GET /api/event`,打开定制中心后仍是 1 条(第三轮的构建是 5 条)。
2. **审批全部回到 0.1.26 的行为**(未开 / 已开定制中心各一次):拒绝 ⇒ 引擎 50 ms 内 `The user declined this tool call`、无文件;允许一次 ⇒ 写入;本次会话内允许 ⇒ 下一次不再问;
   超时卡「没等到你批准 5 分 0 秒 / 审批已超时,未获批准…」;回复请求 `POST …/permission/…/reply` 204、2 ms,之前 19 秒内没有连接池阻塞。审批等待中回答提问卡(引擎 53 ms 收到)、停止(44 ms 中断、无文件)都送达;
   对话内装连接器(G2 的第二个入口)「确认安装 → 授权并安装」0.6 秒后工具完成。G3、G4 第一方一半、审计 A、B 都 PASS。
3. **FAIL ×3(都有 0.1.26 实测对照或矩阵原文):**
   - **R17 `@general` 不再派子任务。** 从弹出菜单选中 `@general` 发「在当前文件夹新建文件…」:消息带着 `agents:[general]`,但模型自述「They mention @general but it's a simple task — I'll just do it.」直接调 `write`,卡片是「改文件 rc-test-r6b.txt」,没有派出确认、没有「子任务里不再逐项询问」。
     0.1.26(根 B,同样操作)卡片「Start a subtask / Hand off to assistant general / … / Subtasks won't ask again step by step」。截图 [候选](screens/r6-r17-card-delegation.png) / [0.1.26](screens/r6-b126-r17-card.png)。拒绝后两边都没有文件。
   - **审批等待中追加的消息在界面上消失,直到你回答审批。** 请求当即到了引擎(`POST /prompt` 200,2 ms;引擎 `session_inbox` 一行 `delivery=steer`),回答审批后它作为下一轮出现并执行(文件内容最终是 `hello-follow-up`);但在那之前输入框清空、对话里没有气泡也没有排队提示。
     0.1.26:追加的消息立刻作为「New turn」气泡显示在等待卡上方。截图 [候选](screens/r6-p2-followup-during-approval.png) / [0.1.26](screens/r6-b126-followup-during-approval.png)。
   - **N01:附件 docx 读到了,但小标签说「这一轮助手没有读取 · 请助手读取」。** rc.docx 文件卡发前「本机读取」、暂存到 `.codepuppy/attachments/<uuid>/rc.docx`,助手在 Code Mode `execute` 里调 `codepuppy-word.read_docx` 读出口令 7319(正确);标签停在「没有读取」,重开对话也一样。
     矩阵 N01 预期(0.1.26 / d3790e101 记 PASS):「各自小标签最终是『已读取』」。推断:读取发生在 `execute` 内部,标签只认直接的读取工具调用(没有验证)。截图 [r6-n01-answer-reopened](screens/r6-n01-answer-reopened.png)。rc.md「直接进对话」、图片说明与角标、看图回答都正常。
4. **与 0.1.26 相同的两处(观察,不判 FAIL)**:审批等待中点「停止」,回合停了但审批卡留在屏幕上,点「拒绝」报「未能提交你的选择 … Permission request not found」—— 0.1.26 停止后卡片同样一直留着([0.1.26](screens/r6-b126-after-stop-30s.png));
   终端拖宽面板后不重排(`stty size` 仍 36 列,0.1.26 也是 36 列不变)、右栏切到「审查」再切回「终端」是黑屏无输入(0.1.26 同样黑屏,[0.1.26](screens/r6-b126-terminal-reopened.png));候选包上切换对话再回来终端恢复并回放历史。
5. **事故:一个原生对话框把隐藏的测试窗口带到了屏幕上。** 02:00:47 做 N11(a)(「用 webfetch 读取 https://nx-rc0125-probe.invalid/」)时,引擎去连这个地址,主进程按设计弹出出网批准框
   (`egress-approval-dialog.ts`:`dialog.showMessageBox`,标题「允许联网?」,正文「允许这个应用连接 nx-rc0125-probe.invalid:443 吗?」,按钮「拒绝 / 允许」,勾选框「以后不再询问这个地址」)。
   45 秒后 `egress.grant … decision:"refused"`(02:01:36,超时)。02:03 我用 hide-app 核隐藏状态时它得**重新隐藏一次**(`hide-calls=1`),说明窗口在这段时间里被这个框取消了隐藏;我没有看到屏幕,框是否显示、显示多久只能从这两处推断。
   处置:立刻停止后续所有格;A 重启为 a8(超时不收回那一问,重启才能确保框不再挂着),仍是登录态、隐藏,后台 hide-app 每 50 ms 复隐藏 2 小时。以后:任何会让引擎连新地址的格(出网批准、装第三方连接器)都会弹这个原生框,只能在 owner 在场时做。
6. 截图注意:隐藏窗口里渲染进程一旦重载(装 / 开连接器、保存自带 Key 都会「sidecar respawned + renderer reloaded」),截图永远拿不到帧;DOM 读取有时也落后于屏幕。本轮判据都落在截图或引擎库上,遇到重载就重启实例(a5→a6→a7→a8,登录态每次都在)。
7. 付费:用户消息 39 条(A 36 条、B 的 0.1.26 对照 3 条),全部 `codepuppy/deepseek-v4-flash`,另有 1 次云识图(看图那一格)和 /review 子会话、标题生成等自动调用;上限 50 没有到。根 E 的两次假 key 发送与根 D 的发送不计费(401 / 未发出)。

### 第六轮格子

| 格 | 结果 | 证据 |
| --- | --- | --- |
| a 启动 / ext / 围栏 / 就绪 / 0.2.0 / 事件流 | PASS | [r6-launch-a5](results/r6-launch-a5.txt)、r6-raw「a5 start-up」;回复正常流式渲染 |
| G2 拒绝(未开定制中心 / 已开) | PASS / PASS | [r6-f-after-deny1-tool](screens/r6-f-after-deny1-tool.png)、[r6-f-deny2-after-hub](screens/r6-f-deny2-after-hub.png);引擎 +51 / +49 ms |
| f 允许一次(未开 / 已开) | PASS / PASS | 文件写入;[r6-f-once2-after-hub](screens/r6-f-once2-after-hub.png) |
| f 本次会话内允许(未开 / 已开) | PASS / PASS | 第二个文件不再问;[r6-f-session-allow-after-hub](screens/r6-f-session-allow-after-hub.png) |
| f 超时卡 | PASS | [r6-f-timeout-detail](screens/r6-f-timeout-detail.png);引擎 +300.0 s fail-closed,无文件 |
| 审批等待中:停止 | PASS(卡片残留同 0.1.26) | [r6-p1-stop-during-approval](screens/r6-p1-stop-during-approval.png)、[r6-p1-stale-card-deny](screens/r6-p1-stale-card-deny.png) |
| 审批等待中:回答提问卡 | PASS | [r6-p3-question-answered](screens/r6-p3-question-answered.png);回复「B」 |
| 审批等待中:追加消息 | **FAIL** | 见结论 3 |
| G2 第二入口:对话内装连接器 | PASS | [r6-g4-install-result](screens/r6-g4-install-result.png);hub_install +0.6 s 完成 |
| G3 工具策略 | PASS | 停用 `websearch` 与云 `web_search`:工具表与 Code Mode 目录都没有;强行 `tools.codepuppy.web_search` ⇒「Unknown tool」;已恢复默认 |
| G4 第一方 MCP | PASS(客户端侧) | `codepuppy-word.write_docx` + `read_docx` completed;云 MCP 一半第五轮 PASS ⇒ G4 PASS(服务端计数没读) |
| R17 | **FAIL** | 见结论 3 |
| N06 (a)(b) / (c) | PASS / NOT-RUN | 档位菜单三档说明 + 共同一句([r6-n06a-perm-menu](screens/r6-n06a-perm-menu.png));会话内允许卡文字;(c) 要第三方连接器(装它要出网批准框,见结论 5) |
| N07、N19、R18 外部连接器一半 | NOT-RUN | 同上;N07(c)–(e) 还要第二个账号 / 登出 |
| 侧栏:全新数据「暂无项目」、无搜索框 | PASS | [r6-e1-fresh-home](screens/r6-e1-fresh-home.png);引擎库里有 engine-scratch-cwd 行,界面不列 |
| 侧栏:打开真实临时目录只列一次 | NOT-RUN | 「打开项目」走原生选目录面板,会出现在 owner 屏幕上 |
| 侧栏:A(已用过的数据)两个内部行 | PASS | engine-scratch-cwd 不再列;code-puppy 有对话所以在(D 根同样只剩一个 code-puppy,[r6-d020-home](screens/r6-d020-home.png)) |
| 侧栏:新对话首条消息后出现默认工作区组 | PASS | 根 E,[r6-e2-fake-key-live](screens/r6-e2-fake-key-live.png) |
| 失败回合:假 key 首页发送 / 侧栏打开 | PASS / PASS | 卡片「登录或 Key 无效 / 重新登录 / 去设置 / 开发者详情」,同 0.1.26;[r6-e2-fake-key-opened-from-sidebar](screens/r6-e2-fake-key-opened-from-sidebar.png) |
| 失败回合:旧对话模型不可用 | PASS | 根 D 会话 3:不发出,提示「当前模型不可用 / 请在模型选择器中改选当前可用的模型。」 |
| 失败回合:未登录发平台模型 | NOT-RUN | 未登录时选平台模型就会调 `auth.start()` 打开浏览器登录 |
| 审计 A(档位切回) | PASS | 只读拒写 → 全部批准直接写 → 请求审批出卡 → 全部批准不出卡;引擎 agent 依次 readonly / build / ask / build;`/review` 子会话跑完;「继续」由 build 回答 |
| 审计 B(长对话编辑重发) | PASS | 22 条消息、引擎 37 行;只编辑不发:全部保留 + 「已回退到检查点 / 发送后将丢弃此后 7 条消息」;重发后 1 秒内旧 7 问 7 答消失,与引擎一致,重开相同 |
| 审计 C 终端打开 / 运行 | PASS | [r6-c-terminal-cmd](screens/r6-c-terminal-cmd.png)(原生文件解包后可用) |
| 审计 C 改尺寸 / 关了再开 | 观察(同 0.1.26) | 见结论 4 |
| 审计 C 外部建文件 ⇒ 文件面板刷新;`@` 搜到 | PASS / PASS | 0.5 秒出现在「文件」;`@outside-app` 列出 |
| N01 附件(md / docx / 图片) | **FAIL**(docx 标签) | 见结论 3;xlsx / pptx / pdf 没做(要先开对应连接器,会触发重载) |
| N09(a) Word 一半、N15 Word 一半 | PASS | Word 进程是随包 `office-runtime/bin/python3 … office-mcp/server.py word`,不是 uv |
| N10 选择器图标 | PASS(部分) | 6 个平台模型 + 5 个自带 Key 供应商每行都有图标([r6-n10-picker](screens/r6-n10-picker.png));暂停引擎 10/30 秒一半没做 |
| N11(a) | 中止 | 触发了原生出网批准框(结论 5);工具记录 `Unable to fetch https://nx-rc0125-probe.invalid/`,出网 `deny`(超时 refused),文案判据无法判定 |
| G6 续写旧对话 | NOT-RUN(部分) | 根 D 旧对话在候选包上可见、可打开(带「运行 1 次」);续写要可用模型:根 D 未登录,owner 的 Key 或登录才行 |

**第六轮之后仍是 NOT-RUN、按派发书属 owner 的:** G5、R22、W02 自带 Key 一半、W09(b)(owner 自己的模型 Key);R19 `~/Documents` 授权框、W01(系统框);真实钥匙串;签名 / 公证包(Gatekeeper);R08 / R09 自动更新回放。
**本轮新确认需要 owner 在场的(会弹原生框或打开浏览器):** 出网批准(N11(a)、N17,以及装任何第三方连接器 ⇒ N06(c)、N07、N19、R18 外部一半)、「打开项目」原生选目录、未登录选平台模型(浏览器登录)、G6 续写(根 D 上登录)。
**本轮没做到、可在不打扰 owner 的前提下继续的:** N01 的 xlsx / pptx / pdf(先开连接器,重启实例取证)、N09(b)(c)、N16、N10 暂停引擎、N12(b)–(d)、R10–R12、R13–R15 生图、R19 / R20 回执、W03、W07 / W08 / W23–W25 云任务、W10 / W11、W22。

### 第六轮收尾时的状态

- A:在运行(a8,pid 见 `logs/a8.pid`),**登录态**(`data-auth="in"`、「按量付费」),隐藏,后台 hide-app 复隐藏 2 小时;装着 Word(已开)、PDF(已装未开)连接器;旧 2.x 副本在 `<A>/app-old-a4/`。
- B、D、E:没有实例在运行(各自停止脚本的事后检查:偏好域只变已知时间戳、owner 侧路径与 owner 应用进程都没变、LaunchServices 登记 0 条)。owner 应用全程没有运行;看门狗没有触发;没有打开过登录页(各次 main.log 里 `opening authorize url` 都是 0)。
- 计数(本轮按上表逐项,41 项):PASS 28 / FAIL 3 / NOT-RUN 或中止 8;另有 2 项与 0.1.26 相同的观察(审批中停止后卡片残留;终端改尺寸 / 关了再开)。核对:Claude Opus 5.5。

## 第五轮(2026-11-12 22:06– EST,新会话)

被测形态同第三、四轮(2.x = 编排器给的包、ad-hoc 重签;1.x = 下载的正式 0.1.26)。演练与 G10 在新的隔离根 `D`(闸 [r5-gate-D](results/r5-gate-D.txt) 五步全过)。
看门狗诱饵证明**没有重跑**(实例 A 在运行,第四轮教训);`watchdog.sh` 自第二、四轮两次证明以来未改(sha256 `0abd0238…`),`D/.watchdog-ok` 写明沿用。
原始证据汇总:[results/r5-drill-raw.txt](results/r5-drill-raw.txt)。

### 第五轮结论

1. **G10 PASS。** 2.x 首次在「干净关闭的 WAL 库(无 `-wal`/`-shm`,`-readonly` 直开 exit 14)」上启动:`db-safety: engine will migrate forward (21 pending) — pre-migration backup`、
   `pre-migration backup ok → <D 的临时 userData>/codepuppy-db-backups/opencode-backup-20261112-222411.db`;备份 `integrity_check` = ok,`.dump` 与启动前的库逐字相同。
   反向一臂用的是自然存在的旧读法:同一形态的库交给 0.1.26(它就是 `-readonly` 直开),日志 `db-safety: skip — 水位读取失败,fail-open:exit=14`,不做备份。
2. **§6.2 第 3 步 FAIL:撤回到 1.x 时「库超前」阻断不会出现。** 2.x 正常退出后库同样是干净关闭的 WAL 形态;1.x(0.1.26)启动日志
   `db-safety: skip — 水位读取失败,fail-open:exit=14 Error: in prepare, unable to open database file (14)`,没有阻断框,直接用 61 条迁移的库起引擎。
   - 0.1.26 能代表 `revert -m 1` 的构建:`db-safety.ts`、`db-safety-boot.ts`、`recovery-adapter.ts` 在 `v0.1.26` 与合并提交 `a7d71dd5a9` 的第一父 `9ca7514ca7` 之间**逐字相同**(`git diff --stat` 为空);v1 引擎目录差 13 个文件。
   - 方案 §6.1 第 4 条以「1.x 报库超前并阻断」为用户发现撤回需要恢复的入口;这个入口在撤回构建上不存在(R18 修的是 2.x 一侧的读法,撤回会把它一起撤掉)。
   - 不恢复时 1.x 看到的:三条旧对话都在(v1 `message`/`part` 逐字未变),但被归到 2.x 新建的 `engine-scratch-cwd` 项目下,侧栏多出两个项目(两个 `code-puppy`、一个 `engine-scratch-cwd`);2.x 新建的对话看不到。截图 [r5-drill3-126-on-advanced-db-expanded](screens/r5-drill3-126-on-advanced-db-expanded.png)。
3. **§6.1 第 4 条的手工恢复照做后,数据与第 1 步一致。** 见下面演练表;恢复后 1.x 日志 `db-safety: watermark equal — proceed`,侧栏一个 `code-puppy` 项目下三条旧对话,会话 3 内容与第 1 步截图相同。
4. **新 FAIL:2.x 上失败的回合在界面上不显示原因。** 同一份数据、同一把假 DeepSeek Key(`sk-l7drill-…`,不是真 key):
   - 0.1.26:发出后进入新会话,卡片「登录或 Key 无效 / 重新登录 / 去设置 / 开发者详情」。截图 [r5-cmp-126-fake-key-turn](screens/r5-cmp-126-fake-key-turn.png)。
   - 2.x:首页发出后停在空白新对话页;从侧栏打开该会话,只有用户气泡,没有回复、没有任何错误。引擎记录 `assistant finish:error`、`error.type: provider.auth`、`status 401`、
     「Authentication Fails, Your api key: ****-key is invalid」,`idle outcome: failed`。截图 [r5-drill2-2x-new-conversation-opened](screens/r5-drill2-2x-new-conversation-opened.png)。
   - 另一例同形:旧对话里模型已不可用时继续发送,2.x 显示用户气泡,无回复无提示;引擎 `provider.no-route`「Model unavailable: stub/stub-model」。
5. **登录框事件(给编排器与 owner 的说明)。** 本轮 D 根的窗口三次打开了 owner 浏览器里的 `codepuppy.cn/auth/authorize`:22:12:21(0.1.26)、22:26:26(2.x)、22:32:36(0.1.26)。
   三次的回调都被系统交给了**正在运行的实例 A**,A 记 `state mismatch — possible CSRF, ignoring` 拒收 —— 所以从测试窗口登录永远不会成功,窗口一直停在未登录。
   22:12 与 22:32 两次我没有点任何东西(只读 DOM / 关引导卡);22:26 那次我正在操作该窗口的模型选择器,排除不了是我点到。A 一直保持登录。
   第四轮 B 根的 0.1.26 在 21:57:04 也走过同一流程并 `login complete`(第四轮 README 没记)。owner 22:3x 原话(经编排器转述):「你为什么一直让我登录啊…每次重启都停在那里,没有登录状态。」
   处置:窗口一律隐藏 —— Electron 的调试口没有 `Browser.setWindowBounds`,改用 [tools/hide-app.m](tools/hide-app.m)(`NSRunningApplication.hide()`,不需要辅助功能 / Apple 事件授权,不会弹框),
   `launch-a.sh` 在拿到进程号后立即隐藏并持续 90 秒,启动闸输出隐藏状态;A 已隐藏,`document.visibilityState: hidden`,仍是登录态。
6. 付费:演练与 G10 0 次(播种用本机桩,失败回合用假 key);A 上 6 次,累计 18 / 30。没有出现系统框;看门狗没有触发;owner 应用始终没有运行。

计数(90 格):PASS 20 / FAIL 3 / NOT-RUN 67。新增 PASS:G7、G8、G10、演练 0 / 1 / 2 / 4、R16、W06、W21、W27、N00、N14;新增 FAIL:演练第 3 步。另有一条矩阵外的 FAIL(结论 4,失败回合不显示原因)。

### 第五轮:实例 A 上的格子(已登录,窗口隐藏,`codepuppy/deepseek-v4-flash`,本轮付费 6 次,累计 18 / 30)

| 格 | 结果 | 证据 |
| --- | --- | --- |
| G4 云 MCP 一半 | PASS(客户端侧) | 会话 `ses_e2cfee8c…`:`codepuppy_access` → Code Mode `execute` 运行 `tools.codepuppy.web_search({query:"OpenCode GitHub"})`,返回 `provider: tavily` 的结果;回复「OpenCode \| The open source AI coding agent」。出网代理记 `alpha-cloud.tidelabs.click:443 allow`。服务端计数没读(没有平台账本权限) |
| G4 第一方 MCP 一半 | 被 G2 同类缺陷挡住 | 全新数据里 Word 连接器未装;助手调 `codepuppy_hub_install`,对话内弹「安装「Word 文档读写」?」→ 我点「确认安装」→「允许此扩展执行哪些操作 … 授权并安装」→ 点了。主进程 22:47:22 `installed mcp codepuppy-word`,引擎 generation 1 等这个忙会话 157 秒后重载;**但工具一直「等待你的决定」,300 秒后报「审批请求等待 300 秒无人应答 … 本次操作没有被放行 … permission=codepuppy_hub_install」**—— 界面说没放行,连接器却已装上。与 G2 同一形态(回答送不到引擎),入口不同。截图 [安装框](screens/r5-g4-install-word-dialog.png)、[卡住](screens/r5-g4-office-after-install.png)。按规矩在第一个失败步停下,没有再试 |
| G8 围栏 | PASS(正向) | 「全部批准」下让 `shell` 执行 `echo l7 > /private/var/tmp/l7-g8-outside.txt; … echo l7 > l7-g8-inside.txt`:输出 `zsh:1: operation not permitted: /private/var/tmp/l7-g8-outside.txt`、`outside_rc=1`、`inside_rc=0`;外面没有文件,工作区里有。选 `/private/var/tmp` 是因为围栏的可写集合含 `/private/tmp`(`process-fence-profile.ts:166`,W11),而测试 HOME 本身在 `/private/tmp` 下。出网:G4 那一轮期间每 0.5 秒采样引擎进程的 TCP,162 个样本全部是到 `127.0.0.1:60925`(主进程里的出网策略代理,启动日志 `network egress policy proxy listening on 127.0.0.1:60925`),非回环 0 个。反向一臂要改代码,没做 |
| R16 只读档写文件 | PASS | 切「只读」后发「@general 在当前文件夹新建文件 rc-test.txt,内容写 hello」:回复「做不到：当前会话处于只读模式，我不能写文件,也不能执行 shell 命令」;A 下任何位置都没有 `rc-test.txt`。[截图](screens/r5-r16-readonly-refusal.png) |
| R18 只读档用云工具 | NOT-RUN(部分) | 云工具一半 PASS:只读档发「用云端 web_search 搜 opencode」,执行前出卡「允许这次操作吗? 使用工具 codepuppy_access · Code Puppy 内置 · 这个工具每次都要确认 · 拒绝 / 允许一次」,工具停在 running 未执行。[截图](screens/r5-r18-readonly-cloud-card.png)。外部连接器一半没做:A 没有已启用的第三方连接器,装一个要经对话框(被 G2 挡住)。另:第一次发送前新对话把权限档重置回「全部批准」,那一轮(回合 17)作废,记在这里 |
| N14 续期不重启引擎 | PASS | `tokens refreshed … apply: 'applied'` 22:04、22:14、22:24、22:34 四次;引擎 utility 进程 44282 自 a4 启动以来没变;没有 `recovering`。续期时恰有流式回答这一半没采到 |
| N12 会话搜索 | NOT-RUN(部分) | (a) 的一部分:侧栏「搜索」→「按标题搜索…」,输入「好」得两条(`好`、`单字回复“好”`),乱码得「没有匹配的对话」。(b)–(d) 没做 |
| W06 各页无旧名(冒烟) | PASS(范围见右) | 新对话页、定制中心连接器 / 技能 / 助手 / 技能·系统、自动化,页面文字里 `alpha` 0 处。设置各页签、关于窗口、菜单栏没扫 |
| W21 旧取值(冒烟,静态) | PASS | 2.x 包 `app.asar:/out` 与资源目录里 AC6 旧值只有 `alpha-connection` 1 处,是改名迁移表里的旧名(`connections: "alpha-connections"`),0.1.26 同一 chunk 逐字相同;新值都在 |
| W27 产物命名(静态) | PASS | 资源目录 `codepuppy-ext`、`codepuppy-fence`,无 `alpha-*`;出厂技能含 `customize-codepuppy` |
| N00 被测构建 | PASS | 0.1.26 / `com.tide.codepuppy` / `app.asar` sha256 `8719eb3b…`(同第二轮) |
| G7 生态隔离(根 D,未登录) | PASS(正向) | 临时 HOME 放了 `~/.claude/skills/probe`、`~/.agents/skills/probe-global`、工作区 `code-puppy/.agents/skills/probe-project`;引擎日志里扫描的技能路径只有出厂技能、`codepuppy-state/env/prod/skills`、XDG config,三个探针目录 0 次;输入框 `/` 菜单 15 项,没有探针;定制中心技能页没有。[截图](screens/r5-g7-slash-menu-2x.png)。反向一臂要改代码,没做 |

R18 那张卡没有回答,23:00 按 300 秒超时 fail-closed 结束(`codepuppy_access` `error: aborted`,`executed: false`)。

### 第五轮后的 §5.1

| 闸 | 结果 |
| --- | --- |
| G1 | PASS(第三轮) |
| G2 | **FAIL**(第三轮);本轮又见同一形态的第二个入口:对话内安装连接器的确认框(见 G4 第一方) |
| G3 | NOT-RUN(被 G2 挡住:强行调用被拒要回审批) |
| G4 | NOT-RUN:云 MCP 一半 PASS(客户端侧),第一方一半被 G2 同类缺陷挡住 |
| G5 | NOT-RUN(需要 owner 自己的 DeepSeek Key) |
| G6 | NOT-RUN(部分):合成 0.1.26 数据上旧对话可见、可打开(演练第 2 步);续写要可用模型,根 D 没有(未登录;本机桩被两版都拒绝)。A 上没有换代前的旧对话,不适用 |
| G7 | PASS(正向) |
| G8 | PASS(正向) |
| G9 | PASS(正向,第三轮) |
| G10 | PASS |

**被 G2 挡住的格:** f(本次会话内允许、超时卡)、G3、R17(拒绝)、N06、N07、N19(要回答审批卡)、G4 第一方一半、R18 外部连接器一半(要先经对话框装连接器)。
**要 owner 自己的模型 Key:** G5、R22、W02 的自带 Key 一半、W09(b)。
**要 owner 本人或真实发版:** R19 新增格(`~/Documents` 系统授权框,需真库形态)、W01(钥匙串框)、W05(网站重登)、R08 / R09(签名发版包的更新回放)、Office 图形界面各格。
**g(首次健康探测失败):** NOT-RUN —— 要在启动瞬间让引擎端口探测失败,没有不改代码的便宜办法。

### 第五轮收尾时 A 的状态

在运行(pid 43754,a4,运行约 57 分钟),**登录态**(账户区「账户 · 按量付费」、无「点此登录」;续期每 10 分钟一次都 `applied`),窗口**隐藏**(`visibilityState: hidden`,
后台 `hide-app 43754 5400` 持续隐藏到约 00:23 或 A 退出),看门狗未触发。A 上本轮装上了 Word 连接器(引擎 generation 1);最后一个对话停在「只读」档。
根 D 没有实例在运行;本机桩已停。owner 应用全程没有运行。

### §6.2 撤回演练(合成 0.1.26 数据,根 D)

| 步 | 结果 | 观察 |
| --- | --- | --- |
| 0 独立 userData 生效 | PASS | 备份落在 `<D>/home/Library/Application Support/ai.opencode.desktop/codepuppy-db-backups/`;单实例锁在同一临时 userData(各次启动闸) |
| 播种 | 完成 | 0.1.26 应用先建库(40 条迁移,含 alpha 的两条与两张权限表);再用**出货的 0.1.26 引擎** chunk 在 Node 24 下无头起服务(0.1.26 关了 RunAsNode fuse,包内二进制不能当 node 用,[tools/fuses.py](tools/fuses.py)),配本机桩模型,3 个会话 × 2 轮,会话 3 第 1 轮调一次 `bash`([tools/v126-engine-serve.mjs](tools/v126-engine-serve.mjs))。结果 3 / 13 / 27,`bash` 工具 completed,`event` 102 行 |
| 1 1.x 看到的 | PASS(记录) | 0.1.26:`code-puppy` 项目下 3 条对话,最新「l7 drill synthetic session 3」(第 1 轮「运行 1 次」+ 桩回复,第 2 轮桩回复)。[截图](screens/r5-drill1-126-session3.png)。退出后库为干净 WAL、无 `-wal`/`-shm` |
| 2 2.x:先备份 | PASS | 见结论 1(G10) |
| 2 2.x:迁移与转换 | PASS | `migration` 40 → 61;`session_v2` 3;`session_message` 14(13 + 会话 3 的一条改名提示);v1 `session/message/part` 3/13/27 不变且逐字相同;`event` 102 → 0(§1.4 写明会删);alpha 两条迁移记录与两张权限表保留 |
| 2 2.x:旧对话可见、可打开 | PASS | 侧栏 3 条;会话 3 打开内容与 1.x 相同,`bash` 卡显示「运行 1 次」。[截图](screens/r5-drill2-2x-session3.png) |
| 2 2.x:能否继续旧对话 | NOT-RUN(部分) | 发送被接受、消息写进旧对话;但这个根没有可用模型(未登录,桩是本机地址,0.1.26/2.x 都拒绝本机端点),所以没有回复 —— 且界面不提示原因(结论 4)。真正的续写需要登录或 owner 的 Key |
| 3 1.x「库超前」阻断 | **FAIL** | 见结论 2 |
| 3 手工恢复(§6.1 第 4 条 ①–⑤) | PASS | ① 退出;② `opencode.db` → `opencode.db.corrupt-20261112-223210`;③ 没有 `-wal`/`-shm`;④ 最新备份拷成 `.restore-tmp` 再改名;⑤ 启 1.x |
| 3 恢复后与第 1 步一致 | PASS | 40 / 3 / 13 / 27 / `event` 102,没有 `session_v2`;界面 3 条对话、会话 3 内容相同。[截图](screens/r5-drill3-126-restored-session3.png) |
| 3 丢失的恰是 §6 所说 | PASS | 丢:2.x 上新建的对话(`ses_e2d0df6d…`)与 2.x 上追加到旧对话里的消息。另有两项 §6 没写、恢复后仍在:2.x 里加的自带 Key 供应商(存在 userData,恢复后 1.x 的输入框直接是 `deepseek-flash`);不恢复时 1.x 侧栏会多出 2.x 建的项目 |
| 4 证据落盘 | 本文件 + results/r5-* + screens/r5-* | 第 3 步用 0.1.26 代替撤回构建(理由见结论 2),没有建临时分支、没有构建 |

## 第四轮(2026-11-12 21:55–22:05 EST)

被测形态同第三轮(ad-hoc 重签、无 hardened runtime 的副本)。0.1.26 用的是下载的正式发布包(Developer ID 签名、公证),放在第二个隔离根 B 里,与已登录的实例 A 分开;同一套闸。

### 第四轮结论

1. **新 FAIL:全新数据目录里,2.x 的侧栏「项目」把引擎内部临时目录 `engine-scratch-cwd` 列成了用户项目;0.1.26 不会。**
   - 0.1.26(隔离根 B,全新数据):侧栏「项目 / 暂无项目 / 打开项目」—— 一个项目都没有。截图 [screens/r4-b126-home.png](screens/r4-b126-home.png)。
   - 2.x(隔离根 A,第一次在空数据上启动):侧栏列出 `engine-scratch-cwd` 与 `code-puppy`,用户没有做任何操作。截图 [screens/r3-a3-home.png](screens/r3-a3-home.png)。
   - 引擎库里的来源(只读):`project` 表有一行 worktree = `<userData>/engine-scratch-cwd`,创建于 21:21:19(第二轮 `a2` 那 5 秒内,启动即建)。证据 [results/r4-a-project-rows.txt](results/r4-a-project-rows.txt)。
2. **欢迎卡片上的「α」不是回归:** 0.1.26 同一位置也是「α」(元素 `div.a-ob-mark`)。只与 W06「各页无旧名」有关,两个版本相同。
3. **我的失误:根 B 的看门狗证明误杀了已登录的实例 A。** 21:56:21 我在根 B 上跑看门狗证明,诱饵进程名叫 `SecurityAgent`;
   A 的看门狗按进程名盯全系统,看到这个新进程就照规矩 `SIGKILL` 了 A 的整个进程组(A 的看门狗日志:`ps: … <root>/B/watchdog-proof-good/decoy/SecurityAgent … target group gone`)。
   A 的登录凭据文件还在 A 的临时 userData 里;是否能不重新登录就恢复,见下面「A 的处置」。以后的规矩:有实例在运行时,不再跑带诱饵的看门狗证明(或者诱饵换成只有被测看门狗才认的名字)。
4. **我在调试口上哪些动作会占引擎那个源的连接(给 G2 那条 lane 区分负载):** 只有我在页面里用 `Runtime.evaluate` 发的 `fetch()`,
   目标是 `http://127.0.0.1:<引擎端口>/…`,它们和产品自己的请求共用页面的同源连接池(6 条)。第三轮里:`/api/model`、`/api/session`、
   `/api/session/<id>/message` 都正常返回;一直挂着的是 21:43:10 之后的三个路径探测 `/api/permission`、`/api/permission/pending`(重载后才收到 404)、
   `/permission`(始终没回),以及之后排在它们后面的 `/api/session` 查询。DOM 读取、`click()`、`Input.insertText` / 键盘事件、截图都不碰引擎源;
   调试口自己的 WebSocket 连的是 `127.0.0.1:9222`(另一个源,浏览器层)。从第四轮起不再在页面里 `fetch` 引擎,引擎侧事实改用 `sqlite3` 只读读实例自己的库。
5. **A 的处置:** 事后检查([r4-stop-a3-after-watchdog-kill](results/r4-stop-a3-after-watchdog-kill.txt))偏好域、owner 侧路径、owner 应用进程都没变,登记已清;
   随后同一个根重新启动 A(`a4`,[r4-launch-a4](results/r4-launch-a4.txt)),界面直接是已登录状态(「账户 · 按量付费」,没有登录提示),**不需要 owner 重新登录**。A 现在在运行。
6. **e 网页搜索 PASS:** 新对话里问 OpenCode 的 GitHub 地址,时间线显示「搜索 4 次 · 21 秒」,回复 `https://github.com/anomalyco/opencode … — 工具:websearch`。
7. 付费调用累计 12 次(本轮 1 次,`codepuppy/deepseek-v4-flash`);没有出现系统框。

计数(90 格):PASS 7 / FAIL 2 / NOT-RUN 81。

### 第四轮格子

| 格 | 结果 | 证据 |
| --- | --- | --- |
| W28 / N12 一类「会话 / 项目列表」—— 全新数据的侧栏项目 | **FAIL** | 见结论 1;0.1.26:「暂无项目」;2.x:`engine-scratch-cwd`、`code-puppy` |
| W06 欢迎卡片图标(对照) | 观察,两版相同 | 0.1.26 与 2.x 都是「α」 |
| G10、§6.2 各步、G7、G8、g、未登录界面各格 | NOT-RUN | 本会话没做到(见交回说明);根 B 已过闸、里面有 0.1.26 副本,可直接用 |
| e 网页搜索 | PASS | 见结论 6 |
| G4、G6、§5.2 发消息各格 | NOT-RUN | 本会话没做到 |
| f 的「本次会话内允许」与超时卡、G3(要回审批时) | NOT-RUN(被 G2 挡住) | 下一版构建上重跑 |

### 隔离与收尾

- 根 B:闸 [r4-gate-B](results/r4-gate-B.txt) 五步全过;启动闸 [r4-launch-b126](results/r4-launch-b126.txt)(0 处泄漏、锁在临时 userData、偏好域只有那个时间戳变);
  停止后检查 [r4-stop-b126](results/r4-stop-b126.txt):偏好域、owner 侧路径、owner 应用进程都没变,LaunchServices 里根 B 的登记 0 条。
- `tools/launch-a.sh` 加了 `--cdp-port`:第二个实例不设 `CODEPUPPY_CDP=1`(它把端口写死成 9222),改传 Chromium 的 `--remote-debugging-port`。
- A 被杀之后:[r4-stop-a3-after-watchdog-kill](results/r4-stop-a3-after-watchdog-kill.txt)(停止脚本的事后检查与登记清理)。

## 第三轮(2026-11-12 21:32–21:55 EST)

**被测形态:编排器提供的未签名包的副本,在临时根里做了 ad-hoc 重签,没有 hardened runtime、没有 Developer ID、没有公证。**
依赖真实签名 / 公证或 `app-update.yml` 的格子(R08、R09、Gatekeeper)记 NOT-RUN(需要真正的发版构建)。

输入变化:owner 选「办法1」—— 同一 bundle id 的偏好域允许 macOS 的例行写入;启动闸改成比键名、值类型、文件大小,
再逐键列出变没变(只列键名)。owner 在 21:33:46 自己点了测试窗口里的「登录」并完成登录(不是我点的),编排器随后确认把登录视为完成、
继续做登录后的格子。

### 第三轮结论

1. **G2 FAIL:点「拒绝」没送达引擎。** 审批卡出现,点「拒绝」后卡片停在「正在提交…」、时间线停在「等你批准」;
   引擎侧直到 300 秒超时才结束这次调用,错误原文「审批请求等待 300 秒无人应答,已按 fail-closed 结束:本次操作**没有**被放行」。
   文件没有写入,但那是超时兜底,不是拒绝生效。0.1.26 的对应行为:R17 / R04 —— 点「拒绝」卡片当即消失,回复里具名拒绝,文件夹里没有文件(alpha-work#129 记 PASS)。
2. **G1 PASS**(首页新对话、会话页输入框、中断后的「继续生成」三个入口各三条,都有回复);**b、c、d PASS**;**G9 PASS**(正向一臂);**a PASS**。
3. 偏好域:本轮启动前后只有 `SKPurchaseIntentUpdatesLastChecked` 变了,键集合、类型、大小都没变。
4. 登录回调:owner 的正式版当时没有运行,测试副本在运行;回调经 `open-url` 进了测试副本,`login complete { mode: 'platform' }`(观察到一次)。
5. 付费:用户回合 11 次,全部 `codepuppy/deepseek-v4-flash`(另有引擎自动的标题生成调用)。没有出现任何系统框,看门狗没有触发。
6. 撤回演练、G10、G6、G7 等**这一轮没做到**(见下表),测试实例保持登录、仍在运行。

计数(90 格):PASS 6 / FAIL 1 / NOT-RUN 83。

### 第三轮格子

| 格 | 结果 | 证据 |
| --- | --- | --- |
| a 随包 ext、引擎就绪、围栏 | PASS | 第二轮证据;本轮启动日志同样有 `process fence applied` 与 `server ready`([r3-launch-a3](results/r3-launch-a3.txt)) |
| b 模型链、平台模型、收发 | PASS | 引擎 `/api/model` 返回 6 个 `codepuppy` 平台模型(DeepSeek V4 Flash / Pro、GLM-5.2、GLM-5 Turbo、Qwen3.7 Max / Plus);首页发「用一句话介绍你自己」,会话 `outcome: succeeded`、输出 52 tokens,界面渲染出回复 |
| c 平台请求带用户凭据 | PASS | 出网代理记录 `CONNECT alpha-gateway.tidelabs.click:443`,隧道下行 28644 / 53573 字节;会话成功;占位串 `codepuppy-platform-credential-from-request-header`(`packages/ui-mac/src/main/codepuppy-models.ts:45` 注入的 apiKey 占位)在 `server.log`、`main.log`、`utility.log` 与主进程输出里都是 0 次 |
| d 会话标题 | PASS | 引擎为每个会话生成了标题:「一句话自我介绍提示词(L7 G1 首页 1/3)」「单字回复“好”」「从1数到300」「Creating l7-g2.txt」;另有一个会话标题是「好」(用户消息是「回复一个字:好…」) |
| G1 发送 | PASS | 首页 3 条 = 3 个新会话,都 `succeeded`;会话页 3 条,界面里三条回复都是「好」;中断一次后「继续生成」点 3 次,引擎记录 3 条 `user:继续` + 3 条助手回复,都 `succeeded` |
| G2 审批 | **FAIL** | 卡片原文「允许这次操作吗? 改文件 l7-g2.txt … 本次会话内允许 / 将记住:本会话内的所有文件修改 / 本次会话 · 重启后失效 / 拒绝 / 允许一次」。21:42:33 点「拒绝」;21:42:41 与约 21:43:00 卡片仍是「正在提交…」、时间线「等你批准」。引擎侧:工具 `write` `executed:false`,`error.type: aborted`,完成时刻比开始晚 300.01 秒,错误原文见上。`server.log` 里没有任何 permission 相关行 |
| f 审批卡 / 本次会话内允许 / 超时卡 | NOT-RUN | 卡片出现(见 G2);「本次会话内允许」没做(推断会受同一缺陷影响,未验证);超时只在引擎侧看到(上面的错误原文),界面上的超时卡没核到 |
| G9 凭证不导入 | PASS(正向) | 临时数据目录放了带 anthropic / openai 假 key 的 `auth.json`;模型表只有 6 个 `codepuppy` 模型;启动日志 `engine data directory … also holds other OpenCode data (auth.json)`。反向一臂没做 |
| e、g、G3–G8、G10、§5.2 各格、§6.2 各步 | NOT-RUN | 这一轮没做到(时间都花在 G2 的取证上);0.1.26 包已下载到临时根、校验和与发布清单一致 |

### G2 的旁证与干扰

- 这次运行的 netlog 里有 975 个 `SOCKET_POOL_STALLED_MAX_SOCKETS_PER_GROUP` 事件,集中在启动后约 14 分钟内([r3-netlog-stalls](results/r3-netlog-stalls.txt));
  这种抓取模式下事件不带分组名,没能归到引擎那个源。推断:可能又是 #1554 那种「同源 6 连接被长连接占满」,也可能是拒绝请求的路由不对;没定。
- 我的干扰,如实记下:G2 之后我从页面里直接发了几次引擎查询,其中有的一直不返回,把页面的连接占住了;21:50 左右我重载了一次界面来释放它们。
  这些查询都在 21:43:10 之后,而拒绝卡住是 21:42:33 就开始的,所以 G2 的结论不受影响。重载之后窗口处于隐藏状态(`visibilityState: hidden`,
  多半是 owner 把它最小化或藏起来了),页面停在 `readyState: interactive`、内容为空,截图也拿不到帧;窗口显示出来后应能正常渲染(未验证)。

### 观察(与 0.1.26 的对照还没做,不判 FAIL)

- 全新数据目录里,侧栏「项目」列出了 `engine-scratch-cwd`。这是引擎的内部临时工作目录,不该显示成用户的项目。
- 登录前的欢迎卡片上是一个「α」图标,而侧栏是新的小狗标志(与 W06「各页无旧名」有关)。截图:[screens/r3-a3-home.png](screens/r3-a3-home.png)。
- 直接从终端执行时,系统把测试应用的隐私授权记在 Terminal 名下(第二轮已记)。

### 隔离与收尾

- 启动闸:[results/r3-launch-a3.txt](results/r3-launch-a3.txt)(lsof 0 处泄漏、单实例锁在临时 userData、偏好域只有那个时间戳变了)。新工具:[tools/prefs-guard.py](tools/prefs-guard.py)、[tools/netlog-stalls.py](tools/netlog-stalls.py);`tools/cdp.mjs` 加了 `send`。
- 本轮没有产生崩溃报告;测试实例仍在运行,所以副本的 LaunchServices 登记还在(深链回调需要它);停止时 `tools/stop-a.sh` 会撤销登记、比对偏好域与 owner 侧路径、清理本次运行的崩溃报告。
- 登录相关日志行(查询串已遮掉):[results/r3-a3-login-and-auth-lines.txt](results/r3-a3-login-and-auth-lines.txt)。

## 第二轮(2026-11-12 21:07–21:35 EST)

输入的变化(编排器回执):构建已在 `71b6e5f9cd`(fix/1662-packaged-build)修好;隔离按 owner 选的方案 A
(owner 原话「我建议 A」)放宽 2(ii):需要引擎的格子不套外层沙箱,其余隔离照旧,另加 SecurityAgent 看门狗。

### 第二轮结论

1. **按硬规矩 1 停止。** 第二次启动(`a2`)时,启动后闸发现 owner 应用的偏好文件 `~/Library/Preferences/com.tide.codepuppy.plist`
   修改时间变了(2026-11-09 03:33:12 → 2026-11-12 21:21:16,正是测试副本向系统登记的那一刻),大小没变(250 → 250 字节)。
   闸当场杀掉整个进程组,前后约 5 秒。之后没有再启动任何实例。
2. **cell a PASS**(证据来自这 5 秒的日志):随包 ext 装载、进程围栏装上、引擎报就绪。
3. 编排器给的包本身启动不了:内核按代码签名把它杀掉(`Electron Framework` 页无效)。测的是在临时根里做了 ad-hoc 重签的副本,`app.asar` 字节不变。
4. 隔离闸(方案 A 形态)、看门狗、启动闸都先在做坏的环境里证明会拒绝,再跑正常臂。
5. 没有出现任何系统框;付费模型调用 0 次;没有登录。

计数(90 个格子):PASS 1(补充格 a)/ FAIL 0 / NOT-RUN 89。

### 被测的包

| 项 | 值 |
| --- | --- |
| 来源 | 编排器提供的 `alpha-code-fix-1662-packaged-build/packages/ui-mac/dist/mac-arm64/Code Puppy.app`(alpha `c01ea14919` + `71b6e5f9cd`,prod 渠道,未签名),`ditto` 到临时根,只测副本 |
| 版本 / bundle id | 0.1.26 / `com.tide.codepuppy` |
| 引擎 chunk | `app.asar:/out/main/chunks/engine-D02rVy8I.js` sha256 `36c3f2e9638941edf216ab7e7a40c1708ae5d5e8fc7e67c1b84a1c1af83aaa64`(与 fix worktree 的 `out/main/chunks/` 同一文件逐字相同) |
| `app.asar` | sha256 `8719eb3b032d4d002b7f5875aecf9d01272a329b457c1fd5f42f4f81c09f7252`(重签前后相同) |
| 原样启动 | **起不来**:`a1` 被内核 SIGKILL —— `CODE SIGNING: process …[Code Puppy]: rejecting invalid page … in file ".../Electron Framework.framework/..."`;崩溃报告 `termination: CODESIGNING / Invalid Page`;`codesign --verify --deep --strict` 报 `code has no resources but signature indicates they must be present`;主程序仍是 Electron 原带的 linker 签名(`Identifier=Electron`)。证据:[results/r2-launch-a1.txt](results/r2-launch-a1.txt)、[results/r2-crash-reports-from-this-run.txt](results/r2-crash-reports-from-this-run.txt) |
| 测试形态 | 副本上 `codesign --force --deep --sign -`(ad-hoc,不用钥匙串)后 `--verify --deep --strict` 通过。与出货形态的差别:没有 Developer ID、没有 hardened runtime、没有公证 |

推断(没有单独验证):`electron-builder.config.ts:208` 未签名时 `identity: null`,electron-builder 整个跳过签名;fuse 改写了 `Electron Framework`
的字节,原 linker 签名随之失效,arm64 内核拒绝执行。runbook §0 写的「否则 ad-hoc(仅本机双击)」与实测不符。这是本机未签名打包这条路径的问题,
不是换代引入的(以前本机包都经 `install:local` 用 Developer ID 重签后才运行)。

### 隔离(方案 A)

工具:[tools/isolation-gate.sh](tools/isolation-gate.sh)(加了第 5 步与 `--persist`)、[tools/watchdog.sh](tools/watchdog.sh)、
[tools/watchdog-proof.sh](tools/watchdog-proof.sh)、[tools/launch-a.sh](tools/launch-a.sh)、[tools/stop-a.sh](tools/stop-a.sh)、[tools/cdp.mjs](tools/cdp.mjs)。

| 闸 | 坏臂(必须拒绝) | 正常臂 |
| --- | --- | --- |
| 钥匙串(gate 1–5) | 不建临时钥匙串 ⇒ 第 3 步拒绝,exit 1([r2-gate-broken-keychain](results/r2-gate-broken-keychain.txt));gate 自己的命令所在沙箱去掉 mach 拒绝 ⇒ 第 2 步拒绝([r2-gate-broken-guard](results/r2-gate-broken-guard.txt)) | 五步全过([r2-gate-A](results/r2-gate-A.txt)):第 5 步在**不套沙箱**、带应用同款环境(HOME + CFFIXED_USER_HOME 改道)时,搜索列表恰好一项、就是临时钥匙串,且只存在于临时钥匙串里的哨兵条目被它找到(只取属性) |
| 看门狗 | 看一个不会出现的进程名 ⇒ 诱饵没被抓,exit 1([r2-watchdog-proof-broken](results/r2-watchdog-proof-broken.txt)) | 诱饵 = 临时编译、名为 `SecurityAgent` 的 3 秒空进程:140 ms 内杀掉目标进程组并记下诱饵([r2-watchdog-proof-good](results/r2-watchdog-proof-good.txt))。真 SecurityAgent 出现时的反应时间没测过(要真触发一个框);看的进程名是 `SecurityAgent`、`UserNotificationCenter`、`coreautha`,只认启动后新出现的进程号 |
| 启动闸(启动前) | 去掉 `--use-mock-keychain`、根上没有通过的闸、包不在根里 ⇒ 三条都拒绝,没有启动([r2-launch-broken-arms](results/r2-launch-broken-arms.txt)) | — |
| 启动闸(启动后) | — | 见 `a2`:进程组 5 个进程、162 个打开路径、59 个在临时根下、owner 路径 0 个;单实例锁在临时 userData;**owner 侧路径的元数据比对变红** |

「关交互」的实际含义:Chromium 加 `--use-mock-keychain`(不碰钥匙串,启动后核对正在运行的主进程带着这个参数);临时钥匙串已解锁、
不自动上锁,没有可弹的解锁框。macOS 没有能从外部替另一个进程关掉钥匙串交互的开关,产品代码也不调用这类开关;这一条只到这里。

### 单实例与身份(硬规矩 3)

- 直接执行包里的二进制(不走 `open`),环境从零构造。owner 的应用当时没有运行,前后都没有。
- 单实例锁:`<临时根>/home/Library/Application Support/ai.opencode.desktop/SingletonLock`,与 owner 的 userData 分开(实测,不是推断)。
- LaunchServices:冷启动时 `codepuppy://` 交给谁,测试前后都是 `/Applications/Code Puppy.app`(只读查询)。副本被系统登记过,已用 `lsregister -u` 撤销(副本与其 Helper 两条)。
- 观察:直接从终端执行时,系统把测试应用的 TCC「责任进程」记为 Terminal(`AUTHREQ_ATTRIBUTION … responsible … com.apple.Terminal`)。
  也就是说测试应用沿用 Terminal 已有的隐私授权,真弹授权框时框上写的会是 Terminal。
- **偏好域是共用的(这次停下的原因):** 副本与 owner 的应用同一个 bundle id,系统按 bundle id 管偏好;HOME 与 CFFIXED_USER_HOME 改道管不到它。

### 停下的事件(硬规矩 1)

| 项 | 观察 |
| --- | --- |
| 文件 | `~/Library/Preferences/com.tide.codepuppy.plist`(owner 应用的偏好域) |
| 变化 | 修改时间 2026-11-09 03:33:12 → 2026-11-12 21:21:16;大小 250 → 250 字节 |
| 时刻 | 与系统日志里测试副本 `CHECKIN: … com.tide.codepuppy` 同一秒(21:21:16.696),cfprefsd 在同一毫秒段接受了它的连接 |
| 处置 | 启动后闸判红,`SIGKILL` 整个进程组(约 5 秒内);此后没有再启动 |
| 文件里的键(只读了键名与类型,没读值) | `AppleTextDirection`(bool)、`NSForceRightToLeftWritingDirection`(bool)、`NSNavPanelExpandedSizeForOpenMode`(str)、`NSTreatUnknownArgumentsAsOpen`(str)、`SKPurchaseIntentUpdatesLastChecked`(float) |

推断:改写的是 StoreKit 每次启动都会刷新的时间戳 `SKPurchaseIntentUpdatesLastChecked`(浮点数在二进制 plist 里定长,所以大小不变),
owner 自己的应用每次启动也会写它。证明不了:运行前没有存这个文件的副本,也没有读值。

收尾:撤销了副本的 LaunchServices 登记;删掉了本轮操作在 `~/Library/Logs/DiagnosticReports` 里留下的三份崩溃报告
(`a1` 的签名杀进程一份、第一次诱饵用 `/bin/sleep` 副本被系统拒绝两份;内容摘要已存 [results/r2-crash-reports-from-this-run.txt](results/r2-crash-reports-from-this-run.txt))。
临时根保留(含临时钥匙串、重签后的 2.x 副本、下载的 0.1.26 包),不在 owner 的钥匙串搜索列表里。

继续之前要编排器定的一件事(三选一):

- **1. 接受同 bundle id 的偏好域被系统框架写。** 闸改成比键集合、类型与大小,不比修改时间;每次启动前后对这个文件只做哈希(要读内容)。
  代价最小;写的是 owner 自己每次启动也会写的框架时间戳。需要明确接受,因为它碰的是 owner 应用的偏好域。
- **2. 副本换一个 bundle id**(改副本的 Info.plist 再 ad-hoc 重签):偏好域分开。但应用启动时会调 `setAsDefaultProtocolClient`
  (`packages/ui-mac/src/main/index.ts:952-955`),把 owner 的 `codepuppy://` 默认处理者改成测试的 id,每次运行后都要读回并恢复;
  通知与隐私授权也按 bundle id 算,新 id 首次使用可能弹框(由看门狗兜底)。登录那一刻反而需要这样,深链才会回到测试副本。
- **3. 只在 owner 在场时跑。**

建议 1。登录那一刻另有一个问题:网站登录完成后的 `codepuppy://` 回调按 bundle id 交给系统选的应用,冷启动时系统选的是
`/Applications/Code Puppy.app`(上面只读查过)。登录时 owner 的应用必须是退出状态、测试副本必须在运行;即便这样,回调交给运行中的副本
也只是推断,没有验证(验证它就有拉起 owner 应用的风险)。

### 第二轮格子

| 格 | 结果 | 证据 / 原因 |
| --- | --- | --- |
| 补充格 a:随包 ext 装载、引擎就绪、围栏装上 | **PASS** | [results/r2-a2-log-excerpt.txt](results/r2-a2-log-excerpt.txt):`codepuppy-ext: loading plugin bundle`(路径在包内 `Resources/codepuppy-ext`)、`process fence applied: addon=fence-20261113T020500196Z … profile=2038B`、`main.sidecar.ready_ipc`、`generation … "phase":"ready"`、`server ready`;日志里 ext 装载之后没有错误行。只跑了约 5 秒 |
| 其余 89 格 | NOT-RUN | 被上面的停止挡住。需要登录的格子之后还要 owner 登录;G5 等要 owner 自己的 Key |

附带观察:这个本机包里没有 `app-update.yml`,更新器一启动就进 `error`(`ENOENT … Resources/app-update.yml`)。R08/R09 在这个包上测不了真实的更新回放。

## 第一轮(2026-11-12 20:24–20:43 EST)

### 结论

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

### 构建

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

### 隔离闸(硬规矩 2)

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

### 第二个阻断:隔离沙箱与产品进程围栏不能同时成立

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

### 登录与测试账号

- 打包版忽略 `DEV_PLATFORM_TOKEN`(`packages/ui-mac/src/main/codepuppy-auth.ts:172-179`)。平台凭据只来自登录:未登录时
  `applyAuthEnv` 删掉 `CODEPUPPY_API_KEY`(`codepuppy-auth.ts:352-363`),凭据文件只镜像这个环境变量(`codepuppy-secret-files.ts`)。
  所以长期生产测试 key(`sk-alpha-`)放不进打包版的平台凭据通道。
- 登录是网站上的浏览器授权(`codepuppy-auth.ts:5-7`,`shell.openExternal` 打开的是 owner 的默认浏览器),要收验证码 ⇒ 需要 owner。
  本轮没有点登录,也没有读那把 key。

### 单实例与身份(硬规矩 3)—— NOT-RUN(没有包)

下一轮启动前要核的静态事实:

- userData 由代码定为 `<appData>/ai.opencode.desktop`(`packages/ui-mac/src/main/index.ts:494-497`),在 `requestSingleInstanceLock()`
  (`index.ts:573`)之前设好,所以锁跟着 appData 走;appData 是否随 HOME / CFFIXED_USER_HOME 改道,要在启动后用 lsof 实测,不能假设。
  `--user-data-dir` 不起作用,会被这次 `setPath` 覆盖。
- bundle id 同为 `com.tide.codepuppy`:要直接执行包里的二进制,不走 `open`,免得 LaunchServices 把启动转给 owner 那个实例。
- 调试口写死 9222(`index.ts:568`),启动前确认这个端口没人占。
- 包的版本号 0.1.26 等于最新发布版本,预期不会去下载更新;启动后读更新日志核实。

### §5.1 合并闸

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

### §5.2 行为基线(0.1.26 回归矩阵,alpha-work#129 的格子)

| 格子 | 结果 | 说明 |
| --- | --- | --- |
| 重跑(引擎相关,44 格):N01、N02、N18、N03、N04、N05、N06、N07、N08、N19、N09、N15、N16、N10、N11、N17、N12、R08、R09、R10、R11、R12、R13、R14、R15、R16、R17、R18、R19、R20、R22、R23、W02、W03、W04、W07、W08、W09、W10、W11、W22、W23、W24、W25 | NOT-RUN | 被构建失败挡住;需要引擎的格子还被第二个阻断挡住 |
| 新增格(裁决书 R19):首启转换时 `~/Documents` 下会话的系统授权框 | NOT-RUN | 被构建失败挡住;这是系统级授权框,需要 owner |
| 冒烟(23 格):R04、R05、R06、R07、W01、W12、W13、W05、W20、W21、W06、W14、W15、W16、W17、W18、W19、W26、W27、N00、N13、N14、W28 | NOT-RUN | 被构建失败挡住 |

### 补充格 a–g

| 格 | 结果 | 说明 |
| --- | --- | --- |
| a 随包 ext 装载、引擎报就绪 | NOT-RUN | 被构建失败挡住;还需要引擎 |
| b 模型链就绪、选择器列出平台模型、发一条并收到回复 | NOT-RUN | 被构建失败挡住;还需要引擎与登录 |
| c 平台模型请求带上用户凭据(引擎日志里没有占位串) | NOT-RUN | 同 b |
| d 生成会话标题 | NOT-RUN | 同 b |
| e 网页搜索可用,或失败时给出具名原因 | NOT-RUN | 同 b |
| f 审批卡、「本次会话内允许」、超时卡 | NOT-RUN | 同 b |
| g 首次健康探测失败时界面不卡死 | NOT-RUN | 被构建失败挡住;还需要引擎 |

### §6.2 撤回演练

| 步 | 结果 | 说明 |
| --- | --- | --- |
| 0 独立 userData 生效(备份目录落在临时 userData 下) | NOT-RUN | 被构建失败挡住 |
| 1 合成 v1 库副本,记录 1.x 打包版看到的会话数与最新一条 | NOT-RUN | 被构建失败挡住(没有 2.x 包,演练无从开始);1.x 打包版的引擎同样有围栏,也受第二个阻断限制 |
| 2 2.x 打包版:先确认安全带备份生成,再记迁移、会话数、能否续写 | NOT-RUN | 被构建失败挡住;迁移与续写还需要引擎 |
| 3 模拟合并 → `revert -m 1` → 1.x 包:「库超前」阻断 → 按 §6.1 第 4 条手工恢复 → 会话数一致 | NOT-RUN | 依赖第 2 步 |
| 4 证据落盘 | NOT-RUN | 依赖第 1–3 步 |

### 文件

- [tools/isolation-gate.sh](tools/isolation-gate.sh)、[tools/mach-probe.c](tools/mach-probe.c):隔离闸
- [tools/fence-nest-probe.cjs](tools/fence-nest-probe.cjs):围栏嵌套探针
- `results/`:构建日志(已把 home 路径换成 `~`)、闸三条臂的输出、探针输出、垫片逐行摘录
- 没有截图:本轮没有启动应用
