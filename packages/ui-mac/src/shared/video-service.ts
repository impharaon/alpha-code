export const VIDEO_DECLARATION_ID = "video"
export const VIDEO_SERVICE_COMMAND = [
  "{codepuppyNode}",
  "{codepuppyResources}/video-mcp/server.js",
  "{workspace}",
  "--cache-root",
  "{codepuppyCacheRoot}",
] as const
