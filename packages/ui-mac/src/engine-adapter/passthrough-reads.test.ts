// `#1697`(I-04 M5b,设计 §4.3 规则 5、§4.10 d、R11):翻译器原样转发的路由(直通),编译期管不到响应体 —— 在真引擎样本上核
// 两件事:应答状态码等于发出它的冻结客户端声明的成功码(1.17.13 客户端取请求描述里的 `successStatus`,它不等就抛错;v1 SDK
// 取 2xx,P-09);响应带着约定 `READS` 为这条路由登记的每个消费字段,或交登记的冻结消费函数(只在测试里 import)得到消费方要的
// 结果。样本 = 采样器 `passthrough` 剧本:每条直通经冻结界面自己的客户端、照冻结发出点的调用形状实调一次(fixtures/passthrough.json)。
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { normalizeSessionInfo } from "../../../codepuppy-app/src/utils/session"
import { READS, SERVED, type ReadSet } from "./contract/routes"
import sample from "./fixtures/passthrough.json"
import { passthrough, ROUTES } from "./opencode2/routes"

const PACKAGES = resolve(import.meta.dir, "../../..")
type Exchange = { request: string; status: number; body: unknown }
const EXCHANGES = sample.exchanges as Record<string, Exchange>

/** 1.17.13 客户端的请求描述:「动词 路径(参数为 {p})」→ successStatus。 */
const LEGACY_SUCCESS = (() => {
  const source = readFileSync(join(PACKAGES, "codepuppy-app/node_modules/@opencode-ai/client/dist/promise/generated/client.js"), "utf8")
  const table = new Map<string, number>()
  // 每个请求描述依次是 method、path,再往后的第一个 successStatus(中间可能夹着 body / query 对象)
  let verb: string | undefined
  let path: string | undefined
  for (const line of source.split("\n")) {
    const method = /method: "(\w+)"/.exec(line)
    if (method) [verb, path] = [method[1], undefined]
    const found = /path: `([^`]+)`/.exec(line)
    if (found && verb) path = found[1]!.replace(/\$\{[^}]+\}/g, "{p}")
    const status = /successStatus: (\d+)/.exec(line)
    if (status && verb && path) {
      table.set(`${verb} ${path}`, Number(status[1]))
      verb = path = undefined
    }
  }
  return table
})()
/** v1 SDK 声明过的「动词 路径」。 */
const V1_ROUTES = (() => {
  const source = readFileSync(join(PACKAGES, "codepuppy-sdk-v1/src/v2/gen/sdk.gen.ts"), "utf8")
  const set = new Set<string>()
  for (const match of source.matchAll(/\.(get|post|put|patch|delete)<\s*\w+Responses,[^>]*>\(\{\s*url: "([^"]+)"/g))
    set.add(`${match[1]!.toUpperCase()} ${match[2]!.replace(/\{[^}]+\}/g, "{p}")}`)
  return set
})()
const asDescriptor = (key: string) => key.replace(/:[A-Za-z]+/g, "{p}")

/** 发出这条路由的冻结客户端声明的成功码;两个客户端都发的,两边都要满足。 */
function successOf(key: string) {
  const legacy = LEGACY_SUCCESS.get(asDescriptor(key))
  const v1 = V1_ROUTES.has(asDescriptor(key))
  return { legacy, v1, ok: (status: number) => (legacy === undefined || status === legacy) && (!v1 || (status >= 200 && status < 300)) }
}

/** 路径在响应体里取值:`data[].id` 对数组每一项、`data.*.type` 对对象每个值;交回每个落点的值(缺 = undefined)。 */
function valuesAt(body: unknown, path: string): unknown[] {
  let current: unknown[] = [body]
  for (const segment of path.replace(/\?$/, "").split(".")) {
    const next: unknown[] = []
    const array = segment.endsWith("[]")
    const name = array ? segment.slice(0, -2) : segment
    for (const value of current) {
      if (name === "*") {
        if (value && typeof value === "object") next.push(...Object.values(value))
        continue
      }
      const field = value && typeof value === "object" ? (value as Record<string, unknown>)[name] : undefined
      if (array) {
        if (Array.isArray(field)) next.push(...field)
        else next.push(undefined)
      } else next.push(field)
    }
    current = next
  }
  return current
}

/** 一条直通的样本对不上 READS 的地方(空 = 对上);数组 / 对象路径要求样本里至少有一个落点,否则核不到。 */
export function readProblems(key: string, reads: ReadSet, body: unknown): string[] {
  if ("consumer" in reads) {
    const items = reads.at === "data[]" ? valuesAt(body, "data[]") : valuesAt(body, "data")
    if (!items.length || items.some((item) => item === undefined)) return [`${key}: ${reads.at} 没有可交给 ${reads.consumer} 的值`]
    return items.flatMap((item) => {
      const session = normalizeSessionInfo(item as never)
      return session.id && session.directory && session.title && session.time ? [] : [`${key}: ${reads.consumer} 交不出 id / directory / title / time`]
    })
  }
  return reads.fields.flatMap((path) => {
    const values = valuesAt(body, path)
    if (!values.length) return [`${key}: ${path} 在样本里没有落点`]
    return path.endsWith("?") || values.every((value) => value !== undefined) ? [] : [`${key}: 缺 ${path}`]
  })
}

/**
 * 待设计裁决的两条(回报编排器:BLOCKED: design — §4.10 d / R1):冻结界面只在 v2 协议下经 1.17.13 客户端发它们,协议恒为 v1(UC-01)
 * 时 createCompatibleApi 把它们改写成 v1 路由(codepuppy-app/src/utils/server-compat.ts createV1Api 的 interrupt / command),Code Puppy
 * 运行时不发;真引擎对冻结客户端的形状答不上。这里只断言「它们确实还对不上」—— 设计改了(挪进不支持 / 改为翻译)就要从这里删掉。
 */
const PENDING_DESIGN: Record<string, string> = {
  "POST /api/session/:sessionID/interrupt": "引擎回 200 {interrupted},1.17.13 客户端声明 204,冻结客户端抛 UnexpectedStatus",
  "POST /api/session/:sessionID/command": "1.17.13 客户端发 {command, arguments…},引擎要 {name, text}:400 InvalidRequestError Missing key name",
}

const PASSTHROUGH_KEYS = Object.entries(ROUTES)
  .filter(([, handler]) => handler === passthrough)
  .map(([key]) => key)
  .sort()

describe("#1697 直通路由的状态码与消费字段(设计 §4.10 d)", () => {
  test("自检:READS 恰好覆盖翻译器里每条直通(多一条、少一条都红);每条直通都有样本;成功码表解析出来了", () => {
    expect(Object.keys(READS).sort()).toEqual(PASSTHROUGH_KEYS)
    expect(PASSTHROUGH_KEYS.length).toBeGreaterThanOrEqual(26)
    expect(PASSTHROUGH_KEYS.filter((key) => !(key in EXCHANGES))).toEqual([])
    for (const key of PASSTHROUGH_KEYS) expect(key in SERVED).toBe(true)
    expect(LEGACY_SUCCESS.get("GET /api/session/{p}")).toBe(200)
    expect(LEGACY_SUCCESS.get("POST /api/session/{p}/interrupt")).toBe(204)
    expect(V1_ROUTES.has("GET /api/agent")).toBe(true)
  })

  test("每条直通:状态码 == 发出它的冻结客户端声明的成功码(待设计裁决的两条除外)", () => {
    const wrong = PASSTHROUGH_KEYS.filter((key) => !(key in PENDING_DESIGN)).flatMap((key) => {
      const { ok, legacy, v1 } = successOf(key)
      if (legacy === undefined && !v1) return [`${key}: 两个冻结客户端都没有声明它`]
      return ok(EXCHANGES[key]!.status) ? [] : [`${key}: ${EXCHANGES[key]!.status},声明 ${legacy ?? "2xx"}`]
    })
    expect(wrong).toEqual([])
  })

  test("每条直通:READS 登记的消费字段都在样本里,或冻结消费函数得到消费方要的结果", () => {
    const problems = PASSTHROUGH_KEYS.filter((key) => !(key in PENDING_DESIGN)).flatMap((key) =>
      readProblems(key, READS[key as keyof typeof READS] as ReadSet, EXCHANGES[key]!.body),
    )
    expect(problems).toEqual([])
  })

  test("待设计裁决的两条确实还对不上(改了约定就从 PENDING_DESIGN 删掉,这条会提醒)", () => {
    for (const key of Object.keys(PENDING_DESIGN)) {
      expect(PASSTHROUGH_KEYS).toContain(key)
      const { ok } = successOf(key)
      expect(ok(EXCHANGES[key]!.status)).toBe(false)
    }
  })

  test("已知坏例:从 GET /api/agent 样本删掉 mode ⇒ 红(设计 §4.10 d 点名);状态码换成 500 ⇒ 红;消费函数拿不到会话 ⇒ 红", () => {
    const agent = structuredClone(EXCHANGES["GET /api/agent"]!.body) as { data: Array<Record<string, unknown>> }
    delete agent.data[0]!.mode
    expect(readProblems("GET /api/agent", READS["GET /api/agent"], agent)).toEqual(["GET /api/agent: 缺 data[].mode"])
    expect(successOf("GET /api/agent").ok(500)).toBe(false)
    expect(successOf("GET /api/session/:sessionID").ok(204)).toBe(false)
    expect(readProblems("GET /api/session/:sessionID", READS["GET /api/session/:sessionID"], { data: undefined })).toHaveLength(1)
    expect(readProblems("GET /api/reference", READS["GET /api/reference"], { data: [] })).toEqual([
      "GET /api/reference: data[].name 在样本里没有落点",
      "GET /api/reference: data[].path 在样本里没有落点",
      "GET /api/reference: data[].hidden? 在样本里没有落点",
      "GET /api/reference: data[].description? 在样本里没有落点",
      "GET /api/reference: data[].source.type 在样本里没有落点",
    ])
  })
})
