// #1713:复用段 0 / 段 2 的实际 OpenCode 配置与 md 样本,沙箱真引擎 → sidecar 作答 → 生产视图。
import { afterAll, beforeAll, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import {
  allowProject,
  codepuppyEngine,
  scriptedModel,
  MCP_FIXTURE,
  type Running,
} from "../../test-component/codepuppy-engine"
let projectConfigView: (typeof import("../../engine/engine-embed"))["projectConfigView"]
import { answerProjectConfigView } from "./sidecar-project-config-view"
import { buildProjectConfigViewRequest } from "./project-config-view-message"
import { projectExecutableRows } from "./codepuppy-ext-trust"
import { engineProjectTrust } from "./engine-project-trust"
const trustReads = new Map<string, number>()
import { WITHHELD_KINDS } from "@opencode/schema/codepuppy-project-config"
const sandbox = engineSandbox()
const model = scriptedModel()
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
let engine: Running
let allowed = ""
const unallowed = path.join(sandbox.root, "view-unallowed")
const content = path.join(sandbox.root, "view-content")
const read = (directory: string, running = engine) =>
  answerProjectConfigView(buildProjectConfigViewRequest("view", directory), {
    fetch: running.fetch,
    view: projectConfigView,
    timeoutMs: 15_000,
  })
beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  const embedded = await import("../../engine/engine-embed")
  projectConfigView = embedded.projectConfigView
  const host = codepuppyEngine({ sandbox, name: "project-view", modelBaseURL: model.baseURL, filewatcher: true, projectTrust: (directory) => { trustReads.set(directory, (trustReads.get(directory) ?? 0) + 1); return engineProjectTrust(directory) } })
  allowed = host.projectDirectory
  allowProject(allowed)
  write(
    path.join(unallowed, "opencode.json"),
    JSON.stringify({
      mcp: { servers: { github: { type: "local", command: [process.execPath, MCP_FIXTURE] } } },
        agents: { translator: { mode: "primary", model: "test/m", system: "text" } },
      commands: { commit: { template: "commit !`printf probe`", model: "test/m", subtask: true } },
      formatter: { prettier: { command: ["prettier"], extensions: [".ts"] } },
      shell: "/opt/homebrew/bin/fish",
      providers: { openai: { package: "file:///missing.mjs" } },
      references: { r: { path: "/tmp" } },
      experimental: { all_flags: true },
    }),
  )
  write(path.join(unallowed, ".opencode/plugins/notify.js"), 'throw new Error("unallowed plugin executed")')
  write(
    path.join(unallowed, ".opencode/agents/helper.md"),
    `---javascript\n(require("node:fs").writeFileSync(${JSON.stringify(path.join(sandbox.root, "frontmatter-probe"))}, "bad"), {})\n---\nTEXT`,
  )
  write(path.join(content, "AGENTS.md"), "plain instructions")
  write(path.join(content, ".opencode/skills/notes/SKILL.md"), "---\nname: notes\ndescription: text\n---\nbody\n")
  engine = await host.start()
})
afterAll(async () => {
  await engine?.close()
  model.stop()
})
test("AC-05 ①:只有 OpenCode 配置也给出九类,名字 / 出处 / 字段齐全且不泄漏值", async () => {
  const reply = await read(unallowed)
  expect(reply.ok).toBe(true)
  if (!reply.ok) return
  expect(reply.view.complete).toBe(true)
  expect(reply.view.points).toEqual({ config: "done", agent: "done", command: "done", skill: "done" })
  for (const kind of WITHHELD_KINDS)
    expect(
      reply.view.withheld.some((item) => item.kind === kind),
      kind,
    ).toBe(true)
  expect(reply.view.withheld).toContainEqual({
    kind: "plugin",
    name: ".opencode/plugins/notify.js",
    file: ".opencode/plugins/notify.js",
  })
  expect(reply.view.withheld).toContainEqual({
    kind: "command-run",
    name: "commit",
    file: "opencode.json",
    fields: ["model", "subtask", "shell"],
  })
  expect(reply.view.withheld).toContainEqual({
    kind: "frontmatter-code",
    name: ".opencode/agents/helper.md",
    file: ".opencode/agents/helper.md",
  })
  expect(JSON.stringify(reply.view)).not.toContain("file:///missing.mjs")
  expect(projectExecutableRows({ mcp: [], plugins: [], agents: [] }, reply.view.withheld)).toEqual([
    "· 连接器(MCP):github", "· 插件:.opencode/plugins/notify.js", "· Agent 的权限与模型设置:translator(模式、模型)",
    "· 命令的运行设置:/commit(运行程序、模型、子任务)", "· 文件开头的脚本:.opencode/agents/helper.md",
    "· 写文件后自动运行的格式化程序:prettier", "· 终端与 shell 使用的程序:/opt/homebrew/bin/fish", "· 模型的接入设置:openai", "· 其他 OpenCode 设置:references、experimental",
  ])
})
test("AC-05 ②:只有 AGENTS.md 与技能 ⇒ 空清单且完整", async () => {
  expect(await read(content)).toMatchObject({ ok: true, view: { trusted: false, complete: true, withheld: [] } })
})
test("AC-07 / AC-04:同一台引擎两个目录各自决定;已允许项目改配置热重载后启动 MCP", async () => {
  expect(await read(allowed)).toMatchObject({ ok: true, view: { trusted: true, complete: true, withheld: [] } })
  expect((await read(unallowed)).ok).toBe(true)
  const marker = path.join(sandbox.root, "view-mcp-started")
  write(
    path.join(allowed, "opencode.json"),
    JSON.stringify({
      mcp: {
        servers: {
          hot: {
            type: "local",
            command: [process.execPath, MCP_FIXTURE],
            environment: { CODEPUPPY_MCP_STARTUP_LOG: marker },
          },
        },
      },
    }),
  )
  for (let i = 0; i < 100 && !fs.existsSync(marker); i++) await Bun.sleep(100)
  expect(fs.existsSync(marker)).toBe(true)
  expect(await read(allowed)).toMatchObject({ ok: true, view: { trusted: true, withheld: [] } })
  const other = await read(unallowed)
  expect(other.ok && other.view.trusted).toBe(false)
  expect(other.ok && other.view.withheld.map((item) => item.kind)).toEqual(expect.arrayContaining([...WITHHELD_KINDS]))
}, 30_000)
test("审查4:新 agent 的 subagent 收窄在文档与 md 的 v1 / v2 生效,已有 agent 模式不变", async () => {
  for (const allowed of [false, true]) {
    const directory = path.join(sandbox.root, `narrow-agent-${allowed}`)
    write(path.join(directory, "opencode.json"), JSON.stringify({
      agent: { doc_v1: { prompt: "v1", mode: "subagent" } },
      agents: { doc_v2: { system: "v2", mode: "subagent" }, build: { mode: "subagent" }, primary: { mode: "primary" }, every: { mode: "all" } },
      mode: { general: { prompt: "namespace", mode: "subagent" } },
    }))
    write(path.join(directory, ".opencode/agents/md_v1.md"), "---\nmode: subagent\ntools: {}\n---\nv1")
    write(path.join(directory, ".opencode/agents/md_v2.md"), "---\nmode: subagent\nsystem: ignored\n---\nv2")
    write(path.join(directory, ".opencode/agents/explore.md"), "---\nmode: primary\n---\nwide")
    write(path.join(directory, ".opencode/modes/dir_mode.md"), "---\nmode: subagent\n---\ndir")
    if (allowed) allowProject(directory)
    const reply = await read(directory)
    const response = await engine.fetch(new Request("http://codepuppy-sidecar.invalid/api/agent", { headers: { "x-opencode-directory": encodeURIComponent(directory) } }))
    const agents = (await response.json()).data as Array<{ id: string; mode: string }>
    for (const id of ["doc_v1", "doc_v2", "md_v1", "md_v2"])
      expect(agents.find((agent) => agent.id === id)?.mode, id).toBe("subagent")
    expect(agents.find((agent) => agent.id === "build")?.mode).toBe(allowed ? "subagent" : "primary")
    expect(agents.find((agent) => agent.id === "general")?.mode).toBe(allowed ? "primary" : "subagent")
    expect(agents.find((agent) => agent.id === "explore")?.mode).toBe(allowed ? "primary" : "subagent")
    expect(agents.find((agent) => agent.id === "dir_mode")?.mode).toBe("primary")
    expect(agents.find((agent) => agent.id === "every")?.mode).toBe(allowed ? "all" : "primary")
    expect(agents.find((agent) => agent.id === "primary")?.mode).toBe("primary")
    if (reply.ok && !allowed) {
      for (const id of ["doc_v1", "doc_v2", "md_v1", "md_v2", "build"])
        expect(reply.view.withheld.filter((item) => item.name === id).flatMap((item) => item.fields ?? []), id).not.toContain("mode")
      for (const id of ["primary", "every", "general", "explore", "dir_mode"])
        expect(reply.view.withheld.filter((item) => item.name === id).flatMap((item) => item.fields ?? []), id).toContain("mode")
    }
  }
})
test("审查3:只有 md argument-hint 与 name 的项目清单为空", async () => {
  const directory = path.join(sandbox.root, "ignored-md-keys")
  write(path.join(directory, ".opencode/commands/x.md"), "---\nargument-hint: input\nvariant: high\n---\nTEXT")
  write(path.join(directory, ".opencode/agents/a.md"), "---\nname: ignored\n---\nTEXT")
  expect(await read(directory)).toMatchObject({ ok: true, view: { complete: true, withheld: [] } })
})
test("审查1:无变化重载后 md 文件头、控制字段与插值仍在视图里", async () => {
  const directory = path.join(sandbox.root, "noop-view")
  const file = path.join(directory, "opencode.json")
  write(file, "{}")
  write(path.join(directory, ".opencode/agents/a.md"), "---\nmodel: test/m\n---\nBODY")
  write(path.join(directory, ".opencode/commands/x.md"), "---\nagent: plan\n---\nhello !`printf probe`")
  write(path.join(directory, ".opencode/skills/notes/SKILL.md"), "---javascript\n({})\n---\nBODY")
  const before = await read(directory)
  expect(before.ok).toBe(true)
  if (!before.ok) return
  expect(before.view.withheld.map((item) => item.kind)).toEqual(expect.arrayContaining(["agent-control", "command-run", "frontmatter-code"]))
  const count = trustReads.get(directory) ?? 0
  write(file, "{}")
  for (let i = 0; i < 100 && (trustReads.get(directory) ?? 0) === count; i++) await Bun.sleep(20)
  expect(trustReads.get(directory) ?? 0).toBeGreaterThan(count)
  const after = await read(directory)
  expect(after).toEqual(before)
}, 15_000)
test("AC-05 ④:用户停用技能读取点不算不完整,项目 MCP 仍列出", async () => {
  const host = codepuppyEngine({ sandbox, name: "view-disabled-skill", modelBaseURL: model.baseURL })
  write(path.join(host.slot.configDirectory, "opencode.json"), JSON.stringify({ plugins: ["-opencode.config.skill"] }))
  write(
    path.join(host.projectDirectory, "opencode.json"),
    JSON.stringify({ mcp: { servers: { srv: { type: "local", command: [process.execPath, MCP_FIXTURE] } } } }),
  )
  const running = await host.start()
  try {
    const reply = await read(host.projectDirectory, running)
    expect(reply.ok).toBe(true)
    if (!reply.ok) return
    expect(reply.view.complete).toBe(true)
    expect(reply.view.points.skill).toBeUndefined()
    expect(reply.view.withheld).toEqual([{ kind: "mcp", name: "srv", file: "opencode.json" }])
  } finally {
    await running.close()
  }
})
