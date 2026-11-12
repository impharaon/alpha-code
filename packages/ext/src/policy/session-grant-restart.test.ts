// I-05 contract A invariant 4 (design upgrade-fewer-takeovers §4): "allow for this session" is gone once the engine
// stops, as in the current release 0.1.26 (the grant lives only in the permission service's memory). The real
// embedded engine — Code Puppy's production embedding (packages/ui-mac/engine/engine-embed.ts `startEngine`, options
// from engine-server-options.ts, the password wrapper from engine-authorization.ts) — is stopped and started again on
// the same database file. Control: a session rule written to the same database survives the same restart, so the
// "asks again" half is not an artefact of a fresh database.
//
// Isolation: the ext test preload (scripts/test-isolation/preload.ts) points HOME / XDG_* / TMPDIR / OPENCODE_DB at a
// fresh temp root; the engine refuses to boot unless its own directories are inside it (`assertEngineSandboxed`).
import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { TEST_ROOT_KEY } from "../../../../scripts/test-isolation/env"
import { assertEngineSandboxed } from "../../../ui-mac/test-component/engine-sandbox"
import { startEngine } from "../../../ui-mac/engine/engine-embed"
import { buildEngineServerOptions } from "../../../ui-mac/src/main/engine-server-options"
import { withEngineAuthorization } from "../../../ui-mac/src/main/engine-authorization"

const PASSWORD = "session-grant-restart"

async function boot(root: string, project: string) {
  let dispatch: ((request: Request) => Response | Promise<Response>) | undefined
  const engine = await startEngine(
    buildEngineServerOptions({
      hostname: "127.0.0.1",
      port: 0,
      password: PASSWORD,
      engineVersion: "test",
      databasePath: path.join(root, "engine.db"),
      configDirectory: path.join(root, "config"),
      config: { content: "{}" },
      models: { fetch: false },
      filewatcher: false,
      platform: process.platform,
    }),
    { onDispatch: (inner) => (dispatch = withEngineAuthorization(inner, PASSWORD)) },
  )
  async function call(method: string, route: string, body?: unknown): Promise<{ status: number; body: any }> {
    const response = await dispatch!(
      new Request(`http://codepuppy-sidecar.invalid${route}`, {
        method,
        headers: { "content-type": "application/json", "x-opencode-directory": encodeURIComponent(project) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : undefined }
  }
  /** `Permission.ask` through the public route: the engine's decision now (an ask stays pending). */
  const ask = async (sessionID: string, resource: string, save: string[] = []) => {
    const asked = await call("POST", `/api/session/${sessionID}/permission`, { agent: "build", action: "read", resources: [resource], save })
    if (asked.status !== 200) throw new Error(`ask answered ${asked.status}: ${JSON.stringify(asked.body)}`)
    return asked.body.data as { id: string; effect: string }
  }
  // Agents come from plugins that activate after boot; until the build agent carries its `read *.env` ask, an ask
  // answers from a missing agent (deny) and would prove nothing either way.
  for (const deadline = Date.now() + 15_000; ; ) {
    const agent = await call("GET", "/api/agent/build")
    const rules = (agent.body?.data?.permissions ?? []) as Array<{ action: string; resource: string; effect: string }>
    if (rules.some((rule) => rule.action === "read" && rule.resource === "*.env" && rule.effect === "ask")) break
    if (Date.now() > deadline) throw new Error(`the build agent never carried its read *.env ask: ${JSON.stringify(agent.body)}`)
    await Bun.sleep(50)
  }
  return { close: () => engine.close(), call, ask }
}

describe("[packages/core/src/permission.ts codepuppy(I-05)] allow for this session ends with the engine", () => {
  test("an always grant is gone after the embedded engine restarts; a session rule in the same database survives the restart (control)", async () => {
    const testRoot = process.env[TEST_ROOT_KEY]
    if (!testRoot) throw new Error("REFUSING TO RUN: the ext test preload did not set an isolated root")
    await assertEngineSandboxed({ root: testRoot } as Parameters<typeof assertEngineSandboxed>[0])
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "session-grant-restart-")))
    const project = path.join(root, "project")
    fs.mkdirSync(path.join(root, "config"))
    fs.mkdirSync(project)
    for (const args of [["init", "-q"], ["commit", "-q", "--allow-empty", "-m", "init"]])
      Bun.spawnSync(["git", "-c", "user.email=p@p", "-c", "user.name=p", ...args], { cwd: project })

    const first = await boot(root, project)
    let granted: string
    let ruled: string
    try {
      const create = async () => {
        const created = await first.call("POST", "/api/session", { location: { directory: project } })
        if (created.status !== 200) throw new Error(`POST /api/session answered ${created.status}: ${JSON.stringify(created.body)}`)
        return created.body.data.id as string
      }
      granted = await create()
      ruled = await create()
      // The build agent asks for `read *.env` (upstream default).
      const request = await first.ask(granted, "a.env", ["a.env"])
      expect(request.effect).toBe("ask")
      expect((await first.call("POST", `/api/session/${granted}/permission/${request.id}/reply`, { decision: "always" })).status).toBe(204)
      expect((await first.ask(granted, "a.env")).effect).toBe("allow")

      expect((await first.call("PATCH", `/api/session/${ruled}`, { permissions: [{ action: "read", resource: "a.env", effect: "allow" }] })).status).toBe(204)
      expect((await first.ask(ruled, "a.env")).effect).toBe("allow")
    } finally {
      await first.close()
    }

    const second = await boot(root, project)
    try {
      expect((await second.ask(granted, "a.env")).effect).toBe("ask")
      expect((await second.ask(ruled, "a.env")).effect).toBe("allow")
    } finally {
      await second.close()
    }
  }, 120_000)
})
