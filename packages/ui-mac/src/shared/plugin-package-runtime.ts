import type { Entry } from "./host-extension-package-contract/plugin-package"

export function pluginEntryRuntimeAvailable(entry: Entry): boolean {
  if (["skill", "command", "agent", "mcp", "monitor"].includes(entry.kind)) return true
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
        "InstructionsLoaded",
        "SubagentStart",
        "SubagentStop",
        "Elicitation",
        "ElicitationResult",
      ].includes(entry.hook.event)) ||
      (entry.hook.type === "prompt" && ["PreToolUse", "PermissionRequest", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "UserPromptSubmit", "UserPromptExpansion", "Stop", "SubagentStop"].includes(entry.hook.event)))
  )
}
