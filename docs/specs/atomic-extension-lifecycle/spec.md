---
id: SPEC-atomic-extension-lifecycle
title: 扩展安装失败可恢复且不会留下半装状态
summary: 扩展安装失败可恢复且不会留下半装状态，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 扩展安装失败可恢复且不会留下半装状态

扩展安装失败可恢复且不会留下半装状态。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [意图与处置 impharaon/alpha-work:INT-extensions/I-07](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/INT-extensions.md#意图点)。
- 历史身份：[impharaon/alpha-code#211](https://github.com/impharaon/alpha-code/issues/211)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/138)。
- [有效范围或验收依据 2026-07-17](https://github.com/impharaon/alpha-code/issues/211#issuecomment-4997756730)。
- [有效范围或验收依据 2026-07-17](https://github.com/impharaon/alpha-code/issues/211#issuecomment-4998242519)。
- [有效范围或验收依据 2026-07-17](https://github.com/impharaon/alpha-code/issues/211#issuecomment-4998246620)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。

## 业务规则

- **BR-01** 在下载、解包、写文件、配置生成、dispose、health、receipt commit 各阶段注入故障，均不存在半装态；重启后自动恢复或清晰提示可重试事务。
- **BR-02** Bundle 任一 required child 失败时 current generation 完全不变；optional child 的跳过在授权与 receipt 中可见。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 在下载、解包、写文件、配置生成、dispose、health、receipt commit 各阶段注入故障，均不存在半装态；重启后自动恢复或清晰提示可重试事务。 | [原票](https://github.com/impharaon/alpha-code/issues/211) · [最后裁决](https://github.com/impharaon/alpha-code/issues/211#issuecomment-4998246620) |
| AC-02 | Bundle 任一 required child 失败时 current generation 完全不变；optional child 的跳过在授权与 receipt 中可见。 | [原票](https://github.com/impharaon/alpha-code/issues/211) · [最后裁决](https://github.com/impharaon/alpha-code/issues/211#issuecomment-4998246620) |
| AC-03 | 更新删除旧文件后无残留；更新新增 capability 时必须重新确认，拒绝后旧版继续健康运行。 | [原票](https://github.com/impharaon/alpha-code/issues/211) · [最后裁决](https://github.com/impharaon/alpha-code/issues/211#issuecomment-4998246620) |
| AC-04 | MCP/plugin health 失败自动回旧 generation；用户可离线回滚至少前两个健康版本。 | [原票](https://github.com/impharaon/alpha-code/issues/211) · [最后裁决](https://github.com/impharaon/alpha-code/issues/211#issuecomment-4998246620) |
| AC-05 | 并发安装/卸载同一扩展由跨进程锁串行化，不损坏 receipt 或配置。 | [原票](https://github.com/impharaon/alpha-code/issues/211) · [最后裁决](https://github.com/impharaon/alpha-code/issues/211#issuecomment-4998246620) |
| AC-06 | 卸载只删除 transaction/generation 拥有的路径，不删除用户手写文件和原始导入源。 | [原票](https://github.com/impharaon/alpha-code/issues/211) · [最后裁决](https://github.com/impharaon/alpha-code/issues/211#issuecomment-4998246620) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/211#issuecomment-4998246620)，本次不新增验收结论。 |
