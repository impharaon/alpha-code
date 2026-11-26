import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createWindowClose, revealWindow, type RevealableWindow } from "./window-close"

/** Records what the close handler did to a window; `close`/`destroy` are deliberately absent, so touching them throws. */
function fakeWindow(fullScreen = false) {
  const calls: string[] = []
  let onLeaveFullScreen: (() => void) | undefined
  return {
    calls,
    leaveFullScreen: () => onLeaveFullScreen?.(),
    win: {
      isFullScreen: () => fullScreen,
      setFullScreen(flag: boolean) {
        calls.push(`setFullScreen:${flag}`)
      },
      hide() {
        calls.push("hide")
      },
      once(_event: "leave-full-screen", listener: () => void) {
        onLeaveFullScreen = listener
      },
    },
  }
}

function fakeEvent() {
  const event = { prevented: false, preventDefault: () => void (event.prevented = true) }
  return event
}

describe("macOS: closing the window hides it instead of ending the app", () => {
  test("AC-01/02: the close is cancelled and only hide() runs, so the page and engine are left alone", () => {
    const close = createWindowClose("darwin")
    const { win, calls } = fakeWindow()
    const event = fakeEvent()
    close.onClose(event, win, false)
    expect(event.prevented).toBe(true)
    expect(calls).toEqual(["hide"])
  })

  test("AC-05: a fullscreen window leaves fullscreen first and is hidden only after that finishes", () => {
    const close = createWindowClose("darwin")
    const { win, calls, leaveFullScreen } = fakeWindow(true)
    const event = fakeEvent()
    close.onClose(event, win, false)
    expect(event.prevented).toBe(true)
    expect(calls).toEqual(["setFullScreen:false"])
    leaveFullScreen()
    expect(calls).toEqual(["setFullScreen:false", "hide"])
  })

  test("AC-04: once a real quit has started the close is not blocked and nothing is hidden", () => {
    const close = createWindowClose("darwin")
    const { win, calls } = fakeWindow()
    close.markQuitting()
    const event = fakeEvent()
    close.onClose(event, win, false)
    expect(event.prevented).toBe(false)
    expect(calls).toEqual([])
  })

  test("another window is still visible: this one closes normally instead of piling up hidden windows", () => {
    const close = createWindowClose("darwin")
    const { win, calls } = fakeWindow()
    const event = fakeEvent()
    close.onClose(event, win, true)
    expect(event.prevented).toBe(false)
    expect(calls).toEqual([])
  })

  test("AC-06: on Windows and Linux the close goes through untouched", () => {
    for (const platform of ["win32", "linux"] as const) {
      const close = createWindowClose(platform)
      const { win, calls } = fakeWindow()
      const event = fakeEvent()
      close.onClose(event, win, false)
      expect(event.prevented).toBe(false)
      expect(calls).toEqual([])
    }
  })
})

function revealable(state: { visible?: boolean; minimized?: boolean; destroyed?: boolean } = {}) {
  const calls: string[] = []
  const win: RevealableWindow = {
    isDestroyed: () => state.destroyed ?? false,
    isVisible: () => state.visible ?? false,
    isMinimized: () => state.minimized ?? false,
    restore: () => void calls.push("restore"),
    show: () => void calls.push("show"),
    focus: () => void calls.push("focus"),
  }
  return { win, calls }
}

describe("revealWindow: Dock icon, second launch and login callback bring the same window back", () => {
  test("AC-03: the hidden window is shown and focused", () => {
    const hidden = revealable()
    revealWindow([hidden.win])
    expect(hidden.calls).toEqual(["show", "focus"])
  })

  test("a minimized window is restored first", () => {
    const minimized = revealable({ minimized: true })
    revealWindow([minimized.win])
    expect(minimized.calls).toEqual(["restore", "show", "focus"])
  })

  test("prefers a visible window over a hidden one and skips destroyed ones", () => {
    const destroyed = revealable({ destroyed: true })
    const hidden = revealable()
    const visible = revealable({ visible: true })
    revealWindow([destroyed.win, hidden.win, visible.win])
    expect(destroyed.calls).toEqual([])
    expect(hidden.calls).toEqual([])
    expect(visible.calls).toEqual(["show", "focus"])
  })

  test("no window at all does nothing", () => {
    expect(() => revealWindow([])).not.toThrow()
  })
})

// index.ts / windows.ts 顶层即启动 Electron,单测里无法 import;这里只钉「事件 → 上面这两个函数」的接线,
// 行为判据在上面的用例。去掉任一处接线,对应一条断言变红。
describe("wiring (source anchors; the behaviour is proved above)", () => {
  const source = (file: string) => readFileSync(join(import.meta.dir, file), "utf8")
  /** The text of one `app.on("<event>", …)` registration, up to the next registration. */
  const handler = (text: string, event: string) => {
    const start = text.indexOf(`app.on("${event}"`)
    expect(start, `app.on("${event}") is registered`).toBeGreaterThanOrEqual(0)
    const next = text.indexOf("\n  app.on(", start + 1)
    return text.slice(start, next < 0 ? undefined : next)
  }

  test("every product window routes its close event through windowClose.onClose", () => {
    expect(source("windows.ts")).toMatch(/win\.on\("close",[\s\S]{0,120}windowClose\.onClose\(/)
  })

  test("AC-03: Dock activate, second launch and open-url all reveal a product window", () => {
    const index = source("index.ts")
    for (const event of ["activate", "second-instance", "open-url"]) expect(handler(index, event)).toContain("revealWindow(productWindows())")
  })

  test("AC-04: before-quit marks the app as really quitting", () => {
    expect(handler(source("index.ts"), "before-quit")).toContain("windowClose.markQuitting()")
  })
})
