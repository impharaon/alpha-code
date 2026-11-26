import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron"
import { hasEgressKeys, isEgressDecision, parseSessionRef, parseSiteKey } from "../shared/network-egress-wire"
import type { NetworkEgressApprovalService } from "./network-egress-approval"

export function registerNetworkEgressIpcHandlers(deps: {
  ipc: Pick<IpcMain, "handle">
  windows(): Pick<BrowserWindow, "webContents">[]
  service?: NetworkEgressApprovalService
}) {
  const invalid = { ok: false, code: "invalid-input" } as const
  const unavailable = { ok: false, code: "unavailable" } as const
  const trusted = (event: IpcMainInvokeEvent) => event.senderFrame === event.sender.mainFrame && deps.windows().some((window) => window.webContents === event.sender)
  deps.ipc.handle("network-egress-set-tier", (event, input: unknown) => {
    if (!trusted(event) || !hasEgressKeys(input, ["session", "tier"])) return invalid
    const session = parseSessionRef(input.session)
    if (!session || (input.tier !== "allow" && input.tier !== "ask" && input.tier !== "readonly")) return invalid
    return deps.service?.api.setTier({ session, tier: input.tier }) ?? unavailable
  })
  deps.ipc.handle("network-egress-list-approvals", (event, input: unknown) => {
    if (!trusted(event) || !hasEgressKeys(input, ["session"])) return invalid
    const session = parseSessionRef(input.session)
    if (!session) return invalid
    return deps.service?.api.listApprovals({ session }) ?? unavailable
  })
  deps.ipc.handle("network-egress-decide", (event, input: unknown) => {
    if (!trusted(event) || !hasEgressKeys(input, ["requestID", "decision"]) || typeof input.requestID !== "string" || !isEgressDecision(input.decision)) return invalid
    return deps.service?.api.decide({ requestID: input.requestID, decision: input.decision }) ?? unavailable
  })
  deps.ipc.handle("network-egress-settings", (event, input: unknown) => {
    if (!trusted(event) || input !== undefined) return invalid
    return deps.service?.api.settings() ?? { ok: true, value: { available: false } }
  })
  deps.ipc.handle("network-egress-revoke", (event, input: unknown) => {
    if (!trusted(event) || !hasEgressKeys(input, ["site"])) return invalid
    const site = parseSiteKey(input.site)
    if (!site) return invalid
    return deps.service?.api.revoke({ site }) ?? unavailable
  })
  return deps.service?.api.subscribe((event) => {
    deps.windows().forEach((window) => window.webContents.send("network-egress-change", event))
  })
}
