import { basename, resolve } from "node:path"
import { scanPackageManagerSource, resolvePackageManagerWord, shellName, shellPs } from "virtual:codepuppy-shell-scan"
import type { ShellPrivateInput } from "@opencode/plugin/codepuppy-package-manager"
import type { PackageManagerSyntax } from "../src/shared/package-manager-syntax"

export type PackageManagerAssignment = { name: string; value: string; origin: "prefix" | "export"; start: number; end: number }
export type PackageManagerCommand = {
  nodeID: string; start: number; end: number; program: string; argv: readonly string[]; cwd: string
  assignments: readonly PackageManagerAssignment[]
  leafStart: number; leafEnd: number; redirects: readonly { start: number; end: number }[]
  prefix: string; exec: boolean; wrapper: string
}
// `env` holds shell values for expansion; only exported names (or all, under allexport) reach brew's environment.
type State = { cwd: string | null; env: Readonly<Record<string, string | null>>; assignments: readonly PackageManagerAssignment[]; exported: ReadonlySet<string>; allexport: boolean }
type Outcome = { success?: State; failure?: State }
type Leaf = Exclude<PackageManagerSyntax, { kind: "separator" }>

/** Facts are obtained by the original scanner. No caller-supplied expansion is accepted. */
export function planPackageManagerExecution(input: {
  manager: "homebrew"; command: string; shell: string; cwd: string; env: Readonly<Record<string, string>>
}): readonly PackageManagerCommand[] {
  // PowerShell-class shells are not rewritten; the original spawn runs.
  if (shellPs(input.shell)) return []
  const dialect = shellDialect(input.shell)
  const facts = scanPackageManagerSource(input.command, dialect)
  if (!facts) return []
  const plans: PackageManagerCommand[] = []
  const word = (raw: string, state: State, kind: "word" | "assignment" = "word") => resolvePackageManagerWord(raw, state.env, dialect, kind)
  const assignment = (raw: { start: number; end: number; raw: string }, state: State, origin: "prefix" | "export") => {
    const value = word(raw.raw, state, "assignment")
    const match = value === undefined ? undefined : /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(value)
    return match ? { name: match[1], value: match[2], origin, start: raw.start, end: raw.end } : undefined
  }
  // The fields one source word becomes; undefined when that cannot be determined.
  const fields = (raw: string, state: State): string[] | undefined => {
    if (/\{[^}]*(,|\.\.)[^}]*\}/.test(raw)) {
      // Brace expansion: only one list of plain literal alternatives, in shells that expand it.
      const list = /^([\w.@/:+%=-]*)\{([\w.@/:+%=-]+(?:,[\w.@/:+%=-]+)+)\}([\w.@/:+%=-]*)$/.exec(raw)
      if (!list || dialect === "posix") return undefined
      return list[2]!.split(",").map((alternative) => list[1] + alternative + list[3])
    }
    const value = word(raw, state)
    if (value === undefined) return undefined
    // An unquoted expansion that is empty produces no field.
    return value === "" && !/["'\\]/.test(raw) ? [] : [value]
  }
  const visit = (leaf: Leaf, state: State): Outcome => {
    if (leaf.kind === "group") {
      const result = sequence(leaf.events, state)
      return leaf.subshell ? { ...(result.success ? { success: state } : {}), ...(result.failure ? { failure: state } : {}) } : result
    }
    if (leaf.opaque) return { success: state, failure: state }
    const prefixes = leaf.words.slice(0, leaf.command < 0 ? leaf.words.length : leaf.command)
    // An assignment-only statement changes shell values; brew sees a name only if it is exported.
    if (leaf.command < 0) return { success: prefixes.reduce((current, raw) => {
      const parsed = assignment(raw, current, "export")
      const name = parsed?.name ?? /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(raw.raw)?.[1]
      if (!name) return current
      if (current.allexport || current.exported.has(name)) return parsed ? exported(current, parsed) : unknown(current, name)
      return { ...current, env: { ...current.env, [name]: parsed ? parsed.value : null } }
    }, state) }
    const node = prefixes.reduce((current, raw) => {
      const parsed = assignment(raw, current, "prefix")
      return parsed ? assigned(current, parsed) : current
    }, state)
    let index = leaf.builtin
    if (word(leaf.words[index]?.raw ?? "", state) === "env") {
      index++
      while (index < leaf.words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(leaf.words[index].raw)) index++
      // env options and other wrappers remain ordinary fenced commands.
      if (leaf.words[index]?.raw.startsWith("-")) return { success: state, failure: state }
    }
    const program = word(leaf.words[index]?.raw ?? "", state)
    const split = leaf.words.slice(index + 1).map((raw) => fields(raw.raw, state))
    const args = split.every((field) => field !== undefined) ? split.flat() as string[] : undefined
    const span = { start: leaf.words[index]?.start ?? 0, end: leaf.words[index]?.end ?? 0 }
    if (program === "export") {
      const next = leaf.words.slice(index + 1).reduce((current, raw) => {
        const parsed = assignment(raw, state, "export")
        if (parsed) return exported(current, parsed)
        const name = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(raw.raw)?.[1]
        if (name) return unknown(current, name)
        // `export NAME` exports the shell's current value, if any.
        const bare = /^[A-Za-z_][A-Za-z0-9_]*$/.exec(raw.raw)?.[0]
        if (!bare) return current
        const value = current.env[bare]
        return typeof value === "string" ? exported(current, { name: bare, value, origin: "export", start: raw.start, end: raw.end }) : { ...current, exported: new Set([...current.exported, bare]) }
      }, state)
      return invert({ success: next }, leaf.negated)
    }
    if (program === "unset") {
      // The name loses its value and export attribute. A snapshot name still reaches brew: assignments can only set values.
      if (leaf.words.slice(index + 1).some((raw) => raw.raw.startsWith("-") && raw.raw !== "-v")) return invert({ success: state }, leaf.negated)
      const next = leaf.words.slice(index + 1).reduce((current, raw) => {
        const name = /^[A-Za-z_][A-Za-z0-9_]*$/.exec(raw.raw)?.[0]
        if (!name) return current
        return { ...current, env: { ...current.env, [name]: "" }, exported: without(current.exported, name), assignments: current.assignments.filter((entry) => entry.name !== name) }
      }, state)
      return invert({ success: next }, leaf.negated)
    }
    if (program === "set") {
      if (!args) return invert({ success: state }, leaf.negated)
      let allexport = state.allexport
      for (let at = 0; at < args.length; at++) {
        const option = args[at]
        if (option === undefined || option === "--" || option === "-" || !/^[-+]/.test(option)) break
        if (option === "-o" || option === "+o") { if (args[at + 1] === "allexport") allexport = option === "-o"; at++; continue }
        if (option.slice(1).includes("a")) allexport = option.startsWith("-")
      }
      return invert({ success: { ...state, allexport } }, leaf.negated)
    }
    if (program === "cd" || program === "pushd") {
      const operands = args?.[0] === "--" ? args.slice(1) : args
      let target: string | null | undefined = operands && operands.length <= 1 ? (operands[0] ?? (program === "cd" ? state.env.HOME : undefined)) : undefined
      if (program === "pushd" && (operands?.length !== 1 || /^[+-]/.test(target ?? ""))) target = undefined
      if (program === "cd" && target === "-") target = state.env.OLDPWD
      // CDPATH may redirect a relative target.
      const cdpath = state.env.CDPATH
      if (typeof target === "string" && !/^(\/|\.\.?(\/|$))/.test(target) && cdpath !== undefined && cdpath !== "") target = undefined
      const next = state.cwd && typeof target === "string" && target !== "" ? resolve(state.cwd, target) : null
      return invert({ success: changedDirectory(state, next, span), failure: state }, leaf.negated)
    }
    // The directory stack is not modelled: after popd the directory is unknown.
    if (program === "popd") return invert({ success: changedDirectory(state, null, span), failure: state }, leaf.negated)
    if (program === "true" || program === ":") return invert({ success: state }, leaf.negated)
    if (program === "false") return invert({ failure: state }, leaf.negated)
    if (program && basename(program) === "brew" && node.cwd && (program.includes("/") || node.env.PATH !== null) && prefixes.every((raw) => assignment(raw, state, "prefix")) && args !== undefined) {
      const envAssignments = leaf.words.slice(leaf.builtin + 1, index).flatMap((raw) => {
        const parsed = assignment(raw, state, "prefix")
        return parsed ? [parsed] : []
      })
      if (index > leaf.builtin && envAssignments.length !== index - leaf.builtin - 1) return { success: state, failure: state }
      const first = Math.min(leaf.words[0].start, ...leaf.redirects.map((redir) => redir.start))
      const last = Math.max(...leaf.words.map((raw) => raw.end), ...leaf.redirects.map((redir) => redir.end))
      plans.push({
        nodeID: `node-${leaf.words[index].start}`, start: leaf.words[index].start, end: leaf.words[index].end,
        program, argv: args, cwd: node.cwd, assignments: [...node.assignments, ...envAssignments],
        leafStart: first, leafEnd: last, redirects: leaf.redirects,
        prefix: [...prefixes.map((raw) => raw.raw), ...leaf.words.slice(leaf.builtin + 1, index).map((raw) => raw.raw)].join(" "),
        exec: leaf.words.slice(leaf.command, leaf.builtin).some((raw) => raw.value === "exec"),
        wrapper: leaf.words.slice(leaf.command, leaf.builtin).filter((raw) => raw.value === "time" || raw.value === "coproc").map((raw) => raw.raw).join(" "),
      })
    }
    return { success: state, failure: state }
  }
  const sequence = (events: readonly PackageManagerSyntax[], initial: State): Outcome => {
    let result: Outcome = { success: initial }
    let operator = ";"
    for (let index = 0; index < events.length; index++) {
      const event = events[index]
      if (event.kind === "separator") { operator = event.value; continue }
      const incoming = operator === "&&" ? result.success : operator === "||" ? result.failure : join(result.success, result.failure)
      if (!incoming) {
        // Unreached static nodes still have one-time credentials; skipped assignments do not affect later nodes.
        const skipped = join(result.success, result.failure)
        if (skipped) visit(event, skipped)
        continue
      }
      const pipeline: Leaf[] = [event]
      while (events[index + 1]?.kind === "separator" && ["|", "|&"].includes((events[index + 1] as { value: string }).value) && events[index + 2] && events[index + 2].kind !== "separator") {
        pipeline.push(events[index + 2] as Leaf)
        index += 2
      }
      const next = pipeline.length === 1 ? visit(event, incoming) : (pipeline.forEach((leaf) => visit(leaf, incoming)), { success: incoming, failure: incoming })
      result = operator === "&&" ? { success: next.success, failure: join(result.failure, next.failure) }
        : operator === "||" ? { success: join(result.success, next.success), failure: next.failure } : next
      operator = ";"
    }
    return result
  }
  const initial: State = { cwd: input.cwd, env: input.env, assignments: [], exported: new Set(Object.keys(input.env)), allexport: false }
  // Every shell exports PWD as its directory at start; zsh also sets OLDPWD to it, bash and sh drop an inherited one.
  const started = exported(initial, { name: "PWD", value: input.cwd, origin: "export", start: 0, end: 0 })
  sequence(facts, dialect === "zsh" ? exported(started, { name: "OLDPWD", value: input.cwd, origin: "export", start: 0, end: 0 })
    : { ...started, env: { ...started.env, OLDPWD: "" }, exported: without(started.exported, "OLDPWD") })
  return plans
}

function assigned(state: State, value: PackageManagerAssignment): State {
  return { ...state, env: { ...state.env, [value.name]: value.value }, assignments: [...state.assignments.filter((entry) => entry.name !== value.name), value] }
}
function exported(state: State, value: PackageManagerAssignment): State {
  return { ...assigned(state, value), exported: new Set([...state.exported, value.name]) }
}
function without(names: ReadonlySet<string>, name: string): ReadonlySet<string> {
  return new Set([...names].filter((entry) => entry !== name))
}
/** cd/pushd: PWD becomes the new directory and OLDPWD the previous PWD, both exported; an unknown move makes all three unknown. */
function changedDirectory(state: State, next: string | null, span: { start: number; end: number }): State {
  if (next === null) return { ...unknown(unknown(state, "PWD"), "OLDPWD"), cwd: null }
  const previous = state.env.PWD
  const moved = { ...state, cwd: next }
  const old = typeof previous === "string" ? exported(moved, { name: "OLDPWD", value: previous, origin: "export", ...span }) : unknown(moved, "OLDPWD")
  return exported(old, { name: "PWD", value: next, origin: "export", ...span })
}
function unknown(state: State, name: string): State {
  return { ...state, env: { ...state.env, [name]: null }, assignments: state.assignments.filter((entry) => entry.name !== name), exported: new Set([...state.exported, name]) }
}
function join(a?: State, b?: State): State | undefined {
  if (!a) return b
  if (!b) return a
  return {
    cwd: a.cwd === b.cwd ? a.cwd : null,
    env: Object.fromEntries([...new Set([...Object.keys(a.env), ...Object.keys(b.env)])].map((key) => [key, a.env[key] === b.env[key] ? a.env[key] : null])),
    assignments: a.assignments.filter((entry) => b.assignments.some((other) => JSON.stringify(entry) === JSON.stringify(other))),
    exported: new Set([...a.exported].filter((name) => b.exported.has(name))),
    allexport: a.allexport && b.allexport,
  }
}
function invert(outcome: Outcome, negated: boolean): Outcome { return negated ? { success: outcome.failure, failure: outcome.success } : outcome }

export function shellDialect(shell: string): "bash" | "zsh" | "posix" {
  const name = shellName(shell)
  return name === "bash" || name === "zsh" ? name : "posix"
}

export function packageManagerExecutionSource(input: {
  command: string; shell: string; nodes: readonly PackageManagerCommand[]; executionID: string; helperService: string; helper: string; privateInput: ShellPrivateInput
}): string {
  // zsh's `command printf` (POSIX_BUILTINS off) runs the external printf, whose argv any same-user process can read.
  const printf = shellDialect(input.shell) === "posix" ? "command printf" : "builtin printf"
  const variable = (node: PackageManagerCommand) => `codepuppy_proof_${input.executionID.replaceAll("-", "")}_${node.start}`
  const options = `codepuppy_options_${input.executionID.replaceAll("-", "")}`
  const prelude = `${options}=$-; { set +x; } 2>/dev/null; set +a; ${input.nodes.map((node) => `unset ${variable(node)}; IFS= read -r ${variable(node)} <&${input.privateInput.fd} || ${variable(node)}=;`).join(" ")} exec ${input.privateInput.fd}<&-; case $${options} in *a*) set -a;; esac; case $${options} in *x*) set -x;; esac;\n`
  const source = [...input.nodes].sort((a, b) => b.leafStart - a.leafStart).reduce((source, node) => {
    const args = [input.helper, "--service", input.helperService, "--execution", input.executionID, "--node", node.nodeID, "--proof-fd", "9", "--", node.program, ...node.argv].map(shellQuote).join(" ")
    const helper = `${node.prefix ? node.prefix + " " : ""}${args}`
    const writer = `{ { set +x; } 2>/dev/null; ${printf} '%s\\n' "$${variable(node)}"; }`
    // Attach the pipe to a shell group before copying it: zsh attaches a command's pipe after its redirects.
    const stdin = `${writer} | { ${helper} 9<&0 0<&8 8<&-; }`
    const closed = `${writer} | { ${helper} 9<&0 0<&- 8<&-; }`
    const leaf = `${node.wrapper ? node.wrapper + " " : ""}{ if { true 8<&0; } 2>/dev/null; then { ${stdin}; } 8<&0; else ${closed}; fi;${node.exec ? ' exit "$?";' : ""} } ${node.redirects.map((redir) => input.command.slice(redir.start, redir.end)).join(" ")}`
    return source.slice(0, node.leafStart) + leaf + source.slice(node.leafEnd)
  }, input.command)
  return prelude + source
}

function shellQuote(value: string) { return `'${value.replaceAll("'", "'\\''")}'` }
