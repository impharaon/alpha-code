import { connect, isIP, type Socket } from "node:net"
import dns from "node:dns/promises"
import http from "node:http"
import https from "node:https"
import type { Destination } from "../shared/network-egress-wire"
import { admitEgressPass, isNonPublicEgressAddress } from "./network-egress-grants"

export type UpstreamRoute = { kind: "direct" } | { kind: "http" | "https" | "socks4" | "socks5"; host: string; port: number }
export type UpstreamTunnel = { socket: Socket; route: UpstreamRoute }
export type EgressDialPolicy = { kind: "existing-authorization" } | { kind: "allow-all"; onPass(): void }

const failure = (code: string) => Object.assign(new Error(code), { code })
const authority = (target: Destination) => `${isIP(target.host) === 6 ? `[${target.host}]` : target.host}:${target.port}`

// Tokens and protocol meanings: Chromium net/docs/proxy.md (the system Session's output).
export function parseEgressRoutes(value: string): UpstreamRoute[] {
  if (!value.trim()) throw failure("EPROXYCONFIG")
  return value.split(";").map((part): UpstreamRoute => {
    const token = part.trim()
    if (token === "DIRECT") return { kind: "direct" }
    const match = /^(PROXY|HTTP|HTTPS|SOCKS|SOCKS4|SOCKS5) (\[[0-9a-f:]+\]|[^\s/:@]+):([0-9]{1,5})$/i.exec(token)
    if (!match || Number(match[3]) < 1 || Number(match[3]) > 65535) throw failure("EPROXYCONFIG")
    if (match[2]!.startsWith("[") && isIP(match[2]!.slice(1, -1)) !== 6) throw failure("EPROXYCONFIG")
    const kind = match[1]!.toUpperCase()
    return { kind: kind === "PROXY" || kind === "HTTP" ? "http" : kind === "HTTPS" ? "https" : kind === "SOCKS5" ? "socks5" : "socks4", host: match[2]!.replace(/^\[|\]$/g, ""), port: Number(match[3]) }
  })
}

let systemSession: Promise<Electron.Session> | undefined
export async function resolveEgressRoutes(target: Destination, signal: AbortSignal): Promise<UpstreamRoute[]> {
  signal.throwIfAborted()
  systemSession ??= (async () => {
    const { session } = await import("electron")
    const upstream = session.fromPartition("codepuppy-egress-upstream")
    await upstream.setProxy({ mode: "system" })
    return upstream
  })()
  const upstream = await abortable(systemSession, signal)
  return parseEgressRoutes(await abortable(upstream.resolveProxy(`https://${authority(target)}/`), signal))
}

export async function dialEgressUpstream(target: Destination, routes: UpstreamRoute[], policy: EgressDialPolicy, signal: AbortSignal): Promise<UpstreamTunnel> {
  signal.throwIfAborted()
  let destination = target
  if (policy.kind === "allow-all") {
    const admitted = admitEgressPass(target)
    if (!admitted) throw failure("ENONPUBLIC")
    const addresses = isIP(admitted.host) ? [{ address: admitted.host, family: isIP(admitted.host) }] : await abortable(dns.lookup(admitted.host, { all: true }), signal)
    if (!addresses.length || addresses.some((entry) => isNonPublicEgressAddress(entry.address))) throw failure("ENONPUBLIC")
    destination = { host: addresses[0]!.address, port: target.port }
    signal.throwIfAborted()
    policy.onPass()
  }
  let last: unknown = failure("EPROXYCONFIG")
  for (const route of routes) {
    signal.throwIfAborted()
    try {
      const socket = route.kind === "direct" ? await connectSocket(destination, signal)
        : route.kind === "http" || route.kind === "https" ? await httpTunnel(destination, route, signal)
          : await socksTunnel(destination, route, signal)
      return { socket, route }
    } catch (error) {
      signal.throwIfAborted()
      last = error
    }
  }
  throw last
}

function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    pending.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

function connectSocket(target: Destination, signal: AbortSignal): Promise<Socket> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const socket = connect({ host: target.host, port: target.port, autoSelectFamily: true })
    const abort = () => socket.destroy(signal.reason instanceof Error ? signal.reason : failure("ABORT_ERR"))
    signal.addEventListener("abort", abort, { once: true })
    socket.once("close", () => signal.removeEventListener("abort", abort))
    socket.on("error", () => {})
    socket.once("error", reject)
    socket.once("connect", () => { socket.off("error", reject); resolve(socket) })
  })
}

function httpTunnel(target: Destination, route: Exclude<UpstreamRoute, { kind: "direct" }>, signal: AbortSignal): Promise<Socket> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const request = (route.kind === "https" ? https : http).request({ method: "CONNECT", host: route.host, port: route.port, path: authority(target), signal })
    request.once("error", (error: NodeJS.ErrnoException) => reject(error.code === "ETIMEDOUT" ? error : failure("EPROXYCONNECT")))
    request.once("connect", (response, socket, head) => {
      socket.on("error", () => {})
      if (response.statusCode !== 200) { socket.destroy(); reject(failure(response.statusCode === 407 ? "EPROXYAUTH" : "EPROXYCONNECT")); return }
      if (signal.aborted) { socket.destroy(); reject(signal.reason); return }
      const abort = () => socket.destroy()
      signal.addEventListener("abort", abort, { once: true })
      socket.once("close", () => signal.removeEventListener("abort", abort))
      socket.pause()
      if (head.length) socket.unshift(head)
      resolve(socket)
    })
    request.end()
  })
}

async function socksTunnel(target: Destination, route: Exclude<UpstreamRoute, { kind: "direct" }>, signal: AbortSignal): Promise<Socket> {
  const socket = await connectSocket(route, signal)
  try {
    if (route.kind === "socks4") {
      const address = isIP(target.host) === 4 ? target.host : (await abortable(dns.lookup(target.host, { family: 4 }), signal)).address
      if (isIP(address) !== 4) throw failure("EPROXYCONNECT")
      const request = Buffer.alloc(9)
      request[0] = 4; request[1] = 1; request.writeUInt16BE(target.port, 2)
      address.split(".").forEach((part, index) => { request[4 + index] = Number(part) })
      socket.write(request)
      const reply = await readBytes(socket, 8, signal)
      if (reply[0] !== 0 || reply[1] !== 90) throw failure(reply[1] === 93 ? "EPROXYAUTH" : "EPROXYCONNECT")
      return socket
    }
    socket.write(Buffer.from([5, 1, 0]))
    const greeting = await readBytes(socket, 2, signal)
    if (greeting[0] !== 5 || greeting[1] !== 0) throw failure("EPROXYAUTH")
    const family = isIP(target.host)
    const host = family === 4 ? Buffer.from([1, ...target.host.split(".").map(Number)])
      : family === 6 ? Buffer.concat([Buffer.from([4]), ipv6Bytes(target.host)])
        : Buffer.concat([Buffer.from([3, Buffer.byteLength(target.host)]), Buffer.from(target.host)])
    const port = Buffer.alloc(2); port.writeUInt16BE(target.port)
    socket.write(Buffer.concat([Buffer.from([5, 1, 0]), host, port]))
    const reply = await readBytes(socket, 4, signal)
    if (reply[0] !== 5 || reply[1] !== 0 || reply[2] !== 0) throw failure("EPROXYCONNECT")
    const length = reply[3] === 1 ? 4 : reply[3] === 4 ? 16 : reply[3] === 3 ? (await readBytes(socket, 1, signal))[0]! : undefined
    if (length === undefined) throw failure("EPROXYCONNECT")
    await readBytes(socket, length + 2, signal)
    return socket
  } catch (error) { socket.destroy(); throw error }
}

function ipv6Bytes(address: string): Buffer {
  const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1)
  const [left, right] = normalized.split("::").map((part) => part ? part.split(":") : [])
  const words = right ? [...left!, ...Array(8 - left!.length - right.length).fill("0"), ...right] : left!
  const result = Buffer.alloc(16)
  words.forEach((word, index) => result.writeUInt16BE(parseInt(word, 16), index * 2))
  return result
}

function readBytes(socket: Socket, length: number, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0)
    const cleanup = () => { socket.pause(); socket.off("data", data); socket.off("error", fail); socket.off("close", closed); signal.removeEventListener("abort", abort) }
    const fail = (error: Error) => { cleanup(); reject(error) }
    const closed = () => fail(failure("EPROXYCONNECT"))
    const abort = () => fail(signal.reason)
    const data = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk])
      if (buffered.length < length) return
      cleanup()
      if (buffered.length > length) socket.unshift(buffered.subarray(length))
      resolve(buffered.subarray(0, length))
    }
    socket.on("data", data); socket.once("error", fail); socket.once("close", closed); signal.addEventListener("abort", abort, { once: true }); socket.resume()
  })
}
