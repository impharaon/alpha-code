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
