import { expect, spyOn, test } from "bun:test"
import { mockElectron } from "../../test-component/electron-mock"
import { engineClient } from "./engine-client"
import fixture from "./unattended-run.messages.fixture.json"

mockElectron(() => ({ app: { getPath: () => process.env.TMPDIR!, isPackaged: false } }))
const { firstAutomationDenial, readAutomationDenial } = await import("./automation-run-outcome")

// 全部消息和游标由同名真实引擎用例捕获;来源和生产源码摘要保存在 fixture.provenance。
type Messages = Parameters<typeof firstAutomationDenial>[0]
const samples = fixture.examples as unknown as Array<{
  scenario: string
  messages: Messages
  cursor: { next: string }
  emptyPage: { data: Messages; cursor: object }
}>
const sample = (scenario: string) => samples.find((item) => item.scenario === scenario)!

test("真实直接拒绝与 Code Mode completed 的拒绝都能投影,正常成功不误报", () => {
  expect(firstAutomationDenial(sample("default").messages, "standard")).toBeUndefined()
  expect(firstAutomationDenial(sample("ask").messages, "standard")).toBeUndefined()
  expect(firstAutomationDenial(sample("readonly").messages, "readonly")).toBe("这个任务是只读档,不能使用「echo」。")
  expect(firstAutomationDenial(sample("binding").messages, "standard")).toContain("到 设置 → 工具 处理后")
  for (const scenario of ["env", "subagent", "outside"])
    expect(firstAutomationDenial(sample(scenario).messages, "standard")).toBe(
      `自动化任务不能使用「${scenario === "subagent" ? "subagent" : "read"}」做这一步。`,
    )
})

test("按调用时间取第一条,坏 metadata 和非终态不会冒充拒绝", () => {
  expect(firstAutomationDenial([...sample("binding").messages, ...sample("readonly").messages], "standard")).toBe(
    "这个任务是只读档,不能使用「echo」。",
  )
  const messages = structuredClone(sample("readonly").messages)
  for (const message of messages)
    if (message.type === "assistant")
      for (const part of message.content) {
        if (part.type !== "tool" || part.state.status !== "completed") continue
        part.state.metadata = { codepuppyUnattendedDenial: { version: 99 } }
      }
  expect(firstAutomationDenial(messages, "readonly")).toBeUndefined()
})

test("全量读取跟随真实游标,第二页不带 order,早期拒绝不会被 50 条回复窗口漏掉", async () => {
  const pages = [
    { data: Array.from({ length: 60 }, () => sample("default").messages).flat(), cursor: sample("default").cursor },
    { data: sample("binding").messages, cursor: sample("binding").cursor },
    sample("binding").emptyPage,
  ]
  const queries: URLSearchParams[] = []
  const client = engineClient({ url: "http://127.0.0.1:1", password: null }, (async (input: string | URL | Request) => {
    const query = new URL(input instanceof Request ? input.url : String(input)).searchParams
    queries.push(query)
    if (query.has("cursor") && query.has("order"))
      return Response.json({ message: "Cursor cannot be combined with order" }, { status: 400 })
    return Response.json(pages[queries.length - 1])
  }) as typeof fetch)
  expect(await readAutomationDenial(client, "ses_fixture", "standard")).toContain("「echo」需要你先确认")
  expect(queries).toHaveLength(3)
  expect(queries[0]!.get("order")).toBe("asc")
  expect(queries[1]!.get("cursor")).toBe(sample("default").cursor.next)
  expect(queries[1]!.has("order")).toBe(false)
})

test("读取消息失败只记日志,不替运行编造拒绝", async () => {
  const logging = await import("./logging")
  const warnings: unknown[][] = []
  const logger = spyOn(logging, "getLogger").mockReturnValue({
    warn: (...args: unknown[]) => warnings.push(args),
  } as never)
  try {
    const client = engineClient({ url: "http://127.0.0.1:1", password: null }, (async () => {
      throw new Error("fixture read unavailable")
    }) as typeof fetch)
    expect(await readAutomationDenial(client, "ses_fixture", "standard")).toBeUndefined()
    expect(warnings).toHaveLength(1)
  } finally {
    logger.mockRestore()
  }
})

test("投影沿用任务中断信号,在途读取不会拖过任务期限", async () => {
  const logging = await import("./logging")
  const logger = spyOn(logging, "getLogger").mockReturnValue({ warn: () => {} } as never)
  const entered = Promise.withResolvers<void>()
  const controller = new AbortController()
  try {
    const client = engineClient({ url: "http://127.0.0.1:1", password: null }, (async (
      _input: string | URL | Request,
      init?: RequestInit,
    ) => {
      entered.resolve()
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      )
    }) as typeof fetch)
    const result = readAutomationDenial(client, "ses_fixture", "standard", controller.signal)
    await entered.promise
    controller.abort()
    expect(await result).toBeUndefined()
  } finally {
    logger.mockRestore()
  }
})
