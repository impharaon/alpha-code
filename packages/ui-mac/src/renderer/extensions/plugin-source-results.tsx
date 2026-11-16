import { createMemo, createResource, createSignal, For, Show, type JSX } from "solid-js"
import type { CandidateV1, SourceSearchResultV1 } from "../../main/plugin-sources"
import type { InstallOutcomeV1 } from "../../shared/plugin-install"
import { t } from "../i18n"
import { pluginSourceLabelKey } from "./ext-package-presentation"

/** Search owns pending selection only; main owns order, identity, installation and status. */
export function PluginSourceResults(props: {
  query: string
  search(query: string): Promise<SourceSearchResultV1>
  install(candidate: CandidateV1): Promise<InstallOutcomeV1>
  /** The Hub renders its existing installed row/menu, without another management implementation. */
  installedMenu(packageId: string): JSX.Element
}) {
  const [result] = createResource(() => props.query, props.search)
  const [busy, setBusy] = createSignal<string[]>([])
  const [errors, setErrors] = createSignal<Record<string, string>>({})
  const [installed, setInstalled] = createSignal<Record<string, string>>({})
  const current = () => (!result.loading && !result.error && result()?.query === props.query ? result() : undefined)
  const candidates = createMemo(() => {
    const all = current()?.candidates ?? []
    return all.filter(
      (candidate) =>
        !candidate.sameAs || !all.some((other) => other.id === candidate.sameAs && other.id !== candidate.id),
    )
  })
  const install = async (candidate: CandidateV1) => {
    if (busy().includes(candidate.id)) return
    setBusy((list) => [...list, candidate.id])
    setErrors((errors) => ({ ...errors, [candidate.id]: "" }))
    try {
      const outcome = await props.install(candidate)
      if (!outcome.ok) {
        setErrors((errors) => ({ ...errors, [candidate.id]: outcome.detail }))
        return
      }
      setInstalled((current) => ({ ...current, [candidate.id]: outcome.packageId }))
    } catch {
      setErrors((errors) => ({ ...errors, [candidate.id]: t("codepuppy.ext.sourceInstallFailed") }))
    } finally {
      setBusy((list) => list.filter((id) => id !== candidate.id))
    }
  }
  return (
    <section data-source-results="" aria-live="polite">
      <Show when={result.loading}>
        <p class="codepuppy-ext-dnote">{t("codepuppy.timeline.hub.searching", { name: props.query })}</p>
      </Show>
      <Show when={result.error}>
        <p class="codepuppy-ext-import-err">{t("codepuppy.ext.sourceSearchFailed")}</p>
      </Show>
      <For each={current()?.sources.filter((source) => source.status === "failed")}>
        {(source) => (
          <p class="codepuppy-ext-import-err">
            {t(pluginSourceLabelKey(source.source))}：{source.status === "failed" ? source.detail : ""}
          </p>
        )}
      </For>
      <Show when={current()}>
        <div class="codepuppy-ext-secrow">
          <span class="codepuppy-ext-overline">
            {t("codepuppy.ext.sourceSearchResults", { count: candidates().length })}
          </span>
        </div>
        <Show when={!candidates().length && current()?.sources.every(source => source.status === "ok")}>
          <p class="codepuppy-ext-dnote">{t("codepuppy.ext.sourceNoMatches")}</p>
        </Show>
        <div class="codepuppy-ext-grid">
          <For each={candidates()}>
            {(candidate) => {
              const packageId = () => candidate.installed?.packageId ?? installed()[candidate.id]
              return (
                <div data-source-candidate={candidate.id}>
                  <Show
                    when={packageId()}
                    fallback={
                      <div class="codepuppy-ext-kit">
                        <span class="codepuppy-ext-kit-ic">{candidate.displayName.slice(0, 1)}</span>
                        <div class="codepuppy-ext-kit-body">
                          <div class="codepuppy-ext-kit-ttl">
                            <b>{candidate.displayName}</b>
                            <span class="codepuppy-ext-chip">{t(pluginSourceLabelKey(candidate.source))}</span>
                          </div>
                          <div class="codepuppy-ext-kit-desc">{candidate.description}</div>
                          <Show when={errors()[candidate.id]}>
                            {(error) => <p class="codepuppy-ext-card-err">{error()}</p>}
                          </Show>
                          <Show when={busy().includes(candidate.id)}>
                            <span>{t("codepuppy.timeline.hub.installing", { name: candidate.displayName })}</span>
                          </Show>
                        </div>
                        <button
                          class="codepuppy-ext-add"
                          aria-label={t("codepuppy.ext.sourceInstallName", { name: candidate.displayName })}
                          disabled={busy().includes(candidate.id)}
                          onClick={() => void install(candidate)}
                        >
                          +
                        </button>
                      </div>
                    }
                  >
                    {(id) => props.installedMenu(id())}
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </Show>
    </section>
  )
}
