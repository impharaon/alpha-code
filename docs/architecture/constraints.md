---
title: Architecture constraints and known deviations
kind: architecture
status: active
owners:
  - alpha-code maintainers
last_reviewed: 2026-10-30
review_after: 2027-04-30
---

# 架构约束与已知偏离

只记事实:约束一句话,偏离写清位置、偏离了哪条、碰到它的票。不写优先级,排期在 GitHub Issues。

## 约束

- **K1 运行权限档位只有一个权威,且执行判定的那一层读得到它。** 「哪些 agent 是档位载体(全部批准 / 请求审批 / 只读)」只定义一次,做委派与审批判定的引擎能据此区分「用户选的档位」与「助手自带规则」,不在别处另写一份名单。
- **K2 一个概念只有一个权威,其余地方消费它。** 同一段判定或投影只实现一次;别处需要时调用它、读它给出的结果,不另写一份实现,也不手写它的替身。

## 已知偏离

| 位置 | 偏离 | 事实 | 碰到它的票 |
| --- | --- | --- | --- |
| `packages/ui-mac/src/main/naming-migration-map.ts:51`、`packages/ui-mac/src/renderer/codepuppy-ui/composer-state.ts:250`、`packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/session-timeline-view.tsx:526` | K2 | 旧到新 agent 名的映射已有 `naming-migration-map.ts` 的权威表;`composer-state.ts` 与 `session-timeline-view.tsx` 又各写一条 `alpha-` → `codepuppy-` 正则。渲染进程不能引入 main 模块。 | `alpha-code#1643`、`alpha-code#1649` |
| `packages/ui-mac/src/main/codepuppy-builtin-policy.ts`(`CODEPUPPY_INJECTED_AGENTS`)、`packages/ui-mac/src/main/codepuppy-config-injection.ts`(载体的规则表) | K1 | 档位载体名单只在 ui-mac 主进程一份;引擎(`packages/opencode/src/session/prompt.ts` 的委派判定)只拿得到当前 agent 的规则集,区分不了档位限制与助手自带规则 —— 例如「全部批准」档手选计划助手时,计划助手自带的 `task: {general: "deny"}` 对用户点名 `@general` 同样生效。gate 靠规则落到 `*` 推断全部批准,未声明 `tool-policy-default` 的 agent 都放开(#1638)。`#1662`:OpenCode 2 把 `task` 改名 `subagent`(注入里的 agent 规则改名归 L5),委派判定从 v1 `session/prompt.ts` 移到 2.x 的 `subagent` 工具;Code Puppy 的执行闸在 `packages/ext/src/policy/catalog.ts` 读 `tool-policy-default`,档位载体名单仍只在 ui-mac,本票不解决。 | `alpha-code#1573`、`alpha-code#1638`、`alpha-code#1662` |
| `packages/opencode/src/tool/code-mode.ts:195-203` | K2 | Code Mode 子调用把 MCP 结果的 `isError` 投影成错误的那段,是 `packages/opencode/src/mcp/catalog.ts:68-74`(`McpCatalog.convertTool` 的 execute)的刻意镜像,同一概念两份;`catalog.ts` 是未接管的上游文件,放不进一份共用实现。`#1662`:两个文件随 v1 引擎一起删除;OpenCode 2 的 Code Mode 子调用走同一个 `Tool.execute`(`run`),Code Puppy 不再有自己的一份投影 —— 这一行在换代合入后可删。 | `alpha-code#1563`、`alpha-code#1662` |
| `packages/ui-mac/src/renderer/extensions/use-extensions.ts:463-484` | K2 | MCP 状态的种类以引擎 `MCP.Status`(SDK `McpStatus` 判别联合)为准,而定制中心对状态词做子串匹配(`connected` / `disabled` 用 `includes`,`needs_auth` / `pending` 判等),不消费引擎给出的状态种类。 | `alpha-code#1563`、`alpha-code#1668` |
| `packages/ui-mac/test-visual/main.tsx:32-70` | K2 | 视觉 harness 手抄了一份两段目录投影(平台段:V3 producer 行 → 模型行;BYOK 段:随包首启引导 × 适配器表 → provider 行)。生产投影在 `packages/ui-mac/src/main/codepuppy-live-allowlist.ts`(`projectPlatformModels`)与 `packages/ui-mac/src/main/codepuppy-models.ts`(`projectByokProviders`),两个模块引了含 `node:fs` 的依赖,浏览器 bundle 引不了。 | `alpha-code#1556` |
| `packages/ui-mac/src/main/ext-mcp-policy.ts:66-72`、`packages/ui-mac/src/main/codepuppy-office-instance.ts:131-142`、`packages/ui-mac/src/shared/office-advisories.ts:194-200`、`packages/ext/src/policy/first-party-mcp.ts:41-46`(`#1662` 随 M2 从 `packages/opencode/src/mcp/codepuppy-first-party-mcp.ts` 搬来,未顺带合并) | K2 | 「Office main 模板 → 本 bundle 的具体命令」这一步(解释器槽、server 槽、workspace 槽的替换)各写了一份:写策略、启动迁移/重锚、安全校验的期望命令各自展开模板;引擎的声明定义判定把清单里模板的 `{codepuppyResources}` 换成清单所在资源根再逐 token 比对,是第四处。 | `alpha-code#1564`、`alpha-code#1565`、`alpha-code#1662` |
| `packages/ui-mac/src/main/ext-mcp-policy.ts:70,91`、`packages/ui-mac/src/main/codepuppy-office-instance.ts:132` | K2 | 随包 `python3` 的位置有两种派生:写策略与就绪事实用 `realpath(resourcesRoot())` 拼 `office-runtime/bin/python3`,启动迁移/重锚由 `realpath(server.py)` 截掉 `/office-mcp/server.py` 后缀再拼。 | `alpha-code#1564` |
| `packages/plugin/package.json:13` | 北极星(只增不改上游文件) | `./alpha-cloud-authority` 这一行 exports 是 alpha 对上游文件的改动,随 `19bdae9ff`(ADR-041)在 `#1247` / ADR-044 把守卫辖区扩到整棵 `packages/` **之前**进来,从未登记进 `UPSTREAM_EXCLUDES`;今天任何一次再改该文件,`scripts/north-star-guard.sh` 都判红(`#1572` 实跑 exit 1,因此分类模块改放 `packages/schema`)。`#1662`:换代后 `packages/plugin/package.json` 取 OpenCode 2 原样,`./*` 通配导出覆盖 `alpha-cloud-authority`,这一行改动不复存在 —— 这一行在换代合入后可删。 | `alpha-code#1572`、`alpha-code#1662` |
| `packages/ui-mac/src/renderer/codepuppy-ui/PermissionDialog.tsx:12` | `providers.ts` 转口规则(alpha 组件经 `codepuppy-ui/providers.ts` 借用 `packages/app`) | 以相对路径直引 `packages/app/src/context/permission-v1-adapter` 取 `isPermissionV1Fingerprint`:经 `@opencode-ai/app` barrel(含 `providers.ts` 转口)会把整个 app 拖进审批卡的测试运行时,vite 解析 `@/index.css` 失败;给 `packages/app` 加窄子路径导出又被 `surface-seam-contract.test.ts` 禁止(新增子路径需 ADR)。 | `alpha-code#1575`、`alpha-code#1668` |
| `packages/ui-mac/src/renderer/codepuppy-ui/session-workspace/session-composer-dock.tsx:12` | `providers.ts` 转口规则 | 直接从 `@opencode-ai/app` barrel 引入 `createPermissionChannelSource` / `useServerSDK` / `useServerSync`,不经 `providers.ts`(既有)。 | `alpha-code#1575`、`alpha-code#1668` |
| `packages/ui-mac/src/renderer/sidebar/codepuppy-sidebar.tsx:279`、`packages/ui-mac/src/renderer/codepuppy-ui/codepuppy-composer-model.tsx:465`、`packages/ui-mac/src/main/cloud-ipc.ts:179` | K2 | 钱包充值页地址(网站地址 + `/wallet?tab=recharge`)在三处各拼一遍:侧栏「充值」与模型选择器「余额不足」行在渲染进程用 `endpoints().web` + `CODEPUPPY_PATHS.wallet` 拼,生图卡与回合错误卡「充值」走的 `cloud-open-billing-page` 在主进程用写死的 `/wallet?tab=recharge` 拼。 | `alpha-code#1588` |
| `packages/ext/src/project-config.ts:47`、`packages/ui-mac/src/main/project-hidden-dir-migration.ts:36` | K2 | 「项目里旧的隐藏目录 `.code-puppy` 还在不在」判了两份:main 的项目目录迁移判一次(在则改名或报冲突),sidecar 的 ext 项目解析器再判一次(在则不认项目根,只判不写)。ext 跑在 sidecar 进程里,不能 import main 的迁移模块(那会把只有 main 执行的写盘点带进 sidecar 的 import 闭包)。 | `alpha-code#1569` |
| `packages/ui-mac/src/main/codepuppy-workdir.ts:150`(`resolveProjectCodePuppyRoot`) | 约束一节无对应编号:判定项目根的解析器带写盘副作用 | 这个解析器本来只判定项目根;现在它先调 `adoptLegacyProjectHiddenDir`,在 prod/beta 的 main 里会改目录名、改写项目配置与收据、追加 `projects.log`。所有调用方(项目 IPC 入口、产物、扩展、附件等)都隐式参与项目隐藏目录迁移。 | `alpha-code#1569` |
| `packages/ui-mac/src/main/project-hidden-dir-migration.ts:22,113`、`packages/ui-mac/src/main/naming-migration.ts:44`、`packages/ui-mac/src/main/index.ts:576` | 约束一节无对应编号:模块级可变注入状态;通用 JSON 改写住在功能模块里被反向 import | 项目目录迁移的写盘端口是模块级可变 `writer`,由 `index.ts` 调 `configureProjectHiddenDirMigration` 注入;通用的 `editJsonText` 住在这个模块里,启动迁移 `naming-migration.ts` 反向 import 它。这是围栏写入点登记簿的权宜做法:`codepuppy-workdir.ts` 在 sidecar 的 import 闭包里,而登记簿的 `main-only` 只许 `codepuppy-environment.ts` 用(`process-fence-write-sites.test.ts:53`),写盘端口不能静态进这个闭包。 | `alpha-code#1569` |
| `packages/ui-mac/src/main/index.ts`、`packages/ui-mac/src/main/source-text-anchors.ts:23-29` | 约束一节无对应编号:启动闸门接线的可执行验证缺口 | 当前 bun 1.3.14 无法链接 `index.ts` 的 `node:tls` 导出 `setDefaultCACertificates`;启动闸门接线只能靠源码锚或打包证据,可独立调用模块的行为测试不能证明这条接线。 | `#1632` |
| `packages/ui-mac/src/main/catalog-channels.ts:1009` | 约束一节无对应编号:刷新结果与持久化结果不一致 | coherent set 写缓存时忽略 `writeState` 返回值;刷新可能返回 `source: "remote"`,但目录实际未写入,后续同步重读仍无法判定。 | `#1632` |
| `packages/ui-mac/src/renderer/extensions/use-extensions.ts`、`packages/ui-mac/src/renderer/codepuppy-ui/permission-mount-ratchet.test.ts` | K2 | 定制中心启停成为 Permission surface 之外的第二个审批决定入口;白名单按文件 + token 放行,该入口只允许字面量 `reply: "reject"`。 | `#1652` |
| `packages/opencode/src/mcp/index.ts` | 约束一节无对应编号:状态词复用 | MCP 的 `pending` 同时表示首次启动、退避中、重试中三种状态。`#1662`:文件随 v1 删除;OpenCode 2 的 `pending` 只表示握手中(没有退避与重试态,退避本身未在 2.x 上重新握住,见 `docs/architecture/codepuppy-authority-registry.json` 的 `mcp-reconnect-backoff`)。 | `#1653`、`alpha-code#1662` |
| `packages/ext/src/hub-tools.ts`、`packages/ui-mac/src/renderer/extensions/use-extensions.ts:271` | K2 | `HubReasonCode` 的 code → 文案有两张表,分别由 agent 工具与定制中心 UI 维护。 | `#1658` |
| `packages/ui-mac/src/main/db-safety.test.ts`(`const sqlite3 = Bun.which("sqlite3")`)、`packages/ui-mac/src/main/platform/index.ts:49`(`sqliteBinary`) | K2 | DB 安全带的真 sqlite3 用例按 `PATH` 找 sqlite3,生产按 `platform.sqliteBinary()` 用固定绝对路径 `/usr/bin/sqlite3`(防劫持)。PATH 上排在前面的是另一份 sqlite3 时,用例测的不是生产那份二进制 —— 干净关闭的 WAL 库能不能只读打开、关库后留不留 `-wal`/`-shm` 都随构建而变(macOS 自带那份关库后保留它们)。2026-11-09 本机 PATH 上只有 `/usr/bin/sqlite3`,两者一致。 | `#1664` |
| `packages/ext/src/policy/identity.ts:54`(`normalizeToolName`)、`packages/ext/src/policy/gate.ts:36`(`evaluate`) | K2 | 扩展里的工具策略重述了 OpenCode 2 的两条规则:工具名规范化(`packages/core/src/tool/runtime.ts` 的 `normalizedName`)与规则求值(`packages/core/src/permission.ts` 的 `Permission.evaluate`,通配匹配本身直接 import `packages/core/src/util/wildcard.ts`)。引入上游这两个模块会把 core 的服务层整包带进扩展 bundle;两份由 `packages/ext/src/policy/identity.test.ts` 逐例对上游实现钉住,上游一改即红。 | `alpha-code#1662` |
| `packages/ext/src/policy/managed.ts:36,42`、`packages/ext/src/policy/index.ts:43` | K2 | 托管配置的系统目录与 MDM 偏好路径(上游 `packages/core/src/config/discovery.ts` 的 `systemDirectory` / `preferencePaths`)和数据根(上游 `packages/util/src/global-roots.ts`)在扩展里各重述一份:托管上限要自己读托管文档(合并后的 agent 规则里项目的 agent 规则排在托管 deny 之后),插件 Context 不给数据根。上游若挪路径,上限读到不存在的目录只会更严。 | `alpha-code#1662` |
