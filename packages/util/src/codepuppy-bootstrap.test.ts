// `#1698`(DESIGN-upgrade-bootstrap-config §4.1):启动文档的严格解析、一次性发布与各 bundle 自己的读取。
import { afterEach, describe, expect, test } from "bun:test"
import {
  CodePuppyBootstrapError,
  __resetCodePuppyBootstrapForTests,
  cloudMcpArmed,
  codepuppyBootstrap,
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
  platform: {
    credentialRef: "{file:/u/data/codepuppy-secrets/CODEPUPPY_API_KEY}",
    modelProxyBaseURL: "https://api.codepuppy.example/v1",
    defaultModelOverride: "",
  },
  cloudMcp: {
    name: "codepuppy",
    definition: {
      type: "remote",
      url: "https://cloud.codepuppy.example/mcp",
      headers: { Authorization: "Bearer {file:/u/data/codepuppy-secrets/CODEPUPPY_MCP_TOKEN}" },
      oauth: false,
    },
  },
  webSearch: { killSwitch: false },
  policy: { account: `acct:${"a".repeat(64)}` },
  network: { egressProxy: "http://127.0.0.1:4433" },
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
    const minimal = { v: 1, paths: { ...paths, database: ":memory:" }, platform: { credentialRef: "{file:/k}" }, webSearch: { killSwitch: true }, policy: {}, network: {} }
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

  test("the two URL fields accept only credential-free URLs", () => {
    expect(failure({ ...valid(), platform: { ...valid().platform, modelProxyBaseURL: "https://u:p@api.example/v1" } })).toMatchObject({ reason: "invalid", path: "platform.modelProxyBaseURL" })
    const cloud = valid().cloudMcp
    expect(failure({ ...valid(), cloudMcp: { ...cloud, definition: { ...cloud.definition, url: "https://cloud.example/mcp?token=abc" } } })).toMatchObject({
      reason: "invalid",
      path: "cloudMcp.definition.url",
    })
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
