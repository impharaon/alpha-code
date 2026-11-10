---
id: SPEC-custom-provider-keychain
title: 自定义模型密钥由系统安全存储保护
summary: 自定义模型密钥由系统安全存储保护，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 自定义模型密钥由系统安全存储保护

自定义模型密钥由系统安全存储保护。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-identity](https://github.com/impharaon/alpha-work/blob/d4a80d9c2ef0df32c58173310d9e368fa7bc9069/docs/requests/RQ-identity.md)。
- 历史身份：[impharaon/alpha-code#226](https://github.com/impharaon/alpha-code/issues/226)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/137)。
- [有效范围或验收依据 2026-09-17](https://github.com/impharaon/alpha-code/issues/226#issuecomment-5708462906)。
- [有效范围或验收依据 2026-09-17](https://github.com/impharaon/alpha-code/issues/226#issuecomment-5710824141)。
- [有效范围或验收依据 2026-11-09](https://github.com/impharaon/alpha-code/issues/226#issuecomment-6731080627)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：macOS 打包版钥匙串取证在 alpha-code#1660；AC5/8 和 Windows 半场已按裁决删除。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/app/src/context/server.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/context/server.test.ts)
  - [alpha-code:packages/app/src/utils/server.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/utils/server.test.ts)
  - [alpha-code:packages/ui-mac/src/main/codepuppy-byok-keys.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/codepuppy-byok-keys.test.ts)
  - [alpha-code:packages/ui-mac/src/main/codepuppy-models.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/codepuppy-models.test.ts)
  - [alpha-code:packages/ui-mac/src/main/codepuppy-provider-status.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/codepuppy-provider-status.test.ts)
  - [alpha-code:packages/ui-mac/src/main/codepuppy-secret-files.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/codepuppy-secret-files.test.ts)
  - [alpha-code:packages/ui-mac/src/main/custom-provider-truth-write.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/custom-provider-truth-write.test.ts)
  - [alpha-code:packages/ui-mac/src/main/engine-config-truth.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/engine-config-truth.test.ts)

## 业务规则

- **BR-01** 普通配置、receipt、grant 与环境文件中只存在 opaque reference，不存在 provider credential value。
- **BR-02** macOS 打包版的自定义服务密钥由系统钥匙串保护。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 普通配置、receipt、grant 与环境文件中只存在 opaque reference，不存在 provider credential value。 | [原票](https://github.com/impharaon/alpha-code/issues/226) · [最后裁决](https://github.com/impharaon/alpha-code/issues/226#issuecomment-6731080627) |
| AC-02 | macOS 打包版的自定义服务密钥由系统钥匙串保护。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/226) · [最后裁决](https://github.com/impharaon/alpha-code/issues/226#issuecomment-6731080627) |
| AC-03 | renderer、extension 和普通 IPC 不能读取 secret；只有 main-owned provider 调用链可按引用使用。 | [原票](https://github.com/impharaon/alpha-code/issues/226) · [最后裁决](https://github.com/impharaon/alpha-code/issues/226#issuecomment-6731080627) |
| AC-04 | 自定义服务密钥原值离开钥匙串的唯一通路是后台进程按引用解析后注入模型调用;配置文件、界面与日志只见引用或末四位。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/226) · [最后裁决](https://github.com/impharaon/alpha-code/issues/226#issuecomment-6731080627) |
| AC-05 | ~~create/update/delete/rotate 具有原子结果；崩溃或重试不会留下可用旧明文或引用错配。~~ —— 2026-09-17 删除(owner 裁决):增删改轮换的原子性与崩溃恢复在只有 owner 一个用户时收益很小。 | [原票](https://github.com/impharaon/alpha-code/issues/226) · [最后裁决](https://github.com/impharaon/alpha-code/issues/226#issuecomment-6731080627) |
| AC-06 | vault 锁定、损坏、引用缺失或 OS 能力不可用时 provider 调用 fail closed，并提示重新录入/修复。 | [原票](https://github.com/impharaon/alpha-code/issues/226) · [最后裁决](https://github.com/impharaon/alpha-code/issues/226#issuecomment-6731080627) |
| AC-07 | 旧 inline credential 不被自动读取/迁移；配置发现旧值时明确拒绝且不会把值写入日志。 | [原票](https://github.com/impharaon/alpha-code/issues/226) · [最后裁决](https://github.com/impharaon/alpha-code/issues/226#issuecomment-6731080627) |
| AC-08 | ~~macOS/Windows packaged secret matrix 与仓库/产物 secret scan 均无泄漏。~~ —— 2026-09-17 删除(owner 裁决):双系统矩阵与产物扫描是 AC1–AC4 的重述,且 Windows 半边不可执行。 | [原票](https://github.com/impharaon/alpha-code/issues/226) · [最后裁决](https://github.com/impharaon/alpha-code/issues/226#issuecomment-6731080627) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/226#issuecomment-6731080627)，本次不新增验收结论。 |
