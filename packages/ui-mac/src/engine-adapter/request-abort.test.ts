// `#1668` R1 F5:冻结界面给引擎请求设的取消要真的到 2.x。侧栏自恢复探测(use-projects.ts probeEngine)发的是
// `(info.fetch)(new URL("/global/health", baseUrl), { signal: AbortSignal.timeout(2_000) })` —— 引擎接了连接却不回时,
// 这个上限让自探失败、继续退避重试。这里用同一个调用形状(上限缩短到 50 ms,语义相同)打适配器。
import { describe, expect, test } from "bun:test"
import { createEngineFetch } from "./index"

const ENGINE = "http://127.0.0.1:47006"

/** 接下连接但永不回应的引擎:只在请求被取消时以取消原因拒绝。记下每个请求的信号。 */
function hangingEngine() {
  const signals: AbortSignal[] = []
  const fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const signal = init?.signal ?? new Request(input).signal
    signals.push(signal)
    return new Promise<Response>((_resolve, reject) => {
      if (signal.aborted) return reject(signal.reason)
      signal.addEventListener("abort", () => reject(signal.reason))
    })
  }) as typeof globalThis.fetch
  return { fetch, signals }
}

describe("#1668 F5 请求的取消透传到 2.x", () => {
  test(
    "自探的超时上限生效:/global/health 以 TimeoutError 失败,发给 2.x 的 /api/info 被一并取消",
    async () => {
      const { fetch, signals } = hangingEngine()
      const engineFetch = createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch })
      const started = Date.now()
      const error = await engineFetch(new URL("/global/health", ENGINE), { signal: AbortSignal.timeout(50) }).catch((caught) => caught)
      expect((error as Error).name).toBe("TimeoutError")
      expect(Date.now() - started).toBeLessThan(1_000)
      expect(signals).toHaveLength(1)
      expect(signals[0]!.aborted).toBe(true)
    },
    { timeout: 2_000 },
  )

  test("已取消的请求直接以取消原因拒绝,不碰引擎", async () => {
    const { fetch, signals } = hangingEngine()
    const engineFetch = createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch })
    const controller = new AbortController()
    controller.abort()
    const error = await engineFetch(new URL("/global/health", ENGINE), { signal: controller.signal }).catch((caught) => caught)
    expect((error as Error).name).toBe("AbortError")
    expect(signals).toHaveLength(0)
  })
})
