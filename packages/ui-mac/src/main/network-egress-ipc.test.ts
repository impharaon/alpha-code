import { expect, test } from "bun:test"
import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron"
import { registerNetworkEgressIpcHandlers } from "./network-egress-ipc"
import { createNetworkEgressActivity } from "./network-egress-activity"
import { createNetworkEgressApproval } from "./network-egress-approval"

test("批准 IPC 只接受产品窗口 main frame 和严格输入，档位不接受旧代或未知会话", async () => {
  const activity = createNetworkEgressActivity()
  activity.attach(1, () => {}, { session: async (ref) => ref.sessionID === "ses_known" ? {} : undefined, shell: async () => true })
  const service = createNetworkEgressApproval({ available: true, activity, store: { read: () => ({ ok: true, absent: true, sites: [] }), write: () => {} }, log: () => {} })
  const handlers = new Map<string, Parameters<IpcMain["handle"]>[1]>()
  const events: unknown[] = []
  const sender = { mainFrame: {}, send: (_channel: string, event: unknown) => { events.push(event) } } as unknown as WebContents
  registerNetworkEgressIpcHandlers({ ipc: { handle: (name, handler) => { handlers.set(name, handler) } }, windows: () => [{ webContents: sender }], service })
  const event = { sender, senderFrame: sender.mainFrame } as IpcMainInvokeEvent
  const invoke = (method: string, input?: unknown, source = event) => handlers.get(`network-egress-${method}`)!(source, input)
  const session = { generation: 1, sessionID: "ses_known", directory: "/project" }
  try {
    expect(await invoke("set-tier", { session, tier: "allow" }, { ...event, senderFrame: {} } as IpcMainInvokeEvent)).toEqual({ ok: false, code: "invalid-input" })
    expect(await invoke("set-tier", { session, tier: "allow" }, { ...event, sender: { mainFrame: event.senderFrame } } as IpcMainInvokeEvent)).toEqual({ ok: false, code: "invalid-input" })
    expect(await invoke("set-tier", { session, tier: "allow", agent: "build" })).toEqual({ ok: false, code: "invalid-input" })
    expect(await invoke("set-tier", { session: { ...session, generation: 0 }, tier: "allow" })).toEqual({ ok: false, code: "unavailable" })
    expect(await invoke("set-tier", { session: { ...session, sessionID: "ses_missing" }, tier: "allow" })).toEqual({ ok: false, code: "unavailable" })
    expect(await invoke("set-tier", { session, tier: "ask" })).toMatchObject({ ok: true })
    expect(await activity.tier(session)).toBe("ask")
    expect(events.length).toBeGreaterThan(0)
    expect(await invoke("decide", { requestID: "made-up", decision: "allow-persist" })).toEqual({ ok: false, code: "not-found" })
    expect(await invoke("decide", { requestID: "made-up", decision: "allow-persist", host: "anything.com" })).toEqual({ ok: false, code: "invalid-input" })
    expect(await invoke("revoke", { site: { kind: "domain", value: "*.com" } })).toEqual({ ok: false, code: "invalid-input" })
  } finally { service.close() }
})

test("没有围栏服务时返回不可用能力，不创建存储或批准通路", async () => {
  const handlers = new Map<string, Parameters<IpcMain["handle"]>[1]>()
  const sender = { mainFrame: {} } as unknown as WebContents
  registerNetworkEgressIpcHandlers({ ipc: { handle: (name, handler) => { handlers.set(name, handler) } }, windows: () => [{ webContents: sender }] })
  expect(await handlers.get("network-egress-settings")!({ sender, senderFrame: sender.mainFrame } as IpcMainInvokeEvent, undefined)).toEqual({ ok: true, value: { available: false } })
})
