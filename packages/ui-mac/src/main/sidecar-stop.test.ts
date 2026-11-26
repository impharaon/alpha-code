// #858 —— main → sidecar 的停止合同。REQ-236 `#1562` 起停止只有一种(令牌续期不再重启引擎)。这里钉三件事:
//   ① 生产 spawnLocalServer 线上只发 `{ type: "stop" }`;
//   ② sidecar 侧(生产 parseSidecarStopCommand + stopSidecarEngine)把它翻成关掉引擎 —— `#1667`(裁决书 OOR-2):
//      2.x 没有 v1 的 `POST /global/dispose`(404 会让停止在收尾前抛错),收尾就是关掉 `start()` 的作用域;
//   ③ 无响应的 sidecar 由 6s 兜底预算收口(到期才 SIGTERM)。
//
// harness 说明:sidecar.ts 顶层有 registerHooks 与 getParentPort(),结构上无法被 import
// (与 #607 同因)。所以这里让假子进程用**生产的** parseSidecarStopCommand +
// stopSidecarEngine 消费消息 —— main→线上形状→sidecar 执行这一整条是真的在跑,
// 只有「sidecar.ts 确实调用了这两个函数」这一跳靠文末的接线锚守。

import { afterEach, beforeEach, describe, expect, mock, test, vi } from "bun:test"
import { EventEmitter } from "node:events"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { parseSidecarStopCommand, stopSidecarEngine } from "./sidecar-stop"
import { mockElectron } from "../../test-component/electron-mock"

const appEvents = new EventEmitter()

mockElectron(() => ({
  app: {
    isPackaged: false,
    on: appEvents.on.bind(appEvents),
    off: appEvents.off.bind(appEvents),
  },
  utilityProcess: {
    fork: () => {
      throw new Error("unexpected utilityProcess.fork")
    },
  },
  BrowserWindow: class {},
  dialog: {},
  ipcMain: { handle: () => {} },
}))
mock.module("./logging", () => ({
  getLogger: () => ({ log: () => {}, warn: () => {}, error: () => {} }),
  write: () => {},
  rotateServerLogs: () => {},
}))
mock.module("./store", () => ({ getStore: () => ({ get: () => null, set: () => {}, delete: () => {} }) }))

// 陷阱:`await import("./server")` 必须排在 mock.module("electron", ...) **之后**,否则真 electron
// 会被拉起来。
const { spawnLocalServer } = await import("./server")
const { creditDanglingSweepForSpawn, resetDanglingSweepLatchForTests } = await import("./dangling-sweep-latch")

/**
 * 假 sidecar 子进程。stop 分支就是 sidecar.ts 的那两行(parse → 交给共享执行器),
 * 引擎换成记录器(记下 `close` 被调了几次)。
 */
class SidecarChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kills = 0
  wire: unknown[] = []
  engineCloses = 0

  private engine = {
    close: () => {
      this.engineCloses++
      return Promise.resolve()
    },
  }

  postMessage(message: unknown) {
    this.wire.push(message)
    if ((message as { type?: unknown }).type === "start") {
      queueMicrotask(() => this.emit("message", { type: "ready" }))
      return
    }
    const command = parseSidecarStopCommand(message)
    if (!command) return
    // sidecar.ts 的 finally:关完就自己退(那里是 process.exit(0))。
    void stopSidecarEngine(this.engine).then(() => this.emit("exit", 0))
  }

  kill() {
    this.kills++
    queueMicrotask(() => this.emit("exit", 0))
  }
}

/** 完全无响应的 sidecar —— 只有它才能观察到两个兜底预算本身。 */
class DeafChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kills = 0

  postMessage(message: unknown) {
    if ((message as { type?: unknown }).type === "start") queueMicrotask(() => this.emit("message", { type: "ready" }))
  }

  kill() {
    this.kills++
    queueMicrotask(() => this.emit("exit", 0))
  }
}

let userDataPath = ""
const savedEnv: Record<string, string | undefined> = {}
const managedEnv = ["SHELL", "CODEPUPPY_SECRETS_DISABLE", "CODEPUPPY_CLOUD_MCP_URL", "CODEPUPPY_CLOUD_TOKEN", "CODEPUPPY_GLOBAL_DIR"] as const

beforeEach(() => {
  userDataPath = mkdtempSync(join(tmpdir(), "sidecar-stop-"))
  resetDanglingSweepLatchForTests()
  for (const key of managedEnv) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  process.env.SHELL = "nu"
  process.env.CODEPUPPY_SECRETS_DISABLE = "1"
  process.env.CODEPUPPY_GLOBAL_DIR = join(userDataPath, "codepuppy-state", "env", "dev") // #1698:无快照的单测经环境给全局根(design §10 R31),fork 时构建启动文档要它
})

afterEach(() => {
  for (const key of managedEnv) {
    const value = savedEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(userDataPath, { recursive: true, force: true })
})

async function spawn(child: SidecarChild | DeafChild, port: number) {
  creditDanglingSweepForSpawn()
  const result = await spawnLocalServer("127.0.0.1", port, "password", {
    userDataPath,
    healthCheck: async () => true,
    fork: (() => child) as unknown as typeof import("electron").utilityProcess.fork,
    // REQ-159 `#1321`:围栏计划替身(本文件的假子进程不跑 sidecar.ts;围栏判据在 process-fence-*.test.ts)。
    planFence: () => ({ profile: "(version 1)\n(allow default)\n(deny file-write*)\n", addonPath: "/nonexistent/codepuppy_fence.node" }),
  })
  await result.health.wait
  return result
}

describe("#858 停止合同:关掉引擎", () => {
  test("线上只发 { type: \"stop\" },引擎被关一次(2.x 的收尾),进程自己退出(一次 kill 都没有)", async () => {
    const child = new SidecarChild()
    const result = await spawn(child, 4310)

    await result.listener.stop()

    expect(child.wire.at(-1)).toEqual({ type: "stop" })
    expect(child.engineCloses).toBe(1)
    expect(child.kills).toBe(0)
  })

  test("无响应的 sidecar 由 6s 兜底预算收口:到期之前不 kill,到期恰好 kill 一次", async () => {
    vi.useFakeTimers()
    try {
      const child = new DeafChild()
      const result = await spawn(child, 4321)

      const stopping = result.listener.stop()
      vi.advanceTimersByTime(5_999)
      await Promise.resolve()
      expect(child.kills).toBe(0)
      vi.advanceTimersByTime(1)
      await stopping
      expect(child.kills).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  test("只认 type:\"stop\";附加字段(含已删除的 closeActiveConnections)一律忽略,不是 stop 的形状一律拒", () => {
    for (const value of [true, "1", 1, false, null, undefined])
      expect(parseSidecarStopCommand({ type: "stop", closeActiveConnections: value })).toEqual({ type: "stop" })
    for (const value of [{ type: "start" }, { type: "stopped" }, "stop", null, 7])
      expect(parseSidecarStopCommand(value)).toBeUndefined()
  })

})

test("#1647 AC2 a hung engine close stays inside the five-second stop budget", async () => {
  vi.useFakeTimers()
  try {
    let done = false
    const stopping = stopSidecarEngine({ close: () => new Promise<void>(() => {}) }).then(() => {
      done = true
    })
    for (let tick = 0; tick < 8; tick++) await Promise.resolve()
    vi.advanceTimersByTime(4_999)
    await Promise.resolve()
    expect(done).toBe(false)
    vi.advanceTimersByTime(1)
    for (let tick = 0; tick < 4; tick++) await Promise.resolve()
    expect(done).toBe(true)
    await stopping
  } finally {
    vi.useRealTimers()
  }
})

test("main waits for SessionEnd acknowledgements before sending the sidecar stop command", async () => {
  const { requestSidecarStop } = await import("./sidecar-stop")
  const { createPluginSessionRequester, notePluginSessionViewed } = await import("./plugin-session-lifecycle")
  const messages: Array<{ id: number }> = []
  const requester = createPluginSessionRequester(message => { messages.push(message) })
  notePluginSessionViewed(1776, "ses_shutdown")
  const seen: string[] = []
  let exited!: () => void
  const exit = new Promise<void>(resolve => { exited = resolve })
  const stopped = requestSidecarStop({ postMessage: () => { seen.push("stop"); exited() }, kill: () => { seen.push("kill") } }, exit)
  await Promise.resolve()
  expect(seen).toEqual([])
  expect(messages).toHaveLength(1)
  requester.receive({ id: messages[0]!.id, ok: true })
  await stopped
  expect(seen).toEqual(["stop"])
  requester.close()
  notePluginSessionViewed(1776, undefined)
})

test("without a viewed Session main posts stop immediately and waits for the real child exit", async () => {
  const { requestSidecarStop } = await import("./sidecar-stop")
  const { createPluginSessionRequester } = await import("./plugin-session-lifecycle")
  const requester = createPluginSessionRequester(() => { throw Error("no Session should be invented") })
  const messages: unknown[] = []
  let exited!: () => void
  const exit = new Promise<void>(resolve => { exited = resolve })
  const stopped = requestSidecarStop({ postMessage: message => { messages.push(message) }, kill: () => {} }, exit)
  expect(messages).toEqual([{ type: "stop" }])
  exited()
  await stopped
  requester.close()
})
