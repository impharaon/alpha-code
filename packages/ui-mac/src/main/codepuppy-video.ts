import path from "node:path"
import type { CodePuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import { VIDEO_DECLARATION_ID, VIDEO_SERVICE_COMMAND } from "../shared/video-service"

// The producer is #1760. Keep its absence explicit while this consumer lands first;
// there is deliberately no local Node-path expansion or interpreter fallback.
const firstParty = await import("@opencode/core/mcp/codepuppy-first-party-mcp")

export function codepuppyVideoDefinition(bootstrap: CodePuppyBootstrap) {
  const launchers: unknown = Reflect.get(bootstrap, "launchers")
  const expand: unknown = Reflect.get(firstParty, "expandFirstPartyCommand")
  if (!launchers || typeof expand !== "function") return undefined
  return videoServerDefinition((template) =>
    expand(template, path.dirname(path.dirname(bootstrap.paths.officeMcpManifest)), launchers, VIDEO_DECLARATION_ID),
  )
}

export function videoServerDefinition(expand: (template: readonly string[]) => string[]) {
  // Keep processing notifications and frame results on the existing direct MCP path.
  return { type: "local" as const, command: expand(VIDEO_SERVICE_COMMAND), environment: {}, enabled: true, codemode: false }
}
