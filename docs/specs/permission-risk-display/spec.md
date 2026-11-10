---
id: SPEC-permission-risk-display
title: 用户在授权时能看出动作的风险档位
summary: 用户在授权时能看出动作的风险档位，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: draft
version: 0
approved_by: ""
approved_at: ""
owners: [owner]
last_reviewed: 2026-11-10
---

# 用户在授权时能看出动作的风险档位

用户在授权时能看出动作的风险档位。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-safety/N-07](https://github.com/impharaon/alpha-work/blob/27d104dfb0bb8d36f6d050277255861c4927416c/docs/requests/RQ-safety.md#需求点)。
- 历史身份：[impharaon/alpha-code#1314](https://github.com/impharaon/alpha-code/issues/1314)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/142)。
- [有效范围或验收依据 2026-09-17](https://github.com/impharaon/alpha-code/issues/1314#issuecomment-5707980476)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。

## 业务规则

- **BR-01** 授权框呈现分类结果,且**不同档位在视觉上可区分**;用户不必读工程术语就能看出「这次比平常危险」。
- **BR-02** 分类**缺失时**的呈现是明确的(不是假装安全,也不是吓人):`#1313` 的兜底是未命中任何规则 ⇒ `critical/unknown`,呈现要与之一致。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 授权框呈现分类结果,且**不同档位在视觉上可区分**;用户不必读工程术语就能看出「这次比平常危险」。<br>*将来拿什么证明*:UI 类 AC ⇒ 与已批设计稿对比(按 `design-loop`,先出增量帧再实现)。 | [原票](https://github.com/impharaon/alpha-code/issues/1314) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1314#issuecomment-5707980476) |
| AC-02 | 分类**缺失时**的呈现是明确的(不是假装安全,也不是吓人):`#1313` 的兜底是未命中任何规则 ⇒ `critical/unknown`,呈现要与之一致。<br>*将来拿什么证明*:一条呈现层判据,断言 `unknown` 档不被渲染成低危。 | [原票](https://github.com/impharaon/alpha-code/issues/1314) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1314#issuecomment-5707980476) |

## 待决

原条款已登记；仍需按当前范围形成已批规格与设计，不能仅凭本次治理标记 Ready。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 0 | 2026-11-10 | — | 整理历史来源；尚未作为当前批准基线。 |
