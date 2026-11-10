---
id: SPEC-isolated-html-preview
title: 网页产物可静态查看且不能访问应用或网络
summary: 网页产物可静态查看且不能访问应用或网络，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 网页产物可静态查看且不能访问应用或网络

网页产物可静态查看且不能访问应用或网络。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-artifacts](https://github.com/impharaon/alpha-work/blob/d4a80d9c2ef0df32c58173310d9e368fa7bc9069/docs/requests/RQ-artifacts.md)。
- 历史身份：[impharaon/alpha-code#208](https://github.com/impharaon/alpha-code/issues/208)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/148)。
- [有效范围或验收依据 2026-07-12](https://github.com/impharaon/alpha-code/issues/208#issuecomment-4951282618)。
- [有效范围或验收依据 2026-07-14](https://github.com/impharaon/alpha-code/issues/208#issuecomment-4965542837)。
- [有效范围或验收依据 2026-09-17](https://github.com/impharaon/alpha-code/issues/208#issuecomment-5708520609)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/ui-mac/src/main/html-preview-host.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/html-preview-host.test.ts)
  - [alpha-code:packages/ui-mac/src/main/html-preview-host.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/html-preview-host.ts)
  - [alpha-code:packages/ui-mac/src/main/rail-preview-host.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/rail-preview-host.ts)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/artifact-html-preview/ArtifactHtmlPreview.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/artifact-html-preview/ArtifactHtmlPreview.tsx)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/artifact-html-preview/artifact-html-preview.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/artifact-html-preview/artifact-html-preview.test.ts)

## 业务规则

- **BR-01** HTML 只在独立沙箱预览进程内解析,应用界面进程不接触 HTML 内容;根文档有大小上限,超限拒绝并说明。
- **BR-02** 每次预览使用隔离、短生命周期的 main-owned host；关闭、切换或 crash 后 partition/storage/cache 不可恢复。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | HTML 只在独立沙箱预览进程内解析,应用界面进程不接触 HTML 内容;根文档有大小上限,超限拒绝并说明。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/208) · [最后裁决](https://github.com/impharaon/alpha-code/issues/208#issuecomment-5708520609) |
| AC-02 | 每次预览使用隔离、短生命周期的 main-owned host；关闭、切换或 crash 后 partition/storage/cache 不可恢复。 | [原票](https://github.com/impharaon/alpha-code/issues/208) · [最后裁决](https://github.com/impharaon/alpha-code/issues/208#issuecomment-5708520609) |
| AC-03 | host 无 preload、Node/Electron API 或 Alpha IPC bridge，页面无法枚举/控制主窗口或其它 preview。 | [原票](https://github.com/impharaon/alpha-code/issues/208) · [最后裁决](https://github.com/impharaon/alpha-code/issues/208#issuecomment-5708520609) |
| AC-04 | 所有网络、redirect、popup、外部协议、权限、download/upload、service worker 与持久 storage 默认拒绝。 | [原票](https://github.com/impharaon/alpha-code/issues/208) · [最后裁决](https://github.com/impharaon/alpha-code/issues/208#issuecomment-5708520609) |
| AC-05 | ~~main 通过异步有界 descriptor stream 读取；大 HTML、慢盘和取消不会阻塞应用事件循环。~~ —— 2026-09-17 删除(owner 裁决):读前已校验大小、单文件有上限,上限内的一次同步读取不产生用户可观察的卡顿;大小上限已并入 AC1。 | [原票](https://github.com/impharaon/alpha-code/issues/208) · [最后裁决](https://github.com/impharaon/alpha-code/issues/208#issuecomment-5708520609) |
| AC-06 | 被删除/阻断资源、sanitize 结果与失败原因诚实显示，系统浏览器动作需要显式用户操作。 | [原票](https://github.com/impharaon/alpha-code/issues/208) · [最后裁决](https://github.com/impharaon/alpha-code/issues/208#issuecomment-5708520609) |
| AC-07 | 每次预览使用独一份、不可复用的存储分区;关闭时清理,残留在下次启动时清除。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/208) · [最后裁决](https://github.com/impharaon/alpha-code/issues/208#issuecomment-5708520609) |
| AC-08 | 恶意 HTML 夹具下,预览保持零网络出口、零应用桥接、零跨预览存储(由隔离宿主行为测试判定;打包态冒烟随每个 Release Candidate 的清单执行)。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/208) · [最后裁决](https://github.com/impharaon/alpha-code/issues/208#issuecomment-5708520609) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/208#issuecomment-5708520609)，本次不新增验收结论。 |
