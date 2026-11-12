---
id: SPEC-tool-permission-policy
title: 用户可按来源、服务和工具设置停用、询问或允许
summary: 用户可按来源、服务和工具设置停用、询问或允许，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: draft
version: 0
approved_by: ""
approved_at: ""
owners: [owner]
last_reviewed: 2026-11-10
---

# 用户可按来源、服务和工具设置停用、询问或允许

用户可按来源、服务和工具设置停用、询问或允许。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [意图与处置 impharaon/alpha-work:INT-safety/I-01](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/INT-safety.md#意图点)。
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

- **BR-01** `disabled` 工具既不提供给模型，又在到达真实 tool executor 的唯一咽喉响亮拒绝；直接构造 tool call、插件 hook 或缓存目录不能绕过。
- **BR-02** `ask` 工具在网络、文件副作用、云端调用或计费之前请求用户批准；拒绝/取消不产生副作用或费用。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-03 | `disabled` 工具既不提供给模型，又在到达真实 tool executor 的唯一咽喉响亮拒绝；直接构造 tool call、插件 hook 或缓存目录不能绕过。 | [原票](https://github.com/impharaon/alpha-code/issues/723) · [最后裁决](https://github.com/impharaon/alpha-code/issues/723#issuecomment-6731102595) |
| AC-04 | `ask` 工具在网络、文件副作用、云端调用或计费之前请求用户批准；拒绝/取消不产生副作用或费用。 | [原票](https://github.com/impharaon/alpha-code/issues/723) · [最后裁决](https://github.com/impharaon/alpha-code/issues/723#issuecomment-6731102595) |
| AC-05 | 最终生效策略是托管上限、用户持久设置与本次会话批准三者中最严格者;任何本地选择都不能绕过现有强制 kill-switch。本地设置为「允许」的云工具仍以服务端的授权结果为准(本地不重复判定、也不能放宽)。 _(2026-09-16 改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/723) · [最后裁决](https://github.com/impharaon/alpha-code/issues/723#issuecomment-6731102595) |
| AC-11 | 插件动态工具支持 `ask`,而不只是整工具开/关。 _(2026-09-16 改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/723) · [最后裁决](https://github.com/impharaon/alpha-code/issues/723#issuecomment-6731102595) |
| AC-12 | 无法只禁用单个工具的既有折叠（`edit\|write\|apply_patch` 合一、三个 MCP-resource 工具折进 `read`）被消除或在方案中明确记录为已知限制并给出理由。 | [原票](https://github.com/impharaon/alpha-code/issues/723) · [最后裁决](https://github.com/impharaon/alpha-code/issues/723#issuecomment-6731102595) |

## 待决

2026-11-08 核对仍缺 AC5 云端 403 反例、AC6 动态消失/重现具名用例及 AC12 裁定；不能把子票已关等同于全部验收完成。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 0 | 2026-11-10 | — | 整理历史来源；尚未作为当前批准基线。 |
