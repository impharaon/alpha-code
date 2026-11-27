import type { InstructionDiscovery } from "../instruction-discovery.js"
import { basename } from "path"

export function pluginInstructionSource(
  path: string,
  scope: NonNullable<InstructionDiscovery.File["source"]>["scope"],
): InstructionDiscovery.File["source"] {
  const name = basename(path)
  if (name !== "CLAUDE.md" && name !== "CLAUDE.local.md" && !path.replaceAll("\\", "/").includes("/.claude/rules/")) return
  return { sourcePath: path, scope: name === "CLAUDE.local.md" ? "Local" : scope }
}
