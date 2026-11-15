// `#1697`(I-04 M2a,设计 §4.3、§6 K2、§9 M2、R6):除下列有意差异外,自有代际转换与冻结原件逐个相等。
//
// 迁移之前,翻译器借 `as never` 把 2.x 的值喂给冻结 app 的归一函数(codepuppy-app/src/utils/session-message.ts、
// context/global-sync/utils.ts)。那些原件只在冻结 app 的 v2 支路里调用、保持逐字不变,在这里(只在测试里 import)当作
// 独立的旧行为基准:输入全部是真 2.x 引擎采样(fixtures/*.json 的 `_source`),除点名差异外两边结果必须相等。
// 例外:provider 的 deprecated 模型在冻结 v1 分支归一后比较(设计 §9 M2);无 policy 的审批能力名按 Code Puppy 卡片
// 约定 subagent → task、shell → bash,其余字段仍与冻结函数相等;有 policy 的身份动作不换名。
import { describe, expect, test } from "bun:test"
import { normalizeSessionInfo } from "../../../codepuppy-app/src/utils/session"
import { normalizeSessionMessages } from "../../../codepuppy-app/src/utils/session-message"
import {
  normalizeAgentList,
  normalizePermissionRequest,
  normalizeProviderList,
} from "../../../codepuppy-app/src/context/global-sync/utils"
import catalog from "./fixtures/catalog.json"
import command from "./fixtures/command.json"
import continued from "./fixtures/continue.json"
import files from "./fixtures/files.json"
import lineage from "./fixtures/lineage.json"
import parity from "./fixtures/parity.json"
import permissionAsked from "./fixtures/permission-asked.json"
import permissionReply from "./fixtures/permission-reply.json"
import approvalActions from "./fixtures/approval-actions.json"
import question from "./fixtures/question.json"
import readTool from "./fixtures/read-tool.json"
import todo from "./fixtures/todo.json"
import tools from "./fixtures/tools.json"
import turnDiff from "./fixtures/turn-diff.json"
import { createEngineFetch } from "./index"
import { projectSessionMessages } from "./opencode2/messages"
import { toV1Agents, toV1PermissionRequest, toV1ProviderList } from "./opencode2/v1-shapes"

type Sample = { name: string; sessionID: string; messages: any[] }
type Records = ReadonlyArray<{ snapshot?: { data: any[] } }>

/** 全部夹具里的每个消息数组:收尾时的整段(升序)与每一帧之后的那一页(降序页,转成投影收到的升序)。 */
function messageSamples(): Sample[] {
  const out: Sample[] = []
  const add = (name: string, sessionID: string, final: any[] | undefined, records?: Records) => {
    if (final) out.push({ name: `${name}.final`, sessionID, messages: final })
    records?.forEach((record, index) => {
      if (record.snapshot?.data.length) out.push({ name: `${name}.records[${index}]`, sessionID, messages: [...record.snapshot.data].reverse() })
    })
  }
  for (const [name, fixture] of Object.entries({ readTool, todo, question, turnDiff, continued, command, files, lineage } as Record<string, any>))
    add(name, fixture.sessionID, fixture.final, fixture.records)
  add("continued.legacy", continued.legacy.sessionID, continued.legacy.final)
  for (const [name, entry] of Object.entries(tools.sessions as Record<string, any>)) add(`tools.${name}`, entry.sessionID, entry.final, entry.records)
  for (const name of ["dir", "shell", "background"] as const) add(`parity.${name}`, parity[name].sessionID, parity[name].final, (parity[name] as any).records)
  return out
}

const SAMPLES = messageSamples()

describe("#1697 自有投影与冻结基准(真 2.x 采样,有意差异明列)", () => {
  test("自检:样本覆盖消息投影的每一支(用户 / 助手 / 切档位 / 切模型 / 带说明的 synthetic / shell / 压缩)", () => {
    const types = new Set(SAMPLES.flatMap((sample) => sample.messages.map((message) => message.type)))
    for (const type of ["user", "assistant", "agent-switched", "model-switched", "synthetic", "shell", "compaction"]) expect(types).toContain(type)
    expect(SAMPLES.some((sample) => sample.messages.some((message) => message.type === "synthetic" && message.description?.trim()))).toBe(true)
    expect(SAMPLES.length).toBeGreaterThanOrEqual(250) // 2026-11-12 实测 267;下限只防样本收集退化
  })

  test("消息:每个消息数组上,自有投影与冻结 normalizeSessionMessages 的消息与 part 逐个相等", () => {
    const mismatched = SAMPLES.filter((sample) => {
      const own = projectSessionMessages(sample.sessionID, sample.messages)
      const frozen = normalizeSessionMessages(sample.sessionID, sample.messages as never)
      return !Bun.deepEquals(own, frozen)
    }).map((sample) => sample.name)
    expect(mismatched).toEqual([])
  })

  test("消息,反向臂:同一个样本改掉引擎写的一个字段,两边都跟着变(比较不是空对空)", () => {
    const sample = SAMPLES.find((item) => item.name === "lineage.final")!
    const changed = sample.messages.map((message) => (message.type === "shell" ? { ...message, command: "echo changed" } : message))
    const before = projectSessionMessages(sample.sessionID, sample.messages)
    const after = projectSessionMessages(sample.sessionID, changed)
    expect(Bun.deepEquals(before, after)).toBe(false)
    expect(Bun.deepEquals(after, normalizeSessionMessages(sample.sessionID, changed as never))).toBe(true)
  })

  test("agent:catalog.json 的 GET /api/agent,自有转换与冻结 normalizeAgentList 逐个相等", () => {
    expect(catalog.agents.data.length).toBeGreaterThan(3)
    expect(toV1Agents(catalog.agents.data as never)).toEqual(normalizeAgentList(catalog.agents.data as never))
  })

  test("审批 read 样本:permission.asked 帧与 GET /api/permission/request 列表,自有转换与 #1668 的「冻结函数 + 补 source.id」逐个相等", () => {
    const requests = [permissionAsked.frame.data, ...permissionAsked.list.data, ...permissionReply.pendingA.body.data, ...permissionReply.pendingB.body.data]
    expect(requests.length).toBeGreaterThan(3)
    for (const request of requests as any[]) {
      const source = request.source?.type === "tool" ? { ...request.source, callID: request.source.id } : request.source
      expect(toV1PermissionRequest(request)).toEqual(normalizePermissionRequest({ ...request, source } as never))
    }
  })

  // 输入来自真引擎创建/读取审批的公开 API,来源记在夹具 _source;两个能力动作的期望来自 Code Puppy 命令/委派卡。
  // 只给冻结基准的 permission 指定这个有意差异,不拿翻译器的输出构造期望。
  test.each([
    { name: "shell", permission: "bash" },
    { name: "subagent", permission: "task" },
    { name: "policy", permission: "shell" },
  ])("审批动作样本 $name:只应用约定的能力换名,其余字段与冻结函数相同", ({ name, permission }) => {
    const request = approvalActions.cases.find((sample) => sample.name === name)!.request
    expect(request.action).toBe(name === "policy" ? "shell" : name)
    expect("metadata" in request ? request.metadata.policy : undefined).toEqual(name === "policy" ? { canonical: "shell", askedBy: "policy" } : undefined)
    const frozen = normalizePermissionRequest(request as never)
    expect(frozen.permission).toBe(request.action)
    expect(toV1PermissionRequest(request as never)).toEqual({ ...frozen, permission })
  })

  // 2.x 的 provider 配置不收模型 status(采样器 catalog 剧本的 _source),沙箱里采不到 deprecated 模型:这里把真样本里
  // opencode 的第一个模型改成 deprecated(派生输入)—— 它本来会被选成 opencode 的默认模型。
  const providers = catalog.providers.data as any[]
  const models = catalog.models.data as any[]
  const defaultModel = catalog.defaultModel.data as any
  const firstOpencode = models.findIndex((model) => model.providerID === "opencode")
  const withDeprecated = models.map((model, index) => (index === firstOpencode ? { ...model, status: "deprecated" } : model))
  const legacyShape = (value: ReturnType<typeof normalizeProviderList>) => {
    const { defaultModel: _dropped, ...rest } = value as typeof value & { defaultModel?: unknown }
    return rest
  }

  test("provider(设计 §9 M2 的例外):HTTP 输出保留 deprecated 模型及其 status,默认模型跳过它", () => {
    expect(firstOpencode).toBeGreaterThanOrEqual(0)
    const output = toV1ProviderList(providers, withDeprecated, defaultModel)
    const deprecated = withDeprecated[firstOpencode]
    expect(output.all.find((provider) => provider.id === "opencode")!.models[deprecated.id]!.status).toBe("deprecated")
    expect(output.default.opencode).not.toBe(deprecated.id)
    expect(output.default.opencode).toBe(models.find((model, index) => index !== firstOpencode && model.providerID === "opencode")!.id)
  })

  test("provider:交冻结 v1 分支归一之后,与冻结三参分支对同一样本的结果相等(原样本与带 deprecated 的派生样本)", () => {
    for (const sample of [models, withDeprecated]) {
      const own = normalizeProviderList(toV1ProviderList(providers, sample, defaultModel))
      expect(own).toEqual(legacyShape(normalizeProviderList(providers, sample, defaultModel)) as never)
    }
  })

  test("provider 经真入口:createEngineFetch 的 GET /provider 回的就是这份转换(deprecated 模型在 HTTP 输出里)", async () => {
    const ENGINE = "http://127.0.0.1:47061"
    const engineFetch = createEngineFetch({
      isEngineOrigin: (origin) => origin === ENGINE,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(new Request(input, init).url).pathname
        if (path === "/api/provider") return Response.json(catalog.providers)
        if (path === "/api/model") return Response.json({ ...catalog.models, data: withDeprecated })
        if (path === "/api/model/default") return Response.json(catalog.defaultModel)
        return new Response("unexpected", { status: 500 })
      }) as typeof globalThis.fetch,
    })
    const response = await engineFetch(`${ENGINE}/provider?directory=${encodeURIComponent(catalog.directory)}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(JSON.parse(JSON.stringify(toV1ProviderList(providers, withDeprecated, defaultModel))))
  })

  test("会话标题(设计 §4.3 规则 3):没有标题的会话,经 GET /session 与经 /api/session 直通再交冻结 normalizeSessionInfo,标题相同", async () => {
    const ENGINE = "http://127.0.0.1:47062"
    const engineFetch = createEngineFetch({
      isEngineOrigin: (origin) => origin === ENGINE,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(new Request(input, init).url).pathname
        if (path === "/api/session") return Response.json(catalog.sessions)
        return new Response("unexpected", { status: 500 })
      }) as typeof globalThis.fetch,
    })
    const raw = catalog.sessions.data.find((session) => session.id === catalog.freshSessionID)!
    expect((raw as { title?: string }).title).toBeUndefined()
    const translated = (await (await engineFetch(`${ENGINE}/session?directory=${encodeURIComponent(catalog.directory)}`)).json()) as any[]
    const passthrough = (await (await engineFetch(`${ENGINE}/api/session?directory=${encodeURIComponent(catalog.directory)}`)).json()) as { data: any[] }
    const viaFrozen = passthrough.data.map((session) => normalizeSessionInfo(session))
    expect(translated.map((session) => session.title)).toEqual(viaFrozen.map((session) => session.title))
    expect(translated.find((session) => session.id === raw.id).title).toMatch(/^New session - \d{4}-/)
  })
})
