import { Tool } from "../../schema/src/tool"
import { ProtectedFiles } from "../../schema/src/codepuppy-protected-files"
import { envAssignments, envSecret } from "./secret-values"

/** Consume an already encoded read page. Page selection and line labels belong to the reader. */
export function projectSecretRead(input: {
  file: ProtectedFiles.ProtectedFile
  result: Tool.Result
  sources: readonly string[]
  requested: string
  target: string
  mask: (text: string) => string
}): Tool.Result {
  if (input.file.view === "notice") return {
    output: { type: "text-page", content: ProtectedFiles.PROTECTED_FILE_TEXT, mime: "text/plain", offset: 1, truncated: false },
    content: [{ type: "text", text: ProtectedFiles.PROTECTED_FILE_TEXT }],
    metadata: { ...input.result.metadata, truncated: false },
  }
  const output = input.result.output as Record<string, unknown> | undefined
  if (!output || typeof output.content !== "string" || typeof output.mime !== "string" ||
    !(output.type === "text-page" || output.type === "file" && output.encoding === "utf8")) throw new Error("Not a text read page")
  const content = typeof input.result.content === "string" ? input.result.content
    : input.result.content?.map((item) => {
        if (item.type !== "text") throw new Error("Non-text read content")
        return item.text
      }).join("\n")
  if (content === undefined) throw new Error("Missing read content")
  const model = content.split("\n")
  const header = model[0]?.match(/^Read file (.*), (lines \d+-\d+|0 lines)$/)
  if (!header) throw new Error("Unrecognized read header")
  const rows = model.slice(1).flatMap((line, index) => {
    const match = line.match(/^(\d+: )(.*)$/)
    if (match) return [{ index: index + 1, number: Number.parseInt(match[1]), prefix: match[1], text: match[2] }]
    if (index === model.length - 2 && /^\[Output truncated\. Continue reading with offset: \d+\]$/.test(line)) return []
    throw new Error("Unrecognized read line")
  })
  const body = output.type === "file" ? output.content.replace(/\n$/, "") : output.content
  if (rows.map((row) => row.text).join("\n") !== body) throw new Error("Read representations disagree")
  if (rows.length && output.type === "text-page" && rows[0].number !== output.offset) throw new Error("Read offset disagrees")
  const safe = projectEnvRows(input.sources, rows, input.mask)
  const text = [...model]
  text[0] = `Read file ${input.mask(header[1] === input.target ? input.requested : header[1])}, ${header[2]}`
  rows.forEach((row, index) => { text[row.index] = row.prefix + safe[index] })
  return {
    output: output.type === "text-page"
      ? { type: output.type, mime: output.mime, offset: output.offset, truncated: output.truncated, ...(output.next === undefined ? {} : { next: output.next }), content: safe.join("\n") }
      : { type: output.type, mime: "text/plain", encoding: "utf8", content: safe.join("\n") + (output.content.endsWith("\n") ? "\n" : "") },
    content: [{ type: "text", text: `${ProtectedFiles.PROTECTED_FILE_TEXT}\n${text.join("\n")}` }],
    metadata: { ...input.result.metadata, truncated: output.type === "text-page" && output.truncated === true },
  }
}

export function projectEnvRows(sources: readonly string[], rows: readonly { number: number; text: string }[], mask: (text: string) => string) {
  if (!rows.length) return []
  const candidates = [...new Set(sources)].flatMap((source) => {
    const records = envAssignments(source)
    const lines = [...source.matchAll(/[^\n]*(?:\n|$)/g)].filter((line) => line[0] !== "")
    const projected: string[] = []
    for (const row of rows) {
      const line = lines[row.number - 1]
      if (!line) return []
      const raw = line[0].replace(/\n$/, "").replace(/\r$/, "")
      const visible = row.text.replace(/\r$/, "")
      const suffix = visible === raw ? "" : visible.match(/\.\.\. \(line truncated to \d+ chars\)$/)?.[0] ?? ""
      const prefix = suffix ? visible.slice(0, -suffix.length) : visible
      if (!raw.startsWith(prefix) || !suffix && prefix !== raw) return []
      const start = line.index!
      const end = start + prefix.length
      const record = records.find((item) => item.start <= end && item.end >= start)
      if (!record) {
        projected.push(raw ? ProtectedFiles.REDACTED : "")
        continue
      }
      const left = Math.max(0, Math.min(prefix.length, record.valueStart - start))
      const right = Math.max(0, Math.min(prefix.length, record.valueEnd - start))
      const value = !envSecret(record) ? prefix.slice(left, right)
        : record.valueStart <= end ? ProtectedFiles.REDACTED : ""
      projected.push(mask(prefix.slice(0, left) + value) + suffix)
    }
    return [projected]
  })
  if (!candidates.length || candidates.some((candidate) => JSON.stringify(candidate) !== JSON.stringify(candidates[0])))
    throw new Error("Read page cannot be attributed to a source snapshot")
  return candidates[0]
}
