---
id: DESIGN-secrets-usable-not-visible
title: 密钥文件程序可用、助手不可见 技术设计
summary: 按凭据字段提取并恢复实时遮盖；原文加密暂存、终态重遮盖、env 写回保留同键值；R1 修正冻结，直播残留待 owner 确认。
kind: tech-design
status: frozen-pending-owner
spec: SPEC-secrets-usable-not-visible
spec_version: 2
review:
  rounds: 1
  reviewed_sha: "582f056887"
  verdict: "blocked → corrected; R1 2 Blocker 4 Major 1 Minor accepted"
owners: [owner]
last_reviewed: 2026-11-26
---

# DESIGN-secrets-usable-not-visible｜密钥文件程序可用、助手不可见 技术设计

本设计对应 #1758。R1（Claude Opus 5.5，只读，审查版本 `582f056887`）的 2 Blocker、4 Major、1 Minor 全部按编排器裁决接受并修正。除 §10 **LIVE-01** 的直播残留尚待 owner 写入规格限制表外，本文其余契约均为 **frozen**；文档聚合状态为 `frozen-pending-owner`。这是技术修正收据，不把待确认残留冒充 owner 已批准，也不改写规格 v2。

## 1. 基线

- Spec：[SPEC-secrets-usable-not-visible v2](spec.md)，#1765 的固定输入提交 `834e269da977f6b4888c3b7a6a268bfe835d9cf5`；用 `git show 834e269da977f6b4888c3b7a6a268bfe835d9cf5:docs/specs/secrets-usable-not-visible/spec.md` 复核。v1 的证据随原设计提交 `ef920c7580` 继承，不再是当前范围基线。
- 覆盖：BR-01..BR-07、AC-01..AC-08；LIVE-01 涉及直播与中途故障的范围修订，尚待规格采纳。成功结果 hook 沿用 §2 证据，本文探针不代替验收。
- 输入收据：owner 2026-11-26 在协调仓安全意图原始记录 U-38 对三项问题回答「好的。」；本票消费其中 SC-01 授权、前后可读值边界及失败整次隐藏，均已落入规格 v2。继承 Windows 发布时真机验收和「复用工具卡文本区、无需 frames」约定。自动化仍消费 [SPEC-unattended-run-permissions v2](../unattended-run-permissions/spec.md) BR-03。
- 背景：规格[来源](spec.md#来源)所指的协调仓安全意图 I-45、讨论 P-06/P-08。只回查了对应讨论，未重新裁决已批准的「程序可用」「全部批准读项目外文件不问」和原样匹配边界。
- r2 依据：独立 R1 的原审查版本与本轮七项编排器处置；不 merge origin/alpha，本轮无需 rebase，代码未改。
- 代码证据基线：`9f08c506d9842d319616c7e45c33d3b9c3279e48`，引擎包版本 `2.2.5`，Bun `1.4.4`、Node `26.13.1`。r1 已执行授权的 `git fetch && git merge origin/alpha`，无冲突，合并提交 `7fe85d4e71`；对 Tool、Shell、Ext hook 与两份 ShellHooks 的定向 diff 为空，沿用原行号与探针结论。上游另含脚本/测试改动，仅按合并接收，未扩项修改。

## 2. 地面真相

r2 继承已有成功 hook 证据，只核查 R1 改变的假设：直播不能取消、Code Mode 调用键共享、写入前的合法参数恢复入口、SQLite 的真实凭据列。已有 callable 或明确新增实现足以支撑决定即停止。

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

**R1 推翻 r1 的发布时点结论**：`packages/core/src/tool/plugin/shell.ts:24-25,95,188` 明确支持运行中读取输出和无时限后台命令；`packages/core/src/session/shell.ts:10-24` 直接用户 shell 的 timeout=0；卡片 `packages/session-ui/src/tools/tool-renderer.tsx:2262-2282` 持续跟随。等待整个进程结束会使长期服务一直没有输出。U-38 没有批准去掉直播，r2 恢复逐段发布，并将不可撤回的残留准确留给 LIVE-01。

**调用键不是子调用标识**：`packages/core/src/codemode/tool.ts:147-150` 把外层 context（包括 id）传给每个子工具；`packages/core/src/tool.ts:181-182,307` 触发同形 before/after。因此 `(sessionID,messageID,id)` 只标识最外层事务，不能让每个子工具 begin/end。

**写回接缝**：`packages/ext/src/policy/gate.ts:259-264` 深冻结已审批 input；`ToolEditor.update` 可包装已有 execute（`packages/plugin/src/promise/tool.ts:25-35`）。`write` 接收 path/content（`packages/core/src/tool/plugin/write.ts:19-24`），`edit` 接收 path/oldString/newString（`:24-33`）；`patch` 使用既有 `Patch.parse`（`packages/util/src/patch.ts:49`），旧/新行在 `Patch.Hunk`/`UpdateFileChunk`（`:27-42`）可区分。恢复只能在执行器包装中构造局部副本，不能修改被 pin 的事件，也不另建文件写入器。

### R1 SQLite 来源与可失败证据

不读取用户的任何凭据库。本次读取 [Google 官方组件元数据](https://dl.google.com/dl/cloudsdk/channels/rapid/components-2.json)（594.0.1），下载其 [core 源码包](https://dl.google.com/dl/cloudsdk/channels/rapid/components/google-cloud-sdk-core-20261121205138.tar.gz)。包 SHA-256 为 `f3d680f1d2bcf89b575bbba309305f2d897236d19b82e7d78462cf632ee2252d`，与元数据一致；`lib/googlecloudsdk/core/credentials/creds.py` SHA-256 为 `af6b60dd4e30c7438af090b0556812814881967a90f483a3c294db96da7bc878`。

该文件 `:397-401` 定义 `credentials(account_id TEXT PRIMARY KEY,value BLOB)`；`:573-600,665-671` 定义 access_tokens 表并区分 token、过期时间与账户字段；`:1320-1393` 把 credentials.value 序列化为 credential JSON。下面 §4.1 冻结实际凭据列，不采集 account_id、expiry、策略和格式字段。

临时探针以 Python AST 直接读取官方 `AccessTokenCache._COLUMNS` 生成 SQLite DDL，再写入进程生成的测试值；没有手写另一套 gcloud schema。命令 `node /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-gcloud-source-nnq2qb0l/sqlite-probe.mjs /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-gcloud-source-nnq2qb0l/sample-access-tokens.db`，exit **0**。只报告：凭据单元格 3 个；metadata 列未收集；只读 DELETE 被拒；整文件对照漏遮；单元格替换成功；`0 1 json v1 {}` 保持原样。未打印任何测试值，探针不入仓。

读取能力使用 [`node:sqlite.DatabaseSync({readOnly:true})`](https://nodejs.org/api/sqlite.html)，无新依赖。仓内 Node SQLite driver 已使用同一内建模块（`packages/core/src/database/sqlite.node.ts:1`，安装包 `@effect/sql-sqlite-node/src/SqliteClient.ts:36`）；[Electron 42.3.3](https://releases.electronjs.org/release/v42.3.3) 的 Node 为 24.15.0。本机 Node 探针证明只读行为，不冒充出货 Electron/Windows 的验证。

同一临时目录执行 `node /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-gcloud-source-nnq2qb0l/spill-probe.mjs /var/folders/w5/9ltc186j4xx99mfzlbmh8z0w0000gn/T/secrets-gcloud-source-nnq2qb0l/sample.spool`，exit **0**：实际 Node crypto 完成 32-byte key 的 AES-256-GCM 文件往返，密文不含原值，改坏 tag 的对照被拒，BigInt stat 提供 dev/ino/size/mtimeNs/ctimeNs。只输出四个布尔断言，不输出 key/明文；这验证依赖原语，不声称 SC-01 或完整流算法已实现。

## 4. 接口契约

### 4.1 单一名单与非密钥规则

共享纯契约放在现有 Schema 模块的 Code Puppy 自有文件，命名空间 `ProtectedFiles`。名单、示例排除、格式与 BR-06 判定同一权威、随应用发布；不增加用户设置、环境开关或第二份扩展名单。read、采集、风险分类都调用它。实现可选择私有的数据结构，以下消费边界固定：

```ts
type PathPlatform = "darwin" | "win32"
type ProtectedFormat = "env" | "ini" | "json" | "assignments" | "netrc" | "credential-url" | "sqlite" | "opaque"
type CredentialProfile = "env" | "credential-document" | "private-key" | "aws" | "docker" | "kube" | "npm" | "pypi" | "netrc" | "git-credentials" | "gcp-adc" | "gcp-credentials" | "gcp-access-tokens" | "azure" | "chromium-state" | "chromium-logins" | "chromium-cookies" | "firefox-logins" | "firefox-cookies" | "encrypted-store"
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
  profile: CredentialProfile
  view: "variables" | "notice"
}
// 同一份规则同时提供发现范围、路径匹配、命令载荷中的路径风险匹配。
declare const ProtectedFiles: {
  sources(roots: ProtectedRoots): readonly {
    root: string; include: readonly string[]; exclude: readonly string[]
  }[]
  match(input: { path: string; roots: ProtectedRoots }): ProtectedFile | undefined
  probe(input: { text: string; roots: ProtectedRoots }): readonly string[] // 命中 rule ID
  isPublicValue(input: { name: string; value: string | number | boolean | null }): boolean
}
```

roots 全部必填，由宿主实际目录事实提供，不从工具输出或模型参数覆盖；没有机器绝对路径默认值。路径传入仍遵守现有 read 输入校验。`match` 是总函数：不适用返回 undefined，不读取文件，不请求权限。`probe` 只按同一 sources 的模式做词法探测，不能另抄受保护路径正则；无法从命令推断某个动态路径属于既有风险标注能力的边界，不影响匹配已解析文件。

现有 `classifyPermissionRequest` 的输入增加必填 `protectedRoots: ProtectedRoots`；permission、patterns、always、metadata 的形状与结果维持原契约。调用方从同一 Location 的 SecretMask 路径事实供数，不在分类器里做 IO，也不从审批 metadata 反推可信根。现有 gate 和能力轴调用共同消费这一个参数，不能让无根调用退回另一张旧正则表。

首版名单与 profile 是同一份发布数据。项目的递归文件名规则只发现项目自己的文件；默认剪枝 `node_modules`、`vendor`、`.venv`、`venv`、`site-packages` 这类依赖树，不因依赖自带 `.env` 把第三方样本纳入匹配集。名单中的显式文件/目录位置或已支持的显式凭据路径变量仍优先，即使落在依赖树内也直接处理；这种例外由同一名单判定，不增加用户配置。match、sources、probe 消费相同范围，不能只剪枝采集而让读工具持有另一套名单。其它项目目录不因 `.gitignore` 跳过，按真实身份去重以终止符号链接环。

| 位置 / 文件族 | 格式与直接读视图 |
| --- | --- |
| 项目任意层级 `.env`、`.env.*`；末尾为 `.example`、`.sample`、`.template` 的示例除外 | env / variables；排除必须先于 include |
| 项目任意层级 `.envrc`；`secret` 或 `secrets` 的 `.env/.json/.yaml/.yml/.toml`；`credentials.json` | `.envrc` 与 YAML/TOML 用 assignments，其余按扩展名；均 notice，不执行 shell/YAML 标签/插值 |
| 项目的 `config/master.key`、`config/credentials/*.key`、`config/credentials*.yml.enc`；项目私钥容器 `*.pem/*.p12/*.pfx` | opaque / notice |
| 项目及主目录的 `.netrc`、`_netrc`、`.npmrc`、`.pypirc`、`.git-credentials` | 对应 netrc、npm、pypi、git-credentials profile；notice |
| 主目录 `.ssh/**`，公开文件 `*.pub`、`authorized_keys`、`known_hosts`、`config` 除外 | opaque / notice；非默认文件名的私钥仍能发现 |
| 主目录 `.aws/credentials`、`.aws/config`、`.docker/config.json`、`.kube/config` | 对应 aws、docker、kube profile；notice |
| 主目录 `.azure/msal_token_cache*`、`.azure/accessTokens.json`；gcloud 目录的 `application_default_credentials.json`、`credentials.db`、`access_tokens.db` | JSON 对应 azure/gcp-adc；两个 gcloud 数据库用 sqlite 的 gcp-credentials/gcp-access-tokens profile；加密缓存用 encrypted-store；notice |
| GnuPG 目录的 `private-keys-v1.d/**`、`secring.gpg`；macOS `Library/Keychains/**`、`*.keychain`、`*.keychain-db` | opaque / notice |
| 浏览器 profile 的 `Login Data`、`Cookies`、`Network/Cookies`、Firefox `cookies.sqlite`、`logins.json`、`key4.db`，以及其 SQLite `-wal/-shm`；Chromium 的 `Local State` | 分别使用 chromium-logins/chromium-cookies/firefox-cookies 的 sqlite profile、firefox-logins/chromium-state 的 JSON profile；key4.db 为 encrypted-store。均 notice；不纳入全部缓存/历史 |
| Windows 用户凭据目录 `Microsoft/Credentials/**`、`Microsoft/Vault/**`、`Microsoft/Protect/**` | opaque / notice；Roaming 与 Local 两个根分别匹配 |

主目录产品路径具体展开见 §4.2。现有风险器中 `/etc/passwd`、`/etc/shadow`、`/etc/sudoers` 的系统风险仍由原风险权威持有，不冒充本名单中的密钥文件。风险器只移除已归入 ProtectedFiles 的重复路径定义，其余规则与风险档位不变；命中本名单仍通过原有 `credential-path` 信号抬到已有风险档。

凭据值提取也由这份发布数据持有：**env 保留每个值默认是秘密**，再应用下述公开规则；非 env 只提取该文件 profile 的凭据字段，不把每个标量、非空行、整个 JSON 文本或整库字节作为匹配单位。未列中的字段不贡献值；结构化解析失败进入遮盖失败处理，不能退回「整段 opaque 文本」来制造短匹配项。

| profile | 只提取的字段 / 单元格 |
| --- | --- |
| chromium-state | `os_crypt.encrypted_key` |
| docker | `auths.*.auth`、`auths.*.identitytoken`；不提取 `credsStore`、`credHelpers`、版本/主机名 |
| kube | `users[*].user.token`、`client-key-data`、`password`，以及该 user 的 `auth-provider.config` 中 access-token/refresh-token/client-secret；不提取 apiVersion、kind、cluster/server、证书路径或布尔开关 |
| aws | 各 section 的 `aws_access_key_id`、`aws_secret_access_key`、`aws_session_token`、`session_token`、`security_token` 和 `aws_*_key`；region、output 等不贡献匹配项 |
| npm / pypi / netrc / git-credentials | npm 的 `_authToken`（含 registry 前缀）、`_auth`、`_password`、password；pypirc 的 password；netrc 的 password；git 凭据 URL 的 password。用户名、registry、机器名不贡献匹配项 |
| gcp-adc / gcp-credentials JSON | refresh_token、client_secret、private_key、password、access_token、id_token、rapt_token；不提取 type/client_id/project_id/token_uri、空对象或 metadata |
| azure | accessToken/access_token、refreshToken/refresh_token、secret、client_secret；不提取 account、realm、target、expiry |
| firefox-logins | `logins[*].encryptedUsername` / `encryptedPassword`；不尝试解密 |
| credential-document（secrets/credentials JSON/YAML/TOML、envrc） | 只取语法上秘密字段的标量（同一秘密词规则）；不取整个文档或任意标量，不执行 envrc/shell |
| private-key / encrypted-store | 私钥完整块及正文行；其它不透明加密存储只匹配原始字节单位，不解密、不切出任意短字符串 |
| gcp-access-tokens（sqlite） | `access_tokens.access_token`、`rapt_token`、`id_token`；account_id、token_expiry、regional_access_boundary、regional_access_boundary_expiry 不提取 |
| gcp-credentials（sqlite） | `credentials.value` 作为 credential JSON 解码后仅取上列字段，不把整个 BLOB 或每个 JSON scalar 当作秘密 |
| chromium-logins / chromium-cookies / firefox-cookies（sqlite） | `logins.password_value`；`cookies.value` / `encrypted_value`；`moz_cookies.value`。加密 BLOB 不解密，明文单元格直接贡献值 |

SQLite 始终以主库路径 `new DatabaseSync(path,{readOnly:true,allowExtension:false})` 打开，用固定发布表/列与 `prepare(...).iterate()` 流式读取，完成后关闭。只允许 SELECT/只读 schema 检查，不执行库中提供的 SQL、写 PRAGMA、迁移或扩展加载；不设 immutable 绕开 WAL。伴随 `-wal/-shm` 仍是受保护位置，但采集通过主库正常 SQLite 快照读取，不把日志页拆成秘密；缓存身份包含主库及伴随文件。schema 列名来自发布数据，值绝不拼进 SQL。[Chromium 密码列](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/password_manager/core/browser/password_store/login_database.cc)、[cookie 列](https://chromium.googlesource.com/chromium/src/+/643cdf61903e99f27c3d80daee67e217e9d280e0/net/extras/sqlite/sqlite_persistent_cookie_store.cc)及 [Firefox cookie 源码](https://raw.githubusercontent.com/mozilla-firefox/firefox/main/netwerk/cookie/CookiePersistentStorage.cpp)支持浏览器列的落点；gcloud 的固定版本与实测见 §2。

BR-06 在**所有格式**应用。先按 camelCase/非字母数字拆出键名词；秘密词为 KEY/TOKEN/SECRET/PASS/PASSWORD/PASSWD/CREDENTIAL/CREDENTIALS/AUTH/AUTHORIZATION/PRIVATE（大小写不敏感）。键名有秘密词时不授予下述公开豁免，例如 `PASSWORD=1234` 仍是秘密。没有秘密词时：

| 明显非密钥的发布规则 | 公开值 |
| --- | --- |
| 空值与类型标量 | 空/null、boolean、有限数值及其十进制/科学记数法字符串 |
| 开关 | true/false、yes/no、on/off（大小写不敏感）；0/1 已由数值规则覆盖 |
| loopback 主机名/地址 | localhost、localhost.localdomain、`.localhost` 名称、127/8、`::1`（含方括号）；不把含凭据的任意 URL 当主机名 |
| 日志级别 | trace/debug/info/warn/warning/error/fatal/off/silent（大小写不敏感） |
| 环境名 | NODE_ENV/APP_ENV/ENVIRONMENT 下的 development/dev/test/testing/staging/stage/production/prod/local |

先选凭据字段、再按同一公开规则筛选；因此 Local State/AWS/Kube/Docker 的普通 `0`、`1`、`json`、`v1`、`{}` 从来不进入匹配集。env 的其它非空值仍默认是秘密，没有最短长度或熵阈值。若真正秘密字段的值恰好等于普通文本，仍按规格的同值误遮边界处理；不能为了掩盖错误的字段提取而添加长度门槛。

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

应用不增加凭据路径设置。已有工具的显式路径环境变量（如 AWS_SHARED_CREDENTIALS_FILE、DOCKER_CONFIG、KUBECONFIG、GNUPGHOME、GOOGLE_APPLICATION_CREDENTIALS）由同一名单解析；KUBECONFIG 使用运行平台的 `path.delimiter` 拆成多个路径（Windows 为 `;`、macOS 为 `:`），忽略空项并逐个规范化、注册来源，不能把整个字符串当成一个文件。跨平台样本用对应 `path.win32.delimiter` / `path.posix.delimiter`，不会按宿主分隔符拆坏 Windows 盘符。宿主当前环境的这些路径补充默认根而不是替换默认保护，不把环境变量的值发给模型；名单之外不新增任意命令参数、注册表或子进程临时环境的路径发现器。

### 4.3 采集、外层事务与私有材料

扩展为每个 Location 建一个私有 SecretMask，按名单 profile 读取项目/主目录；不是模型可调用工具，不把值放入 main/UI/storage。Schema 只持有发布规则与固定说明。每次根工具调用前采集，普通工具/连接器结果到达时再采集；shell start 前采集、每个直播 flush 前重读、end 再采集。读到的值保留至 Location 释放，不在并发输出仍可能引用旧值时撤销。

允许跳过未变来源的重读，唯一缓存键为 `(dev,ino,size,mtimeNs,ctimeNs)`，取 `fs.stat({bigint:true})`；任一不同就读内容，不能仅看 mtime。SQLite 同时纳入主库、WAL、SHM 的身份；发现/消失也算变化。没有 TTL 或自行选择的数量/长度上限。ENOENT/EACCES/EPERM 表示该次缺失/不可读，不贡献新值，后续仍重试判定；其它无法完成采集/解析/匹配的异常进入本次隐藏分支。

`(sessionID,messageID,id)` **仅作外层事务键**。begin 放在现有 `policy.seal()` 登记的尾部 execute.before 回调（`packages/ext/src/policy/index.ts:248-264`）内，confirm/pin 完成后的最后一步，而不是较早的 plugin.ts:195 回调：审批拒绝尚未创建遮盖事务，begin 自身不向闸门抛错。普通根调用建立普通状态；合成 execute 根调用建立 Code Mode 外层状态。该键已有活动 execute 时，随后的子工具 before 不 begin；子工具 after 只做**无调用状态的** Location retained-values + 结果时重读/遮盖，不 end/delete 外层，也不把子工具故障锁存到其它子工具。只有外层 execute 的 after 结束它。child input/update 不写外层的进度缓存；原引擎也已把 child progress 设为空。shellID 的捕获状态是独立的进程流生命周期，多个 Code Mode shell 子调用各有 shellID，不能与共享工具事务键混用。

```ts
import type { Tool } from "@opencode/schema/tool"

type MaskCall = { sessionID: string; messageID: string; id: string }
type MaskedRead = {
  output: { type: "text-page"; content: string; mime: "text/plain"; offset: number; truncated: boolean; next?: number }
  content: readonly { type: "text"; text: string }[]
  metadata: { truncated: boolean }
}
type EnvMutation =
  | { operation: "write"; path: string; content: string }
  | { operation: "edit"; path: string; oldString: string; newString: string; replaceAll?: boolean }
  | { operation: "patch"; patchText: string }
type SecretMask = {
  begin(input: { call: MaskCall; kind: "tool" | "execute" }): Promise<void>
  read(input: { call: MaskCall; file: ProtectedFile; offset?: number; limit?: number }): Promise<MaskedRead>
  result(input: { call: MaskCall; tool: string; result: Tool.Result }): Promise<Tool.Result>
  error(input: { call: MaskCall; tool: string; error: Tool.Error }): Promise<Tool.Error>
  progress(input: { call: MaskCall; update: Tool.Metadata }): Promise<Tool.Metadata>
  prepareMutation(input: EnvMutation): Promise<EnvMutation>
  stream(input: ShellCapture): Promise<ShellCapture>
}
```

这些是明确决定新增的扩展能力；MaskedRead 沿用 §4.4 的 TextPage 形状。result/error 根据活动外层与事件 tool 判定根/子，不依靠不存在的独立子调用 ID。begin 自身采集失败只标记根事务，不阻止原工具执行；子调用只把本次无法遮盖的结果换说明，外层仍可继续。固定 `MASKING_FAILED_TEXT = "这次输出没能遮盖，已隐藏"` 归 Schema 同一权威，不再经过 masker。

env 静态解析用 `node:util.parseEnv`，并由同一 env 解析边界保留键及原 RHS 词法跨度，供安全视图和写回恢复共用；不执行 shell、include、变量展开。其它格式仅按 §4.1 的 profile 提取；SQLite 单元格/JSON 字段不是整个文件，也不把 JSON 错误退化为不透明全文匹配。私钥与真正加密容器仍按其专用原始单位，解密后才出现的值沿用 v2 排除。

原值、匹配材料和加密 key 不出该引擎进程。普通工具当前结果占用原有执行器结果内存；shell 不在内存积累全量原文，按 §4.5 加密落临时文件，内存只保留当前 chunk、匹配尾部与必要解析状态。不得把原文、值的 hash、私钥或 key 写入诊断/trace；JS 字符串释放不等于可证明擦除，仍不抵抗原生插件/调试器读进程内存。

### 4.3.1 env 写回保值

仅包装身份权威确认的内置 write/edit/patch。执行器包装位于 `tool.transform`，在 before/pin 之后调用原 execute 时传**局部恢复副本**，不改已冻结 event.input。prepareMutation 无子调用事务状态，只用目标文件当前可读文本，不从 Location 的跨文件匹配集合猜值，不另写文件、不绕过原审批/锁/formatter。

- write：对 env-format 受保护目标，完整赋值行的值恰为 `[REDACTED]`（含语法引号）时，以该文件**同一键当前 RHS**替换；新给出的真实值、非 env 文件和不相干行不变。
- edit：oldString 和 newString 都恢复同键占位符；前者才能匹配真实源文本，后者才能保住未修改秘密。不是只改 newString 后仍让旧占位符匹配失败。
- patch：先用既有 Patch.parse 区分 add/update/delete、源/移动目标和 oldLines/newLines；上下文/删除行用源文件当前同键值，新增/保留行用实际目标的同键值；移动到尚不存在的目标时沿用源文件当前键。由包装内唯一的序列化逻辑按已有 Patch.Hunk 语法重建原 patch，路径、删除/移动操作、普通行、行尾和 BOM 保持原语义，不手写第二个 patch parser。

键必须实际存在于对应当前文件；目标/键确实不存在时不跨文件/跨键或用旧快照捏造恢复，继续原工具语义。读取/解析现有键失败沿用原工具的具名 IO/格式错误，不将尚未解析的既有键占位符写盘；不另加确认或权限策略。恢复读取发生在执行器准备原调用时，沿用原工具对外部并发修改的既有语义，不承诺新增跨进程写事务。原始 RHS 的引号、转义、多行值由同一 env 词法跨度恢复，不是字符串替换全局 `[REDACTED]`。恢复值同时加入 Location retained values；写入后的结果/diff 和审批预览仍遮盖，不能把真实 RHS 经 metadata 反送给助手。

权限预览消费现有 `Context.permission.hook("evaluate")`，在请求发布前用已采集值原位替换 metadata 的动态 diff/files；不修改权限 effect。遮盖失败只使预览正文显示固定说明，不改变原写入审批结局。写回仍完全由原 execute/FileWrite/FileMutation/Patch 完成，既有 read view 使助手看不到恢复出的值。

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

进度继续使用现成 tool.transform 包装：可信运行标识/display 立即发布；普通根工具输出字段用当前 retained values 加重读后处理，每份未发布 update 若失败就隐藏该 update。Code Mode children 不建立进度/结果事务；其结果在交给 JS 前无状态遮盖，外层最终结果再用 retained values 与结束重读处理。不能让 child after 清掉 outer 的状态。

**已批准接管 SC-01** 保留 shell.capture，规则仍在扩展。r2 在同一 Core Shell 生命周期增加直播 publish 与终态文件替换，Effect/Promise 两面同形：

```ts
import type { Shell } from "@opencode/schema/shell"
import type { ShellCreateBefore } from "@opencode/plugin/promise/shell"

type ShellCapture = {
  readonly id: Shell.ID
  readonly phase: "start" | "chunk" | "end"
  readonly file: string // Core 给出的实际捕获文件，决定加密暂存目录
  readonly withheld: boolean
  bytes: Uint8Array
  disposition: "hold" | "publish" | "withhold" | "replace"
  replacement?: { file: string; size: number; newlines: number }
}
interface ShellHooks {
  readonly "create.before": ShellCreateBefore
  readonly capture: ShellCapture
}
```

创建时以已有 PluginHooks.has 判定是否进入 capture 模式；无 hook 的裸引擎保留普通路径。已进入模式后默认 hold，不能因重载失去回调而透传。callback 必须修改原事件的 bytes/disposition/replacement，返回新对象不会被 hooks.trigger 自动采用。start 在 spawn 前，chunk 顺序处理合并 stdout/stderr，end 覆盖原进程结束/超时/取消后的流关闭；没有新增命令超时。

#### 直播 flush

start 做前采集并创建 shellID 的私有材料。每次 flush 先按 §4.3 重新判定/读取来源，然后对「上次原始尾部 + 本 chunk」去 ANSI 颜色序列并按原样字节匹配。`L` 为**当前 retained values 中最长匹配单位的字节数**，尾部保留 `max(0,L−1)` 个去色后尚未替换的未决字节；没有秘密时 L=0，不人为延迟。跨 UTF-8 和分块 ANSI 序列保留解析状态，不把 ESC 残段当成可见正文；需要保留的长原始残段同样使用密文 spool，不在堆上无界增长。终态也用同一规范化与匹配方式。

不是先切原文再对各段独立 replace：扫描完整候选缓冲的匹配跨度，跨提交边界的完整匹配整段输出遮盖符并消费，绝不把它的原文前半段发出；只把未决尾部留给下次。在同一位置最长匹配优先，输出遮盖符不递归进入匹配。旧尾部所需 L 变大时按新集合处理尚未发出的字节，已发布的未知值不会因后来增加模式而被追回。

安全 bytes 即刻返回 publish 并追加捕获文件；Core 按实际写入的安全字节更新 size/cursor/行数，现有 Shell.output、实时卡和模型在运行中读取文件的能力继续可用。不能恢复 r1 的「进程结束前 size 恒为 0」。L 决定必要尾部，没有代理自行选的容量或等待阈值。

#### 加密暂存与终态重遮盖

为了结束后应用前后并集，所有原始 chunk 在变换前写入捕获文件同目录的**加密 spool**，不把整份原文保留内存或明文临时文件。每 shell 用 `node:crypto.randomBytes(32)` 生成仅进程内持有的 AES-256-GCM key；每帧用唯一 12-byte nonce，序号/Shell ID 作认证关联数据，记录长度、nonce、密文及认证 tag；进程另持有预期帧数和总原文字节数，结束读取必须全部吻合，不能把截断到某个完整帧当作正常 EOF。`createCipheriv/update/final/getAuthTag` 加密，`createDecipheriv/setAAD/setAuthTag/update/final` 验证后才把该帧解密明文交给 matcher。不得在 tag 校验失败时使用未认证输出。key 不写文件、metadata、日志、storage 或 IPC。

spool 顺序流式写入，内存只有当前原始帧、`L−1` 尾部及必要解析残段；总输出增长只增加密文文件，不增加全量原文内存，不增加用户输出上限。帧格式为本功能私有临时数据，不是持久契约或可恢复凭据存储。正常完成后流式解密、用前后/运行中 retained values 并集重新去色和遮盖，流式写到同目录的安全 staging 文件；整个过程中不拼接完整原文。

end 成功返回 replace + staging 文件路径/安全 size/行数；Core 先关闭旧输出 writer，原子替换最终捕获文件并更新计数，再打开 outputDone。replace 只允许在 end，staging 必须是本次 capture 目录内已完成的安全文件。Shell.result/Job/模型终态与存储记录只在此后消费该最终文件，普通模型结果及外层 Code Mode 结果也再用结束重读集合遮盖。原始 spool 删除并释放 key；崩溃后没有 key 的孤立 spool 只作临时密文清理，不设计恢复或迁移路径。

前景终态卡原有 saved 状态消费最终结果（`packages/session-ui/src/tools/run-machine.ts:22-36,60-104`）；直播 follower 是追加缓存，不能当作能撤回已见前缀的系统。后台完成卡/记录消费最终文件，先前直播缓存的已见内容属于 LIVE-01，不另发明客户端“抹除已见内容”的承诺。

#### 遮盖故障与直播残留

| 时点 | 确定行为 |
| --- | --- |
| 第一次 publish 以前失败 | 捕获文件/该次结果只有固定说明；没有前缀可保留，命令照常运行。 |
| 已发布若干段后失败 | 立刻锁存 withheld，丢弃未发布尾部/当前原文，停止继续暂存/发布原字节；保留已发布的遮盖前缀，追加一次固定说明，之后持续 drain 并丢弃进程输出直到原进程结束。不能声称能撤回该前缀。 |
| end 的重读、解密认证、重遮盖或安全 staging 失败 | 不替换已运行的文件；清除不完整 staging/spool 和 key，保留已发布前缀 + 固定说明。不能回退到原文、未经认证的明文或半份 staging。 |
| callback reject/defect 或注册消失 | Core 在写盘前用 Effect.exit 收口非外部取消的回调故障，按相同前缀规则 withhold；不把故障传播成停止/取消/重跑命令。真正用户取消维持原行为。 |

withheld 不可解除；说明从 Schema 常量直接生成，不再调用故障 masker。真实 exit/signal/timeout 维持原链路。普通非直播工具结果还未发布时失败，仍整份替换说明；本表的已发布前缀是唯一待 owner 确认的例外。

**LIVE-01（chosen path，owner confirmation pending）**：某个值先被程序打印、后才写入受保护文件时，打印当下的 flush 不认识它，可能已出现在直播卡以及助手可以读取的运行输出文件中；成功结束后的并集重遮盖能修正最终文件、模型终态和存储记录，却不能撤回当时已见内容。中途遮盖失败时，已发布的遮盖前缀保留，只有未发布/后续部分隐藏。编排器正在请 owner 将这两项残留加入规格限制表；本设计选择并冻结技术路径，但不把残留记录成 U-38 已批准。

接管仍仅是 Core Shell 捕获生命周期和 Effect/Promise ShellHooks 同一事件；没有新增 synthetic、模型或 UI takeover。扩展负责采集、profile、匹配、加密暂存和安全 staging；Core 只做发布/替换、计数、故障收口，依赖 Schema 固定说明，不复制匹配规则。登记范围仍见 §10。

### 4.6 只取消全部批准档的项目外读取 ask

不删 build 的整条 external_directory 规则。由现有 `external-directory-rule` 权威持有其读操作例外，扩展现有 permission.evaluate 消费；不在 UI、gate、风险器各建档位表。

执行前只为根内置 read 记录既有身份事实与 `(sessionID, messageID, id)`，根结束/失败后删除。read 原注册的 codemode=false（`packages/core/src/tool/plugin/read.ts:47`）；子调用不建立同键 read 记录或覆盖 execute 外层事务。permission 事件只有同时满足「source.type=tool、完整调用键对应已核实内置 read、agent 为既有全部批准载体、action=external_directory、当前 effect=ask、非自动化」才改为 allow。最终匹配的是执行中的调用而不是 metadata 自报工具名。不改变显式 deny、不写持久 grant、不放宽无 source 的请求。

询问档仍走原目录 ask，只读档对普通项目外文件仍由原 deny 处理；安全视图的名单内读取走 §4.4。write/edit/patch/shell 等动作在原 external_directory 规则下运行。风险分类始终仅提供说明，不能以「高风险」重新增加一次审批。

### 4.7 能力接缝图

「新增」表示本设计已经决定的实现能力；「raise」表示引擎缺口与接管决定，不能伪装为现有 callable。表只映射能力和合法边界，不是文件改动清单或工作单元。

| 所依赖的能力 | 合法 callable / 明确新增或 raise | 消费者与边界 |
| --- | --- | --- |
| 修改全部类型的成功/错误终态 | `Context.tool.hook("execute.after", ...)`，`packages/plugin/src/promise/tool.ts:47-71`；`Tool.executeTool`，`packages/core/src/tool.ts:155-179`，已实测 | 扩展 SecretMask；覆盖内置、插件、MCP、Code Mode 子调用与外层终态 |
| 覆盖运行期进度 | `Context.tool.transform` / `ToolEditor.update`，`packages/plugin/src/promise/tool.ts:25-35`；既有 `wrapForDisplay`，`packages/ext/src/policy/display.ts:43` | 已核实状态立即发，正文用当前集合处理，不等待长期进程退出 |
| 外层 begin / 子调用无状态 | **新增** SecretMask.begin 接在 `policy.seal` 的尾部 execute.before 回调内（`packages/ext/src/policy/index.ts:248-264`），confirm/pin 后最后一步；共享 context 的证据为 `packages/core/src/codemode/tool.ts:147-150` | 根 execute 建/结束唯一事务；活动键下 child before 不 begin，child after 只重读并转换自己的结果 |
| 保护直接读并保留 read 形状 | 同一 ToolEditor.update；现有 `ReadToolFileSystem.TextPage`，`packages/core/src/tool/read-filesystem.ts:81-88` | 新增 SecretMask.read；复用形状，不导入 Core 服务实现 |
| 判定路径 / 凭据字段 / 非密钥 | **新增** ProtectedFiles.sources/match/probe/isPublicValue 及 §4.1 profile 发布数据 | Schema 一份权威；相同依赖树边界、KUBECONFIG 拆分和列/字段选择由所有消费者共用 |
| 采集与变化检测 | **新增** §4.3 的 SecretMask 方法；Node `fs/promises.readdir/realpath/readFile/stat({bigint:true})`、`node:util.parseEnv` | stat 五元组缓存；SQLite 连同 WAL/SHM 判变，不复制名单，不收集任意 scalar |
| SQLite 明文单元格 | 已有 Node 内建 `DatabaseSync` 的 readOnly、prepare/iterate/close；仓内使用点 `packages/core/node_modules/@effect/sql-sqlite-node/src/SqliteClient.ts:36`；**新增**发布 profile 查询投影 | 扩展直接用 Node 内建，只读打开来源库；官方 gcloud schema 与只读/反例探针见 §2 |
| env 写回恢复 | 已有 ToolEditor.update/execute 包装；write Input `packages/core/src/tool/plugin/write.ts:19-24`、edit Input `:24-33`、Patch.parse/Hunk `packages/util/src/patch.ts:27-49`；**新增** SecretMask.prepareMutation | 传局部恢复副本给原执行器，不改 pin 后事件；old/new/context 按对应文件同键恢复。重建 patch 的私有序列化能力明确在扩展写回边界新增，不声称 Patch 已有 format API |
| 实时 shell / 最终文件 / 后台通知 | **raise SC-01**：§4.5 ShellHooks.capture 的 start/chunk/end + publish/replace | Core 同一捕获生命周期新增发布/安全文件替换；最终 outputDone 前完成重遮盖，不依赖 synthetic hook |
| 加密 spill / 流式终态重写 | **新增** §4.5 私有 spool；Node `crypto.randomBytes/createCipheriv/createDecipheriv`、认证 tag，`fs.createReadStream/createWriteStream` 与 `fs/promises.rename/unlink` | event.file 提供合法捕获目录；key 只留进程，原文仅当前帧/匹配尾部，不加输出上限 |
| 遮盖故障，命令继续 | **新增**总回调收口和固定说明；SC-01 采用已有 PluginHooks.has（`packages/core/src/plugin/hooks.ts:43-47,97-102`）、Effect.exit | 未发布部分丢弃；已发布前缀 + 说明的残留由 LIVE-01 待 owner 确认，不能写成全程零输出 |
| 真实退出码继续可见 | `Shell.result`（`packages/core/src/shell.ts:238-267`）保留实际 info，`ShellResult.metadata`（`packages/core/src/shell/result.ts:36-42`）投影 exit/signal/timeout | 隐藏只替换正文，不把遮盖错误写入进程退出状态，不从第三方自报字段伪造真实退出码 |
| 识别自动化并保留原拒绝 | `createUnattendedState().unattendedProfile`，`packages/ext/src/policy/unattended.ts:30` | 沿用现有在册状态和 AUTOMATION_PROFILES |
| 取消读目录 ask、保留其它权限 | `Context.permission.hook("evaluate", ...)`，`packages/plugin/src/promise/permission.ts:18-32`；`externalDirectoryRules/placeAfterBase`，`packages/ext/src/external-directory-rule.ts:38,59` | 新增读调用关联与该权威的操作判定；不声称可翻转已提前返回的 deny |
| 风险标注与当前卡片呈现 | `classifyPermissionRequest`，`packages/ext/src/policy/risk.ts:730`；`attachTerminal`，`packages/ext/src/policy/display.ts:67` | 复用既有风险信号和 Tool.Content 文本，末尾再遮盖 |
| 存储和模型消费 | `publisher.toolExecution`，`packages/core/src/session/runner/publish-llm-event.ts:561`；`toolResult`，`packages/core/src/session/runner/to-llm-message.ts:114` | 消费现有安全结果，不增加持久 schema、重放补丁或 UI 接缝 |

## 5. 数据与失败

不新增业务数据库、会话 schema、历史清洗或凭据存储。模型终态/存储记录仍在 after 后经原事件投影事务写入；直播文件逐段含当前集合处理的文本，结束时从加密原文 spool 用前后并集重写安全终态文件。两者的不同保证必须显式区分，不能把终态安全承诺套到尚未知值的直播窗口。

普通根工具/连接器的未发布结果若处理失败，整份动态 content/output/metadata/附件/error cause 以固定说明替换，保留可信执行状态。子工具使用同一安全替换形状但不创建/销毁外层状态；外层 Code Mode 只在自己的 after 终结。没有调用 ID 去重把不同 child 当作重试，也不会漏掉第二个/并发子调用的遮盖。

```ts
const hiddenResult: Tool.Result = {
  content: [{ type: "text", text: MASKING_FAILED_TEXT }],
  // 只另附宿主确定的 display/实际执行状态，不保留原动态 payload。
}
```

安全 read 出错返回固定说明的 TextPage（offset=1、truncated=false、无 next）；工具自身已失败时保留 Tool.Error 类型，message 只有说明，去掉内层 cause。对于 shell 直播，第一次 publish 前失败仍只有说明；中途失败则返回/保留已发布的处理后前缀与一次说明，未发布尾部和后续输出完全隐藏。前缀是 LIVE-01 待 owner 确认的范围差异，不伪称符合 v2 原文字面上的整次撤回。命令仍照常执行、exit/signal/timeout 仍真实可见，不自动重跑、不加确认、时限或容量上限。

终态 metadata 必须连同根包装保存的最后一份 progress 用结束重读集合重投影，并在同名键覆盖原值；不能只删 error.metadata，让 publisher 的 `failureSnapshot`（`packages/core/src/session/runner/publish-llm-event.ts:109-113`）再次合并旧正文。遮盖故障时，旧动态键覆盖为安全空值，只保留可信执行字段；Code Mode 自有的 toolCalls 摘要在故障终态置空，不让 child 共享 ID 引发父级原文回填。此处处理的是最终记录，不承诺撤回先前已见直播内容。

| 失败窗口 | 收口与消费者 |
| --- | --- |
| 前采集/首次输出之前 | 普通结果或 shell 文件只有说明，原工具/进程继续。单来源缺失/不可读仍按 §4.3 的来源边界处理。 |
| 直播 flush、spill 加密/写入、匹配或回调错误 | Core 锁存本 shell；停止发布并丢弃待处理/后续原文，文件与卡片保留已发布前缀 + 说明；cipher/key 清理，不把损坏帧或原字节当 fallback。 |
| end 的采集、认证、重遮盖、staging 构建失败 | 不原子替换运行文件；删除不完整 staging，仅保留先前已发布前缀 + 说明。该次最终模型/记录消费同一故障结果，不重新调用故障 masker。 |
| end 成功 | 关闭 writer、替换完整安全文件、更新计数、打开 outputDone；Job/后台 synthetic、Shell.result 和存储结果消费重遮盖后的同一最终文件。 |
| env 恢复 | 只在原 writer 之前恢复局部副本并保持权限/原错误契约；错误/输出/审批预览也遮盖，不用跨键历史秘密补写当前文件。 |
| 并发与 ext reload | 根事务键与 shellID 分区。ext 重载丢失 key/捕获状态时，运行中的后台 shell **输出转为隐藏**：保留已发布前缀并加说明，之后只 drain、不透传。用户进程不因此停止；新调用不继承旧调用的失败锁存。 |

密文 spool 只用于当前进程的活跃输出；结束/故障 unlink 并释放 key，失去 key 的孤立密文不恢复，按临时捕获材料清理。所有原始文件与 SQLite 库均只读采集；只有用户授权的原 write/edit/patch 写文件，env 恢复使保留的键继续保存真实值。源文件轮换与外部程序没有共同事务；LIVE-01 的两项残留除此之外不扩大 v2 已有的编码/拆分、临时生成后删除与程序解密边界。

## 6. 架构落点

对应现有 [模块地图](../../architecture/modules.md) 与 [架构约束](../../architecture/constraints.md)。均在已有包内增加自有职责，不新增包或顶层模块；不移动主进程的凭据存储权威，不调用另一代引擎 API。

| 责任 | 模块位置与依赖 | 复用权威 / 约束结论 |
| --- | --- | --- |
| 保护名单、公开值判定、平台路径匹配 | Schema 的纯 Code Puppy 契约；不依赖 Core/Server/UI | K2 收敛：风险器、read 和遮盖不再各持名单 |
| 凭据字段/SQLite 采集、安全 read、env 写回恢复、输出遮盖与加密 spool | Ext 的 Location 生命周期；依赖 Schema、公开 Plugin API、Node IO/crypto/sqlite | 不 import Electron main 私有模块或新依赖；原 writer、Patch.parse、身份和自动化仍为权威 |
| shell 捕获出口 | Core 调用已有 PluginHooks，事件类型归 Plugin；不反向依赖 Ext | SC-01 是明确必要接管；规则实现仍归扩展，不把名单写入上游 pump |
| 档位注入与项目外审批 | UI main 消除交互 `.env` 专用冲突；Ext 原权限权威解释操作例外 | K1 不新建档位载体列表；自动化原规则和非读取 ask 保持原义 |
| 历史、模型与卡片 | 现有投影、终态降层和直播跟随文本区 | 直播继续，终态重新遮盖；已见缓存不能撤回，属于 LIVE-01；不添 UI redactor/frames/客户端协议 |

复用原则：固定名单是业务常量，roots 是已有宿主路径事实，均不是新增用户配置；跨平台路径在共享权威实现一次；所有数据错误不含秘密。现有风险探针的输入扫描 cap 不得继承给秘密结果遮盖，不能借性能理由新加秘密长度或结果长度限制。

被否决的替代：

- OS 拒读名单：程序也读不到，违反 BR-04。
- 只遮盖模型请求或 UI：数据库或另一消费者仍保留原值，违反 BR-03。
- 只写 after：探针与 shell 调用链证明进度、实时卡片和后台持久化会先漏。
- 只删 build 的 external_directory ask：同时放松写入类目录审批，超出 BR-05。
- 只按 API key 前缀/长度识别：普通密码、短值、自定义 token 不满足保证；BR-06 必须按发布规则而非猜测。
- 依靠 watcher 承诺覆盖命令内部临时值：超出 v2 已批准范围且没有证明。
- r1 的整段延迟发布：未经批准地移除了长期/后台命令的直播能力；R1-B1 接受并改为直播 + 诚实残留，不再把推导当作 owner 同意。
- 全标量/整 JSON/整 SQLite 文件匹配：R1-B2/M4 的反例证明会误遮普通文本或漏掉查询出的 token；改为同一发布数据中的凭据字段/单元格。
- 在内存保留全部 shell 原文：改为逐帧认证加密 spill，不用新增限额规避资源问题。
- 遮盖失败后返回原文、只隐藏终态卡或停止命令：分别违反 BR-07 或 BR-04；v2 只授权本次输出隐藏，不授权新确认和停执行。

安全边界：可信方是宿主、发布名单、引擎/扩展实现及进程内存；不可信输入包括模型发起的命令、文件内容、工具/MCP 返回值。连接器执行时照常读文件，服务器与程序已经接触值不属于「未给模型」的证明。已批准的残留是原样同值误遮、程序编码/拆分、前后不可读的临时生成后删除值及加密存储经程序解密才输出的值；用户粘贴、应用自有凭据和阻止程序联网按规格排除。任意原生插件读内存、外部程序直接联网、OS 数据库解密没有在本票得到新的防护承诺。

不变量：不为遮盖改写来源文件；授权 env 写回恢复当前同键值；秘密集合/key 不出进程，spool 只含认证密文；直播只发布按当时已知集合处理的文本；成功终态用前后并集再次遮盖模型结果、记录和最终文件；故障不停止命令；名单/字段与公开值只有一份权威。直播已见内容及中途故障前缀保留的保证差异只在 LIVE-01 待 owner 处置，不再隐含宣称全时刻零泄漏。

## 8. 拆分决定

不适用跨仓拆分；Schema、Ext、Core、Plugin、桌面宿主在同一仓。SC-01 是上游接管权限边界，不是另开跨仓接口或顺序 Task。后续实施需消费经裁决和审查冻结的 §4；不能在未映射的出口上先行实现。

## 9. 回滚

不适用。没有数据迁移、不可逆数据改动或规格要求的回退路径；不设计旧版本行为或兼容期。

## 10. 裁决与审查结论

### R1 处置与冻结范围

独立 R1：Claude Opus 5.5，只读，审查 `582f056887`，返回 BLOCKED（2 Blocker、4 Major、1 Minor）。编排器在本轮逐项接受；review frontmatter 记录的是“blocked → corrected”，不是伪造第二次审计通过。

| finding / 编排器处置 | 本次修正与证据 | 当前冻结状态 |
| --- | --- | --- |
| R1-B1：整段延迟发布移除直播；接受 | §2 核实际长期 shell/直播入口；§4.5 每 flush 重读、L−1 尾部、直播 publish、end 并集重遮盖。去掉 r1 的 size=0 直至结束及禁止 chunk publish | 技术路径 frozen；只有下述 LIVE-01 残留 frozen-pending-owner |
| R1-B2：全 scalar/全文短项污染全部输出；接受 | §4.1 发布数据改成逐 profile 凭据字段，所有格式应用非秘密键的数值/布尔/loopback/log-level 公开规则；默认剪枝依赖树、显式保护路径例外 | frozen |
| R1-M1：Code Mode 共享调用 ID；接受 | §2 引用 `codemode/tool.ts:147-150`；§4.3/§4.7 指定 policy.seal 的 confirm/pin 后根 begin，children 仅 retained values + 结果时重读，无独立状态/清理 | frozen |
| R1-M2：无界原文内存；接受 | §4.5 每 shell 内存 key、逐帧 AES-256-GCM spill，最终逐帧认证/解密/尾部匹配写安全 staging；无新输出上限 | frozen |
| R1-M3：env 写回会存下遮盖符；接受 | §4.3.1 write/edit/patch 执行器包装，对同目标同键恢复当前 RHS，old/new/context 均处理；保留原写入器与权限 | frozen |
| R1-M4：SQLite 明文查询漏遮；接受 | §2 官方 594.0.1 core 源码哈希、实际 DDL 的只读/对照探针 exit 0；§4.1 sqlite 凭据列和 Firefox cookies.sqlite | frozen |
| R1-m1：KUBECONFIG 是路径列表；接受 | §4.2 使用 path.delimiter 逐项解析，Windows/Unix 分隔符与盘符区分 | frozen |
| OPTIONAL：三项接受 | §4.3 stat 五元组缓存；§4.5 去 ANSI 后匹配；§5 及下文实施注记明确 ext reload 隐藏运行后台 shell 的输出 | frozen |

**LIVE-01：唯一待 owner 项。** 设计已经选择直播路径；某值在打印后才写入受保护文件，直播卡/其缓存以及模型可读的运行输出文件可能已经出现该值；成功结束后的并集重遮盖不能追回已见内容。中途遮盖失败保留已经发布的遮盖前缀，其余部分隐藏并说明，命令继续。编排器正请 owner 将这两个残留加入规格限制表；目前没有 owner 原话或规格新版本证明已接受，**不得把 v2/U-38 记成批准此残留**。本次不修改 spec.md，也不另问一次已由编排器提出的问题；等待该一项确认，其余段落保持 frozen。

### 已有 Owner 裁决与接管登记

**O-1 已批准，不重开。** 2026-11-26 U-38，owner 对所引用的引擎改动等问题回答「好的。」。SC-01 的同一 Core 捕获生命周期与 Effect/Promise capture 面、规则仍在扩展的边界不变；r2 的直播 flush/终态 replace 在该面内完成，不新增模型、synthetic 或 UI 接管。

**O-2 已落入规格 v2。** `834e269da9` / #1765 明确前后可读值范围与故障隐藏；它没有批准取消直播或保留已发前缀，r1 的相反解释被 R1-B1 推翻并只在 LIVE-01 待确认。写回、profile、SQLite、调用状态等技术修正依本轮明确编排器授权 frozen，不借审查增加用户确认/配额/停执行。

SC-01 的登记权威固定如下；这是架构边界决定，当前设计提交不修改规则或运行登记资产：

- 新增接管 ADR 落在现有运行规则 ADR 命名空间，使用当前空闲的 `.claude/rules/adrs/ADR-050-secrets-output-capture.md`，记录 U-38、规格 v2、为何公开 hook 不足及上述三个最小接管面；不重写已批准的 ADR-047 代际决定。
- 现有唯一权威册 `docs/architecture/codepuppy-authority-registry.json` 新增决策 ID `secrets-output-capture`。该条的 `takeovers` 只列 SC-01 的 Core pump 和两个 ShellHooks 面，`mechanism` 指向实际持有遮盖规则的扩展实现；`adr`/来源关联 ADR-050、#1758 与 U-38。真实实现和证明到位时登记已有格式所需的 proof 引用，不填不存在的测试、不登记成 blocked 项。
- 上游准入逐文件登记在既有 `scripts/north-star-guard.sh:124` 的 `UPSTREAM_EXCLUDES`。CI 在 `.github/workflows/codepuppy-ci.yml:126-133` 直接调用同一脚本；不重建已经消除的第二张 CI excludes 表。沿用既有 parity/authority judge；不能只加包级豁免，也不能只在本设计写「允许接管」就认为已登记。守卫 `:117-118` 的旧说明仍提到双表，与当前调用接线不符，本票只消费实际单一权威，不修该旁观注释。

这些登记与 SC-01 实现同一行为变更生效；本轮仅冻结构与授权，不伪造已实现机制或验证证据。后续审查消费规格 v2、本节 owner 来源及 §4/§5 的发布/失败契约。

### 检查收据

| 轮 / 版本与范围 | 检查方 | finding 与结论 | 遗留去向 |
| --- | --- | --- | --- |
| r0 / `ef920c7580`，成功 hook 与采集反例 | Codex / GPT-6 作者自查 | 两项最终探针 exit 0，成功 hook 的正反结论继承 | 原 O-1/O-2 后续已由 U-38 与规格 v2 处置 |
| r1 / `582f056887` | Codex / GPT-6 作者自查 | 交付了待独立审查版本；其中整段延迟发布、全标量采集等结论已被下行推翻，不继续继承为有效决定 | 由 R1 逐项修正 |
| **R1 / `582f056887` / §2、§4、§5、§10** | **Claude Opus 5.5，独立只读** | **BLOCKED：2 Blocker、4 Major、1 Minor；编排器全部接受，本轮按上表纠正** | 只剩 LIVE-01 的 owner 范围确认；没有重新记为 pass |
| r2 / 本文修正、规格 v2 与 R1 delta | Codex / GPT-6 作者自查 | 已核真实 Code Mode/写入/直播接缝；gcloud 官方 schema、只读/对照探针与 crypto/stat 原语探针 exit 0；§4.7 每项能力映射到真实 callable 或明确新增 | metadata 为 frozen-pending-owner；非 LIVE-01 契约 frozen；实现/真实多消费者及 Windows 验收未冒称完成 |

文档验证（r2）：在 `packages/ui-mac` 执行 `bun test src/main/old-name-scan.test.ts`，exit **0**、`10 pass / 0 fail`。按已解析组合 profile 调用 `check_repo(..., changed_since="HEAD")`，本文 findings 为零；入口仍报既有 index.stale 与两个跨仓裸 ID，未宣称仓级文档门通过。review 元数据、七项处置、章节编号、本地链接、旧名词元和 `git diff --check` 自查通过。只提交本文和对应生成索引行，不合并上游，不扩项修复。

**实施注记（已接受 OPTIONAL，不是工作单元/测试清单）**：重读缓存只用 stat 五元组（SQLite 含 WAL/SHM）；去 ANSI 必须跨 chunk 保持解析状态；ext reload 会隐藏运行后台 shell 的后续输出，保留已发前缀并说明，进程继续，不能失去 key 后透传或尝试用新 key 解旧 spool。

**仍未核验**：SC-01、env 写回包装、各 profile 解析与 spill/staging 尚未实现，晚发值/中途故障的全消费者合成与出货 Windows/Node SQLite 尚待实施验证。只读本机样本不是出货运行证明。真实新值不进模型的全时刻承诺不属于已冻结结论，精确残留只在 LIVE-01。

**留档**：既有入口索引问题及守卫旧双表说明仍按前轮证据保留，未改运行规则/权威册。R1 的技术项已纠正、收据已更新；等待 owner 的仅为已明确提出的直播残留，不把它扩成额外实现前置审批。
