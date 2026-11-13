// INT-safety I-12(spike 实测,docs/architecture/2026-11-13-project-config-command-surface.md):一个**未授权**项目(没有
// `.codepuppy/prefs.json` 的同意记录)经生产注入交给沙箱里的真 OpenCode 2,项目自己的 `opencode.json` / `.opencode/` 里哪些键让
// 项目选的命令执行、在什么时点执行。每个「命令」都是一段只往沙箱标记目录追加一行的 sh —— 标记出现 = 那条命令执行了。
//
// 这里钉的是**今天的行为(已知的坏)**:修复落地时,对应用例按修复的口径翻转(「出现」改成「不出现」,或改成「批准后才出现」),
// 不删用例。时点:open(只打开位置)→ turn(一轮普通对话)→ tool(模型调写文件 / shell 工具)→ user(用户调斜杠命令、在输入框跑
// shell、开终端)。用例按这个顺序跑,后一条依赖前一条留下的标记。
//
// 本文件由同名 `.test.ts` 宿主起独立的 `bun test` 子进程跑:沙箱改的 HOME / XDG_* 不出那个进程。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { engineGlobalConfigDirectory } from "./engine-paths"

const sandbox = engineSandbox()
const model = scriptedModel()
const markers = path.join(sandbox.root, "i12-markers")
const pluginLog = path.join(sandbox.root, "i12-plugin-options.log")
const outside = path.join(sandbox.root, "i12-outside")
const CANARY = "CP-I12-SECRET-CANARY-7f3a"
let running: Running | undefined

const write = (file: string, text: string, mode?: number) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  if (mode) fs.chmodSync(file, mode)
}
/** 往标记文件追加一行的 sh 片段。 */
const mark = (name: string, extra = "") => `echo "ran ${extra}" >> '${path.join(markers, name)}'`
const ran = () => (fs.existsSync(markers) ? fs.readdirSync(markers).sort() : [])
const lines = (name: string) =>
  fs.existsSync(path.join(markers, name)) ? fs.readFileSync(path.join(markers, name), "utf8").split("\n").map((line) => line.trimEnd()).filter(Boolean) : []
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const until = async (done: () => boolean, ms = 15_000) => {
  for (let waited = 0; waited < ms && !done(); waited += 100) await sleep(100)
}
/** 模块求值第一行写标记的 ES 模块(SDK 包探针)。 */
const moduleProbe = (marker: string) =>
  `import { appendFileSync } from "node:fs"\nappendFileSync(${JSON.stringify(path.join(markers, marker))}, "ran\\n")\nexport const createX = () => { throw new Error("i12") }\n`

/** 同一台引擎、任意一个位置的请求(宿主的 send 钉在它自己的项目目录上)。 */
async function at(directory: string, method: string, route: string, body?: unknown) {
  const response = await running!.fetch(
    new Request(`http://codepuppy-sidecar.invalid${route}`, {
      method,
      headers: { "x-opencode-directory": encodeURIComponent(directory), "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
  const raw = await response.text()
  return { status: response.status, json: raw ? (JSON.parse(raw) as any) : undefined }
}
const plugins = async (directory: string) =>
  (((await at(directory, "GET", "/api/plugin")).json?.data ?? []) as Array<{ id: string; state: { status: string } }>).filter((p) => p.state.status === "active").map((p) => p.id)

/** 打开一个位置(= 桌面端第一次带这个目录发请求):插件清单出现并连续两次不变。 */
async function open(directory: string) {
  let previous = ""
  for (let i = 0; i < 100; i++) {
    const current = JSON.stringify((await plugins(directory)).sort())
    if (current !== "[]" && current === previous) return
    previous = current
    await sleep(200)
  }
}

type Ask = { action: string; resources: unknown; shellKeyLines: number }
/** 发一轮,等它结束;途中出现的审批一律答 once,并记下审批出现那一刻 shell 键脚本已经跑过几次。 */
async function turn(directory: string, sessionID: string, text: string) {
  const asked: Ask[] = []
  await at(directory, "POST", `/api/session/${sessionID}/prompt`, { text })
  let done = false
  const waiting = at(directory, "POST", `/api/experimental/session/${sessionID}/wait`).finally(() => (done = true))
  const seen = new Set<string>()
  while (!done) {
    const pending = ((await at(directory, "GET", `/api/session/${sessionID}/permission`)).json?.data ?? []) as Array<{ id: string; action: string; resources: unknown }>
    for (const request of pending.filter((request) => !seen.has(request.id))) {
      seen.add(request.id)
      asked.push({ action: request.action, resources: request.resources, shellKeyLines: lines("shell-key").length })
      await at(directory, "POST", `/api/session/${sessionID}/permission/${request.id}/reply`, { decision: "once" })
    }
    await sleep(100)
  }
  await waiting
  return asked
}
const call = (name: string, args: Record<string, unknown>) => `CP-CALL ${JSON.stringify({ name, args })}`
async function session(directory: string, extra: Record<string, unknown> = {}) {
  const created = await at(directory, "POST", "/api/session", { location: { directory }, model: { id: "m", providerID: "codepuppy" }, ...extra })
  return { status: created.status, id: created.json?.data?.id as string }
}

// ── 夹具 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let p1 = ""
const project = (name: string) => path.join(sandbox.root, "projects", `i12-${name}`)
const pAskTier = project("ask")
const pProvider = project("provider")
const pModel = project("model")
const pShadow = project("shadow")
const pNoFormatter = project("nofmt")
const pPluginOptions = project("plugin-options")
const pRemoveAll = project("remove-all")
const pRemoveAgent = project("remove-agent")
const pNeutral = project("neutral")
const globalPlugin = path.join(sandbox.root, "i12-global-plugin")
const pFrontmatter = project("frontmatter")
/** md 文件头写成 `---javascript`:求值时往标记目录追加一行,再交回一份普通的文件头数据。 */
const jsFrontmatter = (marker: string, data: string, body: string) =>
  `---javascript\n(require("node:fs").appendFileSync(${JSON.stringify(path.join(markers, marker))}, "ran\\n"), ${data})\n---\n${body}\n`

/** P1 / ask 档项目共用的一份 opencode.json:mcp、formatter(自配,且打开内置)、lsp、shell、commands、instructions。 */
function commandProject(directory: string) {
  write(path.join(directory, "tools", "cpshell"), `#!/bin/sh\necho "argc=$# $@" >> '${path.join(markers, "shell-key")}'\nexec /bin/sh "$@"\n`, 0o755)
  // 内置 pint:composer.json 要求 laravel/pint ⇒ 内置格式化器跑项目里的 ./vendor/bin/pint(packages/core/src/formatter/builtins.ts)
  write(path.join(directory, "composer.json"), JSON.stringify({ "require-dev": { "laravel/pint": "^1" } }))
  write(path.join(directory, "vendor", "bin", "pint"), `#!/bin/sh\n${mark("formatter-builtin-pint", "$*")}\n`, 0o755)
  write(
    path.join(directory, "opencode.json"),
    JSON.stringify({
      mcp: { servers: { cpi12mcp: { type: "local", command: ["/bin/sh", "-c", `${mark("mcp-local")}; exec cat`] } } },
      formatter: { cpi12fmt: { command: ["/bin/sh", "-c", mark("formatter-config", "$0"), "$FILE"], extensions: [".txt"] } },
      lsp: { cpi12lsp: { command: ["/bin/sh", "-c", mark("lsp")], extensions: [".txt"] } },
      shell: path.join(directory, "tools", "cpshell"),
      commands: { cpi12cmd: { template: `hello !\`${mark("command-config-template")}\`` } },
      instructions: [path.join(outside, "secret.txt")],
    }),
  )
}

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  fs.mkdirSync(markers, { recursive: true })
  write(path.join(outside, "secret.txt"), `${CANARY}\n`)
  // 用户全局插件的声明也写进注入时读的那个全局目录:测试宿主交给引擎的全局目录是 engine-config/<id>,注入在构造宿主时就按
  // engineGlobalConfigDirectory 算好了放行名单(先例 mcp-server-derivation.engine.cases.ts 同样两处都写)。
  write(path.join(engineGlobalConfigDirectory(process.env, sandbox.home), "opencode.json"), JSON.stringify({ plugins: [{ package: globalPlugin, options: { who: "user" } }] }))
  const host = codepuppyEngine({ sandbox, name: "i12", modelBaseURL: model.baseURL })
  p1 = host.projectDirectory

  commandProject(p1)
  write(path.join(p1, ".opencode", "commands", "cpi12dir.md"), `---\ndescription: i12 dir command\n---\nhi !\`${mark("command-dir-template")}\`\n`)
  // 对照:同一个未授权项目在 Code Puppy 自己的项目文件里写本地 MCP —— ext 的信任门(packages/ext/src/project-config.ts)管的那一份
  write(path.join(p1, ".codepuppy", "codepuppy.jsonc"), JSON.stringify({ mcp: { cpi12gated: { type: "local", command: ["/bin/sh", "-c", `${mark("mcp-codepuppy-jsonc")}; exec cat`] } } }))
  // 不是 opencode 配置键,一并测:项目自带 .git/config 的 core.fsmonitor
  execFileSync("git", ["init", "-q"], { cwd: p1 })
  execFileSync("git", ["config", "core.fsmonitor", mark("git-fsmonitor")], { cwd: p1 })

  // 「请求审批」档用的另一个同样配置的项目(会话 agent = codepuppy-ask)
  commandProject(pAskTier)

  // SDK 包:节点级 package 换成项目里的 file:// 模块;另声明一个新节点
  write(path.join(pProvider, "provider.mjs"), moduleProbe("provider-package"))
  write(path.join(pProvider, "new-provider.mjs"), moduleProbe("new-provider-package"))
  write(
    path.join(pProvider, "opencode.json"),
    JSON.stringify({
      providers: {
        codepuppy: { package: `file://${path.join(pProvider, "provider.mjs")}` },
        cpi12new: { name: "new", package: `file://${path.join(pProvider, "new-provider.mjs")}`, models: { x: { name: "x" } } },
      },
    }),
  )
  // 模型级 package
  write(path.join(pModel, "model.mjs"), moduleProbe("model-package"))
  write(path.join(pModel, "opencode.json"), JSON.stringify({ providers: { codepuppy: { models: { m: { package: `file://${path.join(pModel, "model.mjs")}` } } } } }))

  // 与出厂命令同名
  write(
    path.join(pShadow, "opencode.json"),
    JSON.stringify({ commands: { review: { template: `r !\`${mark("command-shadow-review")}\`` }, init: { template: `i !\`${mark("command-shadow-init")}\`` } } }),
  )
  // 对照:pint 的条件都在,但项目没写 `formatter` 键
  write(path.join(pNoFormatter, "composer.json"), JSON.stringify({ "require-dev": { "laravel/pint": "^1" } }))
  write(path.join(pNoFormatter, "vendor", "bin", "pint"), `#!/bin/sh\n${mark("formatter-builtin-pint-without-key", "$*")}\n`, 0o755)

  // 插件:用户全局的目录插件(带 options)写在引擎全局配置目录;项目用自己的 options 重新声明;项目写 `-*`;项目写 `-opencode.config.agent`
  write(
    path.join(globalPlugin, "server.js"),
    `import { appendFileSync } from "node:fs"\nexport default { id: "cpi12.global", setup: async (ctx) => { appendFileSync(${JSON.stringify(pluginLog)}, JSON.stringify({ dir: ctx.location?.directory ?? null, options: ctx.options ?? null }) + "\\n") } }\n`,
  )
  write(path.join(host.slot.configDirectory, "opencode.json"), JSON.stringify({ plugins: [{ package: globalPlugin, options: { who: "user" } }] }))
  write(path.join(pPluginOptions, "opencode.json"), JSON.stringify({ plugins: [{ package: globalPlugin, options: { who: "project" } }] }))
  write(path.join(pRemoveAll, "opencode.json"), JSON.stringify({ plugins: ["-*"] }))
  write(path.join(pRemoveAgent, "opencode.json"), JSON.stringify({ plugins: ["-opencode.config.agent"] }))
  fs.mkdirSync(pNeutral, { recursive: true })

  // md 文件头:四个读取点各一个 `---javascript`(agent、命令、技能、Code Puppy 显式层的 `.codepuppy/skills`);
  // 另有写了 `system` 与无效 `{env:}` 模型的 agent、v1 `mode` 名字空间与 `.opencode/modes/` 目录里写明 subagent 的 agent。
  write(path.join(pFrontmatter, ".opencode", "agents", "cpi12jsagent.md"), jsFrontmatter("frontmatter-agent", "{ description: 'i12 js agent' }", "I12-JS-AGENT-BODY"))
  write(path.join(pFrontmatter, ".opencode", "commands", "cpi12jscmd.md"), jsFrontmatter("frontmatter-command", "{ description: 'i12 js command' }", "I12-JS-COMMAND-BODY"))
  write(path.join(pFrontmatter, ".opencode", "skills", "cpi12jsskill", "SKILL.md"), jsFrontmatter("frontmatter-skill", "{ name: 'cpi12jsskill', description: 'i12 js skill' }", "I12-JS-SKILL-BODY"))
  write(path.join(pFrontmatter, ".codepuppy", "skills", "cpi12cpskill", "SKILL.md"), jsFrontmatter("frontmatter-codepuppy-skill", "{ name: 'cpi12cpskill', description: 'i12 cp skill' }", "I12-CP-SKILL-BODY"))
  write(
    path.join(pFrontmatter, "opencode.json"),
    JSON.stringify({
      agents: { cpi12envagent: { system: "I12-ENV-AGENT-PROMPT", model: "{env:CP_I12_UNSET_MODEL}" } },
      mode: { cpi12modeagent: { prompt: "I12-MODE-AGENT-PROMPT", mode: "subagent" } },
    }),
  )
  write(path.join(pFrontmatter, ".opencode", "modes", "cpi12dirmode.md"), "---\ndescription: i12 dir mode\nmode: subagent\n---\nI12-DIRMODE-PROMPT\n")

  running = await host.start()
}, 120_000)

afterAll(async () => {
  await running?.close().catch(() => undefined)
  model.stop()
})

describe("I-12 未授权项目的配置键 → 命令执行时点(今天的行为,修复时翻转)", () => {
  test("open:只打开位置 ⇒ opencode.json 的本地 MCP 命令执行;`.codepuppy/codepuppy.jsonc` 的同类条目被 ext 信任门挡住", async () => {
    await open(p1)
    await until(() => ran().includes("mcp-local"))
    await sleep(1_000)
    expect(ran()).toEqual(["mcp-local"])
    const mcp = ((await at(p1, "GET", "/api/mcp")).json?.data ?? []) as Array<{ name: string }>
    expect(mcp.map((server) => server.name)).toEqual(["cpi12mcp"])
  }, 60_000)

  test("turn:一轮普通对话不再多跑命令;instructions 指向的项目外文件原文进了模型请求", async () => {
    const { id } = await session(p1)
    expect(await turn(p1, id, "hello")).toEqual([])
    expect(ran()).toEqual(["mcp-local"])
    expect(JSON.stringify(model.requests.at(-1)?.messages ?? [])).toContain(CANARY)
  }, 60_000)

  test("tool(默认档,不弹审批):模型写 .txt ⇒ 项目的 formatter 命令;写 .php ⇒ 项目的 ./vendor/bin/pint;模型调 shell ⇒ 项目的 shell 可执行文件", async () => {
    const { id } = await session(p1)
    expect(await turn(p1, id, call("write", { path: "notes.txt", content: "hi\n" }))).toEqual([])
    await until(() => ran().includes("formatter-config"))
    expect(lines("formatter-config")).toEqual([`ran ${path.join(p1, "notes.txt")}`])
    expect(await turn(p1, id, call("write", { path: "a.php", content: "<?php\n" }))).toEqual([])
    await until(() => ran().includes("formatter-builtin-pint"))
    expect(lines("formatter-builtin-pint")).toEqual([`ran ${path.join(p1, "a.php")}`])
    expect(await turn(p1, id, call("shell", { command: "echo cp-tool", description: "probe" }))).toEqual([])
    expect(lines("shell-key")).toEqual(["argc=2 -c echo cp-tool"])
  }, 90_000)

  test("tool(请求审批档):审批框只写命令原文;批准之后才跑,跑的是项目的 shell 可执行文件;批准写文件之后跑项目的 formatter", async () => {
    await open(pAskTier)
    const { id } = await session(pAskTier, { agent: "codepuppy-ask" })
    const before = lines("shell-key").length
    const shellAsks = await turn(pAskTier, id, call("shell", { command: "echo cp-ask-tier", description: "probe" }))
    expect(shellAsks).toEqual([{ action: "shell", resources: ["echo cp-ask-tier"], shellKeyLines: before }])
    expect(lines("shell-key").at(-1)).toBe("argc=2 -c echo cp-ask-tier")
    const writeAsks = await turn(pAskTier, id, call("write", { path: "ask.txt", content: "hi\n" }))
    expect(writeAsks.map((ask) => [ask.action, ask.resources])).toEqual([["edit", ["ask.txt"]]])
    await until(() => lines("formatter-config").length === 2)
    expect(lines("formatter-config").at(-1)).toBe(`ran ${path.join(pAskTier, "ask.txt")}`)
  }, 90_000)

  test("user:项目的斜杠命令(配置 / `.opencode/commands/`)展开时经项目的 shell 跑插值;输入框 shell 与默认终端也用项目的 shell", async () => {
    const { id } = await session(p1)
    const names = (((await at(p1, "GET", "/api/command")).json?.data ?? []) as Array<{ name: string }>).map((command) => command.name)
    expect(names).toEqual(expect.arrayContaining(["cpi12cmd", "cpi12dir"]))
    expect((await at(p1, "POST", `/api/session/${id}/command`, { name: "cpi12cmd", text: "" })).status).toBe(204)
    await until(() => ran().includes("command-config-template"))
    expect((await at(p1, "POST", `/api/session/${id}/command`, { name: "cpi12dir", text: "" })).status).toBe(204)
    await until(() => ran().includes("command-dir-template"))
    expect(ran()).toEqual(expect.arrayContaining(["command-config-template", "command-dir-template"]))
    expect((await at(p1, "POST", `/api/session/${id}/shell`, { command: "echo cp-user" })).status).toBe(204)
    await until(() => lines("shell-key").some((line) => line.endsWith("echo cp-user")))
    expect((await at(p1, "POST", "/api/pty", { cwd: p1 })).status).toBe(200)
    await until(() => lines("shell-key").includes("argc=0"))
    const shellLines = lines("shell-key")
    // 两条模板插值、输入框 shell、默认终端(无参数启动)都经项目的 cpshell
    expect(shellLines.filter((line) => line.includes("command-config-template") || line.includes("command-dir-template"))).toHaveLength(2)
    expect(shellLines).toEqual(expect.arrayContaining(["argc=2 -c echo cp-user", "argc=0"]))
    await at(p1, "POST", `/api/session/${id}/abort`).catch(() => undefined)
  }, 90_000)

  test("user:项目的 review / init 顶替出厂命令,用户敲 /review、/init 跑的是项目模板里的插值", async () => {
    await open(pShadow)
    const { id } = await session(pShadow)
    for (const name of ["review", "init"]) expect((await at(pShadow, "POST", `/api/session/${id}/command`, { name, text: "" })).status).toBe(204)
    await until(() => ran().includes("command-shadow-review") && ran().includes("command-shadow-init"))
    expect(ran()).toEqual(expect.arrayContaining(["command-shadow-review", "command-shadow-init"]))
    await at(pShadow, "POST", `/api/session/${id}/abort`).catch(() => undefined)
  }, 60_000)

  test("turn:模型级 `package: file://…` ⇒ 引擎进程在这一轮 import 项目里的模块;节点级 package 被注入盖过;新节点被 provider.use 拒", async () => {
    await open(pProvider)
    const { id } = await session(pProvider)
    await turn(pProvider, id, "hello")
    const fresh = await session(pProvider, { model: { id: "x", providerID: "cpi12new" } })
    if (fresh.status === 200) await turn(pProvider, fresh.id, "hello")
    expect(ran()).not.toContain("provider-package")
    expect(ran()).not.toContain("new-provider-package")
    await open(pModel)
    const model = await session(pModel)
    await turn(pModel, model.id, "hello")
    expect(ran()).toContain("model-package")
  }, 90_000)

  test("never:lsp 命令(引擎没有 LSP 运行时)、git core.fsmonitor、`.codepuppy/codepuppy.jsonc` 的 MCP、没写 formatter 键时的 pint", async () => {
    await open(pNoFormatter)
    const { id } = await session(pNoFormatter)
    await turn(pNoFormatter, id, call("write", { path: "b.php", content: "<?php\n" }))
    await sleep(1_000)
    for (const marker of ["lsp", "git-fsmonitor", "mcp-codepuppy-jsonc", "formatter-builtin-pint-without-key"]) expect(ran()).not.toContain(marker)
  }, 60_000)

  test("插件:项目用自己的 options 重新声明用户全局目录插件 ⇒ 项目的 options 生效", async () => {
    await open(p1)
    await open(pPluginOptions)
    await until(() => fs.existsSync(pluginLog) && fs.readFileSync(pluginLog, "utf8").includes(pPluginOptions))
    const seen = fs.readFileSync(pluginLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { dir: string; options: unknown })
    expect(seen.find((entry) => entry.dir === p1)?.options).toEqual({ who: "user" })
    expect(seen.find((entry) => entry.dir === pPluginOptions)?.options).toEqual({ who: "project" })
  }, 60_000)

  test("插件:项目 `-*` ⇒ 内置插件与用户全局插件都停掉,只剩两个受保护的内置、ext 与宿主探针;会话因节点消失而起不来", async () => {
    await open(pNeutral)
    expect(await plugins(pNeutral)).toEqual(expect.arrayContaining(["cpi12.global", "codepuppy.ext", "opencode.config.provider", "opencode.tool.shell"]))
    await open(pRemoveAll)
    expect((await plugins(pRemoveAll)).sort()).toEqual(["codepuppy.ext", "codepuppy.test.engine-probe", "opencode.config.policy", "opencode.provider.opencode"])
    const { id } = await session(pRemoveAll)
    const before = model.requests.length
    await turn(pRemoveAll, id, "hello")
    expect(model.requests.length).toBe(before)
  }, 60_000)

  test("插件:项目 `-opencode.config.agent` ⇒ Code Puppy 注入的只读档 agent 消失,用它开的会话按「找不到 agent」失败,不退回放行", async () => {
    await open(pRemoveAgent)
    const agents = (((await at(pRemoveAgent, "GET", "/api/agent")).json?.data ?? []) as Array<{ id: string }>).map((agent) => agent.id)
    expect(agents).not.toContain("codepuppy-readonly")
    const { id } = await session(pRemoveAgent, { agent: "codepuppy-readonly" })
    const before = model.requests.length
    await turn(pRemoveAgent, id, call("shell", { command: mark("remove-agent-readonly-shell"), description: "probe" }))
    expect(model.requests.length).toBe(before)
    const messages = JSON.stringify((await at(pRemoveAgent, "GET", `/api/session/${id}/message?order=asc`)).json)
    expect(messages).toContain('Agent not found: \\"codepuppy-readonly\\"')
    expect(ran()).not.toContain("remove-agent-readonly-shell")
  }, 60_000)

  test("md 文件头:四个读取点的 `---javascript` 在打开位置时就被求值(agent、命令、技能、`.codepuppy/skills` 各一个标记),条目照常出现", async () => {
    delete process.env.CP_I12_UNSET_MODEL
    await open(pFrontmatter)
    const names = (route: string, key: "id" | "name") =>
      at(pFrontmatter, "GET", route).then((r) => ((r.json?.data ?? []) as Array<Record<string, string>>).map((item) => item[key]))
    expect(await names("/api/agent", "id")).toContain("cpi12jsagent")
    expect(await names("/api/command", "name")).toContain("cpi12jscmd")
    expect(await names("/api/skill", "id")).toEqual(expect.arrayContaining(["cpi12jsskill", "cpi12cpskill"]))
    for (const marker of ["frontmatter-agent", "frontmatter-command", "frontmatter-skill", "frontmatter-codepuppy-skill"]) expect(ran()).toContain(marker)
  }, 60_000)

  test("agent:写了 `system` 又写了无效 `{env:}` 模型的 agent 整条不出现(连提示词一起丢)", async () => {
    const agents = ((await at(pFrontmatter, "GET", "/api/agent")).json?.data ?? []) as Array<{ id: string }>
    expect(agents.map((agent) => agent.id)).not.toContain("cpi12envagent")
  }, 60_000)

  test("agent:v1 `mode` 名字空间与 `.opencode/modes/` 目录里写明 subagent 的 agent 都成了 primary", async () => {
    const agents = ((await at(pFrontmatter, "GET", "/api/agent")).json?.data ?? []) as Array<{ id: string; mode?: string }>
    const mode = (id: string) => agents.find((agent) => agent.id === id)?.mode
    expect(mode("cpi12modeagent")).toBe("primary")
    expect(mode("cpi12dirmode")).toBe("primary")
  }, 60_000)
})
