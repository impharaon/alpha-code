---
id: SPEC-conversation-overlays
title: 对话浮层与工具批准
summary: 统一对话浮层交互，并让用户批准工具时还能翻看时间线。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 对话浮层与工具批准

使用 Code Puppy 的人在输入框旁切换选项、看通知或批准工具时，遇到的是一致的操作。工具批准保持全局可见，用户仍能往上翻时间线看为什么需要这次批准。

## 来源

- Story：[alpha-code#1472](https://github.com/impharaon/alpha-code/issues/1472)，引用 [2026-10-10 已批准设计](https://github.com/impharaon/alpha-code/blob/0c70875c996f6a2221e8093014268836b79ca823/docs/design/2026-10-10-timeline-process-fold/design.md)。
- [原关闭记录](https://github.com/impharaon/alpha-code/issues/1472#issuecomment-6096473537) · [v0.1.18 发布](https://github.com/impharaon/alpha-code/releases/tag/v0.1.18)。

## 用户与范围

- 用户：在 Code Puppy 桌面端和助手对话的人。
- 包括：菜单、提示、通知、模型提问和工具批准的渲染层交互。
- 不包括：联网批准、项目扩展信任和生态导入的系统弹窗。
- 假设与依赖：沿用桌面现有时间线与工具权限。

## 业务规则

- **BR-01** 工具批准保持单一全局面板，不遮挡或冻结页面；授权判定与可选项保持原规则。

## 验收

| ID | Given / When / Then（原票文字） | 依据 |
| --- | --- | --- |
| AC-01 | 模型、运行权限、思考强度菜单与「+ / @」列表使用同一容器外观与同一套规则:上下键移动、回车选择、Esc 关闭并把焦点还给触发按钮、点别处关闭、同时只开一个、窗口变化时重新定位;「/ @」列表保持焦点在输入框。 | [逐条证据](https://github.com/impharaon/alpha-code/issues/1472#issuecomment-6095707363) |
| AC-02 | 悬停提示只有一种外观(含代码块复制提示);原本只在原生悬停文字里的说明改为同一种提示,其中解释「为什么不能点」的改为控件旁可见文字;所有复制按钮点击后给出「已复制」反馈。 | [逐条证据](https://github.com/impharaon/alpha-code/issues/1472#issuecomment-6095707363) |
| AC-03 | 通知只剩一套:普通通知 4 秒消失且悬停暂停,出错通知不自动消失并立即朗读;全局横幅位于对话框之下。 | [逐条证据](https://github.com/impharaon/alpha-code/issues/1472#issuecomment-6095707363) |
| AC-04 | 工具批准仍是全应用唯一一个批准面板(任何页面都会出现,五项事实全显示,Esc 不能关闭),但不加遮罩、不冻结页面,停在窗口底部输入框之上,时间线可继续翻看;外观与模型提问卡同族;出现时焦点落在「允许一次」;授权判定与可选项不变;会话输入区不挂批准卡(2026-07-25 单一呈现面裁决的反向闸门保持)。 | [逐条证据](https://github.com/impharaon/alpha-code/issues/1472#issuecomment-6095707363) |

[当前代码中的测试](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/session-workspace/permission-single-surface.test.ts)仍在。
[截图对照](https://github.com/impharaon/alpha-code/issues/1472#issuecomment-6096995647)来自无头浏览器中的生产组件，记录了细节偏差。原发布记录及截图不等于新增的正式包实机验收。

## 待决

无规格范围待决。补录保留当时证据的覆盖边界。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 补录已交付行为；依据[批准设计与原 Story](https://github.com/impharaon/alpha-code/issues/1472)、[关闭记录](https://github.com/impharaon/alpha-code/issues/1472#issuecomment-6096473537)。 |
