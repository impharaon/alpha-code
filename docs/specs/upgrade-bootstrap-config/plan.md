---
id: PLAN-upgrade-bootstrap-config
title: 启动配置收成一份 实施计划
summary: alpha-code#1698 的分段计划:段 0 先在今天的代码上钉住一次代表性启动的决定记录;G1–G3 按键组把主进程交给 sidecar / ext / 引擎的决定搬进启动文档(同一个 PR);G4 换上 Code Puppy 自有的引擎全局配置目录(单独一个 PR)。另附今天 alpha 上变量与读方的盘点
kind: plan
status: active
spec: ""
design: DESIGN-upgrade-bootstrap-config
owners: [owner]
last_reviewed: 2026-11-12
---

# PLAN-upgrade-bootstrap-config｜启动配置收成一份 实施计划

由实施会话在计划阶段写,编排器核对后由同一会话实施。每个交付段一节;旧段留作证据。决定只链接 [design](design.md)、不重述;实施中偏离本段,在同一个提交里改本段。

## 盘点:今天 alpha 上的变量与读方(计划依据)

核对对象:`alpha @ c01ea14919`(含 #1694 换代与 #1693 等后续修复)。方法:生产函数 `sidecarSourceFiles()`(`packages/ui-mac/src/main/process-fence-write-sites.ts:151`)算出 sidecar 进程里跑的 Code Puppy 源码(sidecar.ts 的相对 import 闭包 65 个文件 + `packages/ext/src` 非测试文件 42 个),加上 core / plugin / schema / util 里的自有文件与接管块,逐一 grep `CODEPUPPY_*` / `process.env` / `env[...]`;再与设计代码基线 `30b9a679f8`(是 HEAD 的祖先)逐文件比对新增。

**结论**:进入 sidecar 进程的 `CODEPUPPY_*` 共 29 个名字 —— 设计 §2.2 的 28 个,外加 1 个设计没有的 `CODEPUPPY_PROVIDER_ALLOW`(见末行,BLOCKED);另有 2 个 `OPENCODE_*` 开关与 `StartCommand` 的 6 个决定字段。28 个里 P-06 那 5 个今天仍被白名单丢掉(`sidecar-env.ts:32-102` 的 EXACT 里没有它们)。设计基线之后新增的读方共 4 处:3 处读的是设计已覆盖的键、落在设计已定读法的宿主里(按 §4.3 的规则迁),1 处是新键。

| 键 | 今天的写方 | 今天 sidecar 进程里的读方 | 对设计 §2.2 |
| --- | --- | --- | --- |
| `CODEPUPPY_GLOBAL_DIR` | `codepuppy-environment.ts:176`(main 自己的 env)→ EXACT `sidecar-env.ts:93` | `codepuppy-environment.ts:193`(无快照回退;经 `:85-101` 供 `custom-provider-records.ts`、`mcp-server-records.ts`,经 `engine-config-truth.ts:16`、`codepuppy-installs.ts:35`);ext `plugin.ts:120` → `project-config.ts:85`;**ext `external-directory-rule.ts:34`(经 `plugin.ts:341`)** | 覆盖;`external-directory-rule.ts` 为基线后新增(`4bdbf69321`),ext 宿主,按 §4.3 ext 规则迁 |
| `CODEPUPPY_JSONC_TRUTH_DISABLE` / `_LEGACY_INSTALL_ROOT` | 用户导出 → EXACT `:99-100` | `codepuppy-config-injection.ts:219` | 覆盖(行号漂移) |
| `CODEPUPPY_BASE_URL` | `codepuppy-auth.ts:365` → EXACT `:66` | `codepuppy-models.ts:191,221`;ext `plugin.ts:219`、`cloud-access.ts:22`、`cloud-vision.ts:70`、`platform-credential-header.ts:31`、**`platform-credential-header.ts:52`(经 `plugin.ts:239`)** | 覆盖;设计只列了 `plugin.ts`,另三处基线时就在,`:52` 为基线后新增;全部 ext 宿主 |
| `CODEPUPPY_PLATFORM_AUTH_REF` | `server.ts:486` → EXACT `:69` | ext `platform-credential-header.ts:32`(经 `plugin.ts:239`) | 覆盖 |
| `CODEPUPPY_DEFAULT_MODEL` | 用户导出 → EXACT `:71` | `codepuppy-models.ts:274` | 覆盖 |
| `CODEPUPPY_CLOUD_MCP_URL` | `codepuppy-auth.ts:370` → EXACT `:70` | `codepuppy-config-injection.ts:235,242` | 覆盖 |
| `CODEPUPPY_CLOUD_MCP_SERVER` / `_DEF` / `_ARM` | sidecar 注入 `codepuppy-config-injection.ts:566-600`(C7) | ext `cloud-websearch-kill.ts:410-411`、`cloud-access.ts:7`、`cloud-vision.ts:64`、`cloud-contract-hook.ts:57`、`policy/identity.ts:112`;plugin `alpha-cloud-authority.ts:23-24,99,164`;**core `mcp/client.ts:374-375`(接管文件、既有 `codepuppy(#1562)` 块)** | 覆盖;`client.ts` 调用点为基线后新增(`323ccbb44f`),读方仍是 `alpha-cloud-authority.ts`(§4.3 已定读法),调用点改动落在既有标注块内 |
| `CODEPUPPY_WEBSEARCH_DISABLE` | 用户导出 → EXACT `:75` | `codepuppy-config-injection.ts:238` | 覆盖 |
| `CODEPUPPY_LOCAL_WEBSEARCH_DENY` / `_CLOUD_WEBSEARCH_DENY` | `server.ts:336-340` → EXACT `:79,83` | ext `cloud-websearch-kill.ts:143-153`(及其调用方 `plugin.ts:165-166,183`) | 覆盖 |
| `CODEPUPPY_FACTORY_SKILL_DIRS` | `index.ts:855` → EXACT `:87` | `codepuppy-config-injection.ts:113`(`explicitSkillDirs`,C4 监听同用);**ext `external-directory-rule.ts:38`** | 覆盖;ext 处为基线后新增,ext 宿主 |
| `CODEPUPPY_FACTORY_DENY_SKILLS` | `index.ts:858` → EXACT `:89` | ext `plugin.ts:269,351,356`(`factory-deny.ts:60-70`) | 覆盖 |
| `CODEPUPPY_POLICY_ACCOUNT` | `server.ts:497-500`(直接写 sidecarEnv) | ext `policy/index.ts:72` | 覆盖 |
| `CODEPUPPY_EXT_BUNDLED_MANIFEST` | `server.ts:503` | ext `policy/bundled-plugin.ts:36` | 覆盖 |
| `CODEPUPPY_OFFICE_MCP_MANIFEST` | `server.ts:492` | core `mcp/codepuppy-first-party-mcp.ts:53`(经 `mcp/index.ts:452`、ext `policy/identity.ts:121`) | 覆盖 |
| `CODEPUPPY_EGRESS_PROXY` | `sidecar-env.ts:311`(仅 darwin)→ EXACT `:57` | schema `codepuppy-net-failure.ts:168`(经 core `session/to-session-error.ts:57`、`mcp/codepuppy-startup.ts:54,68`,ext `policy/display.ts:93-97`) | 覆盖 |
| `CODEPUPPY_MODELS_DISABLE` | 用户导出 → EXACT `:72` | `codepuppy-models.ts:130` | 覆盖 |
| `CODEPUPPY_IDENTITY_DISABLE` / `_BEHAVIOR_DISABLE` | 用户导出 → EXACT `:73-74` | `codepuppy-config-injection.ts:247-248` | 覆盖 |
| `CODEPUPPY_PROMPT_REBRAND_DISABLE` | 用户导出 → EXACT `:85` | `codepuppy-config-injection.ts:341`;ext `plugin.ts:198,273` | 覆盖 |
| `CODEPUPPY_ECOSYSTEM_INHERIT` | 用户导出(**白名单丢弃**) | `codepuppy-config-injection.ts:174` | 覆盖(P-06 仍成立) |
| `CODEPUPPY_AUTOMATION_DISABLE` / `_READONLY_DISABLE` | 用户导出(**白名单丢弃**) | `codepuppy-config-injection.ts:353,461` / `:390` | 覆盖(P-06 仍成立) |
| `CODEPUPPY_EXT_VERBOSE` | 用户导出(**白名单丢弃**) | ext `plugin.ts:118,264,299,365` | 覆盖(P-06 仍成立) |
| `CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS` | 用户导出(**白名单丢弃**) | core `permission.ts:102-103`(调用 `:327`) | 覆盖(P-06 仍成立;仓内 CLI 宿主里有效) |
| `OPENCODE_DISABLE_MODELS_FETCH` / `OPENCODE_EXPERIMENTAL_FILEWATCHER` | `server.ts:391` / `:388` 设默认 → PREFIXES | `engine-server-options.ts:67-68`(经 `sidecar.ts:170`);core `filesystem/codepuppy-project-watch.ts:17`(经 `location-watcher.ts:83`) | 覆盖 |
| `StartCommand` 六个决定字段 | `server.ts:665-670` | `sidecar.ts:75-103,139-246`;`mcp-default-deny.ts:55` 另按 env 重算配置目录 | 覆盖 |
| **`CODEPUPPY_PROVIDER_ALLOW`** | **sidecar 注入 `codepuppy-config-injection.ts:329-330,673`(写进 sidecar 进程环境,C7 同形;值由注入从治理策略算出,不是 main 的决定)** | **ext `provider-allow.ts:26`(经 `plugin.ts:243,403`);登记册条目 `provider-allowlist`** | **未覆盖** —— 设计基线之后由 `87b7e280e3`(#1662)加入;§2.1 C7 写「删除,并入启动文档」,而启动文档由 main 构建、在注入之前发布,装不下 sidecar 算出的值。→ BLOCKED,见段 2 |

只被 main 自己读的 `CODEPUPPY_*`(设计 §2 范围外的六个,以及 `server.ts:202,233,428`、`ext-install-planner.ts:3279` 里 main 读自己环境的 `CODEPUPPY_GLOBAL_DIR`)不在本计划改动之列。

## 段 0 — 代表性启动的决定记录(改动前钉住)

- 依据:Issue [alpha-code#1698](https://github.com/impharaon/alpha-code/issues/1698) AC-04;design @ `c01ea14919` §9「回滚」(C3–C6 磁盘形状两边一致)、§10「owner 可见变化」第 1 条(正常使用无变化);派发书「同一组决定经真启动装配被引擎 / ext 观察到」。
- 核对:`f3fd81e14f` · 编排器(Claude Fable 5.2)· 通过;裁决 R30–R32 入 design §10 @ `7b3baf25e5`(R30 = 段 2 BLOCKED 项选 (a);R31 = 回退顺序「快照 → 已发布文档 → 环境」,生产启动里环境分支不可达,由段 0 的决定记录断言;R32 = P-13 反向臂在不装 ext 的真引擎上判,G4 可分 4a / 4b / 4c);35–40 文件的段体量按 §9 接受。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/src/main/bootstrap-launch-parity.engine.cases.ts`(新) | 一次代表性启动走生产 `spawnLocalServer`(假 fork,mock 同 `websearch-account-tool-table.engine.cases.ts`:electron、日志、设置存储、钥匙串后端):已登录(合成令牌,云 MCP 与模型地址指本机桩)、有账户分区、darwin 出网代理端口、围栏计划、已初始化环境快照(通道 `stable`)、出厂技能目录。记下 fork 环境与 `start` 消息;「sidecar 这一步」在本段按今天的方式把 fork 环境里的 `CODEPUPPY_*` 与 `StartCommand` 字段交给本进程;然后生产 `injectCodePuppyConfig` → 沙箱引擎 + 真 ext(`test-component/codepuppy-engine.ts`)。产出一份决定记录并与手写字面量逐字比对:① `start` 消息里的围栏 profile / addonPath;② 交给 `start()` 的库路径、配置目录、`models.fetch`、`fs.filewatcher`;③ 引擎里各档位 agent 的权限规则、ext 的外部目录规则、出厂禁用技能不在技能表;④ ext 工具策略的账户分区键、一次经出网代理的连接失败被判为 `via: proxy`;⑤ 引擎供应商表里平台节点的地址、第一次模型请求带的凭据头等于凭据文件内容、云 MCP 条目的地址与 `codepuppy-cloud` 权威;⑥ 通道 `stable` 下注入的 disabled-override 结果;⑦ C4 显式文件、C5 模型底表的内容(临时根替换成占位)与密钥文件名集合。P-06 那五个开关不进记录(它们按 R6 有意改变)。 |
| `packages/ui-mac/src/main/bootstrap-launch-parity.engine.test.ts`(新) | 宿主:起独立 `bun test` 子进程跑上面的 cases,钉住通过条数与 0 fail(仓内 `*.cases.ts` 惯例)。 |
| `packages/ui-mac/src/main/bootstrap-launch-parity.record.json`(新) | 决定记录:改动前的代码实跑一次产出(两次实跑逐字相同),cases 与它逐项比对。 |
| `scripts/gate-files.tsv` | 登记上面的宿主一行(精确条数、`delegates_to` 写 `-`)。 |

### 顺序
1. 一个提交:两份新测试 + 记录文件 + 登记行。在今天的代码上必须全绿,不动任何生产代码。相关测试:`cd packages/ui-mac && bun test src/main/bootstrap-launch-parity.engine.test.ts`。

### 风险
- 若某一项决定不改生产代码就观察不到,那一项改为经生产读函数观察并在段内注明,不为测试改生产代码。
- 真引擎 cases 单次约 60–90 s;一个子进程里多次起引擎,沿用 `codepuppyEngine` 的多次 `start()` 先例。

### 证明
| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-04(基线) | `bootstrap-launch-parity.engine.test.ts` | 本段只钉住今天的值;段 1–3 每段只改「sidecar 这一步」的接法,记录文件一字不改(评审看 `git diff <段0> <段n> -- src/main/bootstrap-launch-parity.record.json` 为空)。任何一组键在构建器里漏写或读错,记录里对应那一格就不同而红。已知的坏(实跑):把 `server.ts` 写 `CODEPUPPY_POLICY_ACCOUNT` 那一句改成不写 ⇒ 记录的 `engine.policyAccount` 从 `acct:956e…c48` 变成 `anonymous` 而红。 |

### 偏离记录
- 2026-11-12 · 期望不写成 cases 里的手写字面量,而是钉在 `bootstrap-launch-parity.record.json`(约 620 行,由改动前的代码实跑产出,两次实跑逐字相同)· 记录太长,放进 cases 读不下去;文件形式让「各段记录不变」直接是这份文件的空 diff · 本段提交。
- 2026-11-12 · 记录各格的观察方式按实际可观察的落定:① sidecar 收到的路径 / 通道 / ext 目录 / 围栏;② `start()` 选项;③ 内联文档(档位 agent 权限即在其中)、显式文件、模型底表内容、密钥文件名;④ 引擎里 ext 状态、`GET /api/provider`、云 MCP 状态、工具策略 RPC `inventory` 的账户分区、`engineNetFailurePath` 对 sidecar 整份 env 的归类;⑤ 两个桩收到的凭据头。原计划的「ext 外部目录规则」「出厂禁用技能不在技能表」「disabled-override 结果」三项没有单独成格:前两者的输入(全局根、出厂技能目录)已在 ③ 里,第三项在沙箱里没有已装扩展、产出为空,改记它的输入 `registryChannel` · 本段提交。
- 2026-11-12 · 通道:非打包构建的环境快照固定解析为 dev,记录里 `registryChannel` 是 `dev`,不是计划写的 `stable` · 本段提交。
- 2026-11-12 · 测试隔离两处(只在测试里):dev 下 ext 目录从未入库的 `packages/ext/dist` 解析,mock `./codepuppy-ext-plugin` 改指沙箱里指向 ext 源码的目录插件;main 交给 sidecar 的 `initialDirectory` 默认取 `os.homedir()` 下的工作目录(bun 下不随沙箱 HOME),用 main 自己的 `CODEPUPPY_USER_WORKSPACE_DIR` 改指沙箱 · 本段提交。

## 段 1 — G1 接通与路径

- 依据:design @ `c01ea14919` §4.1(v1 外壳与 G1 字段:`v`、`paths.*`、`registryChannel`)、§4.2、§4.3(sidecar、ext、`codepuppy-first-party-mcp.ts` 一行)、§4.4(构建器)、§4.5(前缀拒绝排在 EXTRA 之前;例外名单 = EXTRA 本身 + 尚未迁走的 G2/G3 键)、§5、§9 G1、§10 R1、R2、R4、R10、R14、R15;Issue AC-01、AC-02、AC-04。
- 核对:`f3fd81e14f` · 编排器(Claude Fable 5.2)· 通过;裁决 R30–R32 入 design §10 @ `7b3baf25e5`(R30 = 段 2 BLOCKED 项选 (a);R31 = 回退顺序「快照 → 已发布文档 → 环境」,生产启动里环境分支不可达,由段 0 的决定记录断言;R32 = P-13 反向臂在不装 ext 的真引擎上判,G4 可分 4a / 4b / 4c);35–40 文件的段体量按 §9 接受。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/util/src/codepuppy-bootstrap.ts`(新) | Code Puppy 自有(ADR-043 文件名 + 标记),只 import `node:path`。§4.1 的外壳:版本常量、错误类型、严格解析、发布 / 读取 / `try` 读取、仅测试重置入口;类型只含 G1 字段(§9:文档只含已迁完的键组)。 |
| `packages/util/src/codepuppy-bootstrap.test.ts`(新) | 解析:多键、缺键、类型错、`v` 不符各自的 `reason` 与点路径,消息不含值;发布两次 ⇒ `republished`;未发布读取 ⇒ `unpublished`;返回深冻结。 |
| `packages/ui-mac/src/main/codepuppy-bootstrap-build.ts`(新) | `buildCodePuppyBootstrap(input)`:main 每次 fork 调一次,输入全来自 §4.4 列的现有权威(冻结快照、`engine-paths.ts`、`resolveExtPluginPath`、资源根);G1 字段;`paths.userConfig` 按逃生阀省略。 |
| `packages/ui-mac/src/main/codepuppy-bootstrap-build.test.ts`(新) | 构建器单测(G1 字段;逃生阀任一置位 ⇒ `userConfig` 缺席;资源根 `realpath` 失败 ⇒ 抛)。 |
| `packages/ui-mac/src/main/server.ts` | `start` 消息去掉六个决定字段、加 `bootstrap`;删掉 `sidecarEnv` 里 `CODEPUPPY_OFFICE_MCP_MANIFEST`(`:492`)与 `CODEPUPPY_EXT_BUNDLED_MANIFEST`(`:503`)两处写入。 |
| `packages/ui-mac/src/main/sidecar-env.ts` | §4.5 判定顺序:`CODEPUPPY_` 前缀拒绝排在 EXTRA 之前,例外 = EXTRA 本身 + G2/G3 键;EXACT 删 `CODEPUPPY_GLOBAL_DIR`、`_JSONC_TRUTH_DISABLE`、`_LEGACY_INSTALL_ROOT`。 |
| `packages/ui-mac/src/main/sidecar-bootstrap-gate.ts`(新) | sidecar 侧启动关口的两步(§4.2 第 2、4 步):解析并发布;引擎模块缺 `assertCodePuppyBootstrap` 导出即抛,有则调用。独立成文件是为了能在真入口上测(sidecar.ts 顶层取 parentPort,结构上不能 import;先例 `sidecar-ext-ready.ts`)。 |
| `packages/ui-mac/src/main/sidecar.ts` | `StartCommand` / `parseCommand` 按 §4.2;`start()` 按 §4.2 的五步顺序接上关口;注入、显式层监听、`start()` 选项的输入改读文档。 |
| `packages/ui-mac/engine/engine-embed.ts`、`packages/ui-mac/src/main/env.d.ts` | 导出 `assertCodePuppyBootstrap`;虚拟模块声明同步。 |
| `packages/ui-mac/src/main/codepuppy-environment.ts` | `resolveCodePuppyGlobalRoot` 无快照时先读已发布文档的 `paths.globalRoot`(§4.3);见风险第 2 条。 |
| `packages/ui-mac/src/main/codepuppy-config-injection.ts` | 逃生阀判定(`:219`)改为看 `paths.userConfig` 在不在;函数签名保留作测试接缝(§4.3 末条),生产由 sidecar 传文档值。 |
| `packages/ui-mac/src/main/mcp-default-deny.ts` | `:55` 改读 `paths.engineConfigDirectory`(§4.3 首条)。 |
| `packages/ext/src/plugin.ts`、`packages/ext/src/project-config.ts` | `setup` 第一步 `codepuppyBootstrap()`;全局根的 canonical 复验改用文档值(§4.3 ext)。 |
| `packages/ext/src/external-directory-rule.ts` | 全局根改读文档;出厂技能目录本段仍读环境(G3 迁)。盘点里的基线后新增读方。 |
| `packages/ext/src/policy/bundled-plugin.ts`、`packages/ext/src/policy/identity.ts` | 随包清单与 Office 清单路径改读文档。 |
| `packages/core/src/mcp/codepuppy-first-party-mcp.ts`、`packages/core/src/mcp/index.ts` | §4.3 表第 3 行;`index.ts:452` 的改动在既有 `codepuppy(#1565)` 行内。 |
| `packages/ui-mac/test-component/codepuppy-engine.ts` | 测试宿主改为经生产解析器发布一份文档(R14),不再写 G1 键的环境;同一进程多台引擎前调测试重置入口。 |
| `packages/ext/src/plugin-setup-order.cases.ts`、`plugin-reload-wiring.cases.ts`、`plugin-host.test.ts`、`project-config.test.ts`、`cloud-websearch-kill.test.ts`、`cloud-vision.test.ts`、`context-injection.test.ts`、`codepuppy-ext-no-shell-layer.test.ts` | 今天写 `process.env.CODEPUPPY_GLOBAL_DIR` 的 8 个 ext 测试改为在 import ext 前发布文档(R14、P-09 第 3 项)。 |
| `packages/ui-mac/src/main/server.test.ts`、`sidecar-env.test.ts`、`codepuppy-sidecar-wiring.test.ts`、`codepuppy-environment.test.ts`、`websearch-account-tool-table.engine.cases.ts`、`bootstrap-launch-parity.engine.cases.ts` | 断言旧通道的用例改断言文档字段(`#1565`、`#1578` 两条);「sidecar 这一步」改为解析并发布记下的 `start.bootstrap`(决定记录期望不改);新增 §4.5 fork 环境用例(本段形态)。 |
| `packages/ui-mac/src/main/sidecar-bootstrap-gate.test.ts`(新)、`packages/ui-mac/src/main/bootstrap-env-readers.test.ts`(新) | 见证明表。 |
| `scripts/gate-files.tsv` | 新闸门文件登记、受影响文件的精确条数同步。 |

### 顺序
1. 一个提交(§9:一个键组一个提交边界,不拆)。相关测试:`packages/util` 的 `src/codepuppy-bootstrap.test.ts`;`packages/ui-mac` 的上表各测试与 `src/main/process-fence-write-sites.test.ts`、`src/main/old-name-scan.test.ts`;`packages/ext` 的上表各测试;`packages/core` 的 first-party MCP 相关测试;`util` / `ui-mac` / `ext` / `core` 各自 `bun typecheck`;`bash scripts/north-star-guard.sh`。

### 风险
1. **体量**:约 35 个文件(生产约 20、测试约 15),超出 15 文件的指引。原因是 §9 规定一个键组一个提交边界,而 `CODEPUPPY_GLOBAL_DIR` 一组的读方与测试面最大;不拆键组。
2. **共用模块的无快照回退**:`codepuppy-environment.ts` 的 `resolveCodePuppyGlobalRoot` 是 main 与 sidecar 共用的。按 §4.3「改为退回已发布的文档;main 仍用冻结快照」落成:快照 → 已发布文档 → 环境(只剩 main 无快照这一种情形,即单测)。sidecar 里文档在注入之前就发布,环境里也已经没有这个键(§4.5),环境分支在 sidecar 里到不了,由「sidecar 单通道」用例判(证明表)。这样做是因为 55 个 ui-mac 测试文件写 `CODEPUPPY_GLOBAL_DIR` 而不初始化快照,靠这条回退给全局根。若编排器要求逐字删掉环境分支,这些文件改为先初始化快照或发布文档,本段另计最多约 +55 文件。
3. 发布只允许一次(§4.1),同一测试进程起多台引擎时漏调重置入口会抛 `republished`;宿主统一在 `codepuppyEngine()` 里处理。
4. 围栏:`createSidecarEnv` 的输出仍是围栏计划的输入(`server.ts:537`),计划只读 `XDG_*` / `HOME`(`process-fence-plan.ts:78-81`,`process-fence-profile.ts:83`),本段删的只有 `CODEPUPPY_*`,profile 文本由段 0 记录第 ① 格逐字判。

### 证明
| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01 · §4.1 解析 | `codepuppy-bootstrap.test.ts` | 去掉多键检查或版本检查 ⇒ 对应用例拿不到 `invalid` / `version` 而红。 |
| AC-01 · §4.2 关口 | `sidecar-bootstrap-gate.test.ts`:坏文档 ⇒ 抛且带字段路径;引擎模块形如迁移前(只有 `startEngine` / `ENGINE_VERSION`)⇒ 抛;真 `engine-embed.ts` + 已发布文档 ⇒ 通过;在 `globalThis` 槽上放一份形状不符的对象 ⇒ 真 `assertCodePuppyBootstrap` 抛。`codepuppy-sidecar-wiring.test.ts` 加 ANCHOR(非闸):sidecar.ts 里装围栏 → 关口 → 注入 → import 引擎 → 引擎关口 → `startEngine` 的先后 | 去掉「缺导出即抛」⇒ 迁移前形状那条照样通过而红。 |
| AC-01 · ext 第一步 | `plugin-setup-order.cases.ts` 加一条:真 ext、未发布文档 ⇒ `setup` 抛、插件 failed | 去掉第一步读取 ⇒ 插件 active 而红。 |
| AC-02 · §4.5(本段形态) | `server.test.ts`「fork 环境里没有已迁走的键」:生产 `spawnLocalServer` 假 fork,导出 §2.2 全部旧键并全部写进 `CODEPUPPY_ENV_ALLOWLIST_EXTRA`,交给 fork 的环境里 `CODEPUPPY_*` 只剩 EXTRA 与 G2/G3 例外 | 去掉前缀拒绝,或把它排到 EXTRA 之后,或在 EXACT 加回任一 G1 键 ⇒ 红(提交前各变异一次)。 |
| AC-02 · 无遗漏读者 | `bootstrap-env-readers.test.ts`(新闸门):用 TypeScript AST 扫生产源码里的字符串字面量与属性名。① 已无写方的键:扫 `packages/{ui-mac/src,ui-mac/engine,ext/src,core/src,plugin/src,schema/src,util/src}` 全部非测试源码,命中数为 0(本段:`CODEPUPPY_EXT_BUNDLED_MANIFEST`、`CODEPUPPY_OFFICE_MCP_MANIFEST`);② 仍由 main 持有的键:扫 sidecar 进程源码(生产 `sidecarSourceFiles()` + core / plugin / schema / util 的 Code Puppy 文件),命中只许落在逐条登记的「文件 × 键」例外上(本段只有风险第 2 条那一处) | 在 ext 里加回一处 `process.env.CODEPUPPY_GLOBAL_DIR`,或在任一处留着旧常量 ⇒ 红。 |
| AC-04 · sidecar 单通道 | `codepuppy-environment.test.ts`:发布文档且环境里放一个不同的 `CODEPUPPY_GLOBAL_DIR` ⇒ 读到文档值 | 去掉文档分支 ⇒ 读到环境值而红。 |
| AC-04 · 决定不变 | 段 0 的 `bootstrap-launch-parity.engine.test.ts`,期望字面量不改 | 构建器漏写任一 G1 字段 ⇒ 记录第 ①②⑥⑦ 格之一不同而红(提交前删 `paths.officeMcpManifest` 变异一次)。 |
| §9 回滚(G1–G3) | 见段 3 | — |

### 偏离记录
- 2026-11-12 · 注入的测试接缝:`injectCodePuppyConfig` 加第 4 个参数 `userConfig?: string | null`,sidecar 传 `paths.userConfig ?? null`(null = 逃生阀置位);只有直接调注入的测试不传,取 `codepuppyJsoncPath()` · 不这样做要改约 45 个直接调用注入的测试点;注入自己不再读两个逃生阀 · 本段提交。
- 2026-11-12 · `mcp-default-deny.ts` 的目录取法:显式选项 → 已发布文档的 `paths.engineConfigDirectory` → 按环境的旧推导(只剩直接调注入、没有文档的测试)。环境那一支读的是 `OPENCODE_CONFIG_DIR` / `XDG_CONFIG_HOME`,不是 Code Puppy 的键,在 sidecar 里到不了(与 R31 同一读法)· 本段提交。
- 2026-11-12 · 测试夹具 `packages/ui-mac/test-component/codepuppy-bootstrap-fixture.ts`(新):经生产解析器发布一份测试用文档(R14),ext 测试按 `ui-mac/test-component/engine-sandbox` 的先例跨包 import;放在 `src` 之外,不进 sidecar 源码集合 · 本段提交。
- 2026-11-12 · 原表之外改动的测试(都是因为它们按旧通道搭环境):ext `policy/register-policy.test.ts`、`policy/policy-host.cases.ts`(isolate 里发布文档)、`project-config.test.ts`;core `test/codepuppy-mcp-runtime.test.ts`(引擎从文档读 Office 清单);ui-mac 里调真 `spawnLocalServer` 的 `sidecar-stop.test.ts`、`process-fence-wiring.test.ts`、`test-component/req053-spawn-rotation.cases.ts`、`test-component/req053-spawn-throat-latch.cases.ts`,外加 `server.test.ts`、`codepuppy-sidecar-wiring.test.ts` —— 构建器要全局根,这些无快照的测试经环境给一个(R31 允许的环境那一支)。`websearch-account-tool-table.engine.cases.ts` 不必改(引擎宿主 `codepuppyEngine()` 已发布文档;它发布的 `engineConfigDirectory` 取 #1698 之前注入按环境推的那个目录,各 engine cases 写用户全局配置的位置不变)。`#1572` 真栈的驱动 `test-fixtures/net-failure/engine-driver.ts` 照 sidecar.ts 的顺序改为解析并发布启动文档、过引擎关口,`net-failure-real-stack.test.ts` 用 main 的生产构建器造这份文档 · 本段提交。
- 2026-11-12 · 锚点:`#1578` 那条锚 server.ts 写 sidecar env 清单键的 ANCHOR 删除 —— 清单路径成了文档的类型化字段,值由构建器测试判;`#1531` 那条改锚新字符串;新增 `#1698` ANCHOR 钉 sidecar.ts 关口顺序;`source-text-anchors.ts` 同步(条数仍 2)。真引擎入口那一半加进 `sidecar-engine-host.cases.ts`(宿主条数 6 → 7);ext 未发布文档那一条加进 `plugin-setup-order.cases.ts`(宿主 1 → 2 pass)· 本段提交。
- 2026-11-12 · 机械登记:`scripts/old-name-exceptions.tsv` 删 sidecar.ts `/Alpha` 一行(那句注释随 StartCommand 的 `initialDirectory` 字段一起删了);`scripts/gate-files.tsv` 改 `sidecar-env.test.ts` 31 → 29、登记 `bootstrap-env-readers.test.ts`(3),并把 `sidecar-bootstrap-gate.test.ts`(4)、`codepuppy-bootstrap-build.test.ts`(4)登记为受托闸门(登记簿完备性闸要求:`codepuppy-sidecar-wiring.test.ts` 与 `sidecar-env.test.ts` 的正文把判据委派给它们,`delegates_to` 同步);顺手把三处点名旧变量的注释改成文档字段(`ext/src/policy/bundled-plugin.ts`、`core/src/mcp/codepuppy-first-party-mcp.ts`、`ui-mac/electron-builder.config.ts`)· 本段提交。
- 2026-11-12 · ext 的 `setup` 第一句读文档(`codepuppyBootstrap()`)排在 `registerPolicy` 之前:它不挂任何钩子,I3 的挂钩次序(`plugin-setup-order.cases.ts` 照判 `registerPolicy` 第一、`seal` 最后)不变 · 本段提交。
- 2026-11-12 · 体量:实际 58 个文件(生产 20、测试与夹具 34、登记与文档 4),高于计划估的 35;多出来的是上面那批按旧通道搭环境的测试 · 本段提交。

## 段 2 — G2 平台、云与网络

- 依据:design @ `c01ea14919` §4.1(G2 字段、`CredentialFreeUrl` / `isCredentialFreeUrl`、`cloudMcpArmed`)、§4.3 表第 4、5 行与末两条、§4.4(URL 规则与日志行)、§4.5、§6「被否决的替代」9、§9 G2、§10 R5、R8;登记册 `tool-policy-partitions`、`l1r-output-caps`(ADR-048:握法与测试名随键改写,决定不变);Issue AC-01、AC-02、AC-04。
- 核对:`f3fd81e14f` · 编排器(Claude Fable 5.2)· 通过;裁决 R30–R32 入 design §10 @ `7b3baf25e5`(R30 = 段 2 BLOCKED 项选 (a);R31 = 回退顺序「快照 → 已发布文档 → 环境」,生产启动里环境分支不可达,由段 0 的决定记录断言;R32 = P-13 反向臂在不装 ext 的真引擎上判,G4 可分 4a / 4b / 4c);35–40 文件的段体量按 §9 接受。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/util/src/codepuppy-bootstrap.ts`、`codepuppy-bootstrap.test.ts` | 加 G2 字段、无凭据 URL 判定、`cloudMcpArmed`;两处引用字段只收 `{file:}` 的解析用例。 |
| `packages/ui-mac/src/main/codepuppy-bootstrap-build.ts`、`.test.ts` | G2 字段:两个 URL 过判定,不合格省略并记一行变量名(§4.4);云 MCP 定义用 `materializeCloudMcpConfig` + `secretFileRef`(R8);账户分区哈希从 `server.ts:497-500` 搬来;出网代理 URL;kill-switch。 |
| `packages/ui-mac/src/main/server.ts` | 删 `:486` 平台凭据引用写入、`:497-500` 分区写入、`applyWebSearchSovereignty` 里两个 DENY 键的写入(`:336-340` 及其调用处)。 |
| `packages/ui-mac/src/main/sidecar-env.ts` | EXACT 删 `CODEPUPPY_BASE_URL`、`_PLATFORM_AUTH_REF`、`_CLOUD_MCP_URL`、`_DEFAULT_MODEL`、`_WEBSEARCH_DISABLE`、两个 DENY 与出网代理标记;`sidecarEgressProxyEnv` 不再写标记;例外名单删 G2 键。 |
| `packages/ui-mac/src/main/codepuppy-config-injection.ts`、`codepuppy-models.ts`、`cloud-web-search.ts` | 注入与模型配置的 G2 读取改读文档;删 C7 三键的写入(`:566-600`);删 ui-mac 侧环境变量名常量。 |
| `packages/ext/src/cloud-websearch-kill.ts`、`cloud-access.ts`、`cloud-vision.ts`、`cloud-vision-hooks.ts`、`cloud-contract-hook.ts`、`platform-credential-header.ts`、`policy/index.ts`、`policy/display.ts`、`plugin.ts` | 盘点表里 G2 键的 ext 读方全部改读文档;函数的 `env` 参数换成文档字段参数作测试接缝,默认取 `codepuppyBootstrap()`。 |
| `packages/plugin/src/alpha-cloud-authority.ts` | 读法改为 `tryCodePuppyBootstrap()?.cloudMcp`(§4.3);删环境变量名常量。 |
| `packages/core/src/mcp/client.ts` | `:374-375` 在既有 `codepuppy(#1562)` 块内改传文档的云 MCP 定义。盘点里的基线后新增调用点,设计 §4.3 的调用点清单未列,按同一条规则(改动只在既有标注块内)处理。 |
| `packages/schema/src/codepuppy-net-failure.ts` | `engineNetFailurePath(target, env, egressProxy?)`(§4.3 表第 5 行);删标记常量。 |
| `packages/core/src/session/to-session-error.ts`、`packages/core/src/mcp/codepuppy-startup.ts` | 调用方传 `tryCodePuppyBootstrap()?.network.egressProxy`;前者在既有 `codepuppy(#1572)` 块内。 |
| `docs/architecture/codepuppy-authority-registry.json` | `tool-policy-partitions`、`l1r-output-caps` 的机制文字与测试名改写。 |
| 测试:`server.test.ts`(web search 主权两组改断言文档 `webSearch.killSwitch`)、`sidecar-env.test.ts`、`codepuppy-config-injection.test.ts`、`codepuppy-models.test.ts`、`codepuppy-sidecar-wiring.test.ts`(`#1575` 一条)、ext `cloud-websearch-kill.test.ts`、`cloud-vision.test.ts`、`platform-credential-header` / `cloud-access` 相关测试、`policy/resolver.test.ts`(VI1)、plugin `alpha-cloud-authority` 测试、schema / core 网络失败测试、`test-component/codepuppy-engine.ts`、`websearch-account-tool-table.engine.cases.ts`、`cloud-credential-hot.engine.cases.ts`、`token-hot-apply.engine.cases.ts`、`platform-credential-error.engine.cases.ts`、`bootstrap-launch-parity.engine.cases.ts`(期望不改)、`bootstrap-env-readers.test.ts`(加 G2 键)、`scripts/gate-files.tsv` | 断言旧通道的用例改断言文档;新增 URL 拒绝与日志行用例。 |
| `packages/ui-mac/src/main/codepuppy-config-injection.ts`、`packages/ext/src/provider-allow.ts`(及其调用方 `plugin.ts:243,403`) | design §10 R30:注入算出放行集合后按 C10 的形状(`in-process-engine.ts:15-24`)在本进程发布一份冻结的集合,ext 读它;删掉 `CODEPUPPY_PROVIDER_ALLOW` 的写入(`:329-330,673`)与常量;登记册 `provider-allowlist` 改握法文字;`bootstrap-env-readers.test.ts` ① 加这个名字。 |

**原 BLOCKED 项的选项**(已由 design §10 R30 裁为 (a),留作记录;事实:值由 sidecar 注入从治理策略算出,不是 main 的决定;启动文档由 main 构建、在注入之前发布、一代不变;今天它和 C7 一样会被引擎派生的子进程继承,进程内代码也能改;登记册 `provider-allowlist` 以它为握法):
- (a) 由 sidecar 注入在算出放行集合后,按 C10 的形状(`in-process-engine.ts:15-24`)在本进程发布一份冻结的放行集合,ext 读它;不进环境。代价:多一个进程内交接点(与 C10 同形)。
- (b) 视为 sidecar 内部值,不属于「main 交给引擎的决定」,保留环境写法,在 design §10 记一行范围说明。代价:C7 的两个缺点(子进程继承、进程内可改)对这一项留着;它是 S5 测不到的 fork 之后写入。
- (c) 由 main 算放行集合并写进启动文档。代价:要在 main 跑一遍模型配置计算,与注入形成两处计算,或把注入的这一半搬到 main(§6 被否决的替代 3 同类)。
- 推荐 (a):与设计删 C7 的理由一致,改动只在注入一处写、ext 一处读,登记册条目只改握法文字。未核实前提:ext 在每个 Location 重新求值时读得到同一份进程级对象(C10 今天就这样用,P-02)。

### 顺序
1. 一个提交(G2 键组,含裁决后的那一项)。相关测试:上表各测试;`packages/{util,ui-mac,ext,plugin,schema,core}` 各自 `bun typecheck`;`bash scripts/north-star-guard.sh`;`src/main/old-name-scan.test.ts`。

### 风险
- 体量与段 1 同级(约 35–40 个文件),原因相同(一个键组一个提交边界)。
- `#621` / `#1411` 两组 server.test 用例断言的是 DENY 环境通道本身,按 implement-rules「断言专门编码被替换的旧行为」改写为断言文档;判决的行为面由 `websearch-account-tool-table.engine.cases.ts`(真引擎工具表)守,不改其期望。
- 无凭据 URL 判定是 owner 可见变化第 5 条;本仓与平台下发的地址都没有查询串与片段,段 0 记录第 ⑤ 格判它不误伤。

### 证明
| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01 · R5 密钥写不进 | `codepuppy-bootstrap.test.ts`:`credentialRef` / `Authorization` 放字面令牌 ⇒ `invalid`;URL 带 userinfo / 查询串 / 片段 / 非 https 远端 ⇒ 判定为假;构建器测试:不合格 URL ⇒ 字段省略、日志只有变量名 | 去掉 `{file:}` 形状检查或查询串检查 ⇒ 对应用例红。 |
| AC-02 · §4.5 与无遗漏读者 | `server.test.ts` §4.5 用例(例外删 G2 键);`bootstrap-env-readers.test.ts` ① 加 `PLATFORM_AUTH_REF`、`CLOUD_MCP_SERVER/DEF/ARM`、两个 DENY、`POLICY_ACCOUNT`、`EGRESS_PROXY`,② 加 `BASE_URL`、`CLOUD_MCP_URL`、`DEFAULT_MODEL`、`WEBSEARCH_DISABLE` | 留着 `client.ts:375` 传 `process.env` 的路径或任何旧常量 ⇒ ① 红;EXACT 加回任一 G2 键 ⇒ §4.5 用例红。 |
| AC-04 · 决定不变 | 段 0 记录(期望不改);`websearch-account-tool-table.engine.test.ts` 三种账户态期望不改 | 构建器漏写 `policy.account` ⇒ 记录第 ④ 格变成 `anonymous` 而红;漏写 `cloudMcp` ⇒ 第 ⑤ 格无云 MCP 而红。 |

### 偏离记录
- 2026-11-12 · `buildCodePuppyModelConfig(userDataPath, platform: PlatformInputs = {})`:平台地址与默认模型覆盖改为参数,模块不再读环境。注入传文档的 `platform.modelProxyBaseURL` / `defaultModelOverride`;main 的出网目的地派生(`server.ts`)照旧传 main 自己环境里的值(main 一侧,语义不变)· 本段提交。
- 2026-11-12 · 没有文档时的注入(只剩直接调注入、不发布文档的测试)按「未登录、无云 MCP、kill-switch 关」走,与段 1 的环境回退同一处理;生产里 sidecar 在注入之前发布,到不了这一支 · 本段提交。
- 2026-11-12 · 测试夹具加 `publishMainBootstrap()`:用生产构建器从 `process.env`(单进程测试里它就是 main 的环境)造文档并发布,G2 各键的判法只在构建器一处;`unpublishTestBootstrap()` 同时撤掉注入发布的供应商白名单(R30),不留给同进程的其它文件 · 本段提交。
- 2026-11-12 · 两个 web search 判决合成一个字段后,只能在环境里出现的状态没有了:ext `cloud-websearch-kill.test.ts` 的「LOCAL_DENY_ONLY 漂移」用例改为按拒绝理由的文字区分;「DEF 写坏」用例改为解析器拒绝(util);`server.test.ts` `#621` 组的「turning the kill switch back off clears the cloud verdict」删除(与本地腿那条成了同一断言;本文件不在 gate-files);`websearch-copies.test.ts` 的「DEF 在代付两条分支都置位,ARM 只在 kill-switch 分支置位」退役(换成构建器、server.test 与 util `cloudMcpArmed` 三条行为判据),「信道名逐字一致」改判两条腿读同一个 `killSwitch` 与唯一核验源;`sidecar-env.test.ts` 的「逃生阀放行握手三变量」反过来判「逃生阀点名也进不来」· 本段提交。
- 2026-11-12 · 原表之外改动的测试(都因为按旧通道搭环境或造文档):`codepuppy-behavior.test.ts`、`config-injection-throat.test.ts`、`websearch-prompt-tool-parity.test.ts`、`cloud-mcp-header.test.ts`、`mcp-server-derivation.test.ts`、`models-catalog-v2.wiring.cases.ts`、`codepuppy-reasoning-badge-parity.test.ts`(不改会静默丢掉平台节点)、`custom-provider-derivation.engine.cases.ts`(放行集合改用进程内发布)、`codepuppy-config-injection-engine.cases.ts`(三条登录态用例发布带地址的文档,每条用例开头撤掉上一条的)、`net-failure-real-stack.test.ts`(构建器拿出网代理端口与平台地址)、`sidecar-bootstrap-gate.test.ts` 与 core `codepuppy-mcp-runtime.test.ts`(文档必带 G2 字段)、ext `platform-output-cap.test.ts`(标题去掉旧变量名)· 本段提交。
- 2026-11-12 · 登记:`authority-registry.json` 除表里两条外,`VI1`、`adr035-websearch` 的测试名与 `provider-allowlist` 的握法和测试名随改写;`source-text-anchors.ts` 的 `websearch-copies` 9 → 6 行;`gate-files.tsv` 的 `websearch-copies` 9 → 8、`codepuppy-bootstrap-build` 4 → 9,`sidecar-env`、`bootstrap-env-readers`、`provider-allow`、`cloud-mcp-header` 条数不变、说明补 `#1698`;ext 与 ui-mac 生产代码里点名旧变量的注释改成文档字段(其中 5 个文件只改注释)· 本段提交。
- 2026-11-12 · 体量:79 个文件(生产 28,其中只改注释 5;测试与夹具 48;登记 3),外加本文件;高于计划估的 35–40,多出来的是上面那批按旧通道搭环境的测试 · 本段提交。

## 段 3 — G3 开关与引擎设置

- 依据:design @ `c01ea14919` §4.1(G3 字段与 `codepuppyEngineSettings`)、§4.3 表第 1、2 行与兼容入口的范围、§4.4 全表(含「导出为 `""`」一列)、§4.5 最终形态、§9 G3 与回滚、§10 R6、R7、R9、R13、R16;登记册 `adr038-ask-deadline`、`project-file-change-events`;Issue AC-01、AC-02、AC-04。
- 核对:`f3fd81e14f` · 编排器(Claude Fable 5.2)· 通过;裁决 R30–R32 入 design §10 @ `7b3baf25e5`(R30 = 段 2 BLOCKED 项选 (a);R31 = 回退顺序「快照 → 已发布文档 → 环境」,生产启动里环境分支不可达,由段 0 的决定记录断言;R32 = P-13 反向臂在不装 ext 的真引擎上判,G4 可分 4a / 4b / 4c);35–40 文件的段体量按 §9 接受。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/util/src/codepuppy-bootstrap.ts`、`.test.ts` | 加 `switches`、`engine`、`permission`、`skills` 与兼容入口;兼容入口无文档分支逐字是今天 `permission.ts:102-105`、`codepuppy-project-watch.ts:17-18` 的判法。 |
| `packages/ui-mac/src/main/codepuppy-bootstrap-build.ts`、`.test.ts` | G3 字段按 §4.4 表(两个引擎开关直接调 `engineDesktopToggles`;空串语义按键保留);`skills.factoryDirs` 取 boot 时出厂技能对账的结果。 |
| `packages/ui-mac/src/main/index.ts` | 不再写 `CODEPUPPY_FACTORY_SKILL_DIRS`(`:855`)与 `_FACTORY_DENY_SKILLS`(`:858`);出厂技能对账结果交给构建器。 |
| `packages/ui-mac/src/main/sidecar.ts`、`sidecar-env.ts` | `:170` 的开关改读文档;例外名单只剩 `CODEPUPPY_ENV_ALLOWLIST_EXTRA`,EXACT 删剩下的 `CODEPUPPY_*`(§4.5 最终形态)。 |
| `packages/ui-mac/src/main/codepuppy-config-injection.ts`、`codepuppy-models.ts` | 盘点表里 G3 键的读取(`:113,174,247-248,341,353,390,461`、`codepuppy-models.ts:130`)改读文档。 |
| `packages/ext/src/factory-deny.ts`、`packages/ui-mac/src/main/codepuppy-builtin-policy.ts` | 出厂禁用名单成为 ext 持有的常量,main import 它(R7);删掉环境缺席即放开的分支。 |
| `packages/ext/src/plugin.ts`、`external-directory-rule.ts` | `EXT_VERBOSE`、`PROMPT_REBRAND_DISABLE`、出厂禁用、出厂技能目录改读文档 / 常量。 |
| `packages/core/src/permission.ts` | 既有 `codepuppy(ADR-038)` 块内改用兼容入口。 |
| `packages/core/src/filesystem/codepuppy-project-watch.ts` | 改用兼容入口;`location-watcher.ts:83` 的调用不动。 |
| `docs/architecture/codepuppy-authority-registry.json` | `adr038-ask-deadline`、`project-file-change-events` 的握法文字与测试名改写。 |
| 测试:`permission-ask-timeout.engine.cases.ts`、core `permission` 与项目监听相关测试、`engine-server-options.test.ts`、`codepuppy-config-injection.test.ts`、`codepuppy-builtin-policy.test.ts`、`factory-skills.test.ts`、ext `factory-deny` 与 `plugin-host.test.ts`、`test-component/codepuppy-engine.ts`、`server.test.ts`(§4.5 最终形态)、`bootstrap-env-readers.test.ts`(加 G3 键)、`bootstrap-launch-parity.engine.cases.ts`(期望不改)、`scripts/gate-files.tsv` | 见证明表。 |

### 顺序
1. 一个提交(G3 键组)。相关测试:上表各测试;`packages/{util,ui-mac,ext,core}` 各自 `bun typecheck`;`bash scripts/north-star-guard.sh`;`src/main/old-name-scan.test.ts`。
2. 段 1–3 同一个 PR 进 `alpha`(§9);PR 描述附回滚证明(下表最后两行)的命令与输出。

### 风险
- R6 让 P-06 那五个开关开始生效,是有意的变化:它们不进段 0 记录,另由下表的专门用例判。
- R9 改变 `OPENCODE_EXPERIMENTAL_FILEWATCHER=yes/on` 时项目监听的结果(owner 可见变化第 4 条);兼容入口在无文档宿主里保留今天的判法,两种宿主各一条用例。

### 证明
| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01 · §4.4 表 | `codepuppy-bootstrap-build.test.ts` 逐行:每个开关未设 / `""` / 置位三种取值 ⇒ 字段值;`OPENCODE_DISABLE_MODELS_FETCH=""` ⇒ 拉取开、`OPENCODE_EXPERIMENTAL_FILEWATCHER=""` ⇒ 监听关、`CODEPUPPY_DEFAULT_MODEL=""` ⇒ 字段为 `""`;`CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS` 不合法 ⇒ 省略 | 把空串统一当缺席 ⇒ 三条空串用例红。 |
| AC-01 · R13 兼容入口 | util 测试:无文档时两项按今天的环境判法(含 `yes` / `on`);有文档时环境值被忽略 | 去掉无文档分支 ⇒ 仓内 CLI 宿主那条红;有文档时仍读环境 ⇒ 后一条红。 |
| AC-01 · R6 五个开关生效 | `permission-ask-timeout.engine.cases.ts` 加一条经构建器 → 文档的期限;注入测试:`switches.ecosystemInherit` / `automationDisabled` / `readonlyDisabled` 各改变注入结果;ext:`switches.extVerbose` ⇒ 库存日志出现 | 构建器不写这些字段 ⇒ 对应用例按默认值走而红。 |
| AC-01 · R7 | ext `factory-deny` 测试:不依赖任何环境,禁用名单恒含 `customize-opencode`;main 与 ext 同一常量 | 加回「环境缺席 ⇒ []」分支 ⇒ 红。 |
| AC-02 · §4.5 最终形态 | `server.test.ts` §4.5 用例:§2.2 全部旧键导出并全部写进 EXTRA,交给 fork 的环境里 `CODEPUPPY_*` 只剩 `CODEPUPPY_ENV_ALLOWLIST_EXTRA` | 去掉前缀拒绝 / 排在 EXTRA 之后 / EXACT 加回任一键 ⇒ 红。 |
| AC-02 · 无遗漏读者(最终) | `bootstrap-env-readers.test.ts`:① 加 `FACTORY_SKILL_DIRS`、`FACTORY_DENY_SKILLS`(此后 ① 共 12 个,另加裁决后的 `PROVIDER_ALLOW` 若归 ①);② 加全部开关,例外只剩兼容入口里的 `CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS` 与段 1 风险第 2 条那一处 | 任一读方漏改 ⇒ 红。 |
| AC-04 · 决定不变 | 段 0 记录(期望不改) | 构建器两个引擎开关取反 ⇒ 第 ② 格红。 |
| §9 回滚 · 决定可还原 | 段 0 的 cases 期望字面量在段 0 提交(改动前代码)与段 3 提交(改动后代码)上同为绿;回滚 = revert 段 1–3,代码即回到段 0 那一份 | 改动后若任一决定变了,同一字面量在段 3 上红,回滚就不是「原样回来」。 |
| §9 回滚 · 无数据后果 | 段 0 记录第 ⑦ 格(C4 显式文件、C5 模型底表、密钥文件名集合)两端逐字相同;启动文档不落盘(构建器与 sidecar 不新增写盘点:`process-fence-write-sites.test.ts` 的登记簿本段不变) | 若迁移改变了磁盘形状,第 ⑦ 格红;若新增写盘,写盘登记簿闸红。 |

### 偏离记录
暂无

## 段 4 — G4 Code Puppy 自有的引擎全局配置目录(单独一个 PR)

- 依据:design @ `c01ea14919` §4.1 末段(v2)、§4.7 全节、§5 G4 失败表、§6 G4 各行与「架构约束」G4 例外、§9 G4、G4 回滚与证明义务 1–9、§10 R11、R17–R29;owner 原话见 design「批准记录」与 Issue 来源(U-07、U-09);Issue AC-03、AC-04。依赖段 1–3 已在 `alpha`。
- 核对:`f3fd81e14f` · 编排器(Claude Fable 5.2)· 通过;裁决 R30–R32 入 design §10 @ `7b3baf25e5`(R30 = 段 2 BLOCKED 项选 (a);R31 = 回退顺序「快照 → 已发布文档 → 环境」,生产启动里环境分支不可达,由段 0 的决定记录断言;R32 = P-13 反向臂在不装 ext 的真引擎上判,G4 可分 4a / 4b / 4c);35–40 文件的段体量按 §9 接受。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/core/src/config/codepuppy-document-check.ts`(新) | `checkEngineConfigDocument`(§4.7「能装载」)。 |
| `packages/ext/src/upstream-probes/config.test.ts` | 新探针:同一组夹具上它的结论与真引擎是否装载逐一相同(R28);P3 / P5 锚点移到出厂层写入处(§9 G4)。 |
| `packages/core/src/config/codepuppy-isolation.ts`(新)、`packages/core/src/config/discovery.ts`、`packages/core/src/config.ts` | 隔离判定(§4.7「隔离」第 2、3 行);两处接管各加一个 `codepuppy(...)` 块,`config.ts` 只在 `load` 返回前过滤。 |
| `scripts/north-star-guard.sh`、`.claude/rules/adrs/ADR-047-opencode2-engine-generation.md`、`docs/architecture/codepuppy-authority-registry.json`、`docs/architecture/constraints.md` | 两条 `UPSTREAM_EXCLUDES`;「精确接管面」两行与计数;登记册新条目「Code Puppy 引擎的配置层里没有独立 OpenCode 的内容」(带反向臂测试名);`checkEngineConfigDocument` 记为 K2 已知偏离(§6)。 |
| `packages/ui-mac/src/main/engine-paths.ts` | 两个目录函数与四个常量(§4.7「唯一推导处」)。 |
| `server.ts`、`mcp-default-deny.ts`、`ext-config.ts`、`ext-fs-installer.ts`、`codepuppy-migrate.ts`、`engine-config-truth-boot.ts`、`engine-config-dangling.ts`(均在 `packages/ui-mac/src/main/`) | P-16 六处按 §4.7 的表改调;REQ-059 独立目录那一半退役。 |
| `packages/util/src/codepuppy-bootstrap.ts`、`packages/ui-mac/src/main/codepuppy-bootstrap-build.ts` | v2:`paths.standaloneConfigDirectory`,`engineConfigDirectory` 换成新目录。 |
| `packages/ui-mac/engine/engine-embed.ts` | 外层 `Global` 用同一配置根(R17)。 |
| `packages/ui-mac/src/main/engine-global-import.ts`(新)、`packages/ui-mac/src/main/index.ts` | 首次切换导入(允许清单、解析后复制实体、引用迁移、暂存 → 两次改名、记录);在 REQ-059 对账同一处、第一次 fork 之前调用。 |
| `packages/ui-mac/src/main/engine-explicit-config.ts`、`codepuppy-config-injection.ts`、`sidecar.ts` | 出厂层文件取代合成文件;监听改为重写出厂层与维护最后一份可用副本;`config.file` 给副本或不给;首次 G4 启动删旧合成文件(R19)。 |
| `packages/ui-mac/src/main/ext-config.ts`、`packages/ui-mac/src/renderer/codepuppy-ui/config-broken-banner.tsx` | 配置健康检查改目标与判法、横幅原因文字(§4.7「其它随之而定的」、R23)。 |
| `packages/ui-mac/scripts/process-fence-write-sites.tsv` | sidecar 新写盘点(出厂层文件、副本)登记到 W2;围栏 profile 不变。 |
| 测试:`engine-explicit-config.test.ts`、`ext-config.test.ts`、`engine-config-truth-boot.test.ts`、`engine-config-dangling.test.ts`、`codepuppy-migrate` 相关测试、`ext-fs-installer.test.ts`、`codepuppy-bootstrap*.test.ts`,以及下表的新 cases;`scripts/gate-files.tsv` | 见证明表。 |

### 顺序
1. 提交 4a(行为中性):`codepuppy-document-check.ts` + 上游探针。相关测试:`packages/ext` 的 `src/upstream-probes/config.test.ts`;`packages/core` 新文件单测与 `bun typecheck`。
2. 提交 4b(行为中性):`codepuppy-isolation.ts` 与 `engine-global-import.ts` 的纯逻辑及其单测,不接进任何生产路径。
3. 提交 4c(切换):§9 G4「一个提交边界」列的全部行为变化一起落 —— 六处改调、外层 `Global`、两处接管与登记、导入接进启动、出厂层取代合成、副本、REQ-059 退役、健康检查、v2、探针锚点 —— 以及证明义务 1–9 的测试。相关测试:下表全部;`packages/{core,util,ui-mac,ext}` 各自 `bun typecheck`;`bash scripts/north-star-guard.sh`;`src/main/process-fence-write-sites.test.ts`、`src/main/old-name-scan.test.ts`。
4. 4a / 4b 只加不被任何生产路径调用的新文件,不产生「切了一半」的状态;若编排器按 §9 要求 G4 只有一个提交,三个合并为一个,内容不变。

### 风险
1. **体量**:约 40 个文件、上千行,是本计划最大的一段;§9 定为一个提交边界 / 一个 PR,上面 4a / 4b 是唯一的拆法。
2. **设计事实已过时(P-13)**:设计写「今天独立全局策略压得过白名单」,但 #1662 已加 ext 的供应商白名单(登记册 `provider-allowlist`):装着 ext 时,白名单外的服务无论配置层如何都「不可用」,义务 1 的两条反向臂(`config.directory` 指回夹具、撤掉 integrated / wellknown 过滤 ⇒ 变可用)红不了。计划改为:义务 1 的「模型服务」那几臂在**不装 ext** 的真引擎上判(S6 说的是引擎的配置层),命令、插件、项目别名那几臂照常带 ext 判。段 2 BLOCKED 项若裁成 (a),不影响这一处。
3. 导入夹具全部在 I-08 预载的临时根里(P-18);义务 7 的守卫先证明「独立目录原本不存在则仍不存在」再跑其余用例,不读 owner 真实的 `~/.config/opencode`。
4. 横幅文字改动是设计 §4.7 / R23 写定的原因文字,沿用现有组件与样式,不新画界面。

### 证明
| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-03 · 义务 1 | `engine-global-isolation.engine.cases.ts`(新,宿主 `.test.ts`):真引擎、临时 HOME / XDG;独立目录夹具含 `policies` 放行 `*`、`enabled_providers`、`plugin`、`commands.init`、`plugin/`、`command/init.md`;项目 `.opencode` 软链到夹具;共享库里一条 well-known 来源及缓存配置(放行 `*`)⇒ 白名单外服务不可用(无 ext)、`/init` 是出厂模板、夹具插件未装载,项目里也一样 | 反向臂各一条:`config.directory` 指回夹具 ⇒ 白名单外服务可用;撤掉项目发现排除 ⇒ 项目里 `/init` 变成夹具的;撤掉 integrated / wellknown 过滤 ⇒ 白名单外服务可用。 |
| AC-03 · 义务 2 | `engine-global-import.test.ts`(新):旧键与清单外的键不进导入文件、逐条进记录;来源内软链目录里的 `init.md` 不复制;来源外软链记为 `link-outside-source` | 改用原始键黑名单 ⇒ 导入后(真引擎)白名单外服务可用;改为保留软链 ⇒ `/init` 被覆盖。 |
| AC-03 · 义务 3 | 同上 cases 加一条:`AGENTS.md`、agent、命令、技能、相对 / 来源内绝对引用、`{file:./x}` / `{file:../y}` ⇒ 导入后真引擎列表里都有;来源设只读并在导入后改名,引擎照常 | 去掉复制步骤 ⇒ 改名后列表缺项而红。 |
| AC-03 · 义务 4 | `engine-global-import.test.ts`:发布第 N 步注入失败 ⇒ 目录是导入前的、无记录,下次完整导入;两次改名之间中断 ⇒ 下次改回并完成;切换后用户写进 `engine-global/` 的文件在重试中保留 | 逐项改名或不先建暂存 ⇒ 中途状态可见而红。 |
| AC-03 · 义务 5 | `engine-explicit-config.test.ts` + 真引擎一条:`codepuppy.jsonc` 含 `tool.use` 拒绝,运行中写坏 ⇒ 仍被拒、横幅显示;修好 ⇒ 副本更新;启动时已坏而副本在 ⇒ 用副本 | 副本闸门放行坏文档 ⇒ 工具变可用而红。 |
| AC-03 · 义务 6 | `ext-config.test.ts` + 4a 的上游探针:合法 `policies` / `agents` 不报横幅,根为 `[]` 报;探针与真引擎逐例一致 | 换回 v1 键表 ⇒ 前两条红;上游判法一改 ⇒ 探针红。 |
| AC-03 · 义务 7 | 义务 1 的 cases 内守卫:导入来源与引擎配置目录都在预载临时根内;G4 启动后原本不存在的独立目录仍不存在 | 外层 `Global` 仍按环境取根 ⇒ 独立目录被 mkdir 而红;撤掉预载对 HOME 的改写 ⇒ 守卫红。 |
| AC-03 · 义务 8 | `engine-global-import.test.ts`:第二次启动不导入;来源导入前后逐字节相同 | 不看记录 ⇒ 第二次重复导入而红。 |
| AC-03 · 义务 9 | `ext-config.test.ts` / `ext-fs-installer.test.ts`:逃生阀安装写进导入文件,出厂层重写后仍在 | 写进出厂层 ⇒ 被重写抹掉而红。 |
| AC-04 · 围栏与权限不变 | 写盘登记簿新增行只落 W2;`process-fence-profile.test.ts` 不改;段 0 记录第 ① ③ 格在 G4 后不变(第 ② 格的配置目录按 R17 有意改变,在本段改期望并注明) | 新写盘点落在 W2 之外 ⇒ 登记簿闸红;档位权限变了 ⇒ 第 ③ 格红。 |
| §9 G4 回滚 | 再应用:义务 8 的用例(记录在 ⇒ 不重复导入,`engine-global/` 里用户的文件在)。回退:一次性演练 —— 临时 worktree(放在本工作树已忽略的构建目录下)检出 G4 PR 的父提交,用 4c 测试产出的状态目录起一次 sidecar 注入:合成显式文件重新生成、引擎配置目录回到独立目录、`engine-global/` 与 `codepuppy.engine.jsonc` 原样未删;命令与输出写进 PR 描述 | 回退后的代码若读或删 `engine-global/`,演练里这两项检查失败。 |

### 偏离记录
暂无
