// #1699 AC-01/02/07 红回归:从生产自动化入口进入沙箱真引擎,审批事件一旦出现就由测试拒掉,
// 以便立即报告缺失行为而不等 300 秒。模型/MCP 报文由既有真实宿主和 SDK 产生。
import { afterAll, beforeAll, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, policyStore, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import type { AutomationTask } from "../shared/automation-types"
import type { CodePuppySidecarHost } from "./hub-view"

const sandbox = engineSandbox()
mock.module("electron", () => ({
  app: { isPackaged: false, getPath: (name: string) => join(sandbox.root, name), getVersion: () => "0.0.0-test" },
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class { show() {} },
  powerMonitor: { on: () => {} },
  safeStorage: { isEncryptionAvailable: () => false },
}))
mock.module("./logging", () => ({
  getLogger: () => ({ log: () => {}, warn: () => {}, error: () => {} }),
  write: () => {},
  rotateServerLogs: () => {},
}))
mock.module("./codepuppy-user-workspace", () => ({ saveVisibleOutputs: () => {} }))

const { createCodePuppySidecarHost, createHubRequestStages } = await import("./hub-view")
const { createReloadCoordinator } = await import("./reload-coordinator")
const { engineClient } = await import("./engine-client")
const { saveAutomation, getAutomation } = await import("./codepuppy-automations")
const { startAutomationScheduler, runAutomationNow } = await import("./automation-scheduler")
const { initAutomationLlm, llmParseAutomation } = await import("./automation-llm")
const listeners: Array<(event: { data: unknown }) => void> = []
let mainHost: CodePuppySidecarHost
const post = (data: unknown) => listeners.forEach((listener) => listener({ data }))
// 唯一替代的是 Electron 的进程传输,两侧仍用生产 host/bridge 与生产消息解析器。
;(process as unknown as { parentPort: unknown }).parentPort = {
  on: (_event: string, listener: (event: { data: unknown }) => void) => listeners.push(listener),
  postMessage: (data: unknown) => mainHost.receive(data, post),
}
const model = scriptedModel()
const callLog = join(sandbox.root, "unattended-mcp-calls.log")
let running: Running
let directory = ""
let client: ReturnType<typeof engineClient>
let store: Awaited<ReturnType<typeof policyStore>>
let detach: (reason: string) => void

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  mainHost = createCodePuppySidecarHost({
    view: { view: async () => ({ directory, rows: [], warnings: [] }), viewForAgent: async () => ({ directory, rows: [], warnings: [] }) },
    requests: createHubRequestStages({ log: () => {} }),
    reloads: createReloadCoordinator({ log: () => {}, onChange: () => {} }),
    log: () => {},
  })
  const host = codepuppyEngine({ sandbox, name: "unattended", modelBaseURL: model.baseURL, mcpCallLog: callLog })
  Object.assign(host.content, { model: "codepuppy/m" })
  directory = host.projectDirectory
  running = await host.start()
  detach = mainHost.attach(post)
  client = engineClient({ url: running.url, username: "opencode", password: "cp-unattended" })
  store = await policyStore()
  const awaitServer = async () => ({ url: running.url, username: "opencode", password: "cp-unattended" })
  startAutomationScheduler({ awaitServer })
  initAutomationLlm({ awaitServer })
}, 60_000)

afterAll(async () => {
  detach?.("test complete")
  await running?.close()
  model.stop()
})

const echo = `CP-CALL ${JSON.stringify({ name: "execute", args: { code: 'return await tools.probe.echo({text: "unattended-proof"})' } })}`

function task(id: string): AutomationTask {
  return {
    id, name: "无人值守证据", nlText: echo, prompt: echo,
    schedule: { kind: "interval", everyMinutes: 60 },
    target: { projectDir: directory, agent: "codepuppy-automation-standard", model: "codepuppy/m" },
    permissionProfile: "standard", execution: "local", budget: { maxDurationMin: 1 },
    overlapPolicy: "skip", catchUpPolicy: "skip", notify: { system: false }, enabled: false,
    createdAt: new Date().toISOString(),
  }
}

async function withoutApproval<T>(run: () => Promise<T>) {
  const controller = new AbortController()
  const ready = Promise.withResolvers<void>()
  const asked: string[] = []
  const reader = (async () => {
    for await (const event of client.event.subscribe({ types: ["permission.asked"], signal: controller.signal })) {
      if (event.type === "server.connected") { ready.resolve(); continue }
      asked.push(event.data.action)
      await client.permission.reply({ sessionID: event.data.sessionID, requestID: event.data.id, decision: "reject" })
    }
  })()
  await ready.promise
  try {
    const result = await run()
    expect(asked, "无人值守入口创建了没人会点击的审批请求").toEqual([])
    return result
  } finally {
    controller.abort()
    await reader
  }
}

test("AC-01 标准档默认询问的连接器成功写入运行记录,零 Asked", async () => {
  await store.removeRecord({ level: "tool", canonical: "mcp:probe:echo" })
  expect(saveAutomation(task("unattended-default")).ok).toBe(true)
  await withoutApproval(() => runAutomationNow("unattended-default"))
  const record = getAutomation("unattended-default")!.lastRun!
  expect(record.status).toBe("ok")
  expect(JSON.parse(readFileSync(join(record.runDir!, "status.json"), "utf8")).status).toBe("ok")
  expect(readFileSync(join(record.runDir!, "report.md"), "utf8")).toContain("done")
  expect(readFileSync(callLog, "utf8")).toContain("echo\n")
}, 60_000)

test("AC-02 每次询问的同一连接器在自动化里成功,零 Asked", async () => {
  await store.setRecord({ selector: { level: "tool", canonical: "mcp:probe:echo" }, state: "ask" })
  expect(saveAutomation(task("unattended-ask")).ok).toBe(true)
  await withoutApproval(() => runAutomationNow("unattended-ask"))
  expect(getAutomation("unattended-ask")!.lastRun!.status).toBe("ok")
}, 60_000)

test("AC-07 一句话解析需要批准时立即拒绝且明确返回,零 Asked", async () => {
  await store.setRecord({ selector: { level: "tool", canonical: "mcp:probe:echo" }, state: "ask" })
  const result = await withoutApproval(() => llmParseAutomation(`每天运行 ${echo}`, directory))
  expect(typeof result.ok).toBe("boolean")
}, 60_000)
