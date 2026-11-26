---
id: ADR-050
title: 密钥输出在引擎发布前由扩展遮盖
summary: SC-02 统一根工具进度的发布前事件；SC-01 的 shell 捕获另随实际实现登记，秘密规则始终归 Ext。
kind: adr
status: accepted
date: 2026-11-27
owners: [owner]
last_reviewed: 2026-11-27
related: [ADR-029, ADR-047, ADR-048]
---

# 密钥输出在引擎发布前由扩展遮盖

依据：[规格 v3](../../../docs/specs/secrets-usable-not-visible/spec.md) 与冻结设计 v3.1 @ `832ab5a4f4` 的 §4.8/§10。本文只登记已批准的接管，不另定范围。

## SC-02：根工具进度

owner 2026-11-27，协调仓 INT-safety U-40（r5 派单转录）：「Cargo 选 1，第二处引擎改动允许，Supabase 报告批准」。本票只消费第二处引擎改动的批准。SC-01 的 U-38「好的。」不作为 SC-02 的授权。

现成 transform 包装不到合成 Code Mode 根工具；事件订阅和桌面过滤晚于 publisher 缓存及取消失败记录。接管仅为：

- `packages/core/src/tool.ts`：before 与有效名称解析后，根 context.progress 先触发 execute.progress，再交原 publisher；回调故障或在运行中失效时整次输出隐藏，执行器继续运行。
- `packages/plugin/src/effect/tool.ts`、`promise/tool.ts`、`promise/adapter.ts`：同形可改写 metadata 事件、never 失败类型与 Promise 分派。

秘密名单、采集与替换归 `packages/ext/src/secret-mask.ts`，尾部接线归 policy/index.ts；安全副本锁定以阻止后置 hook 回填。普通注册工具不再重复遮盖，原包装保留 display 与终态重投影回调；子工具 progress 仍是原 noop。取消/defect 的根状态由现有终态事件订阅释放。Core 不持秘密值，不改 Code Mode runtime、publisher、Bus、持久 projector 或桌面协议。

权威册 ID 为 `secrets-tool-progress`。真实判据为 tool-registry 的根改写/故障/释放、Promise 回调 reject，以及 register-policy 的合成外层、后置改写和取消缓存用例。上游升级须复核根 progress 是否仍早于 publisher、Effect/Promise 事件是否同形、失败是否隐藏且继续执行、后置 hook 是否能回填原值。

## SC-01：独立捕获面

U-38/U-39 已批准的 shell.capture、直播与终态收口继承冻结设计 §4.5/§10；本次未实施 SC-01，不登记不存在的 `secrets-output-capture` 机制或 proof。段④实施时在本 ADR 与同一权威册独立补齐，不能扩大 SC-02 的接管文件。
