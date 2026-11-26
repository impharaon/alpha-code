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
- 核对：待本计划提交；本轮 brief Phase「PLAN then IMPLEMENT in the same round」授权提交后直接实施；无未定设计问题则继续，非独立计划审查。

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

暂无。
