import { createHash } from "node:crypto"
import type { RegisteredTool } from "./policy/identity"
import { mcpEffectiveName, normalizeToolName } from "./policy/identity"
import { registeredByMcpLayer } from "../../schema/src/codepuppy-tool-policy"

/** Preserve the definition object so core's existing identity mapping retains the real executor. */
export function aliasPluginMcpTools<T>(tools: Record<string, T>, registered: readonly RegisteredTool[], servers: readonly { hostName: string; sourceName: string; packageId: string }[]) {
  const aliases = new Map<string, string>()
  for (const server of servers) for (const tool of registered) {
    const name = mcpEffectiveName(server.hostName, tool.name)
    if (name.length <= 64 || !(name in tools) || tool.id !== name || !registeredByMcpLayer(tool, server.hostName, tool.name)) continue
    const identity = JSON.stringify([server.packageId, "mcp", server.sourceName, tool.name])
    const hash = createHash("sha256").update(identity).digest("hex").slice(0, 10)
    const alias = server.hostName + "_" + normalizeToolName(tool.name).slice(0, 64 - server.hostName.length - 12) + "_" + hash
    aliases.set(alias, name)
    tools[alias] = tools[name]!
    delete tools[name]
  }
  return aliases
}
