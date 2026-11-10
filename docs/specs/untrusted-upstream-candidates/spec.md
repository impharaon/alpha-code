---
id: SPEC-untrusted-upstream-candidates
title: 上游候选代码无法取得仓库推送凭据
summary: 上游候选代码无法取得仓库推送凭据，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 上游候选代码无法取得仓库推送凭据

上游候选代码无法取得仓库推送凭据。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-engineering/N-04](https://github.com/impharaon/alpha-work/blob/27d104dfb0bb8d36f6d050277255861c4927416c/docs/requests/RQ-engineering.md#需求点)。
- 历史身份：[impharaon/alpha-code#227](https://github.com/impharaon/alpha-code/issues/227)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/154)。
- [有效范围或验收依据 2026-08-10](https://github.com/impharaon/alpha-code/issues/227#issuecomment-5239321162)。
- [有效范围或验收依据 2026-09-17](https://github.com/impharaon/alpha-code/issues/227#issuecomment-5708528404)。

## 用户与范围

- 用户：维护与升级应用、服务的人员。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：AC2/7 按现状验收：候选包+清单+运行日志，没有单独 diff 文本或令牌身份记录；原 AC6 删除。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:.github/actions/setup-bun/action.yml](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/.github/actions/setup-bun/action.yml)
  - [alpha-code:.github/actions/setup-git-committer/action.yml](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/.github/actions/setup-git-committer/action.yml)
  - [alpha-code:.github/workflows/docs-locale-sync.yml](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/.github/workflows/docs-locale-sync.yml)
  - [alpha-code:.github/workflows/nix-hashes.yml](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/.github/workflows/nix-hashes.yml)
  - [alpha-code:.github/workflows/sync-upstream-push.yml](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/.github/workflows/sync-upstream-push.yml)
  - [alpha-code:.github/workflows/sync-upstream.yml](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/.github/workflows/sync-upstream.yml)
  - [alpha-code:github/action.yml](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/github/action.yml)
  - [alpha-code:packages/ui-mac/src/main/north-star-guard.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/north-star-guard.test.ts)

## 业务规则

- **BR-01** 未审查上游代码只在无仓库写 secret/permission 且 checkout 不持久凭据的 candidate job 中执行。
- **BR-02** candidate 输出包含 base/head、完整 diff、文件状态、检查结果与不可变 digest，可供独立审核。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 未审查上游代码只在无仓库写 secret/permission 且 checkout 不持久凭据的 candidate job 中执行。 | [原票](https://github.com/impharaon/alpha-code/issues/227) · [最后裁决](https://github.com/impharaon/alpha-code/issues/227#issuecomment-5708528404) |
| AC-02 | candidate 输出包含 base/head、完整 diff、文件状态、检查结果与不可变 digest，可供独立审核。 | [原票](https://github.com/impharaon/alpha-code/issues/227) · [最后裁决](https://github.com/impharaon/alpha-code/issues/227#issuecomment-5708528404) |
| AC-03 | 推送是独立工作流,只在候选工作流成功后运行,不执行上游代码;推送凭据只在推送步骤配置,推送的提交哈希必须等于候选产物清单。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/227) · [最后裁决](https://github.com/impharaon/alpha-code/issues/227#issuecomment-5708528404) |
| AC-04 | ownership guard、restore、生成检查与 required smoke 全部在 push 前通过；失败不会更新目标 branch。 | [原票](https://github.com/impharaon/alpha-code/issues/227) · [最后裁决](https://github.com/impharaon/alpha-code/issues/227#issuecomment-5708528404) |
| AC-05 | 上游路径下的修改、删除、改名由 north-star 守卫拦截;新增文件按 ADR-035/038 放行。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/227) · [最后裁决](https://github.com/impharaon/alpha-code/issues/227#issuecomment-5708528404) |
| AC-06 | ~~恶意 workflow/package/install fixture 不能读取 push credential、修改批准 artifact 或绕过 guard。~~ —— 2026-09-17 删除(owner 裁决):演练要先造演练装置,而「上游代码偷推送权限」已由两段工作流结构性隔离。 | [原票](https://github.com/impharaon/alpha-code/issues/227) · [最后裁决](https://github.com/impharaon/alpha-code/issues/227#issuecomment-5708528404) |
| AC-07 | 审批、candidate digest、token subject、检查与 push 结果可审计，但日志不含 token/secret。 | [原票](https://github.com/impharaon/alpha-code/issues/227) · [最后裁决](https://github.com/impharaon/alpha-code/issues/227#issuecomment-5708528404) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/227#issuecomment-5708528404)，本次不新增验收结论。 |
