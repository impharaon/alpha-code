// #1713:项目配置视图的消息合同与 main 请求簿。形状不完整的消息不产生决定。
import { WITHHELD_KINDS, type ProjectConfigView } from "@opencode/schema/codepuppy-project-config"
export type ProjectConfigViewRequest = { type: "project-config-view"; id: string; directory: string }
export type ProjectConfigViewReply =
  | { type: "project-config-view-reply"; id: string; ok: true; view: ProjectConfigView }
  | { type: "project-config-view-reply"; id: string; ok: false; reason: "engine-not-ready" | "location-failed" }

export function buildProjectConfigViewRequest(id: string, directory: string): ProjectConfigViewRequest {
  return { type: "project-config-view", id, directory }
}
export function parseProjectConfigViewRequest(value: unknown): ProjectConfigViewRequest | undefined {
  if (
    !record(value) ||
    value.type !== "project-config-view" ||
    typeof value.id !== "string" ||
    !value.id ||
    typeof value.directory !== "string" ||
    !value.directory
  )
    return
  return buildProjectConfigViewRequest(value.id, value.directory)
}
export function buildProjectConfigViewReply(
  id: string,
  result: { ok: true; view: ProjectConfigView } | { ok: false; reason: "engine-not-ready" | "location-failed" },
): ProjectConfigViewReply {
  return { type: "project-config-view-reply", id, ...result }
}
export function parseProjectConfigViewReply(value: unknown): ProjectConfigViewReply | undefined {
  if (!record(value) || value.type !== "project-config-view-reply" || typeof value.id !== "string" || !value.id) return
  if (value.ok === false && (value.reason === "engine-not-ready" || value.reason === "location-failed"))
    return buildProjectConfigViewReply(value.id, { ok: false, reason: value.reason })
  if (value.ok !== true || !record(value.view)) return
  const view = value.view
  if (
    typeof view.directory !== "string" ||
    !view.directory ||
    typeof view.trusted !== "boolean" ||
    typeof view.complete !== "boolean" ||
    !record(view.points) ||
    !Array.isArray(view.withheld)
  )
    return
  if (
    view.points.config === undefined ||
    Object.entries(view.points).some(
      ([key, state]) =>
        !["config", "skill", "agent", "command"].includes(key) ||
        !["pending", "failed", "done"].includes(String(state)),
    )
  )
    return
  if (view.complete !== Object.values(view.points).every((state) => state === "done")) return
  if (view.trusted && view.withheld.length) return
  if (
    view.withheld.some(
      (item: unknown) =>
        !record(item) ||
        !WITHHELD_KINDS.includes(item.kind as never) ||
        typeof item.name !== "string" ||
        typeof item.file !== "string" ||
        (item.fields !== undefined &&
          (!Array.isArray(item.fields) || item.fields.some((field: unknown) => typeof field !== "string"))),
    )
  )
    return
  return buildProjectConfigViewReply(value.id, { ok: true, view: view as ProjectConfigView })
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value)

export function createProjectConfigViewRequester(
  post: (request: ProjectConfigViewRequest) => void,
  options: { timeoutMs?: number } = {},
) {
  const pending = new Map<
    string,
    { resolve: (view: ProjectConfigView | undefined) => void; timer: ReturnType<typeof setTimeout> }
  >()
  let sequence = 0
  let closed = false
  const settle = (id: string, view: ProjectConfigView | undefined) => {
    const entry = pending.get(id)
    if (!entry) return false
    pending.delete(id)
    clearTimeout(entry.timer)
    // 请求用 Location 路由,回复用规范身份;IPC 在准入身份上核对目录,这里仅按 id 对号。
    entry.resolve(view)
    return true
  }
  return {
    request(directory: string): Promise<ProjectConfigView | undefined> {
      if (closed) return Promise.resolve(undefined)
      const id = String(++sequence)
      return new Promise((resolve) => {
        const timer = setTimeout(() => settle(id, undefined), options.timeoutMs ?? 10_000)
        pending.set(id, { resolve, timer })
        try {
          post(buildProjectConfigViewRequest(id, directory))
        } catch {
          settle(id, undefined)
        }
      })
    },
    receive(message: unknown) {
      const reply = parseProjectConfigViewReply(message)
      return reply ? settle(reply.id, reply.ok ? reply.view : undefined) : false
    },
    close() {
      closed = true
      for (const id of pending.keys()) settle(id, undefined)
    },
  }
}
