---
id: DESIGN-secrets-usable-not-visible
title: 密钥文件程序可用、助手不可见 技术设计
summary: 共享保护名单与非密钥规则；工具输出在命令前后采集后整份发布，遮盖失败只交付固定说明；冻结已批准的 shell 捕获接缝与接管登记。
kind: tech-design
status: frozen-pending-review
spec: SPEC-secrets-usable-not-visible
spec_version: 2
review:
  rounds: 0
  reviewed_sha: ""
  verdict: ""
owners: [owner]
last_reviewed: 2026-11-26
---

# DESIGN-secrets-usable-not-visible｜密钥文件程序可用、助手不可见 技术设计

本设计对应 #1758，按已批准规格 v2 冻结为 `frozen-pending-review`，供独立审查；这不是审查通过或实施完成。成功结果改写沿用已核探针；SC-01 接管授权、采集边界和遮盖失败的隐藏语义已由 owner 裁决（§10）。本轮只改变 v2 及其直接后果，不重开名单、权限和组件复用的既有决定。

## 1. 基线

- Spec：[SPEC-secrets-usable-not-visible v2](spec.md)，#1765 的固定输入提交 `834e269da977f6b4888c3b7a6a268bfe835d9cf5`；用 `git show 834e269da977f6b4888c3b7a6a268bfe835d9cf5:docs/specs/secrets-usable-not-visible/spec.md` 复核。v1 的证据随原设计提交 `ef920c7580` 继承，不再是当前范围基线。
- 覆盖：BR-01..BR-07、AC-01..AC-08；成功结果改写能力沿用 §2 证据。AC 是后续实施的义务，本文探针不代替验收。
- 输入收据：owner 2026-11-26 在协调仓安全意图原始记录 U-38 对三项问题回答「好的。」；本票消费其中 SC-01 授权、前后可读值边界及失败整次隐藏，均已落入规格 v2。继承 Windows 发布时真机验收和「复用工具卡文本区、无需 frames」约定。自动化仍消费 [SPEC-unattended-run-permissions v2](../unattended-run-permissions/spec.md) BR-03。
- 背景：规格[来源](spec.md#来源)所指的协调仓安全意图 I-45、讨论 P-06/P-08。只回查了对应讨论，未重新裁决已批准的「程序可用」「全部批准读项目外文件不问」和原样匹配边界。
- 代码证据基线：`9f08c506d9842d319616c7e45c33d3b9c3279e48`，引擎包版本 `2.2.5`，Bun `1.4.4`、Node `26.13.1`。r1 已执行授权的 `git fetch && git merge origin/alpha`，无冲突，合并提交 `7fe85d4e71`；对 Tool、Shell、Ext hook 与两份 ShellHooks 的定向 diff 为空，沿用原行号与探针结论。上游另含脚本/测试改动，仅按合并接收，未扩项修改。

## 2. 地面真相

r0 调查仅回答结果出口、名单/权限权威及采集保证。r1 继承不变结论，只核对 v2 对整次输出发布、失败兜底和接管登记的影响；现有 callable 或明确新增接缝足以支撑决定即停止。

| 已观察的事实 | 证据与结论 |
| --- | --- |
| 成功 hook 的改动会成为最终结果 | `packages/core/src/tool.ts:163-179` 把 `afterEvent.result` 交回调用者；`packages/plugin/src/promise/tool.ts:47-65` 允许替换 `result`。`packages/ext/src/plugin.ts:224-231` 已在成功分支替换不符云契约的结果。 |
| 结果进入历史之前还有截断和发布 | `packages/core/src/session/runner/step.ts:98-125` 先执行工具、再 `ToolOutput.truncate`、再发布；`packages/core/src/session/runner/publish-llm-event.ts:561-578` 发布成功正文和 metadata；`packages/core/src/session/projector.ts:1112` 投影成功事件；模型从 `packages/core/src/session/runner/to-llm-message.ts:114-137` 读取投影后的工具正文/错误。因此在执行后、发布前改写可同时覆盖模型、历史和终态卡片。 |
| MCP 与 Code Mode 子调用同样经过工具执行器 | `packages/core/src/tool/mcp.ts:67-146` 将 MCP 文本、structured、错误转成 Tool 结果；`packages/core/src/tool.ts:274-279,346-360` 的 Code Mode 子调用走 `run`，继而经过相同 before/after。不能只处理 `shell` 或 `content`。 |
| 进度早于 after，不能靠终态修补 | `packages/core/src/session/runner/publish-llm-event.ts:548-558` 直接发布 progress；`packages/ext/src/policy/display.ts:43-70` 已用 `tool.transform` 包装 `context.progress`。运行卡可以先见到 metadata，错误终态还会合并最后一份进度。 |
| shell 另有实时出口和后台持久化 | `packages/core/src/shell.ts:333-355` 将 `handle.all` 原字节写文件；`:208-235` 的 `output` 读取该文件。`packages/session-ui/src/tools/tool-renderer.tsx:2262-2277` 跟随输出，`packages/app/src/shell/routes/session-ui-provider.tsx:212` 接到 `api.shell.output`。`packages/core/src/tool/plugin/shell.ts:210-239` 将捕获文本交给 Job，`:144-173` 又直接产生 synthetic 通知。只遮盖 after 会漏实时卡片、Job 与后台通知。 |
| shell 暂无输出改写 hook | `packages/plugin/src/effect/shell.ts:11-13` 与 Promise 对应契约只有 `create.before`。`PluginHooks.trigger` 顺序执行并保留原事件对象（`packages/core/src/plugin/hooks.ts:88-96`），宿主 `packages/core/src/plugin/host.ts:500` 和 Promise adapter `:660-662` 已泛型转发 shell hook；新增输出事件无需另建 IPC。 |
| 受保护路径目前只是风险探针 | `packages/ext/src/policy/risk.ts:149-164` 的凭据路径正则只有抬风险用途，并非读文件或结果遮盖规则。其余系统文件风险不能因提取密钥名单消失。 |
| 直接读可以在物理读取前替换 | `packages/plugin/src/promise/tool.ts:25-35` 的 editor 可更新已有执行器。原 read 在 `packages/core/src/tool/plugin/read.ts:104` 调用 `FileAccess.authorizeRead`；后者先 external_directory、再 read（`packages/core/src/file-access.ts:147-166`）。安全视图可在原执行器之前返回，避免先审批再遮盖。 |
| 项目外 ask 不区分读写 | `packages/ext/src/external-directory-rule.ts:20,38-52` 给 build 与询问档注入相同 `external_directory` ask；`packages/ext/src/plugin.ts:412-418` 消费它。整条删除会同时放松写和 shell 的目录审批，超出 BR-05。 |
| deny 不能被 evaluate hook 放宽 | `packages/core/src/permission.ts:232-247` 在触发 hook 前返回已配置 deny。三档例外必须由安全视图实现，并去掉交互载体中与之冲突的 `.env` 专用规则；不能假设 hook 能翻转任意 deny。 |
| 自动化有独立的现成识别权威 | `packages/ext/src/policy/unattended.ts:30-42` 的 `unattendedProfile` 同时识别在册会话和请求 agent；档位来自 `packages/schema/src/codepuppy-unattended.ts:5-9`。不得靠新建 agent 名单或单看名字推断自动化。 |

### 成功结果探针：规格「待决」已解决

在临时目录建探针，复用 `packages/core/test/tool-registry.test.ts:41-54` 的真实 Tool/PluginHooks layer 及 `packages/core/test/lib/permission.ts`。Image 只提供一个未被调用的报错实现；工具执行器、结果校验、hook 分发和 `snapshot.execute` 都用生产实现，不用手写引擎替身。输入是进程内生成的 UUID，不读取用户文件，不输出值。

命令（工作目录 `packages/core`）：`bun test /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-design-probe-163ty__y/hook.test.ts`，exit **0**，`1 pass / 0 fail / 5 expect() calls`。临时文件不入仓。探针核心为：

```ts
// 注册返回同一 UUID 的 text、output.value、metadata.value，且先 progress({ value })。
const control = yield* snapshot.execute(call("control"))
expect(JSON.stringify(control)).toContain(value)
const registration = yield* hooks.register("tool", "execute.after", (event) =>
  Effect.sync(() => {
    if (event.status !== "completed") return
    event.result = {
      content: [{ type: "text", text: "[REDACTED]" }],
      output: { value: "[REDACTED]" },
      metadata: { value: "[REDACTED]" },
    }
  }),
)
const rewritten = yield* snapshot.execute(call("rewritten"))
expect(JSON.stringify(rewritten)).not.toContain(value)
expect(rewritten.output).toEqual({ value: "[REDACTED]" })
expect(progress[1]).toEqual({ value }) // after 没有保护更早的 progress
yield* registration.dispose
expect(JSON.stringify(yield* snapshot.execute(call("disabled")))).toContain(value)
```

**观察**：成功结果确实可改写，去掉 hook 的对照重新暴露输入，结论能被证伪。**推断**：将遮盖接入这个时点后，持久化和模型将消费遮盖结果；完整三消费者的真引擎证据仍属于实施验收。after 本身不需要接管引擎。

### 文件采集反例：不能冒充全称保证

另一临时探针用真子进程一次完成：创建 `.env` → 写入随机 TOKEN → 原样输出文件 → 删除文件。父进程在命令前、后各检查一次文件。命令 `node /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-snapshot-probe-qh3gl5eb/probe.mjs`，exit **0**，只输出：`beforePresent=false, afterPresent=false, capturedValue=true, childExit=0`。没有输出或复制 TOKEN。

**观察**：原样输出也可能从未被前后两次采集见到。此反例在 r0 是规格缺口，现已由规格 v2 BR-03 和限制表明确排除；加密保存、由程序解密后才输出的值同样排除。普通 watcher 不成为明文采集权威，也不新增 watcher。§4 按前后可读值实现，不再要求超出 v2 的全称保证。

**r1 发布时点裁决（设计推导，非已实现行为）**：若运行中先显示一段正文，结束后才采集到其中的秘密值，或后续遮盖失败，已经显示/投影的前缀无法撤回。故 BR-03 的后采集与 BR-07/AC-08 的「整段隐藏」共同要求正文整份提交：运行卡只先显示可信运行状态，正文在命令结束、后采集与整份遮盖成功后发布；失败则只发布固定说明。这里没有新增用户确认、执行前等待条件或命令时限，子进程与原有后台执行照常运行。r0 的逐 chunk 提前发布决定据此被替换。

## 4. 接口契约

### 4.1 单一名单与非密钥规则

共享纯契约放在现有 Schema 模块的 Code Puppy 自有文件，命名空间 `ProtectedFiles`。名单、示例排除、格式与 BR-06 判定同一权威、随应用发布；不增加用户设置、环境开关或第二份扩展名单。read、采集、风险分类都调用它。实现可选择私有的数据结构，以下消费边界固定：

```ts
type PathPlatform = "darwin" | "win32"
type ProtectedFormat = "env" | "ini" | "json" | "assignments" | "netrc" | "credential-url" | "opaque"
type ProtectedPathVariable = "AWS_SHARED_CREDENTIALS_FILE" | "AWS_CONFIG_FILE" | "DOCKER_CONFIG" | "KUBECONFIG" | "GNUPGHOME" | "GOOGLE_APPLICATION_CREDENTIALS" | "CLOUDSDK_CONFIG" | "AZURE_CONFIG_DIR"
type ProtectedRoots = {
  platform: PathPlatform
  project: string
  directory: string
  home: string
  appData: string       // win32：Roaming；darwin：Library/Application Support
  localAppData: string  // win32：Local；darwin：Library
  pathVariables: Readonly<Partial<Record<ProtectedPathVariable, string>>>
}
type ProtectedFile = {
  rule: string
  path: string
  format: ProtectedFormat
  view: "variables" | "notice"
}
// 同一份规则同时提供发现范围、路径匹配、命令载荷中的路径风险匹配。
declare const ProtectedFiles: {
  sources(roots: ProtectedRoots): readonly {
    root: string; include: readonly string[]; exclude: readonly string[]
  }[]
  match(input: { path: string; roots: ProtectedRoots }): ProtectedFile | undefined
  probe(input: { text: string; roots: ProtectedRoots }): readonly string[] // 命中 rule ID
  isPublicValue(input: { name: string; value: string }): boolean
}
```

roots 全部必填，由宿主实际目录事实提供，不从工具输出或模型参数覆盖；没有机器绝对路径默认值。路径传入仍遵守现有 read 输入校验。`match` 是总函数：不适用返回 undefined，不读取文件，不请求权限。`probe` 只按同一 sources 的模式做词法探测，不能另抄受保护路径正则；无法从命令推断某个动态路径属于既有风险标注能力的边界，不影响匹配已解析文件。

现有 `classifyPermissionRequest` 的输入增加必填 `protectedRoots: ProtectedRoots`；permission、patterns、always、metadata 的形状与结果维持原契约。调用方从同一 Location 的 SecretMask 路径事实供数，不在分类器里做 IO，也不从审批 metadata 反推可信根。现有 gate 和能力轴调用共同消费这一个参数，不能让无根调用退回另一张旧正则表。

首版名单的范围如下。表是本设计定下的发布数据，不是让实施者自行补一份名单；`**` 包含子目录，不因 `.gitignore` 跳过受保护文件，递归按真实目录身份去重以终止符号链接环。

| 位置 / 文件族 | 格式与直接读视图 |
| --- | --- |
| 项目任意层级 `.env`、`.env.*`；末尾为 `.example`、`.sample`、`.template` 的示例除外 | env / variables；排除必须先于 include |
| 项目任意层级 `.envrc`；`secret` 或 `secrets` 的 `.env/.json/.yaml/.yml/.toml`；`credentials.json` | `.envrc` 与 YAML/TOML 用 assignments，其余按扩展名；均 notice，不执行 shell/YAML 标签/插值 |
| 项目的 `config/master.key`、`config/credentials/*.key`、`config/credentials*.yml.enc`；项目私钥容器 `*.pem/*.p12/*.pfx` | opaque / notice |
| 项目及主目录的 `.netrc`、`_netrc`、`.npmrc`、`.pypirc`、`.git-credentials` | netrc、ini、credential-url / notice |
| 主目录 `.ssh/**`，公开文件 `*.pub`、`authorized_keys`、`known_hosts`、`config` 除外 | opaque / notice；非默认文件名的私钥仍能发现 |
| 主目录 `.aws/credentials`、`.aws/config`、`.docker/config.json`、`.kube/config` | ini、json、assignments / notice |
| 主目录 `.azure/msal_token_cache*`、`.azure/accessTokens.json`；gcloud 目录的 `application_default_credentials.json`、`credentials.db`、`access_tokens.db` | JSON 用 json，数据库/缓存用 opaque；notice |
| GnuPG 目录的 `private-keys-v1.d/**`、`secring.gpg`；macOS `Library/Keychains/**`、`*.keychain`、`*.keychain-db` | opaque / notice |
| 浏览器 profile 的 `Login Data`、`Cookies`、`Network/Cookies`、`logins.json`、`key4.db`，以及其 SQLite `-wal/-shm` 伴随文件；Chromium 的 `Local State` | JSON 用 json，其余 opaque / notice；不把全部浏览器缓存或历史纳入名单 |
| Windows 用户凭据目录 `Microsoft/Credentials/**`、`Microsoft/Vault/**`、`Microsoft/Protect/**` | opaque / notice；Roaming 与 Local 两个根分别匹配 |

主目录产品路径具体展开见 §4.2。现有风险器中 `/etc/passwd`、`/etc/shadow`、`/etc/sudoers` 的系统风险仍由原风险权威持有，不冒充本名单中的密钥文件。风险器只移除已归入 ProtectedFiles 的重复路径定义，其余规则与风险档位不变；命中本名单仍通过原有 `credential-path` 信号抬到已有风险档。

BR-06 是键名和语法值联合判定，默认非空值是秘密，不用最短长度、熵或「看起来短」豁免：

| 明显非密钥的发布规则 | 返回公开的条件 |
| --- | --- |
| 端口 | 大小写不敏感的 `PORT` 或 `_PORT` 结尾，值是十进制合法 TCP/UDP 端口 |
| 开关 | `DEBUG`、`CI`、`ENABLED`、`DISABLED`，或 `_ENABLED` / `_DISABLED` 结尾；值只取 `true/false`、`yes/no`、`on/off`、`0/1`（大小写不敏感） |
| 环境名 | `NODE_ENV`、`APP_ENV`、`ENVIRONMENT`；值只取 `development/dev/test/testing/staging/stage/production/prod/local` |
| 空值 | 不构成可匹配的秘密，保留空值 |

键名以非字母数字边界拆词后含 `KEY/TOKEN/SECRET/PASS/PASSWORD/CREDENTIAL/AUTH/PRIVATE` 时，优先作为秘密，不因后缀像端口而豁免。`PASSWORD=1234` 仍遮盖。公开字段只决定这个来源不贡献该匹配值；若另一个秘密字段恰好也是同一个值，仍按规格已接受的同值误遮处理。未知格式不授予公开豁免。

### 4.2 Windows 与 macOS 路径

Windows 的 home 使用宿主 `os.homedir()`（一般为 USERPROFILE）；APPDATA、LOCALAPPDATA 使用宿主进程的实际值，缺席时分别以 home 下 `AppData/Roaming`、`AppData/Local` 推导。比较使用 `path.win32`：统一 `/` 和 `\`、盘符/路径大小写、`.` / `..`、UNC 与 `\\?\` 表示；按完整路径段匹配，不能用字符串前缀把 `.ssh-copy` 算作 `.ssh`。macOS 保持本平台路径语义，不把 Windows 的不区分大小写规则无条件套到 Unix 路径上。

物理读取前同时判定词法路径与 `realpath` 目标，任一命中即保护；发现符号链接/Windows reparse point 时用真实身份去重。程序看到的文件和链接都不改动。Windows 上真实文件身份、junction/短文件名需要真机证明，纯 `path.win32` 推断不能充当这份证据。

| 内容 | macOS 根 | Windows 根 |
| --- | --- | --- |
| SSH、AWS、Docker、Kubernetes | home 下 `.ssh/.aws/.docker/.kube` | home 下同名目录；Kubernetes 文档明确使用 USERPROFILE |
| GCP / Azure | `~/.config/gcloud`、`~/.azure` | `%APPDATA%/gcloud`、`~/.azure` |
| GnuPG | `~/.gnupg` | `%APPDATA%/gnupg`；另识别 `~/.gnupg` |
| 钥匙串 / 用户凭据 | `~/Library/Keychains` | `%APPDATA%/Microsoft/{Credentials,Vault,Protect}` 与 `%LOCALAPPDATA%/Microsoft/{Credentials,Vault,Protect}` |
| Chrome / Chromium / Edge / Brave | `~/Library/Application Support/{Google/Chrome,Chromium,Microsoft Edge,BraveSoftware/Brave-Browser}` 下每个 profile | `%LOCALAPPDATA%/{Google/Chrome,Chromium,Microsoft/Edge,BraveSoftware/Brave-Browser}/User Data` 下每个 profile |
| Firefox | `~/Library/Application Support/Firefox/Profiles` | `%APPDATA%/Mozilla/Firefox/Profiles` |

已查公开一手依据：[OpenSSH 配置根](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-server-configuration)、[AWS 凭据位置](https://docs.aws.amazon.com/sdkref/latest/guide/file-location.html)、[GCP ADC](https://docs.cloud.google.com/docs/authentication/application-default-credentials)、[Azure 配置根](https://learn.microsoft.com/en-us/cli/azure/azure-cli-configuration)、[Kubernetes 用户配置](https://kubernetes.io/docs/tasks/access-application-cluster/configure-access-single-cluster/)、[Chromium 数据目录](https://github.com/chromium/chromium/blob/main/docs/user_data_dir.md)、[Firefox profile](https://support.mozilla.org/en-US/kb/profiles-where-firefox-stores-user-data)、[GnuPG 厂商位置说明](https://www.gnupg.com/kb/backup-restore.html)、[Microsoft 用户凭据目录](https://learn.microsoft.com/en-gb/fslogix/concepts-container-types)。Edge/Brave 的具体目录、Vault/Protect 的组合与各格式提取尚未真机核验，不能宣称 AC-07 已通过。

应用不增加凭据路径设置。已有工具的显式路径环境变量（如 AWS_SHARED_CREDENTIALS_FILE、DOCKER_CONFIG、KUBECONFIG、GNUPGHOME、GOOGLE_APPLICATION_CREDENTIALS）若作为来源使用，必须由这同一名单解析；宿主当前环境的这些路径补充默认根而不是替换默认保护，不把环境变量的值发给模型。不会声称可发现子进程临时设置、注册表或任意命令参数指定的一切自定义存放点，见 §10 的范围缺口。

### 4.3 采集者、快照与存放

扩展在引擎 Location 内建立一个私有 `SecretMask` 实例，读取宿主项目和主目录；不让模型发一个「收集密钥」工具调用，也不把内容交给 main/UI/插件 storage。Schema 只持有纯名单，不能持有值或做 IO。

采集时点固定为每次工具执行前，以及该次输出完成、准备发布时；shell 的前采集在同一 capture 的 start 阶段、真实 spawn 之前，后采集在合并输出流关闭后、捕获文件发布前。重新枚举 sources，不以 mtime 相同为由跳过必需的前后读取；同次输出使用前后可读值的并集。读到的新值保留至 Location 释放，不因删文件、轮换或并发调用提前撤销旧值。Location setup 先登记出口再可预采集；预采集失败不能让插件 setup 失败或替代调用前后采集。不加 TTL、数量/长度上限、定时扫描或 watcher。

单个来源的 `ENOENT`、`EACCES`、`EPERM` 表示本次不存在或不可读，按 v2 的可读值范围不贡献新值，不把这种正常范围判定当作 masker 故障；后采集仍重新判定，之前已读到的值仍保留。其它无法完成采集的异常、解析器/匹配器/结果处理异常才进入 BR-07。受保护 env 的直接读取若被 OS 拒绝，仍是既有具名读错误；不回退到原文，也不增加系统解锁或批准步骤。

每次工具调用按 `(sessionID, messageID, id)` 持有私有输出状态；shell 合并 stdout/stderr 按 `shellID` 持有一次完整捕获状态，后台调用早先返回的「已转后台」回执与此完整捕获是两个不同输出。状态只有 `pending → ready | withheld`；ready 发布后不再启动第二次可能失败的遮盖事务。一个调用失败不污染下一次调用、其它 shell 或 Location。

只开放处理能力，不开放取出秘密的 API：

```ts
import type { Tool } from "@opencode/schema/tool"

type MaskCall = { sessionID: string; messageID: string; id: string }
type MaskedRead = {
  output: { type: "text-page"; content: string; mime: "text/plain"; offset: number; truncated: boolean; next?: number }
  content: readonly { type: "text"; text: string }[]
  metadata: { truncated: boolean }
}
// Location 私有对象，不是工具、RPC、HTTP 或可序列化服务。
type SecretMask = {
  begin(call: MaskCall): Promise<void>
  read(input: { call: MaskCall; file: ProtectedFile; offset?: number; limit?: number }): Promise<MaskedRead>
  result(input: { call: MaskCall; result: Tool.Result }): Promise<Tool.Result>
  error(input: { call: MaskCall; error: Tool.Error }): Promise<Tool.Error>
  progress(input: { call: MaskCall; update: Tool.Metadata }): Promise<Tool.Metadata>
  stream(input: ShellCapture): Promise<ShellCapture>
}
```

六个新方法是本设计决定新增的扩展实现。`begin` 将前采集错误记为该次 withheld，仍让原工具运行；其余方法收口内部 refresh/解析/匹配/投影异常，返回安全结果，不向执行器抛出遮盖错误。`progress` 只返回原有可信 display/已核实内置工具的运行标识；工具自报正文和任意 metadata 仅暂存最后一份，合并进同次终态后一起处理。调用结束即释放原始结果/进度缓冲；后台 shell 的缓冲持有至自身 end，不随最初回执结束而销毁。

`Tool.*` 是现有 Schema 的 namespace，与 `@opencode/plugin/promise/tool` 重新导出的 Result/Metadata/Error 为同一契约；`ShellCapture` 见 §4.5。Schema 同一权威导出固定常量 `MASKING_FAILED_TEXT = "这次输出没能遮盖，已隐藏"`；该常量只用于确定的遮盖失败分支，不经过 masker。原始值和错误片段不进入诊断、metadata、storage、trace；诊断最多含 rule ID、路径和 OS 错误码。

格式策略：env 使用 Node 内置 [`util.parseEnv`](https://nodejs.org/api/util.html#utilparseenvcontent) 的静态解析，绝不执行文件或展开变量；json 使用静态 JSON 解码并递归取标量；ini/netrc/credential-url 与 assignments 只提取其文本里的标量和私钥块，不执行 include、命令、YAML 标签或 shell substitution。assignments 是保守的文本词法采集，不伪称完整 YAML/TOML 解释器：同时保留原样右值、去语法引号的值、多行原文，未解析段作为不透明正文采集。解析不成功不能把该文件当普通内容交回模型。

opaque 采集原始文件内容、私钥完整块及非空私钥正文行；二进制保存原始字节匹配材料，不解密钥匙串、DPAPI 或浏览器口令，不触发系统解锁弹框。这符合规格 v2 的前后可读值边界；加密数据库经程序解密才出现的明文属于已批准排除项，不请求系统解锁，也不把排除项扩大到本来可读的明文值。

原值仅在引擎进程的该实例内存和读取缓冲区中短暂/驻留；不写会话、事件、日志、trace、UI、磁盘缓存或崩溃报告。JS 字符串释放不是可证明的内存擦除；本设计不宣称能抵抗读进程内存、原生插件或调试器的攻击者。

### 4.4 直接读：变量视图与说明视图

只包装身份权威确认的内置 `read`，不凭一个第三方工具恰好叫 read 就给它豁免。安全视图在原物理读和 `authorizeRead` 之前分流：

1. 先消费现有 `unattendedProfile`。在册自动化及自动化载体继续走已有 deny，不进入交互豁免；不改自动化注入的 `*.env*` deny。
2. 词法路径和真实目标命中名单：返回安全视图；不调用原 read，不发 read / external_directory 审批。三种交互档一致，主目录私钥也不问。
3. env 返回所有变量名；秘密值统一 `[REDACTED]`，BR-06 公开值保留。注释和未解析内容不原样带回；无法解析的部分显示遮盖说明。其它受保护文件只返回「这是密钥文件，值不提供给助手；程序运行时照常能用。」不返回私钥、公钥派生信息或附件。
4. 正常结果沿用 read 的 TextPage 形状和分页输入；先构造安全文本，再应用现有分页语义。说明固定放入工具卡正文，env 视图也带相同说明。原目标不存在仍是具名读失败；安全视图/遮盖出错则返回同形 TextPage 的固定失败说明（§5），不退回原始读。
5. 未命中名单：执行原 read；只在 §4.6 指定的全部批准项目外读取上取消目录 ask。

交互注入中的 `.env` ask / deny 与安全视图冲突，删除这些专用条目，不把受保护模式再生成进配置；read 的其它规则继续由既有权限权威解释。build 的上游底座不接管：安全视图根本不触发它的原始 read 审批。用户明确停用整只工具的既有规则仍由工具策略权威执行，本票不扩权到停用工具。

### 4.5 通用工具结果与 shell 捕获

遮盖符固定为 `[REDACTED]`，说明固定为规格原句；没有新配置键。源文件/子进程环境/传给程序的入参不改动。

通用结果在现有 `execute.after` 的扩展处理尾部，**所有现有云校验、错误归因与 display metadata 附加之后**执行。成功结果同时处理 content、output、metadata；错误重建 `Tool.Error`，遮盖 message、metadata，移除可能携带原文的内层 error/cause；没有捕获失败后返回原对象的分支。结构化 output 的标量若命中秘密可变为遮盖字符串，不能重新跑原工具输出 schema 把这份安全结果拒掉；当前执行器正是在输出校验之后运行 after（§2 已观察）。

文本按原样、左到右、同位置最长值优先替换；一次替换不递归处理新遮盖符，避免值重叠泄漏或二次遮盖污染。覆盖嵌套 JSON 的字符串和数值标量、动态键名、metadata；协议 envelope 的 type、调用 ID 等引擎结构字段保持合法，不能因误遮把 Tool.Content 判别联合破坏。动态键名遮盖产生碰撞时，该对象以一个遮盖符代替，不能把两个不同字段拼成新的泄漏内容。

Tool.Content 的文本、文件 uri/name 都属于处理面。内联 data URI 先按协议还原载荷再查原样值；文本载荷可替换后重编码；二进制载荷命中时以一个 text 遮盖符替换该文件 content，避免把损坏的图/PDF交给模型。文件引用如果指向受保护文件则换说明；非保护文件的内联字节同样检查。只检查原始字节，不承诺 OCR、解密、解压或程序额外编码的识别。MCP 非内联二进制资源已保存到普通工具产物时，后续读取仍经过同一结果遮盖，不能把产物路径当作安全证明。

进度使用现成 `tool.transform` 包装方式，原回调只接收可信运行状态/display，不先发布工具自报正文或任意 metadata。原始最后一份进度留在调用内，终态到达时用后采集快照与结果一起处理；失败时直接丢弃。不把多次传输更新各自定义成「一次输出」来规避整段隐藏。目录重建重放同一包装，覆盖后到 MCP；不增加 UI redactor。

Code Mode 子调用经相同 after，才将结构化结果交给受限 JS；外层终态也处理自身新生成的输出。`packages/core/src/codemode/tool.ts:203-234` 的外层进度仅调用状态/输入摘要，不含结果正文，错误状态来自已处理的子调用。已核实内置 shell 的 stdout/stderr 只由 capture 的 start/end 事务持有，不再由普通 begin/result 重启一次遮盖；其终态消费同一安全捕获，最初转后台回执只含可信运行标识。不同 Code Mode 子调用仍各是一次输出，不因一个失败而隐藏其它已完成结果。

**已批准接管 SC-01**：shell 捕获写盘前新增 `shell.capture` hook，复用现有注册与泛型转发。Effect/Promise 两份 ShellHooks 使用同一事件契约：

```ts
import type { Shell } from "@opencode/schema/shell"
import type { ShellCreateBefore } from "@opencode/plugin/promise/shell"

type ShellCapture = {
  readonly id: Shell.ID
  readonly phase: "start" | "chunk" | "end"
  readonly withheld: boolean // Core 持有的本次失败锁存，后续事件只读可见
  bytes: Uint8Array
  disposition: "hold" | "publish" | "withhold"
}
interface ShellHooks {
  readonly "create.before": ShellCreateBefore
  readonly capture: ShellCapture
}
```

触发者是 `Shell.create` 的同一捕获生命周期：已有 ID 后、spawn 前触发 start，输出 pump 触发 chunk，流关闭后触发 end。规则消费者仍是扩展同一 SecretMask。Core 负责 hook 交付、失败锁存、写入顺序和固定失败说明，既不读取秘密文件，也不实现第二份名单或匹配器。用已有 `PluginHooks.has` 在创建时判定是否进入 capture 事务；它只是存在性判断，不提供回调快照。无 hook 的裸引擎保留其普通捕获路径；已经进入事务后始终默认 disposition=hold，即使重载移除了回调也不能改回透传。Code Puppy 的 start/chunk 仅收集字节。start/end 输入 bytes 为空。callback 必须将安全 bytes/disposition 写回原事件，不能只 return 新对象期待 hooks.trigger 采用它。end 覆盖正常、错误、超时/用户取消导致的流关闭，不另添超时或改变取消语义。

| 阶段 / 结局 | 扩展与捕获边界的确定行为 |
| --- | --- |
| start | 前采集并建立该 shellID 的快照/缓冲；失败返回 withhold，Core 锁存后仍 spawn。前采集不依赖稍后才出现的 tool progress.shellID，避免原输出已开始才关联快照。 |
| chunk，pending | 原始合并字节仅留在进程内；返回空 bytes + hold。文件保持空，`size=cursor=0`，实时卡显示运行态，正文尚不可读。处理跨 UTF-8/chunk 的原样匹配由最终拼接解决，不设自行选择的缓冲 cap。 |
| end，遮盖成功 | 做后采集，取前后并集，一次遮盖完整字节；返回安全 bytes + publish。只有此时写捕获文件，更新安全 size/行数，然后关闭 stream、打开 outputDone。模型/卡片/Job 均只消费这份封存结果。 |
| 任一 chunk/end 遮盖失败 | 立即锁存本 shell 的 withheld，清除原始缓冲；之后继续消费、丢弃输出，直到子进程照常结束。end 只交付 `MASKING_FAILED_TEXT`，不交付成功前缀、附件或原文路径。 |
| hook 意外 reject/defect，未能自行返回 withhold | Core 在**该次 hook 调用**外用 `Effect.exit` 捕获非外部取消的回调失败，锁存 withheld，不写入入参 bytes，继续 drain 真实子进程。end 同样写固定说明，不把遮盖错误传播成命令失败、取消或重跑；真正的用户取消仍按原行为处理。原来 pump 外层忽略错误不构成此保证，必须在写盘前收口。 |

在有 capture hook 的事务中，Core 只允许 end/publish 完成一次发布；start/chunk 提前 publish 或 end 仍 hold 都作为本次捕获遮盖协议失败进入 withhold。withheld 一旦成立，之后的 callback 或部分结果不能解除。固定说明直接取 Schema 常量，guard 不再调用可能已损坏的 masker。初始化/进程创建阶段的前采集失败也只锁存失败，不拦住 spawn；原有命令/权限本身的错误、退出码、signal、timeout 仍由原执行链给出。原始字节既不写临时文件，也不交付 progress/事件或 Job。

捕获文件对消费者由 `size=0` 进入封存状态；文件内容写入完成才更新可见 size，再打开 outputDone，所以既有 `Shell.output` 轮询看不到半份文件，`Shell.result` 与 Job 也不会抢先落盘。对机器文件写入失败沿用原执行器 IO 错误，不把 OS 写盘失败冒称为遮盖成功；本票的遮盖失败路径不通过写入任何原文来回退。

捕获写盘之后的 foreground tool / Job / synthetic 通知不再启动一次遮盖。已核实内置 shell 的结果投影只消费封存捕获以及可信的 exit/signal/status 元信息；遮盖失败时输出正文保持固定说明，退出码仍可见。后台的最初回执只含运行标识，最终完成输出属于 shellID 的捕获事务。这样无需另加 synthetic hook，也不会出现「先写 Job 原文、再隐藏卡片」的窗口。普通连接器、读取与其它工具仍在自己的终态事务中处理，不因名字相同而获得 shell 的可信投影路径。

接管面仍仅为 `packages/core/src/shell.ts:290-355` 同一捕获生命周期的 start、写入与 end/失败收口、`packages/plugin/src/{effect,promise}/shell.ts` 的同一事件类型；host/adapter 的泛型转发不变。Schema 自有常量可由 Core 与 Ext 合法共同引用。SC-01 已获 U-38 授权；登记落点和责任边界固定在 §10。本设计不改 Server HttpApi、Client 或模型执行器，不切换引擎代次。

### 4.6 只取消全部批准档的项目外读取 ask

不删 build 的整条 external_directory 规则。由现有 `external-directory-rule` 权威持有其读操作例外，扩展现有 permission.evaluate 消费；不在 UI、gate、风险器各建档位表。

执行前用既有工具身份事实记录当前内置 read 调用的 `(sessionID, messageID, id)`，结束/失败后删除。permission 事件只有同时满足「source.type=tool、完整调用键对应已核实内置 read、agent 为既有全部批准载体、action=external_directory、当前 effect=ask、非自动化」才改为 allow。最终匹配的是执行中的调用而不是 metadata 自报工具名。不改变显式 deny、不写持久 grant、不放宽无 source 的请求。

询问档仍走原目录 ask，只读档对普通项目外文件仍由原 deny 处理；安全视图的名单内读取走 §4.4。write/edit/patch/shell 等动作在原 external_directory 规则下运行。风险分类始终仅提供说明，不能以「高风险」重新增加一次审批。

### 4.7 能力接缝图

「新增」表示本设计已经决定的实现能力；「raise」表示引擎缺口与接管决定，不能伪装为现有 callable。表只映射能力和合法边界，不是文件改动清单或工作单元。

| 所依赖的能力 | 合法 callable / 明确新增或 raise | 消费者与边界 |
| --- | --- | --- |
| 修改全部类型的成功/错误终态 | `Context.tool.hook("execute.after", ...)`，`packages/plugin/src/promise/tool.ts:47-71`；`Tool.executeTool`，`packages/core/src/tool.ts:155-179`，已实测 | 扩展 SecretMask；覆盖内置、插件、MCP、Code Mode 子调用与外层终态 |
| 覆盖运行期进度 | `Context.tool.transform` / `ToolEditor.update`，`packages/plugin/src/promise/tool.ts:25-35`；既有 `wrapForDisplay`，`packages/ext/src/policy/display.ts:43` | 原回调只交付可信运行态；正文暂存至整次提交，目录重载自动重放 |
| 保护直接读并保留 read 形状 | 同一 `ToolEditor.update`；现有 `ReadToolFileSystem.TextPage`，`packages/core/src/tool/read-filesystem.ts:81-88` | 新增 `SecretMask.read`；复用形状，不导入 Core 服务实现 |
| 判定受保护文件 / 输出发现范围 / 风险路径 | 新增 `ProtectedFiles.sources/match/probe/isPublicValue`，冻结于 §4.1 | Schema 纯权威；read、采集、risk 消费同一发布数据 |
| 可信地采集与处理值 | 新增 Location 私有 `SecretMask` 及 §4.3 的六个方法及 Schema 失败说明常量；IO 用 Node `fs/promises` 的 `readdir/realpath/readFile/stat`，env 用 `node:util.parseEnv` | 仅采集前后可读值；异常进入 §5 的本次隐藏状态 |
| 实时 shell / 输出文件 / Job / 后台通知 | **raise SC-01**：§4.5 `ShellHooks.capture`，接在真实 `Shell.create` pump 写盘前 | 当前无 callable；U-38 已批准新增；hold/publish/withhold 覆盖所有消费者，不依赖 synthetic hook |
| 遮盖异常转成隐藏，命令继续 | 新增 §4.3 六方法的总回调收口、§5 固定说明投影；SC-01 内用已有 `PluginHooks.has`（`packages/core/src/plugin/hooks.ts:43-47,97-102`）、Effect 的 `Effect.exit` 捕获该次 callback 失败 | 有 hook 默认 hold，Core 写盘前兜底；不依赖 callback 一定能自行生成安全结果，不把异常传播为子进程中断 |
| 真实退出码继续可见 | `Shell.result`（`packages/core/src/shell.ts:238-267`）保留实际 info，`ShellResult.metadata`（`packages/core/src/shell/result.ts:36-42`）投影 exit/signal/timeout | 隐藏只替换正文，不把遮盖错误写入进程退出状态，不从第三方自报字段伪造真实退出码 |
| 识别自动化并保留原拒绝 | `createUnattendedState().unattendedProfile`，`packages/ext/src/policy/unattended.ts:30` | 沿用现有在册状态和 AUTOMATION_PROFILES |
| 取消读目录 ask、保留其它权限 | `Context.permission.hook("evaluate", ...)`，`packages/plugin/src/promise/permission.ts:18-32`；`externalDirectoryRules/placeAfterBase`，`packages/ext/src/external-directory-rule.ts:38,59` | 新增读调用关联与该权威的操作判定；不声称可翻转已提前返回的 deny |
| 风险标注与当前卡片呈现 | `classifyPermissionRequest`，`packages/ext/src/policy/risk.ts:730`；`attachTerminal`，`packages/ext/src/policy/display.ts:67` | 复用既有风险信号和 Tool.Content 文本，末尾再遮盖 |
| 存储和模型消费 | `publisher.toolExecution`，`packages/core/src/session/runner/publish-llm-event.ts:561`；`toolResult`，`packages/core/src/session/runner/to-llm-message.ts:114` | 消费现有安全结果，不增加持久 schema、重放补丁或 UI 接缝 |

## 5. 数据与失败

不新增数据库、持久化 schema、凭据存储或历史清洗。新输出在 ready/withheld 确定后才进入现有事件与投影事务；不修改旧记录。原值只在私有内存缓冲中参与遮盖，不落原始捕获文件。无自动重跑命令、用户确认或新增执行时限。

BR-07 的「一次输出」固定为一个工具调用的终态正文及其尚未发布的正文进度；shell 是一个 shellID 的完整合并输出，包含后台完成输出。运行标识/工具身份/真实退出码不是输出原文，仍使用既有结构显示。状态一旦 withheld，整份动态 content、output、metadata、附件、error/cause、outputPath 均不保留；禁止返回部分已遮盖片段或用原对象兜底。

通用成功结果的隐藏形状为下列已有 Tool.Result，不增加协议字段；Code Mode 的 `resultValue`（`packages/core/src/codemode/tool.ts:350-356`）在无 output 时会消费同一 text：

```ts
const hiddenResult: Tool.Result = {
  content: [{ type: "text", text: MASKING_FAILED_TEXT }],
  // 不带原 output、动态 metadata、附件或产物路径。
  // 原有可信 display 和实际命令退出状态，由宿主确定的字段单独附回。
}
```

安全 read 返回同一固定说明的 TextPage（offset=1、truncated=false、无 next）；不是普通视图再追加说明。工具自身已经失败时仍返回 Tool.Error，message 仅为固定说明，去掉内层 cause/error 与工具自报 metadata；不把失败改为成功。原工具成功且只是遮盖失败时保持调用成功，尤其不改变子进程真实退出码。固定说明不再经过 masker，避免失败处理递归失败；总回调外的异常收口同样使用这个无 IO 的形状。

| 失败窗口 | 收口与消费者结果 |
| --- | --- |
| 前采集失败 | 在调用/shell 内锁存 withheld；命令仍启动并运行，结果阶段只提交固定说明。 |
| 后采集、标量提取、匹配、附件处理或结果构造失败 | 尚无正文被发布；丢弃整份缓冲，Tool 终态只交付说明及可信执行状态。单个来源不存在/不可读按 §4.3 处理；已有可解析格式错误按既定 opaque 策略处理；其处理本身出错才进入此失败分支。 |
| 任意 progress 处理失败 | 运行态仍可显示；该次调用终态锁存隐藏，不发出原始 update，不让该异常中断正在执行的工具。 |
| shell chunk/end 或 Promise hook reject/defect | SC-01 的写盘前 guard 锁存并继续 drain；捕获文件不含任何成功前缀或原字节，最终只有固定说明。真实退出码仍按原链路进入结构化状态。 |
| 后台完成 | Job 只在 outputDone 后取得已封存捕获；它和随后的 synthetic 消费同一正文，所以文件、后台卡、模型和历史同时只有说明。首次「转后台」回执不携带完成输出，不等同于提前提交原文。 |
| 并发/重载 | 调用键与 shellID 分区；局部失败不影响其它输出。正常捕获持有缓冲至 end；若重载提前撤销了回调/丢失缓冲，Core 仍保持该 shell 的 capture 模式，缺失或无法识别 start 状态的后续回调必须 withhold；end 未获得完整结果也隐藏。原始缓冲随旧实例释放，命令继续，不能把注册消失当作退出事务后透传的理由。 |

外部进程仍按原文件与环境使用秘密；捕获失败只改变交付给助手/卡片/记录的正文。源文件轮换不与程序读取做共同事务；前后快照并集实现 v2 的已批准范围，临时生成后删除和解密后才出现的值不承诺遮盖，不再构成设计待决。

## 6. 架构落点

对应现有 [模块地图](../../architecture/modules.md) 与 [架构约束](../../architecture/constraints.md)。均在已有包内增加自有职责，不新增包或顶层模块；不移动主进程的凭据存储权威，不调用另一代引擎 API。

| 责任 | 模块位置与依赖 | 复用权威 / 约束结论 |
| --- | --- | --- |
| 保护名单、公开值判定、平台路径匹配 | Schema 的纯 Code Puppy 契约；不依赖 Core/Server/UI | K2 收敛：风险器、read 和遮盖不再各持名单 |
| 私有值采集、安全 read、通用结果/进度遮盖 | Ext 的 Location 生命周期；依赖 Schema、公开 Plugin API、Node IO | 不 import Electron main 私有模块；工具身份、自动化仍复用现有权威 |
| shell 捕获出口 | Core 调用已有 PluginHooks，事件类型归 Plugin；不反向依赖 Ext | SC-01 是明确必要接管；规则实现仍归扩展，不把名单写入上游 pump |
| 档位注入与项目外审批 | UI main 消除交互 `.env` 专用冲突；Ext 原权限权威解释操作例外 | K1 不新建档位载体列表；自动化原规则和非读取 ask 保持原义 |
| 历史、模型与卡片 | 现有投影、历史降层和工具文本区 | 不添 UI redactor、frames、客户端协议或新权限卡 |

复用原则：固定名单是业务常量，roots 是已有宿主路径事实，均不是新增用户配置；跨平台路径在共享权威实现一次；所有数据错误不含秘密。现有风险探针的输入扫描 cap 不得继承给秘密结果遮盖，不能借性能理由新加秘密长度或结果长度限制。

被否决的替代：

- OS 拒读名单：程序也读不到，违反 BR-04。
- 只遮盖模型请求或 UI：数据库或另一消费者仍保留原值，违反 BR-03。
- 只写 after：探针与 shell 调用链证明进度、实时卡片和后台持久化会先漏。
- 只删 build 的 external_directory ask：同时放松写入类目录审批，超出 BR-05。
- 只按 API key 前缀/长度识别：普通密码、短值、自定义 token 不满足保证；BR-06 必须按发布规则而非猜测。
- 依靠 watcher 承诺覆盖命令内部临时值：超出 v2 已批准范围且没有证明。
- 正文逐 chunk 提前发布、失败后再清 UI/改记录：无法撤回已经显示或持久化的前缀，也不能应用后采集的新值；r0 选择被 BR-03/BR-07 的共同约束替换。
- 遮盖失败后返回原文、只隐藏终态卡或停止命令：分别违反 BR-07 或 BR-04；v2 只授权本次输出隐藏，不授权新确认和停执行。

安全边界：可信方是宿主、发布名单、引擎/扩展实现及进程内存；不可信输入包括模型发起的命令、文件内容、工具/MCP 返回值。连接器执行时照常读文件，服务器与程序已经接触值不属于「未给模型」的证明。已批准的残留是原样同值误遮、程序编码/拆分、前后不可读的临时生成后删除值及加密存储经程序解密才输出的值；用户粘贴、应用自有凭据和阻止程序联网按规格排除。任意原生插件读内存、外部程序直接联网、OS 数据库解密没有在本票得到新的防护承诺。

不变量：源文件不改；秘密集合/原始输出缓冲不出进程；运行态不夹带输出正文；每次正文先用前后快照整份处理、再发布；shell 捕获文件只含封存安全结果或固定说明；遮盖失败不停止命令；名单与公开值只有一个权威，风险标签不改变权限。源值覆盖边界严格继承规格 v2，不另加容量、时限、确认或采集范围排除。

## 8. 拆分决定

不适用跨仓拆分；Schema、Ext、Core、Plugin、桌面宿主在同一仓。SC-01 是上游接管权限边界，不是另开跨仓接口或顺序 Task。后续实施需消费经裁决和审查冻结的 §4；不能在未映射的出口上先行实现。

## 9. 回滚

不适用。没有数据迁移、不可逆数据改动或规格要求的回退路径；不设计旧版本行为或兼容期。

## 10. 裁决与审查结论

### 已定技术选择（适用规格 v2，冻结待独立审查）

| 送审前裁决 | 依据 |
| --- | --- |
| 现有 execute.after 足以改写成功结果，已解决的待决不重开 | §2 真实 Tool.snapshot 对照探针 exit 0；引擎相关源码定向 diff 为空 |
| 名单、格式和非密钥规则由 Schema 一份发布权威持有 | BR-01/BR-06、K2；§4.1 的 callable 明确新增；本轮不改产品名单 |
| 安全 read 在物理读/assert 前分流，自动化不走交互豁免；项目外只放松内置 read 的 build ask | BR-02/BR-05；复用既有身份、目录规则和自动化权威 |
| 前后可读值的并集决定整份正文，原值/原始结果仅留私有内存 | v2 BR-03/BR-04；§4.3 的采集与存放边界 |
| 整份输出只提交一次；运行中显示状态，正文在结束后才发布 | v2 BR-03 的后采集与 BR-07/AC-08；不能先发前缀再追认遮盖。明确取代 r0 的流前缀提前发布，不改执行、后台运行或退出码 |
| 遮盖失败隐藏本次全部正文，固定说明不再进入 masker，异常不传播为命令中断 | v2 BR-07；§4.5 的捕获 guard 和 §5 各消费者收口，失败锁存不可解除 |

### Owner 裁决与接管登记

**O-1 已批准。** 2026-11-26，协调仓安全意图原始记录 U-38（第 147 行起），owner 引用问题「引擎改动：是否允许改一处引擎代码，让命令输出里的密钥也能被遮盖。我建议允许。」后回答「好的。」。本轮 brief 明确转交批准范围为 SC-01：Shell pump 写盘前的同一 capture hook、Effect/Promise 同形事件、规则仍在扩展。§4.5 的失败锁存与固定说明是同一写盘边界满足 v2 BR-07 的必要收口，不另接管 synthetic、Tool 执行器或模型层。

**O-2 已解决。** 同一 U-38 的「好的。」批准前后可读值边界及「出错时把那一次的输出整段隐藏」；规格 v2（`834e269da9`，#1765）已落实 BR-03、BR-07、AC-08 与限制表。本设计按这些已批准条款收敛，不再保留 r0 的未批准范围缩小、隐藏输出待决或 BLOCKED 条件。没有新增 owner-only 决策。

SC-01 的登记权威固定如下；这是架构边界决定，当前设计提交不修改规则或运行登记资产：

- 新增接管 ADR 落在现有运行规则 ADR 命名空间，使用当前空闲的 `.claude/rules/adrs/ADR-050-secrets-output-capture.md`，记录 U-38、规格 v2、为何公开 hook 不足及上述三个最小接管面；不重写已批准的 ADR-047 代际决定。
- 现有唯一权威册 `docs/architecture/codepuppy-authority-registry.json` 新增决策 ID `secrets-output-capture`。该条的 `takeovers` 只列 SC-01 的 Core pump 和两个 ShellHooks 面，`mechanism` 指向实际持有遮盖规则的扩展实现；`adr`/来源关联 ADR-050、#1758 与 U-38。真实实现和证明到位时登记已有格式所需的 proof 引用，不填不存在的测试、不登记成 blocked 项。
- 上游准入逐文件登记在既有 `scripts/north-star-guard.sh:124` 的 `UPSTREAM_EXCLUDES`。CI 在 `.github/workflows/codepuppy-ci.yml:126-133` 直接调用同一脚本；不重建已经消除的第二张 CI excludes 表。沿用既有 parity/authority judge；不能只加包级豁免，也不能只在本设计写「允许接管」就认为已登记。守卫 `:117-118` 的旧说明仍提到双表，与当前调用接线不符，本票只消费实际单一权威，不修该旁观注释。

这些登记与 SC-01 实现同一行为变更生效；本轮仅冻结构与授权，不伪造已实现机制或验证证据。后续审查消费规格 v2、本节 owner 来源及 §4/§5 的发布/失败契约。

### 检查收据

| 轮 / 范围与版本 | 检查方 | 结论与证据 | 遗留去向 |
| --- | --- | --- | --- |
| r0 作者自查；代码 `9f08c506d9`、规格 v1、原设计 `ef920c7580` | Codex / GPT-6（作者，非独立审计） | 成功结果正反探针、进度先行、shell 实时/后台出口与快照反例已核，两项最终探针 exit 0 | 证据继承；原 O-1/O-2 已由 U-38 与规格 v2 解决，原流前缀发布选择由本轮明确替换 |
| r1 作者自查；规格 v2 `834e269da9`、§4.3–4.5/§5/§10 及直接后果 | Codex / GPT-6（作者，非独立审计） | 已核批准原文、合并与相关源码无变化；采集/输出状态、SC-01 外层异常收口、所有消费者与登记能力逐项映射。状态 `frozen-pending-review`，review rounds=0，未伪填独立 verdict | 无 owner 待决；独立审查随后进行；真实引擎 AC-01..08、Windows 真机仍由实施/发布验收证明 |

文档验证（r1）：在 `packages/ui-mac` 执行 `bun test src/main/old-name-scan.test.ts`，exit **0**、`10 pass / 0 fail`；文档检查器使用已解析的本组合 profile 对当前 worktree 调用 `check_repo(..., changed_since="HEAD")`，本文 findings 为零，入口仍报 r0 已记录的 index.stale 与两个跨仓裸 ID；没有宣称整个仓的文档门通过。编号、元数据、本地链接、旧名词元与 `git diff --check` 自查通过。只修改本文与入口中本文的索引行，不提交实现、探针或规则/权威册。

**仍为推断或未核验**：capture 新事件、整份发布和异常 guard 尚未实现；各格式提取、延后才出现的秘密值与晚发故障的真实多消费者合成尚未运行；Windows 路径细节和真实文件身份仍待真机。r0 探针只证明现有成功 hook 能改结果，不证明新增 SC-01 已存在。

**留档（不扩大本票）**：入口索引原有过期及跨仓意图裸 ID 仍按 r0 证据留档；本轮只同步本文的索引行，不修复无关文档。独立审查前的 frozen 状态遵循本轮明确 brief，不冒充设计 approved。
