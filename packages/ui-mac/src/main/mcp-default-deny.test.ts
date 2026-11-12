// #535 / REQ-109 T6:G1 用户全局 MCP default-deny。
// 全部使用真临时目录;无网络、无 HOME 改写。仅不可读分支注入 readFile 以稳定模拟 EACCES。
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { engineMcpServers, injectMcpDefaultDeny, NEUTRALIZED_MCP_SERVER } from "./mcp-default-deny"

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
  // 审计 R1 第 2 条:2.x 原生写法 `mcp.servers.<name>` 以前被当成一台叫 `servers` 的 server,真正的那台照常启用。
  // 判据用上游自己的归一化(引擎 parseInfo 用的同一个函数):用户全局文档里它是一台启用的 server,注入的文档(加载在全局之后、
  // 按名字整条替换)里它是 disabled。v1 写法放在另一个文件里,同一轮一起拒。
  test("用户全局里 2.x 原生的 mcp.servers.ungoverned 与 v1 写法的条目都被拒:引擎眼里注入后是 disabled", () => {
    const native = { mcp: { servers: { ungoverned: { type: "remote", url: "https://ungoverned.example/mcp" } } } }
    writeFileSync(join(userConfigDir, "opencode.jsonc"), JSON.stringify(native))
    writeFileSync(join(userConfigDir, "opencode.json"), JSON.stringify({ mcp: { legacy_one: { type: "local", command: ["legacy-mcp"] } } }))
    const before = ConfigNormalize.normalize(native)
    if (before.type !== "normalized") throw new Error("upstream rejected the native user-global document")
    expect((before.encoded.mcp as { servers: Record<string, { disabled?: boolean }> }).servers.ungoverned?.disabled).toBeUndefined()

    const config: Config = {}
    apply(config)

    const after = ConfigNormalize.normalize(config)
    if (after.type !== "normalized") throw new Error("upstream rejected the injected document")
    const servers = (after.encoded.mcp as { servers: Record<string, { disabled?: boolean }> }).servers
    expect(servers.ungoverned?.disabled).toBe(true)
    expect(servers.legacy_one?.disabled).toBe(true)
    expect(Object.keys(servers).sort()).toEqual(["legacy_one", "ungoverned"])
    expect(logs).toEqual(['[req109-535] default-denied user-global MCP names=["legacy_one","ungoverned"]'])
  })

  // 名单与类型规则与上游归一化逐例比对(上游 normalize 本身做判官):原生表、v1 键、混写 + 超时、v1 里恰好叫 servers / timeout 的
  // server、只写 enabled 的叶子、同名时原生表胜出。上游丢掉的「解不出来」的条目这里多算进来(多拒无害)。
  test("engineMcpServers 与上游 ConfigNormalize.normalize 得出的 server 名单与类型一致", () => {
    const corpus: Array<Record<string, unknown>> = [
      { mcp: { servers: { a: { type: "remote", url: "https://a.example/mcp" }, b: { type: "local", command: ["b"] } } } },
      { mcp: { c: { type: "local", command: ["c"] }, d: { type: "remote", url: "https://d.example/mcp" } } },
      { mcp: { timeout: 5000, servers: { e: { type: "local", command: ["e"] } }, f: { type: "local", command: ["f"] } } },
      { mcp: { servers: { type: "local", command: ["named-servers"] } } },
      { mcp: { timeout: { type: "remote", url: "https://named-timeout.example/mcp" } } },
      { mcp: { g: { enabled: false }, h: { type: "local", command: ["h"], enabled: false } } },
      { mcp: { x: { type: "local", command: ["x"] }, servers: { x: { type: "remote", url: "https://x.example/mcp" } } } },
      {},
    ]
    const types = (servers: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(servers).map(([name, server]) => [name, (server as { type?: unknown }).type]))
    const upstream = (document: Record<string, unknown>) => {
      const normalized = ConfigNormalize.normalize(document)
      if (normalized.type !== "normalized") throw new Error(`upstream rejected ${JSON.stringify(document)}`)
      return types((normalized.encoded.mcp as { servers?: Record<string, unknown> } | undefined)?.servers ?? {})
    }
    for (const document of corpus) expect(types(engineMcpServers(document)), JSON.stringify(document)).toEqual(upstream(document))
    const undecodable = { mcp: { broken: { type: "local" } } }
    expect(upstream(undecodable)).toEqual({})
    expect(types(engineMcpServers(undecodable))).toEqual({ broken: "local" })
  })

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

  // 编排器 R1 跟进第 1 条:codepuppy.jsonc 经显式文件原样交给引擎,上游认它里面 2.x 原生的 `mcp.servers.<name>`。
  // 以前按原始键枚举,那台远程 server 被当成一个叫 `servers` 的非远程条目(还顺手成了「治理来源」),照常启用。
  test("codepuppy.jsonc 里 2.x 原生写法的远程条目同样压成中和条目;原生写法的本地条目照旧是治理来源", () => {
    const codepuppy = {
      mcp: {
        servers: {
          "native-remote": { type: "remote", url: "https://native.example/mcp" },
          "native-local": { type: "local", command: ["codepuppy-governed"] },
        },
      },
    }
    writeFileSync(codepuppyConfigPath, JSON.stringify(codepuppy))
    writeFileSync(join(userConfigDir, "config.json"), JSON.stringify({ mcp: { "native-local": { type: "local", command: ["global-collision"] } } }))
    const before = ConfigNormalize.normalize(codepuppy)
    if (before.type !== "normalized") throw new Error("upstream rejected the codepuppy.jsonc document")
    expect((before.encoded.mcp as { servers: Record<string, { disabled?: boolean }> }).servers["native-remote"]?.disabled).toBeUndefined()

    const config: Config = {}
    apply(config)

    const after = ConfigNormalize.normalize(config)
    if (after.type !== "normalized") throw new Error("upstream rejected the injected document")
    const servers = (after.encoded.mcp as { servers: Record<string, { disabled?: boolean }> }).servers
    expect(servers["native-remote"]?.disabled).toBe(true)
    expect(Object.keys(servers)).toEqual(["native-remote"])
    expect(logs).toEqual([
      `[alpha-code#1381] default-denied remote MCP entries in ${codepuppyConfigPath} (not in the main-only truth file, so neither injected nor authorized) names=["native-remote"]`,
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
