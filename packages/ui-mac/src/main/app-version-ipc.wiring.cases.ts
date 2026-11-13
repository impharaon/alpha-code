// ac#1187 —— app-version IPC 的取值来源闸门(不是「返回了个像版本号的字符串」)。
//
// 判据钉在唯一真源上:handler 的返回必须是 app.getVersion() 的**实时值** ——
// 在两次 invoke 之间换掉 getVersion 的返回值,IPC 返回必须跟着变。任何把版本写成
// 字面量的实现(不管抄的是当时的真版本还是别的)在其中至少一格上当场红。
//
// 子进程运行(app-version-ipc.wiring.test.ts spawn):mock.module("electron") 在同进程会
// 泄漏进 `bun test src` 里其它文件 —— 同仓 models-catalog-v2.wiring.* 同因同法。

import { expect, mock, test } from "bun:test"
import { formatBuildIdentity, type BuildIdentity } from "../shared/build-identity"

/** 生产代码注册到 ipcMain 上的 handler —— 测试只能经这里拿到它。 */
const handlers = new Map<string, (...args: unknown[]) => unknown>()
let version = "9.9.9-first"

mock.module("electron", () => ({
  app: {
    getVersion: () => version,
    // 个人信息替身:build-identity handler 若读了这些并放进返回,AC-04 的哨兵检查当场红。
    getPath: () => "/Users/sentinel-user-ac237/Library/Application Support/Code Puppy",
    getName: () => "sentinel-project-ac237",
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    },
  },
}))

const { registerAppVersionIpcHandler } = await import("./app-version-ipc")

test("app-version IPC 返回 app.getVersion() 的实时值(换掉真源 ⇒ 返回跟着变)", async () => {
  registerAppVersionIpcHandler()
  const handler = handlers.get("app-version")
  expect(handler, "生产 register 没往 app-version 频道挂 handler").toBeDefined()
  expect(await handler!()).toBe("9.9.9-first")
  version = "8.8.8-mutated"
  expect(await handler!()).toBe("8.8.8-mutated")
})

// ── ac#237 build-identity ─────────────────────────────────────────────────────────────
// 同一思路,真源是「运行中这个包」:app.getVersion() 实时值 + 构建期 define 写入的 import.meta.env 三项
// (bun test 下 import.meta.env === process.env,换环境值 = 换真源)+ 当前进程的系统/架构。
process.env.OPENCODE_CHANNEL = "prod"
const { registerBuildIdentityIpcHandler } = await import("./build-identity-ipc")

const BUILD_ENV = ["CODEPUPPY_BUILD_COMMIT", "CODEPUPPY_BUILD_DATE", "CODEPUPPY_BUILD_ORIGIN"] as const
async function identityHandler() {
  registerBuildIdentityIpcHandler()
  const handler = handlers.get("build-identity")
  expect(handler, "生产 register 没往 build-identity 频道挂 handler").toBeDefined()
  return async () => (await handler!()) as BuildIdentity
}

test("AC-01:build-identity 返回运行中这个包的实时事实,复制行逐字等于它们(换掉任一真源 ⇒ 跟着变)", async () => {
  const read = await identityHandler()
  Object.defineProperty(process, "getSystemVersion", { value: () => "15.3.1", configurable: true })
  version = "1.2.3-first"
  process.env.CODEPUPPY_BUILD_COMMIT = "abc1234"
  process.env.CODEPUPPY_BUILD_DATE = "2026-11-12"
  process.env.CODEPUPPY_BUILD_ORIGIN = "release"
  const first = await read()
  expect(first.version).toBe("1.2.3-first")
  expect(first.channel).toBe("prod")
  expect(first.commit).toBe("abc1234")
  expect(first.date).toBe("2026-11-12")
  expect(first.origin).toBe("release")
  expect(first.os.endsWith(" 15.3.1")).toBe(true)
  expect(first.arch).toBe(process.arch)
  expect(formatBuildIdentity(first)).toBe(
    `Code Puppy 1.2.3-first · 正式 · abc1234 · 2026-11-12 · 正式发布 · ${first.os} ${process.arch}`,
  )

  version = "4.5.6-mutated"
  process.env.CODEPUPPY_BUILD_COMMIT = "fff0000"
  process.env.CODEPUPPY_BUILD_ORIGIN = "local"
  const second = await read()
  expect(second.version).toBe("4.5.6-mutated")
  expect(second.commit).toBe("fff0000")
  expect(second.origin).toBe("local")
  expect(formatBuildIdentity(second)).toContain("Code Puppy 4.5.6-mutated · 正式 · fff0000 · 2026-11-12 · 本机构建 ·")
})

test("AC-03:取不到构建提交(源码直跑)⇒ 「未知」,其余字段照常,handler 不抛错", async () => {
  const read = await identityHandler()
  version = "7.7.7"
  for (const name of BUILD_ENV) delete process.env[name]
  const id = await read()
  expect(id.commit).toBe("")
  expect(id.version).toBe("7.7.7")
  const line = formatBuildIdentity(id)
  expect(line.startsWith("Code Puppy 7.7.7 · 正式 · 未知 · 未知 · 本机构建 · ")).toBe(true)
})

test("AC-04:返回的键恰为约定的七个,值里没有用户名/家目录/账号/项目名", async () => {
  const read = await identityHandler()
  process.env.HOME = "/Users/sentinel-user-ac237"
  process.env.USER = "sentinel-user-ac237"
  process.env.LOGNAME = "sentinel-user-ac237"
  process.env.CODEPUPPY_BUILD_COMMIT = "abc1234"
  const id = await read()
  expect(Object.keys(id).sort()).toEqual(["arch", "channel", "commit", "date", "origin", "os", "version"])
  for (const text of [JSON.stringify(id), formatBuildIdentity(id)]) {
    expect(text).not.toContain("sentinel")
    expect(text).not.toContain("/Users/")
  }
})
