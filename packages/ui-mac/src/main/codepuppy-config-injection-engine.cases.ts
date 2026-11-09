// `#1667`(#1662 L5,基线 §2.7 / §3 S6,裁决书 N3、R17、OOR-1,编排器 U1):注入产物交给真引擎之后,Code Puppy 握着的决定
// 是否仍由 Code Puppy 决定 —— 每一条都带反向臂:去掉我们的注入或设置,OpenCode 的默认接管,断言随之变红。
//
//   ① 外部技能不继承(S6):临时 HOME 的 `~/.claude/skills/probe`、`~/.agents/skills/probe-global`,临时项目的
//      `.agents/skills/probe-project`,三条都不在 `GET /api/skill` 里;反向臂(N3):CODEPUPPY_ECOSYSTEM_INHERIT=1
//      不写移除指令 ⇒ 它们都出现。
//   ② 模型与提供方清单(C7):真引擎的 `GET /api/provider` 里有注入的平台节点与 BYOK 节点;反向臂:去掉注入的
//      `provider.use` 语句 ⇒ OpenCode 自己目录里的 provider 也出现。
//   ③ 五个实验开关(§2.7 判据三臂;U1 起 todo 开、其余四个关),用引擎自己的 `Flag.resolve` 判:发布渠道 ⇒ 默认全关
//      (local ⇒ 全开);项目 opencode.json 写 `experimental.all_flags: true` ⇒ 仍是我们的值(去掉注入的显式值 ⇒ 全开);
//      启动 shell 里带 `OPENCODE_FLAGS=all` ⇒ 仍是我们的值(把它留在继承给引擎的环境里 ⇒ 全开)。
// 引擎跑在临时 HOME/XDG 沙箱里(test-component/engine-sandbox.ts),绝不碰 owner 的数据目录。
//
// 本文件由同名 `.test.ts` 宿主起一个独立的 `bun test` 子进程来跑(仓内 `*.cases.ts` 惯例):沙箱要把 HOME / XDG_* / TMPDIR
// 改指临时目录,而上游在模块装载时就按它们算全局根目录 —— 放在独立进程里,既不会被同进程里先装载的上游模块抢先,
// 也不会把改过的环境留给整包测试里排在后面的文件。
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as path from "node:path"
import { assertEngineSandboxed, engineSandbox, engineSlot } from "../../test-component/engine-sandbox"
import { buildEngineServerOptions, ENGINE_RELEASE_CHANNEL } from "./engine-server-options"
import { withEngineAuthorization } from "./engine-authorization"
import { injectCodePuppyConfig } from "./codepuppy-config-injection"
import { secretFilePath } from "./codepuppy-secret-files"
import { createSidecarEnv } from "./sidecar-env"
import type { EngineFetch } from "./in-process-engine"

const sandbox = engineSandbox()
const PASSWORD = "cp-l5-injection-engine"
const engines: Array<{ close: () => Promise<void> }> = []
const MANAGED = [
  "CODEPUPPY_GLOBAL_DIR",
  "CODEPUPPY_ECOSYSTEM_INHERIT",
  "CODEPUPPY_BASE_URL",
  "CODEPUPPY_DEFAULT_MODEL",
  "CODEPUPPY_CLOUD_MCP_URL",
  "CODEPUPPY_MODELS_DISABLE",
  "CODEPUPPY_WEBSEARCH_DISABLE",
] as const
const saved: Record<string, string | undefined> = {}
let userData = ""

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})

afterAll(async () => {
  for (const engine of engines.reverse()) await engine.close().catch(() => undefined)
  for (const k of MANAGED) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

let run = 0
beforeEach(() => {
  for (const k of MANAGED) {
    if (!(k in saved)) saved[k] = process.env[k]
    delete process.env[k]
  }
  run++
  userData = path.join(sandbox.root, `injection-userdata-${run}`)
  process.env.CODEPUPPY_GLOBAL_DIR = path.join(sandbox.root, `injection-state-${run}`, "codepuppy-state", "env", "dev")
  fs.mkdirSync(process.env.CODEPUPPY_GLOBAL_DIR, { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
})

async function engineWith(name: string, content: string, modelsFile?: string) {
  const { startEngine } = await import("../../engine/engine-embed")
  const slot = engineSlot(sandbox, name)
  let fetch: EngineFetch | undefined
  const engine = await startEngine(
    buildEngineServerOptions({
      hostname: "127.0.0.1",
      port: 0,
      password: PASSWORD,
      engineVersion: "test",
      databasePath: slot.databasePath,
      configDirectory: slot.configDirectory,
      config: { content },
      models: { ...(modelsFile ? { file: modelsFile } : {}), fetch: false },
      filewatcher: false,
      platform: process.platform,
    }),
    { onDispatch: (dispatch) => (fetch = withEngineAuthorization(dispatch, PASSWORD)) },
  )
  engines.push(engine)
  const get = async (route: string) => {
    const response = await fetch!(
      new Request(`http://codepuppy-sidecar.invalid${route}`, { headers: { "x-opencode-directory": encodeURIComponent(slot.projectDirectory) } }),
    )
    expect(response.status).toBe(200)
    return (await response.json()) as { data: Array<{ id: string; name?: string }> }
  }
  return { get, slot }
}

const skillFile = (dir: string, name: string) => {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} probe\n---\n\n${name}\n`)
}

/** 插件装完之前 `/api/skill` 也可能是半套:轮询到清单稳定(两次相同)再判。 */
async function settledIds(
  get: (route: string) => Promise<{ data: Array<{ id: string; name?: string }> }>,
  route: string,
  key: "id" | "name" = "id",
) {
  let previous = ""
  for (let i = 0; i < 40; i++) {
    const body = await get(route)
    const ids = JSON.stringify(body.data.map((item) => String(item[key])).sort())
    if (ids === previous && body.data.length > 0) return JSON.parse(ids) as string[]
    previous = ids
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return JSON.parse(previous || "[]") as string[]
}

describe("S6 外部技能不继承:唯一机制是注入的移除指令(裁决书 N3)", () => {
  const probes = ["cp-l5-claude-probe", "cp-l5-agents-global-probe", "cp-l5-agents-project-probe"]
  const plant = (projectDirectory: string) => {
    skillFile(path.join(sandbox.home, ".claude", "skills", probes[0]!), probes[0]!)
    skillFile(path.join(sandbox.home, ".agents", "skills", probes[1]!), probes[1]!)
    skillFile(path.join(projectDirectory, ".agents", "skills", probes[2]!), probes[2]!)
  }

  test("注入了移除指令 ⇒ 三类技能根都不进 GET /api/skill", async () => {
    const injection = injectCodePuppyConfig(userData, undefined, "stable")
    const engine = await engineWith("s6-deny", injection.config.content)
    plant(engine.slot.projectDirectory)
    const ids = await settledIds(engine.get, "/api/skill", "name")
    for (const probe of probes) expect(ids).not.toContain(probe)
  }, 60_000)

  test("反向臂:CODEPUPPY_ECOSYSTEM_INHERIT=1(不写移除指令)⇒ .claude 与 .agents 的技能都出现", async () => {
    process.env.CODEPUPPY_ECOSYSTEM_INHERIT = "1"
    const injection = injectCodePuppyConfig(userData, undefined, "stable")
    const engine = await engineWith("s6-inherit", injection.config.content)
    plant(engine.slot.projectDirectory)
    const ids = await settledIds(engine.get, "/api/skill", "name")
    for (const probe of probes) expect(ids).toContain(probe)
  }, 60_000)
})

describe("C7 模型与提供方清单由 Code Puppy 投影", () => {
  const givenLoggedInWithByok = () => {
    for (const [name, value] of [
      ["CODEPUPPY_API_KEY", "sk-platform-engine-gate"],
      ["DEEPSEEK_API_KEY", "sk-deepseek-engine-gate"],
    ] as const) {
      const file = secretFilePath(userData, name)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, value, { mode: 0o600 })
    }
    process.env.CODEPUPPY_BASE_URL = "https://gateway.example.invalid/v1"
  }

  test("真引擎的 GET /api/provider 里有注入的平台节点与 BYOK 节点,而且只有它们(provider.use 先拒全部再逐个放行)", async () => {
    givenLoggedInWithByok()
    const injection = injectCodePuppyConfig(userData, undefined, "stable")
    expect(injection.ok).toBe(true)
    const engine = await engineWith("c7-governed", injection.config.content, injection.models.file)
    const ids = await settledIds(engine.get, "/api/provider")
    expect(ids).toEqual(expect.arrayContaining(["codepuppy", "deepseek-byok"]))
    expect(ids).not.toContain("openai")
  }, 60_000)

  test("反向臂:去掉注入的 provider.use 语句 ⇒ OpenCode 自己目录里的 provider 也出现", async () => {
    givenLoggedInWithByok()
    const injection = injectCodePuppyConfig(userData, undefined, "stable")
    const { policies: _policies, ...rest } = JSON.parse(injection.config.content) as Record<string, unknown>
    const engine = await engineWith("c7-ungoverned", JSON.stringify(rest), injection.models.file)
    const ids = await settledIds(engine.get, "/api/provider")
    expect(ids.some((id) => !["codepuppy", "deepseek-byok", "codepuppy-internal-catalog-ready"].includes(id))).toBe(true)
  }, 60_000)
})

describe("五个实验开关(基线 §2.7 判据三臂;U1:todo 开、其余四个关)", () => {
  const OURS = { todo: true, schedules: false, media_blob: false, artifacts: false, background_compaction: false }
  const ALL_ON = { todo: true, schedules: true, media_blob: true, artifacts: true, background_compaction: true }
  const ALL_OFF = { todo: false, schedules: false, media_blob: false, artifacts: false, background_compaction: false }

  async function resolveFlags(input: { channel: string; project?: Record<string, unknown>; content?: Record<string, unknown>; overrides?: string }) {
    const { Flag } = await import("@opencode/core/flag")
    const { Config } = await import("@opencode/schema/config")
    const { Schema } = await import("effect")
    // 层序与引擎一致:项目文档在下、注入(OPENCODE_CONFIG_CONTENT 那一层)在上(`packages/core/src/config.ts` 的 load 返回序)。
    const doc = (info: Record<string, unknown>) => new Config.Document({ type: "document", info: Schema.decodeUnknownSync(Config.Info)(info) })
    const entries = [...(input.project ? [doc(input.project)] : []), ...(input.content ? [doc(input.content)] : [])]
    const flags = Flag.resolve({ entries, channel: input.channel, overrides: input.overrides })
    return Object.fromEntries(Object.entries(flags).map(([key, state]) => [key, state.enabled]))
  }

  const injected = () => JSON.parse(injectCodePuppyConfig(userData, undefined, "stable").config.content) as Record<string, unknown>
  const options = () =>
    buildEngineServerOptions({
      hostname: "127.0.0.1",
      port: 0,
      password: "x",
      engineVersion: "test",
      databasePath: ":memory:",
      configDirectory: "/x",
      config: { content: "{}" },
      models: { fetch: false },
      filewatcher: false,
      platform: process.platform,
    })

  test("渠道臂:传给 start() 的是发布渠道 ⇒ 没有任何配置时五个开关默认关;反向臂:local ⇒ 全开", async () => {
    expect(options().app.channel).toBe(ENGINE_RELEASE_CHANNEL)
    expect(await resolveFlags({ channel: options().app.channel })).toEqual(ALL_OFF)
    expect(await resolveFlags({ channel: "local" })).toEqual(ALL_ON)
  })

  test("配置臂:项目 opencode.json 写 experimental.all_flags: true ⇒ 仍是注入的显式值;反向臂:去掉注入的显式值 ⇒ 全开", async () => {
    const project = { experimental: { all_flags: true } }
    expect(await resolveFlags({ channel: ENGINE_RELEASE_CHANNEL, project, content: injected() })).toEqual(OURS)
    const { experimental: _experimental, ...withoutFlags } = injected()
    expect(await resolveFlags({ channel: ENGINE_RELEASE_CHANNEL, project, content: withoutFlags })).toEqual(ALL_ON)
  })

  test("环境臂:启动 shell 里带 OPENCODE_FLAGS=all ⇒ sidecar 环境里没有它,仍是注入的值;反向臂:留在继承里 ⇒ 全开", async () => {
    const forked = createSidecarEnv({ PATH: "/usr/bin", OPENCODE_FLAGS: "all", OPENCODE_DB: "kept" })
    expect(forked.OPENCODE_DB).toBe("kept") // 前缀规则本身照旧
    expect(forked.OPENCODE_FLAGS).toBeUndefined()
    expect(await resolveFlags({ channel: ENGINE_RELEASE_CHANNEL, content: injected(), overrides: forked.OPENCODE_FLAGS })).toEqual(OURS)
    expect(await resolveFlags({ channel: ENGINE_RELEASE_CHANNEL, content: injected(), overrides: "all" })).toEqual(ALL_ON)
  })
})
