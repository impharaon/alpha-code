---
id: SPEC-owned-settings-and-dialogs
title: 设置、模型选择、审批与恢复使用一致交互
summary: 设置、模型选择、审批与恢复使用一致交互，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 设置、模型选择、审批与恢复使用一致交互

设置、模型选择、审批与恢复使用一致交互。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-desktop](https://github.com/impharaon/alpha-work/blob/d4a80d9c2ef0df32c58173310d9e368fa7bc9069/docs/requests/RQ-desktop.md)。
- 历史身份：[impharaon/alpha-code#205](https://github.com/impharaon/alpha-code/issues/205)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/149)。
- [有效范围或验收依据 2026-07-21](https://github.com/impharaon/alpha-code/issues/205#issuecomment-5029347612)。
- [有效范围或验收依据 2026-07-21](https://github.com/impharaon/alpha-code/issues/205#issuecomment-5031473139)。
- [有效范围或验收依据 2026-07-21](https://github.com/impharaon/alpha-code/issues/205#issuecomment-5031908692)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。

## 业务规则

- **BR-01** Settings 直接通过 typed API 读取/校验/保存；失败可恢复且重启后显示权威值。
- **BR-02** Model/Variant 选择直接调用正式 contract，禁用/不可用/错误状态真实呈现，不点击隐藏控件。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | Settings 直接通过 typed API 读取/校验/保存；失败可恢复且重启后显示权威值。 | [原票](https://github.com/impharaon/alpha-code/issues/205) · [最后裁决](https://github.com/impharaon/alpha-code/issues/205#issuecomment-5031908692) |
| AC-02 | Model/Variant 选择直接调用正式 contract，禁用/不可用/错误状态真实呈现，不点击隐藏控件。 | [原票](https://github.com/impharaon/alpha-code/issues/205) · [最后裁决](https://github.com/impharaon/alpha-code/issues/205#issuecomment-5031908692) |
| AC-03 | Permission UI 清楚显示主体、能力、资源、作用域和有效期；拒绝/一次/持久授权按 policy API 原子提交。 | [原票](https://github.com/impharaon/alpha-code/issues/205) · [最后裁决](https://github.com/impharaon/alpha-code/issues/205#issuecomment-5031908692) |
| AC-04 | Dialog 的打开、确认、取消、Escape、焦点圈禁与焦点返回均由 Alpha 组件持有。 | [原票](https://github.com/impharaon/alpha-code/issues/205) · [最后裁决](https://github.com/impharaon/alpha-code/issues/205#issuecomment-5031908692) |
| AC-05 | Recovery 对配置损坏、sidecar/network failure、surface crash 和保存失败给出分区动作，不泄漏 secret/path。 | [原票](https://github.com/impharaon/alpha-code/issues/205) · [最后裁决](https://github.com/impharaon/alpha-code/issues/205#issuecomment-5031908692) |
| AC-06 | 所有页面/对话框由 #204 canonical route/surface composition 唯一挂载，不存在 observer/Portal/双交互层。 | [原票](https://github.com/impharaon/alpha-code/issues/205) · [最后裁决](https://github.com/impharaon/alpha-code/issues/205#issuecomment-5031908692) |
| AC-07 | 键盘、读屏、IME、reduced motion、窄宽和明暗主题满足已批准的产品基线。 | [原票](https://github.com/impharaon/alpha-code/issues/205) · [最后裁决](https://github.com/impharaon/alpha-code/issues/205#issuecomment-5031908692) |
| AC-08 | 权限或设置提交的重复操作具备幂等/事务语义，崩溃恢复不会显示未生效的成功状态。 | [原票](https://github.com/impharaon/alpha-code/issues/205) · [最后裁决](https://github.com/impharaon/alpha-code/issues/205#issuecomment-5031908692) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/205#issuecomment-5031908692)，本次不新增验收结论。 |
