---
id: ADR-049
title: 项目 OpenCode 配置在引擎读取点按项目信任放行
summary: 三个新接管与命令接管扩展只在读取点调用同一闸门;复核字段、来源、归一化与消费者,上游升级不得回退项目信任
kind: adr
status: accepted
date: 2026-11-14
owners: [owner]
last_reviewed: 2026-11-14
related: [ADR-029, ADR-040, ADR-047, ADR-048]
---

# 项目 OpenCode 配置在引擎读取点按项目信任放行

依据:[规格 v1](../../../docs/specs/project-engine-config-takeover/spec.md)、[冻结设计](../../../docs/specs/project-engine-config-takeover/design.md) `1256efc047` 的契约 A–E、§6、§9、§10。owner 2026-11-13「要做。」(编排器转达)。本 ADR 记录该已冻结决定,不重新定义产品范围。

## 接管与唯一所有者

| 文件 | 为什么挂不了钩子 | 改动面 |
| --- | --- | --- |
| `packages/core/src/config.ts` | 配置消费者的唯一汇合点;只有整体 `project` 开关,插件没有逐文档编辑器,托管策略忽略不了单个键 | `load()` 一条链:每代读一次信任,校验前过滤、解码后去掉隐含字段、托管策略后插目录插件闸门 |
| `packages/core/src/config/plugin/skill.ts` | 技能只在这里交给 `SkillFile.parse`,没有来源相关的解析挂点 | 复用 `sources(entries)` 分类,项目文件头先过闸门 |
| `packages/core/src/config/plugin/agent.ts` | md 文件头可在插件变换前执行,目录还会隐含生成 primary | 校验前处理文件头与控制字段,解码后再去掉隐含字段 |
| `packages/core/src/config/plugin/command.ts`(已有接管内扩展) | 模板插值发生在命令执行体,没有只针对项目来源的开关 | 文件头与控制字段过闸门,执行体保留插值原文 |

所有改动位于 `codepuppy(ADR-049)` 标注。规则、分类与视图的所有者只有 `packages/core/src/config/codepuppy-project-gate.ts`,上游读取点只调用它;普通内容仍由上游扫描、归一化、解码。文件头失败时复用 `ConfigMarkdown.sanitize`,不复制解析器。信任只有 #1709 的生产读写端,不新增记录形状或版本。

未安装闸门的上游入口保持原行为;Code Puppy 引擎入口必装。允许后原样交引擎,只移除项目停用内置插件的指令。`#1708` 的先拒全部与包名保护已由同一闸门取代;用户自己的 `plugin.use` 策略保留。读取普通内容不设路径边界,完整承诺以冻结设计 §6 为准。

## 上游升级复核清单

| 文件 | 复核什么 |
| --- | --- |
| `config.ts` | `load()` 返回的分类与顺序(托管策略最先;闸门文档插在其后);`loadFile` 的流程(读 → 替换 → `parseInfo` → `Document`);`reload()` 的发布条件(深度相等就丢弃,`:409`);`Options.project` 的语义;条目种类有没有新增 |
| `config/discovery.ts`(未接管,依赖它) | 向上遍历与全局根排除(`:78-81`、`:121-126`);`direct` / `project` 两组的构成 |
| `config/normalize.ts`(未接管) | v1 写法的读取点;隐含生成的字段(`:137-154`) |
| `skill.ts` | `sources()` 的解析规则与签名;读取点是不是仍然只有 `SkillFile.parse` |
| `agent.ts` | `legacySources` 的目录与 `primary`;`agentKeys` / `nativeKeys` 与 v1 / v2 的判定;解码输出的形状 |
| `command.ts` | md 解码;`evaluateTemplate` 的插值正则与流程;命令有没有新的控制字段 |
| `config/markdown.ts`、`plugin/module.ts`、`config/plugin/source.ts`、`plugin/internal.ts`(未接管) | gray-matter 的版本与引擎表;`sanitize` 仍然导出;`plugin.use` 判定点与它比较的目标串;目录插件的目标保留发现时的路径;受保护的内置插件集合;D6 闸门的 `pluginTarget` 与 `source.ts` 的 `parse` / 相对路径与 `file://` 解析逐条对应,`pluginResource` 与 `module.ts:51–53` 去版本号的目标串逐字对应(任一边改了,原生插件关闭会拒错或漏拒) |

机器判据:`packages/core/test/codepuppy-project-gate-upgrade.test.ts` 钉住 v1 / v2 字段分类、归一化与目录隐含字段、五个目录消费者与六处 Markdown 解码调用(含 `SkillFile.parse`),每条有已知坏。核心行为与真引擎两臂登记在 [权威登记册](../../../docs/architecture/codepuppy-authority-registry.json) 的 `project-opencode-config-trust`。

## 撤回与上游挂点需求

代码层撤回的后果与操作以冻结设计 §9 为准;本改动没有数据迁移。撤回会重新暴露历史基线里的项目程序执行与 JS 文件头执行面。

未来只有上游提供「按 Location 过滤配置文档」与「按来源选择 md 解析方式」两种挂点,这些接管才有机会沿 ADR-029 阶梯退回插件层;需求沿冻结设计 §6 登记,本次不另建实现。

## 增量:原生文件来源按引用管理(#1776 片 6a,DESIGN-local-plugin-install v3.5 R-m / R-n)

契约 C 的 `startEngine` hooks 增可选 `nativeSources`(签名 `NativeSourceSync`,`@opencode/schema/codepuppy-project-config`);同一闸门在每次装载的 `finish` 里 await 它取得原生绑定状态,并在本代视图里就地过滤关闭 / 已移除项(MCP 改 disabled、内联 agent / command 拿掉、插件经 `plugin.use` 在装载前拒绝)。接管文件只多两处调用:`config.ts` 把 Code Puppy 自己的显式层与内联注入交给 `finish`(它们不是原生来源),`skill.ts` 在 `SkillFile.parse` 之后调 `nativeSkill`;agent / command 沿原调用点。没有新接管文件,也没有新增目录消费者或 Markdown 解码调用(升级清点不变)。继承的 `.claude` / `.agents` 技能由 ext 的 `skill.transform` 按路径过滤(L0),不接管 `compatibility.ts`。登记见权威登记册 `project-opencode-config-trust`。
