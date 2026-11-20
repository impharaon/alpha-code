// north-star:codepuppy-owned — Code Puppy 自有文件,住在上游包目录里(ADR-043)。
//
// 进程内凭据表(DESIGN-stored-credentials-fence §4.1):Code Puppy 存在本机的凭据(存放点清单在 ui-mac
// `codepuppy-secret-files.ts` 的 credentialStores)由主进程读成一张表,键是与 `{file:}` 引用同一写法的绝对路径,每项带「它的接收方由哪份记录
// 定义」(`use`)。本文件不碰文件系统;值永不进日志与错误消息。
//
// 主进程直接应用连接器(`package-mcp-activation.ts`)用 resolveConnectorLeaf 解析一片 MCP 叶子里的 `{file:}`:指向存放点的引用只在同名连接器
// 条目的凭据字段里、且写法正是表里的键时代入;指向存放点的其它一切给空串、不读文件(保证 (c)(d))。
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
    if (use.kind === "inline" && Object.keys(use).length === 1) table[key] = { value: entry.value, use: { kind: "inline" } }
    else if (use.kind === "connector" && typeof use.server === "string" && use.server && Object.keys(use).length === 2)
      table[key] = { value: entry.value, use: { kind: "connector", server: use.server } }
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
      input.log?.(`connector ${JSON.stringify(input.server)}: a credential reference at ${at.join(".") || "(root)"} was not substituted (not this connector's own credential field)`)
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
