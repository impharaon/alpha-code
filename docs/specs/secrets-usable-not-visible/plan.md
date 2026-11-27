---
id: PLAN-secrets-usable-not-visible
title: 密钥文件程序可用、助手不可见 实施计划
summary: 五段实施；①②③及 SC-02 已核，④按 v3.3 接同一回调内流式发布与终态收口，⑤规划真引擎全部 AC。
kind: plan
status: active
spec: SPEC-secrets-usable-not-visible
design: DESIGN-secrets-usable-not-visible
owners: [owner]
last_reviewed: 2026-11-27
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


### ④ r7 最终收据

- 两条独立红例先提交：`0924ec2b73` 在真实 `.env` 的 `PASSWORD=7` 下观察 output/metadata.exit 被遮盖（1 fail / exit 1）；`ebb9cc2da1` 观察模型所用的原生状态说明也被遮盖（1 fail / exit 1）。随后修正不改这两条断言。当前通过 `shellRuntime` 的事实参数消费单一身份权威，仅 verified builtin shell 的运行 envelope 保持原值；状态说明/metadata 窄复用已有 `ShellResult.notice/metadata` 纯 callable（设计 §4.7 已列），没有 Core 服务导入或新 export。通用正文与外来工具自报字段仍遮盖；同名第三方 shell 实例证明不能借身份。progress 的 shellID 与终态运行字段同源，child 仍无独立事务。给 result/progress 增加必填 facts 是该契约的领域轴，不是开关；`secret-mask.test.ts` 对应供 undefined，原断言未改。
- 新增两个移除臂 `trusted-exit`、`native-identity` 均 exit 1，日志同前目录；合计 **十臂变红**。去恢复丢 exit，去 builtin 身份条件使第三方 shell 的自报 exit 透过。均恢复 staged 字节。
- 最终改变行为集：Ext `bun test --max-concurrency 2 src/secret-mask.test.ts src/policy/register-policy.test.ts` **105 pass / 0 fail**；原 spool/stream 两文件 **5 pass** 继承未变。context-injection/authority-registry 完整 **48 pass**；Core capture 命名组 **5 pass**，cleanup 完整 **2 pass**。Core 全文件的原红单独保留前述记录，不算新能力通过。
- 最终相关集只扩大一次：grep mock/导出/枚举及 fixture import 后，Ext identity/risk/unattended-policy/tool-policy-rpc/session-grant/session-row-rules/inventory/permission-reply-premises/plugin-host/plugin-setup-order/codepuppy-ext-no-shell-layer 十一文件 **148 pass**；Core session-shell/promise-tool 两文件 **13 pass**；shell-retention 只跑 `does not inherit` **1 pass**，不重跑未改变的 25-shell 容量例；session-ui run-machine/ansi 两文件 **12 pass**。所有为包目录下 bun test、max-concurrency 2，exit 0。最初给两文件各写一个 -t 时后者覆盖，retention 未被选中，改成该文件单独具名执行后计数。ask-deadline 专用计时例不扩跑。
- 原红已存在处置：`packages/ext/src/policy/session-grant-upstream-reds.scenario.test.ts:30,115` 已列 saved-approval / session-grant 的预期红名单（I-05/I-13、ADR-047）。本轮未运行该重放器，未把故意不继承的断言改绿；另有 conditional process-substitution 的非 child 问题，仅一次前述基线证明。Bash 版本是观察，不单凭版本声称根因；去向为编排器，非本票修复。
- Core/Ext/Plugin package `bun typecheck`、实际改动 TS oxlint、`git diff --check` exit 0；Ext `bun run build` 产生 self-contained ESM，未启动 app/Electron。额外一次真实 Node 平台探针 `node /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-r7-node-pyEiXt/probe.mjs` exit 0：Node v26.13.1 / darwin / arm64，authenticatedFrames、ciphertextOnly、truncatedRejected、streamingMask 均 true；只编译本次 spool/stream，输入临时生成、不打印值，不作为常驻重复测试。
- `affected-tests --list` 仍 exit **2**，缺根 `.gate-tests`，**无 scope line**；交编排器按既有去向，不改 gate。Alpha profile 检查本 plan、ADR-050、registry 的 findings 为 0（输出 `/tmp/secrets-r7-docs-contract.json`），modules/README 既有问题继承③去向，不报全仓文档通过。新增 authority 链接存在，索引只提取本计划行。
- 已核：Codex / GPT-6；r7 开始 09:54 UTC，④完成检查约 10:28 UTC。实际首提交 23 文件、794 insertions/33 deletions，加本段真实退出字段的必要修正；无迁移/新依赖/新配置。SC-01/SC-02/U-42 的已定边界不重开。完整 AC-01..10 真引擎验收、故障跨记录与一分钟直播仍属⑤；Windows 真机待 Windows 包发布，不含 Intel Mac。


## ⑤ 真引擎与平台验收证据

- 依据：规格 v4 AC-01..10 / BR-01..07；冻结设计 v3.3 @ `f988de5eb1` §2/§4/§5/§10；①②③及 SC-02 已接受收据、④ `60b58554c6` 与真实退出状态修正 `44849a0fe2`；#1758。Windows 真机只在 win32-x64 包发布时验，不含 Intel Mac。
- 核对：Phase: IMPLEMENT — 5511eceef3 · orchestrator / Claude Opus 5.5 · ⑤ plan PASS (every AC-01..10 has a named real-engine row with a failing condition; files limited to composer-tier-matrix cases, the scenario host row and plan.md; no frozen decision changed).

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/ui-mac/src/main/composer-tier-matrix.engine.cases.ts` | 在已有真注入、真 Ext、本机 scriptedModel、HTTP/权限路径的三档模块里增加 `protected files` 场景组，共 18 行（下表展开），只用真实内置 read/shell/writers。场景内的临时目录、接收服务、SSH 服务与卡片/记录观察 helper 留本模块，复用现有 engine-sandbox/codepuppy-engine，不新建票号文件或第二个引擎宿主。 |
| `packages/ui-mac/src/main/engine-cases.scenario.test.ts` | 只更新现有 composer-tier-matrix 行的标题与精确 pass 数（预计 30→48，以实际具名行核对）；宿主仍 7 行，保留每行 0 fail / 恰好一个文件及现有时限断言，不加第二张表、不改 gate、地板或阈值。 |
| 本 `plan.md` | 同提交补核对、逐 AC 实际命令/结果、所有对照臂与平台 pending 行；实测失败按原 Handling problems 处理，不把目录/标题存在当行为证据。 |

不改其它 specs/design/生产接口、Core/Ext 功能、运行规则或 gate。若场景暴露本票真实缺陷，先记录具名红例，再做必要同调用链最小修正及本计划偏离；冻结接口不足则精确返回，不预建测试开关/配置/依赖。

### 顺序

1. **先建安全观察与三档读矩阵（首提交）**。沿用现有 `engineSandbox()`、`assertEngineSandboxed()` 和 `codepuppyEngine()`；所有 HOME/XDG、global/data/config、项目与测试输出都须由引擎自己核实落在 sandbox。测试在启动前以穷尽 `Record<ProtectedFiles.ProtectedPathVariable, string>` 的 fixture 输入把八个已发布路径变量重定向到 sandbox，防止继承宿主 AWS/Kube/gcloud 等真实路径；这份类型约束的输入不是第二张保护名单。每行建立新的项目/Location，不只新 Session，防 retained values 跨行让反例假绿。所有来源值由 fixture/CLI 在测试侧生成，prompt 只给文件名/命令，不能把期望秘密写进用户提示或模型桩响应。
2. 复用 `scriptedModel.requests` 观察真正收到的 tool 消息；走已有 Session API 读取记录，并消费真实 EventV2/消息到现有 `createProjector`（`src/engine-adapter/opencode2/events.ts`）与 `shellRunProps/transitionShellRun`（`packages/session-ui/src/tools/run-machine.ts`）得到卡片数据。用同一原始事件/记录，不能另写投影或把模型文本当卡片证明；结束前同时直接读实际 capture 文件和 Shell.output。所有缺值断言比较 boolean，报告只记结果/路径，不打印 fixture RHS。先落 AC-01 三行、AC-05 三行和 AC-06 一行；所有 Asked 通过引擎原待批/回复路由计数，保护读出现 Asked 立即判错后清理，不自动批准掩盖它。
3. **程序可用、命令与结构化文件（第二提交）**。AC-02 原样 cat，AC-03 Node 官方 dotenv fixture + 原 write/edit/patch 恢复后脚本发送到 127.0.0.1 临时 HTTP 接收端（端口由 listen(0) 分配），测试侧核收到真实值/重复 RHS、引擎侧看不到值。AC-04 使用现有 private-key fixture/真实 ssh-keygen 生成的临时测试钥匙（来源注释指向既有 provenance），只在 sandbox 放私钥/authorized_keys/host key；运行本机现有 OpenSSH sshd、临时配置与高位回环端口。用 internal-sftp/测试根验证私钥认证成功，不启动用户登录 shell/rc，不读 owner SSH 配置或 agent；client 使用明确的测试 identity、已知主机表与空配置。`/usr/sbin/sshd -V` 本轮只读确认 OpenSSH 10.2p1；无特权服务能力留实施时在临时目录验证，不请求 root/安装依赖来假定成功。AC-10 直接复制②已记录来源的真实 AWS/云配置格式，打印 package.json 与配置，核凭据字段消失而 json、端口/开关仍在。此处不重做解析器证明。
4. **故障、Code Mode 与唯一一分钟（第三提交）**。借既有测试 probe 的 Context 注册同一个 capture hook 作一次故障注入：start（首 publish 前）、chunk（已 publish 后）、end、实际 capture 路径 IO 阻断四行。记录注入确实发生，命令仍完成副作用/真实退出码；终态 API、文件、记录、模型和卡片全部只含固定说明与运行状态。IO 例在 start 把本次临时 capture 路径占为目录，验证说明文件也不能落盘时仍无旧引用；finally 只清本次测试材料。Code Mode 行跑真实 child 结果/错误及根取消路径，用真实事件/记录证明没有原值，不以 direct snapshot 替代模型请求。长 escape 行只用一个固定 1 MiB 样本：先有密文残段、后无效 escape，在同一回调释放安全帧；不做 RSS 阈值、容量/seed 扫描。AC-09 的一分钟行在结束前观察卡片及运行文件，结束后观察模型/记录/最终文件；迭代时先不跑这行，最后经宿主一次跑完，不为同一代码再跑一分钟。
5. **一次性反证，不加产品开关**。①②③④已有低层移除臂继承；本段另在隔离的新进程中按 AC 跑最小真实反臂。对 AC-01/02/04 去对应规则/遮盖后观察原值确实出现；AC-06 临时只向 Schema 的 PROJECT 家族加 `vault.custom` 并把同一个联合用例的文件名改成它，三处仍通过，再分别旁路 read、普通结果遮盖、risk probe，各一臂变红；不用导出/可注入名单。AC-08 的对照只移除故障隐藏并恢复原文 fallback，注入仍须命中且原值出现；AC-09 的对照延迟 publish 到 end，结束前观察失败；AC-10 把实际配置全文当匹配单位，普通 json 被遮使断言红。每次保存命令、原始输出、输入提交/差异和观察 boolean，结束后精确恢复并比对字节；不用常驻变异测试或修改旧记录。源/模块缓存不能跨臂复用，反例不得因旧 retained values 或另一消费者再次遮盖而假绿。
6. **运行与交付**。每次真引擎、SSH、1 MiB 和一分钟均经 `gate slot --`；不跑 gate/bin/check/whole suites。迭代只跑刚变的具名行：从 `packages/ui-mac` 执行 `gate slot -- bun test --max-concurrency 2 --timeout 90000 ./src/main/composer-tier-matrix.engine.cases.ts -t '<具名行>'`，不包含一分钟。结束步骤只一次从同包运行 `gate slot -- bun test --max-concurrency 2 src/main/engine-cases.scenario.test.ts -t '三档 × R1'`，现有行执行全部 48 例并校验精确数/0 fail/一文件；不另跑直达 cases 全文件或宿主其它 6 行。对照一分钟为不同变异代码，只跑该臂一次，失败后用现有 Shell remove/宿主 close 在 finally 清理，不留进程。若实施中的新改动确实需要重验已跑的重例，记录新版本/原因，不重复 unchanged run。
7. 最后只一次 grep 实际改动 helper/mock/枚举消费者，跑未跑过的必要相关文件；当前预计无需改共享 helper，pure engine-adapter/run-machine 消费者已在④核过，不因写计划重跑。ui-mac `bun typecheck`、实际改动 TS scoped oxlint、`affected-tests --list`（只列范围）、Alpha profile 本次文档检查和 `git diff --check`。核宿主表仍 7 行、实际新增 static imports/literal fixture 路径可被选择器追踪；不修当前缺 `.gate-tests` 的独立输入。分上述三单元提交，只返编排器，不 push/PR/merge。

### 风险

- 只看 hook 返回会漏掉模型/记录/卡片，或等到结束才检查会把 AC-09 假装通过。先接现有真实事件/消息观察，分钟行必须在命令仍活动时留下实际 capture 和卡片证据；不启动窗口，不补 UI/Bus 接管。
- 全局路径变量/OS homedir、retain 跨 Location、同进程模块缓存都可能越界或污染对照。先证明完整沙箱与显式路径输入，再逐行新 Location、逐反臂新进程；不读取 owner 的源文件，也不把真实凭据放报告。
- 真实 SSH 需要本机 sshd 可在临时目录无特权运行，且不能通过真实用户 rc/agent 获得偶然成功。现有二进制已确认，服务/认证到目标目录的验证未跑；若环境无法提供，不换假 SSH、不写系统配置/申请 sudo，返回具体机器前置项给编排器，先完成独立 AC。
- 负向只有“没输出”不足以证明没漏，故障注入也可能没命中。每臂同时核执行/接收/注入计数与原值可见或普通值丢失，坏臂必须触发对应正向断言；物理文件与 API/记录不能互相代替。
- 上游 tool-shell 文件已有预期红与独立 baseline 问题按④去向保留；不在本段重跑其全文件或修旧 shell 语义。host 原有 30 行若有红，按 Handling problems 的一次具名基线处理，不改断言/阈值来获得 48 pass。

### 证明

以下均为现有 `composer-tier-matrix.engine.cases.ts` 的 `protected files` scenario 组；相关 PR 不运行、nightly 才常驻，本次按批准计划手动经 slot 执行。共 18 新行，加原 30 行预计 48；其它计数变化必须列为本计划偏离。

| AC / 行数 | 具名行为证据 | 缺少行为为什么会失败 / 平台去向 |
| --- | --- | --- |
| AC-01 / 3 | `protected files read build`、`protected files read ask`、`protected files read readonly`：真实 env 工具结果、模型/记录、Asked=0，两个变量名、秘密遮盖、端口原样；另含原 offset/limit 长行/多行页观察 | 去 read 规则/源跨度会出现原值或 Asked；整文遮盖会丢变量/端口。darwin-arm64 本轮，Windows 三档真机留发布。 |
| AC-02 / 1 | `protected files shell model records and card` | 去捕获/终态遮盖，模型、记录、最终卡或物理输出出现已知原值；不以工具卡截图代替原始数据。 |
| AC-03、BR-04 写回 / 1 | `protected files restored env reaches local receiver`：真实三 writer 与脚本/接收端 | 去回填会把占位符/错误序号发出；不执行程序则接收端为空，单纯隐藏所有输出也不能使接收证明通过。 |
| AC-04 / 1 | `protected files private key authenticates over SSH`：read/命令打印/真实私钥认证三步 | 去保护会出现完整测试私钥；限制程序读取则真实认证失败。使用本机临时 SSH 服务，不碰远端或 owner 登录环境；Windows 真机留发布。 |
| AC-05 / 3 | `protected files ordinary outside read build/ask/readonly` | 删例外导致 build 出 Asked，删整规则导致 ask/readonly 放开；三档原先结果分别核，保持已有明确 deny。 |
| AC-06 / 1 | `protected files one rule reaches three consumers` + 同名 case 的新文件名一次性图 | read、普通工具回显、审批风险三处同一源；分别去任一消费者断言红，新文件名图不是只检查字符串/导出存在。 |
| AC-07 / 0 新行 | 继承① Windows 形态路径和移除臂；本段记录 win32-x64 的 AC-01/02/04 真机行 pending | darwin 不把 Windows 字符串当实际 Windows IO；发布到 Windows 时逐项实际运行，不能以 Mac pass 代签。 |
| AC-08 / 4 | `protected files capture failure start/chunk/end/io` | 需故障命中、进程副作用/真实 exit 可见、所有终态仅说明；去故障隐藏的原文 fallback 反臂确实出现原值。 |
| AC-09 / 1 | `protected files minute live output` | 结束前卡片/文件没有输出，或任何阶段出现已知值均失败；延到 end 的对照在前置观察处红。唯一正常一分钟在最终宿主检查中跑一次。 |
| AC-10 / 1 | `protected files cloud fields keep ordinary values` | 真格式凭据被遮，package.json 的 json/数字及配置普通值原样；整文作为秘密的对照使普通值断言红。 |
| BR-03/07，SC-02 / 1 | `protected files Code Mode results errors and cancelled progress` | child/outer 真实模型请求、progress、取消记录都有检查，去 SC-02 时根原值出现；不改 r5 已保留的外层进度断言。 |
| v3.3 / 1 | `protected files invalid escape publishes streamed residue` | 当前 flush 内实际文件/卡片已有安全文本，未决时只有密文；单槽聚合/延后发布或临时原文会失败。仅固定 1 MiB 一次，不常驻 PR 层。 |

### 偏离记录

r8 开始于 2026-11-26 10:41:43 UTC。直达 `.cases.ts` 命令增加 `./`（当前 Bun 否则不识别为测试路径）；fixture 的 SSH 私钥使用既有 isolation preload 钉定的 `os.homedir()`，通过 `TEST_ROOT_KEY` / `isInside` 断言其仍在受控临时根，避免把 engineSandbox 二次改写的 HOME 误当实际 Ext home。八个显式路径变量仍全部在 sandbox。生产/共享 helper/gate 未因此改动。

### r8 Core shell 基线排除

- `packages/core/test/tool-shell.test.ts` 既有红：按 r8 明确授权，在同一工作树隔离替换 `7908e11402` 的 Core `src/shell.ts` + 整测试文件，随后 HEAD 恢复并逐字节核对；两次均从 core 执行 `gate slot -- bun test --max-concurrency 2 --reporter=junit --reporter-outfile <evidence>/current.xml test/tool-shell.test.ts`。base exit 1 / 36 pass / 11 skip / 23 fail / 19 errors；HEAD exit 1 / 41 pass / 11 skip / 23 fail / 19 errors。23 个 JUnit 失败名称集合完全相同，HEAD-only 0、base-only 0；两边另有 19 次无 testcase 名称的 `Unhandled error between tests`（TimeoutError），JUnit 不产生 error 节点，不把它们伪造为额外具名失败。日志、XML、退出码及 comparison.json 位于 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-r8-tool-shell-ntcdlfbe`；本轮不改既有 shell 语义，遗留去向为编排器已知上游问题。

两边共有（23）：

- `ShellTool compound syntax approval compatibility > bash: printf %s "$(probe() case value in (value) printf hello;; esac; probe)"`
- `ShellTool compound syntax approval compatibility > bash: probe() for value in a b; do printf %s "$value"; done; probe`
- `ShellTool compound syntax approval compatibility > zsh: for value ($(printf a)) do printf %s "$value"; done`
- `ShellTool compound syntax approval compatibility > zsh: for value (a b) printf %s "$value"`
- `ShellTool compound syntax approval compatibility > zsh: for value (a b) { printf %s "$value"; }`
- `ShellTool conditional process substitution > conditional substitutions respect always`
- `ShellTool conditional process substitution > conditional substitutions respect once`
- `ShellTool ordinary shell syntax > bash: ANSI-C quoting reuses existing approvals`
- `ShellTool ordinary shell syntax > bash: arithmetic statement reuses existing approvals`
- `ShellTool ordinary shell syntax > bash: function and case reuses existing approvals`
- `ShellTool ordinary shell syntax > bash: heredoc substitution reuses existing approvals`
- `ShellTool ordinary shell syntax > bash: loop with a conditional reuses existing approvals`
- `ShellTool ordinary shell syntax > bash: parameter fallback reuses existing approvals`
- `ShellTool ordinary shell syntax > bash: quoted heredoc reuses existing approvals`
- `ShellTool ordinary shell syntax > zsh: ANSI-C quoting reuses existing approvals`
- `ShellTool ordinary shell syntax > zsh: arithmetic statement reuses existing approvals`
- `ShellTool ordinary shell syntax > zsh: function and case reuses existing approvals`
- `ShellTool ordinary shell syntax > zsh: heredoc substitution reuses existing approvals`
- `ShellTool ordinary shell syntax > zsh: loop with a conditional reuses existing approvals`
- `ShellTool ordinary shell syntax > zsh: parameter fallback reuses existing approvals`
- `ShellTool ordinary shell syntax > zsh: quoted heredoc reuses existing approvals`
- `ShellTool scanner permissions > declarations reuse approvals while substitutions retain reject/once/always behavior`
- `ShellTool scanner permissions > pipeline redirect keeps the redirect target visible to exact approval and denial`

仅 HEAD：无（0）。仅 base：无（0）。新增五个 capture 例均 PASS。

### r8 静态检查与选择范围

- `bun typecheck`（ui-mac）exit 0；scoped `bunx --no-install oxlint packages/ui-mac/src/main/composer-tier-matrix.engine.cases.ts packages/ui-mac/src/main/engine-cases.scenario.test.ts` exit 0；`git diff --check` exit 0。
- 一次 wider-related 搜索 `rg -n 'composer-tier-matrix|engine-cases\.scenario' packages/ui-mac scripts --glob '*test.ts' --glob '*cases.ts'`，宿主枚举消费者为 `gate-file-registry.test.ts`；从 ui-mac 运行 `bun test --max-concurrency 2 src/main/gate-file-registry.test.ts` exit 0，25 pass / 0 fail。共享 helper 没有修改，无新增 mock/export 消费者要重跑。
- `affected-tests --list` exit 2：`No such file or directory: '<worktree>/.gate-tests'`，无 scope line；本轮不改被冻结的 gate 输入。新增病例仍在现有 scenario 宿主，常驻 nightly；literal imports / fixture URL 保持可追踪，没有把重例移到 PR。
- Alpha profile 的 `check_docs_contract.py.check_repo(..., changed_since='HEAD')` 返回本次 plan.md 0 finding；既有文档 finding 留原归属，不扩查/修复。

### r8 场景实施单元

- 代码单元合并原先三个编写单元的同一 case 模块/宿主计数（共享观察器需要完整接通）；本轮采用“场景与初步收据 / 无效 escape fixture 修正 / 最终移除臂收据”三个提交。没有增加文件、生产配置/接口、依赖、gate 或冻结决定；首提交填入⑤核对行。
- 引擎本身按模型选择 writer：非 GPT 列 edit/write、GPT 列 patch（Core `tool/plugin/patch.ts` 的既有 context hook）。AC-03 通过现成 `platformModels` fixture 提供 `gpt-fixture`，前两个 writer 后经原 `session.switchModel` 路由切换再调用 patch，未注入/替换 writer。三个阶段都核 duplicate keys 的实际原 RHS，最终接收端真实收到原值。独立命名检查 exit 0 / 1 pass（`/tmp/secrets-r8-writers-green.log`）。
- 原 R3 裸权限断言的 readonly 期望改为 allow，真实 read 的三档安全视图由新 AC-01 行负责；原 `/goal` 外读 build 从 ask 改 allow，对应 BR-05。readonly 的 read 包装错误只有 `Unable to read`，该旧观察器补查同一权限服务的具名 `external_directory` deny，再认定拒绝；没有把任意错误认作 deny。旧断言先红（`/tmp/secrets-r8-replaced.log`），修订后的 `/goal` 已单独 PASS（`/tmp/secrets-r8-input-green.log`）。
- 迭代证据：读三档 + 普通外读三档为 6 PASS；联合名单行、真实 SSH 为 2 PASS（`/tmp/secrets-r8-program-fix.log`，同批 AC-03 旧 fixture 断言红另行修正）；cat 与真实 AWS 格式行为为 2 PASS（`/tmp/secrets-r8-programs.log`）；capture 四相故障与 Code Mode 为 5 PASS（`/tmp/secrets-r8-closure.log`）。这些分次结果不冒充完整宿主结果；完整 48 行、一分钟与 1 MiB 及移除臂由后续收据记实际结果。

### r8 完整宿主与重例版本

`packages/ui-mac`：`gate slot -- bun test --max-concurrency 2 src/main/engine-cases.scenario.test.ts -t '三档 × R1'`（输入 `6e3ec00c81`），exit 1；child **47 pass / 1 fail / 48 tests / 778 expect**，99.99s，宿主 0 pass / 1 fail。唯一失败 `protected files invalid escape publishes streamed residue`；其余原 30 行及新增 17 行均 PASS，含真实 SSH、四相故障、Code Mode 和正常一分钟。日志 `/tmp/secrets-r8-host.log`。不把此命令写成通过。

1 MiB fixture 原先紧接 `ESC ]` 打印随机 UUID，UUID 的数字/CSI-final 开头可被现成 `stripAnsi` 当作有效 ANSI 前缀消费，因此即使完整原值已不存在也不一定出现 `[REDACTED]`。一次只读正常化探针输出 `bareUuidSurvives=false, invalidPrefixPreservesUuid=true`，确认是新 fixture 的输入前提不稳定；改为现有 `secret-stream.test.ts` 已使用的 `ESC ]xxx` 后再接 UUID。保护、输出及当前 flush 断言完全保留，未改生产 normalizer/matcher。按计划的新版本重例规则，只重验这一改变输入的 1 MiB 行；没有重跑代码未变、已经 PASS 的正常一分钟，也没有再次跑整宿主。最终用完整宿主 47 行证据 + 修正后具名行补齐，明确保留整宿主首跑 exit 1。

修正后 1 MiB：`gate slot -- bun test --max-concurrency 2 --timeout 90000 ./src/main/composer-tier-matrix.engine.cases.ts -t 'protected files invalid escape publishes streamed residue'`，exit 0，**1 pass / 0 fail / 18 expect**，5.76s；日志 `/tmp/secrets-r8-escape-green.log`。结合未改变的其它 47 行，48 个不同用例已通过；保留“整宿主首次检查不是 green”的验证限制。

### ⑤最终验收收据（r8，darwin-arm64）

已核：Codex / GPT-6 作者核对；没有新的设计决定、生产代码修正或文件范围扩张。第一个实现提交 `6e3ec00c81` 已填核对；fixture 修正 `d837106565`。本轮最终 diff 只有计划列出的三个文件；Core 基线对照及移除臂使用的临时源码改动全部恢复。

命令缩写（均从 ui-mac 运行）：

- **H**：`gate slot -- bun test --max-concurrency 2 src/main/engine-cases.scenario.test.ts -t '三档 × R1'`。exit 1；48 个子用例中 47 PASS、唯一无效 escape fixture 红；逐行事实如下。所有其它行没有改动；不以总命令 exit 1 否认其中已具名通过的行为，也不写成整宿主 green。
- **F**：`gate slot -- bun test --max-concurrency 2 --timeout 90000 ./src/main/composer-tier-matrix.engine.cases.ts -t 'protected files invalid escape publishes streamed residue'`。修正输入后 exit 0，1 PASS。H 的其它 47 行 + F 的这一行 = **48 个不同用例 PASS，其中新增 18 行**。正常一分钟只跑 H 一次。
- 额外低成本相关文件：`bun test --max-concurrency 2 src/main/gate-file-registry.test.ts` exit 0 / **25 PASS**；Core HEAD 整文件 **41 PASS**（同基线 23 红，见前节），不把 base 的 36 PASS 重复计入。

| AC / 新增行 | 命名证据（均前缀 `protected files`） | 命令 / 实际结果 |
| --- | --- | --- |
| AC-01 / 3 | `read build`、`read ask`、`read readonly`；两次真实分页、变量名/端口、模型/记录/卡片、Asked=0 | H（整体 exit 1，三行均 PASS）；原值可见反臂 exit 1 |
| AC-02 / 1 | `shell model records and card`；真 cat、最终 capture 文件/模型/记录/卡片 | H 该行 PASS；独立迭代同名行 PASS；原值可见反臂 exit 1 |
| AC-03 / 1 | `restored env reaches local receiver`；原 write/edit/patch、重复键两个原 RHS、loopback HTTP 收到真实值/原文件 | H 该行 PASS；独立同名命令 exit 0 / 1 PASS（writers-green.log） |
| AC-04 / 1 | `private key authenticates over SSH`；read/cat 不可见；实际临时 sshd 接受公钥，sftp 成功且 exit=0 | H 该行 PASS；独立迭代同名行 PASS；去 SSH 规则反臂原值可见 / exit 1。无机器前置项缺失，不碰 owner identity/config/agent |
| AC-05 / 3 | `ordinary outside read build/ask/readonly`；分别 allow / Asked=1 后拒绝 / 原拒绝 | H 三行 PASS；旧 `/goal` 第一轮路径同步为 build allow，ask/readonly 限制仍有具名检查 |
| AC-06 / 1 | `one rule reaches three consumers`；read 变量视图、工具普通结果、审批 risk `credential-path` | H 该行 PASS；临时只加 `vault.custom` 的联合正向臂 exit 0 / 1 PASS；分别移除 read/result/risk 的三臂均 exit 1 |
| AC-07 / 0 | 继承① `protected paths follow platform semantics` 及 Windows-case 移除臂（schema 当时 exit 0 / 6 PASS，移除臂 exit 1） | 本轮不重跑已接受的基础行；win32-x64 真机 AC-01/02/04 在 Windows 包发布时 pending，darwin 不代签 Windows IO |
| AC-08 / 4 | `capture failure start/chunk/end/io`；注入命中、进程副作用/exit=7、终态仅固定说明且 IO 无旧引用 | H 四行 PASS；独立该组 exit 0（连 Code Mode 共 5 PASS）；移除隐藏+原文 fallback 后原值可见 / exit 1 |
| AC-09 / 1 | `minute live output`；命令结束前卡片 pending、磁盘 capture 与 Shell.output 都已有安全输出；结束后记录/模型安全 | H 该行 PASS，正常 60 秒一次；延迟 publish 到 end 的变异版在 `live minute card` 前置观察失败 / exit 1，finally 中断，不再跑满一分钟 |
| AC-10 / 1 | `cloud fields keep ordinary values`；真实 AWS fixture 格式与 package.json；凭据遮盖而 `output = json`、region、数字、开关保留 | H 该行 PASS；整个 cloud 文件作为秘密的变异在 `output = json` 断言失败 / exit 1 |
| SC-02 / 1 | `Code Mode results errors and cancelled progress` | H 该行 PASS；独立 closure 组 exit 0；原 r5 SC-02 低层移除臂继承，不重跑不相关集 |
| v3.3 / 1 | `invalid escape publishes streamed residue`；1 MiB 未决段仅密文、无效序列在当前 flush 发布到实际文件/卡片 | H 原 fixture 红；F 修正为已有无效前缀后 exit 0 / 1 PASS，全部原断言保留 |

### ⑤一次性移除臂

脚本命令（repo 根）：`gate slot -- python3 /tmp/secrets-r8-arms.py` 与 `gate slot -- python3 /tmp/secrets-r8-arms-rest.py`。每一臂实际在 ui-mac 新进程运行 `bun test --max-concurrency 2 --timeout 90000 ./src/main/composer-tier-matrix.engine.cases.ts -t '<具名行>'`；记录包含命令、退出码、补丁及 SHA256、仅 boolean 的原值可见观察。没有产品开关/常驻变异框架。

- 首批材料 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-r8-arms-amvphkzm`。驱动 exit 1：前七臂符合预期，AC-08 第一种变异只回落了碰巧只有普通前缀的第一个 chunk，虽因缺说明变红，却没有出现原值，**不计作原文可见反证**。
- 修正的仅是一次性坏臂（故障后所有 chunk 走 raw fallback），后三臂材料 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-r8-arms-jigly7xe`，驱动 exit 0。未重跑此前已有效的七臂。两驱动 finally 都执行 scoped `git restore --worktree -- <这次修改的已提交源码>`，并逐字节比对 `RESTORED True`；首批真实失败、失败原因与 rawVisible=false 全部保留，不把无效对照隐去。

| 臂 | 具名行（前缀同上） | exit / PASS/FAIL | 反证事实 |
| --- | --- | --- | --- |
| ac01-no-env | read build | 1 / 0 / 1 | model 原值可见；控制输入显式 allow read，排除“只是未获批准” |
| ac02-no-mask | shell model records and card | 1 / 0 / 1 | 关 live 和通用结果遮盖后 model 原值可见 |
| ac04-no-ssh-rule | private key authenticates over SSH | 1 / 0 / 1 | model 测试私钥行可见 |
| ac06-new-name | one rule reaches three consumers | 0 / 1 / 0 | 只向发布家族加 vault.custom，read/result/risk 三处联合通过 |
| ac06-no-read | one rule reaches three consumers | 1 / 0 / 1 | 安全 read 视图说明不再出现；保留其它消费者 |
| ac06-no-result | one rule reaches three consumers | 1 / 0 / 1 | 普通工具回显的 model 原值可见 |
| ac06-no-risk | one rule reaches three consumers | 1 / 0 / 1 | credential-path 风险事实丢失 |
| ac08-raw-fallback（修正臂） | capture failure chunk | 1 / 0 / 1 | 故障确实命中、程序完成后 model 原值可见 |
| ac09-end-only | minute live output | 1 / 0 / 1 | 结束前 live minute card 观察超时，正向已先通过；不同变异代码一次 |
| ac10-whole-cloud | cloud fields keep ordinary values | 1 / 0 / 1 | output = json 普通值消失 |

有效结论：**9 个坏臂各 0 PASS / 1 FAIL（exit 1），新增文件名正向臂 1 PASS（exit 0）**。Core base/HEAD 比较没有 HEAD-only 红，故 r8 无生产修复提交。未跑 gate run/bin/check/其它宿主/包级全套，无 push/PR/merge，无依赖安装。遗留去向：既有 Core 23 红及 19 匿名超时由编排器按原上游条目处置；`.gate-tests` 缺失的 selector 输入仍由编排器治理；Windows 真机行归 win32-x64 发布验收；整宿主首跑非 green 的事实与组合验收证据交编排器评判。OPTIONAL：无新增项。

最终静态复核：scoped oxlint exit 0 / 0 warnings / 0 errors；ui-mac `bun typecheck` exit 0；`git diff --check` exit 0；以 `5511eceef3` 为 changed-since 的 Alpha 文档检查，plan.md 0 finding（其余 322 既有 finding 不属本轮）。实际宿主 7 行；与 `d837106565` 比较，所有临时修改的生产文件字节一致；没有残留本轮 node/sshd 进程。结束于 2026-11-26 11:17:34 UTC，本轮墙钟 35.9 分钟（含本机 slot 排队）；实际改动限三个计划文件。

## r9 R1 修复收据

依据：r9 IMPLEMENT(review fixes) 接受的发现 1–10；spec v4 / design v3.3 / SC-01、SC-02 不变。已核 Codex / GPT-6；开始 2026-11-26 11:45 UTC。每个缺陷先单独提交具名红例，再提交修复；所有新单元/文件系统/Node collector 例在原模块测试，属于原 fast/integration 选择路径；不新增全局 setup 或 gate。

- 1：`1864e5340d` 红：现实 HOME（无关深目录、Library/Keychains、真实 AWS/docker/kube writer 样本）在真实 Node collector 中记录 21 次不应发生的 stat/readdir（预期 0）。修复按首个 `**` 之前的路径前缀下降，keychain 来源锚定 Library/Keychains；`bun test --max-concurrency 2 src/secret-files.test.ts` exit 0 / 6 PASS，日志 `/tmp/secrets-r9-01-{red,green}.log`。
- 3（推断只确认一次）：真实宿主只读探针输出 `{"chromeOpen":true,"databaseExists":false,"readOnlySelect":"not-run"}`。指定 Default/Network/Cookies 不存在，无法确认 BUSY/LOCKED；按 r9 条件授权跳过 snapshot 恢复实现，不搜索其它 profile/读取 cookie 值，不启动 Chrome。编排器 snapshot 裁定只有确认该前提后才适用，Location fail-closed 不变。
- 2：红提交 `2c662eddfc`，官方 AWS CLI `output_single` 原字节（fixture/provenance 同提交）和现实 Node HOME 均因合法 exec args 失败，2 FAIL；修复静态 sequence scalar、flow sequence、anchor/alias/merge，按展开后的字段路径采集，不执行标签/插值。两个原测试文件完整 `bun test --max-concurrency 2 src/secret-values.test.ts src/secret-files.test.ts` exit 0 / 10 PASS。新 fixture 是本项明确要求的实际格式样本，作为必要输入落在既有 fixtures/provenance 路径；无依赖增加。日志 `/tmp/secrets-r9-02-{red,green}.log`。
- 4：红提交 `968e933753`，真实 Node 中 `.devcontainer/.env` captured=false（1 FAIL）；移除 Ext 的 matchesGlob 文件预筛选，候选与 realpath 归类只用 ProtectedFiles.match，目录只做保守 literal-prefix / 已发布 literal subtree 剪枝。完整 secret-files.test.ts exit 0 / 7 PASS，现实 HOME 仍 0 无关 stat/readdir；日志 `/tmp/secrets-r9-04-{red,green}.log`。初次实现对无关目录仍做 stat，被现实 HOME 例抓到；把 stat 放在 Schema 命中之后后通过，未改断言。
- 5：红提交 `83ba7fce31`，恢复两条原项目 agent 的 BlockedError/rule 断言，并新增递归 permission cause → toSessionError 的具名检查，3 FAIL（同过滤组另 4 PASS）。修复只保留权限类原因、实际 engine class prototype 与遮盖后的字段；普通 tool cause 仍丢弃，失败隐藏时保留 permission.rejected 身份但反馈为固定说明。原 secret-mask/plugin-host 文件完整 exit 0 / 61 PASS；日志 `/tmp/secrets-r9-05-{red,green}.log`。
- 6：红提交 `b53da325de`；通过真实 Node readFile 的暂停点固定时序，更新显式 ADC 文件后第二次 refresh 仍只得到旧扫描（1 FAIL）。增加 requested/completed generation；扫描期间到达的新调用等一次新扫描。完整 secret-files.test.ts exit 0 / 8 PASS，日志 `/tmp/secrets-r9-06-{red,green}.log`。初始项目 .env 实验被同一扫描的其它 source group 再采集掩盖，因此正式红例使用不在其它 root 内的显式 ADC 来源；没有靠延时重跑碰运气。
- 5 真引擎未解决：指定 `gate slot -- bun test --max-concurrency 2 --timeout 90000 ./src/main/unattended-run.engine.cases.ts -t 'AC-04 敏感文件'` 首次 exit 1 / 1 FAIL，仍把拒绝记成 ok（`/tmp/secrets-r9-unattended.log`）。只读类型/字段探针确认真实错误里确有 Tool.Error → Permission.BlockedError，未打印值，探针已恢复。补充红提交 `893faae19c` 钉住外层原生 ToolFailure 原型丢失（1 FAIL）；保留外层原型后 secret-mask.test.ts 10 PASS，但同一指定真引擎行仍 exit 1 / 1 FAIL（`/tmp/secrets-r9-unattended-green.log`，文件名不代表结果 green）。按“两次修正失败即交回”停止扩查第 5 项，低层修正与原断言保留；此项 PARTIAL，需编排器处置真实引擎错误分类边界，不能宣称自动化已修复。没有修改 Core/自动化实现来绕过。
- 7：红提交 `c44708d4be`，由真实 ssh-keygen fixture 的安全 read 行视图生成 writer 输入，write/edit/patch 三行 3 FAIL；回填按当前 RHS 的物理行数消费紧随的 k−1 个占位行，匹配视图保留原行槽。完整 secret-mutations.test.ts exit 0 / 8 PASS（`/tmp/secrets-r9-07-{red,green}.log`），原始文件的两个 writer 语义与 Patch 派生复用未改。
- 8：红提交 `2f9fc32b7e`，.ssh 根目录错误命中私钥 notice（1 FAIL）；match 要求非空相对路径。完整 Schema 文件 exit 0 / 7 PASS / 600 expect，darwin/win32 目录及实际私钥均断言。文件族旧样本 home/export.keychain 按已接受的第 1 项改为 Library/Keychains/export.keychain；这不是放松文件断言。日志 `/tmp/secrets-r9-08-{red,green}.log`。
- 9：红提交 `88f46840d3`，已知多行值只打印一行仍原样出现（1 FAIL）；secretScalar 对符合原值判定的文本同时登记整体与每个非空行，沿用原 matcher 的非空最小长度，不另加阈值。完整 secret-values/secret-mask 两文件 exit 0 / 15 PASS（`/tmp/secrets-r9-09-{red,green}.log`）。
- 10（retention）：红提交 `ce43591321`，替换 encrypted-store 后旧字节仍保留（1 FAIL）；按路径只保留最新不透明字节，替换/释放时旧数组置零，普通 env 凭据仍保留旧值；发布稳定的值快照供 matcher 缓存。完整 secret-files.test.ts exit 0 / 9 PASS，含相同快照引用、旧字节清零及 env retained union；日志 `/tmp/secrets-r9-10b-{red,green}.log`。
- 10（stream）：红提交 `d36f984fe2`，单 flush 内完整 ANSI 序列仍尝试建 spool，存储父目录不存在时 ENOENT（1 FAIL）。修复仅在未决 escape 跨 flush 时落密文；同 flush 在当前缓冲处理，跨帧仍逐帧释放。原 stream 文件完整 exit 0 / 5 PASS / 63 expect。compiled patterns 按稳定快照身份缓存；一次性真实源码计数探针 `bun /tmp/secrets-r9-patterns.ts` exit 0：相同快照三次 push 编译 before=3 / after=1，新快照 after=2 且新 token 仍遮盖。探针只在临时源码副本中给真实 TextDecoder 加局部计数，无产品开关/计时/容量测量，材料 `/tmp/secrets-r9-patterns.log` 与日志所列临时目录。
- 7 保留原能力的补充红提交 `9713c6f9b3`：紧凑的单行占位输入 replaceAll 漏掉真实多行值（1 FAIL）。匹配器按输入真实布局（line-slots / assignments，私有 typed domain 参数）选原样行槽或紧凑视图；不把完整视图作为写回新前置条件。完整 secret-mutations.test.ts exit 0 / 9 PASS；日志 `/tmp/secrets-r9-07b-{red,green}.log`。

### r9 提交与最终检查

| 发现 | 红例提交 → 修复提交 | 当前证据 |
| --- | --- | --- |
| 1 | 1864e5340d → 08d107f9d5 | 现实 Node HOME 21 次越界调用 → 0；collector 文件当前 9 PASS |
| 2 | 2c662eddfc → 5f6463aaf3 | EKS/YAML 与现实 HOME 2 FAIL → 10 PASS（当步两个文件） |
| 3 | 无代码提交 | Chrome open=true / 指定数据库不存在；前提未确认，条件修复跳过，不宣称浏览器无锁 |
| 4 | 968e933753 → 6c40108655 | Node dot-directory captured=false → true；当步 7 PASS |
| 5 | 83ba7fce31 → 70f0330dcd；893faae19c → 254349ed50 | 低层原因及原型红→绿；真实 unattended AC-04 始终 1 FAIL，仍为 PARTIAL |
| 6 | b53da325de → 3baef53c9b | refresh generation 红→绿；当步 8 PASS |
| 7 | c44708d4be → 001bec377c；9713c6f9b3 → fe63a79129 | 三 writer 行槽与紧凑 replaceAll 红→绿；当前 9 PASS |
| 8 | 2f9fc32b7e → abc8df17d5 | 根目录 notice 红→绿；Schema 7 PASS |
| 9 | 88f46840d3 → a467c695bb | 多行片段泄露红→绿；values/mask 15 PASS |
| 10 | ce43591321 → f8d4aff072；d36f984fe2 → 362afb21b2 | encrypted 最新字节与单 flush 无 spool 红→绿；collector 9 / stream 5 PASS；编译计数 3→1 |

- 一次 wider-related：按 literal import 搜索过滤掉无关的 `codepuppy-secret-files`（main 凭据写者）、只检查本轮真实消费者/枚举；`packages/ext` 执行 `bun test --max-concurrency 2 src/policy/register-policy.test.ts src/policy/risk.test.ts src/secret-read.test.ts src/secret-spool.test.ts src/plugin-host.test.ts`，exit 0 / **176 PASS**，日志 `/tmp/secrets-r9-related.log`。未跑重型 composer/minute/1 MiB、其它 scenario 或 Core 整文件。Schema/已改模块的最后一次完整文件收据合计 45 PASS，加此 176 = **221 个不同用例 PASS**；指定 unattended 行单独 FAIL，不混入通过数。
- 已改测试文件：`secret-files.test.ts`、`secret-values.test.ts`、`secret-mask.test.ts`、`secret-mutations.test.ts`、`secret-stream.test.ts`、`plugin-host.test.ts` 与 Schema `codepuppy-protected-files.test.ts`，均沿用原文件。`scripts/gate-files.tsv` 中实际注册的 plugin-host 仍 52 条（只恢复断言），其它新增条数所在模块未在该表登记，故不增加/改写 count 行或门的选择策略。
- `bun typecheck`：ext exit 0；schema exit 0 / 144 files；scoped oxlint 13 TS 文件 exit 0 / 0 warnings / 0 errors；ext `bun run build` exit 0。`git diff --check 1a13ddc9f9` 消除新测试的一处行尾空白后通过，不改断言。Alpha docs checker 仅本次 plan.md 0 finding。
- `affected-tests --list` exit 2：`No such file or directory: '<worktree>/.gate-tests'`，本基线没有 scope line；被冻结的 gate/.gate-tests 未改。
- 逐项落点以本节为唯一执行证据；额外文件仅第 2 项明确要求的真实格式样本 `fixtures/secret-files/kube-eks.yaml` 和既有 `provenance.json`。没有改 Core/SC 签名、依赖、生产配置、规则、其它仓库，未启动 app/Electron/窗口，无 push/PR/merge。
- 遗留去向：**发现 5** 按两次修正失败规则交编排器，具体红点 `unattended-run.engine.cases.ts:286`（expected failed / actual ok，env 首格即失败），需要编排器处置真实 engine 错误分类链路的下一步范围；不声称已证实必须改冻结接口。第 3 项前提未确认供编排器知悉；selector 缺输入按既有归属处理。其余没有新 OPTIONAL/ARCH 扩项。

## r10 发现 5：真实引擎错误身份定位与修复

依据：r10 IMPLEMENT(diagnosis + fix)；spec v4、design v3.3、SC-01/SC-02 不变。已核 Codex / GPT-6。文档影响为本计划的执行证据；不另建诊断报告。开始 2026-11-26 12:07:55 UTC，最终检查于 12:32 UTC，约 24 分钟（含本机 slot 排队）。

### 同命令 base/HEAD 与 bisect

两臂都在各自 `packages/ui-mac` 前台执行一次：

```sh
gate slot -- bun test --max-concurrency 2 --timeout 90000 ./src/main/unattended-run.engine.cases.ts -t 'AC-04 敏感文件'
```

| 输入 | exit / PASS / FAIL | 实际输出 |
| --- | --- | --- |
| base `f7424aa452` | 0 / 1 / 0 | 15 expect；env/subagent/outside 三格均通过 |
| 原 HEAD `989362d2b8` | 1 / 0 / 1 | 3 expect；env 首格 expected failed / actual ok |
| 修复后的同一行（增加落库分类断言） | 0 / 1 / 0 | 18 expect；三格均为 permission.rejected，运行 failed、原因与 status.json 一致 |

临时 detached worktree 独立安装锁定依赖；Core/Plugin/Schema workspace 链接的 canonical realpath 均在该副本内。两臂测试 SHA256 同为 `737fca59cfa76e9822ea89d10709ea306bab53515ad4819c9cc0ac49be7cc7b5`；锁文件、engine/sandbox helper、preload 与 bunfig 逐字节一致（comparison.json、input-parity.json、module-isolation.json）。安装后 hooksPath 恢复为 `.githooks`，无依赖/锁文件提交。

在临时 worktree 执行 `git bisect start 989362d2b8 f7424aa452`、`git bisect run python3 <evidence>/bisect-row.py`；驱动每步只以前述命令经 slot 运行这一行，并验证实际执行到具名测试。六步结果：`1a13ddc9f9` BAD、`793fdff5db` BAD、`9cd3861ca4` GOOD、`1af2389012` BAD、`dcaa1fc375` BAD、`82e96edcca` BAD。**首坏提交 `82e96edccac03557441247fee846fbb4809162ce`，直接父提交 `9cd3861ca46f2e1d860f5b24e959c6bad4e25a69` 通过**。没有 skip/装载失败冒充坏提交；bisect 已 reset，临时 worktree 已移除。

### 实际丢失边界与最小修正

临时源码探针仅输出类名、tag 与 instanceof 布尔值，不输出消息/值。`trace-display.log` 确认：Core 执行失败时原生 Tool.Error=true；进入 `policy/display.ts::attachTerminal` 时仍 true，但该模块 SDK 构造器与 Core 构造器不同。`new ToolError` 后原生身份变 false；内层 Permission.BlockedError 仍存在。后续 secret-mask 保留的是已经被换掉的外层原型；Core 的 `toSessionError` 无法用 instanceof 识别外层，未递归解包权限原因，落库为 unknown，自动化因而记 ok。这是 display 的第二处包装边界，非 Permission.BlockedError 字段缺失或 Session 判定规则错误。

修正仅在 display 的 attachTerminal/attachWriteDenied/attachNetFailure/attachUnattendedDenial 四处用输入错误自身的构造器重建，保留 cause、消息及既有 metadata 语义。临时修正探针中 Core AFTER nativeTool=true，Session 递归进入原生 Permission.BlockedError。SecretMask 的消息遮盖仍走原路径，现有 permission feedback 遮盖断言通过；不改 Core、自动化或冻结接口。

- 红例提交 `97a1fcf6b4`：原 display.test.ts 新增一个四种包装的 fast 表例（实际引擎 ToolFailure 子类）；指定 AC-04 scenario 行增加真实落库 `permission.rejected` 断言，宿主条数不变。`scripts/gate-files.tsv` 仅同步 display 7→8。前者 `0 PASS / 1 FAIL`，后者经 slot `0 PASS / 1 FAIL`，实际 unknown。依赖均由已有 literal import/helper 跟踪，不加全局 setup/声明；真实引擎行仍属 scenario，不扩大 PR 层。
- 夹具补齐提交 `39a9f070cf`：修复后单元例走到 network 分支时，显式 undefined 触发默认 bootstrap，造成 7 PASS / 1 FAIL（unpublished）。补齐已有参数的显式无代理输入 `""`，没有改断言；同一修正夹具在未修复临时 HEAD 再跑仍 `0 PASS / 1 FAIL`（display-fixture-red.log）。随后才提交生产修正，不把夹具装载错误计为行为反证。

### 本轮最终相关检查

| cwd / 命令 | exit / 结果 |
| --- | --- |
| ext：`bun test --max-concurrency 2 src/policy/display.test.ts` | 0 / 8 PASS，四处均保留实际构造器与 cause |
| ext：`bun test --max-concurrency 2 src/policy/unattended.test.ts src/policy/register-policy.test.ts src/plugin-host.test.ts src/secret-mask.test.ts` | 0 / 164 PASS；一次 wider-related，覆盖 display 消费者、策略与 masking 链 |
| ui-mac：上列 AC-04 单行 slot 命令 | 0 / 1 PASS，三个子场景 / 18 expect |
| ext、ui-mac：各自 `bun typecheck` | 均 0 |
| ext：`bun run build` | 0，扩展 bundle 成功；无 app/Electron 启动 |
| 根：`./node_modules/.bin/oxlint packages/ext/src/policy/display.ts packages/ext/src/policy/display.test.ts packages/ui-mac/src/main/unattended-run.engine.cases.ts` | 0 / 0 warnings / 0 errors |
| 根：`affected-tests --list` | 2 / 缺失 `<worktree>/.gate-tests`，本基线无 scope line；未改门或声明 |

修复后共 **173 个不同用例 PASS**，不把 base/bisect/诊断重复执行计入。命令、完整输出、bisect log 与仅身份布尔值的探针材料保留于 `/var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-r10-evidence-gtjvqs62`；主要绿/红检查另见 `/tmp/secrets-r10-{engine,display}-{red,green}.log` 与 `/tmp/secrets-r10-related.log`。诊断时一次 cwd 为根的调用未匹配到测试（exit 1 / 0 tests），纠正 cwd 后才采纳行结果，不计为回归或有效 bisect 步。

偏离：实际丢失边界是 display，因此新增授权内的 display.ts/display.test.ts 为修复文件，非继续猜测修改 secret-mask；原 AC-04 行只增强断言；registry 仅同步条数；无新依赖/公开导出/产品选项。最终 `git diff --check` 及本次 plan.md 文档检查通过。遗留去向：发现 5 已由本轮修复；既有 selector 输入缺失交编排器；发现 3 的已接受跳过不重开。OPTIONAL/ARCH：无新增项。

## r11 alpha 合并与宿主迁移收据

依据：r11 IMPLEMENT(integration) 明确授权 fetch + merge；spec v4、design v3.3、SC-01/SC-02 不变。已核 Codex / GPT-6。开始 2026-11-26 12:34:53 UTC，验证完成 12:45 UTC，约 10 分钟（含本机 slot 排队及场景运行 100.48 秒）。文档影响为本计划执行证据；未新增决定或发布状态。

`git fetch origin` exit 0；`git merge --no-edit origin/alpha` 按预期返回三处冲突。合并提交 **`233b29e2e0966d47231247a3ddc39210ecba8f98`**，两个父提交为本分支 `53f37b4187c553bc9881e3436e732855bf73dfa9` 和 fetch 所得 alpha `b0a9d0298d5da959e281b218c01d33249823a7f5`。未 rebase、push、开 PR 或 merge PR。

| 冲突文件 | 保留的两侧行为 / 落点 |
| --- | --- |
| `packages/ext/src/plugin.ts` | cleanup 同时保留 policy.dispose、reload unregister 与条件 network.watch cleanup；alpha 的整包技能装载、联网 context hook 与 network 参数照常保留 |
| `packages/ext/src/policy/index.ts` | display wrapper 同时接 network.run 并继续 secrets.wrap；after 中先消费 network.attachResult，有 notice 时不覆盖其网络归因，再做 display/安全 read/result/error masking；progress、审批 preview masking、finally externalRead.end 全部保留 |
| `packages/ui-mac/src/main/engine-cases.scenario.test.ts` | 接受 alpha 删除，不复活；`git log --follow` 与 alpha 中 composer-tier-matrix 引用定位到独立 `src/main/composer-tier-matrix.engine.scenario.test.ts`，在那里更新完整标题及 pass 30→48（原 30 + ⑤新增 18） |

未发现两侧同一行为相互排斥的语义冲突。自动合入的 display.ts 保留 r10 的四处原构造器重建，同时接 alpha 的联网执行 wrapper。

### 库存与计数

- 锁文件改变后执行根 `bun install --frozen-lockfile`，exit 0；实际 2 packages installed。随后恢复并读回 `core.hooksPath=.githooks`；最终 bun.lock 与 alpha 一致，没有额外依赖更改。
- 用原生成器 `bun packages/ext/scripts/context-injection-inventory.ts --write`，exit 0；结果为 99 fragments / 29843 injected bytes / 162304 declared limits，与自动合入快照一致。Ext build 同时生成当前工具 manifest。权威登记册是人工维护的源记录：将两条 composer 证明的名称机械同步为新宿主标题，没有改决定或新增 authority。
- 首次相关七文件运行 `212 PASS / 1 FAIL`：唯一红点是上述两条 proof 仍引用 30 条旧标题。同步后只重跑 authority-registry 原文件，`5 PASS / 0 FAIL`；其余已绿文件没有重复运行，最终 **213 个不同 Ext 用例 PASS**。
- 为取得逐文件登记数而不再执行已绿用例体，分别用 Bun 对原测试文件执行 `-t 'a^'`。三个命令都按无匹配约定 exit 1，明确输出 `matched 0 tests ... skipping 44/53/97 tests`；这是注册数探针，不计 PASS 或行为失败。它与七文件实际总数 213 一致：context-injection 44、plugin-host 53、register-policy 97、setup-order 1、network-egress 5、display 8、authority-registry 5。`scripts/gate-files.tsv` 的前两数已正确，register-policy 本票新增用例后的旧 69→实测 97 已同步；新独立场景宿主外层仍 1 条。

### 相关检查（全部前台结束）

| cwd / 命令 | exit / 输出 |
| --- | --- |
| ext：`bun test --max-concurrency 2 src/plugin-host.test.ts src/policy/register-policy.test.ts src/plugin-setup-order.test.ts src/network-egress.test.ts src/policy/display.test.ts src/context-injection.test.ts src/policy/authority-registry.test.ts` | 首跑 1 / 212 PASS + 1 stale-name FAIL；只修证据名称，未改断言 |
| ext：`bun test --max-concurrency 2 src/policy/authority-registry.test.ts` | 0 / 5 PASS；registry 红→绿，含 SC-01/SC-02 与迁移宿主引用；wider-related 的登记/枚举与实际 mock registerPolicy 的 setup-order 子进程已在上组覆盖 |
| ui-mac：`gate slot -- bun test --max-concurrency 2 --timeout 660000 ./src/main/composer-tier-matrix.engine.scenario.test.ts` | **0 / 外层 1 PASS、4 expect**；断言内层 exit 0、48 PASS、0 FAIL、恰好 1 文件；唯一一次整行运行，含 SSH 与一分钟行，100.48 秒 |
| ext、ui-mac：各自 `bun typecheck` | 均 0 |
| ext：`bun run build` | 0，扩展 bundle / manifest 成功，无 app/Electron 启动 |
| 根：scoped oxlint（plugin.ts、policy/index.ts、policy/display.ts、新 composer 宿主） | 0 / 0 warnings / 0 errors |
| 根：`affected-tests --list`（merge commit 后） | **0 / `affected tests: 138 of 714 test files`**；仅列出，未运行 PR gate；场景宿主不在 PR 选择中 |

完整命令输出位于 `/tmp/secrets-r11-{related,registry-green,host,install,inventory,ext-typecheck,ui-typecheck,build,lint,affected}.log`；计数探针与合并标识分别为 `/tmp/secrets-r11-counts.json`、`/tmp/secrets-r11-receipt.json`。本次 plan.md 文档合同检查与 `git diff --check` 通过。

偏离：除三处冲突外，仅对新宿主、自动合入登记册的两个证明名称、表中本票测试数做必要同步；库存按生成器重生，无手工改生成内容。旧 r10 selector 缺输入由本次 alpha 自带声明解决，当前 scope 正常；无未解冲突、新 ARCH/OPTIONAL 项。遗留去向：none；提交后的发布仍由编排器负责。

## r12 ship 所报八个新失败的归类与修复

依据：r12 IMPLEMENT；编排器已确认所列四文件在 alpha `b0a9d0298d` 通过。本轮从已有合并 HEAD `d6d46c2012` 开始，未 fetch/merge/rebase。spec v4、design v3.3、SC-01/SC-02 不变；已核 Codex / GPT-6。开始 2026-11-26 12:52:08 UTC，检查完成 13:16 UTC，约 24 分钟，包含多次本机 slot 排队。文档影响为本计划的执行证据。

四文件先分别在 ui-mac 用**完全相同的形式**复现：`gate slot -- bun test --max-concurrency 2 --timeout 90000 <file>`。每次只运行点名文件，四次均 exit 1，合计 99 PASS / 8 FAIL；未把这些失败归入 known-fails。

| 编排器所报测试 | 归类 | 原因与最小纠正（原断言保留） |
| --- | --- | --- |
| fixture-identity：每个夹具记下的引擎身份等于当前树 | c | 17 份样本仍记旧 Core/Plugin/Schema tree；用原采样器全量重采这 17 份样本，身份 guard 不变 |
| process-fence-write-sites：未登记的写盘调用点 = 0 | c | secret-mask 的 staging open/unlink 与 secret-spool 的 file open/unlink 漏登记；原生成器给出签名，四处全部落在既有 W4 |
| PermissionDialog：high 标题后恰有一个标签 | b | 测试还使用旧 ClassifyInput，补齐 design §4.1 必填的 protectedRoots；档位/位置/无说明句断言不变 |
| PermissionDialog：low 标题后恰有一个标签 | b | 同上；没有把 unknown 改成期望值来放行 |
| PermissionDialog：medium 标题后恰有一个标签 | b | 同上；没有改分类器的风险档位 |
| PermissionDialog：极高风险 + 数据外发说明句 | b + a | 补 roots 后仍 high/network-egress，确认共享 probe 漏认 `$HOME/.aws/credentials`；修 Schema probe，保留 critical/exfiltration 及中英说明句断言 |
| PermissionDialog：读屏名称 = 标题 + 档位 | b | roots 缺席原先让标签变为 unknown；只改夹具供数，原 aria-labelledby/高风险名称断言不变 |
| permission-risk：真分类器四档与外发 | b + a | 同时受 roots 供数与 HOME probe 两因影响；四档、仅 critical + exfiltration 才有 reason 的断言全部保留 |

b 的依据是 design §4.1 的明确接口变更：classifyPermissionRequest 新增必填 protectedRoots，permission/patterns/always/metadata 与结果维持旧契约；roots 来自可信宿主事实，没有分类器内部默认值。UI 两文件补的是固定的测试 Location 事实，不从审批 metadata 派生根。a 的依据是同节“其余规则与风险档位不变”：现有 curl 上传样本不能降成普通联网。没有改变产品审批卡、RiskTag、读屏或原因行的呈现代码。

### 红例、提交与生成物

- `7e65eb1a73`：用 `bun packages/ui-mac/scripts/process-fence-write-sites.ts --write` 发现四条 TODO（生成器按约定 exit 1），逐条填 W4。Core `shell.ts` 的 capture outputDir 位于 `<XDG_DATA_HOME>/opencode/shell/<project>`，safe staging/AES-GCM spool 都与之同目录；不增加可写根。保留原登记簿的人工注释，新增解释注释。随后 `--check` exit 0：64 条唯一登记与 67 个调用点一致。
- `21b7a1e41f`：两份 UI 测试补必填 roots。首轮复核由 Dialog 76 PASS / 5 FAIL 变为 80 PASS / 1 FAIL；permission-risk 仍 4 PASS / 1 FAIL，剩余两红明确为 HOME 凭据路径被判成 high/network-egress，未将其当作夹具可接受变化。
- `8c33372a7d`：在既有 Schema `one published rule reaches all rule consumers` 表例加入当前批准卡真实 curl 命令，覆盖 `$HOME`/`${HOME}` 和 darwin/win32 根；未修复代码上 0 PASS / 1 FAIL（probe 返回空）。
- `8fd5c1d1e6`：只在同一发布权威的词法 probe 中，去除既有 assignment/upload 前缀后，以可信 roots.home 展开开头 HOME/括号 HOME，再调用原 match；不执行插值，不改真实文件路径 normalize，不恢复第二张凭据正则表。Schema 原文件 7 PASS / 604 expect，现有 Ext risk 文件 23 PASS。
- `f9fd7667d3`：`gate slot -- bun packages/ui-mac/test-fixtures/engine-adapter-sampler/sample.ts` exit 0，采样器自行隔离 HOME/XDG、项目与 mock 服务，没有 app/Electron/窗口。最终 17 份 JSON 的 `_source` 为 `8fd5c1d1e6`，每个 `_engine.packages` tree 均逐项等于当前 HEAD。没有手工改身份或样本载荷。
- 一次先行重采（21b7a1e41f）与其消费者 162 PASS 已完成；之后发现 HOME 回归并提交 Schema 变化，按身份契约必须在新 tree 上重新采样，因此第二次采样及最终消费者验证有明确的新输入原因。先行绿证不冒充最终 tree 的证据，不因失败盲目重跑。

### 最终逐文件与直接相关验证

下列前四行均在全部代码修复后，分别以前述单文件 slot 命令完成，**每次 exit 0**。Schema 改动使前一组夹具身份失效后，身份文件与消费者重新以最终样本验证；没有重跑其它宿主、整层或整套测试。

| 文件（ui-mac cwd） | 初始复现 PASS / FAIL | 最终 PASS / FAIL |
| --- | --- | --- |
| `src/engine-adapter/fixture-identity.test.ts` | 4 / 1 | **5 / 0** |
| `src/main/process-fence-write-sites.test.ts` | 15 / 1 | **16 / 0** |
| `src/renderer/codepuppy-ui/PermissionDialog.test.ts` | 76 / 5 | **81 / 0**，657 expect |
| `src/renderer/codepuppy-ui/permission-risk.test.ts` | 4 / 1 | **5 / 0**，40 expect |

一次最终 wider-related：ui-mac 中 `gate slot -- bun test --max-concurrency 2 --timeout 90000` 后显式列出这 14 个 fixtures 的直接读取测试：engine-adapter 下的 command-reply、contract-cases、event-projection、failure-code、file-watcher、passthrough-reads、permission-reply、permission-shape、projection-parity、staged-attachment、todo-route、tool-display、tool-shapes、turn-diffs.test.ts；exit 0 / **162 PASS**。用 literal import 搜索确定集合，未把只在结构扫描中排除 fixtures 目录的 boundary.test.ts 算成消费者。加上 Schema 的 `bun test --max-concurrency 2 src/codepuppy-protected-files.test.ts`（7 PASS）和 Ext 的同形式 `src/policy/risk.test.ts`（23 PASS），本轮最终 **299 个不同用例 PASS**。

- `bun typecheck`：ui-mac exit 0；schema exit 0 / 144 files。Schema 两个改动文件 scoped oxlint exit 0 / 0 warnings / 0 errors。
- 手动对 UI 两测试的 scoped oxlint exit 1：PermissionDialog.test.ts:78、100 两处 Reflect.deleteProperty 命中限制；一次 `git show origin/alpha:<该文件>` 确认这两个原有调用同样存在，非新增行。未调查/修复此范围外事项，未放宽 lint，交编排器独立处置。
- 指定 NUL 步骤 `bash -c 'source scripts/docs-gates.sh; docs_gate_nul'` 在修复前、最终样本后均 exit 0：5761 个扫描文件零 NUL，跳过 1318 个已登记二进制、4 个非文本条目与 11248 个上游原样文件。现有允许机制是 assert-no-nul-bytes.py 的 BINARY_SUFFIXES/EXCLUDED_PREFIXES；本轮未复现待豁免文件，因此未新增豁免、未禁用检查。
- 最终代码/样本提交后 `affected-tests --list` exit 0：**`affected tests: 155 of 714 test files`**。只列出；未运行 gate run/bin/check/整套或整层。
- 证据：`/tmp/secrets-r12-{fixture-identity,write-sites,permission-dialog,permission-risk}-red.log`；最终 `/tmp/secrets-r12-{fixture-identity,write-sites,permission-dialog,permission-risk}-final.log`；`sample-final.log`、`fixture-consumers-final.log`、`probe-{red,green}.log`、`risk-classifier.log`、`ledger-{generate,check}.log`、`nul-final.log`、`affected.log` 均带同一 secrets-r12 前缀。聚合事实 `/tmp/secrets-r12-receipt.json`；本次 plan.md 文档合同与 git diff --check 通过。

偏离：必要的同调用链改动是 Schema probe 与其原测试；另外 17 个文件均为原生成器产生的夹具，不能只改 hash 欺骗身份 guard。UI 没有删/弱化测试或修改呈现规则；测试条数不变，无需改 gate-files 计数。本轮未改 known-fails.tsv、.gate-tests、检测规则/阈值/地板、冻结设计、依赖或其它仓库，无 push/PR/merge/rebase。遗留去向：八个指定失败全部消除；原有两处 Reflect lint 交编排器独立处理。ARCH/OPTIONAL：无新增项。

## r13 视频 alpha 合并与重新采样收据

依据：r13 IMPLEMENT(integration) 授权 fetch + merge；spec v4、design v3.3、SC-01/SC-02 不变。已核 Codex / GPT-6。开始 2026-11-26 13:20:02 UTC，验证于 13:31 UTC 完成，约 11 分钟，包含本机 slot 排队；未扩大到视频功能验收或整门。文档影响为模块地图事实合并与本计划执行证据。

`git fetch origin` exit 0，取得视频已合入的 `2142240b16b1a5516ba841d75e751fdf93f54607`。`git merge --no-edit origin/alpha` 产生题述冲突；合并提交 **`10abacd95b84171ca91d0b76a6c1cd66f43fc219`**，两父为 `d23e8b0c7c73d12964dda2b2bb10666cc120f16a` 与该 alpha。没有 rebase 或再次改写冻结接口。

| 冲突 | 具体取舍与验证 |
| --- | --- |
| `docs/architecture/modules.md` | 保留 alpha 对 docs/effect-drizzle-sqlite/effect-sqlite-node/enterprise 的历史入口更正；Ext 行保留本票十个秘密模块链接；Schema 行同时保留视频 progress/frame authority 说明和保护名单链接。没有删任一模块的已知职责 |
| `packages/ext/src/plugin-setup-order.cases.ts` | mock 同时返回 dispose 与 videoToolFacts；原两条用例、registerPolicy 最先/seal 最后、项目 fan-out 位置与最终 disposePolicy 断言全部保留 |
| `packages/ext/src/policy/index.ts` | PolicyRegistration 与实际返回值同时保留 dispose、videoToolFacts、factsFor。视频消费同一工具事实权威；秘密事务、shell.capture、progress/preview/result/error/read 遮盖与终态清理仍按原路径运行。没有改两者的判定规则 |
| 17 份 `engine-adapter/fixtures/*.json` | 只对实际冲突的 17 路径用 scoped git restore 选择 HEAD 作为中间输入，未覆盖 alpha 新增的其它文件；合并后再由原采样器全部重采，未手工改 JSON |

这些冲突均为相邻的新增字段/说明，不是同一行为的相反决定；未发现需设计裁定的语义冲突。自动合入的 plugin.ts 视频接线继续调用 policy 的两个事实入口，cleanup 继续保留本票 dispose。

### 依赖、生成物与计数

- bun.lock 改变后在根执行 `bun install --frozen-lockfile`，exit 0 / 5 packages installed。输出报告 1 个 postinstall 被现有 Bun trust 策略阻止；只读查看 untrusted 列表，没有运行 trust 或改变策略。所需采样、编译和测试均实际完成。安装后恢复并读回 hooksPath `.githooks`；没有手工改依赖/锁文件。
- 原生成器 `bun packages/ext/scripts/context-injection-inventory.ts --write` exit 0：**106 fragments / 31040 injected bytes / 169472 declared limits**。生成结果与自动合入快照一致；Ext `bun run build` 同时生成 bundle/工具 manifest，exit 0。其余合并触及的模块地图和 gate-files 为原有人工源登记，没有另造生成器。
- 对 merge-base `e3a15f2432`、本分支 `d23e8b0c7c`、alpha `2142240b16` 的 gate-files 按 package/file 键比对，**两侧同时改过的行交集为空**（`/tmp/secrets-r13-count-intersection.json`）；没有新增测试或手改计数。实际测量仍保留：setup-order 外层 1 / 内层 2、register-policy 97、plugin-host 53、context-injection 44。JUnit 顶层九文件共 258，未把嵌套 suite 重复求和。
- 重采命令：根 `gate slot -- bun packages/ui-mac/test-fixtures/engine-adapter-sampler/sample.ts`，exit 0。独立 HOME/XDG、临时项目与 mock 服务，由采样器原 finally 清理；没有 app/Electron/窗口。逐份检查 17 个 JSON：`_source` 均为合并提交 **10abacd95b**，每个 `_engine.packages` tree 等于合并后的 HEAD。生成物提交 **`beb7052f42`**；不以覆盖身份或选择某一侧旧样本代替实际重采。

### 一次相关验证

所有下表测试均通过 `gate slot -- bun test --max-concurrency 2 --timeout 90000` 执行；r12 四文件各自独立运行一次，没有同一代码的盲目重跑。

| package / 点名文件 | exit / 结果 |
| --- | --- |
| ext：plugin-host、policy/register-policy、plugin-setup-order、video-understanding、cloud-vision、context-injection、policy/authority-registry、policy/risk、policy/display.test.ts（显式九文件列表） | **0 / 258 PASS**；逐文件 53/97/1/2/25/44/5/23/8；视频 frame projection、MCP verification、事务清理和既有权限链均在原文件内验证 |
| ui-mac：`src/engine-adapter/fixture-identity.test.ts` | **0 / 5 PASS**，最终合并树身份 |
| ui-mac：`src/main/process-fence-write-sites.test.ts` | **0 / 16 PASS**，r12 W4 登记与新闭包一致 |
| ui-mac：`src/renderer/codepuppy-ui/PermissionDialog.test.ts` | **0 / 81 PASS**，657 expect，风险标签/外发说明/ARIA 原断言不变 |
| ui-mac：`src/renderer/codepuppy-ui/permission-risk.test.ts` | **0 / 5 PASS**，40 expect，四档与外发保持 |
| schema：`src/codepuppy-protected-files.test.ts` | **0 / 7 PASS**，604 expect，含 HOME 与 Windows 形态 |
| ui-mac：r12 点名的 14 个夹具直接读取文件（同 command-reply 至 turn-diffs 显式列表） | **0 / 163 PASS**；对新样本做一次 wider-related，实际数以本轮 JUnit 为准 |

本轮共 **535 个不同用例 PASS**。Ext 与 fixture 消费者同时保存 JUnit（`/tmp/secrets-r13-ext.xml`、`/tmp/secrets-r13-fixture-consumers.xml`），setup-order 的 2 条子用例由原宿主精确计数，不另重复运行。`bun typecheck`：ext、ui-mac 均 exit 0；schema exit 0 / 145 files。scoped oxlint 仅本轮解决的 setup-order.cases.ts / policy/index.ts，exit 0 / 0 warnings / 0 errors。

合并/样本提交后 `affected-tests --list` exit 0：**`affected tests: 157 of 736 test files`**，只列出，没有 gate run/bin/check/整套或整层。以新 alpha 为基准的 git diff --check exit 0；本次 modules.md、plan.md 文档合同检查通过。

观察与去向：对旧 first-parent 的 staged diff --check 会报 alpha 自带的 `resources/video-runtime/licenses/leptonica.txt:26`、`src/shared/project-artifact-path.ts:104` 两处 EOF 空行；一次与 origin/alpha 的逐文件 diff 为空，未改这些源资产，供编排器按 alpha 既有事项处置。安装的 trust 提示保留原日志，不擅改策略。本轮无新 ARCH/OPTIONAL，未解冲突为零。

证据统一前缀 `/tmp/secrets-r13-`：sample、ext-tests、fixture-identity、fixture-consumers、write-sites、permission-dialog、permission-risk、protected-files、ext-typecheck、ui-typecheck、schema-typecheck、install、inventory、build、lint、affected.log；聚合标识与计数 `receipt.json`。偏离仅为本次明确授权的合并解决、原生成器重采与事实/登记校验；没有新设计、依赖选择、检测规则/阈值或产品行为改动。未 push/开 PR/merge PR，发布仍由编排器负责。

## r14 旧名双向登记与两处精确条数同步

依据：r14 指定 gate4.log，起始树 `dd9a6d99bf`；spec v4、design v3.3 不变。已核 Codex / GPT-6。开始 2026-11-26 13:40:59 UTC，验证完成约 13:59 UTC，约 18 分钟，主要等待本机两项 ship 的 slot。登记修正提交 **`59433425af`**；没有改生产代码、测试代码、生成夹具或检测规则。

| 指定失败项 | 归类 | 实测事实与纠正 |
| --- | --- | --- |
| old-name 方向 A | c | 原 shared OLD_NAME/hitTokens 实测 events.json 中当前 secrets worktree 的 CLI 路径 21 行；按原登记约定记为 **user-content**，理由说明是真实原采样器事件路径、非产品品牌，保留生成 JSON |
| old-name 方向 B | c | 旧 video worktree CLI 路径登记 21、实际 0；删除其失效键，由当前实测键替代。只换一行，没有扩大范围豁免 |
| policy/risk 精确数 23≠22 | c | 用例 **protected path risk consumes the location roots** 是本分支 **793fdff5db** 有意新增（共享名单/Location 根、排除与 Windows 显式凭据路径，AC-06/07、design §4.1）；同步 22→23，并更新该行当前说明 |
| config-injection 精确数 29≠28 | c | 用例 **interactive env read rules preserve automation denies** 是本分支 **a58ad3042e** 有意新增（交互安全读取与自动化拒绝同时保留，AC-01、design §4.4）；同步 28→29，登记用例名称、来源和理由 |

来源确认使用两文件相对 origin/alpha 的 diff、`git log -S '<原用例名>' -- <file>` 与该提交的实际改动；两来源提交均不在 origin/alpha 祖先链，两个新增用例也只在本分支 diff 中，非 alpha 带入的重复计数。没有为过门删除用例、改断言或使用下界。

逐文件先复现、更新后各完整复核一次，均从对应 package 执行 `gate slot -- bun test --max-concurrency 2 --timeout 90000 <file>`（附 JUnit reporter，仅记录结果）：

| 文件 | 修正前 exit / PASS / FAIL | 最终 exit / PASS / FAIL |
| --- | --- | --- |
| ui-mac `src/main/old-name-scan.test.ts` | 1 / 8 / 2（方向 A/B） | **0 / 10 / 0**，原自检、双向与反例全部保留 |
| ext `src/policy/risk.test.ts` | 0 / 23 / 0，实际数超旧登记 | **0 / 23 / 0** |
| ui-mac `src/main/codepuppy-config-injection.test.ts` | 0 / 29 / 0，实际数超旧登记 | **0 / 29 / 0** |
| ui-mac `src/main/gate-file-registry.test.ts`（唯一额外直接消费者） | 不重复做前置测量 | **0 / 25 / 0** |

本轮最终 **87 个不同用例 PASS**。同一原 gate-files 检查入口亦有红→绿证据：`CODEPUPPY_TEST_FILES=/tmp/secrets-r14-selected-tests bash scripts/assert-gate-files.sh --from-reports <报告目录>`，红时明确报 29≠28、23≠22（exit 1），最终四行严格等号全部通过（exit 0）：29=29、97=97、23=23、8=8。范围是本次两行加本分支已有两条改动登记行；没有运行全表 --update（该模式会逐条跑整个登记簿）。

报告诚实性：本轮 risk/config 均有新产生的原始 JUnit；原 gate 入口还要求校验已有改行 register-policy/display，复用 **r13 原始完整 Ext JUnit**，其源码从 10abacd95b 至本轮未变（git diff 校验）。报告不改写、不伪造，当前两文件复测数也与之相同；97/8 的复用结果不计入本轮 87。最终计数入口采用该真实 Ext 报告与本轮 config 报告，读取计数，不再执行额外测试。

只读 `affected-tests --list` exit 0：**`affected tests: 157 of 736 test files`**。两份 TSV 数据以实际 guard 检验，没有适用的生产 TS typecheck/lint 变化；没有重复 r13 已通过的包级检查。git diff --check 与本次 plan.md 文档合同通过，hooksPath 仍 `.githooks`。

证据：原日志 `~/.cache/alpha-orch/2026-11-26/review/1758-gate4.log`；本轮 `/tmp/secrets-r14-{old-name,risk,config}-{red,green}.log`、`name-counts.json`、`gate-counts-{red,green,final}.log`、`registry-consumer.log`、`affected.log`、`receipt.json` 与 `reports-{red,green}/`。偏离仅为按限定范围使用原检查入口代替全表 --update；没有新选项、判据副本、豁免类型、known-fails 或门槛改动，无 fetch/merge/rebase/push/PR。指定四个失败项已消除，遗留去向 none；无新增 ARCH/OPTIONAL。

## r15 文档 alpha 合并与采样收据

依据：r15 授权 fetch + merge origin/alpha；spec v4、design v3.3 与 SC-01/SC-02 不变。已核 Codex / GPT-6。开始 2026-11-26 14:03:18 UTC，验证于 14:16 UTC 完成，约 13 分钟（含 slot 排队）。本轮文档影响仅本计划的执行证据。

- `git fetch origin` exit 0；合并提交 **`e9e073fa0265d156918071cfcee1bce2cc3ce466`**，两父为 `94440d23f4`、文档 alpha **`510b573c702ca68f29143d12182f5455cfe67797`**。没有 rebase。只有题述 TSV 与 17 份 JSON 发生文本冲突；其余源码自动合并，没有发现相反的行为决定。
- `scripts/old-name-exceptions.tsv` 合并时保留两侧行；采样后使用原 `OLD_NAME` / `hitTokens` 实测，当前 secrets worktree 的 CLI 路径仍有 **21** 行命中，保留原 user-content 登记；文档 worktree CLI 路径命中 **0**，只删除该失效登记行，其余两侧行保留。没有改扫描规则或新增豁免类型。
- 只对实际冲突的 17 个 fixture 路径用 scoped git restore 选择 HEAD 作为中间输入；合并提交之后运行原采样器 **`gate slot -- bun packages/ui-mac/test-fixtures/engine-adapter-sampler/sample.ts`**，exit 0。17 份 JSON 均由采样器生成，逐份检查 `_source` 为 **e9e073fa02**、`_engine.packages` tree 等于合并后 HEAD；没有手工编辑 JSON。采样使用原有隔离 HOME/XDG、临时项目与 mock 服务，没有启动 app/Electron/窗口。生成物与失效行修正提交 **`65cf73bc08`**。
- bun.lock 改变后 `bun install --frozen-lockfile` exit 0：Checked 2178 installs across 2587 packages (no changes)；安装后恢复并读回 `core.hooksPath = .githooks`。未手改依赖与锁文件。
- 原 inventory 生成器 `bun packages/ext/scripts/context-injection-inventory.ts --write` exit 0：**107 fragments / 31743 injected bytes / 170496 limits**，结果与自动合入快照相同。`bun packages/ui-mac/scripts/process-fence-write-sites.ts --check` exit 0：**66 unique rows / 69 call sites**。Ext `bun run build` exit 0。
- 对 merge-base `2142240b16`、本分支 `94440d23f4`、alpha `510b573c70` 的 gate-files 按键比较，**两侧同时改变的计数行交集为空**，没有新增测试用例或改计数；未运行逐条执行全表的更新模式。

所有下列测试从 `packages/ui-mac` 经 `gate slot -- bun test --max-concurrency 2 --timeout 90000 <显式文件>` 各运行一次，日志均为 0 fail：

| 点名文件 | PASS / FAIL |
| --- | --- |
| `src/main/old-name-scan.test.ts` | **10 / 0**，2487 expect；双向登记均通过 |
| `src/engine-adapter/fixture-identity.test.ts` | **5 / 0**，16 expect |
| 直接夹具消费者 14 文件：command-reply、contract-cases、event-projection、failure-code、file-watcher、passthrough-reads、permission-reply、permission-shape、projection-parity、staged-attachment、todo-route、tool-display、tool-shapes、turn-diffs.test.ts | **163 / 0**，517 expect；JUnit 顶层 tests=163 / failures=0 |

本轮共 **178 个不同用例 PASS**。`bun typecheck` 从 ext、ui-mac、schema 各自目录执行，均 exit 0（schema 145 files）；没有额外整层或整套测试。`affected-tests --list` exit 0：**`affected tests: 162 of 746 test files`**，只列范围。相对 origin/alpha 的 `git diff --check` exit 0，本计划文档合同检查通过。

证据统一前缀 `/tmp/secrets-r15-`：install、inventory、write-ledger、build、sample、old-name、fixture-identity、fixture-consumers、ext-typecheck、ui-typecheck、schema-typecheck、affected.log；消费者原 JUnit 为 `fixture-consumers.xml`；`name-counts.json`、`name-deltas.json`、`count-intersection.json`、`receipt.json` 记录实测事实。无未解冲突、生产行为变更或新设计决定；没有修改 known-fails、门槛、.gate-tests，无 push/PR/merge PR。偏离仅为题述授权的合并、采样与失效登记同步；遗留去向 none；无新增 ARCH/OPTIONAL。

## ⑥ 规格 v5：项目外读到的名单文件、env 只遮凭据字段

- 依据：[规格 v5](spec.md) @ `5d56d0cae1`：BR-05、BR-06 的 v5 句与 AC-11、AC-12（来源：协调仓安全意图 U-43，owner 2026-11-27「intent 全部按照你的建议。」对 I-50、I-51 的批准）；[冻结设计](design.md) v3.3 §4.1、§4.3、§4.4、§4.5 的入口与契约不改签名；#1758。代码基线 `88c88edcee`（origin/alpha，含已合入的 `6a55937acd`）。继承 ①..⑤ 与 r9..r15 收据，不重审已定范围。
- 核对：2026-11-27 编排器（Claude Opus 5.5）核对：规格 v5 与本节通过（没有新增用户限制；全部批准档读项目外 `.env` 不再出卡、项目外 `.pem` 只给说明，均属 U-43「同一规则」）；另要求一项修正：值里内嵌的连接地址密码属凭据字段，见下文「⑥ 核对修正」。

### 改动

| 文件 | 改什么 |
| --- | --- |
| `packages/schema/src/codepuppy-protected-files.ts` | `match` 在既有定位规则之后，对项目外路径再用同一份项目规则判定（项目文件名规则；项目固定位置加 `**/` 前缀；同一示例排除与依赖树剪枝；以该路径的文件系统根为根），规则 ID 不变。`sources` 不含这一范围，即不扫描；`probe` 经 `match` 同时认它。`CredentialFields.env` 由 `assignments: "all"` 改为与 credential-document 相同的 `names: "credential"`。 |
| `packages/schema/src/codepuppy-protected-files.test.ts` | 新增项目外判定表例（darwin/win32、示例与依赖排除、私钥与 rails 位置、sources 不选、probe 命中）；`published sources and probes share exclusions` 中编码旧行为的 `/fixture/project-copy/.env` 样本移入新表例；凭据字段表例的 env 断言改为 names。 |
| `packages/ext/src/secret-files.ts`、`secret-files.test.ts` | `createSecretFiles` 增加 `track(file)`：读文件工具读过的名单文件此后每次 refresh 与来源一起 stat/采集，沿用同一版本缓存与缺失/不可读重试，不对其目录 readdir；dispose 清空。测试在现实 HOME 中加另一项目的 `.env`：未读前不采集且无关 stat/readdir 为 0；track 后采集到，其目录仍无 readdir。 |
| `packages/ext/src/secret-values.ts`、`secret-values.test.ts` | 新增 `envSecret(record)`（`isCredentialName` 且非公开值，即 `CredentialFields.env` 的 names 选择）；env 采集只收凭据名变量的值。表例：`DB_HOST=db`、`PORT`、`API_KEY`、`PASSWORD=1234`。 |
| `packages/ext/src/secret-read.ts`、`secret-read.test.ts` | `projectEnvRows` 用 `envSecret` 决定原样或遮盖（read 视图与 diff 投影共用）；表例 `DB_HOST=db` 原样、`API_KEY` 遮盖。 |
| `packages/ext/src/secret-mask.ts`、`secret-mask.test.ts` | `read` 先 `track` 本次名单文件；错误中恢复 env 片段的判定改用 `envSecret`。测试里以非凭据名充当秘密的旧样本（`NEW=`）改为凭据名。 |
| `packages/ext/src/policy/register-policy.test.ts` | 两条接线例：全部批准档读隔离 HOME 下另一项目的 `.env` 零询问、得安全视图，之后文件改写为新值，真 shell `cat` 与批准预览都遮盖；项目 `.env` 的 `DB_HOST=db` 与 `API_KEY` 经 read 与 shell 输出（含 `mongodb`）只遮后者。 |
| `packages/ext/src/policy/risk.test.ts` | `protected path risk consumes the location roots` 中「项目外 `.env` 不标凭据路径」的旧断言改为标注，另以项目外普通文件保留未标注对照；条数不变。 |
| `packages/ui-mac/src/main/composer-tier-matrix.engine.cases.ts`、`composer-tier-matrix.engine.scenario.test.ts`、`docs/architecture/codepuppy-authority-registry.json` | 场景层新增 AC-11、AC-12 两行真引擎；`protected files read` 行里以非凭据名充当秘密的长值/多行样本改为凭据名（该行原意是这两类秘密跨页不漏）；宿主标题与条数 48→50，登记册两处同名证明机械同步。 |
| `scripts/gate-files.tsv` | register-policy 精确条数 97→99。 |
| 本 `plan.md` | 本节、核对与收据。 |

`secret-mutations.ts`、`secret-diff.ts` 不改：写回经 `resolveProtectedFile`，随 `match` 覆盖项目外 env；diff 经 `projectEnvRows`。

### 顺序

1. **I-50 红例提交**：Schema 表例、secret-files 现实 HOME 例、register-policy 项目外读例，在未修改的实现上各自 FAIL，记录输出。
2. **I-50 修复提交**：Schema `match`、`track`、SecretMask.read 调用；同提交改编码旧行为的两处断言（Schema 排除表、risk 表）。结束时完整跑 Schema 测试文件、secret-files、secret-mask、register-policy、risk 各一次。
3. **I-51 红例提交**：secret-values、secret-read、register-policy 的短值例，在未修改的实现上 FAIL。
4. **I-51 修复提交**：`CredentialFields.env`、`envSecret` 及三处消费；同提交改编码「env 每个值都是秘密」的旧样本（secret-files 的 env helper、secret-mask 的 `NEW=`、Schema 凭据字段的 env 断言）。结束时完整跑 secret-values/read/diff/mutations/mask/files 与 register-policy。
5. **场景提交**：两行真引擎、旧样本改名、计数与登记同步；经 `gate slot --` 只跑 `protected files` 各行一次；authority-registry 原文件一次。
6. 返回前一次扩大相关集：按 grep 找 ProtectedFiles、classifyPermissionRequest、secret-values/secret-mask 的消费者与枚举者（ui-mac PermissionDialog、permission-risk，ext plugin-host 等）各跑一次；各包 `bun typecheck`、改动 TS 的 oxlint、`affected-tests --list`。移除臂（Schema 项目外判定、`track`、`envSecret` 三处）在工作树临时改写、跑对应具名例、`git restore` 恢复。

### 风险

- 项目外判定经 `match` 进入所有消费者：风险标注、结果里的 `file:` 引用、写回恢复，以及来源扫描在家目录等已有来源里遇到的同名文件。这是「同一规则」的应有结果；Schema 表例钉住 `sources` 不含该范围，现实 HOME 例钉住不发生全盘扫描。项目规则里的 `*.pem` 等也随之适用于项目外（例如读系统证书目录下的 `.pem` 只得到说明），与项目内一致，在返回中列出。
- 档位：项目外 env 仍走原读工具的目录询问/拒绝（BR-05 v5 原文）；项目外的非 env 名单文件与家目录同类文件一样前置说明。不改权限规则。
- I-51 使 `.env` 里名字不像凭据的变量的值可见，包括连接地址里嵌的密码（如 `DATABASE_URL`）。按 U-43 实施，不另加 URL 解析；作为意图回流项返回。
- 场景行依赖嵌入式真引擎，较重，只在第 5 步经 slot 跑一次。

### 证明

| AC | 测试/证据 | 层与运行时机 | 缺少行为为什么会失败 |
| --- | --- | --- | --- |
| AC-11 | Schema `outside project files follow the published project rules`；secret-files `outside protected files are tracked without scanning a realistic home`；register-policy `outside project protected reads keep later outputs masked`；场景 `protected files outside project read shell and card` | fast；integration（受影响 PR 与夜间）；scenario（夜间，本次经 slot 一次） | 去掉项目外判定：read 返回原值，shell 与预览出现值；去掉 `track`：读后改写的新值在 shell 中出现；改成扫描实现：现实 HOME 的无关调用不为 0 |
| AC-12 | secret-values `env files collect only credential-named values`；secret-read `env read view keeps ordinary values visible`；register-policy `env files mask only credential-named values`；场景 `protected files ordinary env values stay visible` | fast 性质的模块例与 integration；scenario（夜间，本次经 slot 一次） | 恢复「每个值都是秘密」：`db` 进入采集集合，read 视图与 shell 输出里的 `db`、`mongodb` 中的 db 变成遮盖符 |

### 偏离记录

2026-11-27 · 冻结设计 v3.3 有三处正文与规格 v5 不一致，需要设计方出 v3.4 增量（入口签名不变）：§4.1「match、sources、probe 消费相同范围」——v5 起 `match`/`probe` 另含项目外按项目规则的判定，`sources` 不含；§4.1 env 行与「env 保留每个值默认是秘密」「env 的其它非空值仍默认是秘密」——v5 起 env 只取凭据名字段；§4.3「按名单 profile 读取项目/主目录」——另含读文件工具读过的项目外名单文件。本节按规格 v5 实施，未改设计文档。

2026-11-27 · 追加必要范围：Schema 改动使 17 份 engine-adapter 夹具的引擎身份失效（fixture-identity 4 pass / 1 fail），按 r12 先例用原采样器重采（`73fad5bf77`）；`events.json` 记录本工作树的 CLI 路径，`scripts/old-name-exceptions.tsv` 里旧工作树的失效键换为当前实测键（21 行、user-content 不变）。其余文件与顺序同本节。

### ⑥ 实施收据

- 已核：Claude Opus 5.5 作者自查；开始 2026-11-27 09:28 CST，检查完成约 09:58 CST。提交：规格 `5d56d0cae1`、计划 `c13977efab`；I-50 红 `5b8927b790` → 修 `1ef55f26f9`；I-51 红 `def84a4b33` → 修 `165c027d24`；场景与计数 `e1c8e7e046`；夹具重采 `73fad5bf77`。红例提交后未改其断言。
- 红例（未修改实现）：Schema `outside project files follow the published project rules` 0/1（`/fixture/other/.env` 未命中）；secret-files `outside protected files are tracked without scanning a realistic home` 0/1；register-policy `outside project protected reads keep later outputs masked` 0/1（读结果含原值）；secret-values `env files collect only credential-named values` 0/1（多出 db、us-east-1）；secret-read `env read view keeps ordinary values visible` 0/1；register-policy `env files mask only credential-named values` 0/1。secret-read 红例在提交前修正了自身预期（小文件页是带结尾换行的 file 输出），提交后未再改。日志 `/tmp/secrets-i50-*-red.log`、`/tmp/secrets-i51-*-red.log`。
- 步骤结束完整文件：Schema `bun test src/codepuppy-protected-files.test.ts` 8 pass；ext `bun test --max-concurrency 2` 逐文件：secret-files 10、secret-mask 11、risk 23、register-policy 99、secret-values 5、secret-read 4、secret-diff 2、secret-mutations 9，均 exit 0。临时还原两处旧样本（`BASIC_TOKEN`→`BASIC`、`NEW_TOKEN`→`NEW`）后 secret-files 3 FAIL、secret-mask 1 FAIL，确认它们编码的是被替换的行为。
- 场景（ui-mac，`gate slot -- bun test --max-concurrency 2 --timeout 90000 ./src/main/composer-tier-matrix.engine.cases.ts -t 'protected files (read (build|ask|readonly)|outside project read shell and card|ordinary env values stay visible)'`）：5 pass / 45 filtered / 0 fail（注册共 50）。同时回退两条规则后只跑两条新行：0 pass / 2 fail（AC-11 行在读取处出现一张 read 询问；AC-12 行 `DB_HOST=db` 不在）。日志 `/tmp/secrets-v5-scenario{,-removal}.log`。
- 移除臂（工作树临时改写、跑具名例、`git restore`，生产文件与 HEAD 一致）：Schema 去掉项目外判定 → Schema、secret-files、register-policy 外读例、risk 例各 0/1；SecretMask.read 去掉 `track` → register-policy 外读例 0/1（读后改写的新值在 shell 输出出现，断言行 1820）；采集器忽略已 track 文件 → secret-files 例与 register-policy 外读例各 0/1；env 采集恢复旧判定 → secret-values 例、register-policy env 例各 0/1；read 视图恢复旧判定 → secret-read 例、register-policy env 例各 0/1。日志 `/tmp/secrets-v5-arm-*.log`。
- 一次扩大相关集：ext authority-registry 5、plugin-host 56；ui-mac gate-file-registry 25；经 slot 的 fixture-identity + old-name-scan 15，14 个直接夹具消费者与 PermissionDialog、permission-risk、RiskTag 共 260。均 exit 0。Core 只引用未改的 `MASKING_FAILED_TEXT`，不在相关集。
- 静态：schema `bun typecheck` 145 files 无错；ext `bun typecheck` exit 0；ui-mac `bun typecheck` exit 0；14 个改动 TS 的 oxlint 0 warnings / 0 errors；ext `bun run build` exit 0；`git diff --check` 通过；`core.hooksPath` 仍为 `.githooks`，未安装依赖。
- `affected-tests --list` exit 0：`affected tests: 138 of 746 test files`；含本节改动的 ext 六个测试文件、fixture-identity、old-name-scan、permission-risk。Schema 的 `packages/schema/src/codepuppy-protected-files.test.ts` 不在任何 `.gate-tests` runner 根下（schema 根为 `packages/schema/test/codepuppy-*.test.ts`），PR 门与夜间都不跑它；本节行为另由 ext 的受选用例覆盖。
- 观察：生产「全部批准」档在 v5 前读项目外 `.env` 并非不问——引擎底座 `read *.env` ask 会出一张卡，批准后原值交给模型；`credentials.json`、`*.pem`、`.envrc` 等不带 `.env` 后缀的名单文件则不问且原样。v5 后两者都不问、返回安全视图（AC-11「读取没有批准卡片」）。

### ⑥ 核对修正：值里内嵌的密码

- 依据：编排器对 I-51 的核对修正（「只遮凭据类字段」中，值里内嵌的密码也是凭据字段）；规格 v5 BR-06 补句与 AC-12 扩写（同一版本，批准不变；v5 批准行的遗留只保留 BR-05 的「读前打印」边界）。设计文档、Schema 的 `.gate-tests` 根与文档检查器引用按编排器指示不在本轮处理。
- 改动：`secret-values.ts` 新增 `urlPasswords`（`scheme://用户:密码@主机` 形状的值取出密码的书写形与解码形）与 `envView`（凭据名整值遮；否则只遮内嵌密码；源文里找不到该密码原文时整值遮），env、结构化文档每个叶子、assignments 每一行都经同一 `embedded` 采集密码，不论变量/字段名。`secret-read.ts` 的 `projectEnvRows` 按 `envView` 只把密码段换成遮盖符，截断在密码中间时不露出密码前缀。追加必要范围：`secret-mutations.ts`——视图里出现 `postgres://app:[REDACTED]@…` 后，write/edit/patch 写回时把「其余部分与当前值一致」的这一值恢复为当前 RHS，模板按同一视图匹配；否则会把占位符写进密码。register-policy 精确条数 99→100；场景 AC-12 行加 `DATABASE_URL`。
- 红例 `cf39dc46d1`（当前实现上全部失败，密码原样到达）：secret-values `embedded URL passwords are credential fields in every format` 0/1；secret-read `env read view masks only embedded URL passwords` 0/1；secret-mutations `embedded URL password view restores through write/edit/patch` 0/3；register-policy `env URL values mask only the embedded password` 0/1。
- 绿：ext 逐文件 secret-values 6、secret-read 5、secret-diff 2、secret-mutations 12、secret-mask 11、secret-files 10、register-policy 100；Schema 8；ui-mac gate-file-registry 25；场景 `gate slot -- … -t 'protected files ordinary env values stay visible'` 1 pass / 49 filtered。均 exit 0。
- 移除臂（临时改写后 `git restore` 回到已暂存的修正）：`urlPasswords` 恒为空 → 上述四个文件的具名例各红（1+1+3+1 FAIL）；写回不认内嵌占位符 → secret-mutations 三条全红。第一次还原时修正尚未暂存，`git restore` 连带撤回了 `secret-values.ts` 的修正；已按原文重做、暂存后重跑全部改动文件，结果同上，之后的臂都还原到暂存版本。
- 静态：schema、ext、ui-mac `bun typecheck` 均 exit 0；8 个改动 TS 的 oxlint 0 warnings / 0 errors。

### ⑥ 审查 R1 修正（FIX-THEN-MERGE）

- 依据：独立审查 R1（Claude Opus 5.5）7 项，编排器全部接受；规格 v5 BR-06 补「值里以 `Password=`、`?password=` 这类键写出的密码同样只遮这一段」，其余不变。设计同步另由编排器派单。
- 红例 `099c3ec893`（当前实现上全红）：Schema `public values preserve credential names` 加 PGPASSWORD/APIKEY/SECRETKEY/ACCESSTOKEN/oauth/Pwd（第 3 项）；secret-values 同名例改为表例，逐行在旧实现上取得：多主机 []、`BOTH` 只得 p1、空密码形状 []、`%9A` 抛 URIError、ADO/ODBC/查询参数 []（第 1、5、6 项）；secret-read 多主机、两地址、`Password=` 段、`?password=`（第 1、6 项）；secret-mutations 写回循环加改主机 write/edit/patch（第 2 项）与 `longer embedded views keep later occurrence positions` edit/patch（第 4 项）。旧实现逐行输出 `/tmp/secrets-r1-rows-before.log`。
- 修 `fc825e9e6d`：逐处提取 `scheme://用户:密码@`（授权段止于 `/ ? #` 或空白，用户信息到最后一个 `@`），形状匹配而无密码时整值遮；凭据名键的 key=value 段只遮其值；解码失败保留书写形；名字片段以凭据词结尾即算凭据名，词表加 `PWD`（审查所列 `Pwd` 需要）；写回按位置换回每个遮盖符；`position()` 按实际替换长度计偏移。夹具重采 `c41cc44272`（Schema 改动使引擎身份失效，CLI 路径 21 行不变）。
- 第 7 项（核实，非缺陷）：`packages/ext` 下临时用例经真实 Code Mode 执行 `tools.read(<另一项目 .env>)`，输出 `{"readInDirect":true,"readInCodeMode":false,"success":true,"containsValue":false,"containsPort":false,"excerpt":"caught: Error: Unknown tool 'read'."}`（`/tmp/secrets-r1-codemode-probe.log`）。内置 read、grep、glob 均 `codemode: false`（`packages/core/src/tool/plugin/read.ts:47` 等），子调用读不到文件；临时用例已删，不入测试集。
- 绿：Schema 8；ext secret-values 6、secret-read 5、secret-mutations 17、secret-diff 2、secret-mask 11、secret-files 10、risk 23、register-policy 100；经 slot 的 fixture-identity、old-name-scan、14 个夹具消费者与 PermissionDialog、permission-risk、RiskTag 共 275。均 exit 0。
- 移除臂（临时改写，`git restore` 回到已暂存的修正）：只取第一个地址 → secret-values `BOTH` 行、secret-read 各红；整段 `URL.parse` 门 → `MONGO_URL` 行、secret-read 各红（首次按逗号截断的臂不忠实、未变红，已改为整段解析后重做）；不加保护的解码 → URIError 红；跳过键值段 → `CONN` 行、secret-read 各红；精确词匹配 → Schema `PGPASSWORD` 红；仅相等时还原 → 改主机三例红；旧偏移公式 → 长视图两例红。日志 `/tmp/secrets-r1-arm-*.log`。
- 静态：schema、ext、ui-mac `bun typecheck` 均 exit 0；7 个改动 TS 的 oxlint 0 warnings / 0 errors。
- 偏离：Schema 词表加 `PWD`、名字片段以凭据词结尾即算——均为审查裁定所需，冻结设计 §4.1 的词表正文随设计同步更新。
