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
| `process-fence-plan.ts` 绑定 | `planPackageManagerCaches(input: PackageManagerLocationInput & { truthPath: string; eligibility: WorkspaceDirectoryInput }): { env: Record<string,string>; cacheEnv: Record<string,string>; rules: ProcessFenceWriteRule[]; locations: WritableLocationTruth["entries"]; excluded: string[] }`；消费该分支实际绑定后的 env 与 cacheEnv（最终缓存投影）/rules/locations，候选路径不能绕过已有身份绑定。生产 fence 与 bootstrap 用同一份结果 |
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

### r3 新证据：Python 本地镜像可用，但 uv 后处理接缝待裁定

`gate slot -- bun /tmp/connector-r3-managed-python.ts` exit 0：复用 r1 原厂 Darwin Python 实物，经当前 createPinnedFileAuthority.ensureFile 再验为 cache；当前真实随包 uv/Node 资产经 resolveAssets 核验；R1 位置从 #1759 工作树现有 resolvePackageManagerLocations 只读调用，没有复制表或函数。所有进程使用临时 home/userData，本地 file:// mirror 上放固定 build 与解码文件名。显式安装后 `uv python find 3.12.16` 指向 R1 UV_PYTHON_INSTALL_DIR，实际解释器输出 **Python 3.12.16**，拒绝代理计数 **0**。这是独立 CLI/位置候选的子链证明，未调用 planPackageManagerCaches 绑定、未进应用/fence，不能算 AC-01/02/10。首次探针额外加 `--managed-python` 与既有 only-managed 环境互斥而退出，修正的是探针冗余参数，产品代码/冻结环境未改。

**新接缝证据（不是已实测弹窗）**：相同 uv 安装输出 `Failed to patch the install name of the dynamic library ... This may cause issues when building Python native extensions.`。用第二个 gate slot 探针 `/tmp/connector-r3-managed-python-patch.ts` 在临时 PATH 最前放只记标记并退出的 install_name_tool；输出 `invokedInstallNameTool: true`，仍成功运行 Python，0 代理连接，临时 home 仍空。没有执行系统工具或触发任何安装对话框。两个完整结果在 `/tmp/connector-r3-managed-python.log` 与 `/tmp/connector-r3-managed-python-patch.log`；原件/展开树保留于日志 root。

只读读取系统工具字节：`/usr/bin/git` 与 `/usr/bin/install_name_tool` 均 **118880 B**，SHA-256 **a961f78075d8e7621ef4f5d764c64ef8a41bf66c0a98ab5cb6ca39b85ce31c93**，均含 `__xcrun_shim` / `_xcselect_invoke_xcrun`；未执行它们。当前锁 `resources/connector-launchers/lock.json:4-6` 钉住 uv 0.13.10；冻结 design.md:143 的 PATH 保留宿主系统路径，:178 的 uv python install 命令未处理这个后处理，:255 已明确这类 Git shim 不能试跑。uv help python install 只有 no-bin/no-registry/mirror，未找到可禁该后处理的公开选项；不假设有未核实的开关。

**SEAM-CHANGE-NEEDED：v1 §4.3/4.4 的 managed Python 安装策略。** 实物已证明 uv 会执行 PATH 里的 install_name_tool；在干净 Mac 的既定 PATH 下有命中上述系统 shim 的风险。无 CLT 时实际弹框尚未（也不允许在本任务中）触发，因此此处明确是基于调用与相同系统实物的风险推断，不能写成已录到弹窗。需要设计拥有者冻结一个无 CLT 时不执行该 shim、保留固定 Python 及本机模块能力的处理：
- 选项 A：让 uv 安装侧跳过/内部处理可选的 install-name 后处理；优先推荐，因为不新增用户步骤/工具资产，但是否有可用的上游实现/新 pin 尚未验证，当前 CLI 不能假定支持。
- 选项 B：随包提供真实所需处理能力，避免落到系统 shim；需要扩大当前资产/签名或第一方实现的明确边界，成本较高，不能偷塞空操作脚本或要求用户装开发工具。

不擅自改 uv pin、PATH 次序、#1759、设计正文或给用户增加安装步骤。已完成独立片保留在本分支；PackageRunner 的生产 Python 安装接线先等待该裁定，其余未完成代码仍归本票，不用这条新接缝掩盖为都已实现。

`affected-tests --list`（3a1cbe185b 代码树）：**affected tests: 379 of 741 test files**，exit 0，无全量 fallback；清单 `/tmp/connector-r3-affected.list`。后续只补本文收据，不改变选集输入。已核：Codex / GPT-6，冻结 DESIGN v2.2 / SPEC v1 + r3；遗留去向：上述 Python 后处理裁定交设计拥有者/编排器；R1/R2 生产装配等待 #1759 合入；本票余下准备/离线/诊断/handler 按上节继续。

## 三：r4 Python 安装裁定与持久准备

- 依据：r4 编排器裁定（Claude Opus 5.5，2026-11-27），继续冻结 v1 §4.3/4.4、v2.2；设计 §10 的传播由编排器负责，本文不改设计。
- 核对：Phase: IMPLEMENT；本段先计划提交，再红例提交，计划 `a1205e0af8`；首次实现按 Phase: IMPLEMENT 核对。Codex / GPT-6。
- 本轮起始：2026-11-26T16:40:15Z，预计约 90 分钟；不启动应用/窗口，不跑整层/计时测试。

### 文件与顺序
1. 新增 `packages/core/src/mcp/codepuppy-connector-launch.ts`，作为冻结 prepareConnectorLaunch 所在模块。先落 Python 安装步骤：在当前 Location Environment 的 spawner 上运行绝对 `/usr/bin/xcode-select -p`，核验返回的目录；仅该步骤在缺工具时使用随包目录 PATH。Windows 不进行 Mac 探测。其它阶段保留正常计划 PATH。
2. 新模块在 `packages/core/test/codepuppy-connector-launch.test.ts` 新增 integration 层用例（模块尚无测试文件）：已有 spawner 是探测结果 seam；系统 PATH 的临时 marker 工具在 absent/missing-path 情形不执行，present 情形执行。真实 uv/Python 原包仍用 gate slot 的一次性探针，不把大运行时加进常驻测试。
3. 接同模块的两类运行器准备、私有归一与持久收据；必要的官方 npm 解析适配放随包 launcher helper，消费 npm 自己的解析模块，不另列包名单。持久收据单独复用当前 cwd/服务参数/环境，命中不调包解析/安装。增补的文件随实际落置记在本段偏离记录。
4. 后续按剩余时间完成诊断 producer 与 v2 活跃调用 handler；涉及 root 的已知 #1759 接口继续只消费，不复制位置表。未完成时给出精确可恢复状态，不把 helper 通过称为整包 AC 完成。

### 风险与证明
- 限制 PATH 只存在于 uv python install；native extensions 源码构建在缺开发工具时仍没有 install-name 修正。裁定接纳 wheels 连接器不受影响，不给用户增加安装步骤，不生成空操作脚本。
- AC-01：先提交 marker 红例，再实现；去掉限制即 marker 执行而失败。真实 pin + restricted PATH 产出 Python 3.12.16，保持原摘要/离线镜像证据。
- AC-02/04/05/10 子链：准备命令使用本代随包入口、已有位置环境、真实解析器；本机包/空缓存/真围栏/整包计时不由本片替身证明。
- 相关集只跑修改用例、模块文件及最终一次调用方；记录 typecheck、移除臂与 affected-tests scope。常驻测试依赖通过静态 import 和自身临时文件可追踪，无全局 gate 输入变更。

### 偏离记录
暂无。

r4 安装步骤基线：先落当前 Location spawner 的固定 uv python install 命令与有工具时保持原 PATH 的正例；下一个提交单独保留无工具 marker 红例，再收敛该步骤 PATH。无生产 root 调用者，未把缺工具策略记为完成。

r4 red-first：`bun test test/codepuppy-connector-launch.test.ts -t "excludes system tools"` 在安装步骤基线 616d06524b 上，absent / missing-directory 均因 marker 为 true 而失败（0 PASS / 2 FAIL；`/tmp/connector-r4-python-red.log`）。下一提交不改这两个断言。

r4 guard green：原 absent/missing-directory 两个断言不改，生产步骤从 Environment.spawner 取得安全探测结果、用同一 Environment.files 检查目录。仅 uv python install 在缺工具时改为 uv/Node 两个随包目录 PATH，后续安装/服务及调用方原环境保持正常 PATH。前一轮首次 green 误用 Stream.drain（返回 Stream）导致 Not a valid effect，已按当前 Effect API 改 runDrain；随后文件 3 PASS / 11 assertions（`/tmp/connector-r4-python-green.log`），不是反复重跑不明红例。

r4 已完成子链：真实探针 `gate slot -- bun /tmp/connector-r4-runtime-proof/install-python.ts` exit 0（`/tmp/connector-r4-managed-python.log`）。当前 Python pin 经唯一 authority 再验为 cache，R1 从 #1759 原函数取得；测试 seam 仅替换 developer probe 为 exit 1。真实 uv 以仅 uv/Node 目录的 PATH 安装 3.12.16，system marker=false，额外代理连接=0；Python `--version` 为 `Python 3.12.16`。uv 明确警告 install-name patch 未做，安装 exit 0；wheels 不受影响是 r4 裁定，并非本探针独立证明。无应用/utilityProcess 真围栏，不能当 AC-02 或整包 AC-01 通过。

r4 准备收据：同一 core 新模块的 publishConnectorPreparation/readConnectorPreparation 只持久化 schema/ready/key/runner/真实版本/入口/所需文件，以 Location.files 写 part 后 rename；载入只读文件，无包管理器、TTL、刷新或环境持久化。prefix 内入口缺失/损坏/跨 runner/半成品不算 ready；调用输入每次绑定。`bun test test/codepuppy-connector-launch.test.ts` → 8 PASS / 36 assertions；`bun typecheck` → exit 0，2058 files / 2 projects。开发中按本地 Effect 4 API 修正 catchTag 和 fromJsonString 后通过。尚未接 prepareConnectorLaunch 的完整语法归一及调用者，不把 helper 的无进程读取等同 AC-10 整包启动。

r4 v2 client 子链：新增 `packages/core/src/mcp/codepuppy-pinned-files.ts`，从既有 client 的受管构造上下文注册三参数 SDK handler；util 同一模块补冻结 Host 发布/读取与 v2 DTO。`mcp/index.ts`、`tool/mcp.ts` 是冻结 V2-R5 点名的必要调用链：本次 Tool.Context 捕获 report，逐层传 preparation；client 真实 tools/list 匹配后才给 tools/call 关联值与原 execution 绝对 deadline，结束/取消/关闭撤销，按当前 call 递增进度，不用 initialize context。没有配方的 client 不注册方法或 capability。

真实 SDK 2.3.1 的 custom schema 收到带 `_meta` 的完整 params（直接 additionalProperties:false 会误拒绝），因此 handler 边界先去协议字段再对唯一业务字段 ids 做严格 schema 校验；ctx.mcpReq 单独取协议关联。未改 SDK/protocol codec，不是设计分叉。

`bun test test/codepuppy-mcp-runtime.test.ts -t 'managed pinned|refuted managed|production MCP client registers pinned'` → 5 PASS / 27 assertions（`/tmp/connector-r4-pinned-client.log`）：实际双 SDK peers；完整组 ids 验完才调宿主、去重、当前 token/deadline、并发调用归属、撤销/原调用取消/晚到进度，以及生产 McpClient 的真实 handler 与 Host 端口；握手/列工具期间宿主调用为 0。core/util/ui-mac typecheck exit 0。该文件包含既有真引擎/时序用例，本轮只跑命名新增例和最终相关轻用例，不运行其整文件时序组（brief 禁止）。

接线界限：managedFirstParty 构造上下文是已冻结 binding/declaration 的内部数据轴，并非用户选项；当前还没有从生产 attempt controller 给 McpConnection 传入，main prepareFiles/entryFor 重验与配方展开也未落，因此以上不能作为视频整链完成。#1759 R1/R2 清单仍沿 r3 表，不复制其位置/绑定。

r4 诊断 producer：新增 `packages/core/src/mcp/codepuppy-connector-diagnostic.ts`，必要的独立域函数 observeConnectorLaunch 取得当前 Location 的 files/spawner，返回仅该 attempt 的执行面与阶段/诊断读取。真实句柄的 stdin/stdout/kill/unref/附加 fd 保留；后台观察真实 exit/signal，stderr 在跨块遮密后才同时进入完整诊断和 stdio，未用尾部/300 字符摘要。无工具启动时 exitCode=null；日志替换为遮密 argv，抑制底层同次 spawn 的原 argv 行，平台错误保持 tag/分类。诊断文件按 attempt 编码在 runtimeRoot/diagnostics 内派生，业务环境不落盘；root/controller 仍待接入。

`bun test test/codepuppy-connector-launch.test.ts` → 13 PASS / 68 assertions（完整输出 `/tmp/connector-r4-launch-final.log`）；`bun typecheck` → exit 0，2060 files / 2 projects。真实进程逐字节拆 stderr，跨换行已知密钥、Authorization、URL 凭据/签名均遮蔽，6KB+ 原文不丢，stdout 未收集进诊断；exit 23、SIGTERM、未 spawn 的 null、管道错误下未换行片段均有证据。实际 McpClient→未修改 McpStdio→装饰后的 Location spawner 证明完整崩溃仍在、stdio 所读字节已遮蔽；连接成功后终止的真实 MCP 子进程仍取得 running/SIGTERM。

测试修正事实：stdio.ts:101 的独立 Effect.runPromise 只携带 Scope，调用方 Logger 无法捕获其 debug 行，不能把空 capture 当“不泄漏”。两种 logger 注入均不改变此事实；未修改 stdio。最终在其实际句柄读取边界完整比对 masked bytes，并独立核验可捕获的 spawn/client 日志；不声称捕获了该独立执行体的全部 logger。此处是当前原始 stdio 的上下文限制，不作为本票去修改它的授权。

r4 准备环境补齐：同一 core 模块增加 connectorRunnerEnvironment，入参的 PackageRunner 保留原声明角色；准备/已准备服务共用随包 uv/Node、已解析 Python 与包 bin 的 PATH 次序，原生声明不进入此函数。只清宿主继承的 NODE_OPTIONS/PYTHON* /VIRTUAL_ENV，显式声明的业务输入仍后绑定；Windows 环境键及 PATH 去重按平台大小写语义处理。npm 三项准备设置与 uv 专用 tools/bin 按冻结表覆盖，HOME/XDG_CONFIG_HOME/registry/私有密钥保留；R1 缓存键不由此处投影，仍等最终 R2。3 个 pure 用例 / 26 assertions 通过（`/tmp/connector-r4-runner-env.log`）。修正上一段诊断计数：完整文件实际为 13 PASS / **67** assertions。

r4 v2 main 准备子链：同一 createLauncherAssetAuthority 增加 prepareFiles，composition root 的私有 context 绑定当前 generation/snapshots、受保护 manifestPath 与唯一 files.ensureFile；MCP 不能提供 context。先按完整 identity 和 main 自己的 launchers 调同一 declaredFirstPartyTools，重验显式 entry、代码字节和两个摘要，整组 ID/平台/配方验证完成才 I/O。每项仍走唯一 pinned authority，再按受保护 recipe 展开/复制到 assets/id/recipeSha；required/入口、链接范围和可识别目标架构核验后 ready 原子发布。并发解包合并、缺成员重建，单个取消不损坏其它等待者，失败保留原类别/事实与 progress。

新增必要同链文件 `packages/ui-mac/src/main/pinned-files.ts`：原有逐父目录防软链写入逻辑提取为同文件 ensurePinnedDirectory，下载与派生条目复用一个边界权威；未复制路径表/下载器。系统 archive adapter 的第三参是冻结 recipe 的 archive 域；Windows 的 zip 仍用既有 Expand-Archive，tar 三类用系统 tar，Mac 均用系统 tar；允许合法指向暂存根本身的内部目录链接，仍拒绝根外目标。没有执行包代码或安装命令。

`bun test src/main/connector-launchers.test.ts src/main/pinned-files.test.ts` → 29 PASS / 254 assertions（`/tmp/connector-r4-assets-final.log`）；随后新增 invalid-binding failure 详情，最终相关收据另记。当前 10 个新增用例覆盖 raw file、zip/tar.gz/tar.bz2/tar.xz、完整字节/缓存/缺成员、整组先验零下载、代码/Node/env/cwd/摘要/代不匹配、合法文件与根目录链接、真实 tar 拒绝穿外链写入、二等待者一取消和另一完成。归档由系统 tar 从实际随包 pins JSON 生成，头部取既有原厂 fixture；不是手写 tar/PE/Mach-O 代用品。Windows 全链没有实测。

尚待接上：entryFor 窄桥与 prepareFiles 的 sidecar adapter、生产 attempt/controller→managed binding 构造、Host/文档运行时/root 装配；本段的私有 main context 在 root 落地时只绑定已有权威，不新建第二份配置/身份源。

r4 entryFor 桥：现有 PinnedFileRequest 增补冻结的 entryFor，严格校验 binding 形状与 generation；同一 progress 通知承载本域 preparation 事实，不把解包阶段推测成下载字节。createPinnedFileRequester 增加 ensureEntry/prepareFiles，仍是同一按 ID 的请求/取消/终结表；group 按首次顺序去重并汇合进度序号。main bridge 的受管入口端口缺席时给明确 unknown-file/内部接线详情，绝不把原始归档误当已准备入口。根装配可将 assetAuthority.ensureEntry 绑定到该端口，复用 prepareFiles 的同一验证/下载/展开，保留原 delivery.via 与失败证据。core SDK handler 与私有 main context 的 frozen 数据轴均无新用户配置。

新证据：实际 requester→main bridge→同一 launcher authority→pinned authority→展开，返回模型目录而非归档，relay provenance 保留；缓存/去重只下载一次，preparation 阶段传回，缺端口/异代/外来 malformed 进度均不会借 raw 路径执行。master pin 不完整时，main 在第一条 entryFor I/O 前拒绝该受保护配方，故 sidecar 的逐 ID group 不会先下载前半组。Tool.Context 的既有 video 进度用例扩为 video+preparation，同一生产 Tool 注册表在 Location A/B 两次调用分别保留本次 Effect context。新文件仍只有 r4 已列两个 core 域模块与其测试，未改 gate、其它 spec 或围栏模块。

最终 wider-related 的 MCP mock 发现本轮引入的旧断言：`test/mcp.test.ts:2850` 仍精确期待无 preparation 的内部调用对象，实际多出冻结 V2-R5 的 callID/report。按旧行为测试同步规则，保留原 server/name/args/sessionID 的完整比较并补此字段（direct ID 精确、Code Mode ID 沿既有 String 域，report 必为函数），未改产品来丢弃 preparation。原命名集 11 PASS / 1 FAIL（`/tmp/connector-r4-mcp-mock-related.log`），修正用例 1 PASS / 4 assertions（`/tmp/connector-r4-mcp-invocation-green.log`）；其它已绿例未重复。此测试文件为必要同调用链初始列表外增补。

r4 Python 本地镜像的产品步骤：同一 launcher authority.ensureFile 包装原 files.ensureFile，只有本代 pythonFileId 成功时补 file:// 镜像；文件名直接取 authority 已解码的磁盘名，build/root 取现有 LauncherEnvironment。目录防软链仍复用 ensurePinnedDirectory，复制后 bytes/sha256 验证、part→rename，命中重验/损坏修复，不增加 URL/下载表。其它 ID 原样交原 authority；Root 的 ensureFile/旧 ID 桥可绑定这一个包装，entryFor 则绑定 ensureEntry，同享 pinnedFileAuthority 实例。

补充一轮真实探针是为验证新镜像产品步骤（不再由探针手工 link）：`gate slot -- bun /tmp/connector-r4-runtime-proof/install-python-staged.ts` exit 0（`/tmp/connector-r4-managed-python-staged.log`）。固定原包重新通过 pinned authority cache 后，由产品 authority 放镜像，25270084 bytes 逐字相等，文件名含字面 `3.12.16+20261124`，再次 cache 命中；真实安装成功、Python 3.12.16、额外代理请求 0、system marker false。uv 的 install-name 警告仍在，属于 r4 已裁定 residual；仍非应用/真围栏入口。新增镜像用例 1 PASS / 8 assertions，模块最终 22 PASS / 104 assertions（`/tmp/connector-r4-main-final.log`）。

r4 最终收敛：SDK handler 复用同一 first-party 模块的 listedFirstPartyTools，原 declaredListedTools 委托同一既有投影，避免新 handler 再维护另一份工具规范化。该必要同链模块为 r4 文件清单补项；原公开函数签名/行为未改。最终受影响纯身份/真实 SDK 10 PASS / 85 assertions（`/tmp/connector-r4-final-first-party.log`），ext `bun run build` exit 0，未出现 tracked dist 差异。

#1759 接缝复核到分支提交 `ef8a1ce8b4441aeeb12cc3a5cc0843ad43c1682f`：R1 输入/resolve 函数及 R2 install/project/refresh/requester 签名保持上表；planPackageManagerCaches 的实际返回补列 excluded:string[]。当前 R1 不含 npm_config_prefix，表内旧括注按源码修正；本票 npm 准备仍使用冻结的显式 --prefix，不另投影此键。Root 必须消费同一次绑定的 env/cacheEnv/rules/locations，R2 沿其 engine/package-manager-spawner 最终投影，未复制任何位置键表或绑定实现。真实探针只用其候选 resolve，不能当已绑定 fence 证明。

### r4 最终交付收据

依据版本：SPEC v1、冻结 DESIGN v2.2、r4 编排器裁定。已核：Codex / GPT-6，结论 PARTIAL。已定勿重开：随包 uv/Node、唯一 pinned authority、#1759 R1/R2 所有权、严格首方身份、仅 uv python install 的无 CLT PATH 裁定。本轮没有新设计分叉或用户批准问题。

- AC-01/05 子链：marker red-first 在 616d06524b 为 0 PASS / 2 FAIL，guard 后通过；真实 pinned 3.12.16 与新产品镜像步骤通过（上文两份实际探针记录）。缺 CLT 仅缺 install-name patch，wheels 影响沿 r4 裁定，不冒称真干净 Mac/正式包验收。
- AC-02/10 子链：持久收据只保存包事实、原子发布、缺文件/坏收据不命中；重新加载不调解析器/进程，当前业务输入重新绑定。Environment 的 Python 安装和执行观察已实跑。完整 prepareConnectorLaunch、真实包语法/规范化 key 尚未实现，不能把这些私有步骤称为整包写入围栏或离线重启通过。
- AC-06/07/08 子链：r3 的一份呈现/runtime.retry/助手首条消息证据继承；本轮完整 stderr 的遮密 tee、真实 exit/signal、未 spawn 的 null、连接成功后退出、实际 stdio 所读 masked bytes 有新增证据。core changed/diagnostic 的生产 producer/窄桥仍未接，不声称应用行已由新链驱动。
- v2：受管 SDK handler、活跃调用/Effect context、取消/期限、entryFor 请求/进度、main 逐字身份与代码重验、单一下载 authority、配方展开/验证/缓存均已落；真实 Slot/root→McpConnection 的 managed binding 构造和 Host 发布尚未装配，不能称视频端到端完成。

最终相关检查（所有命令 exit 0，除已说明的红例）：
- core：5 个明确文件（connector-launch / tool-collision / tool-generation / mcp-attach / mcp-instructions）41 PASS / 161 assertions；MCP runtime 12 个命名轻例 12 PASS / 97 assertions，跳过其余 23 个含引擎/时序例。投影收敛后只复核受影响的身份/SDK 10 例，10 PASS / 85 assertions。日志 `/tmp/connector-r4-core-related.log`、`connector-r4-core-runtime-related.log`、`connector-r4-final-first-party.log`。
- UI/main：7 个明确文件 69 PASS / 457 assertions；新镜像步骤后只跑受影响的 launcher 文件，22 PASS / 104 assertions。日志 `/tmp/connector-r4-ui-related.log`、`connector-r4-main-final.log`。
- ext：identity/resolver/register-policy/tool-policy-rpc/unattended 5 文件 136 PASS / 461 assertions（`/tmp/connector-r4-ext-related.log`）；类型/构建均 exit 0。core / util / ui-mac 的 bun typecheck 也均 exit 0，core 2060 files / 2 projects、util 114 files。包内无独立 lint 命令，git diff --check 通过。
- MCP mock 中旧精确断言按新内部 contract 补齐（上文 red→green），保留其原字段比较。环境 pure 用例只构造 DTO，未复用 marker 的写盘 fixture；此测试数据整理只复核该三例和共用 DTO 的 Python 正例，4 PASS（`/tmp/connector-r4-pure-fixtures.log`），无新 IO/clock/全局测试输入。
- 八个移除臂分别移走：收据命中、遮密、显式 env/cwd 比较、recipe ID 拒绝、Tool.Context 传递、宿主运行时环境隔离、recipe 入口（改回原始归档）、Python 镜像步骤；均 exit 1 且是相应行为失败，随后 scoped git restore。日志 `/tmp/connector-r4-removal-<receipt|diagnostic|identity|pinned_ids|tool_context|runtime_environment|entry_path|python_mirror>.log`。前六在 wider-related 恢复绿，后两 `/tmp/connector-r4-final-restored.log` 2 PASS / 15 assertions。
- `affected-tests --list`：**affected tests: 380 of 742 test files**，exit 0，无全量 fallback（`/tmp/connector-r4-affected-final.scope` / `.list`）。未改 gate/global 输入；没有拓宽每个 PR 的全局测试层。两次 list 中第二次是后续新消费者/测试变化后的最终选集，不执行测试。

当前下一步（仍归 #1760）：完整 uv/npx 官方语法适配、非秘密解析内容 key、包持久安装/bin 与 prepareConnectorLaunch 组合（含 Location 内运行目录准备/自动恢复）；接到 startPermits 前，prepared 直接入口再启服务；生产 attempt identity/state/诊断 producer、runtimeDep/git/secret/egress 事实与动作；首方 Node/cache root 的 boot 重锚与 mandatory bootstrap.launchers；将上述 Host、entryFor/DocumentRuntime.retry 和诊断查询装到当前代 root。#1759 合入只消除 R1/R2 位置/绑定依赖，不自动补完本票余项。AC-01/02/03/04/05/09/10 的正式包、干净账户、国内节点、原生模块与离线时钟，及 AC-06/07/08 真引擎整链仍待验收；本轮未运行应用、窗口或计时/容量/全层用例。

Office 前置失败明确交接（继承 r3 事实，不重跑）：在 packages/ui-mac 执行 `gate slot -- bun scripts/build-office-runtime.ts`；最终失败命令为 `native/office-runtime/build/arm64.staging/python/bin/python3 -I -m compileall -q -f -j 0 -s native/office-runtime/build/arm64.staging/python --invalidation-mode unchecked-hash native/office-runtime/build/arm64.staging/python/lib/python3.11`，exit 1、stderr 空。包装器 `scripts/build-office-runtime.ts:398` 没有保留 stdout；原因未确定。前两次 pip --only-binary/:all: --require-hashes 的安装也 exit 1、stderr 空，完整原命令在 `/tmp/connector-r3-office-build.log`。未将此归因于本轮 3.12.16 的 install-name 警告。

遗留去向：本票余项→#1760 下一轮；#1759→合入后按接口表消费；Office Python 前置→编排器处理本机/构建前置；docs/README.md 既有 index.stale 等→既有文档治理。官方 docs check_repo 对本 worktree 的 plan 0 finding，仓级 58 errors / 249 warnings 与 r3 相同；不顺修。无迁移、无其它仓修改、无 push/PR/merge，hooksPath=.githooks；OPTIONAL：无。

本轮最终规模：17 files changed, 2357 insertions(+), 79 deletions(-)（含计划、测试与必要格式化）；核对时间 2026-11-26T18:04:04Z，自本轮 16:40:15Z 起用时 83 分 49 秒，原预计约 90 分钟。

最终相关命令原文（分别在包目录执行；包含已列出的部分覆盖，不能把各行计数相加当唯一用例数）：
- core：`bun test test/codepuppy-connector-launch.test.ts test/codepuppy-mcp-tool-collision.test.ts test/codepuppy-mcp-tool-generation.test.ts test/mcp-attach.test.ts test/mcp-instructions.test.ts` → 41 PASS。
- core runtime：`bun test test/codepuppy-mcp-runtime.test.ts -t 'the command main writes|Office declarations bind|bundled slots bind|bundled declarations reject|launcher download classification|managed pinned|refuted managed|production MCP client registers pinned|ordinary MCP client|video progress follows each real SDK request'` → 12 PASS；投影提取后去掉分类/video 两个不受影响例的定向复核为 10 PASS。
- ui-mac：`bun test src/main/connector-launchers.test.ts src/main/pinned-files.test.ts src/main/connector-launch-state.test.ts src/main/document-runtime.test.ts src/main/codepuppy-sidecar-wiring.test.ts src/main/video-service.test.ts src/renderer/extensions/connector-launch-presentation.test.ts` → 69 PASS；镜像步骤后的 `bun test src/main/connector-launchers.test.ts` → 22 PASS。
- ext：`bun test src/policy/identity.test.ts src/policy/resolver.test.ts src/policy/register-policy.test.ts src/policy/tool-policy-rpc.test.ts src/policy/unattended.test.ts` → 136 PASS。

## r5｜切片三/四/五继续：官方声明归一、许可前准备、开机重锚与诊断状态

- 依据：SPEC v1 AC-01/02/04/05/06/07/08/10；冻结 DESIGN v1 §4.4–4.7、v2.1/v2.2 §4/§10；r4 收据 e6e72ec6d6，r5 IMPLEMENT 续接。
- 核对：r4 PARTIAL 已由编排器接受；本轮按 r5 的 IMPLEMENT 继续，不重开冻结决策。Codex / GPT-6。
- 起始：2026-11-26T18:08:43Z；预计约 90 分钟。Office compileall 已移交 documents，本轮不读其构建产物或运行构建。

### 文件、顺序与证明
1. **切片五：应用首方 Node/cache root 开机重锚**。在 `ui-mac/src/main/codepuppy-video.ts`/既有配置对账调用链消费同一个 expandFirstPartyCommand 与已安装身份，保留 enabled/业务配置；测试放既有 connector-launchers / config-injection 测试。只处理应用自有条目，严格身份 matcher 不放宽旧 Node 路径。证明当前 descriptor/归档路径尚未 ready 时仍锚到本代路径、第二次无写入、自定义/额外 env/cwd 不冒认首方。
2. **切片三：许可前准备与直接执行**。`core/src/mcp/connection.ts`、`client.ts` 消费宿主私有准备结果；准备等待发生在 startPermits 和握手预算之前，失败不调用服务。测试放既有 `codepuppy-connector-launch.test.ts` / `codepuppy-mcp-runtime.test.ts`，用真实 Location/SDK 的事件屏障，不做墙钟/容量用例。原生命令保持原环境，first-party Node 只等 resolveAssets。
3. **切片三：官方语法/key**。在同一 core launcher 模块及必要自有 helper 中使用随包 Node/npm 的官方参数解析和 bin 选择，uv 使用被钉版本的实际语法；逐步接非秘密解析内容指纹与现有准备收据。只在 Location spawner/files 上运行，服务参数/cwd/secret 不进入 key。不得以窄目录包名单或“第三方不支持”替代合法语法。官方本地文件/CLI read-only 探针先在 /tmp；大实物仅一次性 gate slot，不放常驻测试。
4. **切片四：诊断/状态 producer**。复用 r4 的观察器与 util Host/LaunchSnapshot，生产本 attempt 的 preparing/connecting/connected/failed/disabled 和完整诊断；在既有模块测试中证明 seq/identity、取消/晚到结果及两入口状态消费。生产 controller/Host/root 组装仍等待 #1759，不复制其位置/最终投影。
5. 最终仅相关测试、适用包 typecheck/build、必要移除臂与 affected-tests --list；记录 #1759 当前接口提交、准确未完成边界和文件偏离。无 gate run/bin/check、全层/计时/容量用例、应用或窗口、push/PR/merge。

### 风险与偏离
官方完整语法/解析配置的归一可能占主要时间；保持当前真实语义，不靠猜测过滤选项。若接缝不足，按事实返回；普通私有 helper 选择不转回设计。新文件与初始列表外的必要同链改动在实际提交补列。暂无其它偏离。

### r5 已落：许可边界、直接执行与 attempt producer

`McpConnection.Input.localLaunch` 是 sidecar controller 的私有受信上下文（不进入 ConfigMCP/HTTP）：同代 host、runtimeRoot、当前 secrets、已精确核验的 firstParty 声明/descriptor、包准备 Effect。每次 start 生成新 identity，先读 host.runtimeDependencies、检查真实 cwd，再进行包准备或首方 Node resolveAssets；返回 Node 与受信 descriptor 不同即拒绝。准备/资产等待在 startPermits 与 McpClient.initialize 的预算之外；包准备回调消费实际 identity/runtimeDep 并向同一个 producer 报进度。此回调是尚未完成的 prepareConnectorLaunch 的接入点，不宣称已实现官方完整解析/安装。

McpClient 的宿主私有 prepared 参数直接绑定本次 command/cwd/environment。只在该 stdio 的 Environment.spawner 将 extendEnv 设为 false，避免继承重添已去掉的控制项；原生 Node/其它命令保留原环境语义，上游 stdio 不改。createConnectorLaunchAttempt 从 r4 真句柄观察器生产递增 sequence、阶段、进度、单次失败及不透明 attempt ID；停止/取消后丢弃晚到状态，连接后退出也收完整诊断。connection.diagnostic 仅接受本次完整 identity，不接受路径；root 仍须装上该查询与状态桥。失败后 stop 保留失败，不用 disabled 覆盖它。

实际文件补项：`core/src/mcp/pool.ts` 仅转发新增私有 diagnostic 查询，满足既有 Connection 实现；`core/test/fixture/codepuppy-mcp-startup-stdio.ts` 增两个自有输入（报告本次 argv/cwd/是否继承 HOME、调用后 crash），复用真实 SDK stdio，非第三方格式替身。没有 process-fence 文件修改。顺序偏离：先完成许可/诊断，boot 重锚依赖 mandatory bootstrap.launchers 的生产投影尚未装配，现有 video 宿主每 fork 投影仍是唯一写者，不新增平行配置写者。

证据：新增真 stdio 的 prepared 例在旧 client 为 0 PASS / 1 FAIL（must-not-run-npx 的 dependency_missing，`/tmp/connector-r5-prepared-red.log`），实现后 1 PASS / 4 assertions。新 4 个连接用例 4 PASS / 34 assertions；Node 资产两例 2 PASS / 9 assertions；cwd 缺失 1 PASS / 2 assertions。命令均在 core：`bun test test/codepuppy-connector-launch.test.ts -t '<对应完整名称或上文日志中的选择>'`，记录 `/tmp/connector-r5-connection.log`、`connector-r5-node-wait.log`、`connector-r5-workspace.log`。许可证明只在一个准备事件上立即试取既有许可、无等待/计时/容量运行；取消用 Deferred/Promise 屏障，晚到结果不 spawn。23 例中间整文件 23 PASS / 140 assertions（`/tmp/connector-r5-step-connection.log`）；新增 cwd 后最终整文件见本轮最终收据。

#1759 只读复核仍为 `ef8a1ce8b4441aeeb12cc3a5cc0843ad43c1682f`，此前 R1/R2 接口表和签名未变。接线仍消费同一次 planPackageManagerCaches 的 env/cacheEnv/rules/locations/excluded、resolvePackageManagerLocations 的候选，不在本票复制缓存键表；最终 spawn 由其 project/refresh 权威覆盖。当前本票 localLaunch 没有装到 index/controller/root，故这些证明不能当应用启动或真围栏验收。

### r5 官方 npm 语法阶段与原生失败事实

新增 `core/src/mcp/codepuppy-npm-launch.ts`：readNpmLaunchDeclaration 在调用者 Location spawner 内以随包 Node 运行，原 argv 经 npm 自己的 npx-cli.js 改写、@npmcli/config 加载、npm-package-arg 解析、官方 cmd-list.deref 处理 npm exec/x；拦住的只是 npx 最后的 CLI dispatch，不执行包或服务。原 argv/凭据经 stdin 交该应用自有程序，native 环境不改。返回的 options 是实际生效的**临时解析配置**，含认证，明确不是 key/收据，不落盘、不日志输出；后续仍须提取只影响解析的非秘密内容，不能 hash 这整个对象。现有 util/NpmConfig.load 为引擎依赖管理使用宿主 Bun/当前 process.env/该缓存的 prefix；不把它错当 Location 内随包 npm 的解释器，也未修改该单一职责或引入第二份下载 authority。

真实一次性验证：`gate slot -- bun /tmp/connector-r5-npm-proof/parse.ts` exit 0（`/tmp/connector-r5-npm-proof.log`），pinned Node 26.13.1 + npm 11.20.0/config 10.13.0，6 组：Boolean 开关后业务参数分界、重复 --package、scope/version/alias、--call 不执行、npm exec/x、file: 真实 npm 目录。项目 .npmrc registry 和占位认证确实进入临时 options；没有打印整份 options。最初项目配置断言失败是探针缺 package.json 而父目录已有 node_modules，npm 按原规则选了父 prefix；用真实 npm package.json 作为探针输入后通过，未改 npm 的项目根语义。

Boolean case 曾在 VM 新 realm 下使官方 definitions 的 Boolean 与 CLI 的 Boolean 不同，真实红例 exit 1（`/tmp/connector-r5-npm-boolean-red.log`）；现用当前 realm compileFunction 执行未修改的已钉 npx 源码，保留构造器身份。常驻两个集成例复用仓内 util 已有 config 10.8.1/npa 13.0.2 和来自该官方归档的三个原样源码夹具（fixture/npm-launch/{npx-cli.js,npm-cli.js,cmd-list.js}，带原 LICENSE），2 PASS / 10 assertions；没有新增依赖，也不把这个轻夹具版本称为随包版本实证。新夹具均以字面 URL 读取，跟随原 test 文件进入 affected 选集。

另补同链 `core/src/mcp/codepuppy-startup.ts`：实际 spawn 的 PlatformError.NotFound 在既有 classifier 产出 typed workspace/dependency 事实；ConnectError 仅增加内部 failure，带到同一 producer，不改 Mcp.Status/HTTP。程序名取实际 command[0]（prepared 时取 prepared.command），不解析 spawner 的 pathOrDescriptor：真实样本是拼接命令并带尾空格，并非程序名。真 native 缺程序的旧链为 0 PASS / 1 FAIL（`/tmp/connector-r5-native-red.log`），接通事实后 1 PASS / 2 assertions（`connector-r5-native-green.log`）。错误 code/reconnect 仍同一个 authority，不再由旁路猜一套。

边界：这一阶段还没有 npm 默认/显式 bin 选择、uv 全语法适配、非秘密 key、包安装/持久入口与完整 prepareConnectorLaunch，不能称 AC-04 或 AC-10 全部通过。Node boot 重锚、mandatory bootstrap.launchers、Host/controller/index/root/窄消息与真实 installed runtimeDep/secret/egress producer 的 production composition 仍按 #1759 接口表等待；本轮准备好的 localLaunch 接口消除了连接层重复装配工作，但不会自动完成这些缺口。

r5 v2 接线证据：将既有 `codepuppy-mcp-runtime.test.ts` 的 managed production client 例提升为真实 McpConnection→stdio→SDK→同一已发布 Host；仍是此文件唯一的 Host publisher，不添加 reset 或第二个全局注册。原来「初始化/列工具不请求文件、只有 active call 才请求、绑定一致、进度回原 invocation」的断言全部保留，binding 改由真实 connection 构造，1 PASS / 8 assertions（`bun test test/codepuppy-mcp-runtime.test.ts -t 'production MCP connection registers pinned'`，`/tmp/connector-r5-managed-connection.log`）。自有 stdio fixture 只增 echo 参数触发已冻结 ensure 方法，协议由真实 SDK 编解码，没有实现另一套 handler。此测试不代替未装配的 main/sidecar root 或真实下载验收。

### r5 Node 重锚的待裁定接缝（不改权限契约）

`design.md:769` 要求确认 Node 重锚不会使按摘要持久化的状态失效。逐链核对后的精确事实是：MCP 的 authority.evidenceDigest 含展开 command（`ext/policy/identity.ts:142`），但 MCP 的工具/服务用户记录实际保存的是另一份 mcpBindingDigest（`identity.ts:174`、`rpc.ts:57,77`），其 mcpBindingEvidence 也含原样 command（`resolver.ts:43-46`）。record enabled 的非 class 规则在 digest 不等时回 ask（`resolver.ts:139`），不是连接状态字段自行重置。

一次性真实纯函数/磁盘证明：`bun /tmp/connector-r5-npm-proof/reanchor-policy.ts` exit 0（`/tmp/connector-r5-reanchor-policy.log`）。在临时目录建立自己的受保护 Node 声明，分别以 old-pin/new-pin 描述调用同一 expander 和 authorityForMcp，两者都严格核验为 codepuppy-bundled；用生产 save/load 保存/重读 tool enabled 记录，再喂生产 resolveToolPolicy，得到 before=enabled/allow，after=ask/binding-changed；authorityDigestChanged=true、bindingDigestChanged=true。cache root/服务代码/其它 argv 均未变。最初探针误用 load.document（实际字段 doc）已修正，没有修改产品代码。

SEAM-CHANGE-NEEDED：首方 Node boot re-anchor / 持久 tool-service binding —— 上述真实状态后果不能靠放宽当前 Node 的精确匹配或改其它冻结权限规格绕过。最小需要编排器在 §10 冻结「经完整首方核验的宿主 Node 槽在策略 binding 中如何稳定表示」以及与现有策略摘要的关系；推荐只稳定这个宿主位置，保留代码/声明、业务 argv/cwd 与第三方绑定语义。未验证前提是 §10 是否同时要求 tool/service enabled 跨 Node pin 保留，而不只是 MCP 连接上线；若只要求连接，本后果应由编排器明确记为现有重绑语义。没有 owner 新决定、没有记录迁移、没有改策略或引入确认步骤。本接缝阻止本轮把 Node boot 重锚报告为完成；#1759 production assembly 等待仍独立存在。

### r5 uv 只读地面证据（不是新实现）

`gate slot -- python3 /tmp/connector-r5-uv-proof/settings.py` exit 0；固定 uv 0.13.10 在 HOME/UV/TMP/XDG 全部隔离的临时目录，以 `--no-config --offline --show-settings tool run --from codepuppy-probe-nonexistent-package==0 --with packaging==24.0 probe-command --business <temp workspace>` 返回 4824 bytes stdout、0 stderr，未执行服务或解析不存在包。原样输出 `/tmp/connector-r5-uv-proof/case-z2opj_os/stdout` 有 ToolRunSettings 的 command/from/with/constraints 与有效 resolver 设置；同时含 refresh/SystemTime，因此不能把整份调试输出当 key。没有读取用户 .env/config，没有把这个调试格式或半套语法解析器加入产品；完整 uv 适配、配置内容指纹与安装/bin 捕获仍未完成。

移除臂首次发现许可用例的断言在内部 Effect 中先失败，主纤维还等 preparing 屏障，只得到 timeout；这不是合格反例。用例改为把「当时能否立即取得许可」经 Deferred 交父纤维断言，不改产品许可/预算，也不加墙钟断言。重做此一臂，最终结果见下文收据；其余臂无需重跑。

### r5 #1759 合入后的装配落点（尚未实施）

- `main/server.ts`：消费 #1759 同一次完成绑定的 R1 结果，传其 env 给 createLauncherAssetAuthority.packageManagerEnv；不在 server 重新算候选目录或把候选当已绑定。环境描述与同代 authority 共用，保留资源形态/平台/固定 pin 与 Manifest.formats 稳定 ID。
- `main/codepuppy-bootstrap-build.ts` + `util/codepuppy-bootstrap.ts`：一次性增加 mandatory、严格校验的 bootstrap.launchers，再更新真实 builder/测试 bootstrap producer；取消当前 Reflect 过渡读法。视频仍由 codepuppyVideoDefinition/同一 expander 在宿主投影，Node boot 的策略后果先按上节裁定，不新增另一份配置写者。
- `main/server.ts` 的 child message/lifetime：createPinnedFileMainBridge 原始文件口绑定 authority.ensureFile(pinnedFileAuthority(userData), …)，entryFor 绑定同一 authority.ensureEntry；changed 只投 createConnectorLaunchState，诊断按当前 generation/identity 回 core 查询并校验派生 transcript 路径。停用/换代/退出关闭 requester/bridge，晚到包不回写新代。
- `main/sidecar.ts`：保持 installProcessFence 最先；accept bootstrap 后安装 #1759 的 installPackageManagerEnvironment 及 createPackageManagerEnvironmentRequester，再在 prepareSidecarEnv/import 引擎之前 publishConnectorLaunchHost；最终真实 spawner 仍只由 #1759 refresh/project 最终投影缓存键。端口函数不进 structured clone 文档。
- `core/mcp/index.ts` 的现有 entry/Slot：按当前已安装声明、严格 declaredFirstPartyTools 和受信 descriptor 构造本轮 localLaunch；runtimeDependencies 取 main 的当前安装版本事实，不列另一份 git/密钥名单；只有两类运行器绑定完整 prepareConnectorLaunch，原生首方仅等待同一 resolveAssets。还须把按 directory/server 定位当前 entry 的私有诊断/重试查询接到 sidecar controller；本轮新增的是 connection.diagnostic，尚没有该 controller 注册/查询组装。
- 文档：DocumentHost.environment 仍等同一 resolveAssets，LibreOffice 仍走同一文件 authority；当前 attempt 的实际 DocumentRuntime 绑定 createConnectorLaunchState.bindDocumentRuntime 后，现有 retry action 才能触达真实 runtime.retry()。本轮没有动 Office 构建或另开下载器。

上述装配只列消费关系；R1/R2 的完整 names/signatures 沿本计划前表，分支复核提交仍是 ef8a1ce8b4441aeeb12cc3a5cc0843ad43c1682f。它们合入不自动补完 uv/npm 的规范化 key、真实安装、bin 捕获、自动恢复与完整 prepareConnectorLaunch。

### r5 最终收据

依据：SPEC v1、冻结 DESIGN v2.2、r5 IMPLEMENT；已核：Codex / GPT-6。结论 PARTIAL。已定勿重开：r4 uv 的无 CLT install-name 裁定、唯一 pinned authority、#1759 R1/R2 所有权、严格当前 Node/cache-root 匹配。本轮没有修改其它规格/权限规则、process-fence、gate 或其它仓；没有应用/窗口/正式包实测、计时/容量运行、push/PR/merge。

- AC-02/06/07/08/10 子链：许可前准备、字节进度、依赖/cwd 检查、取消晚到不 spawn/不报失败、prepared 当前 argv/cwd/环境直接执行、首方 Node 同代路径再核对、连接后崩溃的完整遮密 stderr/真实 exit 和当前 identity 诊断查询，均有本轮真 Location/SDK/stdio 的命名用例；不是完整 AC-02 围栏、AC-06 限速或 AC-10 离线应用重启证据。R3 的呈现/助手/runtime.retry 单模块证据继承，production root 未装。
- AC-04 语法子链：官方 npm 语法/配置只读阶段的两例与真实 pinned Node/npm 六组探针通过；不称已装好第三方本机模块。uv 语法、非秘密内容 key、npm/uv 实际安装与默认/显式 bin、持久入口组合/自动重试仍未完成，且这些仍是 #1760 独立余项。
- v2：connection 自己构造 binding 的真实 stdio 请求/调用进度子链通过；main 下载/配方 authority 的已接受 r2/r4 证明继承，不把自有 Host fixture 当真实下载/整应用证明。
- Node boot：上节真实策略后果及 SEAM-CHANGE-NEEDED 交编排器/设计 §10；没有在本轮放宽 identity 或改写持久策略。正式 AC-01/02/03/04/05/09/10、AC-06/07/08 应用整链仍未验收。

最终相关命令（均在 packages/core；以下共 75 PASS / 377 assertions，未运行被过滤的 timing/engine/scale 例）：
1. `bun test test/codepuppy-connector-launch.test.ts test/codepuppy-mcp-tool-collision.test.ts test/codepuppy-mcp-tool-generation.test.ts test/mcp-attach.test.ts test/mcp-instructions.test.ts --max-concurrency=2` → 52 PASS / 223 assertions（`/tmp/connector-r5-core-related.log`）。
2. `bun test test/codepuppy-mcp-runtime.test.ts -t 'a missing working directory, a missing command|the failed status the desktop reads|the command main writes|Office declarations bind|bundled slots bind|bundled declarations reject|launcher download classification|managed pinned|refuted managed|production MCP connection registers pinned|ordinary MCP client|video progress follows each real SDK request|a local server that writes a secret to stderr and exits' --max-concurrency=2` → 15 PASS / 112 assertions，20 filtered（`/tmp/connector-r5-runtime-related.log`）。
3. `bun test test/mcp.test.ts -t 'MCP tool names match V1 sanitization|passes session IDs as MCP request metadata|spawns local MCP servers through the location environment|reports a local MCP server as failed when the location has no execution plane|exposes every connection operation|keys connections on everything that changes them' --max-concurrency=2` → 7 PASS / 39 assertions（`/tmp/connector-r5-mcp-related.log`）。
4. `bun test test/mcp-oauth.test.ts -t 'reports needs_auth for an unauthorized server without registering a client' --max-concurrency=2` → 1 PASS / 3 assertions（`/tmp/connector-r5-oauth-related.log`）。
5. `bun typecheck` → exit 0，2064 files / 2 projects（`/tmp/connector-r5-core-typecheck.log`）；包无独立 lint 命令，git diff --check 通过。

七个最终移除臂：环境隔离、连接后诊断、Node descriptor 一致性、真实缺程序事实、npm Boolean realm、managed binding、许可位置；各选择对应命名例都 exit 1 且因断言失败（许可臂最终在父纤维断言立即失败，不计初次 timeout 臂）。日志 `/tmp/connector-r5-removal-{environment,diagnosis,node_descriptor,native_fact,npm_boolean,managed_binding,permit}.log`；逐项 scoped git restore 后，上述 wider-related 恢复绿。npx/CLI/cmd-list/LICENSE 夹具分别为 2921/54/3039/9742 bytes；Python read_bytes 逐字对比归档原文件并计算 sha256，四项均 upstream-identical。

`affected-tests --list` exit 0：**affected tests: 380 of 742 test files**（`/tmp/connector-r5-affected-final.scope` / `.list`），无全量 fallback；新输入以直接 import/字面 fixture URL 可追溯，无 global gate 输入或全局必跑层扩展。官方 docs check_repo 函数在解析到 alpha-work/governance/delivery-profile.yml 后检查本 worktree：本 plan 0 findings；仓级 56 errors / 251 warnings（`/tmp/connector-r5-docs.json`），其中 docs/README.md 的既有 index.stale 未顺修，不声称仓级文档检查全绿。

遗留去向：Node 重锚的策略绑定语义 → 编排器/设计 §10；完整官方 uv/key/安装/bin/prepare → #1760 续接；#1759 → 合入后按本表装配；Office compileall → documents（已路由，本轮未碰）；docs/README.md index.stale 等 → 文档治理。OPTIONAL：无。无迁移。

本轮时间核对：2026-11-26T19:02:34Z；自 18:08:43Z 起约 53 分钟（原预期约 90 分钟）。本轮只报告已完成子链；未完成项与冻结接缝已逐项列明。

## r6｜槽位策略绑定裁定与准备链续接

- 依据：r6 IMPLEMENT；r5 的六个提交已接受，继承其证据。编排器 Claude Opus 5.5（2026-11-27）已裁定 Node/cache-root 的 host-only 槽保留声明 token 参与 binding digest；不再因应用位置重锚添加询问步骤，仍按当前 descriptor 和完整显式配置严格核验。
- 核对：Phase IMPLEMENT，Codex / GPT-6；原 r5 策略接缝已获裁定，不能继续当作阻塞。起始 2026-11-26T19:04:46Z，预计约 90 分钟。
- 第一项文件：core/mcp/codepuppy-first-party-mcp 的单一声明匹配 owner 输出经核验的绑定命令；保留现有 declaredFirstPartyTools 的冻结形状。ext/policy/identity 消费这些事实形成槽位声明的策略 digest；普通 MCP 的 resolver/store 契约不改。回归放既有 identity.test.ts，以生产 toolFacts + save/load + resolve 在真临时磁盘验证 Node/cache 位置变动后 saved enabled 保留，以及声明 arg/env/cwd 变动和非首方配置仍重绑。按 red-first 单独提交红例，再实现。
- 后续文件：core/codepuppy-npm-launch、codepuppy-connector-launch 及必要的自有 uv 语法/内容指纹 helper；仍使用随包官方解释器、Location files/spawner 和现有准备收据。按官方语法、非秘密内容 key、真实安装/bin 捕获、prepareConnectorLaunch 组合的顺序推进；已有 controller/Host/root 装配仍等 #1759。
- 证明：迭代仅命名例；每步本行为文件一次；返回前相关 mock/枚举消费者一次、适用包类型检查、移除臂和 affected-tests --list。大实物仅 gate slot 一次性证据，不运行应用、全门或计时/容量用例。#1759 当前接口提交仍 ef8a1ce8b4441aeeb12cc3a5cc0843ad43c1682f；不复制其 R1/R2。

r6 槽位绑定：红例提交 3ce60e164e（0 PASS / 2 FAIL，`/tmp/connector-r6-binding-red.log`），实现不改红例。core 的 declaredFirstPartyBinding 继续作为同一个严格匹配 owner；旧 declaredFirstPartyTools 委托并仅返回原冻结 DTO。只有声明实际含 host-only 槽时，返回将该两种 token 保留、其它实参不变的 binding facts；ext 的 toolFacts 在核验通过后用命令/声明环境/cwd 算独立 binding digest，authority.evidenceDigest 仍保留原核验事实。第三方与非此槽的现有摘要算法不改，没有记录迁移。

命名红例转绿 2 PASS / 23 assertions，整文件 `packages/ext: bun test src/policy/identity.test.ts --max-concurrency=2` 为 21 PASS / 79 assertions（`/tmp/connector-r6-identity-step.log`）；`bun typecheck` exit 0。真磁盘覆盖 tool/service enabled 的 Node、cache 位置变化，以及声明 arg/env/cwd 与未声明环境/cwd/假 Node 的反向臂。没有使用路径相等启发式还原槽，没有绕过当前 Node 的精确身份核验。


### r6 官方解析、非秘密 key 与 npm 真实入口捕获

新增 `core/mcp/codepuppy-uv-launch.ts` 在 Location spawner 用随包 uv 的 `--show-settings` 读取真实 ToolRunSettings，不解析包或执行服务；uvx 转为 tool run，uv 原选项位置保留。平衡解析器保留全部字段，解码 command/from/with/editable/env-file 的 Rust 字符串，原 requirement-file 枚举及 resolver 嵌套内容暂保留原字段，不声称已完成安装参数适配。`core/test/fixture/uv-tool-settings.ts` 由真实 pinned uv 0.13.10 输出截取，含引号、反斜线、Unicode/控制字符；凭据均为自有虚构输入。一次性 `gate slot -- python3 /tmp/connector-r6-uv-probe.py` exit 0（`/tmp/connector-r6-uv-probe.log`），无服务执行。3 个命名例 3 PASS / 18 assertions。

新增 `core/mcp/codepuppy-connector-key.ts` 是规范化 facts 的纯 key owner，显式投影平台/pins、需求与仅影响解析的 options/configuration，URL 认证与签名复用诊断的 query-name owner；本地源必须由调用者给内容 facts，不用路径作盐。去重排序，排除业务 argv/cwd/位置/身份/认证引用及缓存控制。4 例含真实 npm 官方配置读取、换项目与轮换自有凭据，4 PASS / 11 assertions（`/tmp/connector-r6-key-tests.log`）。**尚未完成官方 uv/npx 全部输出到这些 facts 的适配**，不能将整个原始配置或 Debug 文本传入 key。

既有 connector-launch 模块导出同一 ConnectorPreparation schema，新增 captureNpmConnectorPreparation / preparedNpmEntry：随包 Node 内使用 npm 自己的 PackageJson.normalize、get-bin-from-manifest 与实际 .bin 链接；捕获实际版本、package/显式 bin 默认入口、锁/manifest/目录，拒绝逃出 prefix 的链接。无第二份 bin 选择规则。真实 npm 11.20.0 离线 pack/install 自带 semver 7.8.5 后，产品 capture→publish→read→随包 Node 入口运行输出 1.2.3（`gate slot -- bun /tmp/connector-r5-npm-proof/capture-r6.ts`，`/tmp/connector-r6-capture-proof.log`）；cacheHit=true。该 probe 的安装命令仍是一次性脚本，**产品 installer 尚未接入**。

新增 npm-launch fixture 是该次实际 prefix metadata 与 pinned npm/libnpmexec 的原始源码/manifest/LICENSE；多 bin 例将真实 npm manifest 的 bin 顺序反向，证明官方选择而非首项猜测。3 例 3 PASS / 10 assertions（`/tmp/connector-r6-capture-tests.log`）。新例均放现有测试文件，静态 import/字面 fixture URL 可追溯，属于受影响 PR 的模块/组件层；不新增 nightly/scenario 或全局必跑输入。准备模块整文件 37 PASS / 194 assertions（`bun test test/codepuppy-connector-launch.test.ts --max-concurrency=2`，`/tmp/connector-r6-preparation-step.log`）；core `bun typecheck` exit 0，2068 files / 2 projects。

文件偏离：新增两个 core helper 各持有语法边界与内容 key；diagnostic 仅共享现有秘密 query 名规则，避免第二份秘密规则；fixture 全是官方真实输出/源码。尚未完成：uv 持久安装/bin 捕获、uv/npm 全语法归一到 key、产品 installer、完整 prepareConnectorLaunch 组合；不能以本阶段当作 AC-04/10 已完成。#1759 接口表仍适用，其同一 env 的最终投影继续由 R2 拥有。


### r6 uv 持久入口捕获（实物验证，不增加机器依赖常驻测试）

同一 connector-launch 模块增加 captureUvConnectorPreparation：在 Location spawner 用已钉 Python 的 `-I -S` 运行 stdlib tomllib/importlib.metadata，只读真实 uv-receipt.toml、pyvenv.cfg、site-packages 的分发元数据与实际 install-path；不导入连接器包，不运行 .pth。主包和 --with 的实际版本进入同一准备 schema；所有 receipt/metadata/入口需落在当前 prefix，uv 自己的 Scripts/bin 结果直接采用，不猜 console script 文件名。Python/uv 所需资源仍由现有 authority 和安装子链提供，不复制 R1/R2。

一次性命令 `gate slot -- bun /tmp/connector-r5-npm-proof/uv-capture-r6.ts` exit 0（`/tmp/connector-r6-uv-capture-proof.log`）：真实 pinned uv0.13.10 + 已接受的 pinned Python3.12.16，离线安装 Python 自带的官方 pip26.3 wheel 到 prepared/key；产品 capture→publish→read，得到 pip/pip3/pip3.12 的真实入口及 pip=26.3，cacheHit=true；直接入口 `--version` 输出 pip26.3 / Python3.12。site-packages 注入自有 .pth 写标记的移除臂，capture 未执行标记；只替换真实 receipt 的一个 install-path 到 prefix 外的自有文件时，产品 capture 失败 escaped its prefix。探针及输出作为实物/机器一次性证据，不把本机 Python 路径和 wheel 加入常驻 PR 测试。原始样本命令 `/tmp/connector-r6-uv-install-probe.py` 另记录了未经修改的 uv receipt 格式。产品完整 installer/语法转换/prepare 仍未实现，本节没有缩小合法声明支持范围的产品分支。


### r6 uv run→install 适配与产品安装子链

readUvLaunchDeclaration 的真实 command 尾部用于分开业务 argv；uvToolInstallArguments 保留其余原解析选项/根 --directory 位置，把 uvx 或 uv tool run 转为 tool install，--from 的真实包源成为位置参数。四种 tool-run 专有项由 pinned `tool run --help` / `tool install --help` 实际对比确认：from、isolated、env-file、no-env-file；前者转换为源，隔离由每 key 的持久 tool 根承担，env-file 信息仍保留在 declaration 留待每次执行绑定，不交安装。其余选项直接保留，不重写 npm 式开关名单、不执行服务参数。新增产品 installUvConnector 在 Location spawner、extendEnv=false 执行该计划，保留真实 exit/stdout/stderr；准备错误经同一 uvLaunchFailure 契约。

模块命名例 `uv install conversion preserves resolver syntax and separates current service arguments` 1 PASS / 5 assertions。真实 pinned CLI 三组 read→转换→ToolInstallSettings（隐式 pip@26.3、显式 from+env-file/isolated、根 --directory+extras+constraint/config-setting）均 exit 0：`gate slot -- bun /tmp/connector-r5-npm-proof/uv-convert-r6.ts`，`/tmp/connector-r6-uv-convert-proof.log`。真实产品 read→install→capture→publish→read→入口运行通过：`gate slot -- bun /tmp/connector-r5-npm-proof/uv-install-r6.ts`，`/tmp/connector-r6-uv-install-product.log`，pip26.3，三个入口、cache hit、外部路径拒绝均如前。它在前一实物基础上改用新产品 installer，属于新安装代码的验证，不是同一代码的计时/容量重复。

仍未组合完整 prepareConnectorLaunch：uv/npm 的需求/本地源/constraints 等生效内容到非秘密 facts 的适配、npm 产品 install、默认/显式入口及 shell/console 绑定、uv env-file 每次执行语义、查收据命中后的当前输入绑定/自动恢复仍需继续；#1759 不构成这些独立余项的阻塞。此前“产品 installer 未实现”在本节之后仅指 npm 和总组合，uv 安装子链已实现但尚未接到 connection 的 packagePreparation。顺序偏离是先完成可单独验证的语法/入口/安装子链，未声称整个 AC 已完成。#1759 HEAD 再核仍 ef8a1ce8b4441aeeb12cc3a5cc0843ad43c1682f，接口表不变。仅对本轮新改代码应用仓库已有 prettier，无规则/依赖/公共 Protocol 变更。


r6 key 字段补核：从真实 pinned npm 的 definitions/Arborist 确认 min-release-age/exclude、package-lock、lockfile-version 会参与解析/安装，补入规范化 key facts。红例 3a36d205d8：`bun test test/codepuppy-connector-launch.test.ts -t 'connector content keys track resolution contents' --max-concurrency=2` 为 0 PASS / 1 FAIL；补实现后同例 1 PASS / 10 assertions（`/tmp/connector-r6-key-options-{red,green}.log`）。未降低旧断言。注意 npm 的 flat.before 在 min-release-age 生效时是 Date.now 派生值（随包 @npmcli/config definitions.js:1472–1505）；后续适配必须保存原相对 age/优先级语义，不能把派生 wall-clock cutoff 当内容盐或直接 hash raw flat。该适配仍在未完成项中，没有绕过官方 config 权威。

一次适用类型检查发现新 parser 的 `[0] ?? null` 在本仓编译设置下被错误推断为 string，而实际 None 返回 null；改为 `.at(0) ?? null` 后 core `bun typecheck` exit 0，2068 files / 2 projects。现有隐式 source 转换例保留，uv 四例再次 4 PASS / 23 assertions。此为本轮引入问题的直接修正。


r6 秘密 URL 补核：同一个 isConnectorSecretQueryParameter owner 补密码/凭据/用户名及 ref/version 名称；诊断按标准 URLSearchParams 解码参数名后调用它，保留原编码名和非秘密字段，只替换秘密值，避免 key 与崩溃转交有两套 URL 规则。扩大现有真实 stderr/内容 key 用例的自有输入（%70assword、credentialRef、authVersion），红例 e13ec1f13c 为 0 PASS / 2 FAIL；实现后相同命令 `bun test test/codepuppy-connector-launch.test.ts -t 'connector content keys exclude invocation|connector diagnostics tee complete masked stderr' --max-concurrency=2` 为 2 PASS / 17 assertions（`/tmp/connector-r6-secret-query-{red,green}.log`）。业务参数普通字段/崩溃原文仍保留，没有放宽错误或移除旧断言；此为 AC-08 遮密与非秘密 key 同链修正。


### r6 npm 相对发布时间语义（内容键的官方配置读侧）

readNpmLaunchDeclaration 新增 transient resolutionOptions：向 Config 传入的 flatten 仍调用官方 flatten，仅以 Proxy 观察它对 before 的**实际获胜写入**，记录固定日期 / 相对 days / 无限制，不自行重算配置来源顺序；原 options 仍是完整真实临时配置，安装语义不改。两个 record 仍含认证，必须经 key owner 非秘密投影，不能直接持久化/hash。现有换项目/轮换密钥的 key 例改消费 resolutionOptions。

红例 8bd85cc37b 为 0 PASS / 2 FAIL（`/tmp/connector-r6-npm-relative-red.log`）；保留其全部断言后 2 PASS / 9 assertions（`/tmp/connector-r6-npm-relative-green.log`）。新增例覆盖相对 age 稳定、exclude 生效、固定日期覆盖、CLI relative 覆盖低层 before、0 清除；没有时钟 mock、sleep 或计时断言。第一轮 green 暴露**夹具输入版本差异**：共享 Config10.8.1 无 exclude 且拒绝 before/min-release-age 并存，而产品随包10.13.0允许优先级组合。没有放宽断言、为生产添加旧版兼容或升级依赖；只在此用例解包完整钉住 Config 的原始 lib/package.json/LICENSE，复用原有已安装依赖。

新增字面读取 `test/fixture/npm-launch/npm-config-source.json.gz` 是15个 upstream 原文件的 gzip JSON 容器，40423 bytes，sha256 `76a49a961d79df277407bf54b560d22d4eb0231091a012ab651e9318c281e743`。逐文件 byte 比对 upstream 原件全相同，LICENSE 在容器内；不把原库4566行复制为可执行生产代码，不更改仓库依赖/门控。实际随包 Node26.13.1 / npm11.20.0 / Config10.13.0 一次性 `gate slot -- bun /tmp/connector-r5-npm-proof/npm-relative-r6.ts` exit 0（`/tmp/connector-r6-npm-relative-proof.log`），同样全部语义与稳定 key 通过。它补齐上文所列 relative-age **读侧**缺口；requirements/本地源内容到 facts、npm install 与总 prepare 的余项仍在。


### r6 最终收据与准确续接边界

依据：SPEC v1、冻结 DESIGN v2.2 与 r6 槽位摘要裁定；已核：Codex / GPT-6，结论 **PARTIAL**。裁定实现完成，没有未决设计问题：只把已严格匹配的 host-only Node/cache token 保留到绑定事实，声明 arg/env/cwd 与非首方变化仍重绑。没有修改 store/公共 HTTP/Protocol、process-fence、其它规格或其它仓，没有迁移、应用/窗口、push/PR/merge。主表与实物下载的 r1/r2/r4 已接受证据继承，本轮不重复下载。

- **r6 裁定 / AC-10 子链**：真磁盘 identity 两条红例保留 enabled 与变更重问，2 PASS / 23 assertions；完整 identity 21 PASS，相关策略组138 PASS。Node/cache 重锚不把 host 路径写进摘要；这不是打包应用离线重启验收。
- **AC-04/05/10 准备子链**：官方 uv/npx 语法、非秘密 key primitive、真实 npm 默认/显式 bin、uv metadata/entry、Python stdlib 不加载 site，及 uv 产品 install 已具名证明；真实随包 uv/Python 安装 pip26.3、随包 Node/npm 安装 semver7.8.5 后产品 capture→publish→read 均 cache hit，直接入口分别输出 pip26.3/Python3.12 与 1.2.3。只有 uv 的安装已成为产品 helper；npm install 仍仅一次性 probe，不能当完整 prepare/第三方 MCP 已连上。
- **AC-08 同链**：URL 编码密码与凭据引用/版本在 key、stderr、日志、持久诊断一致排除/遮密，两个红例0/2转2/0；完整 stderr、command/exit 转交的 r4/r5 证据继承。AC-06/07/08 的 production controller/renderer 两入口组装仍未装到 root。
- **AC-01/02/03/04/05/06/07/08/09/10 正式验收**：没有新增打包/干净账户/真围栏/北京/限速/Windows/离线应用重启结论；依赖真实启动装配的部分仍待 #1759 后验收。

最终相关验证（未运行全层/全套或 timing/scale；只列唯一计数，不重复累计末次遮密单例）：
1. core：`bun test test/codepuppy-connector-launch.test.ts --max-concurrency=2` → **39 PASS / 214 assertions**（`/tmp/connector-r6-core-final.log`）。新增12个 core 模块/组件例、2个 ext 真盘策略例；全在既有文件，没有全局 setup/gate 输入扩展。
2. core：`bun test test/codepuppy-mcp-runtime.test.ts -t 'Office declarations bind|bundled slots bind|bundled declarations reject|the failed status the desktop reads|a local server that writes a secret to stderr and exits' --max-concurrency=2` → **5 PASS / 62 assertions，30 filtered**（`/tmp/connector-r6-core-runtime-related.log`）。URL 遮密变动后只重跑其中真实 crash 单例 →1 PASS /4 assertions（`/tmp/connector-r6-runtime-secret-final.log`）。新 npm/uv/key exports 的 grep 消费者只有准备模块测试；没有遗漏另外的 mock。
3. ext：`bun test src/policy/identity.test.ts src/policy/resolver.test.ts src/policy/register-policy.test.ts src/policy/tool-policy-rpc.test.ts src/policy/unattended.test.ts --max-concurrency=2` → **138 PASS /484 assertions**（`/tmp/connector-r6-ext-related.log`）。
4. ui-mac：`bun test src/main/connector-launchers.test.ts --max-concurrency=2` → **22 PASS /104 assertions**（`/tmp/connector-r6-main-related.log`）。以上合计204 PASS /864 assertions。
5. core 与 ext 各 `bun typecheck` → exit0（core2068 files/2 projects；`/tmp/connector-r6-core-typecheck-final.log`、`/tmp/connector-r6-ext-typecheck-final.log`）。没有独立包 lint 命令，`git diff --check` 通过。

移除臂共11项：槽位摘要、声明环境、key凭据、key业务输入、uv Unicode、run→install转换、npm官方默认 bin、npm入口所属目录，分别由命名例 exit1（各0 PASS/1 FAIL），日志 `/tmp/connector-r6-removal-{slot_binding,declared_environment,key_credentials,key_invocation,uv_unicode,uv_install_conversion,npm_default_bin,npm_owned_bin}.log`；uv site隔离移除时实物命令因 .pth 标记断言 exit1，uv所属目录移除时实物负例意外得到带 outside-entry 的 ready，预期失败 Effect.flip 变为失败 exit1（`...removal-uv_{site_isolation,owned_entry}.log`）；npm relative语义移除时命名例0/1（`...removal-npm_relative_clock.log`）。所有 scoped restore 后恢复；既有 uv 环境的最终正/反例命令 `gate slot -- bun /tmp/connector-r5-npm-proof/uv-capture-existing-r6.ts` exit0（`/tmp/connector-r6-uv-existing-final.log`），没有重跑真实安装或计时场景。

`affected-tests --list` exit0：**affected tests: 380 of 742 test files**（`/tmp/connector-r6-affected-final.scope` / `.list`），无 fallback，和r5范围一致；新 gzip 夹具由字面 URL 读入，仅选择本模块。四项 npm/bin 原 fixture 与归档原件 byte-identical（641/1938/741/6597 bytes），Config gzip15原文件亦逐字相同且含 LICENSE。清除了 prettier 对旧测试代码的13处无关纯排版变动；`bun /tmp/connector-r6-format-proof.ts` 确认清理前后 Bun 输出 JavaScript byte-identical，没有删除/放松断言，不需要再跑行为用例。

**独立余项，仍归 #1760 实现**：
1. 官方解析输出→完整规范化需求与非秘密配置内容 facts：uv 的 Local/Remote/Stdin requirements/constraints/overrides/build-constraints、项目 source/解析选项；npm 隐式/显式包 spec、local/git 内容身份与来源配置。relative-age 读侧已补，不再列为未做。原配置/Debug/业务路径/凭据不能直接作为 key。
2. npm 产品 `install --prefix` 完整解析选项传递（不能复用共享 _npx）；默认/显式/npm --call 平台 shell、JS/native/cmd/ps1、uv console/legacy scripts 的最终命令绑定；uv env-file/根 --directory 等本次执行语义。
3. 完整 frozen prepareConnectorLaunch：resolveAssets/单一 Python pin→安装/查找、内容 key、有效 ready 快路径、miss安装/捕获/发布、当前 argv/cwd/业务密钥/环境重绑、错误/egress/取消及进度组合，接到 r5 的 localLaunch.packagePreparation。不能用空 stub 或把未适配的合法声明拒成不支持第三方。

**#1759 后机械接线，接口清单仍是前表**：最后只读复核 HEAD 为 ef8a1ce8b4441aeeb12cc3a5cc0843ad43c1682f；同一次 planPackageManagerCaches 的绑定 env/cacheEnv/rules/locations/excluded 进入 fence与 bootstrap；resolvePackageManagerLocations 只是候选；最终 spawn 由 R2 的 installPackageManagerEnvironment / packageManagerEnvironment / refreshPackageManagerEnvironment / projectPackageManagerEnvironment / createPackageManagerEnvironmentRequester 单一所有者投影。main bootstrap.launchers mandatory、launch assets/download Host、sidecar publishConnectorLaunchHost→index/Slot/localLaunch、Node boot re-anchor、当前 identity 的状态/诊断/重试 controller、createConnectorLaunchState 返回值的 bindDocumentRuntime→runtime.retry()、renderer root 与正式包验收依此前组装表完成。不复制候选 env 为绑定结果，不另造缓存目录、下载器或任意安装 main RPC。

遗留去向：上述独立余项→#1760续接；R1/R2/生产组装→#1759合入后本表接线；docs/README.md:1 index.stale 等既有仓级文档结果→文档治理（r5与本轮均56 errors/251 warnings，本 plan 0 findings）；Office compileall→documents已路由，本轮未工作。OPTIONAL：无。当前时间核对2026-11-26T20:12:36Z，自起始约68分钟，原预期约90分钟；范围没有扩到其它票或新依赖。


## r7｜完整准备函数与独立余项

- 依据：r7 IMPLEMENT；r6 b0f1272cbb..a2f56d8e64 已接受。SPEC v1 AC-02/04/05/06/07/08/10，DESIGN v2.2 §4.3–4.7、§8/§10；不重开既定决策。
- 核对：Phase IMPLEMENT，Codex / GPT-6；本轮目标为完成已列的独立余项，生产 bootstrap/Host/root/controller、文档 retry 与打包验收仍等 #1759。起始2026-11-26T20:17:28Z，预计90分钟；在每个子链后核对时间。

### 改动与顺序
1. `core/mcp/codepuppy-npm-launch.ts`：官方 npa/config 的完整需求和来源 facts、当前执行语义；Location 内官方 npm install --prefix 的产品路径。保留真实 npm 对包/别名/目录/git/URL、配置优先级和 bin 的所有权。
2. `core/mcp/codepuppy-uv-launch.ts`：解析真实 resolved Debug 的 requirements/configuration，继续复用现有 uv install/捕获；当前 cwd、环境文件、命令参数单独绑定。
3. 必要新增 `core/mcp/codepuppy-connector-content.ts`：仅承担规范化需求、文件/本地源内容身份、解析配置内容的同一责任；同一秘密字段/URL规则从现有 key owner 复用，不引入第二套配置/下载 authority。
4. `core/mcp/codepuppy-connector-launch.ts`：冻结 prepareConnectorLaunch 输入/返回，组合资产、Python、内容 key、持久准备、当前输入绑定及有效 ready 快路径；安装/服务只通过 Location 执行，进度/取消/真实错误接现有 attempt 链。需要的同调用链文件在实际提交列明，不改 #1759 fence。
5. 回归放既有 `core/test/codepuppy-connector-launch.test.ts`。新增输入使用真实 pinned CLI/manifest/receipt/config 的样本；确需机器/大实物的验证仅 gate slot 一次性记录，不加常驻重例。

### 风险与证明
- 完整语法适配不得变成目录包白名单或合法第三方拒绝分支；同内容换项目、业务参数/密钥轮换必须命中同一准备，包/解析内容变化必须失效。模块/组件层命名例与真实 pinned CLI 探针验证，删除对应归一/隔离/入口选择应失败。
- 正常 cache hit 不能访问 registry、重装 Python 或启动后台更新；测试对 resolver/installer/下载调用计数，同时真实 stdio 验证当前 argv/cwd/环境。安装失败不发布 ready，取消不晚到 spawn。AC-06/07/08 继续由同一 producer/错误分类呈现。
- 保留每步相关文件一次、返回前新增/改变 exports 的 mock 与枚举消费者一次、适用 typecheck、移除臂和 affected-tests --list；不跑 gate run/bin/check、全套、计时/容量、应用或窗口。
- #1759 的准确接口清单沿前表，最终再次核对 branch HEAD；不复制位置计算、候选绑定或最终环境投影。

### 偏离记录
暂无。文件/证明/实际未完成边界随实现提交更新。


### r7 已落：npm 完整需求读侧、内容源与产品 install

readNpmLaunchDeclaration 保留原返回字段并增加真实 npa 请求、package/command/call/shell 选择；隐式本地 bin 沿实际 .bin 链接归到包源，别名、git committish/semver/subdir、HTTP源均保留。normalizeNpmLaunchDeclaration 生成同一 ConnectorRequirement schema 的 facts 与只用于安装的原始 spec；包请求顺序作为 dependencies 内容记录保留（不能将重复同名请求排序后丢掉优先级），不包含服务 argv/cwd/身份。ConnectorRequirement schema 与 key 同处一个 owner。

新增 codepuppy-connector-content 的应用自有程序在 Location 的随包 Node 内复用 npm packlist/Arborist、libnpmpack、tar 和钉住 Python 的 tomllib；本地包依照真正 packlist 逐字读取内容，JSON/TOML 结构经同一秘密规则清理并将本地依赖引用替换为内容图，图引用允许环而不加路径盐。npm 目录源制作私有临时 tarball，递归本地依赖改绑到同次 tarball，后续 npm install 得到 prefix 内自足包，临时数据不成为 ready 内容。二进制按字节识别；非 JSON 源文件不强制当 JSON，包内部 files/exports 模式不误当系统绝对路径。

installNpmConnector 在同一 Location 的随包 Node 内加载官方原声明配置，重放已生效非默认配置，再执行真正 npm CLI install --prefix；执行专有 package/call/script-shell 不交 installer，角色三个默认值由 connectorNpmDefaults 一处持有，env 投影与 CLI 均消费它。npm Config.load 自身会改写当前子进程环境，新增组件例抓到了 CLI --cache 覆盖宿主缓存的问题：只按实际 descriptor 的绑定键恢复该进程进入时的值，并从这些键动态映射 Config 项，不复制 R1 的位置表或候选绑定。

组件层新增3例（既有准备测试文件、受影响 PR/nightly）：别名/git/URL需求；真实 semver 源跨项目/凭据更改 key 不变且代码变更失效；在官方 CLI dispatch 边界记录应用自有 trace，检验解析配置、prefix、角色默认、R1 当前缓存与不执行服务。源码夹具 npm-source-helpers.json.gz 包含真正 pinned libnpmpack 的 lib/package.json/LICENSE；其它库复用仓内已安装依赖，正式钉住版本另用实物 probe。没有模拟 npm 安装输出。

命令 packages/core `bun test test/codepuppy-connector-launch.test.ts -t 'npm requirements retain|npm local source fingerprints|npm product installer' --max-concurrency=2` →3 PASS /19 assertions（`/tmp/connector-r7-npm-new.log`）。整文件阶段42 PASS /233 assertions（`/tmp/connector-r7-npm-file.log`）。实物 `gate slot -- bun /tmp/connector-r5-npm-proof/npm-product-r7.ts` 成功由产品 normalize→install→capture 装入 semver7.8.5（`/tmp/connector-r7-npm-product.log`），不同于 r6 由 probe 自己安装。初次 Typecheck 的 Schema API/Effect 条件联合/ExitCode brand 问题均在本轮直接修正；最终收据给出后续类型检查结果。

### r7 源绑定实物发现（尚未宣称快路径完成）

真实 setuptools75.8.0 构建的 src-layout PEP660 editable 包，随包 uv0.13.10 / Python3.12.16 安装成功；来源文件整体从 source-a 改名为 source-b 后，产品内容 fingerprint 前后同为 dbeb9c65cc1d5020c605c63833232725fd07ec9779aa48065b8a5605d925b096，capture/publish/read 仍命中有效包入口收据，但实际 venv Python import 报 ModuleNotFoundError。原文件 __file__ 为 source-a，uv 生成的 editable 绑定保留了这个绝对路径。证据 `gate slot -- bun /tmp/connector-r5-npm-proof/editable-receipt-r7.ts`（`/tmp/connector-r7-editable-receipt.log`、`/tmp/connector-r7-editable-yo35envh/receipt-result.json`）。这是执行绑定必须覆盖的真实缺口，不能仅把当前 cwd/argv 改成 source-b 就当完成，也不能把项目路径塞回内容 key。绑定实现未完成前不声明完整 prepare 或 DONE-INDEPENDENT。

文件偏离：新增 content 程序是 Node/npm/UV 两运行器共享的本地源责任，diagnostic 仅导出既有 URL 名称规则供这个隔离程序消费，key 的规范化函数可自包含序列化，避免另写秘密规则；未加生产依赖/选项/权限表。后续 UV resolved 值解析与环境绑定在既有 uv-launch 同链继续。

### r7 已落：当前执行绑定与 uv resolved 值解析

bindConnectorLaunch 将有效准备的入口与本次 argv/cwd/环境重新结合：npm 默认/显式 bin、当前包目录 .bin、Node shebang/JS、native、Windows cmd/bat 与 ps1 分支；--call 使用随包 npm 的 promise-spawn 处理平台 shell，不把业务值写入 ready。npm 生命周期环境复用实际 libnpmexec/run-script 与 @npmcli/run-script 的 make-spawn-args/package-envs，在调度边界只捕获应用自有元数据，不运行服务。env 包含真实 INIT_CWD、npm_lifecycle_*、当前项目配置；最终仍由 connectorRunnerEnvironment 投影角色缓存/PATH。shell 输入仅经该次子进程私有环境传递，启动子进程前删除，不进入 argv 或持久回执。

uv 当前执行环境由随包 uv run --offline --no-config --no-project 的应用自有 Node 元数据探针读取，uv 自己处理 --directory 和 env-file 展开，不加手写 dotenv 解析。parseUvResolvedValue 解析真实钉住 Debug 的 nested tuple/map/record/Rust string，只是后续内容适配的值层；尚未把所有 requirements/source/解析配置变成 key facts。未提交一个不完整的配置投影占位函数，也未增加 prepareConnectorLaunch stub。

新增3例在既有模块文件：真实 uv 样本的 nested config/escape；真实 npm 元数据→准备入口→SDK stdio 的本次 argv/cwd/业务环境；--call 保留 shell 语义且两次业务值不进 ready。组件/集成层均受影响 PR/nightly，依赖由静态 import 和既有字面 fixture URL 可追溯。源码 gzip 补入 pinned libnpmexec 的 run-script/no-tty/is-windows 原文件；其余依赖复用仓内已装版本，正式 pinned 实物另核。

`bun test test/codepuppy-connector-launch.test.ts -t 'uv resolved settings retain|bound package entries use|npm call binding keeps' --max-concurrency=2` →3 PASS /16 assertions；本行为整文件 `bun test test/codepuppy-connector-launch.test.ts --max-concurrency=2` →45 PASS /249 assertions（`/tmp/connector-r7-binding-new.log`、`/tmp/connector-r7-binding-file.log`）。核心 `bun typecheck` 已通过2069 files/2 projects；最终检查与移除臂在本轮收据补记。

**当前未完成边界**：完整 uv PEP508/requirements（Local/Remote/Stdin 与递归包含）、resolved config→content facts、editable 源路径重绑仍未完成；完整 prepareConnectorLaunch 的 Python 定位/准备事务/ready 快路径/失败取消进度组合仍未定义。npm 读侧与产品 installer、执行绑定 primitives 已完成，不将它们等同完整第三方启动或离线应用重启。生产 #1759 接线仍按前表。

### r7 最终收据与准确续接

依据：SPEC v1 / DESIGN v2.2、r7 IMPLEMENT；已核：Codex / GPT-6，结论 **PARTIAL**，不能返回 DONE-INDEPENDENT。计划37da012a1d，npm/content/install 实现fc7b90f81c，当前执行绑定c83146a951。已定勿重开：唯一 pinned authority、r4 无 CLT PATH 裁定、r6 声明槽位摘要裁定、R1/R2 的缓存位置和最终投影所有权。本轮无新设计分叉；没有修改 fence、gate、其它规格/仓或生产数据，没有 push/PR/merge、应用/窗口、全套/计时/容量运行。

**本轮分项 / AC 子链证据**：
- AC-04/05 准备子链：npm 别名/git/远端、本地 packlist/配置内容 key 与产品 installer；实际随包 npm 装 semver7.8.5，capture 后 bind 直接入口输出1.2.3。真实 Node/npm 命令 `gate slot -- bun /tmp/connector-r5-npm-proof/npm-bind-r7.ts` 安装与捕获 exit0，但探针自身把 INIT_CWD 的 /private/tmp 与 /tmp 当作不同目录而失败；修正为真实路径后仅复用原安装并重跑绑定，`gate slot -- bun /tmp/connector-r5-npm-proof/npm-bind-existing-r7.ts` exit0（`/tmp/connector-r7-npm-bind-existing.log`），没有重装第二遍。这不是本机模块/干净机器整链验收。
- AC-04/10 执行子链：`gate slot -- bun /tmp/connector-r5-npm-proof/uv-bind-r7.ts` exit0，真实随包 uv0.13.10/Python3.12.16，产品 read→环境读取→capture→bind 保留当前目录、env-file 插值及继承环境优先级，原包入口输出 pip26.3（`/tmp/connector-r7-uv-bind-real.log`）。npm/uv 测试均未通过原包 runner 启动服务；没有将 helper 读回执当作完整 prepare 快路径。
- AC-06/07/08：继承已接受 producer/单一呈现/诊断的模块证据；本轮只相关调用方回归5例，未新增生产 root 闭环或真引擎整链结论。
- AC-01/02/03/04/05/06/07/08/09/10 的正式包/干净账户/真围栏/国内节点/限速/Windows/断网应用重启验收仍未做；既有 pinned 实物证据继承 r1/r2/r4，不重新下载。

**唯一计数的相关检查**：core `bun test test/codepuppy-connector-launch.test.ts --max-concurrency=2` →45 PASS /249 assertions；在现有文件新增6例，覆盖模块/组件/stdio集成层（`/tmp/connector-r7-binding-file.log`）。返回前 grep 新 exports 及 mock/枚举消费者：npm/uv/content/key 的直接消费者只有此文件；diagnostic/runner 同链的 `bun test test/codepuppy-mcp-runtime.test.ts -t 'Office declarations bind|bundled slots bind|bundled declarations reject|the failed status the desktop reads|a local server that writes a secret to stderr and exits' --max-concurrency=2` →5 PASS /62 assertions，30 filtered（`/tmp/connector-r7-runtime-related.log`）。没有重复 r6 未改的 ext/main/UI 集合。

core `bun typecheck` →exit0、2069 files/2 projects（`/tmp/connector-r7-core-typecheck-final.log`）；无独立包 lint 命令，git diff --check exit0。7个移除臂分别去掉源秘密清理、源内容字节身份、install prefix、当前执行环境、当前服务参数、shell命令、uv nested值：命名例全部 exit1 /0 PASS /1 FAIL（`/tmp/connector-r7-removals-summary.log`、`/tmp/connector-r7-removal-*.log`），每次 scoped git restore；恢复后仅新增6例再核 →6 PASS /35 assertions（`/tmp/connector-r7-restored-final.log`）。没有削弱断言。

源码归档7个文件与真实 pinned Node/npm 原件逐字一致，共6727 bytes，包含 libnpmpack 与 libnpmexec 两份 LICENSE；最后只补 LICENSE 不改程序，恢复后的6例包含读归档的全部新行为。`affected-tests --list` →exit0：**affected tests: 380 of 742 test files**（`/tmp/connector-r7-affected-final.scope` / `.list`），无 fallback；未改 selector/global setup/runner，没有扩大每个 PR 的全局必跑层。官方 docs check_repo：本 plan 0 findings，仓级56 errors/251 warnings（`/tmp/connector-r7-docs.json`）；相对链接检查exit0。已有 docs/README.md:1 index.stale 等不顺修。hooksPath=.githooks。

**独立余项（仍由 #1760 实现，不能归为等待 #1759）**：
1. UV 完整 PEP508/隐式包/extras/with/editable 需求规范化；Local/Remote/Stdin requirements/constraints/overrides/build-constraints 的内容读取、递归包含与原始解析语义；真正生效的 resolver/project source/config→非秘密内容 facts。parseUvResolvedValue 只是 wire 值层，不是完成此项。
2. 当前执行绑定还须覆盖同内容本地 editable 源搬家/并行 Location 的源绑定；上述实物源搬家案例仍是有待修正的正缺口。uv 隐式 extras 的实际命令名映射也须跟归一需求一起完成；不得把声明路径写入 key 或以拒绝合法声明绕过。
3. 冻结 prepareConnectorLaunch 尚未定义：取得同代 Host/assets、单一 Python pin 安装/定位与已验解释器的本地快路径、需求/config key、同 key 准备合并、有效 ready 直接绑定、miss install/capture/先验证入口再发布、当前环境/参数/source重绑、真实失败与一次网络恢复、进度/取消/egress 生命周期，接入已有 localLaunch.packagePreparation。在这之前 npm/uv 产品子链不能称作完整离线准备。

**#1759 合入后生产接线（冻结 names/signatures 沿 r3/R5 接口与组装表）**：本轮最后只读复核其 HEAD 仍 ef8a1ce8b4441aeeb12cc3a5cc0843ad43c1682f，签名未变化。消费同次 planPackageManagerCaches 的 env/cacheEnv/rules/locations/excluded；resolvePackageManagerLocations 只是候选。由 installPackageManagerEnvironment / packageManagerEnvironment / refreshPackageManagerEnvironment / projectPackageManagerEnvironment / createPackageManagerEnvironmentRequester 持有最终绑定和 spawn 投影，不复制。随后接 mandatory bootstrap.launchers、main assets/download Host、sidecar 发布到 index/Slot/localLaunch、Node boot 重锚、当前 identity/代的 controller 与 diagnostic/retry、bindDocumentRuntime→runtime.retry()、renderer root；打包后完成真机器 AC。该表不声称 #1759 合入就自动完成本票实现。

偏离：初始文件表之外的 key schema/diagnostic export/fixture 都是同一内容责任的必要共享，原因见本节；新增 content 模块192行，不加依赖或配置开关。当前总改动9文件（约866增53删，含计划/测试），比单个 helper 的实现范围大，但未跨票。时间核对2026-11-26T21:39Z，自起始约82分钟，原预计90分钟；完整独立余项没有在本轮完成，留精确可续接状态。遗留去向：独立余项→#1760续接；生产装配→#1759合入后本票；Office compileall→documents已路由，本轮未工作；既有文档结果→文档治理。OPTIONAL：无。

## r8｜uv 内容归一、源绑定与准备事务

- 依据：r8 Phase IMPLEMENT；r7 37da012a1d/fc7b90f81c/c83146a951/50f36a9440 已接受。冻结 SPEC v1 / DESIGN v2.2 §4.3–4.7/§5 与既有裁定不重开。
- 核对：Codex / GPT-6，Phase IMPLEMENT；起始2026-11-26T21:40:48Z，预计90分钟，按子链核对；实际边界随提交更新。
- 顺序/文件：先在既有 core/mcp/codepuppy-uv-launch.ts、codepuppy-connector-content.ts、codepuppy-connector-key.ts 完成真实解析输出→需求/来源/有效配置内容；再在 codepuppy-connector-launch.ts 完成当前源绑定与完整 frozen prepareConnectorLaunch；connection.ts / diagnostic.ts 仅补同调用链的进度/实际准备挂接。回归放既有 core/test/codepuppy-connector-launch.test.ts，真实格式样本沿既有 fixture/uv-tool-settings.ts 及必要真实源码夹具。没有新的公开接口或依赖，不改 fence。
- 风险/证明：相同内容跨项目和凭据变化 key 相同，源/约束/有效解析设置改变则失效；editable 当前源与并行 Location 不相互覆盖，原服务 argv/env 不持久化。真实 uv/Python probe 在临时目录通过 gate slot；轻量测试验证事务只在 miss 安装/发布、hit 不解析 registry/下载 Python、失败与取消不留下 ready、准确进度/egress 归属。每项移除应使命名证据失败。
- 验证：迭代仅命名例；每步完整行为文件一次；返回前实际 export/mock/枚举消费者一次、core bun typecheck、affected-tests --list、文档和 diff 检查。继承其它模块未变证据，不跑全层/全套/时序/容量。
- #1759：沿 r7 的冻结接口与生产组装表，只读复核分支；不复制 R1/R2 或把候选位置当绑定结果。未决设计分叉才返回 PLAN-READY，其余本轮直接实现。

r8 执行目录红例：真实 pinned `uv tool run --help` 的 `-C, --config-setting`，现有 readUvLaunchEnvironment 把它复制为根目录选项。新增既有文件的 CLI 边界组件例（应用自有元数据协议，不伪造 uv 输出），`bun test test/codepuppy-connector-launch.test.ts -t 'uv execution environment keeps' --max-concurrency=2` →exit1，0 PASS/1 FAIL（`/tmp/connector-r8-uv-directory-red.log`）。先提交该例，再修复，只允许真实 --directory 进入该元数据读取命令。

r8 源秘密红例：Python 本地源遍历把 .env 字节纳入内容身份，业务密钥轮换会改变 key。以 r8 真实 setuptools 包的模块字节与应用自有 dotenv 输入新增组件回归，`bun test test/codepuppy-connector-launch.test.ts -t 'Python source identity excludes' --max-concurrency=2` →exit1 /0 PASS /1 FAIL（`/tmp/connector-r8-python-secret-red.log`）。来源字节与 parser 协议夹具 uv-requirements.json 是真实 pinned Python/uv 探针输出，含 source 文件及明确的假凭据；不新增运行时依赖。修复前先提交该例。

### r8 包目标内容归一与两项红例修复

normalizeUvPackageDeclaration 在 Location 随包 Node 中复用同一 content/key 秘密 owner，PEP508 与 requirements 行使用钉住 Python ensurepip wheel 内的 packaging/pip（不是系统模块、没有新依赖）；真实 UV resolved settings.resolver 是有效配置输入，SafeUrl 去 userinfo/签名、VerbatimUrl 不取 given/origin，local refs 替换内容事实。处理 marker/extras、Git revision/subdirectory/显式名字、本地 editable 内容、递归 -r/-c 与 constraints/overrides/build-constraints，短 -r= 翻译后仍交官方行解析器。把本次文件内容重写为私有临时 files，正常化结果附 materialized installArguments，安装器仅消费这个 argv，避免重复读取原始远端/约束内容。业务 argv、绝对源目录、业务环境不进 key；UV implicit executable 保留原名字拼写。Python 源跳过 dotenv 业务文件，源字节变化仍改变身份；Node -C 构建配置不再当目录。两条红例断言原样保留并转绿。

新夹具 uv-requirements.json 来自实际 pinned uv0.13.10/Python3.12.16 的调用和 parser stdin/stdout 录制，含实际 setuptools src-layout 源与明确的假凭据；组件测试只在 Python 的应用自有 JSON 边界回放真实包，内容遍历/归一/配置/临时 argv 是真产品代码，不手写 UV Debug 或 PEP508 的另一套解析器。规范化组件例跨 Location/业务值 key 相同；nested constraint、有效 resolver 设置、marker、editable 与 Git name 保持为 key 事实；代码变更失效，隐式同请求保留 Pip 原拼写，短 -r= 等价且服务 argv 不交 installer。

阶段证据：`gate slot -- bun /tmp/connector-r5-npm-proof/uv-content-capture-r8.ts` exit0（`/tmp/connector-r8-uv-content-capture.log`）；core `bun test test/codepuppy-connector-launch.test.ts --max-concurrency=2` →48 PASS /272 assertions（`/tmp/connector-r8-package-file.log`），core bun typecheck exit0/2069 files/2 projects（`/tmp/connector-r8-package-typecheck.log`）。其中整文件最早一次为48/261，随后新增 materialized argv/identity 断言及代码后才运行本次完整文件。一次 cwd 错设根目录的命令被 guard 拒绝且未执行测试，已在 core 更正。

文件偏离：ConnectorRequirement 继续在 key owner 定义，增加 marker/editable 与 Git name 这些需求事实；不改共享 Host/HTTP/Protocol。installUvConnector 私有 helper 的入参改为 installArguments（唯一的已读取文件方案），没有旧签名兼容分支；生产消费/总事务尚未接入。

### r8 解释器目标的实物输入发现与最小适配探针

合法 `uv tool run --offline --no-config --with-editable <source> python -c …` 真正输出3.12.16并导入当前本地源；原 r6 的通用 run→install 转换把 python 当 main package，真实 `uv tool install … python` exit2：`error: Cannot install Python with uv tool install. Did you mean to use uv python install?`。`gate slot -- python3 /tmp/connector-r8-interpreter-seam.py` exit0（正/反断言；`/tmp/connector-r8-interpreter-seam.json` / `.log`）。所以不能据包目标 helper 声称覆盖完整 uvx 语法。

继续验证的最小本地适配已可行：仍用 uv tool install，以同一已钉 Python ensurepip 内的 pip wheel 作内部环境根，原 --with/本地 editable 保留，随后直接执行该持久环境的 Python。`gate slot -- python3 /tmp/connector-r8-builtin-pip.py` exit0，采用冻结 only-managed/manual/3.12.16/build、原 R1 安装根，包安装0、Python执行0、当前 source-b 导入成功；/tmp/connector-r8-builtin-pip.json。没有新增来源、pin、公共端口或用户操作，因此尚不把它报成必须变更冻结接口的 SEAM；解释器请求分类/匹配同一 pin、这个适配的产品实现、可编辑源并行绑定与总准备事务仍未完成。probe 的另一条旧环境复现并不是真围栏/正式包验收。

### r8 已落：解释器请求、editable 重绑与完整函数组合

前节所列解释器适配已进入产品：normalizeUvLaunchDeclaration 识别 pinned UV 的 Python/cpython/pypy/graalpy 请求，用同一个 pinned ensurepip 的 pip wheel 作内部持久环境根，uv tool install 的原参数/with/editable 不丢失。解释器请求由真实 uv offline run 选择后比较实际解释器 realpath，Windows 仅在 venv redirector 情形读 pyvenv.cfg 的 home；不执行系统 Python、不下载第二个解释器。原包目标和 Python 目标消费同一 ConnectorRequirement/key owner，新增 interpreter request 是需求事实，不把实际环境目录写入 key。`-C`、dotenv 两条红例已保留。解码应用自有环境协议失败时返回固定错误，不将整个含密钥环境的 Schema issue 展示给用户。

bindUvConnectorSources 读取真实 direct_url/uv receipt；源路径没变直接用原环境。相同内容搬家时，在同 key 的私有 bindings/uuid 下只克隆 uv 子树，以真正 uv pip install --offline --no-deps --reinstall 重绑当前 editable（保留本次构建设置）。回执、入口和 RECORD 只在该副本重锚，Scope 结束清理自己的副本；共享 ready 不改。POSIX 只改脚本 shebang，Windows 保留 pinned UV 的原生 trampoline/ZIP，只更新实际 UV_PYTHON_PATH resource；Windows 路径尚无 Windows 实物执行证据。无需新增 pin、依赖、用户步骤或设计 SEAM。

真实命令 `gate slot -- bun /tmp/connector-r5-npm-proof/uv-binding-product-r8.ts` →exit0（`/tmp/connector-r8-uv-binding-product.log`）：pinned uv/Python，原源搬家，两个 Location 同时绑定各自 source-b/source-c，key 相同、各自 __file__ 正确、共享 ready 不变，Scope 结束两份绑定均删除。初版 pin 检查把 UV 的缓存 venv 目录当作解释器本身，实物例暴露后改为 executable realpath；没有增加拒绝合法请求的规则。

prepareConnectorLaunch 的 frozen 输入/返回现已定义并组合：先依赖/cwd预检、同代 Host/assets、egress acquire/release、R1 descriptor 的已绑定目录、随包 Node 读 Location 继承环境、角色环境、已有 Python receipt 或单一 ensureFile/uv install/find、需求/config key、同 key KeyedMutex、有效 ready 读取、miss install/capture/验证当前入口后原子 publish、当前环境/参数/editable 重绑。Python receipt 校验 pinSet/id、R1 根内路径与文件存在；UV ready 也列出 venv interpreter 必要文件。临时文件、私有绑定、准备子进程都有 Scope 所有权；安装 retry 与锁体先关闭 Scope 再释放锁。每位下载者独立订阅 authority，包安装以 key 合并；同 key listener 转发实际 stderr 活动，下载转发字节进度，attempt 的 Context.Reference 接到已有 connection producer。仅具体 connect/timeout/HTTP429/5xx 自动恢复一次，403/404/解析/完整性/粗 network 均不伪装下载；egress 仅依据当前 identity 且实际错误 URL host/port 匹配的 refused evidence 归因。

完整函数的 NPM 实物：`gate slot -- bun /tmp/connector-r5-npm-proof/prepare-product-r8.ts` 已冷准备并写入一份 Python receipt/ready；探针在 MCP 启动前误把无限协议 stdin 当元数据读完而阻塞，已终止并收完 gate 前台进程，没有冒充冷连接通过。只修探针记录器后，`gate slot -- bun /tmp/connector-r5-npm-proof/prepare-warm-product-r8.ts` →exit0（`/tmp/connector-r8-prepare-warm-product.log`）：新进程中两处 Location，真实 stdio MCP 各连一次；ensureFile=0、installer=0、begin/endEgress 各2，key相同、当前 argv/cwd/key正确，ready 无当前输入。使用 /tmp 探针只读导入 #1759 的真实 R1/R2，不在产品复制或引用其它 worktree。

必要文件偏离：新增 util/codepuppy-command-head.ts 是现有 main/platform 的同一函数/Windows后缀规则原样下沉供 core/main 共用；main/platform/index.ts 与 win32.ts 只 re-export，避免第二份命令识别 authority。startup.ts 同一失败 owner 增加准备期具体事实，diagnostic.ts/connection.ts 仅接同一 attempt 进度；npm-launch.ts 同链解码失败同样禁止把业务环境输出到错误。没有改 fence、HTTP/Protocol、gate、依赖或其它规格。

**本节不是 DONE-INDEPENDENT 收据**：独立事务的 UV 完整 prepare 实物、缺损 managed Python 的自动修复、同 key 合并/取消/失败恢复的总事务命名证据仍须补齐；细项与最终检查在本轮最终收据列明。生产 bootstrap/Host/root/controller/document retry 与正式包验收继续等 #1759；其 HEAD 最后核对仍 ef8a1ce8b4441aeeb12cc3a5cc0843ad43c1682f，R1/R2 names/signatures 沿前表，无复制实现。

### r8 最终收据与准确续接

依据版本：SPEC v1 / DESIGN v2.2 与 r4/r6 裁定；已核：Codex / GPT-6，**PARTIAL**。计划 c48aba66e0，红例957b719520/618f329c5d，内容归一 f1950cd716，解释器/绑定/事务组合85af80efff。没有新的冻结设计分叉；没有 push/PR/merge、窗口、fence 变更、全套/gate run/bin/check 或其它仓写入。

- **AC-02/04/05 的准备子链**：UV 完整需求/来源/有效 resolver facts、materialized 文件与 argv、解释器 pin 检查已有命名组件证据；真实 pinned Python/uv editable 搬家并行绑定命令和产物见上一节。key 不包含当前业务输入，当前源导入正确，共享 ready不变，私有环境随 Scope 清理。这不是干净机器/真围栏/本机模块整条 AC 通过。
- **AC-06/07/08 的准备与分类子链**：既有 attempt producer 接收阶段/字节/stderr活动；新增 preflight 依赖/cwd 和具体瞬时下载事实命名例，原 UI 状态/诊断调用方相关5例继续通过。没有宣称 controller/root 或“让助手排查”生产闭环已装配。
- **AC-10 的缓存子链**：完整 NPM prepare 在新进程中2个 Location 真 MCP stdio 连接通过；ensureFile/installer均0，当前 argv/cwd/env 正确。只称本函数缓存准备证据，不当作断网重启打包应用验收。冷准备写回执已观察到，冷 MCP 连接因探针 stdin记录器错误未取得成功证据。
- **AC-01/02/03/04/05/06/07/08/09/10 正式验收**：仍保留既有正式包、干净账户、真围栏、国内节点、限速、Win/原生模块与断网应用重启证明义务；本轮没有重跑先前已接受的实物下载/CLT证明。

**相关检查**（package cwd，层与依赖沿既有 core test 文件的静态 imports / literal fixture路径，受影响PR及nightly；未新增scenario）：
1. core `bun test test/codepuppy-connector-launch.test.ts --max-concurrency=2` →51 PASS、294 assertions（`/tmp/connector-r8-core-final.log`）。本轮新增6例；最后一次类型检查发现新增 classification 测试的数组被推断为 string[][]，只将它改为 readonly tuple，断言不变。
2. 实际 grep exports/mock/枚举消费者后，core `bun test test/codepuppy-mcp-runtime.test.ts -t 'Office declarations bind|bundled slots bind|bundled declarations reject|the failed status the desktop reads|a local server that writes a secret to stderr and exits' --max-concurrency=2` →5 PASS、62 assertions（`/tmp/connector-r8-runtime-related.log`）；另仅 `-t 'launcher download classification uses'` →1 PASS、10 assertions（`/tmp/connector-r8-runtime-classification.log`）。main/platform 原命令归一消费者 `bun test src/main/platform/platform.fast.test.ts --max-concurrency=2` →12 PASS、32 assertions（`/tmp/connector-r8-platform-related.log`）。这些以外未扩跑未改层。
3. core `bun typecheck` →exit0、2070 files/2 projects（`/tmp/connector-r8-core-typecheck-final.log`）；util →exit0、115files（`/tmp/connector-r8-util-typecheck.log`）；ui-mac →exit0（`/tmp/connector-r8-ui-typecheck.log`）。无独立包lint脚本，git diff --check exit0；hooksPath=.githooks。
4. **8个移除臂**：错将 -C 当目录、dotenv进key、丢marker、丢递归requirements facts、绕过Python pin、绕过依赖预检、丢瞬时HTTP归因，各自命名例exit1；取消editable重绑后，复用同一真实ready、不重装，`gate slot -- bun /tmp/connector-r5-npm-proof/uv-binding-existing-removal-r8.ts` →exit1、真实Python报 `ModuleNotFoundError: No module named 'owned_editable'`。日志 `/tmp/connector-r8-removal-*.log` / `removals-summary.log`。移除脚本一度因源文本匹配两处而停止，未改startup；随后用完整返回句精确匹配完成该臂。每次 git restore 自己的单文件变更，最终新增6例复核 →6 PASS、45 assertions（`/tmp/connector-r8-restored-final.log`）。总事务未证分支没有伪造移除证据。
5. `affected-tests --list` →exit0，**affected tests: 395 of 742 test files**（`/tmp/connector-r8-affected-final.scope` / `.list`）。相比r7多15个由命令归一共享owner的真实调用图可达文件；没有selector/global setup变更或每PR全局扩跑。
6. 官方 docs check_repo 本plan 0 findings，仓级56 errors/251warnings（`/tmp/connector-r8-docs.json`），与r7相同；`python3 scripts/check-doc-links.py docs/specs/connector-launchers/plan.md` exit0。既有 docs/README.md:1 index.stale 等转文档治理，不顺修。

**独立余项，仍归 #1760，不能算作等待 #1759**：
1. UV 主包/解释器、Local/递归文件、resolved config 已落，但完整 public prepare 的 UV 分支还没有端到端实物；Remote requirements 的实际读取/auth/cache、signed-query凭据轮换与离线缓存、stdin EOF/本地来源边界还缺命名真实输入证明，不能据已有文件例声称全部输入域完成。当前 HTTP读取复用 bundled npm make-fetch-happen 与 descriptor 的 XDG cache，只有非秘密内容进入 key。
2. Python receipt 在目标 binary 缺失时会走 ensureFile→普通 uv python install；部分损坏安装能否被uv自动修复尚未验证/收口，需要红先缺损例并按结果做最小修复。不要把“receipt忽略丢失文件”当作已实现修复。
3. 完整事务的同 key 并发只安装一次、等待者/所有者取消、取消后不晚到spawn、不留ready/临时/egress，安装失败不发布/瞬时仅重试一次、精确egress归因与进度订阅仍缺总入口命名回归/移除臂。当前代码已组合KeyedMutex/Scope/retry，primitive证据不能替代这些分支。修正探针记录器后的冷MCP整链也须补一次，沿已缓存原件，不需重复下载大包。
4. Windows trampoline只依据实际 pinned UV resource源码适配，未经Windows执行；正式Windows证明仍在正式包验收层。

**#1759 合入后的生产工作，接口已准确固定**：最后只读复核 HEAD ef8a1ce8b4441aeeb12cc3a5cc0843ad43c1682f。R1 `process-fence-profile.ts` 的 resolvePackageManagerLocations(input: PackageManagerLocationInput): PackageManagerLocations 仅候选；消费 `process-fence-plan.ts` planPackageManagerCaches(input: PackageManagerLocationInput & { truthPath:string; eligibility:WorkspaceDirectoryInput }) 同次绑定的 env/cacheEnv/rules/locations/excluded。R2 `shared/package-manager-environment.ts` 的 installPackageManagerEnvironment(value:unknown,pull?:()=>Promise<PackageManagerEnvironment>)、packageManagerEnvironment()、refreshPackageManagerEnvironment()、projectPackageManagerEnvironment<T>(source:Readonly<Record<string,T>>|undefined)、createPackageManagerEnvironmentRequester(post,initial) signatures 与前表一致；最终spawn消费R2，不自行投影候选位置。按前组装表接：mandatory bootstrap.launchers及校验；main assets/唯一下载Host；sidecar发布Host→index/Slot/localLaunch；Node boot重锚；当前identity/代的controller/状态/diagnostic/retry；bindDocumentRuntime→runtime.retry()；renderer root；再完成正式Mac/Win包真机器AC。没有“#1759一合入本票自动完成”的假设。

偏离/规模：初始表以外的 util共享命令owner、main两个re-export及npm解码隐私错误，均为同一调用链必要项，理由见上一节；相对r7共14文件、约1018增37删（本收据另计），没有依赖/迁移/新配置。时间核对2026-11-26T23:18Z，起始约97分钟，原预期90分钟；独立余项未完成，返回PARTIAL而非DONE-INDEPENDENT。遗留去向：上述独立余项→#1760续接；生产装配→#1759合入后本票；Office compileall→documents已路由，准确原命令/exit1/stderr空继承r4记录，本轮未碰；既有仓级docs结果→文档治理。OPTIONAL：无。

## r9｜独立准备事务收口

- 依据：r9 Phase IMPLEMENT；r8 c48aba66e0..24f49aae24 已接受；SPEC v1 AC-02/04/05/06/07/08/10，DESIGN v2.2 §4.3–4.7及既有裁定。
- 核对：Codex / GPT-6，IMPLEMENT；起始2026-11-26T23:20:16Z，预计90分钟；本轮不重做已接受子链，不改#1759或生产组装。
- 文件：core/mcp/codepuppy-connector-launch.ts（缺损Python修复/总事务），codepuppy-uv-launch.ts（远端来源缓存边界）；既有 core/test/codepuppy-connector-launch.test.ts，必要隔离Host进程的fixture（只承担本模块测试装配，静态import可追踪）；唯一文档为本plan。
- 顺序：先命名回归与真实pinned UV准备探针；红先补缺损Python/远端缓存缺陷并最小修复；总入口验证同key合并、取消、失败重试、进度和egress事实；最后相关消费者/typecheck/移除臂/scope收据。真实原件沿已有/tmp缓存，重实物命令经gate slot，不重复下载。
- 风险：Host进程内仅发布一次，常驻测试用独立子进程避免污染其它模块；外部格式沿真实samples，受控故障只发生在应用自有进程/Host边界。私有来源的认证不写key/ready；缓存不跨权限凭据复用未授权内容。取消必须在锁释放前结束子进程，并保证晚到progress/结果不重新spawn。
- 证明：AC-02/04/05→真实UV全prepare及Python缺损恢复；AC-06→总入口各等待者阶段/字节/真实活动；AC-07→一次瞬时恢复、确定故障不重试、egress精确identity/目标；AC-08→失败原文沿既有诊断生产；AC-10→有效ready快路径和远端源离线重启。组件/集成层只运行受影响命名例，阶段结束完整本文件一次，最终相关消费者一次；移除对应行为应使命名证据失败。
- #1759接口与待接生产点沿r8准确表，最终只读复核；不复制位置/最终绑定authority。偏离随实现提交记录。

r9 Python红先：真实 pinned uv 在移走已安装解释器的可执行文件后，`gate slot -- bun /tmp/connector-r5-npm-proof/python-damage-r9.ts` exit0，但 stdout收据为 install exit0 / `Python 3.12.16 is already installed` / restored=false（`/tmp/connector-r9-python-damage-real.log`）；探针finally已恢复自己移走的文件。新增既有测试 `connector preparation repairs missing Python and a damaged standard library`，真实Location/总入口、受控Python安装边界重放此事实，命名运行0 PASS/1 FAIL（`/tmp/connector-r9-python-red.log`），未修改产品代码。fixture/connector-preparation.ts为进程隔离Host及确定故障/真实子进程生命周期装配，输入是本模块自有契约和已有真实npm样本，不手写npm/UV输出格式。一次写fixture命令cwd误设core而路径仍含packages/core，写入未发生；随后在worktree根正确写入并运行命名例。

r9 Python修复：有效receipt只做随包解释器 -I/-S 的版本启动检查（无解析/联网）；失败/文件缺失才进入原单一下载authority并在锁内 `uv python install --reinstall`，仍保留r4的CLT探测与PATH规则，安装后再次启动检查成功才发布receipt。没有新增用户选项/公共API/位置authority；明确重装只发生于无健康receipt的准备miss。红例断言不变转绿1 PASS/4 assertions；阶段整文件52 PASS/298 assertions（`/tmp/connector-r9-python-green.log`、`/tmp/connector-r9-python-file.log`）。

r9远端红先：pinned UV真实 --show-settings（online/offline两份）和 pinned packaging/pip新输入回复已录入既有uv-requirements.json（命令`gate slot -- bun /tmp/connector-r5-npm-proof/remote-capture-r9.ts`及remote-parser-r9.ts，exit0；仅明确假凭据）。组件用真实HTTP服务+bundled同类npm缓存依赖+该真实协议样本，首次带Basic认证读取后，换signed token并offline仍发起第二次HTTP：`bun test test/codepuppy-connector-launch.test.ts -t 'uv remote requirements keep' --max-concurrency=2` →0 PASS/1 FAIL，requests期望1实际2（`/tmp/connector-r9-remote-red.log`）。未改产品代码。夹具脚本最初因根包type=module而把extensionless parser当ESM，已在红例提交前改用.cjs；这不是产品故障。
