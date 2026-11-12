// `#1667`(#1662 L5):在测试进程里真起 OpenCode 2 引擎之前,把它能碰到的每一个家目录都改指一个临时目录 —— 绝不碰 owner 的
// `~/.local/share/opencode`、`~/.config/opencode`(做法同 `scripts/engine-smoke.sh` 的隔离)。
//
// 为什么必须在 import 引擎**之前**、而且一个进程只做一次:上游在模块装载时就按 `XDG_*` / `HOME` 算全局根目录
// (`@opencode/util/global-roots`、`@opencode/util/global` 的 `Path`),之后改环境变量不再生效。bun 把同一次 `bun test`
// 里的所有文件跑在一个进程里,所以沙箱挂在 globalThis 上复用。
//
// 防护:`assertEngineSandboxed()` 用引擎自己算出的 `Global.Path` 证明它确实落在沙箱里;不在就抛,测试一条都不跑。
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export type EngineSandbox = {
  root: string
  home: string
  data: string
  config: string
  cache: string
  state: string
  tmp: string
}

const KEY = Symbol.for("codepuppy.test.engine-sandbox")

export function engineSandbox(): EngineSandbox {
  const existing = (globalThis as Record<symbol, unknown>)[KEY] as EngineSandbox | undefined
  if (existing) return existing
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cp-engine-sandbox-")))
  const sandbox: EngineSandbox = {
    root,
    home: join(root, "home"),
    data: join(root, "data"),
    config: join(root, "config"),
    cache: join(root, "cache"),
    state: join(root, "state"),
    tmp: join(root, "tmp"),
  }
  for (const dir of [sandbox.home, sandbox.data, sandbox.config, sandbox.cache, sandbox.state, sandbox.tmp])
    mkdirSync(dir, { recursive: true })
  Object.assign(process.env, {
    HOME: sandbox.home,
    OPENCODE_TEST_HOME: sandbox.home,
    XDG_DATA_HOME: sandbox.data,
    XDG_CONFIG_HOME: sandbox.config,
    XDG_CACHE_HOME: sandbox.cache,
    XDG_STATE_HOME: sandbox.state,
    TMPDIR: sandbox.tmp,
  })
  // 继承来的 OPENCODE_* 一律清掉(OPENCODE_FLAGS、OPENCODE_CONFIG_DIR、OPENCODE_DB 都会被引擎读到)。
  for (const key of Object.keys(process.env)) if (key.startsWith("OPENCODE_") && key !== "OPENCODE_TEST_HOME") delete process.env[key]
  ;(globalThis as Record<symbol, unknown>)[KEY] = sandbox
  return sandbox
}

/** 用引擎自己的 `Global.Path` 证明隔离成立;不成立就抛(调用方在 beforeAll 里调,失败则整份文件不跑)。 */
export async function assertEngineSandboxed(sandbox: EngineSandbox) {
  const { Global } = await import("@opencode/util/global")
  for (const [name, value] of Object.entries({ data: Global.Path.data, config: Global.Path.config, state: Global.Path.state, cache: Global.Path.cache, home: Global.Path.home, tmp: Global.Path.tmp }))
    if (!value.startsWith(sandbox.root))
      throw new Error(`REFUSING TO RUN: engine Global.Path.${name}=${value} is outside the sandbox ${sandbox.root}`)
}

const counter = { value: 0 }

/** 每台引擎各用一个库文件与一个全局配置目录。 */
export function engineSlot(sandbox: EngineSandbox, name: string) {
  const id = `${name}-${++counter.value}`
  const configDirectory = join(sandbox.root, "engine-config", id)
  const projectDirectory = join(sandbox.root, "projects", id)
  mkdirSync(configDirectory, { recursive: true })
  mkdirSync(projectDirectory, { recursive: true })
  mkdirSync(join(sandbox.root, "db"), { recursive: true })
  return { databasePath: join(sandbox.root, "db", `${id}.db`), configDirectory, projectDirectory }
}
