---
id: PLAN-secrets-usable-not-visible
title: 密钥文件程序可用、助手不可见 实施计划
summary: 五段实施；①②③及 SC-02 已核，④按 v3.3 接同一回调内流式发布与终态收口，⑤规划真引擎全部 AC。
kind: plan
status: active
spec: SPEC-secrets-usable-not-visible
design: DESIGN-secrets-usable-not-visible
owners: [owner]
last_reviewed: 2026-11-26
---

# PLAN-secrets-usable-not-visible｜密钥文件程序可用、助手不可见 实施计划

本计划服务于 [#1758](https://github.com/impharaon/alpha-code/issues/1758)。规格、接口与裁决只引用 [spec.md](spec.md) 和 [design.md](design.md)，不在此另定。每段开始实施前展开本段；当前已展开①②③④。①②实际检查见各段实施收据；②的 Code Mode 外层进度已在 r5 通过 SC-02 补齐，完整真引擎行为验收仍在⑤。

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
- 核对：Phase: IMPLEMENT — `3266bd9497` · Claude Opus 5.5 (orchestrator) · plan accepted：五段覆盖 AC，①命名用例及移除对照成立，完整行为证明留⑤，冻结决定未变。来源为 2026-11-26 r1 续派单的 `Phase:` 行。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/schema/src/codepuppy-protected-files.ts`（新增） | 按设计 §4.1/4.2 实现 `ProtectedFiles` 纯契约与发布数据：`sources`、`match`、`probe`、`isPublicValue`，格式/profile/凭据字段及列选择数据、统一说明常量。`isCredentialName` 供后续凭据字段采集复用同一秘密词判定。无文件采集、宿主环境读取或权限副作用。采用现有叶模块 namespace 投影，消费既有 `./*` 导出。 |
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

### ①实施检查收据（2026-11-26）

- 已核：Codex / GPT-6 作者自查；消费上述计划核对与冻结版本。`packages/schema` 下 `bun test src/codepuppy-protected-files.test.ts`，exit 0，**6 pass / 0 fail / 595 expect**；涵盖上表五项 AC 的共享判定基础，不宣告完整行为验收通过。
- `packages/schema` 下 `bun typecheck`，exit 0，144 files 无类型错误；`bunx --no-install oxlint src/codepuppy-protected-files.ts src/codepuppy-protected-files.test.ts`，exit 0，**0 warnings / 0 errors**。仅定向文件，无包级测试或全量门。
- 一次相关集搜索：`rg -l 'codepuppy-protected-files|ProtectedFiles' packages/schema/src packages/schema/test` 只命中新模块及其测试，无额外 mock/枚举消费者需要运行。
- 文档按 Alpha profile 调用 `check_repo(..., changed_since="HEAD")`，plan.md findings 为 0；模块地图报 13 个既有缺失链接，检查 exit 1，不宣称全仓文档通过。唯一基线核对用 `git show HEAD:docs/architecture/modules.md` 的链接与当前磁盘比较，旧/新均 13、新增缺失为 0；本次新增权威链接存在。`docs/README.md` 的既有 index.stale 仍在，只从生成器补本计划行，不扩项修复。去向交编排器的文档治理，不阻断①。
- 移除对照仅在临时副本运行，不修改工作树生产实现、不增加测试开关。命令：`python3 /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-rules-removal-kgn2bsq6/removal.py /Users/pharaon/app/wt/alpha-code-feat-1758-secrets-masking`，exit 0（脚本逐臂断言测试确实失败）；各臂日志在该目录的 `<arm>/output.log`。每臂使用 `bun test <临时测试路径> -t '<下列命名用例>'`，均为 **exit 1 / 0 pass / 1 fail**：

| arm / 单独移除内容 | 变红的命名用例 |
| --- | --- |
| match / 匹配 | `published protected file families` |
| exclusion / 排除 | `published sources and probes share exclusions` |
| windows-case / Windows 不区分大小写 | `protected paths follow platform semantics` |
| public-values / 空值公开分支 | `public values preserve credential names` |
| credential-priority / 秘密词优先 | `public values preserve credential names` |
| sources-only / 仅来源枚举 | `one published rule reaches all rule consumers` |
| probe-only / 仅命令探针 | `one published rule reaches all rule consumers` |
| credential-field / kube OIDC id-token 字段 | `published credential fields exclude ordinary values` |

数据样本只包含 §4.1/4.2 的文件族/目录及显式测试根；没有读取用户凭据或原始配置。来源发现、真实格式解析、三消费者接线、终态/实时收口和真机证据仍分别由②..⑤提供。

### 偏离记录

2026-11-26 · 无文件范围、交付顺序或冻结决定偏离。落实细节为导出共享 `isCredentialName`，让后续 credential-document 字段采集与公开值判定不重复秘密词逻辑；未更改冻结四个入口。索引按原计划在本次①补入，PLAN 提交仍只有 plan.md。

## ② Location 采集与通用工具收口

- 依据：[规格 v3](spec.md) @ `aa2476b378da663115e6735b991f6cbf2e04b5c6`，BR-01/03/04/06/07、AC-02/04/06/08/10 的采集与通用结果处理部分；[冻结设计](design.md) @ `66313542d35b182ef8fdbd2d4c4597d715149c35` §4.1、§4.3、§4.3.1 的预览出口、§4.5 的非 shell 出口、§4.7、§5、§6、§10。① @ `1b35e096a5004cfb41c830bc559c76109d6777c0` 已由 Claude Opus 5.5（orchestrator）在 r2 续派单接受，继承规则/路径/公开值与八个移除对照结论；不重新审查。#1758；本段读码基线同①提交。
- 核对：Phase: IMPLEMENT — `e3e8196bf7` · Claude Opus 5.5 (orchestrator) · segment-② plan accepted：变化发现、profile/SQLite 采集、根/Code Mode 生命周期和结果/错误/进度/预览遮盖按三个提交单元实施，具名用例和移除对照已核，冻结决定未变。来源为 2026-11-26 r3 续派单的 `Phase:` 行。

本段不实现 read 分流、env 写回、目录审批例外、风险器迁移或 Shell.capture；分别留③④。SecretMask 只落本段需要的能力，不为后续方法加空实现、透传或关闭开关。根事实先可供③消费；不在②放宽权限。实际执行证据见本段检查收据，其余为实施安排。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ext/src/secret-values.ts`（新增） | profile 对应的静态文本/结构化字段提取和 env 词法记录。消费 Schema 的 `CredentialFields`、`isCredentialName`、`isPublicValue`，保留 env 键出现序号与原 RHS 跨度，供③直接复用；不在解析器内发现文件或另持名单。 |
| `packages/ext/src/secret-files.ts`（新增） | Location 来源发现、词法/realpath 归类、真实身份去重、文件/目录五元组缓存、主库及 WAL/SHM 变化检测、只读 SQLite 单元格投影；保留缺失根的现存父目录观察点。文件材料留在本进程，不改来源文件。 |
| `packages/ext/src/secret-mask.ts`（新增） | 创建 Location 私有 SecretMask，拥有 retained values、根调用状态、结果/错误/进度/预览的共同投影，以及通用文本/字节替换的唯一实现。③接安全 read/写回、④增量流处理时扩展本实现，不另写第二个 matcher。包含本段 tool.transform 的进度包装。 |
| `packages/ext/src/secret-values.test.ts`、`secret-files.test.ts`、`secret-mask.test.ts`（新增） | 各新模块自己的 fast / 文件系统及 SQLite integration 用例；不添加票号文件、场景副本或规模/时序测量。 |
| `packages/ext/src/fixtures/secret-files/`（新增小样本） | 实际工具 writer、现成官方样本或设计 §2 已固定官方源码生成的最小格式样本。每份附工具版本、来源链接/源码位置、哈希及仅替换假值的说明，存在测试数据注释或测试的 provenance 表中；不新增说明 Markdown，不采用户 HOME。 |
| `packages/ext/src/policy/index.ts` | 在现有 registerPolicy / seal 中创建并消费 SecretMask：尾部 before 的 confirm/pin 后 begin，尾部 after 的所有归因/display 之后收口；同次 tool.transform 先沿用 display，再包安全进度；seal 尾部处理权限预览。既有 PolicyRegistration 增加私有清理函数，供 plugin 的现有 cleanup 使用。 |
| `packages/ext/src/plugin.ts` | 把上述清理接入现有 Location cleanup，保持 registerPolicy 首个 await、seal 最后一个 await；既有云输出校验及错误改写仍在安全终态收口之前。 |
| `packages/ext/src/policy/register-policy.test.ts` | 在现成真实插件宿主/注册表中补接线用例，包括共享 ID 的根 execute 与多个/并发 child、拒绝发生在 begin 前、后续 hook 改写、进度和终态顺序、权限预览。只验组件接线，不在本文件增加完整模型会话场景。 |
| `packages/ext/src/plugin-setup-order.cases.ts`、`plugin-setup-order.test.ts` | 更新现有 policy mock 的清理返回值及原 setup/cleanup 断言；仍由现有子进程宿主执行，避免模块 mock 污染。 |
| `docs/architecture/modules.md`、`docs/README.md`、本 `plan.md` | 实施时仅补 Ext 的材料/投影权威文件、生成器对应索引行和本段核对/偏离/检查收据；不修前段已记录的仓级文档问题。本次 PLAN 只提交 plan.md。 |

不改 Schema 第①段已接受的规则、Core/Plugin/Protocol/Server、公用 schema、包依赖或 gate。文件内普通私有 helper 由实施决定，不另建单实现 interface 或解析框架。

### 顺序

1. **采集基础提交**：先做 `secret-values`、`secret-files` 及各自测试/真实小样本。根事实从 `Location.Info` 的目录/项目信息、Node 宿主目录与已冻结路径变量取得；global project 用打开目录，项目 ID 不作路径，不 import Electron main 私有实现。sources/match/profile/字段选择只消费①。静态格式解析不执行 shell、标签、插值或外部引用；解析失败按设计失败出口处理，不退回全文秘密。env 使用 Node parseEnv 并保存逐次词法记录；JSON/INI/assignments/netrc/凭据 URL、私钥与不透明字节按各自 profile 提取。SQLite 用 Node 内建只读主库连接、固定发布表/列，完成即关闭。
2. 同一提交验证变化发现：先按 sources 发现，在其范围内按真实身份结束链接环；每个已知目录/文件独立 stat，变化目录逐层 readdir，新子目录/新来源首次发现，缺失根观察点随父目录变化前进。纯缓存键表验证五元组每一轴；真实临时目录验证原地改写、替换、新建/消失、嵌套目录变化、显式路径例外及 WAL 提交。缓存调用次数仅作一次临时探针证据，不增加生产统计接口，不用 watcher/TTL/数量上限。缺失/不可读来源不抹去 retained values，后续调用仍能重新发现。
3. **结果投影提交**：实现 `secret-mask` 的 Location 与根调用状态，以及成功 content/output/metadata、Tool.Error、progress 和预览共用的安全投影。按冻结 §4.5 处理重叠值、数字/动态键、键碰撞、内联文本/二进制附件、受保护文件引用；保留协议结构。ANSI 只窄引用现成 `stripAnsi`；不复制正则。完整结果的替换归本模块，④的流式前缀适配继续复用它。故障用 Schema 固定说明，不重调故障 masker，不把异常原文或 cause 带回。
4. **接线提交**：SecretMask 在 registerPolicy 每 Location 创建；seal 的尾部 before 在确认/pin 后才 begin。after 放在现有归因和显示附加之后，并在根结束时清理该根；child 只重读/遮盖自己，不建立、结束或污染 outer。进度包装覆盖无 display 的工具，保存根的最后进度及原发布回调；结束集合重新投影后，使现有 publisher 合并到的也是安全终态（必要的最后一次安全进度仍走原 context.progress），避免旧动态正文/键经 failureSnapshot 复活。Code Mode 故障终态的 toolCalls 按设计清空。权限预览在发布前共用正文投影，保留原 effect；无工具来源的预览不伪造调用键，也不创建根事务。plugin 释放时清掉 Location 私有材料，保持原注册次序。
5. 每提交单元迭代时只跑本步命名用例，例如在 `packages/ext` 执行 `bun test src/secret-values.test.ts -t 'published profiles collect credential values'`、`bun test src/secret-files.test.ts -t 'changed sources retain old values and discover new files'`、`bun test src/secret-mask.test.ts -t 'terminal masking replaces every dynamic payload'`、`bun test src/policy/register-policy.test.ts -t 'masking begins after pin and children keep the outer call'`。每步结束完整跑本步改变行为的上述文件一次；接线步另跑 `src/plugin-setup-order.test.ts`。移除臂只在临时副本，分别去掉字段选择/变化发现、结果投影、故障替换、根/child 区分及预览遮盖，断言对应命名用例变红，不加生产注入开关。
6. 返回前仅一次扩大相关集。用 `rg -n 'registerPolicy|wrapForDisplay|mock\.module' packages/ext/src` 核对出口变化的调用/mock/枚举消费者；当前应检查 `src/policy/display.test.ts`、`src/policy/unattended-policy.test.ts`、`src/policy/inventory.test.ts`、`src/policy/risk.test.ts`、`src/policy/session-row-rules.test.ts`、`src/policy/tool-policy-rpc.test.ts`、`src/plugin-host.test.ts` 和 `src/plugin-setup-order.test.ts`（已完整跑过的不重复）。只运行与实际改动相连的文件，报告筛选结果；若现成 mock 因新增清理返回值需要同步，限定于该关联文件并在偏离行列名。`bun typecheck` 与对改动 TS 的 `bunx --no-install oxlint <实际文件列表>` 从 `packages/ext` 执行；新增 Node SQLite 的测试须执行真实 Node 路径，不能让 Bun 的替代实现冒充。无需启动 app/Electron。
7. 补必要文档及核对/偏离，按已解析 Alpha profile 检查改动文档、当前新增链接、`git diff --check`，提交并停止于②。不运行包级测试、bin/check、gate run、一分钟命令或全消费者真引擎场景。

样本落实：优先复用冻结设计 §2 的 gcloud 594.0.1 官方源码及实测 DDL（源码包 SHA-256 `f3d680f1d2bcf89b575bbba309305f2d897236d19b82e7d78462cf632ee2252d`）；现有临时目录 `secrets-gcloud-source-nnq2qb0l` 仍有 `creds.py`/源码包，可核哈希后从官方列定义生成库。AWS/npm/kubectl/SSH 的格式样本用各自工具在隔离 HOME/显式输出文件中产生；其它 profile 用设计 §4.1/4.2 的一手 writer/固定样本，实施时记录版本与哈希。只替换进程生成的假值，保留真实语法/字段/DDL，不手写另一系统的格式。不执行云登录、联网获取凭据或读取用户库。Node SQLite 子进程可以临时 bundle 本段生产模块后调用；报告实际 Node 版本，不把它当作出货 Electron 或 Windows 证明。

### 风险

- 格式数量多，错误字段提取可能漏值或把 `json`、账户、到期时间等普通值污染成秘密。先固定小样本来源和字段投影，再接 IO；每个发布 profile 有正例及普通字段保留例，未知/损坏结构不能退回整文匹配。
- 缓存与符号链接若漏看目录、新根或 WAL，会使结果使用旧集合。用文件/目录变化和只读主库集成用例约束；保留旧值与重新发现分开验证。只验证本机 darwin IO，Windows 身份/junction 仍按原⑤/发布安排。
- 相同调用键的 child、并发根及 Location reload 可能互相清状态或串值。以真实 hook/registry 接线证明根 begin/end 次数和 child 结果，而不是给 child 造新 ID；清理只销毁本 Location，根故障不传染其它根。
- 删除 error.metadata 并不足以隐藏故障正文；已有 publisher 会合并最后 progress。接线用例必须检验实际终态合并输入，结束重投影与安全覆盖发生在终态发布前。保留真实工具错误类型与宿主可信状态，不信工具自报的“成功/退出码”。
- hooks 的错误不能导致原工具/程序被中断，预览遮盖也不能改审批结局。测试包含 begin 采集失败后执行计数仍增长、单 child 故障后兄弟继续、preview 的 allow/ask/deny 原值不变；不以新增拒绝、确认、限额或停执行解决失败。

### 证明

| AC / 本段义务 | 命名测试/证据 | 缺少行为为什么会失败 / 完整证明去向 |
| --- | --- | --- |
| AC-02、04 的通用结果面 | `secret-mask.test.ts`：`terminal masking replaces every dynamic payload`；`attachments are checked as decoded bytes` | 移除投影时，text/output/metadata/动态键/附件或错误因果中的生成值仍可见；真正 shell、SSH、模型/记录/卡片的交叉证明留④⑤。 |
| AC-04、06 的来源基础 | `secret-files.test.ts`：`changed sources retain old values and discover new files`、`source aliases share protected identity` | 去掉变化发现、来源匹配或真实身份去重，会漏新文件/原地写或不能结束链接环；read/结果/风险三消费者联合留③⑤。 |
| AC-10、BR-06 | `secret-values.test.ts`：`published profiles collect credential values`、`env records preserve every assignment occurrence`；`secret-files.test.ts`：`sqlite captures selected cells through a read-only main database` | 删除凭据字段/列或误采整文，会漏假值或遮掉普通值；替换为末值 map 会丢重复键的较早值。真实格式/DDL 来源一并记录；混合命令真引擎对照留④⑤。 |
| AC-08 的通用隐藏义务 | `secret-mask.test.ts`：`masking failure hides payload without stopping execution`；`register-policy.test.ts`：`terminal failure cannot revive the last progress` | 移除隐藏分支会返回原文/旧进度；把故障向 gate 抛出会使原工具未执行。真实 shell exit/signal/timeout 及各消费者故障注入留④⑤。 |
| BR-03 的根/child 与进度接线 | `register-policy.test.ts`：`masking begins after pin and children keep the outer call`、`progress and preview are masked before publication` | 提前 begin、child end 外层、只在 after 遮盖或遗漏预览，分别使拒绝调用有状态、第二个 child/最终结果漏遮或运行/审批数据含值；预览效果改变也判失败。AC-09 的 shell 直播留④⑤，不在②跑一分钟时序。 |
| BR-04、Location 释放 | `secret-files.test.ts`：`capture leaves source files unchanged`；`secret-mask.test.ts`：`locations and root failures stay independent`；既有 setup-order 宿主 | 写来源文件、跨 Location 保留/清理错误或泄漏根状态会改变原文件/另一调用结果。清理后再建 Location 不继承旧材料；程序发送真值的 AC-03 和 env 写回仍留③④⑤。 |

AC-01/05/07 的完整 read/权限/Windows 证明不在②宣告完成。去掉保护的可失败对照为本段局部证据，不能代替⑤的真引擎对照。

### 偏离记录

暂无文件范围或冻结决定偏离。真实样本来源及哈希记录于 `packages/ext/src/fixtures/secret-files/provenance.json`；MSAL 样本明确是官方缓存 entry（不冒充完整账户库），其余同一 JSON selector 的发布数据继承①验证。

2026-11-26 · 接线前发现冻结设计 §4.5/§4.7 的真实缺口，返回设计方，不更改冻结契约：`packages/core/src/tool.ts:272-278` 在 registry transforms 之外合成 CodeModeTool；`packages/core/src/codemode/tool.ts:126` 的外层 progress 直接发布 `:220-222` 构造的 toolCalls.input。现有 ToolEditor 包装不到该外层，before/after 没有 progress 字段。因此普通工具包装不能覆盖所有根工具进度；SC-01 当前只允许 Shell 捕获，不能借此改 Core 工具进度出口。最小所需能力是根工具共用的 progress 发布前可改写接缝，由扩展继续持有遮盖规则；其契约/接管范围须回设计方补齐。本段第二、第三提交未落地，未运行整段的移除对照或扩大相关集；不宣称②完成。

2026-11-26 r4 · 编排器续派明确继续②的其它部分，再写③计划。外层进度单独保留为 pending SC-02（设计候选 v3.1 @ `4466819664`，未获 owner 决定）；不实现其 hook、不禁用 Code Mode、不移除直播、不削弱原失败断言。本轮继续原结果投影及接线两个提交单元。结果文件引用需要词法/真实目标共用判定，因此在原 `secret-files.ts` 增加 `resolveProtectedFile`，未增加文件范围或改变共享纯契约。

### ②实施检查收据

- 采集基础 / Codex GPT-6 作者自查：`packages/ext` 下 `bun test src/secret-values.test.ts src/secret-files.test.ts`，exit 0，8 pass / 0 fail / 46 expect。Node v26.13.1 子进程使用生产模块和真实 SQLite，验证只读连接拒写、WAL 新值可见、普通列不进入集合。`bun typecheck` exit 0；上述四个 TS 文件 oxlint 为 0 warnings / 0 errors。每份 fixture 的 writer/一手来源与 SHA-256 见 provenance.json；未读取用户凭据。
- 已保存采集提交 `d14b17a2ea`；未接线的投影草稿保存在临时证据目录 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/codemode-mask-seam-el22rvgw/secret-mask.wip.ts`，工作树不保留未完成的生产模块。该目录的 `mask-projection.ts` 仅把草稿相对 import 改成当前仓绝对 import，供探针重现；不是出货实现或已通过的投影单元。
- 设计接缝探针 / 同一真实 PluginHost、Promise adapter、Tool registry 和 Code Mode 执行入口：从 `packages/ext` 运行 `bun test /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/codemode-mask-seam-el22rvgw/seam.test.ts`，exit 0，1 pass / 0 fail；仅观察到 `{virtualExecuteListed:false, liveContainsKnownValue:true, terminalContainsKnownValue:false}`。隔离来源含测试用变量，JS 计算一个同值参数发给子工具；没有网络、延时、窗口或用户凭据。
- 同目录 `privacy.test.ts` 使用相同入口与输入，仅把断言改为要求实时进度不含该值：`bun test /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/codemode-mask-seam-el22rvgw/privacy.test.ts`，exit 1，0 pass / 1 fail / 0 import errors。失败点是 liveContainsKnownValue 实际为 true；终态遮盖成功不能修补已发布的实时进度。此为缺口反例，不冒充已完成的移除对照或⑤验收。
- r4 结果投影 / Codex GPT-6 作者自查：`packages/ext` 下 `bun test src/secret-mask.test.ts src/secret-files.test.ts`，exit 0，10 pass / 0 fail；包含 text/数字/布尔/动态键/重叠与 ANSI、附件字节与别名、begin 故障隐藏、child 不清 outer 和 Location 隔离。`bun typecheck` exit 0；三个改动 TS 文件 lint 为 0 warnings / 0 errors。SC-02 断言仍待决，不计入这些 PASS。

- r4 接线 / Codex GPT-6 作者自查：`packages/ext` 下 `bun test src/policy/register-policy.test.ts src/plugin-setup-order.test.ts src/secret-mask.test.ts`，exit 0，**80 pass / 0 fail / 247 expect**。包括 confirm/pin 后 begin、同键并发 child 不清 outer、拒绝后同键重试、后续 hook 改写、实际审批预览、真实 publisher 的故障进度合并（采集故障与结束前新增秘密键两种）、Location cleanup 顺序。成功结果 metadata 沿用原结果形状，不把旧 progress 字段新增进成功终态；错误终态及发布前重投影仍安全覆盖旧进度。
- r4 返回前一次扩大相关集（各文件独立进程，避免模块 mock 污染）：`bun test src/policy/display.test.ts` 7 pass；`unattended-policy.test.ts` 20 pass；`inventory.test.ts` 5 pass；`risk.test.ts` 22 pass；`session-row-rules.test.ts` 7 pass；`tool-policy-rpc.test.ts` 8 pass；`bun test src/plugin-host.test.ts` 52 pass，均 exit 0，合计 **121 pass / 0 fail / 603 expect**。相关集由本段顺序第 6 项的出口/mock 搜索确定。plugin-host 首跑的两处旧断言要求透出 Permission.BlockedError cause，与冻结 §5 移除 cause 冲突；保留 deny、失败、文件未修改断言，改验公开 Tool.Error 与可信 edit 身份及无 cause，定向两例 2 pass 后完整文件 52 pass。未归类成 flaky，未调整权限行为。
- r4 类型/格式：`packages/ext` 下 `bun typecheck` exit 0；`bunx --no-install oxlint src/plugin-host.test.ts src/plugin-setup-order.cases.ts src/plugin.ts src/policy/index.ts src/policy/register-policy.test.ts src/secret-mask.ts` exit 0，0 warnings / 0 errors。段②本轮相关文件最终去重为 **209 pass**（采集 8、投影及接线 80、扩大集 121）；不包含 SC-02 红例，也不包含临时移除臂。
- r4 一次缓存探针：`node /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secret-cache-probe-x5zoeg1t/probe.mjs <隔离临时根>`，exit 0，`{initialReaddir:2, unchangedDelta:0, changedDelta:2, newValue:true}`；生产模块临时 Node bundle，以 Node import hook 包装真实 fs.readdir 计数，无生产统计接口。该目录的 output.log 保存输出；最初静态 import 在 hook 前加载导致计数为 0 的探针布置已改为 hook 后动态 import，不把无效计数当证据。
- r4 移除对照：`python3 /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-segment2-arms-ek99poqp/run.py`，exit 0；四份未变异图的控制臂通过。十臂均 exit 1 且有真实断言失败：credential-fields、directory-discovery、sqlite-readonly、result-content、failure-hidden、child-lifecycle、preview、terminal-reproject、after-hook、begin-before-approval。对应上述具名测试；前九项中的 terminal-reproject 为 1 pass / 1 fail（新增秘密键终态断言失败），其余各 0 pass / 1 fail。每臂代码/命令与 output.log、汇总 report.json 均在该临时目录，不更改生产文件，不增加注入 flag。
- r4 pending SC-02：保留原 privacy.test.ts；只替换其 import 为当前出货 secret-mask.ts 的同目录 privacy-current.test.ts，从 `packages/ext` 执行 `bun test <该文件绝对路径>`，exit 1，0 pass / 1 fail / 0 import errors。原断言仍要求 liveContainsKnownValue=false，实际 true；未削弱为允许泄漏。段②其余义务已完成，外层实时进度交设计候选 v3.1 的 owner 决策；不得据此宣告 BR-03、AC-09 或⑤完成。

2026-11-26 r4 · 追加必要范围：`packages/ext/src/plugin-host.test.ts` 的两例因本票明确移除错误 cause 而更新旧行为断言（见收据），属于原范围外唯一新增测试文件修改；不修无关问题。三个提交单元分别为 `d14b17a2ea`、`9cd3861ca4` 和本次接线提交；中间 `9a08725438` 只保留接缝反例。模块地图已在结果投影提交补权威链接。冻结决定和源文件使用权限未改；SC-02 单列待决，不把续派授权说成 owner 已批准其契约。

## SC-02 实施收据（r5）

2026-11-26 本机 07:00 UTC 开始；依据派单转录的 owner 2026-11-27 U-40「Cargo 选 1，第二处引擎改动允许，Supabase 报告批准」和 `git show 832ab5a4f4:docs/specs/secrets-usable-not-visible/design.md` §4.8/§10。只消费其中第二处引擎改动批准；未 merge/rebase，不把本地旧设计改写为新决定。

- Codex / GPT-6 作者自查：Core snapshot 的根 progress 入口先 trigger 新事件再发布，覆盖普通与合成 execute；Effect/Promise 类型与 adapter 同形。回调 defect/reject 或运行中失效时只发布固定隐藏说明，终态同样隐藏且执行器继续。扩展生成并锁定安全副本；原注册工具包装只保留终态回调，不重复匹配。现有 event.subscribe 仅清理中断/defect 根状态。
- 定向红例：原外层断言保留三项预期，接线前 0 pass / 1 fail；Core 根入口三例接线前 0 pass / 3 fail。完成后 `packages/core` 下 `bun test test/tool-registry.test.ts test/plugin/promise-tool.test.ts test/plugin/tool-input-repair.test.ts` exit 0，**64 pass / 200 expect**；`packages/ext` 下 `bun test src/policy/register-policy.test.ts src/secret-mask.test.ts src/plugin-setup-order.test.ts src/policy/authority-registry.test.ts` exit 0，**89 pass / 273 expect**。外层实时值隐藏、原 Promise adapter、后置替换/嵌套写、真实 publisher 取消失败缓存均有具名断言。
- 移除臂：仅将根 executeTool 的 context 换回未包装 context，运行 `bun test src/policy/register-policy.test.ts -t 'synthetic execute progress must hide known protected values'`，exit 1，0 pass / 1 fail；失败为原 liveContainsKnownValue 断言。日志 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/sc02-removal-myfmwgvl/output.log`。以暂存版本 scoped git restore 恢复，字节一致；无注入选项。
- Core、Plugin、Ext 各自 `bun typecheck` exit 0；三个包按实际 11 个改动 TS 分别 oxlint，均 0 warnings / 0 errors。Core 的 ToolHooks 枚举测试需补 progress 样本，属新增契约的机械同步，不更改原断言。
- 同提交登记 `.claude/rules/adrs/ADR-050-secrets-output-capture.md`、权威册独立 ID `secrets-tool-progress`、逐文件 UPSTREAM_EXCLUDES。本地及批准基线尚无 SC-01 已实现条目，因此 ADR 明确其独立批准，`secrets-output-capture` 的真实机制/proof 仍随④登记；不填伪实现。新增范围仅 §4.8 指定四个上游运行文件、对应现有测试及这些登记；复用 gate 的既有 deepFreeze，未另写冻结算法。

## ③ 安全读取、env 保值写回与权限例外

- 依据：[规格 v3](spec.md) @ `aa2476b378da663115e6735b991f6cbf2e04b5c6`，BR-01/02/04/05/06/07，AC-01、04（直接读）、05、06（三消费者）、07（路径接线）；[冻结设计](design.md) @ `66313542d35b182ef8fdbd2d4c4597d715149c35` §4.1、§4.2、§4.3/4.3.1、§4.4、§4.6、§4.7、§5、§6、§10；#1758。代码基线为②接线提交 `82e96edcca`；继承①已接受结论与②收据，不重审原决定。r4 仅授权规划③，设计候选 v3.1 / SC-02 仍待 owner 决策，不是本段依据。
- 核对：Phase: IMPLEMENT segment ③ — plan `dcaa1fc375` accepted（safe read view、env duplicate-key restore、allow-all 外读例外、shared risk）；Claude Opus 5.5（orchestrator），来源为 r5 续派单。冻结设计增量按 `832ab5a4f4` v3.1 §4.8/§10 消费，SC-02 已批准并在 `1af2389012` 实施；其它决定继承。

只实现上述读取、写回与权限/风险接线，不接 SC-01/SC-02，不宣告 shell、真实 SSH、模型记录和卡片交叉验收已完成。段②已经提供的 roots、envAssignments、resolveProtectedFile、remember、result/error/preview 继续是唯一材料与投影实现；本段不再持有名单、秘密词、档位表或值集合。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ext/src/secret-mask.ts`、`secret-mask.test.ts` | 补冻结的 read 与 prepareMutation 能力；read 只返回安全 TextPage，复用 env 词法记录和公开值规则，安全文本生成后分页；恢复读取的值经现有 files.remember 留存。接线依赖由 policy 提供，不让模型输入覆盖 roots。现有失败投影和非 read 进度包装保持唯一出口。 |
| `packages/ext/src/secret-mutations.ts`、`secret-mutations.test.ts`（新增） | 封装确有复杂边界的 env write/edit/patch 局部输入恢复；只读当前目标，消费 envAssignments 的跨度/序号、resolveProtectedFile 与现成 Patch.parse/Hunk/derive。此文件只生成恢复副本，原执行器继续负责写盘、锁、formatter 和审批；不新增 parser、writer 或接口框架。 |
| `packages/ext/src/secret-values.ts`、`secret-values.test.ts` | 仅在安全变量视图/恢复确需时补同一 env 词法边界的未解析区判定、RHS 占位符识别；沿用 Node parseEnv 和逐次记录，不另解析 dotenv。复用②的官方 Node 样本及临时生成值，补重复键、引号、多行、注释、export、BOM/CRLF 的消费者断言。 |
| `packages/ext/src/policy/index.ts`、`policy/register-policy.test.ts` | 同一 seal transform 中接安全 read 和 writer 包装，身份来自 factsFor/toolFacts；原工具输入已 pin，传原 execute 的是局部副本。使用既有 unattendedProfile；执行前建立根 read 关联，成功/失败及 Location 释放清理。permission evaluate 消费现有目录权威并把 secrets.roots 同时传给能力轴与 gate。真实宿主测试读取结果、原工具/权限调用计数和实际磁盘，不伪造 builtin 身份。 |
| `packages/ext/src/external-directory-rule.ts`、`external-directory-rule.test.ts`（新增邻接测试） | 在原权威中增加设计 §4.6 的操作判定及完整调用关联；既有规则生成/底座插入仍归此处。测试根 read 关联的建立/结束/释放、事件来源、ask/deny、自动化与已有两种交互载体差异；不在 UI/gate 加第二份 agent 名单。该模块此前没有自己的测试文件。 |
| `packages/ext/src/policy/risk.ts`、`policy/risk.test.ts`、`policy/gate.ts` | ClassifyInput 按冻结契约增加必填 protectedRoots；gate 的依赖由同一 SecretMask 供数。受保护路径改消费 ProtectedFiles.probe，保留不属于本名单的系统文件风险、已有类别和其它探针；不从 metadata 反推根、不把风险升成审批。更新所有现有调用及具名风险样本。 |
| `packages/ui-mac/src/main/codepuppy-config-injection.ts`、`codepuppy-config-injection.test.ts` | 仅去掉交互只读/询问载体的 env 专用冲突条目及相应旧注释；原只读其它 deny、tool-policy-default、自动化两载体的 env deny 保持原义。测试同时解码所有输出规则，检查交互读与自动化矩阵，不把保护名单生成回配置。 |
| `docs/architecture/modules.md`、`docs/README.md`、本 `plan.md` | 实施时补 env 恢复权威、风险输入来源及必要生成索引行，填写核对、偏离和检查收据。本次 PLAN 只写/提交 plan.md，摘要对应索引行留首次实施同步。 |

不改 Core/Plugin API、Schema 已发布规则、其它 specs、包依赖、公用 HTTP/Protocol、生成客户端或 gate。测试如因新增必填 roots 需要机械同步，限定实际调用方并在同提交偏离记录逐文件列名；不顺手迁移其它用例。

### 顺序

1. **安全视图提交**：先在 `secret-mask.test.ts` 增加 `protected read builds the safe page before pagination`、`protected read preserves missing-file and hidden-failure outcomes`，实现 read。调用前由身份已核实的内置 read 包装消费 unattendedProfile 和词法/realpath 分类；名单外仍走原 execute。env 的源序、重复键名、公开端口、秘密遮盖与固定说明由现有 envAssignments/isPublicValue 产生；未解析 shell/注释不透传，非 env 只说明。分页用原 offset/limit 语义与 TextPage 形状，测试空/默认/零值/分页、越界及安全说明，不能先分页原文。原目标不存在保留具名读失败；构造失败同形固定说明，不退回原 read。实际 read 接线在本提交完成，并在 `register-policy.test.ts` 加 `interactive protected reads bypass raw authorization in all tiers` 和 `automation and foreign read tools retain their original path`：三交互档与项目外私钥皆零 Asked，端口原样；自动化在册/载体、整工具停用、第三方同名 read、普通文件均按原权威运行。用真实 Core read 注册与隔离来源；不调用 UI 或窗口。
2. **env 恢复提交**：先以 `secret-mutations.test.ts` 的 `write restores the current RHS by key occurrence`、`edit restores every matched occurrence in its file`、`patch restores source occurrences across update and move`、`mutation failures keep existing IO and format outcomes` 约束局部副本，再实现恢复和 writer 包装。write 验同键不同值、顺序、精确占位符、显式新值、新键/新文件、非 env；edit 验片段从全文第二次键开始、replaceAll 每次不同 RHS、原工具的定位/歧义及未匹配语义；patch 用现成 parse 区分操作，以 derive 对实际目标的结果验证唯一序列化，不手写 parser。保留移动源、上下文/删除/新增行、普通行/BOM/行尾；恢复值留进 Location，来源之外不猜值。`register-policy.test.ts` 加 `pinned env mutations preserve values through the original writers`，实际内置 write/edit/patch 后核磁盘真实值、原审批、结果/diff/preview 全部遮盖及原 event.input 未变。读取/解析失败不写占位符，按原具名错误退出；不新增确认、不改原写入事务。
3. **目录例外与风险提交**：在 external-directory-rule 原权威完成根 read 关联与 evaluate 判定，使用尾部 confirm/pin 后的事实，终态 finally 和 dispose 清理；Code Mode child 不建/覆盖根 read。`external-directory-rule.test.ts` 加 `external read exception uses the complete verified root call`，覆盖缺 source、source 非 tool、同 id 不同 session/message、伪造 metadata、其它工具/agent、deny、无来源断言、结束后旧键和自动化。`register-policy.test.ts` 加 `only fully approved ordinary external reads skip the directory ask`：真实普通项目外文件在 build 零 Asked、codepuppy-ask 先等待批准、只读仍原 deny；写/edit/patch/shell 仍保留目录 ask，显式 deny 胜出。接 risk 必填 roots 同提交迁移两个生产调用点与测试供数；`risk.test.ts` 加 `protected path risk consumes the location roots`，同时验 Windows 形态/显式路径、示例/依赖排除及 /etc 系统风险没有丢失。所有风险只做说明。
4. **三消费者联合证据**随上一步落入现有 `register-policy.test.ts`：`one protected file rule reaches read masking and risk` 用② fixture 假值验证同一发布家族的 read、普通工具回显和审批风险。另在临时模块图中只加一个新文件名到 Schema 发布数据，运行同一输入与断言；不向生产增加改名单选项。移除臂分别旁路三消费者的安全 read、通用结果遮盖、共享 ProtectedFiles.probe；另分别移除 RHS 按序恢复、根 read 来源关联，具名断言必须变红。自动化误豁免、公开值全遮、终态/预览遗漏也各用对应命名用例反证。完整 AC-06 真引擎联合与跨记录证明仍在⑤。
5. 每步从 `packages/ext` 用 `bun test <上述测试文件> -t '<本步命名用例>'` 迭代，步骤结束完整跑改变行为的文件一次；配置注入对应从 `packages/ui-mac` 跑 `bun test src/main/codepuppy-config-injection.test.ts -t 'interactive env read rules preserve automation denies'`，步骤结束完整跑该文件一次。新行为的用例在实现前先观察失败，不添加票号文件/常驻 mutation 检查；每个临时移除臂记录命令、exit 和原始日志。测试样本沿用② provenance，Patch 输入由真实 Patch.parse/derive 校验，内部工具调用形状直接使用当前 Input；不手写外系统格式。
6. 返回前只一次扩大相关集：`rg -n 'classifyPermissionRequest|GateDeps|externalDirectoryRules|EXTERNAL_DIRECTORY_AGENTS|createSecretMask|mock\.module' packages/ext/src packages/ui-mac/src/main` 筛出口/mock/枚举消费者。现有应核 `src/policy/identity.test.ts`、`src/policy/unattended.test.ts`、`src/policy/unattended-policy.test.ts`、`src/plugin-host.test.ts`、`src/engine-transforms.test.ts`、`src/plugin-setup-order.test.ts`，以及 UI `src/main/codepuppy-unattended.test.ts`、`src/main/config-injection-throat.test.ts`；已在本步完整运行过的文件不重复。配置注入 engine.scenario 不跑，完整会话/一分钟直播/Windows 真机仍留⑤或平台发布。Ext、ui-mac 分别 `bun typecheck`，只对实际改动 TS 执行 `bunx --no-install oxlint <文件列表>`；不运行包/项目整套或 gate。
7. 补本段核对/偏离/实际检查收据，更新必要模块链接与生成器索引行；按 Alpha profile 检查本次改动文档、实际链接、`git diff --check`，分上述三个提交单元保存并停于③。已知仓级文档基线和 pending SC-02 按原去向报告，不借此开展治理或引擎接管。

### 风险

- read 把原始读取放在审批之后会违反零 Asked；提前跳过身份或自动化判定又会扩权。三档真实 read、原授权计数、假同名工具与在册自动化用例放在第一提交，不用返回文本看似正确代替接线证据。原 read 的分页与 model content 有私有 helper，局部安全页须以真实输入/结果形状对照，不能复制服务或忽略越界/截断语义。
- 重复键、片段、多次 replaceAll 和 patch 移动会把恢复值对应错；先验证当前文件逐次跨度及局部输入能由原 writer 正确消费。特别用两个秘密值不同的重复赋值验证 replaceAll；若现有单一 oldString/newString 形状不能保留原定位/替换语义，按冻结接口不足返回具体 SEAM-CHANGE-NEEDED，不拆成多次无锁写、不放宽匹配、不跨文件取值。本段不预先扩 Core edit 接口。
- 恢复读取在原执行器准备时发生，仍受现有外部并发写语义约束；不能顺手新增跨进程锁、重试或限制。引用同一次当前读取，不用全局 retained 集合恢复磁盘；真实 writer 用例核原锁/审批调用继续生效。
- 目录规则的整条删除、metadata 自称 read 或仅 id 关联会放宽其它动作。由原权威持有判定和完整调用键，正反权限矩阵与结束清理同时落地；SC-02 仍不影响这条权限路径。
- risk 迁移若保留可选 roots/旧名单兜底或错误删除系统路径探针，会出现两份权威或风险退化。类型要求生产/测试全部供数，临时移除共享 probe 的对照要失败；保留未知输入总函数与现有非保护文件风险用例。

### 证明

| AC / 本段义务 | 命名测试/证据 | 缺少行为为什么会失败 / 完整证明去向 |
| --- | --- | --- |
| AC-01、BR-02/06 | `protected read builds the safe page before pagination`；`interactive protected reads bypass raw authorization in all tiers` | 旁路包装会触发原 ask/deny 或暴露值；整文遮盖使端口、变量名或分页断言失败。记录/模型/卡片的真引擎三档及去规则臂留⑤。 |
| AC-04 的直接读 | 上述三档接线含②真实格式的测试 SSH 私钥，词法与 realpath 别名；`protected read preserves missing-file and hidden-failure outcomes` | 调原 read、透出附件/派生信息或失败回退会使内容/原执行计数变红；真实 SSH 使用由④⑤证明。 |
| BR-04、env 写回 | 三个 mutation 具名用例；`pinned env mutations preserve values through the original writers` | 去掉恢复或改成末值 map，使写后 RHS 丢失、重复键互换或原 oldString 不匹配；不执行原 writer/改 pin 输入使锁/审批/冻结断言失败；普通文本、显式新值仍必须原样生效。 |
| AC-05 | `external read exception uses the complete verified root call`；`only fully approved ordinary external reads skip the directory ask` | 去掉例外使 build 仍 ask；删整条规则或相信自报来源使写/假来源/询问档变 allow；全键/结束清理缺失会让旧调用越权。完整真引擎权限矩阵留⑤。 |
| AC-06 | `one protected file rule reaches read masking and risk`；临时发布数据新增文件名及逐消费者移除臂 | 只接一两处会使新文件的安全 read、输出遮盖或风险至少一断言失败；临时证据记录实际三处结果，⑤再核真引擎联合。 |
| AC-07 的路径接线 | read/风险用例使用① Windows 形态盘符、反斜杠和大小写样本；本机真实 symlink 与相对路径 | 省略规范化/真实目标判定使一致性断言失败；本机字符串/IO 不冒充 Windows 运行，win32-x64 的 AC-01/02/04 仍随 Windows 包发布。 |
| BR-07、自动化不扩权 | `protected read preserves missing-file and hidden-failure outcomes`；`automation and foreign read tools retain their original path`；配置注入 `interactive env read rules preserve automation denies` | 故障退回原文、调用原 read 或把自动化纳入交互豁免分别使失败说明、零读取/零 Asked 的原拒绝及配置矩阵断言失败。AC-08 的 shell 真引擎故障证明留④⑤。 |

### 偏离记录

暂无。本段为 PLAN，只追加本节并同步计划摘要/导读；未改生产代码、冻结设计、spec 或 SC-02 断言。具体 private helper 的签名与局部实现不在计划重新冻结；若实际改动文件或顺序变化，在对应实施提交同处记录。

本次 PLAN 作者检查：Codex / GPT-6，已对照上述冻结节与当前 read/write/edit/patch、身份、自动化、目录及风险调用点；只读探查，未实施③。Alpha profile 文档检查中本 plan findings 为 0，实际 spec/design 相对链接存在，`git diff --check` exit 0；仓级既有 index.stale 等不宣称通过，按前述去向交编排器。下一步为编排器核对本节后续派实施。


### ③ r5 实施收据与接缝返回

- 依据/已核：上述 r5 核对行、规格 v3、设计 v3.1 @ `832ab5a4f4`。Codex / GPT-6 作者自查；SC-02 已完成（`1af2389012`），另以 `ce47277a62` 单独提交红例、`412daeaa33` 修正故障投影保留旧动态键的问题。`packages/core` 下 `bun test --max-concurrency 2 test/tool-registry.test.ts` 为 46 pass / 0 fail / 156 expect；原 Promise/repair 两文件的 19 pass 继承本轮前述检查，新增红例没有更改这些路径。
- 已完成独立义务：AC-05 的操作例外在 external-directory-rule 唯一权威持有，完整根键和真实 builtin read 事实关联，确认/pin 后建立；普通 read 与 Code Mode child 的区分继续消费 SecretMask 根状态，终态/中断事件/Location 释放清理。能力轴和身份轴风险都必填 secrets.roots，ProtectedFiles.probe 替换旧凭据正则，保留 /etc 系统文件探针；没有放宽写、询问档、只读或自动化。
- `packages/ext` 下 `bun test --max-concurrency 2 src/external-directory-rule.test.ts src/policy/risk.test.ts src/policy/register-policy.test.ts src/secret-mask.test.ts`，exit 0，**110 pass / 0 fail / 376 expect**。具名证据：`external read exception uses the complete verified root call`、三档 `only fully approved ordinary external reads skip the directory ask`、`protected path risk consumes the location roots`；包含完整键、无来源、假 read、deny、清理、Windows 形态及共享排除。风险旧断言中的相对 `../../.aws/credentials` 改为本 roots 实际发布的 `/Users/me/.aws/credentials`；原 import 白名单增加 Schema 保护模块，继续禁 provider/LLM/网络依赖，不保留旧路径名单。
- 两个移除臂：旁路 read 来源关联、旁路共享 probe；分别运行上述 external/read-risk 命名用例，各 exit 1 / 0 pass / 1 fail。代码仅临时改写，以暂存版本 scoped git restore 恢复且字节一致。`/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/segment3-independent-arms-wlan7fp1/` 保存两份日志及 report.json。
- 返回前一次扩大相关集：Ext 的 identity 18、unattended 4、unattended-policy 20、plugin-host 52、engine-transforms 17、plugin-setup-order 1、display 7、inventory 5、session-row-rules 7、tool-policy-rpc 8；Core 的 tool-input-repair-integration 3、session-tool-progress 1、tool-execute 中 `canonical execution|declared outputs|foreign typed failures|interrupted execute sends` 5。各从所属包运行 `bun test --max-concurrency 2 <文件> [-t <上列过滤>]`，共 **148 pass / 0 fail**。因同机有其它 gate，每次最多两个进程，未运行整个包、100 ms 节流时序或分钟场景。精确命令范围及各文件原始日志见 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-r5-related-12bufa43/` 的 report.json 与对应日志。
- 当前已提交能力的检查：Ext/Core/Plugin 各自 `bun typecheck` exit 0；实际变动 TS 的包内 oxlint 为 0 warnings / 0 errors。安全 read 草稿（下述）类型检查失败不计为本轮通过；它已完整撤回，仅留临时证据。没有把草稿 97 pass 或 UI 29 pass 计入交付证明。

**SEAM-CHANGE-NEEDED：安全 TextPage 分页的无服务依赖入口。** 冻结 §4.4 要求先生成安全文本再沿用原分页，§4.7 明确不导入 Core 服务实现；K2 及派单又禁止复制常量/契约。实际分页函数在 `packages/core/src/tool/read-filesystem.ts:292-335` 为私有 textPage/clampLine，上限在同一服务实现 `:14-20`，没有可供扩展消费的纯分页入口。把 TextPage/常量直接从此模块引入的试作使 Ext `bun typecheck` exit 2，新增依赖闭包报 `packages/core/src/integration.ts:472,513,531,539,784,848,865` 的类型错误；撤回该闭包后同一命令 exit 0。未调查/修改这些旁观模块，也未用动态 import 字符串、类型逃逸、复制分页常量或另一个 parser 绕过边界。

真实 read 试作先确认原输出 codec 的类实例要求：普通对象在真实 read 入口被拒为 `Tool returned an invalid value for its output schema: Expected ReadTool.TextPage`。这点已有合法解法：临时探针用实际 Schema codec 验得 `{plainRejected:true, codecRoundTrip:true}`，因此**不要求为构造器增加接管**；后续包装可用原工具输出 codec 解码 DTO。仍需设计方补齐的最小接缝是：让原 reader 与扩展共用一个不依赖 Core 服务实现的纯文本分页入口，沿用原 offset/limit、行/字节/单行规则；DTO 继续消费既有输出 codec。若设计另有已授权 callable，请给出该入口，勿重审其余决定。任何为此改动的上游文件先归设计/接管边界，不借 SC-02 修改 read-filesystem。

草稿及完整 patch 保存在 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/segment3-read-seam-yhtmq5c7/`；codec 探针与 output.log 在 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/read-page-seam-proof-a6yrbsx5/`。未读取用户密钥；SSH 样本沿用②生成的 fixture。上述测试/草稿不作为已交付实现。交互 env deny/ask 注入也已撤回，安全 read 未落地前不放松原保护。AC-01、04 的直接读、AC-06 联合、AC-07 读取接线与 env 写回单元尚未完成，待接缝输入补齐后续派；不宣称段③ DONE，不提前写④计划。

偏离：按阻塞处置先完成第三提交单元中独立的目录例外/风险；read/配置注入和第二单元未出货。新增修改 `policy/identity.ts`，只把已有完整根调用键函数提升为遮盖与目录关联共用的权威，避免重复编码；未改身份来源判定。SC-02 的额外红/绿两提交用于新引入的动态键残留缺陷，原红例断言保持未改。文档仅更新本计划、模块权威链接与本计划生成索引行；其它仓级文档基线仍交编排器。当前约 30 分钟（本机 07:00 UTC 开始）；无原时长预估可比较，无新增依赖、迁移或 schema 持久化改动。

收口补充：根 read 关联在同键新根开始时先清旧记录；邻接文件最终 1 pass / 14 expect。SC-02 修正后外层/后置 hook/取消四例再次定向运行，4 pass / 0 fail / 11 expect。文档按 Alpha profile 检查，本 plan findings 为 0；模块地图仍为原 13 个缺失目标，新增三个权威链接均实际存在，README 的原跨仓未知 ID 在改动索引后升为 error，仓级共 71 error / 251 warning，不宣称全仓文档通过。当前交付代码相关用例去重合计 **328 PASS**（Ext 254，Core 74），不含安全 read / UI 草稿。遗留去向：纯分页接缝归设计方；read/env 写回等未完成段归编排器续派；原文档基线归文档治理，无 OPTIONAL 代码。

BR-07 同调用链补正：在 `6556071e90` 单独提交 `masking failure drops previous and current dynamic key names` 红例，0 pass / 1 fail；Ext 原隐藏分支会保留上一条或当前 update 的未知动态键名，值置 null 仍不满足整次隐藏。现从失败投影移除全部动态键，仅留固定说明、Code Mode 空摘要和可信 display，重新发布的完整 progress 替换 publisher 缓存。该红例未改断言，修正后 1 pass / 5 expect；属于本轮根发布接线后的同调用链必要修正，不扩大到其它模块。最终去重相关用例为 **329 PASS**（Ext 255，Core 74），此前 328 为新增此红例之前的收据；不计草稿测试。

Ext 补正完整检查：`packages/ext` 下 `bun test --max-concurrency 2 src/secret-mask.test.ts src/policy/register-policy.test.ts`，exit 0，87 pass / 0 fail / 270 expect；`bun typecheck` 与这两个 TS 文件 oxlint 均 exit 0、0 warnings / 0 errors。原 pending 工件 privacy-current.test.ts 只新增 execute.progress 接线，不改输入或三项期望，实际运行 1 pass / 1 expect（liveContainsKnownValue=false）；再旁路 SC-02 根包装运行同一工件，exit 1 / 0 pass / 1 fail，失败仍是原 liveContainsKnownValue 断言，日志在同目录 privacy-current-removal.log。原 privacy.test.ts 历史反例保留未改；永久同名断言也已进入 register-policy.test.ts。


### ③ r6 续行：消费 v3.2 / 规格 v4

- 核对增量：r6 派单明确继续实施；`git show cac06529fa:docs/specs/secrets-usable-not-visible/design.md` §4.4/4.9/§10 和规格 v4 / U-42 取代原分页阻塞。继承原①②/SC-02及③目录例外、共享风险检查；不 merge/rebase，不新增 SC-03，不处理 read 附带说明文件。首次本轮提交据此填写，不重审已定范围。
- 对原本段顺序第1项的必要修订：non-env 在原执行器前用注册 output codec 解码固定说明 DTO；env 调原 execute 保留原页选择、裁剪和格式，尾部 after 用前后源快照/逐次跨度投影原页，再通用收口。无 Core read 服务或分页常量依赖。别名只在 env 原 execute 的局部副本中归到已核实项目目标，工具展示保留原请求；read 原权限 ask 通过同一已核实根 read 关联放行，显式 deny、自动化与整工具停用保留原义。
- 文件增量：新增 `packages/ext/src/secret-read.ts` 持有安全页纯投影及邻接 fast 用例（真实内存 reader + 原 toModelContent 产生输入，不自抄分页）；`secret-files.ts` 必要地把 realpath 目标映回单一发布 sources 以识别别名根，不另持名单。`external-directory-rule.ts` 扩现有 read 事实记录持有已核实保护类别，policy 复用这一个关联；其它文件仍在原清单内。
- 测试分层：新纯投影用例为 fast；实际 Tool/permission/本机文件接线仍加入现有 register-policy 的 integration 行为用例，不加完整模型会话。FS fixture/工具依赖均使用静态 import、字面量路径/URL；不改全局 setup 或 gate。当前工作树没有 `.gate-tests` 声明，新增层落点与既有模块邻接保持一致；最终仍按新规则执行 affected-tests --list 并如实返回该现有缺失，gate 冻结不在本段自行治理。

### ③ r6 完成收据

- 已核：Codex / GPT-6，消费 v3.2 @ `cac06529fa`、规格 v4 与 r6 续派；完成安全原页投影、交互配置、当前 RHS 写回。AC-01/04 的原页与私钥读取、BR-04 写回、AC-06 三消费者联合及 BR-07 故障基础已核；全会话/模型/记录证明仍归⑤，不宣告全票 AC 验收。
- `packages/ext`: `bun test --max-concurrency 2 src/secret-read.test.ts src/secret-diff.test.ts src/secret-files.test.ts src/secret-mask.test.ts src/secret-values.test.ts src/secret-mutations.test.ts src/external-directory-rule.test.ts`，25 pass；`src/policy/register-policy.test.ts` 完整 92 pass，随后新增三消费者联合具名用例 1 pass；diff 增强后 2 pass。`packages/ui-mac`: `src/main/codepuppy-config-injection.test.ts` 29 pass。均 exit 0。Ext `bun typecheck` 与改动 TS oxlint exit 0。
- 六个移除臂 exit 1：`read-spans`、`nth-rhs`、`no-restore`、`diff-projection`、`read-wrapper`、`preview`。日志 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-r6-arms-x8vmqxq7/`。最初 diff 只去 old side 在共享 context 上仍被 new side遮盖，通过后补真实 formatter 的删/增 RHS 两侧样本再反证；preview 初次 -t 括号未转义而未选中用例，不算证明，已以整个 env write-back 组重跑变红。均恢复原代码。临时向唯一 Schema 家族添加 `vault.custom`，同一联合用例 1 pass，源码/测试已原样恢复。
- 偏离：新增 `secret-diff.ts/test.ts` 以真实 fileDiff 的行槽消费 shared `projectEnvRows`；普通精确值替换不足以遮盖带 diff 前缀的多行 RHS。新增 `secret-read.ts/test.ts` 消费原 reader 的 DTO，替代旧计划的先构页分页；不复制 reader。`policy-host.cases.ts` 增加真实 FileMutation/FileWrite/Formatter 服务，以运行原 writers，literal 动态 import 在隔离 HOME 之后；会扩大导入该 fixture 的相关测试依赖，不增全局 setup。`secret-values.ts` 为同一词法 span 增加 rhs、去无引号尾空白，不新建 dotenv parser。`secret-files.ts` 将宿主 realpath 根映回同一发布源，覆盖项目外别名。模块地图登记上述实际权威。目录/risk ③已接受部分继承 r5 收据。
- 分层：read/diff 是纯内存 fast；mutation/files 与 register-policy 是隔离 IO/真实 Core integration；无常驻重负载场景。相关集与最终 package 检查本轮结束统一一次；`.gate-tests` 缺失的既有选择器输入按原去向交编排器，不改 gate。


## ④ Shell.capture 直播与终态收口

- 依据：规格 v4 AC-02/03/04/08/09/10；设计 v3.2 @ `cac06529fa` §4.5/4.7/§5/§10，SC-01/U-38；#1758。只消费冻结契约，不重新裁决。
- 核对：计划 `0541bd7ec9`；r7 续派「Implement segment ④ (SC-01 live capture and terminal closure…)」明确授权按已定 v3.3 @ `f988de5eb1` 接续实施。继承编排器 Claude Opus 5.5 的前段收据；v3.3 已解决下述 r6 单槽接缝，不新增独立审查或 owner 决定。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/core/src/shell.ts`、`test/tool-shell.test.ts`、`test/shell-cleanup.test.ts` | 唯一 capture 生命周期、顺序发布/计数、end 替换/故障说明、原 cleanup 的孤立密文识别。原裸引擎行为保持；测试在已有真实 Shell 入口与 cleanup 文件，不新增另一执行器。 |
| `packages/plugin/src/effect/shell.ts`、`src/promise/shell.ts` | 同形 SC-01 event；Promise shell generic adapter 已可分派，不新增平行 dispatcher。 |
| `packages/ext/src/secret-stream.ts/test.ts`（新） | 增量 UTF8/escape 边界及真实 secret-prefix matcher，窄引用 shared stripAnsi；fast 边界样本来自同一 stripAnsi 和已有秘密格式 fixture。 |
| `packages/ext/src/secret-spool.ts/test.ts`（新） | 当前帧 AES-GCM 认证临时材料、计数完整性、同目录 safe staging；integration 使用隔离 IO/真实 crypto，不打印值。 |
| `packages/ext/src/secret-mask.ts`、`secret-mask.test.ts`、`policy/index.ts`、`policy/register-policy.test.ts` | 同一个 Location files/retained values 提供 capture 策略；dispose 抹除 key；tail 注册 hook；真实原 Shell 用例验证前后并集与故障，不改子进程文件/环境。 |
| `.claude/rules/adrs/ADR-050-secrets-output-capture.md`、`docs/architecture/codepuppy-authority-registry.json`、`scripts/north-star-guard.sh` | 同一行为提交登记 SC-01 实际接管、mechanism/proof，与 SC-02 独立条目；逐文件排除，不增加包级豁免。 |
| `docs/architecture/modules.md`、`docs/README.md`、本计划 | 实际权威链接、生成索引行及真实核对/偏离/检查收据。 |

### 顺序

1. 先用 fast `stream publishes ordinary suffixes and keeps only genuine prefixes`、`stream masks every UTF8 and ANSI split` 验流变换；用 integration `spool authenticates each frame and rejects truncation` 核真实 crypto/计数。再接 SecretMask.capture start/chunk/end，具名 `capture reprojects the terminal file with newly discovered values`、`capture failures discard terminal prefixes` 验文件与 disposition，保留失败命令继续由 Core 用例证明。
2. 补 effect/promise 同形 ShellCapture 与 Core 唯一捕获路径。现有 `tool-shell.test.ts` 增加 `capture publishes live bytes and replaces terminal output`、`capture failure hides terminal output without stopping the command`、`lost capture callback never falls back to raw output`；Shell cleanup 现有测试加入 exited/live/unknown owner 专用 spool 样本。不运行 shell scan/parser 全集或容量/计时场景。注册 tail callback，用真实宿主的 `register-policy.test.ts` 联合读取安全运行文件/最终结果。一分钟 AC-09 和全部消费者会话证明仍归⑤。
3. 六项临时移除臂：跨块前缀、shared ANSI、end 并集、帧计数、Core latch/终态替换、孤立进程识别；只跑具名测试，恢复字节并记录每次 exit 1。登记 SC-01 和 docs 与实际实现同提交。
4. 步骤结束完整跑改变行为的测试文件一次；最终只一次运行 grep 到的相关集合、各改动包 `bun typecheck` 与 scoped oxlint。`affected-tests --list` 记录 scope 或既有缺声明错误；不改 gate。文档按 Alpha profile 核变更路径，`git diff --check`。提交后返回编排器续⑤。

### 风险

- 分块 UTF8/escape、重叠值的完整/前缀竞争会漏值或阻塞普通末行；枚举单个短样本每切分点、同起点长短值及长私钥+普通末行。无定时器或任意尾部长度。
- 密文截断到完整帧也必须失败，认证前不能消费明文；记录期望帧数/总字节，真实篡改/截断用例同时反证。长 escape 残段不能无界存内存，使用同一认证 spool。
- hook 丢失/故障不得停止程序或回读旧文件；Core 独立锁存并在 end 替换说明，IO 失败直接安全正文。测试真实 exit 7/终止与故障前安全前缀。
- 输出持久引用/counter 必须在 outputDone 前完成替换；普通裸引擎、Job/Shell.result 仍消费同一文件，不补 UI/Bus 接管。

### 证明

| AC | 测试/证据 | 层与运行时机 | 缺少行为为什么会失败 |
| --- | --- | --- | --- |
| AC-02/03/04 | `stream masks every UTF8 and ANSI split`；真实 Shell live/final 用例 | fast/integration，相关 PR 与 nightly | 跨块或 ANSI 旁路出现原值；程序副作用/原 exit 必须仍存在。SSH 服务与会话记录留⑤。 |
| AC-08 | `capture failure hides terminal output without stopping the command`；`capture failures discard terminal prefixes` | integration，相关 PR 与 nightly | 无 latch/replace 时故障前前缀或原文留终态；无安全说明 fallback 时 IO 故障能读旧文件。全记录故障注入留⑤。 |
| AC-09 | `stream publishes ordinary suffixes and keeps only genuine prefixes`；`capture publishes live bytes and replaces terminal output` | fast/integration，相关 PR 与 nightly | 结束前输出为空/固定长尾延迟会失败；一分钟场景⑤。 |
| AC-10 | `capture reprojects the terminal file with newly discovered values`，继承② profile 凭据采集 | integration，相关 PR 与 nightly | 去掉 end 并集会留下新落盘值，公开端口/普通 json 必须保持。真实云配置组合场景⑤。 |

### 偏离记录

暂无。新测试的静态 imports/literal 路径保持依赖可追踪；当前 `.gate-tests` 缺失不伪装成 selector 已通过。


### ④ r6 接缝收据：SC-01 单槽发布与长 escape

- `SEAM-CHANGE-NEEDED: SC-01 shell.capture`。冻结 v3.2 @ `cac06529fa` §4.5 的 `bytes: Uint8Array` / `disposition` 单槽（固定提交行 323–338）不足以同时满足行 342/354 的密文长 escape 残段、仅当前帧/真实 secret 前缀内存，以及行 344/348 的已确定文本当次 flush 发布。不是 SC-03/分页重开，也不改变已批秘密匹配范围。
- 生产函数探针：`bun /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-sc01-seam-i28_2rog/ansi-capture.ts`，exit 0。仅输入合成控制字符，不含用户数据。调用现有 `packages/session-ui/src/tools/ansi.ts:6`，两组长度：pending 1026 / 1048578 bytes；补 BEL 后输出均 0；补 `ESC X` 后应发布 1028 / 1048580 bytes，且程序断言与原串相同。probe 不复制 strip 正则，也不是容量/时序常驻测试。
- 具体调用：首 chunk 为 `ESC ]` + 任意长的 `x`，之后命令暂不退出；它若随后闭合，现有 stripAnsi 会移除整段，因此首 chunk 不能先发布。若下一小 chunk 改为无效 `ESC X`，整段已确定为普通文本且不是秘密前缀，必须当前 flush 释放。它可以从密文逐帧解密，但当前 event 只有一个完整 Uint8Array 可供 Core 追加；要么整份回填内存，要么等后续 chunk/结束，要么扩展直写 Core 文件/计数，分别违反内存、直播或职责边界。返回 replace 也被限定为 end。
- 所需最小修订：保留同一 SC-01 生命周期，由 Core 提供可在一个 capture 回调内顺序发布多个安全块的出口（或等价的流式安全块契约），由 Core 逐块写盘/计数/故障收口，Ext 仍持解析/秘密/密文。需设计方固定签名与失效语义后续派；本轮不私加接口、不直接写 Core capture，也不通过上限或失败隐藏规避普通大输出。
- 状态：计划 `0541bd7ec9` 已提交；核对来源为 r6 的同轮授权。没有实施④、没有登记不存在的 SC-01 mechanism/proof、没有更改已批设计/运行规则。③完成与相关测试继续保存；下一步交编排器/设计方仅处理上述接缝。


③最终相关集收据：从 exports、实际调用与 `policy-host.cases` literal import 筛选后，Ext 的 identity/risk/unattended/unattended-policy/plugin-host/engine-transforms/plugin-setup-order 七文件 **135 pass**；fixture 的 tool-policy-rpc/session-grant/session-row-rules/inventory/permission-reply-premises 五文件 **32 pass**；UI unattended/config-injection-throat 两文件 **18 pass**。命令均为包目录下 `bun test --max-concurrency 2 <具名文件>`、exit 0。ask-deadline 的定时专用用例未获本轮运行授权，未额外跑。加上上列改变行为文件，最终代码 **332 个不同用例 PASS，0 fail**；没有重复计入迭代或移除臂。Ext/UI `bun typecheck` exit 0，实际改动 TS scoped oxlint exit 0。Core/Plugin 本轮未改，无新包检查。

`affected-tests --list` exit **2**：缺根 `.gate-tests`，**无 scope line**，不声明自动选择器通过。Alpha profile 的 `check_repo(..., changed_since="4dd42773c8")` 输出 `/tmp/secrets-r6-docs-contract.json`：本 plan 0 findings；modules 的既有 13 缺链、README 的既有 index.stale/跨仓 ID 仍在（仓级共 322 findings），去向继承前段的文档治理；实际新增 authority 链接存在，生成器只提取本 plan 索引行，未全仓重写。`git diff --check` exit 0。遗留仅④接缝交设计方、⑤完整验收与 Windows 发布真机，不做无关修复。

上述 SC-01 反例也可从 `packages/ext` 重现（一次性命令，不加永久容量测试）：

```sh
bun --eval 'import { stripAnsi } from "../session-ui/src/tools/ansi.ts"; for (const n of [1024,1048576]) { const p="\x1b]"+"x".repeat(n); if (stripAnsi(p+"\x07")!=="" || stripAnsi(p+"\x1bX")!==p+"\x1bX") throw Error("premise changed"); console.log(n,Buffer.byteLength(stripAnsi(p+"\x07")),Buffer.byteLength(stripAnsi(p+"\x1bX"))); }'
```

本轮依据版本与已定勿重开见③/④核对行；作者自查 Codex / GPT-6。r6 开始 08:43 UTC，最后检查约 09:33 UTC；本轮无新增独立审查。③实际 17 文件/737 insertions/23 deletions，④只有计划及接缝收据，未静默扩实施范围。


### ④ r7 实施增量与接缝闭合

- 依据：设计 v3.3 @ `f988de5eb1` §4.5/§10（`git show` 读取，未 merge/rebase）；规格 v4。r6 的单槽返回只作为历史证据保留，本次用同一个 callback 的 `publish(chunk)` 闭合，不再 pending。
- 实际实施：Core 的 start/chunk/end、调用期发布函数、顺序/在途写入与 drain、失效/并发/写盘锁存、end 完成前安全替换与 IO 失败直接说明；Ext 复用同一 retained files，逐帧 AES-GCM 和长度/数量核对、增量 UTF8/escape 与真实 secret-prefix，以及 end 并集重遮盖。SC-01 与 ADR-050/唯一 registry/逐文件准入同提交登记；不新增 hook、Bus/UI 接管或配置。
- 计划偏离：`secret-stream.test.ts` 实际有认证残段 IO，按 integration 而非原先 fast；无 ANSI 的匹配逻辑仍纯计算，未给生产新增可注入存储接口。`context-injection.ts/test.ts` 与其现有 inventory snapshot 必须同步新增 capture（并补既有 SC-02 progress）通路，保留精确集合断言，生成脚本只改变一行清单。`policy-host.cases.ts` 显式供真实 Shell 与 ShellSelect；原真实 ShellTool 初次因 fixture 缺服务而未注册，经 Plugin.list 明确定位，未替换身份或模拟工具。该 literal import 会扩大导入 fixture 的相关选择，不是全局 setup。
- 分层：spool/stream 是当前帧+隔离磁盘 integration，Core Shell/cleanup 与 register-policy 是真实服务 integration；不会跑一分钟或新增容量常驻用例。数据格式沿用 Node dotenv 与 shared stripAnsi，本票密文 framing 为私有临时数据；没有新依赖。
- 定向已核：Ext 的 spool/stream/mask/register-policy 四文件完整 **107 pass / 0 fail**；Core capture 五个新用例 **5 pass**、cleanup 完整 **2 pass**；context-injection/authority-registry 两文件机械同步后 **48 pass**。Core/Ext/Plugin `bun typecheck` 与 scoped oxlint 通过；Core 测试自引用推断错误以 callback 的明确 Effect 返回类型修正，未改测试断言。
- `gate slot -- bun test --max-concurrency 2 test/tool-shell.test.ts` 完整文件仅跑一次，原 scanner/ordinary shell 用例有超时与 bash process-substitution wait 红例，正在按 delivery-ship §3 做一次具名基线确认；不重跑全文件、不放宽断言、不扩查 shell parser。相关具体结果与最终移除臂在下续收据，不把当前文件报为全绿。


④检查补记：完整 Core Shell 文件 `gate slot -- bun test --max-concurrency 2 test/tool-shell.test.ts` exit **1**，**41 pass / 11 skip / 23 fail / 19 errors**。原 `conditional substitutions respect once` 的断言（实施前 `test/tool-shell.test.ts:555`）期待 exit 0，实为 `/bin/bash: wait: pid … is not a child of this shell` / exit 127。查本机 `/bin/bash --version` 为 3.2.57 arm64；以 `7908e11402` 的原 Core shell 和原测试作一次具名基线，`bun test --max-concurrency 2 test/tool-shell.test.ts -t 'conditional substitutions respect once'` 仍 exit 1 / 1 fail，同一句非 child 错误；日志 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-r7-baseline-gd9_k9d0/conditional-once.log`。未把其它超时一概断言为同一根因，不继续排查/修复；原 scanner/ordinary 失败去向为编排器对应 shell 测试/机器协议事项。全文件不再重跑。基线复现最初误排入 slot，被另一 ship 占用预计 34 分钟，尚未执行测试即取消自己的等待；实际具名复现不含容量/时序负载，直接以两 worker 跑一次。两源文件已逐字节恢复。

八个移除臂均 exit **1**：true-prefix、shared-ansi、end-union、frame-completeness、terminal-only-notice、owner-liveness、safe-counts、concurrent-latch。原始日志 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-r7-arms-y2udliw2/`；完整恢复 staged 字节。并发测试的拒绝观察放在 hook 外断言，以免 hook 内断言异常被正常 hide-on-failure 吞掉而形成假阳性。Core/Plugin surfaces、registry 及 guarded files 均有实际机制和上述真实用例。
