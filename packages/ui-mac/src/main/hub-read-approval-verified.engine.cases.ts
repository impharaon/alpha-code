// Codex 审查(fix/hub-status-approval R1/1 #2):过期「始终允许」那一遍要照出货的真实情形跑 —— ext 经随包工具清单核验,助手的
// 查找 / 状态带着 ext 的来源、codepuppy-bundled 授权与非空的当前绑定摘要;策略文档里那条 enabled 记录用的是**真实身份**的 canonical,
// 摘要与当前的不同(上一版留下的)。三档都只看到它们照常执行、不弹卡;用户自己把状态设成「每次询问」照旧会问。
//
// 真引擎(嵌入式 OpenCode 2)+ 生产三档注入 + 真 ext(生产 bundledPluginTools 核验)+ 本机模型桩。本文件由同名 `.test.ts` 宿主起独立子进程跑
// (启动文档进程内只发布一次,带清单的引擎不能与 composer-tier-matrix 的那台共用进程)。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { canonicalToolIdentity } from "../../../schema/src/tool-identity"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, fakeMainReceived, policyStore, scriptedModel, type Running } from "../../test-component/codepuppy-engine"

const sandbox = engineSandbox()
const model = scriptedModel()
const TIERS = ["build", "codepuppy-ask", "codepuppy-readonly"] as const
let running: Running | undefined
let projectDirectory = ""
let store: Awaited<ReturnType<typeof policyStore>> | undefined

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  const host = codepuppyEngine({ sandbox, name: "hub-verified", modelBaseURL: model.baseURL, bundledManifest: true })
  projectDirectory = host.projectDirectory
  running = await host.start()
  store = await policyStore()
}, 90_000)

afterAll(async () => {
  await running?.close().catch(() => undefined)
  model.stop()
})

const send = (method: string, route: string, body?: unknown) => running!.send(method, route, body)
const sent = (type: string) => fakeMainReceived.filter((message) => message.type === type).length

/** 一个会话里依次调两只只读工具;询问一律拒掉。返回问到的动作与两只工具的身份快照(取自步骤的 codepuppyDisplay)。 */
async function lookups(agent: string) {
  const owner = (await send("POST", "/api/session", { location: { directory: projectDirectory }, agent, model: { id: "m", providerID: "codepuppy" } })).json.data as { id: string }
  const asked: string[] = []
  for (const [name, args] of [["codepuppy_hub_search", { query: "github" }], ["codepuppy_hub_status", { id: "mcp:github" }]] as const) {
    await send("POST", `/api/session/${owner.id}/prompt`, { text: `CP-CALL ${JSON.stringify({ name, args })}` })
    const settled = send("POST", `/api/experimental/session/${owner.id}/wait`)
    for (let i = 0; i < 200; i++) {
      if (await Promise.race([settled.then(() => true), Bun.sleep(40).then(() => false)])) break
      for (const request of ((await send("GET", `/api/session/${owner.id}/permission`)).json?.data ?? []) as Array<{ id: string; action: string }>) {
        asked.push(request.action)
        await send("POST", `/api/session/${owner.id}/permission/${request.id}/reply`, { decision: "reject" })
      }
    }
    await settled
  }
  const messages = ((await send("GET", `/api/session/${owner.id}/message?order=asc&limit=200`)).json?.data ?? []) as Array<{ content?: Array<Record<string, any>> }>
  const display = (name: string) => messages.flatMap((message) => message.content ?? []).find((item) => item.type === "tool" && item.name === name)?.state?.metadata?.codepuppyDisplay
  return { asked, search: display("codepuppy_hub_search"), status: display("codepuppy_hub_status") }
}

describe("助手的只读查找 / 状态:出货形态的身份 + 上一版留下的始终允许记录(绑定摘要不同),三档都不弹卡", () => {
  test("核验过的身份:来源是 ext、授权 codepuppy-bundled、当前绑定摘要非空;带着摘要不同的 enabled 记录,三档都照常执行、零询问;用户设成询问照旧问", async () => {
    // 空策略文档先跑一遍,从活的步骤里取身份(不手拼 canonical)
    const first = await lookups("build")
    expect(first.asked).toEqual([])
    for (const display of [first.search, first.status]) {
      expect(display?.identity?.source).toBe("plugin")
      expect(String(display?.identity?.origin).length, "ext 没被清单核验(来源为空)—— 本次测量作废").toBeGreaterThan(0)
      expect(display?.authority?.kind).toBe("codepuppy-bundled")
      expect(String(display?.authority?.evidenceDigest)).toMatch(/^sha256:[0-9a-f]{64}$/)
    }
    const selectors = [first.search, first.status].map((display) => ({ level: "tool", canonical: canonicalToolIdentity(display.identity) }) as const)
    const stale = `sha256:${"0".repeat(64)}`
    expect(stale).not.toBe(first.status.authority.evidenceDigest)
    for (const selector of selectors) await store!.setRecord({ selector, state: "enabled", bindingDigest: stale } as never)
    try {
      for (const tier of TIERS) {
        const before = { search: sent("codepuppy.sources.search.request"), view: sent("codepuppy.hub.view.request") }
        const round = await lookups(tier)
        expect([tier, round.asked]).toEqual([tier, []])
        expect([tier, sent("codepuppy.sources.search.request") - before.search, sent("codepuppy.hub.view.request") - before.view]).toEqual([tier, 1, 1])
      }
      // 用户自己的选择照旧胜出:状态设成「每次询问」⇒ 请求审批档问的就是它
      await store!.setRecord({ selector: selectors[1]!, state: "ask" } as never)
      const explicit = await lookups("codepuppy-ask")
      expect(explicit.asked).toEqual([selectors[1]!.canonical])
    } finally {
      for (const selector of selectors) await store!.removeRecord(selector as never)
    }
  }, 120_000)
})
