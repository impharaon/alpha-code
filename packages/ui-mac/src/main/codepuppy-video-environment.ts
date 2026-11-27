import type { CodePuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import { VIDEO_DECLARATION_ID } from "../shared/video-service"
let root: string | undefined
/** Consume only the same-generation host bootstrap; never derive the launcher's cache layout here. */
export function publishVideoEnvironment(bootstrap: CodePuppyBootstrap) {
  // The parser already proved the map's keys and absolute values; a build without the video entry has no root.
  root = bootstrap.launchers?.firstPartyCacheRoots[VIDEO_DECLARATION_ID]
}
export const videoCacheRoot = () => root
