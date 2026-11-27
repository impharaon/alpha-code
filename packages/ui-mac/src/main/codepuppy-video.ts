import path from "node:path"
import { expandFirstPartyCommand } from "@opencode/core/mcp/codepuppy-first-party-mcp"
import type { CodePuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import { VIDEO_DECLARATION_ID, VIDEO_SERVICE_COMMAND } from "../shared/video-service"

export function codepuppyVideoDefinition(bootstrap: CodePuppyBootstrap) {
  const launchers = bootstrap.launchers
  if (!launchers) return undefined
  return videoServerDefinition((template) =>
    expandFirstPartyCommand(template, path.dirname(path.dirname(bootstrap.paths.officeMcpManifest)), launchers, VIDEO_DECLARATION_ID),
  )
}

export function videoServerDefinition(expand: (template: readonly string[]) => string[]) {
  // Keep processing notifications and frame results on the existing direct MCP path.
  return { type: "local" as const, command: expand(VIDEO_SERVICE_COMMAND), environment: {}, enabled: true, codemode: false }
}
