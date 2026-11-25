// REQ-236 AC2 / AC3(`#1562`)在 OpenCode 2 上(`#1662` parity B4;v1 版起的是已删的 `packages/opencode/src/index.ts serve`):
// 续期热应用的端到端判据 —— 嵌进 sidecar 的那台引擎 + 真 ext + 本机假网关,一个引擎实例里换凭据文件。
//
// 宿主:test-component/codepuppy-engine.ts(生产注入 + 真 ext);平台节点经启动文档的 platform.modelProxyBaseURL 指向本文件的假网关,
// ext 的凭据头经文档的 platform.credentialRef(生产 `secretFileRef` 同形)每次现读(`#1698` G2,此前是两个环境变量)。凭据文件由生产 `syncSecretFiles`(fork 时)与
// `applyPlatformCredentialsHot`(续期时)写。假网关只认这两个合成令牌,别的(含注入写的占位 apiKey)一律 401 —— 与真网关同一结论。
//   ① 令牌 A ⇒ 网关收到的每个请求都带 `Bearer A`(占位值一次都不上线);
//   ② 热应用令牌 B(不重启)⇒ 下一轮每个请求都带 `Bearer B`,一个 A 都没有;
//   ③ 删掉凭据文件(main 随后推来的整表里没有它)⇒ 这一轮以 ext 的具名错误失败,网关一个请求都没收到(发出前被拒,不回落);
//   SPEC-stored-credentials-fence 起引擎进程只从主进程交来的内存表读凭据:fork 时随 start 交整表(T1),续期写盘后整表推送(T2,
//   生产 applyPlatformCredentialsHot 的 push 形参;宿主的 main 那一侧是 test-component/credential-table.ts);
//   ④ 反向臂:同一份配置不装 ext ⇒ 网关收到的是占位值、被拒 —— 证明 ①② 的令牌确实来自 ext,不是配置里藏着凭据;
//   哨兵臂:两个令牌一次都不出现在引擎的日志输出与 HTTP 响应体里。
//   平台节点地址的写法变体(大写主机 / 显式默认端口 / 末尾斜杠 / 主机末尾一个点)与像而不是的地址,在 ext 的
//   platform-credential-header.test.ts 里逐个判(那是 `#1662` r6 那个 bug 的回归用例);这里不再每种写法各起一台引擎。
// 合成令牌只在本进程里;用例输出只有布尔值与计数。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, type Running } from "../../test-component/codepuppy-engine"
import { handOverCredentials } from "../../test-component/credential-table"
import { PLATFORM_API_KEY_PLACEHOLDER } from "./codepuppy-models"
import { applyPlatformCredentialsHot, secretFilePath, syncSecretFiles } from "./codepuppy-secret-files"

const sandbox = engineSandbox()
const TOKEN_A = `SENTINEL-HOT-APPLY-A-${crypto.randomUUID()}`
const TOKEN_B = `SENTINEL-HOT-APPLY-B-${crypto.randomUUID()}`
type Hit = "A" | "B" | "placeholder" | "other" | "none"
const hits: Hit[] = []
const bodies: string[] = []
const logged: string[] = []

const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "chatcmpl-cp-hot", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (!request.url.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
    await request.text()
    const authorization = request.headers.get("authorization")
    const hit: Hit =
      authorization === `Bearer ${TOKEN_A}` ? "A" : authorization === `Bearer ${TOKEN_B}` ? "B" : authorization === `Bearer ${PLATFORM_API_KEY_PLACEHOLDER}` ? "placeholder" : authorization ? "other" : "none"
    hits.push(hit)
    if (hit !== "A" && hit !== "B") return Response.json({ error: { message: "invalid credential", type: "invalid_request_error" } }, { status: 401 })
    return new Response(chunk({ role: "assistant", content: "ok" }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  },
})

// ⑤ 的网络桩(必须在起引擎之前):这几个不存在的主机由本文件当网关答,回环照常,其它主机一律抛错
const FAKE_HOSTS = new Set(["gw.example", "gw.example.", "gw.example.evil", "evil"])
type Wire = { host: string; path: string; hit: Hit }
const wire: Wire[] = []
const originalFetch = globalThis.fetch
globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (FAKE_HOSTS.has(url.hostname)) {
    const authorization = (input instanceof Request ? input.headers : new Headers(init?.headers)).get("authorization")
    const hit: Hit = authorization === `Bearer ${TOKEN_A}` ? "A" : authorization === `Bearer ${PLATFORM_API_KEY_PLACEHOLDER}` ? "placeholder" : authorization ? "other" : "none"
    const path = url.pathname
    wire.push({ host: url.hostname, path, hit })
    if (!path.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
    if (hit !== "A") return Response.json({ error: { message: "invalid credential", type: "invalid_request_error" } }, { status: 401 })
    return new Response(chunk({ role: "assistant", content: "ok" }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error(`no network in this test (${url.hostname})`)
  return originalFetch(input, init)
}) as typeof globalThis.fetch

// 哨兵臂:引擎在本进程里,它的日志走 stdout / stderr / console —— 全部记下来(照常输出)
const restore: Array<() => void> = []
function record() {
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream)
    stream.write = ((value: unknown, ...rest: unknown[]) => (logged.push(String(value)), write(value as never, ...(rest as never[])))) as typeof stream.write
    restore.push(() => void (stream.write = write))
  }
  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level]
    console[level] = (...args: unknown[]) => (logged.push(args.map((arg) => (typeof arg === "string" ? arg : Bun.inspect(arg))).join(" ")), original(...args))
    restore.push(() => void (console[level] = original))
  }
}

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  record()
})
afterAll(() => {
  for (const undo of restore.reverse()) undo()
  gateway.stop(true)
  globalThis.fetch = originalFetch
})

const baseURL = `http://127.0.0.1:${gateway.port}/v1`

async function turn(engine: Running, directory: string) {
  const send = async (method: string, route: string, body?: unknown) => {
    const result = await engine.send(method, route, body)
    bodies.push(JSON.stringify(result.json ?? null))
    return result
  }
  const before = hits.length
  const sessionID = (await send("POST", "/api/session", { location: { directory }, model: { id: "m", providerID: "codepuppy" } })).json.data.id as string
  await send("POST", `/api/session/${sessionID}/prompt`, { text: "hi" })
  await send("POST", `/api/experimental/session/${sessionID}/wait`)
  const messages = (await send("GET", `/api/session/${sessionID}/message`)).json.data as Array<{ type: string; outcome?: string; error?: { message?: string } }>
  const idle = messages.find((message) => message.type === "idle")
  return { hits: hits.slice(before), outcome: idle?.outcome, error: idle?.error?.message ?? "" }
}

describe("REQ-236 #1562 续期热应用:同一个引擎实例里换凭据文件", () => {
  test("① 令牌 A;② 热应用 B 不重启;③ 删文件 ⇒ 具名失败、网关零请求;哨兵:令牌不进引擎日志与响应体", async () => {
    const host = codepuppyEngine({ sandbox, name: "hot", modelBaseURL: baseURL })
    // fork 时:生产 syncSecretFiles 物化令牌 A,记下 fork 时的凭据集合(server.ts 同形)
    const forked = new Set(syncSecretFiles(host.userData, { CODEPUPPY_API_KEY: TOKEN_A }).written)
    const engine = await host.start()
    try {
      const first = await turn(engine, host.projectDirectory)
      expect(first.hits.length).toBeGreaterThan(0)
      expect([...new Set(first.hits)]).toEqual(["A"])
      expect(first.outcome).toBe("succeeded")

      expect(applyPlatformCredentialsHot(host.userData, { CODEPUPPY_API_KEY: TOKEN_B }, forked, () => handOverCredentials())).toBe("applied")
      expect(fs.readFileSync(secretFilePath(host.userData, "CODEPUPPY_API_KEY"), "utf8") === TOKEN_B).toBe(true)
      const second = await turn(engine, host.projectDirectory)
      expect(second.hits.length).toBeGreaterThan(0)
      expect([...new Set(second.hits)]).toEqual(["B"])
      expect(second.outcome).toBe("succeeded")

      fs.rmSync(secretFilePath(host.userData, "CODEPUPPY_API_KEY"))
      handOverCredentials() // main 推来的整表里不再有它(只删文件不推,引擎进程里仍是上一张表)
      const third = await turn(engine, host.projectDirectory)
      expect(third.hits).toEqual([])
      expect(third.outcome).toBe("failed")
      expect(third.error).toContain("Code Puppy platform credential could not be read")
    } finally {
      await engine.close()
    }
    const output = logged.join("\n")
    for (const token of [TOKEN_A, TOKEN_B]) {
      expect(output.includes(token)).toBe(false)
      expect(bodies.join("\n").includes(token)).toBe(false)
    }
    // 判官自检:记录确实收到了引擎的日志(不是空对空)
    expect(output.length).toBeGreaterThan(0)
  }, 120_000)

  test("④ 反向臂:同一份配置不装 ext ⇒ 网关收到的是占位值、被拒(令牌只来自 ext)", async () => {
    const host = codepuppyEngine({ sandbox, name: "hot-no-ext", modelBaseURL: baseURL, ext: false })
    syncSecretFiles(host.userData, { CODEPUPPY_API_KEY: TOKEN_A })
    const engine = await host.start()
    try {
      const result = await turn(engine, host.projectDirectory)
      expect(result.hits.length).toBeGreaterThan(0)
      expect([...new Set(result.hits)]).toEqual(["placeholder"])
      expect(result.outcome).toBe("failed")
    } finally {
      await engine.close()
    }
  }, 120_000)
})
