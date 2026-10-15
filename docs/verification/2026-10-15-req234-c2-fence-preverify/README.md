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
