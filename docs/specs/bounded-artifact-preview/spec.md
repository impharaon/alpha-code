---
id: SPEC-bounded-artifact-preview
title: 常见产物按安全边界预览，超限有明确说明
summary: 常见产物按安全边界预览，超限有明确说明，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 常见产物按安全边界预览，超限有明确说明

常见产物按安全边界预览，超限有明确说明。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-artifacts](https://github.com/impharaon/alpha-work/blob/d4a80d9c2ef0df32c58173310d9e368fa7bc9069/docs/requests/RQ-artifacts.md)。
- 历史身份：[impharaon/alpha-code#207](https://github.com/impharaon/alpha-code/issues/207)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/148)。
- [有效范围或验收依据 2026-07-12](https://github.com/impharaon/alpha-code/issues/207#issuecomment-4951282443)。
- [有效范围或验收依据 2026-07-14](https://github.com/impharaon/alpha-code/issues/207#issuecomment-4965542576)。
- [有效范围或验收依据 2026-09-17](https://github.com/impharaon/alpha-code/issues/207#issuecomment-5708516326)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/app/src/i18n/zh.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/i18n/zh.ts)
  - [alpha-code:packages/console/app/src/i18n/zh.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/src/i18n/zh.ts)
  - [alpha-code:packages/core/src/system-context/registry.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/core/src/system-context/registry.ts)
  - [alpha-code:packages/core/src/tool/registry.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/core/src/tool/registry.ts)
  - [alpha-code:packages/desktop/src/renderer/i18n/zh.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/desktop/src/renderer/i18n/zh.ts)
  - [alpha-code:packages/opencode/src/tool/registry.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/opencode/src/tool/registry.ts)
  - [alpha-code:packages/stats/app/src/i18n/zh.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/stats/app/src/i18n/zh.ts)
  - [alpha-code:packages/ui-mac/src/main/artifact-read.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/artifact-read.test.ts)

## 业务规则

- **BR-01** 相同 descriptor 在不同入口得到相同 renderer/fallback 决策，且决策显式考虑 subtype、trust、size 与 capability。
- **BR-02** Markdown、text/code、JSON、CSV 在预算内完整预览;超出预算时只读取并显示开头节选并明确告知,内容经 main 侧分段通道读取,不整包进入界面。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 相同 descriptor 在不同入口得到相同 renderer/fallback 决策，且决策显式考虑 subtype、trust、size 与 capability。 | [原票](https://github.com/impharaon/alpha-code/issues/207) · [最后裁决](https://github.com/impharaon/alpha-code/issues/207#issuecomment-5708516326) |
| AC-02 | Markdown、text/code、JSON、CSV 在预算内完整预览;超出预算时只读取并显示开头节选并明确告知,内容经 main 侧分段通道读取,不整包进入界面。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/207) · [最后裁决](https://github.com/impharaon/alpha-code/issues/207#issuecomment-5708516326) |
| AC-03 | 本机文件预览经分段通道读取,关闭或切换后读取立即停止;云端产物的二进制预览有 20 MiB 上限,超限提供外部打开。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/207) · [最后裁决](https://github.com/impharaon/alpha-code/issues/207#issuecomment-5708516326) |
| AC-04 | PDF 在隔离的独立预览视图中显示,该视图无应用能力、网络、导航与下载默认拒绝。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/207) · [最后裁决](https://github.com/impharaon/alpha-code/issues/207#issuecomment-5708516326) |
| AC-05 | 超过 20 MiB 的图片不内联解码,显示说明并提供外部打开;损坏图片显示可理解的失败。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/207) · [最后裁决](https://github.com/impharaon/alpha-code/issues/207#issuecomment-5708516326) |
| AC-06 | renderer crash、timeout 或 unsupported format 不导致空白 Workbench；Source、Metadata、retry 与 external-open/save-copy 动作可达。 | [原票](https://github.com/impharaon/alpha-code/issues/207) · [最后裁决](https://github.com/impharaon/alpha-code/issues/207#issuecomment-5708516326) |
| AC-07 | audio/video 与 rich SVG 明确显示“当前不内置渲染”，不会通过 extension fallback 或通用 plugin 静默执行。 | [原票](https://github.com/impharaon/alpha-code/issues/207) · [最后裁决](https://github.com/impharaon/alpha-code/issues/207#issuecomment-5708516326) |
| AC-08 | renderer 只能经受控通道按工作区相对路径或 descriptor 请求内容,不能读取未授权路径、网络资源或其它会话内容。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/207) · [最后裁决](https://github.com/impharaon/alpha-code/issues/207#issuecomment-5708516326) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/207#issuecomment-5708516326)，本次不新增验收结论。 |
