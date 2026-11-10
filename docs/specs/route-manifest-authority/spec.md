---
id: SPEC-route-manifest-authority
title: 应用导航由一份页面清单决定
summary: 应用导航由一份页面清单决定，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 应用导航由一份页面清单决定

应用导航由一份页面清单决定。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-desktop](https://github.com/impharaon/alpha-work/blob/d4a80d9c2ef0df32c58173310d9e368fa7bc9069/docs/requests/RQ-desktop.md)。
- 历史身份：[impharaon/alpha-code#204](https://github.com/impharaon/alpha-code/issues/204)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/149)。
- [有效范围或验收依据 2026-08-25](https://github.com/impharaon/alpha-code/issues/204#issuecomment-5406359755)。
- [有效范围或验收依据 2026-08-25](https://github.com/impharaon/alpha-code/issues/204#issuecomment-5406362530)。
- [有效范围或验收依据 2026-09-17](https://github.com/impharaon/alpha-code/issues/204#issuecomment-5708480687)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/ui-mac/src/main/ext-security-boundaries.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/ext-security-boundaries.test.ts)
  - [alpha-code:packages/ui-mac/src/renderer/route-composition.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/renderer/route-composition.test.ts)
  - [alpha-code:packages/ui-mac/src/shared/route-authority-ratchet.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/shared/route-authority-ratchet.test.ts)
  - [alpha-code:packages/ui-mac/src/shared/route-deep-link-consumer.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/shared/route-deep-link-consumer.test.ts)
  - [alpha-code:packages/ui-mac/src/shared/route-manifest.test.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/shared/route-manifest.test.ts)
  - [alpha-code:packages/ui-mac/src/shared/route-manifest.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/shared/route-manifest.ts)

## 业务规则

- **BR-01** Home、Draft、Session、Settings 及必要系统页面都有唯一 route ID 和参数 schema，path/query 往返确定。
- **BR-02** Web Router、MemoryRouter、deep link 与所有导航 helper 从同一 manifest 派生，不存在第二套 regex/codec。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | Home、Draft、Session、Settings 及必要系统页面都有唯一 route ID 和参数 schema，path/query 往返确定。 | [原票](https://github.com/impharaon/alpha-code/issues/204) · [最后裁决](https://github.com/impharaon/alpha-code/issues/204#issuecomment-5708480687) |
| AC-02 | Web Router、MemoryRouter、deep link 与所有导航 helper 从同一 manifest 派生，不存在第二套 regex/codec。 | [原票](https://github.com/impharaon/alpha-code/issues/204) · [最后裁决](https://github.com/impharaon/alpha-code/issues/204#issuecomment-5708480687) |
| AC-03 | 每个 route 只组合一个正式 Alpha surface；无双挂载、双 preload 或 Alpha/legacy 竞争 redirect。 | [原票](https://github.com/impharaon/alpha-code/issues/204) · [最后裁决](https://github.com/impharaon/alpha-code/issues/204#issuecomment-5708480687) |
| AC-04 | 非法 directory、缺失参数、未知 route/version 和损坏 deep link 得到确定且 fail-closed 的错误/恢复结果。 | [原票](https://github.com/impharaon/alpha-code/issues/204) · [最后裁决](https://github.com/impharaon/alpha-code/issues/204#issuecomment-5708480687) |
| AC-05 | Home→Draft→Session、Settings/Dialog/Recovery、back/forward/reload 的 route state 不丢失也不串 scope。 | [原票](https://github.com/impharaon/alpha-code/issues/204) · [最后裁决](https://github.com/impharaon/alpha-code/issues/204#issuecomment-5708480687) |
| AC-06 | 第三方 extension 无法注册/覆盖顶级 route；受控扩展入口若存在必须位于明确命名空间并由 #212 授权。 | [原票](https://github.com/impharaon/alpha-code/issues/204) · [最后裁决](https://github.com/impharaon/alpha-code/issues/204#issuecomment-5708480687) |
| AC-07 | `LegacyRouteAbiV1` aliases、手写 href 和旧 surface flags 从生产路径与测试权威中移除。 | [原票](https://github.com/impharaon/alpha-code/issues/204) · [最后裁决](https://github.com/impharaon/alpha-code/issues/204#issuecomment-5708480687) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/204#issuecomment-5708480687)，本次不新增验收结论。 |
