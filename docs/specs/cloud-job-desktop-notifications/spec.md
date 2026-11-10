---
id: SPEC-cloud-job-desktop-notifications
title: 云任务完成或失败的桌面通知
summary: 用户能收到任务结果并在桌面设置里关闭通知。
kind: spec
status: draft
version: 0
approved_by: ""
approved_at: ""
owners: [owner]
last_reviewed: 2026-11-10
---

# 云任务完成或失败的桌面通知

用户能收到任务结果并在桌面设置里关闭通知。复用桌面已接入的终态来源。完成或失败才触发通知，同一任务同一终态最多提醒一次。

## 来源

- [Story alpha-work#18](https://github.com/impharaon/alpha-work/issues/18) · [Epic alpha-work#143](https://github.com/impharaon/alpha-work/issues/143)。
- [证据与范围记录](https://github.com/impharaon/alpha-work/issues/18#issuecomment-6731147162)。
- [范围收窄裁决](https://github.com/impharaon/alpha-work/issues/18#issuecomment-5708410867)。

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

## 待决

AC-05 的设置开关尚未实现。AC-02、AC-04、AC-06、AC-07 已按 2026-09-17 裁决移除，编号保留。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
