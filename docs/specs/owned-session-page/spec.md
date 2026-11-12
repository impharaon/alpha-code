---
id: SPEC-owned-session-page
title: 会话页保持自己的完整交互与工具卡
summary: 会话页保持自己的完整交互与工具卡，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 会话页保持自己的完整交互与工具卡

会话页保持自己的完整交互与工具卡。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [意图与处置 impharaon/alpha-work:INT-desktop/I-09](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/INT-desktop.md#意图点)。
- 历史身份：[impharaon/alpha-code#538](https://github.com/impharaon/alpha-code/issues/538)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/149)。
- [有效范围或验收依据 2026-08-12](https://github.com/impharaon/alpha-code/issues/538#issuecomment-5263969876)。
- [有效范围或验收依据 2026-08-17](https://github.com/impharaon/alpha-code/issues/538#issuecomment-5311565911)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：AC1/3 不含 Markdown F3–F5；AC4 审批归唯一审批面；AC6 不再提供旧上游页面逃生阀。原 AC8–11 是独立工具卡条款，另列在 tool-card-provenance 规格。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/cards/tool-card-model.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/cards/tool-card-model.test.ts)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/cards/tool-card-model.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/cards/tool-card-model.ts)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/cards/tool-cards.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/cards/tool-cards.tsx)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/cards/tool-redactor.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/cards/tool-redactor.test.ts)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/session-timeline-view.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/session-timeline-view.tsx)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/timeline-model.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/timeline-model.ts)
  - [alpha-code:packages/ui-mac/test-component/session-timeline.cases.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/test-component/session-timeline.cases.ts)

## 业务规则

- **BR-01** 打开任一会话,整页(顶栏/左栏/时间线/输入框/右栏)呈现已批稿形态,无双 header。**范围不含** Markdown 引擎层 F3/F4/F5（表格头底色/代码块语言头条/链接配色）——已正式转交后继 [#592](https://github.com/jinjunnn/alpha-code/issues/592)（搁置至 2026-08-21 复审）。证明:V1 视觉矩阵（除 F3–F5）。
- **BR-02** 右栏审查/文件/终端/产物四面板可切换且形态符合已批稿;审查含统一/拆分与两种空态。证明:面板行为测试 + V1。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 打开任一会话,整页(顶栏/左栏/时间线/输入框/右栏)呈现已批稿形态,无双 header。**范围不含** Markdown 引擎层 F3/F4/F5（表格头底色/代码块语言头条/链接配色）——已正式转交后继 [#592](https://github.com/jinjunnn/alpha-code/issues/592)（搁置至 2026-08-21 复审）。证明:V1 视觉矩阵（除 F3–F5）。 | [原票](https://github.com/impharaon/alpha-code/issues/538) · [最后裁决](https://github.com/impharaon/alpha-code/issues/538#issuecomment-5311565911) |
| AC-02 | 右栏审查/文件/终端/产物四面板可切换且形态符合已批稿;审查含统一/拆分与两种空态。证明:面板行为测试 + V1。 | [原票](https://github.com/impharaon/alpha-code/issues/538) · [最后裁决](https://github.com/impharaon/alpha-code/issues/538#issuecomment-5311565911) |
| AC-03 | 时间线各消息类型以 alpha 组件渲染,零上游 session DOM 依赖。**范围不含** Markdown 引擎层 F3/F4/F5（同上，转交 #592）。证明:生产入口挂载断言测试 + V1（除 F3–F5）。 | [原票](https://github.com/impharaon/alpha-code/issues/538) · [最后裁决](https://github.com/impharaon/alpha-code/issues/538#issuecomment-5311565911) |
| AC-04 | 会话页 composer 与首页同源组件直挂(无 Portal 接管);任务 dock 可用;审批走唯一 Permission surface（[#619](https://github.com/jinjunnn/alpha-code/issues/619) 裁决：审批非 dock）。证明:composer/dock fail-closed 测试 + V1。 | [原票](https://github.com/impharaon/alpha-code/issues/538) · [最后裁决](https://github.com/impharaon/alpha-code/issues/538#issuecomment-5311565911) |
| AC-05 | 上游 session 叶布局变更(如 newLayoutDesigns 翻转)不影响 alpha 会话页形态。证明:零上游 import/选择器静态断言测试。 | [原票](https://github.com/impharaon/alpha-code/issues/538) · [最后裁决](https://github.com/impharaon/alpha-code/issues/538#issuecomment-5311565911) |
| AC-06 | alpha 会话页崩溃时进入 Alpha Recovery(REQ-090 合同)且不影响其他 surface。**不再要求**上游叶经 `ALPHA_SURFACE_*` env/userData pin 可达（REQ-089 hard-cut 已删除该逃生阀）。证明:surface-boundary 测试。 | [原票](https://github.com/impharaon/alpha-code/issues/538) · [最后裁决](https://github.com/impharaon/alpha-code/issues/538#issuecomment-5311565911) |
| AC-07 | manifest lineage(session/composer/timeline)= alpha 且 PAGE-MAP 同步。证明:manifest 测试。 | [原票](https://github.com/impharaon/alpha-code/issues/538) · [最后裁决](https://github.com/impharaon/alpha-code/issues/538#issuecomment-5311565911) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/538#issuecomment-5311565911)，本次不新增验收结论。 |
