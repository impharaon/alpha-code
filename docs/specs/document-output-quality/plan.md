---
id: PLAN-document-output-quality
title: 文档产出质量实施计划
summary: 列出文档制作、渲染、自检与验收的八个交付切片，细化技能许可资产及制作环境、中文字体与模板两片。
kind: plan
status: active
spec: SPEC-document-output-quality
design: DESIGN-document-output-quality
owners: [owner]
last_reviewed: 2026-11-26
---

# PLAN-document-output-quality｜文档产出质量实施计划

本计划消费 [spec v1](spec.md) 和 [frozen design](design.md)，实施归属 [#1761](https://github.com/impharaon/alpha-code/issues/1761)。起草轮为 PLAN，只细化首片；后续切片在实施前追加各自的文件、顺序、风险与证明。这里的 AC 是切片贡献范围，不表示该片单独完成整条验收。

## 交付切片

| 顺序 | 切片名称 | AC / 设计落点 | 前序与集成依赖 |
| --- | --- | --- | --- |
| 1 | 固定技能快照与许可资产 | AC-01..04、14 的技能基础；§4.1、§6 R1/R6 | 可独立准备；详细计划见下节 |
| 2 | 随包制作环境、中文字体与模板 | AC-01..04、08、09、12、14、15；§4.1/4.2、R2/R6 | 消费片 1；消费 #1760 的 DOC-NODE-v2；包含 Office Python 的 win32-x64 构建与入口 |
| 3 | LibreOffice 准备与固定文件接入 | AC-06、08、09、10、13、14、15；§4.3、R3 | 消费片 2 的字体及 #1760 的固定文件端口；真实发布资产与香港入口是集成依赖 |
| 4 | 文档渲染、共享回执与产物面板 | AC-04、05、06、08、10、13；§4.4/4.8、R4/R5/R12 | 消费片 2/3；Excel 的重算接线随片 5 完成；覆盖工作根、watcher 与现有预览隔离的共用权威 |
| 5 | Excel 操作、保真重算与透视刷新 | AC-03、07、11；§4.6/4.7、R9..R11 | 消费片 2/3/4；同一 OfficeExcel 模块同时服务技能脚本与连接器 |
| 6 | 逐页自检、一轮修正与就绪补查 | AC-05、06、09、10、13；§4.5/4.8、R7/R8 | 消费片 4/5、现有 Read/云识图和 session.synthetic；含跨桥 admission 与恢复证据 |
| 7 | 默认制作入口、旧 writer 消费者与目录集成 | AC-01..05、09、11、12、14；§4.1/4.8、R12 | 消费片 1..6；同步 office-docs 总入口、工具文案、构建烟测及旧行为测试；目录快照等待 alpha-web 生产者 |
| 8 | 真引擎与双平台安装包验收 | AC-01..15；§1、§5、§8、§10 | 消费前七片及真实目录/发行资产；darwin-arm64 先验，win32-x64 在其发布前补齐，不能以 mac 结果代证 |

以上是同一仓库内的实施顺序，不建立新的跨仓 Task 或本地状态清单。第一片先准备可追溯的技能材料；默认制作入口及四个 writer 的消费者在片 7 一起切换，最终状态按设计验收，不添加旧 writer 别名或兼容路径。

### 外部及其它拥有者的交付依赖

| 拥有者 | 消费内容 / 版本 | 依赖边界 |
| --- | --- | --- |
| #1760 启动器 | [connector-launchers frozen design](../connector-launchers/design.md) @ `f7424aa45225a6d02d1958f4b4f72d247f99acc4`，DOC-NODE-v2 与固定文件公共口；继承文档设计 §1/§8 的回执 | 文档只消费现有两平台的 Node、bootstrap 读取面、固定文件获取及失败呈现。冻结设计不代表运行实现已经交付；片 2/3 集成时核对实际符号，不另带 Node 或下载器 |
| alpha-web catalog-src 生产者 | 文档设计 §8 的四条 Office tools/描述、Excel 新字节 re-intake、artifactDigest 与 guard 锚点 | 本仓交付新 server/来源材料后由该仓发布；片 7 只运行既有同步器消费生成快照与锁。本轮及后续本仓实施都不改另一仓源，不手编桌面快照 |
| LibreOffice 发行资产生产者、国内固定文件入口拥有者 | 文档设计 §4.3/§8 的实际原字节副本、源码/许可材料、完整 pin 与对应 relay 快照 | 发布和部署由调度方安排；片 3 不能虚构可取 URL、复制下载机制或临时绕过固定清单。AC-09 的北京/本机下载证据在真实入口就绪后取得 |
| 调度方 / 受保护规则拥有者 | 文档设计 §4.1/§10 指出的 ADR-014 决策 5 精确修订 | 该已知冲突沿原保护资产流程处理；第一片不改 `.claude/rules/`，不扩展到相邻规则维护 |

AC-01..03 的九次默认模型测量沿 spec「待决」中已有的总额 50 元授权，在片 8 的执行交接中记录实际费用和独立成品；本轮没有付费调用。真实样例、对照臂和逐项核对材料沿设计 §1 的 pilot 来源复用，不手造另一套“等效需求”。其它真引擎、断网截图、卡死/断流及真包测量也留给片 8 或相应片的明确执行 brief，不进入普通 PR 测试层。

## 切片一：固定技能快照与许可资产

- 依据：[spec v1](spec.md) @ `31cd182e09710b603721c6f44d471b01289dd951`，AC-01..04 的技能来源与 AC-14 的 Anthropic 许可/排除部分；[design](design.md) @ `7d1c4fdb55cc388af1fc7069249ec3d449641a60` §4.1、§6 R1/R6、§10 R1-5 及许可处置；Issue #1761。其余字体、npm/Python、PDFium、社区 Excel 和 LO 的许可随各自资产片补齐。
- 核对：`439a730bcc` · Claude Opus 5.5（orchestrator）· 通过。恢复 brief `Phase: IMPLEMENT` 接受八片及其 AC/外部依赖，首片以真实打包路径发现、许可/排除材料及删除后变红证明；冻结决定未变。ADR-014 决策 5 修订仍归调度方。

### 改动

以下路径均相对仓库根；`<skill>` 在本表只指 docx、xlsx、pptx、pdf、frontend-design、canvas-design、theme-factory 七个来源目录。技能名、运行入口和许可边界直接引用设计 §4.1，不另定义一份。

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/resources/factory-skills/office-docs/<skill>/SKILL.md`（新增） | 从固定源逐份适配制作指导及相互引用；保留制作知识，按设计接到 DocumentEnvironment、OfficeExcel、document.render/check 与现有 Read/识图，去掉不适用的安装/运行假设。正文按仓库 agent-facing 约定用英文，用户说明沿现有中文文案 |
| `packages/ui-mac/resources/factory-skills/office-docs/<skill>/**`（新增的参考、必要脚本及 `LICENSE.txt`/已有 NOTICE） | 仅纳入实际制作/编辑路径需要且许可明确的文件；关联脚本同步适配。被排除的 XSD、字体和演示文件不进入任何随包副本；保留的检查入口做实际支持的结构检查，不误报 XSD 校验成功。所有改编文件注明来源、日期及修改 |
| `packages/ui-mac/resources/factory-skills/office-docs/WORKFLOW.md`（新增） | 七份技能共同引用的应用执行指引；集中记录冻结入口的使用方法，避免七份正文各维护一套运行/自检说明 |
| `packages/ui-mac/resources/factory-skills/office-docs/document-skills.lock.json`（新增） | 本组固定材料的来源记录：源 SHA、源路径/摘要、产出路径/摘要、适配说明及排除原因。由固定 Git tree 与实际文件计算，不从工作目录的未跟踪缓存取样，不生成虚构摘要；它不是另一套技能发现表 |
| `packages/ui-mac/resources/NOTICE.txt` | 在既有随包署名清单中增加这七份技能的来源、Apache-2.0 许可位置和适配说明 |
| `packages/ui-mac/src/main/factory-skills.test.ts` | 在已有真实 SkillScan 和打包资源复制用例旁补本组嵌套技能的 dev/packaged 发现、名称唯一性、来源摘要与许可/排除文件的资产验证；复用 setup，不新建票号测试文件 |
| `docs/specs/document-output-quality/plan.md` | 首个实施提交填核对回执；必要偏离与对应实现同提交记录 |

现有 `factorySkillSources` 已含 office-docs，`reconcileFactorySkills` 已收集嵌套入口，`electron-builder.config.ts` 已整目录复制 factory-skills 和 NOTICE；本片通过真实复制/扫描验证这些路径，不新增技能注册机制或无必要的打包配置改动。父级 `office-docs/SKILL.md` 的总路由与绑定旧 writer 的测试到片 7 同步替换。

### 顺序

1. **来源与分发资产提交**：从设计 F-03 的 Git 提交 `e4bb5d960d87126ff3b3a8af1a104b7db67560ba` 读取 tracked files。可复用本机 pilot clone，但先核对对象 SHA；若需重取，仅在临时目录取该固定源。逐文件生成来源记录、保留许可证、写署名；不把原始整仓或被排除文件拷入 resources。先核实际分发文件及摘要，再提交资产和 NOTICE。
2. **技能适配与装载证明提交**：完成七份正文、被调用参考/脚本和内部路径适配，同步产出摘要。用现有 `getConfig(...).extraResources` 规则复制到临时 resources，再走 `factorySkillSources → reconcileFactorySkills → SkillScan`；验证七个设计规定的名字都可被引擎发现，且没有覆盖目录技能原名。被引用的本地资源逐一核实；没有随包支持的上游工具引用改到设计已指定的入口，不引入额外依赖。
3. **一次收尾核验**：先针对新增用例名迭代，再把 `factory-skills.test.ts` 全文件跑一次；返回前只跑下面列出的较宽相关集合一次。检视 diff、来源/分发目录和文档链接，提交所有本片变更及偏离。若第 1 步已改到同一测试文件，其步末也按该步的变更跑一次；不为纯资产复制增加文案/标题计数测试。

相关命令均从 `packages/ui-mac` 执行：

```sh
bun test src/main/factory-skills.test.ts -t 'document skill assets'
bun test src/main/factory-skills.test.ts
bun test src/main/codepuppy-factory-skill-hygiene.test.ts src/main/codepuppy-skill-packaging-census.test.ts src/main/old-name-scan.test.ts
```

新增用例组采用上面的 `document skill assets` 名字。较宽集合来源是对 factory-skills/office-docs 的实际文件消费者搜索；本片不改生产 TS 导出。若修改了测试 TS，补 `bun typecheck`，不直接跑 tsc。不改不适用于本片的旧 writer 断言；到片 7 替换行为时与实现一同变更。上述均为文件级相关检查，不调用包级 `bun test`、`bin/check` 或 gate。

### 风险

- **固定源里包含不能分发或不能执行的材料**：以 Git tree 而非工作目录遍历为起点。PLAN 只读盘点为 282 个 tracked 文件，按设计的三类排除后最多 83 个候选、730,936 B，尚未裁去不使用的脚本；这只是工作量依据，不是文件数/体积限制。来源记录逐项解释最终选取，检查暂存包里也没有排除文件。
- **适配删掉了必要链接或隐藏运行假设**：除了解析 SKILL frontmatter，人工核对每种格式的制作/编辑路径和实际本地引用；使用的脚本必须同步适配。第一片只能证明材料与装载，生成和视觉质量仍由后续真引擎验收，不能以关键词断言代证。
- **嵌套发现与可安装同名技能冲突**：沿设计 §10 R1-5 的命名，在临时 dev/packaged 树调用真实 SkillScan；不新增顶层 FACTORY_SKILL_IDS 或覆盖用户安装内容。涉及字体/模板的实际资源、Word 图表导出和 Excel 共用编辑入口，要等片 2/4/5 的能力就绪后在片 7 接通。
- **依赖尚未交付**：第一片不创建 DocumentHost 的替身实现，也不宣称 #1760/LO 已可运行。后续接线发现冻结端口不足时，按 brief 返回 `SEAM-CHANGE-NEEDED`；不在本片重设计。

### 证明

| AC / 本片范围 | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01..04：技能可以从正式随包路径装载 | `factory-skills.test.ts` 的 `document skill assets` 用例，经 dev 与真实 extraResources 复制树调用 SkillScan；逐一核对解析出的固定技能名与文件 | 少一份资源、嵌套路径漏注入或 frontmatter 名冲突时，真实发现结果缺项/冲突；这不证明默认模型的分数或生成成品质量 |
| AC-14：Anthropic 许可、署名及排除边界 | 同组资产用例从复制后的资源树读许可证并核对来源记录的实际产出摘要、NOTICE 指向和排除文件缺席；一次性将来源摘要与固定上游 Git blobs 比对，记录命令/输出 | 删除许可/署名、遗漏适配文件或夹入任一被排除标准文件会失败；源摘要与真实固定源不符也会被一次比对发现。LO 等许可及最终安装包清单在对应后续片验 |
| AC-01..04、14：材料完整且不引入原名冲突 | 一次性检查七份正文及引用资源的实际文件；`python3 scripts/check-doc-links.py` 显式传入新增/修改 Markdown（在仓库根运行），加现有技能 hygiene/census 检查 | 引用缺文件、许可链接悬空或发现路径不可达会报错；语义适配以人工逐份检查记录，不能以标题/词句计数宣称能力通过 |

PLAN 起草轮只做文档合同、链接和 diff 检查，并按当轮“commit only plan.md”的范围把索引同步交调度方。本次仅实施切片一；AC-01..15 的整条运行/安装包验收仍属后续切片。

切片一实施核验（2026-11-26，Codex / GPT-6）：`factory-skills.test.ts -t "document skill assets"` 为 2 PASS，文件级收尾为 27 PASS；计划列出的 hygiene/census/旧名三个文件合跑 48 PASS；`bun typecheck` exit 0。五项一次性删除/注入反例各令定向两用例变红（exit 1）：缺 docx 技能、缺 docx 许可证、移除新署名、夹入固定源的 `schemas/mce/mc.xsd`、移除生产 `nestedSkillDirs` 注入；逐项恢复后才跑上述最终绿色检查。命令/失败输出在本轮工具回执，临时驱动和日志为 `/tmp/alpha-1761-removal-arms.py` 与 `/tmp/alpha-1761-arm-*.log`，不加入常驻套件。

固定 Git tree 的 282 个 blob 经 `git show e4bb5d960d87126ff3b3a8af1a104b7db67560ba:<sourcePath>` 逐项比对锁中 SHA-256：25 个保留并适配、257 个逐项排除；七份 LICENSE 原字节不变。一次性 `node /tmp/alpha-1761-theme-probe/probe.cjs <repo-root>` 使用实际 PptxGenJS 4.0.1 输出验证主题脚本：12 个色槽及中文/XML转义名称正确，其它 ZIP parts 原样保留，非法主题拒绝且文件摘要不变（3 项通过）；产物 `/tmp/alpha-1761-theme-probe/themed.pptx` SHA-256 `eb4b113ad1763cf1a9c9227ef1f9e4276f88286ff1e980286e86291aae8c0537`。这些检查不代表模型质量或视觉自检已通过。

### 偏离记录

2026-11-26 · 步骤 1/2 的材料与适配合为首个资产提交，再提交发现/分发验证；避免把原名冲突、安装假设或悬空 helper 引用的原稿暴露给嵌套发现。新增同目录 `WORKFLOW.md` 集中七技能的共用执行指引；保留脚本仅为适配后的 `pptx/scripts/apply_theme.cjs`，其余按实际未使用路径逐文件记录排除。无冻结契约变更。资产提交 `91aabeab39`。

## 切片二：随包制作环境、中文字体与模板

- 依据：[spec v1](spec.md) @ `31cd182e09710b603721c6f44d471b01289dd951`，AC-01..04、08、09、12、14、15 的资源/制作基础；[design](design.md) @ `7d1c4fdb55cc388af1fc7069249ec3d449641a60` §4.1/4.2、§6 R2/R6、§8/§10；[connector-launchers frozen design](../connector-launchers/design.md) @ `f7424aa45225a6d02d1958f4b4f72d247f99acc4` 的 v2 §4.1 / DOC-NODE-v2。切片一 `91aabeab39`、`7c739dc021` 已由 Claude Opus 5.5（orchestrator）接受；继承其来源、许可与发现结论。
- 核对：待调度方核对本切片 PLAN 提交；下次 IMPLEMENT 的首个提交按恢复 brief 的 `Phase:` 行填写提交号、核对者/模型与结论。

本片交付可供制作使用的资源树、构建来源与资源路径解析，不接通默认生成/自检流程。实际依据为当前 `build-office-runtime.ts` 的 mac-only 安装/验证、`office-runtime.lock` 的 CPython 3.11.15 与两份 mac 架构锁、`electron-builder.config.ts` 的 darwin-only Office 复制规则。沿用这些构建与打包拥有者补 Windows，不新建 Office Python 或 Node 的平行环境。既有普通读工具在本片仍可使用，旧 writer 删除及其烟测转换仍在片 7 同步完成。

### 改动

所有路径相对仓库根。新构建资源归 ui-mac 随包资产；新增路径解析文件归已有 main 资源责任，不让 util/ext 反向依赖 main。

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/resources/office-runtime/requirements.in`、`office-runtime.lock`、`requirements-arm64.lock`；新增 `requirements-win32-x64.lock` | 在原有 Python 锁中补设计指定的 PDFium、Pydantic 及真实依赖闭包；Office CPython 仍为 3.11.15，补 win32-x64 官方发行身份。依赖边按对应目标的实际 METADATA/marker 生成，不能把 mac 的图当 Windows 的图 |
| `packages/ui-mac/resources/office-runtime/requirements-x64.lock` | 移除不再属于发行范围的 Intel Mac 锁及 Office 构建中的引用；不改其它功能使用的通用 x64 架构解析 |
| `packages/ui-mac/scripts/build-office-runtime.ts` | 扩充现有构建入口的目标选择、归档布局、解释器/stdlib/site-packages 定位、安装/裁剪/校验及 Windows `.pyd` 导入；保留原锁闭包、版本、哈希、实际导入与四格式读回证据。制作阶段新增能力的烟测不依赖未实现的 OfficeExcel，不提前删旧 writer |
| `packages/ui-mac/resources/document-assets/package.json`、`package-lock.json`（新增） | 仅 docx 9.16.0、pptxgenjs 4.0.1 及其实际 npm 闭包的构建锁；由真实 npm 元数据生成 integrity，不改根工作区依赖或引入在线执行链 |
| `packages/ui-mac/resources/document-assets/fonts.lock.json`、`build-requirements.lock`（新增） | 官方 noto-cjk 源提交/两套变量 TTF 的路径、原字节摘要与 OFL/版权对应；记录 400/700 实例、FontTools 构建版本/哈希、生成字体摘要及命名说明。值从实际来源和构建取得，不复制设计里的示例值作锁 |
| `packages/ui-mac/scripts/build-document-assets.ts`（新增） | 构建文档 npm 闭包、静态中文字体和模板，核对分发许可并生成实际资产清单。复用现有构建获取/校验能力和包管理器，新增代码不另实现下载、续传或回退器。产物进入忽略的 `native/document-assets/build/`；锁与生成来源入库，node_modules、字体二进制及构建缓存不入库 |
| `packages/ui-mac/scripts/build-document-templates.py`（新增） | 用随包 Office 库生成应用原创的中文报告 docx、分析 xlsx、汇报 pptx；分别写实际样式/页设置、数字格式/冻结/打印设置、主题/母版/布局及自定义来源/版本属性。生成后解析原生容器核实，模板不是固定业务内容的最终样例 |
| `packages/ui-mac/src/main/document-resources.ts`、`document-resources.test.ts`（新增） | 一个资源解析入口从 resourcesRoot、目标和实际资产清单给出 Office Python、nodeModules、skills、fonts、templates 的真实路径/身份；dev 与 packaged 共用。测试真实资源复制、解析和缺文件/摘要错误，不建立第二份 Node 资产表或假 DocumentHost |
| `packages/ui-mac/scripts/target-arch.ts`、`prebuild.ts`、`packages/ui-mac/electron-builder.config.ts`、`packages/ui-mac/.gitignore` | 在已有构建/包装链中接入文档资产，Office 复制扩到 win32-x64，验证解释器/PDFium 等原生文件的对应目标；保持 Node 签名与归档形态归 #1760。只增本片产物忽略路径，不改 gate |
| `packages/ui-mac/src/main/office-runtime-lock.test.ts`、`mac-target-arch.test.ts`、`factory-skills.test.ts` | 更新已被新事实替换的五个顶层包/两份 mac 锁/mac-only 复制断言；新增当前模块的闭包、目标和真实资源复制验证。第一片摘要锁仍只拥有技能来源，不把字体/npm 的另一个锁塞进去 |
| `packages/ui-mac/resources/NOTICE.txt` 与构建产物的许可目录/来源清单 | 保留实际分发的 npm、Python、PDFium 依赖及 OFL 原文/版权和字体修改说明；署名位置沿既有随包清单，不新增页面。LO 许可材料仍随片 3 的发行资产交付 |
| `docs/specs/document-output-quality/plan.md` | 填核对回执、实施证据与必要偏离；不改冻结 spec/design 或受保护 ADR-014 |

资源解析入口供片 4 的 DocumentHost.environment 消费；Windows 连接器命令/安全校验等现有消费者在片 7 接线时使用这同一结果，不在它们旁边新增第五份 `python.exe` 路径拼接，也不在本片重构全部命令历史逻辑。构建烟测在本片仍走原 reader 读回；片 7 删除 writer 时，沿 §4.8 改用制作库/OfficeExcel 生成再 stdio reader 读回。

### 顺序

1. **Python 两平台锁与构建提交**：先从官方发行/真实 wheels 取得 Windows CPython、PDFium 及新增依赖的锁实值，记录命令和来源；扩充原 builder 与其锁测试，再更新 Office 的目标校验/复制输入。当前 Mac 执行 darwin-arm64 构建和真实导入、四格式烟测；Windows 先核真实归档/wheel 的身份、布局和元数据，执行证据明确 pending。不能把 Mac 上读取 PE 文件或交叉求锁记成 Windows 启动成功。
2. **npm、字体与中文模板提交**：用真实 lock 构建随包 npm 目录，实例化两家族 regular/bold 字体并保留 OFL/修改记录，生成三份中文模板和资产清单。用固定库实际生成/读回 Office/PDF；核对模板 OOXML 样式、主题/母版、自定义属性及 TTF 的 sfnt/cmap/字轴。先在临时目录完成缺包、坏 integrity/哈希、缺字体、缺模板等失败臂，再验证真实 assets 复制规则。构建工具只以绝对入口执行，不启动应用或窗口。
3. **资源解析与打包消费提交**：接入 dev/packaged 的统一解析和 prebuild/extraResources，更新直接受影响的原断言与许可投影。用实际锁和暂存产物作测试输入；字体/模板不使用手写的二进制格式替身，新增 Windows 二进制夹具从锁定原文件提取所需字节并记来源。删除解释器、删传递依赖、拿错目标二进制、移除字体/模板复制各应让对应真实入口失败。
4. **一次收尾**：每步只迭代本步用例名，再把本步改变的测试文件全跑一次；返回前再跑较宽相关集合一次。记录实际构建体积、原生目标、许可文件和模板/npm/font 摘要；保留 Windows/#1760/渲染验收的 pending 分类，不用跳过后的绿色结果冒称完成。

相关检查从 `packages/ui-mac` 执行；新增用例分别命名为 `document runtime locks`、`document resources`，迭代以 `-t` 选择：

```sh
bun test src/main/office-runtime-lock.test.ts -t 'document runtime locks'
bun test src/main/document-resources.test.ts -t 'document resources'
CODEPUPPY_TARGET_ARCH=arm64 bun ./scripts/build-office-runtime.ts
bun ./scripts/build-document-assets.ts
bun test src/main/office-runtime-lock.test.ts src/main/document-resources.test.ts
bun test src/main/mac-target-arch.test.ts src/main/factory-skills.test.ts
bun typecheck
```

最后两组文件级命令按实际步骤分配，各文件只在其改变行为后收尾一次。真实完整构建/字体生成与格式读回是本片一次性实施证据，不变成每个资源用例反复安装依赖的常驻测试；常驻测试复用构建产物或读取真实锁/容器所需的小样本。`build-document-assets` 的 npm 执行烟测若尚无 #1760 的实际 Node 资产，可在临时目录用其冻结官方归档做一次库探针并标明来源；该临时工具不打进产品，不作为 DOC-NODE-v2 已接通的证据。Windows 执行与完整图像检查不在上述 Mac 绿色计数中。

较宽相关集合由本片实际改动的 exports/磁盘资源消费者确定。当前已确认 `office-mcp.test.ts`、`attachment-read-roundtrip.test.ts`、`process-fence-wiring.test.ts` 直接 import 原 `buildOfficeRuntime`：前两个文件在已有构建产物上各跑一次；围栏文件只跑 `bun test src/main/process-fence-wiring.test.ts -t "the four bundled-runtime commands"`，它覆盖同一随包解释器在生产围栏内的制作/读回。该文件中另有空缓存联网安装与其它旅程，不在本片运行，也不为每个文件重装环境。`mac-target-arch.test.ts` 覆盖现有包装校验，`factory-skills.test.ts` 覆盖打包复制；已在步末覆盖者不重复跑。其余 consumers 若因实际接口变化需纳入，先用 `rg` 找出并记于本节，不扩成整个包测试。禁止执行完整 prebuild 链、app/窗口、包级测试、bin/check 或 gate；不因没有 #1760 而新建下载/安装路径。

### 风险

- **#1760 未开始实施**：消费 DOC-NODE-v2 的冻结签名与读取权限；Node 资产 ready 必须来自 `ConnectorLaunchHost.resolveAssets()` 的真实返回，而非 bootstrap 的目标路径。当前不修改 `CodePuppyBootstrap.launchers` 的生产者/解析器、不自建其接口或伪造 ready。`resolveAssets → DocumentHost.environment.node`、归档退路展开/签名、sidecar/ext 读取同代资产的真实集成断言标为 **pending（#1760 交付后，片 4 接线、片 8 真包验）**；这不是本片设计 blocker。
- **Windows 不能由当前 Mac 的结果代证**：两平台的解释器布局、wheel marker、PDFium DLL 和导入方式分别验证；Windows 的 isolated import、实际模板生成/读回与最终包执行标为 **pending（Windows 执行机及后续发布验证）**。不回落到系统 Python、不请求用户安装或关闭保护，也不恢复 Intel Mac 产物。
- **字体能打开不等于中文排版通过**：构建检查真实 TTF outlines/cmap、regular/bold 身份、OFL/RFN、ReportLab 可嵌入与中文 ToUnicode；整段替代、LO profile/fontconfig/Windows 私有字体发现和 PDF 内实际字体清单须片 3/4 才能证明。AC-08 的三字体对照臂标为 **pending（真实 LO 渲染）**，不以 fontTools 检查替代。
- **模板来源与成品沿用不同**：本片核模板实际样式和来源属性；用户 PPT 模板的母版/配色保留、默认模型是否确实选择模板，仍须片 7/8 走实际任务验证。不得把“模板文件存在”记成 AC-12 全过。
- **原构建闭包/许可证被裁剪失真**：继续核 installed METADATA、pip check、版本与哈希；npm 按 lock integrity 安装，PDFium 的 dependency licences 与字体原文均随产物检查。去掉构建工具/缓存前后验证实际导入和字体生成，不能只 import 一个顶层模块就宣布所有依赖就绪；不新增运行时包安装器。

### 证明

| AC / 本片范围 | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-01、02：Word/PPT 制作库与中文模板基础 | `document-resources.test.ts` 验实际打包复制和来源摘要；一次性用随包 Python、临时/已交付的固定 Node 与 docx/PptxGenJS 生成原生文件，再解析目录/页眉页脚页码、图片/表格、主题/母版、图表数据和备注等所生成要素 | npm 传递包缺失、模板遗漏、错误模块定位或空壳容器会让实际 require/制作/读回失败；此证据不代替每种三次默认模型质量分数 |
| AC-03：Excel 制作/模板基础 | 原 Office builder 的实际 openpyxl 生成/stdio reader 读回；一次性解析模板数字格式、冻结、打印范围/页眉页脚与来源属性 | 只有文件名或 import 成功、未带库/模板设置时，原生读回与属性核对失败。LO 重算、独立汇总值和对象保真属于片 5/8，当前 pending |
| AC-04：PDF 中文制作基础 | 随包解释器 + 静态 TTF 用 ReportLab 生成中文正文、图片、页眉页脚；pypdf 抽取原文、核字体/ToUnicode 与图片对象 | OTF/CFF 冒充 TTF、字体没进包、缺中文文本映射或只画了一张正文图片时失败；HTML/海报完整导出和断网截图仍归片 4/8 |
| AC-08：中文字体资源与替代输入 | `document-resources.test.ts` 检查实际四字体复制/摘要；一次性 fontTools/ReportLab 核字形覆盖与嵌入，删除任一家族/字重或改源摘要的反例变红 | 字体资源缺席、拿错实例/家族或 cmap 缺本例汉字会失败；LO 整段一致性、三指定字体与去配置对照仍 pending |
| AC-09：用户无须安装制作依赖 | `office-runtime-lock.test.ts` 的两平台完整闭包反例；在临时 cwd/收敛 PATH、固定绝对解释器下的实际四格式 smoke 和打包资源解析 | 删 CPython/原生库/传递包、遗漏复制或偷偷依赖系统包会在实际启动/import/制作失败。Node 宿主 ready 与国内 LO 下载/续传、整体离线流程分别依赖 #1760、片 3/8 |
| AC-12：模板实物与来源 | 用真实库读三份生成模板的 styles/sections、slideMaster/theme/关系、工作簿格式与 custom properties；`document-resources.test.ts` 删除模板或篡改摘要后失败 | 空模板、错样式或只有硬编码路径时失败；实际任务选择 bundled/user 并保留用户母版的证据在片 7/8 pending |
| AC-14：本片新增组件分发许可 | 真实 extraResources 复制后逐文件检查锁中 npm/Python/PDFium/OFL 许可、版权、字体修改记录及实际 hash；删除许可文件或只留占位清单后失败 | 漏带任一已分发依赖许可/字体来源时，清单与实际树不一致；沿用第一片的标准文件排除边界，LO 源码/许可义务留片 3 |
| AC-15：Windows 资源与执行边界 | 两目标锁/资源投影、真实 Windows 归档与 wheel 元数据、实际 PE 文件目标检查；在 Windows 主机运行同一构建/isolated import/四格式读回后补执行记录 | 错把 mac python 路径/原生库放进 Windows 时，布局/目标检查或实际启动失败。当前 Mac 不可完成的执行和 Windows 包上的 AC-01/02/03/08/09 均 pending，不计为本片已通过 |

### 偏离记录

暂无。
