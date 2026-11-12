---
id: SPEC-large-project-directories
title: 打开巨大目录不会启动无界扫描
summary: 打开巨大目录不会启动无界扫描，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: draft
version: 0
approved_by: ""
approved_at: ""
owners: [owner]
last_reviewed: 2026-11-12
---

# 打开巨大目录不会启动无界扫描

打开巨大目录不会启动无界扫描。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [意图与处置 impharaon/alpha-work:INT-desktop/I-01](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/INT-desktop.md#意图点)。
- 历史身份：[impharaon/alpha-code#174](https://github.com/impharaon/alpha-code/issues/174)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/149)。

- [批准/事实依据](https://github.com/impharaon/alpha-code/pull/92)。
- 交付入口：[alpha-code#174](https://github.com/impharaon/alpha-code/issues/174)；实现与验收状态由这些票及其原生子票持有。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：历史票已完成关闭，但尚未取得足以确认每条当前验收范围的最终证据；不把历史关闭状态升级为当前批准。

## 业务规则

- **BR-01** 隐藏/归档项目零请求(session.list 等不再发起)。
- **BR-02** 垃圾项目(根/家目录级)有引导移除 UX 或默认不纳入。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 隐藏/归档项目零请求(session.list 等不再发起); | [原票](https://github.com/impharaon/alpha-code/issues/174) |
| AC-02 | 垃圾项目(根/家目录级)有引导移除 UX 或默认不纳入; | [原票](https://github.com/impharaon/alpha-code/issues/174) |
| AC-03 | 冷启动 bootstrap 日志无 `/`、`~` 级 Instance; | [原票](https://github.com/impharaon/alpha-code/issues/174) |
| AC-04 | 与 B12 联动观测:常驻 watcher 数下降。 | [原票](https://github.com/impharaon/alpha-code/issues/174) |

证据与适用边界：AC-01/02 由 PR #92 与 worktree-filter.test.ts 支持；7 月 8 日审计仍记录 15 次 home Instance，不能声称当时 AC-03 全过。后续 #219 / PR #472 已修 scratch cwd，当前 server.ts 消费 ensureEngineScratchCwd；AC-04 的 watcher 观察有 FSEvents 不计 fd 的限制。

## 待决

取得含 PR #472 的发布件冷启动日志，补 AC-03 无根/home Instance；保留已有数据层和 watcher 证据，不重做功能。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 0 | 2026-11-10 | — | 整理历史来源；尚未作为当前批准基线。 |
| 0 | 2026-11-12 | — | 已核对历史范围与实际证据；具体缺口见待决，由来源中的交付入口承接。 |
