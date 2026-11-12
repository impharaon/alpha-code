import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { probeProjectMcpActivation, verifyInstalledMcp } from "./ext-mcp-activation"
import { PROJECT_HIDDEN_DIR } from "../shared/project-hidden-dir"

let tmp: string
let project: string
const previousConfigContent = process.env.OPENCODE_CONFIG_CONTENT
const durableLeaf = { type: "local", command: ["npx", "-y", "demo-mcp@1.0.0"] }

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "project-mcp-activation-"))
  project = join(tmp, "D")
  mkdirSync(join(project, PROJECT_HIDDEN_DIR), { recursive: true })
  project = realpathSync(project)
  writeFileSync(
    join(project, PROJECT_HIDDEN_DIR, "codepuppy.jsonc"),
    JSON.stringify({ mcp: { demo: durableLeaf } }, null, 2),
  )
  delete process.env.OPENCODE_CONFIG_CONTENT
})

afterEach(() => {
  if (previousConfigContent === undefined) delete process.env.OPENCODE_CONFIG_CONTENT
  else process.env.OPENCODE_CONFIG_CONTENT = previousConfigContent
  rmSync(tmp, { recursive: true, force: true })
})

const ready = async () => ({
  url: "http://127.0.0.1:39117",
  username: "opencode",
  password: "route-password",
})

function fetchFor(
  handler: (url: URL) => Response,
  requests: URL[],
): typeof fetch {
  return (async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(new Request(request, init).url)
    requests.push(url)
    return handler(url)
  }) as typeof fetch
}

const emptyGlobalNames = () => ({ ok: true as const, names: [] as string[] })

// `#1667`:OpenCode 2 的形状 —— `GET /api/config` 给这个 Location 的配置文档数组,`GET /api/mcp` 给 `{ location, data: Mcp.Server[] }`;
// 目录经 `location[directory]` 查询参数选 Location(上游客户端 `@opencode/client` 的编码)。
const doc = (servers?: Record<string, unknown>) => ({ type: "document", info: servers ? { mcp: { servers } } : {} })
const mcpList = (servers: Record<string, Record<string, unknown>>) =>
  Response.json({ location: { directory: "x" }, data: Object.entries(servers).map(([name, status]) => ({ name, status })) })
const at = (url: URL) => url.searchParams.get("location[directory]")

describe("project MCP activation provenance probe (REQ-136 C5)", () => {
  test("returns active only after config-document absence + D-scoped connected status", async () => {
    const requests: URL[] = []
    const verdict = await probeProjectMcpActivation("demo", project, ready, {
      configuredGlobalNames: emptyGlobalNames,
      fetch: fetchFor((url) => {
        if (url.pathname === "/api/config") return Response.json([doc(), { type: "directory", path: "/x" }])
        if (url.pathname === "/api/mcp") return mcpList({ demo: { status: "connected" } })
        return new Response(null, { status: 404 })
      }, requests),
    })
    expect(verdict).toBe("active")
    expect(requests.map((url) => url.pathname)).toEqual(["/api/config", "/api/mcp"])
    expect(requests.map(at)).toEqual([project, project])
  })

  test("#1563: a provenance-proven D leaf whose engine status is pending is pending, not unverifiable", async () => {
    const verdict = await probeProjectMcpActivation("demo", project, ready, {
      configuredGlobalNames: emptyGlobalNames,
      fetch: fetchFor((url) => (url.pathname === "/api/config" ? Response.json([doc()]) : mcpList({ demo: { status: "pending" } })), []),
    })
    expect(verdict).toBe("pending")
  })

  test("accepts JSONC trailing commas in the durable project file", async () => {
    writeFileSync(join(project, PROJECT_HIDDEN_DIR, "codepuppy.jsonc"), `{"mcp":{"demo":${JSON.stringify(durableLeaf)},},}`)
    const verdict = await probeProjectMcpActivation("demo", project, ready, {
      configuredGlobalNames: emptyGlobalNames,
      fetch: fetchFor((url) => (url.pathname === "/api/config" ? Response.json([doc()]) : mcpList({ demo: { status: "connected" } })), []),
    })
    expect(verdict).toBe("active")
  })

  test("strict global same-name hit is shadowed and cannot borrow a misleading name-only status", async () => {
    let awaitCalls = 0
    const verdict = await probeProjectMcpActivation(
      "demo",
      project,
      async () => {
        awaitCalls++
        return ready()
      },
      { configuredGlobalNames: () => ({ ok: true, names: ["demo"] }) },
    )
    expect(verdict).toBe("shadowed")
    expect(awaitCalls).toBe(0)
  })

  test("any config document defining the name shadows (even an identical leaf, even the injected neutralized one) and skips the status read", async () => {
    for (const servers of [{ demo: durableLeaf }, { demo: { type: "remote", url: "http://127.0.0.1:1/codepuppy-mcp-disabled", disabled: true } }]) {
      const requests: URL[] = []
      const verdict = await probeProjectMcpActivation("demo", project, ready, {
        configuredGlobalNames: emptyGlobalNames,
        fetch: fetchFor((url) => (url.pathname === "/api/config" ? Response.json([doc(), doc(servers)]) : mcpList({ demo: { status: "connected" } })), requests),
      })
      expect(verdict).toBe("shadowed")
      expect(requests.map((url) => url.pathname)).toEqual(["/api/config"])
    }
  })

  test("unreadable config documents are unverifiable and never become connected", async () => {
    const requests: URL[] = []
    const verdict = await probeProjectMcpActivation("demo", project, ready, {
      configuredGlobalNames: emptyGlobalNames,
      fetch: fetchFor((url) =>
        url.pathname === "/api/config"
          ? Response.json({ error: "unreadable" }, { status: 500 })
          : mcpList({ demo: { status: "connected" } }), requests),
    })
    expect(verdict).toBe("unverifiable")
    expect(requests.map((url) => url.pathname)).toEqual(["/api/config"])

    writeFileSync(join(project, PROJECT_HIDDEN_DIR, "codepuppy.jsonc"), '{"mcp":{"demo":')
    const malformed = await probeProjectMcpActivation("demo", project, ready, {
      configuredGlobalNames: emptyGlobalNames,
      fetch: (async () => {
        throw new Error("durable parse failure must stop before HTTP")
      }) as typeof fetch,
    })
    expect(malformed).toBe("unverifiable")
  })

  test("a symlinked durable project config is unverifiable before any engine request", async () => {
    const target = join(project, PROJECT_HIDDEN_DIR, "codepuppy.jsonc")
    const outside = join(tmp, "outside-alpha.jsonc")
    writeFileSync(outside, JSON.stringify({ mcp: { demo: durableLeaf } }))
    unlinkSync(target)
    symlinkSync(outside, target)
    let awaitCalls = 0

    const verdict = await probeProjectMcpActivation(
      "demo",
      project,
      async () => {
        awaitCalls++
        return ready()
      },
      { configuredGlobalNames: emptyGlobalNames },
    )
    expect(verdict).toBe("unverifiable")
    expect(awaitCalls).toBe(0)
  })

  test("matching leaf cannot borrow an unscoped connected status", async () => {
    const requests: URL[] = []
    const verdict = await probeProjectMcpActivation("demo", project, ready, {
      configuredGlobalNames: emptyGlobalNames,
      fetch: fetchFor((url) => {
        if (url.pathname === "/api/config") return Response.json([doc()])
        if (url.pathname === "/api/mcp" && at(url) === null) return mcpList({ demo: { status: "connected" } })
        return mcpList({ demo: { status: "failed", error: "boom" } })
      }, requests),
    })
    expect(verdict).toBe("unverifiable")
    expect(requests.at(-1)?.pathname).toBe("/api/mcp")
    expect(at(requests.at(-1)!)).toBe(project)
  })
})

// `#1563`:引擎后台启动 MCP,进行中报 `pending`。它是「准备中」,不能被核验读成 failed —— 读成 failed 时定制中心会把一台
// 正在连的服务当失败、给出只会打断会话的「现在重载」。`#1667`:2.x 的 `Mcp.Status` pending 不带上一次失败(`error` 只在
// failed / needs_auth 上),所以 v1 时代「后台重连附上次失败」那一格不再有来源。
describe("installed MCP verification reads the engine's pending phase (#1563)", () => {
  const verify = (servers: Record<string, Record<string, unknown>>) =>
    verifyInstalledMcp("demo", project, ready, fetchFor(() => mcpList(servers), []), { awaitServer: 1_000, status: 1_000 })

  test("pending stays pending (准备中)", async () => {
    expect(await verify({ demo: { status: "pending" } })).toEqual({ reference: "demo", status: "pending" })
  })

  test("needs_auth passes through; disabled stays disabled", async () => {
    expect(await verify({ demo: { status: "needs_auth", error: "login" } })).toEqual({ reference: "demo", status: "needs_auth" })
    expect(await verify({ demo: { status: "disabled" } })).toEqual({ reference: "demo", status: "disabled" })
  })

  test("control: a failed server is still failed; an absent server is failed", async () => {
    expect(await verify({ demo: { status: "failed", error: "boom" } })).toEqual({ reference: "demo", status: "failed" })
    expect(await verify({ other: { status: "connected" } })).toEqual({ reference: "demo", status: "failed" })
  })
})
