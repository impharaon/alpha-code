// DESIGN-domestic-cloud-connectivity §4.6(切片二)、§8 E-4 的自动化部分 —— 桌面检查与下载更新先经香港 GitHub 转发入口,
// 转发不可达时同一次检查改走 github.com;转发答了检查、安装包却下载失败时,同一轮改走 github.com 重查一次,版本相同才再下载一次。
//
// 被测对象是生产的 `feedHostBackend`(updater.ts 把 electron-updater 的 autoUpdater 交给它)接在**真** createUpdaterController 上。
// 桩替的是 electron-updater 的传输层:按 `setFeedURL` 设定的主机回答「检查」与「下载」,不联网、不读时钟。
// 主机名、owner、repo 不在这里另写一份期望值以外的东西:期望值直接取生产常量,再单独钉一次转发主机的字面值(设计 §4.5 的主机名)。

import { describe, expect, test } from "bun:test"
import { createUpdaterController, feedHostBackend } from "./updater-controller"
import { UPDATE_FEED_HOSTS, UPDATE_FEED_OWNER, UPDATE_FEED_REPO } from "./codepuppy-environment"

const RELAY = "alpha-github-hk.tidelabs.click"
const DIRECT = "github.com"

type HostScript = { check: "fail" | { version: string }; download: "fail" | "ok" }

function stubUpdater(script: Record<string, HostScript>) {
  const calls: string[] = []
  const feeds: { provider: string; owner: string; repo: string; host: string }[] = []
  let host: string | undefined
  return {
    calls,
    feeds,
    updater: {
      setFeedURL(options: { provider: "github"; owner: string; repo: string; host: string }) {
        feeds.push({ ...options })
        host = options.host
        calls.push(`feed:${options.host}`)
      },
      async checkForUpdates() {
        calls.push(`check:${host}`)
        const answer = host ? script[host]?.check : undefined
        if (!answer || answer === "fail") throw new Error(`connect ECONNREFUSED https://${host}/x?token=secret-query`)
        return { isUpdateAvailable: true, updateInfo: { version: answer.version } }
      },
      async downloadUpdate() {
        calls.push(`download:${host}`)
        if (host && script[host]?.download === "ok") return ["/tmp/update.zip"]
        throw new Error(`download failed https://${host}/codepuppy-mac-arm64.zip?X-Amz-Signature=secret-query`)
      },
    },
  }
}

function make(script: Record<string, HostScript>) {
  const stub = stubUpdater(script)
  const logs: { message: string; data?: object }[] = []
  const log = (message: string, data?: object) => void logs.push({ message, data })
  const backend = feedHostBackend({ updater: stub.updater, log })
  const controller = createUpdaterController({
    enabled: true,
    currentVersion: "0.2.7",
    backend: { ...backend, quitAndInstall() {}, isNewer: () => true },
    persistence: { get: () => undefined, set() {}, clear() {} },
    stop: async () => {},
    log,
  })
  const reroutes = () => logs.filter((entry) => entry.message.startsWith("updater feed reroute"))
  return { ...stub, controller, logs, reroutes }
}

describe("§4.6 更新主机顺序", () => {
  test("生产常量:先香港转发入口,再 github.com;owner/repo 是自有发布仓", () => {
    expect([...UPDATE_FEED_HOSTS]).toEqual([RELAY, DIRECT])
    expect(UPDATE_FEED_OWNER).toBe("jinjunnn")
    expect(UPDATE_FEED_REPO).toBe("alpha-code")
  })

  test("E-4 转发可达:经转发检查到新版并下载完成 ⇒ ready;只用过转发主机,不改道、不记改道日志", async () => {
    const { controller, calls, feeds, reroutes } = make({ [RELAY]: { check: { version: "0.2.8" }, download: "ok" } })
    expect(await controller.check()).toEqual({ status: "ready", version: "0.2.8" })
    expect(calls).toEqual([`feed:${RELAY}`, `check:${RELAY}`, `download:${RELAY}`])
    expect(feeds).toEqual([{ provider: "github", owner: UPDATE_FEED_OWNER, repo: UPDATE_FEED_REPO, host: RELAY }])
    expect(reroutes()).toEqual([])
  })

  test("E-4 转发不可达:同一次检查改走 github.com 并下载完成 ⇒ ready;恰一行改道日志,不带查询串", async () => {
    const { controller, calls, feeds, reroutes } = make({ [DIRECT]: { check: { version: "0.2.8" }, download: "ok" } })
    expect(await controller.check()).toEqual({ status: "ready", version: "0.2.8" })
    expect(calls).toEqual([`feed:${RELAY}`, `check:${RELAY}`, `feed:${DIRECT}`, `check:${DIRECT}`, `download:${DIRECT}`])
    expect(feeds.map((feed) => feed.host)).toEqual([RELAY, DIRECT])
    expect(feeds.every((feed) => feed.provider === "github" && feed.owner === UPDATE_FEED_OWNER && feed.repo === UPDATE_FEED_REPO)).toBe(true)
    expect(reroutes()).toHaveLength(1)
    expect(reroutes()[0]!.data).toMatchObject({ from: RELAY, to: DIRECT })
    expect(JSON.stringify(reroutes())).not.toContain("secret-query")
  })

  test("E-4 只坏安装包:转发答检查、zip 下载失败 ⇒ 同一轮经 github.com 重查同版本并下载 ⇒ ready;下载恰两次,恰一行改道日志", async () => {
    const { controller, calls, reroutes } = make({
      [RELAY]: { check: { version: "0.2.8" }, download: "fail" },
      [DIRECT]: { check: { version: "0.2.8" }, download: "ok" },
    })
    expect(await controller.check()).toEqual({ status: "ready", version: "0.2.8" })
    expect(calls).toEqual([`feed:${RELAY}`, `check:${RELAY}`, `download:${RELAY}`, `feed:${DIRECT}`, `check:${DIRECT}`, `download:${DIRECT}`])
    expect(reroutes()).toHaveLength(1)
    expect(reroutes()[0]!.data).toMatchObject({ from: RELAY, to: DIRECT })
    expect(JSON.stringify(reroutes())).not.toContain("secret-query")
  })

  test("E-4 直连检查到的版本与转发答的不同 ⇒ 本轮 error,不进 ready,不发第二次下载", async () => {
    const { controller, calls } = make({
      [RELAY]: { check: { version: "0.2.8" }, download: "fail" },
      [DIRECT]: { check: { version: "0.2.9" }, download: "ok" },
    })
    const state = await controller.check()
    expect(state.status).toBe("error")
    expect(calls.filter((call) => call.startsWith("download:"))).toEqual([`download:${RELAY}`])
  })

  test("经转发下载失败、直连检查也失败 ⇒ error;下载只发生一次", async () => {
    const { controller, calls } = make({ [RELAY]: { check: { version: "0.2.8" }, download: "fail" } })
    expect((await controller.check()).status).toBe("error")
    expect(calls.filter((call) => call.startsWith("download:"))).toEqual([`download:${RELAY}`])
  })

  test("经直连答的检查下载失败 ⇒ error,不再改道(不成环、不重复下载)", async () => {
    const { controller, calls, reroutes } = make({ [DIRECT]: { check: { version: "0.2.8" }, download: "fail" } })
    expect((await controller.check()).status).toBe("error")
    expect(calls.filter((call) => call.startsWith("download:"))).toEqual([`download:${DIRECT}`])
    expect(calls.filter((call) => call.startsWith("check:"))).toEqual([`check:${RELAY}`, `check:${DIRECT}`])
    expect(reroutes()).toHaveLength(1)
  })

  test("两个主机都检查失败 ⇒ error(抛最后一个错误)", async () => {
    const { controller } = make({})
    const state = await controller.check()
    expect(state).toMatchObject({ status: "error" })
    if (state.status === "error") expect(state.message).toContain(DIRECT)
  })

  test("一轮改道之后,下一轮仍从转发入口开始", async () => {
    const script: Record<string, HostScript> = {
      [RELAY]: { check: { version: "0.2.8" }, download: "fail" },
      [DIRECT]: { check: { version: "0.2.9" }, download: "ok" },
    }
    const { controller, feeds } = make(script)
    expect((await controller.check()).status).toBe("error")
    script[RELAY] = { check: { version: "0.2.9" }, download: "ok" }
    const before = feeds.length
    expect(await controller.check()).toEqual({ status: "ready", version: "0.2.9" })
    expect(feeds[before]!.host).toBe(RELAY)
  })

  test("经转发检查无新版 ⇒ up-to-date,不访问 github.com", async () => {
    const stub = stubUpdater({})
    stub.updater.checkForUpdates = async () => {
      stub.calls.push("check:relay-no-update")
      return { isUpdateAvailable: false, updateInfo: { version: "0.2.7" } }
    }
    const backend = feedHostBackend({ updater: stub.updater, log: () => {} })
    const controller = createUpdaterController({
      enabled: true,
      currentVersion: "0.2.7",
      backend: { ...backend, quitAndInstall() {}, isNewer: () => false },
      persistence: { get: () => undefined, set() {}, clear() {} },
      stop: async () => {},
    })
    expect(await controller.check()).toEqual({ status: "up-to-date" })
    expect(stub.feeds.map((feed) => feed.host)).toEqual([RELAY])
  })
})
