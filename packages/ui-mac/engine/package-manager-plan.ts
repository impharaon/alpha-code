import { basename, resolve } from "node:path"
import { scanPackageManagerSource, resolvePackageManagerWord, shellName } from "virtual:codepuppy-shell-scan"
import type { ShellPrivateInput } from "@opencode/plugin/codepuppy-package-manager"
import type { PackageManagerSyntax } from "../src/shared/package-manager-syntax"

export type PackageManagerAssignment = { name: string; value: string; origin: "prefix" | "export"; start: number; end: number }
export type PackageManagerCommand = {
  nodeID: string; start: number; end: number; program: string; argv: readonly string[]; cwd: string
  assignments: readonly PackageManagerAssignment[]
  leafStart: number; leafEnd: number; redirects: readonly { start: number; end: number }[]
  prefix: string; exec: boolean; wrapper: string
}
type State = { cwd: string | null; env: Readonly<Record<string, string | null>>; assignments: readonly PackageManagerAssignment[] }
type Outcome = { success?: State; failure?: State }
type Leaf = Exclude<PackageManagerSyntax, { kind: "separator" }>

/** Facts are obtained by the original scanner. No caller-supplied expansion is accepted. */
export function planPackageManagerExecution(input: {
  manager: "homebrew"; command: string; shell: string; cwd: string; env: Readonly<Record<string, string>>
}): readonly PackageManagerCommand[] {
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
  const visit = (leaf: Leaf, state: State): Outcome => {
    if (leaf.kind === "group") {
      const result = sequence(leaf.events, state)
      return leaf.subshell ? { ...(result.success ? { success: state } : {}), ...(result.failure ? { failure: state } : {}) } : result
    }
    if (leaf.opaque) return { success: state, failure: state }
    const prefixes = leaf.words.slice(0, leaf.command < 0 ? leaf.words.length : leaf.command)
    const node = prefixes.reduce((current, raw) => {
      const parsed = assignment(raw, current, "prefix")
      return parsed ? assigned(current, parsed) : current
    }, state)
    if (leaf.command < 0) return { success: node }
    let index = leaf.builtin
    if (word(leaf.words[index]?.raw ?? "", state) === "env") {
      index++
      while (index < leaf.words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(leaf.words[index].raw)) index++
      // env options and other wrappers remain ordinary fenced commands.
      if (leaf.words[index]?.raw.startsWith("-")) return { success: state, failure: state }
    }
    const program = word(leaf.words[index]?.raw ?? "", state)
    const args = leaf.words.slice(index + 1).map((raw) => word(raw.raw, state))
    if (program === "export") {
      const next = leaf.words.slice(index + 1).reduce((current, raw) => {
        const parsed = assignment(raw, state, "export")
        if (parsed) return assigned(current, parsed)
        const name = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(raw.raw)?.[1]
        return name ? { ...current, env: { ...current.env, [name]: null }, assignments: current.assignments.filter((entry) => entry.name !== name) } : current
      }, state)
      return invert({ success: next }, leaf.negated)
    }
    if (program === "cd") {
      const target = args[0] === "--" ? args[1] : args[0] ?? state.env.HOME
      const next = state.cwd && target !== undefined && target !== null && (args.length <= 1 || args[0] === "--") ? resolve(state.cwd, target) : null
      return invert({ success: { ...state, cwd: next }, failure: state }, leaf.negated)
    }
    if (program === "true" || program === ":") return invert({ success: state }, leaf.negated)
    if (program === "false") return invert({ failure: state }, leaf.negated)
    if (program && basename(program) === "brew" && node.cwd && (program.includes("/") || node.env.PATH !== null) && prefixes.every((raw) => assignment(raw, state, "prefix")) && args.every((arg) => arg !== undefined)) {
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
  sequence(facts, { cwd: input.cwd, env: input.env, assignments: [] })
  return plans
}

function assigned(state: State, value: PackageManagerAssignment): State {
  return { ...state, env: { ...state.env, [value.name]: value.value }, assignments: [...state.assignments.filter((entry) => entry.name !== value.name), value] }
}
function join(a?: State, b?: State): State | undefined {
  if (!a) return b
  if (!b) return a
  return {
    cwd: a.cwd === b.cwd ? a.cwd : null,
    env: Object.fromEntries([...new Set([...Object.keys(a.env), ...Object.keys(b.env)])].map((key) => [key, a.env[key] === b.env[key] ? a.env[key] : null])),
    assignments: a.assignments.filter((entry) => b.assignments.some((other) => JSON.stringify(entry) === JSON.stringify(other))),
  }
}
function invert(outcome: Outcome, negated: boolean): Outcome { return negated ? { success: outcome.failure, failure: outcome.success } : outcome }

export function shellDialect(shell: string): "bash" | "zsh" | "posix" {
  const name = shellName(shell)
  return name === "bash" || name === "zsh" ? name : "posix"
}

export function packageManagerExecutionSource(input: {
  command: string; nodes: readonly PackageManagerCommand[]; executionID: string; helperService: string; helper: string; privateInput: ShellPrivateInput
}): string {
  const variable = (node: PackageManagerCommand) => `codepuppy_proof_${input.executionID.replaceAll("-", "")}_${node.start}`
  const options = `codepuppy_options_${input.executionID.replaceAll("-", "")}`
  const prelude = `${options}=$-; { set +x; } 2>/dev/null; set +a; ${input.nodes.map((node) => `unset ${variable(node)}; IFS= read -r ${variable(node)} <&${input.privateInput.fd} || ${variable(node)}=;`).join(" ")} exec ${input.privateInput.fd}<&-; case $${options} in *a*) set -a;; esac; case $${options} in *x*) set -x;; esac;\n`
  const source = [...input.nodes].sort((a, b) => b.leafStart - a.leafStart).reduce((source, node) => {
    const args = [input.helper, "--service", input.helperService, "--execution", input.executionID, "--node", node.nodeID, "--proof-fd", "9", "--", node.program, ...node.argv].map(shellQuote).join(" ")
    const helper = `${node.prefix ? node.prefix + " " : ""}${args}`
    const writer = `{ { set +x; } 2>/dev/null; command printf '%s\\n' "$${variable(node)}"; }`
    // Attach the pipe to a shell group before copying it: zsh attaches a command's pipe after its redirects.
    const stdin = `${writer} | { ${helper} 9<&0 0<&8 8<&-; }`
    const closed = `${writer} | { ${helper} 9<&0 0<&- 8<&-; }`
    const leaf = `${node.wrapper ? node.wrapper + " " : ""}{ if true 2>/dev/null 8<&0; then { ${stdin}; } 8<&0; else ${closed}; fi;${node.exec ? ' exit "$?";' : ""} } ${node.redirects.map((redir) => input.command.slice(redir.start, redir.end)).join(" ")}`
    return source.slice(0, node.leafStart) + leaf + source.slice(node.leafEnd)
  }, input.command)
  return prelude + source
}

function shellQuote(value: string) { return `'${value.replaceAll("'", "'\\''")}'` }
