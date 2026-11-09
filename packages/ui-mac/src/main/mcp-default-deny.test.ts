// #535 / REQ-109 T6:G1 用户全局 MCP default-deny。
// 全部使用真临时目录;无网络、无 HOME 改写。仅不可读分支注入 readFile 以稳定模拟 EACCES。
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { injectMcpDefaultDeny, NEUTRALIZED_MCP_SERVER } from "./mcp-default-deny"

// `#1667`:OpenCode 2 形状 —— 注入写在 `mcp.servers` 下;关掉一个 server 写完整的中和条目(2.x 按名字整条替换,
// v1 的 lone `{enabled:false}` 叶子会被上游丢弃并出诊断)。
const OFF = { ...NEUTRALIZED_MCP_SERVER }

let root: string
let codepuppyConfigPath: string
let userConfigDir: string
let logs: string[]

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mcp-default-deny-"))
  codepuppyConfigPath = join(root, "codepuppy.jsonc")
  userConfigDir = join(root, "real-user-config")
  mkdirSync(userConfigDir, { recursive: true })
  writeFileSync(codepuppyConfigPath, "{}")
  logs = []
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

type Config = { mcp?: { servers?: Record<string, unknown> } }
const apply = (
  config: Config,
  options: Partial<Parameters<typeof injectMcpDefaultDeny>[1]> = {},
) =>
  injectMcpDefaultDeny(config, {
    codepuppyConfigPath,
    userConfigDir,
    logError: (message) => logs.push(message),
    ...options,
  })

describe("injectMcpDefaultDeny — G1 default-deny", () => {
  test("枚举三个用户全局文件的 mcp 并集,非治理项注入中和条目", () => {
    writeFileSync(join(userConfigDir, "config.json"), JSON.stringify({ mcp: { fetch: { type: "local" } } }))
    writeFileSync(join(userConfigDir, "opencode.json"), JSON.stringify({ mcp: { github: { type: "local" } } }))
    writeFileSync(join(userConfigDir, "opencode.jsonc"), JSON.stringify({ mcp: { markitdown: { type: "local" } } }))
    const config: Config = {}

    apply(config)

    expect(config.mcp?.servers).toEqual({
      fetch: OFF,
      github: OFF,
      markitdown: OFF,
    })
    expect(logs).toEqual([
      '[req109-535] default-denied user-global MCP names=["fetch","github","markitdown"]',
    ])
  })

  test("回归:仅写 G1 denial,codepuppy.jsonc 治理项不复制且既有 cloud/injected 不写 timeout", () => {
    writeFileSync(
      codepuppyConfigPath,
      JSON.stringify({ mcp: { governed: { type: "local", command: ["codepuppy-governed"] } } }),
    )
    writeFileSync(
      join(userConfigDir, "config.json"),
      JSON.stringify({
        mcp: {
          governed: { type: "local", command: ["global-collision"] },
          cloud: { type: "remote", url: "https://user.example/mcp" },
          injected: { type: "local", command: ["global-collision"] },
          stray: { type: "local", command: ["stray"] },
        },
      }),
    )
    const config = {
      mcp: {
        servers: {
          cloud: { type: "remote", url: "https://alpha.example/mcp" },
          injected: { type: "local", command: ["codepuppy-injected"] },
        } as Record<string, unknown>,
      },
    }

    // #223 R6:`cloud` 不再被写死成治理名 —— 注入面真放进 config.mcp 时才把它报进 injectedMcpNames
    // (代付的两条分支都会,kill-switch 下放的是中和条目)。
    apply(config, { injectedMcpNames: ["injected", "cloud"] })

    expect(config.mcp.servers.governed).toBeUndefined()
    expect(config.mcp.servers.cloud).toEqual({
      type: "remote",
      url: "https://alpha.example/mcp",
    })
    expect(config.mcp.servers.injected).toEqual({
      type: "local",
      command: ["codepuppy-injected"],
    })
    expect(config.mcp.servers.stray).toEqual(OFF)
    expect(
      Object.values(config.mcp.servers).every(
        (value) =>
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          !Object.hasOwn(value, "timeout"),
      ),
    ).toBe(true)
  })

  // #223 R6 Major:名字不是治理凭据。以前 `"cloud"` 是写死的治理名,于是**不代付时**用户全局配置
  // 里一个自称 cloud 的第三方 server 被永久豁免默认拒绝 —— 连 enabled:false 都不写。
  test("回归:注入面这一轮没放 cloud 时,用户全局的同名 server 照样进默认拒绝", () => {
    writeFileSync(codepuppyConfigPath, JSON.stringify({ mcp: {} }))
    writeFileSync(
      join(userConfigDir, "config.json"),
      JSON.stringify({ mcp: { cloud: { type: "remote", url: "https://user.example/mcp" } } }),
    )
    const config: Config = {}

    apply(config, {})

    expect(config.mcp!.servers!.cloud).toEqual(OFF)
  })
})

describe("injectMcpDefaultDeny — JSONC 与失败隔离", () => {
  test("comments/trailing commas 可解析;坏 JSONC 与不可读文件各自跳过,其余文件继续", () => {
    writeFileSync(join(userConfigDir, "config.json"), '{"mcp":{"broken":')
    writeFileSync(join(userConfigDir, "opencode.json"), JSON.stringify({ mcp: { unreadable: {} } }))
    writeFileSync(
      join(userConfigDir, "opencode.jsonc"),
      `{
        // user-global local tool
        "mcp": {
          "jsonc-ok": {
            "type": "local",
            "command": ["uvx", "safe-name"],
          },
        },
      }`,
    )
    const config: Config = {}
    const readFile = (file: string) => {
      if (basename(file) === "opencode.json") {
        const error = new Error("denied") as NodeJS.ErrnoException
        error.code = "EACCES"
        throw error
      }
      return readFileSync(file, "utf8")
    }

    expect(() => apply(config, { readFile })).not.toThrow()
    expect(config.mcp?.servers).toEqual({ "jsonc-ok": OFF })
    expect(logs.some((message) => message.includes("unparseable user-global MCP config skipped"))).toBe(true)
    expect(logs.some((message) => message.includes("unreadable user-global MCP config skipped"))).toBe(true)
    expect(logs.at(-1)).toBe('[req109-535] default-denied user-global MCP names=["jsonc-ok"]')
  })

  test("显式真实用户目录优先,完全忽略 OPENCODE_CONFIG_DIR decoy", () => {
    const saved = process.env.OPENCODE_CONFIG_DIR
    const decoy = join(root, "decoy")
    mkdirSync(decoy)
    writeFileSync(join(decoy, "config.json"), JSON.stringify({ mcp: { decoy: {} } }))
    writeFileSync(join(userConfigDir, "config.json"), JSON.stringify({ mcp: { real: {} } }))
    process.env.OPENCODE_CONFIG_DIR = decoy
    const config: Config = {}
    try {
      apply(config)
    } finally {
      if (saved === undefined) delete process.env.OPENCODE_CONFIG_DIR
      else process.env.OPENCODE_CONFIG_DIR = saved
    }

    expect(config.mcp?.servers).toEqual({ real: OFF })
    expect(config.mcp?.servers?.decoy).toBeUndefined()
  })

  test("空或不存在的用户全局目录 no-op 且不抛", () => {
    const config: Config = { mcp: { servers: { keep: { type: "local" } } } }

    expect(() => apply(config, { userConfigDir: join(root, "missing") })).not.toThrow()
    expect(config.mcp).toEqual({ servers: { keep: { type: "local" } } })
    expect(logs).toEqual([])
  })
})

// ── `#1381`:codepuppy.jsonc 里的远程条目不是治理凭据 ────────────────────────────────────────
describe("injectMcpDefaultDeny — `#1381` codepuppy.jsonc 的 type:\"remote\" 条目", () => {
  test("不在本轮注入名单的 codepuppy.jsonc 远程条目 ⇒ 压成中和条目并出声;它不再让同名的用户全局条目免于默认拒绝;本地条目照旧是治理来源", () => {
    writeFileSync(
      codepuppyConfigPath,
      JSON.stringify({
        mcp: {
          "stale-remote": { type: "remote", url: "https://stale.example/mcp" },
          "local-gov": { type: "local", command: ["codepuppy-governed"] },
        },
      }),
    )
    writeFileSync(
      join(userConfigDir, "config.json"),
      JSON.stringify({
        mcp: {
          "stale-remote": { type: "remote", url: "https://user.example/mcp" },
          "local-gov": { type: "local", command: ["global-collision"] },
        },
      }),
    )
    const config: Config = {}

    apply(config)

    expect(config.mcp?.servers).toEqual({ "stale-remote": OFF })
    expect(logs).toEqual([
      '[req109-535] default-denied user-global MCP names=["stale-remote"]',
      `[alpha-code#1381] default-denied remote MCP entries in ${codepuppyConfigPath} (not in the main-only truth file, so neither injected nor authorized) names=["stale-remote"]`,
    ])
  })

  test("本轮从真源注入的远程条目是治理来源:codepuppy.jsonc 同名远程条目不压、用户全局同名条目不拒、注入的条目一个字不动", () => {
    writeFileSync(codepuppyConfigPath, JSON.stringify({ mcp: { "my-mcp": { type: "remote", url: "https://old.example/mcp" } } }))
    writeFileSync(join(userConfigDir, "config.json"), JSON.stringify({ mcp: { "my-mcp": { type: "remote", url: "https://user.example/mcp" } } }))
    const config: Config = { mcp: { servers: { "my-mcp": { type: "remote", url: "https://mcp.example.com/mcp" } } } }

    apply(config, { injectedMcpNames: ["my-mcp"] })

    expect(config.mcp).toEqual({ servers: { "my-mcp": { type: "remote", url: "https://mcp.example.com/mcp" } } })
    expect(logs).toEqual([])
  })
})
