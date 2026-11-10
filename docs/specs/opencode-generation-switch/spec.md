---
id: SPEC-opencode-generation-switch
title: 升级引擎后保留当前桌面体验与整体撤回能力
summary: 升级引擎后保留当前桌面体验与整体撤回能力，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: draft
version: 0
approved_by: ""
approved_at: ""
owners: [owner]
last_reviewed: 2026-11-10
---

# 升级引擎后保留当前桌面体验与整体撤回能力

升级引擎后保留当前桌面体验与整体撤回能力。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-engineering](https://github.com/impharaon/alpha-work/blob/d4a80d9c2ef0df32c58173310d9e368fa7bc9069/docs/requests/RQ-engineering.md)。
- 历史身份：[impharaon/alpha-code#1662](https://github.com/impharaon/alpha-code/issues/1662)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/154)。
- [有效范围或验收依据 2026-11-09](https://github.com/impharaon/alpha-code/issues/1662#issuecomment-6736300635)。
- [有效范围或验收依据 2026-11-09](https://github.com/impharaon/alpha-code/issues/1662#issuecomment-6736317973)。
- [有效范围或验收依据 2026-11-09](https://github.com/impharaon/alpha-code/issues/1662#issuecomment-6736730273)。

## 用户与范围

- 用户：维护与升级应用、服务的人员。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：进行中的换代设计与 lane 范围保持原样。2026-11-09 裁决：当前 Code Puppy 界面为权威；项目身份由 OpenCode 2 /api/project 持有；后续 L4/L5 修订以最新评论为准。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:github/package.json](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/github/package.json)
  - [alpha-code:package.json](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/package.json)
  - [alpha-code:packages/app/package.json](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/package.json)
  - [alpha-code:packages/cli/package.json](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/cli/package.json)
  - [alpha-code:packages/client/package.json](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/client/package.json)
  - [alpha-code:packages/codemode/package.json](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/codemode/package.json)
  - [alpha-code:packages/codepuppy-contracts-consumer/package.json](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/codepuppy-contracts-consumer/package.json)
  - [alpha-code:packages/console/app/package.json](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/package.json)

## 业务规则

- **BR-01** Code Puppy 引擎切换到 OpenCode 2 最新版,且不留半代次链路(ADR-037 决策 5)。证据:能力清点表与合并后的代码坐标;ADR-037 决策 5 的入口枚举(三个发送入口、三个事件消费点、审批停靠区)各自调用的代次,写进最终 PR 正文。
- **BR-02** ADR-037 决策 3 的能力清点表:Code Puppy 依赖的每项引擎能力在 OpenCode 2 中的对应位置逐格填 `file:line`,缺口逐项有处置。证据:`docs/design/` 方案基线。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | Code Puppy 引擎切换到 OpenCode 2 最新版,且不留半代次链路(ADR-037 决策 5)。证据:能力清点表与合并后的代码坐标;ADR-037 决策 5 的入口枚举(三个发送入口、三个事件消费点、审批停靠区)各自调用的代次,写进最终 PR 正文。 | [原票](https://github.com/impharaon/alpha-code/issues/1662) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1662#issuecomment-6736730273) |
| AC-02 | ADR-037 决策 3 的能力清点表:Code Puppy 依赖的每项引擎能力在 OpenCode 2 中的对应位置逐格填 `file:line`,缺口逐项有处置。证据:`docs/design/` 方案基线。 | [原票](https://github.com/impharaon/alpha-code/issues/1662) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1662#issuecomment-6736730273) |
| AC-03 | 桌面端现有用户可见功能在打包版上端到端行为与切换前一致(ADR-037 决策 4:生产代码、用户入口、可观测结果、改回旧代次时闸门转红)。证据:`docs/verification/` 记录。 | [原票](https://github.com/impharaon/alpha-code/issues/1662) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1662#issuecomment-6736730273) |
| AC-04 | 每日上游同步恢复为跟随 OpenCode 2 主线并能成功运行或按接管规则明确停下。证据:合入后的同步运行记录。 | [原票](https://github.com/impharaon/alpha-code/issues/1662) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1662#issuecomment-6736730273) |
| AC-05 | 可整体撤回:撤回步骤写明并在分支上演练过一次。证据:演练记录。 | [原票](https://github.com/impharaon/alpha-code/issues/1662) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1662#issuecomment-6736730273) |

## 待决

进行中的换代设计与 lane 范围保持原样。2026-11-09 裁决：当前 Code Puppy 界面为权威；项目身份由 OpenCode 2 /api/project 持有；后续 L4/L5 修订以最新评论为准。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 0 | 2026-11-10 | — | 整理历史来源；尚未作为当前批准基线。 |
