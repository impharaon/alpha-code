import pins from "../pinned-files.json"

export const videoRecipes = [
  {
    id: "speech-model/any/sensevoice-2024-07-17-int8",
    archive: "tar.bz2",
    entry: "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17",
    required: [
      "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17",
      "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/model.int8.onnx",
      "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/tokens.txt",
    ],
  },
  {
    id: "speech-model/any/whisper-tiny-lid",
    archive: "tar.bz2",
    entry: "sherpa-onnx-whisper-tiny",
    required: [
      "sherpa-onnx-whisper-tiny",
      "sherpa-onnx-whisper-tiny/tiny-encoder.int8.onnx",
      "sherpa-onnx-whisper-tiny/tiny-decoder.int8.onnx",
    ],
  },
  { id: "speech-model/any/silero-vad", archive: "file", entry: "silero_vad.onnx", required: ["silero_vad.onnx"] },
  {
    id: "speech-model/any/pyannote-segmentation-3-0",
    archive: "tar.bz2",
    entry: "sherpa-onnx-pyannote-segmentation-3-0",
    required: ["sherpa-onnx-pyannote-segmentation-3-0", "sherpa-onnx-pyannote-segmentation-3-0/model.int8.onnx"],
  },
  {
    id: "speech-model/any/3dspeaker-eres2net-base",
    archive: "file",
    entry: "embedding.onnx",
    required: ["embedding.onnx"],
  },
  {
    id: "speech-model/any/whisper-turbo-q5",
    archive: "file",
    entry: "ggml-large-v3-turbo-q5_0.bin",
    required: ["ggml-large-v3-turbo-q5_0.bin"],
  },
  ...["darwin-arm64", "win32-x64"].map((target) => ({
    id: `ffmpeg/${target}/9.1-openh264-2.7.0`,
    archive: "tar.gz",
    entry: "ffmpeg",
    required: [
      "ffmpeg",
      `ffmpeg/bin/ffmpeg${target === "win32-x64" ? ".exe" : ""}`,
      `ffmpeg/bin/ffprobe${target === "win32-x64" ? ".exe" : ""}`,
      "ffmpeg/licenses/LGPL-2.1.txt",
      "ffmpeg/licenses/OpenH264.txt",
    ],
  })),
  ...["darwin-arm64", "win32-x64"].map((target) => ({
    id: `python/${target}/3.12.16-20261124`,
    archive: "tar.gz",
    entry: target === "darwin-arm64" ? "python/bin/python3" : "python/python.exe",
    required: [target === "darwin-arm64" ? "python/bin/python3" : "python/python.exe"],
  })),
  ...pins.files
    .filter((pin) => pin.family === "ocr-model")
    .map((pin) => {
      const entry = `${pin.id.split("/").at(-1)}.traineddata`
      return { id: pin.id, archive: "file", entry, required: [entry] }
    }),
] as const

export const modelRoles = {
  sensevoice: { id: videoRecipes[0].id, member: "model.int8.onnx" },
  "sensevoice-tokens": { id: videoRecipes[0].id, member: "tokens.txt" },
  "lid-encoder": { id: videoRecipes[1].id, member: "tiny-encoder.int8.onnx" },
  "lid-decoder": { id: videoRecipes[1].id, member: "tiny-decoder.int8.onnx" },
  vad: { id: videoRecipes[2].id, member: "" },
  "diarization-segmentation": { id: videoRecipes[3].id, member: "model.int8.onnx" },
  "speaker-embedding": { id: videoRecipes[4].id, member: "" },
  whisper: { id: videoRecipes[5].id, member: "" },
} as const

export const defaultOcrLanguages = ["chi_sim", "chi_tra", "eng", "osd"] as const

export function defaultOcrPins() {
  return defaultOcrLanguages.map((language) => {
    const pin = pins.files.find(
      (pin) => pin.family === "ocr-model" && pin.id.split("/").at(-1)?.startsWith(`${language}-`),
    )
    if (!pin) throw new Error(`Missing default OCR pin: ${language}`)
    return pin
  })
}

/** Unique compressed deliveries for the complete zh/en local transcript path. */
export function firstVideoPins(target: "darwin-arm64" | "win32-x64") {
  const ids = new Set(
    Object.entries(modelRoles)
      .filter(([name]) => name !== "whisper")
      .map(([, role]) => role.id as string),
  )
  const codec = videoRecipes.find((recipe) => recipe.id.startsWith(`ffmpeg/${target}/`))
  if (!codec) throw new Error(`Missing codec recipe: ${target}`)
  ids.add(codec.id)
  if (target === "win32-x64") for (const pin of defaultOcrPins()) ids.add(pin.id)
  return [...ids].map((id) => {
    const pin = pins.files.find((pin) => pin.id === id)
    if (!pin) throw new Error(`Missing first-use video pin: ${id}`)
    return pin
  })
}
