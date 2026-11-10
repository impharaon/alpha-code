---
id: SPEC-project-mcp-installation
title: 连接器可装到全局或当前项目并保持隔离
summary: 连接器可装到全局或当前项目并保持隔离，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 连接器可装到全局或当前项目并保持隔离

连接器可装到全局或当前项目并保持隔离。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-office](https://github.com/impharaon/alpha-work/blob/d4a80d9c2ef0df32c58173310d9e368fa7bc9069/docs/requests/RQ-office.md)。
- 历史身份：[impharaon/alpha-code#1013](https://github.com/impharaon/alpha-code/issues/1013)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/150)。
- [有效范围或验收依据 2026-08-19](https://github.com/impharaon/alpha-code/issues/1013#issuecomment-5336659442)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。

## 业务规则

- **BR-01** Hub 安装 catalog MCP 的**默认** scope 是 global；一次安装后，在任意打开的项目会话里该 MCP 可出现在工具表（引擎 global 配置）。证明：第一方 `installCatalog` wiring 默认 `scope: global` + 跨目录会话工具表用例。
- **BR-02** 在已打开项目目录 D 时，用户可将同一 catalog MCP **安装为 project**；收据与配置的权威根是 D 下基线点名的项目账本/配置，不是环境 `alpha.jsonc`。打开 D 的会话能连上；打开 D 以外目录的会话工具表没有这一份。咽喉 = planner 写盘根 + 引擎对该 instance directory 的配置合并。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | Hub 安装 catalog MCP 的**默认** scope 是 global；一次安装后，在任意打开的项目会话里该 MCP 可出现在工具表（引擎 global 配置）。证明：第一方 `installCatalog` wiring 默认 `scope: global` + 跨目录会话工具表用例。 | [原票](https://github.com/impharaon/alpha-code/issues/1013) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1013#issuecomment-5336659442) |
| AC-02 | 在已打开项目目录 D 时，用户可将同一 catalog MCP **安装为 project**；收据与配置的权威根是 D 下基线点名的项目账本/配置，不是环境 `alpha.jsonc`。打开 D 的会话能连上；打开 D 以外目录的会话工具表没有这一份。咽喉 = planner 写盘根 + 引擎对该 instance directory 的配置合并。 | [原票](https://github.com/impharaon/alpha-code/issues/1013) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1013#issuecomment-5336659442) |
| AC-03 | 到达 project catalog/seed MCP 安装的通路是 planner 在 decode 之后接受 `scope: project` 且完成发现/恢复/GC（或 DECIDE 证明的 N/A 集）；不得只放开 Hub 开关。咽喉 = 取代 `PROJECT_INSTALL_UNSUPPORTED_REASON` 对 MCP 的全称拒绝，改为基线登记的 kind 表。 | [原票](https://github.com/impharaon/alpha-code/issues/1013) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1013#issuecomment-5336659442) |
| AC-04 | 同名 MCP 的 global 行与 project 行独立：卸 project 不影响 global；在 D 里两行都在时，行为由基线点名的合并序决定（不得静默丢其中一个）。证明：同名并存用例。 | [原票](https://github.com/impharaon/alpha-code/issues/1013) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1013#issuecomment-5336659442) |
| AC-05 | Office / 其它 `{workspace}` MCP 无论 global 还是 project，durable command 仍含字面量 `{workspace}`；spawn 替换为当前 `InstanceState.directory`。安装 UI **没有**目录选择器。证明：与 REQ-134 同形的 argv/Hub 用例，project 安装路径也跑一遍。 | [原票](https://github.com/impharaon/alpha-code/issues/1013) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1013#issuecomment-5336659442) |
| AC-06 | ADR-030 点名的三缺口对 **已开放的 kind** 不再成立：项目根的 MCP 能被发现、崩溃 journal 能按项目恢复、GC 不扫掉仍被项目收据引用的 blob（或该 kind 不写 CAS，测试锁住「零 CAS 写」）。证明：DECIDE 基线表 + 对应闸门测试。 | [原票](https://github.com/impharaon/alpha-code/issues/1013) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1013#issuecomment-5336659442) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/1013#issuecomment-5336659442)，本次不新增验收结论。 |
