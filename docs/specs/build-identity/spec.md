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
last_reviewed: 2026-11-12
---

# 报问题时能复制准确的构建身份

<!-- owner-opening -->
**谁会遇到**:owner 用桌面端发现问题、要告诉 agent「哪里不对」的时候。**遇到什么**:「还没发布的修复」「测试现场留下的状态」「真的回归了」三种情况看起来一模一样,处理方法却完全不同;现在没有简单办法说清「我看到问题时用的是哪个版本、哪个渠道、是不是开发版」。**为什么是问题**:过去已多次因此误判,去查代码,结果只是手上的包比修复旧。**不做会怎样**:不影响正常使用,只是每次报问题都要先花一轮来回确认版本。

## 来源

- [impharaon/alpha-work:INT-desktop/I-12](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/INT-desktop.md#意图点)。
- [原票](https://github.com/impharaon/alpha-code/issues/237)；原 AC 编号不变。

- [批准/事实依据](https://github.com/impharaon/alpha-code/issues/237)。
- 交付入口：[alpha-code#237](https://github.com/impharaon/alpha-code/issues/237)；实现与验收状态由这些票及其原生子票持有。

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

证据与适用边界：原票有明确问题方向，但没有已批准 AC；现存版本、渠道和构建信息实现应作为下一步材料，不能虚构产品已经确定的复制字段。

## 待决

alpha-code#237 先把复制内容（版本/渠道/构建来源）及 dev/prod 区分形成可观察 AC；一次确认该小范围后直接实现，不额外建步骤票。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 0 | 2026-11-10 | — | 根据原票登记；治理授权不代替产品基线批准。 |
| 0 | 2026-11-12 | — | 已核对历史范围与实际证据；具体缺口见待决，由来源中的交付入口承接。 |
