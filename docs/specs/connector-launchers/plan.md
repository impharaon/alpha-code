---
id: PLAN-connector-launchers
title: 连接器启动器实施计划
summary: 固定文件下载、随包运行时、持久准备、连接器呈现和受管调用的分片计划与实施证据。
kind: plan
status: active
spec: SPEC-connector-launchers
design: DESIGN-connector-launchers
owners: [owner]
last_reviewed: 2026-11-26
---

# PLAN-connector-launchers｜连接器启动器实施计划

依据 SPEC v1、DESIGN v2.2 @ `510b573c702ca68f29143d12182f5455cfe67797`。本仓分片如下；跨所有权交接沿设计 v1/v2/v2.1/v2.2 §8，外部上线不由本执行者操作。

| 分片 | 交付范围 | 依赖与交接 |
| --- | --- | --- |
| 一：固定文件下载权威 | v1 §4.2/R2 的清单校验、缓存、下载、原始失败事实及 Python/LibreOffice pin | 本轮详述于下；relay snapshot、公开副本和发布 HEAD 核对归编排器/发布者 |
| 二：随包启动器与宿主描述 | v1 R1/R3a、v2 V2-R2 的构建锁、两平台 uv/Node/npm、定向签名、资源解析、bootstrap 和只读 Node | 消费 #1759 R1/R2，不改围栏；DOC-NODE-v2 交 #1761；保留原始归档分支的正式打包/公证证明义务 |
| 三：围栏内准备与离线入口 | v1 R3b/R5 的依赖前检、CLI 等价适配、持久收据和 prepare→握手边界 | 依赖一/二及 #1759；覆盖 AC-01/02/04/05/10 的执行链 |
| 四：状态、诊断与单一动作 | v1 R4..R9 的按代快照、代理归属、分类、行/问题同一投影、诊断新对话；文档重试接 runtime.retry() | 依赖三的真实事实；复用 spec 体验约定，不出新稿；覆盖 AC-06/07/08，文档 consumer 接 #1761 |
| 五：受管第一方文件调用 | v2 V2-R3..R5、v2.1 V21-R1/R2、v2.2 V22-R1/R2：同一声明器/摘要、精确槽、开机重锚、配方展开、逐调用 metadata/取消 | 依赖一/二及启动链；VIDEO-L1-v2、FIRST-PARTY-NODE-v2.1、FIRST-PARTY-CACHE-v2.2 交视频 #1775；代码/配方实物仍归消费者 |
| 六：打包与真实平台验收 | AC-01..10 的正式包、空缓存、真围栏、慢网、国内链路及跨应用重启证据 | 依赖以上分片、relay 部署与副本发布；本 brief 禁止窗口，GUI/干净账户/北京/Windows 实测交编排器安排，不将组件测试冒称验收 |

## 一：固定文件下载权威

- 依据：SPEC v1 AC-03，AC-01/02/06/07/09/10 的固定文件子链；DESIGN v2.2 基线如上，v1 §4.2/4.5/4.7/6 R2/8/10；共享国内连接性设计 `86a58c7` §4.11 与后续 OCR family 接收；#1760。本片不宣称完成端到端 AC。
- 核对：`c7d70194bd` · Codex / GPT-6 作者核对通过；本轮 brief Phase「PLAN then IMPLEMENT in the same round」授权提交后直接实施，无未定设计问题；未发生独立计划审查。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/src/main/pinned-files.ts`（新） | electron-free 宿主固定文件权威：readPinnedFiles、清单校验、按 userData/id 派生路径、ensurePinnedFile 与 PinnedFileDelivery 读端；工厂持有本宿主在途集合，公开调用形状沿冻结契约 |
| `packages/ui-mac/src/main/pinned-files.test.ts`（新模块现有测试落点） | 真实文件系统与受控 HTTP 响应的 integration 回归；读取真实发布格式/清单，不模拟包安装 |
| `packages/ui-mac/src/main/user-data-layout.ts` | pinned-files 目录段唯一常量 |
| `packages/ui-mac/scripts/prebuild.ts` | 在构建时调用同一 readPinnedFiles，坏清单明确失败 |
| `packages/ui-mac/resources/pinned-files.json` | 追加 Python 两平台实物 pin；LibreOffice 仅追加已公开且原字节一致的自有 release 文件，保留消费者现有条目 |
| `docs/specs/connector-launchers/plan.md`、必要的本条生成索引行 | 核对、偏离与本片证据；不改其它冻结设计/规格 |

### 顺序

1. 单独提交本计划。起始 `2026-11-26T14:02:17Z`，首片预计约 60 分钟；预计翻倍则按 brief 返回。
2. 从原厂真实 release/实物核对 Python bytes/SHA-256，检查 LO 原厂与已公开自有副本。先运行现有 artifact-download、document-runtime、video-assets.fast 命名测试，记录基线；补同一权威的失败测试，再实现清单与下载，构建入口复用解析器。
3. 迭代只跑新增相关 case；完成后完整运行 pinned-files.test.ts 一次。对真实上游文件做一次下载/哈希核对并记录命令结果，不将约 300 MB 的 LO 下载加入 PR 测试。
4. 返回前一次运行更宽相关集合（共享 writer 原测试及读取 pin 表的 video tests、document-runtime），包目录 `bun typecheck`、docs checker、`git diff --check`、`affected-tests --list`。不跑 gate 或全套，不改 gate。提交本片及偏离记录。

### 风险

- LO 冻结来源要求先有公开自有 release 副本。本轮只读 `v0.2.8` release 结果无 LibreOffice asset；TDF mirrorlist 的 darwin 长度/摘要与设计一致。缺公开 URL/副本实物时不填占位、不开发布动作，独立完成下载/Python 后报告该项 PARTIAL，待发布者交付再填。
- `writeChunksChecked` 是唯一哈希/part/fsync/finalizer 权威；共享下载不带认证，不借云下载高层。下载器测试覆盖两路切换时不混入半包、单等待者取消不终止他人、磁盘/取消不改道与缓存重新验真。
- 跨仓 TS/Python 校验须解释同一清单一致；本轮只读共享契约/可用 parser，绝不改转发仓。HTTP 原始失败在进入共享粗错误码前保留，不能把 404 当暂时网络。
- 真机 AC-03、200 KB/s 及 GUI 证据属于分片六；本片的 progress 与超时行为只提供局部回归证据。

### 证明

| AC | 测试/证据 | 层与运行时机 | 缺少行为为什么会失败 |
| --- | --- | --- | --- |
| AC-03 固定文件子链 | pinned-files.test.ts：清单非法输入、精确 URL 编码、relay→origin、损坏缓存重下、bytes/SHA 拒绝 | integration；受影响 PR 与 nightly；静态 import 模块，literal import 实际清单可追踪 | 改道/校验/原子发布去掉时返回路径或请求/磁盘内容断言失败 |
| AC-02 存储子链 | 同文件：派生 userData 内目标、拒绝软链越界、失败无最终文件；尚非真围栏证据 | integration；受影响 PR 与 nightly | 写到非权威根、半包当缓存或跟随逃逸链接即失败 |
| AC-06 传输子链 | 同文件：真实流进度和非整包总时限的实现核对；200 KB/s 真入口留分片六 | integration 回归 + 一次代码/命令核对 | progress 不发或随包校验前宣告完成时断言失败 |
| AC-07 失败子链 | 同文件：404/5xx/connect/integrity/disk/cancelled 原始事实、单等待者取消、共享下载重试 | integration；受影响 PR 与 nightly | 粗 network 覆盖事实、取消他人或错误改道即失败 |
| AC-01/09/10 pin 数据 | Python 原厂两平台实物 SHA/bytes；LibreOffice 原件及公开副本核对；readPinnedFiles 校验真实表 | 一次下载/命令证据，不入永久测试；Windows 本片只承诺已固定文件身份 | 实物或表不符时完整哈希/长度比较失败；不能替代连接/离线验收 |

### 偏离记录

2026-11-26 · 新增 `video-assets.fast.test.ts` 的 Python pin 必需断言（撤去先前缺 pin 的豁免），以及 `naming-migration.test.ts` 按既有 LEGACY_USER_DATA 权威枚举：新增非迁移目录不能被旧测试误当迁移产物。二者是 pin/目录事实变化必需的测试同步，不增加迁移逻辑。`docs/README.md` 只投影生成器产出的本计划索引行，未收进既有索引漂移。LibreOffice 原厂两平台元数据已与冻结值核对，但 `v0.2.8` 公开 release 没有 LO asset；本片不伪造可取 URL，缺 pin 待发布者交付，返回 PARTIAL。

### 本片实施回执（2026-11-26）

计划提交 `c7d70194bd`，实现提交 `f8d5412005`；Codex / GPT-6 作者核对。实现只交本片组件，未把宿主桥、文档 runtime 装配、runtime.retry()、首方模板或打包验收记成完成。它们沿上表后续分片交付；未改围栏、冻结设计、其它仓或 gate。

| 项目 / AC 子链 | 命令与实际结果 |
| --- | --- |
| 基线 | ui-mac：`bun test src/main/codepuppy-artifact-download.test.ts src/main/document-runtime.test.ts src/main/video-assets.fast.test.ts` → 61 PASS / 0 FAIL |
| AC-03、AC-02/06/07 局部回归及 pin/位置同步 | ui-mac：`bun test src/main/pinned-files.test.ts src/main/codepuppy-artifact-download.test.ts src/main/document-runtime.test.ts src/main/video-assets.fast.test.ts src/main/video-assets.test.ts src/main/naming-migration.test.ts src/main/naming-migration-wiring.test.ts src/main/codepuppy-workdir.test.ts src/main/old-name-scan.test.ts` → 171 PASS / 0 FAIL，9 files，3.73 s。新增模块 10 个 integration case，按静态 import 与清单 literal path 参与受影响 PR/nightly；未新增 scenario 或全局输入 |
| 移除臂 | 临时移除 writer 的 expectedSha256、origin 改道、单等待者取消隔离，分别跑 pinned-files 的 `-t 'relay transport'`、`-t 'relay transport'`、`-t 'one cancellation'`：各 exit 1，分别错收 relay 坏字节、丢失回原址、取消其它等待者。均为行为断言失败，随后 scoped git restore 原实现；上述 171 PASS 在恢复后取得 |
| AC-03 真实下载口（非北京/干净包验收） | `gate slot -- bun /tmp/connector-launchers-live-download.ts` → exit 0；临时空 userData 的同一 createPinnedFileAuthority/ensureFile 真下载 Darwin Python，`via=origin`、25270084 B、SHA `9d6d9d0d85feda3f9cb4eb3e048f0fed21ed280feda087927eaa4fbc7124826f`、最终进度 25270084；再请求 `via=cache`。本机此时未证明 relay 已放行 |
| AC-01/09/10 的 pin 身份子证据 | 两个 originUrl 用 curl 实取到 `/tmp/connector-launchers-python-{darwin,windows}.tar.gz`，`shasum -a 256` / `wc -c`：Darwin 同上；Windows 22388338 B / `96694b50dcfde13d56e40346ddaa552a9cd650290e9b933cecf83c1d82226960`，均与清单一致。`tar -tf` 确认配方入口 python/bin/python3（含 3.12）及 python/python.exe；未执行连接器或 Windows 包 |
| 共享 schema 同解 | `/tmp/connector-launchers-parser-probe.ts` 从真实 Python entry 生成 41 组输入；桌面 parsePinnedFiles 与公开转发 parser blob `2233d7b0c6e053fc8a5d630f62c6d3ce7386b9a9` 的 load 同解：41/41，13 accept。只读取该文件并在 /tmp 运行，没有修改/部署转发仓 |
| 静态 / 文档 | ui-mac `bun typecheck` → exit 0；`git diff --check` → exit 0；`python3 scripts/check-doc-links.py docs/specs/connector-launchers/plan.md` → exit 0。官方 check_repo 对本计划 0 finding；仓级 58 errors / 249 warnings，包括既有索引漂移及 docs/README.md:393、452–454 的既有未知意图 ID，未顺修 |
| 选择范围 | 工作树 `affected-tests --list` → exit 0，`affected tests: 273 of 738 test files`。未改 selector/global setup/runner；这是列表，未执行 273 文件 |

遗留去向：LibreOffice `libreoffice/{darwin-arm64,win32-x64}/26.8.3` 缺已公开自有副本及可验证 originUrl → 发布者按文档设计 §4.3/国内连接性 §4.11.2 发布原字节、许可/源码材料后回本片填 pin；本轮未上传或绕回 TDF。原厂两份 mirrorlist 的大小/SHA 与冻结值一致，但不把元数据当副本实物证明。#1760 当前 Issue body 的 Design/Plan 仍是「待补」→ 编排器同步本轮冻结 v2.2/计划与实现引用；本执行者只提交，不改 Issue。仓级文档 findings → 既有文档治理，非本票修复。端到端 AC、文档重试与受管视频调用 → 上表后续分片；OPTIONAL 无。


### r2：公开副本补齐

- 依据/核对：IMPLEMENT resume r2 接收首片三提交，并给出两条已公开、已验证的 LibreOffice 副本事实；不重新审查来源决定。
- 已解除缺口：按 r2 原值加入 `libreoffice/darwin-arm64/26.8.3` 与 `libreoffice/win32-x64/26.8.3`。
- 一次实测：`gate slot -- bun /tmp/connector-launchers-libreoffice-live.ts` → exit 0；首次且唯一网络请求为香港固定路径，`via=relay`，299927705 B、SHA `de943203795e5057785f65515063e2db5eb60b0bb6d8e2534fec59e5cc5fb988`，再次 `via=cache`。两条目原值来自 r2 发布者回执，未另建下载器。
- 相关测试：ui-mac `bun test src/main/pinned-files.test.ts src/main/document-runtime.test.ts` → 30 PASS / 0 FAIL。

## 二：随包启动器与宿主描述

- 依据：SPEC v1 AC-01/02/04/05/09/10 的资产子链；DESIGN v2.2 基线的 v1 §4.1/4.3/R1/R3a、v2 §4.1 V2-R2、v2.2 §4.1 V22-R1；r2 Phase IMPLEMENT。
- 核对：计划 `c86a4dc4d7`；r2 Phase IMPLEMENT 明确要求按计划同轮计划并实施；作者 Codex / GPT-6 核对冻结输入，无新增设计决定。下面资产/描述先独立完成，生产 bootstrap 的 packageManagerEnv 必须接 #1759 的原权威，不填另一份位置表或空 env 冒充集成。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/resources/connector-launchers/lock.json`（新） | 冻结 uv/Node/npm 的构建来源锁，两平台原厂归档摘要/实物长度与入口；保留原厂许可 |
| `packages/ui-mac/scripts/build-connector-launchers.ts`（新）、`scripts/prebuild.ts` | 读锁取构建资产、验证、裁剪 Node 开发材料、生成包内清单；标准 prebuild 接入，不改依赖 |
| `packages/ui-mac/src/main/connector-launchers.ts`（新）、`.test.ts`（新模块测试） | 同一随包资产的路径描述、缓存根 map、完整性/架构核验、resolveAssets；展开形态与原始归档形态沿同一入口，不下载第二份运行时 |
| `packages/util/src/codepuppy-connector-launch.ts` | 冻结 LauncherEnvironment 数据定义；不复制 #1759 路径计算 |
| `packages/ui-mac/src/main/user-data-layout.ts`、`electron-builder.config.ts`、`resources/connector-node-entitlements.plist`（新） | 资产/运行时目录常量、打包资源与精确 Node 路径 entitlement；签名后在父签名前刷新同一资产 inventory |
| `packages/ui-mac/src/main/codepuppy-bootstrap-build.ts`、`server.ts`、`packages/util/src/codepuppy-bootstrap.ts` 及既有测试 | #1759 R1 接入可用后才接生产描述和每代校验；不得通过自行拼缓存路径绕过依赖 |

### 顺序

1. 独立提交本段计划。r2 起始 `2026-11-26T14:43:59Z`，后续资产/桥接预计 60 分钟；翻倍则按 brief 返回。
2. 构建锁实物核对、资产解析/校验与两种资源形态；命名测试只覆盖文件、架构、路径和取消边界。真实原厂归档用于一次构建证据，不用手写二进制或外部归档格式替身。
3. 精确路径签名覆盖与 prebuild/extraResources 接线；不启动窗口、不执行会弹钥匙串批准的正式签名。正式 Developer ID/公证和归档退路验证仍是分片六义务。
4. 按 #1759 的 canonical R1 输入装配 bootstrap；当前基线缺该模块时保留明确集成依赖，继续独立资产和 ID-only 消息代码，不复制其实现。

### 风险

签名会改变 Node 字节，inventory 在子签后、父签前更新。Windows 原件可核对、展开与架构检查不能冒称 Windows 实测。#1759 的位置 producer 尚在另一个分支，不能把现有 PATH/UV_CACHE_DIR 当 R1。运行时只消费随包资产，构建阶段联网与运行阶段离线分开留证。

### 证明

| AC | 测试/证据 | 层与运行时机 | 缺少行为为什么会失败 |
| --- | --- | --- | --- |
| AC-01/04/05 资产 | connector-launchers.test.ts：真实构建资产的路径/摘要/目标校验；一次执行随包 uv/node 的版本命令 | integration 受影响 PR/nightly；原厂归档构建与版本探针为一次证据 | 错版本/PATH 入口、缺 npm 闭包或坏字节不获 ready |
| AC-02 路径 | 同模块：userData 派生、稳定 firstPartyCacheRoots、拒绝逃逸条目/软链；不设 pinSet 版本盐到业务缓存根 | integration 受影响 PR/nightly | 越界或随版本变化的根直接违反路径断言 |
| AC-09 数据 | Windows uv/node 原件 SHA/bytes、PE 目标与目录成员核对 | 一次证据；实际 Windows 包仍分片六 | 错目标或缺入口不能通过资产核验 |
| AC-10 资产子链 | resolveAssets 只核验随包/已展开资产，不调用 fetch；原始归档首次展开后复用 | integration 受影响 PR/nightly | 删除本地资产、半成品或越界解包不能返回成功；不替代应用离线重启验收 |

### 偏离记录

2026-11-26 · 本片实际增加 `.gitignore` 的专用 build 目录、真实原厂 header/npm/许可的 base64/文本夹具及 PROVENANCE.txt：保证构建产物不进仓，PR 测试无需下载/执行原厂大包，也不改 gate 的二进制扩展名登记。缓存中的 inventory 与二进制可能同时被改写，因此归档形态另带随包封存的 preparedFiles；重新使用时必须与这份受保护摘要表一致，不以 mutable inventory 自证。此为原完整性决定的落地，不是新接口。bootstrap 的 R1 集成未实施：本基线无 resolvePackageManagerLocations；只读确认在 #1759 分支 process-fence-profile.ts:226/232 的 PackageManagerLocations/resolvePackageManagerLocations，未复制或修改该分支/围栏。

## 五（先行子链）：固定文件 ID-only 宿主桥

- 依据：DESIGN v1 §4.7/R2/R7、v2 §4.2 的原始归档消费域；SPEC AC-03/06/07 下载子链；r2 IMPLEMENT。受管 entryFor/recipe/tools-call 和首方 matcher 仍须后续完整接线，不以本子链冒称 VIDEO-L1 完成。
- 核对：计划 `98e3d3a0ce`；r2 Phase IMPLEMENT 同轮计划/实施授权；Codex / GPT-6 作者核对，未新增设计决定。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/util/src/codepuppy-connector-launch.ts` | ID-only ensure/cancel/result/progress 数据及无总超时的请求器；只接受绑定 generation 的结果，关闭/取消清结等待者 |
| `packages/ui-mac/src/main/connector-launch-host.ts`（新）、`pinned-files.test.ts` | main 桥只按 ID 调同一 authority；拒绝 URL/target 等额外字段，按请求取消/退出排空；测试走真实文件系统和两端消息 |
| `packages/ui-mac/src/main/server.ts` | 在现有 child.on(message)/exit/stop 上接收和清结桥；同 userData 跨 generation 复用唯一下载 authority，不改围栏 |

### 顺序

1. 提交本段计划；实现/运行新消息行为用例，再跑 pinned-files 全文件一次。
2. 完成 stop/exit 生命周期和源文件调用检查；本代 core 的 publishConnectorLaunchHost 待完整 LauncherEnvironment/R1 与其余宿主方法可装配后一次发布，不能注册部分 host。

### 风险

慢下载不能借普通 RPC 总超时变成失败；取消仅解除本请求的等待。无效/旧代消息不得发网络；合法请求均终结。进程退出后的回复不得写入下一代。main 仍派生目标路径，消息不携带 URL/摘要/路径覆盖。

### 证明

| AC | 测试/证据 | 层与运行时机 | 缺少行为为什么会失败 |
| --- | --- | --- | --- |
| AC-03/06 | pinned-files.test.ts：真实 authority 经两端桥取文件、进度归原 id；未知 ID/多余 URL 零下载 | integration 受影响 PR/nightly；静态 import 桥与 requester | 绕过 authority、丢进度或接受调用方 URL 时请求/磁盘断言失败 |
| AC-07 | 同文件：一个取消另一个继续、旧代回复忽略、关闭释放所有等待 | integration 受影响 PR/nightly | 请求挂起、串代或误取消共享下载会失败 |

### 偏离记录

暂无。


### r2 实施回执与后续接入点

- 依据：首片已被 r2 接收；本轮新增 `37b1c2fd71`（LO pins）、`c86a4dc4d7`（资产计划）、`ee10e1607a`（资产实现）、`98e3d3a0ce`（桥计划）、`2d1966e981`（桥实现）。Codex / GPT-6 作者核对，未发生独立审查。
- AC-01/04/05/09 的资产子链：uv/Node 四份原厂归档实际下载，完整 SHA 与 lock 一致。实测 bytes：uv darwin 14700626、uv Windows 15641577、Node darwin 30638176、Node Windows 41166246；uv 两份许可也按锁核对。`gate slot -- bun /tmp/connector-launchers-build-probe.ts` → exit 0，Darwin/Windows 展开清单分别 1750/1748 个文件，pinSet `98f61dba61d6d582a8d335d592e9becb78631c9e9107740e8f21fee51f5bf9fd`。Windows 是在 Mac 上核对原件/目标/布局，未执行 Windows 进程。
- AC-02/10 的资产子链：`gate slot -- bun /tmp/connector-launchers-archive-probe.ts` → exit 0，两平台原始归档形态均首次展开、再次复用；同时篡改可写 Node 与其 runtime.json 后，受随包 preparedFiles 拒绝并从已验原始归档重建。Darwin 绝对入口实际输出 uv 0.13.10、Node v26.13.1、npm 11.20.0。没有网络重取 Node/uv；不是正式签名、公证或应用离线重启的替代证据。
- AC-03/06/07 的消息子链：`bun test src/main/pinned-files.test.ts` → 12 PASS；ID-only 下载、进度、未知 ID/URL 覆盖拒绝、按请求取消、旧代消息及通道关闭均经两端桥和同一真实文件 authority。main server 的 message/kill/stop/exit 已接；core 的完整 ConnectorLaunchHost 尚未发布，未注册部分 host 或受管 handler。
- 移除臂：临时移除 sealed preparedFiles 比较、Node 精确签名路径、requester generation 比较，分别跑 `connector-launchers -t 'sealed prepared'`、`-t 'Node entitlements'`、`pinned-files -t 'generation close'`，各 exit 1，均为预期行为断言失败；已恢复源文件。
- 相关集合一次：connector-launchers、pinned-files、server、sidecar-stop、codepuppy-sidecar-wiring、video-runtime-artifacts、document-runtime、video-assets.fast、naming-migration、naming-migration-wiring、process-fence-write-sites、old-name-scan，共 12 文件 164 PASS / 2 FAIL。新增 LO URL 需按既有规范登记外部锚点，已在 scripts/old-name-exceptions.tsv 精确追加两行，未改 gate 代码/selector/阈值。另一失败在接受的首片 server.ts 源码上以同一单例重现：缺少 ext/dist/server.js 的警告含点号，误中 bad="." 的断言；`packages/ext` 的 `bun run build` 补本地生成前置产物后，该 server 单例 1 PASS，未改 server 测试断言/无关源码。
- 包装夹具同步：新增 mandatory launcher 检查使现有 mac-target-arch 包夹具缺资产；提取真实采样的共用 `test-component/connector-launcher-fixture.ts` 给两个测试消费，未手写二进制格式。修正后 `bun test src/main/connector-launchers.test.ts src/main/mac-target-arch.test.ts` → 46 PASS；旧名检查 10 PASS。该 helper/mac-target-arch.test.ts 与精确 URL 登记是原文件表外的必要同调用链同步。
- 执行偏离：上面的首次相关集合误含 sidecar-stop 的计时用例，本轮未授权该计时运行；已记录范围选择失误，不再重跑。未运行全套、gate run/bin/check，未启动应用或窗口。
- 静态：ui-mac `bun typecheck` exit 0；util `bun typecheck` exit 0（113 files）；构建配置可由 Bun 加载。官方 docs checker：本计划 0 finding，仓级 58 errors / 249 warnings（范围外既有文档）；相对链接与 git diff --check 通过。`affected-tests --list`：`affected tests: 340 of 739 test files`，exit 0，只列出未运行全套。
- 下一步需要的接入输入：当前分支没有 #1759 R1/R2。只读定位到 feat/1759-fence-global-writes 的 process-fence-profile.ts:226/232，已向编排器请求应接入的依赖提交；不合并/复制该分支、不另算包管理器路径。拿到依赖后完成生产 bootstrap/sidecar 的同代 LauncherEnvironment、prepare/离线入口、第一方 expander/matcher/开机重锚与 handler，再接文档 runtime/retry 和连接器行/问题的单一投影。当前只完成稳定 cache-root 描述，尚未完成 argv 槽/精确首方身份。完整 AC-02/06/07/08/10、Windows 实机、正式签名与 GUI 验收仍未完成；不存在新增设计取舍或 OPTIONAL 产品项。

- main 接收端最后核对：固定清单 authority 在 fork 前、既有 scratch cwd 建立后完成初始化；未知 ID 不在接收过程中读清单/派生目标。`codepuppy-sidecar-wiring.test.ts` 增加真实 spawnLocalServer 的 first-launch 数据根和未知 ID 终结回复（子进程为既有记录器、无 Electron 进程）；全文件 4 PASS，其他命名空间仍交原 hub。该既有测试是同调用链必要补充。
- r2 准确剩余：生产 bootstrap 的 launchers 字段/校验及 core Host 注册、包运行器准备/持久入口、runtimeDep/egress/诊断与单一呈现、文档 runtime 主装配及 retry 动作、第一方命令槽/严格声明身份/重锚/受管调用均待继续；未把纯资产与消息桥回归写成 AC 完成。接入 #1759 的已审 R1/R2 提交后继续，不需要重开已冻结设计。当前 Issue 的 Design/Plan 版本引用仍待编排器同步，本执行者未改 Issue。

## 五：可信命令槽与精确声明身份（r3）

- 依据：DESIGN v2 §4.3/V2-R4、v2.1 §4/V21-R1、v2.2 §4/V22-R2；SPEC v1 AC-01/04/05/10 的身份子链；r3 授权先做不依赖 R1/R2 的部分。
- 核对：Phase: IMPLEMENT（r3；计划 `2e75ba3f76`）；Codex / GPT-6 作者核对。测试传宿主生成的真实形状描述；原生资源命令无须编造运行器位置，含 Node/cache 槽的声明缺可信描述即不获声明。生产 bootstrap/资产 ready 等待仍依赖后续装配。

### 改动
| 文件 | 改什么 |
| --- | --- |
| `packages/core/src/mcp/codepuppy-first-party-mcp.ts`、`packages/core/test/codepuppy-mcp-runtime.test.ts` | 同一展开器、精确 matcher、v2 单一清单解析/代码摘要、显式 environment/cwd、声明/配方摘要；既有文件的非引擎用例验证，真实引擎/计时用例不跑 |
| `packages/util/src/codepuppy-hash.ts`（新）、`packages/ext/src/policy/store.ts` | 原样移动 canonicalJson/canonicalJsonDigest 的纯实现到 util 自有命名域，store 原导出消费/转出；避免修改未收编的上游 util/hash.ts，不新增第二实现 |
| `packages/util/src/codepuppy-connector-launch.ts` | 冻结声明/配方/状态数据与可信描述读取的纯校验，供 main/core/ext 共享 |
| `packages/ext/src/policy/identity.ts`、`packages/ext/src/plugin.ts`、`packages/core/src/mcp/index.ts` | 消费新声明 `.tools` 与绑定摘要；保留 Office 的已核宿主 Python 投影，额外环境/cwd 仍严格拒绝首方身份 |
| `packages/ui-mac/scripts/gen-office-mcp-tools.ts`、`resources/office-mcp/tools.json` 及既有 snapshot/wiring 测试 | Office 改为同一 v2 codeSha256/environment/cwd 形状，不保留旧 schema 分支；视频继续由原 producer 贡献条目 |
| `packages/ui-mac/src/main/codepuppy-video.ts` 及既有测试 | 消费同一展开器；不从 PATH、workspace 或 entry.environment 读取可信 Node/cache 根 |

### 顺序
1. 提交本段与后续独立工作计划；起始 `2026-11-26T15:24:31Z`，本轮预计约 90 分钟。
2. 先跑既有声明的命名纯用例；实现展开/核验并补资源/归档 Node、假路径、额外环境/cwd、原文模板摘要的回归，再更新各消费者及实际生成清单。
3. 完成后只跑受影响文件的非引擎、非计时用例；必要生成产物按原 producer 命令准备，不启动 Electron/GUI。

### 风险
不得把未 ready 当身份不匹配；codeSha256 只查资源内受保护代码，不对 userData Node 另抄摘要。Office 后续宿主 Python 投影必须逐键等于已核投影，不能借“清掉环境”认可额外用户配置。摘要移动是同一实现的归属变更，旧 policy 摘要必须不变。

### 证明
| AC | 测试/证据 | 层与运行时机 | 缺少行为为什么会失败 |
| --- | --- | --- | --- |
| AC-01/04/05/10 身份子链 | 原 module 纯声明用例：两种合法 Node 路径、稳定 cache 根、缺目录仍声明、假 Node/cache/环境/cwd 拒绝 | fast/integration 中最低可用层；受影响 PR/nightly；只选不启动引擎的命名用例 | 任意绝对 Node、workspace 首项通配或环境注入会错误获首方声明 |
| 数据契约 | 原 policy store/identity 用例及实际 gen-office 清单核对 | integration 受影响 PR/nightly；外部格式从真实随包文件取 | 摘要改变/漏代码字段/producer 与 parser 不同形会失败 |

### 偏离记录
暂无。

## 四：单一呈现、诊断交接与文档重试（r3）

- 依据：DESIGN v1 §4.5/4.6/4.7/R4..R9，规格体验约定 AC-06/07/08，r3 明确授权文档动作接 runtime.retry()。
- 核对：Phase: IMPLEMENT（r3；计划 `2e75ba3f76`，首个实现 `8b38125c18`）；Codex / GPT-6 作者核对。复用现有行、问题动作与 startChat，不新增视觉稿。

### 改动
| 文件 | 改什么 |
| --- | --- |
| `packages/util/src/codepuppy-connector-launch.ts`、core 既有 startup 模块 | 共享状态/诊断/动作数据、由原始事实做失败归因；不从粗 network 猜 404 可重试 |
| `packages/ui-mac/src/renderer/extensions/connector-launch-presentation.ts`（新）及既有行/watcher/action 文件 | 一个原因/详情/动作投影，行与问题入口共同消费； preparing 不进入问题，崩溃构造含命令/退出/stderr 的 startChat 输入 |
| `packages/ui-mac/src/main/document-host.ts`、`document-host-bridge.ts`、util document 契约、ext document bridge、既有测试 | 通过既有身份/代通道把 retry 动作接到当前 runtime.retry()，保留缓存和原验证任务路径 |
| `packages/ui-mac/src/preload` 与既有 IPC/renderer 装配点（按现有接口落置） | 注册本片动作的窄调用，不接受任意命令/URL；生产 runtime 根装配后直接绑定已实现动作 |

### 顺序
1. 从现有行/watcher/文档工具卡入口取现成状态与动作端口，先实现同一投影及失败事实/诊断首条内容。
2. 接文档重试的现有桥/动作，并用实际 createDocumentRuntime 的失败→点击动作→重新准备证明，不用独立计数器替代 runtime。
3. 按变更文件运行命名用例、文件末次相关集；一次移除臂、包目录类型检查与 scope 回执。

### 风险
完整状态 producer/进程诊断 tee 的生产装配仍由启动链完成，本片不伪造 connected 或报错。界面动作执行不是恢复证据，最终状态清除旧问题。不会新开多个空对话或带其他连接器日志/密钥。

### 证明
| AC | 测试/证据 | 层与运行时机 | 缺少行为为什么会失败 |
| --- | --- | --- | --- |
| AC-06/07 | 行/watcher 的同一投影用例；文档真 runtime 经 action 重试 | 最低可用 fast/integration，受影响 PR/nightly | 准备误报问题、两处原因/动作分歧、点击不触发实际准备即失败 |
| AC-08 | 首条消息保留命令/exit/stderr，既有 startChat 回执/导航；遮密用例 | fast/integration，受影响 PR/nightly | 去掉内容或生成多个会话时断言失败 |

### 偏离记录
暂无。

## 三：离线入口及 #1759 机械接入清单（r3）

- 依据：DESIGN v1 §4.3/4.4/4.7；#1759 冻结设计 §4.1 R1/R2；r3 不复制位置 authority。准备收据/入口绑定先做可独立验证部分，真实围栏/应用重启仍属六。
- 核对：Codex / GPT-6 按 r3 只读核对设计与 #1759 分支；下列为消费清单，不新增签名或写入规则。

| 接口（原位置） | 原签名 / 本票消费点 |
| --- | --- |
| `process-fence-profile.ts` R1 | `resolvePackageManagerLocations(input: PackageManagerLocationInput): PackageManagerLocations`；input 原字段为 platform/home/userDataPath/configHome/appData/localAppData/goInstallBin/xdgCacheHome/bunInstall，全必填；`PackageManagerLocations.env: Readonly<Record<string,string>>`、writable 原样消费。main 在白名单过滤后的同次位置计算拿 env，填 LauncherEnvironment.packageManagerEnv，不再算 UV/npm 根 |
| `process-fence-plan.ts` 绑定 | `planPackageManagerCaches(input: PackageManagerLocationInput & { truthPath: string; eligibility: WorkspaceDirectoryInput }): { env: Record<string,string>; cacheEnv: Record<string,string>; rules: ProcessFenceWriteRule[]; locations: WritableLocationTruth["entries"] }`；消费该分支实际绑定后的 env（含 npm prefix）与 cacheEnv（最终缓存投影）/rules/locations，候选路径不能绕过已有身份绑定。生产 fence 与 bootstrap 用同一份结果 |
| `src/shared/package-manager-environment.ts` R2 | `installPackageManagerEnvironment(value: unknown, pull?: () => Promise<PackageManagerEnvironment>)`；sidecar 在 import engine 前使用 #1759 的安装路径，不另 publish 一份缓存表 |
| 同模块最终投影 | `projectPackageManagerEnvironment<T>(source: Readonly<Record<string,T>> | undefined)`，以及 `packageManagerEnvironment(): PackageManagerEnvironment` / `refreshPackageManagerEnvironment()`；最终实际 spawner 由该分支投影，launcher 的业务/专用覆盖先合成，不在 core 重写 R1 缓存键 |
| `engine/package-manager-spawner.ts` | 消费其现有 spawner adapter 在最终 spawn 时调用 refresh/project 的接线；MCP 的 prepare/已准备入口都走同一个 Location Environment，不能由 main 安装任意包 |

### 改动 / 顺序
先实现 core 自有持久准备/收据读取与当前执行参数重绑（文件/用例随实现记录）；待依赖合入后，main bootstrap builder→sidecar Host 发布→McpConnection.make prepare（许可/握手计时前）→McpClient prepared 是机械接线顺序。此处不引入不存在的本地模块或空 R1 结果。

### 风险 / 证明
AC-10 独立证据必须观察重启后未调用解析器/下载器，key 不含 cwd/密钥/服务参数；真正应用重启、10 秒时钟、旧默认运行器对照不能由组件回归冒充。本轮不跑计时/规模用例；准备语法必须消费官方解析器/真实发布格式，不手写第三方协议夹具。

### 偏离记录
暂无。

### r3 身份片实施收据

同一展开器已完成 Node/cache-root 的整 token 规则；v2 声明核验 codeSha256/environment/cwd，返回工具及原模板的两类摘要；ext authority 消费同一摘要，旧 policy canonical 实现原样移动。原生无槽的 Office 可以在启动器装配之前核验；含槽声明没有本代可信描述即不获声明。core/ext 的临时只读 `Reflect.get(bootstrap, "launchers")` 接法与既有视频消费者一致，#1759 接入时随必填 bootstrap 字段改为类型化读取；未声称当前生产已发布该描述。

证据：core 原文件命名纯用例 4 PASS / 57 assertions；identity 文件 19 PASS / 56 assertions；sidecar-wiring 4 PASS（同次 snapshot 文件 2 FAIL：worktree 未构建 Office Python，ENOENT）。更正 `fc7cb56ccf` 的收据：`python /tmp/connector-r3-manifest-check.py` 使用 producer 原 EXPORT_TOOLS 载入真实 server.py，但因 `codepuppy_office` 前置包未安装而 exit 1，不能记 PASS；仅静态 JSON 形状/真实 hash 的机械投影已完成，不替代完整 producer snapshot。为补齐 prerequisite，通过 `gate slot -- bun scripts/build-office-runtime.ts` 尝试原 builder，compileall `-j 0` exit 1，未重跑/修改 builder；日志 `/tmp/connector-r3-office-build.log`，交编排器处理构建前置，非本片回归。前一轮类型检查 util 114 files、core 2056 files/2 projects、ext/ui-mac 均 exit 0；最终变更静态检查见后续总收据。

偏离：`policy/resolver.ts` 的 McpEntry 本来丢弃 environment，本次为冻结身份要求保留该字段；`policy/index.ts` 将同代可信描述送入身份核验，为同一调用链必要文件。core 既有引擎场景夹具按 v2 的显式 environment 同步，未运行时序场景。生产 boot Node 重锚及准备前等待仍待生产 launcher 描述装配，不以这组纯用例计作 AC-01/10 整体验收。

身份移除臂：临时去掉 environment/cwd 比较，`bun test test/codepuppy-mcp-runtime.test.ts -t "bundled declarations reject"` 为 0 PASS / 1 FAIL（期望 undefined 却获得声明）；已用 scoped git restore 还原。

### r3 呈现与重试片实施收据

Phase: IMPLEMENT（r3；计划 `2e75ba3f76`）。新增 `main/connector-launch-state.ts` 持有当前代快照、序号与旧 attempt 排除；冻结 ConnectorLaunchApi 的重试入口查当前身份后，已绑定文档 runtime 时直接调用真实 `runtime.retry()`，动作自身不清除失败。preload/main IPC 已暴露同一面，composition root 安装端口留给生产启动链；没有伪造一个已经注册的生产 runtime。

UI：`connector-launch-presentation.ts` 为行和 BackgroundProblemWatcher 的唯一新详情投影，准备进度可见且不入问题；下载、密钥、目录、依赖和崩溃各只有一个原因/动作。诊断交接消费现有 startChat；命令数组、cwd、阶段、真实退出码/信号与 stderr 首条带入，4096 字符只决定完整宿主文件附件与 inline 的展示方式，不截断/拒绝内容；沿 onSessionCreated/existingSessionID 重试失败首条。主进程诊断产生/遮密 tee 尚未接入，不能据消费者测试声称 AC-08 的引擎半条链完成。

证据：`bun test src/main/document-runtime.test.ts src/main/connector-launch-state.test.ts src/renderer/extensions/connector-launch-presentation.test.ts` 28 PASS / 134 assertions；包含真 runtime 的 failed→connector API retry→实际准备/验证→ready。`bun test src/renderer/codepuppy-ui/background-problem-watcher.test.ts -t "launcher snapshots suppress"` 1 PASS / 13 assertions，真实挂 watcher+问题入口，准备压过 SDK 的旧失败；点击 retry 不提前消除问题，密钥/非仓库消息与动作同步，connected 清除；该用例不推进时钟，旧计时用例未跑。core 纯分类用例 1 PASS / 10 assertions：仅 connect/timeout/5xx/429 为 download，404/403/解析/完整性/磁盘和粗 network 为 unknown。

偏离/必要同链文件：依据 documents plan:573/704 的明确已接受接缝，撤回本轮计划里拟增 DocumentHost/bridge 方法的路线；实际重试直接绑定当前 runtime 到已有 connector API，没有改 DocumentHost/引擎 API。新增 `connector-launch-client/actions/assistant` 与 `connector-assistant-host.tsx` 分别复用窄 preload、现有密钥/OAuth 入口和现有 router/startChat；index 只挂已有壳的动作宿主；en/zh 添加本片文案；test-component/preload-stub 机械登记新能力缺席，避免改变无此能力的旧组件夹具。`connector-launch-state` 为本片必要生产端文件，使用冻结 API，没有另造下载器/Session 队列。最终静态检查及移除臂见总收据。

未闭环：生产 controller 安装、core changed/diagnostic 消息桥、DocumentRuntime 当前 attempt 绑定由待接启动链装配；Node boot 重锚、PackageRunner 持久准备/离线入口仍需后续实现。未将这些写成已依赖 #1759 自然完成：R1/R2 合入后只解决其位置/最终投影端口，本票仍拥有余下代码与整链验收。

### r3 自验补出的 Location 专属行红例

当前实现 `background-problem-watcher.tsx` 仍从 SDK 默认目录表枚举名称，导致仅在当前 Location 的宿主快照出现的连接器不进入问题入口，违反本片目录身份要求。扩展原组件用例，让 SDK 表为空、宿主当前目录快照失败：`bun test src/renderer/codepuppy-ui/background-problem-watcher.test.ts -t "launcher snapshots suppress"` exit 1 / 0 PASS / 1 FAIL，入口为 null（日志 `/tmp/connector-r3-location-red.log`）。本次先单独提交该红例，随后只修同一 watcher/client 投影；不改断言。

包内连接器的密钥目标红例：冻结 failure.secret.packageId 已有归属，但新动作只定位独立 MCP 行，没有打开真实包管理页。相同组件用例补入已安装包身份并点击「去填写」，期望现有管理目标 `owned-package`，实际 undefined；`bun test ...background-problem-watcher.test.ts -t "launcher snapshots suppress"` exit 1 / 1 FAIL，日志 `/tmp/connector-r3-package-key-red.log`。测试 harness 仅转出已有管理目标读取器，不新增产品端口；先提交测试，再修动作分派。

### r3 当前 Location 修正与最终检查

红例提交 `3bd9b35ef3` 与 `8675fff688` 的原断言未改：watcher 现在同时枚举本目录宿主快照与 SDK 表，富状态在 SDK 表为空时仍能进入同一问题入口；包内密钥按已核 failure.packageId 打开现有 openPackageManagement。源切换清除旧目录条目，认证携带同一目录，详情回包按完整 identity/代核对。定制中心关闭时不取默认目录/详情，观察器的新增读口也等启动静默后启动；失败详情展开走同一 diagnostic 查询。行保留现有启停、更新与管理操作，仅由富失败动作接管主错误动作；项目行优先显示本目录详情，全局行不借用同名项目收据的状态。

补充身份链证据：既有 connector-launchers 文件新增用例，真正调用 describeLauncherEnvironment → codepuppyVideoDefinition → 同一 expander；展开形态和归档尚不存在形态都返回本代 Node 与固定 cache-root。该用例 1 PASS / 6 assertions，不是 Node 已 ready 的声明。已有 policy subjectBindingDigest 对 bundled 继续使用 bindingDigest，只有 cloud 使用 evidenceDigest（resolver.ts:56-58）；新声明 evidenceDigest 变化没有新增以它为键的持久化写端。

最终相关集（一次，未跑全包/全层/场景/计时）：
- ui-mac：`bun test src/main/connector-launchers.test.ts src/main/connector-launch-state.test.ts src/main/document-runtime.test.ts src/main/codepuppy-sidecar-wiring.test.ts src/main/codepuppy-bootstrap-build.test.ts src/main/sidecar-bootstrap-gate.test.ts src/main/video-service.test.ts src/main/ipc-channel-binding-census.test.ts src/renderer/extensions/connector-launch-presentation.test.ts src/renderer/i18n/locale-regression.test.ts src/renderer/i18n/zh-punctuation.fast.test.ts` → **91 PASS / 493 assertions**（日志 `/tmp/connector-r3-wider-ui.log`）。
- watcher：`bun test src/renderer/codepuppy-ui/background-problem-watcher.test.ts -t 'needs_auth|off on purpose|kill switch on|kill switch released|production wiring|launcher snapshots'` → **6 PASS / 29 assertions**；4 个原计时/窗口用例未跑，日志 `/tmp/connector-r3-final-watcher.log`。
- ext：identity/resolver/register-policy/tool-policy-rpc/unattended-policy 五文件 → **152 PASS / 508 assertions**；plugin-host 只选 unavailable document projection → **1 PASS**。日志 `/tmp/connector-r3-wider-ext.log`、`/tmp/connector-r3-plugin-host.log`。这些是摘要/身份的既有持久化和调用方相关集，不跑其余插件宿主用例。
- core：`bun test test/codepuppy-mcp-runtime.test.ts -t 'the command main writes|Office declarations bind|bundled slots bind|bundled declarations reject|launcher download classification'` → **5 PASS / 67 assertions**；其余引擎/时序用例未跑（`/tmp/connector-r3-final-core.log`）。
- `bun typecheck`：util **114 files**；core **2056 files / 2 projects**；ext 与 ui-mac 均 exit 0；ext `bun run build` exit 0，当前 dist 已重建。

移除臂均 exit 1 后 scoped git restore：Node/cache 精确比较（`connector-r3-node-removal.log`）；environment/cwd 比较（`connector-r3-identity-removal.log`）；preparing 不入问题（`connector-r3-preparing-removal.log`，真组件）；runtime.retry 实际调用（`connector-r3-document-removal.log`，立刻仍为 failed）；首条诊断事实（`connector-r3-assistant-removal.log`，真实子进程 exit 23/stderr）。日志均在 `/tmp/`；还原后相关用例为绿。

依赖定位核对至 #1759 分支 `ade930e31c1eb7e00d670951c663c582891262b5`：R1 绑定返回 env/cacheEnv/rules/locations 已在上表展开；R2 的 install 返回 void，refresh 返回 Promise<void>，project 返回合并缓存键后的对象。未复制这些模块或其缓存键表。

文档检查：官方 check-docs-contract 的 check_repo 对本 worktree/alpha profile 检查，plan.md **0 finding**；仓级仍 **58 errors / 249 warnings**，首个为 docs/README.md 的既有 index.stale，与 r2 收据相同，不顺修。完整结果 `/tmp/connector-r3-own-docs-contract.json`。

未完成的本票工作（不是全归 #1759）：core PackageRunner 全语法适配、持久准备收据/无解析离线入口；Location spawner 诊断 tee/遮密与落盘、runtimeDep/egress 事实及动作；v2 受管请求 entryFor/配方展开/活跃调用 handler；Node boot 重锚与 prepare-before-permit；生产 controller/DocumentRuntime/Host 发布装配。原生无槽声明在未有 launcher 描述时可核验，Node/cache 槽不行；根装配时把临时 Reflect/可缺 context 读取收敛到冻结的必填 bootstrap.launchers。AC-01/02/03/04/05/09/10 整包实测与 AC-06/07/08 真引擎半条链仍未验收，未运行应用/Electron/窗口或无网计时。

遗留去向：Office Python prerequisite builder 的 compileall exit 1 及完整 snapshot 两条缺失前置失败 → 编排器处理本机/产物前置；docs 索引等旧问题 → 既有文档治理，非本票；本票余项 → 按上面下一片继续。无迁移、无其它仓修改、无推送/PR/合并；OPTIONAL：无。
