import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, afterEach, expect, spyOn, test } from "bun:test"
import appPlugin from "@opencode-ai/app/vite"
import { build } from "vite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { createNetworkEgressActivity } from "../../main/network-egress-activity"
import { createNetworkEgressApproval } from "../../main/network-egress-approval"
import type { NetworkOutbound } from "../../shared/network-egress-wire"

const directory = mkdtempSync(join(tmpdir(), "codepuppy-network-render-"))
await build({ configFile: false, logLevel: "silent", plugins: [appPlugin.at(-1)!], build: { outDir: directory, lib: { entry: join(import.meta.dir, "network-egress-test-runtime.tsx"), formats: ["es"], fileName: () => "runtime.js" }, rollupOptions: { output: { inlineDynamicImports: true } } } })
GlobalRegistrator.register()
const runtime = await import(pathToFileURL(join(directory, "runtime.js")).href) as typeof import("./network-egress-test-runtime")
const originalApi = Object.getOwnPropertyDescriptor(window, "api")
const disposers: Array<() => void> = []
afterEach(() => { disposers.splice(0).reverse().forEach((dispose) => dispose()); document.body.replaceChildren(); runtime.setSandboxStateForTests(undefined); if (originalApi) Object.defineProperty(window, "api", originalApi); else Reflect.deleteProperty(window, "api") })
afterAll(() => { rmSync(directory, { recursive: true, force: true }) })
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

async function fixture(failWrite = false) {
  const activity = createNetworkEgressActivity()
  let ready: (() => void) | undefined
  const post = (message: NetworkOutbound) => { if (message.type === "codepuppy.network.activity.reply") ready?.() }
  activity.attach(1, post, { session: async () => ({}), shell: async () => true })
  const session = (sessionID: string) => ({ generation: 1, sessionID, directory: "/project" })
  await new Promise<void>((resolve) => {
    ready = resolve
    activity.receive({ type: "codepuppy.network.snapshot", id: 1, seq: 1, generation: 1, activities: ["ses_a", "ses_b"].map((sessionID) => ({ kind: "tool", invocationID: sessionID, ref: { ...session(sessionID), messageID: "msg_a", callID: sessionID }, tool: "shell" })) }, post)
  })
  const service = createNetworkEgressApproval({ available: true, activity, store: { read: () => ({ ok: true, absent: true, sites: [] }), write: () => { if (failWrite) throw new Error("io") } }, log: () => {} })
  disposers.push(service.close)
  const mount = (sessionID: string) => {
    const host = document.createElement("div")
    document.body.append(host)
    disposers.push(runtime.render(() => runtime.createComponent(runtime.NetworkEgressCards, { session: session(sessionID), api: service.api }), host))
    return host
  }
  return { activity, service, mount }
}

test("真实 main 批准在两个对话渲染同一未知来源卡片，拒绝同步到两个副本", async () => {
  const f = await fixture()
  const request = f.service.request("a.example.com", 443)
  const a = f.mount("ses_a")
  const b = f.mount("ses_b")
  await flush()
  for (const host of [a, b]) {
    expect(host.textContent).toContain("a.example.com:443")
    expect(host.textContent).toContain("无法确定发起方")
    expect(host.querySelectorAll("[data-network-egress-decision]")).toHaveLength(3)
  }
  expect(a.querySelector("section")?.getAttribute("data-network-egress-request")).toBe(b.querySelector("section")?.getAttribute("data-network-egress-request"))
  a.querySelector<HTMLElement>('[data-network-egress-decision="deny"]')!.click()
  expect(await request).toBe("user-denied")
  await flush()
  expect(a.querySelectorAll("[data-network-egress-request]")).toHaveLength(0)
  expect(b.querySelectorAll("[data-network-egress-request]")).toHaveLength(0)
})

test("记住范围直接显示主域与端口语义，保存失败仍在已允许卡片明确显示", async () => {
  const f = await fixture(true)
  const request = f.service.request("a.example.com", 443)
  const host = f.mount("ses_a")
  await flush()
  expect(host.textContent).toContain("example.com 及其所有子域，端口不限")
  host.querySelector<HTMLElement>('[data-network-egress-decision="allow-persist"]')!.click()
  expect(await request).toBe("granted")
  await flush()
  expect(host.textContent).toContain("已允许，但未能记住")
  expect(f.service.authorized("b.example.com", 443)).toBe(false)
})

test("提交档位绑定真实 main，远端和没有围栏的界面不发送联网档位", async () => {
  const f = await fixture()
  Object.defineProperty(window, "api", { configurable: true, value: { awaitInitialization: async () => ({ url: "http://127.0.0.1:1234" }), networkEgress: f.service.api } })
  runtime.setSandboxStateForTests({ status: "ready", generation: 1, reason: "boot", fence: "applied" })
  await runtime.setSessionNetworkTier({ serverKey: "http://127.0.0.1:1234", directory: "/project", sessionID: "ses_a" }, "ask")
  expect(await f.activity.tier({ generation: 1, directory: "/project", sessionID: "ses_a" })).toBe("ask")
  await runtime.setSessionNetworkTier({ serverKey: "https://remote.example.com", directory: "/project", sessionID: "ses_a" }, "allow")
  expect(await f.activity.tier({ generation: 1, directory: "/project", sessionID: "ses_a" })).toBe("ask")
  runtime.setSandboxStateForTests(undefined)
  await runtime.setSessionNetworkTier({ directory: "/project", sessionID: "ses_a" }, "allow")
  expect(await f.activity.tier({ generation: 1, directory: "/project", sessionID: "ses_a" })).toBe("ask")
  const host = document.createElement("div")
  document.body.append(host)
  disposers.push(runtime.render(() => runtime.createComponent(runtime.SessionNetworkEgressCards, { identity: () => ({ serverKey: "http://127.0.0.1:1234", directory: "/project", sessionID: "ses_a" }) }), host))
  await flush()
  expect(host.querySelector("[data-network-egress-cards]")).toBeNull()
})


test("档位上报失败只记录日志，提交可以继续且 main 保持 unknown", async () => {
  const f = await fixture()
  const report = spyOn(f.service.api, "setTier")
  const warning = spyOn(console, "warn").mockImplementation(() => {})
  Object.defineProperty(window, "api", { configurable: true, value: { awaitInitialization: async () => ({ url: "http://127.0.0.1:1234" }), networkEgress: f.service.api } })
  runtime.setSandboxStateForTests({ status: "ready", generation: 1, reason: "boot", fence: "applied" })
  try {
    report.mockResolvedValueOnce({ ok: false, code: "unavailable" })
    await expect(runtime.setSessionNetworkTier({ directory: "/project", sessionID: "ses_a" }, "allow")).resolves.toBeUndefined()
    report.mockRejectedValueOnce(new Error("IPC unavailable"))
    await expect(runtime.setSessionNetworkTier({ directory: "/project", sessionID: "ses_a" }, "allow")).resolves.toBeUndefined()
    expect(await f.activity.tier({ generation: 1, directory: "/project", sessionID: "ses_a" })).toBe("unknown")
    expect(warning).toHaveBeenCalledTimes(2)
  } finally { report.mockRestore(); warning.mockRestore() }
})
