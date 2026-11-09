// REQ-060 项目插件扇出(plugin-fanout.ts),`#1665` 起项目插件是 OpenCode 2 的 promise 插件(`{ id, setup }`):
// ext 用同一个插件 Context 调它们的 setup,收集它们的 Cleanup。排序(夹在 registerPolicy 与 seal 之间)在 plugin-setup-order.test.ts。
import { describe, expect, test } from "bun:test"
import { loadProjectPlugins } from "./plugin-fanout"

describe("loadProjectPlugins — trust gate + dynamic import", () => {
  const baseDeps = {
    verifyIdentity: () => true,
    existsSync: () => true,
    readdirSync: () => ["a.js", "b.js", "notjs.ts"],
    pathToFileURL: (p: string) => `file://${p}`,
    join: (...parts: string[]) => parts.join("/"),
  }
  const plugin = (id: string, onSetup: (context: unknown) => unknown = () => undefined) => ({ default: { id, setup: onSetup } })

  test("untrusted → returns [] (executable not loaded)", async () => {
    let imported = 0
    const cleanups = await loadProjectPlugins("/proj/.codepuppy", {}, false, {
      ...baseDeps,
      importModule: async () => (imported++, plugin("x")),
    })
    expect(cleanups).toEqual([])
    expect(imported).toBe(0)
  })

  test("trusted → imports only .js, calls setup(同一个插件 Context), collects the Cleanups it returns", async () => {
    const seen: string[] = []
    const contexts: unknown[] = []
    const context = { location: { directory: "/proj" } }
    const cleanups = await loadProjectPlugins("/proj/.codepuppy", context, true, {
      ...baseDeps,
      importModule: async (url) => {
        seen.push(url)
        return plugin(url, (ctx) => {
          contexts.push(ctx)
          return url.endsWith("a.js") ? () => {} : undefined
        })
      },
    })
    expect(seen).toEqual(["file:///proj/.codepuppy/plugins/a.js", "file:///proj/.codepuppy/plugins/b.js"]) // notjs.ts skipped
    expect(contexts).toEqual([context, context])
    expect(cleanups).toHaveLength(1)
  })

  test("dynamic import 紧前身份复验失败 → 整次 fan-out 拒绝且 import 零执行", async () => {
    let imported = 0
    let checks = 0
    const cleanups = await loadProjectPlugins("/proj/.codepuppy", {}, true, {
      ...baseDeps,
      verifyIdentity: () => ++checks < 3,
      importModule: async () => (imported++, plugin("x")),
    })
    expect(cleanups).toEqual([])
    expect(imported).toBe(0)
  })

  test("a broken plugin (import or setup throws) is skipped loud, others still load", async () => {
    const errors: string[] = []
    const loaded: string[] = []
    await loadProjectPlugins("/proj/.codepuppy", {}, true, {
      ...baseDeps,
      readdirSync: () => ["good.js", "bad.js", "throws.js"],
      importModule: async (url) => {
        if (url.includes("bad")) throw new Error("boom")
        if (url.includes("throws"))
          return plugin("throws", () => {
            throw new Error("setup exploded")
          })
        return plugin("good", () => void loaded.push("good"))
      },
      error: (m) => errors.push(m),
    })
    expect(loaded).toEqual(["good"])
    expect(errors.some((e) => e.includes("bad.js"))).toBe(true)
    expect(errors.some((e) => e.includes("throws.js") && e.includes("setup exploded"))).toBe(true)
  })

  test("no plugins dir → []", async () => {
    const cleanups = await loadProjectPlugins("/proj/.codepuppy", {}, true, { ...baseDeps, existsSync: () => false, importModule: async () => ({}) })
    expect(cleanups).toEqual([])
  })

  test("v1 function plugin or a module without a { id, setup } default → skipped loud (2.x has no hook table to run it)", async () => {
    const errors: string[] = []
    const cleanups = await loadProjectPlugins("/proj/.codepuppy", {}, true, {
      ...baseDeps,
      readdirSync: () => ["v1.js", "x.js"],
      importModule: async (url) => (url.includes("v1") ? { default: async () => ({ event: async () => {} }) } : { notAPlugin: 1 }),
      error: (m) => errors.push(m),
    })
    expect(cleanups).toEqual([])
    expect(errors.filter((e) => e.includes("must be an OpenCode 2 plugin { id, setup }"))).toHaveLength(2)
  })
})
