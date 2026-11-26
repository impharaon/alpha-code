import { randomUUID } from "node:crypto"
import { mkdir, rm, stat } from "node:fs/promises"
import { Worker } from "node:worker_threads"
import { cachePath, digest } from "./cache"
import { runComponent } from "./process"
import { mediaInfo, sourceFile, verifySourceFile, type Source } from "./source"
import { fail, type PreparedComponent, type VideoRuntime } from "./runtime"
import type { TranscriptSegment } from "./contracts"

export const SAMPLE_RATE = 16000
export type SpeechSpan = { start: number; end: number }
export type SpeakerSpan = { startMs: number; endMs: number; speaker: number }
export type TimedText = { text: string; startMs: number; endMs: number; language: string }

/** VAD chooses cuts, never the sample domain to recognize. */
export function coverAudio(samples: number, speech: readonly SpeechSpan[]) {
  const cuts = speech
    .slice(1)
    .map((span, index) => Math.round((speech[index]!.end + span.start) / 2))
    .filter((value) => value > 0 && value < samples)
  const chunks: [number, number][] = []
  let start = 0
  while (start < samples) {
    const maximum = Math.min(samples, start + 30 * SAMPLE_RATE)
    const target = Math.min(samples, start + 20 * SAMPLE_RATE)
    const candidates = cuts.filter((cut) => cut > start && cut <= maximum)
    const end =
      maximum === samples
        ? samples
        : candidates.reduce((best, cut) => (Math.abs(cut - target) < Math.abs(best - target) ? cut : best), maximum)
    chunks.push([start, end])
    start = end
  }
  return chunks
}

export function speakerAt(startMs: number, endMs: number, spans: readonly SpeakerSpan[]) {
  const active = spans.filter((span) => span.endMs > startMs && span.startMs < endMs)
  if (
    active.some((left, index) =>
      active
        .slice(index + 1)
        .some(
          (right) =>
            right.speaker !== left.speaker &&
            Math.max(startMs, left.startMs, right.startMs) < Math.min(endMs, left.endMs, right.endMs),
        ),
    )
  )
    return null
  const totals = new Map<number, number>()
  for (const span of active)
    totals.set(
      span.speaker,
      (totals.get(span.speaker) ?? 0) + Math.max(0, Math.min(endMs, span.endMs) - Math.max(startMs, span.startMs)),
    )
  const overlap = [...totals]
    .map(([speaker, amount]) => ({ speaker, amount }))
    .sort((left, right) => right.amount - left.amount)
  if (!overlap.length || overlap[1]?.amount === overlap[0]!.amount) return null
  return overlap[0]!.speaker
}

export function composeSegments(
  parts: readonly TimedText[],
  speakers: readonly SpeakerSpan[],
  sourceId: string,
): TranscriptSegment[] {
  const order = [
    ...new Set([...speakers].sort((left, right) => left.startMs - right.startMs).map((span) => span.speaker)),
  ]
  const groups: TranscriptSegment[] = []
  for (const part of parts) {
    const assigned = speakerAt(part.startMs, part.endMs, speakers)
    const speaker = assigned === null ? null : `speaker-${order.indexOf(assigned) + 1}`
    const previous = groups.at(-1)
    if (previous && /^[\s\p{P}\p{S}]+$/u.test(part.text)) {
      previous.text += part.text
      continue
    }
    if (
      previous &&
      previous.speaker === speaker &&
      previous.language === part.language &&
      !/[。！？.!?]\s*$/.test(previous.text) &&
      part.startMs - previous.endMs < 1500
    ) {
      previous.text += part.text
      previous.endMs = Math.max(previous.endMs, part.endMs)
      continue
    }
    groups.push({ id: digest(`${sourceId}:${part.startMs}:${groups.length}`), ...part, speaker })
  }
  return groups
    .map((segment) => ({ ...segment, text: segment.text.trim() }))
    .filter((segment) => segment.text.length > 0)
}

/** Align visible text to actual token starts. Inserted punctuation follows its
 * neighboring token; no character-count interpolation creates timestamps. */
export function timedText(
  text: string,
  tokens: readonly string[],
  starts: readonly number[],
  endMs: number,
  language: string,
): TimedText[] {
  if (!text.trim()) return []
  if (
    !tokens.length ||
    tokens.length !== starts.length ||
    starts.some((value, index) => !Number.isFinite(value) || value < 0 || (index > 0 && value < starts[index - 1]!))
  )
    fail("processing_failed", "The recognizer did not provide valid token timestamps.")
  const characters = [...text]
  const observed = tokens.flatMap((token, index) =>
    [...token.replace(/<\|[^>]*\|>/g, "").replaceAll("▁", " ")].map((character) => ({ character, index })),
  )
  const rows = Array.from({ length: characters.length + 1 }, () => new Uint32Array(observed.length + 1))
  for (let i = characters.length - 1; i >= 0; i--)
    for (let j = observed.length - 1; j >= 0; j--)
      rows[i]![j] =
        characters[i] === observed[j]!.character
          ? rows[i + 1]![j + 1]! + 1
          : Math.max(rows[i + 1]![j]!, rows[i]![j + 1]!)
  const aligned = new Map<number, number>()
  let i = 0
  let j = 0
  while (i < characters.length && j < observed.length) {
    if (characters[i] === observed[j]!.character) {
      aligned.set(i, observed[j]!.index)
      i++
      j++
      continue
    }
    if (rows[i + 1]![j]! >= rows[i]![j + 1]!) {
      i++
      continue
    }
    j++
  }
  let token = aligned.values().next().value ?? 0
  const result: TimedText[] = []
  for (let index = 0; index < characters.length; index++) {
    token = aligned.get(index) ?? token
    const startMs = starts[token]!
    const next = starts[token + 1] ?? endMs
    const previous = result.at(-1)
    if (previous?.startMs === startMs) {
      previous.text += characters[index]
      continue
    }
    result.push({ text: characters[index]!, startMs, endMs: Math.max(startMs, Math.min(endMs, next)), language })
  }
  return result
}

export async function decodeAudio(source: Source, runtime: VideoRuntime) {
  const info = await mediaInfo(source, runtime)
  const ffmpeg = await runtime.component("ffmpeg")
  const input = await sourceFile(source)
  const directory = cachePath(runtime, "audio", source.sourceId)
  await mkdir(directory, { recursive: true })
  const file = `${directory}/${randomUUID()}.f32`
  try {
    await runComponent(
      ffmpeg.path,
      [
        "-nostdin",
        "-v",
        "error",
        "-i",
        input,
        "-map",
        "0:a:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        String(SAMPLE_RATE),
        "-f",
        "f32le",
        "pipe:1",
      ],
      runtime,
      file,
    )
    await verifySourceFile(source, input)
    await runtime.progress({ phase: "decoding", completed: info.durationMs, total: info.durationMs, unit: "ms" })
    return { file, samples: (await stat(file)).size / 4, offsetMs: info.audioStartMs }
  } catch (error) {
    await rm(file, { force: true })
    throw error
  }
}

export async function recognizeAudio(
  source: Source,
  audio: Awaited<ReturnType<typeof decodeAudio>>,
  runtime: VideoRuntime,
  recovery: {
    chunks: { key: string; parts: TimedText[]; assets: string[] }[]
    speakers?: SpeakerSpan[]
    save: (kind: "chunk" | "speakers", value: unknown) => Promise<void>
  },
) {
  const names = [
    "sensevoice",
    "sensevoice-tokens",
    "vad",
    "lid-encoder",
    "lid-decoder",
    "diarization-segmentation",
    "speaker-embedding",
  ] as const
  const components = Object.fromEntries(
    await Promise.all(names.map(async (name) => [name, await runtime.component(name)])),
  ) as Record<(typeof names)[number], PreparedComponent>
  return new Promise<{ segments: TranscriptSegment[]; assets: string[] }>((resolve, reject) => {
    const worker = new Worker(new URL("./speech-worker.js", import.meta.url), {
      workerData: {
        sourceId: source.sourceId,
        audio,
        components,
        platform: runtime.platform,
        chunks: recovery.chunks,
        speakers: recovery.speakers,
      },
    })
    const cancel = () => {
      void worker.terminate()
      reject(new DOMException("Media processing cancelled", "AbortError"))
    }
    runtime.signal.addEventListener("abort", cancel, { once: true })
    worker.once("error", reject)
    worker.once("exit", (code) => {
      runtime.signal.removeEventListener("abort", cancel)
      if (code !== 0) reject(new Error(`Speech worker exited ${code}`))
    })
    worker.on("message", async (message: { kind: string; value?: unknown }) => {
      try {
        runtime.signal.throwIfAborted()
        if (message.kind === "chunk" || message.kind === "speakers") {
          await recovery.save(message.kind, message.value)
          worker.postMessage({ kind: "saved" })
        }
        if (message.kind === "progress")
          await runtime.progress(message.value as Parameters<VideoRuntime["progress"]>[0])
        if (message.kind === "whisper")
          worker.postMessage({ kind: "whisper", value: await runtime.component("whisper") })
        if (message.kind === "result") {
          resolve(message.value as { segments: TranscriptSegment[]; assets: string[] })
          await worker.terminate()
        }
        if (message.kind === "error") {
          reject(new Error(String(message.value)))
          await worker.terminate()
        }
      } catch (error) {
        reject(error)
        await worker.terminate()
      }
    })
    if (runtime.signal.aborted) cancel()
  })
}
