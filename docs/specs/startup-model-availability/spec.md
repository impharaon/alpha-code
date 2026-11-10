---
id: SPEC-startup-model-availability
title: 启动时及时出现可用模型且不显示虚假失败
summary: 启动时及时出现可用模型且不显示虚假失败，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 启动时及时出现可用模型且不显示虚假失败

启动时及时出现可用模型且不显示虚假失败。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-models](https://github.com/impharaon/alpha-work/blob/d4a80d9c2ef0df32c58173310d9e368fa7bc9069/docs/requests/RQ-models.md)。
- 历史身份：[impharaon/alpha-code#528](https://github.com/impharaon/alpha-code/issues/528)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/152)。
- [有效范围或验收依据 2026-07-24](https://github.com/impharaon/alpha-code/issues/528#issuecomment-5066478587)。
- [有效范围或验收依据 2026-09-17](https://github.com/impharaon/alpha-code/issues/528#issuecomment-5707648102)。
- [有效范围或验收依据 2026-09-17](https://github.com/impharaon/alpha-code/issues/528#issuecomment-5708484216)。

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

- **BR-01** 稳态冷启动**(安装后第二次及以后启动)至模型目录可操作 **P95 ≤ 30s**(本地目录 + BYOK;平台项在续期未完时显式「登录恢复中」,不阻塞其余)。证明:T7 验证矩阵 + T1 插桩时间线。**样本量 n ≥ 10**。
- **BR-02** 首次启动**(安装后第一次打开)至模型目录可操作 **≤ 30s**。证明:T7 验证矩阵中每个新二进制第一轮的首装样本。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01a | 稳态冷启动**(安装后第二次及以后启动)至模型目录可操作 **P95 ≤ 30s**(本地目录 + BYOK;平台项在续期未完时显式「登录恢复中」,不阻塞其余)。证明:T7 验证矩阵 + T1 插桩时间线。**样本量 n ≥ 10**。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/528) · [最后裁决](https://github.com/impharaon/alpha-code/issues/528#issuecomment-5708484216) |
| AC-01b | 首次启动**(安装后第一次打开)至模型目录可操作 **≤ 30s**。证明:T7 验证矩阵中每个新二进制第一轮的首装样本。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/528) · [最后裁决](https://github.com/impharaon/alpha-code/issues/528#issuecomment-5708484216) |
| AC-02 | 启动/恢复瞬态永不呈现「当前不可用」;只有 loading/recovering 与真实失败两种语义。证明:B′ 状态机单测 + L2 截图(状态呈现变更时)。 | [原票](https://github.com/impharaon/alpha-code/issues/528) · [最后裁决](https://github.com/impharaon/alpha-code/issues/528#issuecomment-5708484216) |
| AC-03 | 目录**就绪事件到达**与首次模型请求发起的间隔 ≤ ~100ms,且无 1–8s 退避残留。证明:#882 的间隔判据(冻结兜底定时器,断言事件推动的探针发生在任何 tick 之前)。 | [原票](https://github.com/impharaon/alpha-code/issues/528) · [最后裁决](https://github.com/impharaon/alpha-code/issues/528#issuecomment-5708484216) |
| AC-04 | 快续期路径单次 fork;慢续期路径 ≤ 1 fork + 1 换血,且换血不整页 reload(renderer mount 保持 1)。证明:#859 确定性计数测试 + #858 打包实测(mounts=1、reloads=0)。 _(2026-09-17 按 owner 裁决改写,原文见编辑历史)_ | [原票](https://github.com/impharaon/alpha-code/issues/528) · [最后裁决](https://github.com/impharaon/alpha-code/issues/528#issuecomment-5708484216) |
| AC-05 | account summary 不再门控本地 model.list(并行解耦);账户只门控平台 entitlement 与发送准入。证明:接线测试(从首页链断言并行)。 | [原票](https://github.com/impharaon/alpha-code/issues/528) · [最后裁决](https://github.com/impharaon/alpha-code/issues/528#issuecomment-5708484216) |
| AC-06 | 非 alpha 治理面的 MCP(如 opencode CLI 全局配置)不参与 alpha 启动:注入面 default-deny + mcp 连接超时防御值。证明:注入单测 + 真机实例 bootstrap 时长对比。 | [原票](https://github.com/impharaon/alpha-code/issues/528) · [最后裁决](https://github.com/impharaon/alpha-code/issues/528#issuecomment-5708484216) |
| AC-07 | 不得把未验证的过期平台 token 标成可用。证明:B′ 状态机单测。 | [原票](https://github.com/impharaon/alpha-code/issues/528) · [最后裁决](https://github.com/impharaon/alpha-code/issues/528#issuecomment-5708484216) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/528#issuecomment-5708484216)，本次不新增验收结论。 |
