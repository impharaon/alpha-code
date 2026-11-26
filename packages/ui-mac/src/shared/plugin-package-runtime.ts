import type { Entry } from "./host-extension-package-contract/plugin-package"

export function pluginEntryRuntimeAvailable(entry: Entry): boolean {
  if (["skill", "command", "agent", "mcp"].includes(entry.kind)) return true
  return (
    entry.kind === "hook" &&
    entry.hook.scope.kind === "package" &&
    ((entry.hook.type === "command" &&
      ["SessionStart", "UserPromptSubmit", "Stop", "PreToolUse", "PostToolUse"].includes(entry.hook.event)) ||
      (entry.hook.type === "prompt" && entry.hook.event === "PreToolUse"))
  )
}
