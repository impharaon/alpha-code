import { MAX_STEPS_PROMPT } from "../../core/src/session/runner/max-steps"
import { Glob } from "../../util/src/glob"
import type { Schema } from "effect"
import type { Plugin } from "@opencode/plugin"
import type { AgentEditor } from "@opencode/plugin/promise/agent"
import type { Info, ToolContext } from "@opencode/plugin/promise/tool"
import type { PackageHookRuntime } from "./plugin-package-hooks"
import { SessionMessage } from "../../schema/src/session-message"
import type { PolicyRegistration } from "./policy/index"
import { renderPackageInstruction } from "@opencode/plugin/codepuppy-package-runtime"
import { pluginInstructionDefinition } from "../../ui-mac/src/shared/host-extension-package-contract/plugin-conversion.mjs"
import { pluginText, renderPluginText } from "../../ui-mac/src/shared/host-extension-package-contract/plugin-package"
import { pluginDataDirectory, publicPluginOption } from "../../ui-mac/src/shared/installed-plugin-settings"
import { allInstalledPluginInstructions, installedPluginPackage } from "./plugin-package-skills"
import { managedPackageEntryAllowedHere, managedSkillAllowedHere, managedMcpAllowedHere } from "./package-scope"
import { readPackageAllowSet } from "./gen-skill-paths"
import { resolvePackageModel, packageEffortVariant } from "./model-facts"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, realpathSync, watchFile, unwatchFile } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { PACKAGE_MEMORY_ID, PACKAGE_PARTIAL_ID, renderTemplate, renderWrapper } from "./context-injection"

type Instruction = ReturnType<typeof allInstalledPluginInstructions>[number]
type Scope = {
  item: Instruction
  text: string
  pendingPrompt: boolean
  via: "command" | "tool" | "task" | "path" | "attachment"
  dispose: () => void
  partial: boolean
}
const record = (input: unknown): input is Record<string, unknown> =>
  !!input && typeof input === "object" && !Array.isArray(input)

/** One invocation path; the engine still owns skill loading, delegation, model execution and permissions. */
export async function registerPackageInvocations(
  context: Plugin.Context,
  input: {
    root: string
    projectRoot: () => string | undefined
    policy: PolicyRegistration
    hooks: PackageHookRuntime
    log: (line: string) => void
  },
) {
  let disposed = false
  const scopes = new Map<string, Map<string, Scope>>()
  const known = new Map<string, Instruction>()
  const instructions = () => {
    const items = allInstalledPluginInstructions(input.root)
    for (const item of items) known.set(item.entry.kind + ":" + item.name, item)
    return items
  }
  const allowed = (item: Instruction) => {
    if (disposed) return false
    const current = installedPluginPackage(input.root, item.installed.key)
    if (current?.pluginRoot !== item.installed.pluginRoot) return false
    const membership = readPackageAllowSet(input.root)
    return item.entry.kind === "skill"
      ? managedSkillAllowedHere({ key: "skill--" + item.name, name: item.name }, membership, input.projectRoot())
      : managedPackageEntryAllowedHere(item.entry.kind, item.name, membership, input.projectRoot())
  }
  const requireActive = (item: Instruction) => {
    if (!allowed(item))
      throw new Error("runtime-failed: package entry is disabled or unavailable: " + item.entry.sourceName)
  }
  const clear = (sessionID: string) => {
    for (const scope of scopes.get(sessionID)?.values() ?? []) scope.dispose()
    scopes.delete(sessionID)
    input.policy.clearPackageInvocation(sessionID)
  }
  const bindings = (item: Instruction) =>
    Object.fromEntries(
      item.installed.description.entries.flatMap((entry) => {
        const host = item.installed.hostNames[entry.id]
        return host ? [[entry.kind + "::" + entry.sourceName, entry.kind === "skill" ? "skill--" + host : host]] : []
      }),
    )
  const textBindings = (item: Instruction) => ({
    pluginRoot: item.installed.pluginRoot,
    skillDir:
      item.entry.kind === "skill"
        ? join(item.installed.pluginRoot, item.entry.directory)
        : dirname(join(item.installed.pluginRoot, item.entry.sourcePath)),
    projectDir: input.projectRoot() ?? context.location.directory,
    pluginData: item.installed.settings
      ? pluginDataDirectory(item.installed.settings.dataHome, item.installed.settings.packageId)
      : undefined,
    resolveOption: (key: string) => publicPluginOption(item.installed.description, item.installed.settings, key),
  })
  const invocationRules = (item: Instruction) => {
    const rules = (values: Instruction["entry"]["invocation"]["allowedTools"]) =>
      values.map((rule) =>
        rule.pattern === undefined
          ? rule
          : { ...rule, pattern: renderPluginText(pluginText(rule.pattern), textBindings(item)) },
      )
    return {
      ...item.entry.invocation,
      allowedTools: rules(item.entry.invocation.allowedTools),
      deniedTools: rules(item.entry.invocation.deniedTools),
      ...(item.entry.invocation.availableTools ? { availableTools: rules(item.entry.invocation.availableTools) } : {}),
    }
  }
  const bind = (sessionID: string, item: Instruction, text: string, via: Scope["via"]) => {
    const id = item.installed.key + ":" + item.entry.id
    const current = scopes.get(sessionID) ?? new Map<string, Scope>()
    current.get(id)?.dispose()
    const releasePolicy = input.policy.bindPackageInvocation(sessionID, invocationRules(item), bindings(item), () =>
      allowed(item),
    )
    const releaseHooks = input.hooks.activateInstruction(sessionID, item, () => allowed(item))
    const dispose = () => {
      releaseHooks()
      releasePolicy()
    }
    const scope: Scope = {
      item,
      text,
      pendingPrompt: via === "command" || via === "task",
      via,
      dispose,
      partial: false,
    }
    current.set(id, scope)
    scopes.set(sessionID, current)
    return scope
  }
  const prepared = async (
    item: Instruction,
    rawArguments: string,
    ancestors: ReadonlySet<string> = new Set(),
  ): Promise<string> => {
    const key = item.installed.key + ":" + item.entry.id
    if (ancestors.has(key)) throw new Error("dependency_missing: cyclic preload skill " + item.entry.sourceName)
    const visited = new Set([...ancestors, key])
    requireActive(item)
    if (item.entry.kind === "skill") {
      const servers = (await context.mcp.list()).data
      for (const dependency of item.entry.mcpDependencies) {
        const host = bindings(item)["mcp::" + dependency] ?? dependency
        if (
          !servers.some((server) => server.name === host) ||
          !managedMcpAllowedHere(host, readPackageAllowSet(input.root), input.projectRoot())
        )
          throw new Error("dependency_missing: MCP " + dependency + " for " + item.entry.sourceName)
      }
    }
    const paths = textBindings(item)
    const body = pluginInstructionDefinition(item.entry.instruction).body
    const text = await renderPackageInstruction(context.location, {
      parts: body.map((part) => (typeof part === "string" ? part : { boundValue: renderPluginText([part], paths) })),
      syntax: item.entry.invocation.argumentSyntax,
      arguments: item.entry.invocation.arguments,
      rawArguments,
      cwd: context.location.directory,
    })
    requireActive(item)
    const preload: string[] = []
    for (const source of item.entry.invocation.preloadSkills) {
      const skill = instructions().find(
        (candidate) =>
          candidate.entry.kind === "skill" &&
          candidate.installed.key === item.installed.key &&
          candidate.entry.sourceName === source,
      )
      if (skill) {
        if (!skill.entry.invocation.implicitInvocation)
          throw new Error("dependency_missing: preload skill is manual-only: " + source)
        preload.push(await prepared(skill, "", visited))
        continue
      }
      const managed = (await context.skill.list()).data.find((skill) => skill.id === source || skill.name === source)
      if (!managed || managed.autoinvoke === false) throw new Error("dependency_missing: preload skill " + source)
      preload.push(managed.content)
    }
    return [text, ...preload].join("\n\n")
  }
  const memory = async (scope: Scope, toolContext: ToolContext, read: Info | undefined) => {
    const mode = scope.item.entry.invocation.memory
    if (!mode) return
    const project = realpathSync(input.projectRoot() ?? context.location.directory)
    const settings = scope.item.installed.settings
    if (!settings) throw new Error("dependency_missing: package DATA for " + scope.item.entry.sourceName)
    const root =
      mode === "project"
        ? join(project, ".codepuppy", "agent-memory", scope.item.installed.key, scope.item.name)
        : join(
            pluginDataDirectory(settings.dataHome, settings.packageId),
            "agent-memory",
            scope.item.name,
            mode,
            ...(mode === "local" ? [createHash("sha256").update(project).digest("hex")] : []),
          )
    mkdirSync(root, { recursive: true })
    const file = join(root, "MEMORY.md")
    const guide = (body: string) => renderWrapper(PACKAGE_MEMORY_ID, { label: file, body })
    if (!existsSync(file)) {
      scope.text += "\n\n" + guide("")
      return
    }
    if (!read) throw new Error("dependency_missing: read tool for agent memory")
    await context.permission.assert({
      sessionID: toolContext.sessionID,
      agent: toolContext.agent,
      action: "read",
      resources: [file],
      save: [],
      metadata: {},
    })
    const result = await read.execute({ path: file }, toolContext)
    scope.text += "\n\n" + guide(typeof result.content === "string" ? result.content : JSON.stringify(result.output))
  }
  const tools = new Map<string, Info>()
  const manualContext = async (
    sessionID: Parameters<Plugin.Context["session"]["get"]>[0]["sessionID"],
  ): Promise<ToolContext> => {
    const session = await context.session.get({ sessionID })
    const agent = session.agent ?? (await context.agent.list()).data[0]?.id
    if (!agent) throw new Error("dependency_missing: default agent")
    return {
      sessionID: sessionID as ToolContext["sessionID"],
      agent: agent as ToolContext["agent"],
      messageID: "msg_package_instruction" as ToolContext["messageID"],
      id: "call_package_instruction" as ToolContext["id"],
      signal: new AbortController().signal,
      progress: async () => {},
    }
  }
  const delegate = async (
    item: Instruction,
    rawArguments: string,
    prompt: string,
    toolContext: ToolContext,
    via: "command" | "tool",
    incoming: Record<string, unknown> = {},
    expansion = "",
  ) => {
    requireActive(item)
    const original = tools.get("subagent")
    if (!original) throw new Error("dependency_missing: subagent runtime")
    const parent = await context.session.get({ sessionID: toolContext.sessionID })
    const named = item.entry.invocation.agent
    const target =
      item.entry.kind === "agent"
        ? item.name
        : named
          ? (instructions().find(
              (candidate) =>
                candidate.entry.kind === "agent" &&
                candidate.installed.key === item.installed.key &&
                candidate.entry.sourceName === named,
            )?.name ?? named)
          : "general"
    if (via === "command")
      await context.permission.assert({
        sessionID: parent.id,
        agent: toolContext.agent,
        action: "subagent",
        resources: [target],
        save: [],
        metadata: {},
      })
    const sourceModel =
      typeof incoming.model === "string"
        ? incoming.model
        : parent.model
          ? `${parent.model.providerID}/${parent.model.id}${parent.model.variant && parent.model.variant !== "default" ? "#" + parent.model.variant : ""}`
          : await resolvePackageModel(context, item.entry.invocation.model, input.log)
    const background =
      item.entry.invocation.background ??
      (typeof incoming.background === "boolean"
        ? incoming.background
        : item.installed.description.provider === "claude-code" && (!parent.parentID || item.entry.kind === "skill"))
    const text = [expansion, await prepared(item, rawArguments)].filter(Boolean).join("\n\n")
    const forwarded: Record<string, unknown> = {
      ...incoming,
      agent: target,
      description: typeof incoming.description === "string" ? incoming.description : item.entry.sourceName,
      prompt: prompt || rawArguments || item.entry.sourceName,
      background,
      ...(sourceModel ? { model: sourceModel } : {}),
    }
    const { arguments: _arguments, ...forwardedInput } = forwarded
    let childScope: Scope | undefined
    const result = await original.execute(forwardedInput, {
      ...toolContext,
      progress: async (update) => {
        if (typeof update.sessionID === "string" && !childScope) {
          childScope = bind(update.sessionID, item, text, "task")
          await memory(
            childScope,
            {
              ...toolContext,
              sessionID: update.sessionID as ToolContext["sessionID"],
              agent: target as ToolContext["agent"],
            },
            tools.get("read"),
          )
        }
        await toolContext.progress(update)
      },
    })
    if (!childScope?.partial) return result
    const note = renderTemplate(PACKAGE_PARTIAL_ID, {
      name:
        "source maxTurns=" +
        item.entry.invocation.maxTurns +
        ", sessionID=" +
        (record(result.output) ? String(result.output.sessionID) : ""),
    })
    return {
      ...result,
      content: note + "\n" + (typeof result.content === "string" ? result.content : ""),
      metadata: { ...result.metadata, partial: true },
    }
  }
  const transformAgents = (editor: AgentEditor) => {
    for (const item of instructions()) {
      if (item.entry.kind !== "agent") continue
      if (!allowed(item)) {
        editor.remove(item.name)
        continue
      }
      input.policy.bindPackageAgent(item.name, invocationRules(item), bindings(item))
      editor.update(item.name, (agent) => {
        agent.mode = "subagent"
        agent.hidden = false
        const definition = pluginInstructionDefinition(item.entry.instruction)
        agent.description = definition.description
        // The context hook inserts the rendered body only for this child invocation.
        agent.system = ""
        if (item.entry.invocation.maxTurns !== undefined) agent.steps = item.entry.invocation.maxTurns
      })
    }
  }
  await context.agent.transform(transformAgents)
  await context.command.transform((editor) => {
    for (const item of instructions()) {
      if (item.entry.kind === "agent" || !item.entry.invocation.userInvocable || !allowed(item)) continue
      editor.add({
        name: item.name,
        description: pluginInstructionDefinition(item.entry.instruction).description,
        execute: async (invocation) => {
          requireActive(item)
          const frame = await manualContext(invocation.sessionID)
          if (item.entry.invocation.fork || item.entry.invocation.agent) {
            const expansion = await input.hooks.beforeExpansion(
              invocation.sessionID,
              item,
              invocation.prompt.text,
              undefined,
              () => allowed(item),
            )
            await delegate(item, invocation.prompt.text, "", frame, "command", {}, expansion)
            return
          }
          const messageID = SessionMessage.ID.create()
          const scope = bind(invocation.sessionID, item, "", "command")
          let text: string
          try {
            await input.hooks.beforeExpansion(invocation.sessionID, item, invocation.prompt.text, messageID, () =>
              allowed(item),
            )
            text = await prepared(item, invocation.prompt.text)
            scope.text = text
          } catch (error) {
            scope.dispose()
            if (scopes.get(invocation.sessionID)?.get(item.installed.key + ":" + item.entry.id) === scope)
              scopes.get(invocation.sessionID)?.delete(item.installed.key + ":" + item.entry.id)
            throw error
          }
          const session = await context.session.get({ sessionID: invocation.sessionID })
          const suggestion =
            !session.model && (await resolvePackageModel(context, item.entry.invocation.model, input.log))
          if (suggestion) {
            const [providerID, ...id] = suggestion.split("/")
            await context.session.switchModel({
              sessionID: invocation.sessionID,
              model: { providerID, id: id.join("/") } as never,
            })
          }
          await context.session.prompt({
            ...invocation.prompt,
            sessionID: invocation.sessionID,
            id: messageID,
            text,
            delivery: invocation.delivery,
          })
        },
      })
    }
  })
  const { Schema } = await import("effect")
  await context.tool.transform((editor) => {
    for (const tool of editor.list())
      if (["skill", "subagent", "read"].includes(tool.id)) tools.set(tool.id, { ...tool })
    for (const name of ["skill", "subagent"])
      editor.update(name, (tool) => {
        const original = tool.execute
        if (!Schema.isSchema(tool.input) || !("fields" in tool.input)) {
          input.log("runtime-failed: native " + name + " input schema unavailable")
          return
        }
        tool.input = Schema.Struct({
          ...(tool.input.fields as Record<string, Schema.Top>),
          arguments: Schema.optionalKey(Schema.String),
        })
        tool.execute = async (value, frame) => {
          const data = record(value) ? value : {}
          const parent = [...(scopes.get(frame.sessionID)?.values() ?? [])].at(-1)?.item
          const source =
            typeof data[name === "skill" ? "id" : "agent"] === "string"
              ? String(data[name === "skill" ? "id" : "agent"])
              : ""
          const listed = name === "skill" ? (await context.skill.list()).data : []
          const selected = listed.find((skill) => skill.id === source)
          const item = instructions().find(
            (candidate) =>
              candidate.entry.kind === (name === "skill" ? "skill" : "agent") &&
              (candidate.name === source ||
                (name === "skill" &&
                  selected?.path === join(candidate.installed.pluginRoot, candidate.entry.sourcePath)) ||
                (parent?.installed.key === candidate.installed.key && candidate.entry.sourceName === source)),
          )
          if (!item) {
            const stale = known.get((name === "skill" ? "skill" : "agent") + ":" + source.replace(/^skill--/, ""))
            if (stale) requireActive(stale)
            return original(value, frame)
          }
          requireActive(item)
          const rawArguments = typeof data.arguments === "string" ? data.arguments : ""
          if (name === "subagent")
            return delegate(item, rawArguments, typeof data.prompt === "string" ? data.prompt : "", frame, "tool", data)
          if (
            !item.entry.invocation.implicitInvocation &&
            ![...(scopes.get(frame.sessionID)?.values() ?? [])].some(
              (scope) =>
                scope.item.installed.key === item.installed.key &&
                scope.item.entry.id === item.entry.id &&
                ["command", "attachment"].includes(scope.via),
            )
          )
            throw new Error("runtime-failed: skill requires an explicit invocation: " + item.entry.sourceName)
          const loaded = await original({ ...data, id: selected?.id ?? "skill--" + item.name }, frame)
          if (item.entry.invocation.fork || item.entry.invocation.agent)
            return delegate(item, rawArguments, "", frame, "tool")
          const text = await prepared(item, rawArguments)
          bind(frame.sessionID, item, text, "tool")
          const body = selected?.content.trim()
          const replace = (content: string) => (body ? content.replace(body, () => text) : text)
          return {
            ...loaded,
            ...(record(loaded.output) && typeof loaded.output.output === "string"
              ? { output: { ...loaded.output, output: replace(loaded.output.output) } }
              : {}),
            ...(typeof loaded.content === "string" ? { content: replace(loaded.content) } : {}),
          }
        }
      })
  })
  const releasePrompt = input.hooks.onPrompt(async (event) => {
    for (const scope of scopes.get(event.sessionID)?.values() ?? []) {
      if (scope.pendingPrompt) {
        scope.pendingPrompt = false
        continue
      }
      if (scope.via !== "task") {
        scope.dispose()
        scopes.get(event.sessionID)?.delete(scope.item.installed.key + ":" + scope.item.entry.id)
      }
    }
    for (const attachment of event.prompt.skills ?? []) {
      const listed = (await context.skill.list()).data.find((skill) => skill.id === attachment.id)
      const item = instructions().find(
        (candidate) =>
          candidate.entry.kind === "skill" &&
          listed?.path === join(candidate.installed.pluginRoot, candidate.entry.sourcePath),
      )
      if (!item) continue
      const scope = bind(event.sessionID, item, "", "attachment")
      try {
        await input.hooks.beforeExpansion(event.sessionID, item, "", event.messageID, () => allowed(item))
        scope.text = await prepared(item, "")
      } catch (error) {
        scope.dispose()
        scopes.get(event.sessionID)?.delete(item.installed.key + ":" + item.entry.id)
        throw error
      }
      event.prompt.skills = event.prompt.skills?.filter((skill) => skill.id !== attachment.id)
    }
  })
  await context.session.hook("context", async (event) => {
    const active = [...(scopes.get(event.sessionID)?.values() ?? [])]
    for (const scope of active) {
      requireActive(scope.item)
      const last = event.messages.at(-1)
      if (
        scope.item.entry.invocation.maxTurns !== undefined &&
        last?.role === "assistant" &&
        last.content.some((part) => part.type === "text" && part.text === MAX_STEPS_PROMPT)
      )
        scope.partial = true
      if (["task", "path", "attachment"].includes(scope.via)) event.system.push({ type: "text", text: scope.text })
    }
    const scope = active.findLast((scope) => scope.item.entry.invocation.effort)
    if (
      (event.model.variant !== undefined && event.model.variant !== "default") ||
      !scope?.item.entry.invocation.effort
    )
      return
    const variant = await packageEffortVariant(context, event.model, scope.item.entry.invocation.effort, input.log)
    if (variant?.settings) Object.assign(event.options, variant.settings)
  })
  await context.session.hook("http.request", async (event) => {
    const scope = [...(scopes.get(event.sessionID)?.values() ?? [])].findLast(
      (scope) => scope.item.entry.invocation.effort,
    )
    if (
      !scope?.item.entry.invocation.effort ||
      (event.model.variant !== undefined && event.model.variant !== "default") ||
      event.kind !== "primary"
    )
      return
    requireActive(scope.item)
    const variant = await packageEffortVariant(context, event.model, scope.item.entry.invocation.effort, input.log)
    if (variant?.headers)
      for (const [name, value] of Object.entries(variant.headers)) event.request.headers.set(name, value)
    if (!variant?.body) return
    const body: unknown = await event.request.clone().json()
    if (!record(body)) throw new Error("runtime-failed: reasoning variant requires a JSON model request")
    const apply = (target: Record<string, unknown>, overlay: Readonly<Record<string, unknown>>) => {
      for (const [key, value] of Object.entries(overlay)) {
        const before = target[key]
        if (record(before) && record(value)) {
          apply(before, value)
          continue
        }
        target[key] = value
      }
    }
    apply(body, variant.body)
    event.request = new Request(event.request, { body: JSON.stringify(body) })
  })
  await context.session.hook("experimental.idle", (event) => {
    if (!input.hooks.continuesTask(event.sessionID)) clear(event.sessionID)
  })
  await context.tool.hook("execute.after", async (event) => {
    if (event.status !== "completed" || !["read", "edit", "write"].includes(event.tool) || !record(event.input)) return
    const raw = event.input.path ?? event.input.filePath ?? event.input.file_path
    if (typeof raw !== "string") return
    const root = input.projectRoot() ?? context.location.directory
    const file = relative(root, isAbsolute(raw) ? raw : resolve(context.location.directory, raw))
      .split("\\")
      .join("/")
    if (file === ".." || file.startsWith("../")) return
    for (const item of instructions()) {
      if (
        item.entry.kind !== "skill" ||
        !item.entry.invocation.implicitInvocation ||
        !item.entry.invocation.paths.length ||
        !allowed(item)
      )
        continue
      if (!item.entry.invocation.paths.some((pattern) => Glob.match(pattern, file))) continue
      const current = scopes.get(event.sessionID)?.get(item.installed.key + ":" + item.entry.id)
      if (current && allowed(current.item)) continue
      const text = await prepared(item, "")
      bind(event.sessionID, item, text, "path")
    }
  })
  const membershipFile = join(input.root, "skills-enabled.json")
  const revoke = async () => {
    for (const [sessionID, entries] of scopes)
      for (const [key, scope] of entries) {
        if (allowed(scope.item)) continue
        if (scope.via === "task") await context.session.interrupt({ sessionID: sessionID as ToolContext["sessionID"] })
        scope.dispose()
        entries.delete(key)
      }
  }
  const changed = () => {
    void revoke().catch((cause) => input.log("runtime-failed: package invocation cancellation: " + String(cause)))
  }
  watchFile(membershipFile, { interval: 100, persistent: false }, changed)
  return {
    transformAgents,
    dispose: async () => {
      disposed = true
      releasePrompt()
      unwatchFile(membershipFile, changed)
      await revoke()
      for (const sessionID of scopes.keys()) clear(sessionID)
    },
  }
}
