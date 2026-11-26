import type { Entry } from "./host-extension-package-contract/plugin-package"

export function pluginEntryRuntimeAvailable(entry: Entry): boolean {
  if (["skill", "command", "agent", "mcp"].includes(entry.kind)) return true
  return (
    entry.kind === "hook" &&
    ((entry.hook.type === "command" &&
      [
        "SessionStart",
        "UserPromptSubmit",
        "Stop",
        "PreToolUse",
        "PostToolUse",
        "PostToolUseFailure",
        "StopFailure",
        "PermissionRequest",
        "UserPromptExpansion",
        "ConfigChange",
        "PostToolBatch",
        "PreCompact",
        "PostCompact",
      ].includes(entry.hook.event)) ||
      (entry.hook.type === "prompt" && entry.hook.event === "PreToolUse"))
  )
}
