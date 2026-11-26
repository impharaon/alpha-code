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
