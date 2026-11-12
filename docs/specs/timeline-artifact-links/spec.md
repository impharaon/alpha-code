---
id: SPEC-timeline-artifact-links
title: 对话中的本地产物可以直接打开右栏预览
summary: 对话中的本地产物可以直接打开右栏预览，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 对话中的本地产物可以直接打开右栏预览

对话中的本地产物可以直接打开右栏预览。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [意图与处置 impharaon/alpha-work:INT-artifacts/I-07](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/INT-artifacts.md#意图点)。
- 历史身份：[impharaon/alpha-code#449](https://github.com/impharaon/alpha-code/issues/449)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/148)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/app/src/components/settings-v2/index.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/components/settings-v2/index.tsx)
  - [alpha-code:packages/console/app/src/routes/bench/index.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/src/routes/bench/index.tsx)
  - [alpha-code:packages/console/app/src/routes/black/index.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/src/routes/black/index.tsx)
  - [alpha-code:packages/console/app/src/routes/brand/index.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/src/routes/brand/index.tsx)
  - [alpha-code:packages/console/app/src/routes/changelog/index.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/src/routes/changelog/index.tsx)
  - [alpha-code:packages/console/app/src/routes/download/index.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/src/routes/download/index.tsx)
  - [alpha-code:packages/console/app/src/routes/enterprise/index.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/src/routes/enterprise/index.tsx)
  - [alpha-code:packages/console/app/src/routes/go/index.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/src/routes/go/index.tsx)

## 业务规则

- **BR-01** 会话中产生的本地产物在其回合处以「文档名 + 链接标记」行呈现,无大卡片/缩略图。
- **BR-02** 点击链接行,右栏预览面打开并聚焦该产物;图片/HTML/Markdown/PDF 呈现内容(现役 renderer)。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 会话中产生的本地产物在其回合处以「文档名 + 链接标记」行呈现,无大卡片/缩略图。 | [原票](https://github.com/impharaon/alpha-code/issues/449) |
| AC-02 | 点击链接行,右栏预览面打开并聚焦该产物;图片/HTML/Markdown/PDF 呈现内容(现役 renderer)。 | [原票](https://github.com/impharaon/alpha-code/issues/449) |
| AC-03 | 白名单外类型点击后右栏呈现元数据与有界源文,不标注为「预览」。 | [原票](https://github.com/impharaon/alpha-code/issues/449) |
| AC-04 | 产物内容仅经现役受控通道进入预览面,不新增任何旁路(REQ-092 契约延续)。 | [原票](https://github.com/impharaon/alpha-code/issues/449) |
| AC-05 | 链接行与右栏联动的视觉与已批设计稿一致(双主题),UI 无开发术语。 | [原票](https://github.com/impharaon/alpha-code/issues/449) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/449)，本次不新增验收结论。 |
