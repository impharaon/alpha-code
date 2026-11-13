---
id: ARCH-codepuppy-2026-11-13-project-config-command-surface
title: 未授权项目的配置键能让哪些命令执行、在什么时点(INT-safety I-12 实测)
kind: architecture
status: active
summary: "陌生仓库的 opencode.json / .opencode/ 在 Code Puppy 里能让哪些命令执行、在什么时点:本地 MCP 一打开就跑;formatter、shell、斜杠命令插值在模型写文件 / 跑 shell / 用户敲命令时跑项目选的程序;模型级 package 在第一轮把项目里的 JS 装进引擎进程;都在围栏内,但围栏放行写 codepuppy.jsonc 与 ~/.opencode。逐键现有门、修复位置与回归用例"
---
# 未授权项目的配置键能让哪些命令执行、在什么时点(INT-safety I-12 实测,2026-11-13)

> 实测,不是方案。没有改任何产品代码。取舍交给 owner 与方案阶段。
> 来源:INT-safety I-12,owner 2026-11-13 批准调查(「就必要就继续。继续吧。」)。
> 基线:`origin/alpha` @ `fed47ed022`。`fix/project-engine-plugin-consent`(`#1708`,项目插件)当时还没合进来,本文的插件结论按 alpha 当时的状态写。
> 标记:**[实测]** = 本文的探针跑出来的;**[读码]** = 读代码得出;**[推断]** = 没有直接测过。

## 结论(三条要紧的)

1. **打开一个陌生仓库就会执行它指定的命令,没有任何确认。** 项目 `opencode.json` 的 `mcp.servers.<名字>`(`type: "local"`)写的命令,在 Code Puppy 第一次带这个目录发请求时(也就是用户在桌面端打开这个项目时)就启动了,不需要发一轮对话。[实测] Code Puppy 现有的项目信任门只管 `.codepuppy/codepuppy.jsonc` 这份文件;同一个未授权项目在那份文件里写同样的条目,确实不执行。[实测] 引擎自己读的 `opencode.json` / `.opencode/` 不经过这道门。
2. **之后用户或模型做的普通动作,都会换成项目选的程序去执行。** 模型写一个 `.txt` 文件,就跑项目 `formatter` 里写的命令;项目只要写了 `formatter` 键,模型写 `.php` 文件就跑项目里自带的 `./vendor/bin/pint`;模型调 shell、用户在输入框里跑 shell、用户打开默认终端,用的都是项目 `shell` 键指向的那个可执行文件;用户敲 `/review`、`/init` 时,执行的是项目同名命令模板里的 `` !`cmd` ``。[实测] 在「请求审批」档,审批框里只有命令原文(例如 `echo cp-ask-tier`)。用户批准以后,执行这条命令的是项目指定的程序;用户批准的是写一个文件,写完却要跑项目的 formatter。[实测]
3. **项目可以在第一轮对话时把自己的 JS 装进引擎进程。** 写 `providers.codepuppy.models.<模型>.package: "file://<项目内的模块>"`,用户用这个模型发第一条消息时,引擎就会 import 这个模块。[实测] 节点级的 `package` 会被注入盖掉,新增的节点会被 `provider.use` 拒绝,唯独模型级这一格没有人写值。[实测]

**围栏挡住了什么、没挡住什么:**这些命令全部在进程围栏里面运行。围栏外的目录与 `~/.zshrc` 都写不进去。[实测] 但围栏放行写 `<codepuppy-state>/env/<env>/codepuppy.jsonc`(W2)和 `~/.opencode/plugins/`(W16)[实测],读文件也不受限制(能读到项目外的「私钥」文件)[实测]。所以打开项目时启动的那条命令,可以把一个本地 MCP 写进用户全局的 `codepuppy.jsonc`,或者把一个插件写进 `~/.opencode/plugins/`。注入不会中和全局 `codepuppy.jsonc` 里的本地条目(`mcp-default-deny.ts:71`)[读码],之后它会在**每一个**项目里运行 [推断,写入已实测,后续执行未测]。

**最小的修复候选:**在 `engine-server-options.ts` 交给 `start()` 的 `config` 里加一项 `project: false`,引擎就不再读任何项目级(以及项目往上各级目录)的 `opencode.json(c)` 与 `.opencode/`(`packages/core/src/config/discovery.ts:79`)。下面回归用例里 10 条「已知的坏」在这个改动下全部翻转;出厂的 `/init`、`/review`、用户全局插件与它自己的 options、注入的 agent 都还在。[实测,临时改测试宿主跑的,没有提交] 代价与另一条路见 §5;关掉之后实际少了什么(含项目 `AGENTS.md`)见 §8。

## 1. 测法

- 宿主:`packages/ui-mac/test-component/codepuppy-engine.ts`。沙箱里跑嵌入式 OpenCode 2,配置由生产 `injectCodePuppyConfig` 生成,装真 ext,模型用本机桩;HOME 与 XDG_* 全部指向临时根(`engine-sandbox.ts`),用 `assertEngineSandboxed` 证明隔离成立。
- 探针:每个「命令」都是一段 sh,只往沙箱标记目录追加一行;SDK 包探针是一个 ES 模块,在模块求值的第一行写标记。项目目录**没有** `.codepuppy/prefs.json`,即未授权。
- 入口用产品真正走的路由:打开 = 第一次带 `x-opencode-directory` 的请求(`GET /api/plugin`);一轮 = `POST /api/session/:id/prompt`;模型调用 = 模型桩回 `write` / `shell` 工具调用;用户动作 = `POST /api/session/:id/command`、`POST /api/session/:id/shell`、`POST /api/pty`;审批 = `POST /api/session/:id/permission/:id/reply`。每个时点之后取一次标记快照。
- 用例文件:`packages/ui-mac/src/main/project-config-commands.engine.cases.ts`(11 条),由宿主 `project-config-commands.engine.test.ts` 起独立的 `bun test` 子进程运行。
  运行方式:`cd packages/ui-mac && bun test --timeout 600000 src/main/project-config-commands.engine.test.ts`,结果 `1 pass / 0 fail`(子进程内 `11 pass / 0 fail`)。
- 证明用例会失败:临时删掉夹具里的 `mcp` 与 `shell` 两个键,依赖它们的 5 条变红。临时让宿主传 `config.project: false`,10 条「已知的坏」全部变红(标记不再出现),只有「never」那条保持绿。两次都已用 `git restore` 或备份还原。
- 围栏:用一个临时测试(`i12-fence-probe.test.ts`,已删除,没有提交)复用 `process-fence-engine.test.ts` 的整套机器:生产 `.node`、生产 `planProcessFence`、出货的 `engine-embed-driver.ts`,围栏 preload 先于任何模块装载。项目 `opencode.json` 写一个本地 MCP,它的脚本向 5 个目标各写一次,并读一个可写集外的文件。分两臂运行:不套围栏 / 套围栏,都只打开项目,不发对话。

## 2. 主表

时点:**(a)** 打开项目(引擎装载配置);**(b)** 一轮开始;**(c)** 模型写文件 / 调 shell,或用户调用某个功能;**(d)** 从不。

| 项目里的键 | 什么时候执行 | 现有的门 | 围栏内 / 外 | 建议处理 | 最小修复位置 |
| --- | --- | --- | --- | --- | --- |
| `mcp.servers.<n>`,`type: "local"` 的 `command` / `environment`(`opencode.json`、`.opencode/opencode.json`,以及项目往上各级目录里的同名文件) | **(a)** 打开即启动 [实测] | 无。ext 信任门只管 `.codepuppy/codepuppy.jsonc`(`ext/src/project-config.ts:144-151`,对照实测:不执行);`mcp-default-deny.ts` 只枚举全局三份文件(`:1-4`);注入不写 `mcp.use` | **内** [实测:界外写拒、W2/W16 写进] | 未授权时**忽略** | `ui-mac/src/main/engine-server-options.ts:49-53` 加 `project: false` [实测会翻转]。按名字写 `mcp.use` 不够:项目可以用同名条目整条替换用户的 server(`core/src/config/plugin/mcp.ts:47-49`)[读码] |
| `formatter.<n>.command` / `environment` / `extensions`;以及「写了 `formatter` 键就打开内置格式化器」,其中 `pint` 跑项目的 `./vendor/bin/pint`(`core/src/formatter/builtins.ts:223-230`) | **(c)** `write` / `edit` / `patch` 工具写成功之后(`core/src/file-write.ts:85`、`tool/plugin/patch.ts:259`)[实测];「请求审批」档在批准写文件之后执行 [实测];项目没写 `formatter` 键时 pint 不执行 [实测] | 无。审批只问 `edit` 与文件名 | 内 [推断:同一进程派生,seatbelt 继承] | 未授权时忽略 | 同上 |
| `lsp.<n>.command` | **(d)** [实测]:引擎还没有 LSP 运行时(`core/src/file-mutation.ts:138`、`tool/plugin/write.ts:38` 的 TODO);配置只被解码(`config/normalize.ts:510-517`) | 不需要 | — | 今天是安全的;上游一旦接上 LSP 运行时就会变成 (a)/(c) | 同上(提前覆盖) |
| `shell`(可执行文件路径) | **(c)** 模型的 shell 工具、用户在输入框跑的 shell、默认终端(无参数启动)、斜杠命令的 `` !`cmd` `` 插值,全部经过它 [实测]。必须是绝对路径:相对路径按引擎进程的 cwd 解析(`core/src/shell/select.ts:86-94`)[读码] | 只有 shell 工具的审批,而审批框只显示命令原文 [实测] | 内 [推断;同一个派生点的 shell 工具在 `process-fence-engine.test.ts` 里实测在内] | 未授权时忽略 | 同上 |
| `commands.<n>.template`、`.opencode/command(s)/*.md` 里的 `` !`cmd` ``;与出厂同名的 `review` / `init` | **(c)** 用户调用这条斜杠命令时,先用 shell 执行插值(`core/src/config/plugin/command.ts:184-235`,正则在 `:246`),不经过任何审批 [实测]。项目的 `review` / `init` 会顶替出厂命令 [实测];项目命令也出现在命令列表里 [实测] | 无。ext 的说明「含 shell 的模板原文发出」只适用于 ext 自己注册的项目命令(`ext/src/engine-transforms.ts:20-21`),不包括引擎原生的配置命令 [读码] | 内 [推断] | 未授权时忽略 | 同上 |
| `providers.<id>.models.<m>.package: "file://…"` | **(b)** 用这个模型的第一轮就 import 模块(`core/src/plugin/provider/sdk-factory.ts:5-8`、`config/plugin/provider.ts:229`)[实测] | `provider.use` 只按节点 id 判;注入的模型条目不写 `package`(`ui-mac/src/main/codepuppy-models.ts:331-345`)[读码] | 内(就在引擎进程里运行,拥有引擎的全部进程内能力)[推断] | 未授权时忽略 | 同上;或者由注入给每个模型显式写 `package`(`codepuppy-models.ts` 的 `engineModel`)[推断,未测] |
| `providers.<id>.package`(节点级)/ 新增节点 | **(d)** 节点级被内联注入(排在项目之后)盖过;新节点被 `provider.use` 拒绝 [实测] | 注入层序 + `provider.use` | — | 今天是安全的(仅限注入定义的节点) | — |
| `instructions`(路径 / URL) | **(b)** 每一轮都把文件原文放进模型请求;项目外的文件(实测是沙箱里一个「项目外」文件)原文进入请求 [实测]。URL 在配置装载时抓取(`config/plugin/instruction.ts:148`)[读码,未测:不出网] | 无 | 进程内读取;围栏不限制读 | 未授权时忽略(不执行命令,但会泄露内容) | 同上 |
| `plugins`(代码) | **(a)** | `#1708`(在途,未合) | 进程内 | `#1708` | `#1708` |
| `plugins` 用自己的 `options` 重新声明用户全局的目录插件(第 6 项) | **(a)** 项目的 options 生效(同一个插件在别的项目里拿到用户的 options)[实测] | 无;`#1708` 按精确路径放行,options 跟着项目走 [读码] | 进程内 | 未授权时忽略 | 同上 |
| `plugins: ["-*"]` / `"-<id>"`(第 7 项) | **(a)** 内置插件与用户全局插件全部停掉;只剩受保护的 `opencode.config.policy`、`opencode.provider.opencode`(`core/src/plugin/internal.ts:305-306`)、ext(内联文档排在项目之后,又被装回)与宿主探针。会话因为节点没了而起不来 [实测]。`-opencode.config.agent` 让注入的只读档 agent 消失,用它开的会话报「找不到 agent」失败,不会退回放行 [实测] | 上游的受保护集合 + 层序 | — | 未授权时忽略(今天只会造成拒绝服务) | 同上 |
| 不是配置键:`.git/config` 的 `core.fsmonitor` | 引擎里 **(d)**:打开、对话、写文件之后都没有执行 [实测] | — | — | — | 桌面主进程自己调 git 的路径没测(见 §6) |

## 3. 逐项事实(探针 → 结果)

用例名就是 `project-config-commands.engine.cases.ts` 里的 `test(...)` 标题。

- **open**:`open(p1)` 之后只出现 `mcp-local`,`GET /api/mcp` 里只有 `cpi12mcp`(探针脚本不是 MCP 服务器,所以状态是 `spawn_failed`,但命令已经执行)。`.codepuppy/codepuppy.jsonc` 里的 `cpi12gated` 没有出现。配置层序实测:引擎全局目录 → `codepuppy-explicit.json` → 项目 `opencode.json` → 项目 `.opencode/` → 内联注入(`core/src/config.ts:363-373`)。
- **turn**:一轮普通对话没有多出新的标记;`instructions` 指向的金丝雀串出现在最后一次模型请求里。
- **tool(默认档)**:没有任何审批;写 `notes.txt` 之后 `formatter-config` 记下文件路径;写 `a.php` 之后 `formatter-builtin-pint` 记下路径;shell 工具之后 `shell-key` 记下 `argc=2 -c echo cp-tool`。
- **tool(请求审批档,`agent: "codepuppy-ask"`)**:审批请求是 `{action: "shell", resources: ["echo cp-ask-tier"]}`,审批出现的那一刻项目的 shell 还没跑这条命令;批准之后跑了。写文件的审批是 `edit ["ask.txt"]`,批准之后项目的 formatter 跑了。
- **user**:`cpi12cmd`(配置)与 `cpi12dir`(`.opencode/commands/`)的插值各经项目的 cpshell 跑一次;`POST /api/session/:id/shell` 记下 `argc=2 -c echo cp-user`;`POST /api/pty` 默认终端记下 `argc=0`(无参数启动,项目的程序就是终端的 shell)。
- **shadow**:项目定义 `review` / `init` 之后,调用这两个命令都执行了项目模板里的插值。
- **provider**:节点级 `package` 没有被装载(`GET /api/provider` 显示 codepuppy 节点的包仍是 `@opencode/ai/providers/openai-compatible`);新节点 `cpi12new` 报「Model unavailable」;模型级 `package` 被 import(引擎日志:`… model.mjs does not export model(modelID, settings)`)。
- **never**:`lsp`、`git-fsmonitor`、`mcp-codepuppy-jsonc`,以及没写 formatter 键时的 pint,全程没有出现。
- **插件 options**:同一个全局插件在 p1 拿到 `{who:"user"}`,在重新声明它的项目里拿到 `{who:"project"}`。
- **插件 `-*` / `-opencode.config.agent`**:见主表。

## 4. 围栏(怎么判定的)

临时探针,只打开项目、不发对话。两臂各自的 5 个写目标与 1 个读目标:

| 目标 | 不套围栏 | 套围栏 |
| --- | --- | --- |
| 项目目录(W1) | 写进 | 写进 |
| 可写集外的目录 | 写进 | **拒**(`Operation not permitted`) |
| `<codepuppy-state>/env/dev/codepuppy.jsonc`(W2) | 写进 | **写进** |
| `~/.opencode/plugins/i12-*.js`(W16) | 写进 | **写进** |
| `~/.zshrc` | 写进 | **拒** |
| 读可写集外的「私钥」文件 | 读到 | **读到** |

判定:围栏臂引擎日志里有 `engine-fence-preload: fence applied`,界外两处写入被 seatbelt 拒绝,所以这条项目命令在围栏里运行。不套围栏的一臂 5 处全部写进,说明探针能测出「写得进」。围栏的形状来自 `process-fence-profile.ts:152-171`:`allow default`,只限制写(W1–W18)与网络(只能经过策略代理)。[推断] 其余由引擎派生的进程(formatter、shell、PTY、命令插值)同样在围栏里,因为 seatbelt 由子进程继承;`process-fence-engine.test.ts` 已对 shell 工具、PTY、stdio MCP 实测过这一点。模型级 `package` 直接在引擎进程里运行。

## 5. 修复位置的两条路(给方案阶段)

- **A. `config.project: false`(一行)。**ServerOptions 本来就有这个字段(`packages/server/src/options.ts:37`),在 `engine-server-options.ts:49-53` 写入即可。效果 [实测]:本文 10 条「已知的坏」全部消失;出厂命令、用户全局插件、注入的 agent 照常。代价 [读码 / 推断]:**所有**项目(包括已授权的)的 `opencode.json(c)`、`.opencode/{commands,agents,skills,plugins}` 都不再生效。项目往上各级目录的同名文件也一并跳过,其中包括 HOME 一级的 `~/.opencode/` 与 `~/opencode.json`,它们只经项目向上遍历进入(`discovery.ts:78-81`),而 `#1708` 把它们当作用户全局照常加载。Code Puppy 自己的项目配置走 ext(`.codepuppy/codepuppy.jsonc`)与显式文件(`./.codepuppy/skills`),不受影响 [读码];~~项目的 `AGENTS.md` 发现走另一条路,应该不受影响~~ **订正(实测,§8):项目、上级目录与 `~/AGENTS.md` 都不再发给模型** —— 同一个开关也关掉了指令文件发现(`packages/server/src/routes.ts:143`)。`#1708` 的项目插件拒绝在这条路下多半成为多余,但 HOME 一级那部分的语义会变。
- **B. 按项目信任分别处理。**引擎的配置选项是全局的,插件接口拿不到「某条配置来自哪份文档」(`packages/plugin/src/promise/` 里没有 config 编辑器)[读码]。所以要按项目区分,只能接管 `core/src/config/discovery.ts`(或 `config.ts` 的装载),让它读 Code Puppy 的同意记录,这需要新的接管 ADR;或者在 ext 里重新实现一遍发现逻辑,那会成为第二个权威,`ARCH` 风险。
- 无论选哪条:`/review`、`/init` 这类出厂命令的名字,项目今天可以顶替 [实测]。A 会顺带关掉这个口子;B 需要单独保护出厂命令名。

## 6. 没测到的,以及原因

- **网络类**:`instructions` 的 URL、`references` 的 git 仓库(会 clone,`core/src/reference.ts:60-61`)、内置 prettier / biome / oxfmt 经 `npm.which` 从 registry 安装(`util/src/npm.ts:406-450`)。约束是不出网;这些装的也是 registry 上的包,不是项目自带的代码。
- **后续执行**:项目命令写进 `codepuppy.jsonc` / `~/.opencode/plugins/` 之后,下一次注入或重启是否在别的项目里运行,没有端到端测过。只测了「写得进」,加上读码(`mcp-default-deny.ts:71` 不动本地条目;`#1708` 把 `~/.opencode/` 当作用户全局)。
- **权限升级类键**(不直接执行命令):项目的 `permissions` / `policies` / `agents.<n>.permissions` 能不能把「请求审批」档的 shell 改成直接放行,本次没有测。`references` 的本地路径能不能把模型的读取范围扩到项目外,也没有测。
- **桌面主进程**:主进程自己调 git(会话侧栏的文件 / 评审)时会不会触发 `core.fsmonitor`,本宿主只跑引擎,测不到;而且主进程在围栏**外**。
- **打包形态**:引擎跑在 bun(开发树),不是出货的 Electron-Node sidecar;围栏那一组用的是生产 `.node` 与生产计划器,但仍是开发树,与 `process-fence-engine.test.ts` 口径相同。
- **Windows**:没测。

## 7. 回归用例怎么用

`project-config-commands.engine.cases.ts` 把今天的行为钉成**已知的坏**。修复落地时按修复的口径**翻转**断言,不要删用例:例如「出现」改成「不出现」,或改成「授权后才出现」。§1 的 `project: false` 实验已经显示,每条断言在修复下都会翻转。这个宿主暂时没有登记进 `scripts/gate-files.tsv`,等修复翻转之后它才成为一道闸门,由修复那条 lane 登记。

## 8. 关掉项目配置发现的连带影响(`config.project: false` 前后对照,2026-11-13 追加)

### 测法

同一份夹具在同一宿主上跑两遍:一遍是今天的配置;另一遍在交给 `start()` 的选项里加 `config.project: false`。改动只在测试宿主里临时做,用一个环境变量切换,测完已用 `git restore` 还原。两个探针文件 `i12-collateral.engine.{test,cases}.ts` 也是临时的,没有提交。每遍都是全新的沙箱。

夹具:
- 项目都放在沙箱 HOME 之下(`~/work/<项目>`),每个项目都 `git init`。一个是未授权项目;另一个是已授权项目(带 `prefs.json` 的同意记录);还有一个中性目录,不是 git 仓库。
- 每个项目里放:
  - 指令文件:`AGENTS.md`、`CLAUDE.md`、`.cursorrules`,各写一个金丝雀串;
  - 引擎自己发现的技能:`.opencode/skill(s)/`、`.claude/skills/`、`.agents/skills/`;
  - 引擎目录里的命令与 agent:`.opencode/commands/`、`.opencode/agents/`;
  - Code Puppy 的项目配置 `.codepuppy/codepuppy.jsonc`,里面有 `mcp`、`agent`、`command`、`skills.paths` 四项;
  - `.codepuppy/skills/` 与 `.codepuppy/plugins/p.js`。
- 用户全局目录(生产交给 `config.directory` 的那个目录)放:`opencode.json`(mcp / formatter / shell / plugins)、`skills/`、`commands/`、`AGENTS.md`。
- HOME 一级放:`~/.opencode/{plugins,skills,opencode.json}`、`~/AGENTS.md`;HOME 与项目之间的上级目录放 `~/work/AGENTS.md`。

每个位置的测量:先打开,再发一轮;读最后一次模型请求里的金丝雀与 `<env>` 块;读 `/api/skill`、`/api/command`、`/api/agent`、`/api/mcp`、`/api/plugin` 和会话列表。在中性目录里让模型写 `.txt`、调 shell,用来检验全局的 formatter 与 shell。

### 对照表

| 能力 | 今天 | `project: false` | 替代来源 |
| --- | --- | --- | --- |
| 项目根目录的 `AGENTS.md` 进入模型请求 | 是 [实测] | **否** [实测] | 无现成替代。ext 可以按会话把它放进去(见下面第 5 项),这要写新代码 |
| 上级目录与 `~/AGENTS.md` 进入模型请求 | 是 [实测] | **否** [实测] | 无 |
| 用户全局目录的 `AGENTS.md` | 是 | 是 [实测] | — |
| `CLAUDE.md`、`.cursorrules` | 从不 [实测;引擎只认 `AGENTS.md`,`config/plugin/instruction.ts:41`、`:55`、`:87`] | 从不 | — |
| 项目 `.opencode/skill/`、`.opencode/skills/` | 发现 [实测] | **不发现** [实测] | `.codepuppy/skills/` |
| 项目 `.claude/skills/`、`.agents/skills/` | 不发现(Code Puppy 已移除兼容插件)[实测] | 不发现 | `.codepuppy/skills/`(由 ecosystem-import 导入) |
| 项目 `.opencode/commands/*.md` | 发现 [实测] | **不发现** [实测] | `.codepuppy/codepuppy.jsonc` 的 `command` |
| 项目 `.opencode/agents/*.md` | 发现 [实测] | **不发现** [实测] | `.codepuppy/codepuppy.jsonc` 的 `agent` |
| `.codepuppy/codepuppy.jsonc` 的 `mcp`(信任门之后) | 已授权项目运行、未授权项目不运行 [实测] | 相同 [实测] | — |
| `.codepuppy/codepuppy.jsonc` 的 `agent` / `command` | 未授权与已授权项目都注册 [实测] | 相同 [实测] | — |
| `.codepuppy/codepuppy.jsonc` 的 `skills.paths`(`./cpskills`) | **两边都不发现** [实测;OpenCode 2 上本来就不生效,注入的说明已记,`codepuppy-config-injection.ts:96-101`] | 相同 | `.codepuppy/skills/` |
| `.codepuppy/skills/`(显式文件里的相对条目) | 发现 [实测] | 相同 [实测] | — |
| `.codepuppy/plugins/*.js`(ext 代为装载,在信任门之后) | 已授权项目装载、未授权项目不装载 [实测] | 相同 [实测] | — |
| 用户全局 `opencode.json` 的 mcp / formatter / shell / plugins | 生效 [实测] | 生效 [实测] | — |
| 用户全局的 `skills/`、`commands/` | 发现 [实测] | 发现 [实测] | — |
| `~/.opencode/` 的插件 / mcp / 技能 | 生效 [实测] | **跳过** [实测] | 用户全局配置目录(生产里是引擎全局配置目录) |
| HOME 下其它变化 | — | 上面两行(`~/.opencode/`、`~/AGENTS.md`),外加 `~/opencode.json(c)` [读码:都只经项目向上遍历进入,`config/discovery.ts:78-81`] | 同上 |
| 项目根、git 判定(`<env>` 块里的 Workspace root folder、Is directory a git repo) | git 项目根 = 项目目录,git = yes;中性目录 git = no | 相同 [实测] | — |
| 项目 id / 会话列表 | 每个位置列出 1 个会话 | 相同 [实测]。注:两个都还没有提交的 git 仓库的 projectID 两边都是 `global`,这是上游对空仓库的行为,与开关无关 | — |
| 文件监听 | — | 不受影响 [读码:`config.project` 只传给 Config 与 InstructionDiscovery,`server/src/routes.ts:135-143`;监听只看 `fs.filewatcher`,`:131-132`];失去的只是项目文档里的 `watcher.ignore`(`config/plugin/location-watcher.ts`) | 全局配置里的 `watcher.ignore` |

结论:`project: false` 关掉了 §2 的全部命令面,Code Puppy 自己的项目配置(`.codepuppy/` 下的 mcp、agent、command、skills、plugins,包括信任门的行为)一项不少。实际丢掉的是三类:**项目与上级目录的 `AGENTS.md`**;引擎原生的 `.opencode/` 技能、命令与 agent;HOME 一级的 `~/.opencode/`、`~/opencode.json(c)` 与 `~/AGENTS.md`。

### 第 5 项:有没有比 `project: false` 更窄、能保住 `AGENTS.md` 的引擎选项

**没有现成的。** 依据 [读码]:

- `start()` 的 `config` 只有 `directory / project / claude / file / content` 五格(`packages/server/src/options.ts:34-41`)。其中 `project` 同时交给 `Config.configured` 和 `InstructionDiscovery.configured`(`packages/server/src/routes.ts:137`、`:143`)。`InstructionDiscovery` 自己有独立的 `project` 选项(`core/src/instruction-discovery.ts:47-50`、`:99`),但没有经 ServerOptions 单独暴露。Code Puppy 的 `engine-embed.ts` 直接调上游的 `start()`,替换不了这一层,除非接管 `routes.ts`,而接管需要新的 ADR。
- 用配置里的 `instructions` 把 `AGENTS.md` 加回来也不行:关掉项目发现后,相对路径改为按全局配置目录解析(`config/plugin/instruction.ts:96-113`)。绝对路径又只能由全局注入一次性写死,写不出每个项目各自的路径。
- 托管策略只有 `provider.use / tool.use / integration.* / mcp.use / skill.use / plugin.use / websearch.use` 这几种动作(`packages/schema/src/config/policy.ts:18-27`),没有「忽略项目文档里的某个键」。托管**设置**(系统目录 `/Library/Application Support/opencode` 与 MDM plist)排在最后、能盖过任何键(`core/src/config.ts:300-325`、`:372`),但它是整机范围的,需要管理员权限,还会影响本机其它 OpenCode,不适合由应用来写。
- 反方向的「保留项目发现、只中和危险键」能做一部分:Code Puppy 的内联注入排在项目文档之后(`config.ts:371`),所以能盖过单值键。例如 `shell` 取最后一份文档的值(`config/plugin/shell.ts:16`);`formatter: false` 会清掉前面所有文档的格式化器(`config/plugin/formatter.ts:62-67`),但用户全局的也一起清掉;注入还可以给自己的每个模型显式写 `package`。盖不住的有:项目 MCP(按名字合并,注入不知道项目会起什么名字)、项目命令(只能追加)、`instructions`(会拼接)、`plugins`。所以这条路不完整。
- 要保住 `AGENTS.md`,比较小的办法是:采用 `project: false`,再由 ext 用插件接口的会话指令条目(`session.instructions.entry.put`,`packages/plugin/src/promise/session.ts:219`,宿主实现在 `core/src/plugin/host.ts:610-626`)把位置所在项目的 `AGENTS.md` 放回去。这是新代码,而且等于在 ext 里再实现一份上游的发现规则(从位置向上找到项目根或 HOME 为止),要和 `config/plugin/instruction.ts:39-58` 保持一致。另一条路是接管 `routes.ts:143`,让 `InstructionDiscovery` 不跟着 `project` 一起关,这需要 ADR。两条都是 [推断,未实现、未测]。
