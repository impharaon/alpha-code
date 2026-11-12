// REQ-234 `#1529`(基线 §2.2 / §2.6,I6 的 main 半边)—— 生产 spawnLocalServer 把 parentPort 上的 `codepuppy.*` 交给 codepuppySidecar:
//   · 子进程发来的 `codepuppy.*` 进 receive,应答经同一个子进程发回;write-probe 的应答**不**进 receive(两条接收者并列);
//   · ready 之后才 attach(在途重载在这一刻重发),子进程退出时断开的是**这一次**连接。
// harness 与 process-fence-wiring.test.ts 同形:mock electron / logging,假子进程记录线上消息。
import { isolateEngineHome } from "../../test-component/isolated-engine-home"
import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { EventEmitter } from "node:events"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mockElectron } from "../../test-component/electron-mock"
import type { CodePuppySidecarOutbound } from "./codepuppy-sidecar-messages"

// 在 server.ts 被 import、spawnLocalServer 跑之前:旧凭证检查只看临时根,不碰本机真实数据目录(isolated-engine-home.ts)。
isolateEngineHome()

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
  for (const key of ["SHELL", "CODEPUPPY_SECRETS_DISABLE"]) saved[key] = process.env[key]
  process.env.SHELL = "nu"
  process.env.CODEPUPPY_SECRETS_DISABLE = "1"
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

// #1565:生产 spawnLocalServer 在 fork 时把随包文档工具清单的路径交给引擎(名字取引擎读的那个常量),而引擎的判定
// 拿这份 env 认得出 main 写策略写下的四条命令(两边对资源根的解析一致、清单与模板逐 token 对上)。
// 删掉注入 ⇒ env 里没有这个键;注入的路径与写策略的资源根解析不一致 ⇒ 四条都拿不到声明定义。
test("#1565: fork 注入 CODEPUPPY_OFFICE_MCP_MANIFEST,引擎据它认出写策略写下的四条文档工具命令", async () => {
  const { OFFICE_MCP_MANIFEST_ENV, declaredFirstPartyTools } = await import("../../../opencode/src/mcp/codepuppy-first-party-mcp")
  const { applyMcpWritePolicy } = await import("./ext-mcp-policy")
  const { CODEPUPPY_OFFICE_CONNECTORS } = await import("../shared/office-advisories")
  const child = new RecordingChild()
  let env: Record<string, string> = {}
  creditDanglingSweepForSpawn()
  const result = await spawnLocalServer("127.0.0.1", 4393, "password", {
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
  expect(env[OFFICE_MCP_MANIFEST_ENV]).toEndWith("/office-mcp/tools.json")
  for (const connector of CODEPUPPY_OFFICE_CONNECTORS) {
    const server: Record<string, unknown> = { type: "local", command: ["placeholder"] }
    expect(applyMcpWritePolicy(connector.name, server).ok).toBe(true)
    const declared = declaredFirstPartyTools(connector.name, server, env, readFileSync) as Array<{ name: string }> | undefined
    const extension = connector.extension.slice(1)
    expect(declared?.map((tool) => tool.name).sort()).toEqual([`read_${extension}`, `write_${extension}`])
  }
  await result.listener.stop()
})

// REQ-236 `#1575` AC4:生产 spawnLocalServer 在 fork 时按**当刻的登录账户**写 CODEPUPPY_POLICY_ACCOUNT(引擎据它选工具策略
// 分区),未登录不写(引擎退回 anonymous)。登录态走真 codepuppy-auth:dev 短路令牌(未打包时 DEV_PLATFORM_TOKEN)的
// `account.read` 的 sub。值里混入本安装的随机持久标识(artifact-service 的安装级 machine id,boot 时初始化):这个变量被
// 第三方 MCP / LSP / shell 子进程继承,同一账户换一台安装就是另一个值,不能据它跨安装关联。期望值从 sub 与盘上的
// machine id 文件独立算出,不调被测函数;取不到安装标识与未登录一样不写;shell 导出的同名变量选不了分区。
test("#1575: fork 按登录账户 × 本安装写 CODEPUPPY_POLICY_ACCOUNT(同安装同账户相同、换安装或换账户不同、不含明文);取不到不写,导出的同名变量不透传", async () => {
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
  const forkEnv = async (port: number) => {
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
    return env
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
    const a = (await forkEnv(4394)).CODEPUPPY_POLICY_ACCOUNT
    expect(a).toBe(expected(installA, "tenant-a"))
    expect(a).not.toContain("tenant-a")
    // 同安装同账户再 fork 一次:分区键不变(换号重 fork 回来仍是同一分区)。
    expect((await forkEnv(4397)).CODEPUPPY_POLICY_ACCOUNT).toBe(a)

    process.env.DEV_PLATFORM_TOKEN = token("tenant-b")
    const b = (await forkEnv(4395)).CODEPUPPY_POLICY_ACCOUNT
    expect(b).toBe(expected(installA, "tenant-b"))
    expect(b).not.toBe(a)

    // 另一个安装、同一账户:值不同。
    const installB = await installation(otherInstall)
    expect(installB).not.toBe(installA)
    process.env.DEV_PLATFORM_TOKEN = token("tenant-a")
    const elsewhere = (await forkEnv(4398)).CODEPUPPY_POLICY_ACCOUNT
    expect(elsewhere).toBe(expected(installB, "tenant-a"))
    expect(elsewhere).not.toBe(a)

    // 安装标识取不到(machine id 根不可用):与未登录同样不写。
    expect((await initializeArtifactQuotaEnvironment(join(otherInstall, "missing"))).ok).toBe(false)
    expect(await forkEnv(4399)).not.toHaveProperty("CODEPUPPY_POLICY_ACCOUNT")

    await installation(userDataPath)
    delete process.env.DEV_PLATFORM_TOKEN
    process.env.CODEPUPPY_POLICY_ACCOUNT = "acct:exported-by-shell"
    expect(await forkEnv(4396)).not.toHaveProperty("CODEPUPPY_POLICY_ACCOUNT")
  } finally {
    rmSync(otherInstall, { recursive: true, force: true })
  }
})

// #1578 AC5:main 写进 sidecar env 的随包扩展清单键必须就是引擎读的那个常量 —— 任一侧改名,线上 ext 自有工具全部静默回第三方,
// 而 opencode/test/plugin/codepuppy-bundled-plugin.test.ts 自己给 env 赋值照样绿。dev 下 ext.path 取决于未入库的 packages/ext/dist
// (门不保证它在,上面那条生产 spawn 里这个键可能根本不写),所以锚源码:server.ts 写这个键的那一句,键名取引擎常量,
// 指向 plugin.js 旁边的 bundled-tools.json。任一侧字面量改一个字母 ⇒ 找不到这一句,当场红。
test("ANCHOR (not a gate): #1578 server.ts 写进 sidecar env 的随包扩展清单键 = 引擎读的常量", async () => {
  const { EXT_BUNDLED_MANIFEST_ENV } = await import("../../../opencode/src/plugin/codepuppy-bundled-plugin")
  const source = await Bun.file(join(import.meta.dir, "server.ts")).text()
  const line = source.split("\n").find((text) => text.includes(`sidecarEnv.${EXT_BUNDLED_MANIFEST_ENV} =`))
  expect(line).toBeDefined()
  expect(line).toContain(`"bundled-tools.json"`)
})

// `#1531`:ext 的 parentPort 监听必须在 ready **之前**挂上(main 只在 ready 那一刻重发在途代际)。sidecar.ts 顶层的 registerHooks /
// getParentPort() 让它不能被 import,接线只能锚源码。`#1667`(接口文档 I1 / I2 改形):2.x 每个 Location 用带 `__opencode_reload`
// 的新 URL 各求值一次 ext,不再靠「预载同一个 URL」拿到同一份模块(进程级对象由 ext 挂在 globalThis 上);这里锚的顺序是
// 引擎 import → 预载 ext 的目录入口 `server.js` → `start()`(Transform 里同步发布进程内 fetch)→ await 预载 → ready。
test("ANCHOR (not a gate): sidecar.ts 在 start() 之前预载 ext 的目录入口,Transform 里发布进程内 fetch,ready 之前 await 预载", async () => {
  const source = await Bun.file(join(import.meta.dir, "sidecar.ts")).text()
  const engine = source.indexOf('const { startEngine, ENGINE_VERSION } = await import("virtual:opencode-server")')
  const preload = source.indexOf('import(pathToFileURL(join(command.extPluginPath, "server.js")).href)')
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
})
