---
id: SPEC-conversation-process-fold
title: 对话中的工作过程摘要
summary: 把回答前的工作步骤收成一行，用户可展开核对，回答和待处理操作保持可见。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 对话中的工作过程摘要

使用 Code Puppy 做复杂任务的人，可以先看到回答，需要时再展开工作过程。运行中能看到正在做什么，回答、产物和需要用户处理的事项保持可见。

## 来源

- [impharaon/alpha-work:RQ-conversation](https://github.com/impharaon/alpha-work/blob/27d104dfb0bb8d36f6d050277255861c4927416c/docs/requests/RQ-conversation.md#需求点)。

- Story：[alpha-code#1471](https://github.com/impharaon/alpha-code/issues/1471)，引用 [2026-10-10 已批准设计](https://github.com/impharaon/alpha-code/blob/0c70875c996f6a2221e8093014268836b79ca823/docs/design/2026-10-10-timeline-process-fold/design.md)。
- [原关闭记录](https://github.com/impharaon/alpha-code/issues/1471#issuecomment-6096473021) · [v0.1.18 发布](https://github.com/impharaon/alpha-code/releases/tag/v0.1.18)。

## 用户与范围

- 用户：在 Code Puppy 桌面端和助手对话的人。
- 包括：会话时间线里的工作过程、步骤详情、进行中状态与来源展示。
- 不包括：工具来源安全、授权与计费规则。
- 假设与依赖：沿用桌面现有时间线与工具权限。

## 业务规则

- **BR-01** 工作过程可展开，但回答、待处理、错误和产物等保持在外；第三方步骤的原始输入、输出与错误不展示。

## 验收

| ID | Given / When / Then（原票文字） | 依据 |
| --- | --- | --- |
| AC-01 | 助手回合的思考、工具调用与工具之间的过渡话收进回答上方的一行摘要(动作计数 · 不顺之处 · 用时);回答、等你处理、回合错误卡、中断行、空回合行、产物行、图片行、本回合改动、脚注不进入工作过程。 | [逐条证据](https://github.com/impharaon/alpha-code/issues/1471#issuecomment-6096282096) |
| AC-02 | 点开摘要每步一行:连续、同类、同来源、都已结束的步骤合成一行;思考只写时长(模型明确给出小标题时附上);再点一步显示该类工具已有的详情内容;没有详情的步骤不可展开。 | [逐条证据](https://github.com/impharaon/alpha-code/issues/1471#issuecomment-6096282096) |
| AC-03 | 成功的步骤不显示任何状态;行尾只出现三种东西:超过 10 秒的时长、人话的失败或等待原因、改动增删数;计数只在为零时出现。 | [逐条证据](https://github.com/impharaon/alpha-code/issues/1471#issuecomment-6096282096) |
| AC-04 | 进行中:工作过程在回合开始即出现,实时标题写当前动作与用时;只露最近 2 步与所有正在跑的步骤;超过 10 秒的步骤显示「已等」时长;思考不露原文;第一个回答字出现即收成一行;回答后又调用工具时那段文字移入工作过程;等你批准 / 回答时标题变为琥珀色的等你面;用户手动开关过的本回合不再自动开关。 | [逐条证据](https://github.com/impharaon/alpha-code/issues/1471#issuecomment-6096282096) |
| AC-05 | 第三方 MCP、插件、来源不明的步骤在行内显示来源图标与服务名,我方步骤永不带这些标记;这些步骤的输入、输出与错误原文仍不显示。 | [逐条证据](https://github.com/impharaon/alpha-code/issues/1471#issuecomment-6096282096) |
| AC-06 | 答完的提问显示问题与用户的选择;任何工具的审批超时都用同一句人话说明。 | [逐条证据](https://github.com/impharaon/alpha-code/issues/1471#issuecomment-6096282096) |

[当前代码中的测试](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/process-fold.test.ts)仍在。
[截图对照](https://github.com/impharaon/alpha-code/issues/1471#issuecomment-6096995453)来自无头浏览器中的生产组件，记录了细节偏差。原发布记录及截图不等于新增的正式包实机验收。

## 待决

无规格范围待决。补录保留当时证据的覆盖边界。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 补录已交付行为；依据[批准设计与原 Story](https://github.com/impharaon/alpha-code/issues/1471)、[关闭记录](https://github.com/impharaon/alpha-code/issues/1471#issuecomment-6096473021)。 |
