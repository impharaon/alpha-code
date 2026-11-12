---
id: PLAN-upstream-upgrade-readiness
title: 让 Code Puppy 更容易跟上 OpenCode 升级 实施计划
summary: INT-upstream-upgrade-readiness 先做批(I-02、I-03、I-08、I-09)的分段计划;目前含 I-03 上游行为探针
kind: plan
status: active
spec: ""
design: ""
owners: [alpha-code desktop maintainers]
last_reviewed: 2026-11-12
---

# PLAN-upstream-upgrade-readiness｜让 Code Puppy 更容易跟上 OpenCode 升级 实施计划

由实施会话在计划阶段写,编排器核对后由同一会话实施。每个交付段一节;旧段留作证据。决定只链接、不重述;实施中偏离本段,在同一个提交里改本段。

## I-03 上游行为探针

- 依据:无 spec、无 design。意图 [INT-upstream-upgrade-readiness](https://github.com/impharaon/alpha-work/blob/main/docs/intents/INT-upstream-upgrade-readiness.md) I-03(U-02 批准,alpha-work `3fd5eee`);派发书 `par-i03-probes`(探针 (1)–(10)、放置、接线放最后一个小提交);调查 [`2026-11-12-1662-takeover-candidates.md`](../../architecture/2026-11-12-1662-takeover-candidates.md)。基线树 `engine/1662-opencode2` @ `df748c16e7`。下表 P1–P10 对应派发书 (1)–(10),P11 是按「注释写着依赖上游措辞/顺序」补的一条。
- 核对:`9bf4ed93d9` · 编排器 · 通过(实施轮:两片各一个提交;接线提交暂缓,另两条线合并后再要;托管规则先后若能用隔离根里的托管文件探到,加为 P12,否则说明原因)。

### 做法(本段的本地选择)

- **一个地方**:全部新探针在 `packages/ext/src/upstream-probes/`。理由:ext 的测试预载(`packages/ext/test/preload.ts`)已经把每个 ext 测试进程的 HOME / XDG_* / TMPDIR / OPENCODE_DB 指到临时目录,真引擎可以直接在进程里起,不用另开子进程;ext 依赖 `@opencode/core`;ext 测试 import ui-mac 模块有先例(`context-injection.test.ts`、`project-config.test.ts`)。P9 已有合格探针 `packages/ext/src/policy/permission-reply-premises.test.ts`,不另写、不搬家。
- **跑的是上游真代码**:引擎走 Code Puppy 生产的嵌入路径(`packages/ui-mac/engine/engine-embed.ts` 的 `startEngine` + `src/main/engine-server-options.ts` + `src/main/engine-authorization.ts`),请求经同一个进程内 dispatch 打适配层调用的同一批路由;只有 P2 的结构臂在进程里装真 `SessionModelRequest.layer`。计划阶段已在临时目录实测:ext 预载下引擎约 0.1 s 起来、Location 约 1 s 激活,`Global.Path` 落在隔离目录;`/api/plugin` 按 pre → 包插件 → post 列出;全局 < 显式 < 项目 < 内联的命令层序;远端 MCP 集成 id `mcp_f121e3d3f052243c` 与公式算出的一致。
- **失败时点名依赖方**:每条用例名以 `[<依赖它的 Code Puppy 文件>]` 开头,bun 的 `(fail)` 行就带着那个路径;文件抬头写清前提、依赖方与上游源码位置。
- **已知的坏**:每个文件带控制臂 —— 同一个判定函数喂一份改坏的真实样本(多一种请求、少一个收尾事件、重复的输出页……)必须判红。实施时再对上游源码逐条做一次临时改动(见证明表末列),确认探针红且失败行点名依赖方,随即 `git restore` 该文件;命令与输出写进提交说明。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ext/src/upstream-probes/engine.cases.ts`(新) | 探针共用的真引擎宿主,不是测试入口。起生产嵌入引擎:临时 git 项目、全局配置目录、显式文件、内联文档按参数写。开跑前调 `packages/ui-mac/test-component/engine-sandbox.ts` 的 `assertEngineSandboxed`,根取 ext 预载的测试根;`Global.Path` 不在里面就抛。假模型复用 `packages/ui-mac/test-fixtures/engine-adapter-sampler/mock-model.ts`,前面挡一个本机代理:按关键字回 400。每台引擎再装一个记录插件(目录形式的包插件,`codepuppy.upstream-probe.recorder`),记下插件看到的 `context` / `compaction` / `generate` / `title`(带请求消息)与 `model.request` 调用。另有 `/api/event` SSE 收集器、`get` / `send`,以及带期限的 `until` 轮询。用 `.cases.ts`:不进 bun test 入口,不进 ext typecheck,也不被 ui-mac 写盘点登记簿当生产源码扫(`process-fence-write-sites.ts:110` 只排除 `.test.ts` / `.cases.ts` / `.d.ts`,起名 `.harness.ts` 会被扫成未登记写盘点)。 |
| `packages/ext/src/upstream-probes/turn.test.ts`(新) | 一台引擎、一个项目:P1 回合收尾事件,P6 读目录正文,P7 `data:` 附件,P8 shell 输出游标。 |
| `packages/ext/src/upstream-probes/config.test.ts`(新) | 一台引擎、多个项目目录:P3 配置层序与 policy 先到先得,P5 相对 `skills` 条目,P10 远端 MCP 集成身份,P11 MCP 条目整条替换。 |
| `packages/ext/src/upstream-probes/plugins.test.ts`(新) | P4 插件激活顺序(宿主的记录插件就是那个包插件),P2 请求种类与钩子(进程内结构臂 + 引擎流程臂,用记录插件的钩子序列)。 |
| `packages/ext/src/policy/permission-reply-premises.test.ts` | P9:只在 describe 标题里补上依赖方 `packages/ui-mac/src/engine-adapter/permission-replies.ts`。不加不删用例,登记册 `codepuppy-authority-registry.json:687-703` 与 gate-files 都按路径引用它。 |
| `packages/ui-mac/test-fixtures/engine-adapter-sampler/mock-model.ts` | 只改抬头「不进任何门」那句:ext 上游探针 import 它,改剧本会让探针变红。代码不动。 |
| `scripts/gate-files.tsv`(最后一个提交) | 加三行,见「接线」。 |
| `.github/workflows/sync-upstream.yml`(最后一个提交) | 加一步,见「接线」。 |

### 接线(最后一个提交;两份文件此刻另一条线在改,动手前按当时的内容重读,格式变了就跟新格式)

`.github/workflows/sync-upstream.yml`:插在 `Engine runtime smoke (S39 — boot/probe/kill/reboot)` 一步之后(它已 `bun install`)、`Build sync bundle artifact` 之前:

```yaml
      # INT-upstream-upgrade-readiness I-03:Code Puppy 依赖的上游行为探针,跑在合并后的树上。任一条红 ⇒ 本 job 红、
      # 不出推送包(同引擎冒烟);失败行开头的 [路径] 是依赖那条行为的 Code Puppy 文件。sync-upstream-alert 照常开告警。
      - name: Upstream behaviour probes (I-03)
        run: bash scripts/bun-test-floor.sh 1 packages/ext src/upstream-probes src/policy/permission-reply-premises.test.ts
```

下界写 1,只防「一条没跑也 exit 0」;精确条数只在 gate-files 一处登记。

`scripts/gate-files.tsv`:按当时格式加三行,第 4 列 `-`:

```
<N>	packages/ext	src/upstream-probes/turn.test.ts	-	I-03 上游行为探针:回合收尾事件、读目录正文、data: 附件、shell 输出游标(依赖方 engine-adapter events.ts / v1-shapes.ts、ext attachment-reader-hooks.ts)
<N>	packages/ext	src/upstream-probes/config.test.ts	-	I-03 上游行为探针:配置层序与 policy 先到先得、相对 skills 条目、远端 MCP 集成身份、MCP 条目整条替换(依赖方 engine-explicit-config.ts / codepuppy-config-injection.ts / mcp-default-deny.ts、engine-adapter routes.ts)
<N>	packages/ext	src/upstream-probes/plugins.test.ts	-	I-03 上游行为探针:插件激活顺序 pre → 包 → post、模型请求只经 context / compaction / generate / title 四个钩子(依赖方 ext plugin.ts / policy/index.ts、sidecar-ext-ready.ts)
```

本地闸不改 `codepuppy-check.sh`:探针在 ext 包里,第 [5/14] 步的 ext 整包测试本来就跑它们,第 [6/14] 步再按这三行逐文件判精确条数。

### 顺序

1. **提交 A(第一片)**:`engine.cases.ts`、`turn.test.ts`(P1 P6 P7 P8)、mock-model 抬头,同时填本段「核对」。相关检查:`cd packages/ext && bun test src/upstream-probes/turn.test.ts` 连跑 3 轮(有时序);P1 P6 P7 P8 各做一次上游临时改动,确认变红后 `git restore`。
2. **提交 B(第二片)**:`config.test.ts`(P3 P5 P10 P11)、`plugins.test.ts`(P2 P4)、premises 标题(P9)。相关检查:两个新文件各连跑 3 轮,外加 premises 文件;P2–P5、P9–P11 各做一次上游临时改动。四个文件按名字放进同一个 bun 进程跑(两种顺序),证明探针与 `policy-host.cases.ts` 同进程共存,并量出总耗时。
3. **提交 C(接线)**:上面的 yml 一步与 gate-files 三行。相关检查:三个文件各跑一次 `bash scripts/bun-test-floor.sh =<N> packages/ext src/upstream-probes/<f>.test.ts`,条数等于登记值;解析 workflow 的四个测试 `cd packages/ui-mac && bun test src/main/sync-upstream-merge-order.test.ts src/main/sync-upstream-owned-files.test.ts src/main/sync-upstream-takeover-isolation.test.ts src/main/sync-upstream-alert.test.ts` 仍绿;那条命令在某个上游文件临时改坏时退出非零。不跑 `assert-gate-files.sh` 全量(那等于全量闸,归 ship)。

### 风险

- **同进程共存**:ext 整包在一个 bun 进程里跑,`policy-host.cases.ts` 的 `isolate()` 会改 HOME / XDG,探针也在同一进程起真引擎。两者都落在预载的临时根下;宿主开跑前用 `assertEngineSandboxed` 证明这一点。顺序第 2 步跑一次 ext 整包作证。
- **时序**:shell 每 0.4 s 出一行,技能目录靠监听,SSE 帧异步到达。所有等待都是带期限的 `until`,不拿固定 sleep 当断言;每个文件本机连跑 3 轮(慢路径间歇命中,两轮全绿不算数)。
- **Linux 未实测**:sync 跑在 ubuntu,本机只有 darwin。监听实现与 shell 行为可能不同,探针只断言引擎的响应,不断言路径形状。第一次 sync 前没有 Linux 证据;若是 Linux 特有的假红,它会挡住当天的同步并开告警(看得见,不静默)。合并后建议编排器手动触发一次 `workflow_dispatch` 看结果。
- **Code Puppy 自己的改动也能弄红探针**:引擎走 Code Puppy 的嵌入代码,嵌入层坏了会在 `beforeAll` 起引擎时报错,和 `[依赖方]` 开头的断言失败分得开。
- **并行改同两份文件**:I-09 可能改 gate-files 的格式,另一条线在改 sync workflow。所以接线单独做最后一个提交,动手前重读;探针本身不依赖接线。
- **探针红会挡住每日同步,直到有人处理**:这是有意的,意图写的是「上游一变当天就红」,与引擎冒烟、接管审查同一种处理(不合并、不推送、开告警)。
- **P6 是过渡**:I-05 已同意把读目录卡片改为插件从结构化结果生成(U-03),届时 P6 换成探 `tool.execute.after` 拿到的结构化 `ListPage`。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败(上游临时改动) |
| --- | --- | --- |
| P1 回合以 `session.execution.succeeded\|failed\|interrupted` 收尾,引擎不发 `session.status` / `session.idle` | `turn.test.ts` `[packages/ui-mac/src/engine-adapter/events.ts] …`:三个回合 —— 正常回复、代理回 400(不重试的请求错误)、慢回复途中 `POST /api/session/:id/interrupt`。逐会话收原始 `/api/event`:收尾帧类型与场景一一对应,整条流里没有 status / idle 帧。控制臂:同一判定在录到的流里插一帧 `session.idle`、或删掉收尾帧,都判红。 | 把 `schema/src/session-event.ts:248` 的类型名改掉,或让收尾时多发一帧 idle ⇒ 红。不修的后果:适配层判不出回合结束(界面一直忙),或合成重复的 idle。 |
| P2 看得到模型请求的钩子只有 `context` / `compaction` / `generate` / `title`,多一种请求必须红 | `plugins.test.ts` `[packages/ext/src/plugin.ts] …`。结构臂:装真 `SessionModelRequest.layer`(`core/src/session/model-request.ts`,依赖换成记录用替身),服务的入口恰为 primary / compaction / generate / title。流程臂:探针插件挂这四个钩子与 `model.request`,经公开路由触发回合(context)、起标题(title)与压缩(compaction);实施时若 generate 有公开路由也触发,没有就只留结构臂,写进偏离记录。每次 `model.request` 之前必须有这四个钩子之一。控制臂:多一个入口的服务,以及前面没有钩子的一次请求,都判红。 | 在 `model-request.ts` 的 `Service.of` 里加第五个入口 ⇒ 结构臂红。不修的后果:第五种请求不经 ext,带着原样的图、暂存附件 JSON、未转写的提示词照发。 |
| P3 配置文档层序;设置后到的胜出,policy 先到的胜出 | `config.test.ts` `[packages/ui-mac/src/main/engine-explicit-config.ts] …`。全局 / 显式 / 项目 / 内联各写命令 a–d,`description` = 层名 ⇒ `/api/command` 读到 a=global、b=explicit、c=project、d=content(计划阶段已实测)。policy 两个方向:provider p1 显式 deny、项目 allow ⇒ 不可用;p2 显式 allow、项目 deny ⇒ 可用,以此区分「先到先得」与「deny 优先」。控制臂:颠倒的层序喂同一判定,判红。 | 交换 `core/src/config.ts` 返回数组里 `explicit` 与 `direct`(项目根的 `opencode.json` 在 `direct` 里),或把 `content` 挪到 `direct` 前面 ⇒ 红;policy 把 `managed-policy.ts` 的 `findLast` 改成 `find` ⇒ 红。不修的后果:出厂命令盖过项目同名命令,项目 allow 盖过 provider 白名单。 |
| P4 插件激活顺序 pre → 包 → post;config agent / command / skill / provider / policy 与 browser 在 post | `plugins.test.ts` `[packages/ext/src/policy/index.ts] …`。内联文档的 `plugins` 装一个目录形式的探针包插件,`/api/plugin` 里:pre 的样本(`opencode.tool.read`、`opencode.tool.shell`、`opencode.agent`、`opencode.command`、`opencode.skill`)都在它之前,上面列的 post 都在它之后(计划阶段已实测)。控制臂:把 `opencode.config.policy` 挪到包插件前面,判红。 | 把 `core/src/plugin/internal.ts` 的 `ConfigPolicyPlugin.Plugin` 挪进 `pre` ⇒ 红。不修的后果:`seal()`、尾部规则与 `holdAsk` 的前提失效。依赖方还有 `packages/ui-mac/src/main/sidecar-ext-ready.ts`。 |
| P5 相对 `skills` 条目按 Location 目录解析,且受监听 | `config.test.ts` `[packages/ui-mac/src/main/codepuppy-config-injection.ts] …`。显式文件写 `skills: ["./.codepuppy/skills"]`:项目 A 有 `.codepuppy/skills/probe-a/SKILL.md`,`/api/skill` 列出它;项目 B 没有该目录,不列。A 首次列出后再写 `probe-a2`,期限内出现,不重启引擎。写入前先断言 `probe-a2` 不在。 | 把 `core/src/config/plugin/skill.ts` 里的 `path.join(location.directory, expanded)` 改成按进程目录解析 ⇒ 红。不修的后果:项目导入的技能不加载,或串到别的项目。 |
| P6 读目录:适配层解析的模型正文形状 | `turn.test.ts` `[packages/ui-mac/src/engine-adapter/v1-shapes.ts] …`。剧本「list the folder」读 `sub`(one.txt、two.txt、inner/)⇒ `message.list` ⇒ 适配层 `toV1Messages` ⇒ read 工具 part 的 `metadata.display.type === "directory"`,entries 与盘上一致。控制臂:同一份真实输出把首行措辞改一个词,`toV1Messages` 不再铸目录卡。 | 改 `core/src/tool/plugin/read.ts` `toModelContent` 的首行措辞 ⇒ 红。不修的后果:目录网格卡静默退回读文件卡。 |
| P7 `data:` 附件按字节嗅探存成 `text/plain`,渲染成 `Attached file: <名>` | `turn.test.ts` `[packages/ext/src/attachment-reader-hooks.ts] …`。prompt 带 ext `stagedAttachmentPart(meta)`:存下的文件 part mime 为 `text/plain`、名字不变,适配层 `toV1Messages` 还原出同一条 meta;记录插件在 `context` 钩子里看到的请求消息里,有一个文本部件经 ext `stagedAttachmentOfText` 解回同一条 meta(ext 就在这个钩子里认它)。控制臂:换个文件名,或改坏 JSON,两个识别器都不认。 | 把 `core/src/session/runner/to-llm-message.ts:42` 的 `Attached file:` 改掉 ⇒ 红。不修的后果:暂存附件 JSON 原样发给模型,附件卡丢失。依赖方还有 `v1-shapes.ts`、`staged-attachment-part.ts`。 |
| P8 `GET /api/shell/:id/output?cursor=` 的游标语义 | `turn.test.ts` `[packages/ui-mac/src/engine-adapter/events.ts] …`。剧本「slow shell」:从进度帧取 `shellID`,每 150 ms 用适配层同一个客户端调用 `api.shell.output` 读到工具结束。游标单调不减;各页 output 拼起来恰为 `line1\nline2\nline3\n`(不缺不重);工具结束前至少到过一页;用最终游标再读,得到空输出。控制臂:重复一页、游标回退,都判红。 | 让 `core/src/shell.ts` 的 output 无视游标从头返回 ⇒ 红(重复)。不修的后果:运行中 shell 卡片的输出重复或缺段。 |
| P9 `Permission.reply` 的事件顺序 `[target, cascade]` | 现有 `packages/ext/src/policy/permission-reply-premises.test.ts`:真 Permission 服务,旧假设(级联在前)判红。本段只给标题补依赖方 `permission-replies.ts`。 | 已由该文件的 (ii) 顺序用例证明。`core/src/permission.ts` 是接管文件(ADR-038):上游改它会先被 sync 的接管审查拦下,本探针兜住我方移植时把顺序改掉。 |
| P10 远端 MCP 的集成身份 `mcp_<sha1(name\0url)[0:16]>` | `config.test.ts` `[packages/ui-mac/src/engine-adapter/routes.ts] …`。全局配置两台远端 MCP,同一个 url、不同名字 ⇒ `/api/integration` 里 `metadata.source === "mcp"` 的条目每台一个:名字 = MCP 名,有 `oauth` 方法,id 等于公式值(两台 id 不同)。计划阶段已实测一台。控制臂:换 url 算出的 id 判不等。 | 改 `core/src/mcp/index.ts` 的取段长度 ⇒ 红。不修的后果:适配层按来源 + 名字找不到集成(去授权 404),或升级后已存的 MCP 登录因 id 变了而作废。适配层本身不算 id(design K2),公式只出现在探针里。 |
| P11 高层配置按名字整条替换低层的 MCP 条目 | `config.test.ts` `[packages/ui-mac/src/main/mcp-default-deny.ts] …`。全局写 `x = {type: remote, url: A, oauth: false}`,内联写 `x = {type: remote, url: B}` ⇒ 有 `mcp_<sha1(x\0B)>` 集成(只在低层的 `oauth: false` 没有留下来);内联写 `NEUTRALIZED_MCP_SERVER`(从 `mcp-default-deny.ts` import)⇒ x 为 disabled。控制臂:深合并时应有的结果喂同一判定,判红。 | 把 `core/src/config/plugin/mcp.ts` 的整条 `set` 改成深合并 ⇒ 红。不修的后果:默认拒绝的中和条目被合并进原定义,关不掉 server。 |
| W1 每日同步跑探针 | 接线 yml 一步。证据:四个解析 workflow 的 ui-mac 测试仍绿;本机跑那条命令,全绿时 exit 0,临时改坏一个上游文件时 exit 非零。 | 这一步不在,同步就不跑探针,上游行为变了要等换代才发现。 |
| W2 本地闸跑探针 | gate-files 三行。证据:`bun-test-floor.sh =<N>` 逐文件实测等于登记值。 | 某个探针文件被删或被清空,第 [6/14] 步按精确条数判红。 |

不加的:P12 托管 deny 与项目 agent 规则的先后(ext `policy/managed.ts`,调查 E1)。编排器要求能用隔离根里的托管文件探到才加,这里探不到:`start()` 的 `config` 选项只有 directory / project / claude / file / content(`packages/server/src/options.ts`),没有 `system`;引擎只读平台系统目录(`core/src/config/discovery.ts:28-32`,darwin `/Library/Application Support/opencode`、linux `/etc/opencode`),在隔离根之外,也不许写。走进程内要另搭一套带真 `Config.layer({ system })` 与 agent 插件宿主的 core 层图,等于再抄一份 `policy-host.cases.ts` 的层图;今天零租户有托管文件。

### 偏离记录

- 2026-11-12 · 第二片:P3 证明列的上游改动写错了位置 —— 项目根 `opencode.json` 在 `config.ts` 的 `direct` 里,不在 `projectSupplementary`(那是项目的 `.opencode/` 目录);照原计划交换 `projectSupplementary` 与 `content` 时探针仍绿,改为交换 `explicit` / `direct` 与把 `content` 挪到 `direct` 前,两处都红。P12 按编排器条件评估后不加,理由见证明表下。共存检查按编排器「只按名字跑探针文件」改为四个文件同进程跑,不跑 ext 整包。· 第二片提交
- 2026-11-12 · P7 的观测点从「代理录到的线上请求」改为「`context` 钩子里的请求消息」:实测 openai-compatible 把同一条用户消息的文本部件拼成一个字符串发出,线上看不到独立的 `Attached file:` 部件,而 ext 认附件正是在 `context` 钩子里按部件认的。为此宿主每台引擎装一个记录插件,P2、P4 也用它(原计划在 `plugins.test.ts` 自带一个探针插件)。P1 的失败回合用 400,不用 500:500 可能被引擎重试,拖慢回合。请求经进程内 dispatch 直接打路由,不另建客户端。· 第一片提交
