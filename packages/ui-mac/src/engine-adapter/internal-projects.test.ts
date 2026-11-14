// `#1669`:renderer 用的那一个 engineFetch(index.ts 模块级)认目录问的是 main(preload 的 engineInternalDirectories)。
// 真引擎上的判据在 internal-projects.engine.cases.ts;这里只判生产接线:去掉它,引擎工作目录就回到项目清单里。
import { afterAll, expect, test } from "bun:test"

const SCRATCH = "/Users/tester/Library/Application Support/ai.opencode.desktop/engine-scratch-cwd"
const PROJECT = "/Users/tester/src/my-app"
const ENGINE = "http://127.0.0.1:4096"
const row = (id: string, canonical: string) => ({ id, canonical, time: { created: 1, updated: 1, active: 1 }, sandboxes: [] })

const savedFetch = globalThis.fetch
const holder = globalThis as unknown as { window?: unknown }
const savedWindow = holder.window
let asked = 0
holder.window = {
  api: {
    engineInternalDirectories: async () => {
      asked++
      return { scratch: [SCRATCH], defaultWorkspace: [] }
    },
  },
}
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.origin === ENGINE && url.pathname === "/api/project") return Response.json([row("p-scratch", SCRATCH), row("p-app", PROJECT)])
  return new Response("unexpected", { status: 500 })
}) as typeof fetch

afterAll(() => {
  globalThis.fetch = savedFetch
  holder.window = savedWindow
})

test("生产 engineFetch 的 GET /project 不列 main 给的引擎工作目录,用户目录照列;main 只问一次", async () => {
  const { engineFetch, registerEngineOrigin } = await import("./index")
  registerEngineOrigin(ENGINE)
  for (let round = 0; round < 2; round++) {
    const response = await engineFetch(`${ENGINE}/project`)
    expect(response.status).toBe(200)
    expect(((await response.json()) as Array<{ worktree: string }>).map((project) => project.worktree)).toEqual([PROJECT])
  }
  expect(asked).toBe(1)
})
