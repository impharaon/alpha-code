---
id: SPEC-windows-renderer-origins
title: Windows 界面只能读取受准许的服务来源
summary: Windows 界面只能读取受准许的服务来源，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# Windows 界面只能读取受准许的服务来源

Windows 界面只能读取受准许的服务来源。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-identity/N-03](https://github.com/impharaon/alpha-work/blob/27d104dfb0bb8d36f6d050277255861c4927416c/docs/requests/RQ-identity.md#需求点)。
- 历史身份：[impharaon/alpha-code#229](https://github.com/impharaon/alpha-code/issues/229)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/137)。
- [有效范围或验收依据 2026-08-10](https://github.com/impharaon/alpha-code/issues/229#issuecomment-5239322751)。
- [有效范围或验收依据 2026-09-17](https://github.com/impharaon/alpha-code/issues/229#issuecomment-5708535792)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：本机回环依 CSP 放行；非回环仅登记地址。原 AC3/4/6 删除，没有 Windows 打包实跑。
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

- **BR-01** Windows Renderer 对未登记本地/远端 origin 的读取默认拒绝，不存在 platform-wide blanket bypass。
- **BR-02** 界面读取非本机 origin 的唯一通路是后台进程登记表;界面与扩展无写入口。本机回环端口按内容安全策略放行(已接受形态)。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | Windows Renderer 对未登记本地/远端 origin 的读取默认拒绝，不存在 platform-wide blanket bypass。 | [原票](https://github.com/impharaon/alpha-code/issues/229) · [最后裁决](https://github.com/impharaon/alpha-code/issues/229#issuecomment-5708535792) |
| AC-02 | 界面读取非本机 origin 的唯一通路是后台进程登记表;界面与扩展无写入口。本机回环端口按内容安全策略放行(已接受形态)。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/229) · [最后裁决](https://github.com/impharaon/alpha-code/issues/229#issuecomment-5708535792) |
| AC-03 | ~~登记绑定 service generation 与消费 scope；service 停止、crash、renderer/session 销毁后自动撤销。~~ —— 2026-09-17 删除(owner 裁决):生产代码不向登记表写入任何 origin、回环先于登记表放行,本条对现行代码空转,判不出 PASS/FAIL。 | [原票](https://github.com/impharaon/alpha-code/issues/229) · [最后裁决](https://github.com/impharaon/alpha-code/issues/229#issuecomment-5708535792) |
| AC-04 | ~~同一端口被恶意或新进程复用时，旧登记不能授权新 response；合法服务重启需新 generation 登记。~~ —— 2026-09-17 删除(owner 裁决):同 AC3,端口复用失效对现行代码空转。 | [原票](https://github.com/impharaon/alpha-code/issues/229) · [最后裁决](https://github.com/impharaon/alpha-code/issues/229#issuecomment-5708535792) |
| AC-05 | 拒绝结果可诊断但不暴露 response body、认证头、token 或跨 origin timing detail。 | [原票](https://github.com/impharaon/alpha-code/issues/229) · [最后裁决](https://github.com/impharaon/alpha-code/issues/229#issuecomment-5708535792) |
| AC-06 | ~~Windows packaged matrix 覆盖 arbitrary remote/local server、port reuse、origin rotation、renderer reload 和 sidecar crash。~~ —— 2026-09-17 删除(owner 裁决):没有 Windows 测试机与用户,证据手段不存在。 | [原票](https://github.com/impharaon/alpha-code/issues/229) · [最后裁决](https://github.com/impharaon/alpha-code/issues/229#issuecomment-5708535792) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/229#issuecomment-5708535792)，本次不新增验收结论。 |
