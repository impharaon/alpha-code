// #1713 —— 项目 OpenCode 配置的装载闸(packages/core/src/config/codepuppy-project-gate.ts,接管的 config.ts 只在 load() 里调用它)。
// 规则见 DESIGN-project-engine-config-takeover 契约 A2–A4、A8–A10 与契约 B;这里在上游真 Config.layer 上、用临时目录判:
//   · 未允许:暂缓的顶层键(v1 与 v2 写法)在归一化之前拿掉,内容类照常;同一条目里的内容不被暂缓字段连累(F-23);
//     `mode` 名字空间隐含生成的 primary 在解码后拿掉(F-24);命令的控制字段拿掉;引擎认不出的键不列进视图;
//   · 已允许:原样,只去掉 `-*` 与 `-opencode.<id>`;
//   · 用户全局(父目录是主目录的 opencode.json)不过滤;主目录以下与主目录之外的遍历文档都过滤;
//   · 闸门文档排在托管策略之后,拒绝项目 `.opencode/plugin(s)/`,用户全局写的 allow 盖不过它;
//   · 信任每次装载只读一次;读信任抛错 ⇒ 未允许;未安装 ⇒ 与上游相同。
// 每条都带反向臂(没有闸门 / 闸门不这么做 ⇒ 同一断言反过来),证明判据能失败。
import path from "path"
import fs from "fs/promises"
import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Config } from "@opencode/core/config"
import { CodePuppyProjectGate } from "@opencode/core/config/codepuppy-project-gate"
import { type Document, type Entry } from "@opencode/schema/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Credential } from "@opencode/core/credential"
import { Watcher } from "@opencode/core/filesystem/watcher"
import { Bus } from "@opencode/core/bus"
import { Global } from "@opencode/util/global"
import { Location } from "@opencode/core/location"
import { AbsolutePath } from "@opencode/core/schema"
import { WellKnown } from "@opencode/core/wellknown"
import { ManagedPolicy } from "@opencode/core/managed-policy"
import { emptyCredentialNode, emptyWellknownNode } from "./fixture/config-nodes"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

afterEach(() => CodePuppyProjectGate.resetForTest())

/** 与上游 test/config/config.test.ts 的 testLayer 同一种搭法:真 Config.layer,全局目录与 HOME 都在临时目录里。 */
function configLayer(directory: string, globalDirectory: string, home: string) {
  const locationLayer = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) }, { projectDirectory: AbsolutePath.make(directory) })),
  )
  const built = AppNodeBuilder.build(LayerNode.group([Config.node, Bus.node]), [
    Config.node.replace(Config.configured({ system: false })),
    Location.node.replace(locationLayer),
    Global.node.replace(Global.layerWith({ config: globalDirectory, home })),
    Credential.node.replace(emptyCredentialNode),
    WellKnown.node.replace(emptyWellknownNode),
    Watcher.node.replace(Watcher.testLayer),
  ])
  return Layer.mergeAll(built, Watcher.testLayer)
}

type Fixture = { root: string; global: string; home: string; project: string }

async function fixture(files: Record<string, unknown>, layout: "under-home" | "outside-home" = "under-home"): Promise<Fixture & AsyncDisposable> {
  const tmp = await tmpdir("codepuppy-project-gate-")
  const global = path.join(tmp.path, "global")
  const home = path.join(tmp.path, "home")
  const project = layout === "under-home" ? path.join(home, "work", "project") : path.join(tmp.path, "elsewhere", "project")
  await fs.mkdir(project, { recursive: true })
  await fs.mkdir(global, { recursive: true })
  for (const [relative, body] of Object.entries(files)) {
    const file = path.join(tmp.path, relative)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, typeof body === "string" ? body : JSON.stringify(body))
  }
  return { root: tmp.path, global, home, project, [Symbol.asyncDispose]: () => tmp[Symbol.asyncDispose]() }
}

const entriesOf = (f: Fixture) =>
  Effect.gen(function* () {
    const config = yield* Config.Service
    return yield* config.entries()
  }).pipe(Effect.provide(configLayer(f.project, f.global, f.home)))

const documentAt = (entries: Entry[], file: string) =>
  entries.find((entry): entry is Document => entry.type === "document" && entry.path === file)

const run = <A>(body: () => Promise<A>) => Effect.promise(body)

describe("#1713 项目 OpenCode 配置的装载闸", () => {
  it.live("未允许:暂缓的顶层键(v1 与 v2)在归一化之前拿掉,内容类照常;引擎认不出的键不列;反向臂:未安装 ⇒ 全部生效", () =>
    run(async () => {
      await using f = await fixture({
        "home/work/project/opencode.json": {
          $schema: "https://opencode.ai/config.json",
          instructions: ["NOTES.md"],
          skills: ["./more-skills"],
          compaction: { auto: false },
          attachment: { image: { auto_resize: false } },
          username: "u",
          mcp: { servers: { srv: { type: "local", command: ["/bin/true"] } }, legacy: { type: "local", command: ["/bin/true"] } },
          formatter: { fmt: { command: ["/bin/true"], extensions: [".txt"] } },
          lsp: { l: { command: ["/bin/true"], extensions: [".txt"] } },
          shell: "/opt/bin/fish",
          plugins: ["./p", "-x"],
          plugin: ["legacy-plugin"],
          providers: { openai: { package: "file:///tmp/x.mjs" } },
          model: "openai/gpt",
          default_agent: "plan",
          permissions: [{ action: "*", resource: "*", effect: "allow" }],
          tools: { shell: true },
          enabled_providers: ["openai"],
          snapshot: false,
          autoupdate: false,
          autoshare: true,
          small_model: "openai/mini",
          references: { r: { path: "/tmp" } },
          experimental: { part_rows: true },
          logLevel: "DEBUG",
          layout: "stretch",
        },
      })
      const allowed: string[] = []
      CodePuppyProjectGate.install({ trusted: (directory) => (allowed.push(directory), false) })
      const entries = await Effect.runPromise(entriesOf(f))
      const info = documentAt(entries, path.join(f.project, "opencode.json"))!.info
      expect(info.instructions).toEqual(["NOTES.md"])
      expect(info.skills).toEqual(["./more-skills"])
      expect(info.compaction).toEqual({ auto: false })
      expect(info.media).toEqual({ image: { auto_resize: false } })
      expect(info.username).toBe("u")
      for (const key of ["mcp", "formatter", "lsp", "shell", "plugins", "providers", "model", "default_agent", "permissions", "policies", "snapshots", "update", "share", "references", "experimental", "agents"] as const)
        expect(info[key], key).toBeUndefined()
      expect(allowed).toEqual([f.project])
      const withheld = CodePuppyProjectGate.view(f.project)!.withheld
      expect(withheld.map((item) => `${item.kind}:${item.name}`).sort()).toEqual(
        [
          "mcp:srv",
          "mcp:legacy",
          "plugin:./p",
          "plugin:-x",
          "plugin:legacy-plugin",
          "formatter:fmt",
          "shell:/opt/bin/fish",
          "provider:openai",
          "setting:lsp",
          "setting:model",
          "setting:default_agent",
          "setting:permissions",
          "setting:tools",
          "setting:enabled_providers",
          "setting:snapshot",
          "setting:autoupdate",
          "setting:autoshare",
          "setting:small_model",
          "setting:references",
          "setting:experimental",
        ].sort(),
      )
      expect(withheld.every((item) => item.file === "opencode.json")).toBe(true)
      expect(JSON.stringify(withheld)).not.toContain("logLevel")
      expect(JSON.stringify(withheld)).not.toContain("layout")

      // 反向臂:未安装 ⇒ 同一份文档全部生效(行为与上游相同,A10)
      CodePuppyProjectGate.resetForTest()
      const upstream = documentAt(await Effect.runPromise(entriesOf(f)), path.join(f.project, "opencode.json"))!.info
      expect(upstream.mcp).toBeDefined()
      expect(upstream.shell).toBe("/opt/bin/fish")
      expect(upstream.plugins).toBeDefined()
      expect(upstream.permissions).toBeDefined()
    }),
  )

  it.live("未允许:写了 system 又写了无效 {env:} 模型的 agent 留下、提示词在;v1 mode 名字空间解码后没有 mode;反向臂:未安装 ⇒ 前者整条丢、后者 primary", () =>
    run(async () => {
      delete process.env.CP_1713_UNSET_MODEL
      await using f = await fixture({
        "home/work/project/opencode.json": {
          agents: { envagent: { system: "ENV-PROMPT", model: "{env:CP_1713_UNSET_MODEL}", permissions: [{ action: "*", resource: "*", effect: "allow" }] } },
          mode: { modeagent: { prompt: "MODE-PROMPT", mode: "subagent", temperature: 0.1 } },
        },
      })
      CodePuppyProjectGate.install({ trusted: () => false })
      const info = documentAt(await Effect.runPromise(entriesOf(f)), path.join(f.project, "opencode.json"))!.info
      expect(info.agents?.envagent?.system).toBe("ENV-PROMPT")
      expect(info.agents?.envagent?.model).toBeUndefined()
      expect(info.agents?.envagent?.permissions).toBeUndefined()
      expect(info.agents?.modeagent?.system).toBe("MODE-PROMPT")
      expect(info.agents?.modeagent?.mode).toBeUndefined()
      expect(info.agents?.modeagent?.request).toBeUndefined()
      const withheld = CodePuppyProjectGate.view(f.project)!.withheld
      expect(withheld).toEqual([
        { kind: "agent-control", name: "envagent", file: "opencode.json", fields: ["model", "permissions"] },
        { kind: "agent-control", name: "modeagent", file: "opencode.json", fields: ["mode", "temperature"] },
      ])

      CodePuppyProjectGate.resetForTest()
      const upstream = documentAt(await Effect.runPromise(entriesOf(f)), path.join(f.project, "opencode.json"))!.info
      expect(upstream.agents?.envagent).toBeUndefined()
      expect(upstream.agents?.modeagent?.mode).toBe("primary")
    }),
  )

  it.live("未允许:命令的控制字段(v2 与 v1 含 variant)拿掉,模板与说明照常;反向臂:未安装 ⇒ agent / model / subtask 生效", () =>
    run(async () => {
      await using f = await fixture({
        "home/work/project/opencode.json": {
          commands: { two: { template: "T2", description: "D2", agent: "build", model: "openai/gpt", subtask: true } },
          command: { one: { template: "T1", model: "openai/gpt", variant: "high", agent: "plan" } },
        },
      })
      CodePuppyProjectGate.install({ trusted: () => false })
      const info = documentAt(await Effect.runPromise(entriesOf(f)), path.join(f.project, "opencode.json"))!.info
      expect({ ...info.commands?.two }).toEqual({ template: "T2", description: "D2" })
      expect({ ...info.commands?.one }).toEqual({ template: "T1" })
      expect(CodePuppyProjectGate.view(f.project)!.withheld).toEqual([
        { kind: "command-run", name: "one", file: "opencode.json", fields: ["model", "variant", "agent"] },
        { kind: "command-run", name: "two", file: "opencode.json", fields: ["agent", "model", "subtask"] },
      ])

      CodePuppyProjectGate.resetForTest()
      const upstream = documentAt(await Effect.runPromise(entriesOf(f)), path.join(f.project, "opencode.json"))!.info
      expect(upstream.commands?.two?.agent).toBe("build")
      expect(upstream.commands?.two?.subtask).toBe(true)
      expect(String(upstream.commands?.one?.model?.variant)).toBe("high")
    }),
  )

  it.live("已允许:项目内容原样,只去掉 -* 与 -opencode.<id>,别的移除指令照常;反向臂:未安装 ⇒ 两条内置移除指令也在", () =>
    run(async () => {
      await using f = await fixture({
        "home/work/project/opencode.json": { shell: "/opt/bin/fish", plugins: ["-*", "-opencode.config.agent", "-x", "./p"], mcp: { servers: { srv: { type: "local", command: ["/bin/true"] } } } },
      })
      CodePuppyProjectGate.install({ trusted: () => true })
      const entries = await Effect.runPromise(entriesOf(f))
      const info = documentAt(entries, path.join(f.project, "opencode.json"))!.info
      expect(info.shell).toBe("/opt/bin/fish")
      expect(info.mcp?.servers?.srv).toBeDefined()
      expect(info.plugins).toEqual(["-x", "./p"])
      expect(entries.some((entry) => entry.type === "document" && entry.info.policies?.some((policy) => policy.resource.startsWith(path.join(f.project, ".opencode"))))).toBe(false)
      expect(CodePuppyProjectGate.view(f.project)).toMatchObject({ trusted: true, withheld: [] })

      CodePuppyProjectGate.resetForTest()
      const upstream = documentAt(await Effect.runPromise(entriesOf(f)), path.join(f.project, "opencode.json"))!.info
      expect(upstream.plugins).toEqual(["-*", "-opencode.config.agent", "-x", "./p"])
    }),
  )

  it.live("用户全局:父目录是主目录的 opencode.json 不过滤,主目录与项目之间的上级目录过滤;项目在主目录之外时每一级都过滤", () =>
    run(async () => {
      await using under = await fixture({
        "home/opencode.json": { shell: "/home/level/shell" },
        "home/work/opencode.json": { mcp: { servers: { between: { type: "local", command: ["/bin/true"] } } } },
      })
      CodePuppyProjectGate.install({ trusted: () => false })
      const entries = await Effect.runPromise(entriesOf(under))
      expect(documentAt(entries, path.join(under.home, "opencode.json"))!.info.shell).toBe("/home/level/shell")
      expect(documentAt(entries, path.join(under.home, "work", "opencode.json"))!.info.mcp).toBeUndefined()
      expect(CodePuppyProjectGate.view(under.project)!.withheld).toEqual([{ kind: "mcp", name: "between", file: "../opencode.json" }])

      await using outside = await fixture({ "elsewhere/opencode.json": { shell: "/up/shell" } }, "outside-home")
      const far = await Effect.runPromise(entriesOf(outside))
      expect(documentAt(far, path.join(outside.root, "elsewhere", "opencode.json"))!.info.shell).toBeUndefined()
    }),
  )

  it.live("闸门文档:紧跟托管策略、拒绝项目 .opencode/plugin(s)/,用户全局写的 allow plugin.use * 盖不过;已允许没有它;反向臂:同一份文档排到全局文档之后 ⇒ 用户的 allow 胜出", () =>
    run(async () => {
      await using f = await fixture({
        "home/work/project/.opencode/plugins/x.js": "export default {}",
        "global/opencode.json": { policies: [{ action: "plugin.use", resource: "*", effect: "allow" }] },
      })
      const target = path.join(f.project, ".opencode", "plugins", "x.js")
      const legacy = path.join(f.project, ".opencode", "plugin", "y.ts")
      CodePuppyProjectGate.install({ trusted: () => false })
      const entries = await Effect.runPromise(entriesOf(f))
      const decide = (list: Entry[], resource: string) => ManagedPolicy.decision(ManagedPolicy.statements(list), "plugin.use", resource)
      expect(decide(entries, target)).toBe("deny")
      expect(decide(entries, legacy)).toBe("deny")
      expect(decide(entries, path.join(f.global, "plugins", "g.js"))).toBe("allow")
      const gateIndex = entries.findIndex((entry) => entry.type === "document" && entry.path === undefined && entry.info.policies?.some((policy) => policy.resource === path.join(f.project, ".opencode", "plugins", "*")))
      expect(gateIndex).toBe(0)
      expect(entries.filter((entry) => entry.type === "directory" && CodePuppyProjectGate.projectEntry(entry)).map((entry) => String(entry.path))).toEqual([path.join(f.project, ".opencode")])

      const reordered = [...entries.slice(1), entries[0]!]
      expect(decide(reordered, target)).toBe("allow")

      CodePuppyProjectGate.resetForTest()
      CodePuppyProjectGate.install({ trusted: () => true })
      const trusted = await Effect.runPromise(entriesOf(f))
      expect(decide(trusted, target)).toBe("allow")
      expect(trusted.some((entry) => CodePuppyProjectGate.projectEntry(entry))).toBe(false)
    }),
  )

  it.live("信任:读信任抛错 ⇒ 按未允许过滤;钩子拿到的是 realpath 后的项目目录", () =>
    run(async () => {
      await using f = await fixture({ "home/work/project/opencode.json": { shell: "/opt/bin/fish" } })
      const link = path.join(f.root, "link-to-project")
      await fs.symlink(f.project, link)
      const seen: string[] = []
      CodePuppyProjectGate.install({
        trusted: (directory) => {
          seen.push(directory)
          throw new Error("record unreadable")
        },
      })
      const linked = { ...f, project: link }
      const info = documentAt(await Effect.runPromise(entriesOf(linked)), path.join(link, "opencode.json"))!.info
      expect(info.shell).toBeUndefined()
      expect(seen).toEqual([f.project])
    }),
  )
})
