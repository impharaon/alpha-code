import { runComponent } from "./process"
import { fail, type VideoRuntime } from "./runtime"
import type { Frame } from "./contracts"

type Ocr = Frame["ocr"]

export function tesseractLines(tsv: string, width: number, height: number): Ocr {
  const lines = new Map<string, { words: string[]; x: number; y: number; right: number; bottom: number }>()
  for (const row of tsv.trim().split(/\r?\n/).slice(1)) {
    const fields = row.split("\t")
    if (fields[0] !== "5" || !fields.slice(11).join("\t").trim()) continue
    const [x, y, w, h] = fields.slice(6, 10).map(Number)
    if ([x, y, w, h].some((value) => value === undefined || !Number.isFinite(value)))
      fail("processing_failed", "The local OCR output is invalid.")
    const key = fields.slice(1, 5).join(":")
    const existing = lines.get(key)
    const text = fields.slice(11).join("\t").trim()
    if (existing) {
      existing.words.push(text)
      existing.x = Math.min(existing.x, x!)
      existing.y = Math.min(existing.y, y!)
      existing.right = Math.max(existing.right, x! + w!)
      existing.bottom = Math.max(existing.bottom, y! + h!)
      continue
    }
    lines.set(key, { words: [text], x: x!, y: y!, right: x! + w!, bottom: y! + h! })
  }
  const normalized = [...lines.values()].map((line) => ({
    text: line.words.join(" "),
    box: [line.x / width, line.y / height, (line.right - line.x) / width, (line.bottom - line.y) / height] as [
      number,
      number,
      number,
      number,
    ],
  }))
  return { text: normalized.map((line) => line.text).join("\n"), lines: normalized }
}

export async function readFrameText(
  image: string,
  width: number,
  height: number,
  runtime: VideoRuntime,
): Promise<{ ocr: Ocr; digest: string }> {
  const helper = await runtime.component("ocr")
  if (runtime.platform === "darwin-arm64") {
    const result = await runComponent(helper.path, [image], runtime)
    const parsed = JSON.parse(result.stdout) as Ocr
    if (
      typeof parsed.text !== "string" ||
      !Array.isArray(parsed.lines) ||
      parsed.lines.some(
        (line) =>
          typeof line.text !== "string" ||
          line.box.length !== 4 ||
          line.box.some((value) => !Number.isFinite(value) || value < 0 || value > 1),
      )
    )
      fail("processing_failed", "The local OCR output is invalid.")
    return { ocr: parsed, digest: helper.digest }
  }
  const base = await runtime.component("ocr-model")
  const orientation = await runComponent(
    helper.path,
    [image, "stdout", "--tessdata-dir", base.path, "-l", "osd", "--psm", "0"],
    runtime,
  ).catch((error) => {
    // Tesseract reports too few characters on blank/sparse images. It still has
    // a valid OCR path; other failures must remain visible.
    if (error instanceof Error && /Too few characters|Skipping this page/.test(error.message))
      return { stdout: "", stderr: "" }
    throw error
  })
  const script = /Script:\s*([^\r\n]+)/.exec(orientation.stdout)?.[1]?.trim()
  const extra =
    script && !["Latin", "Han", "HanS", "HanT"].includes(script)
      ? await runtime.component({ kind: "ocr-model", script })
      : undefined
  const models = extra ?? base
  const language = extra ? `script/${script}` : "chi_sim+chi_tra+eng"
  const result = await runComponent(
    helper.path,
    [image, "stdout", "--tessdata-dir", models.path, "-l", language, "--psm", "3", "tsv"],
    runtime,
  )
  return { ocr: tesseractLines(result.stdout, width, height), digest: `${helper.digest}:${models.digest}` }
}
