import type { WslServersState } from "@opencode-ai/app/wsl/types"

export function readyWslConnections(state?: WslServersState) {
  return (state?.servers ?? []).flatMap((item) => {
    if (item.runtime.kind !== "ready") return []
    return [
      {
        displayName: item.config.distro,
        label: "WSL",
        type: "sidecar" as const,
        variant: "wsl" as const,
        distro: item.config.distro,
        // I8:renderer 不持有引擎口令(WSL 引擎的认证头同样由 main 补)。
        http: { url: item.runtime.url },
      },
    ]
  })
}

// REQ-040 谓词本体移 shared(REQ-042:main 侧 getDefaultServerUrl 也要用);re-export 保住既有 import 面与单测。
export { isEphemeralLocalServerUrl } from "../../shared/ephemeral-server-url"

export function availableStartupServer(defaultServer: string | null | undefined, state?: WslServersState) {
  const key = defaultServer ?? "sidecar"
  if (!key.startsWith("wsl:")) return key
  if (state?.servers.some((item) => item.config.id === key && item.runtime.kind === "ready")) return key
  return "sidecar"
}
