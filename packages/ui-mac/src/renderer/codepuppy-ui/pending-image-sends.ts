import { createSignal } from "solid-js"
import type { Message, ModelRef, Part, UserMessage } from "../../engine-adapter/contract/v1"
import { v1PromptModelFields } from "./composer-state"
import { t } from "../i18n"
import { pushToast } from "./Toast"

// Renderer-only: these records never enter the engine's history or request body.
type Pending = { message: UserMessage; parts: Part[]; after?: string }
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
  const waiting = [...queue]
  const seen = observed.get(sessionID) ?? new Set<string>()
  for (const message of messages) {
    if (message.role !== "user") continue
    seen.add(message.id)
    // Older history pages are not acknowledgements of a new send.
    const parts = partsOf(message.id)
    if (!parts.length) continue
    const index = waiting.findIndex((entry) =>
      (!entry.after || message.id > entry.after) && imageSendContent(parts) === imageSendContent(entry.parts),
    )
    if (index >= 0) waiting.splice(index, 1)
  }
  observed.set(sessionID, seen)
  if (waiting.length !== queue.length) setPending((all) => ({ ...all, [sessionID]: waiting }))
  return {
    // message.updated precedes parts: hide that empty frame while submitted images stay visible.
    messages: [...messages.filter((message) => message.role !== "user" || partsOf(message.id).length ||
      !waiting.some((item) => !item.after || message.id > item.after)), ...waiting.map((item) => item.message)],
    partsOf: (id: string) => waiting.find((item) => item.message.id === id)?.parts ?? partsOf(id),
  }
}

function imageSendContent(parts: Part[]) {
  return JSON.stringify([
    parts.flatMap((part) => part.type === "text" && !part.synthetic ? [part.text] : []),
    parts.flatMap((part) => part.type === "file" && part.mime.startsWith("image/") ? [part.filename] : []),
  ])
}
