---
id: ADR-050
title: 密钥输出在引擎发布前由扩展遮盖
summary: SC-01 在同一 shell 捕获回调内逐段发布、终态替换并清理孤立密文；SC-02 收口根工具进度，秘密规则归 Ext。
kind: adr
status: accepted
date: 2026-11-27
owners: [owner]
last_reviewed: 2026-11-27
related: [ADR-029, ADR-047, ADR-048]
---

# 密钥输出在引擎发布前由扩展遮盖

依据：[规格 v4](../../../docs/specs/secrets-usable-not-visible/spec.md) 与冻结设计 v3.3 @ `f988de5eb1` 的 §4.5/4.8/§10。本文只登记已批准的接管，不另定范围。

## SC-02：根工具进度

owner 2026-11-27，协调仓 INT-safety U-40（r5 派单转录）：「Cargo 选 1，第二处引擎改动允许，Supabase 报告批准」。本票只消费第二处引擎改动的批准。SC-01 的 U-38「好的。」不作为 SC-02 的授权。

现成 transform 包装不到合成 Code Mode 根工具；事件订阅和桌面过滤晚于 publisher 缓存及取消失败记录。接管仅为：

- `packages/core/src/tool.ts`：before 与有效名称解析后，根 context.progress 先触发 execute.progress，再交原 publisher；回调故障或在运行中失效时整次输出隐藏，执行器继续运行。
- `packages/plugin/src/effect/tool.ts`、`promise/tool.ts`、`promise/adapter.ts`：同形可改写 metadata 事件、never 失败类型与 Promise 分派。

秘密名单、采集与替换归 `packages/ext/src/secret-mask.ts`，尾部接线归 policy/index.ts；安全副本锁定以阻止后置 hook 回填。普通注册工具不再重复遮盖，原包装保留 display 与终态重投影回调；子工具 progress 仍是原 noop。取消/defect 的根状态由现有终态事件订阅释放。Core 不持秘密值，不改 Code Mode runtime、publisher、Bus、持久 projector 或桌面协议。

权威册 ID 为 `secrets-tool-progress`。真实判据为 tool-registry 的根改写/故障/释放、Promise 回调 reject，以及 register-policy 的合成外层、后置改写和取消缓存用例。上游升级须复核根 progress 是否仍早于 publisher、Effect/Promise 事件是否同形、失败是否隐藏且继续执行、后置 hook 是否能回填原值。

## SC-01：独立捕获面

owner 2026-11-26，U-38「好的。」批准同一 Core Shell 捕获/清理生命周期及 Effect/Promise 两面；U-39「这两个你的建议是什么，按你的建议吧。」批准直播与先打印后落盘的窄窗口。v3.3 在同一 SC-01 内补 `publish(chunk): Promise<void>`，不新增 hook 或授权。

- `packages/core/src/shell.ts`：spawn 前锁存 capture 模式；按源流顺序触发 chunk/end，提供仅调用期有效的顺序 publish，write 回调与 drain 完成后计数；失去注册、回调或 IO 故障锁存隐藏且继续进程。end 在关闭 writer、替换最终文件/计数后才开放完成通知。失败由 Core 原子替换仅说明文件；说明文件 IO 也失败时直接提供说明正文，不返回旧文件引用。cleanup 只回收命名合规且 owner 确认退出的孤立密文，EPERM/未知 owner 留存，原 out 保留期不变。
- `packages/plugin/src/effect/shell.ts`、`promise/shell.ts`：同形只读输入 bytes 与调用期 publish、可变 disposition/replacement。现有 Promise generic adapter 原样传递函数。
- Ext 的 `secret-mask.ts` 持有同一 Location 采集与 shell 事务；`secret-stream.ts` 以 shared stripAnsi 适配增量边界/真前缀；`secret-spool.ts` 持 RAM key、AES-GCM 认证帧与总量核对。所有源文件、子进程环境与入参不因遮盖变化；Core 不持名单/匹配规则。

权威册 ID `secrets-output-capture` 与 SC-02 独立。proof 指向真实 Core Shell live/replace、故障且退出码保持、失效/并发发布、磁盘失败无旧引用、Ext 前后并集、真实原 writer 可用及 cleanup 的命名测试。升级核对顺序、背压、函数失效、所有终态消费者的同一文件，以及错误不能清除锁存；不接管 Bus/UI/Code Mode runtime。完整会话与一分钟场景归⑤，登记不冒充这些验收已完成。
