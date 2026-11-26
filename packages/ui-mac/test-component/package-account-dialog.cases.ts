import { afterEach, expect, mock, test } from "bun:test"
import { transformAsync } from "@babel/core"
import presetTypescript from "@babel/preset-typescript"
import presetSolid from "babel-preset-solid"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import type { PackageAuthorizationItemV1 } from "../src/shared/package-admission"
GlobalRegistrator.register()
const solid = await import("solid-js/dist/solid.js")
mock.module("solid-js", () => solid)
const web = await import("solid-js/web/dist/web.js")
mock.module("solid-js/web", () => web)
Bun.plugin({ name: "package-account-dialog-dom", setup(builder) {
  builder.onLoad({ filter: /packages\/ui-mac\/src\/.*\.tsx$/ }, async args => {
    const transformed = await transformAsync(await Bun.file(args.path).text(), { filename: args.path, presets: [[presetSolid, { generate: "dom", hydratable: false }], [presetTypescript, { allExtensions: true, isTSX: true, onlyRemoveTypeImports: true }]] })
    return { contents: transformed?.code ?? "", loader: "js" }
  })
} })
const { PackageAccountDialog } = await import("../src/renderer/extensions/package-account-dialog")
const { setLocale } = await import("../src/renderer/i18n")
setLocale("zh")
const disposers: (() => void)[] = []
afterEach(() => { while (disposers.length) disposers.pop()!(); document.body.innerHTML = "" })
const flush = async () => { for (let n=0;n<8;n++) await Bun.sleep(0) }
const field = (id: string, componentId = "mcp_docs"): PackageAuthorizationItemV1 => ({ kind: "secret", componentId, prerequisiteId: id, serviceName: "docs", label: id, saved: false })
function mount(items: PackageAuthorizationItemV1[], needId = "FIRST", result = { ok: true }) {
  const reads: string[] = []
  const writes: unknown[] = []
  let closed = 0
  Object.assign(window, { api: { ext: { packageAuthorization: async (id: string) => { reads.push(id); return { ok: true, packageId: id, items } } } } })
  const host=document.createElement("div");document.body.append(host)
  disposers.push(web.render(()=>solid.createComponent(PackageAccountDialog,{packageId:"main-package",label:"Docs",needId,save:async(input:unknown)=>{writes.push(input);return result},onClose:()=>{closed++},onSaved:()=>{}}),host))
  return { reads, writes, closed:()=>closed }
}
test("BC4 shared password dialog re-reads package needs, keeps fields optional, and submits only nonempty selected-component values",async()=>{
 const h=mount([field("FIRST"),field("SECOND"),field("OTHER","other_component")]);await flush()
 expect(h.reads).toEqual(["main-package"])
 const inputs=Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'))
 expect(inputs).toHaveLength(2)
 expect(inputs.map(input=>input.closest("label")?.textContent?.trim())).toEqual(["FIRST","SECOND"])
 for(const input of inputs){expect(input.required).toBe(false);expect(input.autocomplete).toBe("off")}
 const canary="BC4_DIALOG_PRIVATE_CANARY_398d"
 inputs[0]!.value=canary;inputs[0]!.dispatchEvent(new Event("input",{bubbles:true}))
 inputs[1]!.value="";inputs[1]!.dispatchEvent(new Event("input",{bubbles:true}))
 expect(document.body.innerHTML).not.toContain(canary)
 document.querySelector<HTMLButtonElement>('.a-dialog-footer button')!.click();await flush()
 expect(h.writes).toEqual([{packageId:"main-package",secrets:{FIRST:canary}}])
 expect(h.closed()).toBe(1)
})
test("BC4 a removed need cannot submit a stale token and reports the same package as unavailable",async()=>{
 const h=mount([field("OTHER","other_component")]);await flush()
 expect(document.querySelector('input[type="password"]')).toBeNull()
 expect(document.querySelector('[role="alert"]')?.textContent).toContain("暂时无法读取账户状态")
 document.querySelector<HTMLButtonElement>('.a-dialog-footer button')!.click();await flush()
 expect(h.writes).toEqual([]);expect(h.closed()).toBe(0)
})
test("BC4 account save failure stays in the shared dialog and never displays the submitted value",async()=>{
 const h=mount([field("FIRST")],"FIRST",{ok:false});await flush()
 const input=document.querySelector<HTMLInputElement>('input[type="password"]')!
 input.value="BC4_REFUSED_PRIVATE_TOKEN";input.dispatchEvent(new Event("input",{bubbles:true}))
 document.querySelector<HTMLButtonElement>('.a-dialog-footer button')!.click();await flush()
 expect(h.closed()).toBe(0)
 expect(document.querySelector('[role="alert"]')?.textContent).toBe("凭据未能保存，请检查填写内容后重试。")
 expect(document.body.innerHTML).not.toContain(input.value)
})

test("BC4 changing the package target clears the previous input before a different package can save",async()=>{
 const [packageId,setPackageId]=solid.createSignal("first-package")
 const writes:unknown[]=[]
 Object.assign(window,{api:{ext:{packageAuthorization:async(id:string)=>({ok:true,packageId:id,items:[field("FIRST")]})}}})
 const host=document.createElement("div");document.body.append(host)
 disposers.push(web.render(()=>solid.createComponent(PackageAccountDialog,{get packageId(){return packageId()},label:"Docs",needId:"FIRST",save:async(input:unknown)=>{writes.push(input);return {ok:true}},onClose:()=>{},onSaved:()=>{}}),host))
 await flush()
 const fieldBefore=document.querySelector<HTMLInputElement>('input[type="password"]')!
 fieldBefore.value="BC4_FIRST_PACKAGE_PRIVATE_TOKEN";fieldBefore.dispatchEvent(new Event("input",{bubbles:true}))
 setPackageId("second-package");await flush()
 expect(document.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("")
 document.querySelector<HTMLButtonElement>('.a-dialog-footer button')!.click();await flush()
 expect(writes).toEqual([{packageId:"second-package",secrets:{}}])
 expect(JSON.stringify(writes)).not.toContain("BC4_FIRST_PACKAGE_PRIVATE_TOKEN")
})

// I-15(alpha-code#1726 审查)/ BR-05:令牌窗写明服务的获取位置。官方 MCP 注册表来源的 GitHub 服务器(已验命名空间
// io.github.github)与目录的 GitHub 包一样给「去 GitHub 获取」;其他服务、或只是名字叫 github 的本机包不给(名字不证明来源)。
test("I-15 the official Registry GitHub server's token form links to where GitHub issues the token, like the catalog GitHub packages", async () => {
 const opened: string[] = []
 const show = (packageId: string, source: unknown) => {
  document.body.innerHTML = ""
  Object.assign(window, { api: { openLink: async (url: string) => { opened.push(url) }, ext: { packageAuthorization: async (id: string) => ({ ok: true, packageId: id, items: [field("TOKEN", "mcp_github")] }) } } })
  const host = document.createElement("div"); document.body.append(host)
  disposers.push(web.render(() => solid.createComponent(PackageAccountDialog, { packageId, source, label: "GitHub", needId: "TOKEN", save: async () => ({ ok: true }), onClose: () => {}, onSaved: () => {} } as never), host))
 }
 const link = () => Array.from(document.querySelectorAll<HTMLButtonElement>("button.codepuppy-ext-link")).find(button => button.textContent === "去 GitHub 获取")
 const github = { kind: "mcp-registry", serverName: "io.github.github/github-mcp-server", version: "2.1.0", publisher: { kind: "github", account: "github" } }
 for (const [packageId, source] of [["mcpreg:github-mcp-server", github], ["package:github", { kind: "catalog" }], ["package:github-official", { kind: "catalog" }]] as const) {
  show(packageId, source); await flush()
  expect([packageId, !!link()]).toEqual([packageId, true])
  link()!.click(); await flush()
 }
 expect(opened).toEqual(Array(3).fill("https://github.com/settings/personal-access-tokens/new"))
 for (const [packageId, source] of [["mcpreg:mcp", { kind: "mcp-registry", serverName: "com.figma.mcp/mcp", version: "1.0.3", publisher: { kind: "domain", domain: "figma.com" } }], ["local:github", { kind: "local-folder" }]] as const) {
  show(packageId, source); await flush()
  expect([packageId, !!link()]).toEqual([packageId, false])
 }
})


test("package service settings preserve false zero empty text and keep sensitive input transient", async () => {
  const base = { kind: "option" as const, componentId: "bundle:langfuse", serviceName: "langfuse", configured: false, required: false, sensitive: false, description: "Source option description" }
  const h = mount([
    { ...base, prerequisiteId: "debug", key: "CC_LANGFUSE_DEBUG", label: "Debug logging", type: "boolean", value: true },
    { ...base, prerequisiteId: "max", key: "CC_LANGFUSE_MAX_CHARS", label: "Max characters", type: "number", value: 20000 },
    { ...base, prerequisiteId: "user", key: "LANGFUSE_USER_ID", label: "User ID", type: "string", value: "default user" },
    { ...base, prerequisiteId: "secret", key: "LANGFUSE_SECRET_KEY", label: "Langfuse Secret Key", type: "string", sensitive: true },
  ], "debug")
  await flush()
  const checkbox = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!
  checkbox.checked = false; checkbox.dispatchEvent(new Event("change", { bubbles: true }))
  const number = document.querySelector<HTMLInputElement>('input[type="number"]')!
  number.value = "0"; number.dispatchEvent(new Event("input", { bubbles: true }))
  const text = document.querySelector<HTMLInputElement>('input[type="text"]')!
  text.value = ""; text.dispatchEvent(new Event("input", { bubbles: true }))
  const secret = document.querySelector<HTMLInputElement>('input[type="password"]')!
  secret.value = "UI_TRANSIENT_TEST_TOKEN"; secret.dispatchEvent(new Event("input", { bubbles: true }))
  expect(document.body.innerHTML).not.toContain("UI_TRANSIENT_TEST_TOKEN")
  expect(document.body.textContent).toContain("Source option description")
  document.querySelector<HTMLButtonElement>('.a-dialog-footer button')!.click(); await flush()
  expect(h.writes).toEqual([{ packageId: "main-package", options: { CC_LANGFUSE_DEBUG: false, CC_LANGFUSE_MAX_CHARS: 0, LANGFUSE_USER_ID: "", LANGFUSE_SECRET_KEY: "UI_TRANSIENT_TEST_TOKEN" } }])
})

test("connector version suggestion is prefilled and clearing it submits the original-command choice", async () => {
  const h = mount([{ kind: "mcp-version", componentId: "mcp:xcodebuildmcp", prerequisiteId: "version", serviceName: "xcodebuildmcp", label: "xcodebuildmcp", key: "mcp:xcodebuildmcp", token: "xcodebuildmcp@latest", value: "2.0.0", suggestion: "2.0.0" }], "version")
  await flush()
  const input = document.querySelector<HTMLInputElement>('input[type="text"]')!
  expect(input.value).toBe("2.0.0")
  expect(input.required).toBe(false)
  expect(document.body.textContent).toContain("留空使用原命令：xcodebuildmcp@latest")
  input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true }))
  document.querySelector<HTMLButtonElement>('.a-dialog-footer button')!.click(); await flush()
  expect(h.writes).toEqual([{ packageId: "main-package", mcpVersions: { "mcp:xcodebuildmcp": "" } }])
})
