// #1542: render the actual upstream dialogs AFTER the production build patch. Form values are
// synthetic; provider/model identities come from the shipped alpha-models.json catalog.
import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { transformAsync } from "@babel/core"
import presetTypescript from "@babel/preset-typescript"
import presetSolid from "babel-preset-solid"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { patchUpstreamPlugin } from "../scripts/patch-upstream"
import type { ProviderInput } from "../src/shared/alpha-model-types"
import { mockElectron } from "./electron-mock"

GlobalRegistrator.register()
const solid = await import("solid-js/dist/solid.js")
mock.module("solid-js", () => solid)
const web = await import("solid-js/web/dist/web.js")
mock.module("solid-js/web", () => web)
const store = await import("solid-js/store/dist/store.js")
mock.module("solid-js/store", () => store)
const handlers = new Map<string, (...args: unknown[]) => unknown>()
mockElectron(() => ({ ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) } }))
mock.module("../src/main/alpha-keychain-backend", () => ({ keychainBackend: () => ({
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString(),
}) }))
mock.module("../src/main/logging", () => ({ getLogger: () => ({ log() {}, warn() {}, error() {} }) }))
const { registerProviderIpcHandlers } = await import("../src/main/provider-ipc")
const { setProviderLifecycleDeps } = await import("../src/main/provider-lifecycle")
const { initByokKeys, clearByokKeys, getByokKey, customProviderSecretValues, injectByokKeysIntoEnv, setByokKeyDeps } = await import("../src/main/alpha-byok-keys")
const { buildAlphaModelConfig, getModelCatalog } = await import("../src/main/alpha-models")
const { syncSecretFiles } = await import("../src/main/alpha-secret-files")
const { readCustomProviderRecords } = await import("../src/main/custom-provider-records")
registerProviderIpcHandlers()

const app = resolve(import.meta.dir, "../../app/src")
const plugin = patchUpstreamPlugin({ strict: true })
const transform = plugin.transform as (code: string, id: string) => { code: string } | null
function patched(source: string, file: string) {
  return transform.call({ error: (message: string) => { throw new Error(message) } }, source, file)?.code ?? source
}
Bun.plugin({ name: "patched-provider-dialogs", setup(builder) {
  builder.onLoad({ filter: /packages\/app\/src\/i18n\/en\.ts$/ }, async ({ path }) => ({ contents: patched(await Bun.file(path).text(), path), loader: "ts" }))
  builder.onLoad({ filter: /packages\/app\/src\/.*\.tsx$/ }, async ({ path }) => ({
    contents: (await transformAsync(patched(await Bun.file(path).text(), path), {
      filename: path, presets: [[presetSolid, { generate: "dom", hydratable: false }], [presetTypescript, { allExtensions: true, isTSX: true, onlyRemoveTypeImports: true }]],
    }))!.code!, loader: "js",
  }))
  builder.onResolve({ filter: /^@\// }, ({ path }) => ({ path: resolve(app, path.slice(2)) + ".tsx" }))
} })
const dictionary = await import("../../app/src/i18n/en")
const t = (key: string) => dictionary.dict[key] ?? key
const toasts: Array<{ variant?: string; description?: string }> = []
let closed = 0
let refreshed = 0
let rejectSave = false
let calls: string[] = []
const catalog = getModelCatalog()
const preset = catalog.byokProviders[0]!
const providers = new Map([[`${preset.id}-byok`, { id: `${preset.id}-byok`, name: preset.name }]])
const sync = { data: { config: {}, provider: { all: providers } }, refreshProviders: async () => { refreshed++ }, updateConfig: () => { throw new Error("engine config write forbidden") } }
mock.module(join(app, "context/server-sync.tsx"), () => ({ useServerSync: () => () => sync }))
mock.module(join(app, "context/server-sdk.tsx"), () => ({ useServerSDK: () => () => ({
  protocol: Promise.resolve("v2"),
  client: { auth: { set: () => { throw new Error("engine auth write forbidden") } } },
  api: { integration: { get: async () => ({ data: { methods: [{ type: "key", label: "API Key" }] } }), connect: { key: () => { throw new Error("engine integration write forbidden") } } } },
}) }))
mock.module(join(app, "context/language.tsx"), () => ({ useLanguage: () => ({ t, locale: () => "en" }) }))
mock.module(join(app, "context/settings.tsx"), () => ({ useSettings: () => ({ general: { newLayoutDesigns: () => false } }) }))
mock.module(join(app, "hooks/use-providers.tsx"), () => ({ popularProviders: [], useProviders: () => ({ all: () => providers }) }))
mock.module(join(app, "utils/base64.tsx"), () => ({ decode64: () => undefined }))
mock.module(join(app, "utils/toast.tsx"), () => ({ showToast: (toast: { variant?: string; description?: string }) => toasts.push(toast) }))
mock.module(join(app, "components/external-link.tsx"), () => ({ ExternalLink: (props: { children: unknown }) => props.children }))
mock.module("@solidjs/router", () => ({ useParams: () => ({}) }))
mock.module("@opencode-ai/ui/context/dialog", () => ({ useDialog: () => ({ close: () => closed++ }) }))
// UI primitives and query transport are boundary doubles; the form handlers/validation and main
// IPC/lifecycle/storage are real. No copied save logic lives in this harness.
const passthrough = (props: { children: unknown }) => props.children
for (const [module, names] of Object.entries({ dialog: ["Dialog"], "v2/dialog-v2": ["DialogBody", "DialogHeader", "DialogTitle", "DialogV2"], "provider-icon": ["ProviderIcon"], icon: ["Icon"], spinner: ["Spinner"], tag: ["Tag"] }))
  mock.module(`@opencode-ai/ui/${module}`, () => Object.fromEntries(names.map((name) => [name, passthrough])))
const button = (props: { type?: string; onClick?: () => void; children?: unknown; disabled?: boolean }) => {
  const node = document.createElement("button")
  node.type = (props.type ?? "button") as "button" | "submit"
  node.onclick = props.onClick ?? null
  solid.createEffect(() => { node.disabled = Boolean(props.disabled) })
  web.insert(node, () => props.children)
  return node
}
for (const [module, name] of [["button", "Button"], ["icon-button", "IconButton"], ["v2/button-v2", "ButtonV2"]])
  mock.module(`@opencode-ai/ui/${module}`, () => ({ [name!]: button }))
function field(props: { label?: string; name?: string; value?: string; onChange?: (value: string) => void; error?: string; description?: string }) {
  const node = document.createElement("label")
  const input = document.createElement("input")
  input.name = props.name ?? props.label ?? ""
  input.oninput = () => props.onChange?.(input.value)
  node.append(input)
  solid.createEffect(() => { input.value = props.value ?? "" })
  const message = document.createElement("span")
  node.append(message)
  web.insert(message, () => props.error ?? props.description ?? "")
  return node
}
mock.module("@opencode-ai/ui/text-field", () => ({ TextField: field }))
mock.module("@opencode-ai/ui/v2/text-input-v2", () => ({ TextInputV2: field }))
mock.module("@opencode-ai/ui/list", () => ({ List: () => null }))
mock.module("@tanstack/solid-query", () => ({ useMutation: (options: () => { mutationFn: (input: unknown) => Promise<unknown>; onSuccess: (result: unknown) => void; onError: (error: unknown) => void }) => ({
  isPending: false, mutate: (input: unknown) => { void options().mutationFn(input).then(options().onSuccess, options().onError) },
}) }))
const { CustomProviderForm } = await import("../../app/src/components/dialog-custom-provider")
const { DialogConnectProvider } = await import("../../app/src/components/dialog-connect-provider")
const managed = ["ALPHA_GLOBAL_DIR", "ALPHA_OPENCODE_HOME", "XDG_CONFIG_HOME", "ALPHA_MODELS_DISABLE", preset.keyEnv]
const saved: Record<string, string | undefined> = {}
let root = ""
let dispose: (() => void) | undefined
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "ac1542-provider-")))
  managed.forEach((key) => { saved[key] = process.env[key]; delete process.env[key] })
  process.env.ALPHA_GLOBAL_DIR = join(root, "alpha-code-state/env/dev")
  process.env.ALPHA_OPENCODE_HOME = join(root, "opencode-home")
  process.env.XDG_CONFIG_HOME = join(root, "xdg")
  mkdirSync(process.env.ALPHA_GLOBAL_DIR, { recursive: true })
  clearByokKeys(); initByokKeys(root)
  setProviderLifecycleDeps({ refreshRuntime: async () => { syncSecretFiles(root, {}, customProviderSecretValues(readCustomProviderRecords().map((record) => record.id))); return true } })
  setByokKeyDeps({ onChanged: () => { injectByokKeysIntoEnv(); syncSecretFiles(root, { [preset.keyEnv]: process.env[preset.keyEnv] }) } })
  Object.defineProperty(window, "api", { configurable: true, value: {
    models: { catalog: async () => catalog },
    providers: {
      add: async (input: ProviderInput) => { calls.push("add"); return rejectSave ? { ok: false, reason: "save refused" } : handlers.get("providers-add")!(undefined, input) },
      setKey: async (id: string, key: string) => { calls.push(`setKey:${id}`); return rejectSave ? { ok: false, reason: "save refused" } : handlers.get("providers-set-key")!(undefined, id, key) },
    },
  } })
  calls = []; closed = 0; refreshed = 0; rejectSave = false; toasts.length = 0
})
afterEach(() => {
  dispose?.(); document.body.replaceChildren(); clearByokKeys(); setProviderLifecycleDeps(); setByokKeyDeps({ onChanged() {} })
  managed.forEach((key) => { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key] })
  rmSync(root, { recursive: true, force: true })
})
function fill(name: string, value: string) {
  const input = Array.from(document.querySelectorAll("input")).find((input) => input.name === name)!
  expect(input).toBeDefined()
  input.value = value; input.dispatchEvent(new Event("input", { bubbles: true }))
}
async function custom(key = "synthetic-test-key") {
  dispose = web.render(() => solid.createComponent(CustomProviderForm, {}), document.body)
  fill(t("provider.custom.field.providerID.label"), "sample-service")
  fill(t("provider.custom.field.name.label"), "Sample service")
  fill(t("provider.custom.field.baseURL.label"), preset.baseURL)
  fill(t("provider.custom.field.apiKey.label"), key)
  fill(t("provider.custom.models.id.label"), preset.models[0]!)
  document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  await tick()
}
test("AC2 custom 提交只经 providers.add;真源与可选模型就位后才显示已连接", async () => {
  await custom()
  expect(calls).toEqual(["add"])
  expect(readCustomProviderRecords()).toEqual([{ id: "sample-service", name: "Sample service", compat: "openai", baseURL: preset.baseURL, models: [preset.models[0]!] }])
  expect(Boolean(getByokKey("sample-service"))).toBe(true)
  expect(buildAlphaModelConfig(root)?.enabled_providers).toContain("sample-service")
  expect(JSON.stringify(buildAlphaModelConfig(root)?.provider["sample-service"])).toContain("{file:")
  expect(closed).toBe(1); expect(toasts[0]?.variant).toBe("success")
})
test.each(["", "{env:EXAMPLE_KEY}"])("AC2 不支持空 key / env 引用 (%s);无保存与成功提示", async (key) => {
  await custom(key)
  expect(calls).toEqual([]); expect(closed).toBe(0)
  expect(toasts[0]?.description).toBe(t("provider.custom.alphaUnsupported"))
  expect(document.body.textContent).toContain(t("provider.custom.alphaUnsupported"))
  expect(document.querySelector(`input[name="${t("provider.custom.models.name.label")}"]`)).toBeNull()
  expect(document.querySelector(`input[name="${t("provider.custom.headers.key.label")}"]`)).toBeNull()
})
test("AC2 custom IPC 拒绝不显示已连接", async () => {
  rejectSave = true; await custom()
  expect(closed).toBe(0); expect(toasts[0]?.description).toBe("save refused")
})
async function connect() {
  dispose = web.render(() => solid.createComponent(DialogConnectProvider, { controller: { selected: () => `${preset.id}-byok`, select() {}, reset() {}, back() {} } }), document.body)
  await tick(); await tick()
  fill("apiKey", "synthetic-preset-key")
  document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  await tick()
}
test("AC2 preset 提交只经 providers.setKey;engine id 映射库存 id,密钥进入可选模型", async () => {
  await connect()
  expect(calls).toEqual([`setKey:${preset.id}`])
  expect(Boolean(getByokKey(preset.id))).toBe(true)
  expect(buildAlphaModelConfig(root)?.enabled_providers).toContain(`${preset.id}-byok`)
  expect(refreshed).toBe(1); expect(closed).toBe(1); expect(toasts[0]?.variant).toBe("success")
})
test("AC2 preset IPC 拒绝不关闭、不刷新、不显示已连接", async () => {
  rejectSave = true; await connect()
  expect(closed).toBe(0); expect(refreshed).toBe(0); expect(toasts).toEqual([])
  expect(document.body.textContent).toContain("save refused")
})
