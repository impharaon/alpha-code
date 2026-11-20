// north-star:codepuppy-owned — Code Puppy 自有文件,住在上游包目录里(ADR-043)。
//
// 进程内凭据表(DESIGN-stored-credentials-fence §4.1):Code Puppy 存在本机的凭据(存放点清单在 ui-mac
// `codepuppy-secret-files.ts` 的 credentialStores)由主进程读成一张表,键是与 `{file:}` 引用同一写法的绝对路径,每项带「它的接收方由哪份记录
// 定义」(`use`)。本文件不碰文件系统;值永不进日志与错误消息。
//
// 主进程直接应用连接器(`package-mcp-activation.ts`)用 resolveConnectorLeaf 解析一片 MCP 叶子里的 `{file:}`:指向存放点的引用只在同名连接器
// 条目的凭据字段里、且写法正是表里的键时代入;指向存放点的其它一切给空串、不读文件(保证 (c)(d))。
//
// sidecar 进程里(设计 §4.2–§4.4):表由主进程的 `start` 消息带来(T1)、续期时整表推来(T2)、每次引擎配置装载之前各自拉一次(P)。
// 与启动文档同一种交接:表与拉取函数各挂一个 globalThis 槽,sidecar、ext、引擎三个 bundle 各编一份读法。引擎进程里凭据的值与在场性只从
// 这张表来;配置里的 `{file:}` 只在封闭清单的位置、且条目的 use 允许该位置时代入(resolveCodePuppyCredentialRefs)。只 import node:path、node:os。
import os from "node:os"
import path from "node:path"

/** 一项凭据:值,以及它的接收方由哪份记录定义(主进程建表时判定,设计 §4.3)。 */
export type CodePuppyCredentialEntry = {
  /** 文件原文(不 trim;读者照今天的做法 trim)。 */
  value: string
  use:
    | { kind: "inline" } // codepuppy-secrets/*:平台、云、BYOK、自定义节点 —— 只从内存里的内联文档代入
    | { kind: "connector"; server: string } // 连接器存放点里的文件 —— 只在名字为 `server` 的连接器条目里代入
}
/** 键 = path.resolve 之后的绝对路径(与各处产出的 `{file:}` 引用同一写法)。 */
export type CodePuppyCredentials = Readonly<Record<string, CodePuppyCredentialEntry>>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype

/** 校验消息字段:不是普通对象、键非绝对或不等于 path.resolve(键)、值形状不对 ⇒ 抛 Error(消息不含值)。{} 合法。 */
export function parseCodePuppyCredentials(value: unknown): CodePuppyCredentials {
  if (!isRecord(value)) throw new Error("Code Puppy credentials: not a plain object")
  const table: Record<string, CodePuppyCredentialEntry> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!path.isAbsolute(key) || path.resolve(key) !== key) throw new Error(`Code Puppy credentials: key is not a resolved absolute path: ${JSON.stringify(key)}`)
    if (!isRecord(entry) || typeof entry.value !== "string" || !isRecord(entry.use)) throw new Error(`Code Puppy credentials: malformed entry at ${JSON.stringify(key)}`)
    const use = entry.use
    if (use.kind === "inline" && Object.keys(use).length === 1) table[key] = Object.freeze({ value: entry.value, use: Object.freeze({ kind: "inline" as const }) })
    else if (use.kind === "connector" && typeof use.server === "string" && use.server && Object.keys(use).length === 2)
      table[key] = Object.freeze({ value: entry.value, use: Object.freeze({ kind: "connector" as const, server: use.server }) })
    else throw new Error(`Code Puppy credentials: malformed use at ${JSON.stringify(key)}`)
    if (Object.keys(entry).length !== 2) throw new Error(`Code Puppy credentials: unexpected fields at ${JSON.stringify(key)}`)
  }
  return Object.freeze(table)
}

const FILE_REF = /\{file:([^}]+)\}/g

/** 叶子里允许代入连接器凭据的字段(设计 §4.1;真源叶子是 v1 形状 `oauth.clientSecret`,2.x 形状 `oauth.client_secret`)。 */
function credentialField(at: readonly string[]): boolean {
  if (at.length === 2 && (at[0] === "environment" || at[0] === "headers")) return true
  return at.length === 2 && at[0] === "oauth" && (at[1] === "clientSecret" || at[1] === "client_secret")
}

/**
 * 主进程直接应用路径(`package-mcp-activation.ts`)用:对一片 MCP 叶子按同一套规则解析 `{file:}`,取代无条件读出每个引用的旧写法。
 * 每个引用先问 isStoreTarget(p):
 *   · 指向存放点、写法正是表里某条的键(已是 path.resolve 之后的绝对路径)、条目为 connector 且 server 等于本叶子的名字、字段为
 *     environment.* / headers.* / oauth.clientSecret / oauth.client_secret ⇒ 代入值;
 *   · 指向存放点的其它一切(inline 条目、别的 server、别的字段、经别名或相对路径的写法)⇒ 代入空串并记名字,绝不读那个文件;
 *   · 不指向存放点 ⇒ readFile(今天的行为)。
 * `log` 只收连接器名与字段位置(设计 §5「记名字」),不含值。
 */
export function resolveConnectorLeaf(input: {
  server: string
  leaf: Record<string, unknown>
  table: CodePuppyCredentials
  /** 主进程按 C1 的同一份真实目标清单实现(设计 §4.5;P-22):求不出真实路径 ⇒ true。 */
  isStoreTarget: (path: string) => boolean
  readFile: (path: string) => string
  log?: (line: string) => void
}): Record<string, unknown> {
  const substitute = (text: string, at: readonly string[]) =>
    text.replace(FILE_REF, (_match, file: string) => {
      if (!input.isStoreTarget(file)) return input.readFile(file)
      const entry = path.isAbsolute(file) && path.resolve(file) === file ? input.table[file] : undefined
      if (entry?.use.kind === "connector" && entry.use.server === input.server && credentialField(at)) return entry.value
      input.log?.(`connector ${JSON.stringify(input.server)}: a reference at ${at.join(".") || "(root)"} was not substituted (it points into a Code Puppy credential store, or cannot be resolved, and is not this connector's own credential in its exact spelling)`)
      return ""
    })
  const walk = (value: unknown, at: readonly string[]): unknown => {
    if (typeof value === "string") return substitute(value, at)
    if (Array.isArray(value)) return value.map((item, index) => walk(item, [...at, String(index)]))
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item, [...at, key])]))
    return value
  }
  return walk(input.leaf, []) as Record<string, unknown>
}

// ── sidecar 进程里的表(设计 §4.1、§4.2)────────────────────────────────────────────────────────────────

const TABLE = Symbol.for("codepuppy.credentials")
const SOURCE = Symbol.for("codepuppy.credentials.source")
const slot = globalThis as unknown as Record<symbol, unknown>

/** 整表替换(冻结后挂到 globalThis[Symbol.for("codepuppy.credentials")])。 */
export function publishCodePuppyCredentials(table: CodePuppyCredentials): void {
  slot[TABLE] = parseCodePuppyCredentials({ ...table })
}

let memo: { source: unknown; table: CodePuppyCredentials } | undefined
/** 本 bundle 的读法:第一次读到某个已发布对象时用本 bundle 的解析器校验并记住;没发布 ⇒ undefined。 */
function publishedTable(): CodePuppyCredentials | undefined {
  const source = slot[TABLE]
  if (source === undefined) return undefined
  if (memo?.source !== source) memo = { source, table: parseCodePuppyCredentials(source) }
  return memo.table
}

/** sidecar 启动时装上:向主进程要整表并等回复(§4.2)。没装(仓内 CLI、core 单测)⇒ refresh 什么都不做。 */
export function installCodePuppyCredentialSource(pull: () => Promise<CodePuppyCredentials>): void {
  slot[SOURCE] = pull
}

/**
 * 拉整表、发布、再返回。每次调用各发一个请求(请求方按自己的 id 认回复),调用之间不合并、不复用在途回复。主进程回错误、10 秒没有回复、
 * 或端口关闭 ⇒ 抛(超时那一种由请求方另向主进程发 `credentials.unavailable`)。抛出时调用方这次装载不代入,绝不用已发布的旧表完成装载。
 */
export async function refreshCodePuppyCredentials(): Promise<void> {
  const pull = slot[SOURCE] as (() => Promise<CodePuppyCredentials>) | undefined
  if (!pull) return
  publishCodePuppyCredentials(await pull())
}

function lookup(file: string): string | undefined {
  const expanded = file.startsWith("~/") ? path.join(os.homedir(), file.slice(2)) : file
  return publishedTable()?.[path.resolve(expanded)]?.value
}

/** 只给读启动文档引用的读者:`~/` 展开、path.resolve、精确查;返回值,不看 use;没有 ⇒ undefined。 */
export function codepuppyCredential(file: string): string | undefined {
  return lookup(file)
}

/** 同上,没有就抛 Error("Code Puppy credential is not available")——不带路径与值;现有 readFile 形参的直接替身。 */
export function readCodePuppyCredential(file: string): string {
  const value = lookup(file)
  if (value === undefined) throw new Error("Code Puppy credential is not available")
  return value
}

// ── 引擎配置装载:封闭清单位置上的代入(设计 §4.4)─────────────────────────────────────────────────────────

type Allowed = (entry: CodePuppyCredentialEntry) => boolean
const connectorOf = (server: string): Allowed => (entry) => entry.use.kind === "connector" && entry.use.server === server
const inlineEntry: Allowed = (entry) => entry.use.kind === "inline"

type Json = Record<string, unknown>
const objectAt = (value: unknown, key: string): Json | undefined => {
  const next = isRecord(value) ? value[key] : undefined
  return isRecord(next) ? next : undefined
}

/**
 * 封闭清单(设计 §4.4 表):每个位置是「某个对象的某个字符串字段」与允许的条目。两份文档以外的文档调用方根本不交进来。
 * 返回 [所在对象, 字段名, 允许的条目]。
 */
function positions(root: Json, document: "inline" | "explicit"): Array<[Json, string, Allowed]> {
  const out: Array<[Json, string, Allowed]> = []
  const strings = (holder: Json | undefined, allowed: Allowed) => {
    for (const key of Object.keys(holder ?? {})) if (typeof holder![key] === "string") out.push([holder!, key, allowed])
  }
  const one = (holder: Json | undefined, key: string, allowed: Allowed) => {
    if (holder && typeof holder[key] === "string") out.push([holder, key, allowed])
  }
  if (document === "inline") for (const id of Object.keys(objectAt(root, "providers") ?? {})) one(objectAt(objectAt(objectAt(root, "providers"), id), "settings"), "apiKey", inlineEntry)
  const mcp = objectAt(root, "mcp")
  const servers = objectAt(mcp, "servers")
  for (const name of Object.keys(servers ?? {})) {
    const server = objectAt(servers, name)
    const connector = connectorOf(name)
    strings(objectAt(server, "headers"), document === "inline" ? (entry) => inlineEntry(entry) || connector(entry) : connector)
    strings(objectAt(server, "environment"), connector)
    one(objectAt(server, "oauth"), "client_secret", connector)
  }
  for (const name of Object.keys(mcp ?? {})) {
    if (name === "servers") continue
    const server = objectAt(mcp, name)
    const connector = connectorOf(name)
    if (document === "explicit") strings(objectAt(server, "headers"), connector)
    strings(objectAt(server, "environment"), connector)
    one(objectAt(server, "oauth"), "clientSecret", connector)
  }
  return out
}

/**
 * 引擎配置装载用(§4.4)。只在封闭清单的位置上、且条目的 use 允许该位置时,把整串或串内的 `{file:<路径>}` 换成值(trim 后 JSON 转义,值里每个
 * "{" 写成 \u007b,引擎随后的 {env:}/{file:} 两遍碰不到它);其余位置、其余记号一字不动,留给引擎自己的 {file:} 读法(C1 下读凭据路径 =
 * EPERM = 空串 + warning)。按解析树定位:这两份文档都是主进程用 JSON.stringify 写出的严格 JSON;解析不了(含注释的 JSONC 等)⇒ 原样返回。
 * 什么都没代入 ⇒ 原文;代入了 ⇒ 重新序列化(键序不变)。
 */
export function resolveCodePuppyCredentialRefs(text: string, document: "inline" | "explicit"): string {
  const table = publishedTable()
  if (!table || !text.includes("{file:")) return text
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch {
    return text
  }
  if (!isRecord(root)) return text
  const literals: string[] = []
  const nonce = globalThis.crypto.randomUUID()
  for (const [holder, key, allowed] of positions(root as Json, document)) {
    const value = holder[key] as string
    let changed = false
    const next = value.replace(FILE_REF, (token, file: string) => {
      const expanded = file.startsWith("~/") ? path.join(os.homedir(), file.slice(2)) : file
      const entry = path.isAbsolute(expanded) ? table[path.resolve(expanded)] : undefined
      if (!entry || !allowed(entry)) return token
      changed = true
      literals.push(JSON.stringify(entry.value.trim()).slice(1, -1).replace(/\{/g, "\\u007b"))
      return `\u0000${nonce}:${literals.length - 1}\u0000`
    })
    if (changed) holder[key] = next
  }
  if (!literals.length) return text
  // the sentinels contain only characters JSON.stringify writes back verbatim except the NUL bytes, which it writes as \u0000
  return JSON.stringify(root).replace(new RegExp(`\\\\u0000${nonce}:(\\d+)\\\\u0000`, "g"), (_match, index: string) => literals[Number(index)]!)
}

/** 仅测试:撤掉已发布的表与拉取函数。 */
export function __resetCodePuppyCredentialsForTests(): void {
  delete slot[TABLE]
  delete slot[SOURCE]
  memo = undefined
}
