---
id: DESIGN-connector-launchers
title: 连接器启动器与失败处理 技术设计
summary: 统一连接器启动器与固定文件准备；v2 接纳两平台文档 Node 读取及受管第一方 MCP 的运行期按 ID 准备，核验声明身份与逐调用进度归属。
kind: tech-design
status: frozen
version: "2.1"
spec: SPEC-connector-launchers
spec_version: 1
review:
  rounds: 0
  reviewed_sha: ""
  verdict: "pending; v2.1 trusted Node command-template increment awaits independent review"
  v2:
    rounds: 1
    reviewed_sha: 4d2b78d16b
    verdict: "fix-then-freeze; R1 1 Major 1 Minor + identity hardening accepted"
  v1:
    rounds: 1
    reviewed_sha: ceeee7d4df
    verdict: "fix-then-merge; R1 5 Major 2 Minor accepted and corrected"
owners: [owner]
last_reviewed: 2026-11-26
---

# DESIGN-connector-launchers｜连接器启动器与失败处理 技术设计

版本适用：以下 v1 正文与 R1 收据保持冻结，基线为 #1766 合入提交 `173122a8e955f97d830fe53fccd3400d079d9488`；文末 v2 增量仅替代其明确点名的条款，状态为 **frozen**，已按本增量 R1 与 owner 平台澄清修正，收据见文末 §10。 v2 已合入 `f7424aa45225a6d02d1958f4b4f72d247f99acc4`；文末 v2.1 仅补充可信 Node 命令槽及启动前准备，状态 **frozen**，v1/v2 正文和审查收据保留为各自版本的冻结基线。

本文按编排器对独立审查 R1 的「ALL ACCEPTED；修正后冻结」指令完成修正并冻结。规格的体验约定直接消费，不增加页面或设计稿；文件改动、实施顺序和具体用例归后续 plan.md。

## 1. 基线

- 依据：[SPEC-connector-launchers v1](spec.md)，批准提交 `31cd182e09710b603721c6f44d471b01289dd951`；固定版本可用 `git show 31cd182e09710b603721c6f44d471b01289dd951:docs/specs/connector-launchers/spec.md` 读取。
- 覆盖：BR-01..BR-11、AC-01..AC-10。没有新增用户限制，也不处理旧记录或旧版本行为。
- 继承批准回执：规格批准记录中的 U-10、P-01..P-05。Node/npm 的选型、首次下载等待和 npm 安装脚本关闭已在规格中决定，不重新评估 bun。
- 背景证据：协调仓 `docs/intents/discussions/INT-extensions.md` 的 U-05 至「四续」与 P-01..P-05，版本 `25afeda6285b66b3de9d83531fa2e5a6cafa468f`。本机试验根为 `~/.cache/alpha-orch/2026-11-25/connector-pilot/`，下文简称 `pilot/`；这是证据位置，不是运行时默认路径。
- 文档影响：architecture/decision。本文是本功能唯一技术决策落点；文档规范取本组合既有 `governance/documentation-standard.md`，只同步必要的生成索引，不修改保护资产。

## 2. 地面真相

调查边界是：打包签名、启动环境、固定文件下载、MCP 启动生命周期、失败动作和两个真实入口的可观察性。找到已有权威或明确新增端口后即停止，不巡查相邻模块。

| 编号 | 已观察事实与证据 | 对决定的影响 |
| --- | --- | --- |
| F-01 | 本工作树基线 `9f08c506d9842d319616c7e45c33d3b9c3279e48`。`server.ts:562-567` 只设 `UV_CACHE_DIR`，把随包 rg 追加到 PATH；`sidecar-env.ts:30-68` 透传 PATH、部分 Node 与 XDG 环境。下文无前缀的 main 路径均相对 `packages/ui-mac/src/main/`。 | 包管理器共用位置消费 #1759 R1/R2，启动器专有环境只算一遍，不由每个目录条目重设。rg 的既有优先级不改。 |
| F-02 | `ext-ipc.ts:104-116` 的 `checkRuntime` 只调用 which/where；`platform/index.ts:22-41` 已有 `toolProbe`、`commandHeadBase`。 | 匹配两类运行器时 uv/Node 就绪判定读随包资产；原生命令依赖保留平台探测，Git 另经 §4.5 的同一前检谓词。不能因用户没装 uv 就阻止运行器连接器安装。 |
| F-03 | `electron-builder.config.ts:172-204,222-237` 已有 extraResources、Office 与 rg 资源，mac 所有子二进制共用 `resources/entitlements.plist`。该 plist 没有 disable-library-validation。Electron RunAsNode 已关闭（`:207-215`）。 | Node 不能借 Electron；也不能直接继承当前 plist。仅给独立 Node 进程所需权限。 |
| F-04 | P-05 / `pilot/logs/q4c-node.txt`：Node 26.13.1 不带 JIT 时退出 133；JIT 两项在而 library validation 未放宽时，真实 `@parcel/watcher` 本机模块加载退出 3；三项齐全时加载成功。`scripts/q4c-variants.sh` 是 ad-hoc 实验，不是 Developer ID、公证或 Gatekeeper 证明。 | 采用定向签名；压缩包退路也必须经正式产物验证，不能把它称为已验证的公证解法。 |
| F-05 | P-05：uv 0.13.10，Python 3.12 可启动三个 Python 连接器；未钉版本选到 3.15.2 后文档读取失败。`logs/q2c1-file-mirror.out` 显示 uv 从 `file://…/20261124/cpython-3.12.16%2B20261124-aarch64-apple-darwin-install_only_stripped.tar.gz` 安装 3.12.16，294 ms。镜像不可达时 uv 不自行回 GitHub。 | 钉精确 Python 和构建；main 负责来源切换与校验，uv 只消费校验后的本地镜像。 |
| F-06 | P-05：三项 UV 目录缺一会越界；npm 默认温启动曾达 77 s，prefer-offline 后约 0.3 s。试验只做握手与列工具，未在产品真围栏跑。 | app data 收纳所有启动器写入；已准备入口不再进入在线解析路径，不能只靠 prefer-offline 承诺 AC-10。 |
| F-07 | `engine-explicit-config.ts:55-74` 给部分包运行器合成 300000 ms startup；`packages/core/src/mcp/client.ts:324,355-369` 在 `client.connect` 内同时启动进程与等待初始化。`connection.ts:182-203` 把启动与列工具放在已有并发许可下。 | 下载必须在调用 initialize 之前完成；继续加大 startup 数字不能满足 BR-06。并发规则本次不改。 |
| F-08 | `packages/core/src/mcp/stdio.ts:109-129,177-225` 从 `Environment.Service.spawner` 获取真实进程句柄、stderr、退出码，但只留 1000 字符尾部；`client.ts:61-73` 的 safeDescription 还会去掉 stderr。`scripts/north-star-guard.sh:138-147` 已收编 client、connection、index，未收编 stdio。 | 在已收编接缝注入准备与句柄观察；不改 stdio、不把原文塞进公共 error 字符串，也不新增上游收编。 |
| F-09 | `ext-presentation.tsx:502-515` 只把机器码转短原因；`background-problem-watcher.tsx:74-98` 的失败动作仍是「查看」。`use-projects.ts:70-102,447-522` 已有 `startChat`，走现有 `session.create`、`session.promptAsync`。 | 需要结构化启动详情与同一份呈现投影；排查动作复用现用会话发送路径，不切换引擎代际。 |
| F-10 | `process-fence-profile.ts:235-258` 的 W3 允许 app userData，但同时也允许用户项目、`~/.npm`、系统临时目录等；N4 仅放行已有出网代理端口。`sidecar.ts:270-281` 在装围栏后才继续启动引擎。 | 不扩大可写根、不新增 loopback 服务。AC-02 的目录比对独立于围栏放行集合，不能仅用「没被拒」充当证明。 |
| F-11 | `sidecar.ts:271-273`、`process-fence-plan.ts:230` 明确非 darwin 没有 seatbelt；[写入围栏规格](../child-process-write-fence/spec.md):36 明定 Windows 没有写入围栏。 | Windows 保持该批准的平台边界；目录收纳的行为证明照做，不能伪称 Windows 有等价真围栏。 |
| F-12 | `codepuppy-artifact-download.ts:299-412` 的 `writeChunksChecked` 已可流式计数、验 SHA-256、清理 part、fsync 并交 finalizer；完整云下载入口则还要求云 token、同源与产物配额。 | 复用底层写入器；不借用云产物下载入口，也不复制其哈希/part 逻辑或带入云配额。 |
| F-13 | `network-egress-grants.ts:204-236` 有拒绝记忆和在途询问；生产批准面是 `egress-approval-dialog.ts:19-44` 的原生询问。`shared/egress-denial.ts:37-65` 的 `egressPolicyDenialOf` 只认自己的策略拒绝，不把所有 HTTP 403 归为围栏。 | 「打开批准卡片」重开同一个已有批准面；需要一个显式用户重开端口，不能悄悄等五分钟或绕过审批。 |

### 本次小探针与未证实边界

- 命令：钉住的 `uv python install --help`、`uv tool install --help`；exit 0，确认 `--no-bin`、`--mirror`、`UV_TOOL_DIR` 所属命令面。官方 [uv 环境变量文档](https://docs.astral.sh/uv/configuration/environment/#uv_python_install_mirror) 确认 file 镜像；[工具文档](https://docs.astral.sh/uv/guides/tools/) 确认 uvx 的等价命令、`--from` 与持久工具环境。
- 命令：在 `tempfile.mkdtemp(prefix="connector-design-boundary-")` 中，官方 Node/npm 用 `npx-cli.js --offline --yes --ignore-scripts --package=file:<随包 npm 目录> --call <应用控制的 Node capture>`；exit 0、stderr 空，得到 npm `_npx/.../node_modules/.bin`。输入包直接取 pilot 的真实 npm 发布目录，没有手编外部格式；未运行目标连接器、未访问网络。回执为该临时目录的 `receipt.json`。这证明 npm 可在安装完成后运行应用自己的捕获程序；不证明所有 npx 语法的适配已经实现。
- 签名端口：本地 electron-builder 26.15.2 的 `macPackager.d.ts:14-15` 有 `CustomMacSign`，`macPackager.js:323-335` 调自定义签名；`@electron/osx-sign` 1.3.3 的 `types.d.ts:120-129` 有 `optionsForFile`。依据是本地已安装代码，未拿新版文档 API 代替当前版本；[v26 文档](https://www.electron.build/v26/docs/mac/) 是外部说明。
- 未验证：正式签名、公证、压缩包解出后的 Gatekeeper 执行；Windows 真机；真实产品入口下的慢网与离线；uv 的代理归属标记及所有选项到准备命令的等价适配。它们是实施证据的缺口，不是本次已通过的结论。

## 4. 接口契约

### 4.1 随包资产、签名与位置

**决定：默认随包展开，资源在 asar 外；Node 定向签名。** `<resources>/connector-launchers/uv/` 放目标平台的 uv、uvx；`node/` 放官方 node 与完整 npm 运行目录（含 npm 自己依赖及 npm/npx 入口，不带 headers、文档等开发材料）。Windows 相应是 uv.exe、uvx.exe、node.exe 与官方 zip 内的 npm 布局。保留所需许可证。不能拿现有 Office Python 跑第三方包。

mac 的 Node 使用当前应用 Developer ID、hardened runtime 和独立 entitlement 集：`com.apple.security.cs.allow-jit=true`、`allow-unsigned-executable-memory=true`、`disable-library-validation=true`。只匹配该资源树内的 Node 可执行文件，通过既有 `mac.sign` → 当前 signer 的 `optionsForFile` 覆盖；uv 不需要 JIT 或 library-validation relief。Electron 主进程、helpers、Office Python 与其它内嵌代码继续用现有权限。不要用全局 entitlementsInherit 给整个应用加这一项，也不要保留发行者 Node 的 get-task-allow 等不需要的权限。

**已决定的退路：若上述正式签名/公证或正式产物的本机模块加载证明失败，构建改用原始压缩包随包带。** 原始 uv 与 Node/npm 压缩包连同钉住的摘要位于同一资源树的 `archives/`，由应用外层签名保护，运行时不下载启动器。main 在首次使用时验哈希，解到 `<userData>/connector-launchers/<pin-set>/<platform>/` 的临时兄弟目录，完成后原子改名；保留上游可执行签名（包括其原有 get-task-allow），不在用户电脑重签或删除 quarantine。mac 用系统 `/usr/bin/tar` 解归档；Windows 若采用归档形态，用系统 PowerShell 的 `Expand-Archive -LiteralPath` 解 Node zip，uv zip 同理，不依赖开发工具。只取清单中的资源、目标和相对路径，解包不得越过目标根。主方案或退路由**构建产物清单**决定，不增用户配置/开关，也不在加载失败后悄悄运行另一份未知二进制。

退路是 spec 已允许的打包选择，不是已验证公证一定接受的结论。计划阶段须保留这个原始签名归档分支的真实打包/公证证明义务，不能只验证定向重签分支后推断它也能公证。若两种形态都无法通过正式产物证明，受影响平台返回 `BLOCKED: packaging`；不能交付一个运行时要求用户关闭系统保护的包。

### 4.2 固定文件清单与下载

**共享契约直接引用协调仓的「国内连接性设计」§4.11.1、§4.11.4，提交 `86a58c7bbdaad8b7c689d1c9c2845e3ce16db2a9`。** 可用 `git show 86a58c7bbdaad8b7c689d1c9c2845e3ce16db2a9:docs/specs/domestic-cloud-connectivity/design.md` 在该仓读取；消费范围包含切片四 §10 的 R1 处置和冻结收据；设计已冻结，线上部署和真实发布核对仍按 §8 留证。

- 唯一运行期清单是桌面宿主的 `packages/ui-mac/resources/pinned-files.json`，类型、字段、URL 校验与错误语义全部消费共享 `PinnedFiles` / `PinnedFileId`，本文不另定义 schema。所有字段包括精确 `bytes`、`sha256`、`version`、`originUrl`、`provenanceUrl` 都必填；家族和 target 枚举以共享契约为准，枚举本身不新增平台承诺。
- 唯一运行期下载口是共享 `ensurePinnedFile({ id, targetPath, signal?, onProgress? })`，结果为 `{ok:true,path,via:"cache"|"relay"|"origin"}` 或 `{ok:false,error:"unknown-file"|"network"|"integrity"|"disk"|"cancelled"}`。targetPath 仅由 main 的资源目录权威派生；sidecar / renderer 只传 ID，不能覆盖 URL、摘要或目标。
- 本票决定实现该**已决定 raise** 的宿主能力，core 通过 §4.7 ID-only 消息消费，不能跨层 import main。文件目标统一由 main 按 id 派生到 `<userData>/pinned-files/<id>/<filename>`；文件名取 originUrl 最后一个路径段恰好 percent-decode 一次。下载函数只交文件，安装归各运行时消费者。
- uv、Node 是构建期随包资产，不属于共享运行期清单的 Python/文档/模型/视频家族。它们的源、版本、摘要由启动器资产构建锁持有，不借此新增家族或改共享清单 schema。

本增量 pin-set 固定为 pilot 实测的 uv 0.13.10、Node 26.13.1（官方自带 npm 11.20.0）、CPython 3.12.16 / PBS 构建 20261124。以下摘要来自 `pilot/dl/{uv,node,python312}` 的上游 checksum 原文；Windows uv 来自同一发行版 `.zip.sha256`。Python 字节数由本次[公共 release 元数据](https://api.github.com/repos/astral-sh/python-build-standalone/releases/tags/20261124)读取确认（exit 0），digest 同原 checksum；未下载包。

| entry / 使用点 | 官方文件与 SHA-256 |
| --- | --- |
| `uv-darwin-arm64` / 构建 | `astral-sh/uv` release `0.13.10`，`uv-aarch64-apple-darwin.tar.gz`；`e419bf07533bdbf48795fc793601c834dd79db57a8c49ce8e25cfe3a8639958d` |
| `uv-win32-x64` / 构建 | 同发行版 `uv-x86_64-pc-windows-msvc.zip`；`297b3881fe1adfb922becc2c1613202abb41dc83ea5ff43d472aa087ca1f8683` |
| `node-darwin-arm64` / 构建 | `https://nodejs.org/dist/v26.13.1/node-v26.13.1-darwin-arm64.tar.xz`；`af6202f5370a3a5209e85dc543758dfd9f44c8726626a236730cd603a67a8559` |
| `node-win32-x64` / 构建 | 同发行目录 `node-v26.13.1-win-x64.zip`；`e2edda75bfb089654705cf65a13b58933bfd5f57148e8ebda916f58a2474f1f7` |
| `python/darwin-arm64/3.12.16-20261124` / 首次准备 | `astral-sh/python-build-standalone` release `20261124`，`cpython-3.12.16+20261124-aarch64-apple-darwin-install_only_stripped.tar.gz`；`9d6d9d0d85feda3f9cb4eb3e048f0fed21ed280feda087927eaa4fbc7124826f`；`bytes=25270084` |
| `python/win32-x64/3.12.16-20261124` / 首次准备 | 同发行版 `cpython-3.12.16+20261124-x86_64-pc-windows-msvc-install_only_stripped.tar.gz`；`96694b50dcfde13d56e40346ddaa552a9cd650290e9b933cecf83c1d82226960`；`bytes=22388338` |

GitHub 来源的完整 URL 是 `https://github.com/{owner}/{repo}/releases/download/{tag}/{filename}`。Python 的香港请求是 `https://<既有 GitHub 内容入口>/{owner}/{repo}/releases/download/{tag}/{filename}`，域名复用 `CODEPUPPY_GITHUB_RELAY_HOST` 的既有配置权威，原始路径中的 `+` 按路径段编码为 `%2B`，不做表单空格转换。路径、allowlist、重定向约束由上述共享契约拥有，入口从桌面清单的固定提交/原始字节摘要投影，不再维护一份手填白名单。Python 两条 entry 的 version 为 `3.12.16`，originUrl 为上表完整 GitHub 路径、文件名的 `+` 编码为 `%2B`，provenanceUrl 指向该上游 release。本文不把当前线上入口声称为已放行 Python。

main 原样消费共享顺序：有效缓存 → 香港 → 相同 originUrl。连接、非成功 HTTP、断流、精确长度或摘要不符，在本轮自动改道；取消和磁盘错误不改道。香港已 302 到原地址时不循环回香港。连接器只有确认是连接失败、超时、HTTP 5xx 或 429 这类传输失败时，才再发一次相同请求自动重试，仍失败投影「下载没有完成 + 重试」。404、解析/版本冲突及 integrity/disk 等非传输故障交未知失败与诊断，不因共享返回 network 就把永久错误标成可重试；共享结果的错误联合不变，分类器消费本次宿主/包管理器的原始 HTTP 与解析证据。

共享端口的头等待 10 s、相邻正文静默 30 s 沿用 §4.11.4；没有整包总时限，200 KB/s 持续慢流不耗 MCP startup。Range/If-Range 只用于同一路径的续传，206 校验起点/总长，200 重下；香港切到 originUrl 时一律丢弃香港半包，从 byte 0 下载，不携带香港的 Range/If-Range。坏 part 清理与最终 bytes+sha256 校验消费共享语义，不另设计。无凭据请求，不附平台 token/cookie。宿主实现复用现有 `writeChunksChecked` 的哈希/part/fsync/finalizer 能力，`expectedSize=maxBytes=entry.bytes`、`expectedSha256=entry.sha256`，这个长度是文件身份而非人为容量帽；不使用带 token、同源或云配额的高层下载入口，不改其公共 API。重新读取缓存也验证 bytes+sha256；同一宿主进程按 id 合并在途 Promise/结果，目标按 id 统一确定，不能按摘要合并不同条目；单个等待者取消不终止其它等待者的共享下载。

后续文档和视频消费者各自贡献批准 entry，调用相同 `ensurePinnedFile`；本文不复制共享契约的它们各族来源、分发或安装决定。Node 的 nodejs.org 包只在构建取，本次不要求香港支持 Node。

### 4.3 位置权威、作用域与最终环境

**包管理器位置唯一归 #1759 的写入围栏 v4 设计 §4.1 R1/R2。** 读取该设计 `resolvePackageManagerLocations(input): PackageManagerLocations` 的 `env`，`C=<userData>/package-managers` 由它派生；UV_CACHE_DIR、UV_PYTHON_INSTALL_DIR、npm_config_cache 的键、路径和最终投影均不在本文另算。这里消费本次 brief 确认保持不变的 #1759 R1/R2 接缝，不依赖其 Homebrew 待决项，也不复制其位置表。首次核对版本为 `b49fa26f938764d569feaab408d9053105af2821`，位置在该增量 §4.1（`:409-447`）。

main 从该 R1 结果、当前 `userDataPath`、`resourcesRoot()`、平台与 §4.1 资产锁产生一次宿主描述，随 `CodePuppyBootstrap` 交 sidecar；每个 key 的专用位置由同一启动器投影从描述派生：

```ts
type LauncherEnvironment = {
  platform: "darwin-arm64" | "win32-x64"
  pinSet: string                 // 构建资产锁的摘要
  uv: string; uvx: string; node: string; npmCli: string; npxCli: string
  runtimeRoot: string            // <userData>/connector-runtime 的真实绝对根
  pythonFileId: PinnedFileId      // 同平台 Python entry；版本/build/摘要取共享清单
  packageManagerEnv: PackageManagerLocations["env"] // 直接消费 #1759 R1，不重算路径
  environment: Record<string, string> // 仅下表启动器专用默认值，不含业务密钥或 R1 位置
}
```

路径均为已有系统路径、资产锁或 userData 派生的绝对路径；fileId 平台须匹配。位置常量留既有 `USER_DATA_LAYOUT`；runtimeRoot 只收准备入口、诊断、启动器临时目录等专用数据，固定文件按 §4.2 的独立目录。这是宿主契约，不新增用户设置。

**作用域以原始启动声明判定，准备后仍保留 runner 种类**：只有 `uvx` / `uv tool run`（uv-tool）和 `npx` / `npm exec`（npm-exec）的准备阶段、已准备入口及其派生连接器进程应用下表覆盖。原生 `python3 server.py`、`node server.js` 等命令保留既有环境合成（含 #1759 的通用缓存投影），只接诊断与已有依赖事实的启动前检查；不替换它们的解释器、不加 launcher PATH/UV_PYTHON*/XDG、不清掉其环境值。

| 启动器专用项 | 固定值或派生值 | 作用域 |
| --- | --- | --- |
| `UV_TOOL_DIR`、`UV_TOOL_BIN_DIR` | `<runtimeRoot>/prepared/<key>/uv/tools`、`uv/bin` | uv-tool 准备、已准备入口及派生进程；不改 #1759 的通用用户 tools/bin |
| `UV_PYTHON`、`UV_PYTHON_CPYTHON_BUILD` | `"3.12.16"`、`"20261124"`，取 Python entry | 两类运行器及其全部派生连接器进程 |
| `UV_PYTHON_PREFERENCE`、`UV_PYTHON_DOWNLOADS` | `"only-managed"`、`"manual"` | 同上，每次连接器启动都保留，不仅 Python 安装阶段；子进程中的 uv 不能自行在线找另一份 Python |
| `UV_PYTHON_INSTALL_BIN`、`UV_PYTHON_BIN_DIR` | `"false"`、`<runtimeRoot>/uv/python-bin` | 两类运行器及其派生进程，不写 shell 启动文件 |
| `UV_PYTHON_INSTALL_MIRROR` | `file://` 的本地已验镜像根 | 两类运行器及其派生进程；只有显式 Python 安装消费它 |
| `npm_config_prefer_offline`、`npm_config_ignore_scripts`、`npm_config_update_notifier` | `"true"`、`"true"`、`"false"` | npm-exec 准备、已准备入口及派生进程；语义继承已读的 [npm exec 文档](https://docs.npmjs.com/cli/v11/commands/npm-exec/) |
| `TMPDIR`、`TMP`、`TEMP` | `<runtimeRoot>/tmp` | 两类运行器准备及派生进程 |
| `XDG_CACHE_HOME`、`XDG_DATA_HOME` | `<runtimeRoot>/cache`、`<runtimeRoot>/data` | 仅两类运行器准备及派生进程；XDG_CONFIG_HOME 不覆盖，用户 uv.toml 的读取位置保留 |
| `PATH` | 平台 delimiter：已准备包 bin → 随包 uv/Node bin → 钉住 Python bin → 连接器声明 PATH → 宿主继承 PATH（含原 rg 后备），按出现顺序去重 | 仅两类运行器；准备阶段尚无包 bin 时省略该项 |
| 出网代理变量 | 既有策略代理目的地与协议，附 §4.5 的 attempt 归属标记 | 仍连同一代理，不改放行判定 |

合并顺序固定为：宿主继承环境（已取得 #1759 R1 默认）→ 连接器当前声明的环境/业务密钥 → **仅两类运行器**的启动器专用覆盖及上述 PATH 合并 → **#1759 R2 在最终真实 spawn 再投影同一 R1.env 的缓存键**。R2 不动 PATH、代理、registry 或凭据；启动器层也不覆写它拥有的位置键。npm 按 §4.4 的显式 `--prefix` 安装，不设另一份 npm_config_prefix。shell/PTY/LSP 的通用位置由 #1759 接线，本文不扩其作用域。

两类运行器使用本构建的绝对 uv/uvx 或 node + 官方 npm/npx CLI JS，Windows 经 `commandHeadBase` 识别 .exe/.cmd/.bat；当前声明中的原生 node/python 命令不因此被识别为运行器。仅这两类的进程树清掉会选错运行时的宿主 NODE_OPTIONS、PYTHONHOME、PYTHONPATH、VIRTUAL_ENV，不修改 main 的 process.env、HOME 或引擎 XDG 根。业务 registry、私有认证与国内镜像沿原权威读取。这里“每个连接器进程都保留 manual/only-managed”指本增量接管的两类运行器及其已准备入口/子进程；原生命令按本节的诊断限定保留既有环境。

### 4.4 准备、离线入口与计时

现有 `McpConnection.make` 的 local 启动路径先取得并检查 §4.5 的 main 依赖事实；只有两类运行器在取得 `startPermits` 前调用新增 core 自有的 `prepareConnectorLaunch`。准备完成后把结果交 `McpClient.connect` 的宿主私有 `prepared` 参数，再建立 `McpStdio` / `initialize`；原生命令不调用准备函数，直接走带诊断的原有 spawn；Location 的 `Environment` 仍是所有包安装和服务进程的唯一执行面。main **只**下载固定文件或展开随包启动器，不能接受来自 sidecar 的任意安装命令在围栏外执行。

```ts
type PackageRunner = "uv-tool" | "npm-exec"
type LaunchIdentity = { directory: string; server: string; attempt: string }
type PreparedLaunch = {
  runner: PackageRunner              // 已准备入口继续按原始运行器角色应用环境
  key: string                       // sha256(规范化输入，下述定义)
  command: [string, ...string[]]     // 可直接执行的绝对入口及参数
  cwd: string                       // 已解析的真实工作目录
  environment: Record<string, string>
}
// Effect，在调用者的 Location Environment + Scope 下执行，可中断。
// native 命令只接诊断与依赖前检，保持既有环境；包准备/启动器覆盖仅对两个 PackageRunner 执行。
declare function prepareConnectorLaunch(input: {
  runner: PackageRunner
  identity: LaunchIdentity
  command: readonly [string, ...string[]]
  cwd: string
  environment: Record<string, string>
  runtimeDep: RuntimeDependencyFacts // main 按当前已安装声明解析并前检，不能由 renderer 猜测
}): Effect.Effect<PreparedLaunch, ConnectorLaunchFailure, Environment.Service | Scope.Scope>
```

这里的 `Effect`、`Environment`、`Scope` 为仓内既有导出命名空间，执行需求由调用位置已有服务提供；没有新增 HTTP API 或用户 MCP 配置键。现有 `ConfigMCP` 仍是唯一配置 schema。

1. **Python**：main 取得 §4.2 的本平台 Python entry；build date 取 originUrl 的 release tag，文件名取 URL 最后一个路径段恰好 percent-decode 一次，得到磁盘上的字面 `+`，不保留 `%2B`、不做 form 解码。把已验文件放到 `<本地镜像根>/<build-date>/<解码后文件名>`（同文件可硬链接或复制）。sidecar 依共享契约的 build 参数，用随包 `uv python install 3.12.16 --no-bin --mirror <file镜像>` 安装；uv 内建下载元数据必须与应用 pin 的版本、构建、文件和摘要相符。uv 再次验其内建摘要，不允许转向其它在线镜像。之后以 uv 的持久 tool 环境准备当前声明：`uvx` 与 `uv tool run` 等价；隐式 `tool@version`、显式 `--from`、extras、`--with`、源与解析选项转换为同一需求，`uv tool install` 放在该 launch key 的 `UV_TOOL_DIR` 下。保存它给出的真实 bin 路径；服务参数原样交服务，准备不调用服务、不发送 MCP 消息。解释包名/命令名和选项的适配是本次明确新增能力，不能只支持目录里的名字；不能把解析不了的合法声明归成「不支持第三方」。
2. **Node**：用官方 npx / npm exec 规则归一包 spec、重复 `--package` 与服务 argv/原有 `--call`，解析仍在随包 node 进程消费 npm 的 `npm-package-arg`、`@npmcli/config` 与 `get-bin-from-manifest`。准备改为官方 `npm install --prefix <runtimeRoot>/prepared/<key> --ignore-scripts --prefer-offline <归一的包 specs>`，完整保留解析相关选项；缓存仍是 #1759 R1 的 npm_config_cache，不为该 key 重定向缓存。安装完成后从该 prefix 的真实 package manifests 用 `get-bin-from-manifest` 选择默认 bin，或按原声明的显式 bin 选择，得到其中的绝对入口；不靠 npm exec 的共享 `_npx/<hash>` 树作为本票持久入口。服务 argv 每次重新绑定，原有 `--call` 使用已有平台 shell 语义；准备只安装/选入口，不启动服务。包入口、node_modules 和 lock 均留在 prefix，JS 入口用随包 node 执行，不以 Bun 替代 npm。
3. **持久就绪**：结果与收据位于 `<userData>/connector-runtime/prepared/<key>/`。key = SHA-256(平台、启动器/运行时 pin、规范化包需求/解析选项、**仅影响包解析的非秘密配置内容指纹**)。指纹从实际生效的 registry/source、约束/依赖文件与解析配置中提取内容并规范化；过滤认证字段、URL 凭据/签名信息，不 hash 整份环境或配置文件。**cwd、项目目录、Location/Session/连接器实例 ID、服务参数中展开的工作区路径、密钥值/引用/版本号及任何密钥派生 hash 均不进 key**；它们在每次执行从当前定义绑定。若解析读取项目中的配置/源文件，只纳入影响解析的非秘密内容，不用该文件的项目绝对路径作盐。收据只存 schema 版本、上述指纹、真实包版本、绝对入口/所需 bin 与成功事实，不写业务环境或秘密；环境与入口存在才发布 ready。同一解析内容换项目、轮换密钥或更新其引用仍命中同一准备结果，执行时用当前 cwd/参数/密钥。
4. **再启动**：命中有效收据后直接执行准备好的包入口，带同一份受控环境，完全跳过 npm/uv 的 registry 检查、latest 解析、Python 下载和后台更新。启动器的 prefer-offline 只是首次准备优化；AC-10 依赖的是这条无包解析路径。没有自动到期、TTL、启动时刷新或清缓存行为。只有包需求/解析内容改变或所需文件缺失才重新准备；cwd、服务参数、密钥变化只重新绑定执行输入，不迁移旧记录、不要求用户操作。

完整 launcher 语法等价适配与持久入口捕获属于 §6 的 R3b raise，不是假称已有函数；必须保留原声明的执行语义和环境隔离。Windows 的 Python console/legacy scripts 入口按 uv 自己的 Scripts/bin 解析结果取得，npm bin 的 JS 用官方 node 执行，.exe 直接执行，声明本来就是 .cmd/.ps1 时用对应系统解释器，不引入 Bash 依赖。

**计时决定**：准备态没有 MCP 启动总时限，也不占握手许可；许可仍只由 `startPermits` 一个权威持有，准备后才取得、覆盖真实启动/握手/列工具。准备成功后才开始现有 30000 ms 握手默认值；用户显式声明的 startup 值在这个边界后使用。撤销本功能两类运行器的合成 300000 ms 首次下载补丁，不改变其它运行器、catalog 与 execution 时限。持续下载的 200 KB/s 慢流不会消耗握手预算。已准备连接器的自动启动不先排队等待其它连接器完成下载；仍保留既有启动并发权威，不新增并发上限。

### 4.5 状态、错误与单一呈现

为宿主增加以下**旁路详情契约**，不改公共 `Mcp.Status` 联合、Protocol 或 Server HttpApi。引擎原状态在准备/握手期间仍是 pending；详细状态由 core 生产，main 留存当前代快照，preload 传 renderer。键是 `(directory, server, sidecarGeneration, attempt)`；不能只用 server 名误配其它项目。

```ts
type PreparationProgress =
  | { unit: "bytes"; completed: number; total?: number }
  | { unit: "packages"; completed: number; total?: number }
  | { unit: "activity"; detail: string }
type DownloadFailureEvidence =
  | { kind: "connect" | "timeout"; detail: string }
  | { kind: "http"; status: number; detail: string }
  | { kind: "resolution" | "integrity" | "disk" | "other"; detail: string }
type PinnedFileDelivery = {
  result: EnsurePinnedFileResult
  failure?: DownloadFailureEvidence // 失败的原始事实，非临时重试动作；成功时省略
}
type ConnectorLaunchFailure =
  | { kind: "download"; detail: string }
  | { kind: "egress"; host: string; port: number }
  | { kind: "secret"; fields: string[]; packageId?: string }
  | { kind: "auth"; service: string }
  | { kind: "workspace"; reason: "missing" | "not-git" }
  | { kind: "dependency"; program: string }
  | { kind: "unknown"; detail: string }
type ConnectorLaunchState =
  | { phase: "preparing"; stage: "launcher" | "python" | "packages"; progress: PreparationProgress }
  | { phase: "connecting" }
  | { phase: "connected" }
  | { phase: "failed"; failure: ConnectorLaunchFailure; diagnostic: string }
  | { phase: "disabled" }
// 每次状态传输均携带 LaunchIdentity、sidecarGeneration 与递增 sequence。
```

`completed/total` 是非负安全整数，total 缺席不伪造百分比；包管理器没有可用数量时显示实际阶段和持续活动。准备显示规格原句「正在准备（首次需要下载运行环境）」及当前进度；不产生失败事件、不进入「未恢复的问题」。正在重试/改道仍处于 preparing。取消、停用、卸载中断当前订阅/进程并结束该 attempt，不制造失败问题。成功/停用/移除在两个入口同步消除旧问题。

`classifyStartFailure` 继续拥有启动归因，扩展结构化证据输入；网络层仍消费现有分类。宿主下载实现须在 HTTP/errno 尚在时留存本次 id 的最终失败事实，窄桥将共享 EnsurePinnedFileResult 与 DownloadFailureEvidence 包在 PinnedFileDelivery 内，不修改共享 ensurePinnedFile 的公开签名/结果联合；包准备从真实进程的错误构造同一证据。仅 connect、timeout、http 5xx/429 投影为 download；无法确认具体传输事实时归 unknown，不能单凭 network 这个粗码重试或把 404 误报为网络。main 的包授权事实可补充 secret/auth 类型，但不以猜测覆盖明确的原始故障。renderer 只有一个 `connectorLaunchPresentation` 投影，返回原因、展开详情和**一个**动作；行与 watcher 都消费它，不再各写一张码表。

| 可信来源（按具体事实优先） | 原因 | 唯一动作及落点 |
| --- | --- | --- |
| main 固定文件/准备包的连接失败、超时、HTTP 5xx 或 429，已完成自动恢复尝试 | 下载没有完成 + 简短原因 | 重试：重启该 attempt，复用已验文件和有效缓存 |
| 本次请求的 `egressPolicyDenialOf`，或可归到本次目标的真实代理拒绝事实；普通 registry 403 不算 | 需要你批准联网 | 打开批准卡片：调用已有审批权威的显式重开端口；批准后自动重启该连接器 |
| `readPackageAuthorizationV1` / 连接器当前声明的必需密钥确实未保存 | 需要填写密钥 | 去填写：现有连接器密钥面 |
| 现有 needs_auth / MCP OAuth 事实 | 需要登录 | 去授权：该服务已有 authenticate 路径 |
| 已解析 cwd 不在；或 Git 连接器真实 git 仓库检查得到 not-git | 这个文件夹不存在 / 这个文件夹不是 Git 仓库 | 换文件夹：现有系统目录选择，重新绑定该连接器的工作目录后重启 |
| ENOENT 指明程序，或真实 stderr 明确缺少外部程序 | 需要先安装 {program} | 让助手处理：§4.6 |
| 404、包解析冲突（含 requires-python 排除钉住版本）、integrity/disk、退出、握手/协议错误或未知第三方报错 | 启动失败（可展开原文） | 让助手排查：§4.6 |

**依赖事实在启动前进入同一调用链。** main 按当前安装绑定、已安装版本的声明解析 `runtimeDep`（既有字段见 `renderer/extensions/catalog-types.ts:34`；安装前读取点见 `use-extensions.ts:945-951`），不用当前目录最新条目覆盖已安装事实，也不在 core 另列 Git 连接器名单。新增宿主读取/前检端口和返回形状为：

```ts
type RuntimeDependencyFacts = {
  runtimeDep: readonly string[]
  executables: Readonly<Record<string, string>> // 确认可用的程序名 → 真实绝对入口
  missing: readonly string[]                  // 当前声明中缺失的依赖
}
// main 解析已安装声明并调用同一个前检谓词；PackageRunner 角色取原始启动声明。
declare function readConnectorRuntimeDependencies(identity: LaunchIdentity): Promise<RuntimeDependencyFacts>
// main 的安装预检与上述读取端共用此谓词，解析 PATH/平台证据，不试跑会弹框的 stub。
declare function checkConnectorRuntimeDependencies(input: {
  runtimeDep: readonly string[]
  runner?: PackageRunner
  environment: Record<string, string>
}): Promise<RuntimeDependencyFacts>
```

main 通过 §4.7 的宿主桥把这份事实送到 prepare 的必填 `runtimeDep` 输入。`McpConnection.make` 在任何包准备或连接器 spawn 之前检查 missing；非空即归 `dependency`，显示真实缺失程序及「让助手处理」。每次启动重新前检，prepared 收据命中也不跳过；它是本机只读检查，不引入联网或准备动作。没有声明的第三方配置返回空 runtimeDep，不猜测另一份名单；后续 ENOENT/明确 stderr 仍走既有分类。

mac 对声明的 git 使用同一不弹框谓词：先读 `/usr/bin/xcode-select -p` 结果与真实 git 文件位置；查询失败或找不到可用真实 git 都记 missing=git，在任何连接器/包管理器 spawn 前返回。`/usr/bin/git` 这个 stub 的文件存在不能算可用，不能通过执行它来检查版本；同理不会借 `/usr/bin/python3` 探测两类运行器的 Python。安装预检也调用相同谓词，不能继续只看 which/where；uv/Node 依赖只在匹配两类运行器时按随包资产判断，原生命令按其现有 PATH 判定。Windows 检查真实 git.exe。git 可用后才在正确 cwd 检查仓库，非仓库按 workspace 分类。这个事实源和前检接线是本次明确 raise，不声称目前工具名 which 已经覆盖 AC-01。

`chooseWorkspace` 的绑定规则沿当前声明：`{workspace}` 由现有引擎投影按当前 Location 展开（`ext-install-planner.ts:984-992` 已说明这一权威），选择新项目目录后在新 Location 重连，不把模板改成另一个硬编码 argv。明确配置了 cwd 的声明由 main 通过其当前来源的既有写端更新 cwd；保留其它命令/业务配置，不能给来自包的定义另建一份 renderer 覆盖记录。用户取消选择就结束该动作、保留原失败事实，不新增确认步骤。

代理拒绝未必被 npm/uv 保留正文；仅凭时间接近的拒绝日志不能归给某个连接器。**R5 的归属决定**：main 在当前 sidecar generation 下登记 `LaunchIdentity`，给本次准备/服务进程的代理 URL 附一个在途 attempt 标记；uv/npm 的 HTTP CONNECT 代理认证字段携带该标记。策略代理在 CONNECT 入口解析并关联本次 host/port/拒绝结果，只在当前已登记标记命中时发结构化详情；代理认证字段在这里终止，不能转发上游或写进普通日志。这个标记只做归属，不参与 allow/deny、不是新的联网许可或强制代理认证；其它进程和无标记请求沿原路径。Node 随包的 `https-proxy-agent/dist/index.js:107-110` 已从 proxy URL userinfo 产生 Proxy-Authorization；uv 的相同行为仍需在真实入口证明，不把包管理器没回传的正文当既有端口。

该新增归属端口的契约为 `beginConnectorEgressAttempt(identity): { proxyEnvironment: Record<string,string> }`、`endConnectorEgressAttempt(identity): void`，以及 `ConnectorEgressEvidence = { identity, host, port, outcome: "refused" | "granted" | "not-asked" }` 的 main→sidecar 消息。只有当前在册 identity 可读自己的证据；end/换代撤销关联。没有代理的平台返回原代理环境并不生产策略拒绝证据；识别不了的第三方错误仍走未知失败。显式「打开批准」只重开该失败事实指向的现有询问，批准后重试；不自动批准，也不改变进程树级授权范围、持久化和默认按钮。

### 4.6 诊断与助手交接

在该次启动专用的 `Environment.spawner` 装饰器上观察真实句柄：tee stderr、退出码/信号和错误，保持 stdin/stdout、退出与取消语义。stderr 先做下述已知凭据遮蔽，再同时交诊断与 stdio，避免 stdio 的现有 debug 日志重新落入未遮蔽值；除遮蔽部分外不改原文。观察从准备开始，覆盖连接成功后立即退出；不改 stdio 的上游实现。`safeDescription` 的简短公共错误和现有普通日志纪律保持有效，完整详情另经窄 IPC 提取，不依赖 1000 字符尾部恢复原文。

诊断事实为 `{identity, requestedCommand: string[], effectiveCommand: string[], cwd: string, exitCode: number|null, signal: string|null, stderr: string, stage: "launcher"|"python"|"packages"|"handshake"|"running"}`；未启动就失败的退出码为 null，绝不伪造 1。状态里的 diagnostic 是由 attempt 派生的不透明 ID，`diagnostic(identity)` 只返回本次事实与必要的文件 part 引用，不接受调用方给路径。stdout 只记协议解析错误涉及的片段，不整份收集 MCP 响应。命令按 argv 保存，显示时才格式化。原文与命令先遮蔽当前连接器实际已知密钥、Authorization、URL 凭据/签名查询，再落 `<userData>/connector-runtime/diagnostics/<attempt>/`；不传密钥环境，不把其它连接器或整份日志交助手。遮蔽跨 chunk 生效，不以下载错误的 300 字符摘要代替原文；schema 不设原文截断额度。

```ts
type ConnectorLaunchDiagnostic = {
  identity: LaunchIdentity
  requestedCommand: string[]
  effectiveCommand: string[]
  cwd: string
  exitCode: number | null
  signal: string | null
  stderr: string
  stage: "launcher" | "python" | "packages" | "handshake" | "running"
  transcriptFile: string // main 按 attempt 派生/校验的 app data 内绝对路径，供已有 file part
}
```

一次点击调用 `CodePuppyProjectsApi.startChat`，使用当前有效项目（失效则现有默认工作区），随后用既有导航打开返回会话。首条消息同时给出：连接器名称、用户原命令与实际命令、cwd、失败阶段、退出码/信号、遮密后的 stderr 原文，以及「请从这个失败直接排查，先解释原因并检查本机可执行条件」。报错作为不可信引用材料，不变成 system 指令；原来的权限档与工具审批仍生效。长详情通过现有 file prompt part 引用应用数据内的诊断文件，短详情直接 text part；不丢内容、不引入新上传服务或新对话审批步骤。以 `onSessionCreated` / `existingSessionID` 复用 startChat 已有的发送失败重试语义，避免一个点击产生多个空对话。

### 4.7 窄消息与真实入口的证据契约

main↔sidecar 消息扩展既有按 ID 请求/应答模式：`codepuppy.pinned-file.ensure`（`{id, fileId}`，只接受清单 ID）、`codepuppy.connector-launch.changed`（身份、代、sequence、状态）、`codepuppy.connector-launch.diagnostic`（身份引用的查询/回包），另承载 §4.5 的 runtime-dependencies 请求/事实回包与 egress begin/end/evidence。固定文件 reply 是 `PinnedFileDelivery`（内含原样共享 `EnsurePinnedFileResult` 与最终失败事实）；无效字段/ID 不执行 I/O。请求均有终结回包；progress/changed/evidence 是通知，不等待应答；stop/进程退出中断对应请求，旧 generation 的回包不覆盖新状态。bootstrap 只增加已校验的启动器资产位置/pin/派生环境，函数端口由 sidecar 在启动引擎前注册；不把回调塞进结构化克隆文档。renderer↔main 的新增 preload 面为 `connectorLaunch.list(directory)`、`subscribe(listener)`、`retry(identity)`、`diagnostic(identity)`、`openNetworkApproval(identity)`、`chooseWorkspace(identity)`；只允许当前宿主已有的连接器身份，不接受任意命令/URL/文件路径。

```ts
type LaunchSnapshot = {
  identity: LaunchIdentity
  sidecarGeneration: string
  sequence: number                    // 非负 safe integer，本 attempt 单调递增
  state: ConnectorLaunchState
}
type LaunchActionResult =
  | { ok: true }
  | { ok: false; error: "not-current" | "unavailable" | "cancelled"; detail?: string }
// util 的进程内能力端口，sidecar 用 parentPort 适配；core 只消费这个值。
type ConnectorLaunchHost = {
  ensureFile(id: PinnedFileId, signal: AbortSignal, progress: (received: number, total: number) => void): Promise<PinnedFileDelivery>
  changed(snapshot: LaunchSnapshot): void
  runtimeDependencies(identity: LaunchIdentity): Promise<RuntimeDependencyFacts>
  beginEgress(identity: LaunchIdentity): Promise<{ proxyEnvironment: Record<string, string> }>
  egressEvidence(identity: LaunchIdentity): Promise<ConnectorEgressEvidence[]>
  endEgress(identity: LaunchIdentity): void
}
declare function publishConnectorLaunchHost(host: ConnectorLaunchHost): void
declare function connectorLaunchHost(): ConnectorLaunchHost
type ConnectorLaunchApi = {
  list(directory: string): Promise<LaunchSnapshot[]>
  subscribe(listener: (snapshot: LaunchSnapshot) => void): () => void
  retry(identity: LaunchIdentity): Promise<LaunchActionResult>
  diagnostic(identity: LaunchIdentity): Promise<
    { ok: true; value: ConnectorLaunchDiagnostic } | Extract<LaunchActionResult, { ok: false }>
  >
  openNetworkApproval(identity: LaunchIdentity): Promise<LaunchActionResult>
  chooseWorkspace(identity: LaunchIdentity): Promise<LaunchActionResult>
}
```

`ConnectorLaunchDiagnostic` 即 §4.6 的完整事实形状，`EnsurePinnedFileResult` 从共享契约导入。`publishConnectorLaunchHost` 每代 sidecar 只注册一次、在引擎启动前执行；未注册而调用是内部接线错误，不回退成围栏外执行。它和 bootstrap 使用相同的跨 bundle 已发布值模式；不新增公共插件挂点。诊断正文仍由 sidecar 持有/落盘，查询通过同一窄桥按身份取得。main 仅投影接收的当前代快照，不重新推导 phase。not-current 不操作其它 attempt；unavailable 交现有失败呈现并保留诊断；取消文件夹选择为 cancelled。list 初始快照与 sequence 使订阅重连不漏状态、旧序号不覆盖新状态。动作本身不作为「已恢复」证据，恢复以新状态为准。

**AC-02 的可观察事实**必须来自打包后的安装/启用入口 → 配置汇合 → `McpConnection.make` 的 prepare → `McpClient.connect` → 该代 `Environment.spawner`，而非独立运行脚本。记录真实 userData、resolved argv/运行时版本、三项 UV 根、npm cache、TMP/XDG、fence build ID/profile 摘要与实际写盘差量。Mac 使用真实继承 fence 的 utilityProcess 和真实策略代理；HOME 比对以干净账户完成应用首次启动后的稳定状态为基线，再启用连接器；此后差量只允许 app data 内的启动器写入，不能把 `~/.npm`、用户项目或系统 temp 在围栏中可写当成符合 BR-03。对照臂以 F-01 的真实旧入参复现缺陷：UV_CACHE_DIR 仍在 app data，UV_PYTHON_INSTALL_DIR 未设，同时撤掉 #1759 对该变量的最终投影，XDG_DATA_HOME 取原宿主继承值而非运行器的 app data 默认（否则 R2 或 XDG 也会把 Python 留在 app data，成为无效反例）；同一入口必须在 HOME 内、app data 之外的 Python 默认位置得到 Operation not permitted；另一个受限路径写入必须实际失败，防止跑成无围栏对照。不能用更严的 pilot profile 代替真实入口。

**AC-10 的可观察事实**是五个已准备环境跨**应用进程退出/重启**仍可直接执行，网络在重启前即不可用；从真实连接调度到 connected 的每个连接器墙钟 ≤10 s。首次启动时的 SHA/准备收据与重启时的 key、最终 argv、未进入解析/下载阶段可关联；同时观察所有真实出网尝试，避免把超时或缓存 mock 当离线。去掉持久入口、改回默认包运行器的同一入口必须失去离线路径或超过预算，判据才有能力失败。200 KB/s 下的 preparing 状态和两个问题入口的同步性也由此状态流观察，不用伪造延时替代实际包下载。

Windows 以相同入口记录路径差量、准备收据和离线时钟，覆盖无开发工具及本机模块；按已批准的平台边界记录 `fenced=false`。AC-09 中的目录收纳结论可以成立，但「Windows 真围栏已证明」不能成立。如果 AC-09 被解释为新增 Windows OS 围栏，必须回 spec 澄清，不能由本票暗造一套 Windows sandbox。

## 5. 数据与失败

- **边界**：main 拥有固定文件下载与随包归档展开；包解析、包构建/安装、Python 安装与连接器进程均在已有 Location 执行面内。服务在握手后联网与下载工具自身业务资产仍受原规则约束，不能经固定文件下载器代下任意 URL。
- **发布**：固定文件只在 SHA 匹配、fsync 后 rename；准备收据只在安装全部成功且入口实际存在后原子发布。崩溃留下 part/未发布目录，下次只复用已验的完整内容，不把「目录存在」当 ready。收据不是安全授权，仍经现有配置/包信任读取；进程树不能凭它提升权限。
- **幂等与并发**：固定文件按 id 合并，准备按 key 合并；同包的不同解析选项互不覆盖。每个连接器 attempt 独立订阅进度。连接器重试不抹掉有效 Python、其它环境或已有缓存，不要求用户清目录。
- **自动恢复**：随包入口替代缺失/旧本机工具；固定文件换源；包准备仅对连接失败、超时、HTTP 5xx/429 自动重试一次。404、解析冲突、integrity/disk、密钥缺失、授权拒绝、缺程序、非仓库和协议错误不做无意义自动循环；立即保留事实与唯一动作。取消不自动重启。已准备入口崩溃不会自动删包再联网，只有证据表明环境缺文件才重新准备。
- **故障窗口**：HK 字节错误不会进入 uv；origin 也验不过归共享 integrity，再投影为 unknown→助手排查；磁盘失败可展开原 errno，重试仍使用相同根；进程未启动和启动后退出用 null/真实退出码区分。准备进度不因 main 的普通 RPC 超时转成 failed；取消和真实传输故障才终结请求。
- **离线语义**：BR-11 只承诺启动不因包解析联网变慢，不伪造连接器的远端业务服务可离线。已准备包按声明变更重算 key，没有后台自动升级或兼容期。

## 6. 架构落点

位置按 [模块图](../../architecture/modules.md) 中 ui-mac、core、schema/util 与 ext 的现有责任落置；这里是责任映射，不是改动文件清单。

| 责任 | 模块与依赖 | 复用的权威 / 架构结论 |
| --- | --- | --- |
| 资产、下载、平台路径、审批和快照 IPC | ui-mac main；只消费 schema/util 与 Electron/OS | `resourcesRoot()`、`USER_DATA_LAYOUT`、#1759 R1/R2、`writeChunksChecked` 与现有审批。K2 收敛，不复制共享位置和校验。 |
| 启动前准备、执行观察与归因 | core 的自有 MCP 模块，现有已收编 client/connection/index 调用；core 不依赖 ui-mac/main 或 ext | 既有 `Environment.Service`、`classifyStartFailure`、`startPermits`。固定文件请求通过 util 的进程内端口，不引入 Server 反向依赖。 |
| 跨 bundle 值与窄消息 | 自有 schema/util 的纯数据与进程内端口；main、sidecar、core 消费 | `CodePuppyBootstrap` 的构建/解析/发布权威，sidecar 的 parentPort 模式。没有新增顶层包或目录模块，不需改模块图。 |
| 状态原因/动作与新对话 | ui-mac renderer，preload 公开面与现有 SDK 适配器 | 一个呈现投影，复用行、RowStatus、problems 和 startChat；renderer 不导入 main 私有实现。K2 的既有状态子串偏离不扩散到新联合。 |

### 接缝总表（已有或本设计决定 raise）

R 表示本设计已经选定、需要实现的能力及签名/语义，不表示现有 API；其范围均在本票 AC 内。实施不得用同名未定义绑定或用主进程任意执行来替代。

| 依赖能力 | 可合法调用的已有符号 / 决定的 raise |
| --- | --- |
| 资源路径、环境分区与平台识别 | `resourcesRoot`（`ext-fs-installer.ts:260`）；`USER_DATA_LAYOUT`（`user-data-layout.ts:4`）；`commandHeadBase`（`platform/index.ts:39`）；bootstrap `paths.userData`（`packages/util/src/codepuppy-bootstrap.ts:18-20`） |
| 定向签名 | `CustomMacSign` + 当前 signer `sign(opts)` / `optionsForFile`（F-04、本地包代码坐标）；**R1**：§4.1 的按精确 Node 路径覆盖，不增加全局 entitlement；归档消费同样由 main 资产解析权威负责 |
| 固定文件获取与流式校验 | `writeChunksChecked`（`codepuppy-artifact-download.ts:299`）；**R2**：实现共享 `86a58c7` §4.11 的 `readPinnedFiles(): PinnedFiles`、`ensurePinnedFile` 与 §4.7 ID-only 消息/最终失败事实回包；main 获取公共响应，受控本地镜像交 uv，不开 HTTP 服务 |
| 环境计算与传递 | `buildCodePuppyBootstrap`（`codepuppy-bootstrap-build.ts:62`）、`publishCodePuppyBootstrap`（util `:250`）；#1759 v4 §4.1 R1 `resolvePackageManagerLocations` / R2 最终 spawn 投影（已决定 raise）；**R3a** 仅拥有 §4.3 的 LauncherEnvironment、启动器特有覆盖与解析器扩展，server/预检/启动消费共享位置 |
| 包准备和持久入口 | 当前 CLI `uv python install`、`uv tool install`；官方 `npm install --prefix`、`npm-package-arg`、`get-bin-from-manifest`；**R3b**：§4.4 `prepareConnectorLaunch` 及 runner 语法适配、收据，在 `McpConnection.make`（`connection.ts:165-203`）先消费已安装 runtimeDep 前检、两类运行器取启动许可前准备，`McpClient.connect`（`client.ts:357`）消费其 `prepared` 参数 |
| 围栏内执行、终止、捕获完整 stderr/exit | `Environment.Service.spawner.spawn` 和 ChildProcessHandle（`stdio.ts:109-129` 使用的同一服务）；**R4**：仅此 MCP attempt 的 spawner 装饰器，tee 保留原语义，§4.6 诊断；不改未收编 stdio |
| 机器归因与主界面原因/动作 | `classifyStartFailure`（`codepuppy-startup.ts:51`）、`egressPolicyDenialOf`（shared `:43`）、`readPackageAuthorizationV1`（`package-admission.ts:468`）；**R5**：§4.5 的结构化详情、read/checkConnectorRuntimeDependencies / runtimeDependencies 桥、begin/end/evidence 归属端口及唯一呈现投影；普通错误仍走既有简短错误面 |
| 用户重开网络审批 | `askUserForEgressGrant`（`egress-approval-dialog.ts:19`）、`requestUserEgressGrant`（`:204`）；**R6**：`reopenUserEgressGrant(host, port): Promise<EgressGrantOutcome>`，用户点击时清除该目的地拒绝记忆/聚焦在途询问，再走原权威；自动请求不能调用它 |
| 快照、重试和诊断窄 IPC | sidecar `parentPort`（`sidecar.ts:128-145`）、server 的 `postCodePuppy`（`:780`）；**R7**：§4.7 消息/preload 面。重试仍调用既有 SDK `mcp.connect({name})` 并经相同 prepare 路径，不另造服务进程入口 |
| 缺密钥/登录、换目录 | `readPackageAuthorizationV1` / `savePackageSecretsV1`（`package-admission.ts:468,519`）、SDK `mcp.auth.authenticate`（watcher `:87`）、preload `openDirectoryPicker`（`preload/types.ts:742`）、`persistMcp`（`ext-config.ts:470`）与现有项目选择；**R8**：§4.5 action 接线及 `chooseWorkspace(identity)`，只按当前定义/作用域变更目录，不在 renderer 拼配置 |
| 助手新对话与自动首条发送 | `CodePuppyProjectsApi.startChat`（`use-projects.ts:88,447`），已有 `extraParts`、回执与重试 ID；**R9**：§4.6 构造诊断首条消息/文件 part 和导航，不改发送代际 |
| 真围栏与真实入口观察 | `planProcessFence`（`process-fence-plan.ts:229`）、`applyProcessFence`（`process-fence-apply.ts:86`）、sidecar `installProcessFence`（`:270`）；**R10**：§4.7 的本次身份、阶段、收据与解析入口可观察信息，经真实已有打包入口留证，不用替身冒充 |

K1 不涉及权限档位变更；K2 在环境、下载校验、归因与 UI 投影均保持一个权威。ADR-037 的会话代际边界不动。没有必要架构例外；实现若发现接缝需要未收编上游修改，应返回 `BLOCKED: design`，不能扩大收编。

**安全边界**：第三方包/服务是不可信执行内容，继承现有文件、密钥、联网围栏。main 的新增下载权只接受内建 ID，不能由包改为任意 URL/命令。Node 的 library validation 放宽只影响独立第三方运行时进程，不影响 Electron 的加载边界。准备路径与诊断路径以当前 userData 真实根为边界；不通过软链把缓存移到根外。权限批准和包信任仍由既有权威判定。

**否决的替代**：把启动器追加到 PATH（旧版本会胜出）；共享 Office Python（F-04 的本机模块限制）；只设 prefer-offline（缓存缺失/解析仍可联网，不能证明 AC-10）；一律调大握手时限（BR-06 仍失败）；main 代装任意包（绕过围栏）；本地 HTTP Python 镜像（N4 不允许另一个 loopback 端口，file 镜像已有实证）；在 renderer 解析 stderr（丢失完整原文且形成第二归因权威）。

## 8. 拆分决定

所有权边界包括香港入口与 #1759 的共享位置权威；这里不把本票准备/UI 的实施顺序拆成工作单元。

| 产出方 / 责任 | 产出与 AC / 小节 | 消费的契约 | 开工依赖 | 集成/验收依赖 |
| --- | --- | --- | --- | --- |
| 协调仓「国内连接性设计·切片四」的设计拥有者；入口维护方实现 | Python 固定文件 allowlist、URL 路径及转发规则；AC-03 / §4.2 | 本文 Python entry 的原始发行路径、文件名含 `+`、两平台摘要 | 已批准国内连接性规格；此处的消费形状 | 共享冻结设计 `86a58c7bbdaad8b7c689d1c9c2845e3ce16db2a9` 与实际部署放行；AC-03 的国内节点和 owner 本机观测 |
| 本仓 #1759 的位置/围栏拥有者 | 共用包管理器位置及最终投影；AC-02 / §4.3 | v4 §4.1 R1/R2，C 只在该权威派生 | 已确定的 R1/R2 形状；不等待 Homebrew 待决 | shell/PTY/MCP/LSP 的真实最终 spawn 消费同一 env，连接器不能重写位置 |
| 本仓桌面宿主 | 随包启动器、固定文件消费、准备/诊断/UI；AC-01..AC-10 | §4.1..4.7 | 本规格 v1 与本冻结设计；无需等远端上线才能实现本地消费 | 香港入口真实契约与部署；正式签名、公证、平台实机证据 |

**本仓桌面发布步骤的跨仓次序**：入口维护方先部署包含待发清单新增条目的 relay snapshot；本仓发布者随后从**待发打包产物内**提取清单，以该构建随附的来源锁核对逐字节摘要与部署输入一致，再消费共享的新增 probe release 端口：

```text
python3 <转发运维目录>/pinned-files.py probe --manifest <待发包内清单> --lock <待发构建来源锁> --base <线上香港HTTPS-origin> --mode release --location release --output <发布证据.json>
```

逐条 HEAD、不跟随跳转、不读正文，每条必须直接返回 200；404、302、其它状态或连接失败均非零，保留逐条结果和清单摘要。不得用转发仓已有快照代替待发包内清单制造通过；HEAD 只证明路径已放行，完整文件摘要/国内链路可靠性仍需原验收证据。上述核对成功后才发布消费该清单的应用；“已生成快照”不能替代已部署。此处是共享设计 §4.11.1/§10 R1 明确归本仓的发布集成责任，不是用户的新步骤，也不授权本次执行发布或上线。

本文不拥有服务器 allowlist 或运维配置。后续 #1761 与视频需求消费 §4.2 的同一固定文件机制，独立增加自己的批准条目；不是本票的开工依赖，也不在这里设计其下载内容。

## 9. 回滚

不适用。没有数据迁移或不可逆数据改变；不引入兼容期、旧版本启动路径或回滚机制。§4.1 的归档形态是同一构建能力的打包退路，不是上线后的版本回滚方案。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| 默认展开随包、Node 定向签名；正式证据失败时选原始归档随包解到 app data | spec v1 待决、F-03..F-05；权限组合已做 ad-hoc 验证，正式分发仍未验证 |
| main 的固定文件下载与围栏内包准备分权；Python 精确钉 3.12.16 / 20261124，用 file 镜像 | F-05、F-10、F-12；不依赖 uv 自动换源 |
| 通用位置读 #1759 R1/R2；启动器专用覆盖只用于两类运行器，原生命令保留既有环境 | R1-1/R1-5；BR-03、BR-05，不另定义 uv/npm 位置或隐藏用户 uv.toml |
| 准备无握手总时限；握手后段沿用原默认或显式配置 | BR-06、F-07；phase 与 progress 为真实活动，不造百分比 |
| 准备时解析，按 key 的安装结果重启直用；key 不含 cwd 或密钥派生值 | R1-3/R1-7；BR-11、F-06；旧 npx 捕获探针只证明历史边界，新的 npm prefix 安装接线仍待实施证明 |
| 分类从事实源做一次，行与问题入口消费同一投影；未知失败可新对话排查 | BR-08、BR-09、F-08、F-09、F-13；报错遮密后带完整命令/退出事实 |
| Windows 的启动器/环境/诊断/离线行为同构，围栏边界沿用已批准平台说明 | BR-10、F-11；未把 Windows 目录比对冒称为 OS 围栏 |
| 所有缺失端口为 R1..R10 的决定 raise；无未指名的后台准备器/事件/助手入口 | §6 seam map；不引入上游新收编或引擎代际切换 |

| 轮 / 版本与范围 | 审计方 | finding 及处置 | 改了什么 / 验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| 作者自查，基线 `9f08c506d9842d319616c7e45c33d3b9c3279e48`、规格 v1，本文全部 | Codex / GPT-6 | 首稿作者自查，不计对抗审查轮次；由以下 R1 与冻结收据接续 | BR/AC 覆盖、事实/推断分离、接缝映射、范围与保护资产核对；临时 npm 边界探针 exit 0；ui-mac 的 `bun test src/main/old-name-scan.test.ts` exit 0（10 pass）；文档检查器对新设计无 finding，整体既有问题见留档；`git diff --check` exit 0 | 正式签名/公证、Windows、真实入口 AC 证据、uv 代理归属标记与完整 CLI 等价适配归实施验证；香港部署及桌面发布核对归 §8 |

### R1 独立审查、处置与冻结

审查版本 `ceeee7d4df`，审查员 **Claude Opus 5.5**（只读、非作者），结论 FIX-THEN-MERGE，5 Major、2 Minor。编排器本次裁决为 **ALL ACCEPTED**，要求应用最小修正后冻结；以下七项均已采纳并修正，没有增加用户步骤。作者 Codex / GPT-6 只核对修正及引用传播，不记为第二轮独立审查。

| finding / 级别 | 处置与最小修正 | 核对证据 / 遗留 |
| --- | --- | --- |
| R1-1 Major：包管理器位置出现第二权威 | **采纳并修正**。§4.3 的三个共用位置键只读 #1759 R1.env，移除本设计的 UV cache/install、npm cache/prefix 路径；合并顺序以 #1759 R2 最终真实 spawn 投影收尾。§6 与 §8 同步 owner/依赖 | #1759 v4 §4.1 R1/R2 的 C 与 env 形状已读取；本文旧 connector-runtime 缓存位置声明已移除。生产最终投影归实施证明 |
| R1-2 Major：共享下载契约落后于冻结版 | **采纳并修正**。§4.2/§4.4/§5/§6/§8 统一消费冻结 `86a58c7`（含 §10 R1）：按 id 合并、URL 末段单次解码、香港半包回原址从 byte 0、部署快照后由本仓执行 probe release HEAD 核对再发布应用 | 读取该提交的 §4.11 与 §10；旧共享提交引用在本文归零，发布命令/输入/200 成功与非零条件已明确。真实部署和 HEAD 证据归发布阶段 |
| R1-3 Major：cwd/秘密使准备结果无法离线复用 | **采纳并修正**。§4.4 key 只含包需求、pin 与非秘密解析内容指纹，明确排除 cwd/项目/身份、服务工作区参数、密钥值/引用/版本/派生 hash；每次执行重新绑定 cwd 与业务秘密 | `stdio.ts:43-44`、`client.ts:363` 的默认 cwd 已核实；跨项目与密钥轮换不触发准备的真实离线结果归实施证明 |
| R1-4 Major：Git 依赖未接入启动路径 | **采纳并修正**。§4.4/§4.5 的 prepare 必填 main 解析/前检的已安装 runtimeDep；宿主桥增加 runtimeDependencies。安装前和实际启动前复用同一 checkConnectorRuntimeDependencies；mac 的 xcode-select 查询失败或无真实 git 时 spawn 前归 dependency，不能执行 stub | 现有字段/读端 `catalog-types.ts:34`、`use-extensions.ts:945-951` 已核实；新增读取、谓词和桥明确列为 §6 R5 raise，未假称 which 已提供能力 |
| R1-5 Major：启动器环境覆盖范围过宽 | **采纳并修正**。§4.3/§4.4 匹配原始 uv-tool/npm-exec 角色，准备及 prepared 入口保留该角色；原生 Python/Node 保留环境只接诊断/依赖前检；删除 XDG_CONFIG_HOME 覆盖，PATH 保留连接器声明及宿主段 | 原覆写表已替换；用户 uv.toml 位置不变；final PATH/R2 接线属实施证据，未运行应用 |
| R1-6 Minor：Python 下载控制作用域与失败重试不明 | **采纳并修正**。manual/only-managed 从准备保留到两类运行器的每个已准备连接器及派生进程，不只安装时设置；connect/timeout/5xx/429 才归 download+retry，404/解析冲突等归 unknown→助手。最终 HTTP/errno 事实随既有窄桥交分类器 | §4.2/§4.3/§4.5/§5 与 PinnedFileDelivery 一致；共享 EnsurePinnedFileResult 公开联合未改；原生命令按 R1-5 不加启动器变量 |
| R1-7 Minor：npm 持久入口实际在共享 npx cache | **采纳并修正**。§4.4 选官方 npm install --prefix prepared/key，安装树/lock/入口均归该 key；用随包 get-bin-from-manifest 选真实 bin，npm cache 仍消费 #1759 | 删除“npm exec 捕获后即为 per-key 安装”的决定。首稿捕获探针仅保留为历史事实，新的 prefix 安装未伪称已经实测 |
| R1-OPTIONAL-A / R1-OPTIONAL-B | **采纳为计划阶段证明义务**。归档退路保留原厂签名（含 get-task-allow）的完整打包/公证分支必须留证（§4.1）；AC-02 HOME 比对以应用首次启动完成后的稳定状态为基线（§4.7） | 不增加产品动作或本次实施范围；plan.md 消费这些证明义务，不把它们写成已通过 |
| R1-OUT：sdist-only Python 包可能执行 /usr/bin/cc | **范围外仅留档**。无开发者工具 Mac 上的该构建行为未在本次重测；不由本票新增编译器拦截、禁用 sdist 或其它用户限制 | 按本次 brief 记录，未调查/修复，不成为本轮冻结阻塞 |

**冻结收据**：依据规格 v1、R1 审查 `ceeee7d4df` 和本次编排器裁决，七项修正完成后冻结；`review.rounds=1`、`reviewed_sha=ceeee7d4df`、verdict 为 `fix-then-merge; R1 5 Major 2 Minor accepted and corrected`。已定勿重开：位置权威、冻结共享下载、key 的身份边界、Git 前检、运行器覆盖范围、传输失败分类与 npm per-key 安装。下一步由实施者消费本冻结设计编写 plan.md；实际签名/公证、Windows、CLI 适配、真围栏/离线结果及发布探针仍归相应实施/发布证据，本次不声称这些已通过。

**R1 文档验证回执**：在本工作树对修正后的本文核对七项处置、精确 review 字段、旧共享引用/位置定义传播及接缝形状；ui-mac 的 `bun test src/main/old-name-scan.test.ts` exit 0（10 pass / 0 fail），`git diff --check` exit 0。官方文档检查函数对本设计 0 finding；仓级仍为 71 errors / 250 warnings，与首稿基线一致，未顺修范围外文档。索引只保留生成器产出的本设计 frozen 行。上述是修正核对，不是运行时验收或第二轮独立审查。

**待 owner 定**：无新增产品取舍或限制提案；本文已按本次编排器指令修正后冻结。若 owner 要求 Windows 具备 OS 强制围栏，和现有批准规格的平台边界冲突，需另行澄清范围；本文不替 owner 作该决定。

**留档**

| 提议 / 观察 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| 当前生成文档索引在写本文前已 stale；文档合同检查基线有既有错误与警告 | 基线 `docs_index.py --check` 非零；官方 `check_repo(..., changed_since="origin/alpha")` 为 69 errors / 252 warnings。新设计无 finding；因只加生成的本设计索引行，索引原有两个未解析跨仓 ID 从 warning 升为 changed-file error，现为 71 / 250，另仍有原 stale | 只保留生成器产出的本设计行；不顺带收进全量索引漂移，也不清理旁支文档/保护资产。依据为既有 Alpha Delivery profile 对当前工作树调用同一官方检查函数 | 既有索引 stale 及两项引用告知调度方，本设计未新增无效引用 |
| 应用之外的实际国内下载、Windows、正式公证事实 | 当前证据未覆盖，不能以 pilot 替代 | 本次禁止启动 GUI、正式分发与联网下载包；这里只读公开文档/元数据 | 实施与平台验收取得真实证据，按受影响条款更新回执 |


# v2 增量｜文档启动器与受管固定文件接缝

## 1. v2 基线与边界

本增量只处理本次 brief 路由的两个消费者请求，不重审 v1 的产品取舍或 R1 已处置项：

- **文档请求**：#1761 `docs/specs/document-output-quality/design.md`，请求提交 `279e9bf1c1`；按 brief 读取其 HEAD `5c3a3beae0e1c93a8478dfe4752a8d260c69bc21` 的 §1、§4.1、§4.8、§8 和 §10，原请求包含 Node/bootstrap 与 Intel 投影；本轮仅保留两平台读取面，平台取舍按 §10 的 owner 原话裁决。消费方已批准规格 v1 的 AC-09/15；其它文档能力归该设计。
- **视频 L1**：#233 `docs/specs/video-understanding/design.md`，固定提交 `9f438a7bc8` 的 §4.2 L1（`:138-152`）、§6 D3、§10 pending-seam（`:476`）。只接收受管第一方 MCP 取固定文件的端口；L2 的 family/source 变更仍归固定文件权威，D5 云调用仍归消费者自己的工具外层通道。
- **原权威**：v1 的 `LauncherEnvironment`、资产签名/归档退路、`ConnectorLaunchHost` 与 ID-only main 桥；固定文件仍消费共享 `86a58c7` §4.11/§10，缓存位置仍消费 #1759 R1/R2。本次不改共享下载 schema、来源或 package manager。
- 当前代码基线 `aa2476b378da663115e6735b991f6cbf2e04b5c6`。文档影响为同一 feature design 的接口增量；只改本文及对应生成索引行。本轮按 `4d2b78d16b` 的独立 R1 与 owner 平台澄清修正后冻结；接收回执是技术契约，不是运行实现或产品验收已通过。

## 2. v2 地面真相

调查仅回答：文档该从哪里合法读现有两平台的 Node；首方声明输出、摘要与环境/cwd 的核验由谁提供；共享 client 的 metadata 如何归到当前调用。找到合法符号或明确 raise 后停止。

| 编号 | 已观察事实 / 依据 | 对决定的影响 |
| --- | --- | --- |
| V2-F01 | v1 §4.3 的 platform 只含 darwin-arm64/win32-x64，而 #1761 §4.1 的 DocumentEnvironment.node 指向同一 LauncherEnvironment；其 §4.8 的 DocumentHost.environment 经可信 ext/Location 桥投影 | 接收现有平台轴和只读消费面扩展，不为文档再带 Node 或套用运行器环境 |
| V2-F02 | owner 2026-11-26 的平台澄清，原话见 §10；此前 Intel 元数据调查不构成发行授权 | 撤回额外平台/资产行，v1 的两平台域保持不变 |
| V2-F03 | `packages/ui-mac/scripts/target-arch.ts:41-44` 当前 resolveMacTargetArch 明确拒绝 x64 | 与 owner 平台澄清一致，本增量不扩此入口或锁行 |
| V2-F04 | `packages/util/src/codepuppy-bootstrap.ts:250-265` 由 publishCodePuppyBootstrap 深冻结、codepuppyBootstrap 逐 bundle 解析后读取；v1 R3a 已决定增加 launchers 数据，尚未实现 | 文档加入这个只读面；函数仍走宿主端口，不序列化回调 |
| V2-F05 | 当前 SDK 2.3.1 的 Protocol.setRequestHandler 有 `(method, {params,result}, handler)` 自定义方法重载（本地 `dist/index-B-4n9P0J.d.mts:2329-2354`）；core `mcp/client.ts:285-326` 在 connect 前注册 handlers | 新私有方法可在已有 client 构造点注册，不需要新 HTTP/Server API、SDK patch 或新依赖 |
| V2-F06 | SDK BaseContext.mcpReq._meta 可读取当前请求的协议元数据（本地 `dist/index-B-4n9P0J.d.mts:1925-1942`）；client.ts:550-554 已向 tools/call 写 _meta。该 SDK 的 InputRequest 联合（同 d.mts `:654-677`）仅有 sampling/roots/elicitation，故不能借 input_required 发送这个自定义方法。Tool.Context.progress 在 `packages/schema/src/tool.ts:14-19`；core `tool/mcp.ts:92-98` → `mcp/index.ts:889-892` → `mcp/client.ts:547-563` 目前没有准备进度回调、onprogress 为空 | 决定走同一 stdio 的自定义 JSON-RPC，用协议 _meta 的本次调用关联值取得确切归属，并新增内部回调；不改 SDK、不猜“最近调用”或宣称 metadata 已接入 |
| V2-F07 | `declaredFirstPartyTools`（core `mcp/codepuppy-first-party-mcp.ts:39-64`）目前只返回 unknown[]，只检查 type/command 与 Office server.py 摘要；没有 recipe 或声明摘要。ext `policy/identity.ts:130-138` 的首方 evidenceDigest 也不含 environment/cwd | §4.3 的输出、清单项、摘要和严格环境/cwd 核验是 V2-R4 明确新增能力，不能声称已有 verified binding/recipe |
| V2-F08 | 本次 Bun CLI 使用真实 SDK Client/Server、InMemoryTransport.createLinkedPair、setRequestHandler 三参数重载、server.request 和 client.callTool 做嵌套请求；调用 _meta 回传后 ctx.mcpReq._meta 保持关联，原 call 返回成功，exit 0 | 证明私有方法/协议 metadata/原调用继续的 SDK 基础端口可用；没有 TCP、下载、解包或 Tool.Context metadata 接线，后者仍是新增能力 |
| V2-F09 | ext `policy/store.ts:34-49` 的 canonicalJson/canonicalJsonDigest 排序对象键、丢 undefined，后者返回 `sha256:<hex>`；core 不能反向依赖 ext 持久化模块 | 将这两个纯函数原样移入既有 util/hash 权威供 core/ext/main 共用；§4.3 明确命名输入及去前缀规则，不复制算法 |
| V2-F10 | core `mcp/index.ts:428-431` 允许无 workspaceID 的本地 client 跨 Location 池化；`mcp/client.ts:281-285` 仅捕获 initialize 的 Effect context | 准备进度须在每次工具调用登记时捕获当前上下文，不能借用初始化 Location，也无需取消池化 |

## 4. v2 接口契约

### 4.1 文档接收：平台、资产与只读 Node

**接纳 #1761 的合法 bootstrap 读取请求，平台范围遵守 §10 owner 澄清。** v1 §4.3 的 `LauncherEnvironment.platform` 保持原值域，以同一类型名供消费者引用：

```ts
type LauncherPlatform = "darwin-arm64" | "win32-x64"
// CodePuppyBootstrap 新增的同一字段（v1 R3a 的具体读取名）：
// launchers: LauncherEnvironment，其中 platform: LauncherPlatform。
```

Node/npm 继续消费 v1 的官方 26.13.1 / 11.20.0 及其两平台构建锁、签名与归档退路，不新增平台、资产条目或架构选择器；文档不带另一份 Node。

合法消费面增补为：DocumentHost 的 main/sidecar 环境投影器，以及其受管 ext 文档适配器。main 读取 composition root 构建/校验后传入的本代 bootstrap 对象；sidecar 与受管 ext 经既有 util `codepuppyBootstrap().launchers` **只读**取 platform/pinSet/node/npmCli/npxCli 资产描述，不让 main 在尚未 publish 的进程槽里读取。描述仍由主进程唯一构建，发布为每代一次。原生文档脚本继续只拿 DocumentEnvironment.node 和自己的 nodeModules，不注入 uv-tool/npm-exec 的 PATH、UV_PYTHON 或 XDG 覆盖。renderer/模型/第三方包不因此获得整份 bootstrap、函数发布或任意主进程调用权。

归档退路的 Node 入口在首次使用前须经同一资产 authority 展开，bootstrap 中的目标绝对路径不等于该文件已经 ready。决定给既有 ConnectorLaunchHost **增补** `resolveAssets(): Promise<LauncherEnvironment>`：按本代 bootstrap.platform/pinSet 解析并完成 v1 的随包展开/核验，返回与 bootstrap 描述一致的可执行入口；两类运行器准备和 DocumentHost.environment 都调用它。该端口没有 URL、命令、目标路径或平台覆盖输入，复用 v1 资产解析/展开，不下载另一份 Node；不序列化到 bootstrap。#1761 通过 DocumentHost.environment 把最终 node 字段交执行侧，无须重写它的环境权威。

### 4.2 L1 接收：固定文件准备与展开

**接纳视频 L1。** 接口名保持消费者请求的私有 MCP 方法 `codepuppy/pinned-files.ensure`，params 只含 ids；不新增下载器、包管理器或固定文件来源表。

```ts
type PinnedFilesEnsure = { ids: PinnedFileId[] }
type ManagedPinnedFilesResult =
  | { ok: true; files: { id: PinnedFileId; path: string }[] }
  | Extract<EnsurePinnedFileResult, { ok: false }>
type PinnedPreparationProgress = {
  id: PinnedFileId
  phase: "download" | "unpack" | "verify" | "ready" | "failed" | "cancelled"
  sequence: number
  receivedBytes?: number
  totalBytes?: number
  error?: Extract<EnsurePinnedFileResult, { ok: false }>["error"]
  failure?: DownloadFailureEvidence // 沿 v1 原始事实，避免把 404 当暂时 network
}
type ManagedFirstPartyBinding = {
  identity: LaunchIdentity
  sidecarGeneration: string
  entry: FirstPartyConfiguredEntry // 宿主附上的显式配置快照，定义见 §4.3；不从 MCP 接收
  declarationSha256: string       // 已核对的随包声明摘要，64 位小写 hex
  recipeSha256: string            // 同一声明中配方内容的摘要，64 位小写 hex
}
type PinnedFilesCallPreparation = {
  callID: Tool.CallID
  report: (update: PinnedPreparationProgress) => Promise<void> // 在本次调用的 Effect context 下已绑定
}
type PinnedEntryRecipe = {
  id: PinnedFileId
  archive: "file" | "zip" | "tar.gz" | "tar.bz2" | "tar.xz"
  entry: string                    // 根内相对文件/目录入口；不可为绝对路径或逃逸路径
  required: readonly string[]      // 必需的根内成员，至少包含 entry
}
```

ids 必填非空，无人为数量帽；同一次请求按首次出现顺序去重。全部 ID 必须已在当前 PinnedFiles 清单且属于这个受管服务的受保护配方，先验证整组再发生 I/O。配方只贡献 ID、归档形态、相对入口和必需成员，不含另一份版本、URL、bytes、摘要或绝对目标；这些仍读唯一清单/宿主根。配方字段与声明输出由 §4.3 定义，#233 D1 仅向同一受保护随包清单贡献视频条目；同一首方声明/解析权威持有，不能由连接器传入配方或 renderer 编辑。

main 的同一 launcher authority 拥有 `resolveAssets` 和固定文件的 resolve/unpack：每个 id 先调原 ensurePinnedFile、完整 bytes/sha256 验证后，在 `<runtimeRoot>/assets/<id>/<配方内容摘要>/` 的私有暂存兄弟目录展开；file 项将已验原始文件按配方 entry 相对名硬链接或复制到同一暂存根，保持字节不变。tar 三种压缩由同一平台 tar 适配（mac `/usr/bin/tar`、Windows 系统 `System32/tar.exe`），zip 沿 v1 的系统归档适配；不启动 Python、不执行包安装脚本，不借视频包的库自动下载。Windows 系统 tar 的存在/bsdtar 性质有 [Microsoft 文档](https://learn.microsoft.com/en-us/windows/tar/)依据，实际格式与 Windows 包全链路仍未实测。

展开维持已有路径边界：成员及软/硬链接的最终目标都留在暂存根内，保留合法内部链接和原二进制签名/执行位；不能为简化而把所有链接拒绝掉。验证配方的 required/entry 实际存在、类型和目标架构/已有签名要求匹配后原子发布 ready；成功的 path 是 recipe.entry 在该发布根内的真实绝对路径，既可以是可执行文件也可以是模型目录/原始数据文件。ID、原文件摘要、配方内容摘要、平台共同标识已准备结果；同 id/配方合并在途展开，不设过期或启动时刷新。签名/许可与具体归档成员事实由各资产 producer 提供，本文不虚构视频具体文件名或替代 L2 的接收。

私有桥保持 `codepuppy.pinned-file.ensure` 的 ID-only 输入。**决定增补** `entryFor?: ManagedFirstPartyBinding` 宿主附属字段：缺席时是 v1 的已验归档路径，存在时返回上述配方入口；这是本代合法的归档/入口两个消费域，不是旧版本迁移分支。binding 由已核验的 client 构造上下文附上，不来自 MCP params，main 按 §4.3 的新增声明输出与同一核验器重算并比较本代服务、清单和配方归属；targetPath 始终 main 派生。两种路径都走原 ensurePinnedFile 的按 id 合并、换源从 byte 0、校验与取消语义，不能再建一份 URL/回退表。

### 4.3 L1 的 client、调用归属、进度与取消

**声明者输出是本次明确 raise（V2-R4），不是已有返回值。** 在同一个 `core/mcp/codepuppy-first-party-mcp.ts` 扩展 `declaredFirstPartyTools`，成功返回下列对象，核验不匹配仍返回 undefined；`declaredListedTools` 从 `.tools` 投影，ext 的首方 authority 与 client 消费同一结果。清单位置继续由现有 bootstrap `paths.officeMcpManifest` 提供，名称不作为身份；同一随包产物的 `formats` 扩为下面的条目类型，Office 与视频均由这一解析器读取。把目前硬编码的 server.py/serverSha256 检查改为条目 codeSha256 的逐文件核验，不保留旧 schema 分支或第二个视频声明器。

```ts
type FirstPartyConfiguredEntry = {
  type: "local"
  command: readonly string[]
  environment?: Readonly<Record<string, string>>
  cwd?: string
}
type BundledFirstPartyDeclaration = {
  command: readonly string[]        // 沿用受信资源/workspace 命令模板
  environment: Readonly<Record<string, string>> // 必填；无显式变量写 {}
  cwd: string | null                // 必填；无显式 cwd 写 null
  codeSha256: Readonly<Record<string, string>> // resources 根内相对文件名 → 64 位小写 hex
  tools: readonly unknown[]
  recipe?: readonly PinnedEntryRecipe[] // 唯一形状为 §4.2；缺席表示没有固定文件能力
}
type Manifest = { formats: Record<string, BundledFirstPartyDeclaration> }
type DeclaredFirstParty = {
  tools: readonly unknown[]
  recipe?: readonly PinnedEntryRecipe[]
  declarationSha256: string         // 64 位小写 hex
  recipeSha256: string              // 64 位小写 hex；无配方也有确定摘要
}
// 同一声明者；现有参数位置不变，返回值由本增量替代。
declare function declaredFirstPartyTools(
  name: string,
  entry: unknown,
  manifestPath: string | undefined,
  readFile: (file: string) => Uint8Array,
): DeclaredFirstParty | undefined
```

codeSha256 非空，文件名规范为 resources 根内 POSIX 相对路径，不能绝对/逃逸；覆盖该条目实际服务代码及随包执行依赖，真实文件字节逐一匹配才返回声明。现有 Office 的 server.py 摘要由构建 producer 投影到同一 codeSha256；#233 的 D1 **只提供视频清单条目及其代码实物**，不能自行定义 recipe 字段、摘要算法、handler 权限或第二份清单解析。recipe 内 ID 唯一，路径规则沿 §4.2，缺席或空数组均不注册文件 handler。

**严格匹配的输入是显式配置，先于宿主继承环境、`resolveCwd` 的项目缺省和受信 launcher 覆盖。** 配置 environment 缺席规范成 `{}`，cwd 缺席规范成 null；command 沿用现有受信模板匹配；environment 的键集合和值、cwd 与声明中对应字面值逐字相等，不把命令的 workspace 匹配规则套到这两个字段，不能只比较子集或把额外变量清掉再认首方。cwd 未声明时只匹配未显式设置；配置增加/改变 cwd 或任一环境键（包括 NODE_OPTIONS、PYTHONPATH）即不产生首方声明/配方/handler，仍沿普通服务器路径运行与诊断，不新增用户操作。命令与 codeSha256 的核验继续同时成立；服务名或自报 `first-party:true` 无效。

两个摘要都调用现有 `canonicalJsonDigest`。将 ext `policy/store.ts:34-49` 的 canonicalJson/canonicalJsonDigest **原样移入既有 util/hash 模块作为唯一纯实现**，原 policy 持久化调用及 core/main 改为消费它，core 不 import ext/store。命名输入固定如下（`declaration` 是所选随包条目，模板未展开；对象键排序沿原函数，数组顺序保留）：

```ts
const recipeSha256 = canonicalJsonDigest({
  kind: "codepuppy-pinned-entry-recipe",
  recipe: declaration.recipe ?? [],
}).slice("sha256:".length)
const declarationSha256 = canonicalJsonDigest({
  kind: "codepuppy-bundled-mcp-declaration",
  command: declaration.command,
  environment: declaration.environment,
  cwd: declaration.cwd,
  codeSha256: declaration.codeSha256,
  tools: declaration.tools,
  recipeSha256,
}).slice("sha256:".length)
```

此处只剥离函数既有前缀，不再散列或截断 hex；类型固定为 local，因此声明输入无需重复类型字段。摘要覆盖受保护代码证据、工具、环境/cwd 与配方。ext `policy/identity.ts` 的 `codepuppy-bundled` evidenceDigest 也改为同一 canonicalJsonDigest 的 `{kind:"codepuppy-bundled-mcp", name, command:entry.command, environment:entry.environment ?? {}, cwd:entry.cwd ?? null, tools:declared.tools, declarationSha256:declared.declarationSha256, recipeSha256:declared.recipeSha256}`；其 McpEntry 视图须保留 environment 给同一核验器。普通第三方的去密绑定摘要规则不因此改变，不把不匹配的用户环境写入首方证据或日志。

`ManagedFirstPartyBinding` 由这个输出与当前 client/sidecar generation 构造，附带实际显式 entry 快照与现有 LaunchIdentity。entry 是 core 构造上下文内的宿主附属数据，不是 MCP params；main 在处理 entryFor 时，校验 generation/identity 后从**同一受保护 bootstrap 清单**调用同一声明者，以该显式 entry 重验命令、environment/cwd、codeSha256，重算上述两个摘要并逐一比较。不存在匹配声明、摘要不符、越代或 ID 不属该配方时不发生下载，返回现有失败联合的未知失败及原始诊断事实；不得只相信 sidecar 给出的摘要或从 server 自报配方取入口。§4.2 的 entryFor/prepareFiles 携带这一完整 binding，文件路径仍由 main 派生。

真实 tools/list 再经 listsDeclaration 核对，符合声明的实际工具才登记后述 call 关联值；声明被 refuted 的调用不获得关联值。因此 handler 可先注册，握手期间仍没有能启动下载的活跃调用。本次接纳范围是 #233 已获授权的受管视频服务；Office 及普通第三方没有该配方时不注册 handler、不宣告对应 experimental capability。不会因为能连接或工具名相同就获得文件准备能力。

在已有 `McpClient.connect` 的 initialize/client 构造处，**只对该绑定**调用 SDK 的三参数重载 `client.setRequestHandler("codepuppy/pinned-files.ensure", {params,result}, handler)`，使用上节严格业务 schema；协议 _meta 单独解析，下述关联键不成为业务参数。params 的业务字段只收 ids，不接受 URL、目标、配方或其它业务字段。非法 params/不属于配方的 ID 返回 SDK 的 InvalidParams，普通第三方该方法不存在；这是被请求的身份/参数边界，不增加用户批准或填写步骤。调用底层宿主端口为本次明确 raise：

```ts
// 增补到 v1 ConnectorLaunchHost；以下上下文由 core/sidecar 绑定，不经 MCP params。
prepareFiles(input: {
  binding: ManagedFirstPartyBinding
  ids: readonly PinnedFileId[]
}, signal: AbortSignal,
   progress: (update: PinnedPreparationProgress) => void): Promise<ManagedPinnedFilesResult>
```

它逐 id 调同一 ID-only main 桥（由 binding 取固定配方），不把 service 任意文本交 main 执行。`resolveAssets` 与 `prepareFiles` 均是既有 ConnectorLaunchHost 的增补方法；publish/get 权威和结构化克隆纪律不变。

使用同一 stdio 上的**普通自定义 JSON-RPC 请求**，不通过 SDK 的 input_required：core 仅为这个受管 client 的实际 tools/call 生成当前调用关联值，在协议 `_meta["codepuppy/pinned-files.call"]` 附上；连接器在处理该 call 时回传同一协议 _meta 值，以 `codepuppy/pinned-files.ensure` 请求 `{ids}` 并等待结果，然后在原 call 内继续处理。同一协议 _meta 还带 `codepuppy/pinned-files.deadline`（原调用已有 execution 预算派生的 UTC 毫秒绝对值，安全整数）；受管服务的嵌套 SDK request 使用原调用剩余预算和取消信号，不另落入 SDK 独立的短默认超时。关联值由 core 生成，关联当前 client、generation、callID 与本次 SDK 请求尝试的 signal，不从 server 名/sessionID 推断，也不是模型输入。它只关联已有调用，不参与放行/拒绝的身份判定，不能代替首方声明验证。

服务启动、initialize 和 tools/list 不请求模型；注册 handler/读取静态配方不启动下载。没有活跃 call 的协议关联值就不开始取文件，返回 SDK InvalidRequest；普通第三方不注册方法。连接成功后的冷下载只写工具 metadata，连接器保持 connected，不消耗握手 startup。execution 时限/工具取消继续归已有调用，不新增时钟，也不因 progress 重置它。

**调用接缝明确 raise**：core 的 `tool/mcp.ts` 取得 Tool.Context.id/sessionID、Location 与 progress，将 `preparation?: PinnedFilesCallPreparation` 这个内部可选字段逐层交 `Mcp.Service.callTool` → `McpClient.Connection.callTool` / PerRequest。在 `tool/mcp.ts` 的**本次工具调用登记**处捕获 `callContext = yield* Effect.context()`，将 report 绑定为 `update => Effect.runPromiseWith(callContext)(context.progress({ preparation: update }))`；该回调闭包携带当前 Location/工具调用的完整上下文，逐层传到池化 client。client 在 tools/call 的 SDK 请求开始时生成/登记上述关联值与已绑定 report；每次真正重发是独立关联值，结束便删除。handler 先从当前请求的 ctx.mcpReq._meta 取值，只查这个已核验 client 当前在途表，再使用原调用的 report；不能查全局“最后一次调用”或凭 server 传来的 sessionID 找会话。SDK 三参数 handler 的 schema 分离标准 _meta 后严格校验业务 ids；对本接缝新增的关联键只接受 core 生成的字符串形状，deadline 只接受已登记原调用的 UTC 毫秒值且不据回传值延长期限；不接受 URL/路径/能力选择；标准 MCP 元数据仍由 SDK 处理。

这里沿用已有 _meta 承载机制和 SDK 自定义 handler，不改 protocol codec/SDK patch。文件 handler 只调用在途表中**本次调用已绑定**的 report，不使用 initialize 的 Effect context；即使同一池化 client 先由 Location A 初始化、再接 Location B 的 call，B 的进度仍在 B 的调用上下文执行。保留现有池化规则；进度使用本调用内递增 sequence。metadata 中仅合并 preparation 字段，保留工具其它 metadata；结束时也与最终工具结果合并。没有 preparation 的普通调用保持原路径。

prepareFiles 将嵌套请求 signal、登记的原 call signal 与本代 client scope 关联；任一取消/停止只解除该调用的等待者并给 cancelled。客户端重连/请求完成/重试结束时撤销对应关联值，晚到请求/进度不能写入另一代或另一次调用；共享下载中的其它等待者继续，不能因一次取消破坏 ready。完成后原 server handler 在同一个 tools/call 中继续，无需重放已提交的用户副作用。

failed/cancelled 阶段在上述 metadata 中附同一 failure/error 事实；ready 不带错误，进度阶段不提前宣称成功。失败联合保持 EnsurePinnedFileResult 原样：传输 network 在调用进度/错误 metadata 复用既有 download 归因，磁盘为 disk，取消为 cancelled；404、解析/完整性等仍保留 v1 的具体证据/未知失败处理，不伪装成暂时网络。ready 前不返回半个入口，失败无需停止整个 MCP 服务。D5 云调用、上传、计费及 L2 family/source 接收均不属于本方法。

## 5. v2 数据与失败

没有数据迁移、兼容期或新用户配置。Node 描述/资产只一份；模型准备缓存由固定清单和受保护配方标识，下载/展开分别合并，失败不发布 ready。原生文档脚本保持 v1 R1 的环境范围；视频首次模型准备只影响发起的工具调用。新增调用关联仅为当前原调用/当前代的在途记录，结束即解除，不写权限或身份真源。

## 6. v2 架构与接缝映射

仍落在模块图的 ui-mac 宿主、core MCP、schema/util 纯数据边界（v1 §6）；不新增顶层包，不让 core/ext import main。K1 不变；K2 继续由 launcher、共享 downloader、首方声明、Tool.Context.progress 各自拥有本域，未新建 Node、下载器、身份表或包管理器。

| 本次能力 | 既有可调用符号 / 明确新增端口 |
| --- | --- |
| 两平台资产投影及签名 | 沿 v1 R1/R3a 的 LauncherEnvironment 与现有架构选择入口；**V2-R1 已按 owner 澄清撤回**，不扩 Mac 选择域或锁行 |
| 文档 bootstrap 读取与首次展开 | publishCodePuppyBootstrap/codepuppyBootstrap（util `:250,261`）、resourcesRoot（ext-fs-installer `:260`）；**V2-R2** 为 launchers 字段与 document 环境投影器/受管 ext 读取声明，新增 ConnectorLaunchHost.resolveAssets，沿 v1 的唯一资源展开 authority |
| 固定文件 ID 获取与入口准备 | v1 R2/R7、ensurePinnedFile 与已有归档 OS 命令；**V2-R3** 为同一桥的 entryFor、受保护配方/原子展开及 ConnectorLaunchHost.prepareFiles，未复制 download |
| 首方声明、身份与 handler | declaredFirstPartyTools/declaredListedTools/listsDeclaration（core `codepuppy-first-party-mcp.ts:46,87,129`）、ext `policy/identity.ts:130-138`；SDK setRequestHandler 自定义方法重载；**V2-R4** 增补 §4.3 的 Manifest/DeclaredFirstParty、显式 environment/cwd 核验与 binding.entry，main 同函数重算；将 store.ts:34-49 的纯摘要函数移入 util/hash 唯一实现；client 构造点消费新输出，#233 D1 仅供条目 |
| 原工具调用/metadata/取消 | Tool.Context.progress（schema/tool.ts:14-19）、client.ts:550-554 的 _meta 与 SDK ctx.mcpReq._meta；**V2-R5** 在已收编 tool/mcp.ts、mcp/index.ts、mcp/client.ts 传递 preparation report，在每次工具调用登记时捕获并绑定 Effect context/Location 与原始调用 scope。不改未收编 stdio、不新增 SDK patch/公开 Server API |

V2-R1 已撤回；V2-R2..R5 是设计决定 raise，不假称当前代码已经提供。签名、归档入口验证、包/模型格式、并发/取消元数据关联必须在真实入口取得可失败证据；本次没有运行应用或以文档核对代替这些证据。

## 8. v2 所有权与交接

| 产出方 | 本次产出 / 消费 | 设计输入 / 集成依赖 |
| --- | --- | --- |
| 本设计 / launcher authority | 现有两平台文档只读消费面；V2-R2 | #1761 引用文末 DOC-NODE-v2 接收回执及本提交；DocumentHost 实际执行仍为集成证据 |
| #1761 文档拥有者 | DocumentEnvironment/DocumentHost 读同一 node，制作包与 Office Python 继续由自己构建锁持有 | 只更新其 §1/§4.1/§4.8/§6/§8/§10 的受影响依赖，不重开其它 frozen 决定；按本轮冻结接收回执结束合法读取面的 pending-seam；撤去 Intel 依赖，不将其转成用户手装步骤 |
| 本设计 / launcher + MCP client | L1 handler、同一 ID-only main 桥及固定文件展开；V2-R3..R5 | #233 引用 VIDEO-L1-v2 接收回执与本提交；调用 metadata/取消、原子入口与真实 Windows 结果仍需集成 |
| #233 视频拥有者 | 按 §4.3 向同一随包清单提供视频代码/条目，实际 tools/call 中的私有 JSON-RPC 请求及准备后续处理 | 仅结束 L1 依赖的设计缺口；L2 未被本文接收，D5 沿其已定通道；具体 pin/许可/成员路径继续由资产 producer 提供 |

接受设计请求不扩大本次生产发布授权。视频合法条目的共享清单发布仍按 v1 §8 的 relay snapshot → 打包清单核对/HEAD probe → 应用发布次序；不在此改来源、版本发布或收费契约。

## 9. v2 回滚

不适用。无迁移或不可逆数据改变，没有兼容/回滚路径。

## 10. v2 裁决与接收回执

| 接收回执 | 请求与决定 | 消费者可引用的精确契约 / 状态 |
| --- | --- | --- |
| **DOC-NODE-v2** | **接受** #1761 在 darwin-arm64 / win32-x64 的合法 bootstrap 只读消费请求；复用同一 Node/npm，原生文档环境不套运行器覆盖 | v2 §4.1、§6 V2-R2。本次修订提交及此回执是修正后 frozen 契约；运行结果仍须实施举证 |
| **VIDEO-L1-v2** | **接受** #233 L1：受管第一方 client 的 codepuppy/pinned-files.ensure，只收 IDs，经同一 launcher resolve/unpack 与 main 桥；原工具 metadata 进度、取消及失败复用 | v2 §4.2/§4.3、§6 V2-R3..R5。修正后 frozen；包含声明输出/摘要/环境及 cwd 核验、逐调用上下文。只包含 L1；L2 与 D5 无授权扩展，尚非新 handler 已实现 |

**owner 平台澄清裁决（2026-11-26）**：协调仓 `docs/intents/discussions/INT-engineering.md` U-09 / I-37（本轮 brief 摘录），owner 原话：「就是我需要澄清，codepuppy 不发 intel 版本的mac 电脑的包，当前只发苹果芯片的mac，以及后续会发 windows 包。」据此撤回 `4d2b78d16b` 中的 Intel 接纳、对应 Node/uv/Python pin 与投影、Mac 选择域扩展（V2-R1）；DOC-NODE-v2 仅保留现有两平台的合法读取面。此为 owner 对产品平台范围的澄清，不是技术失败后增加用户手装步骤；本文不改消费者其它能力，也没有把尚未发布的 Windows 写成已发布。

### v2 R1 审查与修正冻结

独立审查输入为 `4d2b78d16b` 的 v2 增量，审计方 Claude Opus 5.5（只读），结论 FIX-THEN-MERGE。编排器本轮指令接受 1 Major、1 Minor 及身份加固，修正后冻结；未把 v1 的 R1 再计一轮。frontmatter 的 v2 receipt 为 `rounds=1`、`reviewed_sha=4d2b78d16b`、`verdict="fix-then-freeze; R1 1 Major 1 Minor + identity hardening accepted"`，status=frozen；v1 独立审查仍保留于 review.v1 和原 §10。

| finding / 适用范围 | 处置 | 最小修正与证据 | 未改项及去向 |
| --- | --- | --- | --- |
| R1-Major：V2-R4 依赖并不存在的声明/配方输出 | accepted and corrected | §4.3 定义同一 declaredFirstPartyTools 的 DeclaredFirstParty 返回值、同一 Manifest.formats 条目的 recipe/codeSha256、两个 canonicalJsonDigest 命名输入与去前缀规则；main 以 binding.entry 从同一清单重验并比较。当前缺口由 V2-F07/F09 的源码观察证实；§6 V2-R4 明确为新增能力 | #233 D1 只供应条目/代码，不能再另定配方 schema 或解析器；不宣称实现已存在 |
| R1-Minor：池化 client 的初始化 Location 污染准备进度 | accepted and corrected | §4.3/§6 V2-R5 在每次工具调用登记处捕获 Effect context，以已绑定 report 闭包逐层传入在途表；handler 不用 initialize context。源码 `index.ts:428-431` 与 `client.ts:281-285` 证明原假设不成立 | 保留既有池化，不新增连接或用户步骤；跨 Location 实际 metadata 仍需实施证据 |
| R1 身份加固：复制 bundled command 并注入环境/cwd 仍能获首方权限 | accepted and corrected | §4.3 同一声明器精确核对显式 environment/cwd，声明摘要与首方 authority evidenceDigest 一并绑定；main 重验。额外/改变的键或 cwd 仅使其沿普通服务器运行，不授 handler；NODE_OPTIONS/PYTHONPATH 不会被先清除后冒认。ext 当前 `identity.ts:136` 与 core `:52-54` 为缺口证据 | 普通第三方的去密绑定摘要及既有运行环境不变，无新用户可见限制 |
| owner 平台澄清 | adopted | 上述原话覆盖先前 Intel 推论，§4.1/§6/§8/接收回执均限现有两平台；移除全部额外资产行与投影 | 消费者撤销旧平台依赖，由其拥有者更新；不转化为安装步骤 |

**传播核对**：本轮用 `git show 279e9bf1c1:docs/specs/document-output-quality/design.md` 后 `rg -n 'bootstrap|LauncherEnvironment|darwin-x64'`，命中 `:19,27,70,76,126,240,376,408,430,432,435,454,482,483,491,504`；DOC-NODE-v2 回合法读取请求，owner 平台澄清撤回额外平台依赖及其 pin，消费者只更新受影响平台/接缝条款。视频以固定 `9f438a7bc8` 的 `rg -n 'declaredFirstPartyTools|D1|PinnedFilesEnsure|pending-seam: L1'` 核对，命中 `:61,68,143,292,381,393,403,423,464,476`：§4.1/§6 D1 旧“扩声明器属 D1”的归属由本文 §4.3/V2-R4 接管，D1 只供同一 manifest 条目；§4.2/§10 的 L1 依赖引用 VIDEO-L1-v2。没有把 L2/D5 写成已接收。消费者文档由各拥有者引用本次接收提交更新，本次不编辑其它仓或 worktree。

**作者核对回执**：Codex / GPT-6；依据是 v1 合入 `173122a8e9`、两个固定消费者请求、本轮 owner 原话与独立 R1 指令。声明输出、摘要算法、main 重验、环境/cwd、逐调用 report 及 bootstrap 读取都已映射到既有符号或具名 raise；两接收回执按本轮裁决修正后 frozen。未新增产品取舍或用户步骤。

**前轮小探针（沿用，未重跑）**：packages/core 的 Bun CLI 以真实 SDK Client/Server 和 InMemoryTransport 配对；父 tools/call 带本接缝协议关联键，server 在原 handler 内 await 私有 pinned-files.ensure 请求，client handler 从 ctx.mcpReq._meta 核对后回复，原调用继续返回。输出 `PASS: SDK 2.3.1 custom request, metadata correlation and original call continuation over InMemoryTransport`，exit 0。仅取固定 ID，不访问网络或文件资源；没有手编外部系统归档/协议替身。这不是本轮身份、摘要、下载、打包或跨 Location 进度接线的验收。

**文档验证回执**：本轮脚本核对 v1 正文（除版本适用说明）与 review.v1 逐字不变、v2 无额外平台资产行及旧待审状态、两项接收回执与 R1 receipt 一致。ui-mac 的 `bun test src/main/old-name-scan.test.ts` exit 0（10 pass / 0 fail，2347 assertions），`git diff --check` exit 0；官方文档检查函数对本文 0 finding，仓级 71 errors / 251 warnings 与前轮相同，为范围外既有结果，未顺修。只同步本设计的生成索引行；本轮没有运行应用或把新接口当成已实现。

**待 owner 定**：无。实际 Windows tar 格式、原始 archive 分支、公证、受管 MCP 的声明摘要/环境身份与跨 Location metadata、真实模型冷下载/取消仍未验证；这些是实施/集成证据，不能由本次冻结回执冒充通过。

# v2.1 增量｜第一方命令引用可信 Node

## 1. v2.1 基线与边界

继承 SPEC-connector-launchers v1（原 §1）及 v2 合入 `f7424aa45225a6d02d1958f4b4f72d247f99acc4` 的全部冻结决定；仅补 v2 §4.3/V2-R4 的 Node 命令模板约定和其启动依赖，支撑原 BR-01/03/06/11 与相关 AC，不改 AC、平台或环境作用域。输入是 #1775 D1 的 `31d4cacaf0`、`docs/specs/video-understanding/plan.md:111-113` 的 BLOCKED: design；本文是唯一新增技术决定，未实施。状态 **frozen**，独立审查尚未发生。

## 2. v2.1 地面真相

调查限于模板匹配与已定的两种 Node 形态。当前 `core/mcp/codepuppy-first-party-mcp.ts:27-38` 的 commandMatchesTemplate 只替换 resources，workspace 槽匹配任意无 `..` 的绝对路径；v1 §4.1 已允许资源树内 Node 或 userData 下的随包归档展开入口。v2 §4.1 的 resolveAssets 已决定统一展开/核验，但 §4.3 的声明者没有可引用该入口的槽，消费者不能自行补约定。

**本轮小探针**：临时目录内生成仅调用当前真实 commandMatchesTemplate 的 Bun 脚本，以 #1775 上述探针的同形入参分别比较资源树路径、归档路径、workspace 槽的 `/tmp/untrusted-node`；在 packages/core 执行 `bun <临时目录>/probe.ts`，输出 `{"direct":true,"archive":false,"workspaceSlotAlsoMatchesAnyAbsoluteExecutable":true}`，exit 0，临时目录随后自动清除。没有执行这些路径的程序、读写运行时或访问网络；结果仅证实现有匹配缺口，不是新契约实现通过。

## 4. v2.1 接口契约

### 4.1 保留槽与唯一展开器

受保护随包 Manifest.formats 中，引用启动器 Node 的 command 必须以完整 argv 首项 **`{codepuppyNode}`** 表示，例如 `["{codepuppyNode}", "{codepuppyResources}/video-mcp/server.js"]`；它不是用户 MCP 配置的新语法。该槽仅可独占 command[0]，不接受拼接、后缀、其它参数位置或以 workspace 槽充当可执行文件；这是随包声明 producer 的形状约定，普通用户命令仍按原路径运行。resources 槽和作为服务参数的 workspace 槽保留已有含义；environment/cwd 不解释此槽。

**明确 raise V21-R1**：在同一 core 自有 codepuppy-first-party-mcp 模块导出唯一纯展开函数，main 生成第一方显式配置和 matcher 核验均调用它，不各写替换逻辑：

```ts
declare function expandFirstPartyCommand(
  template: readonly string[],
  resources: string,
  launchers: LauncherEnvironment,
): string[]
declare function commandMatchesTemplate(
  template: readonly string[],
  command: readonly unknown[],
  resources: string,
  launchers: LauncherEnvironment,
): boolean
```

expandFirstPartyCommand 将首项的保留槽替换为 `launchers.node`，resources 按现有规则展开，workspace 参数槽留给现有 Location 接线；不做 I/O、PATH 查找或 shell 拼接。非法随包槽形状是清单/接线错误，交已有 unknown 诊断，不尝试另一个解释器。matcher 使用同一展开结果，对首项及其它非 workspace 项逐项、逐字比较；workspace 规则只用于参数，不能成为 Node 的后备匹配。v2 §4.3 的 declaredFirstPartyTools、declaredListedTools 各在现有参数末尾新增必填 `launchers: LauncherEnvironment`，内部传给同一 matcher；返回形状不变。

这里的 launchers **只能由宿主 composition root 绑定**：main 用自己构建并校验的本代 bootstrap.launchers，core/ext 用同一已发布 `codepuppyBootstrap().launchers`；不从 entry.environment、MCP params、workspace 文件或 binding.entry 读取 Node/launchers，也不新增可让调用者选择路径的平台参数。自动登记的 entry.command 是上述函数生成的绝对 argv，不把 `{codepuppyNode}` 原样交 spawn。资源树或归档哪一条路径合法由本构建产物清单与 pinSet/platform 唯一决定：只匹配该代 `LauncherEnvironment.node`，不以“位于 resources/userData 之下”放行另一条路径，不把两种形态同时当路径白名单。

### 4.2 身份、尚未 ready 与实际启动

v2 R1 的 type、command、environment 键和值、cwd 精确核验继续成立；不匹配仍是普通服务器，不清掉额外配置后冒认首方。main 在 entryFor 重验时从自己的同代 launchers 调用同一声明者；core 不能把自报 node/path 塞入 binding 来替换它。codeSha256 仍验证 resources 内的服务代码/依赖；Node 自身的 pin、签名与可执行完整性由唯一 launcher authority 的 resolveAssets 核验，不在每个服务清单复制 Node 摘要或要求 Node 位于 codeSha256 的 resources 树内。声明摘要仍散列原始模板（含槽），不加入展开绝对路径或 ready 状态；recipe 摘要规则不变。

bootstrap 的 node 是主进程按包内清单推导的确定绝对路径，归档尚未展开时也可供逐字比较，**不能以 exists/realpath 失败抹掉首方声明**。受保护服务代码、显式配置和摘要核验成功就保留 declaredFirstParty/首方 authority；其文件 handler 仍遵守 v2 的真实 tools/list 与活跃调用关联值约束，不因 Node 未就绪提前下载模型。

**明确 raise V21-R2**：McpConnection.make 在取得 DeclaredFirstParty 后，以已核验的 `entry.command[0] === 本代 launchers.node` 决定这项启动依赖，无需从声明输出猜原模板或让服务自报角色；在实际 spawn、获取 startPermits 和握手 startup 计时前，等待既有 `ConnectorLaunchHost.resolveAssets()`。需要准备的等待期间，core 经既有 changed/LaunchSnapshot 发布 `preparing`、`stage:"launcher"` 和活动进度，成功后进入原 connecting。返回的 node 必须与本代可信描述及已核验 argv 首项一致，再按 v1 的签名/完整性要求启动；不能悄悄改成 PATH 中的 node。尚未 ready 只触发同一随包资产展开/核验，不下载第二份 Node、不运行 npm，也不调用两类包运行器的 prepareConnectorLaunch 或把 PATH/UV_PYTHON/XDG 覆盖施于这个原生命令。取消/停用/越代按原 attempt 取消等待与状态，不能在晚到准备完成后 spawn；共享资产准备不因一个等待者取消破坏其它等待者。

## 5. v2.1 数据与失败

没有迁移或新用户配置。合法声明的身份与资产 ready 分开：准备失败保留其首方声明，启动按已有 ConnectorLaunchFailure/诊断和单一动作呈现；取消不报失败。已 ready 时同一 resolveAssets 复用本地已验资产、不发网络请求；准备不占握手时限，也不刷新原工具调用时限。DocumentHost.environment 继续走同一 resolveAssets 取得 Node，不新增文档专用准备路径。

## 6. v2.1 架构与接缝映射

| 本次能力 | 既有 authority / 本次明确 raise |
| --- | --- |
| 命令展开、身份及 main 复核 | commandMatchesTemplate/declaredFirstPartyTools/declaredListedTools（core `codepuppy-first-party-mcp.ts:27,46,84`）、ext `policy/identity.ts:130`；**V21-R1** 在同一模块增加展开器、可信 launchers 参数并接 main/core/ext；main 消费纯函数，不让 core import main |
| 原生首方启动前资产准备 | v2 V2-R2 的 ConnectorLaunchHost.resolveAssets、v1 的 McpConnection.make 与 changed/LaunchSnapshot；**V21-R2** 接首方 Node 的准备等待、状态及同代路径再核对，不改变两类包运行器作用域 |

K1/K2 不变：Node 路径、签名和准备由 launcher authority 持有；模板展开/身份仍是同一个首方声明器，没有额外路径表、下载器或包管理器。这两项是新增接线决定，当前代码和前述缺陷探针不证明其已实现。

## 8. v2.1 所有权与交接

#1760 提供本槽、同一声明器与正常资产准备接线；#1775 D1 仅向既定 Manifest 提供以该槽为首项的视频条目/代码，引用下述接收回执更新原阻塞，不自行扩 matcher。#1761 文档继续消费 DocumentEnvironment.node/原 DOC-NODE-v2；若构造受管第一方 Node 命令也引用本槽，不新增另一套路径派生。两消费者引用本次提交与接收回执；本轮不编辑其它设计或实现，发布/集成证明仍按 v1/v2。

## 9. v2.1 回滚

不适用。没有迁移或不可逆数据改变。

## 10. v2.1 裁决与接收回执

| 接收回执 | 决定与适用范围 | 依据 / 状态 |
| --- | --- | --- |
| **FIRST-PARTY-NODE-v2.1** | **接受** #1775 返回的 Node 模板接缝：保留槽 `{codepuppyNode}` 由本代宿主 launchers 唯一展开，精确匹配两种合法包形态中该代选定的 Node；冷资产保持首方身份并经正常 preparing 等待，随后才 spawn | v2.1 §4、§6 V21-R1/R2；与 VIDEO-L1-v2 / DOC-NODE-v2 一并引用。状态 frozen，尚无本增量独立审查；不声称运行集成已通过 |

**否决的替代**：以 workspace 槽借位会接受任意绝对可执行路径，已被真实 matcher 探针证伪；只把 Node 写成 resources 路径不能覆盖已批准归档形态；把准备前的缺文件当普通服务器会丢掉正确首方声明。三者均由本槽和单一准备 authority 取代，无新增用户步骤。

**传播核对**：固定 `31d4cacaf0` 的 `docs/specs/video-understanding/plan.md` 执行 `rg -n 'VIDEO-L1-v2|commandMatchesTemplate|SEAM-CHANGE-NEEDED'`，命中 `:19,30,75,111-113,137`，受影响的 D1 模板/身份假设由本回执补齐；协调仓视频设计 `9f438a7bc8` 的 `rg -n 'declaredFirstPartyTools|L1 的具体接纳|pending-seam: L1'` 命中 `:61,68,152,393,464,476`，其首方声明约定引用本文。当前基线文档设计 `docs/specs/document-output-quality/design.md` 的 `rg -n 'LauncherEnvironment.node|DOC-NODE-v2'` 命中 `:27,76,429,434,447,481,487,489,497,510`，保留同源 Node/准备读取，若引用模板则用本槽；不改文档自己的环境 authority。消费者拥有者更新固定输入，本次只改本文。

**作者回执**：Codex / GPT-6；依据为 v2 合入基线、#1775 固定阻塞证据与本轮真实匹配探针。新增能力全部映射至 V21-R1/R2；v1/v2 的独立审查收据分别保留于 review.v1/review.v2，本增量 review.rounds=0。待 owner 定：无。两平台真实归档展开、签名/公证、首方声明冷启动和准备取消仍未验证，归实施集成证明，不能从纯函数旧行为探针推断通过。

**本轮验证回执**：v1/v2 正文逐字保留核对通过（版本适用说明除外），当前增量状态及历史审查收据核对通过；ui-mac 的 `bun test src/main/old-name-scan.test.ts` exit 0（10 pass / 0 fail，2347 assertions），`git diff --check` exit 0。官方文档检查函数对本文 0 finding，仓级另有 69 errors / 253 warnings，均在本轮未改范围，不顺修；依本轮只提交 design.md 的指令未改索引或任何实现。新槽及真实启动行为仍未实施验证。

**v2.1 审查与编排器裁决（2026-11-26）**：独立审查 R1（Claude Opus 5.5，只读）结论 MERGE，1 Minor。处置：已写入配置的首方条目，其 command 首项（Node 路径）由开机对账用同一 `expandFirstPartyCommand` 重锚到本代 `launchers.node`，沿用 Office 的既有先例（`codepuppy-office-instance.ts:117-124` reanchorOfficeCommand；`ext-mcp-policy.ts:47-50`「Boot reconciliation owns migrating already-installed entries」）。这是应用自身条目随版本保持可用，不是旧版本兼容。实施注意：`ext/src/policy/identity.ts:136` 的 evidenceDigest 散列已展开的 command，Node pin 变化会使它变化，实施时确认没有按它持久化的状态因此失效。v2.1 状态：frozen。
