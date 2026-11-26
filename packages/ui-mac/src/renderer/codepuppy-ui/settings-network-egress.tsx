import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import type { EgressSettings, NetworkEgressApi, SiteKey } from "../../shared/network-egress-wire"
import { Button } from "./Button"
import { t } from "../i18n"

export function SettingsNetworkEgress(props: { api?: NetworkEgressApi }) {
  const [settings, setSettings] = createSignal<EgressSettings>()
  const [failed, setFailed] = createSignal(false)
  const [busy, setBusy] = createSignal<string>()
  const [retry, setRetry] = createSignal<SiteKey>()
  createEffect(() => {
    const api = props.api
    if (!api) return
    let disposed = false
    let requested = 0
    const load = async () => {
      const current = ++requested
      try {
        const result = await api.settings()
        if (disposed || current !== requested) return
        if (!result.ok) { setFailed(true); return }
        setSettings(result.value)
      } catch { if (!disposed && current === requested) setFailed(true) }
    }
    const unsubscribe = api.subscribe((event) => { if (event.kind === "settings") void load() })
    void load()
    onCleanup(() => { disposed = true; unsubscribe() })
  })
  const available = () => { const current = settings(); return current?.available ? current : undefined }
  const revoke = async (site: SiteKey) => {
    if (busy() || !props.api) return
    setBusy(JSON.stringify(site))
    setFailed(false)
    try {
      const result = await props.api.revoke({ site })
      if (!result.ok) { setFailed(true); setRetry(site) }
      else setRetry(undefined)
    } catch { setFailed(true); setRetry(site) }
    finally { setBusy(undefined) }
  }
  return <Show when={available()}>{(current) => <section class="codepuppy-settings-section" data-network-egress-settings>
    <h3>{t("codepuppy.network.settingsTitle")}</h3>
    <p>{t("codepuppy.network.settingsScope")}</p>
    <Show when={failed()}><p role="alert">{t("codepuppy.network.revokeFailed")} <Show when={retry()}>{(site) => <Button size="sm" disabled={!!busy()} onClick={() => void revoke(site())}>{t("codepuppy.network.retry")}</Button>}</Show></p></Show>
    <Show when={current().persistence !== "ok"}><p role="alert">{t("codepuppy.network.storageFailed")}</p></Show>
    <Show when={!current().sites.length}><p>{t("codepuppy.network.noSites")}</p></Show>
    <For each={current().sites}>{(entry) => <div class="codepuppy-settings-row" data-network-egress-site={entry.site.value}>
      <div><strong>{entry.site.value}</strong><p>{t(entry.site.kind === "domain" ? "codepuppy.network.scope" : "codepuppy.network.hostScope", { site: entry.site.value })}</p><time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time></div>
      <Button size="sm" loading={busy() === JSON.stringify(entry.site)} disabled={!!busy()} onClick={() => void revoke(entry.site)}>{t("codepuppy.network.revoke")}</Button>
    </div>}</For>
    <h3>{t("codepuppy.network.passesTitle")}</h3>
    <p>{t("codepuppy.network.passesScope")}</p>
    <Show when={!current().passes.length}><p>{t("codepuppy.network.noPasses")}</p></Show>
    <For each={current().passes}>{(entry) => <div class="codepuppy-settings-row" data-network-egress-pass={`${entry.destination.host}:${entry.destination.port}`}>
      <div><strong>{entry.destination.host}:{entry.destination.port}</strong>
        <p>{t("codepuppy.network.passCount", { count: entry.count })}</p>
        <p>{t("codepuppy.network.firstPass")} <time dateTime={entry.firstAt}>{new Date(entry.firstAt).toLocaleString()}</time></p>
        <p>{t("codepuppy.network.lastPass")} <time dateTime={entry.lastAt}>{new Date(entry.lastAt).toLocaleString()}</time></p>
      </div>
    </div>}</For>
  </section>}</Show>
}
