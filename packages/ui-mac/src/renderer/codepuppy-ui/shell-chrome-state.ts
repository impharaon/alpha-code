// Seam between the persistent window chrome (top bar + rail, mounted by the sidebar) and the session
// workspace: the top bar exposes one slot for the page title. Top-level pages (new chat, Customization
// Center, automation, settings) get their title from the chrome; the session workspace renders its
// breadcrumb and status pills into the slot via `topbarTitleHost`. Module-level signal — there is a
// single chrome — mirroring sidebar-state.ts.
//
// The right panel's open/close state is NOT here: it is the one app-wide signal in
// session-workspace/right-panel-state.ts, which the top bar's right toggle reads and writes.

import { createSignal } from "solid-js"

const [titleHost, setTitleHost] = createSignal<HTMLElement | undefined>()

/** The top bar's title slot (undefined until the chrome is mounted, e.g. in component harnesses). */
export const topbarTitleHost = titleHost
export const setTopbarTitleHost = setTitleHost
