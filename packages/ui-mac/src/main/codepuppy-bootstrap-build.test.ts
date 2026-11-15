// `#1698`(DESIGN-upgrade-bootstrap-config §4.4,G1 / G2 / G3):main 的启动文档构建器 —— 字段来自给定的权威输入,逃生阀与 G2 各键按今天
// 读方的判法,随包清单与 ext 目录同在同缺,形状不对在 main 这一侧就抛;对用户导出的地址从不抛,不合格就省略并记一行。
import { describe, expect, test } from "bun:test"
import { userInfo } from "node:os"
import { buildCodePuppyBootstrap, usableExportedPaths, type CodePuppyBootstrapInput } from "./codepuppy-bootstrap-build"
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
  factorySkillDirs: [],
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

const NO_SWITCHES = {
  modelsDisabled: false,
  identityDisabled: false,
  behaviorDisabled: false,
  promptRebrandDisabled: false,
  automationDisabled: false,
  readonlyDisabled: false,
  ecosystemInherit: false,
  extVerbose: false,
}

/** 没有任何运维导出时的 G3 字段:桌面缺省的两个引擎开关(不拉 models.dev、文件监听开)、无出厂技能目录、期限缺省、开关全关。 */
const NO_G3 = { engine: { modelsFetch: false, filewatcher: true }, skills: { factoryDirs: [] }, permission: {}, switches: NO_SWITCHES }

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
      ...NO_G3,
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

  test("空串就是没设(owner 2026-11-13:不保留旧版本的空串含义):地址、默认模型、kill-switch 导出为空串都同未设", () => {
    const empty = buildCodePuppyBootstrap(input({ env: { CODEPUPPY_BASE_URL: "", CODEPUPPY_CLOUD_MCP_URL: "", CODEPUPPY_DEFAULT_MODEL: "", CODEPUPPY_WEBSEARCH_DISABLE: "" } }))
    expect(empty.platform).toEqual({ credentialRef: secretFileRef("/u/data", "CODEPUPPY_API_KEY") })
    expect(empty).not.toHaveProperty("cloudMcp")
    expect(empty.webSearch.killSwitch).toBe(false)
  })

  test("带凭据形状的地址(userinfo / query / fragment / 非 https)被忽略、记一行只写变量名,不抛", () => {
    for (const bad of ["https://user:pw@gw.example/v1", "https://gw.example/v1?token=abc", "https://gw.example/v1#frag", "http://gw.example/v1"]) {
      const lines: string[] = []
      const document = buildCodePuppyBootstrap(input({ env: { CODEPUPPY_BASE_URL: bad, CODEPUPPY_CLOUD_MCP_URL: bad }, log: (line) => lines.push(line) }))
      expect([bad, document.platform]).toEqual([bad, { credentialRef: secretFileRef("/u/data", "CODEPUPPY_API_KEY") }])
      expect(document).not.toHaveProperty("cloudMcp")
      expect(lines).toEqual([
        "bootstrap: CODEPUPPY_BASE_URL ignored (userinfo, query, fragment or non-https)",
        "bootstrap: CODEPUPPY_CLOUD_MCP_URL ignored (userinfo, query, fragment or non-https)",
      ])
    }
  })

  test("分区不是 acct:<64 位十六进制> ⇒ 结构性缺陷,在 main 这一侧就抛", () => {
    expect(() => buildCodePuppyBootstrap(input({ policyAccount: "user@example.com" }))).toThrow(expect.objectContaining({ reason: "invalid", path: "policy.account" }))
  })
})

describe("buildCodePuppyBootstrap(G3:开关与引擎设置,§4.4 表)", () => {
  const switchesOf = (env: Record<string, string | undefined>) => buildCodePuppyBootstrap(input({ env })).switches
  test("没有任何运维导出:桌面缺省的引擎开关、没有出厂技能目录、期限缺省、八个开关全关", () => {
    const document = buildCodePuppyBootstrap(input())
    expect({ engine: document.engine, skills: document.skills, permission: document.permission, switches: document.switches }).toEqual(NO_G3)
  })

  // owner 2026-11-13:每个开关一个判法(util 的 exportedFlag):未设 / 空串 = 没设;1 / true / yes / on(去空白、不分大小写)= 开;其余 = 关。
  const SWITCH_ROWS = [
    ["CODEPUPPY_MODELS_DISABLE", "modelsDisabled"],
    ["CODEPUPPY_IDENTITY_DISABLE", "identityDisabled"],
    ["CODEPUPPY_BEHAVIOR_DISABLE", "behaviorDisabled"],
    ["CODEPUPPY_PROMPT_REBRAND_DISABLE", "promptRebrandDisabled"],
    ["CODEPUPPY_AUTOMATION_DISABLE", "automationDisabled"],
    ["CODEPUPPY_READONLY_DISABLE", "readonlyDisabled"],
    ["CODEPUPPY_ECOSYSTEM_INHERIT", "ecosystemInherit"],
    ["CODEPUPPY_EXT_VERBOSE", "extVerbose"],
  ] as const
  test("八个开关与 kill-switch 同一个判法:1 / true / yes / on 开;未设、空串、0、false、其它写法关;每个开关只动自己那一个字段", () => {
    for (const [name, field] of SWITCH_ROWS) {
      for (const value of ["1", "true", "yes", "on", " TRUE "]) expect([name, value, switchesOf({ [name]: value })[field]]).toEqual([name, value, true])
      for (const value of [undefined, "", "0", "false", "off", "disable"]) expect([name, value, switchesOf({ [name]: value })[field]]).toEqual([name, value, false])
      expect([name, switchesOf({ [name]: "1" })]).toEqual([name, { ...NO_SWITCHES, [field]: true }])
    }
    const killSwitchOf = (value: string | undefined) => buildCodePuppyBootstrap(input({ env: { CODEPUPPY_WEBSEARCH_DISABLE: value } })).webSearch.killSwitch
    expect([killSwitchOf("yes"), killSwitchOf("0"), killSwitchOf("")]).toEqual([true, false, false])
  })

  test("两个引擎开关用同一个判法,空串就是没设(没设:不拉 models.dev、文件监听开)", () => {
    const engineOf = (env: Record<string, string | undefined>) => buildCodePuppyBootstrap(input({ env })).engine
    expect(engineOf({ OPENCODE_DISABLE_MODELS_FETCH: "", OPENCODE_EXPERIMENTAL_FILEWATCHER: "" })).toEqual({ modelsFetch: false, filewatcher: true })
    expect(engineOf({ OPENCODE_DISABLE_MODELS_FETCH: "0", OPENCODE_EXPERIMENTAL_FILEWATCHER: "false" })).toEqual({ modelsFetch: true, filewatcher: false })
    expect(engineOf({ OPENCODE_DISABLE_MODELS_FETCH: "true", OPENCODE_EXPERIMENTAL_FILEWATCHER: "1" })).toEqual({ modelsFetch: false, filewatcher: true })
    expect(engineOf({ OPENCODE_DISABLE_MODELS_FETCH: "yes", OPENCODE_EXPERIMENTAL_FILEWATCHER: "on" })).toEqual({ modelsFetch: false, filewatcher: true })
  })

  test("审批期限:正的安全整数毫秒进文档;未设 / 空串 ⇒ 省略、不记;不合法 ⇒ 忽略并记一行(不带值),不抛", () => {
    const run = (value: string | undefined) => {
      const lines: string[] = []
      const permission = buildCodePuppyBootstrap(input({ env: { CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS: value }, log: (line) => lines.push(line) })).permission
      return { permission, lines }
    }
    expect(run("1500")).toEqual({ permission: { askTimeoutMs: 1500 }, lines: [] })
    for (const unset of [undefined, ""]) expect([unset, run(unset)]).toEqual([unset, { permission: {}, lines: [] }])
    for (const bad of ["0", "-5", "abc", "1.5", "Infinity", "1e400", "9007199254740993"])
      expect([bad, run(bad)]).toEqual([bad, { permission: {}, lines: ["bootstrap: CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS ignored (not a positive integer of milliseconds)"] }])
  })

  test("出厂技能目录取 boot 时对账交出的那份,原样", () => {
    const dirs = ["/app/Resources/skills/skill-creator", "/app/Resources/factory-skills/agent-creator"]
    expect(buildCodePuppyBootstrap(input({ factorySkillDirs: dirs })).skills).toEqual({ factoryDirs: dirs })
  })
})

// 编排器 2026-11-13 裁决:文档的路径字段只收绝对路径。用户导出的相对路径变量(含 `.`)与相对的 HOME 当没设、回到缺省,记一行(不带值)。
// spawnLocalServer 端到端的表在 server.test.ts「#1698 不合格的导出值被忽略,启动照常」;相对的 HOME 只能在这里驱动(bun 的 os.homedir()
// 在进程启动时取一次 HOME)。
describe("usableExportedPaths:相对的路径变量当没设", () => {
  test("相对的 OPENCODE_CONFIG_DIR / XDG_CONFIG_HOME / XDG_DATA_HOME / CODEPUPPY_USER_WORKSPACE_DIR 被拿掉、各记一行;绝对的与未设的原样", () => {
    const lines: string[] = []
    const result = usableExportedPaths({
      env: { OPENCODE_CONFIG_DIR: ".", XDG_CONFIG_HOME: "rel/config", XDG_DATA_HOME: "/abs/data", CODEPUPPY_USER_WORKSPACE_DIR: "work", PATH: "/usr/bin" },
      home: "/home/u",
      log: (line) => lines.push(line),
    })
    expect(result).toEqual({ env: { XDG_DATA_HOME: "/abs/data", PATH: "/usr/bin" }, home: "/home/u" })
    expect(lines).toEqual([
      "bootstrap: OPENCODE_CONFIG_DIR ignored (not an absolute path)",
      "bootstrap: XDG_CONFIG_HOME ignored (not an absolute path)",
      "bootstrap: CODEPUPPY_USER_WORKSPACE_DIR ignored (not an absolute path)",
    ])
  })

  test("相对的 HOME ⇒ 取系统账户的主目录(HOME 未设时 Node 的同一来源),记一行", () => {
    const lines: string[] = []
    expect(usableExportedPaths({ env: {}, home: "rel-home", log: (line) => lines.push(line) }).home).toBe(userInfo().homedir)
    expect(lines).toEqual(["bootstrap: HOME ignored (not an absolute path)"])
  })
})
