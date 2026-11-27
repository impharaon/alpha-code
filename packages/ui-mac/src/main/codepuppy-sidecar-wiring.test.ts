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
  // ext-ipc 的装载链在 import 时登记自有协议(D6 生产接线用例)
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
}))
mock.module("./logging", () => ({
  getLogger: () => ({ log: () => {}, warn: () => {}, error: () => {} }),
  write: () => {},
  rotateServerLogs: () => {},
  // ext-ipc(D6 生产接线用例)另外 import 的几个出口
  exportDebugLogs: async () => undefined,
  tail: () => "",
  serverLogRoots: () => [],
  initLogging: () => {},
  initCrashReporter: () => {},
  startNetLog: async () => {},
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
  const logs: string[] = []
  const canary = "SIDE_CAR_REJECTED_SECRET_CANARY_a23f"
  let finish!: (outcome: import("../shared/plugin-install").InstallOutcomeV1) => void
  const installing = new Promise<import("../shared/plugin-install").InstallOutcomeV1>(resolve => { finish = resolve })
  const host = createCodePuppySidecarHost({ installName: () => undefined, packageAuthorization: async () => ({ ok: false, reason: "not installed" }),
    view: { view: async () => ({ directory: "/w", rows: [], warnings: [] }), viewForAgent: async () => ({ directory: "/w", rows: [], warnings: [] }) },
    requests,
    searchSources: async () => ({ searchId: "search_unused", query: "", sources: [], candidates: [] }),
    install: () => installing,
    reloads,
    log: line => logs.push(line),
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
  child.emit("message", { type: "codepuppy.hub.install.request", id: 4, requestId: "req_abcdef12", directory: "/w", sessionID: "ses_wiring", agent: "build", ref: { kind: "id", id: "mcp:github" }, scope: "all-projects" })
  expect(child.wire.at(-1)).toEqual({ type: "codepuppy.hub.install.reply", id: 4, accepted: true })
  child.emit("message", { type: "codepuppy.hub.request.request", id: 5, requestId: "req_abcdef12" })
  expect(child.wire.at(-1)).toEqual({ type: "codepuppy.hub.request.reply", id: 5, record: { requestId: "req_abcdef12", stage: "submitted" } })
  const sent = child.wire.length
  // Removed renderer stage writes and malformed reads cannot advance or forge main's stage.
  child.emit("message", { type: "codepuppy.hub.request.stage", id: 6, requestId: "req_abcdef12", stage: "confirming", secret: canary })
  child.emit("message", { type: "codepuppy.hub.request.request", id: 7, requestId: { requestId: "req_abcdef12", stage: "failed" } })
  expect(child.wire).toHaveLength(sent)
  expect(requests.get("req_abcdef12")).toEqual({ requestId: "req_abcdef12", stage: "submitted" })
  expect(logs.filter(line => line.includes("dropped malformed"))).toHaveLength(2)
  const outcome = { ok: true as const, packageId: "mcp:github", displayName: "GitHub", source: { kind: "catalog" as const }, installed: [{ kind: "mcp" as const, hostName: "github", sourceName: "github" }], notRunning: [] }
  finish(outcome)
  await Bun.sleep(0)
  child.emit("message", { type: "codepuppy.hub.request.request", id: 8, requestId: "req_abcdef12" })
  expect(child.wire.at(-1)).toEqual({ type: "codepuppy.hub.request.reply", id: 8, record: { requestId: "req_abcdef12", stage: "committed", outcome, packageId: "mcp:github", displayName: "GitHub" } })
  expect(JSON.stringify(child.wire)).not.toContain("confirming")
  expect(JSON.stringify(child.wire)).not.toContain(canary)
  expect(logs.join("\n")).not.toContain(canary)
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
    expect(declared?.map((tool) => tool.name).sort()).toEqual(connector.format === "excel" ? ["excel_edit", "excel_inspect", "excel_objects", "excel_recalculate", "read_xlsx"] : [`read_${extension}`])
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

// D6 / R-m 的生产接线(#1776 片 6):sidecar 的契约 C 钩子(sidecarNativeSources,sidecar.ts 与引擎测试宿主共用)→ ext 进程级
// hub bridge → parentPort → registerExtIpcHandlers 交回的**生产** codepuppySidecar → main 的 createNativeSources → 账本。
test("native source sync crosses the production sidecar hook and main host into the ledger", async () => {
  const { registerExtIpcHandlers } = await import("./ext-ipc")
  const { sidecarNativeSources } = await import("./sidecar-native-sources")
  const { createHubBridge } = await import("../../../ext/src/hub-bridge")
  const { initCodePuppyEnvironment, __resetCodePuppyEnvironmentForTests } = await import("./codepuppy-environment")
  const { codepuppyGlobalRoot } = await import("./codepuppy-installs")
  delete process.env.CODEPUPPY_GLOBAL_DIR
  __resetCodePuppyEnvironmentForTests()
  initCodePuppyEnvironment({ isPackaged: false, channel: "dev", appDataDir: userDataPath, baseRoot: join(userDataPath, "codepuppy-state"), homeDir: join(userDataPath, "home") })
  const main = registerExtIpcHandlers(userDataPath, "dev", async () => { throw new Error("no engine in this unit") }, join(userDataPath, "home"), undefined, async () => undefined)
  await main.ledgerReady
  const listeners: Array<(event: { data: unknown }) => void> = []
  const bridge = createHubBridge({
    postMessage: (message) => queueMicrotask(() => {
      main.codepuppySidecar.receive(message, (reply) => queueMicrotask(() => { for (const listener of listeners) listener({ data: reply }) }))
    }),
    on: (_event, listener) => void listeners.push(listener),
  }, { log: () => {} })
  const slot = Symbol.for("codepuppy.ext.process")
  const holder = globalThis as { [slot]?: unknown }
  const previous = holder[slot]
  holder[slot] = { hubBridge: bridge }
  try {
    const file = join(userDataPath, "home", ".config", "opencode", "skills", "notes", "SKILL.md")
    const hook = sidecarNativeSources(Promise.resolve())
    expect(await hook({ directory: join(userDataPath, "project"), sources: [{ file, kind: "skill", entry: "notes", active: false }] })).toEqual([{ file, kind: "skill", entry: "notes", desiredState: "disabled", removed: false }])
    const ledger = JSON.parse(readFileSync(join(codepuppyGlobalRoot(), "installs.json"), "utf8")) as { nativeSources: unknown[] }
    expect(ledger.nativeSources).toEqual([{ file, kind: "skill", entry: "notes", desiredState: "disabled", removed: false }])
    expect(bridge.nativeStates()).toEqual(ledger.nativeSources)
    // ext 还没装上(进程级对象不在) ⇒ 钩子答 undefined,闸门沿用上一代
    holder[slot] = undefined
    expect(await hook({ directory: join(userDataPath, "project"), sources: [] })).toBeUndefined()
  } finally {
    holder[slot] = previous
    __resetCodePuppyEnvironmentForTests()
  }
})
