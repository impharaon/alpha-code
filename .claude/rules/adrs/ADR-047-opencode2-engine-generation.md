---
id: ADR-047
title: Code Puppy 引擎整体切到 OpenCode 2 —— 单一代次;树按上游重建、历史照常合并;主权层改挂 OpenCode 2 插件钩子;取代 ADR-036
status: proposed
date: 2026-11-08
supersedes: ADR-036
related: [ADR-005, ADR-015, ADR-029, ADR-033, ADR-034, ADR-037, ADR-041, ADR-043, ADR-044, ADR-046]
issue: https://github.com/impharaon/alpha-code/issues/1662
---

> 草案。依据与全部实测见方案基线
> [`docs/design/2026-11-08-1662-opencode2-generation-switch-baseline.md`](../../../docs/design/2026-11-08-1662-opencode2-generation-switch-baseline.md)
> 与能力清点表
> [`docs/design/2026-11-08-1662-opencode2-capability-inventory.md`](../../../docs/design/2026-11-08-1662-opencode2-capability-inventory.md)。
> 本 ADR 是 [[ADR-037]] 决策 2 第 3 条要求的「独立决策」;形状(独立票、独立 PR、能力清点、端到端判据、禁止半代次)仍归 ADR-037。

## 背景

上游 2026-10-09 在 `055d95bb` 切出 1.x 维护线,`dev` 从此是 OpenCode 2;`origin/alpha` 正停在这个公共点(1.18.35)。
OpenCode 2 删除了 Code Puppy 今天运行的整个 v1 引擎包(`packages/opencode`),HTTP 接口全部换成 `/api/*`,插件 API 换成按 domain
提供钩子与变换的一套。每日同步自 2026-10-11 起连续失败(`#1408`),根因即此。owner 2026-11-08:「我希望可以升级到 opencode 2 最新版本。」

[[ADR-036]] 把会话发送留在 v1,并给「迁到 v2」定了三条准入判据。在 OpenCode 2(`33f94fce96`)上三条都成立:
① MCP 运行时在 `packages/core/src/mcp/`(依赖 `@modelcontextprotocol/*` 2.3.1);② 钩子挂载点有 `tool.hook["execute.before"/"execute.after"]`
与 `session.hook.context`(含 `system`);③ 配置的 content 通道支持 `{file:}` 替换。且 2.x 里已没有 v1 可留,ADR-036 的前提不复存在。

## 决策 1 —— 全部链路一次切到 OpenCode 2,不留任何 v1 链路

会话发送、事件流、审批、配置、模型目录、MCP、工具执行、持久化,全部到达 OpenCode 2 的接口面;同一条用户流程的所有入口处在同一代次
([[ADR-037]] 决策 5)。前端投影 `packages/{app,ui}` 的 pin 与引擎是同一个 SHA。为 v2 读侧另写一份配置的桥
(`codepuppy-config-injection.ts` 的 `OPENCODE_CONFIG_DIR` 剥 key 段)随之删除。

## 决策 2 —— 集成形状:树按上游重建,历史照常合并

一次受审上游集成,落在一个真合并提交上,第二父是选定的上游 dev SHA(ci.md §4 第 3 条)。合并提交的树按规则构造:上游路径取上游原样
(上游删除的就删除),Code Puppy 自有路径取 alpha;此后在同一整合分支上把主权层改挂到 OpenCode 2 的接缝上;整条分支以
`gh pr merge --merge` 一次合进 `alpha`。

- 合并目标取最新发布标签在 dev 线上的父提交(今天是 v2.2.6 → `33f94fce96`),不取 dev 头,也不取标签本身。
- 被否决:逐冲突移植(冲突表不是能力清点,且自动合入会静默混入旧改动);重新 fork(断掉 990 个提交的历史与 merge-base);
  先过 1.19.5(它在 1.x 维护线上,对到达 2.x 零推进)。

## 决策 3 —— 引擎宿主:嵌在 Electron `utilityProcess` 里;不用上游的机器级后台服务

默认在已装进程围栏的 `utilityProcess` 里 import `@opencode/server/process` 并启动(进程围栏、ext 的 `parentPort` 桥、进程内调用形状不变)。
若实测不能在 Electron 42 的 Node 24.15 上满足「能起并完成回复 / 进程内调用与监听共用一张应用图 / 旧对话转换可在 Node 下运行」三条,
改为打包上游 bun 编译的 CLI,作为围栏内的私有子进程运行。**不得**使用上游的 `serve --service` 机器级共享服务:它与用户自装的
OpenCode 共用服务、库与凭证。

## 决策 4 —— 主权层的挂载与接管

- 按 [[ADR-029]] 阶梯自下而上找挂载点:先 L0(`@codepuppy/ext` 作为 OpenCode 2 插件、配置注入、`policies`),再 L1,最后 L3。
- 旧接管清单不继承。仍存在的 15 条路径逐条重判;随文件消失的 34 条删除。新清单在本 ADR 的「精确接管面」一节逐条写范围、守卫、回滚与归属,
  由实现 lane(基线 L4)在本 ADR 转 accepted 之前填齐。
- **权限咽喉的唯一形状:** 到达工具执行的唯一通路是 `Tool.execute` 的 `execute.before`(`packages/core/src/tool.ts`);Code Puppy 的执行闸挂在
  那里、对未知工具身份默认拒,且在它之后的任何钩子都不能改写已核准的输入或结论(OpenCode 2 的钩子按注册顺序串行执行并共享同一事件对象)。
  目录闸挂在 `session.hook.context` 的工具表与 `tool.transform` 上。
- 工具改名(`bash`→`shell`、`task`→`subagent`、`apply_patch`→`patch`)在策略、agent 规则、身份账本([[ADR-041]])、UI 里一次换完;
  未知名字的规则加载时响亮报出。
- 外部生态默认拒绝不变:嵌入时显式关闭 OpenCode 2 对 `.claude` 的读取;第三方插件只经 ext 扇出、在同意之后装载。
- 引擎可用的凭证只来自 Code Puppy 的注入;不导入数据目录里不属于 Code Puppy 的凭证文件。

### 精确接管面

(待基线 L4 填写:每行 = 路径 / 为什么挂不了钩子 / 守卫 / 回滚 / 归属。)

## 决策 5 —— 数据

- 第一次以 OpenCode 2 启动前由 DB 安全带做前进迁移备份;构建期迁移清单改由 OpenCode 2 的 `migration.gen.ts` 派生。
- v1 旧对话在新代次可见、可继续。OpenCode 2 的转换只在 bun 条件下运行、Node 条件下是空实现;嵌入式宿主下由构建期变换接上
  (上游源码逐字不动)。做不到时按决策 3 改宿主;仍做不到则作为缺项交 owner(见「缺项」)。
- 新增的 Code Puppy 自有表名以 `_` 开头(OpenCode 2 约定嵌入方自有表用该前缀)。

## 缺项(ADR-037 决策 3:缺项必须点名并由 owner 拍板;本草案只列出,未裁决)

| 缺项 | 用户可观测后果 | 状态 |
| --- | --- | --- |
| 「分享对话」:OpenCode 2 没有分享接口,上游 1.x 维护线也已停掉分享 | 侧栏「分享」菜单项无法工作 | 待 owner 裁决(基线 §7 O3) |
| v1 旧对话转换(仅当决策 5 的两条补法都不通时成立) | 升级后侧栏看不到旧对话(数据仍在库中) | 有条件,待 L1 实测(基线 §7 O1) |

## 后果

- ➕ 每日同步重新跟随上游主线;上游修复与新能力可经正常同步获得。
- ➕ ADR-036 登记的两项已知缺口随之闭合:审批停靠区只有一条事件通道;v2 的持久输入队列语义回来。
- ➕ 北极星偏离 `packages/plugin/package.json` 的 `./alpha-cloud-authority` 导出可移除(OpenCode 2 的 `@opencode/plugin` 有通配导出)。
- ➖ 主权层(ext、ui-mac 主进程接线、renderer 数据层、前端补丁)整体重写一次;量级见基线 §4.3。
- ➖ 撤回一个带上游祖先的合并,要同时暂停每日同步,重新落地要 revert 那次 revert(基线 §6)。
- ⚠️ Code Puppy 的库与数据目录仍与用户自装的 OpenCode 同路径;本 ADR 只保证不导入不属于 Code Puppy 的凭证,目录搬迁另行裁决(基线 §7 O2)。
- 🔁 [[ADR-036]] 被本 ADR 取代(accepted 时把 ADR-036 的状态改为 superseded)。
