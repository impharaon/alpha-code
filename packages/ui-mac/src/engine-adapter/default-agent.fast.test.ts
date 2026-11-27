// S-11(DESIGN-local-plugin-install §4.14):新默认助手(包默认、用户 default_agent)只带新会话,不强切已运行会话。
// ext 在会话第一条消息时把当时的默认钉进会话 metadata(packages/ext/src/plugin-package-invocation.ts);这里判适配器的一半:
// 不带 agent 的消息回到钉住的那个,不跟随助手列表后来的第一项。假 2.x 上游按引擎的规则选助手(会话记着 agent 就用它,
// 没记就用此刻列表的第一项),经生产的 createEngineFetch → prompt_async → selectAgent 发消息,看每一轮由哪个助手跑。
// 真引擎的同一组切换见 default-agent.engine.cases.ts。
import { expect, test } from "bun:test"
import { SESSION_DEFAULT_AGENT_KEY } from "../shared/permission-tier"
import { createEngineFetch } from "./index"

const ENGINE = "http://127.0.0.1:47006"

function engine(agents: string[], sessions: Record<string, { agent?: string; pinned?: string }>) {
  const state = { agents, turns: [] as string[] }
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const path = new URL(request.url).pathname
    if (path === "/api/agent") return Response.json({ data: state.agents.map((id) => ({ id })) })
    const match = /^\/api\/session\/([^/]+)(\/agent|\/prompt)?$/.exec(path)
    const session = match && sessions[match[1]!]
    if (!match || !session) return new Response(`unexpected ${request.method} ${path}`, { status: 500 })
    if (request.method === "GET")
      return Response.json({
        data: { id: match[1], location: { directory: "/project" }, agent: session.agent, ...(session.pinned ? { metadata: { [SESSION_DEFAULT_AGENT_KEY]: session.pinned } } : {}) },
      })
    const body = (await request.json()) as { agent?: string }
    if (match[2] === "/agent") session.agent = body.agent
    if (match[2] !== "/prompt") return new Response(null, { status: 204 })
    state.turns.push(session.agent ?? state.agents[0]!)
    return Response.json({ data: { id: "msg_turn" } })
  }) as typeof globalThis.fetch
  const engineFetch = createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch })
  const send = async (sessionID: string, agent?: string) => {
    const response = await engineFetch(`${ENGINE}/session/${sessionID}/prompt_async`, {
      method: "POST",
      body: JSON.stringify({ parts: [{ type: "text", text: "work" }], ...(agent ? { agent } : {}) }),
    })
    expect(response.status).toBe(204)
    return state.turns.at(-1)
  }
  return { state, send }
}

test("a session keeps the default it started with when a later default appears", async () => {
  // Pinned to build at its first prompt; a package default has since become the first agent.
  const { state, send } = engine(["adlc-orchestrator", "build", "plan"], { ses_running: { agent: "build", pinned: "build" }, ses_led: { agent: "adlc-orchestrator", pinned: "adlc-orchestrator" } })
  expect(await send("ses_running")).toBe("build")
  expect(await send("ses_running", "codepuppy-ask")).toBe("codepuppy-ask")
  expect(await send("ses_running")).toBe("build")
  expect(await send("ses_running", "plan")).toBe("plan")
  expect(await send("ses_running")).toBe("build")
  expect(await send("ses_led", "codepuppy-readonly")).toBe("codepuppy-readonly")
  expect(await send("ses_led")).toBe("adlc-orchestrator")
  // The pinned package agent left with its package: the session takes today's default instead of a missing agent.
  state.agents = ["build", "plan"]
  expect(await send("ses_led", "codepuppy-ask")).toBe("codepuppy-ask")
  expect(await send("ses_led")).toBe("build")
})
