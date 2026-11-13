// `#1668` R1 F4:composer 执行斜杠命令后,从 v1 command 的响应里读 `info.id`(codepuppy-composer.tsx),时间线按它把命令来源
// chip 对到回合上(冻结的 timeline-model.ts slashOriginForTurn)。2.x 的 command 只回 204(fixtures/command.json 的 rawCommand,
// 且回时会话已在跑:activeAfter);适配器要回那个回合真实的助手消息。夹具同一文件:经适配器发出的命令与之后的消息。
import { describe, expect, test } from "bun:test"
import { slashOriginForTurn } from "../renderer/codepuppy-ui/session-timeline/timeline-model"
import command from "./fixtures/command.json"
import { createEngineFetch } from "./index"
import { toV1Messages } from "./opencode2/v1-shapes"

const fixture = command as unknown as {
  directory: string
  sessionID: string
  final: Array<{ id: string; type: string }>
  raw: { rawCommand: { status: number }; activeAfter: { data: Record<string, unknown> } }
}
const ENGINE = "http://127.0.0.1:47005"

/** 假 2.x 上游:命令发出前会话为空;发出后依次回 `pages`(每次读一页,读完停在最后一页),active 按 `running` 回。 */
function engine(pages: Array<typeof fixture.final>, running: (poll: number) => boolean) {
  let commanded = false
  let polls = 0
  const calls: string[] = []
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    calls.push(`${request.method} ${url.pathname}`)
    if (url.pathname === "/api/skill") return Response.json({ data: [] })
    if (url.pathname === `/api/session/${fixture.sessionID}`)
      return Response.json({ data: { id: fixture.sessionID, location: { directory: fixture.directory } } })
    if (url.pathname.endsWith("/command")) {
      commanded = true
      return new Response(null, { status: fixture.raw.rawCommand.status })
    }
    if (url.pathname === "/api/session/active")
      return Response.json({ data: running(polls) ? { [fixture.sessionID]: { type: "running" } } : {} })
    if (url.pathname.endsWith("/message")) {
      if (!commanded) return Response.json({ data: [], cursor: {} })
      const page = pages[Math.min(polls++, pages.length - 1)]!
      return Response.json({ data: [...page].reverse(), cursor: {} })
    }
    return new Response(`unexpected ${url.pathname}`, { status: 500 })
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

async function runCommand(fetch: typeof globalThis.fetch) {
  const engineFetch = createEngineFetch({ isEngineOrigin: (origin) => origin === ENGINE, fetch })
  const response = await engineFetch(`${ENGINE}/session/${fixture.sessionID}/command`, {
    method: "POST",
    body: JSON.stringify({ command: "hello", arguments: "" }),
  })
  expect(response.status).toBe(200)
  return (await response.json()) as { info?: { id?: string; role?: string } }
}

const assistantIDs = new Set(
  toV1Messages(fixture.sessionID, fixture.final as never)
    .filter((item) => item.info.role === "assistant")
    .map((item) => item.info.id),
)

describe("#1668 F4 command 响应带真实助手消息", () => {
  test("2.x 的 command 只受理(204),回时会话已在跑", () => {
    expect(fixture.raw.rawCommand.status).toBe(204)
    expect(Object.keys(fixture.raw.activeAfter.data)).toHaveLength(1)
  })

  test("v1 响应的 info.id = 这条命令那个回合的助手消息,命令来源 chip 对得上回合", async () => {
    const { fetch } = engine([fixture.final], () => false)
    const reply = await runCommand(fetch)
    const assistant = fixture.final.find((message) => message.type === "assistant")!
    expect(reply.info).toMatchObject({ id: assistant.id, role: "assistant" })
    // composer 把 info.id 登记成 assistantMessageID;时间线对回合时只认这个 id。
    expect(slashOriginForTurn([{ command: "hello", assistantMessageID: reply.info!.id!, source: "command" } as never], assistantIDs)).toEqual({
      command: "hello",
      source: "command",
    })
  })

  test("回合还在跑、助手消息还没落库 ⇒ 等到它出现", async () => {
    const userOnly = fixture.final.filter((message) => message.type === "user")
    const { fetch, calls } = engine([userOnly, userOnly, fixture.final], (poll) => poll < 3)
    const reply = await runCommand(fetch)
    expect(assistantIDs.has(reply.info!.id!)).toBe(true)
    expect(calls.filter((call) => call.endsWith("/message")).length).toBeGreaterThanOrEqual(4)
  })

  test("命令没开回合(会话不在跑、没有新消息)⇒ 立即回 {}", async () => {
    const { fetch } = engine([[]], () => false)
    expect(await runCommand(fetch)).toEqual({})
  })
})
