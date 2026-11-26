---
id: PLAN-secrets-usable-not-visible
title: 密钥文件程序可用、助手不可见 实施计划
summary: 列明共享规则、Location 采集与工具收口、安全读写及权限、SC-01 捕获、真引擎验收五段；本轮只细化共享规则段。
kind: plan
status: active
spec: SPEC-secrets-usable-not-visible
design: DESIGN-secrets-usable-not-visible
owners: [owner]
last_reviewed: 2026-11-26
---

# PLAN-secrets-usable-not-visible｜密钥文件程序可用、助手不可见 实施计划

本计划服务于 [#1758](https://github.com/impharaon/alpha-code/issues/1758)。规格、接口与裁决只引用 [spec.md](spec.md) 和 [design.md](design.md)，不在此另定。每段开始实施前展开本段；本轮仅展开第一段。以下测试均为实施安排，本次 PLAN 没有执行行为验收。

## 交付段落

| 段 | 交付内容 | AC / 完整证据所在段 | 依赖 |
| --- | --- | --- | --- |
| ① 共享保护名单与发布判定 | Schema 的单一发布规则、路径匹配与公开值判定，供后续消费者接线 | AC-01、04、06、07、10 的规则基础；不单独宣告 AC 完成 | 无 |
| ② Location 采集与通用工具收口 | 变化发现、各 profile 及只读 SQLite 采集；根/Code Mode 子调用生命周期、结果/错误/进度和预览遮盖 | AC-02、04、06、08、10 的非 shell 处理面；完整证据在⑤ | ① |
| ③ 安全读取、env 保值写回与权限例外 | 内置 read 安全视图；write/edit/patch 原执行器包装；交互注入、项目外读例外与共享名单风险标注 | AC-01、04（直接读）、05、06（三消费者）、07；完整证据在⑤ | ①② |
| ④ SC-01 实时捕获与终态收口 | 两面 ShellHooks、Core 捕获/清理、扩展增量匹配和加密 spool；登记与实际实现同提交生效 | AC-02、03、04（命令与 SSH 使用）、07、08、09、10；完整证据在⑤ | ①②③ |
| ⑤ 真引擎与平台验收证据 | 隔离环境、生产注入/扩展与真引擎的正反臂；模型、记录、卡片、运行/最终文件及程序接收端的交叉证明 | AC-01..10；darwin-arm64 本次实施验收，win32-x64 的 AC-01/02/04 真机验收随 Windows 包发布 | ①..④ |

后续段只在各自展开时列文件和命令。④须落实设计 §10 指定的 ADR-050、`secrets-output-capture` 权威册项及逐文件 `UPSTREAM_EXCLUDES`；不提前登记不存在的机制/证明，不新增 CI 名单或改 gate。⑤复用已有 headless 真引擎 harness，永久场景归 scenario 层；AC-09 的一分钟时序仅在该指定验收中运行，不混入快测。所有段均不启动带窗口的应用。

## ① 共享保护名单与发布判定

- 依据：[规格 v3](spec.md) @ `aa2476b378da663115e6735b991f6cbf2e04b5c6`，BR-01、BR-06 与 AC-01/04/06/07/10 的共享判定部分；[冻结设计](design.md) @ `66313542d35b182ef8fdbd2d4c4597d715149c35` §4.1、§4.2、§6、§10；#1758。代码读取基线 `f7424aa45225a6d02d1958f4b4f72d247f99acc4`；与设计代码基线比较 Core/Plugin/Ext/ANSI 源码无差异，继承其收据。
- 核对：待编排器核对；首次实施提交从续派单的 `Phase:` 行填写计划提交、核对者/模型及结论。本轮不自填通过。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/schema/src/codepuppy-protected-files.ts`（新增） | 按设计 §4.1/4.2 实现 `ProtectedFiles` 纯契约与发布数据：`sources`、`match`、`probe`、`isPublicValue`，格式/profile/凭据字段及列选择数据、统一说明常量。无文件采集、宿主环境读取或权限副作用。采用现有叶模块 namespace 投影，消费既有 `./*` 导出。 |
| `packages/schema/src/codepuppy-protected-files.test.ts`（新增） | 新模块没有既有测试文件，按 `codepuppy-unattended.test.ts` 的邻接布局添加 fast 表驱动用例；只调用生产纯函数，不手抄 matcher 或风险器。 |
| `docs/architecture/modules.md` | 仅在 Schema 既有行补上保护规则权威文件，保留现有依赖方向；不顺带整理旧模块条目。 |
| `docs/README.md` | 实施时用现有索引生成器提取本计划的新增索引行，及本段实际改变摘要所需的行；本次 PLAN 按派单只写/提交 plan.md，不更新索引。 |
| `docs/specs/secrets-usable-not-visible/plan.md` | 首次实施补核对行；实际文件/顺序变化时同提交填写偏离记录。 |

Schema 的 `package.json` 已有 `./*` 导出，本段不改包清单、根 barrel、Protocol、HttpApi 或生成客户端。`risk.ts` 的旧凭据路径规则待③接线时替换；本段不增加第二份运行时名单。

### 顺序

1. 在上述新模块落下设计 §4.1 的完整发布数据、类型与固定说明，测试名 `published protected file families` 覆盖每个已冻结文件族及 format/profile/view。路径样本采用设计 §4.1/4.2 已核对的产品文件名和默认目录，宿主根作为显式测试输入；本段不创建或读取配置文件。后续解析器的真实格式样本及来源由②落地，不能用本段路径表冒充格式证据。
2. 实现 `sources` / `match` / `probe`。以 `protected paths follow platform semantics` 表覆盖 darwin/win32、相对路径、盘符/分隔符/大小写、点段、UNC/扩展路径、完整路径段和 KUBECONFIG 多路径；以 `published sources and probes share exclusions` 覆盖示例排除、依赖树剪枝及显式路径例外。IO 与 realpath/真实文件身份核对留②③，单测不假装验证 Windows junction。
3. 实现同一发布数据下的公开值判定，测试名 `public values preserve credential names`，覆盖设计 §4.1 的每类公开值、秘密词键优先、camelCase、短值和非公开值；字段/列选择的格式解析不在本段重写。以 `one published rule reaches all rule consumers` 同时检查同一已发布文件族可被 sources 枚举、match 分类及 probe 命中；不开放运行期改名单接口。
4. 每步先以 `bun test src/codepuppy-protected-files.test.ts -t "<本步测试名>"` 迭代，再完整运行该文件一次。结束时从 `packages/schema` 执行 `bun typecheck`；本段不运行整个包的测试。
5. 返回前仅一次扩大相关集：用 `rg -n 'codepuppy-protected-files|ProtectedFiles|mock\.module|codepuppy-unattended|codepuppy-tool-policy' packages/schema/src packages/schema/test` 确认新出口的 mock/枚举消费者，运行命中的直接相关文件；当前已有的类枚举文件 `test/codepuppy-authority-names.test.ts` 未枚举本段概念，不为凑集合运行。若只有新测试命中，明确报告无额外关联测试。发布规则正反对照在临时目录副本中逐项停用匹配、排除和公开值分支，确认对应断言变红；只记录命令/结果，不给生产代码加测试开关，也不新增常驻 mutation 测试。
6. 补模块地图、索引及核对/偏离行，按已解析 Alpha profile 检查本段文档、链接和 `git diff --check`，检查暂存文件后提交。预期提交单位为①的纯模块、测试与必要文档；首次提交中的核对来源必须是续派单。停止于该段提交，不提前进入②。

以上测试命令均在 `packages/schema` 执行（`rg` 和文档检查从仓根执行）。本段是新能力，不改变既有运行行为；若实施发现需要修复已有缺陷，则按具名回归用例先红后修另提交，不借本计划扩大范围。

### 风险

- Windows 与 darwin 的路径语义混用会同时影响三个消费者。第一段先用纯路径表钉住平台差异；realpath、短文件名/junction 与真机行为分别留给后续接线和 Windows 发布验收，不以跨平台字符串单测宣称 AC-07 完成。
- sources、match、probe 的剪枝/显式例外分歧会使名单失去单一权威。用同一文件族的正反表检测三者；③再证明 read、采集遮盖与风险标注一起消费本模块。
- 把普通字段或短值当秘密会污染输出。先分别验证路径 profile 与公开值规则；②使用设计 §2/§4.1 的一手格式来源验证凭据字段/SQLite 列，⑤完成 AC-10 的混合输出对照。
- 本段尚未保护任何运行期结果。只交付共享基础，不能用本段快测代替真引擎、三档权限、程序可用、失败隐藏或实时输出证明。

### 证明

| AC | 本段测试/证据 | 缺少行为为什么会失败 / 完整证明去向 |
| --- | --- | --- |
| AC-01（基础） | `public values preserve credential names`；`published protected file families` | 删除 env 分类或公开值规则会使密钥/端口的预期判定不同；三档 read、记录及去规则对照由③⑤证明。 |
| AC-04（基础） | `published protected file families`；`protected paths follow platform semantics` | 漏 SSH 非默认私钥或误把公开文件列入保护会使路径表变红；私钥不可见、真实 SSH 连接与对照由③④⑤证明。 |
| AC-06（基础） | `one published rule reaches all rule consumers`；`published sources and probes share exclusions` | 只修改 sources/match/probe 任一消费路径会破坏同一文件族的联合断言；read/结果/风险三处联合与只改一处的对照由③⑤证明。 |
| AC-07（路径部分） | `protected paths follow platform semantics` | 省略 Windows 规范化会使同路径变体结果不一致；路径读取/打印接线由③④⑤验证，win32-x64 真机 AC-01/02/04 留 Windows 包发布验收。 |
| AC-10（基础） | `public values preserve credential names`；`published protected file families` | 错误公开秘密键或分配错误 profile 会使规则断言变红；真实配置字段采集及混合命令对照由②④⑤证明。 |

AC-02、03、05、08、09 本段不触及执行路径，其证据责任已列在交付段落表；不得以文档检查填作行为通过。

### 偏离记录

暂无。PLAN 阶段仅本文件；生成索引的写入随①实施处理，原因是本轮明确的单文件写入范围。
