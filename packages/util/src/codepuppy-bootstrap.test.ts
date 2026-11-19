// `#1698`(DESIGN-upgrade-bootstrap-config §4.1):启动文档的严格解析、一次性发布与各 bundle 自己的读取。
import { afterEach, describe, expect, test } from "bun:test"
import {
  CodePuppyBootstrapError,
  __resetCodePuppyBootstrapForTests,
  cloudMcpArmed,
  codepuppyBootstrap,
  codepuppyEngineSettings,
  exportedFlag,
  isCredentialFreeUrl,
  parseCodePuppyBootstrap,
  publishCodePuppyBootstrap,
  tryCodePuppyBootstrap,
} from "./codepuppy-bootstrap.js"

const valid = () => ({
  v: 1,
  paths: {
    userData: "/u/data",
    globalRoot: "/u/state/env/dev",
    userConfig: "/u/state/env/dev/codepuppy.jsonc",
    initialDirectory: "/u/code",
    database: "/u/share/opencode/opencode.db",
    engineConfigDirectory: "/u/config/opencode",
    extPlugin: "/app/ext",
    extBundledManifest: "/app/ext/bundled-tools.json",
    officeMcpManifest: "/app/resources/office-mcp/tools.json",
  },
  registryChannel: "stable",
  engine: { modelsFetch: false, filewatcher: true },
  platform: {
    credentialRef: "{file:/u/data/codepuppy-secrets/CODEPUPPY_API_KEY}",
    modelProxyBaseURL: "https://api.codepuppy.example/v1",
    defaultModelOverride: "codepuppy/m",
  },
  cloudMcp: {
    name: "codepuppy",
    definition: {
      type: "remote",
      url: "https://cloud.codepuppy.example/mcp",
      headers: { Authorization: "Bearer {file:/u/data/codepuppy-secrets/CODEPUPPY_MCP_TOKEN}" },
      oauth: false,
      codemode: false,
    },
  },
  webSearch: { killSwitch: false },
  skills: { factoryDirs: ["/app/resources/skills/a"] },
  policy: { account: `acct:${"a".repeat(64)}` },
  permission: { askTimeoutMs: 1500 },
  network: { egressProxy: "http://127.0.0.1:4433" },
  switches: {
    modelsDisabled: false,
    identityDisabled: false,
    behaviorDisabled: false,
    promptRebrandDisabled: false,
    automationDisabled: false,
    readonlyDisabled: false,
    ecosystemInherit: false,
    extVerbose: false,
  },
})

const failure = (value: unknown) => {
  try {
    parseCodePuppyBootstrap(value)
  } catch (error) {
    if (error instanceof CodePuppyBootstrapError) return { reason: error.reason, path: error.path, message: error.message }
    throw error
  }
  throw new Error("parsed")
}

afterEach(() => __resetCodePuppyBootstrapForTests())

describe("parseCodePuppyBootstrap", () => {
  test("a valid document parses to a deep-frozen copy; optional keys may be absent; :memory: is a database", () => {
    const source = valid()
    const parsed = parseCodePuppyBootstrap(source)
    expect(parsed).toEqual(source as never)
    expect(parsed).not.toBe(source as never)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.paths)).toBe(true)
    const { userConfig, extPlugin, extBundledManifest, ...paths } = valid().paths
    const minimal = {
      v: 1,
      paths: { ...paths, database: ":memory:" },
      engine: { modelsFetch: true, filewatcher: false },
      platform: { credentialRef: "{file:/k}" },
      webSearch: { killSwitch: true },
      skills: { factoryDirs: [] },
      policy: {},
      permission: {},
      network: {},
      switches: valid().switches,
    }
    expect(parseCodePuppyBootstrap(minimal)).toEqual(minimal as never)
  })

  test("v that is not this version ⇒ version (before any shape check)", () => {
    expect(failure({ ...valid(), v: 2 })).toMatchObject({ reason: "version", path: "v" })
    expect(failure({ v: 2, other: true })).toMatchObject({ reason: "version", path: "v" })
  })

  test("extra, missing, mistyped or malformed fields ⇒ invalid with the field path and without the value", () => {
    expect(failure({ ...valid(), extra: 1 })).toMatchObject({ reason: "invalid", path: "extra" })
    expect(failure({ ...valid(), paths: { ...valid().paths, password: "s3cret-value" } })).toMatchObject({ reason: "invalid", path: "paths.password" })
    const { globalRoot, ...missing } = valid().paths
    expect(failure({ ...valid(), paths: missing })).toMatchObject({ reason: "invalid", path: "paths.globalRoot" })
    expect(failure({ ...valid(), paths: { ...valid().paths, initialDirectory: "relative/dir" } })).toMatchObject({ reason: "invalid", path: "paths.initialDirectory" })
    expect(failure({ ...valid(), paths: { ...valid().paths, database: 7 } })).toMatchObject({ reason: "invalid", path: "paths.database" })
    expect(failure({ ...valid(), registryChannel: "nightly" })).toMatchObject({ reason: "invalid", path: "registryChannel" })
    const { extBundledManifest, ...lonely } = valid().paths
    expect(failure({ ...valid(), paths: lonely })).toMatchObject({ reason: "invalid", path: "paths.extBundledManifest" })
    expect(failure([])).toMatchObject({ reason: "invalid", path: "" })
    expect(failure({ ...valid(), paths: new Map() })).toMatchObject({ reason: "invalid", path: "paths" })
    expect(failure({ ...valid(), paths: { ...valid().paths, userData: "token-abc123" } }).message).not.toContain("token-abc123")
  })
})

describe("G2 fields: secrets cannot be written into the document", () => {
  test("credentialRef and the cloud Authorization accept only {file:} references; a literal token is invalid", () => {
    expect(failure({ ...valid(), platform: { ...valid().platform, credentialRef: "sk-live-123" } })).toMatchObject({ reason: "invalid", path: "platform.credentialRef" })
    const cloud = valid().cloudMcp
    expect(failure({ ...valid(), cloudMcp: { ...cloud, definition: { ...cloud.definition, headers: { Authorization: "Bearer eyJhbGciOi" } } } })).toMatchObject({
      reason: "invalid",
      path: "cloudMcp.definition.headers.Authorization",
    })
    expect(failure({ ...valid(), cloudMcp: { ...cloud, definition: { ...cloud.definition, headers: { Authorization: "Bearer {file:/t}", Cookie: "x" } } } })).toMatchObject({
      reason: "invalid",
      path: "cloudMcp.definition.headers.Cookie",
    })
  })

  test("the cloud definition keeps its tools direct (codemode false); absent or true is invalid", () => {
    const { codemode: _, ...rest } = valid().cloudMcp.definition
    expect(failure({ ...valid(), cloudMcp: { ...valid().cloudMcp, definition: rest } })).toMatchObject({ reason: "invalid", path: "cloudMcp.definition.codemode" })
    expect(failure({ ...valid(), cloudMcp: { ...valid().cloudMcp, definition: { ...rest, codemode: true } } })).toMatchObject({ reason: "invalid", path: "cloudMcp.definition.codemode" })
  })

  test("the two URL fields accept only credential-free URLs", () => {
    expect(failure({ ...valid(), platform: { ...valid().platform, modelProxyBaseURL: "https://u:p@api.example/v1" } })).toMatchObject({ reason: "invalid", path: "platform.modelProxyBaseURL" })
    const cloud = valid().cloudMcp
    expect(failure({ ...valid(), cloudMcp: { ...cloud, definition: { ...cloud.definition, url: "https://cloud.example/mcp?token=abc" } } })).toMatchObject({
      reason: "invalid",
      path: "cloudMcp.definition.url",
    })
  })

  test("defaultModelOverride is a non-empty model id (an empty export is simply unset and never reaches the document)", () => {
    expect(failure({ ...valid(), platform: { ...valid().platform, defaultModelOverride: "" } })).toMatchObject({ reason: "invalid", path: "platform.defaultModelOverride" })
  })

  test("account and egress proxy formats; killSwitch is a boolean", () => {
    expect(failure({ ...valid(), policy: { account: "acct:not-a-hash" } })).toMatchObject({ reason: "invalid", path: "policy.account" })
    expect(failure({ ...valid(), network: { egressProxy: "http://10.0.0.1:8080" } })).toMatchObject({ reason: "invalid", path: "network.egressProxy" })
    expect(failure({ ...valid(), webSearch: { killSwitch: "1" } })).toMatchObject({ reason: "invalid", path: "webSearch.killSwitch" })
  })

  test("isCredentialFreeUrl: https, or http on loopback; no userinfo, query or fragment", () => {
    for (const ok of ["https://api.example/v1", "http://127.0.0.1:4096/v1", "http://localhost/mcp", "http://[::1]:9/x"]) expect(isCredentialFreeUrl(ok), ok).toBe(true)
    for (const bad of ["http://api.example/v1", "https://u:p@api.example/", "https://u@api.example/", "https://api.example/?k=v", "https://api.example/?", "https://api.example/#t", "ftp://x/", "not a url"])
      expect(isCredentialFreeUrl(bad), bad).toBe(false)
  })

  test("cloudMcpArmed = kill switch on and a cloud MCP present", () => {
    expect(cloudMcpArmed(parseCodePuppyBootstrap(valid()))).toBe(false)
    expect(cloudMcpArmed(parseCodePuppyBootstrap({ ...valid(), webSearch: { killSwitch: true } }))).toBe(true)
    const { cloudMcp, ...noCloud } = valid()
    expect(cloudMcpArmed(parseCodePuppyBootstrap({ ...noCloud, webSearch: { killSwitch: true } }))).toBe(false)
  })
})

describe("G3 fields: switches and engine settings", () => {
  test("every switch and both engine toggles are required booleans; factory dirs are absolute; the ask deadline is a positive safe integer", () => {
    const { extVerbose, ...seven } = valid().switches
    expect(failure({ ...valid(), switches: seven })).toMatchObject({ reason: "invalid", path: "switches.extVerbose" })
    expect(failure({ ...valid(), switches: { ...valid().switches, modelsDisabled: "1" } })).toMatchObject({ reason: "invalid", path: "switches.modelsDisabled" })
    expect(failure({ ...valid(), switches: { ...valid().switches, other: true } })).toMatchObject({ reason: "invalid", path: "switches.other" })
    expect(failure({ ...valid(), engine: { modelsFetch: true } })).toMatchObject({ reason: "invalid", path: "engine.filewatcher" })
    expect(failure({ ...valid(), skills: { factoryDirs: "/a" } })).toMatchObject({ reason: "invalid", path: "skills.factoryDirs" })
    expect(failure({ ...valid(), skills: { factoryDirs: ["/a", "relative"] } })).toMatchObject({ reason: "invalid", path: "skills.factoryDirs.1" })
    for (const bad of [0, -5, 1.5, Number.MAX_SAFE_INTEGER + 1, "1500"])
      expect(failure({ ...valid(), permission: { askTimeoutMs: bad } })).toMatchObject({ reason: "invalid", path: "permission.askTimeoutMs" })
  })

  test("codepuppyEngineSettings without a document: today's environment rules, word for word (the in-repo CLI host)", () => {
    expect(codepuppyEngineSettings({})).toEqual({ askTimeoutMs: 300_000, projectWatch: false })
    expect(codepuppyEngineSettings({ CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS: "1500" }).askTimeoutMs).toBe(1500)
    for (const bad of ["", "0", "-5", "abc", "1.5", "Infinity", "1e400"])
      expect([bad, codepuppyEngineSettings({ CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS: bad }).askTimeoutMs]).toEqual([bad, 300_000])
    for (const on of ["true", "1", "yes", "on", " TRUE ", "On"])
      expect([on, codepuppyEngineSettings({ OPENCODE_EXPERIMENTAL_FILEWATCHER: on }).projectWatch]).toEqual([on, true])
    for (const off of ["", "false", "0", "no", "off", "enabled"])
      expect([off, codepuppyEngineSettings({ OPENCODE_EXPERIMENTAL_FILEWATCHER: off }).projectWatch]).toEqual([off, false])
  })

  test("codepuppyEngineSettings with a published document reads the document and ignores the environment", () => {
    publishCodePuppyBootstrap(parseCodePuppyBootstrap({ ...valid(), engine: { modelsFetch: false, filewatcher: false } }))
    const env = { CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS: "9", OPENCODE_EXPERIMENTAL_FILEWATCHER: "yes" }
    expect(codepuppyEngineSettings(env)).toEqual({ askTimeoutMs: 1500, projectWatch: false })
    __resetCodePuppyBootstrapForTests()
    publishCodePuppyBootstrap(parseCodePuppyBootstrap({ ...valid(), permission: {} }))
    expect(codepuppyEngineSettings(env)).toEqual({ askTimeoutMs: 300_000, projectWatch: true })
  })
})

describe("exportedFlag: the one rule for every switch-like variable", () => {
  test("unset or empty ⇒ undefined; 1 / true / yes / on (trimmed, any case) ⇒ true; anything else ⇒ false", () => {
    for (const unset of [undefined, ""]) expect([unset, exportedFlag(unset)]).toEqual([unset, undefined])
    for (const on of ["1", "true", "yes", "on", " TRUE ", "On", "YES"]) expect([on, exportedFlag(on)]).toEqual([on, true])
    for (const off of ["0", "false", "no", "off", "enabled", "2", " "]) expect([off, exportedFlag(off)]).toEqual([off, false])
  })
})

describe("publish and read", () => {
  test("unpublished ⇒ codepuppyBootstrap throws unpublished, tryCodePuppyBootstrap is undefined", () => {
    expect(tryCodePuppyBootstrap()).toBeUndefined()
    expect(() => codepuppyBootstrap()).toThrow(expect.objectContaining({ reason: "unpublished" }))
  })

  test("published once ⇒ every reader sees the same frozen document; a second publish ⇒ republished", () => {
    publishCodePuppyBootstrap(parseCodePuppyBootstrap(valid()))
    expect(codepuppyBootstrap().paths.globalRoot).toBe("/u/state/env/dev")
    expect(tryCodePuppyBootstrap()).toBe(codepuppyBootstrap())
    expect(() => publishCodePuppyBootstrap(parseCodePuppyBootstrap(valid()))).toThrow(expect.objectContaining({ reason: "republished" }))
  })

  test("an object another build published in a shape this bundle does not know ⇒ the first read throws", () => {
    ;(globalThis as Record<symbol, unknown>)[Symbol.for("codepuppy.bootstrap")] = Object.freeze({ ...valid(), v: 2 })
    expect(() => codepuppyBootstrap()).toThrow(expect.objectContaining({ reason: "version" }))
    expect(() => tryCodePuppyBootstrap()).toThrow(expect.objectContaining({ reason: "version" }))
  })
})
