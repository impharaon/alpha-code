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

2026-11-26 · 原生目录修正的必要同调用链偏离：`build-document-assets.ts` 用已锁 docx 9.16.0 构建真实 TOC/heading 样本，`build-document-templates.py` 把原生 SDT/复杂域及配对书签纳入应用模板，其余样式/页眉页脚保留；Word 模板版本升为 2，fixture 只复制实际新字节并更新摘要/来源，不手造外部 XML 样本。实际 `bun scripts/build-document-assets.ts` exit 0，593 文件/四字体/三模板核验通过。固定 `update_fields.xba` 只在 app 私有 profile 执行字段/目录刷新，输入只有渲染副本；LO 自己创建原生 Basic catalogue，不开放模型宏/脚本。固定脚本仍输出原文件的空 TOC/PAGEREF 缓存诊断，不能用副本刷新掩盖原成品需在同一轮修正内补齐的缓存。

修正后 `bun /tmp/alpha-1761-r6/word-fields-probe.ts` exit 0，回执 `/tmp/alpha-1761-r6/word-native-receipt.json`；独立 PdfReader 的同一断言 exit 0，实际 PDF 出现“正文……1”目录条目及正文标题，`word-native-inspection.json` 的 `tocRendered=true`。原模板反例与新原生结构的真实渲染构成 red→green，不把单纯 XML 存在计作版面通过。该目录修正属于本片必要模板消费者，未改冻结设计或其它规格。


2026-11-26 · r6 切片四实施回执：共享 RenderRequest/Receipt/Result/metadata 与 DocumentHost/消息验证已在 util 同一处导出。固定 Office/PDF 脚本经 Location 公共 spawner 执行，读取源快照、所有实际 PNG/尺寸/摘要、转换版本和模板来源；HTML/design 使用同一预览隔离策略的离屏 Chromium，等待字体/图片/two-rAF，处理最后一次 scroll 被浏览器钳制，设计画布完整导出。每次渲染有独立 job/profile，178 s 取消及 180 s 主边界终结；实际文件以共享 metadata 投影到产物面板，pending/失败不抹成品，不把目标路径当文件。check/revision 绑定当前会话/Location；工作根由唯一常量排除于面板和既有 watcher。

实际文件偏离：新增 `ext/document-process.ts` 为 verify/render 复用同一固定公共执行边界；`document-register.ts`、`document-host-bridge.ts` 和 main `document-host-bridge.ts` 承载本 Location 注册/清理、现有 ID 桥、代与注册身份/取消。现有 `codepuppy-tools.ts` 真工具列表登记本工具，而非另建工具表；其说明登记使 `context-injection-inventory.snapshot.txt` 机械新增一行/总计。`plugin.ts` 未加入虚假的资产提供者。`shared/workspace-file.ts` 仅移出现有主进程真实路径守卫并提供实际成品/容器/PNG 核对，main 继续同一导出；`tool-card-model.ts` 必要复用持久化第一方 authority，防外部同名工具伪造回执。不新增 `preview-isolation.test.ts`：两个既有预览器与新 Chromium 的现有相关文件覆盖相同实际策略，避免重复测试。Word 模板生成器/fixture 的必要修正见前述 red→green；本次还补可见“目录”标题，未改其它模板版本。

生产集成边界明确 pending：#1760 的真实 `resolveAssets`、pinned 清单/获取/分类器尚未交付；实际 bootstrap/sidecar 收发必须组合 `createDocumentRuntime → createDocumentHost`（authorize 绑定既有 Location/权限与 generation 写权，不能自造 allowlist）、`createDocumentMainBridge`、ext `createDocumentHostBridge → publishDocumentHost → registerDocumentTools`，在 Location 释放/代停止时排空。当前提供组件及真实工具发现入口，缺投影时明确失败，没有猜 Node 路径、空 ready 或第二下载器。`defer`/`recordCheck`/`subscribeReady` 的持久记录、Read/vision 证明和 admission 仍归片 6，必须注入其真实实现；恢复时重建既有检查身份也由其与 renderer 对接，不把内存 Map 当持久完成记录。真实 app 围栏/退出/出网、离线浏览器像素及 Windows 正式执行、实际发布 pin/源码/许可与 relay 均保持 pending。

验证（只计唯一用例，不累加迭代）：本片相关集合 **361 PASS / 0 FAIL**。ext 的 `document-render.test.ts`、`document-tool.test.ts`、`hub-bridge.test.ts`、`context-injection.test.ts`、`plugin-host.test.ts` 共 116；ui-mac 的 `document-chromium`、`document-host`、`document-resources`、`document-runtime`、`local-artifacts`、`tool-card-model`、`tool-card-provenance-gates`、`office-advisories.fast` 共 153，另 `html-preview-host`、`rail-preview-host`、`workspace-file-service`、`document-runtime-fonts` 共 70，wider `codepuppy-sidecar-wiring`/`old-name-scan` 14；util 文档文件 5；core 既有 watcher 文件 3。命令均在对应 package 运行 `bun test <以上文件>`；详细分组日志 `/tmp/alpha-1761-r6/{ext-final,ext-restored,ui-fixture-final,ui-restored,ui-related,ui-wider,core-watch}.log`，143 个最初已绿用例与修正后重核的失败文件不重复计数。四包各自 `bun typecheck` exit 0，无包级 lint 命令。新增 tests 为 util/tool 的纯快速层、文件/bridge/Chromium facade 的有界集成层；依赖经实际 imports、资源测试的固定脚本 literal 和已有文件追踪；既有 engine cases 只更新为旧 writer 无回执的负对照，未运行 scenario，也未加重 nightly 旅程到 PR。

迭代中本次模板 fixture 的 provenance 更新曾漏同步 assets.json 摘要，使资源用例失败并令两个等待 verify 的用例超时；现已按实际字节重算 manifest，相关 21 用例绿。登记新增工具后库存快照先红，按实际 inventory 生成同步后相关文件绿；没有降低断言。新增字段诊断读取时曾复用 `kind` 局部变量，现改 `field_type`；`office-runtime/.../python3 -I -B /tmp/alpha-1761-r6/verify-writer-dispatch.py` 用实际 Word 原生域样本到固定 Writer 边界，exit 0，不启动 LO。三个 Python 固定脚本 AST exit 0。

一次性真实产物：`bun /tmp/alpha-1761-r6/render-probe.ts` 经公共 spawner、随包 Python 和实际 LO 26.8.3.1 对 Word/Excel/PPT 及直接 PDF 各输出 1 页真实 PNG，回执 `/tmp/alpha-1761-r6/render-receipts.json`；独立 pypdf 的 3 页 PDF 与全页 renderer 对应 3 页，`pages-proof.py` 删除页循环后只输出 1 页，独立断言 red，恢复后原字节一致（`page-proof/receipt.json`）。这些不能代证模型真的读取所有页、正式围栏或 Windows。Word 原生目录 red→green 实物在前两条回执；最后补可见标题后的重跑 `gate slot -- bun /tmp/alpha-1761-r6/word-fields-probe.ts` 因共享队列预计约 3 小时，尚未取得 slot 即 SIGINT 取消并确认 exit 130，没有启动子命令；不计最终标题版实际 LO 复核通过，不绕过队列。当前标题/原生域及其摘要已由实际 fixture/资源验证，最终版 LO 复核交后续真实产物验收。

移除臂：`python3 /tmp/alpha-1761-r6/removal4.py` 的工具 metadata、页摘要、末片 scroll、共享导航隔离、第一方回执身份、同代旧注册六臂均因命名断言 exit 1（不是超时）；加前述真实 PDF 全页臂，共 **7 个 red**。各臂已恢复原字节，相关文件复跑 21（ext）+15（ui）绿；结果 `/tmp/alpha-1761-r6/removal4-results.json` 与 `arm4-*.log`。

较宽选择器基线缺陷：工作树根 `affected-tests --list` exit 2，stderr 为 `No such file or directory: .../.gate-tests`，未产生 scope line；实际 `.gate-tests` 不在树中。记录为 gate 配置/调度方去向，不扩大为全量、增写选择器配置或假报 affected scope。原命令输出 `/tmp/alpha-1761-r6/affected-tests.scope`。未运行 bin/check/gate run、未启动 app/Electron/窗口、未上传发布部署；foreground 排空，hooksPath 保持 `.githooks`。

返回前文档核对：`python3 scripts/check-doc-links.py docs/specs/document-output-quality/plan.md` 为 12 links PASS；alpha profile 的文档契约检查本文件 findings=0（全仓既有 322 findings 不扩修），输出 `/tmp/alpha-1761-r6/docs-contract-final.json`；`git diff --check` exit 0。已核 Codex / GPT-6：上述本片组件证据成立，完整 AC 与正式生产集成仍按已列 pending 续交；没有变更冻结决定。


## 切片五：Excel 操作、保真重算与透视刷新

- 依据：spec v1 @ `31cd182e09`，AC-03、07、11；冻结设计 @ `46f8580c95` §4.6/4.7、§6 R9/R10/R11、§10 R1-4/R1-10；继承已验收片 2/3/4，不重开决定。r7 授权本片计划后同轮实施，但计划若揭示未决设计问题则停止。
- 核对：r8 IMPLEMENT — 按 brief 继续 `d3c2190fc8` 计划；Python 交接缺口由冻结设计增量 `7ef8b89b30` §4.10/R13 关闭，维持一参 API。调度方授权继续本片、随后计划/实施片 6；本轮已核 Codex / GPT-6，不另称独立审查。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/resources/office-excel/excel_mcp/**`、`LICENSE`、`sources.json`（新增） | 以试验实际 2.3.2 wheel 为输入，收纳选中 operation、calc、Workspace/package 及静态依赖最小闭包；逐文件记源/改编摘要及配额移除，不复制社区 MCP/HTTP/SSE/上传服务，不引入另一套解释器或目录项 |
| `packages/ui-mac/scripts/vendor-office-excel.py`（新增） | 重现固定源码选择和改编、生成来源清单，验证实际 wheel 版本/摘要/MIT；六个对象操作的函数注解和对应 InputModel 是 schema 唯一源，排除其它工具。仅构建期读已取得的固定输入，不做运行期下载 |
| `packages/ui-mac/resources/office-excel/codepuppy_office/__init__.py`、`excel.py`、`objects.py`（新增） | 导出同一 OfficeExcel；inspect/read/find/游标，sort/字面查替，共用 edit 保存；对象 schema/执行复用同一 Pydantic 模型。edit 计算实际变更源区域，在 package.prepare/apply 前重建可重建 pivot；当前 workbook 的 Engine 结果及 stale 标记进入同一 results 回调；不可重建者保留并返回具体诊断 |
| `packages/ui-mac/resources/office-excel/codepuppy_office/recalculate.py`、`cache.py`、`recalculate.xba`（新增） | 固定副本/私有 profile/LO calculateAll/store、进程退出与期限；按 sheet 身份和坐标合并原 ZIP 的缓存/类型及 chart cache，保留公式、扩展与非目标 part，源摘要一致才原子提交；运行环境消费口须先由下述接缝裁定，不在此自选路径/变量 |
| `packages/ui-mac/scripts/build-office-runtime.ts`、`src/main/office-runtime-lock.test.ts`、`document-resources.test.ts`（必要同链） | 将应用模块与选中源码/实际许可证装入两个目标的 Office Python site-packages，构建戳纳入实际源字节，`-I` 实际 import/能力读回并核许可；继续原锁闭包，不直接安装完整社区发行包，不增加未经设计允许的依赖。两平台目录消费现有路径权威 |
| `packages/ui-mac/resources/office-mcp/server.py`、`src/main/office-mcp.test.ts` | read_xlsx 增强和三类操作/重算工具仅委托 OfficeExcel，保留 workspace 授权；旧 read_xlsx 的公式文本断言按新行为调整。writer 移除仍归片 7，当前不提前改 Word/PPT/PDF 或连接器发布版本/描述 |
| `packages/ui-mac/src/main/office-excel.test.ts`（新增，模块此前无测试）、实际生成的 `fixtures/office-excel/**` | 最低层的同模块 API/ZIP/保真/桥接用例，fixture 来自真实 2.3.2、当前制作库及现有试验工作簿，注明来源；重算合并单元用例消费一次真实 LO 输出，不手写另一系统的 ZIP/对象结构 |
| `packages/ext/src/document-render.ts/.test.ts`、`document-process.ts`、`document-register.ts`（仅必要同链） | XLSX 在渲染前调用同一重算入口、消费结果与新源摘要，再生成同版图片；失败/公式错误/透视诊断保留可交付文件，不用转换中间本替代原工作簿。跨进程环境交接未定前不加运行时参数/空成功回调 |
| `packages/ui-mac/resources/factory-skills/office-docs/xlsx/SKILL.md` 及其来源清单 | 只随本片已实现入口同步 Excel 的共享保存/对象/读取/重算实际用法；全套技能流程接线仍归片 7，生成来源/改编摘要机械同步，不改上游锁版本 |
| `docs/specs/document-output-quality/plan.md` | 本片计划、实际文件/偏离、命令与 pending 证据；不改冻结设计、其它规格、gate、目录源或另一仓 |

### 顺序

1. 先补齐 Python 消费宿主实时运行环境的冻结接缝；本轮已定位的具体证据在偏离记录。它决定 recalculate 的启动及 pending 行为，不可用 PATH、固定安装目录、伪 ready 或只在测试注入的回调替代。确认后按实际试验 wheel/源码提取最小闭包、MIT 与 schema，构建 Office Python 并验证 `-I` import；不先实现一份临时保存/计算器。
2. 接 OfficeExcel 共用 edit 与 inspect/objects/apply_edit：先单个改变用例，步末跑模块文件；再用实际 pivot/slicer/sparkline 产物验证二次保存与修改源后 rebuild、不可重建诊断、当前公式数据回调，及游标版本绑定/字面替换/排序。schema 未知字段必须明确 invalid-input，不能只比 JSON 标题或上游工具数量。
3. 固定 LO 副本重算→原 ZIP 缓存/图表合并→原子提交；先用真实计算副本的合并层用例，再进行一次实际 LO 重算/连接器读回。独立求和、公式错误位置、字符串/布尔/空结果及共享/数组映射与等价性按真实样本核对，失败不提交半份结果。重算后接 XLSX 渲染同版摘要。需要共享 `gate slot` 的命令前台排队，按 r7 **等待并重试，不因排队取消**；期间只做不冲突的轻量工作。
4. 连接器只委托模块，相关 stdio 用例核真实返回及授权；步末跑对应文件。最后按 `rg` 实际 imports、工具枚举和资源引用选一次 wider，至少包含 office-mcp-tools-snapshot（若改动事实须与片 7/外仓发布边界核对，不能手编目录）、codepuppy-office-instance、Office 资源/锁及 ext renderer 消费者，四包中实际受影响包的 typecheck。运行 `affected-tests --list` 报真实 scope；既有缺 `.gate-tests` 不以全量兜底，不改 gate。

### 风险

- **Python 环境交接未决**：§4.1 的环境是 JS DocumentHost 的异步结果；§4.6 的 Python API 无环境/宿主参数，现有 stdio 命令只传 format/workspace。如何绑定当前 Location/代、取得实时 preparing/ready/failed、派生 profile/字体/job，以及重启后拒旧状态尚未定义。它不是 #1760 的共享下载实现尚缺，不能仅写 integration pending 来填一个空绑定。所需最小裁定见偏离记录；此问题未补齐，本片不进入实现。
- **配额不能换成“大数字”**：2.3.2 有 CellBudget/ZIP/text/operation/schema 多处限制；逐实际调用链移除与格式无关的限制，保留 OOXML/引用/对象合法性。若最小闭包实际要求未批准的新依赖，先给出模块/导入证据，不安装完整社区 server 或另造同义实现。
- **保真不由 openpyxl/LO 保证**：读取真实 extension、关系与 package 状态；原 ZIP 非目标 part 摘要及公式身份是证据。chart cache、共享/数组公式、命名源和不可重建 pivot 必须覆盖真实样本，未取得样本不手写替代、不冒称通过。Excel 创建/重刷来源的诊断不能只凭 can_rebuild mock 代证；单元边界可受控，Acceptance 留实际对象。
- **分片归属**：完整 AC-03 的默认模型三次成品、Windows/正式包在片 8；外仓目录 re-intake/发布与片 7 的快照/工具清单联动不是本片可手编替代的工作。AC-11 的默认关闭连接器条件不变，模块入口本身必须可用。正式 #1760/发行资产与围栏集成的既有 pending 不重复声明成通过。

### 证明

| AC / 本片范围 | 命名证据 | 层与时机 | 移除行为的失败判据 |
| --- | --- | --- | --- |
| AC-03：新鲜重算/汇总/保真 | `office-excel.test.ts` 的缓存合并与 source-changed；真实 LO 计算副本、原 ZIP 扩展/关系/公式与 chart cache 核对，独立合计实际销售数据 | 快速 XML/数据逻辑及真实文件集成为 affected PR/nightly；真实 LO/试验对照一次性命令记录；默认模型三次旅程片 8/nightly | 缓存缺失/公式不等价仍成功、整本 LO 回存、丢 chart/扩展、覆盖并发编辑均使相应断言失败；未跑模型旅程不记整条通过 |
| AC-07：读每个公式值与错误位置 | 既有 `office-mcp.test.ts` 的实际 stdio read_xlsx/excel_inspect；模块对 stored/community-evaluator/missing 的真实来源标记、分页/游标源变更 | 同一模块纯逻辑 fast、随包 Python/stdin/filesystem integration，affected PR/nightly；LO 输出真实样本一次性留证 | 只返回公式、把不支持当 Excel 错误、漏 #REF! 地址/跨版本翻页或静默截断会失败；删返回值/缓存来源/源摘要守卫的臂必须红 |
| AC-11：对象/排序查替与保存前刷新 | `office-excel.test.ts` 模块与原 ZIP、`office-mcp.test.ts` 委托；真实 200 行工作簿做 pivot/slicer/sort/replace 后 LO 打开，检查只一个既有 Excel ID | 模块/文件/stdin 为 integration affected PR/nightly；200 行多步/LO 为一次性 Acceptance，未来完整旅程仅 scenario/nightly，不加重每个 PR | 去掉 package.apply 会丢实际扩展；去 rebuild/changed-range/当前公式回调则汇总仍旧；去诊断会误报 Excel-made pivot 已刷新；六个 operation 任一未执行、字面替换错成正则/排序不动都会失败 |

### 偏离记录

2026-11-26 r7 · 开始核对时间 08:43:42 UTC（16:43:42 +08）。本轮只读了当前契约/直接调用链与实际 2.3.2 wheel 的 Workspace/pivot/schema/Engine 实现，没有改生产代码或启动 LO。**SEAM-CHANGE-NEEDED: OfficeExcel.recalculate / Python DocumentEnvironment handoff**：`design.md:312` 冻结 `recalculate(path)`；§4.7 要据实时 LO 状态返回 pending，且独立 profile/字体/固定宏由应用配置。现有 `main/document-host.ts:29-38` 只给 JS 调用返回环境，落盘仅 `.gitignore`；`ext/document-host-bridge.ts:33-37` 只返回 JS 对象；`util/codepuppy-document.ts:86-95` 的发布槽为进程内 Symbol，不可由 Python `-I` 读取。stdio server 当前 `main()` 只接 format/workspace（`resources/office-mcp/server.py:49-74`），且 `shared/office-advisories.ts:149-151` 的既有连接器环境权限不提供文档环境通道。设计没有定义 Python 模块取得宿主投影的入口、身份/时效、私有资源路径及 pending 的归属；仅实现 #1760 的 ensureFile/Node 不会使这个 Python 入口自动成立。

所需最小补齐由设计拥有者定义：在保留一参 OfficeExcel API 与不新增引擎 API 的前提下，明确默认脚本及 stdio 连接器共用的、绑定已授权 Location/本代的运行环境读取契约（状态、LO 入口、应用生成 profile/字体/工作目录和失效/缺投影行为），并给出生产者/消费者归属；若选择另一签名则显式修订原权威。实施者不自行选环境变量、工作区 JSON、用户数据路径约定或另开 RPC，不给测试专用 configure 成功替身。r7 明确允许计划暴露未决问题即停；本轮只提交本节，等待该具体契约后恢复同轮实施工作。没有运行行为测试/移除臂或提交实现，AC-03/07/11 不计通过；没有把共享执行槽等待取消，本轮尚未派发 LO 命令。

本轮文档证据：`python3 scripts/check-doc-links.py docs/specs/document-output-quality/plan.md` 12 links PASS；`git diff --check` exit 0。`affected-tests --list` exit 2，缺 `.gate-tests`、没有 scope line，与已记录基线相同（`/tmp/alpha-1761-r7-affected.scope`），未更改 gate 或运行全量。文档契约本文件 findings 为 0；输出 `/tmp/alpha-1761-r7-docs-contract.json`。已核 Codex / GPT-6：计划文件/顺序/证据已列，唯一需先回设计的事项为上述 Python 环境交接；其它冻结决定沿用。

2026-11-26 r8 · 09:25:29 UTC 开始。本片原接缝由 `7ef8b89b30` 的 §4.10/R13 解除，读取远端设计，未 merge/rebase。实际 2.3.2 wheel SHA-256 `d0201d55d64d52a4cb1f0be25565631ab803e55dfc2eff286b1bc40a4a0e256c` 提取 160 个 Python 文件及一个实际 JSON 数据文件；MIT、源/产出摘要与改编说明均进入同一资源目录。没有装完整 MCP 发行包或新增 pip 依赖。应用模块经同一个 Office builder 安装到真实 site-packages，`-I` import 与 inspect/edit/schema/排序字面替换、并发源保护/游标版本、缺投影失败的 5 个模块集成用例通过。源码选择器首次遗漏运行期 JSON，已按实际依赖补齐；一次写文件命令工作目录错误，未写入，修正后继续。

必要同链问题已定位：实际 openpyxl+lxml 生成的 workbook 在 sheet 局部声明关系前缀；2.3.2 的 `package.scan.rel_id` 只看根声明，首次添加 slicer 进入 package.apply 时 KeyError。该真实输入的 regression 将先单独提交 red，再补最小局部 namespace 消费修正，不改保存权威、不降为裸 openpyxl.save。当前提交仅为共用模块/来源和已绿子集，R13 投影、LO 实物、对象完整保真仍在本片后续，不宣称整条 AC 通过。

保存回归 red：`cd packages/ui-mac && bun test src/main/office-excel.test.ts -t "saving edited pivot"` exit 1，`package.restore.sheet_parts → scan.rel_id` 返回空关系 ID，KeyError；日志 `/tmp/alpha-1761-r8/preservation-red.log`。fixture 为测试中实际 openpyxl 生成的工作簿，经真实 2.3.2 操作创建 pivot/slicer，Source 使用实际上游模型的 sheet/name；不是手写 OOXML。此提交只加入该回归和证据，下一提交修正解析。

保存回归 green：相同测试断言未改，namespace 修正消费 tag 上实际 xmlns 声明；同时移除 reader 的配额记账减法（非扩大数值），当前公式 results 对齐上游真实 `dict[address,value]` 契约。`bun test src/main/office-excel.test.ts` 6 PASS/0 FAIL，日志 `/tmp/alpha-1761-r8/operations-green.log`；实际 pivot 汇总随 `=10+2 → =20+2` 变为 22，二次保存仍有 slicer/sparkline parts。两次中间失败分别为 None 配额记账和本次 results key 适配错误，均为同调用链修正，未降阈值或改红测断言。

R11 实物 red（修正前）：共享 `gate slot -- bun /tmp/alpha-1761-r8/lo-probe.ts` 正常取得 slot，实际 200 行/透视/切片器/迷你图/公式图表样本的 `OfficeExcel.recalculate` 在既定 180 s 终结为 failed/timeout，独立成功断言 exit 1；`lo-probe.stdout/.stderr` 保留证据，没有取消队列或报告成功。任务 `recalculate-c2e4ccbe-79e4-437c-82d0-75204c217bcb/source.xlsx` 与原稿 SHA-256 同为 `137249c7a53cac5f1f896a95caa9b0810283ffe5aa193cca6c3bbe703790dfa8`，未提交缓存。实际 job 的 Module1.xba 被 LO 首次 profile 初始化覆盖为默认空 Main（seed 仍为本应用宏）；固定源 xlsx/scripts/recalc.py:62-82 明确先 terminate_after_init、再放入宏。下一个修正将沿此事实先初始化任务私有 profile，再从 main seed 复制固定宏，不重写共享 seed、不新增环境/命令输入或另一套安全配置。该一次性真实验收不加入 PR 的慢用例；后续仅在修正代码后排队重验。

LO 初始化修正后第二次取得共享 slot；固定宏已实际执行、LO 回存副本，原稿保持未改。结果进入缓存合并后因 LO 将错误公式写成 `=#ref!`，openpyxl Tokenizer 只接受大写错误字面量而失败为 calculation（`lo-r2.stdout/.stderr`），不是再次初始化超时。本提交修正首次 profile/宏覆盖及实时投影读取；下一回归将直接保留这份真实原稿/LO 副本以证明错误字面量等价和原 ZIP 缓存合并，不把真实错误删除或当未支持函数隐藏。

缓存等价回归 red：保留实际 run-2 原稿与 LO 副本到 `src/main/fixtures/office-excel/`，来源/摘要在 PROVENANCE.txt。`bun test src/main/office-excel.test.ts -t "real LibreOffice caches"` exit 1，`Invalid error code ... =#ref!`，日志 `/tmp/alpha-1761-r8/cache-red.log`。命名断言同时要求实际 SUM=20100、中文字符串/布尔缓存、原 #REF! 公式/位置、chart cache 与所有非目标 part 原字节，删除合并/保真行为必须红。此提交只加测试/实际 fixture 与证据，不修改缓存表达式比较。


r8 已完成组件与必要偏离：按 §4.10 追加 `main/document-python.ts`，runtime 的现有状态源先写投影再通知；配置模板继续由原字体/profile 拥有者生成，固定宏从种子复制，Location 注销/代停止先 invalidated。`DocumentHost.pythonEnvironment` 与现有桥增加纯数据操作；ext 的环境查询保留记录、shell hook 覆盖/删除保留键，只有启用且先经受保护声明确认的 Office 配置才在 MCP transform 临时合入。新增必要同链文件为 core 的 `mcp/codepuppy-first-party-mcp.ts`、`mcp/index.ts` 及既有 `codepuppy-mcp-runtime.test.ts`，ext 的 `plugin.ts`、`policy/identity.ts`、`policy/index.ts` 及既有 tests，ui 的 `shared/office-advisories.ts`/tests；同一个纯数据 matcher 消费宿主预期值，未宽泛 allowlist、未用环境字段充当首方凭据、未写用户配置。#1760 未提供实际 bootstrap/固定文件生产者与 main binding 调用点的部分，保留原集成 pending，不以组件登记替代正式接线。

连接器实际新增 inspect/edit/objects/recalculate 并增强 read_xlsx，全部委托 OfficeExcel；默认关闭及唯一 Excel ID 不变。`read_xlsx` 的旧 rows 投影替换为 cells/算值/来源/错误/游标，既有用例同步；server 版本升为 **2.0.0**，避免把改变的发布定义仍标旧版。`gen-office-mcp-tools.ts` 改用同一个随包解释器以取得同一 Pydantic schema，生成 tools.json；不是手写目录。新增 `recalculate_document.py` 仅接已授权工作簿路径，ext XLSX 渲染先调用同一重算入口、更新源版本后再渲染。四个 legacy writer 的去除/构建烟测制作方式仍归片 7；目录新摘要/re-intake 仍归已列外仓依赖，不冒称已发布。Excel 技能只同步实际 edit 打开模板与环境自动注入用法，来源锁同字节更新。

最终相关集合 **282 PASS / 1 FAIL**（唯一用例，不重复累计）：ui 13 个相关文件初跑 133 PASS/1 FAIL，唯一失败为 sidecar-wiring 仍枚举旧 Excel 两工具，按新增四工具的事实同步后该文件 4 PASS，故本组最终 134 PASS；技能包装/卫生两文件 38 PASS；`office-excel.test.ts` 8 PASS/1 FAIL；ext 的 plugin-host/document-render/document-tool/hub-bridge/policy-identity 五文件 92 PASS；util 文档文件 7 PASS；core 既有 MCP 文件仅选 `Office declarations bind|the command main writes|the real server.py` 为 3 PASS，不跑同文件容量/计时旅程。日志为 `/tmp/alpha-1761-r8/{ui-related-final,sidecar-consumer-green,skill-consumers-final,office-excel-final,ext-related-final,core-related-final}.log`；util `bun test src/codepuppy-document.test.ts` 7 PASS 见工具输出。四包各自在目录运行 `bun typecheck` 全部 exit 0，日志 `*-types-final.log`。首次 util 类型检查漏动态 import 的 .js 后缀，已修正；MCP 工具生成器前缀 import 曾放到 shebang 前，已修正。没有全量 suite/bin/check/gate run。

**当前具体 blocker 为新增实物测试的输入预设，不是新的设计取舍。** `office-excel.test.ts` 的 `real LibreOffice caches ...` 预设 LO 对原公式 `=#REF!` 生成的错误缓存必为 `#REF!`；实际保留的 LO 26.8.3.1 副本明确是公式 `=#ref!`、缓存 `#NAME?`。本次缓存表达式规范化只处理引号外错误字面量的大小写等价，原 `<f>` 不变，错误按 LO 实际值返回，不能编造 #REF! 来满足测试。此测试仍失败于 exact error 断言，未改断言或阈值，未记通过。依 delivery-implement 的明确规则 “If the test's assertion itself is wrong, return BLOCKED instead of editing it.”，将该断言处置交调度方；建议保留源公式/单元格/非目标 part 的断言，错误值按实际 LO 权威处理，但本轮不自行改测试。切片 5 尚未整体验收，切片 6 的计划/实施均未启动。

独立已核事实：缓存合并组件在真实 LO 副本上得到 SUM=20100、中文字符串和布尔缓存，实际错误定位 Summary!K2/#NAME?；产物 `/tmp/alpha-1761-r8/cache-merged.xlsx`。只读检查原 ZIP 与该产物的 **18 个非目标 part 全部原字节相同**，切片器/迷你图保留，chart cache 为独立合计 20100（`cache-inspection.json`）。它不替代仍红的回归，不冒称整个 OfficeExcel.recalculate 原子提交旅程已绿；两次 LO run 均正常取得 slot，第一次按既定超时终结，第二次完成 LO 后由缓存校验返回失败；没有取消排队。

六个 removal arms：`python3 /tmp/alpha-1761-r8/removal.py` 的 trusted-environment、projection-invalidation、in-flight-pin、source-hash、pivot-rebuild、package-preservation 均为命名断言 exit 1，非超时；结果 `removal-results.json`。最后一臂临时同步变体的产出摘要以越过来源守卫、实际触达保真行为，随后源码与 sources.json 均原字节恢复；没有持续放松校验。恢复后全部非阻塞相关文件与四包类型核对如上；本轮已无运行的 LO/队列任务。

其余 pending 去向不变：#1760 生产接线/许可资产与 relay、Windows 实机、正式围栏/退出/出网、共享/数组公式及真实 Excel-made 对象的补充实际样本、片 8 默认模型三次旅程；本次 controlled can_rebuild=false 用例不假称 Excel 实物。`affected-tests --list` 仍 exit 2（缺 `.gate-tests`），没有 scope line，输出 `/tmp/alpha-1761-r8/affected.scope`，交调度方/gate 配置拥有者，不改 gate 或全量兜底。已核 Codex / GPT-6，依据 `7ef8b89b30`；冻结决定未变。结束前工作均提交、前台排空，hooksPath `.githooks`。

最终文档检查：本节 12 links PASS、`git diff --check` exit 0；alpha profile 文档契约本文件 findings=0（全仓既有 322 findings 不扩修），`/tmp/alpha-1761-r8/docs-contract.json`。工作时间约 09:25–10:20 UTC，包含共享 slot 等待和首次既定 180 s 超时；本轮未启动 app/Electron/任何窗口，未 push/PR/merge、上传、发布或部署。

保存前新增直接接线回归：真实 `Plugin.Context.location` 是 `Location.Info`（`packages/plugin/src/promise/plugin.ts:29`、`packages/schema/src/location.ts:19-25`），含 project；文件契约是 Location.Ref。当前 writer 直接序列化 Info 会被 Python 的严格投影 schema 拒绝。既有 `Python projection...` 用例补真实形状及 Ref-only 断言，target 命令 exit 1，`location-ref-red.log`。先提交该正确断言，再仅在 main 写文件时投影 directory/workspaceID；不修改仍待处置的缓存错误断言。

Location.Ref 回归 green：相同新断言未改，main 文件现在只写 directory/workspaceID；`bun test src/main/document-runtime.test.ts` 11 PASS，`bun typecheck` exit 0，日志 `location-ref-green.log`、`ui-types-location-ref.log`。该修正不影响其余用例计数，仍为 282 PASS/1 个待处置错误码断言 FAIL。

r9 裁定续接：调度方 Claude Opus 5.5 明确授权只修实际缓存测试的错误值。`fd16895522` 将预期改为 fixture 实际的 #NAME? 并注明来源，其余断言不变。`cd packages/ui-mac && bun test src/main/office-excel.test.ts` 为 **9 PASS / 0 FAIL**（`/tmp/alpha-1761-r9/excel-green.log`）；移除 cache.merge 返回的 errors 为 [] 后，命名实物用例 exit 1（`assertion-removal.log`），源码恢复后整文件绿。故片 5 既有最终集合合计 **283 PASS / 0 FAIL**（仅本文件重跑，其余沿 r8 证据），不据此冒称尚未完成的真实完整 LO 原子提交旅程、Windows 或默认模型 AC 已通过。

## 切片六：逐页自检、一轮修正与就绪补查

- 依据：[spec v1](spec.md) @ `31cd182e09`，AC-05、06、09、10、13 的本片部分；[design](design.md) @ `7ef8b89b30` §4.5/4.8、R7/R8 及 §10；消费片 4/5 与既有 Read/云识图和 session.synthetic。文档影响为实施证据，仅更新本 canonical plan，不修改冻结设计、受保护规则或其它规格。
- 核对：r9 `Phase: IMPLEMENT` 授权先追加本节并在无未决设计问题时同轮实施；Codex / GPT-6 自核现有 API 与冻结契约，不冒称调度方对本节另有审查。当前未见未决设计问题；#1760 生产 composition 仍为既有集成依赖。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/src/shared/document-check-records.ts`（新增） | 工作区已有 checkId 的归属、revision、receipt 与报告读写/原子落盘的内部权威；ext/main 共用，不新建公共协议或队列 |
| `packages/ext/src/document-check.ts/.test.ts`（新增）及既有 `document-render.ts/.test.ts`、`document-tool.ts/.test.ts`、`document-register.ts` | 检查当前回执/源/页摘要、全页覆盖和实际视觉结果，诚实降为 partial；固化同任务 revision、恢复既有身份、限制第二轮改稿；Location 订阅 ready，用原 notificationID 调现有 synthetic |
| `packages/ext/src/cloud-vision-hooks.ts`、`plugin.ts` 及既有 `plugin-host.test.ts` | 从现有 Read 图片登记和原生/云转写结局记录页面摘要事实，沿同一缓存/压缩/凭据/拒绝路径；检查卡片使用现有 metadata/title，不加视图 |
| `packages/ui-mac/src/main/document-checks.ts`（新增）及既有 `document-host.ts/.test.ts`、`document-host-bridge.ts` | 原子保存 DeferredDocumentCheck、就绪/重新挂接重放 waiting/admitting、核 admission 身份、终结删除会话、存最终报告；不新增 Session 引擎或服务路由 |
| `packages/ext/src/context-injection.ts` 及清点 snapshot（仅实际登记项改变时） | 同步工具已有说明中的逐页检查、一轮修正、pending 与补查指令；完整技能入口和 legacy writer 替换仍归片 7 |

### 顺序

1. 归档/检查组件及其既有渲染、工具文件用例：真实渲染 fixture 的页图/源/receipt 为输入；通过实际 Read `toModelContent` 形状验证 inspected 证据，缺图/过期摘要/视觉失败/页序不全不能完整盖章。检查与文件下载互不设闸。
2. 主进程 deferred 原子存储、runtime ready 与桥重连重放；ext 直接委托本 Location 的 synthetic，验证 durable 回执的 ID/session/type/delivery/payload。逐个证明断线同 ID 重试、admitted 不再入队、Session 删除与文件变更/丢失。
3. 完成 Location setup/cleanup 与现有工具标题接线；步末跑改变文件各一次。返回前按实际 imports、声明枚举/清点选 wider 一次，至少包括 document-render/tool、host/runtime/桥、plugin-host、util 文档契约、上下文清点；受影响包 `bun typecheck`。全流程只跑相关用例；容量/计时/默认模型旅程归片 8/nightly。

### 风险

- 看见图片的证据必须来自实际模型请求的 Read 图片/已成功转写；render、文本提取或仅路径登记均不够。记录哈希/路径并在报告时重核当前页，失败明确 partial；不另打视觉请求。
- 内存登记不足以支持重启：归属/原稿/修后页图与 pending 均须落盘，再让同 ID 重放；旧桥未收到 admission 时不提前 admitted。新应用实例不声称退出期间在执行。
- 用户修改文件和一轮修正的边界以源摘要核对；pending 恢复查当前文件并说明版本，不能用旧图覆盖盖章。文件/会话消失沿既有错误契约报告/终结，不自动重建会话。
- #1760 的实际 main/ext composition、正式打包退出/围栏/网络、真模型发现/修正溢出、Windows 仍待其交付与片 8；组件模拟断线不替代这些实测。

### 证明

| AC | 测试/证据 | 层与运行时机 | 缺少行为为什么会失败 |
| --- | --- | --- | --- |
| AC-05 | document-check、document-render/tool：逐页成功/失败事实、过期图、原稿→唯一修正→复核、完整与 partial、报告 fixes/remaining 留存；真实溢出修复沿片 8 的真实需求 | 快速文件/钩子为 affected PR/nightly；实际模型旅程仅 scenario/nightly | 未读/失败仍 inspected、旧稿被盖章、允许第二轮改稿、丢修正/剩余问题会使断言失败；无模型实物不记整条 AC 绿 |
| AC-06 | 既有实际 renderer receipt/页图由检查消费，检查对页序/摘要/源版本逐项核对 | 文件 integration affected PR/nightly；真实 LO 页数证明沿片 3/4/8 | 伪造页数、页摘要或旧源不能形成完整有效报告 |
| AC-09、10 | document-host 及 ext check：pending 持久化、ready/重新注册 admission、重启同 ID、删除会话、文件更改/丢失、admitted 去重；现有桥传递 | 文件/桥 integration affected PR/nightly；干净安装/断网/退出正式包片 8 | 去原子持久化/同 ID/回执核对/重放/cleanup 任一使对应恢复或去重断言失败；文件 pending 仍可交付 |
| AC-13 | 原生图片路径无额外网络、云视觉成功与失败沿原缓存，组件 fetch spy/既有视觉用例 | 现有钩子 integration affected PR/nightly；正式包出网记录片 8 | 原生路径偷发请求/重复绕缓存或把拒绝当成功会失败 |

### 偏离记录

暂无。开始核对 2026-11-26 10:27:51 UTC，包含 r9 单断言处置；本片局部执行预计约一小时（不含共享 slot/外部集成等待），如实际规模倍增按 brief 返回。所有新增测试 import 模块、fixture 使用字面路径，选取无需改 gate；当前基线缺 `.gate-tests` 的已知限制仅如实报告。


r9 首个实施提交核对：本节消费 `74e2a0aec2` 与恢复 brief `Phase: IMPLEMENT` 的同轮授权，已核 Codex / GPT-6；冻结版本仍为 `7ef8b89b30`，未重新设计。工作区 check 归档成为 main/ext 同一内部权威，pending 原子落盘与真实 ID 桥重放已实现，主 host 直接组合其持久存储；#1760 的生产 bootstrap 调用者仍未交付。必要文件增量：`util/codepuppy-document.ts` 的三种阶段纯数据；既有 `cloud-vision.test.ts` 消费真实 Read.toModelContent/Message/PNG fixture；UI 的既有 tool-card-model/tests 与 zh/en 词条将同一 metadata 投影到原步骤行，不新增 DOM/样式/稿件；原生/云/首方 authority 复用现有持久身份。工具说明库存由既有生成器重生，条目仍 98，实际字节 29833→30180；此前 wider 唯一红为这项机械快照同步，未改阈值。

本提交组件证据：ext 改变的四文件 33 PASS，ui 相关六文件 143 PASS；ext wider 初次 143 PASS/1 个已说明快照差异（日志 `/tmp/alpha-1761-r9/{ext-changed,ui-related-final,ext-related-final}.log`）。两包 typecheck exit 0（`ext-types-final.log`、`ui-types-final.log`）。新增独立真实插件 API 探针已得到正常 durable admission 和相同 ID 精确重试，但 Session 删除后实际抛 `Session.NotFoundError`，与 HTTP 客户端的 `SessionNotFoundError` 不同；下一提交单独保留该正确断言 red，然后只改本功能错误分类。中间两次探针 setup 错误为漏 Location 和把 core remove 的 ID 参数写成对象，均已据实际接口纠正；不归咎于引擎、不改引擎。当前仅保存本片可恢复实现，不声称全部验收完成。


真实 Session 删除回归 red：`cd packages/ext && bun test src/plugin-host.test.ts -t 'document ready admission'` 为 0 PASS/1 FAIL；前两项实际 promise plugin API 的 durable admission 和精确 ID 重试断言均通过，第三项在 Session 删除后抛实际 `_tag: Session.NotFoundError`（`real-admission-final.log`）。回归仅使用当前引擎真实插件宿主、Session 与 promise 适配器，无模型调用或外部请求；既有 host 单元用例的错误输入也改为同一实际 NotFoundError 构造器，保持 session-missing 断言。此提交只保存正确反例与来源，下一提交修改本功能分类，不加入 HTTP 错误兼容分支。

r9 真实删除回归 green：仅把 ext 本功能的分类改为实际插件 `_tag: Session.NotFoundError`，未添加 HTTP 错误兼容分支，未改变 red 的三项断言。`bun test src/plugin-host.test.ts -t 'document ready admission'` 为 1 PASS（`real-admission-fixed.log`）；ui 的同一实际错误构造器用例为 1 PASS（`missing-session-fixed.log`）。随后各改变文件整文件核对：ext 的 document-check/plugin-host/context-injection 三文件 **101 PASS**（`ext-fix-final.log`），ui document-host **8 PASS**（`host-final.log`）。公式检查新增既有 module 文件用例：实际 main 投影生产者建立本 Location 配置/私有 job 根，检查沿该投影取得应用计算回执；保留的实际 LO 工作簿 fixture 提供错误值来源。受控的应用回执/页图只证明报告关联，不冒称一次新的 LO 重算；将错误列表隐藏为 [] 会红。

本片最终相关集合去重 **296 PASS / 0 FAIL**：ext 七文件 146（首轮 144 的快照同步后同名用例转绿，再新增真实 admission 与 formula report 各一条；改变的三文件最后已整文件 101 PASS，其余四文件沿 `ext-related-final.log`），ui 六文件 143（`ui-related-final.log`；错误输入改为真实构造器后 host 八条最后重核），util 文档契约 7（`util-final.log`）。没有把迭代/target/removal 结果重复计入 PASS，也没有重跑无关整层。三包 `bun typecheck` 均 exit 0：`ext-types-checked.log`、`ui-types-final.log`、`util-types-final.log`。片 5 单断言修正的 9 PASS 单列，本轮合计 **305 个唯一相关用例 PASS**，不将片 5 的 r8 集合重复累加。

八条本片 removal（`python3 /tmp/alpha-1761-r9/removal-six.py`）均 exit 1：visual-evidence（无实际看图不能生成完整报告）、source-digest（旧图不可盖新源）、one-correction（不得用 revision 0 绕一轮）、durable-pending（无落盘文件不能恢复）、same-notification（改通知 ID 后交接不能完成）、admission-identity（错误 ID 不得 admitted）、native-vision-fact（原生 Read 的实际证据）、formula-receipt（不得把实际错误列表清空）。结果在 `removal-six-results.json` 与各 `removal-*.log`；没有进程超时，same-notification 为组件的未交接状态断言等待终结，非耗时性能断言。变体均在 finally 恢复原字节，恢复后的对应文件整文件 green 如上。另加本轮片 5 的 errors=[] 单独 removal，合计 **9 arms red**。

偏离/集成边界：新增 `ui-mac/shared/document-check-records.ts` 是 main/ext 对归属、覆盖与当前源/页摘要核对的单一权威，避免复制同一判定；新增 `main/document-checks.ts` 的记录不是 Session 队列，重试仅在既有 runtime ready/桥重挂时交同一 notificationID 给现有 synthetic。main host 的私有 composition 参数收敛为 documentRuntimeRoot，内部组合已有 callbacks，不修改公共 DocumentHost 或引擎 API。实际 Session 错误入口只据本轮真宿主事实更正，未归因 owner；同链新 import 为 ui 测试消费 core 的窄错误构造器，不进生产依赖。没有改 protected ADR、其它规格、另一仓、下载/发布/部署或生产引擎路径。当前 LO 下的新完整 OfficeExcel.recalculate 原子提交、之前取消的 Word 目录标题 rerun、正式 #1760 wiring、许可发行/relay、Windows/退出/出网及默认模型真实改稿仍归既有集成与片 8，未以组件 PASS 冒充 AC 全部完成。

最终文档核对：14 个相对链接 PASS；从 canonical alpha profile 派生仅覆盖当前 checkout 的临时 profile（`/tmp/alpha-1761-r9/profile.yml`，未改仓库配置）运行 check-docs-contract，当前 plan findings=0，输出 `worktree-docs-contract.json`。全仓既有 69 errors/253 warnings 与此前相同，不扩修；最初直接 canonical profile 指向主 checkout 的结果未作为本 worktree 证明。`affected-tests --list` exit 2，原因仍为本旧基线缺 `.gate-tests`（`affected.scope`），无 PR scope line，ship 合并已有该文件的 origin/alpha 后处理，不改 gate 或全量兜底。已核 Codex / GPT-6；执行约 10:27–10:55 UTC，约 28 分钟，未倍增；所有前台命令完成后返回，hooksPath 保持 `.githooks`。

## 切片七：默认制作入口、旧 writer 消费者与目录集成

- 依据：[spec v1](spec.md) @ `31cd182e09`，AC-01..05、09、11、12、14 的入口/消费者部分；[design](design.md) @ `7ef8b89b30` §4.1/4.8、R12、§8/§10；Issue #1761。片 1–6 由调度方独立审查，本片仅在其上切换必要消费者，不处理未返回的审查发现。
- 核对：`f9e0b79b40` · Codex / GPT-6，r10 `Phase: IMPLEMENT` 授权本节计划后无设计待决即同轮实施；核对实际调用链，未见新增设计问题，不冒称调度方另行审查本节。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/resources/factory-skills/office-docs/SKILL.md`、`factory-skills/cloud-capabilities/SKILL.md` | 总入口改为七个固定技能的短路由；默认制作/编辑直接用随包环境与原权限面，用户模板优先；六种成品、自检/一轮修正/pending 补查、已授权 OfficeExcel 操作；不要求启用 MCP 或再问一次执行确认。cloud-capabilities 原文档行只指向此入口，不留“创建一律用 MCP”的旧指令 |
| `packages/ui-mac/resources/office-mcp/server.py`、生成的 `tools.json` | 从工具声明/dispatch 删除四 writer 及其私有不可达实现/常量/import，保留三个 reader、增强 Excel reader 与四操作；不留 alias 或扩大 JSON writer；运行原 gen-office-mcp-tools 生成声明 |
| `packages/ui-mac/scripts/build-office-runtime.ts` | 构建烟测先用同一随包 Python 文档库/OfficeExcel 生成真实样本，再经原生产命令的 stdio reader 读回；不以 import/握手替代读回。样本验证 Python/reader，不假称默认模型制作路线或正式成品质量；不引入 Node 路径或 DocumentAssets 构建循环 |
| `packages/ui-mac/src/main/office-mcp.test.ts`、`office-mcp-tools-snapshot.test.ts`、`attachment-read-roundtrip.test.ts` | 旧 writer 的正向/版式断言随旧行为替换/删除；保留实际文件生成→reader 读回、路径权限、Excel 操作与错误报告；新增四 writer 不在列表且直接调用 unknown、不写文件；schema drift 改测保留 reader 字段。附件往返只切换样本制作端，暂存/指令/读取/时间线全链不改 |
| `packages/ui-mac/src/main/codepuppy-sidecar-wiring.test.ts`、`packages/core/test/codepuppy-mcp-runtime.test.ts` | 同步实际声明工具集合/未连接前声明/真实 server.py 消费者；core 只选相关三个用例，不跑同文件计时容量旅程 |
| `packages/ui-mac/src/main/codepuppy-factory-skill-hygiene.test.ts`、`factory-skills.test.ts` | 删除旧 writer 形状/措辞漂移检查，保留真实发现、来源/许可、空壳与其它云能力断言。文档路由的证据是实际发现和人工逐项核读/制作读回，不再新加正文措辞/标题数量断言 |
| `packages/ui-mac/test-component/session-rail-artifacts.cases.ts` | 原 Excel writer 正向产物夹具换成持久首方 document receipt，维持本机文件行、缺失提示、点击预览等原用户结果。历史显示/旧 writer 无回执反例与第三方同名政策反例均非正向制作消费者，保留 |
| 原 `packages/ui-mac/scripts/sync-catalog-snapshot.mjs` 的两个生成输出（仅生产者实际已发布本契约时） | 只运行现有验签同步器消费现有发布；核实际 tools/描述/digest。未交付则记录版本/差异 pending，恢复本次无关生成差异，不手编快照或同步锁，不改 alpha-web |

### 顺序

1. 入口与工具面/构建消费者一并切换：以真实随包库生成样本，替换同模块旧行为测试并重新生成 tools.json；先改变用例，再整文件。入口正文以源文件核读记录六路由、模板优先、环境路径、检查/补查与无额外确认，不把字句断言当成产品质量证据。
2. 切换附件与 UI 正向夹具、声明枚举；各改变模块整文件一次。已有 artifact receipt/watcher/Read 行为保持原组件责任，仅跑必要消费者。最后 wider 一次：factory 包装/来源、office 声明/sidecar、附件和实际受影响 UI 模块，ext 只跑实际受影响指令消费者；core 三个 named 用例与 ui/ext 的 applicable typecheck。
3. 运行原目录同步器并只读核对实际发布版本，记录外部依赖；运行 `affected-tests --list`（旧基线缺 .gate-tests 仍仅报原因）、文档链接/契约与 diff 检查，按切片独立提交。removal 只跑被改行为的命名断言，不跑全套、模型/安装包/LO 或计时旅程。

### 风险

- 不能只删 advertised 定义：dispatch/不可达 writer 与烟测/附件输入同步，reader 必须读回真实文件；未知 writer 不得写出任何新文件。工具 manifest 仍由 server.py 生成，server v2 随所有切片共同发布，不伪称中间提交已发布。
- 构建顺序中 Office Python 先于 DocumentAssets，因此烟测不递归启动资产构建或借测试 fixture 充生产资源；默认用户模板路径仍完全来自 environment/资产锁。
- 旧目录源/快照是其它仓拥有者的发布实物依赖，不能为让本仓测试绿而手编定义、修改 digest 或放宽守卫；未完成目录集成明确 pending。审查范围 1–6 不混入本片 commits。
- 本片不证明九次默认模型成品指标、真视觉修复或干净打包平台验收；这些仍归片 8。冻结 gate 不改，实际测试条数如因删除旧行为而减少，回执交调度方处理其门控拥有面。

### 证明

| AC | 测试/证据 | 层与运行时机 | 缺少行为为什么会失败 |
| --- | --- | --- | --- |
| AC-01..04、12 | 原入口文件逐项核读；真实 dev/packaged 七技能发现与许可；buildOfficeRuntime 制作→四 reader 读回及原有模板/资产身份核对；附件真实往返 | 文件/stdio integration affected PR/nightly；正文证据为命令/人工检视；默认模型成品/模板保真旅程片 8/nightly | 删除制作阶段或 reader、改坏源路径/声明、丢模板/技能/许可都会触发实际文件/读回/发现断言；不以文案宣称 9/10 等数值 |
| AC-05、09 | 六路由指向现有 render→Read/vision→check 与 pending 先交付/就绪补查；默认脚本不依赖启用 MCP 的入口核读，已有环境/自检组件与来源守卫相关回归 | 入口正文一次性检查；相关组件 affected PR/nightly；真实无安装/修复溢出片 8 | 旧 writer 工具回归重现、无真实样本读回或将旧 writer 产物当 receipt 会使对应检查红；文案不能代证实际模型行为 |
| AC-11、14 | 真实 Office 工具清单不再 writer、Excel ID 唯一、五 Excel 工具、default-disabled 不变；社区源码许可/七技能许可及目录原同步器实物核读 | stdio/manifest/source 文件 integration affected PR/nightly；目录字节集成依赖生产者 | writer 在列表/dispatch、manifest 跟 server 不一致、出现第二 Excel 或许可缺失会红；发布未就绪不改快照伪造通过 |

### 偏离记录

暂无。开始 2026-11-26 10:56:52 UTC；预计约 45 分钟（不含外部等待）。只追加本片与其证据，不修改前六片实现或冻结决定。


r10 实施核对：`f9e0b79b40` · Codex / GPT-6，按本轮 `Phase: IMPLEMENT` 授权同轮计划/实施，未出现新设计问题；首六片审查发现仍等待调度方另轮交回。总入口改为六种成品与主题的短路由，默认随包环境/用户模板优先/同一权限流/逐页检查/至多一轮/pending 先交付再原会话补查；cloud-capabilities 的表格及旧“改用四 MCP”段落同步，不把海报排版与照片/插画生图混为同一入口。真实文件核读材料 `/tmp/alpha-1761-r10/entry-inspection.txt`，不是新增措辞测试。片 1 的七技能/许可与其来源锁不变，根路由为本应用原创，无复制其它技能正文。

server.py 的四 writer、只供它们使用的私有 helpers/常量/import 已删除（17 个保留函数）；四 reader、Excel 五工具及原路径授权/unknown-field 判定保留。`tools.json` 由原 `gen-office-mcp-tools.ts` 重生，server 版本沿本次共同发行的 v2。未知 writer 直接调用也应 unknown，不能写成品。构建脚本新增可复用的样本制作函数，三处消费者（构建、stdio 模块、附件暂存往返）用同一随包库/OfficeExcel 实际生成；默认用户制作仍由七个技能负责，不把 smoke 的 Python 空白样本当作默认模板或质量证明。

首次相关文件集的两个红分别为旧段落残余 `office` 引用/旧 MCP 正向措辞，以及根路由重复 Python import 名被已有 cloud-tool 名清点误认；已保留仍有效的云端退休/复核断言，移除旧 MCP 制作承诺并把模块具体 import 留给原 xlsx 技能单一权威，没有新增工具 allowlist。真实构建读回另捕获移除 writer import 时遗漏 reader 授权仍用 os，红为 `name 'os' is not defined`；symtable 只读核对显示唯一未绑定全局 os，已保留此 import 并重生摘要，未改任何失败断言。共享 slot 正常排队并取得执行，没有取消；恢复后的制作→四 reader/附件两文件 **13 PASS**（`readers-green.log`），真实宿主命令/Python/库/licence 检查仍执行。面板原正向 writer fixture 换成首方 receipt，宿主 **16 PASS**（`panel-green.log`，包含 29 个子进程 Solid+happy-dom 用例）；core 只选三个声明/真实 server 消费者 **3 PASS**（`core-related.log`），未跑计时/容量/引擎全旅程。

目录依赖实物：`bun packages/ui-mac/scripts/sync-catalog-snapshot.mjs` exit 0，实际验签发布版 **2026-11-18.1 / 26 entries**（`catalog-sync.log`）；四条 Office tools/描述仍有原 writer，Excel 仍是旧两工具，尚未包含本票新 server/intake/digest 契约。同步只改 fetchedAt，已用 scoped git restore 恢复本次生成的无关差异，目录与锁均不提交；没有手编快照、修改 alpha-web、发布或上传。交 §8 已列 alpha-web 生产者，发布后再跑同一同步器；本次不同步成功冒称目录字节集成完成。


r10 最终证据：恢复后的 wider 一次性命令为 `cd packages/ui-mac && gate slot -- bun test src/main/office-mcp.test.ts src/main/attachment-read-roundtrip.test.ts src/main/office-mcp-tools-snapshot.test.ts src/main/factory-skills.test.ts src/main/codepuppy-factory-skill-hygiene.test.ts src/main/codepuppy-sidecar-wiring.test.ts src/main/office-runtime-lock.test.ts src/main/codepuppy-office-instance.test.ts src/main/codepuppy-skill-packaging-census.test.ts src/renderer/codepuppy-ui/session-rail/artifacts/local-artifacts.test.ts src/renderer/codepuppy-ui/session-rail/artifacts/session-rail-artifacts.test.ts`，**131 PASS / 0 FAIL**（`ui-related-final.log`，没有重复累计已跑 target/子进程）。ext `bun test src/policy/identity.test.ts` **18 PASS**；core `bun test test/codepuppy-mcp-runtime.test.ts -t 'Office declarations bind|the command main writes|the real server.py'` **3 PASS**；共 **152 个唯一宿主用例 PASS / 0 FAIL**。真实 Solid 子进程 29 PASS 是面板宿主断言的一部分，不再加进总数。ui/core 各在包目录 `bun typecheck` exit 0（`ui-types.log`、`core-types.log`）。gate slot 仅运行这些相关文件/有限变体，没有 gate run、bin/check、全层/全套或计时容量旅程；所有排队均等待取得 slot。

新增的 root `office-docs` 稳定名字/真实路径断言落在原 document skill assets 的 dev/packaged 用例，验证引擎确实能发现总入口，不测正文措辞。正文最后核读明确区分本地制作与沿原视觉服务的鉴权/缓存/拒绝/计费，避免将 HTML 自检说成无云视觉费用；没有新确认或模型切换。旧行为替换导致本轮实际文件计数为 office-mcp 11、factory-skills 26、hygiene 19；删除的均为原 writer/额外确认/过期格式能力措辞检查，其它断言保留。`scripts/gate-files.tsv` 为冻结 gate 面，未修改；若旧静态计数需要同步由调度方处理，不放宽阈值或以恢复旧 writer 让门绿。

五个有效 removal arms：writer-advertised（列表重新出现 writer 则 not.toContain 红）、writer-dispatch（恢复可调用入口则 explicit refusal 红）、reader-readback（读回空正文则构建 smoke 报缺 Runtime check）、receipt-panel（跳过持久 document metadata 则真实面板行断言红）、route-discovery（把根技能稳定名字换掉则 dev/packaged 真实发现断言红）。前 3 的行为命令和全部最终日志见 `/tmp/alpha-1761-r10/removal.py`、`removal-*.log`；后 2 的有限 follow-up 记录在 `removal-followup-results.json`。面板首次命令缺 `./` 前缀只报找不到测试文件，该次不算行为 red；修正为实际 cases 路径后只跑命名用例，得到明确 toEqual 失败。没有进程超时、未放松生产守卫，所有变体 finally 原字节恢复；恢复后的 131 文件集合已通过。

AC 对应的贡献与边界：AC-01..04/12 的默认路由、七技能/许可/模板入口实际发现和四格式原生库读回已核；并非默认模型的 9/10、10/11、11/12 指标。AC-05/09 的 render/Read/vision/check、一轮与 pending 补查说明接到现有入口，实际工作流组件沿片 4/6 的证据，正式 #1760 wiring 与真实模型改稿仍待集成/片 8。AC-11 的 Excel 五工具/唯一 ID、保留操作与 reader 已由 stdio/声明/实例用例核对；原始许可与排除文件由现有发现、原 runtime 的逐发行包许可检查证明（AC-14）。目录字节/Excel re-intake/digest 仍归已列 alpha-web 发布依赖，不冒称通过。未重开其它规格或受保护规则；首六片旧文件仅按本节计划切换具名消费者，未混入尚未返回的审查修正，无额外文件偏离。

文档影响仍为入口行为与实施证据：canonical 本节及原两个 runtime skill；16 个相对链接 PASS，alpha profile 派生当前 worktree 的 `check-docs-contract` 本 plan findings=0（`docs-contract.json`），全仓既有 69 errors/253 warnings 不扩修。`affected-tests --list` exit 2：本旧基线缺 `.gate-tests`，无 scope line（`affected.scope`）；按 brief 留 ship 合入已有该文件的 origin/alpha，不改 gate。已核 Codex / GPT-6；工作从 10:56:52 UTC 开始，约 20 分钟（含共享 slot 等待），未倍增。目录发布/正式双平台与模型验收去向不变；未 push/PR/merge、发布或部署，无新 OPTIONAL。

最后一次仅对视觉计费措辞的同步后，`cd packages/ui-mac && bun test src/main/factory-skills.test.ts src/main/codepuppy-factory-skill-hygiene.test.ts` **45 PASS / 0 FAIL**（`instructions-final.log`），不重复加总。最终文档契约输出 `docs-contract-final.json` 的本 plan findings=0；diff 检查 exit 0。所有前台执行/slot 已终结，hooksPath 仍为 `.githooks`，当前变更只含本节具名的 14 个文件（含 plan），目录两个生成输出没有变化。

## R1 审查修正（r11，切片一至六）

依据恢复 brief 的逐项采纳 A1..A10、B1..B8，冻结规格/设计不变；切片七保持其独立提交。开始 2026-11-26 11:15:48 UTC，预估约 90 分钟，先保留各正确反例再修生产代码，现有模块测试中添加用例；不跑全套或 gate run。A3 的本功能 retry 可以独立实现，#1760 现有 action 的生产代码在本分支尚不存在（`util/codepuppy-connector-launch.ts` 仅数据定义；实际 preload/main 无 connectorLaunch.retry 实现），接线须沿该拥有者的冻结面，不新增 DocumentHost/引擎 API 绕过。

A1 red：新增既有 document-resources.test.ts 的真实 electron-builder 26.15.2 FileMatcher/copyFiles 用例（实际依赖解析，非 cpSync 模拟）及 afterPack 缺 npm 树的反例。`bun test src/main/document-resources.test.ts -t 'real electron-builder copier|afterPack rejects'` 为 0 PASS/2 FAIL（`/tmp/alpha-1761-r11/A1-red.log`）：前者实际丢根 node_modules 后 readDocumentAssets 报缺文件，后者当前 afterPack 在 win32 直接成功。这次只提交反例，下一提交加明确 npm FileSet 和真实打包目录资产验证。正式 package:mac 目录构建涉及完整引擎/签名资源，本轮选择 brief 允许的 closest real-copier 证据，不启动应用/Electron 窗口。

A1 green：明确根 npm FileSet 并在 afterPack 对 darwin/win32 的真实 Resources 路径先执行 readDocumentAssets；相同新断言不改，既有文件 13 PASS（A1-green.log）。删除 FileSet 即实际 copier 缺树；删除 afterPack 检查即缺树反例不再拒绝。证明层为真实 copier + afterPack 组件，未冒称完整 app 包。

A2 推断确认（一次固定源码读取）：`/tmp/alpha-1761-r11/link-source-confirmation.json` 记录 LibreOffice tag `libreoffice-26.8.3.1` 的 sc/inc/global.hxx、LinkUpdateModes.idl、Writer.xcs 及 SHA-256。Calc enum 为 LM_ALWAYS=0 / LM_NEVER=1；Writer 配置 Writer.xcs:1110-1138 明确 2=Never，因此“Writer 2 可能自动”前提为假，不改为 UNO 常量 0（该常量用于另一个 API）。新增原 fonts 文件中的实际 XML 解析断言要求 Writer=2、Calc=1；target exit 1（A2-red.log），只失败于 Calc 目前为 0。下一提交只改 Calc 到其 never 值，保留 Writer 已正确值。

A2 green：同一 XML 断言未改，Calc Link=1，Writer Link=2；fonts 文件 4 PASS（A2-green.log）。原生字体/替代/宏/更新检查仍保留。

A3 red：既有 runtime 文件新增 explicit action 用例，当前缺 retry，target exit 1（A3-red.log）。要求仅 failed 才重开一次 preparation，preparing/ready 不启动，且没有自动循环。下一提交只补本功能方法；#1760 action 仍为具体未实现接线依赖，不冒称完成。

A3 runtime green：原断言不改，runtime 文件 12 PASS（A3-green.log）。retry 仅 failed → 同一准备过程，未新增自动循环、工具/API 或第二下载器；action 接线待 #1760 拥有者。

A4 red：原 runtime 文件三种真实临时目录场景（extract-failure、verification-failure、dispose/cancel）均留下 stale/current candidate，target 0 PASS/3 FAIL（A4-red.log）。修正将只删除本 runtime 的 unpublished candidate，准备开始清遗留前缀；Location 将验证转给另一活请求者时仍是同一次共享准备，不把候选误删为其它消费者造成失败。

A4 green：runtime 15 PASS（A4-green.log），提取失败、验证失败及退出后的候选均清除，原跨 Location 转交仍通过。清理仅应用私有 candidate 前缀，不删除已发布 destination；无新下载器/用户操作。

A5 red：既有 runtime 文件在真实 rename 边界观察 candidate 的 marker（仍委托原 fs rename，不靠时间等待），当前 marker=null，target exit 1（A5-red.log）。下一提交在候选内完成 marker 并再次检查取消后才 rename；复用已发布目录不重新暴露半份 marker。

A5 探针修正：Bun 的 fs.promises 对象 spy 没有截住 node:fs/promises 的命名导出，首次 red 不能作为顺序证据。一次标准库探针确认直接 spy 模块命名导出会被命中；测试只改观察接线，marker 断言保持不变，并新增必须实际命中边界的前提断言。恢复原生产顺序后 target 仍 exit 1，命中 rename 而 marker=null（A5-real-red.log）。此提交只改测试接线，随后应用同一 marker-before-rename 修正。

A5 green：正确模块导出探针实际命中 rename，marker 在候选内已完整，runtime 文件 16 PASS（A5-real-green.log）。生产实现没有为测试增加新端口。

A8：新增原 runtime 文件的 ready→dispose→同 userData 新 runtime 实例用例，current 直接通过 extract=0/verify=1（A8-green.log）；这是原有行为的补证，无需为了制造 red 改坏代码。

A9 runtime red：未发布 manifest 当前在构造器 throw；复用已发布目录验证失败当前直接 failed，target 0 PASS/2 FAIL（A9-runtime-red.log）。分两个生产提交修正，均不添加无限自动重试。A9 的共享 cache 要求与仍冻结的 §4.10/R13 明文“{{JOB_FONT_CACHE}} 替换为本 job 内缓存”相冲突；该部分需设计拥有者同步裁定，不能悄悄改 Python 投影契约。Windows 字体只在准备时写入则与 §4.2 已一致，将独立修。

A9 missing-pin green：构造不抛、query 返回真实 unknown failed，未访问下载器；target 1 PASS（A9-pin-green.log）。无 pin 时不虚构活跃 Python 投影，实际环境查询仍明确拒绝缺少的绑定。

A9 published-repair green：原两项 runtime 断言不变，文件 19 PASS（A9-runtime-green.log）。仅已发布目录验证失败时丢弃并从同 pin 重提取一次；新 candidate 再失败即 failed，不循环。

A7 原生材料确认及 red：一次 fontTools TTFont 读取四份随包实际 TTF 的 nameID 0（缓存中已有 FontTools，无安装/下载），Sans 两字重为“© 2014-2021 Adobe ... Reserved Font Name Source”，Serif 为“© 2017-2024 Adobe ...”；`font-copyright.txt` 保存输出。对 NOTICE 的 holder 一次性核对断言失败（缺 Adobe）；文档证据不新增正文措辞单元测试。下一提交用实际 copyright holder/年份替换 Noto Project Authors。

A7 green：NOTICE 保留实际四个 nameID 0 的完整 copyright 文本（包含 Sans 的 RFN 原文），一次性 fontTools 对照 4/4 PASS（A7-green.log），OFL 文件不改。

A6 authority 核对：alpha-work domestic-cloud-connectivity design §4.11.1:573-574 的当前联合有 ocr-model、无 darwin-x64。既有 util 文档文件添加类型层回归，`bun typecheck` 对 OCR ID 和 no-Intel 断言给两个错误（A6-red.log）；不是用手写数组当运行期校验器。下一提交只同步纯数据联合。

A6 green：仅同步 union 到当前权威，无新下载/校验实现；util typecheck exit 0、文档文件 8 PASS（A6-green.log、util-green.log）。red 输出还包含 expect 对静态 false 的衍生类型错误，核心前提仍是 OCR 不被接受与 Intel 仍被接受。

A10 red：资源配置目标轴的现有 resources 文件新增 Windows/Mac FileSet 断言，target exit 1（A10-red.log）：当前 Win 没有专属入口且全局按 host 选源。原“一份 runtime”断言同提交消费 global+mac 最终合成配置，不保留生产旧布局兼容。下一提交将两平台入口放到 electron-builder 的平台层，并在 Windows workflow 复用仓库已有 setup-uv 固定 action SHA（不触发 workflow/发布）。

A10 green：target FileSets 与 afterPack/copier 在 resources 文件 14 PASS（A10-green.log），不再根据 mac host 把 arm64 Python 拷入 Windows 包；uv 仅增加固定 action 安装步骤。没有运行/发布 Windows workflow，Win 实机包仍按既有计划待验。

A9 Windows font rewrite red：既有 ext renderer 文件用实际模板/页图和原 profile 生成器，正常 Office render 调用了会修改 runtime 字体的 installer，target 1 FAIL（A9-fonts-red.log，实际 1 次）。下一提交渲染仅建私有 profile；Windows 四字体仍由 main 准备/验证负责，不在并发 render 中重写。

A9 font render green：原 installer 调用反例不改，renderer 文件 6 PASS（A9-fonts-green.log）；字体复制仅留准备器，render 私有 profile 不再修改共享 Windows runtime。

B1 red：既有 document-host 文件保留真实 pending 落盘，重开时改用真实 createDocumentRuntime（仅 ensureFile/extract/固定验证回执受控）。当前启动及订阅未调 query，target exit 1（B1-red.log），先在同步真实方法边界断言失败，不以任意等待制造超时。下一提交仅对 waiting/admitting 所属 Location 发起既有 query。

B1 green：真实 runtime 通过 pending 启动和订阅 query 进入准备并只 acquire 一次，host 文件 9 PASS（B1-green.log）。只启动实际 waiting/admitting 的文档需要，admitted/其它项目不触发；没有新增队列/引擎接口。ext 检查组件的 runtime fixture 补既有 query 方法以符合私有依赖。

B8 确认：冻结 §4.3:146 明确首次文档 environment 查询才触发准备，普通库/reader 不等待 LO。新 runtime 反例表明只发 Python 投影已调用 query，target exit 1（B8-red.log）。原投影 ready 用例同提交显式调用 query，代表真正文档需要；下一提交移除 Python 投影发布的隐式 query，普通 environment/渲染及 B1 pending 仍走既有显式 query。

B8 green：runtime 20 PASS（B8-green.log）；发布投影仅提供本地环境，不触发大文件准备，文档 environment/补查的 query 保持。源码 §4.3 已作首次使用裁定，不按推断保留 eager 行为。

B2 一次实物确认：共享 gate slot 运行 5 个公式的小工作簿，实际 LO 26.8.3.1 将 =0.10+A1→=0.1+A1、=sum('Sales'!a1)→=SUM(Sales!A1)、='Sales'!$a$1→=Sales!$A$1，双引号 MiXeD 保持，#REF! 改为 #ref!。命令/原稿/计算副本/输出在 `/tmp/alpha-1761-r11/formula-confirmation/facts.json`，未再跑第二次 LO 或把它加为慢测试。原 Excel 文件三个 normalization 用例均 red（B2-red.log），并保留字符串大小写/不同数值不能等价的反例。下一提交以 Decimal 和 tokenizer 类型规范化，不改原稿公式或未知公式的完整性错误。

B2 green：同一三项实物规范化及字符串/数值负对照不改，office-excel 文件 12 PASS（B2-green.log）。只规范 token 语义，Decimal 不引入浮点误差，原 XML 公式与非目标 parts 的真实 fixture 断言仍通过。

B3 red：真实插件宿主里成功合并 cloud + 合法项目 Office 声明，但文档 provider 尚未发布，当前异常把 cloud 也降为 UNVERIFIED，既有 sovereignty 路径出现第三方 by-name 原因；target exit 1（B3-red.log）。下一提交仅隔离文档环境获取错误，原配置/身份检查继续沿原责任。

B3 green：provider 获取仅单独 log，MCP merge/ownership 不再全局降级；同一真宿主断言未改，plugin-host 文件 55 PASS（B3-green.log）。首方文档仍须真实绑定，未添加伪成功 provider。

B4 red：原 document-tool 文件经真实 Location register→renderer→tool 入口，先证明渲染期间 active=true，再分别返回 conversion/timeout；两项结束后仍 active，target 2 FAIL（B4-red.log）。下一提交只清理失败/超时的活动会话标记，后续工具标题恢复原分类。

B4 green：同一 register/tool 反例不改，document-tool 文件 3 PASS（B4-green.log）；pending、failed/timeout 或抛错都释放活动标记，rendered 继续等最终检查。

B5 red：原公式报告用例追加同一实际工作簿的合法绝对路径别名（含 ./），保留原错误列表拒绝断言；当前仅字符串比较而拒绝，target exit 1（B5-red.log）。下一提交两边 realpath，与 ext 的同一文件语义一致。

B5 green：两侧 realpath 后，原公式错误/摘要负对照保留，document-check 文件 4 PASS（B5-green.log）。

B6 red：一次真实 generator 入口探针克隆固定 2.3.2 wheel，仅将 workspace 的 temp_path.replace 调用作受控 source drift；在 /tmp 脚本副本内覆盖该变体 hash 以单测适配层，生产 hash 守卫未动。当前生成器仍输出 161 文件、静默漏 save guard，独立断言 exit 1（B6-entry-red.log）。新增原 Excel 文件的最小 patch-guard 用例，下一提交每个 text.replace 都验证唯一 anchor，并在 sources.json 明记 scan.py 的局部 xmlns 适配。

B6 green：真实 generator 重生 161 份源，Python 结果字节未变，sources.json 补 scan xmlns 适配出处；缺锚点的真实入口拒绝，office-excel 文件 13 PASS（B6-green.log）。全部 save/digest 适配以唯一 anchor 为前提，不再静默省略。

B7 cache red：原 office-excel 文件两个原生 Python 子进程用例，以真实原稿/LO 缓存 fixture、受控执行边界验证原子写入。修正子脚本缩进后真实 red 为权限 0640→0600 以及 SIGTERM 留下临时文件（B7-cache-red.log，2 FAIL），不是以子进程语法错误充当证据。下一提交只保护缓存 commit 的权限与终止清理。

B7 cache green：office-excel 文件 15 PASS（B7-cache-green.log）。同一原子替换前保留源权限，commit 临界区 SIGTERM 转为退出并执行 finally 删除临时文件，随后恢复原处理器；真实缓存与原稿保真断言保留。Windows ACL/实机验证仍归既有平台验收。
