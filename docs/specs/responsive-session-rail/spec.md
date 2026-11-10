---
id: SPEC-responsive-session-rail
title: 右栏可以调宽并为聊天区保留空间
summary: 右栏可以调宽并为聊天区保留空间，按历史条文与实际证明登记范围。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 右栏可以调宽并为聊天区保留空间

右栏可以调宽并为聊天区保留空间。已有能力及其剩余证据义务分别记录，历史关闭日期不改写为本次完成。

## 来源

- [RQ-preview](https://github.com/impharaon/alpha-work/blob/27d104dfb0bb8d36f6d050277255861c4927416c/docs/requests/RQ-preview.md#需求点)。
- [历史需求 alpha-code#1161](https://github.com/impharaon/alpha-code/issues/1161) · [Epic alpha-work#146](https://github.com/impharaon/alpha-work/issues/146)。
- [范围与交付证据](https://github.com/impharaon/alpha-code/issues/1161#issuecomment-5460883740)。
- [范围与交付证据](https://github.com/impharaon/alpha-code/issues/1161#issuecomment-5461043475)。

## 用户与范围

- 用户：使用相关桌面、官网或云工具入口的 Code Puppy 用户。
- 包括：下列历史条款中的用户结果，保留原编号和后续有效裁决。
- 不包括：原票未批准的新产品能力或未授权的真实生产验证。
- 假设与依赖：2026-08-29 已按批准设计做 packaged 证据与三层变异。当前 clamp 文件存在；本次未重新运行这些产品测试。

- 当前基线实现/测试仍存在；只核实文件和已有证明，本次不重跑产品测试：
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/session-workspace/rail-width.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/session-workspace/rail-width.ts)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/session-workspace/rail-width.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/session-workspace/rail-width.test.ts)

## 业务规则

- **BR-01** 右栏可拖拽与键盘调宽到超过今天 560px 的上限,新上限/规则与已批设计增量一致;
- **BR-02** 右栏拉到新上限时,会话列(聊天区)保有设计稿定义的最小可用宽度;窗口收窄时右栏先让步,

规则依据原条款；后续范围修订以上文和来源为准。

## 验收

原编号按 AC-01 形式登记；未改变条文义务。

| ID | 原条文 | 依据 |
| --- | --- | --- |
| AC-01 | 右栏可拖拽与键盘调宽到超过今天 560px 的上限,新上限/规则与已批设计增量一致;<br>拖拽、键盘(←/→)、持久化读写、ARIA `aria-valuemin/max`、CSS `min/max-width` 五处行为一致<br>(同一 clamp 契约,无一处残留旧 560)。<br>判据自检:①路径——五处坐标已钉死(背景段),全是 alpha-owned 字面量/常量;②证据——**更新后**、<br>以设计稿批准值为**独立字面量锚点**的两条测试(`session-rail-artifacts.test.ts` 的 CSS 字面量<br>断言 + `rail-width.test.ts` 的 clamp 断言;后者现值 `clampRailWidth(9000)===RAIL_MAX_WIDTH`<br>是自指,更新时必须换成批准值字面量——AC2 的「不引用生产常量自指」纪律显式适用于本条)<br>+ 与已批设计稿对比的 L2 截图;③错误实现被这两条**更新后**的独立锚点测试抓住。审计实读证实<br>**现状**两条对「只改常量」均恒绿(session-rail-artifacts.test.ts:157-166 只读 shellCss 断<br>含 `max-width: 560px`;自指 clamp 断言改常量不红)——「把测试锚点换成批准值」是本 AC 证据<br>的一部分,不是顺手活。 | [原条文](https://github.com/impharaon/alpha-code/issues/1161) |
| AC-02 | 右栏拉到新上限时,会话列(聊天区)保有设计稿定义的最小可用宽度;窗口收窄时右栏先让步,<br>会话列不被挤到设计稿下限以下。<br>判据自检:①路径——若设计稿选「随窗口宽度算」,clamp 函数加窗口项即可(clamp 是唯一咽喉,<br>`session-workspace-shell.tsx:203-306` 三个调用点都过它);②证据——组件测试(窄窗口下 clamp<br>结果断言,锚点用设计稿批准后的独立字面量,**不引用生产常量自指**——CLAUDE.md「比较基准与被测<br>对象同源」教训)+ L2 截图;③错误实现(上限仍是固定值、窄窗口挤死会话列)测试红。<br><br>(不另设「按面板记忆不回归」AC:该证据已由现有 `rail-width.test.ts` 承载,重述即多余。) | [原条文](https://github.com/impharaon/alpha-code/issues/1161) |

## 待决

没有本次新增的产品裁决；上列历史限制及已登记的独立验收仍有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | owner 授权完整补录已完成能力；[已有交付依据](https://github.com/impharaon/alpha-code/issues/1161#issuecomment-5461043475)，非本次重新实测。 |
