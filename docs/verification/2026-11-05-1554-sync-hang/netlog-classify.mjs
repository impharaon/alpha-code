#!/usr/bin/env bun
// alpha-code#1554 判定脚本。读 Chromium netlog,对引擎 origin 的每个请求判「等 socket」或「已发出无响应」;
// 可选抽 startup-timeline.log 各阶段耗时与 probeTimeouts、opencode.log 的 global event 计数。
//
//   bun netlog-classify.mjs --netlog <net.json> [--origin http://127.0.0.1:PORT]... \
//     [--timeline <startup-timeline.log>] [--engine-log <opencode.log>] \
//     [--cutoff-ms <从首事件起的毫秒>] [--stall-ms 1000] [--json <out.json>] [--expect <truth.json>]
//
// 判定(以请求结束或 cutoff 那一刻的状态为准,不看退出时的收尾事件):
//   waiting-socket     还在 HTTP_STREAM_REQUEST 里,一个字节没发。reason=pool-stalled 表示连接池明确记了
//                      SOCKET_POOL_STALLED_MAX_SOCKETS(_PER_GROUP);reason=connecting 表示没满但还没连上。
//   sent-no-response   HTTP_TRANSACTION_SEND_REQUEST 已结束,到结束 / cutoff 都没等到响应头。
//   answered           收到响应头。socketWaitMs / responseWaitMs 仍列出,用来看它之前等在哪一段。
//   failed             没等到响应头就以网络错误结束(不是被取消),如引擎换代时连接被拒。
//   not-on-wire        没进过 HTTP_STREAM_REQUEST(例如在预检前就被取消、命中缓存)。
// 带预检的请求按「主请求还没开始时,它就等于预检在主请求结束那一刻的状态」合并:via=preflight。
// Chromium 148 实测:fetch 被 abort 后,排队中的预检不会跟着撤销,还会留在队里直到拿到连接。
// 所以预检一定要按主请求的结束时刻截断,否则 1 秒超时的探针会被算成「等了 5 秒、答了」。
// 这段滞留另列 orphanPreflightMs。
//
// 输出不含请求头。查询串只留键名,值换成短哈希(同目录同值,看得出是不是一个目录,看不出目录名);
// --keep-query <name> 用于自证样本里的 tag。
//
// netlog 只记 Chromium 网络栈(renderer / main 的 net 模块)。引擎进程自己的出网(Node)不在里面,
// 所以「上游等待」只包含 renderer / main 直接发出的那部分,引擎侧要看 opencode.log。

import { createReadStream, readFileSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { createInterface } from "node:readline"

const argv = process.argv.slice(2)
const multi = (name) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] ? [argv[i + 1]] : []))
const one = (name) => multi(name)[0]
const NETLOG = one("netlog")
const STALL_MS = Number(one("stall-ms") ?? 1000)
const KEEP_QUERY = new Set(multi("keep-query"))

const shortHash = (value) => createHash("sha256").update(value).digest("hex").slice(0, 8)
const safeUrl = (raw) => {
  try {
    const u = new URL(raw)
    const q = [...u.searchParams.entries()].map(([k, v]) => `${k}=${KEEP_QUERY.has(k) ? v : `#${shortHash(v)}`}`)
    return { origin: u.origin, path: u.pathname, query: q.join("&") }
  } catch {
    return { origin: "?", path: "?", query: "" }
  }
}
const isLoopback = (origin) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(origin)

/**
 * 逐行读,容忍没收尾的文件。收尾的文件最后一行是 `{...事件...}],"polledData":{...}}` 或单独的 `]...`,
 * finalized=true 才说明进程正常退出、缓冲都落了盘;false 时尾部事件可能缺失,要在结果里写明。
 */
export async function readNetlog(path) {
  let constants
  const events = []
  let unparsed = 0
  let finalized = false
  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity })
  for await (const raw of rl) {
    if (!constants && raw.startsWith('{"constants":')) {
      constants = JSON.parse(raw.replace(/,\s*$/, "") + "}").constants
      continue
    }
    let line = raw
    const tail = line.indexOf('],"polledData"')
    if (tail >= 0) {
      finalized = true
      line = line.slice(0, tail)
    } else if (line.startsWith("]")) {
      finalized = true
      continue
    } else if (line.startsWith('"polledData"')) {
      finalized = true
      continue
    }
    if (finalized && tail < 0) continue
    if (!line.startsWith('{"')) continue
    try {
      events.push(JSON.parse(line.replace(/,\s*$/, "")))
    } catch {
      unparsed++
    }
  }
  if (!constants) throw new Error(`no constants line in ${path}: not a netlog?`)
  return { constants, events, unparsed, finalized }
}

export function classify({ constants, events }, options = {}) {
  const stallMs = options.stallMs ?? 1000
  const name = Object.fromEntries(Object.entries(constants.logEventTypes).map(([k, v]) => [v, k]))
  const sourceType = Object.fromEntries(Object.entries(constants.logSourceType).map(([k, v]) => [v, k]))
  const PHASE = { NONE: constants.logEventPhase.PHASE_NONE, BEGIN: constants.logEventPhase.PHASE_BEGIN, END: constants.logEventPhase.PHASE_END }
  if (!events.length) throw new Error("netlog has zero events")
  const t0 = Number(events[0].time)
  const tickOffset = Number(constants.timeTickOffset ?? 0)

  // 退出时的收尾:所有在途请求一起被取消,连接释放后排队的请求会「拿到 socket」。那不是事实,要切掉。
  let cutoff = options.cutoffMs
  let cutoffSource = "--cutoff-ms"
  if (cutoff === undefined) {
    const last = Number(events.at(-1).time) - t0
    const cancels = events
      .filter((e) => name[e.type] === "CANCELLED" && sourceType[e.source.type] === "URL_REQUEST")
      .map((e) => Number(e.time) - t0)
      .filter((t) => t >= last - 300)
    cutoff = cancels.length >= 2 ? Math.min(...cancels) - 1 : last
    cutoffSource = cancels.length >= 2 ? `auto:teardown(${cancels.length} cancels in last 300ms)` : "auto:last-event"
  }

  const reqs = new Map()
  const jobStall = new Map()
  const jobGroup = new Map()
  const controllerJobs = new Map()
  const ensure = (id) => {
    let r = reqs.get(id)
    if (!r) reqs.set(id, (r = { id, createdBy: null, url: null, method: null, firstT: null, controllers: [] }))
    return r
  }
  for (const e of events) {
    const t = Number(e.time) - t0
    if (t > cutoff) continue
    const n = name[e.type]
    const src = sourceType[e.source.type]
    if (src === "HTTP_STREAM_JOB") {
      if (n === "SOCKET_POOL_STALLED_MAX_SOCKETS_PER_GROUP" || n === "SOCKET_POOL_STALLED_MAX_SOCKETS") {
        if (!jobStall.has(e.source.id)) jobStall.set(e.source.id, { t, kind: n })
      }
      if (n === "TCP_CLIENT_SOCKET_POOL_REQUESTED_SOCKET" && e.params?.group_id) jobGroup.set(e.source.id, e.params.group_id)
      continue
    }
    if (src === "HTTP_STREAM_JOB_CONTROLLER") {
      if (n === "HTTP_STREAM_REQUEST_STARTED_JOB" && e.params?.source_dependency) {
        const arr = controllerJobs.get(e.source.id) ?? []
        arr.push(e.params.source_dependency.id)
        controllerJobs.set(e.source.id, arr)
      }
      continue
    }
    if (src !== "URL_REQUEST") continue
    const r = ensure(e.source.id)
    r.firstT ??= t
    switch (n) {
      case "CREATED_BY":
        r.createdBy = e.params?.source_dependency?.id ?? null
        break
      case "REQUEST_ALIVE":
        if (e.phase === PHASE.BEGIN) {
          r.aliveAt = t
          r.url = e.params?.url ?? r.url
          r.priority = e.params?.priority
        } else if (e.phase === PHASE.END) {
          r.endAt = t
          if (e.params?.net_error !== undefined) r.netError = e.params.net_error
        }
        break
      case "URL_REQUEST_START_JOB":
        if (e.phase === PHASE.BEGIN) {
          r.method = e.params?.method ?? r.method
          r.url = e.params?.url ?? r.url
        }
        break
      case "CORS_REQUEST":
        if (e.phase === PHASE.BEGIN) r.corsAt = t
        else if (e.phase === PHASE.END) r.corsEnd = t
        break
      case "CORS_PREFLIGHT_URL_REQUEST":
        r.preflight = e.params?.source_dependency?.id
        break
      case "HTTP_STREAM_REQUEST":
        if (e.phase === PHASE.BEGIN) r.streamAt ??= t
        else if (e.phase === PHASE.END) r.streamEnd = t
        break
      case "HTTP_STREAM_JOB_CONTROLLER_BOUND":
        if (e.params?.source_dependency) r.controllers.push(e.params.source_dependency.id)
        break
      case "HTTP_TRANSACTION_SEND_REQUEST":
        if (e.phase === PHASE.END) r.sentAt ??= t
        break
      case "HTTP_TRANSACTION_READ_RESPONSE_HEADERS":
        r.headersAt ??= t
        r.status = Number(String(e.params?.headers?.[0] ?? "").split(" ")[1]) || undefined
        r.sse = (e.params?.headers ?? []).some((h) => /^content-type:\s*text\/event-stream/i.test(h))
        break
      case "CANCELLED":
        r.cancelled = true
        r.cancelAt ??= t
        break
    }
  }

  /** r 在 at 时刻的状态。at 之后发生的事对这次判定不存在。 */
  const stateOf = (r, at = cutoff) => {
    const seen = (t) => (t !== undefined && t <= at ? t : undefined)
    const jobs = (r.controllers ?? []).flatMap((c) => controllerJobs.get(c) ?? [])
    const stallRec = jobs.map((j) => jobStall.get(j)).find((x) => x && x.t <= at)
    const group = jobs.map((j) => jobGroup.get(j)).find(Boolean)
    const streamAt = seen(r.streamAt)
    const streamEnd = seen(r.streamEnd)
    const sentAt = seen(r.sentAt)
    const headersAt = seen(r.headersAt)
    const endAt = seen(r.endAt)
    const cancelAt = seen(r.cancelAt)
    const stop = endAt ?? cancelAt ?? at
    let label
    let reason
    if (headersAt !== undefined) label = "answered"
    else if (endAt !== undefined && cancelAt === undefined && r.netError !== undefined && r.netError !== 0 && r.netError !== -3) {
      label = "failed"
      reason = `net_error=${r.netError}`
    } else if (sentAt !== undefined) label = "sent-no-response"
    else if (streamAt !== undefined && streamEnd === undefined) {
      label = "waiting-socket"
      reason = stallRec ? "pool-stalled" : "connecting"
    } else if (streamAt !== undefined) {
      label = "sent-no-response"
      reason = "stream-bound-no-send-yet"
    } else label = "not-on-wire"
    return {
      label,
      reason,
      stalled: stallRec?.kind,
      group,
      socketWaitMs: streamAt === undefined ? null : (streamEnd ?? stop) - streamAt,
      responseWaitMs: sentAt === undefined ? null : (headersAt ?? stop) - sentAt,
      stop,
    }
  }

  const rows = []
  for (const r of reqs.values()) {
    const isPreflightChild = r.createdBy !== null && reqs.get(r.createdBy)?.preflight === r.id
    if (isPreflightChild) continue
    const child = r.preflight !== undefined ? reqs.get(r.preflight) : undefined
    const url = r.url ?? child?.url
    if (!url) continue
    const safe = safeUrl(url)
    const mainStarted = r.aliveAt !== undefined
    // 主请求没开始就结束:它的结束 = CORS_REQUEST END(abort 的时刻)。预检按这个时刻截断。
    const logicalEnd = mainStarted ? (r.endAt ?? r.cancelAt ?? null) : (r.corsEnd ?? r.cancelAt ?? null)
    const self = stateOf(r)
    const pre = child ? stateOf(child, !mainStarted && logicalEnd !== null ? logicalEnd : cutoff) : null
    let { label, reason, stalled, group } = self
    let via
    if (!mainStarted && pre) {
      via = "preflight"
      ;({ label, reason, stalled, group } = pre)
      if (pre.label === "answered") {
        // 预检答完了,主请求还没开始:这一瞬间在两段之间,或主请求已被取消。
        label = logicalEnd !== null ? "not-on-wire" : "waiting-socket"
        reason = logicalEnd !== null ? "cancelled-after-preflight" : "main-not-started-yet"
      }
    }
    const startAt = r.corsAt ?? r.aliveAt ?? r.firstT
    const preSocket = pre?.socketWaitMs ?? 0
    const orphanPreflightMs =
      !mainStarted && logicalEnd !== null && child
        ? Math.max(0, (child.endAt ?? child.cancelAt ?? cutoff) - logicalEnd)
        : undefined
    rows.push({
      id: r.id,
      origin: safe.origin,
      path: safe.path,
      query: safe.query,
      method: r.method ?? (via ? "(preflight)" : null),
      startMs: startAt,
      endMs: logicalEnd,
      durationMs: (logicalEnd ?? cutoff) - startAt,
      open: logicalEnd === null,
      label,
      reason,
      via,
      stalled,
      group,
      socketWaitMs: (self.socketWaitMs ?? 0) + preSocket,
      responseWaitMs: self.responseWaitMs ?? (via ? pre?.responseWaitMs ?? null : null),
      preflightSocketWaitMs: pre ? preSocket : undefined,
      orphanPreflightMs: orphanPreflightMs || undefined,
      status: r.status,
      sse: r.sse || undefined,
      cancelled: r.cancelled || (!mainStarted && logicalEnd !== null) || undefined,
      netError: r.netError,
      priority: r.priority ?? child?.priority,
      socketAcquiredMs: r.streamEnd,
    })
  }
  rows.sort((a, b) => a.startMs - b.startMs)

  const origins = options.origins?.length
    ? new Set(options.origins)
    : new Set(rows.filter((r) => isLoopback(r.origin) && r.path.endsWith("/global/event")).map((r) => r.origin))

  const engine = rows.filter((r) => origins.has(r.origin))
  const upstream = rows.filter((r) => !isLoopback(r.origin) && /^https?:/.test(r.origin))

  const tally = (list, key) => {
    const out = {}
    for (const r of list) {
      const k = key(r)
      out[k] = (out[k] ?? 0) + 1
    }
    return out
  }
  // 占连接的峰值:从拿到 socket 到请求结束(HTTP/1.1 下一条 socket 一个请求)。
  const peak = (() => {
    const points = []
    for (const r of engine) {
      if (r.socketAcquiredMs === undefined) continue
      points.push([r.socketAcquiredMs, 1], [r.endMs ?? cutoff + 1, -1])
    }
    points.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    let cur = 0
    let max = 0
    let at = null
    for (const [t, d] of points) {
      cur += d
      if (cur > max) {
        max = cur
        at = t
      }
    }
    return { maxHoldingSocket: max, atMs: at }
  })()

  const streams = engine.filter((r) => r.path.endsWith("/global/event") || r.sse)
  const openStreams = streams.filter((r) => r.open && r.label === "answered")
  const slow = engine.filter(
    (r) =>
      !(r.path.endsWith("/global/event") || r.sse) &&
      ((r.socketWaitMs ?? 0) >= stallMs || (r.responseWaitMs ?? 0) >= stallMs || r.label !== "answered"),
  )

  return {
    meta: {
      events: events.length,
      firstEventEpochMs: tickOffset ? t0 + tickOffset : null,
      spanMs: Number(events.at(-1).time) - t0,
      cutoffMs: cutoff,
      cutoffSource,
      stallMs,
      engineOrigins: [...origins],
      stalledEventsTotal: jobStall.size,
    },
    engine: {
      total: engine.length,
      byLabel: tally(engine, (r) => r.label + (r.reason ? `:${r.reason}` : "")),
      peak,
      openStreamsAtCutoff: openStreams.length,
      streamsEverOpened: streams.length,
      byPath: Object.entries(tally(engine, (r) => `${r.path} [${r.label}${r.reason ? `:${r.reason}` : ""}]`))
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => ({ key: k, count: v })),
      slow: slow.map(({ id, path, query, method, startMs, durationMs, label, reason, via, stalled, group, socketWaitMs, responseWaitMs, orphanPreflightMs, status, cancelled, open }) => ({
        id, path, query, method, startMs, durationMs, label, reason, via, stalled, group, socketWaitMs, responseWaitMs, orphanPreflightMs, status, cancelled, open,
      })),
    },
    upstream: Object.entries(
      upstream.reduce((acc, r) => {
        const a = (acc[r.origin] ??= { count: 0, byLabel: {}, maxSocketWaitMs: 0, maxResponseWaitMs: 0 })
        a.count++
        a.byLabel[r.label] = (a.byLabel[r.label] ?? 0) + 1
        a.maxSocketWaitMs = Math.max(a.maxSocketWaitMs, r.socketWaitMs ?? 0)
        a.maxResponseWaitMs = Math.max(a.maxResponseWaitMs, r.responseWaitMs ?? 0)
        return acc
      }, {}),
    ).map(([origin, v]) => ({ origin, ...v })),
    rows: engine,
  }
}

const TIMELINE_NAMES = [
  "main.app.ready",
  "main.sidecar.boot.fork.start",
  "main.sidecar.boot.fork.end",
  "main.sidecar.respawn.fork.start",
  "main.sidecar.respawn.fork.end",
  "main.window.first_show",
  "renderer.composer.mount",
  "renderer.home.model_list.start",
  "renderer.home.catalog_ready",
  "renderer.home.model_list.end",
  "renderer.home.model_retry",
  "renderer.launch_draft.end",
]

/** startup-timeline.log 每行是一条日志,JSON 记录从第一个 `{"` 开始。 */
export function readTimeline(path) {
  const text = readFileSync(path, "utf8")
  const out = []
  for (const line of text.split("\n")) {
    const at = line.indexOf('{"')
    if (at < 0) continue
    try {
      const rec = JSON.parse(line.slice(at))
      if (rec && typeof rec.name === "string") out.push(rec)
    } catch {}
  }
  return out
}

export function summarizeTimeline(records) {
  const keep = records.filter((r) => TIMELINE_NAMES.some((n) => r.name === n || r.name.startsWith(n + ".")))
  const catalog = records.filter((r) => r.name === "renderer.home.catalog_ready")
  const listEnd = records.filter((r) => r.name === "renderer.home.model_list.end")
  return {
    phases: keep.map((r) => {
      const { name, t, ...rest } = r
      return { name, t, ...rest }
    }),
    probeTimeouts: catalog.map((r) => ({ t: r.t, barrierMs: r.barrierMs, probes: r.probes, probeTimeouts: r.probeTimeouts, wake: r.wake })),
    modelList: listEnd.map((r) => ({ t: r.t, chain: r.chain, attempt: r.attempt, outcome: r.outcome, durationMs: r.durationMs, count: r.count })),
    maxProbeTimeouts: catalog.reduce((m, r) => Math.max(m, r.probeTimeouts ?? 0), 0),
    maxListDurationMs: listEnd.reduce((m, r) => Math.max(m, r.durationMs ?? 0), 0),
  }
}

/**
 * opencode.log 是长期累积的,打包版上不能整份数:只数 [sinceMs, untilMs] 这段(UTC 时间戳)。
 * connected 按 run=<id>(引擎一代)分开,因为换代时旧流会断、新流再连,总和没有意义。
 * 这个计数含 main 的 chat-archive(undici,另一个连接池,不占 renderer 的 6 条)。
 */
export function summarizeEngineLog(path, window = {}) {
  const perRun = {}
  let skillInit = 0
  let serverUnavailable = 0
  let linesInWindow = 0
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const stamp = line.match(/^timestamp=(\S+)/)?.[1]
    if (!stamp) continue
    const at = Date.parse(stamp)
    if ((window.sinceMs !== undefined && at < window.sinceMs) || (window.untilMs !== undefined && at > window.untilMs)) continue
    linesInWindow++
    const run = line.match(/\brun=(\S+)/)?.[1] ?? "?"
    const r = (perRun[run] ??= { connected: 0, disconnected: 0 })
    if (line.includes('message="global event connected"')) r.connected++
    if (line.includes('message="global event disconnected"')) r.disconnected++
    if (/message=init count=/.test(line)) skillInit++
    if (line.includes('message="server unavailable"')) serverUnavailable++
  }
  return { linesInWindow, perRun, skillInit, serverUnavailable }
}

/**
 * 判定表:每个「模型读取被拖住」的样本(屏障超时 / 列表慢或失败),把它时间窗里的模型读取请求按 netlog 状态归类。
 * 时间线 t 相对 timeOrigin,netlog 相对首事件,两边都换算到 epoch 再对齐。只报每个样本的事实,不下总结论。
 */
export function joinSamples(result, records, stallMs) {
  const origin = records.find((r) => r.name === "main.timeline.epoch")?.timeOrigin
  const first = result.meta.firstEventEpochMs
  if (origin === undefined || first === null) return { skipped: `cannot align clocks: timeOrigin=${origin} netlogEpoch=${first}`, samples: [] }
  const toNet = (t) => origin + t - first
  const isModelRead = (r) => r.path.startsWith("/api/provider") || r.path.startsWith("/api/model")
  const windowOf = []
  for (const r of records) {
    if (r.name === "renderer.home.catalog_ready" && ((r.probeTimeouts ?? 0) > 0 || (r.barrierMs ?? 0) >= stallMs))
      windowOf.push({ kind: "catalog_ready", t: r.t, spanMs: r.barrierMs, probes: r.probes, probeTimeouts: r.probeTimeouts })
    if (r.name === "renderer.home.model_list.end" && ((r.durationMs ?? 0) >= stallMs || (r.outcome !== "ok" && r.outcome !== "cancelled")))
      windowOf.push({ kind: "model_list.end", t: r.t, spanMs: r.durationMs, outcome: r.outcome })
  }
  const samples = windowOf.map((w) => {
    const from = toNet(w.t - (w.spanMs ?? 0))
    const to = toNet(w.t)
    const hits = result.rows.filter((r) => isModelRead(r) && r.startMs <= to && (r.endMs ?? result.meta.cutoffMs) >= from)
    const labels = {}
    for (const h of hits) {
      const k = h.label + (h.reason ? `:${h.reason}` : "")
      labels[k] = (labels[k] ?? 0) + 1
    }
    const waiting = hits.filter((h) => h.label === "waiting-socket").length
    const unanswered = hits.filter((h) => h.label === "sent-no-response").length
    const verdict = !hits.length
      ? "窗口内 netlog 没有模型读取请求(没记到,不是没发)"
      : waiting && !unanswered
        ? "等 socket"
        : unanswered && !waiting
          ? "已发出无响应"
          : waiting && unanswered
            ? `混合:等 socket ${waiting} / 已发出无响应 ${unanswered}`
            : "窗口内的请求都答了"
    return { ...w, requests: hits.length, labels, verdict }
  })
  return { samples }
}

async function main() {
  if (!NETLOG) {
    console.error("usage: netlog-classify.mjs --netlog <net.json> [--origin ...] [--timeline ...] [--engine-log ...] [--json out] [--expect truth.json]")
    process.exit(2)
  }
  const parsed = await readNetlog(NETLOG)
  const cutoffArg = one("cutoff-ms")
  const result = classify(parsed, {
    stallMs: STALL_MS,
    origins: multi("origin"),
    cutoffMs: cutoffArg === undefined ? undefined : Number(cutoffArg),
  })
  result.meta.finalized = parsed.finalized
  result.meta.unparsedLines = parsed.unparsed
  if (one("timeline")) {
    const records = readTimeline(one("timeline"))
    result.timeline = summarizeTimeline(records)
    result.sampleTable = joinSamples(result, records, STALL_MS)
  }
  if (one("engine-log")) {
    const first = result.meta.firstEventEpochMs
    result.engineLog = summarizeEngineLog(one("engine-log"), first === null ? {} : { sinceMs: first - 5_000, untilMs: first + result.meta.spanMs + 5_000 })
  }

  console.log(`events=${result.meta.events} span=${result.meta.spanMs}ms cutoff=${result.meta.cutoffMs}ms (${result.meta.cutoffSource}) finalized=${result.meta.finalized} unparsedLines=${result.meta.unparsedLines}`)
  if (!result.meta.finalized) console.log("WARNING: netlog not finalized (process did not exit normally): tail events may be missing")
  console.log(`engine origins: ${result.meta.engineOrigins.join(", ") || "(none found: pass --origin)"}`)
  console.log(`engine requests: ${result.engine.total} ${JSON.stringify(result.engine.byLabel)}`)
  console.log(`peak holding socket: ${result.engine.peak.maxHoldingSocket}; streams open at cutoff: ${result.engine.openStreamsAtCutoff}; streams ever: ${result.engine.streamsEverOpened}; pool-stall events (all origins): ${result.meta.stalledEventsTotal}`)
  for (const row of result.engine.slow.slice(0, Number(one("show") ?? 40))) {
    console.log(
      `  ${String(row.startMs).padStart(7)} ${row.method ?? "?"} ${row.path}${row.query ? `?${row.query}` : ""} -> ${row.label}${row.reason ? `:${row.reason}` : ""}${row.via ? ` via=${row.via}` : ""} socketWait=${row.socketWaitMs} responseWait=${row.responseWaitMs} dur=${row.durationMs}${row.orphanPreflightMs ? ` orphanPreflight=${row.orphanPreflightMs}` : ""}${row.cancelled ? " cancelled" : ""}${row.open ? " open" : ""}`,
    )
  }
  if (result.upstream.length) {
    console.log("upstream (Chromium stack only, listed apart from local queueing):")
    for (const u of result.upstream) console.log(`  ${u.origin} n=${u.count} ${JSON.stringify(u.byLabel)} maxSocketWait=${u.maxSocketWaitMs} maxResponseWait=${u.maxResponseWaitMs}`)
  }
  if (result.timeline) {
    console.log(`timeline: maxProbeTimeouts=${result.timeline.maxProbeTimeouts} maxListDurationMs=${result.timeline.maxListDurationMs}`)
    for (const p of result.timeline.probeTimeouts) console.log(`  catalog_ready t=${p.t} barrierMs=${p.barrierMs} probes=${p.probes} probeTimeouts=${p.probeTimeouts} wake=${p.wake}`)
    for (const m of result.timeline.modelList) console.log(`  model_list.end t=${m.t} chain=${m.chain} attempt=${m.attempt} outcome=${m.outcome} durationMs=${m.durationMs}`)
  }
  if (result.sampleTable) {
    console.log(`sample table (${result.sampleTable.samples.length} stalled samples)${result.sampleTable.skipped ? ` SKIPPED: ${result.sampleTable.skipped}` : ""}:`)
    for (const x of result.sampleTable.samples) console.log(`  ${x.kind} t=${Math.round(x.t)} span=${Math.round(x.spanMs ?? 0)}ms ${x.outcome ?? `probes=${x.probes} probeTimeouts=${x.probeTimeouts}`} -> ${x.verdict} ${JSON.stringify(x.labels)}`)
  }
  if (result.engineLog) console.log(`engine log (netlog window): ${JSON.stringify(result.engineLog)}`)
  if (one("json")) {
    const { rows, ...summary } = result
    writeFileSync(one("json"), JSON.stringify(argv.includes("--rows") ? result : summary, null, 1))
  }

  if (one("expect")) {
    const expect = JSON.parse(readFileSync(one("expect"), "utf8"))
    const tagOf = (r) => new URLSearchParams(r.query).get("tag")
    const mismatches = []
    for (const [tag, want] of Object.entries(expect)) {
      const hit = result.rows.find((r) => tagOf(r) === tag)
      if (!hit) mismatches.push(`${tag}: not found in netlog`)
      else if (`${hit.label}${hit.reason ? `:${hit.reason}` : ""}` !== want) mismatches.push(`${tag}: want ${want}, got ${hit.label}${hit.reason ? `:${hit.reason}` : ""}`)
    }
    console.log(`expect: ${Object.keys(expect).length} tags, ${mismatches.length} mismatches`)
    for (const m of mismatches) console.log(`  MISMATCH ${m}`)
    if (mismatches.length) process.exit(1)
  }
}

if (import.meta.main ?? process.argv[1]?.endsWith("netlog-classify.mjs")) await main()
