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
//   ④ 出厂技能目录(接缝裁决 A):内联文档的 `skills` 列出的目录,启动后新写进去的技能不重启就出现(文件监听开着);
//      反向臂:注入里没有这个目录 ⇒ 不出现。
//   ⑤ 出厂 /init、/review(接缝裁决 C):真引擎跑命令,用户回合正文是 ext 登记的模板(参数由引擎代入),/review 在子会话里跑;
//      反向臂:CODEPUPPY_PROMPT_REBRAND_DISABLE=1 不写 commands ⇒ 引擎自带的那两条。另量一条层序:同名时内联文档压过用户全局配置。
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
import { explicitSkillDirs, injectCodePuppyConfig } from "./codepuppy-config-injection"
import { watchExplicitSources } from "./engine-explicit-config"
import { customProviderSecretName, secretFilePath } from "./codepuppy-secret-files"
import { PLATFORM_API_KEY_PLACEHOLDER } from "./codepuppy-models"
import { createSidecarEnv } from "./sidecar-env"
import type { EngineFetch } from "./in-process-engine"
import { CODEPUPPY_INIT_TEMPLATE, CODEPUPPY_REVIEW_TEMPLATE } from "../../../ext/src/codepuppy-prompts"

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
  "CODEPUPPY_FACTORY_SKILL_DIRS",
  "CODEPUPPY_PROMPT_REBRAND_DISABLE",
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

/** `config` 就是 `start()` 的 `config`:内联文档,外加(`#1667` 裁决 r1 / C7 重裁起)main 合成的显式文件。 */
async function engineWith(
  name: string,
  config: { content: string; file?: string },
  modelsFile?: string,
  opts: { filewatcher?: boolean; globalConfig?: Record<string, unknown>; projectConfig?: Record<string, unknown> } = {},
) {
  const { startEngine } = await import("../../engine/engine-embed")
  const slot = engineSlot(sandbox, name)
  if (opts.globalConfig) fs.writeFileSync(path.join(slot.configDirectory, "opencode.json"), JSON.stringify(opts.globalConfig))
  if (opts.projectConfig) fs.writeFileSync(path.join(slot.projectDirectory, "opencode.json"), JSON.stringify(opts.projectConfig))
  let fetch: EngineFetch | undefined
  const engine = await startEngine(
    buildEngineServerOptions({
      hostname: "127.0.0.1",
      port: 0,
      password: PASSWORD,
      engineVersion: "test",
      databasePath: slot.databasePath,
      configDirectory: slot.configDirectory,
      config,
      models: { ...(modelsFile ? { file: modelsFile } : {}), fetch: false },
      filewatcher: opts.filewatcher ?? false,
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
  const send = async (method: string, route: string, body?: unknown) =>
    fetch!(
      new Request(`http://codepuppy-sidecar.invalid${route}`, {
        method,
        headers: { "x-opencode-directory": encodeURIComponent(slot.projectDirectory), "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
  return { get, send, slot }
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
    const engine = await engineWith("s6-deny", injection.config)
    plant(engine.slot.projectDirectory)
    const ids = await settledIds(engine.get, "/api/skill", "name")
    for (const probe of probes) expect(ids).not.toContain(probe)
  }, 60_000)

  test("反向臂:CODEPUPPY_ECOSYSTEM_INHERIT=1(不写移除指令)⇒ .claude 与 .agents 的技能都出现", async () => {
    process.env.CODEPUPPY_ECOSYSTEM_INHERIT = "1"
    const injection = injectCodePuppyConfig(userData, undefined, "stable")
    const engine = await engineWith("s6-inherit", injection.config)
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
    const engine = await engineWith("c7-governed", injection.config, injection.models.file)
    const ids = await settledIds(engine.get, "/api/provider")
    expect(ids).toEqual(expect.arrayContaining(["codepuppy", "deepseek-byok"]))
    expect(ids).not.toContain("openai")
  }, 60_000)

  test("反向臂:去掉注入的 provider.use 语句 ⇒ OpenCode 自己目录里的 provider 也出现", async () => {
    givenLoggedInWithByok()
    const injection = injectCodePuppyConfig(userData, undefined, "stable")
    const { policies: _policies, ...rest } = JSON.parse(injection.config.content) as Record<string, unknown>
    const engine = await engineWith("c7-ungoverned", { content: JSON.stringify(rest) }, injection.models.file)
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

describe("接缝裁决 A / 裁决 r3 第 1 条:技能目录经显式文件的 skills 进引擎,启动后的变化不用重启就生效", () => {
  const appears = async (get: (route: string) => Promise<{ data: Array<{ id: string; name?: string }> }>, name: string, ms: number) => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      if ((await get("/api/skill")).data.some((skill) => skill.name === name)) return true
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    return false
  }
  const gone = async (get: (route: string) => Promise<{ data: Array<{ id: string; name?: string }> }>, name: string, ms: number) => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      if (!(await get("/api/skill")).data.some((skill) => skill.name === name)) return true
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    return false
  }
  /** 按 main 的 ext-transaction 姿势种一代技能、翻 current.json、写已启用名单。 */
  const generation = (key: string, genId: string, name: string) => {
    const root = process.env.CODEPUPPY_GLOBAL_DIR!
    const dir = path.join(root, "ext-store", key, "generations", genId)
    skillFile(path.join(dir, name), name)
    fs.writeFileSync(path.join(root, "ext-store", key, "current.json"), JSON.stringify({ generation: genId }))
    return dir
  }
  const enable = (...keys: string[]) => fs.writeFileSync(path.join(process.env.CODEPUPPY_GLOBAL_DIR!, "skills-enabled.json"), JSON.stringify({ v: 1, keys }))

  test("出厂目录:启动时就在的技能出现;文件监听开着时,启动之后写进同一目录的技能几秒内出现(不重启)", async () => {
    const factory = path.join(sandbox.root, "factory-skills-watch")
    skillFile(path.join(factory, "cp-l5-factory-at-boot"), "cp-l5-factory-at-boot")
    process.env.CODEPUPPY_FACTORY_SKILL_DIRS = JSON.stringify([factory])
    const injection = injectCodePuppyConfig(userData, undefined, "stable")
    expect(injection.explicit!.layer.skills[0]).toBe(factory)
    const engine = await engineWith("skills-watch", injection.config, undefined, { filewatcher: true })
    expect(await appears(engine.get, "cp-l5-factory-at-boot", 15_000)).toBe(true)
    skillFile(path.join(factory, "cp-l5-factory-after-boot"), "cp-l5-factory-after-boot")
    expect(await appears(engine.get, "cp-l5-factory-after-boot", 15_000)).toBe(true)
  }, 60_000)

  test("反向臂:没有出厂目录 ⇒ 同一目录里的技能不出现", async () => {
    const factory = path.join(sandbox.root, "factory-skills-absent")
    skillFile(path.join(factory, "cp-l5-factory-absent"), "cp-l5-factory-absent")
    const injection = injectCodePuppyConfig(userData, undefined, "stable")
    expect(injection.explicit!.layer.skills).not.toContain(factory)
    const engine = await engineWith("skills-absent", injection.config, undefined, { filewatcher: true })
    await settledIds(engine.get, "/api/skill", "name")
    expect(await appears(engine.get, "cp-l5-factory-absent", 2_000)).toBe(false)
  }, 60_000)

  // `#1667` 裁决 r3 第 1 条:不用软链。翻代 / 新装 / 停用改动的是 `current.json` 与 `skills-enabled.json`,sidecar 的监听
  // (watchExplicitSources,这里与生产 sidecar 同样起它)据此重算 explicitSkillDirs、重写显式文件的 `skills`,技能插件随配置
  // 更新重新取源。
  const watching = (injection: ReturnType<typeof injectCodePuppyConfig>) =>
    watchExplicitSources({ ...injection.explicit!, skills: explicitSkillDirs, log: (line) => console.warn(line) })

  test("已安装技能翻代:显式文件的 skills 跟着重写成新一代的真实目录 ⇒ 新一代的技能不重启就出现、旧一代的消失;新装与停用同样不重启", async () => {
    generation("skill--cp-l5-a", "gen-000001-aaaaaa", "cp-l5-a-one")
    enable("skill--cp-l5-a")
    const injection = injectCodePuppyConfig(userData, undefined, "stable")
    const stop = watching(injection)
    try {
      const engine = await engineWith("skills-flip", injection.config, undefined, { filewatcher: true })
      expect(await appears(engine.get, "cp-l5-a-one", 15_000)).toBe(true)

      const g2 = generation("skill--cp-l5-a", "gen-000002-bbbbbb", "cp-l5-a-two")
      expect(await appears(engine.get, "cp-l5-a-two", 10_000)).toBe(true)
      expect(await gone(engine.get, "cp-l5-a-one", 5_000)).toBe(true)
      expect((JSON.parse(fs.readFileSync(injection.config.file!, "utf8")) as { skills: string[] }).skills).toEqual([g2])

      generation("skill--cp-l5-b", "gen-000001-cccccc", "cp-l5-b-one")
      enable("skill--cp-l5-a", "skill--cp-l5-b")
      expect(await appears(engine.get, "cp-l5-b-one", 10_000)).toBe(true)
      enable("skill--cp-l5-a")
      expect(await gone(engine.get, "cp-l5-b-one", 10_000)).toBe(true)
    } finally {
      stop()
    }
  }, 90_000)

  test("反向臂:没有监听重写显式文件 ⇒ 翻代之后新一代的技能不出现、旧的还在(要重启才变)", async () => {
    generation("skill--cp-l5-c", "gen-000001-dddddd", "cp-l5-c-one")
    enable("skill--cp-l5-c")
    const injection = injectCodePuppyConfig(userData, undefined, "stable")
    const engine = await engineWith("skills-noflip", injection.config, undefined, { filewatcher: true })
    expect(await appears(engine.get, "cp-l5-c-one", 15_000)).toBe(true)
    generation("skill--cp-l5-c", "gen-000002-eeeeee", "cp-l5-c-two")
    expect(await appears(engine.get, "cp-l5-c-two", 4_000)).toBe(false)
    expect((await engine.get("/api/skill")).data.some((skill) => skill.name === "cp-l5-c-one")).toBe(true)
  }, 60_000)
})

describe("接缝裁决 C / 裁决 r1 第 2 条:出厂 /init、/review 由显式文件的 commands 提供(core 自己的 opencode.config.command 执行)", () => {
  type Engine = Awaited<ReturnType<typeof engineWith>>
  type Message = { type: string; text?: string }
  type SessionInfo = { id: string; parentID?: string }
  const SUBAGENT_PREFIX = "You are a subagent spawned by another session.\n"
  // 带一个参数跑:模板里的 `$ARGUMENTS` 由 core 自己的模板文法替换(`evaluateTemplate`),期望值就是「登记的模板 + 这一个参数」。
  const ARG = "cp-l5-arg"
  const rendered = (template: string) => template.replaceAll("$ARGUMENTS", ARG).trim()

  async function createSession(engine: Engine) {
    const created = await engine.send("POST", "/api/session", { location: { directory: engine.slot.projectDirectory } })
    expect(created.status).toBe(200)
    return ((await created.json()) as { data: SessionInfo }).data
  }
  /** 跑一条斜杠命令。沙箱里没有任何可用模型,模型回合必然失败;判据是命令写下的用户回合正文(与子会话),不看回复。 */
  async function runCommand(engine: Engine, name: string) {
    const session = await createSession(engine)
    const ran = await engine.send("POST", `/api/session/${session.id}/command`, { name, text: ARG })
    expect([name, ran.status]).toEqual([name, 204])
    return session
  }
  async function userTexts(engine: Engine, sessionID: string) {
    for (let i = 0; i < 40; i++) {
      const response = await engine.send("GET", `/api/session/${sessionID}/message`)
      const users = ((await response.json()) as { data: Message[] }).data.filter((message) => message.type === "user").map((message) => message.text ?? "")
      if (users.length) return users
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return []
  }
  async function children(engine: Engine, parentID: string) {
    for (let i = 0; i < 20; i++) {
      const response = await engine.send("GET", "/api/session")
      const found = ((await response.json()) as { data: SessionInfo[] }).data.filter((session) => session.parentID === parentID)
      if (found.length) return found
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return []
  }

  test("/init:用户回合正文逐字是 ext 登记的 CODEPUPPY_INIT_TEMPLATE(参数由引擎代入);反向臂:CODEPUPPY_PROMPT_REBRAND_DISABLE=1(不写 commands)⇒ 引擎自带的 /init 模板", async () => {
    const engine = await engineWith("commands-init", injectCodePuppyConfig(userData, undefined, "stable").config)
    expect(await userTexts(engine, (await runCommand(engine, "init")).id)).toEqual([rendered(CODEPUPPY_INIT_TEMPLATE)])

    process.env.CODEPUPPY_PROMPT_REBRAND_DISABLE = "1"
    const bare = await engineWith("commands-init-bare", injectCodePuppyConfig(userData, undefined, "stable").config)
    const texts = await userTexts(bare, (await runCommand(bare, "init")).id)
    expect(texts).toHaveLength(1)
    expect(texts[0]).not.toBe(rendered(CODEPUPPY_INIT_TEMPLATE))
    expect(texts[0]).not.toContain("Create or update `AGENTS.md` at the repository root.")
  }, 60_000)

  test("/review 在子会话里跑(subagent: true):父会话下出现一个子会话,子会话的用户回合带 CODEPUPPY_REVIEW_TEMPLATE,父会话没有;反向臂:不写 commands ⇒ 引擎自带的 review 在原会话里跑,没有子会话", async () => {
    const engine = await engineWith("commands-review", injectCodePuppyConfig(userData, undefined, "stable").config)
    const parent = await runCommand(engine, "review")
    const [child, ...extra] = await children(engine, parent.id)
    expect(extra).toEqual([])
    expect(await userTexts(engine, child!.id)).toEqual([`${SUBAGENT_PREFIX}${rendered(CODEPUPPY_REVIEW_TEMPLATE)}`])
    expect(await userTexts(engine, parent.id)).toEqual([])

    process.env.CODEPUPPY_PROMPT_REBRAND_DISABLE = "1"
    const bare = await engineWith("commands-review-bare", injectCodePuppyConfig(userData, undefined, "stable").config)
    const session = await runCommand(bare, "review")
    expect(await userTexts(bare, session.id)).toHaveLength(1)
    expect(await children(bare, session.id)).toEqual([])
  }, 60_000)

  // 层序(编排器实测 `packages/core/src/config.ts:363-373`):全局 < 显式文件 < 项目 < 内联文档,设置项后加载的胜出。出厂命令放在
  // 显式文件 ⇒ 项目里写的同名命令胜过出厂的、出厂的胜过上游内置的(v1 的「用户治理 > 出厂 > 上游内置」)。用户**全局**配置排在
  // 显式文件之前,所以全局里写的同名命令仍被出厂的盖掉(裁决原文:显式文件排在全局之上、项目之下)。
  test("项目 opencode.json 里的同名 /init 胜过出厂的;反向臂:项目里不写 ⇒ 出厂的", async () => {
    const projectConfig = { commands: { init: { template: "PROJECT-INIT-TEMPLATE", description: "project init" } } }
    const engine = await engineWith("commands-project", injectCodePuppyConfig(userData, undefined, "stable").config, undefined, { projectConfig })
    expect(await userTexts(engine, (await runCommand(engine, "init")).id)).toEqual([`PROJECT-INIT-TEMPLATE\n\n${ARG}`])

    const plain = await engineWith("commands-project-plain", injectCodePuppyConfig(userData, undefined, "stable").config)
    expect(await userTexts(plain, (await runCommand(plain, "init")).id)).toEqual([rendered(CODEPUPPY_INIT_TEMPLATE)])
  }, 60_000)

  test("不传显式文件 ⇒ 上游内置的 /init(出厂命令只在显式文件里,内联文档不再带)", async () => {
    const injection = injectCodePuppyConfig(userData, undefined, "stable")
    const bare = await engineWith("commands-no-explicit", { content: injection.config.content })
    const texts = await userTexts(bare, (await runCommand(bare, "init")).id)
    expect(texts).toHaveLength(1)
    expect(texts[0]).not.toContain("Create or update `AGENTS.md` at the repository root.")
  }, 60_000)

  test("实测:用户全局配置里同名的 /init 仍被出厂的盖掉(全局排在显式文件之前);反向臂:不写出厂命令 ⇒ 用户全局的生效", async () => {
    const globalConfig = { commands: { init: { template: "USER-GLOBAL-INIT-TEMPLATE", description: "user's own init" } } }
    const engine = await engineWith("commands-precedence", injectCodePuppyConfig(userData, undefined, "stable").config, undefined, { globalConfig })
    expect(await userTexts(engine, (await runCommand(engine, "init")).id)).toEqual([rendered(CODEPUPPY_INIT_TEMPLATE)])

    process.env.CODEPUPPY_PROMPT_REBRAND_DISABLE = "1"
    const bare = await engineWith("commands-precedence-bare", injectCodePuppyConfig(userData, undefined, "stable").config, undefined, { globalConfig })
    expect(await userTexts(bare, (await runCommand(bare, "init")).id)).toEqual([`USER-GLOBAL-INIT-TEMPLATE\n\n${ARG}`])
  }, 60_000)

  test("运行中改 codepuppy.jsonc(装一条命令)⇒ sidecar 的监听重写显式文件 ⇒ 引擎不重启就看得见;反向臂:不监听 ⇒ 看不见", async () => {
    const truth = path.join(process.env.CODEPUPPY_GLOBAL_DIR!, "codepuppy.jsonc")
    const injection = injectCodePuppyConfig(userData, undefined, "stable")
    const listed = async (engine: Awaited<ReturnType<typeof engineWith>>, name: string, ms: number) => {
      const until = Date.now() + ms
      while (Date.now() < until) {
        if ((await engine.get("/api/command")).data.some((item) => item.name === name)) return true
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      return false
    }
    const stop = watchExplicitSources({ ...injection.explicit!, skills: explicitSkillDirs, log: () => {} })
    try {
      // 引擎对显式文件的监听随文件监听开关(生产默认开,engine-server-options.ts 的 desktop toggles)。
      const engine = await engineWith("commands-live", injection.config, undefined, { filewatcher: true })
      await settledIds(engine.get, "/api/command", "name")
      fs.writeFileSync(truth, JSON.stringify({ commands: { "cp-l5-installed": { template: "installed", description: "installed" } } }))
      expect(await listed(engine, "cp-l5-installed", 10_000)).toBe(true)
    } finally {
      stop()
    }
    const unwatched = injectCodePuppyConfig(userData, undefined, "stable")
    const engine = await engineWith("commands-unwatched", unwatched.config, undefined, { filewatcher: true })
    await settledIds(engine.get, "/api/command", "name")
    fs.writeFileSync(truth, JSON.stringify({ commands: { "cp-l5-unwatched": { template: "x", description: "x" } } }))
    expect(await listed(engine, "cp-l5-unwatched", 3_000)).toBe(false)
  }, 90_000)
})

describe("C7(重裁):provider 白名单的第一层在显式文件里,项目里写的 allow 盖不过", () => {
  const rogue = {
    providers: { "cp-l5-rogue": { package: "aisdk:@ai-sdk/openai-compatible", settings: { baseURL: "http://127.0.0.1:9/v1", apiKey: "x" }, models: { m: { name: "m" } } } },
    policies: [{ action: "provider.use", resource: "cp-l5-rogue", effect: "allow" }],
  }
  const givenLoggedIn = () => {
    const file = secretFilePath(userData, "CODEPUPPY_API_KEY")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, "sk-platform-engine-gate", { mode: 0o600 })
    process.env.CODEPUPPY_BASE_URL = "https://gateway.example.invalid/v1"
  }

  test("项目 opencode.json 声明一个白名单外的 provider 并在 policies 里 allow 它 ⇒ 仍不可用", async () => {
    givenLoggedIn()
    const injection = injectCodePuppyConfig(userData, undefined, "stable")
    const engine = await engineWith("c7-project-allow", injection.config, injection.models.file, { projectConfig: rogue })
    const ids = await settledIds(engine.get, "/api/provider")
    expect(ids).toContain("codepuppy")
    expect(ids).not.toContain("cp-l5-rogue")
  }, 60_000)

  test("反向臂:显式文件里没有 policies(只剩内联那一层)⇒ 项目的 allow 胜出,这个 provider 可用", async () => {
    givenLoggedIn()
    const injection = injectCodePuppyConfig(userData, undefined, "stable")
    const { policies: _policies, ...explicit } = JSON.parse(fs.readFileSync(injection.config.file!, "utf8")) as Record<string, unknown>
    const file = path.join(sandbox.root, "explicit-without-policies.json")
    fs.writeFileSync(file, JSON.stringify(explicit))
    const engine = await engineWith("c7-project-allow-bare", { content: injection.config.content, file }, injection.models.file, { projectConfig: rogue })
    const ids = await settledIds(engine.get, "/api/provider")
    expect(ids).toContain("cp-l5-rogue")
  }, 60_000)
})

// `#1667`(编排器裁决 r3 第 2 条):BYOK / 自定义节点的 key 缺失或为空时整个不注入。OpenCode 2 把空 key 当「不鉴权」
// (`packages/core/src/model-resolver.ts`:没有凭据、没有配置的鉴权 ⇒ `Auth.none`),照旧写 `apiKey: ""` 就会把请求不带凭据
// 发到用户的端点。判据:本机 OpenAI 兼容端点数请求、看有没有 Authorization 头。
describe("裁决 r3 第 2 条:key 缺失或为空的 BYOK / 自定义节点不可选、不可调", () => {
  const hits: Array<{ authorization: string | null }> = []
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    `data: ${JSON.stringify({ id: "chatcmpl-cp-l5", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  const endpoint = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      if (!request.url.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
      hits.push({ authorization: request.headers.get("authorization") })
      return new Response(chunk({ role: "assistant", content: "ok" }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
    },
  })
  afterAll(() => void endpoint.stop(true))
  const baseURL = () => `http://127.0.0.1:${endpoint.port}/v1`
  const record = () => {
    const truth = path.join(process.env.CODEPUPPY_GLOBAL_DIR!, "..", "..", "custom-providers", "dev.json")
    fs.mkdirSync(path.dirname(truth), { recursive: true })
    fs.writeFileSync(truth, JSON.stringify({ v: 1, providers: [{ id: "cp-l5-keyless", name: "Keyless", compat: "openai", baseURL: baseURL(), models: ["m"] }] }))
  }
  /** 用这个模型建会话、发一句、等这一轮跑完(成败都行),返回期间端点收到的请求。 */
  async function call(engine: Awaited<ReturnType<typeof engineWith>>, providerID: string) {
    const before = hits.length
    const created = await engine.send("POST", "/api/session", { location: { directory: engine.slot.projectDirectory }, model: { id: "m", providerID } })
    if (created.status !== 200) return { created: created.status, requests: hits.slice(before) }
    const session = ((await created.json()) as { data: { id: string } }).data
    await engine.send("POST", `/api/session/${session.id}/prompt`, { text: "hello" })
    await engine.send("POST", `/api/experimental/session/${session.id}/wait`)
    return { created: created.status, requests: hits.slice(before) }
  }

  test("自定义节点没有 key 文件 / key 文件是空的 ⇒ 不在 /api/provider 里,选它发一句,端点一个请求都收不到", async () => {
    record()
    for (const [label, plant] of [["missing", undefined], ["empty", " \n"]] as const) {
      if (plant !== undefined) {
        const file = secretFilePath(userData, customProviderSecretName("cp-l5-keyless"))
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, plant, { mode: 0o600 })
      }
      const injection = injectCodePuppyConfig(userData, undefined, "stable")
      const engine = await engineWith(`keyless-${label}`, injection.config, injection.models.file)
      const ids = await settledIds(engine.get, "/api/provider")
      expect([label, ids.includes("cp-l5-keyless")]).toEqual([label, false])
      expect([label, (await call(engine, "cp-l5-keyless")).requests]).toEqual([label, []])
    }
  }, 90_000)

  test("反向臂:照旧写 `apiKey: \"\"` 并放行 ⇒ 请求不带 Authorization 发到了端点", async () => {
    record()
    const injection = injectCodePuppyConfig(userData, undefined, "stable")
    const content = JSON.parse(injection.config.content) as { providers?: Record<string, unknown>; policies?: unknown[] }
    content.providers = { ...content.providers, "cp-l5-keyless": { package: "aisdk:@ai-sdk/openai-compatible", settings: { baseURL: baseURL(), apiKey: "" }, models: { m: { name: "m" } } } }
    content.policies = [...(content.policies ?? []), { action: "provider.use", resource: "cp-l5-keyless", effect: "allow" }]
    const explicit = JSON.parse(fs.readFileSync(injection.config.file!, "utf8")) as { policies?: unknown[] }
    explicit.policies = [...(explicit.policies ?? []), { action: "provider.use", resource: "cp-l5-keyless", effect: "allow" }]
    const file = path.join(sandbox.root, "explicit-keyless-allowed.json")
    fs.writeFileSync(file, JSON.stringify(explicit))
    const engine = await engineWith("keyless-legacy", { content: JSON.stringify(content), file }, injection.models.file)
    const { requests } = await call(engine, "cp-l5-keyless")
    expect(requests.length).toBeGreaterThan(0)
    expect(requests.every((request) => request.authorization === null)).toBe(true)
  }, 60_000)

  test("平台节点(占位 apiKey,真凭据由 ext 的请求头补)照常可用:在 /api/provider 里,请求带着 Authorization 到达端点", async () => {
    const key = secretFilePath(userData, "CODEPUPPY_API_KEY")
    fs.mkdirSync(path.dirname(key), { recursive: true })
    fs.writeFileSync(key, "sk-platform-engine-gate", { mode: 0o600 })
    process.env.CODEPUPPY_BASE_URL = baseURL()
    const injection = injectCodePuppyConfig(userData, undefined, "stable")
    // 沙箱里没有已应用的平台目录,平台节点的模型表是空的(`#1556`);补一个模型只为能发出一次请求,鉴权形状原样。
    const content = JSON.parse(injection.config.content) as { providers: Record<string, { models?: Record<string, unknown> }> }
    content.providers.codepuppy!.models = { m: { name: "m" } }
    const engine = await engineWith("platform-usable", { content: JSON.stringify(content), file: injection.config.file }, injection.models.file)
    expect(await settledIds(engine.get, "/api/provider")).toContain("codepuppy")
    const { requests } = await call(engine, "codepuppy")
    expect(requests.length).toBeGreaterThan(0)
    expect(requests[0]!.authorization).toBe(`Bearer ${PLATFORM_API_KEY_PLACEHOLDER}`)
  }, 60_000)
})
