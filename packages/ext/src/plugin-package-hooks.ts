import type { PackageSessionMessage } from "../../ui-mac/src/main/codepuppy-sidecar-messages"
import type { UnattendedState } from "./policy/unattended"
import type { PolicyRegistration } from "./policy/index"
import type { GateCall } from "./policy/gate"
import type { Plugin } from "@opencode/plugin"
import type { ElicitationAnswer } from "@opencode/plugin/codepuppy-package-runtime"
import { Schema } from "effect"
import { releasePackageSessionMcp, registerPackageRuntime } from "@opencode/plugin/codepuppy-package-runtime"
import type { HookEvent } from "../../ui-mac/src/shared/host-extension-package-contract/plugin-package"
import { pluginToolRules } from "../../ui-mac/src/shared/host-extension-package-contract/plugin-conversion.mjs"
import { match } from "../../core/src/util/wildcard"
import { INSTALLED_PLUGIN_SETTINGS_FILE } from "../../ui-mac/src/shared/installed-plugin-settings"
import { pluginEntryRuntimeAvailable } from "../../ui-mac/src/shared/plugin-package-runtime"
import { codepuppyCredential } from "../../util/src/codepuppy-credentials"
import { allInstalledPluginPackages, allInstalledPluginInstructions, installedPluginPackage } from "./plugin-package-skills"
import { readPackageAllowSet } from "./gen-skill-paths"
import { managedPackageEntryAllowedHere } from "./package-scope"
import { createPackageProcesses } from "./plugin-package-process"
import { pluginProcessConfig } from "../../ui-mac/src/shared/plugin-mcp-config"
import { resolvePackageModel } from "./model-facts"
import { ASK_AGENT, READONLY_AGENT } from "../../ui-mac/src/shared/permission-tier"
import { PACKAGE_HOOK_CONTEXT_ID, renderWrapper } from "./context-injection"
import { mkdtempSync, writeFileSync, chmodSync, rmSync, watchFile, unwatchFile, type Stats } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve, isAbsolute } from "node:path"
import { createHash, randomUUID } from "node:crypto"

type Installed = ReturnType<typeof allInstalledPluginPackages>[number]
type Instruction = ReturnType<typeof import("./plugin-package-skills").allInstalledPluginInstructions>[number]
type InstructionScope = { item: Instruction; active(): boolean }
export type PackageHookRuntime = Awaited<ReturnType<typeof registerPackageHooks>>
type Contribution = {
  valid(): boolean
  installed: Installed
  text: string
  order: number
  sessionID: string
  lifetime: object
  block?: boolean
  stopTurn?: boolean
  output?: Record<string, unknown>
}
type HookResult = Contribution & { exitCode: number }
type BatchCall = { tool_use_id: string; tool_name: string; tool_input: unknown; tool_response: unknown; is_error: boolean; error?: string; is_interrupt?: boolean }
const promptStopsTurn = (event: HookEvent, continueOnBlock: boolean) =>
  ["UserPromptSubmit", "UserPromptExpansion", "PostToolBatch"].includes(event) ||
  (["PreToolUse", "PostToolUse"].includes(event) && !continueOnBlock)
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

export async function registerPackageHooks(
  context: Plugin.Context,
  input: { root: string; projectRoot(): string | undefined; log(line: string): void; policy: PolicyRegistration; unattended: UnattendedState },
) {
  const processes = createPackageProcesses(context.location)
  const instructions = new Map<string, Map<string, InstructionScope>>()
  const expansions = new Map<string, Contribution[]>()
  const failures = new Map<string, Contribution[]>()
  let preparePrompt: ((event: import("@opencode/plugin/promise/session").SessionPrompt) => Promise<void>) | undefined
  const directory = mkdtempSync(join(tmpdir(), "codepuppy-plugin-session-"))
  const created = new Set<string>()
  const endings = new Map<string, Promise<void>>()
  const departed = new Set<string>()
  const tasks = new Set<string>()
  const preparing = new Set<string>()
  const continued = new Set<string>()
  const continuing = new Set<string>()
  const starts = new Map<string, Promise<void>>()
  const sessionContexts = new Map<string, Contribution[]>()
  const promptContexts = new Map<string, Contribution[]>()
  const stopTurns = new Map<string, Contribution>()
  const running = new Map<AbortController, { valid(): boolean; sessionID: string; kind: "decision" | "async" | "watcher" | "monitor" }>()
  const monitors = new Map<string, { controller: AbortController; sessionID: string; valid(): boolean }>()
  const observed = new Set<string>()
  const promptEpoch = new Map<string, number>()
  const sessionEpoch = new Map<string, object>()
  const environmentFiles = new Map<string, { lifetime: object; file: string }>()
  const fileWatches = new Map<string, { lifetime: object; paths: Map<string, (current: Stats, previous: Stats) => void>; pending: Promise<void> }>()
  const dynamicWatches = new Map<string, Map<string, { paths: string[]; valid(): boolean }>>()
  const configResults = new Map<string, Map<string, { valid(): boolean; result: Promise<HookResult | undefined> }>>()
  const batches = new Map<string, { complete: Set<string>; pending: Map<string, Promise<Contribution[]>> }>()
  const children = new Map<string, { parentID: string; agentType: string }>()
  const sourceInstructionName = (item: Instruction) => item.installed.description.provider === "claude-code"
    ? item.installed.description.name + ":" + item.entry.sourceName
    : item.entry.sourceName
  const sourceAgentType = (agent: string | undefined) => {
    const source = allInstalledPluginInstructions(input.root).find(item => item.entry.kind === "agent" && item.name === agent)
    return source ? sourceInstructionName(source) : agent
  }
  const matchesHook = (event: HookEvent, matcher: string | undefined, fields: Record<string, unknown>) => {
    if (!matcher || matcher === "*") return true
    const field: Partial<Record<HookEvent, string>> = {
      PreToolUse: "tool_name", PostToolUse: "tool_name", PostToolUseFailure: "tool_name",
      PermissionRequest: "tool_name", PermissionDenied: "tool_name", SessionStart: "source",
      SessionEnd: "reason", Notification: "notification_type", SubagentStart: "agent_type",
      SubagentStop: "agent_type", PreCompact: "trigger", PostCompact: "trigger",
      ConfigChange: "source", StopFailure: "error", InstructionsLoaded: "load_reason",
      UserPromptExpansion: "command_name", Elicitation: "mcp_server_name", ElicitationResult: "mcp_server_name",
    }
    const name = field[event]
    if (!name) return true
    const value = String(fields[name] ?? "")
    if ((event === "StopFailure" ? /^[\w|]+$/ : /^[\w ,|\-]+$/).test(matcher))
      return matcher.split(event === "StopFailure" ? "|" : /[|,]/).some(item => item.trim() === value)
    try { return new RegExp(matcher).test(value) }
    catch { input.log("runtime-failed: package hook matcher " + event + ": invalid regular expression"); return false }
  }
  let disposed = false
  const active = (installed: Installed) => {
    if (disposed) return false
    const current = installedPluginPackage(input.root, installed.key)
    return (
      current?.pluginRoot === installed.pluginRoot &&
      JSON.stringify(current.settings) === JSON.stringify(installed.settings) &&
      managedPackageEntryAllowedHere(
        "bundle",
        installed.key.slice("bundle--".length),
        readPackageAllowSet(input.root),
        input.projectRoot(),
      )
    )
  }
  const revoke = () => {
    for (const sessionID of sessionEpoch.keys()) reconcileFileWatches(sessionID)
    for (const [controller, owner] of running) if (!owner.valid()) controller.abort()
    for (const contexts of [sessionContexts, promptContexts])
      for (const [sessionID, values] of contexts)
        contexts.set(
          sessionID,
          values.filter((value) => value.valid() && value.lifetime === sessionEpoch.get(value.sessionID)),
        )
  }
  const watchPackage = (installed: Installed) => {
    for (const file of ["current.json", INSTALLED_PLUGIN_SETTINGS_FILE]) {
      const pointer = join(input.root, "ext-store", installed.key, file)
      if (observed.has(pointer)) continue
      observed.add(pointer)
      watchFile(pointer, { interval: 100, persistent: false }, revoke)
    }
  }
  const processSource = (installed: Installed, scope?: Pick<InstructionScope, "item">): Parameters<typeof pluginProcessConfig>[0] => {
    if (!installed.settings) throw Error("dependency-missing: package settings")
    return {
      description: installed.description, settings: installed.settings, pluginRoot: installed.pluginRoot,
      projectDir: context.location.directory,
      ...(scope ? { skillDir: scope.item.entry.kind === "skill" ? join(installed.pluginRoot, scope.item.entry.directory) : dirname(join(installed.pluginRoot, scope.item.entry.sourcePath)) } : {}),
      resolveEnvironment: name => process.env[name],
      resolveOptionSecret: ref => codepuppyCredential(ref.slice(6, -1)),
      resolveSecret: id => { const ref = installed.settings?.secretRefs[id]; return ref ? codepuppyCredential(ref.slice(6, -1)) : undefined },
    }
  }
  const membership = join(input.root, "skills-enabled.json")
  watchFile(membership, { interval: 100, persistent: false }, revoke)
  const events = new AbortController()
  const close = (sessionID: string) => {
    departed.delete(sessionID)
    tasks.delete(sessionID)
    preparing.delete(sessionID)
    closeFileWatches(sessionID)
    dynamicWatches.delete(sessionID)
    const environment = environmentFiles.get(sessionID)
    if (environment) rmSync(environment.file, { force: true })
    environmentFiles.delete(sessionID)
    children.delete(sessionID)
    instructions.delete(sessionID)
    failures.delete(sessionID)
    sessionEpoch.delete(sessionID)
    configResults.delete(sessionID)
    batches.delete(sessionID)
    for (const [key, monitor] of monitors) if (monitor.sessionID === sessionID) monitors.delete(key)
    promptEpoch.delete(sessionID)
    stopTurns.delete(sessionID)
    for (const [controller, owner] of running) if (owner.sessionID === sessionID) controller.abort()
    continued.delete(sessionID)
    continuing.delete(sessionID)
    starts.delete(sessionID)
    created.delete(sessionID)
    sessionContexts.delete(sessionID)
    promptContexts.delete(sessionID)
  }
  const transcriptFor = async (sessionID: string) => {
    const transcript = join(directory, createHash("sha256").update(sessionID).digest("hex") + ".jsonl")
    const history = await context.session.context({ sessionID })
    let parent: string | null = null
    const rows = history.flatMap<Record<string, unknown>>((message) => {
      const content =
        message.type === "assistant"
          ? message.content.flatMap<Record<string, unknown>>((part) =>
              part.type === "text"
                ? [{ type: "text", text: part.text }]
                : part.type === "tool" && part.state.status !== "streaming"
                  ? [{ type: "tool_use", id: part.id, name: part.name, input: part.state.input }]
                  : [],
            )
          : "text" in message && typeof message.text === "string"
            ? [{ type: "text", text: message.text }]
            : []
      if (!content.length) return []
      const row = {
        type: message.type === "assistant" ? "assistant" : "user",
        sessionId: sessionID,
        uuid: message.id,
        parentUuid: parent,
        timestamp: new Date(message.time.created).toISOString(),
        cwd: context.location.directory,
        message: { role: message.type === "assistant" ? "assistant" : "user", content },
      }
      parent = message.id
      const results =
        message.type === "assistant"
          ? message.content.flatMap((part) =>
              part.type === "tool" && (part.state.status === "completed" || part.state.status === "error")
                ? [
                    {
                      type: "user",
                      sessionId: sessionID,
                      uuid: message.id + ":" + part.id + ":result",
                      parentUuid: message.id,
                      timestamp: new Date(part.time.completed ?? part.time.created).toISOString(),
                      cwd: context.location.directory,
                      message: {
                        role: "user",
                        content: [
                          {
                            type: "tool_result",
                            tool_use_id: part.id,
                            content: part.state.content ?? (part.state.status === "error" ? part.state.error : []),
                            is_error: part.state.status === "error",
                          },
                        ],
                      },
                    },
                  ]
                : [],
            )
          : []
      if (results.length) parent = results.at(-1)!.uuid
      return [row, ...results]
    })
    writeFileSync(transcript, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), {
      mode: 0o600,
    })
    chmodSync(transcript, 0o600)
    return { transcript, history }
  }
  const sourceServer = (installed: Installed, server: string) => installed.description.entries.find(entry =>
    entry.kind === "mcp" && installed.hostNames[entry.id] === server,
  )?.sourceName ?? server
  const elicitationAnswer = (results: readonly Contribution[]): ElicitationAnswer | undefined => {
    const answers = results.flatMap(result => {
      if (result.block) return [{ action: "decline" as const }]
      const specific = result.output?.hookSpecificOutput
      if (!record(specific) || specific.action === undefined) return []
      if (typeof specific.action !== "string" || !["accept", "decline", "cancel"].includes(specific.action)) {
        input.log("runtime-failed: invalid elicitation hook action")
        return []
      }
      return [{ action: specific.action as ElicitationAnswer["action"],
        ...(specific.action === "accept" && specific.content !== undefined ? { content: Schema.decodeUnknownSync(Schema.Json)(specific.content) } : {}),
      }]
    })
    return answers.find(answer => answer.action === "decline") ?? answers[0]
  }
  const environmentFile = (sessionID: string, lifetime: object, create: boolean) => {
    const current = environmentFiles.get(sessionID)
    if (current?.lifetime === lifetime) return current.file
    if (!create) return
    const file = join(directory, createHash("sha256").update(sessionID).digest("hex") + "-" + randomUUID() + ".sh")
    writeFileSync(file, "", { flag: "wx", mode: 0o600 })
    environmentFiles.set(sessionID, { lifetime, file })
    return file
  }
  const handlersFor = (event: HookEvent, sessionID: string, invocation?: InstructionScope) => {
    const installed = allInstalledPluginPackages(input.root).filter(active)
    return installed.flatMap((installed) =>
      installed.description.entries.flatMap((entry) => {
        if (entry.kind !== "hook" || !pluginEntryRuntimeAvailable(entry) || entry.hook.event !== event) return []
        const scope =
          entry.hook.scope.kind === "package"
            ? undefined
            : (instructions.get(sessionID)?.get(installed.key + ":" + entry.hook.scope.entryId) ??
              (invocation?.item.installed.key === installed.key && invocation.item.entry.id === entry.hook.scope.entryId
                ? invocation
                : undefined))
        if (entry.hook.scope.kind !== "package" && !scope) return []
        const valid = () =>
          active(installed) &&
          (!scope ||
            (scope.active() &&
              (invocation === scope ||
                instructions.get(sessionID)?.get(installed.key + ":" + scope.item.entry.id) === scope)))
        return valid() ? [{ installed, entry, hook: entry.hook, scope, valid }] : []
      }),
    )
  }
  const filePaths = (sessionID: string, handler: ReturnType<typeof handlersFor>[number]) =>
    dynamicWatches.get(sessionID)?.get(handler.installed.key + ":" + handler.entry.id)?.paths ??
    (handler.hook.matcher?.split("|") ?? []).filter(Boolean).map(name => resolve(context.location.directory, name))
  const run = async (
    event: HookEvent,
    sessionID: Parameters<Plugin.Context["session"]["get"]>[0]["sessionID"],
    fields: Record<string, unknown>,
    call?: GateCall,
    invocation?: InstructionScope,
    occurrenceId?: string,
    batch?: readonly BatchCall[],
  ) => {
    const handlers = handlersFor(event, sessionID, invocation)
    if (!handlers.length) return []
    const lifetime = sessionEpoch.get(sessionID) ?? {}
    sessionEpoch.set(sessionID, lifetime)
    const currentSession = await context.session.get({ sessionID })
    let session = currentSession
    while (session.parentID) session = await context.session.get({ sessionID: session.parentID })
    const { transcript, history } = await transcriptFor(sessionID)
    const child = children.get(sessionID)
    const subagent = ["SubagentStart", "SubagentStop"].includes(event) ? child : undefined
    const agentType = child?.agentType ?? sourceAgentType(call?.agent ?? currentSession.agent)
    const subagentFields = { ...(agentType ? { agent_type: agentType } : {}), ...(child ? { agent_id: sessionID } : {}) }
    const payload = {
      session_id: subagent?.parentID ?? sessionID,
      transcript_path: subagent ? (await transcriptFor(subagent.parentID)).transcript : transcript,
      ...(subagent ? { agent_transcript_path: transcript } : {}),
      ...subagentFields,
      cwd: context.location.directory,
      permission_mode:
        session.agent === READONLY_AGENT ? "plan" : session.agent === ASK_AGENT ? "default" : "bypassPermissions",
      hook_event_name: event,
      ...(history.findLast((message) => message.type === "user")
        ? { prompt_id: history.findLast((message) => message.type === "user")!.id }
        : {}),
      stop_hook_active: continued.has(sessionID),
      last_assistant_message:
        history
          .filter((message) => message.type === "assistant")
          .at(-1)
          ?.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
          .join("\n") ?? "",
      ...fields,
    }
    const epoch = promptEpoch.get(sessionID)
    const results = await Promise.all(
      handlers.map(async (handler, order) => {
        const execute = async (): Promise<HookResult | undefined> => {
          const controller = new AbortController()
          let redact = (text: string) => text
          running.set(controller, { valid: handler.valid, sessionID, kind: event === "FileChanged" ? "watcher" : handler.hook.type === "command" && (handler.hook.async || handler.hook.asyncRewake) ? "async" : "decision" })
          watchPackage(handler.installed)
          try {
            if (!handler.valid()) return
            const bindings = Object.fromEntries(handler.installed.description.entries.flatMap(entry =>
              entry.kind === "mcp" ? [["mcp::" + entry.sourceName, handler.installed.hostNames[entry.id]!]] : [],
            ))
            const source = call && await input.policy.packageToolCall(call.tool, call.input, bindings, "claude")
            const eventFields: Record<string, unknown> = {
              ...fields,
              ...subagentFields,
              ...(typeof fields.mcp_server_name === "string" ? { mcp_server_name: sourceServer(handler.installed, fields.mcp_server_name) } : {}),
              ...(source ? {
                tool_name: source.name, tool_input: source.input, tool_use_id: call!.id,
                ...("tool_response" in fields ? { tool_response: (await input.policy.packageToolCall(call!.tool, fields.tool_response, {}, "claude")).input } : {}),
              } : {}),
              ...(batch ? { tool_calls: await Promise.all(batch.map(async item => {
                const source = await input.policy.packageToolCall(item.tool_name, item.tool_input, bindings, "claude")
                return { ...item, tool_name: source.name, tool_input: source.input,
                  tool_response: (await input.policy.packageToolCall(item.tool_name, item.tool_response, {}, "claude")).input }
              })) } : {}),
            }
            if (handler.hook.if) {
              const rules = pluginToolRules(handler.hook.if, () => {
                throw Error("hook condition has invalid tool rule syntax")
              })
              const toolInput = record(eventFields.tool_input) ? eventFields.tool_input : {}
              if (
                !rules.some(
                  (rule) =>
                    match(String(eventFields.tool_name ?? ""), rule.tool) &&
                    (rule.pattern === undefined ||
                      match(String(toolInput.command ?? toolInput.file_path ?? ""), rule.pattern)),
                )
              )
                return
            }
            if (event === "FileChanged" && !filePaths(sessionID, handler).includes(String(eventFields.file_path))) return
            if (event !== "FileChanged" && !matchesHook(event, handler.hook.matcher, eventFields)) return
            const sourceConfig = processSource(handler.installed, handler.scope)
            if (handler.hook.type === "prompt") {
              const config = pluginProcessConfig(sourceConfig)
              redact = (text) =>
                [...config.secretValues]
                  .toSorted((left, right) => right.length - left.length)
                  .reduce((text, secret) => text.replaceAll(secret, "[redacted]"), text)
              const eventJSON = JSON.stringify({ ...payload, ...eventFields })
              const hasArguments = handler.hook.prompt.some(
                (part) => typeof part === "string" && part.includes("$ARGUMENTS"),
              )
              const prompt =
                handler.hook.prompt
                  .map((part) =>
                    typeof part === "string" ? part.replaceAll("$ARGUMENTS", () => eventJSON) : config.render([part]),
                  )
                  .join("") + (hasArguments ? "" : "\n\n" + eventJSON)
              const hint = await resolvePackageModel(context, handler.hook.model, input.log)
              const separator = hint?.indexOf("/") ?? -1
              const selected =
                currentSession.model ??
                (hint && separator >= 0
                  ? { providerID: hint.slice(0, separator), id: hint.slice(separator + 1) }
                  : (await context.model.default()).data)
              let timeout: ReturnType<typeof setTimeout> | undefined
              let abort: (() => void) | undefined
              const response = await Promise.race([
                context.experimental.generate.text({
                  prompt:
                    prompt +
                    '\n\nReturn only JSON: {"ok":boolean,"reason"?:string,"impossible"?:boolean}. Use ok=true for approve; ok=false requires a reason. This judgment cannot execute tools.',
                  ...(selected ? { model: selected } : {}),
                }),
                new Promise<never>((_, reject) => {
                  abort = () =>
                    reject(
                      Error(
                        controller.signal.reason instanceof Error ? controller.signal.reason.message : "hook cancelled",
                      ),
                    )
                  controller.signal.addEventListener("abort", abort, { once: true })
                  timeout = setTimeout(() => reject(Error("prompt hook timed out")), handler.hook.timeoutSeconds * 1000)
                }),
              ]).finally(() => {
                if (timeout) clearTimeout(timeout)
                if (abort) controller.signal.removeEventListener("abort", abort)
              })
              const judgment: unknown = JSON.parse(response.text)
              if (
                !record(judgment) ||
                typeof judgment.ok !== "boolean" ||
                (judgment.reason !== undefined && typeof judgment.reason !== "string") ||
                (judgment.impossible !== undefined && typeof judgment.impossible !== "boolean") ||
                (!judgment.ok && (typeof judgment.reason !== "string" || !judgment.reason.trim()))
              )
                throw Error("prompt hook returned an invalid judgment")
              if (!handler.valid() || controller.signal.aborted || sessionEpoch.get(sessionID) !== lifetime) return
              const stopping = ["Stop", "SubagentStop"].includes(event)
              return {
                installed: handler.installed,
                valid: handler.valid,
                block: !judgment.ok && event !== "PermissionRequest" && (!stopping || judgment.impossible !== true),
                stopTurn: !judgment.ok && promptStopsTurn(event, handler.hook.continueOnBlock),
                exitCode: 0,
                order,
                text: config.secretValues.size
                  ? [...config.secretValues].reduce(
                      (text, secret) => text.replaceAll(secret, "[redacted]"),
                      String(judgment.reason ?? ""),
                    )
                  : String(judgment.reason ?? ""),
                sessionID,
                lifetime,
              }
            }
            const file = environmentFile(sessionID, lifetime, ["SessionStart", "FileChanged"].includes(event))
            const result = await processes.command({
              source: sourceConfig,
              command: handler.hook.command,
              ...(handler.hook.args === undefined ? {} : { args: handler.hook.args }),
              environment: { CLAUDE_ENV_FILE: ["SessionStart", "FileChanged"].includes(event) ? file : undefined },
              ...(file ? { environmentFile: file } : {}),
              signal: controller.signal,
              stdin: { ...payload, ...eventFields },
              timeoutSeconds: handler.hook.timeoutSeconds,
            })
            redact = result.redact
            if (!handler.valid() || controller.signal.aborted || sessionEpoch.get(sessionID) !== lifetime) return
            if (result.exitCode === 2)
              return {
                installed: handler.installed,
                valid: handler.valid,
                block: ["UserPromptSubmit", "PreToolUse", "Stop", "SubagentStop", "ConfigChange", "PostToolBatch", "PreCompact", "Elicitation", "ElicitationResult"].includes(event),
                exitCode: 2,
                order,
                text: result.stderr,
                sessionID,
                lifetime,
              }
            if (result.exitCode !== 0) throw Error("hook exited " + result.exitCode)
            const plain = !/^[\s]*[\[{]/.test(result.stdout)
            const contextOutput = ["SessionStart", "UserPromptSubmit", "UserPromptExpansion"].includes(event)
            if (plain && !contextOutput && result.stdout.trim()) input.log("package hook " + event + ": " + result.redact(result.stdout))
            const output: unknown = result.stdout.trim()
              ? plain ? contextOutput ? { systemMessage: result.stdout } : {} : JSON.parse(result.stdout)
              : {}
            if (!record(output)) throw Error("hook output must be an object")
            const specific = record(output.hookSpecificOutput) ? output.hookSpecificOutput : undefined
            if (event === "FileChanged" && output.watchPaths !== undefined) {
              if (!Array.isArray(output.watchPaths) || !output.watchPaths.every(value => typeof value === "string" && isAbsolute(value) && !value.includes("\0")))
                throw Error("hook watchPaths must contain absolute file paths")
              const watches = dynamicWatches.get(sessionID) ?? new Map<string, { paths: string[]; valid(): boolean }>()
              watches.set(handler.installed.key + ":" + handler.entry.id, { paths: output.watchPaths, valid: handler.valid })
              dynamicWatches.set(sessionID, watches)
              reconcileFileWatches(sessionID)
            }
            return {
              installed: handler.installed,
              valid: handler.valid,
              block:
                (!["Elicitation", "ElicitationResult", "Notification", "FileChanged"].includes(event) && output.continue === false) ||
                (["Stop", "SubagentStop", "PreToolUse", "ConfigChange", "PreCompact", "Elicitation", "ElicitationResult"].includes(event) && output.decision === "block") ||
                (event === "PreToolUse" && specific?.permissionDecision === "deny") ||
                (event === "PermissionRequest" && record(specific?.decision) && specific.decision.behavior === "deny"),
              output,
              exitCode: 0,
              order,
              text: redact(
                [
                  specific?.additionalContext,
                  output.systemMessage,
                  output.stopReason,
                  event === "PermissionRequest" && record(specific?.decision) ? specific.decision.message : undefined,
                  ["Stop", "SubagentStop", "PreToolUse", "ConfigChange", "PreCompact"].includes(event)
                    ? (specific?.permissionDecisionReason ?? output.reason)
                    : undefined,
                ]
                  .filter((value) => typeof value === "string")
                  .join("\n"),
              ),
              sessionID,
              lifetime,
            }
          } catch (error) {
            if (controller.signal.aborted || !handler.valid()) return
            input.log(
              "runtime-failed: hook " +
                handler.entry.id +
                ": " +
                redact(error instanceof Error ? error.message : String(error)),
            )
            return {
              installed: handler.installed,
              valid: handler.valid,
              block: handler.hook.onFailure === "block",
              stopTurn: handler.hook.onFailure === "block" && handler.hook.type === "prompt" && promptStopsTurn(event, handler.hook.continueOnBlock),
              exitCode: -1,
              order,
              text: "",
              sessionID,
              lifetime,
            }
          } finally {
            running.delete(controller)
          }
        }
        const executeRevision = () => {
          if (event !== "ConfigChange" || !occurrenceId) return execute()
          const revisions = configResults.get(sessionID) ?? new Map<string, { valid(): boolean; result: Promise<HookResult | undefined> }>()
          configResults.set(sessionID, revisions)
          const key = JSON.stringify([occurrenceId, handler.installed.key, handler.installed.pluginRoot, handler.installed.settings, handler.entry.id])
          const previous = revisions.get(key)
          if (previous?.valid()) return previous.result
          const result = execute()
          revisions.set(key, { valid: handler.valid, result })
          return result
        }
        if (handler.hook.type !== "command" || (!handler.hook.async && !handler.hook.asyncRewake)) return executeRevision()
        void executeRevision()
          .then(async (result) => {
            if (!result || !result.valid() || (event !== "SessionStart" && promptEpoch.get(sessionID) !== epoch)) return
            if (sessionEpoch.get(sessionID) !== lifetime) return
            const contexts =
              event === "SessionStart" ? sessionContexts : event === "StopFailure" ? failures : promptContexts
            if (result.text) contexts.set(sessionID, [...(contexts.get(sessionID) ?? []), result])
            if (
              event !== "StopFailure" &&
              handler.hook.type === "command" &&
              handler.hook.asyncRewake &&
              result.exitCode === 2
            )
              await context.session.synthetic({ sessionID, text: result.text, resume: true })
          })
          .catch((error) => input.log("runtime-failed: asynchronous package hook: " + String(error)))
        return undefined
      }),
    )
    if (sessionEpoch.get(sessionID) !== lifetime) return []
    const contributions = results.filter((result): result is NonNullable<typeof result> => !!result && result.valid())
    const blocked = contributions.find((result) => result.block)
    if (blocked?.stopTurn && event !== "StopFailure") stopTurns.set(sessionID, blocked)
    if (blocked && !["Stop", "SubagentStop", "PostToolUse", "PostToolUseFailure", "StopFailure", "ConfigChange", "PostToolBatch", "PreCompact", "PostCompact", "Elicitation", "ElicitationResult", "Notification", "FileChanged"].includes(event))
      throw Error("runtime-failed: package hook blocked " + event + (blocked.text ? ": " + blocked.text : ""))
    return contributions
      .filter((result) => result.text || event === "PreToolUse" || event === "PermissionRequest" || event === "ConfigChange" || event === "PostToolBatch" || event === "PreCompact" || event === "Elicitation" || event === "ElicitationResult")
      .map((result) => ({
        installed: result.installed,
        valid: result.valid,
        text: result.text,
        order: result.order,
        sessionID,
        lifetime,
        block: result.block,
        stopTurn: result.stopTurn,
        output: "output" in result ? result.output : undefined,
      }))
  }
  const closeFileWatches = (sessionID: string) => {
    const state = fileWatches.get(sessionID)
    if (!state) return
    fileWatches.delete(sessionID)
    for (const [file, listener] of state.paths) unwatchFile(file, listener)
    state.paths.clear()
  }
  const reconcileFileWatches = (sessionID: string) => {
    const lifetime = sessionEpoch.get(sessionID)
    const handlers = handlersFor("FileChanged", sessionID)
    if (!lifetime || departed.has(sessionID) || !handlers.length) { closeFileWatches(sessionID); return }
    const state = fileWatches.get(sessionID) ?? { lifetime, paths: new Map<string, (current: Stats, previous: Stats) => void>(), pending: Promise.resolve() }
    fileWatches.set(sessionID, state)
    const dynamic = dynamicWatches.get(sessionID)
    if (dynamic) for (const [id, entry] of dynamic) if (!entry.valid()) dynamic.delete(id)
    const wanted = new Set(handlers.flatMap(handler => filePaths(sessionID, handler)))
    for (const [file, listener] of state.paths) if (!wanted.has(file)) { unwatchFile(file, listener); state.paths.delete(file) }
    for (const file of wanted) {
      if (state.paths.has(file)) continue
      const listener = (current: Stats, previous: Stats) => {
        const event = !current.isFile() ? previous.isFile() ? "unlink" : undefined
          : !previous.isFile() ? "add"
          : current.mtimeMs !== previous.mtimeMs || current.size !== previous.size || current.ino !== previous.ino ? "change" : undefined
        if (!event) return
        state.pending = state.pending.then(async () => {
          if (fileWatches.get(sessionID) !== state || !state.paths.has(file) || sessionEpoch.get(sessionID) !== lifetime) return
          await run("FileChanged", sessionID, { file_path: file, event })
        }).catch(error => input.log("runtime-failed: package FileChanged: " + String(error)))
      }
      try { watchFile(file, { interval: 100, persistent: false }, listener); state.paths.set(file, listener) }
      catch (error) { input.log("runtime-failed: package file watch: " + String(error)) }
    }
  }
  const startSession = async (sessionID: string, messageID?: string) => {
    if (children.has(sessionID)) return
    if (!sessionEpoch.has(sessionID)) sessionEpoch.set(sessionID, {})
    if (!starts.has(sessionID)) starts.set(sessionID,
      run("SessionStart", sessionID, {
        source: created.delete(sessionID) ? "startup" : "resume",
        ...(messageID ? { prompt_id: messageID } : {}),
      }).then(contexts => {
        sessionContexts.set(sessionID, [...(sessionContexts.get(sessionID) ?? []), ...contexts])
      }),
    )
    await starts.get(sessionID)
  }
  const finishDeparted = async (sessionID: string) => {
    if (!departed.has(sessionID) || tasks.has(sessionID) || preparing.has(sessionID)) return
    const lifetime = sessionEpoch.get(sessionID)
    await releasePackageSessionMcp(context.location, sessionID)
    if (departed.has(sessionID) && sessionEpoch.get(sessionID) === lifetime && !tasks.has(sessionID) && !preparing.has(sessionID)) close(sessionID)
  }
  const endSession = (sessionID: string, reason: Extract<PackageSessionMessage, { action: "leave" }>["reason"]) => {
    const pending = endings.get(sessionID)
    if (pending) return pending
    if (departed.has(sessionID)) return Promise.resolve()
    departed.add(sessionID)
    const ending = (async () => {
      try {
        if (sessionEpoch.has(sessionID)) await run("SessionEnd", sessionID, { reason })
      } finally {
        await Promise.all([...children].filter(([, child]) => child.parentID === sessionID).map(([childID]) => endSession(childID, reason)))
        closeFileWatches(sessionID)
        for (const [controller, owner] of running)
          if (owner.sessionID === sessionID && (owner.kind === "monitor" || owner.kind === "watcher")) controller.abort()
        for (const [key, monitor] of monitors) if (monitor.sessionID === sessionID) monitors.delete(key)
        await releasePackageSessionMcp(context.location, sessionID)
        await finishDeparted(sessionID)
      }
    })()
    endings.set(sessionID, ending)
    void ending.finally(() => { if (endings.get(sessionID) === ending) endings.delete(sessionID) }).catch(() => {})
    return ending
  }
  const startMonitors = (sessionID: string, invocation?: InstructionScope) => {
    const lifetime = sessionEpoch.get(sessionID)
    if (!lifetime || departed.has(sessionID)) return
    for (const installed of allInstalledPluginPackages(input.root).filter(active)) {
      for (const entry of installed.description.entries) {
        if (entry.kind !== "monitor" || !pluginEntryRuntimeAvailable(entry)) continue
        if (entry.when.kind === "skill" && (!invocation || invocation.item.installed.key !== installed.key || invocation.item.entry.kind !== "skill" || invocation.item.entry.sourceName !== entry.when.sourceName)) continue
        if (entry.when.kind === "always" && (invocation || children.has(sessionID))) continue
        const key = JSON.stringify([installed.settings?.packageId, entry.id, sessionID])
        const previous = monitors.get(key)
        if (previous?.valid()) continue
        previous?.controller.abort()
        const controller = new AbortController()
        const valid = () => !controller.signal.aborted && active(installed) && sessionEpoch.get(sessionID) === lifetime
        monitors.set(key, { controller, sessionID, valid })
        running.set(controller, { sessionID, valid, kind: "monitor" })
        watchPackage(installed)
        void Promise.resolve()
          .then(() => {
            if (!valid()) return
            return processes.monitor({
              source: processSource(installed, invocation), command: entry.command, environment: { CLAUDE_ENV_FILE: undefined }, environmentFile: environmentFile(sessionID, lifetime, false), signal: controller.signal,
            }, async line => {
              if (!valid()) return
              await context.session.synthetic({
                sessionID, text: renderWrapper(PACKAGE_HOOK_CONTEXT_ID, { label: entry.sourceName, body: line }), resume: true,
              })
            })
          })
          .catch(error => {
            if (valid()) input.log("runtime-failed: monitor " + entry.sourceName + ": " + String(error))
          })
          .finally(() => running.delete(controller))
      }
    }
  }
  // The initial snapshot is the recovery watermark; old terminal calls are never replayed.
  const rememberBatches = async (sessionID: string) => {
    const history = await context.session.context({ sessionID })
    batches.set(sessionID, { complete: new Set(history.filter(message => message.type === "assistant").map(message => message.id)), pending: new Map() })
  }
  let page = await context.session.list({})
  for (;;) {
    await Promise.all(page.data.map(session => rememberBatches(session.id)))
    if (!page.cursor.next) break
    page = await context.session.list({ cursor: page.cursor.next })
  }
  const drainToolBatches = async (sessionID: Parameters<Plugin.Context["session"]["get"]>[0]["sessionID"]) => {
    if (!sessionEpoch.has(sessionID)) return []
    const state = batches.get(sessionID) ?? { complete: new Set<string>(), pending: new Map<string, Promise<Contribution[]>>() }
    batches.set(sessionID, state)
    const contexts: Contribution[] = []
    for (const message of await context.session.context({ sessionID })) {
      if (message.type !== "assistant" || state.complete.has(message.id)) continue
      const calls = message.content.flatMap<BatchCall>(part => {
        if (part.type !== "tool" || (part.state.status !== "completed" && part.state.status !== "error")) return []
        const failure = part.state.status === "error" ? part.state.error : undefined
        return [{ tool_use_id: part.id, tool_name: part.name, tool_input: part.state.input,
          tool_response: failure ? { is_error: true, error: failure.message, content: part.state.content } : part.state.content,
          is_error: !!failure, ...(failure ? { error: failure.message, is_interrupt: (failure.type === "aborted" || failure.type === "AbortError") } : {}) }]
      })
      if (!calls.length || message.content.some(part => part.type === "tool" && (part.state.status === "streaming" || part.state.status === "running"))) continue
      const pending = state.pending.get(message.id)
      if (pending) { await pending; continue }
      const processing = run("PostToolBatch", sessionID, { assistant_message_id: message.id }, undefined, undefined, undefined, calls)
      state.pending.set(message.id, processing)
      try {
        contexts.push(...await processing)
        state.complete.add(message.id)
      } finally { state.pending.delete(message.id) }
    }
    return contexts
  }
  await context.tool.transform(editor => editor.update("subagent", tool => {
    const execute = tool.execute
    tool.execute = async (value, frame) => {
      let started = false
      return execute(value, {
        ...frame,
        progress: async update => {
          await frame.progress(update)
          if (started || typeof update.sessionID !== "string") return
          started = true
          const child = await context.session.get({ sessionID: update.sessionID })
          children.set(child.id, { parentID: frame.sessionID, agentType: sourceAgentType(child.agent)! })
          const contexts = await run("SubagentStart", child.id, {})
          sessionContexts.set(child.id, [...(sessionContexts.get(child.id) ?? []), ...contexts])
        },
      })
    }
  }))
  const runtime = registerPackageRuntime(context.location, {
    hasElicitationHandlers: server => allInstalledPluginPackages(input.root).filter(active).some(installed =>
      installed.description.entries.some(entry => entry.kind === "hook" && pluginEntryRuntimeAvailable(entry) &&
        ["Elicitation", "ElicitationResult"].includes(entry.hook.event) &&
        (entry.hook.scope.kind === "package" || [...instructions.values()].some(scopes => entry.hook.scope.kind !== "package" && scopes.get(installed.key + ":" + entry.hook.scope.entryId)?.active())) &&
        matchesHook(entry.hook.event, entry.hook.matcher, { mcp_server_name: sourceServer(installed, server) })),
    ),
    async beforeConfigChange(change) {
      const results = (await Promise.all([...sessionEpoch.keys()].map(sessionID => run("ConfigChange", sessionID, {
        source: change.source, file_path: change.filePath,
      }, undefined, undefined, change.occurrenceId)))).flat()
      const blocked = results.find(result => result.block && result.valid())
      return { apply: change.source === "policy_settings" || !blocked, ...(blocked?.text ? { reason: blocked.text } : {}) }
    },
    instructionsLoaded: async event => {
      await run("InstructionsLoaded", event.sessionID, {
        file_path: event.filePath,
        memory_type: event.memoryType,
        load_reason: event.loadReason,
        ...(event.globs ? { globs: event.globs } : {}),
        ...(event.triggerFilePath ? { trigger_file_path: event.triggerFilePath } : {}),
        ...(event.parentFilePath ? { parent_file_path: event.parentFilePath } : {}),
        ...(event.agentId ? { agent_id: event.agentId } : {}),
        ...(event.parentSessionId ? { parent_session_id: event.parentSessionId } : {}),
      })
    },
    async beforeCompaction(input) {
      const results = await run("PreCompact", input.sessionID, { trigger: input.trigger, custom_instructions: input.customInstructions })
      const blocked = results.find(result => result.block && result.valid())
      return { proceed: !blocked, ...(blocked?.text ? { reason: blocked.text } : {}) }
    },
    async afterCompaction(input) {
      await run("PostCompact", input.sessionID, { trigger: input.trigger, ...(input.summary === undefined ? {} : { compact_summary: input.summary }) })
    },
    async beforeElicitation(event) {
      if (await input.unattended.unattendedProfile(event.sessionID, undefined, async () => (await context.session.get({ sessionID: event.sessionID })).agent ?? "") !== undefined) return { handled: false }
      const answer = elicitationAnswer(await run("Elicitation", event.sessionID, {
        mcp_server_name: event.server, message: event.message, mode: event.mode,
        ...(event.requestedSchema === undefined ? {} : { requested_schema: event.requestedSchema }),
        ...(event.elicitationId === undefined ? {} : { elicitation_id: event.elicitationId }),
        ...(event.url === undefined ? {} : { url: event.url }),
      }))
      return answer ? { handled: true, answer } : { handled: false }
    },
    async afterElicitationResult(event) {
      if (await input.unattended.unattendedProfile(event.sessionID, undefined, async () => (await context.session.get({ sessionID: event.sessionID })).agent ?? "") !== undefined) return event.answer
      return elicitationAnswer(await run("ElicitationResult", event.sessionID, {
        mcp_server_name: event.server, mode: event.mode, action: event.answer.action,
        ...(event.elicitationId === undefined ? {} : { elicitation_id: event.elicitationId }),
        ...(event.answer.content === undefined ? {} : { content: event.answer.content }),
      })) ?? event.answer
    },
  })
  const subscription = (async () => {
    for await (const event of context.event.subscribe({
      types: ["session.created", "session.archived", "session.deleted", "session.execution.started", "session.execution.succeeded", "session.execution.interrupted", "session.execution.failed"],
      signal: events.signal,
    })) {
      if (event.type === "session.created") created.add(event.data.sessionID)
      else if (event.type === "session.execution.started") tasks.add(event.data.sessionID)
      else if (event.type === "session.execution.succeeded" || event.type === "session.execution.interrupted") {
        tasks.delete(event.data.sessionID)
        if (children.has(event.data.sessionID)) departed.add(event.data.sessionID)
        void Promise.resolve(endings.get(event.data.sessionID)).then(() => finishDeparted(event.data.sessionID)).catch(error => input.log("runtime-failed: package idle cleanup: " + String(error)))
      }
      else if (event.type === "session.execution.failed") {
        tasks.delete(event.data.sessionID)
        if (children.has(event.data.sessionID)) departed.add(event.data.sessionID)
        void run("StopFailure", event.data.sessionID, {
          error: event.data.error.type,
          error_details: event.data.error.message,
        })
          .then((contexts) => {
            if (contexts.length)
              failures.set(event.data.sessionID, [...(failures.get(event.data.sessionID) ?? []), ...contexts])
          })
          .catch((error) => input.log("runtime-failed: package failure hook: " + String(error)))
          .finally(() => finishDeparted(event.data.sessionID)).catch(error => input.log("runtime-failed: package idle cleanup: " + String(error)))
      } else {
        void endSession(event.data.sessionID, "other").finally(() => close(event.data.sessionID)).catch(error => input.log("runtime-failed: package SessionEnd: " + String(error)))
      }
    }
  })().catch((error) => {
    if (!events.signal.aborted) input.log("runtime-failed: package event subscription: " + String(error))
  })
  const releasePermissionRequest = input.policy.onPackagePermissionRequest(async (call) => {
    const results = await run("PermissionRequest", call.sessionID, {}, call)
    const allowed = results.filter(
      (result) =>
        result.output &&
        record(result.output.hookSpecificOutput) &&
        record(result.output.hookSpecificOutput.decision) &&
        result.output.hookSpecificOutput.decision.behavior === "allow",
    )
    if (allowed.length)
      await input.policy.bindPackageHook(call, "allow", () => allowed.every((result) => result.valid()))
    const contexts = results.filter((result) => result.text)
    if (contexts.length)
      promptContexts.set(call.sessionID, [...(promptContexts.get(call.sessionID) ?? []), ...contexts])
  })
  await context.tool.hook("execute.before", async (event) => {
    const results = await run("PreToolUse", event.sessionID, {}, event)
    for (const result of results) {
      const specific =
        result.output && record(result.output.hookSpecificOutput) ? result.output.hookSpecificOutput : undefined
      if (!record(specific?.updatedInput)) continue
      const source = await input.policy.packageToolCall(event.tool, specific.updatedInput, {}, "runtime")
      event.input = source.input
    }
    const decisions = results.flatMap((result) => {
      const specific =
        result.output && record(result.output.hookSpecificOutput) ? result.output.hookSpecificOutput : undefined
      const decision = specific?.permissionDecision ?? result.output?.decision
      return decision === "allow" || decision === "ask" ? [{ result, decision }] : []
    })
    const decision = decisions.some((item) => item.decision === "ask") ? "ask" : decisions.length ? "allow" : undefined
    if (decision)
      await input.policy.bindPackageHook(event, decision, () => decisions.every((item) => item.result.valid()))
    const contexts = results.filter((result) => result.text)
    if (contexts.length)
      promptContexts.set(event.sessionID, [...(promptContexts.get(event.sessionID) ?? []), ...contexts])
  })
  await context.tool.hook("execute.after", async (event) => {
    const contexts =
      event.status === "completed"
        ? await run(
            "PostToolUse",
            event.sessionID,
            { tool_response: event.result.output ?? event.result.content },
            event,
          )
        : await run(
            "PostToolUseFailure",
            event.sessionID,
            { error: event.error.message, is_interrupt: event.error.name === "AbortError" },
            event,
          )
    if (contexts.length)
      promptContexts.set(event.sessionID, [...(promptContexts.get(event.sessionID) ?? []), ...contexts])
  })
  await context.session.hook("prompt", async (event) => {
    if (departed.delete(event.sessionID)) starts.delete(event.sessionID)
    preparing.add(event.sessionID)
    try {
      if (!sessionEpoch.has(event.sessionID)) sessionEpoch.set(event.sessionID, {})
      if (!batches.has(event.sessionID)) await rememberBatches(event.sessionID)
      continued.delete(event.sessionID)
      stopTurns.delete(event.sessionID)
      promptEpoch.set(event.sessionID, (promptEpoch.get(event.sessionID) ?? 0) + 1)
      promptContexts.set(event.sessionID, failures.get(event.sessionID) ?? [])
      failures.delete(event.sessionID)
      await preparePrompt?.(event)
      const pending = expansions.get(event.messageID)
      expansions.delete(event.messageID)
      if (pending?.length)
        promptContexts.set(event.sessionID, [...(promptContexts.get(event.sessionID) ?? []), ...pending])
      reconcileFileWatches(event.sessionID)
      await startSession(event.sessionID, event.messageID)
      startMonitors(event.sessionID)
      const contexts = children.has(event.sessionID) ? [] : await run("UserPromptSubmit", event.sessionID, {
        prompt: event.prompt.text ?? "",
        prompt_id: event.messageID,
      })
      promptContexts.set(event.sessionID, [...(promptContexts.get(event.sessionID) ?? []), ...contexts])
    } catch (error) {
      preparing.delete(event.sessionID)
      await finishDeparted(event.sessionID)
      throw error
    } finally { preparing.delete(event.sessionID) }
  })
  await context.session.hook("context", async (event) => {
    const contexts = await drainToolBatches(event.sessionID)
    promptContexts.set(event.sessionID, [...(promptContexts.get(event.sessionID) ?? []), ...contexts])
    const blocked = contexts.find(result => result.block && result.valid())
    if (blocked) throw Error("runtime-failed: package hook blocked PostToolBatch" + (blocked.text ? ": " + blocked.text : ""))
    revoke()
    const stopped = stopTurns.get(event.sessionID)
    stopTurns.delete(event.sessionID)
    if (stopped && stopped.valid() && stopped.lifetime === sessionEpoch.get(event.sessionID))
      throw Error("runtime-failed: package hook blocked this turn: " + stopped.text)
    for (const contribution of [
      sessionContexts.get(event.sessionID) ?? [],
      promptContexts.get(event.sessionID) ?? [],
    ].flatMap((values) => values.toSorted((left, right) => left.order - right.order)))
      if (contribution.valid() && contribution.lifetime === sessionEpoch.get(event.sessionID))
        event.system.push({
          type: "text",
          text: renderWrapper(PACKAGE_HOOK_CONTEXT_ID, {
            label: contribution.installed.description.name,
            body: contribution.text,
          }),
        })
  })
  await context.session.hook("experimental.idle", async (event) => {
    continuing.delete(event.sessionID)
    const contexts = await drainToolBatches(event.sessionID)
    promptContexts.set(event.sessionID, [...(promptContexts.get(event.sessionID) ?? []), ...contexts])
    const stopped = contexts.find(result => result.stopTurn && result.valid())
    if (stopped) throw Error("runtime-failed: package prompt hook stopped this turn: " + stopped.text)
    const blocked = contexts.filter(result => (result.block || result.text) && result.valid())
    if (blocked.length) {
      continued.add(event.sessionID)
      continuing.add(event.sessionID)
      await context.session.synthetic({ sessionID: event.sessionID, text: blocked.map(result => result.text).join("\n"), resume: true })
      return
    }
    if (
      !allInstalledPluginPackages(input.root)
        .filter(active)
        .some((installed) =>
          installed.description.entries.some(
            (entry) =>
              entry.kind === "hook" &&
              pluginEntryRuntimeAvailable(entry) &&
              ["Stop", "SubagentStop"].includes(entry.hook.event),
          ),
        )
    )
      return
    const session = await context.session.get({ sessionID: event.sessionID })
    const results = await run(children.has(session.id) ? "SubagentStop" : "Stop", event.sessionID, {
      background_tasks: event.background,
      session_crons: [],
    })
    const blocking = results.filter((result) => result.block)
    if (!blocking.length) return
    continued.add(event.sessionID)
    continuing.add(event.sessionID)
    await context.session.synthetic({
      sessionID: event.sessionID,
      text: blocking.map((result) => result.text).join("\n"),
      resume: true,
    })
  })
  return {
    async instructionEnvironment(sessionID: string, item: Instruction, allowed: () => boolean) {
      const starting = startSession(sessionID)
      const lifetime = sessionEpoch.get(sessionID)!
      const valid = () => allowed() && sessionEpoch.get(sessionID) === lifetime
      await starting
      if (!valid()) throw Error("runtime-failed: package invocation ended before instruction rendering")
      const file = environmentFile(sessionID, lifetime, false)
      if (!file) return {}
      const controller = new AbortController()
      running.set(controller, { sessionID, valid, kind: "decision" })
      try {
        const variables = await processes.environment({ source: processSource(item.installed, { item }), environment: { CLAUDE_ENV_FILE: undefined }, environmentFile: file, signal: controller.signal })
        if (!valid()) throw Error("runtime-failed: package invocation ended before instruction rendering")
        return variables
      } finally {
        running.delete(controller)
      }
    },
    async receiveSession(message: PackageSessionMessage) {
      const session = await context.session.get({ sessionID: message.sessionId }).catch(() => undefined)
      if (!session || session.location.directory !== context.location.directory) return false
      if (message.action === "leave") await endSession(message.sessionId, message.reason)
      if (message.action === "notification") await run("Notification", message.sessionId, {
        message: message.notification.message, notification_type: message.notification.notificationType,
        ...(message.notification.title === undefined ? {} : { title: message.notification.title }),
      })
      return true
    },
    continuesTask(sessionID: string) {
      return continuing.has(sessionID)
    },
    onPrompt(handler: NonNullable<typeof preparePrompt>) {
      preparePrompt = handler
      return () => {
        if (preparePrompt === handler) preparePrompt = undefined
      }
    },
    activateInstruction(sessionID: string, item: Instruction, allowed: () => boolean) {
      if (!sessionEpoch.has(sessionID)) sessionEpoch.set(sessionID, {})
      const scopes = instructions.get(sessionID) ?? new Map<string, InstructionScope>()
      const id = item.installed.key + ":" + item.entry.id
      const scope = { item, active: allowed }
      scopes.set(id, scope)
      instructions.set(sessionID, scopes)
      if (allowed()) { reconcileFileWatches(sessionID); startMonitors(sessionID, scope) }
      return () => {
        if (scopes.get(id) === scope) scopes.delete(id)
        revoke()
      }
    },
    async beforeExpansion(
      sessionID: string,
      item: Instruction,
      args: string,
      messageID: string | undefined,
      allowed: () => boolean,
    ) {
      await startSession(sessionID, messageID)
      const results = await run(
        "UserPromptExpansion",
        sessionID,
        {
          command_name: sourceInstructionName(item),
          args,
          source: "plugin",
          expansion_type: item.entry.kind === "command" ? "command" : "skill",
          ...(messageID ? { prompt_id: messageID } : {}),
        },
        undefined,
        { item, active: allowed },
      )
      if (messageID) expansions.set(messageID, [...(expansions.get(messageID) ?? []), ...results])
      return results
        .map((result) =>
          renderWrapper(PACKAGE_HOOK_CONTEXT_ID, { label: result.installed.description.name, body: result.text }),
        )
        .join("\n")
    },
    dispose: async () => {
      await Promise.all([...sessionEpoch.keys()].map(sessionID => endSession(sessionID, "other").catch(error => input.log("runtime-failed: package SessionEnd cleanup: " + String(error)))))
      for (const sessionID of sessionEpoch.keys()) close(sessionID)
      disposed = true
      runtime.dispose()
      configResults.clear()
      batches.clear()
      children.clear()
      monitors.clear()
      for (const sessionID of fileWatches.keys()) closeFileWatches(sessionID)
      dynamicWatches.clear()
      releasePermissionRequest()
      events.abort()
      unwatchFile(membership, revoke)
      for (const pointer of observed) unwatchFile(pointer, revoke)
      for (const controller of running.keys()) controller.abort()
      // The host closes the Location stream scope after plugin cleanup; joining it here blocks that close.
      void subscription
      await processes.dispose()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
