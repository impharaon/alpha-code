---
title: "alpha-code#1662 方案基线:Code Puppy 引擎从 OpenCode 1 整体切到 OpenCode 2"
kind: design
status: proposed
owners:
  - alpha-code desktop maintainers
last_reviewed: 2026-11-08
review_after: 2027-02-08
---

# alpha-code#1662 方案基线 —— 引擎代次切换:OpenCode 1(1.18.35 基线)→ OpenCode 2(v2.2.6)

票面 `impharaon/alpha-code#1662`(L 级)。本基线是它升 Ready 的门,`requirement-management` 要求的四段在
第一到第四节;验证计划(ADR-037 决策 4)、撤回方案(AC5)、待 owner 裁决、方案疑点在第五到第八节。附件:

- [能力清点表](2026-11-08-1662-opencode2-capability-inventory.md)(AC2,ADR-037 决策 3);
- 新 ADR 草案 [ADR-047](../../.claude/rules/adrs/ADR-047-opencode2-engine-generation.md)(`status: proposed`,取代 ADR-036)。

管辖本票的既有裁决:[ADR-037](../../.claude/rules/adrs/ADR-037-engine-generation-switch-is-its-own-change.md)
(独立票 / 独立 PR / 独立 ADR / 能力清点 / 端到端判据 / 禁止半代次)、ADR-005(fork + 只增不改)、
ADR-029(主权阶梯 L0–L3)、ADR-034(前端 pin + SOT 补丁)、ADR-041 / ADR-043 / ADR-044(接管与 alpha 自有文件判定)、
[upstream-integration.md](../architecture/upstream-integration.md)、[ci.md](../runbooks/ci.md) §4 第 3 条(受审上游集成 = 真合并提交)。
[constraints.md](../architecture/constraints.md) 已读,本方案碰到的偏离见 §2.11。

本文所有「上游代码」读自只读检出 `/Users/tide/app/wt/opencode2-ref`(= `upstream/dev` `adb0053d09`),下文写作 `v2:<path>`;
`origin/alpha` = `e56ae0c036`。

## 0. 一页结论

1. **这不是一次同步,是一次重写主权层。** OpenCode 2 删掉了 Code Puppy 今天跑的整个 v1 引擎(`packages/opencode`),
   HTTP 接口全部换成 `/api/*`,插件 API 换了一套。Code Puppy 的 49 条接管里 34 条所在文件已不存在;ext 插件、ui-mac 主进程、
   renderer 数据层都要按新接口重写。试合并的 205 条冲突只是其中一部分,不冲突也会坏的地方(插件形状、12 个失效环境变量、
   数据层)不在冲突表里。
2. **路线选 D:「树按 OpenCode 2 重建,历史照常合并」。** 在整合分支上做一个真合并提交(第二父 = 选定的上游 dev SHA,
   满足 ci.md §4 第 3 条、让 merge-base 前移),这个合并提交的树按规则构造:上游路径一律取上游原样,Code Puppy 自有路径取 alpha;
   之后在同一分支上按能力清点表把主权层改挂到 OpenCode 2 的接缝上。最后整条分支以 `gh pr merge --merge` 一次合进 `alpha`。
   A(逐冲突移植)、B(重新 fork)、C(先过 1.19.5)的否决理由见 §2.2。
3. **合并目标取 `33f94fce96`**(v2.2.6 在 dev 线上的父提交,代码与 v2.2.6 逐字相同,只差版本号与 CHANGELOG),
   不取 dev 头 `adb0053d09`,也不取 `v2.2.6` 标签(§2.1)。
4. **引擎宿主定为「嵌在 Electron `utilityProcess` 里」(H1,裁决书 R13,L1a 实测)**(进程围栏、ext 的 `parentPort` 桥、进程内调用都不换形状;
   进程内接法取 `start()` + `Transform`,§2.4)。嵌入式下,上游的「v1 旧对话转成 v2」只在 bun 下运行、在 Node 下是空实现,原样不动就是旧对话
   静默全不可见 —— 本次最大的用户可见风险;已定用 Node 薄适配接上(裁决书 R14,合成库实测通过,真库副本归 L1b,§2.8)。
5. **前端在切换时跟引擎同一个 SHA**(之后保持同一代次),renderer 的数据层改用上游公开包 `@opencode/client/solid`,不再借 `packages/app` 内部导出(§2.6)。
6. **一个 PR 进 `alpha`**(ADR-037 决策 2),7 条 lane 在整合分支上并行;量级估计 115–185 个 agent 小时、日历 2–3 周、
   owner 实机约 4–5 小时(§4.3,推断)。

## 1. 只读勘破(地面真相)

### 1.1 代次与谱系

```text
$ git merge-base origin/alpha upstream/dev
055d95bb7e278c94baf06235a52cac79dd13ba67          # 2026-10-09 fix(tui): highlight C++ module interface files
$ git show 055d95bb:packages/opencode/package.json | grep -m1 version
  "version": "1.18.35",
$ git rev-list --count 055d95bb..upstream/dev      → 6879
$ git rev-list --count origin/alpha ^upstream/dev   → 990   (--no-merges: 884)
$ git merge-base upstream-v1.19.5 upstream/dev      → 055d95bb…   # v1 维护线恰好从 alpha 的 merge-base 分出
$ git rev-list --count 055d95bb..upstream-v1.19.5   → 33   (git diff --stat: 184 files, +2285/−2638)
$ git merge-base --is-ancestor upstream-v1.19.5 upstream/dev  → 否
```

事实:上游 2026-10-09 在 `055d95bb` 切出 `v1` 维护线(1.19.x,33 个提交,第一条是 `chore: publish v1 from the v1 branch`,
里面有 `fix(opencode): discontinue session sharing`、`feat(opencode): add upgrade --major for moving to OpenCode 2`),
`dev` 从这一点起就是 OpenCode 2。**alpha 正停在 1.x 与 2.x 的最后一个公共提交上。**

```text
$ git show --stat upstream-v2.2.6     # release: v2.2.6,父 = 33f94fce96(在 dev 线上)
 36 files changed  — 全部是 package.json 版本号、CHANGELOG.md、bun.lock
$ git show upstream-v2.2.6 -- bun.lock | grep '^[-+] ' | 规整版本号后去重
  32 -  "version": V   /  32 +  "version": V        # bun.lock 只改版本号
$ git rev-list --count upstream-v2.2.6..upstream/dev → 98 ; 反向 → 1(就是那个 release 提交)
$ git ls-remote --tags upstream 'refs/tags/v[0-9]*' | sort -V | tail -1 → v2.2.6   # 2026-11-08 实跑,上游最新发布
$ git diff --shortstat 33f94fce96 upstream/dev → 441 files, +12888/−9973
  提交主题统计:fix(site) 25、fix(core) 17、feat(site) 7、feat(core) 6、chore(perf) 5 …
$ git diff --stat 33f94fce96 upstream/dev -- <本文与清点表引用到的 2.x 文件> → 10 files, +70/−34
```

### 1.2 OpenCode 2 的形状

- **包改名、v1 引擎整包删除。** 包作用域 `@opencode-ai/*` → `@opencode/*`;`packages/opencode` 不存在(`ls` 报 No such file);
  `packages/llm` 改名为 `packages/ai`(试合并的目录改名冲突)。2.x 的引擎是 `packages/core`(运行时)+ `packages/server`
  (HTTP)+ `packages/protocol`(接口定义)+ `packages/cli`(宿主与命令行)。
- **HTTP 接口全在 `/api/*` 下,v1 路由一条不剩。** `git grep -l prompt_async -- packages ':!packages/web'` → 0;发送是
  `POST /api/session/:sessionID/prompt`(`v2:packages/protocol/src/groups/session.ts:337`),事件流是 `GET /api/event`
  (`v2:packages/protocol/src/groups/event.ts:61`)。
- **插件 API 换了一套。** 插件模块必须 `export default { id, effect }` 或 `{ id, setup }`(`v2:packages/core/src/plugin/module.ts:81-94`),
  能力按 domain 给出(`v2:packages/plugin/src/effect/plugin.ts:27-59`):`tool.hook["execute.before"/"execute.after"]`、
  `session.hook.{prompt,context,"model.request","http.request",…}`、`permission.hook.evaluate`、`shell.hook["create.before"]`,
  以及 agent / mcp / provider / skill / command / websearch 的 `transform`。v1 的 `(input) => Promise<Hooks>` 形状在 2.x 装不上。
- **钩子按注册顺序串行执行,每个回调改同一个事件对象;只有 `tool.execute.before` 可以失败并拒掉调用**
  (`v2:packages/core/src/plugin/hooks.ts:23,88-95`)。这条决定了安全面 S1 的形状。
- **配置通道还在,键名换了。** `OPENCODE_CONFIG_CONTENT`、`OPENCODE_CONFIG`、`OPENCODE_CONFIG_DIR` 仍被读
  (`v2:packages/cli/src/server-process.ts:123-133`),content 做 `{env:}`/`{file:}` 替换(`v2:packages/core/src/config.ts:292-304`,
  替换规则 `v2:packages/core/src/config/variable.ts:25-63`,**文件缺失替换成空串**);新键是 `agents`/`providers`/`plugins`/
  `permissions`/`commands`/`policies`/`update`(`v2:packages/schema/src/config.ts:27-116`),旧键由 `normalize.ts:70-190` 转换并出诊断。
- **上游桌面版不嵌引擎。** 它打包一个 bun 编译的 CLI(`v2:packages/desktop/electron-builder.config.ts:108-125`),以
  `serve --service` 起成机器级后台服务(`v2:packages/desktop/src/main/service/background-service.ts:55-70`),服务登记文件与
  数据库按用户全局共享。
- **ADR-036 给「迁到 v2」定的三条准入判据,在 2.x 上都成立:** ① MCP 运行时 —— `v2:packages/core/src/mcp/{index,client,pool,stdio,oauth}.ts`,
  依赖 `@modelcontextprotocol/*` 2.3.1(`v2:packages/core/package.json:105-107`);② 钩子挂载点 —— `tool.execute.before/after`
  与系统提示变换的等价物 `session.hook.context.system`;③ 凭证面 —— content 通道支持 `{file:}`。ADR-047 据此取代 ADR-036。

### 1.3 嵌入式运行的前提

```text
$ ELECTRON_RUN_AS_NODE=1 packages/ui-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
    -e '…process.versions; require("node:sqlite"); require("node:ffi")'
electron 42.3.3 node 24.15.0
node:sqlite ok
node:ffi missing ERR_UNKNOWN_BUILTIN_MODULE
```

- 2.x 的 Node 构建目标是 Node 26.4 加 `--experimental-ffi`(`v2:packages/cli/script/build-node.ts:20`、`v2:packages/cli/src/node/target.ts:34`)。
  L1a 实测:按上游配置、把 target 改成 node24 构建,在 Electron 的 Node 24.15 里不带这两个参数也能跑通 E1–E3,日志无 WARN/ERROR
  (勘破文档 `docs/architecture/2026-11-09-1662-l1-engine-host-spike.md` §6 第 8 条,分支 `spike/1662-l1-engine-host`、提交 `0bfbdfb205`,下文简称「L1a 勘破」)。
- 2.x core 给运行时相关模块都留了 `node` 分支(`v2:packages/core/package.json` 的 `imports`:`#sqlite`→`sqlite.node.ts` 用 `node:sqlite`,
  `#pty`、`#fff`、`#photon-wasm`、`#persistent-pty-binary` 同),fff 缺失时回退(`v2:packages/core/src/filesystem/fff.node.ts:5`)。
- **例外:`#v1-migration` 的 `node` 分支是空实现**(`package.json:67-73` → `v1-migration.noop.ts`,`status()`/`run()` 恒回 `completed`)。
  用户看得到的后果(裁决书 R15 ③,L1a 勘破 e3noop 臂实测):上游原版 Node 构建下**旧对话一条都看不到**,而状态接口
  `/api/experimental/migration/v1` 照样报 `completed` —— 静默失效,UI 拿不到任何「旧对话没接上」的信号。
- 2.x 提供两种嵌入入口:`ServerProcess.start(options, …)`(`v2:packages/server/src/process.ts:50`,带监听;`Transform` 钩子在 `:40`)
  与 `ServerFetch.make`(`v2:packages/server/src/fetch.ts:43`,不监听端口,但自建一张应用图)。

### 1.4 数据

- **库位置与独立安装的 OpenCode 相同。** Code Puppy 打包态的库是 `$XDG_DATA_HOME || ~/.local/share` + `/opencode/opencode.db`
  (`packages/ui-mac/src/main/db-safety.ts:6-7,36-51`);2.x 对 latest/dev/beta/next/prod 渠道用同一个文件名
  (`v2:packages/cli/src/database-path.ts:4-12`)。`packages/ui-mac/src/main/data-clear-boot.ts:172` 已写明引擎凭证与 MCP 令牌和独立
  CLI 共享。本机实测(只看文件在不在,不读内容):`~/.local/share/opencode/opencode.db` 21,921,792 字节(11-06 修改),
  `mcp-auth.json` 2 字节,**没有** `auth.json`;`which opencode` 无。
- **2.x 迁移执行器**:库里有 `session` 或 `session_v2` 表 ⇒ 只跑未完成的迁移(`v2:packages/core/src/database/migration.ts:31-32`);
  旧的无名 `__drizzle_migrations` 表里有对不上已知迁移的时间戳 ⇒ 直接 die(`:84-100`);嵌入方自有表应以 `_` 开头(`:26-29`)。
  **订正(裁决书 R15 ②,L1a 勘破 E3):** 1.18.35 建出的库用的是 `migration` 表,**没有**旧的无名 `__drizzle_migrations`,走不到 die 分支;
  合成库上 2.x 只补缺的 21 条(`migration` 表 40 → 61 行),alpha 独有的两行迁移记录与 `permission_decision`/`permission_request` 两张表原样保留、
  不报错。所以**引擎这一侧不会挡**,挡的是 Code Puppy 自己的 DB 安全带(与 §2.8 第 1 条的 F1 合看)。真库属于哪一种由 L1b 复核。
- **迁移清单差异**(三方 `comm`):alpha 40 条、merge-base 38 条、2.x 59 条;alpha 独有两条
  (`20260720085655_permission-decision-receipt`、`20260720094009_permission-request-admission`,建 `permission_decision`/`permission_request`),
  2.x 不认识;2.x 在 merge-base 之后新增 21 条,建 `blob`、`blob_ref`、`job`、`schedule`、`session_inbox`、`session_part`、`workspace`、`worktree` 等,
  与 alpha 的两张表无重名。alpha 自己的 DB 安全带在「将前进迁移」时先备份、「库超前」时阻断(`db-safety.ts:85-106`)。
- **v1 旧对话转 v2** 由 `v1-migration.bun.ts` 做(`transformSession` `:227`、`run` `:541`),只读写同库。它会删两样东西:
  `event` 表的行(`:562`),以及被转换会话在 `session_message` 里已有的行 —— 先删该会话的 `session_message` 再写转换结果(`:704`);
  不删 v1 的 `message`/`part`。(第 1 轮审计 F12 订正:初稿只写了 `event`。)
  **工具改名不改历史(裁决书 R15 ①,订正初稿):** `RENAMED_TOOLS`(`:996`:`bash`→`shell`、`task`→`subagent`、`apply_patch`→`patch`)只用来在
  会话末尾追加一条给模型看的 `system` 提示(`legacyToolNotice`,`:1005-1030`);转换后的历史里工具项仍叫 `bash`。L1a 勘破 E3:v1 13 条消息转成 14 条,
  多出的就是这条提示。所以 UI 工具卡与身份账本要**同时认新旧两个名字**(清点表 K5)。
- **旧凭证导入**:2.x 迁移 `20260805200742_import_legacy_credentials` 读 `<data>/auth.json` 写进 `credential` 表
  (`v2:packages/core/src/database/migration/20260805200742_import_legacy_credentials.ts:39-52`)。

### 1.5 Code Puppy 今天依赖的引擎面(细目在清点表)

| 面 | 量 | 怎么量的 |
| --- | --- | --- |
| 接管清单 | 49 条:34 条所在文件在 2.x 已不存在,15 条还在 | `scripts/north-star-guard.sh --print-takeover` × `git cat-file -e`(清点表 §9) |
| alpha 加在上游包里的文件 | 80 个,其中 54 个在 `packages/opencode`(源码 11 个:工具策略六件、MCP 三件、`plugin/codepuppy-bundled-plugin.ts`、`session/tool-display.ts`) | `git diff --name-only --diff-filter=A 055d95bb origin/alpha -- packages` 去掉三个自有包 |
| ext 插件 | 7 个 v1 钩子 + `config` 钩子 + 8 个自定义工具 + 项目插件扇出;非测试源码 5,061 行、测试 24 个 | `packages/ext/src/plugin.ts:116-299`、`hub-tools.ts:75-110` |
| ui-mac 打的 v1 SDK 调用 | 约 35 个不同调用(`session.create/promptAsync/abort/command/share…`、`mcp.status/add/connect/disconnect/auth`、`global.event`…) | 正则抽 `client/sdk/c` 上的 `<域>.<方法>`,非测试源码 |
| ext 与 main 直打的 v1 路径 | `/mcp` 15、`/provider` 7、`/mcp/:name/connect` 4、`/global/event` 2,及 `/session/:id/message`、`/session/status`、`/instance/dispose`、`/skills/paths`、`/permission/*` 等 | 在 `packages/ui-mac/src/main` 与 `packages/ext/src` 的非测试源码里抽以引号开头、形如 `/session…`、`/mcp…`、`/api…` 的字符串,去重计数 |
| 会话发送入口 | 3 个:`use-projects.ts:513`、`codepuppy-composer.tsx:1868`、`session-timeline.tsx:276` | `grep -rn 'promptAsync('` |
| 环境变量 | 写进 sidecar 的 `OPENCODE_*` 中 12 个在 2.x 无读者(另 1 个是同名常量,误报) | 两侧 `grep -hoE 'OPENCODE_[A-Z0-9_]+'` + `comm` |
| renderer 借用的 `@opencode-ai/app` 根导出 | 23 个,2.x 只剩 5 个 | perl 抽符号 × `grep -w v2:packages/app/src/index.ts` |
| 前端 pin / SOT 补丁 | pin `e11dbd0206`(2026-08-21,早于 v1 分叉点);补丁 114 个文件 | `frontend/frontend-pin.lock`、`grep -c '^diff --git'` |
| ui-mac 规模 | main 非测试 258 个文件、renderer 237 个、测试 443 个 | `find` 计数 |
| 试合并 `upstream/dev` | 205 行 `CONFLICT`:154 modify/delete、42 内容、6 文件位置、2 目录改名、1 add/add | `/tmp/aw-triage/oc2-conflicts.txt`(编排器提供) |

### 1.6 同步流水线里绑死 v1 的地方

- `.github/workflows/sync-upstream.yml:100-102`:ADR-015 提示词绊线盯的是 `packages/opencode/src/session/prompt packages/opencode/src/agent`。
- `scripts/engine-smoke.sh:32`:冒烟起的是 `bun run packages/opencode/src/index.ts serve`。
- `packages/ui-mac/scripts/prebuild.ts:30-44`:先建 v1 node 产物,再打三个只对 v1 生成产物成立的补丁。
- `.github/workflows/sync-upstream.yml:202-239`(`apply_codepuppy_frontend_delta`):响亮失败判据含随包 client tarball;2.x 的
  `session-ui` 与 `app` 直接依赖工作区 `@opencode/client`(`v2:packages/session-ui/package.json:74`),tarball 已无意义。

## 2. 选定方案与被否决的替代

### 2.1 合并目标 SHA:`33f94fce96`

- **选它的理由:** owner 要的是「OpenCode 2 最新版本」,最新发布是 v2.2.6(§1.1 ls-remote);`33f94fce96` 的代码与 v2.2.6 逐字相同,
  又在 dev 线上,满足同步模型与 ci.md §4 第 3 条「第二父 = dev SHA」。验证期间目标不动,验证结论可复现。
- **为什么不取 dev 头 `adb0053d09`:** 它确实包含 2.2.6 的全部修复(release 提交只改版本号),但多出的 98 个提交里有 17 个 `fix(core)`、
  6 个 `feat(core)` 没经过任何发布;而且 dev 头每天都在动,验证对象会漂。切换落地后的第一次每日同步会把这些提交按接管规则带进来(AC4),
  不会丢。成本一行:这 23 个 core 提交晚一天进来。
- **为什么不取 `v2.2.6` 标签:** 它不在 dev 线上(`git rev-list --count upstream/dev..upstream-v2.2.6` = 1),拿它当第二父,下一次每日同步会
  从一个 dev 之外的点算 merge-base。
- **规则(给实现):** 开工那天先跑 `git ls-remote --tags upstream 'refs/tags/v[0-9]*' | sort -V | tail -1`;若有比 v2.2.6 新的发布,改取那个标签
  在 dev 线上的父提交(判法同 §1.1:标签只比父多一个改版本号的提交),并在 ADR-047 记下。

### 2.2 四条路线(按结果合理性排序)

| 排序 | 路线 | 结果 | 成本一行 | 结论 |
| --- | --- | --- | --- | --- |
| 1 | **D 树按 2.x 重建、历史照常合并**:整合分支上一个真合并提交(第二父 = §2.1 的 SHA),树按 §2.3 规则构造;之后按清点表在 2.x 接缝上重建主权层;整条分支 `--merge` 进 `alpha` | merge-base 前移,同步模型不变;上游路径与上游逐字一致,可机械判(§2.3 第 4 步);工作量由清点表驱动,不由冲突表驱动 | 主权层重写的工作量(§4.3),与 A、B 相同;不额外付历史成本 | **选定** |
| 2 | A 在 `alpha` 上合并 dev、逐个移植冲突(现行同步模型) | 历史同 D;但 154 个 modify/delete 冲突的「移植」实际都是在 2.x 接缝上重写,冲突表给不出这件事;git 自动合进去的 alpha 旧改动会静默混进改过名的 2.x 文件(`#1566` 记过两次同形态);54 个 alpha 文件留在一个已没有 `package.json` 的目录里;逐文件「保留我们这份」的解法会复活 v1 文件,正是 ADR-037 决策 5 禁止的半代次 | 205 个冲突 + 数量未知的静默合入,外加与 D 相同的重写量 | 否决:冲突表不是能力清点,它会漏掉不冲突也会坏的面(插件形状、失效环境变量、renderer 数据层) |
| 3 | B 以 2.x 为新底重新 fork,把 Code Puppy 自有包与接管重新叠上去 | 树与 D 相同;若新分支替换 `alpha`,990 个 alpha 提交与 merge-base 关系全断(没有共同祖先),每条在途分支和 worktree 都要搬到一棵无关的历史上,PR 与 `git blame` 链接失效,ci.md §4 第 3 条「真合并提交」无从满足 | 与 D 相同的重写量 + 一次强推默认分支 + 全部在途工作迁移 | 否决:要的只是 B 的树,D 用一个合并提交就拿到同一棵树而不付历史代价 |
| 4 | C 先过 1.19.5 再上 2.x | 1.19.5 在 v1 维护线上,不是 dev 的祖先(§1.1):过了它 6879 个 dev 提交一个不少;反而多一条外来祖先线,其中 33 个提交(184 个文件)多是 dev 上同一修复的回移,之后再合 dev 时会成对冲突 | 多一次完整集成(含打包验证),对 2.x 零推进 | 否决:不缩短到 2.x 的路;1.19.5 的用户价值若要,归 `alpha-code#1661` 自己的票,不进本票 |

### 2.3 D 的做法(整合分支上的步骤)

1. 从 `origin/alpha` 拉整合分支 `engine/1662-opencode2`(编排器定名);所有 lane 的 PR 都进这条分支,不进 `alpha`。
2. **M0 合并提交**:`git merge --no-ff --no-commit 33f94fce96`,然后按规则构造树,而不是逐个解冲突:
   - 上游路径(`north-star-guard.sh --print-jurisdiction` 的辖区,含所有冲突与非冲突文件):一律取 `33f94fce96` 的版本;上游删掉的就删
     (`packages/opencode`、`packages/llm`、`packages/sdk/js` 等整片消失)。
   - Code Puppy 自有包(`packages/ui-mac`、`packages/ext`、`packages/codepuppy-contracts-consumer`):取 alpha 的版本。
   - **`packages/` 之外逐文件定归属**(第 1 轮审计 F4):上游来源的文件跟 `33f94fce96` 增删;Code Puppy 的文件(`frontend/`、`scripts/`、`docs/`、
     `.claude/`、仓根 `AGENTS.md`、`sync-upstream*.yml`、`codepuppy-ci.yml` 等)跟 alpha。典型是 `.github/workflows/`:`33f94fce96` 有 21 个,
     其中 20 个 alpha 今天没有(`comm -13 <(git ls-tree --name-only origin/alpha .github/workflows/ | sort) <(git ls-tree --name-only 33f94fce96 .github/workflows/ | sort)`:
     `bot-docs-locale`、`bot-nix-hashes`、`check-bot-scope`、`check-docs`、`check-nix`、`check-process-daemon`、`check-test`、`check`、`deploy-files`、`deploy-site`、
     `deploy-update`、`nightly-beta`、`release-dry-run`、`release-process-daemon`、`release`、`triage-close-issues`、`triage-close-prs`、`triage-compliance-close`、
     `triage-contributor`、`triage-pr-standards`)。合入 `alpha` 后这些会被 GitHub 当新 workflow 启用,处置见 L2 退出条件。
   - alpha 加在上游包里的 80 个文件:M0 先**全部移出**(源码在 L3/L4 按清点表搬到新家,测试随行;没有新家的删掉)。
   - `packages/{app,ui}`:按 ADR-034 的投影规则,`frontend/frontend-pin.lock` 改指 `33f94fce96`,SOT 补丁在 M0 暂置空(L6 重建)。
   - `bun.lock` 重新生成。
   提交信息写明第二父 SHA。M0 之后 ui-mac / ext 编译不过是预期内的,整合分支上允许。
   **M0 直接推到整合分支,或经 PR 以 `gh pr merge --merge` 合入;整合分支吸收 `alpha` 的新提交只用 `git merge`,禁止 squash / rebase**
   (第 1 轮审计 F2:本仓 PR 默认 squash,squash 或 rebase 会丢掉 M0 的上游祖先)。
3. 后续 lane 在整合分支上按清点表逐行处置(§4);每条 lane 合进整合分支前跑自己的相关测试。
4. **M0 之后的机械判据(本地门怎么判真假):**
   - 树:`git diff --name-only 33f94fce96 HEAD -- packages/ | grep -vE '^packages/(ui-mac|ext|codepuppy-contracts-consumer|app|ui)/'`
     的输出必须只剩「接管清单」(L2 起用过渡清单,L4 定最终清单)与 ADR-043 判为 alpha 自有的路径;多出任何一行 = 未登记的偏离。
     `packages/{app,ui}` 排除在外,由 `scripts/assert-frontend-patch-roundtrip.sh` 判(pin + SOT 补丁,守卫的 carve-out ② 本就含这两个包;第 1 轮审计 F9)。
     这条由 L2 写进守卫本身(F3,见 L2 边界),先用一个故意改坏的上游文件证明它会红。
   - 祖先(第 1 轮审计 F2):`git merge-base --is-ancestor 33f94fce96 HEAD` 必须为真;反向用例:把整合分支 squash 重放到 `alpha` 的一个临时副本上,同一条判据必须红。
     L2 退出时、§5.3 每次推送、最终合并前各跑一次;合入后对 `origin/alpha` 再跑一次。
5. 整合分支通过 §5 的全部闸门后,开**一个** PR 进 `alpha`,标题主语是切换本身(ADR-037 决策 2),`gh pr merge --merge` 合入
   (禁止 squash/rebase,否则 M0 的上游祖先丢失,merge-base 不前移)。`git log --first-parent alpha` 上只多一个合并提交。

### 2.4 引擎宿主:H1(嵌入式,已定 —— 裁决书 R13),H3 兜底,H2 不用

| 选项 | 是什么 | 好处 | 代价 |
| --- | --- | --- | --- |
| **H1 嵌入式**(默认) | sidecar 仍是 Electron `utilityProcess`,先装围栏、再 import `@opencode/server/process` 并 `start()` | 围栏(进程内 seatbelt,`sidecar.ts:133-140`)、ext 的 `parentPort` 桥与重载调度器、进程内调用(#1531)都不换形状;不多带一个约 200 MB 的二进制 | Node 24.15 而非上游的 26.4:`node:ffi` 缺、`#v1-migration` 是空实现;上游不在 Electron 的 Node 里测引擎(今天跑 1.x 也是同样处境) |
| H3 私有子进程(兜底) | 打包上游 bun 编译的 CLI,由已装围栏的 sidecar 以 `serve --hostname 127.0.0.1 --port <p>` 拉起,数据目录用 Code Puppy 的 | 上游实际发布并测试的运行时;v1 旧对话转换原生可用 | ext 跑进子进程后 `parentPort` 桥与进程内调用全断,要另设 IPC(围栏只放行出网代理端口,`#1531` 已实测回环被拒);多一个要签名公证的二进制;子进程寿命要按进程组管 |
| H2 上游原样(`serve --service`) | 机器级共享后台服务 | 与上游桌面版一致 | 服务登记与库按用户全局共享 ⇒ 与用户自己装的 OpenCode 混用同一个服务、同一份凭证与会话,违反安全面 S7;围栏与 ext 都挂不上 | 

**H1 的退出条件(L1 实测,全部满足才定 H1):** ① 在打包形态的 `utilityProcess` 里、围栏已装的前提下,2.x 引擎起得来,
`/api/session/:id/prompt` 能完成一条真实回复;② 拿到一个与监听**同一张应用图**的进程内 fetch(候选:`start()` 的 `Transform`);
③ §2.8 的旧对话转换在 Node 下有可行补法。任一不满足 ⇒ 改 H3,L3/L5 的 IPC 部分随之调整;这是整合分支内可回退的技术选择,不需要 owner 裁决。

**已定 H1(裁决书 R13,依据 L1a 勘破 §0、§3、§4,合成数据):** 三条退出条件在 dev 版 Electron 二进制 + 未打包 main 上都满足
(围栏下 0.32 s 起引擎、回复经生产出网代理;打包形态 —— asar、签名公证、hardened runtime —— 未测,归 L7)。实现必须同时守住:

- **进程内接法取「`start()` + `Transform`」,并传 `lifecycle`**:钩子拿到的是监听端口的 dispatch app,转成 fetch 交给 ext(与监听同一张图,E2 实测);
  传 `lifecycle` 才会在启动时续跑中断的会话(`v2:packages/server/src/process.ts:113-114`;CLI 默认模式不传)。**不取 `ServerFetch.make`**:
  它要 Code Puppy 自己再写一层监听,且实测不跑 Schedule runner(L1a 勘破 §4)—— 取 `start()` 是消费上游宿主的决定,Code Puppy 侧少持有一层。
- **出网代理的设置顺序(裁决书 R15 ④):** 装围栏之后、import 引擎之前调用 `http.setGlobalProxyFromEnv()`(今天的 `sidecar.ts:148,267-269`
  `useEnvProxy`)。不调的话,2.x 的模型请求绕开 `HTTPS_PROXY` 直连目标,在围栏下 DNS 失败、代理一条记录都收不到(L1a 勘破 armC 对 armCraw)。
- **以正式渠道启动**(见 §2.7)。
- 引擎连自己的回环端口仍被围栏拒(EPERM,与 `#1531` 同形),ext 这类进程内调用方只能走上面那个进程内 fetch。

### 2.5 主权层怎么重建

- **按阶梯从低往高找挂载点**(ADR-029):先 L0(ext 作为 2.x 插件 + 配置注入 + `policies`),不够再 L1(构建期变换),最后才 L3(接管)。
  旧接管清单不继承:15 条仍存在的路径逐条重判(清点表 §9),34 条随文件消失删除。新清单里每一条都在 ADR-047 写范围、守卫、回滚与归属。
- **本系统是权威的那几件事继续由 Code Puppy 决定,引擎只执行:** 工具策略与档位(K1/K2/K4)、BYOK 与平台模型的投影(C7)、
  云准入(M3)。这几件在 2.x 都有可挂的钩子(`tool.hook`、`permission.hook.evaluate`、`session.hook["model.request"]`、`mcp.transform`),
  所以不需要再接管上游的注册表或请求组装文件。
- **红旗检查:** 凡是方案里出现「跟上游逐点保持一致」的地方(典型是重新接管 `packages/core/src/permission.ts`),先问能不能改成挂钩子;
  挂不了才接管,并在 ADR-047 里承认这份维护成本。

### 2.6 前端

- 切换时 `frontend/frontend-pin.lock` 与引擎**同一个 SHA**,之后前端与引擎**保持同一代次**、照 ADR-034 月更(第 1 轮 ARCH-NOTE ①)。
  前端停在 1.x 投影而引擎是 2.x,是同一条用户流程跨两代(ADR-037 决策 5)。
- renderer 的数据层改用上游公开包 `@opencode/client/solid`(`createData`、`createClientConnection`,`v2:packages/client/src/solid/data.ts:264`、
  `connection.ts:40`),不再经 `packages/app` 内部的 `useServerSync`/`useServerSDK`。理由:这是 2.x 的 app 自己用的数据层(13 个文件 import),
  是公开包而不是 app 内部,以后月更 pin 时耦合面更小。
- SOT 补丁在新 pin 上重建,只保留 renderer 仍然需要从 `packages/app` 拿、又拿不到公开出口的那部分(清点表 F3 的 18 个缺失符号逐个判)。
- 被否决:前端保持旧 pin、只换引擎 —— 旧前端打的全是 v1 路由,在 2.x 上没有一条存在;renderer 自写一套 SDK 绕开 `@opencode/client` ——
  手写上游协议的替身,正是「勘破先于闸门设计」点名的形态。

### 2.7 配置与环境变量

- 只剩一个代次,配置只写一份:注入直接写 2.x 新键(清点表 C2),删掉为 v2 读侧另写的 `OPENCODE_CONFIG_DIR` 桥与它的剥 key 逻辑
  (`codepuppy-config-injection.ts:508-641`)。这是 AC1「不留半代次链路」的具体落点之一。
- 12 个失效环境变量逐个换新机制或删除(清点表 E2),其中两个是安全相关的外部生态开关(C9)。
- **H1 下由 sidecar 自己构造 `ServerOptions`**(第 1 轮审计 F7 + ARCH-NOTE ③)。嵌入 `@opencode/server/process` 时,上游 CLI 宿主不在路径上:
  配置 content / file / directory、模型目录、库路径这些环境变量在 `packages/core/src` 与 `packages/server/src` 里零读者
  (`git grep -n -E 'process\.env\.OPENCODE_(CONFIG_CONTENT|CONFIG|CONFIG_DIR|MODELS_PATH|MODELS_URL|DISABLE_MODELS_FETCH|DB)\b' -- packages/core/src packages/server/src`
  → 0 行),是 CLI 在 `v2:packages/cli/src/server-process.ts:101-145` 把它们映射进 `start()` 的选项(库路径 `:114-115`),数据 / 配置目录的 `Global` 层
  也是 CLI 提供的(`:33-41`)。所以 sidecar 直接构造 `ServerOptions` 与 `Global` 层,不靠设环境变量;这份映射里的库路径推导与
  `db-safety.ts:36-51` 共用**一个** Code Puppy 侧函数 —— 库在哪只算一次,不再造一份上游宿主的决定。
- 防静默失效的测试改为断言**传给 `start()` / `ServerFetch.make` 的选项对象**(或把「找读者」的范围限定在宿主实际装载的模块);
  反向臂:一个只有 CLI 读的变量(例如 `OPENCODE_CONFIG_CONTENT`)按旧做法只设进环境,测试必须红。初稿「sidecar 环境里每个 `OPENCODE_*`
  在引擎源码里都有读者」的写法会把 CLI 里的读者也算进去,在 H1 下是假闸,作废。裁决书 R13 已定 `start()`,这里的选项对象即传给 `start()` 的那份。
- **以正式渠道启动(裁决书 R13、R15 ⑤):** 传给 `start()` 的 `app.channel` 用发布渠道值,不随 Code Puppy 自己的 dev 渠道构建变成 `dev`。
  `local`/`dev` 会默认打开 `todo`、`schedules`、`media_blob`、`artifacts`、`background_compaction` 五个实验开关(`v2:packages/core/src/flag.ts:26,70`,
  开关表 `v2:packages/schema/src/config/flag.ts:11-18`);库路径已由 `database.path` 显式给出,渠道值不再影响库文件名。判据:传 `local` 时这五个开关为开,
  传发布渠道时为关(反向臂)。另:引擎还读环境变量 `OPENCODE_FLAGS` 作最高优先的覆盖(`v2:packages/core/src/flag.ts:22`),而 sidecar 的环境白名单按
  `OPENCODE_` 前缀放行(清点表 E1),用户 shell 里的 `OPENCODE_FLAGS=all` 会绕过渠道默认值 —— L5 构造环境时把它排除出继承(读码,未跑)。

### 2.8 数据连续性

1. **前进迁移有备份。** 第一次以 2.x 启动时,DB 安全带看到 21 条待前进迁移,先做 `opencode-backup-*` 备份(`db-safety.ts:85,215-240`)。
   L2 让 `scripts/gen-db-expected.ts` 读 2.x 的 `migration.gen.ts`,**并把 alpha 自有的两条退役迁移 id**
   (`20260720085655_permission-decision-receipt`、`20260720094009_permission-request-admission`)**以一份冻结清单并入 2.x 构建的
   `db-expected-migrations.json`**(第 1 轮审计 F1)。不并的话,老用户库里这两个 id 对 2.x 构建是「未知」,而安全带先判未知 id、再判待前进
   (`db-safety.ts:105-106`)⇒ 每次启动都弹「库比应用新」,且前进迁移之前不做备份。判据:db-safety 加一个带这两个 id 的夹具库,期望结论是
   「待前进」(`migrate-ahead`)而不是「库超前」(`db-ahead`);L1 的真库副本实验(裁决书记作 L1b)要走 Code Puppy 的启动预检,不只跑裸引擎。
2. **v1 旧对话在嵌入式下要我们自己接上。** 默认补法(L1 实测):以构建期变换(ADR-029 L1)让 `#v1-migration` 解析到上游的
   `v1-migration.bun.ts`,为其中两处 bun 专有调用提供 Node 薄适配 —— `:808` 动态 import `bun:sqlite`(只用于打开 `opencode-next.db`)
   与 `:1170` `Bun.CryptoHasher`(合成 id 的 sha256,换 `node:crypto`);`:17` 只是类型 import。主体走 `Database.Service`,不碰 bun;
   上游源码逐字不动。实测不通 ⇒ 改 H3(bun 运行时原生可用)。两条都不通 ⇒ owner 裁决 O1。
   **已定:按这个 Node 薄适配做,O1 不触发(裁决书 R14,依据 L1a 勘破 E3,合成库):** 3 个会话 / 13 条消息全部转换为 3 / 14
   (多一条改名提示);有围栏时结果相同。两处适配都做、都小、上游源码不动:
   - `:1170`(`Bun.CryptoHasher`)**必做**:只在会话里用过被改名 / 改参数 / 删掉的工具、或用户消息带 synthetic 部分时才走到(`:371,455`);
     去掉它,转换在第一个用过改名工具的会话上以 `Bun is not defined` 中断,其后的会话全部不转换(e3raw 臂)。
     所以**夹具必须含带改名工具调用或合成 part 的会话** —— 纯文本会话走不到这一处,缺了也测不出来。
   - `:808`(`bun:sqlite`)只在 `<data>/opencode-next.db` 存在时走到(`:799-830`);owner 数据目录按文件名看没有这个文件,保留适配(e3next 臂已测)。
   - 上游原版 Node 构建下旧对话全不可见、状态仍报 `completed`(e3noop 臂,§1.3)—— 这条就是适配的反向臂。
3. **工具改名**(`bash`/`task`/`apply_patch`)在策略默认值与 agent 规则里改成新名(引擎的工具从此叫新名);**UI 工具卡与身份账本同时认新旧两个名字**
   —— 转换后的历史里工具项仍是旧名,转换只追加一条给模型的提示(§1.4,裁决书 R15 ①)(清点表 K5)。
4. **alpha 自有两张权限表**随 K3 的结论定去留;新增的自有表按 2.x 约定用 `_` 前缀。

### 2.9 每日同步恢复(AC4)

L2 在整合分支上一并改:提示词绊线改指 `v2:packages/core/src/session/system-prompt.ts`、`v2:packages/core/src/plugin/system-prompt/`、
`v2:packages/core/src/agent.ts`;`engine-smoke.sh` 改起 2.x 的 CLI(`bun run --cwd packages/cli src/index.ts serve`,上游根 `package.json` 的
`dev` 脚本同款);接管清单换成新清单;`apply_codepuppy_frontend_delta` 去掉 tarball 判据、保留 pin + 补丁投影。合入后第一次每日同步预计会
带进 `33f94fce96..dev头` 的提交,其中碰到接管路径的会以 `takeover upgrade review required` 停下 —— AC4 允许的「按接管规则明确停下」。

### 2.10 被否决的其它做法(各一句)

- 「先切过去、缺的后补」:ADR-037 决策 3 明令不是处置;补齐前每次交互都跑在缺能力的引擎上。
- 「分几个 PR 逐段切进 `alpha`」:中间态必然是半代次(例如前端 2.x、发送仍 1.x),ADR-037 决策 5 禁止。
- 「保留 v1 引擎作为后备、两代并存」:就是半代次本身,且 2.x 里已没有 v1 包可留。
- 「依赖 2.x 的旧键兼容层(normalize)而不改注入」:兼容层带诊断、语义不保证一一对应,出问题时是静默的。

### 2.11 本方案碰到的已知偏离(constraints.md)

| 偏离(constraints.md 的行) | 本方案的处理 |
| --- | --- |
| `packages/plugin/package.json:13` 的 `./alpha-cloud-authority` 导出(北极星) | **顺路改掉**:2.x 的 `@opencode/plugin` 有通配导出 `"./*": "./src/*.ts"`,alpha 自有文件不再需要改上游 `package.json`;L4 落,PR 正文单列 |
| `use-extensions.ts:463-484` MCP 状态子串匹配(K2) | **顺路改掉**:L6 本来就要按 2.x 重写这段,改为消费引擎给出的状态种类;PR 正文单列 |
| `code-mode.ts:195-203` 镜像 MCP `isError` 投影(K2) | 文件随 v1 删除;L4 判 2.x 里是否还有两份,在该行追加 `#1662` |
| Office 模板展开四处(K2,含 `codepuppy-first-party-mcp.ts:41-46`) | 第四处随 M2 搬家,不顺带合并(不是「很小」);在该行追加 `#1662` |
| 档位载体名单只在 ui-mac(K1) | `task`→`subagent` 改名碰到委派判定;不在本票解决,在该行追加 `#1662` |
| `packages/opencode/src/mcp/index.ts` 的 `pending` 复用 | 文件随 v1 删除;L4 判 2.x 的状态词,在该行追加 `#1662` |

## 3. 安全面

换代可能打破的不变量按类列,每类写实现必须守住的形状与能翻红的判据。判据一律先在已知坏的输入上证明会红(dev-loop「证据带反向对照」)。

| # | 不变量 | 换代后怎么会坏 | 实现必须守住的形状 | 判据(先证明会红) |
| --- | --- | --- | --- | --- |
| S1 | **权限咽喉**:模型看不到被拒的工具(目录闸);每次工具执行都过 Code Puppy 的判定(执行闸) | v1 的两处咽喉(`packages/opencode/src/permission/index.ts`、`session/tools.ts:263,347,428`)随包删除;2.x 钩子按注册顺序串行、互相改同一个事件对象(`hooks.ts:88-95`),后注册的插件能改写我们已经核准的输入或把 `evaluate` 的结论改回放行 | 到达工具执行的唯一通路是 `Tool.execute` 的 `execute.before`(`v2:packages/core/src/tool.ts:123-131`);Code Puppy 的执行闸挂在那里,对未知工具身份默认拒;**它必须是该钩子链上最后一个回调**,或在它之后的任何改写都会让调用被拒(实现选一种并写进 ADR-047);目录闸挂在 `session.hook.context` 的 `tools` 与 `tool.transform` 上。**Code Mode 的目录**(第 1 轮审计 F6):MCP 工具默认进 Code Mode(`v2:packages/core/src/tool/mcp.ts:57` `codemode: tool.codemode !== false`,开关取自 MCP server 配置 `v2:packages/core/src/mcp/index.ts:490`),目录闸必须也盖住它 —— 二选一:往 Code Mode 的 snapshot 规则集注入 deny,或对 Code Puppy 管的 MCP server 注入 `codemode: false` | 把 `#725` 的 23 条判据(A1–A4 目录闸、B1/B5/B7/B8 执行闸)改指 2.x 生产入口;A 组同时断言 **Code Mode 目录里也没有被拒工具**,反向臂:去掉上面二选一的那项处置 ⇒ 被拒工具出现在 Code Mode 目录里;摘掉我们的 `execute.before` 注册 ⇒ B 组翻红;再注册一个排在我们之后、改写入参的测试插件 ⇒ 必须仍被拒 |
| S2 | **凭证只在钥匙串** | ① 2.x 迁移会把 `<data>/auth.json` 导进库里的 `credential` 表(§1.4);② `{file:}` 缺文件时替换成空串(`variable.ts:63`),云 MCP 会带空 token 发出;③ 2.x 自有凭证服务(`/api/credential`)可能被 UI 或插件写入明文 | 引擎可用的凭证只来自 Code Puppy 的注入(钥匙串 → 秘密文件 → `{file:}` 引用);首次以 2.x 启动前处置数据目录里的 `auth.json`,使它不被导入(例如启动前检测并拒绝启动、说明原因)。初稿另一种实现「在注入里让 `providers` 只认 Code Puppy 的条目」删去(第 1 轮 OPTIONAL 采纳):导入迁移不看配置,`20260805200742_import_legacy_credentials.ts:39-52` 直接读文件写表,配置拦不住导入;秘密文件缺席时不发对应定义(保住 `#1195` 的现形) | 临时数据目录放一个假 `auth.json` ⇒ 引擎的 provider 列表与 `credential` 表都不能出现它;删掉秘密文件 ⇒ 云 MCP 定义不出现在引擎配置里 |
| S3 | **进程与网络围栏** | 2.x 引擎可能派生新进程或新出网:持久终端二进制(`#persistent-pty-binary`)、插件 npm 自更新(`v2:packages/core/src/plugin/update.ts`,24h 一次)、models.dev 拉取、MCP | 围栏仍在 import 引擎之前装好(H1:`sidecar.ts:133-140`;H3:先装围栏再派生子进程);引擎派生的一切继承围栏;出网只经出网策略代理(`#1531` 的回环规则不变);插件自更新对本地路径插件不触发 | 重跑 `process-fence-apply.test.ts`、`network-egress-fence.test.ts`、`process-fence-engine.test.ts` 的现有臂(这两个文件在 bootstrap 过的 worktree 里因缺 Electron 二进制定点恒红,要在有二进制的环境跑);新增一臂:引擎派生的持久终端进程写围栏外路径被拒 |
| S4 | **工具策略** | 工具改名(`bash`→`shell` 等)让按旧名写的策略、agent 规则、`tool-policy-default` 静默失配 —— 旧名的 deny 不再命中任何工具 | 策略按 canonical 工具身份匹配(ADR-041);改名在策略与 agent 规则里一次换完,未知名字的规则在加载时响亮报出,不静默丢弃 | 用旧名写一条 deny,加载时必须报错或告警;用新名 deny `shell` ⇒ 执行被拒 |
| S5 | **云端准入** | 平台凭证头(v1 `chat.headers`)、云 MCP 的 `mcp_access` token、websearch 两条腿都挂在 v1 钩子上 | 平台头只在 `session.hook["model.request"]` 里、只对平台 provider 加;云 MCP 定义只由 ext 在代付态安装;ADR-046 的「账户信号只决定云腿在不在」不变 | 非平台 provider 的请求头里没有平台凭证(抓 `http.request` 钩子);未登录态引擎配置里没有云 MCP |
| S6 | **外部生态隔离**(不继承 `~/.claude` 技能、项目插件要同意) | `OPENCODE_DISABLE_EXTERNAL_SKILLS`、`OPENCODE_DISABLE_CLAUDE_CODE_PROMPT` 在 2.x 无读者(`ecosystem-import.ts:28-32`),2.x 默认读 `.claude` 技能(`server-process.ts:126-131`);2.x 有自己的插件源装载 | 嵌入时显式 `config.claude = false`(逃生开关 `CODEPUPPY_ECOSYSTEM_INHERIT=1` 语义不变);第三方插件只经 ext 扇出且在同意之后装载,不经 2.x 自己的插件源。**`.agents` 两类技能根**(第 1 轮审计 F5):全局 `~/.agents` 与项目内 `.agents` 由内置插件 `opencode.config.compatibility` 与 `.claude` 一起装载(`v2:packages/core/src/config/plugin/compatibility.ts:44`),而 `config.claude = false` 只关 `.claude`,`.agents` 不受它管(`v2:packages/core/src/config/discovery.ts:152-166`)。处置在 L0(配置注入):在 `plugins` 里注入移除指令 `-opencode.config.compatibility`(移除语法 `v2:packages/core/src/config/plugin/source.ts:118-122`,执行 `v2:packages/core/src/plugin/supervisor.ts:34-40`;该插件不在不可移除名单 `v2:packages/core/src/plugin/internal.ts:309`);逃生开关置位时不注入(读码,未跑) | 在临时 HOME 放 `~/.claude/skills/probe` ⇒ `GET /api/skill` 里没有它;把 `config.claude` 改回默认 ⇒ 判据翻红。加两臂:临时 HOME 的 `~/.agents/skills/probe-global` 与临时项目里的 `.agents/skills/probe-project` ⇒ 都不在 `GET /api/skill` 里;去掉移除指令 ⇒ 两条都出现 |
| S7 | **数据隔离**:Code Puppy 的会话与凭证不与用户自装的 OpenCode 混用 | 库与数据目录本就与独立 OpenCode 同路径(§1.4);2.x 多出共享的 `credential` 表和导入迁移,独立装的 OpenCode 2 也会对同一个库做 v1→v2 转换 | 本票不搬数据目录(编排器已定,裁决书 R5;搬目录是一次独立的数据迁移,另行裁决,见 §7 O2);本票保证 S2 的「不导入不属于我们的凭证」,并在启动日志里报出「检测到同目录的其它 OpenCode 数据」 | 同 S2;另在临时数据目录预置一份由 2.x 独立 CLI 迁移过的库 ⇒ Code Puppy 能起、不报错丢数据,或按 DB 安全带阻断并说明 |
| S8 | **renderer 信任边界**:renderer 不拿引擎口令,不得直连 Node/秘密 | 2.x 引擎同样 Basic auth + CORS(`v2:packages/server/src/options.ts`);数据层换成 `@opencode/client/solid` 后,连接参数从哪来要重接 | 口令只在 main/sidecar;renderer 只拿到源地址,`Authorization` 由 main 在请求上补(上游桌面同款,`sidecar-credentials.ts:30-41`) | renderer 进程的全局对象与 IPC 返回值里搜不到口令(现有判据改指新接线) |

## 4. 子票切分与规模

### 4.1 为什么要切、怎么切

满足 `requirement-management`「拆分」的两条:要并行开 lane(L3–L6 互不重叠);整体必须独立成一个 PR(引擎切换)。
因此子票是**整合分支上的 lane**,各自的 PR 进 `engine/1662-opencode2`,不进 `alpha`;最后一个 PR 把整合分支合进 `alpha`,
正文逐条 `Fixes` 各 CODE 子票,父票 `#1662` 只用 `Refs`。

| Lane | 类型 | 负责 AC | 边界(只动这些) | 不做 | 退出条件 |
| --- | --- | --- | --- | --- | --- |
| L1 引擎宿主与数据勘破 | DECIDE | AC1(前提)、AC3(前提) | 只读 + 临时实验分支;产物落 `docs/architecture/` 一篇勘破 | 不改产品代码 | §2.4 的三条退出条件逐条有实测结论(含命令与输出);真库**副本**上前进迁移与旧对话转换的结果(会话条数前后对照),且这次实验走 Code Puppy 的启动预检(DB 安全带),不只跑裸引擎(§2.8 第 1 条,F1);定 H1 或 H3。宿主那一半(裁决书记作 L1a)的结论见 L1a 勘破(提交 `0bfbdfb205`)与裁决书 R13–R15(定 H1);真库副本那一半(L1b)的结论另落勘破 |
| L2 骨架:M0 与守卫、同步、构建接线 | CODE | AC1、AC4 | M0 合并提交(直推整合分支或 `--merge` 合入,F2);`scripts/north-star-guard.sh` 与其测试 —— 在含受审上游合并的分支上,`packages/` 辖区改以该合并的上游父(`33f94fce96`)为基准判,不再以 `origin/alpha` 为基准(守卫头注 `scripts/north-star-guard.sh:24` 起写的基准,F3);接管清单在 L2 用过渡清单判(F10);`scripts/engine-smoke.sh`;`.github/workflows/sync-upstream.yml`;`packages/ui-mac/scripts/prebuild.ts` 与 `gen-db-expected.ts`(含退役迁移 id 的冻结清单,以及 db-safety 那条「带两个退役 id 的夹具库 ⇒ 待前进」测试,F1);`frontend/frontend-pin.lock` | 不改 ext、ui-mac 业务代码;7 条 lane 的推送不得靠 `--no-verify` 过守卫(F3) | §2.3 第 4 步的两条机械判据(树、祖先)在整合分支上为真并有反向用例,其中祖先判据 `git merge-base --is-ancestor 33f94fce96 HEAD` 带「squash 重放后必须红」(F2);守卫两臂:M0 之后再改一个上游文件 ⇒ 红,M0 原样带来的上游改动 ⇒ 绿(F3);同步工作流的步骤体在 `sync-upstream-takeover-isolation.test.ts` 里对过渡清单跑通;合入 `alpha` 前列出将新出现的上游 workflow 清单(§2.3 第 2 步的 20 个),合入后逐个 `gh workflow disable`(F4) |
| L3 ext 改成 2.x 插件 | CODE | AC1 | `packages/ext/**`;上下文注入快照 | 不改工具策略族的判定逻辑(L4) | 清点表 P1–P12、C10、L3r、L4r、L5r、M3 各行,以及 S7 的 ext 部分(`packages/ext/src/reload-scheduler.ts:51,58` 进程内调用的 `GET /session/status`、`POST /instance/dispose`,F11),状态变为已处置并写上新坐标;ext 的测试在 2.x 插件宿主里跑(不是替身) |
| L4 主权文件搬家与接管重判 | CODE | AC1 | 清点表 K1–K8、L1r、L2r、M1、M2、M6、D3 的文件;新接管清单;ADR-047「精确接管面」一节 | 不改 renderer | 新接管清单每条在 ADR-047 有理由;`#725` 判据改指 2.x 并带摘线反向(S1);对最终清单重跑 `sync-upstream-takeover-isolation.test.ts` 与 `north-star-guard.test.ts`,并定好清单为空时同步怎么走 —— 今天 `sync-upstream.yml:131-133` 遇空清单直接 `exit 1`,最终清单若为空不得 `exit 1`,且要与「守卫没跑出结果」区分开(F10) |
| L5 ui-mac 主进程接线 | CODE | AC1 | sidecar 宿主 —— 按裁决书 R13 定的 H1:`start()` + `Transform` 取进程内 fetch 交给 ext,并传 `lifecycle`(启动时续跑中断会话),不用 `ServerFetch.make`;装围栏之后、import 引擎之前保留 `http.setGlobalProxyFromEnv()`(`sidecar.ts:148,267-269`);传给引擎的 `app.channel` 用发布渠道值(§2.4、§2.7)—— 以及 `sidecar-env.ts`、`server.ts` 的环境投影、`codepuppy-config-injection.ts`、MCP 管理、provider/目录投影、健康探测 | 不改 renderer、不改 ext | 清点表 H1–H9、C1–C9、E1–E3、S7 的 main 部分已处置;sidecar 构造的 `ServerOptions` 有断言选项对象的测试,带「只设进环境的变量必须红」的反向臂,库路径与 `db-safety.ts:36-51` 共用一个函数(§2.7,F7);删掉 v2 配置桥后无残留引用 |
| L6 前端:pin、SOT 补丁、renderer 数据层 | CODE | AC1 | `frontend/`、`packages/{app,ui}` 投影、`packages/ui-mac/src/renderer/**` | 不做视觉改动(票面「不做」) | 三个发送入口同一代次(ADR-037 决策 5 的枚举写进 PR);清点表 S1–S6、S9、F1–F6、M4、M5 已处置 |
| L7 打包版验证与撤回演练 | VERIFY | AC3、AC5(及 AC4 的合入后取证) | `docs/verification/` | 不改代码(发现缺陷回到对应 lane) | §5 的闸门全部有记录;§6 的演练做过一次并留证 |

依赖:L1 → L2 →(L3 ∥ L4 ∥ L5 ∥ L6)→ L7。L3 与 L4 的接口是「ext 里挂钩子、策略族提供判定函数」,在 L4 开工时先定函数签名。

### 4.2 AC 改写建议(批准后按基线改写;此处是建议,不是已改)

票面写明「方案基线批准后按基线改写」。建议只做一处收紧:AC1 的证据补一句「ADR-037 决策 5 的入口枚举(三个发送入口、
三个事件消费点、审批停靠区)各自调用的代次,写进 PR 正文」。其余四条维持原文。

### 4.3 规模(推断,依据是 §1.5 的计数)

| Lane | 主要量 | 估计(agent 小时) |
| --- | --- | --- |
| L1 | 两次实验(宿主、真库副本) | 6–10 |
| L2 | M0 + 6 处接线 + 守卫测试 | 8–12 |
| L3 | ext 非测试 5,061 行、24 个测试;7 个钩子 + config + 8 个工具 + 扇出 | 16–24 |
| L4 | 11 个源码文件搬家 + 43 个测试;15 条接管重判;MCP / 请求链 / websearch / 改名 | 24–40 |
| L5 | main 非测试 258 个文件中约 40 个碰引擎;约 35 个路由调用 | 16–24 |
| L6 | SOT 补丁 114 个文件重建;renderer 约 40 个文件碰数据层;ui-mac 443 个测试里碰 SDK 类型的那部分 | 32–56 |
| L7 | §5 闸门 + alpha-work#129 中引擎相关格 + 撤回演练 | 12–20 |
| 合计 | 7 条 lane,高峰 4 条并行 | **115–185**;日历 2–3 周(alpha-code 一次全量门约 25 分钟,打包验证要排队) |

owner 实机:0.1.25 那轮 36 格用了 200–230 分钟(alpha-work#129 票面自述),本次引擎相关格约占六成,估 4–5 小时,分两到三段。

## 5. 验证计划(ADR-037 决策 4)

**判据四条同时满足:** 跑生产代码、走用户入口、断言可观测结果、把切换改回去时转红。typecheck 绿、测试总数、审计通过、源码字面量、HTTP 200
都不算(ADR-037 决策 4 列过的反例)。

### 5.1 合并闸(在打包版上,L7 执行)

| 闸 | 用户入口 → 可观测结果 | 反向(改回去必须红) |
| --- | --- | --- |
| G1 发送 | 首页新对话、会话页输入框、时间线「继续」三个入口各连发三条,渲染出三条回复 | 任一入口指回旧路由 ⇒ 第二条起无回复 |
| G2 审批 | 「请求审批」档下触发一次写文件,停靠区出卡;拒绝 ⇒ 文件系统侧无写入 | 摘掉 ext 的 `execute.before` 注册 ⇒ 写入发生 |
| G3 工具策略 | 被拒工具不出现在模型请求的工具表里,也不出现在 Code Mode 目录里(F6),强行调用被拒 | 同 S1 判据 |
| G4 MCP / 云工具 | 第一方 MCP 与云 MCP 各调用一次成功(服务端计数) | 删秘密文件 ⇒ 云 MCP 定义不出现 |
| G5 BYOK | 自带 Key 的 provider 真实发送一条(沿用 alpha-work#129 R22 的 DeepSeek Key 前提) | 去掉投影 ⇒ provider 不可选 |
| G6 历史连续 | 切换前的旧对话在侧栏可见、可打开、可继续发送 | 关掉 §2.8 的转换 ⇒ 旧对话不可见 |
| G7 生态隔离 | 临时 HOME 下 `~/.claude/skills/probe`、`~/.agents/skills/probe-global` 与临时项目的 `.agents/skills/probe-project` 都不出现在技能列表(F5) | `config.claude` 改回默认 ⇒ `.claude` 那条出现;去掉 `-opencode.config.compatibility` ⇒ `.agents` 两条出现 |
| G8 围栏 | 引擎派生进程写围栏外路径失败;出网全部经代理(netlog 分类) | 去掉围栏计划 ⇒ sidecar 拒绝启动(既有 fail-closed) |
| G9 凭证不导入 | 临时数据目录的假 `auth.json` 不进 provider 列表 | 去掉 S2 的处置 ⇒ 出现 |

时序类判据(启动耗时、首条回复延迟)按本机经验至少 3 轮独立采样合并判定(两轮全绿仍被第三轮翻掉过)。

### 5.2 行为基线:0.1.26 回归矩阵(alpha-work#129 的格子)

规则:一格的步骤里**发消息、调工具、装或启用扩展 / 连接器、读会话数据**,就算引擎相关,在 2.x 打包版上重跑;其余只做冒烟。

- **重跑(引擎相关):** N01、N02、N18(附件与会话记录)、N03(生图结果)、N04、N05(定制中心与连接器安装)、N06、N07、N08、N19(权限与工具策略)、
  N09、N15、N16(Office 文档工具)、N10(模型选择)、N11、N17(网络失败与出网代理)、N12(会话搜索等)、R08、R09(重启与升级提示回放)、
  R10、R11、R12(MCP 握手、重连、退避)、R13、R14、R15(生图端到端与下载恢复)、R16、R17、R18(三个权限档)、R19、R20(回执)、
  R22、R23(BYOK 目录)、W02、W03、W04(登录态、自带 Key、旧对话)、W07、W08、W09、W10、W11(云工具、旧调用回放、连接器与技能)、W22、W23、W24、W25。
- **冒烟即可:** R04–R07(主题)、W01、W12、W13(钥匙串)、W05、W20、W21(网站登录与线上目录)、W06、W14–W19、W26、W27(命名与迁移)、N00、N13、N14、W28。
- **驱动方式:** 本机打包(按既有做法:`OPENCODE_CHANNEL=prod`,先备份 `/Applications/Code Puppy.app`);能由编排器驱动的格用
  `docs/verification/2026-11-05-1554-sync-hang/packaged-sample.sh start --app <X.app> --out <dir> --cdp` 起应用并经 CDP 操作,网络格用它的
  `classify` 产出 netlog 分类;钥匙串弹窗、Office 图形界面等标「owner 实机」的格由 owner 做。
- 记录落 `docs/verification/<日期>-1662-opencode2/`,每格 PASS / FAIL / 未验证,与 0.1.26 的结果并排。

### 5.3 本地门(每条 lane 交回前、整合 PR 推送时)

- 北极星:§2.3 第 4 步的两条机械判据(树、祖先 `git merge-base --is-ancestor 33f94fce96 HEAD`,F2)+ `scripts/north-star-guard.sh`(以受审合并的上游父为基准,F3)。
- 类型检查:三个自有包;单元:`bun test src`,失败集的比较基准分两段(第 1 轮 OPTIONAL 采纳):**并行期**各 lane 与整合分支 base 比;
  **最终推送**(整合分支 → `alpha` 的那个 PR)与 `alpha` 比。
- 闸门文件登记(`scripts/assert-gate-files.sh`):lane 改了闸门文件就 `--update` 写回,改动进同一个提交。
- 文档门:改了 Markdown 跑 `scripts/check-doc-links.py`。
- 全量门只在整合 PR 推送时跑一次(dev-loop)。

## 6. 撤回方案(AC5)

### 6.1 发版前(唯一需要演练的场景)

用户手里的版本只经发版改变;发版另需 owner 原话(票面「流程」)。所以合入 `alpha` 之后、发版之前发现问题,撤回只涉及仓库与本机构建:

1. **代码:** 在 `alpha` 上 `git revert -m 1 <整合 PR 的合并提交>`,走一个普通 PR 合入。
2. **同步要同时停:** revert 之后 `alpha` 的历史里仍有 M0(第二父 = 2.x SHA),merge-base 仍在 2.x;不停的话下一次每日同步会把更新的 dev 提交
   合到一棵 1.x 树上。撤回 PR 同时让 `sync-upstream.yml` 的定时触发暂停(`gh workflow disable sync-upstream`,可逆),在撤回 PR 正文写明。
3. **重新落地**不是再合一次整合分支,而是 revert 那个 revert(git 对「撤回一个合并」的既定行为:被撤回的改动已在历史里,再合不会回来)。
4. **本机数据:** 跑过 2.x 构建的机器,库已前进 21 条迁移;换回 1.x 构建时 DB 安全带报「库超前」并阻断(`db-safety.ts:86,105`)。处置 = 用安全带在
   第一次 2.x 启动前做的 `opencode-backup-*` 恢复;切换后新建的对话随之丢失(写进撤回 PR 与 owner 说明)。
   **「库超前」时恢复界面不给「恢复备份」这个动作**(只有退出 / 备份后继续 / 继续启动,`packages/ui-mac/src/main/recovery-adapter.ts:58-74`;
   恢复动作只出现在「库损坏」时),所以要**手工恢复**,步骤照 `restoreFromBackup`(`db-safety.ts:270-293`,第 1 轮审计 F8):
   ① 完全退出应用;② 把主库 `opencode.db` 改名为 `opencode.db.corrupt-<时间戳>`;③ 把同目录的 `opencode.db-wal`、`opencode.db-shm`(若在)
   一起改名为 `…corrupt-<时间戳>-wal` / `-shm` —— 留下旧 `-wal/-shm` 会被 sqlite 回放进恢复件;④ 把备份目录(`db-safety-boot.ts:44` 的
   `backupDirOf(userData)`)里最新的 `opencode-backup-*.db` 先拷成 `opencode.db.restore-tmp`,再一次改名为 `opencode.db`;⑤ 启动 1.x 构建。

### 6.2 演练(L7 在整合分支上做一次)

1. 复制一份真实会话库到临时目录(只复制,不碰原库);记录 1.x 打包版在该副本上看到的会话条数与最新一条对话。
2. 以 2.x 打包版、`XDG_DATA_HOME` 指向该副本启动(`open -n --env XDG_DATA_HOME=<副本>` 或等价方式,沿用 `packaged-sample.sh` 不继承终端环境的约束)。
   **先确认安全带的备份文件确实生成**(备份目录里出现新的 `opencode-backup-*.db`,F8);没有就停下 —— 这正是 F1 要防的「库超前、不备份」形态。
   再记录:迁移完成、会话条数、能否继续旧对话。
3. 在一个临时分支上对「整合分支合进 `alpha`」的合并提交做 `git revert -m 1`,构建 1.x 打包版,对同一副本启动:应看到「库超前」阻断;按 §6.1 第 4 条的
   手工步骤恢复备份;会话条数与第 1 步一致。
4. 证据(每步命令、输出、截图)落 `docs/verification/<日期>-1662-opencode2/rollback-drill.md`;第 3 步的临时分支不推送。

## 7. 待 owner 裁决

这几项都按 `owner-decision` 的要求在递给 owner 时补全前因后果。O2 已由编排器定、O3 已由 owner 裁决(来源见各条,均记在裁决书
[`2026-11-08-1662-opencode2-rulings.md`](2026-11-08-1662-opencode2-rulings.md));**O1 不触发**(裁决书 R14),目前没有需要 owner 拍板的项。

**给 owner 的数据说明(不是待裁决项,随撤回说明一起递;第 1 轮审计 F12):** 第一次以 2.x 启动时,会话库会发生三件事:
① 前进 21 条迁移,之前先自动备份;② 每个旧对话转换成新格式写进新表 —— 写之前先删掉该对话在新表 `session_message` 里已有的行
(`v2:packages/core/src/database/v1-migration.bun.ts:704`);③ 清掉 `event` 表(`:562`)。旧格式的 `message`/`part` 两张表不删。

- **O1 旧对话接不上时怎么办 —— 不触发(裁决书 R14):** 触发条件是「§2.8 第 2 步的两条补法都不通」,而 L1a 实测 Node 薄适配已在合成库上
  把 3 个会话全部转换(含用过改名工具的会话),所以不递给 owner。若 L1b 在真库副本上推翻这个结论,按原条件重新走 O1,届时照 `owner-decision`
  重写;原列的三个选项留作底稿:① 接受旧对话不可见(数据还在库里,v1 表不删)—— 用户可见的退步;② 改 H3 带 bun 运行时(多约 200 MB、
  多一个要签名公证的二进制、ext 的通信要重做)—— 工期加约一周;③ 暂停切换 —— 每日同步继续坏着(`#1408`)。
- **O2 Code Puppy 的会话与凭证要不要从 `~/.local/share/opencode` 搬到自己的目录(安全面 S7)—— 已定(编排器,裁决书 R5):本票不搬。**
  本票只做 S2 的「不导入不属于 Code Puppy 的凭证」与 S7 的启动告警;搬目录是一次独立的数据迁移,另行裁决。可回退:本票不改目录,撤回不涉及数据迁移。
  (原选项「本票一起搬」未采纳。)
- **O3 「分享对话」菜单项下线(清点表 S5)—— 已裁决(owner 2026-11-09,原话「路一」,裁决书 R6):随换代拿掉侧栏「分享对话」菜单项。**
  L6 按清点表 S5 处置,ADR-047 缺项清单点名;拿掉可恢复,以后要分享另立需求自建。裁决依据(编排器 2026-11-09 实测):`https://opncd.ai`
  与 `/api/share` 均返回 `410`,上游 1.x 已于 `d320177aa4` 停掉分享 —— 0.1.26 里该功能今天已不可用,与换代无关。

## 8. 方案疑点(对编排器已定判断的核实结果)

| 已定判断 | 核实结果 | 证据 |
| --- | --- | --- |
| 1 合并目标取 dev 线上的具体 SHA(当前 `adb0053d09`),不取 `v2.2.6` 标签 | **成立,细化**:dev 头包含 2.2.6 的全部修复;但基线取 `33f94fce96`(v2.2.6 在 dev 线上的父),不取 dev 头 —— 前者是已发布代码且验证目标不漂,后者多 98 个未发布提交;两者都满足「dev 线上」 | §1.1、§2.1 |
| 2 四条路线评估 | 选 D;D 与 A 历史相同、与 B 树相同;C 不在 dev 线上,对 2.x 零推进 | §2.2 |
| 3 能力清点覆盖的轴 | 全部覆盖;额外加了「环境变量投影」与「持久化与数据」两轴,因为两处各有一个静默失效(12 个无读者变量;Node 下旧对话转换是空实现) | 清点表 §4、§10 |
| 票面「现状」写「上游 dev = OpenCode 2(2.2.6,`adb0053d09`)」 | 小订正:`adb0053d09` 是 dev 头,不是 2.2.6;2.2.6 对应的 dev 线提交是 `33f94fce96` | §1.1 |
| 票面「`origin/alpha` 自有提交 1097 个」 | 本方案实测 `git rev-list --count origin/alpha ^upstream/dev` = 990(非合并 884);口径不同,不影响结论 | §1.1 |
| 第 1 轮 F4「合入 `alpha` 后对新出现的上游 workflow 逐个 `gh workflow disable`」(已按裁决回写,未改) | **依据成立**(`33f94fce96` 有 21 个 workflow,含两个 triage 文件;其中 20 个 alpha 今天没有)。**另有一处时序缺口,交编排器裁**:有几个上游 workflow 在合入 `alpha` **之前**就会跑。`pull_request_target` 用**目标分支**里的 workflow 定义:M0 推上整合分支后,每个进整合分支的 lane PR 都会触发 `triage-pr-standards.yml`(`opened/edited/synchronize`,`pull-requests: write`,会加标签)与 `triage-contributor.yml`(`opened`,`pull-requests: write`、`issues: write`)。`pull_request` 用 PR 自身(head)的定义:`check-bot-scope.yml` 不设分支过滤,对 lane PR 与最终 PR 都会跑;最终 PR 还会命中带路径过滤的 `check-docs.yml`、`check-process-daemon.yml`、`release-process-daemon.yml`、`release-dry-run.yml`(这些文件或被它们盯的路径在 PR 里是新增)。前两者带写权限,是本仓自己的流程(lane PR 进整合分支)走得到的状态 | 逐个读 `git show 33f94fce96:.github/workflows/<文件>` 的 `on:` 段与 `permissions:`;可选的处置方向(不在本方案里定):M0 先不带入上游 workflow 文件、等进 `alpha` 时再按 F4 一次处理;或 lane 不经 GitHub PR、在本机合进整合分支 |

## 9. 仍是推断、没跑过的断言

- ~~H1 能在 Electron 42 的 Node 24.15 里起 2.x 引擎并完成一条回复~~ —— 已实测(裁决书 R15 ⑥;L1a 勘破 §3 的 armC、armFfence:围栏下 0.32 s 起引擎,回复经生产出网代理)。
  打包形态(asar、签名公证、hardened runtime)仍未测,归 L7。
- ~~`start()` 的 `Transform` 能拿到与监听同一张图的进程内 fetch~~ —— 已实测(L1a 勘破 §4 E2,两条接法都过;裁决书 R13 取 `start()` + `Transform`)。
  `start()` 传 `lifecycle` 后启动时续跑中断会话,只读了代码(`v2:packages/server/src/process.ts:113-114`),没跑。
- ~~`#v1-migration` 的构建期变换 + Node 薄适配能在 Node 下跑通旧对话转换~~ —— 合成库上已实测(L1a 勘破 §5 E3;裁决书 R14);真库副本未测,归 L1b。
- 2.x 对 Code Puppy **真库副本**的前进迁移会成功 —— 合成库上已实测 40 → 61、无旧无名 `__drizzle_migrations` 表(L1a 勘破 E3,裁决书 R15 ②);
  真库属于哪一种、走 Code Puppy 启动预检时的结论,归 L1b。
- ext 能被安排为 `execute.before` 钩子链的最后一个回调 —— 2.x 插件装载顺序没实测。
- 插件 npm 自更新对本地路径插件不触发 —— 没读完 `plugin/update.ts` 的调用方。
- `/global/health` → `/api/info`、`mcp.auth` 的 2.x 入口、`project.list` 的 2.x 对应 —— 映射未逐个核实。
- 分享服务今天是否已不可用 —— 本方案员没跑;编排器 2026-11-09 实测 `https://opncd.ai`、`/api/share` 均返回 `410`(裁决书 R6),O3 据此已裁。
- `plugins` 里注入 `-opencode.config.compatibility` 能关掉 `.claude` 与 `.agents` 两类技能根(S6,F5)—— 只读了 `source.ts`/`supervisor.ts`/`internal.ts`,没跑。
- Code Mode 目录闸的两种机制(snapshot 规则集注入 deny / 对 Code Puppy 管的 MCP server 注入 `codemode: false`)哪种可行(S1,F6)—— 只读了 `tool/mcp.ts:57` 与 `mcp/index.ts:490`,没跑。
- §4.3 的工时与日历估计 —— 按计数外推,不是测量。
- 本机 2.x 构建可用 `open -n --env XDG_DATA_HOME=…` 指向库副本 —— 没跑。
- 用户 shell 里的 `OPENCODE_FLAGS` 经 sidecar 环境白名单进入引擎、绕过渠道默认值(§2.7)—— 只读了 `v2:packages/core/src/flag.ts:22` 与 `sidecar-env.ts:108`,没跑。
