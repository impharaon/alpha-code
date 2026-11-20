---
id: PLAN-stored-credentials-fence
title: 对话里的命令和工具读不到、改不了本机存的密钥 实施计划
summary: 三片，各自单独成 PR、各自留下可用的产品。片 ①——主进程直接应用连接器时不替别名读凭据(AC-04)；片 ②——引擎与 ext 只从主进程交来的内存表取凭据(启动种子、续期推送、装载前拉取、封闭位置代入，AC-02 功能部分、AC-05)；片 ③——围栏 profile 末尾加 C1，凭据存放点拒读拒写、上级目录拒写(AC-01、AC-03、AC-02 「不从盘读」、D11)。
kind: plan
status: active
spec: SPEC-stored-credentials-fence
design: DESIGN-stored-credentials-fence
owners: [owner]
last_reviewed: 2026-11-20
---

# PLAN-stored-credentials-fence｜对话里的命令和工具读不到、改不了本机存的密钥 实施计划

本计划只排文件、顺序、风险与证明；决定一律看 [design.md](design.md)(下称「设计」)，不在这里复述。读码基线是只读快照 `5b2ffac85b`(主线 `69c1267835` + SPEC-engine-config-fence 片 ④);片 ①② 在主线 `69c1267835` 上实施(不含片 ④,片 ② 重采夹具之前由编排器合入主线)。设计的地面真相取样于 `a20dadb942` / `887748b52c`，本阶段逐条复核过的移动见文末「复核记录」。

## 切片总览

| 片 | 交付什么(合入后用户与产品的状态) | 依赖 | 碰 `packages/core` |
| --- | --- | --- | --- |
| ① | 用户在设置里启停连接器时，主进程只为同名连接器代入它自己存放点里的凭据；经软链、相对路径、大小写变体、firmlink 写法指向存放点的引用一律给空串、不读文件。其余一切照旧 | 无 | 否 |
| ② | 引擎进程里的凭据值与在场性只来自主进程交来的内存表(启动消息带全表、续期推全表、每次配置装载前各自拉全表)，配置里的 `{file:}` 只在封闭清单位置代入；主进程迟迟不应答 / 通道关闭时这次装载不用旧表，走既有 `credential-change` 重启自愈。盘上文件此时在围栏内仍可读(C1 未装)，安全性不比今天差，模型、连接器、续期、增删密钥照常 | 无(与 ① 独立；③ 依赖它) | 是(两个已接管文件) |
| ③ | 围栏 profile 最末加 C1 两块：凭据存放点及真实目标拒读拒写、每一级上级目录拒写。对话里的命令与工具读、拷、挪、改凭据文件全被拒；运行期放行照常 | ②(只加 C1 不换读法 ⇒ 引擎断，设计 P-11) | 否 |

建议顺序 ① → ② → ③。① 很小，也可以并进 ② 一起交，由编排器定。

## 片 ①:主进程直接应用连接器时不替别名读凭据

- 依据：SPEC-stored-credentials-fence v1(owner 2026-11-19、2026-11-20 批准)BR-04、AC-04；设计 §1 (d)、§2 P-04 / P-22、§4.1 `resolveConnectorLeaf` 与 `isStoreTarget`、§4.3 `credentialStores` / `readCredentialTable`、§4.5 「同一份真实目标清单」、§6 I6 与 E10 后半、§10 D2；意图 impharaon/alpha-work `docs/intents/INT-safety.md` I-20；派单未给 Issue 编号。
- 核对：Phase: IMPLEMENT — 计划(暂存稿,本提交入库)· 编排器 / Claude Fable 5.2 · 通过(每条 AC 都有带对照臂的具名证明,文件都在允许范围内,没有复述或改动设计决定,没有新的上游接管)。裁决:片 ① 与片 ② 同一分支、一个 PR,片 ① 做完先交检查点;O1 接受(在 `packages/util/package.json` 声明 `jsonc-parser: 3.3.1` 并同步 `bun.lock`,跑锁文件那一步、确认别的包版本不动);O3、O4 接受为同一调用链上的改动;O5 到时逐宿主定;O6 标注 `codepuppy(I-20)`;片 ② 在重采引擎适配器夹具之前停下等主线合入。

### 改动
| 文件 | 改什么 |
| --- | --- |
| `packages/util/src/codepuppy-credentials.ts`(新) | 进程内凭据表的权威文件(设计 §4.1，ADR-043 命名)。本片只放类型 `CodePuppyCredentialEntry` / `CodePuppyCredentials`、`parseCodePuppyCredentials`、`resolveConnectorLeaf`(只处理对象，不需要 jsonc-parser)；其余导出在片 ② 加 |
| `packages/util/test/codepuppy-credentials.test.ts`(新) | `resolveConnectorLeaf` 的规则用例(见「证明」) |
| `packages/ui-mac/src/main/codepuppy-secret-files.ts` | 加 `CredentialStore`、`credentialStores({ userDataPath, officialRuntimeParent? })`、`readCredentialTable(stores)`(设计 §4.3；名字取 `USER_DATA_LAYOUT`，不 import 官方连接器模块) |
| `packages/ui-mac/src/main/codepuppy-secret-files.test.ts` | 存放点清单与读表：只读普通文件、软链条目只记名字不进表、点开头跳过、目录不存在 = 无条目、其它 IO 错误抛、三种 `use` 归属 |
| `packages/ui-mac/src/main/process-fence-plan.ts` | 文件末尾新增两个导出：`planCredentialStores(stores, deps)` —— 每个存放点写成「真实上级目录 + 名字」，位置存在且解析到别处时再加真实目标(设计 §4.5；userData 真实路径求不出 ⇒ 抛)；`credentialStoreTarget(rules, deps)` —— 由这份清单得出 `isStoreTarget`(把路径求成真实路径，求不出当作指向存放点；它或任一上级目录的 device + inode 等于清单某项 ⇒ true)。片 ③ 的计划器复用前者，主进程与 C1 因此是同一份清单 |
| `packages/ui-mac/src/main/process-fence-plan.test.ts` | 两个新导出的单元用例(软链存放点出真实目标；firmlink / 大小写变体 / 相对路径 / 工作区软链判为指向存放点；无关文件为 false；求不出真实路径为 true) |
| `packages/ui-mac/src/main/package-mcp-activation.ts` | `applyAt` 的 `:109` 改用 `resolveConnectorLeaf({ server: name, leaf, table, isStoreTarget, readFile })`，删掉 `resolveFileReferences`(`:154-165`)；每次应用现建表(`readCredentialTable(credentialStores(…))`)，官方运行期父目录由 `officialRuntimeParent(root)` 给，抛则不给该项；被拒的引用只记名字。顺序照旧：先解析，后 `projectServerConfig` |
| `ManagedMcpConvergenceDeps` 的 7 个构造点 | 新增必填依赖 `userDataPath`：`ext-ipc.ts:149` 传主进程 userData；`install-from-source.engine.cases.ts`(3 处)、`package-effect.engine.cases.ts`、`test-component/managed-mcp-toggle.engine.cases.ts`、`test-component/official-connectors.cases.ts`(3 处)传各自沙箱的 userData |
| `packages/ui-mac/src/main/connector-leaf-alias.engine.test.ts`(新宿主)+ `packages/ui-mac/test-component/connector-leaf-alias.engine.cases.ts`(新) | AC-04 真入口用例，形状照 `managed-mcp-toggle.engine.cases.ts`(真嵌入式引擎 + 真 ext + 生产注入，开关只走生产持久写与 `createManagedMcpConvergence`) |
| `scripts/gate-files.tsv` | 登记新宿主(钉 pass 数) |
| `docs/specs/stored-credentials-fence/plan.md` | 本文件(首个提交) |

### 顺序
1. 计划文件入库(`docs(plan)`)。
2. 测试先红：util 单测、`codepuppy-secret-files.test.ts`、`process-fence-plan.test.ts` 新用例、新宿主 cases(新导出不存在 ⇒ 装不上 / 红)。
3. 实现 util 部分 + 存放点清单与读表 + 两个计划器导出 + `package-mcp-activation.ts` 接线与 7 个构造点；跑：util 单测、`codepuppy-secret-files.test.ts`、`process-fence-plan.test.ts`、新宿主、`managed-mcp-toggle.engine.test.ts`、`package-effect.engine.test.ts`、`install-from-source.engine.test.ts`、`official-connectors.test.ts`(含 cases)、`ui-mac` 与 `util` 的 typecheck。
4. 收尾：变异记录(见「证明」，跑完 `git restore`)、`scripts/assert-gate-files.sh`、偏离记录。

### 风险
- 必填依赖的构造点漏改：按 `createManagedMcpConvergence(` 全仓 grep 改齐，cases 宿主都跑。
- 相对路径写法：主进程按自己的 cwd 解析相对 `{file:}`，用例按这一事实构造「相对路径指向存放点」，断言值仍为空。
- 每次应用读整张表：表只含存放点里的小文件，开销可忽略；读表抛(非 ENOENT 的 IO 错误)⇒ 这次应用按既有 `catch` 记 unavailable，不退回无条件读文件。

### 证明
| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-04 | `connector-leaf-alias.engine.test.ts`：存放点里放假令牌；连接器 A 的叶子分别用「工作区里指向 A 令牌的软链」「相对路径」「大小写变体」「`/System/Volumes/Data/…` 写法」引用它，用户在设置里启用 A(生产 `convergeManagedMcp`)⇒ 本地 MCP 夹具报告的 environment 里该变量为空、引擎 `mcp.list` 状态照常，主进程日志只有名字没有值；对照：同名、规范写法的引用 ⇒ 夹具拿到假令牌；远程真源叶子带 v1 `oauth.clientSecret` ⇒ 引擎拿到正确 `client_secret`(设计 E10 后半、R3-4)；A 的叶子引用 B 的令牌、平台凭据或 BYOK 密钥 ⇒ 空串 | M1 恢复无条件 `readFileSync` ⇒ 四种别名写法都把假令牌送进夹具，红；M2 `isStoreTarget` 改成按路径前缀比 ⇒ firmlink 那一臂读到，红；M3 只认 `client_secret` ⇒ 远程 OAuth 客户端密钥变空，红 |
| AC-04(单元) | `packages/util/test/codepuppy-credentials.test.ts`、`process-fence-plan.test.ts` 新用例 | 同上三个变异各自让对应单元用例红 |

### 偏离记录
- 2026-11-20 · 测试位置:util 的单测按该包惯例放在 `packages/util/src/codepuppy-credentials.test.ts`(计划写的是 `packages/util/test/`);计划器两个新导出的单测放进新文件 `packages/ui-mac/src/main/process-fence-credential-stores.test.ts`,不加进 `process-fence-plan.test.ts`(后者在闸门登记簿里钉精确条数 27,又与工具策略那一路共用)· 提交 `49b47fd063`。
- 2026-11-20 · 签名:`resolveConnectorLeaf` 的输入与 `readCredentialTable` 各多一个可选 `log`(只收连接器名与字段位置 / 相对路径,不含值)—— 设计 §5 的「记名字」需要一个出口,设计 §4.1 / §4.3 其余形参不变;`ManagedMcpConvergenceDeps` 除 O4 的必填 `userDataPath` 外也多一个可选 `log`,`ext-ipc.ts` 接到主进程日志 · 提交 `d514173de1`。
- 2026-11-20 · 构造点是 10 处不是 7 处:`ext-ipc.ts` 1 处 + 测试 9 处(`official-connectors.cases.ts` 有 5 处)。其中两处带真引擎的官方连接器用例先建出 `userData`(主进程的 userData 总在;这两个用例原先没建,真实目标清单求不出它的真实路径)· 提交 `d514173de1`。
- 2026-11-20 · 计划外文件 `packages/ui-mac/src/main/logging.ts`:崩溃转储目录名收成 `codepuppy-secret-files.ts` 的 `CRASH_DUMPS_DIR`,存放点清单与 crashReporter 用同一个名字(不进 `USER_DATA_LAYOUT`:升级迁移逐项枚举那张表)· 提交 `d514173de1`。
- 2026-11-20 · 实现细节:直接应用路径每次收敛只在某个 Location 真要应用启用的定义时才读一次表(停用不打开任何存放点);相对路径写法一律按别名给空串(引用必须已是 path.resolve 之后的绝对路径才可能等于表里的键)· 提交 `d514173de1`。
- 2026-11-20 · 新宿主与真盘身份用例只在 darwin 跑(firmlink 写法与大小写不敏感的卷是 macOS 的事实),登记簿行带 `[平台:darwin]`,非 darwin 自报 skip · 提交:紧随 `d514173de1` 的登记提交。
- 2026-11-20 · 证据:红 `49b47fd063`(`evidence/s1-red-*.log`:新导出不存在;旧读法把四种别名、别的连接器、平台凭据、BYOK 密钥的假值都交给了引擎);绿 `d514173de1`。变异(都已 `git restore`):M1 恢复无条件读文件 ⇒ 真引擎用例七个字段读到假值、util 4 条红;M2 按路径前缀判存放点 ⇒ 软链、大小写、firmlink 三个字段读到假值、身份用例红;M3 只认 `client_secret` ⇒ 远程 `client_secret` 变空、util 1 条红(`evidence/mutations/M1–M3-*.log`)。

## 片 ②:引擎与 ext 只从主进程交来的内存表取凭据

- 依据：SPEC v1 BR-02、BR-03(代入位置部分)、BR-05，AC-02 的功能部分(模型 / 连接器 / 续期 / 运行中增删密钥 / 启停带令牌连接器照常，下一次请求带新值，具名错误的对照臂)、AC-05；设计 §1 (b)(c)、§2 P-02 / P-03 / P-05 / P-12 / P-18 / P-20、§4.1–§4.4、§5、§6 I2–I5 与 E2–E6、E8、E11、E12，§10 D1、D2、D4–D6；I-20。AC-02 的「引擎进程没有从磁盘读任何凭据文件」与 AC-03 要 C1 在场才成立，放在片 ③。
- 核对：Phase: IMPLEMENT — 计划(暂存稿,本提交入库)· 编排器 / Claude Fable 5.2 · 通过(每条 AC 都有带对照臂的具名证明,文件都在允许范围内,没有复述或改动设计决定,没有新的上游接管)。裁决:片 ① 与片 ② 同一分支、一个 PR,片 ① 做完先交检查点;O1 接受(在 `packages/util/package.json` 声明 `jsonc-parser: 3.3.1` 并同步 `bun.lock`,跑锁文件那一步、确认别的包版本不动);O3、O4 接受为同一调用链上的改动;O5 到时逐宿主定;O6 标注 `codepuppy(I-20)`;片 ② 在重采引擎适配器夹具之前停下等主线合入。

### 改动
| 文件 | 改什么 |
| --- | --- |
| `packages/util/src/codepuppy-credentials.ts` | 补齐设计 §4.1 其余导出：`publishCodePuppyCredentials`、`installCodePuppyCredentialSource`、`refreshCodePuppyCredentials`、`codepuppyCredential`、`readCodePuppyCredential`、`resolveCodePuppyCredentialRefs`。表与拉取函数各挂一个 `globalThis` 槽(三个 bundle 各编一份读法，同启动文档)。拉取函数的请求 id、10 秒上限、`credentials.unavailable` 由 sidecar 的请求方负责(见下一行)，`refresh` 只做「拉、成功才发布、失败抛」 |
| `packages/util/package.json`、`bun.lock` | 声明 `jsonc-parser: 3.3.1`(见「待定」O1) |
| `packages/util/test/codepuppy-credentials.test.ts` | 封闭位置与两条绑定、JSON 转义与 `{` 写成 `{`、解析不了原样返回、`refresh` 失败不发布、每次调用独立 |
| `packages/ui-mac/src/main/sidecar-credentials.ts`(新，名字可调) | 主进程 ↔ sidecar 凭据消息的合同与两侧小件(设计 §4.2)：`credentials` / `credentials.request` / `credentials.unavailable` 的 build / parse；sidecar 侧请求方(按 id 记账、10 秒常量、超时发 `unavailable`、迟到回复丢弃、`close()` 让在途请求以错误结束)；主进程侧同步应答函数。单独成文件的理由：`sidecar.ts` 顶层取 parentPort，测试 import 不了它；围栏外的「main」辅助进程与 cases 进程要跑同一份生产代码 |
| `packages/ui-mac/src/main/sidecar-credentials.test.ts`(新) | 合同往返、坏形状丢弃且不记值、迟到回复不发布、超时发 `unavailable`、`close()` 结束在途请求 |
| `packages/ui-mac/src/main/sidecar.ts` | `StartCommand.credentials` 必填(`{}` 合法)；`start()` 在 `installProcessFence` 之后、注入之前 parse + publish + 装拉取源，坏了走既有 error IPC + exit(1)；`parseCommand` 认 `credentials`(推送 / 回复)交给请求方；`stop` 时关请求方 |
| `packages/ui-mac/src/main/server.ts` | T1：`:836` 发 `start` 时同步建表(`readCredentialTable(credentialStores(…))`，官方运行期父目录照片 ① 的取法)，抛 ⇒ 杀子进程、本代失败；`:755` 的 `child.on("message")` 与写探针并列接收 `credentials.request`(同步回复；建表失败 ⇒ 回 `error` 并请求 `credential-change`)与 `credentials.unavailable`(请求 `credential-change`)；导出给 T2 用的「推当前表给当前子进程」(没有子进程 ⇒ 跳过，发送抛 ⇒ 抛)；`SpawnLocalServerOptions` 加 `requestRespawn`(见 O3) |
| `packages/ui-mac/src/main/index.ts` | 两处 `spawnLocalServer` 调用(`:1447`、`:1601`)接 `requestRespawn` 到既有 `requestSidecarRespawn`；`:801` 的 `applyCredentials` 在热写与回读摘要通过后推整表，推送抛 ⇒ `needs-structural` |
| `packages/ui-mac/src/main/codepuppy-secret-files.ts` | `applyPlatformCredentialsHot` 增加推送形参(写入与摘要都通过之后调；抛 ⇒ `needs-structural`)，保持「只返回结论、不记值」 |
| `packages/core/src/config.ts`(已接管) | 新 `codepuppy(I-20)` 标注块：显式文件(`:236-241` 经 `loadFile` `:169-176`，`loadFile` 加一个只有显式槽传入的文档种类参数)与内联内容(`:242-252`)在读出文本之后、`ConfigVariable.substitute` 之前，文本含 `{file:` 时先 `refreshCodePuppyCredentials()`，成功才过 `resolveCodePuppyCredentialRefs`；失败这次不代入(引用留给引擎自己读，C1 下即空串 + warning)。其它文档(全局、项目、直连、托管)一字不动 |
| `packages/core/src/mcp/client.ts`(已接管) | `:377` 的 `readFile(file, "utf8")` 换成 `readCodePuppyCredential`(包成 Promise)；`:3` 的 `node:fs/promises` 导入随之换成 util 导入，仍在 `codepuppy(#1562)` 标注内 |
| `packages/core/test/codepuppy-stored-credentials.test.ts`(新) | 真 `Config` 装载 + 发布的表 + 装上的假拉取源：清单位置代入；`agents.<名>.system` 等非清单位置不动；`inline` 条目不从显式文件代入；`connector` 条目只在同名条目代入；拉取失败不用旧表；两次装载各自拉取、迟到回复不被复用 |
| `packages/ext/src/platform-credential-header.ts`、`cloud-websearch-kill.ts`、`cloud-vision.ts`、`cloud-vision-hooks.ts`、`cloud-access.ts` | 五处默认读法换成 `readCodePuppyCredential` / `codepuppyCredential(p) !== undefined`(设计 §4.4 C-c–C-e)；可注入形参不变 |
| `packages/ui-mac/src/main/codepuppy-models.ts`、`codepuppy-config-injection.ts` | C-f：`hasUsableKey`、平台在场判断(`:109-115`、`:199`)与 `platformPays`(`:207`)接受一个在场查询；sidecar 的 `injectCodePuppyConfig` 传表查询，主进程调用方(`writeEngineConfigForFork`、出网派生等)照旧读盘。sidecar 里不出现「读盘失败当不存在」 |
| `packages/ui-mac/test-component/codepuppy-engine.ts`(共享宿主，约 42 个消费者) | 写好凭据文件之后，用生产 `readCredentialTable(credentialStores(…))` 建表并发布，装一个按同一生产代码现读盘的拉取源(扮演 main)；给自关围栏的用例留一个由围栏外辅助进程应答的拉取源 |
| 编码旧行为「每次请求读文件」的测试 | `token-hot-apply.engine.cases.ts`、`cloud-credential-hot.engine.cases.ts`、`platform-credential-error.engine.cases.ts`、`credential-hot-apply.cases.ts`、`packages/ext/src/platform-credential-header.test.ts`、`plugin-host.test.ts` P6/S5、云识图 / 联网搜索 kill-switch 的单测：续期改为「生产写者写盘 + T2 推送」，「删文件 ⇒ 不出网」改为「表里没有 ⇒ 不出网」；各宿主名、pass 数与 `gate-files.tsv` 描述同步 |
| 构造 `start` 命令的测试 | `server.test.ts`、`sidecar-stop.test.ts`、`native/codepuppy-fence/test/packaged-main.ts`(手写 `start`，补上用生产读表建的 `credentials`) |
| `packages/ui-mac/src/main/stored-credentials.engine.test.ts`(新宿主)+ 同名 `.cases.ts` | AC-02 功能部分与 AC-05，见「证明」 |
| `scripts/north-star-guard.sh` | `config.ts`(`:174-179` 那段)与 `mcp/client.ts`(`:139-142` 那段)的注释各补一句 I-20 的接管面与判据；清单条数不变 |
| `.claude/rules/adrs/ADR-047-opencode2-engine-generation.md` | 「精确接管面」里 `config.ts`、`mcp/{client,…}.ts` 两行补 I-20 的标注块与判据；「权威保持表」摘要同步新登记项与两条改写的决定 |
| `docs/architecture/codepuppy-authority-registry.json` | 新登记项(暂名 `stored-credentials-in-memory`)：takeovers 为两个已接管文件，approval 引 owner 2026-11-20「两份都批准」，机制文件 util 新文件，测试 = core 新单测 + 新引擎宿主(拿掉机制即红)；`cloud-connector-credential-per-request`、`l1r-platform-credential-header` 的决定措辞从「每次请求读凭据文件」改为「每次请求读内存表，续期推送整表」，测试名随宿主改名同步 |
| `packages/ui-mac/src/engine-adapter/fixtures/*.json`(17 个)、`scripts/old-name-exceptions.tsv` | 单独一个提交：`packages/core` 改了，用 `bun packages/ui-mac/test-fixtures/engine-adapter-sampler/sample.ts` 不改脚本全量重采，逐个比对并把差异类别写进偏离记录；`events.json` 的采样 CLI 路径词元随工作树改变时，旧名例外那一行跟着换 |
| `scripts/gate-files.tsv` | 新宿主登记；改名宿主的描述与 pass 数 |
| 事实文档 | 实施时 `grep -rn "codepuppy-secrets\|现读" docs/` 找出写着「引擎每次读凭据文件」的事实句，只改这些句子 |

### 顺序
1. 测试先红：util 与 `sidecar-credentials` 单测、core 新单测、`server.test.ts` 新用例、新引擎宿主(导出不存在 ⇒ 红)。
2. util 表与位置解析 + 消息合同与两侧小件 + sidecar / server / index 接线(T1、T2、P、`requestRespawn`)；跑 util、`sidecar-credentials`、`server.test.ts`、`sidecar-stop.test.ts`、`codepuppy-secret-files.test.ts`、`credential-hot-apply` 宿主。
3. 读者换法：ext 五处 + C-f + 共享宿主 + 旧行为测试改写；跑 ext 相关单测与 `plugin-host.test.ts`、`codepuppy-models.test.ts`、`codepuppy-config-injection*.test.ts`、`network-egress-derived.test.ts`、共享宿主的全部消费者宿主(清单由 `grep -rln codepuppyEngine\(` 给出，逐个跑并记 pass 数)。
4. core 两处标注块 + 接管登记(守卫注释、ADR-047、登记册)；跑 core 新单测、`codepuppy-mcp-runtime.test.ts`、`packages/core/test/config/` 下与 `{file:}` 相关的用例、`authority-registry.test.ts`、`scripts/assert-authority-proofs.sh`、`bash scripts/north-star-guard.sh`。
5. 单独提交：引擎适配器夹具重采；跑 `fixture-identity.test.ts`、`old-name-scan.test.ts`。
6. 新引擎宿主转绿 + 变异记录 + `scripts/assert-gate-files.sh` + 偏离记录。

### 风险
- 共享宿主一改，约 42 个引擎宿主都受影响：第 3 步逐个跑；自关围栏的宿主在本片还没有 C1，读盘照常，拉取不受影响。
- 必填的 `start.credentials`：漏一个构造点 ⇒ sidecar 拒起。按 `type: "start"` 全仓 grep(含 `native/`)。
- 10 秒常量让 AC-05 超时臂真等 10 秒以上：宿主超时放宽；若墙钟断言登记簿(`wall-clock-assertions`)点名，按它的流程登记。
- 引擎适配器重采依赖联网的模型目录与工作树路径，差异按片 ④ 的做法逐类说明。
- 引擎内的拉取发生在每个 Location 每次装载：开关显式文件监听的用例里重载次数多，拉取都是同步应答，不应拖慢；若宿主计时变化，记录实测。

### 证明
| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-02(功能部分)、BR-05 | `stored-credentials.engine.test.ts` production 臂：真嵌入式引擎 + 真 ext + 生产注入；平台模型请求带 T1 表里的假凭据；本地连接器的 `{file:}` environment 经装载前拉取解析为假值、调用成功；续期(生产 `applyPlatformCredentialsHot` + 推送)后下一次模型请求与云 MCP 请求带新值、重启 0 次；运行中新增一把 BYOK 密钥(结构性重启 = 新一代 T1)后请求带它，删除后该 provider 不在；经 `convergeManagedMcp` 启用 / 停用带令牌的连接器后，重载里拿到的是盘上当前值 / 空。分歧臂：盘上假值 A、表里假值 B ⇒ 请求与连接器拿到 B。冷启动：带既有凭据文件的 userData 不迁移即可用(共享宿主的每个消费者也在走这条) | 不发布表(设计 E2)⇒ 平台请求零次、回合以 `LoadAPIKeyError` 的具名文字失败；去掉 T2 ⇒ 续期后仍是旧值(E5)；分歧臂里任一读者仍读盘 ⇒ 拿到 A；把 P 换成写入时推送 ⇒ 连接器拿到旧值(E6) |
| AC-02(代入位置，BR-03 的引擎侧) | `codepuppy-stored-credentials.test.ts`：非清单位置、`inline` 条目出现在显式文件、A 条目引用 B 的令牌 ⇒ 都不从表代入 | 去掉位置判断 / 去掉绑定 ⇒ 对应用例代入了表值，红 |
| AC-05 | 同一宿主：delayed 臂(E11)—— 两个 Location 装载，第一个的拉取回复被扣住，其间提交新连接器版本，第二个拿到新值，迟到回复不被发布；timeout 臂(E12)—— 让 main 方超过 10 秒不回复 ⇒ 这次装载里凭据位置为空(不是旧值)，`credentials.unavailable` 到达 main 方的生产应答函数并请求 `credential-change`，宿主按生产意图重启引擎后连接器拿到盘上当前值；端口关闭臂同样不出现旧值。`server.test.ts`：假 fork 子进程发 `credentials.unavailable` / 建表失败 ⇒ `requestRespawn("credential-change")` 恰一次 | 合并在途拉取 ⇒ delayed 臂第二个拿到旧值；超时后用已发布的表 ⇒ timeout 臂留下旧值；不接重启 ⇒ 恢复后仍为空 |

### 偏离记录
暂无。

## 片 ③:围栏 profile 末尾加 C1

- 依据：SPEC v1 BR-01、BR-03，AC-01、AC-03、AC-02 的「引擎进程没有从磁盘读任何凭据文件」与具名错误对照臂；设计 §1 (a)、§2 P-06–P-11 / P-13 / P-17 / P-19、§4.5、§6 I1 与 E1、E7、E9、E10 前半，§10 D3、D7、D11；I-20。
- 核对：Phase: IMPLEMENT — 同一次计划核对(编排器 / Claude Fable 5.2 · 通过);本片在片 ①② 合入之后另起分支实施。O2 裁决:先实测;任何测试都不读写真实主目录、真实 Code Puppy 用户数据目录与真实凭据文件,不为测试改 `officialRuntimeParent`;真引擎布局放不进这个存放点时,另加围栏组件臂(生产计划器 + 渲染 + addon,同受保护集写入矩阵宿主的做法)覆盖它的拒绝,外加渲染单元用例,并记入偏离记录。

### 改动
| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/src/main/process-fence-profile.ts` | `ProcessFenceProfileInput` 加必填 `credentialStores`(已是真实路径；空列表两块都不渲染)；在 `renderConfigFence` 之后渲染 C1 两块，排版即 `processFenceWriteRules` 已认的文法(表头行首、收尾括号落在最后一条条目行末、其后可带 `;` 注释；上级目录块一行写完)；文件头说明同步 |
| `packages/ui-mac/src/main/process-fence-plan.ts` | `planProcessFence` 收原始存放点清单，经片 ① 的 `planCredentialStores` 落到真实路径并交给 `trimUntilCompiles`；计划日志加条数 |
| `packages/ui-mac/src/main/server.ts` | `planProductionFence` 用 `credentialStores({ userDataPath, officialRuntimeParent })`(官方父目录抛 ⇒ 不给该项)交给计划器 |
| 直接调 `renderProcessFenceProfile` / `trimUntilCompiles` 的其余 18 个文件(`process-fence-profile.test.ts` 见下一行) | 加 `credentialStores`。围栏 / 引擎整链夹具经生产 `planCredentialStores`(`project-writable.engine.cases.ts`、`fence-write-denied.engine.cases.ts`、`engine-db-records.engine.cases.ts`、`process-fence-extension.cases.ts`、`native/codepuppy-fence/test/packaged-main.ts`、`packaged-window-main.ts`)；只判别的轴的传 `[]`(`process-fence-compile.test.ts`、`process-fence-apply.test.ts`、`network-egress-fence.test.ts`、`workspace-write-probe-fence.test.ts`、`process-fence-wiring.test.ts`、`process-fence-zsh-startup.cases.ts`、`test-component/official-connectors.cases.ts`、`custom-provider-truth{,-fence}.test.ts`、`project-trust-truth-fence.test.ts`、`egress-grant-truth.test.ts`、`mcp-server-truth.test.ts`) |
| `packages/ui-mac/src/main/process-fence-profile.test.ts` | 把手写的 `C1_TEXT` 样本换成真渲染的往返；profile 尾部断言改为「受保护集两块之后是 C1 两块」；E7 单元：存放点是指向工作区的软链 ⇒ 规则含目标，经软链的 userData ⇒ 渲染真实路径 |
| `packages/ui-mac/src/main/process-fence-plan.test.ts` | 生产计划带 C1；官方父目录抛 ⇒ 少该项；userData 真实路径求不出 ⇒ 计划抛 |
| `scripts/process-fence-write-sites.tsv`、`packages/ui-mac/src/main/process-fence-write-sites.test.ts` | `codepuppy-secret-files.ts` 九行(`:24-32`)根 `W3` → `main-only`；`MAIN_ONLY_SITES` 逐条加这九个签名 |
| `packages/ui-mac/src/main/stored-credentials-fence.engine.test.ts`(新宿主)+ 同名 `.cases.ts` | AC-01、AC-03、AC-02 的盘读判据，见「证明」。cases 进程在装围栏前写假凭据与假转储、起围栏外的「main」辅助进程(Bun IPC，跑片 ② 的生产应答函数与生产读表)，再用生产计划器 + 生产 addon 把自己关进围栏 |
| 自关围栏的既有引擎宿主 | `project-writable`、`engine-config-fence`、`process-fence-config-fence`、`fence-write-denied`、`engine-db-records`、`endpoint-route-fence`：生产计划器带上 C1 后，凡在装载时要凭据的，改用围栏外辅助进程应答拉取；断言「受保护集是最后两块」的改为 C1 之后 |
| `project-writable.engine.test.ts` 宿主描述 | 生产计划器臂此时带 C1，作为 D11 的证据 |
| `scripts/gate-files.tsv`、登记册 | 新宿主登记；片 ② 的登记项补上 C1 的证明文件 |

### 顺序
1. 测试先红：profile / plan 单测新用例、新宿主(渲染器不认新字段 ⇒ 红)。
2. 渲染器 + 计划器 + server 接线 + 19 个调用点文件；跑 profile / plan / compile / apply / wiring 单测、`process-fence-write-sites.test.ts`、各真源围栏单测、`ui-mac` typecheck 与上面列出的 cases 宿主。
3. 自关围栏的既有宿主逐个跑并按需改用辅助进程拉取；跑 `project-writable.engine.test.ts`、`engine-config-fence.engine.test.ts`、`process-fence-engine.test.ts`、`fence-write-denied.engine.test.ts`、`engine-db-records.engine.test.ts`、`endpoint-route-fence.engine.test.ts`。
4. 新宿主转绿 + 变异记录 + 登记簿 + `scripts/assert-gate-files.sh` + 偏离记录。

### 风险
- 与工具策略那一路(SPEC-engine-config-fence 片 ③)改同一组位置(见「与并行车道共用的文件」)：后合入的一方按实测重算尾部断言、条数与登记行，不手抄。
- profile 变长：试编译裁剪的余量少一点；`trimUntilCompiles` 的用例照跑，计划日志记字节数。
- 官方运行期目录在测试里难以成项：`officialRuntimeParent` 用真实用户主目录与 `process.cwd()` 判断，cwd 在临时目录下或临时目录在主目录下就抛(见 O2)。
- 冻结 `/private/var/folders/<a>/<b>/T` 等上级节点：只冻节点本身，里面新建、改名、删文件照常(设计 P-17)；W12 下的用例照跑确认。

### 证明
| AC | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01 | `stored-credentials-fence.engine.test.ts` production 臂：生产计划器(含 C1)+ 生产 addon；「全部批准」「请求审批」「只读」三档，经界面的 `buildPromptRequest` 与生产适配器发出，用 shell 工具与读文件工具读清单里每个存放点的假值(含已恢复的官方运行期文件与 `Crashpad` 里的一份假转储)：直接路径、大小写变体、`/.vol/<dev>/<ino>`、工作区里新建的软链、硬链、克隆；再覆盖写、改名、删除、把 userData 与临时目录式存放点的上级目录改名搬走 ⇒ 全部失败；模型桩收到的每个请求体里没有假值；事后在围栏外读盘逐字节原样；引擎与辅助进程日志里搜假值零命中(E9) | control 臂(同宿主另起进程：生产 profile 去掉 C1)⇒ 同样的读必须读到，读不到则宿主红(证明手段测得出)；去掉上级目录那块 ⇒ 改名搬走后读到(P-17) |
| AC-02(盘读与对照) | 同一宿主 production 臂把片 ② 的模型 / 连接器 / 续期 / 增删密钥 / 启停连接器流程在 C1 下再跑一遍并全部成功；宿主读运行窗口的系统沙箱日志：引擎 pid 在存放点路径上的拒绝为零，攻击子进程的拒绝作校准(没有即红) | 「C1 在、不发布表」对照臂 ⇒ 模型请求零次、回合以 `LoadAPIKeyError` 具名文字失败(设计 P-11)；任一读者仍读盘 ⇒ 日志里出现引擎 pid 的拒绝，红 |
| AC-03 | 同一宿主：对话在「全部批准」档用 shell 把 `{file:<平台凭据路径>}` 写进项目配置(围栏内仍可写的那一份)某个助手的 `system`，重载后发模型请求 ⇒ 请求里没有假值；宿主在围栏外把同类引用写进显式文件的非清单位置与连接器 A 的 environment(引用平台凭据、BYOK 密钥、连接器 B 的令牌)⇒ 模型请求与连接器都只拿到空串 | 「代入范围放宽为全文」对照臂(引擎侧把表里的值代进每份文档的每个位置)⇒ 假值进模型请求，必须泄漏，否则宿主红 |
| D11 | `project-writable.engine.test.ts` 生产计划器臂(profile 带受保护集与 C1)：本运行新打开的项目签发一次、模型写入落盘、引擎 pid 不变；`process-fence-profile.test.ts` 真渲染往返 | 解析器不认读写表头 ⇒ server 记「runtime grants are disabled」，新项目写入失败，往返用例抛 |
| E7 | `process-fence-profile.test.ts`、`process-fence-plan.test.ts` 的软链存放点与经软链 userData 用例 | 渲染不含软链目标或不求真实路径 ⇒ 对应用例红 |

### 偏离记录
暂无。

## 与并行车道共用的文件(SPEC-engine-config-fence 片 ③:工具策略写消息 + CF-11)

| 文件 | 本计划哪一片 | 那一路改什么 | 冲突处理 |
| --- | --- | --- | --- |
| `main/process-fence-profile.ts` | ③(渲染器输入与 C1 渲染) | `configFenceLocations` 加 CF-11 | 改动区段不同；后合入方重跑 profile 单测 |
| `main/process-fence-plan.ts` | ①(文件末尾两个新导出)、③(`planProcessFence` 输入) | 预建循环加 CF-11 | 同上 |
| `main/process-fence-profile.test.ts`、`main/process-fence-plan.test.ts` | ③ | `CF_LINES`、计划器条数与预建列表 | 后合入方按实测重算 |
| `main/process-fence-config-fence.cases.ts`、`main/engine-config-fence.engine.cases.ts` | ③(尾部断言、辅助进程拉取) | CF-11 用例 | 同上 |
| `custom-provider-truth{,-fence}.test.ts`、`mcp-server-truth.test.ts`、`egress-grant-truth.test.ts` | ③(加 `credentialStores: []`) | 可能随 CF 条数改下界 | 机械合并 |
| `scripts/process-fence-write-sites.tsv`、`main/process-fence-write-sites.test.ts` 的 `MAIN_ONLY_SITES` | ③ | `packages/ext/src/policy/store.ts` 四行改 `main-only` | 两边都加行，机械合并 |
| `main/server.ts` | ②(T1、`child.on("message")` 接收链、`requestRespawn`)、③(`planProductionFence`) | `codepuppySidecar` 接收链上的工具策略写消息 | 接收链上并列一个分支；后合入方确认分支顺序 |
| `scripts/gate-files.tsv`、`docs/architecture/codepuppy-authority-registry.json`、ADR-047 | ①②③ | 各自的宿主与登记 | 机械合并 |

本计划不改 `codepuppy-sidecar-messages.ts`(凭据消息不进 `codepuppy.*` 族，设计 §4.2)，也不碰 `packages/ext/src/policy/*`。

## 上游引擎文件

| 文件与位置(快照 `5b2ffac85b`) | 设计是否已点名 | 接管登记 |
| --- | --- | --- |
| `packages/core/src/config.ts`：显式槽 `:236-241` 与 `loadFile` `:169-176`(代入在 `:172`)、内联内容 `:242-252`(代入在 `:244`) | 是(设计 §4.4 C-a、§6 写作 `:172` / `:294`，取样于 `a20dadb942`，行号移动，位置同一) | 已在 `UPSTREAM_EXCLUDES`(`north-star-guard.sh:180`)；补守卫注释、ADR-047 行、登记册新项与反向臂 |
| `packages/core/src/mcp/client.ts`：`:377` 读法与 `:3` 导入 | 是(设计写作 `:378`) | 已在 `UPSTREAM_EXCLUDES`(`:143`)；同上 |

不需要新的上游接管。只有片 ② 碰 `packages/core`，引擎适配器夹具重采在片 ② 单独一个提交。

## 复核记录(设计事实对快照 `5b2ffac85b`)

| 编号 | 设计里的事实 | 快照里 | 影响 |
| --- | --- | --- | --- |
| F-1 | C-a 在 `config.ts:172` / `:294` | 显式槽 `:236-241` 经通用 `loadFile`(`:169-176`，全局 / 项目 / 直连也走它)；内联 `:242-252` | 计划细节：`loadFile` 加文档种类参数，只有显式槽传，代入范围仍只是两份文档 |
| F-2 | C-b 在 `client.ts:378` | `:377`，导入在 `:3` | 行号 |
| F-3 | `server.ts` 交接点 `:418` / `:555` / `:589-593` / `:665-673` | `syncSecretFiles` `:491`、`restoreCommittedOfficialConnectors` `:631`、`child.on("message")` `:755-760`、`start` `:836-843`；恢复与 fork 之间多了主进程写引擎配置(`writeEngineConfigForFork`) | 行号；T1 在恢复之后成立 |
| F-4 | 显式文件由 sidecar 合成、在围栏可写集(P-03) | 由主进程在 fork 前合成并监听重写(`engine-explicit-config.ts:380`)，位于受保护集 CF-2；`codepuppy.jsonc` 在 CF-1；`buildCodePuppyModelConfig` 现在主进程与 sidecar 都调 | 不改决定：对话还能写的配置只剩项目配置(W1)，AC-03 的对话入口用它，显式文件那一类由宿主在围栏外写；C-f 的「主进程照旧读盘」照设计 |
| F-5 | D11 要求解析器认 C1 的拒绝块 | `process-fence-profile.ts:285` 已认 `(deny file-read* file-write*`，`process-fence-profile.test.ts:271-302` 有 C1 样本往返；受保护集渲染在 N4 之后(`:243`、`:253-268`) | D11 成立；C1 渲染在受保护集之后 |
| F-6 | 写盘登记簿 `:27-35` | `scripts/process-fence-write-sites.tsv:24-32`；另有 `MAIN_ONLY_SITES` 逐条钉签名 | 行号；多改一处钉子 |
| F-7 | C-d `cloud-vision.ts:91`、C-f `codepuppy-config-injection.ts:246`、启动文档槽 `codepuppy-bootstrap.ts:161-162` | `:92`、`:207`、`:165-166` | 行号 |
| F-8 | util 新文件 import 「core 已依赖的 `jsonc-parser`」 | bun 隔离安装下从 `packages/util/src`、`packages/ext/src` 解析不到 `jsonc-parser`(实测 `Bun.resolveSync` 失败，从 `packages/core/src` 成功) | 见 O1 |

## 待定(实施前或实施中要定)

- **O1** 在 `packages/util/package.json` 声明 `jsonc-parser: 3.3.1`(锁文件里已有同一版本，不下载新包，`bun.lock` 多一条工作区依赖)。设计 §4.1 已定 util 新文件用它；这一行声明需要编排器在核对时确认不算「新依赖」。不确认的话，没有便宜的替代：要么把 `resolveCodePuppyCredentialRefs` 挪出 util(动设计 §4.1 / §6 的落点)，要么手写 JSONC 定位。
- **O2** AC-01 要覆盖官方运行期目录，用例的运行布局要让 `officialRuntimeParent` 不抛(它用真实主目录与 `process.cwd()`，不吃测试的假 HOME)；实施时先实测，做不到就在偏离记录写明并以计划器单元用例覆盖这一项的渲染。
- **O3** `SpawnLocalServerOptions` 加 `requestRespawn`，`index.ts` 两处接到既有重启队列 —— 同一调用链上的必要改动。
- **O4** `ManagedMcpConvergenceDeps` 加必填 `userDataPath`，7 个构造点。
- **O5** 自关围栏的既有宿主里哪些在装载时要凭据(要围栏外辅助进程应答拉取)，片 ③ 逐个跑时定。
- **O6** 标注名：派单没有票号，用 `codepuppy(I-20)`。
