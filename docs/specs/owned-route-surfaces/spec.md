---
id: SPEC-owned-route-surfaces
title: 应用页面通过受控入口接入导航
summary: 应用页面通过受控入口接入导航，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 应用页面通过受控入口接入导航

应用页面通过受控入口接入导航。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-desktop/N-03](https://github.com/impharaon/alpha-work/blob/27d104dfb0bb8d36f6d050277255861c4927416c/docs/requests/RQ-desktop.md#需求点)。
- 历史身份：[impharaon/alpha-code#199](https://github.com/impharaon/alpha-code/issues/199)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/149)。
- [有效范围或验收依据 2026-07-12](https://github.com/impharaon/alpha-code/issues/199#issuecomment-4950774530)。
- [有效范围或验收依据 2026-07-14](https://github.com/impharaon/alpha-code/issues/199#issuecomment-4965540491)。
- [有效范围或验收依据 2026-09-17](https://github.com/impharaon/alpha-code/issues/199#issuecomment-5708444871)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/app/src/components/settings-v2/index.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/app/src/components/settings-v2/index.tsx)
  - [alpha-code:packages/console/app/src/routes/bench/index.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/src/routes/bench/index.tsx)
  - [alpha-code:packages/console/app/src/routes/black/index.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/src/routes/black/index.tsx)
  - [alpha-code:packages/console/app/src/routes/brand/index.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/src/routes/brand/index.tsx)
  - [alpha-code:packages/console/app/src/routes/changelog/index.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/src/routes/changelog/index.tsx)
  - [alpha-code:packages/console/app/src/routes/download/index.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/src/routes/download/index.tsx)
  - [alpha-code:packages/console/app/src/routes/enterprise/index.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/src/routes/enterprise/index.tsx)
  - [alpha-code:packages/console/app/src/routes/go/index.tsx](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/src/routes/go/index.tsx)

## 业务规则

- **BR-01** Home、New Session 与 Session 可分别通过窄 typed surface 注入，未被选择的叶页面不会同时挂载或预载。
- **BR-02** typed surface 只暴露 Alpha 所需 props/events，不泄漏 upstream 私有 context 类型。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | Home、New Session 与 Session 可分别通过窄 typed surface 注入，未被选择的叶页面不会同时挂载或预载。 | [原票](https://github.com/impharaon/alpha-code/issues/199) · [最后裁决](https://github.com/impharaon/alpha-code/issues/199#issuecomment-5708444871) |
| AC-02 | typed surface 只暴露 Alpha 所需 props/events，不泄漏 upstream 私有 context 类型。 | [原票](https://github.com/impharaon/alpha-code/issues/199) · [最后裁决](https://github.com/impharaon/alpha-code/issues/199#issuecomment-5708444871) |
| AC-03 | server、directory、draft 与 session 的 remount 规则在 Web Router 与桌面 MemoryRouter 中保持确定且一致。 | [原票](https://github.com/impharaon/alpha-code/issues/199) · [最后裁决](https://github.com/impharaon/alpha-code/issues/199#issuecomment-5708444871) |
| AC-04 | 生产 route 入口直接调用 seam；Alpha 页面不存在对 upstream 隐藏 DOM、Portal anchor 或私有 context 的旁路依赖。 | [原票](https://github.com/impharaon/alpha-code/issues/199) · [最后裁决](https://github.com/impharaon/alpha-code/issues/199#issuecomment-5708444871) |
| AC-05 | 上游前端版本升级(滚动 pin)后,若 Alpha 依赖的页面接缝形状发生变化,本地检查失败,而不是静默通过。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/199) · [最后裁决](https://github.com/impharaon/alpha-code/issues/199#issuecomment-5708444871) |
| AC-06 | legacy surface flag、fatal 后 legacy reload 与双 composition 路径被移除；失败显示可恢复错误但不切回旧页面。 | [原票](https://github.com/impharaon/alpha-code/issues/199) · [最后裁决](https://github.com/impharaon/alpha-code/issues/199#issuecomment-5708444871) |
| AC-07 | ~~#204 接管 route manifest 后，本 seam 仍只是叶页面挂载接口，不形成第二套路由真相。~~ —— 2026-09-17 删除(owner 裁决):与 REQ-089(alpha-code#204)AC2「不存在第二套路由真相」重复,证据已由该需求的 route-authority-ratchet 承载。 | [原票](https://github.com/impharaon/alpha-code/issues/199) · [最后裁决](https://github.com/impharaon/alpha-code/issues/199#issuecomment-5708444871) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/199#issuecomment-5708444871)，本次不新增验收结论。 |
