---
title: "alpha-code#1662 能力清点表:Code Puppy 依赖的每项引擎能力在 OpenCode 2 里的位置"
kind: design
status: proposed
owners:
  - alpha-code desktop maintainers
last_reviewed: 2026-11-08
review_after: 2027-02-08
---

# alpha-code#1662 能力清点表(ADR-037 决策 3)

本表是 [方案基线](2026-11-08-1662-opencode2-generation-switch-baseline.md) 的附件,对应票面 AC2。
规矩来自 [ADR-037](../../.claude/rules/adrs/ADR-037-engine-generation-switch-is-its-own-change.md) 决策 3:
每格写「我们今天用的」(`origin/alpha` = `e56ae0c036` 的 `file:line`)→「OpenCode 2 里对应在哪」
(只读检出 `/Users/tide/app/wt/opencode2-ref` = `upstream/dev` `adb0053d09` 的 `file:line`,下文写作 `v2:`)
→ 状态 → 处置。

- **状态**只用五个词:**原样**(路径与语义都在)/ **改名**(同一能力换了名字或路径)/ **改形**(能力在,接口或
  挂载方式变了,要重写我们这一侧)/ **删除**(OpenCode 2 里没有)/ **新增替代**(旧的没了,新代次有另一种机制
  覆盖同一需求)。
- **处置**里的 `L1`…`L7` 是基线第四节的 lane 编号。
- 坐标读于 `adb0053d09`。基线选的合并目标是 `33f94fce96`(v2.2.6 在 dev 线上的父提交),两者之间本表引用到的
  文件有 10 个不同,共 +70/−34 行(命令见基线 §1.1);lane 开工时在选定 SHA 上重读一遍坐标。
- 「全称」类判断(「X 全部都…」「不存在 Y」)都在格子里或 §0 写了跑过的命令。

## 0. 全称判断与它们的判据(都实跑过,2026-11-08)

| 判断 | 命令 | 输出 |
| --- | --- | --- |
| 49 条接管里 34 条在 OpenCode 2 里已不存在,15 条还在 | `bash scripts/north-star-guard.sh --print-takeover` 逐条 `git -C /Users/tide/app/wt/opencode2-ref cat-file -e HEAD:<path>` | GONE 34、EXISTS 15(逐条见 §9) |
| OpenCode 2 里没有 v1 发送路由 | `git -C …/opencode2-ref grep -l 'prompt_async' -- packages ':!packages/web' \| wc -l`;`promptAsync` 同 | `0`、`0`(只在 `packages/web` 的文档里出现) |
| OpenCode 2 的 HTTP API 全在 `/api/*` 下 | 抽 `packages/protocol/src/groups/*.ts` 的 `HttpApiEndpoint.*("名字", "路径")` | 每条路径都以 `/api/` 开头(基线 §1.2) |
| `packages/opencode` 整包被删 | `ls …/opencode2-ref/packages/opencode` | `No such file or directory` |
| Code Puppy 设的 `OPENCODE_*` 变量里,13 个在 OpenCode 2 的非测试、非 `packages/web` 源码里没有读者 | 两侧各 `grep -hoE 'OPENCODE_[A-Z0-9_]+'` 去重后 `comm -23` | 见 §4 第 E2 行;其中 `OPENCODE_JUNK_ENTRIES` 是 alpha 自己的常量名(`engine-config-truth.ts:162`),不是环境变量,实为 12 个 |
| ui-mac 用到的 `@opencode-ai/app` 根导出 23 个,OpenCode 2 的 `packages/app/src/index.ts` 只剩其中 5 个 | perl 抽 ui-mac 非测试源码 `import {…} from "@opencode-ai/app"` 的符号,逐个 `grep -w` 2.x 的 `index.ts` | 缺 18 个(§7 第 F3 行) |
| alpha 的两条自有 DB 迁移 OpenCode 2 不认识,且与 2.x 新增迁移无表名冲突 | `migration.gen.ts` 三方 `comm`;`grep -l 'permission_request\|permission_decision' v2:packages/core/src/database/migration/*.ts` | alpha 独有 `20260720085655_permission-decision-receipt`、`20260720094009_permission-request-admission`;2.x 迁移零命中 |

## 1. 引擎宿主、构建与生命周期(ui-mac main ↔ 引擎)

| # | 我们用的 | `origin/alpha` 坐标 | OpenCode 2 坐标 | 状态 | 处置 |
| --- | --- | --- | --- | --- | --- |
| H1 | 引擎以 v1 的 node 构建产物嵌进 Electron `utilityProcess` 里跑 | `packages/ui-mac/electron.vite.config.ts:10`(`OPENCODE_SERVER_DIST = "../opencode/dist/node"`)、`:84-88`(`virtual:opencode-server`) | `v2:packages/server/src/process.ts:50`(`ServerProcess.start`);上游自己的宿主是 `v2:packages/cli/src/server-process.ts:85-145` | 改形 | L1 先证明 H1(嵌入式)在 Electron 42 的 Node 24.15 上能起;L5 改接线。选型见基线 §2.4 |
| H2 | 构建期先建 v1 引擎 node 产物 | `packages/ui-mac/scripts/prebuild.ts:30`(`cd ../opencode && bun script/build-node.ts`) | `v2:packages/cli/script/build-node.ts:19-24`(Node SEA,`NODE_VERSION = "26.4.0"`);上游桌面版打包的是 bun 编译的 CLI(`v2:packages/desktop/electron-builder.config.ts:108-125`、`v2:packages/cli/script/build.ts:172-196`) | 改形 | L5:改为在 electron-vite 里直接打包 `@opencode/server/process`(或等价入口),不再依赖 `packages/opencode` |
| H3 | 三个对 v1 生成产物的构建期补丁:版本号、#857 共享路由层、内部模型目录先发布 | `prebuild.ts:34`(`patch-server-version.ts`)、`:39`(`patch-sidecar-shared-routes.ts`)、`:44`(`patch-plugin-internal-models.ts`) | 补丁对象(v1 `Server.Default()`/`Server.listen` 两套路由层)在 2.x 不存在 | 删除 | L5:三个补丁随 v1 产物一起删;#857 要的「进程内调用与监听共用一张图」在 2.x 由 `start()` 的 `Transform`(`v2:packages/server/src/process.ts:40`)取 app 实现,L1 实测 |
| H4 | sidecar 启动顺序:先装围栏 → 注入配置 → 再 import 引擎 → 预热 → `Server.listen` → ready | `packages/ui-mac/src/main/sidecar.ts:133-191` | 2.x 宿主等价物 `v2:packages/cli/src/server-process.ts:73-145`(读配置、`start(options)`、打印 URL) | 改形 | L5:顺序不变(围栏仍须在 import 引擎之前),只把 import 与 listen 换成 2.x 入口 |
| H5 | 进程内调用引擎(给 ext 用,绕开围栏拒掉的回环 TCP,#1531) | `packages/ui-mac/src/main/in-process-engine.ts:16-24`、`sidecar.ts:153-154` | `v2:packages/server/src/fetch.ts:43`(`ServerFetch.make`:不监听端口的 fetch handler,但自建一张应用图);`start()` 的 `Transform` 钩子 `process.ts:40` | 改形 | L1 实测用哪条拿到「与监听同一张图」的 fetch;不得另建第二张图(#857 的教训) |
| H6 | renderer 经 Basic auth + CORS `oc://renderer` 连本机引擎;密码只在 main/sidecar | `sidecar.ts:176-182`(`username: "opencode"`、`cors: ["oc://renderer"]`)、`:227-232` | `v2:packages/server/src/options.ts:7-55`(`password`、`cors`);上游桌面同样只把 URL 给 renderer、main 补 `Authorization`(`v2:packages/desktop/src/main/service/sidecar-credentials.ts:30-41`) | 改形 | L5;安全面 S8 |
| H7 | 健康/就绪探测 `/global/health` | `packages/ui-mac/src/main/*`(`grep -rn '/global/health' packages/ui-mac/src/main`) | `GET /api/info`(`v2:packages/protocol/src/groups/server.ts`) | 改名 | L5 |
| H8 | 引擎自更新关闭 | v1 嵌入式 node 产物不带更新器;Code Puppy 自己的应用更新走 electron-updater(`packages/ui-mac/src/main/updater-controller.ts`) | 2.x 的 CLI 更新器在 `v2:packages/cli/src/services/updater.ts:130-134,535`(只在 CLI 层);引擎核心另有插件 npm 自更新 `v2:packages/core/src/plugin/update.ts`(24h 一查) | 新增替代 | L5:嵌 `@opencode/server/process` 不带 CLI 更新器;插件自更新对本地路径插件是否不触发由 L1 实测,不触发要有测试钉住(围栏也会拦它的出网) |
| H9 | 运行时差异:v2 节点目标假定 Node 26.4 + `--experimental-ffi` | Electron 42.3.3 自带 Node 24.15.0(实测:`ELECTRON_RUN_AS_NODE=1 …/Electron -e 'process.versions'`),`node:sqlite` 可用,`node:ffi` 不存在 | `v2:packages/cli/src/node/target.ts:34`(`nodeExecArgv`);`v2:packages/core/package.json` 的 `imports` 为 sqlite/pty/fff/photon 都给了 `node` 分支;fff 缺失时回退(`v2:packages/core/src/filesystem/fff.node.ts:5`) | 改形 | L1 实测引擎在 Node 24.15 上能起、能发一条消息;不能起就转基线 §2.4 的 H3 |

## 2. 配置投影与凭证通道

| # | 我们用的 | `origin/alpha` 坐标 | OpenCode 2 坐标 | 状态 | 处置 |
| --- | --- | --- | --- | --- | --- |
| C1 | `OPENCODE_CONFIG_CONTENT` 整份注入(provider / agent / mcp / plugin / permission) | `packages/ui-mac/src/main/codepuppy-config-injection.ts:48`、`:493` | `v2:packages/core/src/config.ts:292-304`(读 content、做 `{env:}`/`{file:}` 替换);层序 `:370-380`(content 在 project 之上,managed 之下) | 原样(通道) | L5 |
| C2 | v1 配置键(`agent`、`provider`、`plugin`、`permission`、`mcp`、`command`、`autoupdate`…) | 同上 | 新键 `agents`、`providers`、`plugins`、`permissions`、`commands`、`policies`、`update`(`v2:packages/schema/src/config.ts:27-116`);旧键经 `v2:packages/core/src/config/normalize.ts:70-190` 转换并出诊断 | 改形 | L5:注入直接写新键,不依赖 normalize 的兼容层(兼容层带诊断、语义不保证一一对应);加一条测试断言注入产物零诊断 |
| C3 | `OPENCODE_CONFIG`(当前环境的 `codepuppy.jsonc`) | `codepuppy-config-injection.ts:81-92` | `v2:packages/cli/src/server-process.ts:132`(`file: process.env.OPENCODE_CONFIG`)→ `config.ts:286-291`(explicit) | 原样 | L5 |
| C4 | 半代次桥:为 v2 读侧另写一份 `OPENCODE_CONFIG_DIR/opencode.json` 并剥掉 `apiKey` | `codepuppy-config-injection.ts:508-641`(剥 key 在 `:626`,设目录在 `:641`) | 单一引擎后不再有「v1 推理 / v2 读侧」两套配置 | 删除(我们这一侧) | L5:整段删除 —— 这是 AC1「不留半代次链路」的具体落点之一 |
| C5 | `{file:…}` 引用承载秘密(A6 通道:钥匙串 → 本机秘密文件 → 配置里只放引用) | `codepuppy-config-injection.ts:25,134,368-403`;秘密文件 `packages/ui-mac/src/main/codepuppy-secret-files.ts` | `v2:packages/core/src/config/variable.ts:25-63`(`{env:}`/`{file:}`;**文件缺失或读不了时替换成空串**,`:63`) | 原样(语义差一处) | L5;安全面 S2:「文件缺失 ⇒ 空串」会让云 MCP 带空 token 发请求,需由我们在写配置前保证文件在场,或缺席时不发该定义(今天 `#1195` 已是这个形状,要保住) |
| C6 | 模型目录快照 `OPENCODE_MODELS_PATH` / `OPENCODE_MODELS_URL` / 关远程拉取 | `codepuppy-config-injection.ts:652-664` | `v2:packages/cli/src/server-process.ts:117-121`(`models.url/file/fetch`)→ `start()` 的 `models` 选项 | 原样 | L5 |
| C7 | 平台模型目录投影 / BYOK provider 投影 | `packages/ui-mac/src/main/codepuppy-live-allowlist.ts:259`(`projectPlatformModels`)、`packages/ui-mac/src/main/codepuppy-models.ts:46`(`projectByokProviders`) | 2.x `providers` 配置(`v2:packages/schema/src/config.ts:115`)、凭证服务 `v2:packages/core/src/credential.ts` 与 `/api/credential`、`/api/integration/:id/connect/key` | 改形 | L5:继续由我们投影进配置(本系统是 BYOK 的权威);不改用 2.x 的凭证表存 key(安全面 S2) |
| C8 | 模型目录读接口 `/api/model`(`catalog.model.available()`) | `packages/ui-mac/src/main/*`(`grep -rn '"/api/model"' packages/ui-mac/src/main`,3 处) | `GET /api/model`、`GET /api/model/default`(`v2:packages/protocol/src/groups/model.ts`) | 原样(路由),返回形状待核 | L5 核字段 |
| C9 | 外部生态默认拒绝:不继承 `~/.claude` 技能与 Claude 提示 | `packages/ui-mac/src/main/ecosystem-import.ts:28-32`(`OPENCODE_DISABLE_EXTERNAL_SKILLS`、`OPENCODE_DISABLE_CLAUDE_CODE_PROMPT`) | 这两个名字在 2.x 无读者;等价开关是 `start()` 的 `config.claude`(`v2:packages/cli/src/server-process.ts:126-131`,由 `OPENCODE_DISABLE_CLAUDE_CODE(_SKILLS)` 推出) | 改名 | L5;安全面 S6:不改会**静默**开始读用户的 `.claude` 技能 |
| C10 | 项目级配置(`<项目>/.codepuppy/codepuppy.jsonc`)经 ext 的 v1 `config` 钩子合并进引擎配置 | `packages/ext/src/plugin.ts` 中 `async config(cfg)`(`plugin.ts:181` 起)、`packages/ext/src/project-config.ts` | 2.x 没有「整份 config 钩子」;按域变换 `agent/mcp/command/skill/provider.transform`(`v2:packages/plugin/src/effect/plugin.ts:27-59` 的各 domain) | 改形 | L3 |

## 3. ext 插件面(`packages/ext` → OpenCode 2 插件 API)

| # | 我们用的 | `origin/alpha` 坐标 | OpenCode 2 坐标 | 状态 | 处置 |
| --- | --- | --- | --- | --- | --- |
| P1 | 插件模块形状:v1 `Plugin = (input) => Promise<Hooks>`,经配置 `plugin: [<bundle 路径>]` 装载 | `packages/ext/src/plugin.ts:63`(`export const CodePuppyExt: Plugin`);bundle 见 `packages/ext/package.json` | 模块必须 `export default { id, effect }` 或 `{ id, setup }`(`v2:packages/core/src/plugin/module.ts:81-94`);本地绝对路径装载 `module.ts:61-64` | 改形 | L3:整个入口重写为 2.x 形状;旧形状在 2.x 装不上(不是降级,是不装) |
| P2 | `chat.message` | `plugin.ts:116` | `session.hook.prompt`(`v2:packages/plugin/src/effect/session.ts:185-187`) | 改形 | L3 |
| P3 | `experimental.chat.system.transform`(提示词转写与品牌重写,ADR-015) | `plugin.ts:277` | `session.hook.context` 的 `system`(`session.ts:25-39,188`) | 改形 | L3;ADR-015 的「上游底座只读」不变 |
| P4 | `experimental.chat.messages.transform` | `plugin.ts:139` | `session.hook.context` 的 `messages` | 改形 | L3 |
| P5 | `chat.params`(温度/输出上限等,含平台与 BYOK 输出封顶) | `plugin.ts:146`;`packages/ext/src/platform-output-cap.ts`、`byok-output-cap.ts` | `session.hook.context` 的 `options`(`session.ts:22-35`) | 改形 | L3 |
| P6 | `chat.headers`(平台凭证头) | `plugin.ts:170`;`packages/ext/src/platform-credential-header.ts` | `session.hook["model.request"]` 的 `headers`/`baseURL`(`session.ts:68-75,191`) | 改形 | L3;安全面 S5 |
| P7 | `tool.execute.before` / `tool.execute.after`(云工具契约校验、websearch 闸、附件/视觉) | `plugin.ts:120,133` | `tool.hook["execute.before"/"execute.after"]`(`v2:packages/plugin/src/effect/tool.ts:20-51`);唯一触发点 `v2:packages/core/src/tool.ts:123-131` | 改名 + 改形(入参改为 `{tool, sessionID, agent, messageID, id, input}`) | L3;安全面 S1(钩子按注册顺序串行执行,后注册者能改写前者看过的输入,`v2:packages/core/src/plugin/hooks.ts:88-95`) |
| P8 | 自定义工具 `codepuppy_reload/register/echo/access/ping`、`codepuppy_hub_search/install/status` | `plugin.ts:300,316,389,404,424`;`packages/ext/src/hub-tools.ts:75,85,110` | `tool.transform`(增删改)+ `tool.list`(`tool.ts:55-59`) | 改形 | L3;工具身份账本(ADR-041)按 2.x `Tool.Info` 重建 |
| P9 | v1 `input.client`(查 provider / 会话消息 / MCP 状态) | `plugin.ts:98-111` | 插件 Context 的 `session`/`mcp`/`provider` 等 domain(`v2:packages/plugin/src/effect/plugin.ts:31-58`) | 改形 | L3 |
| P10 | 项目插件扇出:ext 代为装载项目插件并合并 hooks | `plugin.ts` 末段 `loadProjectPlugins` / `mergeHooks`;`packages/ext/src/plugin-fanout.ts` | 2.x 插件由配置 `plugins` 与插件源装载(`v2:packages/core/src/plugin/module.ts:40-58`,`plugin.use` 受 managed policy 管) | 改形 | L3 + 安全面 S1/S6:项目插件不得排到 Code Puppy 闸之后 |
| P11 | 定制中心桥与重载调度器经 `process.parentPort` 与 main 通信 | `plugin.ts:33-41`、`packages/ext/src/hub-bridge.ts` | 2.x 无此物;只要插件仍跑在 Electron `utilityProcess` 里(基线 H1 选型),`parentPort` 照旧可用 | 原样(取决于宿主选型) | L1 选型决定;选 H3 则此行变「删除」,要另设 IPC |
| P12 | 事件钩子(插件观察引擎事件) | v1 hooks 里的 `event` | `event` domain(`v2:packages/plugin/src/effect/event.ts`) | 改形 | L3(只在 ext 真用到时移) |
| P13 | v1 `permission.ask` 钩子 | 声明了但永不触发(`docs/architecture/engine-command-and-event-surface.md` §2.1) | `permission.hook.evaluate`(可改 `effect` 与 `message`,`v2:packages/plugin/src/effect/permission.ts:10-33`);触发点 `v2:packages/core/src/permission.ts:190` | 新增替代 | L4 |
| P14 | v1 `shell.env` | ext 未用(`context-injection.ts:659` 登记为 no-context) | `shell.hook["create.before"]`(`v2:packages/plugin/src/effect/shell.ts`) | 改名 | 不移(ext 今天不用) |

## 4. 环境变量投影

| # | 我们用的 | `origin/alpha` 坐标 | OpenCode 2 坐标 | 状态 | 处置 |
| --- | --- | --- | --- | --- | --- |
| E1 | 进 sidecar 的变量白名单(前缀 `OPENCODE_`/`XDG_`/`LC_`/`ELECTRON_`)与 `OPENCODE_CONFIG_CONTENT` 永不继承 | `packages/ui-mac/src/main/sidecar-env.ts:108,233-259` | 规则在我们一侧,与引擎代次无关 | 原样 | L5 保留 |
| E2 | 12 个在 2.x 无读者的变量:`OPENCODE_DISABLE_CLAUDE_CODE_PROMPT`、`OPENCODE_DISABLE_EXTERNAL_SKILLS`、`OPENCODE_ENABLE_EXA`、`OPENCODE_ENABLE_PARALLEL`、`OPENCODE_EXPERIMENTAL`、`OPENCODE_EXPERIMENTAL_EXA`、`OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX`、`OPENCODE_EXPERIMENTAL_PARALLEL`、`OPENCODE_PORT`、`OPENCODE_PURE`、`OPENCODE_SERVER_USERNAME`、`OPENCODE_WEBSEARCH_PROVIDER` | `packages/ui-mac/src/main/server.ts:323-329,385`、`ecosystem-import.ts:30-31`、`cloud-web-search.ts:96` 等(§0 命令) | 无 | 删除(变量本身) | L5:逐个找新机制 —— websearch 走 `websearch` 配置与插件 domain(`v2:packages/schema/src/config.ts:103`、`v2:packages/plugin/src/effect/websearch.ts`);外部生态见 C9;其余删掉。加一条测试:我们写进 sidecar 环境的每个 `OPENCODE_*` 在引擎源码里都有读者(防止下一次静默失效) |
| E3 | 仍有读者的 16 个(`OPENCODE_CONFIG*`、`OPENCODE_DB`、`OPENCODE_MODELS_*`、`OPENCODE_SERVER_PASSWORD`、`OPENCODE_CLIENT`、`OPENCODE_CHANNEL` 等) | 同上 | §0 命令的 `comm -12` | 原样 | L5 逐个核语义(例如 `OPENCODE_CHANNEL` 在 2.x 决定库文件名,`v2:packages/cli/src/database-path.ts:4-12`) |

## 5. HTTP / SSE / SDK(ui-mac main 与 renderer 直接打的引擎接口)

| # | 我们用的 | `origin/alpha` 坐标 | OpenCode 2 坐标 | 状态 | 处置 |
| --- | --- | --- | --- | --- | --- |
| S1 | 会话发送 `session.promptAsync`(三个入口:首页新对话、会话页输入框、时间线继续) | `packages/ui-mac/src/renderer/sidebar/use-projects.ts:513`、`packages/ui-mac/src/renderer/codepuppy-ui/codepuppy-composer.tsx:1868`、`packages/ui-mac/src/renderer/codepuppy-ui/session-timeline/session-timeline.tsx:276` | `POST /api/session/:sessionID/prompt`(`v2:packages/protocol/src/groups/session.ts:337`) | 改形 | L6:**三个入口同一个提交切**(ADR-037 决策 5);ADR-036 由 ADR-047 取代 |
| S2 | 事件流 `/global/event`(v1 事件:`message.updated`、`message.part.updated`、`permission.asked`…) | `use-projects.ts:609`、`packages/ui-mac/src/renderer/extensions/use-extensions.ts:1037`、`packages/ui-mac/src/renderer/codepuppy-ui/cloud-run-watcher.tsx:59`;main 侧 2 处(`grep -rn '"/global/event"' packages/ui-mac/src/main`) | `GET /api/event`(`v2:packages/protocol/src/groups/event.ts:61`);事件定义 `v2:packages/schema/src/session-event.ts` 等 | 改形 | L6 / L5 |
| S3 | 审批事件:停靠区同时订阅 `permission.asked` 与 `permission.v2.asked`(#668 双通道) | `packages/ui-mac/src/renderer/codepuppy-ui/session-workspace/single-surface-app-stub.ts:68-90` | `/api/session/:sessionID/permission*`(`v2:packages/protocol/src/groups/permission.ts:88-142`) | 改形 | L6:双通道收成一个;顺带闭合 ADR-036 登记的「本地工具回合审批 feed 不点亮」缺口 |
| S4 | 提问卡 `question.reply` / `question.reject` | `packages/ui-mac/src/renderer/codepuppy-ui/session-workspace/session-question-card.tsx:69-74` | 提问工具改用表单服务(`v2:packages/core/src/tool/plugin/question.ts:6,51`);`/api/session/:sessionID/form*`(`v2:packages/protocol/src/groups/session.ts:718-764`) | 改形 | L6 |
| S5 | 会话分享 `session.share` | `use-projects.ts:548-557`,侧栏菜单 `packages/ui-mac/src/renderer/sidebar/codepuppy-sidebar.tsx:989` | 2.x 协议里没有分享接口(`grep -n -iE '"session\.share\|/share' v2:packages/protocol/src/groups/*.ts` 零命中);上游 v1 维护线也已停掉分享(`d320177aa4`) | **删除** | 待 owner 裁决(基线 §7 O3):随换代下线该菜单项 |
| S6 | 其余 v1 路由:`session.create/get/list/update/delete/abort/revert/messages/command`、`mcp.status/add/connect/disconnect/auth`、`find.files`、`file.list`、`vcs.status`、`app.agents/skills`、`command.list`、`global.config`、`config.get`、`project.list`、`permission.list/reply` | `grep` 统计见基线 §1.5(ui-mac 非测试源码约 35 个不同调用) | 对应 `/api/session*`(`interrupt` 取代 `abort`,`revert/stage`、`revert/commit`、`DELETE revert` 取代 `revert`)、`/api/mcp` 与 `/api/experimental/mcp/:server*`、`/api/fs/find`、`/api/fs/list`、`/api/vcs/status`、`/api/agent`、`/api/skill`、`/api/command`、`/api/config`(全表 `v2:packages/protocol/src/groups/*.ts`) | 改名 / 改形 | L5、L6;MCP 增删连断在 2.x 挂在 `/api/experimental/` 下,接口稳定性弱一档 |
| S7 | ext 与 main 直打的 v1 路径:`/mcp`(15 处)、`/provider`(7)、`/mcp/:name/connect`(4)、`/session/:id/message`、`/session/status`、`/instance/dispose`、`/skills/paths`、`/permission/skill`、`/permission/codepuppy_hub_install`、`/global/config` | `grep -hoE` 统计(基线 §1.5) | `/api/mcp`、`/api/provider`、`/api/experimental/mcp/:server/connect`、`/api/session/:sessionID/message`(`v2:packages/protocol/src/groups/message.ts:102`)、`/api/location/reload` 等 | 改名 / 改形 | L3、L5 |
| S8 | alpha 已经在用的 v2 路由:`/api/model`、`/api/permission/tool-policy/*`(alpha 加在接管文件里)、`/api/provider/codepuppy-internal-catalog-ready`、`/api/session/:id/message` | 同上 | 前两类见 C8 与 K 段;`tool-policy` 四条不在上游文件里(上游 `permission.ts` 只有 `request`/`saved`/会话审批) | 改形 | L4 |
| S9 | SDK 类型与客户端 `@opencode-ai/sdk/v2/client`(46 处 import) | `grep -rhoE "from ['\"]@opencode-ai/sdk[^'\"]*" packages/ui-mac/src` | `@opencode/client`(`v2:packages/client/package.json` exports:`promise`/`effect`/`solid`/`service`/`mcp`) | 改名 + 改形 | L5、L6 |

## 6. 工具、权限咽喉与工具策略

| # | 我们用的 | `origin/alpha` 坐标 | OpenCode 2 坐标 | 状态 | 处置 |
| --- | --- | --- | --- | --- | --- |
| K1 | 目录闸(#725 A):identity 硬拒,模型看不到被拒的工具 | `packages/opencode/src/permission/index.ts:9-10,349-357`(接管文件) | 工具清单在 `session.hook.context` 的 `tools`(`v2:packages/plugin/src/effect/session.ts:37-39`)与 `tool.transform` | 改形 | L4;安全面 S1 |
| K2 | 执行闸(#725 B):每次工具执行 `ctx.ask(canonicalToolIdentity)` | `packages/opencode/src/session/tools.ts:263,347,428`(接管文件) | 唯一执行入口的 `execute.before` 触发 `v2:packages/core/src/tool.ts:123-131`;各工具自己调 `permission.assert`(例 `v2:packages/core/src/tool/mcp.ts:63`、`tool/plugin/glob.ts:69`) | 改形 | L4;安全面 S1:判据要能在摘掉我们的挂载后翻红 |
| K3 | 权限内核接管(ADR-033):`packages/core/src/permission.ts`、`permission/sql.ts`、`packages/protocol/src/groups/permission.ts`、`packages/server/src/handlers/permission.ts`、`packages/schema/src/permission.ts`、`packages/schema/src/agent.ts` | 接管清单(§9) | 六个文件在 2.x 都还在,但上游改过(试合并全部内容冲突) | 原样(路径)/ 改形(内容) | L4:先按 2.x 的 `permission.hook.evaluate` 与 `policies` 判能不能退回 L0;退不回的重新接管并在 ADR-047 写理由 |
| K4 | alpha 自有的工具策略族:gate / store / inventory / risk classification / managed policy | `packages/opencode/src/permission/codepuppy-tool-policy-gate.ts`、`codepuppy-tool-policy-store.ts`、`codepuppy-tool-inventory.ts`、`codepuppy-risk-classification.ts`、`codepuppy-managed-policy.ts`、`codepuppy-tool-policy.ts`;路由 `packages/core/src/permission/codepuppy-tool-policy-api.ts` | 所在包被删;挂载点见 K1/K2/P13 | 改形(搬家) | L4:搬进 `packages/ext`(插件内实现,挂 2.x 钩子)或作为 ADR-043 意义下的 alpha 自有文件放进 2.x 包;二选一由 L4 按「谁 import 谁」定 |
| K5 | 工具改名:`bash`→`shell`、`task`→`subagent`、`apply_patch`→`patch` | alpha 非测试源码里带引号的这三个名字:`"bash"` 7 个文件、`"task"` 3 个、`"apply_patch"` 2 个(`grep -rlE '["'"'"']bash["'"'"']' …`) | `v2:packages/core/src/database/v1-migration.bun.ts:996`(`RENAMED_TOOLS`) | 改名 | L4、L6:策略默认值、agent 规则(如计划助手的 `task: {general: "deny"}`)、UI 工具卡、身份账本一并改;安全面 S4 |
| K6 | 工具身份与显示快照(ADR-041) | `packages/schema/src/tool-identity.ts`、`packages/opencode/src/session/tool-display.ts` | 2.x `Tool.Info`(`v2:packages/schema/src/tool.ts`) | 改形 | L4 |
| K7 | Code Mode 子调用 | `packages/opencode/src/tool/code-mode.ts`(接管) | `v2:packages/codemode`、`v2:packages/core/src/codemode` | 改形 | L4:K2 偏离(`code-mode.ts:195-203` 镜像 `isError` 投影)在 2.x 是否还存在由 L4 读后判 |
| K8 | 工具注册表接管 | `packages/opencode/src/tool/registry.ts`、`packages/core/src/tool/registry.ts`、`packages/core/src/tool/application-tools.ts` | 2.x 内置工具都是插件(`v2:packages/core/src/tool/plugin/*.ts`),由 `tool.transform` 增删 | 新增替代 | L4:不再接管注册表,改用 `tool.transform` |

## 7. 会话与 LLM 请求链、提示词

| # | 我们用的 | `origin/alpha` 坐标 | OpenCode 2 坐标 | 状态 | 处置 |
| --- | --- | --- | --- | --- | --- |
| L1r | LLM 请求组装接管(平台头、输出封顶、请求整形) | `packages/opencode/src/session/llm.ts`、`session/llm/request.ts`、`session/processor.ts`、`session/prompt.ts`(均接管) | `v2:packages/core/src/session/model-request.ts`、`session/prompt.ts`;插件挂点 `session.hook["model.request"/"http.request"/"context"]` | 改形 | L3(能走钩子的走钩子)、L4(走不了的才接管) |
| L2r | provider 协议层接管(Anthropic / Gemini / OpenAI chat / responses) | `packages/llm/src/protocols/*.ts`、`packages/llm/src/route/client.ts`(试合并 modify/delete) | `packages/llm` 已更名为 `v2:packages/ai`(试合并「目录改名」冲突:`packages/llm/test/auth-fail-closed.test.ts` → `packages/ai/test/`) | 改名 + 改形 | L4:逐个文件判是否还需要;不需要的删 |
| L3r | 系统提示与 agent 提示接管(ADR-015)+ sync 的提示词绊线 | ext `codepuppy-prompts.ts`、`prompt-rebrand.ts`;绊线 `.github/workflows/sync-upstream.yml:100-102`(`packages/opencode/src/session/prompt packages/opencode/src/agent`) | `session.hook.context.system`;agent 用 `agent.transform`;上游提示所在 `v2:packages/core/src/session/system-prompt.ts`、`v2:packages/core/src/plugin/system-prompt/`、`v2:packages/core/src/agent.ts` | 改形 | L3;绊线路径由 L2 改指 2.x 位置 |
| L4r | 上下文注入库存(`#1284`)与快照 | `packages/ext/src/context-injection.ts:653-666`、`context-injection-inventory.snapshot.txt` | 钩子名全换(P2–P6) | 改形 | L3:按新钩子名重生快照 |
| L5r | websearch 接管(ADR-035 / ADR-046 两条腿) | `packages/opencode/src/tool/websearch.ts`、`tool/mcp-websearch.ts`、`packages/core/src/tool/websearch.ts`(均接管);ext `cloud-websearch-kill.ts` | `v2:packages/core/src/websearch.ts`、`v2:packages/core/src/plugin/websearch/`、插件 `websearch.transform`、配置 `websearch` | 改形 | L3 + L4;ADR-046 的「账户信号只决定云腿在不在」不变 |

## 8. MCP、云工具与第一方连接器

| # | 我们用的 | `origin/alpha` 坐标 | OpenCode 2 坐标 | 状态 | 处置 |
| --- | --- | --- | --- | --- | --- |
| M1 | MCP 运行时接管(含净失败分类、第一方工具发现) | `packages/opencode/src/mcp/index.ts`(接管,`:7-8,57-69` 引 alpha 模块) | `v2:packages/core/src/mcp/index.ts`、`client.ts`、`pool.ts`、`stdio.ts`、`oauth.ts`;依赖 `@modelcontextprotocol/*` 2.3.1(`v2:packages/core/package.json:105-107`) | 改形 | L4;ADR-036 准入判据 ① 在 2.x 成立 |
| M2 | alpha 自有 MCP 文件:第一方 MCP 声明、分支化输入 schema、工具发现 | `packages/opencode/src/mcp/codepuppy-first-party-mcp.ts`、`codepuppy-branched-input-schema.ts`、`codepuppy-tool-discovery.ts` | 所在包被删;挂点 `mcp.transform`(`v2:packages/plugin/src/effect/mcp.ts:15`) | 改形(搬家) | L4 |
| M3 | 云 MCP 安装(`mcp_access` token、代付/缺席两态) | ext `cloud-websearch-kill.ts`(`installCloudMcp`)、`codepuppy-config-injection.ts:368-403` | `mcp.transform` / 配置 `mcp`(`v2:packages/schema/src/config.ts:85`) | 改形 | L3;安全面 S5 |
| M4 | MCP 状态种类(定制中心消费) | `packages/ui-mac/src/renderer/extensions/use-extensions.ts:463-484`(已知 K2 偏离) | `v2:packages/schema/src/mcp.ts` 的状态联合;`GET /api/mcp` | 改形 | L6:顺路改成消费引擎给的种类(偏离登记在 constraints.md 第 4 行,见基线 §2.11) |
| M5 | MCP OAuth(`mcp.auth`) | renderer 1 处(`X.mcp.auth`) | `v2:packages/core/src/mcp/oauth.ts`;2.x 协议里无 `/api/mcp/:server/auth` 形状的接口 | 改形(未核实入口) | L6 核实 2.x 触发 OAuth 的入口 |
| M6 | Office 连接器命令模板与解释器槽 | `packages/ui-mac/src/main/ext-mcp-policy.ts:66-72`、`packages/opencode/src/mcp/codepuppy-first-party-mcp.ts:41-46`(已知 K2 偏离第 6 行) | 同 M2 | 改形 | L4:第四处模板展开随 M2 搬家;不顺带合并另三处(不是「很小」) |

## 9. 接管清单逐条(49 条)

`bash scripts/north-star-guard.sh --print-takeover` 的 49 条,按 OpenCode 2 里还在不在分两组(§0 命令):

- **还在(15)**:`packages/core/schema.json`、`packages/core/src/database/migration.gen.ts`、`packages/core/src/database/schema.gen.ts`、
  `packages/core/src/oauth/page.ts`、`packages/core/src/permission`、`packages/core/src/permission.ts`、
  `packages/core/test/database-migration.test.ts`、`packages/core/test/oauth-page.test.ts`、`packages/core/test/permission.test.ts`、
  `packages/protocol/src/groups/permission.ts`、`packages/schema/src/agent.ts`、`packages/schema/src/permission.ts`、
  `packages/schema/src/v1/session.ts`、`packages/schema/test/contract-hygiene.test.ts`、`packages/server/src/handlers/permission.ts`。
  处置:L4 逐条判「退回 L0 / 重新接管」,重新接管的在 ADR-047 写范围、守卫、回滚与归属(ADR-029 §3)。
- **已不存在(34)**:`packages/opencode/**` 下 22 条(`mcp/index.ts`、`permission/index.ts`、`plugin/index.ts`、
  `server/routes/instance/httpapi/public.ts`、`session/{llm,llm/request,processor,prompt,tools}.ts`、
  `tool/{code-mode,mcp-websearch,registry,websearch}.ts` 与 11 条测试)、`packages/core/src/tool/{application-tools,registry,websearch}.ts`、
  `packages/client/src/generated{,-effect}/client.ts`、`packages/client/src/generated/types.ts`、
  `packages/sdk/js/src/gen/types.gen.ts`、`packages/sdk/js/src/v2/gen/{sdk,types}.gen.ts`。
  处置:随所在文件消失从清单删除;它们承载的能力已在 §1–§8 各行逐项处置。

## 10. 持久化与数据

| # | 我们用的 | `origin/alpha` 坐标 | OpenCode 2 坐标 | 状态 | 处置 |
| --- | --- | --- | --- | --- | --- |
| D1 | 会话库位置:`$XDG_DATA_HOME \|\| ~/.local/share` + `/opencode/opencode.db`(prod/beta 无后缀) | `packages/ui-mac/src/main/db-safety.ts:6-7,36-51` | `v2:packages/cli/src/database-path.ts:4-12`(同一规则,channel ∈ latest/dev/beta/next/prod ⇒ `opencode.db`) | 原样 | 安全面 S7:与独立安装的 OpenCode 共用同一个库与数据目录(今天就是,`packages/ui-mac/src/main/data-clear-boot.ts:172` 自己写着) |
| D2 | 迁移水位表与 DB 安全带(待前进 ⇒ 先备份;库超前 ⇒ 阻断) | `db-safety.ts:15,85-106,215-240`;构建期清单 `packages/ui-mac/scripts/gen-db-expected.ts` | 2.x 迁移执行器 `v2:packages/core/src/database/migration.ts:24-60`(有 `session`/`session_v2` 表 ⇒ 只跑未完成的),`:84-100`(旧无名 `__drizzle_migrations` 里有对不上的时间戳 ⇒ 直接 die) | 原样(机制)/ 新增 21 条迁移 | L2:清单生成器读 2.x 的 `migration.gen.ts`;L1 拿真库副本实测一次前进迁移 |
| D3 | alpha 自有两条迁移(`permission_decision`、`permission_request` 两张表) | `packages/core/src/database/migration/20260720085655_permission-decision-receipt.ts`、`20260720094009_permission-request-admission.ts` | 2.x 不认识这两个 id;无表名冲突(§0) | 改形 | L4:随 K3 定去留;2.x 约定嵌入方自有表用 `_` 前缀(`v2:packages/core/src/database/migration.ts:26-29`),新表照此 |
| D4 | v1 会话历史(`message`/`part` 表)在新代次可见 | v1 引擎读写;用户的全部旧对话 | 2.x 的 v1→v2 会话转换 `v2:packages/core/src/database/v1-migration.bun.ts`(`transformSession` `:227`、`run` `:541`);**只在 bun 条件下生效,node 条件解析到空实现**(`v2:packages/core/package.json:67-73`,`v1-migration.noop.ts` 恒报 `completed`) | 改形(嵌入式宿主下缺失) | L1 实测补法(基线 §2.8);补不上 ⇒ 待 owner 裁决 O1 |
| D5 | 旧凭证文件导入 | Code Puppy 不读引擎的 `auth.json`(`packages/ui-mac/src/main/codepuppy-byok-keys.ts:4,9`) | 2.x 迁移 `20260805200742_import_legacy_credentials` 读 `<data>/auth.json` 写进 `credential` 表(`v2:packages/core/src/database/migration/20260805200742_import_legacy_credentials.ts:39-52`) | 新增(风险) | 安全面 S2/S7;L1 实测:本机 `~/.local/share/opencode/` 下当前**没有** `auth.json`(只有 2 字节的 `mcp-auth.json`) |
| D6 | v2 durable 表里 ADR-036 时期留下的失败记录 | ADR-036 §后果:`session_message` 8 条孤儿 | 2.x 会话表结构已变(`20261029002625_session_part` 等) | 不处置 | 沿用 ADR-036 已有结论(老数据处置在范围外) |

## 11. 前端(pin + SOT 补丁 + renderer)

| # | 我们用的 | `origin/alpha` 坐标 | OpenCode 2 坐标 | 状态 | 处置 |
| --- | --- | --- | --- | --- | --- |
| F1 | 前端 pin `e11dbd0206`(2026-08-21,在 v1 分叉点之前) | `frontend/frontend-pin.lock:1` | 2.x 的 `packages/app` 是重排过的 v2 应用(顶层:`composer/home/new-session/session/settings/shell/workspaces…`) | 改形 | L6:pin 与引擎**同一个 SHA**(前端停在 v1 而引擎是 v2 = 半代次) |
| F2 | SOT 补丁 114 个文件(i18n 63、pages 15、context 15、components 10 …) | `frontend/codepuppy-patches/codepuppy-frontend.patch`(`grep -c '^diff --git'` = 114) | 目标文件大多已删或搬家(试合并 `packages/app` 118 个冲突,多为 modify/delete) | 改形 | L6:在新 pin 上重建,只留仍需要的部分 |
| F3 | ui-mac 用的 `@opencode-ai/app` 根导出 23 个 | §0 命令 | 2.x 根导出只有 `AppBaseProviders`、`AppInterface`、`preloadRoute`、`Platform`、`PlatformProvider`、`ServerConnection`、`FatalRendererErrorLog`(`v2:packages/app/src/index.ts:1-5`);缺 `useServerSync`、`useServerSDK`、`useCommand`、`useLayout`、`useTabs`、`useServer`、`useWslServers`、`Settings*`、`Locale`、`loadLocaleDict`、`normalizeLocale`、`ACCEPTED_FILE_EXTENSIONS`、`AppSurfaces`、`DraftSurfaceProps`、`MaybePreloadableComponent`、`createPermissionChannelSource` 共 18 个 | 删除 / 改形 | L6:数据层改用公开包 `@opencode/client/solid`(`createData` `v2:packages/client/src/solid/data.ts:264`、`createClientConnection` `connection.ts:40`;2.x 的 app 自己有 13 个文件这样用);其余逐个找 2.x 对应或经 SOT 补丁重新导出 |
| F4 | `AppSurfaces` 类型接缝、REQ-088 窄导出、随包 client tarball(sync 的三个响亮失败) | `docs/architecture/upstream-integration.md:29-43`;`.github/workflows/sync-upstream.yml:202-239` | 2.x 的 `session-ui` 与 `app` 直接依赖工作区 `@opencode/client`(`v2:packages/session-ui/package.json:74`、`v2:packages/app/package.json:63`) | 改形 / 删除(tarball) | L2 + L6:tarball 与 `#1272` 的步序问题在 2.x 消失,对应判据改写;`AppSurfaces` 接缝随 F3 重建 |
| F5 | renderer 页面所有权:16 个 codepuppy、1 个 hybrid、2 个来自 `packages/app` 的路由跳转 | `packages/ui-mac/src/shared/frontend-surface-manifest.ts`(`lineage` 计数) | 2.x `packages/app/src/app.tsx` | 改形(仅 2 条跳转) | L6 |
| F6 | `@opencode-ai/ui` / `session-ui` 的组件与主题(约 15 处 import) | `grep -rhoE "from ['\"]@opencode-ai/(ui\|session-ui)[^'\"]*" packages/ui-mac/src` | `v2:packages/ui`、`v2:packages/session-ui`、`v2:packages/theme` | 改名 + 改形 | L6 |
