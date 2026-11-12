---
id: PLAN-upstream-upgrade-readiness-i08
title: 测试默认隔离用户真实数据目录 实施计划
summary: INT-upstream-upgrade-readiness I-08 的隔离一半——ext、ui-mac 与 core / schema / plugin / ai 里的 Code Puppy 测试,在任何模块求值之前就把 HOME、XDG_*、OPENCODE_DB、TMPDIR 指进新建的临时根;每个包一条守卫测试
kind: plan
status: active
spec: ""
design: ""
owners: [alpha-code desktop maintainers]
last_reviewed: 2026-11-12
---

# PLAN-upstream-upgrade-readiness-i08｜测试默认隔离用户真实数据目录 实施计划

由实施会话在计划阶段写,编排器核对后由同一会话实施。决定只链接、不重述;实施中偏离本段,在同一个提交里改本段。

## I-08

- 依据:无 spec、无 design。owner 批准的意向条目 I-08([alpha-work `docs/intents/INT-upstream-upgrade-readiness.md` @ 4c1b2c6](https://github.com/impharaon/alpha-work/blob/4c1b2c6/docs/intents/INT-upstream-upgrade-readiness.md),U-02,2026-11-12),本段只做其中「测试默认隔离」一半;编排器派发书 `par-i08-isolation`(#1662 跟进)。代码基线 `engine/1662-opencode2` @ `df748c16e7`。下文 AC 编号取自派发书的 Goal / Facts,不是新增范围:
  - AC1 在 `packages/ext`、`packages/ui-mac` 里跑任何 `bun test`,以及 `packages/{core,schema,plugin,ai}` 里的 `codepuppy-*` 测试,在任何模块求值之前,HOME、XDG_*、OPENCODE_DB、TMPDIR 都已指进一个新建的临时根。
  - AC2 每个包有一条守卫测试:解析出的引擎 data / config / state / log 路径一旦落在真实 HOME 下就红;已知坏的那一臂只比较路径,不读真实目录。
  - AC3 host 起的子测试进程拿到的是隔离后的环境,不是开发者 shell 的 `process.env`。
  - AC4 `packages/core/test` 里的上游测试行为不变(10 个具名上游测试文件改前 / 改后逐条对比)。
  - AC5 删掉被取代的逐文件隔离代码。
- 核对:`ed01ebc87e` · 编排器 · 通过第 1–3 步(共享预载放 `scripts/test-isolation/`、子进程看根标记、每包一条守卫、删逐文件函数);第 4 步(core)等 owner 对接管 `packages/core/bunfig.toml` 的裁决,期间不做乙。

### 现状(决定所依据的事实)

- ext 已经这样做:[`packages/ext/bunfig.toml`](../../../packages/ext/bunfig.toml) 预载 `test/preload.ts`,键表与子进程环境在 `test/isolated-env.ts`,守卫是 [`src/test-preload.test.ts`](../../../packages/ext/src/test-preload.test.ts)(含「不装预载 ⇒ 落在真 HOME」的已知坏臂,子进程里只算路径)。
- ui-mac 是逐文件函数 `test-component/isolated-engine-home.ts`(本段删除),7 处调用 + 1 个判据文件。
- core 的 3 个 `codepuppy-*` 测试各自在文件顶上手写一段「建临时根、改 HOME / XDG_*、`OPENCODE_DB=:memory:`,再 `await import`」:`codepuppy-mcp-runtime.test.ts:32-37`、`codepuppy-browser-tool-names.test.ts:15-27`、`codepuppy-mcp-tool-generation.test.ts:18-23`。其余 5 个、schema 的 2 个、ai 的 1 个没有隔离。plugin 今天没有 `codepuppy-*` 测试(`git ls-files packages/plugin | grep codepuppy-` 为空)。
- ai 的 `codepuppy-auth-fail-closed.test.ts` 建全部 provider 时,Vertex 的 ADC 查找会读 `~/.config/gcloud/application_default_credentials.json`(`packages/ai/src/providers/google-vertex-shared.ts:18-30` 与 google-auth-library 默认路径)——不隔离时结果随机器上有没有 gcloud 凭据而变。
- 本机实测(bun 1.4.4,临时目录):预载里改 `os.homedir` 只影响默认导出与 `require("os")`;`import { homedir }` 与 `import * as os` 仍返回启动时的真 HOME。子进程的 `os.homedir()` 跟启动时的 HOME 环境变量。`os.tmpdir()` 跟运行时 TMPDIR。预载里注册的 `afterAll` 在整次运行结束时跑一次(两个文件都看得到临时根,之后被删掉)。
- 上游 core 自己的入口 `bun run test`([`packages/core/script/test.ts`](../../../packages/core/script/test.ts))已经起一个 HOME / XDG / TMPDIR 全隔离、带 `OPENCODE_TEST_HOME` 的子 `bun test`;直接 `bun test`(闸门 `scripts/assert-gate-files.sh` 逐文件就是这样跑)绕过它。上游 [`test/preload.test.ts`](../../../packages/core/test/preload.test.ts) 只在 `OPENCODE_TEST_HOME` 存在时才断言隔离布局。
- core 的 [`bunfig.toml`](../../../packages/core/bunfig.toml) 是上游文件(在 `origin/dev` 与 `upstream/dev` 里都有);schema / ai / plugin 在两个镜像里都没有 `bunfig.toml`。

### 本段要定的四件事

1. **每个包用 bunfig 预载,不用逐文件函数。** `bun test` 把一个包的很多文件跑在同一进程里,上游 `util/src/global-roots.ts` 在模块求值时就把路径算死;只有在任何测试文件求值之前生效的预载,才对混跑也成立。ext 的预载升格为唯一一份共享实现,六个包的 bunfig 都指向它。
   - 位置:[`scripts/test-isolation/`](../../../scripts)(`preload.ts` 有副作用,`env.ts` 只放键表与给测试用的函数)。`scripts/` 是 Code Puppy 自有目录(上游镜像里没有)、本来就放闸门工具,而且不在 ui-mac 写盘登记簿扫描的 sidecar 生产源码里。不留在 `packages/ext/test/`:它将服务六个包,而 ext 的键名与前缀(`CODEPUPPY_EXT_TEST_*`、`codepuppy-ext-test-`)本来就要改成通用的。
   - 布局沿用 ext 现有的(HOME=`<根>/home`,四个 XDG_*_HOME 在 home 下,`XDG_RUNTIME_DIR` / `XDG_DATA_DIRS` / `XDG_CONFIG_DIRS` / TMPDIR / OPENCODE_DB 在根下,`os.homedir` 默认导出钉到 home),另加:删掉开发者 shell 里的 `OPENCODE_CONFIG_DIR` 与 `OPENCODE_CONFIG`(两者都是引擎配置路径的输入,留着就可能指回真目录);临时根在原 `os.tmpdir()` 下、名字短(macOS 套接字路径 104 字节上限);创建它的进程用预载级 `afterAll` 在整次运行结束时删掉它(替代 ui-mac 逐文件函数原有的清理)。不设 `OPENCODE_TEST_HOME`:设了会让上游 `preload.test.ts` 在直接 `bun test` 下从「不断言」变成「断言」,改变上游测试的行为。
   - 预载在第一次求值时记下真 HOME 与原 XDG_*(只给守卫的已知坏臂用),已经记过就不覆盖(子进程继承父进程记下的值)。
2. **子进程:隔离由最外层进程决定一次,子进程沿用。** 预载发现自己的根标记(`CODEPUPPY_TEST_ROOT`)已在环境里 ⇒ 这个进程是被一个已隔离的进程起的,环境原样保留(包括起它的测试有意显式写的 HOME / XDG 值,ui-mac 预载「显式值恒胜」的约定)。上游 core 的 `bun run test` 子进程(环境里有 `OPENCODE_TEST_HOME`)同样视为已隔离、原样保留,并把根标记设成 `OPENCODE_TEST_HOME`——否则共享预载会盖掉上游入口的 HOME,上游 `preload.test.ts` 在那条路上转红。ui-mac 的 host 本来就以 `env: process.env` 起子 `bun test`(57 个文件),预载之后那就是隔离后的环境,不用改。ext 两个只传「PATH + 隔离键」的子进程用例继续用 `isolatedEnv()`(搬进 `env.ts`,键表加上根标记)。
3. **守卫:每个包一条 `bun test` 能跑到的守卫文件**,断言同一组事:HOME、环境里每个 XDG_* 键、TMPDIR 在根内;OPENCODE_DB 在根内或是 `:memory:`(core 上游预载排在共享预载之后,仍把它改成 `:memory:`);上游 `global-roots` 的 data / cache / config / state 与(能导入时)`Global.Path` 全部路径(含 log)在根内;已知坏臂 = 在不装预载的子进程里用记下的真 HOME / XDG_* 求值 `global-roots`(只算路径、不建目录,沿用 ext 的 `rootsInChild` 写法),断言它们等于真 HOME 推出来的路径、不在根内。各包额外断言:ui-mac 把生产的 `createSidecarEnv()` → `engineDataDirectory` / `engineDatabasePath` / `engineGlobalConfigDirectory` 与日志目录的推导放进根内,并有子进程臂(带 `--preload` 起子进程:继承环境 ⇒ 沿用同一个根;去掉根标记 ⇒ 新建另一个根,证明这一臂测得出「没沿用」)。`rootsInChild` 与「记下的真环境」的读取放进 `env.ts` 共用,守卫文件本身只写断言。
4. **删掉的逐文件隔离代码**:ui-mac 的 `test-component/isolated-engine-home.ts` 与 7 处 import + 调用,以及它的判据 `src/main/isolated-engine-home.test.ts`(由新守卫取代);core 三个文件顶上的环境改写块(`ROOT` 本身留下——它们还拿它当工作目录;后面的 `await import` 不改写,头注释改成指向预载);ext 的 `test/preload.ts` 与 `test/isolated-env.ts`(移到共享位置)。

### 需要编排器裁决的一处:core 的 bunfig 是新接管

core 的预载只能写在上游的 `packages/core/bunfig.toml` 里(bun 只读当前目录的 bunfig;上游 `test/preload.ts` 同样是上游文件)。这一行改动会让 north-star 守卫点名它,需要在 [`scripts/north-star-guard.sh`](../../../scripts/north-star-guard.sh) 的 `UPSTREAM_EXCLUDES` 加一条、在 [`codepuppy-authority-registry.json`](../../architecture/codepuppy-authority-registry.json) 加一条登记(机制文件 `scripts/test-isolation/preload.ts`,判据 core 的守卫)。2026-11-12 的先例是:多接管上游文件要经 owner 同意(同一守卫文件里 `packages/core/src/session/diff.ts` 一条的注释引了原话)。I-08 的批准原文是「把隔离做成所有包的默认」,是否已覆盖这一条测试配置的接管,本会话不替 owner 判。

- **甲(推荐)**:接管 `packages/core/bunfig.toml` 一行(预载列表前插共享预载),登记如上。混跑也成立;上游 core 测试在直接 `bun test` 下得到的,正是上游自己 `bun run test` 给的那种隔离环境。代价:多一条测试配置接管,每日同步时这一行若被上游改动会冲突(文件 3 行)。
- **乙(未获批时)**:不碰 core 的 bunfig;core 的每个 `codepuppy-*` 测试把 `scripts/test-isolation/preload.ts` 作为第一条静态 import(预载本身幂等:同进程第二次求值什么都不做),core 守卫另加一条扫描:`packages/core/test` 下每个 `codepuppy-*.test.ts` 的第一条 import 就是它。对闸门(逐文件跑)和只跑 `codepuppy-*` 的场景成立;整包混跑时排在上游文件之后的 Code Puppy 文件拿到的是已按真 HOME 算好的路径,守卫在那种跑法下会红(如实报告「这次没隔离」)。这条路仍是逐文件纪律,只是由扫描强制。
- schema / ai / plugin 新建 `bunfig.toml` 不算接管(上游镜像里没有;文件里写 `north-star:codepuppy-owned` 自报家门,ADR-043 的两个因子都满足)。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `scripts/test-isolation/preload.ts`(由 `packages/ext/test/preload.ts` 移来) | 唯一一份测试隔离预载:新建根或沿用已隔离的父进程环境;改写 / 删除上面列的键;钉 `os.homedir` 默认导出;记下真 HOME / XDG_*(已记过不覆盖);创建者在整次运行结束时删根;键不在根内就抛错。 |
| `scripts/test-isolation/env.ts`(由 `packages/ext/test/isolated-env.ts` 移来) | 键表、根标记与真环境记录的键名(通用名)、`isolatedEnv()`、守卫共用的 `rootsInChild()` 与真环境读取。 |
| `scripts/test-isolation/guard.ts`(新,见偏离记录) | 守卫共用的两组断言:本进程的键与引擎路径在根内;子进程隔离 + 已知坏臂。 |
| `packages/ext/bunfig.toml` | 预载改指向共享文件。 |
| `packages/ext/src/test-preload.test.ts`、`plugin-process-singleton.test.ts`、`plugin-reload-wiring.test.ts` | import 改到 `scripts/test-isolation/env.ts`;守卫按第 3 条的断言集对齐(ext 原有两条用例保留)。 |
| `packages/ui-mac/bunfig.toml` | 预载列表前插共享预载(排在 `./scripts/test-preload.ts` 之前)。 |
| `packages/ui-mac/src/main/test-isolation.test.ts`(新) | ui-mac 守卫(第 3 条,含生产引擎路径推导与子进程沿用臂)。 |
| `packages/ui-mac/test-component/test-isolation-child.cases.ts`(新,见偏离记录) | 守卫子进程臂起的子 `bun test`:打印子进程预载之后的根、HOME、XDG_DATA_HOME、OPENCODE_DB 与 `os.homedir()`。 |
| `packages/ui-mac/src/main/isolated-engine-home.test.ts`、`test-component/isolated-engine-home.ts` | 删除。 |
| `packages/ui-mac/src/main/{server,sidecar-stop,process-fence-wiring,codepuppy-sidecar-wiring}.test.ts`、`test-component/{official-connectors-recovery,req053-spawn-rotation,req053-spawn-throat-latch}.cases.ts` | 删掉 `isolateEngineHome` 的 import 与调用。 |
| `packages/{schema,ai,plugin}/bunfig.toml`(新) | `[test] preload` 指向共享预载;带 `north-star:codepuppy-owned`。 |
| `packages/{schema,ai,plugin}/test/codepuppy-test-isolation.test.ts`(新) | 三个包各一条守卫(第 3 条通用断言集)。 |
| `packages/core/bunfig.toml`(上游,仅甲) | 预载列表前插共享预载。 |
| `scripts/north-star-guard.sh`(仅甲) | `UPSTREAM_EXCLUDES` 加 `packages/core/bunfig.toml` 一条,注释写明它握的决定与判据。 |
| `docs/architecture/codepuppy-authority-registry.json`(仅甲) | 加一条:决定 =「Code Puppy 的测试不碰用户真实数据目录」,接管 `packages/core/bunfig.toml`,机制 `scripts/test-isolation/preload.ts`,判据 core 守卫的用例名。 |
| `packages/core/test/codepuppy-test-isolation.test.ts`(新) | core 守卫(第 3 条,含 `Global.Path` 全部路径;乙另加 import 扫描)。 |
| `packages/core/test/codepuppy-{mcp-runtime,browser-tool-names,mcp-tool-generation}.test.ts` | 删掉环境改写块,头注释改指预载(乙:另在 8 个 `codepuppy-*` 文件首行加共享预载 import)。 |

### 顺序

开工先在基线上跑一遍「改前」:下面各组具名测试的逐条 `(pass)/(fail)/(skip)` 行存进临时目录,改后同一命令再跑一次 `diff`。

1. **共享预载 + ext**:移文件、改通用名、加沿用分支 / 配置键删除 / 结束清理;ext bunfig 与三个 import 方改指。跑:ext 的 `src/test-preload.test.ts`、`src/plugin-process-singleton.test.ts`、`src/plugin-reload-wiring.test.ts`;`bun run --cwd packages/ext typecheck`。
2. **ui-mac**:bunfig 前插;新守卫;删逐文件函数、其判据与 7 处调用。跑:新守卫;原 7 个调用方里的 4 个 `.test.ts` 与 3 个 cases 的 host(`official-connectors-recovery.test.ts`、`req053-spawn-rotation.test.ts`、`req053-spawn-throat-latch.test.ts`),逐个跑一次、合在一个进程里再跑一次(它们以前各有独立根,现在同进程共用一个);`gate-environment.test.ts`;HOME / TMPDIR 敏感样本的改前 / 改后对比——文件里读 `homedir()` 或 `process.env.HOME` 的 20 个 `src/main/*.test.ts`(`git grep -l "process.env.HOME\|homedir()" -- 'src/**/*.test.ts'` 共 21 个,去掉将删除的 `isolated-engine-home.test.ts`)、文件里出现 commit 却没有设置 git 身份的 `ext-install-planner.test.ts`、`artifact-quota.test.ts`,以及碰钥匙串 / 机密文件的 `byok-key-migration.test.ts`、`codepuppy-secret-files.test.ts`;`bun run --cwd packages/ui-mac typecheck`。
3. **schema / ai / plugin**:新 bunfig + 守卫。跑:三条守卫;各包已有的 `codepuppy-*` 测试;上游改前 / 改后对比——schema 全部 18 个上游测试文件,plugin 全部 4 个(`gui-host`、`gui-scope`、`gui-vite`、`host`),ai 10 个(`auth`、`keyless-auth`、`promise`、`endpoint`、`http-timeout`、`provider-package`、`provider/google-vertex`、`provider/google-vertex-interactions`、`provider/bedrock-converse`、`provider/azure`)。
4. **core**(按编排器裁决走甲或乙):bunfig(甲)或首行 import(乙);守卫;删三处环境改写块;甲另改守卫例外表与登记册。跑:core 守卫与全部 8 个 `codepuppy-*` 测试;AC4 的 10 个上游测试文件改前 / 改后对比:`preload`、`database`、`file-access-path`、`location-layer`、`logging`、`npm-config`、`skill-discovery`、`tool-read`、`reference`、`credential`(`.test.ts`);上游入口 `bun run --cwd packages/core test test/preload.test.ts test/codepuppy-test-isolation.test.ts`(沿用 `OPENCODE_TEST_HOME` 那一支);甲另跑 `bash scripts/north-star-guard.sh` 与 `packages/ext/src/policy/authority-registry.test.ts`。

每一步一个提交。所有命令 PATH 以 `~/.bun-versions/1.4.4/bin` 打头;起引擎的测试都在预载之下,不碰 `~/.local/share/opencode`。

### 风险

- **ui-mac 3000 多条测试的环境整体变了**:HOME 换成空目录后,依赖 `~/.gitconfig`(提交身份、签名)、bun 安装缓存(`~/.bun/install/cache`)、登录钥匙串搜索表的测试可能改变结果;TMPDIR 变长可能让套接字路径超限。第 2 步的样本按这几类挑,改前 / 改后逐条对比;本段不跑 ui-mac 全量(派发书只允许具名测试),全量由合并前那一次闸门的 ui-mac 步覆盖。若那一步出现样本外的新红,判据是:红在 HOME / TMPDIR 敏感处 ⇒ 本段的缺陷,回本段修。
- **同进程共用一个根**:ui-mac 那 4 个文件以前各自一个新根,现在同一次运行共用;第 2 步把它们合进一个进程跑,先发现跨文件残留。
- **进程内 `import { homedir }` 仍是真 HOME**:bun 在进程启动时定死,预载改不动(实测)。引擎路径不受影响——上游 `global-roots` / `Global` 用默认导出,ui-mac 的引擎路径推导先看 XDG_* 与 OPENCODE_DB——守卫断言的正是这些推导;子进程则完全跟着隔离后的 HOME。不在引擎路径上的进程内具名 `homedir()` 调用不在本段 AC 内,记为观察。
- **上游测试结果漂移**:TMPDIR 从 `/var/folders/...` 变成 realpath 后的路径,可能改变上游测试里的路径比较。AC4 的对比覆盖它;有任何一条结果变化就停下,按派发书走 `BLOCKED`,不改上游测试。
- **甲 / 乙未定**:第 1–3 步与 core 无关,先做;第 4 步等裁决。

### 证明

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC1 | 六条守卫(`packages/ext/src/test-preload.test.ts`、`packages/ui-mac/src/main/test-isolation.test.ts`、`packages/{core,schema,ai,plugin}/test/codepuppy-test-isolation.test.ts`)的「键与引擎路径全在新建根内」用例 | 删掉某个包 bunfig 里的共享预载那一项 ⇒ 根标记缺失、HOME 不在根内 ⇒ 该包守卫红。每个包实施时各做一次这个变异并记录结果。 |
| AC2 | 同上六条守卫的路径断言 + 已知坏臂 | 已知坏臂在子进程里用记下的真 HOME / XDG_* 求值,得出真 HOME 下的路径且不在根内;若守卫的「在根内」判据退化(比如恒真),这一臂与正向断言互相矛盾而红。只比较字符串,不建不读真实目录。 |
| AC3 | ui-mac 守卫的子进程臂;ext 守卫的 `isolatedEnv()` 子进程臂;ui-mac 的 3 个 cases host 照常通过 | 去掉预载的沿用分支 ⇒ 子进程新建另一个根 ⇒「沿用同一个根」断言红;去掉根标记的对照臂证明这条断言测得出差别。子进程用真环境 ⇒ 落到真 HOME(已知坏臂)。 |
| AC4 | 10 个具名 core 上游测试文件改前 / 改后逐条 pass/fail/skip 的 `diff` 为空;上游入口 `bun run test` 下 `preload.test.ts` 照常通过 | 预载若盖掉上游入口的 HOME、或改变了路径相关行为,`diff` 非空或 `preload.test.ts` 红。 |
| AC5 | `git grep -n "isolateEngineHome\|isolated-engine-home\|test/isolated-env\|test/preload"` 在 `packages/` 下为零(bunfig 指向共享文件的除外);core 三个文件里不再有 `process.env[key] =` 改写块 | 命令输出即证据;残留会被点名。 |

### 偏离记录

- 2026-11-12 · 第 1 步 · 新增 `scripts/test-isolation/guard.ts`:六条守卫共用的两组断言(本进程、子进程 + 已知坏臂)放在这里,守卫文件只传各包自己的引擎路径;原计划只说「`rootsInChild` 与真环境读取放进 `env.ts`」,断言本身若写在每个守卫里就是六份副本。· `54b620bb22`
- 2026-11-12 · 第 1 步 · 「上游 core 入口(`OPENCODE_TEST_HOME`)视为已隔离」那一支挪到第 4 步再写:第 1–3 步接上预载的五个包里没有任何东西以 `OPENCODE_TEST_HOME` 起子 `bun test`,先写就是到不了的分支。· `54b620bb22`
- 2026-11-12 · 第 1 步 · ext 的 `typecheck` 脚本调用的 `tsgo` 在这棵树里没有装(另一条 lane 正在加这个依赖),改用仓根 `node_modules/.bin/tsc`(TypeScript 7.1.0-beta,同一个原生编译器)`--noEmit -p packages/ext`;没碰 `bun.lock`。· `54b620bb22`
- 2026-11-12 · 第 2 步 · 子进程臂改用子 `bun test`(新 fixture `test-component/test-isolation-child.cases.ts`),不用计划里写的 `bun --preload … -e`:预载要在测试运行器里注册整次运行结束时的清理(`afterAll`),在 `bun -e` 下实测直接报「Cannot use afterAll() outside of the test runner」。子 `bun test` 也正是 57 个 host 起子进程的真实形状。· 本提交
