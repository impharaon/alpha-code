---
id: SPEC-session-results-workspace
title: 会话右栏统一查看文件、产物和修改
summary: 会话右栏统一查看文件、产物和修改，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 会话右栏统一查看文件、产物和修改

会话右栏统一查看文件、产物和修改。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-artifacts/N-04](https://github.com/impharaon/alpha-work/blob/27d104dfb0bb8d36f6d050277255861c4927416c/docs/requests/RQ-artifacts.md#需求点)。
- 历史身份：[impharaon/alpha-code#206](https://github.com/impharaon/alpha-code/issues/206)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/148)。
- [有效范围或验收依据 2026-07-12](https://github.com/impharaon/alpha-code/issues/206#issuecomment-4951282241)。
- [有效范围或验收依据 2026-07-14](https://github.com/impharaon/alpha-code/issues/206#issuecomment-4965542232)。
- [有效范围或验收依据 2026-09-17](https://github.com/impharaon/alpha-code/issues/206#issuecomment-5708505318)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/ui-mac/src/main/artifact-read.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/artifact-read.test.ts)
  - [alpha-code:packages/ui-mac/src/main/workspace-file-service.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/workspace-file-service.test.ts)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/artifact-workbench/renderers/renderer-views.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/artifact-workbench/renderers/renderer-views.tsx)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/session-rail/artifacts/artifacts-panel-view.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/session-rail/artifacts/artifacts-panel-view.tsx)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/session-rail/files/file-viewer-state.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/session-rail/files/file-viewer-state.ts)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/cards/tool-cards.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/cards/tool-cards.tsx)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/session-workspace/rail-width.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/session-workspace/rail-width.test.ts)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/session-workspace/rail-width.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/session-workspace/rail-width.ts)

## 业务规则

- **BR-01** 正式会话页右栏按内容提供产物、文件、审查(改动)面板;无可用能力时不显示误导性空标签。
- **BR-02** 从 timeline、cloud run、automation 和 tool output 打开的对象进入同一 Workbench，来源与状态可追溯。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 正式会话页右栏按内容提供产物、文件、审查(改动)面板;无可用能力时不显示误导性空标签。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/206) · [最后裁决](https://github.com/impharaon/alpha-code/issues/206#issuecomment-5708505318) |
| AC-02 | 从 timeline、cloud run、automation 和 tool output 打开的对象进入同一 Workbench，来源与状态可追溯。 | [原票](https://github.com/impharaon/alpha-code/issues/206) · [最后裁决](https://github.com/impharaon/alpha-code/issues/206#issuecomment-5708505318) |
| AC-03 | mode、选择、尺寸、滚动与打开状态按 session 隔离；快速切换 session 不串状态，重启按明确规则恢复。 | [原票](https://github.com/impharaon/alpha-code/issues/206) · [最后裁决](https://github.com/impharaon/alpha-code/issues/206#issuecomment-5708505318) |
| AC-04 | Files/Changes/Inspector 与 Artifacts 使用各自 typed adapter，不从 renderer 读取任意本地路径或猜测云端来源。 | [原票](https://github.com/impharaon/alpha-code/issues/206) · [最后裁决](https://github.com/impharaon/alpha-code/issues/206#issuecomment-5708505318) |
| AC-05 | deep link、save-copy、focus-preview、close 与返回触发点的焦点行为一致且可键盘操作。 | [原票](https://github.com/impharaon/alpha-code/issues/206) · [最后裁决](https://github.com/impharaon/alpha-code/issues/206#issuecomment-5708505318) |
| AC-06 | 右栏宽度可拖动调整且不小于 320px;窄窗口下无内容遮挡或不可达控制。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/206) · [最后裁决](https://github.com/impharaon/alpha-code/issues/206#issuecomment-5708505318) |
| AC-07 | Viewer/renderer crash 只影响当前内容区域，用户可切 Source/Metadata、重试或关闭，不卸载 Session。 | [原票](https://github.com/impharaon/alpha-code/issues/206) · [最后裁决](https://github.com/impharaon/alpha-code/issues/206#issuecomment-5708505318) |
| AC-08 | ~~#203 只挂载/卸载 Workbench；container state、mode 与 discovery 在本需求中有唯一 owner。~~ —— 2026-09-17 删除(owner 裁决):内部职责划分,不是用户可观察结果;#203 与 REQ-125 均已关,无需也无法独立判定。 | [原票](https://github.com/impharaon/alpha-code/issues/206) · [最后裁决](https://github.com/impharaon/alpha-code/issues/206#issuecomment-5708505318) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/206#issuecomment-5708505318)，本次不新增验收结论。 |
