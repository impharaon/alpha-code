---
id: SPEC-draft-to-session
title: 未发送草稿可在正式路由里转成对话
summary: 未发送草稿可在正式路由里转成对话，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 未发送草稿可在正式路由里转成对话

未发送草稿可在正式路由里转成对话。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-desktop](https://github.com/impharaon/alpha-work/blob/d4a80d9c2ef0df32c58173310d9e368fa7bc9069/docs/requests/RQ-desktop.md)。
- 历史身份：[impharaon/alpha-code#201](https://github.com/impharaon/alpha-code/issues/201)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/149)。
- [有效范围或验收依据 2026-07-12](https://github.com/impharaon/alpha-code/issues/201#issuecomment-4950774855)。
- [有效范围或验收依据 2026-07-14](https://github.com/impharaon/alpha-code/issues/201#issuecomment-4965541001)。
- [有效范围或验收依据 2026-09-17](https://github.com/impharaon/alpha-code/issues/201#issuecomment-5708466509)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/app/src/app.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/app.tsx)
  - [alpha-code:packages/app/src/pages/draft-route-gate.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/pages/draft-route-gate.tsx)
  - [alpha-code:packages/console/app/src/app.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/src/app.tsx)
  - [alpha-code:packages/console/support/src/app.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/support/src/app.tsx)
  - [alpha-code:packages/enterprise/src/app.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/enterprise/src/app.tsx)
  - [alpha-code:packages/stats/app/src/app.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/stats/app/src/app.tsx)
  - [alpha-code:packages/tui/src/app.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/tui/src/app.tsx)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/new-session-draft-stash.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/new-session-draft-stash.ts)

## 业务规则

- **BR-01** 有效 draft 只挂载一个 Alpha Draft surface，并使用该 draft 当前 server/directory 作用域的 client。
- **BR-02** 缺失、未知、已删除或损坏的 draft 显示确定错误/恢复动作，不出现空白页、无限 loading 或静默新建。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 有效 draft 只挂载一个 Alpha Draft surface，并使用该 draft 当前 server/directory 作用域的 client。 | [原票](https://github.com/impharaon/alpha-code/issues/201) · [最后裁决](https://github.com/impharaon/alpha-code/issues/201#issuecomment-5708466509) |
| AC-02 | 缺失、未知、已删除或损坏的 draft 显示确定错误/恢复动作，不出现空白页、无限 loading 或静默新建。 | [原票](https://github.com/impharaon/alpha-code/issues/201) · [最后裁决](https://github.com/impharaon/alpha-code/issues/201#issuecomment-5708466509) |
| AC-03 | ~~未发送输入及模型、agent、variant、permission 等选择在 reload 和应用重启后仍与同一 draft 关联。~~ —— 2026-09-17 删除(owner 裁决):移出本需求,由独立小 bug alpha-code#266(P3)承载;其余条目已交付。 | [原票](https://github.com/impharaon/alpha-code/issues/201) · [最后裁决](https://github.com/impharaon/alpha-code/issues/201#issuecomment-5708466509) |
| AC-04 | 切换工作目录时草稿内容不丢失,且旧目录的状态不会出现在新目录下。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/201) · [最后裁决](https://github.com/impharaon/alpha-code/issues/201#issuecomment-5708466509) |
| AC-05 | 首次提交失败不会 false-promote；重试符合幂等边界且不会生成重复 Session/prompt。 | [原票](https://github.com/impharaon/alpha-code/issues/201) · [最后裁决](https://github.com/impharaon/alpha-code/issues/201#issuecomment-5708466509) |
| AC-06 | promotion 成功后由 canonical route helper 导航，back/forward、reload、deep link 与 IME/autocomplete 行为稳定。 | [原票](https://github.com/impharaon/alpha-code/issues/201) · [最后裁决](https://github.com/impharaon/alpha-code/issues/201#issuecomment-5708466509) |
| AC-07 | Draft surface 不依赖 global client、隐藏 upstream 页面、Portal 或旧页面兼容状态。 | [原票](https://github.com/impharaon/alpha-code/issues/201) · [最后裁决](https://github.com/impharaon/alpha-code/issues/201#issuecomment-5708466509) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/201#issuecomment-5708466509)，本次不新增验收结论。 |
