---
id: SPEC-extension-install-intents
title: 扩展安装由主程序校验并按项目隔离
summary: 扩展安装由主程序校验并按项目隔离，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 扩展安装由主程序校验并按项目隔离

扩展安装由主程序校验并按项目隔离。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-extensions](https://github.com/impharaon/alpha-work/blob/d4a80d9c2ef0df32c58173310d9e368fa7bc9069/docs/requests/RQ-extensions.md)。
- 历史身份：[impharaon/alpha-code#210](https://github.com/impharaon/alpha-code/issues/210)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/138)。
- [有效范围或验收依据 2026-07-17](https://github.com/impharaon/alpha-code/issues/210#issuecomment-4998245623)。
- [有效范围或验收依据 2026-07-17](https://github.com/impharaon/alpha-code/issues/210#issuecomment-5000325276)。
- [有效范围或验收依据 2026-07-17](https://github.com/impharaon/alpha-code/issues/210#issuecomment-5003230536)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：历史 project 行只读+卸载，无启用开关是 ADR-030 接受的范围；后续项目 MCP 安装由 project-mcp-installation 扩展，不能把两期当作同时有效限制。

## 业务规则

- **BR-01** 缺字段、未知顶层键、非法 digest、越权 capability、循环依赖、平台不兼容 manifest 均在写盘前拒绝并给出可定位错误。
- **BR-02** 测试伪造 renderer package/command/config/receipt/绝对路径，main 均忽略伪造事实并按已验 target 重建计划。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 缺字段、未知顶层键、非法 digest、越权 capability、循环依赖、平台不兼容 manifest 均在写盘前拒绝并给出可定位错误。 | [原票](https://github.com/impharaon/alpha-code/issues/210) · [最后裁决](https://github.com/impharaon/alpha-code/issues/210#issuecomment-5003230536) |
| AC-02 | 测试伪造 renderer package/command/config/receipt/绝对路径，main 均忽略伪造事实并按已验 target 重建计划。 | [原票](https://github.com/impharaon/alpha-code/issues/210) · [最后裁决](https://github.com/impharaon/alpha-code/issues/210#issuecomment-5003230536) |
| AC-03 | global 与两个不同项目安装同名扩展，Hub 能分别显示、禁用、卸载；任何一项操作不影响其它 scope。 | [原票](https://github.com/impharaon/alpha-code/issues/210) · [最后裁决](https://github.com/impharaon/alpha-code/issues/210#issuecomment-5003230536) |
| AC-04 | 项目被移动、路径含 Unicode/符号链接、receipt 损坏时 fail closed，不退化为 global 卸载。 | [原票](https://github.com/impharaon/alpha-code/issues/210) · [最后裁决](https://github.com/impharaon/alpha-code/issues/210#issuecomment-5003230536) |
| AC-05 | 所有权 UI 能同时显示 authored、curated、distributed、runtime surfaces 与 support tier，不把 Alpha curated 误标为 Alpha authored。 | [原票](https://github.com/impharaon/alpha-code/issues/210) · [最后裁决](https://github.com/impharaon/alpha-code/issues/210#issuecomment-5003230536) |
| AC-06 | v1 receipt 有显式迁移/只读兼容策略；升级与回滚测试不丢现有安装。 | [原票](https://github.com/impharaon/alpha-code/issues/210) · [最后裁决](https://github.com/impharaon/alpha-code/issues/210#issuecomment-5003230536) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/210#issuecomment-5003230536)，本次不新增验收结论。 |
