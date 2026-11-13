---
id: DESIGN-project-engine-config-takeover
title: 项目自带的 OpenCode 配置由 Code Puppy 按项目信任放行 技术设计
summary: 引擎照旧自己读项目 opencode.json 与 .opencode/(解析、归一化、热重载都用上游的);Code Puppy 在引擎配置装载这一个按目录的汇合点上加一道闸门,未允许的项目只交出内容类字段,已允许的原样交出;同一份 #1709 信任记录、同一个确认框,清单由引擎算出后经 sidecar 交给主进程;新增接管 config.ts 与 agent.ts 两个上游文件
kind: tech-design
status: draft
spec: SPEC-project-engine-config-takeover
spec_version: 0
review:
  rounds: 0
  reviewed_sha: ""
  verdict: ""
owners: [owner]
last_reviewed: 2026-11-13
---

# DESIGN-project-engine-config-takeover｜项目 OpenCode 配置按项目信任放行 技术设计

只写决定。文件清单、提交顺序与测试由实现方的 plan.md 写。§3、§7 已退役,编号不复用。

## 1. 基线
- Spec:[SPEC-project-engine-config-takeover v0](spec.md)(草稿,与本稿一起交 owner)。
- 覆盖:AC-01 至 AC-07。
- 背景:owner 2026-11-13 原话(spec「来源」逐字);INT-safety I-12;P-06。代码基线 `origin/alpha` @ `fed47ed022`。
- 依赖的在途分支(都未合入 `origin/alpha`,2026-11-13 用 `git merge-base --is-ancestor` 核过):
  - `#1709` 信任记录(`fix/1709-project-consent-store` @ `bb98467a7d`):本设计直接消费,须先合入。
  - `#1708` 项目引擎插件拒绝(`fix/project-engine-plugin-consent` @ `e754d7e9f9`):被本设计取代,处置见 §10 R-07。
  - `#1698` 启动文档(`feat/1698-bootstrap-config`):本设计不需要新的启动键,不依赖。

## 2. 地面真相

标记:**[实测]** 有探针或命令输出;**[读码]** 读代码得出;**[推断]** 未直接验证。实测来源都是 spike 记录 `docs/architecture/2026-11-13-project-config-command-surface.md` @ `e9635b3071`(下称「spike」)。

| # | 事实 | 依据 |
| --- | --- | --- |
| F-01 | 未允许的项目今天能让引擎运行它指定的程序:本地 MCP 打开即启动;formatter、shell、命令插值在模型写文件 / 跑 shell / 用户敲命令时运行;模型级 `package` 第一轮把项目 JS import 进引擎;`instructions` 把项目外文件原文送进模型请求;项目能改用户全局插件的 options;`plugins: ["-*"]` 停掉内置插件,会话起不来 | spike §2、§3 [实测] |
| F-02 | 引擎选项 `config.project: false` 关掉上面全部,但也关掉项目与上级目录及 `~/AGENTS.md`、`.opencode/{skill(s),commands,agents}`、`~/.opencode/`、`~/opencode.json(c)`;同一个选项同时交给 `Config` 与 `InstructionDiscovery`(`packages/server/src/routes.ts:137`、`:143`);没有更窄的引擎选项 | spike §8 [实测];`packages/server/src/options.ts:34-41` [读码] |
| F-03 | 引擎里每个读项目配置的地方都经 `Config.Service.entries()` 拿条目(agent、command、skill、mcp、formatter、shell、instruction、插件来源、策略、flag 等 22 个模块);条目按 Location(目录)各建一份 | `packages/core/src/config.ts:33-36`、`:117` 起的 `layer`;`grep -rln "\.entries()" packages/core/src` [读码] |
| F-04 | `load()` 的层序(低→高):托管策略 → 集成 → wellknown → 引擎全局配置目录 → 显式文件 → 向上遍历找到的 `opencode.json(c)`(`direct`)→ 遍历找到的 `.opencode/`(文档 + 目录条目)→ 内联注入 → 托管设置 | `packages/core/src/config.ts:363-373` [读码];spike §3 open [实测] |
| F-05 | 向上遍历从打开的目录一直走到根;引擎全局配置目录不会经遍历重复进入;`~/.opencode/` 与 `~/opencode.json(c)` 只经遍历进入 | `packages/core/src/config/discovery.ts:78-81`、`:121-126`;spike §8 [实测] |
| F-06 | `.opencode/` 目录条目的消费方只有 5 个:agent(`agent/agents/mode/modes/*.md`)、command(`command(s)/**/*.md`)、skill(`skill(s)/`)、插件来源(`plugin(s)/`)、条目观察者(只监听) | `packages/core/src/config/plugin/agent.ts:44`、`command.ts:30`、`skill.ts:86`、`source.ts:131`、`entry-observer.ts:77` [读码] |
| F-07 | md 定义的 agent 只在 agent 插件内部被解码成带文件路径的 `Document`,解码函数没有导出 | `packages/core/src/config/plugin/agent.ts:134-186` [读码] |
| F-08 | 命令插值:`` !`cmd` `` 用配置的 shell 执行,不经审批;`command.ts` 已在接管清单 | `packages/core/src/config/plugin/command.ts:184-235`、`:246`;`scripts/north-star-guard.sh` `--print-takeover` 输出含该文件 [读码 + 命令];spike §3 user [实测] |
| F-09 | 插件装载前按 `plugin.use` 策略判定,判定读本 Location 的条目;策略「最早装载的文档胜」;通配符 `*` 跨 `/` 匹配 | `packages/core/src/plugin/module.ts:53`、`packages/core/src/managed-policy.ts:10-35`、`packages/core/src/util/wildcard.ts:3-13` [读码] |
| F-10 | 上游自己就不许仓库配置移除两个内置插件(策略与 Console 连接) | `packages/core/src/plugin/internal.ts:303-306` [读码] |
| F-11 | 引擎解码配置时丢弃认不出的字段;JSONC 坏或 schema 不过的整份文档被拒并记诊断 | `packages/core/src/config.ts:134`、`:136-166` [读码] |
| F-12 | 项目 JSON 文档装载时先做 `{env:VAR}` 与 `{file:path}` 替换,再解析 | `packages/core/src/config.ts:168-174`、`packages/core/src/config/variable.ts:25-63` [读码] |
| F-13 | `skills` 相对路径按打开的目录解析;`instructions` 相对模式从打开的目录向上搜到项目根(非 git 文件夹的项目根可能在文件夹之外),网址在配置装载时抓取 | `packages/core/src/config/plugin/skill.ts:96-104`;`instruction.ts:36-39`、`:113`、`:160` [读码] |
| F-14 | ext 插件接口没有整份配置的编辑器:加不了技能目录,给不了插值、命令的 agent/model/subtask,没有 formatter / lsp / instructions 的挂点 | `packages/ext/src/engine-transforms.ts:15-23`;`packages/plugin/src/promise/` 目录清单 [读码];spike §5 B |
| F-15 | 托管策略只有 8 种动作,没有「忽略项目文档的某个键」;注入层能盖过单值键(如 `shell`),盖不住项目 MCP、命令、`instructions`、`plugins` | `packages/schema/src/config/policy.ts:18-27`;spike §8 第 5 项 [读码] |
| F-16 | Code Puppy 的策略写在显式文件(比项目文档先装载 ⇒ 项目的 allow 盖不过)与内联文档两处;执行闸把 Code Puppy 的 deny / ask 规则追加在每个 agent 全部配置规则之后 | `packages/ui-mac/src/main/codepuppy-config-injection.ts:320-325`;`packages/ext/src/policy/catalog.ts:13-15`、`:29-52` [读码] |
| F-17 | 信任记录(`#1709`):`<casBaseRoot>/project-trust/<env>.json`,按 realpath 项目目录 + inode 认项目;读法 `readProjectExtensionsConsent`,没有记录 / 读不出 / 拒绝 / 身份漂移都不算允许;macOS 上引擎写不进 | `#1709` 架构说明 `docs/architecture/2026-11-13-project-extension-trust-record.md`;`packages/ext/src/project-config.ts:225-234`(该分支) [读码 + 该分支实测] |
| F-18 | 同意后 renderer 请 ext 重载(`scope: "global"`),ext 调度器等全部会话空闲后打一次 `POST /api/location/reload`,重建所有已加载的 Location | `ext-trust-watcher.tsx:52-54`(`#1709` 分支);`packages/ext/src/reload-scheduler.ts:1-24` [读码] |
| F-19 | 引擎入口 `startEngine(options, hooks)` 是 Code Puppy 自有文件,在 `start()` 之前可以做事;sidecar 已有一条主进程 → sidecar 的请求 / 应答命令(`write-probe`) | `packages/ui-mac/engine/engine-embed.ts:56-80`;`packages/ui-mac/src/main/sidecar.ts:124-137` [读码] |
| F-20 | 真实样本(本仓自带的上游 `.opencode/`):`agent/translator.md` 写了 `mode`、`model`;`command/commit.md` 带 `` !` `` 插值、`model`、`subtask`;`opencode.jsonc` 写了 `references`(一个 GitHub 仓库与 `~/.local/share/opencode`)和 `experimental.part_rows`;`tool/github-pr-search.ts` 在 OpenCode 2 里没有消费方 | `ls /Users/tide/app/alpha-code/.opencode`、`grep -ln '!\`' .opencode/command/*.md`(2026-11-13)[命令];`grep` core 无 `tool(s)` 目录消费方 [读码] |
| F-21 | owner 本机:引擎全局配置目录 `~/.config/opencode/opencode.jsonc` 没有 `formatter` / `shell` / `plugins` / `mcp` 等键;没有 `~/.opencode/`、`~/opencode.json(c)`;`~/app` 一级没有 `opencode.json(c)` | 2026-11-13 本机 `ls` 与键扫描 [命令] |

没有未结的承重问题。§10 留档列出读码得出、尚未实跑的几条,各有实现期的反证用例兜底。

## 4. 接口契约

**机制(一句话)**:引擎照旧自己发现、解析、归一化、热重载项目的 `opencode.json(c)` 与 `.opencode/`;Code Puppy 在 `Config` 装载这一个按目录的汇合点(F-03)上加一道闸门,按这个目录的 `#1709` 信任决定,把项目来源的条目要么原样交给引擎,要么只交出内容类字段;md agent 与命令插值在它们各自唯一的解码点补同一道判定。

### 契约 A —— 闸门的作用点与判定

- **A1 作用点只有三处**,都在引擎进程里、按 Location 运行:
  1. `Config` 装载(`packages/core/src/config.ts` 的 `load()`,`:275-374`):项目来源的文档与目录条目按 A3 / A4 处理;
  2. agent 插件(`config/plugin/agent.ts`):来自项目来源 `.opencode/{agent,agents,mode,modes}/*.md` 的文档,在未允许时剥掉契约 B 的 agent 控制字段;
  3. command 插件(`config/plugin/command.ts`,已接管):来自项目来源的命令在未允许时不做 `` !`…` `` 插值(模板原文发出),并剥掉契约 B 的命令控制字段。
- **A2 项目来源** = 本 Location 的向上遍历(F-05)找到的 `opencode.json(c)` 文档与 `.opencode/` 目录(连同里面的 `opencode.json(c)` 与 md 文件),**除去**父目录(realpath)恰好是用户主目录的那几项:`~/opencode.json(c)`、`~/.opencode/` 属于用户全局,照旧装载。引擎全局配置目录、显式文件(`codepuppy.jsonc` + Code Puppy 显式层)、内联注入本来就不在遍历里,闸门不碰。打开的文件夹在主目录之外时,遍历找到的每一项都是项目来源。
- **A3 信任** = 每次 `Config` 装载(首次与每次 reload)调用一次已安装的 `trusted(realpath(location.directory))`(契约 C);同一代里三个作用点用这同一个值。调用抛错 ⇒ 按未允许处理并记一行日志。
- **A4 未允许时**:
  - 项目来源的文档只保留契约 B「未允许」列为「生效」的字段;这类文档**不做** `{env:}` / `{file:}` 替换,原文解析(F-12)。
  - 项目来源的 `.opencode/` 目录条目保留(技能、命令、agent 的 md 照旧由引擎读取并热重载);同时在本 Location 的条目里、紧接托管策略之后插入一份闸门文档,对每个项目来源 `.opencode` 目录 `<d>` 写两条 `{ action: "plugin.use", resource: "<d>/plugin/*", effect: "deny" }` 与 `"<d>/plugins/*"`。由引擎自己的插件装载判定执行(F-09);它比除托管策略外的所有文档先装载,没有文档能盖过它。路径里若含 `*` / `?`,只会匹配得更宽,不会漏。
  - 把被暂缓的每一项记进本 Location 的视图(契约 D)。
- **A5 已允许时**:项目来源条目原样交给引擎(含替换)。唯一改写:项目来源文档 `plugins` 里的移除指令 `-*` 与 `-opencode.<id>` 去掉(契约 B「从不」一行),记一行日志;其余移除指令照常。
- **A6 闸门不读、不改**用户全局层、显式层、内联注入层与托管层;AGENTS.md 的发现(`InstructionDiscovery`)不经闸门,照旧。
- **A7 未安装闸门**(上游 CLI、上游包自己的测试)⇒ 三个作用点都不作用,行为与上游一致。Code Puppy 唯一的引擎入口必装(契约 C)。

### 契约 B —— 逐键分类

判据:「未允许也生效」只给不运行程序、不加载代码、不换掉所用程序、不放宽权限、不把项目以外的文件 / 环境变量 / 网址内容带进来、不把数据发往项目指定去处、不花钱的字段。其余在允许后生效。「从不」只收实测会让 Code Puppy 本身用不了的一项。

| 项目里的键 / 发现 | 未允许 | 允许后 | 依据 |
| --- | --- | --- | --- |
| AGENTS.md(文件夹、上级目录、`~/AGENTS.md`) | 生效 | 生效 | 不经闸门(A6);编排器转达的 owner 要求(AGENTS.md 与原生 `.opencode` 技能 / 命令 / agent 必须照常) |
| `$schema` | 生效 | 生效 | 元数据 |
| `agents.<n>.system`、`description`、`color`、`hidden`(含 `.opencode/{agent,agents,mode,modes}/*.md` 的正文与这些字段) | 生效 | 生效 | 说明类内容 |
| `agents.<n>.permissions`、`model`、`request`、`mode`、`steps`、`disabled`(含 md frontmatter) | 暂缓 | 生效 | 放宽权限、换模型、往模型请求里并请求头 / 体(`agent.ts:91-94`)、改自主步数;与 `.codepuppy` 的控制字段同一口径(`AGENT_CONTROL_FIELDS`,`#1693`)。真实样本 F-20 |
| `commands.<n>.template`、`description`(含 `.opencode/command(s)/**/*.md`) | 生效;`` !`…` `` 不执行,原文发出 | 生效,插值执行 | F-08;spike §3 user |
| `commands.<n>.agent`、`model`、`subagent`、`subtask` | 暂缓 | 生效 | 选择运行的 agent / 模型 / 委派 |
| 与出厂同名的命令(`init`、`review`) | 以文字顶替 | 顶替,含插值 | OpenCode 原有能力;文字是内容 |
| `.opencode/{skill,skills}/` | 生效 | 生效 | 内容 |
| `skills`:相对路径且没有 `..` 段 | 生效 | 生效 | 按打开的目录解析(F-13),在文件夹内 |
| `skills`:绝对路径、`~/`、含 `..`、网址 | 暂缓 | 生效 | 读文件夹外内容或联网 |
| `instructions`:相对模式且没有 `..` 段 | 生效,改写成 `<打开的文件夹>/<模式>` | 生效,原样(上游向上搜) | 上游相对模式会搜到文件夹之外(F-13);改写后只在文件夹内 |
| `instructions`:绝对路径、`~/`、含 `..`、网址 | 暂缓 | 生效 | 项目外文件原文进模型请求(spike [实测]);网址装载即抓取 |
| `{env:…}`、`{file:…}` 替换(任何字段) | 不替换,字面保留 | 替换 | F-12:把环境变量与任意文件读进配置 |
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
| `providers`(含节点级 / 模型级 `package`、`options`) | 暂缓 | 生效 | 模型级 `package` 第一轮 import 项目 JS(spike [实测]);允许后照旧受现有治理:新节点被注入的 `provider.use` 拒,节点级 `package` 被注入层盖过(spike [实测]) |
| `model`、`default_agent` | 暂缓 | 生效 | 换模型(花费、数据去处)、换默认 agent(权限) |
| `permissions`、`policies` | 暂缓 | 生效 | 放宽权限;允许后仍盖不过 Code Puppy 显式层的策略与执行闸的尾部规则(F-16) |
| `references` | 暂缓 | 生效 | clone 仓库、指向项目外目录(真实样本 F-20) |
| `share`、`enterprise` | 暂缓 | 生效 | 把对话发往分享服务 |
| `websearch` | 暂缓 | 生效 | 决定搜索请求发往谁 |
| `worktree` | 暂缓 | 生效 | 新工作树写到项目指定的目录 |
| `warming` | 暂缓 | 生效 | 定时发模型请求(花费) |
| `snapshots` | 暂缓 | 生效 | 关掉会让撤销不可用 |
| `update` | 暂缓 | 生效 | 引擎更新行为 |
| `experimental`(全部子键,含已弃用的 `experimental.policies`) | 暂缓 | 生效 | 实验开关(ADR-048:上游实验默认关);项目打开等同用户在全局配置里打开 |
| `compaction`、`tool_output`、`media`、`watcher`、`timezone`、`username` | 生效 | 生效 | 只调阈值或显示,不运行程序、不放宽权限、不带入项目外内容 |
| 本表没有列出的 `Info` / `ConfigAgent.Info` / `ConfigCommand.Info` 字段(上游升级新增) | 暂缓(视图里记作「其他 OpenCode 设置」) | 生效 | 未分类默认暂缓;升级时由 §6 的升级检查要求补分类 |
| 引擎认不出的键 | 不生效 | 不生效 | 引擎解码时丢弃(F-11),与信任无关 |
| `.claude/`、`.agents/` 兼容目录;`CLAUDE.md`、`.cursorrules` | 不生效 | 不生效 | Code Puppy 已移除兼容插件;引擎只认 AGENTS.md(spike §8 [实测])。本设计不改 |

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

### 契约 D —— 项目配置视图与主进程 ↔ sidecar 消息

```ts
// packages/schema/src/codepuppy-project-config.ts(Code Puppy 自有,纯模块,零依赖;闸门、sidecar、主进程共用,先例 codepuppy-tool-policy.ts)
export const WITHHELD_KINDS = [
  "mcp",           // mcp 条目
  "plugin",        // plugins 新增 / options / 移除,.opencode/{plugin,plugins}/ 里的目标
  "agent-control", // agent 控制字段
  "command-run",   // 带 !`…` 的命令,或写了 agent / model / subagent / subtask 的命令
  "formatter",
  "shell",
  "provider",
  "outside",       // 文件夹外或网址的 skills / instructions、references、{env:} / {file:}
  "setting",       // 其余暂缓的键,含本表没有的字段与 lsp
] as const
export type WithheldKind = (typeof WITHHELD_KINDS)[number]
export type WithheldItem = {
  kind: WithheldKind
  /** MCP / 格式化程序 / provider 名、命令名(不带 /)、agent 名、插件目标、shell 路径、路径或网址、键名。 */
  name: string
  /** 出处文件,相对于打开的文件夹;上级目录里的写成 ../… */
  file: string
  /** 只用于 agent-control 与 command-run:被暂缓的字段名;插值记作 "shell"。 */
  fields?: string[]
}
export type ProjectConfigView = {
  /** realpath 后的项目文件夹(信任记录的键)。 */
  directory: string
  trusted: boolean
  /** 未允许时被暂缓的条目,按 kind、file、name 排序去重;trusted 时为 []。 */
  withheld: WithheldItem[]
}

// packages/ui-mac/src/main/ 下一份 build/parse 成对的消息文件(形制同 workspace-write-probe.ts;parse 一律 fail-closed)
type ProjectConfigViewRequest = { type: "project-config-view"; id: string; directory: string }
type ProjectConfigViewReply =
  | { type: "project-config-view-reply"; id: string; ok: true; view: ProjectConfigView }
  | { type: "project-config-view-reply"; id: string; ok: false; reason: "engine-not-ready" | "location-failed" }
```

- **产出方**:闸门在 A1 三处记录暂缓项;sidecar(`sidecar.ts` 的命令族,与 `write-probe` 同处)收到请求后,经进程内 fetch 对该目录发一次需要解析出命令与 agent 的请求(确保这个 Location 及其插件已就绪),再读闸门为该目录记录的视图作答。
- **消费方**:`ext-trust-check`(`ext-ipc.ts`)。清单 = `.codepuppy` 的可执行物(`listProjectExecutables`,不变)+ `view.withheld`;两者都空 ⇒ 不弹框;已有决定 ⇒ 不弹框(不变)。应答超时(有界,沿用主进程对 sidecar 请求的既有超时口径)、`ok: false` 或解析失败 ⇒ 本次不列 OpenCode 条目并记一行日志;内容照旧暂缓,下一次进入该项目再问。
- **决定的写入**沿用 `#1709` 唯一写入点与记录形状;告知版本**不升**:信任只回答「这个文件夹你是否点过允许」,已有的允许同时覆盖 OpenCode 配置(owner 2026-11-13「我的没有租户就我一个用户…」)。

### 契约 E —— 确认框清单(行模板;文案终稿 owner 定)

现有三行(`ext-ipc.ts` 当前分支 `:593-595`)保留,并接收来自视图的同类条目:`mcp` → 「· 连接器(MCP):<名字>」;`plugin` → 「· 插件:<目标>」;`agent-control` → 「· Agent 的权限与模型设置:<名字>(<字段>)」。新增六类行的提议文案在 spec「体验约定」;`command-run`、`formatter`、`shell`、`provider`、`outside`、`setting` 各对应一行。一类条目很多时的折叠方式由实现照现有框的长度定,不另设上限常量。标题、按钮、说明文字不变。除这个框以外不新增任何界面提示;暂缓情况只进日志(目录、类别、计数,不记配置值)。

### 层序(同一个键由谁说了算)

设置类(后者盖前者):引擎全局配置目录 → 显式文件(`codepuppy.jsonc` + Code Puppy 显式层)→ 遍历文档,从根到打开的文件夹(`~/opencode.json(c)` 属用户全局,不经闸门;其下各级经闸门)→ `.opencode/` 文档(`~/.opencode/` 用户全局;其余经闸门)→ Code Puppy 内联注入 → 托管设置。与今天相同,闸门只改「项目来源交出多少」,不改顺序。

- 策略类(最早装载者胜):托管策略 → 闸门文档(只在未允许时有)→ 引擎全局配置目录 → 显式层 → 项目 → 内联。已允许项目的策略盖不过 Code Puppy 显式层的策略(F-16)。
- `.codepuppy/codepuppy.jsonc`(ext 经插件接口合并)与项目 `opencode.json` 同名时:MCP 由文档先写、ext 只补缺;agent 与命令由文档在 ext 之后注册 ⇒ 两种情况都是 `opencode.json` 的那条生效(`engine-transforms.ts:8-16` 记录的激活顺序)。两者都受同一个信任决定管,不改。
- `plugin.use`:`#1708` 在显式层写的「先拒绝全部、再按精确路径放行」退役(§10 R-07);用户自己文件里写的 `plugin.use` 由引擎照常执行。

### API
没有新的 HTTP 接口。主进程与 sidecar 之间新增契约 D 的一对消息。

### 数据
没有新的持久数据。信任记录沿用 `#1709`,位置、形状、告知版本都不变。

### 事件 / 配置
不新增配置键。

## 5. 数据与失败
- **生效时机**:允许后由既有链路生效:renderer 请 ext 重载 → 调度器等全部会话空闲(或用户在定制中心强制)→ `location/reload` 重建所有 Location → 闸门重新读信任(F-18)。撤销今天只有记录层(没有界面),同一链路下一次重载生效;已经 import 进引擎进程的插件代码留下的副作用要到 sidecar 重启才消失。
- **热重载**:项目配置文件在盘上改动 ⇒ 引擎对该 Location 的配置 reload(既有监听,`config.ts:376-424`)⇒ 闸门按当时的信任再判一次。已允许:新内容立刻生效,不再询问;未允许:新的可执行内容继续暂缓;没做过决定的项目要到下一次进入它的会话才弹框。
- **多项目**:每个 Location 各读各的信任、各有各的条目与视图,互不影响(AC-07)。例外如实记下:已允许项目加载的插件运行在整个引擎进程里,能影响别的 Location(`#1709`「信任就是允许运行代码」)。
- **读不到信任 / 身份对不上 / 钩子抛错** ⇒ 未允许(fail-closed),记一行。**钩子没装** ⇒ `startEngine` 抛错,sidecar 不报 ready。
- **项目配置写坏**:JSONC 错或 schema 不过 ⇒ 引擎拒掉整份文档(F-11),闸门看不到它,不生效、不列入清单,已允许与否都一样。md 文件解不出 ⇒ 引擎解码器跳过,同上。
- **认不出的键**:引擎层面认不出的键本来就被丢弃;`Info` 里有、契约 B 没列的字段按「暂缓」处理(未允许时不生效、列为「其他 OpenCode 设置」,已允许时生效),不存在「未允许时静默生效」。
- **部分生效**:按字段生效是本设计的语义(agent 的提示词生效、控制字段暂缓,与 `.codepuppy` 一致)。可执行条目整条进或整条不进,不出现「去掉一半字段的 MCP 条目」。
- **插件拒绝没有时间窗**:闸门策略用目录通配,不随文件增减重算;新放进 `.opencode/plugins/` 的文件在插件来源扫到它时已被拒。
- **视图请求失败**:见契约 D,只影响清单,不影响暂缓。

## 6. 架构落点

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| 闸门判定、契约 B 分类、视图记录 | `packages/core/`(`modules.md:26`)的 Code Puppy 自有文件 `config/codepuppy-project-gate.ts` | core 内部:`Config` 文档模型、`ManagedPolicy` 语义 | 上游的解析与归一化(`config.ts:136-166`)、插件装载判定(`plugin/module.ts:53`) |
| `load()` 里调用闸门 | `packages/core/src/config.ts`(**新接管**) | 同上 | 上游装载、热重载原样 |
| md agent 剥控制字段 | `packages/core/src/config/plugin/agent.ts`(**新接管**) | 闸门 | 上游 md agent 解码原样(`agent.ts:147-186`) |
| 命令不插值、剥控制字段 | `packages/core/src/config/plugin/command.ts`(已接管) | 闸门 | 上游命令解码原样 |
| 视图形状 | `packages/schema/`(`modules.md:41`)的 `codepuppy-project-config.ts` | 无 | 先例 `packages/schema/src/codepuppy-tool-policy.ts`(core 与 ui-mac 共用) |
| 信任钩子 | `packages/ui-mac/engine/engine-embed.ts` | `@opencode/core` | `#1709` 读法(`readProjectExtensionsConsent`、`projectDirectoryIdentity`) |
| 视图消息、确认框清单 | `packages/ui-mac/src/main/`(`modules.md:51`):sidecar 命令族、`ext-ipc.ts` | schema 视图模块 | `#1709` 的确认框、写入点与记录;进程内 fetch(`in-process-engine.ts`) |
| 退役 `#1708` 的显式层 deny-all(若它先合入) | `packages/ui-mac/src/main/` | — | — |

- **新目录 / 新模块**:无新目录。两个 Code Puppy 自有文件住在上游包里,按 ADR-043 用 `codepuppy-` 前缀;`modules.md` 无需新增行。
- **接管面(需要一条新 ADR,CLAUDE.md「新增收编须自己的 ADR」;ADR 随实现 PR 提交,内容即本节)**:
  - `packages/core/src/config.ts`。为什么必须:它是每个消费方拿项目内容的唯一汇合点(F-03),而上游给的只有全局开关 `project`(F-02)、插件接口没有配置编辑器(F-14)、托管策略忽略不了单个键(F-15)。改动面:`load()` 里读信任、未允许时项目来源文档不替换、条目过滤与闸门文档插入,全部在 `codepuppy(<ADR>) ──` 标注块内(`DESIGN-upgrade-fewer-takeovers` 契约 D)。上游升级要复核:`load()` 返回的分类与顺序(`direct`、`projectSupplementary` 是否仍只装项目遍历的东西)、`discover()` 的遍历与全局根排除(`discovery.ts:78-81`、`:121-126`)、条目种类是否新增。
  - `packages/core/src/config/plugin/agent.ts`。为什么必须:md agent 只在这里被解码,解码函数未导出(F-07);不接管就只能抄一份解码(K2)。改动面:`loadEntry` 里一处调用闸门。上游升级要复核:md 的目录约定与字段集(`agentKeys`、`nativeKeys`)。
  - `command.ts` 已接管,新增的行同样放进标注块。
- **升级检查(ADR-048 决定 4)**:在 Code Puppy 权威登记册(`docs/architecture/codepuppy-authority-registry.json`)加一条「项目 OpenCode 配置按信任放行」。守它的检查必须能在三种情况下变红:`Info` / `ConfigAgent.Info` / `ConfigCommand.Info` 出现契约 B 没分类的字段;core 里 `.opencode` 目录条目的消费方多于 F-06 的 5 个;拿掉闸门后 spike 的「已知的坏」重新执行(反向臂)。
- **上游挂点需求**:「按 Location 过滤配置文档的钩子」若被上游接受,两处新接管可退回插件层;加进 `DESIGN-upgrade-fewer-takeovers` §10 R-11 的清单,不在本期做。
- **架构约束**:K2 更好:分类只在闸门一处,主进程消费引擎算出的视图而不重解析项目文件,信任只有 `#1709` 一个读法;没有新增 K2 偏离。K1 不变。ADR-040:安装路径的封死不变;后果 4(引擎对目录插件的自动发现不在控制内)改为「项目来源的目录插件在信任闸门之后」,由实现 PR 改写该条。ADR-024 不涉及(管的是 `.claude` / `.agents`)。北极星:接管清单加两条,经新 ADR 与 owner 批准(先例:`#1666` owner 2026-11-12「同意，多接管两个上游文件，需要再唯一权威中记录多接管的内容。」)。
- **工程标准**:不新增配置项;信任与视图形状各一个所有者;日志只记目录、类别与计数,不记配置值(可能含密钥)。
- **被否决的替代**(各一条理由):
  - 整体 `project: false`、不补回:丢掉 AGENTS.md、`.opencode` 的技能 / 命令 / agent 与 `~/.opencode`(F-02 实测),与 owner 原话相反。
  - 引擎继续读、只靠托管策略与注入逐键中和:策略动作忽略不了键,注入盖不住项目 MCP、命令、`instructions`、`plugins`(F-15)。
  - `project: false` + ext 按信任补回:插件接口给不了技能目录、插值、命令的 agent/model/subtask,也没有 formatter / lsp / instructions 的挂点(F-14),已允许的项目拿不到完整能力;AGENTS.md 要在 ext 里重写一遍上游的查找规则。
  - 接管 `routes.ts:143` 让 AGENTS.md 不跟 `project` 走,再 `project: false`:只救回 AGENTS.md,其余同上。
  - 未允许时整个 `.opencode/` 不交给引擎,由 Code Puppy 抄一份 md agent / 命令解码重新合成文字部分:少接管一个文件,但要手写 `agent.ts:134-186` 的替身(K2)。
  - 主进程自己解析项目文件来生成确认框清单:要重写上游的归一化(v1 / v2 两种写法)与 md frontmatter 读法(K2);改由引擎算视图。
  - 保留 `#1708` 的「先拒绝全部」,再按路径放行已允许项目:与闸门重复成两套机制,且已允许项目按包名写的插件还得另开按名放行。
  - 第二个只给未允许项目用的引擎实例:同一个数据库两个写入者。
- **安全面**:
  - 威胁边界:打开的文件夹及其上级目录(主目录这一级除外)里的文件,在 `#1709` 记录里出现「允许」之前都是不可信输入。
  - 不变量:I-1 未允许时,项目来源的任何键或目录都不能让引擎派生进程、import 代码、换掉所用可执行文件、追加权限规则、把环境变量 / 文件夹外文件 / 网址内容读进配置、或把数据发往项目指定的去处;I-2 已允许时,项目来源原样到达引擎,只有「移除引擎内置插件」不生效;I-3 信任只来自 `#1709` 记录(macOS 上引擎写不进);I-4 用户全局层、显式层、内联层不受闸门影响;I-5 同一代配置里一个 Location 只用一个信任值。
  - 边界外(如实列出,不在本设计内):已允许项目自己的代码做什么;围栏可写范围(I-13,见 §9);Windows 无围栏;§10 留档里的读码观察。

## 8. 拆分决定
不适用:全部在 alpha-code 一个仓库、一个所有者内完成。

## 9. 回滚
- 代码层回退即可:没有数据迁移,信任记录的位置、形状、告知版本都不变,回退后记录照旧被 `.codepuppy` 的门使用。回退的后果是回到今天:未允许的项目又能让引擎运行它指定的程序(F-01)。
- 闸门本身出问题、需要先止血时:在 `engine-server-options.ts:49-53` 写 `project: false`(spike 实测十条「已知的坏」全部消失),代价是 F-02 那些内容类能力一起丢,直到修好。
- 回滚与本设计都不改变的遗留(一行):进程围栏允许写 `<codepuppy-state>/env/<env>/codepuppy.jsonc` 与 `~/.opencode/plugins/`(INT-safety I-13),已允许项目的代码或获批的写文件能借此写进用户全局层并在每个项目生效;本设计之后,未允许的项目已到不了这一步。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| R-01 引擎照旧读项目配置,Code Puppy 在 `Config` 装载这一个汇合点按项目信任过滤;不用 `project: false`,不由 Code Puppy 重读重注入 | F-02、F-03、F-14、F-15;owner 2026-11-13 原话 |
| R-02 新接管 `config.ts` 与 `agent.ts`,`command.ts` 在已有接管内扩展;需要新 ADR 与 owner 批准 | §6 接管面;CLAUDE.md 北极星条款;先例 `#1666` |
| R-03 未允许时 `.opencode/` 目录条目保留,插件由闸门策略拒;md agent 与命令在各自解码点剥控制字段 | F-06、F-07、F-09;保留引擎原生读取与热重载 |
| R-04 分类按契约 B;未分类字段默认暂缓;唯一「从不」= 项目移除引擎内置插件 | spike §2 实测;F-10 上游先例;owner「从不」列只收实测会坏的 |
| R-05 一个文件夹一次决定,与 `.codepuppy` 同一条记录、同一个框;告知版本不升;编辑配置不再询问 | owner 2026-11-13 三段原话;`#1709` |
| R-06 确认框清单由引擎算出,经 sidecar 消息交主进程 | K2;F-19 |
| R-07 `#1708` 被取代:owner 在 `#1708` 的「项目自带的引擎插件一律不加载」由 owner 2026-11-13 原话(「opencode 的能力要能被用到」)改为「允许后加载」。实现方式:退役 `#1708` 显式层的 deny-all 与精确放行名单;未允许项目的插件声明到不了引擎(`plugins` 键被剥、目录插件被闸门策略拒),`#1708` 测到的「按包名借道」随之不存在;已允许项目按包名写的插件照 OpenCode 安装加载;用户自己写的 `plugin.use` 照常 | spike §2;`#1708` 提交 `af90e637cc`、`e754d7e9f9` 说明 |
| R-08 用户全局层(含 `~/.opencode/`、`~/opencode.json(c)`、`~/AGENTS.md`)不经闸门 | F-05;编排器派发书 |
| R-09 未允许时项目文档不做 `{env:}` / `{file:}` 替换 | F-12 |
| R-10 未允许时 `instructions` 只留文件夹内的相对模式并改写成以文件夹为根;`skills` 只留文件夹内的相对路径 | F-13 |

| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| —(未送审) | — | — | — | — |

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| 文字类来源是指向文件夹外的符号链接(AGENTS.md、`.opencode` 下的技能 / 命令 / agent 文件)时,未允许也会把目标文件的文字读进来 | [读码] `InstructionDiscovery` 与 md 解码读的是解析后的目标;没有实跑 | AGENTS.md 发现保持上游所有(owner 要它照常);要拦需再接管一处 | 出现真实的符号链接样本,或 owner 把「读项目外内容」列为必须拦 |
| 用户全局配置打开了 formatter 时,未允许项目里内置格式化器会运行项目内的程序(`pint` 的 `./vendor/bin/pint`)或读项目的配置脚本 | 来源是用户全局设置,不是项目的键;owner 本机全局配置没有 `formatter`(F-21,今天为空集) | 闸门只管项目来源;为空集加规则违背「不要限制太死」 | owner 在全局配置里打开 formatter |
| 注入层给 Code Puppy 自己节点的每个模型显式写 `package`,让任何文档都换不掉 Code Puppy 模型的实现 | spike §2 提过的备选;已允许项目本就能在引擎里跑代码,这一格不增加能力 | 不在本期 AC | Code Puppy 模型被项目换掉实现造成可见故障 |
| 已允许项目打开上游实验开关 | ADR-048 让上游实验保持关闭;未实测哪个开关会弄坏 Code Puppy 界面 | owner 要求「从不」只收实测会坏的 | 测出某个实验开关会弄坏界面 |
| 未允许时剥掉 agent 的 `permissions`,写的是 deny 规则时 agent 反而回到默认权限 | 与 `.codepuppy` 未允许时的既有行为相同(REQ-236 P1) | 已批准的既有口径 | 出现依赖项目 deny 规则的真实 agent |
| `#1709` 信任记录在 Windows 上引擎写得进 | `#1709` 已知限制 | 本设计不为 Windows 加代码 | Windows 正式发行前 |
