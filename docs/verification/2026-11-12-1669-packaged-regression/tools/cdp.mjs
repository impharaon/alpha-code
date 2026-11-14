// alpha-code#1669 r2: minimal CDP driver for the isolated packaged app (debug port opened by CODEPUPPY_CDP=1).
//   node cdp.mjs targets
//   node cdp.mjs eval '<expression>'            (awaits promises, prints JSON)
//   node cdp.mjs shot <file.png>
//   node cdp.mjs click '<css selector>'         (DOM click inside the page, not an OS event)
//   node cdp.mjs text '<text to insert into the focused element>'
//   node cdp.mjs key <Enter|Escape|...>
//   node cdp.mjs bounds <left> <top> <width> <height>   (moves the window; used to park it off the owner's main area)
// Env CDP_PORT (default 9222), CDP_MATCH (substring of the page URL to pick; default: first "page" target).
import { writeFileSync } from "node:fs"

const port = process.env.CDP_PORT ?? "9222"
const [cmd, ...args] = process.argv.slice(2)

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
if (cmd === "hide" || cmd === "winstate") {
  // r5 (orchestrator, owner disturbed by foreground test windows): the Browser domain lives on the browser endpoint,
  // not the page target. `hide` minimises every page window; `winstate` only reports.
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const bws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    bws.onopen = resolve
    bws.onerror = reject
  })
  let bid = 1
  const bpending = new Map()
  bws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && bpending.has(msg.id)) {
      bpending.get(msg.id)(msg)
      bpending.delete(msg.id)
    }
  }
  const bsend = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = bid++
      bpending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : resolve(msg.result)))
      bws.send(JSON.stringify({ id, method, params }))
    })
  const out = []
  for (const t of targets.filter((x) => x.type === "page")) {
    const { windowId } = await bsend("Browser.getWindowForTarget", { targetId: t.id })
    if (cmd === "hide") await bsend("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } })
    out.push({ url: t.url, windowId, ...(await bsend("Browser.getWindowBounds", { windowId })).bounds })
  }
  console.log(JSON.stringify(out))
  bws.close()
  process.exit(0)
}
if (cmd === "targets") {
  console.log(JSON.stringify(targets.map((t) => ({ type: t.type, title: t.title, url: t.url })), null, 1))
  process.exit(0)
}
const match = process.env.CDP_MATCH
const page = targets.find((t) => t.type === "page" && (!match || t.url.includes(match)))
if (!page) throw new Error(`no page target (match=${match ?? "-"})`)

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})
let nextId = 1
const pending = new Map()
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : resolve(msg.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(`eval: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`)
  return r.result.value
}

try {
  if (cmd === "eval") console.log(JSON.stringify(await evaluate(args[0]), null, 1))
  else if (cmd === "shot") {
    // r6: bounded — after a renderer reload in the hidden window the compositor produces no frames and capture never returns
    const r = await Promise.race([send("Page.captureScreenshot", { format: "png" }), new Promise((res) => setTimeout(() => res(null), 10000))])
    if (!r) {
      console.log(`shot TIMEOUT (no frame within 10 s) — ${args[0]} not written`)
      process.exit(3)
    }
    writeFileSync(args[0], Buffer.from(r.data, "base64"))
    console.log(`wrote ${args[0]}`)
  } else if (cmd === "click") {
    console.log(JSON.stringify(await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(args[0])}); if (!el) return "no element"; el.click(); return "clicked" })()`)))
  } else if (cmd === "clicktext") {
    // r6: click the first element matching <css> whose trimmed innerText equals <text> (else: the first that contains it)
    console.log(JSON.stringify(await evaluate(`(() => { const els = [...document.querySelectorAll(${JSON.stringify(args[0])})].filter(e => e.offsetParent !== null || e.getClientRects().length); const want = ${JSON.stringify(args[1])}; const el = els.find(e => (e.innerText || e.getAttribute("aria-label") || "").trim() === want) || els.find(e => (e.innerText || e.getAttribute("aria-label") || "").includes(want)); if (!el) return "no element"; el.click(); return "clicked: " + (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 60) })()`)))
  } else if (cmd === "waitfor") {
    // r6: poll <expression> every 500 ms until truthy or <ms> elapse; prints the last value and the elapsed time
    const deadline = Date.now() + Number(args[1] ?? 30000)
    const t0 = Date.now()
    let v
    for (;;) {
      v = await evaluate(args[0])
      if (v || Date.now() > deadline) break
      await new Promise((r) => setTimeout(r, 500))
    }
    console.log(JSON.stringify({ value: v, ms: Date.now() - t0 }))
  } else if (cmd === "drag") {
    // r6: page-level CDP mouse drag (not OS events) from (x1,y1) to (x2,y2) in CSS pixels, in 10 steps
    const [x1, y1, x2, y2] = args.map(Number)
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1, y: y1 })
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x1, y: y1, button: "left", buttons: 1, clickCount: 1 })
    for (let i = 1; i <= 10; i++) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1 + ((x2 - x1) * i) / 10, y: y1 + ((y2 - y1) * i) / 10, button: "left", buttons: 1 })
      await new Promise((r) => setTimeout(r, 30))
    }
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x2, y: y2, button: "left", buttons: 0, clickCount: 1 })
    console.log(`dragged ${x1},${y1} -> ${x2},${y2}`)
  } else if (cmd === "dropfiles") {
    // r6: page-level CDP drag-and-drop of local files onto (x,y) — no native file picker involved
    const [x, y, ...files] = args
    const data = { items: [], files, dragOperationsMask: 1 }
    for (const type of ["dragEnter", "dragOver", "drop"]) await send("Input.dispatchDragEvent", { type, x: Number(x), y: Number(y), data })
    console.log(`dropped ${files.length} file(s)`)
  } else if (cmd === "text") {
    await send("Input.insertText", { text: args[0] })
    console.log("inserted")
  } else if (cmd === "key") {
    const key = args[0]
    const code = key === "Enter" ? 13 : key === "Escape" ? 27 : key === "Backspace" ? 8 : 0
    await send("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode: code, ...(key === "Enter" ? { text: "\r" } : {}) })
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: code })
    console.log(`key ${key}`)
  } else if (cmd === "send") {
    // focus the composer textarea, insert the text, press Enter — page-level CDP input, not OS events
    const focused = await evaluate(`(() => { const t = document.querySelector("textarea.a-comp-input"); if (!t) return false; t.focus(); return true })()`)
    if (!focused) throw new Error("no composer textarea")
    await send("Input.insertText", { text: args[0] })
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" })
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 })
    console.log(`sent ${new Date().toISOString()}`)
  } else if (cmd === "calm") {
    // r5: run right after every launch. A fresh profile shows the onboarding card whose primary button starts the
    // browser login; a keystroke that reaches the new window can press it (r4 B and r5 D both opened the owner's
    // browser on codepuppy.cn/auth/authorize). Mark onboarding done, dismiss the card, drop focus, park the window.
    const r = await evaluate(`(() => {
      try { localStorage.setItem("codepuppy.onboarding.done", "1") } catch {}
      const skip = document.querySelector("[data-codepuppy-onboarding] .a-ob-skip")
      if (skip) skip.click()
      document.activeElement?.blur?.()
      return { skipped: !!skip, onboarding: !!document.querySelector("[data-codepuppy-onboarding]") }
    })()`)
    let bounds = "not available on this target"
    try {
      const { windowId } = await send("Browser.getWindowForTarget")
      await send("Browser.setWindowBounds", { windowId, bounds: { left: 1500, top: 700, width: 1000, height: 700, windowState: "normal" } })
      bounds = (await send("Browser.getWindowBounds", { windowId })).bounds
    } catch {}
    console.log(JSON.stringify({ ...r, bounds }))
  } else if (cmd === "bounds") {
    const { windowId } = await send("Browser.getWindowForTarget")
    const [left, top, width, height] = args.map(Number)
    await send("Browser.setWindowBounds", { windowId, bounds: { left, top, width, height, windowState: "normal" } })
    console.log(JSON.stringify(await send("Browser.getWindowBounds", { windowId })))
  } else throw new Error(`unknown command ${cmd}`)
} finally {
  ws.close()
}
