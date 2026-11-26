import { expect, test } from "bun:test"
import { withVideoProgress } from "../src/mcp/codepuppy-video-progress"
import { VIDEO_PROGRESS_KEY } from "@opencode/schema/codepuppy-video-progress"

test("video progress retains ordered complete facts and ignores cancelled or late callbacks", async () => {
  const controller = new AbortController()
  const received: unknown[] = []
  const notification = { _meta: { [VIDEO_PROGRESS_KEY]: { phase: "transcribing", completed: 1000, unit: "ms" } } }
  let late: (update: typeof notification) => void = () => {}
  const result = await withVideoProgress(controller.signal, async (update) => { received.push(update) }, async (onprogress) => {
    late = onprogress
    onprogress(notification)
    return "answer"
  })
  late(notification)
  expect(result).toBe("answer")
  expect(received).toEqual([{ phase: "transcribing", completed: 1000, unit: "ms" }])
  await withVideoProgress(controller.signal, async (update) => { received.push(update) }, async (onprogress) => {
    onprogress({ _meta: { [VIDEO_PROGRESS_KEY]: { phase: "invented", completed: 1, unit: "ms" } } })
    controller.abort()
    onprogress(notification)
    return undefined
  })
  expect(received).toHaveLength(1)
})
