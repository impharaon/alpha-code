import { PACKAGE_TOOL_DEPENDENCY_ID, renderWrapper } from "../context-injection"
import { canonicalJsonDigest } from "./store"
import { subjectBindingDigest } from "./resolver"
import { packageToolRule, packageToolCall } from "./identity"
import type { Invocation } from "../../../ui-mac/src/shared/host-extension-package-contract/plugin-package"
import { ShellScan } from "../../../core/src/shell/scan"
import { match } from "../../../core/src/util/wildcard"
import { canonicalToolIdentity } from "../../../schema/src/tool-identity"
import { directoryAccessMetadata } from "../../../ui-mac/src/shared/directory-write-approval"
import { documentPythonEnvironmentFor } from "../../../util/src/codepuppy-document"
// Code Puppy tool policy inside the extension (lane seams I3): everything L4 hangs on the OpenCode 2 plugin Context
// goes through `registerPolicy`. The extension's `setup` awaits it first and awaits `seal()` last (L3 owns the call
// sites; `plugin-setup-order.test.ts`).
//
//   registerPolicy (head)                       seal() (tail)
//   ─────────────────────────────────────────   ──────────────────────────────────────────────────────
//   tool.transform   capture early registry     mcp.transform    capture configured servers (after L3's)
//   mcp.transform    `{workspace}` → directory  execute.before   confirm: identity ask, re-decide, pin
//   execute.before   decide: deny first         tool.transform   display snapshot on running calls
//   session.hook     catalog prune / tail rules execute.after    display snapshot on terminal states; network
//                                               layer on a failed call (#1572 AC4)
//   permission.hook  risk facts on every ask; Code Puppy's own asks held against later hooks
//   rpc              codepuppy.tool-policy (I5); the writes go to main over the parent port (I-13, DESIGN-engine-config-fence §4.5)
import { codepuppyBootstrap } from "../../../util/src/codepuppy-bootstrap"
import { type UnattendedDenial, type UnattendedProfile } from "../../../schema/src/codepuppy-unattended"
import type { UnattendedState } from "./unattended"
import os from "node:os"
import path from "node:path"
import type { Plugin } from "@opencode/plugin"
import { createCatalog } from "./catalog"
import { attachDirectoryDisplay, attachUnattendedDenial, attachNetFailure, attachTerminal, attachWriteDenied, displaySnapshot, refusedWriteNote, refusedWritePaths, wrapForDisplay } from "./display"
import { PACKAGE_INVOCATION_ALLOW, PACKAGE_HOOK_DECISION, packageCallAllows, confirm, decide, effectiveFor, gateWithoutToolCall, holdAsk, holdUnattendedDeny, isInstallAsk, deepFreeze, pin, type GateCall, type GateDecision, type GateDeps } from "./gate"
import {
  codeModeFacts,
  CODE_MODE_TOOL,
  extModulePath,
  loadBundledTools,
  toolFacts,
  type RegisteredTool,
  type ToolFacts,
} from "./identity"
import type { PermissionRule } from "./managed"
import { createToolPolicyStore, defaultPolicyBaseDir, type McpEntry, type ToolPolicyWriter } from "./resolver"
import { classifyPermissionRequest, RISK_METADATA_KEY } from "./risk"
import { TOOL_POLICY_RPC_DEFINITION, toolPolicyHandlers } from "./rpc"
import type { ToolDisplaySnapshotV1 } from "../../../schema/src/tool-identity"
import { isCodePuppyPolicyRequest } from "../../../schema/src/codepuppy-tool-policy"
import type { HubBridge, HubInstallSubject } from "../hub-bridge"
import { denyHubMutationForAutomation, hubInstallAsk } from "../hub-tools"
import { createExternalDirectoryRead } from "../external-directory-rule"
import { createSecretMask } from "../secret-mask"
import { credentialStores } from "../../../ui-mac/src/main/codepuppy-secret-files"
import type { ProtectedFiles } from "../../../schema/src/codepuppy-protected-files"

export interface PolicyRegistration {
  onPackagePermissionRequest(handler: (call: GateCall) => Promise<void>): () => void
  bindPackageHook(call: GateCall, decision: "allow" | "ask", active: () => boolean): Promise<void>
  packageToolCall(tool: string, input: unknown, bindings: Readonly<Record<string, string>>, format: "claude" | "runtime"): Promise<ReturnType<typeof packageToolCall>>
  bindPackageAgent(agent: string, invocation: Pick<Invocation, "availableTools" | "deniedTools">, bindings: Readonly<Record<string, string>>): void
  bindPackageInvocation(sessionID: string, invocation: Pick<Invocation, "allowedTools" | "deniedTools" | "availableTools">, bindings: Readonly<Record<string, string>>, active: () => boolean): () => void
  clearPackageInvocation(sessionID: string): void
  registerModelToolAliases(aliases: ReadonlyMap<string, string>): void
  readonly dispose: () => void
  readonly videoToolFacts: () => Promise<(tool: RegisteredTool) => ToolFacts>
  readonly factsFor: (name: string) => Promise<ToolFacts | undefined>
  /** Last statement of the extension's `setup`: registers the parts that must see every earlier registration. */
  readonly seal: () => Promise<void>
  /**
   * BR-10: Code Puppy's own install tools ask from inside their call, after recording what they install (the timeline
   * card names it while the approval waits and after a decline). Resolves when allowed; a decline is rethrown as the
   * engine raised it. A call the gate did not prepare is refused (fail-closed).
   */
  readonly askInstall: (call: InstallCall) => Promise<void>
}

/** One tool call: provider call IDs repeat across sessions and messages, so all three identify it. */
export type InstallCall = { readonly sessionID: string; readonly messageID: string; readonly id: string }
const toolCallKey = (call: InstallCall) => JSON.stringify([call.sessionID, call.messageID, call.id])

/** Marks the after-the-fact approval wrapper on the shell tool (v7 BR-11), so a rebuild never wraps twice. */
const REFUSED_WRITE_WRAPPED = Symbol.for("codepuppy.policy.refused-write")

/** MCP argv placeholder replaced with the Location directory at spawn time (#1011, REQ-134). */
export const WORKSPACE_PLACEHOLDER = "{workspace}"

/** OpenCode's data root (`packages/util/src/global-roots.ts`), read at call time; the policy documents live under it. */
function dataRoot(env: NodeJS.ProcessEnv) {
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "opencode")
}

/** #1644: grants partition per folder outside git (the global project) and per project inside git. */
export function policyWorkspace(location: Plugin.Context["location"]): string {
  return String(location.project.id) === "global" ? location.directory : String(location.project.id)
}



/**
 * `toolPolicy`: who writes the tool policy document (SPEC-engine-config-fence BR-03, DESIGN §4.5). The extension passes the hub bridge's
 * writer — main, over the parent port — whenever the process has one; absent (CLI, test hosts) the store writes directly.
 */
export async function registerPolicy(context: Plugin.Context, unattended: UnattendedState, installSubject: HubBridge["installSubject"], toolPolicy?: ToolPolicyWriter, network?: HubBridge["network"], readWriteScope?: HubBridge["readWriteScope"]): Promise<PolicyRegistration> {
  const env = process.env
  const externalRead = createExternalDirectoryRead()
  const home = os.homedir()
  // `#1698`:随包清单与 Office 清单的路径、云 MCP 定义、账户分区来自 sidecar 发布的启动文档(冻结,一代不变)
  const bootstrap = codepuppyBootstrap()
  const secrets = createSecretMask({
    platform: process.platform === "win32" ? "win32" : "darwin",
    project: String(context.location.project.id) === "global" ? context.location.directory : context.location.project.directory,
    directory: context.location.directory,
    home,
    appData: process.platform === "win32" ? env.APPDATA ?? path.join(home, "AppData", "Roaming") : path.join(home, "Library", "Application Support"),
    localAppData: process.platform === "win32" ? env.LOCALAPPDATA ?? path.join(home, "AppData", "Local") : path.join(home, "Library"),
    // Node supplies strings; Schema reads only its published path-variable keys.
    pathVariables: env as ProtectedFiles.ProtectedRoots["pathVariables"],
  }, credentialStores({ userDataPath: bootstrap.paths.userData }))
  const store = createToolPolicyStore({
    baseDir: defaultPolicyBaseDir(dataRoot(env)),
    // `#1698` G2:账户分区来自启动文档(main 按当刻登录态算的哈希),缺席 = anonymous
    account: () => bootstrap.policy.account ?? "anonymous",
    workspace: () => policyWorkspace(context.location),
    write: toolPolicy,
  })
  const extOrigin = extModulePath(import.meta.url)
  const bundled = loadBundledTools(import.meta.url, bootstrap.paths.extBundledManifest)
  let early: ReadonlySet<string> | undefined
  const mcp = new Map<string, McpEntry & Record<string, unknown>>()
  const displays = new Map<string, ToolDisplaySnapshotV1>()
  // BR-10: install calls the gate prepared (keyed by session + message + call) — deferred to the tool's own ask, or already
  // asked here (same-named unverified tool).
  const installAsks = new Map<string, { decision: GateDecision; call: GateCall; install: { subject?: HubInstallSubject } } | "asked">()
  const codeModeDenials = new Map<string, UnattendedDenial | undefined>()
  const profile = (sessionID: string, agent?: string) => unattended.unattendedProfile(sessionID, agent, async () => (await context.session.get({ sessionID })).agent ?? "")
  const denied = (callID: string | undefined, denial: UnattendedDenial) => {
    if (callID && codeModeDenials.has(callID) && !codeModeDenials.get(callID)) codeModeDenials.set(callID, denial)
  }

  // A non-builtin plugin activating before the extension makes early tools ambiguous (identity.ts).
  const earlyAmbiguous = async () => {
    const listed = (await context.plugin.list()) as { data?: { source?: { type?: string; path?: string } }[] }
    const list = listed.data ?? []
    const own = list.findIndex((item) => item.source?.type === "local" && item.source.path === extOrigin)
    const first = list.findIndex((item) => item.source?.type !== "builtin")
    return first !== -1 && own !== -1 && first < own
  }

  const allFacts = async (): Promise<ToolFacts[]> => {
    const tools = (await context.tool.list()) as readonly RegisteredTool[]
    const input = { documentPythonEnvironment: documentPythonEnvironmentFor(context.location), early, earlyAmbiguous: await earlyAmbiguous(), mcp, bundled, extOrigin, cloudMcp: bootstrap.cloudMcp, officeMcpManifest: bootstrap.paths.officeMcpManifest }
    return tools.map((tool) => toolFacts(tool, input))
  }

  const invocationScopes = new Map<string, Set<{ invocation: Pick<Invocation, "allowedTools" | "deniedTools" | "availableTools">; bindings: Readonly<Record<string, string>>; active: () => boolean }>>()
  const invocationRules = (sessionID: string, facts: ToolFacts, input: unknown, resources?: readonly string[]): PermissionRule[] => {
    const scopes = invocationScopes.get(sessionID)
    if (!scopes) return []
    const combined: PermissionRule[] = []
    for (const scope of scopes) {
    const canonical = canonicalToolIdentity(facts.identity)
    const deny: PermissionRule[] = [{ action: canonical, resource: "*", effect: "deny" }]
    if (!scope.active()) return deny
    const resolve = (rule: import("../../../ui-mac/src/shared/host-extension-package-contract/plugin-package").ToolRule) => packageToolRule(rule, facts, scope.bindings)
    if (scope.invocation.availableTools && !scope.invocation.availableTools.some(rule => resolve(rule))) return deny
    const record = input && typeof input === "object" ? input as Record<string, unknown> : {}
    const rawValues = resources ?? [record.command, record.filePath, record.file_path, record.path, record.agent, record.id, record.url].filter((value): value is string => typeof value === "string")
    const shell = facts.identity.name === "shell"
    const groups = rawValues.flatMap(value => {
      if (shell) {
        const parsed = ShellScan.scan(value, "posix")
        return parsed.kind === "scanned" ? parsed.commands.map(command => [command.resource, command.words.join(" ")]) : [[]]
      }
      const host = scope.bindings[(facts.identity.name === "subagent" ? "agent" : facts.identity.name) + "::" + value]
      return [[value, ...(host ? [host] : [])]]
    })
    const matches = (rule: import("../../../ui-mac/src/shared/host-extension-package-contract/plugin-package").ToolRule, values: readonly string[]) => {
      const resolved = resolve(rule)
      if (!resolved) return false
      if (resolved.pattern === undefined || resolved.pattern === "*") return true
      return values.some(value => match(value, resolved.pattern!) || !shell && match(path.relative(context.location.directory, value), resolved.pattern!) || resolved.pattern!.endsWith(":*") && (value === resolved.pattern!.slice(0, -2) || match(value, resolved.pattern!.slice(0, -2) + " *")))
    }
    const all = (rules: readonly import("../../../ui-mac/src/shared/host-extension-package-contract/plugin-package").ToolRule[]) => (groups.length ? groups : [[]]).every(values => rules.some(rule => matches(rule, values)))
    if ((input !== undefined || resources !== undefined) && scope.invocation.availableTools && !all(scope.invocation.availableTools)) return deny
    if (scope.invocation.deniedTools.some(rule => groups.length ? groups.some(values => matches(rule, values)) : matches(rule, []))) return deny
    if (all(scope.invocation.allowedTools)) combined.push({ action: PACKAGE_INVOCATION_ALLOW, resource: canonical, effect: "allow" })
    }
    return combined
  }
  const modelToolAliases = new Map<string, string>()
  const factsFor = async (name: string) => {
    if (name === CODE_MODE_TOOL) return codeModeFacts()
    return (await allFacts()).find((facts) => facts.technicalId === (modelToolAliases.get(name) ?? name))
  }

  const packageAgents = new Map<string, import("./catalog").PackageAgentPolicy>()
  const catalog = createCatalog({
    packageAgent: agent => packageAgents.get(agent),
    tools: allFacts,
    snapshot: () => store.snapshot(),
    transform: (callback) => context.agent.transform(callback as never),
    reload: () => context.agent.reload(),
    log: (message) => console.info(`[codepuppy-policy] ${message}`),
  })

  let packagePermissionRequest: ((call: GateCall) => Promise<void>) | undefined
  const calls = new Map<string, GateCall>()
  const packageHooks = new Map<string, { call: GateCall; decision: "allow" | "ask"; active: () => boolean; input: string; binding: string | undefined; phase: "prepared" | "confirmed" }>()
  const packageHook = (call: GateCall, facts: ToolFacts) => {
    const bound = packageHooks.get(toolCallKey(call))
    return bound && bound.active() && bound.input === canonicalJsonDigest([call.tool, call.input]) && bound.binding === subjectBindingDigest({ identity: facts.identity, authority: facts.authority, bindingDigest: facts.bindingDigest }) ? bound : undefined
  }
  const packageHookRules = (bound: NonNullable<ReturnType<typeof packageHook>>, facts: ToolFacts): PermissionRule[] => [{ action: PACKAGE_HOOK_DECISION, resource: canonicalToolIdentity(facts.identity), effect: bound.decision }]

  const ruleset = async (sessionID: string, agent: string, selected?: UnattendedProfile, call?: Pick<GateCall, "tool" | "input"> & Partial<Pick<GateCall, "messageID" | "id">>): Promise<readonly PermissionRule[]> => {
    const configured =
      catalog.configured(agent) ??
      (await context.agent.get({ agentID: agent } as never)).data.permissions ?? []
    const session = await context.session.get({ sessionID } as never).catch(() => undefined)
    // AC-06:交互分支的既有读取路径保持不变;在册 T1 才消费当前会话字段。
    const permissions = selected === undefined
      ? (session as { data?: { permissions?: PermissionRule[] } } | undefined)?.data?.permissions
      : session?.permissions
    // I-13 L2 (SPEC-engine-config-fence BR-02; DESIGN-engine-config-fence §4.6, D16): only the session row's deny entries
    // take part, on both branches. The row lives in the engine database, which a fenced process can write, and an unattended
    // call the gate allows never reaches the engine's own decision. Code Puppy writes only deny there.
    const facts = call && await factsFor(call.tool)
    const hook = facts && call?.messageID && call.id ? packageHook({ ...call, sessionID, agent, messageID: call.messageID, id: call.id }, facts) : undefined
    return [...configured, ...(permissions ?? []).filter((rule) => rule.effect === "deny"), ...(facts ? invocationRules(sessionID, facts, call?.input) : []), ...(hook && facts ? packageHookRules(hook, facts) : [])]
  }

  const deps: GateDeps = {
    protectedRoots: secrets.roots,
    profile,
    denied,
    store,
    facts: factsFor,
    ruleset,
    directory: () => context.location.directory,
    assert: (input) => context.permission.assert(input as never),
  }

  // ── SPEC child-process-write-fence v7 BR-11 (design v6 §4.3, §4.3.1, §4.4): a write refused mid-command ───────────
  // When a shell command's own error names the full path of a refused write, the folder gets BR-08's card after the
  // command (same request shape, same R4 grant on click). This path only proposes; main decides (R6) and grants (R4).
  type RefusedWriteCall = { sessionID: string; agent?: string; messageID: string; id: string }
  type RefusedWriteCard = { owner: { messageID: string; id: string }; keys: string[]; members: Set<string>; decision: Promise<void> }
  // Pending cards, one entry per session + real directory; a card ends (any outcome) before its entries are dropped.
  const refusedWriteCards = new Map<string, RefusedWriteCard>()
  // Owners whose card was withdrawn before the engine created its request: the evaluate hook denies that request.
  const withdrawnRefusedWrites = new Set<string>()
  // Calls whose refused folders the user approved; read and dropped by execute.after (toolCallKey: ids repeat across sessions).
  const approvedRefusedWrites = new Set<string>()
  // Background shells (session + shell ID) whose result has not reached a request yet, and the decisions recorded for them.
  const backgroundShells = new Map<string, RefusedWriteCall>()
  const backgroundDecisions = new Map<string, Promise<void>>()
  const backgroundOutcomes = new Map<string, "approved" | "refused">()
  const withdrawRefusedWriteCard = async (sessionID: string, card: RefusedWriteCard) => {
    for (const key of card.keys) if (refusedWriteCards.get(key) === card) refusedWriteCards.delete(key)
    const owner = toolCallKey({ sessionID, ...card.owner })
    withdrawnRefusedWrites.add(owner)
    const listed = await context.permission.list({ sessionID } as never).catch(() => [])
    const pending = ((listed as { data?: unknown }).data ?? listed) as readonly { id: string; action: string; source?: { type: string; messageID: string; id: string } }[]
    const request = pending.find((item) => item.action === "external_directory" && item.source?.type === "tool" && item.source.messageID === card.owner.messageID && item.source.id === card.owner.id)
    // Reject is the only reply that cannot grant; the engine retracts the card with a replied event.
    if (request) await context.permission.reply({ sessionID, requestID: request.id, decision: "reject" } as never).catch(() => undefined)
  }
  /** AB3: offer the card for the folders `output` names; resolves "approved" once main reads every one as writable. */
  const approveRefusedWrites = async (call: RefusedWriteCall, output: string, signal?: AbortSignal): Promise<"approved" | "not-offered"> => {
    const paths = refusedWritePaths(output)
    if (!paths.length || !readWriteScope) return "not-offered"
    // Nobody can click a card in an unattended run: its result and note stay as they are.
    if (await profile(call.sessionID, call.agent) !== undefined) return "not-offered"
    // The folder is the refused object's parent: creating, writing and renaming happen there.
    const targets = paths.map((absolute) => ({ absolute, directory: path.dirname(absolute) }))
    const classify = async (asked: typeof targets) => {
      const scope = await readWriteScope({ access: "write", targets: asked }).catch(() => undefined)
      return !scope || "error" in scope || scope.targets.length !== asked.length || scope.targets.some((target, index) => target.absolute !== asked[index]!.absolute) ? undefined : scope.targets
    }
    const scope = await classify(targets)
    if (!scope) return "not-offered"
    const offered = new Map<string, (typeof targets)[number]>()
    scope.forEach((target, index) => { if (target.outcome === "needs-approval" && !offered.has(target.realDirectory)) offered.set(target.realDirectory, targets[index]!) })
    if (!offered.size) return "not-offered"
    const key = toolCallKey(call)
    const waiting = new Set<RefusedWriteCard>()
    const fresh = [...offered].filter(([real]) => {
      const joined = refusedWriteCards.get(call.sessionID + "\0" + real)
      if (joined) waiting.add(joined)
      return !joined
    })
    if (fresh.length) {
      const resources = fresh.map(([real]) => `${real}/*`)
      const card: RefusedWriteCard = {
        owner: { messageID: call.messageID, id: call.id },
        keys: fresh.map(([real]) => call.sessionID + "\0" + real),
        members: new Set(),
        decision: context.permission.assert({
          sessionID: call.sessionID,
          ...(call.agent ? { agent: call.agent } : {}),
          action: "external_directory",
          resources,
          save: resources,
          metadata: { directoryAccess: { access: "write", targets: fresh.map(([, target]) => target) } },
          source: { type: "tool", messageID: call.messageID, id: call.id },
        } as never),
      }
      for (const entry of card.keys) refusedWriteCards.set(entry, card)
      const settled = () => {
        for (const entry of card.keys) if (refusedWriteCards.get(entry) === card) refusedWriteCards.delete(entry)
        withdrawnRefusedWrites.delete(toolCallKey({ sessionID: call.sessionID, ...card.owner }))
      }
      card.decision.then(settled, settled)
      waiting.add(card)
    }
    for (const card of waiting) card.members.add(key)
    const leave = () => {
      for (const card of waiting) {
        card.members.delete(key)
        // The last waiting call stopped and the card is still open: nobody is left to receive its answer.
        if (card.members.size === 0 && card.keys.some((entry) => refusedWriteCards.get(entry) === card)) void withdrawRefusedWriteCard(call.sessionID, card)
      }
    }
    try {
      // Every member rethrows the card's own error: one rejection ends every call waiting on it, as the engine does.
      await Promise.race([
        Promise.all([...waiting].map((card) => card.decision)),
        ...(signal ? [new Promise<never>((_, reject) => {
          if (signal.aborted) reject(signal.reason)
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        })] : []),
      ])
    } catch (error) {
      if (signal?.aborted) leave()
      throw error
    }
    for (const card of waiting) card.members.delete(key)
    // Main's facts decide, not the reply: every offered folder must now read as writable.
    const after = await classify([...offered.values()])
    return after?.every((target) => target.outcome === "writable" || target.outcome === "fixed" || target.outcome === "no-fence") ? "approved" : "not-offered"
  }
  /** AB5: a background shell's result reaches the model as the engine's `<shell id="…" state="…">` notification. */
  const approveBackgroundRefusedWrites = async (event: { sessionID: string; messages: unknown[] }) => {
    type MessageLike = { role?: unknown; content?: unknown; constructor: new (fields: Record<string, unknown>) => unknown }
    for (const [index, raw] of event.messages.entries()) {
      const message = raw as MessageLike
      if (message.role !== "user" || !Array.isArray(message.content)) continue
      const text = (message.content[0] as { type?: unknown; text?: unknown } | undefined)?.text
      if (typeof text !== "string") continue
      const shellID = /^<shell id="([^"]+)" state="/.exec(text)?.[1]
      if (!shellID) continue
      const key = event.sessionID + "\0" + shellID
      const call = backgroundShells.get(key)
      if (call && !backgroundDecisions.has(key)) {
        backgroundShells.delete(key)
        const body = text.slice(text.indexOf("\n") + 1).replace(/\n<\/shell>$/, "")
        // The card belongs to the finished command, not to this request: it survives a stopped request (no signal).
        const decided = approveRefusedWrites(call, body).then(
          (outcome) => { if (outcome === "approved") backgroundOutcomes.set(key, "approved") },
          // A refusal is caught here: throwing would fail this model request, and no tool call is running to end.
          () => { backgroundOutcomes.set(key, "refused") },
        ).finally(() => backgroundDecisions.delete(key))
        backgroundDecisions.set(key, decided)
      }
      await backgroundDecisions.get(key)
      const note = refusedWriteNote(backgroundOutcomes.get(key))
      if (note) event.messages[index] = new message.constructor({ ...message, content: [...message.content, { type: "text", text: note }] })
    }
  }

  // Early registry: what OpenCode's internal plugins registered before the extension (identity.ts `builtin`).
  await context.tool.transform((editor) => {
    early = new Set(editor.list().map((tool) => tool.id))
  })

  await context.mcp.transform((editor) => {
    for (const [name, config] of editor.list()) {
      if (config.type !== "local" || !config.command.includes(WORKSPACE_PLACEHOLDER)) continue
      editor.update(name, (draft) => {
        if (draft.type !== "local") return
        draft.command = draft.command.map((arg) => (arg === WORKSPACE_PLACEHOLDER ? context.location.directory : arg))
      })
    }
  })

  // Head of the execute.before chain: a denied call reaches no other hook and no side effect.
  await context.tool.hook("execute.before", async (event) => {
    denyHubMutationForAutomation(event.agent, event.tool)
    await decide(deps, event)
  })

  // Prompts wait for plugin activation (packages/core/src/session/prompt.ts), so the tail rules registered here land
  // after every configured rule, including the ones OpenCode's post-activation config plugin appends.
  await context.session.hook("prompt", async (event) => {
    unattended.preparePrompt(event)
    await catalog.ensureTail()
  })

  await context.session.hook("context", async (event) => {
    await approveBackgroundRefusedWrites(event as never)
    await catalog.prune(event as never, async (name) => {
      const facts = await factsFor(name)
      if (!facts) return true
      const [snapshot, rules] = await Promise.all([store.snapshot(), ruleset(event.sessionID, event.agent, undefined, { tool: name, input: undefined })])
      return effectiveFor(facts, snapshot, rules).action === "deny"
    })
    const current = invocationScopes.get(event.sessionID)
    if (!current) return
    const facts = await allFacts()
    const missing = [...new Set([...current].flatMap(scope => [...scope.invocation.allowedTools, ...scope.invocation.deniedTools, ...(scope.invocation.availableTools ?? [])].filter(rule => !facts.some(fact => packageToolRule(rule, fact, scope.bindings))).map(rule => rule.tool)))]
    if (missing.length) event.system.push({ type: "text", text: renderWrapper(PACKAGE_TOOL_DEPENDENCY_ID, { label: "package invocation", body: missing.join(", ") }) })
  })

  const requestPackagePermission = async (event: import("@opencode/plugin/promise/permission").PermissionEvaluation) => {
    if (event.effect !== "ask" || event.source?.type !== "tool" || !packagePermissionRequest) return
    const call = calls.get(toolCallKey({ sessionID: event.sessionID, messageID: event.source.messageID, id: event.source.id }))
    if (!call) return
    const facts = await factsFor(call.tool)
    if (!facts || event.action !== facts.permission && event.action !== canonicalToolIdentity(facts.identity)) return
    await packagePermissionRequest(call)
    const final = await decide(deps, call)
    const hook = packageHook(call, final.facts)
    if (hook?.decision === "allow" && !isInstallAsk(event.metadata)) {
      hook.phase = "confirmed"
      event.effect = "allow"
    }
  }

  // Risk facts on every approval request (#1285): Code Puppy's classification overrides what a tool reports.
  // Code Puppy's own gate requests already carry theirs (`confirm`); their ask is held so no later evaluate hook can
  // turn it into allow (`holdAsk`).
  await context.permission.hook("evaluate", async (event) => {
    const selected = await profile(event.sessionID, event.agent)
    if (selected !== undefined) {
      if (event.source === undefined) {
        const facts = (await allFacts()).find((item) => item.permission === event.action)
        if (facts) await gateWithoutToolCall(deps, event as never, facts, "build", selected)
      }
      return holdUnattendedDeny(event, selected, event.action, (denial) => denied(event.source?.type === "tool" ? event.source.id : undefined, denial))
    }
    externalRead.evaluate(event)
    // v7 BR-11: an after-the-fact card whose calls all stopped before the engine created the request is not shown.
    if (event.action === "external_directory" && event.source?.type === "tool" && withdrawnRefusedWrites.has(toolCallKey({ sessionID: event.sessionID, messageID: event.source.messageID, id: event.source.id }))) { event.effect = "deny"; return }
    await evaluateDirectoryWrite(event, readWriteScope)
    if (isCodePuppyPolicyRequest(event.metadata)) {
      // BR-10: an assistant-initiated install asks in every tier — no allow rule, saved approval or tier skips it.
      if (isInstallAsk(event.metadata) && event.effect !== "deny") event.effect = "ask"
      await requestPackagePermission(event)
      return holdAsk(event)
    }
    // A tool's permission action asserted without a tool call (a subtask command, review R1 #2) is decided like the
    // tool's call; a tool call's own assert already passed confirm() in execute.before.
    if (event.source === undefined) {
      const facts = (await allFacts()).find((item) => item.permission === event.action)
      if (facts) await gateWithoutToolCall(deps, event as never, facts, "build")
    }
    const sourceFacts = (await allFacts()).find(item => item.permission === event.action || canonicalToolIdentity(item.identity) === event.action)
    if (sourceFacts) {
      const rules = invocationRules(event.sessionID, sourceFacts, undefined, event.resources)
      const bound = event.source?.type === "tool" ? packageHooks.get(toolCallKey({ sessionID: event.sessionID, messageID: event.source.messageID, id: event.source.id })) : undefined
      const facts = bound && await factsFor(bound.call.tool)
      const hook = bound?.phase === "confirmed" && facts && (facts.permission === event.action || canonicalToolIdentity(facts.identity) === event.action) ? packageHook(bound.call, facts) : undefined
      if (rules.some(rule => rule.effect === "deny")) event.effect = "deny"
      else if (event.effect === "ask" && (packageCallAllows(canonicalToolIdentity(sourceFacts.identity), rules) || hook !== undefined)) event.effect = "allow"
    }
    await requestPackagePermission(event)
    if (event.effect !== "ask" || !event.metadata) return
    ;(event.metadata as Record<string, unknown>)[RISK_METADATA_KEY] = classifyPermissionRequest({
      protectedRoots: secrets.roots,
      permission: event.action,
      patterns: [...event.resources],
      always: [],
      metadata: event.metadata as Record<string, unknown>,
    })
  })

  await context.rpc.register(TOOL_POLICY_RPC_DEFINITION as never, toolPolicyHandlers({
    store,
    tools: allFacts,
    // Settings shows the primary agent's view, as v1 showed the global config ruleset.
    ruleset: async () => catalog.configured("build") ?? [],
    changed: async () => {
      await catalog.refresh()
    },
  }) as never)

  const terminalEvents = new AbortController()
  void (async () => {
    for await (const event of context.event.subscribe({ types: ["session.tool.success", "session.tool.failed"], signal: terminalEvents.signal }))
      {
        const call = { sessionID: event.data.sessionID, messageID: event.data.assistantMessageID, id: event.data.id }
        secrets.release(call)
        externalRead.end(call)
      }
  })().catch(() => { /* Location disposal aborts the cleanup subscription. */ })

  return {
    onPackagePermissionRequest: handler => {
      packagePermissionRequest = handler
      return () => { if (packagePermissionRequest === handler) packagePermissionRequest = undefined }
    },
    bindPackageHook: async (call, decision, active) => {
      const facts = await factsFor(call.tool)
      if (!facts) throw Error("dependency-missing: tool identity " + call.tool)
      packageHooks.set(toolCallKey(call), { call: { ...call, input: structuredClone(call.input) }, decision, active, input: canonicalJsonDigest([call.tool, call.input]), binding: subjectBindingDigest({ identity: facts.identity, authority: facts.authority, bindingDigest: facts.bindingDigest }), phase: "prepared" })
    },
    packageToolCall: async (tool, input, bindings, format) => {
      const facts = await factsFor(tool)
      if (!facts) throw Error("dependency-missing: tool identity " + tool)
      return packageToolCall(facts, input, bindings, format, context.location.directory)
    },
    bindPackageAgent: (agent, invocation, bindings) => { packageAgents.set(agent, { invocation, bindings }) },
    bindPackageInvocation: (sessionID, invocation, bindings, active) => {
      const entries = invocationScopes.get(sessionID) ?? new Set()
      const scope = { invocation, bindings, active }
      entries.add(scope)
      invocationScopes.set(sessionID, entries)
      return () => { entries.delete(scope) }
    },
    clearPackageInvocation: sessionID => { invocationScopes.delete(sessionID) },
    registerModelToolAliases: (aliases: ReadonlyMap<string, string>) => { for (const [alias, original] of aliases) modelToolAliases.set(alias, original) },
    dispose: () => { terminalEvents.abort(); externalRead.dispose(); secrets.dispose() },
    videoToolFacts: async () => {
      // Transform callbacks are synchronous: capture the existing plugin-order fact before registering one.
      const ambiguous = await earlyAmbiguous()
      return (tool) =>
        toolFacts(tool, {
          early,
          earlyAmbiguous: ambiguous,
          mcp,
          bundled,
          extOrigin,
          cloudMcp: bootstrap.cloudMcp,
          officeMcpManifest: bootstrap.paths.officeMcpManifest,
        })
    },

    factsFor,
    askInstall: async (call) => {
      const key = toolCallKey(call)
      const prepared = installAsks.get(key)
      if (!prepared) throw Error("not installed: this install has no prepared approval")
      installAsks.delete(key)
      if (prepared !== "asked") await confirm(deps, prepared.decision, prepared.call, prepared.install)
    },
    seal: async () => {
      await context.shell.hook("create.before", (event) => secrets.command(event))
      await context.shell.hook("capture", (event) => secrets.capture(event))
      // Configured MCP servers as OpenCode will run them, after every earlier transform (the extension's cloud entry).
      await context.mcp.transform((editor) => {
        mcp.clear()
        for (const [name, config] of editor.list()) mcp.set(name, config as McpEntry & Record<string, unknown>)
      })

      // Tail of the chain: ask with the input the implementation will receive, then pin it.
      await context.tool.hook("execute.before", async (event) => {
        try {
          // Review R1 #1: a tool registered after the rules were last computed (a late MCP server) gets its catalog
          // rules before the identity-axis ask is evaluated, so a document-axis ask holds for it too.
          await catalog.refresh()
          const decision = await decide(deps, event)
          const facts = decision.facts
          const install = facts.identity.source === "plugin" ? hubInstallAsk(event, facts.authority.kind === "codepuppy-bundled", installSubject) : undefined
          const preparedHook = packageHook(event, facts)
          calls.set(toolCallKey(event), event)
          // BR-10: the verified install tool asks from its own call (`askInstall`), once it has recorded what it installs.
          if (install?.subject) installAsks.set(toolCallKey(event), { decision, call: { tool: event.tool, sessionID: event.sessionID, agent: event.agent, messageID: event.messageID, id: event.id, input: event.input }, install })
          else await confirm(deps, decision, event, install)
          if (install && !install.subject) installAsks.set(toolCallKey(event), "asked")
          const hook = preparedHook ?? packageHook(event, facts)
          if (hook) {
            const final = await decide(deps, event)
            if (packageHook(event, final.facts) !== hook) {
              packageHooks.delete(toolCallKey(event))
              await confirm(deps, final, event, install)
            } else hook.phase = "confirmed"
          }
          displays.set(event.id, displaySnapshot(decision.facts))
          pin(event)
          if (event.tool === CODE_MODE_TOOL && await profile(event.sessionID, event.agent) !== undefined) codeModeDenials.set(event.id, undefined)
          await secrets.begin({ call: event, kind: event.tool === CODE_MODE_TOOL ? "execute" : "tool" })
          if (secrets.isRoot(event, event.tool)) externalRead.begin(event, decision.facts)
        } catch (error) {
          displays.delete(event.id)
          packageHooks.delete(toolCallKey(event))
          calls.delete(toolCallKey(event))
          installAsks.delete(toolCallKey(event))
          throw error
        }
      })

      await context.tool.transform((editor) => {
        wrapForDisplay(editor as never, (callID) => displays.get(callID), network ? (tool, call, execute) => network.run(context.location.directory, tool, call, execute) : undefined)
        secrets.wrap(editor, { facts: factsFor, profile, protect: externalRead.protect })
        // v7 BR-11 (AB3): after the command, before its result goes back to the engine; a decline is rethrown as raised.
        editor.update("shell", (draft: { execute: (input: unknown, context: import("@opencode/plugin/promise/tool").ToolContext) => Promise<unknown> }) => {
          if (Object.hasOwn(draft.execute, REFUSED_WRITE_WRAPPED)) return
          const inner = draft.execute
          const wrapped: typeof inner = async (input, ctx) => {
            const result = await inner(input, ctx) as { output?: { output?: unknown }; metadata?: { status?: unknown; shellID?: unknown } } | undefined
            const call = { sessionID: ctx.sessionID, agent: ctx.agent, messageID: ctx.messageID, id: ctx.id }
            // A background command returns at once; its result is read later (AB5).
            if (result?.metadata?.status === "running" && typeof result.metadata.shellID === "string") backgroundShells.set(call.sessionID + "\0" + result.metadata.shellID, call)
            else if (typeof result?.output?.output === "string" && await approveRefusedWrites(call, result.output.output, ctx.signal) === "approved") approvedRefusedWrites.add(toolCallKey(call))
            return result
          }
          Object.defineProperty(wrapped, REFUSED_WRITE_WRAPPED, { value: true })
          draft.execute = wrapped
        })
      })
      await context.tool.hook("execute.progress", async (event) => {
        const safe = deepFreeze(await secrets.progress({ call: event, facts: await factsFor(event.tool), update: event.metadata }))
        Object.defineProperty(event, "metadata", { value: safe, enumerable: true, configurable: false, writable: false })
      })
      await context.tool.hook("execute.after", async (event) => {
        packageHooks.delete(toolCallKey(event))
        calls.delete(toolCallKey(event))
        try {
          const networkNotice = network?.attachResult(event as never)
          if (event.tool === CODE_MODE_TOOL) {
            attachUnattendedDenial(event as never, codeModeDenials.get(event.id))
            codeModeDenials.delete(event.id)
          }
          if (!networkNotice) attachNetFailure(event as never)
          attachWriteDenied(event as never, approvedRefusedWrites.delete(toolCallKey(event)))
          attachDirectoryDisplay(event as never)
          attachTerminal(event as never, displays.get(event.id))
          if (event.status === "completed" && event.tool === "read" && externalRead.file(event)) event.result = await secrets.read({ call: event, file: externalRead.file(event)!, result: event.result })
          if (event.status === "completed") event.result = await secrets.result({ call: event, tool: event.tool, facts: await factsFor(event.tool), result: event.result })
          else event.error = await secrets.error({ call: event, tool: event.tool, error: event.error })
          displays.delete(event.id)
          installAsks.delete(toolCallKey(event))
        } finally { externalRead.end(event) }
      })

      await context.permission.hook("evaluate", async (event) => {
        if (!event.metadata) return
        const safe = await secrets.preview(event.metadata, event.source?.type === "tool" ? { sessionID: event.sessionID, messageID: event.source.messageID, id: event.source.id } : undefined)
        for (const key of Object.keys(event.metadata)) delete event.metadata[key]
        Object.assign(event.metadata, safe)
      })

      await catalog.refresh()
    },
  }
}



export async function evaluateDirectoryWrite(event: { action: string; effect: "allow" | "ask" | "deny"; metadata?: unknown }, readWriteScope?: HubBridge["readWriteScope"]) {
  if (event.action !== "external_directory" || event.effect === "deny") return
  const request = directoryAccessMetadata(event.metadata)
  if (!request || request.access !== "write") return
  const result = await readWriteScope?.(request).catch(() => ({ error: "unavailable" as const }))
  if (!result || "error" in result) { event.effect = "ask"; return }
  if (result.targets.length !== request.targets.length || result.targets.some((target, index) => target.absolute !== request.targets[index]!.absolute)) { event.effect = "ask"; return }
  if (result.targets.every((target) => target.outcome === "no-fence")) return
  if (result.targets.some((target) => target.outcome === "protected")) { event.effect = "deny"; return }
  // BR-08 before the write is unchanged by v7: a folder R4 cannot grant still asks here (R4 refuses it on the card).
  if (result.targets.some((target) => target.outcome === "needs-approval" || target.outcome === "ineligible")) { event.effect = "ask"; return }
  // R6: only fixed global-install/user-config targets skip external_directory; for /tmp, caches and run-approved
  // folders the engine's own decision stands (BR-08).
  if (result.targets.every((target) => target.outcome === "fixed")) event.effect = "allow"
}
