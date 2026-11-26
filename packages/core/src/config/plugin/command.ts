export * as ConfigCommandPlugin from "./command.js"

import { define } from "@opencode/plugin/effect/plugin"
import { registerPackageInstructionRenderer, type PreparedInstruction } from "@opencode/plugin/codepuppy-package-runtime"
import type { Entry } from "@opencode/schema/config"
import { ConfigCommand } from "@opencode/schema/config/command"
import { AppProcess } from "@opencode/util/process"
import path from "path"
import { randomUUID } from "node:crypto"
import { Effect, FiberSet, Option, Schema } from "effect"
import { ChildProcess } from "effect/process"
import { Agent } from "../../agent.js"
import { Config } from "../../config.js"
import { Location } from "../../location.js"
import { Session } from "../../session.js"
import { SubagentJob } from "../../session/subagent-job.js"
import { SubagentTool } from "../../tool/plugin/subagent.js" // codepuppy(#1129)
import { ShellSelect } from "../../shell/select.js"
import { FSUtil } from "@opencode/util/fs-util"
import { CodePuppyProjectGate } from "../codepuppy-project-gate.js" // codepuppy(ADR-049)
import { ConfigMarkdown } from "../markdown.js"
import { ConfigEntryObserver } from "./entry-observer.js"

const decodeCommand = Schema.decodeUnknownOption(ConfigCommand.Info)

export const Plugin = define({
  id: "opencode.config.command",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service
    // codepuppy(ADR-049) ── 保留项目命令正文,文件头控制字段暂缓,执行时沿用本代来源标记。
    const loadEntry = Effect.fnUntraced(function* (entry: Entry) {
      const gated = CodePuppyProjectGate.projectEntry(entry)
      if (entry.type === "document") return [{ commands: entry.info.commands, gated, file: entry.path }]
      if (entry.type !== "directory") return []
      const commands = yield* loadDirectory(fs, entry.path, CodePuppyProjectGate.markdown(ctx.location.directory, entry, "command"))
      return commands.map((command) => ({ commands: { [command.name]: command.info }, gated, file: command.filepath }))
    })
    // codepuppy ── end
    const location = yield* Location.Service
    const processes = yield* AppProcess.Service
    const shell = yield* ShellSelect.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const subagents = yield* SubagentJob.Service
    // S-01: the Location owns the only renderer and its process service, including package invocations.
    const runInstruction = yield* FiberSet.makeRuntimePromise()
    yield* Effect.acquireRelease(
      Effect.sync(() => registerPackageInstructionRenderer(location, input =>
        runInstruction(evaluateTemplate(input, { location, processes, shell })), input =>
        runInstruction(Effect.gen(function* () {
          const executable = yield* shell.resolve({ priority: "config" })
          const bound = bindTemplateNode({ kind: "shell", parts: input.parts.map(part => typeof part === "string" ? { source: part } : part) }, "literal", () => undefined)
          return { executable, argv: ShellSelect.args(executable, bound.text), env: bound.env }
        })))),
      registration => Effect.sync(() => registration.dispose()),
    )
    const load = Effect.fn("ConfigCommandPlugin.load")(function* () {
      return yield* CodePuppyProjectGate.observe(ctx.location.directory, "command", // codepuppy(ADR-049)
        Effect.forEach(yield* config.entries(), loadEntry).pipe(Effect.map((documents) => documents.flat())), // codepuppy(ADR-049)
      ) // codepuppy(ADR-049)
    })
    const loaded = yield* ConfigEntryObserver.observeSources({
      config,
      event: ctx.event,
      directories: sourceDirectories,
      load,
      reload: ctx.command.reload(),
    })
    yield* ctx.command.transform((editor) => {
      for (const document of loaded.documents) {
        for (const [name, command] of Object.entries(document.commands ?? {})) {
          const gated = CodePuppyProjectGate.interpolation(ctx.location.directory, name, document.gated, document.file, instructionNodes({ parts: [command.template], syntax: "opencode" }).some(node => node.kind === "shell")) // codepuppy(ADR-049)
          const subagent = command.subagent ?? command.subtask
          editor.add({
            name,
            description: command.description,
            execute: (input) =>
              Effect.gen(function* () {
                const agent = command.agent === undefined ? undefined : Agent.ID.make(command.agent)
                const commandAgent = agent === undefined ? undefined : (yield* ctx.agent.get({ agentID: agent })).data
                const model =
                  command.model === undefined
                    ? commandAgent?.model
                    : {
                        id: command.model.model,
                        providerID: command.model.providerID,
                        ...(command.model.variant === undefined ? {} : { variant: command.model.variant }),
                      }
                const text = yield* evaluateTemplate({ parts: [command.template], syntax: "opencode", rawArguments: input.prompt.text, arguments: [], cwd: location.directory }, {
                  location,
                  processes,
                  shell,
                }, gated) // codepuppy(ADR-049)
                if (subagent ?? commandAgent?.mode === "subagent") {
                  const parent = yield* sessions.get(input.sessionID)
                  const selected = yield* agents.select(agent ?? parent.agent)
                  // codepuppy(#1129 E6) ── a subtask command is a delegation without a tool call, so it takes the subagent
                  // tool's own permission path (tool/plugin/subagent.ts) before any child session exists: the extension's
                  // policy decides it like the tool's call (deny, or ask with its identity envelope), no second policy here.
                  yield* ctx.permission.assert({
                    sessionID: parent.id,
                    agent: parent.agent,
                    action: SubagentTool.name,
                    resources: [selected.id],
                    save: [selected.id],
                    metadata: {},
                  })
                  // codepuppy ── end
                  const child = yield* sessions.create({
                    parentID: parent.id,
                    title: command.description ?? name,
                    agent: selected.id,
                    // codepuppy(#1560): the model the user picked for the parent session out-ranks the command's and its agent's.
                    model: parent.model ?? model ?? selected.info?.model,
                  })
                  yield* sessions.prompt({
                    ...input.prompt,
                    sessionID: child.id,
                    text: ["You are a subagent spawned by another session.", text].join("\n"),
                    resume: false,
                  })
                  const recovery = {
                    kind: "subagent" as const,
                    parentSessionID: parent.id,
                    childSessionID: child.id,
                    agent: selected.id,
                    description: command.description ?? name,
                  }
                  yield* subagents.start(recovery)
                  yield* subagents.background(recovery)
                  return
                }
                // codepuppy(#1560) ── a model the user picked for this session (its `model`) out-ranks the command's and its
                // agent's: the command switches the model only in a session that has none.
                if (agent !== undefined || model !== undefined) {
                  const session = yield* ctx.session.get({ sessionID: input.sessionID })
                  if (agent !== undefined && session.agent !== agent) {
                    // codepuppy(#1573 E4) — running as another agent is a delegation: it takes the subagent tool's
                    // permission path, decided by the session's own agent (the user's tier), before the switch.
                    yield* ctx.permission.assert({
                      sessionID: session.id,
                      agent: session.agent,
                      action: SubagentTool.name,
                      resources: [agent],
                      save: [agent],
                      metadata: {},
                    })
                    yield* ctx.session.switchAgent({ sessionID: input.sessionID, agent })
                  }
                  if (model !== undefined && session.model === undefined)
                    yield* ctx.session.switchModel({ sessionID: input.sessionID, model })
                }
                // codepuppy ── end
                yield* ctx.session.prompt({
                  ...input.prompt,
                  sessionID: input.sessionID,
                  text,
                  delivery: input.delivery,
                })
              }).pipe(Effect.asVoid),
          })
        }
      }
    })
  }),
})

// Keep in sync with the loadDirectory scan pattern and the name-strip regex in decode.
const sourceDirectories = ["command", "commands"] as const

// codepuppy(ADR-049) ── 每份项目 md 先过同一闸门,再交上游解码器。
function loadDirectory(fs: FSUtil.Interface, directory: string, frontmatter: (filepath: string, content: string) => string | undefined) {
  return Effect.gen(function* () {
    const files = yield* fs
      .scan("{command,commands}/**/*.md", { cwd: directory, absolute: true, dot: true, symlink: true })
      .pipe(Effect.orElseSucceed(() => [] as string[]))
    return yield* Effect.forEach(files.toSorted(), (filepath) =>
      fs.readFileStringSafe(filepath).pipe(
        Effect.map((content) => (content === undefined ? undefined : decode(directory, filepath, frontmatter(filepath, content)))),
        Effect.orElseSucceed(() => undefined),
      ),
    ).pipe(
      Effect.map((commands) =>
        commands.filter((command): command is { name: string; info: ConfigCommand.Info; filepath: string } => command !== undefined),
      ),
    )
  })
}

function decode(directory: string, filepath: string, content: string | undefined) {
  if (content === undefined) return
  const markdown = ConfigMarkdown.parseOption(content)
  if (!markdown) return
  const info = Option.getOrUndefined(decodeCommand({ ...markdown.data, template: markdown.content.trim() }))
  if (!info) return
  return {
    name: path
      .relative(directory, filepath)
      .replaceAll("\\", "/")
      .replace(/^(command|commands)\//, "")
      .replace(/\.md$/, ""),
    info,
    filepath,
  }
}
// codepuppy ── end

type InstructionNode = { source: string } | { boundValue: string }
type TemplateNode = { kind: "text" | "shell"; parts: InstructionNode[]; delimiter?: "`" | "```" }

// Compile source boundaries before inserting values. A bound value can occur inside a static shell node.
function instructionNodes(input: Pick<PreparedInstruction, "parts" | "syntax">): TemplateNode[] {
  const characters = input.parts.flatMap<string | { boundValue: string }>(part => typeof part === "string" ? [...part] : [part])
  const nodes: TemplateNode[] = [{ kind: "text", parts: [] }]
  const matches = (index: number, text: string) => [...text].every((character, offset) => characters[index + offset] === character)
  const fence = (index: number) => (index === 0 || characters[index - 1] === "\n") && matches(index, "```")
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]!
    const node = nodes.at(-1)!
    if (input.syntax !== "literal" && node.kind === "text") {
      const delimiter = fence(index) && matches(index, "```!") ? "```" : matches(index, "!`") ? "`" : undefined
      const start = index + (delimiter === "```" ? 4 : 2)
      if (delimiter && characters.some((_, closing) => closing >= start && (delimiter === "```" ? fence(closing) : matches(closing, "`")))) {
        nodes.push({ kind: "shell", parts: [], delimiter })
        index = start - 1
        continue
      }
    }
    if (node.kind === "shell" && (node.delimiter === "```" ? fence(index) : matches(index, "`"))) {
      index += node.delimiter!.length - 1
      nodes.push({ kind: "text", parts: [] })
      continue
    }
    const previous = node.parts.at(-1)
    if (typeof character === "string" && previous && "source" in previous) previous.source += character
    else node.parts.push(typeof character === "string" ? { source: character } : character)
  }
  return nodes
}

function evaluateTemplate(
  input: PreparedInstruction,
  services: {
    readonly location: Location.Info
    readonly processes: AppProcess.Interface
    readonly shell: ShellSelect.Interface
  },
  gated = false,
) {
  return Effect.gen(function* () {
    const nodes = instructionNodes(input)
    const args = parseArguments(input.rawArguments, input.syntax)
    const last = Math.max(0, ...nodes.flatMap(node => node.parts.flatMap(part => "source" in part ? [...part.source.matchAll(/\$([1-9]\d*)/g)].map(match => Number(match[1])) : [])))
    let hasArguments = false
    const parameter = (token: string, kind: TemplateNode["kind"]): string | string[] | undefined => {
      if (input.syntax === "literal") return
      if (token === "$ARGUMENTS") { hasArguments = true; return kind === "shell" ? args : input.rawArguments }
      const index = token.match(input.syntax === "claude" ? /^\$(?:ARGUMENTS\[(\d+)\]|(\d+))$/ : /^\$([1-9]\d*)$/)
      if (index) {
        hasArguments = true
        const position = Number(index[1] ?? index[2])
        const offset = position - (input.syntax === "claude" ? 0 : 1)
        if (offset >= args.length) return input.syntax === "opencode" ? "" : token
        return input.syntax === "opencode" && position === last ? kind === "shell" ? args.slice(offset) : args.slice(offset).join(" ") : args[offset]!
      }
      if (input.syntax !== "claude") return
      const named = input.arguments.indexOf(token.slice(1))
      if (named < 0) return
      hasArguments = true
      return args[named] ?? ""
    }
    const rendered = nodes.map(node => ({ kind: node.kind, delimiter: node.delimiter, ...bindTemplateNode(gated ? { ...node, kind: "text" } : node, input.syntax, parameter) }))
    const shell = rendered.some(node => node.kind === "shell") && !gated ? yield* services.shell.resolve({ priority: "config" }) : undefined
    const outputs = yield* Effect.forEach(rendered, node => {
      if (node.kind !== "shell") return Effect.succeed(node.text)
      if (!shell) return Effect.succeed(node.delimiter === "```" ? "```!" + node.text + "```" : "!`" + node.text + "`")
      return services.processes.run(ChildProcess.make(shell, ShellSelect.args(shell, node.text), { cwd: input.cwd, stdin: "ignore", env: { ...input.environment, ...node.env } }), { combineOutput: true }).pipe(
        Effect.map(result => (result.output ?? Buffer.concat([result.stdout, result.stderr])).toString("utf8")),
        Effect.mapError(error => new Error("Shell interpolation failed: " + error.message)),
      )
    }, { concurrency: 2 })
    const text = outputs.join("").trim()
    if (hasArguments || !input.rawArguments.trim()) return text
    return text + "\n\n" + (input.syntax === "opencode" ? input.rawArguments : "ARGUMENTS: " + input.rawArguments)
  })
}

function bindTemplateNode(node: TemplateNode, syntax: PreparedInstruction["syntax"], parameter: (token: string, kind: TemplateNode["kind"]) => string | string[] | undefined) {
  const env: Record<string, string> = {}
  const prefix = "CODEPUPPY_PACKAGE_" + randomUUID().replaceAll("-", "") + "_"
  const quotes = [""]
  const pending: { delimiter: string; tabs: boolean }[] = []
  let heredoc: { delimiter: string; tabs: boolean } | undefined
  let line = ""
  let escaped = false
  const source = (text: string) => {
    if (node.kind !== "shell") return text
    for (let index = 0; index < text.length; index++) {
      const character = text[index]!
      if (heredoc) {
        if (character !== "\n") { line += character; continue }
        if ((heredoc.tabs ? line.replace(/^\t+/, "") : line) === heredoc.delimiter) heredoc = pending.shift()
        line = ""
        continue
      }
      const quote = quotes.at(-1)!
      if (escaped) { escaped = false; continue }
      if (character === "\\" && quote !== "'") { escaped = true; continue }
      if (quote !== "'" && text.slice(index, index + 2) === "$(") { quotes.push(""); index++; continue }
      if (quote) { if (character === quote) quotes[quotes.length - 1] = ""; continue }
      if (character === "'") { quotes[quotes.length - 1] = character; continue }
      if (character === '"') { quotes[quotes.length - 1] = character; continue }
      if (character === "(") { quotes.push(""); continue }
      if (character === ")" && quotes.length > 1) { quotes.pop(); continue }
      const redirect = text.slice(index).match(/^<<(-?)(?!<)[ \t]*(?:'([^']+)'|"([^"]+)"|([^\s;&|<>]+))/)
      if (redirect) {
        pending.push({ delimiter: redirect[2] ?? redirect[3] ?? redirect[4]!, tabs: redirect[1] === "-" })
        index += redirect[0].length - 1
        continue
      }
      if (character === "\n" && pending.length) heredoc = pending.shift()
    }
    return text
  }
  const value = (text: string) => {
    if (node.kind !== "shell") return text
    const name = prefix + Object.keys(env).length
    env[name] = text
    const reference = "${" + name + "}"
    if (heredoc || quotes.at(-1) === '"') return reference
    return quotes.at(-1) === "'" ? "'\"" + reference + "\"'" : '"' + reference + '"'
  }
  const text = node.parts.map(part => {
    if ("boundValue" in part) return value(part.boundValue)
    const pattern = syntax === "claude" ? /\$(?:ARGUMENTS(?:\[\d+\])?|\d+|[A-Za-z_][A-Za-z_0-9]*)/g : /\$(?:ARGUMENTS|[1-9]\d*)/g
    let end = 0
    let rendered = ""
    for (const match of part.source.matchAll(pattern)) {
      rendered += source(part.source.slice(end, match.index))
      const argument = parameter(match[0], node.kind)
      const quote = quotes.at(-1)!
      rendered += argument === undefined ? source(match[0]) : Array.isArray(argument) ? argument.map(value).join(heredoc || !quote ? " " : quote + " " + quote) : value(argument)
      end = match.index + match[0].length
    }
    return rendered + source(part.source.slice(end))
  }).join("")
  return { text, env }
}

function parseArguments(input: string, syntax: PreparedInstruction["syntax"]) {
  if (syntax !== "claude") return (input.match(/(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi) ?? []).map(arg => arg.replace(/^["']|["']$/g, ""))
  const args: string[] = []
  let word = ""
  let active = false
  let quote = ""
  let escaped = false
  for (const character of input) {
    if (escaped) { word += character; active = true; escaped = false; continue }
    if (character === "\\" && quote !== "'") { escaped = true; active = true; continue }
    if (quote) { if (character === quote) quote = ""; else word += character; continue }
    if (character === '"' || character === "'") { quote = character; active = true; continue }
    if (/\s/.test(character)) { if (active) args.push(word); word = ""; active = false; continue }
    active = true
    word += character
  }
  if (escaped) word += "\\"
  if (active) args.push(word)
  return args
}
