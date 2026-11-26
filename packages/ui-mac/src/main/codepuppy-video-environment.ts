import path from "node:path"
import type { CodePuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import { VIDEO_DECLARATION_ID } from "../shared/video-service"
let root: string | undefined
/** Consume only the same-generation host bootstrap; never derive the launcher's cache layout here. */
export function publishVideoEnvironment(bootstrap: CodePuppyBootstrap) {
  const launchers: unknown = Reflect.get(bootstrap, "launchers")
  const roots: unknown =
    launchers && typeof launchers === "object" ? Reflect.get(launchers, "firstPartyCacheRoots") : undefined
  const value: unknown = roots && typeof roots === "object" ? Reflect.get(roots, VIDEO_DECLARATION_ID) : undefined
  root = typeof value === "string" && path.isAbsolute(value) ? value : undefined
}
export const videoCacheRoot = () => root
