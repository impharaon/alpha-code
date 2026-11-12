// `#1665` I3 的用例本体 —— 由 plugin-setup-order.test.ts 在**子进程**里跑:ext 的 `setup` 里 `registerPolicy(context)` 是第一个
// 被 await 的,它返回的 `seal()` 是最后一个 —— ext 自己的钩子与项目插件扇出都夹在两者之间。这里把 L4 的策略模块
// (`./policy/index.ts`)换成记账的版本,并用一个记账的插件 Context 记下 ext 与项目插件对 Context 的每一次注册。
// 为什么在子进程:bun 1.4.4 的 `mock.module` 作用于同一次 `bun test` 里之后的所有文件,连已 import 的模块也被改绑(#1662 整合
// 实测)—— 同进程跑,排在后面的 ext 测试拿到的就是这个空策略。
// 反向臂:把 `seal()` 挪到扇出之前 ⇒ 项目插件的注册落在 seal 之后 ⇒ 红;把 registerPolicy 挪到任何注册之后 ⇒ 红。
import { afterAll, expect, mock, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const order: string[] = []
mock.module("./policy/index", () => ({
  registerPolicy: async () => {
    order.push("registerPolicy")
    return {
      seal: async () => {
        order.push("seal")
      },
    }
  },
}))

const root = realpathSync(mkdtempSync(join(tmpdir(), "codepuppy-ext-setup-order-")))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** 任意 `context.<domain>.<method>(…)` 都记一笔;注册类调用返回一个 Registration。 */
function recordingContext(directory: string, label: () => string) {
  const domain = (name: string) =>
    new Proxy(
      {},
      {
        get: (_target, method: string) => {
          if (name === "event" && method === "subscribe")
            return () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: async () => ({ done: true, value: undefined }) }) })
          return async () => {
            order.push(`${label()}:${name}.${method}`)
            return { dispose: async () => {} }
          }
        },
      },
    )
  return new Proxy(
    { location: { directory, project: { id: "global", directory, canonical: directory } } },
    { get: (target, key: string) => (key in target ? (target as Record<string, unknown>)[key] : domain(key)) },
  )
}

test("registerPolicy 是 setup 里第一个被 await 的,seal 是最后一个;ext 自己的钩子与项目插件扇出都在两者之间", async () => {
  const globalRoot = join(root, "global")
  mkdirSync(globalRoot, { recursive: true })
  process.env.CODEPUPPY_GLOBAL_DIR = globalRoot
  const project = join(root, "project")
  mkdirSync(join(project, ".codepuppy", "plugins"), { recursive: true })
  writeFileSync(join(project, ".codepuppy", "prefs.json"), JSON.stringify({ extensionsConsent: { granted: true } }))
  writeFileSync(
    join(project, ".codepuppy", "plugins", "probe.js"),
    `export default { id: "project.probe", async setup(context) { globalThis.__codepuppySetupOrderProject = true; await context.tool.hook("execute.before", () => {}) } }\n`,
  )
  const { default: ext } = await import("./plugin")
  const context = recordingContext(project, () => ((globalThis as { __codepuppySetupOrderProject?: boolean }).__codepuppySetupOrderProject ? "project" : "ext"))
  const cleanup = await ext.setup(context as never)
  expect(order[0]).toBe("registerPolicy")
  expect(order.at(-1)).toBe("seal")
  expect(order.filter((entry) => entry === "registerPolicy" || entry === "seal")).toEqual(["registerPolicy", "seal"])
  const middle = order.slice(1, -1)
  expect(middle.filter((entry) => entry.startsWith("ext:")).length).toBeGreaterThan(5)
  expect(middle).toContain("project:tool.hook")
  expect(middle.indexOf("project:tool.hook")).toBeGreaterThan(middle.lastIndexOf("ext:permission.hook"))
  await (cleanup as () => Promise<void>)()
})
