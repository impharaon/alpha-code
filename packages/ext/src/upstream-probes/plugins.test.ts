// INT-upstream-upgrade-readiness I-03 — upstream plugin-host behaviours Code Puppy depends on. Each test name starts
// with the Code Puppy file that breaks when the behaviour changes.
//
//   P2  Every model request runs exactly one of the plugin hooks `context`, `compaction`, `generate`, `title`: the
//       request builder has exactly those four entries (core/src/session/model-request.ts `Service.of`), and on the
//       real engine every `model.request` follows one of them. ext puts one callback on those four hooks (branding,
//       attachment rewrite, output cap — packages/ext/src/plugin.ts); a fifth request kind would bypass it.
//   P4  Plugins activate pre → package → post (core/src/plugin/supervisor.ts, lists in core/src/plugin/internal.ts):
//       upstream's tools, agents, commands and skills register before a package plugin such as ext; config agents,
//       browser, config commands / skills / providers and the policy plugin come after it. ext's `seal()`, tail rules
//       and `holdAsk` are built on this (packages/ext/src/policy/index.ts), and so is the sidecar's readiness poll
//       (packages/ui-mac/src/main/sidecar-ext-ready.ts).
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "node:path"
import { RECORDER_PLUGIN_ID, startProbeEngine, until, type HookCall, type ProbeEngine } from "./engine.cases"

const core = path.resolve(import.meta.dir, "../../../core")
const { Effect, Layer } = await import(Bun.resolveSync("effect", core))
const { SessionModelRequest } = await import(path.join(core, "src/session/model-request.ts"))
const { PluginHooks } = await import(path.join(core, "src/plugin/hooks.ts"))
const { SessionModelTransport } = await import(path.join(core, "src/session/model-transport.ts"))
const { App } = await import(path.join(core, "src/app.ts"))

const REQUEST_HOOKS = ["context", "compaction", "generate", "title"]

let engine: ProbeEngine
let directory: string

beforeAll(async () => {
  engine = await startProbeEngine()
  directory = engine.project("plugins")
}, 60_000)

afterAll(async () => {
  await engine?.close()
})

// ── P2 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The request builder's entries: the real layer, built with inert dependencies (none is used at construction). */
async function requestEntries(): Promise<string[]> {
  const service = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* SessionModelRequest.Service
    }).pipe(
      Effect.provide(SessionModelRequest.layer),
      Effect.provide(Layer.succeed(PluginHooks.Service, {} as never)),
      Effect.provide(Layer.succeed(SessionModelTransport.Service, {} as never)),
      Effect.provide(App.layer()),
    ),
  )
  return Object.keys(service).sort()
}

const ENTRY_HOOK: Record<string, string> = { primary: "context", compaction: "compaction", generate: "generate", title: "title" }

function entryProblems(entries: string[]): string[] {
  const unknown = entries.filter((entry) => !(entry in ENTRY_HOOK)).map((entry) => `request kind ${entry} has no hook ext listens on`)
  const missing = Object.keys(ENTRY_HOOK).filter((entry) => !entries.includes(entry)).map((entry) => `request kind ${entry} is gone`)
  return [...unknown, ...missing]
}

/** Every model request must follow one of the four hooks: over a settled period the counts are equal. */
function requestHookProblems(calls: HookCall[]): string[] {
  const hooks = calls.filter((call) => REQUEST_HOOKS.includes(call.hook)).length
  const requests = calls.filter((call) => call.hook === "model.request").length
  return hooks === requests ? [] : [`${requests} model requests but ${hooks} request-hook calls`]
}

describe("P2 model request kinds and their hooks", () => {
  test("[packages/ext/src/plugin.ts] the request builder has exactly the four kinds ext hooks: primary/context, compaction, generate, title", async () => {
    expect(entryProblems(await requestEntries())).toEqual([])
  })

  test("[packages/ext/src/plugin.ts] on the real engine every model request (turn, title, compaction, generate) follows one of the four hooks", async () => {
    const sessionID = await engine.createSession(directory)
    await engine.prompt(sessionID, directory, { text: "reply plainly" })
    await engine.turnEnded(sessionID)
    const compacted = await engine.call("POST", `/api/session/${sessionID}/compact`, {}, directory)
    expect(compacted.status).toBe(200)
    const generated = await engine.call("POST", `/api/session/${sessionID}/generate`, { prompt: "reply plainly" }, directory)
    expect(generated.status).toBe(200)
    const seen = await until("all four request hooks to fire for the session, with as many model requests", () => {
      const own = new Set(engine.hookCalls().filter((call) => call.sessionID === sessionID).map((call) => call.hook))
      return REQUEST_HOOKS.every((hook) => own.has(hook)) && requestHookProblems(engine.hookCalls()).length === 0 && own
    })
    expect([...seen].sort()).toEqual([...REQUEST_HOOKS].sort())
    expect(requestHookProblems(engine.hookCalls())).toEqual([])
  }, 30_000)

  test("[packages/ext/src/plugin.ts] known bad: a fifth request kind and a model request without a hook are both rejected", async () => {
    expect(entryProblems([...(await requestEntries()), "summary"]).length).toBeGreaterThan(0)
    expect(requestHookProblems([...engine.hookCalls(), { hook: "model.request" }]).length).toBeGreaterThan(0)
  })
})

// ── P4 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const BEFORE_PACKAGES = ["opencode.tool.read", "opencode.tool.shell", "opencode.agent", "opencode.command", "opencode.skill"]
const AFTER_PACKAGES = ["opencode.config.agent", "opencode.browser", "opencode.config.command", "opencode.config.skill", "opencode.config.provider", "opencode.config.policy"]

function orderProblems(ids: string[]): string[] {
  const at = ids.indexOf(RECORDER_PLUGIN_ID)
  if (at < 0) return ["the package plugin is not active"]
  return [
    ...BEFORE_PACKAGES.filter((id) => !(ids.indexOf(id) >= 0 && ids.indexOf(id) < at)).map((id) => `${id} does not activate before package plugins`),
    ...AFTER_PACKAGES.filter((id) => !(ids.indexOf(id) > at)).map((id) => `${id} does not activate after package plugins`),
  ]
}

describe("P4 plugin activation order", () => {
  let ids: string[]

  beforeAll(async () => {
    ids = await until("GET /api/plugin to list the active package plugin and the post plugins", async () => {
      const listed = ((await engine.call("GET", "/api/plugin", undefined, directory)).body?.data ?? []).map((plugin: any) => plugin.id as string)
      return listed.includes(RECORDER_PLUGIN_ID) && listed.includes("opencode.config.policy") && listed
    })
  }, 30_000)

  test("[packages/ext/src/policy/index.ts] upstream's tools, agents, commands and skills activate before package plugins; config agents, browser, config commands / skills / providers and policy after", () => {
    expect(orderProblems(ids)).toEqual([])
  })

  test("[packages/ext/src/policy/index.ts] known bad: the policy plugin moved before the package plugin is rejected", () => {
    const moved = ids.filter((id) => id !== "opencode.config.policy")
    moved.splice(moved.indexOf(RECORDER_PLUGIN_ID), 0, "opencode.config.policy")
    expect(orderProblems(moved)).toEqual(["opencode.config.policy does not activate after package plugins"])
  })
})
