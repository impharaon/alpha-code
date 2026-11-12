// `#1667`(#1662 L5;编排器裁决 1667 评论 6738814516 第 2 条、C7 重裁 6741122824):显式文件层的合成与运行中重写
// (engine-explicit-config.ts)。真引擎上的层序判据在 codepuppy-config-injection-engine.cases.ts。
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Schema } from "effect"
import { Config as ConfigSchema } from "@opencode/schema/config"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { ensureSkillsPath } from "./engine-config-truth"
import { composeExplicitDocument, watchExplicitSources, writeExplicitConfig, type ExplicitLayer } from "./engine-explicit-config"

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

  test("没有 policies(模型治理关着)⇒ 显式文件里不写 policies", () => {
    expect(composeExplicitDocument(undefined, { ...LAYER, policies: [] }).document.policies).toBeUndefined()
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
    writeExplicitConfig(file, userConfig, LAYER)
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

  test("`#1667` 裁决 r3:skills-enabled.json 或某个技能键的 current.json 一变 ⇒ skills 现算并重写;别的文件变了不重写", async () => {
    const root = tempDir()
    const file = path.join(root, "..", `${path.basename(root)}-engine`, "codepuppy-explicit.json")
    dirs.push(path.dirname(file))
    let skills = ["/gen/one"]
    writeExplicitConfig(file, undefined, { ...LAYER, skills })
    const read = () => (JSON.parse(fs.readFileSync(file, "utf8")) as { skills: string[] }).skills
    const stop = watchExplicitSources({ file, root, layer: LAYER, skills: () => skills, log: () => {} })
    await settle()
    try {
      skills = ["/gen/two"]
      atomic(path.join(root, "ext-store", "skill--a", "current.json"), JSON.stringify({ generation: "gen-000002-bbbbbb" }))
      expect(await waitFor(() => read()[0] === "/gen/two")).toBe(true)

      skills = ["/gen/two", "/gen/new-key"]
      atomic(path.join(root, "skills-enabled.json"), JSON.stringify({ v: 1, keys: ["skill--a", "skill--b"] }))
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

// 分类与「这处锚守不住什么」登记在 ./source-text-anchors.ts。
test("ANCHOR (not a gate): sidecar.ts 在 import 引擎之前、拿到注入结果之后就开始监听 codepuppy.jsonc(watchExplicitSources)", () => {
  const sidecar = fs.readFileSync(path.join(import.meta.dir, "sidecar.ts"), "utf8")
  const injection = sidecar.indexOf("const injection = prepareSidecarEnv(")
  const watch = sidecar.indexOf("watchExplicitSources({ ...injection.explicit")
  const engine = sidecar.indexOf('await import("virtual:opencode-server")')
  expect(injection).toBeGreaterThan(-1)
  expect(watch).toBeGreaterThan(injection)
  expect(engine).toBeGreaterThan(watch)
})
