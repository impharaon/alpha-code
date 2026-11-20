// SPEC-stored-credentials-fence AC-04 / BR-04(DESIGN-stored-credentials-fence §1 (d)、§4.1 resolveConnectorLeaf、§6 E10 后半)的真入口证明。
// 宿主:嵌进 sidecar 的那台 OpenCode 2,配置是生产 `injectCodePuppyConfig` 的产物,装着真 ext(test-component/codepuppy-engine.ts)。
// 用户在设置里启用连接器 = 生产持久写(setInstallStateByKey)+ main 的唯一运行时入口 createManagedMcpConvergence(与 ext-ipc 同一顺序)。
// main 交给引擎的定义经一个真 TCP 中转记下来(`PUT /api/experimental/mcp/<name>` 的请求体):那就是「连接器的配置」。
// 假凭据都是一眼可辨的假值;日志与断言消息里只会出现这些假值。
// 本文件由 src/main/connector-leaf-alias.engine.test.ts 起独立子进程跑。
import { afterAll, beforeAll, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "./engine-sandbox"
import { codepuppyEngine, MCP_FIXTURE, scriptedModel, type Running } from "./codepuppy-engine"
import { echoMcpHandler } from "../../core/test/fixture/mcp-echo"
import { upsertRecordV2 } from "../src/main/ext-receipt-v2"
import { setInstallStateByKey } from "../src/main/ext-install-planner"
import { writeMcpServerTruth } from "../src/main/mcp-server-truth-write"
import { createManagedMcpConvergence } from "../src/main/package-mcp-activation"
import { writeMcpSecretVersioned } from "../src/main/codepuppy-mcp-secrets"
import { secretFilePath, writeSecretFileAtomic } from "../src/main/codepuppy-secret-files"
import type { EngineConnection } from "../src/main/engine-authorization"

const sandbox = engineSandbox()
const model = scriptedModel()
const engines: Running[] = []
const echo = echoMcpHandler()
const remoteAuthorization: string[] = []
const remote = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    remoteAuthorization.push(request.headers.get("authorization") ?? "")
    return echo.fetch(request)
  },
})

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})
afterAll(async () => {
  for (const engine of engines) await engine.close().catch(() => undefined)
  model.stop()
  remote.stop(true)
  await echo.close()
})

const FAKE = {
  alpha: "FAKE-CRED-alpha-own",
  bravo: "FAKE-CRED-bravo-other-connector",
  gamma: "FAKE-CRED-gamma-remote-header",
  gammaSecret: "FAKE-CRED-gamma-oauth-client-secret",
  byok: "FAKE-CRED-byok-deepseek",
  plain: "plain-file-not-a-credential",
}

type Body = { config: { environment?: Record<string, string>; headers?: Record<string, string>; oauth?: Record<string, unknown> } }

test("AC-04: enabling connectors in settings substitutes only each connector's own credential in its exact spelling; symlink / relative / case-variant / firmlink spellings, another connector's token, the platform credential and a BYOK key all reach the engine as empty strings, and the log names them without values", async () => {
  const name = "leaf-alias"
  const userData = path.join(sandbox.root, `${name}-userdata`)
  const stateRoot = path.join(sandbox.root, `${name}-state`, "codepuppy-state")
  const root = path.join(stateRoot, "env", "dev")
  fs.mkdirSync(root, { recursive: true })
  process.env.CODEPUPPY_GLOBAL_DIR = root // main's own view of the environment root (the remote truth lookup reads it)

  // Code Puppy's stores, written by the production writers (the store files the references point at)
  const stored = (server: string, variable: string, value: string) => {
    const written = writeMcpSecretVersioned(userData, server, "v-0000aaaa", variable, value)
    if (!written.ok) throw Error(written.reason)
    return written.ref.slice("{file:".length, -1)
  }
  const alphaToken = stored("alpha", "TOKEN", FAKE.alpha)
  const bravoToken = stored("bravo", "TOKEN", FAKE.bravo)
  const gammaToken = stored("gamma", "TOKEN", FAKE.gamma)
  const gammaSecret = stored("gamma", "CLIENT_SECRET", FAKE.gammaSecret)
  fs.mkdirSync(path.dirname(secretFilePath(userData, "DEEPSEEK_API_KEY")), { recursive: true, mode: 0o700 })
  writeSecretFileAtomic(path.dirname(secretFilePath(userData, "DEEPSEEK_API_KEY")), "DEEPSEEK_API_KEY", FAKE.byok)

  // What a conversation can leave in the workspace: a symlink to alpha's token (the project folder is the engine slot's)
  const workspace = path.join(sandbox.root, `${name}-workspace`)
  fs.mkdirSync(workspace, { recursive: true })
  const link = path.join(workspace, "token-link")
  fs.symlinkSync(alphaToken, link)
  const plain = path.join(workspace, "plain.txt")
  fs.writeFileSync(plain, FAKE.plain)
  const relative = path.relative(process.cwd(), alphaToken)
  const caseVariant = alphaToken.replace("codepuppy-mcp-secrets", "CODEPUPPY-MCP-SECRETS")
  const firmlink = path.join("/System/Volumes/Data", fs.realpathSync.native(alphaToken))
  // Every alias really opens the same file from here (otherwise the refusal below would prove nothing)
  for (const alias of [link, relative, caseVariant, firmlink]) expect(fs.readFileSync(alias, "utf8")).toBe(FAKE.alpha)
  expect(path.isAbsolute(relative)).toBe(false)

  const platformKey = secretFilePath(userData, "CODEPUPPY_API_KEY")
  const ref = (file: string) => `{file:${file}}`
  for (const [server, desiredState] of [["alpha", "disabled"], ["gamma", "disabled"]] as const) {
    const written = upsertRecordV2(root, {
      id: `user:${server}`, name: server, kind: "mcp", environment: "dev", scope: { kind: "global" },
      desiredState, origin: "created", configKey: `mcp.${server}`, installedAt: "2026-11-20T00:00:00.000Z",
    })
    if (!written.ok) throw Error(written.reason)
  }
  writeMcpServerTruth(
    path.join(stateRoot, "mcp-servers", "dev.json"),
    [{
      name: "gamma",
      url: `http://127.0.0.1:${remote.port}/gamma/mcp`,
      headers: { Authorization: `Bearer ${ref(gammaToken)}`, "X-Via-Link": ref(link) },
      oauth: { clientId: "cp-test-client", clientSecret: ref(gammaSecret) },
    }],
    { mkdirSync: fs.mkdirSync, writeFileSync: fs.writeFileSync, renameSync: fs.renameSync, rmSync: fs.rmSync },
  )
  const host = codepuppyEngine({
    sandbox, name, modelBaseURL: model.baseURL,
    mcp: {
      alpha: {
        type: "local", command: [process.execPath, MCP_FIXTURE], enabled: false,
        environment: {
          OWN: ref(alphaToken),
          VIA_LINK: ref(link),
          VIA_RELATIVE: ref(relative),
          VIA_CASE: ref(caseVariant),
          VIA_FIRMLINK: ref(firmlink),
          OTHER_CONNECTOR: ref(bravoToken),
          PLATFORM: ref(platformKey),
          BYOK: ref(secretFilePath(userData, "DEEPSEEK_API_KEY")),
          PLAIN: ref(plain),
        },
      },
    },
  })
  expect(host.userData).toBe(userData)
  const running = await host.start()
  engines.push(running)
  const connection: EngineConnection = { url: running.url, username: "opencode", password: `cp-${name}` }

  // A real TCP hop in front of the engine that keeps the definitions main hands over
  const added = new Map<string, Body>()
  const proxy = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer()
      const server = /^\/api\/experimental\/mcp\/([^/]+)$/.exec(url.pathname)?.[1]
      if (request.method === "PUT" && server && body) added.set(decodeURIComponent(server), JSON.parse(new TextDecoder().decode(body)) as Body)
      return fetch(new Request(new URL(url.pathname + url.search, connection.url), { method: request.method, headers: request.headers, body }))
    },
  })
  const logged: string[] = []
  try {
    const converge = createManagedMcpConvergence({
      root: () => root, awaitServer: async () => ({ ...connection, url: `http://127.0.0.1:${proxy.port}` }),
      directory: () => host.projectDirectory, userDataPath: () => userData, log: (line) => logged.push(line),
    })
    for (const server of ["alpha", "gamma"]) {
      expect(await setInstallStateByKey({ type: "mcp", name: server, scope: "global", state: "enabled" }, {
        globalRoot: () => root, advisoryGate: () => ({ allowed: true }), resolveEntry: async () => null,
      })).toMatchObject({ ok: true })
      await converge([server])
    }
  } finally {
    proxy.stop(true)
  }

  const alpha = added.get("alpha")?.config.environment
  expect(alpha).toEqual({
    OWN: FAKE.alpha,
    VIA_LINK: "",
    VIA_RELATIVE: "",
    VIA_CASE: "",
    VIA_FIRMLINK: "",
    OTHER_CONNECTOR: "",
    PLATFORM: "",
    BYOK: "",
    PLAIN: FAKE.plain,
  })
  const gamma = added.get("gamma")?.config
  expect(gamma?.headers).toEqual({ Authorization: `Bearer ${FAKE.gamma}`, "X-Via-Link": "" })
  // R3-4: the remote truth leaf is v1 (`oauth.clientSecret`); the engine gets 2.x `client_secret` with the right value
  expect(gamma?.oauth).toMatchObject({ client_id: "cp-test-client", client_secret: FAKE.gammaSecret })
  // The engine's connector really came up on what main handed over
  const listed = async () => ((await running.send("GET", "/api/mcp")).json?.data ?? []) as Array<{ name: string; status: { status: string } }>
  let status: Record<string, string> = {}
  for (let i = 0; i < 150; i++) {
    status = Object.fromEntries((await listed()).map((server) => [server.name, server.status.status]))
    if (status.alpha === "connected" && status.gamma === "connected") break
    await Bun.sleep(100)
  }
  expect(status).toMatchObject({ alpha: "connected", gamma: "connected" })
  expect(remoteAuthorization).toContain(`Bearer ${FAKE.gamma}`)
  // Main names each refusal (connector + field) and never a value
  const refusals = logged.filter((line) => line.includes("was not substituted"))
  expect(refusals.map((line) => /at (\S+) was/.exec(line)?.[1]).sort()).toEqual(
    ["environment.BYOK", "environment.OTHER_CONNECTOR", "environment.PLATFORM", "environment.VIA_CASE", "environment.VIA_FIRMLINK", "environment.VIA_LINK", "environment.VIA_RELATIVE", "headers.X-Via-Link"].sort(),
  )
  for (const value of Object.values(FAKE)) for (const line of logged) expect(line.includes(value)).toBe(false)
}, 120_000)
