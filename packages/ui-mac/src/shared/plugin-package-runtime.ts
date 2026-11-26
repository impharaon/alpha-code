import type { Entry } from "./host-extension-package-contract/plugin-package"

export function pluginEntryRuntimeAvailable(entry: Entry): boolean {
  if (["skill", "command", "agent", "mcp"].includes(entry.kind)) return true
  return (
    entry.kind === "hook" &&
    entry.hook.scope.kind === "package" &&
    entry.hook.type === "command" &&
    ["SessionStart", "UserPromptSubmit"].includes(entry.hook.event)
  )
}
