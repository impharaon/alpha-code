---
id: SPEC-current-turn-file-review
title: 右栏审查显示本回合的真实文件修改
summary: 右栏审查显示本回合的真实文件修改，按历史条文与实际证明登记范围。
kind: spec
status: draft
version: 0
approved_by: ""
approved_at: ""
owners: [owner]
last_reviewed: 2026-11-12
---

# 右栏审查显示本回合的真实文件修改

右栏审查显示本回合的真实文件修改。已有能力及其剩余证据义务分别记录，历史关闭日期不改写为本次完成。

## 来源

- [impharaon/alpha-work:INT-artifacts](https://github.com/impharaon/alpha-work/blob/de325762131253b18e9b65227e366f60a2f39ebe/docs/intents/INT-artifacts.md#意图点)。
- [历史需求 alpha-code#1163](https://github.com/impharaon/alpha-code/issues/1163) · [Epic alpha-work#148](https://github.com/impharaon/alpha-work/issues/148)。
- [范围与交付证据](https://github.com/impharaon/alpha-code/pull/1168)。

- [批准/事实依据](https://github.com/impharaon/alpha-code/pull/1168)。
- 交付入口：[alpha-code#1163](https://github.com/impharaon/alpha-code/issues/1163)；实现与验收状态由这些票及其原生子票持有。

- 实施/证据承接：[alpha-code#1683](https://github.com/impharaon/alpha-code/issues/1683)。

## 用户与范围

- 用户：使用相关桌面、官网或云工具入口的 Code Puppy 用户。
- 包括：下列历史条款中的用户结果，保留原编号和后续有效裁决。
- 不包括：原票未批准的新产品能力或未授权的真实生产验证。
- 假设与依赖：PR #1168 证明生产供数、投影与变异；该 PR 明示未完成运行期截图、files 容器整链验证。保留历史关闭，不伪造所有 AC 的正式包证明。

- 当前基线实现/测试仍存在；只核实文件和已有证明，本次不重跑产品测试：
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/session-rail/review/review-turn-diffs.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/session-rail/review/review-turn-diffs.ts)
  - [alpha-code:packages/opencode/test/session/codepuppy-review-turn-supply.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/opencode/test/session/codepuppy-review-turn-supply.test.ts)

## 业务规则

- **BR-01** 任意 git 项目会话中,助手在一个回合内修改了文件后,右栏审查面显示**该回合**的文件
- **BR-02** 存在一条自动化测试**驱动生产供数链**并断言非空:测试链路必须包含引擎侧

规则依据原条款；后续范围修订以上文和来源为准。

## 验收

原编号按 AC-01 形式登记；未改变条文义务。

| ID | 原条文 | 依据 |
| --- | --- | --- |
| AC-01 | 任意 git 项目会话中,助手在一个回合内修改了文件后,右栏审查面显示**该回合**的文件<br>变更(文件卡:文件名 + 增删统计 + 补丁),不再恒空;审查 tab 计数徽章同步非零。<br>判据自检:①路径——数据链本轮已逐坐标证实(summarize 每回合写 diffs → 消息同步 → alpha<br>容器可投影;上游同形态消费是活参照);②证据——组件测试(真实 message 形状喂投影,断言文件卡<br>渲染)+ VERIFY 运行期截图(真实会话);③错误实现(继续读 `session_diff` store)恒空,测试红。 | [原条文](https://github.com/impharaon/alpha-code/issues/1163) |
| AC-02 | 存在一条自动化测试**驱动生产供数链**并断言非空:测试链路必须包含引擎侧<br>`SessionSummary.diff` / `summarize` 生产代码的真实执行(不得用手工夹具顶替引擎供数方;<br>夹具只允许出现在 storage 字节层),断言 alpha 审查面的数据入口收到非空变更;<br>变异演练:删除引擎侧供数消费接线(alpha 容器不再调投影/端点)或把供数换回死通道,该测试变红。<br>判据自检:①路径——**harness 形态已实证可行,两条候选任选**(实证报告<br>`/tmp/claude-501/spike-ac142-harness.md`,2026-08-28,主 session 勘破盒):<br>候选 A 引擎内直驱生产 `SessionSummary.summarize/diff`(真 git tmpdir + 生产 `snapshot.track()`,<br>模板 `packages/opencode/test/session/revert-compact.test.ts:470-505`)`1 pass / 0 fail`,RC=0;<br>候选 B 打生产 HTTP `GET /session/:id/diff?messageID=`(模板<br>`test/server/session-diff-missing-patch.test.ts`——该端点已有测试在打)`1 pass / 0 fail`,RC=0;<br>**变异演练已跑**:删生产 `summarize` 调用 ⇒ 两条均 `0 pass / 1 fail`(红在 `diffs.length > 0`<br>/ `body.length > 0`),RC=1;「已知的坏」三臂(不带 messageID / 零改动回合 / HTTP 不带 query)<br>全部拿到空——手段有效。消息写入用生产 `session.updateMessage/updatePart`(storage 层,本 AC<br>允许的夹具层);样例底稿在 `.worktrees/ac142-spike/` 两个测试文件,实现票可直接取用。<br>落位:作**新增文件**落 `packages/opencode/test/session/alpha-*.test.ts`(north-star 对新增<br>不拦,见本 REQ 背景;沿用 `alpha-` 前缀先例);②证据——测试名(实施时定)+ VERIFY 里的变异<br>演练记录;<br>③错误实现(mock 引擎返回值的「假驱动」)在变异演练下不红,会被演练记录暴露——演练是本 AC<br>证据的一部分,不是可选项。<br>(此条是派发书点名必须有的:今天所有审查测试都用夹具顶替供数方,删掉引擎侧整条 diff 供数<br>照样全绿——勘破第八节实测。) | [原条文](https://github.com/impharaon/alpha-code/issues/1163) |
| AC-03 | 文件面改动徽章与「点击有改动文件 → 跳转审查文件卡」恢复工作:本回合被改的文件在<br>文件树行上出现改动徽章;点击该行落在审查面对应文件卡(files-state.ts:239-246 的<br>jumpToReview 分支在生产可达)。<br>判据自检:①路径——徽章数据源与审查面同一投影(session-rail-files.tsx:53-55 改接);<br>②证据——组件测试(徽章渲染 + 点击落点)+ L2;③错误实现(徽章仍读死通道)测试红。<br>与 REQ-141 AC1 的分流语义保持:有徽章 → 审查,无徽章 → 查看器(两张 REQ 各自测自己分支,<br>合并顺序无相互阻塞,但 VERIFY 要在两者都落后跑一次分流联测)。 | [原条文](https://github.com/impharaon/alpha-code/issues/1163) |
| AC-04 | 空态诚实:面板呈现的是最近一次助手回合的变更;新回合未改文件时显示空态、不残留上一<br>回合内容;空态文案与实际行为一致(修复后「助手修改文件后会实时出现在这里」成为真话,或改写<br>文案与所选语义一致)。<br>判据自检:①路径——投影按回合键控,天然可判「本回合无变更」;②证据——组件测试(两回合序列:<br>有变更 → 无变更,断言清空)+ 文案 key 断言;③错误实现(聚合所有历史回合不清空)测试红。 | [原条文](https://github.com/impharaon/alpha-code/issues/1163) |

证据与适用边界：PR #1168 已合入生产供数链、投影、组件清空与变异证明。PR 明确把 AC-01 运行期截图和 AC-03 files 整链留给 VERIFY；原查看器 #1162 已按 not planned 关闭，不将其当成未完成的硬阻塞。补核现有查看器分流与真实文件卡。

## 待决

- 实施/证据承接：[alpha-code#1683](https://github.com/impharaon/alpha-code/issues/1683)。

发布件 AC-01/03 证据由独立验收承接，AC-02/04 复用 PR #1168；证据齐备后才按历史补录规则批准，不新增产品范围。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 0 | 2026-11-10 | — | 来源与证据已整理，缺口未消除，不以治理授权代替批准。 |
| 0 | 2026-11-12 | — | 已核对历史范围与实际证据；具体缺口见待决，由来源中的交付入口承接。 |
