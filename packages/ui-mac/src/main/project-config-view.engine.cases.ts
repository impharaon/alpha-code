// #1713:复用段 0 / 段 2 的实际 OpenCode 配置与 md 样本,沙箱真引擎 → sidecar 作答 → 生产视图。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
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
import { buildProjectConfigViewRequest, createProjectConfigViewRequester } from "./project-config-view-message"
import { projectExecutableRows } from "./codepuppy-ext-trust"
import { engineProjectTrust } from "./engine-project-trust"
const trustReads = new Map<string, number>()
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { createEngineFetch } from "../engine-adapter"
import { WITHHELD_KINDS, type NativeFileState } from "@opencode/schema/codepuppy-project-config"
import { codepuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import { testNativeMain } from "../../test-component/codepuppy-engine"
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

test("审查9:符号链接路由换 realpath 会多建 Location 并再启全局 MCP;原拼写请求不增加", async () => {
  const host = codepuppyEngine({ sandbox, name: "symlink-view", modelBaseURL: model.baseURL })
  const marker = path.join(sandbox.root, "symlink-mcp-starts")
  write(path.join(host.slot.configDirectory, "opencode.json"), JSON.stringify({ mcp: { servers: { global: { type: "local", command: [process.execPath, MCP_FIXTURE], environment: { CODEPUPPY_MCP_STARTUP_LOG: marker } } } } }))
  const running = await host.start()
  const starts = () => fs.readFileSync(marker, "utf8").split("+").length - 1
  const locations = async () => (await (await running.fetch(new Request("http://codepuppy-sidecar.invalid/api/debug/location"))).json()) as Array<{ directory: string }>
  try {
    const canonical = path.join(sandbox.root, "linked-project")
    const route = path.join(sandbox.root, "linked-route")
    write(path.join(canonical, "opencode.json"), JSON.stringify({ shell: "/bin/sh" }))
    fs.symlinkSync(canonical, route)
    expect((await read(route, running)).ok).toBe(true)
    for (let i = 0; i < 100 && starts() < 2; i++) await Bun.sleep(20)
    const before = starts()
    const book = createProjectConfigViewRequester((request) => { void answerProjectConfigView(request, { fetch: running.fetch, view: projectConfigView }).then((reply) => book.receive(reply)) })
    const view = await book.request(route)
    const same = (await locations()).filter((item) => [route, canonical].includes(item.directory))
    expect(same.map((item) => item.directory)).toEqual([route])
    expect(starts()).toBe(before)
    // 旧路径的反向臂:相同物理目录换拼写,引擎按路由新建第二个 Location。
    expect((await read(canonical, running)).ok).toBe(true)
    const both = (await locations()).filter((item) => [route, canonical].includes(item.directory))
    expect(both).toHaveLength(2)
    for (let i = 0; i < 100 && starts() < before + 1; i++) await Bun.sleep(20)
    expect(starts()).toBe(before + 1)
    expect(view).toMatchObject({ directory: canonical, complete: true })
    book.close()
  } finally { await running.close() }
}, 30_000)

test("审查10:桌面适配器未选 agent 创建会话时,不选项目名字最前的 md agent", async () => {
  const directory = path.join(sandbox.root, "default-agent-probe")
  write(path.join(directory, ".opencode/agents/000-first.md"), "---\ndescription: project default selection probe\n---\nPROJECT-ONLY-PROMPT")
  const listed = await engine.fetch(new Request("http://codepuppy-sidecar.invalid/api/agent", { headers: { "x-opencode-directory": encodeURIComponent(directory) } }))
  const agents = (await listed.json()).data as Array<{ id: string; mode: string; system?: string }>
  expect(agents.find((agent) => agent.id === "000-first")).toMatchObject({ mode: "primary", system: "PROJECT-ONLY-PROMPT" })
  expect(agents.map((agent) => agent.id).sort()[0]).toBe("000-first")
  const origin = new URL(engine.url).origin
  const engineHttp = ((input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    request.headers.set("authorization", engine.authorization)
    return fetch(request)
  }) as typeof fetch
  const engineFetch = createEngineFetch({ isEngineOrigin: (candidate) => candidate === origin, fetch: engineHttp })
  const client = createOpencodeClient({ baseUrl: origin, fetch: engineFetch as typeof fetch })
  // use-projects startChat 与既有 default-agent.engine.cases.ts 的真实入口,不传 agent。
  const created = await client.session.create({ directory } as never)
  expect(created.error).toBeUndefined()
  expect(created.data?.id).toBeDefined()
  // 新建时 agent 尚未固定;界面首轮同样不传 agent,在执行后观察选择。
  const sent = await client.session.promptAsync({ sessionID: created.data!.id, directory, parts: [{ type: "text", text: "hello" }], providerID: "codepuppy", modelID: "m" } as never)
  expect(sent.error).toBeUndefined()
  const idle = await engine.fetch(new Request(`http://codepuppy-sidecar.invalid/api/experimental/session/${created.data!.id}/wait`, { method: "POST", headers: { "x-opencode-directory": encodeURIComponent(directory) } }))
  expect(idle.ok).toBe(true)
  const response = await engine.fetch(new Request(`http://codepuppy-sidecar.invalid/api/session/${created.data!.id}/message?order=asc&limit=200`, { headers: { "x-opencode-directory": encodeURIComponent(directory) } }))
  const messages = (await response.json()).data as Array<{ type: string; agent?: string }>
  const agentsUsed = messages.filter((message) => message.type === "assistant").map((message) => message.agent)
  expect(agentsUsed).toEqual(["build"])
  expect(agentsUsed).not.toContain("000-first")
})

// ── D6(DESIGN-local-plugin-install §4.6,R-m / R-n):原生文件来源按引用管理 ──────────────────────────────────────────────
// 这一组自己起一台像 sidecar 那样装了契约 C 原生来源钩子的引擎(闸门安装是进程级的,前面几条用例的宿主不带钩子):真 ext 的
// hub bridge 经 parentPort 问 main,main 的作答是生产的 syncNativeSourcesV2;继承开关按已开启(R-n 的前提)。
// 定制中心的动作在 6b;这里直接调同一个账本写者 setNativeSourceStateV2,再经引擎自己的 location/reload 生效。
let native: Running
let nativeHost: ReturnType<typeof codepuppyEngine>
const at = async (directory: string, route: string, method = "GET") =>
  (await (await native.fetch(new Request(`http://codepuppy-sidecar.invalid${route}`, { method, headers: { "x-opencode-directory": encodeURIComponent(directory) } }))).json()) as { data?: Array<Record<string, any>> }
const names = async (directory: string, route: string) => ((await at(directory, route)).data ?? []).map((item) => String(item.name ?? item.id))
const bindings = () => (JSON.parse(fs.readFileSync(path.join(codepuppyBootstrap().paths.globalRoot, "installs.json"), "utf8")).nativeSources ?? []) as NativeFileState[]
const binding = (kind: NativeFileState["kind"], entry: string) => {
  const found = bindings().find((item) => item.kind === kind && item.entry === entry)
  if (!found) throw new Error(`no ${kind} binding ${entry}: ${JSON.stringify(bindings())}`)
  return found
}
// 定制中心的写通道 body(ext-ipc 的 setNativeSourceState 就是这一个函数),经它写账本
const act = async (state: NativeFileState, action: "enable" | "disable" | "remove" | "rejoin") => {
  const written = await testNativeMain().setState({ file: state.file, kind: state.kind, entry: state.entry, ...(state.target ? { target: state.target } : {}), action })
  if (!written.ok) throw new Error(written.reason)
}
const reloadAll = async () => {
  const reply = await native.fetch(new Request("http://codepuppy-sidecar.invalid/api/location/reload", { method: "POST" }))
  expect(reply.ok).toBe(true)
}
const until = async (check: () => Promise<boolean>, label: string) => {
  for (let i = 0; i < 100; i++) if (await check()) return
  else await Bun.sleep(100)
  throw new Error(`timed out waiting for ${label}`)
}

describe("D6 native file sources", () => {
beforeAll(async () => {
  nativeHost = codepuppyEngine({ sandbox, name: "native-view", modelBaseURL: model.baseURL, filewatcher: true, nativeSources: true, switches: { ecosystemInherit: true } })
  native = await nativeHost.start()
})
afterAll(async () => {
  await native?.close()
})

test("hub switch stops a native skill, command, agent, plugin and MCP in place; removed entries stay out after an edit and rejoin in place", async () => {
  const directory = path.join(sandbox.root, "native-switch")
  const probe = path.join(sandbox.root, "native-plugin-loads")
  const files: Record<string, string> = {
    "opencode.json": JSON.stringify({ mcp: { servers: { natmcp: { type: "local", command: [process.execPath, MCP_FIXTURE] } } } }),
    ".opencode/skills/natskill/SKILL.md": "---\nname: natskill\ndescription: native skill\n---\nsee ../shared/notes.md\n",
    ".opencode/skills/sibling/SKILL.md": "---\nname: sibling\ndescription: stays\n---\nbody\n",
    ".opencode/commands/natcmd.md": "run native",
    ".opencode/agents/natagent.md": "---\ndescription: native agent\nmode: subagent\n---\nA",
    ".opencode/plugins/natplug.js": `import fs from "node:fs"\nfs.appendFileSync(${JSON.stringify(probe)}, "loaded\\n")\nexport default { id: "natplug.test", setup: async () => {} }\n`,
    ".claude/skills/inherited/SKILL.md": "---\nname: inherited\ndescription: claude skill\n---\nbody\n",
  }
  for (const [file, text] of Object.entries(files)) write(path.join(directory, file), text)
  allowProject(directory)
  const plugins = async () => ((await at(directory, "/api/plugin")).data ?? []).filter((item) => item.id === "natplug.test" && item.state?.status === "active").length
  const mcpStatus = async () => ((await at(directory, "/api/mcp")).data ?? []).find((item) => item.name === "natmcp")?.status?.status
  await until(async () => (await names(directory, "/api/skill")).includes("natskill") && (await names(directory, "/api/agent")).includes("natagent") && (await plugins()) === 1, "native entries to load")
  expect(await names(directory, "/api/command")).toContain("natcmd")
  expect(await names(directory, "/api/skill")).toEqual(expect.arrayContaining(["sibling", "inherited"]))
  expect(await mcpStatus()).not.toBe("disabled")
  // 来源按原生声明开启绑定;Code Puppy 自己的显式层(出厂 /init、/review)不当原生来源
  for (const [kind, entry] of [["skill", "natskill"], ["command", "natcmd"], ["agent", "natagent"], ["plugin", "natplug.js"], ["mcp", "natmcp"], ["skill", "inherited"]] as const)
    expect(binding(kind, entry)).toMatchObject({ desiredState: "enabled", removed: false })
  expect(bindings().some((item) => item.kind === "command" && (item.entry === "init" || item.entry === "review"))).toBe(false)
  // 定制中心读到的行:项目里的条目在「本项目」并写相对目录;继承的 .claude 技能也是这一项目的
  const listed = async () => await testNativeMain().rows(directory)
  expect((await listed()).find((row) => row.entry === "natskill")).toMatchObject({ scope: "project", directoryLabel: ".opencode", removed: false })
  expect((await listed()).find((row) => row.entry === "inherited")).toMatchObject({ scope: "project", directoryLabel: ".claude/skills" })
  const loads = fs.readFileSync(probe, "utf8").length

  await act(binding("skill", "natskill"), "remove")
  await act(binding("skill", "inherited"), "disable")
  await act(binding("command", "natcmd"), "disable")
  await act(binding("agent", "natagent"), "disable")
  await act(binding("plugin", "natplug.js"), "disable")
  await act(binding("mcp", "natmcp"), "disable")
  await reloadAll()
  await until(async () => !(await names(directory, "/api/skill")).includes("natskill") && (await mcpStatus()) === "disabled", "native entries to stop")
  expect(await names(directory, "/api/skill")).toContain("sibling")
  expect(await names(directory, "/api/skill")).not.toContain("inherited")
  expect(await names(directory, "/api/command")).not.toContain("natcmd")
  expect(await names(directory, "/api/agent")).not.toContain("natagent")
  expect(await plugins()).toBe(0)
  expect(fs.readFileSync(probe, "utf8").length).toBe(loads)

  // 原处编辑:引擎原 watcher 重新扫描,同一绑定仍按 removed 不加载
  write(path.join(directory, ".opencode/skills/natskill/SKILL.md"), "---\nname: natskill\ndescription: edited\n---\nedited\n")
  await Bun.sleep(1500)
  expect(await names(directory, "/api/skill")).not.toContain("natskill")
  expect(bindings().filter((item) => item.kind === "skill" && item.entry === "natskill")).toEqual([expect.objectContaining({ removed: true })])
  expect((await listed()).find((row) => row.entry === "natskill")).toMatchObject({ removed: true })

  await act(binding("skill", "natskill"), "rejoin")
  await act(binding("skill", "inherited"), "enable")
  await act(binding("command", "natcmd"), "enable")
  await act(binding("agent", "natagent"), "enable")
  await act(binding("plugin", "natplug.js"), "enable")
  await act(binding("mcp", "natmcp"), "enable")
  await reloadAll()
  await until(async () => (await names(directory, "/api/skill")).includes("natskill") && (await plugins()) === 1, "native entries to rejoin")
  expect(await names(directory, "/api/skill")).toContain("inherited")
  expect(await names(directory, "/api/command")).toContain("natcmd")
  expect(await names(directory, "/api/agent")).toContain("natagent")
  expect(await mcpStatus()).not.toBe("disabled")
  // 来源文件从未被改写(编辑是用户自己做的那一次)
  for (const [file, text] of Object.entries(files)) if (file !== ".opencode/skills/natskill/SKILL.md") expect(fs.readFileSync(path.join(directory, file), "utf8")).toBe(text)
}, 90_000)

test("untrusted project native plugin stays off while a global enabled native skill works, and trust is not recorded as a user switch", async () => {
  const directory = path.join(sandbox.root, "native-untrusted")
  const probe = path.join(sandbox.root, "native-untrusted-plugin-loads")
  write(path.join(directory, ".opencode/plugins/projplug.js"), `import fs from "node:fs"\nfs.appendFileSync(${JSON.stringify(probe)}, "loaded\\n")\nexport default { id: "projplug.test", setup: async () => {} }\n`)
  write(path.join(nativeHost.slot.configDirectory, "skills/globalnative/SKILL.md"), "---\nname: globalnative\ndescription: global\n---\nbody\n")
  await until(async () => (await names(directory, "/api/skill")).includes("globalnative"), "the global native skill")
  expect(fs.existsSync(probe)).toBe(false)
  expect(binding("plugin", "projplug.js")).toMatchObject({ desiredState: "enabled", removed: false })
  allowProject(directory)
  await reloadAll()
  await until(async () => fs.existsSync(probe), "the allowed project plugin to load")
  expect(binding("plugin", "projplug.js")).toMatchObject({ desiredState: "enabled", removed: false })
}, 60_000)
})
