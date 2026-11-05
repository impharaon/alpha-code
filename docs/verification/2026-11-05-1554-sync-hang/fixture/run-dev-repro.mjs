#!/usr/bin/env bun
// alpha-code#1554 AC1 dev 复现夹具:N 个目录各配一个不应答的远程 MCP,打开 N 个输入框,看模型读取有没有被拖住。
//
//   bun fixture/run-dev-repro.mjs --n 4 --round 1 --out results/ac1 [--no-mcp] [--hold-ms 170000] [--extra-streams K] [--app-root <树>]
//
// 硬规矩(派发书):
//   · 不碰 /Applications/Code Puppy.app。跑的是本 worktree 的 packages/ui-mac/out + node_modules 里的 Electron。
//   · 隔离先证明:lsof 判定器自证 → 实例起来后 lsof 判定(收工前再判一次),不过立刻按进程组停掉、非零退出。
//     产品的进程围栏 fail-closed 且不能嵌套(sandbox_apply: Operation not permitted),所以实例本身不能跑在
//     sandbox-exec 里。钥匙串这一面:--use-mock-keychain,加 SecurityAgent 看门狗(新进程出现即停);
//     --guarded-preflight 单独把主进程 + renderer 放进 guard.sb 跑一段,用系统日志核它碰没碰钥匙串 / authd。
//   · 一次一个实例;CDP 口与引擎口都是本轮临时的;收工按进程组回收,并确认没有孤儿。
//   · 不发模型调用,不放任何 key;远程端点全部指向本机桩,桩只回 404。
//   · 真实输入路径:DOM 上点 chip →「打开项目…」(不是系统点击),目录由 dev-preload 的 showOpenDialog 替身给出。
//
// 判据(票面矩阵,不放宽):一轮算复现 = 配好 MCP、换代、点新对话之后,有输入框的模型读取超过 10 秒未返回。

import { spawn, spawnSync } from "node:child_process"
import { createServer as createNet } from "node:net"
import { createServer as createHttp } from "node:http"
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { networkInterfaces } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { lsofVerdict, proveGuard, proveLsofVerdict, REAL_HOME, writeGuard } from "./isolation-guard.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, "..", "..", "..", "..")
// --app-root:对照臂用另一棵树的构建产物(同一个驱动),默认本 worktree。
const appRootArg = process.argv.includes("--app-root") ? process.argv[process.argv.indexOf("--app-root") + 1] : undefined
const UI_MAC = appRootArg ? join(appRootArg, "packages/ui-mac") : join(REPO, "packages/ui-mac")
const ELECTRON = join(UI_MAC, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const flag = (name) => process.argv.includes(`--${name}`)
const N = Number(arg("n", "4"))
const ROUND = arg("round", "1")
const OUT = arg("out")
const HOLD_MS = Number(arg("hold-ms", "90000"))
// 至少看满一轮 MCP 握手超时(mcp/index.ts DEFAULT_TIMEOUT = 30s),别在 MCP 还没出结果时就收工。
const HOLD_MIN_MS = Number(arg("hold-min-ms", "45000"))
const MCP = !flag("no-mcp")
const GAP_MS = Number(arg("gap-ms", "600"))
const EXTRA_STREAMS = Number(arg("extra-streams", "0"))
// --open-more:点完新对话之后,再开 N 个没开过的目录。此时 MCP 已配好且不应答,每个目录的引擎实例都是现建的。
// 只跑默认协议时,换代后真正重建实例的只有默认目录一个,N 个目录并没有同时在等 MCP,这一臂补上「N 个同时等」。
const OPEN_MORE = flag("open-more")
const LABEL = arg("label", `n${N}${MCP ? "" : "-nomcp"}-r${ROUND}`)
if (!OUT) throw new Error("--out is required")
const OUT_ABS = resolve(OUT)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ROOT = `/tmp/1554/${LABEL}-${process.pid}`
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a)

async function freePort() {
  return new Promise((res, rej) => {
    const s = createNet()
    s.on("error", rej)
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port
      s.close(() => res(p))
    })
  })
}

// ------------------------------------------------------------------- 不应答的 MCP:只收不回
const blackholes = []
const lanIp = () => {
  for (const [name, list] of Object.entries(networkInterfaces())) {
    if (!/^en\d/.test(name)) continue
    const hit = list?.find((a) => a.family === "IPv4" && !a.internal)
    if (hit) return hit.address
  }
  throw new Error("no LAN IPv4 on en*: the black hole needs a non-loopback address (see below)")
}
async function startBlackhole(label, host) {
  const rec = { label, host, port: 0, conns: 0, bytes: 0, firstConnAt: null, sockets: new Set(), server: null }
  rec.server = createNet((sock) => {
    rec.conns++
    rec.firstConnAt ??= Date.now()
    rec.sockets.add(sock)
    sock.on("data", (d) => (rec.bytes += d.length))
    sock.on("error", () => {})
    sock.on("close", () => rec.sockets.delete(sock))
  })
  await new Promise((r) => rec.server.listen(0, host, r))
  rec.port = rec.server.address().port
  blackholes.push(rec)
  return rec
}

// ------------------------------------------------------------------- 远程端点桩:一律 404,记路径
const stubHits = {}
const stub = createHttp((req, res) => {
  const path = new URL(req.url, "http://x").pathname
  stubHits[path] = (stubHits[path] ?? 0) + 1
  res.writeHead(404, { "content-type": "application/json" })
  res.end("{}")
})

// ------------------------------------------------------------------- 进程组回收
let child = null
let pgid = null
const groupPids = () =>
  pgid
    ? spawnSync("/usr/bin/pgrep", ["-g", String(pgid)], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean).map(Number)
    : []
async function stopGroup() {
  if (!pgid) return { killed: 0, leftover: [] }
  const before = groupPids()
  // 先只给主进程发 SIGTERM,等它自己退。整组发的话网络服务先死,主进程会把它重启一次,
  // 而重启的网络服务会把 --log-net-log 那个文件截断重写(smoke2 实测:整份只剩 11 个事件)。
  try {
    process.kill(pgid, "SIGTERM")
  } catch {}
  for (let i = 0; i < 100 && groupPids().includes(pgid); i++) await sleep(100)
  const mainExitedAlone = !groupPids().includes(pgid)
  try {
    process.kill(-pgid, "SIGTERM")
  } catch {}
  for (let i = 0; i < 40 && groupPids().length; i++) await sleep(100)
  const stubborn = groupPids()
  if (stubborn.length) {
    try {
      process.kill(-pgid, "SIGKILL")
    } catch {}
    for (let i = 0; i < 30 && groupPids().length; i++) await sleep(100)
  }
  return { killed: before.length, mainExitedAlone, sigkillNeeded: stubborn.length, leftover: groupPids() }
}

/** 引擎若另起进程组,按「打开了本轮临时根」再找一遍:只认路径落在 ROOT 下的进程,绝不按进程名。 */
function orphansInRoot() {
  const out = spawnSync("/bin/sh", ["-c", `/usr/sbin/lsof -nP +D ${JSON.stringify(ROOT)} -Fp 2>/dev/null`], { encoding: "utf8", timeout: 20_000 }).stdout ?? ""
  return [...new Set(out.split("\n").filter((l) => l.startsWith("p")).map((l) => Number(l.slice(1))))].filter((p) => p !== process.pid)
}

// ------------------------------------------------------------------- CDP
class Cdp {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data)
      const p = msg.id ? this.pending.get(msg.id) : undefined
      if (!p) return
      this.pending.delete(msg.id)
      msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result)
    })
  }
  send(method, params = {}, timeoutMs = 15_000) {
    const id = ++this.seq
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        rej(new Error(`cdp timeout ${method}`))
      }, timeoutMs)
      this.pending.set(id, { res: (v) => (clearTimeout(timer), res(v)), rej: (e) => (clearTimeout(timer), rej(e)) })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression, timeoutMs) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs)
    if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
    return r.result.value
  }
}
async function connectPage(port, deadlineMs) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(1500) })).json()
      const page = targets.find((t) => t.type === "page" && /index\.html/.test(t.url))
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((res, rej) => {
          ws.addEventListener("open", res, { once: true })
          ws.addEventListener("error", rej, { once: true })
        })
        return new Cdp(ws)
      }
    } catch {}
    await sleep(250)
  }
  throw new Error(`no renderer page on CDP port ${port} within ${deadlineMs}ms`)
}

// ------------------------------------------------------------------- 日志定位
function findFile(root, name) {
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let list
    try {
      list = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of list) {
      const p = join(dir, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.name === name) return p
    }
  }
}
function findFiles(root, re) {
  const out = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let list
    try {
      list = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of list) {
      const p = join(dir, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (re.test(e.name)) out.push(p)
    }
  }
  return out
}
function readMarks(file) {
  if (!file || !existsSync(file)) return []
  const out = []
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const at = line.indexOf('{"')
    if (at < 0) continue
    try {
      const rec = JSON.parse(line.slice(at))
      if (rec?.name) out.push(rec)
    } catch {}
  }
  return out
}

const result = {
  label: LABEL,
  n: N,
  mcp: MCP,
  round: ROUND,
  startedAt: new Date().toISOString(),
  isolation: {},
  deviations: [],
}
let finishing = false
let watchdogTimer = null
const finish = async (code, why) => {
  if (finishing) return
  finishing = true
  if (watchdogTimer) clearInterval(watchdogTimer)
  result.endedAt = new Date().toISOString()
  result.exit = { code, why }
  const stop = await stopGroup()
  result.cleanup = { ...stop, orphansInRoot: orphansInRoot() }
  for (const b of blackholes) {
    for (const s of b.sockets) s.destroy()
    b.server.close()
  }
  stub.close()
  mkdirSync(OUT_ABS, { recursive: true })
  writeFileSync(join(OUT_ABS, `${LABEL}.json`), JSON.stringify(result, null, 1))
  log(`exit ${code}: ${why}`)
  process.exit(code)
}

// ===================================================================  1. 隔离闸自证
for (const d of ["home", "tmp", "udd"]) mkdirSync(join(ROOT, d), { recursive: true })
const guardPath = join(ROOT, "guard.sb")
writeGuard(guardPath)
result.isolation.guardProof = proveGuard(guardPath)
result.isolation.lsofVerdictProof = proveLsofVerdict(ROOT)
if (!result.isolation.guardProof.proven || !result.isolation.lsofVerdictProof.proven) await finish(3, "isolation self-proof failed; nothing launched")
if (!existsSync(join(UI_MAC, "out/main/index.js"))) await finish(4, "packages/ui-mac/out missing: build first")

// ===================================================================  2. 夹具目录
const dirs = []
for (let i = 1; i <= (OPEN_MORE ? 2 * N : N); i++) {
  const ws = join(ROOT, `ws${i}`)
  mkdirSync(ws, { recursive: true })
  dirs.push(ws)
}
const stubPort = await freePort()
await new Promise((r) => stub.listen(stubPort, "127.0.0.1", r))
const BASE = `http://127.0.0.1:${stubPort}`
const cdpPort = await freePort()
const netlog = join(ROOT, "net.json")
const preloadLog = join(ROOT, "preload.jsonl")
const initiators = join(ROOT, "initiators.jsonl")
const appOut = openSync(join(ROOT, "app.stdout.log"), "a")

// ===================================================================  3. 启动(环境白名单:不继承 owner 的 env,里面可能有 key)
const env = {
  PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin",
  HOME: join(ROOT, "home"),
  CFFIXED_USER_HOME: join(ROOT, "home"),
  TMPDIR: join(ROOT, "tmp") + "/",
  USER: process.env.USER ?? "tide",
  LOGNAME: process.env.USER ?? "tide",
  SHELL: "/bin/sh",
  LANG: "en_US.UTF-8",
  OPENCODE_TEST_ONBOARDING: "1",
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
  CODEPUPPY_WEB_URL: BASE,
  CODEPUPPY_PLATFORM_URL: BASE,
  CODEPUPPY_ACCOUNT_URL: BASE,
  CODEPUPPY_CLOUD_URL: BASE,
  CODEPUPPY_MCP_URL: `${BASE}/mcp`,
  // 改名前的树(对照臂)读的是这组
  ALPHA_WEB_URL: BASE,
  ALPHA_PLATFORM_URL: BASE,
  ALPHA_ACCOUNT_URL: BASE,
  ALPHA_CLOUD_URL: BASE,
  ALPHA_MCP_URL: `${BASE}/mcp`,
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  P1554_DIRS: dirs.join(":"),
  P1554_CDP_PORT: String(cdpPort),
  P1554_PRELOAD_LOG: preloadLog,
  P1554_INITIATORS: initiators,
}
const PREFLIGHT = flag("guarded-preflight")
const launchFlags = [...(PREFLIGHT ? ["--no-sandbox"] : []), "--use-mock-keychain", `--user-data-dir=${join(ROOT, "udd")}`, `--log-net-log=${netlog}`]
result.launch = { flags: launchFlags.map((f) => f.replaceAll(ROOT, "<root>")), cdpPort, envKeys: Object.keys(env) }
result.deviations.push("窗口透明且不抢前台(dev-preload),CDP 口被改写;都不碰网络栈。")
const securityAgents = () => spawnSync("/usr/bin/pgrep", ["-x", "SecurityAgent"], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean)
const agentsBaseline = new Set(securityAgents())
result.isolation.securityAgentBaseline = agentsBaseline.size
const dotDirMtime = (p) => {
  try {
    return statSync(p).mtimeMs
  } catch {
    return null
  }
}
const DEV_USERDATA = join(REAL_HOME, "Library/Application Support/ai.opencode.desktop.dev")
result.isolation.devUserDataMtimeBefore = dotDirMtime(DEV_USERDATA)
const launchedAt = Date.now()
const electronArgs = ["-r", join(HERE, "dev-preload.cjs"), UI_MAC, ...launchFlags]
child = PREFLIGHT
  ? spawn("/usr/bin/sandbox-exec", ["-f", guardPath, ELECTRON, ...electronArgs], { detached: true, env, cwd: ROOT, stdio: ["ignore", appOut, appOut] })
  : spawn(ELECTRON, electronArgs, { detached: true, env, cwd: ROOT, stdio: ["ignore", appOut, appOut] })
closeSync(appOut)
pgid = child.pid
child.on("exit", (code, signal) => {
  result.appExit = { code, signal, afterMs: Date.now() - launchedAt }
})
log(`launched pgid=${pgid} root=${ROOT} cdp=${cdpPort}`)

// 看门狗:新出现 SecurityAgent 就去问 authd 是谁要的。只有「loginwindow 要 system.login.screensaver」(owner 解锁屏幕,
// smoke3 实测)放行并记录;问不出来、或是别的请求方,一律立刻停。宁可误停,不许让框弹在 owner 屏幕上还接着跑。
const agentsSeen = new Set(agentsBaseline)
result.isolation.securityAgentEvents = []
const whoAskedAuthd = () => {
  const out = spawnSync(
    "/usr/bin/log",
    ["show", "--last", "20s", "--style", "compact", "--predicate", 'process == "authd" AND eventMessage CONTAINS "authorizing right"'],
    { encoding: "utf8", timeout: 15_000 },
  ).stdout ?? ""
  return out.split("\n").filter((l) => l.includes("authorizing right")).map((l) => l.replace(/^.*?authd\[[^\]]*\]\s*/, "").slice(0, 220))
}
const watchdog = setInterval(() => {
  const fresh = securityAgents().filter((p) => !agentsSeen.has(p))
  if (!fresh.length) return
  for (const p of fresh) agentsSeen.add(p)
  spawnSync("/bin/sleep", ["1.5"])
  const askers = whoAskedAuthd()
  const onlyScreenUnlock = askers.length > 0 && askers.every((l) => l.includes("system.login.screensaver") && l.includes("loginwindow.app"))
  result.isolation.securityAgentEvents.push({ pids: fresh, askers, afterMs: Date.now() - launchedAt, verdict: onlyScreenUnlock ? "screen-unlock:continue" : "stop" })
  if (onlyScreenUnlock) {
    log(`SecurityAgent ${fresh.join(",")} = owner screen unlock (authd: loginwindow, system.login.screensaver); continuing`)
    return
  }
  clearInterval(watchdog)
  void finish(8, `SecurityAgent appeared during the run (pids ${fresh.join(",")}), asker not attributable to a screen unlock: stopping at once`)
}, 500)
watchdogTimer = watchdog

if (PREFLIGHT) {
  // 引擎在沙箱里起不来(围栏 fail-closed),这一段只量主进程 + renderer 碰没碰钥匙串。
  const startStamp = new Date(launchedAt - 1000).toISOString().replace("T", " ").slice(0, 19)
  const seenPids = new Set()
  const preflightUntil = Date.now() + Number(arg("preflight-ms", "20000"))
  while (Date.now() < preflightUntil) {
    for (const p of groupPids()) seenPids.add(p)
    await sleep(500)
  }
  // 反向对照:同一个沙箱里故意读一次钥匙串目录,下面的日志查询必须查得到,否则「零条」不算数。
  const control = spawnSync("/usr/bin/sandbox-exec", ["-f", guardPath, "/bin/ls", join(REAL_HOME, "Library/Keychains")], { stdio: "ignore" })
  seenPids.add(control.pid)
  await sleep(2500)
  const stop = await stopGroup()
  const fmt = (d) => new Intl.DateTimeFormat("sv-SE", { dateStyle: "short", timeStyle: "medium" }).format(d)
  const denies = spawnSync(
    "/usr/bin/log",
    ["show", "--start", fmt(new Date(launchedAt - 1000)), "--style", "compact", "--predicate", 'eventMessage CONTAINS "deny("'],
    { encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
  ).stdout.split("\n").filter((l) => l.includes("deny(") && [...seenPids].some((p) => l.includes(`(${p})`) || l.includes(`[${p}:`)))
  const controlLines = denies.filter((l) => l.includes(`(${control.pid})`) || l.includes(`[${control.pid}:`))
  const appDenies = denies.filter((l) => !controlLines.includes(l))
  result.preflight = {
    startStamp,
    pidsWatched: seenPids.size,
    positiveControlCaught: controlLines.some((l) => l.includes("Keychains")),
    appKeychainOrAuthDenies: appDenies.filter((l) => /authd|security\.agent|Keychains/.test(l)).length,
    fenceRefusedProvesSandboxActive: /sandbox_apply: Operation not permitted/.test(readFileSync(join(ROOT, "app.stdout.log"), "utf8")),
    stop,
    denyLines: appDenies.length,
    sample: appDenies.slice(0, 5).map((l) => l.replace(/^.*deny\(1\) /, "").replaceAll(REAL_HOME, "~").slice(0, 120)),
  }
  log(`preflight: ${JSON.stringify(result.preflight)}`)
  await finish(0, "guarded preflight complete")
}

// ===================================================================  4. 等页面,然后隔离判定;不过立刻停
let cdp
try {
  cdp = await connectPage(cdpPort, 60_000)
} catch (error) {
  await finish(5, `renderer did not come up: ${error.message}; appExit=${JSON.stringify(result.appExit ?? null)}`)
}
await sleep(1500)
const lsofText = groupPids()
  .map((p) => spawnSync("/usr/sbin/lsof", ["-nP", "-p", String(p), "-Fn"], { encoding: "utf8", timeout: 20_000 }).stdout ?? "")
  .join("\n")
const verdict = lsofVerdict(lsofText, ROOT)
result.isolation.lsof = { pids: groupPids().length, total: verdict.total, inRoot: verdict.inRoot, leaks: verdict.leaks, ok: verdict.ok, sample: verdict.sample.map((p) => p.replaceAll(ROOT, "<root>")) }
if (!verdict.ok) await finish(6, `isolation gate RED: leaks=${JSON.stringify(verdict.leaks)} inRoot=${verdict.inRoot}`)
log(`isolation OK: ${verdict.inRoot} files under root, 0 leaks among ${verdict.total}`)
result.versions = await cdp.eval("({chrome: navigator.userAgent.match(/Chrome\\/([\\d.]+)/)?.[1], visibility: document.visibilityState})")

// ===================================================================  5. 等首个输入框就绪
const timelineFile = () => findFile(join(ROOT, "tmp"), "startup-timeline.log")
const marks = () => readMarks(timelineFile())
const waitFor = async (fn, ms, what) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const v = await fn()
    if (v) return v
    await sleep(100)
  }
  throw new Error(`timeout ${ms}ms waiting for ${what}`)
}
try {
  await waitFor(() => marks().some((m) => m.name === "renderer.composer.mount"), 60_000, "first composer mount")
  await waitFor(() => cdp.eval(`!!document.querySelector('.a-ws-chip')`), 30_000, "workspace chip")
} catch (error) {
  result.dom = await cdp.eval(`document.body?.innerText?.slice(0,400)`).catch(() => null)
  await finish(7, error.message)
}
// 让冷启动的第一条链走完(没走完就开目录,测的是冷启动,不是这个夹具)
const coldEnd = await waitFor(() => marks().find((m) => m.name === "renderer.home.model_list.end"), 45_000, "cold model_list.end").catch(() => null)
result.cold = coldEnd ? { durationMs: coldEnd.durationMs, outcome: coldEnd.outcome } : null
await sleep(1500)

// ===================================================================  6. 打开 N 个输入框:每个目录一条草稿(新对话 → chip →「打开项目…」)
// 为什么先开目录、后配 MCP(对照臂实测,见 README「夹具协议」):目录切换会整叶重挂,叶子要等该目录的数据引导;
// 修复前这段引导被 MCP 拖住,chip 不在,N 个目录只能串行,串行时队列是空的,读取反而快。owner 现场的形状是
// 「目录早就开着,引擎换了一代,MCP 状态全丢,这时点新对话」。所以按这个顺序:开目录 → 配 MCP + 换代 → 点新对话。
const clickNewChat = `(() => { const b = document.querySelector('[data-codepuppy-sidebar-nav="new-chat"],[data-alpha-sidebar-nav="new-chat"]'); if (!b) return 'no-new-chat'; b.click(); return 'clicked'; })()`
const clickOpenProject = `(() => {
  const chip = document.querySelector('.a-ws-chip');
  if (!chip) return 'no-chip';
  chip.click();
  return new Promise((res) => setTimeout(() => {
    const items = [...document.querySelectorAll('.a-home-ws .a-pop .a-pop-item')];
    const last = items.at(-1);
    if (!last) return res('no-open-item');
    last.click();
    res('clicked');
  }, 80));
})()`
const retryClick = async (expr, ms) => {
  const until = Date.now() + ms
  let r
  do {
    r = await cdp.eval(expr).catch((e) => `error:${e.message}`)
    if (r === "clicked") return r
    await sleep(200)
  } while (Date.now() < until)
  return r
}
const opened = []
for (let i = 0; i < N; i++) {
  const nc = await retryClick(clickNewChat, 20_000)
  await sleep(GAP_MS)
  const r = await retryClick(clickOpenProject, 20_000)
  opened.push({ ws: `ws${i + 1}`, newChat: nc, click: r, t: Date.now() - launchedAt })
  log(`open ws${i + 1}: newChat=${nc} chip=${r}`)
  await sleep(GAP_MS)
}
result.opened = opened
result.allOpened = opened.every((o) => o.click === "clicked" && o.newChat === "clicked")
if (!result.allOpened) await finish(12, `could not open all ${N} directories: ${JSON.stringify(opened)}`)
await sleep(1500)

// ===================================================================  5b. 配不应答的远程 MCP,并换一代引擎
// 为什么不是「每个目录一份 opencode.json + 本机端口」(smoke2 实测那样测不到东西,黑洞 conns=0):
//   · 引擎只能经策略代理出网,直连 loopback 被围栏拒:`connect EPERM 127.0.0.1:<port>`,2ms 就失败,不是不应答。
//   · 配置文件里的 mcp.* 远程条目不进放行集合(network-egress-derived.ts);要走真实路径就得写真源记录,
//     而真源只接受 https + 非 loopback。所以黑洞绑在本机 LAN 地址上,URL 是 https://<lan-ip>:<port>/mcp。
//   · 放行集合每次 fork 前整份替换(server.ts refreshConfiguredEgressDestinations),所以写完要换一代引擎。
// 一条全局记录 = 每个目录的引擎实例各自对它建一个 MCP 客户端,这就是「N 个目录各配一个」。
const clickableNewChat = `!!document.querySelector('[data-codepuppy-sidebar-nav="new-chat"],[data-alpha-sidebar-nav="new-chat"]')`
const generationReady = (gen) => marks().some((m) => m.name === "main.sidecar.generation.emit" && m.generation >= gen && m.phase === "ready")
const gensBefore = Math.max(0, ...marks().filter((m) => m.name === "main.sidecar.generation.emit").map((m) => m.generation ?? 0))
if (MCP) {
  const ip = lanIp()
  const hole = await startBlackhole("global", ip)
  result.mcpRecord = { host: "<lan-ip>", port: hole.port }
  result.persist = await cdp.eval(`window.api.ext.persistMcp("blackhole", { type: "remote", url: "https://${ip}:${hole.port}/mcp" })`).catch((e) => ({ error: e.message }))
  log(`persistMcp: ${JSON.stringify(result.persist)}`)
  if (!result.persist?.ok) await finish(9, `persistMcp refused: ${JSON.stringify(result.persist)}`)
}
const marksAtRespawn = marks().length
// retryEngine 是 #1557 才有的 IPC。更早的树(对照臂)没有,而它的 killSidecar 是「蓄意停」,不会换代:
// 那就杀掉监听引擎端口的那个进程(只认本进程组内的 pid),走产品自己的崩溃自愈换一代。
const hasRetry = await cdp.eval(`!!window.api.recovery?.retryEngine`).catch(() => false)
if (hasRetry) {
  result.retryEngine = await cdp.eval(`window.api.recovery.retryEngine()`, 60_000).catch((e) => ({ error: e.message }))
} else {
  const enginePort = await cdp.eval(`window.api.awaitInitialization().then((i) => new URL(i.url).port)`)
  const listeners = spawnSync("/usr/sbin/lsof", ["-nP", "-t", `-iTCP:${enginePort}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean).map(Number)
  const mine = listeners.filter((p) => groupPids().includes(p) && p !== pgid)
  if (mine.length !== 1) await finish(11, `expected exactly one engine listener in my group, got ${JSON.stringify({ listeners, mine })}`)
  process.kill(mine[0], "SIGKILL")
  result.retryEngine = "sigkill-engine-listener(crash self-heal path)"
}
log(`retryEngine: ${JSON.stringify(result.retryEngine)}`)
try {
  await waitFor(() => generationReady(gensBefore + 1), 60_000, `engine generation ${gensBefore + 1} ready`)
} catch (error) {
  await finish(10, error.message)
}
result.engineGeneration = gensBefore + 1
// 换代后页面会重载一次。等新页面的 sidebar 回来(CDP 会话跟着页面走,不用重连),别在旧页面上点。
await waitFor(() => cdp.eval(clickableNewChat).catch(() => false), 30_000, "new-chat button after respawn").catch(() => null)
await sleep(Number(arg("settle-ms", "1500")))

// ===================================================================  7. 点新对话,量模型读取
const marksBefore = marks().length
const newChatClick = await retryClick(clickNewChat, 20_000)
const openedAll = Date.now()
result.newChatAfterRespawn = { click: newChatClick, t: openedAll - launchedAt }
log(`new chat after respawn: ${newChatClick}`)
if (OPEN_MORE) {
  await sleep(GAP_MS)
  result.openedMore = []
  for (let i = N; i < 2 * N; i++) {
    const r = await retryClick(clickOpenProject, 20_000)
    result.openedMore.push({ ws: `ws${i + 1}`, click: r, t: Date.now() - launchedAt })
    log(`open more ws${i + 1}: ${r}`)
    await sleep(GAP_MS)
  }
}

// 取最后一个输入框的模型读取结局:屏障 + 列表 >10s 算复现
const summarize = () => {
  const all = marks()
  const afterOpen = all.slice(marksBefore)
  const of = (name) => afterOpen.filter((m) => m.name === name)
  return {
    mounts: of("renderer.composer.mount").length,
    starts: of("renderer.home.model_list.start").map((m) => ({ t: m.t, chain: m.chain, attempt: m.attempt })),
    ends: of("renderer.home.model_list.end").map((m) => ({ t: m.t, chain: m.chain, attempt: m.attempt, outcome: m.outcome, durationMs: m.durationMs, count: m.count })),
    catalogReady: of("renderer.home.catalog_ready").map((m) => ({ t: m.t, barrierMs: m.barrierMs, probes: m.probes, probeTimeouts: m.probeTimeouts, wake: m.wake })),
    retries: of("renderer.home.model_retry").length,
  }
}
log(`holding up to ${HOLD_MS}ms`)
const pollDeadline = Date.now() + HOLD_MS
let last
while (Date.now() < pollDeadline) {
  last = summarize()
  const lastChain = last.starts.at(-1)?.chain
  const done = lastChain !== undefined && last.ends.some((e) => e.chain === lastChain && e.outcome === "ok")
  if (done && last.mounts >= 1 && Date.now() - openedAll > HOLD_MIN_MS) break
  await sleep(500)
}
result.heldMs = Date.now() - openedAll
result.afterOpen = summarize()
// 每个输入框各自一条链,chain 序号是每个输入框自己的(都从 1 起),所以按时间配对:
// 一个 start 的结局 = 它之后、下一个 start 之前的第一个 end;最后一个 start 的结局就是最后那个输入框的。
const starts = result.afterOpen.starts
const ends = result.afterOpen.ends
const pairs = starts.map((s, i) => {
  const until = starts[i + 1]?.t ?? Infinity
  const end = ends.find((e) => e.t >= s.t && e.t < until)
  const okEnd = ends.find((e) => e.t >= s.t && e.outcome === "ok")
  return { startT: s.t, chain: s.chain, attempt: s.attempt, outcome: end?.outcome ?? "no-end-in-window", ownEndMs: end ? end.t - s.t : null, firstOkAfterMs: okEnd ? okEnd.t - s.t : null }
})
result.composerReads = pairs
const lastPair = pairs.at(-1)
result.lastComposer = lastPair ?? null
// 判据(票面矩阵,不放宽):点新对话之后,有输入框的模型读取超过 10 秒未返回。窗口结束还没 ok 也算,只要窗口够 10 秒。
const over10s = (p) => (p.firstOkAfterMs === null ? result.heldMs > 10_000 : p.firstOkAfterMs > 10_000)
result.reproduced = pairs.length ? pairs.some(over10s) : null
result.readsOver10s = pairs.filter(over10s).length
result.blackholes = blackholes.map((b) => ({ label: b.label, conns: b.conns, bytes: b.bytes, firstConnAfterLaunchMs: b.firstConnAt ? b.firstConnAt - launchedAt : null }))
result.stubHits = stubHits
result.egressLines = readFileSync(join(ROOT, "app.stdout.log"), "utf8").split("\n").filter((l) => /configured destination/.test(l)).map((l) => l.replace(/\d+\.\d+\.\d+\.\d+:\d+/g, "<lan-ip>:<port>").slice(0, 200))
result.domStatus = await cdp.eval(`document.querySelector('.a-comp-model-alert')?.innerText ?? document.querySelector('[class*=model-alert]')?.innerText ?? null`).catch(() => null)
result.isolation.devUserDataMtimeAfter = dotDirMtime(DEV_USERDATA)
result.paths = { root: ROOT, netlog, timeline: timelineFile(), engineLogs: findFiles(join(ROOT, "tmp"), /\.log$/).filter((p) => /opencode\/log/.test(p)), initiators, preloadLog }

// 每个目录的 MCP 状态:证明读取返回的时候,MCP 确实还没应答(只取状态名)。发生在判定之后,不影响判定。
result.mcpStatus = await cdp
  .eval(
    `(async () => {
      const init = await window.api.awaitInitialization();
      const auth = 'Basic ' + btoa(init.username + ':' + init.password);
      const out = {};
      for (const [label, dir] of ${JSON.stringify(dirs.map((d, i) => [`ws${i + 1}`, d]))}) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 4000);
        try {
          const r = await fetch(new URL('/mcp?directory=' + encodeURIComponent(dir), init.url).href, { headers: { authorization: auth }, signal: ctl.signal });
          const j = await r.json();
          out[label] = Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v?.status ?? '?']));
        } catch (e) { out[label] = 'err:' + e.name; }
        clearTimeout(timer);
      }
      return out;
    })()`,
    60_000,
  )
  .catch((e) => ({ error: e.message }))

// 真实实例上的连接占用(AC4 连接计数):发一个 /global/event 探针把剩余名额算出来,放在收尾前,不影响上面的判定。
if (EXTRA_STREAMS > 0) {
  result.streamProbe = await cdp.eval(`(async () => {
    const init = await window.api.awaitInitialization();
    const auth = 'Basic ' + btoa(init.username + ':' + init.password);
    const url = new URL('/global/health', init.url).href;
    const ctl = [];
    const res = [];
    for (let i = 0; i < ${EXTRA_STREAMS}; i++) {
      const c = new AbortController(); ctl.push(c);
      const t0 = performance.now();
      const rec = { i, state: 'pending' }; res.push(rec);
      fetch(new URL('/global/event', init.url).href, { headers: { authorization: auth }, signal: c.signal })
        .then((r) => { rec.state = 'streaming:' + r.status; rec.ms = Math.round(performance.now() - t0); })
        .catch((e) => { rec.state = 'err:' + e.name; });
      await new Promise((r) => setTimeout(r, 150));
    }
    await new Promise((r) => setTimeout(r, 1500));
    const t1 = performance.now();
    const h = new AbortController();
    const healthAnswered = await Promise.race([
      fetch(url, { headers: { authorization: auth }, signal: h.signal }).then((r) => 'answered:' + r.status + ':' + Math.round(performance.now() - t1) + 'ms').catch((e) => 'err:' + e.name),
      new Promise((r) => setTimeout(() => { h.abort(); r('no-answer-in-3000ms'); }, 3000)),
    ]);
    const snapshot = res.map((x) => x.state);
    ctl.forEach((c) => c.abort());
    await new Promise((r) => setTimeout(r, 300));
    return { snapshot, healthAnswered };
  })()`, 30_000).catch((e) => ({ error: e.message }))
  log(`stream probe: ${JSON.stringify(result.streamProbe)}`)
  await sleep(500)
}

// 收工前再判一次隔离:打开的文件 + 日志里有没有出现 owner 家目录下的路径(本 worktree 除外)
const lsofEnd = lsofVerdict(
  groupPids().map((p) => spawnSync("/usr/sbin/lsof", ["-nP", "-p", String(p), "-Fn"], { encoding: "utf8", timeout: 20_000 }).stdout ?? "").join("\n"),
  ROOT,
)
result.isolation.lsofEnd = { pids: groupPids().length, total: lsofEnd.total, inRoot: lsofEnd.inRoot, leaks: lsofEnd.leaks, ok: lsofEnd.ok }
const homeMentions = new Set()
for (const f of [join(ROOT, "app.stdout.log"), ...result.paths.engineLogs]) {
  if (!existsSync(f)) continue
  for (const m of readFileSync(f, "utf8").matchAll(/\/Users\/[A-Za-z0-9_.-]+\/[^\s'",)\]]*/g)) {
    if (!m[0].startsWith(REPO)) homeMentions.add(m[0].split("/").slice(0, 6).join("/"))
  }
}
result.isolation.homePathsInLogs = [...homeMentions]
if (!lsofEnd.ok) await finish(6, `isolation gate RED at end: ${JSON.stringify(lsofEnd.leaks)}`)
log(`reproduced=${result.reproduced} last=${JSON.stringify(result.lastComposer)} mcp=${JSON.stringify(result.mcpStatus).slice(0, 200)}`)
log(`blackholes=${JSON.stringify(result.blackholes)}`)
await finish(0, "round complete")
