---
id: SPEC-account-balance-presentation
title: 账户面板按订阅与余额显示真实状态
summary: 账户面板按订阅与余额显示真实状态，按历史条文与实际证明登记范围。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 账户面板按订阅与余额显示真实状态

账户面板按订阅与余额显示真实状态。已有能力及其剩余证据义务分别记录，历史关闭日期不改写为本次完成。

## 来源

- [impharaon/alpha-work:INT-billing](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/INT-billing.md#意图点)。
- [历史需求 alpha-code#1194](https://github.com/impharaon/alpha-code/issues/1194) · [Epic alpha-work#136](https://github.com/impharaon/alpha-work/issues/136)。
- [范围与交付证据](https://github.com/impharaon/alpha-code/issues/1194#issuecomment-5474188488)。

## 用户与范围

- 用户：使用相关桌面、官网或云工具入口的 Code Puppy 用户。
- 包括：下列历史条款中的用户结果，保留原编号和后续有效裁决。
- 不包括：原票未批准的新产品能力或未授权的真实生产验证。
- 假设与依赖：采用 2026-08-31 评论里的三条裁决与 AC，不复制原诊断中的 owner 账户金额。取数时机与后端额度策略不在此范围。

- 当前基线实现/测试仍存在；只核实文件和已有证明，本次不重跑产品测试：
  - [alpha-code:packages/ui-mac/src/renderer/sidebar/account-quadrant.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/sidebar/account-quadrant.test.ts)

## 业务规则

- **BR-01** chip 按上表三态显示;未订阅且有余额时显示「按量付费」。
- **BR-02** 未订阅时,原「5 小时额度 / 7 日额度」两行显示 `summary.usage` 的真实用量;已订阅时仍显示 `plan.window5h/window7d`。

规则依据原条款；后续范围修订以上文和来源为准。

## 验收

原编号按 AC-01 形式登记；未改变条文义务。

| ID | 原条文 | 依据 |
| --- | --- | --- |
| AC-01 | chip 按上表三态显示;未订阅且有余额时显示「按量付费」。<br>  *判据自检*:①路径——判定点是 `acctIsPro` 一处,`balanceFen` 已在 summary 里;②证据——四象限组件测试各断言 chip 文案(勘破的探针夹具可直接复用);③错误实现(仍只看订阅)在「未订阅+有余额」那格当场红。 | [原条文](https://github.com/impharaon/alpha-code/issues/1194#issuecomment-5474000955) |
| AC-02 | 未订阅时,原「5 小时额度 / 7 日额度」两行显示 `summary.usage` 的真实用量;已订阅时仍显示 `plan.window5h/window7d`。<br>  *判据自检*:①路径——字段已在 summary 里、今天零消费;②证据——两态各一条断言,喂不同 `plan.status` 的夹具;③错误实现(两态都读 plan 窗口)在未订阅那格红,因为该字段结构上不存在。 | [原条文](https://github.com/impharaon/alpha-code/issues/1194#issuecomment-5474000955) |
| AC-03 | 未订阅且无余额时,账户面板**不新增**提示行(维持现状),且 picker/发送链的既有反馈**不被削弱**。<br>  *判据自检*:①这是「不做什么」+ 防回归;②证据——该格的面板断言维持无提示 + 既有 picker/发送链测试保持绿;③错误实现(顺手加提示、或改动时碰坏了 picker 的置灰逻辑)分别在两侧红。 | [原条文](https://github.com/impharaon/alpha-code/issues/1194#issuecomment-5474000955) |

## 待决

没有本次新增的产品裁决；上列历史限制及已登记的独立验收仍有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | owner 授权完整补录已完成能力；[已有交付依据](https://github.com/impharaon/alpha-code/issues/1194#issuecomment-5474188488)，非本次重新实测。 |
