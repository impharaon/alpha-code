import { createEffect, ErrorBoundary, on, type JSX, type ParentProps } from "solid-js"

// A Solid ErrorBoundary stays on its fallback until it is reset, and the session route instance is
// shared by every conversation on a server (the route does not remount when the id changes). Without a
// reset, one "conversation not found" leaves the route stuck on that page whatever the user opens next.
// `resetOn` is the identity the failure belongs to (the session id): when it changes, the boundary
// goes back to its children.
export function ResettingErrorBoundary(
  props: ParentProps<{ resetOn: () => unknown; fallback: (error: unknown) => JSX.Element }>,
) {
  let reset: (() => void) | undefined
  createEffect(
    on(
      props.resetOn,
      () => {
        const pending = reset
        reset = undefined
        pending?.()
      },
      { defer: true },
    ),
  )
  return (
    <ErrorBoundary
      fallback={(error, resetBoundary) => {
        reset = resetBoundary
        return props.fallback(error)
      }}
    >
      {props.children}
    </ErrorBoundary>
  )
}
