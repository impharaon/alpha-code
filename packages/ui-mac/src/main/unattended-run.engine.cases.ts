// #1699 AC-01/02/07 红回归:从生产自动化入口进入沙箱真引擎,审批事件一旦出现就由测试拒掉,
// 以便立即报告缺失行为而不等 300 秒。模型/MCP 报文由既有真实宿主和 SDK 产生。
import { afterAll, beforeAll, expect, mock, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, policyStore, probe, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import type { Context } from "@opencode/plugin/promise/plugin"
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

test("AC-03 只读拒绝后模型正常收尾,运行仍记失败且保留报告", async () => {
  await store.removeRecord({ level: "tool", canonical: "mcp:probe:echo" })
  const job = task("unattended-readonly")
  job.target.agent = "codepuppy-automation"
  job.permissionProfile = "readonly"
  expect(saveAutomation(job).ok).toBe(true)
  await withoutApproval(() => runAutomationNow(job.id))
  const record = getAutomation(job.id)!.lastRun!
  expect(record.status).toBe("failed")
  expect(record.summary).toBe("这个任务是只读档,不能使用「echo」。")
  expect(JSON.parse(readFileSync(join(record.runDir!, "status.json"), "utf8")).error).toBe(record.summary)
  expect(readFileSync(join(record.runDir!, "report.md"), "utf8")).toContain("done")
}, 60_000)

test("AC-08 来源变化拒绝经过 Code Mode 外层成功终态进入运行记录", async () => {
  // 合法旧绑定摘要与当前真实 MCP 定义不同;格式由生产 store/schema 校验。
  await store.setRecord({ selector: { level: "tool", canonical: "mcp:probe:echo" }, state: "enabled", bindingDigest: `sha256:${"0".repeat(64)}` })
  const before = readFileSync(callLog, "utf8")
  expect(saveAutomation(task("unattended-binding")).ok).toBe(true)
  await withoutApproval(() => runAutomationNow("unattended-binding"))
  const record = getAutomation("unattended-binding")!.lastRun!
  expect(record.status).toBe("failed")
  expect(record.summary).toContain("「echo」需要你先确认")
  expect(record.summary).toContain("到 设置 → 工具 处理后")
  expect(readFileSync(callLog, "utf8")).toBe(before)
}, 60_000)

test("AC-04 敏感文件、子任务、项目外目录维持拒绝并写入原因", async () => {
  await store.removeRecord({ level: "tool", canonical: "mcp:probe:echo" })
  writeFileSync(join(directory, ".env"), "TEST_SENTINEL=not-a-secret\n")
  writeFileSync(join(sandbox.root, "outside.txt"), "outside sentinel\n")
  // 模型清单平时已隐藏整个 subagent。让真实工具到达其体内的原始 subagent 断言,
  // 只改这台测试引擎的清单筛选动作名,不改自动化 agent 的 deny 或真实工具实现。
  const context: Context = probe().ctx
  await context.tool.transform((editor) => editor.update("subagent", (tool) => {
    tool.options = { ...tool.options, permission: "unattended_subagent_probe" }
  }))
  const cases = [
    { id: "env", name: "read", args: { path: ".env" } },
    { id: "subagent", name: "subagent", args: { agent: "general", description: "probe", prompt: "probe" } },
    { id: "outside", name: "read", args: { path: join(sandbox.root, "outside.txt") } },
  ]
  for (const item of cases) {
    const job = task(`unattended-${item.id}`)
    job.prompt = `CP-CALL ${JSON.stringify({ name: item.name, args: item.args })}`
    expect(saveAutomation(job).ok).toBe(true)
    await withoutApproval(() => runAutomationNow(job.id))
    const record = getAutomation(job.id)!.lastRun!
    expect(record.status).toBe("failed")
    expect(record.summary).toBe(`自动化任务不能使用「${item.name}」做这一步。`)
    expect(JSON.parse(readFileSync(join(record.runDir!, "status.json"), "utf8")).error).toBe(record.summary)
  }
}, 60_000)

test("AC-06 未登记的询问档对同一工具出卡,人工答复后才执行", async () => {
  await store.setRecord({ selector: { level: "tool", canonical: "mcp:probe:echo" }, state: "ask" })
  const owner = await client.session.create({ location: { directory }, agent: "codepuppy-ask", model: { id: "m", providerID: "codepuppy" }, metadata: { unattended: true } })
  const controller = new AbortController()
  const connected = Promise.withResolvers<void>()
  const asked = Promise.withResolvers<{ id: string; sessionID: string }>()
  const reader = (async () => {
    for await (const event of client.event.subscribe({ types: ["permission.asked"], signal: controller.signal })) {
      if (event.type === "server.connected") connected.resolve()
      if (event.type === "permission.asked" && event.data.sessionID === owner.id) asked.resolve(event.data)
    }
  })()
  await connected.promise
  const before = readFileSync(callLog, "utf8")
  try {
    await client.session.prompt({ sessionID: owner.id, text: echo })
    const request = await asked.promise
    expect((await client.permission.list({ sessionID: owner.id })).map((item) => item.id)).toContain(request.id)
    expect(readFileSync(callLog, "utf8")).toBe(before)
    await client.permission.reply({ sessionID: owner.id, requestID: request.id, decision: "once" })
    await client.experimental.session.wait({ sessionID: owner.id })
    expect(readFileSync(callLog, "utf8")).toBe(`${before}echo\n`)
  } finally {
    controller.abort()
    await reader
  }
}, 60_000)

test("U-3 直接工具的 Tool.Error metadata 落到消息并投影", async () => {
  const job = task("unattended-direct")
  job.target.agent = "codepuppy-automation"
  job.permissionProfile = "readonly"
  job.prompt = `CP-CALL ${JSON.stringify({ name: "cp_probe", args: {} })}`
  const before = probe().runs.cp_probe
  expect(saveAutomation(job).ok).toBe(true)
  await withoutApproval(() => runAutomationNow(job.id))
  const record = getAutomation(job.id)!.lastRun!
  expect(record.status).toBe("failed")
  expect(record.summary).toBe("这个任务是只读档,不能使用「cp_probe」。")
  expect(probe().runs.cp_probe).toBe(before)
  const page = await client.message.list({ sessionID: record.sessionID!, order: "asc" })
  const tools = page.data.flatMap((message) => message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [])
  expect(tools[0]?.state).toMatchObject({ status: "error", metadata: { codepuppyUnattendedDenial: { reason: "readonly", tool: "cp_probe" } } })
}, 60_000)

test("投影夹具从上述真实运行消息导出,标注生产源码摘要", async () => {
  const examples = []
  for (const scenario of ["default", "ask", "readonly", "binding", "env", "subagent", "outside", "direct"]) {
    const record = getAutomation(`unattended-${scenario}`)?.lastRun
    if (!record) continue
    const messages = await client.message.list({ sessionID: record.sessionID!, order: "asc", limit: 200 })
    const emptyPage = await client.message.list({ sessionID: record.sessionID!, cursor: messages.cursor.next! })
    examples.push({ scenario, messages: messages.data.filter((message) => message.type === "assistant" || message.type === "idle"), cursor: messages.cursor, emptyPage })
  }
  const sources = ["packages/ext/src/policy/gate.ts", "packages/ext/src/policy/index.ts", "packages/ext/src/policy/display.ts", "packages/ui-mac/src/main/automation-scheduler.ts"]
  const sourceHashes = Object.fromEntries(sources.map((file) => [file, createHash("sha256").update(readFileSync(join(import.meta.dir, "../../../..", file))).digest("hex")]))
  // 由宿主输出捕获;沙箱退出会清理目录,不让测试改写仓内夹具。
  console.info(`1699_MESSAGE_FIXTURE=${JSON.stringify({ provenance: { command: "cd packages/ui-mac && bun test ./src/main/unattended-run.engine.cases.ts", selection: "真实消息中的 assistant 与 idle", sourceHashes }, examples })}`)
  expect(examples).toHaveLength(8)
})
