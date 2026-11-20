---
id: PLAN-engine-config-fence
title: 对话改不了决定程序、放行与凭据去向的引擎配置 实施计划
summary: 片 ②——受保护配置集(CF-1–8、CF-10)渲染进围栏 profile 末尾，运行期放行的解析与覆盖判定认得拒写块，资格判定拦受保护位置之内并给一句说明，原来在围栏内写这些位置的写者(显式文件、模型底表、种子、监听)移到主进程；文件、提交顺序、风险与各 AC 的正反验据。
kind: plan
status: active
spec: SPEC-engine-config-fence
design: DESIGN-engine-config-fence
owners: [owner]
last_reviewed: 2026-11-20
---

# PLAN-engine-config-fence｜对话改不了决定程序、放行与凭据去向的引擎配置 实施计划

## 片 ②：受保护配置集与认得它的运行期放行，围栏内写者移到主进程

- 依据：规格 `docs/specs/engine-config-fence/spec.md` v1(owner 2026-11-20「两份都批准」)的 BR-01、BR-03(不含工具策略)、BR-04、BR-05，AC-01、AC-02、AC-04(不含工具策略)、AC-05 第一句、AC-06，以及「用户会碰到的限制」第二条那句说明；冻结设计 `docs/specs/engine-config-fence/design.md` @ `3f36883278`(approved，两轮审查)的 §1 (a)(c)、§2、§4.1 CF-1–8 与 CF-10、§4.2、§4.3、§4.4、§4.7、§5、§6 的 I1/I2/I4/I5 与 E1、E2、E3(无 A3)、E5、E7、E8、E9，§10 D2/D3/D5/D6/D11/D12 ②/D14；意图 impharaon/alpha-work `docs/intents/INT-safety.md` I-13。两份文件另行合入主线，本分支不复制，所以下文按路径@提交引用，不建链接。读码基线 `bd206c6bca`(`origin/alpha` `887748b52c` + 片 ⓪)。不在本片：CF-9、W16 与计划目录(片 ④)，CF-11 与工具策略写消息(片 ③)，L1–L3(片 ①)。
- 核对：Phase: IMPLEMENT — plan `5c1525b1a9` · 编排器 / Claude Fable 5.2 · 通过(对 SPEC v1 与冻结设计核对；D-1…D-6 全部接受，D-6 附条件：启动文档内容与计划出的 profile 对任何输入都不变，既有一致性记录不重采；按单元 A → B+C 两次审查点推进)。

路径前缀 `main/` = `packages/ui-mac/src/main/`，`ui/` = `packages/ui-mac/src/renderer/codepuppy-ui/`，`i18n/` = `packages/ui-mac/src/renderer/i18n/`。PLAN 阶段只提交本文件；下列命令都是实施安排，尚未运行。约定沿用 [child-process-write-fence 的计划](../child-process-write-fence/plan.md)：先提交红测试再提交实现，宿主 `*.test.ts` 起同名 `.cases.ts`，`.cases.ts` 不单独执行。

### 改动

**生产代码**

| 文件 | 改什么 |
| --- | --- |
| `main/process-fence-profile.ts` | ① `ConfigFenceRule` 与 `ProcessFenceProfileInput.configFence`(§4.2 的形状，必填；列表为空时两块都不渲染，生产计划器恒给非空)。② 纯函数 `configFenceLocations({ userDataPath, appStateRoot, codepuppyGlobalRoot, engineConfigDirectory, configHome, home })` 给出 CF-1–8、CF-10 的原始位置；名字取 `USER_DATA_LAYOUT`、`SETTINGS_STORE` 与新常量 `UPDATER_STORE`，`*.dat` 一类是 `dat-files`；两个配置目录相同只列一份。③ 两块渲染在 N4 之后，上级目录块按每条规则的锚点逐级去重(§4.2)。④ 删 W2、W6 两行及 `WRITABLE_ROOT_IDS` 两项，文件头注释同步。⑤ `processFenceWriteRules` 返回 `{ allow, deny }`，文法照 §4.2；另外第一个拒写块之后再出现任何 `(allow file-write*`(含 X1 行)、空拒写块，都按「其余含 `file-write` 的写法」抛。⑥ `processFenceRulesCover` 收 `{ allow, deny }`，判据照 §4.2。⑦ `WorkspaceUnionInput` 与由它 Pick 出的 `WorkspaceDirectoryInput` 加必填 `configFenceRoots`(§4.3)；`checkWorkspaceDirectory` 在既有 HOME、应用状态根两种关系之后加「与某个 CF 目录根是同一对象或在其内」(dev+ino 沿祖先链，与状态根「在内」同一判法；根不在盘上跳过)，返回新原因 `protected-config`(差异 D-1)。既有关系与先后不变。 |
| `main/process-fence-plan.ts` | 输入加 `engineConfigDirectory`(§4.3)。新导出 `planConfigFence(input, { realpath, mkdirp })`：取 `configFenceLocations`，目录位置先 `mkdirp`(并入既有预建循环，从不建 `~/.opencode`)，每个位置写成「`realpath(父目录)` + 名字」，位置存在且 `realpath` 解析到别处时再加真实目标；环境根的真实路径落在状态根真实路径之内时不另列(§4.1 CF-1)；`realpath` 报 `ENOENT` = 位置不存在，其它错误照常抛(既有「计划失败 ⇒ 拒 fork」)。`planProcessFence` 用它的结果渲染，把 `configFenceRoots`(全部 subpath 规则的路径，含真实目标)交给并集选择并放进 `ProcessFencePlan`，planned 日志加 CF 条数。手渲染 profile 的测试夹具也调 `planConfigFence`，不手写 CF。 |
| `main/server.ts` | ① `buildCodePuppyBootstrap` 那段整体提到计划围栏之前(它不依赖计划)。② 紧接着调 `writeEngineConfigForFork(bootstrap)`(见下一行)；抛 ⇒ `[I-13] engine config files could not be written — refusing to fork: <message>` 并抛，与密钥同步、目录钉选同一条拒 fork 路径；返回的用户文件解析问题照旧记 `[alpha-code#1667] … is not valid …`。③ 写完立即用它返回的输入起 `watchExplicitSources`(log 进 main 日志)；本代子进程 `exit` 时停；模块级记住当前这份，下一次 spawn 开始先停上一份(盖住 fork 前失败)。④ `ProductionFenceInput` 加 `engineConfigDirectory = engineGlobalConfigDirectory(exported.env, exported.home)`(与启动文档同一个值)，`planProductionFence` 交给计划器；`PlannedFence` 加可选 `configFenceRoots`。⑤ 模块级记住最近一次计划的 `configFenceRoots`，导出 `currentConfigFenceRoots()`；本运行尚未计划时用同一纯函数按主进程环境现算(`app.getPath("userData")`、冻结环境的 `casBaseRoot`、`codepuppyGlobalRoot()`、`engineGlobalConfigDirectory(process.env, homedir())`)；非 darwin 为空。⑥ `writeRules` 换成 `ProcessFenceWriteRules`，`generationWrites` 传 `{ allow: [...writeRules.allow, ...本代已放行 / 放行中目录], deny: writeRules.deny }`；解析失败的既有处理不变。 |
| `main/engine-explicit-config.ts` | 新增冻结的 `engineModelsPath`、`EngineConfigFiles`、`writeEngineConfigFiles`(§4.4；先种子，再显式文件，再写或删 `models.json`；IO 错误原样抛，Node 的错误消息带路径与 errno、不含内容)。`governedModelsBase`(连同两个投影类型)、`explicitSkillDirs`、`PROJECT_SKILLS_ENTRY` 从注入模块原样搬来(差异 D-3)，`explicitSkillDirs` 改为显式收 `(factoryDirs, root)`。新私有函数 `writeEngineConfigForFork(bootstrap)`：按 §4.4 从启动文档算 `models` 与 layer，调 `writeEngineConfigFiles`，返回 `{ files, watch }`(`watch` = `watchExplicitSources` 除 `log` 外的输入)。`server.ts` 与测试宿主共用它，这套算法只有一处。 |
| `main/codepuppy-config-injection.ts` | 删种子写入(只留 `file = userConfig`)、`materializeGovernedModelsBase`、`writeExplicitConfig` 调用、layer 计算与结果里的 `explicit`；`config.file = explicitConfigPath(userData)`，`models.file = existsSync(engineModelsPath(userData)) ? 该路径 : 缺席`(§4.4)。注入失败分支照旧把用户文件给显式槽。去掉随之不用的 import。 |
| `main/sidecar.ts` | 删 `:171` 起监听那一行与它的两个 import。 |
| `main/process-fence-workspaces.ts` | `:238` 传 `{ allow: <别的代带来的目录>, deny: [] }`；`WorkspaceEligibility` 联合与 `:348`、`:369`、`:377` 三处原因映射透传 `protected-config`(收成一个小函数)。 |
| `main/workspace-write-probe.ts` | `WorkspaceOpenRecordResult.reason`、`WorkspaceWriteProbeResult.reason` 两个联合加 `protected-config`。`ipc.ts:105`、`preload/types.ts:105` 原样透传同一类型，不改。 |
| `main/index.ts` | `:979` 的 eligibility 加 `configFenceRoots: currentConfigFenceRoots`(设计 §6 落点表已点名)。 |
| `main/store-keys.ts`、`main/updater.ts` | 新常量 `UPDATER_STORE = "opencode.updater"`，`updater.ts:72` 改用它(差异 D-4)。 |
| `ui/workspace-writable.ts` | `workspaceReadonlyMessage` 加 `protected-config` → 新键。显示处只有 `ui/session-workspace/session-workspace-shell.tsx:194` 与 `ui/workspace-chip.tsx:79`，都原样传原因，不改。 |
| `i18n/zh.ts`、`i18n/en.ts` | 新键 `codepuppy.workspace.readonlyProtectedConfig`。zh 逐字取规格：「这个文件夹是 Code Puppy 或引擎存放配置的位置，对话里不能写入。」en 按同组三句的写法译作 "This folder is where Code Puppy or the engine keeps its configuration, so conversations can't write to it."。只有这两个语言有那三句。 |
| `scripts/process-fence-write-sites.tsv` | 注入模块的种子、模型底表各行随代码消失；`engine-explicit-config.ts` 各行(含新增的写种子、写 / 删模型底表)根改 `main-only`；`codepuppy-installs.ts`、`ext-receipt-v2.ts` 的 W2 行改 `main-only`(§4.7)。`packages/ext/src/policy/store.ts` 四行不动(片 ③)。签名用 `bun packages/ui-mac/scripts/process-fence-write-sites.ts --write` 重生，根人工填。 |
| `docs/architecture/2026-09-09-req159-process-fence.md` | 事实同步：可写行列表删 W2、W6；加 CF 两块(位置、按真实路径与软链目标渲染、放在最后)、运行期放行认得拒写块、写者在主进程；`:95`、`:132` 两处「W2 只放行 env/<env>」改写；测试表加新宿主、改 W2 控制臂的描述。其它历史设计文件不改。 |
| `scripts/gate-files.tsv`；`scripts/wall-clock-assertions.tsv`(只在新增耗时断言时) | 新宿主各一行；改动过的测试按实测精确条数写回。 |

**测试与夹具**

| 文件 | 改什么 |
| --- | --- |
| `main/process-fence-profile.test.ts` | 逐行全等形状：删 W2/W6，CF 两块在 N4 之后(规则、`[dD][aA][tT]`、上级目录去重)，空 CF 不出块；id 集合 = 新 `WRITABLE_ROOT_IDS`。E9 往返：生产渲染(含 CF)→ 解析 → `deny` 与渲染输入(规则 + 上级目录)逐条相等；CF + C1 样本(按兄弟设计 `docs/specs/stored-credentials-fence/design.md` §4.5 的两块文字代入假路径，含块尾 `; C1` 与收尾括号落在最后一条条目行末)同样逐条相等。拒绝形状逐条抛：未知表头、未知条目、块内注释、空块、拒写块之后的放行行、X1 行写在 CF 之后。覆盖判定：在 allow 下且被 subpath/regex deny 盖住 ⇒ 不覆盖；literal deny 只在等于目录时算。`trimUntilCompiles` 丢工作区时 CF 原样。`configFenceLocations` 清单(两个配置目录相同只列一份)。`checkWorkspaceDirectory`：CF 根本身与之内 ⇒ `protected-config`；包含 CF 根 ⇒ 合格；真盘上 firmlink 写法与软链指向 CF 根 ⇒ 同样拒；根不在盘上跳过；HOME / 状态根原因不变。并集输入加 `configFenceRoots`。 |
| `main/process-fence-plan.test.ts` | 输入加 `engineConfigDirectory`；CF 目录预建(状态根、环境根、CF-2、CF-6、两个配置目录)且从不建 `~/.opencode`；真实上级目录 + 名字；位置是软链 ⇒ 多一条真实目标；环境根在状态根之内不另列、在外另列；`ENOENT` 只写位置；其它 `realpath` 错误 ⇒ 抛；计划里的 `configFenceRoots` 与渲染同一份；真源里落在 CF 根之内的条目被排除并记账。 |
| `main/process-fence-workspaces.test.ts` | eligibility 加 `configFenceRoots`；CF 之内的目录 register / probe 回 `protected-config`、零签发；既有 HOME / 状态根用例原因不变。 |
| `main/engine-explicit-config.test.ts` | `writeEngineConfigFiles`：缺席才写种子、逃生阀(无 `userConfig`)不写；显式文件内容 = `composeExplicitDocument`；模型底表写入；`models` 缺席或底表为空 ⇒ 删除(盘上留着上一代文件的逃生阀臂)；写 / 删失败抛，消息含路径与 errno、不含内容。`writeEngineConfigForFork` 的 layer 与今天注入算出的同形(两层 policies 一致；`/init`、`/review`；skills = 出厂 ∪ 当前代 ∪ 项目入口；提示词逃生门下无命令)。删 `:164` 锚 `sidecar.ts` 起监听的 ANCHOR 用例，行为改由 `server.test.ts` 真执行。 |
| `main/server.test.ts` | AC-05 两臂：写失败(引擎配置目录换成普通文件)、删失败(`models` 缺席而 `models.json` 是非空目录)⇒ `spawnLocalServer` 拒绝、fork 替身零调用、日志恰一行 `[I-13] engine config files could not be written — refusing to fork:` 且带路径。E7 接线：fork 之后手改 `codepuppy.jsonc` ⇒ 显式文件由 main 重写；子进程退出后再改 ⇒ 不再重写。 |
| `main/codepuppy-config-injection.test.ts` | 辅助函数与生产同序：先 `writeEngineConfigForFork(codepuppyBootstrap())` 再注入；原来读 `result.explicit` 的断言改读它的输出。`#613`「models.json 写不进」那一臂改为「注入不写盘」：注入前后 `codepuppy-engine-config/` 与种子零变化，`models.file` 随文件在缺而定。 |
| 依赖注入写盘的测试接线：`main/codepuppy-config-injection-engine.cases.ts`、`main/config-injection-throat.test.ts`、`main/composer-tier-matrix.engine.cases.ts`、`main/package-hub-lifecycle.engine.cases.ts`、`main/plugin-entrypoints.engine.cases.ts`、`main/engine-plugin-policy.engine.cases.ts`、`main/bootstrap-launch-parity.engine.cases.ts`、`main/package-command-engine-visibility.engine.cases.ts`、`test-component/package-plugin.wiring.cases.ts`、`test-component/codepuppy-engine.ts`、`test-fixtures/process-fence/engine-embed-driver.ts` 与宿主 `main/process-fence-engine.test.ts`、`test-fixtures/net-failure/engine-driver.ts` | 只改接线：与生产同序先跑 `writeEngineConfigForFork`(围栏内的驱动由宿主在装围栏前跑)；`injection.explicit`、`explicitSkillDirs()` 改用它的输出与新签名；共享宿主 `codepuppy-engine.ts` 的返回值加 `explicit`。各用例的断言意图不变。 |
| 直接调 `renderProcessFenceProfile` 的 17 个文件 | 加 `configFence`。围栏 / 引擎整链夹具(`project-writable.engine.cases.ts` 手渲染臂、`fence-write-denied.engine.cases.ts`、`process-fence-extension.cases.ts`、`native/codepuppy-fence/test/packaged-main.ts`、`packaged-window-main.ts`)经 `planConfigFence` 取生产 CF；只判别的轴的(`process-fence-compile`、`process-fence-apply`、`network-egress-fence`、`workspace-write-probe-fence`、`process-fence-wiring`、`process-fence-zsh-startup.cases`、`test-component/official-connectors.cases`、五个真源测试)传 `[]`。依赖 W2 可写的控制臂改指仍可写的行：`custom-provider-truth-fence`、`project-trust-truth-fence` 的「先在可写处造好再 mv」第一步改落 W3，标题与注释里过时的 W2 说法同步(`project-trust-truth-fence` 审计臂的「W2 根挪得动」只记日志不断言，改措辞)；`custom-provider-truth` 的固定行 id 由 15 个变 13 个，`mcp-server-truth`、`egress-grant-truth` 的规则条数下界随之减 2；三者「W2 罩着 `codepuppy.jsonc`」的正对照改为「W3 罩着 userData 里的文件」。 |
| `WorkspaceDirectoryInput` 的其余构造点 | `project-writable.engine.cases.ts`(2 处)、`workspace-identity.cases.ts`、`project-writable-ipc.cases.ts`、`workspace-identity-firmlink.fixture.ts`、`native/codepuppy-fence/test/packaged-window-main.ts` 加 `configFenceRoots`。 |
| `main/process-fence-write-sites.test.ts` | `:53` 的 `main-only` 允许名单从只有 `codepuppy-environment.ts` 扩到加 `engine-explicit-config.ts`、`codepuppy-installs.ts`、`ext-receipt-v2.ts`(§4.7)；根合法性用例把 `W2`、`W6` 列为非法，合法样例换掉 `W2+W6+W1`。 |
| `main/source-text-anchors.ts` | 删 `engine-explicit-config.test.ts` 那条锚的登记(锚随行为一起删)。 |
| 新 `main/process-fence-config-fence.test.ts` + 同名 `.cases.ts` + `native/codepuppy-fence/test/config-fence-ops.c` | E1 / E2，见「证明」。C 程序按设计期 `~/.cache/alpha-orch/2026-11-19/config-fence-design/src/wops.c` 的手法逐条回报 `OK` / `errno`(追加、截断、同目录新文件改名覆盖、工作区文件改名覆盖、`RENAME_SWAP`、改名移走、往目录里硬链 / `clonefile` / 软链、`chmod`、删除、建兄弟 / 子目录、改名上级目录)，宿主现编，不进产品。 |
| `main/project-writable.engine.cases.ts`(宿主 `project-writable.engine.test.ts`) | E9 三臂，见「证明」；eligibility 用 `currentConfigFenceRoots`。 |
| 新 `main/engine-config-fence.engine.test.ts` + 同名 `.cases.ts` | E3、E5、E8 与 AC-06，见「证明」。 |
| `ui/workspace-writable-ui-census.test.ts`、`test-component/session-workspace.cases.ts`、`ui/session-workspace/session-workspace-test-runtime.tsx` | 第四句逐字合同；组件臂：原因 `protected-config` ⇒ 显示这一句、无按钮，位置同另外三句；测试运行时的原因类型改用生产类型。 |

**供计划核对的设计差异**(实施前请编排器确认；不改任何冻结的产品或安全决定)

| 编号 | 差异 | 依据与最小改动 |
| --- | --- | --- |
| D-1 | 新资格原因 `protected-config`，不复用 `home-or-app-state` | 设计 D14 复用既有原因，规格 v1 要一句独立说明，派单要求最小区分。全部消费点：`process-fence-profile.ts` 的 `WorkspaceDirectoryCheck`(定义)；`process-fence-workspaces.ts` 的 `WorkspaceEligibility` 与三处映射；`workspace-write-probe.ts` 的两个联合(`ipc.ts`、`preload/types.ts` 透传)；`ui/workspace-writable.ts` 的消息映射；两条 i18n；测试运行时类型。状态根本身与其内照旧是 `home-or-app-state`(既有关系先判)，派单写明那句旧说明继续管主目录与应用数据根。 |
| D-2 | `writeEngineConfigFiles` 的返回值多一个可选 `userError` | 冻结签名只回两条路径；§5 要求用户文件解析不了时留既有日志，那行原来由注入打，现在只有 main 知道。其余形状不变。替代：`server.ts` 调用前自己再解析一次用户文件(重复一次解析)。 |
| D-3 | `governedModelsBase`、`explicitSkillDirs`、`PROJECT_SKILLS_ENTRY` 从注入模块原样搬到 `engine-explicit-config.ts` | 它们今天住在 sidecar 的注入模块里，主进程不 import 那个模块(它读 sidecar 才发布的启动文档)。§6 已列 `engine-explicit-config.ts` 依赖 `codepuppy-models`、`factory-paths`、`codepuppy-prompts`、`gen-skill-paths`。只搬家，`explicitSkillDirs` 改为显式收出厂目录与根。 |
| D-4 | `store-keys.ts` 加 `UPDATER_STORE`，`updater.ts` 改用 | `opencode.updater` 今天是 `updater.ts:72` 的字面量，§4.3 要求名字取 store 常量。两个文件不在派单初始枚举里，各改一行。 |
| D-5 | CF 位置纯函数暂不收 `dataHome` | 只有 CF-11 用它，片 ③ 加；本片不加没有用处的参数。 |
| D-6 | 启动文档构建提到计划之前 | §4.4 要求调用点在计划之前、平台输入取启动文档的同一组值；基线上文档在计划之后才构建。构建本身不变。 |

### 顺序

同一个 PR 内三个顺序工作单元。每个单元末尾相关检查全绿，交编排器看一次；PR 只在单元 C 完成后可送审。

**单元 A：写者移到主进程(围栏不变；单独看也是可用状态)**

1. 红(按构造必红)：`engine-explicit-config.test.ts`、`server.test.ts`、`codepuppy-config-injection.test.ts` 的新用例。新导出不存在、注入仍写盘，所以红；红输出存证。
2. 绿：`engine-explicit-config.ts`、`server.ts`(启动文档前移、写配置、监听)、`codepuppy-config-injection.ts`、`sidecar.ts`；全部依赖注入写盘的测试接线；写盘登记簿与 `process-fence-write-sites.test.ts`；锚登记删除。跑检查组 A，再把共享宿主 `test-component/codepuppy-engine.ts` 的其余消费者在后台串行跑一次(检查组 A′)。

**单元 B：受保护集、放行解析、资格与说明(依赖 A：删 W2 之前 sidecar 必须已不写种子)**

3. 红(按构造必红)：`process-fence-profile.test.ts`、`process-fence-plan.test.ts`、`process-fence-workspaces.test.ts` 的新用例。
4. 绿：`process-fence-profile.ts`、`process-fence-plan.ts`、`server.ts`、`process-fence-workspaces.ts`、`workspace-write-probe.ts`、`index.ts`、`store-keys.ts`、`updater.ts`，全部渲染 / 并集 / eligibility 调用点，W2 控制臂，登记簿根合法性。CF 渲染与解析器、覆盖判定必须同一提交(§10 D12 ②：分开则本代运行期放行被停)。跑检查组 B。
5. 红(按构造必红)：census 第四句与组件臂。
6. 绿：`ui/workspace-writable.ts` 与两条 i18n。跑检查组 C。

**单元 C：实证、登记与收口**

7. E1 / E2 宿主、cases 与 C 程序(生产臂与已知坏臂在同一宿主)。
8. E9 三臂(`project-writable.engine.cases.ts`)。
9. E3 / E5 / E8 与 AC-06 宿主(`engine-config-fence.engine.*`)。
10. 事实文档、`gate-files.tsv`、本节偏离记录与证据路径；最后跑 ui-mac `bun typecheck`、`git diff --check`、受影响的检查组复跑、签名形态宿主一次。

变异运行(不提交，用 `git restore` 复原，输出存 `~/.cache/alpha-orch/2026-11-19/impl-fence-slice2/mutations/`)：M1 `processFenceWriteRules` 换回基线写法(放行块后见拒写即抛)；M2 去掉 CF 资格关系；M3 `server.ts` 不起监听；M4 只在底表为空时删 `models.json`；M5 注入里保留 `writeExplicitConfig`。每个变异都要让「证明」表里点名的用例变红。

### 风险

- **共享引擎宿主的消费者面**：44 个文件经 `test-component/codepuppy-engine.ts`，接线一变它们都相关。单元 A 末尾后台串行只跑一次，失败按单个宿主归因；冷缓存 `ENOTCACHED` 先按包名 `npm cache add` 再重跑。
- **两次模型配置计算**：main(`writeEngineConfigForFork`)与 sidecar 注入读同一份启动文档、同一批文件，单元 A 用例钉住两边 policies 一致；出网派生那一次仍按既有方式读 main 环境，不动。
- **监听生命周期**：按代停、下一次 spawn 先停。计划期在 `node_modules/.cache/cf-plan-probe/` 实测：`bun test` 带着未关的 `fs.watch` 与 `fs.watchFile` 照常退出，不会挂住测试进程。
- **测试布局假绿**：`/private/tmp`、`$TMPDIR` 在 W11/W12 下。E1 的假 HOME、userData、状态根放在 worktree `node_modules/.cache/config-fence/`，先用 `processFenceRulesCover` 证明它们不在任何放行之下，宿主在围栏外读盘判定。
- **身份判定**：CF 根与目录的关系一律按 dev+ino(firmlink 写法同一对象)，每次判定现解析；真实路径只用 `realpathSync.native`。
- **字节墙**：CF 约 20 条加上级目录；`trimUntilCompiles` 只丢工作区，形状用例钉住 CF 原样，试编译用真 `sandbox-exec`。
- **内核沙箱日志**：E3 / E5 用 `log show` 取运行窗口内的拒绝，按 pid 区分引擎进程与攻击命令；取不到日志 ⇒ 该项判红，不当成零条。
- **悬空软链(观察，不加机制)**：CF 位置本身是悬空软链时 `realpath` 报 `ENOENT`，按「不存在」只保护链本身，链指向的、尚不存在的目标不在规则里。围栏内建不出这种链(位置本身被拒)，只有改动前的会话或用户自己能留下它，与 R6 / R8 同类，作为观察返回。
- **机器纪律**：其它 lane 与全门在跑时真引擎宿主串行、并发不超过 2；任何一臂都不碰真实 userData、`~/.config/opencode`、`~/.opencode`、shell rc 或凭据。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01 | `main/process-fence-config-fence.test.ts` → cases。生产计划器 + 生产渲染 + 生产 addon(`applyProcessFence` 装在 bun 子进程上)。假 HOME 下 CF 每个位置(状态根里的 `codepuppy.jsonc`、CF-2 的显式文件与 `models.json`、CF-3/4/5、CF-6 里一条记录、CF-7 两个 literal 与 `default.dat` / 新建 `.DAT`、两个配置目录里的 `opencode.json`、CF-10 两个文件)× C 程序的全部手法，另经软链写法、大小写变体、firmlink、`/.vol/<dev>/<ino>`、改名任一上级目录；某个位置预先是指向工作区的软链时，其真实目标同样被拒；事后在围栏外逐字节比对原样。E2：同一 profile 下引擎 state、库与 `-wal`、日志、缓存、`~/.npm`、`uv-cache`、工作区、userData 其余文件的建改删，以及 `mkdir -p` 已存在的受保护目录，全部成功。保证外对照(不计失败，R8)：受保护目录里用户自建、指向工作区的嵌套软链，写入落到链目标。 | 已知坏各臂在同一宿主里必须翻转，否则宿主红：去掉 CF(`configFence: []` 且补回 W2/W6 行)⇒ W2/W3/W6 下的位置全部写得进(CF-10 与状态根本身今天就写不进，设计 §4.1 已注明)；CF 两块挪到放行块之前 ⇒ 写得进；删上级目录块 ⇒ 改名上级目录成功；X1 行挪到 CF 之后并给包含 CF 位置的目录签发 ⇒ 写进 CF；软链位置不加真实目标 ⇒ 经目标写入成功。 |
| AC-02 | ① 真引擎 `main/project-writable.engine.test.ts`(生产计划器臂，profile 含 CF)：本运行新登记的项目签发一次、模型写入落盘、引擎 pid 不变；CF 目录根之内的文件夹 `workspace-open-record` 回 `{ recorded: false, reason: "protected-config" }`，probe 回 `ineligible` / `protected-config`，零 `grant-sent`；包含 CF 目录根的文件夹(假 HOME 下的 `.config`)签发，`other-app/x` 落盘，其中 `opencode/opencode.json` 写入 EPERM、零文件。② 单元：`process-fence-profile.test.ts` 往返与资格用例，`process-fence-workspaces.test.ts` 透传。③ 界面：`session-workspace` 组件臂显示那一句、无按钮；census 逐字。 | M1(解析器回退)⇒ server 记「runtime grants are disabled」、新项目写入失败，往返用例同时抛；M2(去掉 CF 资格关系)⇒ CF 之内被签发，零签发断言红；把 CF 关系写成「包含也拦」⇒ `.config` 臂不签发；缺消息映射 ⇒ 组件里没有那一句。 |
| AC-04(不含工具策略) | `main/engine-config-fence.engine.test.ts` → cases。假 HOME / userData；cases 进程用生产计划器 + 生产 addon 把自己关进围栏；引擎配置由生产 `writeEngineConfigForFork` 在装围栏前写好；装围栏前起一个围栏外的「main」辅助进程，跑生产 `watchExplicitSources` 并代写 `codepuppy.jsonc`。change 臂经引擎自己的 shell 工具做 A1a(改显式文件里连接器命令)、A1b(改 `codepuppy.jsonc`)、A2(显式文件与全局配置目录 `opencode.json` 给带密钥的 provider 写 `package: file://…`)⇒ 全部 EPERM，连接器仍跑原命令、假令牌未外泄，主进程读法读到原命令，模块未装载、假密钥未送达。同时模型调用、连接器调用、经 main 的安装 / 停用 / 启用(写 `codepuppy.jsonc` → main 监听重写显式文件 → 引擎热重载)、引擎重启都正常；运行窗口内路径在 CF 内、pid 是引擎进程的沙箱拒绝为零(攻击命令自己的拒绝另计)。 | control 臂(同一宿主另起一个进程：生产 profile 去掉 CF、补回 W2/W6)三项攻击全部成功；任一项在 control 臂没成功 ⇒ 宿主红，证明手段测得出。 |
| AC-05 第一句 | `main/server.test.ts` 写失败、删失败两臂；`main/engine-explicit-config.test.ts`(错误消息带路径与 errno、不含内容)。对照臂(围栏内直接写)：E5 臂里在围栏内调 `writeExplicitConfig` ⇒ EPERM，「退回围栏内写」走不通。 | 去掉 `server.ts` 的拒 fork ⇒ fork 替身被调用；M4(只在底表为空时删)⇒ 逃生阀臂留下旧文件、`models.file` 指向它。 |
| AC-06 | `main/engine-config-fence.engine.test.ts`：① 0.2.6 形状冷启动(预置带连接器的 `codepuppy.jsonc`、上一版写法留下的显式文件与 `models.json`、工具策略文档、界面设置存储文件)⇒ 连接器、模型清单、工具策略判定与预置一致；② 手改 `codepuppy.jsonc` 加连接器、main 写技能允许集与当前代指针 ⇒ 引擎不重启就看到连接器与技能；③ 全新机器形状(没有 `<XDG_DATA_HOME>/opencode`、没有 `~/.opencode`)⇒ 计划器预建、引擎起来，`~/.opencode` 仍不存在。另有 `server.test.ts` 的 E7 接线；既有 `package-effect.engine.test.ts`、`created-plugin.engine.test.ts` 照样绿。 | 不预建臂(计划器的 `mkdirp` 跳过 CF 目录)⇒ 引擎在 Global mkdir 处 EPERM、起不来，宿主断言它失败；M3(main 不起监听)⇒ ② 看不到改动。 |
| E5(I2) | `main/engine-config-fence.engine.test.ts` 的 sidecar 形状臂：装围栏之后在同一进程跑生产 `injectCodePuppyConfig` ⇒ `ok: true`，CF 内字节与 mtime 零变化，`config.file` = main 写的路径，`models.file` 随文件在缺；账本里放一条坏条目 ⇒ 无证据文件；窗口内零 CF 拒绝。单元：`codepuppy-config-injection.test.ts` 注入零写盘与逃生阀臂。 | M5(注入里保留 `writeExplicitConfig`)⇒ EPERM、`ok: false`；M4 见上。 |
| 修订 2 A(CF-4 的 `$CODEPUPPY_ENV_FILE`) | 单元：`process-fence-plan.test.ts` 设置 / 不设 / 与 userData 那份同一份 / 本身是软链 / 上级目录不在盘上(最深一级已存在祖先的真实路径接上余下部分)/ 解析出错与引号路径不让计划失败 / 文件在工作区里(工作区照常，只有那份文件与路径上的目录节点被拒)/ 一个来源(`userEnvFile` 与 `loadCodePuppySecrets` 读同一份，相对按 cwd)；`server.test.ts` 计划输入带同一份路径(绝对 / 相对 / 不设)。真围栏：`process-fence-config-fence.test.ts` 的 E1 臂(追加 `CODEPUPPY_PLATFORM_URL=…`、改名覆盖、删除、改名路径上的目录 ⇒ EPERM；同一项目文件夹里的兄弟文件落盘；指向尚不存在目录下的文件 ⇒ 计划照常、建不出目录与文件)。 | 去掉这一行(CF 不含 env 文件)⇒ E1 臂写入成功；去掉 server 的接线 ⇒ 计划输入用例红。 |
| E9 形状 | `main/process-fence-profile.test.ts`：CF 两块在 N4、X1 之后，真实路径，含软链目标与全部上级目录；往返(CF；CF + C1 样本)。 | 渲染与文法任一侧单独改动 ⇒ 往返不等或抛。 |

**相关检查命令**(都在 `packages/ui-mac` 下执行，只传宿主 `*.test.ts`)

- A：`bun test src/main/engine-explicit-config.test.ts src/main/server.test.ts src/main/codepuppy-config-injection.test.ts src/main/config-injection-throat.test.ts src/main/process-fence-write-sites.test.ts src/main/sidecar-env.test.ts src/main/gate-file-registry.test.ts`(后者是 `source-text-anchors.ts` 的判官)；真引擎：`bun test src/main/codepuppy-config-injection-engine.test.ts src/main/composer-tier-matrix.engine.test.ts src/main/package-hub-lifecycle.engine.test.ts src/main/plugin-entrypoints.engine.test.ts src/main/engine-plugin-policy.engine.test.ts src/main/bootstrap-launch-parity.engine.test.ts src/main/package-command-engine-visibility.test.ts src/main/package-effect.engine.test.ts src/main/created-plugin.engine.test.ts src/main/package-plugin.wiring.test.ts src/main/process-fence-engine.test.ts src/main/net-failure-real-stack.test.ts`。
- A′：`grep -rl "test-component/codepuppy-engine" src test-component native` 得出的 cases 对应的其余宿主，后台串行一次。
- B：`bun test src/main/process-fence-profile.test.ts src/main/process-fence-plan.test.ts src/main/process-fence-workspaces.test.ts src/main/process-fence-compile.test.ts src/main/process-fence-apply.test.ts src/main/process-fence-wiring.test.ts src/main/process-fence-write-sites.test.ts src/main/workspace-write-probe.test.ts src/main/workspace-write-probe-fence.test.ts src/main/network-egress-fence.test.ts src/main/custom-provider-truth.test.ts src/main/custom-provider-truth-fence.test.ts src/main/mcp-server-truth.test.ts src/main/egress-grant-truth.test.ts src/main/project-trust-truth-fence.test.ts src/main/process-fence-zsh-startup.test.ts src/main/process-fence-extension.test.ts src/main/workspace-identity.test.ts src/main/project-writable-ipc.test.ts src/main/official-connectors.test.ts src/main/server.test.ts`；真引擎：`bun test src/main/fence-write-denied.engine.test.ts src/main/project-writable.engine.test.ts src/main/process-fence-engine.test.ts`。
- C：`bun test src/renderer/codepuppy-ui/workspace-writable-ui-census.test.ts src/renderer/codepuppy-ui/workspace-writable-core.test.ts src/renderer/codepuppy-ui/session-workspace/codepuppy-session-workspace.test.ts src/renderer/codepuppy-ui/new-session-workspace.component.test.ts src/renderer/route-composition.test.ts`。
- D：`bun test src/main/process-fence-config-fence.test.ts src/main/engine-config-fence.engine.test.ts src/main/project-writable.engine.test.ts`。
- 收口：`bun typecheck`；`git diff --check`；签名形态一次 `CODEPUPPY_TEST_SIGNED_FENCE=1 bun test src/main/process-fence-extension-packaged.test.ts`(本地构建并签名，约 10–15 分钟)。不跑全仓 suite、`bin/check` 或全门。

**计数钉与登记行**：`gate-files.tsv` 里 `process-fence-profile`(27)、`process-fence-plan`(11)、`process-fence-workspaces`(18)、`process-fence-write-sites`(12)、`custom-provider-truth`(10)以及 `engine-explicit-config`、`codepuppy-config-injection`、`server`、`mcp-server-truth`、`egress-grant-truth`、`project-trust-truth-fence`、`custom-provider-truth-fence`、`workspace-writable-ui-census`、`project-writable.engine` 各行，按各宿主实测输出写回精确条数并改写描述里过时的 W2 / W6 说法；三个新宿主(`process-fence-config-fence`、`engine-config-fence.engine` 与已存在的 `project-writable.engine` 的子用例数)按 darwin 行既有格式登记，cases 不单列。

### 体量与时间

- 文件：生产 14 个(含两条 i18n、登记簿与事实文档)；测试与夹具约 45 个，其中约 25 个只是一两行接线；新建 5 个(两个宿主、两个 cases、一个 C 程序)。合计约 60 个。
- 实质行数：生产新增约 400 行、删除约 120 行，另有约 90 行从注入模块原样搬到 `engine-explicit-config.ts`；测试约 1,500 行(新宿主约 800，改写约 700)。
- 时间：单元 A 约 2.5 小时(含共享宿主消费者重跑约 40 分钟)；单元 B 约 2.5 小时；单元 C 约 4 小时(两个真围栏 / 真引擎宿主是主要风险)，签名形态 15–30 分钟。合计约 9–10 小时，超过一次连贯会话(约 15 个文件 / 800 行)，所以按上面 A → B → C 三个单元顺序做，同一个 PR。
- 模块体量：`packages/ui-mac/src/main` 树基线 65,177 行，今天实测 68,465 行(已超 3,288)。本片预计净增约 200 行(profile 约 +110、plan 约 +35、server 约 +40、`engine-explicit-config.ts` 约 +120(其中约 90 行是从注入模块搬来的)、注入模块约 −110、sidecar −3、其余约 +5)。不改棘轮行，在 PR 里如实报告。

### 偏离记录

- 2026-11-20 · 单元 A 开头加一个纯搬家提交(不在原顺序里)：`PROJECT_SKILLS_ENTRY`、`explicitSkillDirs`、`governedModelsBase`(连同两个投影类型与 `#857` 注释)搬到 `engine-explicit-config.ts`，另把同块的 `materializeGovernedModelsBase` 一起搬(D-3 名单外，同样逐字节不变，只加 `export` 供注入模块引用；单元 A 的 `writeEngineConfigFiles` 复用它写模型底表)。importer 只改 import 行；写盘登记簿里随代码换文件的三行根仍是 W3(根在后一个提交改)。逐字节核对：从 `bd206c6bca` 的注入模块取原 24 行与 92 行，与新文件同一段逐行比较全等，唯一差别是 `export `(`~/.cache/alpha-orch/2026-11-19/impl-fence-slice2/evidence/move-byte-equivalence.txt`)。
- 2026-11-20 · 单元 A 绿提交的落点细节(不改任何决定)：`materializeGovernedModelsBase` 的路径改由 `engineModelsPath` 给(同一个值，路径只有一处)；`writeEngineConfigFiles` 在 `models` 缺席时删 `models.json`，有 `models` 时复用 `materializeGovernedModelsBase`(底表为空它本来就删)。`process-fence-write-sites.ts` 里 `isValidRoot` 的注释随 `main-only` 名单改写(扫描器模块，初始枚举未列；只改注释)。`package-hub-lifecycle.engine.cases.ts` 的「sidecar 换代」路径也先跑 main 那一步(与生产换代同序)；`net-failure-real-stack.test.ts` 与 `process-fence-engine.test.ts` 两个宿主在起驱动前用同一份启动文档跑 main 那一步。`codepuppy-config-injection.test.ts` 的 gate 行 27 → 28(删「models.json 写不进 ⇒ 注入 ok:false」，加「注入不写盘」与 E5 逃生阀臂)。`engine-explicit-config.test.ts`、`server.test.ts` 在 `gate-files.tsv` 里本来没有行，不新增。
- 2026-11-20 · 单元 A 证据：红 `f32d9a5245`(两份测试文件因新导出不存在而装不上，server 三条新用例红；`evidence/unitA-red.log`)；绿 `f14bad620a`。`server.test.ts` 的 E7 用例在绿提交里多了一臂「main 装一个技能(生成目录 + `current.json` + 允许集)⇒ main 的监听把它写进显式文件的 skills」，补上 AC-06 中句里「main 装技能」那一半在 `spawnLocalServer` 这条路径上的证据(红提交里只有手改 `codepuppy.jsonc` 一臂)。变异运行(`mutations/`，均已 `git restore` 复原)：M3(main 不起监听)⇒ E7 红；M4(只在底表为空时删)⇒ 三处 E5 逃生阀臂与删失败臂红(4 条)；M-AC05(写失败后照样 fork)⇒ server 两条 AC-05 红；M5-lite(注入仍自己写种子)⇒「注入不写盘」红。一致性记录 `bootstrap-launch-parity.record.json` 未重采即通过(D-6 的条件)。检查组 A 的 14 个宿主与共享宿主 `codepuppy-engine.ts` 其余 39 个消费者宿主全部绿(`evidence/unitA-engine/summary.txt`、`evidence/unitA-harness-consumers/summary.txt`)。
- 2026-11-20 · 单元 A 检查点审查(FIX-THEN-MERGE)的处置,新提交、不改旧提交:
  1. (Major)显式文件的合成从「启动文档之后、计划围栏之前」挪到「官方连接器恢复与允许集重发(`await officialAvailabilityPublished()`)之后、fork 之前」,只合成一次,监听在它之后起;合成失败先清掉这一代的官方连接器运行期目录,再走同一条 `[I-13]` 拒 fork 路径;fork 抛出时也当场停掉这一代的监听。为什么仍守 §4.4 的契约:写者在 main、在 fork 之前,失败响亮拒 fork、不退回 sidecar;计划围栏不读这几个文件(受保护目录 CF-2 由计划器自己预建,真实路径只取目录),所以挪到计划之后不改变 profile;而引擎在 fork 之后才读,此刻文件已是最终内容 —— 恰恰是放在计划之前才会在恢复改写 `codepuppy.jsonc` 之后变旧。设计 §4.4 原文「计划围栏之前」由编排器在修订里改述;启动文档仍在计划之前构建(计划器要它的 `engineConfigDirectory`)。证据:`official-connectors-recovery.cases.ts` 新用例(真 spawnLocalServer,fork 那一刻显式文件里的 DSN 引用 = 恢复后 `codepuppy.jsonc` 里的那条且文件在;修复前实测指向已被清掉的上一代文件)。
  2. 引擎配置目录在 `writeEngineConfigFiles` 开头以 0700 建(全新机器,有无模型底表两种都断言);写盘登记簿多一行 `mkdirSync path.join(input.userDataPath, USER_DATA_LAYOUT.engineConfig)`(main-only)。
  3. `main-only` 行按完整签名钉住;另加两条结构判据(扫描器算出的 sidecar 闭包):除 `engine-explicit-config.ts` 自己没有文件拿到五个写函数(含整块 import);对账本的值 import 只许 `readPackageLedgerStateV1` / `readLedgerV2`,两处调用都带 `sideEffectFree: true`。变异证明:临时往 `sidecar.ts` 加 `watchExplicitSources` 的 import、把 `ext-disabled-injection.ts` 的 `sideEffectFree` 改成 false ⇒ 两条判据各自红(`mutations/R3-…log`)。
  4. `watchExplicitSources` 给 FSWatcher 挂 `error` 监听:记一行 `[alpha-code#1667] stopped watching <根> for engine config inputs: <原因>`,不抛;用例对监听器 emit `error` 断言。
  5. 查 `writeEngineConfigForFork` 里非 IO 的计算有没有可达的抛出:模型投影的读法都退化不抛(已应用目录坏 ⇒ 随包 / 空,自定义节点真源坏 ⇒ 记一行、空,密钥文件读不了 ⇒ 当没有),`skillGenerationLiveDirs` 读不了 ⇒ 空,`applyPromptTakeover` 纯函数,`composeExplicitDocument` 接住解析错误,`disabledPackageComponents` 以 `sideEffectFree` 读、坏了 ⇒ 空。没有找到可达的抛出;日志措辞不改:设计 §5 钉的就是 `[I-13] engine config files could not be written — refusing to fork:` 这一行,AC-05 两条用例断言它,改成「could not be prepared」会动冻结的日志行与断言的含义。
- 2026-11-20 · 单元 B 落点与证据:
  - 偏离:环境根恒列进受保护集(状态根之内时是一条冗余规则),不再按真实路径判「在状态根之内就不另列」—— 省掉一次按字符串判包含,规则只多不少;计划用例相应写成「环境根恒列」。
  - `process-fence-compile.test.ts` 的生产形状改由 `planConfigFence`(恒等 realpath、不建目录)给出受保护集,两块拒写也进真 `sandbox-exec` 试编译;`process-fence-extension.cases.ts`、`fence-write-denied.engine.cases.ts`、`project-writable.engine.cases.ts` 手渲染臂、两个签名形态夹具经 `planConfigFence` 带生产受保护集;只判别的轴的测试传空集。`project-trust-truth-fence` 的审计臂改为断言「环境根在围栏里挪不动」(W2 删后的新事实),`custom-provider-truth` 注入的伪造行标签由 W2 改 W99。网络行形状用例改在空受保护集上判(有受保护集时网络行紧贴两块之前)。测试运行时的原因类型改用生产联合。
  - 红 `de36104d6c`(`evidence/unitB-red.log`)→ 绿 `2d5130179e`;界面红 `d2ea3e2606`(`evidence/unitB-ui-red.log`)→ 绿(本提交)。变异:M1(解析器换回「放行块后见拒写即抛」)⇒ profile / plan 五条往返与覆盖用例红,真引擎 `project-writable.engine` 里本运行新登记的项目拿不到放行(5 条子用例红,`mutations/M1-…`);M2(去掉受保护位置资格判定)⇒ 资格、并集、计划、跟踪器四条红,跟踪器那条即「受保护位置之内被登记 / 签发」(`mutations/M2-…`)。
- 2026-11-20 · 观察(已有缺陷，不属本片)：`packages/ui-mac/src/main/server.test.ts:875` 的「`OPENCODE_CONFIG_DIR="."` 被忽略」用例用 `"."` 做「日志里不带值」的判据，worktree 里没有构建 `packages/ext/dist` 时，`codepuppy-ext: NOT loaded — … dist/server.js` 那一行恰好含 `.`，用例转红；`bun run build`(packages/ext,产物被 git 忽略)之后转绿。实施期按此构建了 ext dist。
- 2026-11-20 · 观察(编排器裁决：记录、不加机制，设计另加留档)：CF 位置本身是悬空软链时 `realpath` 报 `ENOENT`，计划器按「不存在」只保护链本身，链指向的、尚不存在的目标不在规则里。围栏内建不出这种链(位置本身被拒)，只有改动前的会话或用户自己能留下它，与残留 R6 / R8 同类。
- 2026-11-20 · 实现期修订 2 A(设计修订片段 `~/.cache/alpha-orch/2026-11-19/config-fence-design/r4/design-delta.md`，编排器采纳)：`$CODEPUPPY_ENV_FILE` 指向的那份并入 CF-4。唯一来源 `codepuppy-secrets.ts` 的 `userEnvFile(env)`(相对路径按 cwd，与 `readFileSync` 一致)，`loadCodePuppySecrets` 与 `server.ts` 交给计划器的值都取它；`configFenceLocations` 收可选 `envFile`，排在 CF-4 那条之后；`planConfigFence` 对这一项从不失败(上级目录不在盘上取最深一级已存在祖先的真实路径接上余下部分；解析出错按设置的路径写；写不进 profile 的路径不写)，本身是软链加真实目标。文件：`codepuppy-secrets.ts`、`process-fence-profile.ts`、`process-fence-plan.ts`、`server.ts`。红 `81e4f92f8c`(`evidence/deltaA-red-*.log`)→ 绿(本提交；红提交里「上级目录不在盘上」用例的假 realpath 把整个 HOME 映到别处，默认工作区随之「不在盘上」，绿提交改成只把最深一级已存在祖先映到别处，断言不变)。变异：去掉 server 接线 ⇒ 计划输入用例红(`mutations/deltaA-no-wiring.log`)。
