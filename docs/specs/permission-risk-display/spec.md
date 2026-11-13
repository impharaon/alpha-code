---
id: SPEC-permission-risk-display
title: 用户在授权时能看出动作的风险档位
summary: 用户在授权时能看出动作的风险档位，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: owner
approved_at: 2026-11-13
owners: [owner]
last_reviewed: 2026-11-13
---

# 用户在授权时能看出动作的风险档位

用户在授权时能看出动作的风险档位。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [意图与处置 impharaon/alpha-work:INT-safety/I-07](https://github.com/impharaon/alpha-work/blob/de325762131253b18e9b65227e366f60a2f39ebe/docs/intents/INT-safety.md#意图点)。
- 历史身份：[impharaon/alpha-code#1314](https://github.com/impharaon/alpha-code/issues/1314)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/142)。
- [有效范围或验收依据 2026-09-17](https://github.com/impharaon/alpha-code/issues/1314#issuecomment-5707980476)。

- [批准/事实依据](https://github.com/impharaon/alpha-code/issues/1314#issuecomment-6731085209)。
- 交付入口：[alpha-code#1314](https://github.com/impharaon/alpha-code/issues/1314)；实现与验收状态由这些票及其原生子票持有。

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

证据与适用边界：风险分类已存在；用户可见呈现与 unknown 状态是本票结果。现字段为 metadata.codepuppyRisk；不存在本次治理批准的新视觉方向。

## 待决

alpha-code#1314 在原有授权框范围内形成风险档位/unknown 的增量界面基线，与既有 AC 一次审定后直接实施；不重开分类引擎设计。

## 体验约定
- 用户路径:工具请求授权时,批准面板标题后出现一个风险标签;定制中心的能力授权框里,高风险的能力行在技术名之后出现同一个标签。
- 交互与状态:标签是一个胶囊加文字,没有图标,只有一种尺寸,不能点、不能聚焦;所在行变淡时跟着变淡。五档:低风险(绿)、中风险(灰)、高风险(琥珀)、极高风险(红)、风险未知(只描边、不填色,不渲染成低危)。批准面板五档都会出现并保留「极高风险」那句说明;能力授权框只用「高风险」一档,新增行与已授权行都标,将收回的不标。第三方远程工具常显示「高风险」是分类规则的现状,本规格不改分类。
- 文案:只有档位名五个词;不解释原因。
- 设计稿:alpha-code `a559317fc6`(分支 `design/1314-permission-risk-display`)——现行稿 `docs/design/current/conversation-timeline/design.html#permission-risk`、`docs/design/current/capability-authorize/design.html`;组件稿 `docs/design/2026-11-13-1314-risk-tag/frame.html`(含改前改后:浅色主题下「低风险」「高风险」文字加深到对比度 6.2;能力授权框的「高风险」「新增」「将收回」同样加深)。「风险标签」是组件库新增组件(已登记待定),批准面板与能力授权框共用。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 0 | 2026-11-10 | — | 整理历史来源；尚未作为当前批准基线。 |
| 0 | 2026-11-12 | — | 已核对历史范围与实际证据；具体缺口见待决，由来源中的交付入口承接。 |
| 1 | 2026-11-13 | owner | 「设计搞的内容我都通过」;三个选择「都按照你的建议」;组件化后的改前改后与规格批准:「就必要就继续。继续吧。」(alpha-work INT-safety originals U-03、U-07) |
