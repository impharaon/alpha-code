import { readFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { Result } from "effect"
import { Tool } from "../../schema/src/tool"
import { ProtectedFiles } from "../../schema/src/codepuppy-protected-files"
import { Patch } from "../../util/src/patch"
import { Bom } from "../../util/src/bom"
import { envAssignments } from "./secret-values"
import { resolveProtectedFile } from "./secret-files"

export type EnvMutation =
  | { operation: "write"; path: string; content: string }
  | { operation: "edit"; path: string; oldString: string; newString: string; replaceAll?: boolean }
  | { operation: "patch"; patchText: string }
export type EnvSnapshot = { path: string; file: ProtectedFiles.ProtectedFile; before?: string; after?: string }

/** Restore only current file/key/occurrence data; the caller still invokes the original writer once. */
export async function restoreEnvMutation(input: EnvMutation, roots: ProtectedFiles.ProtectedRoots) {
  const snapshots: EnvSnapshot[] = []
  const load = async (name: string, required: boolean) => {
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await readFile(name)) }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined
      if (required) throw new Tool.Error({ message: `Unable to read env file: ${name}` })
    }
  }
  const target = (name: string) => path.resolve(roots.directory, name)
  if (input.operation !== "patch") {
    const file = await resolveProtectedFile(target(input.path), roots)
    if (file?.format !== "env") return { mutation: input, snapshots }
    const before = await load(target(input.path), JSON.stringify(input).includes(ProtectedFiles.REDACTED))
    const records = envAssignments(before ?? "")
    if (input.operation === "write") {
      const content = restoreFields(input.content, records)
      snapshots.push({ path: target(input.path), file, before, after: content })
      return { mutation: { ...input, content }, snapshots }
    }
    if (before === undefined || !input.oldString || input.oldString === input.newString) {
      snapshots.push({ path: target(input.path), file, before })
      return { mutation: input, snapshots }
    }
    const source = Bom.split(before.replaceAll("\r\n", "\n")).text
    const names = new Set(envAssignments(input.oldString).filter((item) => item.value === ProtectedFiles.REDACTED).map((item) => item.name))
    const layout = input.oldString.split(/\r?\n/).includes(ProtectedFiles.REDACTED) ? "line-slots" : "assignments"
    const masked = maskTemplate(source, names, layout)
    const query = maskTemplate(input.oldString.replaceAll("\r\n", "\n"), names, layout).text
    const matches = [...masked.text.matchAll(new RegExp(escape(query), "g"))].map((match) => ({ start: masked.position(match.index!), end: masked.position(match.index! + match[0].length) }))
    if (!matches.length) {
      // A unique assignment sequence supplies values; Core retains its own whitespace/unicode matching tiers.
      const wanted = envAssignments(input.oldString)
      const all = envAssignments(source)
      const candidates = all.flatMap((item, index) => wanted.length && wanted.every((row, offset) => all[index + offset]?.name === row.name && (row.value === ProtectedFiles.REDACTED || all[index + offset]?.value === row.value)) ? [item] : [])
      if (candidates.length === 1) {
        const base = counts(all.filter((item) => item.valueEnd <= candidates[0].start))
        const oldString = restoreFields(input.oldString, records, base)
        const newString = restoreFields(input.newString, records, base)
        snapshots.push({ path: target(input.path), file, before })
        return { mutation: { ...input, oldString, newString }, snapshots }
      }
      if (names.size || envAssignments(input.newString).some((item) => item.value === ProtectedFiles.REDACTED)) throw new Tool.Error({ message: `Could not find oldString in ${input.path}. It must identify the env assignments.` })
      snapshots.push({ path: target(input.path), file, before })
      return { mutation: input, snapshots }
    }
    if (matches.length > 1 && input.replaceAll !== true) throw new Tool.Error({ message: `Found ${matches.length} matches for oldString, but expected exactly one. Add more surrounding context to make oldString unique, or set replaceAll to true to replace every occurrence.` })
    const replacements = matches.map((match) => ({ ...match, text: restoreFields(input.newString, records, counts(envAssignments(source).filter((item) => item.valueEnd <= match.start))) }))
    const after = replacements.toReversed().reduce((text, item) => text.slice(0, item.start) + item.text.replaceAll("\r\n", "\n") + text.slice(item.end), source)
    snapshots.push({ path: target(input.path), file, before, after: Bom.join(after, Bom.has(Buffer.from(before))) })
    if (matches.length === 1) {
      const base = counts(envAssignments(source).filter((item) => item.valueEnd <= matches[0].start))
      return { mutation: { ...input, oldString: restoreFields(input.oldString, records, base), newString: replacements[0].text }, snapshots }
    }
    const first = replacements[0].start, last = replacements.at(-1)!.end
    const newString = replacements.toReversed().reduce((text, item) => text.slice(0, item.start - first) + item.text.replaceAll("\r\n", "\n") + text.slice(item.end - first), source.slice(first, last))
    return { mutation: { ...input, oldString: source.slice(first, last), newString }, snapshots, replacements: matches.length }
  }
  const parsed = Patch.parse(input.patchText)
  if (Result.isFailure(parsed)) return { mutation: input, snapshots }
  const hunks: Patch.Hunk[] = []
  for (const hunk of parsed.success) {
    const destination = hunk.type === "update" ? hunk.movePath ?? hunk.path : hunk.path
    const sourceFile = await resolveProtectedFile(target(hunk.path), roots)
    const destinationFile = await resolveProtectedFile(target(destination), roots)
    const file = destinationFile?.format === "env" ? destinationFile : sourceFile?.format === "env" ? sourceFile : undefined
    if (!file) { hunks.push(hunk); continue }
    const before = await load(target(hunk.path), input.patchText.includes(ProtectedFiles.REDACTED))
    if (before === undefined) { hunks.push(hunk); snapshots.push({ path: target(destination), file, ...(hunk.type === "add" ? { after: hunk.contents } : {}) }); continue }
    if (hunk.type === "delete") { hunks.push(hunk); snapshots.push({ path: target(hunk.path), file, before, after: "" }); continue }
    const existing = destination === hunk.path ? before : await load(target(destination), input.patchText.includes(ProtectedFiles.REDACTED))
    const records = envAssignments(existing ?? before)
    if (hunk.type === "add") {
      const contents = restoreFields(hunk.contents, records)
      hunks.push({ ...hunk, contents }); snapshots.push({ path: target(destination), file, before, after: contents }); continue
    }
    const source = Bom.split(before.replaceAll("\r\n", "\n")).text
    const names = new Set(hunk.chunks.flatMap((chunk) => envAssignments([...chunk.oldLines, ...chunk.newLines, chunk.changeContext ?? ""].join("\n")).filter((item) => item.value === ProtectedFiles.REDACTED).map((item) => item.name)))
    const layout = hunk.chunks.some((chunk) => [...chunk.oldLines, ...chunk.newLines].includes(ProtectedFiles.REDACTED)) ? "line-slots" : "assignments"
    const view = maskTemplate(source, names, layout)
    try {
      const next = Patch.derive(hunk.path, hunk.chunks, view.text).content
      const chunks = hunk.chunks.map((chunk, index) => {
        const marker = randomUUID()
        // Previous no-op chunks preserve line counts while the real parser/locator resolves this chunk.
        const oldPosition = Patch.derive(hunk.path, hunk.chunks.map((entry, i) => ({ ...entry, newLines: i === index ? [marker] : entry.oldLines })), view.text).content.split("\n").indexOf(marker)
        const newPosition = Patch.derive(hunk.path, hunk.chunks.map((entry, i) => i === index ? { ...entry, newLines: [marker] } : entry), view.text).content.split("\n").indexOf(marker)
        const oldOffset = view.position(lineOffset(view.text, oldPosition))
        const oldBase = counts(envAssignments(source).filter((item) => item.valueEnd <= oldOffset))
        const newBase = counts(envAssignments(next).filter((item) => item.valueEnd <= lineOffset(next, newPosition)))
        const contextPosition = chunk.changeContext === undefined ? undefined : Patch.derive(hunk.path, hunk.chunks.slice(0, index + 1).map((entry, i) => i === index ? { oldLines: [chunk.changeContext!], newLines: [marker] } : { ...entry, newLines: entry.oldLines }), view.text).content.split("\n").indexOf(marker)
        const contextBase = contextPosition === undefined ? oldBase : counts(envAssignments(source).filter((item) => item.valueEnd <= view.position(lineOffset(view.text, contextPosition))))
        const context = chunk.changeContext === undefined ? undefined : restoreFields(chunk.changeContext, envAssignments(before), contextBase).split(/\r?\n/)[0]
        return { ...chunk, changeContext: context, oldLines: chunk.oldLines.length ? restoreFields(chunk.oldLines.join("\n"), envAssignments(before), oldBase).split("\n") : [], newLines: chunk.newLines.length ? restoreFields(chunk.newLines.join("\n"), records, newBase).split("\n") : [] }
      })
      const restored = { ...hunk, chunks }
      const serialized = serialize([restored])
      const actual = Patch.parse(serialized)
      if (Result.isFailure(actual) || actual.success[0].type !== "update") throw new Error("Invalid restored patch")
      const after = Patch.derive(hunk.path, actual.success[0].chunks, before)
      hunks.push(restored); snapshots.push({ path: target(destination), file, before, after: Patch.joinBom(after.content, after.bom) })
      if (hunk.movePath) snapshots.push({ path: target(hunk.path), file, before, after: "" })
    } catch {
      throw new Tool.Error({ message: `Unable to restore env patch: ${hunk.path}` })
    }
  }
  return { mutation: snapshots.length ? { ...input, patchText: serialize(hunks) } : input, snapshots }
}

function counts(records: ReturnType<typeof envAssignments>) {
  return new Map(records.map((item) => [item.name, item.occurrence]))
}
function restoreFields(text: string, current: ReturnType<typeof envAssignments>, base = new Map<string, number>()) {
  return envAssignments(text).toReversed().reduce((result, item) => {
    if (item.value !== ProtectedFiles.REDACTED) return result
    const prior = current.find((entry) => entry.name === item.name && entry.occurrence === (base.get(item.name) ?? 0) + item.occurrence)
    if (!prior) return result
    let end = item.valueEnd
    for (let line = 0; line < prior.rhs.split(/\r?\n/).length - 1; line++) {
      const continuation = result.slice(end).match(/^\r?\n\[REDACTED\](?=\r?\n|$)/)
      if (!continuation) break
      end += continuation[0].length
    }
    return result.slice(0, item.valueStart) + prior.rhs + result.slice(end)
  }, text)
}
function maskTemplate(text: string, names: ReadonlySet<string>, layout: "line-slots" | "assignments") {
  const records = envAssignments(text).filter((item) => names.has(item.name)).map((item) => ({
    ...item, replacement: (layout === "line-slots" ? item.rhs.split(/\r?\n/) : [item.rhs]).map(() => ProtectedFiles.REDACTED).join("\n"),
  }))
  const spans = records.map((item, index) => {
    const delta = records.slice(0, index).reduce((sum, entry) => sum + entry.replacement.length - entry.valueEnd + entry.valueStart, 0)
    return { ...item, from: item.valueStart + delta, to: item.valueStart + delta + item.replacement.length }
  })
  return {
    text: records.toReversed().reduce((result, item) => result.slice(0, item.valueStart) + item.replacement + result.slice(item.valueEnd), text),
    position: (position: number) => {
      let delta = 0
      for (const span of spans) {
        if (position < span.from) return position - delta
        if (position === span.from) return span.valueStart
        if (position === span.to) return span.valueEnd
        if (position < span.to) throw new Error("Partial env placeholder")
        delta += ProtectedFiles.REDACTED.length - span.valueEnd + span.valueStart
      }
      return position - delta
    },
  }
}
function lineOffset(text: string, index: number) {
  if (index < 0) throw new Error("Unresolved env patch position")
  return text.split("\n").slice(0, index).reduce((offset, line) => offset + line.length + 1, 0)
}
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
function serialize(hunks: readonly Patch.Hunk[]) {
  return ["*** Begin Patch", ...hunks.flatMap((hunk) => {
    if (hunk.type === "delete") return [`*** Delete File: ${hunk.path}`]
    if (hunk.type === "add") return [`*** Add File: ${hunk.path}`, ...hunk.contents.replace(/\n$/, "").split("\n").map((line) => `+${line}`)]
    return [`*** Update File: ${hunk.path}`, ...(hunk.movePath ? [`*** Move to: ${hunk.movePath}`] : []), ...hunk.chunks.flatMap((chunk) => [`@@${chunk.changeContext ? ` ${chunk.changeContext}` : ""}`, ...chunk.oldLines.map((line) => `-${line}`), ...chunk.newLines.map((line) => `+${line}`), ...(chunk.endOfFile ? ["*** End of File"] : [])])]
  }), "*** End Patch"].join("\n")
}
