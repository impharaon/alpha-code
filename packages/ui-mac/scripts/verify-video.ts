// Scores saved results from the real local tools. This does not prepare assets,
// synthesize samples, or turn recorded pilot scores into implementation proof.
import { readFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { fileDigest } from "../resources/video-mcp/cache"
import { outputs } from "../resources/video-mcp/contracts"

const evidenceFile = z.strictObject({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })
const qualitySample = z.strictObject({
  language: z.enum(["zh", "en"]),
  source: evidenceFile,
  durationMs: z.int().positive(),
  reference: evidenceFile,
  transcript: evidenceFile,
  vadTranscript: evidenceFile,
  onsets: z.array(z.strictObject({ quote: z.string().min(1), startMs: z.int().nonnegative() })).length(20),
})
const speakerSample = z.strictObject({ source: evidenceFile, annotation: evidenceFile, transcript: evidenceFile })

async function evidence(file: z.infer<typeof evidenceFile>, directory: string) {
  const absolute = path.resolve(directory, file.path)
  if ((await fileDigest(absolute)) !== file.sha256) throw new Error(`Evidence digest mismatch: ${file.path}`)
  return absolute
}

function tokens(text: string, language: "zh" | "en") {
  const normalized = text.normalize("NFKC").toLowerCase()
  return (
    normalized.match(
      language === "zh" ? /\p{Script=Han}|[a-z0-9]+(?:\.[0-9]+)?/gu : /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu,
    ) ?? []
  )
}

function edits(reference: readonly string[], hypothesis: readonly string[]) {
  let previous = Array.from({ length: hypothesis.length + 1 }, (_, index) => index)
  for (let index = 0; index < reference.length; index++) {
    const current = [index + 1]
    for (let other = 0; other < hypothesis.length; other++)
      current.push(
        Math.min(
          previous[other + 1]! + 1,
          current[other]! + 1,
          previous[other]! + Number(reference[index] !== hypothesis[other]),
        ),
      )
    previous = current
  }
  return previous[hypothesis.length]!
}

async function transcript(file: z.infer<typeof evidenceFile>, directory: string) {
  return outputs.transcript.parse(JSON.parse(await readFile(await evidence(file, directory), "utf8")))
}

async function quality(raw: unknown, directory: string) {
  const samples = z.array(qualitySample).parse(raw)
  for (const language of ["zh", "en"] as const) {
    if (
      samples.filter((sample) => sample.language === language).reduce((sum, sample) => sum + sample.durationMs, 0) <
      (language === "zh" ? 20 : 15) * 60000
    )
      throw new Error(`Insufficient fixed ${language} sample duration`)
  }
  const results = []
  for (const sample of samples) {
    await evidence(sample.source, directory)
    const reference = tokens(await readFile(await evidence(sample.reference, directory), "utf8"), sample.language)
    if (!reference.length) throw new Error("Empty reference transcript")
    const full = await transcript(sample.transcript, directory)
    const vad = await transcript(sample.vadTranscript, directory)
    if (full.sourceId !== sample.source.sha256 || vad.sourceId !== sample.source.sha256)
      throw new Error("Transcript is not bound to the fixed source media")
    const score = (segments: typeof full.segments) => {
      const hypothesis = tokens(segments.map((segment) => segment.text).join(" "), sample.language)
      return {
        errorRate: edits(reference, hypothesis) / reference.length,
        lengthRatio: hypothesis.join("").length / reference.join("").length,
      }
    }
    const actual = score(full.segments)
    const control = score(vad.segments)
    const onsets = sample.onsets.map((label) => {
      const quote = tokens(label.quote, sample.language).join(" ")
      const segment = full.segments.find((segment) => tokens(segment.text, sample.language).join(" ").includes(quote))
      return {
        ...label,
        actualMs: segment?.startMs ?? null,
        within2s: segment !== undefined && Math.abs(segment.startMs - label.startMs) <= 2000,
      }
    })
    const threshold = sample.language === "zh" ? 0.08 : 0.12
    results.push({
      source: sample.source,
      language: sample.language,
      actual,
      vadControl: control,
      onsets,
      pass:
        actual.errorRate <= threshold &&
        actual.lengthRatio >= 0.95 &&
        onsets.filter((onset) => onset.within2s).length >= 18 &&
        (sample.language !== "en" || control.errorRate > 0.12 || control.lengthRatio < 0.95),
    })
  }
  return {
    normalization:
      "NFKC/lowercase; Han characters plus alphanumeric tokens for CER, words preserving apostrophes for WER; no supplied score is trusted",
    results,
    pass: results.every((result) => result.pass),
  }
}

async function speakers(raw: unknown, directory: string) {
  const sample = speakerSample.parse(raw)
  await evidence(sample.source, directory)
  // Annotation is our integer-ms reference schema, derived from the fixed real
  // sample/RTTM with its provenance; it is not a fabricated external RTTM file.
  const reference = z
    .array(z.strictObject({ startMs: z.int().nonnegative(), endMs: z.int().positive(), speaker: z.string() }))
    .parse(JSON.parse(await readFile(await evidence(sample.annotation, directory), "utf8")))
  const names = [...new Set(reference.map((span) => span.speaker))]
  if (
    names.length !== 2 ||
    names.some((name) => reference.filter((span) => span.speaker === name).length < 5) ||
    reference.some((span) => span.endMs <= span.startMs)
  )
    throw new Error("Speaker reference must contain two people with at least five turns each")
  const actual = await transcript(sample.transcript, directory)
  if (actual.sourceId !== sample.source.sha256) throw new Error("Transcript is not bound to the fixed speaker sample")
  const labels = [...new Set(actual.segments.flatMap((segment) => (segment.speaker === null ? [] : [segment.speaker])))]
  const total = reference.reduce((sum, span) => sum + span.endMs - span.startMs, 0)
  if (
    reference.some((left, index) =>
      reference
        .slice(index + 1)
        .some((right) => Math.max(left.startMs, right.startMs) < Math.min(left.endMs, right.endMs)),
    )
  )
    throw new Error("The selected speaker reference contains overlapping turns")
  const correct = (order: string[]) =>
    reference.reduce((sum, span) => {
      const boundaries = [
        ...new Set([
          span.startMs,
          span.endMs,
          ...actual.segments
            .flatMap((segment) => [segment.startMs, segment.endMs])
            .filter((time) => time > span.startMs && time < span.endMs),
        ]),
      ].sort((left, right) => left - right)
      return (
        sum +
        boundaries.slice(1).reduce((duration, end, index) => {
          const start = boundaries[index]!
          const assigned = new Set(
            actual.segments
              .filter((segment) => segment.startMs < end && segment.endMs > start)
              .map((segment) => segment.speaker),
          )
          return duration + (assigned.size === 1 && assigned.has(order[names.indexOf(span.speaker)]!) ? end - start : 0)
        }, 0)
      )
    }, 0)
  const ratio = labels.length === 2 ? Math.max(correct(labels), correct([...labels].reverse())) / total : 0
  return { source: sample.source, correctDurationRatio: ratio, pass: labels.length === 2 && ratio >= 0.8 }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const selected = args[args.indexOf("--case") + 1]
  const manifest = args[args.indexOf("--samples") + 1]
  if (
    !args.includes("--case") ||
    !args.includes("--samples") ||
    !manifest ||
    !["transcript-quality", "speakers"].includes(selected ?? "")
  )
    throw new Error(
      "Usage: bun scripts/verify-video.ts --case <transcript-quality|speakers> --samples <fixed evidence manifest.json>",
    )
  const raw: unknown = JSON.parse(await readFile(manifest, "utf8"))
  const result =
    selected === "speakers"
      ? await speakers(raw, path.dirname(path.resolve(manifest)))
      : await quality(raw, path.dirname(path.resolve(manifest)))
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!result.pass) process.exitCode = 1
}
