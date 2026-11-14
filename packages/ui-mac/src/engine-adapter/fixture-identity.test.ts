// `#1697`(I-04 M5a,设计 §4.10 e、§4.9、R10):采样夹具对得上当前的引擎源码 —— 每个夹具记下的引擎身份(采样器写的
// `_engine`)按同一规则从当前树重算,不等就红并逐个点名、提示重跑采样器;引擎包一改(上游进入、Code Puppy 接管改动),
// 适配器的测试就不会再在旧样本上假绿。终端 WebSocket 不经 fetch、翻译器拦不到(设计 §4.9 的具名例外):冻结的地址拼接在这里
// 对照引擎协议自己的 PTY 连接路由描述,引擎挪了这个路径就红。
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { terminalWebSocketURL } from "../../../codepuppy-app/src/utils/terminal-websocket-url"
import { PTY_CONNECT_PATH, hasPtyConnectTicketURL } from "../../../protocol/src/groups/pty"
import {
  engineClosure,
  engineIdentity,
  staleFixtures,
  type EngineIdentity,
} from "../../test-fixtures/engine-adapter-sampler/engine-identity"

const REPO = resolve(import.meta.dir, "../../../..")
const DIR = join(import.meta.dir, "fixtures")
const FIXTURES = Object.fromEntries(
  readdirSync(DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [name, JSON.parse(readFileSync(join(DIR, name), "utf8")) as { _engine?: EngineIdentity }]),
)
const CURRENT = engineIdentity(REPO)
const RESAMPLE = "重跑采样器:~/.bun-versions/1.4.4/bin/bun packages/ui-mac/test-fixtures/engine-adapter-sampler/sample.ts"

describe("#1697 采样夹具的引擎源码身份(设计 §4.10 e)", () => {
  test("自检:闭包从 packages/cli 出发,含引擎的核心包;夹具都读到了", () => {
    const closure = engineClosure(REPO)
    for (const dir of ["packages/cli", "packages/core", "packages/server", "packages/schema", "packages/client"]) expect(closure).toContain(dir)
    expect(closure.length).toBeGreaterThanOrEqual(15) // 2026-11-12 实测 17
    expect(Object.keys(FIXTURES).length).toBeGreaterThanOrEqual(13)
  })

  test("每个夹具记下的引擎身份等于当前树重算的(不等即点名,并提示重跑采样器)", () => {
    expect(staleFixtures(FIXTURES, CURRENT), RESAMPLE).toEqual([])
  })

  test("反向臂:身份里改一个包的 tree id、闭包少一个包、没有身份 —— 各被点名", () => {
    const changed = { ...CURRENT, packages: { ...CURRENT.packages, "packages/core": "0".repeat(40) } }
    expect(staleFixtures({ "a.json": { _engine: changed } }, CURRENT)).toEqual([
      `a.json: packages/core ${"0".repeat(10)} → ${CURRENT.packages["packages/core"]!.slice(0, 10)}`,
    ])
    const { "packages/server": _dropped, ...rest } = CURRENT.packages
    expect(staleFixtures({ "b.json": { _engine: { ...CURRENT, packages: rest } } }, CURRENT)).toEqual([
      `b.json: packages/server — → ${CURRENT.packages["packages/server"]!.slice(0, 10)}`,
    ])
    expect(staleFixtures({ "c.json": {} }, CURRENT)).toEqual(["c.json: 没有引擎身份"])
  })
})

describe("#1697 终端 WebSocket 的具名例外(设计 §4.9、R10)", () => {
  const url = terminalWebSocketURL({ url: "http://127.0.0.1:4096", id: "pty_1", directory: "/proj", cursor: 0, ticket: "t1" })

  test("冻结终端拼出的地址落在引擎协议的 PTY 连接路由上(路径模板与带票据的判定都对得上)", () => {
    expect(PTY_CONNECT_PATH).toBe("/api/pty/:ptyID/connect")
    expect(url.pathname).toBe(PTY_CONNECT_PATH.replace(":ptyID", "pty_1"))
    expect(hasPtyConnectTicketURL(url)).toBe(true)
  })

  test("反向臂:路径挪了一段、或丢了票据 ⇒ 引擎的判定不认", () => {
    const moved = new URL(url)
    moved.pathname = "/api/terminal/pty_1/connect"
    expect(hasPtyConnectTicketURL(moved)).toBe(false)
    const noTicket = new URL(url)
    noTicket.searchParams.delete("ticket")
    expect(hasPtyConnectTicketURL(noTicket)).toBe(false)
  })
})
