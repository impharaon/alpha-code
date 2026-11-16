import { createEffect, createMemo, createResource, createSignal, For, Show, onCleanup, type JSX } from "solid-js"
import type { CandidateV1, SourceSearchResultV1 } from "../../main/plugin-sources"
import type { InstallOutcomeV1 } from "../../shared/plugin-install"
import { t } from "../i18n"
import { pluginSourceLabelKey } from "./ext-package-presentation"

/** Search owns pending selection only; main owns order, identity, installation and status. */
export function PluginSourceResults(props: {
  query: string
  search(query: string, progress?: (result: SourceSearchResultV1) => void): Promise<SourceSearchResultV1>
  install(candidate: CandidateV1): Promise<InstallOutcomeV1>
  /** The Hub renders its existing installed row/menu, without another management implementation. */
  installedMenu(packageId: string): JSX.Element
}) {
  const [query, setQuery] = createSignal(props.query)
  createEffect(() => {
    const next = props.query
    if (next === query()) return
    const timer = setTimeout(() => setQuery(next), 250)
    onCleanup(() => clearTimeout(timer))
  })
  const [progress, setProgress] = createSignal<SourceSearchResultV1>()
  let revision = 0
  onCleanup(() => { revision++ })
  const [result] = createResource(query, async value => {
    const current = ++revision
    setProgress(undefined)
    return props.search(value, partial => {
      if (current === revision && partial.query === props.query) setProgress(partial)
    })
  })
  const current = () => !result.error && result()?.query === props.query && !result.loading ? result() : progress()?.query === props.query ? progress() : undefined
  const candidates = createMemo(() => {
    const all = current()?.candidates ?? []
    return all.filter(
      (candidate) =>
        !candidate.sameAs || !all.some((other) => other.id === candidate.sameAs && other.id !== candidate.id),
    )
  })
  return (
    <section data-source-results="" aria-live="polite">
      <Show when={result.loading || query() !== props.query}>
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
        <Show when={!result.loading && !candidates().length && current()?.sources.every(source => source.status === "ok")}>
          <p class="codepuppy-ext-dnote">{t("codepuppy.ext.sourceNoMatches")}</p>
        </Show>
        <PluginSourceChoices candidates={candidates()} install={props.install} installedMenu={props.installedMenu} />
      </Show>
    </section>
  )
}


/** The same item row/action serves source queries and a captured marketplace's individual choices. */
export function PluginSourceChoices<C extends Pick<CandidateV1, "id" | "displayName" | "description" | "installed"> & { source: CandidateV1["source"] | "local-folder" }>(props: {
  candidates: C[]
  install(candidate: C): Promise<InstallOutcomeV1>
  installedMenu(packageId: string): JSX.Element
}) {
  const [busy, setBusy] = createSignal<string[]>([])
  const [errors, setErrors] = createSignal<Record<string, string>>({})
  const [installed, setInstalled] = createSignal<Record<string, string>>({})
  const install = async (candidate: C) => {
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
        <div class="codepuppy-ext-grid">
          <For each={props.candidates}>
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
  )
}
