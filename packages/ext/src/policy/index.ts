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
//   rpc              codepuppy.tool-policy (I5)
import os from "node:os"
import path from "node:path"
import type { Plugin } from "@opencode/plugin"
import { createCatalog } from "./catalog"
import { attachNetFailure, attachTerminal, displaySnapshot, wrapForDisplay } from "./display"
import { confirm, decide, effectiveFor, gateWithoutToolCall, holdAsk, pin, type GateDeps } from "./gate"
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
import { createToolPolicyStore, defaultPolicyBaseDir, type McpEntry } from "./resolver"
import { classifyPermissionRequest, RISK_METADATA_KEY } from "./risk"
import { TOOL_POLICY_RPC_DEFINITION, toolPolicyHandlers } from "./rpc"
import type { ToolDisplaySnapshotV1 } from "../../../schema/src/tool-identity"
import { isCodePuppyPolicyRequest } from "../../../schema/src/codepuppy-tool-policy"
import { HUB_INSTALL_ACTION } from "../hub-tools"

export interface PolicyRegistration {
  /** Last statement of the extension's `setup`: registers the parts that must see every earlier registration. */
  readonly seal: () => Promise<void>
}

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
 * I10: the extension's own, manifest-verified Customization Center install asks the user through its own
 * `codepuppy_hub_install` assert (hub-tools.ts), carrying the install details. The evaluate hook below decides that assert
 * on this tool's identity axis (`gateWithoutToolCall`: deny by name, or ask with Code Puppy's envelope) and hub-tools.ts
 * pins it to ask — never remembered, denied to automation agents. Asking at the call as well would ask twice, the first
 * time without the install details. Its call is still decided first (`decide`: a disabled tool is refused) and pinned;
 * before the one ask it only reads the catalog view from the app. A tool of that name with any other identity is asked
 * at the call like every tool.
 */
function asksForItself(facts: ToolFacts) {
  return facts.technicalId === HUB_INSTALL_ACTION && facts.identity.source === "plugin" && facts.authority.kind === "codepuppy-bundled"
}

export async function registerPolicy(context: Plugin.Context): Promise<PolicyRegistration> {
  const env = process.env
  const store = createToolPolicyStore({
    baseDir: defaultPolicyBaseDir(dataRoot(env)),
    account: () => env.CODEPUPPY_POLICY_ACCOUNT || "anonymous",
    workspace: () => policyWorkspace(context.location),
  })
  const extOrigin = extModulePath(import.meta.url)
  const bundled = loadBundledTools(import.meta.url, env)
  let early: ReadonlySet<string> | undefined
  const mcp = new Map<string, McpEntry & Record<string, unknown>>()
  const displays = new Map<string, ToolDisplaySnapshotV1>()

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
    const input = { early, earlyAmbiguous: await earlyAmbiguous(), mcp, bundled, extOrigin, env }
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

  const ruleset = async (sessionID: string, agent: string): Promise<readonly PermissionRule[]> => {
    const configured =
      catalog.configured(agent) ??
      (((await context.agent.get({ agentID: agent } as never)) as { data?: { permissions?: PermissionRule[] } }).data
        ?.permissions ??
        [])
    const session = (await context.session.get({ sessionID } as never).catch(() => undefined)) as
      | { data?: { permissions?: PermissionRule[] } }
      | undefined
    return [...configured, ...(session?.data?.permissions ?? [])]
  }

  const deps: GateDeps = {
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
    await decide(deps, event)
  })

  // Prompts wait for plugin activation (packages/core/src/session/prompt.ts), so the tail rules registered here land
  // after every configured rule, including the ones OpenCode's post-activation config plugin appends.
  await context.session.hook("prompt", async () => {
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
    if (isCodePuppyPolicyRequest(event.metadata)) return holdAsk(event)
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
          if (!asksForItself(decision.facts)) await confirm(deps, decision, event)
          displays.set(event.id, displaySnapshot(decision.facts))
          pin(event)
        } catch (error) {
          displays.delete(event.id)
          throw error
        }
      })

      await context.tool.transform((editor) =>
        wrapForDisplay(editor as never, (callID) => displays.get(callID)),
      )
      await context.tool.hook("execute.after", (event) => {
        attachNetFailure(event as never)
        attachTerminal(event as never, displays.get(event.id))
        displays.delete(event.id)
      })

      await catalog.refresh()
    },
  }
}

