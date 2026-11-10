---
id: SPEC-tool-inventory-identity
title: 工具清单和授权身份随实际来源变化
summary: 工具清单和授权身份随实际来源变化，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: draft
version: 0
approved_by: ""
approved_at: ""
owners: [owner]
last_reviewed: 2026-11-10
---

# 工具清单和授权身份随实际来源变化

工具清单和授权身份随实际来源变化。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-safety](https://github.com/impharaon/alpha-work/blob/d4a80d9c2ef0df32c58173310d9e368fa7bc9069/docs/requests/RQ-safety.md)。
- 历史身份：[impharaon/alpha-code#723](https://github.com/impharaon/alpha-code/issues/723)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/142)。
- [有效范围或验收依据 2026-08-26](https://github.com/impharaon/alpha-code/issues/723#issuecomment-5419376073)。
- [有效范围或验收依据 2026-11-09](https://github.com/impharaon/alpha-code/issues/723#issuecomment-6731102595)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：2026-11-08 核对仍缺 AC5 云端 403 反例、AC6 动态消失/重现具名用例及 AC12 裁定；不能把子票已关等同于全部验收完成。
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

- **BR-01** 可配置工具集合从一个 registry-derived inventory 产生，覆盖本地内置、Cloud MCP、第三方 MCP 和插件动态工具；新增/移除工具会确定性进入策略差异，而不是依赖手写 UI 名单。
- **BR-02** 每项工具使用稳定的 source/server/remote-tool identity 解析 `disabled\|ask\|enabled`；显示标题、模型侧拼接 ID 与 server rename 不会静默继承错误授权。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 可配置工具集合从一个 registry-derived inventory 产生，覆盖本地内置、Cloud MCP、第三方 MCP 和插件动态工具；新增/移除工具会确定性进入策略差异，而不是依赖手写 UI 名单。 | [原票](https://github.com/impharaon/alpha-code/issues/723) · [最后裁决](https://github.com/impharaon/alpha-code/issues/723#issuecomment-6731102595) |
| AC-02 | 每项工具使用稳定的 source/server/remote-tool identity 解析 `disabled\|ask\|enabled`；显示标题、模型侧拼接 ID 与 server rename 不会静默继承错误授权。 | [原票](https://github.com/impharaon/alpha-code/issues/723) · [最后裁决](https://github.com/impharaon/alpha-code/issues/723#issuecomment-6731102595) |
| AC-06 | 未知新工具采用批准的 fail-safe 默认并可被用户理解地发现；动态工具消失、重现、server URL/identity 变化不会复用旧服务的授权。 | [原票](https://github.com/impharaon/alpha-code/issues/723) · [最后裁决](https://github.com/impharaon/alpha-code/issues/723#issuecomment-6731102595) |
| AC-09 | 可配置工具的 identity 与 inventory 来自 #731 固化的单一权威；展示（#722）与策略（#724）消费同一份 identity，不存在第二份映射。 | [原票](https://github.com/impharaon/alpha-code/issues/723) · [最后裁决](https://github.com/impharaon/alpha-code/issues/723#issuecomment-6731102595) |
| AC-10 | 模型可见别名与稳定 identity 保持可验证的一一映射；无法唯一反解的别名在提供给模型或执行前 fail closed，不触发网络、副作用或费用（实现见 #726）。 | [原票](https://github.com/impharaon/alpha-code/issues/723) · [最后裁决](https://github.com/impharaon/alpha-code/issues/723#issuecomment-6731102595) |

## 待决

2026-11-08 核对仍缺 AC5 云端 403 反例、AC6 动态消失/重现具名用例及 AC12 裁定；不能把子票已关等同于全部验收完成。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 0 | 2026-11-10 | — | 整理历史来源；尚未作为当前批准基线。 |
