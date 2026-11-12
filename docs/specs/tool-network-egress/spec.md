---
id: SPEC-tool-network-egress
title: 本机工具只连接获准的网络目的地
summary: 本机工具只连接获准的网络目的地，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-12
owners: [owner]
last_reviewed: 2026-11-12
---

# 本机工具只连接获准的网络目的地

本机工具只连接获准的网络目的地。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [意图与处置 impharaon/alpha-work:INT-safety/I-02](https://github.com/impharaon/alpha-work/blob/de325762131253b18e9b65227e366f60a2f39ebe/docs/intents/INT-safety.md#意图点)。
- 历史身份：[impharaon/alpha-code#1073](https://github.com/impharaon/alpha-code/issues/1073)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/142)。
- [有效范围或验收依据 2026-09-10](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5616341729)。
- [有效范围或验收依据 2026-09-11](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5628427076)。
- [有效范围或验收依据 2026-09-11](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5628434112)。

- [批准/事实依据](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5628434112)。
- 交付入口：[alpha-code#1073](https://github.com/impharaon/alpha-code/issues/1073)；实现与验收状态由这些票及其原生子票持有。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：最终 2026-09-10 逐条裁断的 AC3–5 顺序与旧票不同，保留原编号并明确最终判据。仅覆盖引擎进程树；本机模型目的地未开放；没有真实模型调用证明。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/desktop/src/main/sidecar.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/desktop/src/main/sidecar.ts)
  - [alpha-code:packages/desktop/src/main/wsl/sidecar.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/desktop/src/main/wsl/sidecar.ts)
  - [alpha-code:packages/ui-mac/src/main/network-egress-registry.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/network-egress-registry.ts)
  - [alpha-code:packages/ui-mac/src/main/sidecar.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/sidecar.ts)
  - [alpha-code:packages/ui-mac/src/main/wsl/sidecar.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/main/wsl/sidecar.ts)
  - [alpha-code:packages/ui-mac/src/shared/ext-capability-authorization.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/ui-mac/src/shared/ext-capability-authorization.ts)
  - [alpha-code:scripts/assert-module-size.sh](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/scripts/assert-module-size.sh)

## 业务规则

- **BR-01** 目的地由策略代理的单一注册表授权，未知 host:port 被明确拒绝。
- **BR-02** 出网围栏覆盖 sidecar 及全部派生进程；Electron main 与 renderer 在围栏外，产品说明必须如实表述。
- **BR-03** 代理不可用时响亮失败，不回退直接连接；允许的正常开发命令在同一围栏下仍可执行。

## 验收

按 2026-09-10 已批准的进程围栏重写恢复最终义务；稳定编号映射：历史最终 AC1/2/3/4/5 → 本规格 AC-01/02/04/05/06。旧 AC-03 标为合并，不把新边界复用为旧编号。[旧规格 v0](https://github.com/impharaon/alpha-code/blob/e5a63bf3852ecf0c1d5b7e53be96fade954deed9/docs/specs/tool-network-egress/spec.md) 保留原文。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | sidecar 及其全部派生进程（shell、!command、MCP stdio、LSP、PTY）的 TCP/UDP 出网仅放行 loopback 策略代理端口；进程围栏使用加法允许规则，所需本机 bind/inbound 明确列入。raw IP、UDP、IPv6 其他端口及绕过代理的逃逸用例均响亮失败，并有进程实际启动的 PID 证据。 | [最终 AC 与关闭证据](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5628434112) |
| AC-02 | 目的地授权集由策略代理读取一张注册表；未登记 host:port 的 CONNECT 请求一律拒绝并可观察，平台域名引用既有 ALPHA_ENDPOINTS 权威。 | [最终 AC 与关闭证据](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5628434112) |
| AC-03 | 已合并、不复用：旧「引擎经代理汇入」判据按 2026-09-10 已批重写并入 AC-01 与 AC-04；不继续要求被删除的 wrapper 或用真实模型调用冒充全部网络边界。 | [最终 AC 与关闭证据](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5628434112) |
| AC-04 | 已批准的正常开发命令在 network-deny 底座上全部通过；两个提供商的依赖缓存验证实际安装软件包，不能以健康端点返回 200 代替。对应历史最终 AC3。 | [最终 AC 与关闭证据](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5628434112) |
| AC-05 | 策略代理不在场时，调用快速、响亮失败，子进程不回退直连，也不等待原有长时间挂起。对应历史最终 AC4。 | [最终 AC 与关闭证据](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5628434112) |

| AC-06 | 仅 sidecar 进程树受围栏约束；Electron main 的目录、登录、自动更新及 renderer 在边界之外。用户说明如实披露，声称「整个应用网络都已隔离」的反向检查必须失败。对应历史最终 AC5。 | [最终 AC 与关闭证据](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5628434112) |

证据与适用边界：2026-09-10 最终五项逐条 PASS，47/0 打包形态检查、两提供商缓存各 26 包、12/12 开发命令和变异证据齐备。范围是 sidecar 全进程树，不包括 Electron main/renderer；本机模型目的地未放开；未发生真实模型调用，未据此扩大承诺。旧 AC-03 合并到 AC-01/04，最终新增进程边界记为 AC-06，原编号不复用。

## 待决

无新的需求批准事项；上述历史批准继续有效。规格批准不等于实现、部署或验收完成，尚缺证据与实施工作由来源中的交付入口负责。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 0 | 2026-11-10 | — | 整理历史来源；尚未作为当前批准基线。 |
| 1 | 2026-11-12 | backfill | 按 owner 历史补录授权重建已交付行为；不是新的产品决定。[依据](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5628434112)。 |
