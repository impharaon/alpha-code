---
id: SPEC-puppy-brand-icons
title: 应用和各渠道使用一致的小狗标志
summary: 应用和各渠道使用一致的小狗标志，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-12
owners: [owner]
last_reviewed: 2026-11-12
---

# 应用和各渠道使用一致的小狗标志

应用和各渠道使用一致的小狗标志。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [意图与处置 impharaon/alpha-work:INT-desktop/I-11](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/INT-desktop.md#意图点)。
- 历史身份：[impharaon/alpha-code#1479](https://github.com/impharaon/alpha-code/issues/1479)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/149)。

- [批准/事实依据](https://github.com/impharaon/alpha-code/pull/1480)。
- 交付入口：[alpha-code#1479](https://github.com/impharaon/alpha-code/issues/1479)；实现与验收状态由这些票及其原生子票持有。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：历史票已完成关闭，但尚未取得足以确认每条当前验收范围的最终证据；不把历史关闭状态升级为当前批准。

## 业务规则

- **BR-01** dev / beta / prod 三个渠道的应用图标(icns、ico、Linux PNG、运行时 icon.png / dock.png)由新小狗原图生成,轮廓符合 macOS 图标网格(824/1024 内容框)。
- **BR-02** 应用内的品牌标记(侧栏左上角、启动加载画面)显示新小狗。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | dev / beta / prod 三个渠道的应用图标(icns、ico、Linux PNG、运行时 icon.png / dock.png)由新小狗原图生成,轮廓符合 macOS 图标网格(824/1024 内容框)。 | [原票](https://github.com/impharaon/alpha-code/issues/1479) |
| AC-02 | 应用内的品牌标记(侧栏左上角、启动加载画面)显示新小狗。 | [原票](https://github.com/impharaon/alpha-code/issues/1479) |
| AC-03 | 应用内仍会出现的 opencode 标志(连接失败 / 健康检查加载画面、错误页)显示新小狗;实现不修改上游包的源码。 | [原票](https://github.com/impharaon/alpha-code/issues/1479) |

证据与适用边界：PR #1480 的三渠道生成物、824/1024 网格、应用内 Mark/Splash/Logo 与打包 alias 均有实际证据。当前 logo-codepuppy.test.ts 保留 alias 接线、导出与 PNG 断言。原图 512px、1024 放大导致的大尺寸偏软是原交付限制，未杜撰更高分辨率。

## 待决

无新的需求批准事项；上述历史批准继续有效。规格批准不等于实现、部署或验收完成，尚缺证据与实施工作由来源中的交付入口负责。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 0 | 2026-11-10 | — | 整理历史来源；尚未作为当前批准基线。 |
| 1 | 2026-11-12 | backfill | 按 owner 历史补录授权重建已交付行为；不是新的产品决定。[依据](https://github.com/impharaon/alpha-code/pull/1480)。 |
