// alpha-code#1700 (SPEC-project-agent-fields BR-04) — does the engine send an agent's own temperature / top_p? Probed on
// the real engine (engine.cases.ts), reading the request bodies its model proxy received.
//
//   P12 A v1 agent's `temperature` / `top_p` (here from the global config document, read by the engine's own v1 migration)
//       land in the agent's `request.body` (core/src/v1/config/migrate.ts migrateAgent, core/src/config/plugin/agent.ts),
//       and nothing reads that field when a turn's request is built (core/src/session/model-request.ts): the wire request
//       carries neither, even on a model that supports temperature. Code Puppy therefore sets them itself in the
//       `context` hook (packages/ext/src/plugin.ts) — the second arm shows that seam reaches the wire. If the engine
//       starts sending them, the first arm fails and the ext path must go (one source, not two).
//
// The second arm is also the checker's known-bad sample: the same checker sees the values when they are on the wire.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { startProbeEngine, until, type ProbeEngine } from "./engine.cases"

let engine: ProbeEngine
let directory: string
const sampling = { temperature: 0.2, top_p: 0.9 }

beforeAll(async () => {
  // A plugin that does what ext does, for one agent only: set the turn's sampling options in the `context` hook.
  const plugin = fs.mkdtempSync(path.join(os.tmpdir(), "agent-request-plugin-"))
  fs.writeFileSync(
    path.join(plugin, "server.js"),
    [
      `export default {`,
      `  id: "codepuppy.upstream-probe.sampling",`,
      `  setup: async (context) => {`,
      `    await context.session.hook("context", (event) => {`,
      `      if (event.agent !== "hooked") return`,
      `      event.options.temperature = ${sampling.temperature}`,
      `      event.options.topP = ${sampling.top_p}`,
      `    })`,
      `  },`,
      `}`,
    ].join("\n"),
  )
  engine = await startProbeEngine({
    global: { agent: { sampler: { prompt: "sample", ...sampling }, hooked: { prompt: "hooked" } } },
    content: { plugins: [plugin] },
  })
  directory = engine.project("agent-request")
}, 60_000)

afterAll(async () => {
  await engine?.close()
})

/** One turn with `agent`; returns the bodies of that session's turn requests (the ones that offer tools; titles do not). */
async function turnBodies(agent: string) {
  const created = await engine.call("POST", "/api/session", { location: { directory }, agent }, directory)
  expect(created.status).toBe(200)
  const sessionID = created.body.data.id as string
  await engine.prompt(sessionID, directory, { text: "reply plainly" })
  await engine.turnEnded(sessionID)
  return engine.bodies.filter((entry) => entry.sessionID === sessionID && Array.isArray(entry.body.tools) && entry.body.tools.length > 0).map((entry) => entry.body)
}

/** What the wire request carries of the agent's sampling. */
const sent = (body: Record<string, unknown>) => ({ temperature: body.temperature, top_p: body.top_p })

describe("P12 an agent's temperature / top_p on the wire", () => {
  test("[packages/ext/src/plugin.ts] the engine keeps a v1 agent's temperature / top_p in request.body but does not send them, on a model that supports temperature", async () => {
    // The Location loads its agents on first use; wait until the engine has registered the configured one.
    const agent = await until("the configured agent to be registered", async () =>
      ((await engine.call("GET", "/api/agent", undefined, directory)).body.data as any[] | undefined)?.find((item) => item.id === "sampler"),
    )
    expect(agent.request.body).toEqual(sampling)
    const model = ((await engine.call("GET", "/api/model", undefined, directory)).body.data as any[]).find((item) => item.providerID === "mock" && item.id === "m")
    expect(model?.capabilities.temperature).toBe(true)
    const bodies = await turnBodies("sampler")
    expect(bodies.length).toBeGreaterThan(0)
    for (const body of bodies) expect(sent(body)).toEqual({ temperature: undefined, top_p: undefined })
  }, 30_000)

  test("[packages/ext/src/plugin.ts] known bad / the seam: a plugin that sets options.temperature / topP in the context hook puts them on the wire", async () => {
    const bodies = await turnBodies("hooked")
    expect(bodies.length).toBeGreaterThan(0)
    for (const body of bodies) expect(sent(body)).toEqual(sampling)
  }, 30_000)
})
