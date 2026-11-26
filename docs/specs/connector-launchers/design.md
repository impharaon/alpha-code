---
id: DESIGN-connector-launchers
title: 连接器启动器与失败处理 技术设计
summary: 随包提供 uv 与官方 Node/npm，主进程校验固定文件，围栏内准备连接器环境；准备和握手分开计时，持久化可离线启动的入口，并统一失败原因与动作。
kind: tech-design
status: draft
spec: SPEC-connector-launchers
spec_version: 1
review:
  rounds: 0
  reviewed_sha: ""
  verdict: ""
owners: [owner]
last_reviewed: 2026-11-26
---

# DESIGN-connector-launchers｜连接器启动器与失败处理 技术设计

本文为 #1760 的送审设计，尚未批准。规格的体验约定直接消费，不增加页面或设计稿；文件改动、实施顺序和具体用例归后续 plan.md。

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
| F-01 | 本工作树基线 `9f08c506d9842d319616c7e45c33d3b9c3279e48`。`server.ts:562-567` 只设 `UV_CACHE_DIR`，把随包 rg 追加到 PATH；`sidecar-env.ts:30-68` 透传 PATH、部分 Node 与 XDG 环境。下文无前缀的 main 路径均相对 `packages/ui-mac/src/main/`。 | 补全启动环境要有一个计算权威，不能由每个目录条目各设一遍。rg 的既有优先级不改。 |
| F-02 | `ext-ipc.ts:104-116` 的 `checkRuntime` 只调用 which/where；`platform/index.ts:22-41` 已有 `toolProbe`、`commandHeadBase`。 | uv/Node 类工具的就绪判定改读随包资产；其它程序仍经平台探测。不能因用户没装 uv 就阻止安装。 |
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

**已决定的退路：若上述正式签名/公证或正式产物的本机模块加载证明失败，构建改用原始压缩包随包带。** 原始 uv 与 Node/npm 压缩包连同钉住的摘要位于同一资源树的 `archives/`，由应用外层签名保护，运行时不下载启动器。main 在首次使用时验哈希，解到 `<userData>/connector-launchers/<pin-set>/<platform>/` 的临时兄弟目录，完成后原子改名；保留上游可执行签名，不在用户电脑重签或删除 quarantine。mac 用系统 `/usr/bin/tar` 解归档；Windows 若采用归档形态，用系统 PowerShell 的 `Expand-Archive -LiteralPath` 解 Node zip，uv zip 同理，不依赖开发工具。只取清单中的资源、目标和相对路径，解包不得越过目标根。主方案或退路由**构建产物清单**决定，不增用户配置/开关，也不在加载失败后悄悄运行另一份未知二进制。

退路是 spec 已允许的打包选择，不是已验证公证一定接受的结论。若两种形态都无法通过正式产物证明，受影响平台返回 `BLOCKED: packaging`；不能交付一个运行时要求用户关闭系统保护的包。

### 4.2 固定文件清单与下载

**共享契约直接引用协调仓的「国内连接性设计」§4.11.1、§4.11.4，提交 `6b0e4c005637919eed793a1aeb2cc87cdd14885b`。** 可用 `git show 6b0e4c005637919eed793a1aeb2cc87cdd14885b:docs/specs/domestic-cloud-connectivity/design.md` 在该仓读取；这是本设计消费的确定版本，仍待其规定的审查/批准，不冒称线上已具备。

- 唯一运行期清单是桌面宿主的 `packages/ui-mac/resources/pinned-files.json`，类型、字段、URL 校验与错误语义全部消费共享 `PinnedFiles` / `PinnedFileId`，本文不另定义 schema。所有字段包括精确 `bytes`、`sha256`、`version`、`originUrl`、`provenanceUrl` 都必填；家族和 target 枚举以共享契约为准，枚举本身不新增平台承诺。
- 唯一运行期下载口是共享 `ensurePinnedFile({ id, targetPath, signal?, onProgress? })`，结果为 `{ok:true,path,via:"cache"|"relay"|"origin"}` 或 `{ok:false,error:"unknown-file"|"network"|"integrity"|"disk"|"cancelled"}`。targetPath 仅由 main 的资源目录权威派生；sidecar / renderer 只传 ID，不能覆盖 URL、摘要或目标。
- 本票决定实现该**已决定 raise** 的宿主能力，core 通过 §4.7 ID-only 消息消费，不能跨层 import main。文件缓存为 `<userData>/pinned-files/<sha256>/<filename>`。下载函数只交文件，安装归各运行时消费者。
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

main 原样消费共享顺序：有效缓存 → 香港 → 相同 originUrl。连接、非成功 HTTP、断流、精确长度或摘要不符，在本轮自动改道；取消和磁盘错误不改道。香港已 302 到原地址时不循环回香港。连接器收到 network 失败可再发一次相同请求自动重试，再失败给「重试」；checksum/integrity 不当暂时网络错误循环。

共享端口的头等待 10 s、相邻正文静默 30 s 沿用 §4.11.4；没有整包总时限，200 KB/s 持续慢流不耗 MCP startup。Range/If-Range 续传、206 起点/总长校验、200 重下、坏 part 清理和最终 bytes+sha256 校验均消费共享语义，不另设计。无凭据请求，不附平台 token/cookie。宿主实现复用现有 `writeChunksChecked` 的哈希/part/fsync/finalizer 能力，`expectedSize=maxBytes=entry.bytes`、`expectedSha256=entry.sha256`，这个长度是文件身份而非人为容量帽；不使用带 token、同源或云配额的高层下载入口，不改其公共 API。重新读取缓存也验证 bytes+sha256；同摘要在途请求合并，单订阅取消不终止其它消费者。

后续文档和视频消费者各自贡献批准 entry，调用相同 `ensurePinnedFile`；本文不复制共享契约的它们各族来源、分发或安装决定。Node 的 nodejs.org 包只在构建取，本次不要求香港支持 Node。

### 4.3 启动环境的单一权威

main 从当前 `userDataPath`、`resourcesRoot()`、当前平台与 §4.1 资产清单产生一次 `LauncherEnvironment`，随 `CodePuppyBootstrap` 交 sidecar：

```ts
type LauncherEnvironment = {
  platform: "darwin-arm64" | "win32-x64"
  pinSet: string                 // 构建资产锁的摘要
  uv: string; uvx: string; node: string; npmCli: string; npxCli: string
  runtimeRoot: string            // 当前 userData 内的真实绝对根
  pythonFileId: PinnedFileId      // 同平台 Python entry；版本/build/摘要取共享清单
  environment: Record<string, string> // 下表派生值，不含业务密钥
}
```

所有路径必须为当前资产清单/userData 派生的绝对路径，值必填，无另一套默认版本；fileId 平台须匹配。扩展预检、core 的连接器启动和后续被授权的消费者都读它；不在 catalog、renderer、server 各写一套目录/版本。位置常量加入既有 `USER_DATA_LAYOUT` 权威。此表是计算结果，**不是用户设置表**。

| 环境项 | 类型 / 固定值或派生值 | 必填 / 读取入口 |
| --- | --- | --- |
| `UV_CACHE_DIR` | 绝对路径，`<userData>/connector-runtime/uv/cache` | Python 准备/启动必填 |
| `UV_PYTHON_INSTALL_DIR` | 绝对路径，同根 `uv/python` | Python 必填 |
| `UV_TOOL_DIR`、`UV_TOOL_BIN_DIR` | 绝对路径，同根 `uv/tools`、`uv/bin`；每个已准备环境有自己的子目录 | Python 必填 |
| `UV_PYTHON`、`UV_PYTHON_PREFERENCE`、`UV_PYTHON_CPYTHON_BUILD` | `"3.12.16"`、`"only-managed"`、`"20261124"`，版本/build 取 Python entry | Python 必填，不搜索系统 Python |
| `UV_PYTHON_INSTALL_BIN`、`UV_PYTHON_BIN_DIR` | `"false"`、同根 `uv/python-bin` | Python 必填，不写 shell 启动文件 |
| `UV_PYTHON_INSTALL_MIRROR` | `file://` 的本地镜像根 | Python 安装阶段必填 |
| `UV_PYTHON_DOWNLOADS` | `"manual"` | Python 必填，只在显式 `uv python install` 装 Python |
| `npm_config_cache`、`npm_config_prefix` | 绝对路径，同根 `npm/cache`、`npm/prefix` | npm 必填 |
| `npm_config_prefer_offline`、`npm_config_ignore_scripts`、`npm_config_update_notifier` | `"true"`、`"true"`、`"false"` | npm 必填；[npm exec 文档](https://docs.npmjs.com/cli/v11/commands/npm-exec/) 为语义依据 |
| `TMPDIR`、`TMP`、`TEMP` | 绝对路径，同根 `tmp` | 所有准备子进程必填 |
| `XDG_CACHE_HOME`、`XDG_DATA_HOME`、`XDG_CONFIG_HOME` | 绝对路径，同根 `cache`、`data`、`config` | 仅连接器子进程的通用缓存默认，不改 sidecar 引擎根 |
| `PATH` | 平台 delimiter：已准备包的 bin → 随包 uv/Node 的 bin → 钉住 Python 的 bin → 宿主原 PATH（含原有 rg 后备） | 连接器派生进程必填 |
| 出网代理变量 | 原有 `sidecarEgressProxyEnv` 的目的地与协议；仅该 attempt 附 §4.5 的归属标记 | 仍连同一策略代理，不改变放行判定 |

uv、uvx、node、npm、npx 的启动头无论 PATH 上有多少旧版本都映射到本构建的绝对入口；Windows 先经 `commandHeadBase` 识别 .exe/.cmd/.bat。npm/npx 用**随包 node 的绝对路径**加官方 npm/npx CLI JS，不执行用户的 .cmd 或 `/usr/bin/env node`。普通 MCP 程序不变；bunx/pnpx、Docker、git 不被假装成这两类启动器。

合并顺序：干净的宿主继承环境 → 连接器声明的业务环境/密钥 → 上表的应用控制项。只在启动器进程树清掉宿主 `NODE_OPTIONS`、`PYTHONHOME`、`PYTHONPATH`、`VIRTUAL_ENV` 这类会选错运行时的值；不改 main 的 process.env，不改 HOME，不改引擎自己的 XDG 根。声明的 registry、私有包认证、既有国内镜像与连接器密钥继续按原权威读取；缓存、运行时位置和安装脚本等控制项不能被同名旧工具配置反向覆盖。

### 4.4 准备、离线入口与计时

新增 core 自有的 `prepareConnectorLaunch`，在现有 `McpConnection.make` 的 local 启动路径、取得 `startPermits` 之前准备；完成后把结果交 `McpClient.connect` 的宿主私有 `prepared` 参数，local 分支再建立 `McpStdio` / `initialize`；Location 的 `Environment` 仍是所有包安装和服务进程的唯一执行面。main **只**下载固定文件或展开随包启动器，不能接受来自 sidecar 的任意安装命令在围栏外执行。

```ts
type PackageRunner = "uv-tool" | "npm-exec"
type LaunchIdentity = { directory: string; server: string; attempt: string }
type PreparedLaunch = {
  key: string                       // sha256(规范化输入，下述定义)
  command: [string, ...string[]]     // 可直接执行的绝对入口及参数
  cwd: string                       // 已解析的真实工作目录
  environment: Record<string, string>
}
// Effect，在调用者的 Location Environment + Scope 下执行，可中断。
// native 命令同样经过环境与诊断接线，包准备仅对两个 PackageRunner 执行。
declare function prepareConnectorLaunch(input: {
  identity: LaunchIdentity
  command: readonly [string, ...string[]]
  cwd: string
  environment: Record<string, string>
}): Effect.Effect<PreparedLaunch, ConnectorLaunchFailure, Environment.Service | Scope.Scope>
```

这里的 `Effect`、`Environment`、`Scope` 为仓内既有导出命名空间，执行需求由调用位置已有服务提供；没有新增 HTTP API 或用户 MCP 配置键。现有 `ConfigMCP` 仍是唯一配置 schema。

1. **Python**：main 取得 §4.2 的本平台 Python entry，把已验文件放到镜像根下的 `20261124/<官方文件名>`（同文件可硬链接或复制）。sidecar 依共享契约的 build 参数，用随包 `uv python install 3.12.16 --no-bin --mirror <file镜像>` 安装；uv 内建下载元数据必须与应用 pin 的版本、构建、文件和摘要相符。uv 再次验其内建摘要，不允许转向其它在线镜像。之后以 uv 的持久 tool 环境准备当前声明：`uvx` 与 `uv tool run` 等价；隐式 `tool@version`、显式 `--from`、extras、`--with`、源与解析选项转换为同一需求，`uv tool install` 放在该 launch key 的 `UV_TOOL_DIR` 下。保存它给出的真实 bin 路径；服务参数原样交服务，准备不调用服务、不发送 MCP 消息。解释包名/命令名和选项的适配是本次明确新增能力，不能只支持目录里的名字；不能把解析不了的合法声明归成「不支持第三方」。
2. **Node**：用随包 npm 的 npx 参数规则归一 `npx` / `npm exec`，包 spec、重复 `--package` 与 `--` 后的服务 argv 分开。解析在外部随包 node 进程使用 npm 的 `npm-package-arg`、`@npmcli/config` 与 bin 选择 `get-bin-from-manifest` 权威，不在 core/sidecar 内加载另一份 npm，也不手写另一套包名/版本选择。以相同包 spec、解析选项运行官方 npm exec，`--call` 暂换成应用自己的路径捕获程序；包安装成功后它报告实际 bin 与可执行路径，退出 0，**不启动服务**。原声明的服务 argv 或原有 `--call` 在准备完成后执行；后者仍使用平台既有 shell 语义，不能把用户文本拼入应用自己的捕获命令。npm 包管理不以 Bun 替代。
3. **持久就绪**：准备结果位于 `<userData>/connector-runtime/prepared/<key>/`。key 包括平台、启动器/运行时 pin、规范化包需求及解析选项、影响解析的配置、cwd 与环境文件内容指纹；不把密钥原值写入 key 或收据。服务参数与密钥在每次启动重新从当前定义绑定，不将解密后的整个 PreparedLaunch 写盘。收据只存 schema 版本、上述指纹、实际包版本、绝对入口/所需 bin、准备成功事实；环境目录和入口都存在才发布 ready。
4. **再启动**：命中有效收据后直接执行准备好的包入口，带同一份受控环境，完全跳过 npm/uv 的 registry 检查、latest 解析、Python 下载和后台更新。启动器的 prefer-offline 只是首次准备优化；AC-10 依赖的是这条无包解析路径。没有自动到期、TTL、启动时刷新或清缓存行为。声明改变或所需文件缺失只让对应 key 重新准备，不迁移旧记录、不要求用户操作。

完整 launcher 语法等价适配与持久入口捕获属于 §6 的 R3b raise，不是假称已有函数；必须保留原声明的执行语义和环境隔离。Windows 的 Python console/legacy scripts 入口按 uv 自己的 Scripts/bin 解析结果取得，npm bin 的 JS 用官方 node 执行，.exe 直接执行，声明本来就是 .cmd/.ps1 时用对应系统解释器，不引入 Bash 依赖。

**计时决定**：准备态没有 MCP 启动总时限，也不占握手许可；许可仍只由 `startPermits` 一个权威持有，准备后才取得、覆盖真实启动/握手/列工具。准备成功后才开始现有 30000 ms 握手默认值；用户显式声明的 startup 值在这个边界后使用。撤销本功能两类运行器的合成 300000 ms 首次下载补丁，不改变其它运行器、catalog 与 execution 时限。持续下载的 200 KB/s 慢流不会消耗握手预算。已准备连接器的自动启动不先排队等待其它连接器完成下载；仍保留既有启动并发权威，不新增并发上限。

### 4.5 状态、错误与单一呈现

为宿主增加以下**旁路详情契约**，不改公共 `Mcp.Status` 联合、Protocol 或 Server HttpApi。引擎原状态在准备/握手期间仍是 pending；详细状态由 core 生产，main 留存当前代快照，preload 传 renderer。键是 `(directory, server, sidecarGeneration, attempt)`；不能只用 server 名误配其它项目。

```ts
type PreparationProgress =
  | { unit: "bytes"; completed: number; total?: number }
  | { unit: "packages"; completed: number; total?: number }
  | { unit: "activity"; detail: string }
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

`classifyStartFailure` 继续拥有启动归因，扩展结构化证据输入；网络层仍消费现有分类。main 的包授权事实可补充 secret/auth 类型，但不以猜测覆盖明确的原始故障。renderer 只有一个 `connectorLaunchPresentation` 投影，返回原因、展开详情和**一个**动作；行与 watcher 都消费它，不再各写一张码表。

| 可信来源（按具体事实优先） | 原因 | 唯一动作及落点 |
| --- | --- | --- |
| main 固定文件失败、准备包的真实网络/registry 失败，已完成自动恢复尝试 | 下载没有完成 + 简短原因 | 重试：重启该 attempt，复用已验文件和有效缓存 |
| 本次请求的 `egressPolicyDenialOf`，或可归到本次目标的真实代理拒绝事实；普通 registry 403 不算 | 需要你批准联网 | 打开批准卡片：调用已有审批权威的显式重开端口；批准后自动重启该连接器 |
| `readPackageAuthorizationV1` / 连接器当前声明的必需密钥确实未保存 | 需要填写密钥 | 去填写：现有连接器密钥面 |
| 现有 needs_auth / MCP OAuth 事实 | 需要登录 | 去授权：该服务已有 authenticate 路径 |
| 已解析 cwd 不在；或 Git 连接器真实 git 仓库检查得到 not-git | 这个文件夹不存在 / 这个文件夹不是 Git 仓库 | 换文件夹：现有系统目录选择，重新绑定该连接器的工作目录后重启 |
| ENOENT 指明程序，或真实 stderr 明确缺少外部程序 | 需要先安装 {program} | 让助手处理：§4.6 |
| 退出、握手/协议错误、无法可靠分类的第三方报错 | 启动失败（可展开原文） | 让助手排查：§4.6 |

Git 特例的目的是避免系统 developer-tools 安装弹框：mac 上 `/usr/bin/git` / `/usr/bin/python3` 的存在不算「已安装可用」。对 Git 连接器先用不弹框的 `xcode-select -p` 与已解析的真实 git 位置判定可执行依赖，缺失就归 dependency；不要执行会唤起安装器的系统 stub。有 git 时才以它检查工作目录。Windows 用平台探测到的真实 git.exe。第三方声明缺什么以实际证据处理，不添加每插件环境名单。

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

main↔sidecar 消息扩展既有按 ID 请求/应答模式：`codepuppy.pinned-file.ensure`（`{id, fileId}`，只接受清单 ID）、`codepuppy.connector-launch.changed`（身份、代、sequence、状态）、`codepuppy.connector-launch.diagnostic`（身份引用的查询/回包），另承载 §4.5 的 egress begin/end/evidence。固定文件 reply 是共享 `EnsurePinnedFileResult`；无效字段/ID 不执行 I/O。请求均有终结回包；progress/changed/evidence 是通知，不等待应答；stop/进程退出中断对应请求，旧 generation 的回包不覆盖新状态。bootstrap 只增加已校验的启动器资产位置/pin/派生环境，函数端口由 sidecar 在启动引擎前注册；不把回调塞进结构化克隆文档。renderer↔main 的新增 preload 面为 `connectorLaunch.list(directory)`、`subscribe(listener)`、`retry(identity)`、`diagnostic(identity)`、`openNetworkApproval(identity)`、`chooseWorkspace(identity)`；只允许当前宿主已有的连接器身份，不接受任意命令/URL/文件路径。

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
  ensureFile(id: PinnedFileId, signal: AbortSignal, progress: (received: number, total: number) => void): Promise<EnsurePinnedFileResult>
  changed(snapshot: LaunchSnapshot): void
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

**AC-02 的可观察事实**必须来自打包后的安装/启用入口 → 配置汇合 → `McpConnection.make` 的 prepare → `McpClient.connect` → 该代 `Environment.spawner`，而非独立运行脚本。记录真实 userData、resolved argv/运行时版本、三项 UV 根、npm cache、TMP/XDG、fence build ID/profile 摘要与实际写盘差量。Mac 使用真实继承 fence 的 utilityProcess 和真实策略代理；干净账户的 HOME 前后差量只允许 app data 内的启动器写入，不能把 `~/.npm`、用户项目或系统 temp 在围栏中可写当成符合 BR-03。对照臂以 F-01 的真实旧入参复现缺陷：UV_CACHE_DIR 仍在 app data，UV_PYTHON_INSTALL_DIR 未设，XDG_DATA_HOME 取原宿主继承值而非新的 app data 默认（否则它也会把 Python 留在 app data，成为无效反例）；同一入口必须在 HOME 内、app data 之外的 Python 默认位置得到 Operation not permitted；另一个受限路径写入必须实际失败，防止跑成无围栏对照。不能用更严的 pilot profile 代替真实入口。

**AC-10 的可观察事实**是五个已准备环境跨**应用进程退出/重启**仍可直接执行，网络在重启前即不可用；从真实连接调度到 connected 的每个连接器墙钟 ≤10 s。首次启动时的 SHA/准备收据与重启时的 key、最终 argv、未进入解析/下载阶段可关联；同时观察所有真实出网尝试，避免把超时或缓存 mock 当离线。去掉持久入口、改回默认包运行器的同一入口必须失去离线路径或超过预算，判据才有能力失败。200 KB/s 下的 preparing 状态和两个问题入口的同步性也由此状态流观察，不用伪造延时替代实际包下载。

Windows 以相同入口记录路径差量、准备收据和离线时钟，覆盖无开发工具及本机模块；按已批准的平台边界记录 `fenced=false`。AC-09 中的目录收纳结论可以成立，但「Windows 真围栏已证明」不能成立。如果 AC-09 被解释为新增 Windows OS 围栏，必须回 spec 澄清，不能由本票暗造一套 Windows sandbox。

## 5. 数据与失败

- **边界**：main 拥有固定文件下载与随包归档展开；包解析、包构建/安装、Python 安装与连接器进程均在已有 Location 执行面内。服务在握手后联网与下载工具自身业务资产仍受原规则约束，不能经固定文件下载器代下任意 URL。
- **发布**：固定文件只在 SHA 匹配、fsync 后 rename；准备收据只在安装全部成功且入口实际存在后原子发布。崩溃留下 part/未发布目录，下次只复用已验的完整内容，不把「目录存在」当 ready。收据不是安全授权，仍经现有配置/包信任读取；进程树不能凭它提升权限。
- **幂等与并发**：固定文件按摘要合并，准备按 key 合并；同包的不同解析选项互不覆盖。每个连接器 attempt 独立订阅进度。连接器重试不抹掉有效 Python、其它环境或已有缓存，不要求用户清目录。
- **自动恢复**：随包入口替代缺失/旧本机工具；固定文件换源；包准备的暂时网络错误自动重试一次。密钥缺失、授权拒绝、缺程序、非仓库和协议错误不做无意义自动循环；立即保留事实与唯一动作。取消不自动重启。已准备入口崩溃不会自动删包再联网，只有证据表明环境缺文件才重新准备。
- **故障窗口**：HK 字节错误不会进入 uv；origin 也验不过归共享 integrity，再投影为 download；磁盘失败可展开原 errno，重试仍使用相同根；进程未启动和启动后退出用 null/真实退出码区分。准备进度不因 main 的普通 RPC 超时转成 failed；取消和真实传输故障才终结请求。
- **离线语义**：BR-11 只承诺启动不因包解析联网变慢，不伪造连接器的远端业务服务可离线。已准备包按声明变更重算 key，没有后台自动升级或兼容期。

## 6. 架构落点

位置按 [模块图](../../architecture/modules.md) 中 ui-mac、core、schema/util 与 ext 的现有责任落置；这里是责任映射，不是改动文件清单。

| 责任 | 模块与依赖 | 复用的权威 / 架构结论 |
| --- | --- | --- |
| 资产、下载、平台路径、审批和快照 IPC | ui-mac main；只消费 schema/util 与 Electron/OS | `resourcesRoot()`、`USER_DATA_LAYOUT`、`writeChunksChecked`、现有网络审批。K2 收敛，不复制环境和文件校验。 |
| 启动前准备、执行观察与归因 | core 的自有 MCP 模块，现有已收编 client/connection/index 调用；core 不依赖 ui-mac/main 或 ext | 既有 `Environment.Service`、`classifyStartFailure`、`startPermits`。固定文件请求通过 util 的进程内端口，不引入 Server 反向依赖。 |
| 跨 bundle 值与窄消息 | 自有 schema/util 的纯数据与进程内端口；main、sidecar、core 消费 | `CodePuppyBootstrap` 的构建/解析/发布权威，sidecar 的 parentPort 模式。没有新增顶层包或目录模块，不需改模块图。 |
| 状态原因/动作与新对话 | ui-mac renderer，preload 公开面与现有 SDK 适配器 | 一个呈现投影，复用行、RowStatus、problems 和 startChat；renderer 不导入 main 私有实现。K2 的既有状态子串偏离不扩散到新联合。 |

### 接缝总表（已有或本设计决定 raise）

R 表示本设计已经选定、需要实现的能力及签名/语义，不表示现有 API；其范围均在本票 AC 内。实施不得用同名未定义绑定或用主进程任意执行来替代。

| 依赖能力 | 可合法调用的已有符号 / 决定的 raise |
| --- | --- |
| 资源路径、环境分区与平台识别 | `resourcesRoot`（`ext-fs-installer.ts:260`）；`USER_DATA_LAYOUT`（`user-data-layout.ts:4`）；`commandHeadBase`（`platform/index.ts:39`）；bootstrap `paths.userData`（`packages/util/src/codepuppy-bootstrap.ts:18-20`） |
| 定向签名 | `CustomMacSign` + 当前 signer `sign(opts)` / `optionsForFile`（F-04、本地包代码坐标）；**R1**：§4.1 的按精确 Node 路径覆盖，不增加全局 entitlement；归档消费同样由 main 资产解析权威负责 |
| 固定文件获取与流式校验 | `writeChunksChecked`（`codepuppy-artifact-download.ts:299`）；**R2**：实现共享 `6b0e4c0` §4.11 的 `readPinnedFiles(): PinnedFiles`、`ensurePinnedFile` 与 §4.7 ID-only 消息；main 获取公共响应，受控本地镜像交 uv，不开 HTTP 服务 |
| 环境计算与传递 | `buildCodePuppyBootstrap`（`codepuppy-bootstrap-build.ts:62`）、`publishCodePuppyBootstrap`（util `:250`）；**R3a**：§4.3 `LauncherEnvironment` 与唯一构建函数、解析器扩展；server/预检/启动共同消费 |
| 包准备和持久入口 | 当前 CLI `uv python install`、`uv tool install`；官方 npm `libnpmexec`、`npm-package-arg`、`get-bin-from-manifest`；**R3b**：§4.4 `prepareConnectorLaunch` 及 runner 语法适配、收据，在 `McpConnection.make`（`connection.ts:165-203`）取启动许可前准备，`McpClient.connect`（`client.ts:357`）消费其 `prepared` 参数 |
| 围栏内执行、终止、捕获完整 stderr/exit | `Environment.Service.spawner.spawn` 和 ChildProcessHandle（`stdio.ts:109-129` 使用的同一服务）；**R4**：仅此 MCP attempt 的 spawner 装饰器，tee 保留原语义，§4.6 诊断；不改未收编 stdio |
| 机器归因与主界面原因/动作 | `classifyStartFailure`（`codepuppy-startup.ts:51`）、`egressPolicyDenialOf`（shared `:43`）、`readPackageAuthorizationV1`（`package-admission.ts:468`）；**R5**：§4.5 的结构化详情、begin/end/evidence 归属端口、唯一呈现投影；普通错误仍走既有简短错误面 |
| 用户重开网络审批 | `askUserForEgressGrant`（`egress-approval-dialog.ts:19`）、`requestUserEgressGrant`（`:204`）；**R6**：`reopenUserEgressGrant(host, port): Promise<EgressGrantOutcome>`，用户点击时清除该目的地拒绝记忆/聚焦在途询问，再走原权威；自动请求不能调用它 |
| 快照、重试和诊断窄 IPC | sidecar `parentPort`（`sidecar.ts:128-145`）、server 的 `postCodePuppy`（`:780`）；**R7**：§4.7 消息/preload 面。重试仍调用既有 SDK `mcp.connect({name})` 并经相同 prepare 路径，不另造服务进程入口 |
| 缺密钥/登录、换目录 | `readPackageAuthorizationV1` / `savePackageSecretsV1`（`package-admission.ts:468,519`）、SDK `mcp.auth.authenticate`（watcher `:87`）、preload `openDirectoryPicker`（`preload/types.ts:742`）、`persistMcp`（`ext-config.ts:470`）与现有项目选择；**R8**：§4.5 action 接线及 `chooseWorkspace(identity)`，只按当前定义/作用域变更目录，不在 renderer 拼配置 |
| 助手新对话与自动首条发送 | `CodePuppyProjectsApi.startChat`（`use-projects.ts:88,447`），已有 `extraParts`、回执与重试 ID；**R9**：§4.6 构造诊断首条消息/文件 part 和导航，不改发送代际 |
| 真围栏与真实入口观察 | `planProcessFence`（`process-fence-plan.ts:229`）、`applyProcessFence`（`process-fence-apply.ts:86`）、sidecar `installProcessFence`（`:270`）；**R10**：§4.7 的本次身份、阶段、收据与解析入口可观察信息，经真实已有打包入口留证，不用替身冒充 |

K1 不涉及权限档位变更；K2 在环境、下载校验、归因与 UI 投影均保持一个权威。ADR-037 的会话代际边界不动。没有必要架构例外；实现若发现接缝需要未收编上游修改，应返回 `BLOCKED: design`，不能扩大收编。

**安全边界**：第三方包/服务是不可信执行内容，继承现有文件、密钥、联网围栏。main 的新增下载权只接受内建 ID，不能由包改为任意 URL/命令。Node 的 library validation 放宽只影响独立第三方运行时进程，不影响 Electron 的加载边界。准备路径与诊断路径以当前 userData 真实根为边界；不通过软链把缓存移到根外。权限批准和包信任仍由既有权威判定。

**否决的替代**：把启动器追加到 PATH（旧版本会胜出）；共享 Office Python（F-04 的本机模块限制）；只设 prefer-offline（缓存缺失/解析仍可联网，不能证明 AC-10）；一律调大握手时限（BR-06 仍失败）；main 代装任意包（绕过围栏）；本地 HTTP Python 镜像（N4 不允许另一个 loopback 端口，file 镜像已有实证）；在 renderer 解析 stderr（丢失完整原文且形成第二归因权威）。

## 8. 拆分决定

仅有香港入口这个跨仓所有权边界，不把同仓准备、UI 或打包顺序拆成工作单元。

| 产出方 / 责任 | 产出与 AC / 小节 | 消费的契约 | 开工依赖 | 集成/验收依赖 |
| --- | --- | --- | --- | --- |
| 协调仓「国内连接性设计·切片四」的设计拥有者；入口维护方实现 | Python 固定文件 allowlist、URL 路径及转发规则；AC-03 / §4.2 | 本文 Python entry 的原始发行路径、文件名含 `+`、两平台摘要 | 已批准国内连接性规格；此处的消费形状 | 共享设计 `6b0e4c005637919eed793a1aeb2cc87cdd14885b` 的批准及入口实际放行；AC-03 的国内节点和 owner 本机观测 |
| 本仓桌面宿主 | 随包启动器、固定文件消费、准备/诊断/UI；AC-01..AC-10 | §4.1..4.7 | 本规格 v1 与本设计批准；无需等远端上线才能实现本地消费 | 香港入口真实契约与部署；正式签名、公证、平台实机证据 |

本文不拥有服务器 allowlist 或运维配置。后续 #1761 与视频需求消费 §4.2 的同一固定文件机制，独立增加自己的批准条目；不是本票的开工依赖，也不在这里设计其下载内容。

## 9. 回滚

不适用。没有数据迁移或不可逆数据改变；不引入兼容期、旧版本启动路径或回滚机制。§4.1 的归档形态是同一构建能力的打包退路，不是上线后的版本回滚方案。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| 默认展开随包、Node 定向签名；正式证据失败时选原始归档随包解到 app data | spec v1 待决、F-03..F-05；权限组合已做 ad-hoc 验证，正式分发仍未验证 |
| main 的固定文件下载与围栏内包准备分权；Python 精确钉 3.12.16 / 20261124，用 file 镜像 | F-05、F-10、F-12；不依赖 uv 自动换源 |
| 受控环境只有一个 main 权威；连接器使用随包入口优先、运行时/缓存均 app data | BR-03、BR-05、P-05；不改全应用 shell 的工具优先级 |
| 准备无握手总时限；握手后段沿用原默认或显式配置 | BR-06、F-07；phase 与 progress 为真实活动，不造百分比 |
| 准备时解析，重启时直接执行持久入口 | BR-11、F-06；npx 捕获边界探针 exit 0；完整 runner 等价适配尚待实施证明 |
| 分类从事实源做一次，行与问题入口消费同一投影；未知失败可新对话排查 | BR-08、BR-09、F-08、F-09、F-13；报错遮密后带完整命令/退出事实 |
| Windows 的启动器/环境/诊断/离线行为同构，围栏边界沿用已批准平台说明 | BR-10、F-11；未把 Windows 目录比对冒称为 OS 围栏 |
| 所有缺失端口为 R1..R10 的决定 raise；无未指名的后台准备器/事件/助手入口 | §6 seam map；不引入上游新收编或引擎代际切换 |

| 轮 / 版本与范围 | 审计方 | finding 及处置 | 改了什么 / 验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| 作者自查，基线 `9f08c506d9842d319616c7e45c33d3b9c3279e48`、规格 v1，本文全部 | Codex / GPT-6 | 作者自查完成，不计对抗审查轮次；draft 待规定的 L 设计审查与 owner 批准 | BR/AC 覆盖、事实/推断分离、接缝映射、范围与保护资产核对；临时 npm 边界探针 exit 0；ui-mac 的 `bun test src/main/old-name-scan.test.ts` exit 0（10 pass）；文档检查器对新设计无 finding，整体既有问题见留档；`git diff --check` exit 0 | 正式签名/公证、Windows、真实入口 AC 证据、uv 代理归属标记与完整 CLI 等价适配归实施验证；香港契约批准/部署归 §8 |

**待 owner 定**：没有新增产品取舍或限制提案；本 L 设计本身仍需批准。若 owner 要求 Windows 具备 OS 强制围栏，和现有批准规格的平台边界冲突，需另行澄清范围；本文不替 owner 作该决定。

**留档**

| 提议 / 观察 | 实际影响或未核实点 | 为什么现在不做 | 什么情况再看 |
| --- | --- | --- | --- |
| 当前生成文档索引在写本文前已 stale；文档合同检查基线有既有错误与警告 | 基线 `docs_index.py --check` 非零；官方 `check_repo(..., changed_since="origin/alpha")` 为 69 errors / 252 warnings。新设计无 finding；因只加生成的本设计索引行，索引原有两个未解析跨仓 ID 从 warning 升为 changed-file error，现为 71 / 250，另仍有原 stale | 只保留生成器产出的本设计行；不顺带收进全量索引漂移，也不清理旁支文档/保护资产。依据为既有 Alpha Delivery profile 对当前工作树调用同一官方检查函数 | 既有索引 stale 及两项引用告知调度方，本设计未新增无效引用 |
| 应用之外的实际国内下载、Windows、正式公证事实 | 当前证据未覆盖，不能以 pilot 替代 | 本次禁止启动 GUI、正式分发与联网下载包；这里只读公开文档/元数据 | 实施与平台验收取得真实证据，按受影响条款更新回执 |
