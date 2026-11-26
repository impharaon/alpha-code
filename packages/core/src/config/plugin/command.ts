export * as ConfigCommandPlugin from "./command.js"

import { define } from "@opencode/plugin/effect/plugin"
import { registerPackageInstructionRenderer, type PreparedInstruction } from "@opencode/plugin/codepuppy-package-runtime"
import type { Entry } from "@opencode/schema/config"
import { ConfigCommand } from "@opencode/schema/config/command"
import { AppProcess } from "@opencode/util/process"
import path from "path"
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
        runInstruction(evaluateTemplate(input, { location, processes, shell })))),
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
          const gated = CodePuppyProjectGate.interpolation(ctx.location.directory, name, document.gated, document.file, command.template.match(shellRegex) !== null) // codepuppy(ADR-049)
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
type TemplateNode = { kind: "text" | "shell"; parts: InstructionNode[] }

// Compile source boundaries before inserting values. A bound value can occur inside a static shell node.
function instructionNodes(input: PreparedInstruction): TemplateNode[] {
  const characters = input.parts.flatMap<string | { boundValue: string }>(part => typeof part === "string" ? [...part] : [part])
  const nodes: TemplateNode[] = [{ kind: "text", parts: [] }]
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index]!
    const node = nodes.at(-1)!
    if (input.syntax !== "literal" && character === "!" && characters[index + 1] === "`" && node.kind === "text" && characters.slice(index + 2).includes("`")) {
      nodes.push({ kind: "shell", parts: [] })
      index++
      continue
    }
    if (character === "`" && node.kind === "shell") { nodes.push({ kind: "text", parts: [] }); continue }
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
    const parameter = (token: string): string | undefined => {
      if (input.syntax === "literal") return
      if (token === "$ARGUMENTS") { hasArguments = true; return input.rawArguments }
      const index = token.match(input.syntax === "claude" ? /^\$(?:ARGUMENTS\[(\d+)\]|(\d+))$/ : /^\$([1-9]\d*)$/)
      if (index) {
        hasArguments = true
        const position = Number(index[1] ?? index[2])
        const offset = position - (input.syntax === "claude" ? 0 : 1)
        if (offset >= args.length) return input.syntax === "opencode" ? "" : token
        return input.syntax === "opencode" && position === last ? args.slice(offset).join(" ") : args[offset]!
      }
      if (input.syntax !== "claude") return
      const named = input.arguments.indexOf(token.slice(1))
      if (named < 0) return
      hasArguments = true
      return args[named] ?? ""
    }
    const renderNode = (node: TemplateNode) => {
      let quote = ""
      let escaped = false
      const value = (text: string) => node.kind !== "shell" ? text : quote === "'" ? text.replaceAll("'", "'\\''") : quote === '"' ? text.replace(/[\\"$`]/g, character => "\\" + character) : "'" + text.replaceAll("'", "'\\''") + "'"
      return node.parts.map(part => {
        if ("boundValue" in part) return value(part.boundValue)
        const pattern = input.syntax === "claude" ? /\$(?:ARGUMENTS(?:\[\d+\])?|\d+|[A-Za-z_][A-Za-z_0-9]*)/g : /\$(?:ARGUMENTS|[1-9]\d*)/g
        let end = 0
        let rendered = ""
        const source = (text: string) => {
          if (node.kind === "shell") for (const character of text) {
            if (escaped) { escaped = false; continue }
            if (character === "\\" && quote !== "'") { escaped = true; continue }
            if (quote) { if (character === quote) quote = ""; continue }
            if (character === "'" || character === '"') quote = character
          }
          return text
        }
        for (const match of part.source.matchAll(pattern)) {
          rendered += source(part.source.slice(end, match.index))
          const argument = parameter(match[0])
          rendered += argument === undefined ? source(match[0]) : value(argument)
          end = match.index + match[0].length
        }
        return rendered + source(part.source.slice(end))
      }).join("")
    }
    const rendered = nodes.map(node => ({ kind: node.kind, text: renderNode(node) }))
    const shell = rendered.some(node => node.kind === "shell") && !gated ? yield* services.shell.resolve({ priority: "config" }) : undefined
    const outputs = yield* Effect.forEach(rendered, node => {
      if (node.kind !== "shell") return Effect.succeed(node.text)
      if (!shell) return Effect.succeed("!`" + node.text + "`")
      return services.processes.run(ChildProcess.make(shell, ShellSelect.args(shell, node.text), { cwd: input.cwd, stdin: "ignore" }), { combineOutput: true }).pipe(
        Effect.map(result => (result.output ?? Buffer.concat([result.stdout, result.stderr])).toString("utf8")),
        Effect.mapError(error => new Error("Shell interpolation failed: " + error.message)),
      )
    }, { concurrency: 2 })
    const text = outputs.join("").trim()
    if (hasArguments || !input.rawArguments.trim()) return text
    return text + "\n\n" + (input.syntax === "opencode" ? input.rawArguments : "ARGUMENTS: " + input.rawArguments)
  })
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

const shellRegex = /!`([^`]+)`/g
