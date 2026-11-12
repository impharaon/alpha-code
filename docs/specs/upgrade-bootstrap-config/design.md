---
id: DESIGN-upgrade-bootstrap-config
title: 主进程交给引擎与插件的启动配置收成一份 技术设计
summary: 主进程今天经二十多个 CODEPUPPY_* 环境变量、启动命令、sidecar 进程内环境把决定交给 sidecar、引擎与 ext;收成一份有类型、有版本、每代 sidecar 一份、只在内存里的启动文档,环境变量只留给非 Code Puppy 的读者;最后一片给引擎换上 Code Puppy 自有的全局配置目录,首次切换时把独立 OpenCode 的全局内容复制一份过来
kind: tech-design
status: approved
spec: ""                 # 内部工作,无 spec。来源:impharaon/alpha-work:INT-upstream-upgrade-readiness I-07(owner U-02,2026-11-12)
spec_version: ""
review:
  rounds: 2
  reviewed_sha: "e6da3448e4"   # R2 审的设计版本,范围 G4(Codex gpt-6.1-sol,会话 01a1cefe);R1 审 c5ca06786b 全文(会话 01a1ced6)。两轮均 FIX-THEN-MERGE,finding 全部采纳并已改,见 §10
  verdict: "pass-with-notes"
owners: [owner]
last_reviewed: 2026-11-12
---

# DESIGN-upgrade-bootstrap-config｜启动配置收成一份 技术设计

只写决定。文件清单、提交顺序与测试由实现方的 plan.md 写。§3、§7 已退役,编号不复用。

## 1. 基线

- Spec:无。I-07 是内部工作(intent 标签 dev),按派发书不建 spec;授权来源
  [impharaon/alpha-work:INT-upstream-upgrade-readiness I-07 @4c1b2c6](https://github.com/impharaon/alpha-work/blob/4c1b2c624b53619de97fa6bfa5679024d07abf17/docs/intents/INT-upstream-upgrade-readiness.md)
  (owner 2026-11-12 U-02「同意做」,方案单独送 owner 批)。
- 覆盖:I-07「主进程传给引擎和插件的二十来个零散环境变量,收成一份有类型的启动配置」;派发书点名的决定:通道与键的清点、
  启动文档(schema 位置、ext 与已接管 core 怎么读、运行中的变化怎么传)、留下哪些通道及理由、密钥怎么不进去、迁移期兼容、交付切片;
  owner 2026-11-12 决定做的「Code Puppy 自有的引擎全局配置目录」作为最后一片 G4(§4.7、§9):目录、层序、首次切换的复制、回滚与证明义务。
- 背景:P-01 / ADR-048(已拿回的权威只许换接法);编排器定的顺序 I-05 → I-04 → I-07 → I-06,I-06 消费本设计 §4 的形状。
  owner 原话约束:「界面当前的 alpha 才是唯一权威吧」「不可以因为 opencode 更新把经 codepuppy 拿回的唯一权威再封掉」。
- 代码基线:`engine/1662-opencode2@30b9a679f8`(下文 `path:line` 均指它)。初稿对的是 `b32116b2bc`;其后的提交只动了本设计引用的
  `packages/ext/src/plugin.ts:5`(一行 import,行号不移)、`plugin-setup-order.cases.ts` 与权威登记册,下文已按新版本重核。这份代码尚未进 `alpha`。
  G4 的事实对的是 `ab31da3d24`(同一分支,所引文件与 `30b9a679f8` 相同)。

## 批准记录

- 2026-11-12,owner(编排器转达),逐字:
  - 「同意，启动配置方案批准，我希望做全局目录给我讲一下优点和缺点。」
  - 「做全局目录，按照这种方案，需要搬一份到 Code Puppy 自己的目录。以后想两边都生效的设置，要写两遍。可以，全局配置，将缺点收缩到最小。」
- 含义:G1–G3 的启动配置方案(审过的 `5302c8a300`)获批;原「待 owner 决定」的自有全局配置目录改为要做,写成 G4,且要把缺点收到最小。
- G4 按 owner 这一决定补写,经 R2 审查(范围 G4,`e6da3448e4`)并按全部采纳的 finding 修正;编排器 2026-11-12 据上面两句原话把本设计标为 `approved`。

## 2. 地面真相

**问题**:主进程的决定经哪些通道到达 sidecar 进程里的注入、ext 与 Code Puppy 在引擎里的自有 / 接管代码;每个键谁写、谁读、运行中会不会变;
哪些通道必须留下;哪些宿主读这些值却没有启动文档。**范围**:ui-mac 主进程与 sidecar、`packages/ext`、`packages/{core,plugin,schema,util}` 里
Code Puppy 自有或已接管的文件、仓内 CLI 宿主与测试子进程。只被主进程自己读的 `CODEPUPPY_*`(`CODEPUPPY_EXT_DISABLE`、`CODEPUPPY_ENV_BASE_DIR`、
`CODEPUPPY_OPENCODE_HOME`、`CODEPUPPY_MIGRATE_ENABLE`、`CODEPUPPY_SECRETS_DISABLE`、`CODEPUPPY_CONFIG_HEALTH_DISABLE`)不过这道边界,不在范围内。
**停止条件**:sidecar 进程里每一处 `CODEPUPPY_*` 读取都对上写方;每条非环境通道的运行中变化路径都找到;每个读这些值的宿主都归类。
G4 另问:引擎全局层里有什么、按什么顺序生效;独立 OpenCode 的全局配置今天能不能压过 Code Puppy 的决定;main 里谁在推导这个目录;
停止条件是层序与策略胜负有实测或既有真引擎探针为证,六处推导逐一归类。不读 owner 真实的 `~/.config/opencode`。
下文 [读] = 读码,[测] = 本次实跑,[推] = 推断。

### 2.1 通道

| # | 通道 | 写方 → 读方 | 运行中会不会变 | 去向 |
| --- | --- | --- | --- | --- |
| C1 | sidecar 进程环境 | main 每次 fork:`createSidecarEnv()` 白名单 + 直接赋值(`packages/ui-mac/src/main/server.ts:486-517`;白名单 `sidecar-env.ts:32-102`、前缀 `:108`、永不继承 `:253`、`CODEPUPPY_ENV_ALLOWLIST_EXTRA` 放行 `:273`)→ sidecar 注入、ext、引擎里 Code Puppy 的代码 | 每代 fork 定一次;**引擎派生的 shell / MCP / LSP 子进程整份继承**(`core/src/shell.ts:272` 无会话环境时用 `process.env`;`core/src/mcp/stdio.ts:31`)[读] | 只留非 Code Puppy 读者要的项(§4.5) |
| C2 | 启动命令 `StartCommand`(parentPort) | main `server.ts:660-672` → `sidecar.ts:76-103`,`parseCommand` `:287-318` | 每代一次;已有类型,带口令与围栏,不进子进程 [读] | 承载启动文档(§4.2) |
| C3 | 内联配置文档 `config.content` | sidecar 内 `injectCodePuppyConfig`(`codepuppy-config-injection.ts:191-660`)从 C1 + 真源文件算 → `start()` 选项(`engine-server-options.ts:49-53`)| 每代一次 | 保留(OpenCode 的配置接口);输入改读启动文档 |
| C4 | 显式配置文件 `codepuppy-explicit.json` | 同一次注入合成(`engine-explicit-config.ts:37-83`);sidecar 监听当前环境根,用户 `codepuppy.jsonc`、`skills-enabled.json`、`ext-store/*/current.json` 一变就重写(`:86-142`),引擎再按显式文件重载 | **会变**(装东西、技能翻代 / 新装 / 停用) | G1–G3:保留,输入改读启动文档。G4:合成文件删除,出厂层改写进自有全局目录;监听改为重写出厂层与维护用户层最后一份可用副本(§4.7) |
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
| `CODEPUPPY_BASE_URL` | `codepuppy-auth.ts:365`(set-if-unset,保留用户原值) | `codepuppy-models.ts:191,221`;ext `plugin.ts:208` | `platform.modelProxyBaseURL`(无凭据 URL,§4.1) |
| `CODEPUPPY_PLATFORM_AUTH_REF` | `server.ts:486`(`{file:}` 引用) | ext `platform-credential-header.ts:31`(经 `plugin.ts:226`) | `platform.credentialRef` |
| `CODEPUPPY_DEFAULT_MODEL` | 用户导出 | `codepuppy-models.ts:274`(`??`:空串也算导出,随后 `:278` 不写默认模型) | `platform.defaultModelOverride`(空串保留) |
| `CODEPUPPY_CLOUD_MCP_URL` | `codepuppy-auth.ts:369-370`(set-if-unset) | 注入 `:219,:226`;URL 原样进定义(`cloud-sidecar-config.ts:33`) | `cloudMcp`(main 用同一个 `materializeCloudMcpConfig` 算好定义;无凭据 URL) |
| `CODEPUPPY_CLOUD_MCP_SERVER` / `_DEF` / `_ARM` | sidecar 注入(C7) | 见 C7 | `cloudMcp.name` / `cloudMcp.definition`;ARM 由 `cloudMcpArmed()` 推出 |
| `CODEPUPPY_WEBSEARCH_DISABLE` | 用户导出 | main `server.ts:336`;注入 `:222` | `webSearch.killSwitch` |
| `CODEPUPPY_LOCAL_WEBSEARCH_DENY` / `CODEPUPPY_CLOUD_WEBSEARCH_DENY` | `server.ts:337-340`(两个都恒等于 kill-switch) | ext `cloud-websearch-kill.ts:143-153` | 删除;读方直接读 `webSearch.killSwitch` |
| `CODEPUPPY_FACTORY_SKILL_DIRS` | `index.ts:855`(boot 时算一次) | 注入 `:112`(`explicitSkillDirs`,C4 的监听也调它) | `skills.factoryDirs` |
| `CODEPUPPY_FACTORY_DENY_SKILLS` | `index.ts:858`,值恒为常量 `["customize-opencode"]`(`codepuppy-builtin-policy.ts:44-49`,`effectiveFactoryDenied` 忽略入参) | ext `plugin.ts:254,310,315`;env 缺席或坏时 `factoryDeniedSkills` 返回 `[]`(`ext/src/factory-deny.ts:62-70`,失效即放开) | 删除通道;常量只留一处(§10 R7) |
| `CODEPUPPY_POLICY_ACCOUNT` | `server.ts:499-500`(直接写 `sidecarEnv`) | ext `policy/index.ts:71` | `policy.account` |
| `CODEPUPPY_EXT_BUNDLED_MANIFEST` | `server.ts:503` | ext `policy/bundled-plugin.ts:36` | `paths.extBundledManifest` |
| `CODEPUPPY_OFFICE_MCP_MANIFEST` | `server.ts:492` | core `mcp/codepuppy-first-party-mcp.ts:53`(经 `mcp/index.ts:450`);ext `policy/identity.ts:104` | `paths.officeMcpManifest` |
| `CODEPUPPY_EGRESS_PROXY` | `sidecar-env.ts:311`(仅 darwin) | `schema/src/codepuppy-net-failure.ts:168`(调用方 core `mcp/codepuppy-startup.ts:68`、`session/to-session-error.ts:57`,ext `policy/display.ts:97`) | `network.egressProxy` |
| `CODEPUPPY_MODELS_DISABLE` | 用户导出 | `codepuppy-models.ts:130`(`=== "1"`) | `switches.modelsDisabled` |
| `CODEPUPPY_IDENTITY_DISABLE` / `CODEPUPPY_BEHAVIOR_DISABLE` | 用户导出 | 注入 `:231-232`(非空即真) | `switches.identityDisabled` / `behaviorDisabled` |
| `CODEPUPPY_PROMPT_REBRAND_DISABLE` | 用户导出 | 注入 `:322`;ext `plugin.ts:187,258`(`=== "1"`) | `switches.promptRebrandDisabled` |
| `CODEPUPPY_ECOSYSTEM_INHERIT` | 用户导出 | 注入 `:173`;main `ecosystem-import.ts:30` | `switches.ecosystemInherit` —— **今天到不了 sidecar** [测] |
| `CODEPUPPY_AUTOMATION_DISABLE` / `CODEPUPPY_READONLY_DISABLE` | 用户导出 | 注入 `:334,:371,:441` | `switches.automationDisabled` / `readonlyDisabled` —— **今天到不了** [测] |
| `CODEPUPPY_EXT_VERBOSE` | 用户导出 | ext `plugin.ts:115,249,284,324` | `switches.extVerbose` —— **今天到不了** [测] |
| `CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS` | 用户导出 | core `permission.ts:101-105` | `permission.askTimeoutMs` —— **今天到不了 sidecar** [测];仓内 CLI 宿主里有效(P-09) |
| `OPENCODE_DISABLE_MODELS_FETCH` | `server.ts:391` 设默认 `"1"`(`??`,不替换空串) | sidecar `engine-server-options.ts:65-69` | `engine.modelsFetch` |
| `OPENCODE_EXPERIMENTAL_FILEWATCHER` | `server.ts:388` 设默认 `"true"`(`??=`,不替换空串) | sidecar `engine-server-options.ts:68`;core `filesystem/codepuppy-project-watch.ts:14-18`(经 `location-watcher.ts:83`) | `engine.filewatcher`(一个判法,§10 R9);仓内 CLI 宿主里由兼容入口读(P-09) |
| `StartCommand` 的 `userDataPath` / `initialDirectory` / `databasePath` / `configDirectory` / `extPluginPath` / `registryChannel` | `server.ts:660-672` | `sidecar.ts:139-246`、注入 | `paths.*` / `registryChannel` |

不过边界的值:密钥(`CODEPUPPY_API_KEY`、`CODEPUPPY_CLOUD_TOKEN`、`CODEPUPPY_MCP_TOKEN`、BYOK 各 `keyEnv`、`custom-provider--<id>`;
`codepuppy-secret-files.ts:39-50`)只以文件存在;引擎口令只在 `StartCommand` 里(`sidecar.ts:243` 注释 I1)。

### 2.3 其它所依赖的事实

- **P-01 子进程继承 sidecar 环境**:见 C1 [读]。今天 C1 里的 `CODEPUPPY_*`(含云 MCP 完整定义、策略分区哈希、各路径)都进每个第三方 MCP / LSP / shell 子进程;
  `server.ts:493-497` 的注释已经为 `CODEPUPPY_POLICY_ACCOUNT` 处理过这一点。
- **P-02 进程内交接**:`in-process-engine.ts:15-24` 用 `Symbol.for(...)` 挂在 `globalThis`,sidecar 写、ext 读,两个独立 bundle [读]。
  引擎经 `import("virtual:opencode-server")` 在同一线程装入(`sidecar.ts:155`);首次启动、预载与 Location 重载都在同一 realm 里求值插件
  (`plugin/src/source.node.ts:14`、`util/src/runtime/import.node.ts:8`;R1 审计方核对)[读]。
- **P-03 一代 sidecar = 一个新进程**:每次 `spawnLocalServer` 都 `utilityProcess.fork`(`server.ts:548-560`);重启原因是封闭表(C11)[读]。
- **P-04 落点**:`packages/schema/AGENTS.md:8`「Schema values should be serializable contract definitions, not service implementations or runtime registries」,
  `:3` 要求宿主本地的实现细节留在所属包 —— 进程级发布 / 读取不能放 schema。`packages/util` 没有 `AGENTS.md`,零 `@opencode/*` 依赖,
  `package.json` 导出 `./*`,本身已持有进程级状态(`util/src/global.ts`、`flock.ts`);core、plugin、ui-mac 都已依赖 `@opencode/util`,
  ext 经相对路径 import 别包源码有先例(`ext/src/policy/display.ts:13`、`policy/identity.ts:24,26`);schema 不依赖 util(依赖方向
  `schema ← protocol ← server`,`schema/AGENTS.md:7`)。命名 `codepuppy-*` + `north-star:codepuppy-owned` 标记满足 ADR-043 的自有文件谓词 [读]。
- **P-05 引擎配置层序与全局配置目录**:加载序 managedPolicies → integrated → wellknown → global → explicit → direct → project → content → managedSettings,
  设置后加载者胜、policy 先加载者胜(`engine-explicit-config.ts:3-9` 对 `core/src/config.ts`、`managed-policy.ts` 的转述)[读]。
  `start()` 的 `config.directory` **只换配置根**:`server/src/routes.ts:134` 只传 `{ config }`,`util/src/global.ts:84` `layerWith(Partial<Interface>)`,
  数据根不动;配置根下引擎读 `opencode.json(c)`、`AGENTS.md`(`core/src/config/plugin/instruction.ts:41`)与配置子目录(`core/src/config/discovery.ts:68-72`)[读]。
  调查文档 C 表第 8 行说选项 (b)「moves the data directory」,按这三处不成立 —— R5 管的数据目录与它无关。
- **P-06 白名单实测**[测]:隔离 HOME / XDG 的临时目录里,bun 1.3.14 直接调生产的 `createSidecarEnv`(`@df748c16e7`,该文件到 `30b9a679f8` 未变),
  工作树不被写:

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
  `sidecar-env.ts:93-97` 注释里「逃生舱错位」(#606)同一类。反过来,用户把任何名字写进 `CODEPUPPY_ENV_ALLOWLIST_EXTRA` 都会被 `:273` 放行,包括已迁走的键。
- **P-07 运行中变化的现有路径**:技能翻代 / 新装 / 停用与 `codepuppy.jsonc` 改动走 C4 的监听;定制中心重载走 C8;工具策略走 C9;同身份续期走 C6;
  登录 / 登出 / 换号、provider / BYOK / 连接器 / 凭据在场性变化走 C11;端点发现与后台 shell 环境刷新等下一次 fork(`codepuppy-endpoints.ts:100-103`、`server.ts:349-370`)[读]。
  没有任何一项需要在 sidecar 进程活着时改 C1 / C2 里的值。
- **P-08 两个引擎开关的取值实测**[测]:同样的隔离方式,直接调生产的 `engineDesktopToggles`(`engine-server-options.ts:65-69`)与
  `projectWatchEnabled`(`codepuppy-project-watch.ts:17-18`),两个变量取同一个值:

  ```
  未设     modelsFetch=false engineFilewatcher=true  coreProjectWatch=false
  ""       modelsFetch=true  engineFilewatcher=false coreProjectWatch=false
  "1"      modelsFetch=false engineFilewatcher=true  coreProjectWatch=true
  "true"   modelsFetch=false engineFilewatcher=true  coreProjectWatch=true
  "yes"    modelsFetch=true  engineFilewatcher=false coreProjectWatch=true
  "on"     modelsFetch=true  engineFilewatcher=false coreProjectWatch=true
  ```

  空串不等于未设:导出 `OPENCODE_DISABLE_MODELS_FETCH=""` 打开拉取,导出 `OPENCODE_EXPERIMENTAL_FILEWATCHER=""` 关掉监听(main 的默认值写法都不替换空串)。
  sidecar 里 main 已先写默认 `"true"`(`server.ts:388`),所以「未设」那一行的 `coreProjectWatch=false` 只出现在没有这一步的宿主里。
- **P-09 读这些值却没有启动文档的宿主**[读]:
  - 仓内 CLI 宿主 `packages/cli/src/server-process.ts:101-145` 直接调 `start()`,不经 sidecar;它装的 core 里有 Code Puppy 的审批期限(`permission.ts:101-105`)
    与项目文件监听(`codepuppy-project-watch.ts:17-18`),两者今天在这里按用户环境生效。core 单测同属此类。它不装 ext。
  - WSL 宿主跑的是从 `https://opencode.ai/install` 装进 WSL 的上游发布版 OpenCode(`wsl/runtime.ts:262-266`),启动脚本只导出 `OPENCODE_*`
    (`wsl/sidecar.ts:26-37`),不装 ext:里面没有 Code Puppy 的读者,不是本设计的宿主。
  - 在子进程里求值 ext 的测试(`ext/src/plugin-setup-order.cases.ts:52,60`、`plugin-reload-wiring.cases.ts:28,39`)今天在 import ext 之前写
    `process.env.CODEPUPPY_GLOBAL_DIR`;同一文件里已用 `publishInProcessEngine` 在本进程发布进程内 fetch(`plugin-reload-wiring.cases.ts:31`)。
- **P-10 登记册里机制文字引用了环境变量的条目**[读]:`tool-policy-partitions`(`CODEPUPPY_POLICY_ACCOUNT`)、`adr038-ask-deadline`
  (`CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS`)、`l1r-output-caps`(`CODEPUPPY_BASE_URL`)、`project-file-change-events`(`OPENCODE_EXPERIMENTAL_FILEWATCHER`)。
- **P-11 ext 就绪判定只看 ext**:`sidecar-ext-ready.ts:21-49` 只核 ext 在初始目录上 active;引擎 bundle(`dist-engine`)是否认得启动文档,今天没有任何判定 [读]。
  一个迁移前的 ext 在没有 `CODEPUPPY_GLOBAL_DIR` 时 `setup` 抛(`plugin.ts:117`)⇒ 插件 failed ⇒ 不报 ready [读]。

#### G4 所依赖的事实

- **P-12 层序与策略胜负**:配置文档的装载序是 managedPolicies → integrated → wellknown → **global** → explicit → direct → project → content → managedSettings
  (`core/src/config.ts:363-373`);一个配置目录内依次是 `opencode.json`、`opencode.jsonc`、再是目录条目(`config.ts:266-273`,`config/discovery.ts:12`)[读]。
  设置后加载者胜、策略先加载者胜、同一文档里后写的策略胜(`managed-policy.ts:10-35`)[读];I-03 的真引擎探针已钉住
  「global < explicit < project < content,后者胜」与「策略先加载者胜」(`ext/src/upstream-probes/config.test.ts:119-137`)[读]。
- **P-13 今天独立 OpenCode 的全局策略压得过 Code Puppy 的白名单**[测]:用生产的 `ManagedPolicy.statements` / `decision`
  按装载序排文档(隔离 HOME / XDG 的临时目录,bun 1.3.14,`@ab31da3d24`):

  ```
  今天:独立全局 allow * | 显式层白名单                         foreign=allow codepuppy=allow
  今天:独立全局无策略 | 显式层白名单 | 项目 allow               foreign=deny  codepuppy=allow
  G4:导入文档(无策略)| 出厂层白名单 | 用户 allow | 项目 allow   foreign=deny  codepuppy=allow
  反向臂:导入文档带 allow * 且排在出厂层之前                    foreign=allow codepuppy=allow
  ```

  即今天用户在 `~/.config/opencode/opencode.json` 里写一条 `provider.use` 放行,就能绕过 Code Puppy 的模型服务白名单;
  G4 后它不在引擎视野里;导入时若带上 `policies`,同一个洞会在 Code Puppy 自己的目录里重开。
- **P-14 各类内容怎么从配置目录与文档里收集**[读]:命令 —— 各文档的 `commands` 与目录条目下 `command(s)/*.md`,按条目顺序后者覆盖同名
  (`config/plugin/command.ts:29-52,138-143`);agent —— 文档 `agents` 与 `agent(s)/`、`mode(s)/`(`agent.ts:27,44-75`);技能 —— 所有文档的 `skills`
  累加,外加每个目录条目的 `skill(s)/`,相对条目按会话所在目录解析,同 id 后者胜(`skill.ts:86-101,152-157`;I-03 探针 P5,`config.test.ts:139-150`);
  全局指令 —— 配置根下的 `AGENTS.md` 与各文档的 `instructions`,相对条目按配置根解析(`instruction.ts:41,97-116,155`);
  插件 —— 目录条目下 `plugin(s)/` 与文档 `plugins`(增减指令),相对路径按文档所在目录解析(`config/plugin/source.ts:124-150`,`plugin/source-directory.ts:7`)。
  所以今天独立 OpenCode 全局目录里的插件也会在 Code Puppy 引擎里装载。
- **P-15 引擎监听与坏文件**[读]:引擎递归监听全局目录、并按名字监听显式文件所在目录(`config/watch.ts:8-41`),原子改名写入照样触发重载;
  JSON 坏掉或校验不过的文档记一条警告后跳过,引擎不退出(`config.ts:136-175`)。`Config.update` 只会把 `shell` 写进全局目录最后一个存在的配置文件
  (`config.ts:465-485`),Code Puppy 的界面不挂上游的配置写入口(`engine-adapter/routes.ts:586`)。上游三个处理器把全局配置目录当作一个 Location 打开
  (`server/src/handlers/credential.ts:16-19` 等),不依赖它的具体位置 [推]。
- **P-16 main 里推导「全局配置目录」的六处**[读]:都写着同一条规则 `OPENCODE_CONFIG_DIR > XDG_CONFIG_HOME/opencode > ~/.config/opencode`,用途分两类 ——
  「引擎读的那个目录」:`engine-paths.ts:34-35`(交给 `start()`,`mcp-default-deny.ts:55` 也经它);
  「独立 OpenCode 的共享目录」:`ext-config.ts:96-104`(逃生阀 `CODEPUPPY_LEGACY_INSTALL_ROOT` 的写入目标)、`ext-fs-installer.ts:34-39`(同一逃生阀的写入根)、
  `codepuppy-migrate.ts:28-32`(默认关的旧目录迁移来源)、`engine-config-truth-boot.ts:47-58`(REQ-059 每次启动把这里的 `provider` 抬进 `codepuppy.jsonc`,`:133,180`)、
  `engine-config-dangling.ts:178-187`(悬挂条目清扫里标为 `foreign` 的目标)。今天两类是同一个目录,G4 后分开。
- **P-17 不能用 `codepuppy-engine-config/` 当全局目录**[读]:那里放每次重生成的显式文件与模型底表,而且老机器上可能留着已退役 v2 桥写的
  `opencode.json`(`naming-migration.ts:326` 专门为它改写路径);当全局目录用,它会被当成一份配置文档装载。
- **P-18 测试隔离**[读]:I-08 的共用预载(`scripts/test-isolation/preload.ts`,提交 `54b620bb22`)给每个包的测试换掉 HOME、全部 `XDG_*`、`OPENCODE_DB`、
  `TMPDIR`,并删掉 `OPENCODE_CONFIG_DIR` / `OPENCODE_CONFIG`。
- **P-19 归一化会把旧键变回策略、插件与模型服务**[读]:`provider` → `providers`(`config/normalize.ts:168-176`)、`plugin` → `plugins`(`:185-190`)、
  `enabled_providers` / `disabled_providers` → `provider.use` 策略(`:405-415`)。R2 审计方用生产函数做了内存探针:按原始键剔除后,白名单外的 `anthropic` 仍为 allow。
- **P-20 项目发现只按「全局根」排除**[读]:`config/discovery.ts:115-125` 只把当前的系统目录、全局目录、`~/.claude`、`~/.agents` 及其配置文件(按解析后的真实路径)
  排除在项目上溯之外;会话开在全局根里时不做项目上溯(`:76-80`)。换根后独立目录不再在这张表里。
- **P-21 共享库里的登录会带来配置文档**[读]:well-known 来源列表与其缓存配置存在 KV(`wellknown.ts:105,139,209-213`),KV 在会话库里(`core/src/kv.ts:5-7,39`);
  Console 连接由 `opencode.provider.opencode` 写成 integrated 文档(`plugin/provider/opencode.ts:272-298`);两者都排在全局层之前装载,
  只有 managed 策略能扣下它们(`config.ts:336-362` 的 `supplies`),而该插件在移除指令的守护名单里(`plugin/internal.ts:304-306`)。
- **P-22 扫描跟随软链接**[读]:命令与 agent 的扫描都带 `symlink: true`(`config/plugin/command.ts:143`、`agent.ts:137`)。
- **P-23 引用的解析基准各不相同**[读]:`{file:}` 按所在文档目录(`config/variable.ts:42,61-62`);相对 `instructions` 在开着项目发现时从会话位置上溯到项目根
  (`instruction.ts:96-114`);相对 `skills` 按会话位置(`skill.ts:96-101`)。
- **P-24 缺策略即放行;今天运行中坏文件保留上一份**[读]:`ManagedPolicy.decision` 无匹配返回 `allow`(`managed-policy.ts:37-39`),
  `tool.use`、`skill.use` 等都经它(`config/plugin/policy.ts:92-98`);今天合成监听在用户文件改坏时不重写(`engine-explicit-config.ts:113-117`)。
- **P-25 配置健康检查用的是 v1 键表**[读]:`ext-config.ts:1499-1505` 的键表没有 `policies`、`agents` 等 2.x 键,根为 `[]` 时不报错(`:1525`)。
- **P-26 引擎入口外层的 `Global` 另取配置根**[读]:`engine-embed.ts:48` 提供 `Global.node`,它取 `OPENCODE_CONFIG_DIR ?? Path.config` 并对配置根 mkdir
  (`util/src/global.ts:68,79`);`start()` 的 `config.directory` 只替换服务端那一层(`server/src/routes.ts:134`)。

## 4. 接口契约

### API

不适用:不加、不改 HTTP 接口。

### 数据

不适用:启动文档只在内存里,不落盘;C3–C6 的磁盘形状不变。

### 事件 / 配置

#### 4.1 启动文档 `CodePuppyBootstrap` v1

位置:`packages/util/src/codepuppy-bootstrap.ts`,Code Puppy 自有文件(ADR-043:`codepuppy-` 文件名 + `north-star:codepuppy-owned` 标记),
只 import `node:path`。不放 schema(P-04)。归属:**main 构建,sidecar 解析并发布,其余只读**。

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
    modelProxyBaseURL?: CredentialFreeUrl
    defaultModelOverride?: string       // 缺席 = 没导出(用目录默认);"" = 导出了空串(今天的语义:不设默认模型)
  }
  cloudMcp?: {                     // main 解析出合格的云 MCP 地址时在场
    name: string                   // 配置里那一条 MCP 的名字(今天 "codepuppy")
    definition: {                  // 带凭据通道的完整定义;认证只在 header 的引用里
      type: "remote"
      url: CredentialFreeUrl
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

/**
 * 无凭据 URL:WHATWG `URL` 能解析;协议 https,或 http 且主机是 127.0.0.1 / localhost / [::1];
 * username、password 为空;search 与 hash 为空(整段查询串与片段都不允许,不按参数名猜哪个是凭据)。
 * 路径段不检查 —— 规则覆盖的是 URL 语法里留给凭据与参数的位置;本仓写出的 URL 都没有查询串与片段。
 */
export type CredentialFreeUrl = string & { readonly __credentialFree: unique symbol }
export function isCredentialFreeUrl(value: string): value is CredentialFreeUrl

export type CodePuppyBootstrapErrorReason = "invalid" | "version" | "unpublished" | "republished"
export class CodePuppyBootstrapError extends Error {
  readonly name = "CodePuppyBootstrapError"
  constructor(readonly reason: CodePuppyBootstrapErrorReason, readonly path?: string) // path = 出错字段的点路径;消息里不带值
}

/** 严格解析:多键、缺必填键、类型或格式不符 ⇒ "invalid"(带 path);v !== CODEPUPPY_BOOTSTRAP_VERSION ⇒ "version"。返回深冻结的副本。 */
export function parseCodePuppyBootstrap(value: unknown): CodePuppyBootstrap
/** sidecar 每个进程调用一次;第二次 ⇒ "republished"。把已校验的普通对象深冻结后挂在 globalThis[Symbol.for("codepuppy.bootstrap")],与 C10 同一形状。 */
export function publishCodePuppyBootstrap(document: CodePuppyBootstrap): void
/**
 * sidecar 与 ext 用。第一次调用时用**本 bundle 编进去的** parseCodePuppyBootstrap 解析已发布的对象并记住结果:
 * 未发布 ⇒ "unpublished";版本或形状与本 bundle 不符 ⇒ "version" / "invalid"。
 */
export function codepuppyBootstrap(): CodePuppyBootstrap
/** 引擎侧 Code Puppy 代码用:未发布 ⇒ undefined;已发布则同 codepuppyBootstrap()(本 bundle 解析,不符即抛)。 */
export function tryCodePuppyBootstrap(): CodePuppyBootstrap | undefined
/** 今天的 CODEPUPPY_CLOUD_MCP_ARM:kill-switch 下云 MCP 只由 ext 装。 */
export function cloudMcpArmed(document: CodePuppyBootstrap): boolean   // webSearch.killSwitch && cloudMcp !== undefined

/**
 * 无文档宿主的兼容入口(§4.3):引擎侧两项今天由用户环境可调的设置,只有这一个读法。
 * 有文档 ⇒ 读文档;无文档(仓内 CLI 宿主、core 单测)⇒ 逐字沿用今天的环境判法。
 */
export function codepuppyEngineSettings(env: Record<string, string | undefined> = process.env): {
  /** 文档:permission.askTimeoutMs ?? 300000。无文档:CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS 为正整数则取之,否则 300000(今天 permission.ts:101-105)。 */
  askTimeoutMs: number
  /** 文档:engine.filewatcher。无文档:OPENCODE_EXPERIMENTAL_FILEWATCHER 去空白、转小写后 ∈ {true, 1, yes, on}(今天 codepuppy-project-watch.ts:17-18)。 */
  projectWatch: boolean
}
```

每个 bundle(sidecar、ext、引擎)各自编进一份本模块;发布的是一个普通对象,各 bundle 第一次读时用自己的解析器校验,所以任何两份不同提交构建出的
bundle 混在一起,只要形状或版本不同,就在第一次读时失败,而不是读到缺字段。
格式校验的意图:`platform.credentialRef` 与 `cloudMcp.definition.headers.Authorization` 只容得下 `{file:<路径>}` 引用;两个 URL 字段只容得下无凭据 URL;
其余字段是路径、布尔、整数、枚举与模型 id。密钥值写不进这份文档 —— 塞进去会在构建或解析时失败,不只靠约定。
仅测试的重置入口沿用 `__resetCodePuppyEnvironmentForTests` 的先例(`codepuppy-environment.ts:386`)。
G4 把版本升到 2,`paths` 多一个必填的 `standaloneConfigDirectory: string`(§4.7);上面是 G1–G3 落地时的 v1 形状。

#### 4.2 启动命令与启动关口

```ts
type StartCommand = {
  type: "start"
  hostname: string
  port: number
  password: string                  // 密钥:只在这里,永不进启动文档
  fence?: ProcessFenceStartInput    // 在发布启动文档之前 apply,不是给 ext / core 的决定
  bootstrap: unknown                // start() 内解析;失败 ⇒ error IPC + exit(1)
}
```

`userDataPath`、`initialDirectory`、`databasePath`、`configDirectory`、`extPluginPath`、`registryChannel` 移进启动文档。
`parseCommand` 只校验传输字段;启动文档的解析放进 `start()` 的 try 里,坏文档走与「darwin 缺围栏」同一条响亮失败路(`sidecar.ts:204-207`)。

引擎入口 `ui-mac/engine/engine-embed.ts`(Code Puppy 自有,打成 `dist-engine/engine.mjs`)多导出一个函数,`env.d.ts` 里 `virtual:opencode-server` 的声明同步:

```ts
/** 用引擎 bundle 自己编进去的 codepuppyBootstrap() 读一次已发布的文档;未发布、版本或形状不符 ⇒ 抛 CodePuppyBootstrapError。 */
export function assertCodePuppyBootstrap(): void
```

sidecar `start()` 的顺序(全部在同一个 try 里,任一步失败 ⇒ error IPC + exit(1),这一代 failed,不报 ready):

1. 装围栏(不变)。
2. 用 sidecar 自己的解析器解析 `command.bootstrap`,发布。
3. 注入、显式层监听(读文档)。
4. `import("virtual:opencode-server")`;**模块没有 `assertCodePuppyBootstrap` 导出 ⇒ 抛**(迁移前的引擎 bundle);有则调用,不符即抛。然后才 `startEngine`。
5. ext 预载与就绪判定(不变):ext 的 `setup` 第一步 `codepuppyBootstrap()`,不符即抛 ⇒ 插件 failed ⇒ `assertExtPluginActive` 拒报 ready;
   迁移前的 ext 因缺 `CODEPUPPY_GLOBAL_DIR` 在 `plugin.ts:117` 抛,落在同一处(P-11)。

于是 sidecar、引擎、ext 三份 bundle 任一份认不得这份文档,引擎都不会报 ready。

#### 4.3 谁在什么时候读

- **sidecar**:关口第 2 步之后,注入、C4 的监听、`start()` 选项都只读文档。sidecar 里与 main 共用的模块(全局根、真源记录、`codepuppy.jsonc` 路径)
  今天在无快照时退回 `process.env.CODEPUPPY_GLOBAL_DIR`,改为退回已发布的文档;main 仍用冻结快照。sidecar 不再按自己的环境重算 main 已算过的值
  (例如 `mcp-default-deny.ts:55` 重算全局配置目录,改读 `paths.engineConfigDirectory`)。
- **ext**:`codepuppyBootstrap()`。`setup` 第一步读一次并复验 `paths.globalRoot` 的 canonical 身份(沿用 `project-config.ts:84-108` 的检查)。
  ext 没有无文档模式,与今天缺 `CODEPUPPY_GLOBAL_DIR` 时一样失败关闭。钩子在调用时读,不缓存可变副本。
- **引擎侧 Code Puppy 代码**(core / plugin 的自有文件与已接管文件的既有 `codepuppy(...)` 块):

  | 读方 | 读法 | 有文档 | 无文档(仓内 CLI 宿主、core 单测) |
  | --- | --- | --- | --- |
  | `core/src/permission.ts` 审批期限(已接管,ADR-038) | `codepuppyEngineSettings().askTimeoutMs` | `permission.askTimeoutMs ?? 300000` | **兼容入口**:今天的环境判法 |
  | `core/src/filesystem/codepuppy-project-watch.ts`(自有,经 `location-watcher.ts:83`) | `codepuppyEngineSettings().projectWatch` | `engine.filewatcher` | **兼容入口**:今天的环境判法 |
  | `core/src/mcp/codepuppy-first-party-mcp.ts`(自有) | `tryCodePuppyBootstrap()?.paths.officeMcpManifest` | 文档值 | 不声明,连上后再列 |
  | `plugin/src/alpha-cloud-authority.ts`(自有) | `tryCodePuppyBootstrap()?.cloudMcp` | 文档值 | 无治理云 MCP |
  | `schema/src/codepuppy-net-failure.ts` 的 `engineNetFailurePath`(自有,schema 不依赖 util) | 改成显式参数:`engineNetFailurePath(target, env, egressProxy?: string)`;调用方传 `tryCodePuppyBootstrap()?.network.egressProxy` | 文档值 | `{ via: "other" }` |

  兼容入口**只**覆盖前两行:它们是今天用户在仓内 CLI 宿主里能用环境调的两项。后三行的值今天只由 Code Puppy 主进程写(`server.ts:492`、
  `sidecar-env.ts:311`、注入 `:546-547`),无文档宿主从未经我们的代码或 runbook 得到过它们,无文档时取缺席与今天相同。
  在 sidecar 里文档在引擎 import 之前已发布(§4.2 第 2 步),兼容入口的环境分支到不了 —— 单通道在 sidecar 里成立。
- **在子进程里求值 ext 的测试**:在 import ext 之前,用 `publishCodePuppyBootstrap(parseCodePuppyBootstrap(fixture))` 在本进程发布一份文档,
  与同一文件里 `publishInProcessEngine` 的写法相同(`plugin-reload-wiring.cases.ts:31`);不再写 `CODEPUPPY_GLOBAL_DIR`。夹具经生产解析器,形状错了在夹具处就红。
- 上游路径里的改动只落在已接管文件既有的 `codepuppy(...)` 标注块内,或自有文件;不新增接管。已接管文件里需要改的调用点:`mcp/index.ts:450`
  (原 `codepuppy(#1565)` 一行)、`session/to-session-error.ts:57`(原 `codepuppy(#1572)` 块)、`permission.ts:101-105`(原 `codepuppy(ADR-038)` 块)。
- 读方保留各自今天的注入参数作测试接缝(生产传已发布的文档);除兼容入口外,不读 `process.env` 取 Code Puppy 的决定。

#### 4.4 main 的构建

`buildCodePuppyBootstrap(input): CodePuppyBootstrap` 放在 ui-mac 主进程,每次 fork 在 `spawnLocalServer` 里、密钥同步与出网代理起好之后调用一次
(今天 `createSidecarEnv()` 的位置),输出原样放进 `StartCommand.bootstrap`。输入全部来自现有权威:冻结环境快照
(`resolveCodePuppyGlobalRoot`、`registryChannel`)、`engine-paths.ts` 的库与配置目录、`resolveExtPluginPath`、boot 时 `reconcileFactorySkills` 的结果、
`applyAuthEnv` 写进 main 环境的两个 URL、`materializeCloudMcpConfig` + `secretFileRef`、当刻登录态的分区哈希、出网代理端口。

- **每个键沿用今天读方的判法,空串的含义按键保留**,不统一成「空串当缺席」。两个引擎开关直接调用 `engineDesktopToggles`(`engine-server-options.ts:65-69`),
  `defaultModelOverride` 原样保留空串。
- **URL**:`CODEPUPPY_BASE_URL` 与云 MCP 地址先过 `isCredentialFreeUrl`;不合格 ⇒ 该字段省略(这一代没有平台模型服务 / 没有云 MCP),
  main 记一行 `bootstrap: <变量名或来源> rejected (userinfo, query, fragment or non-https)`,不写值。认证只走 `credentialRef` 与 header 里的 `{file:}` 引用。
- 构建器对用户导出的值从不抛;只在结构性缺陷(例如资源根 `realpath` 失败,今天 `server.ts:492` 同样会抛)时抛。

运维开关的名字对用户不变,只是读的地方从 sidecar / ext / core 收到构建器一处:

| 配置键(main 的环境) | 类型 | 默认 | 必填 | 读取入口 → 字段 | 导出为 `""` |
| --- | --- | --- | --- | --- | --- |
| `CODEPUPPY_MODELS_DISABLE` | `"1"` | 未设 | 否 | 构建器 → `switches.modelsDisabled`(`=== "1"`) | 同未设 |
| `CODEPUPPY_IDENTITY_DISABLE` / `CODEPUPPY_BEHAVIOR_DISABLE` | 任意非空串 | 未设 | 否 | → `switches.identityDisabled` / `behaviorDisabled` | 同未设 |
| `CODEPUPPY_PROMPT_REBRAND_DISABLE` | `"1"` | 未设 | 否 | → `switches.promptRebrandDisabled` | 同未设 |
| `CODEPUPPY_AUTOMATION_DISABLE` / `CODEPUPPY_READONLY_DISABLE` | 任意非空串 | 未设 | 否 | → `switches.automationDisabled` / `readonlyDisabled` | 同未设 |
| `CODEPUPPY_ECOSYSTEM_INHERIT` | `"1"` | 未设 | 否 | → `switches.ecosystemInherit` | 同未设 |
| `CODEPUPPY_EXT_VERBOSE` | 任意非空串 | 未设 | 否 | → `switches.extVerbose` | 同未设 |
| `CODEPUPPY_WEBSEARCH_DISABLE` | 任意非空串 | 未设 | 否 | → `webSearch.killSwitch` | 同未设 |
| `CODEPUPPY_JSONC_TRUTH_DISABLE` / `CODEPUPPY_LEGACY_INSTALL_ROOT` | `"1"` | 未设 | 否 | 任一置位 → `paths.userConfig` 缺席 | 同未设 |
| `CODEPUPPY_DEFAULT_MODEL` | 字符串 | 未设 | 否 | → `platform.defaultModelOverride` | **不设默认模型、也不用目录默认**(今天如此,保留) |
| `CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS` | 正整数 | 300000 | 否 | → `permission.askTimeoutMs`(不合法 ⇒ 省略) | 同未设 |
| `CODEPUPPY_BASE_URL` / `CODEPUPPY_CLOUD_MCP_URL` | 无凭据 URL | `applyAuthEnv` 写 | 否 | → `platform.modelProxyBaseURL` / `cloudMcp` | 被 `applyAuthEnv` 改写为派生值(今天如此) |
| `OPENCODE_DISABLE_MODELS_FETCH` | 见 P-08 | `"1"` | 否 | `engineDesktopToggles` → `engine.modelsFetch` | **拉取开**(今天如此,保留) |
| `OPENCODE_EXPERIMENTAL_FILEWATCHER` | 见 P-08 | `"true"` | 否 | `engineDesktopToggles` → `engine.filewatcher` | **监听关**(今天如此,保留) |

#### 4.5 留在进程环境里的

规则:**sidecar 环境里不再有 `CODEPUPPY_*`,只剩用户的 `CODEPUPPY_ENV_ALLOWLIST_EXTRA` 本身**;其余都是非 Code Puppy 读者要的:

| 项 | 为什么留在环境 |
| --- | --- |
| `PATH`、`HOME`、`USER`、`SHELL`、`TMPDIR`、`TERM`、`LANG`、`TZ`、`SSH_AUTH_SOCK`、`LC_*`、`ELECTRON_*` | 子进程与 Node 本身要 |
| 八个代理变量(darwin 下整份改写成出网代理,`sidecar-env.ts:299-313`;不再写 `CODEPUPPY_EGRESS_PROXY`) | 子进程(curl / git)与 `http.setGlobalProxyFromEnv()`(`sidecar.ts:154`)要 |
| `NODE_*` | Node 运行时 |
| `XDG_*` | 上游在模块装载时按它们算全局根(`sidecar.ts:242-244`);ext 按它找 OpenCode 数据根(`policy/index.ts:44-46`,既有 K2 偏离) |
| `OPENCODE_*` 前缀 | 上游自己的变量,不在本设计范围;`OPENCODE_CONFIG_CONTENT`、`OPENCODE_FLAGS` 仍永不继承 |
| `UV_CACHE_DIR`(`server.ts:489`) | 随包 Office 依赖的 uv 子进程 |
| `CODEPUPPY_ENV_ALLOWLIST_EXTRA` | 它本身就是「让某个变量进子进程」的用户逃生门 |

`createSidecarEnv` 的判定顺序:`isSecretish` → `NEVER_INHERIT` → **`CODEPUPPY_` 前缀拒绝**(不分大小写,唯一例外是 `CODEPUPPY_ENV_ALLOWLIST_EXTRA` 本身)
→ 放行规则(EXTRA / EXACT / PREFIXES)。拒绝排在 EXTRA 之前:用户把已迁走的键写进 EXTRA 也放不回去(P-06 末句)。
EXACT 里的 `CODEPUPPY_*` 条目与 `EGRESS_PROXY_MARKER_ENV` 随各自的键删除。
这条规则由测试机判:以生产 `createSidecarEnv` + fork 前的覆盖算出交给 `fork` 的那份环境,把 §2.2 每个旧键都导出、并全部写进 EXTRA,
断言没有 `CODEPUPPY_*` 漏进去;反向臂是去掉前缀拒绝或加回任一键即红。

#### 4.6 运行中的变化怎么传

启动文档在一个 sidecar 进程的生命期内**不变**。运行中的变化只走已有的路,本设计不新增通道:

| 变化 | 怎么传 | 本设计改了什么 |
| --- | --- | --- |
| 技能翻代 / 新装 / 停用;main 或用户改 `codepuppy.jsonc` | C4 监听重写显式文件 → 引擎重载 | 监听的输入(`globalRoot`、`factoryDirs`、`userConfig`)改读文档。G4 起:技能变化时监听重写出厂层文件;`codepuppy.jsonc` 变化时监听校验后更新 `codepuppy.engine.jsonc`,引擎按它重载(§4.7) |
| 定制中心安装后的重载 | C8 `codepuppy.reload.request` | 无 |
| 工具策略启停 | C9 插件 RPC | 无 |
| 同身份续期 | C6 原子重写,每次请求现读 | 无(文档只带引用) |
| 登录 / 登出 / 换号;provider、BYOK、连接器、凭据在场性变化 | C11 结构性重启 → main 重新构建文档 | 无(新进程拿新文档) |
| 端点发现、后台 shell 环境刷新、kill-switch 导出 | 下一次 fork | 无 |

#### 4.7 Code Puppy 自有的引擎全局配置目录(G4)

**目录**。`<globalRoot>/engine-global`,即 `<appData>/codepuppy-state/env/<env>/engine-global`:与 `codepuppy.jsonc`、技能账本同在当前环境的可变根下,
随环境(prod / beta / dev)分开,在进程围栏的 W2 可写行内(`process-fence-profile.ts:47,155`),不需要新写权限。不用 `<userData>/codepuppy-engine-config/`(P-17)。
**只换配置根**:`start()` 的 `config.directory` 与引擎入口外层的 `Global` 都指向它(R2 第 9 条:`engine-embed.ts:48` 今天用 `Global.node`,
按环境取 `~/.config/opencode` 并 mkdir,`util/src/global.ts:68,79`);引擎的数据根、会话库(`database.path`)、缓存与状态目录都不动(P-05)。

**唯一推导处**。main 的 `engine-paths.ts` 是两个目录的唯一出处,P-16 的六处全部改为调用它:

```ts
/** G4 起交给 start() 的 config.directory,也写进启动文档 paths.engineConfigDirectory。不看 OPENCODE_CONFIG_DIR。 */
export function engineGlobalConfigDirectory(globalRoot: string): string        // join(globalRoot, "engine-global")
/** 独立 OpenCode 的共享全局目录,今天的规则:OPENCODE_CONFIG_DIR > XDG_CONFIG_HOME/opencode > ~/.config/opencode。也写进启动文档 paths.standaloneConfigDirectory。 */
export function standaloneOpenCodeConfigDirectory(env: Record<string, string | undefined>, home: string): string
export const ENGINE_GLOBAL_IMPORTED_FILE = "opencode.json"   // 首次切换导入的配置(与逃生阀写入);引擎先装载
export const ENGINE_GLOBAL_FACTORY_FILE = "opencode.jsonc"   // Code Puppy 出厂层;引擎后装载,设置压过上面那份
export const ENGINE_GLOBAL_IMPORT_RECORD = "codepuppy-import.json"
export const USER_LAYER_LAST_GOOD_FILE = "codepuppy.engine.jsonc" // 与 codepuppy.jsonc 同目录:用户层最后一份引擎能装载的副本
```

启动文档在 G4 加一个必填字段 `paths.standaloneConfigDirectory: string`(绝对路径),`CODEPUPPY_BOOTSTRAP_VERSION` 升到 2
(G1–G3 可能已先出货;各 bundle 的严格解析本来也会拒掉形状不符,升版本让陈旧 bundle 的报错直接点出版本)。

| P-16 的站点 | G4 后调用 |
| --- | --- |
| `engine-paths.ts:34-35`(交给 `start()`)、`mcp-default-deny.ts:55` | `engineGlobalConfigDirectory` |
| `ext-config.ts:96-104`、`ext-fs-installer.ts:34-39`(逃生阀 `CODEPUPPY_LEGACY_INSTALL_ROOT` 的写入目标) | `engineGlobalConfigDirectory`;配置写进 `ENGINE_GLOBAL_IMPORTED_FILE`,永不写出厂层文件 —— 逃生阀仍然写进引擎读的那一层 |
| `engine-config-dangling.ts:178-187`(悬挂清扫的 `foreign` 目标) | `engineGlobalConfigDirectory` 下的 `ENGINE_GLOBAL_IMPORTED_FILE`,仍按 `foreign`(只判不改) |
| `codepuppy-migrate.ts:28-32`(默认关的旧目录迁移) | `standaloneOpenCodeConfigDirectory` |
| `engine-config-truth-boot.ts:47-58`(REQ-059 每次启动抬 `provider`) | 这一半退役:它存在是因为引擎读那个目录,G4 后不读了;`~/.opencode` 那一半不变 |
| (新)首次切换导入的来源、引擎侧的隔离规则 | `standaloneOpenCodeConfigDirectory` |

**目录里有什么,删掉什么**。

| 位置 | 内容 | 谁写、何时 |
| --- | --- | --- |
| `engine-global/opencode.json` | 首次切换导入的配置(下文的允许清单,归一化后的 2.x 形状) | main,首次切换时一次;逃生阀开着时 main 的安装 |
| `engine-global/opencode.jsonc` | 出厂层:模型服务白名单 `policies`、出厂 `/init` `/review`(`commands`)、`skills`(出厂目录 + 已启用技能当前代的目录 + `./.codepuppy/skills`)—— 即今天 `ExplicitLayer` 的三样 | sidecar 注入时原子写;C4 的监听在技能翻代 / 新装 / 停用时重写它 |
| `engine-global/AGENTS.md`、`agent(s)/`、`mode(s)/`、`command(s)/`、`skill(s)/` 及被引用的文件 | 首次切换导入的实体副本(不含软链接) | main,一次 |
| `engine-global/codepuppy-import.json` | 导入记录 | main,与导入内容同一次发布 |
| `<globalRoot>/codepuppy.engine.jsonc` | 用户 `codepuppy.jsonc` 最后一份引擎能装载的逐字副本 | sidecar:启动时与 `codepuppy.jsonc` 每次变化时校验后原子写 |
| `start()` 的 `config.file` | `<globalRoot>/codepuppy.engine.jsonc`;逃生阀置位时不给 | — |

删掉:合成的 `codepuppy-explicit.json`(G4 首次启动删掉旧文件)与 `composeExplicitDocument` —— 用户层不再与出厂层合成一份。
留下:C4 监听两件事 —— 技能输入变了重写出厂层文件;`codepuppy.jsonc` 变了先校验、能装载才更新最后一份可用副本,不能装载就保留上一份并记一行
(R2 第 7 条:用户层里的 `tool.use` 等拒绝策略一旦随坏文件消失,`ManagedPolicy.decision` 缺省放行,`managed-policy.ts:38`、`config/plugin/policy.ts:92-98`;
今天运行中保留上一份,`engine-explicit-config.ts:113-117`)。启动时 `codepuppy.jsonc` 不能装载而副本存在 ⇒ 用副本(比今天启动时只剩出厂层更严,用户的拒绝不丢);副本也没有(第一次 G4 启动时文件就是坏的)⇒ 不给 `config.file`,与今天启动时相同。
副本与 `codepuppy.jsonc` 同目录,`{file:./x}` 与插件相对路径按同一目录解析(`config/variable.ts:42,61-62`)。内联文档 C3 不变。

「能装载」只有一个判法,由 Code Puppy 自有的 `core/src/config/codepuppy-document-check.ts` 给出,组合的是引擎 `parseInfo` 用的同一组上游函数
(JSONC 解析、`ConfigNormalize.normalize`、按 `Info` 解码;`config.ts:136-166`):

```ts
export type EngineDocumentCheck =
  | { status: "loaded"; ignored: string[] }   // ignored = 归一化诊断里被丢弃的字段路径,如 "$.agent.x.tools"
  | { status: "rejected"; reason: "malformed" | "not-an-object" | "normalize-rejected" | "schema-rejected" }
export function checkEngineConfigDocument(text: string): EngineDocumentCheck
```

它是对上游判法的复述,由 I-03 式的上游探针钉住:同一组夹具,探针断言它的结论与真引擎是否装载该文档逐一相同,上游一改即红(K2 偏离的既有处理方式,
同 `ext/src/policy/gate.ts` 对 `Permission.evaluate` 的复述)。sidecar 的副本闸门、main 的配置健康检查、首次切换的导入都用它。

**层序**(P-12;G4 后独立 OpenCode 的内容不在任何一层里):

| 装载序 | 文档 | 设置(后者胜) | 策略(先者胜) |
| --- | --- | --- | --- |
| 1 | managed policies(系统目录 / MDM) | — | 最高 |
| 2–3 | integrated、wellknown | **Code Puppy 下不装载**(下文「隔离」) | — |
| 4a | `engine-global/opencode.json`(导入) | 低于出厂层 | 无(允许清单不含 `policies`) |
| 4b | `engine-global/opencode.jsonc`(出厂层) | 压过导入内容 | **白名单在此,压过 5–8 的一切策略** |
| 4c | `engine-global/` 目录条目(导入的 AGENTS.md、agent、命令、技能) | 同名命令后于 4b —— 所以导入时按解析后的内容剔除与出厂命令同名者 | — |
| 5 | `codepuppy.engine.jsonc`(用户层最后一份可用副本) | 用户命令压过出厂命令(今天合成规则「用户已有的同名命令不覆盖」的同一结果) | 输给 4b |
| 6–7 | 项目文件、项目 `.opencode`(不含独立目录的别名,下文「隔离」) | 项目同名命令压过用户与出厂 | 输给 4b、5 |
| 8 | 内联文档(Code Puppy 的档位载体 agent、provider、权限 deny、实验开关) | 压过以上全部 | 输给前面所有层 |
| 9 | managed settings | 最高 | — |

技能:各层 `skills` 累加,目录条目先收集、文档条目按装载序后收集,同 id 后者胜(P-14,`skill.ts:80-101,152-157`)——
导入的技能输给出厂层(与今天独立全局目录输给出厂层相同);用户层与出厂层同 id 时,今天合成文件把出厂路径排在后面、出厂胜,
G4 后用户层在后、用户胜。这与命令一致,也是 `engine-explicit-config.ts:6-7` 写下的「用户治理 > 出厂 > 上游内置」;只在两边有同 id 技能时才看得出。

**隔离:独立 OpenCode 的内容从哪几条路都进不来**(数据目录与会话库按既定决定仍共享)。

| 路径 | 今天 | G4 的规则 | 机制 |
| --- | --- | --- | --- |
| 全局层 | 独立目录就是全局层;其策略压得过白名单(P-13) | 换根,不再装载 | `config.directory` 与外层 `Global` 指向自有目录 |
| 项目发现里的别名 | 独立目录是全局根,项目发现排除它(`config/discovery.ts:121-125`) | 换根后它不再是全局根;某个项目的 `.opencode` 链到它、或会话就开在它里面时,会作为项目层装载插件、覆盖出厂命令(R2 第 2 条)⇒ **项目发现照旧排除独立目录的 canonical 身份及其配置文件别名**,会话开在它里面时不做项目上溯,与今天对全局根的处理逐字相同 | 接管 `core/src/config/discovery.ts`:在既有「Global sources must not re-enter through the project walk」判定里,把 `tryCodePuppyBootstrap()?.paths.standaloneConfigDirectory` 解析后并入被排除的根与文件;无文档宿主行为同上游 |
| 共享库里的登录带来的远程配置 | 独立 CLI 登录写进共享库的 well-known 来源与 Console 连接,Code Puppy 照样装载其缓存配置,策略早于出厂层(`wellknown.ts:139,209`,`config.ts:336-362`;Console 文档经 `plugin/provider/opencode.ts:274`)| **Code Puppy 下不装载 integrated 与 wellknown 配置文档**:Code Puppy 不连 Console、也不用 well-known 来源(ADR-047 决策 4),这两类文档只能来自共享库里别人的登录 | 接管 `core/src/config.ts`:`load` 里有 Code Puppy 启动文档时 `integrated` 与 `wellknownDocuments` 为空;凭据与 KV 留在共享库里不动 |
| 首次导入 | — | 允许清单、按解析后的内容判、不跟软链接出来源、引用按读方基准迁移(下文) | main 的导入 |

两处接管都只加 `codepuppy(...)` 标注块、逻辑在 Code Puppy 自有文件 `core/src/config/codepuppy-isolation.ts`;按 ADR-047「精确接管面」登记(范围、守卫、回滚、归属),
权威登记册加一条「Code Puppy 引擎的配置层里没有独立 OpenCode 的内容」,带反向臂测试(§9 证明义务 1)。两文件 90 天改动:`discovery.ts` 6 / 168、`config.ts` 32 / 529
(`git log --since="90 days ago" 33f94fce96`);`config.ts` 较热,所以只在 `load` 返回前加一处过滤,不改它的结构。
被否决:用移除指令关掉 Console 插件 —— `opencode.provider.opencode` 在守护名单里,移除指令跳过它(`plugin/internal.ts:304-306`);
只接管 `wellknown.ts` —— 覆盖不到 Console 文档,而 Console 文档的唯一写入点 `opencode.ts` 90 天改动 53 次,更热。

**首次切换:复制一份,不问用户**(owner「需要搬一份到 Code Puppy 自己的目录」「将缺点收缩到最小」)。

- 时机:main 启动早期、第一次 fork 之前,与 REQ-059 的启动对账同一处;只在 `engine-global/codepuppy-import.json` 不存在时执行。来源目录不存在也发布一份
  `imported` 为空的记录,之后不再扫描。
- **配置:允许清单,判的是引擎归一化之后的文档**(R2 第 1 条:原始键黑名单漏掉 `enabled_providers`、`plugin`、`provider` 这类旧键,
  引擎会把它们重新生成策略、插件与模型服务,`config/normalize.ts:168-176,185-190,405-415`)。来源的 `opencode.json`、`opencode.jsonc` 各自先过
  `checkEngineConfigDocument` 的同一组函数得到 2.x 规范文档(不做 `{env:}` / `{file:}` 替换),再只取允许清单里的键:

  | 导入的键 | 附加规则 |
  | --- | --- |
  | `agents` | 去掉 `codepuppy-*` id(会把字段并进 Code Puppy 的档位载体) |
  | `commands` | 去掉与出厂层同名的(今天 `init`、`review`,`codepuppy-prompts.ts:301-308`;今天它们本就输给出厂层,从未生效) |
  | `instructions`、`skills` | 引用按下表迁移 |
  | `permissions`、`formatter`、`lsp`、`watcher`、`shell` | 原样 |

  其余一切规范键(`policies`、`providers`、`mcp`、`plugins`、`model`、`default_agent`、`experimental`、`enterprise`、`websearch`、`compaction`、`references`……)
  与归一化诊断里被丢弃的字段都不导入,逐条写进记录。允许清单里的键今天就在全局层生效,导入后仍在全局层、仍低于出厂层与内联文档,压不过 Code Puppy 的任何决定;
  清单外的键哪怕今天无害也不带 —— 未知即不导入。两份都在时,`opencode.jsonc` 的同名键覆盖 `opencode.json`,`agents` / `commands` 按名字合并,
  `instructions` / `skills` / `permissions` 前后拼接(与引擎按文档顺序收集的结果相同)。写成 `engine-global/opencode.json`。
- **文件:按解析后的内容判,只产出实体副本**(R2 第 4 条:引擎扫描命令与 agent 时跟随软链接,`command.ts:143`、`agent.ts:137`;
  链进来的目录里一个 `init.md` 就能在出厂层之后覆盖 `/init`)。复制的只有引擎会从配置根读的东西:`AGENTS.md`、`agent(s)/`、`mode(s)/`、`command(s)/`、`skill(s)/`,
  以及允许清单里的引用指到的来源目录内文件。逐项先解析真实路径:
  - 解析后落在来源目录内 ⇒ 复制为实体文件 / 目录(不保留软链接);
  - 解析后落在来源目录外、或成环、或解析不了 ⇒ 不复制,写进记录(`link-outside-source` / `unresolvable`);
  - 剔除规则作用在解析后的结果上:解析后的命令名等于出厂命令名、agent id 是 `codepuppy-*`、目录是 `plugin(s)/`、`tool(s)/`、`node_modules/` 或依赖文件,一律不复制;
  - 其余文件(插件、工具、依赖、主题等)不复制,写进记录。
- **引用:按各读方真正的基准迁移**(R2 第 5 条):

  | 引用 | 引擎按什么解析 | 导入怎么处理 |
  | --- | --- | --- |
  | 允许键里的 `{file:…}` | 所在文档的目录(`config/variable.ts:42,61-62`) | 相对且在来源内 ⇒ 文本不动,被引文件随镜像复制;相对但逃出来源 ⇒ 改成原目标的绝对路径;绝对且在来源内 ⇒ 改指 `engine-global/` 里的副本;绝对且在来源外 ⇒ 不动 |
  | `instructions` 条目 | 相对:从会话位置向上找到项目根(Code Puppy 开着项目发现,`instruction.ts:96-114`);绝对 / `~/`:字面 | 相对 ⇒ 不动(含义不变);绝对且在来源内 ⇒ 改指副本;在来源外 ⇒ 不动 |
  | `skills` 条目 | 相对:按会话位置(`skill.ts:96-101`);`~/` 展开;绝对:字面 | 同上 |
  | `AGENTS.md` | 配置根 | 复制 |

  迁移后不再有任何引用指向独立目录;指向别处的绝对引用照旧读那里(那不是独立 OpenCode 的配置)。
- **整批发布**(R2 第 6 条):完整结果先建在同级的 `engine-global.import-staging/`;若 `engine-global/` 已存在(前一次导入失败后引擎照常跑过),
  把其中除出厂层文件以外的现有内容先并入暂存,同路径以现有为准(那是切换之后用户或逃生阀写的);记录作为暂存里最后写的文件;然后
  `engine-global` → `engine-global.prev`、暂存 → `engine-global` 两次改名,成功后删 `prev`。第二次改名失败 ⇒ 把 `prev` 改回。
  启动时见 `engine-global` 不在而 `engine-global.prev` 在 ⇒ 先改回再继续;见残留暂存 ⇒ 删掉重来。任何时刻引擎看到的要么是导入前的目录、要么是完整导入后的目录,
  不会出现一半;重试不覆盖用户在切换后写的内容。来源目录只读,一个字节不改。
- 记录(只写名字与路径,不写内容):

  ```ts
  type OpenCodeImportRecord = {
    version: 1
    importedAt: string                 // ISO-8601 UTC
    source: string                     // 来源目录的绝对路径
    imported: string[]                 // 相对来源目录;配置键写作 "opencode.json#agents"
    skipped: Array<{
      path: string                     // 相对来源目录;配置键或被丢弃字段写作 "opencode.jsonc#providers"、"opencode.json#$.agent.x.tools"
      reason: "not-allowed" | "code" | "code-puppy-name" | "link-outside-source" | "unresolvable" | "normalize-dropped"
    }>
    rewritten: Array<{ from: string; to: string }>   // 改写过的引用
  }
  ```

- 用户看到什么:什么都不用做,界面上没有新东西。第一次启动后,他在独立 OpenCode 里写的全局指令、自定义 agent、命令、技能、权限规则、格式化与语言服务设置
  照样在 Code Puppy 里生效。不在允许清单里的内容(插件、MCP、模型服务、策略、默认模型、实验开关、网页搜索、压缩等设置)与指向来源目录之外的软链接不带过来,
  逐条写进记录与一行日志。之后在 `~/.config/opencode` 里的改动不再影响 Code Puppy —— owner 已接受「以后想两边都生效的设置，要写两遍」。

**其它随之而定的**。
- `OPENCODE_CONFIG_DIR` 不再改变 Code Puppy 引擎的配置目录(只决定导入从哪里读、隔离排除哪个目录):否则一个导出就能让引擎丢掉出厂层与白名单。
- 首页「配置文件有语法错误」横幅(`config-broken-banner.tsx:12-17`,数据来自 `ext-config.ts:1509-1525` 的 `configHealth`)今天用 v1 键表判断独立 OpenCode 的共享文件
  (`ext-config.ts:106-113`;合法的 `policies`、`agents` 会被报成整份忽略,根为 `[]` 却判健康,`ext-config.ts:1499,1525`)。G4 后它查 `codepuppy.jsonc`
  (逃生阀置位时查 `ENGINE_GLOBAL_IMPORTED_FILE`),判法换成 `checkEngineConfigDocument`:`rejected` 才显示横幅,原因文字改为
  「配置文件有错误,修好之前沿用上一次能用的版本」(与副本行为一致);`ignored` 的字段只进日志,不显示横幅。按钮不变。
- 启动文档 v2:多 `paths.standaloneConfigDirectory`;`paths.engineConfigDirectory` 的值换成新目录。

## 5. 数据与失败

- 写边界:构建器只读;启动文档不落盘,没有事务、幂等或重试问题。C3–C6 的写入点与失败处理不变,#613 的注入失败上报不变
  (失败分支的治理底线读已校验过的文档)。
- 可达的失败窗口:

  | 窗口 | 怎么到达 | 结果 |
  | --- | --- | --- |
  | 构建器抛 | 代码缺陷或资源根 `realpath` 失败(今天同样) | `spawnLocalServer` 抛 ⇒ 与密钥同步失败同一条拒 fork 路,这一代 failed |
  | 构建器拒掉一个 URL | 用户 / 开发者导出或固定了带 userinfo、查询串、片段或非 https 的地址 | 字段省略,main 记一行(只写变量名);这一代没有平台模型服务或云 MCP;下次 fork 照样 |
  | sidecar 解析失败 | main / sidecar 来自不同构建,或构建器有缺陷 | error IPC + exit(1) ⇒ main 宣告这一代 failed,原因带字段路径 |
  | 引擎 bundle 认不得文档 | 本机开发时 `dist-engine` 陈旧(迁移前或另一提交构建) | §4.2 第 4 步抛 ⇒ 这一代 failed,不报 ready |
  | ext 认不得文档 | 本机开发时 ext bundle 陈旧 | `setup` 抛 ⇒ 插件 failed ⇒ I4 拒报 ready |

  打包构建一次产出 main、sidecar、ext 与引擎;后三行只在本机开发时可达,且都在报 ready 之前失败。
- 不新增防御状态:不做跨版本兼容读法(四方同包出货),不做文档热更新。兼容入口只服务无文档宿主,不是 sidecar 里的退路。
- G4 的写边界与失败窗口:

  | 窗口 | 怎么到达 | 结果 |
  | --- | --- | --- |
  | 导入中途失败(磁盘满、权限、来源里读不了的文件) | 首次切换那次启动 | 暂存未发布 ⇒ 删暂存、不写记录、记一行原因;引擎照常启动,看到的是导入前的目录;下次启动重来。来源不动 |
  | 两次改名之间进程被杀 | 同上 | 下次启动见 `engine-global` 不在而 `engine-global.prev` 在 ⇒ 改回再重来;记录随整批发布,不会出现「内容在、记录缺」或反过来 |
  | 出厂层文件写失败 | sidecar 注入时 | 与今天合成文件写失败同一条路:#613 注入失败上报;引擎起来但没有白名单与出厂命令 ⇒ 这一代按 `injection-failed` 发布 |
  | 用户改坏 `codepuppy.jsonc` | 手改 | `checkEngineConfigDocument` 判 `rejected` ⇒ 不更新 `codepuppy.engine.jsonc`,引擎继续用上一份可用的用户层(含其中的拒绝策略);首页横幅报错;修好后下一次变化即更新 |
  | 来源目录里的软链接指出来源、成环或解析不了 | 用户布局 | 不复制,写进记录;指在来源内的复制为实体副本 |

## 6. 架构落点

| 新增/改动的代码 | 落在哪个模块 | 依赖谁 | 复用的已有权威 |
| --- | --- | --- | --- |
| 启动文档类型、解析、发布、读取、无凭据 URL 判定、引擎侧兼容入口 | `packages/util` 的 Code Puppy 自有文件(新) | 只依赖 `node:path` | 进程内交接形状 `in-process-engine.ts:15-24`;跨进程窄合同「build/parse 成对、parse 失败即拒」`codepuppy-sidecar-messages.ts:4` |
| 引擎能力导出 `assertCodePuppyBootstrap` | `ui-mac/engine/engine-embed.ts`(Code Puppy 自有的引擎入口) | → util | — |
| 构建器与启动命令 | ui-mac 主进程,`spawnLocalServer` 一处 | main → util | 冻结环境快照、`engine-paths.ts`、`resolveExtPluginPath`、`materializeCloudMcpConfig`、`secretFileRef`、`engineDesktopToggles` |
| 解析、发布与启动关口;注入、显式层监听的输入 | ui-mac sidecar | sidecar → util | `injectCodePuppyConfig`、`watchExplicitSources` 原样留在 sidecar |
| ext 的读取 | `packages/ext` | ext → util(相对路径,P-04 先例) | — |
| 引擎侧读取 | core / plugin 的自有文件与已接管文件的既有 `codepuppy(...)` 块 | → util(已有依赖) | ADR-038 / ADR-043 已登记的握法 |
| `engineNetFailurePath` 的标记改为参数 | `packages/schema` 的自有文件,仍是纯函数 | 不新增依赖 | — |
| 出厂禁用技能名单 | `packages/ext/src/factory-deny.ts` 持有常量,main 的 `codepuppy-builtin-policy.ts` import 它 | main → ext(`factory-paths.ts` 等先例,`codepuppy-config-injection.ts:47-52`) | — |
| G4:两个目录的唯一推导 | ui-mac 主进程 `engine-paths.ts`(已有) | — | 今天的推导规则原样搬进 `standaloneOpenCodeConfigDirectory` |
| G4:首次切换导入 | ui-mac 主进程,启动早期与 REQ-059 对账同一处 | main → `engine-paths.ts` | 原子写法沿用 `writeSecretFileAtomic` / `ext-atomic-fs.ts` 的先写后改名形状 |
| G4:出厂层文件的写入与技能变化时的重写 | ui-mac sidecar,取代 `engine-explicit-config.ts` 的合成 | sidecar → util | `explicitSkillDirs`、`applyPromptTakeover`、`engineModelConfig` 原样 |
| G4:用户层最后一份可用副本 | ui-mac sidecar,同一个监听 | sidecar → core 自有文件 | `checkEngineConfigDocument` |
| G4:「能装载」的唯一判法 `checkEngineConfigDocument` | `packages/core/src/config/codepuppy-document-check.ts`(Code Puppy 自有,新) | 只组合 core 已导出的 JSONC 解析、`ConfigNormalize`、`Info` | 引擎 `parseInfo` 的同一组函数(`config.ts:136-166`),由上游探针钉住 |
| G4:隔离判定 | `packages/core/src/config/codepuppy-isolation.ts`(Code Puppy 自有,新);接管 `core/src/config/discovery.ts` 与 `core/src/config.ts` 各一处 `codepuppy(...)` 块 | → util(`tryCodePuppyBootstrap`) | 上游「全局根不经项目上溯重入」的同一判定(`discovery.ts:121-125`) |
| G4:引擎入口外层 `Global` 用同一配置根 | `ui-mac/engine/engine-embed.ts`(Code Puppy 自有) | — | `Global.layerWith`(`util/src/global.ts:84`) |

- **新模块**:本仓没有 `docs/architecture/modules.md`,落点理由记在这里:进程级发布 / 读取按 `packages/schema/AGENTS.md:8` 不能进 schema;
  util 是 main、sidecar、引擎 bundle、core、plugin 都已能 import、不加依赖边、也没有包规则限制的最低层(P-04),ext 用相对路径。
  只依赖 `node:path`,不改变 ext bundle 体积,也不往 sidecar 的 import 闭包里带写盘点(`process-fence-write-sites.test.ts` 管的那个闭包)。由治理补图。
- **收敛(K2,较现在更好)**:同一事实今天的重复判定随键一起消失 ——
  ① 环境变量名在三个包各写一份(`cloud-web-search.ts:40-129`、`cloud-websearch-kill.ts:134-140,383`、`alpha-cloud-authority.ts:8-9`;
  `cloud-websearch-kill.ts:136-138` 注释自认「彼此之间没有可共用的 alpha 依赖边」);
  ② kill-switch 判三处(`server.ts:336`、注入 `:222`、ext `signalled()`);
  ③ 真源逃生阀 main 与 sidecar 各读一遍(#606 那一类);
  ④ 文件监听开关两种判法(`engine-server-options.ts:68` 对 `codepuppy-project-watch.ts:18`)—— sidecar 里只剩一个;今天的第二种判法只作为
  无文档宿主的兼容判法留在兼容入口里,一处;
  ⑤ 同一代的全局配置目录 main 算一次、sidecar 再算一次(`server.ts:668` 对 `mcp-default-deny.ts:55`);
  ⑥ G4:同一条目录规则在 main 里写了六遍(P-16)—— 收成 `engine-paths.ts` 两个函数,并把「引擎读的目录」与「独立 OpenCode 的目录」分开。
  main 自己内部仍以 `process.env` 串接的部分(`applyAuthEnv` → 密钥同步、main 多处读逃生阀)不在本设计改动之列。
- **架构约束**:K2 较现在更好;K1 不变。包规则:schema 只留纯函数(`engineNetFailurePath` 改成显式参数正是为此),发布 / 读取在 util。
  北极星:新增的是自有文件,不是接管;上游路径里的改动限于既有 `codepuppy(...)` 块(§4.3)。
  G4 例外:新增两处接管(`core/src/config/discovery.ts`、`core/src/config.ts`,各一处 `codepuppy(...)` 块,理由与守卫见 §4.7「隔离」),
  进 `UPSTREAM_EXCLUDES` 与 ADR-047「精确接管面」;`checkEngineConfigDocument` 是对上游 `parseInfo` 判法的复述,作为 K2 已知偏离记进 `constraints.md`,
  守法同 `ext/src/policy/gate.ts`:上游探针逐例对真引擎钉住。
  ADR-048:登记册里机制文字引用了环境变量的四条(P-10)在迁移对应键组的那个提交里改写握法与测试名,决定本身不变,不退役任何条目。
- **工程标准**:①用户可调的开关只在构建器一处读(无文档宿主的两项在兼容入口一处读),出厂禁用名单是常量不是配置;②一个值一个主人(上条);
  ⑤坏文档以具名错误 `CodePuppyBootstrapError` 失败,构建器与解析器的日志只写字段路径或变量名,不写值。
- **安全面**:威胁边界是「sidecar 环境被第三方子进程整份继承」与「进程内插件共用 `globalThis`」。不变量:
  S1 启动文档里没有任何密钥值:两处引用字段只容得下 `{file:}` 引用,两个 URL 字段只容得下无凭据 URL(无 userinfo、无查询串、无片段),其余字段没有能装凭据的形状;
  S2 启动文档不进环境,子进程拿不到;S3 每个进程只发布一次、深冻结、读方不改;S4 引擎口令只在 `StartCommand`;
  S5 sidecar 环境里没有 `CODEPUPPY_*`(EXTRA 也放不回)。
  G4 另加三条:S6 独立 OpenCode 的内容不在引擎的任何配置层里 —— 全局层换根、项目发现排除它的别名、共享库里别人登录带来的 integrated / wellknown 文档不装载;
  它的策略、命令、插件都碰不到 Code Puppy(P-13 测到今天的洞);
  S7 首次导入只带允许清单里的规范键,判在引擎归一化之后,未知即不带;文件按解析后的真实路径判,不跟软链接出来源,出厂命令名与 `codepuppy-*` 名字按解析后的内容剔除;
  S8 用户层的拒绝策略不会因为一次改坏而消失(最后一份可用副本)。
  进程内的第三方代码本就能做任何事,这不是对它的隔离(与今天相同);它去掉的是「改一个环境变量就能翻掉 ext 的判决」这条随手可走的路。
- **被否决的替代**:
  1. 写一个启动文档文件、环境变量里只放路径 —— 子进程照样能顺着路径读到,每代还多一次写盘与清理,比 IPC 多出东西而没有好处。
  2. 保留环境变量、只加一个有类型的读取模块 —— 子进程继承、进程内可改、白名单与读方脱节(P-06 那五个)三件事都还在。
  3. 把整段注入搬到 main、只传算好的配置 —— 改变 #613 注入失败的上报路径和指令文件的写入方,I-07 的结果用不到。
  4. 可变的启动文档加变更事件 —— 与 C4 / C8 / C11 并行的第二条运行中通道,§4.6 没有任何一项需要它。
  5. 用 zod / Effect Schema 校验 —— 给 ext bundle 与 sidecar 闭包加依赖;仓内跨进程窄合同的先例是手写严格解析。
  6. 让上游 `config.file` 收数组以删掉合成 —— 是向上游提挂点的事(I-05 的范围),I-07 不需要。
  7. 把模块放 schema(初稿)—— 违反 `packages/schema/AGENTS.md:8`(R1 架构提示)。放 core —— plugin 包与 ui-mac 主进程的 import 方向更绕,util 更低且已被各方依赖。
  8. 只比对版本号来认引擎 bundle —— 两个不同提交的 bundle 可以同为 v1 而形状不同;改为让每个 bundle 用自己的解析器读一次。
  9. 按参数名猜查询串里哪个是凭据 —— 名字是开放集合;整段禁掉查询串与片段更简单,本仓的地址本来就没有。
  10. G4 首次切换「弹一次提示 + 一键导入」—— 多一个用户步骤与一个新概念,用户点掉或没看到就正是要避免的「行为悄悄没了」;静默复制什么都不用学,结果一样。
  11. G4 把导入内容并进用户的 `codepuppy.jsonc` —— 导入的同名命令会从低于出厂层升到高于出厂层(层 5),还把独立 OpenCode 的内容混进 main 天天改写的真源文件。
  12. G4 让 main 在每次写技能账本时直接重写出厂层、删掉监听 —— 要穷举 `skills-enabled.json` 与 `current.json` 的每个写方,漏一个就悄悄过期;监听不管写方是谁。
  13. G4 继续读独立目录、只是把出厂层放进全局层 —— 两份全局目录引擎只认一个,读独立目录就放不进出厂层;这正是 owner 选「搬一份」的原因。
  14. G4 把全局目录设在 `<userData>/codepuppy-engine-config/` —— 见 P-17。
  15. G4 导入用原始键黑名单(R2 前的写法)—— 旧键经归一化会变回策略、插件与模型服务(P-19);改为归一化后的允许清单。
  16. G4 把软链接原样复制(R2 前的写法)—— 引擎扫描跟随软链接(P-22),出厂命令名的剔除就被绕过;改为解析后复制实体。
  17. G4 让 `config.file` 直接指用户的 `codepuppy.jsonc`(R2 前的写法)—— 一次改坏就撤掉用户的拒绝策略(P-24);改为同目录的最后一份可用副本,不与出厂层合成。
  18. G4 只接管 `wellknown.ts`、或用移除指令关 Console 插件 —— 见 §4.7「隔离」。

## 8. 拆分决定

不适用:只涉及 alpha-code 一个仓、一个负责方。开工依赖:#1662 换代合入 `alpha`(本设计所对的代码只在 `engine/1662-opencode2` 上)。
集成关系:I-05 先行,可能改到 `core/src/permission.ts` 的其它 `codepuppy(...)` 块,与本设计改的审批期限块不重叠;I-06 消费 §4.1 的形状。

## 9. 回滚

- 只改代码,启动文档不落盘;回滚 = revert,环境变量与启动命令字段原样回来,没有数据后果。C3–C6 的磁盘形状两边一致。
- **迁移切片**(兼容性决定,不是任务拆分;plan.md 只能合并键组,不能拆开一个键组):
  - 规则:**按键组切,每个键组是一个提交边界**。一个键组的提交同时完成:类型与解析器加上这一组字段、构建器写它们、这一组的**全部**读方改读文档、
    这一组在环境 / 白名单 / `StartCommand` / 进程内总线里的写法删除、登记册对应条目改写握法。任何提交里同一个键只在一个通道里;
    文档在任一提交里只包含已迁完的键组,不存在「文档里有、环境里也还在」的提交。
  - G1 —— 接通与路径:util 模块、构建器、`StartCommand.bootstrap`、sidecar 的解析 / 发布与 §4.2 的启动关口(含引擎能力导出与 ext 的第一步读);
    `StartCommand` 的六个决定字段与 `paths.globalRoot` / `userConfig` / `extBundledManifest` / `officeMcpManifest`;
    `createSidecarEnv` 的 `CODEPUPPY_` 前缀拒绝从这一组起生效(排在 EXTRA 之前),例外名单只有 `CODEPUPPY_ENV_ALLOWLIST_EXTRA` 与尚未迁走的键组的键,
    之后每组提交把自己的键从例外里删掉。
  - G2 —— 平台、云与网络:`platform.*`、`cloudMcp`(删 C7)、`webSearch`、`policy.account`、`network.egressProxy`(`engineNetFailurePath` 改参数);无凭据 URL 判定。
  - G3 —— 开关与引擎设置:`switches.*`、`engine.*`、`permission.askTimeoutMs`、`skills.factoryDirs`、出厂禁用名单改常量、`codepuppyEngineSettings` 兼容入口;
    G3 之后例外名单只剩 `CODEPUPPY_ENV_ALLOWLIST_EXTRA`,§4.5 的环境规则检查以最终形态落在这一组。
  - 三组在同一个 PR 里进 `alpha`;中间提交不单独出货。中间提交之间混用 bundle 会因形状不同在第一次读时失败(§4.1)。
- **G4 —— Code Puppy 自有的引擎全局配置目录**(owner 2026-11-12 决定,§4.7):排在最后,单独一个 PR,可以单独回滚。依赖 G1–G3 已在 `alpha`
  (启动文档的 `paths.engineConfigDirectory` 与 `paths.userConfig` 是它的输入);启动文档升到 v2,多 `paths.standaloneConfigDirectory`。
  一个提交边界里同时完成:`engine-paths.ts` 的两个函数与六处改调、引擎入口外层 `Global` 换根、两处隔离接管与登记、导入与记录、出厂层文件取代合成文件、
  用户层最后一份可用副本、`checkEngineConfigDocument` 及其上游探针、REQ-059 的独立目录那一半退役、配置健康检查改目标与判法、
  I-03 探针 P3 / P5 的锚点从 `engine-explicit-config.ts` 移到新的出厂层写入处。
- **G4 回滚**:revert 这个 PR ⇒ 引擎的 `config.directory` 回到独立 OpenCode 的共享目录,合成显式文件与完整监听回来(下一次启动重新生成),两处接管撤回。
  数据后果:导入从来只复制、不动来源,所以回滚后看到的就是切换前的那份共享目录,外加用户在切换期间写进去的东西;
  `engine-global/` 与 `codepuppy.engine.jsonc` 原样留在磁盘上,回滚后的代码不读也不删它们,导入的内容与记录都不丢。再次应用 G4 时记录在,不会重复导入,
  用户在 `engine-global/` 里的改动照样在。切换期间只写进 `engine-global/` 的改动在回滚后不生效(它们本来就只属于 Code Puppy 的目录)。
  共享库里的 well-known 来源与 Console 连接从未被动过,回滚后照今天的方式装载。
- **G4 的证明义务**(plan.md 落成会失败的测试;全部在 I-08 预载下跑,P-18):
  1. 独立内容碰不到 Code Puppy(真引擎、临时 HOME / XDG):独立目录夹具里放 `policies` 放行 `*`、旧键 `enabled_providers` 与 `plugin`、`commands.init`、`plugin/` 目录与
     `command/init.md`;另造一个项目,其 `.opencode` 是指向夹具的软链接;共享库里写一条 well-known 来源及其缓存配置(放行 `*`)。以 G4 启动 ⇒ 白名单外的模型服务不可用、
     `/init` 是出厂模板、夹具插件没有装载,在那个项目里也一样。反向臂各一条:`config.directory` 指回夹具 ⇒ 白名单外的服务变可用(P-13);撤掉项目发现的排除 ⇒
     项目里 `/init` 变成夹具的;撤掉 integrated / wellknown 过滤 ⇒ 白名单外的服务变可用。
  2. 导入只带允许清单、只认解析后的内容:夹具的 `providers` / `provider` / `enabled_providers` / `plugin` / `plugins` / `policies` 与清单外的键不进 `engine-global/opencode.json`,
     逐条进记录;夹具里一个指向来源内另一目录的 `commands` 软链接,其中的 `init.md` 不被复制;指向来源外的软链接不被复制并记为 `link-outside-source`。
     反向臂:改用原始键黑名单 ⇒ 导入后白名单外的服务可用;改为保留软链接 ⇒ `/init` 被覆盖。
  3. 导入的内容可用:夹具含 `AGENTS.md`、agent、命令、技能、相对 / 来源内绝对的 `instructions` 与 `skills` 条目、`{file:./x}` 与 `{file:../y}` 引用 ⇒ 导入后真引擎的
     agent / 命令 / 技能 / 指令列表里都有,且没有任何文件读取落在来源目录内(来源设为只读并在导入后改名,引擎照常)。反向臂:去掉复制步骤 ⇒ 红。
  4. 整批发布:在发布第 N 步注入失败 ⇒ 引擎看到的是导入前的目录、没有记录,下一次启动完整导入;两次改名之间中断 ⇒ 下一次启动改回并完成;
     切换后用户在 `engine-global/` 写的文件在重试中保留。
  5. 用户层不因改坏而失效:`codepuppy.jsonc` 含一条 `tool.use` 拒绝,运行中写坏 ⇒ 该工具仍被拒、横幅显示;修好 ⇒ 副本更新。反向臂:副本闸门放行坏文档 ⇒ 工具变可用。
     启动时文件已坏而副本在 ⇒ 用副本。
  6. 健康检查与 `checkEngineConfigDocument` 同判:合法的 `policies`、`agents` 不报横幅;根为 `[]` 报横幅;上游探针在同一组夹具上把它的结论与真引擎是否装载逐一对齐。
  7. 不读、不建独立目录:导入来源与引擎配置目录都解析在预载的临时根之内;以 G4 启动后,独立目录若原本不存在则仍不存在(外层 `Global` 不再 mkdir 它);
     反向臂:撤掉预载对 HOME 的改写 ⇒ 守卫红。
  8. 只复制一次、来源不动:第二次启动不导入;来源目录导入前后逐字节相同。
  9. 逃生阀 `CODEPUPPY_LEGACY_INSTALL_ROOT` 的安装写进 `ENGINE_GLOBAL_IMPORTED_FILE`,从不写出厂层文件;出厂层重写不会抹掉它。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| R1 启动文档 = `StartCommand.bootstrap`,只在内存里,不进环境、不落盘 | C2 已是有类型、带密钥也不进子进程的通道(`sidecar.ts:76-103`);P-01、P-03 |
| R2 位置:`packages/util/src/codepuppy-bootstrap.ts`,Code Puppy 自有文件(R1 后改,原为 schema) | P-04;R1 架构提示 |
| R3 一个 sidecar 进程内不变;运行中的变化只走 C4 / C6 / C8 / C9 / C11 | P-07、§4.6 |
| R4 sidecar 环境里没有 `CODEPUPPY_*`;前缀拒绝排在 EXTRA 之前;由测试机判(R1 后补「排在 EXTRA 之前」) | C1、P-01、P-06;R1 第 4 条 |
| R5 密钥只走 C6;两处引用字段只容得下 `{file:}`,两个 URL 字段只容得下无凭据 URL;不合格的 URL 在构建时省略;口令只在 `StartCommand`(R1 后补 URL 规则) | `codepuppy-secret-files.ts:1-23`、`sidecar.ts:243`、`codepuppy-auth.ts:365`、`cloud-sidecar-config.ts:33`;R1 第 2 条 |
| R6 P-06 那五个今天到不了 sidecar 的开关并入文档 —— 运维导出它们时开始按 ADR 写的那样生效(owner 可见,见下) | P-06 [测];ADR-038 期限覆盖、ADR-024 §5 继承逃生门(`codepuppy-config-injection.ts:166`)的既有文字;`CODEPUPPY_ECOSYSTEM_INHERIT` 今天 main / sidecar 两边不一致 |
| R7 出厂禁用名单改成 ext 持有的常量,main import 它;不再走任何通道 | `codepuppy-builtin-policy.ts:44-49`(恒为常量);工程标准 1;顺带去掉 env 缺席时放开的分支(`factory-deny.ts:62-70`) |
| R8 云 MCP 定义在 main 算(同一个 `materializeCloudMcpConfig`),文档里一份,sidecar 注入、ext、plugin 都读它;是否代付仍由注入按密钥文件在场性判 | `cloud-sidecar-config.ts`;`codepuppy-config-injection.ts:219,541-579` |
| R9 sidecar 里文件监听开关只有一个判法:沿用 main 的 `engineDesktopToggles`;今天 core 的判法只留在无文档宿主的兼容入口里 | P-08 [测];只在导出 `yes` / `on` 时两者今天不一致 |
| R10 每个 bundle 第一次读时用自己的解析器校验已发布的文档;sidecar 启动关口要求引擎 bundle 导出 `assertCodePuppyBootstrap` 并通过,ext 在 `setup` 第一步通过,否则不报 ready(R1 后改,原为「各读方比版本」) | P-11;R1 第 1 条 |
| R11 做 Code Puppy 自有的引擎全局配置目录,作为最后一片 G4,单独可回滚(owner 2026-11-12 决定后改,原为「待 owner 决定」) | 批准记录;§4.7、§9 |
| R12 交付物放 `docs/specs/upgrade-bootstrap-config/design.md`(R1 后从 `upstream-upgrade-readiness/design-i07.md` 移来,满足文档合同的固定文件名) | 编排器 2026-11-12 指示;`check_docs_contract.py` `specs.extra-file` |
| R13 无文档宿主:兼容入口 `codepuppyEngineSettings` 只覆盖审批期限与项目文件监听两项,判法逐字是今天的;其余引擎侧读方无文档即缺席;ext 无无文档模式;WSL 宿主不在范围(R1 后新增) | P-09;R1 第 3 条 |
| R14 子测试进程在 import ext 前用生产解析器发布自己的文档(R1 后新增) | P-09 第 3 项;`plugin-reload-wiring.cases.ts:31` 先例 |
| R15 迁移按键组 G1–G3 切,每组一个提交边界,文档只含已迁完的键组,无共存(R1 后改,原为「先接通、后搬键」两片) | R1 第 4 条;§9 |
| R16 空串按键保留今天的含义:`OPENCODE_DISABLE_MODELS_FETCH=""` 拉取开、`OPENCODE_EXPERIMENTAL_FILEWATCHER=""` 监听关、`CODEPUPPY_DEFAULT_MODEL=""` 不设默认模型;其余键空串同未设(R1 后改,原为「空串当缺席」) | P-08 [测];`codepuppy-models.ts:274,278`;R1 第 5 条 |
| R17 目录 = `<globalRoot>/engine-global`;`start()` 的 `config.directory` 与引擎入口外层 `Global` 都用它;只换配置根,数据根与会话库不动;`OPENCODE_CONFIG_DIR` 不再改变它(R2 后补外层 `Global`) | P-05、P-17、P-26;W2(`process-fence-profile.ts:47,155`);R2 第 9 条 |
| R18 `engine-paths.ts` 是唯一推导处:`engineGlobalConfigDirectory` 与 `standaloneOpenCodeConfigDirectory`,六处按 §4.7 的表改调 | P-16 |
| R19 出厂层(白名单 `policies`、出厂命令、`skills`)写进 `engine-global/opencode.jsonc`;合成文件删除;`config.file` 给与 `codepuppy.jsonc` 同目录的最后一份可用副本 `codepuppy.engine.jsonc`,监听校验后才更新;同 id 技能改为用户层胜(R2 后改,原为直接给 `codepuppy.jsonc`) | P-12、P-14、P-15、P-24;I-03 探针 P3 / P5;R2 第 7 条 |
| R20 首次切换由 main 静默复制一份(镜像目录、过滤配置键、记录与日志),不弹提示、不要用户操作 | owner「需要搬一份」「将缺点收缩到最小」;开发原则 1「每增加一个步骤……必须考虑是否有价值」;被否决替代 10 |
| R21 导入是允许清单(`agents` 去 `codepuppy-*`、`commands` 去出厂名、`instructions`、`skills`、`permissions`、`formatter`、`lsp`、`watcher`、`shell`),判在引擎归一化之后;清单外与被丢弃的字段一律不带并逐条记下;文件只复制解析后落在来源内的实体,剔除规则作用在解析后的内容上(R2 后改,原为原始键黑名单与保留软链接) | P-13 [测]、P-19、P-22;R2 第 1、4 条 |
| R22 导入写进 `opencode.json`(先装载)、出厂层写进 `opencode.jsonc`(后装载):导入内容在设置上低于出厂层,与今天「独立全局层低于显式层里的出厂内容」同序 | P-12(`config.ts:266-273`、`discovery.ts:12`) |
| R23 REQ-059 抬独立目录 `provider` 的那一半退役;逃生阀写入改指自有目录的导入文件;配置健康检查改查 `codepuppy.jsonc`,判法换成 `checkEngineConfigDocument`,只在整份不能装载时显示横幅(R2 后补判法) | P-16、P-25;`config-broken-banner.tsx:12-17`;R2 第 8 条 |
| R24 回滚 = revert G4;导入只复制不动来源,`engine-global/` 与副本留着不删,再应用不重复导入;导入整批发布(暂存 → 两次改名 → 失败改回),记录随批发布(R2 后补整批发布) | §9;R2 第 6 条 |
| R25 项目发现照旧排除独立目录的 canonical 身份及其配置文件别名;会话开在它里面时不做项目上溯 —— 接管 `config/discovery.ts` 一处(R2 后新增) | P-20;R2 第 2 条 |
| R26 Code Puppy 下不装载 integrated 与 wellknown 配置文档(共享库里的凭据与 KV 不动)—— 接管 `core/src/config.ts` 一处;被否决:移除指令(Console 插件受守护)、只接管 `wellknown.ts`(覆盖不到 Console)(R2 后新增) | P-21;ADR-047 决策 4「不连 Console」;R2 第 3 条 |
| R27 引用按各读方的真实基准迁移:`{file:}` 按文档目录;相对的 `instructions` / `skills` 不动;指向来源内的绝对引用改指副本;逃出来源的相对 `{file:}` 改成原目标绝对路径(R2 后新增) | P-23;R2 第 5 条 |
| R28 「能装载」只有 `checkEngineConfigDocument` 一个判法,组合引擎 `parseInfo` 的同一组函数,由上游探针钉住;副本闸门、健康检查、导入共用(R2 后新增) | `config.ts:136-166`;K2 已知偏离的既有守法 |
| R29 启动文档在 G4 升到 v2,加 `paths.standaloneConfigDirectory`(R2 后新增) | §4.1、§4.7 |

**本设计带来的 owner 可见变化**(按派发书「行为变了必须点名」):

1. 正常使用无变化:界面、模型、技能、审批、搜网、云能力都同今天。
2. 只有在 shell 里导出下列变量的人会看到差别:`CODEPUPPY_ECOSYSTEM_INHERIT`、`CODEPUPPY_AUTOMATION_DISABLE`、`CODEPUPPY_READONLY_DISABLE`、
   `CODEPUPPY_EXT_VERBOSE`、`CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS` —— 今天在正式包里导出了也不生效,之后生效(R6)。仓内 CLI 宿主里后一个今天就生效,之后照旧(R13)。
3. agent 在终端里运行 `env`,不再看到 `CODEPUPPY_*` 变量;把 `CODEPUPPY_*` 名字写进 `CODEPUPPY_ENV_ALLOWLIST_EXTRA` 也不再能送进子进程(R4)。
4. `OPENCODE_EXPERIMENTAL_FILEWATCHER` 写成 `yes` / `on` 时:今天项目文件监听开、引擎文件监听关;之后两处都关(R9)。写成空串的结果不变(R16)。
5. 平台模型服务地址或云 MCP 地址(`CODEPUPPY_BASE_URL`、`CODEPUPPY_CLOUD_MCP_URL`、固定文件或登录下发的端点)若带用户名密码、查询串或片段:
   今天照常使用(并且原样进了配置与子进程环境);之后这一项被拒,那一代没有平台模型服务或云 MCP,日志写明原因(R5)。本仓与平台下发的地址都没有这些部分。

**G4 带来的 owner 可见变化**(首次启动新版本时;owner 已接受第 3 条):

1. 什么都不用做,界面上没有新东西。独立 OpenCode 里写的全局指令(`AGENTS.md`)、自定义 agent、命令、技能、权限规则、格式化与语言服务设置,第一次启动时被复制进
   Code Puppy 自己的目录,照样生效。
2. 只复制上面这几类(允许清单);其余都不带:插件、MCP、模型服务与凭据、策略、默认模型 / 默认助手、实验开关、企业设置、网页搜索与压缩等设置,
   占用 Code Puppy 名字的命令与 agent,以及指向独立目录之外的软链接。其中 MCP、实验开关今天就被 Code Puppy 盖掉;策略今天能绕过模型服务白名单(P-13),之后不能;
   插件今天会装进来,之后要经 Code Puppy 的同意或定制中心。每一条写进 `engine-global/codepuppy-import.json` 与一行日志。
3. 之后在 `~/.config/opencode` 里的改动不再影响 Code Puppy;想两边都生效要写两遍(owner 原话「以后想两边都生效的设置，要写两遍」)。
4. 导出 `OPENCODE_CONFIG_DIR` 不再改变 Code Puppy 读的配置目录。
5. 用独立 OpenCode 登录过 OpenCode Console 或其它 well-known 来源的话,那份登录带来的远程配置不再进 Code Puppy(登录本身留在共享数据里不动)。
6. 首页「配置文件有错误」横幅改为检查 `codepuppy.jsonc`,判法与引擎一致(合法的新写法不再误报);手改把它改坏时,Code Puppy 沿用上一次能用的版本,
   横幅文字改为「配置文件有错误,修好之前沿用上一次能用的版本」。今天这种情况在运行中也是沿用上一份,只是启动时会丢掉;之后启动时也沿用。

**owner 已决定:做 Code Puppy 自有的引擎全局配置目录**(R11;2026-11-12,原话见批准记录)

原先列给 owner 的选项、好处与代价(上一版本节)由 §4.7 与 §9 的 G4 取代:代价按 owner「将缺点收缩到最小」收成「首次启动静默复制一份 + 以后两边要各写一次」。
上一版写的「是否把这些导入要另定」已定为导入(R20、R21);「进程围栏的 W6 可写项随之改」不在 G4 内(见留档)。

<!-- 每轮审查的回执行(delivery-review §3)写在下表。 -->

| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| R1 · 设计 `c5ca06786b` 全文 · 代码 `b74496994d`(相对 `b32116b2bc` 的相关差异已核)· 结论 FIX-THEN-MERGE | Codex gpt-6.1-sol,会话 01a1ced6,只读静态审计;编排器裁决:全部采纳 | **M1 旧引擎 bundle 不做版本检查**(迁移前 `dist-engine` 仍按环境读、回退 300000,新 ext active 后照报 ready)—— 采纳,修 | §4.1 每个 bundle 用自己的解析器读;§4.2 引擎导出 `assertCodePuppyBootstrap`,缺失或不符即拒启动;§5 失败表;R10。证据:P-11(`sidecar-ext-ready.ts:21-49` 只核 ext) | — |
| 同上 | 同上 | **M2 引用形状挡不住 URL 里的令牌**(查询串 / 片段;`codepuppy-auth.ts:365` 保留用户原值,`cloud-sidecar-config.ts:33` 原样进定义)—— 采纳,修 | §4.1 `CredentialFreeUrl` 与 `isCredentialFreeUrl`;§4.4 不合格即省略并记变量名;§6 S1;R5;owner 可见变化第 5 条 | 路径段不检查,写明在 §4.1 |
| 同上 | 同上 | **M3 无文档宿主会丢掉原本有效的覆盖**(仓内 CLI `cli/src/server-process.ts:101`;审批期限、项目文件监听)—— 采纳,修 | §4.1 `codepuppyEngineSettings` 兼容入口;§4.3 读方表写明覆盖哪两项、不覆盖哪三项及理由;子测试进程发布自己的文档;R13、R14。证据:P-09;WSL 跑上游发布版(`wsl/runtime.ts:262-266`),归为不在范围 | — |
| 同上 | 同上 | **M4 单通道规则与切片冲突**(A 片发完整 v1 时环境仍在传同名键;`sidecar-env.ts:273` 的 EXTRA 能放回已迁走的键)—— 采纳,修 | §9 改为 G1–G3 键组,每组一个提交边界,文档只含已迁完的键组;§4.5 `CODEPUPPY_` 前缀拒绝排在 EXTRA 之前,测试把旧键全部写进 EXTRA 仍断言不漏;R4、R15 | — |
| 同上 | 同上 | **m1 行为清单漏了空串变化**(`engine-server-options.ts:67-68`)—— 采纳,修(按键保留原语义) | §4.4 表新增「导出为 `""`」一列;构建器直接调 `engineDesktopToggles`;`defaultModelOverride` 保留空串;R16。证据:P-08 [测],另查出 `CODEPUPPY_DEFAULT_MODEL=""` 同类(`codepuppy-models.ts:274,278`) | — |
| 同上 | 同上 | **ARCH-NOTE 全局运行时注册表进了 schema**(`packages/schema/AGENTS.md:8` 禁止)—— 采纳,修 | 模块移到 `packages/util`(P-04、§6);`engineNetFailurePath` 的标记改为显式参数,schema 只留纯函数;R2 | — |
| R2 · 设计 `e6da3448e4` 的 G4(§4.7、§9 G4 各条、R11、R17–R24、P-12–P-18)· 代码 `778f44a41c` · 结论 FIX-THEN-MERGE | Codex gpt-6.1-sol,会话 01a1cefe,只读静态审计;编排器裁决:全部采纳 | **M1 原始键黑名单漏掉会被归一化成策略 / 插件 / 模型服务的旧键**(`normalize.ts:168,185,410`;审计方内存探针:剔除后白名单外 `anthropic=allow`)—— 采纳,修 | §4.7 导入改为归一化后的允许清单,未知即不带并记下;R21;§9 义务 2。证据:P-19 | — |
| 同上 | 同上 | **M2 链到独立目录的项目 `.opencode` 换根后不再被排除**(`discovery.ts:121`)—— 采纳,修 | §4.7「隔离」第二行:接管 `discovery.ts`,照旧排除独立目录的 canonical 身份与文件别名;R25;§9 义务 1。证据:P-20 | — |
| 同上 | 同上 | **M3 「不连 Console」排除不了 well-known**(共享库里的登录与缓存配置,策略早于出厂层;`wellknown.ts:139,209`、`config.ts:348`)—— 采纳,修(并入同类的 Console integrated 文档) | §4.7「隔离」第三行:接管 `config.ts`,Code Puppy 下不装载 integrated / wellknown 文档,共享库不动;R26;§9 义务 1。证据:P-21 | — |
| 同上 | 同上 | **M4 整目录软链接被原样复制,引擎跟随软链接,链进来的 `init.md` 能覆盖 `/init`**(`command.ts:143`)—— 采纳,修 | §4.7 文件只复制解析后落在来源内的实体,剔除作用在解析后的内容上,指出来源的不复制;R21;§9 义务 2。证据:P-22 | — |
| 同上 | 同上 | **M5 引用统一按来源目录改写会读错位置,指向旧根的绝对引用继续读旧目录**(`skill.ts:101`、`instruction.ts:113`)—— 采纳,修 | §4.7 引用迁移表按各读方基准;R27;§9 义务 3。证据:P-23 | — |
| 同上 | 同上 | **M6 逐项改名中途失败会留下一半已发布**(§5 旧行与之矛盾)—— 采纳,修 | §4.7 整批发布(暂存 → 两次改名 → 失败改回,记录随批);§5 失败表;R24;§9 义务 4 | — |
| 同上 | 同上 | **M7 删掉「保留上一份」会让一次改坏撤掉用户的拒绝策略**(`policy.ts:98` 缺省放行;今天 `engine-explicit-config.ts:113` 保留)—— 采纳,修 | §4.7 用户层最后一份可用副本 `codepuppy.engine.jsonc`(同目录、不合成),启动时也用;R19;§9 义务 5。证据:P-24 | — |
| 同上 | 同上 | **M8 健康检查仍用 v1 键表**(合法 `policies` / `agents` 误报,根为 `[]` 判健康;`ext-config.ts:1499,1525`)—— 采纳,修 | §4.7 改用 `checkEngineConfigDocument`,只在整份不能装载时显示横幅,忽略的字段进日志;R23、R28;§9 义务 6。证据:P-25 | — |
| 同上 | 同上 | **M9 引擎入口外层 `Global.node` 仍按环境取配置根并 mkdir**(`engine-embed.ts:48`、`global.ts:68,79`)—— 采纳,修 | §4.7 外层 `Global` 用同一配置根;R17;§9 义务 7。证据:P-26 | — |

修正后未再送审:按 delivery-review §2,采纳的 finding 以修正与证据收口,不自动开下一轮;是否冻结由编排器定。

G4 第一版(`e6da3448e4`)经 R2 审查(下表);R2 的修正以修正与证据收口,未再送审(delivery-review §2)。

**留档**

| 提议 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| 进程围栏 W6(`<XDG_CONFIG_HOME>/opencode` 可写,`process-fence-profile.ts:51`)在 G4 后可能不再需要 | 未实测引擎是否还写那里 | 去掉一条可写行要实测;留着无害 | 收紧围栏时 |
| G4 后 `mcp-default-deny` 只看自有目录,正常情况下找不到要压的 MCP | 导入已剔除 `mcp` | 它是既有的守卫,留着无害;删它不在 G4 的结果里 | 整理 MCP 治理时 |
| 「仓内 CLI 宿主」与 Code Puppy 的全局目录无关 | CLI 仍按上游规则读 `~/.config/opencode` | 不是 Code Puppy 的宿主 | — |
| 调查文档 C 表第 8 行「moves the data directory」更正 | 文字误差,会误导选项 (b) 的代价 | 调查文档是只读调查记录;更正已写在本设计 P-05 | 调查文档再被引用时 |
| `cloud-websearch-kill.ts:136-140` 注释说本地 deny 是「kill-switch 或平台代付」 | 自 #1411 起只看 kill-switch(`server.ts:336-340`),注释过时 | 该键随 G2 删除,注释一起走 | — |
| sidecar 里 Code Puppy 的代码仍按 `XDG_DATA_HOME` 自己拼 OpenCode 数据根(`policy/index.ts:44-46`) | 既有 K2 偏离,已登记 | 那是 OpenCode 的决定,不属于 main 交给引擎的值 | 插件 Context 开始提供数据根时 |
| `OPENCODE_DISABLE_MODELS_FETCH` 写成 `yes` / `on` 会打开拉取(P-08) | 今天的判法只认 `1` / `true` 为「禁用」,与名字直觉相反 | 本设计按键保留今天的语义,不改判法 | 有人报「设了 yes 反而去拉」时 |
