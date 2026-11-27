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
   - 入口命令：`cd packages/ui-mac && CODEPUPPY_TEST_SIGNED_FENCE=1 bun test src/main/process-fence-extension-packaged.test.ts`。记录每一臂实际文件清单、pid、ready/consume/write 的顺序和退出码。G0 任一必要臂失败即返回 `BLOCKED: design — G0 — <失败步骤与脱敏原文>`，不继续步骤 2，不改路线；不能把普通 C、Bun 或 `ELECTRON_RUN_AS_NODE` 的成功替代本闸。
2. **固化底层防护与登记簿。** G0 过后扩充 `process-fence-profile.test.ts`、`process-fence-apply.test.ts` 和新 `main/process-fence-extension.test.ts` 宿主/`.cases.ts`；跑 V1/V2 全矩阵及路径语义负例。同步 X1 根登记和探针 `W1+X1`，运行检查组 A。新增检查先提交红测试，再提交实现，不在实现提交改掉红测试。
3. **main 资格、真源与运行期放行。** 先加资格/真源和 IPC 的红用例；实现 workspaces、server、ipc、preload 及必要 index 接线；不改 `deep-link-queue.ts`，深链接只消费。新 `main/project-writable-ipc.test.ts` 起同名 `.cases.ts` 隔离 Electron mocks，实际调用生产 handlers、tracker 和 server 监听器。覆盖 picker 返回顺序、同时重复请求、超时/退出/异常、失败后成功通知、tab 先写后登记、检疫目录经 picker 正式登记、深链不能登记、远端不触达本机。运行检查组 B。
4. **打开动作记录点，独立提交单元。** 依冻结设计 §4，在 M1 与 R1–R5 记录具体目标；renderer 唯一桥接 `recordWorkspaceOpen` 只由 R1–R5 调用并在导航/创建会话之前 await。不采样 `navigator.userActivation`，不使用入口键/草稿目录比较，probe 不登记。新增导航/选择调用点机器登记簿及结构检查，覆盖 P-15 的 record / consume 分类和记录函数的调用来源。
   - `workspace-writable-core.test.ts` 验跨 server 缓存、通知、迟到回复和登记桥接；新 `ui/workspace-writable.component.test.ts` 宿主起 `test-component/workspace-writable.cases.ts` 挂真实组件，覆盖 R1–R5 与恢复/SSE/重挂只消费。真实窗口补证留步骤 7。
   - V4 增加 R1 建会话回复及目录解析各延迟 >8 s 仍可写、自动化历史打开可写；V5 增加改写目录后强制重载等待期点别处不登记、诚实重载仍可写。去 R1/R5 登记、restore 中新增登记、未分类新调用点分别作为坏臂。
5. **首次工作的顺序。** 在上表两个真实调用点接共享 `whenSettled`，使用提交时冻结的 server/directory；延迟内、超限、切换身份和远端/无围栏各有用例。实际 prompt/startChat/command/terminal create 必须在约定等待之后，不以禁用按钮、隐藏 composer、重挂终端或改发送 API 实现。跑检查组 C；真引擎顺序在 V3 再核。
6. **残余界面与本分支临时拒写提示一起收敛。** 先提交正常可写路径、三种残余状态和模型提示的红测试，再改壳、chip、双语文案和 interim 消息；跑检查组 D。r3 基线的时间线卡片、按钮、intent 已删，不重加。
   - 模型提示不再说启动时定死、重启后才可写或有重启按钮。已证实目标属于未亲手打开目录时，说明该事实，要求不要绕过、停止并告诉用户可用「打开项目」选中。
   - **最小归因规则：裸 `EPERM` 或 shell 的 `Operation not permitted` 只证明操作被系统拒绝；工具的已知目标也不等于 main 的用户打开登记事实。** 现有 ext 错误钩子没有该事实，只注册并附中性停止说明；没有 attach 点的精确未打开片段在 r6 移除。用户侧仅壳/chip 消费 main 的确切 `reason`，显示对应残余句。不能为文案新增 roots 清单、副本判定或跨层权限 API。shell 未知目标、可写根内的非围栏 EPERM 必须有反例；不得把未知错误变成用户的错误原因。
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

### 最终 AC / 计数核对（spec v3 / r6）

| AC | 已有具名验据与命令结果 | 结论 |
| --- | --- | --- |
| AC-05 | `bun test --max-concurrency 2 src/main/project-writable.engine.test.ts` host **1/0**、inner **9/0**（r6-optionals-green.log 同组）；`CODEPUPPY_TEST_SIGNED_FENCE=1 … bun test --max-concurrency 2 src/main/process-fence-extension-packaged.test.ts` host **1/0**、inner **3/0**（r6-signed-final.log），M1/R1–R5、慢开、实际模型文件、无隐式 reload/换代；延迟生产提交入口的顺序为组件证据，边界见 V3 行 | PASS |
| AC-06 | 签名宿主同上 **1/0**：当前真实 DOM 正常路径双钩子缺席、三句说明无按钮；原 UI 宿主/census 证据继承。相关源码/登记检查 r6-related-final.log **109/0**，未重跑无改动的整套 UI | PASS |
| AC-07 | V1/V2 extension host **1/0**、inner **6/0**（r6-harness-green.log）；签名 G0 自签 50 臂/回放/两个坏 profile；真实引擎 HOME/state/HOME-ancestor 重绑定红 **6/3**→绿 inner **9/0**，目标各由 1 个攻击文件→0，原 6 臂同过；main IPC inner **12/0**，签发中改路径丢 token、不入 ledger；main 深链不登记的 workspaces 用例在 **18/0** 中 | PASS |
| AC-08 | signed host **1/0**、inner **3/0**：三个残余原因到 DOM、无按钮；恢复改写目录→M1 同代同 renderer 可写。`bun test --max-concurrency 2 src/main/project-writable-ipc.test.ts` host **1/0**、inner **12/0**，null sidecar 先判 HOME/未登记资格，默认 W1+unknown 不误称未打开（workspaces **18/0**） | PASS |

下列是本 slice 的完整计数 / 登记变化（relay 行不重排、不计入本 lane）：

| 位置 | 最终值 / 变化 |
| --- | --- |
| 新 gate 行 | extension host **1**（inner **6**）；project-writable IPC host **1**（inner **12**）；workspace-writable-core **14**；navigation **6**；ext display **7**；UI census **2**；project-writable engine host **1**（inner **9**）；G0/window packaged host opt-in **1**（inner **3/0**）；常规无开关自报 **0 pass / 1 skip**，登记 runner 精确核零并标本次未验证 |
| 既有 gate 计数 | workspaces **12→18**（r5 深链、r6 canonical 身份与默认 W1）；gate registry **23→24**（签名 opt-in 条件判官）；session-search **29→32**；automation-cloud-refusal **38→39** |
| 同一新文件内的子计数演进 | core **10→14**；project-writable engine inner **3→6→9**；IPC inner **10→12**；navigation **5→6**；G0/window inner **1→3**（新增两个独立窗口判官） |
| 保持 | profile **26**、write-sites **12**、context-injection **43**、register-policy **68**、timeline host **12**/inner **124**、拒写 host **1**/inner **4**；其余既有相关宿主数不变 |
| 机器登记 / 库存 | 两条 workspace probe write/remove 根 **W1→W1+X1**；导航调用点登记 **83**（r6 改为调用点键，分类不变）；库存 **98→97**，移除无 attach 点的 write-denied，write-refused **171 bytes**；现有库存脚本再生 |

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

- 导航登记小项可局部处理：新增“无关函数体编辑不改变调用点键”回归例，旧 scanner 把整个函数体放进 reference key，**5 pass / 1 fail**（r6-navigation-red.log）。改键前保留实际 83 项 AST 输出与原 ledger；按同一 AST 调用点逐项迁移原分类，仍保留漏分类/恢复误登记坏臂；gate 5→6。默认工作区修正使 boot 多一次既有默认路径校验，旧“请求不查盘”例改为与 boot 后快照比较，仍断言远端/HOME 请求零新增查盘，不改新红测试。

- 小项实现：默认 W1 路径复用 codepuppyUserWorkspaceDir，在 boot 初始化资格时与受信真源共同走同一 canonical 谓词，不经新增记录点、不扩大启动 W1 之外的范围；unknown 探针不再给它 not-opened-by-you。移除无 attach 点的 WRITE_DENIED_ID/NOTE 与 registry 项，库存脚本再生 **98→97**，neutral stop 保留。导航 key 改为 file/owner/callee-or-reference/ordinal，83 个 AST 点逐项保留原分类，去掉函数体/参数源码的偶然耦合；新抗无关编辑例与原坏臂均在，navigation **6/0**。
- 小项检查：r6-optionals-green.log 的 workspaces **18/0**、navigation **6/0**、IPC host **1/0**（inner **12/0**）、engine host **1/0**（inner **9/0**），合计 **26/0**；ext display/context/policy **118/0**（r6-ext-green.log），ext typecheck exit 0。ui-mac typecheck 首次发现本次重复导入了 server 已有的 realpathSync，删除重复导入后 r6-ui-typecheck-final.log exit **0**；无更改红测试来通过。

- r6 最终签名命令（cwd packages/ui-mac）：`CODEPUPPY_TEST_SIGNED_FENCE=1 CODEPUPPY_PACKAGED_APP=<r1 已验收签名源包> bun test --max-concurrency 2 src/main/process-fence-extension-packaged.test.ts`，**本轮显式签名仅这一次，host 1/0、inner 3/0、exit 0，82.22 s**（review/r6-signed-final.log）。原生实现未改，G0 复用已验收 native/base；窗口仍重建当前 renderer/preload 和当前生产 main registry/IPC/server 后重签自己的副本，不以旧 main 接线替代修正验据。源包从未是安装版。
- 签名小结果现位于 worktree/node_modules/.cache/project-writable/results：`signed-fence-7IACOU-result.json` / `signed-fence-7IACOU-window-window-result.json` / 两份 signing.json。strict/deep verify **0**、runtime **0x10000**、生产 entitlements 通过；身份仅哈希 **27D86FF5629B9296E616B333E798725A2E01B262**。G0 main **5308**、grant engine **5327**、已有 child **5349**；B=existing.txt/new.txt、C 空，control engine **5360** B/C 空，replay engine **5352** 被拒，selfIssue engine **5371** 的 50 臂 C 空；坏 file-only **5438** 的 C/generic.txt、no-deny **5454** 的 C/file.txt 各 1，helper/正常 engine exit 0。ready→issue→consume→已有/新 child 写的实际顺序和写脚本退出码保留在 result.events；不是以错误码代替落盘判官。100 次往返新样本 p50 **0.058500 ms** / p99 **0.109792 ms**。
- 窗口 main **5533**、engine **5599**、app exit **0**、24 个输入全可信、show=false；M1/R1–R5、慢开、两重载防伪、三句残余与恢复→picker 后续全过。AC-08 picker 前后 renderer **5634**、engine **5599**、loads **5→5**，目标从 0 文件变为仅 window-restored-after.txt。两个 app 注销 exit 0；host 的 finally 已删除自己的 signed-fence 子树和 app 副本，根只剩 review/results。当前结果 JSON 的 **140** 个报告 PID 逐个 signal 0 均已退出。
- 三软链最终绿结果（results/project-writable.engine-Gx5BhP-events.json）：HOME **2661→2706**、state **2706→2735**、HOME-ancestor **2735→2761**；先证目标不在任何写根，再 probe/实际模型写，全部目标零新文件、ineligible/home-or-app-state，生产 formatter 的冻结单句匹配。对照红结果中的同三目标各 1 个攻击文件（review/r6-engine-red-events.json）；不是空白 fake grant 或 mock 文件系统证明。主进程 null sidecar 的未登记/HOME 原因与签发中改路径不发 token/retry 用例均在 inner 12。
- 最后相关检查（r6-related-final.log）：profile、plan、wiring、write-sites、gate registry、local-gate-parity 合计 **109/0**，23.94 s；未跑真实全 gate/bin/check。前面的 harness **33/0 + G0 skip**、小项 **26/0**、ext **118/0** 及两包 typecheck 0 共同覆盖本轮改动；数字已按上述最终表同步。
- r6 文件范围补充：scripts/assert-gate-files.sh / gate-file-registry.test.ts 为 Minor 2 必要同调用链，增加具名 opt-in 与自报零条判官；distribution.md 为其发版操作入口。其余都在已许可文件/测试和文档中，没有 core/relay/秘密读保护变更。Minor 4 只纠正证据表述；默认目录、死注入项、83 个登记键三个接受小项均已处理。
- 非阻塞观察：profile resolver 仍 **exit 2 / no_match**（review/r6-profile-resolution.log），继承 r5 的落点缺失，无法重跑全 profile 文档合同，交编排者；不冒充文档合同通过。相关测试日志打印 official-connector-resources.ts:356 的 orphan cleanup warning，测试全绿；仅记录日志观察、不调查或改该模块。timeline 的 5000 ms / 单跑 6.25 s、12/0 既有去向不变，本轮未改该文件或期限。

- 无开关实跑 `env -u CODEPUPPY_TEST_SIGNED_FENCE bun test --max-concurrency 2 src/main/process-fence-extension-packaged.test.ts`：**0 pass / 1 skip / 0 fail，exit 0，22 ms**（review/r6-g0-default.log），没有创建临时树；常规门的同一行为由 registry 的 fixture 判官要求 =0 并标未验证。
- 文档/差异收口：四份相关文档相对链接 **21 条全部通过**（review/r6-doc-links.log），git diff --check exit 0。核对人 Codex / GPT-6，自验；本轮审查项全部完成，既定 six record points / frozen API 形状不重开。只提交，由编排者 review / push / PR / merge；未读安装版数据/凭据、未发布/公证/上传，OPTIONAL 无未做项。

### r7：单一身份规则的红证据与异步接缝

- 输入 `bfb5b62a35`，R2 发现已接受，尚未改生产身份逻辑。新回归统一等待返回（对旧同步值也成立），便于接缝裁定后原样驱动同一实现；不逐点修补 planner/seed 的身份逻辑。
- 已复现的旧行为：workspace-identity host exit 1 / inner **0 pass、7 fail**（review/r7-identity-red.log）。新 app 读旧真源把 D→LaunchAgents 认作已登记、签发 1 次；诚实 symlink、`/tmp`、case 三条各过两次重启，均出现 quarantine/真源丢失；模拟失联真实解析依赖令 main 与其它目录查询耗时约 **604 ms**；同一 tab 连续十次写回额外 realpath **10 次**。
- firmlink 必须在 Electron Node 验：Bun 实测 native realpath 把 Data/HOME 归一成 HOME，不能拿它充当 Node 的反向臂。新 fixture 在 Electron **Node 24.15.0** 调生产 tracker/planner，Data 拼写保持 Data；同 dev/ino 为真，旧 register 返回 eligible:true、runtime 调用一次 issue、planner 将 Data/HOME 写入 W1。仅读写隔离 cache 树的 HOME/状态夹具，不读取安装版数据/凭据；未把该 Node 单测当作签名 G0。
- 真引擎生产 planner 红证据（review/r7-engine-red.log）：原 9 臂过、新 2 臂红（inner **9/2**）；真实围栏 PTY 替换 D 后杀引擎，`planProcessFence` 输出 W1 含 LaunchAgents 替身，新 engine 实际产出 **planner-escape.txt**，同真源新 app 的 seeded=true；另一个启动 W1 内项目已能实际写文件，但仍调用原生 issue **1 次**。真实 .node 的方法只作计数包装，没有替换其实现。此前三条 r6 HOME/state/ancestor 臂仍过。
- 通知/无需签发的独立红证据：IPC inner **12/1**；renderer core **14/1**（同组 r7-probe-cache-red.log）。core 新例要求同 server 的 ineligible/failed 别名全部失效、writable 与其它 server 保留；不是靠删缓存判官。计数同步：engine inner **9→11**、IPC **12→13**、core **14→15**；新增 identity host **1**、inner **7**，均不降钉。
- **BLOCKED 的冻结接缝**：design.md:183 `register(input): WorkspaceEligibility`、:185 `has(...): boolean`；现有 profile.ts:355/379、plan.ts:75、workspaces.ts:188 均是同步真实结果。R7 第 5 条要求三处 security decision 每次重新解析，而且失联卷不能阻塞 main。同步等 worker / Atomics.wait 仍会阻塞 main，先返回 pending/稍后偷偷登记又会改冻结语义；本 lane 不采用这两种替代。已发出澄清，未收到裁定时不改该接缝。
- 所需最小裁定：允许内部 registry、共享 identity/predicate、planner、truth 初始化/更新返回 Promise，由现有 main handlers/boot/spawn 链 await；保留 IPC 回复/消息、native API、六记录点和 UI 步骤。拟以一个异步身份函数统管 canonical + firmlink 归一、dev/ino 祖先比较、stillSelf、按 literal 缓存与 fresh 三处重验；文件系统查询在独立 worker 进行，由 main 异步期限结束并排除当次不可达项，后续 fresh 查询可恢复。issue 前先 probe，writable 不签发，仅明确拒写且身份有效才 issue，post-check 只作便宜断言。该方案尚未实施或宣称通过。

- 已独立完成 R7 的通知规则：workspace-writable-core.ts:89 的 invalidate 对同 server 的 ineligible/failed 条目全部失效，并保留非命中的 writable/其它 server 条目；不引入目录解析或新身份权威。新回归从旧 **14/1** 到 **15/0**（review/r7-cache-green.log），core + new-session 组件 + registry + local parity **60/0**（review/r7-cache-related.log），ui-mac typecheck exit **0**（review/r7-ui-typecheck.log）。红测试提交 `ab64f8428a`，通知修正另提交，未改该新回归断言。
- 门的 summary、逐行消息和 codepuppy-check 的说明改为“本次未验证”，不再把未开签名开关误说成本平台不适用；只有文案/注释改变，计数与退出码不变。具名 registry fixture 复核 **24/0**（review/r7-conditional-message.log），没有执行真实 gate。
- 小结果拷至 review/r7-identity-red-result.json、r7-engine-red-events.json、r7-engine-red-proof.json；临时 app/目录由各 host 清理，所有本轮真实引擎报告 pid 均已退出。新身份函数尚未实施，故五消费者仅列待接线点：runtime grant（workspaces.ts:273）、W1（profile.ts:379）、seed（workspaces.ts:223）、quarantine/recompute（workspaces.ts:197/238）、renderer invalidate（core.ts:89，通知子项已完成）。签名宿主本轮未运行：身份主链仍受上述冻结接缝阻塞，不拿旧接线的绿结果充当 R7 完成。
- 后续从这个干净提交边界继续：先取得内部异步接缝裁定；再实现一个身份/有效性函数及五消费者，跑现有 red host 到全绿，最后一次签名 G0/窗口复验。登记、planner、播种的 Promise 裁定未返回前，不实现同步等 worker、临时 pending 假登记或另一条身份判定。已核 Codex / GPT-6，自验；当前结论 **BLOCKED: frozen synchronous identity seam**，不是 DONE。

### r8：同步接缝裁定与修复

- 核对：IMPLEMENT · r8 orchestrator receipt · HEAD 3d95eca94d；同步 register/has/planner/seeding 保持，失联卷有界要求及证据臂撤回，r7 异步接缝提议不实施。
- 红证据复核：identity inner **0/6**（review/r8-identity-red.log）；保留播种、firmlink、三个诚实别名、缓存断言；十次 tab 更新仍额外解析 10 次，新增 tab 的首次解析应为 1 次。host inner 钉由 7 改 6 仅对应明确撤回的一臂。
- 偏差：the first resolution of a path on an unreachable volume blocks as the existing synchronous directory checks do; not changed by this work
- 接手（Claude Opus 5.5，2026-11-20，同一 r8 范围）：上一位实施者停在未提交草稿处。保留：device + inode 祖先链保护、Data 卷拼写仅在同 inode 时归一、`stored` = stillSelf、tracker 按身份检疫 / 过滤 / 播种、先探后签、虚拟盘夹具补 metadata、IPC 夹具按 probe→issue 顺序等待、窗口宿主的 firmlink HOME 与软链恢复臂。改动：①函数改为纯函数，只有 `open` / `stored` 两种模式，删去草稿里按输入对象挂在模块级 WeakMap 上的隐式缓存；literal 缓存归 tracker 的 `seen`（具体打开与 `has` 刷新）。②不在盘上的保护根（状态根 / HOME）以最近的现存祖先代表——草稿遇到不存在的状态根会把一切候选判为不合格（`process-fence-wiring.test.ts:761` 首启播种写出空清单，红）。③不合格分支只在回答 probe 时才探，picker 的签发路径不额外探。④窗口宿主「选中前不进真源」改查别名指向的 canonical 身份（真源只存身份，查别名拼写恒真，判官失效）。
- 唯一函数：`checkWorkspaceDirectory`（`packages/ui-mac/src/main/process-fence-profile.ts:358`）。消费者：生产 planner 候选 `selectWorkspaceUnion`（同文件 `:446`，默认工作区 `open`、真源条目 `stored`，排除理由进 planned 日志）；启动装载 / opened 播种（`process-fence-workspaces.ts:215` stillSelf，`:252-253` opened 只含通过者与默认工作区）；首启播种（`:227-230`）；检疫与真源过滤（`:216-219`、`:248-251`、`:257-260`，按身份比较）；登记与 `has`（`:285`、`:296`，fresh）；运行期签发（`:309` 先读身份，`:322` 先探，`:331` 签发前 fresh stillSelf）。`server.ts` 签发前后的 realpath 比较不变，只把签发后那一处注明为断言。
- 先探后签：probe 答 writable ⇒ 不签发、答 granted；答 denied ⇒ stillSelf 后签发、再探给 renderer；答 unknown ⇒ 不签发、答 failed / grant-failed（引擎退出、请求簿超时也在此答 grant-failed，与设计 §4 失败处理一致）。被围栏代码不能创建 / 移除 / 重命名它写不进的路径组件，因此签发时解析的路径无从竞态；签发后比较仅作便宜断言。
- 偏离（相对 design §4 ⑤⑥ 的「先签后探」）：按 R7 第 4 条改为先探后签；`unknown` 不再触发签发（签发会落在 denied-only 的竞态论证之外），原「签发成功 + unknown ⇒ 无标记」变为 grant-failed 一句；默认工作区在 W1 中时 unknown 仍不说「不是你亲手打开的」（r6 第 5 项不变）。owner 不必为此决策：不新增步骤或限制，只在探不出时说明暂时写不进。
- 夹具同步（断言意图不变）：profile / plan / workspaces 纯虚拟盘的三个文件补 `stat`（dev 固定、ino = 路径）；词法已知坏臂显式注入虚拟 metadata，仍各自落进 selected。IPC 夹具：typed issue 失败臂用 `afterProbe = "unknown"`（先 denied 才会签发，签发后探 unknown），并发合并臂 / 退出臂在首探应答后再断言签发；picker 两目录先各探一次（probes 0→2）。workspaces「默认工作区 unknown」臂期望由 `{unknown, granted}` 改为 `{unknown, failed, grant-failed}`，仍断言不冒充「不是你亲手打开的」。
- 证据（cwd packages/ui-mac，均 exit 0）：`bun test src/main/workspace-identity.test.ts` host 1/0、inner **6/0**（HEAD 生产代码 0/6，review/r9-identity-red-head.log；绿 results/identity-6fFWtn-result.json：播种改指 has=false / ineligible / issued 0 且日志点名排除；Data 拼写 HOME 登记、运行期、planner 三处都拒；诚实 symlink / `/tmp` / case 两次重启 quarantine [] 且真源 [canonical]、probe writable；十次未变 tab 额外解析 **0**、新 tab **1**）。`bun test src/main/project-writable.engine.test.ts` inner **11/0**（HEAD 9/2，review/r9-engine-red-head.log；绿 results/project-writable.engine-65YSs4-events.json：生产 planProcessFence W1 仅 [A]、改指 LaunchAgents 替身的条目以 stillSelf 理由排除、新启动 seeded=false、grant ineligible、替身零文件；启动根内项目 issued **0** 且文件落盘；三软链 HOME / state / HOME 祖先均 ineligible / home-or-app-state、零落盘）。`bun test src/main/project-writable-ipc.test.ts` inner **13/0**。单测 profile / plan / workspaces / wiring **71/0**（草稿时 70/1）；相关面 15 个文件 **122/1**，唯一失败见下方观察；`bun run typecheck` exit 0。
- 变异（各自还原，review 由 r9-probe/mutate.py 驱动）：planner 候选改 `open`（跟随新目标）⇒ planner 臂红；播种改为跟随新目标 ⇒ 播种臂红；去掉 Data 归一且 HOME 改字符串比较 ⇒ firmlink 臂红（任留其一即绿：两层独立）；tracker 不缓存 ⇒ 缓存臂红（10 次）；检疫按 literal ⇒ 三个诚实臂红；writable 仍签发 ⇒ engine 与 IPC 的「零签发」臂红；签发前去掉 stillSelf ⇒ 三软链臂红（server 断言仍挡住落盘，原因变 grant-failed）。
- 签名宿主（本轮仅一次，cwd packages/ui-mac）：`CODEPUPPY_TEST_SIGNED_FENCE=1 bun test --max-concurrency 2 src/main/process-fence-extension-packaged.test.ts`，本地构建并签名、`--publish never`、关闭公证、未用复用基包：host **1/0**、inner **3/0**、exit 0、**724 s**（review/r9-signed.log；results/signed-fence-s8uNL5-*）。G0 passed；窗口 passed：Data 拼写 HOME 经 M1 选中后显示 home-or-app-state 那一句；AC-08 恢复到软链别名，选中前 registered=false、0 文件，选中后同 engine **86627**、同 renderer **86669**、loads **5→5**、registered=true、仅 window-restored-after.txt 落盘。宿主已删除 signed-fence 子树与 app 副本，无残留进程。
- 计数 / 登记：各宿主钉不变（identity 6、engine 11、IPC 13，单测文件条数不变）；gate-files.tsv 只补 engine 行描述（生产 planner 臂、零签发臂、三软链 device + inode）。
- 观察（不在本切片处理）：`custom-provider-truth.test.ts:97` 自 `403f112ee9` 把 X1 写进 `WRITABLE_ROOT_IDS` 后即红（固定行枚举多出 X1），与身份规则无关；「denied ⇒ 无从竞态」的前提要求探针探到的是真实目录本身——父路径可写时，被围栏代码可只在探针那一刻把 D 换成指向拒写处的软链，再在 stillSelf 与签发之间来回切换，属三步时序竞态，交编排者定是否收紧（例如探针不跟随末段软链并回报 dev/ino 与 main 比对，涉及 probe 合同）。

### r9：签发判定改为 main 的静态包含；根 id 回归

- 核对：IMPLEMENT · 编排者 r9 receipt（接受 2ddcb47009 / 59d2148821 / cc4c8ae64e）· 两项后续：三步竞态改为静态判定；`custom-provider-truth.test.ts:97` 本 lane 回归。本节取代 r8「先探后签」与「unknown 不签发」两条的签发依据（探针不再决定是否签发）；r8 其余结论不变。
- 判定：身份落在本代已能写的范围内 ⇒ 永不签发，探针只报可写性（writable ⇒ granted；否则 grant-failed，被改指的身份由 stillSelf 给出更准的那一句，不建令牌）。不在其中 ⇒ 任何祖先都不能被围栏代码创建 / 移除 / 重命名（某个祖先的父目录可写就会把它自己放进那个根），stillSelf 后签发无从竞态；`server.ts` 签发后比较仅作断言。picker 签发路径对范围内目录直接答 granted、不探。
- 根清单来源（唯一）：本代 apply 的 profile 字节由渲染器所在模块解析回写规则 `processFenceWriteRules`（`packages/ui-mac/src/main/process-fence-profile.ts:204`，渲染块的严格逆；X1 扩展行不算规则；其它 `(allow file-write*` 写法抛），包含判定 `processFenceRulesCover`（`:230`，祖先链任一级被 subpath / literal / regex 盖住即算，大小写折叠，偏向判「覆盖」）。`server.ts:611` 每代解析一次（解析失败 ⇒ 记一行、本代一律按「覆盖」处理，不签发），`:617` `generationWrites` 再并上本代已放行目录与**其它**目录的在途放行（同一目录的在途放行由 grantWrite 合并，不再签发）。决策点 `process-fence-workspaces.ts:322`；签发前 stillSelf `:337`；签发 `:339`。不读 sidecar、不读候选目录的盘上状态。
- 证据（cwd packages/ui-mac）：红提交 `f4e52cf77a`（cc4c8ae64e 生产代码）——engine inner 12/1：写根内 `A/race-project` 的探针在 main 接缝被答 denied、签发瞬间被换成指向 `race-target` 替身的软链再换回，真内核实际签发 **1** 次、`race-escape.txt` 落进替身（review/r10-engine-red.log，results/project-writable.engine-p0nanQ-events.json）；IPC inner 13/1（起始根内 denied 探针仍签发）。修复后：`bun test src/main/project-writable.engine.test.ts` inner **13/0**（race 臂 issued **0**、替身 `[]`、denied / failed / grant-failed 与该句中文；写根外 `outside-project` issued **1** 后落盘，其内 `inner` 再 0 次且落盘；启动根内 issued 0；planner、播种、三软链臂不变）；`bun test src/main/project-writable-ipc.test.ts` inner **15/0**（起始根内 denied ⇒ 零签发 grant-failed；其它目录在途时其内子目录不签发）；identity inner 6/0；单测 + 相关面 20 文件 **196/0**；registry fixture 24/0；typecheck 0。
- 变异（各自还原，r9-probe/mutate2.py）：探针决定签发 ⇒ engine race 臂与 IPC 四臂红；去掉本代放行账本 ⇒ 写根外嵌套臂红（第二次签发）；去掉其它目录在途 ⇒ IPC 在途臂红；profile 规则置空 ⇒ 启动根内零签发臂红。
- 夹具同步：IPC 桩 profile 改为渲染器的块形态并含起始根 A；IPC 桩探针按内核模型对已消费的目录答 writable（此前恒答 denied，靠 grant 字段掩盖）；回退 2ddcb47009 里只为「先探后签」所加的 IPC 改动（afterProbe、两处 `Bun.sleep(0)`、picker probes 2→0）。identity / firmlink / workspaces 的监听器替身补 `generationWrites`。
- 根 id 回归（第 2 项）：X1 留在 `WRITABLE_ROOT_IDS`（design §4：写入点登记簿把探针根记为 W1+X1），它是运行期扩展类、渲染在固定块之外；改测试期望为去掉 W1 与 X1 的固定行集合（`custom-provider-truth.test.ts:96-99`）。其余枚举根 / 写入点的测试（profile id 集合、write-sites、egress / mcp / project-trust / custom-provider fence）同批全绿，没有别处钉旧集合。
- 计数 / 登记：profile 单测 26→27；IPC 宿主 13→14→15；engine 宿主 11→13；gate-files.tsv 三行同步描述。
- 签名宿主（本轮一次，签发判定改动后）：`CODEPUPPY_TEST_SIGNED_FENCE=1 bun test --max-concurrency 2 src/main/process-fence-extension-packaged.test.ts`，本地构建签名、`--publish never`、关闭公证：host **1/0**、inner **3/0**、exit 0、**693 s**（review/r10-signed.log；results/signed-fence-nUiAIH-*）。G0 与窗口均 passed：M1/R1–R5、Data 拼写 HOME 一句、原生 / 超时两种 grant-failed、AC-08 软链恢复选中前 0 文件、选中后同 engine **46358** / renderer **46395**、loads **5→5** 落盘。临时树与 app 副本已清理，无残留进程。

### r10：代码审查 R3 修正（运行内携带、缺失≠改指、块后写拒绝）

- 核对：IMPLEMENT · 编排者 R3 receipt（独立审查 bfb5b62a35..5a0dea2b1f：FIX-THEN-MERGE，1 Major + 1 Minor 全部接受，外加一项加固）。不接受项照录：大小写折叠的包含判据在大小写敏感卷上可能误判「覆盖」（只会少一次签发、答 grant-failed），保持不变。
- 运行内可写历史（Major，第 a 部分）：位于 tracker（`packages/ui-mac/src/main/process-fence-workspaces.ts:231` `carried`，目录 → 拥有它的各代监听器）。记录两种来源：每代 apply 的 W1 成员（r10 时取自本代 profile 的 `; W1` 行；r11 起改为计划对象自己的工作区清单，见下节），以及每次签发尝试（`:378`，尝试即记：回应超时也可能已被消费）。planner 经 spawn 入参拿到它：`index.ts:1454` / `:1608` 传 `fenceRun: fenceWorkspaces`，`server.ts:543` 把 `carriedWorkspaces()` 交给计划器，生产计划器 `:297` 转给 `planProcessFence`，后者把它接在真源条目之后（`process-fence-plan.ts:113`），逐条同样走 `stored`。运行期包含判定再并上「其它代」持有的条目（`process-fence-workspaces.ts:237`、`:361`）：同一次运行里，上一代可写过的目录后来永不再签发。W1 封顶把携带项挤掉的极端情形答 grant-failed 那一句，不另加机制。只在内存：应用重启后 W1 只来自真源。
- 剩余 R-f（第 b 部分，只记录）：活过应用重启的孤儿仍持旧沙箱，新运行里重新打开它写得进、却不在新 W1 的目录时签发可被竞态；关闭需进程树生命期，不在本切片。已写入 design.md §6 剩余风险与 §10 第 9 条（2026-11-20，orchestrator ruling after code review R3）。
- 缺失≠改指（Minor）：`checkWorkspaceDirectory` 对此刻解析不了的路径标 `missing`（`process-fence-profile.ts:461`）。启动装载只排除解析到别处或落进保护位置的条目，`missing` 的留在 `current` 与 `opened`（`process-fence-workspaces.ts:246`）；literal 缓存只存合格结果；缺失时 literal 的词法形态只能匹配已登记条目（`:218`，缺失路径永远加不进来）；探针对「已登记但此刻不在盘上」答 `{ unknown, failed }`、无那一句（`:342`），出现后同次运行照常判定。
- 加固：解析器在 allow 块之后遇到任何 `(deny file-write*` 即抛（`process-fence-profile.ts:215`），调用方按「覆盖」处理、不签发。
- 夹具同步：引擎 fixture 的启动自检原来以项目 B 作「已知写不进」目录；B 在第一代被放行后按裁定进入后续 W1，自检改用从不登记的 `self-check-outside`。引擎与签名窗口的 planFence 替身都接收 `carriedWorkspaces`（与生产计划器同一入参），并传 `fenceRun: tracker`。IPC 用例把起一代抽成 `spawnGeneration()`。解析器往返用例补上行 id。
- 证据（cwd packages/ui-mac）：红提交 `a7841d163f`（5a0dea2b1f 生产代码）——engine inner 13/1：第 N 代放行无 tab 的 `carried-project`，一个第 N 代的进程以独立会话活过强制换代，N+1 中签发 **1** 次，该进程在签发瞬间把路径换成指向 `carried-target` 替身的软链，替身里落下 `through-toggle.txt`，N+1 的 W1 只有 [A]（review/r11-engine-red.log）；identity inner 6/1（启动时缺失的条目被移出、显示「不是你亲手打开的」）；解析器单测红（块后写拒绝不抛）。修复后：engine inner **14/0**（survived=true，N+1 issued **0**，W1 含 `carried-project`，新一代写入落盘，存活进程换成软链后替身 `[]`；results/project-writable.engine-AaNuYq-events.json）；identity inner **7/0**（缺失时 quarantine []、has=true、`{unknown, failed}`、真源仍在；出现后 writable / granted、签发 1 次、真源保留）；IPC inner **16/0**（新增：上一代签发过的目录在 W1 不含它的下一代不再签发、答 grant-failed；该臂写于修复之后，以变异证其可红）；`bun test src/main/process-fence-wiring.test.ts` **17/0**（新增：经真实 `planProductionFence`，携带的目录不在真源也进 profile，换成软链的被排除，planned `candidates=4, excluded=1`，本代 W1 交回 `noteGeneration`；把 `server.ts:297` 的转交置空即红）；相关面 21 文件 **220/0**；index.ts 文本锚 13 文件 19 条 ANCHOR 全过；typecheck 0。
- 变异（r9-probe/mutate3.py，各自还原）：丢掉携带集合 ⇒ engine 携带臂（N+1 出现签发）与 IPC 下一代臂红；包含判定不看携带 ⇒ IPC 下一代臂红（engine 臂由 planner 携带兜住，不红）；planner 不收携带 ⇒ engine 携带臂与诚实重载臂红；缺失条目照旧排除 ⇒ identity 缺失臂红；缓存不合格结果 ⇒ identity 缺失臂红。
- 计数 / 登记：engine 宿主 13→14、identity 6→7、IPC 15→16、wiring 16→17；gate-files.tsv 四行同步。超出原许可清单的文件：`index.ts`（两处 spawn 传 `fenceRun`，planner 拿到运行内历史的唯一入口）、`process-fence-plan.ts`（planner 入参）、`native/codepuppy-fence/test/project-writable-engine.fixture.ts`（自检目录），均为同一调用链所必需。
- 签名宿主（本轮一次，R3 修正之后）：`CODEPUPPY_TEST_SIGNED_FENCE=1 bun test --max-concurrency 2 src/main/process-fence-extension-packaged.test.ts`，本地构建签名、`--publish never`、关闭公证：host **1/0**、inner **3/0**、exit 0、**707 s**（review/r11-signed.log；results/signed-fence-QXiklQ-*）。G0 与窗口均 passed（窗口 main 现传 `fenceRun`、W1 并入携带集合）：M1/R1–R5、Data 拼写 HOME 一句、原生 / 超时两种 grant-failed、AC-08 软链恢复选中前 0 文件、选中后同 engine **8037** / renderer **8072**、loads **5→5** 落盘。临时树与 app 副本已清理，无残留进程。

### r11：确认 R4 修正（同代可能已消费的令牌、设计措辞、W1 单一来源）

- 核对：IMPLEMENT · 编排者 R4 receipt（独立确认 5a0dea2b1f..9602411a59：R3 的 Major / Minor 已关闭；FIX-THEN-MERGE，1 个小 Major + 1 个文档精度 Minor 全部接受，外加一项加固）。不接受项照录：经软链别名打开、别名指向的外置卷整个会话都没挂载的项目，可能从真源掉出。
- 同代可能已消费（Major）：`server.ts:620` 每代一个 `possiblyConsumed`；令牌已送出却没有确定回答（回复超时、子进程退出、投递异常、任何不是 `consume errno=N` 的回复）即记入（`:667`），并计入 `generationWrites`（`:632`），本代对它永不再签发。确定失败保留同代重试：`consume errno=N`，以及根本没产生令牌的原生失败（`token === null`、签发抛出）和签发后断言丢弃的令牌。
- W1 单一来源（加固）：每代交给运行内历史的 W1 取自计划对象自己的 `workspaces`（`server.ts:820`），不再从解析出的规则取；传了 `fenceRun` 而计划不带该清单 ⇒ fork 前拒绝（`:551`）。`planFence` 的返回类型加可选 `workspaces`；只有传 `fenceRun` 的替身（引擎、IPC、签名窗口）补该清单，其余 30 余处桩不动。解析器随之去掉 r10 加的行 id（不再有使用方），往返单测恢复为无 id 的期望。
- 设计措辞（Minor）：design.md「不导出 release」与 §5「不收回」两处改为「本次应用运行的任何一代都不收回（运行内可写历史随换代并入 W1）」；R-f 补上攻击者所得（令牌落在软链目标、不经任何校验，可为主目录；签发后断言只迫使「换过去再换回来」）以及「同一次运行内由携带消除」须与本项一起成立；§10 第 9 条补入同代可能已消费的令牌。事实文档同步。
- 证据（cwd packages/ui-mac）：红提交 `3a26ffdd5e`（9602411a59 生产代码）——IPC inner 16/1：回复超时（5 s）后引擎迟到消费，同代再次判定时签发第 **2** 次（review/r12-ipc-red.log）。修复后 `bun test src/main/project-writable-ipc.test.ts` inner **17/0**：超时那次答 grant-failed 那一句，迟到消费后再判定 issued 仍为 **1**、答 writable / granted；改写后的「确定失败可重试；投递异常 / 子进程退出不再签发、不记成功」臂通过（这条旧臂原把投递异常当可重试，按本裁定改写）。变异：`generationWrites` 去掉 `possiblyConsumed` ⇒ 上述两臂红。单测 + wiring + 写入点 + registry 8 文件 **126/0**；identity **7/0**；engine **14/0**；其余相关 14 文件（含 server.test.ts、sidecar-stop.test.ts 的 planFence 桩）**132/0**；typecheck 0。
- IPC 桩同步：自动 `failed` 回复补上真实 sidecar 的 `consume errno=1`（此前无 detail，会被判为不确定）。
- 计数 / 登记：IPC 宿主 16→17；gate-files.tsv 一行同步。
- 签名宿主（本轮一次，R4 修正之后）：`CODEPUPPY_TEST_SIGNED_FENCE=1 bun test --max-concurrency 2 src/main/process-fence-extension-packaged.test.ts`，本地构建签名、`--publish never`、关闭公证：host **1/0**、inner **3/0**、exit 0、**704 s**（review/r12-signed.log；results/signed-fence-XNZiwp-*）。G0 与窗口均 passed（窗口 planFence 现带计划自己的 `workspaces`）：M1/R1–R5、Data 拼写 HOME 一句、原生 / 超时两种 grant-failed（超时那次按本轮语义记为本代可能已消费）、AC-08 软链恢复选中前 0 文件、选中后同 engine **64174** / renderer **64211**、loads **5→5** 落盘。临时树与 app 副本已清理，无残留进程。

## #1759：位置权威与固定位置身份真源（首片）

- 依据：[SPEC-child-process-write-fence v5 / AC-09 至 AC-12](spec.md)（`834e269da977f6b4888c3b7a6a268bfe835d9cf5`）；[冻结设计](design.md)（`d4a849e5247e7a149457a1b03bbcfc70bbbb389f`，#1771）的 v4 §4.1–4.3.1、§5、§6、§10 R1 处置，以及 v5 §4、§6、§10 R1 处置；本片实现 R1/R3/R7，消费其余冻结结论。读码基线同该提交；[任务 #1759](https://github.com/impharaon/alpha%2Dcode/issues/1759)。
- 核对：Phase: IMPLEMENT — fa7f682c65 · Claude Opus 5.5 (orchestrator) · plan accepted for slice one (R1/R3/R7 location authority and identity truth): each named case can fail at the real entry (pure resolver tables, real-disk R7 binding incl. symlink re-point, real `sandbox-exec` deny-write of the truth file with an unfenced control arm); files stay in process-fence-profile/plan/workspaces and their existing test files; no frozen decision restated; slices 2–5 named with their AC ownership.

文档影响为 architecture/decision，唯一落点为本节。本次 PLAN 只追加本节并提交；下文是实施安排，尚无产品验收结论。前面的历史切片与证据保持原文。

**全部交付切片。** 下表只分配范围、先后与验据，后续切片各自在实施前追加自己的计划节。本片交付可调用的位置权威及身份规划端口；生产启动链在后续切片消费它们。#1760 在本票位置/环境生产接线完成后集成，不在本票实现 launcher。

| 顺序 / 切片名 | 覆盖与依赖 |
| --- | --- |
| 1. 位置权威与固定位置身份真源（本节） | R1/R3/R7；AC-09/11/12 的共同基础。交付候选清单、环境投影及真实文件系统的首次目标绑定。 |
| 2. 包管理器缓存与受围栏环境探针 | 消费首片，接 R2/R8、Cargo 读取桥及生产启动/派生环境；完成 AC-09 与 v4 U1/U2 的真实工具证据。 |
| 3. 本人批准项目外目录 | 消费首片及可信根，接 R4/R5/R6、原审批卡与 tracker；完成 AC-10。 |
| 4. 全局安装与用户级配置 | 消费前述位置、环境和只读 scope 接缝；完成 AC-11 非 brew、AC-12。启用全局 bin allow 的同一提交先接 v5 H1 安装身份/HB 拒写，保持其与后续 brew 执行的依赖顺序。 |
| 5. Homebrew 由应用在围栏外执行 | 消费 H1 身份和普通工具环境，完成 H1 源码规划及 H2–H4、AC-11 brew；保留原 Shell/Job/审批/取消。 |

### 改动

路径 `main/` 均相对于 `packages/ui-mac/src/`。首片的生产调用边界止于 R1/R3/R7；新清单的运行期启用随切片 2/4 接线提交，避免尚未有 R8 或 HB 时扩大生产写集合。

| 文件 | 改什么 |
| --- | --- |
| `main/process-fence-profile.ts` | 在现有清单权威内实现冻结的 `resolvePackageManagerLocations`、`userConfigurationLocations` 及其导出类型；保留 `ProcessFenceWriteRule` / `ConfigFenceRule` 的所有者。缓存与安装规则、版本管理器模板和精确用户文件均从这里产出。现有 profile 渲染、W 行和 `processFenceRulesCover` 本片不改。 |
| `main/process-fence-plan.ts` | 实现冻结的 `planWritableLocations`，通过现有 `WorkspaceDirectoryInput` 与 `checkWorkspaceDirectory` 核验具体候选并返回绑定结果/排除项；复用 planner 的路径、父级准备和失败处理边界。本片不在 `planProcessFence` 自动消费新 allow；C 的可信应用锚、具体 regex 根枚举及 probe/fork 先后在切片 2/4 的真实调用处接入。 |
| `main/process-fence-workspaces.ts` | 在既有 main 真源所有者内增加 R7 独立文件的路径、严格读和原子写支持，复用现有临时文件+rename 写法；保持 workspace 文件 schema、登记来源和 tracker 行为。 |
| `main/process-fence-profile.test.ts` | 在原文件增加位置解析/用户配置用例；覆盖工具和 purpose、固定环境键、精确文件及伴随名、pnpm 一级 shim/`.tools`、版本管理器模板与路径转义。继续用既有 profile 断言确认首片未激活新 allow。 |
| `main/process-fence-plan.test.ts` | 增 R7 真文件系统用例：首次规划/再次规划、合法软链、缺失文件、原子替换、重指及受保护目标；用生产 profile 和真 `sandbox-exec` 校验新真源在 CF-1 下仍不可写。 |
| `main/process-fence-workspaces.test.ts` | 增独立真源的读写/原子失败证据，保留旧 workspace 往返、登记及运行内历史断言；检查新写者不进入 sidecar import 闭包。 |
| 本文件本节 | 首个 IMPLEMENT 提交填核对行；任何实际偏离在对应提交更新本节。 |

首片不新增依赖、配置选项、IPC 或原生接口，不改 gate。若实际导入闭包变化要求同步写入点登记，仅同步命中的签名及既有闭包判据，并在本节说明文件和原因；不能用 `main-only` 掩盖可由 sidecar 调用的写者。

### 顺序

1. **R1/R3 位置权威，独立提交单元。** 在现有 profile 测试添加名为 `package manager locations`、`user configuration locations` 的表驱动用例，按被冻结清单的实际边界断言后实现。逐 case 迭代，结束跑该测试文件一次。输入是纯路径与平台合同；这里不执行包管理器、不预建真实用户目录，不把测试做成另一份路径解析实现。
2. **R7 身份真源与 planner，独立提交单元。** 在 workspaces/plan 现有文件添加 `writable location truth`、`planWritableLocations` 用例，实现独立 schema 读写与规划，再连两者。真实临时盘上验证：首次合法软链可以绑定；再次规划仍指原目标；改指 HOME、状态根、受保护位置或另一个普通目标均不会采信新目标；缺失目录只在核验过的父级下准备，缺失文件只规划不创建；文件原子替换仍可用。坏 JSON、读失败、写/rename 失败保持失败结果，不覆盖已有真源，不从当前磁盘重建首次身份。若发现既有缺陷，按 red-first 单独提交失败回归再修复。
3. **真实拒写与首片收口。** 在 `process-fence-plan.test.ts` 添加 `writable location truth stays fenced`：调用本片 R7 落出真源，再以生产 `planProcessFence` 生成并试编译策略，用 `/usr/bin/sandbox-exec` 派生无窗口进程尝试覆盖/改名真源；围栏外重读确认未变。相同命令的无围栏对照确实改得动，项目内 marker 正常落盘。结束跑 plan/workspaces 两个变动文件各一次；一次性跑下面的较宽相关集合、包检查、文档契约及旧名扫描，提交后交编排者。

### 风险

- **把候选误当授权。** 首片只提供 R1/R3 候选与 R7 绑定端口。后续调用者在同一 planner 接 C 锚校验、具体版本目录和 alias 节点，再交 profile；不能跳过 R7，也不能把 regex 直接对新 realpath 展开。生产启用点与其 R8/HB 依赖同片提交。
- **文件与目录身份混用。** R7 的 file 分支必须保留合法 HOME 下 literal 文件能力；目录复用既有排除，不能为 `.zshrc` 授予 HOME，也不能把正常原子替换误判为重指。通过实际 symlink/rename/stat 的盘上事实判定。
- **夹具被既有 W11/W12 意外放行。** OS 用例的 canonical 隔离树放包内 `node_modules/.cache`，与模拟 HOME、工作区、userData、状态根分别隔离；先实写校准拒绝，不能拿 `/tmp` 下的成功当围栏证据。
- **候选清单的证明边界。** 纯 resolver 绿不代表工具安装成功。Cargo config/credentials/provider 与相对路径、现代 Yarn、pnpm 钉版、npm 三条警告、版本管理器的真实布局沿 v4 §10 留给指定后续切片；不另开调查或重审冻结裁决。
- Windows 在本次 brief 的排除范围；不新增 Windows 围栏或声称 Windows 实机通过。正式签名产物的 R8/brew 证明仍归后续验收安排，本 PLAN 及首片不启动应用、Electron、窗口或系统对话框。

### 证明

**首片直接证据。** 这里只验可复用端口和真源保护，不把共同基础标成 AC 全部完成；最终行为证据分配在下一表。

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-09（位置基础） | `process-fence-profile.test.ts -t "package manager locations"`；R1 的八种工具、固定 env 与 cache/global 区分。 | 去掉任一工具所需键、将缓存指回 HOME、把全局安装重定向为缓存或放开 pnpm store，会违反具体落点/边界断言。工具真正读取这些键另由切片 2 的 scenario 证明。 |
| AC-11（非 brew 清单基础） | 同文件 `package manager locations`；安装子树、pnpm shim 一级边界/`.tools`、版本模板和 cache 排除；`process-fence-plan.test.ts -t "planWritableLocations"` 的具体安装根真实盘用例。 | 少一个安装位置会漏规则；把 prefix/HOME 整根加入会命中反例；重指后的新目标被接受会使返回集合与持久真源断言失败。brew 的 H1–H4 不在本片实现。 |
| AC-12（文件清单基础） | `process-fence-profile.test.ts -t "user configuration locations"`；`process-fence-plan.test.ts -t "planWritableLocations"` 的 literal、Git `.lock`、软链文件及原子替换。 | 少锁文件、误给父目录写权限、把引擎配置加入普通清单、重指后放行新目标，或把原子替换误拒，都会使对应正反断言失败。 |
| AC-09/11/12（身份基础） | `process-fence-workspaces.test.ts -t "writable location truth"`；`process-fence-plan.test.ts -t "writable location truth stays fenced"`，真实生产 planner/profile + `sandbox-exec` + 围栏外读盘。 | 缺首次绑定/严格读/原子写会采信新目标或损坏旧记录；真源被置于可写根时覆盖/改名会成功；无围栏对照不成功则判官无效。 |

**全票验据归属（仅命名，后续切片细化）。** 各 AC 的最终场景必须包含生产 `spawnLocalServer → planProcessFence → sidecar.start/applyProcessFence` 的最终环境及真实引擎入口；现有 Bun 嵌入式 harness 的 transport 替身证据与签名 utilityProcess 证据分别报告。最低层测试先抓接线回归，真工具安装/对照按本 brief 只跑一次，留命令、版本、来源与落盘输出，不在每一步重复，也不增加 PR 全量测试。

| AC / 切片 | 最便宜的持续检查及真实入口验据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-09 / 2 | 现有 `sidecar-env.test.ts`、`shell-env.fast.test.ts`、`shell-env-cache.test.ts`、`process-fence-wiring.test.ts` 的环境/启动检查；`process-fence-engine` 模块的新增 scenario 层用例 `package manager cache isolation`：bun/pnpm/Yarn/npm/venv pip/uv/cargo/go 各一次真实安装，覆盖助手 shell 与 PTY，核对项目产物、应用缓存及 HOME 缓存前后清单/摘要。 | 撤 env 的 bun/go/cargo 同命令失败；恢复旧缓存 allow 或漏最终 spawn 环境会改 HOME 缓存/使安装失败；R8 撤围栏/撤根固定分别暴露 rc 越界写/根漂移。 |
| AC-10 / 3 | 现有 `project-writable-ipc.test.ts` 与审批卡/receipt 测试检查顺序和身份；`project-writable.engine.scenario.test.ts` 新 `approved external directory`，原挂起工具及已有/新子进程真写，同引擎 PID；拒绝、非本人和无 grant 对照。 | 去 pre-reply grant 后原请求失败；伪造、普通 reply、重放、深链或 sidecar 消息能登记时反例落盘；显示后换目标须 conflict，合法未变软链仍可成功。 |
| AC-11 / 4、5 | 同一包管理器 scenario 层的 `global package installations` 和 `delegated homebrew execution`：清单工具各一次全局安装/命令可调用，三档与拒绝；brew 用来源可追溯、确实触发内部 Sandbox 的真实 formula，隔离 HOME/prefix；另以低层 H1–H4 测试钉身份、单节点一次、叶能力、输出和取消。 | 去固定清单则非 brew 安装失败；撤 brew 分流则嵌套围栏失败；拒绝/只读/伪造 lease 必须 0 main spawn。普通非 brew 叶仍围栏内，HB 拒写负例与普通 npm bin 安装正例同时成立；表外 HOME 写仍失败。 |
| AC-12 / 4 | 现有 policy/receipt 检查档位与按文件 scope；`engine-config-fence.engine.scenario.test.ts` 新 `ordinary user configuration`：真实 `git config --global` 与改文件工具编辑模拟 HOME 的 shell 文件，三档/拒绝、CF/C1 与两处 shell 缓存反例。 | 撤用户文件清单（Git 单撤 `.lock` 另对照）会失败；误按父目录查询会问 HOME/无法编辑；跳过审批则拒绝臂文件变化；保护顺序错则 Code Puppy/引擎配置被改。 |

夹具来源：本片只消费自有路径合同与实际创建/采集的文件系统对象。后续工具语料沿设计 v4 P07/P10/P11、v5 §6 的来源要求，从真实 CLI/registry 发布归档、真实 Cargo/Go 项目与真实 Homebrew formula 采集，记录版本/摘要；不手写另一系统格式，不使用开发机真实配置、凭据或全局安装位置。rc 事后覆盖与 brew 崩溃残留按冻结 §10 诚实报告；子命令收窄提议 I-47 不变成过滤要求。

**首片检查命令。** 均从 `packages/ui-mac` 执行；迭代只用上述 `-t` 名称，步骤末只跑变动行为的文件；下列相关集合在首片返回前各跑一次。本 PLAN 不运行这些实施检查。

- 步骤 1：`bun test src/main/process-fence-profile.test.ts`。
- 步骤 2/3：`bun test src/main/process-fence-plan.test.ts src/main/process-fence-workspaces.test.ts`。
- 较宽相关集合：`bun test src/main/process-fence-write-sites.test.ts src/main/process-fence-wiring.test.ts src/main/process-fence-credential-stores.test.ts`；返回前用 `rg` 找上述三个生产模块的新增导出 mocks 与规则枚举者，只有确实受改动影响的测试才补跑并列出。真实工具 scenario 留所属切片一次验据，不随本组运行；首片不变动生产 profile，编译容量用例留到实际启用规则的切片。
- 包检查：`bun typecheck`；提交前 `bun test src/main/old-name-scan.test.ts`。存在机器 gate 时并发上限 2；不运行全包 suite、`bin/check` 或 `gate run`。
- 文档：使用 Alpha profile 对本 worktree 运行只读 `check-docs-contract --changed-since origin/alpha`，与输入基线比较；`git diff --check` 并人工检查仅追加本节。保持 frontmatter/index 既有值，故本次不产生索引改动。

### 偏离记录

暂无。

## #1759：包管理器缓存与受围栏环境探针（切片二）

- 依据：[spec v5 / BR-07、AC-09](spec.md)（`834e269da977f6b4888c3b7a6a268bfe835d9cf5`）；[冻结设计](design.md)（`d4a849e5247e7a149457a1b03bbcfc70bbbb389f`）v4 §4.1 R1/R2 与 Cargo 读取桥、§4.3.1 R7、§4.4.1 R8、§5、§6、§10 的 U1/U2 及 R1-F6/F7/P0 处置；v5 既定边界继续有效。首片 `a82428f6fb`、`31c0127e07`、`66ce5df7dc` 已由编排者 Claude Opus 5.5 接受，本片直接消费其 resolver、身份真源和七个坏臂收据。读码基线为 `66ce5df7dc`。
- 核对：Phase: IMPLEMENT — 5e41c6653d · Claude Opus 5.5 (orchestrator) · slice-two plan accepted: cache planning through the slice-one anchors/R7, fenced environment probe with root-drift checks, one spawn-environment projection consumed by Shell/PTY/MCP, the one-time real-tool scenario for eight package managers plus the Cargo bridge and npm load-failure case, and the protection regression; each has a failure reason.

本节为 architecture/decision 类实施计划，本次 PLAN 只追加本节。切片三至五的名称、顺序与 AC 归属沿首片总表；本片接通缓存及启动/派生环境，目录审批、全局安装与用户配置清单的启用仍归各自切片。下述命令和证明均未在本 PLAN 执行。

### 改动

`main/`、`shared/` 相对于 `packages/ui-mac/src/`；`engine/`、`scripts/`、`test-fixtures/` 相对于 `packages/ui-mac/`。

| 文件 | 改什么 |
| --- | --- |
| `main/process-fence-plan.ts`、`main/process-fence-workspaces.ts` | planner 消费首片 R1/R7 的 cache 候选，校验 C 与每个缓存目标仍在可信应用数据锚内，预建/记录后才返回同一份位置及环境给 probe/fork；真源路径继续由既有 owner 提供。Cargo 读取桥的 main 写者落在 planner 内，按原文件是否存在准备 config/config.toml、credentials/credentials.toml 链接，不读取/复制其内容。本片不扩展 R7 的冻结签名。 |
| `main/process-fence-profile.ts` | 最终接线完成的提交撤 W7/W17/W18 的实际 allow 与现用 ID，保留历史编号说明；其余写规则、X1、CF/C1 的顺序保持。缓存继续落于 W3，安装与普通用户配置候选本片不进入生产 allow。 |
| `main/server.ts`、`main/index.ts` | 实现 R8 `prepareShellProbeFence` 和可信根快照；安排 canonical 环境初始化、既有必须同步的 DB/钥匙串步骤、工作区真源准备在探针依赖之前，再取得真实代理端口并规划 probe。`preferAppEnv` 的缓存/同步/异步三种合并都消费同一根快照；`currentConfigFenceRoots`、bootstrap、planner、fork 复用它。替换旧 uv 单点赋值，白名单之后注入 R1 环境。 |
| `main/shell-env.ts`、`main/shell-env-cache.ts` | 两类探针接冻结 context，在执行第一条 rc 前装同一已试编译策略；缓存命中后的后台刷新走同路。复用已有模式、超时和缓存语义，根合并只改 R8 点名的边界；PATH/代理等非根值仍按既有合并规则消费。 |
| `main/sidecar-env.ts`、`main/sidecar.ts`、`main/env.d.ts` | R2 的本代缓存投影随既有 start 消息进入 sidecar，再交嵌入式引擎内部启动接缝；类型与两端解析同提交。父环境仍使用 R1 完整默认值，最终 spawn 的覆盖集合从 R1 的 cache 规则与 env 对应关系导出，避免第二份键名单；不开放整组工具环境前缀。 |
| `shared/package-manager-environment.ts`（新增） | R2 的纯数据校验/合成及引擎内本代投影持有者；只接主进程交来的 cache 子集，无路径模板、秘密或登记/签发能力。供窄适配共同消费，保持 main/profile 的位置权威。 |
| `engine/package-manager-spawner.ts`、`engine/package-manager-pty.ts`、`engine/package-manager-npm-config.ts`（新增）；`engine/engine-embed.ts`、`scripts/build-engine.ts` | 复用当前桌面 Node 构建的精确模块解析入口，把 R2 接在上游 CrossSpawnSpawner、`#pty` 与 NpmConfig 的薄适配处；调用原实现，保留 stdin/stream/退出、管道、`extendEnv`/删除键、进程组和 PTY 行为。引擎启动先接收本代投影。NpmConfig 适配只在 load 失败所得结果缺 cache 时补同一投影，保留正常配置优先级。适配模块以相对入口调用原模块，避免解析回自身；共享/上游公共签名不变。 |
| `main/process-fence-{profile,plan,workspaces}.test.ts`、`main/sidecar-env.test.ts`、`main/shell-env.fast.test.ts`、`main/shell-env-cache.test.ts`、`main/server.test.ts`、`main/process-fence-wiring.test.ts` | 在模块既有文件补位置接线、锚/重指、Cargo 桥、context 与可信根合并用例，替换明确编码旧 uv 路径或旧 HOME 缓存 allow 的断言。fast 文件只放纯逻辑。 |
| `shared/package-manager-environment.test.ts`（新增）、`main/package-manager-environment.test.ts`（新增）、`main/shell-env.test.ts`（新增） | 新模块的 fast/集成层：纯合成与校验；最终真实子进程/PTY 环境与 Node 构建适配；同步/异步探针的生产 planner + 真 sandbox-exec。新文件按模块命名，各只承担原文件没有的模块/层，不按票或 AC 命名。 |
| `main/sidecar-engine-host.cases.ts` 及其现有宿主；`main/keychain-boot-order.test.ts`、`main/naming-migration-wiring.test.ts` | 补真实 embed 交接与旧宿主的新输入；启动顺序检查保住既有同步步骤先于新增异步边界。`index.ts` 既有 Bun 链接限制沿 constraints 中的证据边界，顺序源码检查不冒充整机启动验收。 |
| `main/custom-provider-truth.test.ts`、`main/mcp-server-truth.test.ts`、`main/egress-grant-truth.test.ts`、`main/process-fence-write-sites.test.ts` | 机械同步撤掉的 W 行/ID 枚举与由此改变的确切规则数，保持正反判据；不能保留旧 allow 让旧断言通过，也不能把计数改为空泛下限。 |
| `test-fixtures/process-fence/engine-embed-driver.ts`、`engine-fence-preload.ts`、`engine-parent-port-preload.ts`；`main/process-fence-engine` 模块的 scenario 层宿主/用例（新增层按模块命名） | 复用既有隔离主机与真实引擎路径，补本代投影/生产构建适配接线及轻量持续场景；真实包管理器完整安装矩阵作为下述一次性 scenario 证据，不加入每步或 PR 常跑集合。 |
| 仓库根 `scripts/process-fence-write-sites.tsv`、`scripts/gate-files.tsv`、`main/process-fence-write-sites.ts`；本文件本节 | 只同步实际新增/改变且确在扫描闭包中的写入签名，以及实际宿主的条数/文件登记；main-only 写者保留闭包判据，不为未登记通路开豁免，不改门的选择/层级/判定逻辑。首个实现提交填核对行，实际偏离随对应提交记录。 |

**已核实的接线事实。** `core/src/shell.ts:284-313` 在 hook/prepare 后交 Environment spawner；`core/src/mcp/stdio.ts:108-120` 用同一 spawner 合并配置环境；`core/src/pty.ts:171-184` 在 `input.env` 合并后调用 `#pty`。桌面 `scripts/build-engine.ts:49-66` 已有窄解析适配入口，原模块的 provider/PTY 接口可复用。`util/src/npm-config.ts:33` 失败给空配置，而本机 Arborist 9.4.0 `lib/arborist/index.js:104` 的默认 cache 是 HOME 下 `.npm/_cacache`，故需同调用链的缺 cache 对照与薄适配。以上只是本次文件选择的读码依据，不修改这些上游文件或其契约；不在本票恢复/另建 LSP 服务，LSP 沿已接受的创建原语证据边界。

### 顺序

1. **缓存规划、C 锚与 Cargo 桥。** 在 plan/workspaces 既有测试先加定向用例，再实现 main 的准备与返回值；本步先交付可调用规划结果，最终生产注入及撤旧 allow 在步骤 3 一起落地。覆盖 C、缓存子目录首次/再次规划、指到锚外或 HOME 的软链、坏/写失败真源；Cargo 四种原文件组合、链接读取与原文件未变。步骤末跑实际变动的 profile/plan/workspaces 文件一次；发现既有缺陷时按 red-first 单独提交回归再修复。
2. **R8 启动依赖与两类探针。** 接可信快照、`prepareShellProbeFence`、同步/缓存命中刷新路径及所有根合并出口；生产 context 来自同一 planner/真代理。DB/钥匙串等既有必须同步的步骤不跨新增的 await。以隔离 rc 真实写盘和 export 作证，保持 PATH 可发现工具；加入撤探针围栏、撤根固定两个坏臂。步骤末只跑本步变动的 probe/cache/server/启动顺序文件，不启动窗口。
3. **R2 最终派生接线与缓存启用。** 引擎内接收主进程投影，精确构建适配调用原 spawner/PTY/NpmConfig；先用自有小进程真实回报最终 env，再从助手 Shell、PTY、MCP 到同一入口。覆盖调用方缓存覆盖、`extendEnv`/删除键和非缓存值；验证无 npm 配置的缺 cache 回落不碰 HOME。接 server fork/env 与 profile 撤 W7/W17/W18，同步旧行为断言及枚举，保留 W8/CF/C1。步骤末跑变动行为的文件及 host 对应子用例，不重复步骤 2 未变的整组。
4. **一次真实安装与返回。** 在独立 scenario 进程跑下表真实工具矩阵与已知坏臂一次，保存命令/版本/来源/摘要/退出/落盘结果；永久套件只保留容易回归的最小接线场景。运行一次较宽相关集合、涉及包的类型检查、旧名/文档检查与 diff 检查；本节记录实际偏离及一次性证据位置后提交。只交切片二，不开始切片三。

### 风险

- **启动环与异步顺序。** probe 不能依赖其自身输出才能建围栏；在源码中核对初始化、工作区真源和同步迁移步骤的位置，并用可独立调用的生产协调函数测缺代理/坏真源/编译失败时零未围栏探针。`index.ts` 不可执行的旧限制如实报告，不顺带修复。
- **默认值、显式覆盖与 rc 是不同入口。** 最终 spawn 覆盖只消费 R1 的 cache 子集，不能清掉 PATH、代理、registry/凭据或自行接管用户安装位置。PTY rc 执行后的再次 export 按冻结 R1-F6 单独记录实际结果，不改 rc、不把这一残留报成已覆盖；pnpm `.tools` 钉版及版本管理器全局安装仍归切片四。
- **C 原本在 W3 下，读取桥也在那里。** C 与每个实际缓存目标都要先核可信锚再过 R7；重指不能获得锚外新目标。Cargo 链只指向模拟/真实用户原位置的原文件，bridge 准备不读取值；原 credentials 不增加写 allow，CF/C1 最终优先。测试不能把“symlink 可读”当成 Cargo 配置/认证已成功。
- **构建与源码 harness 有差异。** 窄适配必须由当前生产构建产物真正消费，直接跑原 upstream 源码的绿不能证明 R2。按 Node/native ABI 选择隔离运行时，必要时在 scratch 准备官方 Node 工具链；不借 Electron 或源码字符串替换证明。正式签名进程树的 R8 证据仍需可执行该形态的验收环境；本机禁启动 Electron 的约束继续有效，返回时单列未证部分，不将 headless 证据冒充签名产物。
- **下载与文件系统判官。** 本次 PATH 未找到 Go/Cargo/rustup/Yarn。实施从官方发行物在 scratch 准备工具链并核版本/摘要，所有 HOME/prefix/cache/venv/RUSTUP_HOME 都隔离；registry/网络/POSIX 失败与围栏失败分开。场景树位于 worktree 的 `node_modules/.cache`，先校准 HOME cache/逃逸目标确实不在 W11/W12/W1 中，围栏外核对内容。

### 证明

| AC / 义务 | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-09：缓存规划及 HOME 旧口关闭 | `process-fence-plan.test.ts -t "package manager cache planning"`、`process-fence-profile.test.ts -t "package manager cache rules"`：真实 C 锚/缓存重指、预建、R7、生产 profile；已有真源测试继续消费首片。 | 跳过锚/R7 会接纳锚外新目标或使用未记录路径；恢复 W7/W17/W18 时旧 HOME 缓存写入反例落盘。只改 env 而留旧口不算完成。 |
| AC-09：probe 先围栏、根不漂移 | 新 `shell-env.test.ts -t "fenced shell probes"`、既有 cache/server 用例 `trusted probe roots`：生产 planner/context，真实 `/bin/zsh` 的 `-il/-l`，同步/命中缓存的异步刷新都尝试在外部目录写 marker 并回吐恶意 XDG/OPENCODE 根；检查 PATH、bootstrap、CF-8/CF-11、data/state。 | 撤 sandbox 包装后外部 marker 出现；仅保留包装、撤根固定后同一 env 输出移动根；漏缓存/异步出口则相应臂漂移。context/代理/profile 不可用时实际探针 spawn 必须为零。 |
| AC-09：最终 spawn 消费同一投影 | `shared/package-manager-environment.test.ts`、新 `main/package-manager-environment.test.ts -t "package manager spawn environment"`、既有 sidecar host/wiring 对应 case；真实构建的 Shell、PTY、MCP 进程输出其最终 env，普通值/删除键/输出/退出仍符合原接口。 | 在任一调用方合并后漏接投影，显式缓存覆盖会回到模拟 HOME；只接 Shell 或只接父 env 会漏 PTY/MCP。拿掉构建适配后同一 case 必红；误覆盖普通键、破坏 `extendEnv` 或传输也有正例失败。 |
| AC-09 / U1：八种真实工具、bun/go/cargo 对照 | 一次性 scenario `package manager cache isolation`：生产 `spawnLocalServer → planProcessFence → sidecar.start/applyProcessFence → 助手 shell/PTY` 的最终环境与真实引擎。bun、pnpm、Yarn、npm、项目 venv pip、uv、cargo、go 各一个真实依赖安装；两入口各覆盖，逐工具记录项目产物与 HOME 旧缓存前后树/摘要、C 实际写入。Yarn Classic/现代缓存语义、Bun transpiler 缓存、npm 三条已接受警告一并记录。 | 各臂用独立冷缓存和同源输入；撤注入的 bun/go/cargo 同命令必须失败。依赖未落项目、任一旧缓存新增/修改、缓存写到 C 之外或被隐藏的错误均失败；退出 0 或 config 查询不替代落盘。 |
| U2：Cargo 的真实配置/认证读取 | 同一一次性场景的 `cargo configuration bridge`：真实 Cargo/rustup shim、本地/项目配置合并与相对路径、全局配置双读、credential-provider、隔离认证 registry；核原 config/credentials 摘要、读取桥目标及项目依赖结果。元数据/归档来自真实 registry 样本，认证材料为隔离测试值，不输出。 | 撤 config/credentials 中任一所需读取桥，分别使配置、依赖解析或认证失败；只链接 config 不会通过认证臂。桥导致相对路径/双读错误也由实际构建结果检出，不能用普通 cat 成功代替。 |
| AC-09 / U2：npm 配置加载失败 | 构建适配集成用例 `npm cache after config load failure`，真实 Npm 服务/Arborist 与隔离项目；仅用失败样本触发现有 load 失败结果，检查 cache 与实际依赖。 | 去缺 cache 的投影后，当前 Arborist 默认写模拟 HOME `.npm/_cacache`，围栏拒绝或 HOME 对照变更；通过保留 W7 让它安装成功同样判红。正常 npmrc/registry 优先级的正例不变。 |
| 保护回归 | 既有 `process-fence-config-fence`、credential-store、zsh-startup 的相关用例；先用较便宜的规则/接线测试，真实保护矩阵只在本片最终接线后跑一次。 | 新 cache/bridge allow 若盖过 CF/C1 或恢复两处 shell 缓存，会使受保护替身被写；普通项目与缓存正例同时成功，防止“全部拒写”假绿。 |

**一次性场景执行与来源。** 工具项目由真实 `init`/`venv`/`cargo new`/`go mod init` 产生；包及 metadata 取官方 registry/发行物，保留来源和摘要，沿设计 P07/P10/P11 样本，不手写外部协议替身。使用自有生命周期脚本观测继承环境时，先由真实 CLI 生成 manifest，再只改自身脚本字段并记明差异。Cargo 认证样本从真实 sparse-index/归档及官方 credential-provider 样本取得，派生差异注明，值不入日志。

所有证明在独立隔离 HOME/prefix/cache 树进行；对照臂保持相同命令、输入、权限与围栏，仅撤被测接线，并各自冷启动/冷缓存。一次性 runner/日志留在 scratch，返回中给出完整命令、每工具退出与输出位置；不加入八工具的常跑测试矩阵。真引擎 headless/生产模块接线、transport 替身和签名 utilityProcess 的证据分开列；未运行不标通过。Windows 与 #1760 launcher 不在本轮。

**相关检查（实施时，从包目录运行）。** 迭代只用上述命名 case；步骤末跑该步变动文件全文件一次。真实工具矩阵及其坏臂只在步骤 4 一次运行。

- 主逻辑：`cd packages/ui-mac && bun test src/main/process-fence-profile.test.ts src/main/process-fence-plan.test.ts src/main/process-fence-workspaces.test.ts`，按实际变动分配到步骤末，不在每步重复整组。
- 探针/根：同包 `bun test src/main/shell-env.fast.test.ts src/main/shell-env.test.ts src/main/shell-env-cache.test.ts src/main/server.test.ts src/main/keychain-boot-order.test.ts src/main/naming-migration-wiring.test.ts`；R2：`bun test src/shared/package-manager-environment.test.ts src/main/package-manager-environment.test.ts src/main/sidecar-env.test.ts src/main/sidecar-engine-host.test.ts src/main/process-fence-wiring.test.ts`。
- 返回前一次较宽集合：同包 `bun test src/main/process-fence-write-sites.test.ts src/main/custom-provider-truth.test.ts src/main/mcp-server-truth.test.ts src/main/egress-grant-truth.test.ts src/main/process-fence-credential-stores.test.ts src/main/sidecar-env-otel.test.ts src/main/codepuppy-sidecar-wiring.test.ts`。用 `rg` 查变动导出的 mocks、旧 uv 位置、W7/W17/W18 枚举，只补跑实际受影响的现有宿主并报告；真实保护矩阵仅指定 config-fence/zsh-startup 两个宿主一次，其他 scenario 只跑本片命名场景。
- 类型/边界：`cd packages/ui-mac && bun typecheck`；精确构建当前 engine 验证适配解析；`bash scripts/north-star-guard.sh` 核对实际改动仍在自有面。源码接线检查与编译不替代真实运行。
- 收口：同包 `bun test src/main/old-name-scan.test.ts`；Alpha profile 的只读文档契约与已接受基线比较；`git diff --check`。实际写点/测试计数只作必要同步，不改 gate、不跑 `bin/check`/`gate run`/全包 suite；机器有 gate 时并发上限 2。

### 偏离记录

- **2026-11-26，BLOCKED: design — §4.1 Cargo 读取桥及 §10 U2。** 已完成步骤 1（`4897732d21`）与步骤 2（`c118ef6d73`）；步骤 3/4 在下述真实工具证据出现后停止，不宣称 AC-09 完成，也不启用新的全局/用户配置写集合。需要设计阶段修订 Cargo 读取桥对 config-relative paths 的保留契约，再由编排者续接；本轮不自行改冻结设计或用户配置。
- **可复现反证。** 官方 Cargo Book 的 [env relative 样本](https://doc.rust-lang.org/cargo/reference/config.html#env) 只把观测键改为 `BRIDGE_RELATIVE`，保留 `value = "vendor/openssl", relative = true`；真实 `cargo new` 生成项目，自有 Rust `include_str!` 读取原 HOME 下的 marker。Cargo/rustc 均为 1.100.0，rustup 工具链、HOME、缓存、target 全隔离。生产 `planPackageManagerCaches` 经 R1/R7 准备 `CARGO_HOME` 和读取链接；原 HOME 配置下 `cargo run --quiet --offline --target-dir <project>/target-resource-original` **exit 0**，生产桥下同命令（独立 target）**exit 101**：查找变为 `<C>/cargo/vendor/openssl/marker`，原应为 `<HOME>/vendor/openssl/marker`。原 config 前后 SHA-256 相同。该缺陷在未加围栏时已成立，故不是权限或网络失败；不通过增加写 allow 绕过。
- **场景记录与恢复材料。** 本地一次性记录为 `packages/ui-mac/node_modules/.cache/package-manager-scenario-vf8vnnjs/record.json`，详细反证 `cargo-relative/result.json`（含命令、输出、摘要、planner 结果旁档）；runner 为同目录 `fence1759-cargo-{relative.py,prepare.ts,confirm.py}`。Go/Rust/Yarn 官方工具来源及摘要已保存，但八工具完整安装矩阵、Cargo 双读/认证 registry、真实 Arborist 安装和最终保护矩阵均未运行；签名 utilityProcess R8 仍按禁启动 Electron 的边界未证。已完成的生产 engine/main 构建属于步骤 3 草稿，不作为 R2 已交付证据；其 tracked patch 与 7 个新文件保存在 `suspended-step-three/`（15 个 tracked 文件），已从工作树撤回，恢复依据见 manifest，不丢工作。
- **步骤 2 同调用链补齐。** 较宽导出调用搜索发现 `main/bootstrap-launch-parity.engine.cases.ts:158` 尚用旧 `preferAppEnv` 签名，实际运行先红（0 pass / 1 fail，缺 context），传入同一个 `resolveShellProbeRoots` 快照后 **1 pass / 0 fail**；该文件超初始清单的原因仅为新必填 context 的既有真实调用者同步。`scripts/gate-files.tsv` 只同步实测 profile/plan/workspaces 的 43/41/23 与新增 shell-env 的 1 条登记，不改门逻辑；写点账本检查通过，无新增闭包写点。
- **检查收据。** 步骤 1 的 profile/plan 文件 **84 pass**；步骤 2 的 shell-env.fast/shell-env/shell-env-cache/server/keychain-boot-order/naming-migration-wiring 文件 **84 pass**；最终 profile/plan/workspaces 分别 **43/41/23 pass**。一次较宽相关集合（write-sites、custom-provider-truth、mcp-server-truth、egress-grant-truth、credential-stores、sidecar-env-otel、codepuppy-sidecar-wiring）**70 pass**。`bun typecheck`、恢复已提交源码后的 engine 构建、north-star guard、`git diff --check` 均 exit 0，旧名扫描 **10 pass**；文档契约 **70 error / 252 warning** 与已接受基线 finding 相同（exit 1，既有 INT-safety 问题未改）。四个已知坏臂（撤 C 锚、漏 credentials 链接、撤 probe 围栏、撤可信根固定）各产生 1 个失败并已还原；日志随上述场景目录保存。本轮从计划接受后到阻塞确认约 30 分钟，未执行全量套件或 gate。

- **r4 续接（Cargo 阻塞已由上游解决）。** 按 brief 读取 `git show 4d9392d6d3:docs/specs/child-process-write-fence/design.md` 的 v4.1 与 SPEC v6 `7966eb280a`，不 merge/rebase；这些输入替代本节 Cargo 读取桥/全缓存必须在 C 下的旧实施与证明安排，其余不变。移除桥和重定向、按规则种类复用 R7，并在 cache 投影排除保留位置及其真实目标；原桥测试同提交替换为原文件不变、合法外置缓存链接/重指和保留位置拒绝的真实磁盘用例。`bun test src/main/process-fence-profile.test.ts src/main/process-fence-plan.test.ts` **84 pass / 0 fail**；`bun typecheck` exit 0。Cargo 原生 registry/Git、journal、相对配置/认证及 cache-only 负例在最终一次性真实入口场景完成；历史失败记录保留。
- **r4 步骤 3。** 恢复并完成 R2 草稿：同一 cacheEnv 经 start 消息入引擎，生产构建的 spawner/PTY/NpmConfig 薄适配消费它；Cargo 不在覆盖集合。R7 的 cache rules 由 planner 交 renderer（W20），撤旧 W7/W17/W18；真实 sandbox-exec 回归同时证明 Cargo/cache/project 可写、旧 HOME 缓存及 CF/C1 不可写。生产 planner 与 bootstrap 改为消费同一份有效 HOME，消除 Bun 对 os.homedir 的测试差异；既有生产接线 harness 的 userData 改为与状态根并列子目录，HOME 全隔离，不向真 Mac 的 Cargo 目录准备任何东西。`bun test` 的 shared/package-manager-environment、main/package-manager-environment、sidecar-env、sidecar-engine-host、server 五文件 **86 pass**；profile/plan 与两类环境模块四文件 **89 pass**；wiring 的 main 分组 **11 pass**（Office 四个重场景未运行，只机械更新旧 UV 路径/预建断言，留 nightly）。生产 engine/main 构建 exit 0；本轮一次性 runner 通过真实 spawnLocalServer → 生产计划 → 生产 sidecar/apply → 生产引擎的 Shell/PTY/MCP 最终环境三入口，含 Shell hook/PTY/MCP 的缓存覆盖与普通值、Cargo 显式值保留。相关记录在原场景目录的 `r4/entry-report.json`；它是无窗口 Node/IPC transport 形态，不冒充签名 utilityProcess。
- **同调用链文件补充。** `test-component/codepuppy-engine.ts`、`test-fixtures/net-failure/engine-driver.ts` 为新的引擎启动必填投影提供空测试上下文，和已列 fixture 同因；`main/process-fence-engine.test.ts` 只删除旧 W7 预建断言。三份 truth 测试的旧最小条数替换为撤三条后的确切 13/14 条，保留逐条位置判据；W20 是 R7 输入而非无条件固定行。不改公共上游实现或 gate 逻辑。
- **r4 真实场景与当前阻塞。** 总记录仍为 `packages/ui-mac/node_modules/.cache/package-manager-scenario-vf8vnnjs/record.json`，本轮详表 `r4/summary.json`、`matrix.json`、`cargo-u2.json`、`tools.json`、`inputs.json`。真实入口为生产 `spawnLocalServer`（只替 Electron transport/系统路径来源）→ 真 `planProcessFence`/试编译 → 生产 main 构建的 sidecar/apply → 生产 Node 引擎；版本/官方来源/摘要、原始输出、每个冷 HOME/C/project 摘要均保存。命令 `bun test ./node_modules/.cache/package-manager-scenario-vf8vnnjs/r4/matrix.test.ts` 及输入修正后的 `matrix-corrections.test.ts` 均 exit 1，**不能报矩阵通过**：Bun、pnpm、Yarn Classic、npm、venv pip、uv、Cargo 的 Shell/PTY 共 14 个正臂成功，Yarn 4.9.2 Shell 再 1 个成功；Go 两入口仍失败。HOME 对账只剔除有明确写权的引擎 W4/W5 日志与库，原工具缓存字节未变；Cargo 按 v6 的六类缓存例外对账。Classic init 被 Bun user-agent 污染的 packageManager 用真实 npm CLI 修正；Yarn 现代版给出工具代理变量，Go 改用可达的 GOPROXY 镜像，校验未关闭；成功臂未重复安装。初始失败和修正均留档。
- **BLOCKED: design — R1 Go 的 sumdb 持久化位置。** Go 1.27.4，原样 `export GOPROXY=https://goproxy.cn; go get rsc.io/quote@v1.5.2 && go run .` 在两入口 exit 1：要写 `<HOME>/go/pkg/sumdb/sum.golang.org/latest`，不随 GOMODCACHE/GOCACHE 移动。官方工具链源码 `toolchains/go/src/cmd/go/internal/cfg/cfg.go:505` 定义 `SumdbDir = gopathDir("pkg/sumdb")`，`modfetch/sumdb.go:249` 的 WriteConfig 在该处持久化。只为隔离对照预建父目录并给同一生产 profile 增加此处 subpath，同命令 **exit 0**、latest 落盘（`r4/go-sumdb-control.json`，`go-sumdb.test.ts` **1 pass**）。生产 R1/profile 没加它，没关闭 checksum database，也没改 GOPATH。需设计阶段补齐满足 v6 HOME 约束的 Go 位置策略；Cargo 的 owner 例外没有擅自延伸到 Go。
- **Cargo U2 已证。** `cargo-u2.test.ts` **1 pass**（五个真实入口场景）。native 和外部 `cargo:token-from-stdout` helper 两臂 exit 0，真实 registry/Git 依赖、认证镜像、自有 CA 的相对配置路径、HOME 内外同 shell cd、相对 env/target 和配置更新均成功，rustflags 每次只合并一份；原 config/credentials 摘要在命令前后不变。数据库 **57,344 bytes / 7 tables**。撤 registry/Git 各 **101**；撤 journal 为 **exit 0 但有清理警告、0 bytes / 0 tables**，缓存判据转红。cache-only 写 config/config.toml、credentials/credentials.toml、env、bin 与任意 HOME 文件全拒绝。HTTPS registry 输入从冻结探针保留的真实 crates.io 元数据/归档派生，归档 hash 与索引一致，凭据由真实 cargo login 生成，只有隔离值，不输出。HTTP fixture 被 CONNECT-only 代理拒绝的初次尝试标为无效并保留，不计反向证据。OS Keychain/独立协议 provider、签名形态未证；全局安装权限档仍归切片四。
- **反向证据与保护。** 生产构建撤三处 R2 适配后，Shell/PTY/MCP 同一覆盖输入都回到旧值，汇总用例 **1 fail**，已恢复构建；记录 `r4/entry-report-entry-removed-adapters.json`。撤 Cargo 保留位置过滤、恢复 W7、撤 npm fallback 各使其命名用例 **1 fail**，恢复后定向 **6 pass**。Bun 1.4.4 撤注入仍 exit 0，但 C 中零缓存文件，缓存位置判据失败；如实保留，不称其安装退出失败。Go/Cargo 撤接线均 exit 1/101。保护两宿主的 zsh **1 pass**；config-fence 初次仅 E2 的旧 HOME npm 正例红，改为消费 R1 npm/uv 位置后 **1 pass**（inner **18 pass**），无断言放宽。较宽相关七文件 **70 pass**；旧引擎预建断言的命名 case **1 pass**。NpmConfig 的真实 Node 加载失败/正常优先级及 fallback 坏臂已证；额外尝试的插件入口未抵达实际 Npm 服务/Arborist，完整安装负例仍未证，不计成功。
- **必要调用者传播及范围。** 必填启动投影补到直接调用 `startEngine` 的既有 `.cases.ts`：main 下 install-from-source.engine、codepuppy-config-injection-engine、bootstrap-launch-parity.engine、sidecar-ext-ready、naming-before-v1-conversion、package-effect.engine、memory-seam.engine、package-mcp-oauth.engine、engine-v1-history-display、package-command-engine-visibility.engine、engine-session-turn、created-plugin.engine、engine-legacy-credentials、plugin-entrypoints.engine、engine-plugin-policy.engine、chat-archive-engine，及 test-component/official-connectors。超原文件清单的原因仅是同调用链新必填参数，均传空测试上下文，不改变宿主行为；sidecar-ext-ready **5 pass**、bootstrap parity **1 pass**，其余重场景未额外跑。config-fence.cases 只替换被本功能撤销的旧缓存写入正例。临时 npm init 曾误识别外层工作区，`package.json` 的误改已 scoped restore，未入提交；其后外部输入均在独立临时目录生成。无 app/Electron/窗口、真实 HOME/global install、push/PR/merge 或全量 gate；本轮约 45 分钟，停在 Go 冻结输入缺口。
- 本轮最后只同步新 Node 适配宿主的 **3** 条 gate 登记，主检查类型与选择逻辑不变；`bun typecheck` exit 0。最终旧名 **10 pass**、north-star 与 diff 检查 exit 0；文档契约仍 **70 error / 252 warning**（exit 1），与已接受基线 finding 完全相同，基线问题不修。
- **r5：v4.2 的静态接缝已准备，原生查询未启用。** 已用 `git show 6a292250bc:docs/specs/child-process-write-fence/design.md` 读取增量及最后的限定范围处置；R1 增必填 `goInstallBin: string | null`，C/go/gopath 走同一 cache/R7，非 null 的 GOBIN 随投影保留但不获得 cache allow。现有生产调用明确传 null，继续保持原运行行为，不把尚未核实的查询接上；源码/夹具只同步该必填输入。`bun test src/main/process-fence-profile.test.ts src/main/process-fence-plan.test.ts` **87 pass**；撤成对环境生成使两个命名 case **2 fail**，scoped restore 后 **2 pass**；`bun typecheck` exit 0。新增 resolver case 为 fast、R7 真盘 case 为 integration，放回既有模块文件；依赖由直接 import 可追溯，目标为 affected PR 与 nightly，不新增 scenario 常跑矩阵。
- **BLOCKED: design — v4.2 最后处置 Minor ①（6a292250bc:1125）与 Go 原生命令输出冲突。** 同一官方 Go 1.27.4，隔离 HOME/GOENV=off、原生 GOBIN 输入为空，`go env -json GOBIN GOPATH` 仍返回 `<原 GOPATH>/bin`，非空。按“查询非空不注入”重定向 GOPATH 后，同一真实 CLI 生成的无依赖项目 `go list -f '{{.Target}}' .` 从 `<原 GOPATH>/bin/binproof` 变为 `<C>/gopath/bin/binproof`；这会改变 BR-09 的安装目标。保留查询所得的原生 GOBIN 的对照仍为原目标，三次命令都 exit 0。源码 `toolchains/go/src/cmd/go/internal/envcmd/env.go:212-228` 明确在 cfg.GOBIN 为空时计算默认值，原查询不足以判断“用户已配置”。需修订 G42-R1a/Minor ①，使读取接缝能区分显式配置与计算默认值，再决定注入；其它 v4.2、Cargo 及权限决定不重开。本轮没有自行改冻结查询协议或提交会改安装目标的接线。
- **r5 证据与恢复。** 当前反证 `packages/ui-mac/node_modules/.cache/package-manager-scenario-vf8vnnjs/r5/gobin-query-contradiction.json`；runner `/tmp/fence1759-r5-go-bin-control.py`，全部命令/原生 JSON/目标路径/官方二进制摘要已保存，无安装、联网或真实用户配置读取。原生查询及启动协调草稿（含出现上述矛盾的测试）保存在同根 `suspended-native-query/`，已从工作树撤回；其测试不冒充通过。较宽相关七文件 **70 pass**；纯原生 env/list 取证为轻量读取，不运行重场景。重场景没有在未解决的接缝上重跑；原计划中的 null 后重查询、最终两入口和签名校验安装验收仍未闭合。切片三按顺序尚未开始，不追加未检查的 AC-10 实施段。
- `affected-tests --list` 已运行，exit 2：工作树缺 `.gate-tests`，无 scope 行；与 v4.2 输入收据的已知缺口相同，未算通过、未擅改 gate。新增 case 所在文件的精确计数更新为 **44/43**。旧名 **10 pass**、north-star 与 diff 检查 exit 0；文档契约 **70 error / 252 warning**（exit 1），逐 finding 与已接受基线相同。r5 检查命令、输出与反证汇总在同根 `r5/summary.json`；未启动新重场景。

- **orchestrator ruling correction 2026-11-27（r6）。** 续接 brief 修正 v4.2 Minor①：围栏内原生查询分为 `go env -json GOPATH` 与 `go env -changed -json GOBIN`；后者有 GOBIN 时保留用户配置，不注入；缺席才固定原 GOPATH 第一项/bin。R1/R7 的缓存位置不变。启动 null 的结果在下一次 Shell/PTY 合成前经同代只读 parentPort 拉取重查；成功后保留投影。实现复用 shared/package-manager-environment 与现有 spawner，PTY 的异步等待在 `engine/package-manager-pty-service.ts` 的原 create 服务外层，保留同步原生 binding；构建 resolver、`env.d.ts`、sidecar/server 为同调用链必要文件，无上游改动或新用户步骤。真实 CLI 样本落在既有 process-fence fixture 目录，只有 GOPATH/GOBIN 两个非秘密字段。Go 读取/sidecar-env/server 三文件 **83 pass**；投影与适配两文件 **6 pass**；最终场景与其它结果续记，不把局部通过算 AC-09 关闭。
- r6 查询与重试移除臂：分别撤显式配置识别、撤 null 后 refresh，两条命名用例合跑 **2 fail**，还原 **2 pass**；类型检查 exit 0。main/sidecar 的 `env.d.ts` 同步新的宿主读取回调；新 PTY adapter 仅包装已决定的 create 合成时机，不改 core/native ABI。构建与真实 Go 场景排在机器 gate slot 后，尚未据此声明通过。

## 交付切片三｜本人批准项目外目录

- 依据：#1759；spec v6 AC-10 / BR-08；冻结 design v4 §4.4 R4/R5/R6、§5/§6 与 §10 v4 R1 处置（`d4a849e524`；后续 v4.1/v4.2 不改变本片）。切片一、二提供位置/身份与实际围栏；切片四继续负责 AC-11/12，切片五负责 v5 brew。
- 核对：`ed37f9bf43` · Codex（GPT-6）· 按 r6 续接的“追加计划后直接实施”授权自核通过；未另收到编排者计划审查回执，不宣称独立审查通过。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/engine/file-access-transform.ts` 及同模块测试、`scripts/build-engine.ts` | 在既有精确构建变换入口接 R5 的真实 FileAccess 目标与读写轴；沿原函数执行，不复制服务实现或改 gate/上游文件。输入是磁盘上的真实 core 源码，锚漂移必须构建失败。 |
| `packages/ui-mac/src/main/codepuppy-sidecar-messages.ts`、`hub-view.ts`、`ext-ipc.ts`；`packages/ext/src/hub-bridge.ts`、`plugin.ts`、`policy/index.ts` 及现有测试 | 接 R6 两端 parser/build/只读 request，evaluate 消费实际目标状态；不在 ext 维护路径/档位表。 |
| `packages/ui-mac/src/shared/directory-write-approval.ts`（新增：R4 的纯 wire 类型/输入校验）；`src/main/directory-write-approval.ts` 及同模块测试（新增：主进程描述快照、本人批准协调） | 绑定请求事实、renderer、引擎代、显示时 dev/ino 与 decisionID；只读描述与批准写动作分离。复用原 tracker/register/grant 与既有身份规则。 |
| `packages/ui-mac/src/main/process-fence-plan.ts`、`process-fence-workspaces.ts`、`server.ts`、`ipc.ts`、`index.ts` 及既有测试；`src/preload/index.ts`、`types.ts` | 复用已有 plannedWritableTarget/checkWritableTarget 预览缺失目标，避免另一套资格判定；主进程核实 pending 请求，暴露 R4、投影实际 profile/grants 的 R6 revision，组合至当前代。 |
| `packages/ui-mac/src/engine-adapter/contract/receipts.ts`、`engine-adapter/index.ts`、`permission-reply.test.ts`；renderer 的 `PermissionDialog.tsx`、`permission-watcher.tsx`、renderer 的 `index.tsx` 及既有审批测试 | 在既有卡片显示真实目标，具体按钮登记 pre-reply 动作；账本先完成 current/fingerprint 校验，再 await 本人批准的 R4，成功后才沿原审批回复。拒绝、自动回复不登记动作。复用现有冲突/失败呈现。 |
| `scripts/gate-files.tsv`、本计划 | 仅同步实际测试条数与一次性证据；不改 gate 的选择或规则。 |

### 顺序

1. R5 的目标元数据与 R6 的只读投影/两端接线；先跑变更 case，再完整跑消息、hub bridge、policy 相关现有文件。新增构建变换测试在模块既有/同模块测试中消费真实源码和实际执行结果；一次生产构建验变换接线。
2. R4 主进程快照/批准协调与 IPC/tracker 接线；目录存在/缺失、合法软链/重指、HOME/状态/保护、过期/冲突、代际、拒绝与重试覆盖实际磁盘及真实 tracker。完成后跑所改模块文件全文件一次。
3. 现有卡片与 receipt pre-reply await；在当前 DOM harness 验真实路径、按钮来源、拒绝零登记、grant 失败零 allow、指纹冲突先于授权与同 decisionID 重试。跑现有 PermissionDialog/permission-reply 与真正受影响的调用宿主；不新画 UI。
4. 最终通过 `gate slot` 跑一次无窗口真实引擎/Seatbelt 场景：原写请求批准后成功，已有/后生子进程与第二次写无需重审、PID 不变；拒绝与移除 R4 均零落盘。真实 UI 点击由 DOM harness 证明、签发/消费与写盘由真实场景证明，分别标边界。再跑一次较宽相关集合、类型、old-name、north-star、docs 与 affected-tests 清单。

### 风险

- 当前 FileAccess 只有目标与可选 metadata，读写事实必须从实际调用轴进入；Shell 的工作目录批准属于可执行命令的目录能力，不能从命令文本猜文件。读工具不因此取得 OS 写权。构建变换只补冻结元数据与参数，不接管原引擎行为。
- 显示与点击间的目录替换、原请求变化、引擎换代是不同冲突；任何 mkdir/register/issue 均排在事实核验之后。缺失目录只准备准确目标；沿现有 planner 的前瞻资格规则，不放行祖先。
- OS grant 与 HTTP reply 没有事务。保留已本人批准的运行内授权，按同一 decisionID 重试；不伪造撤回。多目标中一项失败不发送 allow。
- 同一 receipt 账本也服务自动允许与普通 HTTP 调用；它们没有点击登记的 pre-reply 动作，不能签发目录授权。远端请求不签本机令牌。

### 证明

| AC | 测试/证据 | 层与运行时机 | 缺少行为为什么会失败 |
| --- | --- | --- | --- |
| AC-10 / R5、R6 | FileAccess 真实源码执行的元数据 case；既有 messages/hub-bridge/policy 测试的 `external write scope` case，含 read、已可写、表外、protected、错误/坏形状 | fast/integration；affected PR 与 nightly；直接 import 与 literal 源路径可选择 | 缺 absolute/读写轴将错误授予读请求或不能定位目标；移除只读查询会使已授权目录仍 ask、表外写绕过 ask；假消息不得变成授权。 |
| AC-10 / R4 | `directory-write-approval` 真盘 + 真实 tracker，覆盖显示后 symlink re-point/同路径换 inode、缺失目标、HOME/保护、pending/fingerprint、重试及 generation | integration；affected PR 与 nightly | 撤身份核对会给显示外目标写权；撤精确目录准备无法写缺失目标；提前登记使 conflict/expired 的目录进入 registry。 |
| AC-10 / 本人动作 | 既有 PermissionDialog 与 permission-reply DOM/账本用例：显示实际目录、点击绑定、await grant、reject/自回复/冲突/失败、幂等 | integration；affected PR 与 nightly | 撤 pre-reply await 会先发 allow；把描述或普通 reply 当批准会让无人点击/拒绝臂登记目录；grant 失败不能得到成功回执。 |
| AC-10 / 实际落盘 | 临时场景经生产 spawnLocalServer、planner、sidecar/apply、真实 tracker/R4 与引擎原请求；普通/软链/缺失目录、已有及后生 Shell/PTY 子进程、第二次写、拒绝与移除 R4 | scenario，一次性留 command/output；不加入每 PR 常跑矩阵 | 无 R4 的同次写 EPERM 且零落盘；批准后原请求成功且 PID 不变，拒绝/伪造/重放零新增授权；目录显示后换身份须 conflict。 |

### 偏离记录

- r6：步骤 1/2 的 main 组合入口合在首个实现提交，原因是同一个 SidecarListener/IPC 类型接缝及 index 的依赖组合；卡片/receipt 仍为下一提交。`server.permissionRequest` 只读原生 pending，并复用现有 v1 投影/指纹，不在翻译器做权限决定。描述还保留 main 自己算的完整快照指纹，兼容的是当前同时使用的 v1 指纹通道，并非旧版本迁移。
- 计划中的 renderer `app.tsx` 实际组合落点为 `src/renderer/index.tsx`（原 PermissionWatcher 包装处）；只传当前本机 sidecar 的 server/origin 事实，不改 app 的公共 surface。额外 `test-component/preload-stub.ts` 仅为新 R4 preload 能力作现有类型枚举分类；只读回调由 `server.ts` 的每代 parentPort 接收口交给既有 Host.receive，绑定发送方实际代际，避免全局宿主误读新一代；原调用链的无关重场景不追加运行。
- R5 原方法真实源码执行 **2 pass**；R6 消息 **15 pass**，ext bridge/identity **33 pass**；main/R4/hub/server **75 pass**（后新增精确文件投影 case 的结果续记）。主进程 R4 三条真盘聚合用例含普通/缺失/软链、重指/换 inode、拒绝位置与原生失败重试；卡片/receipt 当前 **101 pass**。类型 ui-mac/ext exit 0，写点与既有 sidecar dispatch **20 pass**。真实签名 utilityProcess/Electron 窗口禁止启动，沿前片证据边界报告；不以 Node transport 和 DOM harness 冒充产品签名/UI 全链实跑。

- R6 精确文件接线的真实 renderer 用例先 **1 fail**：既有 `processFenceRulesCover` 用于“目录是否可被改名”的签发安全判定，literal 祖先按已覆盖处理，不能直接拿来判具体文件。按工程标准 §6 给同一个权威增加 `kind: "directory" | "file"` 域参数；原调用维持 directory，R6 实际目标使用 file 的 literal/regex 精确匹配，既有 deny 优先不变。没有另造匹配器。运行内只把已确认的 grant 投影为 writable，不把在途/可能消费的令牌当成功。
- 本轮精确目标 authority 的域参数及其 source 接线完整四文件 **144 pass**；主进程 IPC 的新本人批准 case **1 pass**。撤 R4 显示身份核对使合法目录被重指后错误 granted，命名用例 **1 fail**；恢复后通过。撤 receipt 的 await，原先检查点早于错误回复的微任务，测试曾漏检；改为在 grant 仍挂起时让当前事件循环排空，移除臂 **1 fail**、恢复 **1 pass**。无耗时阈值或重复重场景。
- Go 补跑 `gate slot -- bun test ./node_modules/.cache/package-manager-scenario-vf8vnnjs/r6/go.test.ts` **1 pass / 46 expect**：unset、GOENV 文件、GOBIN 环境、GOENV=off，及两入口 null 后发现 Go 的真实下载/运行/安装均成功；两个撤 GOPATH 臂失败，原 HOME/go/pkg 仍零变化。初轮默认 Shell 正臂已成功，损坏签名被实际拒绝（`note has no verifiable signatures`）；只因临时 runner 写死另一种报错措辞而停止，保留日志并复用已完成行，未重复成功安装。补跑排队命令一度缺 `./` 而未选中任何测试，修正后才执行，不记为通过。完整结果 `r6/go-results.json`；七个其它工具与 Cargo U2 沿 r4 已接受的真实结果，不重跑。
- R4 在准备目录之前还消费本代 R6 的实际 CF/C1 结果，任何 protected 目标都先返回 protected-config；仅靠目录资格不替代精确文件保护。只读端口通过现有 Host.receive 的发送方回调传入，server 的参数类型复用该 Host 类型，撤旧镜像签名。当前无围栏结果保留原权限 gate，不把 no-fence 当作静态放行。
- 新增 R4 preload 两口只在真实应用主 frame 接受；project-writable-ipc 既有宿主增加一条真实 handler/真实 tracker 用例，描述、子 frame、拒绝形状与 sidecar 消息均零签发。该 `.cases.ts` 定向执行首次也缺 `./`，未选中测试；补全路径后 **1 pass**。测试桩的 absent 分类与 gate 表只同步事实，ext hub-bridge 的原未登记文件按本轮实测 **14** 条补登记。
- 首个实现提交收口：主进程 R4/hub/messages/server **91 pass**，ext 两文件 **33 pass**，类型 exit 0、旧名 **10 pass**。Go 原生默认 GOCACHE/GOMODCACHE 的事后查询与真实目录检查，在八臂均为 **0 文件**；隔离 HOME 初始为空，未重复包安装。首轮 AC-10 原生签发与工具写入已实际落盘，但临时 observer RPC 返回编码失败，未计完整场景通过；原日志/结果保留，修正测试自身的完成消息后续接剩余证明。
- 步骤 3 收口：`bun test src/renderer/codepuppy-ui/PermissionDialog.test.ts src/engine-adapter/permission-reply.test.ts` **102 pass / 0 fail / 754 expect**。卡片显示真实目录；描述失败可沿原错误呈现重试；只有具体点击安装 pre-reply 动作，账本先核当前请求/指纹再 await R4，失败不发 allow，拒绝不登记。原 v1 reply 通过 requestID/decision 找到当前点击闭包，decisionID 仍由该闭包交 main 核实；不改公共审批协议。该两文件是已有 affected PR 测试，新增 5 条；不把临时原生场景加入每 PR 矩阵。
- **BLOCKED: verification — AC-10 的一次性 RPC 探针返回编码。** `gate slot` 下生产 main/engine 构建成功，真实 R5 pending、只读描述、main R4/tracker 原生签发均完成，`outside/first.txt` 已为 `approved write`。临时 RPC observer 返回原 Tool.Result、完成对象、完成字符串时均 HTTP 500：`Server failed to encode its response`，引擎报 output 不是 JSON 值。后两次只修临时探针的返回值，仍未解决；按“同一修正失败两次即返回”停止，不删断言、不再定位生产 RPC 或改其协议。已有子进程、同代第二次写/PID、缺失/软链目录、原生拒绝及撤 R4 的完整对照尚未跑完，**AC-10 不记通过**。三次根目录、初始及最新结果、runner 与日志都保留于同一场景根的 `r6/`，最新 `approval-results.json`；与先前 R4 真盘/receipt 移除臂的红绿证据分开。
- 独立收口：`gate slot -- bun test src/main/project-writable-ipc.test.ts src/main/process-fence-config-fence.test.ts src/main/process-fence-zsh-startup.test.ts` **3 pass / 0 fail**（真实 sandbox-exec 宿主）。返回前一次较宽相关集合为既定七文件加 IPC census 与 receipt 的六个直接消费者，共 **121 pass / 0 fail / 14 files**；精确清单及输出在 `r6/summary.json`、`r6/logs/`。ui-mac/ext 类型检查、north-star、`git diff --check` exit 0；旧名扫描 **10 pass**。文档契约 exit 1，**70 error / 252 warning**，去行号后的 finding 与已接受基线完全相同；不改既有 INT-safety 引用。`affected-tests --list` exit 2：此基线缺 `.gate-tests`，没有 scope 行，未报选择器通过。r6 本轮约 85 分钟（含约 30 分钟 slot 等待），切片三按已完成内容提交，完整原生证明交编排者处置；无窗口/真 HOME 安装、无全量 gate、无 push/PR。
- **r7 observation ruling（编排者 Claude Opus 5.5，2026-11-27）。** 临时 RPC 只触发真实 write；工具完成/失败写入项目内 `results/*.json`，宿主读取结果及外部目标文件，沿既有签名围栏场景的观察方式。返回使用 `package-mcp-oauth.engine.cases.ts` 已有的普通数组形状，不再读取该 RPC 的编码返回，不修改生产协议。`gate slot -- bun test ./node_modules/.cache/package-manager-scenario-vf8vnnjs/r7/approval.test.ts` **1 pass / 37 expect**：普通、软链、缺失目录批准后原请求成功；批准前已有 PTY 子进程先拒写、批准后写入；同一引擎第二次写无 external_directory 请求，工具 PID/宿主 PID 均不变；缺失目录的上级仍拒写。native reject 与撤 R4 两臂工具失败、零落盘/零登记。三臂与实际文件在原场景根 `r7/approval-results.json`。r6 的 RPC 编码阻塞已按本裁决闭合，不重跑 Go/其它成功安装。

## 交付切片四｜固定全局安装位置与用户配置

- 依据：#1759；spec v6 AC-11（非 brew）、AC-12；design v4 §4.1–4.3.1、R6/R7、§10 @ `6a292250bc`；Go discriminator 沿 r6 明确修正。切片五继续负责 v5 brew。
- 核对：`1232705ba8` · Codex（GPT-6）· r7 授权同轮计划并直接实施，自核通过，不冒充独立审查。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/src/main/process-fence-profile.ts`、`process-fence-plan.ts` 及既有测试 | R1/R3 同一位置权威的全局/用户规则经 R7 后进入实际 profile；固定模板按真实根绑定；精确文件不变成父目录写权。 |
| `packages/ui-mac/src/main/homebrew-installation.ts`（新增：main 的安装身份快照）；profile/planner 的现有测试 | H1 安装识别与 HB 拒写先于全局 bin 启用；复用现有 CF 规范化/alias 节点逻辑，不执行候选 brew。 |
| `packages/ui-mac/src/main/server.ts` 及既有测试 | 生产启动/探针消费已核规则与安装环境；R6 沿实际 profile 读出同一集合，不另抄位置表。 |
| `packages/ext/src/policy/identity.test.ts`（必要时 `policy/index.ts`） | 复用切片三的文件目标 R6，核三档、固定文件无 external_directory 附加卡、保护拒绝与表外目录审批。 |
| `scripts/gate-files.tsv`、本计划 | 机械计数与证据同步；不改 gate。 |

### 顺序

1. 在 profile/planner 既有测试补安装/配置规划、具体模板绑定与重指负例，完成 R7 到实际 profile 的接线；运行这些变动文件一次并提交。
2. 接生产 server 与现有 R6 权限消费，运行 server/policy 的变动 case 与文件、类型检查；提交接线与相关旧行为断言同步。
3. 一次性真实全局安装/用户配置 scenario 经生产入口、隔离 HOME/prefix/cache，八管理器逐个装一个真实 CLI 并调用；真实 git 与改文件工具分别按档位/拒绝核内容。固定表撤除、Git 锁撤除、表外 HOME 与 CF/C1 拒写均核真实磁盘。pnpm 钉版与 npm/Yarn Classic 版本管理器 prefix 纳入本次证据。重场景经 gate slot，只补失败行，不重复成功行；记录来源/摘要。最后较宽相关集合、类型、旧名、north-star、docs/affected-tests 与 diff 收口。

### 风险

- 真实系统 prefix 不用于本机安装；临时宿主拒绝准备 Mac 的系统安装目录，等同无该目录写权限，实际全局命令只选隔离 HOME 的固定族。记录此覆盖边界，不伪称系统 prefix 实装。
- 模板中的版本目录先枚举/绑定，再展开后缀；不放行版本管理器整根或自动跟随新目标。用户文件只准备父级，保持文件级 allow 与保护优先。
- 全局位置可写不等于权限档 allow；保留原工具/命令卡片，R6 只取消多余 external_directory 卡。安装失败需区分权限、CLI 配置与网络，退出 0 必须伴随 CLI 实际调用。

### 证明

| AC | 测试/证据 | 层与运行时机 | 缺少行为为什么会失败 |
| --- | --- | --- | --- |
| AC-11 | `process-fence-plan.test.ts` 的固定安装规划、真实目录/版本根 R7 重指；`process-fence-profile.test.ts` 的生产规则形状/deny 优先 | integration，affected PR/nightly，直接 import | 撤具体绑定后新目标被放行；撤实际规则后固定 CLI 安装路径不在 profile；宽根误放会使表外反例可写。 |
| AC-11 | 临时 `global package installations`，八真实管理器、固定 HOME 族、三档/拒绝、pnpm `.tools` 与 npm/Yarn 版本 prefix | 一次 scenario 留命令/输出，nightly 层，不加入每 PR 矩阵 | 撤清单同次安装拒写；跳过原审批使拒绝臂落盘；仅安装返回 0 但 CLI 不能调用仍失败。 |
| AC-12 | planner 用户文件/软链重指；现有 policy 的 R6 文件状态与三档用例 | integration，affected PR/nightly | 把文件当目录查询会要求 HOME；撤精确文件允许后真实编辑拒写；保护位置不能成为 writable。 |
| AC-12 | 临时真实 `git config --global`、原引擎 write/edit shell 文件；批准/拒绝、移除文件表及 Git `.lock` 对照；CF/C1/两处 shell cache 保护 | 一次 scenario，gate slot | 撤配置或 lock 同操作失败；提前 allow 改变拒绝臂文件；扩大到 HOME 或保护优先错误会使负例落盘。 |

### 偏离记录

- r7 步骤 1：新增 H1 身份读取模块，在 `process-fence-plan` 抽出原有 canonical/alias 节点实现 `planProtectedLocations`，CF 与 HB 共用；不是第二套路径判定。profile 的冻结必填 `homebrewFence` 传播到直接 profile/planner 调用者（native/test 的 packaged-main、packaged-window-main；main 下 credential-table、custom-provider-truth[-fence]、egress-grant-truth、engine-config-fence.engine、engine-db-records.engine、fence-write-denied.engine、mcp-server-truth、network-egress-fence、process-fence-apply/compile/config-fence/engine/extension/wiring/zsh-startup、project-trust-truth-fence、project-writable.engine、server、shell-env、stored-credentials-fence.engine、workspace-identity-firmlink.fixture、workspace-write-probe-fence）。这些超初始清单的文件仅补空安装测试上下文，不启动窗口或增加其重场景；server 下一步才接真实快照。
- `bun test src/main/process-fence-profile.test.ts src/main/process-fence-plan.test.ts` **90 pass**；新增固定安装/用户文件真盘用例 **1 pass**。HB 缺失拒写臂最初由纯规则断言先红，调整观察顺序后同一条真 sandbox-exec Library 写入断言 **1 fail**，恢复 **1 pass**；两份日志都保留，不把最初纯断言冒充真围栏对照。类型传播曾发现 fixture 重复补了字段，已去重；没有更改断言。

- r7 步骤 2：生产先用原写集合读 H1 安装快照，再用同一个 planner/renderer 渲染 HB 拒写与 R7 安装/配置 allow；R6 仍只读最终 apply 的 profile。新增 `platform/darwin.ts` 为默认 Homebrew prefix 的单一常量所有者，原 probe dirs 消费它，值不变；这是新增调用者所需的同域常量归并。server 测试/临时宿主仅在 R7 eligibility 中排除两处真实系统 prefix，防测试预建本机目录，不替换 HOME 族规则或真实围栏。server **53 pass**，ui-mac 类型 exit 0；没有新增权限档名单、卡片或配置项。
- **r7 一次性真实结果。** 场景仍在 `packages/ui-mac/node_modules/.cache/package-manager-scenario-vf8vnnjs/r7/`。`global.test.ts` / `config.test.ts` 首次合跑 **1 pass / 1 fail**（251 expect，失败属于全局矩阵），不能报整组通过。AC-12 的六臂均完成：Git 和真实 write 工具在全部批准零卡、请求审批各原卡批准后写入，拒绝/只读文件不变；撤 W21 与单撤 `.gitconfig.lock` 各使真实写失败；实际生产 profile 下 CF/C1、两处 shell cache 与表外 HOME 均零落盘。`config-results.json` 保留每次卡片、命令退出、内容与保护结果。
- **全局矩阵的输入与观察修正。** 初版临时 runner 把 `row.tool` 名字误用为完成记录，导致去重漏掉首个成功 npm 行；第二次在准备 `results` 时 EEXIST，未重复该安装，原成功行保留。已改为 `toolResult`，不修改产品。空 Yarn cwd 向上读到 worktree 的 Bun packageManager；改用 r4 真实 Yarn init manifest 后，普通与版本 prefix 的 all/ask 均成功、无附加 external_directory 卡；旧撤表臂因未到真实写入判无效，带正确 manifest 的两条撤表臂 exit 1/EPERM。pnpm 全局安装两档本来已成功，但 global 模式不触发项目钉版；另在真实 pnpm init manifest 的项目执行 add，all/ask 实际写入 `.tools`，撤 W21 后失败，不重复成功全局安装。`global-resume.test.ts` 第一组 **1 pass / 30 expect**；正确输入的 Yarn 撤表两行通过。pip/uv/Go/Cargo/npm（含 nvm 模板）全部批准/请求审批成功、拒绝/只读零安装、撤表失败均已记录；每个安装之后真实 CLI 被调用。npm 三条配置警告沿已接受记录保留。
- **SEAM-CHANGE-NEEDED: R1 的 Bun 全局位置。** 冻结 §4.1 的 `PackageManagerLocationInput` 不含 exported XDG_CACHE_HOME，§4.2 只列 HOME 下 `.bun/install/global` 与 `.bun/bin`。真实 Bun 1.4.4 在本代已设置 XDG_CACHE_HOME 时，将两处都放到 `<XDG_CACHE_HOME>/.bun/{install/global,bin}`。完整生产入口的 all/ask 因 EPERM 失败，补真实 cwd manifest 仍失败；只给 HOME/.bun 的诊断臂仍失败。围栏外、同样隔离 HOME/XDG/cache 的一次控制安装 exit 0，`bun pm bin -g` 和实际文件/链接均指向该 XDG 根（`bun-unfenced-control/result.json`）。仅补 global 子树时能写 package.json 但仍 EPERM；只在临时 profile 补这两个准确子树并预建，真实引擎同命令安装且 CLI 可调用 **exit 0、0 卡**，`bun-cache-home-pair.test.ts` **1 pass / 5 expect**。不放开整个 cacheHome/.bun，不改生产固定表、不注入 BUN_INSTALL、不挪 HOME/XDG。需要冻结输入向 R1 提供实际 exported cacheHome（含未设置语义），并明确 Bun 两个全局子树的映射后续接；这是本次需编排者处置的接缝，不记录成 owner 决定。
- 本轮按 r7 的“出现未定设计问题即返回”停止后续依赖；切片五尚未追加实施段或开始 H2–H4。已完成的 AC-10、AC-12 与其它管理器证据保留，Bun/整体 AC-11 不记通过。七个其它工具的缓存与 Go 证明沿 r4/r6 收据，不重跑。
- 相关回归九文件首轮 **120 pass / 1 fail**：custom-provider-truth 的固定行枚举遗漏新动态 W21。只将 W21 与 W20 同样从固定行排除，保留原固定行精确集合，完整该文件 **10 pass**；其余八文件 **111 pass**。platform fast 及两包类型、north-star、旧名、docs/affected-tests 与 diff 的最终结果见同根 `r7/summary.json`。新增/变化均在原 fast/integration 文件，生产依赖由 import/literal path 可追溯；不把一次工具矩阵加入每 PR。无窗口、真实 HOME/prefix 安装、全量 gate、push/PR/merge。
- **r8 Bun ruling（编排者 Claude Opus 5.5，2026-11-27）。** 本轮据续接明确修正 R1 的 Bun 输入与派生环境，不改其它冻结决定。生产来源：`server.ts:480–489` 的 `resolveShellProbeRoots` 总把 `roots.cacheHome`（未导出时由 `process-fence-profile.ts:98` 取 HOME/.cache）写进 probe context；`server.ts:506` 的 `preferAppEnv` 经 `shell-env.ts:15–21` 的可信根恢复写回 main，`index.ts:719–720` 在 fork 前调用；`server.ts:639` 的 createSidecarEnv 与 `sidecar-env.ts:71` 的 XDG 前缀把它交给子进程。`sidecar.ts:298` 只补 state，不是 cache 的来源。因此 app 确实会补 XDG_CACHE_HOME，不能把补后的值误当用户原始导出。实施保留补值前的用户 Bun/XDG 快照，R1 新增 nullable xdgCacheHome/bunInstall，按 ruling 的优先级落两个准确子树并走原 R7；用户未设置 BUN_INSTALL 时只给围栏/probe 子进程注入其真实 Bun 根，不把 probe 回吐的派生值写成 main 的用户配置。用户已设置则保留其值，仍走正常原环境继承；sidecar EXACT 仅增该非秘密路径键。新增输入传播到 profile/plan/server 和其既有调用测试；场景仅补 Bun 未闭合行，不重跑已通过工具。首条纯解析回归先红，日志 `/tmp/fence1759-r8-bun-red.log`；这不是对 owner 决定的重新归因。
- r8 Bun 实施：主进程在 prepare/prefer 的首次调用按 userData 身份保留原始两个字段，后续启动/重查询消费同一快照；Bun 根作为新权限位置事实，不接受 shell cache/rc 回吐改根，配置值保留为最初可信导出。未设置时的 BUN_INSTALL 仅进入 planner 给 probe/sidecar/R2 的投影，所有同步/缓存/异步合并都不把它变成 main 用户环境。profile/planner/sidecar-env 三文件 **120 pass**，server **54 pass**，ui-mac 类型 exit 0。新增回归在既有 fast/integration 文件，正常 import 可追溯，gate 表只同步 **47/54** 条；config-fence.cases 与 wiring.test 仅补新必填 nullable 输入。
- `gate slot -- bun test ./node_modules/.cache/package-manager-scenario-vf8vnnjs/r8/bun.test.ts` **1 pass / 66 expect**：真实生产 prepareShellProbeFence → preferAppEnv → spawnLocalServer → sidecar/fence → 原助手 Shell 工具，三种用户环境正臂、原审批/拒绝/只读及只撤 Bun 两条 W21 共七臂。全部批准 0 卡，请求审批 1 张原卡；真实 Bun 安装后，在原用户环境、围栏外用 Node 调实际 bin 的 semver 得到 1.2.3。默认用户根为 HOME/.bun，即使应用后补了 HOME/.cache；用户 XDG 根和显式 BUN_INSTALL 的优先级与原生查询相同。旧缓存目录前后 hash 不变；显式 root/install/cache 事后也为 0 文件。撤两条新规则 exit 1/EPERM、0 CLI 落盘。工具版本/来源沿 r4/r7 摘要，结果 `r8/bun-results.json`。AC-11 非 brew 已闭合；不重跑 r7 其它管理器或 AC-10/12。

- r8 收口：较宽相关六文件 `bun test --max-concurrency 2 src/main/naming-migration-wiring.test.ts src/main/keychain-boot-order.test.ts src/main/process-fence-wiring.test.ts src/main/shell-env.test.ts src/main/custom-provider-truth.test.ts src/main/package-manager-environment.test.ts` **51 pass / 0 fail / 483 expect**。这次误将 wiring 文件内既有 Office 冷/暖真实下载用例一并带出 slot 运行；这些隔离缓存行已结束且通过，不重跑、不计为 #1759 新证明；本轮测试选择的偏离在此明示。ui-mac 类型 exit 0，north-star exit 0，旧名 **10 pass**。`affected-tests --list` exit 2：基线缺根 `.gate-tests`，没有 scope 行，不改 gate。

## 交付切片五｜Homebrew 围栏外执行

- 依据：#1759；spec v6 BR-09/AC-11（brew）；design v4.4 §4.1–4.4、§5、§6 ①–⑦与 §10 @ `e3a15f2432`。H2 私有输入见 :800–844，H4 claim/交付见 :869–907，重定向次序与比较见 :896–897，证明义务见 :939；历史 r8 接缝已由该版关闭。Bun 沿 r8 已完成结果。 r12 起另依合并版 v4.5（origin/alpha）：H4「v4.5 根 Shell 跨 exec 的身份连续性」与 §6 v4.5 ①–④。
- 核对：r11 `Phase: IMPLEMENT` · Claude Opus 5.5（编排者）按 `e154ccd365` 的 v4.5 授权关闭 root exec 接缝并继续切片五；Codex（GPT-6）实施自核，不冒充独立审查。
- 核对（r12）：编排者交接续行（实施）· Claude Opus 5.5 接手 r11 中断的 lane，按合并版 v4.5 改正 `88e61e6c92` 并补齐切片五场景行；实施自核，不冒充独立审查。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/plugin/src/codepuppy-package-manager.ts`（新增） | 冻结 H2 类型的单一所有者，无运行时服务或新依赖。 |
| `packages/ui-mac/engine/package-manager-scan-transform.ts`、`package-manager-plan.ts`（新增）及模块测试 | 在同一 ShellScan 的 build seam 补源 span/命令与重定向事实；main 的确定 argv/cwd/赋值规划和私有输入前导/叶重写；不复制 parser/前置词表。 |
| `packages/ui-mac/engine/package-manager-shell-transform.ts`（新增）及模块测试；`scripts/build-engine.ts`、`electron.vite.config.ts`、必要的 `env.d.ts` | H2 窄口 build adapter：原 prepare 后实际 Shell.ID、Tool.Context、私有 input fd、真实 PID 绑定与原生命周期清理；main 与 engine 构建消费相同 scanner，保持上游文件不改。 |
| `packages/ext/src/hub-bridge.ts`、`plugin.ts` 及既有测试；`packages/ui-mac/src/main/codepuppy-sidecar-messages.ts`、`hub-view.ts` 及既有测试 | H2 控制请求经真实 sidecar 宿主连接；类型/线协议只有一个解析所有者；凭据不落盘/日志。 |
| `packages/ui-mac/src/main/homebrew-installation.ts`、`server.ts` 及既有测试；`package-manager-execution.ts`（新增）及模块测试 | 保存本代安装/普通环境/覆盖前代理快照，规划与复核身份；main 节点簿、一次 claim/比较、仅自有参数 spawn、流与 PGID 取消。 |
| `packages/ui-mac/src/main/network-egress-proxy.ts`、`index.ts` 及既有测试 | 同一个策略代理的精确非 CONNECT 数据路由，原 CONNECT 不变；正常退出先结束 main 在途孩子。 |
| `packages/ui-mac/native/codepuppy-fence/package_manager.c`、`package_manager_ipc.h`、`package_manager_helper.m`（新增）、`codepuppy_fence.c`；main 的 `package-manager-helper.ts`（新增） | 内核 audit/signature/进程身份与绑定检查；私有 Mach claim；严格签名原生 helper 的 proof fd 读取、匿名 loopback 字节流与原叶 fenced exec。 |
| `packages/ui-mac/scripts/build-fence-addon.ts`、`build-package-manager-helper.ts`（新增）、`electron-builder.config.ts` 与相关既有测试 | 两架构构建、只读资源、严格 helper 签名复用现有打包签名身份；不启动应用/窗口、不触碰真实证书或安装。 |
| `scripts/gate-files.tsv`、本计划 | 必要枚举机械同步、实际命令/结果/偏离；不改 gate。 |

### 顺序

1. H1：在同一 scanner 加确定规划入口与 source facts，复用既有 ShellSelect 方言/前置词；补路径/分支/变量/opaque/重定向用例与三个真实解释器的前导/叶交付测试。运行变动模块文件一次并提交。
2. H2：Core/Plugin 构建适配、真实 Tool.Context 到 ext/main 的桥；保留原 Info/权限/Job，对私有 fd、prepare 次序与绑定/清理做最低层证据。运行各变动文件、适用类型检查后提交。
3. H3/H4：main 节点簿和路由、helper/addon、打包与退出清理一起落地；节点格式/比较、错误证明仍 pending、一次消费、错误 HTTP 零 spawn、流/身份重核/取消；签名/Mach 前提只用临时 CLI。运行相关文件、类型后提交。
4. 经 `gate slot` 一次性真实生产 main → sidecar → Shell 工具 → broker/helper → 真实 Homebrew formula，隔离 HOME/prefix/cache；只补失败行、不重复成功安装。逐项 §6 ①–⑦和撤分流 exit 71、保护撤除、凭据比较/交付/重定向次序移除臂；记录工具/来源/digest/输出/磁盘。最后一次较宽直接相关集合、类型、旧名、north-star、文档契约、affected-tests 与 diff 收口并提交证据。

### 风险

- scanner 原本服务权限，不含 H1 全部事实；build seam 必须精确锚定并在漂移时构建失败，原扫描结果不变，main 不拉 Core 服务层。循环/不可确定值沿冻结 opaque 语义保留原围栏执行。
- 私有输入、用户 redirections 和已有 fd 的次序必须由同一个原 shell 求值，不能由 main 模拟其副作用；先用真正 bash/zsh/posix 钉住 :896，再接完整安装，避免重安装迭代。
- helper 已就绪但 root PID 尚未绑定的竞态须等真实 bind/cancel；错误凭据不得消耗 pending；异步断流/正常退出只有一个终态，main 自己持有孩子句柄。
- 签名/Mach CLI 可以无窗口验证；本机证据只用 adhoc hardened helper，不弹证书授权或启动 Electron。生产 Team/打包形态若不能在禁窗口条件下证明，明确记录边界，不伪称实跑。

### 证明

| AC | 测试/证据 | 层与运行时机 | 缺少行为为什么会失败 |
| --- | --- | --- | --- |
| AC-11/H1 | `engine/package-manager-plan.test.ts`：真实 scanner 产物、PATH 覆盖/quote/path/precommand、export 与 cd 的分支、opaque、原 redirection spans；main 身份/HB 既有测试 | fast/integration，affected PR/nightly，直接 import 与 literal 源码路径 | 复制/错用 PATH 或盲用未执行 export 会选错 launcher/cwd；漏 span 会改非 brew 叶；移除 HB 则 launcher/Library 可写。 |
| §6 ③④⑥ | 上述模块的临时解释器输入/输出测试：三方言、allexport/xtrace、3–9 全闭、2>&9、9>out、文件/pipe/关闭 stdin、失败重定向 | integration，affected PR/nightly；不装包、不跑计时 | 内部 fd 先绑再套用户重定向时拿不到 proof；错序则建文件/用户 stderr/stdin/失败状态不同；导出/trace 会泄露已知测试凭据。 |
| AC-11/H2 | shell-transform 与 hub-bridge/messages/host 既有文件的准备/上下文/私有字节/真实绑定/清理回归 | fast/integration，affected PR/nightly | 提前委派会绕审批；metadata 来自模型或漏 PID 绑定不能建立真实执行；把 privateInput 放 Info/环境会直接被检查捕获。 |
| H3/H4、§6 ⑦ | `main/package-manager-execution.test.ts`：坏格式不进比较、wrong proof 保持 pending 后正确 claim、重放/额外参数零 spawn；实际 HTTP stream/stdin/exit/cancel；native peer 模块测试 | fast/integration，affected PR/nightly；签名内核组合留一次 scenario | 撤 timingSafeEqual 会使错误 proof 领取；先终结 wrong-proof 节点使随后真实叶失败；重复/改参数会多 spawn 或用到 caller 值；断流不清理会留下句柄。 |
| AC-11、§6 ①②⑤ | 临时真实助手 Shell → 原 gate/prepare → H2/main → helper/Mach → 真实 formula：all/ask/deny/readonly、cd/&&/\|\|、r8 attacker、解释器内残留与启动文件抢读 | 一次 scenario/nightly 层，经 gate slot，命令/来源/digest 存原场景根 `r9/`，不加入每 PR 矩阵 | 撤分流真实 Homebrew 内部 sandbox exit 71；撤 proof 比较恢复 r8 grant；正确 proof 仍须安装/CLI 成功；启动抢读须 126/错误码，不能静默放行。 |
| §6 ③、⑥、取消/退出 | 同一次真实入口核并发兄弟/后台 argv/env/fd、非 brew/postinstall 零凭据、无多余 helper/brew fd、真实重定向矩阵；stdout/stderr/exit/signal、背景/大输出、abort/timeout/disconnect/normal quit | 一次 scenario，经 gate slot，无时长阈值/种子扫掠 | 凭据走 argv/env 可被兄弟读到；用户 3–9 关闭必须仍分流；错误流终态/取消会与实际退出/磁盘/子进程状态不符。 |

### 偏离记录

- r8 的 adhoc Mach 前提反例与所有原始/修正记录保留在原场景根 `r8/h4/`，不改写为产品证明；r9 v4.4 以 §4.4 :890–901 / §6 :939 取代此前仅 peer/祖先核验。此计划不再把旧 :789/:836/:875 视为当前 H4 合同。旧文档契约 **70 error/252 warning** 与缺 `.gate-tests` 的基线收据沿 r8，结束时只核相关增量。
- r9 步骤 1：补充 `src/shared/package-manager-syntax.ts` 作为虚拟 scanner 与 main 类型的同一事实所有者、`scripts/package-manager-build.ts` 供两个构建入口复用；两者是同调用链必需文件，不复制 ShellScan。方言名从原 `ShellSelect.name` 的 POSIX 源码投影，漂移即构建失败，不拉其服务依赖。三方言实测使交付构造先接管道到组、再组内复制描述符；zsh 在直接命令上先求值重定向才接 pipe。closed stdin 用普通 true 实际复制到 8 检测，避免 0→0 被 shell 当作 no-op。
- r9 步骤 2：原 Core/Plugin 文件只经精确 build adapter 接 H2，Tool.Context 的 session/message/call 来自真实调用；原 create.before 不变。真实 `Shell.create` 函数与生产 Node spawner 的集成证明 prepare→委派→真实 PID、私有 fd、原 Info.command/输出和 finish。主消息/parser/host与适配 **39 pass**，ext 桥 **15 pass**，两包类型 exit 0。此提交先落控制链，plugin 的注册调用与 server 的实际 main 节点簿在步骤 3 一起启用；中间提交没有一个能放行 brew 的不完整端口。
- r9 步骤 3 的独立原生底座：真实双片 addon、严格 adhoc helper 与 Node 宿主组合 **1 pass / 20 expect**；kernel audit 的 peer PID/pidversion 匹配真实 helper、root 祖先为真、改 pidversion 为假；同签名/同字节复制到别的路径不能进入 main callback；匿名 proof fd 进 claim，argv 零凭据；真实二进制 stdin/stdout、stderr 与 exit 17、HTTP fenced 回退仍保留完整 stdin，409 node-consumed 保留稳定原因。此测试只核原生/传输，不把测试宿主的固定 grant 当作生产节点簿或真实 brew 证明。HTTP 数据开始用既有空 stdout 帧确认启动，再读 stdin；没有新增公开帧或用户步骤。每帧 autoreleasepool 保持流式内存，而非累积整段输入/输出。
- 必需枚举同步：`keychain-rename-native.test.ts` 原二进制断言因同一 addon 新增 H4 的六项 SecCode 签名 API 而 **3 pass / 1 fail**；精确枚举补为原两个条目 API 加冻结的六项签名 API，钥匙串源码禁用标识符与两个属性断言原样保留，相关四文件 **23 pass**。这是构建变化的同调用链测试，超初始显式文件名的原因在此记录。ext 直接消费者 hub-tools **23 pass**。未运行会启动 Electron 的 process-fence-apply 整文件。
- 移除臂：把用户 redirections 移到内部 fd 绑定之后，真实三方言测试在第一条 3–9 全闭语料 **1 fail**；恢复 **1 pass / 129 expect**。撤 H2 的 additionalFds，真实 Node spawner 的原 Shell.create 用例 **1 fail**（私有读失败，terminal.exit=1）；恢复 **1 pass / 8 expect**。这些是最低层证据，不替代 §6 的完整真实助手入口。

- **r9 未定问题｜H4 的 200 后非法 stdin 帧。** 当前冻结版 `design.md @ e3a15f2432:903–905` 要求首帧接受后 200、双向 chunked stdin/输出，又把字段/帧不合法的 400 列为 0 spawn；:852–868 的响应 union 没有协议错误终态，stopped.reason 只含四种既有取消原因。合法首帧已启动进程并返回 200 后，后续 `{type:"stdin",dataBase64:123}` 才到达时，不能再实现 400/0 spawn。一次性真实 Node HTTP/真实 `/bin/cat` 前提探针 `r9/http-premise/probe.mjs` 的结果为 `spawnCount=1`、`headersAlreadySent=true`、`clientStatus=200`、改响应头 `ERR_HTTP_HEADERS_SENT`，按“所有非法帧均 0 spawn”断言 **exit 1**。此探针不是生产 broker/真实 brew 的完成证明；首轮把 cat 路径误写为 /usr/bin/cat 而 ENOENT，改为本机真实 /bin/cat 后才计上述结果。
- 需编排者裁决的最小点：**零 spawn/HTTP 错误是否只约束 200 之前的校验；200 后非法 stdin 帧是否取消该进程组并断流、helper 非零，或应有哪一种指定的流终态？** 建议限定零 spawn 为启动前，并明确后续坏帧按取消/断流处理；不增加卡片或其它用户步骤。若要所有未来坏帧都 0 spawn，就必须等整个 stdin 请求 EOF 后才启动，不能实现当前双向流目标；本轮不自行选这个行为或改公开错误 union。按 r9「出现未定设计问题返回 PLAN-READY」交回这一点，不重开已关闭的 r8 叶凭据接缝。
- 因该点暂停 main HTTP broker 与生产启用：H1/H2 两个实现提交和独立原生底座已提交；完整 `package-manager-execution.ts` 与 launcher resolver 的未提交草稿保存在原场景根 `r9/in-progress/`，未装进生产入口。恢复时接本代普通环境/覆盖前八个代理键、安装/HB 身份，完成节点簿的凭据格式/常数比较/一次请求与终态清理、唯一代理路由、plugin 注册、打包/正常退出，再跑真实 formula 与 §6 全链。原生底座测试的固定授权不能替代这些步骤。
- 本轮约 50 分钟、三个实现提交与一次计划提交；H1 **4 pass / 152 expect**，H2 main/适配 **39 pass / 270 expect**、ext **15 pass / 59 expect**；原生底座 **1 pass / 20 expect**。重定向和私有 fd 移除臂各 **1 fail**，恢复各 **1 pass**；完整真实 brew、r8 反例全链转绿、⑦ 节点簿及生产取消/退出尚未完成。相关消费者 ui-mac **23 pass / 114 expect**、ext **23 pass / 83 expect**。实际命令/日志及证据边界留原场景根 `r9/summary.json`；没有重跑已通过的软件包安装、全量 gate、Electron 或窗口、外部写操作。
- 最终检查：ui-mac/ext/plugin 类型 exit 0，旧名 **10 pass**、north-star/diff exit 0；文档契约 **70 error / 252 warning** 与 r8 finding 逐项相同。`affected-tests --list` **exit 2**：此基线缺 `.gate-tests`，没有 scope 行；不改 gate，不宣称已验证选择器。`205342b0c2` 只落独立原生底座；本次 PLAN-READY 只待上述 late-frame 语义裁决，不代表切片五完成。

- **r10 post-start invalid-frame ruling（编排者 Claude Opus 5.5，2026-11-27）。** v4.4 §4.4 的 400/零 spawn 约束启动前可校验材料；200/进程已启动后的非法 stdin 帧取消整个进程组并断流，helper 在同一卡片 stderr 给出原因、非零退出，无后续 brew 输出。生产测试分别核启动前 400/零 spawn 与启动后无存活孩子，不新增流终态或用户步骤。r9 的特定未定点由此闭合，继续原切片五。
- r10 步骤 3：H3/H4 节点簿、唯一 HTTP 路由、ext 注册与正常退出一起启用。Shell finish 删除原命令/计划/未用凭据，仅本代保留 hash+ID 墓碑以拒重放；正常退出先停止新 lease、等 TERM/3s force 清完整个组，再停 sidecar/继续退出。保存同一 sidecar env 的覆盖前代理值/缺席，Go 重查询后每次计划取 main 更新快照；helper 资源与必要 alias 节点经原 HB/CF planner 拒写。新增 predev 的 helper 构建为同调用链必需，防 dev 缺二进制；mac-target-arch 原包夹具补严格 adhoc helper，配置沿 packager 同一身份/临时 keychain 预签并排除 Electron entitlements 深签覆盖，未调用真实证书。
- 新 Node 集成首次发现多代 dlopen 重复注册同一 N-API cleanup hook 导致 Node abort（r10-book.log）；改为每个 Mach service 自有 cleanup hook，关闭/GC 幂等，真实重复代用例通过。该修正属于 r9 新底座的实际接线缺陷。H1 补未到达静态节点仍规划凭据（跳过的 export 不传播）、未知 export 的值不沿用旧快照、time/coproc 前置语义；不新增 parser 或识别白名单。模块与节点簿 **5 pass / 158 expect**，server/profile **101 pass / 619 expect**，打包相关 **40 pass / 99 expect**；真实 formula/完整 §6 场景尚未计通过。
- r10 实际构建回归：electron-vite 的配置 bundler 把 scanner 的 import.meta.dirname 留在临时配置文件上下文，main 首次构建找错 Core 目录而 ENOENT。最低层使用生产 electron-vite.loadConfigFromFile 加载真实配置并调用同一 scanner 插件，修正前 **1 fail**（Vite 自己的 loader 不复现，未冒充红证据）；红测试独立提交后，路径改由 fileURLToPath(import.meta.url) 取原文件目录，原断言不改，完整 H1 **5 pass / 157 expect**。不改上游或新增构建开关。
- r10 完整入口发现 zsh 外围关闭 stdin 时，原 `if true 2>/dev/null 8<&0` 的复制失败诊断仍落到用户 stderr。最低层原三方言文件补“不出现 bad file descriptor”断言，独立红提交 `506076b033`（0 pass / 1 fail）；将 stderr 重定向放到外围探测组后，原断言不改，完整 H1 通过。仅修正 R1-F1 构造的可见输出，不改真实叶的重定向次序、失败码或 stdin。
- r10 场景根为原根下的 `r10/`：`packages/ui-mac/node_modules/.cache/package-manager-scenario-vf8vnnjs/r10/summary.json` 保存命令、PASS/expect 数、来源/digest、磁盘记录、控制臂及未证明边界；仅作为一次 scenario 层材料，不加入每 PR 测试。Homebrew 为只读本机源码 clone（commit `3e47189a707c739ee1278a28a3b845f5834574e6`，7.0.15）；临时 tap 的真实 formula 安装官方 jq 1.8.1 原始 arm64 CLI（SHA-256 `a9fe3ea2f86dfc72f6728417521ec9067b343277152b114f4e98d8cb0e263603`），不冒称为 homebrew/core 的编译配方。真实 Homebrew 的 install.rb/Sandbox 路径未替换，formula/资源/宿主边界见 `sources.json`。
- 场景隔离偏离：首轮登录探针把 PATH 改成系统 brew，导致安装命令尝试真实 prefix 的目录创建，围栏拒绝、未完成安装；随后在源码中明确隔离 PATH，先要求 `brew --prefix` 精确等于临时 prefix 且观测到对应 main spawn，才允许安装。临时 Portable Ruby 的 `current` 软链曾被复制展开，恢复真实软链；Homebrew 7 的本地 tap trust 用原生 `brew trust` 在隔离 HOME/XDG_CONFIG_HOME 预置。没有执行真实位置的成功安装。一次较宽测试误从仓库根调用，被根 guard 在发现测试前拒绝；改在包目录运行。以上不是产品新增开关或用户步骤。

| r10 命令（包目录按路径所属包） | 结果与实际产物 |
| --- | --- |
| `bun test --max-concurrency 2 engine/package-manager-plan.test.ts` | **5 pass / 163 expect**；生产 config bundling、同源 scanner、真实三方言私有输入/重定向；新增两项缺陷各有独立红提交后修正。 |
| `bun test --max-concurrency 2 src/main/package-manager-execution.test.ts` | **1 pass / 3 expect**（内部真实 Node assert 四行）；坏格式/错误 proof 保持 pending、正确 claim/一次消费、字节流/exit17、启动前 400/0 spawn、200 后坏帧 helper 非零/原因 stderr/整个 PGID 消失、main 正常退出清组。常数比较为两段 32 字节 Buffer 的 `timingSafeEqual`，未跑计时测试。 |
| `bun test --max-concurrency 2 src/main/process-fence-profile.test.ts src/main/server.test.ts`；`src/main/mac-target-arch.test.ts` | 分别 **101 pass / 619 expect**、**40 pass / 99 expect**；真实磁盘 launcher/PATH shadow/身份刷新，helper 资源与签名打包接线。 |
| ext：`bun test --max-concurrency 2 src/hub-bridge.test.ts` | **15 pass / 59 expect**；原通道授权、绑定、清理与私有字节投影。 |
| `gate slot -- bun ./node_modules/.cache/package-manager-scenario-vf8vnnjs/r10/run.ts` | **1 pass / 31 expect**；真实 prepare/prefer → main/受围栏 Node sidecar → 原助手 Shell → H2/Mach/helper → main HTTP broker → 真实 formula。`cd p && brew install jq` 成功，cwd 为 p；围栏外 jq 输出 `jq-1.8.1`；`false || brew --prefix && echo ok` 成功。all 0 卡、ask 一张原命令卡，deny/readonly 0 main spawn。磁盘 `formula-results.json`。成功安装不重跑。 |
| `gate slot -- …/r10/bun-main-host test …/r10/security.test.ts` | **2 pass / 17 expect**；真实普通 Python 叶 re-exec 严格 helper，坏格式与错误 proof 均 126/unauthorized，外层 false 为 exit1、0 main spawn、finish；另一行同节点随后真实叶成功。测试主机提供同用户 PID 快照，围栏内 reader 对 argv/env 的 64-hex 候选立即 hash，自身 fd3–9 为空；没有保存原始环境或凭据。此快照不冒充全部并发/后台矩阵。 |
| `gate slot -- …/r10/bun-main-host test …/r10/redirections.test.ts` | **0 pass / 1 fail**；实际磁盘 bash/zsh 各 9 行已通过（close3–9、stderr→9、9>out、文件/pipe/两种 EOF、missing 0 claim、allexport/xtrace 无凭据），POSIX 合法叶因下述 root 身份问题被拒，不标三方言全通过。缺失重定向行的 finish 已观测。 |
| `gate slot -- bun …/r10/lifecycle-run.ts` | 四个独立进程各 **1 pass**，共 **4 pass / 16 expect**；真实 Shell 工具 cancel/timeout、sidecar 断开、调用生产 main 退出清理；TERM 不退出的孩子和 brew PGID 均在测试宿主收尾之前消失。app-quitting 调生产 `stopPackageManagerExecutions`，没有启动 Electron 的 before-quit 事件；该事件接线沿现有 window-close 测试核对。 |

- r10 已知坏臂：只在场景的同一 main 构建中去掉 proof 的 `timingSafeEqual`，未改生产源码，普通叶第二次 wrong-proof claim 得到 delegated、1 main spawn，原断言 **1 fail**；正常版此前 **2 pass**，产物分别 `comparison-removal-results.json`、`security-results.json`。撤 H2 分流的真实 formula 臂 **1 fail**，但实际先失败于 prefix 写权限预检，**未到嵌套 sandbox exit71，不计为所需 P09 证明**。r9 的 fd 次序和 additionalFds 移除红臂继续保留，不把它们替代完整入口。
- **r10 接缝待裁决：H2/H4 根进程跨 exec 的身份连续性。** 冻结 `design.md @ e3a15f2432:836,890` 要求一次绑定本代 root PID/pidversion、接受真实 Shell 的 exec 形态/后代。实际原生实现 `native/codepuppy-fence/package_manager.c:237` 对当前 root audit pidversion 作相等检查。真实 POSIX 入口 `posix-peer-results.json` 中 root PID **48986** 不变，bind 的 pidversion **11944774**，claim 时 **11944775**；正确 proof 已经过比较，真实 helper PID **48990**，ancestry 返回 false，helper **126/unauthorized**、0 main spawn；同一真实入口的针对性复核 **0 pass / 1 fail**。最小需要：冻结 root 跨 exec 仍可验证同一内核进程实例的判据，并保留 peer 当前 audit pidversion/签名/节点 proof 校验；不自行放松当前 root 校验或改 H2/公开协议。未闭合 POSIX/exec 行，故切片五本轮不是 DONE。
- 未证明边界：compound install + npm/postinstall 全链、完整并发/后台 fd 矩阵、解释器残留/启动文件抢读、完整入口 HB 负向身份矩阵、P09 nested exit71、生产 Team/打包 Electron 身份与真实 GUI quit。adhoc hardened helper、真实 Mach audit/kernel 和真实 Node 引擎证据不冒充这些边界。AC-09/10/12 与非 brew AC-11 沿此前已验收材料，未重跑成功工具行。
- 最后较宽直接相关集合：`bun test --max-concurrency 2 src/main/network-egress-proxy.test.ts src/main/window-close.test.ts src/main/keychain-boot-order.test.ts src/main/keychain-rename-native.test.ts src/main/naming-migration-wiring.test.ts` **60 pass / 249 expect**。ui-mac/ext 类型 exit0、旧名 **10 pass / 2347 expect**、north-star/diff exit0，hooksPath 为 `.githooks`。文档契约 **70 error / 252 warning**，finding 与 r9 逐项相同；`affected-tests --list` **exit2**（基线缺 `.gate-tests`，没有 scope 行）。未跑 gate run/bin/check/全包或计时用例；未启动应用/窗口、签名授权弹框或外部写操作。细节只保存在本计划和忽略的场景产物。

- r11 输入：按编排者明确授权读取设计 worktree 的 `e154ccd365` v4.5（独立审查并行，不 merge/rebase）；r10 root 身份接缝由该输入关闭。红回归在原节点簿测试里令真实根 bash 绑定后 exec 到 sh，再到严格 helper，旧实现 **1 fail**（126 ≠ 17，`/tmp/fence1759-r11-root-red.log`），独立提交 `089305a611`。本步改原生根启动时间读取/祖先先后，TS 消费 `BoundShellProcess`；原 peer audit pidversion/签名检查保留。场景与对照结果在本节后续补入。
- r11 本步验证：`gate slot -- bun test --max-concurrency 2 src/main/package-manager-execution.test.ts src/main/package-manager-helper.test.ts` **2 pass / 23 expect**；原红回归未改。helper 既有用例同时断言 peer 错 pidversion 和根错微秒启动时间均为 false；两包中的本次代码只改 ui-mac，`bun typecheck` exit0。无新增永久用例条数，原 gate 文件计数不变。

- r12 输入（接手 r11 中断的 lane，Claude Opus 5.5 实施）：合并版 design v4.5（origin/alpha，`ri_proc_start_abstime` 单调根身份、去掉逐跳先后比较）取代 r11 按送审稿实现的日历时间 + 逐跳先后；r11 的 `88e61e6c92` 由本轮按合并版改正。
- r12 步骤 A｜进程组存活查询的 EPERM。r11 真实入口 `/tmp/fence1759-r11-full-root.log` 记录 `kill(-pgid,0)` 在流运行中返回 **EPERM**，从 cleanup 定时器抛出、终止 main 模块；r11 红测 `eac0e4fca5` 只注入运行期查询，未提交的修正只把查询推迟到 stop/close 之后。本轮把原测试的注入改为"本次流的前两次组查询"并断言注入都被触达：仅推迟查询的版本在 close 后第一次查询仍抛 EPERM，**0 pass / 1 fail**（`/tmp/fence1759-r12-group-red.log`）；`groupExists` 视 EPERM 为组仍存活、`signalGroup` 容忍 EPERM 后 **1 pass / 3 expect**（`/tmp/fence1759-r12-group-green.log`）。不新增帧、超时或用户步骤。
- r12 步骤 B｜按合并版 v4.5 改原生根身份。`package_manager.c` 的 `packageManagerProcessIdentity` 改读 `proc_pid_rusage(RUSAGE_INFO_V4).ri_proc_start_abstime`（BigInt，读不到返回 undefined）；`bound_descendant` 保留 peer 当前 audit pidversion 相等，自 peer 逐跳读活父链（`pbi_ppid` ≤1 或读不到即拒），中间跳不比较任何时间，只在根 PID 处要求单调启动时间完全相等。TS `BoundShellProcess = { pid, startAbstime: bigint }`，节点簿只改类型。一次性红/绿（快照夹具由同一份 `package_manager.c` 编译，只替换 `proc_pidinfo` 返回值，`r12/ordering.ts`）：r11 实现上 plain **true**、父进程日历启动晚于孩子（R1-F1 回拨情形）**false**、孤儿 **false**（`ordering-before-474f80a625.json`）；改后依次 **true / true / false**（`ordering-after-v45.json`）。模块层 `gate slot -- bun test --max-concurrency 2 src/main/package-manager-execution.test.ts src/main/package-manager-helper.test.ts` **2 pass / 23 expect**（真实 bash→exec sh 根仍 claim；peer 错 pidversion、根错 abstime 均 false）；`bun typecheck` exit 0；旧名 **10 pass / 2347 expect**。
- r12 步骤 C｜§6 v4.5 与切片五剩余场景行，全部用最终代码经 `gate slot -- …/r10/bun-main-host test …` 跑一次；场景根 `packages/ui-mac/node_modules/.cache/package-manager-scenario-vf8vnnjs/r12/`（`summary.json` 汇总命令、计数、digest、边界；r10 host 只改 v4.5 原生形状检查、BigInt 记录、HB 撤除开关与可变发现前缀，r10 旧记录先拷到 `r12/r10-records-before-r12/`）。场景 addon 由 `r12/setup.ts` 从当前 `package_manager.c`（sha256 `ee0633c0…`）重建，helper 仍为 r10 严格 adhoc 签名（`3366c4ce…`，无 Team）。

| r12 行 | 结果与产物 |
| --- | --- |
| §6 v4.5 ①：POSIX 根经 exec 仍 claim；§6 ⑥ 三方言 | `r12/redirections.test.ts` **1 pass / 189 expect**：bash、zsh、`/bin/sh` 各 9 行，8 行 delegated 各 1 次 main spawn，`<missing` 0 claim、退出码同原 shell（1）。`r12/root-version.test.ts` 正臂：`/bin/sh` 的 `brew --prefix` 原生祖先判定 **true**、exit 0、1 spawn。 |
| §6 v4.5 ②：PID 重用冒充者 | `r12/reuse.test.ts` **1 pass / 13 expect**：绑定根 74386 退出后第 99 267 次挂起 spawn 的 bash 取得同 PID 并作为 helper 祖先，判定 **false**、126/unauthorized、0 spawn；`reuse-direct.test.ts` **1 pass / 10 expect**：helper 自身取得根 PID 74530，判定 **false**、126。peer 当前 pidversion ≠ trailer 仍为 false 由 `package-manager-helper.test.ts` 的 wrongVersion 行覆盖。 |
| §6 v4.5 ③：直接记录原生判定翻转 | 恢复根 pidversion 相等（`old-root-version.node` 编自 `6624c674a1`，`ROOT_ARM=control`）：同一 POSIX 叶 **true→false**、126、0 spawn（`root-version-control.json`）。去掉根处单调启动时间比较（`drop-start.node` 由当前源码只替换该行编出）：②的同一快照 **false→true**，第二阶段 delegated、1 main spawn、exit 0（`reuse-control.json`）。另：逐跳日历先后的去除以 r12 步骤 B 夹具 **false→true** 记录。 |
| §6 v4.5 ④：200 后坏 stdin 帧 | 模块集成 `package-manager-execution.test.ts` 的 late-invalid 行（真实 Node HTTP、严格 helper、真实 bash）：helper 非零、stderr `invalid-request`、整个 PGID 消失；随步骤 B 的 **2 pass / 23 expect**。 |
| 并发兄弟/后台/postinstall、复合安装、exec 形态 | `r12/concurrency.test.ts` **1 pass / 27 expect**：后台与 pipeline 兄弟各扫描 23 轮、可读 406 个同用户进程，postinstall 扫描 402 个，0 个凭据 hash、自身 3–9 号描述符为空；`false \|\| brew install jq && npm install` 的 brew 叶 1 次 main spawn（argv `install jq`，cwd 为项目），真实 npm postinstall 在围栏内运行；jq 已由 r10 的真实安装装进同一隔离 prefix，本行未重装（成功安装不重跑）；`exec brew --prefix; echo unreachable` 不输出 unreachable。所有 claim 时 helper 3–9 号无多余描述符。 |
| 标准流/退出/信号 | `r12/io.test.ts` **1 pass / 16 expect**：brew 无 8/9 号描述符；70 000 字节 stdout 与 stderr 完整；exit 17；自发 TERM 得 143。 |
| §6 ⑤ 启动文件抢读与解释器残留 | `r12/startup.test.ts` **2 pass / 16 expect**：BASH_ENV 启动文件读走一行 64 hex 凭据（hash 属本命令凭据集），真实 brew 叶 **126/unauthorized、0 main spawn**；`set \| reader` 读到 1 个凭据 hash（v4.4 已声明残留，不计为保密通过）；`export BASH_ENV/ENV/PS4/BASH_FUNC_*` 后 brew 环境中这些键为 `[]`、注入脚本未执行。r11 两项失败是 harness 缺陷（启动文件输出在被捕获子 shell 之外；首测失败后 `PROOF_STARTUP_STEAL` 泄漏到次测），本轮改为启动文件只写长度与 hash 的标记、并在 finally 清理，产品断言不变。 |
| HB 完整入口负向矩阵 + 撤除臂 | 隔离 HOME 内在固定全局安装前缀放真实样本布局（Apple Silicon 形态 `~/.npm-global`、Intel 形态 `~/.local/bin/brew -> ../Homebrew/bin/brew`；launcher 与 `brew.sh` 拷自 r10 真实 clone），仅本臂加入发现前缀。`r12/hb.test.ts` HB 臂 **1 pass / 43 expect**：launcher 追加/改名/换成软链/删除、Library 写/改名、Library 父节点改名、仓库节点改名、Intel 软链重指、Intel launcher 写共 **10/10 拒绝**，launcher sha256 与 Intel 链目标不变；同一 bin 的普通文件写入与真实 `npm install -g --offline --prefix ~/.npm-global <本地包>` 成功并可运行。撤除臂（只让 `homebrewFenceLocations` 返回空，发现与其余规则不变）**1 pass**：launcher 四项与 Intel 重指 **5 项变为成功**，其余 5 项仍被基础围栏拒绝（`hb-matrix.json`、`hb-matrix-removed.json`）。PATH 影子 brew（外写被拒）、项目 clone（exit 127）、`eval`、循环形态均 0 节点、0 claim、0 main spawn。 |
| 安全对照与生命周期（最终代码复跑） | r10 `security.test.ts` **2 pass / 17 expect**（r8 反例两次 unauthorized、外层 exit 1、0 spawn；同节点随后真实叶 delegated）；`lifecycle-run.ts` 四进程各 **1 pass**，共 **16 expect**（cancel/timeout/engine-disconnected/app-quitting 后无存活孩子）。 |

- P09 撤分流臂：未复跑（不分流路径自 r11 起没有代码变化）。r11 `p09-removal.json` 中围栏内的真实 FormulaInstaller 在 `Sandbox.run_or_fork` → `Utils.safe_fork` 绑定 UNIX socket 时被围栏 N1（`deny network*`）以 **EPERM** 拒绝、exit 1，早于 `sandbox-exec`，**未到达 P09 的 exit 71**。结论只记为"撤分流后围栏内安装在 Homebrew 沙箱路径上失败"，不冒称 exit 71。
- 未在本机证明的边界：生产 Team 证书签名的 helper/addon 与打包 Electron 身份（本机只有严格 adhoc hardened helper，不触发证书授权弹框）；真实 Electron before-quit GUI 事件（不启动窗口；生产 `stopPackageManagerExecutions` 已由 lifecycle app-quitting 行调用，before-quit 接线沿 r10 的 window-close 测试）。
- 观察（未改代码，交编排者）：H1 规划把同一控制流上值确定的变量引用也用在可执行位置——`b=brew; "$b" --prefix` 被识别并 delegated（1 main spawn，`hb-variable-program.json`），超出 R1-F3 字面钉住的识别形态；改成围栏内执行会让该用户的 brew 失败（新增限制），故不改。另：独立赋值语句（非 export、非前缀）的新变量名也进入 brew 环境（`engine/package-manager-plan.ts:42` 返回带 assignments 的状态，`:78` 合入节点），真实 shell 不会导出未曾导出的新名字。
- r12 最后检查：较宽直接相关 `gate slot -- bun test --max-concurrency 2 src/main/keychain-rename-native.test.ts src/main/mac-target-arch.test.ts` **44 pass / 113 expect**（生产脚本双片构建 addon、`_Sec*` 导入枚举不变、helper 打包）；`bun typecheck` exit 0；hooksPath `.githooks`；`affected-tests --list` **exit 2**（此基线缺 `.gate-tests`，无 scope 行）。未跑 gate run/bin/check/全包或计时用例，未启动应用/窗口，未 push/PR/merge。
- r12 步骤 D｜编排者处置（Claude Opus 5.5，2026-11-27）：观察 1（`b=brew; "$b"` 被识别）符合 design 约 :786 的确定变量引用解析，保留、不记；观察 2 作为本单保真缺陷修正。`engine/package-manager-plan.ts` 原把独立赋值语句（非 export、非前缀）记入节点 assignments，brew 因而拿到真实 shell 不会导出的新变量。改为：独立赋值总更新用于展开的 shell 值，只有已导出（快照中已有、`export` 过，或 allexport 打开）的名字才进入 brew 环境，值不可确定时标为未知；`export NAME` 导出当前值；`set -a/+a`、`-o/+o allexport` 跟踪 allexport。最低层红先：原计划测试文件新增一条，三条明示用例（`X=1; brew --prefix` 不见 X，`export X=1; …` 与 `X=1 brew …` 见 X）加真实 bash/zsh/`/bin/sh` 差分预言（同源码把 brew 位置换成 `/usr/bin/env`，比较 X/PATH/VALUE，9 条语料）。修前 **0 pass / 1 fail**（`X=1; brew --prefix` 得 X=1，`/tmp/fence1759-r12-env-red.log`）；修后 **1 pass / 112 expect**。撤除臂：去掉 allexport 跟踪，`set -a; X=1` 行 **1 fail**；去掉 `export NAME` 处理，`X=1; export X` 行 **1 fail**；恢复后文件逐字节一致。整文件 `bun test --max-concurrency 2 engine/package-manager-plan.test.ts` **6 pass / 275 expect**；消费方 `gate slot -- bun test --max-concurrency 2 src/main/package-manager-execution.test.ts` **1 pass / 3 expect**；`bun typecheck` exit 0；旧名 **10 pass**。`unset` 已导出名字仍无法用冻结的 `PackageManagerAssignment`（无删除项）表达，本次不改。

### 代码审查 R1 修正轮（fix round，2026-11-27，Claude Opus 5.5 实施）

- 输入：编排者 fix-round brief（切片一至四、切片五两份 Claude Opus 5.5 只读审查，FIX-THEN-MERGE，14 项）。
- 项 1｜main 不再在围栏外运行 PATH 上找到的程序。`shell-env.ts` 新增 `commandOnPath`（只做 JS 查找、不执行）与 `underGenerationFence`（darwin 下以最近一次计划的代际 profile 与命令环境，经与 Go 查询同一 `sandbox-exec … /bin/sh -c 'exec "$0" "$@"'` 形式运行；尚无计划时返回 undefined、调用方拒绝；非 darwin 无围栏、原样运行）；`planProductionFence` 用同一 context 喂 Go 查询并登记为代际围栏。`officialNodeCommand` 的两次 `which` 改为 JS 查找、`node --version` 在代际围栏内；`ext-ipc` 的 posix `which` 改为 JS 查找；`cloud-ipc` 的 `git diff` 在代际围栏内（仓库 hooks/`core.fsmonitor` 随之在围栏内）。红先：`shell-env.test.ts` 新例在 PATH 首位种下会向围栏外写标记的 `which/node/npx/git`，现有代码经真实 `officialNodeCommand` 写出 `which which node`，**0 pass / 1 fail**（`/tmp/fence1759-fx1-red.log`）；修后整文件 **3 pass / 55 expect**（无计划时拒绝；真实计划 profile 下版本检查与 git 都经 `sandbox-exec`、标记不出现）。撤除臂：`underGenerationFence` 改为直接运行，标记变为 `node `，**1 fail**；恢复后逐字节一致。`bun typecheck` exit 0；旧名 **10 pass**；platform **12 pass**。
- 项 1 同调用链：`test-component/official-connectors.cases.ts` 的 dbhub 用例原在没有代际计划时调用 `officialNodeCommand`（生产中总在计划之后），现于 `beforeEach` 用真实 `planProcessFence` 安装代际围栏（根在 iso 旁路目录，不碰用例自己的 HOME）。`gate slot -- bun test --max-concurrency 2 ./test-component/official-connectors.cases.ts`：改前 **10 pass / 8 fail**（dbhub 三例因无代际被拒），改后 **9 pass / 9 fail**，其中 8 例为 `beforeEach` 的 `mkdtemp` **ENOSPC**（本机数据卷 100%、约 230 MB 可用），1 例为 DBHub 真实 `npm install` 退出 1（用例忽略 stderr，满盘下无法区分 ENOSPC 与网络）。此前因无代际被拒的 dbhub 三例改后通过。GitHub I-11 例在不含本改动的代码上同样失败（"the real ext is not active in the embedded engine"，`/tmp/fence1759-fx1-github-baseline.log`），与本项无关。该文件需在磁盘恢复后重跑一次。
- 项 1 磁盘恢复后的复跑：`gate slot -- bun test --max-concurrency 2 ./test-component/official-connectors.cases.ts` **15 pass / 3 fail**。其一 DBHub 例越过真实 `npm install` 后在用例直接调用 `renderProcessFenceProfile` 处缺本单切片五设为必填的 `homebrewFence`（用例文件不在类型检查内）而 TypeError；补 `homebrewFence: []` 后该例 **1 pass / 14 expect**。其二 "actual Node >=22.5" 的 `TMPDIR=HOME` 排除断言：`officialRuntimeParent` 比较的是 `userInfo().homedir`，而用例 harness 的 HOME 在 `/private/var/folders` 下；用项 1 之前的源码（`81dd214615`，临时写回后 `git restore`）同样 **0 pass / 1 fail**（`/tmp/fence1759-fx1-node-baseline.log`），与本单无关、未改。其三 GitHub I-11 同前，属既有失败。
- 项 2｜启动时探针围栏准备失败不再终止启动。`server.ts` 新增 `startupShellProbeFence`（捕获 `prepareShellProbeFence` 的计划/代理/真源失败、记 error、返回 undefined）；`preferAppEnv` 接受 undefined，此时信任根仍由同一 `resolveShellProbeRoots` 恢复、密钥文件与 `XDG_STATE_HOME` 默认照常，只跳过登录 shell 探测/缓存合入；`index.ts:721` 改用该入口。引擎 fork 仍各自计划围栏，失败照旧拒绝。红：`server.test.ts` 新例（本文件无应用环境，真实准备即抛错）在现有代码上 **0 pass / 1 fail**（入口不存在；现组合在 `Effect.promise` 中拒绝即结束启动）；修后 **1 pass**。撤除臂：无围栏时仍探测，缓存标记 `cached` 被合入，**1 fail**；恢复后一致。整文件 `gate slot -- bun test --max-concurrency 2 src/main/server.test.ts` **55 pass / 224 expect**；`bun typecheck` exit 0。
- 项 3｜一条坏缓存不再让整份计划抛出。`planPackageManagerCaches` 按条处理：应用自有缓存（`<userData>/package-managers` 之下）路径上被换成软链的节点就地 unlink（不跟随）、由计划器在同一路径重建，R7 的 targetPath 不变；用户路径解析失败、Cargo 与保留位置重叠、真源拒绝，都只排除该条，其环境键同时去掉（不让工具指向未计划的位置）；Cargo 保留路径求不出目标时只排除 Cargo 缓存。数据锚点本身不合格仍整份失败。排除项随结果返回，main 记 warn。红：`process-fence-plan.test.ts` 三条新例在现有代码上 **0 pass / 3 fail**（"outside the application data anchor" ×2、"unresolved symlink"）；按 brief 把 :213/:225 两条旧"抛出"期望改为"一条坏缓存，计划仍成功"（根软链→就地重建、外部目录为空；GOCACHE 指向 HOME→计划与真源不变、HOME 内容不变），Cargo 用例里两处旧抛出期望改为"该条被排除、无规则覆盖保留目标、保留文件不变"。整文件 **45 pass / 291 expect**。撤除臂：去掉就地重建，两条应用自有例 **2 fail**；恢复后一致。`bun typecheck` exit 0。
- 项 4｜未安装的版本管理器位置不再被创建。`resolvePackageManagerLocations` 在唯一来源把 nvm/fnm/volta/asdf/mise 的模板与子路径条目标为 `onlyIfExisting`；`planUserWritableLocations` 只在其模板根（regex）或路径（subpath）已存在时绑定，pip 的 `~/.local/lib`、pnpm 与固定 bin 照旧。红：`process-fence-plan.test.ts` :44 旁新例在现有代码上 **0 pass / 1 fail**（无 nvm 时 `~/.nvm` 被建出）；修后整文件 **46 pass / 305 expect**（缺席的十处一个不建；已存在的 `~/.volta/bin` 仍可写、`~/.asdf/shims` 不可写；`~/.bun/bin`、pip 路径不变）。撤除臂：把"已存在"判为恒真，**1 fail**；恢复后一致。`process-fence-profile.test.ts` 精确钉住 volta 条目的一行机械补 `onlyIfExisting: true`，**47 pass / 399 expect**；`bun typecheck` exit 0。
- 项 5｜没有 Go 时不再每次子进程启动都跑一次受围栏的 `go` 并记 warn。`queryGoInstallTarget` 先用 `commandOnPath` 在命令环境 PATH 上找 `go`，找不到即返回 null（不 spawn、不记日志），`refreshGoEnvironment` 因而保持当前投影。红：`shell-env.test.ts` Go 查询例新增"PATH 上无 go 时不记日志"，现有代码记出 "Go install directory query unavailable"，**0 pass / 1 fail**；修后整文件 **3 pass / 57 expect**。撤除臂：去掉查找，**1 fail**；恢复后一致。`bun typecheck` exit 0。
- 项 2 补：`index.ts` 的启动探针入口改名为 `startupShellProbeFence` 后，两处按源码顺序钉住调用名的接线检查（`keychain-boot-order.test.ts:187`、`naming-migration-wiring.test.ts:71`）漏跑、显示 2 fail；机械改为新入口名，`gate slot -- bun test --max-concurrency 2 src/main/keychain-boot-order.test.ts src/main/naming-migration-wiring.test.ts` **21 pass / 92 expect**。顺序约束本身不变。
- 项 6｜应用补的根默认值不再写回 main 自己的环境。`resolveShellProbeRoots` 报出它填默认值的根键（`defaults`：用户未导出的 XDG_CONFIG/DATA/CACHE/STATE_HOME、OPENCODE_CONFIG_DIR）；探针子进程照旧拿到完整根，`applyTrustedShellEnvironment` 对这些键在 main 环境里删除而不写入，避免 `app.relaunch` 后被当成用户导出（Bun 根随之搬家）。`XDG_STATE_HOME` 的桌面默认仍由 `preferAppEnv` 第 3 步设置，与改前同值。红：`server.test.ts` 新例在现有代码上 main 环境得到 `XDG_CACHE_HOME=<HOME>/.cache`，**0 pass / 1 fail**；修后 **1 pass**（用户导出的 XDG_DATA_HOME 保留，探针 env 仍含缓存默认）。撤除臂：照旧写入默认，**1 fail**；恢复后一致。相关 `gate slot -- bun test --max-concurrency 2 src/main/server.test.ts src/main/shell-env.test.ts src/main/keychain-boot-order.test.ts src/main/naming-migration-wiring.test.ts src/main/shell-env-cache.test.ts` 在接线名同步后通过（见上条）；`bun typecheck` exit 0。
- 项 7｜未实施，接缝待定（SEAM-CHANGE-NEEDED，仅本项）。`ext/src/policy/index.ts:303` 在所有目标均为 `writable` 时把 external_directory 升为 allow；而冻结的 `WriteScopeReply`（design v4 §4.4 :596–613，`codepuppy-sidecar-messages.ts:753`）只有 `writable | needs-approval | protected | no-fence`，且 design :617 规定 `readWriteScope` 的 `writable` 同时涵盖 R1/R3 固定表、实际代际 profile（含 /tmp、缓存）与本运行目录授权（`server.ts:919-926` 正是如此计算）。R6（:593）只让固定 global/user-config 目标免问，表外目标保留 BR-08。ext 若自行判定固定表即复制 main 的唯一权威；把表外可写目标改报 `needs-approval` 会在全部批准档给已获准目录新增卡片，改报 `no-fence` 则改变冻结值的含义。最小接缝：`WriteScopeReply.targets[].outcome` 增一个值表示"由固定全局安装/用户配置表放行"（main 用计划的 `userWritableLocations` 规则判定），ext 只在全部目标为该值时升为 allow，其余 `writable` 保持引擎原效果，`needs-approval`/`protected` 不变。
- 项 8｜检查结论：可达，SEAM-CHANGE-NEEDED（仅本项，未发明修法）。一次真实探针（`r12/item8-path-probe.ts`，经 `gate slot`；只用隔离的 r10 Homebrew clone 与隔离 HOME/缓存，围栏外直接运行 brew，环境形同 main 的 H3 spawn：用户 PATH 以 `<prefix>/bin` 开头）在 `<prefix>/bin` 种下 69 个记日志后转交系统工具的包装脚本，再跑 `brew ruby` 与一次本地 tap 公式的真实 `brew install --build-from-source`（install 与 post_install 各自打印 PATH、`which("git")` 并调用 `git`）。结果（`r12/item8-path-probe.json` sha256 `2bc764b749f4…`）：Homebrew 自身 Ruby 的 PATH 为 `Library/Homebrew/shims/shared:/usr/bin:/bin:/usr/sbin:/sbin`，用户 PATH 只存为 `HOMEBREW_PATH`；构建阶段 PATH 为 `Library/Homebrew/shims/mac/super/bin:/usr/bin:/bin:/usr/sbin:/sbin`，`git` 解析到受 HB 保护的 Library 内 shim，种下的工具 0 个被执行；**post_install 阶段 PATH 为用户 PATH**（`<prefix>/bin:/usr/bin:…`，源码 `formula.rb:1745-1747` `PATH: PATH.new(ORIGINAL_PATHS)`，`global.rb:151` 取自 `HOMEBREW_PATH`），`which("git")` 为 `<prefix>/bin/git`，Homebrew 的 `post_install.01.git.log`（sha256 `52bbd7928c5c…`）记下 `PLANTED_TOOL_RAN git`，即种下的程序在围栏外被执行（其写我日志的那一步被 Homebrew 自己的 post-install 沙箱拒绝，程序本身照常运行）。生产中 `<prefix>/bin` 即 v4 §4.2 使之可由围栏内写入的 `/opt/homebrew/bin`。design v5 §5（:947）已把"可写 `/opt/homebrew/bin` 中被替换的工具链可能被围栏外 brew 调用"列为已声明残留、未增机制；是否维持该残留或另定接缝由编排者/设计决定。探针过程偏离：首轮 `brew uninstall` 在无 API 模式下自行克隆了 homebrew/core（公开只读下载，1.4 GB，进隔离 prefix），已按字面路径删除；后续两轮改为按字面路径移除探针 keg，并在 post_install 前放一个空的本地 core 仓库以免联网；种下的文件、公式与临时目录全部清除（`leftoverPlanted=[]`）。
- 项 9｜凭据写入改用 shell 内建。zsh 默认不开 POSIX_BUILTINS，`command printf` 执行外部 `/usr/bin/printf`，64 hex 凭据进入其 argv（同用户进程经 `KERN_PROCARGS2` 可读），违背 H4 第 3 步。`packageManagerExecutionSource` 接收 `shell`（main 侧本来就随 `PreparedShellExecution` 传入），bash/zsh 用 `builtin printf`，posix 方言保留 `command printf`。红：`engine/package-manager-plan.test.ts` 新集成例在 PATH 首位放一个记 argv 的假 `printf`，三种真实解释器各跑一次改写源；现有代码在 `/bin/zsh` 下假 printf 收到 `%s\n <64hex>`，**0 pass / 1 fail**；修后整文件 **7 pass / 281 expect**（三方言重定向矩阵不变）。撤除臂：恢复 `command printf`，zsh 行 **1 fail**；恢复后一致。消费方 `package-manager-execution.test.ts` **1 pass**；`bun typecheck` exit 0。r12 场景并发扫描未发现此泄漏，是因为外部 printf 只存活极短时间、扫描采样错过，不能当作反证。
- 项 10｜PowerShell 类 shell 不再按 posix 改写。`scripts/package-manager-build.ts` 把权限权威 `ShellSelect` 的 `META` 表投影进虚拟 scanner 模块并导出 `shellPs`（与已有 `shellName` 同一投影方式，源码漂移即构建失败，不另抄 pwsh/powershell 名单）；`planPackageManagerExecution` 对 ps 类 shell 返回 `[]`，原 spawn 照旧。红：`package-manager-plan.test.ts` 的 H1 例新增 pwsh/powershell 两行，现有代码规划出 posix 节点，**0 pass / 1 fail**；修后整文件 **7 pass / 283 expect**（含生产 config bundling 与同源 scanner 两例）。撤除臂：去掉早返回，**1 fail**；恢复后一致。`bun typecheck` exit 0。
- 项 11｜格式检查有了能失败的证据。原 `package-manager-execution.test.ts` 的 `G`×64 解码为空、由 `timingSafeEqual` 长度不符抛出被捕获，格式正则从未起决定作用。错误凭据循环新增"真实凭据的大写形式"（解码为同样 32 字节）：带正则时 126/unauthorized、0 spawn、节点保持 pending，随后真实叶照常领取，`gate slot -- bun test --max-concurrency 2 src/main/package-manager-execution.test.ts` **1 pass**。撤除臂：只去掉 64 位小写 hex 正则，大写凭据被授予、brew 运行（exit 17 ≠ 126），**1 fail**；恢复后一致。行为本身未改，故无独立红提交。
- 项 12｜argv/env/cwd 保真，以真实 bash/zsh/`/bin/sh` 为预言。先实测三种 shell：启动时都导出物理工作目录为 `PWD`（覆盖继承值），zsh 另导出 `OLDPWD=PWD`，bash/sh 丢弃继承的 `OLDPWD`；`cd`/`pushd` 后两者分别为新/旧目录并导出。实现：初始与每次 `cd`/`pushd` 设 `PWD`/`OLDPWD`（导出、进节点 assignments）；`cd -` 用 `OLDPWD`，相对目标在 `CDPATH` 非空或未知时为未知；`pushd` 仅单个非 `+/-` 操作数同 cd，`popd` 使目录未知；快照与源码之外的名字为未知（scan transform）；`unset NAME` 使其为空、取消导出、移出 assignments；未加引号且展开为空的词不产生参数（resolver 把普通词作为固定 `:` 命令的参数解析，以免孤立空词被当成空命令名而一律未知）；单个纯字面 `{a,b}` 列表在 bash/zsh 展开，其它花括号形态与 posix 方言为未知。红：H3 环境预言扩到 PWD/OLDPWD 与目录变更语料、新增 argv/cwd 预言（PATH 首位换成记 argv 与 `pwd -P` 的脚本），现有代码 **0 pass / 2 fail**（PWD 缺失；`$NOT_IN_SNAPSHOT` 被规划）。修后整文件 **8 pass / 487 expect**；旧例里断言 assignments 为空的三行改为只看命令自身赋值（隐式 PWD 由预言钉住）。撤除臂各 **≥1 fail**：空词规则、pushd、unset、初始 PWD、快照外名字未知。消费方执行测试 **1 pass**，`bun typecheck` exit 0。契约内未覆盖、如实留下：`unset`/bash 丢弃的快照内名字（如继承的 `OLDPWD`）仍会进 brew 环境——冻结的 `PackageManagerAssignment` 只能设值、不能删除，需接缝才可表达；起始目录含软链时真实 shell 的 `PWD` 为物理路径而计划用传入的 cwd；目录栈与多组/嵌套/序列花括号不建模（未知 → 原围栏执行）。
- 项 13a｜委派失败不再结束 Shell。`PreparedShellDelegate` 的唯一实现是 ext 的 `delegatePackageManagerShell`：授权失败（main 不可用、桥失败）返回 undefined，原 spawn 照旧；`cancel`/`finish` 是给 main 的通知，失败吞掉，Core 的超时 kill、remove 与完成不会因 `Effect.promise` 的缺陷而跳过（在 Core 再加一层 catch 将不可达，故不加）。红：`ext/src/hub-bridge.test.ts` 新例在现有代码上 **0 pass / 1 fail**（"the app could not prepare the package-manager execution"）；修后整文件 **16 pass / 62 expect**。撤除臂：去掉 cancel 的吞错，**1 fail**；恢复后一致。ext `bun typecheck` exit 0。
- 项 13b｜前导不再留下 xtrace 行。原前导第一句 `codepuppy_options_…=$-` 在关闭 xtrace 之前执行。改为在同一个静默组内先取 `$-` 再 `set +x`。红：H4 三方言 `-ax` 用例新增"stderr 不含 `codepuppy_options_`"，现有代码 bash 输出 `+ codepuppy_options_testid=ahxBc`，**0 pass / 1 fail**；修后整文件 **8 pass / 508 expect**（allexport/xtrace 恢复语义不变）；消费方执行测试 **1 pass**，ui-mac `bun typecheck` exit 0。
- 项 14｜检查结论：这些用例里不会发生委派，无需第四个参数；顺带修正本单切片五造成的引擎用例回归。三处两参调用：`plugin-entrypoints`、`package-hub-lifecycle` 不运行 Shell；`unattended-run` 只有 `session.shell`（用户 shell 不带工具调用身份，prepared hook 不触发）且无 shell 工具调用——临时加的计数断言实测 0 次授权请求，已撤回该断言与参数改动。检查中发现：切片五起 `ext/src/plugin.ts:138` 在 darwin 且存在 parentPort 时调用 `delegatePackageManagerShell(context.shell…)`，而共享引擎夹具 `test-component/codepuppy-engine.ts` 从源码装载 Core、没有生产构建（`scripts/build-engine.ts:77`）对 H2 七个文件做的 `packageManagerShellSource` 改写，`shell.delegatePreparedShell` 不存在 → ext 装载失败（"the real ext is not active in the embedded engine"）。修正：夹具以运行时 `Bun.plugin` onLoad 只对这七个文件套用同一改写（不另写接缝）。另 `unattended-run.engine.cases.ts` 对 `./codepuppy-user-workspace` 的局部 mock 缺 `codepuppyUserWorkspaceDir`，整文件无法装载（`81dd214615` 上同样，`/tmp/fence1759-fx14-baseline.log`），改为展开真实模块再替换 `saveVisibleOutputs`。证据（经 `gate slot`）：`bun test --timeout 90000 ./src/main/unattended-run.engine.cases.ts` 修前装载失败 / 仅补 mock 后 **0 pass / 1 fail**（ext 未激活），修后 **16 pass / 101 expect**；`bun test --max-concurrency 2 ./test-component/official-connectors.cases.ts` 由 15 pass / 3 fail 变为 **17 pass / 1 fail**，GitHub I-11 例转绿——**更正**本节项 1 复跑条目把它记为"既有失败、与本单无关"，实为本单切片五的同一回归；余下 1 例为 TMPDIR/`userInfo().homedir` 的既有失败。该夹具被 47 个用例文件共用，改动使其中带 parentPort 的引擎用例也走生产 H2 接缝（夜间层范围扩大，本轮只跑了上述两个文件）。`bun typecheck` exit 0；旧名 10 pass。
- 裁决 C-1（项 7，design §10 C-1 @ `ad5ee6c274`）｜`WriteScopeReply.result.targets[].outcome` 增 `"fixed"`（`codepuppy-sidecar-messages.ts` 类型与唯一 parser/build；HubBridge 用同一类型与 parser，无镜像）。`planProductionFence` 把经 R7 验证的 `userLocations.rules`（R1/R3 固定表）作为 `fixedWritable` 随计划交给代际；`readWriteScope` 在非受保护且命中固定表时报 `fixed`，其余可写来源仍为 `writable`。ext `evaluateDirectoryWrite`（即 `policy/index.ts:203` 注册的 evaluate hook 本体）：受保护 → deny；任一 needs-approval → ask；全部 `fixed` → allow；其它（/tmp、缓存、本运行已批准目录）保持引擎原效果（BR-08）。红：ext `identity.test.ts` 新例中请求审批档写 `/tmp` 类 `writable` 目标在现有代码上被升为 allow，**0 pass / 1 fail**；main `server.test.ts` 写范围例加入 `~/.zshrc` 固定文件，现有代码报 `writable`，**0 pass / 1 fail**。修后 ext `identity.test.ts` + `hub-bridge.test.ts` **36 pass / 139 expect**（桥端 `fixed` 往返），main `server.test.ts` + `codepuppy-sidecar-messages.test.ts` + `directory-write-approval.test.ts` **75 pass / 394 expect**。撤除臂：parser 去掉 `fixed`，桥端 **1 fail**（"invalid write scope result"）；ext 把 `writable` 也当 allow，R6 例 **1 fail**；均恢复。ui-mac/ext `bun typecheck` exit 0。
- 裁决 C-2（项 12 剩余，design §10 C-2 @ `ad5ee6c274`）｜`PackageManagerCommand` 增 `unset: readonly string[]`：源码 `unset NAME`（任一分支即计入）与 bash/sh 启动时丢弃的继承 `OLDPWD`；main 的 `nodeEnvironment` 先从快照删去这些名字、再套 assignments、再剥离固定注入键。`PWD` 取物理起始目录：main 以 `realpathSync.native(input.cwd)` 规划（与真实 shell 一致），仍经现有 assignment 表达。红：H3 环境预言加入快照名 `unset` 与带继承 `PWD`/`OLDPWD` 的起始快照（真实 bash/zsh/sh 各跑），现有代码 bash `unset VALUE; brew` 规划出 `VALUE=hello world` 而真实为缺席，**0 pass / 1 fail**；main 执行测试新增一行（软链项目目录、`unset HTTP_PROXY; brew stream`，经真实 helper/HTTP 由 main spawn 的启动器记录环境），现有代码 brew 仍得 `HTTP_PROXY`、`PWD` 为软链路径，**0 pass / 1 fail**。修后计划整文件 **8 pass / 904 expect**，`gate slot -- bun test --max-concurrency 2 src/main/package-manager-execution.test.ts src/main/package-manager-helper.test.ts` **2 pass / 23 expect**。撤除臂：main 不删 unset 名且用传入 cwd，**1 fail**（proxy 与 cwd 两处不符）；计划器不记启动丢弃的 `OLDPWD`，bash 预言 **1 fail**（得 `/inherited/old`）；均恢复。ui-mac/ext `bun typecheck` exit 0。此前项 12 记下的"快照内名字 unset 仍进 brew 环境"与"起始目录软链"两处缺口由此闭合。
- 裁决 C-3（项 8，design §10 C-3）｜维持 R1-P0 已声明残留，无代码改动；项 8 探针证据保留在上文，收窄提议由编排者回 intent。

### 合并 origin/alpha（d95580c825）后的语义修正（2026-11-27）

- 合并提交 `5847f36360`：15 个冲突文件按两侧行为合并（design.md 保留 alpha 全文并把 C-1～C-3 裁决节放在 v4.5 R1 处置之后；ext policy 保留 alpha 的 `externalRead` 与 `network` 参数并追加 `readWriteScope`；electron-builder 保留 alpha 的 ad-hoc `"-"` 签名与自定义 `sign`/`afterSign`，同时保留 helper 的 `signIgnore`（`MacTargetHelper.buildSignOptions` 把它编进 signer 的 `ignore`，alpha 的 `sign` 原样转交 `...options`）与 afterPack 中 mac 专属的 helper 严格签名；index.ts 只取 alpha 新增的联网批准接线，不重复本分支已前移的工作区真源块；gate-files 两侧行都保留）。重新实测并更新登记条数：hub-view 22、identity 20、process-fence-plan 46、shell-env 3、ext hub-bridge 18、package-manager-plan 8、codepuppy-sidecar-messages 17（junit 逐文件计数）。ui-mac/ext/core `bun typecheck` exit 0；`bun install` 后 hooksPath 复原为 `.githooks`。
- 语义冲突①：alpha #1758 改写了 `Shell.create` 的启动失败分支，H2 改写在 `core/src/shell` 的最后一个锚点（`.pipe(Effect.catchTag("AppProcessError", …`）消失，生产引擎构建同样会以 "Prepared Shell seam moved" 失败。锚点改到 alpha 的新首行，仍在原位置插入 `Effect.ensuring(delegate.finish())`；H2 集成测试的 PluginHooks 替身补 `has`（无 capture 钩子 → false，与真实 Core 一致）。`engine/package-manager-shell-transform.test.ts` 由 **0 pass / 1 fail**（锚点漂移）变为 **2 pass / 16 expect**。
- 语义冲突②（本分支切片五引入、合并后暴露于第二个夹具）：`test-fixtures/process-fence/engine-embed-driver.ts` 同样从源码装载引擎而无 H2 改写，#1531 三臂（带 parentPort）里 ext 装载失败。把项 14 加在 `codepuppy-engine.ts` 的运行时改写抽成共享的 `test-component/prepared-shell-seam.ts`，两个夹具都在装载 ext/引擎前调用。`gate slot -- bun test --max-concurrency 2 src/main/process-fence-engine.test.ts` 由 **4 pass / 3 fail** 变为 **7 pass**（中间一次 AC2 因标准输出/错误交错的顺序失败，重跑 7/7 通过，记为时序不稳定，未改断言）。
- 测试隔离：`shell-env.test.ts` 的"尚无计划时拒绝"断言在同一进程先跑过 `process-fence-wiring.test.ts`（生产计划器已登记代际围栏）时失败；新增 `__resetGenerationFenceForTests()` 并在用例开头调用，两文件同进程 **18 pass**。
- 未闭合：`unattended-run.engine.cases.ts` 的 U-3（只读自动化调用插件工具 `cp_probe`，期望被拒、run 为 failed）合并前 16/16 通过，合并后两次均 `ok`（**15 pass / 1 fail**）。alpha 上该文件因局部 mock 缺 `codepuppyUserWorkspaceDir`（alpha 的 `engine-internal-directories.ts` 也引用它）根本无法装载，alpha 自己的门从未跑到 U-3；alpha 的 gate/identity 改动中未见与只读拒绝直接相关的变化，根因未在有限排查内定位，交编排者。
- R2 Minor 1｜`join` 对 `unset` 取交集：只在两条路径都 unset 的名字才算确定，与 assignments 的合流一致（design :786）。红（`ba7b01bc08` 的真实 shell 预言）：`[ -n "" ] && unset VALUE; brew --prefix` 现有代码让 brew 失去 `VALUE`（真实为 `hello world`）；改后该行与真实 shell 一致，剩余红为 Minor 2 的引号操作数行。
- R2 Minor 2｜`unset` 的操作数按普通 shell 词解析（`word(raw.raw, state)`），`--` 结束选项，`-f`（函数）不改环境，其它选项或无法确定的操作数使本命令其余部分不规划（cwd 置未知，design :786）；删去 C-2 之后已失真的注释，改写为"main 在 spawn 前从快照删除"。红（`ba7b01bc08`）：Minor 1 修后 `unset "VALUE"; brew --prefix` 现有代码 brew 仍得 `hello world`（真实为缺席）。修后 `engine/package-manager-plan.test.ts` **8 pass / 1049 expect**（含 `unset 'VALUE'`、`unset -- VALUE` 与 `unset $NOT_IN_SNAPSHOT` → 不规划）。撤除臂：无法确定的操作数改为跳过，显式断言 **1 fail**；恢复后一致。消费方执行测试 **1 pass**，ui-mac `bun typecheck` exit 0。
- R2 可选项｜ext 的 `delegatePackageManagerShell` 在授权失败退回原 spawn 时记一行（每进程一次，`console.error`，即 hub-bridge 缺省 logger），便于诊断落回围栏内执行；行为不变。ext `hub-bridge.test.ts` + `identity.test.ts` **38 pass**（失败授权例打出该行一次），ext `bun typecheck` exit 0。

### 合并 origin/alpha（b8255b4695，`e6d4fa93b8`）后的门修正（2026-11-27）

- 基线对照：五个失败原因的符号（`delegatePackageManagerShell`、`installPackageManagerEnvironment`、`build-package-manager-helper`、`packageManagerScannerPlugin`、`codepuppy.package-manager.request`）在 `b8255b4695` 上 `git grep` 均无命中（exit 1），全部由本分支引入。
- ① ext（类 a）：切片五起 ext 在 darwin 且有 parentPort 时无条件调用 `shell.delegatePreparedShell`，而该接缝只存在于引擎构建（`scripts/build-engine.ts` 的 H2 改写，锚点漂移即构建失败）；从源码装载 Core 的宿主（ext 自己的 plugin-host 用例等）因此装载失败。改为宿主提供该函数时才委派，否则保持原 Shell spawn。`bun test --max-concurrency 2 --timeout 90000 src/plugin-host.test.ts` 由 **50 pass / 6 fail**（I-13、I-10×3、A3、D3/I-10）变为 **56 pass**；ext `bun typecheck` exit 0。
- ② ext 起引擎的两处调用（类 b）：本分支使 `engine-embed` 的 `packageManagerEnvironment` 钩子为必填（v4 切片二，main 安装缓存投影），`session-grant-restart.test.ts`（core permission.ts I-05）与 `upstream-probes/engine.cases.ts` 仍按旧钩子形状调用而抛 "invalid package manager environment"。两处与 ui-mac 共享夹具一致传 `{}`。六个起引擎的 ext 文件 **30 pass**（改前 I-05 与 upstream-probes 四例失败）。
- ③ release-source（类 c）：`#1631` 真实 beforePack 用例把 `electron-builder.config.ts` 的本地 import 闭包复制进临时检出；切片五给配置加了 `scripts/build-package-manager-helper` 与 `src/main/package-manager-helper`，其闭包另含 `scripts/build-fence-addon.ts`、`src/main/process-fence-apply.ts`（均只依赖 node 内建），清单未登记而 "Cannot find module"。补登四个文件，`src/main/release-source.test.ts` 由 **8 pass / 6 fail** 变为 **14 pass**。
- ④ 生产 main 构建（类 a，`#1572` AC4 真栈失败的原因）：scanner 虚拟模块 id 为 `\0codepuppy-shell-scan.ts`，而 vite 的 esbuild 变换用 `createFilter`，后者跳过所有 `\0` id，于是 electron-vite 的 main 包把 `scan.ts` 的 TypeScript 原样交给 Rollup（`Expected '{', got 'type'`，`export type OpaqueReason`）。改为无 `\0` 前缀的 `/virtual/codepuppy-shell-scan.ts`（load 仍由本插件提供，不读盘）。红：`engine/package-manager-plan.test.ts` 的生产 config 用例新增用配置里的同一插件实例跑一次真实 vite SSR 构建，改前同一 `PARSE_ERROR`，**0 pass / 1 fail**；改后整文件 **8 pass / 1050 expect**；`bun test-fixtures/net-failure/build-main.ts` 生产 main 包由失败变为 `✓ built`（726 modules）。旧用例硬编码 `\0` id 的一行改为向插件取 id。
- `#1572` AC4 真栈：由 ④ 修复，`gate slot -- bun test --max-concurrency 2 --timeout 90000 src/main/net-failure-real-stack.test.ts` **5 pass / 33 expect**（三个生产构建全部通过）。
- 沙箱拒写 shell 行（基线已红，未在此修）：`gate slot -- bun test --max-concurrency 2 --timeout 300000 src/main/fence-write-denied.engine.test.ts` 在本分支 **3 pass / 1 fail**（shell 行 60 s 超时，"killed 1 dangling process"）；去掉夹具里的 H2 改写（ext 不委派）同样 3/1；把工作树临时切到 `b8255b4695`（stash 后 detach，跑完切回并 pop）运行同一宿主测试，同样 **3 pass / 1 fail**、同一行 60 s 超时。该失败属 alpha 自身，交编排者。
- ⑤ 共享引擎夹具的假 main（`test-component/codepuppy-engine.ts`）原先只答 hub 视图/请求/检索；本分支使夹具引擎带 H2 接缝后，ext 对每个 shell 工具调用发出的 package-manager 授权请求无人应答，要等桥的 20 s 超时才退回原 spawn（上面基线对照之外的独立问题，日志中 "authorization failed" 行即由此而来）。假 main 现按生产 main 对无包管理器围栏代际的答复 `{ ok: false, error: "unavailable" }` 立即应答。

### 合并 origin/alpha（c35c173062，`620db89286`）后的门修正（2026-11-27）

- 现象：门日志中 `process-fence-engine.test.ts` 的 AC2 以 0.28 ms 失败，`Received` 为 shell 自己的报错行 `zsh:1: operation not permitted: …/esc/shelltool-fenced.txt`，即报错排在了 `done` 之后。0.28 ms 不是前置失败：AC2 只对上一用例（围栏臂）已捕获的工作负载做断言，同一用例里"围栏臂已跑成"与"报错点名界外文件"两条断言都已通过。上文合并 `d95580c825` 一节记为"时序不稳定、未改断言"的正是同一原因，此处更正为确定的缺陷并修复。
- 原因：Shell 服务把 `handle.all` 写进输出文件（`core/src/shell.ts:428`），`all` 是两根管道按到达顺序的合流（`util/src/cross-spawn-spawner.ts:370`，`Stream.merge(stdout, stderr)`），不保留程序写出顺序；AC2 以"最后一行是 done"证明"命令跑到了最后一句"，依赖了两条流的交错。
- 红（产品合流处）：用 `CrossSpawnSpawner.node` 的真实 spawner 按 AC2 的命令形状（界内写、只读目录写、`echo done`）在 `gate slot` 内 16 并发跑 400 次 zsh，读 `all`：两根管道 **343/400** 最后一行不是 `done`（样本 `done\nzsh:1: permission denied: …`）；命令前加 `exec 2>&1;` 后 **0/400**。整文件不改时在负载下（同一 `gate slot` 内 4 并发 × 3 轮）12 次均通过，竞争在完整引擎下概率低，因此红证取自产品合流处。
- 修：工作负载命令以 `exec 2>&1;` 开头，shell 报错与 `done` 同在一条流、按程序顺序记录。AC2 的五条断言不变（报错点名界外文件、界内文件无报错、最后一行 `done`、退出码 0、无 `sandbox_apply`），对照臂仍断言输出恰为 `done`、无 not permitted；`exec 2>&1` 只是 fd 复制，不写文件，不改变围栏下的落盘结果。
- 绿：`gate slot` 内两份并发 × 3 轮，`bun test --max-concurrency 2 --timeout 90000 src/main/process-fence-engine.test.ts` **6/6 次 7 pass / 0 fail / 41 expect**（与登记条数 7 一致）。
