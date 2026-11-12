---
id: SPEC-office-content-preview
title: Office 文件内容可在应用内安全查看
summary: Office 文件内容可在应用内安全查看，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# Office 文件内容可在应用内安全查看

Office 文件内容可在应用内安全查看。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [意图与处置 impharaon/alpha-work:INT-preview/I-02](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/INT-preview.md#意图点)。
- 历史身份：[impharaon/alpha-code#438](https://github.com/impharaon/alpha-code/issues/438)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/146)。
- [有效范围或验收依据 2026-08-29](https://github.com/impharaon/alpha-code/issues/438#issuecomment-5461302037)。
- [有效范围或验收依据 2026-08-29](https://github.com/impharaon/alpha-code/issues/438#issuecomment-5462283345)。
- [有效范围或验收依据 2026-08-29](https://github.com/impharaon/alpha-code/issues/438#issuecomment-5462590967)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。

## 业务规则

- **BR-01** 结构验证通过的 docx 在应用内可读：正文、标题层级、列表与表格内容完整呈现，顺序与源文档一致。
- **BR-02** 结构验证通过的 xlsx 可按工作表浏览单元格数据；公式不被求值，且其呈现方式（公式文本或快照值）对用户明确。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 结构验证通过的 docx 在应用内可读：正文、标题层级、列表与表格内容完整呈现，顺序与源文档一致。 | [原票](https://github.com/impharaon/alpha-code/issues/438) · [最后裁决](https://github.com/impharaon/alpha-code/issues/438#issuecomment-5462590967) |
| AC-02 | 结构验证通过的 xlsx 可按工作表浏览单元格数据；公式不被求值，且其呈现方式（公式文本或快照值）对用户明确。 | [原票](https://github.com/impharaon/alpha-code/issues/438) · [最后裁决](https://github.com/impharaon/alpha-code/issues/438#issuecomment-5462590967) |
| AC-03 | 结构验证通过的 pptx 可按页浏览大纲、文本内容与讲者备注。 | [原票](https://github.com/impharaon/alpha-code/issues/438) · [最后裁决](https://github.com/impharaon/alpha-code/issues/438#issuecomment-5462590967) |
| AC-04 | 提取过程不执行宏、不发起任何网络请求、不加载远程资源；越界尝试被阻断且可观察。 | [原票](https://github.com/impharaon/alpha-code/issues/438) · [最后裁决](https://github.com/impharaon/alpha-code/issues/438#issuecomment-5462590967) |
| AC-05 | 大文件、深嵌套、畸形部件与超限容器给出明确降级状态，不空白、不伪造内容、不冻结界面。 | [原票](https://github.com/impharaon/alpha-code/issues/438) · [最后裁决](https://github.com/impharaon/alpha-code/issues/438#issuecomment-5462590967) |
| AC-06 | 保真度限制对用户如实声明（不呈现为所见即所得）。 | [原票](https://github.com/impharaon/alpha-code/issues/438) · [最后裁决](https://github.com/impharaon/alpha-code/issues/438#issuecomment-5462590967) |
| AC-07 | 未通过结构验证的容器不进入提取路径。 | [原票](https://github.com/impharaon/alpha-code/issues/438) · [最后裁决](https://github.com/impharaon/alpha-code/issues/438#issuecomment-5462590967) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/438#issuecomment-5462590967)，本次不新增验收结论。 |
