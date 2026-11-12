// REQ-159 (`#1321`) · AC1 + AC2 —— **真引擎 + 真 ext + 生产计划器 + 生产 .node**,三类真消费方越界写 0 落盘。
// `#1662`(OpenCode 2):引擎换成嵌入式 OpenCode 2 —— `test-fixtures/process-fence/engine-embed-driver.ts` 在 bun 下跑
// `engine/engine-embed.ts`(与打包进 dist-engine 的同一个入口),顺序照出货 sidecar:围栏 preload 先于任何模块装载 → 生产
// `injectCodePuppyConfig` → 预载 ext 入口 → `startEngine(buildEngineServerOptions(...))`。工作负载走 2.x 的 `/api/*`。
//
// 与 process-fence-apply.test.ts 的分工:那边跑的是四类**创建原语**(Electron 的 node 里 dlopen);这边跑的是
// 三类**真消费方** —— 会话里的 shell 命令(`POST /api/session/:id/shell`,2.x 的 Shell 服务)、`POST /api/pty`
// (缺省 + 带 command)、`PUT /api/experimental/mcp/:server` 起真 stdio server —— 外加装了 `@codepuppy/ext` 的引擎本身;
// 围栏由**生产的原生模块在引擎进程装载任何模块之前 `sandbox_init`**(bun --preload,与出货 sidecar「import 引擎前自打
// seatbelt」同一顺序、同一 SPI);profile 由**生产的 planProcessFence** 渲染 + 真 sandbox-exec 试编译。
//
// AC2 在这里的形状:shell 在围栏下**照常执行**(输出是 shell 自己的 `operation not permitted`,不是 `sandbox_apply:
// Operation not permitted` 那种零执行的 exit 71),且引擎生效配置里的 `shell` 不指向 REQ-138 的 wrapper。
//
// 正样本臂:同一驱动、同一工作负载、同一探针,只去掉围栏 preload ⇒ 全部落盘。先证明探针测得出「写得进」。
//
// `#1531`(REQ-234)在 2.x 上:ext 碰引擎 HTTP 的**唯一**一处是重载调度器(`GET /api/session/active` + `POST /api/location/reload`),
// 它经 `in-process-engine.ts` 的交接点取引擎。围栏的网络行只放行出网代理端口(N4),连自己的回环监听端口一律拒 ⇒ 交接点上
// 放的必须是**进程内** dispatch。三臂同一条驱动(经 node IPC 接成的 parentPort 发 main 形状的 `codepuppy.reload.request`,读 ext 回的
// report):不套围栏 + TCP 句柄 ⇒ reloaded(TCP 本身可用);围栏 + TCP 句柄 ⇒ waiting(红只能归因于围栏);围栏 + 出货的进程内交接 ⇒ reloaded。
// v1 的 `#1553` 两臂(ext 经 v1 递给插件的 `input.client` 读 MCP 状态 / 模型能力 / 会话历史)在 2.x 上没有对应机制:2.x 的插件
// Context 直接给服务(`context.mcp.list()`、模型目录、会话钩子),不经 HTTP —— 退役注释与替代用例见 scripts/gate-files.tsv。
//
// 口径(如实):引擎跑在 **bun**(dev 树),不是出货的 Electron-Node sidecar;出货形态(node + 打包产物 + 围栏)是
// U3 那张 VERIFY 票的事,本文件不闭合它。隔离家目录里没有凭据;**没有发过一次真的模型请求**。
// 布局:整个隔离树放在本包 git-ignore 的 `node_modules/.cache` 下(不放 /private/tmp 或 $TMPDIR —— 那两处在可写集里,
// 勘破 §7.4 括注的坑;也不放开发机的真 HOME,共享测试隔离预载 I-08 之后 HOME 本就指进临时根)。
//
// darwin-only(真 seatbelt),CI(ubuntu)上自报 skip;每臂一次引擎冷启动。

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { spawnSync, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { buildFenceAddon } from "../../scripts/build-fence-addon"
import { trialCompileProfile } from "./process-fence-compile"
import { planProcessFence } from "./process-fence-plan"
// `#1337`:真引擎在围栏下的出网只剩策略代理那一扇门 —— 这里起**生产的**代理并按生产 sidecarEgressProxyEnv 给引擎 env,
// 与出货形态同一条路;判据仍只看文件轴(网络轴在 network-egress-fence.test.ts)。`#1454`:代理的授权**注入为全拒**
// (authorize=false、requestGrant=not-asked),不接注册表 —— 本文件不依赖本机能不能出网。
import { startEgressPolicyProxy, type EgressLogRecord, type EgressProxyHandle } from "./network-egress-proxy"
import { sidecarEgressProxyEnv } from "./sidecar-env"
import { buildReloadRequest } from "./codepuppy-sidecar-messages"
import { engineAuthorization } from "./engine-authorization"

const describeDarwin = process.platform === "darwin" && existsSync("/usr/bin/sandbox-exec") ? describe : describe.skip
const repoRoot = resolve(import.meta.dir, "../../../..")
const fixtures = resolve(import.meta.dir, "../../test-fixtures/process-fence")
const driver = join(fixtures, "engine-embed-driver.ts")
const extDir = join(repoRoot, "packages", "ext", "dist")
const PASSWORD = "ac1321"
const PATH_AT_LOAD = process.env.PATH ?? ""

type Arm = "bare" | "fenced"
type Fetch = "in-process" | "tcp" | "none"
type Engine = { proc: ChildProcess; url: string; log: string[] }

describeDarwin("REQ-159 真引擎(OpenCode 2)+ 真 ext 在进程围栏下:三类真消费方越界 0 落盘;shell 照常执行", () => {
  let iso = ""
  let home = ""
  let ws = ""
  let esc = ""
  let userData = ""
  let globalRoot = ""
  let addon = ""
  let profileFile = ""
  const planLog: string[] = []
  let egressProxy: EgressProxyHandle | undefined
  const proxyLog: EgressLogRecord[] = []
  const engines: Engine[] = []
  const landed = (dir: string) => readdirSync(dir).sort()

  beforeAll(async () => {
    egressProxy = await startEgressPolicyProxy({
      log: (r) => void proxyLog.push(r),
      authorize: () => false,
      requestGrant: async () => "not-asked",
    })
    // ① ext bundle:本树的 ext(不是别的 worktree 的),现编;2.x 只装目录形式的本地插件,入口是 dist/server.js。
    const ext = spawnSync(process.execPath, ["run", "build"], { cwd: join(repoRoot, "packages", "ext"), encoding: "utf8", timeout: 120_000 })
    if (ext.status !== 0 || !existsSync(join(extDir, "server.js"))) throw new Error(`ext build failed (本次测量作废): ${ext.stderr}`)
    // ② 隔离树(系统临时目录之外)。
    const scratch = resolve(import.meta.dir, "../../node_modules/.cache")
    mkdirSync(scratch, { recursive: true })
    iso = realpathSync(mkdtempSync(join(scratch, "ac1321-engine-")))
    home = join(iso, "home")
    ws = join(iso, "ws")
    esc = join(iso, "esc")
    userData = join(iso, "userData")
    globalRoot = join(iso, "codepuppy-state", "env", "dev")
    for (const d of [home, ws, esc, userData, globalRoot, join(userData, "engine-scratch-cwd")]) mkdirSync(d, { recursive: true })
    spawnSync("git", ["init", "-q"], { cwd: ws })
    // ③ 生产 .node(现编,烤 buildId)与生产计划器(真试编译)。
    addon = buildFenceAddon({ out: join(iso, "resources", "codepuppy-fence", "codepuppy_fence.node"), buildId: `ac1321-engine-${Date.now()}` }).out
    const plan = planProcessFence(
      {
        userDataPath: userData,
        sidecarEnv: { HOME: home, XDG_DATA_HOME: join(home, ".local", "share"), XDG_CACHE_HOME: join(home, ".cache"), XDG_CONFIG_HOME: join(home, ".config"), XDG_STATE_HOME: userData },
        addon: { packaged: true, resourcesPath: join(iso, "resources"), moduleDir: "/unused", exists: existsSync },
        egressProxyPort: egressProxy.port,
      },
      {
        homeDir: () => home,
        codepuppyGlobalRoot: () => globalRoot,
        // `#1390`:状态根 = globalRoot 的父目录的父目录;realpath 用生产同一个(realpathSync.native)
        appStateRoot: () => join(iso, "codepuppy-state"),
        realpath: (p) => realpathSync.native(p),
        defaultWorkspace: () => ws,
        readWorkspaces: () => [],
        isDirectory: (p) => {
          try {
            return statSync(p).isDirectory()
          } catch {
            return false
          }
        },
        mkdirp: (p) => void mkdirSync(p, { recursive: true }),
        compile: trialCompileProfile,
        log: (l) => void planLog.push(l),
      },
    )
    profileFile = join(iso, "fence.sb")
    writeFileSync(profileFile, plan.profile)
    expect(plan.workspaces).toEqual([ws])
    expect(plan.addonPath).toBe(addon)
  }, 180_000)

  afterAll(async () => {
    await egressProxy?.close()
    for (const e of engines) {
      try {
        e.proc.kill("SIGTERM")
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 1500))
    for (const e of engines) {
      try {
        e.proc.kill("SIGKILL")
      } catch {}
    }
    try {
      rmSync(iso, { recursive: true, force: true })
    } catch {}
  })

  async function stopEngine(engine: Engine) {
    engine.proc.kill("SIGTERM")
    await new Promise<void>((done) => {
      if (engine.proc.exitCode !== null) return done()
      const timer = setTimeout(() => {
        engine.proc.kill("SIGKILL")
        done()
      }, 5_000)
      engine.proc.once("exit", () => {
        clearTimeout(timer)
        done()
      })
    })
  }

  /** `#1531`:额外的 preload(在围栏 preload 之后,经 node IPC 接成引擎的 process.parentPort)。 */
  async function bootEngine(arm: Arm, extra: { fetch?: Fetch; ipc?: boolean } = {}): Promise<Engine> {
    const env: Record<string, string> = {
      PATH: PATH_AT_LOAD,
      HOME: home,
      XDG_DATA_HOME: join(home, ".local", "share"),
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_STATE_HOME: userData,
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      // `#1337`:与出货 sidecar 同一份代理栈(HTTP(S)_PROXY → 策略代理;NO_PROXY = loopback)。
      ...sidecarEgressProxyEnv(egressProxy!.port),
      NO_COLOR: "1",
      CODEPUPPY_GLOBAL_DIR: globalRoot,
      CODEPUPPY_SECRETS_DISABLE: "1",
      CP1321_USER_DATA: userData,
      CP1321_EXT_DIR: extDir,
      CP1321_PASSWORD: PASSWORD,
      CP1321_FETCH: extra.fetch ?? "in-process",
      ...(arm === "fenced" ? { CODEPUPPY1321_FENCE_ADDON: addon, CODEPUPPY1321_FENCE_PROFILE: profileFile } : {}),
    }
    // flag 必须在 `run` 之后 —— `bun --preload X run Y` 在 bun 1.3.x 打印 usage 后静默退出 0(仓内 CLAUDE.md 记的坑)。
    const preloads = [...(arm === "fenced" ? [join(fixtures, "engine-fence-preload.ts")] : []), ...(extra.ipc ? [join(fixtures, "engine-parent-port-preload.ts")] : [])]
    const args = ["run", ...preloads.flatMap((p) => ["--preload", p]), driver]
    const { spawn } = await import("node:child_process")
    const log: string[] = []
    const proc = spawn(process.execPath, args, { cwd: join(userData, "engine-scratch-cwd"), env, stdio: extra.ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"] })
    proc.stdout?.on("data", (c: Buffer) => log.push(c.toString("utf8")))
    proc.stderr?.on("data", (c: Buffer) => log.push(c.toString("utf8")))
    const engine: Engine = { proc, url: "", log }
    engines.push(engine)
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      if (proc.exitCode !== null) throw new Error(`engine(${arm}) exited ${proc.exitCode} before listening:\n${log.join("").slice(-3000)}`)
      const url = /engine-embed-driver: listening (http:\/\/127\.0\.0\.1:\d+)/.exec(log.join(""))?.[1]
      if (url) {
        engine.url = url
        return engine
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error(`engine(${arm}) never listened:\n${log.join("").slice(-3000)}`)
  }

  const api = async (engine: Engine, method: string, path: string, body?: unknown) => {
    const started = Date.now()
    let res: Response
    try {
      res = await fetch(new URL(path, engine.url), {
        method,
        headers: { authorization: engineAuthorization(PASSWORD), "content-type": "application/json", "x-opencode-directory": encodeURIComponent(ws) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      })
    } catch (err) {
      const e = err as Error
      throw new Error(
        `${method} ${path} failed after ${Date.now() - started}ms (${e.name}: ${e.message})\n` +
          `--- proxy log (${proxyLog.length}) ---\n${proxyLog.map((r) => JSON.stringify(r)).join("\n")}\n--- engine log tail ---\n${engine.log.join("").slice(-3000)}`,
      )
    }
    const text = await res.text()
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      json = text
    }
    return { status: res.status, json }
  }

  /** 第一次带目录的请求才起这个 Location(ext 随之装载、向调度器登记目录):轮询到 ext 装上。 */
  async function extActive(engine: Engine) {
    for (let i = 0; i < 200; i++) {
      const plugins = ((await api(engine, "GET", "/api/plugin")).json as { data?: Array<{ id: string; state: { status: string } }> })?.data ?? []
      if (plugins.find((p) => p.id === "codepuppy.ext")?.state.status === "active") return
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error(`the real ext never became active in the embedded engine:\n${engine.log.join("").slice(-3000)}`)
  }

  type Workload = { shellOutput: string; shellExit: number | undefined; ptyDefaultStatus: number; ptyCommandStatus: number; mcpStatus: unknown; configShell: unknown }

  async function workload(engine: Engine, arm: Arm): Promise<Workload> {
    await extActive(engine)
    const session = await api(engine, "POST", "/api/session", { location: { directory: ws } })
    expect(session.status, `session ${JSON.stringify(session.json).slice(0, 300)}`).toBe(200)
    const sessionID = (session.json as { data: { id: string } }).data.id

    // shell:会话里的一条命令写界内 + 界外(2.x `session.shell`,经 Shell 服务执行,结局记成一条会话消息)。不发模型请求。
    const shell = await api(engine, "POST", `/api/session/${sessionID}/shell`, {
      command: `echo x > "${join(ws, `shelltool-${arm}.txt`)}"; echo x > "${join(esc, `shelltool-${arm}.txt`)}"; echo done`,
    })
    expect(shell.status, `shell ${JSON.stringify(shell.json).slice(0, 500)}`).toBe(204)
    // 读回那条 `type: "shell"` 消息的终态:退出码与 shell 自己的输出(不是命令原文 —— 原文里也有 "done")。
    type ShellMessage = { type: string; status?: string; exit?: number; output?: { output?: string } }
    let shellMessage: ShellMessage | undefined
    for (let i = 0; i < 50 && shellMessage?.status !== "exited"; i++) {
      const messages = ((await api(engine, "GET", `/api/session/${sessionID}/message`)).json as { data?: ShellMessage[] }).data ?? []
      shellMessage = messages.find((m) => m.type === "shell")
      if (shellMessage?.status !== "exited") await new Promise((r) => setTimeout(r, 100))
    }
    expect(shellMessage?.status, `shell message ${JSON.stringify(shellMessage)}`).toBe("exited")

    // PTY 带 command:真 PTY 起 /bin/sh -c 写两处。
    const ptyCommand = await api(engine, "POST", "/api/pty", {
      command: "/bin/sh",
      args: ["-c", `echo x > "${join(ws, `pty-${arm}.txt`)}"; echo x > "${join(esc, `pty-${arm}.txt`)}"; exit 0`],
      cwd: ws,
    })
    // PTY 缺省:登录 shell 开得出来(W15)。
    const ptyDefault = await api(engine, "POST", "/api/pty", { cwd: ws })

    // MCP stdio:引擎起真 server,server 起来第一件事写两处。
    const added = await api(engine, "PUT", "/api/experimental/mcp/codepuppy1321probe", {
      config: { type: "local", command: ["node", join(fixtures, "mcp-probe.mjs"), ws, esc, arm] },
    })
    expect(added.status, `mcp add ${JSON.stringify(added.json).slice(0, 500)}`).toBe(204)
    const mcp = await api(engine, "GET", "/api/mcp")
    const config = await api(engine, "GET", "/api/config")
    // 让 PTY / MCP 子进程把写盘做完
    await new Promise((r) => setTimeout(r, 1500))
    return {
      shellOutput: shellMessage?.output?.output ?? "",
      shellExit: shellMessage?.exit,
      ptyDefaultStatus: ptyDefault.status,
      ptyCommandStatus: ptyCommand.status,
      mcpStatus: ((mcp.json as { data?: Array<{ name: string; status: unknown }> }).data ?? []).find((s) => s.name === "codepuppy1321probe")?.status,
      // 2.x 的 GET /api/config = 这个 Location 的配置文档数组(低 → 高);生效的 `shell` 取自其中写了它的文档。
      configShell: (() => {
        const entries = config.json as Array<{ type: string; info?: { shell?: unknown } }>
        expect(Array.isArray(entries) && entries.some((entry) => entry.type === "document"), `config ${JSON.stringify(config.json).slice(0, 300)}`).toBe(true)
        return entries.flatMap((entry) => (entry.info?.shell === undefined ? [] : [entry.info.shell])).join("\n")
      })(),
    }
  }

  let bare: Workload | undefined
  let fenced: Workload | undefined

  test("正样本臂(不套围栏):shell / PTY / MCP 三条真消费方在界内与界外**全部**落盘 —— 探针测得出「写得进」", async () => {
    const engine = await bootEngine("bare")
    bare = await workload(engine, "bare")
    expect(bare.ptyCommandStatus).toBe(200)
    expect(bare.ptyDefaultStatus).toBe(200)
    expect(JSON.stringify(bare.mcpStatus)).toContain("connected")
    expect(landed(esc)).toEqual(["mcp-bare.txt", "pty-bare.txt", "shelltool-bare.txt"])
    expect(landed(ws).filter((f) => f.endsWith("-bare.txt"))).toEqual(["mcp-bare.txt", "pty-bare.txt", "shelltool-bare.txt"])
    expect(bare.shellOutput).not.toMatch(/not permitted/i)
    expect(bare.shellOutput.trim()).toBe("done")
    await stopEngine(engine)
  }, 180_000)

  test("围栏臂(生产 .node + 生产计划器的 profile):三条真消费方界内落盘、界外**零**新增;PTY 开得出;MCP 连得上", async () => {
    const before = landed(esc)
    const engine = await bootEngine("fenced")
    expect(engine.log.join("")).toContain("engine-fence-preload: fence applied")
    fenced = await workload(engine, "fenced")
    expect(fenced.ptyCommandStatus).toBe(200)
    expect(fenced.ptyDefaultStatus, "PTY 缺省 shell 在围栏下必须开得出来(W15 /dev/ptmx)").toBe(200)
    expect(JSON.stringify(fenced.mcpStatus)).toContain("connected")
    expect(landed(esc)).toEqual(before) // 一条 *-fenced.txt 都没有
    expect(landed(ws).filter((f) => f.endsWith("-fenced.txt"))).toEqual(["mcp-fenced.txt", "pty-fenced.txt", "shelltool-fenced.txt"])
    await stopEngine(engine)
  }, 180_000)

  test("AC2:围栏下 shell **照常执行**(shell 自己报 operation not permitted,不是 sandbox_apply 的零执行),生效配置的 shell 不指向 REQ-138 wrapper", () => {
    expect(fenced, "围栏臂没跑成,本格作废").toBeDefined()
    // 报错点名的正是界外那个文件;界内那一句没报错
    expect(fenced!.shellOutput).toMatch(new RegExp(`operation not permitted: ${join(esc, "shelltool-fenced.txt").replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`, "i"))
    expect(fenced!.shellOutput).not.toContain(join(ws, "shelltool-fenced.txt"))
    // 命令跑到了最后一句、以 0 退出 ⇒ 不是 sandbox_apply 那种 exit 71 零执行
    expect(fenced!.shellOutput.trim().split("\n").at(-1)).toBe("done")
    expect(fenced!.shellExit).toBe(0)
    expect(fenced!.shellOutput).not.toContain("sandbox_apply")
    // REQ-138 那层若还在,生效配置的 shell 会指向 <codepuppyGlobalRoot>/bin/<shell>
    expect(String(fenced!.configShell ?? "")).not.toContain(join(globalRoot, "bin"))
    expect(String(bare!.configShell ?? "")).not.toContain(join(globalRoot, "bin"))
  })

  test("计划器在真 sandbox-exec 上一次编过;围栏下引擎的 provider 缓存根(W4/W5/W6/W7)都被预建", () => {
    expect(planLog.some((l) => /process fence planned: workspaces=1 .*compile attempts=1/.test(l))).toBe(true)
    for (const d of [join(home, ".local", "share", "opencode"), join(home, ".cache", "opencode"), join(home, ".config", "opencode"), join(home, ".npm")])
      expect(existsSync(d), d).toBe(true)
  })

  // ── REQ-234 `#1531`:ext 重载调度器在**围栏 + 引擎已监听**下能不能问到引擎 ────────────────────────────────────────
  async function reloadViaParentPort(engine: Engine, generation: number) {
    await extActive(engine)
    const reports: Array<{ generation?: number; outcome?: string; error?: string; directories?: string[] }> = []
    engine.proc.on("message", (message) => {
      if ((message as { type?: string }).type === "codepuppy.reload.report") reports.push(message as (typeof reports)[number])
    })
    engine.proc.send!(buildReloadRequest({ generation, scope: "global", items: [], reason: "#1531 fenced reload probe" }))
    const deadline = Date.now() + 30_000
    while (Date.now() < deadline && !reports.some((r) => r.generation === generation)) await new Promise((r) => setTimeout(r, 100))
    return reports.filter((r) => r.generation === generation)
  }

  test("#1531 正样本臂:不套围栏 + 交接点上放 TCP 句柄(连自己的监听端口)⇒ 问得到 ⇒ reloaded —— 下一臂的红只能归因于围栏", async () => {
    const engine = await bootEngine("bare", { fetch: "tcp", ipc: true })
    const reports = await reloadViaParentPort(engine, 3)
    expect(reports[0], engine.log.join("").slice(-2000)).toMatchObject({ outcome: "reloaded", directories: [ws] })
    await stopEngine(engine)
  }, 180_000)

  test("#1531 对照臂:围栏 + 交接点上放 TCP 句柄 ⇒ ext 调度器问不到引擎 ⇒ 零重载、报 waiting", async () => {
    const engine = await bootEngine("fenced", { fetch: "tcp", ipc: true })
    expect(engine.log.join("")).toContain("engine-fence-preload: fence applied")
    const reports = await reloadViaParentPort(engine, 1)
    expect(reports[0], engine.log.join("").slice(-2000)).toMatchObject({ outcome: "waiting", error: "engine status unavailable — restart the app if this persists" })
    expect(engine.log.join("")).toContain("engine session activity unknown")
    await stopEngine(engine)
  }, 180_000)

  test("#1531 被测臂:围栏 + 出货的进程内交接 ⇒ ext 调度器问得到引擎 ⇒ 重载 ⇒ 报 reloaded", async () => {
    const engine = await bootEngine("fenced", { fetch: "in-process", ipc: true })
    expect(engine.log.join("")).toContain("engine-fence-preload: fence applied")
    const reports = await reloadViaParentPort(engine, 2)
    expect(reports[0], engine.log.join("").slice(-2000)).toEqual({ type: "codepuppy.reload.report", generation: 2, scope: "global", outcome: "reloaded", directories: [ws] })
    await stopEngine(engine)
  }, 180_000)
})
