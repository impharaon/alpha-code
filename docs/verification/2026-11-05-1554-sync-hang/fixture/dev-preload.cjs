// alpha-code#1554 dev 复现夹具的主进程前置模块:`Electron -r dev-preload.cjs packages/ui-mac ...`。
// 不改产品代码。它只替换四样「会打扰 owner 的系统交互」,并把 CDP 口挪开:
//   · 窗口:accessory + showInactive + 透明 + 不接鼠标,不抢前台、不挡点击;页面仍是 visible,不节流。
//   · CDP:index.ts:562 把端口写死 9222,这里改写成 P1554_CDP_PORT,与别的 lane 不撞。
//   · 目录选择:showOpenDialog 按 P1554_DIRS 顺序返回夹具目录,不弹系统框(真实入口仍是 chip →「打开项目…」)。
//   · 其他系统弹框 / 外部打开:只记录,不执行。
// 另外用 webContents.debugger 记下每个发往 loopback 的请求的调用栈(只记路径与函数,不记请求头),
// 用来回答「每条 /global/event 是谁开的」。它从页面第一行代码之前就挂上,不会漏掉启动时开的流。

const { app, BrowserWindow, dialog, shell } = require("electron")
const fs = require("node:fs")

const LOG = process.env.P1554_PRELOAD_LOG
const INITIATORS = process.env.P1554_INITIATORS
const note = (event, detail) => {
  if (!LOG) return
  try {
    fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), event, ...detail }) + "\n")
  } catch {}
}

if (process.platform === "darwin") {
  app.setActivationPolicy("accessory")
  app.dock?.hide()
}

const cdpPort = process.env.P1554_CDP_PORT
if (cdpPort) {
  const realAppend = app.commandLine.appendSwitch.bind(app.commandLine)
  app.commandLine.appendSwitch = (name, value) => {
    if (name === "remote-debugging-port") {
      note("cdp-port-rewritten", { from: value, to: cdpPort })
      return realAppend(name, cdpPort)
    }
    return value === undefined ? realAppend(name) : realAppend(name, value)
  }
}

BrowserWindow.prototype.show = function () {
  return this.showInactive()
}
BrowserWindow.prototype.focus = function () {}
BrowserWindow.prototype.moveTop = function () {}
app.focus = () => {}

const queue = (process.env.P1554_DIRS ?? "").split(":").filter(Boolean)
dialog.showOpenDialog = async (...args) => {
  const dir = queue.shift()
  note("open-dialog", { handedOut: dir ?? null, remaining: queue.length, title: args.at(-1)?.title })
  return dir ? { canceled: false, filePaths: [dir] } : { canceled: true, filePaths: [] }
}
const neutral = (opts) => (opts?.cancelId ?? (opts?.buttons?.length ? opts.buttons.length - 1 : 0))
dialog.showMessageBox = async (...args) => {
  const opts = args.at(-1)
  note("message-box", { type: opts?.type, message: opts?.message, buttons: opts?.buttons })
  return { response: neutral(opts), checkboxChecked: false }
}
dialog.showMessageBoxSync = (...args) => {
  const opts = args.at(-1)
  note("message-box-sync", { type: opts?.type, message: opts?.message, buttons: opts?.buttons })
  return neutral(opts)
}
dialog.showErrorBox = (title, content) => note("error-box", { title, content: String(content).slice(0, 300) })
shell.openExternal = async (url) => note("open-external", { origin: (() => { try { return new URL(url).origin } catch { return "?" } })() })

const pathOnly = (raw) => {
  try {
    const u = new URL(raw)
    return { origin: u.origin, path: u.pathname, queryKeys: [...u.searchParams.keys()] }
  } catch {
    return { origin: "?", path: "?", queryKeys: [] }
  }
}
const frames = (stack, out = []) => {
  if (!stack) return out
  for (const f of stack.callFrames ?? [])
    out.push({ fn: f.functionName, url: (f.url || "").split("/").slice(-1)[0], line: f.lineNumber, col: f.columnNumber })
  return frames(stack.parent, out)
}

app.on("web-contents-created", (_e, wc) => {
  try {
    wc.setBackgroundThrottling(false)
  } catch {}
  if (!INITIATORS) return
  try {
    wc.debugger.attach("1.3")
    wc.debugger.sendCommand("Runtime.enable").catch(() => {})
    wc.debugger.sendCommand("Debugger.enable").catch(() => {})
    wc.debugger.sendCommand("Debugger.setAsyncCallStackDepth", { maxDepth: 24 }).catch(() => {})
    wc.debugger.sendCommand("Network.enable").catch(() => {})
    wc.debugger.on("message", (_ev, method, params) => {
      if (method !== "Network.requestWillBeSent") return
      const where = pathOnly(params.request?.url ?? "")
      if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(where.origin)) return
      try {
        fs.appendFileSync(
          INITIATORS,
          JSON.stringify({
            t: Date.now(),
            wc: wc.id,
            requestId: params.requestId,
            method: params.request?.method,
            ...where,
            type: params.type,
            frames: frames(params.initiator?.stack).slice(0, 60),
          }) + "\n",
        )
      } catch {}
    })
  } catch (error) {
    note("debugger-attach-failed", { error: String(error) })
  }
})

app.on("browser-window-created", (_e, win) => {
  try {
    win.setOpacity(0)
    win.setIgnoreMouseEvents(true)
  } catch {}
})
note("preload-loaded", { dirs: queue.length, pid: process.pid })
