import { afterEach, beforeEach, describe, expect, mock, test, vi } from "bun:test"
import { EventEmitter } from "node:events"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, parse, resolve } from "node:path"
import { writeCustomProviderTruth } from "./custom-provider-truth-write"
import { mockElectron } from "../../test-component/electron-mock"
import { __resetCodePuppyBootstrapForTests, parseCodePuppyBootstrap, publishCodePuppyBootstrap, type CodePuppyBootstrap, codepuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import { handOverCredentials } from "../../test-component/credential-table"

// `#1698`:每次 fork 交给 sidecar 的 start 消息(启动文档在它的 `bootstrap` 里)。
const startCalls: Array<{ type: "start"; bootstrap: CodePuppyBootstrap }> = []

class FakeChild extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()

  postMessage(message: { type: string }) {
    if (message.type === "start") startCalls.push(message as (typeof startCalls)[number])
    if (message.type === "start") queueMicrotask(() => this.emit("message", { type: "ready" }))
    if (message.type === "stop") queueMicrotask(() => this.emit("exit", 0))
  }

  kill() {
    queueMicrotask(() => this.emit("exit", 0))
  }
}

const appEvents = new EventEmitter()
const forkCalls: Array<{ file: string; args: string[]; options: Record<string, unknown> }> = []

mockElectron(() => ({
  app: {
    isPackaged: false,
    on: appEvents.on.bind(appEvents),
    off: appEvents.off.bind(appEvents),
    // `#1555`:目录刷新器从这里取 userData(只有「目录 fetch 永不 settle」那条用例会走到)。
    getPath: () => userDataPath,
  },
  utilityProcess: {
    fork: () => {
      throw new Error("unexpected utilityProcess.fork")
    },
  },
  BrowserWindow: class {},
  dialog: {},
  ipcMain: { handle: () => {} },
}))
// main 的 warn 行(`#1698`:构建器忽略一个导出值时记的那一行在这里判)
const warned: string[] = []
// main 的 error 行(SPEC-engine-config-fence AC-05:引擎配置写不进时拒绝 fork 的那一行在这里判)
const errored: string[] = []
mock.module("./logging", () => ({
  getLogger: () => ({ log: () => {}, warn: (...args: unknown[]) => void warned.push(args.map(String).join(" ")), error: (...args: unknown[]) => void errored.push(args.map(String).join(" ")) }),
  write: () => {},
  rotateServerLogs: () => {},
}))
mock.module("./store", () => ({ getStore: () => ({ get: () => null, set: () => {}, delete: () => {} }) }))
// REQ-226 `#1343`:spawnLocalServer 在 fork 前从钥匙串库取自定义服务密钥。库本身真跑;只把它那一个
// 函数的 Electron 接缝(codepuppy-keychain-backend,见该文件为何不 mock `electron`)换成能落盘的假钥匙串。
// 它不是本文件的被测对象(库的判据在 codepuppy-byok-keys.test.ts)。
mock.module("./codepuppy-keychain-backend", () => ({
  keychainBackend: () => ({
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  }),
}))
// 不 mock ./codepuppy-secret-files:真 syncSecretFiles 对 test 的临时 userDataPath 是 temp-scoped(写
// <tempdir>/codepuppy-secrets,无 ALPHA 密钥环境变量时 no-op,afterEach 清理)。全局 mock.module 会跨文件
// 泄漏残缺导出面,撞坏 codepuppy-secret-files.test.ts 的 `import { secretFileRef, ... }`(2026-07-21 Linux CI 实锤)。

// The host's two system prefixes are not test fixtures; keep all new preparation in isolated HOME.
const fencePlanner = { ...await import("./process-fence-plan") }
mock.module("./process-fence-plan", () => ({ ...fencePlanner, planUserWritableLocations: (input: Parameters<typeof fencePlanner.planUserWritableLocations>[0]) => fencePlanner.planUserWritableLocations({ ...input, eligibility: { ...input.eligibility, configFenceRoots: () => [...input.eligibility.configFenceRoots(), "/opt/homebrew", "/usr/local"] } }) }))

const { applyPlatformCredentialsHot, hasSecretFile, secretFilePath } = await import("./codepuppy-secret-files")
const { clearByokKeys, initByokKeys, storeByokKey } = await import("./codepuppy-byok-keys")
const { writeShellEnvCache } = await import("./shell-env-cache")
const { forkedSecretNames, resolveShellProbeRoots, preferAppEnv, preplanConfigFenceRoots, pushCredentialsToSidecar, spawnLocalServer, startupShellProbeFence } = await import("./server")
const { configFenceLocations, resolveEngineRoots } = await import("./process-fence-profile")
const { bootFenceWorkspaceTruth, readWorkspaceTruthOrThrow, writeWorkspaceTruth } = await import("./process-fence-workspaces")
const { GLOBAL_RENDERER_STORE, TABS_KEY } = await import("./tabs-preclean")
const { requestCatalogRefresh } = await import("./catalog-refresher")
const { appliedCatalogPath, writeCatalogSnapshot } = await import("./codepuppy-live-allowlist")
// REQ-159 `#1321`:生产 spawnLocalServer 在 fork 前做围栏计划(真 store / 真 sandbox-exec / 真原生模块路径);
// 本文件的假子进程不跑 sidecar.ts,注入一个替身计划 —— 围栏本身的判据在 process-fence-*.test.ts。
const fakePlanFence = () => ({ profile: "(version 1)\n(allow default)\n(deny file-write*)\n", addonPath: "/nonexistent/codepuppy_fence.node" })
const { creditDanglingSweepForSpawn, resetDanglingSweepLatchForTests } = await import("./dangling-sweep-latch")
// `#1411`(REQ-1414 CODE-1):下面「模型工具表」那一组用的四个**生产**供数方。全部动态 import ——
// 它们要么经 ui-mac 的 main 面(必须排在 electron mock 之后),要么是引擎/注入面的真模块。
const { injectCodePuppyConfig } = await import("./codepuppy-config-injection")
// `#1443`:第三方 web-search MCP 的**唯一**闸就住在 ext 里(注入面的 permission deny 只点名
// `websearch` 与 `cloud_cloud_web_search` 两个 id,够不着第三方)。下面那一组直接拿真判决函数判,
// 不在 ui-mac 这边手写一份等价条件 —— 手写的那份正是本文件反复吃过亏的「夹具顶替供数方」。
const { computeMcpOwnership, webSearchToolDenial } = await import("../../../ext/src/cloud-websearch-kill")

let userDataPath = ""
const keylessWebSearchFlags = [
  "OPENCODE_ENABLE_EXA",
  "OPENCODE_EXPERIMENTAL_EXA",
  "OPENCODE_ENABLE_PARALLEL",
  "OPENCODE_EXPERIMENTAL_PARALLEL",
] as const
const managedEnv = [
  "BUN_INSTALL",
  "PATH", // preferAppEnv applies the cached shell PATH; restore it before the next test file.
  "SHELL",
  "CODEPUPPY_GLOBAL_DIR",
  "CODEPUPPY_CLOUD_MCP_URL",
  "CODEPUPPY_CLOUD_TOKEN",
  "CODEPUPPY_MCP_TOKEN",
  "CODEPUPPY_API_KEY",
  "CODEPUPPY_ENV_FILE",
  "CODEPUPPY_SECRETS_DISABLE",
  "CODEPUPPY_WEBSEARCH_DISABLE",
  "CODEPUPPY_MODELS_DISABLE",
  ...keylessWebSearchFlags,
  "OPENCODE_EXPERIMENTAL",
] as const
const savedEnv: Partial<Record<(typeof managedEnv)[number], string>> = {}

beforeEach(() => {
  forkCalls.length = 0
  startCalls.length = 0
  resetDanglingSweepLatchForTests()
  creditDanglingSweepForSpawn()
  userDataPath = mkdtempSync(join(tmpdir(), "server-scratch-cwd-"))
  for (const key of managedEnv) {
    savedEnv[key] = process.env[key]
    // Keep the real toolchain available during this case; cached fork input may replace it.
    if (key !== "PATH") delete process.env[key]
  }
  process.env.SHELL = "nu"
  process.env.CODEPUPPY_SECRETS_DISABLE = "1"
  process.env.CODEPUPPY_GLOBAL_DIR = join(userDataPath, "codepuppy-state", "env", "dev") // #1698:无快照的单测经环境给全局根(design §10 R31),fork 时构建启动文档要它
})

afterEach(() => {
  for (const key of managedEnv) {
    const value = savedEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  rmSync(userDataPath, { recursive: true, force: true })
})

const fakeFork = ((file: string, args: string[], options: Record<string, unknown>) => {
  forkCalls.push({ file, args, options })
  return new FakeChild()
}) as unknown as typeof import("electron").utilityProcess.fork

/** Fork the sidecar the way boot/respawn does and hand back the env it was forked with. */
async function forkSidecar() {
  creditDanglingSweepForSpawn()
  const result = await spawnLocalServer("127.0.0.1", 4096, "password", {
    userDataPath,
    healthCheck: async () => true,
    planFence: fakePlanFence,
    fork: fakeFork,
  })
  await result.health.wait
  await result.listener.stop()
  return (forkCalls.at(-1)?.options.env ?? {}) as Record<string, string | undefined>
}

/** 同 forkSidecar,另带这次 start 消息里的启动文档(`#1698`:main 交给 sidecar 的决定在这里,不在 env)。 */
async function forkSidecarWithBootstrap() {
  const env = await forkSidecar()
  return { env, bootstrap: startCalls.at(-1)!.bootstrap }
}

/** 这一次 fork 交给 sidecar 的 web search 能力总闸(两条腿的拒绝判决都等于它)。 */
async function forkedKillSwitch() {
  return (await forkSidecarWithBootstrap()).bootstrap.webSearch.killSwitch
}

/** #621:登录态由 initAuthEnv/applyAuthEnv 建立,**晚于** preferAppEnv;env token 在下次 fork 时
 *  才经 syncSecretFiles 变成密钥文件。测试照这个真实顺序走,不预置 force-off 的判据。 */
function applyAuthEnvLikeLogin() {
  process.env.CODEPUPPY_CLOUD_MCP_URL = "https://cloud.example/mcp"
  process.env.CODEPUPPY_CLOUD_TOKEN = "token"
  // #1195:登录信封带 mcp_access_token 时 applyAuthEnv 同步写它;它是 #1195 起的代付判据文件源。
  process.env.CODEPUPPY_MCP_TOKEN = "mcp-token"
}

function applyAuthEnvLikeLogout() {
  delete process.env.CODEPUPPY_CLOUD_TOKEN
  delete process.env.CODEPUPPY_MCP_TOKEN
}

function keylessFlagsOf(env: Record<string, string | undefined>) {
  return Object.fromEntries(keylessWebSearchFlags.map((key) => [key, env[key]]))
}
const noKeylessFlags = Object.fromEntries(keylessWebSearchFlags.map((key) => [key, undefined]))

describe("web search sovereignty at sidecar fork (#621)", () => {
  // `#1667`(#1662 L5,清点表 E2):v1 时代这几条断言 main 在 fork 时怎么写 4 个 keyless 专用 flag(force-off / 还原基线 /
  // 默认 OPENCODE_ENABLE_EXA=1)。这 4 个名字在 2.x 无读者,main 不再写它们;新事实是:main 一个都不写,用户 shell 里导出的
  // 照旧原样经 `OPENCODE_` 前缀进 sidecar(在 2.x 里是惰性的)。kill-switch 的判决 `#1698` 起只走 start 消息里启动文档的
  // `webSearch.killSwitch`(此前是两个恒等于它的 CODEPUPPY_*_WEBSEARCH_DENY 环境变量;那两个名字已不在 fork 环境里,由下面
  // 「#1698 fork 的环境与 start 消息」一组判)。
  test("登录用户冷启动:main 不写任何 keyless flag;两条腿的拒绝判决都不置位", async () => {
    preferAppEnv(userDataPath, { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: process.env, home: process.env.HOME!, userDataPath }) })
    expect(keylessFlagsOf(process.env)).toEqual(noKeylessFlags)

    applyAuthEnvLikeLogin()

    const { env, bootstrap } = await forkSidecarWithBootstrap()
    expect(keylessFlagsOf(env)).toEqual(noKeylessFlags)
    expect(bootstrap.webSearch.killSwitch).toBe(false)
  })

  test("用户 shell export 的 keyless flag 照旧原样进 sidecar —— kill-switch 也不再改写它(判决走启动文档)", async () => {
    process.env.OPENCODE_ENABLE_PARALLEL = "1"

    preferAppEnv(userDataPath, { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: process.env, home: process.env.HOME!, userDataPath }) })
    applyAuthEnvLikeLogin()
    expect((await forkSidecar()).OPENCODE_ENABLE_PARALLEL).toBe("1")

    process.env.CODEPUPPY_WEBSEARCH_DISABLE = "1"
    const disabled = await forkSidecarWithBootstrap()
    expect(disabled.env.OPENCODE_ENABLE_PARALLEL).toBe("1")
    expect(disabled.bootstrap.webSearch.killSwitch).toBe(true)
  })

  test("logged-out/BYOK:main 不写任何 keyless flag,也不置位拒绝判决", async () => {
    process.env.CODEPUPPY_CLOUD_MCP_URL = "https://cloud.example/mcp" // URL 在场但无密钥文件 = 未登录

    preferAppEnv(userDataPath, { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: process.env, home: process.env.HOME!, userDataPath }) })

    const { env, bootstrap } = await forkSidecarWithBootstrap()
    expect(keylessFlagsOf(env)).toEqual(noKeylessFlags)
    expect(bootstrap.webSearch.killSwitch).toBe(false)
  })

  test("re-forking without an auth change is idempotent", async () => {
    preferAppEnv(userDataPath, { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: process.env, home: process.env.HOME!, userDataPath }) })
    applyAuthEnvLikeLogin()

    const first = await forkSidecarWithBootstrap()
    const second = await forkSidecarWithBootstrap()
    expect([keylessFlagsOf(first.env), first.bootstrap]).toEqual([keylessFlagsOf(second.env), second.bootstrap])
  })

  // #223 R2 Blocker 1:env force-off 与注入的 permission deny 都能被后置规则顶掉(agent wildcard /
  // 持久 session permission / approved)。主权判决必须另有一条到得了**工具自身**的通道 —— 这条
  // 断言走真实 fork,证明判决确实进了交给 sidecar 的启动文档(`#1698`;此前是 sidecar env)。
  test("the sovereignty verdict reaches the sidecar so the tool itself can refuse", async () => {
    process.env.CODEPUPPY_WEBSEARCH_DISABLE = "1"
    preferAppEnv(userDataPath, { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: process.env, home: process.env.HOME!, userDataPath }) })

    expect(await forkedKillSwitch()).toBe(true)
  })

  // `#1411`:以前这条叫「platform pays also ships the sovereignty verdict to the sidecar」,断言
  // 代付也置位本地拒绝判决。代付不再关本地腿 ⇒ 这条判决在代付态必须缺席,否则工具自身那道最终闸
  // 会把本地腿在**执行时**拒掉(permission 层看不出来,模型只会拿到一句「别重试」)。
  test("代付不再把本地拒绝判决送进 sidecar —— 两条腿的通道都保持干净", async () => {
    preferAppEnv(userDataPath, { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: process.env, home: process.env.HOME!, userDataPath }) })
    applyAuthEnvLikeLogin()

    expect(await forkedKillSwitch()).toBe(false)
  })

  test("`#1195` 判据换轴:登录但无 mcp_access(旧轴文件在、新轴文件缺)不算代付,本地腿不被拒", async () => {
    // pre-T1 服务端 / 信封未带字段的真实形态:applyAuthEnv 写了 CODEPUPPY_CLOUD_TOKEN,没写 CODEPUPPY_MCP_TOKEN。
    preferAppEnv(userDataPath, { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: process.env, home: process.env.HOME!, userDataPath }) })
    applyAuthEnvLikeLogin()
    delete process.env.CODEPUPPY_MCP_TOKEN

    expect(await forkedKillSwitch()).toBe(false)
    expect(hasSecretFile(userDataPath, "CODEPUPPY_MCP_TOKEN")).toBe(false)
  })

  // `#1411`:同上,驱动态换成 kill-switch —— 「判决必须两个方向都写」这条纪律没变,变的是唯一能
  // 置位它的状态。登出那一格追加一条:它在任何方向上都不该让判决重新出现。
  test("kill-switch 关掉之后 respawn 清掉本地拒绝判决,而不是把工具留在死状态", async () => {
    process.env.CODEPUPPY_WEBSEARCH_DISABLE = "1"
    preferAppEnv(userDataPath, { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: process.env, home: process.env.HOME!, userDataPath }) })
    applyAuthEnvLikeLogin()
    expect(await forkedKillSwitch()).toBe(true)

    delete process.env.CODEPUPPY_WEBSEARCH_DISABLE

    expect(await forkedKillSwitch()).toBe(false)

    applyAuthEnvLikeLogout()

    expect(await forkedKillSwitch()).toBe(false)
  })

  // #223 R3:云侧。`cloud_web_search` 是远端 MCP 工具,没有 alpha 能改的 execute 首行;最终闸在 @codepuppy/ext 的
  // tool.execute.before 钩子里,读的是同一个 `webSearch.killSwitch`(`#1698` 前是第二个恒等的 DENY 变量;「关掉之后下一次 fork
  // 清掉」那条与上面本地腿的同一条断言合一)。它只在 kill-switch 时置位 —— 平台代付态下云工具正是权威通道,不能连它一起关。
  // kill-switch 下真定义仍在文档的 `cloudMcp` 里(ext 的 installCloudMcp 据它在闸就位之后装,R5),只是带 {file:} 引用、不带令牌。
  test("the kill switch ships a cloud verdict to the sidecar; platform-pays does not", async () => {
    process.env.CODEPUPPY_WEBSEARCH_DISABLE = "1"
    preferAppEnv(userDataPath, { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: process.env, home: process.env.HOME!, userDataPath }) })
    applyAuthEnvLikeLogin()
    const killed = await forkSidecarWithBootstrap()
    expect(killed.bootstrap.webSearch.killSwitch).toBe(true)
    expect(killed.bootstrap.cloudMcp?.definition).toEqual({
      type: "remote",
      url: "https://cloud.example/mcp",
      headers: { Authorization: `Bearer {file:${secretFilePath(userDataPath, "CODEPUPPY_MCP_TOKEN")}}` },
      oauth: false,
      codemode: false,
    })
    expect(JSON.stringify(killed.bootstrap)).not.toContain("mcp-token")

    delete process.env.CODEPUPPY_WEBSEARCH_DISABLE
    // `#1411`:以前这里是 `toBe("1")` —— 代付即关本地腿。现在代付不置位判决。
    expect(await forkedKillSwitch()).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// `#1411`(REQ-1414 CODE-1)—— 退出条件 ①:**登录代付态下模型工具表同时含 `websearch` 与
// `cloud_cloud_web_search`**。
//
// 方案基线(`docs/design/2026-09-23-1414-web-tools-account-routing-baseline.md` §九 第 1 条)把这件事
// 明确标为「从代码结构推出来的**推论**,不是跑出来的」。这一组把它跑成事实。
//
// 「模型工具表」一条规则都不手写,四个供数方全是生产自己的:
//   ① main 的 `buildCodePuppyBootstrap()`(`#1698` 前是 `applyWebSearchSovereignty()`)+ `createSidecarEnv()` 白名单 ——
//      经真 `spawnLocalServer` fork 出来的那份 env 与启动文档(`forkSidecarWithBootstrap()`,与上面那组同一条路径);
//   ② 引擎的 `RuntimeFlags`(用真 `ConfigProvider` 解析①给出的那份 env,不是手写 `env[k] === "1"`);
//   ③ 引擎的 `webSearchEnabled()` —— 本地腿的**注册**闸,`tool/registry.ts` 的 `tools()` 用的就是它;
//   ④ 注入面的真 `injectCodePuppyConfig()` → 引擎的真 `Permission.fromConfig` + `Permission.disabled`
//      —— 两条腿的**可见性**闸,`session/llm/request.ts` 的 `resolveTools()` 用的就是它。
//
// 手段的自证(先证明它测得出已知的坏,再用它判未知的好):kill-switch 臂走同一条链,两条腿必须
// 一个都不在表里 —— 它同时覆盖②(flag 被 force-off)与④(permission deny)。
//
// 诚实边界,不粉饰:
//   · 「登录+有额度」与「登录+无额度」在桌面侧**不可区分**(account 契约里没有只读额度查询,
//     基线 §1.1(b)),两者在这里是同一格;「无额度」的可观察差别是云腿调用时的 402,不在本票范围。
//   · 云腿的「注册与否」判据只保证**代付且无 kill-switch**这一格准确:kill-switch 下真定义经
//     启动文档的 `cloudMcp` 交给 ext 的 `installCloudMcp()`,它读不到 `{file:}` 凭证时会响亮不装 —— 那半格这里
//     一律按「已注册」处理,再由 permission deny 兜住,两条路径结论相同(都不在表里)。
// ─────────────────────────────────────────────────────────────────────────────
describe("`#1411` / `#1443` web search 按账户态的在场性", () => {
  /** 在「sidecar 真正拿到的那份 env 与启动文档」下跑真注入面(sidecar 在注入之前发布文档),拿它写出的引擎配置与它自己置位的 env。 */
  function injectUnderSidecarEnv({ env: forkEnv, bootstrap }: { env: Record<string, string | undefined>; bootstrap: CodePuppyBootstrap }) {
    const saved = { ...process.env }
    for (const key of Object.keys(process.env)) delete process.env[key]
    for (const [key, value] of Object.entries(forkEnv)) if (value !== undefined) process.env[key] = value
    try {
      // 注入面的三个环境根钉进本用例的临时盘,免得读到宿主机的真实配置。
      process.env.CODEPUPPY_GLOBAL_DIR = join(userDataPath, "codepuppy-state", "env", "dev")
      process.env.XDG_CONFIG_HOME = join(userDataPath, "xdg-config")
      process.env.XDG_DATA_HOME = join(userDataPath, "xdg-data")
      mkdirSync(process.env.CODEPUPPY_GLOBAL_DIR, { recursive: true })
      // main 按 fork 那一刻的 XDG 算出的引擎全局配置目录可能是宿主机的真目录;同样钉进临时盘
      __resetCodePuppyBootstrapForTests()
      publishCodePuppyBootstrap(
        parseCodePuppyBootstrap({ ...bootstrap, paths: { ...bootstrap.paths, engineConfigDirectory: join(userDataPath, "xdg-config", "opencode") } }),
      )
      // 先证明注入真的跑成了 —— 它有一层函数级 catch,拿一份空配置当结论正是本文件要防的那类假绿。
      // `#1662` parity B1:2.x 的注入返回 `{ config: { content, file }, explicit }`(内联文档交给 start(),不再写 OPENCODE_CONFIG_CONTENT)。
      handOverCredentials(userDataPath) // SPEC-stored-credentials-fence:sidecar 在注入之前发布主进程交来的整表(T1)
      const { config } = injectCodePuppyConfig(userDataPath, undefined, "stable", codepuppyBootstrap().paths.userConfig ?? null)
      const parsed = JSON.parse(config.content) as EngineConfigShape
      expect(Object.keys(parsed.agents ?? {}).length).toBeGreaterThan(0)
      return { config: parsed, env: { ...process.env } }
    } finally {
      __resetCodePuppyBootstrapForTests()
      for (const key of Object.keys(process.env)) delete process.env[key]
      Object.assign(process.env, saved)
    }
  }

  type McpEntry = { url?: string; enabled?: boolean }
  type EngineConfigShape = { agents?: Record<string, unknown>; mcp?: { servers?: Record<string, McpEntry | undefined> } }

  // 2026-11-12 I-09 退役本组四条 `#1411` 用例(登录代付两条腿同在 / 登出只剩本地腿 / kill-switch 两条都不在 / 关掉后回来):
  // 它们的供数方 ②③④ 是 v1 引擎的 RuntimeFlags、webSearchEnabled、Permission,随 OpenCode 2 换代删除(`44b6938b2a`)。
  // 2.x 的替代:packages/ext/src/plugin-host.test.ts「权威 · 联网搜索准入(L5r)」(kill-switch 下内置 websearch 与第三方
  // web search MCP 在 execute.before 被拒,反向臂不装 ext 即放行)、「联网搜索:不在 kill-switch(代付 / 登出)⇒ 内置
  // websearch 照常放行」、「权威 · 云工具接入(M3)」;fork 出的那份 env 两个方向都写由本文件上面那组照常判。
  // 合成判据(「真 fork env → 引擎这一刻的模型工具表」一张表)由 `#1662` parity 第 9 项补上:
  // websearch-account-tool-table.engine.{test,cases}.ts(代付两条都在 / 登出只剩本地 / kill-switch 两条都不在 / 去掉注入的 deny 即回来)。

  // ───────────────────────────────────────────────────────────────────────────
  // `#1443`:同一条链上**用户自带的第三方 web-search MCP**(自己在配置里声明一个 exa 之类的
  // remote server)的在场性。
  //
  // 为什么必须跨包合成来判:第三方工具不在注入面那层 permission deny 里(`applyWebSearchDenies`
  // 只点名 `websearch` 与 `cloud_cloud_web_search` 两个 id),它唯一的闸是 `@codepuppy/ext` 的
  // `tool.execute.before`,判决靠启动文档过河(`#1698` 前是 fork env)。两半各自都有测试 —— main 在哪一态置位哪个信号
  // (本文件上面那两组)、ext 见到某组信号怎么判(`packages/ext/src/cloud-websearch-kill.test.ts`)——
  // 但「某个账户态下第三方到底能不能用」是这两半的**合成**,此前没有任何一条判据看着它。代价实测:
  // `#1411` 把代付那一格从「关」翻成「开」,两个包的测试各自照常全绿,行为变更零登记(本票)。
  //
  // 供数方仍然全是生产的:env 与启动文档来自真 `forkSidecarWithBootstrap()`;归属来自真 `injectCodePuppyConfig()` 写出的配置
  // + 真 `computeMcpOwnership()`;判决就是 ext 在钩子首行调的那个函数,不在这边手写等价条件。
  // ───────────────────────────────────────────────────────────────────────────
  describe("`#1443` 用户自带的第三方 web-search MCP", () => {
    /** 用户自己声明 `{"mcp":{"exa":{"type":"remote","url":"https://mcp.exa.ai/mcp"}}}` 会长出来的工具 id。 */
    const THIRD_PARTY_TOOL = "exa_web_search_exa"
    const THIRD_PARTY_SERVER = { exa: { type: "remote", url: "https://mcp.exa.ai/mcp" } }

    /** 这一刻第三方 web search 调得动吗:生产判决函数的原话,`undefined` = 放行。 */
    function thirdPartyDenial(fork: { env: Record<string, string | undefined>; bootstrap: CodePuppyBootstrap }) {
      const { config } = injectUnderSidecarEnv(fork)
      // 用户那份声明由引擎合并进来(注入面只写 Code Puppy 自己的那条),归属快照因此两边都要有;
      // 形状同 ext 在 mcp.transform 里取的那份(plugin.ts:`computeMcpOwnership({ mcp: Object.fromEntries(editor.list()) })`)。
      const merged = { mcp: { ...(config.mcp?.servers ?? {}), ...THIRD_PARTY_SERVER } }
      return webSearchToolDenial(THIRD_PARTY_TOOL, fork.bootstrap, computeMcpOwnership(merged, fork.bootstrap.cloudMcp))
    }

    test("登录代付:第三方 web search 可用(本地腿也活着,拦它护不住任何能力)", async () => {
      preferAppEnv(userDataPath, { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: process.env, home: process.env.HOME!, userDataPath }) })
      applyAuthEnvLikeLogin()

      expect(thirdPartyDenial(await forkSidecarWithBootstrap())).toBeUndefined()
    })

    test("登出 / BYOK:第三方 web search 可用", async () => {
      preferAppEnv(userDataPath, { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: process.env, home: process.env.HOME!, userDataPath }) })

      expect(thirdPartyDenial(await forkSidecarWithBootstrap())).toBeUndefined()
    })

    // 反例臂,也是 owner 2026-09-24 点名问的那一格:「一键关掉所有搜网」**仍然**关得掉第三方插件。
    // 它同时证明上面两条不是「怎么测都绿」。
    test("kill-switch:第三方 web search 照样被关", async () => {
      process.env.CODEPUPPY_WEBSEARCH_DISABLE = "1"
      preferAppEnv(userDataPath, { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: process.env, home: process.env.HOME!, userDataPath }) })
      applyAuthEnvLikeLogin()

      expect(thirdPartyDenial(await forkSidecarWithBootstrap())).toContain("kill switch")
    })

    test("kill-switch 关掉之后,下一次 fork 第三方回来", async () => {
      process.env.CODEPUPPY_WEBSEARCH_DISABLE = "1"
      preferAppEnv(userDataPath, { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: process.env, home: process.env.HOME!, userDataPath }) })
      applyAuthEnvLikeLogin()
      expect(thirdPartyDenial(await forkSidecarWithBootstrap())).toContain("kill switch")

      delete process.env.CODEPUPPY_WEBSEARCH_DISABLE

      expect(thirdPartyDenial(await forkSidecarWithBootstrap())).toBeUndefined()
    })
  })
})

// #223 对抗审计 Major 3(2026-07-25):基线曾在**登录 shell env 合入之前**截取。上面那组用例
// 靠 `SHELL=nu` 跳过真实 shell 导入(`loadShellEnv` 对 nushell 直接 return null),又在
// `preferAppEnv` 之前手写 `process.env` —— 于是整条真实导入序零覆盖,缺陷从测试面前溜过去了。
// 这组换成**真实登录 shell 探测**:SHELL 指向一个真脚本,由 spawnSync 真跑、真回吐 `env -0`。
describe("login-shell import vs the keyless flags (#223 Major 3)", () => {
  /** 写一个真能被 `spawnSync(shell, ["-il","-c","env -0"])` 跑起来的登录 shell 替身。 */
  function fakeLoginShell(name: string, exported: Record<string, string>) {
    const script = join(userDataPath, name)
    const body = Object.entries(exported)
      .map(([key, value]) => `${key}=${value}`)
      .join("\\000")
    writeFileSync(script, `#!/bin/sh\nprintf '${body}\\000'\n`)
    chmodSync(script, 0o755)
    return script
  }

  test("Bun probe defaults stay child-only through cached, fresh and synchronous environment merges", async () => {
    const original = process.env.BUN_INSTALL
    try {
      for (const mode of ["cached", "synchronous", "configured"] as const) {
        const slot = join(userDataPath, mode)
        mkdirSync(slot)
        const root = join(process.env.HOME!, mode === "configured" ? "configured-bun" : ".bun")
        if (mode === "configured") process.env.BUN_INSTALL = root
        else delete process.env.BUN_INSTALL
        const context = { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: { ...process.env }, home: process.env.HOME!, userDataPath: slot }) }
        context.env.BUN_INSTALL = root
        process.env.SHELL = fakeLoginShell(`bun-${mode}.sh`, { BUN_INSTALL: mode === "configured" ? "/wrong/probed-bun" : root, R8_PROBE_MARKER: "fresh", PATH: "/usr/bin:/bin" })
        if (mode === "cached") writeShellEnvCache(slot, process.env.SHELL, { BUN_INSTALL: root, R8_PROBE_MARKER: "cached", PATH: "/usr/bin:/bin" })
        preferAppEnv(slot, context)
        expect(process.env.BUN_INSTALL).toBe(mode === "configured" ? root : undefined)
        if (mode === "cached") {
          const deadline = Date.now() + 2_000
          while (process.env.R8_PROBE_MARKER !== "fresh" && Date.now() < deadline) await Bun.sleep(5)
          expect(process.env.R8_PROBE_MARKER).toBe("fresh")
          expect(process.env.BUN_INSTALL).toBeUndefined()
        }
      }
    } finally {
      if (original === undefined) delete process.env.BUN_INSTALL
      else process.env.BUN_INSTALL = original
      delete process.env.R8_PROBE_MARKER
    }
  })

  test("a failing probe-fence preparation does not end startup: the login-shell merge is skipped, the rest still applies", async () => {
    // No application environment here, so the real preparation throws as planning/proxy/truth failures do at startup.
    process.env.SHELL = fakeLoginShell("unfenced-probe.sh", { R8_PROBE_MARKER: "fresh", PATH: "/usr/bin:/bin" })
    writeShellEnvCache(userDataPath, process.env.SHELL, { R8_PROBE_MARKER: "cached", PATH: "/usr/bin:/bin" })
    const stateHome = process.env.XDG_STATE_HOME
    delete process.env.XDG_STATE_HOME
    const before = errored.length
    try {
      const probeFence = await startupShellProbeFence()
      expect(probeFence).toBeUndefined()
      expect(errored.slice(before).join("\n")).toContain("shell probe fence unavailable")
      preferAppEnv(userDataPath, probeFence)
      await Bun.sleep(50)
      expect(process.env.R8_PROBE_MARKER).toBeUndefined()
      expect(process.env.XDG_STATE_HOME).toBe(userDataPath)
    } finally {
      delete process.env.R8_PROBE_MARKER
      if (stateHome === undefined) delete process.env.XDG_STATE_HOME
      else process.env.XDG_STATE_HOME = stateHome
    }
  })

  test("app-supplied root defaults reach the probe child but never main's own environment, so a relaunch cannot mistake them for user exports", () => {
    const keys = ["XDG_CACHE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "OPENCODE_CONFIG_DIR"] as const
    const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
    try {
      for (const key of keys) delete process.env[key]
      process.env.XDG_DATA_HOME = join(process.env.HOME!, "user-data-root")
      const context = { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: { ...process.env }, home: process.env.HOME!, userDataPath }) }
      expect(context.env.XDG_CACHE_HOME).toBe(context.roots.cacheHome)
      preferAppEnv(userDataPath, context)
      expect(process.env.XDG_CACHE_HOME).toBeUndefined()
      expect(process.env.XDG_CONFIG_HOME).toBeUndefined()
      expect(process.env.OPENCODE_CONFIG_DIR).toBeUndefined()
      expect(process.env.XDG_DATA_HOME).toBe(join(process.env.HOME!, "user-data-root"))
    } finally {
      for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]
    }
  })

  test("trusted probe roots survive cached input and the real asynchronous refresh", async () => {
    const context = { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: { ...process.env }, home: process.env.HOME!, userDataPath }) }
    process.env.SHELL = fakeLoginShell("root-refresh.sh", { HOME: "/wrong/fresh", XDG_CONFIG_HOME: "/wrong/fresh", XDG_DATA_HOME: "/wrong/fresh", OPENCODE_DB: "/wrong/fresh.db", R8_PROBE_MARKER: "fresh", PATH: "/usr/bin:/bin" })
    writeShellEnvCache(userDataPath, process.env.SHELL, { HOME: "/wrong/cache", XDG_CONFIG_HOME: "/wrong/cache", XDG_DATA_HOME: "/wrong/cache", R8_PROBE_MARKER: "cached", PATH: "/usr/bin:/bin" })
    try {
      preferAppEnv(userDataPath, context)
      expect(process.env.R8_PROBE_MARKER).toBe("cached")
      expect(process.env.HOME).toBe(context.roots.home)
      expect(process.env.XDG_CONFIG_HOME).toBe(context.roots.configHome)
      const deadline = Date.now() + 2_000
      while (process.env.R8_PROBE_MARKER !== "fresh" && Date.now() < deadline) await Bun.sleep(5)
      expect(process.env.R8_PROBE_MARKER).toBe("fresh")
      expect(process.env.HOME).toBe(context.roots.home)
      expect(process.env.XDG_CONFIG_HOME).toBe(context.roots.configHome)
      expect(process.env.XDG_DATA_HOME).toBe(context.roots.dataHome)
      expect(process.env.OPENCODE_DB).toBe(context.env.OPENCODE_DB)
      const { env, bootstrap } = await forkSidecarWithBootstrap()
      expect(env.XDG_CONFIG_HOME).toBe(context.roots.configHome)
      expect(bootstrap.paths.engineConfigDirectory).toBe(context.roots.engineConfigDirectory)
    } finally {
      delete process.env.R8_PROBE_MARKER
    }
  })

  // `#1667`(清点表 E2):v1 时代这里钉的是「force-off 之前截取的基线必须是真实 shell 导入之后的值」。main 不再写这 4 个 flag
  // 之后,那套基线不复存在;新事实更简单:真实 shell 导入的值原样留在 env 里,登录、登出、kill-switch 开关一整圈都不改写它。
  test("a shell-exported keyless flag is never rewritten: login, logout and the kill-switch round trip all leave it alone", async () => {
    process.env.SHELL = fakeLoginShell("login-shell.sh", {
      PATH: "/usr/bin:/bin",
      OPENCODE_ENABLE_PARALLEL: "1",
    })
    expect(process.env.OPENCODE_ENABLE_PARALLEL).toBeUndefined()

    preferAppEnv(userDataPath, { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: process.env, home: process.env.HOME!, userDataPath }) })
    expect(process.env.OPENCODE_ENABLE_PARALLEL).toBe("1")
    expect((await forkSidecar()).OPENCODE_ENABLE_PARALLEL).toBe("1")

    applyAuthEnvLikeLogin()
    expect((await forkSidecar()).OPENCODE_ENABLE_PARALLEL).toBe("1")
    applyAuthEnvLikeLogout()
    expect((await forkSidecar()).OPENCODE_ENABLE_PARALLEL).toBe("1")

    process.env.CODEPUPPY_WEBSEARCH_DISABLE = "1"
    expect((await forkSidecar()).OPENCODE_ENABLE_PARALLEL).toBe("1")
    delete process.env.CODEPUPPY_WEBSEARCH_DISABLE
    expect((await forkSidecar()).OPENCODE_ENABLE_PARALLEL).toBe("1")
  })

  test("the cached shell env path behaves the same", async () => {
    const shell = join(userDataPath, "broken-shell.sh")
    writeFileSync(shell, "#!/bin/sh\nexit 1\n")
    chmodSync(shell, 0o755)
    process.env.SHELL = shell
    writeShellEnvCache(userDataPath, shell, { PATH: "/usr/bin:/bin", OPENCODE_ENABLE_PARALLEL: "1" })

    preferAppEnv(userDataPath, { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: process.env, home: process.env.HOME!, userDataPath }) })
    expect(process.env.OPENCODE_ENABLE_PARALLEL).toBe("1")

    process.env.CODEPUPPY_WEBSEARCH_DISABLE = "1"
    expect((await forkSidecar()).OPENCODE_ENABLE_PARALLEL).toBe("1")
    delete process.env.CODEPUPPY_WEBSEARCH_DISABLE
    expect((await forkSidecar()).OPENCODE_ENABLE_PARALLEL).toBe("1")
  })
})

describe("spawnLocalServer", () => {
  test("a stop that never drains is bounded by the 6s graceful budget", async () => {
    class HangingStopChild extends FakeChild {
      kills = 0

      postMessage(message: { type: string }) {
        if (message.type === "start") queueMicrotask(() => this.emit("message", { type: "ready" }))
        // stop 故意不 exit:复现活动连接拖住 graceful stop 的 packaged 现场。
      }

      kill() {
        this.kills++
        queueMicrotask(() => this.emit("exit", 0))
      }
    }

    const run = async (beforeKillMs: number) => {
      creditDanglingSweepForSpawn()
      const child = new HangingStopChild()
      const result = await spawnLocalServer("127.0.0.1", 4098, "password", {
        userDataPath,
        healthCheck: async () => true,
        planFence: fakePlanFence,
        fork: (() => child) as unknown as typeof import("electron").utilityProcess.fork,
      })
      await result.health.wait

      const stopping = result.listener.stop()
      vi.advanceTimersByTime(beforeKillMs)
      await Promise.resolve()
      expect(child.kills).toBe(0)
      vi.advanceTimersByTime(1)
      await stopping
      expect(child.kills).toBe(1)
    }

    vi.useFakeTimers()
    try {
      await run(5_999)
    } finally {
      vi.useRealTimers()
    }
  })

  // #223 对抗审计 Major 4(2026-07-25):密钥文件同步失败后仍继续 fork —— 登出删不掉旧 token
  // 文件时只写日志继续,主权闸读到旧文件仍判 platformPays=true,新 sidecar 带着已作废的 token
  // 注册云工具;反向地登录写失败会静默回落 keyless。密钥同步是 fork 的前置条件,不是尽力而为。
  test("refuses to fork when the secret file sync fails", async () => {
    const parentIsAFile = join(userDataPath, "not-a-directory")
    writeFileSync(parentIsAFile, "")
    const brokenUserData = join(parentIsAFile, "userdata")

    await expect(
      spawnLocalServer("127.0.0.1", 4096, "password", {
        userDataPath: brokenUserData,
        healthCheck: async () => true,
        planFence: fakePlanFence,
        fork: fakeFork,
      }),
    ).rejects.toThrow(/codepuppy-secrets sync failed/)
    expect(forkCalls).toHaveLength(0)
  })

  // REQ-237 `#1555` AC1(方案 req236 I1①):目录请求一直不返回时,本机 fork 照常推进。修前每次换代都先
  // `await syncLiveAllowlist`(续期平均白等 4.0s、最多 8s);现在刷新器在后台,spawnLocalServer 只读写本机文件。
  // 把 fork 路径改回等待目录(任何 await 刷新结果的写法),这条用例就挂在永不落定的 fetch 上直到超时转红。
  test("`#1555` AC1:目录 fetch 永不 settle 时 spawnLocalServer 仍完成 fork", async () => {
    const realFetch = globalThis.fetch
    const catalogRequests: string[] = []
    globalThis.fetch = ((input: string | URL | Request) => {
      catalogRequests.push(String(input instanceof Request ? input.url : input))
      return new Promise<Response>(() => {})
    }) as typeof fetch
    try {
      writeCatalogSnapshot(userDataPath, {
        fetchedAt: "2026-10-30T00:00:00Z",
        pricingBasisModelId: "deepseek-v4-flash",
        models: [{ id: "deepseek-v4-flash", pricing: { input: 1, output: 1 }, display: { name: "DeepSeek V4 Flash", brand: "deepseek" } }],
      })
      expect(requestCatalogRefresh("boot")).toBeUndefined()
      expect(catalogRequests.some((url) => url.endsWith("/v1/models"))).toBe(true) // 目录请求已发出且挂着
      expect(catalogRequests.some((url) => url.endsWith("/v1/byok-catalog"))).toBe(true) // `#1556`:BYOK 那份同样挂着

      const result = await spawnLocalServer("127.0.0.1", 4099, "password", {
        userDataPath,
        healthCheck: async () => true,
        planFence: fakePlanFence,
        fork: fakeFork,
        generation: 5,
      })
      await result.health.wait
      expect(forkCalls).toHaveLength(1)
      // fork 前钉住的是当刻的已下载目录,带着这一代的序号。
      expect(JSON.parse(readFileSync(appliedCatalogPath(userDataPath), "utf8"))).toEqual({
        generation: 5,
        platform: expect.objectContaining({ fetchedAt: "2026-10-30T00:00:00Z" }),
        // `#1556`:BYOK 那份一起钉住;还没下载过远程版本 ⇒ 随包首启引导。
        byok: expect.objectContaining({ schema_version: 1 }),
        byokSource: "bundled",
      })
      await result.listener.stop()
    } finally {
      globalThis.fetch = realFetch
    }
  })

  // REQ-237 `#1555` AC4:已应用目录写不进去 ⇒ 与密钥文件写失败同一条 fail-closed 路径,拒绝本次 fork。
  // 否则这一代引擎会读到上一代钉住的旧目录(或没有目录),picker 与引擎重新分叉。
  test("`#1555` AC4:已应用目录钉住失败时拒绝 fork", async () => {
    mkdirSync(join(appliedCatalogPath(userDataPath), "occupied"), { recursive: true })
    await expect(
      spawnLocalServer("127.0.0.1", 4096, "password", {
        userDataPath,
        healthCheck: async () => true,
        planFence: fakePlanFence,
        fork: fakeFork,
      }),
    ).rejects.toThrow(/applied model catalog pin failed — sidecar fork refused/)
    expect(forkCalls).toHaveLength(0)
  })

  // REQ-226 `#1343` AC4 咽喉点在**这条**生产 fork 路径上:自定义服务密钥 = 钥匙串库 → custom-provider--<id>
  // 文件,不经 env;sidecar env 里没有值;只有「真源文件里的 id ∩ 库键集」才物化(孤儿条目不落盘);
  // 库里没了 ⇒ 下一次 fork 清扫文件(与目录 BYOK 同一撤销语义)。
  test("REQ-226: an off-catalog custom provider's key is materialized keychain → file at fork; the forked env never carries it; gone from the store ⇒ swept next fork", async () => {
    const base = join(realpathSync(userDataPath), "codepuppy-state")
    const root = join(base, "env", "dev")
    mkdirSync(root, { recursive: true })
    // `#1392`:记录的真源是 <casBaseRoot>/custom-providers/<env>.json(围栏写不到的那棵树),codepuppy.jsonc 里的
    // provider 块从此**既不注入也不物化**。本用例因此播在真源上 —— 播错地方时这条用例就不再驱动 fork 前物化那一步
    // (2026-09-22 `#1392` 合入后实测转红,`#1416`)。用生产写端落盘,不在这里手抄它的字节。
    writeCustomProviderTruth(
      join(base, "custom-providers", "dev.json"),
      [{ id: "my-endpoint", name: "Mine", compat: "openai", baseURL: "https://x.invalid/v1", models: ["m"] }],
      { mkdirSync, writeFileSync, renameSync, rmSync },
    )
    process.env.CODEPUPPY_GLOBAL_DIR = root
    const value = "test-value-not-a-real-key-Zq81"
    initByokKeys(userDataPath)
    try {
      expect(storeByokKey("my-endpoint", value)).toEqual({ ok: true })
      expect(storeByokKey("orphan", `${value}-orphan`)).toEqual({ ok: true })
      const env = await forkSidecar()
      const file = "custom-provider--my-endpoint"
      expect(hasSecretFile(userDataPath, file)).toBe(true)
      expect(readFileSync(secretFilePath(userDataPath, file), "utf8")).toBe(value)
      expect(hasSecretFile(userDataPath, "custom-provider--orphan")).toBe(false)
      expect(JSON.stringify(env)).not.toContain("test-value")
      clearByokKeys()
      initByokKeys(userDataPath)
      await forkSidecar()
      expect(hasSecretFile(userDataPath, file)).toBe(false)
    } finally {
      clearByokKeys()
    }
  })

  // REQ-236 `#1562`:续期热应用依赖 fork 时定下的两样事实 —— 这次 fork 写进 {file:} 通道的凭据名集合
  // (applyPlatformCredentialsHot 据它判在场性变没变;不记就恒为「还没 fork 过」⇒ 热写被跳过,引擎一直读旧令牌),
  // 与交给 sidecar 的平台凭据引用(ext chat.headers 据它现读)。引用只能是 {file:} 形态,env 里不带令牌(方案 I1)。
  test("#1562 fork 记下写入的凭据名集合,并把平台凭据的 {file:} 引用(不是令牌)交给 sidecar", async () => {
    process.env.CODEPUPPY_API_KEY = "test-platform-key-not-real-7Kd2"
    applyAuthEnvLikeLogin()
    const { env, bootstrap } = await forkSidecarWithBootstrap()
    // `#1698` G2:引用在启动文档的 platform.credentialRef(不再是 sidecar env 的 CODEPUPPY_PLATFORM_AUTH_REF)
    expect(bootstrap.platform.credentialRef).toBe(`{file:${secretFilePath(userDataPath, "CODEPUPPY_API_KEY")}}`)
    expect(env).not.toHaveProperty("CODEPUPPY_PLATFORM_AUTH_REF")
    expect(JSON.stringify(env)).not.toContain("test-platform-key")
    expect(JSON.stringify(bootstrap)).not.toContain("test-platform-key")
    expect([...(forkedSecretNames() ?? [])]).toEqual(expect.arrayContaining(["CODEPUPPY_API_KEY", "CODEPUPPY_MCP_TOKEN"]))
    // 同一份 fork 集合下的续期 ⇒ 热写生效(凭据文件就地换新)。
    expect(applyPlatformCredentialsHot(userDataPath, { ...process.env, CODEPUPPY_API_KEY: "next-key" }, forkedSecretNames(), pushCredentialsToSidecar)).toBe(
      "applied",
    )
    expect(readFileSync(secretFilePath(userDataPath, "CODEPUPPY_API_KEY"), "utf8")).toBe("next-key")
  })

  // DESIGN-stored-credentials-fence §4.2 / §4.3:T1 随 start 交存放点整表;引擎装载前的拉取同步应答当刻盘上的表;续期整表推送;拉取超时
  // (credentials.unavailable)⇒ credential-change 重启;子进程退出后推送跳过。值都是一眼可辨的假值。
  class CredentialChild extends FakeChild {
    posted: Array<Record<string, any>> = []
    override postMessage(message: { type: string }) {
      this.posted.push(message as Record<string, any>)
      super.postMessage(message)
    }
  }
  const spawnWith = async (child: CredentialChild, respawns: string[]) => {
    creditDanglingSweepForSpawn()
    return spawnLocalServer("127.0.0.1", 4099, "password", {
      userDataPath,
      healthCheck: async () => true,
      planFence: fakePlanFence,
      fork: (() => child) as unknown as typeof import("electron").utilityProcess.fork,
      requestRespawn: (trigger) => void respawns.push(trigger),
    })
  }

  test("plugin MCP proxy publication waits for its sidecar acknowledgement and revokes on exit", async () => {
    const { startEgressPolicyProxy } = await import("./network-egress-proxy")
    const { configurePluginMcpProxy, bindPluginMcpProxy, pluginMcpProxySnapshot } = await import("./plugin-mcp-proxy")
    const proxy = await startEgressPolicyProxy({ log: () => {} })
    const child = new CredentialChild()
    configurePluginMcpProxy(proxy)
    try {
      const running = await spawnWith(child, [])
      await running.health.wait
      expect(child.posted.find(message => message.type === "start")?.pluginMcpProxies).toEqual({})
      let acknowledged = false
      const pending = bindPluginMcpProxy("rill", { packageId: "claude:rill", entryId: "mcp:rill-developer", generation: "gen-000001-abcdef", definitionDigest: ("sha256:" + "e".repeat(64)) as `sha256:${string}`, serverUrl: "http://127.0.0.1:9009/mcp" }).then(() => { acknowledged = true })
      const update = child.posted.at(-1)!
      expect(update.type).toBe("plugin-mcp-proxies")
      expect(acknowledged).toBe(false)
      child.emit("message", { type: "plugin-mcp-proxies-ready", revision: update.revision })
      await pending
      expect(acknowledged).toBe(true)
      child.emit("exit", 0)
      expect(pluginMcpProxySnapshot()).toEqual({})
    } finally { child.emit("exit", 0); await proxy.close() }
  })

  test("I-20 T1 / P / T2:start 带存放点整表;credentials.request 同步回复当刻盘上的表;续期推整表;unavailable ⇒ credential-change;退出后推送跳过", async () => {
    process.env.CODEPUPPY_API_KEY = "FAKE-platform-A"
    const child = new CredentialChild()
    const respawns: string[] = []
    const result = await spawnWith(child, respawns)
    await result.health.wait
    const key = secretFilePath(userDataPath, "CODEPUPPY_API_KEY")
    const start = child.posted.find((message) => message.type === "start")!
    expect(start.credentials[key]).toEqual({ value: "FAKE-platform-A", use: { kind: "inline" } })
    expect(JSON.stringify(start.bootstrap)).not.toContain("FAKE-platform-A")

    writeFileSync(key, "FAKE-platform-B")
    const before = child.posted.length
    child.emit("message", { type: "credentials.request", id: 7 })
    expect(child.posted).toHaveLength(before + 1) // 收到与回复之间没有 await
    expect(child.posted.at(-1)).toMatchObject({ type: "credentials", id: 7 })
    expect(child.posted.at(-1)!.credentials[key].value).toBe("FAKE-platform-B")

    expect(applyPlatformCredentialsHot(userDataPath, { ...process.env, CODEPUPPY_API_KEY: "FAKE-platform-C" }, forkedSecretNames(), pushCredentialsToSidecar)).toBe("applied")
    const pushed = child.posted.at(-1)!
    expect(pushed.type).toBe("credentials")
    expect("id" in pushed).toBe(false)
    expect(pushed.credentials[key].value).toBe("FAKE-platform-C")

    expect(respawns).toEqual([])
    child.emit("message", { type: "credentials.unavailable", id: 8 })
    expect(respawns).toEqual(["credential-change"])

    await result.listener.stop()
    const after = child.posted.length
    pushCredentialsToSidecar()
    expect(child.posted).toHaveLength(after)
    delete process.env.CODEPUPPY_API_KEY
  })

  // ② 审查第 1 条 (b):一次卡住会发两次 unavailable(一次装载拉两份文档、几个 Location 同时装载)⇒ 每一代只请求一次重启
  test("I-20:同一代里 credentials.unavailable 来几次都只请求一次 credential-change", async () => {
    const child = new CredentialChild()
    const respawns: string[] = []
    const result = await spawnWith(child, respawns)
    await result.health.wait
    child.emit("message", { type: "credentials.unavailable", id: 1 })
    child.emit("message", { type: "credentials.unavailable", id: 2 })
    child.emit("message", { type: "credentials.unavailable", id: 3 })
    expect(respawns).toEqual(["credential-change"])
    await result.listener.stop()
  })

  // 实现期修订 1(编排器裁决 2026-11-20,② 审查区外观察):存放点里单项读不出或目录列不出 ⇒ 按该项不在表里处理并记名字,不拒 fork、不回错误
  test("I-20 修订 1:存放点里一项读不出(mode 000)、一个目录列不出(mode 000)⇒ start 照常带其余整表;拉取照常回复(不回 error、不请求重启);日志点名路径与 errno、不含值", async () => {
    process.env.CODEPUPPY_API_KEY = "FAKE-platform-readable"
    const store = join(userDataPath, "codepuppy-mcp-secrets")
    const readable = join(store, "alpha", "v-0000aaaa", "OK")
    const locked = join(store, "alpha", "v-0000aaaa", "TOKEN")
    const unlistable = join(store, "bravo")
    mkdirSync(join(unlistable, "v-0000aaaa"), { recursive: true })
    writeFileSync(join(unlistable, "v-0000aaaa", "TOKEN"), "FAKE-behind-unlistable")
    mkdirSync(join(store, "alpha", "v-0000aaaa"), { recursive: true })
    writeFileSync(readable, "FAKE-readable-connector")
    writeFileSync(locked, "FAKE-locked")
    chmodSync(locked, 0o000)
    chmodSync(unlistable, 0o000)
    const child = new CredentialChild()
    const respawns: string[] = []
    warned.length = 0
    try {
      const result = await spawnWith(child, respawns)
      await result.health.wait
      const start = child.posted.find((message) => message.type === "start")!
      expect(start.credentials[secretFilePath(userDataPath, "CODEPUPPY_API_KEY")]?.value).toBe("FAKE-platform-readable")
      expect(start.credentials[readable]?.value).toBe("FAKE-readable-connector")
      expect(start.credentials[locked]).toBeUndefined()
      expect(Object.keys(start.credentials).some((key) => key.startsWith(unlistable))).toBe(false)
      child.emit("message", { type: "credentials.request", id: 3 })
      expect(child.posted.at(-1)).toMatchObject({ type: "credentials", id: 3 })
      expect(child.posted.at(-1)!.credentials[locked]).toBeUndefined()
      expect(child.posted.at(-1)!.credentials[readable]?.value).toBe("FAKE-readable-connector")
      expect(respawns).toEqual([])
      expect(warned.filter((line) => line.includes(locked) && line.includes("EACCES"))).toHaveLength(1) // once per generation, not per pull
      expect(warned.filter((line) => line.includes(unlistable) && line.includes("EACCES"))).toHaveLength(1)
      for (const line of warned) expect(line.includes("FAKE-")).toBe(false)
      await result.listener.stop()
    } finally {
      chmodSync(locked, 0o600)
      chmodSync(unlistable, 0o700)
      rmSync(store, { recursive: true, force: true })
      delete process.env.CODEPUPPY_API_KEY
    }
  })

  // SPEC-engine-config-fence BR-03 / AC-05 第一句(DESIGN-engine-config-fence §4.4、§5):显式文件、模型底表与种子由 main 在 fork 前写;
  // 写不进或该删的 models.json 删不掉 ⇒ 与密钥文件、已应用目录同一条路径拒绝 fork,留一行具名日志,不退回 sidecar 里去写。
  test("AC-05:引擎配置目录写不进 ⇒ 拒绝 fork,日志恰一行 [I-13] 并点名路径", async () => {
    const blocked = join(userDataPath, "codepuppy-engine-config")
    writeFileSync(blocked, "")
    errored.length = 0
    await expect(
      spawnLocalServer("127.0.0.1", 4096, "password", { userDataPath, healthCheck: async () => true, planFence: fakePlanFence, fork: fakeFork }),
    ).rejects.toThrow(/engine config files could not be written — sidecar fork refused/)
    expect(forkCalls).toHaveLength(0)
    const lines = errored.filter((line) => line.startsWith("[I-13] engine config files could not be written — refusing to fork:"))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(blocked)
  })

  test("AC-05 / E5:模型底表该删(CODEPUPPY_MODELS_DISABLE)却删不掉 ⇒ 同样拒绝 fork;删得掉时 fork 前已删", async () => {
    const models = join(userDataPath, "codepuppy-engine-config", "models.json")
    mkdirSync(join(models, "occupied"), { recursive: true })
    process.env.CODEPUPPY_MODELS_DISABLE = "1"
    errored.length = 0
    await expect(
      spawnLocalServer("127.0.0.1", 4096, "password", { userDataPath, healthCheck: async () => true, planFence: fakePlanFence, fork: fakeFork }),
    ).rejects.toThrow(/engine config files could not be written — sidecar fork refused/)
    expect(forkCalls).toHaveLength(0)
    expect(errored.filter((line) => line.startsWith("[I-13] engine config files could not be written — refusing to fork:") && line.includes(models))).toHaveLength(1)
    rmSync(models, { recursive: true })
    writeFileSync(models, "{}")
    await forkSidecar()
    expect(forkCalls).toHaveLength(1)
    expect(() => readFileSync(models)).toThrow()
  })

  test("BR-03 / E7:fork 前 main 写好显式文件与种子并跑监听 —— 子进程活着时手改 codepuppy.jsonc、main 装一个技能 ⇒ main 重写显式文件;子进程退出后不再跟", async () => {
    const explicit = join(userDataPath, "codepuppy-engine-config", "codepuppy-explicit.json")
    const userConfig = join(process.env.CODEPUPPY_GLOBAL_DIR!, "codepuppy.jsonc")
    const result = await spawnLocalServer("127.0.0.1", 4096, "password", { userDataPath, healthCheck: async () => true, planFence: fakePlanFence, fork: fakeFork })
    await result.health.wait
    expect(JSON.parse(readFileSync(userConfig, "utf8"))).toEqual({ $schema: "https://opencode.ai/config.json" })
    const commands = () => Object.keys((JSON.parse(readFileSync(explicit, "utf8")) as { commands?: Record<string, unknown> }).commands ?? {})
    expect(commands()).toEqual(["init", "review"])
    const edit = (name: string) => {
      writeFileSync(`${userConfig}.tmp`, JSON.stringify({ commands: { [name]: { template: name } } }))
      renameSync(`${userConfig}.tmp`, userConfig)
    }
    const waitFor = async (predicate: () => boolean) => {
      for (const until = Date.now() + 3_000; Date.now() < until; await new Promise((resolve) => setTimeout(resolve, 25))) if (predicate()) return true
      return predicate()
    }
    await new Promise((resolve) => setTimeout(resolve, 250)) // 递归目录监听起来要一点时间
    edit("while-alive")
    expect(await waitFor(() => commands().includes("while-alive"))).toBe(true)
    // main 装一个技能(ext-transaction 的姿势:生成目录 + current.json 指向它 + 允许集里有这个键)⇒ 显式文件的 skills 跟着重写
    const root = process.env.CODEPUPPY_GLOBAL_DIR!
    const generation = join(root, "ext-store", "skill--installed", "generations", "gen-000001-abcdef")
    mkdirSync(generation, { recursive: true })
    writeFileSync(join(root, "ext-store", "skill--installed", "current.json"), JSON.stringify({ generation: "gen-000001-abcdef" }))
    writeFileSync(join(root, "skills-enabled.json"), JSON.stringify({ v: 3, keys: ["skill--installed"], scoped: [], mcp: [] }))
    const skills = () => (JSON.parse(readFileSync(explicit, "utf8")) as { skills?: string[] }).skills ?? []
    expect(await waitFor(() => skills().some((entry) => entry.endsWith(join("skill--installed", "generations", "gen-000001-abcdef"))))).toBe(true)
    await result.listener.stop()
    edit("after-exit")
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(commands()).toContain("while-alive")
    expect(commands()).not.toContain("after-exit")
  })

  test("forks the sidecar in the userData scratch directory", async () => {
    const result = await spawnLocalServer("127.0.0.1", 4096, "password", {
      userDataPath,
      healthCheck: async () => true,
      planFence: fakePlanFence,
      fork: fakeFork,
    })
    await result.health.wait

    expect(forkCalls).toHaveLength(1)
    const cwd = forkCalls[0]?.options.cwd
    expect(cwd).toBe(join(userDataPath, "engine-scratch-cwd"))
    expect(cwd).not.toBe(process.cwd())
    expect(cwd).not.toBe(resolve(homedir()))
    expect(cwd).not.toBe(parse(resolve(userDataPath)).root)
    // #613:正常 ready 不携带注入失败
    expect(result.injectionFailure).toBeUndefined()

    await result.listener.stop()
  })

  // #613 反向闸门(退出条件 1/3:main 侧可观测,链条第三环):ready IPC 携带 injectionFailure 时,
  // spawnLocalServer 必须把它暴露给调用方(终态生产者据此发布 "injection-failed")。
  // 把 server.ts 里的 `injectionFailure = message.injectionFailure` 删掉(main 重新装聋),本用例转红。
  test("ready IPC 携带 injectionFailure 时,spawnLocalServer 把注入失败暴露给 main", async () => {
    class InjectionFailedChild extends FakeChild {
      postMessage(message: { type: string }) {
        if (message.type === "start")
          queueMicrotask(() =>
            this.emit("message", { type: "ready", injectionFailure: { message: "ENOTDIR: mkdir userdata" } }),
          )
        if (message.type === "stop") queueMicrotask(() => this.emit("exit", 0))
      }
    }
    const result = await spawnLocalServer("127.0.0.1", 4097, "password", {
      userDataPath,
      healthCheck: async () => true,
      planFence: fakePlanFence,
      fork: (() => new InjectionFailedChild()) as unknown as typeof import("electron").utilityProcess.fork,
    })
    await result.health.wait

    expect(result.injectionFailure).toEqual({ message: "ENOTDIR: mkdir userdata" })

    await result.listener.stop()
  })
})

// `#1698`(DESIGN-upgrade-bootstrap-config §4.2 / §4.5 最终形态):main 交给 sidecar 的决定走 start 消息里的启动文档。生产
// spawnLocalServer 的 fork 环境里,Code Puppy 的键只剩用户的逃生门 CODEPUPPY_ENV_ALLOWLIST_EXTRA 本身 —— 设计 §2.2 的旧键全部导出、
// 并且全部写进 EXTRA 也一样(前缀拒绝排在 EXTRA 之前)。反向臂:去掉 sidecar-env.ts 的前缀拒绝,或把它排到 EXTRA 之后,或给前缀拒绝
// 加回任一个例外键(再加回 EXACT)⇒ 那个键回到 env ⇒ 红。
describe("#1698 fork 的环境与 start 消息", () => {
  const G1 = ["CODEPUPPY_GLOBAL_DIR", "CODEPUPPY_JSONC_TRUTH_DISABLE", "CODEPUPPY_LEGACY_INSTALL_ROOT", "CODEPUPPY_OFFICE_MCP_MANIFEST", "CODEPUPPY_EXT_BUNDLED_MANIFEST"]
  const G2 = [
    "CODEPUPPY_BASE_URL", "CODEPUPPY_PLATFORM_AUTH_REF", "CODEPUPPY_DEFAULT_MODEL", "CODEPUPPY_CLOUD_MCP_URL", "CODEPUPPY_CLOUD_MCP_SERVER",
    "CODEPUPPY_CLOUD_MCP_DEF", "CODEPUPPY_CLOUD_MCP_ARM", "CODEPUPPY_WEBSEARCH_DISABLE", "CODEPUPPY_LOCAL_WEBSEARCH_DENY",
    "CODEPUPPY_CLOUD_WEBSEARCH_DENY", "CODEPUPPY_POLICY_ACCOUNT", "CODEPUPPY_EGRESS_PROXY", "CODEPUPPY_PROVIDER_ALLOW",
  ]
  const G3 = [
    "CODEPUPPY_FACTORY_SKILL_DIRS", "CODEPUPPY_FACTORY_DENY_SKILLS", "CODEPUPPY_MODELS_DISABLE", "CODEPUPPY_IDENTITY_DISABLE",
    "CODEPUPPY_BEHAVIOR_DISABLE", "CODEPUPPY_PROMPT_REBRAND_DISABLE", "CODEPUPPY_ECOSYSTEM_INHERIT", "CODEPUPPY_AUTOMATION_DISABLE",
    "CODEPUPPY_READONLY_DISABLE", "CODEPUPPY_EXT_VERBOSE", "CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS",
  ]
  const OLD_KEYS = [...G1, ...G2, ...G3]

  test("§2.2 的旧键全部导出并写进 EXTRA:fork 环境里的 CODEPUPPY_* 只剩 EXTRA 本身;start 消息带启动文档、不再带六个决定字段", async () => {
    const saved = Object.fromEntries([...OLD_KEYS, "CODEPUPPY_ENV_ALLOWLIST_EXTRA"].map((name) => [name, process.env[name]]))
    const root = process.env.CODEPUPPY_GLOBAL_DIR!
    try {
      for (const name of OLD_KEYS) process.env[name] = name === "CODEPUPPY_GLOBAL_DIR" ? root : "1"
      process.env.CODEPUPPY_ENV_ALLOWLIST_EXTRA = OLD_KEYS.join(",")
      const starts: Array<Record<string, unknown>> = []
      class RecordingChild extends FakeChild {
        override postMessage(message: { type: string }) {
          if (message.type === "start") starts.push(message as Record<string, unknown>)
          super.postMessage(message)
        }
      }
      const result = await spawnLocalServer("127.0.0.1", 4098, "password", {
        userDataPath,
        healthCheck: async () => true,
        planFence: fakePlanFence,
        fork: ((file: string, args: string[], options: Record<string, unknown>) => (forkCalls.push({ file, args, options }), new RecordingChild())) as never,
      })
      await result.health.wait
      await result.listener.stop()
      const env = (forkCalls.at(-1)?.options.env ?? {}) as Record<string, string | undefined>
      expect(Object.keys(env).filter((name) => name.toUpperCase().startsWith("CODEPUPPY_"))).toEqual(["CODEPUPPY_ENV_ALLOWLIST_EXTRA"])
      const start = starts.at(-1)!
      for (const field of ["userDataPath", "initialDirectory", "databasePath", "configDirectory", "extPluginPath", "registryChannel"]) expect(start).not.toHaveProperty(field)
      expect(start.bootstrap).toMatchObject({ v: 1, paths: { userData: userDataPath, globalRoot: expect.stringContaining("codepuppy-state") } })
      // REQ-059 逃生阀在 main 判一次:置位 ⇒ 文档里没有 codepuppy.jsonc
      expect((start.bootstrap as { paths: Record<string, unknown> }).paths).not.toHaveProperty("userConfig")
      // G2 在 main 判一次:kill-switch 任意非空串即开;导出的默认模型原样;不合格的地址("1")省略,不抛
      const doc = start.bootstrap as CodePuppyBootstrap
      expect(doc.webSearch.killSwitch).toBe(true)
      expect(doc.platform).toEqual({ credentialRef: `{file:${secretFilePath(userDataPath, "CODEPUPPY_API_KEY")}}`, defaultModelOverride: "1" })
      expect(doc).not.toHaveProperty("cloudMcp")
      // G3 在 main 判一次:"1" 让每个开关都开;期限 "1" 是合法的 1 ms;出厂技能目录取 boot 时对账的结果(本进程没对账 ⇒ 空)
      expect(Object.values(doc.switches)).toEqual(Object.values(doc.switches).map(() => true))
      expect(doc.permission).toEqual({ askTimeoutMs: 1 })
      expect(doc.skills).toEqual({ factoryDirs: [] })
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  })
})

// `#1698`(编排器 2026-11-13 裁决,承 Codex 审计 Major):用户导出的值不合格从不中止启动 —— 构建器校验的每一个导出值,不合格就当没设
// (那个字段回到缺省)并记一行,行里只有变量名与「ignored」,不带值;fork 照常。相对路径没有确定的基准(GUI 应用),一律算不合格,
// `OPENCODE_CONFIG_DIR=.` 就是审计复现的那个输入。表驱动:每行只放一个坏值。相对的 HOME 那一行在 codepuppy-bootstrap-build.test.ts
// (bun 的 os.homedir() 在进程启动时取一次 HOME,这里改 process.env.HOME 驱动不到它;Electron 的 Node 每次调用都读)。
describe("#1698 不合格的导出值被忽略,启动照常", () => {
  const configDefault = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode")
  const rows: Array<{ name: string; bad: string; unset?: string[]; holds: (doc: CodePuppyBootstrap) => boolean }> = [
    { name: "OPENCODE_CONFIG_DIR", bad: ".", holds: (doc) => doc.paths.engineConfigDirectory === configDefault() },
    { name: "OPENCODE_CONFIG_DIR", bad: "cfg/sub", holds: (doc) => doc.paths.engineConfigDirectory === configDefault() },
    { name: "XDG_CONFIG_HOME", bad: "rel-config", unset: ["OPENCODE_CONFIG_DIR"], holds: (doc) => doc.paths.engineConfigDirectory === join(homedir(), ".config", "opencode") },
    { name: "XDG_DATA_HOME", bad: "rel-data", unset: ["OPENCODE_DB"], holds: (doc) => doc.paths.database.startsWith(join(homedir(), ".local", "share", "opencode") + "/") },
    { name: "CODEPUPPY_USER_WORKSPACE_DIR", bad: "work", holds: (doc) => doc.paths.initialDirectory === join(homedir(), "code-puppy") },
    { name: "CODEPUPPY_BASE_URL", bad: "https://user:pw-secret@gw.example/v1", holds: (doc) => doc.platform.modelProxyBaseURL === undefined },
    { name: "CODEPUPPY_CLOUD_MCP_URL", bad: "https://cloud.example/mcp?token=tok-secret", holds: (doc) => doc.cloudMcp === undefined },
    { name: "CODEPUPPY_PERMISSION_ASK_TIMEOUT_MS", bad: "soon", holds: (doc) => doc.permission.askTimeoutMs === undefined },
  ]

  for (const row of rows)
    test(`${row.name}=${JSON.stringify(row.bad)} ⇒ fork 照常、字段回到缺省、恰好一行点名它被忽略(不带值)`, async () => {
      const names = [row.name, ...(row.unset ?? [])]
      const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]))
      try {
        for (const name of row.unset ?? []) delete process.env[name]
        process.env[row.name] = row.bad
        warned.length = 0
        const forks = forkCalls.length
        const { env, bootstrap } = await forkSidecarWithBootstrap()
        expect(forkCalls.length).toBe(forks + 1)
        expect([row.name, row.holds(bootstrap)]).toEqual([row.name, true])
        // 被忽略的路径变量在 sidecar 的环境里也没有(引擎与文档看到同一个「没设」);别的变量本来就不过河或原样
        if (["OPENCODE_CONFIG_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME"].includes(row.name)) expect([row.name, env[row.name]]).toEqual([row.name, undefined])
        expect(warned.filter((line) => line.includes(`${row.name} ignored`))).toHaveLength(1)
        // The value probe covers the reader's own lines (its one format, `bootstrap: <name> ignored (<reason>)`,
        // codepuppy-bootstrap-build.ts `ignored`); unrelated warnings such as a missing ext dist path contain "." too.
        const reader = warned.filter((line) => line.startsWith("bootstrap: "))
        expect(reader.length).toBeGreaterThan(0)
        expect(reader.filter((line) => line.includes(row.bad))).toEqual([])
      } finally {
        for (const [name, value] of Object.entries(saved)) {
          if (value === undefined) delete process.env[name]
          else process.env[name] = value
        }
      }
    })
})

// 实现期修订 2 A:主进程启动时读的 $CODEPUPPY_ENV_FILE(userEnvFile —— loadCodePuppySecrets 用的同一个来源)交给计划器,进 CF-4。
describe("修订 2 A:CODEPUPPY_ENV_FILE 交给计划器", () => {
  const planInputs = async () => {
    const seen: Array<{ envFile?: string }> = []
    creditDanglingSweepForSpawn()
    const result = await spawnLocalServer("127.0.0.1", 4096, "password", {
      userDataPath,
      healthCheck: async () => true,
      planFence: (input: { envFile?: string }) => {
        seen.push(input)
        return fakePlanFence()
      },
      fork: fakeFork,
    })
    await result.health.wait
    await result.listener.stop()
    return seen
  }
  test("设置(绝对 / 相对)⇒ 计划输入带同一份路径(相对按 cwd);不设 ⇒ 没有这一项", async () => {
    const saved = process.env.CODEPUPPY_ENV_FILE
    try {
      process.env.CODEPUPPY_ENV_FILE = join(userDataPath, "elsewhere", "cp.env")
      expect((await planInputs()).map((input) => input.envFile)).toEqual([join(userDataPath, "elsewhere", "cp.env")])
      process.env.CODEPUPPY_ENV_FILE = "relative/cp.env"
      expect((await planInputs()).map((input) => input.envFile)).toEqual([resolve(process.cwd(), "relative/cp.env")])
      delete process.env.CODEPUPPY_ENV_FILE
      expect((await planInputs()).map((input) => "envFile" in input)).toEqual([false])
    } finally {
      if (saved === undefined) delete process.env.CODEPUPPY_ENV_FILE
      else process.env.CODEPUPPY_ENV_FILE = saved
    }
  })
})

// 审查 B 第 2 条(SPEC-engine-config-fence BR-05):本运行第一次计划之前,资格判定用的受保护配置目录与计划器、启动文档同一个来源 ——
// 用户导出的相对 OPENCODE_CONFIG_DIR / XDG_CONFIG_HOME 当没设(usableExportedPaths),不按主进程 cwd 解析。否则 cwd 被当成受保护目录,
// 真源里 cwd 之下的诚实项目在 boot 时被检疫、第一次切 tab 就从真源删掉。
describe("审查 B 第 2 条:计划之前的受保护配置目录 = 计划器的受保护目录", () => {
  const variables = ["OPENCODE_CONFIG_DIR", "XDG_CONFIG_HOME"] as const
  // XDG_DATA_HOME (CF-11, 片 ③) is only ever set to an absolute scratch path, never unset: without it the engine data directory falls back
  // to os.homedir() — the developer's real one, which the test-isolation preload cannot pin — and spawnLocalServer reads that directory
  type Variable = (typeof variables)[number] | "XDG_DATA_HOME"
  const withEnv = async <T>(values: Partial<Record<Variable, string>>, run: () => Promise<T> | T): Promise<T> => {
    const names: Variable[] = [...variables, ...(values.XDG_DATA_HOME !== undefined ? (["XDG_DATA_HOME"] as const) : [])]
    const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]))
    try {
      for (const name of names) {
        if (values[name] === undefined) delete process.env[name]
        else process.env[name] = values[name]
      }
      return await run()
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    }
  }
  const inputs = () => ({ userDataPath, appStateRoot: join(userDataPath, "codepuppy-state"), codepuppyGlobalRoot: process.env.CODEPUPPY_GLOBAL_DIR! })

  const rows: Array<{ label: string; values: (base: string) => Partial<Record<Variable, string>> }> = [
    { label: "both unset", values: () => ({}) },
    { label: "OPENCODE_CONFIG_DIR absolute", values: (base) => ({ OPENCODE_CONFIG_DIR: join(base, "exported-config") }) },
    { label: "OPENCODE_CONFIG_DIR=.", values: () => ({ OPENCODE_CONFIG_DIR: "." }) },
    { label: "OPENCODE_CONFIG_DIR relative", values: () => ({ OPENCODE_CONFIG_DIR: "cfg/sub" }) },
    { label: "XDG_CONFIG_HOME absolute", values: (base) => ({ XDG_CONFIG_HOME: join(base, "xdg-config") }) },
    { label: "XDG_CONFIG_HOME relative", values: () => ({ XDG_CONFIG_HOME: "rel-config" }) },
    { label: "XDG_DATA_HOME absolute", values: (base) => ({ XDG_DATA_HOME: join(base, "xdg-data") }) },
  ]
  for (const row of rows)
    test(`${row.label}: the pre-plan roots equal the planner's protected directories for the same environment`, async () => {
      const base = realpathSync(mkdtempSync(join(tmpdir(), "cf-roots-")))
      try {
        await withEnv(row.values(base), async () => {
          let planned: { sidecarEnv: Record<string, string | undefined>; engineConfigDirectory: string } | undefined
          creditDanglingSweepForSpawn()
          const result = await spawnLocalServer("127.0.0.1", 4096, "password", {
            userDataPath,
            healthCheck: async () => true,
            planFence: (input: { sidecarEnv: Record<string, string | undefined>; engineConfigDirectory: string }) => {
              planned = input
              return fakePlanFence()
            },
            fork: fakeFork,
          })
          await result.health.wait
          await result.listener.stop()
          // the planner's own inputs (planProcessFence hands planConfigFence the start document's directory and
          // resolveEngineRoots(sidecarEnv, homedir())), compared as locations BEFORE the planner resolves them on disk: in bun
          // os.homedir() is the HOME this process started with — the developer's real one, which the test-isolation preload
          // cannot pin (I-08) — so nothing here may mkdir or realpath under it (final review item 1)
          const subpaths = (rules: ReturnType<typeof configFenceLocations>) => rules.flatMap((rule) => (rule.kind === "subpath" ? [rule.path] : []))
          const planner = subpaths(configFenceLocations({ ...inputs(), engineConfigDirectory: planned!.engineConfigDirectory, configHome: resolveEngineRoots(planned!.sidecarEnv, homedir()).configHome, home: homedir(), dataHome: resolveEngineRoots(planned!.sidecarEnv, homedir()).dataHome }))
          const before = preplanConfigFenceRoots({ env: process.env, home: homedir(), ...inputs() })
          expect([...new Set(before)].sort()).toEqual([...new Set(planner)].sort())
          // CF-11 (片 ③):both sides put the tool policy directory under the exported data home
          const dataHome = row.values(base).XDG_DATA_HOME
          if (dataHome) expect(before).toContain(join(dataHome, "opencode", "codepuppy-tool-policy"))
        })
      } finally {
        rmSync(base, { recursive: true, force: true })
      }
    })

  test("OPENCODE_CONFIG_DIR=. with the app started from a folder holding an honest project: it stays eligible and stays in the truth across boot and one tab change", async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), "cf-cwd-")))
    const project = join(cwd, "honest-project")
    const other = join(cwd, "other-project")
    mkdirSync(project)
    mkdirSync(other)
    const previous = process.cwd()
    try {
      process.chdir(cwd)
      await withEnv({ OPENCODE_CONFIG_DIR: "." }, () => {
        // an isolated HOME (never the process's start HOME, I-08): the case is about the relative OPENCODE_CONFIG_DIR only
        const home = join(userDataPath, "home")
        const truthPath = join(userDataPath, "fence-workspaces", "dev.json")
        const fs = { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync }
        writeWorkspaceTruth(truthPath, [project, other], fs)
        const draft = (id: string, directory: string) => ({ type: "draft", draftID: id, server: "sidecar", directory })
        const tracker = bootFenceWorkspaceTruth({
          truthPath,
          store: { tabs: JSON.stringify([draft("p", project), draft("o", other)]), recent: undefined, info: undefined },
          fs,
          log: () => {},
          eligibility: {
            homeDir: home,
            appStateRoot: inputs().appStateRoot,
            configFenceRoots: () => preplanConfigFenceRoots({ env: process.env, home, ...inputs() }),
            realpath: (p) => realpathSync.native(p),
            isDirectory: () => true,
          },
          onWritableChanged: () => {},
        })
        expect(tracker.quarantined).toEqual([])
        // one tab change (the user closes the other project): the honest one stays in the truth
        tracker.noteRendererStoreSet(GLOBAL_RENDERER_STORE, TABS_KEY, JSON.stringify([draft("p", project)]))
        expect(readWorkspaceTruthOrThrow(truthPath, { readFileSync })).toEqual([project])
      })
    } finally {
      process.chdir(previous)
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

// `#1667`(#1662 L5;编排器裁决 alpha-code#1666 评论 6737930969 第 2 条 `l1r-telemetry-credential`,#1562):fork 时真交给
// sidecar 的那份环境(createSidecarEnv 之上 server.ts 再加 UV_CACHE_DIR、清单路径、代理变量……)里没有任何 `OTEL_*` ——
// OpenCode 2 唯一的遥测导出(OTLP)只认环境变量。白名单本身的反向臂(把 OTEL_ 加进前缀 ⇒ 红)在 sidecar-env-otel.test.ts。
describe("#1562 fork 给 sidecar 的环境里没有 OTEL_*", () => {
  const OTEL = ["OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_EXPORTER_OTLP_HEADERS", "OTEL_RESOURCE_ATTRIBUTES", "OTEL_SERVICE_NAME"] as const
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const key of OTEL) saved[key] = process.env[key]
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "https://collector.example/v1"
    process.env.OTEL_EXPORTER_OTLP_HEADERS = "authorization=Bearer sk-not-a-real-collector-key"
    process.env.OTEL_RESOURCE_ATTRIBUTES = "deployment.environment=prod"
    process.env.OTEL_SERVICE_NAME = "codepuppy"
  })
  afterEach(() => {
    for (const key of OTEL) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  test("main 自己的环境里带着整套 OTLP 变量,fork 出去的 sidecar 环境里一个都没有", async () => {
    preferAppEnv(userDataPath, { profile: "(version 1)(allow default)(deny file-write*)", ...resolveShellProbeRoots({ env: process.env, home: process.env.HOME!, userDataPath }) })
    const env = await forkSidecar()
    expect(env.PATH).toBeDefined() // 拿到的确实是 fork 用的那份环境
    expect(Object.keys(env).filter((name) => /^otel_/i.test(name))).toEqual([])
  })
})

// SPEC-engine-config-fence BR-03 / AC-05 / DESIGN-engine-config-fence §4.5 / E6:sidecar 里的 ext 经 parentPort 发 `codepuppy.tool-policy.write.request`,
// main 在 child 的 message 链上接住、写盘、写完再回复。文档落在 fork 交给 sidecar 的那份环境算出的数据目录 —— 也就是 ext 读的位置。
describe("I-13 tool policy writes from the sidecar go through main", () => {
  const { policyFilePath, loadPolicyDocument } = require("../../../ext/src/policy/store") as typeof import("../../../ext/src/policy/store")
  const { defaultPolicyBaseDir } = require("../../../ext/src/policy/resolver") as typeof import("../../../ext/src/policy/resolver")
  const partition = { account: "acct:server-test", workspace: "/work/server-test" }
  const shell = { selector: { level: "tool", canonical: "builtin::shell" }, state: "disabled" }

  /** A sidecar stand-in that keeps everything main posts to it; the hub host only records what reaches it. */
  async function spawned() {
    const posted: Array<Record<string, unknown>> = []
    const hub: unknown[] = []
    let child: FakeChild | undefined
    class RecordingChild extends FakeChild {
      override postMessage(message: { type: string }) {
        posted.push(message as Record<string, unknown>)
        super.postMessage(message)
      }
    }
    creditDanglingSweepForSpawn()
    const result = await spawnLocalServer("127.0.0.1", 4099, "password", {
      userDataPath,
      healthCheck: async () => true,
      planFence: fakePlanFence,
      fork: ((file: string, args: string[], options: Record<string, unknown>) => (forkCalls.push({ file, args, options }), (child = new RecordingChild()))) as never,
      // like the real host (hub-view.ts): only the `codepuppy.*` family is its business
      codepuppySidecar: { receive: (message) => String((message as { type?: unknown })?.type).startsWith("codepuppy.") && (hub.push(message), true), attach: () => () => {} },
    })
    await result.health.wait
    const env = (forkCalls.at(-1)?.options.env ?? {}) as Record<string, string | undefined>
    // the data directory comes from the isolated XDG_DATA_HOME (the test-isolation preload), never from the developer's real home
    expect(env.XDG_DATA_HOME, "the fork env carries the isolated XDG_DATA_HOME").toBeDefined()
    expect(env.XDG_DATA_HOME!.startsWith(`${homedir()}/`)).toBe(false)
    const baseDir = defaultPolicyBaseDir(join(env.XDG_DATA_HOME!, "opencode"))
    const send = (message: unknown) => child!.emit("message", message)
    const replies = () => posted.filter((message) => message.type === "codepuppy.tool-policy.write.reply")
    return { result, baseDir, send, replies, hub }
  }

  test("E6: a save and a reset from the sidecar are written where ext reads them, then answered (ok; ok with the backup)", async () => {
    const { result, baseDir, send, replies, hub } = await spawned()
    try {
      send({ type: "codepuppy.tool-policy.write.request", id: 11, op: "save", partition, records: [shell] })
      const loaded = loadPolicyDocument(baseDir, partition)
      expect(loaded.status === "ok" ? loaded.doc.records : loaded).toEqual([shell])
      expect(replies()).toEqual([{ type: "codepuppy.tool-policy.write.reply", id: 11, ok: true }])
      send({ type: "codepuppy.tool-policy.write.request", id: 12, op: "reset", partition })
      expect(loadPolicyDocument(baseDir, partition).status).toBe("absent")
      const reset = replies()[1] as { id: number; ok: boolean; backup: string }
      expect([reset.id, reset.ok, reset.backup.startsWith(`${policyFilePath(baseDir, partition)}.quarantined-`)]).toEqual([12, true, true])
      expect(hub).toEqual([])
    } finally {
      await result.listener.stop()
      rmSync(baseDir, { recursive: true, force: true })
    }
  })

  test("AC-05: main cannot write ⇒ an error reply naming the path and errno, the old document byte for byte, one named line; a malformed request ⇒ an error reply and one line; other codepuppy.* messages still reach the hub host", async () => {
    const { result, baseDir, send, replies, hub } = await spawned()
    try {
      send({ type: "codepuppy.tool-policy.write.request", id: 21, op: "save", partition, records: [shell] })
      const file = policyFilePath(baseDir, partition)
      const before = readFileSync(file)
      warned.length = 0
      chmodSync(baseDir, 0o500)
      try {
        send({ type: "codepuppy.tool-policy.write.request", id: 22, op: "save", partition, records: [] })
      } finally {
        chmodSync(baseDir, 0o700)
      }
      const refused = replies()[1] as { id: number; error: string }
      expect(refused.id).toBe(22)
      expect(refused.error).toContain("EACCES")
      expect(refused.error).toContain(baseDir)
      expect(readFileSync(file)).toEqual(before)
      expect(warned.filter((line) => line.startsWith("[I-13] tool policy save failed:"))).toHaveLength(1)
      send({ type: "codepuppy.tool-policy.write.request", id: 23, op: "save", partition: { account: "a" } })
      expect(replies()[2]).toMatchObject({ type: "codepuppy.tool-policy.write.reply", id: 23 })
      expect(typeof (replies()[2] as { error?: unknown }).error).toBe("string")
      expect(warned.filter((line) => line.startsWith("[I-13] tool policy write request is malformed"))).toHaveLength(1)
      const other = { type: "codepuppy.hub.request.request", id: 24, requestId: "req_aaaaaaaa" }
      send(other)
      expect(hub).toEqual([other])
    } finally {
      await result.listener.stop()
      rmSync(baseDir, { recursive: true, force: true })
    }
  })
})

// DESIGN-domestic-cloud-connectivity §4.8、§8 E-6 的自动化部分:引擎环境的 PATH 末尾追加 <资源根>/ripgrep(与 UV_CACHE_DIR 同处);
// 用户自己的路径排在前面。再用**引擎自己的** `which`(packages/core/src/util/which.ts,RipgrepBinary 查 rg 用的就是它)对这一代 fork
// 出去的 PATH 解析,引擎 bin 目录清空:随包 rg 在 ⇒ 解析到资源根之下(不走下载);用户 PATH 里有 rg ⇒ 用户的优先;随包 rg 没有执行位 ⇒
// 解析不到(RipgrepBinary 退回它现有的下载路径,引擎代码不改)。资源根在非打包态是本包的 resources/,桩 rg 只在这条用例里存在。
describe("§4.8 随包 ripgrep 进引擎 PATH", () => {
  test("fork 的 PATH = 用户 PATH + <resourcesRoot()>/ripgrep;引擎的 which 在清空的引擎 bin 下解析到资源根里的 rg", async () => {
    const { resourcesRoot } = await import("./ext-fs-installer")
    const { which } = await import("../../../core/src/util/which")
    const bundled = join(resourcesRoot(), "ripgrep")
    const rg = join(bundled, "rg")
    const created = !existsSync(bundled)
    const userBin = mkdtempSync(join(tmpdir(), "user-bin-"))
    const engineBin = mkdtempSync(join(tmpdir(), "engine-bin-"))
    try {
      mkdirSync(bundled, { recursive: true })
      writeFileSync(rg, "#!/bin/sh\necho bundled\n", { mode: 0o755 })
      process.env.PATH = "/usr/bin:/bin"
      const env = await forkSidecar()
      expect(env.PATH).toBe(`/usr/bin:/bin:${bundled}`)
      expect(which("rg", { PATH: env.PATH }, engineBin)).toBe(rg)
      expect(which("rg", { PATH: env.PATH }, engineBin)!.startsWith(resourcesRoot() + "/")).toBe(true)

      writeFileSync(join(userBin, "rg"), "#!/bin/sh\necho user\n", { mode: 0o755 })
      process.env.PATH = `${userBin}:/usr/bin:/bin`
      const withUser = await forkSidecar()
      expect(withUser.PATH).toBe(`${userBin}:/usr/bin:/bin:${bundled}`)
      expect(which("rg", { PATH: withUser.PATH }, engineBin)).toBe(join(userBin, "rg"))

      chmodSync(rg, 0o644)
      expect(which("rg", { PATH: env.PATH }, engineBin)).toBeNull()
    } finally {
      rmSync(created ? bundled : rg, { recursive: true, force: true })
      rmSync(userBin, { recursive: true, force: true })
      rmSync(engineBin, { recursive: true, force: true })
    }
  })
})

test("external write scope uses the actual rendered rules for files and keeps protected denies", async () => {
  const { renderProcessFenceProfile } = await import("./process-fence-profile")
  // R3 fixed user-config file, as the planner's R7-verified userWritableLocations deliver it.
  const fixedWritable = [{ kind: "literal" as const, value: "/fence-home/.zshrc" }]
  const profile = renderProcessFenceProfile({ roots: { home: "/fence-home", configHome: "/fence-home/.config", dataHome: "/fence-home/.local/share", cacheHome: "/fence-home/.cache" }, workspaces: ["/opened"], userWritableLocations: fixedWritable, userDataPath: "/fence-data", stateHome: "/fence-state", codepuppyGlobalRoot: "/fence-global", egressProxyPort: 4443, configFence: [{ kind: "literal", path: "/opened/protected" }], homebrewFence: [], credentialStores: [{ kind: "subpath", path: "/vault/credentials" }] })
  creditDanglingSweepForSpawn()
  const result = await spawnLocalServer("127.0.0.1", 4096, "password", { userDataPath, healthCheck: async () => true, planFence: () => ({ ...fakePlanFence(), profile, fixedWritable }), fork: fakeFork })
  try {
    await result.health.wait
    const before = await result.listener.readWriteScope({ access: "write", targets: ["/opened/file", "/outside/file", "/opened/protected", "/vault/credentials/key", "/fence-home/.zshrc"].map((absolute) => ({ absolute, directory: parse(absolute).dir })) })
    // C-1: only the fixed-table target is "fixed"; other writable sources stay "writable".
    expect(before).toMatchObject({ targets: [{ absolute: "/opened/file", outcome: "writable" }, { absolute: "/outside/file", outcome: "needs-approval" }, { absolute: "/opened/protected", outcome: "protected" }, { absolute: "/vault/credentials/key", outcome: "protected" }, { absolute: "/fence-home/.zshrc", outcome: "fixed" }] })
    expect(await result.listener.readWriteScope({ access: "write", targets: [] })).toMatchObject({ revision: (before as { revision: number }).revision, targets: [] })
  } finally { await result.listener.stop() }
})

// SPEC child-process-write-fence v7 BR-11 (design v6 §4.2): the real directory is resolved with filesystem semantics, and a
// directory R4 could never grant (HOME, the app state root) answers `ineligible`. Real directories outside every writable root
// of the rendered profile (not under the tmp roots the profile writes).
test("external write scope resolves the real directory on disk and marks folders R4 cannot grant as ineligible", async () => {
  const { renderProcessFenceProfile } = await import("./process-fence-profile")
  const { statSync, symlinkSync } = await import("node:fs")
  const base = join(import.meta.dir, "../../node_modules/.cache")
  mkdirSync(base, { recursive: true })
  const root = realpathSync.native(mkdtempSync(join(base, "write-scope-real-")))
  const [home, state, project, outside] = ["home", "state", "project", "outside"].map((name) => join(root, name)) as [string, string, string, string]
  for (const directory of [home, state, project, join(outside, "sub")]) mkdirSync(directory, { recursive: true })
  symlinkSync(join(outside, "sub"), join(project, "link"))
  const profile = renderProcessFenceProfile({ roots: { home, configHome: join(home, ".config"), dataHome: join(home, ".local/share"), cacheHome: join(home, ".cache") }, workspaces: [project], userWritableLocations: [], userDataPath: join(root, "data"), stateHome: join(root, "state-home"), codepuppyGlobalRoot: join(root, "global"), egressProxyPort: 4443, configFence: [{ kind: "literal", path: join(project, "protected") }], homebrewFence: [], credentialStores: [] })
  const eligibility = { homeDir: home, appStateRoot: state, configFenceRoots: () => [], realpath: realpathSync.native, isDirectory: (path: string) => statSync(path).isDirectory() }
  creditDanglingSweepForSpawn()
  const result = await spawnLocalServer("127.0.0.1", 4096, "password", { userDataPath, healthCheck: async () => true, planFence: () => ({ ...fakePlanFence(), profile, eligibility }), fork: fakeFork })
  try {
    await result.health.wait
    const targets = [join(project, "file"), join(outside, "file"), `${project}/link/../b.txt`, join(outside, "new", "file"), join(home, "file"), join(state, "file"), join(project, "protected")]
    const reply = await result.listener.readWriteScope({ access: "write", targets: targets.map((absolute) => ({ absolute, directory: absolute.slice(0, absolute.lastIndexOf("/")) })) })
    expect(reply).toMatchObject({ targets: [
      { absolute: targets[0], outcome: "writable", realDirectory: project },
      { absolute: targets[1], outcome: "needs-approval", realDirectory: outside },
      // `link/..` is the link target's parent on disk, not the project: the folder to approve is `outside`.
      { absolute: targets[2], outcome: "needs-approval", realDirectory: outside },
      { absolute: targets[3], outcome: "needs-approval", realDirectory: join(outside, "new") },
      { absolute: targets[4], outcome: "ineligible", realDirectory: home },
      { absolute: targets[5], outcome: "ineligible", realDirectory: state },
      { absolute: targets[6], outcome: "protected", realDirectory: project },
    ] })
  } finally {
    await result.listener.stop()
    rmSync(root, { recursive: true, force: true })
  }
})
