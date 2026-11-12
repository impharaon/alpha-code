---
id: DESIGN-upstream-upgrade-readiness-i07
title: 主进程交给引擎与插件的启动配置收成一份 技术设计
summary: 主进程今天经二十多个 CODEPUPPY_* 环境变量、启动命令、sidecar 进程内环境把决定交给 sidecar、引擎与 ext;收成一份有类型、有版本、每代 sidecar 一份、只在内存里的启动文档,环境变量只留给非 Code Puppy 的读者
kind: tech-design
status: draft
spec: ""                 # 内部工作,无 spec。来源:alpha-work INT-upstream-upgrade-readiness I-07(owner U-02,2026-11-12)
spec_version: ""
review:
  rounds: 0
  reviewed_sha: ""
  verdict: ""
owners: [owner]
last_reviewed: 2026-11-12
---

# DESIGN-upstream-upgrade-readiness-i07｜启动配置收成一份 技术设计

只写决定。文件清单、提交顺序与测试由实现方的 plan.md 写。§3、§7 已退役,编号不复用。

## 1. 基线

- Spec:无。I-07 是内部工作(intent 标签 dev),按派发书不建 spec;授权来源
  [alpha-work INT-upstream-upgrade-readiness I-07 @4c1b2c6](https://github.com/impharaon/alpha-work/blob/4c1b2c624b53619de97fa6bfa5679024d07abf17/docs/intents/INT-upstream-upgrade-readiness.md)
  (owner 2026-11-12 U-02「同意做」,方案单独送 owner 批)。
- 覆盖:I-07「主进程传给引擎和插件的二十来个零散环境变量,收成一份有类型的启动配置」;派发书点名的决定:通道与键的清点、
  启动文档(schema 位置、ext 与已接管 core 怎么读、运行中的变化怎么传)、留下哪些通道及理由、密钥怎么不进去、迁移期兼容、交付切片;
  「Code Puppy 自有的引擎全局配置目录」只作为 owner 选项给出代价(§10「待 owner 决定」)。
- 背景:P-01 / ADR-048(已拿回的权威只许换接法);编排器定的顺序 I-05 → I-04 → I-07 → I-06,I-06 消费本设计 §4 的形状。
  owner 原话约束:「界面当前的 alpha 才是唯一权威吧」「不可以因为 opencode 更新把经 codepuppy 拿回的唯一权威再封掉」。
- 代码基线:`engine/1662-opencode2@b32116b2bc`(下文引用写作 `@b32116b2bc:path:line`;所引文件与 `df748c16e7` 逐字相同,
  `git diff --name-only df748c16e7 b32116b2bc` 只动了 engine-adapter 与 plan.md)。这份代码尚未进 `alpha`。

## 2. 地面真相

**问题**:主进程的决定经哪些通道到达 sidecar 进程里的注入、ext 与 Code Puppy 在引擎里的自有 / 接管代码;每个键谁写、谁读、运行中会不会变;
哪些通道必须留下。**范围**:ui-mac 主进程与 sidecar、`packages/ext`、`packages/{core,plugin,schema}` 里 Code Puppy 自有或已接管的文件。
WSL 宿主(`wsl/sidecar.ts` 起的是 WSL 里的 OpenCode CLI,不经 `createSidecarEnv`)、只被主进程自己读的 `CODEPUPPY_*`
(`CODEPUPPY_EXT_DISABLE`、`CODEPUPPY_ENV_BASE_DIR`、`CODEPUPPY_OPENCODE_HOME`、`CODEPUPPY_MIGRATE_ENABLE`、`CODEPUPPY_SECRETS_DISABLE`、
`CODEPUPPY_CONFIG_HEALTH_DISABLE`)不过这道边界,不在范围内。**停止条件**:sidecar 进程里每一处 `CODEPUPPY_*` 读取都对上写方;
每条非环境通道的运行中变化路径都找到。下文 [读] = 读码,[测] = 本次实跑,[推] = 推断。

### 2.1 通道

| # | 通道 | 写方 → 读方 | 运行中会不会变 | 去向 |
| --- | --- | --- | --- | --- |
| C1 | sidecar 进程环境 | main 每次 fork:`createSidecarEnv()` 白名单 + 直接赋值(`@b32116b2bc:packages/ui-mac/src/main/server.ts:486-517`;白名单 `sidecar-env.ts:32-102`、前缀 `:108`、永不继承 `:253`)→ sidecar 注入、ext、引擎里 Code Puppy 的代码 | 每代 fork 定一次;**引擎派生的 shell / MCP / LSP 子进程整份继承**(`core/src/shell.ts:272` 无会话环境时用 `process.env`;`core/src/mcp/stdio.ts:31`)[读] | 只留非 Code Puppy 读者要的项(§4.5) |
| C2 | 启动命令 `StartCommand`(parentPort) | main `server.ts:660-672` → `sidecar.ts:76-103`,`parseCommand` `:287-318` | 每代一次;已有类型,带口令与围栏,不进子进程 [读] | 承载启动文档(§4.2) |
| C3 | 内联配置文档 `config.content` | sidecar 内 `injectCodePuppyConfig`(`codepuppy-config-injection.ts:191-660`)从 C1 + 真源文件算 → `start()` 选项(`engine-server-options.ts:49-53`)| 每代一次 | 保留(OpenCode 的配置接口);输入改读启动文档 |
| C4 | 显式配置文件 `codepuppy-explicit.json` | 同一次注入合成(`engine-explicit-config.ts:37-83`);sidecar 监听当前环境根,用户 `codepuppy.jsonc`、`skills-enabled.json`、`ext-store/*/current.json` 一变就重写(`:86-142`),引擎再按显式文件重载 | **会变**(装东西、技能翻代 / 新装 / 停用) | 保留(层序需要,见 §2.3 P-05);输入改读启动文档 |
| C5 | 模型底表 `models.file` | 注入(`codepuppy-config-injection.ts:742-753`)→ `start()` | 每代一次 | 保留 |
| C6 | 密钥文件 `{file:}` | main 每次 fork 同步(`server.ts:416-449`,`codepuppy-secret-files.ts:82-127`);同身份续期原子重写(`codepuppy-auth.ts:9-14`)→ 引擎配置加载、ext 每次请求现读(`ext/src/plugin.ts:224-228`) | **会变**(续期) | 保留,唯一的密钥通道 |
| C7 | sidecar 进程内环境总线 | sidecar 注入写 `CODEPUPPY_CLOUD_MCP_SERVER/DEF/ARM`(`codepuppy-config-injection.ts:546-579`)→ ext(`cloud-websearch-kill.ts:407-411`、`cloud-access.ts:7`、`cloud-vision.ts:64`、`cloud-contract-hook.ts:57`)、`plugin/src/alpha-cloud-authority.ts:24-25` | 每代一次;进程内任何代码可改;子进程继承 | 删除,并入启动文档 |
| C8 | parentPort `codepuppy.*` 消息 | main ⇄ ext(重载请求、定制中心视图;`codepuppy-sidecar-messages.ts:1-18`) | 会变 | 保留 |
| C9 | 引擎 HTTP 接口 | 工具策略经插件 RPC(`tool-policy-client.ts:6-9`) | 会变 | 保留 |
| C10 | 进程级 `globalThis` 交接 | sidecar 发布进程内 fetch,ext 取(`in-process-engine.ts:15-24`) | 每代一次 | 复用这一形状发布启动文档 |
| C11 | 结构性重启 | main 按白名单原因重启 sidecar(`sidecar-lifecycle.ts:10-21`:`identity-change`、`provider-change`、`byok-change`、`connector-change`、`credential-change` 等) | — | 不变;运行中换启动文档的唯一途径 |

### 2.2 键(main → sidecar / ext / 引擎里 Code Puppy 的代码)

| 键 | 写方 | 读方 | 去向(§4.1 字段) |
| --- | --- | --- | --- |
| `CODEPUPPY_GLOBAL_DIR` | `codepuppy-environment.ts:176`(main 自己的 env)→ 白名单 | sidecar 共用模块无快照时退回 env(`codepuppy-environment.ts:191-199`;真源记录与 `codepuppy.jsonc` 路径都经它);ext `plugin.ts:117`、`project-config.ts:84` | `paths.globalRoot` |
| `CODEPUPPY_JSONC_TRUTH_DISABLE` / `CODEPUPPY_LEGACY_INSTALL_ROOT` | 用户导出 | sidecar `codepuppy-config-injection.ts:203`;main 另在 `engine-config-truth-boot.ts:128`、`ext-config.ts:137-144`、`factory-skills.ts:145`、`index.ts:887` 各读 | `paths.userConfig`(缺席 = 逃生阀置位) |
| `CODEPUPPY_BASE_URL` | `codepuppy-auth.ts:365`(set-if-unset) | `codepuppy-models.ts:191,221`;ext `plugin.ts:208` | `platform.modelProxyBaseURL` |
| `CODEPUPPY_PLATFORM_AUTH_REF` | `server.ts:486`(`{file:}` 引用) | ext `platform-credential-header.ts:31`(经 `plugin.ts:226`) | `platform.credentialRef` |
| `CODEPUPPY_DEFAULT_MODEL` | 用户导出 | `codepuppy-models.ts:274` | `platform.defaultModel` |
| `CODEPUPPY_CLOUD_MCP_URL` | `codepuppy-auth.ts:369-370` | 注入 `:219,:226` | `cloudMcp`(main 用同一个 `materializeCloudMcpConfig` 算好定义) |
| `CODEPUPPY_CLOUD_MCP_SERVER` / `_DEF` / `_ARM` | sidecar 注入(C7) | 见 C7 | `cloudMcp.name` / `cloudMcp.definition`;ARM 由 `cloudMcpArmed()` 推出 |
| `CODEPUPPY_WEBSEARCH_DISABLE` | 用户导出 | main `server.ts:336`;注入 `:222` | `webSearch.killSwitch` |
| `CODEPUPPY_LOCAL_WEBSEARCH_DENY` / `CODEPUPPY_CLOUD_WEBSEARCH_DENY` | `server.ts:337-340`(两个都恒等于 kill-switch) | ext `cloud-websearch-kill.ts:143-153` | 删除;读方直接读 `webSearch.killSwitch` |
| `CODEPUPPY_FACTORY_SKILL_DIRS` | `index.ts:855`(boot 时算一次) | 注入 `:112`(`explicitSkillDirs`,C4 的监听也调它) | `skills.factoryDirs` |
| `CODEPUPPY_FACTORY_DENY_SKILLS` | `index.ts:858`,值恒为常量 `["customize-opencode"]`(`codepuppy-builtin-policy.ts:44-49`,`effectiveFactoryDenied` 忽略入参) | ext `plugin.ts:254,310,315`;env 缺席或坏时 `factoryDeniedSkills` 返回 `[]`(`ext/src/factory-deny.ts:62-70`,失效即放开) | 删除通道;常量只留一处(§10 R7) |
| `CODEPUPPY_POLICY_ACCOUNT` | `server.ts:499-500`(直接写 `sidecarEnv`) | ext `policy/index.ts:57` | `policy.account` |
| `CODEPUPPY_EXT_BUNDLED_MANIFEST` | `server.ts:503` | ext `policy/bundled-plugin.ts:36` | `paths.extBundledManifest` |
| `CODEPUPPY_OFFICE_MCP_MANIFEST` | `server.ts:492` | core `mcp/codepuppy-first-party-mcp.ts:53`(经 `mcp/index.ts:450`);ext `policy/identity.ts:104` | `paths.officeMcpManifest` |
| `CODEPUPPY_EGRESS_PROXY` | `sidecar-env.ts:311`(仅 darwin) | `schema/src/codepuppy-net-failure.ts:168`(core `mcp/codepuppy-startup.ts`、`session/to-session-error.ts`,ext `policy/display.ts`) | `network.egressProxy` |
| `CODEPUPPY_MODELS_DISABLE` | 用户导出 | `codepuppy-models.ts:130`(`=== "1"`) | `switches.modelsDisabled` |
| `CODEPUPPY_IDENTITY_DISABLE` / `CODEPUPPY_BEHAVIOR_DISABLE` | 用户导出 | 注入 `:231-232`(非空即真) | `switches.identityDisabled` / `behaviorDisabled` |
| `CODEPUPPY_PROMPT_REBRAND_DISABLE` | 用户导出 | 注入 `:322`;ext `plugin.ts:187,258`(`=== "1"`) | `switches.promptRebrandDisabled` |
| `CODEPUPPY_ECOSYSTEM_INHERIT` | 用户导出 | 注入 `:173`;main `ecosystem-import.ts:30` | `switches.ecosystemInherit` —— **今天到不了 sidecar** [测] |
| `CODEPUPPY_AUTOMATION_DISABLE` / `CODEPUPPY_READONLY_DISABLE` | 用户导出 | 注入 `:334,:371,:441` | `switches.automationDisabled` / `readonlyDisabled` —— **今天到不了** [测] |
| `CODEPUPPY_EXT_VERBOSE` | 用户导出 | ext `plugin.ts:115,249,284,324` | `switches.extVerbose` —— **今天到不了** [测] |
| `CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS` | 用户导出 | core `permission.ts:101-105` | `permission.askTimeoutMs` —— **今天到不了** [测];登记册 `adr038-ask-deadline` 写着它能覆盖 |
| `OPENCODE_DISABLE_MODELS_FETCH` | `server.ts:391` 设默认 `"1"` | sidecar `engine-server-options.ts:65-69` | `engine.modelsFetch` |
| `OPENCODE_EXPERIMENTAL_FILEWATCHER` | `server.ts:388` 设默认 `"true"` | sidecar `engine-server-options.ts:68`(认 `1`/`true`);core `filesystem/codepuppy-project-watch.ts:14-18`(认 `true`/`1`/`yes`/`on`) | `engine.filewatcher`(一个判法,§10 R9) |
| `StartCommand` 的 `userDataPath` / `initialDirectory` / `databasePath` / `configDirectory` / `extPluginPath` / `registryChannel` | `server.ts:660-672` | `sidecar.ts:139-246`、注入 | `paths.*` / `registryChannel` |

不过边界的值:密钥(`CODEPUPPY_API_KEY`、`CODEPUPPY_CLOUD_TOKEN`、`CODEPUPPY_MCP_TOKEN`、BYOK 各 `keyEnv`、`custom-provider--<id>`;
`codepuppy-secret-files.ts:39-50`)只以文件存在;引擎口令只在 `StartCommand` 里(`sidecar.ts:243` 注释 I1)。

### 2.3 其它所依赖的事实

- **P-01 子进程继承 sidecar 环境**:见 C1 [读]。今天 C1 里的 `CODEPUPPY_*`(含云 MCP 完整定义、策略分区哈希、各路径)都进每个第三方 MCP / LSP / shell 子进程;
  `server.ts:493-497` 的注释已经为 `CODEPUPPY_POLICY_ACCOUNT` 处理过这一点。
- **P-02 进程内交接**:`in-process-engine.ts:15-24` 用 `Symbol.for(...)` 挂在 `globalThis`,sidecar 写、ext 读,两个独立 bundle [读]。
  引擎经 `import("virtual:opencode-server")` 在同一线程装入(`sidecar.ts:155`),ext 由引擎在同一进程 import [读] ⇒ core 里 Code Puppy 的代码与 ext 在同一 realm [推]。
- **P-03 一代 sidecar = 一个新进程**:每次 `spawnLocalServer` 都 `utilityProcess.fork`(`server.ts:548-560`);重启原因是封闭表(C11)[读]。
- **P-04 schema 包里的 Code Puppy 自有文件四方都能 import**:`schema/src/codepuppy-net-failure.ts` 被 main(`sidecar-env.ts:30`)、core(`mcp/index.ts:42`)、
  ext(`policy/display.ts:13`,相对路径)import;`packages/schema/package.json:18-21` 导出 `./*`;core、plugin、ui-mac 都已依赖 `@opencode/schema`;
  命名 `codepuppy-*` + `north-star:codepuppy-owned` 标记满足 ADR-043 的自有文件谓词 [读]。
- **P-05 引擎配置层序与全局配置目录**:加载序 managedPolicies → integrated → wellknown → global → explicit → direct → project → content → managedSettings,
  设置后加载者胜、policy 先加载者胜(`engine-explicit-config.ts:3-9` 对 `core/src/config.ts`、`managed-policy.ts` 的转述)[读]。
  `start()` 的 `config.directory` **只换配置根**:`server/src/routes.ts:134` 只传 `{ config }`,`util/src/global.ts:84` `layerWith(Partial<Interface>)`,
  数据根不动;配置根下引擎读 `opencode.json(c)`、`AGENTS.md`(`core/src/config/plugin/instruction.ts:41`)与配置子目录(`core/src/config/discovery.ts:68-72`)[读]。
  调查文档 C 表第 8 行说选项 (b)「moves the data directory」,按这三处不成立 —— R5 管的数据目录与它无关。
- **P-06 白名单实测**[测]:隔离 HOME / XDG 的临时目录里,bun 1.3.14 直接调生产的 `createSidecarEnv`(`@df748c16e7`,该文件在 `b32116b2bc` 未变),
  工作树 `git status` 运行前后均为空:

  ```
  CODEPUPPY_MODELS_DISABLE             PASSES    (正对照)
  CODEPUPPY_API_KEY                    dropped   (反对照)
  CODEPUPPY_ECOSYSTEM_INHERIT          dropped
  CODEPUPPY_AUTOMATION_DISABLE         dropped
  CODEPUPPY_READONLY_DISABLE           dropped
  CODEPUPPY_EXT_VERBOSE                dropped
  CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS  dropped
  ```

  这五个在 sidecar 进程里有读者,正式包里导出了也不生效;`CODEPUPPY_ECOSYSTEM_INHERIT` 还造成 main(`ecosystem-import.ts:30` 认它)与 sidecar(照写移除指令)两边不一致 ——
  `sidecar-env.ts:93-97` 注释里「逃生舱错位」(#606)同一类。
- **P-07 运行中变化的现有路径**:技能翻代 / 新装 / 停用与 `codepuppy.jsonc` 改动走 C4 的监听;定制中心重载走 C8;工具策略走 C9;同身份续期走 C6;
  登录 / 登出 / 换号、provider / BYOK / 连接器 / 凭据在场性变化走 C11;端点发现与后台 shell 环境刷新等下一次 fork(`codepuppy-endpoints.ts:100-103`、`server.ts:349-370`)[读]。
  没有任何一项需要在 sidecar 进程活着时改 C1 / C2 里的值。

## 4. 接口契约

### API

不适用:不加、不改 HTTP 接口。

### 数据

不适用:启动文档只在内存里,不落盘;C3–C6 的磁盘形状不变。

### 事件 / 配置

#### 4.1 启动文档 `CodePuppyBootstrap` v1

位置:`packages/schema/src/codepuppy-bootstrap.ts`,Code Puppy 自有文件(ADR-043:`codepuppy-` 文件名 + `north-star:codepuppy-owned` 标记),
只 import `node:path`。归属:**main 构建,sidecar 解析并发布,其余只读**。

```ts
export const CODEPUPPY_BOOTSTRAP_VERSION = 1

/** 一代 sidecar 一份;结构化克隆可传(只有字符串、数字、布尔、数组、普通对象);可选键缺席时省略,不写 undefined。 */
export type CodePuppyBootstrap = {
  v: 1
  paths: {
    userData: string               // 绝对路径(原 StartCommand.userDataPath)
    globalRoot: string             // 当前环境 mutable root 的 canonical 绝对路径(原 CODEPUPPY_GLOBAL_DIR)
    userConfig?: string            // 当前环境 codepuppy.jsonc;缺席 = 逃生阀 JSONC_TRUTH_DISABLE / LEGACY_INSTALL_ROOT 置位
    initialDirectory: string       // 绝对路径
    database: string               // 绝对路径,或 ":memory:"
    engineConfigDirectory: string  // 绝对路径,交给 start() 的 config.directory
    extPlugin?: string             // ext 插件目录;缺席 ⇒ 不装 ext ⇒ sidecar 拒报 ready(I4,今天的行为)
    extBundledManifest?: string    // 与 extPlugin 同在同缺
    officeMcpManifest: string      // 绝对路径
  }
  registryChannel?: "stable" | "preview" | "dev"   // 缺席 ⇒ 跳过 disabled-override 注入(今天的容忍)
  engine: {
    modelsFetch: boolean           // start() models.fetch
    filewatcher: boolean           // start() fs.filewatcher,也是 core 项目级文件监听的开关
  }
  platform: {
    credentialRef: `{file:${string}}`   // 平台模型凭据文件的引用,不是凭据
    modelProxyBaseURL?: string          // https,或 loopback http;不得带 userinfo
    defaultModel?: string               // 非空
  }
  cloudMcp?: {                     // main 解析出云 MCP 地址时在场
    name: string                   // 配置里那一条 MCP 的名字(今天 "codepuppy")
    definition: {                  // 带凭据通道的完整定义;header 只装引用
      type: "remote"
      url: string
      headers: { Authorization: `Bearer {file:${string}}` }
      oauth: false
    }
  }
  webSearch: { killSwitch: boolean }
  skills: { factoryDirs: string[] }        // 绝对路径,可空
  policy: { account?: string }             // /^acct:[0-9a-f]{64}$/;缺席 ⇒ 分区 "anonymous"
  permission: { askTimeoutMs?: number }    // 正的安全整数毫秒;缺席 ⇒ 300000
  network: { egressProxy?: string }        // /^http:\/\/127\.0\.0\.1:\d{1,5}$/;只在 darwin 在场
  switches: {
    modelsDisabled: boolean
    identityDisabled: boolean
    behaviorDisabled: boolean
    promptRebrandDisabled: boolean
    automationDisabled: boolean
    readonlyDisabled: boolean
    ecosystemInherit: boolean
    extVerbose: boolean
  }
}

export type CodePuppyBootstrapErrorReason = "invalid" | "version" | "unpublished" | "republished"
export class CodePuppyBootstrapError extends Error {
  readonly name = "CodePuppyBootstrapError"
  constructor(readonly reason: CodePuppyBootstrapErrorReason, readonly path?: string) // path = 出错字段的点路径
}

/** 严格解析:多键、缺必填键、类型或格式不符 ⇒ "invalid"(带 path);v !== CODEPUPPY_BOOTSTRAP_VERSION ⇒ "version"。返回深冻结的副本。 */
export function parseCodePuppyBootstrap(value: unknown): CodePuppyBootstrap
/** sidecar 每个进程调用一次;第二次 ⇒ "republished"。挂在 globalThis[Symbol.for("codepuppy.bootstrap")](C10 同一形状)。 */
export function publishCodePuppyBootstrap(document: CodePuppyBootstrap): void
/** sidecar 与 ext 用:未发布 ⇒ "unpublished";已发布的 v 与本 bundle 编进去的版本不等 ⇒ "version"。 */
export function codepuppyBootstrap(): CodePuppyBootstrap
/** core / plugin / schema 里 Code Puppy 自有或已接管的文件用:未发布 ⇒ undefined(上游 CLI 宿主、core 单测),按 §4.3 取缺省;版本不等 ⇒ "version"。 */
export function tryCodePuppyBootstrap(): CodePuppyBootstrap | undefined
/** 今天的 CODEPUPPY_CLOUD_MCP_ARM:kill-switch 下云 MCP 只由 ext 装。 */
export function cloudMcpArmed(document: CodePuppyBootstrap): boolean   // webSearch.killSwitch && cloudMcp !== undefined
```

格式校验的意图:`platform.credentialRef` 与 `cloudMcp.definition.headers.Authorization` 的形状只容得下 `{file:<路径>}` 引用,
URL 字段拒绝 userinfo —— 往这两处塞进真令牌会在解析时失败,「密钥不进启动文档」由此在结构上成立,不只靠约定。
仅测试的重置入口沿用 `__resetCodePuppyEnvironmentForTests` 的先例(`codepuppy-environment.ts:386`)。

#### 4.2 启动命令

```ts
type StartCommand = {
  type: "start"
  hostname: string
  port: number
  password: string                  // 密钥:只在这里,永不进启动文档
  fence?: ProcessFenceStartInput    // 在发布启动文档之前 apply,不是给 ext / core 的决定
  bootstrap: unknown                // start() 内 parseCodePuppyBootstrap;失败 ⇒ error IPC + exit(1)
}
```

`userDataPath`、`initialDirectory`、`databasePath`、`configDirectory`、`extPluginPath`、`registryChannel` 移进启动文档。
`parseCommand` 只校验传输字段;启动文档的解析放进 `start()` 的 try 里,坏文档走与「darwin 缺围栏」同一条响亮失败路(`sidecar.ts:204-207`),
不再像今天形状不对的启动命令那样被静默丢弃、等到 main 超时。

#### 4.3 谁在什么时候读

- **sidecar**:`start()` 里装好围栏之后、注入之前,解析并发布一次;此后注入、C4 的监听、`start()` 选项都只读文档。
  sidecar 里与 main 共用的模块(全局根、真源记录、`codepuppy.jsonc` 路径)今天在无快照时退回 `process.env.CODEPUPPY_GLOBAL_DIR`,改为退回已发布的文档;
  main 仍用冻结快照。sidecar 不再按自己的环境重算 main 已算过的值(例如 `mcp-default-deny.ts:55` 重算全局配置目录,改读 `paths.engineConfigDirectory`)。
- **ext**:`codepuppyBootstrap()`。`setup` 第一步读一次并复验 `paths.globalRoot` 的 canonical 身份(沿用 `project-config.ts:84-108` 的检查);
  未发布或版本不等 ⇒ `setup` 抛 ⇒ 插件 failed ⇒ sidecar 不报 ready(I4,`sidecar.ts:202`)。钩子在调用时读,不缓存可变副本。
- **core / plugin / schema 里 Code Puppy 自有或已接管的文件**:`tryCodePuppyBootstrap()`;没有文档时的行为与今天「环境变量缺席」逐项相同:

  | 读方 | 字段 | 没有启动文档时 |
  | --- | --- | --- |
  | `core/src/permission.ts` 审批期限(已接管,ADR-038) | `permission.askTimeoutMs` | 300000 |
  | `core/src/mcp/codepuppy-first-party-mcp.ts`(自有) | `paths.officeMcpManifest` | 不声明,连上后再列 |
  | `schema/src/codepuppy-net-failure.ts` 的 `engineNetFailurePath`(自有) | `network.egressProxy` | `{ via: "other" }` |
  | `core/src/filesystem/codepuppy-project-watch.ts`(自有) | `engine.filewatcher` | 关 |
  | `plugin/src/alpha-cloud-authority.ts`(自有) | `cloudMcp` | 无治理云 MCP |

- 上游路径里的改动只落在已接管文件既有的 `codepuppy(...)` 标注块内,或自有文件;不新增接管。自有 helper 自己读文档,
  已接管文件里把 `process.env` 传给自有 helper 的调用点(`mcp/index.ts:450`)只在原 `codepuppy(#1565)` 标注那一行内改。
- 读方保留各自今天的注入参数作测试接缝(生产传已发布的文档);不读 `process.env` 取 Code Puppy 的决定。

#### 4.4 main 的构建

`buildCodePuppyBootstrap(input): CodePuppyBootstrap` 放在 ui-mac 主进程,每次 fork 在 `spawnLocalServer` 里、密钥同步与出网代理起好之后调用一次
(今天 `createSidecarEnv()` 的位置),输出原样放进 `StartCommand.bootstrap`。输入全部来自现有权威:冻结环境快照
(`resolveCodePuppyGlobalRoot`、`registryChannel`)、`engine-paths.ts` 的库与配置目录、`resolveExtPluginPath`、boot 时 `reconcileFactorySkills` 的结果、
`applyAuthEnv` 写进 main 环境的两个 URL、`materializeCloudMcpConfig` + `secretFileRef`、当刻登录态的分区哈希、出网代理端口。
构建器对用户导出的值从不抛:空串当缺席,非正整数的期限省略。它只在结构性缺陷(例如资源根 `realpath` 失败,今天 `server.ts:492` 同样会抛)时抛。

运维开关的名字与语义对用户不变,只是读的地方从 sidecar / ext / core 收到构建器一处:

| 配置键(main 的环境) | 类型 | 默认 | 必填 | 读取入口 → 字段 |
| --- | --- | --- | --- | --- |
| `CODEPUPPY_MODELS_DISABLE` | `"1"` | 未设 | 否 | 构建器 → `switches.modelsDisabled`(`=== "1"`) |
| `CODEPUPPY_IDENTITY_DISABLE` / `CODEPUPPY_BEHAVIOR_DISABLE` | 任意非空串 | 未设 | 否 | → `switches.identityDisabled` / `behaviorDisabled` |
| `CODEPUPPY_PROMPT_REBRAND_DISABLE` | `"1"` | 未设 | 否 | → `switches.promptRebrandDisabled` |
| `CODEPUPPY_AUTOMATION_DISABLE` / `CODEPUPPY_READONLY_DISABLE` | 任意非空串 | 未设 | 否 | → `switches.automationDisabled` / `readonlyDisabled` |
| `CODEPUPPY_ECOSYSTEM_INHERIT` | `"1"` | 未设 | 否 | → `switches.ecosystemInherit` |
| `CODEPUPPY_EXT_VERBOSE` | 任意非空串 | 未设 | 否 | → `switches.extVerbose` |
| `CODEPUPPY_WEBSEARCH_DISABLE` | 任意非空串 | 未设 | 否 | → `webSearch.killSwitch` |
| `CODEPUPPY_JSONC_TRUTH_DISABLE` / `CODEPUPPY_LEGACY_INSTALL_ROOT` | `"1"` | 未设 | 否 | 任一置位 → `paths.userConfig` 缺席 |
| `CODEPUPPY_DEFAULT_MODEL` | 字符串 | 未设 | 否 | → `platform.defaultModel` |
| `CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS` | 正整数 | 300000 | 否 | → `permission.askTimeoutMs`(不合法 ⇒ 省略) |
| `CODEPUPPY_BASE_URL` / `CODEPUPPY_CLOUD_MCP_URL` | URL | `applyAuthEnv` 写 | 否 | → `platform.modelProxyBaseURL` / `cloudMcp` |
| `OPENCODE_DISABLE_MODELS_FETCH` | `"1"` / `"true"` | `"1"` | 否 | → `engine.modelsFetch = !truthy` |
| `OPENCODE_EXPERIMENTAL_FILEWATCHER` | `"1"` / `"true"` | `"true"` | 否 | → `engine.filewatcher = 未设 \|\| truthy` |

#### 4.5 留在进程环境里的

规则:**sidecar 环境里不再有 `CODEPUPPY_*`,只剩用户的 `CODEPUPPY_ENV_ALLOWLIST_EXTRA`**;其余都是非 Code Puppy 读者要的:

| 项 | 为什么留在环境 |
| --- | --- |
| `PATH`、`HOME`、`USER`、`SHELL`、`TMPDIR`、`TERM`、`LANG`、`TZ`、`SSH_AUTH_SOCK`、`LC_*`、`ELECTRON_*` | 子进程与 Node 本身要 |
| 八个代理变量(darwin 下整份改写成出网代理,`sidecar-env.ts:299-313`) | 子进程(curl / git)与 `http.setGlobalProxyFromEnv()`(`sidecar.ts:154`)要 |
| `NODE_*` | Node 运行时 |
| `XDG_*` | 上游在模块装载时按它们算全局根(`sidecar.ts:242-244`);ext 按它找 OpenCode 数据根(`policy/index.ts:44-46`,既有 K2 偏离) |
| `OPENCODE_*` 前缀 | 上游自己的变量,不在本设计范围;`OPENCODE_CONFIG_CONTENT`、`OPENCODE_FLAGS` 仍永不继承 |
| `UV_CACHE_DIR`(`server.ts:489`) | 随包 Office 依赖的 uv 子进程 |
| `CODEPUPPY_ENV_ALLOWLIST_EXTRA` | 它本身就是「让某个变量进子进程」的用户逃生门 |

这条规则由测试机判:以生产 `createSidecarEnv` + 构建期覆盖算出 sidecar 环境,把 §2.2 每个旧键都导出,断言没有 `CODEPUPPY_*` 漏进去;反向臂是加回任一键即红。

#### 4.6 运行中的变化怎么传

启动文档在一个 sidecar 进程的生命期内**不变**。运行中的变化只走已有的路,本设计不新增通道:

| 变化 | 怎么传 | 本设计改了什么 |
| --- | --- | --- |
| 技能翻代 / 新装 / 停用;main 或用户改 `codepuppy.jsonc` | C4 监听重写显式文件 → 引擎重载 | 监听的输入(`globalRoot`、`factoryDirs`、`userConfig`)改读文档 |
| 定制中心安装后的重载 | C8 `codepuppy.reload.request` | 无 |
| 工具策略启停 | C9 插件 RPC | 无 |
| 同身份续期 | C6 原子重写,每次请求现读 | 无(文档只带引用) |
| 登录 / 登出 / 换号;provider、BYOK、连接器、凭据在场性变化 | C11 结构性重启 → main 重新构建文档 | 无(新进程拿新文档) |
| 端点发现、后台 shell 环境刷新、kill-switch 导出 | 下一次 fork | 无 |

## 5. 数据与失败

- 写边界:构建器只读;启动文档不落盘,没有事务、幂等或重试问题。C3–C6 的写入点与失败处理不变,#613 的注入失败上报不变
  (失败分支的治理底线读已校验过的文档)。
- 可达的失败窗口:

  | 窗口 | 怎么到达 | 结果 |
  | --- | --- | --- |
  | 构建器抛 | 代码缺陷或资源根 `realpath` 失败(今天同样) | `spawnLocalServer` 抛 ⇒ 与密钥同步失败同一条拒 fork 路,这一代 failed |
  | sidecar 解析失败 | main / sidecar 来自不同构建,或构建器有缺陷 | error IPC + exit(1) ⇒ main 宣告这一代 failed,原因带字段路径 |
  | ext 读不到或版本不等 | 开发时 ext bundle 陈旧 | ext `setup` 抛 ⇒ 插件 failed ⇒ I4 拒报 ready |
  | core 读到版本不等 | 开发时引擎 bundle(`dist-engine`)陈旧 | 第一次读即抛,落在那次审批 / MCP 启动的错误上,响亮 |

  打包构建一次产出 main、sidecar、ext 与引擎,后两行只在本机开发时可达。
- 不新增防御状态:不做跨版本兼容读法(四方同包出货),不做文档热更新。

## 6. 架构落点

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| 启动文档类型、解析、发布、读取 | `packages/schema` 的 Code Puppy 自有文件(新) | 只依赖 `node:path` | 进程内交接形状 `in-process-engine.ts:15-24`;跨进程窄合同「build/parse 成对、parse 失败即拒」`codepuppy-sidecar-messages.ts:4` |
| 构建器与启动命令 | ui-mac 主进程,`spawnLocalServer` 一处 | main → schema | 冻结环境快照、`engine-paths.ts`、`resolveExtPluginPath`、`materializeCloudMcpConfig`、`secretFileRef` |
| 解析与发布;注入、显式层监听的输入 | ui-mac sidecar | sidecar → schema | `injectCodePuppyConfig`、`watchExplicitSources` 原样留在 sidecar |
| ext 的读取 | `packages/ext` | ext → schema(相对路径,`policy/display.ts:13` 先例) | — |
| 引擎侧读取 | core / plugin / schema 的自有文件与已接管文件的既有 `codepuppy(...)` 块 | → schema(已有依赖) | ADR-038 / ADR-043 已登记的握法 |
| 出厂禁用技能名单 | `packages/ext/src/factory-deny.ts` 持有常量,main 的 `codepuppy-builtin-policy.ts` import 它 | main → ext(`factory-paths.ts` 等先例,`codepuppy-config-injection.ts:47-52`) | — |

- **新模块**:本仓没有 `docs/architecture/modules.md`,落点理由记在这里:schema 包是 main、sidecar、ext、core、plugin 五方**都已能 import、不加依赖边**的唯一位置(P-04);
  只依赖 `node:path`,不改变 ext bundle 体积,也不往 sidecar 的 import 闭包里带写盘点(`process-fence-write-sites.test.ts` 管的那个闭包)。由治理补图。
- **收敛(K2,较现在更好)**:同一事实今天的重复判定随键一起消失 ——
  ① 环境变量名在三个包各写一份(`cloud-web-search.ts:40-129`、`cloud-websearch-kill.ts:134-140,383`、`alpha-cloud-authority.ts:8-9`;
  `cloud-websearch-kill.ts:136-138` 注释自认「彼此之间没有可共用的 alpha 依赖边」);
  ② kill-switch 判三处(`server.ts:336`、注入 `:222`、ext `signalled()`);
  ③ 真源逃生阀 main 与 sidecar 各读一遍(#606 那一类);
  ④ 文件监听开关两种判法(`engine-server-options.ts:68` 对 `codepuppy-project-watch.ts:18`);
  ⑤ 同一代的全局配置目录 main 算一次、sidecar 再算一次(`server.ts:668` 对 `mcp-default-deny.ts:55`)。
  main 自己内部仍以 `process.env` 串接的部分(`applyAuthEnv` → 密钥同步、main 多处读逃生阀)不在本设计改动之列。
- **架构约束**:K2 较现在更好;K1 不变。北极星:新增的是自有文件,不是接管;上游路径里的改动限于既有 `codepuppy(...)` 块(§4.3)。
  ADR-048:登记册里机制描述引用了环境变量的三条(`tool-policy-partitions`、`adr038-ask-deadline`、`project-file-change-events`)在同一切片里改写握法与测试名,
  决定本身不变,不退役任何条目。
- **工程标准**:①用户可调的开关只在构建器一处读,出厂禁用名单是常量不是配置;②一个值一个主人(上条);⑤坏文档以具名错误 `CodePuppyBootstrapError` 失败,
  构建器与解析器的日志只写字段路径,不写值。
- **安全面**:威胁边界是「sidecar 环境被第三方子进程整份继承」与「进程内插件共用 `globalThis`」。不变量:
  S1 启动文档里没有任何密钥值,只有 `{file:}` 引用与路径(§4.1 的格式校验在结构上保证两处引用字段);
  S2 启动文档不进环境,子进程拿不到;S3 每个进程只发布一次、深冻结、读方不改;S4 引擎口令只在 `StartCommand`。
  进程内的第三方代码本就能做任何事,这不是对它的隔离(与今天相同);它去掉的是「改一个环境变量就能翻掉 ext 的判决」这条随手可走的路。
- **被否决的替代**:
  1. 写一个启动文档文件、环境变量里只放路径 —— 子进程照样能顺着路径读到,每代还多一次写盘与清理,比 IPC 多出东西而没有好处。
  2. 保留环境变量、只加一个有类型的读取模块 —— 子进程继承、进程内可改、白名单与读方脱节(P-06 那五个)三件事都还在。
  3. 把整段注入搬到 main、只传算好的配置 —— 改变 #613 注入失败的上报路径和指令文件的写入方,I-07 的结果用不到。
  4. 可变的启动文档加变更事件 —— 与 C4 / C8 / C11 并行的第二条运行中通道,§4.6 没有任何一项需要它。
  5. 用 zod / Effect Schema 校验 —— 给 ext bundle 与 sidecar 闭包加依赖;仓内跨进程窄合同的先例是手写严格解析。
  6. 让上游 `config.file` 收数组以删掉合成 —— 是向上游提挂点的事(I-05 的范围),I-07 不需要。

## 8. 拆分决定

不适用:只涉及 alpha-code 一个仓、一个负责方。开工依赖:#1662 换代合入 `alpha`(本设计所对的代码只在 `engine/1662-opencode2` 上)。
集成关系:I-05 先行,可能改到 `core/src/permission.ts` 的其它 `codepuppy(...)` 块,与本设计改的审批期限块不重叠;I-06 消费 §4.1 的形状。

## 9. 回滚

- 只改代码,启动文档不落盘;回滚 = revert,环境变量与启动命令字段原样回来,没有数据后果。C3–C6 的磁盘形状两边一致。
- **迁移切片**(这是兼容性决定,不是任务拆分;提交顺序由 plan.md 定):
  - 规则:每个键连同它的写方和**全部**读方在同一个提交里搬;任何时刻同一个键只在一个通道里;四方同包出货,不需要双读期。
  - 切片 A —— 合同与传输:schema 自有文件、构建器、`StartCommand.bootstrap`、sidecar 的解析与发布;把 `StartCommand` 里的六个决定字段搬进文档。环境变量不动,可单独回滚。
  - 切片 B —— §2.2 的全部环境键、C7 进程内总线、白名单里对应的条目、出厂禁用名单改常量、登记册三条的握法文字;§4.5 的环境规则检查落在这里。
    plan.md 可以把 B 按键组再拆,只要守住上面的规则。
- 若 owner 选了 §10 的选项 (b),它是单独的切片,回滚 = 把 `config.directory` 指回原目录;不搬任何数据。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| R1 启动文档 = `StartCommand.bootstrap`,只在内存里,不进环境、不落盘 | C2 已是有类型、带密钥也不进子进程的通道(`sidecar.ts:76-103`);P-01、P-03;`@b32116b2bc` |
| R2 位置:`packages/schema/src/codepuppy-bootstrap.ts`,Code Puppy 自有文件 | P-04 |
| R3 一个 sidecar 进程内不变;运行中的变化只走 C4 / C6 / C8 / C9 / C11 | P-07、§4.6 |
| R4 sidecar 环境只留非 Code Puppy 读者要的项与 `CODEPUPPY_ENV_ALLOWLIST_EXTRA`,由测试机判 | C1、P-01 |
| R5 密钥只走 C6;文档里两处引用字段由格式校验保证只能是 `{file:}` 引用;口令只在 `StartCommand` | `codepuppy-secret-files.ts:1-23`、`sidecar.ts:243` |
| R6 P-06 那五个今天到不了 sidecar 的开关并入文档 —— 运维导出它们时开始按 ADR 写的那样生效(owner 可见,见下) | P-06 [测];ADR-038 期限覆盖、ADR-024 §5 继承逃生门(`codepuppy-config-injection.ts:166`)的既有文字;`CODEPUPPY_ECOSYSTEM_INHERIT` 今天 main / sidecar 两边不一致 |
| R7 出厂禁用名单改成 ext 持有的常量,main import 它;不再走任何通道 | `codepuppy-builtin-policy.ts:44-49`(恒为常量);工程标准 1;顺带去掉 env 缺席时放开的分支(`factory-deny.ts:62-70`) |
| R8 云 MCP 定义在 main 算(同一个 `materializeCloudMcpConfig`),文档里一份,sidecar 注入、ext、plugin 都读它;是否代付仍由注入按密钥文件在场性判 | `cloud-sidecar-config.ts`;`codepuppy-config-injection.ts:219,541-579` |
| R9 文件监听开关只有一个判法:沿用 main 的(`未设 \|\| 1/true`) | `engine-server-options.ts:65-69` 对 `codepuppy-project-watch.ts:18`;只在导出 `yes` / `on` 时两者今天不一致 |
| R10 严格解析、整数版本号;版本不等即失败,不做兼容读法 | 四方同包出货;§5 |
| R11 选项 (b)「Code Puppy 自有引擎全局配置目录」不在本设计内,待 owner 决定 | 见下;P-05 |
| R12 交付物路径按派发书写成 `docs/specs/upstream-upgrade-readiness/design-i07.md`;user-level 文档合同(`check_docs_contract.py` 的 `specs.extra-file`)只认 `spec.md` / `design.md` / `plan.md`,本仓门不跑该检查 | 交编排器定是否改名;不影响设计内容 |

**本设计带来的 owner 可见变化**(按派发书「行为变了必须点名」):

1. 正常使用无变化:界面、模型、技能、审批、搜网、云能力都同今天。
2. 只有在 shell 里导出下列变量的人会看到差别:`CODEPUPPY_ECOSYSTEM_INHERIT`、`CODEPUPPY_AUTOMATION_DISABLE`、`CODEPUPPY_READONLY_DISABLE`、
   `CODEPUPPY_EXT_VERBOSE`、`CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS` —— 今天在正式包里导出了也不生效,之后生效(R6)。
3. agent 在终端里运行 `env`,不再看到 `CODEPUPPY_*` 变量。
4. `OPENCODE_EXPERIMENTAL_FILEWATCHER` 写成 `yes` / `on` 时:今天项目文件监听开、引擎文件监听关;之后两处都关(R9)。

**待 owner 决定:要不要让 Code Puppy 用自己的引擎全局配置目录**(R11;本设计默认不做)

- 前因:引擎只有一个显式配置槽。今天 Code Puppy 每次启动把用户的 `codepuppy.jsonc` 与自己的出厂层(`/init`、`/review`、技能目录、模型服务白名单)
  合成一份文件放进这个槽,运行中由监听重写(C4,`engine-explicit-config.ts:11-17`)。已知边界:用户文件里相对路径的 `{file:./x}` 会按合成文件所在目录解析(同处 `:17`)。
- 选项 (b):给引擎一个 Code Puppy 自己的全局配置目录(`start()` 的 `config.directory`,今天是 `~/.config/opencode`,`engine-paths.ts:34-35`),
  把出厂层写成那里的全局配置;显式槽直接放用户的 `codepuppy.jsonc`。全局层排在显式层与项目层之前,白名单仍压得住项目里的放行,出厂命令仍让位于项目同名命令(P-05)。
- 事实更正:它**不搬数据目录**,只换配置根(P-05);R5 管的会话库与凭据目录不受影响。
- 好处:删掉对用户文件的合成和监听里处理用户文件的那一半;相对 `{file:}` 的边界消失。技能翻代仍要重写出厂层,那一半监听留下。
- 用户能看到的代价:Code Puppy 不再读 `~/.config/opencode` 里给独立 OpenCode 写的全局配置、`AGENTS.md` 全局指令(`instruction.ts:41`)和 agent / 命令 / 技能 / 插件子目录。
  那里的 MCP 今天已被默认拒绝(`mcp-default-deny.ts`),所以变化落在 agent、命令、技能、全局指令上。是否把这些导入要另定。
- 实现代价:main 里推导这个目录的地方有六处(`ext-config.ts:102`、`ext-fs-installer.ts:38`、`codepuppy-migrate.ts:31`、`engine-config-truth-boot.ts:51`、
  `engine-config-dangling.ts:180`、`engine-paths.ts:34`),要先收成一处;进程围栏的 W6 可写项与默认拒绝的目标随之改。
- 可逆性:可逆 —— 把目录指回去即可,不搬数据。
- 推荐:I-07 不做,留作独立选项。理由:I-07 的结果(一份有类型的启动配置)不依赖它;它改变用户能看到的内容,需要 owner 判断独立 OpenCode 的全局配置是否还该进 Code Puppy。
- 拖着的代价:相对 `{file:}` 的边界与合成监听继续存在;今天没有已知受影响的用户(除本机外零租户)。

<!-- 每轮审查的回执行(delivery-review §3)写在下表。 -->

| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| 尚未送审 | — | — | — | — |

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| main 里引擎全局配置目录的六处推导收成一处(K2) | 六处今天对同一环境给出同一结果 | 与本设计的键无关;只有选项 (b) 获批才是前提 | owner 选 (b) 时 |
| 调查文档 C 表第 8 行「moves the data directory」更正 | 文字误差,会误导选项 (b) 的代价 | 调查文档是只读调查记录;更正已写在本设计 P-05 | 调查文档再被引用时 |
| `cloud-websearch-kill.ts:136-140` 注释说本地 deny 是「kill-switch 或平台代付」 | 自 #1411 起只看 kill-switch(`server.ts:336-340`),注释过时 | 该键随切片 B 删除,注释一起走 | — |
| sidecar 里 Code Puppy 的代码仍按 `XDG_DATA_HOME` 自己拼 OpenCode 数据根(`policy/index.ts:44-46`) | 既有 K2 偏离,已登记 | 那是 OpenCode 的决定,不属于 main 交给引擎的值 | 插件 Context 开始提供数据根时 |
