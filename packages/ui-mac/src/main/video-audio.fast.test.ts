import { expect, test } from "bun:test"
import { coverAudio, SAMPLE_RATE, composeSegments, timedText, speakerAt } from "../../resources/video-mcp/audio"

test("audio coverage retains no-VAD speech, continuous speech and the shortest tail exactly once", () => {
  for (const count of [1, 137, SAMPLE_RATE * 61 + 37]) {
    const chunks = coverAudio(count, [])
    expect(chunks[0]?.[0]).toBe(0)
    expect(chunks.at(-1)?.[1]).toBe(count)
    expect(chunks.reduce((sum, [start, end]) => sum + end - start, 0)).toBe(count)
    expect(chunks.every(([start, end], index) => end > start && end - start <= 30 * SAMPLE_RATE && (!index || start === chunks[index - 1]![1]))).toBe(true)
  }
})

test("speaker projection preserves ambiguity and sums a person's separate spans", () => {
  expect(speakerAt(0, 1000, [{ startMs: 0, endMs: 500, speaker: 1 }, { startMs: 400, endMs: 900, speaker: 2 }])).toBeNull()
  expect(speakerAt(0, 1000, [{ startMs: 0, endMs: 200, speaker: 1 }, { startMs: 200, endMs: 500, speaker: 2 }, { startMs: 500, endMs: 900, speaker: 1 }])).toBe(1)
  expect(speakerAt(1000, 2000, [])).toBeNull()
})

test("visible text retains punctuation but uses real token starts and stable full-track speaker identity", () => {
  // These are internal timed-text inputs, not fabricated sherpa JSON or PCM media.
  const parts = timedText("Hello. World!", ["Hello", ".", " World", "!"], [600, 1200, 2400, 3000], 3300, "en")
  const segments = composeSegments(parts, [{ startMs: 400, endMs: 1400, speaker: 9 }, { startMs: 2200, endMs: 3300, speaker: 2 }], "source")
  expect(segments.map((part) => [part.text, part.startMs, part.speaker])).toEqual([["Hello.", 600, "speaker-1"], ["World!", 2400, "speaker-2"]])
  expect(() => timedText("speech", [], [], 1000, "en")).toThrow("token timestamps")
})
