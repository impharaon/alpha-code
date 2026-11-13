# alpha-code documents

<!-- documentation-contract: v4 -->

Active work is owned only by [alpha-code Issues](https://github.com/impharaon/alpha-code/issues)
and [Alpha Delivery](https://github.com/users/impharaon/projects/2). Current
runtime behavior comes from code, tests, schemas, packaged resources, and
accepted contracts. Follow the [Code Puppy Documentation Contract](https://github.com/impharaon/alpha-work/blob/main/governance/documentation-standard.md).

| Need                                                                 | Canonical source                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| System structure and upstream boundary                               | [`architecture/`](architecture/)                                     |
| Code Puppy product authority, token renewal, independent MCP startup, and upstream takeover design | [`design/codepuppy-runtime-authority.md`](design/codepuppy-runtime-authority.md) |
| REQ-236 T07–T10/§2.4 + REQ-237 baseline: catalog refresh off the respawn path, picker and engine on one applied catalog, remote platform display and BYOK presets, brand icons, update prompt, explicit model selection | [`design/req236-catalog-and-model.md`](design/req236-catalog-and-model.md) |
| REQ-236 引擎生命周期方案基线:续期热应用凭据而不重启引擎(实测正式版每 10 分钟一次 token-only 换代)、MCP 逐服务后台启动与失败归因(`spawn uv ENOENT` 实为陈旧实例目录)、Office/PDF 随包运行环境、上游同步遵守接管清单;子票切分与冻结接口 | [`design/req236-engine-lifecycle.md`](design/req236-engine-lifecycle.md) |
| REQ-236 cloud image generation, host-owned result delivery and session ownership, and document attachments (T12–T17 parsing half) | [`design/req236-results-and-attachments.md`](design/req236-results-and-attachments.md) |
| REQ-236 T01–T04/§2.4 baseline: real boundaries of the three run-permission tiers (incl. the sub-task bypass), "always allow" by grant kind, approvals bound to post-hook args and current binding, cloud tool provenance under the real injected shape, controlled config fields and project-config override paths | [`design/req236-permissions-and-provenance.md`](design/req236-permissions-and-provenance.md) |
| REQ-236 T20 方案基线:App 三个进程各怎么联网(没有在线判断;引擎出网只经本机出网代理,代理直连拨号)、网页读取/搜索本地与云端两条腿在 0.1.22 的真实状态(`#1414` 代码齐、AC1/AC2 证据未齐)、owner 日志实测「CONNECT 200 之后零回应」与它被归成普通超时;选定让出网代理按层交出状态码、在引擎与 main 的结算边界(信息丢失前)取层并一路带到上屏文案,15 s 静默隧道兜底,以及对生命周期 #2 / delivery lane 的接口依赖(含 Codex 方案审 R1 处置表) | [`design/req236-network-diagnosis.md`](design/req236-network-diagnosis.md) |
| Host extension package contract/host decision boundary               | [`architecture/host-extension-package-contract-boundary.md`](architecture/host-extension-package-contract-boundary.md) |
| Code Puppy Connection record lifetime and handler allowlist               | [`architecture/codepuppy-connection-lifetime.md`](architecture/codepuppy-connection-lifetime.md) |
| Package MCP OAuth ownership boundary (engine protocol / main attempt) | [`architecture/package-mcp-oauth-boundary.md`](architecture/package-mcp-oauth-boundary.md) |
| Which quality gate really runs in which environment (and where the environment is declared) | [`architecture/quality-gate-environments.md`](architecture/quality-gate-environments.md) |
| How many components a real Claude plugin becomes (measurement rule + distribution) | [`architecture/claude-plugin-corpus-component-scale.md`](architecture/claude-plugin-corpus-component-scale.md) |
| What the engine's `command` is, what its event/hook surface is, and how Claude's hooks actually map | [`architecture/engine-command-and-event-surface.md`](architecture/engine-command-and-event-surface.md) |
| Which signals really say a directory's model catalog converged (and which only look like they do) | [`architecture/2026-08-10-catalog-readiness-signals.md`](architecture/2026-08-10-catalog-readiness-signals.md) |
| What the packaged first launch actually spends after sidecar ready (measured split, and what is still unverified) | [`architecture/2026-08-10-packaged-first-launch-catalog-cost.md`](architecture/2026-08-10-packaged-first-launch-catalog-cost.md) |
| 工具子进程的当前边界与已退役的 shell 围栏方案 | [当前围栏架构](architecture/2026-09-09-req159-process-fence.md) · [废弃台账](archive/DEPRECATED.md) |
| How long the two outbound fetch chains in `packages/core` can actually block, and which shipped shapes never reach them | [`architecture/2026-08-23-network-timeout-recon.md`](architecture/2026-08-23-network-timeout-recon.md) |
| 为什么 Chromium 内置 PDF viewer 在隔离 session 里画不出页面(两条独立成因,都不报错) | [`architecture/2026-09-03-electron-pdf-viewer-session.md`](architecture/2026-09-03-electron-pdf-viewer-session.md) |
| 第三方 Office 渲染库放在哪里跑,为此放宽了什么(以及负向控制证明没削弱 HTML 那条路) | [`architecture/2026-09-03-office-layout-isolation.md`](architecture/2026-09-03-office-layout-isolation.md) |
| 外部技能目录(`~/.claude/skills` 等)为什么维持关闭:那行 flag 是 ADR-024 的安全裁决、同意门三条入口已上线且在本机弹过四次、打开会裸露的七类面逐一对照导入门 | [`architecture/2026-09-06-external-skills-inheritance-decision.md`](architecture/2026-09-06-external-skills-inheritance-decision.md) |
| 推理档位(`variant`)谁设得了、设错了会不会被告知:`--variant` 是上游 CLI 的表面而 alpha 不发 CLI(五项实读);产品侧的对应表面是 composer 档位 chip,它的「不支持」态此前零判据而 12 个平台模型里 10 个没有档位;§5 智谱直连对 `thinking.type` 的真实受理(`disabled` 真关、写错静默忽略且仍 200) | [`architecture/2026-09-06-model-variant-reachability.md`](architecture/2026-09-06-model-variant-reachability.md) |
| 托管层规则与「失败即中止」今天已经在跑在哪(managed cap + 执行咽喉),真缺口是引擎侧没有租户身份;托管 hook 暂不做的理由、重开条件与要补的账 | [`architecture/2026-09-08-managed-policy-and-hook-abort-decision.md`](architecture/2026-09-08-managed-policy-and-hook-abort-decision.md) |
| openai/codex 与本仓 harness 的逐层对照:为什么不能换底座(四个阻断)、codex 明确更强的四项、可吸收机制各自的归属票,以及 2026-08-23 之后已被推翻的事实(自我订正区) | [`architecture/2026-08-23-codex-harness-comparison.md`](architecture/2026-08-23-codex-harness-comparison.md) |
| 引擎到底从哪些地方派生出会落盘的进程(四类创建原语的实跑枚举):MCP stdio / LSP / PTY **都不经** `ChildProcessSpawner`(C3 覆盖面为零);PTY 缺省读 `cfg.shell` 故已被 REQ-138 罩住,而 `pty.create({command})` 与 `POST /mcp` 的 `MCP.add` 各自绕开;逐条收编代价按 north-star 守卫实测定价。**§6(第二轮)**:seatbelt 由子进程继承 ⇒ 整进程围栏一次罩住全部通路且引擎照常工作,但 `utilityProcess.fork` 接不上 `sandbox-exec`、嵌套异策略 exit 71 零执行 ⇒ 与 REQ-138 那层互斥;出货 node-pty 在现行 profile 下起不来(缺 `/dev/ptmx`)。**§7(第三轮)**:alpha 自己在 sidecar 里的写入面枚举 —— 实跑落盘 13 条(全落在 `<codepuppyGlobalRoot>` / `<userDataPath>` / `<workspace>/.codepuppy` 三个根),**随工作区变化的路径全在 `<workspace>/` 这一条前缀之下**;单一权威从**出货 bundle** 派生(70 条签名 / 85 个调用点,四臂含改名与新增两条反向臂);并更正 §3 表第 6 行 —— PTY 缺省**并未**被 REQ-138 罩住(插件改的 `cfg.shell` 与 `core` 的 `Config.entries()` 不是同一份)。**§8(第四轮)**:候选可写集 19 行逐行消融(6 行去掉引擎起不来、1 行去掉 provider **静默**装不上)+ 「装了 ext 的引擎整个塞进围栏」的合成一跑 —— 五步工作负载全通过、四条越界探针 0 落盘而正样本臂 4/4 落盘;**照 §7.6 原文立闸会当场报错**(zsh 存历史走 `.zsh_history.new`),且**按文件放行 ≠ 按目录放行**(`[ -w $HOME ]` 答不可写 ⇒ `compinit` 静默不落 dump);`.zsh_sessions` 那条被更正为夹具带进来的。**可写集以 §8.2 为准,不要照 §7.6 原文** | [`architecture/2026-09-08-derived-process-spawn-paths.md`](architecture/2026-09-08-derived-process-spawn-paths.md) |
| REQ-159 U1 决定书:**自己写的 `.node` 在签名 + hardened runtime + 库校验开着的出货包里加载得了** —— 包内 Developer ID(team `RQX6X6A635`)那条臂在**引擎 sidecar 进程**与主进程各加载成功、三个 libsandbox 符号全解析到;ad-hoc / 别的 Team / 去签名三条反例臂在同一进程里被库校验按 Team 逐条拒掉(证明闸门确实开着);**不需要开 `cs.disable-library-validation`,不需要动签名配置**。流水线自己把它签成与 `pty.node` 同形并封进 `CodeResources`,更新 zip 里也带着它。加码一格:同一个模块在出货 sidecar 里 `sandbox_init_with_parameters` 实测 `rc=0` 且围栏真生效(装前可写 / 装后 `EPERM` 对照)。未测:公证、非 arm64、完整可写集(U3 仍开) | [`architecture/2026-09-09-req159-u1-native-addon-signed-load.md`](architecture/2026-09-09-req159-u1-native-addon-signed-load.md) |
| Code Puppy 往模型上下文塞的字有哪几条通路、怎么证明枚举完备(从 `Hooks` 接口派生,不是清单)、每段多大、上限多少、超限怎么响亮失败;ui-mac `instructions` 与 `agent.*` 两条怎么跨包进同一份登记簿(零依赖内容模块 + 类型锁的能力形状域);ui-mac 侧为什么是罩整份 config 的一道咽喉而不是按键的两道(登记文字 / 声明引用 / 引擎动词三分,其余点名,对未知默认拒) | [`architecture/2026-09-08-context-injection-registry.md`](architecture/2026-09-08-context-injection-registry.md) |
| 长期记忆怎样进入对话(alpha-code#427):票面争论的 v2 `SystemContextRegistry` 不在对话路径上(ADR-036 裁定会话发送只走 v1);v1 的 system 段装配链逐行坐标;插件面 21 键里能碰到上下文的六条逐条判(`config` → `cfg.instructions[]` 是**稳定**的 L0 接缝且**每步重读**,`experimental.chat.system.transform` 只作退路,`chat.message` 落进历史被否);探针实测 3 条(钩子与 Instruction 读同一份 cfg、删即失效、写回再现;退路仍在);两条接缝 90 天零漂移;与 REQ-157 登记簿/咽喉的关系 | [`architecture/2026-09-17-memory-injection-seam.md`](architecture/2026-09-17-memory-injection-seam.md) |
| REQ-131 #1130 引擎 tool policy 面(inventory 读 / record 写 / reset)怎样不扩 ADR-033 名单、不碰 `httpapi/api.ts` 就走出引擎进程:挂在已收编的 v2 permission 组;v2 handler 只看得见 `app` 组**顶层**成员(`LayerNode.compile` 对依赖 `provide`、对顶层 `provideMerge`),所以由已收编的 `SessionPrompt.node` 合成暴露一个 core 侧标签,opencode 侧 bridge 按 directory `InstanceStore.provide`(与 pty-environment 同形);handler 用 `serviceOption` 缺席即 503;两条主动没走的路(收编 api.ts / main 重算)与为什么不重生 SDK | [`architecture/2026-09-17-tool-policy-transport-seam.md`](architecture/2026-09-17-tool-policy-transport-seam.md) |
| REQ-158 的风险分类该挂在哪个接缝上:`permission.ask` 钩子零触发(运行时复验,带正样本臂);`gateToolExecution` 每次工具调用都跑,但 `GateInput` 里**没有 `args`**、`metadata` 恒 `{}`,而且它发起的那一问在常见配置下**根本不弹框**;`Permission.ask` 才是 v1 侧唯一的请求构造点与唯一的 `permission.asked` 发布点。远端 MCP 的授权提示今天是 `patterns:["*"]` / `metadata:{}` —— 目的地与载荷一个字都没有。候选接缝按 north-star 守卫实测定价(7 个工具文件判红,gate 与 ask 零成本),并更正票面「分类模块落 `packages/ext/src`」—— 引擎对 `packages/ext` 零依赖,import 不了它。**§9(2026-09-09 补测)**:v2 审批引擎(`PermissionV2`)在桌面产品里**今天不可达** —— v1 生产工具路径上 v2 通道实测 0 条(带变异臂),进入 v2 ask 的两族入口(12 个 v2 工具 / `session.permission.create`)在产品源码里调用数全为 **0**,`SessionV2.resume` 零调用方⇒无开机自动 resume,而 `packages/app` 那个**运行时代次开关**对 alpha 自己的引擎实测判 `v1`(带假引擎正样本臂);但 v2 路由确实挂着、引擎会弹(带反向臂),所以这是**选择**不是结构性不可能 ⇒ AC1 的闸门须把「产品仍在 v1」这条前提一起守住,第二处接缝(v2 两个发布点)已定位且 north-star 零成本 | [`architecture/2026-09-08-permission-prompt-classification-seam.md`](architecture/2026-09-08-permission-prompt-classification-seam.md) |
| `alpha-code#1413` 运行权限档位的地面真相:今天只有两档(`PermMode = "ask" \| "readonly"`),而**「请求审批」档就是不带 agent 落到引擎默认 `build` 上,它的规则集是 `"*": "allow"`** —— 真 `Permission.ask` 实测 `bash`/`edit` 直接放行不弹框(带 `external_directory` 正样本臂与只读 deny 反样本臂);出厂默认仍会问的只有 `external_directory`/`doom_loop`/`read *.env` 与非 builtin 工具;五档 agent × 规则/工具表双口径矩阵;加第三档要穿过的九个判定点里有七个是二元结构(`buildPromptRequest` 那个二元分支会让第三档与 `ask` 产出逐字节相同的请求 = REQ-126 假档形态);活稿三档自最初提交未改过,且它对「请求审批」的描述同样与实测不符;**§11 后记:`#1413` 落地后为三档**(全部批准 = 不带 agent 的默认档 / 请求审批 = `alpha-ask`,edit/bash 真问 / 只读不变),以上各节保留为落地前的地面真相 | [`architecture/2026-09-23-runtime-permission-tiers.md`](architecture/2026-09-23-runtime-permission-tiers.md) |
| Platform and endpoint integration                                    | [`contracts/`](contracts/)                                           |
| Session tool permission DTOs and decision receipts                   | [`contracts/session-permission.md`](contracts/session-permission.md) |
| REQ-131 分层工具策略:三态/四类/selector、cap 合成、binding guard、分区持久化与 V1 session grant 语义 | [`contracts/tool-policy.md`](contracts/tool-policy.md)               |
| REQ-158 授权提示的风险分类:每条 v1 授权请求的 `metadata.codepuppyRisk` 形状、档位/类别词表、规则表、事实来源(只消费上游派生事实,探针 raise-only)、兜底 critical/unknown、远端 MCP 身份轴的 args/transport 供数、以及「产品仍在 v1」这条前提由谁守 | [`contracts/permission-risk-classification.md`](contracts/permission-risk-classification.md) |
| Build, distribution, CI, uninstall, and Settings recovery operations | [`runbooks/`](runbooks/)                                             |
| REQ-106 unsigned Windows manual-download boundary | [`design/2026-09-29-req106-unsigned-windows-manual-distribution.md`](design/2026-09-29-req106-unsigned-windows-manual-distribution.md) |
| Product and visual design assets                                     | [`design/README.md`](design/README.md)                               |
| `#1412` 方案基线:目的地由**模型即时生成**的那两条轴(`webfetch` 的 URL、`bash` 里命令自带的目的地)怎么出网 —— 它们是全表唯二没有围栏外真源的轴,整类被自家出网围栏 403(真 sandbox-exec + 真 curl + 生产代理实测);选定「授权判据的第三个半场 = 用户当场批准的目的地」(有真源 + 有出口,与文件轴同形),八个被否决的替代逐条带坐标,十一条类边界与八条实现不变量前置枚举,并按实情写明 owner 已知接受的残留:**K3′ inet_aton 短写的 IPv4 字面量绕得过 loopback/私网准入**(准入判文本形状、拨号走 `getaddrinfo`,七种短写实测全部通过;2026-09-24 裁决接受,含将来关它的最小修法)、名字解析到私网不判(§7.2 更正了此前那条**前提为假**的理由)、明文 HTTP 仍 405、对话框没有调用上下文、撤销要删记录**并重启应用** | [`design/2026-09-23-model-chosen-egress-baseline.md`](design/2026-09-23-model-chosen-egress-baseline.md) |
| REQ-159 引擎进程自打沙箱的方案基线:选定方案与三条被否决的替代、五条安全不变量(可写集只能收紧 · 装外层与拆 REQ-138 必须同一次变更 · 按文件放行≠按目录放行且失败静默 · 披露要有判据 · set-ID 辖区扩到整进程)、三项地基的当前状态(U1 原生模块签名加载已闭合 `#1316`;U2 多工作区已闭合 `#1317`;U3 出货形态合成已闭合 `#1323`)与子票切分 | [`design/2026-09-09-req159-process-fence-baseline.md`](design/2026-09-09-req159-process-fence-baseline.md) |
| `#1414` 方案基线:本地腿与云腿都活着,账户信号只决定**云腿在不在**,不决定本地腿在不在;额度的唯一权威是 account 的逐次 preauth(**调用期**),桌面不得持有第二份判据;AC2 的两个咽喉点指名(gateway 的封印付费面 = 拒绝的权威;ext 的 `tool.execute.after` = 到达模型的唯一通路,因为 MCP 工具只有两条执行链且都触发它);五条被否决的替代(桌面额度信号 / 云侧注册期过滤 / 整 server 关 / 静默 failover / 镜像 account 规则)与六条安全不变量;ADR-009 判为 **supersede** 而非就地修订的四条理由;子票切分与留给 owner 的两项裁决(云侧要不要新增 web fetch、`#1411` 的处置) | [`design/2026-09-23-1414-web-tools-account-routing-baseline.md`](design/2026-09-23-1414-web-tools-account-routing-baseline.md) |
| REQ-159 U2 裁决:一个被围栏的引擎怎么服务多个工作区 —— **取启动时并集**(经真引擎实跑 5 个工作区全可写、集合外 0 落盘),**不把「打开新目录」接成 respawn 触发器**(出货包实测一次结构性 respawn = 10.087 s + renderer 整个重载 + 用户被丢回默认工作区 `~/Alpha` + 终端全灭 + 工具子进程变孤儿 + 会话永远 `running`);并集有一道 `data object length … (65535)` 的硬天花板 ⇒ 必须封顶;「写不进去的文件夹」今天在引擎日志里与可写的**逐行同形**,可观察面只能靠一次真写探针 —— 手写 `(subpath)` 的字符串替身实测在软链/大小写/前缀分段三处说谎 | [`architecture/2026-09-09-multi-workspace-fence-decision.md`](architecture/2026-09-09-multi-workspace-fence-decision.md) |
| REQ-159 引擎进程围栏的**落地形状**(`#1321`):main 在 fork 前渲染 §8.2 可写集 + 真 sandbox-exec 试编译 + 并集从尾部丢到编得过,sidecar 收到 start 后第一件事 dlopen 自己的 N-API 模块 `sandbox_init` 并双向自证(集合外写不进、cwd 写得进);装不上的六条路全部拒绝启动,没有「起来了但没围栏」;REQ-138 那层同一次拆掉;AC3 写盘调用点登记簿(76 条签名,AST 解析 fs 绑定,改名 / 多行 import 都抓);x64 靠 fat `.node` + 逐片判据不靠人记得;判据地图与未做的(真模型请求 / x86_64 片未执行 / bash_history;U3 出货合成已由 `#1323` 补上) | [`architecture/2026-09-09-req159-process-fence.md`](architecture/2026-09-09-req159-process-fence.md) |
| 本机出网要在哪一层拦住(第一轮,`#1077`,**2026-09-10 部分被推翻**):seatbelt 写不出目的地(只有 any/localhost × 端口)、端口白名单 host-blind ⇒ 单靠它是假闸门;fake-IP 拓扑下按 IP 授权结构上无意义;八客户端对 env 代理的服从性矩阵与拒绝形态。**§3.2 的落点、§5 的 profile 形状、§6 的覆盖面已被 `#1334` 改写,读它之前先读那份的《老结论分档》** | [`architecture/2026-08-25-network-egress-seam.md`](architecture/2026-08-25-network-egress-seam.md) |
| 网络轴**第二轮**(`#1334`,接缝换成整进程围栏之后重测):**老勘破 §5 那两行照抄过来会让引擎起不来** —— sidecar 就是 HTTP 服务器,`(deny network*)` 连 `listen()` 一起拦(`EPERM`),而围栏照常自报 `process fence applied`、fork 后 560 ms `sidecar exited { code: 1 }` 且**没有任何一行点名原因**;能工作的形状要补 `network-inbound`。装上强制汇流层而没有策略层时,六格里只断一格,断的正是那条**静默**路径 —— provider 装不上(`getaddrinfo ENOTFOUND registry.npmjs.org`)而 health 仍 200;装上 loopback CONNECT 代理后 26 包全回来。`(deny network*)` 对系统 unix socket 一刀切、逐条 `(literal …)` 可放回、**不覆盖 mach IPC**(钥匙串/目录服务照常),而真工作负载里引擎只碰 mDNSResponder 一个。打包产物里 `useEnvProxy()` 复验成立(远端 MCP 的 CONNECT 落到代理日志)。字节:网络行净成本 234–268 B,墙(1 264 个工作区 / `data object length 65574`)四臂逐字相同 —— 但裁剪器会把语法坏的网络行**误报成「最小可写集都编不过」** | [`architecture/2026-09-10-network-egress-on-process-fence.md`](architecture/2026-09-10-network-egress-on-process-fence.md) |
| 网络轴**第三轮**(`#1412`,出货 0.1.16 现场 + 生产模块复跑):一次 `webfetch` 经过的七道判定逐格坐标,**拒在 `network-egress-proxy.ts:185`**(403 `unregistered`)—— 现场 10 次抓取 10 次被拒而同一代 `alpha-cloud` / `github` / `api.deepseek.com` 全 200;同一个 URL 只把它登记进动态半场就当场取回整页(单一变量)。判定为**设计问题**:放行集合的输入只有注入面 provider 与远程 MCP 真源两处(`server.ts:194-197`),而抓取目标由模型在调用那一刻生成、没有配置来源,两份旧勘破里 `webfetch` 命中数各 0。附带钉住 `#1382` 归因面在这条路径上双重够不着(undici 丢弃代理 403 正文 + 消费端只读 `AssistantMessage.error`),以及「出货包的 `ELECTRON_RUN_AS_NODE` 会把应用真的起起来」这条坑 | [`architecture/2026-09-23-webfetch-egress-decision-chain.md`](architecture/2026-09-23-webfetch-egress-decision-chain.md) |
| 云端识图的客户端半场(REQ-228 `#1419`):自动转写用的**就是**引擎经云 MCP 访问平台的那份 `mcp_access` 凭据(`CODEPUPPY_CLOUD_MCP_DEF` 里的 `{file:…CODEPUPPY_MCP_TOKEN}`,gateway 的 `/v1/tools/vision` 封印路由额外接受它),主机取 `CODEPUPPY_BASE_URL` 的 origin;五个钩子各管一格(贴图追加 synthetic 转写块而**不换掉**图片 part、请求时剔图、Read 附件同转写、`cloud_cloud_vision` 的 args 原地改写并写死 qwen / 不换档、看不了图才加一句说明);与基线原文的三个取舍(保留图片 part / 追问只认本会话出现过的图而不读盘 / 用引擎同一份 photon 随 bundle 带 wasm)与云端不可用的十一格文案 | [`architecture/2026-09-24-cloud-vision-client-seam.md`](architecture/2026-09-24-cloud-vision-client-seam.md) |
| Exa 条目形状 × fail-open(`#1445` 第三轮勘破,只答四问不落闸):把「认出条目形状才声称是搜索结果、认不出一律放行」写成命题并证明它作为传输命题自洽、但对**模型这条通道是惰性的**(`websearch.ts:186` 只把 `output` 交给模型,放行分支的字节与今天逐字相同;要让模型对「缺席」有反应就得把 fail-closed 搬进提示词);四种真实负载经两份生产 `parseResponse` 取文本后四格:D 放行不声称 / Z 放行不声称 / 今日 Exa 声称 3 条 / 今日 Parallel 声称 10 条,六条变异臂证明识别器看的是行结构;**npm 上 exa-mcp-server 全部 49 个发行版**(2024-12-17 → 2026-08-18)的 `web_search` 渲染只有三代(`JSON.stringify` 324 天 33 版 → 直出 `/context` 141 天 12 版 → `Title:` 行 184 天 4 版仍在),上一版「无底洞」是错的;但识别器在传输文件里就是一条正文匹配,与在途 AC3 的源码普查闸正面冲突 ⇒ 推荐**不做**,并写出若要做时的 AC 形状 | [`architecture/2026-09-27-exa-entry-shape-fail-open-recon.md`](architecture/2026-09-27-exa-entry-shape-fail-open-recon.md) |
| 本地腿与云腿、按账户选路的地面真相(`#1414` 只读勘破):**云侧实跑 `listTools()` = 6 个工具,没有任何形式的 web fetch**(带三根不存在的负针 + 一根存在的正针),唯一有入口直接费用的是 `cloud_web_search`,而「读面不花钱」是**四个**不是三个;远端 MCP 的 per-tool 过滤**桌面侧真没有**(`ConfigMCPV1.Remote` 只有整 server `enabled`)而**云侧装着的 `@modelcontextprotocol/server@2.0.0` 直接支持**(`McpServerFactory` 可 async 且拿得到本次请求 —— 同一 handler 按一个 header 广播出不同工具集,已实跑),挡路的是我们自己的构造期不变量;`webSearchEnabled()` **一个字都不认账户**(票面那条判据是错的),真选路点分布在 4 层 5 处、外加一处**把能力事实直接写进系统提示**的第四份判据;额度的唯一权威是 account 服务的逐次 preauth(桌面只有三份互不相同的近似值,其中 `cap-entitlement` 是**死分支**);关掉 cloud MCP server 会连带关掉全部 6 个工具(含 `cloud_cancel`),而**今天登出与 kill-switch 两条路都已经在这么做**;另外云侧仓里已经躺着一份带 SSRF 闸、有测试、**零消费者**的 `webFetch()`。含「没测到的」六条与 ADR-009 已漂的两处 | [`architecture/2026-09-23-web-tools-account-routing-recon.md`](architecture/2026-09-23-web-tools-account-routing-recon.md) |
| Exa MCP 的失败信号实读(`#1445`):额度用尽那句「去申请自己的 key」为什么走成了成功路,以及**对那一种响应没有可消费的结构化信号**(`isError` 反推为非真、JSON-RPC 是 `result`、HTTP 2xx、两个工具都没声明 `outputSchema`);今天量到的四种形状(正常带 `content[0]._meta.searchTime` 27/27、Exa 自己的 in-band 错误 `isError:true` 且无 `_meta` 4/4、额度用尽 **429** 43/43 含五种 accept 变体、票面那一种 0 次)、`_meta` 当判据的两处站不住,以及顺带量到的 `packages/core` 副本缺整层 E7 收口;**2026-09-26 补勘**(坏负载文本在手上之后重做):exa-mcp-server 四个发行版都给这句提示置 `isError:true`(D 是托管端自己那一层的产物)、Exa 的真实零命中就是一段散文且信封与 D 逐格相同、成功渲染半年内换过一次且 3.1.9 无 `_meta`、十条候选判据逐条带实测排除 ⇒ 仍不落闸,并写明什么条件下判据会出现;**2026-09-27 落地**:重写后三条 AC 的实测(C/D/Z/Z2 在两份传输的模型面各是哪句话 ⇒ AC1 今天成立、判决一行没改)、信封结构记录的字段与 D 样本、开关关闭逐字节不变的对照臂、四种变异各红几条 | [`architecture/2026-09-24-exa-mcp-failure-signal-recon.md`](architecture/2026-09-24-exa-mcp-failure-signal-recon.md) |
| Point-in-time audits and screenshots                                 | [`audits/README.md`](audits/README.md)                               |
| Focused verification records                                         | [`verification/`](verification/)                                     |
| `#1433`(REQ-1414 VERIFY-1)四格 × 搜网:真模型实测三格都真的发了 `websearch` 并拿回结果,kill-switch 反向臂工具根本不在表里;本地腿传输 18/18 + 主权拒绝 6/6;**零余额真账户的 402 wire body 第一次跑出来**(gateway HTTP 402 `account_wallet_insufficient`,到模型那一层是 MCP 200 + `isError`;账本零副作用实读为 0);`#1415` 登记的两个端点第一次被真出网策略代理判成 allow(反向臂 403);打包产物上复现了 `#1411` 的四格工具表。**两条新事实**:kill-switch 下模型改用 `webfetch` 打 DuckDuckGo/Bing 并拿回搜索结果(打包版里那两个域撞代理 403 ⇒ 降级成一次用户批准);`providers.add` 拒收回环 base URL ⇒ `#1144` 那套打包真模型取证配方已失效。**未测**:云腿·有额度、打包实例上的真模型回合 | [`verification/2026-09-24-1433-four-account-states-websearch/README.md`](verification/2026-09-24-1433-four-account-states-websearch/README.md) |
| `#1461`(ADR-046 D6 VERIFY)装了**真第三方 web-search MCP** 的真引擎 + 真 ext 上的四格 × 三臂 × 两轮:Exa 远端(`exa_web_search_exa`)与自建 stdio 插件(同一插件只换工具名 `web_search` / `search`),登出 / 登录有额度 / 登录无额度 三格三臂全部在表里、调得动、拿回真结果;kill-switch 下**名字被认出的两臂仍在工具表里、调用被 ext 拒**(`WebSearchSovereigntyError` 文案原文入库),**反向臂 `duck_search` 照常拿回 DuckDuckGo 结果**(出网代理 `allow` + 插件 trace 200/34 KB);离线用同一生产函数判 `google_search` / `bing_search` 同样不命中 ⇒ D6 两处措辞就地订正(「关」→「在表里、调用被拒」;漏网不只非 ASCII)。**未测**:真登录铸 token 的云腿(#1433 §6 已测)、打包实例、策略闸弹窗的人工路径 | [`verification/2026-09-27-1461-third-party-websearch-mcp-four-states/README.md`](verification/2026-09-27-1461-third-party-websearch-mcp-four-states/README.md) |
| REQ-128 桌面端对公网 stable 的 `package:codepuppy-first` 浏览/详情/安装取证(四条 AC 全 PASS;目录安装落 `disabled` 是既定策略) | [`verification/2026-08-26-req128-163-desktop-live-package/README.md`](verification/2026-08-26-req128-163-desktop-live-package/README.md) |
| REQ-138 AC4 #1076 打包 Electron sidecar 上的沙箱正反语料(围栏 ON 7/7 不落盘、围栏移除的打包副本 7/7 落盘;会写盘的 rc 静默失效但不中断命令) | [`verification/2026-08-26-req138-1076-packaged-sandbox/README.md`](verification/2026-08-26-req138-1076-packaged-sandbox/README.md) |
| REQ-159 U3 #1323 出货形态合成:本机发版命令打出的 Developer ID + hardened runtime 签名包(fat `.node`)上装上 §8.2 全量可写集,六格(冷启动 / 装连接器含两处 provider 目录真装出 26 包 / 开终端 / shell 工具 / 写配置 / 三工作区并集)正向臂界内全落盘、集合外 0 落盘,同签名对照包同一探针全落盘(各 32/32);sidecar 自报 `process fence applied: addon=fence-… profile=2068B`;顺带钉住一条坑 —— **给 app 设 `HOME` 隔离不了它**(Electron appData 不看 `$HOME`,`preferAppEnv` 的 shell env 缓存会把 `HOME` 改回去),只能用 `OPENCODE_TEST_ONBOARDING` + 把 `TMPDIR` 挪到真 HOME 之下;未测:真模型请求、公证、x86_64 片、W4 的 sqlite 文件 | [`verification/2026-09-10-req159-1323-packaged-fence/README.md`](verification/2026-09-10-req159-1323-packaged-fence/README.md) |
| REQ-137 `#1334` 网络轴重勘破的取证:同一份 Developer ID 签名包按 env 摆出四种网络形状(出货形状 / deny-all + loopback / 再加 loopback CONNECT 代理 / 老勘破 §5 逐字),控制臂 32 pass 且代理日志 0 条(仪器不幻觉),§5 逐字臂引擎从来没到过 health 200;误伤语料九条 + 新增三条三臂逐格;内核 Sandbox 拒绝日志按时间窗枚举(正样本 `nc -U /var/run/syslog`);四条臂真 HOME 六哨兵 mtime 前后逐字相同、残留进程 0 | [`verification/2026-09-10-req159-1334-packaged-network-fence/README.md`](verification/2026-09-10-req159-1334-packaged-network-fence/README.md) |
| REQ-131 #1130 设置「工具」节六态 × 浅/深 × 宽/窄的组件级视觉证据(现役 `CodePuppySettings` + 夹具 `toolPolicy`,loopback Vite + Chrome headless,零 Electron),对照已批帧 `2026-08-25-req131-settings-tool-policy`;四处已裁偏差(引擎工具名原文 / Code Puppy Cloud 按服务行 / 无法核验提示放节末 / 新增「先打开一个项目」态)写在 README | [`verification/2026-09-17-1130-settings-tools-visuals/README.md`](verification/2026-09-17-1130-settings-tools-visuals/README.md) |
| #1144 打包产物里由 agent 回合驱动的 shell **工具**整链(围栏 ON 7/7 不落盘、反向臂 7/7 落盘),以及 Developer ID + hardened runtime 下的同一套语料(结论一致;真模型那一步仍未做) | [`verification/2026-08-26-req138-1144-packaged-shell-tool-chain/README.md`](verification/2026-08-26-req138-1144-packaged-shell-tool-chain/README.md) |
| #1144 `#1147` 合入之后打包产物里 shell 工具整链的复跑(围栏 14/14 不落盘、反向臂 14/14 落盘;负向控制证明这条链关得掉;真模型那一格仍未闭合) | [`verification/2026-08-26-req138-1144-postmerge-chain/README.md`](verification/2026-08-26-req138-1144-postmerge-chain/README.md) |
| #1144 AC1 打包产物里由**真模型**回合驱动的 shell 工具整链(围栏臂不落盘、反向臂落盘,`tool_calls` 原文入库;真模型 5 次里 3 次自己拒绝发这次越界调用) | [`verification/2026-08-27-req138-1144-real-model-chain/README.md`](verification/2026-08-27-req138-1144-real-model-chain/README.md) |
| REQ-131 #725 工具策略双咽喉矩阵(模型目录闸真绿;执行咽喉只对 MCP 成立 —— builtin/plugin/host 的 `ask` 不问、`deny` 照跑;`always` 跨会话且压得过后来的 `deny`) | [`verification/2026-08-25-req131-725-tool-policy-chokepoints/README.md`](verification/2026-08-25-req131-725-tool-policy-chokepoints/README.md) |
| REQ-092 #402 descriptor-only 有界产物传输七格矩阵(格 4/6/7 PASS;格 1/3/5 部分 FAIL;格 2 摘要 PASS、峰值 RSS 超顶) | [`verification/2026-08-25-req092-402-artifact-transfer/README.md`](verification/2026-08-25-req092-402-artifact-transfer/README.md) |
| REQ-109 startup P95 after #1098/#1099 (FAIL 8,313ms; the tail is now named: first project-list fetch) | [`verification/2026-08-24-req109-p95-post1098-1099/README.md`](verification/2026-08-24-req109-p95-post1098-1099/README.md) |
| REQ-109 packaged 稳态 catalog P95 after #1083 (FAIL: merged P95 5,347.1ms; new 5s-liveness + uninstrumented mount window) | [`verification/2026-08-24-req109-p95-post1083/README.md`](verification/2026-08-24-req109-p95-post1083/README.md) |
| `#1227` 右栏 PDF 叠放载体真 Chromium 取证(修复前非暗像素 0%/两个 frame;修复后 93.6%/三个 frame,分区目录关闭即收) | [`verification/2026-09-03-1227-rail-pdf-session/README.md`](verification/2026-09-03-1227-rail-pdf-session/README.md) |
| `#1229` 右栏 Office 版式载体真 Chromium 取证(docx/pptx/xlsx 三格全 PASS;抓到「自报渲染成功而画布只有外壳」与「仓内夹具不能判版式」两件事) | [`verification/2026-09-03-1229-office-layout/README.md`](verification/2026-09-03-1229-office-layout/README.md) |
| `#1445` Exa MCP 响应形状实读(探针与生产请求逐字同形;⚠️ 免费额度按出网 IP 计,跑满等约 12 小时) | [`verification/2026-09-24-1445-exa-mcp-response-shapes/README.md`](verification/2026-09-24-1445-exa-mcp-response-shapes/README.md) |
| `#1445` 补勘:exa-mcp-server 四个发行版的构建产物实读(限流提示四版都 `isError:true`;成功渲染 3.1.9 → 3.2.1 换过、`_meta` 3.2.1 起才有;零命中是无 `isError` 的散文)+ 今天 nokey Exa / keyless Parallel 的完整原始响应 + 四种真实负载过两份生产 `parseResponse`(全判成功) | [`verification/2026-09-26-1445-exa-vendor-source-and-live-shapes/README.md`](verification/2026-09-26-1445-exa-vendor-source-and-live-shapes/README.md) |
| `#1445` 条目形状 × fail-open:npm 上 exa-mcp-server 全部 49 版的构建产物普查(整包聚合 + 精确到 `web_search` 处理函数窗口,三代渲染的版本/日期/时长)、fail-open 命题跑四种真实负载的离线版与生产路径版(经两份生产 `parseResponse`)+ 六条变异臂;不耗 Exa 额度 | [`verification/2026-09-27-1445-exa-entry-shape-fail-open/README.md`](verification/2026-09-27-1445-exa-entry-shape-fail-open/README.md) |
| Lessons and retrospectives                                           | [`retrospectives/`](retrospectives/)                                 |
| User-visible shipped changes                                         | [`../CHANGELOG.md`](../CHANGELOG.md)                                 |
| Retired developer prose                                              | [`archive/DEPRECATED.md`](archive/DEPRECATED.md)                     |

Runtime-loaded decisions remain in the protected `.claude/rules/adrs/`
namespace. They are rule/decision assets and are not copied into docs. The old
backlog, requirements, plans, Sprints, process handbook, and implementation
plans were removed after their valid conclusions and delivery identities were
promoted. Do not recreate role aliases, `latest`, `done`, or local work-state
trackers.

Within `architecture/`, `overview.md` and `upstream-integration.md` are current
authority. `understanding.md`, `extension-seams.md`, and the diagram corpus are
protected point-in-time cartography/knowledge assets; use them for provenance,
not for current package versions, synchronization rules, or implementation
status.

[模块地图](architecture/modules.md) · [工作过程规格](specs/conversation-process-fold/spec.md) · [对话浮层规格](specs/conversation-overlays/spec.md)

## 文档索引

意图统一在 [Alpha intents](https://github.com/impharaon/alpha-work/blob/a4b8beeac0196f02780a8c26364529b07e313acb/docs/intents/README.md)；本仓能力规格见 [specs/](specs/)。规格保留已交付事实和验收边界；当前开发状态仍看 Issues / Project。

<!-- docs-index:start -->

<!-- 由 docs_index.py 从各文件 frontmatter 生成,不要手改;改文件的 summary 后重跑 --write。 -->

### architecture

| id | 文件 | 做什么 | 状态 |
| --- | --- | --- | --- |
| `ARCH-alpha-code-2026-08-10-catalog-readiness-signals` | [architecture/2026-08-10-catalog-readiness-signals.md](architecture/2026-08-10-catalog-readiness-signals.md) | 目录目录就绪有哪些信号（勘破） | active |
| `ARCH-alpha-code-2026-08-10-packaged-first-launch-catalog-cost` | [architecture/2026-08-10-packaged-first-launch-catalog-cost.md](architecture/2026-08-10-packaged-first-launch-catalog-cost.md) | 打包首启 sidecar-ready 之后的目录就绪成本（归因） | active |
| `ARCH-alpha-code-2026-08-23-codex-harness-comparison` | [architecture/2026-08-23-codex-harness-comparison.md](architecture/2026-08-23-codex-harness-comparison.md) | openai/codex 与本仓 harness 的对照(哪些机制值得吸收,哪些结构上不能换) | active |
| `ARCH-alpha-code-2026-08-23-network-timeout-recon` | [architecture/2026-08-23-network-timeout-recon.md](architecture/2026-08-23-network-timeout-recon.md) | 两处网络等待形态到底会挂多久（勘破） | active |
| `ARCH-shell-sandbox-evidence-pointer` | [architecture/2026-08-23-shell-sandbox-seam.md](architecture/2026-08-23-shell-sandbox-seam.md) | 为不可变验收记录保留旧路径，指向归档原件与现役整进程围栏。 | active |
| `ARCH-alpha-code-2026-08-25-network-egress-seam` | [architecture/2026-08-25-network-egress-seam.md](architecture/2026-08-25-network-egress-seam.md) | 本机出网要在哪一层拦住(勘破) | active |
| `ARCH-alpha-code-2026-09-03-electron-pdf-viewer-session` | [architecture/2026-09-03-electron-pdf-viewer-session.md](architecture/2026-09-03-electron-pdf-viewer-session.md) | Chromium 内置 PDF viewer 在 Electron 隔离 session 里的真实行为 | active |
| `ARCH-alpha-code-2026-09-03-office-layout-isolation` | [architecture/2026-09-03-office-layout-isolation.md](architecture/2026-09-03-office-layout-isolation.md) | Office 版式渲染:在既有隔离载体里跑第三方渲染库 | active |
| `ARCH-alpha-code-2026-09-06-external-skills-inheritance-decision` | [architecture/2026-09-06-external-skills-inheritance-decision.md](architecture/2026-09-06-external-skills-inheritance-decision.md) | 外部技能目录(~/.claude/skills 等)维持关闭 —— 勘破与裁决 | active |
| `ARCH-alpha-code-2026-09-06-model-variant-reachability` | [architecture/2026-09-06-model-variant-reachability.md](architecture/2026-09-06-model-variant-reachability.md) | 推理档位(`variant`)的可达面:谁能设、设错了会不会被告知 | active |
| `ARCH-alpha-code-2026-09-08-context-injection-registry` | [architecture/2026-09-08-context-injection-registry.md](architecture/2026-09-08-context-injection-registry.md) | Code Puppy 注入模型上下文的登记簿与咽喉(REQ-157) | active |
| `ARCH-alpha-code-2026-09-08-derived-process-spawn-paths` | [architecture/2026-09-08-derived-process-spawn-paths.md](architecture/2026-09-08-derived-process-spawn-paths.md) | 引擎到底从哪些地方派生出会落盘的进程(勘破) | active |
| `ARCH-alpha-code-2026-09-08-managed-policy-and-hook-abort-decision` | [architecture/2026-09-08-managed-policy-and-hook-abort-decision.md](architecture/2026-09-08-managed-policy-and-hook-abort-decision.md) | 托管层与「失败即中止」—— 两样都已经在跑,缺的是租户身份;托管 hook 暂不做 | active |
| `ARCH-alpha-code-2026-09-08-permission-prompt-classification-seam` | [architecture/2026-09-08-permission-prompt-classification-seam.md](architecture/2026-09-08-permission-prompt-classification-seam.md) | 风险分类挂在哪个接缝上(勘破)—— 真正弹到用户面前的那一问,不是执行咽喉发起的那一问 | active |
| `ARCH-alpha-code-2026-09-09-multi-workspace-fence-decision` | [architecture/2026-09-09-multi-workspace-fence-decision.md](architecture/2026-09-09-multi-workspace-fence-decision.md) | REQ-159 U2 裁决:一个被围栏的引擎怎么服务多个工作区 | active |
| `ARCH-alpha-code-2026-09-09-req159-process-fence` | [architecture/2026-09-09-req159-process-fence.md](architecture/2026-09-09-req159-process-fence.md) | 引擎进程围栏:sidecar 自打 seatbelt 的落地形状(REQ-159) | active |
| `ARCH-alpha-code-2026-09-09-req159-u1-native-addon-signed-load` | [architecture/2026-09-09-req159-u1-native-addon-signed-load.md](architecture/2026-09-09-req159-u1-native-addon-signed-load.md) | REQ-159 U1 决定书:自己写的原生模块在签名后的正式包里加载得了 | accepted |
| `ARCH-alpha-code-2026-09-10-network-egress-on-process-fence` | [architecture/2026-09-10-network-egress-on-process-fence.md](architecture/2026-09-10-network-egress-on-process-fence.md) | 网络轴在整进程围栏上重勘破:老裁决的那两行会让引擎起不来 | active |
| `ARCH-alpha-code-2026-09-17-memory-injection-seam` | [architecture/2026-09-17-memory-injection-seam.md](architecture/2026-09-17-memory-injection-seam.md) | 长期记忆怎样进入对话:v1 引擎上的注入接缝勘破(alpha-code#427) | active |
| `ARCH-alpha-code-2026-09-17-tool-policy-transport-seam` | [architecture/2026-09-17-tool-policy-transport-seam.md](architecture/2026-09-17-tool-policy-transport-seam.md) | 引擎 tool policy 面走出引擎进程的接缝(REQ-131 / | active |
| `ARCH-alpha-code-2026-09-23-bun-electron-mock-link-abort` | [architecture/2026-09-23-bun-electron-mock-link-abort.md](architecture/2026-09-23-bun-electron-mock-link-abort.md) | 整份测试文件在链接期夭折 —— bun 的 electron mock 与「没有名字的失败」(`#1423`) | active |
| `ARCH-alpha-code-2026-09-23-native-tool-gate-inventory` | [architecture/2026-09-23-native-tool-gate-inventory.md](architecture/2026-09-23-native-tool-gate-inventory.md) | 引擎原生工具的全表:每一个今天在出货桌面端里能不能用,被哪一道挡住(`#1414`) | active |
| `ARCH-alpha-code-2026-09-23-runtime-permission-tiers` | [architecture/2026-09-23-runtime-permission-tiers.md](architecture/2026-09-23-runtime-permission-tiers.md) | 运行权限档位的地面真相(`alpha-code#1413` 勘破) | active |
| `ARCH-alpha-code-2026-09-23-web-tools-account-routing-recon` | [architecture/2026-09-23-web-tools-account-routing-recon.md](architecture/2026-09-23-web-tools-account-routing-recon.md) | 本地腿与云腿、按账户选路:今天的地面真相(`#1414` 只读勘破) | active |
| `ARCH-alpha-code-2026-09-23-webfetch-egress-decision-chain` | [architecture/2026-09-23-webfetch-egress-decision-chain.md](architecture/2026-09-23-webfetch-egress-decision-chain.md) | 一次网页抓取到底经过哪几道判定,在哪一道被拒(`#1412`) | active |
| `ARCH-alpha-code-2026-09-24-cloud-vision-client-seam` | [architecture/2026-09-24-cloud-vision-client-seam.md](architecture/2026-09-24-cloud-vision-client-seam.md) | 云端识图的客户端半场:凭据从哪来、图走哪条钩子、看不了图的模型怎么被喂(REQ-228 `#1419`) | active |
| `ARCH-alpha-code-2026-09-24-exa-mcp-failure-signal-recon` | [architecture/2026-09-24-exa-mcp-failure-signal-recon.md](architecture/2026-09-24-exa-mcp-failure-signal-recon.md) | Exa MCP 的失败信号 —— 实读(2026-09-24) | active |
| `ARCH-alpha-code-2026-09-27-exa-entry-shape-fail-open-recon` | [architecture/2026-09-27-exa-entry-shape-fail-open-recon.md](architecture/2026-09-27-exa-entry-shape-fail-open-recon.md) | Exa 条目形状 × fail-open —— 认得出才说一句,认不出一律放行(2026-09-27) | active |
| `⚠️ 缺 id` | [architecture/2026-11-09-1662-l1-engine-host-spike.md](architecture/2026-11-09-1662-l1-engine-host-spike.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [architecture/2026-11-09-1662-permission-reply-measurements.md](architecture/2026-11-09-1662-permission-reply-measurements.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [architecture/2026-11-12-1662-takeover-candidates.md](architecture/2026-11-12-1662-takeover-candidates.md) | ⚠️ 缺 summary | ? |
| `ARCH-alpha-code-claude-plugin-corpus-component-scale` | [architecture/claude-plugin-corpus-component-scale.md](architecture/claude-plugin-corpus-component-scale.md) | 真实 Claude 插件语料的组件规模(勘破) | active |
| `ARCH-alpha-code-codepuppy-connection-lifetime` | [architecture/codepuppy-connection-lifetime.md](architecture/codepuppy-connection-lifetime.md) | Code Puppy Connection record lifetime | active |
| `ARCH-alpha-code-constraints` | [architecture/constraints.md](architecture/constraints.md) | Architecture constraints and known deviations | active |
| `ARCH-alpha-code-engine-command-and-event-surface` | [architecture/engine-command-and-event-surface.md](architecture/engine-command-and-event-surface.md) | 引擎的 command 与事件面（勘破） | active |
| `ARCH-alpha-code-extension-seams` | [architecture/extension-seams.md](architecture/extension-seams.md) | opencode 扩展接缝操作手册 | active |
| `ARCH-alpha-code-frontend-surfaces` | [architecture/frontend-surfaces.md](architecture/frontend-surfaces.md) | Frontend surface composition | active |
| `ARCH-alpha-code-host-extension-package-contract-boundary` | [architecture/host-extension-package-contract-boundary.md](architecture/host-extension-package-contract-boundary.md) | Host extension package contract boundary | active |
| `ARCH-modules` | [architecture/modules.md](architecture/modules.md) | 标明桌面宿主、引擎、共享契约和上游工作区包的边界。 | active |
| `ARCH-alpha-code-overview` | [architecture/overview.md](architecture/overview.md) | Code Puppy architecture overview | active |
| `ARCH-alpha-code-package-mcp-oauth-boundary` | [architecture/package-mcp-oauth-boundary.md](architecture/package-mcp-oauth-boundary.md) | Package MCP OAuth ownership boundary | active |
| `ARCH-alpha-code-quality-gate-environments` | [architecture/quality-gate-environments.md](architecture/quality-gate-environments.md) | 质量门 × 运行环境 —— 每道门在每个环境里的真实状态 | active |
| `ARCH-alpha-code-understanding` | [architecture/understanding.md](architecture/understanding.md) | 理解 opencode(为 alpha-code 制图) | active |
| `ARCH-alpha-code-upstream-integration` | [architecture/upstream-integration.md](architecture/upstream-integration.md) | Code Puppy upstream integration | active |

### audits

| id | 文件 | 做什么 | 状态 |
| --- | --- | --- | --- |
| `⚠️ 缺 id` | [audits/2026-06-28-timeline-overhaul.md](audits/2026-06-28-timeline-overhaul.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-02-register-verification.md](audits/2026-07-02-register-verification.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-02-startup-perf-audit.md](audits/2026-07-02-startup-perf-audit.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-03-b3-cloud-loop.md](audits/2026-07-03-b3-cloud-loop.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-03-frontend-reskin-regression.md](audits/2026-07-03-frontend-reskin-regression.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-03-realmachine-verify.md](audits/2026-07-03-realmachine-verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-03-req002-proxy-e2e.md](audits/2026-07-03-req002-proxy-e2e.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-03-req003-sse-robustness.md](audits/2026-07-03-req003-sse-robustness.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-03-req004-alpha-bridge-spike.md](audits/2026-07-03-req004-alpha-bridge-spike.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-04-c14-coupling-convergence.md](audits/2026-07-04-c14-coupling-convergence.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-04-s11-ship-visual-verify.md](audits/2026-07-04-s11-ship-visual-verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-04-s12-ext-hub-m1-verify.md](audits/2026-07-04-s12-ext-hub-m1-verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-04-s13-acceptance.md](audits/2026-07-04-s13-acceptance.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-04-s13-t1t2-visual-verify/verify.md](audits/2026-07-04-s13-t1t2-visual-verify/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-04-s13-t3-visual-verify/verify.md](audits/2026-07-04-s13-t3-visual-verify/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-04-s13-t4-t5-visual-verify/verify.md](audits/2026-07-04-s13-t4-t5-visual-verify/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-04-s13-t6-visual-verify/verify.md](audits/2026-07-04-s13-t6-visual-verify/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-04-s13-t7-t9-visual-verify/verify.md](audits/2026-07-04-s13-t7-t9-visual-verify/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-04-silent-failure-rescan.md](audits/2026-07-04-silent-failure-rescan.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-05-req016-realmachine-batch/verify.md](audits/2026-07-05-req016-realmachine-batch/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-05-s17-t4-c28/verify.md](audits/2026-07-05-s17-t4-c28/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-05-s18-t1-req038/verify.md](audits/2026-07-05-s18-t1-req038/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-05-s18-t10-req032/verify.md](audits/2026-07-05-s18-t10-req032/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-05-s18-t2-req036/verify.md](audits/2026-07-05-s18-t2-req036/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-05-s18-t3-req037/verify.md](audits/2026-07-05-s18-t3-req037/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-05-s18-t7-req028/verify.md](audits/2026-07-05-s18-t7-req028/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-06-realmachine-vnext3/req024-run-report.md](audits/2026-07-06-realmachine-vnext3/req024-run-report.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-06-realmachine-vnext3/verify.md](audits/2026-07-06-realmachine-vnext3/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-06-s20-realmachine-vnext/verify.md](audits/2026-07-06-s20-realmachine-vnext/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-06-s21-realmachine-vnext2-challenge.md](audits/2026-07-06-s21-realmachine-vnext2-challenge.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-06-s21-realmachine-vnext2/verify.md](audits/2026-07-06-s21-realmachine-vnext2/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-07-b21-byok-realkey/verify.md](audits/2026-07-07-b21-byok-realkey/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-07-inperson-batch/verify.md](audits/2026-07-07-inperson-batch/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-07-req053-home-instance-loop.md](audits/2026-07-07-req053-home-instance-loop.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-07-req055-dev-verify/verify.md](audits/2026-07-07-req055-dev-verify/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-07-req059-060-t0-spike/verify.md](audits/2026-07-07-req059-060-t0-spike/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-07-req059-t1t3-realmachine/verify.md](audits/2026-07-07-req059-t1t3-realmachine/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-07-req060-confighook-spike/verify.md](audits/2026-07-07-req060-confighook-spike/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-07-req060-fanout-realmachine/verify.md](audits/2026-07-07-req060-fanout-realmachine/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-07-s29-verify/verify.md](audits/2026-07-07-s29-verify/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-08-g6-realmachine-batch/verify.md](audits/2026-07-08-g6-realmachine-batch/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-08-s30-req060-realmachine/verify.md](audits/2026-07-08-s30-req060-realmachine/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-08-shipped-verify-batch/verify.md](audits/2026-07-08-shipped-verify-batch/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-09-s33-realmachine/verify.md](audits/2026-07-09-s33-realmachine/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-09-s34-realmachine/verify.md](audits/2026-07-09-s34-realmachine/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-09-s37-req078/verify.md](audits/2026-07-09-s37-req078/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-09-s38-supply-baseline/verify.md](audits/2026-07-09-s38-supply-baseline/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-09-windows-portability-audit.md](audits/2026-07-09-windows-portability-audit.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-10-s39-req083/verify.md](audits/2026-07-10-s39-req083/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-12-req005-legacy-baseline.md](audits/2026-07-12-req005-legacy-baseline.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-12-req087-legacy-session-adapter.md](audits/2026-07-12-req087-legacy-session-adapter.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-13-s48-req088-t2-session-workspace.md](audits/2026-07-13-s48-req088-t2-session-workspace.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-13-s48-req088-t3t4-live-adapter-comparison.md](audits/2026-07-13-s48-req088-t3t4-live-adapter-comparison.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-13-s48-req088-t6-takeover-coexistence.md](audits/2026-07-13-s48-req088-t6-takeover-coexistence.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-13-s49-req102a-cas-seed-gc.md](audits/2026-07-13-s49-req102a-cas-seed-gc.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-13-s50-req103-slice1-ownership-datamodel.md](audits/2026-07-13-s50-req103-slice1-ownership-datamodel.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-13-s50-req103-slice2a-governance-ipc-ac3-ac4.md](audits/2026-07-13-s50-req103-slice2a-governance-ipc-ac3-ac4.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-14-s50-rename-acceptance-o4-phantom-ledger.md](audits/2026-07-14-s50-rename-acceptance-o4-phantom-ledger.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [audits/2026-07-18-req395-engine-config-load.md](audits/2026-07-18-req395-engine-config-load.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [audits/2026-07-21-north-star-guard-upstream-delta.md](audits/2026-07-21-north-star-guard-upstream-delta.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [audits/2026-07-28-652-engine-generation-split-incident.md](audits/2026-07-28-652-engine-generation-split-incident.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [audits/2026-08-05-claude-plugin-agent-frontmatter-distribution.md](audits/2026-08-05-claude-plugin-agent-frontmatter-distribution.md) | ⚠️ 缺 summary | ? |

### contracts

| id | 文件 | 做什么 | 状态 |
| --- | --- | --- | --- |
| `CONTRACT-alpha-code-artifact-office-open-gate` | [contracts/artifact-office-open-gate.md](contracts/artifact-office-open-gate.md) | Artifact Office external-open gate | active |
| `CONTRACT-alpha-code-byok-availability` | [contracts/byok-availability.md](contracts/byok-availability.md) | BYOK selectability and executability (two predicates) | active |
| `CONTRACT-alpha-code-catalog-channel-consumption` | [contracts/catalog-channel-consumption.md](contracts/catalog-channel-consumption.md) | Catalog channel consumption (A-side routing & fallback) | active |
| `CONTRACT-alpha-code-desktop-release-manifest` | [contracts/desktop-release-manifest.md](contracts/desktop-release-manifest.md) | Desktop release manifest v1 (signed, machine-consumable) | active |
| `CONTRACT-alpha-code-engine-config-channels` | [contracts/engine-config-channels.md](contracts/engine-config-channels.md) | Engine config channels (v1/v2 dual-generation contract) | active |
| `CONTRACT-alpha-code-extension-capability-authorization` | [contracts/extension-capability-authorization.md](contracts/extension-capability-authorization.md) | Extension capability authorization (capability→authorize gate) | active |
| `CONTRACT-alpha-code-extension-cas-seed` | [contracts/extension-cas-seed.md](contracts/extension-cas-seed.md) | Extension CAS, packaged seed and GC (REQ-102 A-side) | active |
| `CONTRACT-alpha-code-extension-install-ledger` | [contracts/extension-install-ledger.md](contracts/extension-install-ledger.md) | Extension install ledger ownership and fail-closed commit | active |
| `CONTRACT-alpha-code-extension-package-lifecycle` | [contracts/extension-package-lifecycle.md](contracts/extension-package-lifecycle.md) | Extension package lifecycle — update, uninstall, and shared-child claims | active |
| `CONTRACT-alpha-code-host-extension-package-v1` | [contracts/host-extension-package-v1.md](contracts/host-extension-package-v1.md) | HostExtensionPackageV1 artifact index | active |
| `CONTRACT-alpha-code-permission-risk-classification` | [contracts/permission-risk-classification.md](contracts/permission-risk-classification.md) | 授权提示的风险分类(v1 `metadata.codepuppyRisk`) | active |
| `CONTRACT-alpha-code-platform-endpoint-discovery` | [contracts/platform-endpoint-discovery.md](contracts/platform-endpoint-discovery.md) | Code Puppy platform endpoint and model discovery | active |
| `CONTRACT-alpha-code-platform-integration` | [contracts/platform-integration.md](contracts/platform-integration.md) | Code Puppy platform integration | active |
| `CONTRACT-alpha-code-recovery-adapter` | [contracts/recovery-adapter.md](contracts/recovery-adapter.md) | Recovery adapter contract | active |
| `CONTRACT-alpha-code-session-permission` | [contracts/session-permission.md](contracts/session-permission.md) | Session permission contract | active |
| `CONTRACT-alpha-code-settings-and-extension-storage-adapters` | [contracts/settings-and-extension-storage-adapters.md](contracts/settings-and-extension-storage-adapters.md) | Settings and extension storage typed adapters | active |
| `CONTRACT-alpha-code-tool-policy` | [contracts/tool-policy.md](contracts/tool-policy.md) | Hierarchical tool policy contract (REQ-131) | active |

### design

| id | 文件 | 做什么 | 状态 |
| --- | --- | --- | --- |
| `⚠️ 缺 id` | [design/2026-06-22-arch-extension-hub.md](design/2026-06-22-arch-extension-hub.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [design/2026-06-25-cool-graphite-visual-system.md](design/2026-06-25-cool-graphite-visual-system.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [design/2026-06-27-model-picker-redesign/spec.md](design/2026-06-27-model-picker-redesign/spec.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [design/2026-06-29-llm-auth-routing/design.md](design/2026-06-29-llm-auth-routing/design.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [design/2026-07-03-frontend-decoupling-options.md](design/2026-07-03-frontend-decoupling-options.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [design/2026-07-04-extension-hub-v3-universal.md](design/2026-07-04-extension-hub-v3-universal.md) | ⚠️ 缺 summary | approved-direction |
| `⚠️ 缺 id` | [design/2026-07-05-db-safety-belt.md](design/2026-07-05-db-safety-belt.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [design/2026-07-07-project-alpha-only-extensions.md](design/2026-07-07-project-alpha-only-extensions.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [design/2026-07-09-supply-baseline-curation-proposal.md](design/2026-07-09-supply-baseline-curation-proposal.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [design/2026-07-15-capability-authorize-dialog/design.md](design/2026-07-15-capability-authorize-dialog/design.md) | ⚠️ 缺 summary | accepted(2026-07-15 用户批准:Q1 场景化文案、Q2 首装必弹、Q3 bundle 全有或全无均接受;实现落 PR 见 |
| `⚠️ 缺 id` | [design/2026-07-21-req053-bootstrap-loop-hardening.md](design/2026-07-21-req053-bootstrap-loop-hardening.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [design/2026-07-22-c21-a11y-baseline/baseline.md](design/2026-07-22-c21-a11y-baseline/baseline.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/2026-07-22-e7-cloud-web-search-baseline.md](design/2026-07-22-e7-cloud-web-search-baseline.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/2026-07-22-req089-route-manifest-authority/baseline.md](design/2026-07-22-req089-route-manifest-authority/baseline.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/2026-07-22-upload-consent-ux/design.md](design/2026-07-22-upload-consent-ux/design.md) | ⚠️ 缺 summary | draft(等 owner 评审;实现票见 alpha-code#225 / 父需求 alpha-work#10) |
| `⚠️ 缺 id` | [design/2026-07-23-startup-availability-baseline.md](design/2026-07-23-startup-availability-baseline.md) | ⚠️ 缺 summary | approved |
| `⚠️ 缺 id` | [design/2026-07-24-session-seam-baseline.md](design/2026-07-24-session-seam-baseline.md) | ⚠️ 缺 summary | frozen |
| `⚠️ 缺 id` | [design/2026-07-28-req126-artifacts-cross-run.md](design/2026-07-28-req126-artifacts-cross-run.md) | ⚠️ 缺 summary | draft |
| `⚠️ 缺 id` | [design/2026-07-28-req126-shell-navigation-baseline.md](design/2026-07-28-req126-shell-navigation-baseline.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/2026-07-30-req128-extension-package-baseline.md](design/2026-07-30-req128-extension-package-baseline.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/2026-07-31-tool-identity-baseline.md](design/2026-07-31-tool-identity-baseline.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/2026-08-02-req128-phase3-local-claude-plugin-import.md](design/2026-08-02-req128-phase3-local-claude-plugin-import.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/2026-08-03-req128-phase4-managed-npm-plugin.md](design/2026-08-03-req128-phase4-managed-npm-plugin.md) | ⚠️ 缺 summary | superseded |
| `⚠️ 缺 id` | [design/2026-08-04-external-package-adapter-baseline.md](design/2026-08-04-external-package-adapter-baseline.md) | ⚠️ 缺 summary | draft |
| `⚠️ 缺 id` | [design/2026-08-08-req125-tool-card-provenance/design.md](design/2026-08-08-req125-tool-card-provenance/design.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/2026-08-25-req131-settings-tool-policy/design.md](design/2026-08-25-req131-settings-tool-policy/design.md) | ⚠️ 缺 summary | approved |
| `⚠️ 缺 id` | [design/2026-08-28-req108-rail-file-viewer/design.md](design/2026-08-28-req108-rail-file-viewer/design.md) | ⚠️ 缺 summary | proposed |
| `⚠️ 缺 id` | [design/2026-08-28-req140-rail-width/design.md](design/2026-08-28-req140-rail-width/design.md) | ⚠️ 缺 summary | proposed |
| `⚠️ 缺 id` | [design/2026-08-29-req123-office-extraction/baseline.md](design/2026-08-29-req123-office-extraction/baseline.md) | ⚠️ 缺 summary | proposed |
| `⚠️ 缺 id` | [design/2026-09-09-req159-process-fence-baseline.md](design/2026-09-09-req159-process-fence-baseline.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/2026-09-10-req159-sandbox-disclosure/design.md](design/2026-09-10-req159-sandbox-disclosure/design.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/2026-09-11-req160-empty-turn-row/design.md](design/2026-09-11-req160-empty-turn-row/design.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/2026-09-17-req226-custom-provider-keychain-baseline.md](design/2026-09-17-req226-custom-provider-keychain-baseline.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/2026-09-19-req160-send-blocked-notice/design.md](design/2026-09-19-req160-send-blocked-notice/design.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/2026-09-21-1383-custom-provider-address-truth-baseline.md](design/2026-09-21-1383-custom-provider-address-truth-baseline.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/2026-09-22-1399-turn-running-indicator/design.md](design/2026-09-22-1399-turn-running-indicator/design.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/2026-09-23-1414-web-tools-account-routing-baseline.md](design/2026-09-23-1414-web-tools-account-routing-baseline.md) | ⚠️ 缺 summary | proposed |
| `⚠️ 缺 id` | [design/2026-09-23-model-chosen-egress-baseline.md](design/2026-09-23-model-chosen-egress-baseline.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/2026-09-29-req106-unsigned-windows-manual-distribution.md](design/2026-09-29-req106-unsigned-windows-manual-distribution.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/2026-10-10-timeline-process-fold/design.md](design/2026-10-10-timeline-process-fold/design.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/2026-10-14-req234-hub-agent-install-baseline.md](design/2026-10-14-req234-hub-agent-install-baseline.md) | ⚠️ 缺 summary | proposed |
| `⚠️ 缺 id` | [design/2026-10-14-req235-cloud-capability-profile-baseline.md](design/2026-10-14-req235-cloud-capability-profile-baseline.md) | ⚠️ 缺 summary | proposed |
| `⚠️ 缺 id` | [design/2026-10-30-req236-permission-cards/notes.md](design/2026-10-30-req236-permission-cards/notes.md) | ⚠️ 缺 summary | draft |
| `⚠️ 缺 id` | [design/2026-10-30-req236-ux-config-pages/audit.md](design/2026-10-30-req236-ux-config-pages/audit.md) | ⚠️ 缺 summary | draft |
| `⚠️ 缺 id` | [design/2026-10-30-req236-ux-core-pages/audit.md](design/2026-10-30-req236-ux-core-pages/audit.md) | ⚠️ 缺 summary | draft |
| `⚠️ 缺 id` | [design/2026-11-08-1662-opencode2-capability-inventory.md](design/2026-11-08-1662-opencode2-capability-inventory.md) | ⚠️ 缺 summary | proposed |
| `⚠️ 缺 id` | [design/2026-11-08-1662-opencode2-generation-switch-baseline.md](design/2026-11-08-1662-opencode2-generation-switch-baseline.md) | ⚠️ 缺 summary | proposed |
| `⚠️ 缺 id` | [design/2026-11-08-1662-opencode2-rulings.md](design/2026-11-08-1662-opencode2-rulings.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/2026-11-09-1662-lane-seams.md](design/2026-11-09-1662-lane-seams.md) | ⚠️ 缺 summary | proposed |
| `⚠️ 缺 id` | [design/2026-11-09-1668-l6-engine-dependency-inventory.md](design/2026-11-09-1668-l6-engine-dependency-inventory.md) | ⚠️ 缺 summary | proposed |
| `⚠️ 缺 id` | [design/2026-11-09-1668-l6-ui-stays-alpha.md](design/2026-11-09-1668-l6-ui-stays-alpha.md) | ⚠️ 缺 summary | proposed |
| `⚠️ 缺 id` | [design/PAGE-MAP.md](design/PAGE-MAP.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/codepuppy-runtime-authority.md](design/codepuppy-runtime-authority.md) | ⚠️ 缺 summary | draft |
| `⚠️ 缺 id` | [design/consume-alpha-contracts-v1.plan.md](design/consume-alpha-contracts-v1.plan.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [design/create-upload-manifest-v1.plan.md](design/create-upload-manifest-v1.plan.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [design/current/artifact-workbench/components.md](design/current/artifact-workbench/components.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/current/composer/components.md](design/current/composer/components.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/current/conversation-timeline/components.md](design/current/conversation-timeline/components.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/current/customization-center/components.md](design/current/customization-center/components.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/current/model-picker/components.md](design/current/model-picker/components.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/current/session-workspace/components.md](design/current/session-workspace/components.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/current/settings/components.md](design/current/settings/components.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/current/shell-sidebar/components.md](design/current/shell-sidebar/components.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/debates/2026-07-05-c28-honest-controls-brief.md](design/debates/2026-07-05-c28-honest-controls-brief.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [design/debates/2026-07-05-req008-positioning-briefs.md](design/debates/2026-07-05-req008-positioning-briefs.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [design/extension-hub.md](design/extension-hub.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [design/req-133-office-four-format-hub.md](design/req-133-office-four-format-hub.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/req-134-mcp-workspace-follows-instance.md](design/req-134-mcp-workspace-follows-instance.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/req-135-retire-community-excel.md](design/req-135-retire-community-excel.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/req-136-project-mcp-install.md](design/req-136-project-mcp-install.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/req-144-login-minted-mcp-access.md](design/req-144-login-minted-mcp-access.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [design/req-153-output-capability.md](design/req-153-output-capability.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [design/req-155-office-connector-follows-instance.md](design/req-155-office-connector-follows-instance.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [design/req236-catalog-and-model.md](design/req236-catalog-and-model.md) | ⚠️ 缺 summary | draft |
| `⚠️ 缺 id` | [design/req236-engine-lifecycle.md](design/req236-engine-lifecycle.md) | ⚠️ 缺 summary | draft |
| `⚠️ 缺 id` | [design/req236-network-diagnosis.md](design/req236-network-diagnosis.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [design/req236-permissions-and-provenance.md](design/req236-permissions-and-provenance.md) | ⚠️ 缺 summary | draft |
| `⚠️ 缺 id` | [design/req236-results-and-attachments.md](design/req236-results-and-attachments.md) | ⚠️ 缺 summary | draft |
| `⚠️ 缺 id` | [design/system/color.md](design/system/color.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/system/components.md](design/system/components.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/system/contributing.md](design/system/contributing.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/system/patterns.md](design/system/patterns.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/system/principles.md](design/system/principles.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/system/replacing-opencode.md](design/system/replacing-opencode.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [design/system/tokens.md](design/system/tokens.md) | ⚠️ 缺 summary | active |

### retrospectives

| id | 文件 | 做什么 | 状态 |
| --- | --- | --- | --- |
| `⚠️ 缺 id` | [retrospectives/2026-07-02-upstream-sync-546.md](retrospectives/2026-07-02-upstream-sync-546.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [retrospectives/2026-07-05-s12-s17-arc.md](retrospectives/2026-07-05-s12-s17-arc.md) | ⚠️ 缺 summary | ? |

### runbooks

| id | 文件 | 做什么 | 状态 |
| --- | --- | --- | --- |
| `RUNBOOK-alpha-code-artifact-quota-reservation-recovery` | [runbooks/artifact-quota-reservation-recovery.md](runbooks/artifact-quota-reservation-recovery.md) | Artifact quota reservation recovery | active |
| `RUNBOOK-alpha-code-ci` | [runbooks/ci.md](runbooks/ci.md) | CI 规范（Code Puppy） | active |
| `RUNBOOK-alpha-code-distribution` | [runbooks/distribution.md](runbooks/distribution.md) | Mac release runbook (signing, notarization, auto-update) | active |
| `RUNBOOK-alpha-code-extension-tx-journal` | [runbooks/extension-tx-journal.md](runbooks/extension-tx-journal.md) | Extension transaction journal diagnosis | active |
| `RUNBOOK-alpha-code-model-catalog-updates` | [runbooks/model-catalog-updates.md](runbooks/model-catalog-updates.md) | Model catalog updates (platform proxy & BYOK) | active |
| `RUNBOOK-alpha-code-naming-migration` | [runbooks/naming-migration.md](runbooks/naming-migration.md) | 升级到新名字:首次启动的数据迁移与回退 | active |
| `RUNBOOK-alpha-code-settings-storage-recovery` | [runbooks/settings-storage-recovery.md](runbooks/settings-storage-recovery.md) | Settings storage recovery | active |
| `RUNBOOK-alpha-code-uninstall` | [runbooks/uninstall.md](runbooks/uninstall.md) | 卸载 Code Puppy 与数据残留清单(C16) | active |
| `⚠️ 缺 id` | [runbooks/upstream-update.md](runbooks/upstream-update.md) | ⚠️ 缺 summary | active |

### specs

| id | 文件 | 做什么 | 状态 |
| --- | --- | --- | --- |
| `DESIGN-1662-opencode2` | [specs/1662-opencode2/design.md](specs/1662-opencode2/design.md) | alpha-code#1662 各实施线需要冻结的技术决定,按决定分段;目前含「MCP OAuth on OpenCode 2」—— 远端 MCP 登录改走引擎 2.x 的集成 OAuth,围栏不开口,回调页沿用 ADR-042 接管 | draft |
| `PLAN-1662-opencode2-parity` | [specs/1662-opencode2/plan-parity.md](specs/1662-opencode2/plan-parity.md) | alpha-code#1662 对账遗留的九项行为(web search 失败诚实与「没搜 / 没搜到」、三档权限矩阵与两条委派入口、长期记忆接缝、云连接器凭据现读、平台凭据错误不重试、改名后的三条续写、停止释放待审批回合、web search 副本普查与账户态工具表合成)逐项在 2.x 上补证明或实测报告;外加六个仍指向已删 v1 引擎的测试移植到 2.x 宿主 | active |
| `PLAN-1662-opencode2-project-config` | [specs/1662-opencode2/plan-project-config.md](specs/1662-opencode2/plan-project-config.md) | alpha-code#1662 跟进(lane/1662-project-config)——项目 `.codepuppy/codepuppy.jsonc` 的四个缺陷:同意后项目 agent 的权限规则不生效、JSONC 读法改坏字符串、项目 MCP 字段丢失或形状不对、项目 agent 的旧 provider id 不改名 | active |
| `PLAN-1662-opencode2` | [specs/1662-opencode2/plan.md](specs/1662-opencode2/plan.md) | alpha-code#1662 各实施线的分段计划;目前含 L4(#1666)Unit B(具名失败原因到桌面)与 Unit C(MCP 与内置重名、子任务与附件、命令模型优先级、工具网络失败标记);以及整合 Unit 1(真策略进 ext、登记册握满、引擎开启回合的审阅 diff、接缝文档补记) | active |
| `SPEC-account-balance-presentation` | [specs/account-balance-presentation/spec.md](specs/account-balance-presentation/spec.md) | 账户面板按订阅与余额显示真实状态，按历史条文与实际证明登记范围。 | approved |
| `SPEC-agent-approved-extension-install` | [specs/agent-approved-extension-install/spec.md](specs/agent-approved-extension-install/spec.md) | 目录查询、授权确认、安装状态和当前会话中后续使用。 | approved |
| `SPEC-atomic-extension-lifecycle` | [specs/atomic-extension-lifecycle/spec.md](specs/atomic-extension-lifecycle/spec.md) | 扩展安装失败可恢复且不会留下半装状态，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-bounded-artifact-preview` | [specs/bounded-artifact-preview/spec.md](specs/bounded-artifact-preview/spec.md) | 常见产物按安全边界预览，超限有明确说明，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-build-identity` | [specs/build-identity/spec.md](specs/build-identity/spec.md) | 报问题时能复制准确的构建身份，验收边界来自原始需求。 | approved |
| `SPEC-byok-output-limits` | [specs/byok-output-limits/spec.md](specs/byok-output-limits/spec.md) | 自带密钥的模型按自己的实测上限输出，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-child-process-write-fence` | [specs/child-process-write-fence/spec.md](specs/child-process-write-fence/spec.md) | 连接器与语言服务的子进程也受写入范围约束，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-cloud-job-desktop-notifications` | [specs/cloud-job-desktop-notifications/spec.md](specs/cloud-job-desktop-notifications/spec.md) | 用户能收到任务结果并在桌面设置里关闭通知。 | approved |
| `SPEC-connector-workspace-following` | [specs/connector-workspace-following/spec.md](specs/connector-workspace-following/spec.md) | 连接器跟随当前会话所在项目目录，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-context-injection-budgets` | [specs/context-injection-budgets/spec.md](specs/context-injection-budgets/spec.md) | 应用注入的对话内容有明确大小上限，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-conversation-overlays` | [specs/conversation-overlays/spec.md](specs/conversation-overlays/spec.md) | 统一对话浮层交互，并让用户批准工具时还能翻看时间线。 | approved |
| `SPEC-conversation-process-fold` | [specs/conversation-process-fold/spec.md](specs/conversation-process-fold/spec.md) | 把回答前的工作步骤收成一行，用户可展开核对，回答和待处理操作保持可见。 | approved |
| `SPEC-current-turn-file-review` | [specs/current-turn-file-review/spec.md](specs/current-turn-file-review/spec.md) | 右栏审查显示本回合的真实文件修改，按历史条文与实际证明登记范围。 | draft |
| `SPEC-custom-provider-keychain` | [specs/custom-provider-keychain/spec.md](specs/custom-provider-keychain/spec.md) | 自定义模型密钥由系统安全存储保护，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-desktop-navigation` | [specs/desktop-navigation/spec.md](specs/desktop-navigation/spec.md) | 新对话、项目切换和搜索入口真正可用，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-document-authoring-guidance` | [specs/document-authoring-guidance/spec.md](specs/document-authoring-guidance/spec.md) | 文档任务使用完整的产出质量指导，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-draft-to-session` | [specs/draft-to-session/spec.md](specs/draft-to-session/spec.md) | 未发送草稿可在正式路由里转成对话，保留历史条款、有效裁决和交付证据边界。 | approved |
| `PLAN-error-message-lifetime` | [specs/error-message-lifetime/plan.md](specs/error-message-lifetime/plan.md) | alpha-code#1687 两段:弹出提示的去留与同因合并;未恢复问题入口与启动静默 | active |
| `SPEC-error-message-lifetime` | [specs/error-message-lifetime/spec.md](specs/error-message-lifetime/spec.md) | 桌面端用户看到的报错,恢复了就自己消失,没恢复的收进一个安静的入口,启动时不再冒出一堆 | approved |
| `SPEC-extension-environments` | [specs/extension-environments/spec.md](specs/extension-environments/spec.md) | 开发、测试与正式扩展状态相互隔离，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-extension-install-intents` | [specs/extension-install-intents/spec.md](specs/extension-install-intents/spec.md) | 扩展安装由主程序校验并按项目隔离，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-extension-ownership-and-grants` | [specs/extension-ownership-and-grants/spec.md](specs/extension-ownership-and-grants/spec.md) | 扩展来源与授权范围可准确判断和管控，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-extension-presentation-metadata` | [specs/extension-presentation-metadata/spec.md](specs/extension-presentation-metadata/spec.md) | 定制中心条目显示开发者与说明等来源信息，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-home-session-creation` | [specs/home-session-creation/spec.md](specs/home-session-creation/spec.md) | 用户从首页可靠开始新对话，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-isolated-html-preview` | [specs/isolated-html-preview/spec.md](specs/isolated-html-preview/spec.md) | 网页产物可静态查看且不能访问应用或网络，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-large-project-directories` | [specs/large-project-directories/spec.md](specs/large-project-directories/spec.md) | 打开巨大目录不会启动无界扫描，保留历史条款、有效裁决和交付证据边界。 | draft |
| `SPEC-local-cloud-task-routing` | [specs/local-cloud-task-routing/spec.md](specs/local-cloud-task-routing/spec.md) | 助手根据任务选择本机或云端处理，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-local-memory` | [specs/local-memory/spec.md](specs/local-memory/spec.md) | 本机记忆可查看、修改、删除并按项目用于对话，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-office-content-preview` | [specs/office-content-preview/spec.md](specs/office-content-preview/spec.md) | Office 文件内容可在应用内安全查看，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-office-layout-preview` | [specs/office-layout-preview/spec.md](specs/office-layout-preview/spec.md) | Office 文件在隔离预览里显示真实版式，按历史条文与实际证明登记范围。 | approved |
| `SPEC-opencode-generation-switch` | [specs/opencode-generation-switch/spec.md](specs/opencode-generation-switch/spec.md) | 升级引擎后保留当前桌面体验与整体撤回能力，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-owned-route-surfaces` | [specs/owned-route-surfaces/spec.md](specs/owned-route-surfaces/spec.md) | 应用页面通过受控入口接入导航，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-owned-session-page` | [specs/owned-session-page/spec.md](specs/owned-session-page/spec.md) | 会话页保持自己的完整交互与工具卡，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-owned-settings-and-dialogs` | [specs/owned-settings-and-dialogs/spec.md](specs/owned-settings-and-dialogs/spec.md) | 设置、模型选择、审批与恢复使用一致交互，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-permission-risk-classification` | [specs/permission-risk-classification/spec.md](specs/permission-risk-classification/spec.md) | 高风险动作在执行前先完成分类，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-permission-risk-display` | [specs/permission-risk-display/spec.md](specs/permission-risk-display/spec.md) | 用户在授权时能看出动作的风险档位，保留历史条款、有效裁决和交付证据边界。 | draft |
| `SPEC-project-agent-fields` | [specs/project-agent-fields/spec.md](specs/project-agent-fields/spec.md) | 项目文档里给 agent 写的 disable、tools、temperature 等字段在新引擎上重新生效,用不上的字段有记录可查 | approved |
| `SPEC-project-mcp-installation` | [specs/project-mcp-installation/spec.md](specs/project-mcp-installation/spec.md) | 连接器可装到全局或当前项目并保持隔离，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-puppy-brand-icons` | [specs/puppy-brand-icons/spec.md](specs/puppy-brand-icons/spec.md) | 应用和各渠道使用一致的小狗标志，保留历史条款、有效裁决和交付证据边界。 | approved |
| `DESIGN-remote-database-connector` | [specs/remote-database-connector/design.md](specs/remote-database-connector/design.md) | 用户在连接器窗口填写并确认的「地址:端口」写进只有主进程能写的目标真源,作为动态半场的成员进入策略代理的放行集合;连接器进程里的隧道垫片把数据库驱动的 TCP 连接改走现有 CONNECT 代理,seatbelt 围栏一字不改;只读靠 DBHub 只读配置加只读事务,能约束整棵进程树的只有数据库账号权限;密码沿用官方连接器密钥保管;Windows/Linux 本期不交付 | draft |
| `SPEC-remote-database-connector` | [specs/remote-database-connector/spec.md](specs/remote-database-connector/spec.md) | 用户可在安全边界内连接自己的远程数据库，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-resident-project-watchers` | [specs/resident-project-watchers/spec.md](specs/resident-project-watchers/spec.md) | 长期使用项目时监听与内存保持受控，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-responsive-session-rail` | [specs/responsive-session-rail/spec.md](specs/responsive-session-rail/spec.md) | 右栏可以调宽并为聊天区保留空间，按历史条文与实际证明登记范围。 | approved |
| `SPEC-route-manifest-authority` | [specs/route-manifest-authority/spec.md](specs/route-manifest-authority/spec.md) | 应用导航由一份页面清单决定，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-session-results-workspace` | [specs/session-results-workspace/spec.md](specs/session-results-workspace/spec.md) | 会话右栏统一查看文件、产物和修改，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-startup-model-availability` | [specs/startup-model-availability/spec.md](specs/startup-model-availability/spec.md) | 启动时及时出现可用模型且不显示虚假失败，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-timeline-artifact-links` | [specs/timeline-artifact-links/spec.md](specs/timeline-artifact-links/spec.md) | 对话中的本地产物可以直接打开右栏预览，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-tool-card-provenance` | [specs/tool-card-provenance/spec.md](specs/tool-card-provenance/spec.md) | 工具卡按真实来源展示调用并保护敏感字段，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-tool-inventory-identity` | [specs/tool-inventory-identity/spec.md](specs/tool-inventory-identity/spec.md) | 工具清单和授权身份随实际来源变化，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-tool-network-egress` | [specs/tool-network-egress/spec.md](specs/tool-network-egress/spec.md) | 本机工具只连接获准的网络目的地，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-tool-permission-policy` | [specs/tool-permission-policy/spec.md](specs/tool-permission-policy/spec.md) | 用户可按来源、服务和工具设置停用、询问或允许，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-tool-policy-settings` | [specs/tool-policy-settings/spec.md](specs/tool-policy-settings/spec.md) | 用户在设置里管理并保存工具权限，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-tool-write-fence` | [specs/tool-write-fence/spec.md](specs/tool-write-fence/spec.md) | 工具派生进程越界写文件时会失败，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-unattended-run-permissions` | [specs/unattended-run-permissions/spec.md](specs/unattended-run-permissions/spec.md) | 自动化任务遇到需要批准的工具时立即按权限裁决,允许的直接执行,不允许的立即说明原因,不再等 300 秒后失败 | approved |
| `SPEC-untrusted-upstream-candidates` | [specs/untrusted-upstream-candidates/spec.md](specs/untrusted-upstream-candidates/spec.md) | 上游候选代码无法取得仓库推送凭据，保留历史条款、有效裁决和交付证据边界。 | approved |
| `DESIGN-upgrade-bootstrap-config` | [specs/upgrade-bootstrap-config/design.md](specs/upgrade-bootstrap-config/design.md) | 主进程今天经二十多个 CODEPUPPY_* 环境变量、启动命令、sidecar 进程内环境把决定交给 sidecar、引擎与 ext;收成一份有类型、有版本、每代 sidecar 一份、只在内存里的启动文档,环境变量只留给非 Code Puppy 的读者;最后一片给引擎换上 Code Puppy 自有的全局配置目录,首次切换时把独立 OpenCode 的全局内容复制一份过来 | approved |
| `DESIGN-upgrade-extension-manifest` | [specs/upgrade-extension-manifest/design.md](specs/upgrade-extension-manifest/design.md) | Code Puppy 带进引擎的工具、MCP、插件、agent、技能、命令,今天经十条路径、五个读法、两套 v1→2.x 翻译进入引擎;收成一份 Code Puppy 自有的登记集合(内存里一个类型)、一份文档字段表与一个读取器、一张准入表和每类一个登记器;磁盘上的文件不改形状,用户文档照 I-07 G4 由引擎直接读,项目文档改用引擎自己的归一化读 | approved |
| `DESIGN-upgrade-fewer-takeovers` | [specs/upgrade-fewer-takeovers/design.md](specs/upgrade-fewer-takeovers/design.md) | 逐项裁定 12 个上游接管文件与文本级权宜做法的去留;「本次会话内允许」做进已接管的权限内核(连带只限本会话、不放行 Code Puppy 策略请求),读目录卡改由扩展从结构化结果生成;失败码保留文字前缀并统一读法;接管块形状与记录在案的上游基准、构建期改写登记与上游挂点需求清单 | approved |
| `PLAN-upgrade-fewer-takeovers` | [specs/upgrade-fewer-takeovers/plan.md](specs/upgrade-fewer-takeovers/plan.md) | I-05 本 lane 的三个切片:A「本次会话内允许」进已接管的权限内核(连带只限本会话、不放行 Code Puppy 策略请求,适配器删替身);C 失败码前缀的统一读法;B 读目录卡由扩展从结构化结果生成。切片 D 不在本 lane | active |
| `DESIGN-upgrade-ui-contract` | [specs/upgrade-ui-contract/design.md](specs/upgrade-ui-contract/design.md) | 界面与引擎之间的请求、事件、错误和形状定成 Code Puppy 自有的一份约定;引擎适配器拆成代际无关的约定与管道加每代一个翻译器;翻译器不再引冻结界面内部函数,Code Puppy 自有代码只经约定模块接触冻结的两个客户端包;冻结界面零字节改动 | approved |
| `PLAN-upstream-upgrade-readiness-i08` | [specs/upstream-upgrade-readiness/plan-i08.md](specs/upstream-upgrade-readiness/plan-i08.md) | INT-upstream-upgrade-readiness I-08 的隔离一半——ext、ui-mac 与 core / schema / plugin / ai 里的 Code Puppy 测试,在任何模块求值之前就把 HOME、XDG_*、OPENCODE_DB、TMPDIR 指进新建的临时根;每个包一条守卫测试 | active |
| `PLAN-upstream-upgrade-readiness-i09` | [specs/upstream-upgrade-readiness/plan-i09.md](specs/upstream-upgrade-readiness/plan-i09.md) | INT-upstream-upgrade-readiness I-09 的两段计划:旧名例外登记表改按内容定位(不再按行号);闸门文件登记簿的写回模式能处理已删文件,并把本分支的两道登记闸带回全绿 | active |
| `PLAN-upstream-upgrade-readiness` | [specs/upstream-upgrade-readiness/plan.md](specs/upstream-upgrade-readiness/plan.md) | INT-upstream-upgrade-readiness 先做批(I-02、I-03、I-08、I-09)的分段计划;目前含 I-03 上游行为探针 | active |
| `SPEC-visible-update-state` | [specs/visible-update-state/spec.md](specs/visible-update-state/spec.md) | 检查更新的状态与重启安装入口可见，按历史条文与实际证明登记范围。 | approved |
| `SPEC-windows-renderer-origins` | [specs/windows-renderer-origins/spec.md](specs/windows-renderer-origins/spec.md) | Windows 界面只能读取受准许的服务来源，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-word-layout-and-typography` | [specs/word-layout-and-typography/spec.md](specs/word-layout-and-typography/spec.md) | 生成的 Word 有正确中文字体、标题与纸张设置，保留历史条款、有效裁决和交付证据边界。 | approved |
| `SPEC-workspace-file-preview` | [specs/workspace-file-preview/spec.md](specs/workspace-file-preview/spec.md) | 用户在会话右栏安全查看工作区文件，保留历史条款、有效裁决和交付证据边界。 | approved |

### verification

| id | 文件 | 做什么 | 状态 |
| --- | --- | --- | --- |
| `⚠️ 缺 id` | [verification/2026-07-06-realmachine-vnext3-plan.md](verification/2026-07-06-realmachine-vnext3-plan.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [verification/2026-07-07-shipped-verification-matrix.md](verification/2026-07-07-shipped-verification-matrix.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [verification/2026-07-17-packaged-macos-rc-smoke.md](verification/2026-07-17-packaged-macos-rc-smoke.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [verification/2026-07-22-d5-playwright-kernel/c1-c2-download-observations.md](verification/2026-07-22-d5-playwright-kernel/c1-c2-download-observations.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [verification/2026-07-22-d5-playwright-kernel/verify.md](verification/2026-07-22-d5-playwright-kernel/verify.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [verification/2026-07-22-e7-deploy-probe.md](verification/2026-07-22-e7-deploy-probe.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [verification/2026-07-22-req005-packaged-evidence-index.md](verification/2026-07-22-req005-packaged-evidence-index.md) | ⚠️ 缺 summary | superseded |
| `⚠️ 缺 id` | [verification/2026-07-24-req109-110-pr3-longrun.md](verification/2026-07-24-req109-110-pr3-longrun.md) | ⚠️ 缺 summary | final |
| `⚠️ 缺 id` | [verification/2026-07-24-req109-110-t7-matrix.md](verification/2026-07-24-req109-110-t7-matrix.md) | ⚠️ 缺 summary | partial |
| `⚠️ 缺 id` | [verification/2026-07-24-req109-t1-startup-timelines.md](verification/2026-07-24-req109-t1-startup-timelines.md) | ⚠️ 缺 summary | final |
| `⚠️ 缺 id` | [verification/2026-07-24-req109-t6-mcp-default-deny.md](verification/2026-07-24-req109-t6-mcp-default-deny.md) | ⚠️ 缺 summary | final |
| `⚠️ 缺 id` | [verification/2026-07-24-req125-session-visual/harness-plan.md](verification/2026-07-24-req125-session-visual/harness-plan.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [verification/2026-07-24-req125-session-visual/invariant-checks.md](verification/2026-07-24-req125-session-visual/invariant-checks.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [verification/2026-07-24-req125-session-visual/matrix.md](verification/2026-07-24-req125-session-visual/matrix.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [verification/2026-07-25-startup-availability-packaged-smoke.md](verification/2026-07-25-startup-availability-packaged-smoke.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [verification/2026-07-28-652-packaged-three-sends.md](verification/2026-07-28-652-packaged-three-sends.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [verification/2026-07-30-req679-pricing-visual/matrix.md](verification/2026-07-30-req679-pricing-visual/matrix.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [verification/2026-07-31-req128-package-detail/matrix.md](verification/2026-07-31-req128-package-detail/matrix.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [verification/2026-08-02-req128-phase3-gate-bypass-matrix.md](verification/2026-08-02-req128-phase3-gate-bypass-matrix.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [verification/2026-08-02-req128-phase3-packaged-l2.md](verification/2026-08-02-req128-phase3-packaged-l2.md) | ⚠️ 缺 summary | partial |
| `⚠️ 缺 id` | [verification/2026-08-02-req128-t2-gate-bypass-experiments.md](verification/2026-08-02-req128-t2-gate-bypass-experiments.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [verification/2026-08-02-req128-t4-gate-bypass-experiments.md](verification/2026-08-02-req128-t4-gate-bypass-experiments.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [verification/2026-08-05-844-gate-exact-registry/verify.md](verification/2026-08-05-844-gate-exact-registry/verify.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [verification/2026-08-11-detect-failure-required-checks.md](verification/2026-08-11-detect-failure-required-checks.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [verification/2026-10-13-hub-copy-review.md](verification/2026-10-13-hub-copy-review.md) | ⚠️ 缺 summary | accepted |
| `⚠️ 缺 id` | [verification/2026-10-15-req233-cloud-routing-eval/results-2026-10-15-real-report.md](verification/2026-10-15-req233-cloud-routing-eval/results-2026-10-15-real-report.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [verification/2026-10-15-req233-cloud-routing-eval/results-2026-10-15-real-round2-report.md](verification/2026-10-15-req233-cloud-routing-eval/results-2026-10-15-real-round2-report.md) | ⚠️ 缺 summary | active |
| `⚠️ 缺 id` | [verification/2026-10-15-req233-cloud-routing-eval/results-2026-10-15T10-01-09-000Z.md](verification/2026-10-15-req233-cloud-routing-eval/results-2026-10-15T10-01-09-000Z.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [verification/2026-10-15-req233-cloud-routing-eval/results-2026-10-15T10-16-14-438Z.md](verification/2026-10-15-req233-cloud-routing-eval/results-2026-10-15T10-16-14-438Z.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [verification/2026-10-15-req233-cloud-routing-eval/results-2026-10-15T10-23-48Z-real-sample.md](verification/2026-10-15-req233-cloud-routing-eval/results-2026-10-15T10-23-48Z-real-sample.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [verification/2026-10-15-req233-cloud-routing-eval/results-2026-10-15T10-26-00Z-real-aborted.md](verification/2026-10-15-req233-cloud-routing-eval/results-2026-10-15T10-26-00Z-real-aborted.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [verification/2026-10-15-req233-cloud-routing-eval/results-2026-10-15T10-41-11Z-real-full.md](verification/2026-10-15-req233-cloud-routing-eval/results-2026-10-15T10-41-11Z-real-full.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [verification/2026-10-15-req233-cloud-routing-eval/results-2026-10-15T11-43-27Z-real-round2.md](verification/2026-10-15-req233-cloud-routing-eval/results-2026-10-15T11-43-27Z-real-round2.md) | ⚠️ 缺 summary | ? |
| `⚠️ 缺 id` | [verification/2026-11-09-1664-l2/upstream-workflows.md](verification/2026-11-09-1664-l2/upstream-workflows.md) | ⚠️ 缺 summary | active |

<!-- docs-index:end -->
