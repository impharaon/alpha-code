// `#1668`:表外请求响亮失败 —— 到达 2.x 引擎的唯一通路是路由表,其余在适配器里 501 + console.error,
// 不回退到「猜一个最像的 2.x 端点」;别的源原样交给出网 fetch。
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { createEngineFetch, UNSUPPORTED_ERROR_NAME } from "./index"

const ENGINE = "http://127.0.0.1:47000"

function harness() {
  const seen: string[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    seen.push(`${request.method} ${request.url}`)
    return Response.json({ upstream: true })
  }) as typeof globalThis.fetch
  const engineFetch = createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch })
  return { engineFetch, seen }
}

afterEach(() => {
  ;(console.error as unknown as { mockRestore?: () => void }).mockRestore?.()
})

describe("#1668 适配器的表外请求", () => {
  test("引擎源上的表外请求 ⇒ 恰好 501、错误名指名、带方法与路径,console.error 被调,且一个字节都没发往引擎", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {})
    const { engineFetch, seen } = harness()
    const response = await engineFetch(`${ENGINE}/experimental/workspace?directory=%2Ftmp`)
    expect(response.status).toBe(501)
    expect(await response.json()).toEqual({
      name: UNSUPPORTED_ERROR_NAME,
      data: { method: "GET", path: "/experimental/workspace" },
    })
    expect(error).toHaveBeenCalled()
    expect(seen).toEqual([])
  })

  test("UNSUPPORTED 名单里的请求(分享对话)同样 501,不会被发到任何外部地址", async () => {
    spyOn(console, "error").mockImplementation(() => {})
    const { engineFetch, seen } = harness()
    const response = await engineFetch(`${ENGINE}/session/ses_1/share`, { method: "POST", body: "{}" })
    expect(response.status).toBe(501)
    expect(seen).toEqual([])
  })

  test("对照:别的源原样交给出网 fetch,不进路由表", async () => {
    const { engineFetch, seen } = harness()
    const response = await engineFetch("https://example.invalid/anything", { method: "POST", body: "x" })
    expect(await response.json()).toEqual({ upstream: true })
    expect(seen).toEqual(["POST https://example.invalid/anything"])
  })

  test("对照:表内的直通路由原样转给引擎", async () => {
    const { engineFetch, seen } = harness()
    const response = await engineFetch(`${ENGINE}/api/session/ses_1`)
    expect(response.status).toBe(200)
    expect(seen).toEqual([`GET ${ENGINE}/api/session/ses_1`])
  })
})
