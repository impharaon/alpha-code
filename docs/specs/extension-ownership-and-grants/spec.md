---
id: SPEC-extension-ownership-and-grants
title: 扩展来源与授权范围可准确判断和管控
summary: 扩展来源与授权范围可准确判断和管控，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 扩展来源与授权范围可准确判断和管控

扩展来源与授权范围可准确判断和管控。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-extensions/N-08](https://github.com/impharaon/alpha-work/blob/27d104dfb0bb8d36f6d050277255861c4927416c/docs/requests/RQ-extensions.md#需求点)。
- 历史身份：[impharaon/alpha-code#212](https://github.com/impharaon/alpha-code/issues/212)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/138)。
- [有效范围或验收依据 2026-07-19](https://github.com/impharaon/alpha-code/issues/212#issuecomment-5014910662)。
- [有效范围或验收依据 2026-07-19](https://github.com/impharaon/alpha-code/issues/212#issuecomment-5015191929)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。

## 业务规则

- **BR-01** 每个 extension 的 authored、curated、distributed、runtime surface 与 support tier 分别可读，不把 curated 误显示为 authored。
- **BR-02** cached、installed-disabled、enabled、healthy、revoked/quarantined 状态来自权威 receipt/runtime facts，不由 UI 猜测。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | 每个 extension 的 authored、curated、distributed、runtime surface 与 support tier 分别可读，不把 curated 误显示为 authored。 | [原票](https://github.com/impharaon/alpha-code/issues/212) · [最后裁决](https://github.com/impharaon/alpha-code/issues/212#issuecomment-5015191929) |
| AC-02 | cached、installed-disabled、enabled、healthy、revoked/quarantined 状态来自权威 receipt/runtime facts，不由 UI 猜测。 | [原票](https://github.com/impharaon/alpha-code/issues/212) · [最后裁决](https://github.com/impharaon/alpha-code/issues/212#issuecomment-5015191929) |
| AC-03 | 每个 grant 绑定主体、global/project scope、capability、资源约束和有效期；scope-less 或未知 capability fail closed。 | [原票](https://github.com/impharaon/alpha-code/issues/212) · [最后裁决](https://github.com/impharaon/alpha-code/issues/212#issuecomment-5015191929) |
| AC-04 | 新版本增加 capability 时必须重新确认；拒绝后不会静默扩大权限或破坏旧版本事实。 | [原票](https://github.com/impharaon/alpha-code/issues/212) · [最后裁决](https://github.com/impharaon/alpha-code/issues/212#issuecomment-5015191929) |
| AC-05 | global/project 同名条目可分别查看、启停、授权和撤销，状态不会串 scope。 | [原票](https://github.com/impharaon/alpha-code/issues/212) · [最后裁决](https://github.com/impharaon/alpha-code/issues/212#issuecomment-5015191929) |
| AC-06 | extension 注册 Alpha 顶级 route、覆盖 Session/Settings 或获取主 renderer bridge 的请求被拒绝。 | [原票](https://github.com/impharaon/alpha-code/issues/212) · [最后裁决](https://github.com/impharaon/alpha-code/issues/212#issuecomment-5015191929) |
| AC-07 | ownership、grant diff、状态 badge 与关键动作具备键盘、读屏和错误恢复语义。 | [原票](https://github.com/impharaon/alpha-code/issues/212) · [最后裁决](https://github.com/impharaon/alpha-code/issues/212#issuecomment-5015191929) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/212#issuecomment-5015191929)，本次不新增验收结论。 |
