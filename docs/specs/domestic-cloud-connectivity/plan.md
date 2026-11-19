---
id: PLAN-domestic-cloud-connectivity
title: 国内云端入口自动选路 实施计划
summary: alpha-work#159 的 alpha-code 桌面切片：改动顺序、相关检查、运行中故障与路线文件围栏的证据；跨仓规格和设计只链接。
kind: plan
status: active
spec: impharaon/alpha-work:SPEC-domestic-cloud-connectivity
design: impharaon/alpha-work:DESIGN-domestic-cloud-connectivity
owners: [owner]
last_reviewed: 2026-11-19
---

# PLAN-domestic-cloud-connectivity｜国内云端入口自动选路 实施计划

## 桌面跟随中继入口并自动回直连

- 依据：[alpha-work#159](https://github.com/impharaon/alpha-work/issues/159) 的 alpha-code 切片；[规格 v1](https://github.com/impharaon/alpha-work/blob/f5ad266ef294aa23e448be1e0b7ed6728346e21b/docs/specs/domestic-cloud-connectivity/spec.md) AC-01、AC-02；[设计 @ 815d27adb080b42a237a862046eb73c9b5d528cf](https://github.com/impharaon/alpha-work/blob/815d27adb080b42a237a862046eb73c9b5d528cf/docs/specs/domestic-cloud-connectivity/design.md) §2.3 F-04～F-12、§4.3、§5、§6、§8、§10（R1-01/02/05 修正，R1-03 按收窄处置）。实现起点 `alpha-code@4f61fde5de427925876149d7d1e8769f7ceb0e29`；已读 R1 审查缓存 `~/.cache/alpha-orch/2026-11-19/review-relay/out.log`。
- 核对：IMPLEMENT — plan 654ffc4d39 · orchestrator / Claude Fable 5.2 · plan check passed（AC-01/AC-02 与设计 §8 每项证据均有会失败的证明；文件在允许范围内；未重述或改变决定）。冻结设计已并入 alpha-work main `2ead902`，技术内容相对所链 `815d27adb0` 不变。

本节只安排该仓的实施与证明，接口和失败边界以所链设计为准。PLAN 提交只含本文件，不改代码、不运行测试；后续实现也不承担 DNS、nginx、Worker、alpha-web 配置、发版或生产探针。更新源、安装包、GitHub raw 属另一切片。并行围栏项目的 `process-fence-*.ts`、`sidecar.ts`、`ipc.ts`、`workspace-write-probe.ts` 不改；`server.ts` / 必需的 `index.ts` 接线只落端点与出网目的地。

### 改动

下表路径均相对仓根；标“新”的测试文件只服务本切片，不引入测试框架或运行时依赖。

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/src/main/codepuppy-endpoints.ts` | 在既有端点权威内实现设计 §4.3 的路线导出、两入口探测、生命周期和原子路线文件；复用 `codepuppy-environment.ts` 的状态根/环境权威，不另推拓扑。 |
| `packages/ui-mac/src/main/codepuppy-auth.ts` | 落实 R1-05 的继承环境与应用自填值区分；应用自填地址取 preferred，保持凭据现有用途与热应用通道。 |
| `packages/ui-mac/src/main/codepuppy-bootstrap-build.ts`、`packages/util/src/codepuppy-bootstrap.ts` | 构建、严格解析设计新增的可选字段；换址只在 util 的 `routePlatformUrl` 实现。路线文件路径由端点权威提供，构建器不复制路径规则。 |
| `packages/ext/src/plugin.ts`、`packages/ext/src/cloud-vision.ts`、`packages/plugin/src/alpha-cloud-authority.ts` | 在指定三处发送缝调用唯一换址函数；模型先按原请求判平台身份并取凭据；MCP 定义、配置身份与 evidence 不随 transport URL 改动。 |
| `packages/ui-mac/src/main/server.ts` | 现有出网日志汇点接失败信号；`refreshConfiguredEgressDestinations` 复用 `egressDestinationFromBaseUrl` 派生 cloud-MCP 目的地；核实每代 fork 的地址赋值先于目的地派生和 bootstrap。 |
| `packages/ui-mac/src/main/index.ts`（仅实际需要的端点接线） | 若现有 `initEndpoints` 调用需要补入环境/日志装配，在原调用处接线，不改启动和围栏流程。 |
| `packages/ui-mac/src/main/codepuppy-cloud-events.ts`、`packages/ui-mac/src/main/codepuppy-cloud-jobs.ts` | R1-01：地址解析移至每次重连/重试发送边界；游标、准备后的 body 和幂等键沿用同一次操作。 |
| `packages/util/src/codepuppy-bootstrap.test.ts`、`packages/ui-mac/src/main/codepuppy-bootstrap-build.test.ts` | 扩展字段解析/构建与换址行为检查，保留现有无中继输入的断言。 |
| `packages/ui-mac/src/main/codepuppy-endpoints.test.ts`（仅如探测激活影响既有夹具） | 保留当前解析/发现断言；测试侧接管新激活的探测，确保旧 `.example` 夹具不产生未受控网络或遗留计时器。 |
| `packages/ui-mac/src/main/codepuppy-auth.cases.ts` / `.test.ts`、`codepuppy-cloud-jobs.cases.ts` / `.test.ts`（同目录） | 分别增加 R1-05 与两条提交重试路径的回归；宿主精确计数同步。 |
| `packages/ui-mac/src/main/endpoint-route.test.ts` / `.cases.ts`（新） | 隔离端点模块状态与探测计时器；六项路线权威检查，见证明表 R1～R6。 |
| `packages/ui-mac/src/main/relay-wiring.test.ts` / `.cases.ts`（新） | 三项生产装配检查：地址赋值顺序、cloud-MCP 出网派生、日志失败信号接线。通过 `spawnLocalServer` 的既有测试接缝观察，不以源码文本当行为证据。 |
| `packages/ui-mac/src/main/cloud-events-route.test.ts` / `.cases.ts`（新） | 一项真实订阅跨路线重连检查；与现有 SSE 纯解析测试分开，隔离 auth/logging 的桩。 |
| `packages/ui-mac/src/main/endpoint-route.engine.test.ts` / `.cases.ts`（新） | 六项运行中真实引擎检查 E1～E6，复用生产注入、真 ext、现有引擎 harness 和本地服务器。 |
| `packages/ui-mac/src/main/endpoint-route-fence.engine.test.ts` / `.cases.ts`（新） | 一项 darwin 真实 profile/原生围栏检查 F1，父进程保有路线写权，子进程读但不能改路线。 |
| `packages/ui-mac/test-component/codepuppy-bootstrap-fixture.ts`、`packages/ui-mac/test-component/codepuppy-engine.ts` | 仅让现有测试输入传递本次新增 bootstrap 字段；不另建一套引擎启动装配。 |
| `packages/ui-mac/src/main/fixtures/relay-route/`（需要的脱敏 wire 样本，新） | 保存健康响应等实际输入与来源元数据；优先复用既有 vendored producer fixtures。无日志、凭据或机器绝对路径入库。 |
| `scripts/gate-files.tsv` | 只同步下述相关精确条数和新宿主登记；不改门实现、不新增 CI job。 |
| `scripts/old-name-exceptions.tsv`（机械登记） | 保留真实健康响应及 provenance 的外部身份、gate 注释的跨仓票名；只登记本次新增命中。 |
| `docs/specs/domestic-cloud-connectivity/plan.md` | 首次实现提交补核对行；实际偏离与对应代码同提交记录。 |

### 顺序

1. **先跑已有相关检查，再提交回归测试。** 从下方检查清单开始。R1-01 在现有 cloud-jobs cases 增两条；R1-05 在 auth cases 增一条，分别在旧实现上记录实际失败后提交测试及宿主计数，不在修复提交修改它们的判据。SSE 的新宿主也先证明旧实现在重连后仍命中旧地址。若初始测试已有无关失败，依派单的 Handling problems 记录具名原因，不扩大修理范围。
2. **路线权威和启动文档一起落。** endpoints、auth、bootstrap 构建/解析、必要的端点接线与测试夹具输入同步；跑 R1～R6、util、auth、bootstrap-build 和已有 endpoints/discovery 检查。应用自填地址更新不依赖当前 route；本提交仍不把任何引擎缝切到另一代引擎 API。
3. **发送边界一起接通。** 三个引擎缝、server 的失败信号/云 MCP 出网派生、events/jobs 的重新解析同时落；跑上一提交的红测试、三项 wiring、SSE 宿主，以及相关 credential/MCP/vision 检查。已发送请求不由路线代码额外重放。
4. **完成真引擎和围栏证据。** 加 E1～E6 与 F1 的宿主、局部样本和 gate 登记；逐项保留原行为的反向证据。对新行为做有界反向验证（例如撤去换址调用、固定重试地址、漏派生 cloud-MCP），只恢复本 lane 自己的改动。日志写缓存，不运行全 gate。完成适用包 typecheck 和下表相关检查后，只提交并交编排器审查；推送、PR、合并、发版由编排器负责。

### 风险

1. **已有进程内状态会掩盖赋值缺陷。** 初次导入前准备继承环境；导出/未导出及混合组合用隔离子进程验证。用两次真实 spawn 装配核对新一代的地址、出网目的地与文档一致；不通过清空应用自填变量让测试“恢复”。
2. **探测与发现刷新可能交错。** R4/R6 覆盖在途探测合并、发现值更新后的旧探测完成、定时恢复；同时保留一条真实时钟证据核对设计的切换上界，不只靠假时钟或手改路线文件。
3. **凭据与 MCP authority 易被换址误伤。** E4/E5 在同一运行中引擎检查三处缝双向切换；额外向第三方、相似主机和兄弟路径发请求，判平台凭据零泄漏。只记合成凭据的匹配布尔值，不把 token 写日志。
4. **测试必须真正停在网络边界。** 四种故障用本地 TLS/HTTP 服务器和真 TCP 连接注入；健康路由单独保持可用。可用既有 provider `headerTimeout` / `chunkTimeout` 配置缩短测试等待，不新增生产超时开关、不修改默认预算。定时选路另保留实际时间测量。
5. **编译默认地址仍是正式域名。** 测试保留其字面值，通过测试侧受控 transport / CONNECT dial 将所有目标送往回环 stand-in，未知目标在拨号前拒绝；不得依赖正式 DNS、请求生产健康接口或改系统 hosts。接线证据另用生产代理的真实日志，不能只有直接调用 `noteRelayFailureSignal` 的单测。
6. **围栏证据不能被临时目录可写权放水。** F1 的状态根按真实布局生成，先核对不落 W1/W2/W3 的可写范围；使用这一代实际生成的 profile 和真实 addon。若该 profile 不能兑现设计，返回具体证据，不修改并行 lane 的围栏文件。
7. **体量与集成。** 这是 M/L 跨四包改动，主要增量应是测试；server/index 只留端点/出网接线以便与并行 lane 合并。实现开始重新记时，每项证据后核对；预计时间/体量翻倍或冻结接口不足时返回具体 blocker。主进程体积棘轮若报告本次净增，向编排器提供文件级增量与理由，不顺手拆模块或改基线。

### 证明

以下名称是实施时要落实的检查项，不表示本次 PLAN 已运行或通过。`.cases.ts` 一律只由其同名 `.test.ts` 宿主运行。

| AC / 证据项 | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01、AC-02 · R1 无中继惰性 | `endpoint-route.test.ts`：无发现、发现仍为默认、显式 env 覆盖（含继承的两个引擎地址）表；观察探针次数、计时器/路线文件副作用、解析结果 | 把应用自填误认用户导出、无中继仍发探针或重写地址，都会与默认行为/零副作用断言冲突。 |
| AC-01、AC-02 · R2 解析 | 同宿主：pin/discovery/env 层级；preferred 与 active 对照；platform/cloud/mcp 同步变化，web/account 不受影响 | 只切一个入口、把当前 direct 写入 preferred 或遗漏 MCP 会得到不同的下一次发送地址。 |
| AC-02 · R3 两入口探测 | 同宿主：两个入口的真实健康样本；有效 200/503，以及 cloud-only、HTML/挑战、错误状态、缺字段/坏 JSON、超量/不结束正文、DNS/TLS/拒连/超时表 | 单探模型入口、仅看 HTTP 状态、漏正文时限/上界都会错误留在 preferred 或超时不完成。 |
| AC-02 · R4 生命周期 | 同宿主：启动、周期、即时信号合并、direct→preferred 恢复；测每入口时限与总切换耗时 | 去掉启动/周期/即时探测或串行造成上界超出，记录的调用次数、路线或时间断言会失败。 |
| AC-02 · R5 发布 | 同宿主：观察端点权威实际写出的文件路径、0600、单词内容和连续读取；每个环境隔离；切换日志不含敏感值 | 写错根、写 URL、权限过宽、读到半写内容或跨环境覆盖会直接失败。 |
| AC-01、AC-02 · R6 新发现 | 同宿主：运行中接受新的 v1 discovery；旧探测迟到；下一次探测及 fork 使用新 preferred | 地址仍来自旧环境值/旧探测，或仅 init 时生效，会命中旧 stand-in。 |
| AC-01、AC-02 · R1-05 | `codepuppy-auth.test.ts`、`codepuppy-bootstrap-build.test.ts`、`relay-wiring.test.ts`：两代装配，应用自填刷新与用户导出保留；可选字段从生产构建器经解析器传到消费者 | 旧 set-if-unset 会留下第一次地址；围栏或文档抢先读取会与本代 preferred 不一致；无中继多字段会破坏基线对照。 |
| AC-02 · 换址函数 | `packages/util/src/codepuppy-bootstrap.test.ts`：新字段合法/非法输入；文件逐次读取；preferred/direct、缺席/不可读/未知内容、非目标 URL 与路径边界 | 缓存路线、匹配过宽、坏输入抛错或新字段被解析器丢掉，都有可观察失败。 |
| AC-02 · R1-01 提交与上传 | `codepuppy-cloud-jobs.test.ts`：各一条同次提交先失败、路线变化、既有重试成功；收集 URL、逐字 body、幂等键和用途凭据 | 固定 base 会继续命中旧服务；重新构造 envelope/键或丢 consent header 会与首发记录不同。 |
| AC-02 · R1-01 SSE | `cloud-events-route.test.ts`：第一服务发出非数字 id 后有界结束；切路线；第二服务收到同 job、原 cursor 和正确凭据，终态只交付一次 | 循环外固定 base 会打不到第二服务；游标被清空/改型、终态重复或健康流被强断会失败。 |
| AC-02 · 接线/放行 | `relay-wiring.test.ts`：生产装配生成的 cloud-MCP 动态目的地使真实代理放行；日志汇点只对目标主机的指定失败触发探测；第三方和正常关闭不触发 | 少派生目的地会被 403；断开 log 接线，真代理拒连后不会即时探测；错误放大信号会增加无关探测。 |
| AC-02 · E1 拒连与恢复 | `endpoint-route.engine.test.ts`：引擎启动后关闭 relay 监听/健康入口；下一次内部重试或发送走 direct；恢复监听后周期切回 preferred；同一引擎实例与会话继续，记录实际切换耗时 | 只有主进程换路、引擎缓存 URL、没有周期恢复或靠重启才能换路，接收端记录与实例/会话不变断言会失败。 |
| AC-02 · E2 TLS 后停滞 | 同宿主：完成真实 TLS 后不给业务响应头，两个 `/health` 正常；既有超时/重试后仍向 preferred 发送并完成 | 把业务停滞当换路信号会出现 direct 请求；没有经历超时/重试或请求挂死也不能通过。 |
| AC-02 · E3 mid-body 停滞 | 同宿主：真实 SSE 已发首块后暂停正文，健康不变；观察既有读流失败/重试与后续发送，和 direct 对照一致，route 保持 preferred | 只测握手前拒连覆盖不到本项；错误切换、丢流语义或额外重放会与接收记录/对照结果不符。 |
| AC-02 · E4 cloud-only | 同宿主：模型入口健康、只坏 cloud；下一次模型、vision 和 cloud-MCP 发送都走 direct；恢复后二者回 preferred；调用真实 cloud 工具并检查 asserted authority/evidence 与切换前相同 | 单入口健康判定不会换路；漏任一发送缝仍打 relay；若改了 MCP 定义/配置身份，工具即失去 asserted 身份。 |
| AC-02 · E5 凭据与请求完整性 | 同宿主：两条路线上的模型、vision、MCP；每次发送的 method/body/header/取消信号可用，合成凭据用途正确；BYOK/相似主机/兄弟路径负臂 | 先换址再按旧地址识别会丢凭据；过宽识别会泄漏；重建 Request 丢 body/选项会破坏真实流/工具调用。 |
| AC-01、AC-02 · E6 无中继 | 同宿主：真实运行引擎的默认行为对照；沿用 `bootstrap-launch-parity.engine.test.ts` 的既有决定记录，记录文件不改 | 默认路径被新逻辑影响、引擎多出重启或发送变化会与对照失败；单纯 `relayConfigured() === false` 不能代替此项。 |
| AC-02 · F1 路线文件围栏 | `endpoint-route-fence.engine.test.ts`：用 `spawnLocalServer` 默认生产围栏计划取得实际 profile，在独立子进程装真实 addon；真引擎能读文件并随父进程原子更新换路；引擎子进程逐项尝试写入/截断、unlink/替换、文件及父目录 rename，均拒；普通项目文件写成功作正臂 | 手写 deny profile、字符串包含路径或只证 W2/W3 不算通过；任一攻击成功、父进程更新后引擎读不到、正臂也被拒都会失败。 |
| AC-01 · owner 网络验收交接 | 本仓上述宿主证明桌面按入口发送；最终两个新入口各 100 次冷连接，与两个旧入口各 100 次同机对照，成功率及耗时分布由编排器/owner 后续按设计 §8 取证 | 本地 stand-in 不证明住宅线路 ≥99/100；缺任一入口或旧入口对照即未满足 AC-01，不记为已验收。 |
| AC-02 · 真实云端验收交接 | 本仓自动化覆盖桌面链路；后续试用分别记录模型流、任务派发/查询、cloud MCP、产物下载，以及设计 §8 点名的实际出口分支 | 健康探针、MCP GET 405 或本地假服务成功不能替代真实操作；任一缺项即未完成 AC-02。 |

**样本与隔离。** discovery 沿用 `codepuppy-web-contract-fixtures.test.ts` 消费的 alpha-web vendored fixture；jobs/artifact 沿用 `packages/codepuppy-contracts-consumer/vendor/alpha-platform/contracts/v1/fixtures/producer/`；MCP 工具清单沿用 `src/main/fixtures/cloud-mcp-tools.ts` 指向的已采集清单，协议应答优先由实际 MCP SDK 序列化；模型 SSE 复用现有 `test-component/codepuppy-engine.ts` / `token-hot-apply.engine.cases.ts` 的引擎输入。健康样本从 alpha-platform 已有采集物或 `428fda9ea9` 的两个 `/health` 处理器本地实际输出取得，记录仓/提交/来源路径；不手抄另一系统的 JSON，不运行其生产 capture 脚本。错误输入由这些样本做明确变异。

**实施阶段的相关命令。** 全部在对应包目录运行；先把 `TMPDIR` 指到 `~/.cache/alpha-orch/2026-11-19/impl-relay/desktop/tmp/`，由现有 isolation preload 继续派生 HOME/XDG/数据库隔离根；日志同缓存目录。宿主串行执行，`bun test --max-concurrency 2 <文件…>`；不直接运行 `.cases.ts`，不访问已安装应用或其数据。真实引擎若报 `spawn_failed` / `ENOTCACHED`，按错误中包名先 `npm cache add <package>` 再重跑宿主。下面各行只选择列出的相关文件，不运行包全套或全 gate。

| 包 / 时点 | 命令参数（均接在 `bun test --max-concurrency 2` 后） |
| --- | --- |
| ui-mac，开始及相关改动后 | `src/main/codepuppy-endpoints.test.ts src/main/codepuppy-web-contract-fixtures.test.ts src/main/codepuppy-auth.test.ts src/main/codepuppy-bootstrap-build.test.ts src/main/server.test.ts src/main/sidecar-bootstrap-gate.test.ts src/main/codepuppy-cloud-events.test.ts src/main/codepuppy-cloud-jobs.test.ts src/main/codepuppy-artifact-download.test.ts` |
| ui-mac，新增路线检查 | `src/main/endpoint-route.test.ts src/main/relay-wiring.test.ts src/main/cloud-events-route.test.ts` |
| ui-mac，真实引擎宿主逐个运行 | `src/main/endpoint-route.engine.test.ts`；`src/main/endpoint-route-fence.engine.test.ts`；`src/main/token-hot-apply.engine.test.ts`；`src/main/cloud-credential-hot.engine.test.ts`；`src/main/cloud-mcp-direct-tools.engine.test.ts`；`src/main/bootstrap-launch-parity.engine.test.ts` |
| ui-mac，出网与相关旧行为 | `src/main/network-egress-derived.test.ts src/main/network-egress-registry.test.ts src/main/network-egress-proxy.test.ts src/main/network-egress-fence.test.ts src/main/credential-hot-apply.test.ts src/main/bootstrap-env-readers.test.ts` |
| ui-mac，endpoint mock 的已有消费者（均保留宿主隔离） | `src/main/cloud-dispatch-gate.test.ts src/main/automation-ipc-delete.test.ts src/main/catalog-refresher.test.ts src/main/models-catalog-v2.wiring.test.ts src/main/codepuppy-cloud-schedules.test.ts src/main/codepuppy-platform-catalog.test.ts`；其 cloud-MCP 宿主已在真引擎行列出 |
| ext，三处发送缝的相关现有检查 | `src/platform-credential-header.test.ts src/plugin-host.test.ts src/cloud-vision.test.ts src/cloud-websearch-kill.test.ts src/ext-imports.test.ts` |
| util，解析与唯一换址函数 | `src/codepuppy-bootstrap.test.ts` |

各自从 `packages/{ui-mac,ext,util,plugin}` 运行 `bun typecheck`；bootstrap/治理模块的直接 core 消费者再从 `packages/core` 运行 `bun typecheck`。额外做 `git diff --check`；从 ui-mac 运行 `bun test --max-concurrency 2 src/main/old-name-scan.test.ts`，仓根运行 `bash scripts/north-star-guard.sh`。`gate run`、`bin/check`、整包测试和一次性完整 gate 留给 ship。

**精确条数与 gate 登记。** 下列是计划增量，实施以实际宿主输出核实；若拆项变化，在同一提交更新本表和精确 pin，绝不降低旧断言或地板。行以测试路径定位，数字行号仅是 `4f61fde5de` 的坐标。

| `scripts/gate-files.tsv` 行 / 宿主 | 计划同步 |
| --- | --- |
| 256 · `src/main/codepuppy-auth.test.ts` | gate 宿主仍为 1；子进程 pin `63 → 64 pass / 0 fail`（R1-05 一项组合表）。 |
| 257 · `src/main/codepuppy-cloud-jobs.test.ts` | gate 宿主仍为 1；子进程 pin `18 → 20 pass / 0 fail`（提交/显式上传各一项）。 |
| 394 · `src/main/codepuppy-bootstrap-build.test.ts` | gate 精确数 `16 → 18`（有/无直连替代两项）。 |
| 新 · `packages/util src/codepuppy-bootstrap.test.ts` | 现有源码 17 项，加字段合法、非法、逐次换址三项，计划登记精确 20；不改 bootstrap 版本。 |
| 新 · `packages/ui-mac src/main/endpoint-route.test.ts` | gate 1；宿主 pin `6 pass / 0 fail`（R1～R6）。 |
| 新 · `packages/ui-mac src/main/relay-wiring.test.ts` | gate 1；宿主 pin `3 pass / 0 fail`。 |
| 新 · `packages/ui-mac src/main/cloud-events-route.test.ts` | gate 1；宿主 pin `1 pass / 0 fail`。 |
| 新 · `packages/ui-mac src/main/endpoint-route.engine.test.ts` | gate 1；宿主逐个启动六个独立子进程，每个 pin `1 pass / 0 fail`（E1～E6）；服务器、连接池、探测计时器逐例清理。 |
| 新 · `packages/ui-mac src/main/endpoint-route-fence.engine.test.ts` | darwin 条件行 gate 1；宿主 pin `1 pass / 0 fail`（F1），非 darwin 明示未验证。 |
| 不改数的相关行 | 368 plugin-host=51、375 token-hot=1（子项3）、379 cloud-credential-hot=1（子项5）、383 bootstrap-launch-parity=1、477 cloud-mcp-direct-tools=1，以及 339/340/344 的出网检查。新证明集中在新宿主，不靠删改旧计数腾位置。 |

### 偏离记录

- 2026-11-19 · 实施步骤 4 分提交：停滞夹具先后尝试既有模型配置与模型 transform 的短预算；E2 单跑通过，但组合运行仍在响应头等待，E2/E3 各 30 s 超时，后续 E4 受阻。按派单“同一修正失败两次”停止调整并返回 PARTIAL，不把组合检查记绿。未发布该宿主/其 gate 行，草稿保存于 `~/.cache/alpha-orch/2026-11-19/impl-relay/desktop/endpoint-route.engine.{cases,test}.draft.ts`；原输出 `engine-route.log`。其中 E1 独立记录拒连后 59275 ms 切直连、恢复后 60023 ms 回 preferred、引擎重启 0 次；这不代替剩余 E2～E6 的组合证明。未改生产默认预算或新增停滞信号。提交：本步骤提交。
- 2026-11-19 · F1 的临时目录放进该代已有 W2，显式测试数据库放进已有 W5；否则缓存目录下的自定义 TMPDIR 不在生产 profile 的系统临时目录许可内。仍由 `spawnLocalServer` 默认计划生成原样 profile，不修改围栏文件或规则；路线文件留在 W1/W2/W3 外。子进程显式继承隔离环境，清理由未受围栏的宿主负责。提交：本步骤提交。
- 2026-11-19 · 增补 `scripts/old-name-exceptions.tsv`：真实 wire/provenance 的外部名称及跨仓票名被旧名扫描点名，按派单 Handling problems §1 同步机械登记，不改采集物、不放宽扫描。提交：本步骤提交。
- 派生文档索引由编排器集成时按文档契约生成；未在本 lane 改索引。规格、设计和生产配置均未改。

- 2026-11-19 · r2 一次带时间戳诊断定位到预算层级：`Provider.modelSettings` 会剔除模型上的 provider-only 字段，前轮两种模型注入均未改变有效预算。E2 在 1795087572649 发请求，直至测试 30 s 清理于 1795087602683 才 abort；不是产品无限等待的证据。实际默认响应头 300000 ms、块间 900000 ms 均长于测试期限。修正仅使用既有 harness 的 pre-start provider content 接缝设为各 500 ms，启动后断言有效配置，重试策略/延迟保持生产原值；每项独立子进程拥有自己的四个 TLS 服务器。诊断日志 `r2-diagnosis.{log,jsonl}` 位于本 lane 缓存。
- 2026-11-19 · r2 E1 的前轮 59275 ms 只证明周期路径：旧夹具绕过真实 CONNECT 且故障期未让引擎发送。新夹具在真实生产代理下发送后，必须出现 `egress.connect` / `dial-failed` 并经生产日志回调触发即时探测；直连界限 6000 ms（并发 5 s 健康预算加 1 s 调度），恢复界限 65000 ms（60 s 周期加 5 s）；E4 另保留无拨号故障的纯周期路径 65000 ms 界限。所有 hostname 由代理既有 dial 测试接缝映射回环，未知目标拒绝，不触达生产 DNS。
- 2026-11-19 · r2 按明确派单单独删除集成点误提交的 `scripts/gate-files.tsv-E`，提交 `d1b2182da8`；没有为该文件加入过扫描例外，故无对应例外可删。旧名扫描由 9 pass / 1 fail 恢复为 10 pass / 0 fail。
- 2026-11-19 · r2 新夹具首次 E2 trace 显示自动标题请求与主回合并发，单次故障被标题腿先消耗，主回合随即成功且 retry 计数为零；现用已有 session `title` 字段命名测试会话，避免辅助腿争抢故障。E2/E3 同时要求真实 timeout retry 事件、重试请求间隔、发送地址/凭据与成功终态；不以单纯成功或测试清理 abort 充当超时证明。

- 2026-11-19 · r2 E1～E6 反向臂均经缓存中的 `.test.ts` 聚焦宿主运行，结果为预期 exit 1（各子进程 0 pass / 1 fail），随后以 scoped `git restore` 恢复本 lane 生产文件并核对无 diff：E1 断开生产日志的即时信号→6 s 界限失败（`r2-reverse-no-signal.log`）；E2/E3 在 preferred 文件下强制 util 发 direct→接收地址失败（`r2-reverse-forced-direct-E{2,3}.log`）；E4 去掉 MCP transport 换址→周期切换后的 cloud-direct 请求缺席（`r2-reverse-no-mcp-route.log`）；E5 换址后才识别平台凭据→direct 的用途凭据失败（`r2-reverse-credential-after-route.log`）；E6 把默认入口也视为 relay→无中继惰性失败（`r2-reverse-always-relay.log`）。R1-01/R1-05/SSE 的红证据与 F1 围栏反证继续沿用已接收的步骤 1～3 / F1 提交，不重写判据。
- 2026-11-19 · r2 宿主从一个含六项的子进程改成六个逐次启动、每个精确 1 pass / 0 fail 的独立子进程，gate 宿主仍精确 1。只在 `scripts/gate-files.tsv` 末尾追加该宿主；外部票名机械命中计数 `alpha-work` 8→9；原有各行不重排、不降地板。生产超时、重试、端点和围栏实现均无 r2 改动。

**r2 最终实测（本仓切片，非住宅网络/真实云端验收）。** 在 `packages/ui-mac` 用 `TMPDIR=<本 lane 缓存>/tmp bun test --max-concurrency 2 src/main/endpoint-route.engine.test.ts`，exit 0：宿主 1 pass / 0 fail，六个独立子进程各精确 1 pass / 0 fail，188.46 s；每项四个服务器均关闭、连接数归零（清理有断言）。日志 `r2-engine-verified.log`。E1 引擎发送经真实 CONNECT 产生 dial-failed，45 ms ≤ 6000 ms 切 direct、57479 ms ≤ 65000 ms 恢复，同实例/会话继续且重启 0；E2/E3 的 timeout retry 事件距停滞分别 502/511 ms，记录的生产退避为 1760/1790 ms，下一次请求仍为 preferred；E4 仅 cloud 健康失败，59362 ms ≤ 65000 ms 周期切 direct，无 dial-failed 触发，恢复后再实际发送模型/vision/MCP；最新工具调用的 authority、非空 sha256 evidenceDigest 与幂等键在三阶段保持；E5 三类非目标节点只带自身 BYOK 凭据，平台凭据在两条路线均正确；E6 真引擎默认发送不新增路线字段/探针。AC-01 由 E6 和已接收 R1～R6 的本地发送依据支撑，住宅线路各 100 次对照仍交编排器/owner；AC-02 本地故障、热换路、身份与惰性证据完成，真实云端调用仍属后续试用。

相关检查：ui-mac `bun typecheck` exit 0；`bun test --max-concurrency 2 src/main/old-name-scan.test.ts` exit 0、10 pass / 0 fail；仓根 `bash scripts/north-star-guard.sh` exit 0；`git diff --check` exit 0。分别见 `r2-typecheck-verified.log`、`r2-old-name-verified.log`、`r2-north-star.log`。步骤 1～3 与 F1 的接收版本 `f2fef2ff98`、`bdee779964`、`1cd8156566`、`4d8731c333` 未改：沿用 auth 64、jobs 20、SSE 1 的红/绿证据、F1 实际生成 profile 与既有相关/五包类型检查结果。无 gate/bin/check、生产接触或发布动作；无新遗留观察。r2 增量为两个测试文件约 397 行、gate 行/外部票名 pin、计划记录及独立授权删除；未新增计划外生产文件。
