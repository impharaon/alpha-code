---
id: PLAN-child-process-write-fence
title: 用户亲手打开的项目当场可写实施计划
summary: INT-safety 项目可写增量的文件、提交顺序、风险和 AC-05 至 AC-08 的正反验据。
kind: plan
status: active
spec: SPEC-child-process-write-fence
design: DESIGN-child-process-write-fence
owners: [owner]
last_reviewed: 2026-11-19
---

# PLAN-child-process-write-fence｜用户亲手打开的项目当场可写实施计划

## INT-safety：项目可写增量

- 依据：[SPEC-child-process-write-fence v2 / AC-05 至 AC-08](https://github.com/impharaon/alpha-code/blob/8593c2701d94d29b9a5de3de1db44639220fb637/docs/specs/child-process-write-fence/spec.md)；[冻结设计 §4、§5、§6、§10](design.md)（approved / reviewed_sha `8370b2fa23`，由 `9d3601c2aa` 合入）；2026-11-19 PLAN 派单及其 Decided point 5。读码基线为本集成分支 `4f61fde5de`；当前实现以本 worktree 已合入的冻结设计和 spec v2 为输入。
- 核对：Phase: IMPLEMENT — plan 6a1e42753b · orchestrator / Claude Fable 5.2 · plan check passed (every AC has proof with a failing arm; the three extra same-call-chain files `main/index.ts`, `ui/codepuppy-composer.tsx`, `ui/session-rail/terminal/terminal-engine-adapter.tsx` are accepted as necessary; no decision restated or changed). 2026-11-19 r1 仅实施步骤 1/G0，已验收；r2 授权按冻结设计实施步骤 2–8，六个打开动作记录点替换激活采样，探针与真源只消费登记。V2 按每臂实际落盘和 `r1-x2all-result.txt` 判定，不能要求所有签发都返回 NULL。

PLAN 阶段只提交本文件。下表和命令均为实施安排，不代表已经运行或通过；文档影响归类为 architecture/decision。后续实现沿用现有组件形态，不增加界面状态或交互稿。

### 改动

路径前缀 `main/`、`preload/`、`renderer/` 均相对于 `packages/ui-mac/src/`；`ui/` 表示 `renderer/codepuppy-ui/`。

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/native/codepuppy-fence/codepuppy_fence.c` | 实现设计 §4 的两个原生导出、参数校验和错误返回，复用现有 libsandbox 装载；不动钥匙串实现。攻击辅助 C 程序仅供测试，放同目录，来源见下文。 |
| `main/process-fence-apply.ts` | 对齐 `FenceAddon` 和加载校验；现有 apply 双向自证继续执行。 |
| `main/process-fence-profile.ts` | 落实设计 §4 profile 增量；抽出并集规则 4/5/5b 的逐候选判定供登记复用；写根 ID 登记 X1，类名只有此处一份。 |
| `main/process-fence-workspaces.ts` | 在既有真源权威内实现资格、打开登记和登记后的重算；真源过滤复用该资格，保持原有文件形状、排序及检疫处理。 |
| `main/workspace-write-probe.ts` | 承载设计 §4 的 grant 消息、解析和请求簿；区分 sidecar 真写探针事实与 main 汇总的放行结果，避免让 sidecar 伪造资格；保留未知错误的原文。 |
| `main/sidecar.ts` | 生产消息循环消费 grant 并回答；与引擎 ready 解耦，保持 apply 在引擎 import 之前。 |
| `main/server.ts` | 绑定当前 child/pid 的签发、请求簿接线、按代引擎放行成功账本及并发同目录请求合并；退出清理在途请求，失败不记成功；日志不含令牌。 |
| `main/ipc.ts`、`preload/index.ts`、`preload/types.ts` | 既有 probe 请求升级为 `{server,directory}`（无 open）、`workspace-open-record` 登记 IPC、选择器登记及返回顺序、资格变化通知；形状校验和失败映射依设计 §4。 |
| `ui/workspace-writable-core.ts`、`ui/workspace-writable.ts` | 步骤 4 独立实现 `recordWorkspaceOpen` 桥接与共享消费核心、含 server 的缓存、通知失效及 `whenSettled`；标记与原因选择共用一处判定。 |
| `ui/CodePuppyHome.tsx`、`ui/codepuppy-new-session.tsx`、`ui/session-workspace/codepuppy-session-workspace.tsx` | 三个宿主提供真实 server/directory、接入共享结果，去掉工作区重启回调；恢复、SSE、重挂不登记。 |
| `renderer/sidebar/codepuppy-sidebar.tsx`、`ui/workspace-chip.tsx`、`ui/codepuppy-session-search.tsx`、`renderer/automations/automation-panel.tsx` | 步骤 4 在 R1–R5 的具体打开动作先 await 登记再导航；R2 传整个会话行，R4 结果增加 directory，R5 使用任务目标目录及面板 server。 |
| `ui/session-workspace/session-workspace-shell.tsx`、`ui/workspace-chip.tsx`、`renderer/i18n/zh.ts`、`renderer/i18n/en.ts` | 正常可写路径无两个只读钩子；残余原因只显示设计 §4 对应一句，移除标题、脚注、按钮及指定旧键；保留终端沙箱告知。 |
| `packages/ext/src/policy/display.ts`、`packages/ext/src/context-injection.ts`、`packages/ext/src/context-injection-inventory.snapshot.txt` | 修正 `attachWriteDenied` 与 `sandbox.write-denied`，保留拒写后要求模型停止的能力；重生实际注入库存，不能手填字节数。归因规则见步骤 6。 |
| `ui/session-timeline/cards/tool-cards.tsx`、`ui/session-timeline/cards/tool-card-model.ts`、`ui/session-timeline/process-fold.tsx`、`ui/session-timeline/session-timeline.tsx`、`ui/session-timeline/cards/timeline-intents.ts` | 对话拒写说明缩成一句，按已有可证事实呈现；传递已知目标所需的最小数据，删 `relaunch` timeline intent 及生产接线。 |
| 同名相关 `*.test.ts`、`packages/ui-mac/test-component/{session-workspace,new-session-workspace,session-timeline}.cases.ts` 及各自 runtime、preload 组件 stub | 替换明确编码旧行为的断言；新增正反用例和所需桥接 stub。`.cases.ts` 仅由宿主启动。新验据宿主见「证明」。 |
| `scripts/process-fence-write-sites.tsv`、`main/process-fence-write-sites.ts` 及其测试、`scripts/gate-files.tsv` | 探针写/删行同步到 `W1+X1`，根校验消费 profile 的 ID；仅按实际改动同步调用点、计数与受托关系。 |
| `docs/architecture/2026-09-09-req159-process-fence.md` §2/§7/§8.2；`docs/design/2026-09-09-req159-process-fence-baseline.md` §三 I1 的事实陈述 | 仅完成设计 §6 点名的事实同步，保留历史批准与实验记录，不改其它设计、规则资产。`modules.md` 的包级落点不变。 |

**供计划核对的同调用链范围差异。** 派单 Handling problems §1 允许必要同调用链文件；以下三处未出现在初始文件枚举中，须随本节一起核对，不能通过另造发送入口或另一份资格绕开：

| 文件 | 必要性及最小改动 |
| --- | --- |
| `main/index.ts` | 当前真源对象与当前 `server` 的持有者及 IPC 依赖注入处（`:975-997`）；只接登记/通知/当前监听器所需依赖及无活引擎的结果，避免第二个全局 authority。 |
| `ui/codepuppy-composer.tsx` | 真实发送分叉在 `:1828-1847`，随后分别走 `startChat`、prompt、command；在这里调用共享 `whenSettled`，三个页面上的 `onSubmitted` 都已经太晚。不改发消息协议。 |
| `ui/session-rail/terminal/terminal-engine-adapter.tsx` | `useCodePuppyTerminalEngineChannel` 是首页与会话共用的生产铸造点（`:164-185`），创建最终经 core `:125` 的 `engine.new`；在适配器包装现有 create 调用等待共享结果，不改 channel 公共形状，不阻断已有终端输入。 |

### 顺序

1. **G0：出货形态入口闸，独立提交单元、独立通过/失败记录，先于其余实现。**
   - 先提交 `main/process-fence-extension-packaged.test.ts` 宿主与同名 `.cases.ts`、必要测试辅助源码；在旧实现运行，保存缺失导出/无法运行期放行的红证据。随后只落闸所需的生产原生导出、profile、grant 合同及 sidecar 消费接线，不提前做资格、renderer 或文案。
   - 按 [distribution.md](../../runbooks/distribution.md) 的 `build` / `package:mac` 路径本地打包：在 `packages/ui-mac` 用 `OPENCODE_CHANNEL=dev bun run build`，再以 `CODEPUPPY_SIGN=1`、签名身份哈希运行 `OPENCODE_CHANNEL=dev bun run package:mac --dir --publish never -c.mac.notarize=false -c.directories.output=<scratch>/packaged`。使用生产 hardened runtime、entitlements、fuses 和资源 `.node`；dev 只用于隔离身份及本地包，不冒充 prod release，不改发布源校验。签名日志先脱敏，结果只记录身份哈希、验证退出码、runtime flag、资源 buildId/摘要与 entitlements 比对，不打印身份名称。
   - 宿主从打包资源启动测试 main harness、生产 utilityProcess sidecar 和生产 `.node`，harness 的非产品接线只留测试中/临时包内。若需要给临时包加入 harness，完成修改后按同一签名规则重新签名再验证；不得用未签名修改后的包作证。
   - A 目录已在 W1，B/C 不在任一启动写根：sidecar 起子进程并等其 **exec 后 ready**；同一子进程在放行前写 B 失败；main 通过生产 `.node` 绑定 sidecar pid 签发，生产 sidecar 消费后，已有子进程和新子进程写 B 成功，C 仍 0 文件。另跑不消费对照，B/C 均 0 文件；覆盖自签矩阵和复制令牌跨进程失败，详见 V2。
   - 入口命令：`cd packages/ui-mac && bun test src/main/process-fence-extension-packaged.test.ts`。记录每一臂实际文件清单、pid、ready/consume/write 的顺序和退出码。G0 任一必要臂失败即返回 `BLOCKED: design — G0 — <失败步骤与脱敏原文>`，不继续步骤 2，不改路线；不能把普通 C、Bun 或 `ELECTRON_RUN_AS_NODE` 的成功替代本闸。
2. **固化底层防护与登记簿。** G0 过后扩充 `process-fence-profile.test.ts`、`process-fence-apply.test.ts` 和新 `main/process-fence-extension.test.ts` 宿主/`.cases.ts`；跑 V1/V2 全矩阵及路径语义负例。同步 X1 根登记和探针 `W1+X1`，运行检查组 A。新增检查先提交红测试，再提交实现，不在实现提交改掉红测试。
3. **main 资格、真源与运行期放行。** 先加资格/真源和 IPC 的红用例；实现 workspaces、server、ipc、preload 及必要 index 接线；不改 `deep-link-queue.ts`，深链接只消费。新 `main/project-writable-ipc.test.ts` 起同名 `.cases.ts` 隔离 Electron mocks，实际调用生产 handlers、tracker 和 server 监听器。覆盖 picker 返回顺序、同时重复请求、超时/退出/异常、失败后成功通知、tab 先写后登记、检疫目录经 picker 正式登记、深链不能登记、远端不触达本机。运行检查组 B。
4. **打开动作记录点，独立提交单元。** 依冻结设计 §4，在 M1 与 R1–R5 记录具体目标；renderer 唯一桥接 `recordWorkspaceOpen` 只由 R1–R5 调用并在导航/创建会话之前 await。不采样 `navigator.userActivation`，不使用入口键/草稿目录比较，probe 不登记。新增导航/选择调用点机器登记簿及结构检查，覆盖 P-15 的 record / consume 分类和记录函数的调用来源。
   - `workspace-writable-core.test.ts` 验跨 server 缓存、通知、迟到回复和登记桥接；新 `ui/workspace-writable.component.test.ts` 宿主起 `test-component/workspace-writable.cases.ts` 挂真实组件，覆盖 R1–R5 与恢复/SSE/重挂只消费。真实窗口补证留步骤 7。
   - V4 增加 R1 建会话回复及目录解析各延迟 >8 s 仍可写、自动化历史打开可写；V5 增加改写目录后强制重载等待期点别处不登记、诚实重载仍可写。去 R1/R5 登记、restore 中新增登记、未分类新调用点分别作为坏臂。
5. **首次工作的顺序。** 在上表两个真实调用点接共享 `whenSettled`，使用提交时冻结的 server/directory；延迟内、超限、切换身份和远端/无围栏各有用例。实际 prompt/startChat/command/terminal create 必须在约定等待之后，不以禁用按钮、隐藏 composer、重挂终端或改发送 API 实现。跑检查组 C；真引擎顺序在 V3 再核。
6. **残余界面与本分支临时拒写提示一起收敛。** 先提交正常可写路径、三种残余状态及时间线旧按钮的红测试，再改壳、chip、双语文案和 interim 消息；跑检查组 D。
   - 模型提示不再说启动时定死、重启后才可写或有重启按钮。已证实目标属于未亲手打开目录时，说明该事实，要求不要绕过、停止并告诉用户可用「打开项目」选中。
   - **最小归因规则：裸 `EPERM` 或 shell 的 `Operation not permitted` 只证明操作被系统拒绝；相对路径只能按真实工具输入/位置解析，缺目标不得拿会话 cwd 代填。** 没有确切资格/可写事实时，模型收到中性的停止说明，对「未打开可用打开项目」采用条件句；用户侧只显示一次写入失败的事实句，不断言沙箱、未打开或重启可治。已拿到设计的确切 `reason` 时复用对应残余句。不能为文案新增 roots 清单、副本判定或跨层权限 API。shell 未知目标、可写根内的非围栏 EPERM 必须有反例；不得把未知错误变成用户的错误原因。
   - `WriteDeniedNote` 保留单句且无按钮；删除 timeline `relaunch` intent、其接线与测试 runtime 中旧动作。模型停止提示仍经登记过的 tool-failure sink 注入；在 `packages/ext` 执行 `bun scripts/context-injection-inventory.ts --write`，用实际 inventory 输出更新库存快照。
7. **真引擎与真实窗口整链验据。** 新 `main/project-writable.engine.test.ts` 宿主启动同名 `.cases.ts`，复用现有 engine sandbox、scripted model、真实 ext 和生产启动路径。跑 V3/V4/V5 及已知坏臂；窗口用隔离签名包的真实 Chromium，CDP 观测 DOM/导航与可信输入，用可信输入触发登记动作，不把脚本派发 click 当作用户操作证明。最终生产接线变化后重跑 G0/V7，记录放行往返 p50/p99；本机模型桩不使用真实账号。
8. **事实文档、计数与收口。** 同步设计 §6 点名的架构/I1 事实，保留旧实验历史；更新本节偏离记录。仅对新增/变动检查同步 gate 行、精确子用例计数、调用点登记与 injection 库存。运行涉及包的 `bun typecheck`、`git diff --check` 及本节列出的受影响检查；不运行全仓 suite/full gate。提交后交编排者做独立 review、push/PR/merge。

### 风险

- **私有 SPI 的出货可行性**：现有 C 实验不能替代签名 Electron 的 mach 权限与继承；G0 将此风险放在资格/UI 实施前。测试按实际落盘判定，不能仅看 handle 或 rc；E5 中 `flags=0x1` 可返回 handle=0 但不放宽，旧 related-file 五参程序会崩溃，须用 `r1d.c` 已核的六参版本。
- **打开动作范围已冻结**：步骤 4 只实现 M1/R1–R5；所有恢复、SSE、深链与引擎驱动路径只消费。结构登记簿抓新入口漏分类及恢复路径误登记，慢响应不能改变已经记录的资格。
- **缓存、代次与顺序**：通知后旧的 pending 回复可能盖掉新答案；同目录并发可能重复签发；等待期间 server/会话可能切换。测试直接观测请求、写盘、pid 和完成顺序，并保留同代先拒后选的窗口，不靠睡足固定秒数判绿。
- **测试布局假绿**：`/private/tmp`、`/private/var/folders`、模拟 HOME 的 `.cache` 等可能本就被 W 行允许。B/C 必须放在独立 scratch 下、位于模拟 HOME/XDG/状态根之外，放行前实写校准 EPERM；宿主负责最终读盘。复用测试隔离预载，但在预载执行前安排其 TMPDIR/隔离根，避免落入系统临时目录；不改全局预载。
- **拒写归因**：TCC/文件权限与围栏可能同为 EPERM；shell 无可靠目标。步骤 6 的中性分支保留停止能力，不把 errno 当作资格证明；不引入一份 ext 的可写根真源。
- **实机纪律**：scratch、日志、临时 app 都在 `~/.cache/alpha-orch/2026-11-19/impl-project-writable/`，开始及大构建前检查空闲 ≥8 GB。仅用临时 app 可执行文件启动，隔离 userData/HOME/XDG/DB，后台隐藏，不经 `open`，结束 `lsregister -u` 注销该副本；不触及 `/Applications/Code Puppy.app`、其数据、凭据或登录动作。令牌只在内存消息中，报告/日志/argv/env/磁盘都不落令牌。
- 真实引擎遇 `ENOTCACHED`/`spawn_failed` 先按命名包 `npm cache add` 后重跑，再分类；所有长命令前台完成。若有其它 full gate 在跑，测试并发最多 2；不以本 lane 运行 full gate。

### 证明

验据编号沿用派单。冻结设计 §6 的 V1–V6b 以及出货形态 **V7/G0** 入口闸，并在最终接线后复验，不另增设计条款。

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-05 | **G0/V7**：`main/process-fence-extension-packaged.test.ts` → 同名 `.cases.ts`，签名 main + 生产 utilityProcess/.node/profile；前后已有/新 child、C 目录负例；最终接线复验，放行耗时 p50/p99 和每次目录/结果的一行日志。 | 无 X1、签发或消费时 B 不落盘；去围栏时 C 落盘；不消费对照与正臂的结果必须不同。去进程绑定由 V2 的回放负例抓到。runtime/签名/生产路径不符即不能通过 G0。 |
| AC-05 | **V3**：`main/project-writable.engine.test.ts` → 同名 `.cases.ts`；picker、项目列表/chip、侧栏进入项目/会话逐入口；真模型桩调 write 和 shell，放行前已 exec 的 PTY 与 MCP stdio 写 B，之后新工具/终端也写 B。保留另一个流式回答，比较引擎 pid/代号、renderer 文档身份、流完成及取消事件；放行人为延迟但小于 1 s 后立即发首条/建首终端。 | 不放行臂同一写 EPERM 且 B 0 文件；去消费/去首次工作等待各使对应落盘或事件顺序断言失败；偷偷换代、reload 或取消别的回答会被独立观测量抓到。 |
| AC-05、AC-08 | **V4**：同一 engine 宿主整链；同代同 renderer 先通过深链进入 B 被拒，再经 picker（含 `CODEPUPPY_OPEN_DIR` harness 路径）选 B，第一轮重问和实际落盘；另测 tab 写回先于登记、R1 创建回复和目录解析各延迟 >8 s、R5 自动化历史打开，自动调度与历史加载不登记。 | 去选择器登记/放行或去 changed 通知/缓存失效时仍缓存拒绝，第二步不能落盘；不得靠换代或新建 renderer 消掉旧缓存。 |
| AC-06 | **V6a**：`workspace-writable.component.test.ts` 及现有 `codepuppy-session-workspace.test.ts`、`new-session-workspace.component.test.ts`、`session-timeline.test.ts` 的真组件子进程；正常可写三个宿主两钩子均缺席；真实窗口复验整个应用无指定重启按钮。另作 renderer 生产源码/i18n 的该按钮与旧 copy-key census，覆盖未挂载分支。 | 已知坏：恢复任一只读钩子/旧按钮/时间线 intent 时，DOM 或全生产面 census 必红；只断言 state boolean 不作界面证据。 |
| AC-07 | **V1**：现有 `process-fence-profile.test.ts` 逐行形状及新 `process-fence-extension.test.ts` 的实际自签；X1/X2 与五操作逐项覆盖。 | 去 X2 后 file 自签落盘、把 X2 改成只禁 file 后 generic 自签落盘；两种坏 profile 都必须被安全判官拒绝。 |
| AC-07 | **V2**：extension 宿主/`.cases.ts` + G0 的 Electron 内嵌 Node/生产 .node；E5 可用 file/to-self/to-process/by-pid、related-file、generic、mach、iokit、flags、旧苹果类、update-file；伪造令牌、错误进程、未围栏进程、退出后的另一代回放；软链进/出与大小写。posix-ipc 无签发导出如实声明，形状/编译仍覆盖其操作名。 | 伪造消费失败且目标 0 文件；改为不绑定进程的签发后另一进程回放落盘，判官必红；认苹果类/移除对应签发 deny 会使各自坏臂被检出。软链跳到 C 仍 0 文件。不能把签发返回非空本身当越界成功。 |
| AC-07 | **V5**：engine 整链 + `project-writable-ipc.test.ts` + `workspace-writable-core.test.ts`；当前会话 DB 的 directory 改为 X，SSE/同入口刷新、逼一次自愈和 renderer reload，读取真源与实际 X 文件；重载等待期用户点别处仍不登记 X，诚实重载原目录可写；用户刚点别处后深链三来源打开 X；远端同名本机目录；sidecar 发伪造 open/grant 消息。 | 逐保护运行坏臂：在 restore 调用点插入登记、增加未分类导航调用点、去真源资格过滤、去 local-server 检查、加入反向签发路由，各使相应测试红。记录登记/签发调用和 X 0 文件，不能只查消息类型或只查集合。崩溃测试仅影响隔离引擎。 |
| AC-08 | **V6b**：上述组件宿主和 IPC 宿主；HOME/状态根、仅深链目录、放行失败三组；失败包含原生异常/错误 step、无活 child/退出、请求簿超时及 IPC 意外拒绝，probe 的 denied/unknown 两种回答；每组一句、无按钮；深链组续做 picker 后可写。 | 吞异常/仅在 probe=denied 显原因的坏臂会缺句；恢复旧标题/脚注/按钮会多出元素；失败缓存成终态会挡住 picker 后成功。HOME/祖先/状态根负例仍不得登记。 |
| AC-06、AC-08；拒写后停止能力 | 现有 `fence-write-denied.engine.test.ts` → `.cases.ts`，新 `packages/ext/src/policy/display.test.ts`，`context-injection.test.ts`，时间线组件；真引擎拒写结果仍给模型停止指示且无重启字样；已知未打开与未知路径/根内非围栏拒绝分别验证措辞，成功写无提示。 | 去 `attachWriteDenied`/去停止指示时模型收到的工具文本断言红；恢复重启文案或把裸 errno 断言成未打开时负例红；恢复 timeline 按钮/intent 时组件红。无需用真实 TCC 授权弹窗制造权限变化。 |

夹具来源：SPI 矩阵与控制臂来自派单只读目录 `~/.cache/alpha-orch/2026-11-19/fence-ext/` 的 `src/{r1,r1b,r1d,r2,r2b}.c`、`r1-x2all-result.txt`、`r1d-result.txt`、`r2b-result.txt`（使用 `r1d` 六参修正）；签名普通程序读数见 `rc-hardened/`，只作先验。引擎/MCP/PTY/工具错误使用现有 `process-fence-engine.test.ts`、`fence-write-denied.engine.cases.ts`、`test-component/codepuppy-engine.ts` 运行得到的真实输入输出；新增案例记录采集入口和 buildId，不手写另一系统 payload 替身。R1 处置继承设计 §10，原始审查文本为同日 `review-project-writable/out.log`。

**相关检查命令（全部从包目录执行；只传宿主 `*.test.ts`）：**

- A：`cd packages/ui-mac && bun test src/main/process-fence-profile.test.ts src/main/process-fence-compile.test.ts src/main/process-fence-plan.test.ts src/main/process-fence-apply.test.ts src/main/process-fence-write-sites.test.ts src/main/process-fence-extension.test.ts src/main/workspace-write-probe-fence.test.ts`。
- B：`cd packages/ui-mac && bun test src/main/process-fence-workspaces.test.ts src/main/workspace-write-probe.test.ts src/main/process-fence-wiring.test.ts src/main/codepuppy-sidecar-wiring.test.ts src/main/server.test.ts src/main/ipc-channel-binding-census.test.ts src/main/project-writable-ipc.test.ts`。mock server/加载器新增导出需要同步其假件，保留各自独立宿主隔离。
- C：`cd packages/ui-mac && bun test src/renderer/codepuppy-ui/workspace-writable-core.test.ts src/renderer/codepuppy-ui/workspace-writable.component.test.ts src/renderer/codepuppy-ui/session-workspace/codepuppy-session-workspace.test.ts src/renderer/codepuppy-ui/new-session-workspace.component.test.ts src/renderer/codepuppy-ui/home-right-panel.component.test.ts src/renderer/codepuppy-ui/session-rail/terminal/terminal-engine-adapter.test.ts src/renderer/codepuppy-ui/session-rail/terminal/terminal-rail.test.ts src/renderer/codepuppy-ui/composer-a11y.test.ts src/renderer/codepuppy-ui/codepuppy-composer-model.component.test.ts src/renderer/codepuppy-ui/session-workspace/session-second-send.test.ts`；composer 的等待顺序新增到 workspace-writable 组件子用例，既有 composer 宿主补齐新增 import 的假件并核原发送行为。
- D：`cd packages/ext && bun test src/policy/display.test.ts src/policy/register-policy.test.ts src/context-injection.test.ts`；`cd packages/ui-mac && bun test src/main/fence-write-denied.engine.test.ts src/renderer/codepuppy-ui/session-timeline/session-timeline.test.ts src/renderer/codepuppy-ui/session-timeline/cards/tool-card-model.test.ts src/renderer/codepuppy-ui/session-timeline/cards/cards-contract.test.ts`，并复跑 C 中受 UI 更改影响的宿主。
- 整链：`cd packages/ui-mac && bun test src/main/project-writable.engine.test.ts src/main/process-fence-engine.test.ts src/main/process-fence-extension-packaged.test.ts`。围栏/窗口隔离案例串行；darwin 必跑，不允许缺依赖 skip 当通过。
- 包检查：分别在 `packages/ui-mac`、`packages/ext` 执行 `bun typecheck`。计划阶段仅做文件/差异核对，不执行以上实现检查。

**计数钉与登记行：**

| 位置（当前读码值） | 实施时同步 |
| --- | --- |
| `fence-write-denied.engine.test.ts` 的子用例精确 `3 pass / 0 fail`；`gate-files.tsv:147` 宿主 1 | 旧三条中重启和未知 shell 归因断言改为新行为；新增负例后按实际子条数写回宿主，gate 宿主仍为 1，改其旧行为说明。 |
| `session-timeline.test.ts:51` 的 `125 pass`；gate 行 280 的宿主 12 | 替换旧拒写按钮用例并增加未知原因负例；按实际子条数同步 125，宿主数量有变才改 12；不删掉该计数来过门。 |
| gate 行 74：context-injection 43；行 203：register-policy 68；注入库存 `sandbox.write-denied` 当前 494 bytes | 保持正文逐字可解释；库存生成实测字节；新增/替换用例后按实际计数同步，不能给下界留余量。 |
| gate 行 322–327、330、346–347：profile 26 / compile 4 / plan 11 / apply 11 / wiring 16 / write-sites 12 / workspaces 12 / probe 14 / probe-fence 2；行 392 sidecar-wiring 6 | 为 X1/X2、登记/真源、grant、失败映射添加的测试逐文件实测写回；probe 行保留 probe-fence 受托关系。现有 engine 行 329 的 7 条继续回归。 |
| gate 行 271–272、278、280–281：new-session host 1 / home-right-panel host 1 / terminal-adapter 16 / timeline 12 / session-workspace 14；cards 行 162–163：9 / 53 | 宿主未增 test 时不改宿主数；保留 cards → provenance → timeline、session-workspace → settings-directory 的委派；被 mock 的 writable/preload 导出逐处补齐。 |
| 新 G0、extension、project-writable-ipc、project-writable.engine、workspace-writable.component 宿主；现有未登记的 `workspace-writable-core.test.ts`；新 ext display 测试 | 各加 gate 行，以实际直接用例数为精确值；起 `.cases.ts` 的宿主直接负责子计数，cases 不单独登记/执行，`delegates_to` 为 `-`；darwin 行按现有格式声明平台。 |
| `scripts/process-fence-write-sites.tsv` 的 workspace probe write/remove 两行、根 ID 校验 | 根记 `W1+X1`；沿生产闭包重新核对新增签名，机械同步必要条目，不能把未登记点标 main-only 掩盖。 |

文档验据为上述命令/脱敏输出、实际包与落盘/DOM 的检查，不写断言文档措辞或标题数量的测试。当前已有 docs 索引由编排者在冻结设计合入时统一处理；PLAN 提交严格只含本文件。

### 偏离记录

- 2026-11-19 · PLAN 读码发现实际依赖注入、消息发送、终端创建分别在 `main/index.ts`、`ui/codepuppy-composer.tsx`、`ui/session-rail/terminal/terminal-engine-adapter.tsx`，初始枚举未点名；按派单 Handling problems §1 列为同调用链最小落点，交计划核对，尚未修改这些文件。其余设计决定不变。
- 2026-11-19 · 步骤 1 红证据 `f98d37f5be`：G0 缺生产签发导出、profile 缺 X1/X2，宿主与形状测试共 24 pass / 3 fail，exit 1；脱敏输出位于 `~/.cache/alpha-orch/2026-11-19/impl-project-writable/g0-red.log`。
- 2026-11-19 · 步骤 1 harness 隔离接线：测试辅助源码落在 `native/codepuppy-fence/test/`；仅签名工具使用账户 HOME 与显式登录钥匙串（身份只记录哈希），app/sidecar 仍隔离 HOME、userData、XDG。前两份签名包均通过 deep/strict 验签，但在生产 sidecar 启动之前停住；第一份经 SIGTERM 退出 143，第二份经 SIGKILL 退出 137。第二份 `g0-VpBP22/startup-sample.txt` 实测停在 `SecItemAdd → defaultKeychainUI → AuthorizationCopyRights`，纠正先前对 ready 等待的推断。测试入口改用 ready 回调，并用 Chromium 测试开关 `--use-mock-keychain` 隔离 cookie 密钥存储；不改变生产签名、entitlements、fuses、围栏或 sidecar。两份副本均已 `lsregister -u`。生成的攻击辅助二进制在打包后删除，生成 main 入口恢复原字节。
- 2026-11-19 · 步骤 1 必要消费者测试同步：`main/keychain-name-migration.test.ts` 未在步骤 1 初始枚举中；其 `loadFenceAddon` 假件须补两个新增导出，只修改该假件，过滤运行「生产加载器」用例为 1 pass / 0 fail、其余 25 条未运行，无真实钥匙串调用。生产原生 apply/试编译既有检查 15 pass / 0 fail，profile 26 pass / 0 fail。G0 运行臂结果另记，以上不作 G0 通过证据。
- 2026-11-19 · 步骤 1 临时目录与握手修正：第三包 `g0-1CqUez` 已在签名 utilityProcess 装上生产围栏，随后因 harness 未建 XDG 父目录而在 `mkdir .../home/config` 得到 EPERM，exit 1；改由 main 在 fork 前建立临时安装布局，不扩大 profile。第四包 `g0-jEsnyT` 新子进程写入成功、C 0 文件、50 自签变体 0 越界、两个坏 profile 各落 1 文件、绑定回放失败；宿主因已有子进程未落盘而红。其 `child.exit` mtime `1795086523073895376ns` 早于 `go` 的 `1795086523079061232ns`，证明错误在 harness 等待整个 `session.shell` 返回后才签发，不能作已运行子进程继承的反例。保持原落盘断言，改为 HTTP 请求在途时等待 ready、以 signal 0 确认 pid 存活，放行后才 join 请求；正反臂共用该流程。上述原始输出全部保留，G0 最终以修正握手后的宿主结果为准。`bun typecheck`（ui-mac）exit 0。

**G0 最终结果（2026-11-19，代码 `43787399c1`）：PASS。** 仅完成步骤 1；步骤 2–8 未开始。红提交 `f98d37f5be`，harness 修正提交 `a119422af6` / `2baf2ba571`，生产实现提交 `43787399c1`。最终命令 `cd packages/ui-mac && bun test src/main/process-fence-extension-packaged.test.ts` 为 1 pass / 0 fail、exit 0；宿主强制核对独立 cases 的 1 pass / 0 fail。总耗时约 80 分钟，主要为 5 次本地签名构建及上述 harness 准备修正；未运行 full gate。

证据根 `~/.cache/alpha-orch/2026-11-19/impl-project-writable/g0-HJJPak/`：`result.json` 为签名 main 实录，`g0-summary.json` 补记宿主结论、实际目录清单与退出码，`signing.json` / `signature.log` / `entitlements.log` / `package.log` 为签名及打包记录；外层输出 `../g0-run-5.log`。main pid **66859**，Electron **42.3.3** / Node **24.15.0**；生产 addon buildId **`fence-20261119T111113326Z`**。

| 臂 | 生产 sidecar pid | 实际 B 文件 | 实际 C 文件 | 实际结果与退出 |
| --- | --- | --- | --- | --- |
| 放行 | 66928；已有子进程 66944、新子进程 66946 | `existing.txt`, `new.txt` | 空 | 签发成功、消费 granted；新写状态 0；sidecar exit 0 |
| 不消费，同一写入流程 | 66958；已有子进程 66986、新子进程 67000 | 空 | 空 | 新写状态 1，伪造凭证失败且 B 探针仍 denied；sidecar exit 0 |
| 退出后新一代回放 | 66947 | 空 | 空 | 旧 token 消费 failed / errno 1，旧 B 探针 denied；sidecar exit 0 |
| 自签矩阵 | 67012 | 空 | 空 | 50 个实际变体写入均 errno 1；辅助程序 exit 0、sidecar exit 0 |
| 已知坏：X2 只禁 file | 67101 | 空 | `generic.txt` | generic 自签/消费后写状态 0，安全判据可见越界；sidecar exit 0 |
| 已知坏：去掉 X2 | 67107 | 空 | `file.txt` | file 自签/消费后写状态 0，安全判据可见越界；sidecar exit 0 |

放行臂顺序（main 的 `performance.now()`，毫秒）：已有子进程 ready 且 signal 0 存活确认 **978.935041** → 签发开始 **978.940666** → sidecar 消费应答 **979.184791** → 已有进程写完 **996.405333** → 新进程写完 **1004.994166**。单次 grant 消息往返 **0.191959 ms**，不作为 p50/p99。独立文件时间也满足 `ready < go < child.exit`。`existing-write.exit=1` 是脚本最后一次写 C 的状态；utilityProcess 退出码由各 `engine-exit.code=0` 单列，不能混为一谈。未围栏 main 回放 handle=-1 / errno=1。

矩阵保留真实例外：`legacy-file` / `legacy-mach` 返回 token、consume handle 分别 1 / 2，flags=0x1 返回 token、consume handle=0；三者实际写入仍 errno 1、C 0 文件。其余本类变体签发被拒。posix-ipc 在本机无签发导出，X2 操作名由真实试编译覆盖，没有虚构该 API 的用例。

`codesign --verify --deep --strict` exit **0**，runtime flag **`0x10000(runtime)`**，entitlements 键与生产配置一致；签名身份仅记哈希 **`27D86FF5629B9296E616B333E798725A2E01B262`**。打包日志确认 `--publish never` 与 notarize 显式 false，未提交公证。main exit **0**；副本 `lsregister -u` exit **0**，无剩余测试 app 进程，生成 main 入口已恢复、攻击二进制已从构建输出删除。已复读实际磁盘清单，B/C 均无探针残留；未启动、修改或替换安装中的 app。

相关检查：profile 26 pass；原生 apply + 试编译 15 pass；加载器消费者过滤用例 1 pass（25 条未运行）；ui-mac `bun typecheck` exit 0；`git diff --check` exit 0。后续 gate 登记、根登记、资格/界面/文案与架构事实同步仍按步骤 2–8 续派，当前不宣称 AC-05 至 AC-08 已整体交付。

- 2026-11-19 · r2 计划同步：冻结输入 `9d3601c2aa` / reviewed_sha `8370b2fa23`。步骤 4 改为 M1/R1–R5 具体动作登记；去掉深链修改、激活采样、入口键与草稿比较；probe 无 open。追加 sidebar/search/automation 同调用链落点及 P-15 结构登记簿、V4 慢响应和自动化历史臂、V5 重载点击与诚实重载臂。步骤 1 的 native/profile/grant 与 G0 验收不变；V2 旧接口和 flags=0x1 允许返回令牌，仍要求所有臂集合外 0 落盘。

- 2026-11-19 · 步骤 2 红证据：profile/write-sites/extension 宿主共 37 pass / 2 fail，exit 1（`step2-red.log`）；两条失败均为 X1 缺写根登记。新 V1/V2 子用例 6 pass / 0 fail：50 臂按冻结 V2 判定，C 0 文件；file-only/generic 与 no-deny/file 各落 1 文件；不绑定回放落盘使同一判官变红。测试辅助源码只在 native/test，update-file 与无绑定签发来自既有 r1/r2 真实实验，不加入生产导出。

- 2026-11-19 · 步骤 2 完成：红提交 `74c49e192f` 后补 X1 根 ID、探针 write/remove 的 `W1+X1` 两行及根说明。检查组 A（7 个宿主）67 pass / 0 fail，新增宿主含 6 子例；登记同步后 write-sites 12 pass / 0 fail，ui-mac `bun typecheck` exit 0。证据 `step2-green.log` / `step2-ledger.log` / `step2-typecheck.log`；V2 原始 `extension-*/result.json` 保留实际 pid/errno/落盘。新增 gate 行 extension host=1，既有 profile=26、write-sites=12 不变；三个已知坏臂均实跑并落盘，没有修改生产 native 合同或扩大测试替身的证明范围。

- 2026-11-19 · 步骤 3 红证据：workspaces 9 pass / 6 fail（缺登记权威），IPC 宿主 0 pass / 1 fail，内层 10 fail（新通道不存在、probe 缺 server/grant、picker 立即返回且没有放行）；原始 `step3-red.log` / `step3-ipc-red.log`。既有真源测试中的新打开动作改为显式登记，新增 SSE 目录过滤、tab 先于登记、检疫第二道闸和 HOME/状态/远端顺序用例；IPC 子例使用生产 handlers/tracker/listener，native 与 Electron 是隔离替身，不能代替 G0。

- 2026-11-19 · 步骤 3 补 O1 红证据：`step3-picker-red.log` 中 picker 子例因额外触发 filesystem probe（应只等 consume）红，其余 9 子例通过。同时修正 fake child 的并发应答必须捕获各自 id（保留原断言）、临时全局根使用真实 `<base>/env/dev` 形状；不改产品合同。

- 2026-11-19 · 步骤 3 接线：共享规则 4/5/5b predicate、main 内存登记、真源过滤/登记重算、当前 listener 的成功账本/并发合并、grant 请求簿消息路由及退出关闭、M1 与 record IPC、preload 通知/合同和 index 注入。O1 只等 grant 消费（不等待 probe），最多 1 s，后台继续。检查组 B 加受影响 profile/write-sites 共 128 pass / 0 fail，内层 IPC 10 pass；workspaces pin 12→15，新 gate host=1。必要测试假件 `test-component/preload-stub.ts` 分类两个新 preload 键；真实 native 合同未改。包 typecheck 的 main 两项窄化错误已修，renderer 旧 probe 参数/桥缺 grant 尚待步骤 4 同步，不能把当前结果报成全包通过。

- 2026-11-19 · 步骤 3 坏臂：移除真源 `opened.has` 过滤后 workspaces 14 pass / 1 fail，移除本机 server 判定后 IPC 宿主红；`step3-bad-truth.log` / `step3-bad-server.log`，两次均按文件 scoped restore 恢复。步骤 4 核心红测试 `step4-red.log`：新的 server 身份、通知失效/迟到回复、reason 判定、IPC 失败语义均在旧 tracker 上失败。R1/R5 实际路径分别是 `renderer/sidebar/` 与 `renderer/automations/`，已机械修正计划路径。

- 2026-11-19 · 步骤 4 结构红证据：新增 `main/project-writable-navigation.test.ts` 与 `scripts/project-writable-navigation.tsv`（冻结 P-15 要求的机器登记簿），初始清单为空且 R1–R5 尚未调用登记，`step4-navigation-red.log` 红；控制臂已证明 restore 插入登记为 forbidden、新导航/记录函数引用不登记即红。扫描范围含 ui-mac 生产 renderer 与 P-15 点名的已挂载 app 上下文；实际 AST 清单保留在 scratch/navigation-sites.json，测试不改写仓库登记簿。

- 2026-11-19 · 步骤 4 完成接线：R1–R5 具体目标先登记、五处 server 冻结、R2 完整行/R4 directory/R5 task target；共享消费者无激活/entry/open 字段，含 server 缓存、通知失效、同键迟到回复隔离、reason 单一判据、IPC 拒绝映射。核心+结构 15 pass / 0 fail；三个宿主相关检查 16 pass / 0 fail；search+automation 71 pass / 0 fail；ui-mac typecheck exit 0（步骤 3 的 renderer 合同待办已清）。原始 `step4-core-green.log` / `step4-hosts.log` / `step4-record-hosts.log` / `step4-typecheck.log`。
- 2026-11-19 · 步骤 4 计划偏离：复用已有 new-session-workspace、session-workspace、session-search 与 automation 的真实组件宿主和 fixture，不再复制一个 workspace-writable.component 宿主/三宿主 harness；新增 R3 的 await 次序、同 renderer 通知/诚实恢复/改写目录、R1/R2/R4 真实点击、R5 历史加载不登记/打开先登记用例。V3/V4/V5 的真引擎、可信窗口及 >8 s 延迟仍留步骤 7，不把 happy-dom 当真实用户输入证明。对应必要测试文件 search runtime/test、automation-cloud-refusal.test 为 R1/R2/R4/R5 同调用链。
- 2026-11-19 · 步骤 4 登记簿扫描实际 83 个调用/引用；除 P-15 列出的上下文，补入实际深链消费者 `codepuppy-app/src/pages/layout/deep-links.ts:applyDeepLinks` 及持有者 `pages/layout.tsx`（index.tsx 只发布 batch），只读扫描，不修改上游代码。R1 的 openProject、R4 的 openResult wrapper 引用也登记，防恢复代码通过 wrapper 触达记录点。gate：search 29→32、automation 38→39；新增 core=10、navigation=5，组件宿主数不变。

- 2026-11-19 · 步骤 4 坏臂完成：去 R5 登记后结构与真实历史按钮用例均红（`step4-bad-r5-structural.log` / `step4-bad-r5-dom.log`，DOM 0 pass / 1 fail、38 filtered）；保留失效缓存时两个指定核心用例均红（`step4-bad-cache.log`），已 scoped restore。步骤 5 红证据 `step5-red.log`：核心缺 whenSettled 四条红，真实 home/prompt/command/terminal 四种首次工作均在消费前发生而红；该组件子进程 60 pass / 4 fail，宿主总 10 pass / 5 fail。
