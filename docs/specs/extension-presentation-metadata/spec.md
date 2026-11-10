---
id: SPEC-extension-presentation-metadata
title: 定制中心条目显示开发者与说明等来源信息
summary: 定制中心条目显示开发者与说明等来源信息，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 定制中心条目显示开发者与说明等来源信息

定制中心条目显示开发者与说明等来源信息。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-extensions](https://github.com/impharaon/alpha-work/blob/d4a80d9c2ef0df32c58173310d9e368fa7bc9069/docs/requests/RQ-extensions.md)。
- 历史身份：[impharaon/alpha-code#1287](https://github.com/impharaon/alpha-code/issues/1287)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/138)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/core/schema.json](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/core/schema.json)
  - [alpha-code:packages/ui-mac/src/shared/host-extension-package-contract/package-envelope-v1.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/shared/host-extension-package-contract/package-envelope-v1.test.ts)

## 业务规则

- **BR-01** 契约新增展示段,字段集以 schema 为**单一权威**(不写散文枚举);Hub 呈现面从该段取值。
- **BR-02** 缺该段的既有条目仍可解码、仍可安装 —— 不破坏任何已发布条目。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 契约新增展示段,字段集以 schema 为**单一权威**(不写散文枚举);Hub 呈现面从该段取值。<br>*将来拿什么证明*:schema 与消费端的字段一致性测试(与既有 `package-envelope-v1.test.ts` 同形态)。 | [原票](https://github.com/impharaon/alpha-code/issues/1287) |
| AC-02 | 缺该段的既有条目仍可解码、仍可安装 —— 不破坏任何已发布条目。<br>*将来拿什么证明*:用现有 `testvectors/` 里的旧信封跑解码,断言不回归。 | [原票](https://github.com/impharaon/alpha-code/issues/1287) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/1287)，本次不新增验收结论。 |
