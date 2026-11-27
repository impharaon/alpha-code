// H1 consumes the permission scanner's tokens and grammar, never a second shell parser.
export function packageManagerScanSource(source: string): string {
  const replace = (from: string, to: string) => {
    if (source.split(from).length !== 2) throw new Error(`ShellScan package-manager seam moved: ${from.slice(0, 70)}`)
    source = source.replace(from, to)
  }
  replace('export * as ShellScan from "./scan.js"', "")
  replace("type BashContext = {", `type BashContext = {
  packageManager?: PackageManagerScanContext`)
  replace("type BashState = {", `type BashState = {
  pmWords: PackageManagerWord[]
  pmRedirects: { start: number; end: number }[]
  pmRedirectStart?: number
  pmNegated: boolean`)
  replace("    nestedCommands: [],\n    words: [],", "    nestedCommands: [],\n    pmWords: [], pmRedirects: [], pmNegated: false,\n    words: [],")
  replace('  if (/PS4/.test(state.word))', `  const pm = state.context.packageManager
  if (pm && !pm.suppressed) {
    if (state.redirectTarget && state.pmRedirectStart !== undefined) {
      state.pmRedirects.push({ start: state.pmRedirectStart, end: state.wordEnd })
      state.pmRedirectStart = undefined
    } else if (!state.redirectTarget) {
      const word = { start: state.wordStart, end: state.wordEnd, raw: state.input.slice(state.wordStart, state.wordEnd), value: state.word }
      state.pmWords.push(word)
      pm.decoded?.push(word.value)
    }
  }
  if (/PS4/.test(state.word))`)
  replace("  state.words.length = 0\n", `  if (state.context.packageManager && !state.context.packageManager.suppressed && state.pmWords.length) {
    state.context.packageManager.events.push({ kind: "command", words: [...state.pmWords], redirects: [...state.pmRedirects], builtin: bashBuiltinIndex(state), command: state.commandWordIndex, negated: state.pmNegated, opaque: state.structures.length > 0 })
  }
  state.pmWords.length = 0
  state.pmRedirects.length = 0
  state.pmNegated = false
  state.words.length = 0
`)
  replace("    if (fdPrefix) {", `    if (state.context.packageManager) state.pmRedirectStart = fdPrefix ? state.wordStart : index
    if (fdPrefix) {`)
  replace("      state.heredocs.push(delimiter)", `      state.pmRedirects.push({ start: state.pmRedirectStart ?? index, end: delimiter.end + 1 })
      state.pmRedirectStart = undefined
      state.heredocs.push(delimiter)`)
  replace('  finishBashCommand(state, true, separator === "\\n")', `  finishBashCommand(state, true, separator === "\\n")
  if (context.packageManager && !context.packageManager.suppressed) context.packageManager.events.push({ kind: "separator", value: separator })`)
  replace("if (testAt(NEGATION_AHEAD_RE, input, index + 1)) return index", "if (testAt(NEGATION_AHEAD_RE, input, index + 1)) { state.pmNegated = !state.pmNegated; return index }")
  replace("  if (definitionLength > 0) return index + definitionLength - 1", "  if (definitionLength > 0) { if (context.packageManager) context.packageManager.nextFunction = true; return index + definitionLength - 1 }")
  replace('    const group = scanBash(input, index + 1, depth + 1, context, char === "{" ? "}" : ")", state.heredocs)', `    const pm = context.packageManager
    const definition = pm?.nextFunction ?? false
    if (pm) pm.nextFunction = false
    if (pm) context.packageManager = { ...pm, events: [], suppressed: pm.suppressed + Number(definition), decoded: undefined }
    const group = scanBash(input, index + 1, depth + 1, context, char === "{" ? "}" : ")", state.heredocs)
    const child = context.packageManager
    context.packageManager = pm
    if (pm && !pm.suppressed && !definition) pm.events.push({ kind: "group", events: child!.events, subshell: char === "(", start: index, end: group.kind === "scanned" ? group.end + 1 : index })`)
  replace("  const nested = scanBash(input, start, depth + 1, context, close, undefined, text)", `  if (context.packageManager) context.packageManager.suppressed++
  const nested = scanBash(input, start, depth + 1, context, close, undefined, text)
  if (context.packageManager) context.packageManager.suppressed--`)
  replace('): number | Opaque | undefined {\n  const char = input[index]\n  const next = input[index + 1] ?? "\\0"\n', `): number | Opaque | undefined {
  const char = input[index]
  const next = input[index + 1] ?? "\\0"
  const pm = context.packageManager
  if (pm?.environment && char === "$" && (mode === "word" || mode === "quoted")) {
    const variable = /^\\$(?:([A-Za-z_][A-Za-z0-9_]*)|\\{([A-Za-z_][A-Za-z0-9_]*)\\})/.exec(input.slice(index))
    if (variable) {
      const value = pm.environment[variable[1] ?? variable[2]]
      // A name outside the snapshot and the source is unknown (startup files or the shell itself may set it).
      if (value === null || value === undefined || (mode === "word" && pm.wordKind !== "assignment" && /[\\s*?\\[\\]]/.test(value ?? ""))) pm.unresolved = true
      if (text) bashAppend(text, value ?? "")
      return index + variable[0].length - 1
    }
    if (next !== "'" && next !== '"') pm.unresolved = true
  }
`)
  replace("    bashAppend(state, char)\n    state.wordEnd = index + 1", `    if (context.packageManager?.environment) {
      const pm = context.packageManager
      if (char === "~" && (!state.word || (state.assignmentWord && state.word.endsWith("=")))) {
        if (input[index + 1] && !"/ \\t\\n".includes(input[index + 1])) pm.unresolved = true
        const home = pm.environment.HOME
        if (home === null || home === undefined) pm.unresolved = true
        bashAppend(state, home ?? "~")
        state.wordEnd = index + 1
        continue
      }
      if (pm.wordKind !== "assignment" && "*?[]".includes(char)) pm.unresolved = true
    }
    bashAppend(state, char)
    state.wordEnd = index + 1`)
  return source + API
}

const API = String.raw`

import type { PackageManagerWord, PackageManagerSyntax } from "../src/shared/package-manager-syntax"
type PackageManagerScanContext = {
  events: PackageManagerSyntax[]; suppressed: number; nextFunction?: boolean
  environment?: Readonly<Record<string, string | null>>
  wordKind?: "word" | "assignment"; unresolved?: boolean; decoded?: string[]
}
export function scanPackageManagerSource(input: string, dialect: Dialect): PackageManagerSyntax[] | undefined {
  if (input.length > MAX_INPUT_LENGTH) return
  const pm: PackageManagerScanContext = { events: [], suppressed: 0 }
  const context: BashContext = { remaining: MAX_INPUT_LENGTH * MAX_SUBSTITUTION_DEPTH, dialect, packageManager: pm }
  const result = scanBash(input, 0, 0, context)
  if (result.kind === "opaque") return
  return pm.events
}
export function resolvePackageManagerWord(input: string, environment: Readonly<Record<string, string | null>>, dialect: Dialect, kind: "word" | "assignment"): string | undefined {
  const pm: PackageManagerScanContext = { events: [], suppressed: 0, environment, wordKind: kind, decoded: [] }
  const context: BashContext = { remaining: MAX_INPUT_LENGTH * MAX_SUBSTITUTION_DEPTH, dialect, packageManager: pm }
  // A lone empty word would be an empty command name; an ordinary word is resolved as the argument of a fixed one.
  const position = kind === "word" ? 1 : 0
  const result = scanBash(position ? ": " + input : input, 0, 0, context)
  if (result.kind === "opaque" || pm.unresolved || pm.decoded!.length > position + 1 || pm.events.some((event) => event.kind !== "command")) return
  // No decoded word: the expansion produced nothing (the caller decides whether that is an empty field or none).
  const value = pm.decoded![position] ?? ""
  return value.includes("\0") ? undefined : value
}
`
