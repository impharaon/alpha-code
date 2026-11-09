import * as fs from "node:fs"
import { registerHooks } from "node:module"
import * as http from "node:http"
import * as tls from "node:tls"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
// #607:注入组合体住在自己的模块里 —— 本文件的第一个 import(registerHooks)与顶层
// getParentPort() 让 sidecar.ts 无法被测试 import,注入因此长期零覆盖。见 codepuppy-config-injection.ts。
import { injectCodePuppyConfig, type CodePuppyConfigInjectionResult } from "./codepuppy-config-injection"
// #613 R1:ready 消息构造抽成 bun 可真执行的单元 —— 文本锚锁不住「值真的上车」,运行时闸门
// 在 sidecar-ready-message.test.ts;本文件不得字面量构造 ready 消息(接线锚断言其不存在)。
import { buildReadyMessage, type SidecarReadyMessage } from "./sidecar-ready-message"
// #858:停止命令的形状与执行住在 sidecar-stop.ts —— 本文件顶层的
// registerHooks / getParentPort() 让它无法被测试 import(与 #607 同因),真判据必须在可 import
// 的模块里跑(见 sidecar-stop.test.ts)。
import { parseSidecarStopCommand, stopSidecarEngine, type SidecarStopCommand, type StoppableEngine } from "./sidecar-stop"
import type { ChannelName } from "./catalog-channels"
import { prewarmInitialLocation } from "./sidecar-location-prewarm"
import { publishInProcessEngine, type EngineFetch } from "./in-process-engine"
// `#1667`(#1662 L5):OpenCode 2 嵌入 —— 选项对象、口令包装、ext 就绪判定各住在可 import 的模块里(本文件顶层副作用让它
// 无法被测试 import),真判据见 engine-server-options.test.ts、sidecar-engine-host.test.ts、sidecar-ext-ready.test.ts。
import { buildEngineServerOptions, engineDesktopToggles } from "./engine-server-options"
import { withEngineAuthorization } from "./engine-authorization"
import { assertExtPluginActive } from "./sidecar-ext-ready"
// REQ-159 `#1321`:进程围栏。本进程在 import 引擎之前把自己关进 seatbelt,之后派生的一切继承。
// profile 由 main 渲染 + 试编译(process-fence-plan.ts),这里原样 apply;装不上 = 本进程不起
// (fail-closed,原因经 error IPC 报给 main)。判据在 process-fence-apply.test.ts(真 .node / 真 seatbelt /
// Electron 的 node);本文件顶层的 registerHooks / getParentPort() 让它无法被 import,接线只能锚源码。
import { applyProcessFence, type ProcessFenceStartInput } from "./process-fence-apply"
// REQ-159 `#1322`:工作区写探针 —— renderer 问「这个目录现在写得进去吗」,答案只能由**本进程**(被围栏的那一个)
// 真写一次给出;main 没有被围栏,在那里探恒答可写。合同与执行都在 workspace-write-probe.ts。
import {
  buildWriteProbeReply,
  parseWriteProbeCommand,
  runWorkspaceWriteProbe,
  type WorkspaceWriteProbeCommand,
  type WorkspaceWriteProbeReply,
} from "./workspace-write-probe"

// ADR-006 bridge ("two runtime worlds"). opencode's ToolRegistry dynamically imports a project's
// raw-TS tools (.opencode/tool/*.ts), and packages whose TS entry does `import "./x.js"` (e.g.
// @opencode-ai/plugin → src/index.ts → import "./tool.js") expect that to resolve to the sibling .ts.
// bun rewrites `.js`→`.ts`; the packaged Electron-Node sidecar does NOT, so those imports throw
// ERR_MODULE_NOT_FOUND → prompt_async crashes → the model never replies (looks like "no response").
// This in-thread resolve hook restores bun's behavior: when a `.js` specifier fails to resolve but the
// sibling `.ts` exists on disk, use the `.ts`. Code Puppy-only, zero opencode edits; registered at module
// load (before the server import) so it covers every runtime tool load.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.endsWith(".js")) throw error
      let resolved: ReturnType<typeof nextResolve>
      try {
        resolved = nextResolve(`${specifier.slice(0, -3)}.ts`, context)
      } catch {
        throw error // sibling .ts also unresolvable → surface the original .js error
      }
      if (!resolved.url.startsWith("file:") || !fs.existsSync(new URL(resolved.url))) throw error
      return { ...resolved, shortCircuit: true }
    }
  },
})

type NodeHttpWithEnvProxy = typeof http & {
  setGlobalProxyFromEnv: () => void
}

type NodeTlsWithSystemCertificates = typeof tls & {
  getCACertificates: (type: "default" | "system") => string[]
  setDefaultCACertificates: (certificates: string[]) => void
}

type StartCommand = {
  type: "start"
  hostname: string
  port: number
  password: string
  userDataPath: string
  /**
   * B6(=G1):@codepuppy/ext 的插件**目录**绝对路径(main 解析,见 codepuppy-ext-plugin.ts;2.x 只装目录形式的本地插件,
   * 入口 `server.js`)。缺席 = 不装 ext ⇒ sidecar 拒绝报 ready(I4,sidecar-ext-ready.ts)。
   */
  extPluginPath?: string
  /** `#1667`:引擎会话库的绝对路径(main 用 engine-paths.ts 的 engineDatabasePath 算,与 db-safety 同一推导)。 */
  databasePath: string
  /** `#1667`:引擎全局配置目录(main 用 engine-paths.ts 的 engineGlobalConfigDirectory 算)。 */
  configDirectory: string
  /** #397 override 注入用的 catalog 通道。必须由 main 从冻结环境快照取好传入 —— 本进程从不跑
   *  initCodePuppyEnvironment,在这里调 catalogRegistryChannel() 会抛,且曾把整个 injectCodePuppyConfig
   *  连同 provider 注入一起炸掉(2026-07-23 打包端「全模型当前不可用」事故)。缺省 = loud 跳过
   *  override 注入(fail-closed 权威在 boot reconcile,见 ext-disabled-injection.ts)。 */
  registryChannel?: ChannelName
  /** #857:the renderer home model contract's exact initial location (`~/Alpha`). */
  initialDirectory: string
  /**
   * REQ-159 `#1321`:进程围栏 —— main 已试编译通过的 profile 全文 + 原生模块绝对路径。
   * darwin 上**必须**在场:缺席即拒绝启动(没有围栏的引擎不许起)。非 darwin 没有 seatbelt,不带。
   */
  fence?: ProcessFenceStartInput
}

type StopCommand = SidecarStopCommand
type SidecarCommand = StartCommand | StopCommand | WorkspaceWriteProbeCommand

// #613:注入失败随 ready 上报(server.ts 持有同构镜像)——引擎照常起,但 main 必须知情。
// ready 变体的形状与构造住在 sidecar-ready-message.ts(那里有真运行时闸门)。
type SidecarMessage =
  | SidecarReadyMessage
  | { type: "stopped" }
  | { type: "error"; error: { message: string; stack?: string } }
  | WorkspaceWriteProbeReply

type ParentPort = {
  postMessage(message: SidecarMessage): void
  on(event: "message", listener: (event: { data: unknown }) => void): void
}

const parentPort = getParentPort()
let engine: StoppableEngine | undefined

parentPort.on("message", (event) => {
  const command = parseCommand(event.data)
  if (!command) return
  if (command.type === "stop") {
    void stop()
    return
  }
  if (command.type === "write-probe") {
    // 同步、不等引擎:探针只依赖本进程的围栏,而围栏在 start() 第一句就装好了。
    parentPort.postMessage(buildWriteProbeReply(command.id, runWorkspaceWriteProbe(command.directory)))
    return
  }
  void start(command)
})

async function start(command: StartCommand) {
  try {
    // REQ-159:第一步就是把本进程关进围栏 —— 在写任何文件、import 引擎之前。装不上直接抛,
    // 走下面的 catch:error IPC + exit(1),main 据此宣告这一代失败(响亮,不静默降级成无围栏服务)。
    installProcessFence(command)
    // #613:注入结果必须捕获并随 ready 上报 —— 注入失败 = 引擎起来了但整份 alpha 配置丢失
    // (模型全灰),不上报则 main/renderer 无从与「引擎未就绪」区分。`#1667`:注入不再经环境变量交给引擎
    // (H1 下引擎核心不读 `OPENCODE_CONFIG_CONTENT` 一类变量),结果里带着要放进 `start()` 选项的配置。
    const injection = prepareSidecarEnv(command.userDataPath, command.extPluginPath, command.registryChannel)
    ensureLoopbackNoProxy()
    useSystemCertificates()
    // 裁决书 R15 ④ / L1a armC 对 armCraw:必须在 import 引擎之前,否则 2.x 的模型请求绕开 HTTPS_PROXY 直连,在围栏下 DNS 失败。
    useEnvProxy()
    const { startEngine, ENGINE_VERSION } = await import("virtual:opencode-server")
    // REQ-234 `#1531`:@codepuppy/ext 在**模块装载时**挂 parentPort 监听(定制中心桥 + 重载调度器),而 main 只在 ready
    // 那一刻重发排队的重载代际。引擎要等某个 Location 装插件时才 import 它 —— 常常晚于 ready,那一批就丢了。所以在
    // `start()` 之前先预载 ext 的入口(I2;2.x 每个 Location 用带 `__opencode_reload` 的新 URL 各求值一次,进程级对象
    // 由 ext 挂在 globalThis 上复用,不靠同一个 URL)。失败只记一行:是否装上由下面的 I4 判定说了算。
    const extPreload = command.extPluginPath
      ? import(pathToFileURL(join(command.extPluginPath, "server.js")).href).then(
          () => undefined,
          (error: unknown) => console.warn("@codepuppy/ext preload before ready failed — reload requests re-sent at ready may be lost", error),
        )
      : Promise.resolve()

    // 裁决书 R13 / N1:`start()` + `Transform`,不传 lifecycle。REQ-234 `#1531`(I1):`Transform` 那一刻同步发布进程内 fetch
    // —— 监听端口那张应用图的 dispatch app,外面包一层补口令。围栏拒掉连自己回环端口的连接,ext 只能走这一条。
    let inProcess: EngineFetch | undefined
    const toggles = engineDesktopToggles(process.env)
    const started = await startEngine(
      buildEngineServerOptions({
        hostname: command.hostname,
        port: command.port,
        password: command.password,
        engineVersion: ENGINE_VERSION,
        databasePath: command.databasePath,
        configDirectory: command.configDirectory,
        config: injection.config,
        models: { file: injection.models.file, fetch: toggles.modelsFetch },
        filewatcher: toggles.filewatcher,
        platform: process.platform,
      }),
      {
        onDispatch: (dispatch) => {
          inProcess = withEngineAuthorization(dispatch, command.password)
          publishInProcessEngine(inProcess)
        },
      },
    )
    engine = started
    const fetch = inProcess!

    // #857:在 renderer 第一次要模型之前,经进程内 fetch 把初始 Location 与模型目录拉起来;不论结局都随 ready 上报(#881)。
    const prewarmResult = await prewarmInitialLocation({ request: fetch }, command.initialDirectory, {
      password: command.password,
    })
    await extPreload
    if (prewarmResult.outcome === "ready") console.log("initial governed catalog location prewarmed")
    else console.warn("initial governed catalog location prewarm did not become ready", prewarmResult)
    // I4(裁决书 R22):ext 在初始目录上没装上 = 那里没有 Code Puppy 的执行闸 ⇒ 不报 ready,走下面同一条 fail-closed 路。
    await assertExtPluginActive(fetch, command.initialDirectory, command.extPluginPath)
    parentPort.postMessage(buildReadyMessage(injection, prewarmResult))
  } catch (error) {
    parentPort.postMessage({ type: "error", error: serializeError(error) })
    setImmediate(() => process.exit(1))
  }
}

async function stop() {
  try {
    await stopSidecarEngine(engine)
  } finally {
    engine = undefined
    parentPort.postMessage({ type: "stopped" })
    setImmediate(() => process.exit(0))
  }
}

/**
 * REQ-159 `#1321`:darwin 上没有 fence 计划 = 拒绝启动;有则原样 apply(process-fence-apply.ts 会双向
 * 自证:集合外写不进、cwd 写得进)。非 darwin 没有 seatbelt,如实不装(基线:「如实声明」,不是等价围栏)。
 */
function installProcessFence(command: StartCommand) {
  if (process.platform !== "darwin") {
    console.warn(`process fence: not available on ${process.platform} — engine-derived processes run unfenced on this platform`)
    return
  }
  if (!command.fence)
    throw new Error("process fence missing from the start command on darwin — refusing to start the engine unfenced (REQ-159)")
  const applied = applyProcessFence(command.fence)
  console.log(
    `process fence applied: addon=${applied.buildId} libsandbox=${applied.libsandbox} profile=${applied.profileBytes}B — every process this engine spawns inherits it`,
  )
}

function prepareSidecarEnv(
  userDataPath: string,
  extPluginPath?: string,
  registryChannel?: ChannelName,
): CodePuppyConfigInjectionResult {
  // `XDG_*` 必须在 import 引擎之前定好:上游在模块装载时就按它们算全局根目录(`@opencode/util/global-roots`,裁决书 N4)。
  // 口令不再进本进程环境(I1):ext 走进程内 fetch,包装层补口令;环境里的值会被引擎派生的每个 shell / MCP 子进程继承。
  process.env.XDG_STATE_HOME = process.env.XDG_STATE_HOME ?? userDataPath
  return injectCodePuppyConfig(userDataPath, extPluginPath, registryChannel)
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

function useSystemCertificates() {
  try {
    const nodeTls = tls as NodeTlsWithSystemCertificates
    nodeTls.setDefaultCACertificates([
      ...new Set([...nodeTls.getCACertificates("default"), ...nodeTls.getCACertificates("system")]),
    ])
  } catch (error) {
    console.warn("failed to load system certificates", error)
  }
}

function useEnvProxy() {
  try {
    ;(http as NodeHttpWithEnvProxy).setGlobalProxyFromEnv()
  } catch (error) {
    console.warn("failed to load proxy environment", error)
  }
}

function parseCommand(value: unknown): SidecarCommand | undefined {
  if (!value || typeof value !== "object") return
  const command = value as Partial<StartCommand | StopCommand | WorkspaceWriteProbeCommand>
  if (command.type === "stop") return parseSidecarStopCommand(value)
  if (command.type === "write-probe") return parseWriteProbeCommand(value)
  if (command.type !== "start") return
  if (typeof command.hostname !== "string") return
  if (typeof command.port !== "number") return
  if (typeof command.password !== "string") return
  if (typeof command.userDataPath !== "string") return
  if (typeof command.initialDirectory !== "string") return
  if (typeof command.databasePath !== "string") return
  if (typeof command.configDirectory !== "string") return
  const fence = parseFence(command.fence)
  return {
    type: "start",
    hostname: command.hostname,
    port: command.port,
    password: command.password,
    userDataPath: command.userDataPath,
    initialDirectory: command.initialDirectory,
    databasePath: command.databasePath,
    configDirectory: command.configDirectory,
    ...(fence ? { fence } : {}),
    ...(typeof command.extPluginPath === "string" ? { extPluginPath: command.extPluginPath } : {}),
    ...(command.registryChannel === "stable" ||
    command.registryChannel === "preview" ||
    command.registryChannel === "dev"
      ? { registryChannel: command.registryChannel }
      : {}),
  }
}

/** 形状不对就当没有(darwin 上随后被 installProcessFence 拒掉,而不是带着半个计划去 apply)。 */
function parseFence(value: unknown): ProcessFenceStartInput | undefined {
  if (!value || typeof value !== "object") return
  const fence = value as Partial<ProcessFenceStartInput>
  if (typeof fence.profile !== "string" || typeof fence.addonPath !== "string") return
  return { profile: fence.profile, addonPath: fence.addonPath }
}

function serializeError(error: unknown) {
  if (error instanceof Error) return { message: error.message, stack: error.stack }
  return { message: String(error) }
}

function getParentPort() {
  const port = process.parentPort as ParentPort | undefined
  if (!port) throw new Error("Sidecar parent port unavailable")
  return port
}
