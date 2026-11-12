---
id: SPEC-resident-project-watchers
title: 长期使用项目时监听与内存保持受控
summary: 长期使用项目时监听与内存保持受控，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 长期使用项目时监听与内存保持受控

长期使用项目时监听与内存保持受控。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [意图与处置 impharaon/alpha-work:INT-desktop/I-02](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/INT-desktop.md#意图点)。
- 历史身份：[impharaon/alpha-code#176](https://github.com/impharaon/alpha-code/issues/176)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/149)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/app/src/utils/server.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/utils/server.ts)
  - [alpha-code:packages/core/src/v1/config/server.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/core/src/v1/config/server.ts)
  - [alpha-code:packages/desktop/src/main/server.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/desktop/src/main/server.ts)
  - [alpha-code:packages/opencode/src/lsp/server.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/opencode/src/lsp/server.ts)
  - [alpha-code:packages/opencode/src/project/instance-store.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/opencode/src/project/instance-store.ts)
  - [alpha-code:packages/opencode/src/server/routes/instance/httpapi/server.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/opencode/src/server/routes/instance/httpapi/server.ts)
  - [alpha-code:packages/opencode/src/server/server.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/opencode/src/server/server.ts)
  - [alpha-code:packages/sdk/js/src/server.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/sdk/js/src/server.ts)

## 业务规则

- **BR-01** `OPENCODE_EXPERIMENTAL_FILEWATCHER` 强开评估:关掉后功能影响清单(文件树/diff 刷新等),决策落文档。
- **BR-02** 采取杠杆后:常驻 watcher 数与长时运行内存增长实测下降。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | `OPENCODE_EXPERIMENTAL_FILEWATCHER` 强开评估:关掉后功能影响清单(文件树/diff 刷新等),决策落文档; | [原票](https://github.com/impharaon/alpha-code/issues/176) |
| AC-02 | 采取杠杆后:常驻 watcher 数与长时运行内存增长实测下降; | [原票](https://github.com/impharaon/alpha-code/issues/176) |
| AC-03 | 明确记录「上游本体接受」结论(不排改上游任务)。 | [原票](https://github.com/impharaon/alpha-code/issues/176) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/176)，本次不新增验收结论。 |
