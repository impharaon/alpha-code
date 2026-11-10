---
id: SPEC-extension-environments
title: 开发、测试与正式扩展状态相互隔离
summary: 开发、测试与正式扩展状态相互隔离，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 开发、测试与正式扩展状态相互隔离

开发、测试与正式扩展状态相互隔离。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-extensions/N-05](https://github.com/impharaon/alpha-work/blob/27d104dfb0bb8d36f6d050277255861c4927416c/docs/requests/RQ-extensions.md#需求点)。
- 历史身份：[impharaon/alpha-code#209](https://github.com/impharaon/alpha-code/issues/209)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/138)。
- [有效范围或验收依据 2026-07-17](https://github.com/impharaon/alpha-code/issues/209#issuecomment-4999230099)。
- [有效范围或验收依据 2026-07-20](https://github.com/impharaon/alpha-code/issues/209#issuecomment-5019457095)。
- [有效范围或验收依据 2026-07-20](https://github.com/impharaon/alpha-code/issues/209#issuecomment-5019463386)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：Windows 路径与崩溃矩阵是历史明确残差；旧迁移实现已经退役，当前 AC5 是不再读取旧根。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/ext/src/project-config.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ext/src/project-config.test.ts)
  - [alpha-code:packages/ui-mac/src/main/ext-project-entry.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/ext-project-entry.test.ts)

## 业务规则

- **BR-01** prod、beta、dev 的全部 mutable state 和 secret references 位于互不重叠、互不别名的 roots，任一环境不能读取/修改另一环境。
- **BR-02** 当前环境由 main 在初始化时冻结；renderer、extension 和导入输入不能伪造或热切换。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | prod、beta、dev 的全部 mutable state 和 secret references 位于互不重叠、互不别名的 roots，任一环境不能读取/修改另一环境。 | [原票](https://github.com/impharaon/alpha-code/issues/209) · [最后裁决](https://github.com/impharaon/alpha-code/issues/209#issuecomment-5019463386) |
| AC-02 | 当前环境由 main 在初始化时冻结；renderer、extension 和导入输入不能伪造或热切换。 | [原票](https://github.com/impharaon/alpha-code/issues/209) · [最后裁决](https://github.com/impharaon/alpha-code/issues/209#issuecomment-5019463386) |
| AC-03 | 跨环境共享仅发生于已验证、内容寻址、只读 blob；mutable receipt/grant/enabled/materialized state 不共享。 | [原票](https://github.com/impharaon/alpha-code/issues/209) · [最后裁决](https://github.com/impharaon/alpha-code/issues/209#issuecomment-5019463386) |
| AC-04 | prod 只查询 stable feed，beta 只查询 preview feed；不存在或错误 channel 配置 loud fail。 | [原票](https://github.com/impharaon/alpha-code/issues/209) · [最后裁决](https://github.com/impharaon/alpha-code/issues/209#issuecomment-5019463386) |
| AC-05 | 代码不再读取、导入、回退或创建旧 `~/.alpha` 布局；legacy symlink/absolute path 被拒绝。 | [原票](https://github.com/impharaon/alpha-code/issues/209) · [最后裁决](https://github.com/impharaon/alpha-code/issues/209#issuecomment-5019463386) |
| AC-06 | dev root 不是 prod/beta root 的祖先或后代，清理/重建 dev 环境不会删除其它环境状态。 | [原票](https://github.com/impharaon/alpha-code/issues/209) · [最后裁决](https://github.com/impharaon/alpha-code/issues/209#issuecomment-5019463386) |
| AC-07 | macOS/Windows 的空格、Unicode、跨盘符、junction/symlink 和 crash-retry 情况保持隔离与事务一致性。 | [原票](https://github.com/impharaon/alpha-code/issues/209) · [最后裁决](https://github.com/impharaon/alpha-code/issues/209#issuecomment-5019463386) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/209#issuecomment-5019463386)，本次不新增验收结论。 |
