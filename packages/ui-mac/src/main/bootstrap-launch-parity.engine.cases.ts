// `#1698`(DESIGN-upgrade-bootstrap-config,计划段 0):一次代表性启动里,main 交给 sidecar / ext / 引擎的决定,经**真启动装配**被它们
// 观察到的样子。决定记录钉在同目录的 `bootstrap-launch-parity.record.json`(由改动前的代码实跑一次产出);启动配置迁移的每一段只许改
// 下面「sidecar 这一步」的接法,记录文件一字不改 —— 评审看那份文件在各段之间的 diff 为零,就是「用户看到的行为不变」的证据。
//
// 供数方全是生产的:main 的 `preferAppEnv` + `spawnLocalServer`(假 fork 记下交给 sidecar 的 env 与 start 消息;围栏计划与出网代理端口
// 由测试给定,同 server.test.ts)→「sidecar 这一步」(sidecar.ts 顶层取 parentPort,结构上不能 import;这里照它 `start()` 的顺序做:
// 没有冻结快照、只有 fork 给它的那份 env 与 start 消息)→ 生产 `injectCodePuppyConfig` → 生产 `buildEngineServerOptions` + 嵌入式引擎
// (`engine/engine-embed.ts`,与 dist-engine 同一个入口)+ 真 ext(以本地目录插件装,入口 `server.js` 指向 `packages/ext/src/plugin.ts`)。
// 代表性启动:已登录(dev 平台令牌、合成凭据)、平台模型地址与云 MCP 地址指本机桩、有账户分区、darwin 出网代理端口、围栏计划、
// 已初始化的环境快照(prod ⇒ 通道 stable)、出厂技能目录。P-06 那五个开关不进记录(design §10 R6 让它们有意改变)。
//
// 记录(临时根 → `<root>`,桩的端口 → `<model>` / `<cloud>`,超过 300 字的字符串 → 其 sha256):
//   ① sidecar 收到的路径、通道、ext 目录与围栏(G1 起路径与通道在启动文档里);② 交给 `start()` 的库路径、配置目录、models.fetch、fs.filewatcher;
//   ③ 注入的内联文档(档位 agent 的权限、供应商、云 MCP 定义、插件)、显式文件、模型底表与密钥文件名(C3–C6 的磁盘形状);
//   ④ 引擎里:ext 装上没有、供应商清单、云 MCP 的状态、ext 工具策略的账户分区、一次经出网代理的连接失败怎么归类;
//   ⑤ 两个桩收到的凭据头(平台模型请求经 ext 的请求钩子现读凭据文件;云 MCP 经 core 的治理凭据读取)。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录。
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test"
import { createHash } from "node:crypto"
import { EventEmitter } from "node:events"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { mockElectron } from "../../test-component/electron-mock"

const sandbox = engineSandbox()
const REPO = path.resolve(import.meta.dir, "../../../..")
const RECORD_FILE = path.join(import.meta.dir, "bootstrap-launch-parity.record.json")
const userDataPath = path.join(sandbox.root, "parity-userdata")
const extDir = path.join(sandbox.root, "parity-ext")
const factorySkills = path.join(sandbox.root, "parity-factory-skills")

// ── main 的 fork 路径(同 server.test.ts / websearch-account-tool-table.engine.cases.ts 的 mock)────────────────────
class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  postMessage(message: { type: string }) {
    wire.push(message)
    if (message.type === "start") queueMicrotask(() => this.emit("message", { type: "ready" }))
    if (message.type === "stop") queueMicrotask(() => this.emit("exit", 0))
  }
  kill() {
    queueMicrotask(() => this.emit("exit", 0))
  }
}
const wire: Array<Record<string, unknown>> = []
const forkCalls: Array<{ options: Record<string, unknown> }> = []
mockElectron(() => ({
  app: { isPackaged: false, on: () => {}, off: () => {}, getPath: () => userDataPath, getVersion: () => "0.0.0-test" },
  utilityProcess: { fork: () => { throw new Error("unexpected utilityProcess.fork") } },
  BrowserWindow: class {},
  dialog: {},
  ipcMain: { handle: () => {}, on: () => {} },
}))
mock.module("./logging", () => ({ getLogger: () => ({ log: () => {}, warn: () => {}, error: () => {} }), write: () => {}, rotateServerLogs: () => {} }))
mock.module("./store", () => ({ getStore: () => ({ get: () => null, set: () => {}, delete: () => {} }) }))
mock.module("./codepuppy-keychain-backend", () => ({
  keychainBackend: () => ({ isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value, "utf8"), decryptString: (value: Buffer) => value.toString("utf8") }),
}))
// dev 下 main 从未入库的 packages/ext/dist 解析 ext 目录(门不保证它在);这里换成沙箱里指向 ext 源码的目录插件。
mock.module("./codepuppy-ext-plugin", () => ({ EXT_PLUGIN_ENTRY: "server.js", resolveExtPluginPath: () => ({ path: extDir }) }))
const { preferAppEnv, spawnLocalServer } = await import("./server")
const { creditDanglingSweepForSpawn, resetDanglingSweepLatchForTests } = await import("./dangling-sweep-latch")
const { initCodePuppyEnvironment, resolveCodePuppyGlobalRoot, __resetCodePuppyEnvironmentForTests } = await import("./codepuppy-environment")
const { acceptCodePuppyBootstrap } = await import("./sidecar-bootstrap-gate")
const { __resetCodePuppyBootstrapForTests } = await import("@opencode/util/codepuppy-bootstrap")
const { initializeArtifactQuotaEnvironment, ARTIFACT_QUOTA_MACHINE_ID_FILE } = await import("./artifact-service")
const { injectCodePuppyConfig } = await import("./codepuppy-config-injection")
const { buildEngineServerOptions, engineDesktopToggles } = await import("./engine-server-options")
const { withEngineAuthorization } = await import("./engine-authorization")
const { secretFilePath } = await import("./codepuppy-secret-files")
const { engineNetFailurePath } = await import("@opencode/schema/codepuppy-net-failure")
const { CLOUD_MCP_TOOLS } = await import("./fixtures/cloud-mcp-tools")
const fakeFork = ((_file: string, _args: string[], options: Record<string, unknown>) => (forkCalls.push({ options }), new FakeChild())) as never
const fakePlanFence = () => ({ profile: "(version 1)\n(allow default)\n(deny file-write*)\n", addonPath: "/nonexistent/codepuppy_fence.node" })

// ── 两个桩:平台模型(OpenAI 兼容流)与云 MCP(streamable HTTP);都记下收到的凭据头 ────────────────────────────────
const modelAuthorization: string[] = []
const model = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (!request.url.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
    modelAuthorization.push(request.headers.get("authorization") ?? "")
    await request.text()
    const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
      `data: ${JSON.stringify({ id: "chatcmpl-parity", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    return new Response(chunk({ role: "assistant", content: "ok" }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  },
})
const cloudAuthorization: string[] = []
const cloud = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    cloudAuthorization.push(request.headers.get("authorization") ?? "")
    if (request.method === "GET") return new Response(null, { status: 405 })
    if (request.method !== "POST") return new Response(null, { status: 200 })
    const message = (await request.json()) as { id?: number; method?: string; params?: { protocolVersion?: string } }
    if (message.id === undefined) return new Response(null, { status: 202 })
    const result =
      message.method === "initialize"
        ? { protocolVersion: message.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-cloud", version: "1" } }
        : message.method === "tools/list"
          ? { tools: CLOUD_MCP_TOOLS.map((name) => ({ name, description: name, inputSchema: { type: "object", properties: {} } })) }
          : {}
    return Response.json({ jsonrpc: "2.0", id: message.id, result })
  },
})

const engines: Array<{ close: () => Promise<void> }> = []
beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})
afterAll(async () => {
  for (const engine of engines.reverse()) await engine.close().catch(() => undefined)
  model.stop(true)
  cloud.stop(true)
})

/** dev 平台令牌(codepuppy-auth 未打包时的短路;形状同 codepuppy-sidecar-wiring.test.ts 的 #1575 一条)。 */
const devPlatformToken = (sub: string) =>
  `${Buffer.from("{}").toString("base64url")}.${Buffer.from(
    JSON.stringify({ schema_version: 1, iss: "codepuppy-web", aud: "codepuppy-platform-api", sub, token_use: "platform_access", purpose: "account.read", scope: ["account.read"], iat: 1, exp: 2, jti: `jti-${sub}` }),
  ).toString("base64url")}.signature`

/** main 这一侧:boot 已做的(环境快照、安装标识、登录信封落下的值、出厂技能目录、preferAppEnv),然后真 fork 一次。 */
async function launch() {
  fs.mkdirSync(userDataPath, { recursive: true })
  fs.mkdirSync(path.join(factorySkills, "parity-skill"), { recursive: true })
  fs.writeFileSync(path.join(factorySkills, "parity-skill", "SKILL.md"), "---\nname: parity-skill\ndescription: parity\n---\nparity\n")
  fs.mkdirSync(extDir, { recursive: true })
  fs.writeFileSync(path.join(extDir, "server.js"), `export { default } from ${JSON.stringify(path.join(REPO, "packages/ext/src/plugin.ts"))}\n`)
  // 安装标识固定,账户分区的哈希才可复现(真实安装里它是一次生成的随机值)
  fs.writeFileSync(path.join(userDataPath, ARTIFACT_QUOTA_MACHINE_ID_FILE), "6f1c2a8e-3b4d-4c5e-8f60-71829a0b1c2d\n", { mode: 0o600 })
  expect((await initializeArtifactQuotaEnvironment(userDataPath)).ok).toBe(true)
  for (const key of Object.keys(process.env)) if (key.startsWith("CODEPUPPY_")) delete process.env[key]
  initCodePuppyEnvironment({ isPackaged: false, channel: "prod", appDataDir: path.join(sandbox.root, "parity-appdata"), homeDir: sandbox.home })
  Object.assign(process.env, {
    SHELL: "nu", // 跳过登录 shell 探测(同 server.test.ts)
    // 初始目录(main 交给 sidecar 的 initialDirectory)默认取 os.homedir(),不随沙箱的 HOME 走:改指沙箱
    CODEPUPPY_USER_WORKSPACE_DIR: path.join(sandbox.home, "parity-workspace"),
    CODEPUPPY_SECRETS_DISABLE: "1", // 不读任何 codepuppy.env(同 server.test.ts)
    DEV_PLATFORM_TOKEN: devPlatformToken("tenant-parity"),
    // 登录信封经 applyAuthEnv 落下的值(令牌是合成值;地址指本机桩)
    CODEPUPPY_BASE_URL: `http://127.0.0.1:${model.port}/v1`,
    CODEPUPPY_API_KEY: "sk-cp-parity",
    CODEPUPPY_CLOUD_MCP_URL: `http://127.0.0.1:${cloud.port}/mcp`,
    CODEPUPPY_CLOUD_TOKEN: "synthetic-cloud-parity",
    CODEPUPPY_MCP_TOKEN: "synthetic-mcp-parity",
    // boot 时出厂技能对账的结果(index.ts)
    CODEPUPPY_FACTORY_SKILL_DIRS: JSON.stringify([factorySkills]),
  })
  preferAppEnv(userDataPath)
  resetDanglingSweepLatchForTests()
  creditDanglingSweepForSpawn()
  forkCalls.length = 0
  wire.length = 0
  const spawned = await spawnLocalServer("127.0.0.1", 4096, "password", {
    userDataPath,
    healthCheck: async () => true,
    planFence: fakePlanFence,
    egressProxy: async () => ({ port: 4433 }),
    fork: fakeFork,
  })
  await spawned.health.wait
  await spawned.listener.stop()
  const forkEnv = (forkCalls.at(-1)?.options.env ?? {}) as Record<string, string | undefined>
  const start = wire.find((message) => message.type === "start") as Record<string, any>
  return { forkEnv, start }
}

/**
 * sidecar 这一步:本进程扮演刚被 fork 出来的 sidecar —— 没有冻结快照,Code Puppy 的键只来自 fork 给它的 env(HOME / XDG 由沙箱接管,
 * 代理变量不搬:桩在本机),决定只来自 start 消息。`#1698` G1 起照 sidecar.ts `start()` 的第 2 步:用生产的 acceptCodePuppyBootstrap
 * 解析并发布 start 消息里的启动文档,路径与通道从文档取。返回 sidecar 交给注入与 `start()` 的输入。
 */
function sidecarStep(launched: Awaited<ReturnType<typeof launch>>) {
  __resetCodePuppyEnvironmentForTests()
  __resetCodePuppyBootstrapForTests()
  for (const key of Object.keys(process.env)) if (key.startsWith("CODEPUPPY_")) delete process.env[key]
  for (const [key, value] of Object.entries(launched.forkEnv)) if (key.startsWith("CODEPUPPY_") && value !== undefined) process.env[key] = value
  const bootstrap = acceptCodePuppyBootstrap(launched.start.bootstrap)
  return {
    userData: bootstrap.paths.userData,
    initialDirectory: bootstrap.paths.initialDirectory,
    database: bootstrap.paths.database,
    engineConfigDirectory: bootstrap.paths.engineConfigDirectory,
    extPlugin: bootstrap.paths.extPlugin,
    registryChannel: bootstrap.registryChannel,
    /** codepuppy.jsonc;null = 逃生阀置位(sidecar.ts 的 prepareSidecarEnv 同一传法) */
    userConfig: bootstrap.paths.userConfig ?? null,
    globalRoot: bootstrap.paths.globalRoot,
    /** G2 起出网代理的决定者标记在文档里(engineNetFailurePath 的第三个参数) */
    egressProxy: bootstrap.network.egressProxy,
    toggles: engineDesktopToggles(launched.forkEnv),
    /** sidecar 进程的整份 env(含出网代理变量;这里不搬进本进程,只交给读整份 env 的读法)。 */
    processEnv: launched.forkEnv,
  }
}

async function observe(inputs: ReturnType<typeof sidecarStep>, fence: unknown) {
  const injection = injectCodePuppyConfig(inputs.userData, inputs.extPlugin, inputs.registryChannel, inputs.userConfig)
  expect(injection.ok).toBe(true)
  const content = JSON.parse(injection.config.content) as Record<string, any>
  const explicit = injection.config.file ? JSON.parse(fs.readFileSync(injection.config.file, "utf8")) : undefined
  const options = buildEngineServerOptions({
    hostname: "127.0.0.1",
    port: 0,
    password: "cp-parity",
    engineVersion: "test",
    databasePath: inputs.database,
    configDirectory: inputs.engineConfigDirectory,
    config: injection.config,
    models: { ...(injection.models.file ? { file: injection.models.file } : {}), fetch: inputs.toggles.modelsFetch },
    filewatcher: inputs.toggles.filewatcher,
    platform: process.platform,
  })

  // 沙箱里没有已应用的平台目录,平台节点的模型表是空的(`#1556`):只为能发出一次请求补一个模型 —— 记录里的内联文档取补之前的那份
  const runnable = structuredClone(content)
  runnable.providers.codepuppy.models = { m: { name: "m" } }
  // ext 在装载时取 main 的 parentPort(定制中心桥);sidecar 里它在,这里给一个不应答的
  ;(process as unknown as { parentPort?: unknown }).parentPort ??= { postMessage: () => {}, on: () => {} }
  fs.mkdirSync(inputs.initialDirectory, { recursive: true })
  const { startEngine } = await import("../../engine/engine-embed")
  let fetch: ((request: Request) => Promise<Response>) | undefined
  const engine = await startEngine({ ...options, config: { ...options.config, content: JSON.stringify(runnable) } }, {
    onDispatch: (dispatch) => (fetch = withEngineAuthorization(dispatch, "cp-parity")),
  })
  engines.push(engine)
  const send = async (method: string, route: string, body?: unknown) => {
    const response = await fetch!(
      new Request(`http://codepuppy-sidecar.invalid${route}`, {
        method,
        headers: { "x-opencode-directory": encodeURIComponent(inputs.initialDirectory), "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
    const raw = await response.text()
    return { status: response.status, json: raw ? JSON.parse(raw) : undefined }
  }
  const pluginStatus = async () =>
    (((await send("GET", "/api/plugin")).json?.data ?? []) as Array<{ id: string; state: { status: string } }>).find((plugin) => plugin.id === "codepuppy.ext")?.state.status
  for (let i = 0; i < 200 && (await pluginStatus()) !== "active"; i++) await Bun.sleep(50)
  const mcpStatus = async () =>
    (((await send("GET", "/api/mcp")).json?.data ?? []) as Array<{ name: string; status: { status: string } }>).find((item) => item.name === "codepuppy")?.status.status
  for (let i = 0; i < 200 && ["pending", "connecting", undefined].includes(await mcpStatus()); i++) await Bun.sleep(50)
  const providers = (((await send("GET", "/api/provider")).json?.data ?? []) as Array<{ id: string }>).map((provider) => provider.id).toSorted()
  const inventory = (await send("POST", "/api/rpc/codepuppy.tool-policy/inventory", {})).json as { output?: { partition?: { account?: string } } }
  const sessionID = (await send("POST", "/api/session", { location: { directory: inputs.initialDirectory }, model: { id: "m", providerID: "codepuppy" } })).json.data.id as string
  await send("POST", `/api/session/${sessionID}/prompt`, { text: "hello" })
  await send("POST", `/api/experimental/session/${sessionID}/wait`)

  return {
    sidecar: {
      userData: inputs.userData,
      initialDirectory: inputs.initialDirectory,
      database: inputs.database,
      engineConfigDirectory: inputs.engineConfigDirectory,
      extPlugin: inputs.extPlugin,
      registryChannel: inputs.registryChannel,
      fence,
    },
    start: { database: options.database, config: { directory: options.config.directory, file: options.config.file }, models: options.models, fs: options.fs },
    injection: {
      content,
      explicit,
      models: injection.models.file ? JSON.parse(fs.readFileSync(injection.models.file, "utf8")) : undefined,
      secretFiles: fs.readdirSync(path.dirname(secretFilePath(inputs.userData, "CODEPUPPY_API_KEY"))).toSorted(),
    },
    engine: {
      ext: await pluginStatus(),
      providers,
      cloudMcp: await mcpStatus(),
      policyAccount: inventory.output?.partition?.account,
      proxiedFailure: engineNetFailurePath("https://unreachable.example/v1", inputs.processEnv, inputs.egressProxy),
    },
    credentials: { model: [...new Set(modelAuthorization)], cloud: [...new Set(cloudAuthorization)] },
  }
}

/** 临时根与桩的端口换成占位;超过 300 字的字符串(提示词模板等)换成 sha256,记录文件才读得下去。 */
function normalize(record: unknown): unknown {
  const placed = JSON.stringify(record)
    .replaceAll(sandbox.root, "<root>")
    .replaceAll(REPO, "<repo>")
    .replaceAll(`127.0.0.1:${model.port}`, "<model>")
    .replaceAll(`127.0.0.1:${cloud.port}`, "<cloud>")
  return JSON.parse(
    JSON.stringify(JSON.parse(placed), (_key, value) =>
      typeof value === "string" && value.length > 300 ? `sha256:${createHash("sha256").update(value).digest("hex")}` : value,
    ),
  )
}

describe("#1698 段 0:代表性启动的决定记录", () => {
  test("真 fork → sidecar 这一步 → 注入 → 引擎 + 真 ext:记录与 bootstrap-launch-parity.record.json 逐项相同", async () => {
    const launched = await launch()
    const inputs = sidecarStep(launched)
    // design §10 R31:共用模块的「快照 → 已发布文档 → 环境」里,环境这一支在生产启动里到不了 —— fork 给 sidecar 的 env 里没有这个键
    // (前缀拒绝),而 sidecar 没有快照、文档又先于一切读方发布:即使环境里摆一个别的值,读到的也是文档里 main 算的那个根。
    expect(launched.forkEnv).not.toHaveProperty("CODEPUPPY_GLOBAL_DIR")
    expect(resolveCodePuppyGlobalRoot({ CODEPUPPY_GLOBAL_DIR: path.join(sandbox.root, "decoy-root") })).toBe(inputs.globalRoot)
    const record = normalize(await observe(inputs, launched.start.fence))
    expect(record).toEqual(JSON.parse(fs.readFileSync(RECORD_FILE, "utf8")))
  }, 120_000)
})
