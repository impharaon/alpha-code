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
last_reviewed: 2026-11-10
---

# 打开巨大目录不会启动无界扫描

打开巨大目录不会启动无界扫描。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-desktop/N-01](https://github.com/impharaon/alpha-work/blob/27d104dfb0bb8d36f6d050277255861c4927416c/docs/requests/RQ-desktop.md#需求点)。
- 历史身份：[impharaon/alpha-code#174](https://github.com/impharaon/alpha-code/issues/174)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/149)。

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

## 待决

历史票已完成关闭，但尚未取得足以确认每条当前验收范围的最终证据；不把历史关闭状态升级为当前批准。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 0 | 2026-11-10 | — | 整理历史来源；尚未作为当前批准基线。 |
