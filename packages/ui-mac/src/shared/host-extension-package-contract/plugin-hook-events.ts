export const PLUGIN_HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "UserPromptExpansion", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "StopFailure", "PermissionRequest", "SessionEnd", "Notification", "PermissionDenied", "FileChanged", "CwdChanged", "ConfigChange", "InstructionsLoaded", "SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted", "TeammateIdle", "PreCompact", "PostCompact", "Elicitation", "ElicitationResult", "PostToolBatch"] as const

export const UNAVAILABLE_PLUGIN_HOOKS = {
  "PermissionDenied": "The host has no auto-mode model classifier rejection event",
  "CwdChanged": "Shell cwd does not persist between tool calls",
  "TaskCreated": "The host has no stable TaskCreate identity",
  "TaskCompleted": "The host has no stable TaskUpdate completion identity",
  "TeammateIdle": "The host has no named team member lifecycle"
} as const
