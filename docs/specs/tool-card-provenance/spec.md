---
id: SPEC-tool-card-provenance
title: 工具卡按真实来源展示调用并保护敏感字段
summary: 工具卡按真实来源展示调用并保护敏感字段，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 工具卡按真实来源展示调用并保护敏感字段

工具卡按真实来源展示调用并保护敏感字段。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

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

- **BR-01** 时间线覆盖本地内置、Alpha Cloud MCP、第三方 MCP、插件动态工具，各有专用卡、。
- **BR-02** 每次调用持久化不可变的 source / server / remote-tool / technical-id 快照。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-08 | 时间线覆盖本地内置、Alpha Cloud MCP、第三方 MCP、插件动态工具，各有专用卡、<br>      明确的隐藏理由，或安全的通用降级卡；未知工具默认只显示可信来源、名称与状态，<br>      不直接渲染任意参数与输出。证明：来源矩阵测试 + V1 视觉。 | [原票](https://github.com/impharaon/alpha-code/issues/538) · [最后裁决](https://github.com/impharaon/alpha-code/issues/538#issuecomment-5311565911) |
| AC-09 | 每次调用持久化不可变的 source / server / remote-tool / technical-id 快照；<br>      历史回放不因 server 删除、改名或 rebind 改写来源、云端或计费徽标。证明：回放测试。 | [原票](https://github.com/impharaon/alpha-code/issues/538) · [最后裁决](https://github.com/impharaon/alpha-code/issues/538#issuecomment-5311565911) |
| AC-10 | 展示字段按工具类别走 allowlist / redactor；token、URL userinfo/query<br>      credential、header、路径中的 secret sentinel 与未经筛选的错误/输出必须脱敏。<br>      证明：脱敏用例集。 | [原票](https://github.com/impharaon/alpha-code/issues/538) · [最后裁决](https://github.com/impharaon/alpha-code/issues/538#issuecomment-5311565911) |
| AC-11 | UI title / icon / translation / annotation 不参与授权、用户工具策略或计费<br>      判决；第三方 annotations 只能提高警戒。证明：负例测试。<br><br>具体方案由 [#722](https://github.com/jinjunnn/alpha-code/issues/722) 固化，其 identity<br>地基来自 [#731](https://github.com/jinjunnn/alpha-code/issues/731)（展示与策略共用，<br>只定一次）。**本增补不扩大到 REQ-131 的 Settings 与执行策略。**<br><br>**已从范围中剔除**：provider-hosted / provider-executed 工具——alpha 侧没有任何地方启用<br>它们，当前无可达状态（见 #731）。 | [原票](https://github.com/impharaon/alpha-code/issues/538) · [最后裁决](https://github.com/impharaon/alpha-code/issues/538#issuecomment-5311565911) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/538#issuecomment-5311565911)，本次不新增验收结论。 |
