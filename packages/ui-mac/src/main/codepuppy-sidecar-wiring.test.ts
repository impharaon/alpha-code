// REQ-234 `#1529`(基线 §2.2 / §2.6,I6 的 main 半边)—— 生产 spawnLocalServer 把 parentPort 上的 `codepuppy.*` 交给 codepuppySidecar:
//   · 子进程发来的 `codepuppy.*` 进 receive,应答经同一个子进程发回;write-probe 的应答**不**进 receive(两条接收者并列);
//   · ready 之后才 attach(在途重载在这一刻重发),子进程退出时断开的是**这一次**连接。
// harness 与 process-fence-wiring.test.ts 同形:mock electron / logging,假子进程记录线上消息。
import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mockElectron } from "../../test-component/electron-mock"
import type { CodePuppySidecarOutbound } from "./codepuppy-sidecar-messages"

const appEvents = new EventEmitter()
let userDataPath = ""
mockElectron(() => ({
  app: {
    isPackaged: false,
    on: appEvents.on.bind(appEvents),
    off: appEvents.off.bind(appEvents),
    getPath: (name: string) => (name === "userData" ? userDataPath : join(userDataPath, name)),
    getVersion: () => "0.0.0-test",
  },
  utilityProcess: {
    fork: () => {
      throw new Error("unexpected utilityProcess.fork")
    },
  },
  BrowserWindow: class {},
  dialog: {},
  ipcMain: { handle: () => {}, on: () => {} },
}))
mock.module("./logging", () => ({
  getLogger: () => ({ log: () => {}, warn: () => {}, error: () => {} }),
  write: () => {},
  rotateServerLogs: () => {},
}))

const { spawnLocalServer } = await import("./server")
const { creditDanglingSweepForSpawn, resetDanglingSweepLatchForTests } = await import("./dangling-sweep-latch")

class RecordingChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  wire: unknown[] = []
  postMessage(message: unknown) {
    this.wire.push(message)
    const type = (message as { type?: unknown }).type
    if (type === "start") queueMicrotask(() => this.emit("message", { type: "ready" }))
    if (type === "stop") queueMicrotask(() => this.emit("exit", 0))
    if (type === "project-config-view") {
      const command = message as { id: string; directory: string }
      queueMicrotask(() => this.emit("message", { type: "project-config-view-reply", id: command.id, ok: true, view: { directory: command.directory, trusted: false, complete: true, points: { config: "done" }, withheld: [] } }))
    }
    if (type === "write-probe") {
      const { id } = message as { id: number }
      queueMicrotask(() => this.emit("message", { type: "write-probe-result", id, outcome: "writable" }))
    }
  }
  kill() {
    queueMicrotask(() => this.emit("exit", 0))
  }
}

const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), "codepuppy-sidecar-wiring-"))
  resetDanglingSweepLatchForTests()
  for (const key of ["SHELL", "CODEPUPPY_SECRETS_DISABLE", "CODEPUPPY_GLOBAL_DIR"]) saved[key] = process.env[key]
  process.env.SHELL = "nu"
  process.env.CODEPUPPY_SECRETS_DISABLE = "1"
  process.env.CODEPUPPY_GLOBAL_DIR = join(userDataPath, "codepuppy-state", "env", "dev") // #1698:无快照的单测经环境给全局根(design §10 R31),fork 时构建启动文档要它
})
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(userDataPath, { recursive: true, force: true })
})

test("alpha.* 进 codepuppySidecar、应答回同一子进程;ready 之后才 attach;退出断开这一次连接;探针应答不进 alpha", async () => {
  const child = new RecordingChild()
  const received: unknown[] = []
  const events: string[] = []
  const codepuppySidecar = {
    receive(message: unknown, post: (message: CodePuppySidecarOutbound) => void) {
      if (typeof (message as { type?: unknown })?.type !== "string" || !(message as { type: string }).type.startsWith("codepuppy.")) return false
      received.push(message)
      post({ type: "codepuppy.hub.request.reply", id: (message as { id: number }).id, record: null })
      return true
    },
    attach(post: (message: CodePuppySidecarOutbound) => void) {
      events.push(`attach after start=${child.wire.some((m) => (m as { type?: string }).type === "start")}`)
      post({ type: "codepuppy.reload.request", generation: 1, scope: "global", items: [], reason: "re-sent at ready" })
      return (reason: string) => void events.push(`detach: ${reason}`)
    },
  }
  creditDanglingSweepForSpawn()
  const result = await spawnLocalServer("127.0.0.1", 4391, "password", {
    userDataPath,
    healthCheck: async () => true,
    fork: (() => child) as unknown as typeof import("electron").utilityProcess.fork,
    egressProxy: async () => ({ port: 4433 }),
    planFence: () => ({ profile: "(version 1)\n(allow default)\n(deny file-write*)\n", addonPath: "/x/codepuppy_fence.node" }),
    codepuppySidecar,
  })
  await result.health.wait
  expect(events).toEqual(["attach after start=true"])
  expect(child.wire.at(-1)).toEqual({ type: "codepuppy.reload.request", generation: 1, scope: "global", items: [], reason: "re-sent at ready" })

  child.emit("message", { type: "codepuppy.hub.request.request", id: 9, requestId: "req_abcdef12" })
  expect(received).toEqual([{ type: "codepuppy.hub.request.request", id: 9, requestId: "req_abcdef12" }])
  expect(child.wire.at(-1)).toEqual({ type: "codepuppy.hub.request.reply", id: 9, record: null })

  expect((await result.listener.probeWrite("/ws")).outcome).toBe("writable")
  expect(await result.listener.projectConfigView("/ws")).toMatchObject({ directory: "/ws", complete: true })
  expect(received).toHaveLength(1)

  await result.listener.stop()
  expect(events).toEqual(["attach after start=true", "detach: sidecar exited with code 0"])
})

// `#1531`(#1529 审计 Minor ④):同一条接线,接上**生产** host + 重载协调器(不是假 codepuppySidecar)——
// 子进程发来的阶段查询经 hub-view 的分发得到应答;子进程退出之后,在途重载的原因如实变成「sidecar 退出了」。
test("真 host + 真协调器:阶段查询经子进程往返;退出 ⇒ pendingFor 的原因是 sidecar exited", async () => {
  const { createCodePuppySidecarHost, createHubRequestStages } = await import("./hub-view")
  const { createReloadCoordinator } = await import("./reload-coordinator")
  const child = new RecordingChild()
  const reloads = createReloadCoordinator({ log: () => {}, onChange: () => {} })
  const requests = createHubRequestStages({ log: () => {} })
  expect(requests.record({ requestId: "req_abcdef12", stage: "confirming", catalogId: "mcp:github" })).toEqual({ ok: true })
  const host = createCodePuppySidecarHost({
    view: { view: async () => ({ directory: "/w", rows: [], warnings: [] }), viewForAgent: async () => ({ directory: "/w", rows: [], warnings: [] }) },
    requests,
    reloads,
    log: () => {},
  })
  reloads.request({ scope: "global", items: [], reason: "installed skill writer" })
  creditDanglingSweepForSpawn()
  const result = await spawnLocalServer("127.0.0.1", 4392, "password", {
    userDataPath,
    healthCheck: async () => true,
    fork: (() => child) as unknown as typeof import("electron").utilityProcess.fork,
    egressProxy: async () => ({ port: 4433 }),
    planFence: () => ({ profile: "(version 1)\n(allow default)\n(deny file-write*)\n", addonPath: "/x/codepuppy_fence.node" }),
    codepuppySidecar: host,
  })
  await result.health.wait
  // ready 时在途的那一代被重发给子进程
  expect(child.wire.at(-1)).toMatchObject({ type: "codepuppy.reload.request", generation: 1, scope: "global" })
  child.emit("message", { type: "codepuppy.hub.request.request", id: 5, requestId: "req_abcdef12" })
  expect(child.wire.at(-1)).toEqual({
    type: "codepuppy.hub.request.reply",
    id: 5,
    record: { requestId: "req_abcdef12", catalogId: "mcp:github", stage: "confirming" },
  })
  expect(reloads.pendingFor("/w")).toEqual({ code: "reload-waiting", detail: "queued" })
  await result.listener.stop()
  expect(reloads.pendingFor("/w")).toEqual({ code: "reload-waiting", detail: "sidecar exited with code 0" })
})

// #1565:生产 spawnLocalServer 在 fork 时把随包文档工具清单的路径交给引擎(`#1698` 起在启动文档的 paths.officeMcpManifest),
// 而引擎的判定拿这个路径认得出 main 写策略写下的四条命令(两边对资源根的解析一致、清单与模板逐 token 对上)。
// 删掉这个字段 ⇒ 文档解析即失败;路径与写策略的资源根解析不一致 ⇒ 四条都拿不到声明定义。
test("#1565 / #1698: fork 的启动文档带 paths.officeMcpManifest,引擎据它认出写策略写下的四条文档工具命令", async () => {
  const { declaredFirstPartyTools } = await import("../../../core/src/mcp/codepuppy-first-party-mcp")
  const { applyMcpWritePolicy } = await import("./ext-mcp-policy")
  const { CODEPUPPY_OFFICE_CONNECTORS } = await import("../shared/office-advisories")
  const child = new RecordingChild()
  creditDanglingSweepForSpawn()
  const result = await spawnLocalServer("127.0.0.1", 4393, "password", {
    userDataPath,
    healthCheck: async () => true,
    fork: (() => child) as unknown as typeof import("electron").utilityProcess.fork,
    egressProxy: async () => ({ port: 4433 }),
    planFence: () => ({ profile: "(version 1)\n(allow default)\n(deny file-write*)\n", addonPath: "/x/codepuppy_fence.node" }),
  })
  await result.health.wait
  const start = child.wire.find((message) => (message as { type?: unknown }).type === "start") as { bootstrap: { paths: { officeMcpManifest: string } } }
  const manifest = start.bootstrap.paths.officeMcpManifest
  expect(manifest).toEndWith("/office-mcp/tools.json")
  for (const connector of CODEPUPPY_OFFICE_CONNECTORS) {
    const server: Record<string, unknown> = { type: "local", command: ["placeholder"] }
    expect(applyMcpWritePolicy(connector.name, server).ok).toBe(true)
    const declared = declaredFirstPartyTools(connector.name, server, manifest, readFileSync) as Array<{ name: string }> | undefined
    const extension = connector.extension.slice(1)
    expect(declared?.map((tool) => tool.name).sort()).toEqual([`read_${extension}`, `write_${extension}`])
  }
  await result.listener.stop()
})

// REQ-236 `#1575` AC4:生产 spawnLocalServer 在 fork 时按**当刻的登录账户**写启动文档的 policy.account(ext 据它选工具策略
// 分区),未登录不写(退回 anonymous)。登录态走真 codepuppy-auth:dev 短路令牌(未打包时 DEV_PLATFORM_TOKEN)的
// `account.read` 的 sub。值里混入本安装的随机持久标识(artifact-service 的安装级 machine id,boot 时初始化):同一账户换一台
// 安装就是另一个值,不能据它跨安装关联。`#1698` G2:它不再写进 sidecar 环境(第三方 MCP / LSP / shell 子进程从此拿不到),
// 只在 start 消息的启动文档里。期望值从 sub 与盘上的 machine id 文件独立算出,不调被测函数;取不到安装标识与未登录一样不写;
// shell 导出的旧同名变量选不了分区,也到不了 sidecar 环境。
test("#1575: fork 按登录账户 × 本安装写启动文档的 policy.account(同安装同账户相同、换安装或换账户不同、不含明文);取不到不写,导出的旧同名变量不透传", async () => {
  const { initializeArtifactQuotaEnvironment, ARTIFACT_QUOTA_MACHINE_ID_FILE } = await import("./artifact-service")
  const { createHash } = await import("node:crypto")
  const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")
  const token = (sub: string) =>
    `${Buffer.from("{}").toString("base64url")}.${Buffer.from(
      JSON.stringify({
        schema_version: 1,
        iss: "codepuppy-web",
        aud: "codepuppy-platform-api",
        sub,
        token_use: "platform_access",
        purpose: "account.read",
        scope: ["account.read"],
        iat: 1,
        exp: 2,
        jti: `jti-${sub}`,
      }),
    ).toString("base64url")}.signature`
  const forkStart = async (port: number) => {
    const child = new RecordingChild()
    let env: Record<string, string> = {}
    creditDanglingSweepForSpawn()
    const result = await spawnLocalServer("127.0.0.1", port, "password", {
      userDataPath,
      healthCheck: async () => true,
      fork: ((_: string, __: string[], options: { env: Record<string, string> }) => {
        env = options.env
        return child
      }) as unknown as typeof import("electron").utilityProcess.fork,
      egressProxy: async () => ({ port: 4433 }),
      planFence: () => ({ profile: "(version 1)\n(allow default)\n(deny file-write*)\n", addonPath: "/x/codepuppy_fence.node" }),
    })
    await result.health.wait
    await result.listener.stop()
    const start = child.wire.find((message) => (message as { type?: unknown }).type === "start") as { bootstrap: { policy: { account?: string } } }
    expect(env).not.toHaveProperty("CODEPUPPY_POLICY_ACCOUNT")
    return start.bootstrap.policy
  }
  const installation = async (dir: string) => {
    expect((await initializeArtifactQuotaEnvironment(dir)).ok).toBe(true)
    return readFileSync(join(dir, ARTIFACT_QUOTA_MACHINE_ID_FILE), "utf8").trim()
  }
  const expected = (install: string, sub: string) => `acct:${sha256(`${install}:${sha256(sub).slice(0, 32)}`)}`
  const otherInstall = mkdtempSync(join(tmpdir(), "codepuppy-sidecar-wiring-install-b-"))
  for (const key of ["DEV_PLATFORM_TOKEN", "CODEPUPPY_POLICY_ACCOUNT"]) saved[key] = process.env[key]
  try {
    const installA = await installation(userDataPath)
    process.env.DEV_PLATFORM_TOKEN = token("tenant-a")
    const a = (await forkStart(4394)).account
    expect(a).toBe(expected(installA, "tenant-a"))
    expect(a).not.toContain("tenant-a")
    // 同安装同账户再 fork 一次:分区键不变(换号重 fork 回来仍是同一分区)。
    expect((await forkStart(4397)).account).toBe(a)

    process.env.DEV_PLATFORM_TOKEN = token("tenant-b")
    const b = (await forkStart(4395)).account
    expect(b).toBe(expected(installA, "tenant-b"))
    expect(b).not.toBe(a)

    // 另一个安装、同一账户:值不同。
    const installB = await installation(otherInstall)
    expect(installB).not.toBe(installA)
    process.env.DEV_PLATFORM_TOKEN = token("tenant-a")
    const elsewhere = (await forkStart(4398)).account
    expect(elsewhere).toBe(expected(installB, "tenant-a"))
    expect(elsewhere).not.toBe(a)

    // 安装标识取不到(machine id 根不可用):与未登录同样不写。
    expect((await initializeArtifactQuotaEnvironment(join(otherInstall, "missing"))).ok).toBe(false)
    expect(await forkStart(4399)).not.toHaveProperty("account")

    await installation(userDataPath)
    delete process.env.DEV_PLATFORM_TOKEN
    process.env.CODEPUPPY_POLICY_ACCOUNT = "acct:exported-by-shell"
    expect(await forkStart(4396)).not.toHaveProperty("account")
  } finally {
    rmSync(otherInstall, { recursive: true, force: true })
  }
})

// `#1531`:ext 的 parentPort 监听必须在 ready **之前**挂上(main 只在 ready 那一刻重发在途代际)。sidecar.ts 顶层的 registerHooks /
// getParentPort() 让它不能被 import,接线只能锚源码。`#1667`(接口文档 I1 / I2 改形):2.x 每个 Location 用带 `__opencode_reload`
// 的新 URL 各求值一次 ext,不再靠「预载同一个 URL」拿到同一份模块(进程级对象由 ext 挂在 globalThis 上);这里锚的顺序是
// 引擎 import → 预载 ext 的目录入口 `server.js` → `start()`(Transform 里同步发布进程内 fetch)→ await 预载 → ready。
test("ANCHOR (not a gate): sidecar.ts 在 start() 之前预载 ext 的目录入口,Transform 里发布进程内 fetch,ready 之前 await 预载", async () => {
  const source = await Bun.file(join(import.meta.dir, "sidecar.ts")).text()
  const engine = source.indexOf('const engineModule = await import("virtual:opencode-server")')
  const preload = source.indexOf('import(pathToFileURL(join(bootstrap.paths.extPlugin, "server.js")).href)')
  const started = source.indexOf("const started = await startEngine(")
  const handoff = source.indexOf("publishInProcessEngine(inProcess)")
  const joined = source.indexOf("await extPreload")
  const ready = source.indexOf("parentPort.postMessage(buildReadyMessage(injection, prewarmResult))")
  expect(engine).toBeGreaterThan(0)
  expect(preload).toBeGreaterThan(engine)
  expect(started).toBeGreaterThan(preload)
  // 交接写在 startEngine 的 onDispatch 回调里(Transform 那一刻同步执行),所以文本上在 startEngine( 之后、await 预载之前。
  expect(handoff).toBeGreaterThan(started)
  expect(joined).toBeGreaterThan(handoff)
  expect(ready).toBeGreaterThan(joined)
  // 审查 6:原文件顶层不能 import;执行锚定的真实监听 / 解析片段,不复制分支。
  const { answerProjectConfigView } = await import("./sidecar-project-config-view")
  const { buildProjectConfigViewRequest, parseProjectConfigViewRequest } = await import("./project-config-view-message")
  const listener = source.slice(source.indexOf('parentPort.on("message"'), source.indexOf("\nasync function start("))
  const parser = source.slice(source.indexOf("function parseCommand("), source.indexOf("\n/** 形状不对"))
  const replies: unknown[] = []
  let receive: (event: { data: unknown }) => void = () => { throw new Error("listener not registered") }
  const view = { directory: "/ws", trusted: false, complete: true, points: { config: "done" as const }, withheld: [] }
  const run = new Function("parentPort", "engine", "inProcessEngine", "readProjectConfigView", "answerProjectConfigView", "parseProjectConfigViewRequest", new Bun.Transpiler({ loader: "ts" }).transformSync(listener + "\n" + parser))
  run({ on: (_: string, handler: typeof receive) => { receive = handler }, postMessage: (reply: unknown) => replies.push(reply) }, {}, () => async () => Response.json({ data: [] }), () => view, answerProjectConfigView, parseProjectConfigViewRequest)
  receive({ data: buildProjectConfigViewRequest("review-6", "/ws") })
  for (let i = 0; i < 10 && replies.length === 0; i++) await Bun.sleep(1)
  expect(replies).toEqual([{ type: "project-config-view-reply", id: "review-6", ok: true, view }])
})

// `#1698`(DESIGN-upgrade-bootstrap-config §4.2):sidecar.ts 的启动关口顺序 —— 装围栏 → 解析并发布启动文档 → 注入(读文档)→ import 引擎 →
// 引擎 bundle 用自己的解析器读一次文档(缺导出 / 不符即抛)→ startEngine。两步本身的判据在 sidecar-bootstrap-gate.test.ts 与
// sidecar-engine-host.cases.ts;sidecar.ts 顶层有副作用、import 不得,先后只能锚源码。
test("ANCHOR (not a gate): #1698 sidecar.ts 装围栏之后才发布启动文档,注入读文档,import 引擎之后、startEngine 之前过引擎关口", async () => {
  const source = await Bun.file(join(import.meta.dir, "sidecar.ts")).text()
  const order = [
    "installProcessFence(command)",
    "const bootstrap = acceptCodePuppyBootstrap(command.bootstrap)",
    "const injection = prepareSidecarEnv(bootstrap)",
    'const engineModule = await import("virtual:opencode-server")',
    "assertEngineReadsBootstrap(engineModule)",
    "const started = await startEngine(",
  ].map((text) => source.indexOf(text))
  expect(order[0]).toBeGreaterThan(0)
  for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]!)
})
