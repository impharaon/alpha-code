import { ProtectedFiles } from "../../schema/src/codepuppy-protected-files"
import { projectEnvRows } from "./secret-read"

/** Project the real fileDiff formatter's line slots, without parsing or reapplying a write patch. */
export function projectEnvDiff(patch: string, sources: readonly string[], mask: (text: string) => string) {
  const lines = patch.split("\n")
  const oldRows: { index: number; number: number; text: string }[] = []
  const newRows: { index: number; number: number; text: string }[] = []
  let old = 0, next = 0, active = false
  lines.forEach((line, index) => {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) { old = Number(hunk[1]); next = Number(hunk[2]); active = true; return }
    if (!active || line.startsWith("\\ No newline") || index === lines.length - 1 && line === "") return
    if (line[0] === " " || line[0] === "-") oldRows.push({ index, number: old++, text: line.slice(1) })
    if (line[0] === " " || line[0] === "+") newRows.push({ index, number: next++, text: line.slice(1) })
    if (![" ", "-", "+"].includes(line[0])) throw new Error("Unrecognized file diff line")
  })
  const before = projectEnvRows(sources, oldRows, mask)
  const after = projectEnvRows(sources, newRows, mask)
  const result = [...lines]
  oldRows.forEach((row, index) => { result[row.index] = lines[row.index][0] + before[index] })
  newRows.forEach((row, index) => {
    const prior = oldRows.findIndex((old) => old.index === row.index)
    result[row.index] = lines[row.index][0] + (prior !== -1 && before[prior] !== after[index] ? ProtectedFiles.REDACTED : after[index])
  })
  return result.join("\n")
}
