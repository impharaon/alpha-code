---
id: DESIGN-project-engine-config-takeover
title: 项目自带的 OpenCode 配置由 Code Puppy 按项目信任放行 技术设计
summary: 引擎照旧自己读项目 opencode.json 与 .opencode/;未经允许的项目,它带来的东西不运行程序、不加载代码、不换掉所用程序、不放宽 agent 权限或换模型——Code Puppy 在引擎配置装载与 agent / 命令 / 技能的 md 读取点按 #1709 信任决定把关(md 文件头只按 YAML/JSON 解析、控制字段在校验前后都拿掉);读普通内容不设闸;同一个确认框,清单由引擎算出、算不全就不弹;新增接管 config.ts、skill.ts、agent.ts 三个上游文件
kind: tech-design
status: draft
spec: SPEC-project-engine-config-takeover
spec_version: 0
review:
  rounds: 2           # R1:Codex(GPT-6)会话 01a1d3fe 审 1b6be7ffd3,BLOCK,5 条全部采纳;R2:会话 01a1d41b 审 787257e259,FIX-THEN-MERGE,3 条按编排器裁决处理(§10)。R2 是最后一轮
  reviewed_sha: "787257e259"
  verdict: ""         # 由编排器按 §10 的 R2 处置核对后填写
owners: [owner]
last_reviewed: 2026-11-13
---

# DESIGN-project-engine-config-takeover｜项目 OpenCode 配置按项目信任放行 技术设计

只写决定。文件清单、提交顺序与测试由实现方的 plan.md 写。§3、§7 已退役,编号不复用。

## 1. 基线
- Spec:[SPEC-project-engine-config-takeover v0](spec.md)(草稿)。owner 2026-11-13 决定实施(编排器转达:「要做。」)。
- 覆盖:AC-01 至 AC-07。
- 背景:owner 2026-11-13 原话(spec「来源」逐字);INT-safety I-12;P-06。代码基线 `origin/alpha` @ `fed47ed022`。
- 依赖的在途分支(都未合入 `origin/alpha`,2026-11-13 用 `git merge-base --is-ancestor` 核过):
  - `#1709` 信任记录(`fix/1709-project-consent-store` @ `bb98467a7d`):本设计直接消费,须先合入。
  - `#1708` 项目引擎插件拒绝(`fix/project-engine-plugin-consent` @ `e754d7e9f9`):被本设计取代,处置见 §10 R-07。
  - `#1698` 启动文档(`feat/1698-bootstrap-config`):本设计不需要新的启动键,不依赖。

## 2. 地面真相

标记:**[实测]** 有探针或命令输出;**[读码]** 读代码得出;**[推断]** 未直接验证。spike 指 `docs/architecture/2026-11-13-project-config-command-surface.md` @ `e9635b3071`;R1 / R2 指 §10 的 Codex 审查,它们的内存探针算实测。

| # | 事实 | 依据 |
| --- | --- | --- |
| F-01 | 未允许的项目今天能让引擎运行它指定的程序:本地 MCP 打开即启动;formatter、shell、命令插值在模型写文件 / 跑 shell / 用户敲命令时运行;模型级 `package` 第一轮把项目 JS import 进引擎;项目能改用户全局插件的 options;`plugins: ["-*"]` 停掉内置插件,会话起不来 | spike §2、§3 [实测] |
| F-02 | 引擎选项 `config.project: false` 关掉上面全部,但也关掉项目与上级目录及 `~/AGENTS.md`、`.opencode/{skill(s),commands,agents}`、`~/.opencode/`、`~/opencode.json(c)`;同一个选项同时交给 `Config` 与 `InstructionDiscovery`(`packages/server/src/routes.ts:137`、`:143`);没有更窄的引擎选项,`start()` 在内部建应用图、不收替换层(`packages/server/src/process.ts:104`);也没有带 Location 与来源的底层读取包装(`packages/util/src/fs-util.ts:213` 是全局的) | spike §8 [实测];`packages/server/src/options.ts:34-41`;R1、R2 [读码] |
| F-03 | 引擎里每个读项目配置的地方都经 `Config.Service.entries()` 拿条目(22 个模块);条目按 Location(目录)各建一份 | `packages/core/src/config.ts:33-36`、`:117` 起的 `layer` [读码] |
| F-04 | `load()` 的层序(低→高):托管策略 → 集成 → wellknown → 引擎全局配置目录 → 显式文件 → 向上遍历找到的 `opencode.json(c)` → 遍历找到的 `.opencode/`(文档 + 目录条目)→ 内联注入 → 托管设置 | `config.ts:363-373` [读码];spike §3 open [实测] |
| F-05 | 向上遍历从打开的目录一直走到根;引擎全局配置目录不会经遍历重复进入;`~/.opencode/` 与 `~/opencode.json(c)` 只经遍历进入 | `config/discovery.ts:78-81`、`:121-126`;spike §8 [实测] |
| F-06 | `.opencode/` 目录条目的消费方只有 5 个:agent(`agent/agents/mode/modes/*.md`)、command(`command(s)/**/*.md`)、skill(`skill(s)/`)、插件来源(`plugin(s)/`)、条目观察者(只监听) | `config/plugin/agent.ts:44`、`command.ts:30`、`skill.ts:86`、`source.ts:131`、`entry-observer.ts:77` [读码] |
| F-07 | md 定义的 agent 只在 agent 插件内部被解码成 `Document`,解码函数没有导出 | `config/plugin/agent.ts:134-186` [读码] |
| F-08 | 命令插值:`` !`cmd` `` 用配置的 shell 执行,不经审批;`command.ts` 已在接管清单 | `config/plugin/command.ts:184-235`、`:246`;`scripts/north-star-guard.sh --print-takeover` [读码 + 命令];spike §3 user [实测] |
| F-09 | 插件装载前按 `plugin.use` 策略判定,判定读本 Location 的条目;「最早装载的文档胜」;`*` 跨 `/` 匹配;目录插件的目标保留发现时的路径 | `plugin/module.ts:53`、`plugin/source-directory.ts:16`、`managed-policy.ts:10-35`、`util/wildcard.ts:3-13` [读码];R1 核对无异议 |
| F-10 | 上游自己就不许仓库配置移除两个内置插件(策略与 Console 连接) | `plugin/internal.ts:303-306` [读码] |
| F-11 | 引擎解码配置时丢弃认不出的字段;JSONC 坏或 schema 不过的整份文档被拒并记诊断 | `config.ts:134`、`:136-166` [读码] |
| F-12 | 项目 JSON 文档装载时先做 `{env:VAR}` 与 `{file:path}` 替换,再解析 | `config.ts:168-174`、`config/variable.ts:25-63` [读码] |
| F-13 | 读普通内容的路径:AGENTS.md 向上遍历先 resolve 再读;配置的 `instructions` 从打开的目录向上 glob 到项目根并读取匹配结果,网址在装载时抓取;技能扫描跟随链接;模型读文件时,读取工具把那个文件附近的 AGENTS.md 交给会话指令直接读取。没有 VCS 标记时项目根就是打开的目录,只有打开 git / hg 仓库的子目录时才会搜到它上方。这些路径都会跟随符号链接、展开花括号通配,能读到项目文件夹以外的文件 | `config/plugin/instruction.ts:36-39`、`:65`、`:87-88`、`:107`、`:130-134`、`:160`;`skill.ts:96-104`、`:124-126`;`tool/plugin/read.ts:140-148` → `session/instructions.ts:55-70`;`project.ts:428-456` [读码];R1 F2、F3 与 R2 第 1 条探针 [实测] |
| F-14 | ext 插件接口没有整份配置的编辑器:加不了技能目录,给不了插值、命令的 agent/model/subtask,没有 formatter / lsp / instructions 的挂点 | `packages/ext/src/engine-transforms.ts:15-23`;`packages/plugin/src/promise/` 目录清单 [读码];spike §5 B |
| F-15 | 托管策略只有 8 种动作,没有「忽略项目文档的某个键」;注入层能盖过单值键(如 `shell`),盖不住项目 MCP、命令、`instructions`、`plugins` | `packages/schema/src/config/policy.ts:18-27`;spike §8 第 5 项 [读码] |
| F-16 | Code Puppy 的策略写在显式文件(比项目文档先装载 ⇒ 项目的 allow 盖不过)与内联文档两处;执行闸把 Code Puppy 的 deny / ask 规则追加在每个 agent 全部配置规则之后 | `packages/ui-mac/src/main/codepuppy-config-injection.ts:320-325`;`packages/ext/src/policy/catalog.ts:13-15`、`:29-52` [读码] |
| F-17 | 信任记录(`#1709`):`<casBaseRoot>/project-trust/<env>.json`,按 realpath 项目目录 + inode 认项目;读法 `readProjectExtensionsConsent`,没有记录 / 读不出 / 拒绝 / 身份漂移都不算允许;macOS 上引擎写不进 | `#1709` 架构说明 `docs/architecture/2026-11-13-project-extension-trust-record.md`;`packages/ext/src/project-config.ts:225-234`(该分支)[读码 + 该分支实测] |
| F-18 | 同意后 renderer 请 ext 重载(`scope: "global"`),ext 调度器等全部会话空闲后打一次 `POST /api/location/reload`,重建所有已加载的 Location;renderer 对同一个目录只在第一次进入会话时问一次 | `ext-trust-watcher.tsx:3-5`、`:52-54`(`#1709` 分支);`packages/ext/src/reload-scheduler.ts:1-24` [读码] |
| F-19 | 引擎入口 `startEngine(options, hooks)` 是 Code Puppy 自有文件,在 `start()` 之前可以做事;sidecar 已有一条主进程 → sidecar 的请求 / 应答命令(`write-probe`) | `packages/ui-mac/engine/engine-embed.ts:56-80`;`packages/ui-mac/src/main/sidecar.ts:124-137` [读码] |
| F-20 | 真实样本(本仓自带的上游 `.opencode/`):`agent/translator.md` 写了 `mode`、`model`;`command/commit.md` 带 `` !` `` 插值、`model`、`subtask`;`opencode.jsonc` 写了 `references` 与 `experimental.part_rows` | `ls /Users/tide/app/alpha-code/.opencode`、`grep -ln '!\`' .opencode/command/*.md`(2026-11-13)[命令] |
| F-21 | owner 本机:引擎全局配置目录 `~/.config/opencode/opencode.jsonc` 没有 `formatter` / `shell` / `plugins` / `mcp` 等键;没有 `~/.opencode/`、`~/opencode.json(c)`;本仓 `.opencode/` 与全局配置目录里没有 `---js` / `---javascript` 文件头 | 2026-11-13 本机 `ls`、`grep -rlE '^---(js\|javascript\|coffee)'` [命令] |
| F-22 | **md 文件头在解析时执行代码。** 引擎的 md 解析器把整段内容交给 gray-matter 4.0.3(`config/markdown.ts:10`),文件头第一行写 `---javascript` / `---js` 时用 `eval` 求值(`node_modules/gray-matter/lib/engines.js:36-43`,别名见 `lib/engine.js`),早于任何字段过滤与插件拒绝。三个调用方:agent(`agent.ts:151`)、命令(`command.ts:170`)、技能(`skill-file.ts:39`,经 `skill.ts:128`)。Code Puppy 显式层给每个项目加了 `./.codepuppy/skills`(`codepuppy-config-injection.ts:103`),项目 `.codepuppy/skills/*/SKILL.md` 走的也是这个解析器。Code Puppy 自己读 md 的模块(`agent-md-entry.ts:20-53` 等)是手写的标量解析,不经 gray-matter | R1 内存探针 `ConfigMarkdown.parseOption` 打出执行标记 [实测];调用方与可达路径 [读码];R2 未发现其他会执行的 md 读取方 |
| F-23 | **归一化按条目整条丢弃。** 条目里任何一个字段不过校验,整条 agent / 命令被丢(`config/normalize.ts:670-688`);例如 `model` 值无效的 agent 连 `system` 一起丢 | R1 内存探针 [实测];[读码] |
| F-24 | **归一化与目录约定会隐含生成控制字段。** v1 顶层 `mode.<名字>` 的条目被加上 `mode: "primary"`(`normalize.ts:152-154`);`mode/`、`modes/` 目录里的 md agent 同样被加上(`agent.ts:183`)。只在校验前拿掉控制字段,已有的 subagent 仍会因此变成主 agent | R2 第 2 条归一化探针 [实测];[读码] |
| F-25 | **移除指令会停用读取点自己。** 任何文档的 `plugins: ["-opencode.config.skill"]` 之类会让该内置插件不激活(`plugin/supervisor.ts:36-40`,只有 F-10 的两个受保护) | R2 第 3 条 [读码] |
| F-26 | `.claude/` 与 `.agents/` 的兼容技能读取(`config/plugin/compatibility.ts:51-54`)在 Code Puppy 里不可达 | spike §8 [实测] |

没有未结的承重问题。

## 4. 接口契约

**机制(一句话)**:引擎照旧自己发现、解析、归一化、热重载项目的 `opencode.json(c)` 与 `.opencode/`。Code Puppy 按这个目录的 `#1709` 信任决定,在引擎配置装载(F-03)与 agent / 命令 / 技能的 md 读取点(F-22)上把关。未允许时,项目内容只交出不运行程序、不加载代码、不换掉所用程序、不放宽 agent 权限或换模型的部分;md 文件头只按 YAML / JSON 解析;控制字段在校验前后都拿掉。读普通内容照 OpenCode 原样,不设闸。

### 契约 A —— 闸门的作用点与判定

- **A1 作用点**都在引擎进程里、按 Location 运行,都调用同一个 Code Puppy 自有模块:
  1. 配置装载(`config.ts` 的 `load()`,`:275-374`):项目 JSON 文档与 `.opencode/` 目录条目(A4)。
  2. 技能读取(`config/plugin/skill.ts`):来自项目内容的技能文件,只做 A5。
  3. agent 读取(`config/plugin/agent.ts`):项目 `.opencode/{agent,agents,mode,modes}/*.md`,做 A5、A6。
  4. 命令读取与执行(`config/plugin/command.ts`,已接管):项目 `.opencode/command(s)/**/*.md` 做 A5、A6;来自项目内容的命令做 A7。
- **A2 项目内容**包括:
  - 本 Location 的向上遍历(F-05)找到的 `opencode.json(c)` 文档与 `.opencode/` 目录。父目录(realpath)恰好是用户主目录的那几项除外:`~/opencode.json(c)`、`~/.opencode/` 属于用户全局,照旧装载。
  - 项目文档 `skills` 里写的技能目录。
  - 位于打开的文件夹之内的技能目录,包括 Code Puppy 显式层的 `./.codepuppy/skills`(F-22)。

  引擎全局配置目录、显式文件、内联注入里指向文件夹之外的东西属于用户全局,闸门不碰。打开的文件夹在主目录之外时,遍历找到的每一项都是项目内容。
- **A3 信任**:每次配置装载(首次与每次 reload)调用一次已安装的 `trusted(realpath(location.directory))`(契约 C);同一代里所有作用点用这同一个值。调用抛错 ⇒ 按未允许处理,并记一行日志。
- **A4 配置装载,未允许时**:
  - **校验前拿掉(R1 F5)**:项目 JSON 文档交给上游归一化之前,在原始文档上只留契约 B「未允许」列为「生效」的顶层键与条目字段。其余拿掉,记进视图(只记名字,不记值)。
    - v1 / v2 两种写法都按名字认:顶层 `agent` / `agents` / `mode`、`command` / `commands`;条目字段见契约 B。
    - 这样同一条目里的内容字段不会因暂缓字段校验失败而整条丢失(F-23)。
    - 允许名单之外的键一律拿掉,所以上游新增的写法默认暂缓。
  - **校验后再拿一次(R2 第 2 条)**:剩下的部分照常交上游归一化与解码;解码后,再从这些文档的 agent 条目上拿掉契约 B 的 agent 控制字段。这一步专门拿掉归一化按名字空间隐含生成的 `mode: "primary"`(F-24),记进视图,归在「Agent 的权限与模型设置」。
  - **`{env:}` / `{file:}` 替换**照 OpenCode 原样(F-12)。它只是读内容;控制字段已在校验前拿掉,替换出来的值不会进入它们。
  - **`.opencode/` 目录条目**保留,技能、命令、agent 的 md 照旧由引擎读取并热重载。同时在本 Location 的条目里、紧接托管策略之后,插入一份闸门文档:对每个项目 `.opencode` 目录 `<d>` 写两条 `{ action: "plugin.use", resource: "<d>/plugin/*", effect: "deny" }` 与 `"<d>/plugins/*"`。
    - 执行者是引擎自己的插件装载判定(F-09)。
    - 这份文档比除托管策略外的所有文档先装载,没有文档能盖过它。
    - 路径里若含 `*` / `?`,只会匹配得更宽,不会漏。
- **A5 文件头,未允许时(R1 F1)**:来自项目内容的 md(agent、命令、技能,含 `.codepuppy/skills`),在交给上游解码器之前由闸门先解析文件头。解析方式在解析之前选定:
  - 只认 YAML 与 JSON:gray-matter 的 JS 引擎换成一个不执行、只记录的引擎;其余未注册的语言本来就不解析。
  - 同样保留上游的 `sanitize` 回退(`config/markdown.ts:26-40`),对同一份 YAML,未允许与已允许读出同样的数据。
  - 声明了其他语言(如 `---javascript`)的文件头不执行,记作暂缓;正文仍作为文字生效。
  - 上游解码器收到的是闸门重新写成的 YAML / JSON 文件头加原正文,选不到任何执行引擎。
  - 已允许时,文件原样交给上游解析器,JS 文件头照旧可用。
- **A6 md agent 与命令的控制字段,未允许时**:
  - 文件头按契约 B 只留内容字段,控制字段在上游校验之前拿掉。
  - md agent 解码后,再拿掉 `mode/`、`modes/` 目录约定隐含生成的 `mode: "primary"`(F-24)。
  - 都记进视图。
- **A7 命令插值**:来自项目内容的命令,在未允许时不做 `` !`…` `` 插值,模板原文发出(F-08)。
- **A8 已允许时**:项目内容原样交给引擎。唯一改写:项目文档 `plugins` 里的移除指令 `-*` 与 `-opencode.<id>` 去掉(契约 B「从不」一行),并记一行日志;其余移除指令照常。
- **A9 读取不设闸**:
  - AGENTS.md 的发现与读取、配置的 `instructions`(含网址)、技能目录的扫描,都照 OpenCode 原样,跟随链接、展开通配;模型读文件时附带的附近 AGENTS.md 也一样。
  - 闸门不读、不改用户全局层、显式层、内联注入层与托管层。
- **A10 未安装闸门**(上游 CLI、上游包自己的测试)⇒ 所有作用点都不作用,行为与上游一致。Code Puppy 唯一的引擎入口必装(契约 C)。

### 契约 B —— 逐键分类

**冻结的承诺**:未允许的项目,它带来的任何东西都不运行程序、不加载代码、不换掉所用的程序、不放宽 agent 的权限或换它的模型。读普通内容不设闸。

**判据**:
- **未允许也生效**:说明类内容,以及只调阈值或显示的设置。
- **允许后生效**:
  - 承诺所列的四类;
  - 会把对话或数据发往项目指定去处、会花钱、会改写撤销或工作树位置的设置;
  - 允许名单之外的一切。
- **从不**:只收实测会让 Code Puppy 本身用不了的一项。

| 项目里的键 / 发现 | 未允许 | 允许后 | 依据 |
| --- | --- | --- | --- |
| AGENTS.md(文件夹、上级目录;`~/AGENTS.md` 属用户全局) | 生效,照 OpenCode 原样读取 | 生效 | 编排器转达的 owner 要求;A9 |
| `$schema` | 生效 | 生效 | 元数据 |
| agent 内容字段:v2 `system`、`description`、`color`、`hidden`;v1 `prompt`、`description`、`color`、`hidden`;md 正文与这些文件头字段 | 生效 | 生效 | 说明类内容 |
| agent 控制字段:v2 `permissions`、`model`、`request`、`mode`、`steps`、`disabled`;v1 `permission`、`tools`、`model`、`variant`、`temperature`、`top_p`、`options`、`mode`、`steps`、`maxSteps`、`disable`。文档与 md 文件头都算,也包括 `mode` 名字空间与 `mode/`、`modes/` 目录隐含生成的 `mode: "primary"` | 暂缓,校验前后都拿掉 | 生效 | 放宽权限、换模型、往模型请求里并请求头 / 体(`agent.ts:91-94`)、改模型参数与自主步数、把 subagent 变成主 agent;与 `.codepuppy` 控制字段同一口径(`AGENT_CONTROL_FIELDS`,`#1693`);F-23、F-24;真实样本 F-20 |
| 命令内容字段:`template`、`description`(含 `.opencode/command(s)/**/*.md` 的正文与 `description`) | 生效;`` !`…` `` 不执行,原文发出 | 生效,插值执行 | F-08;spike §3 user |
| 命令控制字段:`agent`、`model`、`subagent`、`subtask` | 暂缓,校验前拿掉 | 生效 | 选择运行的 agent / 模型 / 委派;F-23 |
| 与出厂同名的命令(`init`、`review`) | 以文字顶替 | 顶替,含插值 | OpenCode 原有能力;文字是内容 |
| md 文件头声明的非 YAML / JSON 语言(`---javascript`、`---js` 等;agent、命令、技能,含 `.codepuppy/skills`) | 文件头暂缓(不解析、不执行),正文作文字生效 | 生效(原样) | F-22 |
| 技能:`.opencode/{skill,skills}/`、`.codepuppy/skills/`、`skills`(路径或网址) | 生效,照 OpenCode 原样读取(文件头经 A5) | 生效 | 内容;A9 |
| `instructions`(路径、通配、网址) | 生效,照 OpenCode 原样读取 | 生效 | 内容;A9 |
| `{env:…}`、`{file:…}` 替换 | 照 OpenCode 原样替换;控制字段已在校验前拿掉 | 照原样 | F-12;A4 |
| `mcp`(本地与远程) | 暂缓 | 生效 | 本地打开即启动(spike [实测]);远程把工具调用发往项目指定地址 |
| `formatter` | 暂缓 | 生效 | 写文件后运行项目命令;写了这个键就打开内置格式化器,`pint` 运行项目里的 `./vendor/bin/pint`(spike [实测];`formatter/builtins.ts:223-230`) |
| `lsp` | 暂缓 | 生效 | 今天不运行(spike [实测] 时点 d);上游接上运行时就会运行程序 |
| `shell` | 暂缓 | 生效 | 换掉模型 shell、输入框 shell、终端用的可执行文件(spike [实测]) |
| `plugins`:新增条目(路径、包名、`file://`) | 暂缓 | 生效 | 在引擎进程里执行代码 |
| `plugins`:重新声明用户全局插件并带 `options` | 暂缓 | 生效 | 项目的 options 生效(spike [实测]) |
| `plugins`:移除指令 `-<id>`(`id` 不是 `*`、不以 `opencode.` 开头) | 暂缓 | 生效 | 停掉用户全局插件 |
| `plugins`:移除指令 `-*`、`-opencode.<id>` | 暂缓 | **从不** | 实测:内置插件与 provider 节点被停,会话起不来;`-opencode.config.agent` 让注入的 agent 消失,会话报「找不到 agent」(spike §2)。上游对两个内置插件做同样的保护(F-10) |
| `.opencode/{plugin,plugins}/` | 暂缓(A4 闸门策略) | 生效 | 同「新增条目」 |
| `.opencode/opencode.json(c)` | 按本表逐键 | 按本表逐键 | — |
| `providers` / `provider`(含节点级 / 模型级 `package`、`options`) | 暂缓 | 生效 | 模型级 `package` 第一轮 import 项目 JS(spike [实测]);允许后照旧受现有治理:新节点被注入的 `provider.use` 拒,节点级 `package` 被注入层盖过(spike [实测]) |
| `model`、`default_agent` | 暂缓 | 生效 | 换模型、换默认 agent(权限) |
| `permissions` / `permission`、`policies` | 暂缓 | 生效 | 放宽权限;允许后仍盖不过 Code Puppy 显式层的策略与执行闸的尾部规则(F-16) |
| `references` / `reference` | 暂缓 | 生效 | clone 仓库会运行 git(真实样本 F-20) |
| `share`、`enterprise` | 暂缓 | 生效 | 把对话发往分享服务 |
| `websearch` | 暂缓 | 生效 | 决定搜索请求发往谁 |
| `worktree` | 暂缓 | 生效 | 新工作树写到项目指定的目录 |
| `warming` | 暂缓 | 生效 | 定时发模型请求(花费) |
| `snapshots` | 暂缓 | 生效 | 关掉会让撤销不可用 |
| `update` | 暂缓 | 生效 | 引擎更新行为 |
| `experimental`(全部子键,含已弃用的 `experimental.policies`) | 暂缓 | 生效 | 实验开关(ADR-048:上游实验默认关);项目打开等同用户在全局配置里打开 |
| `compaction`、`tool_output`、`media`、`watcher`、`timezone`、`username` | 生效 | 生效 | 只调阈值或显示 |
| 允许名单之外的任何键或字段(含上游升级新增、只有 v1 写法认得的) | 暂缓(视图里记作「其他 OpenCode 设置」) | 生效 | 未分类默认暂缓;升级时由 §6 的升级检查要求补分类 |
| 引擎认不出的键 | 不生效 | 不生效 | 引擎解码时丢弃(F-11),与信任无关 |
| `.claude/`、`.agents/` 兼容目录;`CLAUDE.md`、`.cursorrules` | 不生效 | 不生效 | 兼容读取不可达(F-26);引擎只认 AGENTS.md(spike §8 [实测])。本设计不改 |

### 契约 C —— 信任钩子(sidecar → 引擎入口 → 闸门)

```ts
// packages/ui-mac/engine/engine-embed.ts(Code Puppy 自有)
export async function startEngine(
  options: EngineServerOptions,
  hooks: {
    onDispatch?: (dispatch: EmbeddedEngine["dispatch"]) => void
    /**
     * 必填。回答「用户是否对这个项目文件夹点过允许」。实现 = #1709 的同一个读法:
     * projectDirectoryIdentity(directory) 为 project 且 readProjectExtensionsConsent(...) === true ⇒ true;
     * 其余(非 project、null、false、抛错)⇒ false。不另写第二个读法。
     */
    projectTrust: (directory: string) => boolean
  },
): Promise<EmbeddedEngine>

// packages/core/src/config/codepuppy-project-gate.ts(Code Puppy 自有文件,ADR-043 命名谓词)
export function install(input: { readonly trusted: (directory: string) => boolean }): void
```

- `startEngine` 在调用上游 `start()` 之前 `install`;`projectTrust` 缺失 ⇒ `startEngine` 抛错 ⇒ sidecar 走既有的失败路径,不报 ready(`sidecar.ts:204-206`)。
- 信任读法读的文件、身份规则、版本语义全部沿用 `#1709`(F-17),本设计不改记录的位置、形状与告知版本。
- 闸门模块里供四个作用点调用的过滤、文件头解析、拿字段函数是模块私有实现,形状由实现定;只冻结 A 与 B 的行为。

### 契约 D —— 项目配置视图与主进程 ↔ sidecar 消息

```ts
// packages/schema/src/codepuppy-project-config.ts(Code Puppy 自有,纯模块,零依赖;闸门、sidecar、主进程共用,先例 codepuppy-tool-policy.ts)
export const WITHHELD_KINDS = [
  "mcp",              // mcp 条目
  "plugin",           // plugins 新增 / options / 移除,.opencode/{plugin,plugins}/ 里的目标
  "agent-control",    // agent 控制字段(含隐含生成的 mode: primary)
  "command-run",      // 带 !`…` 的命令,或写了 agent / model / subagent / subtask 的命令
  "frontmatter-code", // 声明了非 YAML / JSON 语言的 md 文件头
  "formatter",
  "shell",
  "provider",
  "setting",          // 其余暂缓的键:lsp、references、share、websearch……与允许名单之外的键
] as const
export type WithheldKind = (typeof WITHHELD_KINDS)[number]
export type WithheldItem = {
  kind: WithheldKind
  /** MCP / 格式化程序 / provider 名、命令名(不带 /)、agent 名、插件目标、shell 路径、文件路径、键名。从不放配置值。 */
  name: string
  /** 出处文件,相对于打开的文件夹;上级目录里的写成 ../… */
  file: string
  /** 只用于 agent-control 与 command-run:被暂缓的字段名;插值记作 "shell"。 */
  fields?: string[]
}
/** 一个作用点在本代配置下的状态。没有出现 = 这个作用点在本 Location 不适用(它的插件没有激活)。 */
export type GatePointState = "done" | "failed" | "pending"
export type ProjectConfigView = {
  /** realpath 后的项目文件夹(信任记录的键)。 */
  directory: string
  trusted: boolean
  /** 本代配置下已激活的作用点及其状态;配置装载一定在内。 */
  points: Partial<Record<"config" | "skill" | "agent" | "command", GatePointState>>
  /** 插件激活已经结束,且 points 里每一项都是 "done" ⇒ true。 */
  complete: boolean
  /** 未允许时被暂缓的条目,按 kind、file、name 排序去重;trusted 时为 []。 */
  withheld: WithheldItem[]
}

// packages/ui-mac/src/main/ 下一份 build/parse 成对的消息文件(形制同 workspace-write-probe.ts;parse 一律 fail-closed)
type ProjectConfigViewRequest = { type: "project-config-view"; id: string; directory: string }
type ProjectConfigViewReply =
  | { type: "project-config-view-reply"; id: string; ok: true; view: ProjectConfigView }
  | { type: "project-config-view-reply"; id: string; ok: false; reason: "engine-not-ready" | "location-failed" }
```

- **产出方**:
  - 每个作用点在本代配置下第一次运行时登记 `pending`,跑完改成 `done`,出错改成 `failed`。
  - 被移除指令停用的作用点(F-25)根本不激活,因此不登记,视为「不适用、已完成」。
  - sidecar(`sidecar.ts` 的命令族,与 `write-probe` 同处)收到请求后,经进程内 fetch 对该目录发出列出命令、agent、技能的请求。这几个请求要等该 Location 的插件激活结束才返回。之后有界等待仍为 `pending` 的作用点,到时仍未完成就按 `pending` 交出,再读视图作答。
- **消费方**是 `ext-trust-check`(`ext-ipc.ts`)。清单 = `.codepuppy` 的可执行物(`listProjectExecutables`,不变)+ `view.withheld`。两者都空 ⇒ 不弹框;已有决定 ⇒ 不弹框(不变)。
- **不完整的清单不产生决定(R1 F4、R2 第 3 条)**:
  - 视图拿不到(应答超时、`ok: false`、解析失败),或 `complete: false`(某个已激活的作用点 `failed` 或超时 `pending`)时,`ext-trust-check` 在同一次检查里有界地重试。
  - 仍拿不到 ⇒ **不弹框、不写记录**,即使 `.codepuppy` 有可执行物也一样,并记一行。
  - 这次检查不算「已问过」:renderer 下一次进入这个文件夹的会话时再问(放宽 F-18 的「只问一次」)。
  - 这期间项目的可执行内容照旧暂缓。
  - 正常情况下视图第一次就完整,用户只看到一次确认框。
- **决定的写入**沿用 `#1709` 唯一写入点与记录形状;告知版本**不升**:信任只回答「这个文件夹你是否点过允许」,已有的允许同时覆盖 OpenCode 配置(owner 2026-11-13「我的没有租户就我一个用户…」)。

### 契约 E —— 确认框清单(行模板;文案终稿 owner 定)

现有的标题、提问、说明文字与两个按钮(`ext-ipc.ts` 当前分支 `:598-608`)不变;清单每一类一行,同一类多个条目用顿号接在一行里,条目很多时的折叠由实现照现有框的长度定。

| kind | 行(提议) | 现有 / 新增 |
| --- | --- | --- |
| `mcp` | `· 连接器(MCP):<名字>` | 现有 |
| `plugin` | `· 插件:<路径>` | 现有 |
| `agent-control` | `· Agent 的权限与模型设置:<名字>(<字段>)` | 现有 |
| `command-run` | `· 命令的运行设置:/<命令名>(<字段>)`(`` !`…` `` 记作 shell) | 新增 |
| `frontmatter-code` | `· 文件开头的脚本:<文件>` | 新增 |
| `formatter` | `· 写文件后自动运行的格式化程序:<名字>` | 新增 |
| `shell` | `· 终端与 shell 使用的程序:<路径>` | 新增 |
| `provider` | `· 模型的接入设置:<名字>` | 新增 |
| `setting` | `· 其他 OpenCode 设置:<键名>` | 新增 |

括号里的字段用中文叫法显示:agent 字段 `permissions` / `permission` / `tools` → 权限,`model` / `variant` / `temperature` / `top_p` / `options` / `request` → 模型,`mode` → 模式,`steps` / `maxSteps` → 步数,`disabled` / `disable` → 停用;命令字段 `` !`…` `` → 运行程序,`agent` → 指定 Agent,`model` → 模型,`subagent` / `subtask` → 子任务。现有那一行今天显示原始字段名,一并改成中文叫法。完整样子见 spec「体验约定」。

除这个框以外不新增任何界面提示;暂缓情况只进日志(目录、类别、计数,不记配置值)。

### 层序(同一个键由谁说了算)

- **设置类**(后者盖前者):
  1. 引擎全局配置目录
  2. 显式文件(`codepuppy.jsonc` + Code Puppy 显式层)
  3. 遍历文档,从根到打开的文件夹(`~/opencode.json(c)` 属用户全局,不经闸门;其下各级经闸门)
  4. `.opencode/` 文档(`~/.opencode/` 用户全局;其余经闸门)
  5. Code Puppy 内联注入
  6. 托管设置

  与今天相同;闸门只改项目内容交出多少,不改顺序。
- **策略类**(最早装载者胜):托管策略 → 闸门文档(只在未允许时有)→ 引擎全局配置目录 → 显式层 → 项目 → 内联。已允许项目的策略盖不过 Code Puppy 显式层的策略(F-16)。
- **`.codepuppy/codepuppy.jsonc` 与项目 `opencode.json` 同名时**(前者由 ext 经插件接口合并):
  - MCP:文档先写,ext 只补缺;
  - agent 与命令:文档在 ext 之后注册。

  两种情况都是 `opencode.json` 的那条生效(激活顺序见 `engine-transforms.ts:8-16`)。两者受同一个信任决定管,不改。
- **`plugin.use`**:`#1708` 在显式层写的「先拒绝全部、再按精确路径放行」退役(§10 R-07);用户自己文件里写的 `plugin.use` 由引擎照常执行。

### API
没有新的 HTTP 接口。主进程与 sidecar 之间新增契约 D 的一对消息。

### 数据
没有新的持久数据。信任记录沿用 `#1709`,位置、形状、告知版本都不变。

### 事件 / 配置
不新增配置键。

## 5. 数据与失败
- **生效时机**:允许后走既有链路生效:
  1. renderer 请 ext 重载;
  2. 调度器等全部会话空闲(或用户在定制中心强制);
  3. `location/reload` 重建所有 Location;
  4. 闸门重新读信任(F-18)。

  撤销今天只有记录层(没有界面),走同一链路,下一次重载生效。已经 import 进引擎进程的插件代码留下的副作用,要到 sidecar 重启才消失。
- **热重载**:项目配置文件在盘上改动 ⇒ 引擎对该 Location 的配置 reload(既有监听,`config.ts:376-424`)⇒ 闸门按当时的信任再判一次。
  - 已允许:新内容立刻生效,不再询问。
  - 未允许:新的可执行内容继续暂缓。
  - 没做过决定的项目,要到下一次进入它的会话才弹框。
- **多项目**:每个 Location 各读各的信任、各有各的条目与视图,互不影响(AC-07)。例外:已允许项目加载的插件运行在整个引擎进程里,能影响别的 Location(`#1709`「信任就是允许运行代码」)。
- **读不到信任 / 身份对不上 / 钩子抛错** ⇒ 未允许(fail-closed),记一行。**钩子没装** ⇒ `startEngine` 抛错,sidecar 不报 ready。
- **项目配置写坏**:
  - JSONC 错,或剩余部分 schema 不过 ⇒ 引擎拒掉那份文档(F-11),不生效、不列入清单,已允许与否都一样。
  - md 的 YAML 文件头连 `sanitize` 回退也解不出 ⇒ 该文件跳过,与上游对同一文件的处理相同。
- **认不出的键**:引擎层面认不出的键本来就被丢弃。允许名单之外的键,未允许时在校验前拿掉并列为「其他 OpenCode 设置」,已允许时交给引擎。不存在「未允许时静默生效」。
- **部分生效**:按字段生效是本设计的语义。agent 的提示词生效、控制字段暂缓,与 `.codepuppy` 一致;暂缓字段在校验前拿掉,不连累同条目的内容字段(F-23)。可执行条目整条进或整条不进。
- **插件拒绝没有时间窗**:闸门策略用目录通配,不随文件增减重算。
- **视图拿不到或不完整**:见契约 D,不弹框、不写记录,可执行内容照旧暂缓。作用点被用户停用 ≠ 不完整。

## 6. 架构落点

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| 闸门判定、契约 B 分类、只认 YAML/JSON 的文件头解析、视图记录 | `packages/core/`(`modules.md:26`)的 Code Puppy 自有文件 `config/codepuppy-project-gate.ts` | core 内部;已有依赖 gray-matter | 上游解析与归一化(`config.ts:136-166`、`normalize.ts`)、md 的 `sanitize` 回退(`markdown.ts:26-40`)、插件装载判定(`plugin/module.ts:53`) |
| `load()` 调闸门 | `packages/core/src/config.ts`(**新接管**) | 同上 | 上游装载、热重载原样 |
| 技能文件头经闸门解析 | `packages/core/src/config/plugin/skill.ts`(**新接管**) | 闸门 | 上游扫描与 `SkillFile.parse` 原样 |
| md agent 文件头经闸门解析、解码后拿掉控制字段 | `packages/core/src/config/plugin/agent.ts`(**新接管**) | 闸门 | 上游 md agent 解码原样(`agent.ts:147-186`) |
| md 命令文件头经闸门解析、不插值 | `packages/core/src/config/plugin/command.ts`(已接管) | 闸门 | 上游命令解码原样 |
| 视图形状 | `packages/schema/`(`modules.md:41`)的 `codepuppy-project-config.ts` | 无 | 先例 `packages/schema/src/codepuppy-tool-policy.ts` |
| 信任钩子 | `packages/ui-mac/engine/engine-embed.ts` | `@opencode/core` | `#1709` 读法 |
| 视图消息、确认框清单、renderer 重问 | `packages/ui-mac/src/main/`(`modules.md:51`):sidecar 命令族、`ext-ipc.ts`;renderer `ext-trust-watcher.tsx` | schema 视图模块 | `#1709` 的确认框、写入点与记录;进程内 fetch(`in-process-engine.ts`) |
| 退役 `#1708` 的显式层 deny-all(若它先合入) | `packages/ui-mac/src/main/` | — | — |

- **冻结的边界**:
  - **保证**:未允许的项目,它带来的任何东西都不运行程序、不加载代码、不换掉所用的程序、不放宽 agent 的权限或换它的模型。
  - **不保证**:读普通内容不设闸。在用户点允许之前,一个项目就能让模型看到它文件夹以外的文件内容(经符号链接、`instructions` 的路径与通配、`{env:}` / `{file:}` 引用、模型读文件时附带的附近 AGENTS.md;F-13、F-12)。
- **新目录 / 新模块**:无新目录。两个 Code Puppy 自有文件住在上游包里,按 ADR-043 用 `codepuppy-` 前缀;`modules.md` 无需新增行。
- **接管面**:需要一条新 ADR(CLAUDE.md「新增收编须自己的 ADR」),随实现 PR 提交,内容即本节。每处改动都只是在装载或读取点调用闸门,全部放在 `codepuppy(<ADR>) ──` 标注块内(`DESIGN-upgrade-fewer-takeovers` 契约 D)。收窄承诺后剩下三个新接管:

  | 文件 | 为什么还必须接管 | 改动面 | 上游升级要复核 |
  | --- | --- | --- | --- |
  | `packages/core/src/config.ts` | 每个消费方拿项目配置的唯一汇合点(F-03)。上游给的只有全局开关 `project`(F-02),插件接口没有配置编辑器(F-14),托管策略忽略不了单个键(F-15) | `load()` 里读信任;未允许时在原始文档上于校验前拿掉暂缓键,解码后拿掉隐含的 agent 控制字段;插入闸门文档;已允许时去掉 `-*` / `-opencode.*` | `load()` 返回的分类与顺序;`discover()` 的遍历与全局根排除(`discovery.ts:78-81`、`:121-126`);归一化认的 v1 写法与隐含字段(`normalize.ts:152`);条目种类是否新增 |
  | `packages/core/src/config/plugin/skill.ts` | 技能文件只在这里读取并交给 `SkillFile.parse`,后者再调 gray-matter(F-22);`skill-file.ts` 与 `markdown.ts` 只拿得到内容、拿不到 Location 与来源。为 R1 F1 保留,不为读取 | 读取点(`:126-128`)对来自项目内容的文件,改由闸门先解析文件头 | 扫描与读取点 |
  | `packages/core/src/config/plugin/agent.ts` | md agent 只在这里读取与解码,解码函数未导出(F-07);`mode/` 目录隐含的 `mode: "primary"` 也在这里生成(F-24)。不接管就只能抄一份解码(K2) | 读取点(`:47`)经闸门;解码后(`:183`)拿掉控制字段 | md 的目录约定与字段集(`agentKeys`、`nativeKeys`) |

  - `command.ts` 已接管,新增的行同样放进标注块。
  - `instruction.ts` 退出接管面:它只读普通内容(AGENTS.md、`instructions`),收窄后不设闸。
- **为什么不把文件头闸门放在共用解析器 `markdown.ts`**:它只收内容、不收路径(`markdown.ts:4`、`:16`)。要在那里按来源选解析方式,得改三个调用方的签名,还要多接管 `skill-file.ts`;读取点已经有路径与 Location。
- **升级检查(ADR-048 决定 4)**:在 Code Puppy 权威登记册(`docs/architecture/codepuppy-authority-registry.json`)加一条「项目 OpenCode 配置按信任放行」。守它的检查必须能在下列任一情况下变红:
  - `Info`、`ConfigAgent.Info`、`ConfigCommand.Info` 及其 v1 schema 出现契约 B 没分类的字段;
  - 归一化或目录约定新增隐含生成的控制字段;
  - core 里 `.opencode` 目录条目的消费方多于 F-06 的 5 个;
  - `ConfigMarkdown.parse(Option)` 的调用方多于 F-22 的 3 个;
  - 拿掉闸门后,spike 的「已知的坏」与 R1 的 JS 文件头、`{env:}` 丢条目探针,以及 R2 的 `mode` 名字空间探针重新出现(反向臂)。
- **上游挂点需求**:两个钩子若被上游接受,三处新接管可退回插件层:「按 Location 过滤配置文档」与「按来源选 md 解析方式」。加进 `DESIGN-upgrade-fewer-takeovers` §10 R-11 的清单,不在本期做。
- **架构约束**:
  - **K2 更好**:分类只在闸门一处;主进程消费引擎算出的视图,不重解析项目文件;信任只有 `#1709` 一个读法;md 仍由上游解码器解码。
  - 允许名单按名字认 v1 / v2 两种写法,只是名字,不重做归一化;漏认的后果是内容延后到允许后,不是放行。没有新增 K2 偏离。
  - K1 不变。
  - ADR-040:安装路径的封死不变;后果 4 改为「项目来源的目录插件在信任闸门之后」,由实现 PR 改写该条。ADR-024 不涉及。
  - **北极星**:接管清单加三条,owner 已决定实施(「要做。」);ADR 记录先例 `#1666`(owner 2026-11-12「同意，多接管两个上游文件，需要再唯一权威中记录多接管的内容。」)。
- **工程标准**:不新增配置项;信任与视图形状各一个所有者;视图与日志只记目录、类别、名字与计数,不记配置值(替换后可能含密钥)。
- **被否决的替代**(各一条理由):
  - 整体 `project: false`、不补回:丢掉 AGENTS.md、`.opencode` 的技能 / 命令 / agent 与 `~/.opencode`(F-02 实测),与 owner 原话相反。
  - 引擎继续读、只靠托管策略与注入逐键中和:策略动作忽略不了键,注入盖不住项目 MCP、命令、`instructions`、`plugins`(F-15),也管不到解析时执行的文件头(F-22)。
  - `project: false` + ext 按信任补回:插件接口给不了技能目录、插值、命令的 agent/model/subtask,也没有 formatter / lsp / instructions 的挂点(F-14)。
  - 接管 `routes.ts:143` 再 `project: false`:只救回 AGENTS.md,其余同上。
  - 未允许时整个 `.opencode/` 不交给引擎,由 Code Puppy 抄一份 md 解码:要手写 `agent.ts:134-186` 的替身(K2)。
  - 文件头闸门放在 `markdown.ts`:见上。
  - 对所有来源关掉 JS 文件头:已允许的项目会失去今天有的能力。
  - 读取界检查(R1 F2 / F3 的做法:展开后查真实路径、链接目标查界、按上级目录分界):要再接管 `instruction.ts`、`session/instructions.ts` 等每一条读取链(R2 第 1 条又找到一条)。编排器按 owner「不要做笼子」裁决收窄承诺,不做(§10 R-10)。
  - 未允许时不做 `{env:}` / `{file:}` 替换:它只防读内容,收窄后不属承诺;不替换还会让内容字段里留下字面占位。
  - 主进程自己解析项目文件来生成清单:要重写上游的归一化与文件头读法(K2)。
  - 保留 `#1708` 的「先拒绝全部」再按路径放行已允许项目:与闸门重复成两套机制。
  - 第二个只给未允许项目用的引擎实例:同一个数据库两个写入者。
- **安全面**:
  - **威胁边界**:打开的文件夹及其上级目录(主目录这一级除外)里的文件,在 `#1709` 记录里出现「允许」之前,都不能让引擎运行它们指定的东西。
  - **不变量**:
    - **I-1** 未允许时,项目内容不能让引擎派生进程、import 或求值代码(含 md 文件头)、换掉所用可执行文件、给 agent 追加权限规则或换模型。
    - **I-2** 已允许时,项目内容原样到达引擎,只有「移除引擎内置插件」不生效。
    - **I-3** 信任只来自 `#1709` 记录(macOS 上引擎写不进)。
    - **I-4** 用户全局层、显式层、内联层不受闸门影响。
    - **I-5** 同一代配置里一个 Location 只用一个信任值。
    - **I-6** 不完整的清单不产生决定;被停用的作用点不算不完整。
  - **边界外**:
    - 读普通内容(见上面「冻结的边界」);
    - 已允许项目自己的代码做什么;
    - 围栏可写范围(I-13,见 §9);
    - Windows 无围栏;
    - 用户全局配置打开 formatter 时内置格式化器的行为(§10 留档)。

## 8. 拆分决定
不适用:全部在 alpha-code 一个仓库、一个所有者内完成。

## 9. 回滚
- **代码层回退即可**:没有数据迁移,信任记录的位置、形状、告知版本都不变,回退后记录照旧被 `.codepuppy` 的门使用。回退的后果是回到今天:未允许的项目又能让引擎运行它指定的程序(F-01),在解析 md 时执行代码(F-22)。
- **闸门本身出问题、需要先止血时**:在 `engine-server-options.ts:49-53` 写 `project: false`(spike 实测十条「已知的坏」全部消失)。
  - 代价:F-02 那些内容类能力一起丢,直到修好。
  - `project: false` 不覆盖 `.codepuppy/skills` 的文件头(F-22),那一条只能靠闸门本身。
- **回滚与本设计都不改变的遗留**(一行):进程围栏允许写 `<codepuppy-state>/env/<env>/codepuppy.jsonc` 与 `~/.opencode/plugins/`(INT-safety I-13),已允许项目的代码或获批的写文件能借此写进用户全局层,并在每个项目生效。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| R-01 引擎照旧读项目配置,Code Puppy 在配置装载与 md 读取点按项目信任过滤;不用 `project: false`,不由 Code Puppy 重读重注入 | F-02、F-03、F-14、F-15、F-22;owner 2026-11-13 原话 |
| R-02 新接管 `config.ts`、`skill.ts`、`agent.ts`,`command.ts` 在已有接管内扩展;owner 已决定实施 | §6 接管面;owner 2026-11-13「要做。」(编排器转达) |
| R-03 未允许时 `.opencode/` 目录条目保留,插件由闸门策略拒;md 由闸门先选解析方式再交上游解码 | F-06、F-07、F-09、F-22 |
| R-04 分类按契约 B,允许名单之外默认暂缓;唯一「从不」= 项目移除引擎内置插件 | spike §2 实测;F-10 上游先例 |
| R-05 一个文件夹一次决定,与 `.codepuppy` 同一条记录、同一个框;告知版本不升;编辑配置不再询问 | owner 2026-11-13 三段原话;`#1709` |
| R-06 确认框清单由引擎算出,经 sidecar 消息交主进程;不完整不产生决定 | K2;F-19;R1 F4 |
| R-07 `#1708` 被取代:owner 在 `#1708` 的「项目自带的引擎插件一律不加载」由 owner 2026-11-13 原话(「opencode 的能力要能被用到」)改为「允许后加载」。退役 `#1708` 显式层的 deny-all 与精确放行名单;未允许项目的插件声明到不了引擎,「按包名借道」随之不存在;用户自己写的 `plugin.use` 照常 | spike §2;`#1708` 提交 `af90e637cc`、`e754d7e9f9` 说明 |
| R-08 用户全局层(含 `~/.opencode/`、`~/opencode.json(c)`、`~/AGENTS.md`)不经闸门 | F-05;编排器派发书 |
| R-09 暂缓字段在原始文档上于校验前拿掉;`{env:}` / `{file:}` 替换照 OpenCode 原样 | F-12、F-23;R2 后的收窄承诺 |
| R-10 **已被收窄的承诺取代**:R1 后的「读取以最终目标真实路径查界」(及更早的「相对且无 `..`、改写成以文件夹为根」)整套撤掉;读普通内容不设闸,剩余风险写进 §6「冻结的边界」 | 编排器裁决 A(owner「不要做笼子」);R2 第 1 条 |
| R-11 未允许时 md 文件头只按 YAML / JSON 解析,解析方式在解析前选定;已允许原样 | F-22;R1 F1 |
| R-12 未允许时解码后再拿一次 agent 控制字段,去掉名字空间与目录约定隐含生成的 `mode: "primary"`,归在「Agent 的权限与模型设置」 | F-24;编排器裁决 B |
| R-13 视图按作用点登记 `pending` / `done` / `failed`;未激活的作用点不登记,算「不适用、已完成」;只有失败或超时算不完整 | F-25;编排器裁决 C |

| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| R1 / `1b6be7ffd3` / 全文 | Codex(GPT-6),会话 01a1d3fe,只读源码 + 三个内存探针;BLOCK | F1 Blocker(md 文件头解析时 `eval`)—— 采纳 | F-22;A5;契约 B 文件头一行;视图 `frontmatter-code` | — |
| 同上 | 同上 | F2 Major(glob 越界)、F3 Major(符号链接)—— 当时采纳为读取界检查 | 787257e259 的 A5 | R2 后由 R-10 撤掉,风险写进 §6 |
| 同上 | 同上 | F4 Major(半张清单授予信任)—— 采纳 | 契约 D 不完整不弹框、不写记录 | — |
| 同上 | 同上 | F5 Major(不替换后整条校验丢内容)—— 采纳 | A4 校验前拿掉暂缓字段 | 「为清单保留替换引用」在 R-09 恢复替换后不再适用,清单只记名字 |
| 同上 | 同上 | 订正:无 VCS 标记时项目根即打开的目录(`project.ts:453`)—— 采纳 | F-13 | — |
| R2 / `787257e259` / 全文(最后一轮) | Codex(GPT-6),会话 01a1d41b,只读 + 归一化探针;FIX-THEN-MERGE。F1、F2 修法成立,F4 / F5 原例已修,允许路径不变,没有更低一层的统一包装(`fs-util.ts:213`) | 第 1 条 Major:模型读文件时附近 AGENTS.md 的读取链(`read.ts:148` → `session/instructions.ts:65`)未纳入界检查 —— 按编排器裁决 A 收窄承诺,读普通内容不设闸;此链归入 §6 剩余风险 | §4 机制、A9、契约 B 读取类各行、§6「冻结的边界」;撤掉 A5 界检查与 `instruction.ts` 接管;删去确认框「读取项目以外的文件或网址」一行与视图 `outside` 类 | 记在 §6 剩余风险,不另开 |
| 同上 | 同上 | 第 2 条 Major:校验前过滤后,归一化仍按 `mode` 名字空间 / `mode(s)/` 目录生成 `mode: "primary"` —— 采纳(裁决 B) | F-24;A4、A6 解码后再拿一次;契约 B agent 控制字段行;R-12 | — |
| 同上 | 同上 | 第 3 条 Major:用户全局停用技能读取插件时 `complete` 永远达不到 —— 采纳(裁决 C) | F-25;契约 D `points` 与状态;I-6;R-13 | — |

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| 用户全局配置打开了 formatter 时,未允许项目里内置格式化器会运行项目内的程序(`pint` 的 `./vendor/bin/pint`)或读项目的配置脚本 | 来源是用户全局设置,不是项目的键;owner 本机全局配置没有 `formatter`(F-21,今天为空集) | 闸门只管项目内容;为空集加规则违背「不要限制太死」 | owner 在全局配置里打开 formatter |
| 注入层给 Code Puppy 自己节点的每个模型显式写 `package` | spike §2 提过的备选;已允许项目本就能在引擎里跑代码,这一格不增加能力 | 不在本期 AC | Code Puppy 模型被项目换掉实现造成可见故障 |
| 已允许项目打开上游实验开关 | ADR-048 让上游实验保持关闭;未实测哪个开关会弄坏 Code Puppy 界面 | owner 要求「从不」只收实测会坏的 | 测出某个实验开关会弄坏界面 |
| 未允许时拿掉 agent 的 `permissions`,写的是 deny 规则时 agent 反而回到默认权限 | 与 `.codepuppy` 未允许时的既有行为相同(REQ-236 P1) | 已批准的既有口径 | 出现依赖项目 deny 规则的真实 agent |
| `#1709` 信任记录在 Windows 上引擎写得进 | `#1709` 已知限制 | 本设计不为 Windows 加代码 | Windows 正式发行前 |
