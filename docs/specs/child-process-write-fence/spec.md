---
id: SPEC-child-process-write-fence
title: 连接器与语言服务的子进程也受写入范围约束
summary: 连接器与语言服务的子进程也受写入范围约束；用户亲手打开的项目当场可写、不重启引擎（v2）；保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 2
approved_by: owner
approved_at: 2026-11-19
owners: [owner]
last_reviewed: 2026-11-19
---

# 连接器与语言服务的子进程也受写入范围约束

连接器与语言服务的子进程也受写入范围约束。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [意图与处置 impharaon/alpha-work:INT-safety/I-06](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/INT-safety.md#意图点)。
- 历史身份：[impharaon/alpha-code#1286](https://github.com/impharaon/alpha-code/issues/1286)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/142)。
- [有效范围或验收依据 2026-09-10](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5612150393)。
- [有效范围或验收依据 2026-09-10](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613792565)。
- [有效范围或验收依据 2026-09-10](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613855309)。
- v2 增量「用户亲手打开的项目当场可写」的来源是 owner 2026-11-19 的原话（本会话，逐字）：
  - 关于现状（引擎启动后才打开的项目在重启前只读，标题栏「只读」带「重新启动」按钮）：「这个是什么意思啊，这个交互逻辑我觉得有点乱。我希望可以尽量用户无感。不能因为一个文档生成要重启一次引擎吧。」
  - 关于两条路（第一条：空闲时后台换引擎；第二条：用户亲手打开的项目当场可写、完全不重启；两条都只认用户本人的操作，模型自己不能借此扩大可写范围）：「如果第二条可行，就选第二条，这样才是真正的无感，好的，如果这样我觉得可以。」

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：AC1 逐通路清单形态已由 owner 选定的进程树继承围栏替代；LSP 由创建原语结构等价证明，非真实语言服务器实跑；非 darwin 不宣称已启用围栏。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:github/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/github/index.ts)
  - [alpha-code:packages/app/e2e/utils/visual-stability/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/e2e/utils/visual-stability/index.ts)
  - [alpha-code:packages/app/src/components/session/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/components/session/index.ts)
  - [alpha-code:packages/app/src/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/index.ts)
  - [alpha-code:packages/app/src/pages/session/composer/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/pages/session/composer/index.ts)
  - [alpha-code:packages/app/src/utils/server.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/utils/server.ts)
  - [alpha-code:packages/cli/src/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/cli/src/index.ts)
  - [alpha-code:packages/client/src/generated-effect/index.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/client/src/generated-effect/index.ts)

## 业务规则

- **BR-01** 「工具/引擎派生的进程真正落盘」的通路被枚举成一份**单一权威**(不是散文清单);每条通路要么经围栏,要么在闸上被显式点名为已知豁免并写明理由。新增一条未登记的派生通路 ⇒ 闸红。
- **BR-02** MCP stdio 派生的进程越界写入失败,而不是静默成功。
- **BR-03**（v2）用户亲手打开的项目当场可写：经「打开项目」选中、或在应用里进入的项目，助手、终端和连接器子进程立即能写入；不重启引擎、不重启应用、不打断其它对话。
- **BR-04**（v2）常规路径上不出现「只读」标记，全应用没有「重新启动 Code Puppy」按钮。
- **BR-05**（v2）只有用户本人的打开动作能扩大可写范围；模型、对话里的命令、连接器进程和外部链接都扩大不了。
- **BR-06**（v2）仍然写不进去的情形，各用一句白话说明原因，不带按钮。

规则据下表原条款摘录（BR-03 至 BR-06 为 v2 新增，依据见「来源」的 owner 原话）；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 「工具/引擎派生的进程真正落盘」的通路被枚举成一份**单一权威**(不是散文清单);每条通路要么经围栏,要么在闸上被显式点名为已知豁免并写明理由。新增一条未登记的派生通路 ⇒ 闸红。<br>*将来拿什么证明*:枚举来源的判据测试 + 一条反向用例(新增未登记通路必须红)。 | [原票](https://github.com/impharaon/alpha-code/issues/1286) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613855309) |
| AC-02 | MCP stdio 派生的进程越界写入失败,而不是静默成功。<br>*将来拿什么证明*:正反两跑的真 `sandbox-exec` 语料(与 REQ-138 `#1076` 同形态)。 | [原票](https://github.com/impharaon/alpha-code/issues/1286) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613855309) |
| AC-03 | LSP 派生的进程同 AC2。 | [原票](https://github.com/impharaon/alpha-code/issues/1286) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613855309) |
| AC-04 | 平台边界如实声明:非 darwin 平台不假装有围栏,该状态在产品面可观察。<br>*将来拿什么证明*:平台分档的判据测试(`shell-sandbox.ts:191` 已有先例)。 | [原票](https://github.com/impharaon/alpha-code/issues/1286) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613855309) |
| AC-05 | Given 引擎已在运行、围栏在线，某文件夹不在本次引擎启动时的可写范围内；When 用户经「打开项目」选中它，或从项目列表、侧栏进入它或它的对话，然后让助手在里面写一个文件；Then 文件落盘，引擎进程没有换代、页面没有重载，另一个对话里正在进行的回答没有被取消；打开之前就开着的终端和已在运行的连接器子进程也能写进这个文件夹。<br>*将来拿什么证明*：真引擎、真围栏的测试；对照臂不放行时同一次写入失败且 0 落盘。 | owner 2026-11-19 原话（见「来源」）；BR-03 |
| AC-06 | Given AC-05 的路径；Then 界面上不出现「只读」胶囊与项目标签上的只读尾标，全应用没有「重新启动 Code Puppy」按钮。<br>*将来拿什么证明*：界面判据测试（两个只读钩子缺席、按钮不存在）。 | 同上；BR-04 |
| AC-07 | Given 围栏内由模型发起的进程；When 它试图自己扩大可写范围（伪造放行凭证、自己签发放行凭证、发外部链接让应用打开某个文件夹、向主进程发消息）；Then 目标文件夹仍然写不进，0 落盘。<br>*将来拿什么证明*：每种手段一条反向用例；去掉对应防护后该用例必须变红。 | 同上；BR-05 |
| AC-08 | Given 仍然写不进去的三种情形：主目录或 Code Puppy 自己的数据目录；只经外部链接到达、用户没有亲手打开的文件夹；放行失败；Then 各显示一句说明、没有按钮；第二种在用户用「打开项目」选中该文件夹后当场可写。<br>*将来拿什么证明*：三种情形各一条界面用例；第二种含「选中后可写」的后续步骤。 | 同上；BR-06 |

## 用户会碰到的限制

- 主目录和 Code Puppy 自己的数据目录不能整个作为项目写入（v1 已有的规则，v2 不变）。
- 只经外部链接到达、用户没有在应用里亲手打开过的文件夹不会自动变成可写，用「打开项目」选中即可（v2 新增；依据 owner 接受的前提「只认你本人的操作」。四个仓库里目前没有任何产品面会产出这种链接）。

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 2 | 2026-11-19 | owner | 「如果第二条可行，就选第二条，这样才是真正的无感，好的，如果这样我觉得可以。」（BR-03 至 BR-06、AC-05 至 AC-08；第二条 = 用户亲手打开的项目当场可写、不重启） |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613855309)，本次不新增验收结论。 |
