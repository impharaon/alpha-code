---
id: PLAN-document-output-quality
title: 文档产出质量实施计划
summary: 列出文档制作、渲染、自检与验收的八个交付切片，首片细化固定技能快照与许可资产。
kind: plan
status: active
spec: SPEC-document-output-quality
design: DESIGN-document-output-quality
owners: [owner]
last_reviewed: 2026-11-26
---

# PLAN-document-output-quality｜文档产出质量实施计划

本计划消费 [spec v1](spec.md) 和 [frozen design](design.md)，实施归属 [#1761](https://github.com/impharaon/alpha-code/issues/1761)。本轮为 PLAN，只细化首片；后续切片在实施前追加各自的文件、顺序、风险与证明。这里的 AC 是切片贡献范围，不表示该片单独完成整条验收。

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

本 PLAN 自身只做文档合同、链接和 diff 检查；本片的实现测试及 AC-01..15 的运行验收尚未执行。文档影响为 feature execution plan，唯一写入是本文；按本轮“commit only plan.md”的范围不更新生成索引，索引同步交调度方处理。

### 偏离记录

2026-11-26 · 步骤 1/2 的材料与适配合为首个资产提交，再提交发现/分发验证；避免把原名冲突、安装假设或悬空 helper 引用的原稿暴露给嵌套发现。新增同目录 `WORKFLOW.md` 集中七技能的共用执行指引；保留脚本仅为适配后的 `pptx/scripts/apply_theme.cjs`，其余按实际未使用路径逐文件记录排除。无冻结契约变更。
