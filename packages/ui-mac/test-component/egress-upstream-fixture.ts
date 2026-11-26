import type { Socket } from "node:net"
import type { EgressProxyDeps } from "../src/main/network-egress-proxy"

// Existing proxy fixtures supply TCP peers; adapt their connection event to N7's ready tunnel.
export function testEgressDial(connect: (host: string, port: number) => Socket): NonNullable<EgressProxyDeps["dial"]> {
  return (target, routes, policy, signal) => new Promise((resolve, reject) => {
    if (policy.kind !== "existing-authorization") { reject(new Error("use the real upstream for allow-all checks")); return }
    const socket = connect(target.host, target.port)
    const abort = () => { socket.destroy(); reject(signal.reason) }
    socket.on("error", () => {})
    socket.once("error", reject)
    socket.once("close", () => signal.removeEventListener("abort", abort))
    signal.addEventListener("abort", abort, { once: true })
    socket.once("connect", () => resolve({ socket, route: routes[0]! }))
  })
}
