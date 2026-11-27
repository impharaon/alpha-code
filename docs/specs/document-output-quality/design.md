---
id: DESIGN-document-output-quality
title: 助手文档与设计成品质量 技术设计
summary: 固定引入 Anthropic 技能并适配随包运行环境，以 LibreOffice、PDFium 和内置 Chromium 生成自检图；复用固定文件下载与云端识图，归并 Excel 操作，保留中文模板和离线成品。
kind: tech-design
status: frozen
spec: SPEC-document-output-quality
spec_version: 1
review:
  rounds: 1
  reviewed_sha: d07c5aa8a8
  verdict: "fix-then-freeze; R1 4 Major 4 Minor accepted and corrected"
owners: [owner]
last_reviewed: 2026-11-27
---

# DESIGN-document-output-quality｜助手文档与设计成品质量 技术设计

本文采纳独立审查 R1，修正后冻结；按 §10 的 owner 平台范围澄清，仅覆盖 darwin-arm64 与 win32-x64，全部条款冻结。只决定契约、责任和取舍；不包含改动文件清单、实施步骤或测试清单。消费规格中的既有工具卡片与文件预览，不新增页面或绘制体验稿。

## 1. 基线

- 批准输入：[SPEC-document-output-quality v1](spec.md)，提交 `31cd182e09710b603721c6f44d471b01289dd951`。固定版本读取命令为 `git show 31cd182e09710b603721c6f44d471b01289dd951:docs/specs/document-output-quality/spec.md`；覆盖 BR-01..BR-15、AC-01..AC-15。继承其 U-12 批准回执，不重新判断需求是否成立。
- 代码基线：`9f08c506d9842d319616c7e45c33d3b9c3279e48`。本文以下 main 路径简写相对 `packages/ui-mac/src/main/`，资源路径相对 `packages/ui-mac/resources/`。
- 背景：协调仓 `docs/intents/discussions/INT-office.md`，读取版本 `86a58c7bbdaad8b7c689d1c9c2845e3ce16db2a9`，重点为 P-01、P-03、P-05、2026-11-25 三次试验及 U-12。本机原始证据根简称 `pilot/`：`~/.cache/alpha-orch/2026-11-25/office-pilot/`；它只定位证据，不是产品默认路径。
- 固定下载机制：直接消费协调仓 `docs/specs/domestic-cloud-connectivity/design.md`「切片四」§4.11、§10 冻结回执，读取版本同上；继承 R1 `6b0e4c0` 的处置，不另定清单、镜像、续传或回退规则。
- 启动器输入：#1760 的 `docs/specs/connector-launchers/design.md`，固定合入提交 `173122a8e955f97d830fe53fccd3400d079d9488`（#1766），status=frozen，继承其 R1 处置。本文按要求执行 `git fetch -q origin && git show origin/alpha:docs/specs/connector-launchers/design.md`（exit 0），未合并 origin/alpha；消费其 §4.1..4.3、§4.5、§4.7。该版本 `:104` 的 platform 为 darwin-arm64 / win32-x64，与本设计范围一致；文档消费者的 bootstrap 读取面保留本次交接确认由启动器设计接受的 `DOC-NODE-v2`。冻结是决定的状态，不是实现完成证明。
- AC-01..AC-03 的分数仍归规格及已授权的默认模型实测。本文不改变分数、不进行付费调用，也不以强模型试验成绩证明默认模型能力。
- r5 增量（#1761 围栏内 LibreOffice）代码基线：`origin/alpha` `813ca7a98c`；只改 §2 F-21..F-23、§4.3/§4.9 各一句、新增 §4.11、§5 一条、§6 R14 及 §10；网络围栏权威 [`2026-09-10-network-egress-on-process-fence.md`](../../architecture/2026-09-10-network-egress-on-process-fence.md)「落地」表强制层一行同步。
- 文档影响为 feature decision；唯一落点是本文与必要的生成索引行。ADR-014 第 5 条的后续修订属于实现批准后的同项决定传播，本文不修改受保护规则资产。

## 2. 地面真相

调查只回答五个问题：可分发哪些技能与附带内容；两平台靠什么渲染与找中文字体；首次下载如何不挡住生成；模型如何实际看到每页；Excel 哪些缺口需要工具。已有权威或决定的新增端口足以承接后即停止。

| 编号 | 观察及证据 | 决定所依赖的结论 |
| --- | --- | --- |
| F-01 | `office-mcp/server.py:127-275,290-295` 暴露四对 reader/writer；`:348`、`:614`、`:658`、`:691` 的 writer 只覆盖基础结构；`:600-610` 用 `data_only=False` 读取 Excel。 | 不能靠扩充原四个 writer 的字段实现成熟生成；Excel 的 computed value 要单独补齐。 |
| F-02 | `office-runtime/requirements.in:1-5` 已有 python-docx 1.2.0、openpyxl 3.1.5、python-pptx 1.0.2、pypdf 6.16.1、reportlab 5.0.0；`scripts/build-office-runtime.ts:21-22,38-57` 仅提供 mac 构建；`ext-mcp-policy.ts:66-72,86-94` 写死 `bin/python3`。 | Python 原有打包权威继续拥有文档库；Windows 解释器、轮子和路径是本票明确新增能力。不能宣称 Windows 现成可用。 |
| F-03 | `pilot/E-skills/repo` 的 HEAD 为 `e4bb5d960d87126ff3b3a8af1a104b7db67560ba`。docx/xlsx/pptx/pdf/frontend-design/canvas-design/theme-factory 各自 `LICENSE.txt:1-4` 为 Apache-2.0。[固定提交许可证](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/docx/LICENSE.txt)。docx、xlsx、pptx 各带 `scripts/office/schemas/`，包括 ISO-IEC29500-4_2016、ecma、microsoft、mce 的外部 XSD，没有相应独立许可说明。 | 技能代码与标准定义必须分开判定；不能从目录的 Apache 许可证推定第三方标准的再分发权。 |
| F-04 | 同提交 docx `SKILL.md:13-21,36-45,90-92` 采用 npm docx，假设预装、pandoc/Poppler；pptx `SKILL.md:13,155-160` 采用 PptxGenJS，字体建议偏向 Office 西文字体；xlsx `scripts/recalc.py:29,47-50,62-80,172-196` 依赖 PATH、宏和系统 timeout/gtimeout。 | 不能原封不动交给模型执行；保留制作知识，替换运行入口、渲染、重算和字体指导。 |
| F-05 | `pilot/E-skills/node/package-lock.json` 钉 docx 9.16.0、pptxgenjs 4.0.1；真实 npm lock 带 integrity。canvas-fonts 有逐家 OFL 文本，但 IBM Plex Serif 文件没有同名许可文本；本文未逐个核清字体与许可的对应关系。 | 只带需要的 npm 闭包；上游字体包不整体搬入，中文字体另取有清晰来源的 OFL 字体。 |
| F-06 | 继承试验：讨论记录 `:125-140,186-220`，Word/PPT 技能路径 10/10、11/11，Excel 一轮修改后满足样例；普通机器上的 LibreOffice 字体替代会逐字混用。`pilot/E-libreoffice/bin/soffice:4-6` 设 FONTCONFIG_FILE 和独立 UserInstallation；`fonts.conf:3-7` 指向 mac 系统字体与私有缓存。 | 这个字体配置证明“能找到系统字体”，没有证明稳定中文替代；本票补确定的中文字体与替代表。试验不等于 Windows 或产品正式包证明。 |
| F-07 | pilot 的 LibreOffice `Contents/Info.plist:1975-1978` 为 26.8.3.1；本次 Python 文件遍历得展开文件总长 805,867,141 B（不重复计 symlink）。既有官方 `.mirrorlist` 元数据读取命令 exit 0，当前两个目标的 size/SHA-256 结果见 §4.3。未下载二进制。 | 版本固定 26.8.3（内部构建 26.8.3.1）；规格约 300 MB/800 MB 是量级，Windows 下载约 376 MB，不能把两个目标都写成恰好 300 MB。 |
| F-08 | LibreOffice [启动参数](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html) 明确 headless、convert-to、UserInstallation 和 Windows `soffice.com`。固定 26.8.3.1 的 [Windows 字体实现](https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26.8.3.1/vcl/win/gdi/salfont.cxx) `:903-936` 在进程中注册安装根 `share/fonts/truetype`。本机 ElementTree 读取 pilot `Contents/Resources/registry/main.xcd` 的 Substitution/FontReplacement 节点（exit 0），确认 Replacement、FontPairs、ReplaceFont、SubstituteFont、Always、OnScreenOnly 的真实键与类型。 | Windows 可用应用私有解包根的字体目录；不能拿 mac FONTCONFIG_FILE 当 Windows 字体发现机制。具体成品效果仍待 Windows 真包实证。 |
| F-09 | `rail-preview-host.ts:351-378,463-508`、`html-preview-host.ts:214-250` 已有隔离 session、自定义协议、禁外网与导航；`src/office-preview/index.ts:47-94` 分别用 docx-preview/PPT viewer/spreadsheet viewer。 | 可复用隔离权威，但现有 Office 预览不等于 LibreOffice 自检。Chromium 的逐页/全页面导出端口尚不存在，须明确新增。 |
| F-10 | `packages/core/src/tool/plugin/read.ts:258-267` 把图片作为 file content 交模型；`packages/ext/src/cloud-vision-hooks.ts:104,137-175,210-239` 为不能看图的模型登记 Read 图片、压缩、转写及按引用追问；能力取 modelFacts 的 capabilities.input，未知按不能看图处理。 | 模型逐页 Read 后走现有云识图；无需新视觉服务、模型白名单或渲染器上传。 |
| F-11 | `pilot/F-excel/logs/x3_tools.json` 是社区 server 2.3.2 实际 tools/list，共 46 个工具。已安装 METADATA 标 MIT；`excel_mcp/operations/calculated.py:27-47` 先读缓存，仅缺缓存时尝试自带公式计算。`workspace.py:315-338` 用 `package.prepare/apply` 保存扩展。 | 计算结果不能因有缓存就冒称新鲜重算；选用操作层与保真保存层，不运行它的 MCP/HTTP 服务。 |
| F-12 | 本次临时探针复制真实 `F-excel/X3-community/work/sales_x3.xlsx`；调用 2.3.2 的 `Workspace.edit`、`operations.sparklines.add_sparklines` 后再次 edit/save，迷你图 part 数为 1→1；同一文件改用普通 openpyxl load/save 为 1→0，且真实报“不支持 Sparkline Group”。命令 exit 0；回执 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/document-design-probe-kyey3nss/receipt.json`。 | 保存保真是实际边界，不能让模型在创建这些对象后随手整本 openpyxl 回存。探针只证明迷你图，没有冒称证明全部对象。 |
| F-13 | `factory-skills.ts:20-56,109-117` 与 `reconcileFactorySkills` 是出厂技能来源/嵌套发现权威；`packages/ext/src/plugin.ts:160-176` 通过 tool.transform 注册自有工具；工具文案归 `context-injection.ts`。 | 用既有出厂渠道和工具注册，不引入 Claude 插件运行器或另一份技能发现机制。 |
| F-14 | `packages/plugin/src/promise/session.ts:201-214` 向所属 Location 的插件公开 session.synthetic，`promise/adapter.ts:637` 已适配 host.session.synthetic；现有协议支持 id、delivery、resume 和精确 ID 重试。 | ext 可直接入队补查，不需要新增 server 适配器或 Location 路由，也不改现有发送通道。 |
| F-15 | `renderer/codepuppy-ui/session-rail/artifacts/local-artifacts.ts:58-85` 只识别 OFFICE_WRITE_TOOL、write、patch 新建；映射在 `shared/office-advisories.ts:110-115`。`scripts/build-office-runtime.ts:271-274` 的构建烟测也调用四个 writer。 | 移除 writer 必须同时改变这两个消费者；shell/Chromium 成品以文档工具持久回执进入原面板，不能只改工具清单。 |
| F-16 | `renderer/extensions/codepuppy-catalog.json:75-84,162-176,336-346` 仍有旧 writer/描述，Excel default-disabled，artifactDigest 及重 intake 规则在 `:142,172`；`codepuppy-catalog.snapshot.json:8` 明确快照由目录发布仓 catalog-src 生成，不许手编。 | 目录源生产者与桌面快照消费者是跨仓契约；默认制作路径不能依赖启用 Excel MCP。 |
| F-17 | 社区 2.3.2 的 sorting.py/replace.py/cells.py 无 pivot rebuild 调用；`operations/pivot_rebuild.py:56-92` 提供 can_rebuild/rebuild，后者只重建本实现创建且未被 Excel 重刷的透视表；现有调用来自 `slicer_pivot.py:23` 的导入及其切片器路径。 | 原稿“排序后自动更新透视”没有接缝，改为保存前显式调用，并对不可重建者如实诊断。 |
| F-18 | `factory-skills.ts:124-133` 直接收嵌套 SKILL.md；目录 `codepuppy-catalog.json:999-1013` 已有 canvas-design。`packages/core/src/filesystem/codepuppy-project-watch.ts:16-47,62-64` 是 ADR-047 的项目 watcher 忽略表拥有者，尚无 .document-output。 | 适配技能采用独立 frontmatter name；工作目录写本地 gitignore 并消费同一个 watcher 忽略权威。 |
| F-19（r3） | 实施回执 `0db0c3ade34878c02e952393a5864d440e3a2f2b` 的 plan.md `:268` 指出固定验证任务缺口；`packages/plugin/src/promise/shell.ts:15-17` 只有 hook，不能执行。`ext/src/hub-bridge.ts:80-126,218-226` 已有 parentPort 通知/回执和早到消息交接；`ext/src/plugin.ts:109-130` 已有按 Location setup/cleanup；`sidecar.ts:175-179,270-281` 在加载插件前安装围栏，后代继承。`util/src/cross-spawn-spawner.ts:455-510,550-568` 已有进程树终止/强杀，公开 node 可经 `util/src/effect/layer-node.ts:244` 的 compile 消费。 | 用既有桥交付固定任务，所属 Location 的 ext 直接复用公共进程实现；不假称 ShellDomain 有执行口，不新增引擎或主进程执行 API。 |
| F-20（r4） | 实施基线 `d3c2190fc83a88883249e53355c563fddd1c42b5`：`main/document-host.ts:29-38`、`ext/src/document-host-bridge.ts:33-37` 只返回 JS 对象，`util/src/codepuppy-document.ts:86-95` 是进程内发布槽；`office-mcp/server.py:49-74` 只接 format/workspace，不能向 Python 交付活状态。现成的 `plugin/src/promise/shell.ts:3-16` 允许 create.before 改 env，`plugin/src/promise/mcp.ts:6-19` 的 MCPEditor.update 可改本 Location 的派生配置，`ext/src/plugin.ts:135-137,345-382` 已消费两口。启动器 v2.2（`975715738049aaa5724c4a24dcde8a5b78e794a5`）`:789-822` 的缓存槽只交稳定目录，不携带 Location/注册/实时状态。 | 复用 DocumentHost 桥交付 main 写的投影入口，再由两个现有环境钩子交 Python；不扩启动器槽、不把目录当 ready，也不新增引擎 API。 |
| F-21（r5） | **源码**（固定 tag `libreoffice-26.8.3.1`）：`desktop/source/app/app.cxx:531` 无条件 `RequestHandler::Enable(true)`，`officeipcthread.cxx:671-677` 只在编译期 MACOSX_SANDBOX/无桌面构建关管道；`sal/osl/unx/pipe.cxx:41-42,150-155` 管道目录先 `/tmp`、再 `/var/tmp`，两者都不可写才读 bootstrap `OSL_SOCKET_PATH`，`:166-172` 文件名 `OSL_PIPE_<uid>_<ident>`；`desktop/source/deployment/misc/dp_misc.cxx:288-324` 的 ident 为 `SingleOfficeIPC_` + UserInstallation URL 的 UTF-16 MD5 逐字节不补零十六进制；`pipe.cxx:229-241` 遇残留同名 socket 先 connect，失败即 unlink 再 bind。**探针**（本次临时目录，已删除）：bun 调 `renderProcessFenceProfile`（`813ca7a98c`）渲染生产形状 profile，`/usr/bin/sandbox-exec -f` 包 pilot LibreOffice 26.8.3.1，每次私有 UserInstallation。无围栏 docx→PDF rc=0；生产 profile 下 `--version` rc=0（版本输出早于管道），docx→PDF rc=1，`--terminate_after_init` rc=1 且未建 profile。追加下文 N5 后 docx→PDF rc=0（PDF 164,882 B），重算路径 `--terminate_after_init` rc=0、固定 RecalculateAndSave 宏 rc=0 且工作簿摘要改变；同一规则写成 `^/tmp/` 则 rc=1（规则须写解析后的 `/private/tmp`）。connect 矩阵：`(allow default)` 对照臂对 `$TMPDIR` 外部监听者、`/private/tmp/OSL_PIPE_501_SingleOfficeIPC_<伪 hash>` 外部监听者、`/private/var/run/mDNSResponder` 均 CONNECTED；生产臂与 N5 臂三者均 `EPERM`。bind 矩阵（N5 臂）：`$TMPDIR` 路径、`/private/tmp/` 其它名、`OSL_PIPE_501_other` 均 `EPERM`，`OSL_PIPE_501_SingleOfficeIPC_<hex>` 可 bind+listen；生产臂全 `EPERM`。真实用户实例臂：无围栏 headless soffice 持有 profile U 的管道，N5 臂用同一 profile U 转换 rc=0，`convert … ->` 行出现在围栏内进程输出、不在用户实例输出，即未转交；围栏内实例按 `pipe.cxx:240` unlink 了用户实例的管道文件（W11 本就允许）。MD5 公式对 profile U 计算值 `dcaf5b44…1d919d2e` 与实际管道名逐字一致。 | LibreOffice 的单实例管道既关不掉也挪不走；TMPDIR/HOME/OSL_SOCKET_PATH 在围栏下都不生效。产品 LO 只需 bind/listen/accept 自己 job 的管道名，不需 connect；最窄规则按本用户 uid + 该命名族 + 只监听方向。 |
| F-22（r5） | 只读 `lsregister -dump`（检查开始时）：本机已有 pilot 副本及两个已从磁盘消失的实施副本 `/private/tmp/alpha-1761-r6/lo-candidate/LibreOffice.app`、`/private/tmp/lo-repro-1761/mnt/LibreOffice.app` 的应用记录及其 `QuickLookPreview.appex`/`QuickLookThumbnail.appex` 记录。本次把同一字节 clone 到临时 `…/userData/document-runtime/libreoffice/darwin-arm64/26.8.3/LibreOffice.app`：复制后 8 s 为 0 条；执行一次 `soffice --version` 后 1 条；一次转换后为应用加两个 QuickLook 扩展共 3 条，`pluginkit -mAvvv` 同时列出这两个扩展且 Parent Bundle 为该副本。同一字节放在不带扩展名的 `…/noext/LibreOffice`：无围栏与 N5 围栏下转换均 rc=0，`lsregister` 与 `pluginkit` 均 0 条，`codesign --verify --deep --strict` rc=0。本次自建的登记已用 `pluginkit -r` 与 `lsregister -u` 注销，复查 0 条后删除临时目录。 | 触发登记的是执行带 `.app` 扩展名的包，而不是复制；登记后其 QuickLook 扩展进入系统插件表。只在展开后注销没用（下一次启动又会登记）；包目录不带 `.app` 时同字节、同签名照常运行且不被登记。 |
| F-23（r5 R1） | **源码**（同一 tag）：发布版 bootstraprc（pilot `Contents/Resources/bootstraprc:4`）为 `UserInstallation=$SYSUSERCONFIG/LibreOffice/4`；`sal/osl/unx/security.cxx:497-505` 在 mac 上取 `<home>/Library/Application Support`，当前用户的 home 优先读环境变量 HOME（`:334` 起）；`:381-395` 用 `osl_getFileURLFromSystemPath` 转成 URL，`sal/osl/unx/file_url.cxx:76-77` 规定不编码的字符为 ``!$&'()*+,-./0-9:=@A-Z_a-z~``，其余 UTF-8 字节写成 `%XX`；`unotools/source/config/bootstrap.cxx:202-228,390-394` 在目录存在时做规范化。第二个实例按 `officeipcthread.cxx:717-779` 连接管道，读到 `InternalIPC::SendArguments`，再发出 cwd/argv，等待 `InternalIPC::ProcessingDone`。**探针**（临时目录，已删除；用 HOME 指向临时 home 代表用户的默认 profile）：按上述规则算出的 `OSL_PIPE_501_SingleOfficeIPC_7c9de0c0…dace79`，与真实默认 profile 实例首次启动、profile 已存在时再次启动的管道名逐字一致；home 含中文、空格和 `;` 时，算出的 31 位 hash 也与实测一致（含不补零的字节）。**对照臂**（只有 N5，没有拒绝行）：围栏内监听者 bind 默认管道名成功，应答这次握手后截获用户启动的参数 319 B（其中含文档路径），用户的 LibreOffice 以 rc=0 退出，没有产出 PDF。**修正臂**（N5 加默认管道名 `path-literal` 拒绝行）：围栏内 bind 该名在用户实例启动前返回 EPERM，在用户实例运行中返回 EADDRINUSE；用户第一个实例正常建立管道，第二次启动的打开请求被转交并完成转换（PDF 生成，`convert` 行出现在第一个实例的输出里）；同一 profile 下，产品私有 job 的转换 rc=0，其它十六进制名仍可 bind。 | 只放行 N5 时，围栏内进程能截获并吞掉用户之后的打开请求，所以必须按 LibreOffice 的规则逐字推算用户默认 profile 的管道名，并在 N5 之后显式拒绝；这条拒绝不影响产品的私有 job 管道。 |

外部包元数据补核：PyPI `pypdfium2/5.0.0/json`（本次 urllib 读取，exit 0）列出本设计所需的 mac arm64、win_amd64 wheel；许可证为 BSD-3-Clause、Apache-2.0 及 dependency licenses。[Python API](https://pypdfium2.readthedocs.io/en/stable/python_api.html) 提供 PdfDocument、逐页 render。其实际随包加载尚未验证。所有本次探针只运行 Python/读元数据，没有启动桌面应用、Electron 或 LibreOffice。

## 4. 接口契约

### 4.1 技能、运行环境与许可

**决定：固定快照、适配后随包、出厂加载。** 引入 F-03 的七个技能；`office-docs` 保留为六种成品的路由与自检总入口，对应技能通过既有 factory nested discovery 按需加载。只注入短路由，不把七份正文和 Excel 操作 schema 每次全部塞入上下文。模型称呼统一为“助手”；去掉 Claude 专属路径、上传交付、预装包/apt/brew、失败后 npm/pip install 及 Linux 专属命令。没有用户新增的确认步骤。

七个适配技能的 frontmatter name 分别固定为 `codepuppy-document-docx`、`codepuppy-document-xlsx`、`codepuppy-document-pptx`、`codepuppy-document-pdf`、`codepuppy-document-frontend-design`、`codepuppy-document-canvas-design`、`codepuppy-document-theme-factory`；路由与技能内引用使用这些名字，不占用目录可安装的 canvas-design 等原名，也不靠顶层 FACTORY_SKILL_IDS 的避让覆盖嵌套技能。

制作路线保留上游知识：新 Word 用 docx 9.16.0；PPT 用 pptxgenjs 4.0.1 的原生图表/表格/备注；Excel 用 openpyxl 和 §4.6 操作；PDF 用 reportlab/pypdf；网页与海报用 frontend-design、canvas-design、theme-factory 的构图与主题指导，以本地 HTML/CSS/JS 为可编辑源，Chromium 导出成品。用户模板走上游“编辑现有容器”的方式，不能为了使用新建库而丢掉母版。无需引入 web-artifacts-builder 的 Claude artifacts 发布脚本、React 工程或在线安装链来完成当前 AC。

Word 的目录/页眉页脚页码/图片分别落到 docx 的 `TableOfContents`、`Header/Footer/PageNumber`、`ImageRun`；图表按真实数据在本地 HTML/SVG 制作，经同一 Chromium 导出 PNG 后用 ImageRun 插入，不依赖不存在的 docx 原生图表 API。pilot 的 `E-skills/work/make_E_docx.js:33,42,65-66` 正是这些真实入口。Word 的图表本规格未要求可编辑数据；PPT/Excel 则保留各自原生图表和数据。

执行统一消费以下**决定新增**的只读结果，由宿主从 resourcesRoot、USER_DATA_LAYOUT 和 #1760 的 LauncherEnvironment 投影；这是进程间数据，不是用户配置。路径全为当前安装派生的真实绝对路径，不含开发机默认路径。

```ts
type DocumentKind = "docx" | "xlsx" | "pptx" | "pdf" | "html" | "design"
type DocumentEnvironment = {
  python: string                 // Office 专用解释器；mac bin/python3，win python.exe
  node: string                   // 直接消费 LauncherEnvironment.node
  nodeModules: string             // 随包 docx/pptxgenjs 的锁定闭包
  skills: string; templates: string; fonts: string
  workRoot: string                // <workspace>/.document-output，制作/自检工作目录
  renderState: DocumentRuntimeState
  pythonEnvironment: DocumentPythonEnvironment // §4.10，宿主注入所用的同一记录
}
```

模型通过现有 shell 工具运行本地脚本，使用 environment 返回的入口；npm 库从绝对 nodeModules 路径加载，不依赖 ESM 对 NODE_PATH 的支持。Python 文档库由原 Office runtime 的构建锁继续负责，补 Windows 的 CPython 3.11.15/同版文档库闭包；不共用 #1760 的第三方连接器 Python 环境。PDF 栅格化增加 pypdfium2 5.0.0，Excel 操作需要的 pydantic 及其闭包均在构建期锁版本/哈希和随包，运行时不安装。Node 只消费 #1760 的入口与签名方案，不再带第二份 Node。文档 npm 包也在构建期按 F-05 精确版本和 lock integrity 备好，不通过 npx 启动。

消费 #1760 冻结版时只读取其 Node 资产入口/签名与公开宿主面；不把该设计仅供 uv-tool/npm-exec 的 PATH、UV_PYTHON、XDG 等启动器覆盖套到原生文档脚本。包管理器共用位置仍归它引用的 #1759 权威，本文不重算这些环境键。

最终成品仍写用户指定的项目位置。模型要读取的 PNG/局部图统一写 `workRoot/<checkId>/<revision>/<renderId>/`，在同一已授权工作区内，避免为了自检再触发外部目录读许可；LO profile、临时展开和待查日志仍在 userData，二者不混淆。main 的 Chromium 输出也必须绑定当前工作区授权与源/目标真实路径，不能借宿主桥扩大写权限；不改 HOME 或新增清理到期策略。

初始化该应用工作目录时写入 `.document-output/.gitignore`，内容为 `*\n`，使渲染与制作中间物不进入项目版本控制；项目文件 watcher 在既有 `projectWatchIgnore` 的 FOLDERS 中忽略 `.document-output`，不为每张检查图发项目变化事件。最终成品仍在用户项目正常位置，由原 watcher 与产物面板照常处理；不在 renderer 再维护一份 watcher 排除表。

分发边界如下（是许可证决定，不是实施文件清单）：

| 材料类别 | 决定及随附义务 |
| --- | --- |
| 七个技能的 Anthropic 自有文本/代码 | 固定提交 vendoring；保留各自 LICENSE、版权及已有 NOTICE；改过的材料显著注明本应用适配、日期和来源 SHA。构建来源记录含 upstream 路径、源/产出摘要、修改说明及排除原因，不能用应用许可证覆盖它。 |
| `docx/xlsx/pptx/scripts/office/schemas/**` | **全部不分发**，包括 ISO、ECMA、Microsoft、mce 四组；不从其它技能副本漏进包。移除对这些 XSD 的运行期引用；ZIP/XML well-formed、关系目标、内容类型与实际渲染检查照常做，不把未执行的 XSD 验证记成通过。标准文件许可核清以前不启用对应 XSD 校验，不影响生成。 |
| canvas-fonts、theme-showcase.pdf | 本增量不带上游字体二进制及字体演示 PDF；字体逐文件许可对应未核清，演示不是 AC 所需。主题颜色与设计指导保留并改用下述已授权中文字体；不会删掉海报能力。 |
| 中文字体 | 随包提供 Noto Sans SC、Noto Serif SC 的 regular/bold 静态 TrueType，来源为官方 noto-cjk 的 TTF 变量字体及各自 SIL OFL；构建时用 fontTools 实例化 400/700，记录源提交/字节摘要、字轴和生成工具版本，保留 OFL、版权和修改说明，遵守实际 RFN。不能把 OTF/CFF 直接交 reportlab 冒称可嵌入。[字体来源](https://github.com/notofonts/noto-cjk/blob/main/README.md)、[OFL](https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE)、[静态实例 API](https://fonttools.readthedocs.io/en/latest/varLib/instancer.html)。精确字体提交与四份产物摘要是构建锁实值，不在本文虚构。 |
| Excel 选中源码、npm/Python 闭包、PDFium | 分别保留 MIT、各包实际 LICENSE/NOTICE、PDFium wheel 内依赖许可；不把社区服务器改名当自研来源。来源清单明确哪些部分来自哪个固定版本。 |
| LibreOffice | 保留原安装内容的 LICENSE/NOTICE/第三方署名；随包许可目录在未下载前也可读。自有 release 同时提供该精确构建的源码取得说明和对应源档副本，满足所分发组件的源码义务；不能只挂一个会变化的项目主页。[官方许可证说明](https://www.libreoffice.org/licenses/) 明确 MPL-2.0 与版本内第三方许可。 |

署名归应用现有随包许可清单，不新增许可证页面。ADR-014 决策 5 的“禁止再分发/依赖太重”前提在本规格 v1 下失效；实现获准后须在原权威修订这一条并引用本设计，不重写其它决定。本次仅记录冲突。

### 4.2 中文模板、字体与离线成品

**模板选择只有一个权威：用户模板/样例优先，否则用随包模板。** 随包至少有中文报告 docx、数据分析 xlsx、汇报 pptx 各一份，模板由应用原创，来源标识和版本进入成品的自定义属性及检查记录。用户指定样式但没有文件时在该模板上调整；不能因未指定行业、页数或配色而要求补填信息。

Word 模板带中文正文/标题样式、A4 页面、目录域、页眉页脚/页码、表格样式；PPT 带中文主题、母版、占位布局、表格和图表配色；Excel 带数字/日期/百分比格式、中文列宽、冻结、打印范围/页眉页脚。它们是起点，不把内容写死成样例。用户给的 Word 通过 OOXML/现有模板编辑保留 styles、section、页眉页脚；PPT 复制模板页并保留 slideMaster/theme/关系；Excel 通过保真保存层修改。不得用重建一份相似配色代替沿用模板。

默认正文衬线用 Noto Serif SC，标题、PPT、表格用 Noto Sans SC。Word 同时设置 eastAsia、主题 major/minor 与各级标题；PPT 设置 latin/ea 与主题，Excel 设置实际 Font.name；PDF 嵌入静态 TTF 并保留 ToUnicode，中文正文仍可选中复制。用户指定字体写进成品；渲染缺字库时按整段/字体家族替换，不逐字找不同替代。映射固定为 宋体/SimSun→Noto Serif SC、黑体/SimHei/微软雅黑/Microsoft YaHei→Noto Sans SC；已有且覆盖完整段落的指定字体优先，缺字时整段选覆盖该段的同类字体。中英文标点、禁则、行距、分页、表格跨页及足够文本框空间写入适配技能；不引入“最多两级标题”等规格没有的限制。

mac 每次 headless 启动都用应用生成的 FONTCONFIG_FILE：字体目录包括随包四份字体、`/System/Library/Fonts`、其 Supplemental、`/Library/Fonts` 与用户字体目录，cache 在文档 runtime 内；按上述家族 prepend 优先顺序，并在独立 LO profile 的 Font/Substitution 表启用替代，打印也生效。生成器默认的两套字体本身覆盖中文，不借系统是否装微软雅黑决定成败。Windows 不套用 fontconfig：准备展开根时把四份字体加入 LO 的 `share/fonts/truetype`，由 F-08 的本进程注册逻辑发现，再消费同一替代表。两者都不安装系统字体、不写用户的 Office/LO 全局设置。

配置按真实路径生成 XML，而非让模型写配置。fontconfig 的固定形状为 `<dir>随包字体根</dir>`、各系统字体 dir、`<cachedir>私有缓存</cachedir>`，以及 `<alias binding="strong"><family>宋体</family><prefer><family>Noto Serif SC</family></prefer></alias>` 等上述五组名字的替代表。LO profile 的 `org.openoffice.Office.Common/Font/Substitution` 启用 `Replacement:boolean=true`，FontPairs 条目携带 `ReplaceFont:string`、`SubstituteFont:string`、`Always:boolean=false`、`OnScreenOnly:boolean=false`（F-08）；已有字体不强制替换、缺失时屏幕和打印均替换。FONTCONFIG_FILE 是派生绝对路径，必填且仅 mac 的 LO 子进程读取；UserInstallation 用正确编码的 file URI，两平台均必填。Windows 仍用原始系统字体发现加上述私有字体目录，不把该环境变量当作跨平台开关。

HTML 默认产物是单文件 HTML：脚本、样式、图片和 OFL 字体子集内联，图表不依赖在线服务；用户要求多个文件时相对路径自包含。海报保留同样可编辑的 HTML 源并导出 PNG。没有 Google Fonts、CDN、远端 import、fetch 或运行时安装。动态脚本只读本地数据；内置 Chromium 在禁外网状态下渲染，外部引用失败要进入未解决问题，不能联网截图一次当成离线交付。字体子集保留所用字形、Latin/标点和 OFL 随附说明，不用图片替代 PDF/HTML 正文以掩盖缺字。

### 4.3 LibreOffice 固定文件、准备与状态

直接引用「切片四」的 PinnedFiles/PinnedFileId 和 `ensurePinnedFile({id,targetPath,signal?,onProgress?})`，不复制其 schema/回退器。唯一运行期清单仍是 `pinned-files.json`。以下条目决定版本、target、来源和精确文件身份；provenanceUrl 是 TDF 固定文件，originUrl 是**原字节**转存到应用自有、已公开 release 的固定 asset URL，禁止 latest。自有 release 的 tag/完整 originUrl 在发布实物时填进同一清单；未发布的 URL 不能当已可取。

| id（family 均为 libreoffice） | version / provenanceUrl 相对 `https://download.documentfoundation.org/libreoffice/stable/` | bytes / SHA-256 |
| --- | --- | --- |
| `libreoffice/darwin-arm64/26.8.3` | `26.8.3` / `26.8.3/mac/aarch64/LibreOffice_26.8.3_MacOS_aarch64.dmg` | `299927705` / `de943203795e5057785f65515063e2db5eb60b0bb6d8e2534fec59e5cc5fb988` |
| `libreoffice/win32-x64/26.8.3` | `26.8.3` / `26.8.3/win/x86_64/LibreOffice_26.8.3_Win_x86-64.msi` | `376311808` / `0e6918c273eabbdbbd800ee0dacbbf130a14c13c2e4cec861b06dd59e015bf94` |

F-07 的既有 urllib 读取回执提供上述两份 `provenanceUrl + ".mirrorlist"` 的 Size 和 SHA-256；是官方元数据，不是本次下载验真的摘要。发布者核对副本 bytes/hash 后才提交可消费 entry。香港优先、失败后原地址从 byte 0 重取、同来源有效 part 的续传、取消、完整性/磁盘错误、缓存重验，全部沿用冻结机制。这里的“原地址”是自有 GitHub release 副本，不临时回 TDF。

存储统一派生自 USER_DATA_LAYOUT：下载缓存沿 #1760 冻结契约为 `<userData>/pinned-files/<id>/<filename>`，同一宿主按 id 合并在途获取，不另改为按摘要合并；展开 runtime `<userData>/document-runtime/libreoffice/<target>/<version>/`；job profile、font cache、临时文件与检查记录在同一 document-runtime 下的独立子目录。安装资源只读。mac 下载约 300 MB，展开实测约 806 MB；Windows 下载约 376 MB、展开体积尚未测量，磁盘错误如实报告，不以约 800 MB 做人为容量闸。

mac 用系统 hdiutil `attach -readonly -nobrowse -noautoopen -mountpoint <私有临时挂载点>`，把原 LibreOffice.app 的内容按原字节复制为临时展开根下不带 `.app` 扩展名的 `LibreOffice` 目录（§4.11 决定二）后卸载；不运行安装器、不写 /Applications、不改上游签名或去 quarantine。Windows 用随包 Python ctypes 调 `MsiOpenDatabaseW(MSIDBOPEN_READONLY)`、查询 Directory/Component/File/Media/_Streams、`MsiRecordReadStream` 取 CAB，再用 Cabinet API `FDICopy` 按 MSI 目录表还原到临时根；不执行安装序列、自定义 action、msiexec 或系统注册。Windows 的这个解包适配是明确新增端口，依据是 [Windows Installer 只读数据库](https://learn.microsoft.com/en-us/windows/win32/api/msiquery/nf-msiquery-msiopendatabasea)、[CAB 文件键](https://learn.microsoft.com/en-us/windows/win32/msi/cabinet-files)、[FDICopy](https://learn.microsoft.com/en-us/windows/win32/api/fdi/nf-fdi-fdicopy)；尚未在该 MSI 实物/Windows 上运行。二进制原字节保留，解包路径不越界；不得以需要管理员权限为解决办法。

展开后入口为 mac `LibreOffice/Contents/MacOS/soffice`、Windows `program/soffice.com`。在独立 profile 中完成版本核对、字体配置和最小实际转换后原子发布 ready；仅有包或目录不算 ready。准备器按 §4.9 派发固定验证任务，只有匹配本次身份的实际成功回执才能提交 ready。独立 profile 禁 online update、扩展自动更新、宏自动执行和外部链接更新。渲染/重算进程走 Location 的现有执行/权限面并禁出网；下载只有宿主的固定文件入口可联网。应用不检查 LO 新版本，更新由以后应用版本的清单决定。

```ts
type DocumentRuntimeState =
  | { phase: "preparing"; stage: "download" | "extract" | "verify";
      received?: number; total?: number }
  | { phase: "ready"; version: string; executable: string }
  | { phase: "failed"; failure: ConnectorLaunchFailure }
```

这是本票文档 runtime 的状态，不伪造“连接器尚未连接”。ready.version 从选中的 pinned list entry 读取，当前值为 26.8.3，不在类型层锁死。失败直接复用 #1760 的 ConnectorLaunchFailure、PinnedFileDelivery 原始失败事实与已有呈现/助手交接：connect/timeout/HTTP 5xx/429 才映射 download；404、完整性/磁盘/解包/启动异常及无法确认的粗 network 码带完整诊断归 unknown，不要求用户安装 LibreOffice。复用 progress 单位和失败动作，不给 #1760 的 ConnectorLaunchState 私加一个 stage。环境查询第一次触发后台准备并立即返回；下载准备没有整包总时限，verify 中实际启动 LO 则受 §4.4 的自检执行期限。普通文档库和读工具启动不等待 LO，工具卡片通过同一状态流显示真实下载字节与阶段。

### 4.4 模型可调用的制作与渲染契约

新增 ext 自有工具 `codepuppy_document`，注册方式沿 F-13，所有文案纳入既有 context-injection 权威。模型只能传本文的业务参数；工作区、Location、sessionID、agent 和消息身份取真实 Tool.Context，不能由模型覆盖。没有新增公共 HTTP API、Server HttpApi 或用户设置。

```ts
type RenderRequest = {
  kind: DocumentKind
  path: string                     // 当前授权工作区内的成品/HTML源绝对路径
  outputPath?: string              // 仅 design 必填，目标 PNG；其它种类不传
  dpi?: number                     // PDF/Office 默认 144，有限正数，无人为上限
  viewport?: { width: number; height: number } // HTML/design；正整数
}
type DocumentToolInput =
  | { action: "environment" }
  | { action: "render"; request: RenderRequest; checkId?: string; revision?: 0 | 1 }
  | { action: "check"; report: DocumentCheckReport }
type RenderPage = {
  number: number                   // 1起，按PDF页序或HTML纵向片段排序
  path: string; sha256: string; width: number; height: number
}
type DocumentArtifactRecord = {
  checkId: string
  kind: DocumentKind; sourcePath: string; sourceSha256: string
  artifactPath: string; artifactSha256: string
}
type RenderReceipt = DocumentArtifactRecord & {
  id: string; revision: 0 | 1
  renderer: "libreoffice-pdfium" | "pdfium" | "chromium"
  rendererVersion: string; pages: RenderPage[]; pageCount: number
  template: { source: "bundled" | "user"; path: string; sha256: string } | null
  diagnostics: string[]             // 含替代字体、外部引用失败，不等于视觉检查
}
type RenderResult =
  | { status: "rendered"; receipt: RenderReceipt }
  | { status: "pending"; checkId: string; artifact: DocumentArtifactRecord;
      runtime: DocumentRuntimeState }
  | { status: "failed"; code: "invalid-input" | "source-missing" | "runtime" |
      "conversion" | "raster" | "disk" | "source-changed" | "timeout";
      detail: string; artifact?: DocumentArtifactRecord }
type DocumentToolMetadata = {
  codepuppyDocument: { schemaVersion: 1; artifact: DocumentArtifactRecord }
}
```

所有字段经 schema 验证；格式须与文件/容器一致，非法参数不执行 I/O；路径沿现有工作区授权与真实路径校验，不带入预览器的文件/页数上限。dpi、viewport 只定义本请求所需精度/画布，不新增产品选项。HTML 未给 viewport 时默认 1440×900 CSS px；design 未给时从源声明的画布尺寸取，源也未声明则助手按任务选择尺寸。Office/PDF 每页按 144 dpi 全量栅格化；网页按完整 scrollHeight 分段出图（片段高为 viewport.height），不能只截首屏。图片不因工具上下文容量而被省略；页多时模型逐批 Read。设计导出 PNG 是完整画布成品，另可分片检查，不能只交第一片。

首次 render 省略 checkId、revision 默认 0，工具分配并返回 checkId；修正后的 render 带同一 checkId、revision=1，必须属于当前会话/Location 的同一成品。renderId 每次新分配，工具不把重渲染当成新一次修正；原始检查、修正、复核的身份由此闭合。环境查询不是生成完成回执，template 字段取实际选中模板的来源记录和哈希，未知时为 null，不能凭模型口头声称填入 bundled。

DocumentArtifactRecord 只指向已核实存在、位于授权工作区的文件，不把请求中的目标路径当作已生成。Office 的 sourcePath/artifactPath 是同一成品，design 则分别是可编辑源与已导出的 PNG。rendered 回执、LO pending 记录以及失败但成品仍存在的结果都把该 record 投影到工具返回的 DocumentToolMetadata；工具 part 仍正常完成，内部 status 说明检查失败，不能把“检查未完成”变成“文件未生成”。元数据随现有工具 part 持久化，具体面板消费者见 §4.8；检查图不登记为用户成品。

| 格式 | 唯一自检渲染路径与关键语义 |
| --- | --- |
| Word | 原成品只读快照 → 私有 profile 的 LO，`--headless --nologo --nodefault --norestore --convert-to pdf:writer_pdf_Export --outdir <job>` → pypdfium2 `PdfDocument`、逐页 `render(scale=dpi/72)`、Pillow PNG。目录/页码域在渲染副本更新；成品目录不能只剩空域。需要无需刷新即可见的目录时，制作脚本按实际渲染页码写入目录正文/域缓存后再渲染核对，沿同一轮修正，不靠用户手工刷新补齐。 |
| Excel | §4.7 先重算 → 成品快照 → `pdf:calc_pdf_Export` → 同一 PDFium。尊重各 sheet 的打印范围、分页、重复表头、方向与缩放；输出全部可打印页，不强行缩成一页或拿网格预览代替打印版面。 |
| PPT | 成品快照 → `pdf:impress_pdf_Export` → 同一 PDFium；每张普通幻灯片对应一页，讲者备注仍保存在 PPT，不用备注页冒充幻灯片数。 |
| PDF | 直接 PDFium 解码每页，不经 LO/重排/截图浏览器工具栏；pageCount 来自真实 PDF，记录每页尺寸。 |
| HTML / design | main 的离屏 Chromium 载体消费文件快照；复用既有隔离 session/protocol/零外网规则，在 load 完成、`document.fonts.ready`、当前图片 decode 全部 settle 后，再连续等待两个 requestAnimationFrame，随后通过 `webContents.capturePage` 分片。图片解码失败记 diagnostics 后继续，不另等“应用脚本稳定”或 network idle；载体关闭后台节流，长期动画不阻止上述截取时点。固定画布直接导出 PNG，必要 PDF 导出用内置 `printToPDF`；无外置 Chrome/Playwright 浏览器下载。 |

LO 进程每 job 独立 UserInstallation，不和用户开的 LibreOffice 争用 profile，也不借用户的安装路径。转换进程退出 0 仍需确认新 PDF 存在、非空、可解码；stderr、页数与 renderer 版本保留。生成输出不因渲染失败被删除。PDFium 使用同版跨平台 wheel，与现有 pypdf 分别承担“画出来”和“读结构”，不增加 Poppler 系统命令依赖。

**自检执行的固定期限为 180,000 ms**，从本次实际 render / excel_recalculate 开始计时（render 内的 Excel 重算共享这一期限，不层层叠加），覆盖 LO、PDFium、Chromium 的 load/fonts/decode/帧等待和截图；LO 准备 verify 的启动转换也用此期限，后台下载不计入。178,000 ms 时取消并请求终止；到 180,000 ms 强制结束本 job 进程句柄或销毁 WebContents，由调用端期限保证不再等待卡死的 worker/宿主回包，过期回包和未发布临时结果不再生效。返回 code=timeout、保留可交付文件和已完成页，助手明确“本次版面检查未完成”，不自动重跑整轮；这只界定检查是否完成，不限制文档交付、文件大小或页数，不增加用户动作。

Chromium 载体的创建/截图是**本票新增**，不直接调用只能显示用户预览的 openRailPreview，也不复制其隔离实现。将现有 hardenSession/hardenWebContents 的公共不变量收敛成同一内部权威，预览与导出消费它；文档导出只允许当前 job 的固定资源映射，HTML 源可执行所需本地 JS，但没有 preload、Node、Electron API、其它工作区文件或出网能力。这里不会改变用户现有预览组件与交互。

### 4.5 自检、一次修正及 BR-08 补查

**模型负责判断和改稿，工具负责可核对的渲染事实。** 生成完成即文件可见；正常交付前先 render，逐页 Read，必要时放大局部，列问题，合并修正至多一轮，再 render 并逐页复核。没有问题则不为凑轮次重写。不用 render 成功替代“看过”；不能只看总览缩略图断言每页无溢出。

```ts
type DocumentIssue = { page: number; detail: string }
type DocumentCheckReport = {
  checkId: string; renderId: string
  revision: 0 | 1                 // 原稿检查/唯一一次修正后的复核
  final: boolean                  // 仍要修正时false；最终交付/修后复核为true
  inspectedPages: number[]
  uninspected: { page: number; reason: string }[]
  observations: DocumentIssue[]
  fixes: string[]                 // revision 0通常为空
  remaining: DocumentIssue[]
  formulaCheck?: { recalculationId: string; errors: FormulaError[] }
}
type DeferredDocumentCheck = {
  id: string; location: Location.Ref; sessionID: Session.ID
  notificationID: SessionMessage.ID
  request: RenderRequest; sourceSha256: string; artifact: DocumentArtifactRecord
  revision: 0 | 1
  state: "waiting-runtime" | "admitting" | "admitted" | "complete"
  report?: DocumentCheckReport
}
```

Location/Session/SessionMessage 类型直接消费现有 schema，不另发明 ID 域；notificationID 用 `SessionMessage.ID.create()` 分配一次并持久化。`checkId` 在首次 render 建立；render receipt 与检查记录按同一 checkId 归档，revision 1 仍属同一成品任务。check 参数必须匹配已存在 receipt 的源摘要和页序，不能拿旧版截图给新版盖章；工具记录实际 Read 的页面摘要关联，并从既有视觉路径取得成功/失败事实。inspectedPages 与 uninspected 必须不重叠地说明全部页，后者可以非空；工具返回 `{status:"recorded",coverage:"complete"|"partial",checkId}`。final=false 只记本轮观察，final=true 才标 complete。页未读取/视觉失败只记不完整，请助手如实报告，不能制造“已通过”；这些输入记录也不能机械证明模型已经理解图片，发现并修正溢出仍以规格的真实成品结果为准。这不是文件下载/交付闸：文件一直在项目中，存在问题也交付并明说。

视觉能力判定直接消费 F-10：能看图的模型得到 Read 的原生图片；不能看图时，同一次 Read 在已有 cloud vision hook 登记与自动转写，助手使用 `cloudVisionToolId(bootstrap)` 对已读路径逐页问“中文缺字、遮挡、溢出、分页、图表标签”。复用既有按图哈希缓存、压缩、鉴权、拒绝与计费规则；不并行偷偷换模型、不向新服务上传。高密度页按局部图片再读，沿同一入口识图。云识图不可用时报告哪些页尚未检查；绝不把无图的文本提取当视觉检查，后续继续处理沿已有失败恢复。断网能力指本地生成/渲染本身；不能看图的模型不会在断网时凭空得到云视觉结果。

工具卡片复用现有执行流：shell 制作卡片标题为“生成”，document.render 为“渲染”，Read/vision 与 document.check 为“检查”；进度从真实 render/runtime 状态和工具 metadata 投影，没有新增视图。最终一两句话概括检查范围、修正和剩余问题；报告存本地，不把长技术记录塞进用户成品。

**LO 尚未 ready 时立即走 BR-08。** Word/Excel/PPT 生成不等待环境准备，render 返回 pending，同时宿主原子落 DeferredDocumentCheck；助手先交文件，并明说“版面尚未检查”；Excel 同时写明重算若未完成，不能谎称无公式错误。PDF、HTML、海报仍可当次检查。

下载/解包就绪后，main 经现有 main↔sidecar↔ext 桥通知记录所属 Location 的 ext；该 ext 直接调用自己已有的 `ctx.session.synthetic({sessionID,id:notificationID,text,metadata,delivery:"queue",resume:true})`。text 为应用固定的补查指令与本地成品引用、metadata 为 checkId/源摘要；不会冒充用户新要求。插件在原 Location 执行同一 render→Read/vision→check，至多一轮修正，回复原会话。新任务晚到时 queue 只在其可用边界处理，不打断正在进行的用户工作。

只新增该功能的通知/回执，复用插件 API 的持久 admission 与精确 ID 重试；不增加 packages/server 适配器，不直接调用 core Session.Service，不另建 Location 路由。ext 在现有 Location setup 中订阅本 Location 的待查通知，cleanup 时解绑；main 在 ready 或原有桥重新挂接时重放尚未交接的记录，暂未挂接只保留记录，不产生 Location 不可用错误，也不要求用户重新发起检查。记录在收到 ext 的 admission 回执后才从 admitting 变 admitted，断线重发同一 notificationID，不新增会话队列/重试引擎。应用重启后读取 waiting/admitting 继续这一项已授权补查；admitted 不再新建合成消息。这个过程只新增本功能输入，**不把现有 composer、配置、permission 或其它生产路径从一代引擎切到另一代**。

补查前重新读取当前文件：未改动就查原稿；用户改动过则检查当前版本并明确所查版本，修正前还要比较摘要，不能覆盖用户同时改的内容。原文件被删除/移走时在原会话报告找不到，留下实际原因；会话已删除则终结该 pending、保留本地检查记录，不重建会话。应用退出期间不声称能继续工作；下次启动接着做，无到期时间或用户新增操作。

### 4.6 Excel 首方工具归并

Excel 定制中心仍只有 `mcp:codepuppy-excel`；保留 stdio 与工作区授权。选择 **2.3.2** 实测版本的操作源码和最小闭包，改编为首方工具后台；不安装/启动社区 MCP、HTTP/SSE/上传接口，不发布第二个 Excel 条目。2.3.6 未实测，不在本票顺手追最新版。

保留 `read_xlsx` 名称，增加可选 sheet、range、mode（`values|formulas|both`，默认 values）与读取游标；省略 sheet 时仍遍历工作簿。返回 cell 的值、公式、缓存来源与错误位置，不再只有公式文本。为控制常驻定义，新增三类工具和一个重算工具，能力分配如下：

| 首方入口 | 合并的社区操作（仅这些进入工具面） | 参数/返回权威 |
| --- | --- | --- |
| `excel_inspect` | describe_workbook、describe_sheet、read_range、find_cells | 下述 inspect 联合；结构包含 sheets/used ranges、tables/charts/pivots/slicers/sparklines/defined names；range 返回实际算值和公式/错误，不静默截断。 |
| `excel_edit` | sort_range、replace_cells | 下述 edit 联合；单次调用原子保存，返回修改计数、实际范围、新文件摘要。 |
| `excel_objects` | create_pivot_table、delete_pivot_table、add_slicer、delete_slicer、add_sparklines、delete_sparklines | `operation` 为这六个固定枚举；参数 schema 按需返回，来自固定上游对应函数的类型/default，见下文。 |
| `excel_recalculate` | 本应用新增的 LO 重算与缓存合并，不借社区 read_range 冒充 | §4.7；没有任意 shell/宏输入。 |

其它社区操作不搬进工具面：基础生成、区域写入、格式、冻结、打印、条件格式、验证、原生图表、命名区域、工作表/行列、表格、批注图片、CSV 由技能和随包 Python 直接完成；goal_seek/公式追踪、VBA、远端上传、二进制导入导出不属于本规格缺口，不额外加入。这里没有减少 BR-02 的生成能力。

```ts
type CellValue = string | number | boolean | null
type FormulaError = { sheet: string; cell: string; formula: string; error: string }
type ExcelReadMode = "values" | "formulas" | "both"
type ExcelInspect = { path: string } & (
  | { action: "workbook" }
  | { action: "sheet"; sheet: string }
  | { action: "range"; sheet: string; range?: string; mode?: ExcelReadMode;
      rows?: number; cursor?: string }
  | { action: "find"; query: string; sheet?: string; exact?: boolean;
      caseSensitive?: boolean; mode?: "values" | "formulas"; cursor?: string }
)
type ExcelEdit = { path: string } & (
  | { action: "sort"; sheet: string; range: string;
      sortBy: { column: string; order?: "ascending" | "descending" }[];
      hasHeader?: boolean }
  | { action: "replace"; query: string; replacement: string; sheet?: string;
      exact?: boolean; caseSensitive?: boolean; inFormulas?: boolean }
)
type ExcelDiagnostic = {
  kind: "pivot-not-rebuilt"; sheet: string; pivot: string; source: string; detail: string
}
type ExcelMutationResult = {
  path: string; sourceSha256: string; resultSha256: string; diagnostics: ExcelDiagnostic[]
}
type ExcelObjectOperation = "create_pivot_table" | "delete_pivot_table" |
  "add_slicer" | "delete_slicer" | "add_sparklines" | "delete_sparklines"
type ExcelObjects =
  | { action: "describe"; operation: ExcelObjectOperation }
  | { action: "apply"; operation: ExcelObjectOperation; path: string; inputJson: string }
type ExcelRangeResult = {
  sheet: string; range: string
  cells: { address: string; value: CellValue; formula?: string;
    valueSource: "literal" | "libreoffice" | "stored" | "community-evaluator" | "missing" }[]
  errors: FormulaError[]; nextCursor: string | null; sourceSha256: string
}
```

read 默认 values；range 省略指 used range；rows 省略按输出预算分页、给出 nextCursor，调用者可指定行数而无本设计添加的上限。游标绑定 path+sheet+range+mode+sourceSha256，源变更明确返回 source-changed，不能接着读另一版。find 默认 values、exact=false、caseSensitive=false；sort 默认 ascending、hasHeader=true，列可用表头或列字母；replace 默认 exact=false、caseSensitive=false、inFormulas=false，遵守上游的字面串查替，不悄悄把 query 当正则。

`excel_objects.describe` 返回 `{operation,inputSchema,defaults}`。schema 唯一生成源是 2.3.2 的 `server/pivot_tools.py:create_pivot_table/delete_pivot_table`、`server/slicer_tools.py:add_slicer/delete_slicer`、`server/object_tools.py:add_sparklines/delete_sparklines` 的参数注解与对应 operation InputModel；提取为可调用适配后仍保留参数名、结构、枚举和默认值，去掉 path（顶层已有）。例如 pivot 的 sheet/at/source/row_fields/value_fields 必填，column_fields/filter_fields 等沿上游默认；slicer 的 sheet/target/field/at 必填，target 是其 Source 模型，不把来源实体退化为任意字符串。schema 作为按需结果而非六份常驻工具定义；apply 的 inputJson 必须 decode 成 JSON object 并经**同一份** Pydantic 模型验证，未知字段报 invalid-input，不执行 eval，也不提供自由方法名 dispatch。熟悉 schema 的模型可以直接 apply，不强制新增 describe 阶段。

分发适配移除上游与格式无关的 max_cells、文件体积、pivot 字段数等人为配额，使用范围流式处理/分页；保留 Excel 文件格式边界、引用合法性、矩形范围、对象关系和实际内存/磁盘错误，不以调大一个 Limits 数字伪装去掉限制。参数默认值的唯一有意偏离就是移除这些配额及上述首方读取默认值，源码来源记录注明它。不能把社区工具内部的安全帽变成本应用新用户限制。

所有修改复用 `Workspace.edit → package.prepare/apply → 原子保存` 的同一保真权威。模型脚本也通过这一随包适配入口打开/保存含扩展的工作簿；不要在它之后裸 openpyxl save。新增的脚本 API 为 `OfficeExcel.edit(path)` 上下文管理器，yield 已加载的 openpyxl Workbook，退出时沿同一保真保存/源摘要校验；工具与技能没有第二套保存实现。值读取注明 stored 未必新鲜；missing 返回 null 和明确未计算原因，不能用 null 冒充公式结果或把 evaluator 不支持报告成 Excel 公式错误。

脚本侧 `OfficeExcel` 是 `from codepuppy_office import OfficeExcel` 的随包模块（装在 Office Python 自身 site-packages，`-I` 也可 import）。除 `edit(path: str) -> ContextManager[openpyxl.Workbook]`、`recalculate(path: str) -> ExcelRecalculateResult`，还导出 `inspect(input_json: str)`、`apply_edit(input_json: str) -> ExcelMutationResult`、`object_schema(operation: ExcelObjectOperation)`、`objects(path: str, operation: ExcelObjectOperation, input_json: str) -> ExcelMutationResult`：input_json 分别使用上面的 ExcelInspect/ExcelEdit 与 objects.describe 所产出的同一 Pydantic schema，inspect/object_schema 的返回与对应工具完全相同。MCP 工具只调用这些模块入口，不重复逻辑。edit 的保存结果及诊断以同一结构化 JSON 写到脚本 stderr，shell 能直接交给助手，其它调用直接返回结构化结果。

出厂技能默认经此模块完成透视表、切片器、迷你图、排序和查替；不需要启用任何 MCP。Excel 连接器可继续 default-disabled，用户主动使用连接器时只是多一个同模块的调用入口，不新增启用步骤、第二份运行环境或第二个 Excel 条目。默认用户的 AC-11 能力由随包模块提供，不以目录条目已启用为前提。

### 4.7 Excel 重算、公式缓存与对象保真

```ts
type ExcelRecalculateInput = { path: string }
type ExcelRecalculateResult =
  | { status: "recalculated"; id: string; path: string; sourceSha256: string;
      resultSha256: string; formulaCount: number; errors: FormulaError[];
      diagnostics: ExcelDiagnostic[] }
  | { status: "pending"; checkId: string; runtime: DocumentRuntimeState }
  | { status: "failed"; code: "source-changed" | "runtime" | "calculation" | "disk" | "timeout";
      detail: string }
```

**LO 是最终重算权威，社区 evaluator 仅是未就绪时的有标记读取辅助。** 原文件复制到 job 目录；独立 LO profile 执行应用固定的 RecalculateAndSave 宏（来源为上游 xlsx/scripts/recalc.py 的 calculateAll/store 做法），只打开该副本、calculateAll、另存 xlsx、关闭。入口/宏是应用固定资产，文件路径用参数/正确 URI 编码传递，不能把用户字符串插进 Basic 代码。文档自带宏和外部链接不执行。两平台都由 Python subprocess 管理退出/取消，不依赖 Linux timeout 或 mac gtimeout；实际转换过程不假成功。

从重算副本按工作表身份和单元格坐标读取公式缓存值及错误，再在**原始 ZIP** 对应公式单元格中更新 `<v>` 和缓存结果的类型；保留 `<f>`、格式、所有非目标 part、extLst、pivot/slicer/sparkline 与图表关系。共享/数组公式按实际 OOXML 范围映射；字符串结果正确写缓存 string 类型，不能误作 sharedString 索引。原公式与副本表达式若不等价或结果缺失，明确标 calculation incomplete，不把空缓存当成功。生成图表所用公式值也必须在重算后同步对应 chart cache，仍保留图表对象和关系。

该缓存合并器是本票明确新增能力 `OfficeExcel.recalculate(path)` 的一部分，不是现有 openpyxl/LibreOffice 自动保证；返回 FormulaError 包括 #REF!/#DIV/0! 等实际错误的 sheet、cell、formula。0 错误与汇总值核对使用重算后的值。LibreOffice 回存的整本文件只作计算/渲染中间物，绝不能替换最终工作簿；切片器在 LibreOffice 中的交互支持程度也不能靠截图宣布与 Excel 相同。

**保存前显式刷新受影响的透视表。** excel_edit 与 OfficeExcel.edit 在同一保真保存入口、`package.prepare/apply` 之前确定实际 changed ranges：工具操作返回精确受影响坐标，脚本上下文比较进入/退出时各透视源区域的值、公式和引用，不能依赖模型声明自己改了哪里。枚举透视表的 worksheetSource/命名源，若源与 changed ranges 相交，先调 2.3.2 的 `pivot_rebuild.can_rebuild(pivot)`；可重建者调用 `pivot_rebuild.rebuild(workbook,sheet,pivot,lambda request: request,limits,results)`，保留布局、筛选选择、名称和已有关系，由既有 package 保存层收纳重建后的对象。

results 回调使用本次编辑后的数据；源含公式时用已有 `calc.engine.Engine.calculate` 并把旧公式缓存标 stale，不调用只读旧存盘缓存的 formula_values 冒充当前结果；最终数值仍由 §4.7 的 LO 重算复核。该回调适配及 changed-range 相交判定归 R10 的保存接线，不另造透视计算器。Excel 创建或被 Excel 重刷、can_rebuild=false 的透视表，以及本次无法求值/解析源者，保留对象并记录 ExcelDiagnostic（sheet/pivot/source/具体原因），继续保存用户修改，助手把“该透视表尚未刷新”列入 remaining；不强制用户打开 Excel，不把它误报为已刷新，也不让一次不能重建取消其它成品能力。

随后重算、刷新图表缓存并渲染；重算前后的源摘要一致才原子合并，并发变化返回 source-changed 并重新读取当前文件，不能覆盖用户修改。整个过程只有“重算值与缓存同步”这一存储权威，不在 reader 里另写计算器。公式错误与透视诊断都是检查结果，不阻止文件交付，助手在同一轮修正中处理并报告余项。

### 4.8 宿主边界与现有工具去向

四个 `write_docx/write_xlsx/write_pptx/write_pdf` 从本版 advertised tools、dispatch、清单/权限元数据中移除，不改造成另一套宽 JSON 写入器，不保留旧调用别名。`read_docx/read_pptx/read_pdf` 保持既有内容读取；`read_xlsx` 依 §4.6 增强。四个首方连接器 ID 与现有定制中心条目保留，Excel 不出现社区第二项。生成脚本仍过现有 shell/文件权限；不能借“出厂技能”绕过权限，亦不另问一次本地执行确认。

移除 writer 的消费者契约同步如下，不能只删工具定义：

| 消费者 | 改为消费的权威与行为 |
| --- | --- |
| “本次对话产物”的 `scanLocalArtifacts/candidatesOf`（`renderer/codepuppy-ui/session-rail/artifacts/local-artifacts.ts:58-85`） | 优先解析首方 codepuppy_document 已完成工具 part 的 `metadata.codepuppyDocument`，与 §4.4 的 rendered receipt / pending record 使用同一个 DocumentArtifactRecord schema；以 sourcePath/artifactPath 取得候选，去重，排除 workRoot 内的中间物，再走现有会话目录、文档类型、stat/预览规则。相同文件只留最近一次，保留已有 write/patch 来源及子会话归属；不解析 shell 命令或模型正文猜路径。pending 已有 Office 文件马上入面板，主进程导出的 PNG 在文件核实后入面板，检查失败但文件存在也不抹掉它。 |
| `shared/office-advisories.ts:110-115` 的 OFFICE_WRITE_TOOL | 删除旧 writer 映射及上述消费者依赖；不建“旧 writer 或新回执”的兼容分支。DocumentArtifactRecord 的纯数据 schema 放既有 util 共享契约面，ext/main/renderer 使用同一版本，不各手编解析格式。 |
| `scripts/build-office-runtime.ts:271-274` 的构建烟测消费者 | 制作侧改调用随包制作库/OfficeExcel 模块，再经真实 stdio reader 读回；不再调用已删除 writer，也不降为只 import/握手而失去产物读回证明。 |
| 四条连接器的工具说明、Excel intake/digest 与桌面目录快照 | §8 的目录源生产者按本设计更新并发布；桌面只消费生成/校验后的字节快照与快照锁，不手编 codepuppy-catalog.json，不保留与真实工具不同的写入承诺。 |

跨 bundle 的新增 **DocumentHost** 由 ui-mac main/sidecar 的既有 ID 请求应答桥承载，util 只持有纯数据与发布端口；不让 ext/core import main。下面的签名是本票决定 raise，不声称存在：

```ts
type DocumentHost = {
  environment(caller: { location: Location.Ref; sessionID: Session.ID }): Promise<DocumentEnvironment>
  pythonEnvironment(location: Location.Ref): Promise<DocumentPythonEnvironment> // §4.10，宿主内部读取面
  chromiumRender(input: { caller: { location: Location.Ref; sessionID: Session.ID };
    checkId: string; revision: 0 | 1; request: RenderRequest;
    sourceSha256: string }): Promise<RenderResult>
  defer(input: DeferredDocumentCheck): Promise<void>
  recordCheck(input: { caller: { location: Location.Ref; sessionID: Session.ID };
    checkId: string; report: DocumentCheckReport }): Promise<void>
  subscribeReady(location: Location.Ref,
    listener: (check: DeferredDocumentCheck) => Promise<DocumentCheckAdmission>): () => void
  subscribeRuntimeVerify(location: Location.Ref,
    run: (task: DocumentRuntimeVerifyTask, signal: AbortSignal) => Promise<DocumentRuntimeVerifyReceipt>
  ): () => Promise<void>
}
declare function publishDocumentHost(host: DocumentHost): void
declare function documentHost(): DocumentHost
type DocumentCheckAdmission =
  | { status: "admitted"; checkId: string; notificationID: SessionMessage.ID }
  | { status: "session-missing" | "conflict"; checkId: string }
```

bootstrap 只新增 DocumentEnvironment 的资源路径/资产锁投影，不序列化函数；publish 在引擎启动前每代一次。caller 由 ext 当前 Tool.Context/Location 绑定，经既有 sidecar↔ext 桥核对，不是模型输入；main 据此派生 workRoot 并核对 checkId 的归属。复用 #1760 的 pinned-file 请求、LauncherEnvironment 与诊断/失败动作；本票只增加 document.environment/render/defer/record-check 的窄请求、document.check-ready 通知/DocumentCheckAdmission 回执与 runtime.changed 通知。subscribeReady 只登记该 ext 的真实 Location 并消费其已登记 check，不能指定另一个项目的会话或任意文本；清除订阅不删除待查记录。消息带 request id、sidecar generation，进度带递增 sequence；停止/退出终结本代请求，旧回包不覆盖新状态。main 只获取固定 LO 文件和拥有 Chromium 渲染；Python 制作、重算、PDFium 与 Excel 操作在现有 Location 执行面内运行，不把任意模型脚本或任意 URL 交给主进程执行。

### 4.9 固定运行时验证任务（r3 增量，frozen）

**main 准备、Location 的 ext 执行、main 发布 ready。** 复用上节桥及其 generation/ID 簿记，增加 `document.runtime.verify`、`document.runtime.verify.cancel` 通知与 `document.runtime.verify.receipt` 终结回执；不另开端口、进程服务或引擎路由。subscribeRuntimeVerify 在 ext 的当前 Location setup 注册，返回的异步 cleanup 负责撤销注册、取消并排空本注册的任务。函数/AbortSignal 只存在进程内；跨桥发送纯数据，cancel 通知在 ext 转成对应 signal.abort。

这些通知/回执挂在现有端口的同一监听与严格解析面，按本注册/task 身份交接，不占用重载的单 handler；验证不套用 hub 普通查询的 20 s 超时，执行及主端等待只用下述既有 180 s 期限。

```ts
type DocumentRuntimeVerifyRef = {
  taskId: string                  // main 每次验证尝试分配，非 Session/模型任务
  sidecarGeneration: number       // 既有 main generation，非负安全整数
  registrationId: string          // 本代本 Location 这次注册的身份，桥分配
  location: Location.Ref
  pinId: PinnedFileId; pinSha256: string // 本平台清单条目的身份
}
type DocumentRuntimeVerifyTask = DocumentRuntimeVerifyRef & {
  kind: "libreoffice"
  runtimeRoot: string             // 本次已校验解包的候选根
  jobRoot: string                 // userData/document-runtime 下的本 task 私有根
}
type DocumentRuntimeVerifyReceipt = DocumentRuntimeVerifyRef & (
  | { status: "completed"; version: string; pdfPath: string;
      pdfSha256: string; pageCount: number }
  | { status: "failed"; reason: "spawn" | "conversion" | "invalid-result" | "timeout";
      detail: string; exitCode: number | null; stderr: string }
  | { status: "cancelled"; reason: "requested" | "location-disposed" |
      "sidecar-stopped" | "superseded" }
)
```

注册身份取真实 ctx.location，main 只派给同代、仍存活且请求该 pin 的注册；注册建立前任务留在 preparing/verify，环境查询照常立即返回。共享准备选一个实际请求者执行，同 pin 不因多个等待者重复验证；该 Location 离开时取消原尝试，有其它等待者则给其活注册分配新 taskId，无活注册则保留准备状态，挂接后再派，不要求用户操作。此处只是现有准备过程的一次固定回调，不新建会话、持久执行队列或调度框架。

**执行面**：handler 跑在所属 Location 的 ext，即已经安装现有进程围栏的 sidecar 内。当前本机执行直接消费公共 `CrossSpawnSpawner.node`（`LayerNode.compile`→`Effect.scoped`→ChildProcessSpawner.spawn），由 ctx.location 绑定注册、cwd 和作用域；不在插件外导入 core Environment.Service、不另建 Environment 权威。它与本机 Environment 使用同一公共进程实现，子 Python/soffice 继承同一 sidecar 围栏。mac 不可退回无围栏进程；Windows 沿原批准边界如实为无 seatbelt，不声称有等价围栏。除 §4.11 的 N5（LibreOffice 单实例管道只监听）外，这里不改既有文件/出网权限判定。

argv 只能由该 handler 从已发布文档资源构造：随包 Office Python 加 `-I -B`、固定 `document-runtime/verify_runtime.py`，以及 task 的候选根/私有工作根；脚本、中文控制样本及字体取本应用锁定资源，控制样本来自随包中文模板。模型不提供程序、脚本、命令字符串、样本、URL 或环境覆盖，不走模型 shell，也不新增用户审批。main 与 ext 均核对 pin、候选根及工作根的真实路径/身份；脚本从候选根取得本平台 soffice，在私有 profile 内执行版本查询和实际 docx→PDF 转换，关闭更新/宏/外部链接，并用随包 PDFium 解码新 PDF。只有退出 0、版本匹配清单、输出位于本 job、PDF 非空可解码且页数为正，才回 completed；不能拿历史同名 PDF 或目录存在充数。

执行期限沿 §4.4 的 180 s：178 s 中断作用域，设置公共 spawner 的 forceKillAfter=2 s，终结 Python/soffice 进程树；mac 用它已有的进程组，Windows 用它已有的 taskkill /T /F，不复制终止实现。main 同时持有期限，到点或换代即封闭本 task，失联也不能无限等回执。完成/失败/取消在活桥上恰有一个终结回执；同一身份的重发合并在途任务或重发终态，不再次 spawn。取消先标记不可提交，再终止作用域；即使 completed 与 cancel 竞态，已取消任务也不能发布 ready。

main 只接受当前 generation、注册、Location、taskId、pinId/sha256 全部相符的回执；检查实际 PDF 路径/摘要与候选根仍属本次尝试后，才原子发布 ready。过期、重复或其它注册的回执不改变状态。spawn/转换/解码/版本不符/超时均映射现有 `ConnectorLaunchFailure {kind:"unknown",detail}` 与原诊断/助手处理呈现，保留 exitCode/stderr；不误归 download，不新增失败 UI。正常取消不产生失败问题，已下载/解包内容可复用但不视为已验证。

Location cleanup、pin 被替代及 sidecar 正常停止均先 abort 并等待本 scope 终止；应用退出复用已有 stop→Location cleanup（`sidecar-stop.ts:20-39`），两秒强杀在其既有五秒排空预算内。sidecar 崩溃/桥断开时，main 将该代未结算尝试终结为 cancelled，拒收迟到结果；下一代以新身份重新验证，不重放旧进程。强制退出没有清理回执时不伪称已确认进程树退出，更不能发布 ready；具体正式包退出行为仍须实施留证。任一等待者退出不取消其它 Location 仍需要的共享下载或已完成解包。

### 4.10 Python OfficeExcel 的宿主投影（r4 增量，frozen）

**main 是唯一生产者，Python 从宿主注入的文件入口读当前快照。** 在 §4.8 的 DocumentHost 增加 `pythonEnvironment(location)`，沿现有 DocumentHostRequest/Reply 的 `python-environment` 操作承载，返回下面的环境记录；调用者是 Location 的 ext，不是模型工具。main 从桥的当前 sidecarGeneration 和 §4.9 的存活注册确定 registrationId，校验真实 Location.Ref（含 workspaceID），不接受调用者传来的文件、LO/profile/字体/job 路径。DocumentHost.environment 在既有文档环境查询中调用此口，并把同一记录放在 DocumentEnvironment.pythonEnvironment 返回；此调用复用原后台准备触发器并立即返回 preparing，不等待下载/验证。没有活注册属于内部接线错误，不猜路径。注册/准备与取消仍归 §4.9。

```ts
type DocumentPythonEnvironment = { CODEPUPPY_DOCUMENT_HOST: string } // main 派生的绝对文件路径
type DocumentPythonProjection = {
  schemaVersion: 1; sequence: number // 非负安全整数，本注册内单调递增
  sidecarGeneration: number; registrationId: string; location: Location.Ref
} & (
  | { status: "invalidated"; reason: "location-disposed" | "sidecar-stopped" }
  | { status: "active"; pinId: PinnedFileId; pinSha256: string;
      runtime: DocumentRuntimeState;
      jobs: { root: string; profileSeed: string; fontconfigTemplate: string | null;
        configurationSha256: string; timeoutMs: 180000 } }
)
```

文件为 `<userData>/document-runtime/python-host/<sidecarGeneration>/<registrationId>/host.json`，这些目录段由 main 的既有 generation/注册权威派生；同一 Location setup 的脚本与四个 Office stdio 入口共用它。main 先发布相邻临时文件再原子替换，UTF-8 JSON 严格按上述 schema 读写；不是工作区配置，不放进项目/产物面板，不含密钥。所有 ready/失败/准备阶段变更都来自同一 runtime 状态源，main 更新文件后才通知既有状态订阅，不另建 Python 下载/就绪状态机。`jobs` 只指向本注册的私有任务父根与已生成配置模板；ready.executable 仍来自验证过的 pin。配置模板全部生成成功才发布该快照，不发布半份路径。

**两个既有入口注入同一个保留环境键。** ext 在 Location setup 完成 §4.9 注册，随后从既有文档 environment 查询的返回中保留本 Location 的此记录；shell 的 create.before 在派生进程前覆盖 `event.env.CODEPUPPY_DOCUMENT_HOST`。技能仍先用现有 environment 取得随包入口再运行 Python `-I -B`，`OfficeExcel.recalculate(path)` 不增加参数。Office MCP 则在现有 `ctx.mcp.transform` 中只对已确认且启用的随包 Office 条目调用 pythonEnvironment，向 MCPEditor.update 的临时 environment 注入相同值，由原 Environment.spawner 传入 stdio 进程；setup 注册和普通 shell 钩子不触发准备；尚未建立文档记录的 shell 删除该保留键而不下载 LO，不把进程继承的旧值当当前 Location。投影只由已有文档 environment 或启用的 Office 入口初始化，无新增用户步骤。不写回用户配置、不启用被停用的连接器。`server.py` 启动只绑定这个环境入口，工具参数和 argv 均不新增宿主路径。

环境注入与身份核验必须闭合：先按既有受保护 Office 声明确认原定义，再合入宿主字段；首方声明、Office 环境校验及 main binding 重验消费 main 的同代/同 Location 投影值，派生配置中的该键必须逐字相等，不能只加进宽泛 allowlist、删除后跳过比较或把任意服务改写成首方。持久定义仍不含该键，最终派生配置的预期 environment 由同一投影合成一次，现有 matcher/安全校验消费它；不复制命令展开器。该宿主字段是随包进程上下文，不能成为用户配置或首方身份的凭据。

`codepuppy_office` 只从 os.environ 的该保留键定位文件；Python `-I` 不屏蔽这个非 PYTHON* 键。进程首次读取时只固定 Location/generation/registration 身份，后续快照必须与其一致；模块不在 import 时缓存 ready。每次 recalculate 开始、LO 子进程运行期间及最终缓存原子替换前重读，校验 schema、注册/Location/generation、sequence 不回退，并绑定当次 pinId/pinSha256/configurationSha256。路径边界仍由原 Office workspace 校验负责，不以 cwd 反推 Location。缺键、缺文件、非法快照或 invalidated 返回既有 `failed/code:"runtime"` 和具体诊断，不查 PATH/系统 LO 或自建 fallback；普通制作、inspect/edit 不因 LO 缺失停止。

preparing 立即返回既有 pending/runtime，并为本次路径/源摘要分配 checkId；该返回本身不表示已登记补查。ext 工具或技能将此结果交回原会话后，沿 §4.5/DocumentHost.defer 绑定真实 session/成品，不由 Python 猜 session 或发合成输入。failed 原样带回既有失败诊断；ready 才启动固定重算。Python 在 jobs.root 下创建随机唯一 job，复制 profileSeed 为本 job 的 profile，不直接打开共享 seed；seed 包含 §4.7 的应用固定宏及安全设置。mac 的 fontconfigTemplate 仅有固定标记 `{{JOB_FONT_CACHE}}`，Python 将它替换为本 job 内、经 XML 转义的字体缓存绝对路径，生成本 job 的 fonts.conf 并设置 FONTCONFIG_FILE；Windows 为 null，继续使用已配置的私有 LO 字体目录。字体列表、替换规则、宏和安全设置由现有 prepareDocumentFonts/固定资产生产者统一生成模板，Python 只复制/代入路径，不再维护第二套规则。LO argv/profile URI、固定宏入口、源副本和退出/强杀预算继续按 §4.7、§4.9，无任意命令字段；这些任务仍在原 Location 的进程树/围栏中执行。

**失效不复用旧 ready。** Location cleanup/正常 sidecar 停止先写 invalidated，再取消并排空同注册任务；旧文件名永不分给新注册。main 在换代/重启接收新调用前使旧代投影失效，异常退出期间没有收到清理回执仍按 §4.9 记为未确认，不承诺文件能替代进程存活证明。pin 变化时先在同一文件推进 sequence，发布新 pin 的 preparing，旧 pin 的 ready 和在途 job 随即失效；新 ready 仍必须经过固定转换验证。Python 监测到失效/身份变化就终止本 job 子进程并返回 runtime 失败，提交前再次比较当次身份/源摘要，不能把旧 pin 算出的缓存写回。相同注册后续调用可读新 pin，Location 重建则由钩子自动取得新文件；用户无重配/重试安装步骤。

### 4.11 围栏内的 LibreOffice 单实例管道与不被系统登记的运行时（r5 增量，R1 修正后 frozen）

这是对已批准能力（U-09「LibreOffice 来渲染」）的缺陷修正：生产围栏 N1 `(deny network*)`（`process-fence-profile.ts:381`）连带拒绝 LibreOffice 必建的单实例 unix socket，固定 verify、render、重算全部 rc=1。围栏作用于整个引擎及其子进程，嵌套 seatbelt 不能为单个子进程加宽（`remote-database-connector/design.md` P-02），所以规则对所有被围栏进程生效，必须足够窄。

**决定一：围栏只增加“只监听、不连出”的 unix socket 规则 N5，范围限定为本用户 LibreOffice 单实例管道名，并显式排除用户自己 LibreOffice 默认 profile 的管道名。** 按 F-21，管道不能用参数关闭，目录写死为 `/tmp`，TMPDIR、HOME、`OSL_SOCKET_PATH` 都不能改变它；因此不能把规则限制在产品私有目录，只能按“本用户 uid + 该命名族 + 只监听方向”收窄。产品 job 的管道名由运行时随机生成的 profile 路径派生，放行行只能写成通用的十六进制。按 F-23，只放行这一行时，围栏内进程会抢先监听用户默认 profile 的管道名，截获并吞掉用户之后的打开请求；所以同一契约必须带上用户 profile，在放行行之后逐条拒绝它们的确切管道名。名字按领域概念命名为“围栏内允许监听的 unix socket 汇合点”，今天的唯一情形作为类型化参数：

```ts
/** N5：围栏内进程可以创建并接受连接的本机 unix socket 汇合点；绝不放行 connect（出站仍归 N1）。 */
export type FenceUnixListen = {
  kind: "libreoffice-single-instance"
  uid: number                              // 非负安全整数，管道名里的 <uid>
  /** 用户自己 LibreOffice 使用的 UserInstallation 绝对系统路径；每条推出一个确切管道名，在放行行之后拒绝 bind/accept */
  userInstallations: readonly string[]
}
// ProcessFenceProfileInput 增加，沿用 W20/W21 的可选列表约定
unixListen?: readonly FenceUnixListen[]   // 省略或 [] 时不渲染任何 N5 行
```

```
(allow network-bind network-inbound (local unix-socket (path-regex #"^/private/tmp/OSL_PIPE_<uid>_SingleOfficeIPC_[0-9a-f]+$"))) ; N5 LibreOffice 单实例管道：只 bind/accept，不 connect
(deny network-bind network-inbound (local unix-socket (path-literal "/private/tmp/OSL_PIPE_<uid>_SingleOfficeIPC_<用户 profile 的 hash>"))) ; N5 用户自己 LibreOffice 的管道，每条 userInstallations 一行
```

- **管道名推算**（按 LibreOffice 26.8.3.1 的规则逐字实现，F-23）：`url = "file://" + 对路径的 UTF-8 字节逐个编码`，其中 ``!$&'()*+,-./0-9:=@A-Z_a-z~`` 原样保留，其余字节写成大写 `%XX`（`file_url.cxx:76-77`）；`hash` 为 `url` 的 UTF-16LE 码元的 MD5，16 个字节各自写成小写十六进制且不补零（`dp_misc.cxx:288-324`）；管道名为 `OSL_PIPE_<uid>_SingleOfficeIPC_<hash>`。路径按原样使用，不做 realpath，与 LibreOffice 读到的 HOME 一致。这个推算只在渲染时用，不调用 LibreOffice，也不依赖运行时是否已下载。
- **渲染**：唯一渲染者仍是 `renderProcessFenceProfile`。N5 放在 N4 之后、受保护配置与凭据拒写块之前，与 N1–N4 同属网络行，N1–N4 逐字不变；拒绝行紧跟放行行，按“后写者胜”生效。uid 不是非负安全整数、或 userInstallations 中有非绝对路径时，与端口一样拒绝渲染（fail-closed）。只把推算出的十六进制管道名写进 profile，不写用户路径本身。路径必须写解析后的 `/private/tmp`，写 `/tmp` 的同形规则经实测仍会失败（F-21）。
- **生产者**：`process-fence-plan.ts:492-493` 的计划器在 darwin 上固定传入 `[{ kind: "libreoffice-single-instance", uid: process.getuid(), userInstallations: [join(homedir(), "Library", "Application Support", "LibreOffice", "4")] }]`。这个路径就是发布版 bootstraprc 的 `$SYSUSERCONFIG/LibreOffice/4`，home 与 `resolveEngineRoots` 取自同一个 `homedir()`（F-23）。不按 LO 是否已 ready 来决定是否加这些行：profile 在 sidecar 启动时只渲染一次，不能为此重启引擎。`renderCommandSourceProfile`（市场 command 源）不运行 LO，不加。字节预算沿用 `trimUntilCompiles`，两行合计约 300 B。
- **可达面**：被围栏进程只新增一种能力，即在 `/private/tmp/OSL_PIPE_<本用户 uid>_SingleOfficeIPC_<十六进制>` 上 bind、listen 和 accept，但**用户默认 profile 的那个确切名字除外**。**任何 unix socket 的出站 connect 仍由 N1 拒绝**，包括用户自己的 LibreOffice 管道、`$TMPDIR` 等处的外部监听者、`/private/var/run/mDNSResponder` 以及 docker.sock、ssh-agent 等系统或用户 socket。其它 uid、其它文件名、其它目录都不能 bind。
- **产品启动不变**：`render_document.py:75`、`verify_runtime.py:33` 和 `recalculate.py:106` 已经为每个 job 使用私有 UserInstallation，管道名因此唯一，并由该私有 profile 派生；argv/env 不改，也不加 `--accept`（产品不用它，它是另一套 UNO 接收端，与单实例管道无关）。新路径不存在时 LO 只 bind/listen；遇到残留的同名 socket 时，LO 先 connect（被拒），再 unlink 并 bind，仍然成功（`pipe.cxx:229-241`）。

**决定二：mac 展开根中的 LibreOffice 包目录不带 `.app` 扩展名。** `document-runtime.ts:207` 现在把 `<mount>/LibreOffice.app` 复制为 `<staging>/LibreOffice.app`，改为把同一份字节复制到 `<staging>/LibreOffice`。只有目录名不同，包内容、签名和 PlugIns 都不动。执行入口为 `<runtime>/LibreOffice/Contents/MacOS/soffice`；`document-runtime.ts:17` 的 `executable()` 与 `verify_runtime.py:20` 这两处现有派生同改为这个相对路径，ready.executable 仍只来自前者。不调用 lsregister 或 pluginkit，不改 Info.plist，也不删除 QuickLook 扩展。依据 F-22：执行 `.app` 副本会把它和其中的 QuickLook 扩展登记进 LaunchServices/pluginkit；无扩展名目录执行时登记数为 0。用户不需要任何新步骤，也看不到变化。

**Windows**：围栏只在 darwin 上存在（网络围栏权威「非 darwin 没有围栏」），LO 在 Windows 使用命名管道，N5 没有对应物；MSI 只读解包不运行安装序列，不写文件关联，也没有 LaunchServices 的对应物。

**实施须交付的、可失败的证明**（具体用例写在 plan.md）：
1. 经生产围栏装载路径的真实引擎（不能用 `sandbox-exec` 代替）中，固定 verify、Word/Excel/PPT render 与 `excel_recalculate` 都成功。
2. 移除臂：计划器不传 `unixListen`，其余条件相同，同一个 render/verify 必须失败。
3. 负臂：从围栏内 connect 测试在 `$TMPDIR` 自建的外部监听者、`/private/var/run/mDNSResponder`，以及测试在 `/private/tmp/OSL_PIPE_<uid>_SingleOfficeIPC_<hex>` 自建的无围栏监听者（代表用户 LO 管道），全部返回 `EPERM`；在 `/private/tmp` 下 bind 非该命名族的路径、其它 uid 的同族名，或由测试 home 推算出的用户默认 profile 管道名，也返回 `EPERM`。每条负臂都配一个必须能连通或绑定的对照臂（无围栏，或去掉拒绝行）。
4. 用户默认 profile 管道（一次性证明，F-23 已在 sandbox-exec 下完成，实施在真实引擎下复跑一次）：用测试 home 启动一个无围栏的默认 profile LibreOffice，其实际管道名必须与渲染器推算的拒绝行逐字相同；围栏内 bind 该名被拒绝期间，用户启动的 LibreOffice 仍能建立自己的管道，第二次启动的打开请求被它接收并处理。对照臂去掉拒绝行时，围栏内监听者能截获这次请求。
5. LaunchServices，观察条件：必须走正式包真实的下载与展开链路（`ensurePinnedFile` → `extractDocumentRuntime`，写入正式包的 userData），不能用 pilot 副本代替。依次记录：下载的 dmg、展开树和 `soffice` 的 `com.apple.quarantine` 等 xattr 状态；在这个机器上第一次执行这份 `soffice` 时的真实结果（Gatekeeper 新评估下的 verify 与一次 render 的 rc，以及同一时间窗的 syspolicyd/Gatekeeper 日志）——签名有效本身不证明可执行。确认 Spotlight 已索引该位置（`mdfind -onlyin <userData>/document-runtime` 能查到包内文件；尚未索引时先对该目录执行 `mdimport`，再确认能查到）之后，`lsregister -dump` 与 `pluginkit -mAvvv` 在 userData/document-runtime 下仍为 0 条。对照臂把同一份字节放成 `.app` 执行后能看到登记，用完必须注销。

## 5. 数据与失败

- **文件发布**：生成器先写同目录临时文件后原子替换成品；渲染只读快照。runtime 和 render receipt 完整发布后才可引用；源摘要、renderer、页数及页摘要可关联，旧 PDF 不因同名成为新渲染结果。缓存键含源摘要、渲染器/字体版本、dpi/viewport，不设 TTL 或人工容量帽。
- **并发边界**：同一 LO pin 的准备复用共享下载与一次展开；各文件 job 独立 profile，避免 LO 把命令交给别的进程。Excel 的同文件编辑串行且在保存时比较源摘要；不同文件不加本设计的并发上限。停止某次渲染不取消其它消费者仍需要的下载。
- **BR-08 窗口**：先持久化待查记录再返回 pending；ready/admission 之间崩溃可用相同 notificationID 重发；已 admission 未答复不再新建输入。后续执行失败沿现有 Session 错误与 pending 记录可恢复，不虚构成功。没有自动反复进行第二轮、第三轮修正；新的用户要求是新的任务。
- **下载失败**：沿 #1760 的失败类型/动作及固定文件错误处理，已生成文件保留，原会话获知尚未查。网络恢复/用户现有重试动作继续同一准备流程，不要求手工安装、清缓存或改系统保护。mac 正式签名/Gatekeeper 或 Windows 解包实物失败须作为平台实现缺口处理，不能改成让用户关闭保护。
- **视觉失败**：按实际已读页、已识图页报告覆盖范围；云识图额度/鉴权/拒绝归原服务，不在文档功能制造新批准或配额。原稿、渲染图和剩余问题都在本地；只有 F-10 这条不能看图时的识图路径上传图片。
- **自检卡死**：§4.4 的 180 s 是执行与返回的统一期限，下载准备不计入；超时终结本 job，不发布不完整的 PNG/PDF 或 Excel 回存。工具保留已有成品回执供产物面板读取，报告尚未查的页；没有自动无限重试或等待用户确认的分支。
- **准备验证窗口**：固定任务的身份、终结及 ready 提交只按 §4.9；取消/Location 释放/换代后旧成功结果无效，正常退出不产生失败问题，真实验证失败沿既有 unknown/诊断呈现。没有验证回执不能以下载成功代替 ready。
- **围栏内管道**（r5）：每个 job 的私有 profile 产生各自的管道名，并发 job 不会冲突；同一 job 内多次 soffice 是串行的，前一次退出时会删除自己的 socket；进程崩溃留下的残留文件由 LO 自己 unlink 后重新 bind（§4.11）。计划器漏传 N5 时，转换以 rc=1 失败，沿 §4.9 的 unknown 诊断如实呈现，不会被当作成功。
- **离线及不可信内容**：生成/转换无更新检查，无运行期 npm/pip/字体下载；Office 外部关系、HTML URL 与文档中的指令都是输入数据，不提升到 system 指令。LO 禁外部更新和文档宏，Chromium 禁外网；不会为了画出一个远端图片而替用户联网。

## 6. 架构落点

按[现有模块图](../../architecture/modules.md)落在既有 ui-mac、ext、util/schema 与 core 自有 watcher 配置责任内；不新增顶层包或业务框架，不改变 packages/server。资源子树仍属 ui-mac 的随包资产，执行逻辑仍属其既有宿主/扩展责任。

| 责任 | 模块与依赖 | 现有权威及约束结论 |
| --- | --- | --- |
| 技能、Office Python/npm/字体/模板构建与许可 | ui-mac 资源/打包；消费 #1760 Node 与现有 Office lock | `factorySkillSources/reconcileFactorySkills`、`build-office-runtime`；不再造环境版本表。Windows 路径统一由资源解析投影，已知 Office command 展开重复只在本票必需路径上消费同一结果，不全仓重构。 |
| 固定 LO 获取、展开、待查记录、离屏 Chromium | ui-mac main；消费 util 的纯契约及 OS/Electron | `resourcesRoot`、USER_DATA_LAYOUT、ensurePinnedFile、现有预览隔离；没有连接器直接下载或主进程执行模型代码。 |
| 制作路由、文档工具、自检与视觉；固定准备验证执行 | ext + 现有 Location setup/cleanup 与受围栏的 sidecar | `createCodePuppyTools` 模式、shell/read/skill、createCloudVisionHooks；验证直接复用公共 CrossSpawnSpawner，不把 ShellDomain hook 冒充执行口，不引入第二个视觉上传口或模型能力表。 |
| 成品回执、对话产物与中间物可见性 | util 的纯 DocumentArtifactRecord schema，ext/main 生产，ui-mac renderer 消费；core 自有 watcher 配置 | `scanLocalArtifacts` 的已持久工具 part 与 `projectWatchIgnore` 单一忽略表；保留最终成品的既有预览，隐藏检查中间物，不靠 shell 文本推断。 |
| Excel 保真操作、公式缓存、PDF 栅格化 | 现有随包 office-mcp/Office Python 责任 | server 的 workspace path 校验与原子替换，选中 MIT 操作层及 package 保存层；图像入口统一 PDFium。 |
| 就绪补查的持久合成输入 | main 经现有 sidecar↔ext 桥通知拥有者；契约在 util，调用在 Location 的 ext | `ctx.session.synthetic` 是现成的插件 API；不从 ext 反向依赖 core、不从 main import server，不新增 server 路由或触碰 ADR-044 的守卫面。 |

### 能力接缝总表

R 表示**已决定新增**的端口，范围及签名以 §4 为准；不是尚待实施者自行选择的空绑定。

| 依赖能力 / 对应 AC | 已有可调用符号或决定的 raise |
| --- | --- |
| 出厂技能按需发现、六种制作 / AC-01..04、12 | `factorySkillSources`、`reconcileFactorySkills`（main factory-skills `:36,148`）、`SkillTool.Plugin`（core `tool/plugin/skill.ts:32`）、`ShellTool.Plugin`（`:101`）；**R1**：§4.1 的 vendoring/独立技能名/模板与环境投影。所有正文制作能力由随包 docx/PptxGenJS/openpyxl/reportlab API 实现，不再依赖四个 writer。 |
| 跨平台资源入口 / AC-09、15 | `resourcesRoot`（ext-fs-installer `:260`）、USER_DATA_LAYOUT（`:4`）、#1760 LauncherEnvironment；**R2**：§4.1 DocumentEnvironment，Office Python 的 win32-x64 构建/解析与文档 npm 闭包。 |
| LO 下载与准备 / AC-06、09、10、13 | 冻结 ensurePinnedFile（协调设计 §4.11.4，由 #1760 实现）、ext `createHubBridge`/`processParentPort`（hub-bridge `:80,226`）、`CrossSpawnSpawner.node` 与 `LayerNode.compile`；**R3**：§4.3 的 pin/解包/ready，§4.9 的 DocumentHost.subscribeRuntimeVerify、固定任务/取消/回执接线，main 依匹配的真实转换结果提交 ready；不新增引擎执行 API。源、副本与许可材料由 §8 发布责任交付。 |
| Office/PDF 逐页栅格化 / AC-04、06、08 | 上游 soffice headless CLI、PDFium `PdfDocument/page.render`；**R4**：§4.4 的 document.render 和 receipt，借 Location Environment 执行，144 dpi 全页，路径/页摘要/版本真实记录。 |
| HTML 离线和海报 / AC-04、13 | `resolveWorkspaceFile`（workspace-file-service `:59`）、Electron `webContents.capturePage/printToPDF`；**R5**：§4.4 的离屏载体及预览隔离权威共用、load/fonts/decode/两帧时点、180 s 期限及整页分片/完整 PNG 导出。现有 openRailPreview 不是这个端口。 |
| 字体与模板 / AC-08、12、14 | F-06 fontconfig、F-08 Windows 私有字体发现、reportlab TTFont；**R6**：§4.2 同一字体资产/映射与模板来源记录、§4.1 许可/排除清单。 |
| 模型实际看图、至多一轮 / AC-05、06、13 | `ReadTool.toModelContent`（core `tool/plugin/read.ts:258`）、`createCloudVisionHooks`（ext `cloud-vision-hooks.ts:104`）、`cloudVisionToolId`（cloud-vision）；**R7**：§4.5 check 记录、读取关联和渲染/检查卡片投影。 |
| BR-08 晚到补查 / AC-10 | 插件 `SessionDomain.synthetic`（`packages/plugin/src/promise/session.ts:201-214`）→ `adapter.ts:637`；**R8**：§4.5 待查记录、§4.8 DocumentHost.subscribeReady 通知/回执，由所属 ext 调同一 API；没有 server 适配器、额外 Location 路由或另一个后台助手服务。 |
| Excel 区域、结构、排序查替 / AC-07、11 | 社区 2.3.2 `operations.calculated.read_calculated:27`、`cells.read_range:183/find_cells:296`、`sorting.sort_range:57`、`replace.replace_cells:23`；结构来自 server/workbook_tools `:44`、sheet_tools `:22`；**R9**：§4.6 的首方 inspect/edit/read 合约、分页和缓存来源标记。 |
| 透视/切片器/迷你图及保真 / AC-03、11 | 2.3.2 `operations.pivot.create_pivot:70`、`slicers.add_slicer:70`、`slicer_manage.delete_slicer:124`、`sparklines.add_sparklines:28/delete_sparklines:53`、`Workspace.edit:185`、`save_atomically:315`、`pivot_rebuild.can_rebuild/rebuild:56-92`、`calc.engine.Engine.calculate:105`；**R10**：§4.6 的 objects/inspect/apply_edit 脚本导出与共用 edit，§4.7 的 changed-range 相交、保存前 rebuild/诊断接线；保留 package 权威、去除非格式配额。 |
| Excel 新鲜算值与错误位置 / AC-03、07 | 上游 xlsx recalc 固定宏做法、pypdf/openpyxl 的只读解析；**R11**：§4.7 `OfficeExcel.recalculate`/excel_recalculate，LO 副本计算、原 ZIP 缓存合并、错误定位及图表/透视缓存同步。不可宣称这些已由 LO 自动保真。 |
| 工具注册、产物面板与清单 / AC-05、11、14 | ext tool.transform（plugin `:160-163`）、`tools_for/call_tool`（office-mcp server `:127,290`）、`scanLocalArtifacts`（local-artifacts `:89`）、`projectWatchIgnore`（core filesystem 自有配置）、目录 `scripts/sync-catalog-snapshot.mjs`；**R12**：§4.8 移除 OFFICE_WRITE_TOOL/旧 writer 消费、接入 DocumentArtifactRecord、调整构建烟测依赖、工作根 gitignore/watcher 忽略、消费 §8 的目录源与 intake 更新；不维护影子工具表。 |

| LO 在围栏内启动、运行时不被系统登记 / AC-03、04、06..10、13 | `renderProcessFenceProfile`（`process-fence-profile.ts:343`）、计划器 `trimUntilCompiles` 调用（`process-fence-plan.ts:492-493`）、`extractDocumentRuntime`（`document-runtime.ts:198-211`）、`executable()`（`:17`）；**R14**：§4.11 的 `FenceUnixListen`/N5 渲染与计划器传值（含用户默认 profile 管道名的推算与拒绝行）、mac 展开目录名与入口相对路径。不新增围栏渲染者、执行面或用户步骤。 |
| Python 宿主投影 / AC-03、07、09..11、15 | **R13**：§4.10 的 DocumentHost.pythonEnvironment、严格 JSON 与保留环境键；main 单一写者，ext 经既有 shell.hook/MCP transform 注入，Office 安全校验消费相同宿主预期值，Python 模块只读/按模板建 job。复用 R3 注册及现有 DocumentHostRequest/Reply，不改引擎、启动器槽或下载器；K2 保持单一状态/路径/字体权威。 |

K1：权限档位权威不变。K2：下载、环境、技能发现、视觉、Excel 保存和预览隔离各一个拥有者；新增消费不复制。`constraints.md:31` 已记 Office 命令展开的既有重复，Windows 入口本次必须走同一资源投影，不能再加第五份；其余既有偏离不在本票清理。依赖保持 Schema→Core/Protocol→Server，Client 不依赖 Core/Server。无必要架构例外。r5 的 N5 是网络围栏唯一渲染者内的加法，由该权威的「落地」表同步记载，不另立围栏或例外；N1 对 unix socket 出站一刀切的结论保持不变。

**被否决的替代**：OfficeCLI（U-12 明确不带）；HTML→PPT（试验字体与图表数据失真）；让用户安装依赖（BR-07/15）；整套社区 46 工具（定义成本大且 BR-09 只需补缺）；社区 evaluator 作最终重算（有缓存时不重算）；LO 回存覆盖最终 xlsx（扩展对象保真无保证）；复用用户预览截图作为 Office 自检（渲染来源不满足 BR-04）；预装包/apt/下载 Poppler、pandoc 的上游假设（当前生成和逐页渲染已有更小闭包）；新云文档服务（BR-13）。

## 8. 拆分决定

同仓制作、渲染、Excel、自检不是独立跨仓任务，本节不拆实施工作单元。只有以下已有所有权边界：

| 产出方 / 负责 | 产出与 AC / 小节 | 消费契约 | 开工依赖 | 集成/验收依赖 |
| --- | --- | --- | --- | --- |
| #1760 的桌面启动器拥有者 | 随包 Node/npm、LauncherEnvironment、固定文件公共口与失败呈现；AC-09/15、§4.1/3/8 | #1766 合入 `173122a8e955f97d830fe53fccd3400d079d9488` 的冻结设计；国内固定文件机制；本次交接确认的 `DOC-NODE-v2` | 既有冻结输入；本文不修改它的环境权威 | 保留 darwin-arm64/win32-x64 文档消费者的合法 bootstrap 读取面请求，由启动器设计以 DOC-NODE-v2 接受；消费其 Node/公共端口，不带第二份 Node。实际实现仍须交付，Windows Office Python 归本票。 |
| 目录发布仓（alpha-web）的 catalog-src 生产者；桌面目录快照消费者 | 四条首方 Office 条目的 tools/描述；Excel 新版本 re-intake、artifactDigest 与对应独立锚点；§4.6/§4.8，AC-09/11/14 | Word/PPT/PDF tools 分别只有 read_docx/read_pptx/read_pdf；Excel 为 read_xlsx、excel_inspect、excel_edit、excel_objects、excel_recalculate。codepuppy_document 属 ext，不伪列为连接器工具；四条描述区分技能制作与连接器实际读/操作能力，去掉旧 writer 及其新建/改写承诺。Excel ID 唯一且 default-disabled 不变 | 本冻结契约即可并行准备目录源；实际 digest/intake 依赖本票新的 server.py 和选中源码/许可材料 | 生产者用实际新字节重新 intake，artifactDigest 沿既有 `bundledOfficeServerDigest` / aggregateFilesDigest 域计算，不能沿用旧摘要或虚构值；同步目录 guard 锚点后发布。桌面运行既有 sync-catalog-snapshot 生成字节快照与锁，不手编快照；同一消费版本的工具/说明/digest 与打包字节一致才完成集成。 |
| 本票的发行资产生产者 | TDF 两份原字节副本、精确 pin 与源码/许可材料；AC-09/14、§4.3 | 冻结 PinnedFiles 与 §4.3 身份 | 本冻结设计、实际发行资产可取得 | 先附加到已公开自有 release 且可取，再提交完整 originUrl；对应清单提交供入口消费。本文没有生产发布授权。 |
| 国内固定文件入口拥有者 | 从桌面固定清单提交投影白名单；AC-09、§4.3 | 冻结切片四的清单快照/锁/relay 规则 | 已冻结共享设计与真实清单 | 香港入口部署匹配该快照；应用真实改道/续传/国内下载证据，不以读取 TDF 元数据代替。 |

不向 #1760 请求文档专属下载器、另一套 preparing 或新包管理器。两个目标的文档 bootstrap 读取面沿 DOC-NODE-v2 交接；这是已接受契约的实现依赖，不是设计待决项。

目录工具/描述契约已冻结；新的 intake 摘要、目录发布、快照再生成是既有生产者的交付依赖，不是待决的产品取舍，也不把启用 Excel MCP 变成默认用户的前置步骤。本次仅提交设计，不代该仓写源、发布目录或修改桌面字节快照。

## 9. 回滚

不适用。无旧数据迁移或不可逆数据变更，不设计旧 writer 兼容、旧记录迁移或旧版运行路径。原子临时文件与源摘要冲突处理是本次正确写入边界，不是版本回滚方案。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| 七个固定 Anthropic 技能适配随包；排除全部外部标准 XSD、未逐文件核清的上游字体及非必要字体演示 | F-03..05；规格 v1 BR-01/11/14；不再沿用 ADR-014 的失效许可证判断 |
| Python 文档环境沿现有锁补 Windows；Node 完全消费 #1760；文档 npm 库构建期锁定，运行期不安装 | F-02/04/05；BR-07/11/15；两个目标的 DOC-NODE-v2 交接归 §8 |
| LO 26.8.3 两目标固定文件，首次使用后台准备；不带 OfficeCLI，不挡生成，ready 后原会话补查 | F-07/08/14；BR-07/08、U-12；共享切片四原样消费 |
| Office→LO PDF→PDFium；PDF直接PDFium；HTML/海报内置Chromium；两平台分别配置中文字体发现 | F-06/08/09；BR-04/06；Windows 实物行为尚未验证 |
| 逐页检查、至多一轮修正，复核当前文件；不能看图的模型沿 Read+现有识图 | F-10；BR-03/13；不宣称默认模型质量数值已过 |
| Excel 选中 12 个社区操作归三类工具，另加 LO 重算；原 ZIP 缓存合并，不让整本回存破坏对象 | F-11/12；BR-05/09；新增 R9..R11 是实现责任，不伪称现成功能 |
| 原四 writer 从工具面移除，reader 保留，模板和源文件可直接继续编辑 | F-01、BR-01/10；无兼容分支、无新增用户限制 |
| 所有能力都有合法符号或 R1..R12 的明确 raise；R1 修正及 owner 平台范围澄清后全部冻结 | §6、R1 指令与下文 owner 原话；无其它设计待决接缝，不把未实现断言写成已证明 |
| r5：LO 单实例管道关不掉也挪不走；围栏新增 N5，只允许 bind/accept 本用户的 `OSL_PIPE_<uid>_SingleOfficeIPC_<hex>`，任何 unix socket 的 connect 仍被拒绝 | F-21；规格 v1 BR-04/07（U-09）。否决：按 `OSL_PIPE_` 放行全部网络操作（围栏内可以 connect 用户 LO 的管道，让它打开或转换围栏外的文件）；按 job 写 literal（profile 在 sidecar 启动时一次渲染，job 管道名事后才产生）；改 TMPDIR/HOME/`OSL_SOCKET_PATH` 或关闭管道（源码与实测均无效）；整体放行 unix socket（经 mDNSResponder 可绕过出网代理解析 DNS） |
| r5 R1：N5 之后逐条拒绝用户默认 profile（`$HOME/Library/Application Support/LibreOffice/4`）的确切管道名，管道名按 LibreOffice 规则在渲染时推算 | F-23；R1-1。否决：不排除、把它记作入站残余（实测可截获并吞掉用户的打开请求）；把放行行改成只列产品 job 的名字（job 的 hash 在运行时才产生）；把用户路径直接写进 profile（只需要 hash，不暴露路径） |
| r5：mac 运行时包目录去掉 `.app` 扩展名 | F-22。否决：展开后 `lsregister -u`（每次执行都会重新登记）；改 Info.plist 或删除 PlugIns（破坏封装签名） |
| r5：Windows 不需要对应改动 | 围栏只在 darwin 上存在；MSI 只读解包不写文件关联 |

| 轮 / 审查版本与范围 | 审计方 | finding 及处置 | 改了什么 / 验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| 首稿作者自查；代码 `9f08c506`、规格 v1、设计 `d07c5aa8a8` | Codex / GPT-6 | 作者自查，不计独立审查轮次；由以下 R1 处置与冻结收据接续 | 继承首稿的固定源码/许可、LO 元数据/配置键、迷你图保真反例、旧名扫描 10 pass、426 个相对链接与 diff 检查的 exit 0 回执；不因恢复会话重跑这些旧探针 | 运行期与正式包断言仍归实施；本次不实现、不发布、不付费跑模型 |

### R1 独立审查、处置与冻结

审查对象为设计 `d07c5aa8a8`，审查员 **Claude Opus 5.5**（只读、非作者），结论 **FIX-THEN-MERGE**，无 Blocker，4 Major、4 Minor。本次指令明确八项全部采纳，另执行第 9 项健壮性与第 10 项默认用户能力要求，修正后冻结。以下为逐项处置；Codex / GPT-6 只核对采纳与引用传播，不记作第二轮独立审查。

| finding / 级别 | 处置与最小修正 | 核对证据 / 遗留 |
| --- | --- | --- |
| R1-1 Major：删 writer 后成品面板失去来源 | **采纳并修正**。§4.4 的 rendered/pending/有成品的失败结果统一携带 DocumentArtifactRecord，投影到已持久工具 part；§4.8 的 scanLocalArtifacts 消费 sourcePath/artifactPath，保留原面板/预览；移除 OFFICE_WRITE_TOOL，并明确构建烟测消费者转用随包制作库再 reader 读回 | F-15 与 §6 R12；没有保留旧 writer 兼容，也没有新增产物登记页面。实际 panel/烟测改动属实施 |
| R1-2 Major：目录源/Excel intake/digest 未交接 | **采纳并修正**。§8 增加 alpha-web catalog-src 生产者与桌面快照消费者，冻结四条 tools/描述和 Excel 新字节 re-intake/digest 义务；§4.8 只消费生成的字节快照 | F-16；catalog/snapshot/provenance 规则已读。本文未改目录字节，实际源发布/快照/digest 由相应生产者交付 |
| R1-3 Major：补查不需要 server 适配器 | **采纳并简化**。§4.5/4.8 与 §6 R8 删除原 server resume 适配、额外 Location 路由及其 location-unavailable 错误；main 经既有桥通知拥有者 ext，直接 ctx.session.synthetic，沿现有 ID admission/queue/唤醒 | F-14、plugin promise adapter `:637`；DocumentHost.subscribeReady 与 admission 回执闭合。packages/server 零改动决定，ADR-044 面不扩大 |
| R1-4 Major：排序/替换没有透视刷新入口 | **采纳并修正**。§4.7 在 excel_edit/OfficeExcel.edit 的同一保存入口，按实际 changed ranges 与透视源相交判定，先 can_rebuild，再以恒等 request 调 rebuild；非本实现或不能重建者保留对象并给诊断和 remaining | F-17、pivot_rebuild `:56-92`；results 从当前编辑数据取，旧缓存不冒充新值；实际重建与保真结果归实施证明 |
| R1-5 Minor：嵌套技能与目录同名冲突 | **采纳并修正**。§4.1 明确七个 codepuppy-document-* frontmatter name，内部路由引用一并改名；保留现有嵌套发现渠道 | F-18；不依赖只处理顶层的 FACTORY_SKILL_IDS，也不改/删除用户已装技能 |
| R1-6 Minor：工作根污染版本控制与 watcher | **采纳并修正**。§4.1 创建工作根时写内容为 * 加换行的 .gitignore；§4.8/§6 R12 使用既有 projectWatchIgnore 排除 .document-output | F-18；只有中间物被排除，正常位置的最终成品仍在原面板可见；没有清理期限或用户操作 |
| R1-7 Minor：运行态类型硬编码 LO 版本 | **采纳并修正**。§4.3 ready.version 改为 string，实际值只取 pinned list entry | 当前 pin 仍为26.8.3；不复制版本权威，也不增加运行期更新 |
| R1-8 Minor：截图“脚本稳定”不可判定 | **采纳并修正**。§4.4 明确 load→fonts.ready→图片 decode settle→连续两帧→capture，不等待 network idle 或任意脚本终态 | 序列可直接实现且受同一执行期限；图片失败保留诊断，长动画不挡住截取 |
| R1-9 健壮性指令 | **采纳并修正**。§4.4/4.7/§5 定义180 s统一自检执行期限、提前2 s取消与到期强制终止；返回timeout且保留已生成文件/产物回执，报告未查 | 下载准备不计入，不引入文件/页数限制、额外确认或无限重试；实际卡死终结证据归实施 |
| R1-10 默认用户能力指令 | **采纳并修正**。§4.6 从同一 OfficeExcel 模块导出 inspect/apply_edit/object_schema/objects，出厂技能直接调用；连接器只是同模块另一入口 | F-16 的 default-disabled 不变；默认用户可制作 pivot/slicer/sparkline、排序查替，无需启用 MCP；§6 R9/R10 同步 |
| R1-OPTIONAL：OOXMLRecalcMode + convert-to 代替固定宏 | **本轮不采纳**。未在临时目录完成同一真实工作簿的重算/保真对照，不满足“已验证且更简单”的采用条件；§4.7 保留固定 RecalculateAndSave 宏 | 不为可选替代扩展调查，不宣称已证明替代可行；msiexec /a 仍不采用，因为会运行安装序列 |

**冻结范围**：按本次明确指令，`status=frozen`；`review.rounds=1`、`reviewed_sha=d07c5aa8a8`、verdict 为 `fix-then-freeze; R1 4 Major 4 Minor accepted and corrected`。冻结的是本次修正后的契约，不是运行实现或正式包已经通过。没有新增 owner-only 产品决定，也没有等待沉默批准。

| 范围 | 状态与影响 | 所属交接 |
| --- | --- | --- |
| §1/§2、§4、§5、§6、§8、§9 及本文审查处置 | **frozen**。仅覆盖 darwin-arm64/win32-x64，全部决定可直接消费，无待决接缝 | 实施者据此编写 plan.md；DOC-NODE-v2 的实现、实际签名/Windows/目录发布/测量证据仍按本节留存 |

### r2：owner 平台范围澄清

owner 2026-11-26 原话（协调仓工程意图 engineering，U-09 / I-37，本次 brief 引用）：「就是我需要澄清，codepuppy 不发 intel 版本的mac 电脑的包，当前只发苹果芯片的mac，以及后续会发 windows 包。」

据此，本设计只保留 darwin-arm64 与 win32-x64 的运行环境、LibreOffice pin、体积与交付责任，删除已不属于发行范围的目标及其启动器扩展请求。#1760 对两个目标的文档 bootstrap 读取面请求保留，按本次交接确认的 DOC-NODE-v2 接受契约消费；没有其它设计待决接缝，状态为完全 frozen。此次仅落实明确的平台范围，不重开 R1，不增加审查轮次或其它改动。

r2 核对回执（Codex / GPT-6）：全文平台/pin/接缝扫查 exit 0，pin 仅上述两个目标，范围外目标说明仅保留在 owner 原话中；DOC-NODE-v2 与 R1 review 收据保留。旧名扫描 exit 0（10 pass）、本文相对链接检查 exit 0（2 links）、`git diff --check` exit 0，官方文档合同检查对本文 0 finding。索引原已为 frozen，无需修改；本次只提交本文。

### r3：固定 LibreOffice 验证任务

依据实施会话 `0db0c3ade34878c02e952393a5864d440e3a2f2b` 的接缝回执，仅补 §4.9：main 经既有桥交付固定验证任务，所属 Location 的 ext 在同一受围栏 sidecar 中复用公共 CrossSpawnSpawner 执行，main 只以本代/本注册/本 Location/本 pin 的完成回执发布 ready。任务、取消、失败、退出/换代语义及消费者已落在 §4.3/§4.8/§4.9/§5/§6 R3；不新增 main 执行通道、引擎 API 或用户步骤，也不把准备失败伪装成 download。

证据为 F-19 的现有桥、Location cleanup、围栏安装和公共进程 API。临时目录探针经 `LayerNode.compile(CrossSpawnSpawner.node)`、Effect.scoped/ChildProcessSpawner.spawn 跑固定 Bun 子进程，实际得到 stdout=fixed-task-probe、exitCode=0，并能通过 AbortSignal 中断长驻子进程；命令 exit 0，回执 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/document-verify-seam-4TCdLF/receipt.json`。这只证明插件可合法消费公共执行/取消端口，不是 LibreOffice、真实围栏、Windows 或应用退出行为已经通过的证据。

**增量状态 frozen**。本次复用既有消息桥和进程/围栏权威，无新引擎接缝；按本次指令由编排器登记该小增量 review=not-required，理由为沿既有桥补齐固定任务和终结数据契约；历史 R1 review 字段/轮次不改，不冒称又做了一轮独立审查。实际固定转换、失联/退出清理与 ready 原子提交留给实施证明；无 owner-only 待决项。

r3 核对回执（Codex / GPT-6）：任务/回执/取消、注册与 generation/pin/Location 绑定、失败投影及平台范围扫查 exit 0；公共 spawner 的临时完成/取消探针 exit 0。旧名扫描 exit 0（10 pass）、本文相对链接检查 exit 0（2 links）、`git diff --check` exit 0；官方文档合同检查对本文 0 finding。只修改本文，不更新索引、不 merge、不启动应用或 LibreOffice。


### r4：Python OfficeExcel 宿主投影

依据实施回执 `d3c2190fc83a88883249e53355c563fddd1c42b5` 的 plan.md `:388,403-405`，旧 JS 对象/进程内 Symbol 无法交给 Python，重算一参 API 因而缺真实消费口。本轮只补 §4.10 与 §4.8/§6 R13：main 通过既有桥提供按注册绑定的活状态文件入口，ext 使用已存在的 shell 环境钩子和 MCP transform 注入，Python 每次/运行中/提交前读取；profile/字体按同一宿主模板生成独立 job，Location/代/pin 失效阻止旧缓存提交。Office 环境授权同步消费精确宿主值，不能用放宽 allowlist 冒充接线。

选择沿 r3 桥而不扩 v2.2：缓存槽只给稳定服务目录，仍需额外交付 Location 注册与活状态；本方案直接消费现有 Location setup 和父子进程环境，不请求 #1760 新槽、不增加引擎 API。DocumentHost.pythonEnvironment/JSON 生产消费及 Office 的宿主环境校验是本票明确新增 R13，不声称已实现。历史 R1 收据不变；本增量 **frozen**，按本轮指令由编排器登记 review=not-required（复用现有桥与插件钩子），无 owner-only 待决或 pending seam。

F-20 与命令 `git show d3c2190fc8:docs/specs/document-output-quality/plan.md` 为缺口证据；临时 Python 探针用 `subprocess.run([sys.executable,"-I","-B","-c",...])`，从宿主环境读取 UTF-8 JSON，原子替换后分别读到 preparing/ready/invalidated，且 PYTHONPATH 未进入 sys.path，三项断言 exit 0；回执 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/document-python-host-uksjt0pk/receipt.json`。它只证明非 PYTHON* 环境在隔离模式下可读、文件替换可见，不代证正式包桥/钩子接线、字体模板、Windows 原子替换/取消或真实重算；这些仍由实施验证。


r4 核对回执（Codex / GPT-6）：隔离模式/状态替换探针 exit 0；旧名扫描 exit 0（10 pass / 0 fail）；本文链接检查 exit 0（2 links）、官方文档合同检查对本文 0 finding、`git diff --check` exit 0。`affected-tests --list` 已执行，因本 worktree 缺 `.gate-tests` exit 2，未生成 scope line，不声称选择器通过；本轮只有设计变更，不补仓级配置或运行全包。索引状态/摘要未变，仅提交本文。

### r5：围栏内 LibreOffice 单实例管道与运行时登记（#1761）

依据：#1761 测量回执（2026-11-27）。在组合产品引擎内，产品自己的 LO verify 以 exit 1 结束；在围栏内 session shell 中不经模型也能复现；sandbox-exec 二分把问题定位到 N1。另有协调者追加的 LaunchServices 观察。本轮只补 §4.11，以及 §2 的 F-21..F-23（F-23 来自 R1）、§4.3 与 §4.9 各一句、§5 一条、§6 R14；网络围栏权威「落地」表的强制层一行同步记载 N5。旧的 slice 3/4 与 AC-08 证据都是在围栏外跑的，所以当时没有暴露这个缺陷；§4.11 的证明 1、2 补上这个证据缺口。

探针回执（Claude Opus 5.5，本 worktree `813ca7a98c`，首稿约 30 min，R1 修正约 15 min）：结果见 F-21..F-23。生产 profile 由 bun 调 `renderProcessFenceProfile` 渲染（exit 0），每个臂都直接用 `/usr/bin/sandbox-exec -f` 执行，没有经过包装脚本。临时目录和下载的固定 tag 源码文件已删除，本次产生的 LaunchServices/pluginkit 登记已注销；`/private/tmp` 下没有 OSL_PIPE 残留，也没有 soffice 进程。没有启动桌面应用或 Electron，没有付费调用。sandbox-exec 与生产 addon 的 `sandbox_init` 在子进程继承上语义相同，这一点是推断，以 §4.11 证明 1 为准。

**用户默认 profile 管道（R1-1 后的决定）**：只放行 N5 时，围栏内进程可以抢先监听用户默认 profile 的管道名，截获用户之后启动 LibreOffice 的 cwd/argv，并让那次启动直接退出，用户的打开请求被吞掉（F-23 对照臂实测）。因此 §4.11 在 N5 之后按 LibreOffice 规则推算并拒绝这个确切的名字，规则已用真实默认 profile 实例逐字验证。原先“入站方向、不改”的残余判断撤回。

**传播记录**（网络行约定从 N1–N4 增加 N5）：`grep -rn "N1–N4\|N1-N4" docs --include=*.md` 命中 `1662-opencode2/design.md:209,227`（「N1–N4 一字不改」）、`remote-database-connector/design.md:63,284`（「N1–N4 不变」，I1「有无此连接器逐字节相同」）、`engine-config-fence/design.md:53` 与 `stored-credentials-fence/design.md:51`（规则先后：网络行之后才是拒写块）、`child-process-write-fence/design.md:1262`（历史手写 profile 测量）、`tool-network-egress/plan.md:29,37`（使用它自己的 N 编号，属于另一个命名空间）。这些命中在 N5 加入后都仍然成立，无需修改：N1–N4 逐字未变，N5 与连接器无关，且位于拒写块之前。唯一需要同步的是架构权威 `2026-09-10-network-egress-on-process-fence.md:319` 这一行，已修改。

r5 首稿核对回执（Claude Opus 5.5，`39858d12a6`）：`bin/check-light` exit 0，包括 NUL 闸、两份改动文档的 8 个相对链接，以及 docs-anchored 的 5 个测试文件（68 pass / 0 fail，含 old-name-scan 与 network-egress-disclosure）；`git diff --check` exit 0；链接检查器对一个自建坏链返回 rc=1，证明它能报红。

**r5 R1 独立审查与处置**：审查对象为 `39858d12a6` 的 r5 增量，审查方 Codex / gpt-6.1-sol（xhigh，只读、非作者），结论 **FIX-THEN-FREEZE**；编排器转达：两项全部采纳，修正后冻结。

| finding / 级别 | 处置与最小修正 | 核对证据 / 遗留 |
| --- | --- | --- |
| R1-1 Major：N5 的任意十六进制包含用户默认 LibreOffice 的管道名，围栏内进程可以抢先监听、应答握手，截获并吞掉用户之后的打开请求 | **采纳并修正**。`FenceUnixListen` 增加 `userInstallations`；计划器传入发布版默认 profile `$HOME/Library/Application Support/LibreOffice/4`；渲染器按 LibreOffice 规则推算确切管道名，在 N5 放行行之后写 `path-literal` 拒绝行。产品 job 的放行仍是通用十六进制；撤回“入站残余不改”的判断 | F-23：推算与真实实例的管道名逐字一致（首次启动、profile 已存在、home 含中文/空格/`;` 三种情况）；对照臂截获 319 B 参数，用户启动无 PDF；修正臂 bind 返回 EPERM，用户实例照常接收转交的打开请求，产品 job 转换 rc=0。真实引擎复跑归 §4.11 证明 3、4。其它 profile 不在覆盖面内（见下表） |
| R1-2 Minor：LaunchServices 证明缺少观察条件 | **采纳并修正**。§4.11 证明 5 规定：走正式下载与展开链路；记录 quarantine/xattr；在 Gatekeeper 新评估下实际执行 verify/render 并留日志；Spotlight 确认索引后再查登记 | 签名有效不再当作可执行的证明；实际结果归实施 |

**增量状态 frozen**：按上述 R1 结论修正后冻结。历史 R1（`d07c5aa8a8`）的 review 字段与其它节的 frozen 状态不变。无 owner-only 待决项：修正不增加任何用户可见的限制或步骤；已定的 LibreOffice 路线、每 job 私有 profile、出站 unix socket 全拒均未重开。

r5 R1 修正核对回执（Claude Opus 5.5）：`bin/check-light` exit 0（NUL 闸；两份改动文档的 8 个相对链接；docs-anchored 测试 68 pass / 0 fail），`git diff --check` exit 0。探针临时目录及下载的源码文件已删除，`/private/tmp` 没有 OSL_PIPE 残留，也没有 soffice 进程；R1 探针只用临时 home，没有触碰用户真实的 LibreOffice profile。索引状态与摘要未变。

引用传播已在本文做一次接缝扫查：旧草稿启动器 SHA、按 sha256 派生的固定文件缓存、固定版本 ready 类型、脚本稳定等待、server 适配与 Location 路由决定均移除；对应当前形状在 §1/§4/§6/§8 一致。OFFICE_WRITE_TOOL 与旧 writer 只保留在“删除义务/事实证据”中，不再是有效消费端口。目录源新增的生产者依赖已落在 §8，未另创平行契约。

传播取证范围只有本消费设计：Python 字面搜索旧启动器 SHA、原 server resume 函数名、原 Location 路由类名、固定版本 ready 类型及旧摘要缓存路径，五项各为 0；旧不可用错误名仅 1 处且在 R1-3 历史删除处置中。review 字段、R1-1..R1-10 覆盖及无新旧名词元断言均 exit 0；未修改其它生产者设计，必要输入已按 §8 交接。

**R1 修正文档验证回执**：Codex / GPT-6 核对 review 字段、十项处置和冻结范围；`git fetch -q origin && git show origin/alpha:docs/specs/connector-launchers/design.md` exit 0，读取到 #1766 的冻结输入，未 merge/rebase。ui-mac 的 `bun test src/main/old-name-scan.test.ts` exit 0（10 pass / 0 fail），两份改动文档的 `check-doc-links.py` exit 0（426 links），`git diff --check` exit 0。官方 `check_repo(..., changed_since="origin/alpha")` 对本设计 0 finding，仓级仍为既有 71 errors / 250 warnings（索引/跨仓引用等），未顺带修整。仅更新生成器产出的本设计索引行状态为 frozen，不收其它索引漂移。未启动应用/窗口程序，未跑可选重算替代或付费实测。

**待 owner 定**：无（r5 同样没有：N5 与运行时目录名都是用户不可见的缺陷修正）。平台范围已按上述 owner 原话明确，DOC-NODE-v2 是已接受契约的实现依赖。ADR-014 第 5 条的准确修订仍按原保护资产流程交实施/调度方，本文未越权修改。

**仍为推断或未验证的断言**

| 断言 / 观察 | 已有证据与边界 | 遗留去向 |
| --- | --- | --- |
| Windows MSI-CAB 无安装解包、私有字体发现、LO/Office Python 的正式包可执行性 | Win32/LO 固定源码支持所选路径，但本机未运行 Windows MSI、无 Windows 真机；mac 正式签名/Gatekeeper 也未由 pilot 证明 | 本票平台实现与规格 AC-15，失败不能改为用户手装依赖 |
| 公式缓存合并保真、受影响且可重建透视表的刷新，以及图表新鲜度 | 小探针只证明上游迷你图保存边界；缓存合并器、保存前 rebuild 接线、图表缓存同步、LO 对各公式行为尚未实现；Excel 创建/重刷的不可重建透视表明确进入 diagnostics/remaining，不承诺已刷新 | 本票 R10/R11，不能把这部分写成已验证事实 |
| 平台默认模型完成质量、自检实际发现问题与中文字体单段一致 | 原强模型 pilot 与配置可行性不等于默认模型和正式包；字体实值锁/四份产物尚待构建 | 已授权的小额模型测量决定 AC-01..03 是否修订；本票按原 AC 实施验证，不在设计任务执行 |
| 固定文件的自有 release/HK 上线、真实国内续传 | 本次只读官方元数据，没有发布或实网下载 LO | §8 既有生产者；消费契约已冻结，不重开机制 |
| ADR-014 决策 5 与新规格冲突 | `.claude/rules/adrs/ADR-014-extension-hub.md:22` 仍写旧的禁止再分发和重量理由 | 精确修订受保护条款须随批准输入交实施；无相邻规则清理 |
| r5：sandbox-exec 下的结论等同于生产 addon 围栏；真实引擎中 verify/render/recalc 都能成功 | F-21 只用了 sandbox-exec 加 pilot 副本，两者是同一份 SBPL；生产环境由 addon `sandbox_init` 装在 sidecar 上，子进程继承（F-19），两者等价属于推断 | §4.11 证明 1–3，由实施交付 |
| r5：不带 `.app` 的运行时在正式下载（可能带 quarantine）与 Gatekeeper 下能照常执行；放在 Spotlight 索引的位置也不会被登记 | 探针副本来自 pilot，没有下载 quarantine；位置在 `/private/var/folders`，不是 Spotlight 索引的 `~/Library/Application Support`；`codesign` 通过只说明签名有效，不说明可执行。后者按构造推断：那里不存在可供登记的 `.app` 包 | §4.11 证明 5 按规定的观察条件在正式包下执行；若失败按 §5 平台缺口处理，不让用户关闭保护 |
| r5 R1：默认 profile 拒绝行覆盖用户实际使用的 LibreOffice | 已验证的只有 TDF 发布版的默认 profile（bootstraprc `$SYSUSERCONFIG/LibreOffice/4`），并假设 home 路径不经符号链接。用户用 `-env:UserInstallation` 自定义的 profile、LibreOfficeDev 等其它构建的 profile 不在覆盖面内；App Store 沙盒版编译期关闭管道（`officeipcthread.cxx:671`），不受影响 | 对其它构建，`userInstallations` 是类型化的列表，需要时增加一项即可，不改契约；本轮不推测它们的路径 |
| r5：已登记的 `.app` 副本会出现在「打开方式」里，并接管 QuickLook 预览 | 实测观察到 LaunchServices 应用记录和 pluginkit 中的 QuickLook 扩展登记；对 UI 的具体影响未直接观测，属推断 | 决定二直接消除前提，不另行验证 |
| r5：本机已有的 LO 登记（pilot 副本，以及两条已从磁盘消失的实施副本记录） | 不是本次登记的，未注销 | 已告知调度方，按需由所属 lane 注销；这不属于产品行为 |
| 文档索引与既有引用不是全绿 | 修改索引前官方 `check_repo(..., changed_since="origin/alpha")` 为 69 errors/252 warnings；新设计无 finding。`docs/README.md:105` 所在生成块原已 stale；只加入生成器产生的本设计一行后为 71/250，其中 `:391`、`:448` 等两类既有跨仓意图引用因索引成为 changed file 从 warning 升为 error，仍非本设计新增引用 | 告知调度方的基线观察，不调查或修复其它文档；本次范围只含本文及必要索引行 |

交接收据：依据为规格 v1、设计 `d07c5aa8a8` 的独立 R1、§1 的冻结输入更新、owner 平台澄清与 r3/r4 实施接缝回执；Codex / GPT-6 已核既有决定、§4.9 固定验证与 §4.10 Python 宿主投影契约，平台仅为 darwin-arm64/win32-x64，结论为**全部冻结，无待决接缝**。已定勿重开：技能主路、LO 渲染、不带 OfficeCLI、共享下载/启动器/视觉权威及 R1 十项修正。下一步由实施者消费本增量恢复 Python OfficeExcel 重算接线，并按 DOC-NODE-v2 集成文档读取面；遗留只有明确的实现/发布证据与默认模型测量，无产品范围扩张。

r5 交接收据：依据为规格 v1（U-09）、#1761 测量回执、协调者的 LaunchServices 观察、代码 `813ca7a98c`，以及 `39858d12a6` 的 R1 审查。Claude Opus 5.5 已在生产形状 profile 下完成 sandbox-exec 探针和只读 LaunchServices 检查（F-21..F-23）；Codex / gpt-6.1-sol 的 R1 结论为 FIX-THEN-FREEZE，两项均采纳并已修正。结论：§4.11 的 N5（只监听本用户 LO 单实例管道名，排除用户默认 profile 的确切管道名）与无 `.app` 扩展名的运行时目录，是使 verify/render/recalc 在围栏内可用、且运行时不被系统登记的最小修正。增量状态为 **frozen**。已定勿重开：LO 渲染路线、每 job 私有 profile、出站 unix socket 全拒、用户默认 profile 管道的拒绝行。下一步：实施按 §4.11 的五项证明执行。遗留去向：上表 r5 各行。
