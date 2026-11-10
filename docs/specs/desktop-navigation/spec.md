---
id: SPEC-desktop-navigation
title: 新对话、项目切换和搜索入口真正可用
summary: 新对话、项目切换和搜索入口真正可用，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 新对话、项目切换和搜索入口真正可用

新对话、项目切换和搜索入口真正可用。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-desktop](https://github.com/impharaon/alpha-work/blob/d4a80d9c2ef0df32c58173310d9e368fa7bc9069/docs/requests/RQ-desktop.md)。
- 历史身份：[impharaon/alpha-code#653](https://github.com/impharaon/alpha-code/issues/653)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/149)。
- [有效范围或验收依据 2026-07-28](https://github.com/impharaon/alpha-code/issues/653#issuecomment-5104550000)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：默认目录在后续品牌变更中已改名，原文保留历史 ~/Alpha；当前值读取 default-workspace 权威，不新增旧目录兼容承诺。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/composer-state.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/composer-state.ts)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/settings-surface-ratchet.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/settings-surface-ratchet.test.ts)
  - [alpha-code:packages/ui-mac/src/renderer/codepuppy-ui/surface-seam-contract.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/codepuppy-ui/surface-seam-contract.test.ts)
  - [alpha-code:packages/ui-mac/src/renderer/route-composition.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/route-composition.test.ts)

## 业务规则

- **BR-01** 从任一入口开新对话(侧栏「新对话」、冷启动落地),过程中不出现其它页面的界面残影,落地页始终是 alpha 新对话页。
- **BR-02** 任一全页覆盖层打开时,点击侧栏中的具体会话(**包括当前正在看的那个会话**)、「新对话」或首页,覆盖层关闭并落到目标页面。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 从任一入口开新对话(侧栏「新对话」、冷启动落地),过程中不出现其它页面的界面残影,落地页始终是 alpha 新对话页。 | [原票](https://github.com/impharaon/alpha-code/issues/653) · [最后裁决](https://github.com/impharaon/alpha-code/issues/653#issuecomment-5104550000) |
| AC-02 | 任一全页覆盖层打开时,点击侧栏中的具体会话(**包括当前正在看的那个会话**)、「新对话」或首页,覆盖层关闭并落到目标页面。 | [原票](https://github.com/impharaon/alpha-code/issues/653) · [最后裁决](https://github.com/impharaon/alpha-code/issues/653#issuecomment-5104550000) |
| AC-03 | 侧栏不再有「产物」入口、全页产物页面不可达;会话右边栏的产物面板与时间线产物行为不退化(右栏现状即 mount/tick 刷新;「新 run 落盘即刷新」是新能力,属 #660)。 | [原票](https://github.com/impharaon/alpha-code/issues/653) · [最后裁决](https://github.com/impharaon/alpha-code/issues/653#issuecomment-5104550000) |
| AC-04 | 新对话页可以切换到其它项目、也可以打开新目录作为项目,选择后当前新对话立即对该目录生效,且已输入内容不被无声丢弃。 | [原票](https://github.com/impharaon/alpha-code/issues/653) · [最后裁决](https://github.com/impharaon/alpha-code/issues/653#issuecomment-5104550000) |
| AC-05 | 未显式选择目录时,新对话默认落在默认对话目录 `~/Alpha`;目录不存在时先供给,供给失败有明确提示而非静默;且 server 与目录同源 —— 宿主机默认目录不会被配到 WSL/remote server 上。 | [原票](https://github.com/impharaon/alpha-code/issues/653) · [最后裁决](https://github.com/impharaon/alpha-code/issues/653#issuecomment-5104550000) |
| AC-06 | 点击侧栏「搜索」(及其快捷键)打开搜索面板,可按标题搜到既有会话并跳转过去。 | [原票](https://github.com/impharaon/alpha-code/issues/653) · [最后裁决](https://github.com/impharaon/alpha-code/issues/653#issuecomment-5104550000) |
| AC-07 | alpha 界面上不存在指向未注册命令的可点入口:基线 §1.6 每一项要么可用、要么连入口一起移除。 | [原票](https://github.com/impharaon/alpha-code/issues/653) · [最后裁决](https://github.com/impharaon/alpha-code/issues/653#issuecomment-5104550000) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/653#issuecomment-5104550000)，本次不新增验收结论。 |
