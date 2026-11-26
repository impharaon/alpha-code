---
id: DESIGN-connector-launchers
title: 连接器启动器与失败处理 技术设计
summary: 随包提供 uv 与官方 Node/npm，主进程校验固定文件，围栏内准备连接器环境；准备和握手分开计时，持久化可离线启动的入口，并统一失败原因与动作。
kind: tech-design
status: frozen
spec: SPEC-connector-launchers
spec_version: 1
review:
  rounds: 1
  reviewed_sha: ceeee7d4df
  verdict: "fix-then-merge; R1 5 Major 2 Minor accepted and corrected"
owners: [owner]
last_reviewed: 2026-11-26
---

# DESIGN-connector-launchers｜连接器启动器与失败处理 技术设计

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
