---
id: ARCH-shell-sandbox-evidence-pointer
title: 旧 shell 沙箱勘破的历史证据入口
summary: 为不可变验收记录保留旧路径，指向归档原件与现役整进程围栏。
kind: architecture
status: active
owners: [owner]
last_reviewed: 2026-11-10
---

# 旧 shell 沙箱勘破的历史证据入口

原 C1 方案已由整进程围栏替代。完整原件已进入[废弃资产目录](../archive/assets/architecture/2026-08-23-shell-sandbox-seam.md)，其字节保持不变；现行架构为[整进程围栏](2026-09-09-req159-process-fence.md)。

这个小入口仅保留旧的不可变验收记录中的相对链接。它不承载旧方案，也不恢复已经删除的 wrapper 实现。
