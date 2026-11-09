// `#1665` I2 的用例本体 —— 由 plugin-process-singleton.test.ts 在**子进程**里跑:parentPort 必须在 ext 模块求值**之前**就在
// (与 sidecar 预载一样),而同进程的别的测试早已把进程级对象建成「没有 port」的那一份(它挂在 globalThis 上,本来就该跨求值复用)。
//
// OpenCode 2 给每个 Location 各求值一次 ext(开工实测;Node 下 URL 带递增的 `?__opencode_reload=`)。这里用两个不同的 URL
// 求值同一个模块两次,模拟两个 Location。
import { expect, test } from "bun:test"
import { buildReloadRequest, parseCodePuppySidecarInbound } from "../../ui-mac/src/main/codepuppy-sidecar-messages"

const sent: unknown[] = []
const listeners: Array<(event: { data: unknown }) => void> = []
;(process as unknown as { parentPort: unknown }).parentPort = {
  postMessage: (message: unknown) => void sent.push(message),
  on: (_event: string, listener: (event: { data: unknown }) => void) => void listeners.push(listener),
}

const first = await import("./plugin.ts?location=a")
const second = await import("./plugin.ts?location=b")

const reports = () => sent.map((message) => parseCodePuppySidecarInbound(message)).filter((m) => m?.type === "codepuppy.reload.report")

test("同一个 bundle 以两个不同的 URL 求值两次 ⇒ 两个模块记录、一个进程级对象:parentPort 上只挂了一个 message 监听,一条重载请求只入队一次", async () => {
  expect(first).not.toBe(second)
  expect(first.processState()).toBe(second.processState())
  expect(listeners).toHaveLength(1)
  for (const listener of listeners)
    listener({ data: buildReloadRequest({ generation: 7, scope: "global", items: [{ id: "skill:writer", scope: "global" }], reason: "installed skill writer" }) })
  await first.processState().reloads.settled()
  // 没有登记任何 Location ⇒ 直接 reloaded(下一次加载读新状态);关键是**只报一次**。
  expect(reports()).toEqual([{ type: "codepuppy.reload.report", generation: 7, scope: "global", outcome: "reloaded", directories: [] }])
})
