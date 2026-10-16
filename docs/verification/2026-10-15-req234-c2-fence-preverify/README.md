---
title: REQ-234 C2 sandbox-exec 前置验证
kind: verification
status: active
owners: [alpha-code desktop maintainers]
last_reviewed: 2026-10-15
---

**[#1530](https://github.com/jinjunnn/alpha-code/issues/1530) C2 第一步：通过，仅限以下实测。**
代码基点 `5aef6b0c3b4d2fce317137f039599f94021658b5`；macOS 26.3.1 (25D2128)、arm64、Bun 1.3.14、Electron 42.3.3。
依据：[基线 §四 C2](../../design/2026-10-14-req234-hub-agent-install-baseline.md)。

**实测**：调用生产 `planProcessFence`（真 fs、真 `trialCompileProfile`），在 file-write allow 块后、网络块前插入票面两条 deny。
断言删掉这两行后与原 profile 逐字相同；两份 profile 和每条命令/退出码/输出存于 [results.json](results.json)。
隔离 HOME/globalRoot/userData 在本目录临时树内、位于 `/Users`，不落入 W11/W12；采用默认 XDG 派生，不读用户配置或密钥。
路径样本来自生产 planner/server；配置 seed 来自 `alpha-config-injection.ts`；MCP 样本取随仓 `alpha-catalog.json` 的 `mcp:markitdown`。
- 七处：`<alphaGlobalRoot>/alpha.jsonc`，以及 `~/.opencode`、`<XDG_CONFIG_HOME>/opencode`、`<userData>/alpha-engine-config` 各自的 `plugin/x.js`、`plugins/x.js`。
- 原 profile：七处 `echo >>` 全部 rc=0；追加 deny 后：七处全部 rc=1，stderr=`Operation not permitted`，文件字节未变。
- errno 对照：七处 × 追加/新建/截断/删除/rename 覆盖，原 profile 35/35 `OK`，追加 deny 后 35/35 `EPERM`、`errno=-1`；缺席文件未落盘，其余原文未变。
- 六个插件目录本身的 `mkdir`：原 profile 6/6 `OK`，追加 deny 后 6/6 `EPERM`。
- 围栏外真实 Electron main（`process.type=browser`）：同七处追加成功；生产 `prepareConfigTx → applyConfigImage → restoreConfigImage` 成功，MCP 叶与回滚字节均核对。
- 两臂各 22 个文件对照均可写且读回匹配：W1 工作区、W2 skills、`alpha.jsonc.bak`、W3 locks、W4 data、W5 cache、W6 node_modules、W7 npm、W8 history、W10 sessions、W11 tmp、W12 var/folders、W16 opencode.jsonc、W17/W18 bun cache、W19 zcompdump，以及三个父目录各自的 opencode.json/plugins-extra。
- 两臂 W13 null/stdout/stderr、W14/W15 真 PTY/tty/fd、N2/N3 loopback listen、N4 指定端口 TCP connect 均 rc=0；受保护文件可读；HOME 非白名单路径仍为 EPERM。
- 所有临时树（含 W11/W12 探针）已清理；未修改生产文件、未跑第二步全量门。

**复现命令与输出**（仓库根目录；使用本机主 checkout 已有 Electron/addon，无需复制或重建）：
```sh
bun docs/verification/2026-10-15-req234-c2-fence-preverify/preverify.ts
# rc=0
# two-denies-append:.../alpha.jsonc: rc=0 {"action":"append","code":"EPERM","errno":-1,"syscall":"open"}
# unfenced-electron-main: rc=0 {"processType":"browser","electron":"42.3.3","append":7,"configApply":"OK","configRestore":"OK","catalogId":"mcp:markitdown"}
# PASS: seven protected targets; six absent plugin directories; allow controls; unfenced Electron main config apply/restore
```
每次 echo 的实际命令形状：`/usr/bin/sandbox-exec -f restricted.sb /bin/sh -c 'echo probe >> "$1"' -- <target>`。
注意：errno 探针进程 rc=0 表示成功报告系统调用结果，真正拒绝判据是 `code=EPERM`；echo 则直接 rc=1。

**推断与未测**：两条 deny 在本机对上述路径/操作成立，支持继续主方案；不是对所有 macOS 版本或任意旁路的证明。
main 写盘边界未受影响；未做定制中心 UI 重装/真实 MCP 连接，也未做 dispose 后 ext→MCP 顺序、同名覆盖等第二步判据；不能据此宣称安装唯一通路已完成。
检查：`git diff --cached --check` 通过；文档合同检查仅报基点已有 `docs/evidence/` 目录的 35 项布局错误，本次目录零发现，未越界修复。
按派发要求在第一步停下，等待编排器核验后续派。

## 第三步:目录身份 / 硬链 / 原子交换的 seatbelt 语义(修订方案的地面真相)

2026-10-15,为 [修订方案](../../design/2026-10-15-req234-c2-revised-plan.md) §1.3 补的实测。基点 `d6da03544`(工作树带未提交草稿;
探针把草稿加进 profile 的 `(deny file-write* (…))` 行剥掉后得到 **head 臂**,其余三臂都从同一份生产 planner 输出派生)。
macOS 26.3.1 arm64、Bun 1.3.14、`/usr/bin/sandbox-exec`;隔离 HOME 在本目录临时树内(位于 `/Users`,不落入 W11/W12);
不读用户配置或密钥。脚本 [dir-identity-probe.ts](dir-identity-probe.ts)(辅助 [fs-probe2.mjs](fs-probe2.mjs)、
[syscall-probe.py](syscall-probe.py)),完整矩阵与四份 profile 在 [dir-identity-results.json](dir-identity-results.json)。

R1 审计后扩展(审计 ①②③④):加入 auth.json / installs.json 文件、`{tool,tools}` 自动执行目录、`<dataHome>/opencode` 目录身份、`G/ext-tx` 真源,
以及「工作区祖先」反例臂。

```sh
PROBE_PYTHON=/Users/tide/app/trader/.venv/bin/python3 bun docs/verification/2026-10-15-req234-c2-fence-preverify/dir-identity-probe.ts
# rc=0;rows=656 scenarios=163 failures=0;RESULT: all expectations hold
```

四臂:`head`(HEAD profile)· `draft`(head + 草稿两行)· `cand`(head + 完整 deny 集:**13 文件 literal**〔11 旧 + `<dataHome>/opencode/auth.json` + `<G>/installs.json`〕
+ **12 subpath**〔`{HO,XO,D}/{plugin,plugins,tool,tools}`〕+ **6 目录身份 literal**〔D、`~/.opencode`、`<XDG>/opencode`、`<G>`、`<U>`、`<dataHome>/opencode`〕
+ **C2-T**〔`(subpath <G>/ext-tx)`〕)· `cand-ws`(cand + 工作区根 `<home>/wsroot` 且其孙目录 `wsroot/xdg/opencode` 受身份保护 —— 模拟 XDG 选进工作区)。
上一轮的 `candlink` 臂(file-link)已证零差别,本轮去掉。G/U/HO/XO/D 含义同方案 §1.3。每行一次 `sandbox-exec`,每场景前重建整棵树。

| 场景(节选;完整 163 条见 results) | head | draft | cand | cand-ws |
| --- | --- | --- | --- | --- |
| 13 配置文件 × append/create/rename-over/unlink/symlink/hardlink-out/renamex/openat(含 auth.json、installs.json) | OK | 只 alpha.jsonc EPERM | EPERM | EPERM |
| `mv <dir> <ws>/stolen`、`ln -s`、`mkdir`、`rmdir`、`renameat` 顶替 D/HO/XO/G/U/`<dataHome>/opencode` | OK | OK | **EPERM** | EPERM |
| `mv U G/stash`、`mv G U/stash`(把 allow 根搬进另一个可写根) | **OK** | **OK** | EPERM | EPERM |
| `{HO,XO,D}/{plugin,plugins,tool,tools}` 建 `.js` / 软链目录(12 个,审计 ②) | OK | 仅 plugin EPERM | **EPERM** | EPERM |
| `G/ext-tx` 建 journal/staging 文件、改名目录;`G/installs.json` 写(审计 ④) | OK | OK | **EPERM** | EPERM |
| **工作区祖先**:`mv wsroot/xdg wsroot/xdg.old`(`xdg/opencode` 受保护,`xdg` 不受)(审计 ③) | EPERM | EPERM | EPERM | **OK(携带 opencode)** |
| 同上 child:`mv wsroot/xdg/opencode x` | — | — | — | EPERM |
| `<dataHome>/opencode` 之内写 log/db/repos、所有受保护目录 `mkdir -p`(已存在) | OK | OK | **OK** | OK |

读法:
- 文件 literal **挡住** append/create/rename/unlink/symlink/硬链出去/`renamex_np`/`openat`/`..`;目录 identity literal **挡住** rename/symlink/mkdir/rmdir/renameat。
  auth.json、installs.json 与旧 11 文件同形;tool/tools 与 plugin/plugins 同形;`<dataHome>/opencode` 与其它目录身份同形,**而其内的 log/db/repos 仍可写**(审计 ①)。
- **工作区祖先(审计 ③;R1 演示的是「有这个口」)**:只保护目录自身、而它的**父目录是可写工作区**时,改名父目录可整体携带子目录 —— cand-ws 臂 `mv wsroot/xdg …` = **OK**(opencode 一起走)。
  **修法在 R2 改定**:不是「`selectWorkspaceUnion` 排除祖先候选」(那会把 `XDG_CONFIG_HOME=<ws>/.config` 下的默认工作区也剔除、拒绝 fork),而是**锁住可写祖先目录的身份**,见第五步与方案 §2.1 机制 2。子目录自身改名四臂皆 EPERM。
- 兼容性:已存在目录上的 recursive `mkdir -p` 不触 deny(内核先回 EEXIST),`core/global.ts:35-43`、`alpha-config-injection.ts:123` 这类不会红;真引擎臂由方案 I5′ 兜底。

## 第四步:事务恢复回滚把攻击者 preImage 写回 `alpha.jsonc`(审计 ④,攻击确认)

脚本 [journal-rollback-probe.ts](journal-rollback-probe.ts)。用真生产事务引擎 `runExtensionTransaction` crash 出一份合法 journal+staging(mid-switch,两个 config item),
再做在围栏内(W2)可做的两个写:覆盖链首 staged `config-0.pre` = 攻击 JSON、把该项 `preDigest` 改成其哈希;然后跑 `recoverExtensionTransactions`。

```sh
bun docs/verification/2026-10-15-req234-c2-fence-preverify/journal-rollback-probe.ts
# {"recoveryOk":true,"reportAction":"rolled-back","journalState":"rolled-back","attackerLanded":true}
# RESULT: ATTACK CONFIRMED — recovery wrote attacker preimage into alpha.jsonc
```

**恢复参数(R2 finding 6 订正)**:`journal-rollback-probe.ts` 传 `{ commitReceipt, pidAlive, log }`,是**该回滚分支的等价参数**,不是「生产全集」——
生产(`ext-ipc.ts:725-745`)还提供 `probe` 与 `receiptCommitted`。等价理由:journal item_0 翻转、item_1 未翻转 ⇒ `allFlipped=false`(`ext-transaction.ts:2545`)⇒
不进 `allFlipped && probe && commitReceipt` 前向分支(`:2547`),`probe` 改不了结果;无 receipt 项 ⇒ `receiptCommitted` 返回 false(确证未 durable ⇒ 允许回滚)。
[journal-rollback-equiv-probe.ts](journal-rollback-equiv-probe.ts) 带真 `probe`+`receiptCommitted` 重跑,`attackerLanded:true` 仍成立。

`readStagedConfigImage` 只拿 staged 字节比 journal 自带的 `preDigest`(`ext-config-tx.ts:164`),两者都在 W2 ⇒ 校验挡不住;回滚链在 live==`nextDigest` 时写回链首 preImage
(`ext-transaction.ts:2731-2744`)。此路**独立于**账本(installs.json)路径。⇒ C2-T(`G/ext-tx` + `G/installs.json`)是必须保护(方案 §3.2 I7′)。

## 第五步:可写祖先身份锁(R2 findings 1 & 2)

脚本 [writable-ancestor-probe.ts](writable-ancestor-probe.ts)。实现拟议助手 `writableAncestorIdentities(实际渲染的 W1–W19 allow 根, 受保护目标)`,在三个 XDG 拓扑 ×{head,cand}下验证。

```sh
bun docs/verification/2026-10-15-req234-c2-fence-preverify/writable-ancestor-probe.ts
# helper: default -> empty (XDG under HOME); xdg-data-under-U -> U/xdg; xdg-config-under-ws -> <ws>/.config
# rows=28 failures=0; RESULT: all expectations hold
```

- **finding 1**(`XDG_DATA_HOME=U/xdg`,dataHome 落进 W3=U):助手产出 `U/xdg`;cand 下 `mv U/xdg …` EPERM、head 下 OK(反例);`auth.json` 写 EPERM;`U` 普通文件写仍 OK。
- **finding 2**(`XDG_CONFIG_HOME=<ws>/.config`,落进默认工作区 W1):助手产出 `<ws>/.config`;cand 下 `mv <ws>/.config …` EPERM;**而默认工作区仍被选中、`<ws>/probe.txt` 可写**(不改 `selectWorkspaceUnion`,不拒 fork)。
- 机制:锁的是「可写根之内、受保护目标之上」的中间目录身份,从**实际 allow 根**派生(不是写死清单)。默认拓扑产出空集,零额外 deny。
