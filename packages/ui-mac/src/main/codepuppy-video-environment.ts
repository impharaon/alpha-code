import type { CodePuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import type { ManagedPinnedFilesResult } from "@opencode/util/codepuppy-connector-launch"
import type { PinnedFileId } from "@opencode/util/codepuppy-pinned-files"
import { codecExecutable, codecRecipeId } from "../../resources/video-mcp/assets"
import { VIDEO_DECLARATION_ID } from "../shared/video-service"
let root: string | undefined
let ffprobe: (() => Promise<string | undefined>) | undefined
/**
 * Consume only the same-generation host bootstrap; never derive the launcher's cache layout here. `prepare` is this
 * generation's launcher authority preparing a video recipe entry; without launchers there is no prepared codec.
 */
export function publishVideoEnvironment(bootstrap: CodePuppyBootstrap, prepare?: (id: PinnedFileId) => Promise<ManagedPinnedFilesResult>) {
  // The parser already proved the map's keys and absolute values; a build without the video entry has no root.
  root = bootstrap.launchers?.firstPartyCacheRoots[VIDEO_DECLARATION_ID]
  const platform = bootstrap.launchers?.platform
  const id = platform && codecRecipeId(platform)
  ffprobe = prepare && platform && id
    ? async () => {
        const prepared = await prepare(id as PinnedFileId)
        return prepared.ok ? codecExecutable(prepared.files[0]!.path, "ffprobe", platform) : undefined
      }
    : undefined
}
export const videoCacheRoot = () => root
export const videoFfprobe = () => ffprobe
