import { afterEach, expect, mock, test } from "bun:test"
import { transformAsync } from "@babel/core"
import presetTypescript from "@babel/preset-typescript"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import presetSolid from "babel-preset-solid"
import type { HubRequestRecord, HubView } from "../src/main/codepuppy-sidecar-messages"
import type { InstalledPackageV1 } from "../src/preload/types"
import type { PackageAuthorizationItemV1 } from "../src/shared/package-admission"

GlobalRegistrator.register()
const solid = await import("solid-js/dist/solid.js")
mock.module("solid-js", () => solid)
const web = await import("solid-js/web/dist/web.js")
mock.module("solid-js/web", () => web)
Bun.plugin({
  name: "hub-install-card-dom",
  setup(builder) {
    builder.onLoad({ filter: /packages\/ui-mac\/src\/.*\.tsx$/ }, async (args) => {
      const result = await transformAsync(await Bun.file(args.path).text(), {
        filename: args.path,
        presets: [
          [presetSolid, { generate: "dom", hydratable: false }],
          [presetTypescript, { allExtensions: true, isTSX: true, onlyRemoveTypeImports: true }],
        ],
      })
      return { contents: result?.code ?? "", loader: "js" }
    })
  },
})
const { setLocale } = await import("../src/renderer/i18n")
const { HubInstallCard } = await import("../src/renderer/codepuppy-ui/session-timeline/cards/hub-install-card")
const { TimelineIntentsContext } = await import("../src/renderer/codepuppy-ui/session-timeline/cards/timeline-intents")
const { takePackageManagementTarget, setExtHubOpen, extHubOpen } = await import(
  "../src/renderer/extensions/ext-hub-state"
)
setLocale("zh")
type Row = Parameters<typeof HubInstallCard>[0]["row"]
const disposers: (() => void)[] = []
afterEach(() => {
  while (disposers.length) disposers.pop()!()
  document.body.innerHTML = ""
  setExtHubOpen(false)
})
const flush = async () => {
  for (let n = 0; n < 8; n++) await new Promise((resolve) => setTimeout(resolve, 0))
}
const pack = (): InstalledPackageV1 => ({
  packageId: "main-context7-package",
  desiredState: "enabled",
  installedGraphDigest: "digest",
  displayName: "context7",
  rootComponentName: "host-context7",
  version: "pinned",
  origin: "local-import",
  source: {
    kind: "marketplace",
    ecosystem: "claude",
    repository: "anthropics/claude-plugins-official",
    commit: "b5b01ac4",
    path: "external_plugins/context7",
    entryName: "context7",
  },
  components: [],
})
const row = (over: Partial<Row["install"]> = {}): Row => ({
  kind: "hubInstall",
  key: "hubInstall:part",
  rev: "1",
  install: {
    partID: "part",
    operation: "install",
    name: "candidate-main-id",
    phase: "running",
    requestId: "request_context7",
    ...over,
  },
})
function harness(initial: HubRequestRecord | null, packages = [pack()]) {
  let record = initial
  let state: HubView["rows"][number]["state"] = "reload-pending"
  let reason = "session busy"
  let authorization: PackageAuthorizationItemV1[] = []
  const listeners = new Set<() => void>()
  const reads: unknown[] = []
  Object.assign(window, {
    api: {
      ext: {
        hubRequest: async (id: string) => {
          reads.push(["request", id])
          return record
        },
        installedPackages: async () => {
          reads.push(["packages"])
          return { ok: true, packages }
        },
        hubView: async (directory: string) => {
          reads.push(["view", directory])
          return {
            directory,
            warnings: [],
            rows: packages.map((p) => ({
              id: p.packageId,
              name: p.packageId,
              displayName: p.displayName!,
              description: "",
              kind: "package",
              scope: "global",
              installed: true,
              enabled: p.desiredState === "enabled",
              state,
              authorization: "none",
              ...(state === "available" ? {} : { stateReason: { code: "reload-waiting", detail: reason } }),
            })),
          }
        },
        packageAuthorization: async (id: string) => {
          reads.push(["authorization", id])
          return { ok: true, packageId: id, items: authorization }
        },
        onHubViewChanged: (listener: () => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
    },
  })
  return {
    reads,
    listeners,
    packages,
    change(
      next: {
        record?: HubRequestRecord | null
        state?: typeof state
        reason?: string
        authorization?: PackageAuthorizationItemV1[]
      },
      notify = true,
    ) {
      if (Object.hasOwn(next, "record")) record = next.record ?? null
      state = next.state ?? state
      reason = next.reason ?? reason
      authorization = next.authorization ?? authorization
      if (notify) for (const listener of listeners) listener()
    },
  }
}
function mount(value: Row, intents: Record<string, unknown> = {}) {
  const host = document.createElement("div")
  document.body.append(host)
  disposers.push(
    web.render(
      () =>
        solid.createComponent(TimelineIntentsContext.Provider, {
          value: { cloudDirectory: "/requesting-directory", ...intents },
          get children() {
            return solid.createComponent(HubInstallCard, { row: value })
          },
        }),
      host,
    ),
  )
  return host
}
const committed = (): HubRequestRecord => ({
  requestId: "request_context7",
  stage: "committed",
  displayName: "context7",
  packageId: "main-context7-package",
})

test("A4 submitted -> committed pending -> engine available, with real source and H management seam", async () => {
  const h = harness({ requestId: "request_context7", stage: "submitted" })
  const host = mount(row({ result: "installed; available" }))
  await flush()
  expect(host.textContent).toContain("正在安装")
  expect(host.textContent).not.toContain("已可用")
  h.change({ record: committed() })
  await flush()
  expect(host.textContent).toContain("已添加『context7』")
  expect(host.textContent).toContain("正在生效")
  expect(host.textContent).toContain("session busy")
  expect(host.textContent).toContain("Claude 插件市场")
  expect(host.querySelectorAll("button")).toHaveLength(0)
  h.change({ state: "available" })
  await flush()
  expect(host.textContent).toContain("context7 已可用，可在定制中心管理。")
  expect(h.reads).toContainEqual(["view", "/requesting-directory"])
  const manage = host.querySelector<HTMLButtonElement>("button")!
  expect(manage.textContent).toBe("管理")
  manage.click()
  expect(extHubOpen()).toBe(true)
  expect(takePackageManagementTarget()).toBe("main-context7-package")
  expect(host.querySelectorAll("button")).toHaveLength(1)
})

test("A4 evicted stage remount reads metadata packageId and catalog provenance without reinstall", async () => {
  const p = pack()
  p.source = { kind: "catalog" }
  p.origin = "catalog"
  p.displayName = "Playwright"
  const h = harness(null, [p])
  h.change({ state: "available" })
  const host = mount(row({ phase: "completed", packageId: p.packageId, result: "submitted; result pending" }))
  await flush()
  expect(host.textContent).toContain("Playwright 已可用")
  expect(host.textContent).toContain("定制中心")
  expect(host.textContent).not.toContain("Claude 插件市场")
  disposers.pop()!()
  expect(h.listeners.size).toBe(0)
  const again = mount(row({ phase: "completed", packageId: p.packageId }))
  await flush()
  expect(again.textContent).toContain("Playwright 已可用")
})

test("A4 notRunning and real engine failure never become available and preserve management", async () => {
  const h = harness(committed())
  h.packages[0]!.notRunning = [{ kind: "plugin", sourceName: "native-hook", reason: "native-js-plugin" }]
  h.change({ state: "available" })
  const host = mount(row())
  await flush()
  expect(host.textContent).toContain("未能启用")
  expect(host.textContent).toContain("native-hook")
  expect(host.textContent).not.toContain("已可用")
  h.packages[0]!.notRunning = []
  h.change({ state: "installed", reason: "spawn_failed" })
  await flush()
  expect(host.textContent).toContain("spawn_failed")
  expect(host.textContent).not.toContain("已可用")
  expect(host.querySelector("button")?.textContent).toBe("管理")
})

test("A4 failed main outcome is shown without manage or install confirmation", async () => {
  harness({
    requestId: "request_context7",
    stage: "failed",
    outcome: { ok: false, code: "unknown-id", detail: "Main candidate no longer exists" },
  })
  const host = mount(row())
  await flush()
  expect(host.textContent).toContain("Main candidate no longer exists")
  expect(host.querySelector("button")).toBeNull()
})

test("A4 missing both identities only shows tool result; running search reports its actual query", async () => {
  const h = harness(null)
  const host = mount(row({ requestId: undefined, phase: "completed", result: "submitted; result pending" }))
  await flush()
  expect(host.textContent).toContain("submitted; result pending")
  expect(h.reads).toHaveLength(0)
  const searching = mount(row({ requestId: undefined, operation: "search", name: "playwright" }))
  await flush()
  expect(searching.textContent).toContain("正在查找 playwright")
  expect(h.reads).toHaveLength(0)
})

test("BC4 existing account truth supplies login/token states and a token action", async () => {
  const h = harness(committed())
  h.change({
    authorization: [
      {
        kind: "mcp-oauth",
        componentId: "mcp",
        prerequisiteId: "oauth",
        serviceName: "Docs",
        label: "Docs",
        authenticated: false,
        status: "needs_auth",
      },
    ],
  })
  const host = mount(row())
  await flush()
  expect(host.textContent).toContain("待登录")
  expect(host.textContent).toContain("登录后，助手就能使用 Docs。")
  expect(host.querySelector("button")).toBeNull()
  h.change({
    authorization: [
      {
        kind: "secret",
        componentId: "mcp",
        prerequisiteId: "TOKEN",
        serviceName: "Docs",
        label: "Token",
        saved: false,
      },
    ],
  })
  await flush()
  expect(host.textContent).toContain("待填令牌")
  expect(host.querySelector("input")).toBeNull()
  expect(host.querySelector("[data-package-token-action]")?.textContent).toBe("连接 Docs")
})

test("A4 pending engine state is reread without a Location reload notification", async () => {
  const h = harness(committed())
  const host = mount(row())
  await flush()
  expect(host.textContent).toContain("正在生效")
  h.change({ state: "available" }, false)
  await new Promise((resolve) => setTimeout(resolve, 1100))
  await flush()
  expect(host.textContent).toContain("context7 已可用")
})


test("BC4 timeline login invokes the current directory auth intent once without another confirmation",async()=>{
 const h=harness(committed())
 const account={kind:"mcp-oauth" as const,componentId:"mcp",prerequisiteId:"oauth",serviceName:"Docs",label:"Docs",authenticated:false,status:"needs_auth"}
 h.change({authorization:[account]})
 const calls:string[]=[]
 let finish!:()=>void
 const pending=new Promise<void>(resolve=>{finish=resolve})
 const host=mount(row(),{authenticateMcp:async(name:string)=>{calls.push(name);await pending;h.change({state:"available",authorization:[{...account,authenticated:true,status:"connected"}]});return {ok:true}}})
 await flush()
 const button=host.querySelector<HTMLButtonElement>('[data-package-login-action]')
 expect(button?.textContent).toBe("登录 Docs")
 button!.click();button!.click()
 await flush()
 expect(calls).toEqual(["Docs"])
 expect(document.querySelector('[role="dialog"]')).toBeNull()
 finish();await flush()
 expect(host.textContent).toContain("context7 已可用")
 expect(h.packages).toHaveLength(1)
})

test("BC4 timeline token input cancels and reopens empty, saves only to the same package channel, and keeps management identity",async()=>{
 const h=harness(committed())
 const account={kind:"secret" as const,componentId:"mcp",prerequisiteId:"TOKEN",serviceName:"Docs",label:"Token",saved:false}
 h.change({authorization:[account]})
 const saves:unknown[]=[]
 const canary="BC4_TIMELINE_PASSWORD_CANARY_1949"
 Object.assign(window.api.ext,{savePackageSecrets:async(input:unknown)=>{saves.push(input);h.change({state:"available",authorization:[{...account,saved:true}]});return {ok:true}}})
 const host=mount(row())
 await flush()
 const open=()=>host.querySelector<HTMLButtonElement>('[data-package-token-action]')!.click()
 open();await flush()
 const field=document.querySelector<HTMLInputElement>('[role="dialog"] input[type="password"]')!
 expect(field).not.toBeNull();expect(field.required).toBe(false);expect(field.autocomplete).toBe("off")
 field.value=canary;field.dispatchEvent(new Event("input",{bubbles:true}))
 expect(document.body.innerHTML).not.toContain(canary)
 document.querySelector<HTMLButtonElement>('[role="dialog"] .a-dialog-close')?.click()
 document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))
 await flush()
 expect(document.querySelector('[role="dialog"]')).toBeNull();expect(saves).toEqual([])
 expect(host.textContent).toContain("待填令牌");expect(h.packages).toHaveLength(1)
 open();await flush()
 const reopened=document.querySelector<HTMLInputElement>('[role="dialog"] input[type="password"]')!
 expect(reopened.value).toBe("")
 reopened.value=canary;reopened.dispatchEvent(new Event("input",{bubbles:true}))
 document.querySelector<HTMLButtonElement>('[role="dialog"] .a-dialog-footer button')!.click();await flush()
 expect(saves).toEqual([{packageId:pack().packageId,secrets:{TOKEN:canary}}])
 expect(document.querySelector('[role="dialog"]')).toBeNull()
 expect(host.textContent).toContain("context7 已可用")
 expect(JSON.stringify(h.reads)).not.toContain(canary)
 expect(document.body.innerHTML).not.toContain(canary)
 host.querySelector<HTMLButtonElement>('.a-tc-open')!.click()
 expect(takePackageManagementTarget()).toBe(pack().packageId)
})
