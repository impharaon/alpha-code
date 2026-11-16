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
const actual = catalog.entries.find(entry => entry.id === "mcp:playwright")!
const sources = createPluginSources({ catalog: async () => [{ id: actual.id, source: "catalog", name: actual.name, displayName: actual.displayName, description: actual.description, kind: "mcp", upstream: { version: actual.version } }], fetch: fixtureFetch })
const recorded = await sources.searchSources("playwright")
GlobalRegistrator.register()
const solid = await import("solid-js/dist/solid.js")
mock.module("solid-js", () => solid)
const web = await import("solid-js/web/dist/web.js")
mock.module("solid-js/web", () => web)
Bun.plugin({ name: "plugin-source-results-dom", setup(builder) {
  builder.onLoad({ filter: /packages\/ui-mac\/src\/.*\.tsx$/ }, async args => {
    const result = await transformAsync(await Bun.file(args.path).text(), { filename: args.path, presets: [[presetSolid, { generate: "dom", hydratable: false }], [presetTypescript, { allExtensions: true, isTSX: true, onlyRemoveTypeImports: true }]] })
    return { contents: result?.code ?? "", loader: "js" }
  })
} })
const { PluginSourceResults } = await import("../src/renderer/extensions/plugin-source-results")
const { setLocale } = await import("../src/renderer/i18n")
setLocale("zh")
const disposers: (() => void)[] = []
afterEach(() => { while(disposers.length) disposers.pop()!(); document.body.innerHTML = "" })
const flush = async () => { for(let n=0;n<6;n++)await new Promise(resolve=>setTimeout(resolve,0)) }
function mount(over: Partial<Parameters<typeof PluginSourceResults>[0]> = {}) {
 const node=document.createElement("div");document.body.append(node)
 disposers.push(web.render(()=>solid.createComponent(PluginSourceResults,{ query:"playwright", search:async()=>structuredClone(recorded), install:async()=>({ok:false,code:"unknown-id",detail:"not installed"}), installedMenu:()=>undefined, ...over }),node))
 return node
}

test("BC1 main order, distinct same-name identities and real sources survive rendering; only selected ID installs", async()=>{
 const requests:string[]=[]
 const node=mount({install:async candidate=>{requests.push(candidate.id);return {ok:false,code:"unknown-id",detail:"main candidate expired"}}})
 await flush()
 expect([...node.querySelectorAll("[data-source-candidate]")].map(node=>node.getAttribute("data-source-candidate"))).toEqual(recorded.candidates.map(candidate=>candidate.id))
 expect(node.textContent).toContain("Claude 插件市场")
 expect(node.textContent).toContain("定制中心")
 expect(node.querySelectorAll("button")).toHaveLength(2)
 node.querySelectorAll<HTMLButtonElement>("button")[1]!.click();await flush()
 expect(requests).toEqual([recorded.candidates[1]!.id])
 expect(node.textContent).toContain("main candidate expired")
 expect(node.querySelectorAll('[role="dialog"]')).toHaveLength(0)
})

test("BC1 only main-proved sameAs folds; installed candidate renders the existing package menu",async()=>{
 const answer=structuredClone(recorded)
 answer.candidates[1]!.sameAs=answer.candidates[0]!.id
 answer.candidates[0]!.installed={packageId:"package-real-main-id",enabled:true}
 const managed:string[]=[]
 const node=mount({search:async()=>answer,installedMenu:packageId=>{managed.push(packageId);return "existing menu"}})
 await flush()
 expect(node.querySelectorAll("[data-source-candidate]")).toHaveLength(1)
 expect(node.textContent).toContain("existing menu")
 expect(managed).toEqual(["package-real-main-id"])
 expect(node.querySelector("button")).toBeNull()
})

test("BC1 late search replies cannot replace the current query or leave stale rows actionable",async()=>{
 const [query,setQuery]=solid.createSignal("first")
 const pending=new Map<string,(answer:SourceSearchResultV1)=>void>()
 const node=document.createElement("div");document.body.append(node)
 disposers.push(web.render(()=>solid.createComponent(PluginSourceResults,{get query(){return query()},search:query=>new Promise(resolve=>pending.set(query,resolve)),install:async()=>{throw Error("no install")},installedMenu:()=>undefined}),node))
 setQuery("second")
 const answer=structuredClone(recorded);answer.query="second";answer.candidates[0]!.displayName="current result"
 pending.get("second")!(answer);await flush()
 expect(node.textContent).toContain("current result")
 pending.get("first")!({...recorded,query:"first"});await flush()
 expect(node.textContent).toContain("current result")
 expect(node.textContent).not.toContain("正在查找 first")
})

test("BC1 per-source failure stays visible alongside good results and is never reported as no matches",async()=>{
 const answer=structuredClone(recorded);answer.sources[1]={source:"claude-marketplace",status:"failed",reason:"network",detail:"source connection failed"}
 const node=mount({search:async()=>answer});await flush()
 expect(node.textContent).toContain("Claude 插件市场")
 expect(node.textContent).toContain("source connection failed")
 expect(node.querySelectorAll("[data-source-candidate]")).toHaveLength(recorded.candidates.length)
})
