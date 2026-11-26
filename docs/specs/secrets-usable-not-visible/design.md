---
id: DESIGN-secrets-usable-not-visible
title: 密钥文件程序可用、助手不可见 技术设计
summary: 共享受保护名单与非密钥规则；在工具结果进入会话前遮盖，并在 shell 捕获写盘前处理实时输出；记录采集保证的缺口与必要接管。
kind: tech-design
status: draft
spec: SPEC-secrets-usable-not-visible
spec_version: 1
review:
  rounds: 0
  reviewed_sha: ""
  verdict: ""
owners: [owner]
last_reviewed: 2026-11-26
---

# DESIGN-secrets-usable-not-visible｜密钥文件程序可用、助手不可见 技术设计

本设计对应 #1758，只定义契约、权威、数据出口与失败语义。**尚未冻结**：成功结果能被现有 hook 改写已经实测；实时 shell 出口需要新增引擎接缝；仅靠文件采集不能证明规格 BR-03 的全称保证，具体反例和待 owner 定事项见 §10。本文没有把额外残留风险当成已获批准的范围取舍。

## 1. 基线

- Spec：[SPEC-secrets-usable-not-visible v1](spec.md)，批准记录与内容固定于提交 `9504dd7d9ab36b9ced3fdf70b355d1667685bf8d`；可用 `git show 9504dd7d9ab36b9ced3fdf70b355d1667685bf8d:docs/specs/secrets-usable-not-visible/spec.md` 复核固定输入。
- 覆盖：BR-01..BR-06、AC-01..AC-07，以及规格「待决」的成功结果改写能力。AC 是后续实施的义务，本设计的探针没有代替七项验收。
- 输入收据：规格 v1 已由 owner 于 2026-11-25 批准；继承其三条用户限制、Windows 发布时真机验收和「复用工具卡文本区、无需 frames」约定。自动化仍消费 [SPEC-unattended-run-permissions v2](../unattended-run-permissions/spec.md) BR-03。
- 背景：规格[来源](spec.md#来源)所指的协调仓安全意图 I-45、讨论 P-06/P-08。只回查了对应讨论，未重新裁决已批准的「程序可用」「全部批准读项目外文件不问」和原样匹配边界。
- 代码基线：`9f08c506d9842d319616c7e45c33d3b9c3279e48`，引擎包版本 `2.2.5`，本机 Bun `1.4.4`、Node `26.13.1`。以下行号均指这个提交。

## 2. 地面真相

调查仅回答三件事：现有结果 hook 能否覆盖三种消费者；名单和权限在哪里已有权威；采集是否足以支持原样遮盖。找到可调用入口或能推翻候选方案的反例即停止。

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

**观察**：原样输出也可能从未被前后两次采集见到；这不是编码或拆分，不能归入规格已批准的残留风险。普通文件 watcher 是变更通知，不是每次读取的内容记录，不能据此宣称消除了此反例。§4 定义候选实现的采集语义，§10 保留强保证的 owner 决策；没有把「只保护扫描到的文件」写成新增用户限制。

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

候选采集时点：Location setup 首次采集完成后才登记结果出口；每次工具执行前、每次要交付结果/错误/进度前，以及 shell 捕获 chunk/end 前刷新。每次重新枚举 sources，已知文件用身份和内容变化判断复用解析结果；新文件加入。读取到的新秘密并入该实例的匹配集，删文件或轮换不撤销旧值，防止尚未交付的命令仍输出旧值。Location 释放/进程结束即释放；不加 TTL、数量/长度上限、定时扫描或新的 watcher。

只开放处理能力，不开放取出秘密的 API：

```ts
type MaskedRead = {
  output: { type: "text-page"; content: string; mime: "text/plain"; offset: number; truncated: boolean; next?: number }
  content: readonly { type: "text"; text: string }[]
  metadata: { truncated: boolean }
}
// SecretMask 为 Location 私有对象，不是工具、RPC、HTTP 或可序列化服务。
type SecretMask = {
  refresh(): Promise<void>
  read(input: { file: ProtectedFile; offset?: number; limit?: number }): Promise<MaskedRead>
  result(input: Tool.Result): Promise<Tool.Result>
  error(input: Tool.Error): Promise<Tool.Error>
  progress(input: Tool.Metadata): Promise<Tool.Metadata>
  stream(input: ShellCapture): Promise<ShellCapture>
}
```

这些新能力全部是本设计决定新增的扩展实现，不能误记为已经存在的端口。`Tool.*` 使用现有 `@opencode/plugin/promise/tool` 类型；`ShellCapture` 见 §4.5。没有「返回匹配集」「导出快照」能力。错误不带原文件片段、值、值的 hash、解析器输入或样本；诊断最多含 rule ID、路径和 OS 错误码。

格式策略：env 使用 Node 内置 [`util.parseEnv`](https://nodejs.org/api/util.html#utilparseenvcontent) 的静态解析，绝不执行文件或展开变量；json 使用静态 JSON 解码并递归取标量；ini/netrc/credential-url 与 assignments 只提取其文本里的标量和私钥块，不执行 include、命令、YAML 标签或 shell substitution。assignments 是保守的文本词法采集，不伪称完整 YAML/TOML 解释器：同时保留原样右值、去语法引号的值、多行原文，未解析段作为不透明正文采集。解析不成功不能把该文件当普通内容交回模型。

opaque 采集原始文件内容、私钥完整块及非空私钥正文行；二进制保存原始字节匹配材料，不解密钥匙串、DPAPI 或浏览器口令，不触发系统解锁弹框。**这只能遮盖已采集到、以相同表示出现的内容，不能从加密数据库自动得到程序之后打印的明文**。这处不能由设计擅自扩大「编码不捕获」的解释，已列 §10。

原值仅在引擎进程的该实例内存和读取缓冲区中短暂/驻留；不写会话、事件、日志、trace、UI、磁盘缓存或崩溃报告。JS 字符串释放不是可证明的内存擦除；本设计不宣称能抵抗读进程内存、原生插件或调试器的攻击者。

### 4.4 直接读：变量视图与说明视图

只包装身份权威确认的内置 `read`，不凭一个第三方工具恰好叫 read 就给它豁免。安全视图在原物理读和 `authorizeRead` 之前分流：

1. 先消费现有 `unattendedProfile`。在册自动化及自动化载体继续走已有 deny，不进入交互豁免；不改自动化注入的 `*.env*` deny。
2. 词法路径和真实目标命中名单：返回安全视图；不调用原 read，不发 read / external_directory 审批。三种交互档一致，主目录私钥也不问。
3. env 返回所有变量名；秘密值统一 `[REDACTED]`，BR-06 公开值保留。注释和未解析内容不原样带回；无法解析的部分显示遮盖说明。其它受保护文件只返回「这是密钥文件，值不提供给助手；程序运行时照常能用。」不返回私钥、公钥派生信息或附件。
4. 结果沿用 read 的 TextPage 形状和分页输入；先构造安全文本，再应用现有分页语义。说明固定放入工具卡正文，env 视图也带相同说明。路径缺失/不可读沿用现有具名读失败，错误不含值。
5. 未命中名单：执行原 read；只在 §4.6 指定的全部批准项目外读取上取消目录 ask。

交互注入中的 `.env` ask / deny 与安全视图冲突，删除这些专用条目，不把受保护模式再生成进配置；read 的其它规则继续由既有权限权威解释。build 的上游底座不接管：安全视图根本不触发它的原始 read 审批。用户明确停用整只工具的既有规则仍由工具策略权威执行，本票不扩权到停用工具。

### 4.5 通用工具结果与 shell 捕获

遮盖符固定为 `[REDACTED]`，说明固定为规格原句；没有新配置键。源文件/子进程环境/传给程序的入参不改动。

通用结果在现有 `execute.after` 的扩展处理尾部，**所有现有云校验、错误归因与 display metadata 附加之后**执行。成功结果同时处理 content、output、metadata；错误重建 `Tool.Error`，遮盖 message、metadata，移除可能携带原文的内层 error/cause；没有捕获失败后返回原对象的分支。结构化 output 的标量若命中秘密可变为遮盖字符串，不能重新跑原工具输出 schema 把这份安全结果拒掉；当前执行器正是在输出校验之后运行 after（§2 已观察）。

文本按原样、左到右、同位置最长值优先替换；一次替换不递归处理新遮盖符，避免值重叠泄漏或二次遮盖污染。覆盖嵌套 JSON 的字符串和数值标量、动态键名、metadata；协议 envelope 的 type、调用 ID 等引擎结构字段保持合法，不能因误遮把 Tool.Content 判别联合破坏。动态键名遮盖产生碰撞时，该对象以一个遮盖符代替，不能把两个不同字段拼成新的泄漏内容。

Tool.Content 的文本、文件 uri/name 都属于处理面。内联 data URI 先按协议还原载荷再查原样值；文本载荷可替换后重编码；二进制载荷命中时以一个 text 遮盖符替换该文件 content，避免把损坏的图/PDF交给模型。文件引用如果指向受保护文件则换说明；非保护文件的内联字节同样检查。只检查原始字节，不承诺 OCR、解密、解压或程序额外编码的识别。MCP 非内联二进制资源已保存到普通工具产物时，后续读取仍经过同一结果遮盖，不能把产物路径当作安全证明。

进度使用现成 `tool.transform` 包装方式，在 `context.progress` 到达原回调之前刷新并遮盖整份 update，保留原有 display 快照。转换随工具目录重建重放，覆盖后到的 MCP；不写 UI 的第二份 redactor。Code Mode 子调用先经同一 after，结果再交给受限 JS；其外层终态也再经过 after。`packages/core/src/codemode/tool.ts:203-234` 的进度只有调用状态/参数/错误，错误来自已遮盖的子调用；不靠额外包装不存在于 registry 的合成 execute 工具。

**必要接管（raise SC-01）**：在 shell 捕获写盘前新增 `shell.capture` hook，复用现有 shell hook 注册/转发机制。契约在 Effect/Promise 两个 ShellHooks 面一致：

```ts
type ShellCapture = {
  readonly id: Shell.ID
  readonly phase: "chunk" | "end"
  bytes: Uint8Array
}
interface ShellHooks {
  readonly "create.before": ShellCreateBefore // 原契约不变
  readonly capture: ShellCapture
}
```

触发者为 `Shell.create` 的输出 pump；消费者为扩展的同一 SecretMask。每个 shell ID 顺序 await chunk；输入 bytes 是 stdout/stderr 合并流的原始字节，event.bytes 是允许捕获的字节，可以为空。流正常结束、错误结束或取消导致输出流关闭后，恰好一次 `end`（输入空数组）排出安全尾部，然后才 `stream.end` / 打开 outputDone。无插件时事件原样通过；Code Puppy 中先注册采集与遮盖再允许 shell 工作。hook 不新增 typed failure，扩展处理错误不得让原字节走回写盘分支。

接管边界仅为现有 `packages/core/src/shell.ts:333-355` 捕获写入，及 `packages/plugin/src/{effect,promise}/shell.ts` 的事件类型；host/adapter 已泛型转发。协议、Server HttpApi、Client、模型执行器均无需改变。实施前必须经 owner 批准这项新增上游接管，并按既有上游边界登记；本文不替 owner 宣布批准。

流匹配保留「可能是某个已知秘密前缀」的最短未决尾部，其他字节立即输出，跨 UTF-8 和 chunk 边界匹配；end 时将未构成完整秘密的尾部输出。不得把整个命令缓冲到结束，也不能把传输分块误当规格允许的「程序拆开输出」。缓冲长度由实际匹配材料决定，不设任意 cap。单次处理使用稳定快照；刷新只增加匹配值，不在活跃流中撤销旧值。

这样 shell 文件从第一次落盘就是安全文本，size、cursor、行数按实际写入的安全字节计算；现成轮询、截断、Job、后台 synthetic 通知自然消费同一份安全结果，不再增加 synthetic hook。程序进程及它向本地服务发送的数据在捕获之前，仍使用原值。

### 4.6 只取消全部批准档的项目外读取 ask

不删 build 的整条 external_directory 规则。由现有 `external-directory-rule` 权威持有其读操作例外，扩展现有 permission.evaluate 消费；不在 UI、gate、风险器各建档位表。

执行前用既有工具身份事实记录当前内置 read 调用的 `(sessionID, messageID, id)`，结束/失败后删除。permission 事件只有同时满足「source.type=tool、完整调用键对应已核实内置 read、agent 为既有全部批准载体、action=external_directory、当前 effect=ask、非自动化」才改为 allow。最终匹配的是执行中的调用而不是 metadata 自报工具名。不改变显式 deny、不写持久 grant、不放宽无 source 的请求。

询问档仍走原目录 ask，只读档对普通项目外文件仍由原 deny 处理；安全视图的名单内读取走 §4.4。write/edit/patch/shell 等动作在原 external_directory 规则下运行。风险分类始终仅提供说明，不能以「高风险」重新增加一次审批。

### 4.7 能力接缝图

「新增」表示本设计已经决定的实现能力；「raise」表示引擎缺口与接管决定，不能伪装为现有 callable。表只映射能力和合法边界，不是文件改动清单或工作单元。

| 所依赖的能力 | 合法 callable / 明确新增或 raise | 消费者与边界 |
| --- | --- | --- |
| 修改全部类型的成功/错误终态 | `Context.tool.hook("execute.after", ...)`，`packages/plugin/src/promise/tool.ts:47-71`；`Tool.executeTool`，`packages/core/src/tool.ts:155-179`，已实测 | 扩展 SecretMask；覆盖内置、插件、MCP、Code Mode 子调用与外层终态 |
| 覆盖运行期进度 | `Context.tool.transform` / `ToolEditor.update`，`packages/plugin/src/promise/tool.ts:25-35`；既有 `wrapForDisplay`，`packages/ext/src/policy/display.ts:43` | 在原 progress 回调前遮盖，目录重载自动重放 |
| 保护直接读并保留 read 形状 | 同一 `ToolEditor.update`；现有 `ReadToolFileSystem.TextPage`，`packages/core/src/tool/read-filesystem.ts:81-88` | 新增 `SecretMask.read`；复用形状，不导入 Core 服务实现 |
| 判定受保护文件 / 输出发现范围 / 风险路径 | 新增 `ProtectedFiles.sources/match/probe/isPublicValue`，冻结于 §4.1 | Schema 纯权威；read、采集、risk 消费同一发布数据 |
| 可信地采集与处理值 | 新增 Location 私有 `SecretMask` 及 §4.3 的六个方法；IO 用 Node `fs/promises` 的 `readdir/realpath/readFile/stat`，env 用 `node:util.parseEnv` | 不进入工具/RPC/日志；采集强保证尚有 §10 缺口 |
| 实时 shell / 输出文件 / Job / 后台通知 | **raise SC-01**：§4.5 `ShellHooks.capture`，接在真实 `Shell.create` pump 写盘前 | 当前无 callable；须先批准接管再实施；不依赖不存在的 synthetic hook |
| 识别自动化并保留原拒绝 | `createUnattendedState().unattendedProfile`，`packages/ext/src/policy/unattended.ts:30` | 沿用现有在册状态和 AUTOMATION_PROFILES |
| 取消读目录 ask、保留其它权限 | `Context.permission.hook("evaluate", ...)`，`packages/plugin/src/promise/permission.ts:18-32`；`externalDirectoryRules/placeAfterBase`，`packages/ext/src/external-directory-rule.ts:38,59` | 新增读调用关联与该权威的操作判定；不声称可翻转已提前返回的 deny |
| 风险标注与当前卡片呈现 | `classifyPermissionRequest`，`packages/ext/src/policy/risk.ts:730`；`attachTerminal`，`packages/ext/src/policy/display.ts:67` | 复用既有风险信号和 Tool.Content 文本，末尾再遮盖 |
| 存储和模型消费 | `publisher.toolExecution`，`packages/core/src/session/runner/publish-llm-event.ts:561`；`toolResult`，`packages/core/src/session/runner/to-llm-message.ts:114` | 消费现有安全结果，不增加持久 schema、重放补丁或 UI 接缝 |

## 5. 数据与失败

不新增数据库、密钥存储或持久化 schema；不改旧记录、不清洗历史、不迁移凭据。原文件和真实程序使用方式保持原样。新记录只在结果安全处理后经现有事件/投影事务写入；shell 捕获文件只接收安全字节。重试不重新执行程序来取遮盖材料，刷新仅重新读取发布名单允许的来源。

可达失败分别处理：

- 文件不存在：本次不贡献新值，已有值不撤销。直接读仍给现有 not-found 结果，不把整个保护视图降级成原始读。
- env/JSON 格式错误：安全读只返回可识别键与说明，剩余原文按 opaque 采集；不把解析器带原文的异常交给用户/模型。
- 某个本来存在的来源无法读取、扫描失败、stream masker 运行失败：**目前规格没有授权处理语义**。保留已采集值只对这部分值有效；原样放行会漏，遮盖全部结果会让用户丢失无密钥内容，停工具会新增拒绝。不能写成「安全失败」掩盖产品取舍，见 §10 O-2。
- 结果后处理与捕获要串行 await 后才能发布/写盘。若后台 Job 已持久化，不能指望之后的 synthetic 或 UI 再消除原文，故 SC-01 必须前移到捕获层。
- 扩展重载/Location 释放会销毁本地匹配状态；活跃 shell 的捕获生命周期须仍持有创建它的实例直到 end。不会通过过期、超时或拒绝新命令解决生命周期管理。

匹配是一次处理内的纯投影，对已经遮盖的结果重复调用不恢复值。源文件轮换与程序读取没有共同事务；采集与读取之间仍存在 §2 的竞态。任何可部署冻结版本必须先解决或由 owner 明确修改规格的这条保证，不能以 AC 样本通过替代 BR-03 的义务。

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
- 依靠 watcher 承诺从未漏读、或把所有异常结果直接隐藏：前者缺乏证据，后者是未经批准的用户限制。

安全边界：可信方是宿主、发布名单、引擎/扩展实现及进程内存；不可信输入包括模型发起的命令、文件内容、工具/MCP 返回值。连接器执行时照常读文件，服务器与程序已经接触值不属于「未给模型」的证明。已批准的残留是原样同值误遮、程序编码/拆分后绕过；用户粘贴、应用自有凭据和阻止程序联网按规格排除。任意原生插件读内存、外部程序直接联网、OS 数据库解密没有在本票得到新的防护承诺。

不变量：源文件不改；秘密集合不出进程；所有工具终态和进度在发布前处理；shell 捕获写入先处理；名单和公开值只有一个权威；风险标签不改变权限。**不变量的成立依赖采集可覆盖实际值；其未解决处必须留在 §10，不能默默降为「尽力」。**

## 8. 拆分决定

不适用跨仓拆分；Schema、Ext、Core、Plugin、桌面宿主在同一仓。SC-01 是上游接管权限边界，不是另开跨仓接口或顺序 Task。后续实施需消费经裁决和审查冻结的 §4；不能在未映射的出口上先行实现。

## 9. 回滚

不适用。没有数据迁移、不可逆数据改动或规格要求的回退路径；不设计旧版本行为或兼容期。

## 10. 裁决与审查结论

### 已定技术选择（适用规格 v1，尚待独立审查）

| 送审前裁决 | 依据 |
| --- | --- |
| 现有 execute.after 足以改写成功结果，规格这项待决已解决 | §2 真 Tool.snapshot 对照探针 exit 0；after 无需接管 |
| 名单、格式和非密钥规则由 Schema 一份发布权威持有 | BR-01/BR-06、K2；§4.1 的新 callable 全部明确决定新增 |
| 安全 read 在物理读取与权限 assert 之前分流；自动化不走交互豁免 | BR-02；§2 读链路与现有自动化权威 |
| 通用 after 与 progress 包装共同覆盖工具输出；shell 另在捕获写盘前处理 | BR-03/AC-02；§2 实时卡片与 Job 的真实旁路 |
| 项目外只放松已核实内置 read 的 build 目录 ask | BR-05；不移除全动作目录规则，不增加档位权威 |
| 原值只由扩展在引擎进程私有持有；非公开短值也遮盖 | BR-04/BR-06；不改文件/环境，不引入最短长度 |

### 待 owner 定（没有默认为已同意）

**O-1：批准 SC-01 的上游接管面。** 成功 hook 已可用，但实时工具卡会直接读 shell 输出文件，后台任务也会先存它；只用插件现有挂点做不到 AC-02 的全部消费者。建议批准 §4.5 的捕获 hook：只在 shell pump 前插调用，Plugin 的 Effect/Promise 两个面增加相同事件，规则留在扩展。代价是新增上游维护面及既有接管登记/ADR 义务，不增加用户操作。若不批准，不能宣称完整实现 AC-02，不能以隐藏实时卡片或取消后台执行替代。

**O-2：BR-03 的文件值来源保证必须先澄清，当前设计不能冻结。** §2 的创建→输出→删除反例是原样值，前后采集均看不到；来源不可读、加密存储经程序解密、子进程临时指定自定义路径也没有可复用的明文读取权威。增加 watcher 或更多轮扫描不等于证明。建议将「可信采集已获得的原样值可遮盖」及上述未覆盖情形明确回送规格裁决，同时明确来源读取失败时用户应得到什么；这是规格范围变更，**尚未采用**。代价是强保证变成有明确来源边界的保证。若 owner 要保留当前全称保证，则本方案的采集部分 BLOCKED，需另行取得能证明覆盖的系统能力设计；不能靠同一 after hook 或一句「保守处理」补齐。

`RESTRICTION-PROPOSAL`：采集失败就隐藏整份结果、停工具、要求确认，都会新增用户碰到的损失/拒绝/步骤，本设计均未采纳。它们不是「安全默认值」，也不是本票新增 AC。当前不修改规格、不替 owner 记录决定、不建立第二份活动状态。

### 检查收据

| 轮 / 范围与版本 | 检查方 | 结论与证据 | 遗留去向 |
| --- | --- | --- | --- |
| 作者自查；代码 `9f08c506d9`、规格 v1、本文 §1–10 | Codex / GPT-6（设计作者，非独立审计） | 已核成功结果 hook 与失败对照、进度先行、shell 实时/后台出口和文件快照反例；两项最终探针均 exit 0。契约接缝已逐项映射。本文保持 draft，不伪填审查 verdict。 | O-1/O-2 留在本节供 owner 一并裁决；Windows 真机仍沿用规格既定验收时点；其余 AC 留给实施验收 |

文档验证：在 `packages/ui-mac` 执行 `bun test src/main/old-name-scan.test.ts`，exit **0**，`10 pass / 0 fail`。使用已解析的本组合 profile 调用文档检查器 `check_repo(..., changed_since="HEAD")`，本文 findings 为零；索引检查仍报既有错误。`git diff --check` 与 staged diff 检查均通过。只提交本文和入口索引一行，不含探针或实现代码。

**仍为推断或未核验**：新捕获事件尚未实现；流跨块匹配、各格式提取与真实三消费者合成未运行；Edge/Brave 和 Windows 系统凭据路径细节、junction/8.3 身份未真机核验。没有用源码阅读或本机 macOS 探针冒充 Windows / 真模型 / 完整安全证明。

**留档（不扩大本票）**：`docs/README.md` 的生成索引在本次修改前已过期，且含本仓不存在的两个跨仓意图裸 ID。全量重生会同时带入多处无关索引变化，并触发既有旧名登记不匹配；因此按 brief 仅保留本文的一条生成索引行，不修复既有索引。文档契约检查据实报告这一基线问题；不把它归因于新设计，也不声称整个仓的文档门已绿。
