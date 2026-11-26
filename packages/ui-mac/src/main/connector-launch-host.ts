import { realpathSync } from "node:fs"
import type { PinnedFileId } from "../../../util/src/codepuppy-pinned-files"
import type { PinnedFileProgress, PinnedFileReply } from "../../../util/src/codepuppy-connector-launch"
import { createPinnedFileAuthority, readPinnedFiles } from "./pinned-files"
import { sanitizeTransportError } from "./codepuppy-artifact-download"

// A host keeps the same authority through sidecar replacements. Different canonical app-data roots do not share files.
const authorities = new Map<string, ReturnType<typeof createPinnedFileAuthority>>()
export function pinnedFileAuthority(userData: string) {
  const root = realpathSync(userData)
  const existing = authorities.get(root)
  if (existing) return existing
  const authority = createPinnedFileAuthority({ userData: root, manifest: readPinnedFiles() })
  authorities.set(root, authority)
  return authority
}

/** Only this generation's built-in IDs reach the downloader; paths/URLs never cross the port. */
export function createPinnedFileMainBridge(files: Pick<ReturnType<typeof createPinnedFileAuthority>, "ensureFile">, sidecarGeneration: string, post: (message: PinnedFileReply | PinnedFileProgress) => void) {
  const pending = new Map<number, { controller: AbortController; result: Promise<void> }>()
  let stopped = false
  const send = (message: PinnedFileReply | PinnedFileProgress) => { if (!stopped) { try { post(message) } catch { /* The sidecar may have exited while I/O settled. */ } } }
  return {
    receive(value: unknown) {
      if (!value || typeof value !== "object" || !("type" in value) || !["codepuppy.pinned-file.ensure", "codepuppy.pinned-file.cancel"].includes(String(value.type))) return false
      if (stopped || !("id" in value) || typeof value.id !== "number" || !Number.isSafeInteger(value.id) || value.id <= 0) return true
      const id = value.id
      if (!("sidecarGeneration" in value) || typeof value.sidecarGeneration !== "string") return true
      if (value.sidecarGeneration !== sidecarGeneration) {
        send({ type: "codepuppy.pinned-file.result", id, sidecarGeneration: value.sidecarGeneration, delivery: { result: { ok: false, error: "cancelled" } } })
        return true
      }
      if (value.type === "codepuppy.pinned-file.cancel") {
        if (Object.keys(value).length === 3) pending.get(id)?.controller.abort()
        return true
      }
      if (Object.keys(value).length !== 4 || !("fileId" in value) || typeof value.fileId !== "string") {
        send({ type: "codepuppy.pinned-file.result", id, sidecarGeneration, delivery: { result: { ok: false, error: "unknown-file" }, failure: { kind: "other", detail: "invalid pinned file request" } } })
        return true
      }
      if (pending.has(id)) return true
      const controller = new AbortController()
      const fileId = value.fileId as PinnedFileId
      const result = Promise.resolve().then(() => files.ensureFile(fileId, controller.signal, (received, total) => send({ type: "codepuppy.pinned-file.progress", id, sidecarGeneration, received, total }))).then((delivery) => {
        pending.delete(id)
        send({ type: "codepuppy.pinned-file.result", id, sidecarGeneration, delivery })
      }, (error) => {
        pending.delete(id)
        send({ type: "codepuppy.pinned-file.result", id, sidecarGeneration, delivery: { result: { ok: false, error: "disk" }, failure: { kind: "disk", detail: sanitizeTransportError(error instanceof Error ? error.message : String(error)) } } })
      })
      pending.set(id, { controller, result })
      return true
    },
    async dispose() {
      stopped = true
      for (const entry of pending.values()) entry.controller.abort()
      await Promise.all([...pending.values()].map((entry) => entry.result))
      pending.clear()
    },
  }
}
