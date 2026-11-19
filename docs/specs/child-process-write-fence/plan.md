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

- 依据：[SPEC-child-process-write-fence v3 / AC-05 至 AC-08](spec.md)（`f60096e4d6`；原 PLAN 输入为 v2 / `8593c2701d`）；[冻结设计 §4、§5、§6、§10](design.md)（approved / reviewed_sha `8370b2fa23`，由 `9d3601c2aa` 合入）；2026-11-19 PLAN 派单及其 Decided point 5。读码基线为本集成分支 `4f61fde5de`；当前实现以本 worktree 已合入的冻结设计和 spec v3 为输入；v3 只按事实更正 AC-08 第二种到达路径，不新增深链消费者。
- 核对：Phase: IMPLEMENT — plan 6a1e42753b · orchestrator / Claude Fable 5.2 · plan check passed (every AC has proof with a failing arm; the three extra same-call-chain files `main/index.ts`, `ui/codepuppy-composer.tsx`, `ui/session-rail/terminal/terminal-engine-adapter.tsx` are accepted as necessary; no decision restated or changed). 2026-11-19 r1 仅实施步骤 1/G0，已验收；r2 授权按冻结设计实施步骤 2–8；r3 在刷新基线 `bf4dff645e` 继续步骤 6–8，六个打开动作记录点替换激活采样，探针与真源只消费登记。V2 按每臂实际落盘和 `r1-x2all-result.txt` 判定，不能要求所有签发都返回 NULL。

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
| `ui/session-timeline/cards/tool-cards.tsx`、`ui/session-timeline/cards/tool-card-model.ts`、`ui/session-timeline/process-fold.tsx`、`ui/session-timeline/session-timeline.tsx`、`ui/session-timeline/cards/timeline-intents.ts` | r3 刷新基线已删 WriteDeniedNote / relaunch / marker；本 lane 不再修改这些生产文件或重建卡片，仅复核既有相关检查。 |
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
6. **残余界面与本分支临时拒写提示一起收敛。** 先提交正常可写路径、三种残余状态和模型提示的红测试，再改壳、chip、双语文案和 interim 消息；跑检查组 D。r3 基线的时间线卡片、按钮、intent 已删，不重加。
   - 模型提示不再说启动时定死、重启后才可写或有重启按钮。已证实目标属于未亲手打开目录时，说明该事实，要求不要绕过、停止并告诉用户可用「打开项目」选中。
   - **最小归因规则：裸 `EPERM` 或 shell 的 `Operation not permitted` 只证明操作被系统拒绝；工具的已知目标也不等于 main 的用户打开登记事实。** 现有 ext 错误钩子没有该事实，一律只附中性停止说明；精确未打开片段保留登记、无事实不附。用户侧仅壳/chip 消费 main 的确切 `reason`，显示对应残余句。不能为文案新增 roots 清单、副本判定或跨层权限 API。shell 未知目标、可写根内的非围栏 EPERM 必须有反例；不得把未知错误变成用户的错误原因。
   - 模型停止提示仍经登记过的 tool-failure sink 注入；在 `packages/ext` 执行 `bun scripts/context-injection-inventory.ts --write`，用实际 inventory 输出更新库存快照。UI census 防已删除卡片/intent/marker 回归。
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
| AC-05 | **V3**：`main/project-writable.engine.test.ts` → 同名 `.cases.ts`；main/IPC 后端；项目列表/chip/侧栏逐入口另由可信窗口 V4 证明。真模型桩调 write 和 shell，放行前已 exec 的 PTY 与 MCP stdio 写 B，之后新工具/终端也写 B。保留另一个流式回答，比较引擎 pid/代号、renderer 文档身份、流完成及取消事件；后端人为延迟 180 ms，只证明直接调用共享 tracker.whenSettled 后的首条模型请求以及消费后新建 PTY；生产 composer/terminal-adapter 首次提交的延迟顺序由 new-session-workspace.component.test.ts 的真实组件证明，不宣称这两条生产入口已走真实引擎。 | 不放行臂同一写 EPERM 且 B 0 文件；去消费使实际落盘判官红；去生产首次工作等待由组件判官抓，后端不冒充该证据；偷偷换代、reload 或取消别的回答会被独立观测量抓到。 |
| AC-05、AC-08 | **V4**：同一 engine 宿主整链；恢复会话的 directory 被模型改写为未登记 B，显示说明并拒写；再在同代同 renderer 经 picker（含 `CODEPUPPY_OPEN_DIR` harness 路径）选 B，第一轮重问和实际落盘；另测 tab 写回先于登记、R1 创建回复和目录解析各延迟 >8 s、R5 自动化历史打开，自动调度与历史加载不登记。 | 去选择器登记/放行或去 changed 通知/缓存失效时仍缓存拒绝，第二步不能落盘；不得靠换代或新建 renderer 消掉旧缓存。 |
| AC-06 | **V6a**：`workspace-writable.component.test.ts` 及现有 `codepuppy-session-workspace.test.ts`、`new-session-workspace.component.test.ts`、`session-timeline.test.ts` 的真组件子进程；正常可写三个宿主两钩子均缺席；真实窗口复验整个应用无指定重启按钮。另作 renderer 生产源码/i18n 的该按钮与旧 copy-key census，覆盖未挂载分支。 | 已知坏：恢复任一只读钩子/旧按钮/时间线 intent 时，DOM 或全生产面 census 必红；只断言 state boolean 不作界面证据。 |
| AC-07 | **V1**：现有 `process-fence-profile.test.ts` 逐行形状及新 `process-fence-extension.test.ts` 的实际自签；X1/X2 与五操作逐项覆盖。 | 去 X2 后 file 自签落盘、把 X2 改成只禁 file 后 generic 自签落盘；两种坏 profile 都必须被安全判官拒绝。 |
| AC-07 | **V2**：extension 宿主/`.cases.ts` + G0 的 Electron 内嵌 Node/生产 .node；E5 可用 file/to-self/to-process/by-pid、related-file、generic、mach、iokit、flags、旧苹果类、update-file；伪造令牌、错误进程、未围栏进程、退出后的另一代回放；软链进/出与大小写。posix-ipc 无签发导出如实声明，形状/编译仍覆盖其操作名。 | 伪造消费失败且目标 0 文件；改为不绑定进程的签发后另一进程回放落盘，判官必红；认苹果类/移除对应签发 deny 会使各自坏臂被检出。软链跳到 C 仍 0 文件。不能把签发返回非空本身当越界成功。 |
| AC-07 | **V5**：engine 整链 + `project-writable-ipc.test.ts` + `workspace-writable-core.test.ts`；当前会话 DB 的 directory 改为 X，SSE/同入口刷新、逼一次自愈和 renderer reload，读取真源与实际 X 文件；重载等待期用户点别处仍不登记 X，诚实重载原目录可写；main 深链队列的解码/交付及后续 tab 写回不登记 X（无窗口）；远端同名本机目录；sidecar 发伪造 open/grant 消息。 | 逐保护运行坏臂：在 restore 调用点插入登记、增加未分类导航调用点、去真源资格过滤、去 local-server 检查、加入反向签发路由，各使相应测试红。记录登记/签发调用和 X 0 文件，不能只查消息类型或只查集合。崩溃测试仅影响隔离引擎。 |
| AC-08 | **V6b**：上述组件宿主和 IPC 宿主；HOME/状态根、恢复出的未登记改写目录、放行失败三组；失败包含原生异常/错误 step、无活 child/退出、请求簿超时及 IPC 意外拒绝，probe 的 denied/unknown 两种回答；每组一句、无按钮；恢复目录组续做 picker 后可写；深链不是当前布局的到达路径（spec v3）。 | 吞异常/仅在 probe=denied 显原因的坏臂会缺句；恢复旧标题/脚注/按钮会多出元素；失败缓存成终态会挡住 picker 后成功。HOME/祖先/状态根负例仍不得登记。 |
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

| 位置（PLAN 初读基线；r3 刷新值及实际同步见续行记录） | 实施时同步 |
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

- 2026-11-19 · 步骤 5 完成：真实 composer 的 home/prompt/command 分叉前调用共享 whenSettled（提交时冻结 server/directory），终端 adapter 仅包装 create，已有 open/输入不等。等待当前 entry，通知替换后继续等新 entry，总上限 1 s；不把超时写成成功。检查组 C 实际 10 文件 79 pass / 0 fail，new-session 子例 64 pass / 0 fail；ui-mac `bun typecheck` exit 0，`git diff --check` exit 0。`step5-green.log` / `step5-typecheck.log`；red `98cb0db652`。通知等待用例改为等待可观测的第二次请求，不依赖恰好两个 microtask，保留原次序与不提前执行断言；home 用例另核等待期 server accessor 改变仍按提交时 server 导航。gate core 10→14，其余该组宿主计数不变。

### 本轮续行定位（r2 分段，步骤 5 完整提交边界）

- 已完成步骤 2–5；已核：Codex / GPT-6，自验通过上述相关检查，未作独立审计。实现主线依冻结设计 `9d3601c2aa` / reviewed_sha `8370b2fa23`，没有重新定义契约。
- 下一步 **6**：先加三种残余状态与时间线旧按钮的红测试，再收敛 i18n/壳/chip 和 interim model-stop/WriteDeniedNote；当前旧 copy 与 relaunch intent 尚未修改，AC-06/AC-08 不得报完成。然后步骤 **7**：真实引擎/可信窗口 V3–V5（含 R1 两段 >8 s、R5 历史打开、重载期间点击、各坏臂）、最终生产接线 G0/V7 与 p50/p99；步骤 **8** 架构/I1 事实和最终计数收口。
- 最终 G0/V7 尚未重跑，本轮没有签名打包/应用副本启动；继承 G0 验收，不把此前单样本 0.192 ms 当最终 p50/p99。前台检查全部结束后交回，git 保持干净。原始日志与临时产物统一在派单 scratch 下；不触及安装版、用户数据或真实凭据，无 push/PR/merge。
- 非阻塞补证：P-15 的深链发布与实际 consumer 位置已在调用点登记簿补全；去向为本 lane 已修扫描范围，不改冻结语义或上游代码。其它 OPTIONAL：无。

- 2026-11-19 · r3 刷新输入：`bf4dff645e`（0.2.5 release 合入）。继承步骤 2–5 及其自验证据；按 `ce6198be1b` / `28ed924cb2`，时间线 WriteDeniedNote/relaunch/marker 已删除，不重建。步骤 6 只改壳/chip 三句残余说明与两个模型片段；时间线 inner pin 保持 124，拒写 engine inner 保持 4，库存基线 98。relay 路由不在本 lane，已知 endpoint-route-fence.engine 的默认 TMPDIR 红不处理。
- 2026-11-19 · 步骤 6 最小归因规则：ext 的 execute.after 只持有工具错误、输入路径和会话目录，不持有 main 的用户打开登记事实；EPERM（含项目内的已知目标）及 shell 输出均不足以断言未打开，因此这些现有钩子统一附中性 `sandbox.write-refused` 并要求停止、不绕过。保留并重写注册片段 `sandbox.write-denied` 为未打开/「打开项目」说明，但没有可信登记事实就不附它；不新增跨层查询、roots 副本、metadata 凭证或不可达的假事实分支。
- 2026-11-19 · 步骤 6 红证据：ext display 4 pass / 3 fail（`step6-model-red.log`）；UI 13 pass / 4 fail（`step6-ui-red.log`）；真引擎/围栏/ext 内层 3 pass / 1 fail，旧重启文字确实进入模型工具结果（`step6-engine-red.log`）。该 engine fixture 原先依赖系统临时目录天然可写；移到派单 scratch 后先在 Global.Path.tmp mkdir EPERM，修正 fixture 的 W3 为其整棵隔离安装状态 sandbox.root，拒写目标仍在独立宿主 scratch 并以实际 EPERM 校准，不改生产 profile。所有新临时目录移至派单 scratch，宿主独占清理。

- 2026-11-19 · 步骤 6 实现：壳/chip 共用 reason→单句映射，宿主传递 main reason；移除标题/脚注/操作按钮、capsule relaunch 接线及四个旧 copy key，新增冻结三键。时间线不重加卡/intent/marker。ext 现有错误钩子统一中性停止；精确已知原因片段去重启、改 Open project，仅注册不在未知事实下附加。库存脚本实生 98 片段，write-denied 226 bytes、write-refused 171 bytes。
- 2026-11-19 · 步骤 6 检查：ext display/register-policy/context-injection 118 pass / 0 fail（step6-ext-green.log）；UI/engine 等组 109 pass，时间线宿主在默认 5 s 到期（step6-ui-green.log），没有输出断言失败。按 Gate failure 只核对这一个具名期限原因：单独 `bun test --timeout 30000 --max-concurrency 2 src/renderer/codepuppy-ui/session-timeline/session-timeline.test.ts` 为 12 pass / 0 fail，6.25 s，内层仍按 124 钉住（step6-timeline-isolated.log）；未改该测试文件或放宽任何行为断言，不称 flaky。ui-mac/ext 的 bun typecheck 均 exit 0。新增 gate display=7、UI census=2，其余 context=43、policy=68、拒写 engine inner=4、timeline inner=124 不变。

- 2026-11-19 · 步骤 6 两个坏臂：删工具错误的停止附言后 display 3 pass / 4 fail（step6-bad-no-stop.log）；把旧重启按钮放回已正确的单句 popover 后真实组件宿主红（step6-bad-restart-button.log），均已 scoped restore。补跑 home-right-panel/navigation 共 6 pass / 0 fail；实现 `cdd68fca40`，红 `43e602e19e`。
- 2026-11-19 · 步骤 7 后端腿新增真实引擎宿主/独立 cases、native/test 下 IPC engine peer 与 MCP fixture；协议沿用现有 engine/mcp-probe 真实夹具，模型流直接延迟既有 scriptedModel 产出的 SSE bytes，不手写替身格式。parent 运行生产 server grant ledger/原生签发/请求簿、registry 与 IPC；child 真引擎/ext/native/围栏，测试 peer 适配 canonical 消费/探针消息。Electron 传输替身只在此处，不作 G0/V7 或可信窗口证明。
- 2026-11-19 · 步骤 7 首次 fixture ext 未激活（engine-grant-bJPJ7a）；一次仅加日志的原样 setup 诊断（engine-grant-Ulq7ay）证实 Bun 启动时缓存的隔离 HOME 父目录不存在，requireCodePuppyGlobalRoot 的 realpath 得 ENOENT。先预建该父目录、移除诊断包装后，宿主 1 pass / 0 fail、内层 3 pass / 0 fail（step7-engine-second.log），引擎 PID 25741，B 实读 first-model/pty-existing/pty-new/mcp-existing 四文件，C 空，consume→first-work 次序可见；独立证据 engine-grant-9kzDkn。测试 peer 失败时显式退出并由宿主兜底清理自己持有的 child，避免遗留进程。
- 2026-11-19 · 步骤 7 后端腿扩为 6 子例：补远端不触达本机、HOME/状态资格拒绝、停机 grant-failed；模型经真实 shell/SQLite 改写实际 session_v2.directory，再杀死引擎，显式 fixture 重启后 E 仍不入真源/围栏、0 落盘，main 仍登记的 B 可再放行。此处没有生产 index 自愈或 Chromium reload，仍待窗口证据。首跑 SQL shell 引号错使 UPDATE 未执行，修正夹具共用转义函数后保持真实 API location.directory 断言；不改引擎或放宽判官。
- 2026-11-19 · 步骤 7 后端最终：`bun test --max-concurrency 2 src/main/project-writable.engine.test.ts` 宿主 1 pass / 0 fail、inner 6 pass / 0 fail（step7-engine-six-final.log）；`bun typecheck` exit 0（step7-ui-typecheck.log）。实际 `engine-grant-7rzKH7/proof.json` / events.json：引擎 47566→47609（仅杀引擎臂换代），旧 PTY 47569、MCP 47573，B 五文件、D picked.txt、C/E 空；流 started/released=true、cancelled=false，第一代引擎预期 SIGKILL、新一代正常 exit 0。去真源 opened.has 后 inner 5 pass / 1 fail，E 进入真源使判官红（step7-bad-truth-engine.log）；去 whenSettled 后 inner 4 pass / 2 fail，首次实际模型写入被拒（step7-bad-first-work-six.log），均已 scoped restore。gate 宿主 pin=1、inner 3→6；未扩大为窗口或 G0 证明。

### r3 最终接线 G0/V7 复验与续行点（2026-11-19）

- `cd packages/ui-mac && TMPDIR=<scratch> bun test --max-concurrency 2 src/main/process-fence-extension-packaged.test.ts`：宿主 1 pass / 0 fail、inner 1 pass / 0 fail、exit 0，总 1030.99 s；`step7-g0-final.log`，完整产物 `g0-zMPrUo/`（均在派单 scratch）。生产代码基于 `50e5b7dfcd`；仅测试 main 入口替换生成入口后本地打包，生产 sidecar/.node/profile 保持实际资源，不用替身代替签名链。
- main PID **97989**；Electron **42.3.3**；`codesign --verify --deep --strict` exit **0**、runtime **0x10000**、生产 entitlements 键核对通过。身份仅哈希 **27D86FF5629B9296E616B333E798725A2E01B262**。`--publish never` / notarize=false，本地签名约 17 分钟，无上传/发布。
- 实际打包 `.node` 的 buildId **fence-20261119T131104367Z**，SHA-256 **5f80c8f82f4f8bf8505478d04548def51335aeb2c483b45b38acb3e7f90d3732**（复读签名后资源计算）。

| 臂 | 引擎 / 子进程 pid | 实读磁盘与退出 |
| --- | --- | --- |
| granted | 97993；已有 97995、新 97997 | B=existing.txt,new.txt；C 空；已有脚本末次 C 写 exit 1、新 B 写 exit 0；引擎 exit 0 |
| control（不消费） | 97999；已有 98002、新 98004 | B/C 均空；两次写脚本 exit 1；引擎 exit 0 |
| replay | 新一代 97998 | 绑定令牌消费失败，原 B 探针 denied；新 B/C 空；引擎 exit 0 |
| selfIssue | 98005 | 50 个变体按冻结逐臂预期；C 空，helper/引擎 exit 0 |
| badFileOnly | 98058 | C=generic.txt（零落盘判据红）；helper/引擎 exit 0 |
| badNoDeny | 98062 | C=file.txt（零落盘判据红）；helper/引擎 exit 0 |

- `result.json` 的顺序（ms）：ready **1101.938625** → 旧 child ready **1152.386167** → issue **1152.392833** → consume **1152.769917** → 旧写 **1172.951167** → 新写 **1182.922667**；全过程同一引擎 97993。首个消费往返 0.295791 ms。额外 **100** 个独立目录每个先 denied、签发消费后 writable；从 main 签发开始至生产 sidecar 消费应答计时，最近秩 p50 **0.063833 ms**、p99 **0.106750 ms**；原始 samplesMs 全留 result.json。实读这 100 目录均无探针残留。
- `signing.json` / verify.log / signature.log / entitlements.log / package.log / runtime.log / unregister.log 保留原始脱敏证据。运行 main exit 0、`lsregister -u` exit 0；按报告所有 main/engine/子进程 pid 做 signal 0 核对，均已退出；B/C 清单另由宿主复读确认。生成 main 入口已恢复，打包用攻击二进制已删除；不触及安装版或其数据/凭据。
- 本轮计数：新增 gate display=7、UI census=2、project-writable.engine host=1（inner=6）；拒写 engine host=1/inner=4，仅改旧说明；timeline host=12/inner=124、context=43、policy=68、库存=98 不变。继承步骤 2–5：新增 extension host=1/inner=6、IPC host=1/inner=10、core=14、navigation=5；既有 workspaces 12→15、search 29→32、automation 38→39、write-sites 两行 W1+X1；profile=26/write-sites=12 不变。G0 host=1/inner=1，本轮只加采样断言，gate 登记和总表收口仍在步骤 8。
- 计划同步：r3 的卡片/intent/marker 已删决定写回本节正文，不再保留旧「WriteDeniedNote 留一句」安排；现有 ext 钩子无资格事实，一律中性停止。gate 拒写行的旧重启说明也已同步。必要测试辅助文件与两次夹具纠正见前述记录，没有生产合同/设计路线变更。
- **PARTIAL 续行：步骤 6 完成；步骤 7 后端腿及最终 G0/V7 已通过，步骤 7 可信窗口仍未完成。** 下一步从隔离签名包 Chromium/CDP 的 R1–R5 真输入整链继续，含 R1 建会话/目录解析各 >8 s、R5 历史打开与自动运行/加载不登记、改写目录后的生产自愈/强制 reload 等待期点击、诚实 reload、main 深链不登记/远端负例及对应坏臂。然后步骤 8 的两份架构/I1 事实文档和最终登记/计数收口。现有 happy-dom、backend fixture restart、手工发送 main IPC 均不充当这些窗口证据。
- 已核：Codex / GPT-6，自验；ui-mac/ext 包 typecheck exit 0；未运行 full gate/bin/check。遗留去向：timeline 宿主默认 5 s 期限现象及一次具名确认日志交编排者，本 lane 未改期限或行为断言；其余待办继续本 lane，OPTIONAL 无。全部前台命令结束后在干净提交边界交回。

### r4 窗口证据与 v2 到达前提的历史红证据（2026-11-19）

- 续行基线 `0869f67a48`。窗口先在独立 Electron 副本校准：show=false，CDP Input.dispatchMouseEvent 产生 isTrusted=true；未遇锁屏创建/驱动错误。正式夹具使用真实生产 renderer/preload、main registry/IPC/listener、真实签名 utilityProcess/生产 .node；脚本模型复用 codepuppy-engine.ts，账号与非本 AC 的后台服务只用空状态，定时自动化和 unattended ack 则走真实生产链。
- G0 宿主继续只运行 `.test.ts` → `.cases.ts`。默认仍完整本地 build/package/sign；已有标准 `CODEPUPPY_PACKAGED_APP` 可显式指向本轮已验收副本，仍重建当前 renderer、复跑 G0/验签，然后复制签名包、更换测试入口、按 electron-builder 的 ASAR 库重算 header integrity、仅重签外层并 strict/deep 验证。nested native/framework 字节不变；不以未签名或非 Electron 程序替代 G0。窗口测试与 G0 共用宿主，避免并发构建篡改生成入口。
- 夹具初期的 loader 相对 require、构建期 import.meta.env、空状态形状与 CDP 初始化顺序已各按实际错误修正；M1 的环境短路变量必须等实际 picker IPC 应答才清除，修正了过早删除造成的竞态。临时副本均从可执行文件后台启动、独立 HOME/userData，退出后注销；不操作安装版或账号。所有这些改动只在测试入口/打包辅助与该宿主，不改生产合同。
- 正式命令 `cd packages/ui-mac && TMPDIR=<scratch> CODEPUPPY_PACKAGED_APP=<g0-zMPrUo 的已验收签名包> bun test --max-concurrency 2 src/main/process-fence-extension-packaged.test.ts`。`r4-window-host.log`：内层 **2 pass / 1 fail**，109.60 s；G0 与窗口独立部分通过，单独的 AC-08 外链用例红；宿主按完整 3/0 判官返回 exit 1，没有改低计数。产物 `g0-0yvUmc/window/`：main 77654、engine 77701，M1/R1–R5 各实际模型文件落盘，两个只读钩子缺席，loads 恒 2；创建回复与目录响应各 8.2 s 后仍可写；改写 directory 后强制 reload 期间真实点击侧栏「项目」，E 零文件/不入真源，诚实 reload 可写，loads 仅按两次显式 reload 增至 4。三句残余说明均实达 popover.textContent，内无按钮；原生臂实际 task_name_for_pid 失败，超时臂实际丢弃 grant 消息走请求簿超时。
- r4 观察（r5 已裁定去向）：`codepuppy-app/src/pages/layout-new.tsx:10` 的 NewLayout 没有项目深链消费者；唯一现有消费者挂在 `pages/layout.tsx:1264` 的 LegacyLayout，默认新布局由 `context/settings.tsx:72` 选择。真实窗口已递送的链接仍在 renderer 缓冲，未切到目标目录，不能据此证明目标目录的残余说明。编排者在 spec v3 / `f60096e4d6` 更正 AC-08 到达路径，明确不在本 lane 新增该能力；此观察转 pending intent，深链不产生写资格的既有防护继续有效。下列 r4 红结果保留为历史，不再是当前验收路径。

- r4 窗口坏臂实跑：只对 slow 目录去掉 R1 登记，窗口独立子例由绿转红（slow-open recorded 超时，`r4-bad-slow-r1.log`，`g0-MX860I/window/`）；去 R5 登记同样使独立子例红（R5 recorded 超时，`r4-bad-r5-window.log`，`g0-sWvhvR/window/`）；把登记加进 bridgeProbe 的恢复观察路径，真实模型在改写目录 E 产出 rewritten.txt，使「不可写」判官红（`r4-bad-restore-record.log`，`g0-5dxzfQ/window/`）。三臂内层均 1 pass / 2 fail（除已有外链红外，原先通过的窗口子例也红），已逐文件 scoped restore。没有借已知 AC-08 红来冒充坏臂检出。
- 恢复后的最终命令同上：`r4-window-final.log` 内层 **2 pass / 1 fail**、107.67 s，宿主 exit **1**；失败仅具名 AC-08 外链 DOM 后续，G0 与 12 臂窗口子例均通过。`g0-Lxlbnq/window/window-result.json`：main **98905**、engine **98955**、23 个 click/keydown 全 isTrusted=true，show=false；前 7 个正常臂 loads=2，只有两次显式 reload 增至 4，engine pid 不变。三个理由均到 popover.textContent，popover 无按钮，全应用指定重启按钮缺席。rewritten/deep/failed/timeout/HOME 的目标 txt 均 0；deep 链接递送后再让真实模型写 link-escape.txt 也失败，登记 false，但其缓冲未消费，所以不报深链 UI 臂通过。
- 同次 G0/V7：100 个独立目录签发至生产消费应答的 p50 **0.052042 ms**、p99 **0.112458 ms**（原始样本在 `g0-Lxlbnq/result.json`）；B 仅 existing.txt/new.txt、C 空；control/replay/selfIssue 均 0 越界文件，两个坏 profile 各 1。G0 与窗口副本 strict/deep 验签 exit 0、runtime=0x10000，身份哈希仍 **27D86FF5629B9296E616B333E798725A2E01B262**，窗口 signing.json/entitlements.log 已核。两副本注销 exit 0，按报告所有 main/engine/child pid signal 0 复核均已退出；无前台任务遗留。
- 相关检查：ui-mac `bun typecheck` exit 0（`r4-ui-typecheck.log`）；`bun test --max-concurrency 2 src/main/gate-file-registry.test.ts src/main/project-writable-navigation.test.ts src/renderer/codepuppy-ui/workspace-writable-ui-census.test.ts` **30 pass / 0 fail**（`r4-related.log`）。只复用 ext 已核的 118/0 与 typecheck 0，r4 未改 ext，未重跑无关套件、gate 或 bin/check。

### 最终 AC / 计数核对（spec v3 / r5）

| AC | 已有具名验据与命令结果 | 结论 |
| --- | --- | --- |
| AC-05 | `project-writable.engine.test.ts` host 1/0、inner 6/0（r3）；`bun test --max-concurrency 2 src/main/process-fence-extension-packaged.test.ts` host **1/0**、inner **3/0**（r5-window-final.log），M1/R1–R5、慢开、实际模型文件、无隐式 reload/换代；相关坏臂实红 | PASS |
| AC-06 | 两个 UI 宿主与 census；r4 真 DOM 正常路径双钩子缺席、三句说明无按钮；`bun test --max-concurrency 2 src/main/process-fence-workspaces.test.ts src/main/gate-file-registry.test.ts src/main/project-writable-navigation.test.ts src/renderer/codepuppy-ui/workspace-writable-ui-census.test.ts` **46/0**（r5-related-final.log）；签名宿主同上 **1/0** | PASS |
| AC-07 | V1/V2 extension host 1/0、inner 6/0（r2），签名 G0 50 臂/伪造/回放/坏 profile；backend SQL + 真实窗口 reload/中性点击不登记，观察中登记坏臂实际落盘；独立 main 深链队列交付和 tab 写回不登记、不进真源（上述相关命令 **46/0**，其中 workspaces **16/0**）；去真源过滤坏臂 **0/1**；签名宿主同上 **1/0** | PASS；交付不充当界面导航 |
| AC-08 | main IPC inner 10、UI 三理由；r4 HOME、真实 task_name_for_pid 失败、真实请求簿超时均到 DOM 单句，模型目标写 0 | 签名宿主同上 **1/0**、inner **3/0**，v3 恢复出的改写目录实达 not-opened-by-you→M1 后同代同 renderer 可写；去 grant 坏臂独立 inner **2/1**，第三子例红；三种残余句全到 DOM 无按钮。PASS |

下列是本 slice 的完整计数 / 登记变化（relay 行不重排、不计入本 lane）：

| 位置 | 最终值 / 变化 |
| --- | --- |
| 新 gate 行 | extension host **1**（inner **6**）；project-writable IPC host **1**（inner **10**）；workspace-writable-core **14**；navigation **5**；ext display **7**；UI census **2**；project-writable engine host **1**（inner **6**）；G0/window packaged host **1**（inner 要求 **3/0**；不降钉） |
| 既有 gate 计数 | workspaces **12→16**（r5 增加独立 main 深链不登记用例）；session-search **29→32**；automation-cloud-refusal **38→39** |
| 同一新文件内的子计数演进 | core **10→14**；project-writable engine inner **3→6**；G0/window inner **1→3**（新增两个独立窗口判官） |
| 保持 | profile **26**、write-sites **12**、context-injection **43**、register-policy **68**、timeline host **12**/inner **124**、拒写 host **1**/inner **4**；其余既有相关宿主数不变 |
| 机器登记 / 库存 | 两条 workspace probe write/remove 根 **W1→W1+X1**；导航调用点登记 **83**（r4 不改生产导航）；库存仍 **98**，write-denied **226 bytes**、write-refused **171 bytes**，由步骤 6 脚本生成 |

- 步骤 8：更新设计点名的架构 §2/§7/§8.2 及同文件受影响的判据表 §8.3、基线 I1；保留原始实测/U2 历史。基线补合同要求的 id/summary（原 kind=design 的 UI- 前缀，kind/status/路径不改）。G0 gate 行已追加。相对链接检查 `python3 scripts/check-doc-links.py <上述两文档> <plan.md>` exit 0，18 条均可解析；本仓无 scripts/docs_index.py，未造索引脚本。
- 文档合同按解析出的 Alpha profile 跑，只读全 profile 结果见 `r4-docs-contract.json`；再对同一 checker 的 check_repo 入口核本 worktree，`r4-docs-own.json`。本轮两份事实文档无剩余 findings；plan 的 INT-safety unknown-id 在 `0869f67a48` 已存在，未擅改派单身份。其余既有文档/其它未提供 checkout 的错误不在本 lane 修复，不把该检查报全绿。
- 非阻塞遗留：timeline 旧批次宿主到默认 **5000 ms** 期限（`step6-ui-green.log`），具名期限确认单跑 **6.25 s、12/0**（`step6-timeline-isolated.log`）；r4 不改测试/期限，交编排者。窗口 session 挂载还打印 `engine-adapter/contract/errors.ts:33` 的 unsupported GET /lsp（`window-result.json` console），交适配器 lane，未改。架构 §7 既有 #1391「零消费者」文字与当前 server/custom-provider 读端不符，交文档维护，不扩本次事实改动。OPTIONAL 无。
- r4 续行点已由 r5 / spec v3 取代：不补深链消费落点，AC-08 改走可达的恢复目录，再经现有 M1 选中；以同一签名宿主的第三子例验证。

- r4 窗口证据提交：`92adf89284`；步骤 8 事实文档与 G0 登记另提交。

### r5：spec v3 的可达 AC-08 路径

- 依据 `f60096e4d6` 与 r5 派单。只改验据和事实文档，不改生产接线或冻结接口。窗口尾臂改为真实模型 SQL 改写当前会话 directory，显式 reload 恢复到未登记目录；说明实达 DOM、目标零落盘、不入登记/真源，再经 CDP 真实点击 M1（CODEPUPPY_OPEN_DIR）选择同一目录，校验模型文件、engine/renderer PID 和加载次数。恢复的 reload 属于前置状态，picker 前后不再 reload。独立 main 小用例用生产深链队列及现有真实 wire 样本解码/交付，tab 写回仍不登记；具体打开为正对照。fixture 取自 `packages/ui-mac/src/main/deep-link-queue.test.ts:15-16` 的 OPEN_PROJECT/NEW_SESSION wire 样本，只替换目录参数；没有委派该文件的测试判据。
- 计划偏离：AC-08 的深链到达前提按 spec v3 替换；deep-link-queue.ts 与 NewLayout 均不修改，旧的 UI 深链链路判官改为恢复链路。workspaces 用例 15→16，同步既有 gate 行；packaged host/inner 钉仍 1 / 3。r4 的已核 AC-05/06/07 与坏臂继承，历史红输出保留，当前结果以本节为准。

- 最终命令（cwd `packages/ui-mac`）：`TMPDIR=<scratch> CODEPUPPY_PACKAGED_APP=<g0-zMPrUo 的已验收签名包> bun test --max-concurrency 2 src/main/process-fence-extension-packaged.test.ts`，**host 1 pass / 0 fail、inner 3 pass / 0 fail、exit 0，75.93 s**（`r5-window-final.log`）。当前源码 renderer/preload 重建、窗口副本重签并 strict/deep 验证；结果 `g0-0aL0gX/window/window-result.json`，app exit **0**、56 次脚本模型请求、24 次真实输入全 isTrusted=true、show=false。窗口 main **34965**、engine **35051**。创建回复 **8202.37 ms**、首次目录回复 **8201.80 ms**；原 12 臂全过。
- AC-08 第二残余链的原始事实：模型把当前会话 directory 改写为 `window/rewritten`，一次显式 reload 是到达前置；DOM popover.textContent 为冻结的 not-opened-by-you 单句、无按钮，模型 restored-before.txt 被拒且目录 **0 文件**、登记 false、不进真源。随后真实 CDP 点击 M1 选择同一目录，实际模型文件仅 **window-restored-after.txt**，正文 `window`；前后 engine PID **35051**、renderer PID **35087**、loads **5→5**，登记 false→true，双只读钩子消失。另两种残余句（HOME/状态根、grant-failed 的原生失败与超时）也各实达 DOM，均无按钮。三次显式 reload（V5 改写、诚实重载、AC-08 前置）之外没有额外文档加载。
- 最终 G0/V7 同次通过：main **34765**、granted engine **34778**、已有 child **34786**、新 child **34788**；顺序为 engine-ready→child-ready→issue-start→consume(granted)→existing-write→new-write。磁盘复读 B **existing.txt/new.txt**、C **空**；已有 child 末条 C 写被拒故其记录的 `$?` 为 **1**，新 child B 写为 **0**。control engine **34793**、已有 **34794**/新 **34796** 都为 **1**，B/C 均空；replay engine **34792** 被拒且 B/C 空；selfIssue engine **34797** 的 50 臂均不越界、helper exit **0**；坏 file-only engine **34850** 的 C/generic.txt、坏 no-deny engine **34864** 的 C/file.txt 各实际 1 文件，helper exit **0**。每代 sidecar stop exit **0**。详情及顺序均在 `g0-0aL0gX/result.json`。生产接线未改，不新立性能结论，RTT 沿用已核 r4 的 p50 **0.052042 ms** / p99 **0.112458 ms**；宿主既有 100 样本断言随跑通过。
- 两份 signing.json：strict/deep verify exit **0**、runtime **0x10000**，生产 entitlements 核对通过，身份只记哈希 **27D86FF5629B9296E616B333E798725A2E01B262**。无公证上传/发布；两个副本注销 exit **0**。本轮四组产物报告的 **263** 个 main/engine/renderer/child PID 逐个 signal 0 复核，均已退出。
- 坏臂：移除生产真源的 opened 过滤，新 main 深链用例 **0 pass / 1 fail**、实际真源出现 link-target（`r5-bad-main-truth.log`）；移除 rewritten 目标的生产 grant，原 12 窗口臂仍过，新的 AC-08 子例在 restored-after renderer probe writable 红，**inner 2 pass / 1 fail、host exit 1**（`r5-bad-restored-grant.log`，`g0-OBQQSO/window/`）。两处生产变异均 scoped restore 后才跑上述最终绿。校准仅断 M1 登记仍由合法 R1 后续打开完成登记（`r5-bad-m1-restored.log`），不计为失败对照、不改冻结记录点。
- 检查：相关四文件 **46 pass / 0 fail**（`r5-related-final.log`，3.06 s）；ui-mac `bun typecheck` exit **0**（`r5-ui-typecheck.log`）；ext 未改，继承已核 118/0 和 typecheck 0。首轮相关组 **45/1** 是新 fixture 来源注释触发了跨测试文件分类扫描（`r5-related.log`），来源移到本节，测试自行调用生产代码、没有委派，未改断言或登记判官；随后同组 46/0。G0 宿主现在保留子进程原输出，窗口报告落盘补入已取得的 appExitCode/modelRequestCount，便于复查结果，均为测试文件内改动。
- 同步架构事实中深链的非到达路径和恢复→picker 链，同时改正同节受本改动影响的检疫目录「必须关 tab/重启」旧句；基线 I1 的深链不登记事实仍成立，本轮不改。完整计数 / gate 行仍以上表为准（仅 workspaces 15→16；packaged inner 3 不降钉），无生产文件改动、无新增能力或范围外文件。
- 文档合同：`r5-docs-contract.json` 全 profile exit **1**；同一 checker 的本 worktree 输出 `r5-docs-own.json` 为 **73 个既有 error / 225 warning**，与 r4 完全同数。本轮事实文档无 findings；plan 的 `INT-safety` unknown-id 沿用旧观察，交编排者，不改派单身份。原 timeline 5 s/单跑 6.25 s 以及 GET /lsp、架构 #1391 旧句的既有去向不变；NewLayout 无消费者明确交 pending intent，不修。

- 收口：相对链接检查 `python3 scripts/check-doc-links.py docs/architecture/2026-09-09-req159-process-fence.md docs/design/2026-09-09-req159-process-fence-baseline.md docs/specs/child-process-write-fence/plan.md` exit **0**（19 条，`r5-doc-links.log`）；`git diff --check` exit **0**。已核 Codex / GPT-6，自验 AC-05 至 AC-08 全部具名验据通过；既定路线不重开。交编排者独立 review / push / PR / merge，本 lane 只提交。OPTIONAL 无。

- 环境观察：末次合同复读时，原已解析并使用过的 Alpha profile `/Users/pharaon/app/wt/alpha-work-docs-lightsail-entry-relay/governance/delivery-profile.yml` 已不存在；只做一次 resolver 复核，exit **2 / no_match**（`r5-profile-resolve-final.log`）。未重建其它 worktree/profile；本轮此前已完成的合同输出仍保存在上述 r5 两份 JSON，不把末次复读报为成功，交编排者恢复 profile 落点。

### r6：独立审查修正

- 输入 `78ac263b41`，继承 Opus 的已持有结论；仅处理已接受的 1 Blocker / 3 Minor 及小项。先提交旧实现上的三种软链重绑定真实引擎红臂（登记 D→围栏 PTY 替换 D→杀引擎→新代探针/模型实写）和 null sidecar 原因顺序红臂，再修生产代码。资格与真源使用登记时的 canonical path；每次运行期放行重验 canonical 资格，签发后、发送令牌前再验路径未变。
- 其它差异安排：签名 G0 改显式 opt-in、普通 gate 不构建签名；测试落点改 worktree/node_modules/.cache 并清理大产物，无 import 时写盘；AC-05/V3 的首次消息/终端延迟顺序按真实证据改述为组件证明，后端仅证明直接 tracker 等待和消费后新 PTY，不扩生产入口。所有变动均为本次已接受审查范围。

- 红证据（旧生产代码未改）：`bun test --max-concurrency 2 src/main/project-writable.engine.test.ts` host exit 1 / inner **6 pass、3 fail**（r6-engine-red.log）；HOME、state、HOME-ancestor 三臂的真实目标各实际落盘一个攻击文件，grant=granted / probe=writable，跨代 pid 和落盘事实已拷入 worktree/node_modules/.cache/project-writable/review/r6-engine-red-events.json。`bun test --max-concurrency 2 src/main/project-writable-ipc.test.ts src/main/process-fence-workspaces.test.ts` 的 null sidecar 原因、签发中路径替换与 canonical 登记断言均红（r6-main-red.log）；其中 null sidecar 原始单宿主 inner **10/1**（r6-ipc-red.log）。这些命令只经 test.ts 宿主起 cases。红测试计数：engine inner 6→9、IPC 10→12、workspaces 16→17，并同步 gate 行。

- 修正实现：`checkWorkspaceDirectory` 对候选与 HOME 都先 canonical，返回 canonical；W1 选取用同一结果并按它去重。main 登记存登记当刻 canonical path，has/grant/真源重算都按当前 canonical 资格比对该集合；别名改指其它目录不继承登记。server 在 ledger/issue 前验证传入的 canonical 身份仍未改变，并在 issue 后、发送 token 前再次严格 realpath 比对；变化即 grant-failed，token 只在栈内被丢弃，失败不入账。null sidecar 分支移到资格判断后，仍用冻结 reason。无新增接口、记录点、用户步骤或 fallback。
- 修正检查：r6-core-green.log 的 engine host **1/0**（inner **9/0**）、IPC host **1/0**（inner **12/0**）、workspaces **17/0** 通过；同组旧 profile 的软链诊断后缀断言首次红，恢复原诊断信息后单跑 profile **26/0**（r6-profile-green.log），不改断言。三软链绿证据见 r6-engine-core-green-events.json：HOME 96806→96810、state 96810→96818、HOME-ancestor 96818→96828；均 denied/ineligible、landed=false，残余句为冻结 HOME/状态根句。红测试提交 `f33f293892`，本修正提交不改红测试。

- Minor 2：未发现现有手动发布条件，复用平台不适用行“仍真跑、精确零条、标未验证”的执行方式，增加仅允许签名围栏宿主的 `[环境:CODEPUPPY_TEST_SIGNED_FENCE=1]` 条件；普通 gate 不 build/sign，开关 1 时 host 精确 1 / inner 精确 3。登记簿新增具名单测，实际复制生产 runner 和真实 TSV 行，测未启用→要求 =0、启用→要求 =1、自报不符→红；未执行真实登记簿全门。新 gate 行定义与 distribution.md 发布前命令同步。
- Scratch：G0、engine、extension、IPC 由 host 在 worktree/node_modules/.cache/project-writable 创建独立子树并 finally 清理，只把小 JSON 和截断日志留 results；IPC 每例也清理；navigation 的诊断 JSON 改到 test 回调内写 results，不再 import 写盘。拒写 host 恢复原 packages/ui-mac/node_modules/.cache/fence-write-denied 路径并清理。显式传入的已验收 CODEPUPPY_PACKAGED_APP 是调用方源包，host 只清理自己创建/重签的副本，不删除源包。
- Minor 4 选更小且真实的修正：已改主 V3 行为组件证据边界，不增加新 adapter 整链臂。后端 180 ms 仅直接 tracker 等待；生产 composer/terminal 首次顺序继承已核组件证据。
- 常规宿主检查 r6-harness-green.log：engine/IPC/extension/拒写、navigation、registry 共 **33 pass / 1 skip / 0 fail**（19.53 s），skip 为未开签名开关的 G0；检查后 project-writable 根只剩 results/review，没有残留大目录。registry 用例数 23→24。恢复拒写原落点后单跑 **1/0**（r6-refusal-location.log）。显式签名宿主留到全部生产修正结束仅跑一次。

- 接受小项的红证据：W1 默认工作区从唯一默认路径供给者取得，unknown 探针现误回 not-opened-by-you，`process-fence-workspaces.test.ts` 具名新例 **0/1**（r6-default-red.log）；无实际 attach 点的 sandbox.write-denied 仍在注入 registry，display **6/1**（r6-inventory-red.log）。先提交红测试，workspaces 17→18、display 仍 7；后续移除死片段并由现有库存脚本再生 snapshot。
