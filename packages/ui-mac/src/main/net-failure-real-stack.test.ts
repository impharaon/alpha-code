// `#1572` AC4 —— 引擎在错误被压成一段文本之前取层,对着**真运行时**钉住(#1662 起是 OpenCode 2):
//   · Electron 内嵌 node(= 出货 sidecar 的 utilityProcess 运行时;Node 自带的 undici 由 http.setGlobalProxyFromEnv 接上代理)。
//     分类读的是这个运行时的原文:tls-silent 那一条是 undici 目标 TLS connector 的 10 s 计时器先于代理的 15 s 兜底到点
//     (原文带 `attempted address`);代理拒绝 / 拨号失败的码在 undici 的 `Proxy response (NNN) !== 200 when HTTP Tunneling` 里。
//     ext 也在这里装载 —— ext 包在 bun 里装得上、在 Electron node 里装不上的情况实测出现过(见 packages/ext/scripts/build.ts 的 jsonc-parser)。
//   · 真引擎:生产 `scripts/build-engine.ts` 现打的 `dist-engine/engine.mjs`,再经生产 main 构建(electron.vite.config.ts 的 main 一段,
//     sidecar 的 virtual:opencode-server 解析到它)打成的 engine chunk —— 出货 out/main/chunks/engine-*.js 的同一份(`#1662`);
//     由 test-fixtures/net-failure/engine-driver.ts 按 sidecar.ts `start()` 的顺序起:生产注入 → 代理变量 + setGlobalProxyFromEnv
//     → import 引擎 → startEngine(生产选项)→ 生产 assertExtPluginActive。
//   · 真 ext:生产 `packages/ext` 构建现打的 `dist/server.js`(dev 下 main 交给 sidecar 的就是这个目录);层由它的 execute.after
//     (packages/ext/src/policy/display.ts attachNetFailure)写进失败工具的 metadata。
//   · 真出网代理(生产 startEgressPolicyProxy;授权 / 拨号为测试注入,只认本文件的几个名字),env 由生产 sidecarEgressProxyEnv 给出;
//   · 真 webfetch 入口(OpenCode 2 自己的 webfetch):一个本机 OpenAI 兼容替身(平台节点经 CODEPUPPY_BASE_URL 指向它)让模型一次调用
//     六个 webfetch,引擎照常执行、照常结算、照常落库;本文件经引擎监听端口读回**持久化的消息**,再用桌面的生产适配层
//     (engine-adapter/v1-shapes.ts toV1Messages)投影成时间线读的工具记录。
// 五种靶 ⇒ metadata.codepuppyNetFailure.layer:代理 403 ⇒ policy、`.invalid` ⇒ dns(503)、拒连 ⇒ tcp(502)、拨号黑洞 ⇒ tcp(504)、
// 隧道开了上游只收不回 ⇒ tls-silent;第六个用 webfetch 自己的期限 ⇒ timeout。
// main 臂:同一 Electron node 不设代理直连只收不回的监听 ⇒ 生产分类模块按 main 路径说 connect-timeout(不是 tls-silent)。
//
// 已知的坏(2026-11-12 逐条实跑):去掉 ext execute.after 里的 attachNetFailure ⇒ 六条记录都没有 codepuppyNetFailure(只剩 webfetch
// 的原文);去掉 ext 构建对 jsonc-parser 的 ESM 解析 ⇒ ext 在 Electron node 里装不上,引擎不就绪,整份红;把出网代理的 dns 状态码
// 改回 502 ⇒ dns 那条变 tcp;把分类模块里「经出网代理」的握手判定去掉 ⇒ silent 那条变 connect-timeout。`#1662`(2026-11-12 实跑):
// 引擎包留着上游 banner 的 CommonJS 四句(build-engine.ts 改回只去 shebang)⇒ main 构建报 `"__cjs_mod__" has already been declared`,整份红。
// 本文件会重写 packages/ext/dist 与 packages/ui-mac/dist-engine(两处都是生产构建的落点、不入库),量的是当前源码打出的包;
// main 构建的输出在驱动的临时目录里,不碰 out/。
// darwin-only(Electron 运行时与 node_modules 里那份 Electron 的 RunAsNode fuse);darwin 上缺运行时或构建失败即 throw「本次测量作废」,
// 非 darwin 自报 skip,由 scripts/gate-files.tsv 按 [平台:darwin] 登记。

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as http from "node:http"
import { createRequire } from "node:module"
import * as net from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { __resetEgressGrantsForTests } from "./network-egress-grants"
import { startEgressPolicyProxy, type EgressLogRecord, type EgressProxyHandle } from "./network-egress-proxy"
import { sidecarEgressProxyEnv } from "./sidecar-env"
import { secretFilePath, secretFileRef } from "./codepuppy-secret-files"
import { ISOLATED_KEYS, isInside, isolatedEnv, testRoot } from "../../../../scripts/test-isolation/env"
import { toV1Messages } from "../engine-adapter/opencode2/v1-shapes"
import type { ToolPart } from "@opencode-ai/sdk/v2/client"
import { toolCardBodyOf } from "../renderer/codepuppy-ui/session-timeline/cards/tool-card-model"
import { netFailureCopy } from "../renderer/codepuppy-ui/net-failure-copy"
import { setLocale } from "../renderer/i18n"
import type { DriverInput } from "../../test-fixtures/net-failure/engine-driver"

const describeDarwin = process.platform === "darwin" ? describe : describe.skip
const require = createRequire(import.meta.url)
const UI_MAC = resolve(import.meta.dir, "../..")
const EXT = resolve(UI_MAC, "../ext")
const FIXTURES = resolve(UI_MAC, "test-fixtures/net-failure")
const PASSWORD = "ac1572-real-stack"

const TARGETS = {
  policy: "ac1572-policy.test",
  dns: "ac1572-nx.invalid",
  refused: "ac1572-refused.test",
  blackhole: "ac1572-blackhole.test",
  silent: "ac1572-silent.test",
  timeout: "ac1654-timeout.test",
} as const

type ToolRecord = { tool: string; state: { status: string; input: { url?: string }; error?: string; metadata?: Record<string, unknown> } }

/**
 * 生产构建脚本照原样跑一遍;失败即本次测量作废。不带 bun test 置的 NODE_ENV=test:vite 据它判非生产,把 ws 的可选依赖
 * utf-8-validate 打成模块顶层的 throw,引擎包一 import 就炸(实测);prebuild 跑在不带 NODE_ENV 的环境里。
 */
function build(cmd: string[], cwd: string, what: string) {
  const { NODE_ENV: _test, ...env } = process.env
  const result = Bun.spawnSync({ cmd, cwd, env })
  if (result.exitCode !== 0) throw new Error(`${what} failed(本次测量作废):\n${result.stdout.toString()}${result.stderr.toString()}`.slice(-4000))
}

describeDarwin("`#1572` AC4 真栈:Electron 内嵌 node + 真出网代理 + 真 webfetch ⇒ 持久化的工具记录带层", () => {
  let scratch = ""
  let driverDir = ""
  let electron = ""
  let proxy: EgressProxyHandle | undefined
  const proxyLog: EgressLogRecord[] = []
  const servers: Array<http.Server | net.Server> = []
  let engine: ChildProcess | undefined
  const engineLog: string[] = []
  let silentPort = 0
  const silentSockets = new Set<net.Socket>() // 只收不回的连接没人会关;收尾时主动断开,否则 server.close 要等近一分钟
  let records: ToolRecord[] = []

  beforeAll(async () => {
    const electronPkg = dirname(require.resolve("electron/package.json"))
    electron = join(electronPkg, "dist", readFileSync(join(electronPkg, "path.txt"), "utf8").trim())
    if (!existsSync(electron)) throw new Error(`electron binary missing at ${electron}(本次测量作废)`)
    scratch = mkdtempSync(join(tmpdir(), "ac1572-real-stack-"))
    __resetEgressGrantsForTests()

    // 真 ext 与真引擎:生产构建脚本原样跑(prebuild.ts 同两步),产物落在 dev 下 main / electron-vite 取它们的位置。
    build([process.execPath, "run", "build"], EXT, "ext bundle (packages/ext scripts/build.ts)")
    build([process.execPath, join(UI_MAC, "scripts/build-engine.ts")], UI_MAC, "engine bundle (scripts/build-engine.ts)")
    const extDir = join(EXT, "dist")
    // 驱动放进 ui-mac 的 node_modules 底下:external 的 jsonc-parser(UMD 包,内联后找不到它自己的 ./impl/*)要像出货包那样从 ui-mac 的依赖里解析到。
    mkdirSync(join(UI_MAC, "node_modules/.cache"), { recursive: true })
    driverDir = mkdtempSync(join(UI_MAC, "node_modules/.cache/ac1572-real-stack-"))
    // `#1662`:出货的引擎是 main 构建把 dist-engine/engine.mjs 再打成的 out/main/chunks/engine-*.js(CommonJS 前导代码由 main 的
    // banner 给,引擎包自己不带)。生产 main 构建原样跑一遍(输出换到驱动目录下,不碰 out/),装的就是它打出的那个 chunk。
    build([process.execPath, join(FIXTURES, "build-main.ts"), join(driverDir, "out")], UI_MAC, "main bundle (electron.vite.config.ts main)")
    const chunks = join(driverDir, "out", "main", "chunks")
    const engineChunks = readdirSync(chunks).filter((name) => /^engine-.*\.js$/.test(name))
    if (engineChunks.length !== 1) throw new Error(`main build produced ${engineChunks.length} engine chunk(s) in ${chunks}(本次测量作废)`)
    const engineBundle = join(chunks, engineChunks[0]!)
    const driver = await Bun.build({ target: "node", entrypoints: [join(FIXTURES, "engine-driver.ts")], outdir: driverDir, format: "esm", external: ["jsonc-parser"] })
    if (!driver.success) throw new Error(`driver bundle failed(本次测量作废):\n${driver.logs.map(String).join("\n")}`)

    // 上游靶:拒连 = 先听再关的端口;只收不回 = 接受连接、一个字节都不写(隧道开了、握手没回应)。
    const closed = net.createServer()
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", r))
    const closedPort = (closed.address() as net.AddressInfo).port
    await new Promise<void>((r) => closed.close(() => r()))
    const silent = net.createServer((socket) => void silentSockets.add(socket.on("error", () => {})))
    await new Promise<void>((r) => silent.listen(0, "127.0.0.1", r))
    silentPort = (silent.address() as net.AddressInfo).port
    servers.push(silent)

    proxy = await startEgressPolicyProxy({
      log: (record) => void proxyLog.push(record),
      authorize: (host) => host !== TARGETS.policy && Object.values(TARGETS).includes(host as never),
      dial: (host, port) => {
        if (host === TARGETS.refused) return net.connect(closedPort, "127.0.0.1")
        if (host === TARGETS.blackhole) return new net.Socket()
        if (host === TARGETS.silent || host === TARGETS.timeout) return net.connect(silentPort, "127.0.0.1")
        return net.connect({ host, port, autoSelectFamily: true }) // .invalid:生产拨号,DNS 在代理进程里真失败
      },
      dialTimeoutMs: 1_000,
    })

    // 模型替身(loopback,经 NO_PROXY 直连,不过出网代理):带工具表的那一轮一次调用六个 webfetch,收到工具结果后收尾;
    // 不带工具表的请求(例如标题)只回一句话。
    const llm = http.createServer((req, res) => {
      let body = ""
      req.on("data", (c: Buffer) => (body += c.toString()))
      req.on("end", () => {
        const request = JSON.parse(body) as { messages?: Array<{ role?: string }>; tools?: Array<{ function?: { name?: string } }> }
        const wantsFetch = request.tools?.some((tool) => tool.function?.name === "webfetch") && !request.messages?.some((m) => m.role === "tool")
        res.writeHead(200, { "content-type": "text/event-stream" })
        const chunk = (delta: unknown, finish: string | null) =>
          res.write(`data: ${JSON.stringify({ id: "ac1572", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`)
        if (!wantsFetch) {
          chunk({ role: "assistant", content: "done" }, null)
          chunk({}, "stop")
        } else {
          chunk(
            {
              role: "assistant",
              tool_calls: Object.values(TARGETS).map((host, index) => ({
                index,
                id: `call_${index}`,
                type: "function",
                function: { name: "webfetch", arguments: JSON.stringify({ url: `https://${host}/ac1572?token=SECRET-NEEDLE-1572`, ...(host === TARGETS.timeout ? { timeout: 1 } : {}) }) },
              })),
            },
            null,
          )
          chunk({}, "tool_calls")
        }
        res.end("data: [DONE]\n\n")
      })
    })
    await new Promise<void>((r) => llm.listen(0, "127.0.0.1", r))
    servers.push(llm)
    const llmPort = (llm.address() as net.AddressInfo).port

    // 隔离:HOME / XDG_* 落在本文件的临时目录里(它本身在共享隔离预载的根下);合成的平台凭据文件,从不读真的。
    const home = join(scratch, "home")
    const userData = join(scratch, "userdata")
    const workspace = join(scratch, "ws")
    const globalDir = join(scratch, "codepuppy-state", "env", "dev") // 注入只认 <base>/env/<prod|beta|dev>
    for (const dir of [home, userData, workspace, join(scratch, "engine-config"), globalDir]) mkdirSync(dir, { recursive: true })
    const key = secretFilePath(userData, "CODEPUPPY_API_KEY")
    mkdirSync(dirname(key), { recursive: true })
    writeFileSync(key, "sk-cp-ac1572-synthetic", { mode: 0o600 })
    const env = isolatedEnv({
      HOME: home,
      XDG_DATA_HOME: join(home, ".local", "share"),
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_STATE_HOME: join(home, ".local", "state"),
      ELECTRON_RUN_AS_NODE: "1",
      ...sidecarEgressProxyEnv(proxy.port),
      CODEPUPPY_GLOBAL_DIR: globalDir,
      CODEPUPPY_BASE_URL: `http://127.0.0.1:${llmPort}/v1`,
      CODEPUPPY_PLATFORM_AUTH_REF: secretFileRef(userData, "CODEPUPPY_API_KEY"),
      NO_COLOR: "1",
    })
    const outside = ISOLATED_KEYS.filter((name) => env[name] !== undefined && !isInside(testRoot(), env[name]!))
    if (outside.length) throw new Error(`REFUSING TO RUN: engine env keys outside the test root: ${outside.join(", ")}`)

    const input: DriverInput = {
      engine: engineBundle,
      ext: extDir,
      password: PASSWORD,
      userData,
      workspace,
      databasePath: join(scratch, "engine.db"),
      configDirectory: join(scratch, "engine-config"),
    }
    engine = spawn(electron, [join(driverDir, "engine-driver.js"), JSON.stringify(input)], { cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"] })
    engine.stdout?.on("data", (c: Buffer) => engineLog.push(c.toString()))
    engine.stderr?.on("data", (c: Buffer) => engineLog.push(c.toString()))
    const listening = Date.now() + 60_000
    let origin = ""
    while (!(origin = /LISTENING (http:\/\/\S+)/.exec(engineLog.join(""))?.[1] ?? "")) {
      // 驱动在 ext 装上之前不报 LISTENING(sidecar 同样不报 ready):ext 装不上是产品缺陷,原因在日志尾。
      if (Date.now() > listening || engine.exitCode !== null) throw new Error(`engine under Electron node never became ready:\n${engineLog.join("").slice(-3000)}`)
      await Bun.sleep(100)
    }

    const api = async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`${origin}${path}`, {
        method,
        headers: {
          authorization: `Basic ${Buffer.from(`opencode:${PASSWORD}`).toString("base64")}`,
          "content-type": "application/json",
          "x-opencode-directory": encodeURIComponent(workspace),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      })
      const text = await res.text()
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 500)}\n${engineLog.join("").slice(-2000)}`)
      return (text ? JSON.parse(text) : undefined) as { data?: unknown } | undefined
    }
    const session = (await api("POST", "/api/session", { location: { directory: workspace }, model: { id: "m", providerID: "codepuppy" } }))!.data as { id: string }
    await api("POST", `/api/session/${session.id}/prompt`, { text: "fetch them" })
    await api("POST", `/api/experimental/session/${session.id}/wait`)
    const stored = (await api("GET", `/api/session/${session.id}/message?order=asc&limit=200`))!.data as Parameters<typeof toV1Messages>[1]
    records = toV1Messages(session.id, stored)
      .flatMap((m) => m.parts)
      .filter((p): p is (typeof p & ToolRecord) => p.type === "tool" && (p as { tool?: string }).tool === "webfetch")
    console.log(`[#1572 真栈] ${records.map((r) => `${r.state.input.url?.split("/")[2]} → ${r.state.status} ${JSON.stringify(r.state.metadata?.codepuppyNetFailure)}`).join(" | ")}`)
  }, 180_000)

  afterAll(async () => {
    engine?.kill("SIGKILL")
    await proxy?.close()
    for (const socket of silentSockets) socket.destroy()
    for (const server of servers) await new Promise<void>((r) => server.close(() => r()))
    for (const dir of [scratch, driverDir]) if (dir) rmSync(dir, { recursive: true, force: true })
  })

  const recordFor = (host: string) => {
    const record = records.find((r) => r.state.input.url?.includes(`//${host}/`))
    if (!record) throw new Error(`no persisted webfetch record for ${host} — got ${records.length} record(s)`)
    return record
  }

  test("六个 webfetch 都经出网代理失败,并作为工具记录落库", () => {
    expect(records).toHaveLength(6)
    for (const record of records) expect(record.state.status).toBe("error")
    // 失败确实发生在出网代理上:policy 一条拒绝、三条拨号失败各自的码、silent / timeout 两条放行。
    // (引擎启动时自己也会出网,例如 npm registry —— 只看本文件的六个名字。)
    const hosts: readonly string[] = Object.values(TARGETS)
    const connects = proxyLog.flatMap((r) => (r.event === "egress.connect" && hosts.includes(r.host ?? "") ? [`${r.host}:${r.status}`] : []))
    expect(connects.sort()).toEqual(
      [`${TARGETS.blackhole}:504`, `${TARGETS.dns}:503`, `${TARGETS.policy}:403`, `${TARGETS.refused}:502`, `${TARGETS.silent}:200`, `${TARGETS.timeout}:200`].sort(),
    )
  })

  test("持久化记录的 metadata.codepuppyNetFailure:policy / dns / tcp / tcp / tls-silent", () => {
    expect(recordFor(TARGETS.policy).state.metadata?.codepuppyNetFailure).toEqual({ layer: "policy", code: "403" })
    expect(recordFor(TARGETS.dns).state.metadata?.codepuppyNetFailure).toEqual({ layer: "dns", code: "503" })
    expect(recordFor(TARGETS.refused).state.metadata?.codepuppyNetFailure).toEqual({ layer: "tcp", code: "502" })
    expect(recordFor(TARGETS.blackhole).state.metadata?.codepuppyNetFailure).toEqual({ layer: "tcp", code: "504" })
    expect(recordFor(TARGETS.silent).state.metadata?.codepuppyNetFailure).toEqual({ layer: "tls-silent", code: "UND_ERR_CONNECT_TIMEOUT" })
    // 握手静默是客户端先超时(undici 10 s),不是代理的 15 s 兜底:隧道零回音地关掉,没有 tunnel-silent。
    expect(proxyLog.some((r) => r.event === "egress.tunnel-silent")).toBe(false)
  })

  // #1654 N11(a):同样由真实 webfetch 自己的期限(OpenCode 2 packages/core/src/tool/plugin/webfetch.ts 的 timeoutOrElse ⇒ 普通
  // Error("Request timed out")),仅缩短测试中的期限。0.1.26 落库的原文就是这句;OpenCode 2 的 webfetch 把它包成
  // `Unable to fetch <url>` 落库(卡片原文行显示它,查询串由 redactText 隐藏),期限错误只作为原因交给 ext —— 层码 `timeout`
  // 只由分类模块的「Error 且原文 Request timed out」一条给出(TimeoutError 给的是 TimeoutError),所以它就是「来自 webfetch 期限」的证据。
  test("#1654 AC1 real webfetch deadline persists timeout and the tool card names its host", () => {
    const record = recordFor(TARGETS.timeout)
    expect(record.state.error).toBe(`Unable to fetch ${record.state.input.url}`)
    expect(record.state.metadata?.codepuppyNetFailure).toEqual({ layer: "timeout", code: "timeout" })
    const body = toolCardBodyOf(record as unknown as ToolPart)
    expect(body).toMatchObject({ type: "error", netLayer: "timeout", host: TARGETS.timeout })
    if (body.type !== "error" || !body.netLayer) throw new Error("missing layered tool card")
    setLocale("zh")
    expect(netFailureCopy(body.netLayer, body.host)).toBe(`等待 ${TARGETS.timeout} 超时,稍后重试`)
  })

  test("AC6:落库的层只有层名与错误码,URL 查询里的令牌不进 codepuppyNetFailure", () => {
    expect(records.some((r) => r.state.input.url?.includes("SECRET-NEEDLE-1572"))).toBe(true) // 针必在
    for (const record of records) {
      const stored = JSON.stringify(record.state.metadata?.codepuppyNetFailure)
      expect(Object.keys(record.state.metadata?.codepuppyNetFailure as object).sort()).toEqual(["code", "layer"])
      expect(stored).not.toContain("SECRET-NEEDLE-1572")
    }
  })

  test("main 臂:Electron node 不设代理直连只收不回的监听 ⇒ connect-timeout(不是 tls-silent)", async () => {
    const probe = await Bun.build({ target: "node", entrypoints: [join(FIXTURES, "main-direct-probe.ts")], outdir: join(scratch, "probe"), format: "esm" })
    if (!probe.success) throw new Error(`probe bundle failed(本次测量作废):\n${probe.logs.map(String).join("\n")}`)
    const out = await new Promise<string>((resolveOut, reject) => {
      const child = spawn(electron, [join(scratch, "probe", "main-direct-probe.js"), `https://127.0.0.1:${silentPort}/`], {
        env: isolatedEnv({ ELECTRON_RUN_AS_NODE: "1" }),
        stdio: ["ignore", "pipe", "pipe"],
      })
      let text = ""
      child.stdout.on("data", (c: Buffer) => (text += c.toString()))
      child.stderr.on("data", (c: Buffer) => (text += c.toString()))
      child.once("exit", () => resolveOut(text))
      child.once("error", reject)
    })
    const result = JSON.parse(out.trim().split("\n").at(-1) ?? "{}") as { classified?: unknown; shape?: { causeCode?: string } }
    console.log(`[#1572 真栈 · main 直连] ${out.trim()}`)
    expect(result.shape?.causeCode).toBe("UND_ERR_CONNECT_TIMEOUT")
    expect(result.classified).toEqual({ layer: "connect-timeout", code: "UND_ERR_CONNECT_TIMEOUT" })
  }, 30_000)
})
