// #1572 settle on OpenCode 2 (#1662 L4 Unit B; #1666 rulings 6737930969 and 6756103246 item 2): a model request that
// fails at the network layer settles (session/runner/step.ts → toSessionError) with the layer Code Puppy's classifier
// attributes, as a registered prefix on the message the desktop reads back with parseFailureCode. Replaces v1's
// packages/opencode/test/session/codepuppy-net-failure-settle.test.ts.
//
// Where the failures come from (not hand-written stand-ins for the AI package's errors):
//   · refused — the real @opencode/ai RequestExecutor over fetch, sent to a local port that was just closed;
//   · dns     — the same executor's mapping, fed Node's undici shape (`TypeError: fetch failed` caused by the
//               getaddrinfo error), the runtime the engine has in Electron's utilityProcess;
//   · timeout — the AI package's own TransportError class with the fields route/transport/http.ts:99 sets when no
//               response headers arrive in time (code "Timeout", no cause).
// Red if the Transport branch stops calling the classifier or stops prefixing (the first three read nothing back), or
// prefixes what the classifier does not attribute (the last one).
import { describe, expect, test } from "bun:test"
import { createServer, type AddressInfo } from "node:net"
import { Effect } from "effect"
import { HttpClientRequest } from "effect/http"
import { AIError, TransportError } from "@opencode/ai/effect"
import { RequestExecutor } from "@opencode/ai/route"
import { parseFailureCode } from "@opencode/schema/codepuppy-net-failure"
import { toSessionError } from "@opencode/core/session/to-session-error"

const closedPort = () =>
  new Promise<number>((resolve) => {
    const server = createServer()
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo
      server.close(() => resolve(port))
    })
  })

const send = (url: string, fetch?: typeof globalThis.fetch) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const executor = yield* RequestExecutor.Service
      return yield* executor.execute(HttpClientRequest.post(url), RequestExecutor.withFetch(fetch)).pipe(Effect.flip)
    }).pipe(Effect.provide(RequestExecutor.fetchLayer)),
  )

describe("#1572 settle: a model request's network failure carries Code Puppy's layer", () => {
  test("a refused request settles as provider.transport with tcp ahead of upstream's text", async () => {
    const failure = await send(`http://127.0.0.1:${await closedPort()}/v1/chat/completions`)
    expect(failure.reason._tag).toBe("Transport")
    const error = toSessionError(failure)
    expect(error.type).toBe("provider.transport")
    expect(parseFailureCode(error.message)).toEqual({ code: "tcp", text: failure.reason.message })
  })

  test("a host that does not resolve keeps the unreachable wording and carries dns", async () => {
    const lookup = Object.assign(new Error("getaddrinfo ENOTFOUND api.example.test"), {
      code: "ENOTFOUND",
      syscall: "getaddrinfo",
      hostname: "api.example.test",
    })
    const fetch = (() => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: lookup }))) as unknown as typeof globalThis.fetch
    const error = toSessionError(await send("https://api.example.test/v1/chat/completions", fetch))
    expect(error.type).toBe("provider.transport")
    expect(parseFailureCode(error.message)).toEqual({
      code: "dns",
      text: "Can't reach api.example.test. Check the network connection. (getaddrinfo ENOTFOUND api.example.test)",
    })
  })

  test("the request's own header timer settles as timeout", () => {
    const failure = new AIError({
      reason: new TransportError({
        message: "Timed out waiting for response headers",
        transport: "http",
        operation: "request",
        code: "Timeout",
        url: "https://api.example.test/v1/chat/completions",
      }),
    })
    const error = toSessionError(failure)
    expect(error.type).toBe("provider.transport")
    expect(parseFailureCode(error.message)).toEqual({ code: "timeout", text: "Timed out waiting for response headers" })
  })

  test("a transport failure the classifier does not attribute keeps upstream's text, with no code", () => {
    const error = toSessionError(
      new AIError({ reason: new TransportError({ message: "Provider unavailable", transport: "http", operation: "request" }) }),
    )
    expect(error).toEqual({ type: "provider.transport", message: "Provider unavailable" })
    expect(parseFailureCode(error.message)).toBeUndefined()
  })
})
