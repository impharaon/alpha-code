---
id: SPEC-build-identity
title: 报问题时能复制准确的构建身份
summary: 报问题时能复制准确的构建身份，验收边界来自原始需求。
kind: spec
status: draft
version: 0
approved_by: ""
approved_at: ""
owners: [owner]
last_reviewed: 2026-11-10
---

# 报问题时能复制准确的构建身份

<!-- owner-opening -->
**谁会遇到**:owner 用桌面端发现问题、要告诉 agent「哪里不对」的时候。**遇到什么**:「还没发布的修复」「测试现场留下的状态」「真的回归了」三种情况看起来一模一样,处理方法却完全不同;现在没有简单办法说清「我看到问题时用的是哪个版本、哪个渠道、是不是开发版」。**为什么是问题**:过去已多次因此误判,去查代码,结果只是手上的包比修复旧。**不做会怎样**:不影响正常使用,只是每次报问题都要先花一轮来回确认版本。

## 来源

- [impharaon/alpha-work:RQ-desktop/N-12](https://github.com/impharaon/alpha-work/blob/27d104dfb0bb8d36f6d050277255861c4927416c/docs/requests/RQ-desktop.md#需求点)。
- [原票](https://github.com/impharaon/alpha-code/issues/237)；原 AC 编号不变。

## 用户与范围

- 用户：Code Puppy 桌面使用者。
- 包括：原票明确列出的用户结果。
- 不包括：自动上传诊断数据或未批准的信息采集。

## 业务规则

原票只有结果方向，尚无可确认的业务规则。

## 验收

| ID | Given / When / Then（原票条文） | 依据 |
| --- | --- | --- |

原票未定义 AC；待 owner 确定构建信息范围后形成基线，不用标题编造条款。

## 待决

需确定复制内容、构建来源与开发/正式包识别的可观察判据。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 0 | 2026-11-10 | — | 根据原票登记；治理授权不代替产品基线批准。 |
