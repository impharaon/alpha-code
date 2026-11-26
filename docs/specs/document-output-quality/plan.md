---
id: PLAN-document-output-quality
title: 文档产出质量实施计划
summary: 列出八个交付切片，细化前三片的技能许可、制作环境与模板、LibreOffice 准备及固定文件接入。
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
- 核对：`7569b9dfe8` · Claude Opus 5.5（orchestrator）· 通过。恢复 brief `Phase: IMPLEMENT` 接受文件、顺序、风险与逐 AC 证明；#1760 接线、Windows 实机和 LO 字体渲染继续 pending。Node 接收启动器提供的入口，v2.1 token 细节留集成，不另造路径约定。

本片交付可供制作使用的资源树、构建来源与资源路径解析，不接通默认生成/自检流程。实际依据为当前 `build-office-runtime.ts` 的 mac-only 安装/验证、`office-runtime.lock` 的 CPython 3.11.15 与两份 mac 架构锁、`electron-builder.config.ts` 的 darwin-only Office 复制规则。沿用这些构建与打包拥有者补 Windows，不新建 Office Python 或 Node 的平行环境。既有普通读工具在本片仍可使用，旧 writer 删除及其烟测转换仍在片 7 同步完成。

### 改动

所有路径相对仓库根。新构建资源归 ui-mac 随包资产；新增路径解析文件归已有 main 资源责任，不让 util/ext 反向依赖 main。

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/resources/office-runtime/requirements.in`、`office-runtime.lock`、`requirements-arm64.lock`；新增 `requirements-win32-x64.lock` | 在原有 Python 锁中补设计指定的 PDFium、Pydantic 及真实依赖闭包；Office CPython 仍为 3.11.15，补 win32-x64 官方发行身份。依赖边按对应目标的实际 METADATA/marker 生成，不能把 mac 的图当 Windows 的图 |
| `packages/ui-mac/resources/office-runtime/requirements-x64.lock` | 移除不再属于发行范围的 Intel Mac 锁及 Office 构建中的引用；不改其它功能使用的通用 x64 架构解析 |
| `packages/ui-mac/scripts/build-office-runtime.ts` | 扩充现有构建入口的目标选择、归档布局、解释器/stdlib/site-packages 定位、安装/裁剪/校验及 Windows `.pyd` 导入；保留原锁闭包、版本、哈希、实际导入与四格式读回证据。制作阶段新增能力的烟测不依赖未实现的 OfficeExcel，不提前删旧 writer |
| `packages/ui-mac/resources/document-assets/package.json`、`package-lock.json`（新增） | 仅 docx 9.16.0、pptxgenjs 4.0.1 及其实际 npm 闭包的构建锁；由真实 npm 元数据生成 integrity，不改根工作区依赖或引入在线执行链 |
| `packages/ui-mac/resources/document-assets/fonts.lock.json`、`build-requirements.in`、`build-requirements.lock`（新增） | 官方 noto-cjk 源提交/两套变量 TTF 的路径、原字节摘要与 OFL/版权对应；记录 400/700 实例、FontTools 构建版本/哈希、生成字体摘要及命名说明。值从实际来源和构建取得，不复制设计里的示例值作锁 |
| `packages/ui-mac/scripts/build-document-assets.ts`（新增） | 构建文档 npm 闭包、静态中文字体和模板，核对分发许可并生成实际资产清单。复用现有构建获取/校验能力和包管理器，新增代码不另实现下载、续传或回退器。产物进入忽略的 `native/document-assets/build/`；锁与生成来源入库，node_modules、字体二进制及构建缓存不入库 |
| `packages/ui-mac/scripts/build-document-templates.py`（新增） | 用随包 Office 库生成应用原创的中文报告 docx、分析 xlsx、汇报 pptx；分别写实际样式/页设置、数字格式/冻结/打印设置、主题/母版/布局及自定义来源/版本属性。生成后解析原生容器核实，模板不是固定业务内容的最终样例 |
| `packages/ui-mac/src/main/document-resources.ts`、`document-resources.test.ts`（新增） | 一个资源解析入口从 resourcesRoot、目标和实际资产清单给出 Office Python、nodeModules、skills、fonts、templates 的真实路径/身份；dev 与 packaged 共用。测试真实资源复制、解析和缺文件/摘要错误，不建立第二份 Node 资产表或假 DocumentHost |
| `packages/ui-mac/scripts/target-arch.ts`、`prebuild.ts`、`packages/ui-mac/electron-builder.config.ts`、`packages/ui-mac/.gitignore` | 在已有构建/包装链中接入文档资产，Office 复制扩到 win32-x64，验证解释器/PDFium 等原生文件的对应目标；保持 Node 签名与归档形态归 #1760。只增本片产物忽略路径，不改 gate |
| `packages/ui-mac/src/main/office-runtime-lock.test.ts`、`mac-target-arch.test.ts`、`factory-skills.test.ts` | 更新已被新事实替换的五个顶层包/两份 mac 锁/mac-only 复制断言；新增当前模块的闭包、目标和真实资源复制验证。第一片摘要锁仍只拥有技能来源，不把字体/npm 的另一个锁塞进去 |
| `packages/ui-mac/src/main/fixtures/document-assets/**`、`fixtures/office-python-*.header.bin`、`fixtures/office-python-LICENSE.txt`（新增） | 由实际产物取得的三模板、四份小型真实字体子集、npm 原始元数据/许可和解释器头部；provenance 记录原摘要、子集字符及生成器摘要。只供资源解析/哈希测试，不把头部或小子集计为完整执行/字形覆盖证明 |
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

2026-11-26 · 新增锁的可重生成输入 `build-requirements.in` 与上述真实小夹具（约 135 KB 加两个 4 KB 解释器头部/PSF 许可）；完整字体仍只进忽略的构建目录。`OFFICE_RUNTIME_BUILD_DIR` 移到纯资源解析拥有者并由原 target-arch 转出，消除本片路径复制。模板容器结构在真实构建脚本中读回核实，常驻测试只验证生产解析/校验，不另加“静态夹具的内容正确”测试。

npm 真实闭包中 `https@1.0.0` 只有 package.json，没有可执行入口；固定官方 Node 26.13.1 的 `require.resolve("https")` 实测返回内置 `https`。构建裁去该无执行内容的元数据目录，锁仍保留完整上游安装图；不带第二份实现。`isarray@1.0.0` 的完整 MIT 条款在其 README，保留原字节并纳入许可验证。没有新增冻结契约或 Node token/路径约定。

实施核验（Codex / GPT-6，2026-11-26）：Python 提交 `78969e73d2`，darwin-arm64 构建 126.3 MB、50 个 Mach-O、17 个顶层模块真实导入与四格式 stdio 写后读回通过；Python 每个发行包的原始许可文件按实际 RECORD 检查。两平台 16 个 wheel 的 METADATA 求值图一致，Windows 官方归档布局/摘要已核，另核 19 个真实 Windows wheel 原生文件为 AMD64 PE；不计作 Windows 执行成功。

文档资产构建 593 个已核摘要的文件、约 78.2 MiB、四字体与三模板。实际 extraResources 复制后的 `documentResources` 核验通过，接收临时解出的固定官方 Node 26.13.1；Word/PPT 原生制作与 reader 读回、Excel 公式保留、ReportLab 中文正文/图片/页眉页脚/ToUnicode 及 PDFium 栅格化通过。一次性驱动/回执为 `/tmp/alpha-1761-slice2/resource-probe.ts`、`packaged-receipt.json`、`node-probe.cjs`、`python-probe.py`；PDF 成品 `/tmp/alpha-1761-slice2/created.pdf` SHA-256 `67d2becb46281e2cecdedf02be012636f3210d65875205d9c5f55320fb5bb1b4`。

六个实际删除臂（字体、模板、OFL、docx 包、PDFium 原生库、解释器）均在同一暂存入口失败，随后恢复；另由 `guards.py` 移除生产摘要、OFL、npm 许可与 PE 目标校验，每项对应常驻测试均变红（exit 1），恢复后再做最终绿色检查。三类 pending 保持：#1760 resolveAssets/v2.1 token 的真实宿主接线与签名、Windows 实机执行、LO 整段字体及默认模型/完整质量验收。

切片二最终相关检查：`bun test src/main/mac-target-arch.test.ts src/main/document-resources.test.ts` 50 PASS；`office-runtime-lock.test.ts` 6 PASS；`factory-skills.test.ts` 27 PASS；`office-mcp.test.ts` 与 `attachment-read-roundtrip.test.ts` 15 PASS；围栏定向用例 1 PASS；旧名扫描 10 PASS；`bun typecheck`、8 个相对链接、diff 检查均通过。文档合同对本文 0 finding，仓级仍为既有 69 errors / 253 warnings。未跑全量、未启动应用/窗口、未付费调用或发布。

## 切片三：LibreOffice 准备与固定文件接入

- 依据：[spec v1](spec.md) @ `31cd182e09710b603721c6f44d471b01289dd951`，AC-06、08、09、10、13、14、15 的组件准备部分；[design](design.md) @ `7d1c4fdb55cc388af1fc7069249ec3d449641a60` §4.2/4.3、§4.4 的准备 verify 期限、§5、§6 R3、§8/§10；协调仓 impharaon/alpha-work 国内连接性设计切片四 §4.11/§10 @ `86a58c7bbdaad8b7c689d1c9c2845e3ce16db2a9`；[启动器冻结契约](../connector-launchers/design.md) @ `f7424aa45225a6d02d1958f4b4f72d247f99acc4` 的固定文件、失败事实及生命周期端口。切片二 `78969e73d2`、`351d991411` 已由 Claude Opus 5.5（orchestrator）接受，继承其资源、字体身份和许可回执。
- 核对：`2520f3de62` · Claude Opus 5.5（orchestrator）· 通过。恢复 brief `Phase: IMPLEMENT` 接受固定文件及 #1760 端口的准备方案；#1760 集成、自有 release/relay、Windows 真执行及真实 LO 渲染仍待验，不增加下载器，不上传、发布或部署。 r6 消费 `46f8580c95a47e4a03ea128d99b405edd3424e6e` 已合入的设计 §4.9/§10 固定验证任务，原执行接缝已由调度方明确解除；不 merge/rebase 本分支。

本片实现准备器、解包与私有配置、ready 的真实验证条件，以及供后续 DocumentHost 使用的状态；对话卡片/产物回执在片 4、持久补查与 session.synthetic 在片 6 接通。`USER_DATA_LAYOUT` 当前尚无 document-runtime；#1760 的清单/下载/失败端口尚未实现。下面明确区分可独立完成的组件与待集成证据，不把下载缓存、已展开目录或未接通的端口当 ready。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/resources/pinned-files.json`（#1760 拥有的共享清单，条件性追加） | 仅在发行者交付可取的自有 release URL、精确字节/摘要和对应许可/源码材料后，贡献设计 §4.3 的两条 LO entry；通过共享 readPinnedFiles 校验。不建 LO 专用清单，不填占位 URL、latest、空表或临时 TDF 退路；未交付时本项保持集成 pending |
| `packages/util/src/codepuppy-document.ts`、`codepuppy-document.test.ts`（新增） | 落地本票冻结的 DocumentRuntimeState 及必要的纯状态/通知数据校验；失败、固定文件 ID、delivery 和 LauncherPlatform 直接消费 #1760/共享契约的导出，不复制它们的类型或分类器。后续片在此继续落同一文档契约 |
| `packages/ui-mac/src/main/document-runtime.ts`、`document-runtime.test.ts`（新增） | 消费本平台清单条目、共享获取结果和原始失败事实；协调一次展开、verify、原子 ready 发布与查询/订阅。首次查询启动准备并立即给实际状态，进度来自真实阶段；同 pin 合并准备，复用共享下载取消/缓存规则，不建重试/下载引擎 |
| `packages/ui-mac/src/main/document-runtime-fonts.ts`、`document-runtime-fonts.test.ts`（新增） | 从片 2 的真实字体/摘要生成私有 fontconfig、LO profile 与字体替代配置，生成正确 file URI；mac 使用实际字体目录与私有缓存，Windows 使用 LO 私有字体目录。更新/扩展/宏/外链配置按实际 26.8.3 注册表键生成，解析 XML 验证，不写系统字体或用户 LO 设置 |
| `packages/ui-mac/resources/document-runtime/extract_msi.py`（新增） | 固定的随包 Python ctypes 适配：只读查询真实 MSI 表/流并用 Cabinet API 还原原目录，校验目标路径和关系；不执行 msiexec、安装序列、自定义 action 或系统注册，不下载外部 CAB，不提供任意命令入口 |
| `packages/ui-mac/resources/document-runtime/verify_runtime.py`（新增） | 固定的版本/最小转换验证任务及结果读回：使用独立 profile 和控制样本，检查新 PDF 非空、可解码、版本/页数真实；执行与终止接到现有 Location/权限面。只接受准备器派生的资源/工作路径，不接收模型脚本；不以 main 裸执行用户文档绕过执行权威 |
| `packages/ui-mac/src/main/user-data-layout.ts` | 增加 documentRuntime 目录名；下级 runtime、profiles、字体缓存及临时根从此派生。共享 pinned-files 缓存和文件名仍由 #1760 派生，本片只消费返回路径 |
| `packages/ui-mac/src/main/naming-migration-map.ts`、`naming-migration.ts`、`naming-migration-wiring.test.ts`、`naming-migration.test.ts` | 必要的同调用链登记同步：旧名表只约束/枚举真实存在的历史键，相关断言也只覆盖这些键。当前代码以 USER_DATA_LAYOUT 的全部键推导旧名，新增 documentRuntime 会产生 undefined；最小修正为从旧名表枚举。保留全部既有映射，不给新目录编造旧名、不添加迁移行为或兼容分支 |
| `packages/ui-mac/src/main/codepuppy-sidecar-messages.ts`、`codepuppy-sidecar-messages.test.ts` | 按 §4.8 承载本功能 runtime.changed 的窄通知并消费同一状态 schema；核对实际 generation/sequence，隔离停止或旧代回包。完整 DocumentHost 环境请求和卡片接线在片 4，不在此扩展其它生产发送路径 |
| `packages/ui-mac/src/main/document-resources.ts`、`document-resources.test.ts` | 复用既有四字体/模板身份、Office Python 与资源根供准备器使用；新增固定运行脚本/随包许可材料的实际路径验证。保留 Node 的显式输入接缝，不决定启动器 v2.1 token |
| `packages/ui-mac/scripts/build-document-licenses.ts`（新增）、`prebuild.ts`、`packages/ui-mac/electron-builder.config.ts`、`resources/NOTICE.txt` | 从同一已验 pin 实物提取/核对 LO 原始许可和署名，带入下载前可读的随包目录；复制固定运行脚本、许可及来源记录。构建也不另造 LO 获取通道；没有真实材料时不能把许可清单记为完成，不代替发行者发布源码/资产 |
| `packages/ui-mac/src/main/fixtures/document-runtime/**`（按需新增） | 仅从所选 DMG/MSI、真实 hdiutil/LO 输出、MSI 表/CAB 或现有真实控制文档提取小样本，记录来源 pin/摘要与提取方法；不提交整包，也不手写另一系统的表/文件格式。操作流程重放及完整平台测量保留一次性证据 |
| `docs/specs/document-output-quality/plan.md` | 填核对、证据和偏离，不修改冻结设计/其它规格或受保护规则 |

main 的生产装配、固定文件窄桥和执行面由 #1760 与片 4 的 DocumentHost 接线消费；本片不向 bootstrap 塞函数，不从 main import core/server，不新增 renderer 可传 URL/路径/命令的通道。材料准备与状态测试可先按冻结端口实现；端口尚无真实实现时，保持其导入/调用归原拥有者的集成依赖，不写同名临时实现或用构建期 downloader 代替。普通库与 reader 不 await LO。

### 顺序

1. **状态、路径与固定文件消费提交**：从冻结契约消费 pin 及失败类型，增加文档状态和目录布局；完成历史键枚举的必要同步。准备器只从共享清单选本平台 LO entry，版本/文件身份读取该 entry，不另放 URL/摘要常量。控制共享获取的等待与完成，证明查询不等待下载、并发只展开一次、下载字节与阶段真实、失败保留诊断。清单实值和真实 #1760 调用尚缺时，只记录对应集成 pending，不提交伪 entry 或生产 fallback。
2. **解包、字体与验证提交**：mac 消费共享口已验证的 DMG，以只读/no-browse/no-autoopen 方式挂载，保留原 app 字节/签名复制到私有暂存根并在 finally 卸载；Windows 以同一随包 Python 处理 MSI/CAB。依据真实材料处理目录映射、文件名和流，拒绝路径越界；不能从外链补附件。生成实际 fontconfig/profile/私有字体，运行固定 headless 最小转换并检查新 PDF；全部成功才原子发布 ready。verify 的执行/强制终止沿设计 §4.4，不给下载加总时限，不把实际转换超时记成下载失败。
3. **生命周期与随包材料提交**：完成取消、异常卸载/未发布目录、重启后重新确认有效 runtime、fonts/pin 身份变化时的私有配置重验，以及状态通知的代/序号。有效固定文件缓存由共享口重验；本片不设置 TTL、容量帽或清理用户目录。把实际 LO 许可/署名及源码取得说明带入包，核实际复制结果；ready 事件只供片 4/6 消费，不提前创建待查队列或额外助手服务。
4. **一次相关收尾**：每步迭代本步用例名，步末运行改变行为的测试文件一次；返回前跑较宽相关集合一次。完整 DMG/MSI 解包、headless 转换、执行超时/中止、出网记录和三字体对照用一次性命令/产物留证，不让普通测试重复下载约 300/376 MB 实物或反复做重型旅程。没有实物/平台/外部发布时明确列 pending，不以模拟成功代证。

新用例组采用 `document runtime` / `document runtime fonts`，从相应 package 目录执行：

```sh
# packages/util
bun test src/codepuppy-document.test.ts -t 'document runtime'
bun test src/codepuppy-document.test.ts
bun typecheck

# packages/ui-mac
bun test src/main/document-runtime.test.ts -t 'document runtime'
bun test src/main/document-runtime-fonts.test.ts -t 'document runtime fonts'
bun test src/main/document-runtime.test.ts src/main/document-runtime-fonts.test.ts
bun test src/main/document-resources.test.ts src/main/codepuppy-sidecar-messages.test.ts
bun test src/main/naming-migration-wiring.test.ts src/main/naming-migration.test.ts
bun typecheck
```

较宽相关集合至少包含 `codepuppy-sidecar-wiring.test.ts`（共享消息消费者）、`old-name-scan.test.ts`（布局/许可/文档）、片 2 的 `document-resources.test.ts`；已在步末跑过的文件不重复。新增状态导出/消息的真实 consumers 用 `rg` 搜索后补到本节。`naming-migration.test.ts` 只因必要历史键枚举修正纳入，不扩查或修复其它历史迁移问题。若实际验证需要修改既有进程生命周期拥有者，再列出直接文件及证据，不另造围栏/停止器；不跑整包、bin/check、gate，不启动 app/Electron/任何窗口。

### 风险

- **发行实物与清单不是代码可虚构的输入**：两份原字节副本的自有 release 发布、精确源档/许可材料和 relay 快照部署均归调度方/owner。没有可取 originUrl 就不新增可消费 entry；不得用 TDF provenanceUrl 下载、构建下载函数或另一白名单绕过。香港实网续传、改道、北京与 owner 下载核对为 **pending（资产及 relay 发布后，消费共享口实测）**。
- **#1760 端口尚未落地**：共享 readPinnedFiles/ensurePinnedFile、ConnectorLaunchHost/PinnedFileDelivery、失败分类和代生命周期沿其冻结定义消费。真实清单解析/缓存重验/失败事实/进度与 DocumentHost 首次查询的连接为 **pending（#1760 交付、片 4 装配后）**；不把私有受控测试函数记成生产端口已接通。
- **准备 verify 的执行归属**：实际 LO 进程必须沿当前 Location 的执行/权限面进入，不能为跑探针放宽围栏或绕过它；代码只准备固定 job 及检查真实结果，主进程不接收任意脚本。真实受限执行、178 s 取消/180 s 强制终结与无外网的联动证据在对应端口就绪后完成；接缝若实际不足，返回其具体事实与最小 seam 请求，不另开执行通道。
- **平台边界**：Windows MSI/CAB API、私有字体发现和正式包执行不能在 Mac 上冒称通过；取不到所选 MSI 的真实表/流也不能手写等效输入。Win32 API/目录关系或正式签名验证与实物矛盾时返回证据，不改用系统安装器、管理员权限或用户关闭保护。Windows 真执行为 **pending（Windows 实机及实际 pin）**；Mac 正式签名/Gatekeeper 归真包验证。
- **字体配置不等于成品证明**：XML/路径/四字体身份先用实际文件验证；三指定字体、无微软雅黑和去配置对照要求真实 LO PDF 的嵌入字体/逐段范围核对。不卸载 owner 字体以制造环境；条件不足转干净账户/机器验收。完整 Office 页图和模型 Read 覆盖在片 4/6/8，不能以控制文档一次转换替代 AC-06/08。
- **状态不能吞掉文件交付**：准备失败/停止/旧代消息不得把已制作成品抹掉，也不阻塞普通库和 reader；恢复只沿共享口/已有动作，不增加轮询服务、重试引擎、有效期或用户确认。持久补查和用户收到结果的 AC-10 证据仍归片 6。

### 证明

| AC / 本片范围 | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| AC-06：真正可用的 LO 才 ready | `document-runtime.test.ts` 验 pending→extract→verify→ready 及失败/取消；实际选中 pin 的版本/最小转换输出由随包 PDFium 解码、记录真实页数与渲染来源 | 只下载/展开就发布 ready、复用旧同名 PDF、忽略非零退出/空 PDF 时失败；删除 verify/原子发布保护的反例须使测试变红。三格式全页图与助手看到的页数留片 4/6 |
| AC-08：私有字体配置与真实替代基础 | `document-runtime-fonts.test.ts` 解析生成 XML，核实际目录/缓存/file URI、四字体摘要及字体家族映射；真实 LO 三字体文档的 PDF 字体/字形与去配置对照 | 配置未指向随包字体、XML 特殊字符损坏、Windows 误用 fontconfig 或丢失整家族替代表时失败；成品单段一致必须由真实渲染证明，未取得则 pending |
| AC-09：后台准备、共享获取与离线复用 | 组件用例核共享 ID-only 调用、真实进度传递、一次展开、缓存/失败事实消费；在共享口发布后以安装包记录断流续传、HK 失效→同一 origin、缓存重验及离线启动 | 传 URL/第二下载器、硬编码缓存、丢进度/错误分类、每次都重下或用户须安装时无法通过；国内两地与真实入口证据在外部依赖就绪后补，不用本地假延迟代证 |
| AC-10：不等待下载且可通知 ready | 卡住获取完成的受控本功能用例：查询立即返回 preparing，现有制作资源/reader 可用；ready 状态通过同一消息 schema 只通知当前代、递增 sequence | 环境查询 await 整包、失败阻塞生成、旧代回包覆盖当前状态时失败；Word/Excel/PPT 先交付及原会话补查由片 4/6 真引擎验，当前不计整条通过 |
| AC-13：准备后的转换没有更新/外链出网 | 解析真实 profile 的更新/宏/外链配置；共享下载阶段与完成后的固定转换分别记录出网，后者不应新增连接 | 只检查配置文本而实际仍检查更新不能通过出网证据；去禁网/配置的对照须在真实执行入口体现。首次 pin 下载不混入“准备后渲染无外网”的计数 |
| AC-14：下载前可读许可及原包保留 | `build-document-licenses` 从实际 pin 解包树生成来源/许可材料；按真实 extraResources 复制后核 LICENSE/NOTICE/第三方署名与来源摘要，配套精确源码副本/说明由发行者交付 | 原包许可被裁剪、包里只有链接或占位清单、缺对应源档交接时不能记通过；删除已分发许可/摘要校验的反例变红，不上传或发布任何资产 |
| AC-15：同一逻辑的 Windows 分支 | 真实所选 MSI 表/CAB/PE 输入的路径/目录映射检查；Windows 主机执行只读解包→私有字体→headless 控制转换→ready | 假 MSI、错目录/入口、安装动作或误用 mac 字体机制无法通过真实执行。Mac 上只做可证的纯逻辑/真实样本解析，Windows 全流程及最终包 AC 保持 pending |

### 偏离记录

2026-11-26 · 本片在执行接缝核对时暂停，尚未修改生产代码；片 4 未启动。`SEAM-CHANGE-NEEDED: DocumentHost / runtime verify`：本节要求固定 `verify_runtime.py` 走 Location 执行面，真实最小转换成功后才发布 ready；冻结 [design §4.3](design.md#43-libreoffice-固定文件准备与状态) 的状态在 verify 阶段不携带可执行任务，§4.8 的 DocumentHost 只有 environment/chromiumRender/defer/recordCheck/subscribeReady（`design.md:357-366`），没有准备器向所属 Location 交付固定 verify 任务及收取完成/取消回执的契约。现有 `packages/plugin/src/promise/shell.ts:15-17` 只提供 hook；实际 `Environment.Service.spawner` 绑定于 Location（`packages/core/src/environment/environment.ts:11-40`）。`ConnectorLaunchHost.ensureFile`/`resolveAssets` 分别返回已验文件/启动器资产，也不承载此任务（`../connector-launchers/design.md:292-299,482`）。这项缺口独立于 #1760 实现和发行实物尚缺，不能以 pending 集成或受控回调成功代证。所需最小补齐：由设计拥有者明确一个固定准备验证任务及其完成/取消回执的执行契约，绑定本代、pin 与所属 Location，并使准备器能据真实结果原子发布 ready；不开放任意模型脚本或 URL 的 main 执行。本次只记录接缝证据，不决定新签名或修改冻结设计；由调度方处置后恢复本片。验证为只读契约/实际 API 核对；没有运行应用、LO、下载、行为测试或 removal arms，不计 AC 通过。

本轮文档证据：`python3 scripts/check-doc-links.py docs/specs/document-output-quality/plan.md` 为 12 links PASS；ui-mac 的 `bun test src/main/old-name-scan.test.ts` 为 10 PASS / 0 FAIL；`git diff --check` 为 exit 0。文档契约检查的本文件 findings 为 0，完整输出 `/tmp/alpha-1761-r5-docs-contract.json`；仓库原有 69 errors / 253 warnings 与片 3 PLAN 回执相同，继续归调度方，不扩修索引/其它文档。本轮只有核对与接缝记录，无实施或 AC 完成声明。


2026-11-26 · r6 接缝解除后的实施：新增 `packages/util/src/codepuppy-pinned-files.ts` 与 `codepuppy-connector-launch.ts` 的冻结共享数据定义，供本片从唯一导出消费；没有共享下载、清单解析、分类器或临时宿主实现。#1760 集成时须直接复用这两份声明，不能再复制定义。因 §4.9 新冻结任务，必要增加 `packages/ext/src/document-runtime-verify.ts`、`document-runtime-bridge.ts`，并扩展既有 `hub-bridge.ts/.test.ts` 的同一监听；回调只接本 Location/代的固定脚本任务，重复合并、取消排空，不占重载 handler 或 20 s 查询预算。以上是首版文件表外的必要同调用链文件。主进程/Location 的生产装配留给片 4 的 DocumentHost；#1760 实际入口仍 pending，不以受控组件回调当集成成功。

本片组件已实现 ID-only 获取、共享准备、私有暂存/原子 ready、真实 PDF 路径/摘要和任务身份守卫；mac 只读挂载/原 app 复制与卸载、Windows MSI/CAB 固定脚本、私有字体配置与固定真实转换任务。Windows 脚本只完成语法核对，未取得所选 MSI 表/CAB，不伪造样本；Windows Win32/真实包及正式签名/退出/围栏行为继续 pending。已写 `scripts/build-document-licenses.ts` 的原包许可提取函数，但真实发布 pin/源码材料尚缺，未接 prebuild、未写共享清单、未生成或冒称随包 LO 许可完成；这三项按外部发布依赖续交，不添加下载器或伪 entry。

命令证据：ui-mac 六个相关文件（runtime、fonts、resources、sidecar-messages、naming-migration-wiring、naming-migration）77 PASS；ext `bun test src/hub-bridge.test.ts` 14 PASS；util `bun test src/codepuppy-document.test.ts` 2 PASS。三个包各自 `bun typecheck` exit 0。`bun /tmp/alpha-1761-r6/probe.ts` 经实际公共 CrossSpawnSpawner 和随包 Office Python 调固定脚本，真实 LO 26.8.3.1（发行版 26.8.3）→PDF→PDFium 全页解码，exit 0，1 页，摘要 `900261aaf3d10bd6b4ecb892dbc64ec98409b2b7d2ab1457524d6da69fb99eb1`；回执 `/tmp/alpha-1761-r6/verify-receipt.json`。首次探针暴露 PDFium 5 的 PdfPage 不支持 context manager，修正为 finally/close 后复核通过；私有 XCU/fontconfig 均经 Python ElementTree 实际解析，两个固定 Python 脚本 AST 通过。本探针未运行于正式 app 围栏，也没有验证原始 DMG 摘要/发行下载；不计这些 pending 项通过。

执行偏离：一次误在仓库根运行 `bun typecheck`，触发 turbo 后约 1.7 s 已以 exit 2 结束（自身新类型错误及既有 codepuppy-ui 缺模块错误），没有运行测试；一次根目录 `bun test` 被 do-not-run-tests-from-root 守卫拒绝，exit 1，未运行用例。随后命令均显式限定包目录，只核本片新代码；未调查/修复其它包。该误操作已告知调度方，不记作相关验证 PASS。未运行 bin/check 或 gate。


移除臂：`python3 /tmp/alpha-1761-r6/removal.py` 的 pin 摘要、字体替代表、验证身份、PDF 摘要、重复任务合并、打包入口六臂均 exit 1（断言失败）；逐臂原字节恢复，结果 `/tmp/alpha-1761-r6/removal-results.json` 及各 `arm-*.log`。最初两个等待失败状态的反例暴露测试不应只等某一终态，现改为等待 ready/failed 任一终态再严格断言 failed，反例直接变红；中止并排空了原反例进程，未记其超时为通过。返回前 wider：sidecar-wiring 4 PASS、old-name-scan 10 PASS（新增来源注释先触发旧名守卫，改为引用契约名/提交后通过）；本片唯一用例总数 107 PASS，不累加迭代重跑。正式受围栏固定任务、共享端口/原始包许可与 Windows 的 pending 不变。

## 切片四：文档渲染、共享回执与产物面板

- 依据：spec v1 @ `31cd182e09`，AC-04、05、06、08、10、13 的渲染/回执贡献；冻结设计 @ `46f8580c95a47e4a03ea128d99b405edd3424e6e` §4.1、4.4、4.8、4.9、§6 R4/R5/R12；继承片 2/3。#1760 实际资产/固定文件连接仍为集成依赖，Excel 最终缓存重算在片 5，Read/vision/check 及持久补查 admission 在片 6。
- 核对：r6 brief 明确授权本片先写计划，未出现冻结设计未决问题即同轮实施；本轮 Codex / GPT-6 按既有契约自核文件与顺序，不冒称调度方另行审查或变更冻结决定。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/util/src/codepuppy-document.ts/.test.ts` | 在同一共享面增加 RenderRequest、环境/成品/页/渲染回执/结果、DocumentHost 发布口及纯数据验证；只消费已有 Location/Session ID。check/defer 数据按冻结形状交所属后片处理，不用空成功替代检查 |
| `packages/ui-mac/src/shared/document-resources.ts`、`document-runtime-fonts.ts`（新增）；main 的 `document-resources.ts`、`document-runtime-fonts.ts` 及现有测试 | 将本票已有资源身份/profile 函数移到 main/ext 都可合法消费的 Node 资源权威；原 main 入口消费同一实现。固定脚本/字体/模板来自发布投影，不让 ext import main，也不复制路径/字体/许可证逻辑 |
| `packages/ui-mac/resources/document-runtime/render_document.py`（新增） | 固定 Office/PDF 快照、格式核对、PDFium 全页 PNG/版本/尺寸/摘要；Office 先 LO PDF，独立 profile，不改原文档，拒旧 PDF 和源变更。XLSX 最终缓存重算调用位在 ext，由片 5 接入，不自造计算器 |
| `packages/ext/src/document-render.ts/.test.ts`、`document-tool.ts/.test.ts`（新增）、`document-runtime-verify.ts` | Location 绑定的固定执行与结果读回；校验业务参数先于 I/O、工作区真实路径、check/revision/源身份和实际文件，产生共享 metadata；复用公共进程实现/取消，不接任意程序、命令或 main URL。工具文案纳入现有登记簿 |
| `packages/ext/src/context-injection.ts`、`plugin.ts`、`hub-bridge.ts/.test.ts`；main 的 `codepuppy-sidecar-messages.ts/.test.ts`、既有宿主/sidecar/bootstrap 装配文件（仅必要同链） | 承载 DocumentHost 的 ID 请求/应答、verify 注册及 generation/sequence/停止终结；发布同代只读资源投影，在真实 Location setup 注册和 cleanup。#1760 未交付则保持显式装配依赖，不添加 Node 路径、下载实现或成功替身 |
| `packages/ui-mac/src/main/document-host.ts/.test.ts`（新增） | 组合环境/准备/Chromium、归属和文件核对；工作根初始化/gitignore；把 pending 的真实 artifact 交冻结 defer 端口，后续 admission/check 归片 6；不从 main 启动用户 Python |
| `packages/ui-mac/src/main/preview-isolation.ts/.test.ts`（新增）、`html-preview-host.ts`、`rail-preview-host.ts` 及已有测试 | 提取已有预览权限、请求和导航的共同不变量，三个载体消费同一份；保留原预览 UI/交互及 PDF 内置资源能力 |
| `packages/ui-mac/src/main/document-chromium.ts/.test.ts`（新增） | 固定当前 job 资源映射、离屏载体、无外网、字体/图片/two-rAF 时点、完整网页分片与完整设计 PNG；真实存在/摘要与超时销毁后才发布回执；Electron 用已有测试方式替换，不启动应用或窗口 |
| `packages/ui-mac/src/renderer/codepuppy-ui/session-rail/artifacts/local-artifacts.ts/.test.ts`、`shared/office-advisories.ts`、`engine-adapter/local-artifacts.engine.cases.ts` | 元数据为成品来源，保留 write/patch、子会话、目录/文档/stat 规则，排除工作根；删除旧 writer 映射/分支，替换编码旧行为的用例，真实引擎 scenario 只更新不在本轮运行 |
| `packages/core/src/filesystem/codepuppy-project-watch.ts` 及其现有相关测试 | 在唯一 FOLDERS 表忽略工作根，不另加 renderer watcher 排除表 |
| `docs/specs/document-output-quality/plan.md` | 本片实际文件、证据、偏离与 pending 续记；不改冻结设计、其它规格、ADR 或目录快照 |

### 顺序

1. 共享数据与 Node 资源/profile 权威；固定 Office/PDF renderer 和 Location 适配。先测参数/身份/格式/缺文件、所有真实 PDF 页和摘要，再用片 3 的实际 LO 控制样本做一次性三格式/直接 PDF 输出探针；不用 mock 成功声明真实渲染。运行 util 文档文件、ext 渲染文件和被移动资源的已有文件；必要 package typecheck。
2. 共用预览隔离和 Chromium 导出。用现有 Electron fake 验三个载体的实际策略、load/fonts/decode/two-rAF、长页最后一片/设计完整画布、外链诊断、超时/失败及缺输出；不启动 app/Electron/窗口。正式离线截图比对保留片 8，不能以 fake 像素代证。
3. 工具/宿主/桥/回执消费、工作根和 watcher。真实文件的 pending/失败回执不抹掉成品，修正身份不跨会话/Location；不存在的 PNG 不进 metadata。接入面板的同一 schema 并删除旧分支，更新旧行为断言。#1760 的真实 resolveAssets/清单/下载调用及正式 bootstrap 在其交付后核实际集成，不造宿主 fallback。
4. 每步只跑改变的用例/文件；最后一次跑实际依赖搜索选出的较宽相关文件与包 typecheck。至少含资源/sidecar 消费者、两个预览器既有测试、local-artifacts/office-advisories 的消费者及 watcher 忽略测试。移除身份/页循环/metadata/隔离保护的对应臂必须变红。普通检查不加入完整 LO 旅程或模型测量；不运行整个包、scenario、bin/check 或 gate。

### 风险

- 片 3 的共享获取/许可/Windows 真执行及正式围栏仍 pending；工厂级装配测试不代证安装包，缺真实 pin 不生成假清单或另下 LO。
- 实际源模板属性未知则 template=null；不据模型声称填 bundled。LO 域/目录内容问题在同一轮改稿与后续真引擎证明，不把转换成功当内容齐全。
- HTML 允许本地 JS，但资源路径和网络必须受同一 workspace/job 守卫；不能照搬用户预览的体积/页数帽。只给校验过的业务参数，主进程不执行模型命令。
- pending 持久 admission、实际逐页读图与 Excel 最终缓存是后片所有权；本片只调用既定端口、保留真实渲染事实，不报告“已检查/公式无错”。生产装配缺前片提供者的地方明确 pending，不用未注册端口回退执行。

### 证明

| AC / 本片贡献 | 命名证据 | 删除行为的失败判据 |
| --- | --- | --- |
| AC-04 PDF/HTML/design | 实际多页 PDFium、HTML 全 scrollHeight 分片和设计完整画布用例；一次性 LO/直接 PDF 输出与 PNG 尺寸/摘要检查 | 跳过末页、只截首屏、缺 PNG 或伪目标回执失败；离线版面/中文复制/海报溢出仍须真实成品验收 |
| AC-05 渲染与修正身份 | `document render` / `document tool` 的 checkId、revision、源变更及 metadata 用例 | 错会话/Location/源或迟到结果获接受即失败；实际发现并修一轮留片 6/8 |
| AC-06/08 来源/全页/字体 | 三 Office 固定转换→PDFium 的真实页数/来源、片 3 profile 共用及模板来源解析 | 替换成其它 Office 预览、丢页、无字体 profile 或口头模板回执失败；干净字体环境和 Windows 真包仍 pending |
| AC-10 先交付 | pending/失败的实际 artifact 经工具 part→scanLocalArtifacts 的用例 | 环境阻塞文件、丢 metadata、虚构 PNG 或检查失败抹掉文件即失败；持久补查与原会话回复片 6 |
| AC-13 无外网 | 共享预览隔离和 Chromium 固定资源映射/外链诊断用例 | 新载体未调用共用策略、外网未取消、导航/权限放行则变红；真实包出网记录片 8 |

### 偏离记录

暂无。依据冻结 R4/R5/R12 及 §4.9 选实现细节，没有新产品或跨模块设计取舍，按 r6 继续实施。

2026-11-26 · 切片四的真实 Word 字段反例（修正前证据）：片 2 的 `build-document-templates.py` 用空 `w:fldSimple instr="TOC ..."`；实际 LO 26.8.3.1 的固定刷新/转换仍只在 PDF 正文出现一次“正文”，没有目录条目。`.../office-runtime/build/arm64/bin/python3 -I -B` 的独立 PdfReader 核对在 `/tmp/alpha-1761-r6/word-fields-inspection.json` 记 `tocRendered=false`，断言 exit 1；固定脚本本身 exit 0 不作为目录已更新的证明。对照为锁定 docx 9.16.0 的 `TableOfContents` 实际产物 `/tmp/alpha-1761-r6/native-toc.docx`：原生 SDT/复杂域、书签和 PAGEREF，不能用空简单域替代。属同调用链模板缺陷，下一提交修正生成器/真实模板并重核实际 PDF；不因此变更设计或引入用户刷新步骤。这是一条一次性真实产物验证，不加入依赖 LO 的常规测试。
