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
import { attachDirectoryDisplay, attachUnattendedDenial, attachNetFailure, attachTerminal, attachWriteDenied, displaySnapshot, wrapForDisplay } from "./display"
import { confirm, decide, effectiveFor, gateWithoutToolCall, holdAsk, holdUnattendedDeny, isInstallAsk, pin, type GateCall, type GateDecision, type GateDeps } from "./gate"
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

export interface PolicyRegistration {
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
const installCallKey = (call: InstallCall) => JSON.stringify([call.sessionID, call.messageID, call.id])

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
export async function registerPolicy(context: Plugin.Context, unattended: UnattendedState, installSubject: HubBridge["installSubject"], toolPolicy?: ToolPolicyWriter, network?: HubBridge["network"]): Promise<PolicyRegistration> {
  const env = process.env
  // `#1698`:随包清单与 Office 清单的路径、云 MCP 定义、账户分区来自 sidecar 发布的启动文档(冻结,一代不变)
  const bootstrap = codepuppyBootstrap()
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
    const input = { early, earlyAmbiguous: await earlyAmbiguous(), mcp, bundled, extOrigin, cloudMcp: bootstrap.cloudMcp, officeMcpManifest: bootstrap.paths.officeMcpManifest }
    return tools.map((tool) => toolFacts(tool, input))
  }

  const factsFor = async (name: string) => {
    if (name === CODE_MODE_TOOL) return codeModeFacts()
    return (await allFacts()).find((facts) => facts.technicalId === name)
  }

  const catalog = createCatalog({
    tools: allFacts,
    snapshot: () => store.snapshot(),
    transform: (callback) => context.agent.transform(callback as never),
    reload: () => context.agent.reload(),
    log: (message) => console.info(`[codepuppy-policy] ${message}`),
  })

  const ruleset = async (sessionID: string, agent: string, selected?: UnattendedProfile): Promise<readonly PermissionRule[]> => {
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
    return [...configured, ...(permissions ?? []).filter((rule) => rule.effect === "deny")]
  }

  const deps: GateDeps = {
    profile,
    denied,
    store,
    facts: factsFor,
    ruleset,
    directory: () => context.location.directory,
    assert: (input) => context.permission.assert(input as never),
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
    await catalog.prune(event as never, async (name) => {
      const facts = await factsFor(name)
      if (!facts) return true
      const [snapshot, rules] = await Promise.all([store.snapshot(), ruleset(event.sessionID, event.agent)])
      return effectiveFor(facts, snapshot, rules).action === "deny"
    })
  })

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
    if (isCodePuppyPolicyRequest(event.metadata)) {
      // BR-10: an assistant-initiated install asks in every tier — no allow rule, saved approval or tier skips it.
      if (isInstallAsk(event.metadata) && event.effect !== "deny") event.effect = "ask"
      return holdAsk(event)
    }
    // A tool's permission action asserted without a tool call (a subtask command, review R1 #2) is decided like the
    // tool's call; a tool call's own assert already passed confirm() in execute.before.
    if (event.source === undefined) {
      const facts = (await allFacts()).find((item) => item.permission === event.action)
      if (facts) await gateWithoutToolCall(deps, event as never, facts, "build")
    }
    if (event.effect !== "ask" || !event.metadata) return
    ;(event.metadata as Record<string, unknown>)[RISK_METADATA_KEY] = classifyPermissionRequest({
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

  return {
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
      const key = installCallKey(call)
      const prepared = installAsks.get(key)
      if (!prepared) throw Error("not installed: this install has no prepared approval")
      installAsks.delete(key)
      if (prepared !== "asked") await confirm(deps, prepared.decision, prepared.call, prepared.install)
    },
    seal: async () => {
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
          // BR-10: the verified install tool asks from its own call (`askInstall`), once it has recorded what it installs.
          if (install?.subject) installAsks.set(installCallKey(event), { decision, call: { tool: event.tool, sessionID: event.sessionID, agent: event.agent, messageID: event.messageID, id: event.id, input: event.input }, install })
          else await confirm(deps, decision, event, install)
          if (install && !install.subject) installAsks.set(installCallKey(event), "asked")
          displays.set(event.id, displaySnapshot(decision.facts))
          pin(event)
          if (event.tool === CODE_MODE_TOOL && await profile(event.sessionID, event.agent) !== undefined) codeModeDenials.set(event.id, undefined)
        } catch (error) {
          displays.delete(event.id)
          installAsks.delete(installCallKey(event))
          throw error
        }
      })

      await context.tool.transform((editor) =>
        wrapForDisplay(editor as never, (callID) => displays.get(callID), network ? (tool, call, execute) => network.run(context.location.directory, tool, call, execute) : undefined),
      )
      await context.tool.hook("execute.after", (event) => {
        const networkNotice = network?.attachResult(event as never)
        if (event.tool === CODE_MODE_TOOL) {
          attachUnattendedDenial(event as never, codeModeDenials.get(event.id))
          codeModeDenials.delete(event.id)
        }
        if (!networkNotice) attachNetFailure(event as never)
        attachWriteDenied(event as never, context.location.directory)
        attachDirectoryDisplay(event as never)
        attachTerminal(event as never, displays.get(event.id))
        displays.delete(event.id)
        installAsks.delete(installCallKey(event))
      })

      await catalog.refresh()
    },
  }
}

