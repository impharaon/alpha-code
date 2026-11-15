// `#1697` 放回单元 2。来源:打包回归第七轮 r7-s5-shell-card.png / r7-b126-shell-card.png。
// 不手造引擎请求:沙箱真引擎 + 生产注入 + 真 ext 执行本地模型给的 shell / patch 调用,读取实际审批。
// 界面 v1 SDK → 生产 createEngineFetch → GET /permission 与 /global/event → 冻结 adaptPermissionV1Request
// → 真 PermissionDialog DOM。patch 的能力动作由引擎实际给出,不用工具名猜审批动作。
import { afterAll, beforeAll, expect, test } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import appPlugin from "@opencode-ai/app/vite"
import type { PermissionRequest } from "@opencode/client/promise"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import { build } from "vite"
import { adaptPermissionV1Request } from "../../../codepuppy-app/src/context/permission-v1-adapter"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { createOpencodeClient } from "./contract/v1"
import { createEngineFetch } from "./index"
import { toV1PermissionRequest } from "./opencode2/v1-shapes"

const sandbox = engineSandbox()
const model = scriptedModel()
const ASK = "codepuppy-ask"
const MODEL = "gpt-5-mock" // 引擎只向 gpt- 模型提供 patch,同现有采样器 tools 剧本。
const runtimeDirectory = mkdtempSync(join(tmpdir(), "cp-command-approval-render-"))
const abort = new AbortController()
const asked = new Map<string, ReturnType<typeof toV1PermissionRequest>>()
const settled = new Set<string>()
let host: ReturnType<typeof codepuppyEngine>
let running: Running
let client: ReturnType<typeof createOpencodeClient>

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  host = codepuppyEngine({ sandbox, name: "command-approval", modelBaseURL: model.baseURL, platformModels: { [MODEL]: { name: MODEL } } })
  running = await host.start()
  const origin = new URL(running.url).origin
  const engineFetch = createEngineFetch({
    isEngineOrigin: (candidate) => candidate === origin,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      request.headers.set("authorization", running.authorization)
      return fetch(request)
    }) as typeof fetch,
  })
  client = createOpencodeClient({ baseUrl: origin, fetch: engineFetch as typeof fetch, directory: host.projectDirectory, throwOnError: true })
  const { stream } = await client.global.event({ signal: abort.signal })
  void (async () => {
    try {
      for await (const event of stream) {
        if (event.payload.type === "permission.asked") asked.set(event.payload.properties.sessionID, event.payload.properties)
        if (event.payload.type === "session.idle") settled.add(event.payload.properties.sessionID)
      }
    } catch (error) {
      if (!abort.signal.aborted) throw error
    }
  })()

  // 复用审批面的既有渲染入口,用相同 Vite/Solid 编译器,不改组件与文案。
  await build({
    configFile: false,
    logLevel: "silent",
    plugins: [appPlugin.at(-1)!],
    build: {
      emptyOutDir: true,
      outDir: runtimeDirectory,
      lib: { entry: join(import.meta.dir, "../renderer/codepuppy-ui/permission-test-runtime.ts"), formats: ["es"], fileName: () => "runtime.js" },
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  })
}, 60_000)

afterAll(async () => {
  abort.abort()
  await running?.close()
  model.stop()
  rmSync(runtimeDirectory, { recursive: true, force: true })
})

test.each([
  {
    tool: "shell",
    args: { command: "echo approval-card" },
    action: "shell",
    verb: "运行命令",
    remembered: "将记住:以 echo 开头的命令",
    resource: "echo approval-card",
  },
  {
    tool: "patch",
    args: { patchText: "*** Begin Patch\n*** Add File: patch-card.txt\n+hello\n*** End Patch" },
    action: "edit",
    verb: "改文件",
    remembered: "将记住:本会话内的所有文件修改",
    resource: "patch-card.txt",
  },
])("$tool:真实审批的列表与事件一致,卡片显示专用标题与可记住的范围", async (scenario) => {
  const created = await client.session.create({})
  const sessionID = created.data!.id
  await client.session.promptAsync({
    sessionID,
    agent: ASK,
    model: { providerID: "codepuppy", modelID: MODEL },
    parts: [{ type: "text", text: `CP-CALL ${JSON.stringify({ name: scenario.tool, args: scenario.args })}` }],
  })
  let pending: PermissionRequest | undefined
  let dispose: (() => void) | undefined
  try {
    for (const end = Date.now() + 10_000; Date.now() < end && (!pending || !asked.has(sessionID)); await Bun.sleep(20)) {
      const response = await running.send("GET", `/api/session/${sessionID}/permission`)
      expect(response.status).toBe(200)
      pending = (response.json.data as PermissionRequest[]).find((request) => request.metadata?.policy === undefined)
    }
    expect(pending?.action).toBe(scenario.action)
    expect(asked.has(sessionID)).toBe(true)
    const listed = (await client.permission.list()).data!.find((request) => request.id === pending!.id)!
    expect(listed).toEqual(asked.get(sessionID)!)
    expect(listed.metadata).toEqual(pending!.metadata ?? {})
    expect(listed.patterns).toContain(scenario.resource)

    // 从真实能力请求派生身份轴对照,canonical 及 metadata 不得被能力动作的换名改掉(I7a)。
    const policy = { ...pending!, action: scenario.tool, metadata: { ...pending!.metadata, policy: { canonical: scenario.tool, askedBy: "policy" } } }
    expect(toV1PermissionRequest(policy).permission).toBe(scenario.tool)
    expect(toV1PermissionRequest(policy).metadata).toEqual(policy.metadata)

    // 引擎先跑到审批暂停,再挂载 DOM;退出 DOM 后才回复,不让 DOM 的网络/时钟实现介入引擎执行。
    GlobalRegistrator.register()
    const runtime = await import(pathToFileURL(join(runtimeDirectory, "runtime.js")).href) as typeof import("../renderer/codepuppy-ui/permission-test-runtime")
    const root = document.createElement("div")
    document.body.append(root)
    dispose = runtime.render(() => runtime.createComponent(runtime.PermissionDialog, {
      request: adaptPermissionV1Request(listed, ASK),
      projectID: "prj_command_approval",
      onSubmit: async () => { throw new Error("卡片不得在展示时自动回复") },
      saveToolPolicy: async () => ({ ok: true }),
      signedIn: () => false,
    }), root)
    await Bun.sleep(0)
    expect({
      verb: document.querySelector('[data-permission-fact="action"] .a-permission-verb')?.textContent,
      remembered: document.querySelector('[data-permission-remember] b')?.textContent,
    }).toEqual({ verb: scenario.verb, remembered: scenario.remembered })
    expect(document.querySelector('[data-permission-remember]')?.textContent).not.toContain("*")
  } finally {
    dispose?.()
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister()
    if (pending) await running.send("POST", `/api/session/${sessionID}/permission/${pending.id}/reply`, { decision: "reject" })
    if (!pending) await client.session.abort({ sessionID })
    await running.send("POST", `/api/experimental/session/${sessionID}/wait`)
    // 等该回合的投影收尾再退订,避免测试清理中止尚在处理的快照读取。
    for (const end = Date.now() + 3000; !settled.has(sessionID) && Date.now() < end; await Bun.sleep(10)) {}
  }
}, 30_000)
