// alpha-code#1554 AC4 —— H1 三个前提在「真实 Electron 二进制」上的实测,不依赖产品代码。
//
//   <Electron> fixture/h1-premises.main.cjs --use-mock-keychain --user-data-dir=<tmp> \
//     --log-net-log=<tmp>/net.json --out=<tmp>/premises.json [--mode=premises|sample]
//
// 判据只看服务端的地面真相:一个本进程 Node http 服务(libuv,不经 Chromium)记下每条 TCP 连接、
// 每个请求的到达顺序。页面只负责发 fetch。这样「到没到」不是由被测的 Chromium 自己报告的。
//
// 与产品相同的三件事(packages/ui-mac/src/main/windows.ts、index.ts):页面在 oc://renderer
// (secure + standard + supportFetchAPI),目标是 http://127.0.0.1:<port>,带 proxy-bypass-list=<-loopback>。
// 产品的 fetch 带 Authorization(sidebar/use-projects.ts 的 authHeaders),所以跨源预检也要算进来:
// 每一项分 simple(无预检)与 auth(带头,有预检)两种形状。
//
// 窗口:accessory 激活策略 + showInactive + 透明 + 不接鼠标,不抢前台也不挡点击;页面仍是 visible。

const { app, BrowserWindow, protocol } = require("electron")
const http = require("node:http")
const fs = require("node:fs")

const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const OUT = argOf("out")
const MODE = argOf("mode", "premises")
if (!OUT) {
  console.error("--out=<path> is required")
  app.exit(2)
}

app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")
if (process.platform === "darwin") {
  app.setActivationPolicy("accessory")
  app.dock?.hide()
}
protocol.registerSchemesAsPrivileged([
  { scheme: "oc", privileges: { secure: true, standard: true, supportFetchAPI: true } },
])

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SETTLE_MS = 1200

function makeServer(label) {
  const s = {
    label,
    conns: 0,
    arrivals: [],
    held: new Map(),
    sse: new Map(),
    port: 0,
    srv: null,
  }
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "authorization,content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  }
  s.srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x")
    const tag = u.searchParams.get("tag") ?? ""
    s.arrivals.push({ t: Date.now(), method: req.method, path: u.pathname, tag })
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors)
      res.end()
      return
    }
    if (u.pathname === "/fast") {
      res.writeHead(200, { ...cors, "content-type": "text/plain" })
      res.end("ok")
      return
    }
    if (u.pathname === "/sse") {
      res.writeHead(200, { ...cors, "content-type": "text/event-stream", "cache-control": "no-cache" })
      res.write(": hello\n\n")
      const timer = setInterval(() => res.write(": tick\n\n"), 500)
      req.on("close", () => {
        clearInterval(timer)
        s.sse.delete(tag)
      })
      s.sse.set(tag, res)
      return
    }
    // /hang:收到即记录,不回一个字节。
    s.held.set(tag, res)
    req.on("close", () => s.held.delete(tag))
  })
  s.srv.keepAliveTimeout = 600_000
  s.srv.headersTimeout = 0
  s.srv.requestTimeout = 0
  s.srv.on("connection", () => {
    s.conns++
  })
  s.release = (tag) => {
    const res = s.held.get(tag)
    if (!res) return false
    res.writeHead(200, { ...cors, "content-type": "text/plain" })
    res.end("released")
    s.held.delete(tag)
    return true
  }
  s.gets = (path) => s.arrivals.filter((a) => a.method !== "OPTIONS" && (!path || a.path === path)).map((a) => a.tag)
  s.close = () =>
    new Promise((r) => {
      for (const res of s.held.values()) res.destroy()
      for (const res of s.sse.values()) res.destroy()
      s.srv.close(() => r())
      s.srv.closeAllConnections()
    })
  return new Promise((resolve) => s.srv.listen(0, "127.0.0.1", () => ((s.port = s.srv.address().port), resolve(s))))
}

const PAGE = `<!doctype html><meta charset=utf-8><title>h1-premises</title><script>
window.__p = { reqs: new Map() };
window.__start = (key, url, auth) => {
  const ctl = new AbortController();
  const rec = { key, state: 'pending', ctl };
  __p.reqs.set(key, rec);
  const headers = auth ? { authorization: 'Basic ZmFrZTpmYWtl' } : {};
  fetch(new Request(url, { headers, signal: ctl.signal }))
    .then(async (r) => { rec.state = 'headers:' + r.status; rec.status = r.status; await r.text(); rec.state = 'done:' + r.status; })
    .catch((e) => { rec.state = 'error:' + e.name; });
  return true;
};
window.__stream = (key, url, auth) => {
  const ctl = new AbortController();
  const rec = { key, state: 'pending', ctl, chunks: 0 };
  __p.reqs.set(key, rec);
  const headers = auth ? { authorization: 'Basic ZmFrZTpmYWtl' } : {};
  fetch(new Request(url, { headers, signal: ctl.signal }))
    .then(async (r) => { rec.state = 'streaming'; const rd = r.body.getReader(); for (;;) { const c = await rd.read(); if (c.done) break; rec.chunks++; } rec.state = 'ended'; })
    .catch((e) => { rec.state = 'error:' + e.name; });
  return true;
};
window.__abort = (key) => { __p.reqs.get(key)?.ctl.abort(); return true; };
window.__state = () => Object.fromEntries([...__p.reqs].map(([k, v]) => [k, { state: v.state, chunks: v.chunks }]));
</script>`

let win
const js = (code) => win.webContents.executeJavaScript(code, true)
const url = (s, path, tag) => `http://127.0.0.1:${s.port}${path}?tag=${encodeURIComponent(tag)}`
const start = (key, u, auth) => js(`__start(${JSON.stringify(key)}, ${JSON.stringify(u)}, ${!!auth})`)
const stream = (key, u, auth) => js(`__stream(${JSON.stringify(key)}, ${JSON.stringify(u)}, ${!!auth})`)
const abort = (key) => js(`__abort(${JSON.stringify(key)})`)
const state = () => js(`__state()`)

const shapes = [
  { shape: "simple", auth: false },
  { shape: "auth", auth: true },
]
let unique = 0
const uid = (x) => `${x}-${++unique}`

async function p0Control() {
  // 对照:量具本身能不能看见超过 6 条?12 个 fetch 打到 12 个不同 origin,每个 origin 应各到 1 个。
  const servers = []
  for (let i = 0; i < 12; i++) servers.push(await makeServer(`ctrl${i}`))
  for (const s of servers) await start(uid("c"), url(s, "/hang", "x"), false)
  await sleep(SETTLE_MS)
  const seen = servers.map((s) => s.gets("/hang").length)
  for (const s of servers) await s.close()
  return { id: "P0-control-12-origins", perOriginArrivals: seen, total: seen.reduce((a, b) => a + b, 0), pass: seen.every((n) => n === 1) }
}

async function p1Cap({ shape, auth }) {
  const s = await makeServer("p1")
  const keys = Array.from({ length: 12 }, (_, i) => `h${i}`)
  const pageKeys = keys.map((k) => uid(k))
  for (let i = 0; i < 12; i++) await start(pageKeys[i], url(s, "/hang", keys[i]), auth)
  await sleep(SETTLE_MS)
  const firstWave = s.gets("/hang").length
  const connsFirstWave = s.conns
  const released = s.gets("/hang")[0]
  s.release(released)
  await sleep(SETTLE_MS)
  const afterOneRelease = s.gets("/hang").length
  for (let round = 0; round < 12; round++) {
    for (const k of keys) s.release(k)
    await sleep(120)
  }
  await sleep(SETTLE_MS / 2)
  const finalArrivals = s.gets("/hang").length
  const pageState = await state()
  const settled = pageKeys.map((k) => pageState[k]?.state)
  await s.close()
  return {
    id: `P1-cap-${shape}`,
    issued: 12,
    arrivedBeforeRelease: firstWave,
    tcpConnectionsBeforeRelease: connsFirstWave,
    arrivedAfterOneRelease: afterOneRelease,
    arrivedAfterAllReleased: finalArrivals,
    tcpConnectionsTotal: s.conns,
    settled: [...new Set(settled)],
    holds: firstWave === 6 && afterOneRelease === 7 && finalArrivals === 12,
  }
}

async function p2SseCounts({ shape, auth }) {
  // K 条进行中的 SSE(fetch 读流,与产品 SDK 同形)+ 12 个不答请求:到达数应为 6-K。
  const rows = []
  for (const k of [0, 1, 2, 3, 4, 5, 6]) {
    const s = await makeServer("p2")
    const sseKeys = []
    for (let i = 0; i < k; i++) {
      const key = uid(`sse${i}`)
      sseKeys.push(key)
      await stream(key, url(s, "/sse", `sse${i}`), auth)
    }
    await sleep(SETTLE_MS)
    const hangKeys = []
    for (let i = 0; i < 12; i++) {
      const key = uid(`h${i}`)
      hangKeys.push(key)
      await start(key, url(s, "/hang", `h${i}`), auth)
    }
    await sleep(SETTLE_MS)
    const pageState = await state()
    rows.push({
      sse: k,
      sseArrived: s.gets("/sse").length,
      sseStreaming: sseKeys.filter((x) => pageState[x]?.state === "streaming" && pageState[x]?.chunks > 0).length,
      hangArrived: s.gets("/hang").length,
      expected: 6 - k,
      tcpConnections: s.conns,
    })
    await s.close()
  }
  // 饿死形状:6 条流占满后,一个本该立刻返回的请求答不答?关掉一条流后答不答?对照:5 条流时答不答。
  const starve = async (n) => {
    const s = await makeServer("p2s")
    const sseKeys = []
    for (let i = 0; i < n; i++) {
      const key = uid(`s${i}`)
      sseKeys.push(key)
      await stream(key, url(s, "/sse", `s${i}`), auth)
    }
    await sleep(SETTLE_MS)
    const fastKey = uid("fast")
    const t0 = Date.now()
    await start(fastKey, url(s, "/fast", "fast"), auth)
    let answeredAt = null
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      const st = await state()
      if (String(st[fastKey]?.state).startsWith("done")) {
        answeredAt = Date.now() - t0
        break
      }
      await sleep(25)
    }
    let afterCloseMs = null
    if (answeredAt === null) {
      const t1 = Date.now()
      await abort(sseKeys[0])
      const deadline2 = Date.now() + 3000
      while (Date.now() < deadline2) {
        const st = await state()
        if (String(st[fastKey]?.state).startsWith("done")) {
          afterCloseMs = Date.now() - t1
          break
        }
        await sleep(25)
      }
    }
    await s.close()
    return { sse: n, fastAnsweredWithin3sMs: answeredAt, afterClosingOneStreamMs: afterCloseMs }
  }
  const starved = await starve(6)
  const control = await starve(5)
  return {
    id: `P2-sse-counts-${shape}`,
    rows,
    starved,
    control,
    holds:
      rows.every((r) => r.hangArrived === r.expected && r.sseStreaming === r.sse) &&
      starved.fastAnsweredWithin3sMs === null &&
      starved.afterClosingOneStreamMs !== null &&
      control.fastAnsweredWithin3sMs !== null,
  }
}

async function fillSix(s, auth) {
  const holds = []
  for (let i = 0; i < 6; i++) {
    holds.push(`H${i}`)
    await start(uid(`H${i}`), url(s, "/hang", `H${i}`), auth)
  }
  await sleep(SETTLE_MS)
  if (s.gets("/hang").length !== 6) throw new Error(`fillSix: expected 6 arrivals, got ${s.gets("/hang").length}`)
  return holds
}

async function releaseOneByOne(s, holds, waitMs) {
  for (const h of holds) {
    s.release(h)
    await sleep(waitMs)
  }
}

async function p3Order({ shape, auth }) {
  const GAP = 150
  // 对照:不取消时队列是不是先进先出。不是 FIFO 的话,下面的实验就没有判别力。
  const fifo = await makeServer("p3f")
  const fifoHolds = await fillSix(fifo, auth)
  for (const t of ["A", "B", "C"]) {
    await start(uid(t), url(fifo, "/hang", t), auth)
    await sleep(GAP)
  }
  await sleep(SETTLE_MS)
  const queuedBeforeRelease = fifo.gets("/hang").length
  await releaseOneByOne(fifo, fifoHolds.slice(0, 3), SETTLE_MS / 2)
  const fifoOrder = fifo.gets("/hang").slice(6)
  await fifo.close()

  // 实验:A 排第一,取消后立刻重发 A2。若「落到队尾」成立,到达顺序应是 B、C、A2。
  const rounds = []
  for (let round = 0; round < 3; round++) {
    const s = await makeServer("p3a")
    const holds = await fillSix(s, auth)
    const keyA = uid("A")
    await start(keyA, url(s, "/hang", "A"), auth)
    await sleep(GAP)
    await start(uid("B"), url(s, "/hang", "B"), auth)
    await sleep(GAP)
    await start(uid("C"), url(s, "/hang", "C"), auth)
    await sleep(GAP)
    await abort(keyA)
    await sleep(GAP)
    await start(uid("A2"), url(s, "/hang", "A2"), auth)
    await sleep(SETTLE_MS)
    const before = s.gets("/hang").length
    await releaseOneByOne(s, holds.slice(0, 3), SETTLE_MS / 2)
    rounds.push({
      arrivedBeforeRelease: before,
      order: s.gets("/hang").slice(6),
      arrivedA: s.gets("/hang").includes("A"),
      methodsSeen: s.arrivals.slice(6).map((a) => `${a.method}:${a.tag}`),
    })
    await s.close()
  }

  // 屏障形状:同产品 model-contract.ts —— 单探针 1s 不答就 abort 换一条新请求。
  // cmd1..cmd3 排在探针之前。前提成立时探针要等 cmd1..cmd3 全部拿到连接之后才到得了服务端。
  const b = await makeServer("p3b")
  const bHolds = await fillSix(b, auth)
  for (const t of ["cmd1", "cmd2", "cmd3"]) {
    await start(uid(t), url(b, "/hang", t), auth)
    await sleep(GAP)
  }
  let probeSeq = 0
  let probeKey = null
  const issueProbe = async () => {
    if (probeKey) await abort(probeKey)
    probeSeq++
    probeKey = uid(`probe${probeSeq}`)
    await start(probeKey, url(b, "/fast", `probe${probeSeq}`), auth)
  }
  await issueProbe()
  const releases = []
  for (let i = 0; i < 4; i++) {
    for (let tick = 0; tick < 2; tick++) {
      await sleep(1000)
      await issueProbe()
    }
    b.release(bHolds[i])
    releases.push({ released: bHolds[i], at: Date.now() })
  }
  for (let tick = 0; tick < 3; tick++) {
    await sleep(1000)
    await issueProbe()
  }
  const barrier = {
    probesIssued: probeSeq,
    order: b.arrivals.filter((a) => a.method !== "OPTIONS" && !/^H\d$/.test(a.tag)).map((a) => a.tag),
  }
  await b.close()

  const expected = ["B", "C", "A2"]
  const roundsHold = rounds.every(
    (r) => r.arrivedBeforeRelease === 6 && JSON.stringify(r.order) === JSON.stringify(expected) && !r.arrivedA,
  )
  const firstProbeIdx = barrier.order.findIndex((t) => t.startsWith("probe"))
  const barrierHolds =
    firstProbeIdx >= 3 && ["cmd1", "cmd2", "cmd3"].every((c) => barrier.order.slice(0, firstProbeIdx).includes(c))
  return {
    id: `P3-requeue-${shape}`,
    fifoControl: { queuedArrivedBeforeRelease: queuedBeforeRelease - 6, order: fifoOrder, isFifo: JSON.stringify(fifoOrder) === '["A","B","C"]' },
    rounds,
    barrier,
    holds: roundsHold && barrierHolds && JSON.stringify(fifoOrder) === '["A","B","C"]',
  }
}

async function sampleMode() {
  // 判据样本:故意造「等 socket」和「已发出无响应」,外加两种容易判错的:排队中被 abort、发出后被 abort;再加连接被拒。
  // 地面真相 = 服务端收到了谁(服务端不经 Chromium)。全部用带头的形状,与产品同样有预检。
  const s = await makeServer("sample")
  const t = await makeServer("sample-abort")
  const heardGet = (srv) => srv.arrivals.filter((a) => a.method !== "OPTIONS").map((a) => a.tag)
  await start(uid("fast0"), url(s, "/fast", "fast0"), true)
  await sleep(300)
  for (let i = 0; i < 6; i++) await start(uid(`S${i}`), url(s, "/hang", `S${i}`), true)
  await sleep(SETTLE_MS)
  for (let i = 0; i < 3; i++) await start(uid(`W${i}`), url(s, "/hang", `W${i}`), true)
  const xKey = uid("X0")
  await start(xKey, url(s, "/hang", "X0"), true)
  await sleep(1000)
  await abort(xKey)
  const yKey = uid("Y0")
  await start(yKey, url(t, "/hang", "Y0"), true)
  await sleep(1000)
  await abort(yKey)
  const dead = await makeServer("sample-dead")
  const deadPort = dead.port
  await dead.close()
  await start(uid("F0"), `http://127.0.0.1:${deadPort}/hang?tag=F0`, true)
  await sleep(2500)
  const heard = heardGet(s)
  const heardT = heardGet(t)
  const expect = {}
  expect.fast0 = heard.includes("fast0") ? "answered" : "?"
  for (let i = 0; i < 6; i++) expect[`S${i}`] = heard.includes(`S${i}`) ? "sent-no-response" : "?"
  for (let i = 0; i < 3; i++) expect[`W${i}`] = heard.includes(`W${i}`) ? "?" : "waiting-socket:pool-stalled"
  expect.X0 = heard.includes("X0") ? "?" : "waiting-socket:pool-stalled"
  expect.Y0 = heardT.includes("Y0") ? "sent-no-response" : "?"
  expect.F0 = "failed:net_error=-102"
  return {
    id: "sample",
    origins: [`http://127.0.0.1:${s.port}`, `http://127.0.0.1:${t.port}`, `http://127.0.0.1:${deadPort}`],
    serverHeard: heard,
    serverHeardAbortOrigin: heardT,
    expect,
    optionsSeenForAbortedQueued: s.arrivals.filter((a) => a.method === "OPTIONS" && a.tag === "X0").length,
    tcpConnections: s.conns,
  }
}

app.whenReady().then(async () => {
  protocol.handle("oc", () => new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } }))
  win = new BrowserWindow({ show: false, width: 400, height: 300, webPreferences: { backgroundThrottling: false, contextIsolation: false } })
  win.setOpacity(0)
  win.setIgnoreMouseEvents(true)
  win.showInactive()
  await win.loadURL("oc://renderer/blank.html")
  const report = {
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    argv: process.argv.slice(1).filter((a) => a.startsWith("--")),
    visibility: await js("document.visibilityState"),
    startedAt: new Date().toISOString(),
    results: [],
  }
  const write = () => fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
  try {
    if (MODE === "sample") {
      report.results.push(await sampleMode())
    } else {
      report.results.push(await p0Control())
      write()
      for (const sh of shapes) {
        report.results.push(await p1Cap(sh))
        write()
        report.results.push(await p2SseCounts(sh))
        write()
        report.results.push(await p3Order(sh))
        write()
      }
    }
  } catch (e) {
    report.fatal = String(e?.stack ?? e)
  }
  report.endedAt = new Date().toISOString()
  write()
  app.exit(report.fatal ? 1 : 0)
})
