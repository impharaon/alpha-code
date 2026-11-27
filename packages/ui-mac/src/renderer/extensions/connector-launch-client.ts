import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import type { LaunchSnapshot } from "../../../../util/src/codepuppy-connector-launch"
import type { ServerInfo } from "../sidebar/use-projects"

/** Re-read main's current projection; list is authoritative over delayed subscription notifications. */
export function useConnectorLaunchSnapshots(
  directory: Accessor<string | undefined>,
  server: Accessor<ServerInfo | undefined>,
) {
  const [rows, setRows] = createSignal<LaunchSnapshot[]>([])
  const api = window.api?.connectorLaunch
  let local: Promise<string> | undefined
  let revision = 0
  let disposed = false
  const refresh = async () => {
    const current = ++revision
    const dir = directory()
    if (!api || !dir) return
    try {
      local ??= window.api.awaitInitialization().then((value) => value.url)
      const url = await local
      if (disposed || current !== revision || server()?.baseUrl !== url) return
      const result = await api.list(dir)
      if (!disposed && revision === current) setRows(result)
    } catch {
      /* Keep the last current projection if this read is temporarily unavailable. */
    }
  }
  createEffect(() => {
    const dir = directory()
    const info = server()
    revision++
    setRows([])
    if (!api || !dir || !info) return
    onCleanup(
      api.subscribe(() => {
        void refresh()
      }),
    )
    onCleanup(
      window.api.sidecarGeneration.subscribe(() => {
        local = undefined
        setRows([])
        void refresh()
      }),
    )
    void refresh()
  })
  onCleanup(() => {
    disposed = true
    revision++
  })
  return () => rows().filter((row) => row.identity.directory === directory())
}
