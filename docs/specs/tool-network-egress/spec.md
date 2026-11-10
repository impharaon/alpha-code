---
id: SPEC-tool-network-egress
title: 本机工具只连接获准的网络目的地
summary: 本机工具只连接获准的网络目的地，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: draft
version: 0
approved_by: ""
approved_at: ""
owners: [owner]
last_reviewed: 2026-11-10
---

# 本机工具只连接获准的网络目的地

本机工具只连接获准的网络目的地。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-safety/N-02](https://github.com/impharaon/alpha-work/blob/27d104dfb0bb8d36f6d050277255861c4927416c/docs/requests/RQ-safety.md#需求点)。
- 历史身份：[impharaon/alpha-code#1073](https://github.com/impharaon/alpha-code/issues/1073)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/142)。
- [有效范围或验收依据 2026-09-10](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5616341729)。
- [有效范围或验收依据 2026-09-11](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5628427076)。
- [有效范围或验收依据 2026-09-11](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5628434112)。

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

- **BR-01** (单一权威)**:目的地授权集是代理进程读取的一张注册表(代码内单一权威。
- **BR-02** (引擎汇入)**:sidecar env 的 `HTTP(S)_PROXY` 指向同一 chokePort、。

规则据下表原条款摘录；历史删改与后续裁决仍按「用户与范围」限定。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | (唯一通路)**:shell 工具与 prompt `!command` 子进程树的 TCP/UDP 出网,<br>  唯一放行是 loopback 上的策略代理端口 —— wrapper profile 为<br>  `(deny network*)` + `(allow network-outbound (remote ip "localhost:<chokePort>"))`,<br>  **只写加法**(profile 内不得出现 `localhost:*` 通配 allow 或任何端口特定 deny,<br>  判据 = 勘破 §1.3);逃逸语料(直连 raw-IP:443、UDP sendto、`[::1]` 其它端口、<br>  绕代理直连)在同 profile 下全部响亮失败,且每个否定用例自带进程已启动证据<br>  (勘破 §1.2:空输出 ≠ 拦住)。 | [原票](https://github.com/impharaon/alpha-code/issues/1073) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5628434112) |
| AC-02 | (单一权威)**:目的地授权集是代理进程读取的一张注册表(代码内单一权威<br>  模块/文件);CONNECT 到未登记 `host:port` 一律 403 且可观察(结构化日志);<br>  不存在第二张散文清单。 | [原票](https://github.com/impharaon/alpha-code/issues/1073) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5628434112) |
| AC-03 | (引擎汇入)**:sidecar env 的 `HTTP(S)_PROXY` 指向同一 chokePort、<br>  `NO_PROXY` 仅 loopback;引擎的模型请求 / 远程 MCP / models.dev 拉取在代理侧可见。 | [原票](https://github.com/impharaon/alpha-code/issues/1073) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5628434112) |
| AC-04 | (不误伤)**:注册表初值 = 勘破 §2.2 清单;文件轴 §2.8 那组正常开发命令在<br>  **network-deny 底座**上复跑全数通过(勘破 §7 末条:文件轴误伤检查当时用的是<br>  `allow default` 底座)。 | [原票](https://github.com/impharaon/alpha-code/issues/1073) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5628434112) |
| AC-05 | (fail-closed)**:代理不在场时,子进程直连被 seatbelt 即时拒绝(EPERM),<br>  不回退直连。 | [原票](https://github.com/impharaon/alpha-code/issues/1073) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5628434112) |

## 待决

最终 2026-09-10 逐条裁断的 AC3–5 顺序与旧票不同，保留原编号并明确最终判据。仅覆盖引擎进程树；本机模型目的地未开放；没有真实模型调用证明。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 0 | 2026-11-10 | — | 整理历史来源；尚未作为当前批准基线。 |
