---
id: SPEC-tool-write-fence
title: 工具派生进程越界写文件时会失败
summary: 工具派生进程越界写文件时会失败，保留历史条款、有效裁决和交付证据边界。
kind: spec
status: approved
version: 1
approved_by: backfill
approved_at: 2026-11-10
owners: [owner]
last_reviewed: 2026-11-10
---

# 工具派生进程越界写文件时会失败

工具派生进程越界写文件时会失败。这份规格保留已提出的结果及其证据，让使用者能区分已具备的能力与仍需补齐的部分。尚未做过的实机验证不会被写成通过。

## 来源

- [原需求与处置 impharaon/alpha-work:RQ-safety](https://github.com/impharaon/alpha-work/blob/d4a80d9c2ef0df32c58173310d9e368fa7bc9069/docs/requests/RQ-safety.md)。
- 历史身份：[impharaon/alpha-code#1074](https://github.com/impharaon/alpha-code/issues/1074)；原题名与编号保留，当前交付状态以 GitHub 为准。
- Epic：[能力分组](https://github.com/impharaon/alpha-work/issues/142)。
- [有效范围或验收依据 2026-08-26](https://github.com/impharaon/alpha-code/issues/1074#issuecomment-5423064688)。
- [有效范围或验收依据 2026-08-26](https://github.com/impharaon/alpha-code/issues/1074#issuecomment-5423135379)。

## 用户与范围

- 用户：使用 Code Puppy 桌面、官网或云服务的用户；具体入口见下列原条款。
- 包括：下表原编号覆盖的结果；被删除或替代的条款保留删除记录，不继续作为当前交付承诺。
- 不包括：原票未承诺的新能力与未经批准的扩展范围。
- 有效范围与证据限制：打包 wrapper 正反语料已跑；真实模型整链与 hardened runtime 是 alpha-code#1144 的独立范围，不补写为本票已测。
- 现行实现/测试文件已在本次基线中找到（仅核实存在，本次未执行产品测试）：
  - [alpha-code:packages/console/app/src/config.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/console/app/src/config.ts)
  - [alpha-code:packages/core/src/config.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/core/src/config.ts)
  - [alpha-code:packages/core/src/shell.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/core/src/shell.ts)
  - [alpha-code:packages/core/src/tool/write.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/core/src/tool/write.ts)
  - [alpha-code:packages/core/src/v1/config/config.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/core/src/v1/config/config.ts)
  - [alpha-code:packages/opencode/src/cli/cmd/debug/config.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/opencode/src/cli/cmd/debug/config.ts)
  - [alpha-code:packages/opencode/src/config/config.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/opencode/src/config/config.ts)
  - [alpha-code:packages/opencode/src/server/routes/instance/httpapi/groups/config.ts](https://github.com/impharaon/alpha-code/blob/e56ae0c03603a6540cd01043d64d590c6f7e2930/packages/opencode/src/server/routes/instance/httpapi/groups/config.ts)

## 业务规则

- **BR-01** 工具派生进程越界写文件时会失败。具体边界按下列原条款及本节所引裁决限定，不以历史完成状态扩大范围。

## 验收

条文从原票照搬，保留编号；原编号 AC1 对应 AC-01，子编号仍保留。原文中的日期与实测状态均是历史记录。涉及变更时先修订规格，不在票面复制第二份需求。

| ID | Given / When / Then（历史原文） | 依据 |
| --- | --- | --- |
| AC-01 | — 派生 shell 只有一条通路，缺失即响亮失败**<br>到达「引擎为工具派生子进程」的 shell 唯一来自 `cfg.shell`，且它恒指向 Alpha<br>wrapper（wrapper 内 `exec sandbox-exec -f <profile>` 再 exec 用户的真 shell）。<br>wrapper 或 profile 不可用时会话启动**失败且错误可读**，不回落裸 shell。<br>_证明：`alpha-sandbox-seam.test.ts`_ | [原票](https://github.com/impharaon/alpha-code/issues/1074) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1074#issuecomment-5423135379) |
| AC-02 | — 可写集合有单一权威，且判据双向成立**<br>一次会话的可写路径集合只由 profile 的 `WORKDIR` 参数与 profile 内登记的固定<br>前缀决定；单一权威 = profile 文件本身，不在别处写散文枚举。逃逸语料在围栏下<br>**文件不落盘**；**同一语料在围栏移除后落盘**。<br>_证明：`alpha-sandbox-escape.test.ts`（正反两跑）_ | [原票](https://github.com/impharaon/alpha-code/issues/1074) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1074#issuecomment-5423135379) |
| AC-03 | — 用户改配置不产生无围栏执行**<br>`shell` 是合法 config 键（`packages/opencode/src/config/config.ts:174`）且可被手改。<br>config hook 每次配置加载都重新**包裹**用户取值（包住，不是替换）；手改配置文件后<br>下一次加载仍被包裹。<br>_证明：`alpha-sandbox-reassert.test.ts`_ | [原票](https://github.com/impharaon/alpha-code/issues/1074) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1074#issuecomment-5423135379) |
| AC-04 | — 打包产物上成立**<br>基线 §2.5/§2.6 的正反语料在**打包后的 Electron sidecar** 里复跑，结论一致。<br>基线 §5 把这条列为未验证，本 AC 负责把它变成实跑结论。<br>_证明：`[REQ-138][VERIFY]` 子票_ | [原票](https://github.com/impharaon/alpha-code/issues/1074) · [最后裁决](https://github.com/impharaon/alpha-code/issues/1074#issuecomment-5423135379) |

## 待决

无新的产品裁决；上列历史边界与尚未执行的 Acceptance 继续有效。

## 批准记录

| 版本 | 日期 | 批准人 | 原话或链接 |
| --- | --- | --- | --- |
| 1 | 2026-11-10 | backfill | 按 owner「继续，直接完成所有我让你做的事情。」补录已有交付；[历史依据](https://github.com/impharaon/alpha-code/issues/1074#issuecomment-5423135379)，本次不新增验收结论。 |
