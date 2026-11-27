import type { Session, WebContents } from "electron"

/** Shared preview/export invariants. Protocol handlers and resource maps remain with each job. */
export function hardenPreviewSession(
  session: Session,
  input: {
    scheme: string
    packaged: boolean
    kind: "html" | "pdf"
    blocked: (url: string) => void
    download?: () => void
  },
) {
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
  session.setDevicePermissionHandler?.(() => false)
  session.on("will-download", (event) => {
    event.preventDefault()
    input.download?.()
  })
  session.webRequest.onBeforeRequest((details, callback) => {
    const allowed =
      details.url.startsWith(`${input.scheme}://`) ||
      (!input.packaged && details.url.startsWith("devtools://")) ||
      (input.kind === "pdf" &&
        (details.url.startsWith("chrome-extension://") || details.url.startsWith("chrome://resources/")))
    if (!allowed) input.blocked(details.url)
    callback({ cancel: !allowed })
  })
}
export function hardenPreviewContents(contents: WebContents, carrier: "html-preview" | "rail-preview" | "document") {
  contents.setWindowOpenHandler(() => ({ action: "deny" }))
  contents.on("will-navigate", (event) => event.preventDefault())
  contents.on("will-redirect", (event) => event.preventDefault())
  if (carrier !== "rail-preview") contents.on("will-frame-navigate", (event) => event.preventDefault())
  contents.on("will-attach-webview", (event) => event.preventDefault())
}
