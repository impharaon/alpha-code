import { afterEach, expect, spyOn, test } from "bun:test"
import { createServer, type Socket } from "node:net"
import http from "node:http"
import dns from "node:dns/promises"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { dialEgressUpstream, parseEgressRoutes, type UpstreamRoute } from "./network-egress-upstream"

const cleanups: Array<() => unknown> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function peer(receive: (socket: Socket) => void) {
  const sockets = new Set<Socket>()
  const server = createServer((socket) => { sockets.add(socket); socket.on("error", () => {}); socket.once("close", () => sockets.delete(socket)); receive(socket) })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanups.push(() => new Promise<void>((resolve) => { sockets.forEach((socket) => socket.destroy()); server.close(() => resolve()) }))
  return (server.address() as { port: number }).port
}

async function httpPeer(status = 200) {
  const requests: string[] = []
  const sockets = new Set<Socket>()
  const server = http.createServer()
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)) })
  // Input is Node's actual parsed CONNECT from the production dialer, not a fabricated request fixture.
  server.on("connect", (request, socket) => { requests.push(request.url!); socket.write(`HTTP/1.1 ${status} Test\r\n\r\nready-tail`) })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanups.push(() => new Promise<void>((resolve) => { sockets.forEach((socket) => socket.destroy()); server.close(() => resolve()) }))
  return { requests, route: { kind: "http", host: "127.0.0.1", port: (server.address() as { port: number }).port } as const }
}

function data(socket: Socket) {
  return new Promise<string>((resolve) => { socket.once("data", (chunk) => resolve(chunk.toString())); socket.resume() })
}

test("系统路由按 Chromium token 顺序解码，畸形配置不猜 DIRECT", () => {
  expect(parseEgressRoutes("PROXY p.test:80; HTTPS s.test:443; SOCKS p.test:1080; SOCKS4 p.test:1081; SOCKS5 [::1]:1082; DIRECT").map((route) => route.kind)).toEqual(["http", "https", "socks4", "socks4", "socks5", "direct"])
  for (const value of ["", "UNKNOWN p:80", "PROXY u:p@proxy:80", "DIRECT;", "HTTPS p:0", "SOCKS5 p:65536"]) expect(() => parseEgressRoutes(value)).toThrow("EPROXYCONFIG")
})

test("真实 HTTP 上游就绪、尾字节、路由后备与每条连接只记一次政策放行", async () => {
  const bad = await httpPeer(407)
  const good = await httpPeer()
  let passes = 0
  const tunnel = await dialEgressUpstream({ host: "198.18.0.1", port: 443 }, [bad.route, good.route], { kind: "allow-all", onPass: () => { passes++ } }, new AbortController().signal)
  cleanups.push(() => tunnel.socket.destroy())
  expect(await data(tunnel.socket)).toBe("ready-tail")
  expect(bad.requests).toEqual(["198.18.0.1:443"])
  expect(good.requests).toEqual(bad.requests)
  expect(passes).toBe(1)
  await expect(dialEgressUpstream({ host: "example.com", port: 443 }, [bad.route], { kind: "existing-authorization" }, new AbortController().signal)).rejects.toMatchObject({ code: "EPROXYAUTH" })
})

test("目标 lookup 的混合非公网答案拒绝且零上游拨号；通过的地址固定到实际 CONNECT", async () => {
  const actual = await dns.lookup("localhost", { all: true })
  expect(actual.length).toBeGreaterThan(0)
  const lookup = spyOn(dns, "lookup").mockResolvedValue([{ address: "8.8.8.8", family: 4 }, ...actual])
  cleanups.push(() => lookup.mockRestore())
  const upstream = await httpPeer()
  let passes = 0
  const policy = { kind: "allow-all" as const, onPass: () => { passes++ } }
  await expect(dialEgressUpstream({ host: "lookup.egress.test", port: 443 }, [upstream.route], policy, new AbortController().signal)).rejects.toMatchObject({ code: "ENONPUBLIC" })
  expect(upstream.requests).toEqual([]); expect(passes).toBe(0)
  lookup.mockResolvedValue([{ address: "198.18.1.1", family: 4 }])
  const tunnel = await dialEgressUpstream({ host: "lookup.egress.test", port: 443 }, [upstream.route], policy, new AbortController().signal)
  cleanups.push(() => tunnel.socket.destroy())
  expect(upstream.requests).toEqual(["198.18.1.1:443"])
  expect(lookup).toHaveBeenCalledTimes(2)
  expect(passes).toBe(1)
})

test("真实 SOCKS4 与 SOCKS5 握手后才就绪，域名/IPv6 与多读字节不丢", async () => {
  // RFC 1928 §3–6 and SOCKS4 CONNECT: peers consume the actual production request bytes.
  const received: Buffer[] = []
  const four = await peer((socket) => socket.once("data", (request) => { received.push(request); socket.write(Buffer.from([0, 90, 0, 80, 127, 0, 0, 1])); socket.write("four-tail") }))
  const five = await peer((socket) => socket.once("data", (greeting) => {
    expect([...greeting]).toEqual([5, 1, 0]); socket.write(Buffer.from([5, 0]))
    socket.once("data", (request) => { received.push(request); socket.write(Buffer.concat([Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 80]), Buffer.from("five-tail")])) })
  }))
  for (const [kind, port, host] of [["socks4", four, "8.8.8.8"], ["socks5", five, "example.com"], ["socks5", five, "2001:4860:4860::8888"]] as const) {
    const tunnel = await dialEgressUpstream({ host, port: 443 }, [{ kind, host: "127.0.0.1", port }], { kind: "existing-authorization" }, new AbortController().signal)
    cleanups.push(() => tunnel.socket.destroy())
    expect(await data(tunnel.socket)).toBe(kind === "socks4" ? "four-tail" : "five-tail")
  }
  expect([...received[0]!]).toEqual([4, 1, 1, 187, 8, 8, 8, 8, 0])
  expect(received[1]!.subarray(5, -2).toString()).toBe("example.com")
  expect(received[2]![3]).toBe(4)
})

test("直接路由沿用 TCP；取消未完成的代理握手不遗留 socket", async () => {
  let closed!: () => void
  const closure = new Promise<void>((resolve) => { closed = resolve })
  const port = await peer((socket) => { socket.on("data", () => {}); socket.once("close", closed) })
  const tunnel = await dialEgressUpstream({ host: "127.0.0.1", port }, [{ kind: "direct" }], { kind: "existing-authorization" }, new AbortController().signal)
  tunnel.socket.destroy(); await closure
  const controller = new AbortController()
  const pending = dialEgressUpstream({ host: "example.com", port: 443 }, [{ kind: "socks5", host: "127.0.0.1", port }], { kind: "existing-authorization" }, controller.signal)
  controller.abort(Object.assign(new Error("deadline"), { code: "ETIMEDOUT" }))
  await expect(pending).rejects.toMatchObject({ code: "ETIMEDOUT" })
})

test("HTTPS 上游校验证书并保留隧道；system Session 每条连接重新查询", () => {
  const root = mkdtempSync(join(tmpdir(), "egress-upstream-tls-"))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const cert = join(root, "cert.pem")
  const key = join(root, "key.pem")
  const generated = Bun.spawnSync(["/usr/bin/openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost", "-keyout", key, "-out", cert], { stdout: "ignore", stderr: "pipe" })
  expect(generated.exitCode).toBe(0)
  const script = `
    import { mock } from "bun:test";
    import https from "node:https";
    const calls = [];
    mock.module("electron", () => ({ session: { fromPartition(name) { calls.push(name); return { async setProxy(value) { calls.push(value) }, async resolveProxy(url) { calls.push(url); return "DIRECT" } } } } }));
    const { dialEgressUpstream, resolveEgressRoutes } = await import(${JSON.stringify(new URL("./network-egress-upstream.ts", import.meta.url).pathname)});
    const signal = new AbortController().signal;
    await resolveEgressRoutes({ host: "example.com", port: 443 }, signal);
    await resolveEgressRoutes({ host: "example.net", port: 8443 }, signal);
    const server = https.createServer({ key: await Bun.file(${JSON.stringify(key)}).text(), cert: await Bun.file(${JSON.stringify(cert)}).text() });
    const requests = [];
    server.on("connect", (request, socket) => { requests.push(request.url); socket.write("HTTP/1.1 200 OK\\r\\n\\r\\ntls-tail") });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const tunnel = await dialEgressUpstream({ host: "example.com", port: 443 }, [{ kind: "https", host: "localhost", port: server.address().port }], { kind: "existing-authorization" }, signal);
    const tail = await new Promise(resolve => { tunnel.socket.once("data", chunk => resolve(chunk.toString())); tunnel.socket.resume() });
    tunnel.socket.destroy(); server.close();
    console.log(JSON.stringify({ calls, requests, tail }));
    process.exit(0);
  `
  const child = Bun.spawnSync([process.execPath, "-e", script], { env: { ...process.env, NODE_EXTRA_CA_CERTS: cert }, stdout: "pipe", stderr: "pipe" })
  expect(child.exitCode, child.stderr.toString()).toBe(0)
  expect(JSON.parse(child.stdout.toString())).toEqual({ calls: ["codepuppy-egress-upstream", { mode: "system" }, "https://example.com:443/", "https://example.net:8443/"], requests: ["example.com:443"], tail: "tls-tail" })
})
