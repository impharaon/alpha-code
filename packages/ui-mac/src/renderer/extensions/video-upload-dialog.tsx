import { createSignal, onCleanup, onMount } from "solid-js"
import type { UploadPreview } from "../../preload/types"
import { activeSessionIdentity } from "../codepuppy-ui/active-session-directory"
import { UploadConsentDialog } from "./upload-consent-dialog"

/** The same privacy card and confirm/cancel IPC; video adds no selection dialog. */
export function VideoUploadDialog() {
  const [state, setState] = createSignal<{ requestId: string; preview: UploadPreview } | null>(null)
  const [busy, setBusy] = createSignal(false)
  let disposed = false
  const refresh = async () => {
    const identity = activeSessionIdentity()
    const values = await window.api.cloud.videoUploads(
      identity ? { sessionID: identity.sessionID, directory: identity.directory } : undefined,
    )
    if (!disposed) setState(values[0] ?? null)
  }
  onMount(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 500)
    onCleanup(() => {
      disposed = true
      clearInterval(timer)
    })
  })
  const confirm = async () => {
    const value = state()
    if (!value) return
    setBusy(true)
    try {
      await window.api.cloud.confirmUpload(value.requestId)
    } finally {
      setBusy(false)
      if (!disposed) await refresh()
    }
  }
  const cancel = async () => {
    const value = state()
    if (value) await window.api.cloud.cancelUpload(value.requestId)
    await refresh()
  }
  return (
    <UploadConsentDialog
      state={state()}
      busy={busy()}
      onConfirm={() => void confirm()}
      onCancel={() => void cancel()}
    />
  )
}
