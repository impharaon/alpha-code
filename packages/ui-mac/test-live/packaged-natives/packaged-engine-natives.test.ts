// `#1669`(独立审计发现 C):安装包里的引擎,终端开得出、文件监听收得到、文件搜索答得出 —— 对着**打好的包**量,不对着源码目录。
//
// 引擎包的原生资源(node-pty 的 pty.node 与 spawn-helper、parcel watcher、FFI 的 .node …)由前导代码按引擎 chunk 的
// `import.meta.url` 找(`packages/cli/vite.node.config.ts` nodePrelude);chunk 在 app.asar 里。spawn-helper 由 node-pty 的原生代码
// 直接执行(路径里的 app.asar 换成 app.asar.unpacked),不经 Electron 的 asar 文件层,文件不在解包目录里就执行不到;
// .node 经 Electron 的 asar 层装载,打进 asar 的会被解到临时目录(未签名的包里装得上,签名包的库校验不认)。所以这里:
//   · 运行时:node_modules 里的 Electron(与出货同版本,出货包自己的 Electron 关了 RunAsNode fuse)以 ELECTRON_RUN_AS_NODE 装
//     **包里的** engine chunk(engine-driver.ts),生产 buildEngineServerOptions 起引擎(文件监听开,同 main 默认);
//   · 消费方:桌面的生产引擎适配器(engine-adapter createEngineFetch,口令补法同 main 的 onBeforeSendHeaders)发冻结界面发的
//     v1 请求;终端 WebSocket 地址由冻结 app 的 terminalWebSocketURL 拼(renderer 直连引擎,不经适配器)。
// 三格:终端 ⇒ 建 PTY、取票、连 WebSocket、执行 `echo` 一条算式读回结果;文件监听 ⇒ 订阅 `/global/event`,在工作区写文件,收到
// `file.watcher.updated`;文件搜索 ⇒ git 工作区里 `/find/file` 找到刚建的文件。包里的 FFF 不可用(fff-node 从 chunk 旁的
// node_modules 找动态库,不读前导代码给的 FFF_BINARY_PATH),引擎对它走 ripgrep —— 与 0.1.26 相同(那时 node 端 FFF 是空实现);
// 若 FFF 被尝试却装不上,引擎回空列表并记 `failed to initialize fff`,这一格红。
//
// 不在闸门里(要先有包):`bun run build` + `bun run package:mac --publish never` 之后,
// `bun test test-live/packaged-natives/packaged-engine-natives.test.ts`(包路径缺省 dist/mac-arm64/Code Puppy.app,
// `CODEPUPPY_PACKAGED_APP` 可指别的 .app)。
// 已知的坏(2026-11-13 实跑):打包配置不解包引擎资源目录时打出的包 ⇒ 终端一格红(建 PTY 回 500,node-pty 报
// posix_spawn failed: No such file or directory);文件监听在未签名包里照样绿(.node 被解到临时目录装载)。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { ISOLATED_KEYS, isInside, isolatedEnv, testRoot } from "../../../../scripts/test-isolation/env"
import { engineAuthorization } from "../../src/main/engine-authorization"
import { createEngineFetch, type EngineFetch } from "../../src/engine-adapter"
import { terminalWebSocketURL } from "../../../codepuppy-app/src/utils/terminal-websocket-url"
import type { DriverInput } from "./engine-driver"

const describeDarwin = process.platform === "darwin" ? describe : describe.skip
const require = createRequire(import.meta.url)
const UI_MAC = resolve(import.meta.dir, "../..")
const APP = resolve(process.env.CODEPUPPY_PACKAGED_APP ?? join(UI_MAC, "dist", "mac-arm64", "Code Puppy.app"))
const PASSWORD = "cp-1669-packaged-natives"
const NEEDLE = "cp-native-needle.txt"

describeDarwin("`#1669` 安装包里的引擎原生资源:终端 / 文件监听 / 文件搜索", () => {
  let scratch = ""
  let driverDir = ""
  let workspace = ""
  let engine: ChildProcess | undefined
  const engineLog: string[] = []
  let origin = ""
  let adapter: EngineFetch

  beforeAll(async () => {
    if (!existsSync(join(APP, "Contents", "Resources", "app.asar"))) throw new Error(`no packaged app at ${APP}(本次测量作废:先打包)`)
    const electronPkg = dirname(require.resolve("electron/package.json"))
    const electron = join(electronPkg, "dist", readFileSync(join(electronPkg, "path.txt"), "utf8").trim())
    if (!existsSync(electron)) throw new Error(`electron binary missing at ${electron}(本次测量作废)`)
    scratch = mkdtempSync(join(testRoot(), "packaged-natives-"))
    mkdirSync(join(UI_MAC, "node_modules/.cache"), { recursive: true })
    driverDir = mkdtempSync(join(UI_MAC, "node_modules/.cache/packaged-natives-"))
    const driver = await Bun.build({ target: "node", entrypoints: [join(import.meta.dir, "engine-driver.ts")], outdir: driverDir, format: "esm" })
    if (!driver.success) throw new Error(`driver bundle failed(本次测量作废):\n${driver.logs.map(String).join("\n")}`)

    // 工作区是 git 仓库:引擎对 git 工作区用 FFF 搜索(core filesystem/search.ts),对非 VCS 目录用 ripgrep。
    workspace = join(scratch, "ws")
    mkdirSync(workspace, { recursive: true })
    const git = spawnSync("git", ["init", "-q"], { cwd: workspace, encoding: "utf8" })
    if (git.status !== 0) throw new Error(`git init failed(本次测量作废):${git.stderr}`)
    writeFileSync(join(workspace, NEEDLE), "needle\n")

    const home = join(scratch, "home")
    for (const dir of [home, join(scratch, "engine-config")]) mkdirSync(dir, { recursive: true })
    const env = isolatedEnv({
      HOME: home,
      XDG_DATA_HOME: join(home, ".local", "share"),
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_STATE_HOME: join(home, ".local", "state"),
      ELECTRON_RUN_AS_NODE: "1",
      // main 给 sidecar 的默认(src/main/server.ts):整个项目的文件监听开着。
      OPENCODE_EXPERIMENTAL_FILEWATCHER: "true",
      SHELL: "/bin/sh",
      NO_COLOR: "1",
    })
    const outside = ISOLATED_KEYS.filter((name) => env[name] !== undefined && !isInside(testRoot(), env[name]!))
    if (outside.length) throw new Error(`REFUSING TO RUN: engine env keys outside the test root: ${outside.join(", ")}`)
    const input: DriverInput = {
      app: APP,
      password: PASSWORD,
      databasePath: join(scratch, "engine.db"),
      configDirectory: join(scratch, "engine-config"),
    }
    engine = spawn(electron, [join(driverDir, "engine-driver.js"), JSON.stringify(input)], { cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"] })
    engine.stdout?.on("data", (chunk: Buffer) => engineLog.push(chunk.toString()))
    engine.stderr?.on("data", (chunk: Buffer) => engineLog.push(chunk.toString()))
    const deadline = Date.now() + 60_000
    while (!(origin = /LISTENING (http:\/\/\S+)/.exec(engineLog.join(""))?.[1] ?? "")) {
      if (Date.now() > deadline || engine.exitCode !== null) throw new Error(`packaged engine never became ready:\n${engineLog.join("").slice(-3000)}`)
      await Bun.sleep(100)
    }
    origin = new URL(origin).origin
    // 与 main 的 onBeforeSendHeaders 同一件事:发往引擎源的请求补口令。
    const engineHttp = ((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      request.headers.set("authorization", engineAuthorization(PASSWORD))
      return fetch(request)
    }) as typeof fetch
    adapter = createEngineFetch({ isEngineOrigin: (candidate) => candidate === origin, fetch: engineHttp })
  }, 120_000)

  afterAll(async () => {
    engine?.kill("SIGTERM")
    if (engine && engine.exitCode === null) await new Promise((r) => engine!.once("exit", r))
    if (driverDir) rmSync(driverDir, { recursive: true, force: true })
  })

  const url = (path: string, query: Record<string, string> = {}) => {
    const target = new URL(path, origin)
    target.searchParams.set("directory", workspace)
    for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value)
    return target
  }
  const send = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await adapter(url(path), {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })
    const text = await response.text()
    return { status: response.status, json: (text ? JSON.parse(text) : undefined) as any, text }
  }

  test("终端:包里的 node-pty 起得来 shell,命令的输出经 WebSocket 读得回", async () => {
    const created = await send("POST", "/pty", { title: "终端 1" })
    expect(created.status, `${created.text}\n${engineLog.join("").slice(-2000)}`).toBe(200)
    const ticket = await send("POST", `/pty/${created.json.id}/connect-token`, undefined, { "x-opencode-ticket": "1" })
    expect(ticket.status, ticket.text).toBe(200)
    const socket = new WebSocket(terminalWebSocketURL({ url: origin, id: created.json.id, directory: workspace, cursor: 0, ticket: ticket.json.ticket }))
    socket.binaryType = "arraybuffer"
    let output = ""
    const echoed = new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(new Error(`no command output within 15 s; terminal read:\n${output}`)), 15_000)
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return
        output += event.data
        // 输入回显是算式本身;只有 shell 真执行了才会出现 42。
        if (output.includes("CP-PTY-42")) {
          clearTimeout(timer)
          done()
        }
      })
      socket.addEventListener("error", () => fail(new Error(`terminal websocket error; read so far:\n${output}`)))
    })
    await new Promise<void>((open, fail) => {
      socket.addEventListener("open", () => open(), { once: true })
      socket.addEventListener("close", (event) => fail(new Error(`terminal websocket closed before open: ${event.code}`)), { once: true })
    })
    socket.send("echo CP-PTY-$((6*7))\n")
    try {
      await echoed
    } finally {
      socket.close(1000)
    }
  }, 60_000)

  test("文件监听:工作区里新建的文件经 /global/event 到达(file.watcher.updated)", async () => {
    expect((await send("GET", "/path")).status).toBe(200) // 先把这个目录的 Location 起起来(它装项目监听)
    const abort = new AbortController()
    const stream = await adapter(url("/global/event"), { signal: abort.signal })
    expect(stream.status).toBe(200)
    const reader = stream.body!.getReader()
    const decoder = new TextDecoder()
    const target = "cp-native-watched.txt"
    let seen = ""
    let observed = false
    const reading = (async () => {
      while (!observed) {
        const { value, done } = await reader.read()
        if (done) return
        seen += decoder.decode(value, { stream: true })
        for (const block of seen.split("\n\n").slice(0, -1)) {
          const data = block.split("\n").find((line) => line.startsWith("data: "))
          if (!data) continue
          const event = JSON.parse(data.slice(6)) as { payload?: { type?: string; properties?: { file?: string } } }
          if (event.payload?.type === "file.watcher.updated" && event.payload.properties?.file?.endsWith(target)) observed = true
        }
        seen = seen.slice(seen.lastIndexOf("\n\n") + 2)
      }
    })().catch(() => {})
    // 订阅建立与 FSEvents 起步都不报完成信号:每 500 ms 写一次,15 s 内收到即成立。
    const deadline = Date.now() + 15_000
    for (let index = 0; !observed && Date.now() < deadline; index++) {
      writeFileSync(join(workspace, target), `change ${index}\n`)
      await Bun.sleep(500)
    }
    abort.abort()
    await reading
    expect(observed, `no file.watcher.updated for ${target} within 15 s\n${engineLog.join("").slice(-2000)}`).toBe(true)
  }, 60_000)

  test("文件搜索:git 工作区里刚建的文件经 /find/file 找得到", async () => {
    const searched = await adapter(url("/find/file", { query: "needle", dirs: "false" }), { signal: AbortSignal.timeout(30_000) })
    expect(searched.status).toBe(200)
    const paths = (await searched.json()) as string[]
    expect(paths, engineLog.join("").slice(-2000)).toContain(NEEDLE)
    expect(engineLog.join("")).not.toContain("failed to initialize fff")
  }, 60_000)
})
