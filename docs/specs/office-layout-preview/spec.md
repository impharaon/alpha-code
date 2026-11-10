---
id: SPEC-office-layout-preview
title: Office 文件在隔离预览里显示真实版式
summary: Office 文件在隔离预览里显示真实版式，按历史条文与实际证明登记范围。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# Office 文件在隔离预览里显示真实版式

Office 文件在隔离预览里显示真实版式。已有能力及其剩余证据义务分别记录，历史关闭日期不改写为本次完成。

## 来源

- [RQ-preview](https://github.com/impharaon/alpha-work/blob/27d104dfb0bb8d36f6d050277255861c4927416c/docs/requests/RQ-preview.md#需求点)。
- [历史需求 alpha-code#1229](https://github.com/impharaon/alpha-code/issues/1229) · [Epic alpha-work#146](https://github.com/impharaon/alpha-work/issues/146)。
- [范围与交付证据](https://github.com/impharaon/alpha-code/pull/1230)。

## 用户与范围

- 用户：使用相关桌面、官网或云工具入口的 Code Puppy 用户。
- 包括：下列历史条款中的用户结果，保留原编号和后续有效裁决。
- 不包括：原票未批准的新产品能力或未授权的真实生产验证。
- 假设与依赖：主预览使用已打包的 Office 渲染器；文字提取是失败时的诚实兜底，由 office-content-preview 维护。字体缺失可能影响符号保真，不承诺像素级一致。

- 当前基线实现/测试仍存在；只核实文件和已有证明，本次不重跑产品测试：
  - [alpha-code:packages/ui-mac/src/office-preview/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/office-preview/index.ts)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/artifact-workbench/renderers/office-preview.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/artifact-workbench/renderers/office-preview.test.ts)

## 业务规则

- **BR-01** 真 Chromium 下三个格式各自的渲染证据 + 零出网证据 + 恶意容器仍被结构闸挡住的反向臂。

规则依据原条款；后续范围修订以上文和来源为准。

## 验收

原编号按 AC-01 形式登记；未改变条文义务。

| ID | 原条文 | 依据 |
| --- | --- | --- |
| AC-01 | 真 Chromium 下三个格式各自的渲染证据 + 零出网证据 + 恶意容器仍被结构闸挡住的反向臂。 | [原条文](https://github.com/impharaon/alpha-code/issues/1229) |

## 待决

没有本次新增的产品裁决；上列历史限制及已登记的独立验收仍有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | owner 授权完整补录已完成能力；[已有交付依据](https://github.com/impharaon/alpha-code/pull/1230)，非本次重新实测。 |
