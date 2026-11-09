---
title: alpha-code#1662 方案基线 —— 编排器裁决书
kind: design
status: active
owners: [alpha-code maintainers]
last_reviewed: 2026-11-09
---

# alpha-code#1662 编排器裁决书(方案审第 1 轮前)

对象:[`2026-11-08-1662-opencode2-generation-switch-baseline.md`](2026-11-08-1662-opencode2-generation-switch-baseline.md)、
[`2026-11-08-1662-opencode2-capability-inventory.md`](2026-11-08-1662-opencode2-capability-inventory.md)、
`.claude/rules/adrs/ADR-047-opencode2-engine-generation.md`(`29b8bf1fa4`)。

锚:owner 2026-11-08「我希望可以升级到 opencode 2 最新版本。」「作为编排器来执行。」「不要再使用 codex 直接用 opus」。

| # | 裁决 | 依据(实测坐标;未实测的标「推断」) |
| --- | --- | --- |
| R1 | 采纳路线 D(整合分支上一个真合并提交,树按 2.x 重建,历史照常合并;整条分支 `gh pr merge --merge` 进 `alpha`)。A、B、C 按基线 §2.2 否决。 | 实测:`scripts/north-star-guard.sh --print-takeover` 的 49 条里 34 条在 `upstream/dev` 不存在;`upstream/dev:packages/opencode/package.json` 不存在;试合并 205 条 `CONFLICT`,154 条 modify/delete。 |
| R2 | 合并目标取 `33f94fce96`(v2.2.6 在 dev 线上的父提交)。 | 实测:`git rev-parse upstream-v2.2.6^1` = `33f94fce96`;`git merge-base --is-ancestor 33f94fce96 upstream/dev` 为真;发布提交改 36 个文件,均为版本号与更新说明。 |
| R3 | 引擎宿主默认 H1(嵌入 `utilityProcess`),以 L1 的三条退出条件定夺;任一不满足改 H3;H2 否决(违反 S7)。H1/H3 是整合分支内可回退的技术选择,不交 owner。 | 基线 §2.4;H1 在 Node 24.15 下能否起引擎为推断,L1 实测。 |
| R4 | 旧对话连续性按基线 §2.8:构建期变换让 `#v1-migration` 解析到 `v1-migration.bun.ts`,为 `:808`、`:1170` 两处 bun 专有调用做 Node 薄适配;不通改 H3;两条都不通才交 owner(O1)。 | 实测:`packages/core/src/database/` 下同时有 `v1-migration.bun.ts` 与 `v1-migration.noop.ts`。补法可行性为推断,L1 实测。 |
| R5 | **O2 由编排器定:本票不搬数据目录**;只做 S2(不导入不属于 Code Puppy 的凭证)与 S7 的启动告警。搬目录是一次独立的数据迁移,另行裁决。可回退:本票不改目录,撤回不涉及数据迁移。 | 基线 §7 O2、§3 S2/S7。 |
| R6 | **O3 已由 owner 裁决(2026-11-09,原话「路一」):随换代拿掉侧栏「分享对话」菜单项**(L6 按清点表 S5 处置;ADR-047 缺项清单点名)。拿掉可恢复;以后要分享另立需求自建。 | 实测(2026-11-09):`https://opncd.ai`、`/api/share` 均返回 `410`,上游 1.x 已于 `d320177aa4`「discontinue session sharing」—— 0.1.26 里该功能今天已不可用,与换代无关。 |
| R7 | 采纳 L1–L7 切分与依赖(L1 → L2 →(L3 ∥ L4 ∥ L5 ∥ L6)→ L7);整合分支名 `engine/1662-opencode2`。**L1 出结论(定 H1/H3、真库副本迁移结果)之前,不派 L2 之后的任何实现。** 执行体按 alpha-work `CLAUDE.md`:实现 `alpha-impl` `opus`,审计 `auditor` `opus` 另起会话。 | 基线 §4.1;owner 2026-11-08 路由指令。 |
| R8 | 采纳 S1–S8 为冻结不变量。S1 的唯一咽喉 = `Tool.execute` 的 `execute.before`;Code Puppy 执行闸要么是链上最后一个回调,要么在它之后的任何改写都让调用被拒 —— 实现二选一并写测试,不另找第二条通路。 | 基线 §3;`v2:packages/core/src/tool.ts:123-131`、`hooks.ts:88-95`(推断,审计核)。 |
| R9 | AC 改写只采纳基线 §4.2 那一处(AC1 证据补「ADR-037 决策 5 的入口枚举写进 PR 正文」);票面「2.2.6 = `adb0053d09`」订正为 `33f94fce96`。 | 基线 §4.2、§8。 |
| R10 | 规模估计(115–185 agent 小时、2–3 周、owner 实机 4–5 小时)记为推断,L1 结束后重估一次再报 owner。 | 基线 §4.3。 |
| R11 | 接受方案员在 `.claude/rules/DECISIONS.md` 补的 ADR-047 索引行(该文件自身规则要求)。 | `29b8bf1fa4` diff。 |

审计方的任务:找事实错误、走本仓代码与 runbook 到得了的失败状态、或同样满足全部 AC 的更简单解。只给另一种写法、更严或更全而没有上述三者的,维持原裁决。

## 方案审第 1 轮处置(2026-11-09,auditor opus,RECOMMEND: FIX-THEN-MERGE)

全部 12 条采纳(都走得到、都对应 AC 或闸门真假,修法取最小)。由方案作者回写基线、清点表与 ADR-047;第 2 轮只判这些条目闭合与回写 diff。

| # | 采纳的修法(要回写的地方) | 依据(编排器核实) |
| --- | --- | --- |
| F1 Major | §2.8 与 L2:alpha 自有的两条退役迁移 id(`20260720085655_permission-decision-receipt`、`20260720094009_permission-request-admission`)进 2.x 构建的 DB 支持面(冻结清单并入 `db-expected-migrations.json`),否则老用户每次启动都弹「库比应用新」且前进前不备份;db-safety 加带这两个 id 的夹具库,期望走「待前进」;L1b 的真库副本实验走 Code Puppy 预检,不只跑裸引擎。 | 实测:两条迁移在 `origin/alpha:packages/core/src/database/migration/`;`db-safety.ts:105-106` 先判未知 id 再判待前进。 |
| F2 Major | §2.3、L2、§5.3:M0 直推整合分支或 `--merge` 合入,整合分支只用 merge 吸收 `alpha`(禁止 squash/rebase);L2 退出条件、§5.3、最终合并前加 `git merge-base --is-ancestor 33f94fce96 HEAD`,并带「squash 重放后必须红」的反向用例。 | runbook 默认 squash(alpha-work `CLAUDE.md`、alpha-code `ci.md`);§2.3.4 只比树。 |
| F3 Major | L2 边界与退出条件:守卫在含受审上游合并的分支上,`packages/` 辖区改以该合并的上游父为基准判;两臂:M0 后再改一个上游文件必须红,M0 原样的上游改动必须绿。不得靠 `--no-verify` 过 7 条 lane 的推送。 | 守卫头注 `scripts/north-star-guard.sh:24` 起:基准 = `origin/alpha`。 |
| F4 Major | §2.3:`packages/` 之外的路径逐文件定归属(上游来源的跟 `33f94fce96` 增删,Code Puppy 的跟 alpha);L2 退出条件:合入后对新出现的上游 workflow 逐个 `gh workflow disable`,并在合入前列出清单。 | 实测 `upstream/dev:.github/workflows/` 21 个,含 `triage-compliance-close.yml`、`triage-pr-standards.yml`;2026-11-02 已有过一次「改名 workflow 被自动启用」的事故(`codepuppy-ci`)。 |
| F5 Major | S6 形状点名 `~/.agents` 与项目 `.agents` 两类技能根的处置与所在主权阶梯层;判据加这两臂。 | `v2:core/src/config/discovery.ts:152-166`、`compatibility.ts:44-56`;本机今天无 `~/.agents/skills`,但属安全/同意类不变量,判据漏路即假闸。 |
| F6 Major | S1 形状写明 Code Mode 工具的目录闸机制(往 snapshot 规则集注入 deny,或对 Code Puppy 管的 MCP server 注入 `codemode:false`,二选一);A 组判据同时断言 Code Mode 目录里没有被拒工具,并带反向臂。 | 实测 `v2:core/src/tool/mcp.ts:57` `codemode: tool.codemode !== false`。 |
| F7 Major | 清点表 C1/C3/C6/E3 在 H1 下改记「改形:由 sidecar 构造 `ServerOptions`」;「每个 `OPENCODE_*` 有读者」测试改为断言传给 `start()`/`ServerFetch.make` 的选项对象(或把找读者范围限定在宿主实际装载的模块),反向臂:只有 CLI 读的变量必须红。宿主映射与 `db-safety.ts:36-51` 的库路径推导共用一个 Code Puppy 侧函数(ARCH-NOTE 3,避免再造上游宿主的决定)。 | 审计读码:`v2:cli/src/server-process.ts:101-145` 不在 H1 路径上。 |
| F8 Minor | §6:写手工恢复步骤(照 `db-safety.ts:278-288`,连 `-wal/-shm` 一起挪);演练第 2 步先确认备份文件存在。 | 「库超前」时恢复动作不出现(`recovery-adapter.ts:58-74`)。 |
| F9 Minor | §2.3.4 判据排除 `app|ui`(由 `assert-frontend-patch-roundtrip.sh` 覆盖)。 | 守卫 carve-out 已含二者。 |
| F10 Minor | L2 用过渡清单判;L4 退出条件:对最终清单重跑 `sync-upstream-takeover-isolation.test.ts` 与 `north-star-guard.test.ts`,并定好清单为空时的同步行为(不得 `exit 1`)。 | `sync-upstream.yml:131-133`。 |
| F11 Minor | L3 退出条件加「清点表 S7 的 ext 部分」(`reload-scheduler.ts` 的 `/session/status`、`/instance/dispose`)。 | 审计读码。 |
| F12 Minor | 改正 §1.4 与 D4/D6:v1 转换会先删该会话在 `session_message` 的行再写转换结果;把这项与 `event` 删除一起写进给 owner 的说明。 | `v2:core/src/database/v1-migration.bun.ts:704`(审计读码)。 |

OPTIONAL 采纳两条:S2 删掉「在注入里让 providers 只认 Code Puppy 的条目」那一种实现(导入迁移不看配置,`20260805200742_import_legacy_credentials.ts`),只保留「首次以 2.x 启动前处置数据目录里的 `auth.json`」;§5.3 写明并行期 lane 与整合分支 base 比、最终推送与 `alpha` 比。其余 OPTIONAL 与 out-of-round 记残余,不改方案:`session.hook.context` 改名需经同意的插件才会发生;配置目录插件自动装载 v1 已有、非本次引入;`opencode-pty` 走 PATH 今天承受者为零。

ARCH-NOTE:① ADR-047「前端 pin 与引擎同一 SHA」改为「切换时同一 SHA,之后保持同一代次」(与 ADR-034 月更不冲突);② `ServerFetch.make` 作为 H1 退出条件 ② 的候选,已横向传给 L1a 实测;③ 并入 F7。

## L1a 实测后的裁决(2026-11-09;勘破文档在分支 `spike/1662-l1-engine-host` 的 `docs/architecture/2026-11-09-1662-l1-engine-host-spike.md`,提交 `0bfbdfb205`)

| # | 裁决 | 依据 |
| --- | --- | --- |
| R13 | **引擎宿主定 H1。** 进程内接法取「`start()` + Transform」,并传 lifecycle(启动时恢复中断会话);不取 `ServerFetch.make`。必须同时守住:以正式渠道启动(`app.channel` 为 `local`/`dev` 会默认打开 `todo`/`schedules`/`media_blob`/`artifacts`/`background_compaction`,`core/src/flag.ts:26,70`);`http.setGlobalProxyFromEnv()` 留在引擎 import 之前(`sidecar.ts:148,267-269`)。 | L1a 实测:E1 有围栏经出网代理回复,对照臂无代理设置 `ENOTFOUND`;E2 两条接法都过,`ServerFetch.make` 不跑 Schedule runner。取 `start()` 是消费上游宿主的决定、Code Puppy 侧少持有一层(审计 ARCH-NOTE 3)。 |
| R14 | **旧对话按 §2.8 的 Node 薄适配做**;O1 不触发。`:1170`(`Bun.CryptoHasher`)必做,夹具必须含改名工具或合成 part 的会话(纯文本会话走不到它);`:808`(`bun:sqlite`)只在存在 `opencode-next.db` 时走到,保留适配(两处都很小、上游源码不动)。 | L1a 实测 E3:3 会话 / 13 消息转换为 3 / 14(多一条改名提示);去掉 `:1170` 适配在工具会话处 `Bun is not defined` 中断;上游原版 Node 构建下旧对话全不可见而状态报 `completed`。 |
| R15 | 基线事实订正(随第 1 轮回写一并改):① 转换不把历史里的 `bash` 改名为 `shell`,只追加一条给模型的提示(`v1-migration.bun.ts:1005-1030`),K5 的 UI 工具卡与身份账本要同时认两个名字;② 1.18.35 建的库用 `migration` 表、没有旧的无名 `__drizzle_migrations`,2.x 补 21 条(40 → 61)且不碰 alpha 的两行与两张表 —— 与 F1 合看:引擎侧不会挡,挡的是 Code Puppy 的 db-safety;③ §1.3 补「上游原版 Node 构建下旧对话静默不可见」;④ §2.4 补代理设置的顺序前提;⑤ §2.7 补正式渠道;⑥ §9 第 1 条(Node 24.15 下能起引擎)划掉,已实测。 | L1a 勘破文档与对照臂输出。 |

## 第 1 轮回写后的新增裁决(2026-11-09,对应基线 §8 L495 与 §2.7 L289-290)

| # | 裁决 | 依据 |
| --- | --- | --- |
| R16 | **整合过程不在 GitHub 上开 lane PR**:各 lane 提交在自己的分支,由编排器(或 `integrator`)在本机 merge 进 `engine/1662-opencode2`;整合分支以非分支引用 `refs/backup/1662/engine` 推到远端做跨机备份(非 `refs/heads/*` 不触发 workflow)。**落地方式**:整合分支 HEAD 本机全量门绿后,按 `docs/runbooks/ci.md` §4.3「或直接推这个合并提交」推进 `alpha`,紧接着用 L2 事先列好的清单逐个 `gh workflow disable` 新出现的上游 workflow 并读回状态。L2 的退出条件加:清单(名称 + 触发器)与停用脚本在位。 | 方案员实测:M0 推上 GitHub 后,`triage-pr-standards.yml`(opened/edited/sync)、`triage-contributor.yml`(opened)带写令牌对指向整合分支的 PR 触发;`check-bot-scope.yml` 无分支过滤。2026-11-02 已有改名 workflow 被自动启用的事故。 |
| R17 | 采纳方案员补充:L5 从继承给引擎的环境里去掉 `OPENCODE_FLAGS`(它是引擎的最高优先级覆盖,`v2:packages/core/src/flag.ts:22`,会绕过 R13 的正式渠道默认值)。 | 读码;修法一行、同一调用链(R13)。 |

## L1b 第一步后的裁决(2026-11-09;做法在分支 `spike/1662-l1-engine-host` 的勘破文档 §8,提交 `fba14db89d`)

| # | 裁决 | 依据 |
| --- | --- | --- |
| R18 | **db-safety 在 WAL 库上只读打开失败而静默跳过,是既有缺陷,但挡住本票(F1 的修法、前进前备份、AC5 撤回都依赖它),在 #1662 内修,归 L2。** 修法由 L2 定,判据写死:一份「WAL 模式、正常关闭后无 `-wal`/`-shm`」的真 SQLite 夹具库,启动预检必须给出 `db-ahead` / `migrate-ahead` 而不是 `skip`,备份必须成功并通过校验;反向臂:把读法改回 `-readonly` 直开,该测试必须红。不用 `immutable=1` 读有活写入者的库(L1a 实测会丢 WAL 行)。 | 实测(编排器):`packages/ui-mac/src/main/db-safety.ts:64` 读 id、`:197`/`:203` 备份都用 `sqlite3 -readonly`;owner 的 `~/.local/share/opencode/opencode.db` 旁当前无 `-wal`/`-shm`。L1a 在同形态合成库上实测 `exit=14 unable to open database file`、两种期望都回 `skip`;`db-safety.test.ts` 的真 SQLite 用例只建非 WAL 库。真库是否复现由 L1b 第二步确认。 |

## L1b 实测后的裁决(2026-11-09;勘破文档 §9「L1b 结果」,提交 `a93deeae70`)

| # | 裁决 | 依据 |
| --- | --- | --- |
| R19 | **数据连续性按方案成立,不改路线。** R18 的缺陷在真库上复现,维持在 L2 内修。F1 的修法(两条退役 id 进支持面)在真库上验证成立。另记一格给 L7:首次以 2.x 启动、转换旧对话时,会检查每个会话所在的磁盘目录;位于 `~/Documents` 等受 macOS 隐私保护目录下的会话可能触发一次系统授权框。L7 在打包版上实测首启表现,并记录拒绝授权时这些会话的归属(只影响项目归属,不影响会话与消息条数)。不为此改代码,除非 L7 实测出用户可见的错误。 | 真库只读副本实测:WAL 库、`migration` 表 40 行、含 alpha 两条 id;只读打开 `exit=14`、两种期望都 `skip`;可写克隆路径下 2.x 清单 → `db-ahead`(未知 = alpha 两条),加两条 → `migrate-ahead`(21 条待前进)、备份成功;node24 上游构建转换后会话 119 → 119,v1 的 597 条用户 + 助手消息全部保留(另增 27 条合成、40 条改名提示),引擎 0 警告 0 错误;owner 数据目录 3688 条快照前后一致,副本已删。 |
