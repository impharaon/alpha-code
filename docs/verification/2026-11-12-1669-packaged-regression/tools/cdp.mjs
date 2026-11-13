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
    const r = await send("Page.captureScreenshot", { format: "png" })
    writeFileSync(args[0], Buffer.from(r.data, "base64"))
    console.log(`wrote ${args[0]}`)
  } else if (cmd === "click") {
    console.log(JSON.stringify(await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(args[0])}); if (!el) return "no element"; el.click(); return "clicked" })()`)))
  } else if (cmd === "text") {
    await send("Input.insertText", { text: args[0] })
    console.log("inserted")
  } else if (cmd === "key") {
    const key = args[0]
    const code = key === "Enter" ? 13 : key === "Escape" ? 27 : 0
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
  } else if (cmd === "bounds") {
    const { windowId } = await send("Browser.getWindowForTarget")
    const [left, top, width, height] = args.map(Number)
    await send("Browser.setWindowBounds", { windowId, bounds: { left, top, width, height, windowState: "normal" } })
    console.log(JSON.stringify(await send("Browser.getWindowBounds", { windowId })))
  } else throw new Error(`unknown command ${cmd}`)
} finally {
  ws.close()
}
