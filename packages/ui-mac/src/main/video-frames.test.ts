import { expect, test } from "bun:test"
import { frameAt, selectedTimes } from "../../resources/video-mcp/frames"

test("frame selection preserves request order and actual presentation times, including the first scene", () => {
  // Source-time selection inputs are our own internal domain, not fake ffprobe output.
  const points = [0, 40, 80, 120, 160]
  expect(frameAt(points, 79)).toBe(40)
  expect(selectedTimes({ kind: "times", timesMs: [121, 39, 80] }, points, 200)).toEqual([
    { requestedMs: 121, actualMs: 120 },
    { requestedMs: 39, actualMs: 0 },
    { requestedMs: 80, actualMs: 80 },
  ])
  expect(
    selectedTimes({ kind: "scenes", threshold: 0.05, range: { startMs: 50, endMs: 150 } }, points, 200, [80, 160]),
  ).toEqual([
    { requestedMs: null, actualMs: 40 },
    { requestedMs: null, actualMs: 80 },
  ])
})

test("OCR helper bounds numerical edge overshoot inside the image",async()=>{
 const {ocrBox}=await import("../../resources/video-mcp/ocr")
 expect(ocrBox(-0.01,-0.02,100.03,100.04,100,100)).toEqual([0,0,1,1])
 expect(ocrBox(25,20,75,80,100,100)).toEqual([0.25,0.2,0.5,0.6])
})
