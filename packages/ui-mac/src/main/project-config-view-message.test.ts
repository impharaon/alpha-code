import { expect, test } from "bun:test"
import {
  buildProjectConfigViewRequest,
  parseProjectConfigViewRequest,
  buildProjectConfigViewReply,
  parseProjectConfigViewReply,
  createProjectConfigViewRequester,
} from "./project-config-view-message"
import { answerProjectConfigView } from "./sidecar-project-config-view"
import type { ProjectConfigView } from "@opencode/schema/codepuppy-project-config"
const view: ProjectConfigView = {
  directory: "/w",
  trusted: false,
  complete: true,
  points: { config: "done" },
  withheld: [],
}

test("消息合同:build / parse 往返;错误类型、非字符串 id 与缺字段一律拒绝", () => {
  const request = buildProjectConfigViewRequest("1", "/w")
  expect(parseProjectConfigViewRequest(request)).toEqual(request)
  const reply = buildProjectConfigViewReply("1", { ok: true, view })
  expect(parseProjectConfigViewReply(reply)).toEqual(reply)
  for (const bad of [
    null,
    {},
    { ...request, id: 1 },
    { ...request, directory: undefined },
    { ...request, type: "other" },
  ])
    expect(parseProjectConfigViewRequest(bad)).toBeUndefined()
  for (const bad of [
    null,
    {},
    { ...reply, id: 1 },
    { ...reply, ok: "true" },
    { ...reply, view: { ...view, points: {} } },
    { ...reply, view: { ...view, withheld: [{}] } },
    { ...reply, view: { ...view, points: { config: "pending" } } },
    { ...reply, view: { ...view, withheld: [{ kind: "unknown", name: "x", file: "f" }] } },
  ])
    expect(parseProjectConfigViewReply(bad)).toBeUndefined()
  expect(
    parseProjectConfigViewReply(buildProjectConfigViewReply("2", { ok: false, reason: "engine-not-ready" }))?.ok,
  ).toBe(false)
})
test("请求簿:按 id 对号、目录不串、超时 / 子进程退出 / post 失败答 undefined", async () => {
  const wire: unknown[] = []
  const book = createProjectConfigViewRequester((request) => wire.push(request), { timeoutMs: 10 })
  const pending = book.request("/w")
  expect(book.receive(buildProjectConfigViewReply("1", { ok: true, view }))).toBe(true)
  expect(await pending).toEqual(view)
  expect(book.receive(wire[0])).toBe(false)
  const wrongDirectory = book.request("/other")
  book.receive(buildProjectConfigViewReply("2", { ok: true, view }))
  expect(await wrongDirectory).toBeUndefined()
  expect(await book.request("/timeout")).toBeUndefined()
  const exiting = book.request("/w")
  book.close()
  expect(await exiting).toBeUndefined()
  expect(await book.request("/closed")).toBeUndefined()
  const throwing = createProjectConfigViewRequester(() => {
    throw new Error("gone")
  })
  expect(await throwing.request("/w")).toBeUndefined()
})
test("sidecar:未就绪 / Location 失败;pending 不伪装成完成,未激活的点不等待", async () => {
  const request = buildProjectConfigViewRequest("1", "/w")
  expect(await answerProjectConfigView(request, { fetch: undefined, view: undefined })).toMatchObject({
    ok: false,
    reason: "engine-not-ready",
  })
  expect(
    await answerProjectConfigView(request, { fetch: () => new Response("", { status: 500 }), view: () => view }),
  ).toMatchObject({ ok: false, reason: "location-failed" })
  const sent: string[] = []
  const fetch = (request: Request) => {
    sent.push(new URL(request.url).pathname)
    return new Response("{}")
  }
  expect(await answerProjectConfigView(request, { fetch, view: () => view })).toMatchObject({ ok: true, view })
  expect(sent.sort()).toEqual(["/api/agent", "/api/command", "/api/skill"])
  expect(
    await answerProjectConfigView(request, {
      fetch,
      view: () => ({ ...view, complete: false, points: { config: "done", skill: "pending" } }),
      timeoutMs: 5,
    }),
  ).toMatchObject({ ok: true, view: { complete: false, points: { skill: "pending" } } })
})
