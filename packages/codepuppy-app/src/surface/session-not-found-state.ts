import { createSignal } from "solid-js"

// The window chrome (ui-mac top bar) names the page: while the "conversation not found" page is on
// screen it reads this to write 「找不到对话」 in the top bar. One window, one page: a module signal.
const [shown, setShown] = createSignal(false)

export const sessionNotFoundShown = shown
export const setSessionNotFoundShown = setShown
