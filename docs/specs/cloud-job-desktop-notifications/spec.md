---
id: SPEC-cloud-job-desktop-notifications
title: 云任务完成或失败的桌面通知
summary: 用户能收到任务结果并在桌面设置里关闭通知。
kind: spec
status: approved
version: 1
approved_by: owner（历史批准沿用）
approved_at: 2026-11-12
owners: [owner]
last_reviewed: 2026-11-12
---

# 云任务完成或失败的桌面通知

用户能收到任务结果并在桌面设置里关闭通知。复用桌面已接入的终态来源。完成或失败才触发通知，同一任务同一终态最多提醒一次。

## 来源

- [impharaon/alpha-work:INT-cloud-job-desktop-notifications/I-01](https://github.com/impharaon/alpha-work/blob/de325762131253b18e9b65227e366f60a2f39ebe/docs/intents/INT-cloud-job-desktop-notifications.md#意图点)。
- [Story alpha-work#18](https://github.com/impharaon/alpha-work/issues/18) · [Epic alpha-work#143](https://github.com/impharaon/alpha-work/issues/143)。
- [证据与范围记录](https://github.com/impharaon/alpha-work/issues/18#issuecomment-6731147162)。
- [范围收窄裁决](https://github.com/impharaon/alpha-work/issues/18#issuecomment-5708410867)。

- [批准/事实依据](https://github.com/impharaon/alpha-work/issues/18#issuecomment-5708410867)。
- 交付入口：[alpha-work#18](https://github.com/impharaon/alpha-work/issues/18)；实现与验收状态由这些票及其原生子票持有。

## 用户与范围

- 用户：桌面应用运行期间提交云任务的用户。
- 包括：桌面已运行时的系统通知、重复事件去重、内容最小化和关闭开关。
- 不包括：邮件、服务端推送、桌面关闭期间补发、取消状态通知。

## 业务规则

- **BR-01** 复用桌面已接入的终态来源。完成或失败才触发通知，同一任务同一终态最多提醒一次。

## 验收

| ID | 验收条件（原票文字） | 依据 |
| --- | --- | --- |
| AC-01 | 桌面运行期间,owner 的云任务进入完成或失败终态时,桌面弹出一条系统通知,写明是哪个任务、结果是完成还是失败。 | [原票与逐条证据](https://github.com/impharaon/alpha-work/issues/18#issuecomment-6731147162) |
| AC-03 | 同一任务的同一终态至多弹出一次通知(SSE 重连重放或会话事件流重复帧不产生重复通知)。 | [原票与逐条证据](https://github.com/impharaon/alpha-work/issues/18#issuecomment-6731147162) |
| AC-05 | owner 可在桌面设置里关闭该通知,关闭后不再弹出;通知正文只含任务名称与结果,不含提示词、产物内容或凭据。 | [原票与逐条证据](https://github.com/impharaon/alpha-work/issues/18#issuecomment-6731147162) |

证据与适用边界：沿用 owner「缩」为桌面结果通知。AC-01/03 与 AC-05 脱敏半边由 alpha-code#420 / PR #1349 和具名 cases 支持；开关缺口属于真实开发，由 #1674 承接；不能转成纯验收任务。

## 待决

无新的需求批准事项；上述历史批准继续有效。规格批准不等于实现、部署或验收完成，尚缺证据与实施工作由来源中的交付入口负责。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-12 | owner（历史批准） | 沿用既有批准的范围/裁决，2026-11-12 为规格登记日，不是新的 owner 批准日。[依据](https://github.com/impharaon/alpha-work/issues/18#issuecomment-5708410867)。 |
