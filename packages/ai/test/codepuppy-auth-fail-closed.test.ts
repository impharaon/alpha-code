// #652 on OpenCode 2 (#1662 L4, ruling item 3): "we could not obtain a credential" must never become "send an
// unauthenticated request". Ported from alpha's packages/llm/test/auth-fail-closed.test.ts onto the re-taken files:
// route/auth.ts (`Auth.unset`), route/client.ts and route/decision.ts (the default), protocols/openai-chat.ts and
// protocols/openai-responses.ts (no template-level `Auth.none`).
//
// Observable results only: how many requests reached the HTTP client (a counting client), and the failure's name.
//   · a route that never declared auth ⇒ 0 requests and a named Authentication failure, not a remote 401;
//   · an explicitly declared `Auth.none` ⇒ the request is sent without a credential — the gate is a declaration, not
//     a ban, so a keyless local provider still works once it says so;
//   · a declared credential that resolves to nothing ⇒ 0 requests too.
// The last group is the audit of every 2.x route that relied on the old default, kept as a pin: every provider entry
// in package.json, built the way the engine builds it (`module.model(id, settings)`, packages/core/src/model-resolver.ts)
// with no credential anywhere, sends nothing without a credential.
//
// Known-bad arms (measured 2026-11-09, then restored): `?? Auth.unset` back to `?? Auth.none` in route/client.ts turns
// the first two cases red; restoring `auth: Auth.none` on the OpenAI Responses template turns the second red; back to
// `?? Auth.none` in route/decision.ts turns the decision case red; declaring `Auth.none` in providers/openai-compatible.ts
// turns the pin red, naming both of its entries.
import { describe, expect, test } from "bun:test"
import { ConfigProvider, Effect, Layer } from "effect"
import { HttpClientRequest } from "effect/http"
import { ai, AIError, DecisionClient, DecisionModel, ImageClient, ImageModel, LLMClient } from "../src/effect.js"
import { Auth, MissingCredentialError } from "../src/route/auth.js"
import * as OpenAIChat from "../src/protocols/openai-chat.js"
import { OpenAIResponses } from "../src/protocols/openai-responses.js"
import * as SystemOne from "../src/protocols/system-one.js"
import { it } from "./lib/effect.js"
import { withProcessEnv } from "./lib/env.js"
import { dynamicResponse, type Handler } from "./lib/http.js"
import { deltaChunk, finishChunk } from "./lib/openai-chunks.js"
import { sseEvents } from "./lib/sse.js"

const BASE_URL = "https://api.openai.test/v1"
const CREDENTIAL_HEADERS = ["authorization", "x-api-key", "api-key", "x-goog-api-key", "cf-aig-authorization"]

type Sent = { url: string; credential: boolean }

/** Counts every request that reached the HTTP client, and whether it carried a credential header. */
const counting = (sent: Sent[], respond: "ok" | "bad-request" = "ok"): Handler =>
  (input) =>
    Effect.gen(function* () {
      const web = yield* HttpClientRequest.toWeb(input.request).pipe(Effect.orDie)
      sent.push({ url: web.url, credential: CREDENTIAL_HEADERS.some((name) => web.headers.get(name) !== null) })
      if (respond === "bad-request")
        return input.respond(JSON.stringify({ error: { message: "pin stub" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        })
      return input.respond(sseEvents(deltaChunk({ role: "assistant", content: "hi" }), finishChunk("stop")), {
        headers: { "content-type": "text/event-stream" },
      })
    })

/** No credential from configuration either: every `Auth.config(...)` source reads an empty environment. */
const noConfig = Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: {} })))

const authenticationFailure = (error: unknown) => {
  expect(error).toBeInstanceOf(AIError)
  const reason = (error as AIError).reason
  expect(reason._tag).toBe("Authentication")
  return reason
}

describe("auth fail-closed default (#652 on OpenCode 2)", () => {
  it.effect("a route that never declared auth refuses before the socket opens", () =>
    Effect.gen(function* () {
      const sent: Sent[] = []
      const model = OpenAIChat.route.with({ endpoint: { baseURL: BASE_URL } }).model({ id: "gpt-4o-mini" })
      const error = yield* LLMClient.generate(ai.request({ model, prompt: "Say hello." })).pipe(
        Effect.provide(dynamicResponse(counting(sent))),
        Effect.flip,
      )
      expect(sent).toEqual([])
      const reason = authenticationFailure(error)
      expect(reason.message).toContain("no auth declared")
      expect(reason.message).toContain('route "openai-chat"')
      expect(reason.cause).toBeInstanceOf(MissingCredentialError)
    }),
  )

  it.effect("the OpenAI Responses template deployed without auth refuses before the socket opens too", () =>
    Effect.gen(function* () {
      const sent: Sent[] = []
      const model = OpenAIResponses.route.with({ endpoint: { baseURL: BASE_URL } }).model({ id: "gpt-5.4" })
      const error = yield* LLMClient.generate(ai.request({ model, prompt: "Say hello." })).pipe(
        Effect.provide(dynamicResponse(counting(sent))),
        Effect.flip,
      )
      expect(sent).toEqual([])
      expect(authenticationFailure(error).message).toContain("no auth declared")
    }),
  )

  it.effect("a decision route that never declared auth refuses before the socket opens", () =>
    Effect.gen(function* () {
      const sent: Sent[] = []
      const model = SystemOne.route.with({ endpoint: { baseURL: "https://decisions.test/v1" } }).model({ id: "jev-latest" })
      const error = yield* ai.decision
        .generate({ model, input: { ticket: "refund" }, questions: [{ name: "refund", type: "predicate", instructions: "Refund?" }] })
        .pipe(Effect.provide(DecisionClient.layer.pipe(Layer.provide(dynamicResponse(counting(sent))))), Effect.flip)
      expect(sent).toEqual([])
      expect(authenticationFailure(error).message).toContain("no auth declared")
    }),
  )

  it.effect("an explicitly declared Auth.none still sends — the gate is a declaration, not a ban", () =>
    Effect.gen(function* () {
      const sent: Sent[] = []
      const model = OpenAIChat.route.with({ endpoint: { baseURL: BASE_URL }, auth: Auth.none }).model({ id: "gpt-4o-mini" })
      const response = yield* LLMClient.generate(ai.request({ model, prompt: "Say hello." })).pipe(
        Effect.provide(dynamicResponse(counting(sent))),
      )
      expect(response.text).toBe("hi")
      expect(sent).toEqual([{ url: `${BASE_URL}/chat/completions`, credential: false }])
    }),
  )

  it.effect("a declared credential that resolves to nothing also refuses before the socket opens", () =>
    Effect.gen(function* () {
      const sent: Sent[] = []
      const model = OpenAIChat.route
        .with({ endpoint: { baseURL: BASE_URL }, auth: Auth.optional(undefined, "apiKey").bearer() })
        .model({ id: "gpt-4o-mini" })
      const error = yield* LLMClient.generate(ai.request({ model, prompt: "Say hello." })).pipe(
        Effect.provide(dynamicResponse(counting(sent))),
        Effect.flip,
      )
      expect(sent).toEqual([])
      expect(authenticationFailure(error).message).toContain("apiKey")
    }),
  )
})

// ── The audit as a pin: every provider entry, built like the engine builds it, with no credential ──────────────────
const PACKAGE = (await Bun.file(new URL("../package.json", import.meta.url)).json()) as { exports: Record<string, string> }
const ENTRIES = Object.entries(PACKAGE.exports).filter(([key]) => key.startsWith("./providers/"))
// Settings a deployment would carry besides its credential; Cloudflare's decision/image entries derive the Run API base
// from a baseURL ending in /ai/v1.
const SETTINGS = {
  baseURL: "https://provider.test/v1",
  resourceName: "pin",
  accountId: "pin",
  project: "pin",
  location: "us-central1",
  region: "us-east-1",
}
const CLOUDFLARE_BASE = "https://provider.test/client/v4/accounts/pin/ai/v1"
// Ambient credentials that bypass the configuration provider (AWS SDK chain, Google ADC): absent, and no metadata
// server probes, so nothing leaves the machine.
const NO_AMBIENT = {
  AWS_ACCESS_KEY_ID: undefined,
  AWS_SECRET_ACCESS_KEY: undefined,
  AWS_SESSION_TOKEN: undefined,
  AWS_BEARER_TOKEN_BEDROCK: undefined,
  AWS_PROFILE: undefined,
  AWS_WEB_IDENTITY_TOKEN_FILE: undefined,
  AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: undefined,
  AWS_CONTAINER_CREDENTIALS_FULL_URI: undefined,
  AWS_SHARED_CREDENTIALS_FILE: "/nonexistent/codepuppy-pin/credentials",
  AWS_CONFIG_FILE: "/nonexistent/codepuppy-pin/config",
  AWS_EC2_METADATA_DISABLED: "true",
  GOOGLE_APPLICATION_CREDENTIALS: undefined,
  GOOGLE_VERTEX_API_KEY: undefined,
  CLOUDSDK_CONFIG: "/nonexistent/codepuppy-pin/gcloud",
  METADATA_SERVER_DETECTION: "none",
}

const build = (module: { model: (id: string, settings: Record<string, unknown>) => unknown }) => {
  try {
    return module.model("pin-model", { ...SETTINGS })
  } catch (error) {
    if (!/ai\/v1/.test(String((error as Error)?.message))) throw error
    return module.model("pin-model", { ...SETTINGS, baseURL: CLOUDFLARE_BASE })
  }
}

const drive = (model: unknown, sent: Sent[]) => {
  const http = dynamicResponse(counting(sent, "bad-request"))
  if (model instanceof DecisionModel)
    return ai.decision
      .generate({ model, input: { ticket: "refund" }, questions: [{ name: "refund", type: "predicate", instructions: "Refund?" }] })
      .pipe(Effect.provide(DecisionClient.layer.pipe(Layer.provide(http))))
  if (model instanceof ImageModel)
    return ai.image.generate({ model, prompt: "a lighthouse" }).pipe(Effect.provide(ImageClient.layer.pipe(Layer.provide(http))))
  return LLMClient.generate(ai.request({ model: model as never, prompt: "Say hello." })).pipe(Effect.provide(http))
}

describe("audit pin: no provider entry sends a request without a credential", () => {
  test("the provider entries are enumerated (an empty list would make the pin vacuous)", () => {
    expect(ENTRIES.length).toBeGreaterThan(80)
  })

  // One case over every entry, so a new upstream provider does not change this file's registered test count.
  it.live("every provider entry built with no credential sends nothing without one", () =>
    Effect.gen(function* () {
      const offenders: string[] = []
      let driven = 0
      for (const [key, file] of ENTRIES) {
        const module = yield* Effect.promise(() => import(new URL(`../${file}`, import.meta.url).href))
        // Media-only entries (speech, transcription, video) export no `model`, so the engine cannot load them as a
        // model; their routes take auth as a required field (route/media.ts).
        if (typeof module.model !== "function") continue
        const built = yield* Effect.try(() => build(module)).pipe(Effect.option)
        // A deployment the package refuses to construct sends nothing either.
        if (built._tag === "None") continue
        const sent: Sent[] = []
        yield* drive(built.value, sent).pipe(noConfig, withProcessEnv(NO_AMBIENT), Effect.ignore)
        driven += 1
        if (sent.some((request) => !request.credential)) offenders.push(key)
      }
      expect(offenders).toEqual([])
      // Most entries are actually driven, so a construction change cannot empty the pin silently.
      expect(driven).toBeGreaterThan(80)
    }),
  )
})
