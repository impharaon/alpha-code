---
id: SPEC-visible-update-state
title: 检查更新的状态与重启安装入口可见
summary: 检查更新的状态与重启安装入口可见，按历史条文与实际证明登记范围。
kind: spec
status: draft
version: 0
approved_by: ""
approved_at: ""
owners: [owner]
last_reviewed: 2026-11-10
---

# 检查更新的状态与重启安装入口可见

检查更新的状态与重启安装入口可见。已有能力及其剩余证据义务分别记录，历史关闭日期不改写为本次完成。

## 来源

- [impharaon/alpha-work:RQ-downloads](https://github.com/impharaon/alpha-work/blob/27d104dfb0bb8d36f6d050277255861c4927416c/docs/requests/RQ-downloads.md#需求点)。
- [历史需求 alpha-code#1207](https://github.com/impharaon/alpha-code/issues/1207) · [Epic alpha-work#144](https://github.com/impharaon/alpha-work/issues/144)。

## 用户与范围

- 用户：使用相关桌面、官网或云工具入口的 Code Puppy 用户。
- 包括：下列历史条款中的用户结果，保留原编号和后续有效裁决。
- 不包括：原票未批准的新产品能力或未授权的真实生产验证。
- 假设与依赖：原票按 Bug 完成关闭。登记两个已有判据，未找到完整逐条最终验收；不据此新建重复开发任务。

- 当前基线实现/测试仍存在；只核实文件和已有证明，本次不重跑产品测试：
  - [alpha-code:packages/ui-mac/src/renderer/sidebar/updater-state-surface.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/sidebar/updater-state-surface.test.ts)
  - [alpha-code:packages/ui-mac/src/renderer/sidebar/updater-surface.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/sidebar/updater-surface.test.ts)
  - [alpha-code:packages/ui-mac/src/main/updater-restore.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/updater-restore.test.ts)

## 业务规则

- **BR-01** `UpdaterState` 的每一个 `status` 都有确定的用户可见呈现。**
- **BR-02** 更新已下载就绪时,重启后仍能从界面看到并触发安装。**

规则依据原条款；后续范围修订以上文和来源为准。

## 验收

原编号按 AC-01 形式登记；未改变条文义务。

| ID | 原条文 | 依据 |
| --- | --- | --- |
| AC-01 | `UpdaterState` 的每一个 `status` 都有确定的用户可见呈现。**<br><br>判据钉在**单一权威**上:`UpdaterState`(`@opencode-ai/app/updater`,上游类型)的 `status` 联合类型。<br>在 alpha 侧建一份 `status → 呈现` 的映射,并由一条测试断言该映射对该联合类型**穷尽**。<br>新增一个 status 而未给呈现 ⇒ 类型不过或测试红。<br><br>**这条 AC 是咽喉点形态,不是全称否定**:判的不是「界面上到处都有反馈吗」(无限),<br>而是「映射是否覆盖了状态机的全部成员」(有限,一次变异判完)。 | [原条文](https://github.com/impharaon/alpha-code/issues/1207) |
| AC-02 | 更新已下载就绪时,重启后仍能从界面看到并触发安装。**<br><br>不依赖用户恰好停在某个对话框前。持久化记录(`opencode.updater` 的 `ready`)在<br>启动后必须投影到一个可见入口;点它能装。 | [原条文](https://github.com/impharaon/alpha-code/issues/1207) |

## 待决

原票按 Bug 完成关闭。登记两个已有判据，未找到完整逐条最终验收；不据此新建重复开发任务。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 0 | 2026-11-10 | — | 来源与证据已整理，缺口未消除，不以治理授权代替批准。 |
