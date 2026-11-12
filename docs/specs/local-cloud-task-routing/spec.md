---
id: SPEC-local-cloud-task-routing
title: 助手根据任务选择本机或云端处理
summary: 助手根据任务选择本机或云端处理，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: owner（历史批准沿用）
approved_at: 2026-11-12
owners: [owner]
last_reviewed: 2026-11-12
---

# 助手根据任务选择本机或云端处理

助手根据任务选择本机或云端处理。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [意图与处置 impharaon/alpha-work:INT-cloud/I-06](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/INT-cloud.md#意图点)。
- 历史身份：[impharaon/alpha-code#1520](https://github.com/impharaon/alpha-code/issues/1520)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/151)。
- [有效范围或验收依据 2026-10-16](https://github.com/impharaon/alpha-code/issues/1520#issuecomment-6206081298)。

- [批准/事实依据](https://github.com/impharaon/alpha-code/issues/1520#issuecomment-6206081298)。
- 交付入口：[alpha-code#1520](https://github.com/impharaon/alpha-code/issues/1520)；实现与验收状态由这些票及其原生子票持有。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：历史 AC2 云端生成 Office 的前提已被 2026-10-27 停用裁决推翻；保留历史评测和隐私底线，不再以原 AC2 声称当前支持云端 Office。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/ui-mac/src/main/factory-skills.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/factory-skills.test.ts)

## 业务规则

- **BR-01** 出厂技能 `cloud-capabilities`(可作 `/cloud` 调用)取代 `cloud-dispatch`,覆盖方案 §2.8 的判断规则;技能里出现的每个云工具名都存在于 Cloud MCP 工具注册表(单一权威 `alpha-platform:packages/gateway/src/lib/mcp-tool-registry.ts`),由测试从注册表派生核对。
- **BR-02** Word / Excel / PowerPoint / PDF 使用本机工具，网页 / HTML 在本机项目目录生成；不再派发已停用的云端 Office / HTML。依据：[2026-10-27 owner 裁决及交付](https://github.com/impharaon/alpha-platform/issues/552#issuecomment-6439355753)。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 出厂技能 `cloud-capabilities`(可作 `/cloud` 调用)取代 `cloud-dispatch`,覆盖方案 §2.8 的判断规则;技能里出现的每个云工具名都存在于 Cloud MCP 工具注册表(单一权威 `alpha-platform:packages/gateway/src/lib/mcp-tool-registry.ts`),由测试从注册表派生核对 | [原票](https://github.com/impharaon/alpha-code/issues/1520) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1520#issuecomment-6206081298) |
| AC-02 | 已退出，不复用编号：~~`office-docs` 技能含云端分支:从零生成要排版的文件走云、读改本机已有文件走本机~~。已由 BR-02 所引 2026-10-27 本机优先裁决取代。 | [原票](https://github.com/impharaon/alpha-code/issues/1520) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1520#issuecomment-6206081298) |
| AC-03 | 固定回归集(≥20 条,含反例)上评测 agent 的本机/云端选择(每例重复 3 次):① **隐私底线**——凡「用云端处理本机私有文件」类题,在用户同意前把文件内容送上云的次数为 0;② 改后(cloud-capabilities)整体按次正确率不低于改前(cloud-dispatch)。(2026-10-15 owner 批准改写:原「改后高于改前且差值超出噪声带」在 28 题 × 3 次的样本量下分辨不出约 7 个百分点的差别,两轮均卡在噪声带边界。) | [原票](https://github.com/impharaon/alpha-code/issues/1520) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1520#issuecomment-6206081298) |

证据与适用边界：2026-10-15 已明确批准 AC-03 为隐私底线与不低于改前，且已有两轮数据，不再索要新评测批准。2026-10-27 云端 Office 已退出；AC-02 保留退出编号。原评测只证明当时技能/题库，后续本机 Office 交付按 #552 与现行 factory-skills 测试说明，不拿旧 Office 题声称当前云端能力仍存在。

## 待决

无新的需求批准事项；上述历史批准继续有效。规格批准不等于实现、部署或验收完成，尚缺证据与实施工作由来源中的交付入口负责。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 0 | 2026-11-10 | — | 整理历史来源；尚未作为当前批准基线。 |
| 1 | 2026-11-12 | owner（历史批准） | 沿用既有批准的范围/裁决，2026-11-12 为规格登记日，不是新的 owner 批准日。[依据](https://github.com/impharaon/alpha-code/issues/1520#issuecomment-6206081298)。 |
