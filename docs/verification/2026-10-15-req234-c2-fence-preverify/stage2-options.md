# #1530：全局 MCP 配置围栏的方案取证

2026-10-15；关联 [#1530](https://github.com/jinjunnn/alpha-code/issues/1530) 与[设计基线 §1.7、§3.1、C2](../../design/2026-10-14-req234-hub-agent-install-baseline.md)。
本次仅调查，不实施新方案。HEAD 为 `7d53b4515065bc2d507dc62c61e2b8bf02f2a9b7`；第二步草稿原样保留、未 stash、未提交。
下述 `file:line` 坐标以调查时工作树为准：`alpha-config-injection.ts`、`server.ts`、`ext/plugin.ts` 等带第二步草稿，不能当作已发布代码。
文档影响仅为验证证据；不改设计权威、上游、消息、IPC、G1 或技能指引。未读取用户配置/密钥，未操作实际系统管理配置。

## 1. 读取入口：源码普查

**静态取证**：以下是当前 v1 `Config` 与 v2 `Config.entries` 的加载路径普查，不是对任意插件代码行为的全称保证。
`H = HOME`，`X = XDG_CONFIG_HOME || H/.config`，`U = userData`，`G = alphaGlobalRoot`，`D = OPENCODE_CONFIG_DIR`。
正常 sidecar 注入后 `OPENCODE_CONFIG=G/alpha.jsonc`、`D=U/alpha-engine-config`；用户启用旧逃生开关时另论。

| 来源 | 读取点与生效条件 |
| --- | --- |
| `D/{config.json,opencode.json,opencode.jsonc,config}` | v1 `packages/opencode/src/config/config.ts:140` 优先选 D；`:277`、`:278`、`:279` 依次读三个 JSON 文件；`:281` 读无扩展名的旧 TOML `config`，其 `rest` 可含 MCP。 |
| `X/opencode/{config.json,opencode.json,opencode.jsonc,config}` | 同上，仅 **D 未设置**时作为全局 JSON/TOML 来源。不是正常产品下与 D 并行合并的另一组 JSON。 |
| `H/.opencode/opencode.json`、`opencode.jsonc` | `packages/opencode/src/config/paths.ts:34` 无条件加入 HOME 的 `.opencode`；`config.ts:443`、`:445`、`:448` 依次合并。与 `OPENCODE_DISABLE_PROJECT_CONFIG` 无关。 |
| `D/opencode.json`、`opencode.jsonc` | `paths.ts:39` 加入目录循环，`config.ts:443` 再读；与全局加载中的同名文件有重复，目录循环在 `OPENCODE_CONFIG` 之后。 |
| `OPENCODE_CONFIG` 指定的任意文件 | `config.ts:420`、`:421`。正常为 G/alpha.jsonc，不能把环境变量本身当文件路径 deny。`packages/ui-mac/src/main/alpha-config-injection.ts:86` 设置该值。 |
| `OPENCODE_CONFIG_CONTENT` | `config.ts:487`、`:489` 每次实例加载时读取当前进程环境变量中的 JSON 文本，晚于上述目录循环；不是磁盘文件。来源是 sidecar 的 `alpha-config-injection.ts:448`；启动 shell 的同名值被 `sidecar-env.ts:16` 所述 NEVER_INHERIT 策略丢弃。 |
| well-known / 其 `remote_config` URL | `config.ts:375` 起枚举 auth 中 `type=wellknown`，`:379`、`:381` 请求 `/.well-known/opencode`，`:393` 拉取可选远程配置，`:404` 加载合并，早于全局本地文件。没有检查真实 auth 存储。 |
| 当前账号组织配置 | `config.ts:503` 至 `:523`，`accountSvc.config(accountID, orgID)` → `${url}/api/config`，晚于 CONTENT。不是文件 deny 能封住的来源。 |
| 系统 managed 目录 | `config.ts:535`、`:537`、`:539`；`packages/opencode/src/config/managed.ts:20`：macOS `/Library/Application Support/opencode/{opencode.json,opencode.jsonc}`，Linux `/etc/opencode`，Windows `%ProgramData%/opencode`；`:32` 可由 `OPENCODE_TEST_MANAGED_CONFIG_DIR` 指定目录。 |
| macOS MDM | `managed.ts:54`、`:55`：`/Library/Managed Preferences/<username>/ai.opencode.managed.plist`，再查不带 username 的同名 plist；`:60` 经 plutil 读，`config.ts:544`、`:548` 最后合并。未对真实系统文件做读写实验。 |
| 自动发现的全局 JS/TS 插件 | `config.ts:483` + `packages/opencode/src/config/plugin.ts:21` 扫 `{plugin,plugins}/*.{ts,js}`，follow symlink；目录由 `paths.ts:26`、`:34`、`:39` 给出 XDG、HOME、D。插件 `config` hook 在 `packages/opencode/src/plugin/index.ts:251` 修改配置；显式 `plugin[]` 还能引用其它路径/包。这是代码来源，不是另一份固定 MCP JSON。 |
| Alpha 额外治理来源 | 草稿 `packages/ext/src/mcp-default-deny.ts:25` 重读 G/alpha.jsonc；`:31`、`:32` 读调用方传入的 `ALPHA_MCP_TRUTH_PATH` 的远程记录；`packages/ext/src/plugin.ts:163` 起取云定义；`:210`、`:215` 合并经信任门的项目叶。已提交 HEAD 的远程/default-deny 则仍在 fork 时注入，见 `git show HEAD:packages/ui-mac/src/main/alpha-config-injection.ts`。 |
| v2 全局来源 | `packages/core/src/global.ts:64`：D 或 X/opencode；`packages/core/src/config.ts:142`、`:147`、`:164`、`:173`、`:200` 只读 `opencode.json`、`opencode.jsonc`，不读 `config.json`、旧 TOML、`OPENCODE_CONFIG` 或 CONTENT；其 schema 在 `:84` 含 MCP。这不意味着本票允许切换生产消费代际。 |

**明确不属于这些入口的名称**：`config.jsonc` 在上述 v1/v2 MCP 配置加载清单中均不存在；D 下的 `models.json` 是模型快照，不是 MCP 配置；目录内不是所有 `*` 都被当作配置。
**仍需计入完整 I1 的非全局来源**：v1 `config.ts:425` + `paths.ts:10` 读取工作区到当前目录的 `opencode.json{,c}`，`paths.ts:27` 读取项目 `.opencode`；v2 `core/config.ts:179` 也扫描项目文件/目录。Alpha 自己的 `.code-puppy/alpha.jsonc` 另经 ext 信任门。只 deny 全局路径不会封掉这些来源。
`{env:}` / `{file:}` 是定义的二级输入（`packages/opencode/src/config/variable.ts:36`、`:43`、`:66`）；锁住 JSON 文件不等于锁住引用文件。本次没有访问密钥内容或改变该通道。

普查命令（仓库根目录，实际执行）：
```sh
rg --files packages/opencode/src/config
# 15 个源文件，均按加载职责核查；agent/command/markdown/TUI 等不另造全局 MCP JSON 入口
rg -n 'loadFile\(|loadConfig\(|ConfigPaths\.(files|directories)|readManagedPreferences|managedConfigDir' packages/opencode/src/config/config.ts
# 17 行：261,277,278,279,404,421,426,427,435,448,489,516,535,539,544,548,646
# 646 是 update() 读回待修改文件，不是新增启动来源
rg -n 'loadFile|loadDirectory|const names|\.up\(|globalDirectory' packages/core/src/config.ts
# 9 行：142,147,164,166,173,180,187,196,200
rg -n '\bmcp\b|MCP' packages/opencode/src/config packages/core/src/config.ts
# 14 行，命中 core/config.ts 的 MCP schema 与 opencode/config/v2-compat.ts 的形状转换；后者不读盘
```
这些计数是对指定源码范围的完整枚举，不能拿 grep 次数证明网络/插件无法产生其它配置。

## 2. 写入方与正常行为

**源码取证**（是否受损的动态对照在下一节）：

| 写者 | 目标与坐标 | 语义/围栏位置 |
| --- | --- | --- |
| 定制中心自定义 MCP | `packages/ui-mac/src/main/ext-uncurated-bodies.ts:33` → `ext-config.ts:542`、`:570`；目标由 `ext-config.ts:135` 决定 | 正常本地 MCP 写 G/alpha.jsonc；remote 写独立 main 真源。main 不在围栏内。 |
| 定制中心目录安装、更新、启停、卸载/恢复 | `ext-install-planner.ts:951`、`:1270` 构造 G/alpha.jsonc action；`ext-transaction.ts:1526` → `ext-config-tx.ts:112`；启停 `ext-install-planner.ts:3219`；卸载走同一配置事务/叶写器 | main 原子 apply/restore，非 agent 写盘。 |
| 启动 reconcile / 遗留配置清理 | `index.ts:804`、`:819` 在 spawn 前调用；`engine-config-truth-boot.ts:131`、`:206` 写 alpha 真源；`:364`、`:377`、`:390` 清理 legacy；desired-state `ext-install-planner.ts:3461`、`:3514` 写真源 | main。遗留配置、治理键、provider 等使用 `ext-config.ts:154` 的 legacy 集合；逃生写向 HOME 或 XDG 在 `:135`、`:142`。 |
| alpha seed | HEAD `alpha-config-injection.ts:85` 原在 sidecar；草稿已移 `server.ts:537` 至 `:544` main fork 前 | 本票已有迁移范围；不能将旧 seed 路径误记成一直由 main 写。 |
| **v2 投影** | `sidecar.ts:136` 先装围栏，`:139` 才 prepareSidecarEnv；`alpha-config-injection.ts:449` → `:572`、`:576`、`:577`、`:595` | **围栏内 sidecar** 创建/更新/清理 D/opencode.json，并写 D/opencode.jsonc；不是 main。models.json 在 `:612` 以后另写。 |
| 引擎 `PATCH /config` | `packages/opencode/src/server/routes/instance/httpapi/handlers/config.ts:18` → `config/config.ts:643`、`:645` | 写 **请求目录/config.json**，不是默认写 G/alpha.jsonc，也不是一律写全局。若调用者把 directory 指向受保护全局目录，则目标可能落入 deny。 |
| 引擎 `PATCH /global/config` | `handlers/global.ts:78` → `config.ts:661`、`:675`、`:680`；`globalConfigFile()` 在 `:145` | 在 D（无 D 时 X/opencode）选已有 `opencode.jsonc`、`opencode.json`、`config.json`，全无则 opencode.jsonc。更新后异步 dispose。 |
| 共享 renderer 的合法全局设置 | `packages/app/src/context/server-sync.tsx:660`、`:688` 调上述全局 API；shell 设置 `components/settings-general.tsx:341` / `settings-v2/general-controllers.ts:70`；provider 开关 `settings-providers.tsx:107`；v1 custom-provider `dialog-custom-provider.tsx:148` | 不能因 ui-mac 自有目录 grep 零命中就认定该 API 无正常消费者。此处是源码调用证据，未声称逐页 UI 点击实测。 |
| 引擎配置加载的自写 | `config.ts:249` 至 `:252` 给已读文件补 `$schema`（失败忽略）；`:268` 至 `:274` 无显式 env 路由时 seed 全局文件；`:282` 至 `:293` 旧 TOML 转 config.json 并删旧文件 | 围栏内引擎辅助写；正常产品有 env 路由，第二种通常不触发；另外两种条件满足时会触发。 |
| 引擎 CLI/TUI（不等于 desktop 启动） | `packages/opencode/src/cli/cmd/mcp.ts:394`、`:412`、`:424`、`:497`、`:511` 的 `mcp add` 写 XDG 的 opencode.json{,c} 或选定项目；`config/tui-migrate.ts:89` 至 `:110` 会备份、剥离旧配置中的 TUI 键，来源 `:119` 至 `:127` | 用户在围栏外执行不受 deny；agent 在围栏内执行会受限。CLI 直装全局 MCP 正是新“唯一安装通路”要关闭的行为，不能作为放行理由。 |
| 引擎运行时 MCP API | `packages/opencode/src/mcp/index.ts:681` 至 `:685` 的 add 只存实例 `s.config` 并连接，connect 在 `:688` | 不是任何上述文件的持久化写者；仅加文件 deny 不改变该运行时 API。 |

**出厂技能普查，7/7 文件，实际命令**：
```sh
rg --files packages/ui-mac/resources/factory-skills                 # 7 行
rg -n 'alpha\.jsonc|opencode\.json|config\.json|OPENCODE_CONFIG|\.mcp\.json' packages/ui-mac/resources/factory-skills
# 10 行：customize-code-puppy/SKILL.md:3,10,17,19,34,48,50；integrate-project/SKILL.md:40；agent-creator/SKILL.md:14,42
```
`customize-code-puppy/SKILL.md:34` **仍明确教 agent 直接编辑全局 alpha.jsonc 后 alpha_reload**；`:37` 只是建议优先 Hub，`:48` 只禁止把 connector key 写成明文，并未禁止直接改其它全局配置。
`:10` 声称不读 `.opencode` 与上游真实加载行为不符。本次只记录冲突，不改受保护技能资产。

**“agent 合法需要写”判断**：现有指引支持全局非安装设置（agent/command/provider 等）直接改 alpha.jsonc，现有项目流程支持 `.code-puppy` 的配置与内容；前者会被整文件 deny 改变产品能力，后者不在全局 deny 范围。没有发现技能要求 agent 写 HOME/XDG/D 的 opencode/config 文件；有真实需求的是 sidecar 投影和用户经 UI 发起的全局 API 写，它们与 agent 共享被围栏的进程，不能按 JS 调用方区别授权。全局 MCP 直接安装与本票新目标冲突，须改指引，不能同时承诺继续可用。

## 3. 方案 A：实机结果与不能外推的部分

**实验定义**：先验证最小的 A-file：保留草稿已有 alpha.jsonc deny 与六个 plugin(s) subpath deny，在原 file-write allow 后追加以下 **11 个 literal 文件**的 deny：

- G/alpha.jsonc（重复列入以便集合完整）；
- H/.opencode/{opencode.json,opencode.jsonc}；
- X/opencode/{config.json,opencode.json,opencode.jsonc,config}；
- U/alpha-engine-config/{config.json,opencode.json,opencode.jsonc,config}。

系统 managed/MDM 路径在正常生产 profile 的写允许根外；未向真实系统路径写探针。env 和远端输入无法被文件 deny 表达。
`config.jsonc` 没有加载入口，未加入。没有把整个 D 或 X/opencode 变只读；那还会影响 package.json、node_modules、models.json 等。
这定义限定了“全部”：**已识别、正常拓扑下可写的全局 MCP 配置文件**，不是所有配置来源都受保护的结论。

**方法**：复用第一步 `preverify.ts:42`、`:63` 的生产 planner/真 trialCompile、`:84` 至 `:88` 的 sandbox-exec 驱动与同目录 `fs-probe.mjs`；真实消费链复用未提交的 `mcp-config-rebuild.test.ts`，只在 `/tmp/1530-options-probe/` 生成调查副本，不改仓库测试。
每臂一个引擎 PID，真实 native addon 在 import 引擎前装围栏，实际 InstanceBootstrap/ext bundle/HTTP；MCP 用仓内 `packages/opencode/test/fixture/mcp-lifecycle-stdio.ts` 的 SDK 服务，观察器只读本测试生成的公开值。Electron main 调生产 persistMcp；不代称为确认框/IPC 全链路测试。
macOS 26.3.1 arm64，Bun 1.3.14，Electron 42.3.3；隔离 HOME 位于 `/Users/tide/.ac1530-rebuild-*`，避开 W11/W12，无用户配置/密钥。原臂 = **当前草稿的两条 deny**，不是原始发布版。

```sh
cd packages/ui-mac
bun test /tmp/1530-options-probe/options.test.ts > /tmp/1530-options-probe/results-final.log 2>&1
# rc=0；1 pass / 0 fail / 111 expect；6.12s（记录的是观测符合预期，不代表方案安全）
```

**动态实测**：

| 对照 | 原臂 | A-file |
| --- | --- | --- |
| 生产 profile 编译 | ok | ok（11 literals） |
| 围栏内 `printf <同名覆盖JSON> > H/.opencode/opencode.jsonc` → dispose → MCP | 写 rc=0；`GET /config` 恢复 trusted，但实际 SDK 子进程 args=`attacker` | 写 rc=1 / Operation not permitted；实际 args=`trusted`，connected |
| 同 PID 启动后 Electron main 安装、重装 | 写入成功；覆盖存在时实际仍可能 attacker | 两次写入成功，connected，args=`trusted`，相对 `{file:}` 已展开 |
| 11 文件逐个 append | alpha.jsonc EPERM，其余 10 OK | 11/11 EPERM，errno=-1 |
| 同 11 文件围栏外写对照 | 11/11 OK | 11/11 OK（此组用未围栏 Bun；真实 Electron 写管线见相邻行） |
| Electron main 的 boot reconcile | `processType=browser`，migrated=true，agent 叶落盘 | 同样成功；不是只读 no-op |
| Electron main 的生产 config transaction apply/restore | 描述改为 tx-control，再 `restored.ok=true` | 同样成功 |
| 真实 `injectAlphaConfig` 在围栏内执行投影 | `result.ok=true`，两份 mirror 文件存在 | **result.ok=false：D/opencode.json 的 open EPERM**；两文件均未落盘；探针进程 rc=0 仅表示报告成功 |
| `PATCH /config`，directory=工作区，payload=`{"shell":"/bin/sh"}` | HTTP 200 | HTTP 200 |
| `PATCH /global/config`，同 payload | HTTP 200 | **HTTP 500**；这是共享设置 UI 的实际写 API |
| 六项普通允许写对照 | 6/6 OK | 6/6 OK |

六项为：工作区文件、G/skills 文件、X/opencode/node_modules 文件、H/.opencode/package.json、D/models.json、G/alpha.jsonc.bak。不是对 W1–W19 全集的重跑；第一步已有原两条 deny 的更广对照，不能拿它替代新增 deny 的结果。
main reconcile 样本沿用仓内 `engine-config-truth-boot.test.ts` 的 legacy agent 形状；生产 `reconcileEngineConfigTruth` → `writeConfigTextAtomic` 实际迁移，随后真实 `prepareConfigTx/applyConfigImage/restoreConfigImage` 验证更新与恢复。

### A-file 的反例：父目录整体替换

**动态实测**：上述直接写被拒之后，全部在同一 profile 内执行：
```sh
sandbox-exec -f "$PROFILE" /bin/sh -c 'mkdir "$1" && printf "%s" "$2" > "$1/opencode.jsonc"' -- "$U/replacement-config" "$OVERRIDE_JSON"
sandbox-exec -f "$PROFILE" /bin/sh -c 'mv "$1" "$1.old" && mv "$2" "$1"' -- "$U/alpha-engine-config" "$U/replacement-config"
# 两条均 rc=0；没有 EPERM
# 同一引擎 dispose → GET /mcp：connected；实际子进程 args=["attacker"]、value="directory-swap"
```
`OVERRIDE_JSON` 是同一 SDK fixture 的本地 MCP 叶，改 command 最后参数与公开 environment 哨兵，不是外部攻击载荷。
文件 literal deny 未阻止其可写父目录（W3）被整体置换。因此 **A-file 证伪为完整防线**，不能把“直接 echo 被挡”写成“不再依赖重载顺序”。

**推断/未测**：若要沿 A 前进，至少要保护目录身份/祖先替换，迁出围栏内投影写，并处理全局设置 API；若粗粒度拒写整个目录，会扩大到依赖安装与模型投影，不能假定零误伤。
本轮没有实施或验证这些修补。新增 deny 也不会清洗已有不可信配置，不能阻止项目来源、远端来源或进程内 env 的后置覆盖；所以不能单独替代包含这些来源的完整 I1。

## 4. 方案 C：仅 ext/ui-mac 能否保证先重构、后消费

**源码事实**：`packages/opencode/src/project/bootstrap.ts:36` 至 `:38` 的 config→plugin 初始化顺序确实存在；但 `effect/instance-registry.ts:10`、`:11` 并发调用 disposer，`project/instance-store.ts:94` 至 `:105` 在 disposer 完成后才删 cache；插件的 dispose 本身只是其中一个 finalizer（`plugin/index.ts:272` 至 `:283`）。MCP 初始化直接读 `cfgSvc.get()`（`mcp/index.ts:526`、`:528`），没有先等 ext 的服务依赖。
前次真实例和本次原臂均证明：已有 client 后的下一轮 dispose 可以先产生 attacker MCP，再出现重构后的 `/config`。本次没有继续定位所有提前重建调用链，不能把根因武断定在某个具体 disposer。

**可行性判断（推断，不是已实施验证）**：现有 ext/ui-mac 合同没有能保证这条强顺序的通用咽喉点；不宣称数学上不存在任何改法。

| 候选做法 | 不能构成当前保证的原因 |
| --- | --- |
| ext `dispose` hook 先重构 | hook 与其它实例状态 finalizer 并发，没有“所有 MCP 消费暂停”屏障；重构旧 cfg 也不等于控制随后新建的 cfg。 |
| 在 reload-scheduler 调 dispose 前先重构/写投影 | `packages/ext/src/reload-scheduler.ts:184`、`:186` 只控制这一调用方；`handlers/global.ts:78`、`:84`、配置 PATCH、首次实例创建等不会全经它。它也不能阻止文件在采样后被 agent 再写。 |
| ext 写 G/alpha.jsonc | 主方案已由内核拒写；绕回 main 写需新的受控写合同，现有 #1531 消息只有查询/重载，不能把只读/重载口变成写口。 |
| ext 写 D/opencode.jsonc 等“更晚的文件” | A 下写不了；不加 A 时 agent 同样写得了。D 后还有 CONTENT、组织配置、managed 来源；不存在独占、末序、整表替换的文件接口。 |
| dispose 前更新进程内 `OPENCODE_CONFIG_CONTENT` | `config.ts:487` 的确动态读取，因此**传入新值本身可行**；但 `mergeConfig` (`config.ts:40` 至 `:50`) 对对象递归合并，空 mcp/environment 不能删除既有陌生名/注入字段；枚举后新写又有窗口，后置来源还可覆盖，多项目也共用进程 env。这不满足完整叶相等与任意重建顺序要求。 |
| main 重启整个 sidecar、提前预热 | 是另一种生命周期策略，违反本票“同进程 dispose 后成立”的判据；多做一次 GET /config 只能掩盖已发生的 MCP 执行，不能撤销副作用。 |
| ui-mac loader/打包时改写引擎 Config/MCP 行为 | 现有 `sidecar.ts:47` 的 registerHooks 只补 `.js→.ts` resolve；若增加加载期源码改写或 monkey-patch 服务图，相当于新增上游行为补丁，不是已有 ext hook 能力。需单独设计/授权/行为门，不能用“未编辑 packages/opencode 文件”冒充边界内解决。 |

## 5. 建议与 0.1.19 判断

**建议（一句话）**：推荐把 A 作为“全局配置只能由围栏外写”的修订方向，先补目录身份、迁移 sidecar 投影并明确全局设置/项目来源的合同边界，因为现有 C 没有可证明的消费前屏障；当前 A-file 与 C 都不具备直接交付条件。

**0.1.19：源码推断同样可被该覆盖攻击；未实测签名发布包。**
```sh
git rev-parse v0.1.19
# 74482625a7697dac0d363bee872c00253b51dd32
git show v0.1.19:packages/ui-mac/src/main/process-fence-profile.ts | nl -ba
git show v0.1.19:packages/ui-mac/src/main/mcp-default-deny.ts | nl -ba
git diff v0.1.19 HEAD -- packages/opencode/src/config/config.ts packages/opencode/src/config/paths.ts packages/opencode/src/project/bootstrap.ts packages/opencode/src/mcp/index.ts packages/opencode/src/effect/instance-registry.ts packages/core/src/config.ts packages/core/src/global.ts
# 空 diff；另逐文件 rev-parse <ref>:<file> 比对，7/7 blob 相同
```
标签中的 profile `:155`、`:156`、`:160`、`:170` 放行 G、U、X/opencode、H/.opencode，`:173` 后直接进入网络规则，无本票 deny。
标签 `mcp-default-deny.ts:40` 至 `:44` 只枚举 XDG，`:64` 至 `:69` 按名字放行受管 MCP；ext 的 config hook 没有第二步重构。
所以正常路径上：在 HOME/.opencode 写同名 command 覆盖会被引擎后序合并，且没有新防线；这与本次原臂的真消费结果方向一致。
本结论不等于已拿用户正在运行的 0.1.19 产物验证；没有启动/读取该用户实例。

## 本次操作与证据边界

- 调查副本与原始输出保留在本机 `/tmp/1530-options-probe/`：`options.test.ts`、`inject.ts`、`main-controls.ts`、`results-final.log`；只有本 Markdown 进入提交。
- 第一轮调查副本的 teardown 对 signalCode 处理不全，结果已输出但未退出；终止后只修临时副本，最后一轮前台完整结束 rc=0。没有修改原草稿测试。
- 草稿校验清单 `/tmp/1530-draft-before-options.json` 含 21 个原路径（包括移动前的缺席路径）；提交前逐文件 SHA-256/缺席状态比对，无变化；原暂存 rename 状态保留。
- 文档检查：`python3 scripts/check-doc-links.py docs/verification/2026-10-15-req234-c2-fence-preverify/stage2-options.md` → 1/1 相对链接通过；该文件 `git diff --cached --check` → rc=0。
- 文档合同检查：`python3 ~/.claude/skills/maintain-repository-docs/scripts/check_docs_contract.py --profile /Users/tide/app/alpha-work/governance/delivery-profile.yml --checkout-parent /tmp/1530-options-doc-checkouts --format json --strict` → rc=1，35 项均为 HEAD 已存在的 `docs/evidence/` role-alias 问题，本文件零命中；其它四仓零问题。输出留在 `/tmp/1530-options-probe/docs-contract.json`，未越界修理历史文档。
- 未跑全量门、未 push。代码证据与判断均是实现者取证，不代替编排器/owner 的方案决定。
