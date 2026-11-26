---
id: PLAN-secrets-usable-not-visible
title: 密钥文件程序可用、助手不可见 实施计划
summary: 列明五个交付段，保留共享规则段的实施证据，细化 Location 采集与通用工具收口段的文件、顺序和证明。
kind: plan
status: active
spec: SPEC-secrets-usable-not-visible
design: DESIGN-secrets-usable-not-visible
owners: [owner]
last_reviewed: 2026-11-26
---

# PLAN-secrets-usable-not-visible｜密钥文件程序可用、助手不可见 实施计划

本计划服务于 [#1758](https://github.com/impharaon/alpha-code/issues/1758)。规格、接口与裁决只引用 [spec.md](spec.md) 和 [design.md](design.md)，不在此另定。每段开始实施前展开本段；当前已展开①②。第一段实际检查见下方实施收据，完整真引擎行为验收仍在⑤。

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
