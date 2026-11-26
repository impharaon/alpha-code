---
id: DESIGN-tool-network-egress
title: 对话内联网批准与站点记忆技术设计
summary: 共享策略代理按运行工具集合投递对话卡片，由 main 判定档位、保管站点授权与放行记录，并按系统代理建立上游隧道。
kind: tech-design
status: frozen
spec: SPEC-tool-network-egress
spec_version: 2
review:
  rounds: 1
  reviewed_sha: "85b4f6c8e5"
  verdict: "fix-then-merge; R1 3 Major 4 Minor accepted and corrected"
owners: [owner]
last_reviewed: 2026-11-26
---

# DESIGN-tool-network-egress｜对话内联网批准与站点记忆技术设计

## 1. 基线

- 批准输入：[SPEC-tool-network-egress v2](spec.md)，固定提交 `adba35744395860dcb736642d9263b5d29d1e1de`，取证命令 `git show adba35744395860dcb736642d9263b5d29d1e1de:docs/specs/tool-network-egress/spec.md`。规格批准记录在该文 §批准记录；设计不代表实现或验收完成。
- 本增量：#1757；BR-04..BR-10、AC-07..AC-13 及规格「用户会碰到的限制」。BR-01..BR-03 的代理单一出口与进程围栏继续成立。
- 来源：INT-safety I-43、I-44，讨论 P-01..P-05；协调文档固定输入提交 `c1873d69c12a3dbf472c2c3d2063c367c43b37da`。P-01 的展示上下文不作授权依据、P-02 的 main 真源、P-03 的公网放宽分别落在 §4.1、§4.4、§4.2；P-04/P-05 的最新采纳以规格 v2 为准。
- 体验输入按本次 brief：复用现有组件，不画框架图或新视觉稿。当前规格没有单列名为「体验约定」的小节，故不假称读到了该节；卡片按钮、Windows 隐藏入口和撤销效果直接消费已批条款。
- 旧[模型即时目的地基线](../../design/2026-09-23-model-chosen-egress-baseline.md)中，native dialog、精确地址记住、重启撤销和无公网通放的局部决定由本增量替代；不改写受保护历史稿，也不撤销其中已经接受的网络边界。

## 2. 地面真相

本节代码事实固定在 `9f08c506d9842d319616c7e45c33d3b9c3279e48`。只调查会改变本设计的四个问题：CONNECT 能否归属、main 能否取得真实工具生命周期与档位、真源能否拒写、系统代理接口能否交出原始隧道；下面证据已达到各问题的停止条件。

| 已观察事实 | 证据与本设计的含义 |
| --- | --- |
| 全部 sidecar/子进程使用一个代理地址，没有调用标识；代理只解析 authority | `sidecarEgressProxyEnv`，`packages/ui-mac/src/main/sidecar-env.ts:266`；`startEgressPolicyProxy` 的 CONNECT 入口，`network-egress-proxy.ts:251`。端口或源地址不能证明 session/tool。 |
| 现有授权顺序为查表、询问、拨号；询问默认落 native dialog | `network-egress-proxy.ts:263`；`server.ts:209` 的 `configureEgressGrantApproval`；`egress-approval-dialog.ts:22` 的 `dialog.showMessageBox`。可替换批准通路，保留隧道咽喉。 |
| 现有 45 秒等待、3 个目的地上限和 5 分钟拒绝记忆是三个不同机制 | `network-egress-grants.ts:60`、`:62`、`:64`、`:204`。v2 只授权无人决定的到期失败，不能把后两个限制搬进新卡片。 |
| 公开插件接口有完整调用身份；仅依赖 after hook 不能证明取消时清理 | `packages/plugin/src/promise/tool.ts:38`；`packages/core/src/tool.ts:142` 只把 `Tool.Error` 转入 after 分支。已有 `wrapForDisplay` 在真实 execute 外包一层，`packages/ext/src/policy/display.ts:38`，可复用这条挂载面做 finally。 |
| 引擎运行档现在是会话选择，提交前才切换；UI 的档位不等于任意 agent 的名字 | `selectAgent`，`packages/ui-mac/src/engine-adapter/opencode2/routes.ts:126`、`:339`；`PermMode` / `PERM_AGENT` / `tierAgent`，`renderer/codepuppy-ui/composer-state.ts:36`、`:45`、`:54`，allow 可手选计划或第三方助手。不能在 main 用 `agent === "build"` 猜档位。 |
| main 与 ext 已有进程级双向窄消息通路和换代解绑 | `createHubBridge` / `processParentPort`，`packages/ext/src/hub-bridge.ts:80`、`:226`；`createCodePuppySidecarHost` 的 receive/attach，`main/hub-view.ts:501`、`:519`、`:560`；`main/server.ts:780`。此通路还没有联网生命周期消息，必须 raise。 |
| 自动化的档位与在册身份已有权威；不能把它当作交互的 allow | `AUTOMATION_PROFILES`，`packages/schema/src/codepuppy-unattended.ts:4`；`unattendedRuns.register`，`main/codepuppy-unattended.ts:42`；`createUnattendedState`，`packages/ext/src/policy/unattended.ts:9`。 |
| 后台 shell 不等于工具函数返回 | `packages/core/src/tool/plugin/shell.ts:190` 给 shell 带 `metadata.sessionID`，`:241` 可移入后台；`packages/schema/src/shell.ts:58` 提供 created/exited/deleted 事件。活动集合必须保留尚未退出的 shell。 |
| 用户输入的 `!command` 不经过工具 wrapper | `packages/ui-mac/src/engine-adapter/opencode2/routes.ts:356` 调用 `session.shell`；`packages/core/src/session/shell.ts:13` 直接创建带 `metadata.sessionID` 的 shell。所有带该字段的 shell.created 都是活动来源，不能要求先有 tool 项；R1 纠正原稿遗漏。 |
| 已有用户批准真源位置和原子写，但仅启动装载、没有热撤销 | `resolveEgressGrantTruthLocation`，`main/egress-grant-records.ts:21`；`egressGrantTruthPath`，`main/egress-grant-truth.ts:43`；`writeEgressGrantTruth`，`main/egress-grant-truth-write.ts:22`；`server.ts:199`。复用其 main 写者与状态根，改变授权数据形状和实时判定。 |
| 状态根已有末尾拒写，覆盖一般可写项和临时授权扩展 | `configFenceLocations` 的 CF-1，`main/process-fence-profile.ts:138`；`renderProcessFenceProfile` 在 X1 后调用 `renderConfigFence`，`:252`、`:259`；目录节点保护在 `:275`。仅声称“不在项目里”不足以证明 AC-10。 |
| 会话审批 dock 与模型注入登记已有权威，但现有审批写入作用域不合联网语义 | `SessionComposerDock`，`renderer/codepuppy-ui/session-workspace/session-composer-dock.tsx:227`；`PermissionDialog`，`renderer/codepuppy-ui/PermissionDialog.tsx:53`，其 `createPermissionDecisionCommand` 的 always 要求 projectID（`:43`）。不得用这个 always 假装用户级站点批准。`defineText`、`CONTEXT_INJECTIONS`、`explainToolFailure` 在 `packages/ext/src/context-injection.ts:169`、`:563`、`:663`。 |
| 策略代理只在 darwin 起；Windows 无此围栏 | `main/server.ts:581`；Windows 不安装本设计的客户端入口，不能靠显示一张空清单冒充能力。 |
| Electron 42.3.3 提供路由查询，未提供 raw socket 隧道 | 当前依赖 `packages/ui-mac/package.json`；安装的 `electron/electron.d.ts:13109` 有 `Session.resolveProxy`，`:11636` 有 `mode: "system"`。对该声明执行 `rg 'createConnection'` 零命中。[42.3.3 Session 文档](https://raw.githubusercontent.com/electron/electron/v42.3.3/docs/api/session.md)只承诺返回代理信息。不能把 `resolveProxy` 当拨号函数。 |

**本地小探针（已执行，不代表产品验收）**

临时目录 `…/T/design-egress-v2-u3qso8ri` 中的 `probe.ts` 直接导入上述提交的 `renderProcessFenceProfile`、`admitUserEgressGrant`；输入沿用现有 `egress-grant-truth.test.ts:76` 的生产渲染器输入结构，仅把目录换成临时目录，并刻意让 W1 覆盖整个临时目录。命令为 `bun <临时目录>/probe.ts <本工作树>`，退出 0；子进程是 `/usr/bin/sandbox-exec -p <生产渲染结果> /usr/bin/python3 -c <仅改写临时记录> <记录路径>`，没有启动应用、Electron 或外网连接。

- 去掉 CF 的对照：子进程退出 0，记录改成 `changed`。
- 加 `{kind:"subpath", path:<临时状态根>}`：子进程退出 1，`PermissionError: EPERM`，记录仍为 `before`。证明末尾 CF 能盖住宽的可写项，不能用字符串前缀检查替代该行为。
- 直接调用现有地址准入：`8.8.8.8`、`198.18.1.1`、`a.example.com`、`127.1` 为 true；`127.0.0.1`、`10.0.0.1`、末尾点的 `example.com.`、IPv6 字面量为 false。`127.1` 是旧基线 §5.1 K3′ 已接受的卡片路径缺口；R1 依据 AC-08 单独收紧新增 allow-all 分支，卡片路径不变。

R1 的纯本地数字地址探针：`bun /private/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/egress-r1-probe-07kb1kig/numeric.ts` 退出 0；WHATWG `new URL` 将 `127.1`、`10.1`、`169.254.43518`、`0x7f.1` 分别归一为 `127.0.0.1`、`10.0.0.1`、`169.254.169.254`、`127.0.0.1`，再调用现有 `admitUserEgressGrant` 均为 false；原串均为 true。`198.18.0.1`、`8.8.8.8` 与普通域名正例仍为 true。探针未做 DNS 或网络连接，不能作为解析结果过滤已实现的证据。

公共资料仅读取文档和包元数据：[PSL 原始清单](https://publicsuffix.org/list/public_suffix_list.dat)于 2026-11-26 下载到同一临时目录，SHA-256 `9015c5fa9b4b4953dbd47b9f7811ed1b3a577aee627f50b202dc9b491250a6c8`。其中 `github.io`、`s3.amazonaws.com` 在 PRIVATE 段（行 13942、11941），`*.ck`、`!www.ck` 在行 795、796；这些真实样本是租户隔离和通配/例外规则的来源，不手编平台格式。仓内 `bun.lock` 只有 `tldts-icann`（行 5148），不能满足 PRIVATE；[tldts 文档](https://github.com/remusao/tldts#usage)明确提供 `getDomain(host, {allowPrivateDomains:true})`。读取 `https://registry.npmjs.org/tldts/latest` 得到版本 `7.6.0`，未安装。§4.4 决定升为直接依赖；库在本运行时的行为仍未实跑。

## 4. 接口契约

### 4.1 归属与对话卡片：采用真实的“不知道”

**本增量保留单端口，所有普通 CONNECT 的归属为 unknown。** 不从唯一活跃工具、URL、模型解释、TCP 源端口或进程环境推断“是哪一步”。共享 MCP 连接和后台进程不能按会话切换 env；每会话端口还会扩大围栏唯一出口；代理凭据在同一引擎树中也不构成会话隔离。它们不比规格已批准的回退便宜、正确，故不引入。

每条需要批准的实际 CONNECT 由 main 生成 `requestID`，以收到 CONNECT 时的活动集合（含带 sessionID 的 shell）为初始收件人：去重后的每个 session 都有同一请求的卡片，即使当前没有打开该会话。单个收件人仍写「无法确定发起方」，不声称某一步。卡片源地址只取代理解析的实际 host/port；工具名称只可作为“此时运行中的步骤”的展示，不作为发起证据。活动集合为空或不完整时，连接仍在自身既有 45 秒窗口内 pending，main 随 activity/snapshot 更新把新出现的收件人并入同一请求；已有收件人立即可见，未知时不编造会话、不弹系统框。恢复完整的非空集合时再按 §4.2 判定全 allow；到期仍无可承接会话才以 `approval-unavailable` 失败，有卡无人决定则为 `approval-timeout`。不延长原等待期限，也不另选对话之外的投递目标。

main 对同一 `host:port` 的并发未决连接合并成一个批准请求；收件人为各次 CONNECT 及窗口内新出现活动快照的并集，不让后一次更新覆盖先前收件人。组内每条连接保留自己的 45 秒等待起点，后来的连接不刷新旧连接期限；全部连接过期后新 CONNECT 创建新请求，不把新连接接到已经过期的组。不同目的地不设并发数量上限，不继承旧拒绝记忆。第一个有效决定结算其请求；允许落入授权集合后，main 在同一串行决定点结算所有现已被它覆盖的 pending 请求：本次允许覆盖同一 host:port，记住覆盖该站点的全部子域和端口，成功记住后的其它请求回执标记 remembered=true；记住失败仅按实际已取得的临时精确授权结算。拒绝不扩散到其它请求。被覆盖请求的卡片副本同步 resolved、发布 allowed notice；各连接仍分别检查存活与拨号前授权，不复活过期 socket。并发相反点击返回已有结算结果，不各自执行。卡片在 main 内存中拥有，renderer 重新绑定会话后仍可 list；不持久化待批 socket 或未决卡片。

```ts
type SessionRef = { generation: number; sessionID: string; directory: string }
type Destination = { host: string; port: number }
type EgressDecision = "allow-session" | "allow-persist" | "deny"
type ApprovalState = "pending" | "connection-expired" | "resolved"
type EgressApproval = {
  requestID: string                 // main 随机 UUID；不能由模型指定
  destination: Destination
  site: SiteKey                     // §4.4，main 给出的实际记住范围
  attribution: { kind: "unknown" }
  recipients: SessionRef[]
  createdAt: string                 // UTC ISO-8601
  connectionDeadlineAt: string      // 本组仍存活连接中最晚的等待截止时间
  state: ApprovalState
  decision?: EgressDecision         // 仅 resolved 有；不得写入未决状态
}
type EgressDecisionReceipt = {
  requestID: string
  decision: EgressDecision
  remembered: boolean
  persistenceError?: "io"           // 允许但记不住时明确显示
}
```

`allow-session` 按原有产品词义批准**精确 host:port，到应用退出为止**，不是只给一个 session，也不是只放一次。`allow-persist` 批准 §4.4 的站点及其全部端口；卡片直接写明该范围；`deny` 仅拒掉本组等候连接。没有「仅此项目」、没有额外确认页。等待连接沿用 `EGRESS_GRANT_PROMPT_TIMEOUT_MS = 45_000`；客户端可以先超时，不把它伪装成仍连着。到期后卡片显示连接已失败，仍接受用户的晚到允许并保存，供下一次重试；不自动重跑命令，也不复活旧 socket。45 秒限制来自已批准的无人决定到期行为和现有常量，不新增期限选项。

复用会话停靠区、现有 `Button`、`RiskTag`、审批卡样式及请求/提交中/失败展示方式，联网请求走主进程自己的类型与回执，不进入引擎 `Permission.assert` / `permission.reply` 或 question 队列。引擎的工具规则、always、无人值守权限不能替用户批准真实目的地，也不能把联网卡片自动放行。这里没有引擎 API 代次重定向。

### 4.2 main 的活动工具与档位

**新增接缝 N1：main 持有交互会话的联网档位，ext 只报告工具生命周期。** 将当前 `PermMode`、`PERM_AGENT`、`tierAgent` 的纯定义移到桌面 shared 合同，原 UI 与 main 共用同一份，不复制 carrier 名单；配置注入消费同一份 carrier 常量。档位值仍为 `"allow" | "ask" | "readonly"`，无新增用户档位。

renderer 在现有提交/显式继续入口把实际 `submittedPerm` 通过可信 preload IPC 交给 main，然后才按现有路径切换 agent、发送 prompt/command/shell；覆盖首页、会话、编辑重发、斜杠命令和用户输入的 `!command`（`POST /session/:sessionID/shell`）等同一提交能力的消费者，不在 engine adapter 里作策略决定。切 chip 未提交不改变执行档。联网档位与现有会话级切档一样，在提交时生效；同 session 的在途工具在此刻改读新档位，不从输入文字、引擎数据库 metadata 或工具自报的 tier 学到权限。一次提交失败不自行推断或回滚用户刚提交的档位。

```ts
type RuntimeTier = "allow" | "ask" | "readonly"
type ToolRef = SessionRef & { messageID: string; callID: string }
type NetworkActivity =
  | { kind: "tool"; invocationID: string; ref: ToolRef; tool: string }
  | { kind: "shell"; session: SessionRef; shellID: string }

// N1：renderer → preload → main；generation 来自 main 当前连接，不由调用方铸造。
declare function setSessionNetworkTier(
  input: { session: SessionRef; tier: RuntimeTier }
): Promise<{ revision: number }>

// N2：ext 的进程级桥 → 当前 child 对应的 main host；不接受 tier 字段。
type NetworkActivityCommand = {
  type: "codepuppy.network.activity"
  id: number
  seq: number
  op: "enter" | "leave"
  activity: NetworkActivity
}
type NetworkActivityReply = {
  type: "codepuppy.network.activity.reply"
  id: number
  seq: number
  ok: boolean
}
type NetworkRuntimeAttached = {
  type: "codepuppy.network.attached"
  generation: number
}
type NetworkActivitySnapshot = {
  type: "codepuppy.network.snapshot"
  id: number
  generation: number
  seq: number
  activities: NetworkActivity[]     // 进程级桥持有，覆盖全部 Location
}                                  // 应答复用 NetworkActivityReply
type NetworkSnapshotRequest = {
  type: "codepuppy.network.snapshot.request"
  generation: number
}                                  // main → ext，仅请求当前代完整快照
```

`generation` 复用 `SidecarGenerationState.generation`（`preload/types.ts:114`），由 main 在 child attach 时以 attached 消息发布，接收者还校验消息确来自该 child；旧代消息不能改新代集合。tool 的 invocationID 由 wrapper 每次实际进入时生成随机 UUID，键为 generation+invocationID；shell 键为 generation+shellID。`enter`/`leave` 按此键幂等，重复 enter 不累加，重复 leave 不递减；`seq` 单调，旧序列丢弃。ToolRef 是展示坐标，不能作为活动唯一键：Code Mode 子调用会共用 callID（`core/src/tool/plugin/shell.ts:227`），子调用退出不能删掉仍运行的父调用。开始消息在真正 `execute` 外层、现有工具批准完成后发送，main 更新集合并答复后才调用真实工具；最终清理用同一 wrapper 的 finally，不能只靠成功/错误的 after hook。生命周期传输失败记录不可用，工具本身仍执行，联网判定失去“集合完整”的资格，不因此禁掉本不联网的工具。完整状态要求当前 child 的注册通路在起工具前已接通、序列连续且每条 enter 已应答；丢序、拒收或 detach 都清除此资格，直到该代活动快照重新完整同步，不能靠时间到期自动恢复。

ext 的进程级桥在收到 attached 时主动发送 NetworkActivitySnapshot；收到任何 activity/snapshot 的 ok:false 应答或应答超时时，再发送当前完整快照。main 发现序列 gap 时先将完整性置为 false，再发 NetworkSnapshotRequest；ext 收到它也发送完整快照。快照与后续 enter/leave 共用同一发送队列和 seq：main 接受当前代、不早于已处理 seq 的完整快照后整份替换活动集合、恢复完整性并应答；快照之前的旧增量不得重放，快照之后的增量必须连续。快照失败仍为不完整，不靠计时自动恢复，等待中的 CONNECT 同时遵守 §4.1 的原 45 秒窗口。

每个 `shell.created` 只要携带有效 `metadata.sessionID` 就登记 shell 活动，包含用户 `!command`、模型工具创建的前台/后台 shell；不要求存在 tool 项。用户 shell 的事件异步到达时，§4.1 的 pending 窗口承接先到的 CONNECT。wrapper 返回结果的 `metadata.status === "running"` / `metadata.shellID`（`core/src/tool/plugin/shell.ts:82`、`:94`）仍在 tool leave 前补齐并应答 shell enter，不能赌 created 订阅及时送达。main 经现有 `engineClient(...).shell.get({id})` 核对它仍运行，退出/删除事件使其移除；退出先于移交时保留该 shell 的终态，不得被迟到 enter 重加。工具返回后 shell 项继续存在，到 exited/deleted 才移除。事件处理、后台移交和工具 leave 共用进程级发送队列。子助手工具按自己的 session 登记；其尚未有用户档位绑定时，main 经现有 `engineClient(...).session.get` 读取 parentID，继承最近有可信提交绑定的父 session 的档位。自动化在册表优先，readonly/standard 均不是交互 allow；未知或没有祖先绑定为 `unknown`，不能自动通放。后台 MCP 连接不伪装成某个工具，它仍按当时全活动集合回退。main 在 child detach/exit 时清该代全部活动项；ext 重载只替换自己的 Location 注册，不清其它 Location 的工具；未完成的旧调用保留其 finally。

main 维护的活动项、可信档位绑定和集合完整性是唯一运行快照。窗口焦点、当前会话页、会话 busy 状态及 SSE 延迟均不参与“正在运行工具”的判断。N2 是宿主对正常引擎生命周期的观察，不是 CONNECT 调用来源证明，也不是把多会话拆成了 OS 级安全域。

对每条 CONNECT 的顺序冻结为：

1. 沿用 `parseConnectAuthority` 和现有静态/配置授权权威。
2. 其它目的地先过 `admitUserEgressGrant` 的既有准入；它失败就拒，不能被 allow/remembered 绕过。
3. 命中临时精确授权或记住站点则放行；否则读**本次**完整快照。活动集合非空且每一 session 的可信档位都是 allow，才进入下述 allow-all 专用公网检查，检查通过后按 §4.5 逐次记账。一次混入 ask/readonly/unknown 就走 §4.1；不把这个放行写成全局临时授权。
4. 集合不完整时不能使用全 allow 推论：向仍已知及等待窗口内新出现的活动 session 发卡；空集合也保持 pending 到原期限。调用方/代理不可用不回退直连。

**allow-all 专用公网检查（R1 Major-3，落实 AC-08 第三条）：** 先用 WHATWG IPv4 解析归一数字 host，再用现有 `admitUserEgressGrant` 检查；`127.1`、`10.1`、`169.254.43518` 因此不能自动通放。main 的既有 grants 权威新增纯合同 `admitEgressPass(target: Destination): Destination | undefined` 承载这一步，保留原 CONNECT 地址供卡片和日志显示，不改卡片/记住路径的准入或历史授权语义。

N7 的 allow-all 拨号路径通过目标 lookup 钩子检查本次解析返回的全部 IPv4/IPv6 地址；任一为非公网则返回政策拒绝 403/non-public，不选另一地址掩盖结果，也不回退卡片或直连。数字字面量在调用 net.connect 前也经过同一检查，避免 Node 对字面量跳过 lookup。新增 `isNonPublicEgressAddress(address: string): boolean` 与既有 IPv4 私网判定同属 main grants 权威：复用原 IPv4 规则，IPv4-mapped IPv6 先还原 IPv4；拒回环、未指定、链路本地、ULA、组播和保留地址；特殊用途地址按 [IANA IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry) / [IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry) 的最长前缀 Globally Reachable=false 判定，使用本次读取的 2025-10-09 表及其更具体例外，作为随包固定规则，不增加运行时下载/配置。**`198.18.0.0/15`（含 mapped 表达）明确放行**，与 `network-egress-grants.ts:86-90` 的 fake-IP 前提一致。这些检查只在 allow-all 分支执行；卡片路径原有短写和 DNS 别名处置不变。

```ts
declare function admitEgressPass(target: Destination): Destination | undefined
declare function isNonPublicEgressAddress(address: string): boolean
// 无法识别为 IP 的 lookup 结果按非公网拒绝；198.18/15 例外优先于保留地址规则。
```

### 4.3 主进程公开给 renderer 的 API

**新增接缝 N3：** `ElectronAPI.networkEgress`，由共享 wire 定义类型；main 是批准、订阅与设置的唯一写者。main 以现有 `productWindows()`（`main/windows.ts:169`）确认 `event.sender` 是产品窗口，并要求 `event.senderFrame === event.sender.mainFrame`；其它来源返回 invalid-input，不接受预览窗口、子 frame 或任意 HTTP 客户端作批准者。不给 sidecar、项目插件或 HTTP loopback 客户端提供批准接口。没有新的 Server/Protocol HttpApi 路由。

```ts
type EgressError = "unavailable" | "invalid-input" | "not-found" | "io"
type Result<T> = { ok: true; value: T } | { ok: false; code: EgressError }
type EgressSettings =
  | { available: false }
  | { available: true; revision: number;
      sites: RememberedSite[]; passes: EgressPassSummary[];
      persistence: "ok" | "unreadable" | "write-failed" }

interface NetworkEgressApi {
  setTier(input: { session: SessionRef; tier: RuntimeTier }): Promise<Result<{revision:number}>>
  listApprovals(input: { session: SessionRef }): Promise<Result<EgressApproval[]>>
  decide(input: { requestID: string; decision: EgressDecision }): Promise<Result<EgressDecisionReceipt>>
  settings(): Promise<Result<EgressSettings>>
  revoke(input: { site: SiteKey }): Promise<Result<{revision:number}>>
  subscribe(listener: (event: {
    revision: number; kind: "approvals" | "settings"
  }) => void): () => void
}
```

`setTier` 是 N1 在 preload 的实际方法名；内部函数与 wire Result 包装不可各写一套档位语义。所有字段必填，例外仅为类型中明确的 optional；输入严格解码，枚举无默认放宽。sessionID 使用现有 `Session.ID`，messageID 使用 `SessionMessage.ID`，callID 使用 `Tool.CallID`；上面 string 是跨 Electron wire 的序列化形状。directory 为引擎 Location 的绝对目录，main 不据此信任 tier；generation/会话不存在或旧代 list 返回 unavailable，不替换成当前窗口身份。决定命中 main 已生成的请求且属于本应用，不能用传来的 host/site 新建授权；重复决定返回原回执，未知 requestID 为 not-found。

subscribe 只发失效通知；消费者先订阅再 list，并按 revision 缓冲/补拉，避免 list 与事件之间漏卡；重绑时移除旧订阅，旧请求结果不进入新会话。main 的 settings revision 在内存判据与持久化操作结算后增长，同步通知所有窗口。复用现有 permission feed 的“先订阅、拉快照、再并增量”模式，不改其权限合同。

设置在现有「工具」设置区域增加联网清单：记住的站点显示实际范围、记住时间与逐条撤销；allow 档的放行地址按 host:port 聚合显示首次/最近时间和次数（§4.5），不能称“目标请求成功”。复用现有设置列表/按钮/行内失败样式。撤销只有一个动作，无保存键、额外确认或重启要求。Windows 的 `settings()` 返回 `{available:false}`，renderer 不挂载卡片、记住按钮、联网清单及其导航；main 不安装代理/批准桥或创建这些存储。按围栏能力而非是否有 WSL 会话来显示，Windows 上无无效入口。

### 4.4 站点与用户级真源

**新增接缝 N4：** main 的站点归一函数，输入仅为已通过既有地址准入的 host；从完整 PSL（含 ICANN、PRIVATE、通配与例外）求可注册域。决定使用直接依赖 `tldts@7.5.5` 的 `getDomain(host,{allowPrivateDomains:true})`，由 main 随包携带表，不在运行时下载 PSL，不复用只有 ICANN 的间接构建依赖。这是 AC-09 必需的唯一新增运行时依赖，不自建后缀算法。

```ts
type SiteKey =
  | { kind: "domain"; value: string } // PSL 得出的 registrable domain
  | { kind: "host"; value: string }   // IP/公共后缀自身/无可注册域的精确主机
type RememberedSite = { site: SiteKey; at: string }
type EgressSitesDocument = { v: 1; sites: RememberedSite[] }
declare function siteForHost(host: string): SiteKey
declare function siteContains(site: SiteKey, host: string): boolean
```

DNS 输入按现有小写 authority 及 Node `domainToASCII` 统一存 A-label；不通过 URL 解析重解释旧基线接受的数字地址。`domain` 匹配 `host === value || host.endsWith("."+value)`，包含端口不限；`host` 精确匹配，仍端口不限，不生成 IP 子网授权。公共后缀本身绝不能变成后缀通配授权，故给它精确 host 语义，记住按钮仍可用。`a.example.com` → domain/example.com；`alice.github.io` → domain/alice.github.io，不能匹配 bob.github.io；`spark-public.s3.amazonaws.com` 不授权另一个 bucket。读取已存授权按当时记录的 key 匹配，不重新向父域求站点，也不因更新表而给用户增加授权到期或再次确认。

真源为 **`<casBaseRoot>/egress-grants/sites.<env>.json`**，同一应用环境的全部项目共用，不按项目、session、agent 分区；`env: AppEnvironment = "prod" | "beta" | "dev"` 及根都由现有 `resolveCodePuppyStateBase` 的冻结快照取得，不接受 renderer/sidecar 指定环境或存储路径。环境隔离遵循 REQ-098（`codepuppy-environment.ts:8-9,34-35`）与既有 `egressGrantTruthPath:43`，文件仍在受保护的用户根，不放进 env 的可写目录。没有登录账户选择器。新 sites 文档与旧精确授权数据不同，不导入、不转换旧记录、不从旧文件回填新授权；没有迁移或兼容读分支。

main 复用既有真源的严格读取、单写者、同目录临时文件 + rename 的原子写形态；新文件只接受 `v`、`sites`，每行只接受 `site`、`at`，site 键/值与 ISO-8601 UTC 时间合法，站点 key 唯一，不接受 wildcard 字符串、port 或 project scope。缺失是空清单，坏文件是 unreadable，不能当作“用户从没批准过”。写端不进入 sidecar import 闭包。

CF-1 的应用状态根及其祖先拒写必须作用于这一路径及临时文件；即便用户打开包含该根的宽目录、或可写根通过别名指向它，最终拒写仍胜出。配置围栏规划继续使用 canonical 路径与现有 via/祖先规则；不得把“项目不常在这个目录”当安全证明。所依赖的拒写能力已由 §2 的正反探针证实。

### 4.5 每次通放的记录

**新增接缝 N5：** 复用 `EgressLogRecord` / `EgressProxyDeps.log` 的结构化出口，新增政策放行事件；它与已有拨号/隧道完成事件按同一连接 ID 关联，不能用连接成功替代政策决定。

```ts
type EgressPass = {
  event: "egress.policy-pass"
  id: string                       // main 本次应用运行 UUID + 连接序号
  at: string                       // UTC ISO-8601
  destination: Destination         // CONNECT 实际 host + port
  basis: "allow-all"
  attribution: { kind: "unknown" }
  sessions: { session: SessionRef; tier: "allow" }[]
  tierRevision: number
}
type EgressPassSummary = {
  destination: Destination          // 按规范化 host:port 聚合
  firstAt: string                  // UTC ISO-8601
  lastAt: string                   // UTC ISO-8601
  count: number                    // 正整数；按唯一 pass id 计数
}
```

每条**因 allow-all 获准**的 CONNECT 在数字地址和解析结果公网检查通过、尚未向目标建立隧道时产生一条，不按站点合并、不采样，不写入永久/临时授权集合；下一条连接重新读活动集合。N7 的 onPass 在该决定点仅调用一次，跨上游路由尝试不重复记；被公网检查拒掉的请求没有 policy-pass，只记政策拒绝。随后上游拨号、代理或 TLS 失败，该条仍记录“政策放行”，实际连接结果由已有 `egress.connect` / `egress.tunnel-closed` 描述。命中静态表、配置或已经记住的站点仍有原有逐连接日志，不伪称它们是档位旁路。

main 在同一受保护目录追加 **`passes.<env>.jsonl`**，env 取 §4.4 同一环境权威，每行是一个完整 EgressPass；设置读取当前环境日志并结合本次内存记录按 pass id 去重，再按规范化 host:port 投影 EgressPassSummary，firstAt/min、lastAt/max、count 为唯一记录数，跨重启可看。聚合仅为设置投影，逐次日志保持完整，不另存第二份聚合真源。没有工具参数、命令全文、URL path/query/userinfo、请求头、正文、代理凭据或隧道内容。写失败仍经既有主日志出口记录并保留本次内存条目，设置显示记录写入失败，不为了日志 I/O 拒掉本已获准的连接。读取末尾不完整行时报告不完整，只呈现之前完整行，不把半行当放行事实。不加保留期限、条数上限或清理选项。

### 4.6 模型说明及结果通路

**新增接缝 N6：** main 在建立 pending、拒绝、超时状态时，经 N2 同一进程级桥向收件 session 的当时活动调用发送结构化事实，不把代理正文是否被客户端保留下来作为唯一依据。

```ts
type EgressNotice = {
  type: "codepuppy.network.notice"
  requestID: string
  destination: Destination
  state: "waiting" | "denied" | "timed-out" | "unavailable" | "allowed"
  sessions: SessionRef[]
  activities: NetworkActivity[]
  attribution: "unknown"
}
```

由 main 的同一串行决定点先发布 notice 再结束 CONNECT，ext 的同一桥按序接收；leave 应答是本次 enter 到 leave 期间所有 notice 已发送的屏障，ext 收到它才结算 finally，再由现有 `execute.after` 输出边界形成模型结果。notice 按 requestID 留在 session 状态中，覆盖只有后台 shell 存活的情形；后台任务随后唤醒模型时，现有 context hook 仅在仍有有效 notice 时注入同一说明，不依赖工具函数仍在栈上，也不另造通知消息/引擎入口。waiting 随请求未决而有效，denied/timed-out/unavailable 保留至关联结果或后续 context 已交付一次说明；allowed（含被其它授权覆盖结算）清除该 requestID 的所有未消费状态，换代清理也会清除。没有有效 notice 的普通回合不注入。notice 是进程内受影响工具集合的事实，文案不能说“本步发起”。显式拒绝/超时不被同名普通网络错误覆盖。非 CONNECT 错误与真正的 dial/TLS 失败继续走 `classifyNetFailure`，不能仅凭 403 或 ENOTFOUND 误贴保护说明。

唯一的固定说明为：**「联网正在等待批准或已被应用拒绝，这是 Code Puppy 的联网保护，不是电脑网络故障；请等待决定或获准后重试，不要排查网络或绕开代理。」** 这是一个句子，不含模型可写的解释。

在 `context-injection.ts` 定义一份常量，并以 `network.egress.notice.system`（sink=system）和 `network.egress.notice.result`（sink=tool-failure）登记同一文本、复用现有 `CAP_DESCRIPTION` 字节上限和 defineText 的超限抛错。前者由现有 `context.session.hook("context")` 在有围栏且本 session 持有有效 waiting/denied/timed-out/unavailable notice 时注入，不预告尚未发生的拦截；后者继续在确有这些 notice 的工具结果中追加一次，错误通过 `Tool.Error.message`、成功返回但网络仍在后台等待的结果通过文本 content 进入模型，保留原有输出和错误 metadata。工具错误不被改成成功结果。登记库存随注册表自然输出，不写第二份说明清单。

同步工具还在等 CONNECT 时没有新的模型回合，也没有已完成的工具结果；不得为送提示提前结束工具，也不声称发起该工具前的 context 已带本次通知。工具真正返回时附带实际 notice；有后续模型回合则按上述有效状态条件处理。客户端先放弃时，即使 undici 丢了代理正文，已收到的等待 notice 仍足以带回该句，不能把它改写成电脑网络坏了。Windows 不注入围栏说明。

### 4.7 跟随系统代理的上游隧道

**新增接缝 N7：** main 单独持有一个无持久化 Chromium Session，用 `session.fromPartition("codepuppy-egress-upstream")` 创建并 `setProxy({mode:"system"})`，只用于 `resolveProxy`。它不指向本地策略代理，不改 renderer/main 的其它 Session，不读取 sidecar 已被覆盖的 HTTP_PROXY。

授权通过后，按实际目标构造 `https://<host>:<port>/` 查询系统路由，忽略隧道内 URL/path；CONNECT 没有路径，不能声称完整复现 PAC 中按网页路径的判断。每条新连接查询，不长期缓存路由；电脑网络配置变化沿用 Chromium system 模式更新。查询之前不做目的地 DNS/拨号，PAC 查询本身可能需要的系统网络工作留给 Chromium。

```ts
type UpstreamRoute =
  | { kind: "direct" }
  | { kind: "http" | "https" | "socks4" | "socks5"; host: string; port: number }
type UpstreamTunnel = { socket: import("node:net").Socket; route: UpstreamRoute }
type EgressDialPolicy =
  | { kind: "existing-authorization" }
  | { kind: "allow-all"; onPass: () => void } // 公网检查通过后、目标拨号前调用一次
declare function resolveEgressRoutes(target: Destination, signal: AbortSignal): Promise<UpstreamRoute[]>
declare function dialEgressUpstream(
  target: Destination, routes: UpstreamRoute[], policy: EgressDialPolicy, signal: AbortSignal
): Promise<UpstreamTunnel>
```

路由按 Chromium 返回顺序解码：`DIRECT`、`PROXY`/`HTTP`、`HTTPS`、`SOCKS`/`SOCKS4`、`SOCKS5`。类型轴覆盖同一系统代理面已有的协议，不新增“仅支持某一种”的产品设置。[Chromium 代理文档](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/docs/proxy.md)是 token 与协议语义来源。未知 token/畸形返回为代理解析失败，不猜 direct；路由列表里的显式 DIRECT 是系统决定，可用，无系统代理时它复用现有 `net.connect`。

HTTP 以 Node `http.request({method:"CONNECT",host:<代理>,port:<代理>,path:<目标 authority>})` 的 connect 事件取 socket；HTTPS 用 `https.request`，校验代理 TLS，目标 TLS 仍端到端由客户端完成；HTTP 200 才是上游隧道就绪。SOCKS4 使用其 IPv4 目标解析/握手，SOCKS5 使用协议的目标地址握手、代理端解析域名；握手由 main 内部实现，不把 Node `net.connect({host:<代理>})` 的 TCP connect 误认为目标已连通。不需要 Electron raw socket API，也不通过 `net.fetch` 读取/重发目标 HTTP 内容。

`policy.kind === "allow-all"` 时执行 §4.2 的目标 lookup 检查并固定本次通过检查的地址集：直接路由的 net.connect 使用该 lookup 返回的已校验地址，不能二次解析；HTTP(S)/SOCKS 路由也先在 main 调用同一目标 lookup，再把已校验目标 IP 交给 CONNECT/SOCKS 握手，不只检查代理地址、不把未经检查的目标域名交给代理再次解析。目标 TLS SNI/HTTP 内容仍由客户端使用原域名，fake-IP 例外仍按 §4.2 放行。地址字面量直接校验；非公网结果产生 `ENONPUBLIC`，代理将其转为 403/non-public 与结构化 notice，不归到普通 dial-failed。只有完成这些检查才调用 onPass。`existing-authorization` 保持原目标解析/代理端解析语义，不把新增过滤施加到卡片或已有授权路径。

本地 CONNECT 200 只在上述隧道就绪后发出，既有 `head` 与上游握手多读的字节原样送回数据流，保留背压、客户端关闭和隧道统计。当前同步 `dial` 合同升为异步 Promise 就绪合同；代理的 10 秒拨号计时覆盖解析系统路由和上游握手，不计用户等待；客户端关闭或期限触发时通过 signal 取消后续工作并销毁已经创建的上游 socket，迟到的 resolveProxy 结果不得再拨号；原有 TLS 静默计时从本地 200 开始。路由失败可尝试系统给出的下一项，不擅自追加 direct；全部失败仍按已有 dial-failed 的 DNS/TCP/timeout 分层返回 503/502/504。代理解析/握手/认证/循环分别使用错误 code `EPROXYCONFIG` / `EPROXYCONNECT` / `EPROXYAUTH` / `EPROXYLOOP`，按 TCP 层 502 描述，ETIMEDOUT 仍为 504。代理返回 407 是上游代理认证失败，记录该层，不触发联网批准或新增登录对话框。上游口令不进日志。

系统路由若指回自身策略代理端口，识别并返回代理循环错误，不递归。这里允许 main 连系统代理的 loopback 地址，不能反过来给工具开本机直连；seatbelt 的 N4 仍只有原策略端口。

AC-13 的证明口径：在真实机器设置系统代理后，以真引擎、真围栏连仅通过该代理可达的地址，核对代理收到连接；再以无系统代理的对照证明原行为，一次形成实机证据。日常验证从 `resolveEgressRoutes` 注入系统路由结果，继续走同一上游握手、过滤与隧道实现；它不代替真实系统配置读取的实机证明，也不要求日常测试反复修改机器代理设置。具体执行安排属于 plan.md。

### 4.8 接缝映射（§3 seam map）

下表的“raise”均是本设计已决定新增的合同，不是假称已有符号；实现者不能以未找到端口为由临场换授权来源。

| 依赖能力 | 已有可调用面 / 已决定 raise | 所有者与消费者 |
| --- | --- | --- |
| 启动代理、真实 CONNECT、隧道与日志 | `startEgressPolicyProxy`，`main/network-egress-proxy.ts:228`；`parseConnectAuthority:151`；异步就绪改为 N7 | main 代理消费 main 策略/拨号服务 |
| 静态/配置目的地、卡片准入与 allow-all 公网检查 | `isEgressAuthorized`，`main/network-egress-registry.ts:149`；`isConfiguredEgressDestination`，`network-egress-derived.ts:178`；`admitUserEgressGrant`，`network-egress-grants.ts:119`；**raise N7**：§4.2 的 `admitEgressPass` / `isNonPublicEgressAddress`、§4.7 的 EgressDialPolicy 与目标 lookup 钩子；数字解析用 WHATWG URL，地址检查用 Node net.isIP/BlockList 与既有 IPv4 判定 | main grants 权威唯一，公网检查仅 allow-all；卡片路径不变，代理不另存名单 |
| 用户实际选择的档位到 main | **raise N1**：`NetworkEgressApi.setTier`；纯 `PermMode/PERM_AGENT/tierAgent` 权威从 `composer-state.ts:36` 移到 shared，不复制 | renderer 自动提交，main 保管；非引擎配置新信道 |
| 当前工具、取消、所有会话 shell、跨 Location | `context.tool.transform`，`plugin/src/promise/tool.ts:67`；`wrapForDisplay`，`ext/src/policy/display.ts:38`；`context.event.subscribe`，`ext/src/plugin.ts:446`；`Shell.Event.Created`（`schema/src/shell.ts:58`）、用户 shell 的 metadata（`core/src/session/shell.ts:13`）、`engineClient` 的 `shell.get`（`client/src/effect/generated/client.ts:1765`）；**raise N2** 的 attached/snapshot/snapshot.request/enter/leave/reply | ext 生产全部带 sessionID 的 shell 活动及恢复快照；main 消费，同进程伪造残留见 §10 |
| 子会话祖先与自动化身份 | `engineClient`，`main/engine-client.ts:6` 的 `session.get`；`unattendedRuns`，`main/codepuppy-unattended.ts:67` / `AUTOMATION_PROFILES` | main 只继承可信绑定，不信 metadata 的 unattended/tier 字段 |
| main 发卡/用户决定/设置热撤销 | **raise N3**：§4.3 全部方法与 sender 校验；承载沿用 `ipcMain.handle`（`main/tool-policy-ipc.ts:11`）、`productWindows`（`main/windows.ts:169`）、preload `ElectronAPI`（`preload/index.ts:32`）与 `SessionComposerDock`（`:227`） | main 裁决；受信 renderer 展示并提交；不调用引擎审批 API |
| PSL 与站点匹配 | **raise N4**：`siteForHost` / `siteContains`；库 `tldts.getDomain` 的 PRIVATE 选项已由公共文档确认，安装/运行尚未证实 | main-only 站点权威；共享 wire 仅传 SiteKey |
| 受保护路径、站点原子写与即时内存生效 | `resolveCodePuppyStateBase`，`main/codepuppy-environment.ts:105`；`writeEgressGrantTruth` 的原子写形态，`egress-grant-truth-write.ts:22`；**raise N4** 的新 sites 文档读取/替换；`configFenceLocations:138` / `renderProcessFenceProfile:215` | main 单一站点 store，不进 sidecar 写闭包；既有 CF 负责强制拒写 |
| 每次 allow-all 日志与设置聚合 | **raise N5**：EgressPass、EgressPassSummary 与当前环境受保护追加读写；既有 `EgressProxyDeps.log`（`network-egress-proxy.ts:115`）；N7 onPass 在公网检查通过后调用 | main；日志逐次，设置按 host:port 聚合，政策事件和拨号结果分开 |
| 模型等待/拒绝说明与登记 | **raise N6**：EgressNotice + 两个固定登记 ID；`defineText:169` / `CONTEXT_INJECTIONS:563`；`context.session.hook("context")`（`ext/src/plugin.ts:256`）；`execute.after`（`ext/src/policy/index.ts:273`） | ext 生成模型文本，main 只提供事实，既有注入登记审计出口消费 |
| 系统代理路线与真实上游隧道 | Electron 42.3.3 `session.fromPartition/setProxy/resolveProxy`；**raise N7**：`resolveEgressRoutes` / `dialEgressUpstream`，协议和就绪语义在 §4.7 定义 | main；Node http/https/net 承载 raw stream，无需 Server/Client 新 API |
| Windows 不出现入口 | `main/server.ts:581` 的 darwin 启动分支；**raise N3** 的 `available:false` | main 给能力事实，renderer 不挂载不可用组件 |

## 5. 数据与失败

main 单一服务串行处理批准、撤销与 store 更新。同一决定不跨两个写者；临时批准在内存中，记住批准先原子替换 sites 文件再切换内存快照和 revision，成功后才回复 remembered=true。持久化失败仍允许本次运行、返回 remembered=false/io 并在卡片显示“已允许，但未能记住”，不静默冒充已保存。

撤销先从内存中移除该站点及覆盖它的本次临时授权，同时取消该站点未决卡片的旧请求身份，防止晚到回执重新落账；再原子落盘。只有两者成功才返回成功。落盘失败维持本次内存撤销，返回 io、设置提示重启后可能恢复，允许原动作重试；不为了磁盘故障恢复已撤销的权限，也不假称撤销已永久成功。成功应答之后的每条 CONNECT 都读新快照，不能命中旧缓存；已建立隧道继续，规格要求的是下一次连接重问。静态/配置授权和此时合法的 allow-all 是各自独立依据，撤销记忆不伪造它们也被禁用。

批准/撤销与并发 CONNECT 在同一 main 决定点线性化。每条请求在真正创建隧道前复核可变记忆授权仍有效；不得拿异步系统路由解析前的过期授权绕过撤销。到期只结束该批旧连接；晚到的新允许来自仍有效卡片则是新的用户操作，取消后的旧 requestID 不能写入。

进程退出丢弃 socket、临时允许、tier/activity 和待批卡片；站点与完整放行记录重启重读。sidecar 换代只清该代活动/会话绑定与该代通知，main 的用户授权与代理继续存在；由旧代产生的未决连接结算为 unavailable，旧卡片不在新代再批准。读坏 sites 不自动覆盖或转换旧格式；已批准地址仍可临时通过，持久化错误明确显示。Windows 无上述生命周期。

策略拒绝沿用 403 与共享 `egressDenialLine`，新增 detail 闭集 `user-denied | approval-timeout | approval-unavailable | non-public`，供日志/卡片/notice 说明；不是靠 incidental 英文正文判断。400/405 仍是请求格式与代理方法错误，503/502/504 仍是拨号层失败。无人决定、无收件人、批准通路失败均有明确原因，绝不退回系统框或直连。

## 6. 架构落点

| 能力落点 | 模块地图归属 | 合法依赖与已有权威 |
| --- | --- | --- |
| 目的地策略、活动快照、站点真源、记录与系统代理 | `packages/ui-mac/` 桌面宿主 main | 复用 registry/grants、环境状态根、CF 和现有 sidecar host；不下沉到 Core，不复制原生工具 |
| wire/档位纯定义、preload、会话卡片与设置清单 | `packages/ui-mac/` 桌面 shared/IPC/renderer | renderer 只消费公开 IPC 和纯 shared，不 import main 私有模块；existing `Button` / `RiskTag` / dock 是 UI 权威 |
| 真实工具生命周期、后台 shell 观察、模型说明 | `packages/ext/` 宿主扩展 | 使用公开 plugin transform/hook/event 和现有进程级 bridge；纯 wire 可共享，磁盘写者不能进 ext |

引用[模块地图](../../architecture/modules.md)和[约束 K1/K2](../../architecture/constraints.md)：本次没有新包/顶层目录；§4 的 N1 消除被触及的 UI/main 档位映射重复风险，自动化权威保持不变；N4 只有一份站点计算，N7 的地址判断留在既有 grants 权威。N2 的同进程来源认证残留按 R1 裁决在 §10 记录，不冒称已隔离。既有其它 carrier/工具策略偏离不扩项治理。依赖方向仍为 Schema→Core/Protocol→Server，Client 无 Core/Server 运行时依赖；本增量不改引擎权限合同、不切换生产引擎代次，遵守 ADR-037。

**L 安全面：** OS 围栏仍覆盖 sidecar 整棵进程树，main/renderer 在其外。真实授权目标只能来自 CONNECT；永久/临时允许只能来自可信 renderer 对 main 已存在请求的点击。main 的档位值取实际提交，N2 不接受 tier 字段，但活动事实不是可认证的插件身份：已获项目 consent 的插件与 ext 同进程，可经 `process.parentPort` 伪造 N2 enter/snapshot，借用已有 allow 绑定影响通放判断。校验 child/generation 不能区分这两种发送者；UI 默认本来就是 allow（`composer-state.ts:66`），不能把绑定描述成用户必曾主动放宽，也不能声称 ext 无法影响通放。该残留按 R1 记录，未设计进程隔离或新的许可步骤。普通 shell 子进程不能改站点文件、铸造 UI 点击或绕过 OS 网络出口；项目插件同进程可执行 JS 的风险不能以“只有宿主被替换才可能”掩盖。用户点击本次允许仍授权整棵树的该目的地，记住授权站点所有子域和端口，allow-all 专用分支须通过 §4.2 的公网检查。隧道不解密，不记录正文或凭据。

被否决的替代：每会话端口/凭据不能覆盖共享 MCP、不能证明同进程隔离且不如已批准回退便宜；SSE/窗口焦点不能在工具首个 CONNECT 前提供完整活动集合；用引擎权限卡的 always 写授权会错写项目范围且将围栏内声称的 URL 变成授权真源；PSL 只取 ICANN 会合并托管租户；从 sidecar 的代理 env 建上游会回到自身；用 Electron fetch 替代原始隧道会拆掉端到端协议边界。

## 8. 拆分决定

不适用跨仓/独立所有权拆分。main、ext、preload 与 renderer 同仓消费 §4 的共享合同；其先后实施与文件安排属于 plan.md。外部输入仅为随包的 PSL 库和现有 Electron 系统代理 API，没有另一个仓的服务必须先发布。

## 9. 回滚

不适用。新增用户真源没有旧记录迁移；本增量不设计兼容期、旧行为开关或回退通路。

## 10. 裁决与审查结论

2026-11-26 编排器 r2 裁决：tldts 精确版本由 7.6.0 改为 7.5.5，以满足仓库 minimumReleaseAge；库与 PSL 语义不变，不添加发布年龄豁免。

| 当前裁决 | 依据与适用版本 |
| --- | --- |
| 单端口、不伪造发起步骤；所有带 sessionID 的 shell 都算活动，空/不完整集合在原 45 秒内等待收件人并取并集 | BR-04、AC-07；§2 的用户 shell 来源；R1 Major-1；N1/N2/N3 |
| main 存提交档位，N2 报活动事实；全 allow 必须非空且完整，专用分支归一数字地址并在目标 lookup 拒非公网、保留 fake-IP | BR-05、AC-08；R1 Major-3；N7，卡片路径保持原行为 |
| PRIVATE PSL 站点与逐次日志均在受保护用户根内按环境分文件；热撤销在建隧道前复核，允许结算全部已覆盖 pending | BR-06..BR-08、AC-09..AC-11；R1 Minor-4/5/7；N3/N4/N5 |
| 只有有效 notice 才注入 system，保留工具结果说明；授权覆盖结算清除对应 notice | BR-09、AC-12；R1 Major-2；N6 |
| system 模式只解路由，main 原始隧道串联；实机一次证明系统代理，日常从 resolveEgressRoutes 注入 | BR-10、AC-13；R1 OPTIONAL-9；N7，未声称实机已通过 |
| 设置按地址聚合 firstAt/lastAt/count，日志仍逐次；移除旧询问数量上限与拒绝冷却 | R1 OPTIONAL-9；v2「用户会碰到的限制」不含旧两项；N5 |

**冻结依据与 owner-only 项：** 无新增产品取舍或限制提案。本轮续接 brief 明确要求「set status frozen」，据此冻结修订后的设计；review.rounds=1、reviewed_sha=85b4f6c8e5，verdict 按指定回执填写。R1 的 FIX-THEN-MERGE 是独立审查对原稿的结论，本次是按调度裁决修正设计，未冒称独立复审或执行合并。

| 轮/审查版本与范围 | 审计方 | finding 及处置 | 改了什么/验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| R1 / `85b4f6c8e5` / §4.1、§4.2 | Claude Opus 5.5，只读 | Major-1：接受并修正 | `routes.ts:356` → `core/src/session/shell.ts:13-18` 核实 !command 绕 wrapper；全部带 sessionID 的 shell.created 登记、补 shell 提交入口、空/不完整集合在原窗口等待并合并收件人 | 无对话时不新增投递目标，产品缺口按下行转出 |
| R1 / `85b4f6c8e5` / §4.6 | Claude Opus 5.5，只读 | Major-2：接受并修正 | system 只随本 session 的有效 notice 注入；明确消费/allowed 清理，删除“挂起前已注入”声称，工具结果追加保留 | 未新增静态预告或其它提示通路 |
| R1 / `85b4f6c8e5` / §4.2、§4.5、§4.7 | Claude Opus 5.5，只读 | Major-3：接受并修正 | allow-all 专用 WHATWG 数字归一与目标 lookup 检查、固定已校验地址用于上游、198.18/15 例外、ENONPUBLIC→403/non-public；§2 纯本地探针正反结果 | 卡片路径不变；真实 lookup/隧道效果仍待实施证明 |
| R1 / `85b4f6c8e5` / §4.1、§4.6 | Claude Opus 5.5，只读 | Minor-4：接受并修正 | 记录授权后串行结算全部被覆盖 pending；精确允许按 host:port，记住按站点；同步卡片与 allowed notice | 不扩大拒绝作用域，不复活过期连接 |
| R1 / `85b4f6c8e5` / §4.4、§4.5 | Claude Opus 5.5，只读 | Minor-5：接受并修正 | sites.<env>.json / passes.<env>.jsonl，env 只取现有冻结环境权威；依据 REQ-098 与 egressGrantTruthPath:43 | 用户级、同环境全部项目共享；无迁移或兼容分支 |
| R1 / `85b4f6c8e5` / §4.2、§4.8 | Claude Opus 5.5，只读 | Minor-6：接受并修正 | ext 在 attach、ok:false、应答超时后发完整快照；main 遇序列 gap 请求 snapshot；明确同队列排序、替换与恢复资格 | 不增加定时解禁或等待期限 |
| R1 / `85b4f6c8e5` / §5 | Claude Opus 5.5，只读 | Minor-7：接受并修正 | 删除“撤销之前已拿到授权可完成拨号”句；只保留建隧道前复核，resolveProxy 前的旧授权不能跨撤销使用 | 已建立隧道的既有边界不变 |
| R1 / `85b4f6c8e5` / §6 | Claude Opus 5.5，只读 | ARCH-8：接受，纠正声称并记录残留 | `hub-bridge.ts:226` 与 `plugin-fanout.ts:1-22` 证明项目插件可达 parentPort；明确其能伪造活动并借用已有 allow 绑定，默认档已是 allow（composer-state.ts:66） | 同进程来源认证未解决；按调度裁决留档，不扩出隔离/许可机制 |
| R1 / `85b4f6c8e5` / §4.3、§4.5、§4.7 | Claude Opus 5.5，只读 | OPTIONAL-9：接受并纳入设计 | EgressPassSummary 按 host:port 聚合首次/最近时间、次数，日志仍逐次；AC-13 一次真实系统代理证明、日常注入 resolveEgressRoutes | 执行安排留给 plan.md，不声称已有实机证据 |

**已转出、不得据此扩设计：** 连接器/LSP 在没有对话运行工具时，规格没有可展示卡片的对话。调度方已将此缺口退回意图作为 pending 项，本轮未给出其编号；本设计只沿用 §4.1 原 45 秒内等待收件人的行为，到期如实失败，不增加其它投递目标。

**作者交接回执：** 依据为规格 v2、§2 固定代码 SHA 及 R1 原稿 `85b4f6c8e5`；R1 由 Claude Opus 5.5 只读审查，3 Major、4 Minor 接受并修正，ARCH 残留如实记录，OPTIONAL-9 已采纳。修订作者为 Codex（GPT-6），自查仅覆盖本轮裁决与直接后果，未重开其它已定事项；N1..N7 接缝映射已随改动更新。下一阶段从本冻结版写 plan.md，不再把本稿当实施或验收证据。

R0 已有文件围栏正反探针继续沿用，见 §2。R1 的数字归一探针命令与结果亦见 §2；本轮 `cd packages/ui-mac && bun test src/main/old-name-scan.test.ts` 退出 0，10 pass / 0 fail；本地 Python 检查 frozen 与指定 review 回执、章节编号、相对链接、全部 R1 处置、旧矛盾声称已移除，以及只改设计和一条索引，退出 0；`git diff --check` 退出 0。固定模型说明仍为 UTF-8 183 字节，小于既有 1024 字节上限。未运行整包/项目套件。

**仍属推断或未验证：** N1/N2 接入真实 !command、工具/后台生命周期及快照恢复后的时序；N3 卡片并发和 Windows 包实机入口；tldts 7.6.0 在打包 Node 下的 PRIVATE/例外/IDNA 行为；allow-all 目标 lookup、拒非公网、fake-IP 与上游协议的实际接线；Electron 42.3.3 的系统代理动态变化、PAC、HTTP(S)/SOCKS 上游握手、代理认证失败分层和目标端到端连接；真引擎的模型结果字节。机器约束不允许起应用/Electron或发起测试网络连接，本稿不把文档、类型或纯本地探针写成这些行为已通过。N2 项目插件同进程伪造是已知残留，不是已验证隔离。其余遗留去向为本节，无额外 owner 决策。

**留档：** 旧基线已接受的 inet_aton 短写/DNS 别名边界只保留在原卡片授权路径；新增 allow-all 分支按 R1 实现规格既有的公网边界，不继承该缺口。约束 K1 已登记的其它 carrier 偏离保持原处置，不扩项修复。当前规格缺少标题为「体验约定」的小节，仍按 brief 给定约定消费，不改写规格。

OPTIONAL：`docs/README.md:282` 等既有索引行与当前元数据有漂移；R0 已记录全量生成会连带改动 28 行。本轮只更新本设计索引行的 frozen 状态，不接手其它索引修复；全量索引 current 检查不作为本设计内容通过的证明。
