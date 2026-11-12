// REQ-236 AC3(`#1562`)在 OpenCode 2 上(`#1662` parity 第 6 项;v1 的 packages/opencode/test/session/codepuppy-platform-credential-error.test.ts
// 随换代删除):平台凭据出错 —— 本机读不到凭据,或网关回 401 / 403 —— 这一轮失败一次、带名字,不进引擎的退避重试
// (否则确定性的认证失败要等约 80 秒才显示给用户)。
//
// 宿主:test-component/codepuppy-engine.ts(生产注入 + 真 ext);平台节点经 `CODEPUPPY_BASE_URL` 指向本文件的假网关。只数这一轮
// 真正的模型请求(带工具的那一个;起标题的请求不带工具)。凭据是合成值,用例输出只有计数。
//   ① 凭据文件缺席 ⇒ 网关零请求,这一轮失败,错误就是 ext 那句具名的话,2 秒内结束(引擎退避的第一个间隔是 2 秒,
//      packages/core/src/model-retry.ts);
//   ② 网关回 401 / 403 ⇒ 模型请求恰好一次,错误类型 provider.auth,2 秒内结束;
// 已知的坏:网关回 503(可重试)⇒ 同一轮的模型请求不止一次 —— 证明计数看得见退避重试。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, type Running } from "../../test-component/codepuppy-engine"
import { secretFilePath, syncSecretFiles } from "./codepuppy-secret-files"

const sandbox = engineSandbox()
const TOKEN = `SENTINEL-PLATFORM-ERROR-${crypto.randomUUID()}`
const gate = { status: 200, main: 0 }
const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
  `data: ${JSON.stringify({ id: "chatcmpl-cp-err", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
const gateway = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (!request.url.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
    const body = (await request.json()) as { tools?: unknown[] }
    if ((body.tools ?? []).length > 0) gate.main++
    if (gate.status !== 200) return Response.json({ error: { message: `gateway refused (${gate.status})`, type: "error" } }, { status: gate.status })
    return new Response(chunk({ role: "assistant", content: "ok" }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  },
})

let host: ReturnType<typeof codepuppyEngine>
let running: Running | undefined
beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  host = codepuppyEngine({ sandbox, name: "platform-error", modelBaseURL: `http://127.0.0.1:${gateway.port}/v1` })
  syncSecretFiles(host.userData, { CODEPUPPY_API_KEY: TOKEN })
  running = await host.start()
}, 60_000)
afterAll(async () => {
  await running?.close().catch(() => undefined)
  gateway.stop(true)
})

/** 发一轮;`settle` 之前一直等它结束。返回这一轮的模型请求数、耗时与结局。 */
async function turn(settle: (sessionID: string) => Promise<unknown> = (sessionID) => running!.send("POST", `/api/experimental/session/${sessionID}/wait`)) {
  const before = gate.main
  const sessionID = (await running!.send("POST", "/api/session", { location: { directory: host.projectDirectory }, model: { id: "m", providerID: "codepuppy" } })).json.data.id as string
  const started = Date.now()
  await running!.send("POST", `/api/session/${sessionID}/prompt`, { text: "hi" })
  await settle(sessionID)
  const ms = Date.now() - started
  const messages = (await running!.send("GET", `/api/session/${sessionID}/message`)).json.data as Array<{ type: string; outcome?: string; error?: { type?: string; message?: string } }>
  const idle = messages.find((message) => message.type === "idle")
  const assistant = messages.find((message) => message.type === "assistant") as { error?: { type?: string; message?: string } } | undefined
  return { requests: gate.main - before, ms, outcome: idle?.outcome, error: idle?.error ?? assistant?.error }
}

describe("REQ-236 AC3:平台凭据出错 ⇒ 失败一次、带名字,不进退避重试", () => {
  test("对照:凭据在、网关放行 ⇒ 这一轮恰好一次模型请求,成功", async () => {
    gate.status = 200
    const result = await turn()
    expect([result.requests, result.outcome]).toEqual([1, "succeeded"])
  }, 30_000)

  test("① 凭据文件缺席 ⇒ 网关零请求,具名失败,2 秒内结束", async () => {
    const file = secretFilePath(host.userData, "CODEPUPPY_API_KEY")
    fs.rmSync(file)
    try {
      const result = await turn()
      expect(result.requests).toBe(0)
      expect(result.outcome).toBe("failed")
      expect(result.error?.message).toContain("Code Puppy platform credential could not be read")
      expect(result.ms).toBeLessThan(2000)
    } finally {
      fs.writeFileSync(file, TOKEN, { mode: 0o600 })
    }
  }, 30_000)

  for (const status of [401, 403])
    test(`② 网关回 ${status} ⇒ 模型请求恰好一次,provider.auth,2 秒内结束`, async () => {
      gate.status = status
      try {
        const result = await turn()
        expect(result.requests).toBe(1)
        expect(result.error?.type).toBe("provider.auth")
        expect(result.ms).toBeLessThan(2000)
      } finally {
        gate.status = 200
      }
    }, 30_000)

  test("已知的坏:网关回 503(可重试)⇒ 同一轮的模型请求不止一次(计数看得见退避重试)", async () => {
    gate.status = 503
    try {
      const result = await turn(async (sessionID) => {
        const before = gate.main
        for (const until = Date.now() + 8000; Date.now() < until && gate.main - before < 2; ) await Bun.sleep(50)
        await running!.send("POST", `/api/session/${sessionID}/interrupt`)
        await running!.send("POST", `/api/experimental/session/${sessionID}/wait`)
      })
      expect(result.requests).toBeGreaterThanOrEqual(2)
    } finally {
      gate.status = 200
    }
  }, 30_000)
})
