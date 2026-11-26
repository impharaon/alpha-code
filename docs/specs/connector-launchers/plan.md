---
id: PLAN-connector-launchers
title: 连接器启动器实施计划
summary: 固定文件、随包资产、持久准备、单一呈现、受管文件调用与平台验收的交付分片；本轮实施固定文件权威。
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
| 静态 / 文档 | ui-mac `bun typecheck` → exit 0；`git diff --check` → exit 0；`python3 scripts/check-doc-links.py docs/specs/connector-launchers/plan.md` → exit 0。官方 check_repo 对本计划 0 finding；仓级 58 errors / 249 warnings，包括既有索引漂移及 docs/README.md 的 INT-safety、INT-upstream-upgrade-readiness 未知 ID，未顺修 |
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
