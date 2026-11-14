import { afterEach, beforeEach, expect, spyOn, test, vi } from "bun:test"
import { setImmediate } from "node:timers/promises"
import { mockElectron } from "../../test-component/electron-mock"
import { engineClient } from "./engine-client"
import fixture from "./unattended-run.messages.fixture.json"
import type { FormInfo } from "@opencode/client"

mockElectron(() => ({ app: { getPath: () => process.env.TMPDIR!, isPackaged: false } }))
const { watchAutomationElicitations } = await import("./automation-elicitation")
const logging = await import("./logging")
const directory = "/workspace/有空格 的项目"
// form.created 的真实 form/URL 输入,由真实 SDK 请求经过引擎生成,不是手写表单替身。
const forms = fixture.forms as unknown as FormInfo[]
const warnings: unknown[][] = []
let restore: () => void
beforeEach(() => {
  vi.useFakeTimers({ now: 0 })
  warnings.length = 0
  const logger = spyOn(logging, "getLogger").mockReturnValue({
    warn: (...args: unknown[]) => warnings.push(args),
  } as never)
  restore = () => logger.mockRestore()
})
afterEach(() => {
  restore()
  vi.useRealTimers()
})

/** 等真实异步交接完成,不推进虚拟时间或猜固定微任务次数。 */
async function until(condition: () => boolean) {
  while (!condition()) await setImmediate()
}

test("最不利轮询相位仍在虚拟 250 ms 取消表单,global 请求带项目位置", async () => {
  let present = false
  let listed = 0
  let cancelled = 0
  const requests: Request[] = []
  const client = engineClient({ url: "http://127.0.0.1:1", password: null }, (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const request = new Request(input, init)
    requests.push(request)
    if (request.method === "GET") {
      listed++
      return Response.json({ location: { directory }, data: present ? [forms[0]] : [] })
    }
    cancelled++
    present = false
    return new Response(null, { status: 204 })
  }) as typeof fetch)
  const watcher = watchAutomationElicitations(client, directory)
  await until(() => vi.getTimerCount() === 1)
  present = true
  vi.advanceTimersByTime(249)
  expect(listed).toBe(1)
  expect(cancelled).toBe(0)
  vi.advanceTimersByTime(1)
  await until(() => watcher.connector === "elicitor")
  expect(cancelled).toBe(1)
  expect(present).toBe(false)
  expect(Date.now()).toBe(250)
  const list = requests.find((request) => request.method === "GET")!
  expect(new URL(list.url).searchParams.get("location[directory]")).toBe(directory)
  const cancel = requests.find((request) => request.method === "DELETE")!
  expect(new URL(cancel.url).pathname).toBe(`/api/session/global/form/${forms[0]!.id}`)
  expect(cancel.headers.get("x-opencode-directory")).toBe(encodeURIComponent(directory))
  await watcher.stop()
  expect(vi.getTimerCount()).toBe(0)
})

test("已有表单立即取消;多表单与重复 id 不产生重叠轮询或重复取消", async () => {
  let lists = 0
  const waiting: Array<ReturnType<typeof Promise.withResolvers<Response>>> = []
  const client = engineClient({ url: "http://127.0.0.1:1", password: null }, (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    if (init?.method === "GET") {
      lists++
      return Response.json({
        location: { directory },
        data: [forms[0], forms[0], forms[1], { ...forms[2], metadata: { kind: "other" } }],
      })
    }
    const reply = Promise.withResolvers<Response>()
    waiting.push(reply)
    return reply.promise
  }) as typeof fetch)
  const watcher = watchAutomationElicitations(client, directory)
  await until(() => waiting.length === 2)
  vi.advanceTimersByTime(1000)
  expect(lists).toBe(1)
  expect(waiting).toHaveLength(2)
  for (const reply of waiting) reply.resolve(new Response(null, { status: 204 }))
  await until(() => watcher.connector === "elicitor")
  await watcher.stop()
})

test("取消的已结束/不存在竞争忽略,其它失败只日志且不伪造已取消原因", async () => {
  for (const [status, tag] of [
    [404, "FormNotFoundError"],
    [409, "FormAlreadySettledError"],
    [500, "UnknownError"],
  ] as const) {
    const client = engineClient({ url: "http://127.0.0.1:1", password: null }, (async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) =>
      init?.method === "GET"
        ? Response.json({ location: { directory }, data: [forms[0]] })
        : Response.json({ _tag: tag, id: forms[0]!.id, message: "fixture settled" }, { status })) as typeof fetch)
    const watcher = watchAutomationElicitations(client, directory)
    await until(() => vi.getTimerCount() === 1)
    expect(watcher.connector).toBeUndefined()
    expect(warnings).toHaveLength(status === 500 ? 1 : 0)
    await watcher.stop()
  }
})

test("停止会中断在途列表请求,之后不会再访问引擎或挂到任务总期限", async () => {
  const entered = Promise.withResolvers<void>()
  let requests = 0
  const client = engineClient({ url: "http://127.0.0.1:1", password: null }, (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    requests++
    entered.resolve()
    return new Promise<Response>((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
    )
  }) as typeof fetch)
  const watcher = watchAutomationElicitations(client, directory)
  await entered.promise
  await watcher.stop()
  vi.advanceTimersByTime(10_000)
  expect(requests).toBe(1)
  expect(warnings).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
})

test("停止同样收妥在途取消,不把已结束运行的响应带到下一次", async () => {
  const entered = Promise.withResolvers<void>()
  const client = engineClient({ url: "http://127.0.0.1:1", password: null }, (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    if (init?.method === "GET") return Response.json({ location: { directory }, data: [forms[0]] })
    entered.resolve()
    return new Promise<Response>((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
    )
  }) as typeof fetch)
  const watcher = watchAutomationElicitations(client, directory)
  await entered.promise
  await watcher.stop()
  expect(watcher.connector).toBeUndefined()
  expect(warnings).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
})
