// #1713 / ADR-049:升级时直接对上游 schema、归一化入口和实际读取点清点,每条带已知坏。
import { afterEach, expect } from "bun:test"
import path from "path"
import { Effect, Fiber, Schema } from "effect"
import { Info, Directory } from "@opencode/schema/config"
import { ConfigAgent } from "@opencode/schema/config/agent"
import { ConfigCommand } from "@opencode/schema/config/command"
import { ConfigAgentV1 } from "@opencode/core/v1/config/agent"
import { ConfigCommandV1 } from "@opencode/core/v1/config/command"
import { CodePuppyProjectGate } from "@opencode/core/config/codepuppy-project-gate"
import { ConfigNormalize } from "@opencode/core/config/normalize"
import { ConfigAgentPlugin } from "@opencode/core/config/plugin/agent"
import { Config } from "@opencode/core/config"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Global } from "@opencode/util/global"
import { FSUtil } from "@opencode/util/fs-util"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { AbsolutePath } from "@opencode/core/schema"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { agentHost, host } from "./plugin/host"
import { location } from "./fixture/location"
const it = testEffect(AppNodeBuilder.build(LayerNode.group([FSUtil.node, Agent.node, Bus.node, Global.node])))
afterEach(() => CodePuppyProjectGate.resetForTest())
const missing = (keys: string[], classified: ReadonlySet<string>) => keys.filter((key) => !classified.has(key))

it.live("字段分类:上游 v1 / v2 具名字段与 normalize 顶层键全部分类;删一个分类键点名红", () =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const normalize = yield* fs.readFileString(path.join(import.meta.dir, "../src/config/normalize.ts"))
    const keys = [
      ...new Set([
        ...Object.keys(Info.fields),
        ...Array.from(normalize.matchAll(/\binput\.([A-Za-z_]\w*)/g), (match) => match[1]!),
        ...Array.from(normalize.matchAll(/own\(input,\s*"([^"]+)"/g), (match) => match[1]!),
      ]),
    ]
    const ast = ConfigAgentV1.Info.ast
    expect(ast._tag).toBe("Objects")
    if (ast._tag !== "Objects") return
    const table = CodePuppyProjectGate.classificationsForTest()
    const groups = [
      { keys, classified: table.top },
      { keys: Object.keys(ConfigAgent.Info.fields), classified: table.agent },
      { keys: ast.propertySignatures.map((field) => String(field.name)), classified: table.agentV1 },
      { keys: Object.keys(ConfigCommand.Info.fields), classified: table.command },
      { keys: Object.keys(ConfigCommandV1.Info.fields), classified: table.commandV1 },
    ]
    for (const group of groups) {
      expect(missing(group.keys, group.classified)).toEqual([])
      const bad = new Set(group.classified)
      bad.delete(group.keys[0]!)
      expect(missing(group.keys, bad)).toContain(group.keys[0]!)
    }
  }),
)

it.live(
  "归一化隐含字段:agent / agents / mode 与 command / commands 经实际闸门只剩内容,mode 的上游反向臂生成 primary",
  () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      CodePuppyProjectGate.install({ trusted: () => false })
      const gate = yield* CodePuppyProjectGate.begin({ directory: tmp.path, home: path.join(tmp.path, "home") })
      const filepath = path.join(tmp.path, "opencode.json")
      const filter = gate.document(filepath)!
      for (const key of ["agent", "agents", "mode", "command", "commands"]) {
        const agent = ["agent", "agents", "mode"].includes(key)
        const input = {
          [key]: {
            reader: agent
              ? { [key === "agents" ? "system" : "prompt"]: "BODY", description: "D" }
              : { template: "BODY", description: "D" },
          },
        }
        const normalized = ConfigNormalize.normalize(JSON.parse(filter.raw(JSON.stringify(input), filepath)))
        expect(normalized.type).toBe("normalized")
        if (normalized.type !== "normalized") continue
        const upstream = Schema.decodeUnknownSync(Info)(normalized.encoded)
        if (key === "mode") expect(upstream.agents?.reader?.mode).toBe("primary")
        const info = filter.decoded(upstream, filepath)
        expect({ ...(agent ? info.agents?.reader : info.commands?.reader) }).toEqual(
          agent ? { system: "BODY", description: "D" } : { template: "BODY", description: "D" },
        )
      }
    }),
)

it.live("md 隐含字段:agent / agents / mode / modes 四种目录都保留原 subagent 与正文;删解码后过滤则 mode 两种红", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const fs = yield* FSUtil.Service
    const root = path.join(tmp.path, ".opencode")
    const directories = ["agent", "agents", "mode", "modes"]
    for (const directory of directories) {
      yield* fs.makeDirectory(path.join(root, directory), { recursive: true })
      yield* fs.writeFileString(
        path.join(root, directory, `${directory}-reader.md`),
        "---\ndescription: reader\n---\nBODY",
      )
    }
    CodePuppyProjectGate.install({ trusted: () => false })
    const gate = yield* CodePuppyProjectGate.begin({ directory: tmp.path, home: path.join(tmp.path, "home") })
    gate.directory(root)
    const entries = yield* gate.finish([new Directory({ type: "directory", path: AbsolutePath.make(root) })])
    const agents = yield* Agent.Service
    yield* agents.transform((editor) => {
      for (const directory of directories)
        editor.update(Agent.ID.make(`${directory}-reader`), (agent) => {
          agent.mode = "subagent"
        })
    })
    yield* ConfigAgentPlugin.Plugin.effect(
      host({ location: location({ directory: AbsolutePath.make(tmp.path) }), agent: agentHost(agents) }),
    ).pipe(Effect.provide(Config.testLayer(entries)))
    for (const directory of directories)
      expect(yield* agents.get(Agent.ID.make(`${directory}-reader`))).toMatchObject({
        mode: "subagent",
        system: "BODY",
      })
  }),
)

it.live("读取点:上游目录消费者恰好五个、Markdown 解码恰好三个;多一个副本会红", () =>
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const src = path.join(import.meta.dir, "../src")
    const files = yield* fs.scan("**/*.ts", { cwd: src })
    const contents = yield* Effect.forEach(
      files,
      (file) => fs.readFileString(path.join(src, file)).pipe(Effect.map((text) => ({ file, text }))),
    )
    const directoryCallers = (items: typeof contents) =>
      items
        .filter((item) => item.file !== "config/codepuppy-project-gate.ts" && /entry\.type\s*[!=]==?\s*"directory"/.test(item.text))
        .map((item) => item.file)
        .sort()
    const markdownCallers = (items: typeof contents) =>
      items
        .filter((item) => /ConfigMarkdown\.parse(?:Option)?\(/.test(item.text))
        .map((item) => item.file)
        .sort()
    const requireCallers = (actual: string[], expected: string[]) => {
      const changed = [
        ...actual.filter((file) => !expected.includes(file)),
        ...expected.filter((file) => !actual.includes(file)),
      ]
      if (changed.length) throw new Error(`读取点变化:${changed.join("、")}`)
    }
    const directories = [
      "config/plugin/agent.ts",
      "config/plugin/command.ts",
      "config/plugin/entry-observer.ts",
      "config/plugin/skill.ts",
      "config/plugin/source.ts",
    ]
    const markdown = ["config/plugin/agent.ts", "config/plugin/command.ts", "config/plugin/skill-file.ts"]
    expect(() => requireCallers(directoryCallers(contents), directories)).not.toThrow()
    expect(() => requireCallers(markdownCallers(contents), markdown)).not.toThrow()
    // 从真实上游源文件复制一个读取点,不手写替身格式;同一清点器必须点名新增消费者。
    const directoryCopy = [
      ...contents,
      { ...contents.find((item) => directoryCallers([item]).length)!, file: "config/plugin/codepuppy-unreviewed.ts" },
    ]
    const markdownCopy = [
      ...contents,
      { ...contents.find((item) => markdownCallers([item]).length)!, file: "config/plugin/codepuppy-unreviewed.ts" },
    ]
    expect(() => requireCallers(directoryCallers(directoryCopy), directories)).toThrow("unreviewed.ts")
    expect(() => requireCallers(markdownCallers(markdownCopy), markdown)).toThrow("unreviewed.ts")
  }),
)

it.live("作用点:pending / failed 都不完整,未激活点不需要虚构 done", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    CodePuppyProjectGate.install({ trusted: () => false })
    const gate = yield* CodePuppyProjectGate.begin({ directory: tmp.path, home: path.join(tmp.path, "home") })
    yield* gate.finish([])
    expect(CodePuppyProjectGate.view(tmp.path)?.complete).toBe(true)
    const pending = yield* CodePuppyProjectGate.observe(tmp.path, "skill", Effect.never).pipe(Effect.forkScoped)
    yield* Effect.yieldNow
    expect(CodePuppyProjectGate.view(tmp.path)).toMatchObject({ complete: false, points: { skill: "pending" } })
    yield* Fiber.interrupt(pending)
    expect(CodePuppyProjectGate.view(tmp.path)).toMatchObject({ complete: false, points: { skill: "failed" } })
  }),
)
