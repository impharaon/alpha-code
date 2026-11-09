import { clearOfficialConnectorRuntime, clearOfficialConnectorRuntimeOnExit, restoreCommittedOfficialConnectors } from "./official-connector-resources"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
// `#1423`:**命名空间导入,不是具名导入** —— 这一行曾是仓内唯一的
// `import { app, utilityProcess } from "electron"`,而它让 server.ts 在 `bun test src` 全量里**链接期**就抛
// (macOS:`Missing 'default' export in module …/electron/index.js`;ubuntu:`Export named 'utilityProcess'
// not found`),于是 import 面能走到 ./server 的三个测试文件整份夭折、几十条断言一条没跑。
// 机制与 codepuppy-keychain-backend.ts 头注记的同一条:bun 的 `mock.module("electron", …)` 把该模块的**导出名集合**
// 钉死在测试进程里**第一个**被实例化的工厂上,后来的工厂只改值、静默丢掉新名字,而 bun 的文件顺序不是 CLI 顺序 ——
// 于是具名导入的成败取决于**哪个无关测试文件的 electron mock 先跑**。命名空间导入不点名任何导出,恒能链接。
import * as electronNs from "electron"
import type { Details } from "electron"
import { resolveExtPluginPath } from "./codepuppy-ext-plugin"
import { engineDatabasePath, engineGlobalConfigDirectory } from "./engine-paths"
import { CHANNEL } from "./constants"
import { getAuthIdentityTag } from "./codepuppy-auth"
import { installationMachineId } from "./artifact-service"
import { tryGetCodePuppyEnvironment } from "./codepuppy-environment"
import { CLOUD_WEBSEARCH_DENY_ENV, LOCAL_WEBSEARCH_DENY_ENV } from "./cloud-web-search"
import { resourcesRoot } from "./ext-fs-installer"
import { secretFileRef, syncSecretFiles } from "./codepuppy-secret-files"
import { customProviderSecretValues } from "./codepuppy-byok-keys"
import { ignoredConfigProviderBlocks, ignoredConfigRemoteMcpEntries } from "./ext-config"
import { readCustomProviderRecords } from "./custom-provider-records"
import { readMcpServerRecords } from "./mcp-server-records"
import { buildCodePuppyModelConfig } from "./codepuppy-models"
import { pinAppliedCatalog } from "./codepuppy-live-allowlist"
import { loadCodePuppySecrets } from "./codepuppy-secrets"
import { posixModesEffective } from "./platform"
import { pollUntilHealthy } from "./health-poll"
import { getLogger, rotateServerLogs, write } from "./logging"
import { createSidecarEnv, sidecarEgressProxyEnv } from "./sidecar-env"
import { getUserShell, loadShellEnv } from "./shell-env"
import { probeShellEnvAsync, readShellEnvCache, sanitizeCachedShellEnv, writeShellEnvCache } from "./shell-env-cache"
import { getStore } from "./store"
import { DEFAULT_SERVER_URL_KEY } from "./store-keys"
import { isEphemeralLocalServerUrl } from "../shared/ephemeral-server-url"
import { ensureEngineScratchCwd } from "./engine-scratch-cwd"
import { markStartupTimeline } from "./startup-timeline"
import { codepuppyUserWorkspaceDir } from "./codepuppy-user-workspace"
import { SIDECAR_STOP_COMMAND } from "./sidecar-stop"
import type { CodePuppySidecarOutbound } from "./codepuppy-sidecar-messages"
import { consumeDanglingSweepCredit } from "./dangling-sweep-latch"
// REQ-159 `#1321`:进程围栏计划 —— fork 之前渲染 + 试编译可写集、解析原生模块路径,经 StartCommand 交给
// sidecar 在 import 引擎之前 apply。计划做不出来 = 拒绝 fork(fail-closed,原因可读),不静默无围栏。
import { planProcessFence, type ProcessFencePlan } from "./process-fence-plan"
import { trialCompileProfile } from "./process-fence-compile"
import type { ProcessFenceStartInput } from "./process-fence-apply"
// REQ-137 `#1337`:网络出网的强制半场接线。围栏(profile N1–N4)把 sidecar 那棵树的出网收成 loopback 上**一个**端口,
// 那个端口上听着的是本进程(main,围栏外 —— `(deny network*)` 连带拦 DNS,代理必须在围栏外才解析得了域名,
// `#1073` 裁决三)里的策略代理;它只放行 network-egress-registry.ts 登记过的 `host:port`。代理在第一次 fork 之前起、
// 跨 respawn 复用;起不来 = 拒绝 fork(与围栏计划失败同一条 fail-closed 路)。sidecar 的八个代理变量在这里整份改写
// 成指向它(sidecarEgressProxyEnv),main 自己的 process.env 一个字都不动 —— main / renderer 的出网不在覆盖内(AC5)。
import { startEgressPolicyProxy, type EgressLogRecord, type EgressProxyHandle } from "./network-egress-proxy"
// REQ-137 `#1379`:出网授权的**动态半场**。静态表装不下 BYOK 直连的目的地(它由用户配置了谁决定),
// 所以放行集合从这一代要注入给引擎的那份有效配置里的 `provider.<id>.options.baseURL` 派生,fork 前整份替换。
import { deriveEgressDestinations, deriveMcpEgressDestinations, setConfiguredEgressDestinations } from "./network-egress-derived"
// `#1412`:出网授权的**第三个半场** —— 用户当场批准的目的地。两条轴(`webfetch` 的 URL 与 `bash` 里命令
// 自带的目的地)的目的地由模型即时生成,没有配置来源可派生,所以它们的真源只能是「用户点的那一下」。
import { configureEgressGrantApproval, setUserEgressGrants } from "./network-egress-grants"
import { persistEgressGrantRecord, readEgressGrantRecords } from "./egress-grant-records"
import { askUserForEgressGrant } from "./egress-approval-dialog"
// REQ-159 `#1322`:工作区写探针的 main 半场 —— 请求/应答簿记住在 workspace-write-probe.ts,这里只接线到子进程。
import { createWriteProbeRequester, type WorkspaceWriteProbeResult } from "./workspace-write-probe"
import { codepuppyGlobalRoot } from "./engine-config-truth"
import { ensureUserWorkspaceDir } from "./codepuppy-user-workspace"
import { fenceWorkspaceTruthPath, readWorkspaceTruthOrThrow } from "./process-fence-workspaces"
import { homedir } from "node:os"
import { mkdirSync, readFileSync, realpathSync, statSync } from "node:fs"

export type HealthCheck = { wait: Promise<void> }

// #613:ready 可携带注入失败(sidecar.ts 同构镜像)——引擎起来了但 alpha 配置整份丢失。
// #881:ready 另外携带 prewarm 的结局与耗时 —— `phase=ready` 结构上不等于「目录已收敛」,
// 这三个字段是打包证据里唯一能回答「ready 是等到了什么才发的」的东西。
type SidecarMessage =
  | {
      type: "ready"
      injectionFailure?: { message: string; stack?: string }
      prewarmOutcome?: string
      prewarmMs?: number
      prewarmStatus?: number
    }
  | { type: "stopped" }
  | { type: "error"; error: { message: string; stack?: string } }

export type SidecarListener = {
  stop: () => Promise<void>
  kill: () => void
  /**
   * REQ-159 `#1322`:让**被围栏的 sidecar** 在 `directory` 真写一次再删,回答 writable / denied / unknown。
   * 超时、进程已退出、应答形状不对 ⇒ unknown(呈现层 unknown = 无标记,不猜)。
   */
  probeWrite: (directory: string) => Promise<WorkspaceWriteProbeResult>
}

const SIDECAR_SERVICE_NAME = "opencode server"
const SIDECAR_START_STALL_TIMEOUT = 60_000
const SIDECAR_STOP_TIMEOUT = 6_000

type SpawnLocalServerOptions = {
  userDataPath: string
  onStdout?: (message: string) => void
  onStderr?: (message: string) => void
  onExit?: (code: number) => void
  healthCheck?: typeof checkHealth
  fork?: typeof electronNs.utilityProcess.fork
  timelineContext?: "boot" | "respawn"
  /** `#1555`:这一代 sidecar 的序号,记进 fork 前钉住的「已应用目录」(诊断用)。 */
  generation?: number
  /**
   * REQ-159 `#1321`:围栏计划器。缺省 = 生产计划器(store 并集 + 真 sandbox-exec 试编译 + 原生模块解析);
   * 测试用假子进程时注入替身。返回 undefined 只允许在非 darwin(那里没有 seatbelt);darwin 上
   * 生产计划器要么给出计划、要么抛出 —— 抛出 = 这一代 fork 被拒(与 codepuppy-secrets sync 失败同一条路)。
   */
  planFence?: (input: { userDataPath: string; sidecarEnv: Record<string, string>; egressProxyPort: number | undefined }) => ProcessFenceStartInput | undefined
  /**
   * REQ-137 `#1337`:策略代理的提供者。缺省 = 生产单例(ensureEgressPolicyProxy:本进程内真起一个,跨 fork 复用);
   * 测试注入一个假端口以免每条用例都起监听。reject = 这一代 fork 被拒。只在 darwin 上被调用 —— 围栏只在那里,
   * 没有强制层的平台不装策略层(如实:那里的引擎本来就没有围栏,不假装有一半)。
   */
  egressProxy?: () => Promise<{ port: number }>
  /**
   * REQ-234 `#1529`:parentPort 上 `codepuppy.*` 窄消息的 main 侧接收者(hub-view.ts 的 createCodePuppySidecarHost)。
   * `receive` 与 writeProbes 并列挂在 `child.on("message")` 上;ready 之后 `attach`,子进程退出时调它返回的断开函数。
   */
  codepuppySidecar?: {
    receive(message: unknown, post: (message: CodePuppySidecarOutbound) => void): boolean
    attach(post: (message: CodePuppySidecarOutbound) => void): (reason: string) => void
  }
}

// ── REQ-137:策略代理单例(main 进程内,围栏外)──────────────────────────────────────────
// 一次起、跨 respawn 复用:端口写进每一代的 profile(N4)与 sidecar env,换代不换端口。起失败时把单例清掉,
// 下一次 fork 再试(不把一次失败钉成永久失败)。它的结构化记录(每条 CONNECT 的 allow / deny 与原因)进 main 日志,
// deny 走 warn —— 「工具把数据发到未授权目的地时失败且可见」的可见就在这一行。
let egressProxySingleton: Promise<EgressProxyHandle> | undefined
function ensureEgressPolicyProxy(): Promise<EgressProxyHandle> {
  if (!egressProxySingleton) {
    const log = (record: EgressLogRecord) => {
      const line = `network egress ${JSON.stringify(record)}`
      // `#1412`:用户拒掉一个目的地,与代理自己拒掉一个目的地同级别 —— 两者都是「有东西没发出去」,
      // 都要在日志里显眼(「工具把数据发到未授权目的地时失败且可见」的可见就在这两行)。
      const denied = (record.event === "egress.connect" && record.verdict === "deny") || (record.event === "egress.grant" && record.decision === "refused")
      // `#1572`:代理主动关掉一条上游零回应的 TLS 隧道 —— 正是「没人看见的静默隧道」,同样走 warn。
      if (denied || record.event === "egress.tunnel-silent") getLogger()?.warn(line)
      else getLogger()?.log(line)
    }
    // `#1412`:第三个半场在这里接上 —— 装载盘上已批准的目的地,并把「问用户」与「记住」两条通道
    // 交给编排模块。**接线只在这一处**:没有它,requestUserEgressGrant 恒答 `not-asked`(不是 false ——
    // 结局是三态,`not-asked` 表示「根本没问人」,代理据此不写 grant 记录),未登记目的地照旧 403。
    // ⚠️ **装载只发生在这里,没有任何重读**:用户删掉真源里的一条记录,**本次运行照样放行** ——
    // 要撤销得删记录**并重启应用**。文案两处都必须这么说(egress-grant-records.ts 的那行日志、
    // 方案基线 §7.4);少说「并重启」就是产品在说假话。真正的热重读是另一票。
    const grantLog = (line: string) => getLogger()?.log(line)
    const loaded = setUserEgressGrants(readEgressGrantRecords(grantLog))
    getLogger()?.log(
      `network egress: ${loaded.length} user-approved destination(s) restored from the grant truth — ` +
        (loaded.map((g) => `${g.host}:${g.port}`).join(", ") || "none") +
        "; a destination enters this set only from the approval dialog in this process",
    )
    configureEgressGrantApproval({
      approver: askUserForEgressGrant,
      persist: (grant) => persistEgressGrantRecord(grant, new Date().toISOString(), grantLog),
    })
    egressProxySingleton = startEgressPolicyProxy({ log }).then(
      (handle) => {
        getLogger()?.log(`network egress policy proxy listening on ${handle.host}:${handle.port} — the only way out of the engine tree (REQ-137); destinations = network-egress-registry.ts`)
        return handle
      },
      (error) => {
        egressProxySingleton = undefined
        throw error
      },
    )
  }
  return egressProxySingleton
}

// ── REQ-137 `#1379`:出网授权的动态半场,每代重算一次 ───────────────────────────────────
// 静态表(network-egress-registry.ts)只装常量,装不下「用户配置了哪几家 BYOK」。放行集合因此从
// **引擎真正会去连的那个值**派生 —— `buildCodePuppyModelConfig` 产出的那份 provider 表里的
// `options.baseURL`。sidecar 那边 injectCodePuppyConfig 调的是**同一个函数、同一个 userDataPath**,
// 而密钥文件刚由上面那次 syncSecretFiles 落定 ⇒ 两边不可能分叉。必须排在 syncSecretFiles **之后**、
// fork 之前:前者决定哪些 BYOK 节点存在,后者是这一代的起点。
//
// **输入只有这一个,配置文件刻意不读**(`#1380` R1 Blocker):provider 块住的那三条路径
// (codepuppy.jsonc / `<XDG_CONFIG_HOME>/opencode` / `~/.opencode`)全在 seatbelt 的可写集里
// (process-fence-profile.ts W2 / W6 / W16),也就是**被围栏的引擎树自己写得了**的地方。读它等于让引擎
// 写一行 baseURL 就给自己铸一条出网通道(confused deputy)。而注入面里这三条路径只贡献 `enabled_providers`
// 与 `options.apiKey`(codepuppy-models.ts 第 (3) 段),**从不贡献 baseURL** —— 判据在
// network-egress-derived.test.ts 的 B1 那条(带对照臂)。
// `#1392`(基线 I3):配置文件里既有的 provider 块从此被忽略(它们全在围栏的可写集里,不再参与注入面与放行集合)。
// `#1381`:配置文件里既有的 `mcp.*` **远程**条目同样被忽略(sidecar 侧 mcp-default-deny.ts 把它们压成 enabled:false)。
// 不采信、不迁移、不建「待确认」面 —— 只在每个进程第一次 fork 时出声一次,说清忽略了哪些、在哪个文件、为什么、怎么办。
let ignoredConfigRecordsLogged = false
function logIgnoredConfigRecordsOnce(): void {
  if (ignoredConfigRecordsLogged) return
  if (!(tryGetCodePuppyEnvironment() || process.env.CODEPUPPY_GLOBAL_DIR)) return // no environment root ⇒ no config file to speak of (unit-test forks); not latched
  let blocks: Array<{ file: string; ids: string[] }>
  let mcpEntries: Array<{ file: string; names: string[] }>
  try {
    blocks = ignoredConfigProviderBlocks()
    mcpEntries = ignoredConfigRemoteMcpEntries()
  } catch {
    return
  }
  ignoredConfigRecordsLogged = true
  for (const { file, ids } of blocks)
    getLogger()?.log(
      `custom providers: ignoring provider.* in ${file} (ids: ${ids.join(", ")}) — config files are writable by the fenced engine tree, ` +
        "so they no longer feed the model list or the egress allowlist (#1392); a service you added yourself must be re-added from the model picker",
    )
  for (const { file, names } of mcpEntries)
    getLogger()?.log(
      `remote MCP servers: ignoring remote mcp.* entries in ${file} (names: ${names.join(", ")}) — config files are writable by the fenced engine tree, ` +
        "so they are neither injected nor authorized (#1381); a connector you added yourself must be re-added from the extension hub",
    )
}

/** 仅测试:让下一次 fork 再出声一次(生产每进程一次)。 */
export function __resetIgnoredConfigProvidersLogForTests(): void {
  ignoredConfigRecordsLogged = false
}

// `#1381`:放行集合的动态半场有两个成员 —— BYOK / 自定义节点(注入面的 provider 表)与用户自配的远程 MCP 服务器(真源
// mcp-servers/<env>.json)。两份经同一个准入函数派生,并成**一次**整份替换;日志一句点名全部,出处标签区分(`mcp:<name>`)。
function refreshConfiguredEgressDestinations(userDataPath: string): void {
  try {
    const mcpServers = tryGetCodePuppyEnvironment() || process.env.CODEPUPPY_GLOBAL_DIR ? readMcpServerRecords((line) => getLogger()?.warn(line)) : []
    const accepted = setConfiguredEgressDestinations([
      ...deriveEgressDestinations(buildCodePuppyModelConfig(userDataPath)?.provider),
      ...deriveMcpEgressDestinations(mcpServers),
    ])
    getLogger()?.log(
      `network egress: ${accepted.length} configured destination(s) authorized for this generation — ` +
        (accepted.map((d) => `${d.host}:${d.port} (${d.providerId})`).join(", ") || "none"),
    )
  } catch (error) {
    // 派生失败不拒 fork:配置读坏只该让 BYOK 调用与远程 MCP 被拒(403,原因可读),不该让整个应用起不来。
    // 但**必须清空** —— 留着上一代的集合等于拿旧配置给新一代放行,那是 fail-open 的方向。
    setConfiguredEgressDestinations([])
    getLogger()?.error(
      "network egress: failed to derive this generation's configured destinations — BYOK direct calls and remote MCP servers will be refused (403 unregistered) until the next fork",
      error,
    )
  }
}

/** 生产计划器:把 electron / store / fs 接进 electron-free 的 planProcessFence。 */
function planProductionFence(input: { userDataPath: string; sidecarEnv: Record<string, string>; egressProxyPort: number | undefined }): ProcessFencePlan | undefined {
  if (process.platform !== "darwin") return undefined
  if (input.egressProxyPort === undefined) throw new Error("process fence plan: no egress proxy port on darwin — the fence's only outbound door is unknown, refusing to plan")
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  return planProcessFence(
    {
      userDataPath: input.userDataPath,
      sidecarEnv: input.sidecarEnv,
      addon: { packaged: electronNs.app.isPackaged, resourcesPath: process.resourcesPath, moduleDir, exists: existsSync },
      egressProxyPort: input.egressProxyPort,
    },
    {
      homeDir: homedir,
      codepuppyGlobalRoot,
      // `#1390`:应用状态根 = 冻结环境快照的 casBaseRoot(index.ts 在任何根消费方之前 initCodePuppyEnvironment,失败即 app.exit)。
      // 没有快照就没有可信的状态根 ⇒ 不做计划(fail-closed,与别的计划失败同一条「拒 fork」路),不拿 CODEPUPPY_GLOBAL_DIR 反推。
      appStateRoot: () => {
        const info = tryGetCodePuppyEnvironment()
        if (!info) throw new Error("process fence plan: alpha environment not initialized — the app state root is unknown, refusing to plan")
        return info.casBaseRoot
      },
      // `#1390`:必须是 `.native`(libc realpath(3),归一大小写);JS 版 realpathSync 在 Electron 内嵌 node 里只解软链。
      realpath: (p) => realpathSync.native(p),
      // `~/code-puppy` 是唯一允许 lazy 代建的目录(ADR-025);建不出来就让并集判它不存在 ⇒ planner 拒 fork。
      defaultWorkspace: () => ensureUserWorkspaceDir() ?? codepuppyUserWorkspaceDir(),
      // `#1394`:工作区清单从围栏写不到的真源读(<appData>/codepuppy-state/fence-workspaces/<env>.json,只有 main 写;
      // index.ts 在首次 fork 之前播种 / 装载,ipc.ts 随 renderer 的 store-set 更新)。electron store 那份(opencode.global.dat)
      // 住在 W3 之下、被围栏的引擎树写得了,**从此不再喂给围栏**。缺失 / 坏 ⇒ 抛 ⇒ planner 退到默认工作区并出声。
      readWorkspaces: () => {
        const info = tryGetCodePuppyEnvironment()
        if (!info) throw new Error("alpha environment not initialized — the workspace truth location is unknown")
        return readWorkspaceTruthOrThrow(fenceWorkspaceTruthPath(info.casBaseRoot, info.environment), { readFileSync })
      },
      isDirectory: (p) => {
        try {
          return statSync(p).isDirectory()
        } catch {
          return false
        }
      },
      mkdirp: (p) => void mkdirSync(p, { recursive: true }),
      compile: trialCompileProfile,
      log: (line) => getLogger()?.log(line),
    },
  )
}

export function getDefaultServerUrl(): string | null {
  const value = getStore().get(DEFAULT_SERVER_URL_KEY)
  const url = typeof value === "string" ? value : null
  if (url && isEphemeralLocalServerUrl(url)) {
    // REQ-042(REQ-040 收尾):陈旧「具体端口本地 URL」默认的丢弃必须留痕(反静默,B11 纪律)且删键——
    // 否则该键永留 store、每次开机重判。set-default 写入时不拦(彼时 URL 真活),只在冷启动读取处治理。
    getLogger().log(
      `[server] discarding stale local default server url (${url}) — embedded sidecar port is random per launch; falling back to live sidecar (stale key removed)`,
    )
    getStore().delete(DEFAULT_SERVER_URL_KEY)
    return null
  }
  return url
}

export function setDefaultServerUrl(url: string | null) {
  if (url) {
    getStore().set(DEFAULT_SERVER_URL_KEY, url)
    return
  }

  getStore().delete(DEFAULT_SERVER_URL_KEY)
}

/**
 * web search 主权判决,**幂等**、可反复重算,每次 fork 前落定;sidecar 只读不算。唯一能关掉两条腿的是 kill-switch
 * (`CODEPUPPY_WEBSEARCH_DISABLE`);`#1411`(owner 2026-09-23):账户信号只决定云腿在不在,不决定本地腿。
 * 判决经两个布尔 env 过河:`CODEPUPPY_CLOUD_WEBSEARCH_DENY` / `CODEPUPPY_LOCAL_WEBSEARCH_DENY`(两个方向都写)。
 *
 * `#1667`(#1662 L5,清点表 E2):v1 时代这里还把 4 个 keyless 专用 flag(`OPENCODE_ENABLE_EXA` /
 * `OPENCODE_EXPERIMENTAL_EXA` / `OPENCODE_ENABLE_PARALLEL` / `OPENCODE_EXPERIMENTAL_PARALLEL`)覆盖写 "0"、登出时还原基线、
 * 默认置 `OPENCODE_ENABLE_EXA=1`。这 4 个名字在 2.x 无读者(本地腿在 2.x 走 `websearch` 配置与插件 domain,处置归 L3),
 * 写它们只会让人以为它们还在管事 —— 整套删除。
 */
export function applyWebSearchSovereignty() {
  const killSwitch = Boolean(process.env.CODEPUPPY_WEBSEARCH_DISABLE)
  if (killSwitch) process.env[CLOUD_WEBSEARCH_DENY_ENV] = "1"
  else delete process.env[CLOUD_WEBSEARCH_DENY_ENV]
  if (killSwitch) process.env[LOCAL_WEBSEARCH_DENY_ENV] = "1"
  else delete process.env[LOCAL_WEBSEARCH_DENY_ENV]
}

export function preferAppEnv(userDataPath: string) {
  const logger = getLogger()
  const logShellEnvCache = (message: string, extra?: Record<string, unknown>) => write("main", message, extra)
  const shell = process.platform === "win32" ? null : getUserShell()
  // 1. Login-shell env first -- a real `export` wins over the secrets file and ordinary defaults;
  //    the websearch capability controls below are explicit local sovereignty overrides.
  // B1:缓存命中 → 0ms 套用 + 后台异步真探测(成功即更新缓存、按「真 export 赢」套差异,新值下次
  // fork 生效);未命中(首启/换 shell)→ 同步探测一次(fork 前必须有 PATH 等,宁可首启慢一次)。
  if (shell) {
    const cached = readShellEnvCache(userDataPath, shell, logShellEnvCache)
    if (cached) {
      Object.assign(process.env, cached)
      logger.log(`[server] Shell env from cache (${Object.keys(cached).length} vars) — refreshing in background`)
      void probeShellEnvAsync(shell)
        .then((fresh) => {
          if (!fresh) return
          // REQ-098 #301:新鲜异步探测结果同样要剥离会话级控制键(CODEPUPPY_GLOBAL_DIR / OPENCODE_CONFIG_DIR
          // / CODEPUPPY_OPENCODE_HOME…),否则用户 rc 里的显式 export 会在环境冻结后覆盖 process.env,让根漂移
          // 并随 fork 传进 sidecar。此前仅缓存读路径净化,fresh 路径漏网(与冻结快照形成双真源)。
          const { env: cleanFresh, stripped } = sanitizeCachedShellEnv(fresh)
          if (stripped.length > 0)
            logger.log(
              `[server] [req301] stripped session-control keys from refreshed shell env: ${stripped.join(", ")}`,
            )
          writeShellEnvCache(userDataPath, shell, cleanFresh, logShellEnvCache)
          Object.assign(process.env, cleanFresh)
          applyWebSearchSovereignty()
          logger.log(`[server] Shell env refreshed in background (${Object.keys(cleanFresh).length} vars)`)
        })
        .catch(() => {})
    } else {
      const probed = loadShellEnv(shell, logger)
      Object.assign(process.env, probed ?? {})
      if (probed) writeShellEnvCache(userDataPath, shell, probed, logShellEnvCache)
    }
  }
  // 2. Fill missing API keys (EXA_API_KEY, *_API_KEY, ...) from the codepuppy.env secrets file, so app
  //    users never have to touch ~/.zshrc. Never overrides anything already set in step 1.
  loadCodePuppySecrets(userDataPath, logger)
  // 3. Desktop defaults(set-if-unset:用户 shell 的显式 export 优先)。`#1667`:H1 下引擎核心不读这两个名字,读它们的是
  // sidecar 构造 `start()` 选项的 engineDesktopToggles(engine-server-options.ts)—— 它们从此是 Code Puppy 自己的开关:
  //   · OPENCODE_EXPERIMENTAL_FILEWATCHER 默认开 → `fs.filewatcher`(B12 拍板,2026-07-05:「外部变更感知」);
  //   · OPENCODE_DISABLE_MODELS_FETCH 默认 "1" → `models.fetch: false`(models.dev 在国内网络超时;随包快照够用,T1.7 / C4)。
  // v1 时代这里另写的 OPENCODE_CLIENT=desktop(→ `app.name`)、OPENCODE_EXPERIMENTAL_ICON_DISCOVERY、OPENCODE_ENABLE_EXA 默认值、
  // 外部生态的两个 flag(→ 注入的移除指令)在 2.x 无读者,已删除(清点表 E2)。
  process.env.OPENCODE_EXPERIMENTAL_FILEWATCHER ??= "true"
  Object.assign(process.env, {
    XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? userDataPath,
    OPENCODE_DISABLE_MODELS_FETCH: process.env.OPENCODE_DISABLE_MODELS_FETCH ?? "1",
  })
  // `#1411` 起本闸只认 kill-switch(纯 env)。
  applyWebSearchSovereignty()
}

// REQ-236 §2.1-1(`#1562`):最近一次 fork 时写进 {file:} 通道的凭据名。续期热应用据它判「凭据在场性
// 变没变」(codepuppy-secret-files.applyPlatformCredentialsHot);还没 fork 过 = undefined。
let forkedSecrets: ReadonlySet<string> | undefined

export function forkedSecretNames(): ReadonlySet<string> | undefined {
  return forkedSecrets
}

export async function spawnLocalServer(
  hostname: string,
  port: number,
  password: string,
  options: SpawnLocalServerOptions,
) {
  // REQ-053 `#982`: refuse fork unless this generation credited a dangling sweep
  // (boot / respawn). Fail closed before secrets sync or utilityProcess.fork.
  consumeDanglingSweepCredit()
  clearOfficialConnectorRuntime()

  // A6: mirror the secret env vars into the {file:} channel on EVERY fork (login/logout/key changes
  // respawn the sidecar through here, so the files always track the current auth/BYOK state), then
  // fork with the allowlisted env — secrets never enter the sidecar's process.env. Loud on failure:
  // without the files, the platform/BYOK providers silently vanish from the picker (anti-B11).
  try {
    // REQ-226 (`#1343`): off-catalog custom-provider keys go keychain store → key file directly (no env
    // hop): the set is "ids in the custom-provider TRUTH file ∩ ids in the store", named custom-provider--<id>.
    // `#1392`: the ids come from `<appData>/codepuppy-state/custom-providers/<env>.json` (custom-provider-records.ts,
    // the same reader the sidecar's buildCodePuppyModelConfig uses), never from codepuppy.jsonc. Without an alpha environment
    // root the truth location is unknown (unit-test forks) ⇒ nothing to materialize — same tolerance as the
    // registryChannel lookup further down.
    const customSecrets =
      tryGetCodePuppyEnvironment() || process.env.CODEPUPPY_GLOBAL_DIR
        ? customProviderSecretValues(readCustomProviderRecords((line) => getLogger()?.warn(line)).map((record) => record.id))
        : {}
    logIgnoredConfigRecordsOnce()
    const sync = syncSecretFiles(options.userDataPath, process.env, customSecrets)
    forkedSecrets = new Set(sync.written)
    getLogger()?.log(`codepuppy-secrets sync: wrote [${sync.written.join(", ")}] removed [${sync.removed.join(", ")}]`)
    // REQ-076 T2(ADR-026 §5,C28 反 placebo):0600/0700 在 NTFS 近乎 no-op —— 密钥文件的
    // owner-only 保证在 Windows 缺位(icacls ACL 待 T3 拍板)。loud,不静默装样子。
    if (!posixModesEffective())
      getLogger()?.warn(
        "codepuppy-secrets: POSIX 0600/0700 权限位在 Windows(NTFS)不生效 —— 密钥文件暂无 owner-only 保证(icacls ACL 待 REQ-076 T3 拍板)",
      )
  } catch (error) {
    // #223 对抗审计(2026-07-25):这里以前只 log 就继续 fork —— 登出时删不掉旧 token 文件的话,
    // 下面的主权闸读到陈旧文件仍判 `platformPays=true`,新 sidecar 带着**已作废的 token** 注册云
    // 工具;反向地,登录时写文件失败会静默回落 keyless。两者都破坏登录态迁移不变量。密钥文件是
    // fork 的前置条件而不是尽力而为的副作用 ⇒ fail closed:拒绝本次 fork,让两个调用点(boot /
    // respawn,index.ts)照既有路径发布 generation failed。
    getLogger()?.error("codepuppy-secrets sync FAILED — refusing to fork the sidecar (fail closed)", error)
    throw new Error(`codepuppy-secrets sync failed — sidecar fork refused: ${serializeError(error).message}`)
  }

  // REQ-237 `#1555`(方案 req236 §2.4):把当刻的已下载目录钉成「已应用目录」—— 引擎模型配置
  // (buildCodePuppyModelConfig,含下面的出网放行派生)与 picker 只读这一份,刷新器在后台怎么改 LKG 都不会让
  // 两边分叉。这里只读写本机文件,不碰网络:目录请求挂死不影响 fork。写失败与密钥文件同一条 fail-closed 路径。
  try {
    pinAppliedCatalog(options.userDataPath, options.generation ?? 0)
  } catch (error) {
    getLogger()?.error("applied model catalog pin FAILED — refusing to fork the sidecar (fail closed)", error)
    throw new Error(`applied model catalog pin failed — sidecar fork refused: ${serializeError(error).message}`)
  }

  // web search 本地腿的主权闸重算,**每次 fork 都跑**。`#1411` 之后唯一判据是 kill-switch(纯 env),
  // 不再依赖 syncSecretFiles 的落盘结果;留在这里是因为它必须晚于 preferAppEnv 的基线还原。
  applyWebSearchSovereignty()

  // B6(=G1):解析 @codepuppy/ext 插件目录,经 StartCommand 传 sidecar(不走 env,免动 A6 白名单)。
  // 缺文件 loud warn(anti-B11:否则表现为「codepuppy_ping 工具静默不在」);CODEPUPPY_EXT_DISABLE=1 静默跳过。
  const ext = resolveExtPluginPath({
    packaged: electronNs.app.isPackaged,
    resourcesPath: process.resourcesPath,
    moduleDir: dirname(fileURLToPath(import.meta.url)),
    disabled: process.env.CODEPUPPY_EXT_DISABLE === "1",
    exists: existsSync,
  })
  if (ext.path) getLogger()?.log("codepuppy-ext: loading plugin bundle", { path: ext.path })
  else if (ext.reason?.includes("CODEPUPPY_EXT_DISABLE")) getLogger()?.log("codepuppy-ext: disabled by CODEPUPPY_EXT_DISABLE")
  else getLogger()?.warn(`codepuppy-ext: NOT loaded — ${ext.reason}`)

  // REQ-065:出厂技能 reconcile 已上移至 boot(index.ts,truth reconcile 之前)—— skills.paths
  // 直指 app 资源、codepuppyGlobalRoot() 不再落出厂链;fork 前无需重复(app 路径仅跨重启变化)。

  // REQ-159:围栏计划在 fork **之前**做(试编译失败 / 模块缺失 / 默认工作区不在 ⇒ 抛 ⇒ 这一代被拒,
  // 与上面 codepuppy-secrets sync 失败同一条 fail-closed 路径)。env 先算好:计划要读的 XDG_* / HOME
  // 必须是 sidecar 将拿到的那一份,不是 main 自己的 process.env。
  // REQ-236 §2.1-4(`#1562`):平台模型请求的凭据只从这份文件现读(ext `chat.headers`),注入的 provider
  // 配置只有占位值。值是 `{file:}` 引用,不是凭据;经 sidecar env 白名单(sidecar-env.ts)进引擎进程。
  process.env.CODEPUPPY_PLATFORM_AUTH_REF = secretFileRef(options.userDataPath, "CODEPUPPY_API_KEY")
  const sidecarEnv = createSidecarEnv()
  // uv's default ~/.cache/uv is outside the fence; keep Office dependencies under the existing W3 root.
  sidecarEnv.UV_CACHE_DIR = join(options.userDataPath, "uv-cache")
  // #1565:引擎在四个文档工具连上之前,用这份随包清单给出它们的声明定义(packages/opencode/src/mcp/codepuppy-first-party-mcp.ts)。
  // 与写策略(ext-mcp-policy)一样按资源根的 realpath 解析,配置里那四条命令才能逐 token 对上。路径不是秘密。
  sidecarEnv.CODEPUPPY_OFFICE_MCP_MANIFEST = join(realpathSync(resourcesRoot()), "office-mcp", "tools.json")
  // REQ-236 `#1575`(方案 §2.4 第 4 条):工具策略按登录账户分区。引擎读它选分区,缺席 = anonymous(未登录)。
  // 值是「本安装随机标识 + 账户标记」的哈希,不是凭据:这个变量会被第三方 MCP / LSP / shell 子进程继承,混入安装标识后
  // 同一账户在另一台安装上是另一个值,不能据它跨安装关联。只由这里按当刻登录态写 —— 不进白名单,shell 导出的同名变量
  // 选不了分区;账户或安装标识取不到都不写。登录、登出、换号都会重新 fork(codepuppy-auth 的 identity-change),fork 时写一次即可。
  const policyAccount = getAuthIdentityTag()
  const installation = installationMachineId()
  if (policyAccount && installation)
    sidecarEnv.CODEPUPPY_POLICY_ACCOUNT = `acct:${createHash("sha256").update(`${installation}:${policyAccount}`).digest("hex")}`
  // #1578 AC5:随包扩展插件的清单(ext 构建写在 plugin.js 旁边:模块 sha256 + 自有工具名)。引擎只信这条 env 指的那份,
  // 不看被装载插件旁边有什么(packages/opencode/src/plugin/codepuppy-bundled-plugin.ts)。路径不是秘密。
  if (ext.path) sidecarEnv.CODEPUPPY_EXT_BUNDLED_MANIFEST = join(ext.path, "bundled-tools.json")
  // REQ-137 `#1379`:这一代的 BYOK 放行集合。平台无关(代理只在 darwin 起,但「放行集合 = 这一代的配置」
  // 这条不该长两个样子),排在密钥文件落定之后、fork 之前。
  refreshConfiguredEgressDestinations(options.userDataPath)
  // REQ-137:策略代理先于计划 —— 端口要渲染进 profile(N4)并改写进 sidecar env。起不来 = 拒 fork(fail-closed)。
  // 只在 darwin:围栏只在那里;别的平台既没有强制层也不装策略层(sidecar env 的代理变量照旧 = 用户导出的值)。
  let egressProxyPort: number | undefined
  if (process.platform === "darwin") {
    try {
      egressProxyPort = (await (options.egressProxy ?? ensureEgressPolicyProxy)()).port
    } catch (error) {
      getLogger()?.error("network egress policy proxy FAILED to start — refusing to fork the sidecar (fail closed; a fenced engine with no door out must not start)", error)
      throw new Error(`network egress policy proxy failed to start — sidecar fork refused: ${serializeError(error).message}`)
    }
    Object.assign(sidecarEnv, sidecarEgressProxyEnv(egressProxyPort))
  }
  let fence: ProcessFenceStartInput | undefined
  try {
    fence = (options.planFence ?? planProductionFence)({ userDataPath: options.userDataPath, sidecarEnv, egressProxyPort })
  } catch (error) {
    getLogger()?.error("process fence plan FAILED — refusing to fork the sidecar (fail closed; an unfenced engine must not start)", error)
    throw new Error(`process fence plan failed — sidecar fork refused: ${serializeError(error).message}`)
  }
  if (!fence && process.platform === "darwin")
    throw new Error("process fence plan returned nothing on darwin — sidecar fork refused (an unfenced engine must not start)")

  const sidecar = join(dirname(fileURLToPath(import.meta.url)), "sidecar.js")
  rotateServerLogs()
  const runtimeGeneration = tryGetCodePuppyEnvironment() ? restoreCommittedOfficialConnectors() : []
  const child = (() => {
    try {
      return (options.fork ?? electronNs.utilityProcess.fork)(sidecar, [], {
        cwd: ensureEngineScratchCwd(options.userDataPath),
        env: sidecarEnv,
        serviceName: SIDECAR_SERVICE_NAME,
        stdio: "pipe",
      })
    } catch (error) {
      clearOfficialConnectorRuntime(runtimeGeneration)
      throw error
    }
  })()
  let exited = false
  // #613:ready IPC 带回的注入失败。在此立即 error(main 侧无条件可观测,不依赖后续健康结果),
  // 并随返回值交给终态生产者(armBoot/armRespawnGenerationTerminal)发布 "injection-failed"。
  let injectionFailure: { message: string; stack?: string } | undefined
  const exit = defer<number>()

  const onProcessGone = (_event: unknown, details: Details) => {
    if (details.type !== "Utility" || details.name !== SIDECAR_SERVICE_NAME) return
    options.onStderr?.(`utility process gone reason=${details.reason} exitCode=${details.exitCode}`)
  }

  electronNs.app.on("child-process-gone", onProcessGone)
  // REQ-159 `#1322`:探针请求簿。sidecar 收到 write-probe 命令即同步回一条 write-probe-result;这里按 id 对号。
  // 子进程退出 ⇒ 在途请求全部答 unknown(不是「拒绝」,也不是「可写」)。
  const writeProbes = createWriteProbeRequester((command) => child.postMessage(command))
  // REQ-234 `#1529`:`codepuppy.*` 分发与探针应答并列;不是本族的消息原样交还(返回 false)。
  const postCodePuppy = (message: CodePuppySidecarOutbound) => child.postMessage(message)
  child.on("message", (message: unknown) => {
    if (writeProbes.receive(message)) return
    options.codepuppySidecar?.receive(message, postCodePuppy)
  })
  let detachCodePuppy: ((reason: string) => void) | undefined
  child.once("exit", (code) => {
    clearOfficialConnectorRuntimeOnExit(runtimeGeneration)
    exited = true
    electronNs.app.off("child-process-gone", onProcessGone)
    writeProbes.close(`sidecar exited with code ${code}`)
    detachCodePuppy?.(`sidecar exited with code ${code}`)
    options.onExit?.(code)
    exit.resolve(code)
  })
  child.on("error", (error) => options.onStderr?.(`utility process error: ${serializeError(error).message}`))

  child.stdout?.on("data", (chunk: Buffer) => options.onStdout?.(chunk.toString("utf8").trimEnd()))
  child.stderr?.on("data", (chunk: Buffer) => options.onStderr?.(chunk.toString("utf8").trimEnd()))

  await new Promise<void>((resolve, reject) => {
    let done = false
    let timeout: NodeJS.Timeout

    const fail = (error: Error) => {
      if (done) return
      done = true
      cleanup()
      reject(error)
    }

    const refreshTimeout = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        fail(new Error(`Sidecar did not become ready within ${SIDECAR_START_STALL_TIMEOUT}ms: ${sidecar}`))
      }, SIDECAR_START_STALL_TIMEOUT)
    }

    const onMessage = (message: SidecarMessage) => {
      if (message.type === "ready") {
        if (done) return
        injectionFailure = message.injectionFailure
        if (injectionFailure)
          getLogger()?.error(
            `alpha config injection failed in sidecar — engine starts WITHOUT alpha config (models will be unavailable): ${injectionFailure.message}`,
          )
        markStartupTimeline("main.sidecar.ready_ipc", {
          context: options.timelineContext ?? "other",
          // #881:键名刻意避开 sanitizeExtra 的黑名单子串(env/token/secret/header…),命中即
          // **静默剔除**,打包跑完只会发现字段不在。判据在 startup-timeline.test.ts。
          ...(message.prewarmOutcome === undefined ? {} : { prewarmOutcome: message.prewarmOutcome }),
          ...(message.prewarmMs === undefined ? {} : { prewarmMs: message.prewarmMs }),
          ...(message.prewarmStatus === undefined ? {} : { prewarmStatus: message.prewarmStatus }),
        })
        done = true
        cleanup()
        resolve()
        return
      }
      if (message.type === "error") {
        fail(Object.assign(new Error(message.error.message), { stack: message.error.stack }))
      }
    }
    const onExit = (code: number) => {
      fail(new Error(`Sidecar exited before ready with code ${code}`))
    }
    const cleanup = () => {
      clearTimeout(timeout)
      child.off("message", onMessage)
      child.off("exit", onExit)
    }

    child.on("message", onMessage)
    child.on("exit", onExit)
    refreshTimeout()
    // #397:override 注入的 catalog 通道在 MAIN 侧从冻结快照取好随命令传入 —— sidecar 进程从不
    // initCodePuppyEnvironment,自取必抛且曾整体炸掉 alpha 配置注入(2026-07-23)。boot 序保证 spawn 前
    // 已 init;tryGet 仅为纯单测兜底(缺省 → sidecar loud 跳过 override 注入,boot reconcile 兜 fail-closed)。
    const registryChannel = tryGetCodePuppyEnvironment()?.registryChannel
    if (!registryChannel)
      getLogger()?.warn(
        "alpha environment not initialized at sidecar spawn — disabled-override injection will be skipped",
      )
    child.postMessage({
      type: "start",
      hostname,
      port,
      password,
      userDataPath: options.userDataPath,
      initialDirectory: codepuppyUserWorkspaceDir(),
      // `#1667`:会话库与全局配置目录由 main 算(与 db-safety / mcp-default-deny 同一推导),显式进 `start()` 的选项。
      databasePath: engineDatabasePath({ packaged: electronNs.app.isPackaged, env: sidecarEnv, home: homedir(), channel: CHANNEL }),
      configDirectory: engineGlobalConfigDirectory(sidecarEnv, homedir()),
      extPluginPath: ext.path,
      registryChannel,
      // REQ-159:profile 全文 + 模块路径。sidecar 在 import 引擎之前 apply;缺席(darwin)即拒绝启动。
      ...(fence ? { fence: { profile: fence.profile, addonPath: fence.addonPath } } : {}),
    })
  }).catch((error) => {
    if (!exited) child.kill()
    throw error
  })
  // REQ-234 `#1529`:ready 之后接上重载请求的发送口(重发 main 记录里仍在途的 generation)。
  if (!exited) detachCodePuppy = options.codepuppySidecar?.attach(postCodePuppy)

  const wait = (async () => {
    const url = `http://${hostname}:${port}`
    let healthy = false
    const gone = exit.promise.then((code) => {
      if (healthy) return
      throw new Error(`Sidecar exited before health check passed with code ${code}`)
    })

    const ready = async () => {
      // D1: probe immediately, then back off ~100ms only after a failed check (was sleep-first,
      // costing every startup an upfront ~100ms). Mirrors wsl/startup.ts `pollWslHealth` ordering.
      await pollUntilHealthy(() => (options.healthCheck ?? checkHealth)(url, password), 100)
      healthy = true
    }

    await Promise.race([ready(), gone])
  })()

  let stopping: Promise<void> | undefined

  return {
    listener: {
      kill: () => {
        if (!exited) child.kill()
      },
      probeWrite: (directory: string) => writeProbes.request(directory),
      stop: () => {
        if (stopping) return stopping
        if (exited) return Promise.resolve()
        child.postMessage(SIDECAR_STOP_COMMAND)
        stopping = Promise.race([
          exit.promise.then(() => undefined),
          delay(SIDECAR_STOP_TIMEOUT).then(() => {
            if (!exited) child.kill()
          }),
        ])
        return stopping
      },
    },
    health: { wait },
    injectionFailure,
    // REQ-159 `#1322`:「围栏装上了」的信号,由**两个事实**共同给出 —— 本进程把计划放进了 start 命令
    // (darwin 上没有计划就不会走到这里),且 sidecar 发了 ready;而 sidecar.ts 的 start() 第一句就是
    // installProcessFence(apply 失败 ⇒ error IPC + exit(1),永远发不出 ready;接线锚在
    // process-fence-wiring.test.ts)。非 darwin 没有计划 ⇒ 不带这个字段 ⇒ 披露面不出现(没有围栏就不说有)。
    ...(fence ? { fence: "applied" as const } : {}),
  }
}

/**
 * 健康 / 就绪探测(清点表 H7,`#1667`):OpenCode 2 的 `GET /api/info` —— 启动中 503 + `retry-after`、就绪 200、启动失败 500
 * (`packages/server/src/process.ts` 的 `infoResponse`)。v1 的 `/global/health` 在 2.x 不存在。
 */
export async function checkHealth(url: string, password?: string | null): Promise<boolean> {
  let healthUrl: URL
  try {
    healthUrl = new URL("/api/info", url)
  } catch {
    return false
  }

  const headers = new Headers()
  if (password) {
    const auth = Buffer.from(`opencode:${password}`).toString("base64")
    headers.set("authorization", `Basic ${auth}`)
  }

  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

// createSidecarEnv moved to sidecar-env.ts (A6: allowlist, unit-testable without electron). The
// OPENCODE_* prefix passes through wholesale, which keeps the channel-suffixed DB behavior intact
// (`opencode-${InstallationChannel}.db` shared across dev + packaged — see the "lost on restart"
// note in that file's history / opencode-channel-db-persistence).

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function serializeError(error: unknown) {
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  return { message: String(error) }
}

function defer<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
