---
id: DESIGN-upgrade-extension-manifest
title: 一份扩展清单格式、每类一条登记通道 技术设计
summary: Code Puppy 带进引擎的工具、MCP、插件、agent、技能、命令,今天经十条路径、五个读法、两套 v1→2.x 翻译进入引擎;收成一份 Code Puppy 自有的登记集合(内存里一个类型)、一份文档字段表与一个读取器、一张准入表和每类一个登记器;磁盘上的文件不改形状,用户文档照 I-07 G4 由引擎直接读,项目文档改用引擎自己的归一化读
kind: tech-design
status: approved
spec: ""                 # 内部工作,无 spec。来源:impharaon/alpha-work:INT-upstream-upgrade-readiness I-06(owner U-02,2026-11-12)
spec_version: ""
review:
  rounds: 1
  reviewed_sha: "fba8c401ce"   # R1 审的设计版本(Codex gpt-6.1-sol,会话 01a1cef1);结论 FIX-THEN-MERGE,6 Major + 2 Minor 全部采纳并已改,见 §10
  verdict: "pass-with-notes"
owners: [owner]
last_reviewed: 2026-11-12
---

# DESIGN-upgrade-extension-manifest｜一份扩展清单格式、每类一条登记通道 技术设计

只写决定。文件清单、提交顺序与测试由实现方的 plan.md 写。§3、§7 已退役,编号不复用。

## 1. 基线

- Spec:无。I-06 是内部工作,按派发书不建 spec;授权来源
  [impharaon/alpha-work:INT-upstream-upgrade-readiness I-06 @4c1b2c6](https://github.com/impharaon/alpha-work/blob/4c1b2c624b53619de97fa6bfa5679024d07abf17/docs/intents/INT-upstream-upgrade-readiness.md)
  (owner 2026-11-12 U-02「同意做」,每份方案单独送 owner 批)。规模 L。
- 覆盖:I-06「工具、MCP、插件、agent、技能、命令统一成一份扩展清单格式和一条登记通道」;派发书点名的决定:逐条清点登记路径;
  清单格式(schema、版本、各作用域放哪);每类一条进引擎的通道;身份 / 权威铸造与同意门怎样统一挂上;已有用户与项目文件的迁移;
  哪些不动;交付切片。
- 背景:P-04;ADR-048(已拿回的权威只许换接法)、ADR-040(任何安装路径不写 `plugin[]`)、ADR-041(工具身份)、ADR-047 第 1 层表
  「定制中心与扩展目录、第三方插件同意后才装载、外部技能默认拒」;owner 原话「界面当前的 alpha 才是唯一权威吧」「不可以因为 opencode 更新把经 codepuppy 拿回的唯一权威再封掉」。
- 消费的兄弟方案:
  - I-07 启动配置 `docs/specs/upgrade-bootstrap-config/design.md @e6da3448e4`(G1–G3 owner 已批;G4 owner 已决定做)。本方案用到:
    启动文档 `CodePuppyBootstrap` 在 `packages/util/src/codepuppy-bootstrap.ts`(其 §4.1),权威证据与出厂开关一律从它读
    (`cloudMcp`、`paths.officeMcpManifest`、`paths.extBundledManifest`、`paths.extPlugin`、`skills.factoryDirs`、`switches.*`、`cloudMcpArmed`);
    G4(其 §4.7):`start()` 的 `config.file` **直接是用户的 `codepuppy.jsonc`**,合成的显式文件删除,出厂层(白名单 `policies`、`/init` `/review`、`skills`)写在
    `<环境根>/engine-global/opencode.jsonc`(全局层)。
  - I-05 少改上游 `docs/specs/upgrade-fewer-takeovers/design.md @0a1d9d2fdd`:不新增挂点,插件 MCP 域只有 list/transform/reload;本方案不加接管。
- 代码坐标:`E@` = `engine/1662-opencode2@778f44a41c`。所引 ext、core、plugin 源文件与初稿的 `4198d1a484` 逐字相同;
  `codepuppy-config-injection.ts` 在两者之间因 #1687 多了 `isCloudMcpWithheld`(`:191-202`),下文按新版行号写。标记:[读] 读码;[测] 本次实跑;[推] 推断。

## 批准记录

- 2026-11-12,owner(编排器转达),逐字:「全局目录多接管两个上游文件，同不同意；「扩展清单」方案批不批； 这两个同意，上游需求怎么发是什么意思。」
- 含义:本设计(审过并按 finding 修正的 `fcb47ce40e`)获批;编排器 2026-11-12 据这句原话把本设计标为 `approved`。

## 2. 地面真相

**问题**:Code Puppy 经哪些路径把六类扩展带进引擎;每条谁写、什么形状、过哪道门、身份与权威在哪铸、怎么进引擎、换代时坏在哪。
**范围**:`packages/ext`、`packages/ui-mac/src/main` 里写或读扩展的代码,以及它们依赖的 OpenCode 2 配置加载与插件接口。
定制中心的安装期包格式(签名信封 `HostExtensionPackageV1`、ManifestV2、账本 V3、事务与回执)是与 alpha-web 的跨仓契约,不随引擎代次变,不在范围内。
**停止条件**:每条路径的写方、读方、进引擎的槽位都对上代码坐标;同一份数据的两种读法实跑对比过一次。

### 2.1 路径清点

| # | 路径 | 写方与形状 | 门 | 身份 / 权威在哪定 | 怎么进引擎 | 换代时坏在哪 |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | ext 自带工具(`codepuppy_reload/register/echo/access/ping`)与定制中心工具(`codepuppy_hub_search/install/status`) | ext 代码,promise 工具形状(`E@packages/ext/src/codepuppy-tools.ts:22-174`、`hub-tools.ts:71-135`) | 工具策略执行闸;安装恒问、自动化恒拒(`hub-tools.ts:56-59,106-113`) | `plugin:<ext 模块路径>:<名>`;`bundled-tools.json` 摘要对上才铸 `codepuppy-bundled`(`policy/bundled-plugin.ts:31-73`、`policy/identity.ts:143-152`) | ext `tool.transform` 的 `editor.add`(`plugin.ts:129-133`) | 插件工具形状 |
| E2 | 定制中心安装与治理(用户作用域) | main:MCP 本地条目 `persistMcp`、agent `persistAgentEntry` 写用户 `codepuppy.jsonc` 的 v1 键(`ext-config.ts:477,780`;键表 `ALLOWED_TOP_KEYS` `:334`);agent 来自 Markdown 前言时原样保留 `permission`(`agent-md-entry.ts:41-45`,随包示例 `resources/agents/code-reviewer.md:4-7` 含 `bash`);治理把 `governance.json` 物化成 `agent.*` / `permission.skill.*` / `command.*` 叶子(`codepuppy-builtin-policy.ts:1-15`、`ext-config.ts:176-184`);远程 MCP 只写 main 独占真源(#1381);技能写 `ext-store` 代与 `skills-enabled.json` | 安装确认框;账本停用与会话级授权在内联文档里压成中和条目(`ext-disabled-injection.ts`);用户文件里的远程条目由 `mcp-default-deny.ts` 中和 | MCP `mcp:<键>:<工具>`,不铸权威 | 今天:用户文件原样并进合成显式文件(`engine-explicit-config.ts:37-60`)由上游 v1 兼容层解读(`core/src/config/normalize.ts:118-193,250-297`);I-07 G4 后:用户文件**本身**就是 `config.file`;技能目录进出厂层 `skills`;真源记录进内联(`codepuppy-config-injection.ts:612-625`) | 上游删改 v1 兼容层 ⇒ 用户装的东西不再按原意加载 |
| E3 | 随包 Office MCP(四个) | 定制中心目录安装,经 `ext-mcp-policy.ts` 写 main 模板(含 `{workspace}`)进用户文件的 `mcp.codepuppy-*` | 目录安装 | 命令等于清单模板才铸 `codepuppy-bundled`(`identity.ts:104-110`);连上前按声明给工具(已接管的 `core/src/mcp/index.ts` + 自有 `codepuppy-first-party-mcp.ts`) | 同 E2;`{workspace}` 由策略的 `mcp.transform` 每个 Location 替换(`policy/index.ts:133-141`) | 同 E2;MCP 运行时接管(I-05 保留) |
| E4 | 云 MCP | sidecar 注入按账户信号写三形之一(`codepuppy-config-injection.ts:530-596`),完整定义经进程内环境总线交给 ext(I-07 G2 改走启动文档);被扣下与否经 `isCloudMcpWithheld` 给界面(`:191-202,570`) | 代付判据 + kill-switch | 生效定义逐字等于 DEF 才铸 `codepuppy-cloud`(`plugin/src/alpha-cloud-authority.ts:158-173`、`identity.ts:96-103`) | 内联 `mcp.servers.codepuppy`;kill-switch 下 ext 在 `mcp.transform` 里装真定义(`plugin.ts:267-274`) | MCP 配置与编辑器形状 |
| E5 | 出厂:四个档位 agent、`/init` `/review`、提示词接管 agent(general/explore/docs)、出厂技能目录、出厂禁用技能、ext 插件目录与 `-opencode.config.compatibility` | 档位 agent 写内联 `agents`(`codepuppy-config-injection.ts:345-517`);两条命令进显式层(`:333-343`,G4 后进出厂层);提示词接管 agent 由 ext `agent.transform` 写(`plugin.ts:255-260,287-293`);禁用名单 → ext `skill.transform` 与 `permission.hook`(`plugin.ts:309-317`);插件写内联 `plugins`(`codepuppy-config-injection.ts:169-177`) | 一方;逃生开关 | 上游内置 agent 为 builtin;技能无工具身份 | 内联 / 出厂层 / ext transform 三处 | 配置 `agents`/`commands`/`skills`/`plugins` 形状;`AgentEditor` |
| E6 | 项目文档 `<项目>/.codepuppy/codepuppy.jsonc` | `codepuppy_register`(`codepuppy-tools.ts:52-113`;字段表 `register.ts:15-19`);生态导入 `registerProjectSkillsPath`(`ecosystem-import.ts:126-146`);出厂技能 `agent-creator` 指导模型用它登记带 `permission.bash` 的项目 agent(`resources/factory-skills/agent-creator/SKILL.md:36-40`);用户手写 | `prefs.json` 同意:MCP 与 agent 控制字段(`project-config.ts:128-159,268-280`) | MCP `mcp:<键>:<工具>`,不铸权威 | ext 用自写的 JSONC 剥离器读(`project-config.ts:220-256`),逐字段翻译进各编辑器(`engine-transforms.ts:34-135`):MCP 只补缺、agent 只写 system/description/mode/model、命令只认 `$ARGUMENTS`、`permission` 一律不写;`skills.paths` 只有 `./.codepuppy/skills` 经相对条目生效(`codepuppy-config-injection.ts:94-102`) | 编辑器类型;翻译有损(F-02) |
| E7 | 项目技能目录 `.codepuppy/skills` | 生态导入、模型直接写盘 | 无(2026-11-12 裁决接受) | — | 出厂层 `skills` 的相对条目,上游按会话所在项目解析 | 相对条目语义 |
| E8 | 项目插件 `.codepuppy/plugins/*.js` | 项目自带 | 同意;包住的 Context 只拒「已有的有效名」与改删别人的工具,不许回复审批(`plugin-fanout.ts:59-119`) | 按命名空间推:无命名空间 ⇒ `plugin::<名>`;**带上某个已配置 MCP 的命名空间 ⇒ 借到该 MCP 的身份与权威**(F-13) | ext 扇出(`plugin-fanout.ts:130-176`、`plugin.ts:331-351`) | 插件本身就是 OpenCode 插件 API 代码:v1 函数插件在 2.x 已被拒(`plugin-fanout.ts:162-166`) |
| E9 | 生态导入 | 同意后转换导入(ADR-024):项目技能 → E7 并写 E6 的 `skills.paths`;项目 `CLAUDE.md` → `AGENTS.md`;全局 → 环境根 `instructions/`(内联 `instructions`,`codepuppy-config-injection.ts:295-313`) | 导入同意 | — | E6 / E7 / 上游 `AGENTS.md` / 内联 | 同 E6、E7 |
| E10 | 工具策略的身份与权威 | 观察引擎注册表:命名空间 = 已配置 MCP ⇒ mcp;ext 首次 transform 前已在 ⇒ builtin;其余 ⇒ plugin,来源只认 ext 自己(`identity.ts:114-153`、`policy/index.ts:81-87,130`) | — | 同左;保存的启停记录按规范身份做键(`catalog.ts` 的 `canonicalToolIdentity`) | 每个 agent 的尾部规则(`catalog.ts`) | 注册表顺序与命名空间语义(I-03 探针 P4) |

### 2.2 其它所依赖的事实

- **F-01 同一份文档,五种读法、四张字段表** [读]。项目文档:ext `mergeProjectConfig` + `stripJsonc`(`project-config.ts:130-184,220-256`)、
  main `listProjectExecutables` 里抄的一份 `stripJsonc`(`codepuppy-ext-trust.ts:39-90`)、`register.ts` 的读改写(同一个 `stripJsonc`)、`ecosystem-import.ts` 的 `jsonc-parser`;
  用户文档:main `ext-config.ts`(`jsonc-parser`,`SAFE_MCP_FIELDS` `:64`、`ALLOWED_TOP_KEYS` `:334`、`builtinPolicyPathAllowed` `:176`)与上游 v1 兼容层。
- **F-02 同一条 v1 MCP 条目,按作用域得到两个不同的引擎定义** [测]。bun 1.3.14,`E@cde023e817`(所引源文件同 `778f44a41c`),隔离 HOME / XDG,工作树运行前后 `git status` 均为空。
  输入 `{type:"local", command:[…], cwd:"/w", environment:{A:"1"}, enabled:false, timeout:9000}`:

  ```
  上游 ConfigNormalize.normalize(用户文件这条路): {type, command, cwd:"/w", environment, disabled:true, timeout:{startup:9000, catalog:9000, execution:9000}}
  ext toServerConfig(项目文件这条路):            {type, command, environment, disabled:true}           ← cwd 与 timeout 丢了
  ```
- **F-03 上游 v1 兼容层对 Code Puppy 写的字段怎么做** [测],同一次运行:`mcp.<名>` → `mcp.servers.<名>`;只写 `enabled` 的条目被丢并出诊断;
  MCP 的 `args` **被静默丢弃**;agent `permission:{bash:"deny"}` → `{action:"shell"}`(`core/src/v1/config/migrate.ts:27-32`);
  `temperature` → `request.body.temperature`;`tools:{webfetch:false}` → deny 规则;命令 `subtask` → `subagent`、`model:"p/m"` → `{providerID, model}`;
  `permission.skill.<名>` → 顶层规则;`skills.paths` → `skills` 数组。另 [读]:旧 provider id `azure-cognitive-services` / `google-vertex-anthropic` 在 model 里改名
  (`migrate.ts:66-72,176-178`);项目 MCP 的 OAuth 驼峰字段今天由 ext 原样传(`engine-transforms.ts:45`),而运行时只读下划线字段(`core/src/mcp/oauth.ts:159,372,418`)。
- **F-04 引擎的槽位与先后** [读]。加载序 managedPolicies → … → global → explicit → direct → project → content → managedSettings(`core/src/config.ts:363-373`);
  设置后加载者胜、policy 先加载者胜;插件激活 internal.pre → 按配置装的插件(ext)→ internal.post,配置 agent / 命令 / 技能插件在 post(`engine-transforms.ts:9-15`);
  没有按目录注入配置的接口,只有目录发现。I-03 的探针 `packages/ext/src/upstream-probes/config.test.ts`(P3 / P5 / P11)与 `plugins.test.ts`(P4)钉住这些;
  我在本机两次跑都卡在等引擎就绪的超时上,不当结论用。
- **F-05 插件接口的编辑器** [读]。`MCPEditor.set` 收 `Mcp.ServerConfig`,配置的 `ConfigMCP.Server` 是同一个类型(`schema/src/config/mcp.ts:15`);
  `AgentEditor` 收 `Agent.Info`,上游把配置 agent 的 `model` 落成 `{id, providerID, variant?}`(`core/src/config/plugin/agent.ts:85-89`);
  `CommandEditor` 只有 `add({name, description, execute})`,没有模板、agent、model、子任务;`SkillEditor` 只收解析好的 `Skill.Info`,没有「加一个目录」。
- **F-06 同意:一份记录,两个判法** [读]。main `extensionsGranted` 要求 `version === 1 && granted === true`(`codepuppy-ext-trust.ts:23-26`);
  ext `readProjectExtensionsConsent` 只看 `granted === true`(`project-config.ts:268-280`)。弹框只列 MCP 与插件(`codepuppy-ext-trust.ts:39-53`)。
- **F-07 提示词接管的先后** [读]。`applyPromptTakeover` 遇到已有 prompt 就让位(`codepuppy-prompts.ts:326-331`),ext 在合并项目文档之后才调它(`plugin.ts:255-260`)
  ⇒ 项目同名 agent > 出厂接管 > 上游内置。
- **F-08 权威证据今天全走环境变量,I-07 G1/G2 把三样都搬进启动文档** [读]:云 DEF(`alpha-cloud-authority.ts:164`)、Office 清单(`identity.ts:104`)、ext 清单(`bundled-plugin.ts:36`)。
- **F-09 ext 不能把上游的 normalize 编进自己** [读]:`core/src/v1/config/migrate.ts:11-12` import core 的 `provider.js` 与 `model.js`(服务模块);
  但 sidecar 装入的引擎 bundle 里本来就有它 —— 引擎 bundle 的入口是 Code Puppy 自有的 `packages/ui-mac/engine/engine-embed.ts`(由 `electron.vite.config.ts:89` 解析成 `virtual:opencode-server`),
  sidecar 先装引擎、后装 ext(`sidecar.ts:155,161`);进程内交接已有先例(`in-process-engine.ts:15-24`,I-07 的启动文档同一形状)。
- **F-10 本机存量** [测],只列键与字段名、不读值:用户文件 `codepuppy-state/env/prod/codepuppy.jsonc` 顶层只有 `$schema`、`skills{paths}`、`mcp`、`provider{}`;
  `mcp` 8 条(4 条随包 Office:`command,type`;4 条定制中心安装:`command,type` 与 `cwd`/`enabled`/`environment`/`timeout` 的组合);
  没有 `agent`、`command`、`permission`、`plugin`;`governance-materialized.json` 0 条;远程 MCP 真源 0 条;
  `~` 下三层内找到的项目 `.codepuppy` 目录 1 个,只有 `attachments`、`runs`,没有项目文档、项目插件与 `prefs.json`。除本机外零租户。
- **F-11 ADR-040 已封死用户作用域插件**:任何安装路径往 `plugin[]` 加元素一律拒(`engine-plugin-seal.ts:1-11`);第三方代码进引擎只剩 E8 一条。
- **F-12 登记册** [读]:身份、权威铸造、冲突拒绝、定制中心恒问都有在役条目;「项目可执行物同意后才装」「外部生态默认拒」「出厂禁用技能」三项是 ADR-047 第 1 层列出的 Code Puppy 权威,
  登记册里还没有条目(52 条),补齐属 I-02。
- **F-13 项目插件能借 MCP 身份与权威**(R1 审计 M1,审计方用真实随包清单复现)[读]。扇出只拒已存在的有效名(`plugin-fanout.ts:68-74`),对自己的工具放行任意 `update`(`:75-79`);
  `identity.ts:118-130` 只看命名空间:命名空间等于某个已配置 MCP 的规范名 ⇒ `mcp:<server>:<tool>` 身份 + 该 server 的权威(Office 即 `codepuppy-bundled`)。
  于是同意过的项目插件用新名字 + `namespace:"codepuppy-word"` 就能拿到 `mcp:codepuppy-word:…` 与 `codepuppy-bundled`,保存的 plugin 类停用对它不再生效。**这是换代分支今天的缺陷。**
- **F-14 ext 的 JSONC 剥离器会改写字符串**(M2)[测]:`project-config.ts:255` 对整段文本跑尾逗号正则,`{"command":{"c":{"template":"x,}"}}}` 读出 `x}`;
  main 的抄本同一行(`codepuppy-ext-trust.ts:90`);`register.ts` 用它读、再整份写回,会把改坏的字符串落盘。`origin/alpha` 上同一正则也在(`project-config.ts:251`)。
  引擎自己读配置用 `jsonc-parser`(`core/src/config/variable.ts:6`、`core/src/config.ts:6`,3.3.1,ui-mac 同版本)。

## 4. 接口契约

### API

不适用:不加、不改 HTTP 接口与插件 RPC。

### 数据

**磁盘上的文件不改形状、不迁移**(§10 R2)。用户 `<环境根>/codepuppy.jsonc` 与项目 `<项目>/.codepuppy/codepuppy.jsonc` 现有的字节就是「Code Puppy 扩展文档 v1」。
用户文档照 I-07 G4 由引擎直接读;Code Puppy 不在这条路上插任何翻译(§4.2)。定制中心的账本、事务前像与回执不受影响。

### 事件 / 配置

#### 4.1 登记集合 `CodePuppyExtensionSet` v1(这就是那份「扩展清单」)

位置:`packages/ext/src/codepuppy-extensions/`(Code Puppy 自有包里的新目录;不 import `node:fs`;对 `@opencode/*` 只做类型 import;唯一运行时依赖 `jsonc-parser`)。
归属:ext 持有;ui-mac 主进程与 sidecar 按既有先例 import 它(`codepuppy-config-injection.ts:47-52`)。

```ts
export const CODEPUPPY_EXTENSIONS_VERSION = 1

export type ExtensionScope = "factory" | "cloud" | "user" | "project"
/** 进引擎的槽位,由来源决定(§4.5 表),条目不能自报。 */
export type Slot =
  | "floor"          // start() 的 config.content:设置后加载者胜,压过项目层与用户文档
  | "factory-layer"  // I-07 G4 的 engine-global/opencode.jsonc(全局层):用户文档、项目层、内联都能盖过它;policy 先加载者胜
  | "transform"      // ext 在每个 Location 的 setup 里经插件 transform / 扇出登记

export type Rule = { action: string; resource: string; effect: "allow" | "deny" | "ask" }

type Origin = { scope: ExtensionScope; slot: Slot; source: string /* 只用于诊断:文件 + 键路径,或 "factory:<id>" */ }

export type Registration = Origin & (
  /** server 是引擎原生形状(`Mcp.ServerConfig` 的结构):出厂与云由 Code Puppy 直接写,项目经引擎自己的归一化得到(§4.2)。 */
  | { kind: "mcp"; name: string; server: Record<string, unknown> }
  | {
      kind: "agent"; name: string
      description?: string; system?: string; mode?: "primary" | "subagent" | "all"
      model?: { providerID: string; id: string; variant?: string }   // 与 Agent.Info.model 同形(F-05)
      hidden?: boolean; disabled?: boolean
      permissions?: Rule[]            // 只出现在 factory(档位 agent);project 永不(§4.4)
    }
  | { kind: "command"; name: string; template: string; description?: string; agent?: string; subagent?: boolean }
  | { kind: "skill-source"; location: string }        // 绝对路径或 "./.codepuppy/skills";原样交给引擎
  | { kind: "skill-deny"; name: string }              // 出厂永久禁用(I-07 的常量)
  | { kind: "plugin"; path: string }                  // 只 factory:ext 插件目录
  | { kind: "plugin-removal"; id: string }            // 只 factory:"opencode.config.compatibility"
  | { kind: "project-plugin"; file: string }          // 只 project:.codepuppy/plugins/*.js,已过准入
)

export type CodePuppyExtensionSet = { readonly v: 1; readonly entries: readonly Registration[] }
```

- **没有 `authority` 字段**:权威不能被声明,只能由 ext 按启动文档里的证据铸(§4.6)。
- **工具不在集合里**:工具是代码。ext 自己的工具只经 ext 的 `tool.transform` 登记,它们的清单是构建产物 `bundled-tools.json`;项目插件的工具经 `project-plugin` 的扇出进来。
- **用户文档不进集合**:它由引擎直接读(I-07 G4)。集合里的用户作用域登记只有两类不在文档里的真源:远程 MCP 记录、已启用技能的当前代目录。
- 集合只在内存里,不落盘;`v` 不等即 `CodePuppyExtensionsError("version")`。

#### 4.2 扩展文档 v1:一份字段表、一个读取器

**文档是什么**:一份用 OpenCode v1 键写的 OpenCode 配置文档。字段的**含义一律是引擎的**(上游 v1 归一化),Code Puppy 不另写一套含义;
Code Puppy 管的是「各写方可以往里写哪些字段」与「Code Puppy 自己怎么读它」。

**字段表**(写方可写的全集,= 今天各写方授权表的并集,去掉引擎会静默丢掉的两项):

| 节 | 字段 | 写方 |
| --- | --- | --- |
| `mcp.<名>` | 本地:`type:"local"`、`command`、`cwd`、`environment`、`enabled`、`timeout`;远程:`type:"remote"`、`url`、`headers`、`oauth`、`enabled`、`timeout` | 定制中心(`SAFE_MCP_FIELDS` 去掉 `disabled`)、`codepuppy_register`(去掉 `args`、`disabled`) |
| `agent.<名>` | `description`、`prompt`、`mode`、`model`、`variant`、`temperature`、`top_p`、`steps`、`hidden`、`disable`、`color`、`permission`、`tools` | 定制中心与 agent Markdown 安装、治理、`codepuppy_register` |
| `command.<名>` | `template`、`description`、`agent`、`model` | 定制中心、治理、`codepuppy_register` |
| `skills` | `{paths: string[]}` | 启动对账、`codepuppy_register`、生态导入 |
| `permission.skill.<名>` | `"allow" \| "deny" \| "ask"` | 治理(只用户文档) |

- `permission` 的内容(含 v1 动作名 `bash` / `task` / `write` / `patch` / `apply_patch`)、`model` 的 provider id(含 `azure-cognitive-services` / `google-vertex-anthropic`)
  原样接受、原样写 —— 由引擎按它的规则改名(F-03)。随包 agent 示例、agent Markdown 安装与 `agent-creator` 引导写出的内容因此都照常可写(R1 M4、M5)。
- `disabled`:引擎读 v1 条目时丢掉它(F-03 同类),今天写进去的服务器照样启动。写方改为在写之前把 `disabled: true` 换成 `enabled: false`;`args` 从 `register.ts` 删掉、遇到即拒。
  Code Puppy 自己的安装计划从来只写 `enabled: false`(`ext-install-planner.ts:959,1403`)。
- 版本:文档里没有 `codepuppy` 键 ⇒ v1(今天所有文件)。将来改形状 ⇒ 写方写 `"codepuppy": <n>` 并带上它的读法与一次性迁移;读到不认识的 n ⇒ 诊断 `version`,该文档的扩展区一条不读。
- **引擎读 v1 字段的依赖要钉住**:一条 I-03 同类的探针对字段表的每个字段各放一条样本,经引擎的归一化断言该字段被读到、无诊断;
  反向臂 = 字段表里加一个引擎会丢的字段(如 `args`)⇒ 红。上游哪天删掉 v1 兼容,这条探针当天变红,修法只在一处:按上面的版本规则写一次迁移。

```ts
export type DocumentScope = "user" | "project"
export type ExtensionDiagnostic = {
  scope: DocumentScope | "factory" | "cloud"
  file: string
  path: readonly string[]
  code: "invalid" | "unsupported" | "version" | "consent-required" | "not-applied" | "shadowed" | "normalize"
  message: string                 // 只写原因;从不写值(headers / environment 可能带密钥或 {file:} 引用)
}

/** 唯一的扩展文档文本解析:jsonc-parser 的 parse(allowTrailingComma: true),与引擎同一个库;字符串内容一字不改(R1 M2)。 */
export function parseExtensionsDocument(file: string, text: string | undefined):
  | { ok: true; document: Record<string, unknown> }       // undefined 文本 ⇒ 空对象
  | { ok: false; diagnostic: ExtensionDiagnostic }        // 语法错误或根不是对象 ⇒ code "invalid"

/** 每个写方在写扩展区之前调用:字段在不在字段表、类型对不对。写方自己的授权表(谁能写哪几节)照旧各自持有,但必须是字段表的子集。 */
export function validateExtensionEntry(
  scope: DocumentScope,
  section: "mcp" | "agent" | "command" | "skills" | "permission.skill",
  name: string | undefined,
  value: unknown,
): { ok: true } | { ok: false; diagnostic: ExtensionDiagnostic }

/** 项目文档 → 登记。admission 先作用于原始各节,再交引擎的归一化,再挑出项目 transform 用得上的字段(§4.5)。 */
export function readProjectDocument(input: {
  file: string
  text: string | undefined
  consent: boolean | null
  normalize: EngineConfigNormalize          // §4.2 末:sidecar 发布的引擎归一化
}): { registrations: Registration[]; diagnostics: ExtensionDiagnostic[] }

export class CodePuppyExtensionsError extends Error {
  readonly name = "CodePuppyExtensionsError"
  constructor(readonly reason: "version" | "emit", readonly path?: string)
}
```

**谁读、怎么读**:

| 读方 | 读法 |
| --- | --- |
| 引擎,用户文档 | I-07 G4:`config.file` 直接是 `codepuppy.jsonc`,注入成功与失败两条分支给的是同一个文件(R1 M6);Code Puppy 不拆、不重排、不改写其中任何一节,`permission` 与 `permissions` 的先后完全由引擎按文档原样决定(R1 M3) |
| ext,项目文档 | `readProjectDocument`;只读 `mcp`、`agent`、`command`、`skills` 四节,其余键不看(今天同) |
| 写方的读改写(`register.ts`、生态导入、定制中心、治理) | `parseExtensionsDocument` 读;定制中心与治理照旧用 `jsonc-parser` 的 `modify` 保留注释写回;`register.ts`、生态导入整份重写时也先经它读 |
| 同意弹框的可执行物清单 | `readProjectDocument` 以 `consent:false` 读出的 `consent-required` 里 `mcp` 与 `project-plugin` 两类;弹框内容同今天 |

**项目文档用引擎自己的归一化**(取代 `engine-transforms.ts` 的手写翻译,F-02、F-03):

```ts
// packages/ui-mac/engine/engine-embed.ts(Code Puppy 自有,引擎 bundle 入口)多导出一项;core 本来就在这个 bundle 里
export { ConfigNormalize } from "@opencode/core/config/normalize"
// sidecar:装入引擎模块之后、ext 装载之前发布一次,形状同 in-process-engine.ts:15-24
globalThis[Symbol.for("codepuppy.engine.configNormalize")] = ConfigNormalize.normalize
// ext:
export type EngineConfigNormalize = (input: unknown) =>
  | { type: "normalized"; encoded: Readonly<Record<string, unknown>>; diagnostics: readonly { kind: string; path: readonly string[]; message: string }[] }
  | { type: "rejected"; diagnostics: readonly { kind: string; path: readonly string[]; message: string }[] }
export function engineConfigNormalize(): EngineConfigNormalize | undefined   // 未发布 ⇒ undefined(仓内 CLI 宿主、ext 单测;单测注入真的 @opencode/core 函数)
```

- 生产里未发布 ⇒ 这个 Location 不载项目文档,记一行;出厂与云的 transform 登记照常(不让 setup 失败,今天 `plugin.ts:92-93` 的规则)。
- 项目文档里 `{env:…}` / `{file:…}` 替换今天就不做(只有引擎读配置文件时做),本方案不改。

#### 4.3 各作用域放在哪、谁写

| 作用域 | 来源(全是今天已有的权威,本方案不新增文件) | 进集合的方式 | 写方 |
| --- | --- | --- | --- |
| factory | 代码:`factoryExtensions(bootstrap)` —— 四个档位 agent(文字取 `ui-mac/src/main/codepuppy-agents.ts`,先例 `context-injection.ts:57`;`switches.automationDisabled` / `readonlyDisabled` 置位时不出对应条目)、`/init` `/review` 与三条提示词接管(`codepuppy-prompts.ts`;`switches.promptRebrandDisabled` 置位时不出)、出厂技能目录(`skills.factoryDirs`)、出厂禁用技能(I-07 常量)、ext 插件目录(`paths.extPlugin`)与兼容插件移除指令(`switches.ecosystemInherit` 置位时不出) | 纯函数 | 构建 |
| cloud | 启动文档 `cloudMcp` + 当刻代付判据 | `cloudExtensions(bootstrap, platformPays)` | main |
| user | 远程 MCP 真源(`readMcpServerRecords`)、已启用技能当前代目录(`skillGenerationLiveDirs`);**用户文档本身不进集合**,由引擎直接读 | 两个既有读函数,在 sidecar 注入与技能监听里调用 | 定制中心、治理、启动对账 |
| project | `<项目>/.codepuppy/codepuppy.jsonc`、`.codepuppy/skills/`(目录约定)、`.codepuppy/plugins/*.js`(目录约定)、同意记录 `.codepuppy/prefs.json` | `readProjectDocument` + 插件目录列举,在 ext 每个 Location 的 setup 里 | `codepuppy_register`、生态导入、用户 |

```ts
import type { CodePuppyBootstrap } from "../../../util/src/codepuppy-bootstrap"   // I-07 §4.1
/** 出厂登记,三个槽位都从这里取(sidecar 取 floor / factory-layer,ext 取 transform)。纯函数;同一启动文档 ⇒ 同一结果。 */
export function factoryExtensions(bootstrap: CodePuppyBootstrap): Registration[]
/**
 * 云登记:floor 那一条按 platformPays(当刻 CODEPUPPY_MCP_TOKEN 密钥文件在场,sidecar 判)与 kill-switch 取三形之一;
 * transform 那一条只在 cloudMcpArmed(bootstrap) 时出现,与 platformPays 无关。withheld = floor 那条是中和条目 ——
 * 注入用同一个值给 isCloudMcpWithheld 赋值(今天 codepuppy-config-injection.ts:570 的同一判决)。
 */
export function cloudExtensions(bootstrap: CodePuppyBootstrap, platformPays: boolean): { registrations: Registration[]; withheld: boolean }
```

#### 4.4 准入(同意门)—— 一个函数、一张表

```ts
/** 唯一的同意判法:version === EXTENSIONS_CONSENT_VERSION && granted === true(main 现有语义);main 的弹框与 ext 的闸都调它。 */
export function projectConsent(prefsText: string | undefined): boolean
export const EXTENSIONS_CONSENT_VERSION = 1      // 从 codepuppy-ext-trust.ts 搬来,main import
```

| 项目文档 | `mcp` | agent 文本(description / prompt) | agent 控制(model / variant / mode) | agent 其它(permission / tools / disable / hidden / temperature / top_p / steps / color) | `command` | `skills` | 项目插件 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| consent = true | 收 | 收 | 收 | 不用(今天 `applyAgents` 也不写,`engine-transforms.ts:76-98`),记 `not-applied` | 收(只用 template、description) | 只 `./.codepuppy/skills` | 收 |
| consent = false | 拒,`consent-required` | 收 | 拒,`consent-required` | 同上 | 收 | 只 `./.codepuppy/skills` | 拒,`consent-required` |
| consent = null(项目身份漂移) | 全拒 | 全拒 | 全拒 | 全拒 | 全拒 | 全拒 | 全拒 |

- 这就是今天 E6、E8 的门,集中到一处。变化有二:ext 的闸开始认同意版本(F-06;只影响没有 `version` 或版本不对、却写着 `granted:true` 的记录,由装载变为不装、main 重新弹框);
  不用的字段从静默改为记一行 `not-applied`(只是日志)。
- 出厂与云一律收。用户作用域不经准入:用户文档由引擎直接读;账本停用、会话级强制停用、XDG 全局里非治理 MCP 的默认拒绝、用户文档里非真源的远程条目,
  继续由内联文档里的中和条目承担(`ext-disabled-injection.ts`、`mcp-default-deny.ts`,不动)。

#### 4.5 登记器:每类一个,槽位由来源决定

`packages/ext/src/codepuppy-extensions/emit.ts` 是 Code Puppy 里**唯一**把登记集合写成引擎形状的地方;换代时只改它、外加 §4.2 的探针与归一化交接。

```ts
/** OpenCode 2 Config.Info 的子集;产出必须能被上游 Config.Info 解码且零诊断(注入今天的判据,codepuppy-config-injection.ts:121-123)。 */
export type EngineDocumentFragment = {
  plugins?: string[]; agents?: Record<string, unknown>; commands?: Record<string, unknown>
  skills?: string[]; mcp?: { servers: Record<string, unknown> }
}
export function emitDocument(set: CodePuppyExtensionSet, slot: "floor" | "factory-layer"): { fragment: EngineDocumentFragment; diagnostics: ExtensionDiagnostic[] }
/** 只在 ext setup 里、registerPolicy 之后、seal 之前调用(I3 冻结次序不变)。 */
export function emitTransforms(
  set: CodePuppyExtensionSet,
  context: Pick<Plugin.Context, "mcp" | "agent" | "command" | "skill" | "permission" | "session">,
  hooks: { fanOut: (file: string) => Promise<Plugin.Cleanup | void>; log: (line: string) => void },
): Promise<Plugin.Cleanup[]>
```

| 登记 | 来源 | 槽位 | 引擎落点(2.x) | 今天的出处(先后不变) |
| --- | --- | --- | --- | --- |
| ext 插件目录、`-opencode.config.compatibility` | factory | floor | `plugins` | `codepuppy-config-injection.ts:169-177` |
| 四个档位 agent | factory | floor | `agents.<id>`(含 `permissions`,有序表原样) | `:345-517` |
| 云 MCP 三形之一 | cloud | floor | `mcp.servers.codepuppy` | `:530-596` |
| 云 MCP 真定义(kill-switch 下) | cloud | transform | `MCPEditor.set`,在执行闸已注册的同一 setup 里 | `plugin.ts:267-274` |
| 远程 MCP 真源记录 | user | floor | `mcp.servers` | `codepuppy-config-injection.ts:612-625` |
| `/init` `/review` | factory | factory-layer | `commands` | `:333-343`;I-07 G4 写进 `engine-global/opencode.jsonc` |
| 出厂技能目录、已启用技能当前代、`./.codepuppy/skills` | factory / user | factory-layer | `skills` | `:109-117`;同上 |
| 提示词接管 general / explore / docs | factory | transform | `AgentEditor.update`:只写 `system`(docs 另写 description),已有 prompt 则让位 | `plugin.ts:255-260`、`codepuppy-prompts.ts:326-331` |
| 项目 mcp | project | transform | 归一化后的 `mcp.servers.<名>` 原样 `MCPEditor.set`,只在引擎里没有同名时 | `engine-transforms.ts:52-66` |
| 项目 agent | project | transform | `AgentEditor.update`:system、description、mode、model(按上游 `agent.ts:85-89` 落成 `{id, providerID, variant?}`);新 agent 缺省 `mode:"all"` | `engine-transforms.ts:81-98` |
| 项目命令 | project | transform | `CommandEditor.add`,模板只认 `$ARGUMENTS`(接口限制,F-05) | `engine-transforms.ts:100-135` |
| 出厂禁用技能 | factory | transform | `SkillEditor.remove` + `permission.hook("evaluate")` deny | `plugin.ts:309-317` |
| 项目插件 | project | transform | 扇出,带 `projectPluginContext`(§4.6 的命名空间规则) | `plugin.ts:331-351` |

- **MCP 只有一种含义**:出厂与云写的就是原生形状;项目条目经引擎自己的归一化(§4.2),与放在用户文档里由引擎读到的结果逐字相同 —— 两套翻译变一套,而且那一套是引擎的(F-02)。
- **权限规则不由 Code Puppy 合成**:登记器只写出厂档位 agent 自带的有序规则表,不把它和任何文档里的规则拼在一起;各层怎么叠由引擎按加载序决定(R1 M3)。
- **同名谁赢不变**:transform 槽里项目 agent > 出厂接管;项目 MCP 只补缺;floor 槽里与云 MCP 同名的真源记录跳过(今天 `codepuppy-config-injection.ts:613-616`);
  出厂层与用户文档同名时用户文档胜(I-07 G4 层序 5 > 4b)。输掉的那条记一行 `shadowed`。
- 注入失败路径(#613)仍写治理底线:只用 `factoryExtensions` 里的 `plugin` / `plugin-removal` 两类出 floor,不依赖任何读取器(今天 `:672`)。

#### 4.6 身份与权威

- **身份推导不变**(ADR-041,E10):仍从引擎注册表观察得出;保存的启停记录以规范身份为键,改推导会把用户已存的记录整份换键。
- **项目插件的工具一律落进 plugin 分支**(R1 M1):`projectPluginContext` 包住的编辑器
  - `add`:拒已存在的有效名(今天);**再拒带 `options.namespace` 的工具**(命名空间是引擎标记 MCP 工具的方式,项目插件不需要也不许声明);
  - `update`:只许改它自己的工具,且改完的结果不许带 `options.namespace`、有效名不许变(先在副本上跑改写,结果不合即拒,原工具不动);
  - 拒绝都按今天的格式记一行 `[@codepuppy/ext] project plugin tool <what> "<id>" refused: <why> (ADR-041)`。
  于是项目插件的工具既不在 ext 首次 transform 之前(不会是 builtin)、也没有命名空间(不会是 mcp),身份恒为 `plugin::<有效名>`、权威 `not-asserted`,按 plugin 类询问。
  反向臂:撤掉命名空间这一拒 ⇒ 用新名字 + `namespace:"codepuppy-word"` 的项目插件工具拿到 `mcp:codepuppy-word:…` 与 `codepuppy-bundled`(F-13 的复现),测试红。
- **权威只来自启动文档里的证据**:云(`cloudMcp.definition` 逐字相等)、随包 Office(`paths.officeMcpManifest`)、ext 自身(`paths.extBundledManifest` 摘要)。
  铸造函数保留三个(`authorityForMcp`、`bundledPluginTools`);任何扩展文档、任何作用域都给不出权威(集合没有该字段;字段表里也没有)。
- 每个 MCP 登记都以「已配置的 MCP server」进引擎,其工具落进 mcp 分支;插件工具只经 ext 自己或扇出进来,落进 plugin 分支。

## 5. 数据与失败

- 写边界:读取器、准入、登记器都只读;唯一写盘的仍是各写方、I-07 的出厂层文件(原子写)与 ext 的插件 transform。没有新的事务、重试或幂等问题。
  写方变化只有两处:`disabled: true` 写成 `enabled: false`;`register.ts` 拒 `args`。`register.ts` 与生态导入改经 `parseExtensionsDocument` 读,不再把被剥离器改坏的字符串写回(F-14)。
- 可达的失败窗口:

  | 窗口 | 怎么到达 | 结果 |
  | --- | --- | --- |
  | 用户文档解析不了 | 用户手误 | 引擎跳过这份文档并记警告,出厂层不受影响(I-07 G4 §4.7);首页「配置有语法错误」横幅报出来 |
  | 项目文档解析不了 | 同上 | 这个 Location 不载项目文档(今天同) |
  | 引擎归一化未发布 | 仓内 CLI 宿主;生产里只在 sidecar 缺陷时 | 不载项目文档,记一行;出厂与云照常 |
  | 归一化对项目某条出诊断或整份拒 | 手写了引擎不认的内容 | 引擎丢掉的就丢掉(与用户文档同一结果),记 `normalize` 诊断 |
  | 登记器产出被上游解码拒 | 登记器缺陷 | sidecar:走 #613 的注入失败上报;ext:该 transform 记日志,不让 setup 失败 |
  | 项目身份漂移 | 项目目录在读的过程中被换 | 准入全拒(今天同) |

## 6. 架构落点

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| 登记集合、字段表与读取器、准入与同意判法、出厂与云登记、登记器 | `packages/ext/`(`A@docs/architecture/modules.md:32`)新目录 `src/codepuppy-extensions/` | `jsonc-parser`(新依赖,版本同 core / ui-mac 的 3.3.1);对 `@opencode/*` 只类型 import;ui-mac 零依赖文字模块(先例 `context-injection.ts:57`)、util 的启动文档 | 引擎的 JSONC 库、引擎的 v1 归一化、`applyPromptTakeover`、注入的 `rules()` 表、`materializeCloudMcpConfig`、`readMcpServerRecords`、`skillGenerationLiveDirs` |
| 引擎 bundle 入口多导出 `ConfigNormalize`;sidecar 发布 | `packages/ui-mac/engine/engine-embed.ts`、sidecar(`modules.md:51`) | ui-mac → core(已有依赖,`codepuppy-models.ts:37` 先例) | `in-process-engine.ts:15-24` 的进程内交接形状 |
| sidecar 注入与技能监听改为:建集合 → `emitDocument` | `packages/ui-mac/` sidecar | ui-mac → ext(先例 `codepuppy-config-injection.ts:47-52`) | I-07 G4 的出厂层文件写入处 |
| ext setup 里的项目与出厂 transform 改为 `emitTransforms`;扇出加命名空间规则 | `packages/ext/` | — | `registerPolicy` / `seal` 次序(I3)、`projectPluginContext`、`installCloudMcp` |
| 写方校验 | 定制中心、治理、agent Markdown 安装(ui-mac main);`register.ts`、生态导入 | → ext | 各自的授权表 |

- **新目录**:放在 ext 而不是 util / schema —— core 不读它;ext 被 main import 有先例,ext 不许依赖 main 私有模块(`modules.md:32`)。目录在已有模块内,模块地图不需改。
- **新依赖**:ext 加 `jsonc-parser`。理由:它是引擎读配置用的库(F-14),换掉的是一个会改坏字符串、又被抄了一份的手写剥离器;同版本已在工作区。
- **收敛(K2,较现在更好)**:项目文档五种读法 → 一个解析 + 一个读取器(F-01);ext 手写的 v1 翻译(F-02,与引擎分叉)→ 直接用引擎的归一化,不再重述任何上游文法;
  同意两个判法 → 一个(F-06);两份 `stripJsonc` 删除(F-14);提示词接管一份文字两处消费 → 一个出厂登记;`register.ts` 的死字段删除。
- **架构约束**:K2 较现在更好;K1 不变 —— 档位载体规则表从 `codepuppy-config-injection.ts` 搬到出厂登记,仍只一份,constraints.md K1 那一行的位置随切片 D 同改。
  北极星:不新增接管,全部改动在 Code Puppy 自有包。ADR-040 不变。ADR-048:机制所在文件随切片移动的登记册条目在同一切片改写握法与测试名(决定不变,不退役);
  F-12 那三项若 I-02 尚未登记,由第一个改动其机制的切片先登记;M1 的命名空间规则并入 `adr041-identity-derivation` 的测试(反向臂见 §4.6)。
- **工程标准**:①不加配置键、不加选项;②每个值一个主人;⑤诊断是稳定的 `code`,日志只写文件与键路径,从不写值。
- **安全面**:威胁边界 = 项目文档与项目插件文件是不可信输入。不变量(各有一条会红的测试):
  S1 任何文档给不出权威;S2 项目可执行物只在当前版本的同意之后装载;S3 项目 agent 永不带 `permissions`;S4 远程 MCP 只来自 main 独占真源;
  S5 账本停用与会话级强制停用仍在 floor 槽压过一切;S6 没有写 `plugin[]` 的路径;S7 诊断与日志不含值;**S8 项目插件的工具拿不到 mcp / builtin 身份与任何权威**;
  **S9 Code Puppy 不拆、不重排任何文档里的权限规则**。
- **被否决的替代**:
  1. 磁盘换成新的 Code Puppy v2 格式并迁移文件 —— 碰定制中心事务前像与恢复日志,换不来任何能力。
  2. 磁盘改写成 OpenCode 2 原生形状 —— 下次换代再迁一遍。
  3. 每类只用一个引擎槽位(全走 ext transform)—— 项目 `opencode.json` 的同名 agent 会盖过档位载体;出厂命令也会压过项目命令(F-04)。
  4. Code Puppy 自己读用户文档、把扩展区译成原生键再交引擎(初稿 R2 / R8)—— 与 owner 已批的 I-07 G4(引擎直接读 `codepuppy.jsonc`)冲突,
     而且拆出 `permission.skill` 会改变规则先后(R1 M3 实测 deny → allow)、注入失败分支会绕回原文件(M6)。
  5. 拒收需要上游解释的 v1 字段(初稿 R3)—— 随包 agent、agent Markdown 安装、`agent-creator` 正常流程都会写 `bash`(M4);旧 provider id 合法(M5)。
  6. 在 ext 里重述上游 v1 迁移并用测试钉住 —— 又一份替身(constraints.md 里同类已有三条);引擎 bundle 里现成的归一化可以直接交接(F-09)。
  7. 修 `stripJsonc` 的正则 —— 仍是手写的 JSONC 文法;引擎用 `jsonc-parser`。
  8. 让项目文档成为引擎配置层(把 `.codepuppy` 加进目录发现)—— 要接管 discovery,且 `.codepuppy/plugins` 会绕过同意自动装载(调查 C9)。
  9. 从登记推导工具身份、给项目插件工具记来源文件 —— 换键;只要拒掉命名空间,plugin 分支已经成立(§4.6)。

## 8. 拆分决定

不适用:只涉及 alpha-code 一个仓、一个负责方。开工依赖:#1662 换代合入 `alpha`;F-13、F-14 两个现网缺陷由编排器转进 #1662 修(§10),本方案的切片 B 若晚于该修复则继承它。
集成关系:切片 D 在 I-07 G1–G3(启动文档的键)与 G4(出厂层文件)之后;I-05 改的是 `core` 接管文件与适配器,不重叠;F-12 三项的登记与 I-02 协调。

## 9. 回滚

- 全部是代码;磁盘文件字节不变(写方只多做 `disabled` → `enabled:false` 的换写与 `args` 的拒收)。任一切片回滚 = revert,没有数据后果。
- **交付切片**(兼容性决定;提交顺序与文件归 plan.md):
  - **A 集合与登记器**:类型、字段表与解析、准入与同意判法、出厂与云登记、登记器、引擎归一化的导出与发布、§4.2 的字段探针;不接线。
  - **B 项目作用域**:ext 的项目 transform 与扇出改走集合(替掉 `engine-transforms.ts`、`mergeProjectConfig`、两份 `stripJsonc`);`register.ts`、生态导入、同意弹框改用解析、校验与读取器;
    同意版本;扇出命名空间规则(若 #1662 已修则只是搬进来)。依赖 A。
  - **C 用户文档写方**:定制中心、治理、agent Markdown 安装改用字段表校验与 `parseExtensionsDocument`;`disabled` 换写。引擎读用户文档的路不动(I-07 G4)。依赖 A,与 B 互不依赖。
  - **D 出厂与云**:档位 agent、出厂命令与技能、提示词接管、插件底线、云 MCP 改走 `factoryExtensions` / `cloudExtensions`。依赖 A、I-07 G1–G3 与 G4。
- **中间状态的唯一性按「作用域 × 类」算**:一个切片把一个作用域里它管的各类读法在同一个提交里整体切过去。B 之前项目 MCP 走 ext 旧翻译、用户 MCP 由引擎读(今天的状态);
  B 之后两者都是引擎的归一化 —— 任何提交里同一作用域的同一类只有一种读法。C 不改任何读法。
- **回滚次序与依赖相反**:先 D,再 B 或 C(互不依赖、谁先都行),最后 A;回滚 B 恢复 ext 旧翻译与旧剥离器(连同 F-14 的缺陷)。

## 10. 裁决与审查结论

| 送审前裁决(R1 后修订) | 依据与适用版本 |
| --- | --- |
| R1 「扩展清单」= 内存里的登记集合 `CodePuppyExtensionSet` v1,工具除外;位置 `packages/ext/src/codepuppy-extensions/` | §4.1;F-01;§6 |
| R2 **(改)** 磁盘不迁移;文档是用 OpenCode v1 键写的 OpenCode 配置文档,字段含义一律是引擎的;用户文档照 I-07 G4 由引擎直接读,Code Puppy 不插翻译;版本靠 `codepuppy` 键,缺省 v1 | I-07 G4(owner 已决定);R1 M3、M6 |
| R3 **(改)** 字段表 = 写方授权表的并集,去掉引擎会丢的 `args`、`disabled`(写方改写成 `enabled:false`);`permission` 内容与 provider id 原样接受;引擎读字段表的依赖由探针钉住 | R1 M4、M5、m1;F-03 |
| R4 每类一个登记器;槽位 floor / factory-layer / transform 按来源定,保持今天的先后;登记器不合成权限规则 | F-04、F-07;R1 M3 |
| R5 准入一张表、一个同意判法,ext 认同意版本 | F-06;§4.4 |
| R6 账本停用、会话级强制停用、默认拒绝不经准入,留在 floor 槽的中和条目 | 它们必须压过一切来源 |
| R7 **(改)** 身份推导不变;项目插件的工具拒带命名空间、改写不许加命名空间或换有效名,身份恒为 plugin;权威只从启动文档三种证据铸 | R1 M1;F-13;ADR-041 |
| R8 **(改)** 项目文档用 `jsonc-parser` 解析,经引擎 bundle 交接来的 `ConfigNormalize` 归一化;ext 不再重述任何 v1 文法 | R1 M2、M5、m1;F-09、F-14 |
| R9 项目命令仍只认 `$ARGUMENTS`、项目技能仍只认 `./.codepuppy/skills` | F-05;要补齐只能向上游要挂点(owner 2026-11-12 已同意提交 U9、U10) |
| R10 项目插件扇出机制不动,同意判定换成 R5 那一个,外加 R7 的命名空间规则 | ADR-040 后果第 5 条「处置另议」不在本方案 |
| R11 不新增接管、配置键、上游挂点;新依赖只有 `jsonc-parser` | I-05;工程标准 1;§6 |
| R12 **(改)** 交付物按派发书移到自有 slug `docs/specs/upgrade-extension-manifest/design.md`,id `DESIGN-upgrade-extension-manifest`,文档索引已重生成 | 文档合同只认 `spec.md` / `design.md` / `plan.md` |
| R13 **(新)** 切片依赖与中间状态按 I-07 已提交版(util、G1–G4)写;唯一性按「作用域 × 类」;回滚与依赖相反 | R1 m2;§9 |

**本方案带来的 owner 可见变化**(相对换代分支今天的行为;按派发书「行为变了必须点名」):

1. 正常使用无变化:界面、定制中心安装、随包 Office、云工具、技能、审批、用户 `codepuppy.jsonc` 的读法都同今天。
2. 项目 `.codepuppy/codepuppy.jsonc` 改成和用户文件同一种读法:项目 MCP 的 `cwd`、`timeout`、`codemode`、OAuth 设置开始生效;项目 agent 的 `variant` 与旧 provider id
   (`azure-cognitive-services`、`google-vertex-anthropic`)开始按引擎的规则解析;字符串里带 `,}` / `,]` 的内容不再被删掉一个逗号。本机没有项目文档。
3. 项目插件不能再给工具声明命名空间(被拒并记一行)—— 这堵住项目插件冒充 MCP 工具、拿到随包工具权威的路。本机没有项目插件。
4. `codepuppy_register` 拒收带 `args` 的 MCP 条目(今天写进去但从不生效);任何写方收到 `disabled: true` 都写成 `enabled: false`(今天引擎忽略 `disabled`,服务器照样启动)。
5. 写着 `granted:true` 但没有当前同意版本号的项目同意记录,不再让 ext 装载项目可执行物,改为重新弹同意框(main 今天就这样判)。本机没有这种记录。
6. 项目 agent 里不会生效的字段(`permission` 等)从静默忽略改为记一行日志。

**owner 已决定(2026-11-12)**:「同意，向上游提那 10 个扩展点需求」 —— U9、U10 提交上游。下表是决定前的原文。

| 事项 | 依据与后果 |
| --- | --- |
| 是否向上游 `anomalyco/opencode` 提两个挂点:U9 `SkillEditor` 接受技能目录;U10 `CommandEditor` 接受配置文法的命令(`$1…$N`、`` !`cmd` ``、agent、model、subagent) | 公开、以 owner 身份对外,与 I-05 的 U1–U8 同类。不提 ⇒ 项目命令只认 `$ARGUMENTS`、项目技能只认 `./.codepuppy/skills`(今天如此,承受者 0,F-10);提了且被接受 ⇒ 登记器里项目命令与技能两行换成新挂点,文档与准入不变 |

**审查记录**

| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| R1 · `fba8c401ce` · 全文 | Codex gpt-6.1-sol,会话 01a1cef1(只读静态审计 + 复现,代码 `0ae97f4561`) | **M1** 项目插件借 MCP 命名空间拿到 MCP 身份与 `codepuppy-bundled` —— 采纳 | §4.6 扇出拒命名空间、改写不许加命名空间或换有效名;S8;R7;反向臂即审计复现 | 现网缺陷(F-13)→ 编排器转 #1662 |
| 同上 | 同上 | **M2** 复用 `stripJsonc` 会改写字符串 —— 采纳 | §4.2 唯一解析改用 `jsonc-parser`(引擎同库);两份剥离器删除;R8;F-14 实跑 `x,}` → `x}` | 现网缺陷(F-14,`origin/alpha` 也有)→ 编排器转 #1662 |
| 同上 | 同上 | **M3** 拆出 `permission.skill` 改变规则先后 —— 采纳 | 不再拆:用户文档由引擎原样读(I-07 G4);登记器不合成权限规则;S9;R2、R4 | — |
| 同上 | 同上 | **M4** 被拒输入来自正常创建 / 安装流程 —— 采纳 | 取消拒收清单;`permission` 内容原样接受,随包 agent、Markdown 安装、`agent-creator` 写出的存量文件不动、照常生效;R3 | — |
| 同上 | 同上 | **M5** 旧 provider id 缺兼容决定 —— 采纳 | 用户文档由引擎改名;项目文档经引擎归一化,同一规则;R8 | 项目作用域今天不改名(`engine-transforms.ts:69-74`)→ 随 B 消失,列为现网缺陷 |
| 同上 | 同上 | **M6** 注入失败分支绕回原文件 —— 采纳 | 用户文档成功与失败两条分支都是同一个 `config.file`(I-07 G4),Code Puppy 在这条路上没有翻译可绕;§4.2 读方表 | — |
| 同上 | 同上 | **m1** 行为清单漏项(`disabled`、`codemode`、`maxSteps`、`variant`、项目 OAuth 驼峰)—— 采纳 | 读法统一成引擎的,`codemode`/`maxSteps`/`variant` 不再被拒;`disabled` 写方换写;项目 OAuth 开始生效;均列入可见变化 2、4 | — |
| 同上 | 同上 | **m2** 切片契约与 I-07 已提交版不齐 —— 采纳 | 依赖改为 util / G1–G4;唯一性按「作用域 × 类」;回滚与依赖相反;R13 | — |

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| 同意弹框也列出 agent 控制字段 | 今天弹框只列 MCP 与插件,ext 还按同意剥 agent 的 model / mode | 改弹框文案是用户可见变化,不在 I-06 | 下次改同意弹框时 |
| 项目 agent 的 `permission` 在 2.x 从不生效 | `agent-creator` 引导模型登记带 `edit/bash: deny` 的项目 agent(`SKILL.md:36-40`),2.x 的 ext 从不写 `permission`(`engine-transforms.ts:76-80`),这类「只读助手」实际能改文件;0.1.26 在同意后会生效(`origin/alpha` 的 `mergeProjectConfig` 保留它) | 是产品决定(项目 agent 能否带权限规则、只许收紧还是都许),不在 I-06 | 交编排器按 #1662 回归候选裁 |
| 项目文档里 `{env:}` / `{file:}` 不替换 | 用户文档由引擎替换,项目文档今天和之后都不替换 | 不在 I-06;要做需另一个交接 | 有人用到时 |
| I-03 探针 P3 / P4 / P5 / P11 在本机跑不绿 | 两次都超时在等引擎就绪,未判原因 | 不在 I-06 | 编排器跑门时 |
