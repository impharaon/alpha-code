---
id: SPEC-project-engine-config-takeover
title: 项目自带的 OpenCode 配置:内容直接能用,会运行程序的设置在你允许后生效
summary: 打开项目时,项目 opencode.json 与 .opencode/ 里的 AGENTS.md、技能、命令文字、agent 说明照常可用;会运行程序、加载代码、换掉所用程序、放宽权限或带入项目以外内容的设置,在你于现有确认框里允许这个项目后才生效,允许后与在 OpenCode 里一样全部可用
kind: spec
status: draft
version: 0
approved_by: ""
approved_at: ""
owners: [owner]
last_reviewed: 2026-11-13
---

# SPEC-project-engine-config-takeover｜项目自带的 OpenCode 配置在你允许后全部生效

打开一个项目,项目给 OpenCode 写的说明、技能、命令和 agent 马上能用;项目里会在本机运行程序的设置(连接器、格式化程序、shell、插件、模型实现等),等你在确认框里允许这个项目之后才生效,允许之后和在 OpenCode 里用一样完整。今天这些设置不经确认就运行:打开一个陌生仓库,它指定的命令就启动了。

## 来源
- owner 2026-11-13 原话:「我还是想使用opencode 的能力啊，你是想一道切都给我删掉吗。我不想一道切全都关掉啊，不要考虑软件当前的向后兼容问题，新的产品上线之后，opencode 的能力要能被用到，所有剩下的功能都 codepuppy 接手」。
- owner 2026-11-13(编排器转达,原话):「围栏不要做的太过分了，你不能确认就让我选方案」;「不要限制的太死，按照合理方案即可」;「我的没有租户就我一个用户，不用考虑新的用户有没有信任过的。」
- 意图 [INT-safety](https://github.com/impharaon/alpha-work/blob/976bb311b0/docs/intents/INT-safety.md) I-12;原则 P-06(工具、插件、MCP 以 Code Puppy 为唯一权威)。
- 实测:`docs/architecture/2026-11-13-project-config-command-surface.md`(分支 `spike/i12-project-config-commands` @ `e9635b3071`,§2 主表、§8 连带影响)。
- 依赖:项目信任记录 `#1709`(`fix/1709-project-consent-store` @ `bb98467a7d`)。
- Epic / Story:待建。

## 用户与范围
- 用户:owner 本人,在 Code Puppy 桌面端打开本机的代码项目,包括别人的仓库。
- 核心路径:打开项目 → 内容类配置立即可用 → 项目带有会运行程序的设置且这个文件夹还没做过决定时,弹一次现有的「项目自带扩展加载确认」框 → 点「允许加载」后,会话空闲时重载,下一条消息起全部生效。
- 包括:打开的文件夹及其上级目录(用户主目录这一级除外)里的 `opencode.json(c)` 与 `.opencode/` 全部内容;与 `.codepuppy/` 共用同一次决定、同一个确认框。
- **不包括**:撤销信任的界面(已有意图条目);进程围栏的可写范围(INT-safety I-13);Windows 上的围栏。用户全局的 OpenCode 配置不受项目信任影响,照旧。
- 假设与依赖:`#1709` 的信任记录先落地;信任只回答一件事——你是否对这个项目文件夹点过「允许加载」。
- 范围取舍:
  - 不采纳:整体关掉项目配置(引擎选项 `project: false`)——会连 AGENTS.md、`.opencode` 的技能 / 命令 / agent、`~/.opencode` 一起丢掉(实测,spike §8)。
  - 不采纳:允许之后按配置改动再问一次(owner:每个项目只确认一次)。
  - 技术取舍见 design §6「被否决的替代」与 §10。

## 体验约定
- 用户路径:进入项目的会话 →(有会运行程序的设置且没做过决定)确认框 → 「允许加载」或「仅文本扩展(不加载)」。
- 交互与状态:沿用现有原生确认框,不新增界面、提示条或设置项;只是清单里多几类行。只有内容类配置的项目不弹框;做过决定的项目不再弹。
- 文案(提议,终稿由 owner 定):现有三行(连接器、插件、Agent 的权限与模型设置)同时列出来自 OpenCode 配置的条目;新增六类行:
  - 「· 命令里会运行的程序:/<命令名>」
  - 「· 写文件后自动运行的格式化程序:<名字>」
  - 「· 终端与 shell 使用的程序:<路径>」
  - 「· 模型的接入设置:<名字>」
  - 「· 读取项目以外的文件或网址:<路径或网址>」
  - 「· 其他 OpenCode 设置:<键名>、<键名>」
- 设计稿:不适用(复用现有原生确认框,没有新画面)。

## 业务规则
- **BR-01**:项目还没被允许时,项目的 OpenCode 配置里只有内容类生效:AGENTS.md、`.opencode/` 里的技能、命令文字、agent 的说明与提示词,以及指向这个文件夹内部的技能目录与指令文件。—— owner 2026-11-13 原话;P-06。
- **BR-02**:会运行程序、加载代码、换掉所用程序、放宽权限,或把项目以外的文件、环境变量、网址内容带进来的设置,只在你允许这个项目之后生效。—— INT-safety I-12;spike §2。
- **BR-03**:允许之后,项目的 OpenCode 配置与在 OpenCode 里一样全部生效;唯一例外是项目不能停掉 Code Puppy 运行所需的引擎内置插件(`plugins` 里的 `-*`、`-opencode.…`),停掉会话就打不开(实测)。—— owner 2026-11-13 原话;spike §2 `plugins: ["-*"]` 一行。
- **BR-04**:一个项目文件夹一次决定,同时管 `.codepuppy/` 与 OpenCode 配置;决定之后编辑项目配置不再询问,新加的设置按已有决定处理。—— owner 2026-11-13 两段原话;`#1709`。
- **BR-05**:用户全局的 OpenCode 配置(含 `~/.opencode/`、`~/opencode.json`、`~/AGENTS.md`)照常生效,与项目是否被允许无关。—— 编排器派发书(`~/.opencode` 必须照常)。
- **BR-06**:确认框列出允许后会放开的东西,包括来自 OpenCode 配置的。—— `#1709` 确认框惯例。

## 用户会碰到的限制
| 用户碰到什么 | 多做、多懂什么 | 用户能接受吗 | 换来什么 | 出处 |
| --- | --- | --- | --- | --- |
| 第一次打开带有会运行程序设置的项目,弹一次确认框 | 点一次「允许加载」或「仅文本扩展」 | 能:每个项目一次,与现有 `.codepuppy` 确认框是同一个框、同一次决定 | 陌生仓库不能一打开就在本机运行它指定的程序 | owner 2026-11-13;spike §2 |
| 点允许之前,项目的连接器、格式化程序、shell、插件等不生效 | 无;内容类配置照常 | 能 | 同上 | 同上 |

## 验收
| ID | Given / When / Then | 依据 |
| --- | --- | --- |
| AC-01 | Given 一个未允许的项目,它的 `opencode.json` / `.opencode/` 写了本地 MCP、formatter、shell、带 `` !`cmd` `` 的命令、模型级 `package`、项目外的 `instructions`、插件(含重声明用户插件的 options 与 `-*`) When 打开项目、发一轮对话、让模型写文件和调 shell、敲这条命令、打开终端 Then 这些程序一个都不执行,项目的 JS 不被加载,项目外文件的内容不进模型请求(spike 回归用例「已知的坏」全部翻转) | BR-02 |
| AC-02 | Given 同一个未允许的项目还带 AGENTS.md、`.opencode/skills/`、`.opencode/commands/*.md`、`.opencode/agents/*.md` When 打开并发一轮对话 Then AGENTS.md 进入模型请求;技能、命令、agent 都在列表里;命令执行时模板原文发出、不执行插值;agent 用自己的提示词,但不带它写的权限、模型、模式设置 | BR-01 |
| AC-03 | Given AC-01 的项目 When 在确认框点「允许加载」并发下一条消息 Then 上面的设置全部按 OpenCode 的行为生效(MCP 启动、formatter 与 shell 用项目的、插件加载、插值执行) | BR-03、BR-04 |
| AC-04 | Given 已允许的项目 When 在它的 `opencode.json` 里新加一个本地 MCP Then 不再弹框,新 MCP 生效;Given 已允许的项目写了 `plugins: ["-*"]` When 新建会话 Then 会话照常可用 | BR-03、BR-04 |
| AC-05 | Given 一个只有 OpenCode 可执行设置、没有 `.codepuppy/` 的项目 When 第一次进入它的会话 Then 确认框出现并逐条列出这些设置;Given 一个只有 AGENTS.md 与技能的项目 Then 不弹框 | BR-04、BR-06 |
| AC-06 | Given 用户全局配置与 `~/.opencode/` 里各有插件、MCP、技能 When 分别在已允许和未允许的项目里使用 Then 两边都照常生效 | BR-05 |
| AC-07 | Given 同时打开两个项目,一个已允许、一个未允许 When 各发一轮对话 Then 各自按自己的决定生效,互不影响 | BR-02、BR-04 |

## 待决
无。确认框新增行的文案是提议,随本规格一起由 owner 定稿;它不改变行为。

## 批准记录
| 版本 | 日期 | 自查(模型) | 批准人 | 原话或链接 | 遗留去向 |
| --- | --- | --- | --- | --- | --- |
| 0 | 2026-11-13 | designer 作者自查(Claude Opus 5.5) | — | 草稿,未批准 | 技术观察见 design §10 留档 |
