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
import { ConfigMarkdown } from "@opencode/core/config/markdown"
import { ConfigAgentPlugin } from "@opencode/core/config/plugin/agent"
import { Agent } from "@opencode/core/agent"
import { FSUtil } from "@opencode/util/fs-util"
import { Skill } from "@opencode/schema/skill"
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
import { agentHost, host } from "./plugin/host"

const it = testEffect(Layer.empty)

afterEach(() => CodePuppyProjectGate.resetForTest())

/** 与上游 test/config/config.test.ts 的 testLayer 同一种搭法:真 Config.layer,全局目录与 HOME 都在临时目录里。 */
function configLayer(directory: string, globalDirectory: string, home: string, system: string | false = false) {
  const locationLayer = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) }, { projectDirectory: AbsolutePath.make(directory) })),
  )
  const built = AppNodeBuilder.build(LayerNode.group([Config.node, Bus.node]), [
    Config.node.replace(Config.configured({ system })),
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

it.live("审查4:文档 v1 / v2 的 subagent 保留且不列,primary / all 与 mode 名字空间仍暂缓", () => run(async () => {
  await using f = await fixture({ "home/work/project/opencode.json": {
    agent: { legacy: { prompt: "body", mode: "subagent" } },
    agents: { native: { system: "body", mode: "subagent" }, wide: { mode: "all" }, primary: { mode: "primary" } },
    mode: { namespaced: { prompt: "body", mode: "subagent" } },
  } })
  CodePuppyProjectGate.install({ trusted: () => false })
  const info = documentAt(await Effect.runPromise(entriesOf(f)), path.join(f.project, "opencode.json"))!.info
  expect(info.agents?.legacy?.mode).toBe("subagent")
  expect(info.agents?.native?.mode).toBe("subagent")
  for (const id of ["wide", "primary", "namespaced"]) expect(info.agents?.[id]?.mode).toBeUndefined()
  expect(CodePuppyProjectGate.view(f.project)!.withheld.map((item) => item.name).sort()).toEqual(["namespaced", "primary", "wide"])
  CodePuppyProjectGate.install({ trusted: () => true })
  const allowed = documentAt(await Effect.runPromise(entriesOf(f)), path.join(f.project, "opencode.json"))!.info
  expect(allowed.agents?.legacy?.mode).toBe("subagent")
  expect(allowed.agents?.native?.mode).toBe("subagent")
  expect(allowed.agents?.wide?.mode).toBe("all")
  expect(allowed.agents?.namespaced?.mode).toBe("primary")
}))

it.live("审查11:没有文件头的 md 在四个项目读取点逐字节交出", () => run(async () => {
  await using f = await fixture({})
  CodePuppyProjectGate.install({ trusted: () => false })
  await Effect.runPromise(entriesOf(f))
  for (const content of ["普通正文\n\n", "----\n正文", "\uFEFF正文\r\n末行  ", "", "无末尾换行"])
    for (const [point, file] of [["agent", "agents/a.md"], ["command", "commands/x.md"], ["skill", "skills/x/SKILL.md"], ["skill", ".codepuppy/skills/x/SKILL.md"]] as const) {
      const text = CodePuppyProjectGate.frontmatter(f.project, path.join(f.project, file), content, point)
      expect(Buffer.from(text ?? "")).toEqual(Buffer.from(content))
    }
}))

describe("#1713 项目 OpenCode 配置的装载闸", () => {
  // 样本来源:上游 test/config/markdown.test.ts 的 YAML/sanitize 写法,以及段 0 真引擎探针的 JS 文件头。
  it.live("文件头:同一份 YAML / JSON 在未允许与允许时 data、正文逐字相等,含 sanitize、CRLF 与无末尾换行", () =>
    run(async () => {
      await using f = await fixture({})
      const samples = [
        "---\nname: review\ndescription: 'hello: world'\nmetadata:\n  opencode/autoinvoke: true\n---\n\n# 正文  \n最后一行",
        "---\ndescription: Review: carefully\n---\n  正文\n\n",
        '---json\n{"name":"review","metadata":{"enabled":true}}\n---\n正文',
        "---\r\nname: review\r\n---\r\n正文\r\n\r\n",
        "---\n---\n---javascript\nthrow new Error('正文不能被当成文件头')\n---\nbody",
        "普通正文\n\n",
        "----\n普通正文",
      ]
      for (const content of samples) {
        CodePuppyProjectGate.install({ trusted: () => false })
        await Effect.runPromise(entriesOf(f))
        const text = CodePuppyProjectGate.frontmatter(f.project, path.join(f.project, "SKILL.md"), content, "skill")
        expect(text).toBeDefined()
        const gated = ConfigMarkdown.parse(text!)
        CodePuppyProjectGate.install({ trusted: () => true })
        await Effect.runPromise(entriesOf(f))
        expect(CodePuppyProjectGate.frontmatter(f.project, path.join(f.project, "SKILL.md"), content, "skill")).toBe(
          content,
        )
        const upstream = ConfigMarkdown.parse(content)
        expect(gated.data).toEqual(upstream.data)
        expect(gated.content).toBe(upstream.content)
      }
    }),
  )

  it.live(
    "文件头:javascript / js / JavaScript 不执行、记录 frontmatter-code、正文留下;允许与未安装反向臂照旧执行;未知语言跳过",
    () =>
      run(async () => {
        await using f = await fixture({})
        for (const language of ["javascript", "js", "JavaScript"]) {
          for (const point of ["agent", "command", "skill"] as const) {
            const marker = path.join(f.project, `${language}-${point}.ran`)
            const filepath = path.join(f.project, `${language}-${point}.md`)
            const content = `---${language}\n(require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran"), {description: "probe"})\n---\n\nBODY  `
            CodePuppyProjectGate.install({ trusted: () => false })
            await Effect.runPromise(entriesOf(f))
            const text = await Effect.runPromise(
              CodePuppyProjectGate.observe(
                f.project,
                point,
                Effect.sync(() => CodePuppyProjectGate.frontmatter(f.project, filepath, content, point)),
              ),
            )
            expect(ConfigMarkdown.parse(text!).content).toBe("\nBODY  ")
            expect(await Bun.file(marker).exists()).toBe(false)
            expect(CodePuppyProjectGate.view(f.project)!.withheld).toEqual([
              { kind: "frontmatter-code", name: path.basename(filepath), file: path.basename(filepath) },
            ])
            for (const installed of [true, false]) {
              CodePuppyProjectGate.resetForTest()
              if (installed) {
                CodePuppyProjectGate.install({ trusted: () => true })
                await Effect.runPromise(entriesOf(f))
              }
              const allowed = CodePuppyProjectGate.frontmatter(f.project, filepath, content, point)
              expect(allowed).toBe(content)
              expect(ConfigMarkdown.parse(allowed!).data.description).toBe("probe")
              expect(await Bun.file(marker).text()).toBe("ran")
              await fs.unlink(marker)
            }
          }
        }
        CodePuppyProjectGate.install({ trusted: () => false })
        await Effect.runPromise(entriesOf(f))
        expect(
          CodePuppyProjectGate.frontmatter(f.project, "x.md", "---coffee\nx = 1\n---\nbody", "skill"),
        ).toBeUndefined()
        expect(
          CodePuppyProjectGate.frontmatter(f.project, "x.md", "---\nname: [broken\n---\nbody", "skill"),
        ).toBeUndefined()
      }),
  )

  it.live("md agent:校验前拿掉控制字段保住提示词,解码后拿掉 modes/ 隐含 primary;允许反向臂保留控制字段与 primary", () =>
    run(async () => {
      await using f = await fixture({
        "home/work/project/.opencode/agents/envagent.md":
          '---\nsystem: header\nmodel: "{env:CP_1713_UNSET_MODEL}"\npermissions:\n  - action: "*"\n    resource: "*"\n    effect: allow\nmode: primary\n---\nENV-BODY',
        "home/work/project/.opencode/agents/reviewer.md":
          "---\nmodel: test/model\nmode: primary\npermission:\n  bash: allow\ncolor: primary\n---\nREVIEW-BODY",
        "home/work/project/.opencode/modes/explore.md": "---\ndescription: mode dir\n---\nMODE-BODY",
      })
      const read = (entries: Entry[]) =>
        Effect.gen(function* () {
          const agents = yield* Agent.Service
          yield* agents.transform((editor) =>
            editor.update(Agent.ID.make("explore"), (agent) => {
              agent.mode = "subagent"
            }),
          )
          yield* ConfigAgentPlugin.Plugin.effect(
            host({
              location: location({ directory: AbsolutePath.make(f.project) }),
              agent: agentHost(agents),
            }),
          ).pipe(Effect.provide(Config.testLayer(entries)))
          return Object.fromEntries((yield* agents.list()).map((item) => [item.id, item]))
        }).pipe(
          Effect.scoped,
          Effect.provide(AppNodeBuilder.build(LayerNode.group([Agent.node, Bus.node, FSUtil.node, Global.node]))),
        )
      CodePuppyProjectGate.install({ trusted: () => false })
      const gated = await Effect.runPromise(read(await Effect.runPromise(entriesOf(f))))
      expect(gated.envagent?.system).toBe("ENV-BODY")
      expect(gated.envagent?.model).toBeUndefined()
      expect(gated.envagent?.permissions).toEqual(Agent.Info.default(Agent.ID.make("envagent")).permissions)
      expect(gated.reviewer?.model).toBeUndefined()
      // 去掉 v1 控制字段后按 v2 解码,主题色名按 v2 原样被忽略。
      expect(gated.reviewer?.color).toBeUndefined()
      expect(gated.explore).toMatchObject({ system: "MODE-BODY", mode: "subagent" })
      expect(CodePuppyProjectGate.view(f.project)!.withheld).toContainEqual({
        kind: "agent-control",
        name: "explore",
        file: ".opencode/modes/explore.md",
        fields: ["mode"],
      })
      CodePuppyProjectGate.install({ trusted: () => true })
      const allowed = await Effect.runPromise(read(await Effect.runPromise(entriesOf(f))))
      expect(allowed.envagent).toBeUndefined()
      expect(String(allowed.reviewer?.model?.providerID)).toBe("test")
      expect(String(allowed.reviewer?.model?.id)).toBe("model")
      expect(allowed.reviewer?.color).toBe("#aaaaaa")
      expect(allowed.explore?.mode).toBe("primary")
    }),
  )

  it.live(
    "md 命令:只留模板与说明、控制字段与插值登记;技能来源含项目 URL 与 .codepuppy、不含全局;读取点记录 done / failed",
    () =>
      run(async () => {
        await using f = await fixture({ "home/work/project/.opencode/commands/review.md": "body" })
        CodePuppyProjectGate.install({ trusted: () => false })
        const entries = await Effect.runPromise(entriesOf(f))
        const entry = entries.find((item) => item.type === "directory" && CodePuppyProjectGate.projectEntry(item))!
        const filepath = path.join(f.project, ".opencode/commands/review.md")
        const content =
          "---\ndescription: review\nagent: plan\nmodel: invalid\nsubtask: true\nvariant: high\n---\nhello !`printf probe` $ARGUMENTS"
        await Effect.runPromise(
          CodePuppyProjectGate.observe(
            f.project,
            "command",
            Effect.sync(() => {
              const parsed = ConfigMarkdown.parse(
                CodePuppyProjectGate.markdown(f.project, entry, "command")(filepath, content)!,
              )
              expect(parsed.data).toEqual({ description: "review" })
              expect(parsed.content).toBe("hello !`printf probe` $ARGUMENTS")
              expect(CodePuppyProjectGate.interpolation(f.project, "review", true, filepath, true)).toBe(true)
            }),
          ),
        )
        expect(CodePuppyProjectGate.view(f.project)!.withheld).toContainEqual({
          kind: "command-run",
          name: "review",
          file: ".opencode/commands/review.md",
          fields: ["agent", "model", "subtask", "shell"],
        })
        const directory = (p: string) => Skill.DirectorySource.make({ type: "directory", path: AbsolutePath.make(p) })
        const local = directory(path.join(f.project, ".opencode/skills"))
        const explicit = directory(path.join(f.project, ".codepuppy/skills"))
        const external = directory(path.join(f.root, "external"))
        const url = Skill.UrlSource.make({ type: "url", url: "https://example.com/skills/index.json" })
        const sources = [
          local,
          explicit,
          external,
          url,
          directory(path.join(f.global, "skills")),
          directory(path.join(f.home, ".opencode/skills")),
        ]
        expect([...CodePuppyProjectGate.skillSources(f.project, sources, [local, external, { ...url }])]).toEqual([
          local,
          explicit,
          external,
          url,
        ])
        expect(CodePuppyProjectGate.view(f.project)!.points.command).toBe("done")
        await Effect.runPromise(
          CodePuppyProjectGate.observe(f.project, "skill", Effect.fail(new Error("probe"))).pipe(Effect.ignore),
        )
        expect(CodePuppyProjectGate.view(f.project)!.points.skill).toBe("failed")
        expect(CodePuppyProjectGate.view(f.project)!.complete).toBe(false)
        CodePuppyProjectGate.install({ trusted: () => true })
        await Effect.runPromise(entriesOf(f))
        expect(CodePuppyProjectGate.interpolation(f.project, "review", false, filepath, true)).toBe(false)
        expect(CodePuppyProjectGate.markdown(f.project, entry, "command")(filepath, content)).toBe(content)
        expect([...CodePuppyProjectGate.skillSources(f.project, sources, sources)]).toEqual([])
      }),
  )

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

it.live("审查1:无变化重载保留 md 清单与作用点,在途观察者仍写同一份记录", () => run(async () => {
  await using f = await fixture({ "home/work/project/opencode.json": {} })
  CodePuppyProjectGate.install({ trusted: () => false })
  await Effect.runPromise(entriesOf(f))
  await Effect.runPromise(CodePuppyProjectGate.observe(f.project, "command", Effect.sync(() => {
    CodePuppyProjectGate.frontmatter(f.project, path.join(f.project, "commands/x.md"), "---\nagent: plan\n---\ntext", "command")
    CodePuppyProjectGate.interpolation(f.project, "x", true, path.join(f.project, "commands/x.md"), true)
  })))
  const before = CodePuppyProjectGate.view(f.project)
  await Effect.runPromise(entriesOf(f))
  expect(CodePuppyProjectGate.view(f.project)).toEqual(before)
  let release = () => {}
  const waiting = new Promise<void>((resolve) => { release = resolve })
  const active = Effect.runPromise(CodePuppyProjectGate.observe(f.project, "agent", Effect.promise(async () => {
    await waiting
    CodePuppyProjectGate.frontmatter(f.project, path.join(f.project, "agents/a.md"), "---javascript\n({})\n---\nbody", "agent")
  })))
  await Bun.sleep(1)
  await Effect.runPromise(entriesOf(f))
  expect(CodePuppyProjectGate.view(f.project)?.points.agent).toBe("pending")
  release()
  await active
  expect(CodePuppyProjectGate.view(f.project)?.points.agent).toBe("done")
  expect(CodePuppyProjectGate.view(f.project)?.withheld).toContainEqual({ kind: "frontmatter-code", name: "agents/a.md", file: "agents/a.md" })
}))

it.live("审查2:constructor / toString / __proto__ 顶层键按未知键丢弃,不崩溃、不列清单", () => run(async () => {
  await using f = await fixture({ "home/work/project/opencode.json": '{"constructor":{"a":{"b":1}},"toString":{"x":1},"__proto__":{"x":1},"instructions":["NOTES.md"]}' })
  CodePuppyProjectGate.install({ trusted: () => false })
  const info = documentAt(await Effect.runPromise(entriesOf(f)), path.join(f.project, "opencode.json"))!.info
  expect({ ...info }).toEqual({ instructions: ["NOTES.md"] })
  expect(CodePuppyProjectGate.view(f.project)?.withheld).toEqual([])
}))

// ── D6(DESIGN-local-plugin-install §4.6,R-m):原生文件按引用管理 ─────────────────────────────────────────────────────
// 契约 C 的可选钩子由一份假 main 作答(记下来源、交回预设状态);状态只在账本里,源文件从不改写。
type NativeState = import("@opencode/schema/codepuppy-project-config").NativeFileState
type NativeSource = import("@opencode/schema/codepuppy-project-config").NativeFileSource
function nativeMain(states: NativeState[]) {
  const calls: NativeSource[][] = []
  return {
    calls,
    states,
    fail: false,
    sync(input: { directory: string; sources: NativeSource[] }) {
      calls.push(input.sources)
      return Promise.resolve(this.fail ? undefined : this.states)
    },
  }
}
const off = (file: string, kind: NativeState["kind"], entry: string, extra: Partial<NativeState> = {}): NativeState => ({ file, kind, entry, desiredState: "disabled", removed: false, ...extra })
const readAgents = (f: Fixture, entries: Entry[]) =>
  Effect.gen(function* () {
    const agents = yield* Agent.Service
    yield* ConfigAgentPlugin.Plugin.effect(host({ location: location({ directory: AbsolutePath.make(f.project) }), agent: agentHost(agents) })).pipe(Effect.provide(Config.testLayer(entries)))
    return (yield* agents.list()).map((item) => String(item.id))
  }).pipe(Effect.scoped, Effect.provide(AppNodeBuilder.build(LayerNode.group([Agent.node, Bus.node, FSUtil.node, Global.node]))))

describe("D6 原生文件来源", () => {
  const projectFiles = {
    "home/work/project/opencode.json": {
      mcp: { servers: { keep: { type: "local", command: ["keep"] }, off: { type: "local", command: ["off"] } } },
      agents: { inlinekeep: { system: "k" }, inlineoff: { system: "o" } },
      commands: { ckeep: { template: "k" }, coff: { template: "o" } },
    },
    "home/work/project/.opencode/plugins/off.js": "throw new Error('disabled native plugin executed')",
    "home/work/project/.opencode/plugins/on.js": "export default {}",
    "home/work/project/.opencode/agents/fileoff.md": "---\ndescription: off\n---\nOFF",
    "home/work/project/.opencode/agents/filekeep.md": "---\ndescription: keep\n---\nKEEP",
    "home/work/project/.opencode/commands/cmdoff.md": "OFF",
    "home/work/project/.opencode/commands/cmdkeep.md": "KEEP",
  }

  it.live("native file view filters disabled entries and keeps siblings", () => run(async () => {
    await using f = await fixture(projectFiles)
    const doc = path.join(f.project, "opencode.json")
    const dir = path.join(f.project, ".opencode")
    const main = nativeMain([
      off(doc, "mcp", "off"),
      off(doc, "agent", "inlineoff"),
      off(doc, "command", "coff", { desiredState: "enabled", removed: true }),
      off(path.join(dir, "plugins/off.js"), "plugin", "off.js", { target: path.join(dir, "plugins/off.js") }),
      off(path.join(dir, "agents/fileoff.md"), "agent", "fileoff"),
      off(path.join(dir, "commands/cmdoff.md"), "command", "cmdoff"),
      off(path.join(dir, "skills/off/SKILL.md"), "skill", "off"),
    ])
    CodePuppyProjectGate.install({ trusted: () => true, nativeSources: (input) => main.sync(input) })
    const entries = await Effect.runPromise(entriesOf(f))
    const info = documentAt(entries, doc)!.info
    expect(info.mcp?.servers?.off?.disabled).toBe(true)
    expect(info.mcp?.servers?.keep?.disabled).toBeUndefined()
    expect(Object.keys(info.agents ?? {})).toEqual(["inlinekeep"])
    expect(Object.keys(info.commands ?? {})).toEqual(["ckeep"])
    const policies = ManagedPolicy.statements(entries)
    expect(ManagedPolicy.decision(policies, "plugin.use", path.join(dir, "plugins/off.js"))).toBe("deny")
    expect(ManagedPolicy.decision(policies, "plugin.use", path.join(dir, "plugins/on.js"))).toBe("allow")
    // 文档级来源整份交给 main,带原生声明状态;源文件字节不变
    expect(main.calls[0]).toContainEqual({ file: doc, kind: "mcp", entry: "off", active: true })
    expect(main.calls[0]).toContainEqual({ file: path.join(dir, "plugins/on.js"), kind: "plugin", entry: "on.js", target: path.join(dir, "plugins/on.js"), active: true })
    expect(JSON.parse(await fs.readFile(doc, "utf8"))).toEqual(projectFiles["home/work/project/opencode.json"])
    // 目录读取点:关闭的文件按入口拿掉,兄弟文件照常;读完把本点发现的文件来源交给 main
    const agents = await Effect.runPromise(readAgents(f, entries))
    expect(agents).toContain("filekeep")
    expect(agents).toContain("inlinekeep")
    expect(agents).not.toContain("fileoff")
    expect(agents).not.toContain("inlineoff")
    expect(main.calls.at(-1)).toContainEqual({ file: path.join(dir, "agents/fileoff.md"), kind: "agent", entry: "fileoff", active: true })
    const entry = entries.find((item) => item.type === "directory" && item.path === dir)!
    await Effect.runPromise(CodePuppyProjectGate.observe(f.project, "command", Effect.sync(() => {
      expect(CodePuppyProjectGate.markdown(f.project, entry, "command")(path.join(dir, "commands/cmdoff.md"), "OFF")).toBeUndefined()
      expect(CodePuppyProjectGate.markdown(f.project, entry, "command")(path.join(dir, "commands/cmdkeep.md"), "KEEP")).toBe("KEEP")
    })))
    expect(main.calls.at(-1)?.map((source) => source.entry)).toEqual(["cmdoff", "cmdkeep"])
    expect(CodePuppyProjectGate.nativeSkill(f.project, path.join(dir, "skills/off/SKILL.md"), "off")).toBe(false)
    expect(CodePuppyProjectGate.nativeSkill(f.project, path.join(dir, "skills/keep/SKILL.md"), "keep")).toBe(true)
    // 反向臂:没有钩子 ⇒ 原生声明全部生效
    CodePuppyProjectGate.install({ trusted: () => true })
    const plain = await Effect.runPromise(entriesOf(f))
    expect(documentAt(plain, doc)!.info.mcp?.servers?.off?.disabled).toBeUndefined()
    expect(Object.keys(documentAt(plain, doc)!.info.commands ?? {})).toEqual(["ckeep", "coff"])
    expect(await Effect.runPromise(readAgents(f, plain))).toContain("fileoff")
  }))

  it.live("native states follow the last answer: first load without one uses declarations, a later failure keeps the previous states", () => run(async () => {
    await using f = await fixture(projectFiles)
    const doc = path.join(f.project, "opencode.json")
    const main = nativeMain([off(doc, "mcp", "off")])
    main.fail = true
    CodePuppyProjectGate.install({ trusted: () => true, nativeSources: (input) => main.sync(input) })
    expect(documentAt(await Effect.runPromise(entriesOf(f)), doc)!.info.mcp?.servers?.off?.disabled).toBeUndefined()
    main.fail = false
    expect(documentAt(await Effect.runPromise(entriesOf(f)), doc)!.info.mcp?.servers?.off?.disabled).toBe(true)
    main.fail = true
    expect(documentAt(await Effect.runPromise(entriesOf(f)), doc)!.info.mcp?.servers?.off?.disabled).toBe(true)
  }))

  it.live("untrusted project native plugins are bound from their declaration while the trust gate still withholds them", () => run(async () => {
    await using f = await fixture({ "home/work/project/.opencode/plugins/notify.js": "throw new Error('unallowed plugin executed')" })
    const target = path.join(f.project, ".opencode/plugins/notify.js")
    const main = nativeMain([])
    CodePuppyProjectGate.install({ trusted: () => false, nativeSources: (input) => main.sync(input) })
    const entries = await Effect.runPromise(entriesOf(f))
    expect(main.calls[0]).toContainEqual({ file: target, kind: "plugin", entry: "notify.js", target, active: true })
    expect(ManagedPolicy.decision(ManagedPolicy.statements(entries), "plugin.use", target)).toBe("deny")
    CodePuppyProjectGate.install({ trusted: () => true, nativeSources: (input) => main.sync(input) })
    expect(ManagedPolicy.decision(ManagedPolicy.statements(await Effect.runPromise(entriesOf(f))), "plugin.use", target)).toBe("allow")
  }))
})

// 评审 Minor 3(design §4.6:288):系统 / MDM 目录与 HTTP 技能索引维持今天的行为 —— 不成为可开关的原生来源。
describe("D6 原生来源不纳管系统目录与技能索引", () => {
  it.live("system config directory entries stay outside native bindings", () => run(async () => {
    await using f = await fixture({
      "system/plugins/sys.js": "export default {}",
      "system/skills/sys/SKILL.md": "---\nname: sys\ndescription: managed\n---\nbody\n",
      "home/work/project/.opencode/plugins/own.js": "export default {}",
    })
    const system = path.join(f.root, "system")
    const sysPlugin = path.join(system, "plugins/sys.js")
    const sysSkill = path.join(system, "skills/sys/SKILL.md")
    const main = nativeMain([off(sysPlugin, "plugin", "sys.js", { target: sysPlugin }), off(sysSkill, "skill", "sys")])
    CodePuppyProjectGate.install({ trusted: () => true, nativeSources: (input) => main.sync(input) })
    const entries = await Effect.runPromise(Effect.gen(function* () {
      const config = yield* Config.Service
      return yield* config.entries()
    }).pipe(Effect.provide(configLayer(f.project, f.global, f.home, system))))
    expect(main.calls.flat().some((source) => source.file.startsWith(system + path.sep))).toBe(false)
    expect(main.calls.flat().some((source) => source.entry === "own.js")).toBe(true)
    expect(ManagedPolicy.decision(ManagedPolicy.statements(entries), "plugin.use", sysPlugin)).toBe("allow")
    expect(CodePuppyProjectGate.nativeSkill(f.project, sysSkill, "sys")).toBe(true)
  }))

  it.live("skills pulled from an HTTP skill index are not native bindings", () => run(async () => {
    await using f = await fixture({
      "cache/indexed/SKILL.md": "---\nname: indexed\ndescription: from index\n---\nbody\n",
      "home/work/project/local/mine/SKILL.md": "---\nname: mine\ndescription: local\n---\nbody\n",
    })
    const cached = path.join(f.root, "cache/indexed")
    const local = path.join(f.project, "local")
    const main = nativeMain([off(path.join(cached, "SKILL.md"), "skill", "indexed")])
    CodePuppyProjectGate.install({ trusted: () => true, nativeSources: (input) => main.sync(input) })
    await Effect.runPromise(entriesOf(f))
    const { ConfigSkillPlugin } = await import("@opencode/core/config/plugin/skill")
    const { SkillDiscovery } = await import("@opencode/core/skill/discovery")
    const { Skill: SkillService } = await import("@opencode/core/skill")
    const { Watcher } = await import("@opencode/core/filesystem/watcher")
    const { Info: ConfigInfo } = await import("@opencode/schema/config")
    const { Schema } = await import("effect")
    const document = new (await import("@opencode/schema/config")).Document({ type: "document", info: Schema.decodeUnknownSync(ConfigInfo)({ skills: [local, "https://example.test/skills/"] }) })
    const ids = await Effect.runPromise(Effect.gen(function* () {
      const service = yield* SkillService.Service
      yield* ConfigSkillPlugin.Plugin.effect(host({ location: location({ directory: AbsolutePath.make(f.project) }), skill: { list: () => Effect.die("unused"), transform: service.transform, reload: service.reload } })).pipe(
        Effect.provide(Config.testLayer([document])),
        Effect.provideService(SkillDiscovery.Service, SkillDiscovery.Service.of({ pull: () => Effect.succeed([AbsolutePath.make(cached)]) })),
        Effect.provideService(Location.Service, Location.Service.of(location({ directory: AbsolutePath.make(f.project) }))),
      )
      return (yield* service.list()).map((item) => String(item.id))
    }).pipe(Effect.scoped, Effect.provide(Layer.merge(AppNodeBuilder.build(LayerNode.group([SkillService.node, Bus.node, FSUtil.node, Global.node])), Watcher.testLayer))))
    expect(ids.sort()).toEqual(["indexed", "mine"])
    expect(main.calls.flat().some((source) => source.entry === "indexed")).toBe(false)
    expect(main.calls.flat().some((source) => source.entry === "mine")).toBe(true)
  }))
})
