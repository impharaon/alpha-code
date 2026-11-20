// `#1667`(#1662 L5;编排器裁决 1667 评论 6738814516 第 2 条、C7 重裁 6741122824):显式文件层的合成与运行中重写
// (engine-explicit-config.ts)。真引擎上的层序判据在 codepuppy-config-injection-engine.cases.ts。
import { afterEach, describe, expect, spyOn, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Schema } from "effect"
import { Config as ConfigSchema } from "@opencode/schema/config"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { ensureSkillsPath } from "./engine-config-truth"
import { composeExplicitDocument, engineModelsPath, explicitConfigPath, watchExplicitSources, writeEngineConfigFiles, writeExplicitConfig, type ExplicitLayer } from "./engine-explicit-config"

const LAYER: ExplicitLayer = {
  policies: [
    { action: "provider.use", resource: "*", effect: "deny" },
    { action: "provider.use", resource: "codepuppy", effect: "allow" },
  ],
  commands: { init: { template: "factory init", description: "guided" }, review: { template: "factory review", subagent: true } },
  skills: ["/factory/a", "/root/ext-store/skill--a/generations/gen-000001-aaaaaa"],
}

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})
const tempDir = () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cp-explicit-")))
  dirs.push(dir)
  return dir
}

describe("显式文件的合成", () => {
  test("没有用户文件:就是我们这一层,2.x 原生键,上游 normalize 零诊断、过 Config.Info 解码", () => {
    const { document, userError } = composeExplicitDocument(undefined, LAYER)
    expect(userError).toBeUndefined()
    expect(document).toEqual({ $schema: "https://opencode.ai/config.json", skills: LAYER.skills, commands: LAYER.commands, policies: LAYER.policies })
    const normalized = ConfigNormalize.normalize(document)
    expect(normalized.type).toBe("normalized")
    if (normalized.type === "normalized") expect(normalized.diagnostics).toEqual([])
    expect(() => Schema.decodeUnknownSync(ConfigSchema.Info)(document)).not.toThrow()
  })

  test("用户的 codepuppy.jsonc 原样在下:同名命令(v1 command 或 2.x commands)不被出厂的覆盖、skills 取并集、我们的 policies 排在用户的之后", () => {
    const user = `{
      // 用户经 Code Puppy 装的东西
      "command": { "init": { "template": "my own init" } },
      "commands": { "deploy": { "template": "ship it" } },
      "skills": ["/user/skills"],
      "policies": [{ "action": "provider.use", "resource": "rogue", "effect": "allow" }],
      "mcp": { "local-tool": { "type": "local", "command": ["tool"] } },
    }`
    const { document, userError } = composeExplicitDocument(user, LAYER)
    expect(userError).toBeUndefined()
    expect(document.command).toEqual({ init: { template: "my own init" } })
    expect(document.commands).toEqual({ review: LAYER.commands.review, deploy: { template: "ship it" } })
    expect(document.skills).toEqual(["/user/skills", ...LAYER.skills])
    expect(document.policies).toEqual([{ action: "provider.use", resource: "rogue", effect: "allow" }, ...LAYER.policies])
    expect(document.mcp).toEqual({ "local-tool": { type: "local", command: ["tool"] } })
  })

  // 审计 R1 第 3 条:生产 boot 的 ensureSkillsPath 写进 codepuppy.jsonc 的是 v1 形状 `{ skills: { paths: [...] } }`。
  // 以前这里只认数组,有出厂技能时用出厂数组整个盖掉,用户技能目录从引擎眼里消失(上游 normalize 也不出诊断)。
  test("用户文件是生产 ensureSkillsPath 写的 v1 形状 skills:用户目录(含 urls)与出厂的取并集,上游 normalize 零诊断", () => {
    const user: Record<string, unknown> = { skills: { urls: ["https://skills.example/pack"] } }
    expect(ensureSkillsPath(user, "/root/env/dev/skills")).toBe(true)
    expect(user.skills).toEqual({ urls: ["https://skills.example/pack"], paths: ["/root/env/dev/skills"] })
    const { document, userError } = composeExplicitDocument(JSON.stringify(user), LAYER)
    expect(userError).toBeUndefined()
    expect(document.skills).toEqual(["/root/env/dev/skills", "https://skills.example/pack", ...LAYER.skills])
    const normalized = ConfigNormalize.normalize(document)
    if (normalized.type !== "normalized") throw new Error("upstream rejected the explicit document")
    expect(normalized.diagnostics).toEqual([])
    expect(normalized.encoded.skills).toEqual(["/root/env/dev/skills", "https://skills.example/pack", ...LAYER.skills])
  })

  test("用户文件解析不了 ⇒ 只放我们这一层并给出原因(不把半份坏文件交给引擎)", () => {
    const { document, userError } = composeExplicitDocument("{ not json", LAYER)
    expect(userError).toContain("JSONC parse error")
    expect(document).toEqual({ $schema: "https://opencode.ai/config.json", skills: LAYER.skills, commands: LAYER.commands, policies: LAYER.policies })
  })

  test("没有 provider policies(模型治理关着)⇒ 不写 policies;用户自己的 deny 保留", () => {
    expect(composeExplicitDocument(undefined, { ...LAYER, policies: [] }).document.policies).toBeUndefined()
    const policies = [{ action: "plugin.use", resource: "/user/plugin", effect: "deny" }]
    expect(composeExplicitDocument(JSON.stringify({ policies }), { ...LAYER, policies: [] }).document.policies).toEqual(policies)
  })
})

describe("运行中:输入一变就重写显式文件", () => {
  const waitFor = async (pred: () => boolean, ms = 3_000) => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      if (pred()) return true
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return false
  }
  // 递归监听(FSEvents)起来要一点时间;生产里监听在 sidecar 启动时就开了,远早于任何改动。
  const settle = () => new Promise((resolve) => setTimeout(resolve, 250))
  const atomic = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(`${file}.tmp`, text)
    fs.renameSync(`${file}.tmp`, file)
  }

  test("codepuppy.jsonc 原子改写 ⇒ 显式文件跟着变;改坏 ⇒ 保留上一份好的;停止之后不再跟", async () => {
    const root = tempDir()
    const userConfig = path.join(root, "codepuppy.jsonc")
    const file = path.join(root, "..", `${path.basename(root)}-engine`, "codepuppy-explicit.json")
    dirs.push(path.dirname(file))
    fs.writeFileSync(userConfig, `{ "commands": { "one": { "template": "1" } } }`)
    writeExplicitConfig(file, userConfig, LAYER, root)
    const read = () => JSON.parse(fs.readFileSync(file, "utf8")) as { commands?: Record<string, unknown> }
    expect(Object.keys(read().commands!).sort()).toEqual(["init", "one", "review"])
    const logs: string[] = []
    const stop = watchExplicitSources({ file, root, userConfig, layer: LAYER, skills: () => LAYER.skills, log: (line) => logs.push(line) })
    await settle()
    try {
      atomic(userConfig, `{ "commands": { "two": { "template": "2" } } }`)
      expect(await waitFor(() => "two" in (read().commands ?? {}))).toBe(true)
      expect("one" in read().commands!).toBe(false)

      atomic(userConfig, "{ broken")
      expect(await waitFor(() => logs.some((line) => line.includes("keeping the previous engine config")))).toBe(true)
      expect("two" in read().commands!).toBe(true)
    } finally {
      stop()
    }
    atomic(userConfig, `{ "commands": { "three": { "template": "3" } } }`)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect("three" in (read().commands ?? {})).toBe(false)
  })

  // 监听跑在 main 里(SPEC-engine-config-fence BR-03):FSWatcher 的 error 没有监听者就是 Electron main 进程的未捕获异常(审查 A 第 4 条)。
  test("FSWatcher 报错 ⇒ 记一行具名日志、不抛,停止照常", () => {
    const root = tempDir()
    const file = path.join(root, "..", `${path.basename(root)}-engine`, "codepuppy-explicit.json")
    dirs.push(path.dirname(file))
    writeExplicitConfig(file, undefined, LAYER, root)
    const real = fs.watch
    let watcher: fs.FSWatcher | undefined
    const spy = spyOn(fs, "watch").mockImplementation(((...args: Parameters<typeof fs.watch>) => (watcher = real(...args))) as typeof fs.watch)
    const logs: string[] = []
    const stop = watchExplicitSources({ file, root, layer: LAYER, skills: () => LAYER.skills, log: (line) => logs.push(line) })
    spy.mockRestore()
    try {
      expect(watcher).toBeDefined()
      expect(() => watcher!.emit("error", Object.assign(new Error("EMFILE: too many open files, watch"), { code: "EMFILE" }))).not.toThrow()
      expect(logs).toEqual([`[alpha-code#1667] stopped watching ${root} for engine config inputs: EMFILE: too many open files, watch`])
    } finally {
      stop()
    }
  })

  test("`#1667` 裁决 r3:skills-enabled.json 或某个技能键的 current.json 一变 ⇒ skills 现算并重写;别的文件变了不重写", async () => {
    const root = tempDir()
    const file = path.join(root, "..", `${path.basename(root)}-engine`, "codepuppy-explicit.json")
    dirs.push(path.dirname(file))
    let skills = ["/gen/one"]
    writeExplicitConfig(file, undefined, { ...LAYER, skills }, root)
    const read = () => (JSON.parse(fs.readFileSync(file, "utf8")) as { skills: string[] }).skills
    const stop = watchExplicitSources({ file, root, layer: LAYER, skills: () => skills, log: () => {} })
    await settle()
    try {
      skills = ["/gen/two"]
      atomic(path.join(root, "ext-store", "skill--a", "current.json"), JSON.stringify({ generation: "gen-000002-bbbbbb" }))
      expect(await waitFor(() => read()[0] === "/gen/two")).toBe(true)

      skills = ["/gen/two", "/gen/new-key"]
      atomic(path.join(root, "skills-enabled.json"), JSON.stringify({ v: 3, keys: ["skill--a", "skill--b"], scoped: [], mcp: [] }))
      expect(await waitFor(() => read().includes("/gen/new-key"))).toBe(true)

      skills = ["/gen/should-not-appear"]
      atomic(path.join(root, "ext-store", "skill--a", "generations", "gen-000003-cccccc", "SKILL.md"), "x")
      atomic(path.join(root, "unrelated.json"), "{}")
      await new Promise((resolve) => setTimeout(resolve, 400))
      expect(read()).toEqual(["/gen/two", "/gen/new-key"])
    } finally {
      stop()
    }
  })
})

// SPEC-engine-config-fence BR-03 / AC-05(DESIGN-engine-config-fence §4.4):主进程在 fork 前写显式文件、模型底表与种子 ——
// sidecar 从此只读。种子的字节与 0.2.6 注入写的逐字相同;写或删失败原样抛(消息带路径与 errno,不带内容),server.ts 据此拒绝 fork。
describe("fork 前主进程写引擎配置(writeEngineConfigFiles)", () => {
  const SEED = JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2)
  /** 一个完整投影的 provider(governedModelsBase 才给就绪底表)。 */
  const MODELS = {
    enabled_providers: ["codepuppy"],
    provider: { codepuppy: { name: "Code Puppy", npm: "@ai-sdk/openai-compatible", options: { baseURL: "https://gateway.example.invalid/v1" }, models: { m: { name: "M" } } } },
  }
  const setup = () => {
    const base = tempDir()
    const root = path.join(base, "codepuppy-state", "env", "dev")
    return { userDataPath: path.join(base, "userdata"), root, userConfig: path.join(root, "codepuppy.jsonc") }
  }

  test("codepuppy.jsonc 缺席 ⇒ 先写种子(与 0.2.6 同一份字节),再写显式文件与模型底表;返回两条路径", () => {
    const { userDataPath, root, userConfig } = setup()
    const files = writeEngineConfigFiles({ userDataPath, root, userConfig, layer: LAYER, models: MODELS })
    expect(fs.readFileSync(userConfig, "utf8")).toBe(SEED)
    // 全新机器:引擎配置目录建成 0700(与 0.2.6 由模型底表那一步先建时相同;审查 A 第 2 条)
    expect(fs.statSync(path.dirname(files.explicitConfig)).mode & 0o777).toBe(0o700)
    const hatchFresh = setup()
    const noModels = writeEngineConfigFiles({ userDataPath: hatchFresh.userDataPath, root: hatchFresh.root, layer: LAYER, models: undefined })
    expect(fs.statSync(path.dirname(noModels.explicitConfig)).mode & 0o777).toBe(0o700)
    expect(files).toEqual({ explicitConfig: explicitConfigPath(userDataPath), models: engineModelsPath(userDataPath) })
    expect(engineModelsPath(userDataPath)).toBe(path.join(userDataPath, "codepuppy-engine-config", "models.json"))
    expect(JSON.parse(fs.readFileSync(files.explicitConfig, "utf8"))).toEqual(composeExplicitDocument(SEED, LAYER).document)
    const base = JSON.parse(fs.readFileSync(files.models!, "utf8")) as Record<string, { models?: Record<string, unknown> }>
    expect(Object.keys(base.codepuppy!.models!)).toEqual(["m"])
  })

  test("已有的 codepuppy.jsonc 原样不动;逃生阀(没有 userConfig)不写种子;用户文件坏了 ⇒ 只写我们这一层并把原因交回", () => {
    const { userDataPath, root, userConfig } = setup()
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(userConfig, "{ broken")
    const files = writeEngineConfigFiles({ userDataPath, root, userConfig, layer: LAYER, models: MODELS })
    expect(fs.readFileSync(userConfig, "utf8")).toBe("{ broken")
    expect(files.userError).toContain("JSONC parse error")
    expect(JSON.parse(fs.readFileSync(files.explicitConfig, "utf8"))).toEqual(composeExplicitDocument(undefined, LAYER).document)

    const hatch = setup()
    writeEngineConfigFiles({ userDataPath: hatch.userDataPath, root: hatch.root, layer: LAYER, models: MODELS })
    expect(fs.existsSync(hatch.userConfig)).toBe(false)
  })

  test("E5 逃生阀臂:盘上留着上一代的 models.json,这一代没有模型底表(CODEPUPPY_MODELS_DISABLE 或投影不全)⇒ fork 前删掉,不给路径", () => {
    const { userDataPath, root, userConfig } = setup()
    writeEngineConfigFiles({ userDataPath, root, userConfig, layer: LAYER, models: MODELS })
    expect(fs.existsSync(engineModelsPath(userDataPath))).toBe(true)
    const disabled = writeEngineConfigFiles({ userDataPath, root, userConfig, layer: LAYER, models: undefined })
    expect(disabled.models).toBeUndefined()
    expect(fs.existsSync(engineModelsPath(userDataPath))).toBe(false)

    writeEngineConfigFiles({ userDataPath, root, userConfig, layer: LAYER, models: MODELS })
    const partial = writeEngineConfigFiles({ userDataPath, root, userConfig, layer: LAYER, models: { enabled_providers: ["user-file-provider"], provider: {} } })
    expect(partial.models).toBeUndefined()
    expect(fs.existsSync(engineModelsPath(userDataPath))).toBe(false)
  })

  test("AC-05:写不进(引擎配置目录是个普通文件)或删不掉(models.json 是非空目录)⇒ 原样抛,消息带路径与 errno,不带内容", () => {
    const blocked = setup()
    fs.mkdirSync(blocked.userDataPath, { recursive: true })
    fs.writeFileSync(path.join(blocked.userDataPath, "codepuppy-engine-config"), "secret-looking-content")
    let error: unknown
    try {
      writeEngineConfigFiles({ ...blocked, layer: LAYER, models: MODELS })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(Error)
    expect(String((error as Error).message)).toContain(path.join(blocked.userDataPath, "codepuppy-engine-config"))
    expect(String((error as NodeJS.ErrnoException).code)).toMatch(/^E[A-Z]+$/)
    expect(String((error as Error).message)).not.toContain("secret-looking-content")

    const stuck = setup()
    fs.mkdirSync(path.join(engineModelsPath(stuck.userDataPath), "occupied"), { recursive: true })
    expect(() => writeEngineConfigFiles({ ...stuck, layer: LAYER, models: undefined })).toThrow(engineModelsPath(stuck.userDataPath))
  })
})
