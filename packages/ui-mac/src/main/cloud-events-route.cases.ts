import { expect, mock, test } from "bun:test"

let base = ""
mock.module("./codepuppy-endpoints", () => ({ resolveEndpoints: () => ({ cloud: base }) }))
mock.module("./codepuppy-auth", () => ({ getAccessToken: () => "sse-route-sentinel" }))
mock.module("./logging", () => ({ getLogger: () => ({ warn: () => {} }) }))
const { subscribeCloudJobEvents } = await import("./codepuppy-cloud-events")

test("bounded SSE reconnect takes the new endpoint and the original nonnumeric Last-Event-ID", async () => {
  // Payload provenance: the pinned platform producer status fixture; event names/id grammar from
  // the existing codepuppy-cloud-events.test.ts consumer inputs. No production request is made.
  const payload = (await Bun.file(new URL("../../../codepuppy-contracts-consumer/vendor/alpha-platform/contracts/v1/fixtures/producer/cloud-job-status.json", import.meta.url)).json()).value
  const hits: Array<{ route: string; cursor: string | null; authorization: string | null; path: string }> = []
  const response = (route: string, request: Request) => {
    hits.push({ route, cursor: request.headers.get("last-event-id"), authorization: request.headers.get("authorization"), path: new URL(request.url).pathname })
    return new Response(`id:evt_abc\nevent:${hits.length === 1 ? "job.running" : "job.completed"}\ndata:${JSON.stringify(payload)}\n\n`, { headers: { "content-type": "text/event-stream" } })
  }
  const direct = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => response("direct", request) })
  const preferred = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => {
    base = direct.url.origin
    return response("preferred", request)
  } })
  base = preferred.url.origin
  const events: string[] = []
  const done = Promise.withResolvers<void>()
  const stop = subscribeCloudJobEvents("job_test_0001", (event) => {
    events.push(event.event)
    if (event.event === "job.completed") done.resolve()
  })
  try {
    await Promise.race([done.promise, new Promise((_, reject) => setTimeout(() => reject(new Error("SSE did not finish")), 3000).unref())])
    expect(hits.map((hit) => hit.route)).toEqual(["preferred", "direct"])
    expect(hits.map((hit) => hit.cursor)).toEqual([null, "evt_abc"])
    expect(hits.map((hit) => hit.authorization)).toEqual(["Bearer sse-route-sentinel", "Bearer sse-route-sentinel"])
    expect(new Set(hits.map((hit) => hit.path)).size).toBe(1)
    expect(events).toEqual(["job.running", "job.completed"])
  } finally {
    stop()
    preferred.stop(true)
    direct.stop(true)
  }
})
