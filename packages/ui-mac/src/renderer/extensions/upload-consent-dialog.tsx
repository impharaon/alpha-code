import { createStore } from "solid-js/store"
import { createEffect, For, Show } from "solid-js"
import type { UploadFindingKind, UploadPreview } from "../../preload/types"
import { Button } from "../codepuppy-ui/Button"
import { Dialog } from "../codepuppy-ui/Dialog"
import { t } from "../i18n"
import "./upload-consent.css"

const icon = (path: string) => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>
)

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function findingText(kind: UploadFindingKind, count: number) {
  const values = { n: count }
  if (kind === "contact") return t("codepuppy.cloud.consent.findContact", values)
  if (kind === "identity") return t("codepuppy.cloud.consent.findIdentity", values)
  if (kind === "credential") return t("codepuppy.cloud.consent.findCredential", values)
  if (kind === "protected") return t("codepuppy.cloud.consent.findProtected", values)
  return t("codepuppy.cloud.consent.findUnknown", values)
}

export function UploadConsentDialog(props: {
  state: { requestId: string; preview: UploadPreview } | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
  restoreFocus?: () => HTMLElement | null | undefined
}) {
  const [view, setView] = createStore({ expanded: false })
  const preview = () => props.state?.preview
  createEffect(() => {
    void props.state?.requestId
    setView("expanded", false)
  })

  return (
    <Dialog
      open={!!props.state}
      onClose={props.onCancel}
      dismissible={!props.busy}
      busy={props.busy}
      besideSidebar
      size="md"
      title={t("codepuppy.cloud.consent.title")}
      restoreFocus={props.restoreFocus}
      footer={
        <>
          <Button variant="ghost" autofocus disabled={props.busy} onClick={props.onCancel}>
            {t("codepuppy.cloud.consent.cancel")}
          </Button>
          <Button variant="primary" loading={props.busy} onClick={props.onConfirm}>
            {t("codepuppy.cloud.consent.cta")}
          </Button>
        </>
      }
    >
      <Show when={preview()}>
        {(value) => (
          <div class="codepuppy-upl">
            <p class="codepuppy-upl-intro">
              {t("codepuppy.cloud.consent.introPrefix")} <b>{t("codepuppy.cloud.consent.pipelineReview")}</b>
              {t("codepuppy.cloud.consent.introSuffix")}
            </p>

            <div class="codepuppy-upl-flag">
              <span class="fic">{icon("M8 1.8 14 13H2L8 1.8ZM8 5.4v3.4M8 11.2h.01")}</span>
              <span class="ft">
                <b>{t("codepuppy.cloud.consent.flagTitle")}</b>
                <ul>
                  <For each={value().findings}>{(finding) => <li>{findingText(finding.kind, finding.fileCount)}</li>}</For>
                </ul>
              </span>
            </div>

            <div class="codepuppy-upl-scope">
              <span class="sic">{icon("M2.5 4.2h4l1.2 1.5h5.8v7H2.5z")}</span>
              <span class="stxt">
                <b>{t("codepuppy.cloud.consent.scopeFiles")}</b>
                <small>{t("codepuppy.cloud.consent.scopeHint")}</small>
              </span>
              <span class="scount">{t("codepuppy.cloud.consent.scopeCount", { n: value().fileCount, size: formatBytes(value().totalBytes) })}</span>
            </div>

            <div class="codepuppy-upl-box">
              <Show when={view.expanded}>
                <For each={value().files}>
                  {(file) => (
                    <div class="codepuppy-upl-file" data-flag={file.sensitive ? "" : undefined}>
                      <span class="dic">{icon("M4 1.8h5l3 3v9.4H4zM9 1.8v3h3")}</span>
                      <span class="path" title={file.path}>{file.path}</span>
                      <Show when={file.sensitive}>
                        <span class="chip">{t("codepuppy.cloud.consent.fileFlag")}</span>
                      </Show>
                      <span class="size">{formatBytes(file.sizeBytes)}</span>
                    </div>
                  )}
                </For>
              </Show>
              <button
                type="button"
                class="codepuppy-upl-more"
                data-open={view.expanded ? "" : undefined}
                aria-expanded={view.expanded}
                onClick={() => setView("expanded", (open) => !open)}
              >
                {icon("M5.5 3.5 10 8l-4.5 4.5")}
                <span>{view.expanded ? t("codepuppy.cloud.consent.previewCollapse") : t("codepuppy.cloud.consent.preview")}</span>
                <span class="grow" />
                <span class="tot">{t("codepuppy.cloud.consent.scopeCount", { n: value().fileCount, size: formatBytes(value().totalBytes) })}</span>
              </button>
            </div>

            <div class="codepuppy-upl-meta">
              <div class="codepuppy-upl-mrow">
                <span class="mic">{icon("M2.5 8h8M8 4.5 11.5 8 8 11.5M13.5 3v10")}</span>
                <span class="k">{t("codepuppy.cloud.consent.purposeLabel")}</span>
                <span class="v"><b>{t("codepuppy.cloud.consent.pipelineReview")}</b> — {t("codepuppy.cloud.consent.purposeReview")}</span>
              </div>
              <div class="codepuppy-upl-mrow">
                <span class="mic">{icon("M3 3.5h10M5 3.5V2h6v1.5M4.5 5.5l.7 8h5.6l.7-8")}</span>
                <span class="k">{t("codepuppy.cloud.consent.retentionLabel")}</span>
                <span class="v">{t("codepuppy.cloud.consent.retentionStandard")}</span>
              </div>
            </div>

            <div class="codepuppy-upl-withdraw">
              {icon("M8 1.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 8 1.8M8 5v3.5M8 11h.01")}
              <span>{t("codepuppy.cloud.consent.withdraw")}</span>
            </div>
            <p class="codepuppy-upl-note">
              <b>{t("codepuppy.cloud.consent.coversTitle")}</b> {t("codepuppy.cloud.consent.coversNote")}
            </p>
          </div>
        )}
      </Show>
    </Dialog>
  )
}
