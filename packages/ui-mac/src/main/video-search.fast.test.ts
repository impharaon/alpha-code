import { expect, test } from "bun:test"
import { searchTranscript } from "../../resources/video-mcp/search"
import type { TranscriptSegment } from "../../resources/video-mcp/contracts"

const segments: TranscriptSegment[] = ["before", "Ｕnique word", "after"].map((text, index) => ({ id: String(index), text, startMs: index * 1000, endMs: index * 1000 + 900, language: "en", speaker: null }))
test("transcript search intersects literal Unicode text with the source range and returns context", () => {
  expect(searchTranscript(segments, { text: "unique", range: { startMs: 1500, endMs: 2000 }, contextBefore: 1, contextAfter: 1 })).toEqual([{ match: segments[1], before: [segments[0]], after: [segments[2]] }])
  expect(searchTranscript(segments, { text: "unique", range: { startMs: 2000, endMs: 3000 }, contextBefore: 1, contextAfter: 1 })).toEqual([])
})
