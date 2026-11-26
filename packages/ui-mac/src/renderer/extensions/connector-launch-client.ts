import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import type { LaunchSnapshot } from "../../../../util/src/codepuppy-connector-launch"
import type { ServerInfo } from "../sidebar/use-projects"

/** Re-read main's current projection; list is authoritative over delayed subscription notifications. */
export function useConnectorLaunchSnapshots(
  directory: Accessor<string | undefined>,
  server: Accessor<ServerInfo | undefined>,
) {
  const [rows, setRows] = createSignal<LaunchSnapshot[]>([])
  const [local, setLocal] = createSignal<string>()
  const api = window.api?.connectorLaunch
  let revision = 0
  let disposed = false
  const refresh = async () => {
    const current = ++revision
    const dir = directory()
    if (!api || !dir || !local() || server()?.baseUrl !== local()) {
      setRows([])
      return
    }
    try {
      const result = await api.list(dir)
      if (!disposed && revision === current) setRows(result)
    } catch {
      if (!disposed && revision === current) setRows([])
    }
  }
  if (api) {
    void window.api
      .awaitInitialization()
      .then((value) => {
        if (!disposed) setLocal(value.url)
      })
      .catch(() => {})
    onCleanup(
      api.subscribe(() => {
        void refresh()
      }),
    )
    onCleanup(
      window.api.sidecarGeneration.subscribe(() => {
        setRows([])
        void refresh()
      }),
    )
  }
  createEffect(() => {
    directory()
    server()
    local()
    setRows([])
    void refresh()
  })
  onCleanup(() => {
    disposed = true
    revision++
  })
  return (name: string) => rows().find((row) => row.identity.directory === directory() && row.identity.server === name)
}
