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

- 依据：[SPEC-child-process-write-fence v2 / AC-05 至 AC-08](https://github.com/impharaon/alpha-code/blob/8593c2701d94d29b9a5de3de1db44639220fb637/docs/specs/child-process-write-fence/spec.md)；[设计 §4、§5、§6、§10 / cadd657d29](https://github.com/impharaon/alpha-code/blob/cadd657d2925f686bd34045d5274d1007b5c18e4/docs/specs/child-process-write-fence/design.md)；2026-11-19 PLAN 派单及其 Decided point 5。读码基线为本集成分支 `4f61fde5de`，不把该分支现有 v1 spec 当作 v2 输入，也不复制尚待合入的设计。
- 核对：Phase: IMPLEMENT — plan 6a1e42753b · orchestrator / Claude Fable 5.2 · plan check passed (every AC has proof with a failing arm; the three extra same-call-chain files `main/index.ts`, `ui/codepuppy-composer.tsx`, `ui/session-rail/terminal/terminal-engine-adapter.tsx` are accepted as necessary; no decision restated or changed). 2026-11-19 续派仅授权步骤 1/G0；native/profile/grant 契约沿用 cadd657d29，见证点尚待修订，不实施步骤 2–8。V2 按每臂实际落盘和 `r1-x2all-result.txt` 判定，不能要求所有签发都返回 NULL。

本阶段只提交本文件。下表和命令均为实施安排，不代表已经运行或通过；文档影响归类为 architecture/decision，当前落点只有本计划。后续实现沿用现有组件形态，不增加界面状态或交互稿。

### 改动

路径前缀 `main/`、`preload/`、`renderer/` 均相对于 `packages/ui-mac/src/`；`ui/` 表示 `renderer/codepuppy-ui/`。

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/native/codepuppy-fence/codepuppy_fence.c` | 实现设计 §4 的两个原生导出、参数校验和错误返回，复用现有 libsandbox 装载；不动钥匙串实现。攻击辅助 C 程序仅供测试，放同目录，来源见下文。 |
| `main/process-fence-apply.ts` | 对齐 `FenceAddon` 和加载校验；现有 apply 双向自证继续执行。 |
| `main/process-fence-profile.ts` | 落实设计 §4 profile 增量；抽出并集规则 4/5/5b 的逐候选判定供登记复用；写根 ID 登记 X1，类名只有此处一份。 |
| `main/process-fence-workspaces.ts` | 在既有真源权威内实现资格、深链接记录和登记后的重算；真源过滤复用该资格，保持原有文件形状、排序及检疫处理。 |
| `main/workspace-write-probe.ts` | 承载设计 §4 的 grant 消息、解析和请求簿；区分 sidecar 真写探针事实与 main 汇总的放行结果，避免让 sidecar 伪造资格；保留未知错误的原文。 |
| `main/sidecar.ts` | 生产消息循环消费 grant 并回答；与引擎 ready 解耦，保持 apply 在引擎 import 之前。 |
| `main/server.ts` | 绑定当前 child/pid 的签发、请求簿接线、按代引擎放行成功账本及并发同目录请求合并；退出清理在途请求，失败不记成功；日志不含令牌。 |
| `main/ipc.ts`、`preload/index.ts`、`preload/types.ts` | 既有 probe 请求升级、选择器登记及返回顺序、资格变化通知；形状校验和失败映射依设计 §4，不新增第二条登记 IPC。 |
| `main/deep-link-queue.ts` | 在 decode 后、交付前记录目录；保留 argv / second-instance / open-url 共用 ingest 和既有队列所有权。 |
| `ui/workspace-writable-core.ts`、`ui/workspace-writable.ts` | 步骤 4 独立实现见证点、首次目录冻结、草稿发送关联、含 server 的缓存、通知失效及 `whenSettled`；标记与原因选择共用一处判定。 |
| `ui/CodePuppyHome.tsx`、`ui/codepuppy-new-session.tsx`、`ui/session-workspace/codepuppy-session-workspace.tsx` | 三个宿主提供设计规定的真实 server、入口键和 chip 选择序号；接入共享结果，去掉工作区重启回调。 |
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
| `ui/codepuppy-composer.tsx` | 真实发送分叉在 `:1828-1847`，随后分别走 `startChat`、prompt、command；在这里调用共享 `whenSettled` 并记录发送草稿，三个页面上的 `onSubmitted` 都已经太晚。不改发消息协议。 |
| `ui/session-rail/terminal/terminal-engine-adapter.tsx` | `useCodePuppyTerminalEngineChannel` 是首页与会话共用的生产铸造点（`:164-185`），创建最终经 core `:125` 的 `engine.new`；在适配器包装现有 create 调用等待共享结果，不改 channel 公共形状，不阻断已有终端输入。 |

### 顺序

1. **G0：出货形态入口闸，独立提交单元、独立通过/失败记录，先于其余实现。**
   - 先提交 `main/process-fence-extension-packaged.test.ts` 宿主与同名 `.cases.ts`、必要测试辅助源码；在旧实现运行，保存缺失导出/无法运行期放行的红证据。随后只落闸所需的生产原生导出、profile、grant 合同及 sidecar 消费接线，不提前做资格、renderer 或文案。
   - 按 [distribution.md](../../runbooks/distribution.md) 的 `build` / `package:mac` 路径本地打包：在 `packages/ui-mac` 用 `OPENCODE_CHANNEL=dev bun run build`，再以 `CODEPUPPY_SIGN=1`、签名身份哈希运行 `OPENCODE_CHANNEL=dev bun run package:mac --dir --publish never -c.mac.notarize=false -c.directories.output=<scratch>/packaged`。使用生产 hardened runtime、entitlements、fuses 和资源 `.node`；dev 只用于隔离身份及本地包，不冒充 prod release，不改发布源校验。签名日志先脱敏，结果只记录身份哈希、验证退出码、runtime flag、资源 buildId/摘要与 entitlements 比对，不打印身份名称。
   - 宿主从打包资源启动测试 main harness、生产 utilityProcess sidecar 和生产 `.node`，harness 的非产品接线只留测试中/临时包内。若需要给临时包加入 harness，完成修改后按同一签名规则重新签名再验证；不得用未签名修改后的包作证。
   - A 目录已在 W1，B/C 不在任一启动写根：sidecar 起子进程并等其 **exec 后 ready**；同一子进程在放行前写 B 失败；main 通过生产 `.node` 绑定 sidecar pid 签发，生产 sidecar 消费后，已有子进程和新子进程写 B 成功，C 仍 0 文件。另跑不消费对照，B/C 均 0 文件；覆盖自签矩阵和复制令牌跨进程失败，详见 V2。
   - 入口命令：`cd packages/ui-mac && bun test src/main/process-fence-extension-packaged.test.ts`。记录每一臂实际文件清单、pid、ready/consume/write 的顺序和退出码。G0 任一必要臂失败即返回 `BLOCKED: design — G0 — <失败步骤与脱敏原文>`，不继续步骤 2，不改路线；不能把普通 C、Bun 或 `ELECTRON_RUN_AS_NODE` 的成功替代本闸。
2. **固化底层防护与登记簿。** G0 过后扩充 `process-fence-profile.test.ts`、`process-fence-apply.test.ts` 和新 `main/process-fence-extension.test.ts` 宿主/`.cases.ts`；跑 V1/V2 全矩阵及路径语义负例。同步 X1 根登记和探针 `W1+X1`，运行检查组 A。新增检查先提交红测试，再提交实现，不在实现提交改掉红测试。
3. **main 资格、真源与运行期放行。** 先加资格/真源和 IPC 的红用例；实现 workspaces、deep-link、server、ipc、preload 及必要 index 接线。新 `main/project-writable-ipc.test.ts` 起同名 `.cases.ts` 隔离 Electron mocks，实际调用生产 handlers、队列、tracker 和 server 监听器。覆盖 picker 返回顺序、同时重复请求、超时/退出/异常、失败后成功通知、tab 先写后登记、检疫与深链被 picker 覆盖、远端不触达本机。运行检查组 B。
4. **单一见证点，独立提交单元。** 严格依设计 §4「单一见证点」实现三个宿主和共享核心；本步承接 R2 若有的局部 delta。`workspace-writable-core.test.ts` 验入口首次解析、激活采样、同入口 SSE 变目录、无激活重载/恢复/重挂、草稿转会话替换、跨 server 缓存、通知与迟到答案。新 `ui/workspace-writable.component.test.ts` 宿主启动 `test-component/workspace-writable.cases.ts` 真挂三个宿主；真实 Chromium 激活与深链防护由步骤 7 补证，happy-dom 的注入不能作为可信激活证明。
5. **首次工作的顺序。** 在上表两个真实调用点接共享 `whenSettled`，使用提交时冻结的 server/directory；延迟内、超限、切换身份和远端/无围栏各有用例。实际 prompt/startChat/command/terminal create 必须在约定等待之后，不以禁用按钮、隐藏 composer、重挂终端或改发送 API 实现。跑检查组 C；真引擎顺序在 V3 再核。
6. **残余界面与本分支临时拒写提示一起收敛。** 先提交正常可写路径、三种残余状态及时间线旧按钮的红测试，再改壳、chip、双语文案和 interim 消息；跑检查组 D。
   - 模型提示不再说启动时定死、重启后才可写或有重启按钮。已证实目标属于未亲手打开目录时，说明该事实，要求不要绕过、停止并告诉用户可用「打开项目」选中。
   - **最小归因规则：裸 `EPERM` 或 shell 的 `Operation not permitted` 只证明操作被系统拒绝；相对路径只能按真实工具输入/位置解析，缺目标不得拿会话 cwd 代填。** 没有确切资格/可写事实时，模型收到中性的停止说明，对「未打开可用打开项目」采用条件句；用户侧只显示一次写入失败的事实句，不断言沙箱、未打开或重启可治。已拿到设计的确切 `reason` 时复用对应残余句。不能为文案新增 roots 清单、副本判定或跨层权限 API。shell 未知目标、可写根内的非围栏 EPERM 必须有反例；不得把未知错误变成用户的错误原因。
   - `WriteDeniedNote` 保留单句且无按钮；删除 timeline `relaunch` intent、其接线与测试 runtime 中旧动作。模型停止提示仍经登记过的 tool-failure sink 注入；在 `packages/ext` 执行 `bun scripts/context-injection-inventory.ts --write`，用实际 inventory 输出更新库存快照。
7. **真引擎与真实窗口整链验据。** 新 `main/project-writable.engine.test.ts` 宿主启动同名 `.cases.ts`，复用现有 engine sandbox、scripted model、真实 ext 和生产启动路径。跑 V3/V4/V5 及已知坏臂；窗口用隔离签名包的真实 Chromium，CDP 观测 DOM/导航与可信输入，不能用脚本派发 click 代替人的激活。最终生产接线变化后重跑 G0/V7，记录放行往返 p50/p99；本机模型桩不使用真实账号。
8. **事实文档、计数与收口。** 同步设计 §6 点名的架构/I1 事实，保留旧实验历史；更新本节偏离记录。仅对新增/变动检查同步 gate 行、精确子用例计数、调用点登记与 injection 库存。运行涉及包的 `bun typecheck`、`git diff --check` 及本节列出的受影响检查；不运行全仓 suite/full gate。提交后交编排者做独立 review、push/PR/merge。

### 风险

- **私有 SPI 的出货可行性**：现有 C 实验不能替代签名 Electron 的 mach 权限与继承；G0 将此风险放在资格/UI 实施前。测试按实际落盘判定，不能仅看 handle 或 rc；E5 中 `flags=0x1` 可返回 handle=0 但不放宽，旧 related-file 五参程序会崩溃，须用 `r1d.c` 已核的六参版本。
- **授权见证仍待 R2 冻结**：步骤 4 单独承接变化；计划不推导另一套见证，也不提前把页面目录变化当成用户动作。只有冻结后的设计才是实现输入。
- **缓存、代次与顺序**：通知后旧的 pending 回复可能盖掉新答案；同目录并发可能重复签发；等待期间 server/会话可能切换。测试直接观测请求、写盘、pid 和完成顺序，并保留同代先拒后选的窗口，不靠睡足固定秒数判绿。
- **测试布局假绿**：`/private/tmp`、`/private/var/folders`、模拟 HOME 的 `.cache` 等可能本就被 W 行允许。B/C 必须放在独立 scratch 下、位于模拟 HOME/XDG/状态根之外，放行前实写校准 EPERM；宿主负责最终读盘。复用测试隔离预载，但在预载执行前安排其 TMPDIR/隔离根，避免落入系统临时目录；不改全局预载。
- **拒写归因**：TCC/文件权限与围栏可能同为 EPERM；shell 无可靠目标。步骤 6 的中性分支保留停止能力，不把 errno 当作资格证明；不引入一份 ext 的可写根真源。
- **实机纪律**：scratch、日志、临时 app 都在 `~/.cache/alpha-orch/2026-11-19/impl-project-writable/`，开始及大构建前检查空闲 ≥8 GB。仅用临时 app 可执行文件启动，隔离 userData/HOME/XDG/DB，后台隐藏，不经 `open`，结束 `lsregister -u` 注销该副本；不触及 `/Applications/Code Puppy.app`、其数据、凭据或登录动作。令牌只在内存消息中，报告/日志/argv/env/磁盘都不落令牌。
- 真实引擎遇 `ENOTCACHED`/`spawn_failed` 先按命名包 `npm cache add` 后重跑，再分类；所有长命令前台完成。若有其它 full gate 在跑，测试并发最多 2；不以本 lane 运行 full gate。

### 证明

验据编号沿用派单。`cadd657d29` §6 显式列 V1–V6b；旧稿 `15a54fe1a6` 的 V7 为出货形态，本节以 **V7/G0** 对照其已提升的入口闸，并在最终接线后复验，不另增设计条款。

| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-05 | **G0/V7**：`main/process-fence-extension-packaged.test.ts` → 同名 `.cases.ts`，签名 main + 生产 utilityProcess/.node/profile；前后已有/新 child、C 目录负例；最终接线复验，放行耗时 p50/p99 和每次目录/结果的一行日志。 | 无 X1、签发或消费时 B 不落盘；去围栏时 C 落盘；不消费对照与正臂的结果必须不同。去进程绑定由 V2 的回放负例抓到。runtime/签名/生产路径不符即不能通过 G0。 |
| AC-05 | **V3**：`main/project-writable.engine.test.ts` → 同名 `.cases.ts`；picker、项目列表/chip、侧栏进入项目/会话逐入口；真模型桩调 write 和 shell，放行前已 exec 的 PTY 与 MCP stdio 写 B，之后新工具/终端也写 B。保留另一个流式回答，比较引擎 pid/代号、renderer 文档身份、流完成及取消事件；放行人为延迟但小于 1 s 后立即发首条/建首终端。 | 不放行臂同一写 EPERM 且 B 0 文件；去消费/去首次工作等待各使对应落盘或事件顺序断言失败；偷偷换代、reload 或取消别的回答会被独立观测量抓到。 |
| AC-05、AC-08 | **V4**：同一 engine 宿主整链；同代同 renderer 先通过深链进入 B 被拒，再经 picker（含 `CODEPUPPY_OPEN_DIR` harness 路径）选 B，第一轮重问和实际落盘；另测 tab 写回先于登记。 | 去选择器登记/放行或去 changed 通知/缓存失效时仍缓存拒绝，第二步不能落盘；不得靠换代或新建 renderer 消掉旧缓存。 |
| AC-06 | **V6a**：`workspace-writable.component.test.ts` 及现有 `codepuppy-session-workspace.test.ts`、`new-session-workspace.component.test.ts`、`session-timeline.test.ts` 的真组件子进程；正常可写三个宿主两钩子均缺席；真实窗口复验整个应用无指定重启按钮。另作 renderer 生产源码/i18n 的该按钮与旧 copy-key census，覆盖未挂载分支。 | 已知坏：恢复任一只读钩子/旧按钮/时间线 intent 时，DOM 或全生产面 census 必红；只断言 state boolean 不作界面证据。 |
| AC-07 | **V1**：现有 `process-fence-profile.test.ts` 逐行形状及新 `process-fence-extension.test.ts` 的实际自签；X1/X2 与五操作逐项覆盖。 | 去 X2 后 file 自签落盘、把 X2 改成只禁 file 后 generic 自签落盘；两种坏 profile 都必须被安全判官拒绝。 |
| AC-07 | **V2**：extension 宿主/`.cases.ts` + G0 的 Electron 内嵌 Node/生产 .node；E5 可用 file/to-self/to-process/by-pid、related-file、generic、mach、iokit、flags、旧苹果类、update-file；伪造令牌、错误进程、未围栏进程、退出后的另一代回放；软链进/出与大小写。posix-ipc 无签发导出如实声明，形状/编译仍覆盖其操作名。 | 伪造消费失败且目标 0 文件；改为不绑定进程的签发后另一进程回放落盘，判官必红；认苹果类/移除对应签发 deny 会使各自坏臂被检出。软链跳到 C 仍 0 文件。不能把签发返回非空本身当越界成功。 |
| AC-07 | **V5**：engine 整链 + `project-writable-ipc.test.ts` + `workspace-writable-core.test.ts`；当前会话 DB 的 directory 改为 X，SSE/同入口刷新、逼一次自愈和 renderer reload，读取真源与实际 X 文件；用户刚点别处的激活窗内深链三来源打开 X；远端同名本机目录；sidecar 发伪造 open/grant 消息。 | 逐保护运行坏臂：去入口首次目录冻结或把新文档视为有激活、去真源资格过滤、去深链记录、去 local-server 检查、加入反向签发路由，各使相应测试红。记录登记/签发调用和 X 0 文件，不能只查消息类型或只查集合。崩溃测试仅影响隔离引擎。 |
| AC-08 | **V6b**：上述组件宿主和 IPC 宿主；HOME/状态根、仅深链目录、放行失败三组；失败包含原生异常/错误 step、无活 child/退出、请求簿超时及 IPC 意外拒绝，probe 的 denied/unknown 两种回答；每组一句、无按钮；深链组续做 picker 后可写。 | 吞异常/仅在 probe=denied 显原因的坏臂会缺句；恢复旧标题/脚注/按钮会多出元素；失败缓存成终态会挡住 picker 后成功。HOME/祖先/状态根负例仍不得登记。 |
| AC-06、AC-08；拒写后停止能力 | 现有 `fence-write-denied.engine.test.ts` → `.cases.ts`，新 `packages/ext/src/policy/display.test.ts`，`context-injection.test.ts`，时间线组件；真引擎拒写结果仍给模型停止指示且无重启字样；已知未打开与未知路径/根内非围栏拒绝分别验证措辞，成功写无提示。 | 去 `attachWriteDenied`/去停止指示时模型收到的工具文本断言红；恢复重启文案或把裸 errno 断言成未打开时负例红；恢复 timeline 按钮/intent 时组件红。无需用真实 TCC 授权弹窗制造权限变化。 |

夹具来源：SPI 矩阵与控制臂来自派单只读目录 `~/.cache/alpha-orch/2026-11-19/fence-ext/` 的 `src/{r1,r1b,r1d,r2,r2b}.c`、`r1-x2all-result.txt`、`r1d-result.txt`、`r2b-result.txt`（使用 `r1d` 六参修正）；签名普通程序读数见 `rc-hardened/`，只作先验。引擎/MCP/PTY/工具错误使用现有 `process-fence-engine.test.ts`、`fence-write-denied.engine.cases.ts`、`test-component/codepuppy-engine.ts` 运行得到的真实输入输出；新增案例记录采集入口和 buildId，不手写另一系统 payload 替身。R1 处置继承设计 §10，原始审查文本为同日 `review-project-writable/out.log`。

**相关检查命令（全部从包目录执行；只传宿主 `*.test.ts`）：**

- A：`cd packages/ui-mac && bun test src/main/process-fence-profile.test.ts src/main/process-fence-compile.test.ts src/main/process-fence-plan.test.ts src/main/process-fence-apply.test.ts src/main/process-fence-write-sites.test.ts src/main/process-fence-extension.test.ts src/main/workspace-write-probe-fence.test.ts`。
- B：`cd packages/ui-mac && bun test src/main/process-fence-workspaces.test.ts src/main/workspace-write-probe.test.ts src/main/process-fence-wiring.test.ts src/main/codepuppy-sidecar-wiring.test.ts src/main/server.test.ts src/main/deep-link-queue.test.ts src/main/deep-link-wiring.test.ts src/main/ipc-channel-binding-census.test.ts src/main/project-writable-ipc.test.ts`。mock server/加载器新增导出需要同步其假件，保留各自独立宿主隔离。
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
- 实施偏离：暂无。后续每次偏离与代码在同一提交更新本节并记录原因、相关 AC 和提交。
