import { expect, test } from "bun:test"
import pins from "../../resources/pinned-files.json"
import { defaultOcrPins, firstVideoPins, videoRecipes } from "../../resources/video-mcp/asset-recipes"

// Fast PR layer: selected files and download arithmetic, no downloads/builds.
test("first complete zh/en preparation includes every speech role and target codec, without turbo or extra scripts", () => {
  const speech = [
    "sensevoice-2024-07-17-int8",
    "whisper-tiny-lid",
    "silero-vad",
    "pyannote-segmentation-3-0",
    "3dspeaker-eres2net-base",
  ].map((name) => `speech-model/any/${name}`)
  for (const target of ["darwin-arm64", "win32-x64"] as const) {
    const files = firstVideoPins(target)
    const ids = files.map((file) => file.id)
    expect(ids).toEqual(expect.arrayContaining(speech))
    expect(files.filter((file) => file.family === "ffmpeg").map((file) => file.target)).toEqual([target])
    expect(ids).not.toContain("speech-model/any/whisper-turbo-q5")
    expect(files.filter((file) => file.family === "ocr-model")).toEqual(target === "win32-x64" ? defaultOcrPins() : [])
    expect(ids).toHaveLength(target === "win32-x64" ? 10 : 6)
    expect(files.reduce((sum, file) => sum + file.bytes, 0)).toBeLessThanOrEqual(400_000_000)
  }
})

test("each video recipe references a unique pinned delivery and requires its actual entry", () => {
  expect(new Set(pins.files.map((file) => file.id)).size).toBe(pins.files.length)
  for (const recipe of videoRecipes) {
    expect(pins.files.find((file) => file.id === recipe.id)).toBeDefined()
    expect(recipe.required).toContain(recipe.entry)
  }
  expect(pins.files.filter((file) => file.family === "ocr-model")).toHaveLength(41)
})
