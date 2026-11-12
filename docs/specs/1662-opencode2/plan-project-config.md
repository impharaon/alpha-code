---
id: PLAN-1662-opencode2-project-config
title: 项目配置在 OpenCode 2 上照 0.1.26 生效 实施计划
summary: alpha-code#1662 跟进(lane/1662-project-config)——项目 `.codepuppy/codepuppy.jsonc` 的四个缺陷:同意后项目 agent 的权限规则不生效、JSONC 读法改坏字符串、项目 MCP 字段丢失或形状不对、项目 agent 的旧 provider id 不改名
kind: plan
status: active
spec: ""
design: ""
owners: [alpha-code desktop maintainers]
last_reviewed: 2026-11-12
---

# PLAN-1662-opencode2-project-config｜项目配置在 OpenCode 2 上照 0.1.26 生效 实施计划

由实施会话在计划阶段写,编排器核对后由同一会话实施。决定只链接、不重述;实施中偏离本段,在同一个提交里改本段。

## 依据与范围

- 依据:编排器派发书「project configuration defects found by a design review — hold them in #1662」(四项);缺陷出处是设计稿
  `docs/specs/upgrade-extension-manifest/design.md`(alpha-code-design-upgrade-i06-extension-manifest 工作树)§2 的 F-02、F-03、F-09、F-14 与 §10 审查记录 M2、M5、m1 和留档第 2 行。
  **只恢复 0.1.26 的行为**,不实现那份设计的新架构(登记器、启动文档交接 `ConfigNormalize`)。代码基线 `lane/1662-project-config` @ `778f44a41c`。
- 不碰:`plugin-fanout.ts`、`policy/identity.ts`(项目插件命名空间缺陷在另一条线)。
- 核对:`39e6d55ca2` · 编排器 · 通过(抄上游三个小函数 + 比对测试登记为闸门文件;规则先后保持 2.x —— 用户自己的全局规则压过项目的,记偏离与登记册 note、不修;同意后项目 agent 可放宽,照 0.1.26 只记录;真 `edit` 工具先试接进宿主,退回须写明不证明什么;最后一个提交给接缝文档加第 8 个共享模块那一行)。

### 为什么照抄上游的三个小函数,而不是 import

第 1、3、4 项要用上游 v1 配置迁移里的三样:权限动作改名 `normalizeAction`、MCP 条目翻译 `migrateMcp`、旧 provider id 改名 `providerID`,都在
`packages/core/src/v1/config/migrate.ts`(`:27-32`、`:81-107`、`:175-180`)。这个模块在顶层 import 了引擎服务模块 `../../provider.js`、`../../model.js`
(`migrate.ts:11-12`;`provider.ts:3-19` 再 import Bus、Integration、Location、`@opencode/util/runtime-import`、`@opencode/ai/effect` …)。ext 打成自包含 bundle
(ADR-006,`packages/ext/scripts/build.ts` 不设 external),import 它就会把引擎的服务模块整套复制进插件;设计稿 F-09 记的是同一个事实。所以这三样**按上游逐字抄成纯函数**,
放在 `packages/ext/src/engine-transforms.ts`,每个注明出处行号;新测试 `engine-transforms.test.ts` 用**装着的上游**(`ConfigNormalize.normalize`,即引擎读用户文件的那条路,
`core/src/config.ts:138-148`)对同一份 v1 文档逐字段对比,上游一改即红。改名表另有一条从上游函数源码取出全部改名项、与抄本比集合的漂移锁。

## 第 1 项 —— 同意后,项目 agent 的权限规则生效

- **0.1.26**:`mergeProjectConfig` 在项目已同意时把 agent 条目原样(含 `permission`)并进 cfg,没同意时剥掉 `permission/model/disable/mode`
  (`git show origin/alpha:packages/ext/src/project-config.ts` `:151-155`、`:184-199`;调用处 `origin/alpha:packages/ext/src/plugin.ts:224`);
  v1 引擎再把 `permission` 合并到该 agent 上,agent 级覆盖全局(`origin/alpha:packages/opencode/src/agent/agent.ts:293`)。
  出厂技能 `agent-creator` 正是这样指导模型登记「只读助手」的(`origin/alpha:packages/ui-mac/resources/factory-skills/agent-creator/SKILL.md:31,40`)。
- **2.x 今天**:同意判定与剥离还在(`packages/ext/src/project-config.ts:151-159`),但翻译 `applyAgents` 只写 system / description / mode / model,
  `permission` 一律不写(`packages/ext/src/engine-transforms.ts:76-98`)⇒ 同意过的项目里,`agent-creator` 写出的 `edit: deny`、`bash: deny` 不生效,这个助手照样能改文件。
- **修法**:`applyAgents` 在条目带 `permission` 时把它翻成 2.x 规则推进该 agent 的 `permissions`:字符串 ⇒ `{action, resource:"*", effect}`;对象 ⇒ 每个 `[pattern, effect]` 一条;
  键按书写顺序(上游同样按 `Object.entries` 保序,`core/src/v1/config/permission.ts:9-19`),动作名经抄来的 `normalizeAction`(`bash`→`shell`、`task`→`subagent`、
  `write/patch/apply_patch`→`edit`)。没同意时 `permission` 早已被 `mergeProjectConfig` 剥掉,`applyAgents` 不需要另判。
- **改动**:`packages/ext/src/engine-transforms.ts`(`applyAgents`、抄来的 `normalizeAction`、注释里删掉「`permission` 一律不写」);测试见下。
- **证明**:
  - `plugin-host.test.ts` 新用例(真宿主、真权限服务、ext 生产默认导出;项目文档用 `agent-creator` 第 40 行那份样本):已同意 ⇒ `reader` 用上游真实的 `edit` 工具
    (`core/src/tool/plugin/edit.ts`,它在 `file-write.ts:74` 断言 `edit` 权限)改项目里的文件 ⇒ 被拒、文件不变;**反向臂**:同一份文档、未同意 ⇒ 同一次编辑生效。
    已知的坏(实跑后 `git restore`):`applyAgents` 不写规则 ⇒ 已同意那一臂也改成了文件,用例红。
  - `engine-transforms.test.ts`:同一样本经 `applyAgents` 得到的规则,逐条等于 `ConfigNormalize.normalize({ agent: { reader: … } })` 的 `agents.reader.permissions`
    (含 `bash`→`shell` 与 `read` 的两条模式规则);去掉改名 ⇒ 红。

## 第 2 项 —— JSONC 读法不改坏字符串,两处共用一个读法

- **0.1.26**:同一个缺陷早已存在 —— 自写剥离器对整段文本跑尾逗号正则(`git show origin/alpha:packages/ext/src/project-config.ts` `:251`)。这一项是修缺陷,不是回到 0.1.26。
- **2.x 今天**:ext `stripJsonc`(`packages/ext/src/project-config.ts:220-256`,正则在 `:255`)被 `mergeProjectConfig`(`:137`)与 `register.ts:39` 用;
  main 抄了一份(`packages/ui-mac/src/main/codepuppy-ext-trust.ts:56-90`,正则在 `:90`,`listProjectExecutables` 用,`:43`)。
  `{"command":{"c":{"template":"x,}"}}}` 读出 `x}`(设计稿 F-14 实跑);`register` 读进来再整份写回,把改坏的字符串落盘。
- **修法**:新建一个读法 `packages/ui-mac/src/shared/project-jsonc.ts`(零业务依赖,只依赖 `jsonc-parser`,ui-mac 已依赖 3.3.1,引擎同版本):
  `parse(text, errors, { allowTrailingComma: true })`,有错 ⇒ 视为坏文件(与引擎读配置同一调用与判法,`core/src/config.ts:137-146`)。
  ext 的 `mergeProjectConfig`、`register.ts` 与 main 的 `listProjectExecutables` 都改用它;两份 `stripJsonc` 删除。放在 `ui-mac/src/shared/` 是因为方向只能是 ext → ui-mac
  (先例 `shared/attachment-path`、`shared/project-hidden-dir`);`jsonc-parser` 从该文件所在包解析,ext 不新增依赖声明。
- **改动**:新 `packages/ui-mac/src/shared/project-jsonc.ts`;`packages/ext/src/project-config.ts`、`packages/ext/src/register.ts`、`packages/ui-mac/src/main/codepuppy-ext-trust.ts`。
- **证明**:
  - `register.test.ts`:现有文件含 `"template":"x,}"`、注释与尾逗号 ⇒ 经 `applyRegister` 登记一条新 agent 后写回的文本里仍是 `x,}`,新条目在;坏 JSONC 仍拒写。
  - ext 读路径:`mergeProjectConfig` 读同一份文档,合进来的命令模板是 `x,}`(加在现有的项目配置测试里)。
  - main:`codepuppy-ext-trust.test.ts` 用名字里带 `,}` 的 MCP 键(`"srv,}"`),`listProjectExecutables` 列出的正是 `srv,}`。
  - 已知的坏(实跑后 `git restore`):把共用读法换回正则剥离 ⇒ 三条都红(`x}`、`srv}`)。

## 第 3 项 —— 项目 MCP 的 `cwd`、`timeout`、`codemode`、OAuth 按 2.x 读的形状传

- **0.1.26**:项目 MCP 条目原样并进 cfg(`git show origin/alpha:packages/ext/src/project-config.ts` `:145`),v1 引擎直接读这些字段:
  `cwd`(`origin/alpha:packages/opencode/src/mcp/index.ts:661`)、`timeout`(`:583`、`:686`)、OAuth 的 `clientId`(`:550`);字段定义见 `origin/alpha:packages/core/src/v1/config/mcp.ts:11,20,27,34`。
- **2.x 今天**:`toServerConfig`(`packages/ext/src/engine-transforms.ts:34-49`)丢掉 `cwd`、`timeout`、`codemode`;OAuth 原样传驼峰,而 2.x 运行时只读下划线字段
  (`packages/core/src/mcp/oauth.ts:159,372,418`)。同一条目经上游读用户文件那条路得到的是带 `cwd` 与三段 `timeout` 的定义(设计稿 F-02 实跑)。
- **修法**:`toServerConfig` 按抄来的 `migrateMcp`(`core/src/v1/config/migrate.ts:81-107`)补齐:`cwd`;`timeout` 数字 ⇒ `{startup, catalog, execution}`;`codemode`;
  OAuth `clientId/clientSecret/scope/callbackPort/redirectUri` ⇒ `client_id/client_secret/scope/callback_port/redirect_uri`,`oauth:false` 保留。只补缺(全局优先)的规则不变。
- **改动**:`packages/ext/src/engine-transforms.ts`(`toServerConfig`);新 `packages/ext/src/engine-transforms.test.ts`;`plugin-host.test.ts` 一条断言。
- **证明**:
  - `engine-transforms.test.ts`:本地条目 `{type, command, cwd, environment, enabled:false, codemode:false, timeout:9000}` 与远程条目
    `{type, url, headers, oauth:{clientId, clientSecret, scope, callbackPort, redirectUri}, timeout}`、`oauth:false` 三份,`toServerConfig` 的结果逐字段等于
    `ConfigNormalize.normalize({ mcp: { s: entry } })` 的 `mcp.servers.s`;已知的坏:今天的 `toServerConfig` ⇒ 缺 `cwd` / `timeout`、OAuth 是驼峰,红。
  - `plugin-host.test.ts`「权威 · 项目可执行扩展的同意」那条:已同意后宿主 MCP 编辑器收到的项目条目带 `cwd` 与三段 `timeout`(只扩夹具与断言,不改用例名)。

## 第 4 项 —— 项目 agent 的旧 provider id 按引擎的规则改名

- **0.1.26**:项目 agent 的 `model: "azure-cognitive-services/…"` 原样并进 cfg,v1 引擎认得这两个 provider id
  (`origin/alpha:packages/opencode/src/provider/provider.ts:322`、`:595`),agent 能用。
- **2.x 今天**:这两个 id 在 2.x 已经没有;上游读用户文件时把它们改名(`packages/core/src/v1/config/migrate.ts:66-72` 的 `modelSelection` 调 `providerID`,表在 `:175-180`),
  ext 的 `modelRef`(`packages/ext/src/engine-transforms.ts:69-74`)不改名 ⇒ 项目 agent 指向一个不存在的 provider。
  项目命令的 `model` 在 2.x 上本来就不生效(插件的命令接口没有模型,`engine-transforms.ts:21-23`),所以只改 agent。
- **修法**:`modelRef` 的 provider 段经抄来的 `providerID`(`azure-cognitive-services`→`azure`、`google-vertex-anthropic`→`google-vertex`)。
- **改动**:`packages/ext/src/engine-transforms.ts`(`modelRef`、抄来的 `providerID`);`engine-transforms.test.ts` 加用例。
- **证明**:
  - `engine-transforms.test.ts`:`azure-cognitive-services/gpt-x`、`google-vertex-anthropic/claude-y`、`openai/gpt-z` 三个 agent,`applyAgents` 写出的 provider 逐个等于
    `ConfigNormalize.normalize({ agent: … })` 的 `model.providerID`;漂移锁:从上游 `ConfigMigrateV1.providerID` 的函数源码取出全部字符串字面量、筛出它会改名的那几个,集合必须等于抄本的键。
    已知的坏:去掉改名 ⇒ 前两个红;往抄本里多写或少写一项 ⇒ 漂移锁红。

## 顺序

1. **第 2 项**(共用读法)一个提交:跑 `packages/ext` 的 `register.test.ts`、`project-config.test.ts`、`plugin-host.test.ts`(读路径),`packages/ui-mac` 的 `codepuppy-ext-trust.test.ts`;两包 typecheck;ext 打包。
2. **第 3 项**一个提交:新 `engine-transforms.test.ts` + `plugin-host.test.ts`;ext typecheck。
3. **第 4 项**一个提交:`engine-transforms.test.ts`。
4. **第 1 项**一个提交:`plugin-host.test.ts` 新用例 + `engine-transforms.test.ts`;同时跑 `src/policy/register-policy.test.ts`(策略按 agent 读已配置规则,`catalog.ts` 的 `configured`)。

每个提交带本文件对应节的偏离记录与 `scripts/gate-files.tsv` 的条数同步(`plugin-host.test.ts` 是闸门文件;新 `engine-transforms.test.ts` 断言的是上游行为,登记为闸门文件)。
全部只跑相关测试,`~/.bun-versions/1.4.4/bin` 在 PATH 首位,共享预载隔离 HOME / XDG。

## 风险

- **R1 项目 agent 规则与用户全局规则的先后和 0.1.26 相反。** v1 是「全局在前、agent 覆盖」(`origin/alpha:packages/opencode/src/agent/agent.ts:293`);2.x 里 ext 的
  `agent.transform` 先于上游的配置 agent 插件,后者再把用户文件里的顶层 `permission` 推到每个 agent 末尾(`core/src/config/plugin/agent.ts:71`)⇒ 用户若写了顶层规则,它压过项目 agent 的同名规则。
  受影响面:本机用户文件没有 `permission`(设计稿 F-10),除本机外零租户。本段不修;要修需要像策略目录尾规则那样在激活后登记(`catalog.ts` 的 `ensureTail`),作为观察交回。
- **R2 同意后项目 agent 也能放宽权限**(如 `edit: allow`),与 0.1.26 相同;同意框只列 MCP 与插件(设计稿留档第 1 行)。本段照 0.1.26,不改同意语义,作为观察交回。
- **R3 抄来的三个函数会和上游漂移。** 由 `engine-transforms.test.ts` 用装着的上游逐字段对比、改名表用源码漂移锁兜住;每日同步跑到它就红。
- **R4 上游的 `edit` 工具要的服务(`FileWrite`、`FileMutation`、`Formatter`)不在 ext 的插件测试层里。** 先照 `packages/core/test/tool-edit.test.ts` 的托管方式把它们接进宿主;
  接不上就退回「真权限服务对该 agent 断言 `edit`」(即 `file-write.ts:74` 那一次),并在偏离记录写明。
- **R5 `jsonc-parser` 与旧剥离器的差别**:单引号字符串、注释、尾逗号的接受面以引擎为准;旧剥离器接受、`JSON.parse` 再拒的输入,新读法同样拒(坏文件照旧不注入、`register` 照旧拒写)。
- **R6 ext 多了一个 import 的 ui-mac 模块**(`shared/project-jsonc.ts`),接缝冻结 §4 列的是 7 个;本段不改那份文档,作为观察交回。

## 证明一览

| 项 | 测试/证据 | 缺少行为为什么会失败 |
| --- | --- | --- |
| 1 | `plugin-host.test.ts` 新用例:已同意 ⇒ 真 `edit` 被拒、文件不变;未同意 ⇒ 编辑生效;`engine-transforms.test.ts` 规则 = 上游归一化 | 不写规则 ⇒ 已同意也改成文件;不改名 ⇒ `bash` 规则对不上 `shell` |
| 2 | `register.test.ts` 往返、项目配置读路径、`codepuppy-ext-trust.test.ts` 的 `srv,}` | 正则剥离 ⇒ `x}`、`srv}` |
| 3 | `engine-transforms.test.ts` 三份 MCP 条目 = 上游归一化;`plugin-host.test.ts` 同意用例里的字段 | 今天的翻译缺 `cwd`、`timeout`,OAuth 是驼峰 |
| 4 | `engine-transforms.test.ts` provider = 上游归一化 + 改名表漂移锁 | 不改名 ⇒ `azure-cognitive-services` 原样;抄本与上游不齐 ⇒ 漂移锁红 |

## 偏离记录

- 2026-11-12 · 第 3 项:翻译没有改 `toServerConfig` 本身,而是新加 `projectServerConfig`(在它之上补齐),只给项目 MCP 用。原因:云 MCP 的安装也调 `toServerConfig`
  (`cloud-websearch-kill.ts:440`,传入 main 按 2.x 形状写好的定义并加 `enabled: true`),装进去的条目要与定义逐字相等才铸 `codepuppy-cloud`
  (`packages/plugin/src/alpha-cloud-authority.ts` `governedMcpEvidence`);改共用函数会让它多出 `disabled: false`、OAuth 换名,云工具的权威就铸不出来(实测:三条云测试红)。
  同一原因,只有项目条目照上游把 `enabled: true` 写成 `disabled: false` · 第 3 项提交。
