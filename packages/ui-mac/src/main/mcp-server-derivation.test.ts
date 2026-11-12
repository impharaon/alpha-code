// `#1381`(`#1383` 基线 §四 子票 4)—— 远程 MCP 服务器从真源派生的**端到端**判据,与 custom-provider-derivation.test.ts 同形:
//   正样本:真源里有一条远程 MCP ⇒ ①它的地址进了这一代放行集合;②引擎拿到的配置里有这条连接器(完整 type / url / headers,enabled:true)。
//   反样本(承重):往 codepuppy.jsonc 写一条 `type:"remote"` 的 MCP ⇒ **既不进放行集合,也不被引擎当成已治理的连接器启用**(注入面里是
//   中和条目 NEUTRALIZED_MCP_SERVER)。
// 真引擎那一半(`#1662` 起在嵌入式 OpenCode 2 上):mcp-server-derivation.engine.cases.ts 把生产注入交给沙箱里的嵌入式引擎,三个远程地址都是
// 本机一个记录请求的监听 —— 引擎只连真源地址(带真源的头),同名的用户全局地址、codepuppy.jsonc 与用户全局里不受治理的远程条目一个请求都
// 不发且是 disabled;手段自证去掉中和条目 ⇒ 引擎真的去连 exfil。本文件的宿主一条钉住它 2 pass / 0 fail。v1 版跑的是已删的
// `packages/opencode/src/index.ts debug config`。本文件其余各条判 main 侧:真源位置、注入面、放行集合。期望值手写字面量。

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { injectCodePuppyConfig } from "./codepuppy-config-injection"
import { NEUTRALIZED_MCP_SERVER } from "./mcp-default-deny"
import { PROVIDER_ALLOW_ENV } from "../../../ext/src/provider-allow"
import { environmentMutableRoot } from "./codepuppy-environment"
import { readMcpServerRecords, resolveMcpServerTruthLocation } from "./mcp-server-records"
import { writeMcpServerTruth } from "./mcp-server-truth-write"
import { deriveMcpEgressDestinations, isEgressAuthorizedForSidecar, setConfiguredEgressDestinations } from "./network-egress-derived"

const MANAGED = [
  "OPENCODE_CONFIG",
  "OPENCODE_CONFIG_CONTENT",
  "OPENCODE_CONFIG_DIR",
  "OPENCODE_MODELS_PATH",
  "CODEPUPPY_IDENTITY_DISABLE",
  "CODEPUPPY_BEHAVIOR_DISABLE",
  "CODEPUPPY_MODELS_DISABLE",
  "CODEPUPPY_AUTOMATION_DISABLE",
  "CODEPUPPY_READONLY_DISABLE",
  "CODEPUPPY_WEBSEARCH_DISABLE",
  "OPENCODE_ENABLE_EXA",
  "OPENCODE_EXPERIMENTAL",
  "CODEPUPPY_CLOUD_MCP_URL",
  "CODEPUPPY_CLOUD_MCP_ARM",
  "CODEPUPPY_CLOUD_MCP_DEF",
  "CODEPUPPY_CLOUD_MCP_SERVER",
  "CODEPUPPY_BASE_URL",
  "CODEPUPPY_DEFAULT_MODEL",
  "CODEPUPPY_GLOBAL_DIR",
  "CODEPUPPY_OPENCODE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  PROVIDER_ALLOW_ENV,
]
const saved: Record<string, string | undefined> = {}
let root = ""
let userData = ""
let stateRoot = ""
let envRoot = ""
let truthPath = ""
let codepuppyJsonc = ""
let xdgConfigHome = ""
let xdgUserGlobal = ""

const MY_MCP = { name: "my-mcp", url: "https://mcp.example.com/mcp", headers: { "X-Token": "t" } }
/** 围栏内一行 `printf … > file` 能写出的完整远程条目 —— 引擎原生合并它时什么都不缺。 */
const EXFIL_MCP = { type: "remote", url: "https://exfil-mcp.example/mcp" }

beforeAll(() => {
  for (const key of MANAGED) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mcp-server-derivation-")))
  userData = path.join(root, "userdata")
  stateRoot = path.join(root, "codepuppy-state")
  envRoot = environmentMutableRoot("dev", stateRoot)
  truthPath = path.join(stateRoot, "mcp-servers", "dev.json")
  codepuppyJsonc = path.join(envRoot, "codepuppy.jsonc")
  xdgConfigHome = path.join(root, "xdg-config")
  xdgUserGlobal = path.join(xdgConfigHome, "opencode", "config.json")
  for (const dir of [userData, envRoot, path.dirname(xdgUserGlobal), path.join(root, "dot-opencode"), path.join(root, "xdg-data"), path.join(root, "home"), path.join(root, "proj")])
    fs.mkdirSync(dir, { recursive: true })
  process.env.CODEPUPPY_GLOBAL_DIR = envRoot
  process.env.XDG_CONFIG_HOME = xdgConfigHome
  process.env.XDG_DATA_HOME = path.join(root, "xdg-data")
  process.env.CODEPUPPY_OPENCODE_HOME = path.join(root, "dot-opencode")
})

afterAll(() => {
  setConfiguredEgressDestinations([])
  for (const key of MANAGED) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  fs.rmSync(root, { recursive: true, force: true })
})

beforeEach(() => {
  setConfiguredEgressDestinations([])
  for (const file of [truthPath, codepuppyJsonc, xdgUserGlobal]) fs.rmSync(file, { force: true })
  delete process.env.OPENCODE_CONFIG_CONTENT
  delete process.env.OPENCODE_CONFIG
  delete process.env.OPENCODE_CONFIG_DIR
})

type McpMap = Record<string, Record<string, unknown>>

/** 生产注入面(sidecar 里 injectCodePuppyConfig 跑的那一份),只取它交给引擎的内联文档里的 `mcp.servers`(2.x 形状)。 */
function injectedMcp(): { content: string; mcp: McpMap; stderr: string[] } {
  const stderr: string[] = []
  const original = console.error
  console.error = (...args: unknown[]) => void stderr.push(args.map(String).join(" "))
  let content: string
  try {
    const result = injectCodePuppyConfig(userData, undefined, "stable")
    expect(result.ok).toBe(true)
    content = result.config.content
  } finally {
    console.error = original
  }
  return { content, mcp: (JSON.parse(content) as { mcp?: { servers?: McpMap } }).mcp?.servers ?? {}, stderr }
}

describe("#1381 真源位置:sidecar(CODEPUPPY_GLOBAL_DIR 逆映射)与自定义节点同一份解析;形状不对 ⇒ 位置未知,不猜", () => {
  test("位置 = <casBaseRoot>/mcp-servers/<env>.json,逐字等于手写路径;CODEPUPPY_GLOBAL_DIR 形状不对 ⇒ ok:false + 一行日志 + 什么都不派生", () => {
    expect(resolveMcpServerTruthLocation()).toEqual({ ok: true, path: truthPath, casBaseRoot: stateRoot, environment: "dev" })
    writeMcpServerTruth(truthPath, [MY_MCP], fs)
    expect(readMcpServerRecords(() => {})).toEqual([MY_MCP])
    const odd = path.join(root, "odd-root")
    fs.mkdirSync(odd, { recursive: true })
    process.env.CODEPUPPY_GLOBAL_DIR = odd
    try {
      const logs: string[] = []
      const location = resolveMcpServerTruthLocation()
      expect(location).toEqual({ ok: false, reason: `CODEPUPPY_GLOBAL_DIR ${odd} is not of the form <base>/env/<prod|beta|dev>; the remote MCP server truth location is unknown` })
      expect(readMcpServerRecords((l) => void logs.push(l))).toEqual([])
      expect(logs).toEqual([
        `remote MCP servers: truth location unresolved — CODEPUPPY_GLOBAL_DIR ${odd} is not of the form <base>/env/<prod|beta|dev>; the remote MCP server truth location is unknown; no remote MCP server is injected or authorized this generation`,
      ])
    } finally {
      process.env.CODEPUPPY_GLOBAL_DIR = envRoot
    }
  })
})

describe("#1381 端到端:真源里的远程 MCP 进放行集合与注入面;codepuppy.jsonc 里的远程条目两边都进不了(引擎那一半见宿主一条)", () => {
  test("正样本 + 反样本,同一份注入面:my-mcp 放行且注入完整条目;exfil-mcp 不放行且注入的是中和条目", () => {
    writeMcpServerTruth(truthPath, [MY_MCP], fs)
    fs.writeFileSync(codepuppyJsonc, JSON.stringify({ $schema: "https://opencode.ai/config.json", mcp: { "exfil-mcp": EXFIL_MCP, "local-ok": { type: "local", command: ["npx", "-y", "some-mcp"] } } }))
    // 用户全局(XDG)里一条同名条目指向别处,一条陌生条目 —— 前者由真源压过,后者照旧默认拒绝。
    fs.writeFileSync(xdgUserGlobal, JSON.stringify({ mcp: { "my-mcp": { type: "remote", url: "https://user-global.example/mcp" }, stray: { type: "local", command: ["stray"] } } }))

    // ① 生产注入面:真源条目完整注入;codepuppy.jsonc 的远程条目压成中和条目(2.x 的 disabled 远程条目);本地条目不复制;XDG 陌生条目默认拒绝。
    const injected = injectedMcp()
    expect(injected.mcp["my-mcp"]).toEqual({ type: "remote", url: "https://mcp.example.com/mcp", headers: { "X-Token": "t" } })
    expect(injected.mcp["exfil-mcp"]).toEqual({ ...NEUTRALIZED_MCP_SERVER })
    expect(injected.mcp["local-ok"]).toBeUndefined()
    expect(injected.mcp.stray).toEqual({ ...NEUTRALIZED_MCP_SERVER })
    expect(injected.stderr.filter((l) => l.includes("#1381"))).toEqual([
      `[alpha-code#1381] default-denied remote MCP entries in ${codepuppyJsonc} (not in the main-only truth file, so neither injected nor authorized) names=["exfil-mcp"]`,
    ])

    // ② 放行集合(与 server.ts refreshConfiguredEgressDestinations 同一个派生 + 同一个登记函数)
    const accepted = setConfiguredEgressDestinations(deriveMcpEgressDestinations(readMcpServerRecords(() => {})))
    expect(accepted.map((d) => `${d.host}:${d.port} (${d.providerId})`)).toEqual(["mcp.example.com:443 (mcp:my-mcp)"])
    expect(isEgressAuthorizedForSidecar("mcp.example.com", 443)).toBe(true)
    expect(isEgressAuthorizedForSidecar("exfil-mcp.example", 443)).toBe(false)
    expect(isEgressAuthorizedForSidecar("user-global.example", 443)).toBe(false)
  })

  test("手段自证:配置块当真源喂进派生 ⇒ 它真的被放行(引擎里「去掉中和条目 ⇒ 真的去连」见宿主一条)", () => {
    const leaked = setConfiguredEgressDestinations(deriveMcpEgressDestinations([{ name: "exfil-mcp", url: EXFIL_MCP.url }]))
    expect(leaked.map((d) => `${d.host}:${d.port}`)).toEqual(["exfil-mcp.example:443"])
    expect(isEgressAuthorizedForSidecar("exfil-mcp.example", 443)).toBe(true)
  })

  test("真源坏了 ⇒ 一条不注入、一条不放行,并说得出原因(不是「没有记录」)", () => {
    fs.mkdirSync(path.dirname(truthPath), { recursive: true })
    fs.writeFileSync(truthPath, "{ not json")
    fs.writeFileSync(codepuppyJsonc, JSON.stringify({ $schema: "https://opencode.ai/config.json" }))
    const injected = injectedMcp()
    expect(injected.mcp["my-mcp"]).toBeUndefined()
    const rejected = injected.stderr.filter((l) => l.startsWith("remote MCP servers: truth file"))
    expect(rejected.length).toBe(1)
    expect(rejected[0]!.startsWith(`remote MCP servers: truth file ${truthPath} rejected — not JSON (`)).toBe(true)
    expect(rejected[0]).toContain('nothing is derived from it (this is "unanswerable", not an empty list) until the app rewrites it')
    const logs: string[] = []
    expect(setConfiguredEgressDestinations(deriveMcpEgressDestinations(readMcpServerRecords((l) => void logs.push(l))))).toEqual([])
    expect(logs.length).toBe(1)
    expect(isEgressAuthorizedForSidecar("mcp.example.com", 443)).toBe(false)
  })

  // `#1662`:真引擎那一半(正样本 + 反样本 + 手段自证)在嵌入式 OpenCode 2 上,独立进程跑(沙箱要在上游模块装载之前改指 HOME / XDG)。
  test("宿主:嵌入式引擎只连真源地址(带真源的头),不受治理的远程条目零请求且 disabled;去掉中和条目 ⇒ 真的去连(mcp-server-derivation.engine.cases.ts,2 条)", async () => {
    const child = Bun.spawn({
      cmd: [process.execPath, "test", "--timeout", "120000", path.join(import.meta.dir, "mcp-server-derivation.engine.cases.ts")],
      cwd: path.join(import.meta.dir, "../.."),
      // 子进程拿进本文件之前的环境(本文件改过的 CODEPUPPY_GLOBAL_DIR / XDG_* 等不带进去)
      env: Object.fromEntries(Object.entries({ ...process.env, ...saved }).filter((entry): entry is [string, string] => entry[1] !== undefined)),
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    const output = `${stdout}${stderr}`
    if (exitCode !== 0) throw new Error(output)
    expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
    expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("2")
  }, 300_000)
})
