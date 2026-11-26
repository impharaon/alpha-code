import { afterEach, expect, test } from "bun:test"
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import http from "node:http"
import { connect, type Socket } from "node:net"
import { createEgressPassLog, egressPassPath, readEgressPasses } from "./network-egress-passes"
import { createNetworkEgressActivity } from "./network-egress-activity"
import { createNetworkEgressApproval } from "./network-egress-approval"
import { configureEgressGrantApproval, __resetEgressGrantsForTests } from "./network-egress-grants"
import { startEgressPolicyProxy, type EgressLogRecord } from "./network-egress-proxy"
import type { NetworkActivity, NetworkOutbound } from "../shared/network-egress-wire"

const cleanups: Array<() => unknown> = []
afterEach(async () => { __resetEgressGrantsForTests(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "egress-passes-"))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const file = egressPassPath(root, "dev")
  mkdirSync(dirname(file), { recursive: true })
  // The real append binding is tested here with a temp user root; the records themselves come from CONNECT.
  const store = { read: () => readEgressPasses(file, { readFileSync, log: () => {} }), append: (pass: unknown) => appendFileSync(file, JSON.stringify(pass) + "\n") }
  const messages: string[] = []
  const passes = createEgressPassLog(store, (line) => messages.push(line))
  const activity = createNetworkEgressActivity()
  const session = (sessionID: string) => ({ generation: 1, sessionID, directory: "/project" })
  let ack!: () => void
  const post = (message: NetworkOutbound) => { if (message.type === "codepuppy.network.activity.reply") ack() }
  activity.attach(1, post, { session: async () => ({}), shell: async () => true })
  let seq = 0
  const snapshot = (sessions: string[]) => new Promise<void>((resolve) => {
    ack = resolve
    const activities: NetworkActivity[] = sessions.map((id) => ({ kind: "tool", invocationID: id, ref: { ...session(id), callID: id, messageID: "msg_a" }, tool: "shell" }))
    activity.receive({ type: "codepuppy.network.snapshot", id: ++seq, generation: 1, seq, activities }, post)
  })
  await snapshot(["ses_a"])
  const service = createNetworkEgressApproval({ available: true, activity, passes, store: { read: () => ({ ok: true, absent: true, sites: [] }), write: () => {} }, log: (line) => messages.push(line) })
  cleanups.push(service.close)
  await service.api.setTier({ session: session("ses_a"), tier: "allow" })
  configureEgressGrantApproval(service)
  const sockets = new Set<Socket>()
  const server = http.createServer()
  const requests: string[] = []
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)) })
  server.on("connect", (request, socket) => { requests.push(request.url!); socket.end("HTTP/1.1 200 OK\r\n\r\npass-ok") })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanups.push(() => new Promise<void>((resolve) => { sockets.forEach((socket) => socket.destroy()); server.close(() => resolve()) }))
  const logs: EgressLogRecord[] = []
  const proxy = await startEgressPolicyProxy({ authorize: service.authorized, requestGrant: service.request, log: (record) => logs.push(record), resolveEgressRoutes: async () => [{ kind: "http", host: "127.0.0.1", port: (server.address() as { port: number }).port }] })
  cleanups.push(proxy.close)
  const request = (host = "198.18.0.1") => new Promise<string>((resolve, reject) => {
    let body = ""
    const socket = connect(proxy.port, "127.0.0.1", () => socket.write(`CONNECT ${host}:443 HTTP/1.1\r\nHost: ${host}:443\r\n\r\n`))
    socket.on("data", (chunk) => { body += chunk; if (body.includes("pass-ok") || body.includes("denied (reason=")) { socket.destroy(); resolve(body) } })
    socket.once("error", reject)
  })
  return { file, root, passes, store, messages, service, session, snapshot, request, requests, logs }
}

test("逐次落盘与设置聚合来自真实 CONNECT，唯一 ID 去重、重启重读与环境分文件", async () => {
  const f = await fixture()
  expect(await f.request()).toContain("pass-ok")
  expect(await f.request()).toContain("pass-ok")
  const records = f.logs.filter((record) => record.event === "egress.policy-pass")
  expect(records).toHaveLength(2)
  expect(new Set(records.map((record) => record.id)).size).toBe(2)
  expect(readFileSync(f.file, "utf8").trim().split("\n").map((line) => JSON.parse(line))).toEqual(records)
  appendFileSync(f.file, JSON.stringify(records[0]) + "\n")
  f.passes.record(records[0]!)
  const summary = createEgressPassLog(f.store, () => {}).snapshot()
  expect(summary).toMatchObject({ persistence: "ok", passes: [{ destination: { host: "198.18.0.1", port: 443 }, count: 2, firstAt: records[0]!.at, lastAt: records[1]!.at }] })
  expect(await f.service.api.settings()).toMatchObject({ ok: true, value: { passes: summary.passes } })
  expect(egressPassPath(f.root, "beta")).not.toBe(f.file)
  expect(f.service.authorized("198.18.0.1", 443)).toBe(false)
  expect((await f.service.api.listApprovals({ session: f.session("ses_a") }))).toEqual({ ok: true, value: [] })
  expect(f.logs.filter((record) => record.event === "egress.grant")).toEqual([])
})

test("日志半行仅投影先前完整记录；写入失败保留内存放行且不阻断真实连接", async () => {
  const f = await fixture()
  await f.request()
  chmodSync(f.file, 0o400)
  try {
    expect(await f.request()).toContain("pass-ok")
    expect(f.passes.snapshot()).toMatchObject({ persistence: "write-failed", passes: [{ count: 2 }] })
    expect(f.messages.some((line) => line.includes("append failed"))).toBe(true)
  } finally { chmodSync(f.file, 0o600) }
  const before = readFileSync(f.file, "utf8")
  appendFileSync(f.file, before.slice(0, 20))
  expect(readEgressPasses(f.file, { readFileSync, log: () => {} })).toMatchObject({ persistence: "unreadable", passes: [{ event: "egress.policy-pass" }] })
  expect(createEgressPassLog(f.store, () => {}).snapshot().passes[0]?.count).toBe(1)
})

test("每次重新读取完整活动档位，混入 ask 时真实 CONNECT 出卡且无通放缓存", async () => {
  const f = await fixture()
  await f.request()
  await f.snapshot(["ses_a", "ses_b"])
  await f.service.api.setTier({ session: f.session("ses_b"), tier: "ask" })
  const card = new Promise<string>((resolve) => {
    const unsubscribe = f.service.api.subscribe(() => { void f.service.api.listApprovals({ session: f.session("ses_b") }).then((result) => { const item = result.ok && result.value.find((value) => value.state === "pending"); if (item) { unsubscribe(); resolve(item.requestID) } }) })
  })
  const pending = f.request()
  await f.service.api.decide({ requestID: await card, decision: "deny" })
  expect(await pending).toContain("403")
  expect(f.requests).toHaveLength(1)
  expect(f.passes.snapshot().passes[0]?.count).toBe(1)
})
