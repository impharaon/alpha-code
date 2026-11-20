// DESIGN-stored-credentials-fence §4.1:进程内凭据表的消息校验与主进程直接应用路径的叶子解析。值都是一眼可辨的假值。
import { describe, expect, test } from "bun:test"
import { parseCodePuppyCredentials, resolveConnectorLeaf, type CodePuppyCredentials } from "./codepuppy-credentials.js"

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
