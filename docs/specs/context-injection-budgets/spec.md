---
id: SPEC-context-injection-budgets
title: 应用注入的对话内容有明确大小上限
summary: 应用注入的对话内容有明确大小上限，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 应用注入的对话内容有明确大小上限

应用注入的对话内容有明确大小上限。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-safety/N-04](https://github.com/impharaon/alpha-work/blob/27d104dfb0bb8d36f6d050277255861c4927416c/docs/requests/RQ-safety.md#需求点)。
- 历史身份：[impharaon/alpha-code#1284](https://github.com/impharaon/alpha-code/issues/1284)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/142)。
- [有效范围或验收依据 2026-09-08](https://github.com/impharaon/alpha-code/issues/1284#issuecomment-5582088356)。
- [有效范围或验收依据 2026-09-08](https://github.com/impharaon/alpha-code/issues/1284#issuecomment-5583315036)。
- [有效范围或验收依据 2026-09-08](https://github.com/impharaon/alpha-code/issues/1284#issuecomment-5584029642)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:.opencode/opencode.jsonc](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/.opencode/opencode.jsonc)
  - [alpha-code:packages/core/src/config/plugin.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/core/src/config/plugin.ts)
  - [alpha-code:packages/core/src/plugin.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/core/src/plugin.ts)
  - [alpha-code:packages/core/src/v1/config/plugin.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/core/src/v1/config/plugin.ts)
  - [alpha-code:packages/ext/src/plugin.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ext/src/plugin.ts)
  - [alpha-code:packages/opencode/src/config/plugin.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/opencode/src/config/plugin.ts)
  - [alpha-code:packages/opencode/test/fixture/plugin.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/opencode/test/fixture/plugin.ts)
  - [alpha-code:packages/plugin/src/v2/effect/plugin.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/plugin/src/v2/effect/plugin.ts)

## 业务规则

- **BR-01** 到达模型上下文的 Alpha 注入,唯一通路是一个注册表;每个片段在注册时声明自己的上限。不经该注册表的注入在闸上响亮失败。
- **BR-02** 任一片段超过自己声明的上限时是**响亮失败**,不是静默截断。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 到达模型上下文的 Alpha 注入,唯一通路是一个注册表;每个片段在注册时声明自己的上限。不经该注册表的注入在闸上响亮失败。<br>*将来拿什么证明*:一条反向用例 —— 新增一个绕过注册表的注入,闸必须当场红。 | [原票](https://github.com/impharaon/alpha-code/issues/1284) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1284#issuecomment-5584029642) |
| AC-02 | 任一片段超过自己声明的上限时是**响亮失败**,不是静默截断。<br>*将来拿什么证明*:构造超限片段的单元测试,断言抛出而非裁剪。 | [原票](https://github.com/impharaon/alpha-code/issues/1284) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1284#issuecomment-5584029642) |
| AC-03 | 有一处能一次列全「Alpha 当前放了哪些片段、各自实测多大、上限多少」,并随本地闸打印。<br>*将来拿什么证明*:`alpha-check` 该步的输出快照测试。 | [原票](https://github.com/impharaon/alpha-code/issues/1284) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1284#issuecomment-5584029642) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/1284#issuecomment-5584029642)，本次不新增验收结论。 |
