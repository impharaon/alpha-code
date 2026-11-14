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
  const host = codepuppyEngine({ sandbox, name: "project-view", modelBaseURL: model.baseURL, filewatcher: true })
  allowed = host.projectDirectory
  allowProject(allowed)
  write(
    path.join(unallowed, "opencode.json"),
    JSON.stringify({
      mcp: { servers: { github: { type: "local", command: [process.execPath, MCP_FIXTURE] } } },
      plugins: ["./notify"],
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
  expect(other.ok && other.view.withheld.length > 0).toBe(true)
}, 30_000)
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
