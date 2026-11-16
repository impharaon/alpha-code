import { afterEach, expect, mock, test } from "bun:test"
import { transformAsync } from "@babel/core"
import presetTypescript from "@babel/preset-typescript"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import presetSolid from "babel-preset-solid"
import { createPluginSources } from "../src/main/plugin-sources"
import { fixtureFetch } from "../test-fixtures/plugin-helper/source-fetch"
import catalog from "../src/renderer/extensions/codepuppy-catalog.json"
import type { SourceSearchResultV1 } from "../src/main/plugin-sources"

// Third-party bytes are the pinned A fixtures. These are main's own display DTOs.
const actual = catalog.entries.find((entry) => entry.id === "mcp:playwright")!
const sources = createPluginSources({
  catalog: async () => [
    {
      id: actual.id,
      source: "catalog",
      name: actual.name,
      displayName: actual.displayName,
      description: actual.description,
      kind: "mcp",
      upstream: { version: actual.version },
    },
  ],
  fetch: fixtureFetch,
})
const recorded = await sources.searchSources("playwright")
GlobalRegistrator.register()
const solid = await import("solid-js/dist/solid.js")
mock.module("solid-js", () => solid)
const web = await import("solid-js/web/dist/web.js")
mock.module("solid-js/web", () => web)
Bun.plugin({
  name: "plugin-source-results-dom",
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
const { PluginSourceResults } = await import("../src/renderer/extensions/plugin-source-results")
const { setLocale } = await import("../src/renderer/i18n")
setLocale("zh")
const disposers: (() => void)[] = []
afterEach(() => {
  while (disposers.length) disposers.pop()!()
  document.body.innerHTML = ""
})
const flush = async () => {
  for (let n = 0; n < 6; n++) await new Promise((resolve) => setTimeout(resolve, 0))
}
function mount(over: Partial<Parameters<typeof PluginSourceResults>[0]> = {}) {
  const node = document.createElement("div")
  document.body.append(node)
  disposers.push(
    web.render(
      () =>
        solid.createComponent(PluginSourceResults, {
          query: "playwright",
          search: async () => structuredClone(recorded),
          install: async () => ({ ok: false, code: "unknown-id", detail: "not installed" }),
          installedMenu: () => undefined,
          ...over,
        }),
      node,
    ),
  )
  return node
}

test("BC1 main order, distinct same-name identities and real sources survive rendering; only selected ID installs", async () => {
  const requests: string[] = []
  const node = mount({
    install: async (candidate) => {
      requests.push(candidate.id)
      return { ok: false, code: "unknown-id", detail: "main candidate expired" }
    },
  })
  await flush()
  expect(
    [...node.querySelectorAll("[data-source-candidate]")].map((node) => node.getAttribute("data-source-candidate")),
  ).toEqual(recorded.candidates.map((candidate) => candidate.id))
  expect(node.textContent).toContain("Claude 插件市场")
  expect(node.textContent).toContain("定制中心")
  expect(node.querySelectorAll("button")).toHaveLength(2)
  node.querySelectorAll<HTMLButtonElement>("button")[1]!.click()
  await flush()
  expect(requests).toEqual([recorded.candidates[1]!.id])
  expect(node.textContent).toContain("main candidate expired")
  expect(node.querySelectorAll('[role="dialog"]')).toHaveLength(0)
})

test("BC1 only main-proved sameAs folds; installed candidate renders the existing package menu", async () => {
  const answer = structuredClone(recorded)
  answer.candidates[1]!.sameAs = answer.candidates[0]!.id
  answer.candidates[0]!.installed = { packageId: "package-real-main-id", enabled: true }
  const managed: string[] = []
  const node = mount({
    search: async () => answer,
    installedMenu: (packageId) => {
      managed.push(packageId)
      return "existing menu"
    },
  })
  await flush()
  expect(node.querySelectorAll("[data-source-candidate]")).toHaveLength(1)
  expect(node.textContent).toContain("existing menu")
  expect(managed).toEqual(["package-real-main-id"])
  expect(node.querySelector("button")).toBeNull()
})

test("BC1 late search replies cannot replace the current query or leave stale rows actionable", async () => {
  const [query, setQuery] = solid.createSignal("first")
  const pending = new Map<string, (answer: SourceSearchResultV1) => void>()
  const node = document.createElement("div")
  document.body.append(node)
  disposers.push(
    web.render(
      () =>
        solid.createComponent(PluginSourceResults, {
          get query() {
            return query()
          },
          search: (query) => new Promise((resolve) => pending.set(query, resolve)),
          install: async () => {
            throw Error("no install")
          },
          installedMenu: () => undefined,
        }),
      node,
    ),
  )
  setQuery("second")
  // The stale-reply proof starts after the debounced second query is actually sent.
  await new Promise(resolve => setTimeout(resolve, 260))
  const answer = structuredClone(recorded)
  answer.query = "second"
  answer.candidates[0]!.displayName = "current result"
  pending.get("second")!(answer)
  await flush()
  expect(node.textContent).toContain("current result")
  pending.get("first")!({ ...recorded, query: "first" })
  await flush()
  expect(node.textContent).toContain("current result")
  expect(node.textContent).not.toContain("正在查找 first")
})

test("BC1 per-source failure stays visible alongside good results and is never reported as no matches", async () => {
  const answer = structuredClone(recorded)
  answer.sources[1] = {
    source: "claude-marketplace",
    status: "failed",
    reason: "network",
    detail: "source connection failed",
  }
  const node = mount({ search: async () => answer })
  await flush()
  expect(node.textContent).toContain("Claude 插件市场")
  expect(node.textContent).toContain("source connection failed")
  expect(node.querySelectorAll("[data-source-candidate]")).toHaveLength(recorded.candidates.length)
})

test("BC1 an empty failed source does not claim a completed no-match search", async () => {
  const answer = structuredClone(recorded)
  answer.candidates = []
  answer.sources[1] = { source: "claude-marketplace", status: "failed", reason: "http", detail: "HTTP 503" }
  const failed = mount({ search: async () => answer })
  await flush()
  expect(failed.textContent).toContain("HTTP 503")
  expect(failed.textContent).not.toContain("本次查询没有匹配条目")
  const empty = mount({ search: async () => ({ ...answer, sources: answer.sources.map(source => ({ source: source.source, status: "ok", matched: 0, skipped: 0 })) }) })
  await flush()
  expect(empty.textContent).toContain("本次查询没有匹配条目")
})

test("BC1 an IPC rejection stays an inline failure and never renders an old result", async () => {
  const failed = mount({ search: async () => { throw Error("transport unavailable") } })
  await flush()
  expect(failed.textContent).toContain("未能查询来源")
  expect(failed.querySelectorAll("[data-source-candidate]")).toHaveLength(0)
})


test("R12 B5 typing coalesces source queries without delaying the initial search",async()=>{
 const {jest}=await import("bun:test")
 const queries:string[]=[]
 const [query,setQuery]=solid.createSignal("initial")
 jest.useFakeTimers()
 try{
  const node=document.createElement("div")
  document.body.append(node)
  disposers.push(web.render(()=>solid.createComponent(PluginSourceResults,{get query(){return query()},search:async value=>{queries.push(value);return {...structuredClone(recorded),query:value}},install:async()=>({ok:false,code:"unknown-id",detail:"fixture"}),installedMenu:()=>undefined}),node))
  await Promise.resolve()
  expect(queries).toEqual(["initial"])
  setQuery("pl")
  jest.advanceTimersByTime(249)
  await Promise.resolve()
  expect(queries).toEqual(["initial"])
  setQuery("playwright")
  jest.advanceTimersByTime(250)
  await Promise.resolve()
  expect(queries).toEqual(["initial","playwright"])
 }finally{jest.useRealTimers()}
})

test("R14 hub shows a responding real source while another source index is still hung", async () => {
 let release!: (response:Response)=>void
 const stalled=new Promise<Response>(resolve=>{release=resolve})
 const sources=createPluginSources({catalog:async()=>[],fetch:url=>url.includes("raw.githubusercontent.com/openai")?stalled:fixtureFetch(url)})
 try{
  const node=mount({query:"context7",search:(query,progress)=>sources.searchSources(query,progress)})
  await flush()
  expect(node.textContent).toContain("context7")
  expect(node.querySelector('[data-source-candidate]')).not.toBeNull()
  expect(node.textContent).toContain("Claude 插件市场")
  expect(node.textContent).toContain("正在查找")
 }finally{release(await fixtureFetch("https://raw.githubusercontent.com/openai/plugins/main/.agents/plugins/marketplace.json"));await flush()}
})

test("R14 B12 a real third-party plus has no unreviewed default-off message or installation confirmation", async () => {
 const candidate=recorded.candidates.find(candidate=>candidate.source==="claude-marketplace")!
 const calls:string[]=[]
 const node=mount({install:async selected=>{calls.push(selected.id);return {ok:true,packageId:"claude:"+selected.name,displayName:selected.displayName,source:{kind:"marketplace",ecosystem:"claude",repository:selected.upstream.repository!,commit:selected.upstream.commit!,path:selected.upstream.path!,entryName:selected.name},installed:[],notRunning:[]}},installedMenu:()=>"installed package menu"})
 await flush()
 node.querySelector<HTMLButtonElement>(`[data-source-candidate="${candidate.id}"] button`)!.click()
 await flush()
 expect(calls).toEqual([candidate.id])
 expect(document.body.textContent).not.toContain("未经审核,装好后默认关闭")
 expect(document.querySelector('[role="dialog"]')).toBeNull()
 expect(node.textContent).toContain("installed package menu")
})
