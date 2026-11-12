---
id: SPEC-home-session-creation
title: 用户从首页可靠开始新对话
summary: 用户从首页可靠开始新对话，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 用户从首页可靠开始新对话

用户从首页可靠开始新对话。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [意图与处置 impharaon/alpha-work:INT-desktop/I-04](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/INT-desktop.md#意图点)。
- 历史身份：[impharaon/alpha-code#200](https://github.com/impharaon/alpha-code/issues/200)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/149)。
- [有效范围或验收依据 2026-07-12](https://github.com/impharaon/alpha-code/issues/200#issuecomment-4950774710)。
- [有效范围或验收依据 2026-07-14](https://github.com/impharaon/alpha-code/issues/200#issuecomment-4965540791)。
- [有效范围或验收依据 2026-09-17](https://github.com/impharaon/alpha-code/issues/200#issuecomment-5708456106)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/app/src/app.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/app.tsx)
  - [alpha-code:packages/console/app/src/app.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/src/app.tsx)
  - [alpha-code:packages/console/support/src/app.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/support/src/app.tsx)
  - [alpha-code:packages/enterprise/src/app.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/enterprise/src/app.tsx)
  - [alpha-code:packages/stats/app/src/app.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/stats/app/src/app.tsx)
  - [alpha-code:packages/tui/src/app.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/tui/src/app.tsx)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/boundary-error-text.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/boundary-error-text.ts)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/composer-autocomplete.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/composer-autocomplete.tsx)

## 业务规则

- **BR-01** `/` 在 Alpha 产品中只挂载一个 Home root，不存在 Portal、隐藏 upstream Home 或重复交互层。
- **BR-02** 项目加载失败、配置文件损坏、引擎连不上、页面区域崩溃这四种情况各有一条可操作(可重试/可打开配置/可恢复)的提示,且提示文字互不混用。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | `/` 在 Alpha 产品中只挂载一个 Home root，不存在 Portal、隐藏 upstream Home 或重复交互层。 | [原票](https://github.com/impharaon/alpha-code/issues/200) · [最后裁决](https://github.com/impharaon/alpha-code/issues/200#issuecomment-5708456106) |
| AC-02 | 项目加载失败、配置文件损坏、引擎连不上、页面区域崩溃这四种情况各有一条可操作(可重试/可打开配置/可恢复)的提示,且提示文字互不混用。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/200) · [最后裁决](https://github.com/impharaon/alpha-code/issues/200#issuecomment-5708456106) |
| AC-03 | 首条消息失败时输入和选择保持可恢复；重试或重复点击不会意外创建重复 Session 或重复 prompt。 | [原票](https://github.com/impharaon/alpha-code/issues/200) · [最后裁决](https://github.com/impharaon/alpha-code/issues/200#issuecomment-5708456106) |
| AC-04 | 成功后只通过 canonical route helper 导航到正确 Session，back/forward、reload 与 deep link 返回 Home 行为一致。 | [原票](https://github.com/impharaon/alpha-code/issues/200) · [最后裁决](https://github.com/impharaon/alpha-code/issues/200#issuecomment-5708456106) |
| AC-05 | 错误 UI 不泄漏 token、认证头、未脱敏绝对路径或 provider secret。 | [原票](https://github.com/impharaon/alpha-code/issues/200) · [最后裁决](https://github.com/impharaon/alpha-code/issues/200#issuecomment-5708456106) |
| AC-06 | composer、autocomplete 和主要动作具备正确读屏名称、焦点顺序、键盘操作与 IME 行为(工作区选择器的读屏语义已按裁决移出本需求)。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/200) · [最后裁决](https://github.com/impharaon/alpha-code/issues/200#issuecomment-5708456106) |
| AC-07 | Portal/隐藏 CSS/observer 等 takeover 资产被删除，结构性 takeover ratchet 不回升。 | [原票](https://github.com/impharaon/alpha-code/issues/200) · [最后裁决](https://github.com/impharaon/alpha-code/issues/200#issuecomment-5708456106) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/200#issuecomment-5708456106)，本次不新增验收结论。 |
