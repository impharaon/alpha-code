---
id: SPEC-document-authoring-guidance
title: 文档任务使用完整的产出质量指导
summary: 文档任务使用完整的产出质量指导，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 文档任务使用完整的产出质量指导

文档任务使用完整的产出质量指导。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-office](https://github.com/impharaon/alpha-work/blob/d4a80d9c2ef0df32c58173310d9e368fa7bc9069/docs/requests/RQ-office.md)。
- 历史身份：[impharaon/alpha-code#1234](https://github.com/impharaon/alpha-code/issues/1234)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/150)。
- [有效范围或验收依据 2026-09-06](https://github.com/impharaon/alpha-code/issues/1234#issuecomment-5558515966)。
- [有效范围或验收依据 2026-09-07](https://github.com/impharaon/alpha-code/issues/1234#issuecomment-5564036165)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：只证明提示词结构与技能完整，不承诺模型输出质量或长度提升。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/httpapi-codegen/test/generated/system.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/httpapi-codegen/test/generated/system.ts)
  - [alpha-code:packages/opencode/src/session/llm/request.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/opencode/src/session/llm/request.ts)
  - [alpha-code:packages/opencode/src/session/system.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/opencode/src/session/system.ts)
  - [alpha-code:packages/tui/src/util/system.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/tui/src/util/system.ts)

## 业务规则

- **BR-01** 文档类任务使用的系统提示词不包含无豁免的输出长度压制指令(即不再走 `default.txt` 基座)。
- **BR-02** 存在一份与模型 id 无关、对所有在册模型生效的产出物质量基线(含结构与中文排版要求)。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 文档类任务使用的系统提示词不包含无豁免的输出长度压制指令(即不再走 `default.txt` 基座)。 | [原票](https://github.com/impharaon/alpha-code/issues/1234) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1234#issuecomment-5564036165) |
| AC-02 | 存在一份与模型 id 无关、对所有在册模型生效的产出物质量基线(含结构与中文排版要求)。 | [原票](https://github.com/impharaon/alpha-code/issues/1234) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1234#issuecomment-5564036165) |
| AC-03 | 出厂 `office-docs` 技能包含产出物质量要求,而不只是调用机械。 | [原票](https://github.com/impharaon/alpha-code/issues/1234) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1234#issuecomment-5564036165) |
| AC-04 | 技能清单中不存在"有 frontmatter 但正文为占位符"的条目。 | [原票](https://github.com/impharaon/alpha-code/issues/1234) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1234#issuecomment-5564036165) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/1234#issuecomment-5564036165)，本次不新增验收结论。 |
