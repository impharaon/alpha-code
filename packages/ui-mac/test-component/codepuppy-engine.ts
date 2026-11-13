// `#1662` parity:几份 `*.engine.cases.ts` 共用的宿主 —— 嵌进 sidecar 的那台 OpenCode 2,配置是生产 `injectCodePuppyConfig` 的产物
// (内联文档 + 显式文件,原样交给 `start()`),装着真 ext(`packages/ext/src/plugin.ts`,以本地目录插件装,与 sidecar 同一个入口形状)、
// 一个探针插件(拿到插件上下文、注册两个插件工具)与一个本机 OpenAI 兼容模型桩(平台节点经 `CODEPUPPY_BASE_URL` 指向它)。
// 调用方必须先 `engineSandbox()` 并在 beforeAll 里 `assertEngineSandboxed()`;本模块不碰沙箱之外的任何目录。
import fs from "node:fs"
import path from "node:path"
import { engineSlot, type EngineSandbox } from "./engine-sandbox"
import { buildEngineServerOptions } from "../src/main/engine-server-options"
import { engineAuthorization, withEngineAuthorization } from "../src/main/engine-authorization"
import { injectCodePuppyConfig } from "../src/main/codepuppy-config-injection"
import { secretFilePath, secretFileRef } from "../src/main/codepuppy-secret-files"
import { buildHubRequestReply, buildHubViewReply } from "../src/main/codepuppy-sidecar-messages"
import type { EngineFetch } from "../src/main/in-process-engine"

/** 真 stdio MCP 服务器(#1563 的夹具):列一个 `echo`,`CODEPUPPY_MCP_CALL_LOG` 记下每次 tools/call。 */
export const MCP_FIXTURE = path.resolve(import.meta.dir, "../../core/test/fixture/codepuppy-mcp-startup-stdio.ts")
export const PROBE_TOOLS = ["cp_probe", "cp_disabled"] as const

export type ModelRequest = { tools: string[]; messages: Array<{ role: string; content?: unknown }> }
export const textOf = (content: unknown) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((part: { text?: string }) => part?.text ?? "").join("") : ""

/**
 * 模型桩。用户回合里写 `CP-CALL {"name":…,"args":…}` ⇒ 回一次那个工具调用;上一条是工具结果 ⇒ 回「done」;其余回「ok」。
 * 引擎的压缩请求 ⇒ 回一份按模板标题写的摘要。
 * 用户回合里写 `CP-OVERFLOW-ONCE` ⇒ 第一次这样的请求回 HTTP 400 `context_length_exceeded`(引擎认作上下文过长),之后照常。
 * 每次请求的工具表与消息都记在 `requests` 里。
 */
export function scriptedModel() {
  const requests: ModelRequest[] = []
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    `data: ${JSON.stringify({ id: "chatcmpl-cp-engine", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  const text = (value: string) => chunk({ role: "assistant", content: value }) + chunk({}, "stop") + "data: [DONE]\n\n"
  let calls = 0
  let overflowed = false
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (!request.url.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
      const body = (await request.json()) as { messages?: ModelRequest["messages"]; tools?: Array<{ function?: { name?: string } }> }
      const messages = body.messages ?? []
      requests.push({ tools: (body.tools ?? []).map((tool) => String(tool.function?.name)), messages })
      const headers = { "content-type": "text/event-stream" }
      if (messages.at(-1)?.role === "tool") return new Response(text("done"), { headers })
      const lastUser = textOf(messages.filter((message) => message.role === "user").at(-1)?.content)
      if (lastUser.includes("CP-OVERFLOW-ONCE") && !overflowed) {
        overflowed = true
        return Response.json(
          { error: { message: "This model's maximum context length is 8192 tokens.", type: "invalid_request_error", code: "context_length_exceeded" } },
          { status: 400 },
        )
      }
      // 引擎的压缩请求(core session/compaction.ts 的 SUMMARY_TEMPLATE):按模板的标题回一份摘要,否则压缩判失败
      if (lastUser.includes("<template>") && lastUser.includes("## Objective"))
        return new Response(text("## Objective\n- continue the user's work\n\n## Next Move\n1. (none)"), { headers })
      const marker = lastUser.match(/CP-CALL (\{.*\})/)
      if (!marker) return new Response(text("ok"), { headers })
      const call = JSON.parse(marker[1]!) as { name: string; args: Record<string, unknown> }
      const id = `call_cp_engine_${++calls}`
      return new Response(
        chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] }) +
          chunk({}, "tool_calls") +
          "data: [DONE]\n\n",
        { headers },
      )
    },
  })
  return { baseURL: `http://127.0.0.1:${server.port}/v1`, requests, stop: () => server.stop(true) }
}

export type Probe = { ctx: any; runs: Record<string, number> }
const PROBE_KEY = "__cpEngineProbe"
/** 探针插件的状态(插件上下文 + 两个插件工具各被执行了几次);引擎在测试进程里,同一个 globalThis。 */
export const probe = () => (globalThis as Record<string, unknown>)[PROBE_KEY] as Probe

/** 定制中心安装要问 main 要目录视图:main 由一个假 parentPort 扮演(ext 在装载时取它,同 packages/ext/src/plugin-host.test.ts)。 */
function fakeMainPort() {
  const holder = process as unknown as { parentPort?: unknown }
  if (holder.parentPort) return
  const listeners: Array<(event: { data: unknown }) => void> = []
  const row = { id: "mcp:github", scope: null, name: "github", kind: "mcp", displayName: "GitHub", description: "repos", installed: false, enabled: false, state: "not-installed", authorization: "none" }
  holder.parentPort = {
    postMessage: (message: { type: string; id: number; directory?: string }) =>
      queueMicrotask(() => {
        const reply =
          message.type === "codepuppy.hub.view.request"
            ? buildHubViewReply(message.id, { view: { directory: message.directory ?? "", rows: [row as never], warnings: [] } })
            : message.type === "codepuppy.hub.request.request"
              ? buildHubRequestReply(message.id, { record: null })
              : undefined
        if (reply) for (const listener of listeners) listener({ data: reply })
      }),
    on: (_event: string, listener: (event: { data: unknown }) => void) => void listeners.push(listener),
  }
}

export type HostOptions = {
  sandbox: EngineSandbox
  name: string
  modelBaseURL: string
  /** 用户在 Code Puppy 里加的本地 MCP(codepuppy.jsonc 里的 `probe`,引擎经显式文件读它),每次 tools/call 记进这个文件。 */
  mcpCallLog?: string
  /** 项目目录里的文件(相对路径 → 内容),例如 `opencode.json`。 */
  projectFiles?: Record<string, string>
  /** 引擎的库文件(默认按 engineSlot 分配);升级迁移要让 main 改写的库与引擎打开的库是同一个文件。 */
  databasePath?: string
  /** 平台节点的模型表(默认只有一个 `m`;`null` = 用注入从已应用目录算出的那份,不改)。 */
  platformModels?: Record<string, unknown> | null
  /** false ⇒ 注入时不给 ext 目录(反向臂:同一份配置去掉 ext)。默认装。 */
  ext?: boolean
  /** 引擎的文件监听(生产默认开;默认这里关,要判「不重启就生效」时打开)。 */
  filewatcher?: boolean
}

export type Running = {
  send: (method: string, route: string, body?: unknown) => Promise<{ status: number; json: any }>
  /** 引擎的原始分发(口令已补上,同生产 main 的 onBeforeSendHeaders):生产引擎适配器(engine-adapter createEngineFetch)接在它上面。 */
  fetch: EngineFetch
  /** 引擎真监听的源地址(`http://127.0.0.1:<port>`):renderer 直连的就是它(I8),要测连接数的用它。 */
  url: string
  /** main 在 `onBeforeSendHeaders` 里给 renderer 发往引擎源的请求补的那个 `Authorization` 值。 */
  authorization: string
  close: () => Promise<void>
}

/** 准备一台 Code Puppy 的嵌入式引擎;`start()` 可以在同一个库与配置上起多次(停掉之后再起 = 重启)。 */
export function codepuppyEngine(options: HostOptions) {
  const { sandbox, name } = options
  const userData = path.join(sandbox.root, `${name}-userdata`)
  process.env.CODEPUPPY_GLOBAL_DIR = path.join(sandbox.root, `${name}-state`, "codepuppy-state", "env", "dev")
  fs.mkdirSync(process.env.CODEPUPPY_GLOBAL_DIR, { recursive: true })
  const key = secretFilePath(userData, "CODEPUPPY_API_KEY")
  fs.mkdirSync(path.dirname(key), { recursive: true })
  fs.writeFileSync(key, `sk-cp-${name}`, { mode: 0o600 })
  // sidecar 在 fork 时置的两样:平台节点地址(这里指向模型桩)与平台凭据的 {file:} 引用(ext 的请求头每次现读它)
  process.env.CODEPUPPY_BASE_URL = options.modelBaseURL
  process.env.CODEPUPPY_PLATFORM_AUTH_REF = secretFileRef(userData, "CODEPUPPY_API_KEY")
  process.env.CODEPUPPY_POLICY_ACCOUNT = `t-${name}-${Math.random().toString(36).slice(2)}`
  if (options.mcpCallLog)
    fs.writeFileSync(
      path.join(process.env.CODEPUPPY_GLOBAL_DIR, "codepuppy.jsonc"),
      JSON.stringify({ mcp: { probe: { type: "local", command: [process.execPath, MCP_FIXTURE], environment: { CODEPUPPY_MCP_CALL_LOG: options.mcpCallLog } } } }),
    )
  fakeMainPort()

  // 真 ext:2.x 只装目录形式的本地插件,入口 server.js 的 default 导出(packages/core/src/plugin/module.ts)
  const ext = path.join(sandbox.root, `${name}-ext`)
  fs.mkdirSync(ext, { recursive: true })
  fs.writeFileSync(path.join(ext, "server.js"), `export { default } from ${JSON.stringify(path.resolve(import.meta.dir, "../../ext/src/plugin.ts"))}\n`)
  const probeDir = path.join(sandbox.root, `${name}-probe`)
  fs.mkdirSync(probeDir, { recursive: true })
  fs.writeFileSync(
    path.join(probeDir, "server.js"),
    `export default { id: "codepuppy.test.engine-probe", setup: async (ctx) => {
  const state = { ctx, runs: ${JSON.stringify(Object.fromEntries(PROBE_TOOLS.map((tool) => [tool, 0])))} }
  globalThis.${PROBE_KEY} = state
  await ctx.tool.transform((editor) => {
    for (const name of ${JSON.stringify(PROBE_TOOLS)})
      editor.add({ name, description: name, input: { type: "object", properties: {} }, options: { codemode: false },
        execute: async () => { state.runs[name] += 1; return { content: name + " ran" } } })
  })
} }\n`,
  )

  const withExt = options.ext !== false
  const injection = injectCodePuppyConfig(userData, withExt ? ext : undefined, "stable")
  const content = JSON.parse(injection.config.content) as { plugins: string[]; providers: Record<string, { models?: Record<string, unknown> }> }
  content.plugins = [...content.plugins, probeDir]
  // 沙箱里没有已应用的平台目录,平台节点的模型表是空的(`#1556`);补一个模型只为能发出请求
  if (options.platformModels !== null) content.providers.codepuppy!.models = options.platformModels ?? { m: { name: "m" } }

  const slot = { ...engineSlot(sandbox, name), ...(options.databasePath ? { databasePath: options.databasePath } : {}) }
  for (const [file, body] of Object.entries(options.projectFiles ?? {})) fs.writeFileSync(path.join(slot.projectDirectory, file), body)

  const start = async (): Promise<Running> => {
    const { startEngine } = await import("../engine/engine-embed")
    let fetch: EngineFetch | undefined
    const password = `cp-${name}`
    const engine = await startEngine(
      buildEngineServerOptions({
        hostname: "127.0.0.1",
        port: 0,
        password,
        engineVersion: "test",
        databasePath: slot.databasePath,
        configDirectory: slot.configDirectory,
        config: { content: JSON.stringify(content), file: injection.config.file },
        models: { ...(injection.models.file ? { file: injection.models.file } : {}), fetch: false },
        filewatcher: options.filewatcher ?? false,
        platform: process.platform,
      }),
      { onDispatch: (dispatch) => (fetch = withEngineAuthorization(dispatch, password)) },
    )
    const send = async (method: string, route: string, body?: unknown) => {
      const response = await fetch!(
        new Request(`http://codepuppy-sidecar.invalid${route}`, {
          method,
          headers: { "x-opencode-directory": encodeURIComponent(slot.projectDirectory), "content-type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      )
      const raw = await response.text()
      return { status: response.status, json: raw ? JSON.parse(raw) : undefined }
    }
    // Location 在第一次带目录的请求时才起,插件随之装载:轮询到 ext 与探针都装上
    const status = async (id: string) =>
      (((await send("GET", "/api/plugin")).json?.data ?? []) as Array<{ id: string; state: { status: string } }>).find((plugin) => plugin.id === id)?.state.status
    const ready = async () => (!withExt || (await status("codepuppy.ext")) === "active") && (await status("codepuppy.test.engine-probe")) === "active"
    for (let i = 0; i < 200 && !(await ready()); i++) await Bun.sleep(50)
    if (withExt && (await status("codepuppy.ext")) !== "active") throw new Error("the real ext is not active in the embedded engine")
    return {
      send,
      fetch: (request) => fetch!(request),
      url: engine.url,
      authorization: engineAuthorization(password),
      close: () => engine.close(),
    }
  }
  return { start, slot, projectDirectory: slot.projectDirectory, userData, injection, content }
}

/** ext 的策略存储(数据根 / 账户 / 工作区与 registerPolicy 同一套);ext 模块在沙箱就位之后才装载。 */
export async function policyStore() {
  const { createToolPolicyStore, defaultPolicyBaseDir } = await import("../../ext/src/policy/resolver")
  const { policyWorkspace } = await import("../../ext/src/policy/index")
  return createToolPolicyStore({
    baseDir: defaultPolicyBaseDir(path.join(process.env.XDG_DATA_HOME!, "opencode")),
    account: () => process.env.CODEPUPPY_POLICY_ACCOUNT!,
    workspace: () => policyWorkspace(probe().ctx.location),
  })
}
