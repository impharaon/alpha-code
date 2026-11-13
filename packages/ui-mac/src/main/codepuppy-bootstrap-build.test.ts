// `#1698`(DESIGN-upgrade-bootstrap-config §4.4,G1 / G2):main 的启动文档构建器 —— 字段来自给定的权威输入,逃生阀与 G2 各键按今天
// 读方的判法,随包清单与 ext 目录同在同缺,形状不对在 main 这一侧就抛;对用户导出的地址从不抛,不合格就省略并记一行。
import { describe, expect, test } from "bun:test"
import { buildCodePuppyBootstrap, type CodePuppyBootstrapInput } from "./codepuppy-bootstrap-build"
import { secretFileRef } from "./codepuppy-secret-files"

const input = (overrides: Partial<CodePuppyBootstrapInput> = {}): CodePuppyBootstrapInput => ({
  userDataPath: "/u/data",
  globalRoot: "/u/state/env/prod",
  userConfig: "/u/state/env/prod/codepuppy.jsonc",
  initialDirectory: "/u/code-dir",
  databasePath: "/u/share/opencode/opencode.db",
  engineConfigDirectory: "/u/config/opencode",
  extPluginPath: "/app/Resources/codepuppy-ext",
  officeMcpManifest: "/app/Resources/office-mcp/tools.json",
  registryChannel: "stable",
  env: {},
  log: () => {},
  ...overrides,
})

const NO_G2 = {
  platform: { credentialRef: secretFileRef("/u/data", "CODEPUPPY_API_KEY") },
  webSearch: { killSwitch: false },
  policy: {},
  network: {},
}

describe("buildCodePuppyBootstrap(G1:路径与通道)", () => {
  test("每个字段取自给定输入;随包清单是 ext 目录旁边的 bundled-tools.json(ext 读的就是这个字段)", () => {
    expect(buildCodePuppyBootstrap(input())).toEqual({
      v: 1,
      paths: {
        userData: "/u/data",
        globalRoot: "/u/state/env/prod",
        userConfig: "/u/state/env/prod/codepuppy.jsonc",
        initialDirectory: "/u/code-dir",
        database: "/u/share/opencode/opencode.db",
        engineConfigDirectory: "/u/config/opencode",
        extPlugin: "/app/Resources/codepuppy-ext",
        extBundledManifest: "/app/Resources/codepuppy-ext/bundled-tools.json",
        officeMcpManifest: "/app/Resources/office-mcp/tools.json",
      },
      registryChannel: "stable",
      ...NO_G2,
    })
  })

  test("没有 ext 目录 ⇒ ext 与随包清单都缺席;没有通道 ⇒ 通道缺席(sidecar 照今天跳过 override 注入)", () => {
    const document = buildCodePuppyBootstrap(input({ extPluginPath: undefined, registryChannel: undefined }))
    expect(document.paths).not.toHaveProperty("extPlugin")
    expect(document.paths).not.toHaveProperty("extBundledManifest")
    expect(document).not.toHaveProperty("registryChannel")
  })

  test("REQ-059 逃生阀:任一个 === \"1\" ⇒ userConfig 缺席;别的取值(含空串)同未设", () => {
    for (const env of [{ CODEPUPPY_JSONC_TRUTH_DISABLE: "1" }, { CODEPUPPY_LEGACY_INSTALL_ROOT: "1" }])
      expect(buildCodePuppyBootstrap(input({ env })).paths).not.toHaveProperty("userConfig")
    for (const env of [{ CODEPUPPY_JSONC_TRUTH_DISABLE: "" }, { CODEPUPPY_LEGACY_INSTALL_ROOT: "true" }, {}])
      expect(buildCodePuppyBootstrap(input({ env })).paths.userConfig).toBe("/u/state/env/prod/codepuppy.jsonc")
  })

  test("结构性缺陷(相对路径)在 main 这一侧就抛,不等 sidecar 发现", () => {
    expect(() => buildCodePuppyBootstrap(input({ initialDirectory: "code-dir" }))).toThrow(expect.objectContaining({ reason: "invalid", path: "paths.initialDirectory" }))
  })
})

describe("buildCodePuppyBootstrap(G2:平台 / 云 / web search / 策略分区 / 出网代理)", () => {
  test("未登录、没有任何导出:只有平台凭据的 {file:} 引用,kill-switch 关,无云 MCP、无分区、无出网代理", () => {
    const document = buildCodePuppyBootstrap(input())
    expect({ platform: document.platform, webSearch: document.webSearch, policy: document.policy, network: document.network }).toEqual(NO_G2)
    expect(document).not.toHaveProperty("cloudMcp")
  })

  test("登录态的输入逐项进文档:地址原样、云 MCP 定义由同一个工厂算(带 {file:} 引用,不带令牌)、分区哈希与出网代理 URL", () => {
    const account = `acct:${"a".repeat(64)}`
    const document = buildCodePuppyBootstrap(
      input({
        env: {
          CODEPUPPY_BASE_URL: "https://gw.example/v1",
          CODEPUPPY_CLOUD_MCP_URL: "https://cloud.example/mcp",
          CODEPUPPY_DEFAULT_MODEL: "codepuppy/m",
          CODEPUPPY_WEBSEARCH_DISABLE: "1",
          CODEPUPPY_MCP_TOKEN: "mcp-token-not-real",
        },
        policyAccount: account,
        egressProxyPort: 51337,
      }),
    )
    expect(document.platform).toEqual({ credentialRef: secretFileRef("/u/data", "CODEPUPPY_API_KEY"), modelProxyBaseURL: "https://gw.example/v1", defaultModelOverride: "codepuppy/m" })
    expect(document.cloudMcp).toEqual({
      name: "codepuppy",
      definition: { type: "remote", url: "https://cloud.example/mcp", headers: { Authorization: `Bearer ${secretFileRef("/u/data", "CODEPUPPY_MCP_TOKEN")}` }, oauth: false },
    })
    expect(document.webSearch).toEqual({ killSwitch: true })
    expect(document.policy).toEqual({ account })
    expect(document.network).toEqual({ egressProxy: "http://127.0.0.1:51337" })
    expect(JSON.stringify(document)).not.toContain("mcp-token-not-real")
  })

  test("空串按今天读方的判法:地址空串同未设;默认模型空串也算导出(随后不设默认模型);kill-switch 任意非空串即开", () => {
    const empty = buildCodePuppyBootstrap(input({ env: { CODEPUPPY_BASE_URL: "", CODEPUPPY_CLOUD_MCP_URL: "", CODEPUPPY_DEFAULT_MODEL: "", CODEPUPPY_WEBSEARCH_DISABLE: "" } }))
    expect(empty.platform).toEqual({ credentialRef: secretFileRef("/u/data", "CODEPUPPY_API_KEY"), defaultModelOverride: "" })
    expect(empty).not.toHaveProperty("cloudMcp")
    expect(empty.webSearch.killSwitch).toBe(false)
    expect(buildCodePuppyBootstrap(input({ env: { CODEPUPPY_WEBSEARCH_DISABLE: "0" } })).webSearch.killSwitch).toBe(true)
  })

  test("带凭据形状的地址(userinfo / query / fragment / 非 https)省略、记一行只写变量名,不抛", () => {
    for (const bad of ["https://user:pw@gw.example/v1", "https://gw.example/v1?token=abc", "https://gw.example/v1#frag", "http://gw.example/v1"]) {
      const lines: string[] = []
      const document = buildCodePuppyBootstrap(input({ env: { CODEPUPPY_BASE_URL: bad, CODEPUPPY_CLOUD_MCP_URL: bad }, log: (line) => lines.push(line) }))
      expect([bad, document.platform]).toEqual([bad, { credentialRef: secretFileRef("/u/data", "CODEPUPPY_API_KEY") }])
      expect(document).not.toHaveProperty("cloudMcp")
      expect(lines).toEqual([
        "bootstrap: CODEPUPPY_BASE_URL rejected (userinfo, query, fragment or non-https)",
        "bootstrap: CODEPUPPY_CLOUD_MCP_URL rejected (userinfo, query, fragment or non-https)",
      ])
    }
  })

  test("分区不是 acct:<64 位十六进制> ⇒ 结构性缺陷,在 main 这一侧就抛", () => {
    expect(() => buildCodePuppyBootstrap(input({ policyAccount: "user@example.com" }))).toThrow(expect.objectContaining({ reason: "invalid", path: "policy.account" }))
  })
})
