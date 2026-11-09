// `#1667`(#1662 L5;编排器裁决 1667 评论 6738814516 第 2 条、C7 重裁 6741122824):显式文件层的合成与运行中重写
// (engine-explicit-config.ts)。真引擎上的层序判据在 codepuppy-config-injection-engine.cases.ts。
import { afterEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Schema } from "effect"
import { Config as ConfigSchema } from "@opencode/schema/config"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { composeExplicitDocument, watchExplicitSources, writeExplicitConfig, type ExplicitLayer } from "./engine-explicit-config"

const LAYER: ExplicitLayer = {
  policies: [
    { action: "provider.use", resource: "*", effect: "deny" },
    { action: "provider.use", resource: "codepuppy", effect: "allow" },
  ],
  commands: { init: { template: "factory init", description: "guided" }, review: { template: "factory review", subagent: true } },
  skills: ["/factory/a", "/root/skills-live"],
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

  test("用户文件解析不了 ⇒ 只放我们这一层并给出原因(不把半份坏文件交给引擎)", () => {
    const { document, userError } = composeExplicitDocument("{ not json", LAYER)
    expect(userError).toContain("JSONC parse error")
    expect(document).toEqual({ $schema: "https://opencode.ai/config.json", skills: LAYER.skills, commands: LAYER.commands, policies: LAYER.policies })
  })

  test("没有 policies(模型治理关着)⇒ 显式文件里不写 policies", () => {
    expect(composeExplicitDocument(undefined, { ...LAYER, policies: [] }).document.policies).toBeUndefined()
  })
})

describe("运行中:codepuppy.jsonc 一变就重写显式文件", () => {
  const waitFor = async (pred: () => boolean, ms = 3_000) => {
    const until = Date.now() + ms
    while (Date.now() < until) {
      if (pred()) return true
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return false
  }

  test("原子写(rename)改用户文件 ⇒ 显式文件跟着变;改坏 ⇒ 保留上一份好的;停止之后不再跟", async () => {
    const dir = tempDir()
    const userConfig = path.join(dir, "codepuppy.jsonc")
    const file = path.join(dir, "engine", "codepuppy-explicit.json")
    fs.writeFileSync(userConfig, `{ "commands": { "one": { "template": "1" } } }`)
    writeExplicitConfig(file, userConfig, LAYER)
    const read = () => JSON.parse(fs.readFileSync(file, "utf8")) as { commands?: Record<string, unknown> }
    expect(Object.keys(read().commands!).sort()).toEqual(["init", "one", "review"])
    const logs: string[] = []
    const stop = watchExplicitSources({ file, userConfig, layer: LAYER, log: (line) => logs.push(line) })
    try {
      const atomic = (text: string) => {
        fs.writeFileSync(`${userConfig}.tmp`, text)
        fs.renameSync(`${userConfig}.tmp`, userConfig)
      }
      atomic(`{ "commands": { "two": { "template": "2" } } }`)
      expect(await waitFor(() => "two" in (read().commands ?? {}))).toBe(true)
      expect("one" in read().commands!).toBe(false)

      atomic("{ broken")
      expect(await waitFor(() => logs.some((line) => line.includes("keeping the previous engine config")))).toBe(true)
      expect("two" in read().commands!).toBe(true)
    } finally {
      stop()
    }
    fs.writeFileSync(userConfig, `{ "commands": { "three": { "template": "3" } } }`)
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect("three" in (read().commands ?? {})).toBe(false)
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
