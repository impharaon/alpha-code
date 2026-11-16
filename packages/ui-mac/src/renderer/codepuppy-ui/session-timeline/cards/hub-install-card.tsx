import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import type { HubRequestRecord, HubView } from "../../../../main/codepuppy-sidecar-messages"
import type { InstalledPackageV1 } from "../../../../preload/types"
import { t } from "../../../i18n"
import { extIpc } from "../../../extensions/ext-ipc"
import { openPackageManagement } from "../../../extensions/ext-hub-state"
import { installedPackagePresentation } from "../../../extensions/ext-package-presentation"
import type { TimelineRow } from "../timeline-model"
import { useTimelineIntents } from "./timeline-intents"
import { redactText } from "./tool-redactor"

type HubInstallRow = Extract<TimelineRow, { kind: "hubInstall" }>
type Facts = {
  record: HubRequestRecord | null
  pack?: InstalledPackageV1
  view?: HubView
  authorization?: Awaited<ReturnType<typeof extIpc.packageAuthorization>>
  error?: string
}

function safeText(text: string) {
  const result = redactText(text, 4000)
  return result.ok ? result.value : t("codepuppy.timeline.hub.hidden")
}

/** Read-only install receipt. Stage completion is separate from the engine's availability. */
export function HubInstallCard(props: { row: HubInstallRow }) {
  const intents = useTimelineIntents()
  const [facts, setFacts] = createSignal<Facts>({ record: null })
  createEffect(
    on(
      () => props.row.install,
      (call) => {
        setFacts({ record: null })
        if (call.operation === "search" || (!call.requestId && !call.packageId)) return
        let alive = true
        let revision = 0
        let timer: ReturnType<typeof setTimeout> | undefined
        const refresh = async () => {
          clearTimeout(timer)
          const current = ++revision
          const next = await (async (): Promise<Facts> => {
            const record = call.requestId ? await extIpc.hubRequest(call.requestId) : null
            const packageId = record?.packageId ?? call.packageId
            if (!packageId) return { record }
            const [packages, view, authorization] = await Promise.all([
              extIpc.installedPackages(),
              extIpc.hubView(intents.cloudDirectory),
              extIpc.packageAuthorization(packageId),
            ])
            return {
              record,
              pack: packages.ok ? packages.packages.find((pack) => pack.packageId === packageId) : undefined,
              view,
              authorization,
              ...(!packages.ok ? { error: packages.reason } : {}),
            }
          })().catch(
            (error: unknown): Facts => ({
              record: null,
              error: error instanceof Error ? error.message : String(error),
            }),
          )
          if (!alive || current !== revision) return
          setFacts(next)
          const row = next.view?.rows.find((row) => row.id === next.pack?.packageId)
          // Runtime MCP changes can complete without a Location reload report. Keep reading while pending.
          if (
            (next.record?.stage === "submitted" || !next.pack || row?.state === "reload-pending" || next.error) &&
            next.record?.stage !== "failed"
          )
            timer = setTimeout(() => void refresh(), 1000)
        }
        const off = extIpc.onHubViewChanged(() => void refresh())
        void refresh()
        onCleanup(() => {
          alive = false
          clearTimeout(timer)
          off()
        })
      },
    ),
  )

  const presentation = createMemo(() => {
    const call = props.row.install
    const current = facts()
    const pack = current.pack
    const name = safeText(pack?.displayName ?? current.record?.displayName ?? pack?.rootComponentName ?? call.name)
    const record = current.record
    const source = pack ? installedPackagePresentation(pack) : undefined
    const base = { name, source, detail: undefined as string | undefined, manage: undefined as string | undefined }
    if (call.operation === "search")
      return { ...base, state: "search", title: t("codepuppy.timeline.hub.searching", { name }) }
    if (!call.requestId && !call.packageId)
      return { ...base, state: "result", title: call.result ?? t("codepuppy.timeline.hub.installing", { name }) }
    if (record?.stage === "failed")
      return {
        ...base,
        state: "failed",
        title: t("codepuppy.timeline.hub.failed"),
        detail: record.outcome && !record.outcome.ok ? safeText(record.outcome.detail) : call.result,
      }
    if (record?.stage === "submitted" || (!pack && !record?.packageId && !call.packageId))
      return {
        ...base,
        state: "installing",
        title: t("codepuppy.timeline.hub.installing", { name }),
        detail: current.error,
      }
    const added = t("codepuppy.timeline.hub.added", { name })
    if (source?.notRunning.length)
      return {
        ...base,
        state: "failed",
        title: added,
        detail: t("codepuppy.timeline.hub.failed"),
        manage: pack?.packageId,
      }
    const auth = current.authorization?.ok ? current.authorization.items : []
    const login = auth.find((item) => item.kind === "mcp-oauth" && !item.authenticated && item.status === "needs_auth")
    if (login)
      return {
        ...base,
        state: "login",
        title: added,
        detail: t("codepuppy.timeline.hub.login", { name: safeText(login.serviceName) }),
      }
    if (auth.some((item) => item.kind === "secret" && !item.saved))
      return { ...base, state: "token", title: added, detail: t("codepuppy.timeline.hub.token") }
    const row = current.view?.rows.find((row) => row.id === pack?.packageId)
    if (pack?.desiredState === "enabled" && row?.state === "available")
      return {
        ...base,
        state: "available",
        title: t("codepuppy.timeline.hub.available", { name }),
        manage: pack.packageId,
      }
    if (pack && (pack.desiredState !== "enabled" || (row && row.state !== "reload-pending")))
      return {
        ...base,
        state: "failed",
        title: added,
        detail: `${t("codepuppy.timeline.hub.failed")} ${safeText(row?.stateReason?.detail ?? t("codepuppy.timeline.hub.disabled"))}`,
        manage: pack.packageId,
      }
    return {
      ...base,
      state: "pending",
      title: added,
      detail: safeText(current.error ?? row?.stateReason?.detail ?? t("codepuppy.timeline.hub.unverified")),
    }
  })
  return (
    <div class="a-tl-row" data-codepuppy-timeline-row="hubInstall">
      <div class="a-tc-safe" role="status" aria-live="polite" data-install-state={presentation().state}>
        <b>{presentation().title}</b>
        <Show when={presentation().state === "pending"}>
          <span>{t("codepuppy.timeline.hub.applying")}</span>
        </Show>
        <Show when={presentation().detail}>{(detail) => <span>{detail()}</span>}</Show>
        <Show when={presentation().source}>
          {(source) => (
            <>
              <span>
                {t("codepuppy.ext.packageSource")}：{t(source().sourceKey)}
              </span>
              <For each={source().notRunning}>
                {(item) => (
                  <span>
                    {safeText(item.sourceName)}：{t(item.reasonKey)}
                  </span>
                )}
              </For>
            </>
          )}
        </Show>
        <Show when={presentation().manage}>
          {(packageId) => (
            <div class="a-tc-actions">
              <button type="button" class="a-tc-open" onClick={() => openPackageManagement(packageId())}>
                {t("codepuppy.timeline.hub.manage")}
              </button>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}
