import { createRequire } from "node:module"
import { readFile } from "node:fs/promises"
import { parentPort, workerData } from "node:worker_threads"
import { composeSegments, coverAudio, SAMPLE_RATE, timedText, type TimedText, type SpeakerSpan } from "./audio"
import type { PreparedComponent } from "./runtime"

// Narrow types describe the actual sherpa 2.0.3 JS surface (non-streaming-asr.js,
// spoken-language-identification.js and non-streaming-speaker-diarization.js).
type Stream = { acceptWaveform: (input: { samples: Float32Array; sampleRate: number }) => void }
type NativeRecognizer = {
  createStream: () => Stream
  decode: (stream: Stream) => void
  getResult: (stream: Stream) => { text: string; lang: string; tokens: string[]; timestamps: number[] }
}
type NativeVad = {
  acceptWaveform: (samples: Float32Array) => void
  flush: () => void
  isEmpty: () => boolean
  front: (copy: boolean) => { start: number; samples: Float32Array }
  pop: () => void
}
type Sherpa = {
  OfflineRecognizer: new (config: unknown) => NativeRecognizer
  Vad: new (config: unknown, seconds: number) => NativeVad
  SpokenLanguageIdentification: new (config: unknown) => {
    createStream: () => Stream
    compute: (stream: Stream) => string
  }
  OfflineSpeakerDiarization: new (config: unknown) => {
    process: (samples: Float32Array) => { start: number; end: number; speaker: number }[]
  }
}
type Whisper = {
  initWhisper: (config: {
    filePath: string
    useGpu: boolean
  }) => Promise<{
    transcribeData: (
      data: ArrayBuffer,
      options: { language: string; translate: boolean; temperature: number },
    ) => { promise: Promise<{ segments: { t0: number; t1: number; text: string }[] }> }
    release: () => Promise<void>
  }>
}

async function recognize() {
  const input = workerData as {
    sourceId: string
    audio: { file: string; samples: number; offsetMs: number }
    components: Record<string, PreparedComponent>
    platform: string
    chunks: { key: string; parts: TimedText[]; assets: string[] }[]
    speakers?: SpeakerSpan[]
  }
  const component = (name: string) => input.components[name]!.path
  const require = createRequire(import.meta.url)
  const sherpa = require("sherpa-onnx-node") as Sherpa
  const raw = await readFile(input.audio.file)
  const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
  const vad = new sherpa.Vad(
    {
      sileroVad: {
        model: component("vad"),
        threshold: 0.3,
        minSilenceDuration: 0.5,
        minSpeechDuration: 0.25,
        maxSpeechDuration: 15,
        windowSize: 512,
      },
      sampleRate: SAMPLE_RATE,
      numThreads: 1,
    },
    60,
  )
  const speech: { start: number; end: number }[] = []
  const drain = () => {
    while (!vad.isEmpty()) {
      const span = vad.front(false)
      speech.push({ start: span.start, end: span.start + span.samples.length })
      vad.pop()
    }
  }
  for (let start = 0; start < samples.length; start += 512) {
    const block = new Float32Array(512)
    block.set(samples.subarray(start, start + 512))
    vad.acceptWaveform(block)
    drain()
  }
  vad.flush()
  drain()
  parentPort!.postMessage({
    kind: "progress",
    value: { phase: "diarizing", completed: 0, total: Math.round((samples.length / SAMPLE_RATE) * 1000), unit: "ms" },
  })
  const diarization = new sherpa.OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: component("diarization-segmentation") }, numThreads: 4, provider: "cpu" },
    embedding: { model: component("speaker-embedding"), numThreads: 4, provider: "cpu" },
    clustering: { numClusters: -1, threshold: 0.5 },
  })
  const speakers =
    input.speakers ??
    diarization
      .process(samples)
      .map((span) => ({
        startMs: Math.round(span.start * 1000) + input.audio.offsetMs,
        endMs: Math.round(span.end * 1000) + input.audio.offsetMs,
        speaker: span.speaker,
      }))
  if (!input.speakers) await save("speakers", speakers)
  parentPort!.postMessage({
    kind: "progress",
    value: {
      phase: "diarizing",
      completed: Math.round((samples.length / SAMPLE_RATE) * 1000),
      total: Math.round((samples.length / SAMPLE_RATE) * 1000),
      unit: "ms",
    },
  })
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      senseVoice: { model: component("sensevoice"), language: "", useInverseTextNormalization: 1 },
      tokens: component("sensevoice-tokens"),
      numThreads: 4,
      provider: "cpu",
    },
  })
  const lid = new sherpa.SpokenLanguageIdentification({
    whisper: { encoder: component("lid-encoder"), decoder: component("lid-decoder") },
    numThreads: 4,
    provider: "cpu",
  })
  const parts: TimedText[] = []
  const assets = Object.values(input.components).map((entry) => entry.digest)
  let whisper: Awaited<ReturnType<Whisper["initWhisper"]>> | undefined
  try {
    for (const [start, end] of coverAudio(samples.length, speech)) {
      const existing = input.chunks.find((chunk) => chunk.key === `${start}-${end}`)
      if (existing) {
        parts.push(...existing.parts)
        assets.push(...existing.assets)
        parentPort!.postMessage({
          kind: "progress",
          value: {
            phase: "transcribing",
            completed: Math.round((end / SAMPLE_RATE) * 1000),
            total: Math.round((samples.length / SAMPLE_RATE) * 1000),
            unit: "ms",
          },
        })
        continue
      }
      const countBefore = parts.length
      const block = new Float32Array(Math.max(1600, end - start))
      block.set(samples.subarray(start, end))
      const stream = lid.createStream()
      stream.acceptWaveform({ samples: block, sampleRate: SAMPLE_RATE })
      const language = (() => {
        try {
          const code = new Intl.Locale(lid.compute(stream).replaceAll("_", "-")).baseName
          if (code !== "und") return code
        } catch {
          /* Retry the same covered audio after collecting the actual local diagnostic. */
        }
        const diagnostic = recognizer.createStream()
        diagnostic.acceptWaveform({ samples: block, sampleRate: SAMPLE_RATE })
        recognizer.decode(diagnostic)
        const detected = recognizer.getResult(diagnostic).lang
        const retry = lid.createStream()
        retry.acceptWaveform({ samples: block, sampleRate: SAMPLE_RATE })
        const code = new Intl.Locale(lid.compute(retry).replaceAll("_", "-")).baseName
        if (code === "und") throw new Error(`Local language identification failed (SenseVoice language: ${detected})`)
        return code
      })()
      const offset = Math.round((start / SAMPLE_RATE) * 1000) + input.audio.offsetMs
      const tail = Math.round((end / SAMPLE_RATE) * 1000) + input.audio.offsetMs
      if (["zh", "en", "ja", "ko", "yue"].includes(language.split("-")[0]!)) {
        const speechStream = recognizer.createStream()
        speechStream.acceptWaveform({ samples: block, sampleRate: SAMPLE_RATE })
        recognizer.decode(speechStream)
        const result = recognizer.getResult(speechStream)
        parts.push(
          ...timedText(
            result.text,
            result.tokens,
            result.timestamps.map((time) => Math.min(tail, Math.max(0, offset + Math.round(time * 1000)))),
            tail,
            language,
          ).filter((part) => part.endMs > part.startMs),
        )
      } else {
        if (!whisper) {
          const model = await new Promise<PreparedComponent>((resolve) => {
            parentPort!.once("message", (message) => resolve(message.value))
            parentPort!.postMessage({ kind: "whisper" })
          })
          assets.push(model.digest)
          whisper = await (require("@fugood/whisper.node") as Whisper).initWhisper({
            filePath: model.path,
            useGpu: input.platform === "darwin-arm64",
          })
        }
        const pcm = Buffer.alloc(block.length * 2)
        block.forEach((value, index) =>
          pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32767))), index * 2),
        )
        const result = await whisper.transcribeData(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength), {
          language,
          translate: false,
          temperature: 0,
        }).promise
        parts.push(
          ...result.segments
            .map((segment) => ({
              text: segment.text,
              startMs: Math.min(tail, Math.max(0, offset + segment.t0)),
              endMs: Math.min(tail, offset + segment.t1),
              language,
            }))
            .filter((part) => part.endMs > part.startMs),
        )
      }
      await save("chunk", { key: `${start}-${end}`, parts: parts.slice(countBefore), assets: [...new Set(assets)] })
      parentPort!.postMessage({
        kind: "progress",
        value: {
          phase: "transcribing",
          completed: Math.round((end / SAMPLE_RATE) * 1000),
          total: Math.round((samples.length / SAMPLE_RATE) * 1000),
          unit: "ms",
        },
      })
    }
  } finally {
    await whisper?.release()
  }
  parentPort!.postMessage({
    kind: "result",
    value: { segments: composeSegments(parts, speakers, input.sourceId), assets },
  })
}

async function save(kind: "chunk" | "speakers", value: unknown) {
  await new Promise<void>((resolve) => {
    parentPort!.once("message", () => resolve())
    parentPort!.postMessage({ kind, value })
  })
}

if (parentPort)
  void recognize().catch((error: unknown) =>
    parentPort!.postMessage({
      kind: "error",
      value: error instanceof Error ? error.message : "Speech recognition failed",
    }),
  )
