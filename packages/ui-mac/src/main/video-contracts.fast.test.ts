import { expect, test } from "bun:test"
import { inputs, timeRange, videoToolDefinitions } from "../../resources/video-mcp/contracts"

test("media tool contracts reject unknown fields and invalid ranges without adding duration or frame-count limits", () => {
  expect(inputs.info.safeParse({ source: { kind: "path", path: "/a.mp4" }, extra: true }).success).toBe(false)
  expect(timeRange.safeParse({ startMs: 3, endMs: 3 }).success).toBe(false)
  expect(inputs.frames.safeParse({ source: { kind: "id", id: "a" }, selection: { kind: "times", timesMs: [0, 3_600_000] } }).success).toBe(true)
  expect(inputs.search.safeParse({ source: { kind: "id", id: "a" } }).success).toBe(false)
  expect(inputs.search.parse({ source: { kind: "id", id: "a" }, text: "word" }).contextBefore).toBe(1)
  expect(videoToolDefinitions().map((tool) => tool.name)).toEqual(Object.keys(inputs))
})
