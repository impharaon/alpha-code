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
    const cleanups = await loadProjectPlugins("/proj/.codepuppy", () => ({}), false, {
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
    const cleanups = await loadProjectPlugins("/proj/.codepuppy", () => context, true, {
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
    const cleanups = await loadProjectPlugins("/proj/.codepuppy", () => ({}), true, {
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
    await loadProjectPlugins("/proj/.codepuppy", () => ({}), true, {
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
    const cleanups = await loadProjectPlugins("/proj/.codepuppy", () => ({}), true, { ...baseDeps, existsSync: () => false, importModule: async () => ({}) })
    expect(cleanups).toEqual([])
  })

  test("v1 function plugin or a module without a { id, setup } default → skipped loud (2.x has no hook table to run it)", async () => {
    const errors: string[] = []
    const cleanups = await loadProjectPlugins("/proj/.codepuppy", () => ({}), true, {
      ...baseDeps,
      readdirSync: () => ["v1.js", "x.js"],
      importModule: async (url) => (url.includes("v1") ? { default: async () => ({ event: async () => {} }) } : { notAPlugin: 1 }),
      error: (m) => errors.push(m),
    })
    expect(cleanups).toEqual([])
    expect(errors.filter((e) => e.includes("must be an OpenCode 2 plugin { id, setup }"))).toHaveLength(2)
  })
})

// ── ADR-041 名称冲突:项目插件不得用同名工具顶掉已有工具 ───────────────────────────────────────────
import { effectiveName } from "../../core/src/tool/runtime.ts"
import { effectiveToolName, projectPluginContext } from "./plugin-fanout"

describe("effectiveToolName 与上游 effectiveName 逐字同义(拼法漂移即红)", () => {
  test.each([
    [{ name: "codepuppy_echo" }],
    [{ name: "web search!" }],
    [{ name: "读取", options: { namespace: "my.server" } }],
    [{ name: "tool-x", options: { namespace: "a.b.c" } }],
  ])("%j", (tool) => {
    expect(effectiveToolName(tool)).toBe(effectiveName(tool as never))
  })
})

describe("projectPluginContext:有效名已存在 ⇒ 拒绝;新名照常注册;只许改 / 删自己注册的工具;别的 domain 原样", () => {
  test("同名(含 namespace 拼出来的同名)被拒并记一行;新名进编辑器", async () => {
    const tools = new Map<string, unknown>([["codepuppy_echo", { name: "codepuppy_echo" }], ["srv_read", { name: "read" }]])
    const editor = {
      add: (tool: { name: string }) => void tools.set(effectiveToolName(tool), tool),
      get: (id: string) => tools.get(id),
      list: () => [...tools.values()],
      update: (id: string, fn: (tool: Record<string, unknown>) => void) => fn(tools.get(id) as Record<string, unknown>),
      remove: (id: string) => void tools.delete(id),
    }
    const errors: string[] = []
    const base = {
      tool: { transform: async (callback: (e: typeof editor) => void) => (callback(editor), { dispose: async () => {} }) },
      session: { marker: "untouched" },
    }
    const guarded = projectPluginContext(base as never, (m) => void errors.push(m)) as typeof base
    expect(guarded.session).toBe(base.session)
    await guarded.tool.transform((e) => {
      e.add({ name: "codepuppy_echo", description: "rogue" } as never)
      e.add({ name: "read", options: { namespace: "srv" } } as never)
      e.add({ name: "project_tool" } as never)
      expect(e.list()).toHaveLength(3)
      e.update("codepuppy_echo", (tool: Record<string, unknown>) => void (tool.description = "rogue"))
      e.remove("srv_read")
      e.update("project_tool", (tool: Record<string, unknown>) => void (tool.description = "mine"))
    })
    // 同一插件下一次 transform(或重建)里,自己的工具仍可改 / 删
    await guarded.tool.transform((e) => e.remove("project_tool"))
    expect((tools.get("codepuppy_echo") as { description?: string }).description).toBeUndefined()
    expect(tools.has("srv_read")).toBe(true)
    expect(tools.has("project_tool")).toBe(false)
    expect(errors).toEqual([
      '[@codepuppy/ext] project plugin tool add "codepuppy_echo" refused: a tool with that name already exists (ADR-041)',
      '[@codepuppy/ext] project plugin tool add "srv_read" refused: a tool with that name already exists (ADR-041)',
      '[@codepuppy/ext] project plugin tool update "codepuppy_echo" refused: the project plugin did not register it (ADR-041)',
      '[@codepuppy/ext] project plugin tool remove "srv_read" refused: the project plugin did not register it (ADR-041)',
    ])
  })
})

describe("projectPluginContext:permission 不给回复待批请求、不给改 / 删已存的批准(#1666 第 3 条);assert / hook / list 原样", () => {
  test("reply / saved.update / saved.remove 被拒并按 ADR-041 同一格式记一行,一个都不到下面;别的成员是同一个对象", async () => {
    const reached: string[] = []
    const base = {
      tool: { transform: async () => ({ dispose: async () => {} }) },
      permission: {
        reply: async () => void reached.push("reply"),
        assert: async () => void reached.push("assert"),
        hook: async () => ({ dispose: async () => {} }),
        list: async () => [],
        saved: { list: async () => [], update: async () => void reached.push("saved.update"), remove: async () => void reached.push("saved.remove") },
      },
    }
    const errors: string[] = []
    const guarded = projectPluginContext(base as never, (m) => void errors.push(m)) as typeof base
    expect(await guarded.permission.reply({ sessionID: "ses_1", requestID: "per_1", decision: "once" } as never)).toBeUndefined()
    expect(await guarded.permission.saved.update({ id: "per_saved_1", effect: "allow" } as never)).toBeUndefined()
    expect(await guarded.permission.saved.remove({ id: "per_saved_2" } as never)).toBeUndefined()
    expect(guarded.permission.assert).toBe(base.permission.assert)
    expect(guarded.permission.hook).toBe(base.permission.hook)
    expect(guarded.permission.list).toBe(base.permission.list)
    expect(guarded.permission.saved.list).toBe(base.permission.saved.list)
    await guarded.permission.assert()
    expect(reached).toEqual(["assert"])
    expect(errors).toEqual([
      '[@codepuppy/ext] project plugin permission reply "per_1" refused: approvals belong to the user, not to a project plugin (ADR-041)',
      '[@codepuppy/ext] project plugin permission saved.update "per_saved_1" refused: approvals belong to the user, not to a project plugin (ADR-041)',
      '[@codepuppy/ext] project plugin permission saved.remove "per_saved_2" refused: approvals belong to the user, not to a project plugin (ADR-041)',
    ])
  })
  test("2.x 的 Context 今天没有 permission.saved:拦截照样在(上游加上也不漏)", async () => {
    const errors: string[] = []
    const base = { tool: { transform: async () => ({ dispose: async () => {} }) }, permission: { reply: async () => {} } }
    const guarded = projectPluginContext(base as never, (m) => void errors.push(m)) as unknown as {
      permission: { saved: { update: (input: unknown) => Promise<void>; list?: unknown } }
    }
    await guarded.permission.saved.update({ id: "per_saved_3" })
    expect(guarded.permission.saved.list).toBeUndefined()
    expect(errors).toEqual(['[@codepuppy/ext] project plugin permission saved.update "per_saved_3" refused: approvals belong to the user, not to a project plugin (ADR-041)'])
  })
})
