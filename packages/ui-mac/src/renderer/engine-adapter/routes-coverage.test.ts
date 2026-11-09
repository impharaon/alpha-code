// `#1668`:路由覆盖 —— 冻结界面里每个打引擎的调用,都必须在适配器路由表里有 handler,或者在 UNSUPPORTED 里写明
// 为什么不接。表外的请求在运行时是 501;这一条把「表外」在编译期之前就找出来。
//
// 扫描法(方案附件 §A 落成测试):在冻结 app、冻结 session-ui 与 renderer 的非测试源码里找「接收者.域.方法(」
// 形状的调用;接收者段是 `api` ⇒ 1.17.13 客户端,是 `client` / `legacy` / `sdk` / `c` / `eventSdk` / `sdkFor` ⇒ v1 SDK。
// 方法 → HTTP 路由取自**生产包本身**:v1 SDK 解析 codepuppy-sdk-v1 的 sdk.gen.ts(类、getter、每个方法的 url 与动词),
// 1.17.13 客户端解析装着的 dist/promise/generated/client.js 的请求描述。扫出的每条路由按 matchRoute 查表。
//
// 诚实边界:这是正则,不是类型分析 —— 经别名变量的调用会漏(方案附件 §A 已记);第二道核对是运行时的 501 日志。
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { matchRoute } from "./index"
import { UNSUPPORTED } from "./routes"

const PACKAGES = resolve(import.meta.dir, "../../../..")

type Descriptor = [verb: string, path: string]

function v1Routes() {
  const source = readFileSync(join(PACKAGES, "codepuppy-sdk-v1/src/v2/gen/sdk.gen.ts"), "utf8")
  const classes = new Map<string, { methods: Map<string, Descriptor>; getters: Map<string, string> }>()
  let current: string | undefined
  let method: string | undefined
  let verb: string | undefined
  for (const line of source.split("\n")) {
    let match: RegExpExecArray | null
    if ((match = /^export class (\w+) extends HeyApiClient/.exec(line))) {
      current = match[1]!
      classes.set(current, { methods: new Map(), getters: new Map() })
      continue
    }
    if (!current) continue
    if ((match = /^ {2}get (\w+)\(\): (\w+) \{/.exec(line))) classes.get(current)!.getters.set(match[1]!, match[2]!)
    else if ((match = /^ {2}public (\w+)</.exec(line))) {
      method = match[1]
      verb = undefined
    } else if (method && (match = /this\.client\)\.(sse\.)?(get|post|put|patch|delete)</.exec(line))) verb = match[2]!.toUpperCase()
    else if (method && verb && (match = /^\s+url: "([^"]+)"/.exec(line))) {
      classes.get(current)!.methods.set(method, [verb, match[1]!])
      method = undefined
    }
  }
  const table = new Map<string, Descriptor>()
  const walk = (name: string, prefix: string[], seen: Set<string>) => {
    const entry = classes.get(name)
    if (!entry || seen.has(name)) return
    for (const [key, descriptor] of entry.methods) table.set([...prefix, key].join("."), descriptor)
    for (const [getter, type] of entry.getters) walk(type, [...prefix, getter], new Set([...seen, name]))
  }
  walk("OpencodeClient", [], new Set())
  return table
}

function legacyClientRoutes() {
  const source = readFileSync(
    join(PACKAGES, "codepuppy-app/node_modules/@opencode-ai/client/dist/promise/generated/client.js"),
    "utf8",
  )
  const table = new Map<string, Descriptor>()
  const stack: Array<[number, string]> = []
  let pending: string | undefined
  let verb: string | undefined
  for (const line of source.split("\n")) {
    let match: RegExpExecArray | null
    if ((match = /^(\s*)(\w+): \{$/.exec(line))) {
      stack.push([match[1]!.length, match[2]!])
      continue
    }
    if ((match = /^(\s*)\},?$/.exec(line)) && stack.length && stack.at(-1)![0] === match[1]!.length) {
      stack.pop()
      continue
    }
    if ((match = /^(\s*)(\w+): \((?:input|requestOptions)/.exec(line))) pending = [...stack.map((item) => item[1]), match[2]!].join(".")
    if (!pending) continue
    const verbMatch = /method: "(\w+)"/.exec(line)
    if (verbMatch) verb = verbMatch[1]
    const pathMatch = /path: `([^`]+)`/.exec(line)
    if (pathMatch && verb) {
      table.set(pending, [verb, pathMatch[1]!.replace(/\$\{[^}]+\}/g, "{p}")])
      pending = undefined
      verb = undefined
    }
  }
  return table
}

const V1 = v1Routes()
const LEGACY = legacyClientRoutes()
const V1_RECEIVERS = new Set(["client", "legacy", "sdk", "c", "eventSdk", "sdkFor"])

export type EngineCall = { client: "v1" | "1.17.13"; method: string; verb: string; path: string; site: string }

/** 在一段源码里扫出打引擎的调用。 */
export function scanEngineCalls(text: string, file: string): EngineCall[] {
  const calls: EngineCall[] = []
  for (const match of text.matchAll(/((?:[A-Za-z_$][\w$]*(?:\([^()]*\))?\.)+[A-Za-z_$][\w$]*)\(/g)) {
    const segments = match[1]!.split(".").map((segment) => segment.replace(/\(.*$/, ""))
    for (let receiver = 0; receiver < segments.length - 2; receiver++) {
      const name = segments[receiver]!
      const client = name === "api" ? "1.17.13" : V1_RECEIVERS.has(name) ? "v1" : undefined
      if (!client) continue
      const table = client === "v1" ? V1 : LEGACY
      const rest = segments.slice(receiver + 1)
      let hit: [string, Descriptor] | undefined
      for (let length = rest.length; length >= 2 && !hit; length--) {
        const key = rest.slice(0, length).join(".")
        const descriptor = table.get(key)
        if (descriptor) hit = [key, descriptor]
      }
      if (!hit) continue
      const line = text.slice(0, match.index).split("\n").length
      calls.push({ client, method: hit[0], verb: hit[1][0], path: hit[1][1], site: `${file}:${line}` })
      break
    }
  }
  return calls
}

function sourceFiles() {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        // engine-adapter 自己是 2.x 一侧的调用方(`context.api` = 2.x 客户端),不是冻结界面的引擎调用。
        if (!["test", "e2e", "node_modules", "fixtures", "engine-adapter"].includes(name)) walk(path)
        continue
      }
      if (!/\.(ts|tsx)$/.test(name) || /\.test\.|test-runtime|\.cases\.ts$|-stub\.ts$/.test(name)) continue
      files.push(path)
    }
  }
  for (const dir of ["codepuppy-app/src", "codepuppy-session-ui/src", "ui-mac/src/renderer"]) walk(join(PACKAGES, dir))
  return files
}

/** 路由模板 `{x}` → 一个样例值,交给 matchRoute 判。 */
const concrete = (path: string) => path.replace(/\{[^}]+\}/g, "x")
const unsupportedMatch = (verb: string, path: string) =>
  UNSUPPORTED.find((entry) => {
    if (entry.method !== verb) return false
    const a = entry.path.split("/")
    const b = path.split("/")
    return a.length === b.length && a.every((segment, index) => segment.startsWith(":") || segment === b[index])
  })

export function uncovered(calls: readonly EngineCall[]) {
  return calls.filter((call) => !matchRoute(call.verb, concrete(call.path)) && !unsupportedMatch(call.verb, concrete(call.path)))
}

const CALLS = sourceFiles().flatMap((file) => scanEngineCalls(readFileSync(file, "utf8"), file.replace(`${PACKAGES}/`, "")))

describe("#1668 适配器路由覆盖", () => {
  test("解析自检:两张客户端描述表与扫描结果都不是空的(否则下面一条会空对空地绿)", () => {
    expect(V1.get("session.promptAsync")).toEqual(["POST", "/session/{sessionID}/prompt_async"])
    expect(V1.get("global.event")).toEqual(["GET", "/global/event"])
    expect(LEGACY.get("project.current")).toEqual(["GET", "/api/project/current"])
    const v1Methods = new Set(CALLS.filter((call) => call.client === "v1").map((call) => call.method))
    const legacyMethods = new Set(CALLS.filter((call) => call.client === "1.17.13").map((call) => call.method))
    // 2026-11-09 实测 68 / 28;下限只防扫描退化。
    expect(v1Methods.size).toBeGreaterThanOrEqual(60)
    expect(legacyMethods.size).toBeGreaterThanOrEqual(20)
  })

  test("冻结界面扫出的每个引擎调用都在路由表或 UNSUPPORTED 里", () => {
    const missing = uncovered(CALLS).map((call) => `${call.client} ${call.method} ${call.verb} ${call.path} <- ${call.site}`)
    expect(missing).toEqual([])
  })

  test("UNSUPPORTED 每条都有理由,且与路由表不重叠(一条请求不能既接又不接)", () => {
    for (const entry of UNSUPPORTED) {
      expect(entry.reason.length, `${entry.method} ${entry.path} 没写理由`).toBeGreaterThan(10)
      expect(matchRoute(entry.method, entry.path.replace(/:[^/]+/g, "x")), `${entry.method} ${entry.path} 同时在路由表里`).toBeUndefined()
    }
  })

  test("反向臂:源码里多一个表外调用 ⇒ 被扫出并点名", () => {
    const fixture = 'async function f(client) { await client.experimental.workspace.list() }\n'
    const calls = scanEngineCalls(fixture, "fixture.ts")
    expect(calls.map((call) => call.method)).toEqual(["experimental.workspace.list"])
    expect(uncovered(calls).map((call) => call.site)).toEqual(["fixture.ts:1"])
  })
})
