// #1647: production Default app owns both the running turn and the stop request. MCP fixture is the
// real SDK stdio server used by #1563; TestLLMServer supplies the existing captured OpenAI stream shape.
import { afterEach, expect } from "bun:test"
import path from "node:path"
import { Effect } from "effect"
import type { SessionV1 } from "@opencode-ai/core/v1/session"
import { Server } from "../../src/server/server"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { stopSidecarListener } from "../../../ui-mac/src/main/sidecar-stop"

const it = testEffect(TestLLMServer.layer)
afterEach(disposeAllInstances)

it.live(
  "#1647 AC1 stop settles a permission-waiting turn in the shared runtime, reload reads its failure, tools/call stays zero",
  () =>
    Effect.gen(function* () {
      const llm = yield* TestLLMServer
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() =>
          tmpdir({
            config: {
              model: "test/test-model",
              provider: {
                test: {
                  npm: "@ai-sdk/openai-compatible",
                  options: { baseURL: llm.url, apiKey: "fixture" },
                  models: {
                    "test-model": { name: "Test Model", tool_call: true, limit: { context: 100000, output: 10000 } },
                  },
                },
              },
              agent: { "codepuppy-ask": { permission: { "*": "ask", "tool-policy-default": "ask" } } },
              mcp: {
                probe: {
                  type: "local",
                  command: [
                    process.execPath,
                    path.resolve(import.meta.dir, "../fixture/codepuppy-mcp-startup-stdio.ts"),
                  ],
                  environment: { CODEPUPPY_MCP_CALL_LOG: "calls.log" },
                },
              },
              lsp: false,
              formatter: false,
            },
          }),
        ),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )
      yield* llm.tool("probe_echo", { text: "must not execute" })
      yield* Effect.promise(async () => {
        const app = Server.Default().app
        const request = async (url: string, body?: unknown) => {
          const response = await app.request(url, {
            method: body ? "POST" : "GET",
            headers: { "x-opencode-directory": tmp.path, "content-type": "application/json" },
            ...(body ? { body: JSON.stringify(body) } : {}),
          })
          expect(response.ok).toBe(true)
          return response
        }
        const until = async (check: () => Promise<boolean>) => {
          for (let n = 0; n < 150; n++) {
            if (await check()) return
            await Bun.sleep(20)
          }
          throw new Error("fixture did not reach pending permission")
        }
        try {
          await until(async () => (await (await request("/mcp")).json()).probe?.status === "connected")
          const chat = await (await request("/session", { title: "Stop pending tool" })).json()
          await request(`/session/${chat.id}/prompt_async`, {
            agent: "codepuppy-ask",
            parts: [{ type: "text", text: "echo" }],
          })
          await until(async () => (await (await request("/permission")).json()).length > 0)
          const messages = async () =>
            (await (await request(`/session/${chat.id}/message`)).json()) as SessionV1.WithParts[]
          const before = (await messages()).findLast((m) => m.info.role === "assistant")!
          expect(before.parts.find((p) => p.type === "tool")?.state.status).toBe("running")
          let stopped = false
          await stopSidecarListener(
            {
              stop: async () => {
                stopped = true
              },
            },
            { fetch: app.fetch, password: "fixture" },
          )
          expect(stopped).toBe(true)
          const after = (await messages()).find((m) => m.info.id === before.info.id)!
          expect(after.info.role).toBe("assistant")
          if (after.info.role !== "assistant") throw new Error("missing assistant")
          expect(after.info.error?.name).toBe("MessageAbortedError")
          expect(after.info.time.completed).toBeNumber()
          const tool = after.parts.find((p) => p.type === "tool")!
          expect(tool.state.status).toBe("error")
          if (tool.state.status !== "error") throw new Error("tool still running")
          expect(tool.state.time.end).toBeNumber()
          expect(tool.state.error).toBeTruthy()
          expect(await (await request("/permission")).json()).toEqual([])
          expect(await Bun.file(path.join(tmp.path, "calls.log")).exists()).toBe(false)
        } finally {
          await app.request("/global/dispose", { method: "POST" })
        }
      })
    }),
  30_000,
)
