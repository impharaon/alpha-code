import { expect, test } from "bun:test"
import { MEDIA_METADATA_KEY, mediaAttachmentOf, mediaKindOf, mediaDurationText } from "./media-attachment"

test("media references preserve original absolute paths and an unknown duration", () => {
  for (const path of ["/Users/me/会议.mp4", "C:\\Media\\会议.mp4", "\\\\host\\share\\meeting.mp4"]) {
    const media = { kind: "video", path, name: "会议.mp4", bytes: 2_000_000_000, durationMs: null }
    expect(mediaAttachmentOf({ [MEDIA_METADATA_KEY]: media })).toEqual(media)
  }
  for (const patch of [{ path: "relative.mp4" }, { durationMs: -1 }, { durationMs: undefined }, { bytes: Infinity }, { extra: true }])
    expect(mediaAttachmentOf({ [MEDIA_METADATA_KEY]: { kind: "video", path: "/a.mp4", name: "a.mp4", bytes: 1, durationMs: null, ...patch } })).toBeUndefined()
})

test("video and audio extensions work without MIME; TypeScript remains text", () => {
  expect(mediaKindOf("talk.MP4")).toBe("video")
  expect(mediaKindOf("talk.MP3")).toBe("audio")
  expect(mediaKindOf("unknown", "audio/flac")).toBe("audio")
  expect(mediaKindOf("source.ts", "video/mp2t")).toBeUndefined()
})


test("known media durations use source time without inventing a duration for null", () => {
  expect(mediaDurationText(0)).toBe("00:00")
  expect(mediaDurationText(61_234)).toBe("01:01")
  expect(mediaDurationText(3_661_234)).toBe("1:01:01")
})
