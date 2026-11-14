// #1713:沿用 draft-route-gate 的 happy-dom / Solid 真组件宿主;只替换 IPC 与路由上下文。
import { encodeDirectory } from "../src/shared/route-manifest"
import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test"
import { transformAsync } from "@babel/core"
import presetTypescript from "@babel/preset-typescript"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import presetSolid from "babel-preset-solid"
GlobalRegistrator.register()
const solid = await import("solid-js/dist/solid.js")
mock.module("solid-js", () => solid)
const web = await import("solid-js/web/dist/web.js")
mock.module("solid-js/web", () => web)
Bun.plugin({ name: "ext-trust-watcher-components", setup(builder) {
  builder.onLoad({ filter: /packages\/ui-mac\/src\/.*\.tsx$/ }, async (args) => {
    const result = await transformAsync(await Bun.file(args.path).text(), { filename: args.path, presets: [[presetSolid, { generate: "dom", hydratable: false }], [presetTypescript, { allExtensions: true, isTSX: true, onlyRemoveTypeImports: true }]] })
    return { contents: result?.code ?? "", loader: "js" }
  })
} })
const [pathname, setPathname] = solid.createSignal("/")
mock.module("@solidjs/router", () => ({ useLocation: () => ({ get pathname() { return pathname() } }) }))
mock.module("../src/renderer/codepuppy-ui/Toast", () => ({ pushToast: () => {} }))
mock.module("../src/renderer/i18n", () => ({ t: (key: string) => key }))
mock.module("../src/renderer/extensions/ext-hub-state", () => ({ setExtHubOpen: () => {}, setHubSection: () => {} }))
let result: { prompted: boolean; granted: boolean; incomplete?: boolean }
const calls: string[] = []
let reloads = 0
let externalChecks = 0
mock.module("../src/renderer/extensions/ext-ipc", () => ({ extIpc: {
  trustCheck: async (directory: string) => { calls.push(directory); return result },
  externalCheck: async () => { externalChecks++; return { prompted: false, imported: false, importedSkills: [], skipped: [], claudeMd: "none" } },
  reloadRequest: async () => { reloads++; return {} },
} }))
const { ExtTrustWatcher } = await import("../src/renderer/codepuppy-ui/ext-trust-watcher")
let dispose: (() => void) | undefined
const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 10)) }
const enter = () => setPathname(`/${encodeDirectory("/workspace")}/session/session1`)
beforeEach(() => { calls.length = 0; reloads = 0; externalChecks = 0; setPathname("/"); result = { prompted: false, granted: false } })
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = "" })
afterAll(() => GlobalRegistrator.unregister())
function mount() { dispose = web.render(() => ExtTrustWatcher({ server: () => ({ id: "local" }) as never }), document.body) }
test("incomplete ⇒ 下次进入同一文件夹重新查;完整之后不再查", async () => {
  result = { prompted: false, granted: false, incomplete: true }
  mount(); enter(); await flush()
  expect(calls).toEqual(["/workspace"])
  expect(externalChecks).toBe(1)
  setPathname("/"); await flush()
  result = { prompted: false, granted: false }
  enter(); await flush()
  expect(calls).toEqual(["/workspace", "/workspace"])
  setPathname("/"); await flush(); enter(); await flush()
  expect(calls).toHaveLength(2)
})
test("已有决定 ⇒ 本 renderer 再进入时不重复查询", async () => {
  result = { prompted: false, granted: true }
  mount(); enter(); await flush()
  setPathname("/"); await flush(); enter(); await flush()
  expect(calls).toEqual(["/workspace"])
  expect(reloads).toBe(0)
})
test("刚允许 ⇒ 仍走现有 global 重载路径,不重复重载", async () => {
  result = { prompted: true, granted: true }
  mount(); enter(); await flush()
  expect(reloads).toBe(1)
  setPathname("/"); await flush(); enter(); await flush()
  expect(reloads).toBe(1)
})
