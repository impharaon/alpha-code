import { testEgressDial } from "../../test-component/egress-upstream-fixture"
// Scenario only: real engine, real ext lifecycle, production proxy and native fence. No Electron/window.
// Model fixture uses HTTPS through the same CONNECT port, so the production network profile is unmodified.
import { afterAll, beforeAll, expect, test } from "bun:test"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import appPlugin from "@opencode-ai/app/vite"
import { build } from "vite"
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, realpathSync, writeFileSync, symlinkSync, lstatSync, readlinkSync, renameSync, rmSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"
import { connect, type Socket } from "node:net"
import { createServer } from "node:http"
import { dialEgressUpstream } from "./network-egress-upstream"
import { configureEgressGrantApproval } from "./network-egress-grants"
import { egressPassPath } from "./network-egress-passes"
import { createHash } from "node:crypto"
import { scriptedModel, textOf } from "../../test-component/codepuppy-engine"
import { publishTestBootstrap } from "../../test-component/codepuppy-bootstrap-fixture"
import type { EngineSandbox } from "../../test-component/engine-sandbox"
import { buildFenceAddon } from "../../scripts/build-fence-addon"
import { trialCompileProfile } from "./process-fence-compile"
import { planProcessFence } from "./process-fence-plan"
import { credentialStores } from "./codepuppy-secret-files"
import { startEgressPolicyProxy, type EgressLogRecord } from "./network-egress-proxy"
import { sidecarEgressProxyEnv } from "./sidecar-env"
import { createNetworkEgressActivity } from "./network-egress-activity"
import { createNetworkEgressApproval } from "./network-egress-approval"
import { createEgressSiteStore, createEgressPassStore } from "./egress-grant-records"
import { writeEgressGrantTruth } from "./egress-grant-truth-write"
import { egressGrantTruthPath } from "./egress-grant-truth"
import { environmentFromMutableRoot } from "./codepuppy-environment"
import { engineClient } from "./engine-client"
import type { NetworkOutbound, EgressApproval, SessionRef } from "../shared/network-egress-wire"
import { NETWORK_EGRESS_NOTE } from "../../../ext/src/context-injection"

if (process.platform !== "darwin") {
  test.skip("requires the macOS network fence", () => {})
} else {

const nativeHTTP = { fetch: globalThis.fetch, Request: globalThis.Request, Response: globalThis.Response, Headers: globalThis.Headers }
const nativeFetch = nativeHTTP.fetch
const root = mkdtempSync(join(tmpdir(), "network-egress-scenario-"))
const outside = join(import.meta.dir, "../../../../node_modules/.cache", `egress-outside-${process.pid}`)
mkdirSync(outside, { recursive: true })
const model = scriptedModel()
const activity = createNetworkEgressActivity()
const logs: EgressLogRecord[] = []
const messages: NetworkOutbound[] = []
const connects: string[] = []
let service: ReturnType<typeof createNetworkEgressApproval>
let proxy: Awaited<ReturnType<typeof startEgressPolicyProxy>>
let tls: ReturnType<typeof Bun.serve>
let target: ReturnType<typeof Bun.serve>
let upstream: ReturnType<typeof createServer>
const upstreamSockets = new Set<Socket>()
const upstreamConnects: string[] = []
let child: ReturnType<typeof Bun.spawn>
let prepared: { sandbox: EngineSandbox; userData: string; globalRoot: string; project: string; config: string; connector: { trigger: string; results: string }; env: Record<string, string> }
let runtime: typeof import("../renderer/codepuppy-ui/network-egress-test-runtime")
let enginePID = 0
let generation = 1
let detach: (() => void) | undefined
let sequence = 0
let stderr = ""
let siteFile = ""
let passFile = ""
const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
const disposers: Array<() => void> = []
const turns = new Set<Promise<unknown>>()
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
const until = async <T>(read: () => T | Promise<T>, label: string, ms = 15_000): Promise<NonNullable<T>> => {
  for (const end = Date.now() + ms; Date.now() < end;) {
    const value = await read()
    if (value) return value as NonNullable<T>
    await Bun.sleep(25)
  }
  throw new Error(`${label}\n${stderr.slice(-4000)}`)
}
const rpc = (type: string, input: Record<string, unknown> = {}) => new Promise<unknown>((resolve, reject) => {
  const id = ++sequence
  waiting.set(id, { resolve, reject })
  child.send({ type, id, ...input })
})
async function call<T>(method: string, route: string, body?: unknown) {
  const result = await rpc("fixture.call", { method, route, body }) as { status: number; json: { data: T } }
  expect(result.status, JSON.stringify(result)).toBeLessThan(300)
  return result.json?.data
}
const attach = (connection: { url: string; authorization: string }) => {
  detach?.()
  const client = engineClient({ url: connection.url, username: null, password: "cp-network-egress" }, nativeFetch)
  const post = (message: NetworkOutbound) => { messages.push(message); child.send(message) }
  detach = activity.attach(generation, post, {
    session: async (ref) => { const info = await client.session.get({ sessionID: ref.sessionID }); return info.location.directory === ref.directory ? { parentID: info.parentID } : undefined },
    shell: async (ref, id) => { const info = await client.shell.get({ id, location: { directory: ref.directory } }); return info.data.status === "running" && info.data.metadata.sessionID === ref.sessionID },
  })
  postToMain = (message) => { activity.receive(message, post) }
}
let postToMain: (message: unknown) => void = () => {}
const renewService = () => { service?.close(); service = createNetworkEgressApproval({ available: true, activity, store: createEgressSiteStore(console.log), passes: createEgressPassStore(console.log), log: console.log }); configureEgressGrantApproval(service) }
const ref = (sessionID: string): SessionRef => ({ generation, sessionID, directory: prepared.project })
async function session() {
  const info = await call<{ id: string }>("POST", "/api/session", { location: { directory: prepared.project }, agent: "codepuppy-ask", model: { id: "m", providerID: "codepuppy" } })
  expect((await service.api.setTier({ session: ref(info.id), tier: "ask" })).ok).toBe(true)
  return info.id
}
const command = (host: string, port = 80) => `/usr/bin/curl --silent --show-error --fail --proxytunnel --proxy http://127.0.0.1:${proxy.port} --max-time 65 http://${host}:${port}/probe`
async function begin(sessionID: string, name: string, args: Record<string, unknown>) {
  await call("POST", `/api/session/${sessionID}/prompt`, { text: `CP-CALL ${JSON.stringify({ name, args })}` })
  let finished = false
  const done = call("POST", `/api/experimental/session/${sessionID}/wait`).finally(() => { finished = true })
  // These are the engine's separate tool/outer-directory approvals, not network decisions.
  const approving = (async () => {
    while (!finished) {
      const pending = await call<Array<{ id: string }>>("GET", `/api/session/${sessionID}/permission`)
      for (const item of pending) await call("POST", `/api/session/${sessionID}/permission/${item.id}/reply`, { decision: "once" })
      if (!finished) await Bun.sleep(25)
    }
  })()
  const completed = done.finally(() => approving)
  turns.add(completed)
  void completed.then(() => turns.delete(completed), () => turns.delete(completed))
  return { done: completed, sessionID }
}
async function card(sessionID: string, host: string) {
  return until(async () => {
    const result = await service.api.listApprovals({ session: ref(sessionID) })
    return result.ok && result.value.find((item) => item.destination.host === host && item.state === "pending")
  }, `missing CONNECT approval for ${host}`)
}
function mount(sessionID: string) {
  const host = document.createElement("div")
  document.body.append(host)
  disposers.push(runtime.render(() => runtime.createComponent(runtime.NetworkEgressCards, { session: ref(sessionID), api: service.api }), host))
  return host
}
/** A card area that can leave again, as when the user switches to another conversation. */
function view(sessionID: string) {
  const host = mount(sessionID)
  const dispose = disposers.pop()!
  let left = false
  const leave = () => { if (left) return; left = true; dispose(); host.remove() }
  disposers.push(leave)
  return { host, leave }
}
/** No card area is mounted and no conversation runs tools. Earlier cases' areas stay mounted until afterAll, and each one lists approvals, i.e. counts as viewing (design §4.9). */
async function idle() {
  disposers.splice(0).reverse().forEach((dispose) => dispose())
  document.body.replaceChildren()
  await Promise.allSettled([...turns])
  await until(() => activity.snapshot().complete && !activity.snapshot().activities.length, "no conversation is running tools")
}
/** Ask the engine-started connector (network-egress-engine-peer.ts) to connect while idle; its outcomes come back per target. */
const reach = (authority: string) => appendFileSync(prepared.connector.trigger, `${authority}\n`)
const reached = (authority: string): Array<{ target: string; connect: string; response: string }> =>
  existsSync(prepared.connector.results) ? readFileSync(prepared.connector.results, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((entry) => entry.target === authority) : []
async function click(host: HTMLElement, approval: EgressApproval, decision: string) {
  const button = await until(() => host.querySelector<HTMLButtonElement>(`[data-network-egress-request="${approval.requestID}"] [data-network-egress-decision="${decision}"]:not([disabled])`), "missing conversation decision button")
  button.click()
}
const modelText = (from: number) => model.requests.slice(from).flatMap((request) => request.messages.filter((message) => message.role === "tool").map((message) => textOf(message.content))).join("\n")
const tree = (directory: string): string => createHash("sha256").update(JSON.stringify(readdirSync(directory, { recursive: true }).map((name) => [name, lstatSync(join(directory, String(name))).isSymbolicLink() ? readlinkSync(join(directory, String(name))) : statSync(join(directory, String(name))).isFile() ? readFileSync(join(directory, String(name))).toString("base64") : "directory"]))).digest("hex")

beforeAll(async () => {
  const cert = join(root, "cert.pem")
  const key = join(root, "key.pem")
  const generated = Bun.spawnSync(["/usr/bin/openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=model.egress.test", "-addext", "subjectAltName=DNS:model.egress.test", "-keyout", key, "-out", cert], { stdout: "ignore", stderr: "pipe" })
  expect(generated.exitCode, generated.stderr.toString()).toBe(0)
  target = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("egress-target-ok") })
  tls = Bun.serve({ hostname: "127.0.0.1", port: 0, tls: { key: readFileSync(key), cert: readFileSync(cert) }, fetch: async (request) => nativeFetch(`${model.baseURL.replace(/\/v1$/, "")}${new URL(request.url).pathname}`, { method: request.method, headers: request.headers, body: await request.arrayBuffer() }) })
  upstream = createServer()
  const trackUpstream = (socket: Socket) => { upstreamSockets.add(socket); socket.on("error", () => {}); socket.once("close", () => upstreamSockets.delete(socket)) }
  upstream.on("connection", trackUpstream)
  upstream.on("connect", (request, client, head) => {
    upstreamConnects.push(request.url!)
    const destination = connect(target.port!, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length) destination.write(head)
      client.pipe(destination); destination.pipe(client)
    })
    trackUpstream(destination)
    client.once("close", () => destination.destroy()); destination.once("close", () => client.destroy())
  })
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve))
  const modelDial = testEgressDial(() => connect(tls.port!, "127.0.0.1"))
  proxy = await startEgressPolicyProxy({
    resolveEgressRoutes: async (destination) => destination.host === "model.egress.test" ? [{ kind: "direct" }] : [{ kind: "http", host: "127.0.0.1", port: (upstream.address() as { port: number }).port }],
    log: (record) => logs.push(record), authorize: (host, port) => host === "model.egress.test" || host === "via-proxy.egress.invalid" || service?.authorized(host, port) === true,
    requestGrant: (host, port, signal) => { connects.push(host); return service.request(host, port, signal) },
    dial: (destination, routes, policy, signal) => destination.host === "model.egress.test" ? modelDial(destination, routes, policy, signal) : dialEgressUpstream(destination, routes, policy, signal),
  })
  let prepare!: () => void
  const preparation = new Promise<void>((resolve) => { prepare = resolve })
  let ready!: (connection: { url: string; authorization: string }) => void
  const readiness = new Promise<{ url: string; authorization: string }>((resolve) => { ready = resolve })
  child = Bun.spawn({ cmd: [process.execPath, join(import.meta.dir, "../../test-component/network-egress-engine-peer.ts")], env: { ...process.env, ...sidecarEgressProxyEnv(proxy.port), NODE_EXTRA_CA_CERTS: cert, EGRESS_OUTSIDE: outside }, stdout: "pipe", stderr: "pipe", ipc(value) {
    const message = value as { type: string; id: number; value: unknown; error: string; url: string; authorization: string; pid: number }
    if (message.type === "fixture.prepared") { prepared = value as unknown as typeof prepared; prepare(); return }
    if (message.type === "fixture.ready") { enginePID = message.pid; console.log("EGRESS-ENGINE", JSON.stringify(value)); ready(message); return }
    if (message.type === "fixture.reply" || message.type === "fixture.error") { const reply = waiting.get(message.id); waiting.delete(message.id); if (message.error) reply?.reject(new Error(message.error)); else reply?.resolve(message.value); return }
    postToMain(value)
  } })
  void (async () => { for await (const chunk of child.stderr as ReadableStream<Uint8Array>) stderr += new TextDecoder().decode(chunk) })()
  void (async () => { for await (const chunk of child.stdout as ReadableStream<Uint8Array>) stderr += new TextDecoder().decode(chunk) })()
  await preparation
  const base = environmentFromMutableRoot(prepared.globalRoot)!
  siteFile = egressGrantTruthPath(base.casBaseRoot, "dev")
  passFile = egressPassPath(base.casBaseRoot, "dev")
  mkdirSync(dirname(siteFile), { recursive: true })
  writeEgressGrantTruth(siteFile, [], { mkdirSync, writeFileSync, renameSync, rmSync })
  symlinkSync(siteFile, join(prepared.project, "sites-link"))
  publishTestBootstrap({ globalRoot: prepared.globalRoot, userData: prepared.userData })
  renewService()
  buildFenceAddon({ out: join(outside, "codepuppy-fence", "codepuppy_fence.node"), buildId: `egress-${process.pid}` })
  const plan = planProcessFence({ userDataPath: prepared.userData, sidecarEnv: prepared.env, addon: { packaged: true, resourcesPath: outside, moduleDir: outside, exists: existsSync }, egressProxyPort: proxy.port, carriedWorkspaces: [], engineConfigDirectory: prepared.config, credentialStores: credentialStores({ userDataPath: prepared.userData }) }, {
    homeDir: () => prepared.sandbox.home, codepuppyGlobalRoot: () => prepared.globalRoot, appStateRoot: () => base.casBaseRoot, realpath: realpathSync.native, defaultWorkspace: () => prepared.project, readWorkspaces: () => [], isDirectory: (file) => statSync(file).isDirectory(), mkdirp: (file) => { mkdirSync(file, { recursive: true }) }, compile: trialCompileProfile, log: console.log,
  })
  child.send({ type: "fixture.start", fence: { addonPath: plan.addonPath, profile: plan.profile } })
  attach(await readiness)
  await until(() => activity.snapshot().complete, "initial activity snapshot")
  const out = join(root, "render")
  await build({ configFile: false, logLevel: "silent", plugins: [appPlugin.at(-1)!], build: { outDir: out, lib: { entry: join(import.meta.dir, "../renderer/codepuppy-ui/network-egress-test-runtime.tsx"), formats: ["es"], fileName: () => "runtime.js" }, rollupOptions: { output: { inlineDynamicImports: true } } } })
  GlobalRegistrator.register()
  Object.assign(globalThis, nativeHTTP)
  runtime = await import(pathToFileURL(join(out, "runtime.js")).href)
  console.log("EGRESS-MAIN", JSON.stringify({ pid: process.pid, siteFile, proxyPort: proxy.port, project: prepared.project }))
}, 90_000)

afterAll(async () => {
  disposers.splice(0).reverse().forEach((dispose) => dispose())
  service?.close()
  await Promise.allSettled([...turns])
  detach?.()
  if (child?.exitCode === null) child.send({ type: "fixture.stop" })
  if (child) {
    const exited = await Promise.race([child.exited, Bun.sleep(10_000).then(() => undefined)])
    if (exited === undefined) { child.kill(); await child.exited }
  }
  await proxy?.close(); upstreamSockets.forEach((socket) => socket.destroy()); if (upstream) await new Promise<void>((resolve) => upstream.close(() => resolve())); tls?.stop(true); target?.stop(true); model.stop()
  writeFileSync(join(outside, "evidence.json"), JSON.stringify({ mainPID: process.pid, enginePID, siteText: existsSync(siteFile) ? readFileSync(siteFile, "utf8") : "absent", logs, messages, modelRequests: model.requests, stderr }))
  console.log(`EGRESS-EVIDENCE ${join(outside, "evidence.json")}`)
}, 20_000)

test.skipIf(process.platform !== "darwin")("AC-07 对话卡片允许、拒绝、双会话 unknown 与真实 45 秒到期", async () => {
  const a = await session()
  const host = mount(a)
  const running = await begin(a, "shell", { command: command("a.approval.test") })
  const pending = await card(a, "a.approval.test")
  await click(host, pending, "allow-session")
  await running.done
  expect(modelText(0)).toContain("egress-target-ok")
  const b = await session()
  const copy = mount(b)
  const first = await begin(a, "shell", { command: command("dual.approval.test") })
  const second = await begin(b, "shell", { command: command("dual.approval.test") })
  const dual = await card(b, "dual.approval.test")
  await until(() => [host, copy].every((node) => node.querySelector(`[data-network-egress-request="${dual.requestID}"]`)?.textContent?.includes("无法确定发起方")), "both conversations must show unknown attribution")
  expect((await card(a, "dual.approval.test")).requestID).toBe(dual.requestID)
  await until(() => connects.filter((host) => host === "dual.approval.test").length === 2, "both commands reached CONNECT")
  await click(copy, dual, "deny")
  await Promise.all([first.done, second.done])
  expect(logs.some((line) => line.event === "egress.connect" && line.verdict === "deny" && line.detail === "user-denied")).toBe(true)
  const timeout = await begin(a, "shell", { command: command("timeout.approval.test") })
  const expiring = await card(a, "timeout.approval.test")
  expect(Date.parse(expiring.connectionDeadlineAt)).toBeGreaterThan(Date.parse(expiring.createdAt))
  await timeout.done
  expect(logs.some((line) => line.event === "egress.connect" && line.detail === "approval-timeout")).toBe(true)
  await until(() => host.textContent?.includes("这次连接已失败"), "expired connection explanation")
}, 90_000)

test("AC-09 记住站点不改项目；重建 main 服务与真实引擎后兄弟域和另端口直接通", async () => {
  const a = await session()
  const host = mount(a)
  const before = tree(prepared.project)
  const running = await begin(a, "shell", { command: command("a.example.com") })
  await click(host, await card(a, "a.example.com"), "allow-persist")
  await running.done
  expect(tree(prepared.project)).toBe(before)
  expect(readFileSync(siteFile, "utf8")).toContain('"value":"example.com"')
  renewService()
  generation++
  attach(await rpc("fixture.restart") as { url: string; authorization: string })
  await until(() => activity.snapshot().complete, "restart activity snapshot")
  const b = await session()
  const from = model.requests.length
  const retried = await begin(b, "shell", { command: `${command("b.example.com")}; ${command("example.com", 81)}` })
  await retried.done
  expect(modelText(from)).toContain("egress-target-okegress-target-ok")
  expect(modelText(from)).not.toContain(NETWORK_EGRESS_NOTE)
  expect(messages.filter((message) => message.type === "codepuppy.network.notice" && message.destination.host === "b.example.com")).toEqual([])
  console.log("EGRESS-RESTART", JSON.stringify({ generation, remembered: true }))
}, 30_000)

test("AC-10 真实工具与 shell 不能改 sites、临时文件、父目录或软链", async () => {
  const a = await session()
  const original = readFileSync(siteFile, "utf8")
  for (const path of [siteFile, join(prepared.project, "sites-link"), `${siteFile}.attack.tmp`]) {
    const attack = await begin(a, "shell", { command: `printf '%s' 'CORRUPTED' > ${shellQuote(path)}` })
    await attack.done
    expect(readFileSync(siteFile, "utf8"), "protected sites bytes").toBe(original)
  }
  expect(existsSync(`${siteFile}.attack.tmp`)).toBe(false)
  const write = await begin(a, "write", { path: siteFile, content: "CORRUPTED" })
  await write.done
  expect(readFileSync(siteFile, "utf8"), "write tool must preserve sites").toBe(original)
  const rename = await begin(a, "shell", { command: `/bin/mv ${shellQuote(dirname(siteFile))} ${shellQuote(`${dirname(siteFile)}-moved`)}` })
  await rename.done
  expect(readFileSync(siteFile, "utf8"), "parent rename must preserve sites").toBe(original)
}, 30_000)

test("AC-11 设置撤销立即生效，main 与引擎不重启，下一次真实 CONNECT 重新询问", async () => {
  const host = document.createElement("div")
  document.body.append(host)
  disposers.push(runtime.render(() => runtime.createComponent(runtime.SettingsNetworkEgress, { api: service.api }), host))
  const button = await until(() => host.querySelector<HTMLButtonElement>('[data-network-egress-site="example.com"] button'), "remembered site in settings")
  button.click()
  await until(async () => !service.authorized("b.example.com", 80), "immediate revoke")
  const a = await session()
  const running = await begin(a, "shell", { command: command("b.example.com") })
  const pending = await card(a, "b.example.com")
  await service.api.decide({ requestID: pending.requestID, decision: "deny" })
  await running.done
  expect(host.querySelector('[data-network-egress-site="example.com"]')).toBeNull()
  expect(generation).toBe(2)
}, 20_000)

test("AC-12 模型请求确实收到拒绝说明；普通成功及获准后没有保护说明", async () => {
  const a = await session()
  const from = model.requests.length
  const running = await begin(a, "shell", { command: command("notice.approval.test") })
  const pending = await card(a, "notice.approval.test")
  await service.api.decide({ requestID: pending.requestID, decision: "deny" })
  await running.done
  expect(modelText(from), "actual model tool result must contain network notice").toContain(NETWORK_EGRESS_NOTE)
  const b = await session()
  const ordinaryFrom = model.requests.length
  await (await begin(b, "shell", { command: "printf ordinary-ok" })).done
  expect(modelText(ordinaryFrom)).toContain("ordinary-ok")
  expect(modelText(ordinaryFrom)).not.toContain(NETWORK_EGRESS_NOTE)
}, 20_000)

test("N2 用户 !command 与后台 shell 的真实事件仍投递对话批准，退出后清理", async () => {
  const a = await session()
  const user = call("POST", `/api/session/${a}/shell`, { command: command("user.approval.test") })
  const pending = await card(a, "user.approval.test")
  expect(activity.snapshot().activities.some((item) => item.kind === "shell" && item.session.sessionID === a)).toBe(true)
  await service.api.decide({ requestID: pending.requestID, decision: "deny" })
  await user
  const background = await begin(a, "shell", { command: `sleep 1; ${command("background.approval.test")}`, background: true })
  await background.done
  const next = await card(a, "background.approval.test")
  expect(activity.snapshot().activities.some((item) => item.kind === "shell" && item.session.sessionID === a)).toBe(true)
  const from = model.requests.length
  await (await begin(a, "shell", { command: "printf waiting-context" })).done
  expect(model.requests.slice(from).some((request) => request.messages.some((message) => message.role === "system" && textOf(message.content).includes(NETWORK_EGRESS_NOTE))), "background waiting context reaches the model").toBe(true)
  await service.api.decide({ requestID: next.requestID, decision: "deny" })
  await until(() => !activity.snapshot().activities.some((item) => item.kind === "shell" && item.session.sessionID === a), "shell exit cleanup")
}, 25_000)


test("通放与混合档：真引擎真围栏独占 allow 无卡逐次记账，混入 ask 后出卡", async () => {
  const a = await session()
  await service.api.setTier({ session: ref(a), tier: "allow" })
  const from = model.requests.length
  for (let index = 0; index < 2; index++) {
    const before = logs.length
    const running = await begin(a, "shell", { command: command("198.18.0.1") })
    const observed = await until(async () => {
      const cards = await service.api.listApprovals({ session: ref(a) })
      const pending = cards.ok ? cards.value.filter((card) => card.state === "pending") : []
      return logs.slice(before).some((record) => record.event === "egress.policy-pass") || pending.length ? { pending } : undefined
    }, "allow-all policy pass or unexpected card")
    // Settle the known-bad arm promptly; it must fail on the card, without waiting 45 s.
    for (const card of observed.pending) await service.api.decide({ requestID: card.requestID, decision: "deny" })
    await running.done
    expect(observed.pending, "allow-only must not create a card").toEqual([])
  }
  expect(modelText(from)).toContain("egress-target-ok")
  const records = readFileSync(passFile, "utf8").trim().split("\n").map((line) => JSON.parse(line))
  expect(records.filter((record) => record.destination.host === "198.18.0.1")).toHaveLength(2)
  expect(await service.api.settings()).toMatchObject({ ok: true, value: { passes: [{ destination: { host: "198.18.0.1", port: 80 }, count: 2 }] } })
  const b = await session()
  const holding = await begin(b, "shell", { command: command("hold.approval.test") })
  const held = await card(b, "hold.approval.test")
  const mixed = await begin(a, "shell", { command: command("198.18.0.1") })
  const pending = await card(a, "198.18.0.1")
  await service.api.decide({ requestID: pending.requestID, decision: "deny" })
  await mixed.done
  await service.api.decide({ requestID: held.requestID, decision: "deny" })
  await holding.done
  expect(readFileSync(passFile, "utf8").trim().split("\n")).toHaveLength(2)
}, 30_000)

test("通放拒绝非公网：真实命令发送数字短写、私网与 IANA 保留地址", async () => {
  const a = await session()
  await service.api.setTier({ session: ref(a), tier: "allow" })
  const before = logs.length
  for (const host of ["127.1", "10.1", "198.51.100.1"]) {
    const source = `import socket; s=socket.create_connection(("127.0.0.1",${proxy.port})); s.sendall(b"CONNECT ${host}:80 HTTP/1.1\\r\\nHost: ${host}:80\\r\\n\\r\\n"); print(s.recv(4096).decode()); s.close()`
    const from = model.requests.length
    await (await begin(a, "shell", { command: `/usr/bin/python3 -c ${shellQuote(source)}` })).done
    expect(modelText(from), host).toContain("403")
  }
  expect(logs.slice(before).filter((record) => record.event === "egress.policy-pass")).toEqual([])
  expect(logs.slice(before).filter((record) => record.event === "egress.connect" && record.detail === "non-public")).toHaveLength(3)
}, 30_000)

test("系统路由注入：真实引擎围栏连接仅由本地上游代理承接的目标", async () => {
  const a = await session()
  const before = upstreamConnects.length
  const from = model.requests.length
  await (await begin(a, "shell", { command: command("via-proxy.egress.invalid") })).done
  expect(modelText(from)).toContain("egress-target-ok")
  expect(upstreamConnects.slice(before)).toContain("via-proxy.egress.invalid:80")
  expect((await service.api.listApprovals({ session: ref(a) }))).toEqual({ ok: true, value: [] })
}, 20_000)


test("AC-14 没有对话在运行工具时，引擎启动的连接器联网，卡片出现在正看着的对话；切到另一个对话也出现，在哪里决定都算同一次", async () => {
  await idle()
  const a = await session()
  const b = await session()
  const shown = view(a)
  const target = "198.18.0.14:80"
  const asked = connects.length
  const before = logs.length
  reach(target)
  // Known-bad arm (no viewed delivery): no card ever comes and the connection ends with the 45 s window; report why.
  await until(() => shown.host.querySelector("[data-network-egress-request]") || reached(target).length, "connector CONNECT", 60_000)
  const shownCard = shown.host.querySelector<HTMLElement>("[data-network-egress-request]")
  expect(shownCard, `viewed conversation shows no card; connector got ${JSON.stringify(reached(target))}; proxy ${JSON.stringify(logs.slice(before).filter((record) => record.event === "egress.connect" && record.host === "198.18.0.14"))}`).not.toBeNull()
  expect(shownCard!.textContent).toContain(target)
  expect(shownCard!.textContent).toContain("此时没有对话在运行工具")
  const approval = await card(a, "198.18.0.14")
  expect(approval.recipients).toEqual([])
  await click(shown.host, approval, "allow-session")
  const [allowed] = await until(() => reached(target).length ? reached(target) : undefined, "allowed connection outcome")
  expect(allowed!.connect).toStartWith("HTTP/1.1 200")
  expect(allowed!.response).toContain("egress-target-ok")
  reach(target)
  await until(() => reached(target).length === 2, "the connector connects again")
  expect(reached(target)[1]!.response).toContain("egress-target-ok")
  expect(connects.slice(asked), "the second connection asks nobody").toEqual(["198.18.0.14"])
  expect(upstreamConnects).toContain(target)

  const other = "198.18.0.15:80"
  reach(other)
  const waiting = await card(a, "198.18.0.15")
  shown.leave()
  const next = view(b)
  await until(() => next.host.querySelector(`[data-network-egress-request="${waiting.requestID}"]`)?.textContent?.includes("此时没有对话在运行工具"), "B shows the same waiting card")
  const back = view(a)
  await until(() => back.host.querySelector(`[data-network-egress-request="${waiting.requestID}"] [data-network-egress-decision]`), "A still offers the choice")
  await click(next.host, waiting, "deny")
  const [denied] = await until(() => reached(other).length ? reached(other) : undefined, "the decision in B settles the waiting connection")
  expect(denied!.connect).toStartWith("HTTP/1.1 403")
  await until(() => !back.host.querySelector(`[data-network-egress-request="${waiting.requestID}"]`), "A no longer offers the choice")
  expect(logs.some((record) => record.event === "egress.connect" && record.host === "198.18.0.15" && record.detail === "user-denied")).toBe(true)
  expect(messages.filter((message) => message.type === "codepuppy.network.notice" && ["198.18.0.14", "198.18.0.15"].includes(message.destination.host))).toEqual([])
  console.log("EGRESS-AC14-VIEWED", JSON.stringify({ mainPID: process.pid, enginePID, allowed: reached(target), denied }))
  next.leave(); back.leave()
}, 90_000)

test("AC-14 没有在看任何对话：不出卡片，等待期满后这次连接以原因失败；之后打开对话也没有这张卡", async () => {
  await idle()
  const target = "198.18.0.16:80"
  const asked = connects.length
  const before = logs.length
  const started = Date.now()
  reach(target)
  // Nothing may list approvals before the window ends: a conversation that lists them is one being viewed.
  const [ended] = await until(() => reached(target).length ? reached(target) : undefined, "the unviewed connection ends", 60_000)
  expect(ended!.connect).toStartWith("HTTP/1.1 403")
  expect(connects.slice(asked)).toEqual(["198.18.0.16"])
  expect(logs.slice(before).filter((record) => record.event === "egress.connect" && record.host === "198.18.0.16").map((record) => record.detail)).toEqual(["approval-unavailable"])
  const a = await session()
  const opened = view(a)
  expect(await service.api.listApprovals({ session: ref(a) })).toEqual({ ok: true, value: [] })
  expect(opened.host.querySelector("[data-network-egress-request]")).toBeNull()
  expect(messages.filter((message) => message.type === "codepuppy.network.notice" && message.destination.host === "198.18.0.16")).toEqual([])
  console.log("EGRESS-AC14-UNVIEWED", JSON.stringify({ mainPID: process.pid, enginePID, waitedMs: Date.now() - started, ended }))
  opened.leave()
}, 90_000)

}
