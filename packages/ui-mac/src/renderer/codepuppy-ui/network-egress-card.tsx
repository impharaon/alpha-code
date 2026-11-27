import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import type { EgressApproval, EgressDecision, EgressDecisionReceipt, NetworkEgressApi, SessionRef } from "../../shared/network-egress-wire"
import { createNetworkEgressFeed, networkSessionRef } from "./network-egress"
import { sandboxApplied, sandboxGeneration } from "./sandbox-state"
import { Button } from "./Button"
import { RiskTag } from "./RiskTag"
import { t } from "../i18n"
import "./permission-dialog.css"

export function SessionNetworkEgressCards(props: { identity: () => { serverKey: string; directory: string; sessionID: string } | undefined }) {
  const [session, setSession] = createSignal<SessionRef>()
  createEffect(() => {
    const identity = props.identity()
    sandboxGeneration()
    const applied = sandboxApplied()
    setSession(undefined)
    if (!identity || !applied || !window.api?.networkEgress) return
    let stale = false
    void networkSessionRef(identity).then((value) => { if (!stale) setSession(value) }, () => {})
    onCleanup(() => { stale = true })
  })
  return <Show when={session()} keyed>{(bound) => <NetworkEgressCards session={bound} api={window.api.networkEgress} />}</Show>
}

export function NetworkEgressCards(props: { session: SessionRef; api: NetworkEgressApi }) {
  const feed = createNetworkEgressFeed(props.api, props.session)
  const [rememberFailed, setRememberFailed] = createSignal(false)
  onCleanup(feed.dispose)
  return <div data-network-egress-cards>
    <Show when={feed.state.failed}><p role="alert">{t("codepuppy.network.readFailed")} <Button size="sm" onClick={() => void feed.load()}>{t("codepuppy.network.retry")}</Button></p></Show>
    <Show when={rememberFailed()}><p role="alert">{t("codepuppy.network.rememberFailed")}</p></Show>
    <For each={feed.state.cards.filter((request) => request.state !== "resolved")}>{(request) => <NetworkEgressCard request={request} api={props.api} ready={feed.state.ready} onReceipt={(receipt) => setRememberFailed(receipt.persistenceError === "io")} />}</For>
  </div>
}

export function NetworkEgressCard(props: { request: EgressApproval; api: NetworkEgressApi; ready: boolean; onReceipt(receipt: EgressDecisionReceipt): void }) {
  const [busy, setBusy] = createSignal<EgressDecision>()
  const [failed, setFailed] = createSignal(false)
  let disposed = false
  onCleanup(() => { disposed = true })
  const decide = async (decision: EgressDecision) => {
    if (busy() || !props.ready) return
    setBusy(decision)
    setFailed(false)
    try {
      const result = await props.api.decide({ requestID: props.request.requestID, decision })
      if (result.ok) props.onReceipt(result.value)
      if (disposed) return
      if (!result.ok) { setFailed(true); return }
    } catch { if (!disposed) setFailed(true) }
    finally { if (!disposed) setBusy(undefined) }
  }
  return <section class="a-permission-panel a-network-egress-card" data-network-egress-request={props.request.requestID} aria-label={t("codepuppy.network.title")} aria-busy={busy() ? "true" : undefined}>
    <header class="a-permission-panel-header"><strong class="a-permission-panel-title">{t("codepuppy.network.title")}</strong><RiskTag level="unknown" /></header>
    <div class="a-permission-panel-body">
      <div class="a-permission-resources"><code>{props.request.destination.host}:{props.request.destination.port}</code></div>
      {/* No recipients: no conversation was running tools, so main showed it to the viewed conversation (design §4.9). */}
      <p>{t(props.request.recipients.length ? "codepuppy.network.unknown" : "codepuppy.network.viewed")}</p>
      <p>{t(props.request.site.kind === "domain" ? "codepuppy.network.scope" : "codepuppy.network.hostScope", { site: props.request.site.value })}</p>
      <Show when={props.request.state === "connection-expired"}><p role="status">{t(props.request.recipients.length ? "codepuppy.network.expired" : "codepuppy.network.viewedExpired")}</p></Show>
      <Show when={failed()}><p role="alert">{t("codepuppy.network.decideFailed")}</p></Show>
    </div>
    <Show when={props.request.state !== "resolved"}>
      <footer class="a-permission-panel-footer a-permission-actions">
        <Button variant="danger" disabled={!!busy() || !props.ready} onClick={() => void decide("deny")} data-network-egress-decision="deny">{t("codepuppy.network.deny")}</Button>
        <Button disabled={!!busy() || !props.ready} onClick={() => void decide("allow-persist")} data-network-egress-decision="allow-persist">{t("codepuppy.network.remember")}</Button>
        <Button variant="primary" loading={busy() === "allow-session"} disabled={!!busy() || !props.ready} onClick={() => void decide("allow-session")} data-network-egress-decision="allow-session">{t("codepuppy.network.allow")}</Button>
      </footer>
    </Show>
  </section>
}
