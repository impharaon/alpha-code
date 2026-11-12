---
id: DESIGN-upstream-upgrade-readiness-i06
title: 一份扩展清单格式、每类一条登记通道 技术设计
summary: Code Puppy 带进引擎的工具、MCP、插件、agent、技能、命令,今天经十条路径、五个读法、两套 v1→2.x 翻译进入引擎;收成一份 Code Puppy 自有的登记集合(内存里一个类型)、一个文档读取器、一张准入表和每类一个登记器,磁盘上的文件不改形状,下次换代只换登记器
kind: tech-design
status: draft
spec: ""                 # 内部工作,无 spec。来源:alpha-work INT-upstream-upgrade-readiness I-06(owner U-02,2026-11-12)
spec_version: ""
review:
  rounds: 0
  reviewed_sha: ""
  verdict: ""
owners: [owner]
last_reviewed: 2026-11-12
---

# DESIGN-upstream-upgrade-readiness-i06｜一份扩展清单格式、每类一条登记通道 技术设计

只写决定。文件清单、提交顺序与测试由实现方的 plan.md 写。§3、§7 已退役,编号不复用。

## 1. 基线

- Spec:无。I-06 是内部工作,按派发书不建 spec;授权来源
  [alpha-work INT-upstream-upgrade-readiness I-06 @4c1b2c6](https://github.com/impharaon/alpha-work/blob/4c1b2c624b53619de97fa6bfa5679024d07abf17/docs/intents/INT-upstream-upgrade-readiness.md)
  (owner 2026-11-12 U-02「同意做」,每份方案单独送 owner 批)。规模 L。
- 覆盖:I-06「工具、MCP、插件、agent、技能、命令统一成一份扩展清单格式和一条登记通道」;派发书点名的决定:逐条清点登记路径;
  清单格式(schema、版本、各作用域放哪);每类一条进引擎的通道;身份 / 权威铸造与同意门怎样统一挂上;已有用户与项目文件的迁移;
  哪些不动;交付切片。
- 背景:P-04;ADR-048(已拿回的权威只许换接法)、ADR-040(任何安装路径不写 `plugin[]`)、ADR-041(工具身份)、ADR-047 第 1 层表
  「定制中心与扩展目录、第三方插件同意后才装载、外部技能默认拒」;owner 原话「界面当前的 alpha 才是唯一权威吧」「不可以因为 opencode 更新把经 codepuppy 拿回的唯一权威再封掉」。
- 兄弟方案(都是 draft,本方案只消费其决定):
  I-07 启动配置 `design-i07.md @c5ca06786b` —— R1 启动文档 `CodePuppyBootstrap` 只经 `StartCommand`、R7 出厂禁用技能名单改常量、R8 云 MCP 定义由 main 算;
  本方案的权威证据与出厂开关一律从该文档读(`cloudMcp`、`paths.officeMcpManifest`、`paths.extBundledManifest`、`skills.factoryDirs`、`switches.*`)。
  I-05 少改上游 `design-i05.md @98c4983437` —— R-08:不新增挂点、插件 MCP 域只有 list/transform/reload;本方案不加接管。
- 代码坐标:`E@` = `engine/1662-opencode2@4198d1a484`(本方案所引源文件与 `10034ce8c0` 逐字相同,其间只动了测试与文档);
  `A@` = `origin/alpha@01dbb1041a`。标记:[读] 读码;[测] 本次实跑;[推] 推断。

## 2. 地面真相

**问题**:Code Puppy 经哪些路径把六类扩展带进引擎;每条谁写、什么形状、过哪道门、身份与权威在哪铸、怎么进引擎、换代时坏在哪。
**范围**:`packages/ext`、`packages/ui-mac/src/main` 里写或读扩展的代码,以及它们依赖的 OpenCode 2 配置加载与插件接口。
定制中心的安装期包格式(签名信封 `HostExtensionPackageV1`、ManifestV2、账本 V3、事务与回执)是与 alpha-web 的跨仓契约,不随引擎代次变,不在范围内。
**停止条件**:每条路径的写方、读方、进引擎的槽位都对上代码坐标;同一份数据的两种读法实跑对比过一次。

### 2.1 路径清点

| # | 路径 | 写方与形状 | 门 | 身份 / 权威在哪定 | 怎么进引擎 | 换代时坏在哪 |
| --- | --- | --- | --- | --- | --- | --- |
| E1 | ext 自带工具(`codepuppy_reload/register/echo/access/ping`)与定制中心工具(`codepuppy_hub_search/install/status`) | ext 代码,promise 工具形状(`E@packages/ext/src/codepuppy-tools.ts:22-174`、`hub-tools.ts:71-135`) | 工具策略执行闸;安装恒问、自动化恒拒(`hub-tools.ts:56-59,106-113`) | `plugin:<ext 模块路径>:<名>`;`bundled-tools.json` 摘要对上才铸 `codepuppy-bundled`(`policy/bundled-plugin.ts:31-73`、`policy/identity.ts:143-152`),清单路径经 `CODEPUPPY_EXT_BUNDLED_MANIFEST` | ext `tool.transform` 的 `editor.add`(`plugin.ts:129-133`) | 插件工具形状 |
| E2 | 定制中心安装(用户作用域) | main:MCP 本地条目 `persistMcp`、agent `persistAgentEntry` 写用户 `codepuppy.jsonc` 的 v1 键(`ext-config.ts:477,780`;键表 `ALLOWED_TOP_KEYS` `:334` 注明「verified against opencode's V1 schema」);治理层把 `governance.json` 物化成 `agent.*` / `permission.skill.*` / `command.*` 叶子(`codepuppy-builtin-policy.ts:1-15`、`ext-config.ts:176-184`);远程 MCP 只写 main 独占的真源记录(#1381);技能写 `ext-store` 代与 `skills-enabled.json` | 安装确认框;账本停用与会话级授权在内联文档里压成中和条目(`ext-disabled-injection.ts`);用户文件里的远程条目被 `mcp-default-deny.ts` 中和 | MCP `mcp:<键>:<工具>`,不铸权威 | 用户文件**原样**并进显式文件(`engine-explicit-config.ts:37-60`),由上游 v1 兼容层解读(`core/src/config/normalize.ts:118-193,250-297`、`core/src/v1/config/*`);技能目录进显式 `skills`(`codepuppy-config-injection.ts:109-117`);真源记录进内联(`:596-609`);运行中由监听重写(`engine-explicit-config.ts:99-142`) | 上游删改 v1 兼容层 ⇒ 用户装的东西静默不载;写方的 v1 键表 |
| E3 | 随包 Office MCP(四个) | 定制中心目录安装,经 `ext-mcp-policy.ts` 写 main 模板(含 `{workspace}`)进用户文件的 `mcp.codepuppy-*`;启动对账重锚 | 目录安装 | 命令等于清单模板才铸 `codepuppy-bundled`(`identity.ts:104-110`),清单路径经 `CODEPUPPY_OFFICE_MCP_MANIFEST`;连上前按声明给工具(已接管的 `core/src/mcp/index.ts` + 自有 `codepuppy-first-party-mcp.ts`,登记册 `mcp-declared-tools-before-connect`) | 同 E2;`{workspace}` 由策略的 `mcp.transform` 每个 Location 替换(`policy/index.ts:133-140`) | 同 E2;MCP 运行时接管(I-05 R-08 保留) |
| E4 | 云 MCP | sidecar 注入按账户信号写三形之一(真定义 / 无凭据停用 / kill-switch 中和条目,`codepuppy-config-injection.ts:515-580`),完整定义经进程内环境总线交给 ext | 代付判据 + kill-switch | 生效定义逐字等于 DEF 才铸 `codepuppy-cloud`(`plugin/src/alpha-cloud-authority.ts:158-173`、`identity.ts:96-103`) | 内联 `mcp.servers.codepuppy`;kill-switch 下 ext 在 `mcp.transform` 里装真定义(`plugin.ts:267-274`) | MCP 配置与编辑器形状 |
| E5 | 出厂:四个档位 agent、`/init` `/review`、提示词接管 agent(general/explore/docs)、出厂技能目录、出厂禁用技能、ext 插件目录与 `-opencode.config.compatibility` | 档位 agent 写内联 `agents`(`codepuppy-config-injection.ts:330-502`);两条命令写显式 `commands`(`:318-328`,文字出自 ext `applyPromptTakeover`);提示词接管 agent 由 ext `agent.transform` 写(`plugin.ts:255-260,287-293`);技能目录经 `CODEPUPPY_FACTORY_SKILL_DIRS`;禁用名单经 env → ext `skill.transform` 与 `permission.hook`(`plugin.ts:309-317`);插件写内联 `plugins`(`codepuppy-config-injection.ts:169-177`) | 一方;逃生开关 | 上游内置 agent 为 builtin;技能无工具身份 | 内联 / 显式 / ext transform 三处 | 配置 `agents`/`commands`/`skills`/`plugins` 形状;`AgentEditor` |
| E6 | 项目文档 `<项目>/.codepuppy/codepuppy.jsonc` | `codepuppy_register`(`codepuppy-tools.ts:52-113`;字段表 `register.ts:15-19`,MCP 收 `args`)、生态导入 `registerProjectSkillsPath`(`ecosystem-import.ts:126-146`)、用户手写;v1 键子集 | `prefs.json` 同意:MCP 与 agent 控制字段(`project-config.ts:128-159,268-280`) | MCP `mcp:<键>:<工具>`,不铸权威 | ext 逐字段翻译进各编辑器(`engine-transforms.ts:34-135`、`plugin.ts:233-300`):MCP 只补缺、agent 只写 system/description/mode/model、命令只认 `$ARGUMENTS`;`skills.paths` 只有 `./.codepuppy/skills` 经显式相对条目生效(`codepuppy-config-injection.ts:94-102`) | 编辑器类型;翻译有损(F-02) |
| E7 | 项目技能目录 `.codepuppy/skills` | 生态导入、模型直接写盘 | 无(2026-11-12 裁决接受,`codepuppy-config-injection.ts:94-102`) | — | 显式 `skills` 的相对条目,上游按会话所在项目解析 | 相对条目语义 |
| E8 | 项目插件 `.codepuppy/plugins/*.js` | 项目自带 | 同意;包住的 Context 只许动自己的工具、不许回复审批(`plugin-fanout.ts:59-119`) | `plugin::<名>`,不铸权威;冲突拒绝(登记册 `adr041-collision-rejection`) | ext 扇出(`plugin-fanout.ts:130-176`、`plugin.ts:331-351`) | 插件本身就是 OpenCode 插件 API 代码:v1 函数插件在 2.x 已被拒(`plugin-fanout.ts:162-166`) |
| E9 | 生态导入 | 同意后转换导入(ADR-024):项目技能 → E7 并写 E6 的 `skills.paths`;项目 `CLAUDE.md` → `AGENTS.md`;全局 → 环境根 `instructions/`(内联 `instructions`,`codepuppy-config-injection.ts:282-298`) | 导入同意 | — | E6 / E7 / 上游 `AGENTS.md` / 内联 | 同 E6、E7 |
| E10 | 工具策略的身份与权威 | 观察引擎注册表:命名空间 = 已配置 MCP ⇒ mcp;ext 首次 transform 前已在 ⇒ builtin;其余 ⇒ plugin,来源只认 ext 自己(`identity.ts:114-153`、`policy/index.ts:81-87,130`);权威只来自 E1/E3/E4 三种证据 | — | 同左;保存的启停记录按规范身份做键(`catalog.ts` 的 `canonicalToolIdentity`) | 每个 agent 的尾部规则(`catalog.ts`) | 注册表顺序与命名空间语义(I-03 探针 P4) |

### 2.2 其它所依赖的事实

- **F-01 同一份文档,五种读法、四张字段表** [读]。项目文档:ext `mergeProjectConfig` + `stripJsonc`(`project-config.ts:130-184,220-256`)、
  main `listProjectExecutables` 里抄的一份 `stripJsonc`(`codepuppy-ext-trust.ts:39-60`)、`register.ts` 的读改写、`ecosystem-import.ts` 的 `jsonc-parser`;
  用户文档:main `ext-config.ts`(`jsonc-parser`,`SAFE_MCP_FIELDS` `:64`、`ALLOWED_TOP_KEYS` `:334`、`builtinPolicyPathAllowed` `:176`)与上游 v1 兼容层。
- **F-02 同一条 v1 MCP 条目,按作用域得到两个不同的引擎定义** [测]。bun 1.3.14,`E@cde023e817`(相关源文件同 `4198d1a484`),隔离 HOME / XDG,工作树运行前后 `git status` 均为空。
  输入 `{type:"local", command:[…], cwd:"/w", environment:{A:"1"}, enabled:false, timeout:9000}`:

  ```
  上游 ConfigNormalize.normalize(用户文件这条路): {type, command, cwd:"/w", environment, disabled:true, timeout:{startup:9000, catalog:9000, execution:9000}}
  ext toServerConfig(项目文件这条路):            {type, command, environment, disabled:true}           ← cwd 与 timeout 丢了
  ```
- **F-03 上游 v1 兼容层对 Code Puppy 写的字段怎么做** [测],同一次运行:`mcp.<名>` → `mcp.servers.<名>`;只写 `enabled` 的条目被丢并出诊断;
  MCP 的 `args` **被静默丢弃**(无诊断);agent `permission:{bash:"deny"}` → `{action:"shell"}`(改名由上游 `normalizeAction` 做,`core/src/v1/config/migrate.ts:27-32`);
  `temperature` → `request.body.temperature`;`tools:{webfetch:false}` → deny 规则;命令 `subtask` → `subagent`、`model:"p/m"` → `{providerID, model}`;
  `permission.skill.<名>` → 顶层规则 `{action:"skill", resource:<名>}`;`skills.paths` → `skills` 数组。
- **F-04 引擎的槽位与先后** [读]。加载序 managedPolicies → … → global → explicit → direct → project → content → managedSettings(`core/src/config.ts:363-373`);
  设置后加载者胜、policy 先加载者胜(`engine-explicit-config.ts:3-9`);插件激活 internal.pre → 按配置装的插件(ext)→ internal.post,配置 agent / 命令 / 技能插件在 post(`engine-transforms.ts:9-15`);
  内联文档里的 `{file:./x}` 按 Location 目录解析(`core/src/config.ts:287-296`);没有按目录注入配置的接口,只有目录发现(`.opencode`)。
  I-03 已在仓里为这些写了探针(`packages/ext/src/upstream-probes/config.test.ts` P3 / P5 / P11、`plugins.test.ts` P4);我在本机两次跑都卡在等引擎就绪的超时上(5 s / 15 s),不当结论用。
- **F-05 插件接口的编辑器** [读]。`MCPEditor.set` 收 `Mcp.ServerConfig`,而配置的 `ConfigMCP.Server` 就是同一个类型(`schema/src/config/mcp.ts:15`、`plugin/src/promise/mcp.ts`);
  `AgentEditor` 收 `Agent.Info`;`CommandEditor` 只有 `add({name, description, execute})`(`plugin/src/promise/command.ts`),没有模板、agent、model、子任务;
  `SkillEditor` 只收解析好的 `Skill.Info`,没有「加一个目录」(`plugin/src/promise/skill.ts`)。
- **F-06 同意:一份记录,两个判法** [读]。main `extensionsGranted` 要求 `version === 1 && granted === true`(`codepuppy-ext-trust.ts:23-26`);
  ext `readProjectExtensionsConsent` 只看 `granted === true`(`project-config.ts:268-280`)。同意版本一旦升级,main 会重新弹框而 ext 照旧装载;版本从未升过,今天到不了。
  弹框只列 MCP 与插件(`codepuppy-ext-trust.ts:39-53`),而 ext 还按同意门剥 agent 控制字段(`project-config.ts:155-159`)。
- **F-07 提示词接管的先后** [读]。`applyPromptTakeover` 遇到已有 prompt 就让位(`codepuppy-prompts.ts:326-331`),ext 在合并项目文档之后才调它(`plugin.ts:255-260`)
  ⇒ 项目同名 agent > 出厂接管 > 上游内置。出厂 `/init` `/review` 在显式层(`codepuppy-config-injection.ts:318-328`)。
- **F-08 权威证据今天全走环境变量,I-07 把三样都搬进启动文档** [读]:云 DEF(`alpha-cloud-authority.ts:164`)、Office 清单(`identity.ts:104`)、ext 清单(`bundled-plugin.ts:36`)。
- **F-09 ext 不能直接调上游的 normalize** [读]:`core/src/v1/config/migrate.ts:11-12` import `../../provider.js` 与 `../../model.js`(core 服务模块),
  进 ext 自包含 bundle 会把服务层整包带进来(与 constraints.md 里 `identity.ts` / `gate.ts` 那一行同一原因)。
- **F-10 本机存量** [测],只列键与字段名、不读值:用户文件 `codepuppy-state/env/prod/codepuppy.jsonc` 顶层只有 `$schema`、`skills{paths}`、`mcp`、`provider{}`;
  `mcp` 8 条(4 条随包 Office:`command,type`;4 条定制中心安装:`command,type` 与 `cwd`/`enabled`/`environment`/`timeout` 的组合);
  没有 `agent`、`command`、`permission`、`plugin`;`governance-materialized.json` 0 条;远程 MCP 真源 0 条;
  `~` 下三层内找到的项目 `.codepuppy` 目录 1 个,只有 `attachments`、`runs`,没有项目文档与项目插件。除本机外零租户。
- **F-11 ADR-040 已封死用户作用域插件**:任何安装路径往 `plugin[]` 加元素一律拒(`engine-plugin-seal.ts:1-11`);第三方代码进引擎只剩 E8 一条。
- **F-12 登记册** [读]:身份、权威铸造、冲突拒绝、定制中心恒问都有在役条目;「项目可执行物同意后才装」「外部生态默认拒」「出厂禁用技能」三项是 ADR-047 第 1 层列出的 Code Puppy 权威,
  登记册里还没有条目(`docs/architecture/codepuppy-authority-registry.json`,52 条),补齐属 I-02。

## 4. 接口契约

### API

不适用:不加、不改 HTTP 接口与插件 RPC。

### 数据

**磁盘上的文件不改形状、不迁移**(§10 R2)。用户 `<环境根>/codepuppy.jsonc` 与项目 `<项目>/.codepuppy/codepuppy.jsonc` 现有的字节就是「Code Puppy 扩展文档 v1」;
只是从此由 Code Puppy 自己的读取器解读(§4.2),不再交给上游的 v1 兼容层。定制中心的账本、事务前像与回执不受影响(写方写出的字节不变)。

### 事件 / 配置

#### 4.1 登记集合 `CodePuppyExtensionSet` v1(这就是那份「扩展清单」)

位置:`packages/ext/src/codepuppy-extensions/`(Code Puppy 自有包里的新目录;纯模块,不 import `node:fs`,对 `@opencode/*` 只做类型 import)。
归属:ext 持有;ui-mac 主进程(sidecar 里的注入、定制中心与治理的写方、生态导入、同意弹框)按既有先例 import 它(`codepuppy-config-injection.ts:47-52`)。

```ts
export const CODEPUPPY_EXTENSIONS_VERSION = 1

export type ExtensionScope = "factory" | "cloud" | "user" | "project"
/** 进引擎的槽位。由来源决定(§4.5 表),条目不能自报。 */
export type Slot =
  | "floor"      // start() 的 config.content:设置后加载者胜,压过项目层与显式层
  | "default"    // start() 的 config.file(合成的显式文件):项目层与内联可以盖过它
  | "transform"  // ext 在每个 Location 的 setup 里经插件 transform / 扇出登记

export type Rule = { action: string; resource: string; effect: "allow" | "deny" | "ask" }
export type ModelRef = { providerID: string; modelID: string; variant?: string }
export type McpOAuth = { clientId?: string; clientSecret?: string; scope?: string; callbackPort?: number; redirectUri?: string }
export type McpServer =
  | { type: "local"; command: string[]; cwd?: string; environment?: Record<string, string>; timeoutMs?: number }
  | { type: "remote"; url: string; headers?: Record<string, string>; oauth?: false | McpOAuth; timeoutMs?: number }

type Origin = {
  scope: ExtensionScope
  slot: Slot
  /** 只用于诊断与日志:文件路径 + 键路径,或 "factory:<id>"。 */
  source: string
}

export type Registration = Origin & (
  | { kind: "mcp"; name: string; server: McpServer; enabled: boolean }
  | {
      kind: "agent"; name: string
      description?: string; system?: string; mode?: "primary" | "subagent" | "all"; model?: ModelRef
      hidden?: boolean; disabled?: boolean; color?: string; steps?: number; temperature?: number; topP?: number
      permissions?: Rule[]           // 只出现在 factory / user;project 永不(§4.4)
    }
  | { kind: "command"; name: string; template: string; description?: string; agent?: string; model?: ModelRef; subagent?: boolean }
  | { kind: "skill-source"; location: string }                 // 绝对路径、项目相对 "./.codepuppy/skills",或上游接受的 URL;原样交给引擎
  | { kind: "skill-rule"; name: string; effect: Rule["effect"] }  // 用户治理的 permission.skill
  | { kind: "skill-deny"; name: string }                       // 出厂永久禁用(I-07 R7 的常量)
  | { kind: "plugin"; path: string }                           // 只 factory:ext 插件目录
  | { kind: "plugin-removal"; id: string }                     // 只 factory:"opencode.config.compatibility"
  | { kind: "project-plugin"; file: string }                   // 只 project:.codepuppy/plugins/*.js,已过准入
)

export type CodePuppyExtensionSet = { readonly v: 1; readonly entries: readonly Registration[] }
```

- **没有 `authority` 字段**:权威不能被声明,只能由 ext 按启动文档里的证据铸(§4.6)。
- **工具不在集合里**:工具是代码。ext 自己的工具只经 ext 的 `tool.transform` 登记(今天已是一条通道),它们的清单就是构建产物 `bundled-tools.json`;
  项目插件的工具经 `project-plugin` 的扇出进来。
- 版本:`v` 是整数;读到别的值即 `CodePuppyExtensionsError("version")`。集合只在内存里,不落盘,不跨进程(sidecar 与 ext 在同一进程,各自从同一组来源构建)。

#### 4.2 扩展文档 v1 与读取器

版本规则:文档里没有 `codepuppy` 键 ⇒ v1(今天所有文件)。将来改文档形状 ⇒ 写方写 `"codepuppy": <n>` 并带上对应读取器;
读到不认识的 n ⇒ 诊断 `version`,扩展区一条不读,其余键照旧透传(用户作用域)。读取器从不猜版本。

扩展区 = 下表各节,**正好是 Code Puppy 各写方今天写出的字段**(F-01、F-10)。其余顶层键与 `permission` 下 `skill` 以外的子键属用户手写的 OpenCode 配置,
用户作用域原样透传进显式文件(今天的行为,上游的文法由上游解读);项目作用域忽略(今天 `mergeProjectConfig` 也不看)。

| 节 | v1 条目(接受的字段) | 产出 | 拒收(该条跳过,诊断 `unsupported`) |
| --- | --- | --- | --- |
| `mcp.<名>` | 本地 `type:"local"`、`command:string[]`、`cwd?`、`environment?:Record<string,string>`、`enabled?`、`timeout?:正整数`;远程 `type:"remote"`、`url`、`headers?`、`oauth?: false \| {clientId?,clientSecret?,scope?,callbackPort?,redirectUri?}`、`enabled?`、`timeout?` | `mcp`,`enabled` 缺省 `true` | 名字是 `servers` 或 `timeout`;只有 `enabled` 的条目;其它字段(如 `args`、`codemode`) |
| `agent.<名>` | `description?`、`prompt?`(→ `system`)、`mode?`、`model?:"<provider>/<model>"`、`variant?`、`hidden?`、`disable?`(→ `disabled`)、`color?`、`steps?`、`temperature?`、`top_p?`、`permission?: 效果 \| {动作: 效果 \| {模式: 效果}}` | `agent` | `tools`、`options`、`maxSteps`;`permission` 里出现 v1 动作名 `bash`/`task`/`write`/`patch`/`apply_patch`;`model` 不是 `p/m` 形 |
| `command.<名>` | `template`、`description?`、`agent?`、`model?`、`subtask?`(→ `subagent`) | `command` | 其它字段 |
| `skills` | `{paths?: string[], urls?: string[]}` 或 `string[]` | 每项一条 `skill-source`(paths 在前) | 项目作用域里 `./.codepuppy/skills` 以外的项(2026-11-12 裁决不生效,改报诊断) |
| `permission.skill.<名>`(只用户作用域) | `"allow" \| "deny" \| "ask"` | `skill-rule` | 其它值 |

`permission` 展开规则:字符串 ⇒ `[{action:"*", resource:"*", effect}]`;对象按键序,值为字符串 ⇒ `{action, resource:"*"}`,值为对象 ⇒ 按键序每个 `{action, resource:<模式>, effect}`。
与注入里 `rules()`(`codepuppy-config-injection.ts:183-189`)同一算法;动作名原样,不做改名(v1 动作名在上表直接拒收)。

```ts
export type DocumentScope = "user" | "project"
export type ExtensionDiagnostic = {
  scope: DocumentScope | "factory" | "cloud"
  file: string
  path: readonly string[]
  code: "invalid" | "unsupported" | "version" | "consent-required" | "shadowed"
  message: string                 // 只写原因;从不写值(headers / environment 可能带密钥或 {file:} 引用)
}

/** 唯一的扩展文档读取器(含唯一的 JSONC 剥离;ext 的 stripJsonc 搬进来,main 里那份抄本删除)。 */
export function readExtensionsDocument(input: {
  scope: DocumentScope
  file: string                     // 只用于诊断
  text: string | undefined         // undefined = 文件不存在
  admission: Admission             // §4.4
}): {
  registrations: Registration[]    // 已过准入
  passThrough: Record<string, unknown>   // 只用户作用域非空:扩展区以外的键,原样
  diagnostics: ExtensionDiagnostic[]
}

/** 每个写方在写扩展区之前调用;写方自己的授权表(谁能写哪几节)不变,但必须是本表的子集。 */
export function validateExtensionEntry(
  scope: DocumentScope,
  section: "mcp" | "agent" | "command" | "skills" | "permission.skill",
  name: string | undefined,
  value: unknown,
): { ok: true } | { ok: false; diagnostic: ExtensionDiagnostic }

export class CodePuppyExtensionsError extends Error {
  readonly name = "CodePuppyExtensionsError"
  constructor(readonly reason: "version" | "emit", readonly path?: string)
}
```

- 文本解析不了或根不是对象 ⇒ 一条 `invalid`,零条登记、透传为空(用户:显式文件只剩 Code Puppy 那一层并记一行,与今天 `engine-explicit-config.ts:37-45` 相同;
  运行中改坏 ⇒ 监听保留上一份好的合成结果,与今天 `:113-117` 相同;项目:什么都不载,与今天相同)。单条坏 ⇒ 只跳过那一条。
- 写方的授权表照旧各自持有:定制中心(`SAFE_MCP_FIELDS`、`ALLOWED_TOP_KEYS`)、治理(`builtinPolicyPathAllowed`)、`codepuppy_register`(`ENTRY_FIELDS`,删掉 `mcp.args`)、生态导入(只写 `skills`)。
  「每张授权表 ⊆ 上表」由一条测试逐表判,已知坏样本:把 `args` 加回去 ⇒ 红。

#### 4.3 各作用域放在哪、谁写

| 作用域 | 来源(全是今天已有的权威,本方案不新增文件) | 读取器 | 写方 |
| --- | --- | --- | --- |
| factory | 代码:`factoryExtensions(bootstrap)`,本目录里唯一列出出厂登记的函数 —— 四个档位 agent(文字取 `ui-mac/src/main/codepuppy-agents.ts`,ext 已有此先例 `context-injection.ts:57`;`switches.automationDisabled` / `readonlyDisabled` 置位时不出对应条目)、`/init` `/review` 与三条提示词接管(`codepuppy-prompts.ts`;`switches.promptRebrandDisabled` 置位时不出)、出厂技能目录(启动文档 `skills.factoryDirs`)、出厂禁用技能(I-07 R7 常量)、ext 插件目录(`paths.extPlugin`)与兼容插件移除指令(`switches.ecosystemInherit` 置位时不出) | 无(纯函数) | 构建 |
| cloud | 启动文档 `cloudMcp` + 当刻代付判据(密钥文件在场性,今天 `codepuppy-config-injection.ts:219`) | `cloudExtensions(bootstrap, platformPays)` | main |
| user | `<环境根>/codepuppy.jsonc`;main 独占的远程 MCP 真源记录(`readMcpServerRecords`);已启用技能的当前代目录(`skillGenerationLiveDirs`) | `readExtensionsDocument` + 两个既有读函数,在 sidecar 注入与显式层监听里调用 | 定制中心、治理、启动对账 |
| project | `<项目>/.codepuppy/codepuppy.jsonc`、`.codepuppy/skills/`(目录约定,不在文档里列)、`.codepuppy/plugins/*.js`(目录约定)、同意记录 `.codepuppy/prefs.json` | `readExtensionsDocument` + 插件目录列举,在 ext 每个 Location 的 setup 里调用 | `codepuppy_register`、生态导入、用户 |

```ts
import type { CodePuppyBootstrap } from "../../../schema/src/codepuppy-bootstrap"   // I-07 §4.1
/** 出厂登记,四个槽位都从这里取(sidecar 取 floor / default,ext 取 transform)。纯函数;同一启动文档 ⇒ 同一结果。 */
export function factoryExtensions(bootstrap: CodePuppyBootstrap): Registration[]
/** 云登记:floor 那一条按 platformPays(当刻 CODEPUPPY_MCP_TOKEN 密钥文件在场,sidecar 判)与 kill-switch 取三形之一;
 *  transform 那一条只在 cloudMcpArmed(bootstrap)(I-07)时出现,与 platformPays 无关 —— ext 只取 transform 槽。 */
export function cloudExtensions(bootstrap: CodePuppyBootstrap, platformPays: boolean): Registration[]
```

#### 4.4 准入(同意门)—— 一个函数、一张表

```ts
export type Admission =
  | { scope: "factory" | "cloud" }
  | { scope: "user" }
  | { scope: "project"; consent: boolean | null }   // null = 项目身份漂移
/** 唯一的同意判法:version === EXTENSIONS_CONSENT_VERSION && granted === true(main 现有语义);main 的弹框与 ext 的闸都调它。 */
export function projectConsent(prefsText: string | undefined): boolean
export const EXTENSIONS_CONSENT_VERSION = 1      // 从 codepuppy-ext-trust.ts 搬来,main import
```

| 作用域 | `mcp` | agent 文本字段(description / system / hidden / color / steps / temperature / topP) | agent 控制字段(model / mode / disabled) | agent `permissions` | `command` | `skill-*` | `project-plugin` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| factory / cloud | 收 | 收 | 收 | 收 | 收 | 收 | — |
| user | 本地收;**文档里的远程条目拒**(远程只认 main 真源,#1381) | 收 | 收 | 收 | 收 | 收 | — |
| project,consent = true | 收 | 收 | 收 | **拒**(今天 `applyAgents` 从不写,`engine-transforms.ts:76-80`) | 收 | 只 `./.codepuppy/skills` | 收 |
| project,consent = false | 拒,诊断 `consent-required` | 收 | 拒(`consent-required`) | 拒 | 收 | 只 `./.codepuppy/skills` | 拒(`consent-required`) |
| project,consent = null | 全拒 | 全拒 | 全拒 | 全拒 | 全拒 | 全拒 | 全拒 |

- 这张表就是今天的行为(E2、E6、E8 的门),只是集中到一处;唯一的变化是 ext 的闸开始认同意版本(F-06)。
- 同意弹框列出的可执行物 = 以 `consent:false` 读一遍得到的 `consent-required` 诊断里 `mcp` 与 `project-plugin` 两类;弹框内容与今天一致。
- 账本停用、会话级授权的强制停用、XDG 全局里非治理 MCP 的默认拒绝**不经准入**:它们必须压过一切来源,继续由内联文档里的中和条目承担
  (`ext-disabled-injection.ts`、`mcp-default-deny.ts`,不动)。

#### 4.5 登记器:每类一个,槽位由来源决定

`packages/ext/src/codepuppy-extensions/emit.ts` 是 Code Puppy 里**唯一**把登记集合翻成引擎形状的地方;换代时只改它(与 I-03 探针)。

```ts
/** OpenCode 2 Config.Info 的子集;产出必须能被上游 Config.Info 解码且零诊断(注入今天的判据,codepuppy-config-injection.ts:121-123)。 */
export type EngineDocumentFragment = {
  plugins?: string[]; agents?: Record<string, unknown>; commands?: Record<string, unknown>
  skills?: string[]; permissions?: Rule[]; mcp?: { servers: Record<string, unknown> }
}
export function emitDocument(set: CodePuppyExtensionSet, slot: "floor" | "default"): { fragment: EngineDocumentFragment; diagnostics: ExtensionDiagnostic[] }
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
| 四个档位 agent | factory | floor | `agents.<id>`(含 `permissions`) | `:330-502` |
| 云 MCP 三形之一 | cloud | floor | `mcp.servers.codepuppy` | `:515-566` |
| 云 MCP 真定义(kill-switch 下) | cloud | transform | `MCPEditor.set`,在执行闸已注册的同一 setup 里 | `plugin.ts:267-274` |
| 远程 MCP 真源记录 | user | floor | `mcp.servers` | `codepuppy-config-injection.ts:596-609` |
| `/init` `/review` | factory | default | `commands` | `:318-328` |
| 出厂技能目录、已装技能当前代、`./.codepuppy/skills` | factory / user | default | `skills` | `:109-117` |
| 用户文档的 mcp / agent / command / skill-source / skill-rule | user | default | `mcp.servers` / `agents` / `commands` / `skills` / `permissions` | 今天原样交上游 v1 兼容层(E2) |
| 提示词接管 general / explore / docs | factory | transform | `AgentEditor.update`:只写 `system`(docs 另写 description),已有 prompt 则让位 | `plugin.ts:255-260`、`codepuppy-prompts.ts:326-331` |
| 项目 mcp | project | transform | `MCPEditor.set`,只在引擎里没有同名时 | `engine-transforms.ts:52-66` |
| 项目 agent | project | transform | `AgentEditor.update`:system、description、mode、model;新 agent 缺省 `mode:"all"` | `engine-transforms.ts:81-98` |
| 项目命令 | project | transform | `CommandEditor.add`,模板只认 `$ARGUMENTS`(接口限制,F-05) | `engine-transforms.ts:100-135` |
| 出厂禁用技能 | factory | transform | `SkillEditor.remove` + `permission.hook("evaluate")` deny | `plugin.ts:309-317` |
| 项目插件 | project | transform | 扇出,带 `projectPluginContext` | `plugin.ts:331-351` |

- **MCP 只有一个转换**,三个槽位共用(F-05:配置与编辑器是同一类型):本地 ⇒ `{type, command, cwd?, environment?, disabled?: true, timeout?: {startup, catalog, execution}}`;
  远程 ⇒ `{type, url, headers?, oauth?: false | {client_id, client_secret, scope, callback_port, redirect_uri}, disabled?, timeout?}`;`enabled:false` ⇒ `disabled:true`,`timeoutMs` 三项同值。
  对每一条读取器接受的 v1 条目,产出必须等于上游 `ConfigNormalize.normalize` 对同一条的产出(F-03 的映射),由对照测试判(§5)。
- agent 的 `temperature` / `topP` ⇒ `request.body`;`model` ⇒ `{providerID, model, variant?}`;命令同理。这些是引擎形状的知识,只住在登记器里。
- **同名谁赢不变**,登记器只照今天的结果排:default 槽里用户文档 > 出厂(今天 `composeExplicitDocument` 不让出厂顶掉用户命令,`engine-explicit-config.ts:53-56`);
  透传键里用户手写的 2.x 原生条目(`commands` / `agents` / `mcp.servers`)按名字压过登记器产出(今天 `:56` 同一规则);
  transform 槽里项目 agent > 出厂接管;项目 MCP 只补缺;floor 槽里云 MCP 名下的真源记录跳过(今天 `:597-600`)。输掉的那条记一行 `shadowed` 诊断。
- 注入失败路径(#613)仍写治理底线:失败分支只用 `factoryExtensions` 里的 `plugin` / `plugin-removal` 两类出 floor,不依赖任何读取器(今天 `codepuppy-config-injection.ts:654-657`)。

#### 4.6 身份与权威

- **身份推导不变**(ADR-041,E10):仍从引擎注册表观察得出。登记器记录的作用域不进身份 —— 保存的启停记录以规范身份为键,改推导会把用户已存的记录整份换键。
- **权威只来自启动文档里的证据**:云(`cloudMcp.definition` 逐字相等)、随包 Office(`paths.officeMcpManifest` 的模板与声明)、ext 自身(`paths.extBundledManifest` 摘要)。
  三种证据形态不同,铸造函数保留三个(`authorityForMcp`、`bundledPluginTools`);统一的是来源:**任何扩展文档、任何作用域都给不出权威**(集合没有该字段,读取器遇到 `authority` 一类字段按「其它字段」拒收)。
- 登记器保证所有 MCP 登记都以「已配置的 MCP server」进引擎,所以每个 MCP 工具都落进身份的 mcp 分支;插件工具只经 ext 自己或扇出进来,落进 plugin 分支并按 plugin 类询问。

## 5. 数据与失败

- 写边界:读取器、准入、登记器都只读;唯一写盘的仍是各写方(字节不变)、显式文件的合成(`writeExplicitConfig` 原子写,不变)与 ext 的插件 transform。没有新的事务、重试或幂等问题。
- 可达的失败窗口:

  | 窗口 | 怎么到达 | 结果 |
  | --- | --- | --- |
  | 文档解析不了 | 用户手误、外部工具写坏 | 用户:显式文件只剩 Code Puppy 那一层并记一行;运行中保留上一份好的(不变)。项目:不载(不变) |
  | 单条被拒 | 手写了表外字段或 v1 动作名 | 只跳过那条,记 `[codepuppy-extensions] <文件> <键路径>: <code>`(不写值) |
  | 登记器产出被上游解码拒 | 登记器缺陷 | sidecar:走 #613 的注入失败上报;ext:该 transform 记日志,不让 setup 失败(今天 `plugin.ts:92-93` 的规则) |
  | 项目身份漂移 | 项目目录在读的过程中被换 | 准入全拒(今天同) |
- **对照测试是切到 Code Puppy 读取器之前的闸**:以读取器 + 登记器对照上游 `ConfigNormalize.normalize`,输入覆盖各写方授权表里的每个字段组合,外加本机实测到的字段形状(F-10,用合成值);
  已知坏样本:去掉 `timeoutMs` 的映射 ⇒ 红。上游哪天删掉 v1 兼容层,这条测试随之失去对照物,改为钉住最后一次对照时的产出。
- 被拒的输入今天由上游转换或静默丢弃,之后是跳过并记一行;本机实测这些输入为 0 条(F-10)。

## 6. 架构落点

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| 登记集合类型、文档读取器、准入与同意判法、出厂登记、登记器 | `packages/ext/`(`A@docs/architecture/modules.md:32`)新目录 `src/codepuppy-extensions/` | 对 `@opencode/*` 只类型 import;取 ui-mac 零依赖文字模块(`context-injection.ts:57` 先例) | `stripJsonc`(搬入)、`applyPromptTakeover`、注入的 `rules()` 算法、`materializeCloudMcpConfig`、`readMcpServerRecords`、`skillGenerationLiveDirs` |
| sidecar 注入与显式层监听改为:建集合 → `emitDocument` | `packages/ui-mac/`(`modules.md:51`)sidecar | ui-mac → ext(`codepuppy-config-injection.ts:47-52` 先例) | `composeExplicitDocument` / `watchExplicitSources` 保留,输入换成登记器产出 + 透传 |
| ext setup 里的项目与出厂 transform 改为 `emitTransforms` | `packages/ext/` | — | `registerPolicy` / `seal` 次序(I3)、`projectPluginContext`、`installCloudMcp` |
| 写方校验 | 定制中心、治理(ui-mac main);`register.ts`、生态导入 | → ext | 各自的授权表 |
| 同意弹框的可执行物清单 | ui-mac main `codepuppy-ext-trust.ts` | → ext | — |

- **新目录**:放在 ext 而不是 schema 包 —— core 不读它(与 I-07 的启动文档不同);ext 被 main import 有先例,ext 不许依赖 main 私有模块(`modules.md:32`)。目录在已有模块内,模块地图不需改。
- **收敛(K2,较现在更好)**:项目文档五种读法 → 一个读取器(F-01);两套 v1 MCP 翻译 → 一个(F-02 实测分叉);同意两个判法 → 一个(F-06);
  main 里抄的 `stripJsonc` 删除;提示词接管一份文字两处消费 → 一个出厂登记;`register.ts` 的死字段 `args` 删除;用户安装不再依赖上游 v1 兼容层。
- **架构约束**:K2 较现在更好;K1 不变 —— 档位载体规则表从 `codepuppy-config-injection.ts` 搬到出厂登记,仍只一份,constraints.md K1 那一行的位置随切片 D 同改。
  北极星:不新增接管,全部改动在 Code Puppy 自有包。ADR-040 不变:集合里没有用户作用域插件,任何写方都不写 `plugin[]`。
  ADR-048:机制所在文件随切片移动的登记册条目在同一切片改写握法与测试名(决定本身不变,不退役任何条目);F-12 那三项若 I-02 尚未登记,由第一个改动其机制的切片先登记,反向臂 = 拿掉准入 / 移除指令 ⇒ 红。
- **工程标准**:①不加配置键、不加选项;②每个值一个主人(上条);⑤诊断是稳定的 `code`,日志只写文件与键路径,从不写值。
- **安全面**:威胁边界 = 项目文档与项目插件文件是不可信输入;用户文档由 Code Puppy 写方与用户手写。不变量(各有一条会红的测试):
  S1 任何文档给不出权威;S2 项目可执行物(MCP、agent 控制字段、插件)只在当前版本的同意之后装载;S3 项目 agent 永不带 `permissions`;
  S4 远程 MCP 只来自 main 独占真源;S5 账本停用与会话级强制停用仍在 floor 槽压过一切;S6 没有写 `plugin[]` 的路径;S7 诊断与日志不含值。
- **被否决的替代**:
  1. 磁盘换成新的 Code Puppy v2 格式并迁移文件 —— 碰定制中心事务前像与恢复日志,8 条真实条目,换不来任何能力;读取器已经让上游的代次变化碰不到文件。
  2. 磁盘改写成 OpenCode 2 原生形状 —— 下次换代再迁一遍,正是 I-06 要去掉的耦合。
  3. 每类只用一个引擎槽位(全走 ext transform)—— 配置 agent 在 post 里应用,项目 `opencode.json` 的同名 agent 会盖过档位载体;出厂命令也会压过项目命令(F-04)。
  4. 用户文档继续原样交上游 v1 兼容层 —— 用户装的东西继续押在上游兼容层上,并留着两套 MCP 翻译。
  5. 把被拒的 v1 字段翻译过来(重述上游 `normalizeAction`)—— 新增一处替身,而本机这类输入为 0;拒收、不解释。
  6. ext 直接调上游 `ConfigNormalize` —— 会把 core 的 Provider / Model 服务带进 ext bundle(F-09)。
  7. 让项目文档成为引擎配置层(把 `.codepuppy` 加进目录发现)—— 要接管 discovery,且会让 `.codepuppy/plugins` 绕过同意自动装载(调查 C9)。
  8. 从登记推导工具身份 —— 保存的启停记录整份换键(§4.6)。

## 8. 拆分决定

不适用:只涉及 alpha-code 一个仓、一个负责方。开工依赖:#1662 换代合入 `alpha`。集成关系:切片 D 在 I-07 切片 B(启动文档里的键)之后;
I-05 改动的是 `core` 接管文件与适配器,与本方案不重叠;F-12 三项的登记与 I-02 协调(§6)。

## 9. 回滚

- 全部是代码;磁盘文件字节不变,写方写出的字节不变(只是多拒几种表外字段)。任一切片回滚 = revert,没有数据后果。
- **交付切片**(兼容性决定;提交顺序与文件归 plan.md):
  - **A 集合与登记器**:类型、读取器、准入与同意判法、出厂与云登记、登记器、对照测试;不接线。可单独回滚。
  - **B 项目作用域**:ext 的项目 transform 与扇出改走集合(替掉 `engine-transforms.ts` 与 `mergeProjectConfig`);`register.ts`、生态导入、同意弹框改用读取器与校验;ext 的闸开始认同意版本;项目 MCP 的 `cwd` / `timeout` 生效。依赖 A。
  - **C 用户作用域**:显式层合成改为登记器产出 + 透传;定制中心与治理写方改用校验;表外字段开始被拒。依赖 A,与 B 互不依赖。
  - **D 出厂与云**:档位 agent、出厂命令与技能、提示词接管、插件底线、云 MCP 改走出厂 / 云登记;输入读启动文档。依赖 A 与 I-07 切片 B。
  - 规则:每一类登记连同它的读方在同一个提交里切过去,任何时刻一类登记只有一条进引擎的路。
- 若 owner 选了 I-07 的选项 (b)(Code Puppy 自有引擎全局配置目录),只改 §4.5 表里 default 槽出厂几行的落点,读取器与准入不变。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| R1 「扩展清单」= 内存里的登记集合 `CodePuppyExtensionSet` v1,一个类型覆盖六类(工具除外,是代码),位置 `packages/ext/src/codepuppy-extensions/` | §4.1;F-01;§6 新目录理由 |
| R2 磁盘不迁移:两份 `codepuppy.jsonc` 现有字节即扩展文档 v1;版本靠 `codepuppy` 键,缺省 v1,读取器不猜 | F-10;§6 否决 1、2 |
| R3 文档 v1 的字段 = 写方今天写的字段;需要上游解释语义才能翻的(v1 动作名、`tools`、`options`、`servers` 名等)拒收不翻 | F-03;CLAUDE.md「要么消费对方的决定,要么直接拒绝该输入,不要解释它」;本机 0 条(F-10) |
| R4 每类一个登记器;「一条通道」指 Code Puppy 里唯一的那段代码,引擎槽位按来源分 floor / default / transform 三种,保持今天的先后 | F-04、F-07;§6 否决 3 |
| R5 准入一张表、一个同意判法,ext 认同意版本 | F-06;§4.4 |
| R6 账本停用、会话级强制停用、XDG 默认拒绝不经准入,留在 floor 槽的中和条目 | 它们必须压过一切来源(`ext-disabled-injection.ts` 抬头) |
| R7 身份推导不变;权威只从启动文档的三种证据铸,文档给不出权威 | F-08;ADR-041;§4.6 |
| R8 MCP 一个转换,三个槽位共用;用户作用域切换前以对照上游 normalize 为闸 | F-02、F-03、F-05 |
| R9 项目命令仍只认 `$ARGUMENTS`、项目技能仍只认 `./.codepuppy/skills` | F-05;要补齐只能向上游要挂点(待 owner) |
| R10 项目插件扇出机制不动,只把同意判定换成 R5 的那一个 | ADR-040 后果第 5 条「处置另议」不在本方案 |
| R11 不新增接管、配置键、上游挂点 | I-05 R-08;工程标准 1 |
| R12 交付物路径按派发书写成 `design-i06.md`;user-level 文档合同(`specs.extra-file`)只认 `spec.md` / `design.md` / `plan.md`,与 I-07 R12 同一处置 | 交编排器定是否改名 |

**本方案带来的 owner 可见变化**(按派发书「行为变了必须点名」):

1. 正常使用无变化:界面、定制中心安装、随包 Office、云工具、技能、审批都同今天。
2. 只有手写了 Code Puppy 从不写的旧字段的人会看到差别:`codepuppy.jsonc`(用户或项目)里 agent 的 `tools` / `options`、agent 权限里的 `bash` / `task` / `write` / `patch` / `apply_patch`、
   名为 `servers` / `timeout` 的 MCP 条目、只写 `enabled` 的 MCP 条目 —— 今天由 OpenCode 转换或丢弃,之后这一条被跳过并在日志里点名文件与键。本机实测 0 条。
3. 项目 `.codepuppy/codepuppy.jsonc` 里 MCP 的 `cwd` 与 `timeout` 开始生效(今天只在项目作用域被丢,F-02)。本机没有项目文档。
4. `codepuppy_register` 拒收带 `args` 的 MCP 条目(今天写进去但从不生效)。

**待 owner 决定**(未批,不阻塞本方案其余部分)

| 事项 | 依据与后果 |
| --- | --- |
| 是否向上游 `anomalyco/opencode` 提两个挂点:U9 `SkillEditor` 接受技能目录;U10 `CommandEditor` 接受配置文法的命令(`$1…$N`、`` !`cmd` ``、agent、model、subagent) | 公开、以 owner 身份对外,与 I-05 的 U1–U8 同类。不提 ⇒ 项目命令只认 `$ARGUMENTS`、项目技能只认 `./.codepuppy/skills`(今天如此,承受者 0,F-10);提了且被接受 ⇒ 登记器里项目命令与技能两行换成新挂点,文档与准入不变 |

<!-- 每轮审查的回执行(delivery-review §3)写在下表。 -->

| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| 尚未送审 | — | — | — | — |

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| 同意弹框也列出 agent 控制字段 | 今天弹框只列 MCP 与插件,ext 还按同意剥 agent 的 model / mode / disable(F-06) | 改弹框文案是用户可见变化,不在 I-06 | 下次改同意弹框时 |
| `mcp-default-deny.ts` 里处理用户文档远程条目的那一支 | 切片 C 之后准入已拒,它成了重复防线,无害 | 不影响结论 | 改该文件时 |
| I-03 探针 P3 / P4 / P5 / P11 在本机跑不绿 | 两次都超时在等引擎就绪(5 s / 15 s),未判原因;本方案的先后事实按读码引用 | 不在 I-06 范围 | 编排器跑门时 |
| `configHealth` 拿一张 v1 顶键表判 XDG 全局文件(`ext-config.ts:1499-1536`) | 2.x 下可能误报 | 与登记通道无关 | 改该函数时 |
