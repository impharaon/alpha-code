// `#1449` AC1 / `#1445` AC1(ADR-035 E7「搜网失败要诚实」)在 OpenCode 2 上(`#1662` parity 第 1、2 项,编排器 2026-11-12 裁决选项 2):
// Exa 的四种结局到模型面各是一句不同的话 —— 出错 ⇒ 具名失败;额度提示(D)⇒ 供应商原文;真零命中 ⇒「没搜到」;429 ⇒ 具名失败。
//
// 宿主:test-component/codepuppy-engine.ts(生产注入 + 真 ext);模型桩发出一次 `websearch` 调用,判据是模型下一轮收到的那条工具
// 消息(就是模型面;失败时是 `{"error":{"type":"tool.execution","message":…}}`,判 message)。Exa 的响应是仓里的实抓件(`docs/verification/2026-09-24-1445-exa-mcp-response-shapes/results/`,v1 测试用的同一批):
// B 臂三条 in-band 错误(HTTP 200 SSE、`isError: true`)、C 臂免费额度用尽(HTTP 429 + JSON-RPC error)、D 臂额度提示(200、非 isError
// 的 246 字散文,ticket-payload.json)、Z2 真零命中(`content: []`)。期望值是手写字面量(0.1.26 的措辞与实抓原文),不从被测代码派生。
// 网络:引擎的 HttpClient 与 ext 都用进程里的 `fetch`(packages/util/src/effect/app-node-platform.ts:引擎起图时取它),本文件在起引擎
// 之前换成桩:`mcp.exa.ai` 一律回当前实抓件,回环照常,其它任何主机直接抛错 —— 一个真实请求都发不出去(先证明引擎的请求确实经过桩)。
// 已知的坏:同一份配置不装 ext、经用户配置选 exa(上游 exa.ts 在跑)⇒ 出错与 D 都塌成「没搜到」。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, textOf, type Running } from "../../test-component/codepuppy-engine"

// ── 网络桩(必须在起引擎之前)──────────────────────────────────────────────────────────────────
const original = globalThis.fetch
const exa = { body: "", status: 200, type: "text/event-stream", calls: 0 }
const traffic = { loopback: 0 }
globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.hostname === "mcp.exa.ai") {
    exa.calls++
    return new Response(exa.body, { status: exa.status, headers: { "content-type": exa.type } })
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error(`no network in this test (${url.hostname})`)
  traffic.loopback++
  return original(input, init)
}) as typeof globalThis.fetch

// ── 实抓件 ───────────────────────────────────────────────────────────────────────────────────────
const shapes = path.resolve(import.meta.dir, "../../../../docs/verification/2026-09-24-1445-exa-mcp-response-shapes/results")
type Arm = { arm: string; status: number; isError: boolean | null; jsonrpcErrorCode: number | null; textHead: string }
const arms = (JSON.parse(readFileSync(path.join(shapes, "arms.json"), "utf8")) as { rows: Arm[] }).rows
const inband = arms.filter((row) => row.isError === true)
const rateLimited = arms.find((row) => row.arm === "nokey-search")!
const notice = (JSON.parse(readFileSync(path.join(shapes, "ticket-payload.json"), "utf8")) as { text: string }).text
const sse = (result: unknown) => `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result })}\n\n`
const NO_RESULTS = "No search results found. Please try a different query."
const firstLine = (text: string) => text.split("\n")[0]!

const sandbox = engineSandbox()
const model = scriptedModel()
const engines: Running[] = []
beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})
afterAll(async () => {
  for (const engine of engines) await engine.close().catch(() => undefined)
  model.stop()
  globalThis.fetch = original
})

async function engineWith(name: string, ext: boolean) {
  const host = codepuppyEngine({
    sandbox,
    name,
    modelBaseURL: model.baseURL,
    ext,
    // 不装 ext 时没有 Code Puppy 的默认选择,由用户配置选 exa(同一个上游 opencode.config.websearch)
    projectFiles: ext ? {} : { "opencode.json": JSON.stringify({ websearch: { provider: "exa" } }) },
  })
  const engine = await host.start()
  engines.push(engine)
  return { engine, directory: host.projectDirectory }
}

/** 让 Exa 回这一份,发一轮调一次 websearch,返回模型下一轮收到的那条工具消息。 */
async function modelFace(target: { engine: Running; directory: string }, body: string, status = 200, type = "text/event-stream") {
  Object.assign(exa, { body, status, type })
  const calls = exa.calls
  const before = model.requests.length
  const sessionID = (await target.engine.send("POST", "/api/session", { location: { directory: target.directory }, model: { id: "m", providerID: "codepuppy" } })).json.data.id as string
  await target.engine.send("POST", `/api/session/${sessionID}/prompt`, { text: `CP-CALL ${JSON.stringify({ name: "websearch", args: { query: "cp parity" } })}` })
  await target.engine.send("POST", `/api/experimental/session/${sessionID}/wait`)
  expect(exa.calls).toBe(calls + 1)
  const followUp = model.requests.slice(before).find((request) => request.messages.at(-1)?.role === "tool")
  expect(followUp, "the model never received the websearch tool message").toBeDefined()
  // 工具失败到模型面是 `{"error":{"type":"tool.execution","message":…}}`;成功是正文本身
  const text = textOf(followUp!.messages.at(-1)!.content)
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } }
    if (typeof parsed?.error?.message === "string") return parsed.error.message
  } catch {}
  return text
}

describe("#1449 / #1445:Exa 的结局在模型面各是一句不同的话(Code Puppy 的 exa 供应商)", () => {
  let target: Awaited<ReturnType<typeof engineWith>>
  const faces: Record<string, string> = {}

  test("前提:引擎的出站请求经过本文件的网络桩;ext 顶替之后恰好一个 exa 供应商", async () => {
    target = await engineWith("websearch-honest", true)
    const loopback = traffic.loopback
    faces.zero = await modelFace(target, sse({ content: [] }))
    expect(traffic.loopback).toBeGreaterThan(loopback)
    const providers = (await target.engine.send("GET", "/api/websearch/provider")).json.data as Array<{ id: string }>
    expect(providers.filter((provider) => provider.id === "exa")).toHaveLength(1)
  }, 60_000)

  test("真零命中(content: [])⇒「没搜到」", async () => {
    expect(faces.zero).toBe(NO_RESULTS)
  })

  test("出错(三条 in-band isError 实抓件)⇒ 具名失败,带供应商原文,不是「没搜到」", async () => {
    expect(inband).toHaveLength(3)
    for (const row of inband) {
      const face = await modelFace(target, sse({ content: [{ type: "text", text: row.textHead }], isError: true }))
      expect([row.arm, face.includes("Web search failed: the provider reported an error. Cause: ")]).toEqual([row.arm, true])
      expect([row.arm, face.includes(firstLine(row.textHead).replaceAll(/\s+/g, " ").trim())]).toEqual([row.arm, true])
      expect(face).not.toContain(NO_RESULTS)
      faces[row.arm] = face
    }
  }, 60_000)

  test("额度提示(D,246 字原文)⇒ 原文逐字到模型面", async () => {
    expect(notice.length).toBe(246)
    faces.notice = await modelFace(target, sse({ content: [{ type: "text", text: notice }] }))
    expect(faces.notice).toBe(notice)
  }, 30_000)

  test("429 免费额度用尽 ⇒ 具名失败,带 HTTP 429 与上游原文", async () => {
    faces.limited = await modelFace(
      target,
      JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: rateLimited.jsonrpcErrorCode, message: rateLimited.textHead } }),
      rateLimited.status,
      "application/json",
    )
    expect(faces.limited).toContain("Web search failed: unexpected HTTP status (HTTP 429). Cause: ")
    expect(faces.limited).toContain(firstLine(rateLimited.textHead))
  }, 30_000)

  test("四种结局两两不同", () => {
    const four = [faces.zero, faces[inband[0]!.arm], faces.notice, faces.limited]
    expect(new Set(four).size).toBe(4)
  })

  test("已知的坏:不装 ext(上游 exa.ts 在跑)⇒ 出错与 D 都塌成「没搜到」", async () => {
    const upstream = await engineWith("websearch-upstream", false)
    expect(await modelFace(upstream, sse({ content: [{ type: "text", text: inband[0]!.textHead }], isError: true }))).toBe(NO_RESULTS)
    expect(await modelFace(upstream, sse({ content: [{ type: "text", text: notice }] }))).toBe(NO_RESULTS)
  }, 60_000)
})
