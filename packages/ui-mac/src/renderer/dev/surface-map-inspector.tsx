import { Icon } from "@opencode-ai/ui/icon"
import { useLocation } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { Portal } from "solid-js/web"
import {
  FRONTEND_SURFACE_MANIFEST,
  FRONTEND_SURFACE_MANIFEST_VERSION,
  frontendSurfaceById,
  frontendSurfaceIdForRoute,
  type FrontendSurfaceEntry,
  type FrontendSurfaceLineage,
  type FrontendSurfaceMount,
} from "../../shared/frontend-surface-manifest"
import { parseRoute } from "../../shared/route-manifest"
import { automationOpen } from "../automations/automation-state"
import { extHubOpen } from "../extensions/ext-hub-state"
import { t } from "../i18n"
import {
  activeSurfaceIds,
  filterSurfaceMap,
  surfaceRuntimeState,
  type SurfaceMapLineageFilter,
  type SurfaceMapMountFilter,
} from "./surface-map-model"
import "./surface-map-inspector.css"

const lineageLabel = (lineage: FrontendSurfaceLineage) => {
  if (lineage === "codepuppy") return t("codepuppy.brand.short")
  if (lineage === "opencode") return t("codepuppy.surfaceMap.upstream")
  return t("codepuppy.surfaceMap.hybrid")
}

const mountLabel = (kind: FrontendSurfaceMount["kind"]) => {
  if (kind === "route") return t("codepuppy.surfaceMap.route")
  if (kind === "overlay") return t("codepuppy.surfaceMap.overlay")
  if (kind === "inline") return t("codepuppy.surfaceMap.inline")
  return t("codepuppy.surfaceMap.boot")
}

export default function SurfaceMapInspector() {
  const location = useLocation()
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [lineage, setLineage] = createSignal<SurfaceMapLineageFilter>("all")
  const [mount, setMount] = createSignal<SurfaceMapMountFilter>("all")
  const currentRoute = createMemo(() => frontendSurfaceIdForRoute(parseRoute(location.pathname, location.search)))
  const active = createMemo(() =>
    activeSurfaceIds(currentRoute(), {
      extensions: extHubOpen(),
      automations: automationOpen(),
      inspector: open(),
    }),
  )
  const filtered = createMemo(() => filterSurfaceMap(query(), lineage(), mount()))
  const routeSurfaces = FRONTEND_SURFACE_MANIFEST.filter(
    (surface: FrontendSurfaceEntry) => surface.mount.kind === "route",
  )
  const counts = (value: FrontendSurfaceLineage) =>
    FRONTEND_SURFACE_MANIFEST.filter((surface) => surface.lineage === value).length

  let trigger: HTMLButtonElement | undefined
  let panel: HTMLElement | undefined
  let search: HTMLInputElement | undefined
  let previousFocus: HTMLElement | undefined

  const show = () => {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    queueMicrotask(() => previousFocus?.focus())
  }
  const toggle = () => (open() ? close() : show())

  createEffect(() => {
    if (!open()) return
    queueMicrotask(() => search?.focus())
  })

  const onShortcut = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLocaleLowerCase() !== "m") return
    event.preventDefault()
    toggle()
  }
  document.addEventListener("keydown", onShortcut)
  onCleanup(() => document.removeEventListener("keydown", onShortcut))

  const onPanelKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== "Tab" || !panel) return
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.offsetParent !== null)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
      return
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        class="a-ui a-smap-trigger"
        aria-label={t("codepuppy.surfaceMap.open")}
        aria-keyshortcuts="Meta+Shift+M Control+Shift+M"
        onClick={show}
      >
        <Icon name="code-lines" size="small" />
        <span>MAP</span>
        <kbd>{navigator.userAgent.includes("Mac") ? "⌘⇧M" : "Ctrl⇧M"}</kbd>
      </button>

      <Show when={open()}>
        <Portal>
          <main
            ref={panel}
            class="a-ui a-smap-root"
            role="dialog"
            aria-modal="true"
            aria-labelledby="a-smap-title"
            onKeyDown={onPanelKeyDown}
          >
            <header class="a-smap-header">
              <div>
                <div class="a-overline">{t("codepuppy.surfaceMap.inspector", { version: FRONTEND_SURFACE_MANIFEST_VERSION })}</div>
                <h1 id="a-smap-title">{t("codepuppy.surfaceMap.title")}</h1>
                <p>{t("codepuppy.surfaceMap.description")}</p>
              </div>
              <div class="a-smap-header-meta" aria-label={t("codepuppy.surfaceMap.currentRoute")}>
                <span>{t("codepuppy.surfaceMap.router")}</span>
                <code>{location.pathname + location.search}</code>
                <span>{t("codepuppy.surfaceMap.shell")}</span>
                <code>{window.location.pathname}</code>
              </div>
              <button type="button" class="a-smap-close" aria-label={t("codepuppy.surfaceMap.close")} onClick={close}>
                <Icon name="close" />
              </button>
            </header>

            <div class="a-smap-scroll">
              <section class="a-smap-summary" aria-label={t("codepuppy.surfaceMap.summary")}>
                <button
                  type="button"
                  class="a-smap-stat"
                  data-lineage="codepuppy"
                  aria-pressed={lineage() === "codepuppy"}
                  onClick={() => setLineage(lineage() === "codepuppy" ? "all" : "codepuppy")}
                >
                  <span>{t("codepuppy.brand.short")}</span><strong>{counts("codepuppy")}</strong><small>{t("codepuppy.surfaceMap.owned")}</small>
                </button>
                <button
                  type="button"
                  class="a-smap-stat"
                  data-lineage="opencode"
                  aria-pressed={lineage() === "opencode"}
                  onClick={() => setLineage(lineage() === "opencode" ? "all" : "opencode")}
                >
                  <span>{t("codepuppy.surfaceMap.upstream")}</span><strong>{counts("opencode")}</strong><small>{t("codepuppy.surfaceMap.upstreamImplementation")}</small>
                </button>
                <button
                  type="button"
                  class="a-smap-stat"
                  data-lineage="hybrid"
                  aria-pressed={lineage() === "hybrid"}
                  onClick={() => setLineage(lineage() === "hybrid" ? "all" : "hybrid")}
                >
                  <span>{t("codepuppy.surfaceMap.hybrid")}</span><strong>{counts("hybrid")}</strong><small>{t("codepuppy.surfaceMap.seam")}</small>
                </button>
                <div class="a-smap-stat a-smap-stat--current">
                  <span>{t("codepuppy.surfaceMap.currentRoute")}</span>
                  <strong>{frontendSurfaceById(currentRoute() ?? "")?.label ?? t("codepuppy.surfaceMap.unknown")}</strong>
                  <small>{currentRoute() ?? location.pathname}</small>
                </div>
              </section>

              <section class="a-smap-section" aria-labelledby="a-smap-flow-title">
                <div class="a-smap-section-head">
                  <div><span class="a-overline">{t("codepuppy.surfaceMap.navigationAbi")}</span><h2 id="a-smap-flow-title">{t("codepuppy.surfaceMap.routeFlow")}</h2></div>
                  <p>{t("codepuppy.surfaceMap.routeFlowDetail")}</p>
                </div>
                <div class="a-smap-route-flow">
                  <For each={routeSurfaces}>
                    {(surface) => (
                      <article class="a-smap-route-node" data-active={active().has(surface.id) ? "" : undefined}>
                        <div class="a-smap-route-top">
                          <span class="a-smap-lineage" data-lineage={surface.lineage}>{lineageLabel(surface.lineage)}</span>
                          <Show when={active().has(surface.id)}><span class="a-smap-active">{t("codepuppy.surfaceMap.current")}</span></Show>
                        </div>
                        <code>{surface.mount.kind === "route" ? surface.mount.path : ""}</code>
                        <strong>{surface.label}</strong>
                        <div class="a-smap-route-next">
                          <For each={surface.transitions.filter((transition) => transition.target.startsWith("route."))}>
                            {(transition) => <span>→ {transition.label}: {frontendSurfaceById(transition.target)?.label}</span>}
                          </For>
                        </div>
                      </article>
                    )}
                  </For>
                </div>
              </section>

              <section class="a-smap-section" aria-labelledby="a-smap-inventory-title">
                <div class="a-smap-section-head a-smap-section-head--inventory">
                  <div><span class="a-overline">{t("codepuppy.surfaceMap.canonicalInventory")}</span><h2 id="a-smap-inventory-title">{t("codepuppy.surfaceMap.inventory")}</h2></div>
                  <div class="a-smap-filters">
                    <label class="a-smap-search">
                      <span>{t("codepuppy.sidebar.search")}</span>
                      <div><Icon name="magnifying-glass" size="small" /><input ref={search} value={query()} onInput={(event) => setQuery(event.currentTarget.value)} placeholder={t("codepuppy.surfaceMap.searchPlaceholder")} /></div>
                    </label>
                    <label>
                      <span>{t("codepuppy.surfaceMap.mountType")}</span>
                      <select value={mount()} onChange={(event) => setMount(event.currentTarget.value as SurfaceMapMountFilter)}>
                        <option value="all">{t("codepuppy.surfaceMap.all")}</option>
                        <option value="route">{t("codepuppy.surfaceMap.route")}</option>
                        <option value="overlay">{t("codepuppy.surfaceMap.overlay")}</option>
                        <option value="inline">{t("codepuppy.surfaceMap.inline")}</option>
                        <option value="boot">{t("codepuppy.surfaceMap.boot")}</option>
                      </select>
                    </label>
                    <Show when={lineage() !== "all" || mount() !== "all" || query()}>
                      <button type="button" class="a-smap-reset" onClick={() => { setQuery(""); setLineage("all"); setMount("all") }}>{t("codepuppy.surfaceMap.clearFilters")}</button>
                    </Show>
                  </div>
                </div>

                <div class="a-smap-list" aria-live="polite">
                  <Show when={filtered().length > 0} fallback={<div class="a-smap-empty"><strong>{t("codepuppy.surfaceMap.noMatches")}</strong><span>{t("codepuppy.surfaceMap.noMatchesDetail")}</span></div>}>
                    <For each={filtered()}>
                      {(surface) => {
                        const runtime = () => surfaceRuntimeState(surface)
                        return (
                          <article class="a-smap-card" data-active={active().has(surface.id) ? "" : undefined}>
                            <div class="a-smap-card-title">
                              <div>
                                <span class="a-smap-lineage" data-lineage={surface.lineage}>{lineageLabel(surface.lineage)}</span>
                                <span class="a-smap-mount">{mountLabel(surface.mount.kind)}</span>
                                <Show when={active().has(surface.id)}><span class="a-smap-active">{t("codepuppy.surfaceMap.mounted")}</span></Show>
                              </div>
                              <h3>{surface.label}</h3>
                              <code>{surface.id}</code>
                            </div>
                            <p class="a-smap-description">{surface.description}</p>
                            <dl class="a-smap-facts">
                              <div><dt>{t("codepuppy.surfaceMap.owner")}</dt><dd><code>{surface.owner}</code></dd></div>
                              <div><dt>{t("codepuppy.surfaceMap.mount")}</dt><dd>{mountDescription(surface.mount)}</dd></div>
                              <div><dt>{t("codepuppy.surfaceMap.runtime")}</dt><dd><strong>{runtime().mode}</strong><span>{runtime().detail}</span></dd></div>
                              <div><dt>{t("codepuppy.surfaceMap.source")}</dt><dd><code title={surface.source}>{surface.source}</code></dd></div>
                            </dl>
                            <div class="a-smap-paths">
                              <div><span>{t("codepuppy.surfaceMap.entrypoints")}</span><p>{surface.entrypoints.join(" · ")}</p></div>
                              <div><span>{t("codepuppy.surfaceMap.transitions")}</span><p>{surface.transitions.map((transition) => `${transition.label} → ${frontendSurfaceById(transition.target)?.label ?? transition.target}`).join(" · ")}</p></div>
                            </div>
                          </article>
                        )
                      }}
                    </For>
                  </Show>
                </div>
              </section>
            </div>
          </main>
        </Portal>
      </Show>
    </>
  )
}

function mountDescription(mount: FrontendSurfaceMount) {
  if (mount.kind === "route") return `${mount.path} · ${mount.role}`
  if (mount.kind === "inline") return `${mount.route} · ${mount.slot}`
  if (mount.kind === "boot") return `${mount.host} · ${mount.phase}`
  return mount.host
}
