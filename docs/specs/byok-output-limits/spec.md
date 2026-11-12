---
id: SPEC-byok-output-limits
title: 自带密钥的模型按自己的实测上限输出
summary: 自带密钥的模型按自己的实测上限输出，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 自带密钥的模型按自己的实测上限输出

自带密钥的模型按自己的实测上限输出。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [意图与处置 impharaon/alpha-work:INT-models/I-05](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/INT-models.md#意图点)。
- 历史身份：[impharaon/alpha-code#1278](https://github.com/impharaon/alpha-code/issues/1278)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/152)。
- [有效范围或验收依据 2026-09-07](https://github.com/impharaon/alpha-code/issues/1278#issuecomment-5569948270)。
- [有效范围或验收依据 2026-09-08](https://github.com/impharaon/alpha-code/issues/1278#issuecomment-5577913118)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：无凭据模型和自定义节点保持原上限；不承诺实际生成字数变长。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/ext/src/byok-output-cap.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ext/src/byok-output-cap.test.ts)
  - [alpha-code:packages/ext/src/platform-output-cap.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ext/src/platform-output-cap.test.ts)
  - [alpha-code:packages/opencode/src/provider/transform.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/opencode/src/provider/transform.ts)
  - [alpha-code:packages/opencode/src/session/overflow.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/opencode/src/session/overflow.ts)

## 业务规则

- **BR-01** 有实读上限的直连 BYOK 模型,harness 发往上游的 `max_tokens` 等于该模型**实测受理**的最大值,不再是固定 32000;且每个模型拿的是**自己**那个数。
- **BR-02** 没有实读上限的直连 BYOK 模型、以及用户自定义节点,`max_tokens` 保持原状;该状态有断言钉住。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 有实读上限的直连 BYOK 模型,harness 发往上游的 `max_tokens` 等于该模型**实测受理**的最大值,不再是固定 32000;且每个模型拿的是**自己**那个数。 | [原票](https://github.com/impharaon/alpha-code/issues/1278) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1278#issuecomment-5577913118) |
| AC-02 | 没有实读上限的直连 BYOK 模型、以及用户自定义节点,`max_tokens` 保持原状;该状态有断言钉住。 | [原票](https://github.com/impharaon/alpha-code/issues/1278) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1278#issuecomment-5577913118) |
| AC-03 | 出货目录新增一个 BYOK 模型而无人量它、或实读表留下目录里已不存在的条目,本机闸门当场变红(两个方向)。 | [原票](https://github.com/impharaon/alpha-code/issues/1278) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1278#issuecomment-5577913118) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/1278#issuecomment-5577913118)，本次不新增验收结论。 |
