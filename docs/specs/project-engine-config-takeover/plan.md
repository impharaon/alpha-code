---
id: PLAN-project-engine-config-takeover
title: 项目自带的 OpenCode 配置按项目信任放行 实施计划
summary: "#1713 六段:钉住今天的行为;配置装载闸;md 读取点(文件头、agent / 命令控制字段、命令插值);插件在允许后加载(退役 #1708 的先拒全部);确认框清单与主进程 ⇄ sidecar 视图消息;三个新接管的 ADR、权威登记册与升级检查"
kind: plan
status: active
spec: SPEC-project-engine-config-takeover
design: DESIGN-project-engine-config-takeover
owners: [owner]
last_reviewed: 2026-11-13
---

# PLAN-project-engine-config-takeover｜项目自带的 OpenCode 配置按项目信任放行 实施计划

由实施会话在计划阶段写,编排器核对后由同一会话实施。实施中偏离某段,在同一个提交里改那一段。
代码坐标取 `feat/1713-project-config-trust` @ `a0abf011c8`(已含 `#1709` 信任记录、`#1708` 插件拒绝与冻结的设计);路径相对仓库根。
设计决定只引用不重述:「契约 A–E」「§5」「§6」「§10」都指 [design.md](design.md)(`1256efc047`,已冻结);AC 指 [spec.md](spec.md) v1。

## 0 通用约定(每段都适用)

- **每段都跑的登记类检查**:
  - `cd packages/ui-mac && bun test src/main/gate-file-registry.test.ts src/main/old-name-scan.test.ts`
  - `cd packages/ext && bun test src/policy/authority-registry.test.ts`
- 新增的非测试代码里,注释与日志只写 `#1713`,不写带旧名的仓名前缀(`old-name-scan` 会当场红)。
- 上游文件里的每一行改动:要么在 `// codepuppy(ADR-049) ── <为什么>` 与 `// codepuppy ── end` 之间,要么行尾带 `// codepuppy(ADR-049)`(`DESIGN-upgrade-fewer-takeovers` 契约 D)。超过一次调用或一个条件的逻辑,一律放进 Code Puppy 自有的 `packages/core/src/config/codepuppy-project-gate.ts`,上游文件只调用。
- **接管登记的时机**:某个上游文件第一次被改的那个提交,同时在 `scripts/north-star-guard.sh` 的 `UPSTREAM_EXCLUDES` 加它那一条(`config.ts` 在段 1,`skill.ts`、`agent.ts` 在段 2)。这样守卫在任何一个提交上都不会看到未登记的改动。ADR、登记册与升级检查在段 5 补齐;整个 PR 一次合入。
- **ADR 编号**:用 `ADR-049`。2026-11-13 已核:本仓所有本地分支与远端分支里都还没有 049 及以后的编号。
- **引擎用例宿主**:每个新的 `*.engine.cases.ts` 由同名 `.engine.test.ts` 起独立的 `bun test` 子进程运行,宿主在 `scripts/gate-files.tsv` 按精确条数登记(`gate-file-registry.test.ts` 第 ④ 层要求)。

### 0.1 本计划已实测的前提(临时目录里跑,工作树未改)

| 前提 | 结果 |
| --- | --- |
| spike 的 11 条用例原样复制,在 `a0abf011c8` 上运行 | **9 过 2 挂**。挂的是两条插件用例(「项目用自己的 options 重新声明全局插件」与「`-*`」)。原因:`#1708` 的放行名单是在注入那一刻,从 `engineGlobalConfigDirectory(env, home)` 算出来的;而测试宿主交给引擎的全局配置目录是 `engine-config/<id>`(`test-component/engine-sandbox.ts:66-74`)。所以宿主里这个「用户全局插件」不在名单里,被拒了 |
| 同一份用例,把全局插件声明在注入之前也写进 `engineGlobalConfigDirectory(process.env, sandbox.home)`(先例:`mcp-server-derivation.engine.cases.ts:62-66` 也是两处都写) | **11 过 0 挂** |
| 内存探针:`ConfigMarkdown.parseOption` 解析 `---javascript` 文件头 | 标记文件被写出(F-22 在本 HEAD 仍成立) |
| 真引擎探针(宿主 `codepuppyEngine`,未授权项目) | 四个读取点的 JS 文件头全部执行:`.opencode/agents/*.md`、`.opencode/commands/*.md`、`.opencode/skills/*/SKILL.md`、`.codepuppy/skills/*/SKILL.md`。写了 `system` 又写了 `model: "{env:未设}"` 的 agent 不出现(F-23)。v1 `mode.<名字>`(写了 `mode: subagent`)与 `.opencode/modes/*.md` 都成了 `primary`(F-24) |

### 0.2 交编排器核对的事项

1. **schema / 归一化认得、设计表里没列的写法**(由段 1 推出,详见 1.2)。按设计默认,它们都**暂缓**。待核对的只是它们在清单里显示成哪一类;在核对之前,一律按设计默认的 `setting`、显示键名处理。
2. **引擎认不出的顶层键要不要列进清单**。A4 写的是「其余拿掉,记进视图」;契约 B 的「引擎认不出的键」一行写不生效,BR-06 说清单列的是「允许后会放开的东西」。本计划的读法:这类键照样在校验前拿掉,但**不列进清单**。是否「认得」由上游自己判:单独把这个键交给 `ConfigNormalize.normalize({ [键]: 值 })`,产出非空就算认得。这样也同时满足 §5「写坏的部分不列入清单」。
3. **测试宿主的默认信任**。宿主默认用生产读法(未记录 ⇒ 未允许)。以下四套现有用例的夹具里写的是项目控制键,它们测的本来就是「一个用户已允许的项目」,改成经生产写端记一条允许:`composer-tier-matrix.engine.cases.ts`(R6c/R6d 命令的 `agent` / `subtask`,以及「项目 opencode.json 顶层 / agent 段」两种规则放法)、`websearch-honest.engine.cases.ts`(项目 `websearch`)、`codepuppy-config-injection-engine.cases.ts`(项目 `experimental.all_flags` 的反向臂)、`use-extensions-recovery.cases.ts`(项目 `mcp`;这套直接调 `startEngine`,传一个只对它自己项目返回 true 的钩子)。
4. **段 0 对 spike 夹具做的一处改动**(见 0.1 第二行),以及把文档 id 改成 `ARCH-codepuppy-…`(见段 0)。
5. **段 4 加一套 renderer 组件用例**,证明「清单不完整 ⇒ 下次进入再问」。走 happy-dom 的现有形制(先例 `test-component/draft-route-gate.cases.ts`)。

### 0.3 核对裁决(编排器 Claude Fable 5.2,计划 `027f8f41a3`,通过)

- §0.2 第 1 条:`attachment` 与 `media` 一样,未允许也生效。`snapshot`、`autoupdate`、`autoshare`、`small_model`、`tools`、`enabled_providers`、`disabled_providers` 与命令字段 `variant` 允许后才生效。清单里它们按键名列在「其他 OpenCode 设置」下;例外是 `plugin`(`plugins` 的 v1 写法)归现有的「插件」行,命令 `variant` 归「命令的运行设置」。这些行补进 design §4 契约 B 的表,与段 1 同一个提交,并在本计划记偏离。
- §0.2 第 2 条:确认。引擎完全不认的键(`logLevel`、`server`、`subagent_depth`、`layout` 等),未允许的项目照样拿掉,不列进清单。
- §0.2 第 3 条:确认。四套现有用例先经生产写端记一条允许。
- §0.2 第 5 条与 R-07 的处置:确认。不保留按包名借道的保护代码,改为未允许臂的回归用例;renderer「下次进入再问」加 happy-dom 组件用例。
- 本轮只做段 0 与段 1,每段一个提交(段 1 原计划的提交 A / B / C 合成一个)。

---

## 段 0:钉住今天的行为

- 依据:spec v1 AC-01、AC-02(「已知的坏」);design F-01、F-22、F-23、F-24 @ `1256efc047`;spike `e9635b3071`;Issue #1713「验收责任」。
- 核对:`027f8f41a3` · 编排器(Claude Fable 5.2)· 通过。裁决见 §0.2 之后的「核对裁决」。

### 改动
| 文件 | 改什么 |
| --- | --- |
| `docs/architecture/2026-11-13-project-config-command-surface.md` | 从 spike 分支原样复制。只改一处:front matter 的 `id` 从 `ARCH-alpha-code-…` 改成 `ARCH-codepuppy-2026-11-13-project-config-command-surface`,与 `#1709` 文档的命名一致,也免得给旧名登记表加一条。正文里的 `origin/alpha` 是分支名;如果旧名扫描点了它,按扫描器的类别登记 |
| `docs/README.md` | 补 spike 分支那一行索引(id 同上) |
| `packages/ui-mac/src/main/project-config-commands.engine.test.ts` | 原样复制;宿主钉的条数改成新的总数 |
| `packages/ui-mac/src/main/project-config-commands.engine.cases.ts` | 原样复制,加一处夹具改动(0.1 第二行的两处都写)。另加三条「今天的行为」:① 四个读取点的 JS 文件头各写一个标记(含 `.codepuppy/skills`);② `system` + `model: "{env:…}"` 的 agent 不在 `/api/agent` 里;③ v1 `mode.<名字>` 与 `.opencode/modes/*.md` 的 agent 是 `primary`。三条都在 0.1 的探针里实测过 |
| `scripts/gate-files.tsv` | 登记上面的宿主(1 条;子进程 14 条) |

### 顺序
1. 一个提交:四个文件加登记行。跑 `cd packages/ui-mac && bun test src/main/project-config-commands.engine.test.ts`,外加 §0 的登记类检查。

### 风险
spike 用例按顺序依赖前一条留下的标记;新加的三条放在最后,只用自己的项目目录,不碰前面的标记。

### 证明
| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01(前提) | `project-config-commands.engine.test.ts` 的 14 条在 `a0abf011c8` 全绿 | 这一段只钉现状。各条后面依次翻转;哪一段的修复不起作用,它负责的那几条就保持「出现」,翻转后的断言因此变红 |

### 偏离记录
- 2026-11-13 · 段 0 的第 ③ 条(`mode` 名字空间与 `.opencode/modes/`)用的是新建 agent,而新建 agent 默认就是 `primary`(`packages/schema/src/agent.ts:44`),钉不住 F-24 说的「已有的 subagent 被变成主 agent」。段 1 的提交改为覆盖出厂 subagent:名字空间覆盖 `general`,目录覆盖 `explore`(`packages/core/src/plugin/agent.ts:63`、`:74`)· 段 1 提交

---

## 段 1:配置装载闸(契约 A3、A4、A8、A10;契约 C)

- 依据:AC-01(MCP、formatter、shell、模型级 `package`、插件 options、`-*`)、AC-02(F-23、F-24 的名字空间那一半)、AC-03 / AC-04(允许臂、`-*`)、AC-06、AC-07;design 契约 A2–A4、A8–A10,契约 B,契约 C,§5「生效时机」「热重载」「多项目」。
- 核对:`027f8f41a3` · 编排器(Claude Fable 5.2)· 通过。裁决见 §0.2 之后的「核对裁决」。

### 1.1 `packages/core/src/config.ts` 的插入点(新接管)

全部在 `load()` 一条调用链上。不改 `reload` / `watch` / `update` / `discover`。

| # | 位置 | 改动 |
| --- | --- | --- |
| 1 | import 区(`:16-24`) | 加一行 import `CodePuppyProjectGate` |
| 2 | `loadFile`(`:168-175`) | 加可选的第二个参数 `gate`。`:172` 交给 `parseInfo` 的文本先经 `gate.raw(substituted)`(用与 `:138` 相同的 jsonc 解析;解析报错 ⇒ 原文照交,上游同样会拒掉这份文档)。`:174` 建 `Document` 之前,解码结果先经 `gate.decoded(info)`(拿掉隐含生成的 agent 控制字段)。共三行 |
| 3 | `loadDirectory`(`:266-273`) | 把 `gate` 原样传给 `:268` 的 `loadFile`。一行 |
| 4 | `load()` 开头(`:275`) | `const gate = CodePuppyProjectGate.begin({ directory: location.directory, home: globalService.home })`:这一次装载只读一次信任(A3) |
| 5 | `direct`(`:276`) | `loadFile(filepath, gate.document(filepath))`。父目录 realpath 恰好是主目录的文档(`~/opencode.json(c)`)交回 `undefined`,走原路(A2) |
| 6 | `projectSupplementary`(`:331-334`) | `loadDirectory(root.path, gate.directory(root.path))`。`~/.opencode` 交回 `undefined` |
| 7 | 返回数组(`:363-373`) | 在 `...managedPolicies` 之后插入 `...gate.documents()`(未允许时的闸门文档,A4),然后 `gate.finish(result)`:给项目条目打标记、配置点记为 done |

已允许时,`gate.document` / `gate.directory` 交回的过滤器只做 A8(去掉 `-*` 与 `-opencode.<id>`,记一行)。没有安装闸门时,`begin()` 交回一个什么都不做的对象,行为与上游逐字节相同(A10)。

### 1.2 校验前过滤的键表(对照 `packages/schema/src/config*` 与 `config/normalize.ts` @ `a0abf011c8`)

**v2 顶层**(`Info`,`packages/schema/src/config.ts:26-125`,共 30 个)全部在契约 B 里有对应的行:
- 保留(未允许也生效):`$schema`、`compaction`、`tool_output`、`media`、`watcher`、`timezone`、`username`、`skills`、`instructions`、`agents` / `commands`(只保留条目里的内容字段)。
- 其余拿掉:`shell`、`model`、`default_agent`、`update`、`share`、`enterprise`、`permissions`、`policies`、`snapshots`、`formatter`、`lsp`、`mcp`、`references`、`websearch`、`plugins`、`worktree`、`warming`、`providers`、`experimental`。
- 已核:保留的这几个键,子字段只调阈值或显示(`config/{compaction,media,tool-output,watcher}.ts`)。

**v1 顶层**(`normalize.ts` 读的原始键):
- 表里有的:`agent`、`mode`、`command`(只保留内容字段)、`reference`、`provider`、`permission`。
- **设计表里没有**(按设计默认暂缓,交编排器核对显示类别):

| 键 | 归一化成什么 | 依据 | 建议的显示类别 |
| --- | --- | --- | --- |
| `attachment` | `media` | `normalize.ts:84-87` | v2 的 `media` 是保留的;建议与它同样保留 |
| `snapshot` | `snapshots` | `:70-72` | `setting` |
| `autoupdate` | `update` | `:73-75` | `setting` |
| `autoshare` | `share` | `:79-83` | `setting` |
| `small_model` | `agents.title.model` | `:137-151` | `agent-control`(title,模型) |
| `tools` | `permissions` | `:179` | `setting`(与 `permissions` 同类) |
| `plugin` | `plugins` | `:185-190` | `plugin` |
| `enabled_providers` / `disabled_providers` | `policies`(`provider.use`) | `:410-428` | `setting` |
| `logLevel`、`server`、`subagent_depth`、`layout` | 不归一化:诊断后丢弃 | `:45`、`:68` | 引擎认不出,见 §0.2 第 2 条 |

**agent 条目字段**:
- v2(`config/agent.ts:11-26`)与 v1(`v1/config/agent.ts:12-43`)的具名字段,契约 B 全部覆盖。
- v1 的条目是 `StructWithRest`:没有具名的字段一律并进 `options`(`:47-52`),作用等同 `request.body`。它们本来就不在保留名单里,一并拿掉。
- v1 的 `name` 在 `KNOWN_KEYS` 里,归一化报 unsupported(`normalize.ts:621`)。它不是内容字段,拿掉。

**command 条目字段**:
- v2(`config/command.ts`)的全部字段契约 B 都覆盖了。
- **v1 的 `variant`**(`v1/config/command.ts:10`,迁移进 `model`,`migrate.ts:61`)设计表里没有。按设计默认暂缓;建议显示为 `command-run`,字段显示「模型」。

**md 文件头**:
- agent 的认字集合是 `variant` 加 v2 字段(`agent.ts:32`),出现 v1 字段时走 v1 解码。
- 命令只按 v2 解码,多余的键丢弃(`command.ts:172`)。
- 技能只有 `name` / `description` / `metadata` / `disable-model-invocation`(`skill-file.ts:10-15`)。技能只做 A5。

实现时把保留名单写成一张常量表(只有名字,不复制 schema)。「认得」由上游判(§0.2 第 2 条)。段 5 的升级检查保证:上游新增字段时这张表必须跟着补分类。

### 1.3 「允许」怎样到达每个作用点(装载时)

1. sidecar 调 `startEngine(options, { onDispatch, projectTrust: engineProjectTrust })`。`engine-embed.ts` 在调上游 `start()` 之前执行 `CodePuppyProjectGate.install({ trusted })`;钩子缺失就抛错,sidecar 走 `sidecar.ts:204-206` 的既有失败路径,不报 ready(契约 C)。
2. 每次 `Config.load`(首次 `:378`,以及每次 `reload()` `:403-404`)调一次 `begin()`。`begin()` 调 `trusted(realpath(location.directory))`;抛错就按未允许处理并记一行(A3)。
3. `gate.finish()` 用模块私有的 `WeakSet` 标记这一代的项目条目(Document / Directory 实例)。未允许时,闸门文档实例就是这一代信任值的载体。
4. agent / command / skill 三个读取点从它们读到的那一份 `config.entries()` 里查标记:某个条目是不是项目内容、这一代是否未允许。它们读的是同一个快照,所以同一代里只用一个信任值(I-5)。
5. 两个项目文件夹同时打开时,各是一个 Location:各有各的 `Config.layer`、各读各的信任、各有各的条目与标记(AC-07)。唯一例外是 §5 写明的:已允许项目加载进来的插件代码作用于整个进程。

### 改动
| 文件 | 改什么 |
| --- | --- |
| `packages/schema/src/codepuppy-project-config.ts`(新) | 契约 D 的类型与 `WITHHELD_KINDS`,逐字照设计;纯模块,零依赖 |
| `packages/core/src/config/codepuppy-project-gate.ts`(新,Code Puppy 自有) | `install`(契约 C);`begin` / `document` / `directory` / `raw` / `decoded` / `documents` / `finish`;A2 分类;契约 B 保留名单(v1 / v2);A8;闸门文档(每个项目 `.opencode` 目录写 `<d>/plugin/*`、`<d>/plugins/*` 两条 deny);按 Location 目录记的视图登记(配置点状态与暂缓条目,只记名字、类别、出处);日志只记目录、类别、计数。另有一个只给测试用的私有重置函数,不属于冻结接口 |
| `packages/core/src/config.ts`(新接管) | 1.1 的七处 |
| `scripts/north-star-guard.sh` | `UPSTREAM_EXCLUDES` 加 `config.ts` 一条,注释写 ADR-049 与判据文件 |
| `packages/ui-mac/engine/engine-embed.ts` | `hooks.projectTrust` 必填;`start()` 之前 `install`;缺失就抛错 |
| `packages/ui-mac/src/main/env.d.ts` | `virtual:opencode-server` 的 hooks 类型 |
| `packages/ui-mac/src/main/engine-project-trust.ts`(新) | 契约 C 的读法:`projectDirectoryIdentity` 为 `project` 且 `readProjectExtensionsConsent` 为 `true`;任何异常 ⇒ `false`。sidecar、测试宿主、各驱动共用这一份 |
| `packages/ui-mac/src/main/sidecar.ts` | `startEngine` 调用(`:171-188`)传 `projectTrust` |
| 其余 20 个 `startEngine(` 调用方(`rg 'startEngine\('` @ `a0abf011c8`:`test-component/codepuppy-engine.ts`;`test-fixtures/{net-failure,process-fence}/*-driver.ts`;`test-live/packaged-natives/engine-driver.ts`;`src/engine-adapter/internal-projects.engine.cases.ts`;`src/renderer/extensions/use-extensions-recovery.cases.ts`;`src/main/` 下 12 个 `*.cases.ts`;`packages/ext/src/policy/session-grant-restart.test.ts`、`packages/ext/src/upstream-probes/engine.cases.ts`) | 机械地补上 `projectTrust`。测试宿主加 `projectTrust` 选项,默认用生产读法,另加一个经生产写端 `recordProjectTrustDecision` 记允许的小工具。§0.2 第 3 条那四套记允许 |
| `packages/ui-mac/src/main/project-config-commands.engine.cases.ts` | 拆成两臂,同一台引擎:**未允许臂**(断言按下面「证明」翻转)、**允许臂**(同一份夹具换一组项目名,经生产写端记允许,断言保持今天的样子,只有 `-*` / `-opencode.config.agent` 两条改成「会话照常」)。标记按臂加前缀 |
| `packages/core/test/codepuppy-project-gate.test.ts`(新) | 在上游 `Config.layer` 上用临时目录测(先例 `test/config/config.test.ts`),见「证明」 |
| `scripts/gate-files.tsv` | 新的核心判据文件;宿主条数 |

### 顺序
1. **提交 A**:schema 类型、闸门模块、`config.ts` 的七处、守卫那一条、核心判据。跑:
   - `cd packages/core && bun test test/codepuppy-project-gate.test.ts test/config/config.test.ts test/config/reload.test.ts test/config/discovery.test.ts test/config/normalization.test.ts test/config/policy.test.ts`
   - `bun run typecheck`(core、schema)
2. **提交 B**:契约 C 的钩子(`engine-embed.ts`、`env.d.ts`、`engine-project-trust.ts`、`sidecar.ts`)、20 个调用方、宿主默认值与四套记允许。跑:
   - 改过的每个 `*.cases.ts` 经它在 `gate-files.tsv` 里登记的宿主运行;
   - `src/main/codepuppy-sidecar-wiring.test.ts`、`src/main/sidecar-location-prewarm.test.ts`(这两个按 sidecar 源码文本判顺序);
   - `src/main/net-failure-real-stack.test.ts`(它会现打引擎包);
   - `src/main/process-fence-engine.test.ts`;
   - ui-mac / ext 的 typecheck。
3. **提交 C**:spike 用例拆成两臂并翻转本段负责的那几条。跑 `src/main/project-config-commands.engine.test.ts`,外加 §0 的登记类检查。

### 风险
- **核心模块的全局状态会串到上游测试**。bun 在同一个进程里跑多个测试文件。闸门判据在 `afterEach` 里调私有重置;上游的 `test/config/*.test.ts` 与判据一起跑必须仍然全绿(A10)。
- **配置的热重载可能被丢弃**。`reload()` 在新旧配置深度相等时丢弃新的一份(`:409`)。规则:配置点的暂缓条目总是取最近一次 `load` 的结果;闸门交给上游的那部分(过滤后的文档、闸门文档、信任值)与上一次不同 ⇒ 这一代必然会发布 ⇒ 把上一代登记过的其余作用点重新标成 `pending`,等它们重跑。判据里用「只改暂缓键的值」与「新加一个暂缓键」各钉一条。
- **改动面**:20 个调用方是机械修改。其中四套原本依赖项目控制键,不记允许就会红,这正是它们需要改的证据。如果另有遗漏的,跑宿主时就会显出来。
- **未允许臂的命令插值**:本段只拿掉了 `shell` 键,插值要到段 2 才关;所以本段里 `command-*-template` 标记仍然出现,只是改由默认 shell 执行。

### 证明
| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01 | `project-config-commands.engine.test.ts` 未允许臂:open 后没有 `mcp-local`,`/api/mcp` 里没有 `cpi12mcp`;写 `.txt` / `.php` 后没有 `formatter-config` / `formatter-builtin-pint`;模型 shell、输入框 shell、默认终端都不再写 `shell-key`;没有 `model-package`;重新声明的全局插件拿到的是 `{who:"user"}`;`-*` 与 `-opencode.config.agent` 的项目里,插件与只读档 agent 都在,一轮对话拿到回复 | 不过滤 ⇒ 这些标记与状态回到段 0 钉住的样子,翻转后的断言变红 |
| AC-01 | `codepuppy-project-gate.test.ts`:「每个暂缓键(v1 与 v2)都在校验前拿掉」「保留名单之外的未知键也拿掉」「闸门文档在托管策略之后,`<d>/plugins/x.js` 判为 deny」 | 保留名单里多放一个 `mcp` ⇒ 第一条红;闸门文档放到项目文档之后 ⇒ 项目自写的 `allow plugin.use *` 胜出,第三条红 |
| AC-02 | 判据:「`system` + `model:"{env:未设}"` 的 agent 留下,提示词在」「v1 `mode.<名字>` 解码后没有 `mode`」;spike 未允许臂的 ②③ 两条(名字空间那一半)翻转 | 不在校验前拿掉 ⇒ 整条 agent 被丢(F-23);不在解码后再拿一次 ⇒ 成为 `primary`(F-24) |
| AC-03 / AC-07 | spike 允许臂:与未允许臂同一台引擎、同时打开,今天的每一条照旧出现(MCP 启动,formatter、pint、项目 shell、模型级 package、项目 options 都生效) | 闸门把已允许的项目也过滤了 ⇒ 允许臂红;两个 Location 的信任串了 ⇒ 两臂里总有一臂红 |
| AC-04(后半) | 允许臂:写了 `plugins: ["-*"]` 的项目新建会话,能拿到模型回复;`-opencode.config.agent` 的项目里只读档 agent 还在。判据「已允许时只去掉 `-*` / `-opencode.*`,`-x` 保留」 | 不做 A8 ⇒ 会话起不来(spike 段 0 那一条) |
| AC-06 | 允许臂与未允许臂都看到全局配置目录里的插件 `cpi12.global`(以及它的 `{who:"user"}`);判据「父目录是主目录的 `opencode.json` 不过滤,主目录以下各级都过滤;打开的文件夹在主目录之外时,遍历到的每一份都过滤」 | 把用户全局也过滤了 ⇒ 全局插件 / options 消失,两臂都红 |
| 契约 C | 判据「`trusted` 抛错 ⇒ 未允许,并记一行」「未安装 ⇒ 与上游 `Config.layer` 的条目深度相等」;`sidecar-engine-host.cases.ts` 加一条「不传 `projectTrust` ⇒ `startEngine` 拒绝」 | 抛错时放行 ⇒ 第一条红;未安装时也改条目 ⇒ 第二条红;钩子缺失照常起 ⇒ 第三条红 |

### 偏离记录
- 2026-11-13 · **一个提交**:按编排器的裁决(每段一个提交),原计划的提交 A / B / C 合成一个。
- 2026-11-13 · **`config.ts` 插入点实际落位**(全部带 `codepuppy(ADR-049)`):
  - import `:22`;
  - `loadFile` `:169`(签名)、`:173`(校验前)、`:175`(解码后);
  - `loadDirectory` `:267`、`:269`;
  - `load()` 开头的标注块 `:277-280`(`begin`);
  - `direct` `:281`;`projectSupplementary` `:338`;
  - 返回 `:368`(`gate.finish`)、`:370`(`gate.documents()`)、`:379`。

  与 1.1 的七处一致。`finish` 是一个 Effect(要记日志),交回同一份条目。
- 2026-11-13 · **design §4 契约 B 表补四行**(编排器裁决):`attachment` 与 `media` 一样生效;七个 v1 写法暂缓,列「其他 OpenCode 设置」;v1 `plugin` 归「插件」行;命令 `variant` 归「命令的运行设置」。闸门的名单与视图分类照此实现。引擎完全不认的键(如 `logLevel`、`layout`)拿掉、不列,由上游归一化判定。
- 2026-11-13 · **记允许的四套用例**:
  - `composer-tier-matrix`:主宿主一处,加「规则写在项目 opencode.json」两种放法那一处;
  - `websearch-honest`:不装 ext 那一臂;
  - `codepuppy-config-injection-engine`:只有 C7 两臂经引擎装载项目文档。flags 那一臂是在内存里拼条目的,不经闸门,不改;
  - `use-extensions-recovery`:直接调 `startEngine`,钩子只对它自己的项目回 true。

  测试宿主新增 `allowProject(directory)`,走生产写端。
- 2026-11-13 · **允许臂多证明一件事**:`.codepuppy/codepuppy.jsonc` 的 MCP 与 OpenCode 配置跟着同一个决定一起放开(BR-04)。未允许臂仍不启动它。
- 2026-11-13 · **#1708 引擎用例的过渡改动**(本来计划在段 3):其中三条判的是 #1708 自己的机制(显式文件去掉 plugin.use、只放内联、按包名放行),依赖项目的插件声明到得了引擎。闸门在未允许时把这些声明拿掉了,所以这三条改用全部允许的项目跑;第一条(生产注入)仍用生产读法。段 3 退役 #1708 时这一组整体改写。
- 2026-11-13 · **上游探针**(`packages/ext/src/upstream-probes/engine.cases.ts`)的钩子改成 `() => true`。探针量的是上游对项目文档的行为,也就是已允许项目拿到的行为(A8 只差两条内置移除指令)。若用生产读法,P3「项目 deny 生效」那一臂会红,因为项目的 `policies` 被暂缓了。
- 2026-11-13 · 契约 C 的「不传 `projectTrust` ⇒ 拒绝」放在 `sidecar-engine-host.cases.ts`(宿主条数 6 → 7)。变异实测:去掉 `engine-embed.ts` 里的检查,这一条变红。
- 2026-11-13 · **视图登记只有配置点**(按计划)。核心判据 `packages/core/test/codepuppy-project-gate.test.ts` 共 7 条,每条带反向臂;另对闸门模块做了六处变异,各自让对应用例变红(见交回报告)。

---

## 段 2:md 读取点(契约 A5、A6、A7)

- 依据:AC-01(JS 文件头、命令插值)、AC-02(md agent 用自己的提示词但不带控制字段,`modes/` 目录的那一半,模板原文发出)、AC-03(允许臂);design 契约 A1-2/3/4、A5–A7,契约 B 的 md 与命令各行,§6 接管面表。
- 核对:`027f8f41a3` · 编排器(Claude Fable 5.2)· 通过。裁决见 §0.2 之后的「核对裁决」。

### 2.1 三个文件的插入点

**`packages/core/src/config/plugin/skill.ts`(新接管)**:
- `sources`(`:80`):改成 `sources(entries = loaded.entries)`,`:86`、`:87` 里的 `loaded.entries` 换成 `entries`(三行)。这样闸门可以把「只含项目条目」的列表交给上游自己的 `sources()`,按上游的规则解析出项目来源(含 URL),不另写第二份解析。
- `refresh`(`:149-157`):算出这一代哪些来源是项目内容。规则是 A2:`sources(项目条目)` 的结果,并上所有位于打开的文件夹之内的目录来源(含显式层的 `./.codepuppy/skills`)。算出后传给 `load`;本作用点的登记(pending → done / failed)也包在这里。
- 读取点(`:126-128`):`SkillFile.parse` 收到的内容,对项目来源先经 `CodePuppyProjectGate.frontmatter(...)`。

**`packages/core/src/config/plugin/agent.ts`(新接管)**:一个标注块,覆盖 `:42-55`。
- `loadEntry` 对打了项目标记的目录条目:读到的内容先过闸门的文件头解析(A5),拿掉控制字段;`decode` 之后再拿掉 `mode/`、`modes/` 隐含生成的 `mode: "primary"`(A6)。闸门在读取点就拿掉 `primary`,`:183` 不改。
- `load` 包一层作用点登记。

**`packages/core/src/config/plugin/command.ts`(已接管,扩展)**:
- `loadEntry`(`:28-33`):返回值带上 `gated`(本代未允许,且条目是项目内容)。
- `load`(`:40-42`):作用点登记。
- `loadDirectory` / `decode`(`:151-182`):`loadDirectory` 多收一个文件头函数,`:158` 交给 `decode` 之前先过它。
- `execute`(`:69-73`):`gated` 时 `evaluateTemplate` 不做插值;`:209-210` 加一个条件,`!\`…\`` 原文留在发出的文字里(A7)。

**文件头解析**(闸门模块私有):
- 用 `gray-matter` 解析,`engines` 里把 `javascript` 换成一个只记录、不执行的引擎。`js`、`JavaScript` 经 gray-matter 自己的别名表(`lib/engine.js` 的 `aliase`)落到同一个引擎;未注册的语言(如 `coffee`)照旧抛错,与上游一样跳过这个文件。
- 失败时回退到上游导出的 `ConfigMarkdown.sanitize`,不复制一份。
- 然后把文件头重新写成 YAML,加原正文,交给上游解码器。正文逐字保留。
- 只有在文件真有文件头时才改写,没有文件头的原样交出。

### 改动
| 文件 | 改什么 |
| --- | --- |
| `packages/core/src/config/plugin/skill.ts`(新接管) | 2.1 |
| `packages/core/src/config/plugin/agent.ts`(新接管) | 2.1 |
| `packages/core/src/config/plugin/command.ts` | 2.1,放进新的 `codepuppy(ADR-049)` 标注 |
| `packages/core/src/config/codepuppy-project-gate.ts` | 文件头解析与改写;md agent / 命令的控制字段拿掉与登记(`agent-control`、`command-run`、`frontmatter-code`);作用点登记;技能来源分类 |
| `scripts/north-star-guard.sh` | `UPSTREAM_EXCLUDES` 加 `skill.ts`、`agent.ts` 两条 |
| `packages/core/test/codepuppy-project-gate.test.ts` | 见「证明」 |
| `packages/ui-mac/src/main/project-config-commands.engine.cases.ts` | 两臂里本段负责的那几条翻转;md agent 带控制字段的样本、`.opencode/modes/` 样本 |

### 顺序
1. **提交 A**:闸门的文件头解析、三个文件、守卫两条、核心判据。跑:
   - `cd packages/core && bun test test/codepuppy-project-gate.test.ts test/config/agent.test.ts test/config/skill.test.ts test/config/command.test.ts test/config/command-subagent.test.ts test/config/markdown.test.ts test/codepuppy-command-model-priority.test.ts`
   - core typecheck
2. **提交 B**:引擎用例翻转。跑 `src/main/project-config-commands.engine.test.ts`,外加 §0 的登记类检查。

### 风险
- **改写后正文必须逐字不变**。技能用的 `markdown.content` 不 trim(`skill-file.ts:59`)。判据用「同一份 YAML,未允许与已允许读出的 data 与 content 都相等」钉住,含 `sanitize` 回退那一种。
- **md agent 的 v1 / v2 判定会变**。控制字段拿掉以后,原本因 v1 专有字段走 v1 解码的文件可能改走 v2,于是 v1 主题色名(如 `primary`)从 `#aaaaaa` 变成不显示。只影响颜色显示;在判据里写明。
- **技能来源分类依赖 `sources()` 的签名**。上游改 `sources()` 时同步必须复核(列进 ADR-049 的复核清单)。

### 证明
| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01 | spike 未允许臂的 ①:四个读取点都没有标记,条目仍在列表里、正文生效;判据「`---javascript` / `---js` 不执行(探针标记不出现),记 `frontmatter-code`」 | 不换 JS 引擎 ⇒ 标记出现(段 0 已钉) |
| AC-01 | 未允许臂「user」「shadow」两条:`cpi12cmd`、`cpi12dir`、`/review`、`/init` 的插值标记都不出现,模型请求里是 `` !`…` `` 原文 | 不关插值 ⇒ 标记出现 |
| AC-02 | 未允许臂:带 `mode` / `model` / `permissions` 的 md agent 在 `/api/agent` 里,`system` 是正文,不是 `primary`,不带模型;`.opencode/modes/x.md` 不是 `primary`(③ 的目录那一半翻转);md 命令的 `agent` / `model` / `subtask` 不生效,模板生效 | 不在校验前拿掉 ⇒ 无效的 model 让整条被丢,或者控制字段生效;不在解码后再拿一次 ⇒ `primary` |
| AC-02 | 判据「同一份 YAML 未允许与已允许读出相同的 data 与正文」「技能来源分类:项目目录、项目文档 `skills`(含 URL)、文件夹内的 `.codepuppy/skills` 都算项目内容;全局配置目录与 `~/.opencode/skills` 不算」 | 改写弄丢字段或换行 ⇒ 第一条红;把用户全局也当项目 ⇒ 第二条红 |
| AC-03 | 允许臂:四个 JS 文件头的标记出现,md agent 是 `primary` 且带模型,插值标记出现 | 已允许也被闸门改写 ⇒ 红 |
| A10 | 上游 `test/config/{agent,skill,command,command-subagent,markdown}.test.ts` 全绿 | 闸门在未安装时也作用 ⇒ 上游用例红 |

### 偏离记录
- 2026-11-14 · **A10 基线证据替换**:编排器复核 `test/config/command-subagent.test.ts` 在不含 #1713 的 `fed47ed022` 上同样为 1 pass / 3 fail:三条上游断言期望命令或 agent 的模型 `override` / `child`,而 Code Puppy `#1560` 已规定用户所选的父会话模型 `parent` 优先。本段不改该测试与 `#1560` 行为;A10 改由 `test/config/{agent,skill,command,markdown}.test.ts` 与 `test/codepuppy-command-model-priority.test.ts` 全绿,以及该上游文件保持相同三条名称、相同 expected / received 的 1 pass / 3 fail 共同证明。

---

## 段 3:插件在允许后加载(退役 `#1708` 的先拒全部)

- 依据:AC-01(插件,含重新声明 options、`-*`)、AC-03(插件加载)、AC-06(全局插件);design 契约 A4 的闸门文档、A8,§6「冻结的边界」,§10 R-07。
- 核对:`027f8f41a3` · 编排器(Claude Fable 5.2)· 通过。裁决见 §0.2 之后的「核对裁决」。

**「按包名借道」的处置**:R-07 写明它随之不存在,因为未允许项目的插件声明到不了引擎(`plugins` / `plugin` 在校验前拿掉;`.opencode/plugin(s)/` 被闸门文档拒)。本段不保留它的代码,只把 `#1708` 的各种借道写法留作未允许臂的回归用例。已允许的项目本来就可以运行代码,借道对它没有意义。

### 改动
| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/src/main/engine-plugin-policy.ts`、`engine-plugin-policy.test.ts` | 删除 |
| `packages/ui-mac/src/main/codepuppy-config-injection.ts` | 撤回 `#1708` 的改动:`pluginPolicies`、`layer.plugins`、内联的 `plugin.use`、失败路径里的 `policies`;`readTextSafe` / `engineHome` 没有别的用处就一起删 |
| `packages/ui-mac/src/main/engine-explicit-config.ts` | `ExplicitLayer.plugins`、`composeExplicitDocument` 的合并、`watchExplicitSources` 的 `plugins` 都退回 `#1708` 之前的样子 |
| `packages/ui-mac/src/main/{codepuppy-config-injection,config-injection-throat,engine-explicit-config}.test.ts` | 撤回专门断言 `#1708` 的那几处 |
| `packages/ui-mac/test-component/codepuppy-engine.ts` | 删掉为探针加的那段 `plugin.use` 放行(`:180-189`) |
| `packages/ui-mac/src/main/engine-plugin-policy.engine.{cases,test}.ts` | 原地改写,条数随之改。**未允许臂**:`#1708` 的 AC-01/02/04/05 全部目标都不执行(`.opencode/plugins/*.js`、`.opencode/plugin/*.ts`、相对 / 绝对 / 包名条目、自带「已同意」、项目自写 `allow plugin.use *`、项目与主目录之间上级目录的 `.opencode`、同名目录 / 文件 / `<包>@file:<项目目录>`、落进通配的路径)。**允许臂**(经生产写端记允许):同样这些项目自己的插件都执行。**两臂**:全局配置目录的插件文件与条目、`~/.opencode/plugins/h.js`、全局的包名条目都执行;用户在 `codepuppy.jsonc` 里自己写的 `plugin.use` deny 仍然生效 |
| `.claude/rules/adrs/ADR-040-extension-package-taxonomy.md` | 后果 4 改写为「项目来源的目录插件在信任闸门之后」(design §6「架构约束」) |
| `scripts/gate-files.tsv` | 删掉单元判据那一行;改写宿主那一行的条数与说明 |
| `scripts/old-name-exceptions.tsv` | 删掉 `#1708` 那几条(文件删了,旧名命中随之消失) |
| `packages/ui-mac/src/main/project-config-commands.engine.cases.ts` | 允许臂加一个 `.opencode/plugins/x.js`,断言它执行;未允许臂断言同一个不执行 |

### 顺序
1. 一个提交(先删后改;同一提交里闸门文档独自承担拒绝)。跑:
   - `cd packages/ui-mac && bun test src/main/engine-plugin-policy.engine.test.ts src/main/project-config-commands.engine.test.ts src/main/project-consent-store.engine.test.ts src/main/codepuppy-config-injection.test.ts src/main/config-injection-throat.test.ts src/main/engine-explicit-config.test.ts`
   - ui-mac typecheck
   - §0 的登记类检查

### 风险
- **包形式插件的模块缓存**。包形式的插件按文件地址进模块缓存,同一进程里第二次装载不再求值(`#1708` 用例抬头写过这一点)。改写后的用例里,第一个装载包的那台引擎必须是期望「执行」的那一臂。
- **用户自己的 `plugin.use` 层序**。显式文件排在项目文档之前;去掉我们的放行之后,用户写的语句照引擎规则生效。用例钉 deny 那一种。

### 证明
| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01 | `engine-plugin-policy.engine.test.ts` 未允许臂:每个项目标记都不出现 | 闸门文档不写或写错 ⇒ `.opencode/plugins` 的标记出现;`plugins` 不在校验前拿掉 ⇒ 配置条目的标记出现 |
| AC-03 | 允许臂:同样这些项目标记都出现;spike 允许臂的 `.opencode/plugins/x.js` 出现 | 先拒全部还留着 ⇒ 允许臂不出现 |
| AC-06 | 两臂里全局目录与 `~/.opencode` 的插件都执行,全局包名条目也执行 | 把用户全局当项目 ⇒ 两臂红;先拒全部还留着 ⇒ 包名条目不执行 |
| 用户的策略 | 用户在 `codepuppy.jsonc` 里 deny 的全局插件不执行 | 闸门盖过用户的 deny ⇒ 红 |

### 偏离记录
暂无

---

## 段 4:确认框清单与主进程 ⇄ sidecar 视图消息(契约 D、E)

- 依据:AC-05(四种情形)、AC-04(已允许的项目不再询问)、AC-07;design 契约 D(视图、作用点状态、不完整不产生决定)、契约 E(行模板、中文叫法)、§5「视图拿不到或不完整」;spec「体验约定」的确认框原文(owner 已通过,逐字使用)。
- 核对:`027f8f41a3` · 编排器(Claude Fable 5.2)· 通过。裁决见 §0.2 之后的「核对裁决」。

### 4.1 授权在运行中发生之后(重载路径;两个文件夹各自决定)

1. 用户点「允许加载」,main 写记录(`ext-ipc.ts:621-631`,不变)。
2. renderer 请求重载(`ext-trust-watcher.tsx:52-54`,`scope: "global"`)→ main 的 `reloadRequest`(`ext-ipc.ts:1350`)→ ext 调度器(`packages/ext/src/reload-scheduler.ts`)等到全部会话空闲(或用户强制)→ `POST /api/location/reload`。
3. `LocationServiceMap.reload`(`packages/core/src/location-service-map.ts:20-35`)使每个已加载的 Location 失效并重建 ⇒ 每个 Location 的 `Config.layer` 重新 `discover` + `load`(`config.ts:376-378`)⇒ 段 1 的 `begin()` 各自重新读信任。
4. 刚允许的文件夹:原样交出,只做 A8,没有闸门文档;另一个仍未允许的文件夹:照旧过滤并带闸门文档。agent / command / skill / 插件来源随新条目重新激活。
5. 项目配置文件在盘上改动时,走 `config.ts:401-415` 的热重载,同样每次重新读信任(§5「热重载」);已允许的项目因此不再询问,新内容立即生效(AC-04)。

### 改动
| 文件 | 改什么 |
| --- | --- |
| `packages/core/src/config/codepuppy-project-gate.ts` | `view(directory)`:按段 1 / 段 2 记下的作用点状态与暂缓条目给出 `ProjectConfigView`。条目按 kind、file、name 排序去重,同一条的 `fields` 取并集。`complete` = 每个已登记的作用点都是 `done` |
| `packages/ui-mac/engine/engine-embed.ts`、`src/main/env.d.ts` | 导出 `projectConfigView(directory)`;引擎包里只有一份闸门模块 |
| `packages/ui-mac/src/main/project-config-view-message.ts`(新) | 契约 D 的请求 / 应答 build / parse(`id: string`,照冻结的签名);parse 一律 fail-closed;main 侧的请求簿(超时或子进程退出 ⇒ `undefined`)。形制同 `workspace-write-probe.ts` |
| `packages/ui-mac/src/main/sidecar-project-config-view.ts`(新) | sidecar 侧作答:经进程内 fetch 对该目录 `GET /api/command`、`/api/agent`、`/api/skill`(它们要等插件激活结束才返回)→ 有界等待仍为 `pending` 的作用点 → 读视图 → 应答。引擎未就绪 ⇒ `engine-not-ready`;列表请求失败 ⇒ `location-failed` |
| `packages/ui-mac/src/main/sidecar.ts` | 命令族加 `project-config-view`(与 `write-probe` 同处:分发 `:124-136`、解析 `:291`) |
| `packages/ui-mac/src/main/server.ts` | 请求簿接到子进程消息上(`:575-588`);`SidecarListener.projectConfigView` |
| `packages/ui-mac/src/main/index.ts` | `registerExtIpcHandlers` 多收一个 `projectConfigView`(`:1033`;引擎没在运行 ⇒ `undefined`) |
| `packages/ui-mac/src/main/codepuppy-ext-trust.ts` | 纯函数:由 `.codepuppy` 可执行物与 `view.withheld` 生成清单行。九类各一行,顺序照契约 E;同类多项用顿号连在一行;括号里的字段用中文叫法(契约 E 末段,含现有 `.codepuppy` agent 那一行)。不折叠(现有框也不折叠) |
| `packages/ui-mac/src/main/ext-ipc.ts` | `ext-trust-check`(`:538-633`):`#356` 的账本收编保持在最前;先取身份并读决定,已有决定 ⇒ 不弹框、不请求视图;否则请求视图,同一次检查里有界重试;仍拿不到或 `complete:false` ⇒ 不弹框、不写记录,记一行,返回 `incomplete: true`;两边都空 ⇒ 不弹框;否则弹框,标题、提问、说明、按钮一字不改 |
| `packages/ui-mac/src/preload/types.ts` | trust-check 的返回加 `incomplete?: boolean` |
| `packages/ui-mac/src/renderer/codepuppy-ui/ext-trust-watcher.tsx` | `incomplete` ⇒ `checked.delete(dir)`,下一次进入这个文件夹的会话时再问 |
| `packages/ui-mac/test-component/ext-trust-check.ipc.cases.ts` | 新增五条(见「证明」);宿主条数 7 → 12 |
| `packages/ui-mac/src/main/project-config-view.engine.{cases,test}.ts`(新) | 真引擎上的视图(见「证明」) |
| `packages/ui-mac/test-component/ext-trust-watcher.cases.ts` + `src/renderer/codepuppy-ui/ext-trust-watcher.component.test.ts`(新) | renderer 再问的组件用例(happy-dom,先例 `draft-route-gate`) |
| `scripts/gate-files.tsv` | 新宿主与条数 |

### 顺序
1. **提交 A**:视图读法、消息文件、sidecar 作答、`sidecar.ts`、`server.ts` 接线。跑 `bun test src/main/project-config-view-message.test.ts src/main/project-config-view.engine.test.ts src/main/codepuppy-sidecar-wiring.test.ts src/main/workspace-write-probe.test.ts`。
2. **提交 B**:清单行与 `ext-trust-check`、`index.ts`、preload 类型。跑 `bun test src/main/codepuppy-ext-trust.test.ts src/main/ext-trust-check.test.ts`。
3. **提交 C**:renderer 再问与组件用例。跑 `bun test src/renderer/codepuppy-ui/ext-trust-watcher.component.test.ts`,外加 ui-mac typecheck 与 §0 的登记类检查。

### 风险
- **第一次进入时视图要等 Location 装好**:冷启动可能要几秒。超时与重试次数是私有常量,用例里注入短时限。取不到时的后果只是「这次不问」,下一次进入再问。
- **列出命令 / agent / 技能会顺带让该目录的 Location 装起来**。这正是视图需要的;未允许时可执行内容照旧暂缓。

### 证明
| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-05 ① | `project-config-view.engine.test.ts`:spike 夹具的项目(没有 `.codepuppy/`)⇒ sidecar 作答给出九类里应有的每一条(kind、name、file、fields),经 `codepuppy-ext-trust` 的清单函数生成的行与 spec「体验约定」的写法一致;`ext-trust-check.ipc.cases.ts`「只有 OpenCode 可执行设置也弹框,正文逐字」「九类全有时 detail 与 spec 样子逐字相等」 | 视图漏一类 ⇒ 引擎用例红;清单函数漏行或字段写成原始名 ⇒ IPC 用例红 |
| AC-05 ② | 引擎用例:只有 AGENTS.md 与技能的项目 ⇒ `withheld: []`、`complete: true`;IPC 用例「空视图、无 `.codepuppy` 可执行物 ⇒ 不弹框」 | 把内容类也列进去 ⇒ 弹框,用例红 |
| AC-05 ③ | IPC 用例「视图 `ok:false` / `complete:false` / 超时 ⇒ 不弹框、不写记录,返回 `incomplete`;第二次给完整视图 ⇒ 弹框」;组件用例「`incomplete` ⇒ 下次进入同一文件夹再查一次;已决定 ⇒ 不再查」;闸门判据「某个作用点 `failed` 或 `pending` ⇒ `complete:false`;没有激活的作用点不算」 | 不完整也弹框 ⇒ IPC 用例的 `shown` 非空;renderer 记成已问 ⇒ 组件用例里第二次没有查询 |
| AC-05 ④ | 引擎用例:用户全局 `plugins: ["-opencode.config.skill"]` 加一个项目 MCP ⇒ `complete: true`,列出 mcp 那一条 | 把被停用的作用点当成不完整 ⇒ `complete:false`,用例红(R2 第 3 条) |
| AC-04 前半 | IPC 用例「已有决定 ⇒ 不请求视图、不弹框」;引擎用例「已允许的项目运行中往 `opencode.json` 加一个本地 MCP ⇒ 热重载后标记出现」 | 已决定还去问 ⇒ 请求计数非零;热重载不重新读信任 ⇒ 新 MCP 不起 |
| AC-07 | 引擎用例:同一台引擎里一个已允许、一个未允许的目录,各自的视图互不影响(`trusted` 与 `withheld` 各自正确) | 视图按目录串了 ⇒ 红 |
| 消息 | `project-config-view-message.test.ts`:类型错 / id 不是字符串 / 缺字段 ⇒ `undefined`;超时与子进程退出 ⇒ `undefined` | parse 宽松 ⇒ 半个应答也当真 |

### 偏离记录
- 2026-11-14 · 审查修复 1:核实无变化重载丢 md 记录;同信任值时原地更新 config 点,保留其他作用点与 reads。核心新增在途 / 完成两种重载判据,真引擎新增保存原文触发重载后清单不丢的判据;AC-07 改为点名类别。红臂:核心 1 挂、真引擎 md / 类别断言挂。
- 2026-11-14 · 视图的排序、去重与作用点状态已由段 1 / 2 实现。本段在 `finish()` 复用上游 `PluginSourceDirectory.discover` 补登记目录插件,不另写扫描器;把插值字段从段 2 的 `!` 写法统一成契约 D 的 `shell`。同调用链的 `packages/core/test/codepuppy-project-gate.test.ts` 同步该字段断言。`codepuppy-sidecar-wiring.test.ts` 在既有同一子进程接线判据里补视图往返,并同步动态 import 新导出的源码锚;不增加源码读取点。
- 2026-11-14 · `codepuppy-ext-trust.test.ts` 属清单纯函数同调用链,补中文字段去重与同类合并的行为判据;原 IPC 用例两处原始字段名断言按契约 E 翻成中文。提交 C 补上真引擎视图经该纯函数生成九行的逐字断言,闭合 A 与 B 的证据链。

---

## 段 5:三个新接管的 ADR、权威登记册、升级检查与文档

- 依据:design §6 接管面表、「升级检查(ADR-048 决定 4)」、「上游挂点需求」、§9 回滚;CLAUDE.md「新增收编须自己的 ADR」;ADR-048 决定 4。
- 核对:`027f8f41a3` · 编排器(Claude Fable 5.2)· 通过。裁决见 §0.2 之后的「核对裁决」。

### 5.1 上游同步时每个文件必须复核的清单(写进 ADR-049 与 `docs/runbooks/upstream-update.md`)

| 文件 | 复核什么 |
| --- | --- |
| `config.ts` | `load()` 返回的分类与顺序(托管策略最先;闸门文档插在其后);`loadFile` 的流程(读 → 替换 → `parseInfo` → `Document`);`reload()` 的发布条件(深度相等就丢弃,`:409`);`Options.project` 的语义;条目种类有没有新增 |
| `config/discovery.ts`(未接管,依赖它) | 向上遍历与全局根排除(`:78-81`、`:121-126`);`direct` / `project` 两组的构成 |
| `config/normalize.ts`(未接管) | v1 写法的读取点;隐含生成的字段(`:137-154`) |
| `skill.ts` | `sources()` 的解析规则与签名;读取点是不是仍然只有 `SkillFile.parse` |
| `agent.ts` | `legacySources` 的目录与 `primary`;`agentKeys` / `nativeKeys` 与 v1 / v2 的判定;解码输出的形状 |
| `command.ts` | md 解码;`evaluateTemplate` 的插值正则与流程;命令有没有新的控制字段 |
| `config/markdown.ts`、`plugin/module.ts`、`config/plugin/source.ts`、`plugin/internal.ts`(未接管) | gray-matter 的版本与引擎表;`sanitize` 仍然导出;`plugin.use` 判定点与它比较的目标串;目录插件的目标保留发现时的路径;受保护的内置插件集合 |

### 改动
| 文件 | 改什么 |
| --- | --- |
| `.claude/rules/adrs/ADR-049-project-opencode-config-behind-trust.md`(新) | 内容即 design §6 接管面一节:三个新接管、`command.ts` 的扩展、为什么挂不了钩子、改动面、5.1 的复核清单、回滚(§9)、上游挂点需求;owner 原话按先例格式引用(「要做。」,2026-11-13,编排器转达) |
| `.claude/rules/adrs/ADR-047-opencode2-engine-generation.md` | 「精确接管面」表加三行(`config.ts`、`skill.ts`、`agent.ts`);`command.ts` 那一行补 `codepuppy(ADR-049)` 标注与判据;「权威保持表」加一行,条数 57 → 58 |
| `docs/architecture/codepuppy-authority-registry.json` | 新条目 `project-opencode-config-trust`:`takeovers` 四个文件,`approval` 照先例格式,`mechanism` 指向闸门模块,`tests` 列核心判据、升级检查与段 1–4 的引擎宿主里的测试名 |
| `packages/core/test/codepuppy-project-gate-upgrade.test.ts`(新) | 设计 §6 的升级检查,见「证明」 |
| `scripts/north-star-guard.sh` | 三条接管的注释改成引用 ADR-049 与判据文件(条目本身在段 1、段 2 已加) |
| `scripts/gate-files.tsv` | 登记册里每个证明文件都要有一行精确条数(`scripts/assert-authority-proofs.sh` 要求) |
| `docs/architecture/2026-11-13-project-config-command-surface.md` | 文首加一段说明:已由 #1713 修复,回归用例已翻转(两臂) |
| `docs/architecture/2026-11-13-project-extension-trust-record.md` | 加一句:同一条记录也放行项目的 OpenCode 配置 |
| `docs/runbooks/upstream-update.md` | 5.1 的复核清单 |
| `docs/README.md` | 补本计划与段 0 那份架构说明的索引行 |

### 顺序
1. 一个提交。跑:
   - `cd packages/core && bun test test/codepuppy-project-gate-upgrade.test.ts test/codepuppy-project-gate.test.ts`
   - `cd packages/ui-mac && bun test src/main/north-star-guard.test.ts src/main/local-gate-parity.test.ts src/main/sync-upstream-takeover-isolation.test.ts`
   - §0 的登记类检查(含 `authority-registry.test.ts`)

### 风险
`assert-authority-proofs.sh` 按登记册逐个运行证明文件、核对条数,条数改了就要同步改 `gate-files.tsv`。登记册与 tsv 放在同一个提交里。

### 证明
| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| (ADR-048 决定 4)字段分类 | 升级检查:`Info`、`ConfigAgent.Info`、`ConfigCommand.Info`、v1 agent / command 的具名字段,以及从 `normalize.ts` 读出的 v1 顶层键,每一个都在闸门的分类表里 | 已知的坏:往分类表的副本里删一个键 ⇒ 点名红 |
| 隐含字段 | 升级检查:只含内容字段的 agent 与命令,分别放在 `agent` / `agents` / `mode` / `command` / `commands` 下,经闸门再经上游归一化解码,只剩内容字段;md agent 在 `agent/`、`agents/`、`mode/`、`modes/` 四种目录下同样只剩内容字段 | 去掉解码后那一步 ⇒ `mode` 名字空间与 `modes/` 两条红 |
| 消费方计数 | 升级检查:core 里取配置目录条目的模块恰好是 F-06 那 5 个(本 HEAD 实测:`source.ts`、`entry-observer.ts`、`command.ts`、`agent.ts`、`skill.ts`);`ConfigMarkdown.parse(Option)` 的调用方恰好 3 个 | 已知的坏:在副本里多放一个调用方 ⇒ 红 |
| 反向臂 | 登记册的证明列出段 1–3 的未允许臂用例:去掉闸门,spike 的「已知的坏」与 R1 / R2 的探针重新出现 | 段 0 的钉子就是去掉闸门之后的样子 |
| 文档 | `scripts/check-doc-links.py` 与 `docs-gates.sh` 的链接检查;ADR 与登记册逐项核对 | 链接断 ⇒ 红 |

### 偏离记录
- 2026-11-14 · 同调用链必要文件 `packages/core/src/config/codepuppy-project-gate.ts` 增加 `classificationsForTest()` 副本读取口:内容类复用实际名单,具名暂缓键的类别由 `deferredItems()` 共用一张表;未知新键仍默认暂缓。用于升级判据的删键反向臂,不增加用户配置或公共契约。
