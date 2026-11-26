---
id: DESIGN-document-output-quality
title: 助手文档与设计成品质量 技术设计
summary: 固定引入 Anthropic 技能并适配随包运行环境，以 LibreOffice、PDFium 和内置 Chromium 生成自检图；复用固定文件下载与云端识图，归并 Excel 操作，保留中文模板和离线成品。
kind: tech-design
status: draft
spec: SPEC-document-output-quality
spec_version: 1
review:
  rounds: 0
  reviewed_sha: ""
  verdict: ""
owners: [owner]
last_reviewed: 2026-11-26
---

# DESIGN-document-output-quality｜助手文档与设计成品质量 技术设计

本文是 #1761 的送审设计。只决定契约、责任和取舍；不包含改动文件清单、实施步骤或测试清单。消费规格中的既有工具卡片与文件预览，不新增页面或绘制体验稿。

## 1. 基线

- 批准输入：[SPEC-document-output-quality v1](spec.md)，提交 `31cd182e09710b603721c6f44d471b01289dd951`。固定版本读取命令为 `git show 31cd182e09710b603721c6f44d471b01289dd951:docs/specs/document-output-quality/spec.md`；覆盖 BR-01..BR-15、AC-01..AC-15。继承其 U-12 批准回执，不重新判断需求是否成立。
- 代码基线：`9f08c506d9842d319616c7e45c33d3b9c3279e48`。本文以下 main 路径简写相对 `packages/ui-mac/src/main/`，资源路径相对 `packages/ui-mac/resources/`。
- 背景：协调仓 `docs/intents/discussions/INT-office.md`，读取版本 `86a58c7bbdaad8b7c689d1c9c2845e3ce16db2a9`，重点为 P-01、P-03、P-05、2026-11-25 三次试验及 U-12。本机原始证据根简称 `pilot/`：`~/.cache/alpha-orch/2026-11-25/office-pilot/`；它只定位证据，不是产品默认路径。
- 固定下载机制：直接消费协调仓 `docs/specs/domestic-cloud-connectivity/design.md`「切片四」§4.11、§10 冻结回执，读取版本同上；继承 R1 `6b0e4c0` 的处置，不另定清单、镜像、续传或回退规则。
- 启动器输入：#1760 的 `docs/specs/connector-launchers/design.md`，固定提交 `ceeee7d4df92c7549f69f505ba173af4c7dd47e5`，仍为送审草稿。本文消费其 §4.1..4.3、§4.5、§4.7；必要交接请求见 §8，不把草稿端口当成现有实现。
- AC-01..AC-03 的分数仍归规格及已授权的默认模型实测。本文不改变分数、不进行付费调用，也不以强模型试验成绩证明默认模型能力。
- 文档影响为 feature decision；唯一落点是本文与必要的生成索引行。ADR-014 第 5 条的后续修订属于实现批准后的同项决定传播，本文不修改受保护规则资产。

## 2. 地面真相

调查只回答五个问题：可分发哪些技能与附带内容；两平台靠什么渲染与找中文字体；首次下载如何不挡住生成；模型如何实际看到每页；Excel 哪些缺口需要工具。已有权威或决定的新增端口足以承接后即停止。

| 编号 | 观察及证据 | 决定所依赖的结论 |
| --- | --- | --- |
| F-01 | `office-mcp/server.py:127-275,290-295` 暴露四对 reader/writer；`:348`、`:614`、`:658`、`:691` 的 writer 只覆盖基础结构；`:600-610` 用 `data_only=False` 读取 Excel。 | 不能靠扩充原四个 writer 的字段实现成熟生成；Excel 的 computed value 要单独补齐。 |
| F-02 | `office-runtime/requirements.in:1-5` 已有 python-docx 1.2.0、openpyxl 3.1.5、python-pptx 1.0.2、pypdf 6.16.1、reportlab 5.0.0；`scripts/build-office-runtime.ts:21-22,38-57` 只构建 mac 两架构；`ext-mcp-policy.ts:66-72,86-94` 写死 `bin/python3`。 | Python 原有打包权威继续拥有文档库；Windows 解释器、轮子和路径是本票明确新增能力。不能宣称 Windows 现成可用。 |
| F-03 | `pilot/E-skills/repo` 的 HEAD 为 `e4bb5d960d87126ff3b3a8af1a104b7db67560ba`。docx/xlsx/pptx/pdf/frontend-design/canvas-design/theme-factory 各自 `LICENSE.txt:1-4` 为 Apache-2.0。[固定提交许可证](https://github.com/anthropics/skills/blob/e4bb5d960d87126ff3b3a8af1a104b7db67560ba/skills/docx/LICENSE.txt)。docx、xlsx、pptx 各带 `scripts/office/schemas/`，包括 ISO-IEC29500-4_2016、ecma、microsoft、mce 的外部 XSD，没有相应独立许可说明。 | 技能代码与标准定义必须分开判定；不能从目录的 Apache 许可证推定第三方标准的再分发权。 |
| F-04 | 同提交 docx `SKILL.md:13-21,36-45,90-92` 采用 npm docx，假设预装、pandoc/Poppler；pptx `SKILL.md:13,155-160` 采用 PptxGenJS，字体建议偏向 Office 西文字体；xlsx `scripts/recalc.py:29,47-50,62-80,172-196` 依赖 PATH、宏和系统 timeout/gtimeout。 | 不能原封不动交给模型执行；保留制作知识，替换运行入口、渲染、重算和字体指导。 |
| F-05 | `pilot/E-skills/node/package-lock.json` 钉 docx 9.16.0、pptxgenjs 4.0.1；真实 npm lock 带 integrity。canvas-fonts 有逐家 OFL 文本，但 IBM Plex Serif 文件没有同名许可文本；本文未逐个核清字体与许可的对应关系。 | 只带需要的 npm 闭包；上游字体包不整体搬入，中文字体另取有清晰来源的 OFL 字体。 |
| F-06 | 继承试验：讨论记录 `:125-140,186-220`，Word/PPT 技能路径 10/10、11/11，Excel 一轮修改后满足样例；普通机器上的 LibreOffice 字体替代会逐字混用。`pilot/E-libreoffice/bin/soffice:4-6` 设 FONTCONFIG_FILE 和独立 UserInstallation；`fonts.conf:3-7` 指向 mac 系统字体与私有缓存。 | 这个字体配置证明“能找到系统字体”，没有证明稳定中文替代；本票补确定的中文字体与替代表。试验不等于 Windows 或产品正式包证明。 |
| F-07 | pilot 的 LibreOffice `Contents/Info.plist:1975-1978` 为 26.8.3.1；本次 Python 文件遍历得展开文件总长 805,867,141 B（不重复计 symlink）。读取官方三份 `.mirrorlist` 的 size/SHA-256，命令 exit 0，结果见 §4.3。未下载二进制。 | 版本固定 26.8.3（内部构建 26.8.3.1）；规格约 300 MB/800 MB 是量级，Windows 下载约 376 MB，不能写成三平台都恰好 300 MB。 |
| F-08 | LibreOffice [启动参数](https://help.libreoffice.org/latest/en-US/text/shared/guide/start_parameters.html) 明确 headless、convert-to、UserInstallation 和 Windows `soffice.com`。固定 26.8.3.1 的 [Windows 字体实现](https://raw.githubusercontent.com/LibreOffice/core/libreoffice-26.8.3.1/vcl/win/gdi/salfont.cxx) `:903-936` 在进程中注册安装根 `share/fonts/truetype`。本机 ElementTree 读取 pilot `Contents/Resources/registry/main.xcd` 的 Substitution/FontReplacement 节点（exit 0），确认 Replacement、FontPairs、ReplaceFont、SubstituteFont、Always、OnScreenOnly 的真实键与类型。 | Windows 可用应用私有解包根的字体目录；不能拿 mac FONTCONFIG_FILE 当 Windows 字体发现机制。具体成品效果仍待 Windows 真包实证。 |
| F-09 | `rail-preview-host.ts:351-378,463-508`、`html-preview-host.ts:214-250` 已有隔离 session、自定义协议、禁外网与导航；`src/office-preview/index.ts:47-94` 分别用 docx-preview/PPT viewer/spreadsheet viewer。 | 可复用隔离权威，但现有 Office 预览不等于 LibreOffice 自检。Chromium 的逐页/全页面导出端口尚不存在，须明确新增。 |
| F-10 | `packages/core/src/tool/plugin/read.ts:258-267` 把图片作为 file content 交模型；`packages/ext/src/cloud-vision-hooks.ts:104,137-175,210-239` 为不能看图的模型登记 Read 图片、压缩、转写及按引用追问；能力取 modelFacts 的 capabilities.input，未知按不能看图处理。 | 模型逐页 Read 后走现有云识图；无需新视觉服务、模型白名单或渲染器上传。 |
| F-11 | `pilot/F-excel/logs/x3_tools.json` 是社区 server 2.3.2 实际 tools/list，共 46 个工具。已安装 METADATA 标 MIT；`excel_mcp/operations/calculated.py:27-47` 先读缓存，仅缺缓存时尝试自带公式计算。`workspace.py:315-338` 用 `package.prepare/apply` 保存扩展。 | 计算结果不能因有缓存就冒称新鲜重算；选用操作层与保真保存层，不运行它的 MCP/HTTP 服务。 |
| F-12 | 本次临时探针复制真实 `F-excel/X3-community/work/sales_x3.xlsx`；调用 2.3.2 的 `Workspace.edit`、`operations.sparklines.add_sparklines` 后再次 edit/save，迷你图 part 数为 1→1；同一文件改用普通 openpyxl load/save 为 1→0，且真实报“不支持 Sparkline Group”。命令 exit 0；回执 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/document-design-probe-kyey3nss/receipt.json`。 | 保存保真是实际边界，不能让模型在创建这些对象后随手整本 openpyxl 回存。探针只证明迷你图，没有冒称证明全部对象。 |
| F-13 | `factory-skills.ts:20-56,109-117` 与 `reconcileFactorySkills` 是出厂技能来源/嵌套发现权威；`packages/ext/src/plugin.ts:160-176` 通过 tool.transform 注册自有工具；工具文案归 `context-injection.ts`。 | 用既有出厂渠道和工具注册，不引入 Claude 插件运行器或另一份技能发现机制。 |
| F-14 | `packages/plugin/src/promise/session.ts:199-220` 向插件公开 session.synthetic；`packages/core/src/session.ts:244-246,528` 是全局 Session.Service.synthetic；协议 `groups/session.ts:398-415` 已支持 id、delivery、resume，精确冲突报错。`LocationServiceMap.Service.get`（core `location-service-map.ts:9-16`）已有 Location 执行面。 | 就绪后的补查有合法的持久合成输入口；需要的是本票的宿主桥和待查记录，不是改现有发送通道或另造会话队列。 |

外部包元数据补核：PyPI `pypdfium2/5.0.0/json`（本次 urllib 读取，exit 0）列出 mac arm64/x64、win_amd64 wheel；许可证为 BSD-3-Clause、Apache-2.0 及 dependency licenses。[Python API](https://pypdfium2.readthedocs.io/en/stable/python_api.html) 提供 PdfDocument、逐页 render。其实际随包加载尚未验证。所有本次探针只运行 Python/读元数据，没有启动桌面应用、Electron 或 LibreOffice。

## 4. 接口契约

### 4.1 技能、运行环境与许可

**决定：固定快照、适配后随包、出厂加载。** 引入 F-03 的七个技能；`office-docs` 保留为六种成品的路由与自检总入口，对应技能通过既有 factory nested discovery 按需加载。只注入短路由，不把七份正文和 Excel 操作 schema 每次全部塞入上下文。模型称呼统一为“助手”；去掉 Claude 专属路径、上传交付、预装包/apt/brew、失败后 npm/pip install 及 Linux 专属命令。没有用户新增的确认步骤。

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
}
```

模型通过现有 shell 工具运行本地脚本，使用 environment 返回的入口；npm 库从绝对 nodeModules 路径加载，不依赖 ESM 对 NODE_PATH 的支持。Python 文档库由原 Office runtime 的构建锁继续负责，补 Windows 的 CPython 3.11.15/同版文档库闭包；不共用 #1760 的第三方连接器 Python 环境。PDF 栅格化增加 pypdfium2 5.0.0，Excel 操作需要的 pydantic 及其闭包均在构建期锁版本/哈希和随包，运行时不安装。Node 只消费 #1760 的入口与签名方案，不再带第二份 Node。文档 npm 包也在构建期按 F-05 精确版本和 lock integrity 备好，不通过 npx 启动。

最终成品仍写用户指定的项目位置。模型要读取的 PNG/局部图统一写 `workRoot/<checkId>/<revision>/<renderId>/`，在同一已授权工作区内，避免为了自检再触发外部目录读许可；LO profile、临时展开和待查日志仍在 userData，二者不混淆。main 的 Chromium 输出也必须绑定当前工作区授权与源/目标真实路径，不能借宿主桥扩大写权限；不改 HOME 或新增清理到期策略。

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
| `libreoffice/darwin-x64/26.8.3` | `26.8.3` / `26.8.3/mac/x86_64/LibreOffice_26.8.3_MacOS_x86-64.dmg` | `309939485` / `bb3c35d628780510915ad9e759d7ed898094d7985d01b2181bd1d4ecd94fd159` |
| `libreoffice/win32-x64/26.8.3` | `26.8.3` / `26.8.3/win/x86_64/LibreOffice_26.8.3_Win_x86-64.msi` | `376311808` / `0e6918c273eabbdbbd800ee0dacbbf130a14c13c2e4cec861b06dd59e015bf94` |

F-07 的读取命令用 urllib 读取三份 `provenanceUrl + ".mirrorlist"`，提取 Size 和 SHA-256；是官方元数据，不是本次下载验真的摘要。发布者核对副本 bytes/hash 后才提交可消费 entry。香港优先、失败后原地址从 byte 0 重取、同来源有效 part 的续传、取消、完整性/磁盘错误、缓存重验，全部沿用冻结机制。这里的“原地址”是自有 GitHub release 副本，不临时回 TDF。

存储统一派生自 USER_DATA_LAYOUT：下载缓存 `<userData>/pinned-files/<sha256>/<filename>`；展开 runtime `<userData>/document-runtime/libreoffice/<target>/<version>/`；job profile、font cache、临时文件与检查记录在同一 document-runtime 下的独立子目录。安装资源只读。mac 下载约 300/310 MB，展开实测约 806 MB；Windows 下载约 376 MB、展开体积尚未测量，磁盘错误如实报告，不以约 800 MB 做人为容量闸。

mac 用系统 hdiutil `attach -readonly -nobrowse -noautoopen -mountpoint <私有临时挂载点>`，复制原 LibreOffice.app 到临时展开根后卸载；不运行安装器、不写 /Applications、不改上游签名或去 quarantine。Windows 用随包 Python ctypes 调 `MsiOpenDatabaseW(MSIDBOPEN_READONLY)`、查询 Directory/Component/File/Media/_Streams、`MsiRecordReadStream` 取 CAB，再用 Cabinet API `FDICopy` 按 MSI 目录表还原到临时根；不执行安装序列、自定义 action、msiexec 或系统注册。Windows 的这个解包适配是明确新增端口，依据是 [Windows Installer 只读数据库](https://learn.microsoft.com/en-us/windows/win32/api/msiquery/nf-msiquery-msiopendatabasea)、[CAB 文件键](https://learn.microsoft.com/en-us/windows/win32/msi/cabinet-files)、[FDICopy](https://learn.microsoft.com/en-us/windows/win32/api/fdi/nf-fdi-fdicopy)；尚未在该 MSI 实物/Windows 上运行。二进制原字节保留，解包路径不越界；不得以需要管理员权限为解决办法。

展开后入口为 mac `LibreOffice.app/Contents/MacOS/soffice`、Windows `program/soffice.com`。在独立 profile 中完成版本核对、字体配置和最小实际转换后原子发布 ready；仅有包或目录不算 ready。独立 profile 禁 online update、扩展自动更新、宏自动执行和外部链接更新。渲染/重算进程走 Location 的现有执行/权限面并禁出网；下载只有宿主的固定文件入口可联网。应用不检查 LO 新版本，更新由以后应用版本的清单决定。

```ts
type DocumentRuntimeState =
  | { phase: "preparing"; stage: "download" | "extract" | "verify";
      received?: number; total?: number }
  | { phase: "ready"; version: "26.8.3"; executable: string }
  | { phase: "failed"; failure: ConnectorLaunchFailure }
```

这是本票文档 runtime 的状态，不伪造“连接器尚未连接”。失败直接复用 #1760 的 ConnectorLaunchFailure 和已有呈现/助手交接：固定文件失败映射 download；磁盘/解包/启动异常带完整诊断归 unknown；不要求用户安装 LibreOffice。复用 progress 单位和失败动作，不给 #1760 的 ConnectorLaunchState 私加一个 stage。环境查询第一次触发后台准备并立即返回；准备过程没有整包总时限。普通文档库和读工具启动不等待 LO，工具卡片通过同一状态流显示真实下载字节与阶段。

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
type RenderReceipt = {
  id: string; checkId: string; revision: 0 | 1
  kind: DocumentKind; sourcePath: string; sourceSha256: string
  artifactPath: string; artifactSha256: string
  renderer: "libreoffice-pdfium" | "pdfium" | "chromium"
  rendererVersion: string; pages: RenderPage[]; pageCount: number
  template: { source: "bundled" | "user"; path: string; sha256: string } | null
  diagnostics: string[]             // 含替代字体、外部引用失败，不等于视觉检查
}
type RenderResult =
  | { status: "rendered"; receipt: RenderReceipt }
  | { status: "pending"; checkId: string; runtime: DocumentRuntimeState }
  | { status: "failed"; code: "invalid-input" | "source-missing" | "runtime" |
      "conversion" | "raster" | "disk" | "source-changed"; detail: string }
```

所有字段经 schema 验证；格式须与文件/容器一致，非法参数不执行 I/O；路径沿现有工作区授权与真实路径校验，不带入预览器的文件/页数上限。dpi、viewport 只定义本请求所需精度/画布，不新增产品选项。HTML 未给 viewport 时默认 1440×900 CSS px；design 未给时从源声明的画布尺寸取，源也未声明则助手按任务选择尺寸。Office/PDF 每页按 144 dpi 全量栅格化；网页按完整 scrollHeight 分段出图（片段高为 viewport.height），不能只截首屏。图片不因工具上下文容量而被省略；页多时模型逐批 Read。设计导出 PNG 是完整画布成品，另可分片检查，不能只交第一片。

首次 render 省略 checkId、revision 默认 0，工具分配并返回 checkId；修正后的 render 带同一 checkId、revision=1，必须属于当前会话/Location 的同一成品。renderId 每次新分配，工具不把重渲染当成新一次修正；原始检查、修正、复核的身份由此闭合。环境查询不是生成完成回执，template 字段取实际选中模板的来源记录和哈希，未知时为 null，不能凭模型口头声称填入 bundled。

| 格式 | 唯一自检渲染路径与关键语义 |
| --- | --- |
| Word | 原成品只读快照 → 私有 profile 的 LO，`--headless --nologo --nodefault --norestore --convert-to pdf:writer_pdf_Export --outdir <job>` → pypdfium2 `PdfDocument`、逐页 `render(scale=dpi/72)`、Pillow PNG。目录/页码域在渲染副本更新；成品目录不能只剩空域。需要无需刷新即可见的目录时，制作脚本按实际渲染页码写入目录正文/域缓存后再渲染核对，沿同一轮修正，不靠用户手工刷新补齐。 |
| Excel | §4.7 先重算 → 成品快照 → `pdf:calc_pdf_Export` → 同一 PDFium。尊重各 sheet 的打印范围、分页、重复表头、方向与缩放；输出全部可打印页，不强行缩成一页或拿网格预览代替打印版面。 |
| PPT | 成品快照 → `pdf:impress_pdf_Export` → 同一 PDFium；每张普通幻灯片对应一页，讲者备注仍保存在 PPT，不用备注页冒充幻灯片数。 |
| PDF | 直接 PDFium 解码每页，不经 LO/重排/截图浏览器工具栏；pageCount 来自真实 PDF，记录每页尺寸。 |
| HTML / design | main 的离屏 Chromium 载体消费文件快照；复用既有隔离 session/protocol/零外网规则，等待 fonts.ready、图片 decode、应用脚本稳定后通过 `webContents.capturePage` 分片。固定画布直接导出 PNG，必要 PDF 导出用内置 `printToPDF`；无外置 Chrome/Playwright 浏览器下载。 |

LO 进程每 job 独立 UserInstallation，不和用户开的 LibreOffice 争用 profile，也不借用户的安装路径。转换进程退出 0 仍需确认新 PDF 存在、非空、可解码；stderr、页数与 renderer 版本保留。生成输出不因渲染失败被删除。PDFium 使用同版跨平台 wheel，与现有 pypdf 分别承担“画出来”和“读结构”，不增加 Poppler 系统命令依赖。

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
  request: RenderRequest; sourceSha256: string
  revision: 0 | 1
  state: "waiting-runtime" | "admitting" | "admitted" | "complete"
  report?: DocumentCheckReport
}
```

Location/Session/SessionMessage 类型直接消费现有 schema，不另发明 ID 域；notificationID 用 `SessionMessage.ID.create()` 分配一次并持久化。`checkId` 在首次 render 建立；render receipt 与检查记录按同一 checkId 归档，revision 1 仍属同一成品任务。check 参数必须匹配已存在 receipt 的源摘要和页序，不能拿旧版截图给新版盖章；工具记录实际 Read 的页面摘要关联，并从既有视觉路径取得成功/失败事实。inspectedPages 与 uninspected 必须不重叠地说明全部页，后者可以非空；工具返回 `{status:"recorded",coverage:"complete"|"partial",checkId}`。final=false 只记本轮观察，final=true 才标 complete。页未读取/视觉失败只记不完整，请助手如实报告，不能制造“已通过”；这些输入记录也不能机械证明模型已经理解图片，发现并修正溢出仍以规格的真实成品结果为准。这不是文件下载/交付闸：文件一直在项目中，存在问题也交付并明说。

视觉能力判定直接消费 F-10：能看图的模型得到 Read 的原生图片；不能看图时，同一次 Read 在已有 cloud vision hook 登记与自动转写，助手使用 `cloudVisionToolId(bootstrap)` 对已读路径逐页问“中文缺字、遮挡、溢出、分页、图表标签”。复用既有按图哈希缓存、压缩、鉴权、拒绝与计费规则；不并行偷偷换模型、不向新服务上传。高密度页按局部图片再读，沿同一入口识图。云识图不可用时报告哪些页尚未检查；绝不把无图的文本提取当视觉检查，后续继续处理沿已有失败恢复。断网能力指本地生成/渲染本身；不能看图的模型不会在断网时凭空得到云视觉结果。

工具卡片复用现有执行流：shell 制作卡片标题为“生成”，document.render 为“渲染”，Read/vision 与 document.check 为“检查”；进度从真实 render/runtime 状态和工具 metadata 投影，没有新增视图。最终一两句话概括检查范围、修正和剩余问题；报告存本地，不把长技术记录塞进用户成品。

**LO 尚未 ready 时立即走 BR-08。** Word/Excel/PPT 生成不等待环境准备，render 返回 pending，同时宿主原子落 DeferredDocumentCheck；助手先交文件，并明说“版面尚未检查”；Excel 同时写明重算若未完成，不能谎称无公式错误。PDF、HTML、海报仍可当次检查。

下载/解包就绪后，宿主按 pending 记录请求 sidecar 的窄桥 `resumeDocumentCheck(checkId)`，桥在 server 自有接线层调用现有 Session.Service.synthetic：`id=notificationID`、`delivery="queue"`、`resume=true`，text 为应用固定的补查指令与本地成品引用、metadata 为 checkId/源摘要；不会冒充用户新要求。插件在原 Location 执行同一 render→Read/vision→check，至多一轮修正，回复原会话。新任务晚到时 queue 只在其可用边界处理，不打断正在进行的用户工作。

该桥是明确新增能力，`Session.Service.synthetic` 已有持久 admission 与精确 ID 重试。main 不导入 core；server 适配消息，按真实 Location 路由到现有执行面。记录在收到 admission 回执后才从 admitting 变 admitted，断线重发同一 notificationID，不新增会话队列/重试引擎。应用重启后读取 waiting/admitting 继续这一项已授权补查；admitted 不再新建合成消息。这个过程只新增本功能输入，**不把现有 composer、配置、permission 或其它生产路径从一代引擎切到另一代**。

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

脚本侧 `OfficeExcel` 是 `from codepuppy_office import OfficeExcel` 的随包模块（装在 Office Python 自身 site-packages，`-I` 也可 import）；导出 `edit(path: str) -> ContextManager[openpyxl.Workbook]`、`recalculate(path: str) -> ExcelRecalculateResult`。结果可序列化为 §4.7 的同一 JSON 联合，MCP/文档工具与脚本都消费它；不让实施者另选一个未定义的导入入口。

### 4.7 Excel 重算、公式缓存与对象保真

```ts
type ExcelRecalculateInput = { path: string }
type ExcelRecalculateResult =
  | { status: "recalculated"; id: string; path: string; sourceSha256: string;
      resultSha256: string; formulaCount: number; errors: FormulaError[] }
  | { status: "pending"; checkId: string; runtime: DocumentRuntimeState }
  | { status: "failed"; code: "source-changed" | "runtime" | "calculation" | "disk";
      detail: string }
```

**LO 是最终重算权威，社区 evaluator 仅是未就绪时的有标记读取辅助。** 原文件复制到 job 目录；独立 LO profile 执行应用固定的 RecalculateAndSave 宏（来源为上游 xlsx/scripts/recalc.py 的 calculateAll/store 做法），只打开该副本、calculateAll、另存 xlsx、关闭。入口/宏是应用固定资产，文件路径用参数/正确 URI 编码传递，不能把用户字符串插进 Basic 代码。文档自带宏和外部链接不执行。两平台都由 Python subprocess 管理退出/取消，不依赖 Linux timeout 或 mac gtimeout；实际转换过程不假成功。

从重算副本按工作表身份和单元格坐标读取公式缓存值及错误，再在**原始 ZIP** 对应公式单元格中更新 `<v>` 和缓存结果的类型；保留 `<f>`、格式、所有非目标 part、extLst、pivot/slicer/sparkline 与图表关系。共享/数组公式按实际 OOXML 范围映射；字符串结果正确写缓存 string 类型，不能误作 sharedString 索引。原公式与副本表达式若不等价或结果缺失，明确标 calculation incomplete，不把空缓存当成功。生成图表所用公式值也必须在重算后同步对应 chart cache，仍保留图表对象和关系。

该缓存合并器是本票明确新增能力 `OfficeExcel.recalculate(path)` 的一部分，不是现有 openpyxl/LibreOffice 自动保证；返回 FormulaError 包括 #REF!/#DIV/0! 等实际错误的 sheet、cell、formula。0 错误与汇总值核对使用重算后的值。LibreOffice 回存的整本文件只作计算/渲染中间物，绝不能替换最终工作簿；切片器在 LibreOffice 中的交互支持程度也不能靠截图宣布与 Excel 相同。

排序/替换或修改原始数据后，先更新依赖的透视缓存/显示结果（消费上游 pivot/slicer 操作维护能力），再重算并刷新图表缓存、渲染；不能保住了 slicer XML 却把统计结果留在旧版。重算前后的源摘要一致才原子合并；并发变化返回 source-changed 并重新读取当前文件，不能覆盖用户修改。整个过程只有“重算值与缓存同步”这一存储权威，不在 reader 里另写计算器。公式错误是检查结果，不阻止文件交付，助手在同一轮修正中处理并报告余项。

### 4.8 宿主边界与现有工具去向

四个 `write_docx/write_xlsx/write_pptx/write_pdf` 从本版 advertised tools、dispatch、清单/权限元数据中移除，不改造成另一套宽 JSON 写入器，不保留旧调用别名。`read_docx/read_pptx/read_pdf` 保持既有内容读取；`read_xlsx` 依 §4.6 增强。四个首方连接器 ID 与现有定制中心条目保留，Excel 不出现社区第二项。生成脚本仍过现有 shell/文件权限；不能借“出厂技能”绕过权限，亦不另问一次本地执行确认。

跨 bundle 的新增 **DocumentHost** 由 ui-mac main/sidecar 的既有 ID 请求应答桥承载，util 只持有纯数据与发布端口；不让 ext/core import main。下面的签名是本票决定 raise，不声称存在：

```ts
type DocumentHost = {
  environment(caller: { location: Location.Ref; sessionID: Session.ID }): Promise<DocumentEnvironment>
  chromiumRender(input: { caller: { location: Location.Ref; sessionID: Session.ID };
    checkId: string; revision: 0 | 1; request: RenderRequest;
    sourceSha256: string }): Promise<RenderResult>
  defer(input: DeferredDocumentCheck): Promise<void>
  recordCheck(input: { caller: { location: Location.Ref; sessionID: Session.ID };
    checkId: string; report: DocumentCheckReport }): Promise<void>
}
declare function publishDocumentHost(host: DocumentHost): void
declare function documentHost(): DocumentHost
// server 适配器；checkId只能引用宿主登记的待查记录。
declare function resumeDocumentCheck(checkId: string): Promise<
  { ok: true; notificationID: SessionMessage.ID } |
  { ok: false; reason: "session-missing" | "location-unavailable" | "conflict" }
>
```

bootstrap 只新增 DocumentEnvironment 的资源路径/资产锁投影，不序列化函数；publish 在引擎启动前每代一次。caller 由 ext 当前 Tool.Context/Location 绑定，经 server 桥核对，不是模型输入；main 据此派生 workRoot 并核对 checkId 的归属。复用 #1760 的 pinned-file 请求、LauncherEnvironment 与诊断/失败动作；本票只增加 document.environment/render/defer/record-check/resume 的窄消息和 runtime.changed 通知。消息带 request id、sidecar generation，进度带递增 sequence；停止/退出终结本代请求，旧回包不覆盖新状态。main 只获取固定 LO 文件和拥有 Chromium 渲染；Python 制作、重算、PDFium 与 Excel 操作在现有 Location 执行面内运行，不把任意模型脚本或任意 URL 交给主进程执行。

## 5. 数据与失败

- **文件发布**：生成器先写同目录临时文件后原子替换成品；渲染只读快照。runtime 和 render receipt 完整发布后才可引用；源摘要、renderer、页数及页摘要可关联，旧 PDF 不因同名成为新渲染结果。缓存键含源摘要、渲染器/字体版本、dpi/viewport，不设 TTL 或人工容量帽。
- **并发边界**：同一 LO pin 的准备复用共享下载与一次展开；各文件 job 独立 profile，避免 LO 把命令交给别的进程。Excel 的同文件编辑串行且在保存时比较源摘要；不同文件不加本设计的并发上限。停止某次渲染不取消其它消费者仍需要的下载。
- **BR-08 窗口**：先持久化待查记录再返回 pending；ready/admission 之间崩溃可用相同 notificationID 重发；已 admission 未答复不再新建输入。后续执行失败沿现有 Session 错误与 pending 记录可恢复，不虚构成功。没有自动反复进行第二轮、第三轮修正；新的用户要求是新的任务。
- **下载失败**：沿 #1760 的失败类型/动作及固定文件错误处理，已生成文件保留，原会话获知尚未查。网络恢复/用户现有重试动作继续同一准备流程，不要求手工安装、清缓存或改系统保护。mac 正式签名/Gatekeeper 或 Windows 解包实物失败须作为平台实现缺口处理，不能改成让用户关闭保护。
- **视觉失败**：按实际已读页、已识图页报告覆盖范围；云识图额度/鉴权/拒绝归原服务，不在文档功能制造新批准或配额。原稿、渲染图和剩余问题都在本地；只有 F-10 这条不能看图时的识图路径上传图片。
- **离线及不可信内容**：生成/转换无更新检查，无运行期 npm/pip/字体下载；Office 外部关系、HTML URL 与文档中的指令都是输入数据，不提升到 system 指令。LO 禁外部更新和文档宏，Chromium 禁外网；不会为了画出一个远端图片而替用户联网。

## 6. 架构落点

按[现有模块图](../../architecture/modules.md)落在既有 ui-mac、ext、util/schema、core/server 责任内；不新增顶层包或业务框架。资源子树仍属 ui-mac 的随包资产，执行逻辑仍属其既有宿主/扩展责任。

| 责任 | 模块与依赖 | 现有权威及约束结论 |
| --- | --- | --- |
| 技能、Office Python/npm/字体/模板构建与许可 | ui-mac 资源/打包；消费 #1760 Node 与现有 Office lock | `factorySkillSources/reconcileFactorySkills`、`build-office-runtime`；不再造环境版本表。Windows 路径统一由资源解析投影，已知 Office command 展开重复只在本票必需路径上消费同一结果，不全仓重构。 |
| 固定 LO 获取、展开、待查记录、离屏 Chromium | ui-mac main；消费 util 的纯契约及 OS/Electron | `resourcesRoot`、USER_DATA_LAYOUT、ensurePinnedFile、现有预览隔离；没有连接器直接下载或主进程执行模型代码。 |
| 制作路由、文档工具、自检与视觉 | ext + 现有 Location 工具执行面 | `createCodePuppyTools` 模式、shell/read/skill、createCloudVisionHooks；不引入第二个视觉上传口或模型能力表。 |
| Excel 保真操作、公式缓存、PDF 栅格化 | 现有随包 office-mcp/Office Python 责任 | server 的 workspace path 校验与原子替换，选中 MIT 操作层及 package 保存层；图像入口统一 PDFium。 |
| 就绪补查的持久合成输入 | server 自有 sidecar 接线，消费 core Session.Service；契约在 util/schema | `Session.Service.synthetic` 已有入队/唤醒；不从 ext 反向依赖 core，不从 main import server，不改已有代际路径。 |

### 能力接缝总表

R 表示**已决定新增**的端口，范围及签名以 §4 为准；不是尚待实施者自行选择的空绑定。

| 依赖能力 / 对应 AC | 已有可调用符号或决定的 raise |
| --- | --- |
| 出厂技能按需发现、六种制作 / AC-01..04、12 | `factorySkillSources`、`reconcileFactorySkills`（main factory-skills `:36,148`）、`SkillTool.Plugin`（core `tool/plugin/skill.ts:32`）、`ShellTool.Plugin`（`:101`）；**R1**：§4.1 的 vendoring/适配/模板与环境投影。所有正文制作能力由随包 docx/PptxGenJS/openpyxl/reportlab API 实现，不再依赖四个 writer。 |
| 跨平台资源入口 / AC-09、15 | `resourcesRoot`（ext-fs-installer `:260`）、USER_DATA_LAYOUT（`:4`）、#1760 LauncherEnvironment；**R2**：§4.1 DocumentEnvironment，Office Python 的 win32-x64 构建/解析与文档 npm 闭包。 |
| LO 下载与准备 / AC-06、09、10、13 | 冻结 ensurePinnedFile（协调设计 §4.11.4，由 #1760 实现）；**R3**：§4.3 的本平台 pin 选择、hdiutil/Windows MSI-CAB 只读解包、ready 发布及 runtime.changed。源、副本与许可材料由 §8 发布责任交付。 |
| Office/PDF 逐页栅格化 / AC-04、06、08 | 上游 soffice headless CLI、PDFium `PdfDocument/page.render`；**R4**：§4.4 的 document.render 和 receipt，借 Location Environment 执行，144 dpi 全页，路径/页摘要/版本真实记录。 |
| HTML 离线和海报 / AC-04、13 | `resolveWorkspaceFile`（workspace-file-service `:59`）、Electron `webContents.capturePage/printToPDF`；**R5**：§4.4 的离屏载体及预览隔离权威共用、整页分片/完整 PNG 导出。现有 openRailPreview 不是这个端口。 |
| 字体与模板 / AC-08、12、14 | F-06 fontconfig、F-08 Windows 私有字体发现、reportlab TTFont；**R6**：§4.2 同一字体资产/映射与模板来源记录、§4.1 许可/排除清单。 |
| 模型实际看图、至多一轮 / AC-05、06、13 | `ReadTool.toModelContent`（core `tool/plugin/read.ts:258`）、`createCloudVisionHooks`（ext `cloud-vision-hooks.ts:104`）、`cloudVisionToolId`（cloud-vision）；**R7**：§4.5 check 记录、读取关联和渲染/检查卡片投影。 |
| BR-08 晚到补查 / AC-10 | `Session.Service.synthetic`（core session `:244,528`）、`LocationServiceMap.Service.get`（`:13`）；**R8**：§4.5 待查记录、§4.8 DocumentHost/resumeDocumentCheck 窄桥和回执；不隐含另一个后台助手服务。 |
| Excel 区域、结构、排序查替 / AC-07、11 | 社区 2.3.2 `operations.calculated.read_calculated:27`、`cells.read_range:183/find_cells:296`、`sorting.sort_range:57`、`replace.replace_cells:23`；结构来自 server/workbook_tools `:44`、sheet_tools `:22`；**R9**：§4.6 的首方 inspect/edit/read 合约、分页和缓存来源标记。 |
| 透视/切片器/迷你图及保真 / AC-03、11 | 2.3.2 `operations.pivot.create_pivot:70`、`slicers.add_slicer:70`、`slicer_manage.delete_slicer:124`、`sparklines.add_sparklines:28/delete_sparklines:53`、`Workspace.edit:185`、`save_atomically:315`；**R10**：§4.6 的 objects 按需类型适配与共用 `OfficeExcel.edit`，保留 package 权威，去除非格式配额。 |
| Excel 新鲜算值与错误位置 / AC-03、07 | 上游 xlsx recalc 固定宏做法、pypdf/openpyxl 的只读解析；**R11**：§4.7 `OfficeExcel.recalculate`/excel_recalculate，LO 副本计算、原 ZIP 缓存合并、错误定位及图表/透视缓存同步。不可宣称这些已由 LO 自动保真。 |
| 工具注册、权限与清单 / AC-05、11、14 | ext tool.transform（plugin `:160-163`）、`tools_for/call_tool`（office-mcp server `:127,290`）、现有工具 provenance/permission 清单；**R12**：§4.8 移除 writer、增强 Excel、增加文档工具与真实 runtime 进度，同步既有清单权威，不维护影子工具表。 |

K1：权限档位权威不变。K2：下载、环境、技能发现、视觉、Excel 保存和预览隔离各一个拥有者；新增消费不复制。`constraints.md:31` 已记 Office 命令展开的既有重复，Windows 入口本次必须走同一资源投影，不能再加第五份；其余既有偏离不在本票清理。依赖保持 Schema→Core/Protocol→Server，Client 不依赖 Core/Server。无必要架构例外。

**被否决的替代**：OfficeCLI（U-12 明确不带）；HTML→PPT（试验字体与图表数据失真）；让用户安装依赖（BR-07/15）；整套社区 46 工具（定义成本大且 BR-09 只需补缺）；社区 evaluator 作最终重算（有缓存时不重算）；LO 回存覆盖最终 xlsx（扩展对象保真无保证）；复用用户预览截图作为 Office 自检（渲染来源不满足 BR-04）；预装包/apt/下载 Poppler、pandoc 的上游假设（当前生成和逐页渲染已有更小闭包）；新云文档服务（BR-13）。

## 8. 拆分决定

同仓制作、渲染、Excel、自检不是独立跨仓任务，本节不拆实施工作单元。只有以下已有所有权边界：

| 产出方 / 负责 | 产出与 AC / 小节 | 消费契约 | 开工依赖 | 集成/验收依赖 |
| --- | --- | --- | --- | --- |
| #1760 的桌面启动器拥有者 | 随包 Node/npm、LauncherEnvironment、固定文件公共口与失败呈现；AC-09/15、§4.1/3/8 | 其固定设计；国内固定文件机制 | 已批准规格；本文不修改它的环境权威 | 该设计批准并实现。本设计请求把文档消费者纳入其合法 bootstrap 读取面；现有 mac x64 包也需其 Node/platform 投影支持 darwin-x64，不能由本票带第二份 Node。这个 target 扩展须回该设计处置；Windows Office Python归本票，不让其第三方环境代替。 |
| 本票的发行资产生产者 | TDF 三份原字节副本、精确 pin 与源码/许可材料；AC-09/14、§4.3 | 冻结 PinnedFiles 与 §4.3 身份 | 本设计批准、实际发行资产可取得 | 先附加到已公开自有 release 且可取，再提交完整 originUrl；对应清单提交供入口消费。本文没有生产发布授权。 |
| 国内固定文件入口拥有者 | 从桌面固定清单提交投影白名单；AC-09、§4.3 | 冻结切片四的清单快照/锁/relay 规则 | 已冻结共享设计与真实清单 | 香港入口部署匹配该快照；应用真实改道/续传/国内下载证据，不以读取 TDF 元数据代替。 |

不向 #1760 请求文档专属下载器、另一套 preparing 或新包管理器。darwin-x64 是明确的共享输入请求，批准前不能把该目标写成已 ready；已具备的 mac arm64/Windows 设计不因等待这个接缝重开。

## 9. 回滚

不适用。无旧数据迁移或不可逆数据变更，不设计旧 writer 兼容、旧记录迁移或旧版运行路径。原子临时文件与源摘要冲突处理是本次正确写入边界，不是版本回滚方案。

## 10. 裁决与审查结论

| 送审前裁决 | 依据与适用版本 |
| --- | --- |
| 七个固定 Anthropic 技能适配随包；排除全部外部标准 XSD、未逐文件核清的上游字体及非必要字体演示 | F-03..05；规格 v1 BR-01/11/14；不再沿用 ADR-014 的失效许可证判断 |
| Python 文档环境沿现有锁补 Windows；Node 完全消费 #1760；文档 npm 库构建期锁定，运行期不安装 | F-02/04/05；BR-07/11/15；mac x64 输入请求归 §8 |
| LO 26.8.3 三目标固定文件，首次使用后台准备；不带 OfficeCLI，不挡生成，ready 后原会话补查 | F-07/08/14；BR-07/08、U-12；共享切片四原样消费 |
| Office→LO PDF→PDFium；PDF直接PDFium；HTML/海报内置Chromium；两平台分别配置中文字体发现 | F-06/08/09；BR-04/06；Windows 实物行为尚未验证 |
| 逐页检查、至多一轮修正，复核当前文件；不能看图的模型沿 Read+现有识图 | F-10；BR-03/13；不宣称默认模型质量数值已过 |
| Excel 选中 12 个社区操作归三类工具，另加 LO 重算；原 ZIP 缓存合并，不让整本回存破坏对象 | F-11/12；BR-05/09；新增 R9..R11 是实现责任，不伪称现成功能 |
| 原四 writer 从工具面移除，reader 保留，模板和源文件可直接继续编辑 | F-01、BR-01/10；无兼容分支、无新增用户限制 |
| 所有能力都有合法符号或 R1..R12 的明确 raise，L 设计仍为 draft | §6；尚无独立审查或 owner 对本设计的批准 |

| 轮 / 审查版本与范围 | 审计方 | finding 及处置 | 改了什么 / 验证证据 | 没改的及去向 |
| --- | --- | --- | --- | --- |
| 作者自查；代码 `9f08c506`、规格 v1、本文全部 | Codex / GPT-6 | 作者自查，不计独立审查轮次；draft 待调度方的 L 设计审查与 owner 批准 | 固定源码/许可边界、三平台 LO 元数据、实际 LO 配置键及 Excel 迷你图保真反例的探针 exit 0；ui-mac 的 `bun test src/main/old-name-scan.test.ts` exit 0（10 pass）；`python3 scripts/check-doc-links.py docs/specs/document-output-quality/design.md docs/README.md` exit 0（426 links）；`git diff --check` exit 0。官方文档合同检查对本文无 finding，整体基线缺口见下表 | 运行期与正式包断言见下表；本次不实现、不发布、不付费跑模型 |

**待 owner 定**：没有新增产品取舍或用户限制提案；本 L 技术设计本身尚待批准。ADR-014 第 5 条受保护资产的准确修订与该设计批准一并交调度方，本文未越权改写。#1760 的 mac x64 接缝请求是技术输入处置，不要求用户新增操作。

**仍为推断或未验证的断言**

| 断言 / 观察 | 已有证据与边界 | 遗留去向 |
| --- | --- | --- |
| Windows MSI-CAB 无安装解包、私有字体发现、LO/Office Python 的正式包可执行性 | Win32/LO 固定源码支持所选路径，但本机未运行 Windows MSI、无 Windows 真机；mac 正式签名/Gatekeeper 也未由 pilot 证明 | 本票平台实现与规格 AC-15，失败不能改为用户手装依赖 |
| 公式缓存合并保住全部 Excel 对象，排序/数据修改后透视和图表均新鲜 | 小探针只证明上游迷你图保存边界；缓存合并器、图表缓存同步、LO对各公式行为尚未实现 | 本票 R10/R11，不能把这部分写成已验证事实 |
| 平台默认模型完成质量、自检实际发现问题与中文字体单段一致 | 原强模型 pilot 与配置可行性不等于默认模型和正式包；字体实值锁/四份产物尚待构建 | 已授权的小额模型测量决定 AC-01..03 是否修订；本票按原 AC 实施验证，不在设计任务执行 |
| 固定文件的自有 release/HK 上线、真实国内续传 | 本次只读官方元数据，没有发布或实网下载 LO | §8 既有生产者；消费契约已冻结，不重开机制 |
| ADR-014 决策 5 与新规格冲突 | `.claude/rules/adrs/ADR-014-extension-hub.md:22` 仍写旧的禁止再分发和重量理由 | 精确修订受保护条款须随批准输入交实施；无相邻规则清理 |
| 文档索引与既有引用不是全绿 | 修改索引前官方 `check_repo(..., changed_since="origin/alpha")` 为 69 errors/252 warnings；新设计无 finding。`docs/README.md:105` 所在生成块原已 stale；只加入生成器产生的本设计一行后为 71/250，其中 `:391`、`:448` 等两类既有跨仓意图引用因索引成为 changed file 从 warning 升为 error，仍非本设计新增引用 | 告知调度方的基线观察，不调查或修复其它文档；本次范围只含本文及必要索引行 |

交接收据：依据为 §1 的固定输入；作者 Codex / GPT-6 已核设计边界与上列可失败证据，结论为**送审稿完成，未冻结**；已定勿重开为技能主路、LO 渲染、不带 OfficeCLI、共享下载/启动器/视觉权威；下一步为调度方审查本文并处理 §8 的共享输入请求；遗留仅为本节明确的未验证实施断言与默认模型测量，无产品范围扩张。
