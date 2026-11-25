// DESIGN-domestic-cloud-connectivity §4.6(切片二)的**接线**:生产 setupAutoUpdater 交给控制器的检查真的经 feedHostBackend ——
// 第一次 setFeedURL 带香港 GitHub 转发入口,转发检查失败后紧接着 setFeedURL 到 github.com。把 updater.ts 里的
// `checkForUpdates: feeds.checkForUpdates` 换回 `() => autoUpdater.checkForUpdates()`,typecheck 与改道逻辑的单测
// (updater-feed-hosts.test.ts)都照样绿,只有这里红。
//
// 子进程运行(updater-wiring.test.ts spawn,OPENCODE_CHANNEL=prod):mock.module("electron") 是进程级的。
// 桩替的是 electron 与 electron-updater 的传输层;环境快照用真的 initCodePuppyEnvironment(打包 + prod)。

import { afterAll, beforeEach, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const RELAY = "alpha-github-hk.tidelabs.click"
const feeds: { provider: string; owner: string; repo: string; host: string }[] = []
let failingHosts = new Set<string>()
let host: string | undefined

const autoUpdater = {
  logger: undefined as unknown,
  channel: undefined as string | undefined,
  allowPrerelease: false,
  allowDowngrade: false,
  autoDownload: true,
  autoInstallOnAppQuit: true,
  currentVersion: { compare: (version: string) => ("0.2.7" === version ? 0 : -1) },
  setFeedURL(options: { provider: string; owner: string; repo: string; host: string }) {
    feeds.push({ ...options })
    host = options.host
  },
  async checkForUpdates() {
    if (!host || failingHosts.has(host)) throw new Error(`net::ERR_CONNECTION_REFUSED ${host}`)
    return { isUpdateAvailable: false, updateInfo: { version: "0.2.7" } }
  },
  async downloadUpdate() {
    return []
  },
  quitAndInstall() {},
}

mock.module("electron", () => {
  const electron = {
    app: { isPackaged: true, getVersion: () => "0.2.7", getPath: () => tmpdir() },
    dialog: { showErrorBox() {}, showMessageBox: async () => ({ response: 1 }) },
  }
  return { ...electron, default: electron }
})
mock.module("electron-updater", () => ({ default: { autoUpdater }, autoUpdater }))
mock.module("./logging", () => ({ getLogger: () => ({ log() {}, warn() {}, error() {} }) }))
mock.module("./store", () => ({ getStore: () => ({ get: () => undefined, set() {}, delete() {} }) }))

const appData = mkdtempSync(join(tmpdir(), "updater-wiring-"))
const { initCodePuppyEnvironment } = await import("./codepuppy-environment")
initCodePuppyEnvironment({ isPackaged: true, channel: "prod", appDataDir: appData, env: {} })
const { setupAutoUpdater } = await import("./updater")

afterAll(() => rmSync(appData, { recursive: true, force: true }))
beforeEach(() => {
  feeds.length = 0
  host = undefined
  failingHosts = new Set()
})

test("生产 setupAutoUpdater:第一次 setFeedURL 带香港转发入口;转发检查失败后 setFeedURL 到 github.com", async () => {
  failingHosts = new Set([RELAY])
  const controller = setupAutoUpdater(async () => {})
  expect(await controller.check()).toEqual({ status: "up-to-date" })
  expect(feeds.map((feed) => feed.host)).toEqual([RELAY, "github.com"])
  expect(feeds.every((feed) => feed.provider === "github" && feed.owner === "jinjunnn" && feed.repo === "alpha-code")).toBe(true)
  expect(autoUpdater.channel).toBe("latest")
  expect(autoUpdater.allowDowngrade).toBe(false)
})

test("控制组:转发入口答得了检查 ⇒ 只设过转发主机", async () => {
  const controller = setupAutoUpdater(async () => {})
  expect(await controller.check()).toEqual({ status: "up-to-date" })
  expect(feeds.map((feed) => feed.host)).toEqual([RELAY])
})
