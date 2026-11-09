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
([[ADR-037]] 决策 5)。前端投影 `packages/{app,ui}` 的 pin 在切换时与引擎是同一个 SHA,之后保持同一代次(照 [[ADR-034]] 月更,不冲突)。为 v2 读侧另写一份配置的桥
(`codepuppy-config-injection.ts` 的 `OPENCODE_CONFIG_DIR` 剥 key 段)随之删除。

## 决策 2 —— 集成形状:树按上游重建,历史照常合并

一次受审上游集成,落在一个真合并提交上,第二父是选定的上游 dev SHA(ci.md §4 第 3 条)。合并提交的树按规则构造:上游路径取上游原样
(上游删除的就删除),Code Puppy 自有路径取 alpha;此后在同一整合分支上把主权层改挂到 OpenCode 2 的接缝上;整条分支以
`gh pr merge --merge` 一次合进 `alpha`。

- 合并目标取最新发布标签在 dev 线上的父提交(今天是 v2.2.6 → `33f94fce96`),不取 dev 头,也不取标签本身。
- 上游祖先不得丢:合并提交直推整合分支或以 `gh pr merge --merge` 合入;整合分支吸收 `alpha` 只用 merge,禁止 squash / rebase;
  `git merge-base --is-ancestor <上游 SHA> HEAD` 在每次推送与最终合并前为真,且有「squash 重放后必须红」的反向用例。
- 含受审上游合并的分支上,north-star 守卫的 `packages/` 辖区以该合并的上游父为基准判(不再以 `origin/alpha` 为基准);lane 推送不靠 `--no-verify`。
- `packages/` 之外逐文件定归属:上游来源的跟上游 SHA 增删,Code Puppy 的跟 alpha;随合并新出现的上游 workflow 在合入前列清单、合入后逐个 `gh workflow disable`。
- 被否决:逐冲突移植(冲突表不是能力清点,且自动合入会静默混入旧改动);重新 fork(断掉 990 个提交的历史与 merge-base);
  先过 1.19.5(它在 1.x 维护线上,对到达 2.x 零推进)。

## 决策 3 —— 引擎宿主:嵌在 Electron `utilityProcess` 里;不用上游的机器级后台服务

在已装进程围栏的 `utilityProcess` 里 import `@opencode/server/process` 并启动(进程围栏、ext 的 `parentPort` 桥、进程内调用形状不变)。
L1a 实测(合成数据,勘破文档 `docs/architecture/2026-11-09-1662-l1-engine-host-spike.md`,提交 `0bfbdfb205`)在 Electron 42 的 Node 24.15 上
满足「能起并完成回复 / 进程内调用与监听共用一张应用图 / 旧对话转换可在 Node 下运行」三条,宿主据此定为嵌入式(裁决书 R13);
「打包上游 bun 编译的 CLI 作为围栏内私有子进程」只在这三条被推翻时才启用。实现必须同时守住:进程内接法取 `start()` + `Transform`
并传 `lifecycle`(启动时续跑中断会话),不取 `ServerFetch.make`;`http.setGlobalProxyFromEnv()` 留在 import 引擎之前,否则模型请求绕开出网代理;
传给引擎的渠道是发布渠道(`local`/`dev` 会默认打开五个实验开关)。**不得**使用上游的 `serve --service` 机器级共享服务:它与用户自装的
OpenCode 共用服务、库与凭证。

嵌入式下上游 CLI 宿主不在路径上(配置、模型目录、库路径的环境变量在 core 与 server 里没有读者,是 CLI 映射进 `start()` 的选项),
所以由 sidecar 自己构造 `ServerOptions` 与 `Global` 层;其中库路径的推导与 Code Puppy 的 DB 安全带共用一个函数,不再造一份上游宿主的决定。

## 决策 4 —— 主权层的挂载与接管

- 按 [[ADR-029]] 阶梯自下而上找挂载点:先 L0(`@codepuppy/ext` 作为 OpenCode 2 插件、配置注入、`policies`),再 L1,最后 L3。
- 旧接管清单不继承。仍存在的 15 条路径逐条重判;随文件消失的 34 条删除。新清单在本 ADR 的「精确接管面」一节逐条写范围、守卫、回滚与归属,
  由实现 lane(基线 L4)在本 ADR 转 accepted 之前填齐。
- **权限咽喉的唯一形状:** 到达工具执行的唯一通路是 `Tool.execute` 的 `execute.before`(`packages/core/src/tool.ts`);Code Puppy 的执行闸挂在
  那里、对未知工具身份默认拒,且在它之后的任何钩子都不能改写已核准的输入或结论(OpenCode 2 的钩子按注册顺序串行执行并共享同一事件对象)。
  目录闸挂在 `session.hook.context` 的工具表与 `tool.transform` 上,并盖住 Code Mode 的目录(MCP 工具默认进 Code Mode):往 Code Mode 的
  snapshot 规则集注入 deny,或对 Code Puppy 管的 MCP server 注入 `codemode: false`,实现二选一。
- 工具改名(`bash`→`shell`、`task`→`subagent`、`apply_patch`→`patch`):策略与 agent 规则一次换成新名;身份账本([[ADR-041]])与 UI
  同时认新旧两个名字 —— 旧对话转换不改历史里的工具名,只追加一条给模型的提示。未知名字的规则加载时响亮报出。
- 外部生态默认拒绝不变:嵌入时显式关闭 OpenCode 2 对 `.claude` 的读取;`~/.agents` 与项目 `.agents` 两类技能根不受这个开关管,
  在 L0 以配置 `plugins` 的移除指令 `-opencode.config.compatibility` 关掉;第三方插件只经 ext 扇出、在同意之后装载。
- 引擎可用的凭证只来自 Code Puppy 的注入;不导入数据目录里不属于 Code Puppy 的凭证文件 —— 做法是首次以 OpenCode 2 启动前处置
  数据目录里的 `auth.json`(导入迁移不看配置,配置拦不住)。

### 精确接管面

(待基线 L4 填写:每行 = 路径 / 为什么挂不了钩子 / 守卫 / 回滚 / 归属。)

## 决策 5 —— 数据

- 第一次以 OpenCode 2 启动前由 DB 安全带做前进迁移备份;构建期迁移清单改由 OpenCode 2 的 `migration.gen.ts` 派生,并把 Code Puppy
  两条退役迁移的 id 以冻结清单并入 —— 否则安全带把老用户的库判为「库比应用新」,每次启动都阻断且前进前不备份。
- v1 旧对话在新代次可见、可继续。OpenCode 2 的转换只在 bun 条件下运行、Node 条件下是空实现;嵌入式宿主下由构建期变换接上
  (上游源码逐字不动):`#v1-migration` 改指上游的 bun 实现,两处 bun 专有调用做 Node 薄适配,其中 `Bun.CryptoHasher` 那处必做
  (裁决书 R14;L1a 合成库实测全部转换)。上游原版 Node 构建下旧对话静默全不可见而状态报 `completed`,所以这一步不可省。转换会删 `event` 表的行,并对每个
  被转换的会话先删它在 `session_message` 里已有的行再写入转换结果;旧格式的 `message`/`part` 不删。
- 新增的 Code Puppy 自有表名以 `_` 开头(OpenCode 2 约定嵌入方自有表用该前缀)。

## 缺项(ADR-037 决策 3:缺项必须点名并由 owner 拍板)

| 缺项 | 用户可观测后果 | 状态 |
| --- | --- | --- |
| 「分享对话」:OpenCode 2 没有分享接口,上游 1.x 维护线也已停掉分享 | 侧栏「分享」菜单项无法工作(该功能在 0.1.26 里今天已不可用:`https://opncd.ai`、`/api/share` 均返回 `410`) | owner 已裁决(2026-11-09,原话「路一」,见裁决书 R6):随换代拿掉该菜单项;以后要分享另立需求自建 |
| v1 旧对话转换(仅当决策 5 的补法与改宿主都不通时成立) | 升级后侧栏看不到旧对话(数据仍在库中) | 不触发(裁决书 R14,L1a 合成库实测补法可行);L1b 真库副本若推翻,按基线 §7 O1 重新递 owner |

## 后果

- ➕ 每日同步重新跟随上游主线;上游修复与新能力可经正常同步获得。
- ➕ ADR-036 登记的两项已知缺口随之闭合:审批停靠区只有一条事件通道;v2 的持久输入队列语义回来。
- ➕ 北极星偏离 `packages/plugin/package.json` 的 `./alpha-cloud-authority` 导出可移除(OpenCode 2 的 `@opencode/plugin` 有通配导出)。
- ➖ 主权层(ext、ui-mac 主进程接线、renderer 数据层、前端补丁)整体重写一次;量级见基线 §4.3。
- ➖ 撤回一个带上游祖先的合并,要同时暂停每日同步,重新落地要 revert 那次 revert(基线 §6)。
- ⚠️ Code Puppy 的库与数据目录仍与用户自装的 OpenCode 同路径;本 ADR 只保证不导入不属于 Code Puppy 的凭证;本票不搬目录(编排器已定,裁决书 R5),目录搬迁是一次独立的数据迁移,另行裁决。
- 🔁 [[ADR-036]] 被本 ADR 取代(accepted 时把 ADR-036 的状态改为 superseded)。
