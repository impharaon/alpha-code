---
id: SPEC-connector-workspace-following
title: 连接器跟随当前会话所在项目目录
summary: 连接器跟随当前会话所在项目目录，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 连接器跟随当前会话所在项目目录

连接器跟随当前会话所在项目目录。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-office](https://github.com/impharaon/alpha-work/blob/d4a80d9c2ef0df32c58173310d9e368fa7bc9069/docs/requests/RQ-office.md)。
- 历史身份：[impharaon/alpha-code#1010](https://github.com/impharaon/alpha-code/issues/1010)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/150)。
- [有效范围或验收依据 2026-08-19](https://github.com/impharaon/alpha-code/issues/1010#issuecomment-5336655885)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:github/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/github/index.ts)
  - [alpha-code:packages/app/e2e/utils/visual-stability/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/e2e/utils/visual-stability/index.ts)
  - [alpha-code:packages/app/src/components/session/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/components/session/index.ts)
  - [alpha-code:packages/app/src/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/index.ts)
  - [alpha-code:packages/app/src/pages/session/composer/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/pages/session/composer/index.ts)
  - [alpha-code:packages/cli/src/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/cli/src/index.ts)
  - [alpha-code:packages/client/src/generated-effect/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/client/src/generated-effect/index.ts)
  - [alpha-code:packages/client/src/generated/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/client/src/generated/index.ts)

## 业务规则

- **BR-01** 到达 Office 工具工作区根的**唯一通路**是 `connectLocal` 把 command 中**精确等于** `{workspace}` 的参数替换为当前 `InstanceState.directory`；`server.py` 仍按该根做 containment。其余 token 原样到达子进程。
- **BR-02** 安装任一 catalog `{workspace}` 连接器后，全局 `mcp.<name>.command` 含字面量 `{workspace}`，不含安装时选中的主机目录。咽喉 = `deriveMcpConfig` 保留标记 + office 写盘闸接受标记。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 到达 Office 工具工作区根的**唯一通路**是 `connectLocal` 把 command 中**精确等于** `{workspace}` 的参数替换为当前 `InstanceState.directory`；`server.py` 仍按该根做 containment。其余 token 原样到达子进程。 | [原票](https://github.com/impharaon/alpha-code/issues/1010) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1010#issuecomment-5336655885) |
| AC-02 | 安装任一 catalog `{workspace}` 连接器后，全局 `mcp.<name>.command` 含字面量 `{workspace}`，不含安装时选中的主机目录。咽喉 = `deriveMcpConfig` 保留标记 + office 写盘闸接受标记。 | [原票](https://github.com/impharaon/alpha-code/issues/1010) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1010#issuecomment-5336655885) |
| AC-03 | Hub 安装此类条目不再弹出目录选择器、不再展示「选目录」；携带 `grants.workspace` 的安装意图被拒绝（该键退出 allowlist，走未知键失败）。 | [原票](https://github.com/impharaon/alpha-code/issues/1010) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1010#issuecomment-5336655885) |
| AC-04 | 启动时，catalog 所有、模板精确匹配、且 workspace 槽为绝对路径的已装条目迁回标记，之后跟随当前会话目录；自定义条目、版本钉漂移、额外 argv、相对路径一律字节不变。咽喉 = `reconcileMcpWorkspaceMarkers` 白名单。 | [原票](https://github.com/impharaon/alpha-code/issues/1010) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1010#issuecomment-5336655885) |
| AC-05 | 指向会话目录之外的绝对路径，工具响亮失败；仅包含标记子串的 token 不被替换。 | [原票](https://github.com/impharaon/alpha-code/issues/1010) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1010#issuecomment-5336655885) |
| AC-06 | 本变化不把任何 `{workspace}` 连接器放大到家目录或整盘；精确标记替换 + `server.py` containment。社区 Excel / `excel-workspace` 已由 REQ-135 退役，不再作为本票证据（原 AC6 后半句作废）。 | [原票](https://github.com/impharaon/alpha-code/issues/1010) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1010#issuecomment-5336655885) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/1010#issuecomment-5336655885)，本次不新增验收结论。 |
