import type { PolicyRegistration } from "./policy/index"
import type { GateCall } from "./policy/gate"
import type { Plugin } from "@opencode/plugin"
import type { HookEvent } from "../../ui-mac/src/shared/host-extension-package-contract/plugin-package"
import { pluginToolRules } from "../../ui-mac/src/shared/host-extension-package-contract/plugin-conversion.mjs"
import { match } from "../../core/src/util/wildcard"
import { INSTALLED_PLUGIN_SETTINGS_FILE } from "../../ui-mac/src/shared/installed-plugin-settings"
import { pluginEntryRuntimeAvailable } from "../../ui-mac/src/shared/plugin-package-runtime"
import { codepuppyCredential } from "../../util/src/codepuppy-credentials"
import { allInstalledPluginPackages, installedPluginPackage } from "./plugin-package-skills"
import { readPackageAllowSet } from "./gen-skill-paths"
import { managedPackageEntryAllowedHere } from "./package-scope"
import { createPackageProcesses } from "./plugin-package-process"
import { pluginProcessConfig } from "../../ui-mac/src/shared/plugin-mcp-config"
import { resolvePackageModel } from "./model-facts"
import { ASK_AGENT, READONLY_AGENT } from "../../ui-mac/src/shared/permission-tier"
import { PACKAGE_HOOK_CONTEXT_ID, renderWrapper } from "./context-injection"
import { mkdtempSync, writeFileSync, chmodSync, rmSync, watchFile, unwatchFile } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"

type Installed = ReturnType<typeof allInstalledPluginPackages>[number]
type Contribution = {
  installed: Installed
  text: string
  order: number
  sessionID: string
  lifetime: object
  block?: boolean
  stopTurn?: boolean
  output?: Record<string, unknown>
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

export async function registerPackageHooks(
  context: Plugin.Context,
  input: { root: string; projectRoot(): string | undefined; log(line: string): void; policy: PolicyRegistration },
) {
  const processes = createPackageProcesses(context.location)
  const directory = mkdtempSync(join(tmpdir(), "codepuppy-plugin-session-"))
  const created = new Set<string>()
  const continued = new Set<string>()
  const starts = new Map<string, Promise<void>>()
  const sessionContexts = new Map<string, Contribution[]>()
  const promptContexts = new Map<string, Contribution[]>()
  const stopTurns = new Map<string, Contribution>()
  const running = new Map<AbortController, { installed: Installed; sessionID: string }>()
  const observed = new Set<string>()
  const promptEpoch = new Map<string, number>()
  const sessionEpoch = new Map<string, object>()
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
    for (const [controller, owner] of running) if (!active(owner.installed)) controller.abort()
    for (const contexts of [sessionContexts, promptContexts])
      for (const [sessionID, values] of contexts)
        contexts.set(
          sessionID,
          values.filter((value) => active(value.installed) && value.lifetime === sessionEpoch.get(value.sessionID)),
        )
  }
  const membership = join(input.root, "skills-enabled.json")
  watchFile(membership, { interval: 100, persistent: false }, revoke)
  const events = new AbortController()
  const close = (sessionID: string) => {
    sessionEpoch.delete(sessionID)
    promptEpoch.delete(sessionID)
    stopTurns.delete(sessionID)
    for (const [controller, owner] of running) if (owner.sessionID === sessionID) controller.abort()
    continued.delete(sessionID)
    starts.delete(sessionID)
    created.delete(sessionID)
    sessionContexts.delete(sessionID)
    promptContexts.delete(sessionID)
  }
  const subscription = (async () => {
    for await (const event of context.event.subscribe({
      types: ["session.created", "session.archived", "session.deleted"],
      signal: events.signal,
    })) {
      if (event.type === "session.created") created.add(event.data.sessionID)
      else close(event.data.sessionID)
    }
  })().catch((error) => {
    if (!events.signal.aborted) input.log("runtime-failed: package event subscription: " + String(error))
  })
  const run = async (
    event: HookEvent,
    sessionID: Parameters<Plugin.Context["session"]["get"]>[0]["sessionID"],
    fields: Record<string, unknown>,
    call?: GateCall,
  ) => {
    const installed = allInstalledPluginPackages(input.root).filter(active)
    const handlers = installed.flatMap((installed) =>
      installed.description.entries.flatMap((entry) =>
        entry.kind === "hook" && pluginEntryRuntimeAvailable(entry) && entry.hook.event === event
          ? [{ installed, entry, hook: entry.hook }]
          : [],
      ),
    )
    if (!handlers.length) return []
    const lifetime = sessionEpoch.get(sessionID) ?? {}
    sessionEpoch.set(sessionID, lifetime)
    const currentSession = await context.session.get({ sessionID })
    let session = currentSession
    while (session.parentID) session = await context.session.get({ sessionID: session.parentID })
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
    const payload = {
      session_id: sessionID,
      transcript_path: transcript,
      cwd: context.location.directory,
      permission_mode:
        session.agent === READONLY_AGENT ? "plan" : session.agent === ASK_AGENT ? "default" : "bypassPermissions",
      hook_event_name: event,
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
        const execute = async () => {
          const controller = new AbortController()
          let redact = (text: string) => text
          running.set(controller, { installed: handler.installed, sessionID })
          for (const file of ["current.json", INSTALLED_PLUGIN_SETTINGS_FILE]) {
            const pointer = join(input.root, "ext-store", handler.installed.key, file)
            if (!observed.has(pointer)) {
              observed.add(pointer)
              watchFile(pointer, { interval: 100, persistent: false }, revoke)
            }
          }
          try {
            if (!active(handler.installed)) return
            const source =
              call &&
              (await input.policy.packageToolCall(
                call.tool,
                call.input,
                Object.fromEntries(
                  handler.installed.description.entries.flatMap((entry) =>
                    entry.kind === "mcp" ? [["mcp::" + entry.sourceName, handler.installed.hostNames[entry.id]!]] : [],
                  ),
                ),
                "claude",
              ))
            const eventFields = source
              ? {
                  ...fields,
                  tool_name: source.name,
                  tool_input: source.input,
                  tool_use_id: call!.id,
                  ...("tool_response" in fields
                    ? {
                        tool_response: (
                          await input.policy.packageToolCall(call!.tool, fields.tool_response, {}, "claude")
                        ).input,
                      }
                    : {}),
                }
              : fields
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
            if (
              handler.hook.matcher &&
              !new RegExp(handler.hook.matcher).test(
                String(
                  eventFields.tool_name ??
                    eventFields.command_name ??
                    eventFields.agent_type ??
                    eventFields.source ??
                    "",
                ),
              )
            )
              return
            if (!handler.installed.settings) throw Error("dependency-missing: package settings")
            const processSource: Parameters<typeof pluginProcessConfig>[0] = {
              description: handler.installed.description,
              settings: handler.installed.settings,
              pluginRoot: handler.installed.pluginRoot,
              projectDir: context.location.directory,
              resolveEnvironment: (name) => process.env[name],
              resolveOptionSecret: (ref) => codepuppyCredential(ref.slice(6, -1)),
              resolveSecret: (id) => {
                const ref = handler.installed.settings?.secretRefs[id]
                return ref ? codepuppyCredential(ref.slice(6, -1)) : undefined
              },
            }
            if (handler.hook.type === "prompt") {
              const config = pluginProcessConfig(processSource)
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
              if (!active(handler.installed) || controller.signal.aborted || sessionEpoch.get(sessionID) !== lifetime)
                return
              const stopping = ["Stop", "SubagentStop"].includes(event)
              return {
                installed: handler.installed,
                block: !judgment.ok && (!stopping || judgment.impossible !== true),
                stopTurn: !judgment.ok && !stopping && !handler.hook.continueOnBlock,
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
            const result = await processes.command({
              source: processSource,
              command: handler.hook.command,
              ...(handler.hook.args === undefined ? {} : { args: handler.hook.args }),
              environment: {},
              signal: controller.signal,
              stdin: { ...payload, ...eventFields },
              timeoutSeconds: handler.hook.timeoutSeconds,
            })
            redact = result.redact
            if (!active(handler.installed) || controller.signal.aborted || sessionEpoch.get(sessionID) !== lifetime)
              return
            if (result.exitCode === 2)
              return {
                installed: handler.installed,
                block: ["UserPromptSubmit", "PreToolUse", "Stop", "SubagentStop"].includes(event),
                exitCode: 2,
                order,
                text: result.stderr,
                sessionID,
                lifetime,
              }
            if (result.exitCode !== 0) throw Error("hook exited " + result.exitCode)
            const output: unknown = result.stdout.trim()
              ? /^[\s]*[\[{]/.test(result.stdout)
                ? JSON.parse(result.stdout)
                : { systemMessage: result.stdout }
              : {}
            if (!record(output)) throw Error("hook output must be an object")
            const specific = record(output.hookSpecificOutput) ? output.hookSpecificOutput : undefined
            return {
              installed: handler.installed,
              block:
                output.continue === false ||
                (["Stop", "SubagentStop", "PreToolUse"].includes(event) && output.decision === "block") ||
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
                  ["Stop", "SubagentStop", "PreToolUse"].includes(event)
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
            if (controller.signal.aborted || !active(handler.installed)) return
            input.log(
              "runtime-failed: hook " +
                handler.entry.id +
                ": " +
                redact(error instanceof Error ? error.message : String(error)),
            )
            return {
              installed: handler.installed,
              block: handler.hook.onFailure === "block",
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
        if (handler.hook.type !== "command" || (!handler.hook.async && !handler.hook.asyncRewake)) return execute()
        void execute()
          .then(async (result) => {
            if (
              !result ||
              !active(result.installed) ||
              (event !== "SessionStart" && promptEpoch.get(sessionID) !== epoch)
            )
              return
            if (sessionEpoch.get(sessionID) !== lifetime) return
            const contexts = event === "SessionStart" ? sessionContexts : promptContexts
            if (result.text) contexts.set(sessionID, [...(contexts.get(sessionID) ?? []), result])
            if (handler.hook.type === "command" && handler.hook.asyncRewake && result.exitCode === 2)
              await context.session.synthetic({ sessionID, text: result.text, resume: true })
          })
          .catch((error) => input.log("runtime-failed: asynchronous package hook: " + String(error)))
        return undefined
      }),
    )
    if (sessionEpoch.get(sessionID) !== lifetime) return []
    const contributions = results.filter(
      (result): result is NonNullable<typeof result> => !!result && active(result.installed),
    )
    const blocked = contributions.find((result) => result.block)
    if (blocked?.stopTurn) stopTurns.set(sessionID, blocked)
    if (blocked && !["Stop", "SubagentStop"].includes(event))
      throw Error("runtime-failed: package hook blocked " + event + (blocked.text ? ": " + blocked.text : ""))
    return contributions
      .filter((result) => result.text || event === "PreToolUse" || event === "PermissionRequest")
      .map((result) => ({
        installed: result.installed,
        text: result.text,
        order: result.order,
        sessionID,
        lifetime,
        block: result.block,
        output: "output" in result ? result.output : undefined,
      }))
  }
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
      await input.policy.bindPackageHook(call, "allow", () => allowed.every((result) => active(result.installed)))
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
      await input.policy.bindPackageHook(event, decision, () =>
        decisions.every((item) => active(item.result.installed)),
      )
    const contexts = results.filter((result) => result.text)
    if (contexts.length)
      promptContexts.set(event.sessionID, [...(promptContexts.get(event.sessionID) ?? []), ...contexts])
  })
  await context.tool.hook("execute.after", async (event) => {
    if (event.status !== "completed") return
    const contexts = await run(
      "PostToolUse",
      event.sessionID,
      { tool_response: event.result.output ?? event.result.content },
      event,
    )
    if (contexts.length)
      promptContexts.set(event.sessionID, [...(promptContexts.get(event.sessionID) ?? []), ...contexts])
  })
  await context.session.hook("prompt", async (event) => {
    continued.delete(event.sessionID)
    stopTurns.delete(event.sessionID)
    promptEpoch.set(event.sessionID, (promptEpoch.get(event.sessionID) ?? 0) + 1)
    promptContexts.delete(event.sessionID)
    if (!starts.has(event.sessionID))
      starts.set(
        event.sessionID,
        run("SessionStart", event.sessionID, { source: created.delete(event.sessionID) ? "startup" : "resume" }).then(
          (contexts) => {
            sessionContexts.set(event.sessionID, [...(sessionContexts.get(event.sessionID) ?? []), ...contexts])
          },
        ),
      )
    await starts.get(event.sessionID)
    const contexts = await run("UserPromptSubmit", event.sessionID, { prompt: event.prompt.text ?? "" })
    promptContexts.set(event.sessionID, [...(promptContexts.get(event.sessionID) ?? []), ...contexts])
  })
  await context.session.hook("context", (event) => {
    revoke()
    const stopped = stopTurns.get(event.sessionID)
    stopTurns.delete(event.sessionID)
    if (stopped && active(stopped.installed) && stopped.lifetime === sessionEpoch.get(event.sessionID))
      throw Error("runtime-failed: package hook blocked this turn: " + stopped.text)
    for (const contribution of [
      sessionContexts.get(event.sessionID) ?? [],
      promptContexts.get(event.sessionID) ?? [],
    ].flatMap((values) => values.toSorted((left, right) => left.order - right.order)))
      if (active(contribution.installed) && contribution.lifetime === sessionEpoch.get(event.sessionID))
        event.system.push({
          type: "text",
          text: renderWrapper(PACKAGE_HOOK_CONTEXT_ID, {
            label: contribution.installed.description.name,
            body: contribution.text,
          }),
        })
  })
  await context.session.hook("experimental.idle", async (event) => {
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
    const results = await run(session.parentID ? "SubagentStop" : "Stop", event.sessionID, {
      background_tasks: event.background,
      session_crons: [],
    })
    const blocking = results.filter((result) => result.block)
    if (!blocking.length) return
    continued.add(event.sessionID)
    await context.session.synthetic({
      sessionID: event.sessionID,
      text: blocking.map((result) => result.text).join("\n"),
      resume: true,
    })
  })
  return async () => {
    disposed = true
    releasePermissionRequest()
    events.abort()
    unwatchFile(membership, revoke)
    for (const pointer of observed) unwatchFile(pointer, revoke)
    for (const controller of running.keys()) controller.abort()
    // The host closes the Location stream scope after plugin cleanup; joining it here blocks that close.
    void subscription
    await processes.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
}
