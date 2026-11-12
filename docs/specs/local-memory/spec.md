---
id: SPEC-local-memory
title: 本机记忆可查看、修改、删除并按项目用于对话
summary: 本机记忆可查看、修改、删除并按项目用于对话，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: owner（历史批准沿用）
approved_at: 2026-11-12
owners: [owner]
last_reviewed: 2026-11-12
---

# 本机记忆可查看、修改、删除并按项目用于对话

本机记忆可查看、修改、删除并按项目用于对话。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [意图与处置 impharaon/alpha-work:INT-memory/I-01](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/INT-memory.md#意图点)。
- 历史身份：[impharaon/alpha-work#24](https://github.com/impharaon/alpha-work/issues/24)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/24)。
- [有效范围或验收依据 2026-08-25](https://github.com/impharaon/alpha-work/issues/24#issuecomment-5406072239)。
- [有效范围或验收依据 2026-09-17](https://github.com/impharaon/alpha-work/issues/24#issuecomment-5708434657)。
- [有效范围或验收依据 2026-11-09](https://github.com/impharaon/alpha-work/issues/24#issuecomment-6731151397)。

- [批准/事实依据](https://github.com/impharaon/alpha-work/issues/24#issuecomment-5708434657)。
- 交付入口：[alpha-code#1675](https://github.com/impharaon/alpha-code/issues/1675)、[alpha-code#1676](https://github.com/impharaon/alpha-code/issues/1676)；实现与验收状态由这些票及其原生子票持有。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：仅本机记忆；原云同步 AC2/7 已删除。ADR-045 与 alpha-code#427 已决定注入方式，不能再写为待选择。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/core/src/location-services.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/core/src/location-services.ts)
  - [alpha-code:packages/ui-mac/src/main/codepuppy-user-workspace.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/codepuppy-user-workspace.ts)

## 业务规则

- **BR-01** 升级后现有本机记忆目录(今天为 `~/code-puppy/Memory`,以 codepuppy-user-workspace.ts 的默认工作目录为唯一权威)保持用户可读、可编辑、可离线,且不会被自动上传、覆盖或删除。
- **BR-02** 在桌面修改一条记忆时,若该文件已被外部编辑,冲突可见且不静默覆盖。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 升级后现有本机记忆目录(今天为 `~/code-puppy/Memory`,以 codepuppy-user-workspace.ts 的默认工作目录为唯一权威)保持用户可读、可编辑、可离线,且不会被自动上传、覆盖或删除。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-work/issues/24) · [最后裁决](https://github.com/impharaon/alpha-work/issues/24#issuecomment-6731151397) |
| AC-02 | ~~用户可按条目/作用域选择 local-only 或 cloud-synced；首次同步有版本化同意，撤销后新云任务立即失权。~~ —— 2026-09-17 删除(owner 裁决):云同步删去,本机版没有同步与同意。 | [原票](https://github.com/impharaon/alpha-work/issues/24) · [最后裁决](https://github.com/impharaon/alpha-work/issues/24#issuecomment-6731151397) |
| AC-03 | 在桌面修改一条记忆时,若该文件已被外部编辑,冲突可见且不静默覆盖。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-work/issues/24) · [最后裁决](https://github.com/impharaon/alpha-work/issues/24#issuecomment-6731151397) |
| AC-04 | 对话只带入当前项目范围内的记忆,数量与长度有上限,并在对话中可见本次用了哪几条。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-work/issues/24) · [最后裁决](https://github.com/impharaon/alpha-work/issues/24#issuecomment-6731151397) |
| AC-05 | 记忆成为 active 的唯一通路是用户显式确认;网页、连接器、工具与会话压缩来源只能生成待确认候选;记忆内容不参与任何动作授权判断。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-work/issues/24) · [最后裁决](https://github.com/impharaon/alpha-work/issues/24#issuecomment-6731151397) |
| AC-06 | 用户可在桌面查看、修改、删除本机记忆;删除后该条立即不再进入对话。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-work/issues/24) · [最后裁决](https://github.com/impharaon/alpha-work/issues/24#issuecomment-6731151397) |
| AC-07 | ~~同步、索引和 purge 经持久 intent + Queue/DLQ 可恢复，失败不只留 console；redrive 不重复计费、不覆盖新 revision、不复活 tombstone。~~ —— 2026-09-17 删除(owner 裁决):同步、索引与清除的 Queue/DLQ 恢复随云端部分删去。 | [原票](https://github.com/impharaon/alpha-work/issues/24) · [最后裁决](https://github.com/impharaon/alpha-work/issues/24#issuecomment-6731151397) |
| AC-08 | 提示注入内容不会未经确认成为记忆;删除后的记忆不再被对话使用。(原矩阵删去租户、用户、设备轴,保留这两格) _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-work/issues/24) · [最后裁决](https://github.com/impharaon/alpha-work/issues/24#issuecomment-6731151397) |

证据与适用边界：沿用 owner「批准」的本机范围，云同步 AC-02/07 删除。alpha-code#1675 承接 AC-01/03（实现 #424），#1676 承接 AC-04/05/06/08（实现 #425）。ADR-045 与 #427 的注入方式已经决定，不再回到选择阶段。

## 待决

无新的需求批准事项；上述历史批准继续有效。规格批准不等于实现、部署或验收完成，尚缺证据与实施工作由来源中的交付入口负责。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 0 | 2026-11-10 | — | 整理历史来源；尚未作为当前批准基线。 |
| 1 | 2026-11-12 | owner（历史批准） | 沿用既有批准的范围/裁决，2026-11-12 为规格登记日，不是新的 owner 批准日。[依据](https://github.com/impharaon/alpha-work/issues/24#issuecomment-5708434657)。 |
