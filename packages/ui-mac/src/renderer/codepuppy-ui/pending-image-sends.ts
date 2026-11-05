import { createSignal } from "solid-js"
import type { Message, ModelRef, Part, UserMessage } from "@opencode-ai/sdk/v2/client"
import { v1PromptModelFields } from "./composer-state"
import { t } from "../i18n"
import { pushToast } from "./Toast"

// Renderer-only: these records never enter the engine's history or request body.
type Pending = { message: UserMessage; parts: Part[]; realID?: string; after?: string }
const [pending, setPending] = createSignal<Record<string, Pending[]>>({})
const observed = new Map<string, Set<string>>()
let sequence = 0

export function stageImageSend(sessionID: string, parts: unknown[], options?: { agent?: string; model?: ModelRef }) {
  const input = parts as Part[] // Both callers pass the existing prompt parts, before engine-assigned IDs.
  if (!input.some((part) => part.type === "file" && part.mime.startsWith("image/"))) return
  const id = `pending-image-${++sequence}`
  const model = v1PromptModelFields(options?.model) as { model?: UserMessage["model"] }
  const item: Pending = {
    after: [...(observed.get(sessionID) ?? [])].sort().at(-1),
    message: {
      id,
      sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: options?.agent ?? "",
      model: model.model ?? { providerID: "", modelID: "" },
    },
    parts: input.map((part, index) => ({ ...part, id: `${id}-${index}`, sessionID, messageID: id })),
  }
  setPending((all) => ({ ...all, [sessionID]: [...(all[sessionID] ?? []), item] }))
  return () => setPending((all) => ({ ...all, [sessionID]: (all[sessionID] ?? []).filter((entry) => entry !== item) }))
}

export function failImageSends(sessionID?: string) {
  const all = pending()
  const ids = sessionID ? [sessionID] : Object.keys(all)
  if (!ids.some((id) => all[id]?.length)) return
  setPending(Object.fromEntries(Object.entries(all).filter(([id]) => !ids.includes(id))))
  pushToast({ kind: "error", title: t("codepuppy.composer.sendFailed") })
}

export function projectImageSends(sessionID: string, messages: Message[], partsOf: (id: string) => Part[]) {
  const queue = pending()[sessionID] ?? []
  const seen = observed.get(sessionID) ?? new Set<string>()
  for (const message of messages) {
    if (message.role !== "user" || seen.has(message.id)) continue
    // Older history pages are not acknowledgements of a new send.
    const item = queue.find((entry) => !entry.realID && (!entry.after || message.id > entry.after))
    if (item) item.realID = message.id
    seen.add(message.id)
  }
  observed.set(sessionID, seen)
  // message.updated precedes its parts. Keep the submitted image visible until the real
  // parts reach the same store, so a split SSE batch cannot produce an empty frame.
  const waiting = queue.filter(
    (item) =>
      !item.realID ||
      ["text", "file"].some(
        (type) =>
          partsOf(item.realID!).filter((part) => part.type === type).length <
          item.parts.filter((part) => part.type === type).length,
      ),
  )
  if (waiting.length !== queue.length) setPending((all) => ({ ...all, [sessionID]: waiting }))
  return {
    messages: [...messages, ...waiting.filter((item) => !item.realID).map((item) => item.message)],
    partsOf: (id: string) => waiting.find((item) => (item.realID ?? item.message.id) === id)?.parts ?? partsOf(id),
  }
}
