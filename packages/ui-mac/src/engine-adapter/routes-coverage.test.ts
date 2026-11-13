// `#1668`:路由覆盖 —— 冻结界面里每个打引擎的调用,都必须在适配器路由表里有 handler,或者在 UNSUPPORTED 里写明
// 为什么不接。表外的请求在运行时是 501;这一条把「表外」在编译期之前就找出来。
// `#1697`(I-04,设计 §4.10 a):判的是 Code Puppy 自有的约定路由目录(contract/routes.ts)—— 每个扫出的调用都必须命中
// SERVED、UNSUPPORTED 或 PROBE_FALLBACK;来自 ui-mac/src/renderer 的调用必须命中 SERVED(Code Puppy 自己的界面不许发
// 声明不支持或探活回退的请求)。扫描另认三种此前漏掉的调用形式:直接链在客户端构造调用上的调用(跨行、带嵌套括号也算)、
// 绑定到四个构造函数的任意变量、把字面量引擎路径交给 fetch / new URL / 转发给 fetch 的本地函数(probe)的原始请求。
//
// 扫描法(方案附件 §A 落成测试):在冻结 app、冻结 session-ui 与 renderer 的非测试源码里找「接收者.域.方法(」
// 形状的调用;接收者段是 `api` / `eventApi` ⇒ 1.17.13 客户端,是 `client` / `legacy` / `sdk` / `c` / `eventSdk` / `sdkFor` ⇒ v1 SDK。
// 方法 → HTTP 路由取自**生产包本身**:v1 SDK 解析 codepuppy-sdk-v1 的 sdk.gen.ts(类、getter、每个方法的 url 与动词),
// 1.17.13 客户端解析装着的 dist/promise/generated/client.js 的请求描述。扫出的每条路由按 matchRoute 查表。
//
// 诚实边界:这是正则,不是类型分析 —— 经别名变量的调用会漏(方案附件 §A 已记);第二道核对是运行时的 501 日志。
// `#1662`:正则不依赖排版 —— 链里的 `.` 前后可以有空白 / 换行、可以是 `?.`,方法名与 `(` 之间可以有空白,链只在顶层的点上切段
// (实参里的 `a?.b` 不切)。此前只认同一行写完的链,`client.v2.model` 换行 `.list(` 就漏了,GET /api/model 因此既没接也没登记
// (composer 的模型链一直 recovering)。接收者名对应的那张描述表查不到时再查另一张:冻结 app 里叫 `sdk` 的也可能是 1.17.13 客户端
// (global-sync/bootstrap.ts 的 `sdk.model.default`),叫 `api` 的也可能是 createCompatibleApi(按 v1 方法名)。
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { matchProbeFallback, matchServed, matchUnsupported, PROBE_FALLBACK, UNSUPPORTED } from "./contract/routes"

const PACKAGES = resolve(import.meta.dir, "../../..")

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
const LEGACY_RECEIVERS = new Set(["api", "eventApi"])

/** 链按顶层的 `.` / `?.` 切段(括号里的实参不切),每段去掉自己的调用实参与空白。 */
function chainSegments(chain: string) {
  const segments: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < chain.length; index++) {
    const char = chain[index]
    if (char === "(") depth++
    else if (char === ")") depth--
    else if (char === "." && depth === 0) {
      segments.push(chain.slice(start, index))
      start = index + 1
    }
  }
  segments.push(chain.slice(start))
  return segments.map((segment) => segment.replace(/\?$/, "").replace(/\([^]*$/, "").trim())
}

export type EngineCall = { client: "v1" | "1.17.13" | "raw"; method: string; verb: string; path: string; site: string }

/** 四个构造函数:前两个造 1.17.13 客户端,后两个造 v1 SDK(设计 §4.10 a)。 */
const CONSTRUCTORS: Record<string, "v1" | "1.17.13"> = {
  "OpenCode.make": "1.17.13",
  createApiForServer: "1.17.13",
  createSdkForServer: "v1",
  createOpencodeClient: "v1",
}
const CONSTRUCTOR = "(OpenCode\\s*\\.\\s*make|createApiForServer|createSdkForServer|createOpencodeClient)"
/** 转发给 fetch、实参里带字面量引擎路径的本地函数(今天是 utils/server-protocol.ts 的 probe)。 */
const RAW_CALLEES = "(fetch|probe)"

/** `open` 处是 `(`,返回与它配对的 `)` 的下标;跳过字符串、模板字面量与注释。配不上返回 -1。 */
function closingParen(text: string, open: number) {
  let depth = 0
  for (let index = open; index < text.length; index++) {
    const char = text[index]!
    if (char === '"' || char === "'" || char === "`") {
      for (index++; index < text.length && text[index] !== char; index++) if (text[index] === "\\") index++
      continue
    }
    if (char === "/" && text[index + 1] === "/") {
      index = text.indexOf("\n", index)
      if (index < 0) return -1
      continue
    }
    if (char === "/" && text[index + 1] === "*") {
      index = text.indexOf("*/", index)
      if (index < 0) return -1
      continue
    }
    if (char === "(") depth++
    else if (char === ")" && --depth === 0) return index
  }
  return -1
}

/** 方法链(`a.b.c`)→ 描述表里最长能查到的那一段;优先查 `prefer`,查不到再查另一张。 */
function lookup(rest: readonly string[], prefer: "v1" | "1.17.13"): ["v1" | "1.17.13", string, Descriptor] | undefined {
  for (const kind of prefer === "v1" ? (["v1", "1.17.13"] as const) : (["1.17.13", "v1"] as const)) {
    const table = kind === "v1" ? V1 : LEGACY
    for (let length = rest.length; length >= 2; length--) {
      const key = rest.slice(0, length).join(".")
      const descriptor = table.get(key)
      if (descriptor) return [kind, key, descriptor]
    }
  }
  return undefined
}

const lineAt = (text: string, index: number) => text.slice(0, index).split("\n").length

/** 在一段源码里扫出打引擎的调用。 */
export function scanEngineCalls(text: string, file: string): EngineCall[] {
  const calls: EngineCall[] = []
  const push = (call: EngineCall) => {
    if (!calls.some((seen) => seen.site === call.site && seen.verb === call.verb && seen.path === call.path)) calls.push(call)
  }

  // 绑定到构造函数的变量(名字任意):`x = createSdkForServer(…)`,构造调用之后没有接着链方法(接着链的是下面的形式一)。
  const bound = new Map<string, "v1" | "1.17.13">()
  for (const match of text.matchAll(new RegExp(`(?<![\\w$.])([A-Za-z_$][\\w$]*)\\s*=\\s*(?:await\\s+)?${CONSTRUCTOR}\\s*\\(`, "g"))) {
    const close = closingParen(text, match.index + match[0].length - 1)
    if (close < 0 || /^\s*\??\./.test(text.slice(close + 1))) continue
    bound.set(match[1]!, CONSTRUCTORS[match[2]!.replace(/\s+/g, "")]!)
  }

  // 接收者形式:「接收者.域.方法(」。接收者是约定俗成的客户端名,或本文件里绑定到构造函数的变量。
  for (const match of text.matchAll(/((?:[A-Za-z_$][\w$]*(?:\([^()]*\))?\s*\??\.\s*)+[A-Za-z_$][\w$]*)\s*\(/g)) {
    const segments = chainSegments(match[1]!)
    for (let receiver = 0; receiver < segments.length - 2; receiver++) {
      const name = segments[receiver]!
      const client = bound.get(name) ?? (LEGACY_RECEIVERS.has(name) ? "1.17.13" : V1_RECEIVERS.has(name) ? "v1" : undefined)
      if (!client) continue
      const hit = lookup(segments.slice(receiver + 1), client)
      if (!hit) continue
      push({ client: hit[0], method: hit[1], verb: hit[2][0], path: hit[2][1], site: `${file}:${lineAt(text, match.index)}` })
      break
    }
  }

  // 形式一:直接链在构造调用上的调用 `OpenCode.make({…}).health.get(…)`(构造实参跨行、带嵌套括号也算)。
  for (const match of text.matchAll(new RegExp(`(?<![\\w$])${CONSTRUCTOR}\\s*\\(`, "g"))) {
    const close = closingParen(text, match.index + match[0].length - 1)
    if (close < 0) continue
    const chain = /^((?:\s*\??\.\s*[A-Za-z_$][\w$]*)+)\s*\(/.exec(text.slice(close + 1))
    if (!chain) continue
    const rest = chain[1]!.split(".").map((segment) => segment.replace(/\?$/, "").trim()).filter(Boolean)
    const hit = lookup(rest, CONSTRUCTORS[match[1]!.replace(/\s+/g, "")]!)
    if (hit) push({ client: hit[0], method: hit[1], verb: hit[2][0], path: hit[2][1], site: `${file}:${lineAt(text, match.index)}` })
  }

  // 形式三:字面量引擎路径的原始请求 —— `new URL("/…", base)`,以及 fetch / probe 的顶层实参里的 `"/…"`。
  for (const match of text.matchAll(/new\s+URL\s*\(\s*(["'`])(\/[^"'`$]*)\1/g))
    push({ client: "raw", method: "new URL", verb: "GET", path: match[2]!, site: `${file}:${lineAt(text, match.index)}` })
  for (const match of text.matchAll(new RegExp(`(?<![\\w$.])${RAW_CALLEES}\\s*\\(`, "g"))) {
    const open = match.index + match[0].length - 1
    const close = closingParen(text, open)
    if (close < 0) continue
    const args = text.slice(open + 1, close)
    let depth = 0
    let top = ""
    for (const char of args) {
      if (char === "(" || char === "{" || char === "[") depth++
      else if (char === ")" || char === "}" || char === "]") depth--
      else if (depth === 0) top += char
    }
    const literal = /(["'`])(\/[^"'`$]*)\1/.exec(top)
    if (!literal) continue
    const verb = /method:\s*["'`](\w+)["'`]/.exec(args)?.[1]?.toUpperCase() ?? "GET"
    push({ client: "raw", method: match[1]!, verb, path: literal[2]!, site: `${file}:${lineAt(text, match.index)}` })
  }
  return calls
}

function sourceFiles() {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        if (!["test", "e2e", "node_modules"].includes(name)) walk(path)
        continue
      }
      // 测试、测试宿主、替身与 story(只在 storybook 里跑,不进 app)都不是会经 engineFetch 发出的代码。
      if (!/\.(ts|tsx)$/.test(name) || /\.test\.|test-runtime|\.cases\.ts$|-stub\.ts$|\.stories\./.test(name)) continue
      files.push(path)
    }
  }
  for (const dir of ["codepuppy-app/src", "codepuppy-session-ui/src", "ui-mac/src/renderer"]) walk(join(PACKAGES, dir))
  return files
}

/** 路由模板 `{x}` → 一个样例值,交给约定目录的匹配判。 */
const concrete = (path: string) => path.replace(/\{[^}]+\}/g, "x")

/** 三张表都不命中的调用(运行时会是 501 + console.error 的那些)。 */
export function uncovered(calls: readonly EngineCall[]) {
  return calls.filter((call) => {
    const path = concrete(call.path)
    return !matchServed(call.verb, path) && !matchUnsupported(call.verb, path) && !matchProbeFallback(call.verb, path)
  })
}

/** Code Puppy 自己的界面(ui-mac/src/renderer)发出、却不在 SERVED 里的调用:声明不支持与探活回退对 renderer 不算覆盖。 */
export function rendererOutsideServed(calls: readonly EngineCall[]) {
  return calls.filter((call) => call.site.startsWith("ui-mac/src/renderer/") && !matchServed(call.verb, concrete(call.path)))
}

const CALLS = sourceFiles().flatMap((file) => scanEngineCalls(readFileSync(file, "utf8"), file.replace(`${PACKAGES}/`, "")))

describe("#1668 适配器路由覆盖", () => {
  test("解析自检:两张客户端描述表与扫描结果都不是空的(否则下面一条会空对空地绿)", () => {
    expect(V1.get("session.promptAsync")).toEqual(["POST", "/session/{sessionID}/prompt_async"])
    expect(V1.get("global.event")).toEqual(["GET", "/global/event"])
    expect(LEGACY.get("project.current")).toEqual(["GET", "/api/project/current"])
    const v1Methods = new Set(CALLS.filter((call) => call.client === "v1").map((call) => call.method))
    const legacyMethods = new Set(CALLS.filter((call) => call.client === "1.17.13").map((call) => call.method))
    // 2026-11-09 实测 68 / 28(2026-11-12 扫描改成不依赖排版后 77 / 36);下限只防扫描退化。
    expect(v1Methods.size).toBeGreaterThanOrEqual(60)
    expect(legacyMethods.size).toBeGreaterThanOrEqual(20)
  })

  test("冻结界面与 renderer 扫出的每个引擎调用都在约定的 SERVED / UNSUPPORTED / PROBE_FALLBACK 里", () => {
    const missing = uncovered(CALLS).map((call) => `${call.client} ${call.method} ${call.verb} ${call.path} <- ${call.site}`)
    expect(missing).toEqual([])
  })

  test("renderer 扫出的每个调用都在 SERVED 里(声明不支持与探活回退对 Code Puppy 自己的界面不算覆盖)", () => {
    const outside = rendererOutsideServed(CALLS).map((call) => `${call.client} ${call.method} ${call.verb} ${call.path} <- ${call.site}`)
    expect(outside).toEqual([])
  })

  test("UNSUPPORTED、PROBE_FALLBACK 每条都有理由,三张表互不重叠(一条请求不能既服务又不服务)", () => {
    const declared = [...Object.entries(UNSUPPORTED), ...Object.entries(PROBE_FALLBACK)]
    for (const [key, reason] of declared) {
      const [method, path] = key.split(" ") as [string, string]
      const sample = path.replace(/:[^/]+/g, "x")
      expect(reason.length, `${key} 没写理由`).toBeGreaterThan(10)
      expect(matchServed(method, sample), `${key} 同时在 SERVED 里`).toBeUndefined()
    }
    for (const key of Object.keys(PROBE_FALLBACK)) {
      const [method, path] = key.split(" ") as [string, string]
      expect(matchUnsupported(method, path.replace(/:[^/]+/g, "x")), `${key} 同时在 UNSUPPORTED 里`).toBeUndefined()
    }
  })

  test("真树:三种此前漏掉的形式扫出了冻结健康检查、探协议与侧栏自探的调用,且都被约定覆盖", () => {
    const at = (file: string, route: string) =>
      CALLS.filter((call) => call.site.startsWith(`${file}:`) && `${call.verb} ${call.path}` === route).map((call) => call.client)
    // 健康检查(启动时与每 10 秒一轮):先 1.17.13 的 GET /api/health(构造链),失败回退 v1 的 GET /global/health(构造链)
    expect(at("codepuppy-app/src/utils/server-health.ts", "GET /api/health")).toEqual(["1.17.13"])
    expect(at("codepuppy-app/src/utils/server-health.ts", "GET /global/health")).toEqual(["v1"])
    // 探协议:probe 的字面量路径
    expect(at("codepuppy-app/src/utils/server-protocol.ts", "GET /global/health")).toEqual(["raw"])
    expect(at("codepuppy-app/src/utils/server-protocol.ts", "GET /api/health")).toEqual(["raw"])
    // 侧栏自探:new URL 的字面量路径
    expect(at("ui-mac/src/renderer/sidebar/use-projects.ts", "GET /global/health")).toEqual(["raw"])
    expect(matchProbeFallback("GET", "/api/health")?.key).toBe("GET /api/health")
  })

  test("反向臂:源码里多一个表外调用 ⇒ 被扫出并点名(同一行 / 跨行 / `?.` / 实参里带 `?.` / 接收者名对不上描述表)", () => {
    const fixture = 'async function f(client) { await client.experimental.workspace.list() }\n'
    const calls = scanEngineCalls(fixture, "fixture.ts")
    expect(calls.map((call) => call.method)).toEqual(["experimental.workspace.list"])
    expect(uncovered(calls).map((call) => call.site)).toEqual(["fixture.ts:1"])
    // `#1662`:漏掉 GET /api/model 的那种排版 —— 链在点前换行
    const layouts = [
      "async function f(client) {",
      "  await client.v2.session",
      "    .history({ sessionID })",
      "  await client?.v2?.session.history({ sessionID })",
      "  await sdkFor(value?.location).v2.session.history({ sessionID })",
      "}",
      "async function g(sdk) {",
      "  await sdk.plugin",
      "    .list({ location })",
      "}",
    ].join("\n")
    const scanned = scanEngineCalls(layouts, "layout.ts")
    expect(scanned.map((call) => `${call.client} ${call.method} ${call.verb} ${call.path} <- ${call.site}`)).toEqual([
      "v1 v2.session.history GET /api/session/{sessionID}/history <- layout.ts:2",
      "v1 v2.session.history GET /api/session/{sessionID}/history <- layout.ts:4",
      "v1 v2.session.history GET /api/session/{sessionID}/history <- layout.ts:5",
      "1.17.13 plugin.list GET /api/plugin <- layout.ts:8",
    ])
    expect(uncovered(scanned).map((call) => call.site)).toEqual(["layout.ts:2", "layout.ts:4", "layout.ts:5", "layout.ts:8"])
  })
  test("已知坏例 ①:构造链(跨行、嵌套括号)/ 绑定到构造函数的任意变量 / 字面量路径的原始请求都扫出", () => {
    const fixture = [
      "async function a(baseUrl) {",
      "  return OpenCode.make({",
      "    baseUrl,",
      "    headers: password ? { Authorization: token({ password }) } : undefined,",
      "  }).health.get()",
      "}",
      "async function b(server) {",
      "  const anyName = createSdkForServer({ server })",
      "  await anyName.global.health()",
      "}",
      'const legacy = await probe(server, fetch, "/global/health")',
      'const res = await (info.fetch ?? fetch)(new URL("/api/health", info.baseUrl))',
      'const current = await OpenCode.make({ baseUrl }).health.get()',
    ].join("\n")
    expect(scanEngineCalls(fixture, "fixture.ts").map((call) => `${call.client} ${call.verb} ${call.path} <- ${call.site}`)).toEqual([
      "v1 GET /global/health <- fixture.ts:9",
      "1.17.13 GET /api/health <- fixture.ts:2",
      "1.17.13 GET /api/health <- fixture.ts:13",
      "raw GET /api/health <- fixture.ts:12",
      "raw GET /global/health <- fixture.ts:11",
    ])
    // 同样的形式指向目录外的路由 ⇒ 被点名为表外调用
    const outside = 'await fetch("/experimental/workspace")\nawait createOpencodeClient({ baseUrl }).experimental.workspace.list()'
    expect(uncovered(scanEngineCalls(outside, "outside.ts")).map((call) => `${call.verb} ${call.path} <- ${call.site}`)).toEqual([
      "GET /experimental/workspace <- outside.ts:2",
      "GET /experimental/workspace <- outside.ts:1",
    ])
  })

  test("已知坏例 ②:renderer 里一个声明不支持的调用(client.auth.set)⇒ 被点名;同一行在冻结 app 里只算已声明", () => {
    const line = 'await client.auth.set({ providerID: "x", auth: { type: "api", key: "k" } })'
    const fromRenderer = scanEngineCalls(line, "ui-mac/src/renderer/fixture.ts")
    expect(fromRenderer.map((call) => `${call.verb} ${call.path}`)).toEqual(["PUT /auth/{providerID}"])
    expect(uncovered(fromRenderer)).toEqual([])
    expect(rendererOutsideServed(fromRenderer).map((call) => call.site)).toEqual(["ui-mac/src/renderer/fixture.ts:1"])
    expect(rendererOutsideServed(scanEngineCalls(line, "codepuppy-app/src/fixture.ts"))).toEqual([])
  })
})
