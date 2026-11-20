// DESIGN-stored-credentials-fence §4.1:进程内凭据表的消息校验与主进程直接应用路径的叶子解析。值都是一眼可辨的假值。
import { afterEach, describe, expect, test } from "bun:test"
import {
  __resetCodePuppyCredentialsForTests,
  codepuppyCredential,
  installCodePuppyCredentialSource,
  parseCodePuppyCredentials,
  publishCodePuppyCredentials,
  readCodePuppyCredential,
  refreshCodePuppyCredentials,
  resolveCodePuppyCredentialRefs,
  resolveConnectorLeaf,
  type CodePuppyCredentials,
} from "./codepuppy-credentials.js"

const STORE = "/u/data/codepuppy-mcp-secrets"
const OWN = `${STORE}/alpha/v-0000aaaa/TOKEN`
const OTHER = `${STORE}/bravo/v-0000aaaa/TOKEN`
const INLINE = "/u/data/codepuppy-secrets/CODEPUPPY_API_KEY"
const table: CodePuppyCredentials = {
  [OWN]: { value: "FAKE-alpha", use: { kind: "connector", server: "alpha" } },
  [OTHER]: { value: "FAKE-bravo", use: { kind: "connector", server: "bravo" } },
  [INLINE]: { value: "FAKE-platform", use: { kind: "inline" } },
}
/** Stands in for the main process's identity check: every spelling that reaches a store (any case, relative, the alias) is a store target. */
const inStore = (p: string) => /codepuppy-(mcp-)?secrets|alias/.test(p.toLowerCase())

function resolve(leaf: Record<string, unknown>, server = "alpha") {
  const read: string[] = []
  const logged: string[] = []
  const out = resolveConnectorLeaf({
    server,
    leaf,
    table,
    isStoreTarget: inStore,
    readFile: (p) => {
      read.push(p)
      return `read:${p}`
    },
    log: (line) => logged.push(line),
  })
  return { out, read, logged }
}

describe("resolveConnectorLeaf", () => {
  test("a connector's own credential is substituted in environment, headers and both OAuth secret spellings; the store file is never read", () => {
    const { out, read } = resolve({
      environment: { TOKEN: `{file:${OWN}}` },
      headers: { Authorization: `Bearer {file:${OWN}}` },
      oauth: { clientSecret: `{file:${OWN}}`, client_secret: `{file:${OWN}}`, clientId: "id" },
    })
    expect(out).toEqual({
      environment: { TOKEN: "FAKE-alpha" },
      headers: { Authorization: "Bearer FAKE-alpha" },
      oauth: { clientSecret: "FAKE-alpha", client_secret: "FAKE-alpha", clientId: "id" },
    })
    expect(read).toEqual([])
  })

  test("everything else that points into a store becomes empty and is named, never read: another connector, an inline entry, a non-credential field, an alias or relative spelling, a path not in the table", () => {
    const { out, read, logged } = resolve({
      command: ["run", `{file:${OWN}}`],
      cwd: `{file:${OWN}}`,
      environment: {
        OTHER: `{file:${OTHER}}`,
        PLATFORM: `{file:${INLINE}}`,
        CASE: `{file:${OWN.toUpperCase()}}`,
        ALIAS: "{file:/w/alias-to-token}",
        RELATIVE: "{file:u/data/codepuppy-mcp-secrets/alpha/v-0000aaaa/TOKEN}",
        DOTTED: `{file:${STORE}/alpha/../alpha/v-0000aaaa/TOKEN}`,
        MISSING: `{file:${STORE}/alpha/v-0000aaaa/NOPE}`,
      },
      headers: { Nested: { deeper: `{file:${OWN}}` } },
    })
    expect(out).toEqual({
      command: ["run", ""],
      cwd: "",
      environment: { OTHER: "", PLATFORM: "", CASE: "", ALIAS: "", RELATIVE: "", DOTTED: "", MISSING: "" },
      headers: { Nested: { deeper: "" } },
    })
    expect(read).toEqual([])
    expect(logged).toHaveLength(10)
    for (const line of logged) expect(line).not.toMatch(/FAKE-/)
    expect(logged.some((line) => line.includes("environment.OTHER"))).toBe(true)
  })

  test("a reference outside every store is read as before (and only that one)", () => {
    const { out, read } = resolve({ environment: { PLAIN: "{file:/w/notes.txt}", MIX: `x {file:/w/notes.txt} {file:${OWN}}` } })
    expect(out).toEqual({ environment: { PLAIN: "read:/w/notes.txt", MIX: "x read:/w/notes.txt FAKE-alpha" } })
    expect(read).toEqual(["/w/notes.txt", "/w/notes.txt"])
  })

  test("the server name binds the entry: the same reference in bravo's leaf gets nothing", () => {
    expect(resolve({ environment: { TOKEN: `{file:${OWN}}` } }, "bravo").out).toEqual({ environment: { TOKEN: "" } })
  })
})

describe("parseCodePuppyCredentials", () => {
  test("accepts {} and well-formed entries, frozen", () => {
    expect(parseCodePuppyCredentials({})).toEqual({})
    const parsed = parseCodePuppyCredentials({ ...table })
    expect(parsed).toEqual(table)
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  test("rejects anything else without echoing a value", () => {
    for (const bad of [
      null,
      [],
      "x",
      { "relative/key": { value: "FAKE-v", use: { kind: "inline" } } },
      { "/a/../b": { value: "FAKE-v", use: { kind: "inline" } } },
      { "/a": { value: 1, use: { kind: "inline" } } },
      { "/a": { value: "FAKE-v", use: { kind: "connector" } } },
      { "/a": { value: "FAKE-v", use: { kind: "connector", server: "" } } },
      { "/a": { value: "FAKE-v", use: { kind: "other" } } },
      { "/a": { value: "FAKE-v", use: { kind: "inline", extra: 1 } } },
      { "/a": { value: "FAKE-v", use: { kind: "inline" }, extra: 1 } },
    ]) {
      let message = ""
      try {
        parseCodePuppyCredentials(bad)
      } catch (error) {
        message = (error as Error).message
      }
      expect(message).toMatch(/^Code Puppy credentials: /)
      expect(message).not.toContain("FAKE-v")
    }
  })
})

// ── sidecar 进程里的表与引擎配置装载时的代入(设计 §4.1、§4.4)────────────────────────────────────────────

afterEach(() => __resetCodePuppyCredentialsForTests())

describe("进程内表与读者", () => {
  test("发布前什么都没有;发布后精确查(~/ 展开、path.resolve),整表替换;readCodePuppyCredential 没有就抛,消息不带路径与值", () => {
    expect(codepuppyCredential(INLINE)).toBeUndefined()
    expect(() => readCodePuppyCredential(INLINE)).toThrow(/^Code Puppy credential is not available$/)
    publishCodePuppyCredentials(table)
    expect(codepuppyCredential(INLINE)).toBe("FAKE-platform")
    expect(codepuppyCredential("/u/data/codepuppy-secrets/../codepuppy-secrets/CODEPUPPY_API_KEY")).toBe("FAKE-platform")
    publishCodePuppyCredentials({})
    expect(codepuppyCredential(INLINE)).toBeUndefined()
    let message = ""
    try {
      readCodePuppyCredential(INLINE)
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).not.toContain(INLINE)
  })

  test("refresh:没装来源什么都不做;装了 ⇒ 每次调用各拉一次、成功才发布;拉取抛 ⇒ 抛,已发布的旧表不被改", async () => {
    publishCodePuppyCredentials(table)
    await refreshCodePuppyCredentials()
    expect(codepuppyCredential(INLINE)).toBe("FAKE-platform")
    let pulls = 0
    let next: CodePuppyCredentials | Error = { [INLINE]: { value: "FAKE-renewed", use: { kind: "inline" } } }
    installCodePuppyCredentialSource(async () => {
      pulls++
      if (next instanceof Error) throw next
      return next
    })
    await Promise.all([refreshCodePuppyCredentials(), refreshCodePuppyCredentials()])
    expect(pulls).toBe(2) // 两次装载各自拉,不合并
    expect(codepuppyCredential(INLINE)).toBe("FAKE-renewed")
    next = new Error("no reply")
    await expect(refreshCodePuppyCredentials()).rejects.toThrow("no reply")
    expect(codepuppyCredential(INLINE)).toBe("FAKE-renewed")
  })
})

describe("resolveCodePuppyCredentialRefs —— 封闭清单位置", () => {
  const doc = (value: unknown) => JSON.stringify(value, null, 2)
  const parse = (text: string) => JSON.parse(text)

  test("内联文档:provider apiKey 只代入 inline;mcp.servers.<n>.headers 代入 inline 与同名 connector;environment / client_secret 只代入同名 connector", () => {
    publishCodePuppyCredentials(table)
    const out = parse(
      resolveCodePuppyCredentialRefs(
        doc({
          providers: { deepseek: { settings: { apiKey: `{file:${INLINE}}` } }, other: { settings: { apiKey: `{file:${OWN}}` } } },
          mcp: {
            servers: {
              codepuppy: { headers: { Authorization: `Bearer {file:${INLINE}}` } },
              alpha: { headers: { X: `{file:${OWN}}` }, environment: { T: `{file:${OWN}}`, P: `{file:${INLINE}}` }, oauth: { client_secret: `{file:${OWN}}` } },
            },
          },
        }),
        "inline",
      ),
    )
    expect(out.providers).toEqual({ deepseek: { settings: { apiKey: "FAKE-platform" } }, other: { settings: { apiKey: `{file:${OWN}}` } } })
    expect(out.mcp.servers.codepuppy.headers.Authorization).toBe("Bearer FAKE-platform")
    expect(out.mcp.servers.alpha).toEqual({ headers: { X: "FAKE-alpha" }, environment: { T: "FAKE-alpha", P: `{file:${INLINE}}` }, oauth: { client_secret: "FAKE-alpha" } })
  })

  test("显式文件:inline 条目一处也不代入(平台、BYOK 永不从显式文件出来);mcp.<n> 的 headers / environment / clientSecret 只代入同名 connector;A 条目引用 B 的令牌不代入", () => {
    publishCodePuppyCredentials(table)
    const out = parse(
      resolveCodePuppyCredentialRefs(
        doc({
          providers: { deepseek: { settings: { apiKey: `{file:${INLINE}}` } } },
          mcp: {
            alpha: { headers: { X: `{file:${OWN}}`, P: `{file:${INLINE}}` }, environment: { T: `{file:${OWN}}`, B: `{file:${OTHER}}` }, oauth: { clientSecret: `{file:${OWN}}` } },
            servers: { bravo: { headers: { X: `{file:${OTHER}}` }, environment: { A: `{file:${OWN}}` } } },
          },
        }),
        "explicit",
      ),
    )
    expect(out.providers.deepseek.settings.apiKey).toBe(`{file:${INLINE}}`)
    expect(out.mcp.alpha).toEqual({ headers: { X: "FAKE-alpha", P: `{file:${INLINE}}` }, environment: { T: "FAKE-alpha", B: `{file:${OTHER}}` }, oauth: { clientSecret: "FAKE-alpha" } })
    expect(out.mcp.servers.bravo).toEqual({ headers: { X: "FAKE-bravo" }, environment: { A: `{file:${OWN}}` } })
  })

  test("清单之外的位置一字不动(例如 agents.<名>.system、命令、url),留给引擎自己读;没有表 / 文本解析不了 ⇒ 原样", () => {
    const text = doc({ agents: { build: { system: `{file:${INLINE}}` } }, mcp: { alpha: { command: ["x", `{file:${OWN}}`], url: `{file:${OWN}}` } } })
    expect(resolveCodePuppyCredentialRefs(text, "explicit")).toBe(text)
    publishCodePuppyCredentials(table)
    expect(resolveCodePuppyCredentialRefs(text, "explicit")).toBe(text)
    expect(resolveCodePuppyCredentialRefs(text, "inline")).toBe(text)
    const broken = `{ "providers": { "p": { "settings": { "apiKey": "{file:${INLINE}}" } } }`
    expect(resolveCodePuppyCredentialRefs(broken, "inline")).toBe(broken)
  })

  test("值 trim 后 JSON 转义,每个 { 写成 \\u007b(引擎随后的 {env:}/{file:} 碰不到它);同一串里不代入的引用原样留着", () => {
    publishCodePuppyCredentials({ [OWN]: { value: ' a"b\\{env:HOME}{file:/etc/x}\n', use: { kind: "connector", server: "alpha" } } })
    const text = resolveCodePuppyCredentialRefs(doc({ mcp: { alpha: { environment: { T: `x {file:${OWN}} y {file:/w/plain}` } } } }), "explicit")
    expect(text).not.toContain("{env:HOME}")
    expect(text).toContain("\\u007benv:HOME}")
    expect(parse(text).mcp.alpha.environment.T).toBe('x a"b\\{env:HOME}{file:/etc/x} y {file:/w/plain}')
  })
})
