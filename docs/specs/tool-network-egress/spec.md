---
id: SPEC-tool-network-egress
title: 本机工具只连接获准的网络目的地
summary: 本机工具只连接获准的网络目的地，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 3
approved_by: owner
approved_at: 2026-11-27
owners: [owner]
last_reviewed: 2026-11-27
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
- v2 增量的来源：impharaon/alpha-work `docs/intents/INT-safety.md` I-43、I-44。owner 2026-11-25 原话：对「「全部批准」档是否覆盖联网」「记住的单位是否从单个地址放宽到整个站点」「是否要「仅此项目」范围」答「前两个都同意， 不要仅此项目的范围。」（U-28）；对是否授权形成规格答「确认。」（U-29）；对其余已授权的规格答「按照你的建议即可」（U-35）。用户批准联网这件事此前只写在 `docs/design/2026-09-23-model-chosen-egress-baseline.md` 里，没有规格；该设计 §3 的 G（不放开全部公网目的地）是 owner 当时的裁决，v2 的 BR-05 按 owner 的新裁决只对「全部批准」档放开。BR-09、BR-10 出自讨论记录 P-04、P-05，owner 2026-11-25 答「纳入」；对整份 v2 答「批准」（U-36）。
- v3 增量的来源：impharaon/alpha-work `docs/intents/INT-safety.md` I-46（alpha-code#1757 设计审查 R1 发现）。v2 把批准卡片改到对话里以后，没有对话在运行工具时，连接器或语言服务发起的名单外联网没有对话可以出卡片，只能等待后失败；v2 之前这种情况会弹系统对话框，用户选「记住」后就一直能用，所以这是少了一项能力。owner 2026-11-27 对 I-46 的建议「补上，卡片显示在用户当前正在看的对话里」答「intent 全部按照你的建议。」（U-43）。BR-11、AC-14 只按这个方向写。

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
- **BR-04**（v2）名单外的联网由用户在对话里决定：助手的某一步要连接名单外的地址时，对话里出现一张批准卡片，写明要连接的地址，不再弹出系统对话框。能确定是哪一步发起的，卡片出现在那次对话里并写明那一步；确定不了时，卡片出现在当时正在运行工具的每个对话里，并写明无法确定发起方。卡片上的选择是：允许（到应用退出为止）、允许并记住这个站点、拒绝。用户决定之前这次连接等待；无人决定时这次连接失败并说明原因 —— INT-safety I-43。
- **BR-05**（v2）「全部批准」档覆盖联网：只有「全部批准」档的对话在运行工具时，名单外的公网地址直接放行，不出现卡片，每次放行记一笔。同时有其它档的对话在运行工具、分不清是谁发起时，照常出现卡片。回环与内网地址不在此列，沿用现有规则 —— INT-safety I-43（U-28）。
- **BR-06**（v2）记住按站点：用户选「允许并记住」后，这个站点（主域名及其子域名，端口不限）不再询问。主域名按公共后缀表判定；托管平台上各用户各自的子域名各算一个站点 —— INT-safety I-44（U-28）。
- **BR-07**（v2）记住的批准记在用户一级，由应用保管：所有项目共用，没有「仅此项目」的范围；不写进任何项目文件夹，对话里的命令和工具改不了它 —— INT-safety I-44（U-28）。
- **BR-08**（v2）设置里有一张清单：列出记住的站点和「全部批准」档下放行过的地址；记住的站点可以逐条撤销，撤销立即生效，不需要重启应用 —— INT-safety I-44。
- **BR-09**（v2）助手知道围栏的存在：联网被拒绝或在等用户决定时，助手得到一句说明（这是应用的联网保护，不是电脑的网络故障），不再去排查网络 —— 讨论 P-04；owner 2026-11-25「纳入」。
- **BR-10**（v2）应用的代理跟随系统代理：电脑设置了系统代理时，对话里的联网经它出去；没有设置时与现在相同 —— 讨论 P-05；owner 2026-11-25「纳入」。
- **BR-11**（v3）没有对话在运行工具时也能批准：连接器或语言服务在应用启动时或空闲时要连接名单外的地址、此时没有任何对话在运行工具，批准卡片出现在用户当前正看着的对话里。卡片写明地址，并说明此时没有对话在运行工具、可能是连接器或语言服务在后台联网；选择和 BR-04 相同，没有其它步骤。等待期间用户切到另一个对话，卡片也出现在那里，在哪里决定都算同一次。用户没有在看任何对话时，不出现卡片，也不弹系统对话框，这次连接在等待期满后失败（与 v2 相同）；期满之前打开任何一个对话，卡片就出现在那里。已记住的站点照常直接连接 —— INT-safety I-46（U-43）。

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
| AC-07 | Given 围栏在线，「请求审批」档的一个对话；When 助手运行一条连接名单外地址的命令；Then 这个对话里出现批准卡片，写明地址，屏幕上没有系统对话框。点「允许（到应用退出为止）」后同一条命令重试成功；点「拒绝」后命令失败并显示被拒绝的原因；无人决定到期后命令失败并显示原因。When 两个对话同时在运行工具；Then 卡片在两个对话里都出现，并写明无法确定发起方。<br>*拿什么证明*：真引擎、真围栏用例与界面用例；去掉卡片通路的对照臂里没有卡片。 | BR-04 |
| AC-08 | Given 只有一个「全部批准」档的对话在运行工具；When 命令连接名单外的公网地址；Then 直接成功，没有卡片，设置的清单里多一条放行记录。Given 同时还有一个「请求审批」档的对话在运行工具；When 同样的连接；Then 出现卡片。Given 目标是回环或内网地址；Then 不放行。<br>*拿什么证明*：真引擎、真围栏用例三条；把档位判断去掉的对照臂里第一条出现卡片。 | BR-05 |
| AC-09 | Given 用户对 `a.example.com` 选了「允许并记住」；When 之后连接 `b.example.com`、`example.com` 的另一个端口；Then 都不再询问。When 连接另一个站点；Then 仍询问。Given 托管平台上记住了一个用户的子域名；When 连接同平台另一个用户的子域名；Then 仍询问。When 重启应用；Then 记住的站点仍然有效。<br>*拿什么证明*：站点判定的用例（含公共后缀表里的托管平台样本）与一条重启后的真引擎用例。 | BR-06 |
| AC-10 | Given 用户记住了一个站点；Then 任何项目文件夹里没有新增或改动的文件。When 对话里的命令或工具试图改写保存这些批准的位置；Then 被拒绝，记录不变。<br>*拿什么证明*：真围栏用例；去掉保护的对照臂里记录被改写。 | BR-07 |
| AC-11 | Given 设置的清单里有一个记住的站点；When 用户撤销它；Then 不重启应用，下一次连接这个站点重新询问。<br>*拿什么证明*：界面用例加真引擎用例。 | BR-08 |
| AC-12 | Given 一次联网被拒绝或在等用户决定；Then 交给助手的结果里带有那句说明，并登记在上下文注入清单里。<br>*拿什么证明*：注入清单的用例；去掉注入的对照臂里说明不出现。 | BR-09 |
| AC-13 | Given 系统代理指向一个本机的测试代理；When 对话里连接一个只有经它才能到达的地址；Then 成功，测试代理记录到这次连接。Given 没有系统代理；Then 行为与现在相同。<br>*拿什么证明*：真引擎用例，测试代理记录连接。 | BR-10 |
| AC-14 | Given 围栏在线，没有对话在运行工具，用户正看着「请求审批」档的对话 A；When 一个连接器连接名单外的地址；Then A 里出现批准卡片，写明地址和「此时没有对话在运行工具」，屏幕上没有系统对话框。点「允许（到应用退出为止）」后，等待中的这次连接成功；连接器之后再连这个地址成功，不再出卡片。When 卡片还在等待时用户切到对话 B；Then B 里也出现这张卡片，在 B 里决定后 A 里不再能选。Given 用户没有在看任何对话；When 同样的连接；Then 不出现卡片也没有系统对话框，等待期满后这次连接失败并记录原因。<br>*拿什么证明*：真引擎、真围栏用例：引擎自己启动的连接器在没有对话运行工具时发起连接，界面用例挂着正看着的对话；去掉「投到正看着的对话」的对照臂里没有卡片，连接以原因失败。 | BR-11 |

证据与适用边界：2026-09-10 最终五项逐条 PASS，47/0 打包形态检查、两提供商缓存各 26 包、12/12 开发命令和变异证据齐备。范围是 sidecar 全进程树，不包括 Electron main/renderer；本机模型目的地未放开；未发生真实模型调用，未据此扩大承诺。旧 AC-03 合并到 AC-01/04，最终新增进程边界记为 AC-06，原编号不复用。

## 用户会碰到的限制

- （v2）「全部批准」档下，助手可以连接任意公网地址而不先问，内容可能被发到任何地方；事后可以在设置里看到连过哪些地址。依据 owner 2026-11-25「前两个都同意」。
- （v2）同时开着不同档位的对话、并且都在运行工具时，「全部批准」档的对话也可能出现联网卡片，因为分不清是谁发起的。
- （v2）记住一个站点后，它的全部子域名和端口都不再询问。放宽到站点依据 owner 2026-11-25「前两个都同意」；端口不限 owner 2026-11-25「接受」。
- （v2）用户迟迟不决定时，助手这一步的联网会先失败；批准之后让助手重试。
- （v3）连接器或语言服务在后台联网时，如果用户没有打开任何对话，这次连接等待期满后失败（与 v2 相同）；打开对话后在卡片里允许，下一次连接直接通过。
- （v2）Windows 没有联网围栏，卡片、记住和清单在 Windows 上都不出现；Windows 包发布时核对界面上没有无效的入口。依据 owner 2026-11-25「还需要考虑 windows 系统」。

## 待决

v2（BR-04 至 BR-10、AC-07 至 AC-13 与「用户会碰到的限制」）已由 owner 于 2026-11-25 批准。主进程今天既不能向对话里发批准卡片，也不知道每个对话的档位，做法在技术设计里定；做不到「确定是哪一步」的情形已按 BR-04 后半句写明。v3（BR-11、AC-14 与「用户会碰到的限制」新增一行）按 owner 2026-11-27 对 I-46 的决定写成，主进程怎样知道用户正看着哪个对话在技术设计里定。上述历史批准继续有效。规格批准不等于实现、部署或验收完成，尚缺证据与实施工作由来源中的交付入口负责。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 0 | 2026-11-10 | — | 整理历史来源；尚未作为当前批准基线。 |
| 1 | 2026-11-12 | backfill | 按 owner 历史补录授权重建已交付行为；不是新的产品决定。[依据](https://github.com/impharaon/alpha-code/issues/1073#issuecomment-5628434112)。 |
| 2 | 2026-11-25 | owner | 对「这份规格是否批准」答「批准」，对「第 6、7 条是否一并纳入」答「纳入」，对「「端口不限」是否接受」答「接受。」（alpha-work INT-safety U-36；形成规格的授权 U-29「确认。」）。 自查：Claude Fable 5.2，BR-04 至 BR-10 与 AC-07 至 AC-13 一一对应；遗留：无。 |
| 3 | 2026-11-27 | owner | 对 I-46 的建议「补上，卡片显示在用户当前正在看的对话里」答「intent 全部按照你的建议。」（alpha-work INT-safety U-43）。v3 只按这个方向新增 BR-11、AC-14 和限制里的一行，条文没有另请 owner 逐字审阅。自查：Claude Opus 5.5，BR-11 与 AC-14 一一对应，没有新增卡片以外的用户步骤；遗留：无。 |
