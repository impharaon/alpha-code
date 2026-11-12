// INT-upstream-upgrade-readiness I-03 — the real OpenCode 2 engine the upstream-behaviour probes run against.
//
// Not a stand-in: the engine is booted through Code Puppy's production embedding (packages/ui-mac/engine/engine-embed.ts
// `startEngine`, options from packages/ui-mac/src/main/engine-server-options.ts, the password wrapper from
// engine-authorization.ts) and every request goes through its in-process dispatch app, as the sidecar does. The model
// behind it is the scripted OpenAI-compatible mock the adapter fixtures were sampled with
// (packages/ui-mac/test-fixtures/engine-adapter-sampler/mock-model.ts), behind a local proxy that answers HTTP 400 to
// a prompt containing FAIL_PROMPT. Every engine also loads a recorder package plugin (a directory plugin, the only
// form 2.x loads) that records what plugins see: the four request hooks ext uses (`context`, `compaction`,
// `generate`, `title`, with the request messages) and `model.request` — read them with `hookCalls()`.
//
// Isolation: the shared test preload (scripts/test-isolation/preload.ts, via packages/ext/bunfig.toml) already points HOME / XDG_* / TMPDIR / OPENCODE_DB at a fresh temp root
// before any file loads. `startProbeEngine` first proves, with the engine's own `Global.Path`, that the engine's
// directories are inside that root (`assertEngineSandboxed`) and refuses to boot otherwise — so a probe can never
// touch the owner's ~/.local/share/opencode.
//
// `.cases.ts`: a helper, not a test entry; outside the ext typecheck program and the ui-mac write-site scan.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { TEST_ROOT_KEY } from "../../../../scripts/test-isolation/env"
import { assertEngineSandboxed } from "../../../ui-mac/test-component/engine-sandbox"
import { startEngine } from "../../../ui-mac/engine/engine-embed"
import { buildEngineServerOptions, engineDesktopToggles } from "../../../ui-mac/src/main/engine-server-options"
import { withEngineAuthorization } from "../../../ui-mac/src/main/engine-authorization"
import { startMockModel } from "../../../ui-mac/test-fixtures/engine-adapter-sampler/mock-model"

/** A prompt containing this gets HTTP 400 from the model proxy (a non-retryable provider failure). */
export const FAIL_PROMPT = "probe-fail-400"

export type Frame = { type: string; data?: any }
/** One plugin hook invocation seen by the recorder plugin. */
export type HookCall = { hook: string; sessionID?: string; messages?: Array<{ role: string; content: unknown }> }

/** The recorder plugin's id: it is a package plugin, so it activates between upstream's pre and post plugins. */
export const RECORDER_PLUGIN_ID = "codepuppy.upstream-probe.recorder"
const RECORDER_KEY = Symbol.for(RECORDER_PLUGIN_ID)
const REQUEST_HOOKS = ["context", "compaction", "generate", "title"]
type Json = Record<string, unknown>

/** Polls `read` until it returns a value other than undefined / false, or throws naming `what` after `ms`. */
export async function until<T>(what: string, read: () => T | Promise<T>, ms = 15_000): Promise<Exclude<T, undefined | false>> {
  const deadline = Date.now() + ms
  for (;;) {
    const value = await read()
    if (value !== undefined && value !== false) return value as Exclude<T, undefined | false>
    if (Date.now() > deadline) throw new Error(`timed out after ${ms} ms waiting for: ${what}`)
    await Bun.sleep(50)
  }
}

let counter = 0

/**
 * Boots one engine. `global` is the global config directory's opencode.json (merged over the mock provider),
 * `explicit` the `config.file` document, `content` the inline document — the three slots Code Puppy's main process
 * fills in production. Projects are created on demand with `project()`.
 */
export async function startProbeEngine(options: { global?: Json; explicit?: Json; content?: Json } = {}) {
  const testRoot = process.env[TEST_ROOT_KEY]
  if (!testRoot) throw new Error("REFUSING TO RUN: the ext test preload did not set an isolated root")
  await assertEngineSandboxed({ root: testRoot } as Parameters<typeof assertEngineSandboxed>[0])

  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `upstream-probe-${++counter}-`)))
  const mock = startMockModel(0)
  const proxy = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const text = await request.text()
      if (text.includes(FAIL_PROMPT)) return Response.json({ error: { message: "probe: rejected", type: "invalid_request_error" } }, { status: 400 })
      return mock.fetch(new Request(request.url, { method: request.method, headers: request.headers, body: text || undefined }))
    },
  })

  const configDirectory = path.join(root, "config")
  fs.mkdirSync(configDirectory)
  const provider = {
    model: "mock/m",
    providers: {
      mock: {
        name: "Mock",
        package: "@ai-sdk/openai-compatible",
        settings: { baseURL: `http://127.0.0.1:${proxy.port}/v1`, apiKey: "x" },
        models: { m: { name: "Mock M", capabilities: { tools: true } } },
      },
    },
  }
  fs.writeFileSync(path.join(configDirectory, "opencode.json"), JSON.stringify({ ...provider, ...options.global }))
  // The recorder runs in this process (the engine is in-process), so it hands its records over through globalThis.
  const recorderID = `${counter}`
  const recorder = path.join(root, "recorder")
  fs.mkdirSync(recorder)
  fs.writeFileSync(
    path.join(recorder, "server.js"),
    [
      `const calls = ((globalThis[Symbol.for(${JSON.stringify(RECORDER_PLUGIN_ID)})] ??= {})[${JSON.stringify(recorderID)}] ??= [])`,
      `const plain = (messages) => messages.map((m) => ({ role: m.role, content: Array.isArray(m.content) ? m.content.map((p) => ({ type: p.type, text: p.text })) : m.content }))`,
      `export default {`,
      `  id: ${JSON.stringify(RECORDER_PLUGIN_ID)},`,
      `  setup: async (context) => {`,
      `    for (const hook of ${JSON.stringify(REQUEST_HOOKS)})`,
      `      await context.session.hook(hook, (event) => void calls.push({ hook, sessionID: event.sessionID, messages: plain(event.messages) }))`,
      `    await context.session.hook("model.request", (event) => void calls.push({ hook: "model.request" }))`,
      `  },`,
      `}`,
    ].join("\n"),
  )
  const content = { ...options.content, plugins: [recorder, ...((options.content?.plugins as string[] | undefined) ?? [])] }

  let file: string | undefined
  if (options.explicit) {
    file = path.join(root, "explicit.json")
    fs.writeFileSync(file, JSON.stringify(options.explicit))
  }

  const password = "upstream-probe"
  let fetch: ((request: Request) => Response | Promise<Response>) | undefined
  const toggles = engineDesktopToggles({})
  const engine = await startEngine(
    buildEngineServerOptions({
      hostname: "127.0.0.1",
      port: 0,
      password,
      engineVersion: "test",
      databasePath: path.join(root, "engine.db"),
      configDirectory,
      config: { content: JSON.stringify(content), ...(file ? { file } : {}) },
      models: { fetch: toggles.modelsFetch },
      filewatcher: toggles.filewatcher,
      platform: process.platform,
    }),
    { onDispatch: (dispatch) => (fetch = withEngineAuthorization(dispatch, password)) },
  )

  /** One request through the in-process dispatch app; `directory` picks the Location. */
  async function call(method: string, route: string, body?: unknown, directory?: string): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (directory) headers["x-opencode-directory"] = encodeURIComponent(directory)
    const response = await fetch!(
      new Request(`http://codepuppy-sidecar.invalid${route}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    )
    const text = await response.text()
    let parsed: unknown = text
    try {
      parsed = text ? JSON.parse(text) : undefined
    } catch {}
    return { status: response.status, body: parsed }
  }

  // The raw engine event stream (`GET /api/event`), every frame kept in arrival order.
  const frames: Frame[] = []
  const listeners: Array<(frame: Frame) => void> = []
  const stop = new AbortController()
  const stream = await fetch!(new Request("http://codepuppy-sidecar.invalid/api/event", { signal: stop.signal }))
  if (!stream.ok || !stream.body) throw new Error(`GET /api/event answered ${stream.status}`)
  const pump = (async () => {
    const reader = stream.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        buffer += decoder.decode(value, { stream: true })
        let index
        while ((index = buffer.indexOf("\n\n")) >= 0) {
          const data = buffer
            .slice(0, index)
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
          buffer = buffer.slice(index + 2)
          if (!data) continue
          const frame = JSON.parse(data) as Frame
          frames.push(frame)
          for (const listener of listeners) listener(frame)
        }
      }
    } catch {}
  })()

  // Approvals the build agent asks for (shell, edit) are answered once, as the sampler did: the probes are about
  // the behaviour behind the approval, not the approval.
  listeners.push((frame) => {
    if (frame.type === "permission.asked")
      void call("POST", `/api/session/${frame.data.sessionID}/permission/${frame.data.id}/reply`, { decision: "once" })
  })

  /** A fresh git project directory (with an initial commit), optionally seeded by `seed`. */
  function project(name: string, seed?: (directory: string) => void) {
    const directory = path.join(root, "projects", name)
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(path.join(directory, "a.txt"), "hi\n")
    for (const args of [["init", "-q"], ["add", "a.txt"], ["-c", "user.email=p@p", "-c", "user.name=p", "commit", "-qm", "init"]])
      Bun.spawnSync(["git", ...args], { cwd: directory })
    seed?.(directory)
    return directory
  }

  const sessionFrames = (sessionID: string) => frames.filter((frame) => frame.data?.sessionID === sessionID)
  const TURN_END = /^session\.execution\.(succeeded|failed|interrupted)$/

  return {
    root,
    frames,
    /** Every hook invocation the recorder plugin saw, in order. */
    hookCalls: (): HookCall[] => ((globalThis as any)[RECORDER_KEY]?.[recorderID] ?? []) as HookCall[],
    listen: (listener: (frame: Frame) => void) => void listeners.push(listener),
    call,
    project,
    sessionFrames,
    async createSession(directory: string) {
      const created = await call("POST", "/api/session", { location: { directory } }, directory)
      if (created.status !== 200) throw new Error(`POST /api/session answered ${created.status}: ${JSON.stringify(created.body)}`)
      return created.body.data.id as string
    },
    async prompt(sessionID: string, directory: string, body: Json) {
      const sent = await call("POST", `/api/session/${sessionID}/prompt`, body, directory)
      if (sent.status !== 200) throw new Error(`prompt answered ${sent.status}: ${JSON.stringify(sent.body)}`)
    },
    /** Waits until the session has sent `turns` terminal frames. */
    turnEnded: (sessionID: string, turns = 1, ms = 20_000) =>
      until(
        `session ${sessionID} to send ${turns} session.execution.succeeded|failed|interrupted frame(s) — packages/ui-mac/src/engine-adapter/events.ts ends the busy state on them`,
        () => sessionFrames(sessionID).filter((f) => TURN_END.test(f.type)).length >= turns,
        ms,
      ),
    async messages(sessionID: string, directory: string) {
      const page = await call("GET", `/api/session/${sessionID}/message?order=asc&limit=200`, undefined, directory)
      return page.body.data as any[]
    },
    async close() {
      stop.abort()
      await pump
      await engine.close().catch(() => undefined)
      proxy.stop(true)
      mock.stop(true)
    },
  }
}

export type ProbeEngine = Awaited<ReturnType<typeof startProbeEngine>>
