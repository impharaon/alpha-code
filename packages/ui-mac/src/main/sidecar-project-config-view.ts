// #1713:sidecar 用进程内请求等 Location 激活,再读同一引擎包里的视图。
import type { ProjectConfigView } from "@opencode/schema/codepuppy-project-config"
import type { EngineFetch } from "./in-process-engine"
import { buildProjectConfigViewReply, type ProjectConfigViewRequest } from "./project-config-view-message"

export async function answerProjectConfigView(
  request: ProjectConfigViewRequest,
  input: {
    fetch: EngineFetch | undefined
    view: ((directory: string) => ProjectConfigView | undefined) | undefined
    timeoutMs?: number
  },
) {
  if (!input.fetch || !input.view)
    return buildProjectConfigViewReply(request.id, { ok: false, reason: "engine-not-ready" })
  const fetch = input.fetch
  const view = input.view
  const timeoutMs = input.timeoutMs ?? 5_000
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const responses = await Promise.race([
      Promise.all(
        ["command", "agent", "skill"].map((name) =>
          fetch(
            new Request(`http://codepuppy-sidecar.invalid/api/${name}`, {
              headers: { "x-opencode-directory": encodeURIComponent(request.directory) },
            }),
          ),
        ),
      ),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs)
      }),
    ])
    clearTimeout(timer)
    if (!responses || responses.some((response) => !response.ok))
      return buildProjectConfigViewReply(request.id, { ok: false, reason: "location-failed" })
    const deadline = Date.now() + timeoutMs
    while (Object.values(view(request.directory)?.points ?? {}).includes("pending") && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20))
    const result = view(request.directory)
    return result
      ? buildProjectConfigViewReply(request.id, { ok: true, view: result })
      : buildProjectConfigViewReply(request.id, { ok: false, reason: "location-failed" })
  } catch {
    return buildProjectConfigViewReply(request.id, { ok: false, reason: "location-failed" })
  } finally {
    clearTimeout(timer)
  }
}
