---
id: SPEC-permission-risk-classification
title: 高风险动作在执行前先完成分类
summary: 高风险动作在执行前先完成分类，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 高风险动作在执行前先完成分类

高风险动作在执行前先完成分类。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [意图与处置 impharaon/alpha-work:INT-safety/I-05](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/INT-safety.md#意图点)。
- 历史身份：[impharaon/alpha-code#1285](https://github.com/impharaon/alpha-code/issues/1285)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/142)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:github/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/github/index.ts)
  - [alpha-code:github/package.json](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/github/package.json)
  - [alpha-code:package.json](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/package.json)
  - [alpha-code:packages/app/e2e/utils/visual-stability/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/e2e/utils/visual-stability/index.ts)
  - [alpha-code:packages/app/package.json](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/package.json)
  - [alpha-code:packages/app/src/components/session/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/components/session/index.ts)
  - [alpha-code:packages/app/src/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/index.ts)
  - [alpha-code:packages/app/src/pages/session/composer/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/pages/session/composer/index.ts)

## 业务规则

- **BR-01** 到达授权提示的每个动作都携带一个分类结论,且该分类在**动作被允许执行之前**产生。
- **BR-02** 未被任何规则覆盖的动作落在最保守的一档,不是静默放行。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 到达授权提示的每个动作都携带一个分类结论,且该分类在**动作被允许执行之前**产生。<br>(原文写「在 `permission.ask` 返回之前」,该钩子经实测永不触发 —— 见上方订正框;AC 改为不指定具体接缝,接缝由实现前的勘破选定并**证明其会被触发**。)<br>*将来拿什么证明*:分类函数的单元测试 + 一条从 hook 入口断言分类已附着的测试。 | [原票](https://github.com/impharaon/alpha-code/issues/1285) |
| AC-02 | 未被任何规则覆盖的动作落在最保守的一档,不是静默放行。<br>*将来拿什么证明*:一条「未知动作」用例,断言其档位为最保守值。 | [原票](https://github.com/impharaon/alpha-code/issues/1285) |
| AC-03 | 分类只用规则,不新增任何模型调用。<br>*将来拿什么证明*:该模块的源码级判据(禁止 import 任何 provider/LLM 客户端),并配一条反向用例。 | [原票](https://github.com/impharaon/alpha-code/issues/1285) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/1285)，本次不新增验收结论。 |
