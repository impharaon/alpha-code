---
id: SPEC-child-process-write-fence
title: 连接器与语言服务的子进程也受写入范围约束
summary: 连接器与语言服务的子进程也受写入范围约束，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 连接器与语言服务的子进程也受写入范围约束

连接器与语言服务的子进程也受写入范围约束。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-safety/N-06](https://github.com/impharaon/alpha-work/blob/27d104dfb0bb8d36f6d050277255861c4927416c/docs/requests/RQ-safety.md#需求点)。
- 历史身份：[impharaon/alpha-code#1286](https://github.com/impharaon/alpha-code/issues/1286)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/142)。
- [有效范围或验收依据 2026-09-10](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5612150393)。
- [有效范围或验收依据 2026-09-10](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613792565)。
- [有效范围或验收依据 2026-09-10](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613855309)。

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

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 「工具/引擎派生的进程真正落盘」的通路被枚举成一份**单一权威**(不是散文清单);每条通路要么经围栏,要么在闸上被显式点名为已知豁免并写明理由。新增一条未登记的派生通路 ⇒ 闸红。<br>*将来拿什么证明*:枚举来源的判据测试 + 一条反向用例(新增未登记通路必须红)。 | [原票](https://github.com/impharaon/alpha-code/issues/1286) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613855309) |
| AC-02 | MCP stdio 派生的进程越界写入失败,而不是静默成功。<br>*将来拿什么证明*:正反两跑的真 `sandbox-exec` 语料(与 REQ-138 `#1076` 同形态)。 | [原票](https://github.com/impharaon/alpha-code/issues/1286) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613855309) |
| AC-03 | LSP 派生的进程同 AC2。 | [原票](https://github.com/impharaon/alpha-code/issues/1286) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613855309) |
| AC-04 | 平台边界如实声明:非 darwin 平台不假装有围栏,该状态在产品面可观察。<br>*将来拿什么证明*:平台分档的判据测试(`shell-sandbox.ts:191` 已有先例)。 | [原票](https://github.com/impharaon/alpha-code/issues/1286) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613855309) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/1286#issuecomment-5613855309)，本次不新增验收结论。 |
