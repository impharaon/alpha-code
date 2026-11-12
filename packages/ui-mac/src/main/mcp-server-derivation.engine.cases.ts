// `#1381`(`#1383` 基线 §四 子票 4)的真引擎那一半,在 OpenCode 2 上(`#1662`;v1 版跑的是已删的 `packages/opencode/src/index.ts debug config`,
// env 接线 OPENCODE_CONFIG / OPENCODE_CONFIG_CONTENT / XDG):嵌入式引擎拿到生产注入之后**真的去连谁**。三个远程地址都是本机一个记录请求的
// 监听的不同路径,引擎连了哪条、带了什么头,逐条看得见:
//   正样本:真源里的 my-mcp ⇒ 引擎连的是真源地址、带着真源的头;用户全局配置里同名条目指的别处一个请求都收不到。
//   反样本(承重):codepuppy.jsonc 里一条 `type:"remote"`(经显式文件进引擎)⇒ 一个请求都收不到,`GET /api/mcp` 里是 disabled;
//   用户全局配置里的陌生远程条目同样;codepuppy.jsonc 里的本地条目原样留在引擎里(不被压成 disabled)。
// 手段自证:同一份配置文件,把注入里压 exfil 的中和条目去掉(`#1381` 之前的形状)⇒ 引擎真的去连 exfil 地址。
// 生产里注入读用户全局配置的目录与引擎的全局配置目录是同一个(engineGlobalConfigDirectory);宿主按槽给引擎各分一个目录,所以同一份
// 用户全局配置两处都写。本文件由 mcp-server-derivation.test.ts 起独立 `bun test` 子进程跑;HOME / XDG 全在临时沙箱里。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { engineGlobalConfigDirectory } from "./engine-paths"
import { writeMcpServerTruth } from "./mcp-server-truth-write"

const sandbox = engineSandbox()
const model = scriptedModel()
const engines: Running[] = []
const hits: Array<{ route: string; token: string | null }> = []
const listener = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    hits.push({ route: new URL(request.url).pathname.split("/")[1]!, token: request.headers.get("x-token") })
    return new Response("not an MCP server", { status: 404 })
  },
})
const at = (route: string) => `http://127.0.0.1:${listener.port}/${route}/mcp`

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})
afterAll(async () => {
  for (const engine of engines) await engine.close().catch(() => undefined)
  model.stop()
  listener.stop(true)
})

/** 一台机器:真源一条远程 MCP;codepuppy.jsonc 一条远程 + 一条本地;用户全局配置一条同名(指别处)+ 一条陌生远程。 */
function machine(name: string) {
  const stateRoot = path.join(sandbox.root, `${name}-state`, "codepuppy-state")
  fs.mkdirSync(path.join(stateRoot, "env", "dev"), { recursive: true })
  writeMcpServerTruth(path.join(stateRoot, "mcp-servers", "dev.json"), [{ name: "my-mcp", url: at("truth"), headers: { "X-Token": "t" } }], {
    mkdirSync: fs.mkdirSync,
    writeFileSync: fs.writeFileSync,
    renameSync: fs.renameSync,
    rmSync: fs.rmSync,
  })
  const missing = path.join(sandbox.root, "no-such-mcp-binary")
  fs.writeFileSync(
    path.join(stateRoot, "env", "dev", "codepuppy.jsonc"),
    JSON.stringify({ mcp: { servers: { "exfil-mcp": { type: "remote", url: at("exfil") }, "local-ok": { type: "local", command: [missing] } } } }),
  )
  // 放行句一并写上(`#1662`):全局目录在显式文件之前载入、跨文档的策略最早载入者优先 —— 而 2.x 的 mcp.use 只在 deny 时拿掉 server,
  // Code Puppy 压住它们用的是内联文档里的中和条目(设置,后载入者赢),所以这几句放行抬不起它们。
  const userGlobal = JSON.stringify({
    mcp: { servers: { "my-mcp": { type: "remote", url: at("user-global") }, stray: { type: "remote", url: at("stray") } } },
    policies: ["stray", "exfil-mcp"].map((resource) => ({ action: "mcp.use", resource, effect: "allow" })),
  })
  const injectionReads = engineGlobalConfigDirectory(process.env, sandbox.home)
  fs.mkdirSync(injectionReads, { recursive: true })
  fs.writeFileSync(path.join(injectionReads, "opencode.json"), userGlobal)
  const host = codepuppyEngine({ sandbox, name, modelBaseURL: model.baseURL })
  fs.writeFileSync(path.join(host.slot.configDirectory, "opencode.json"), userGlobal)
  return host
}

type Listed = { name: string; status: { status: string } }

/** 起引擎,等 my-mcp 离开 pending(连过一次),返回每个服务的状态与这台引擎期间的请求。 */
async function connected(host: ReturnType<typeof machine>) {
  const before = hits.length
  const engine = await host.start()
  engines.push(engine)
  let servers: Listed[] = []
  for (let i = 0; i < 100; i++) {
    servers = ((await engine.send("GET", "/api/mcp")).json?.data ?? []) as Listed[]
    const mine = servers.find((server) => server.name === "my-mcp")?.status.status
    if (mine && mine !== "pending") break
    await Bun.sleep(100)
  }
  await Bun.sleep(500) // 其余服务若会去连,给它们同样的时间
  return { status: Object.fromEntries(servers.map((server) => [server.name, server.status.status])), requests: hits.slice(before) }
}

describe("#1381 端到端(OpenCode 2):嵌入式引擎只连真源里的远程 MCP;codepuppy.jsonc 与用户全局里不受治理的远程条目一个请求都不发", () => {
  test("正样本 + 反样本:真源地址收到带真源头的请求,同名的用户全局地址零请求;exfil-mcp / stray 零请求且 disabled;本地条目还在", async () => {
    const { status, requests } = await connected(machine("mcp-derivation"))
    const routes = requests.map((request) => request.route)
    expect(routes).toContain("truth")
    expect(requests.filter((request) => request.route === "truth").every((request) => request.token === "t")).toBe(true)
    expect(routes.filter((route) => route !== "truth")).toEqual([])
    expect(status["exfil-mcp"]).toBe("disabled")
    expect(status.stray).toBe("disabled")
    expect(status["local-ok"]).toBeDefined()
    expect(status["local-ok"]).not.toBe("disabled")
  }, 90_000)

  test("手段自证:同一份配置文件,注入里去掉压 exfil-mcp 的中和条目(`#1381` 之前的形状)⇒ 引擎真的去连 exfil 地址", async () => {
    const host = machine("mcp-derivation-prefix")
    const content = host.content as unknown as { mcp?: { servers?: Record<string, unknown> } }
    expect(content.mcp?.servers?.["exfil-mcp"]).toBeDefined()
    delete content.mcp!.servers!["exfil-mcp"]
    const { status, requests } = await connected(host)
    expect(requests.map((request) => request.route)).toContain("exfil")
    expect(status["exfil-mcp"]).not.toBe("disabled")
  }, 90_000)
})
