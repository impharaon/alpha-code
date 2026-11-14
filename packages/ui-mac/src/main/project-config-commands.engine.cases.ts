// INT-safety I-12 / #1713(实测说明 docs/architecture/2026-11-13-project-config-command-surface.md):项目自己的 `opencode.json` /
// `.opencode/` 经生产注入交给沙箱里的真 OpenCode 2,哪些键让项目选的命令执行、在什么时点执行。每个「命令」都是一段只往沙箱标记目录
// 追加一行的 sh —— 标记出现 = 那条命令执行了。
//
// 同一台引擎、两组同样的夹具,同时打开(AC-07):
//   · **未允许臂**:没有信任记录。原先钉在这里的「已知的坏」随修复按段翻转(DESIGN-project-engine-config-takeover 段 1:配置装载闸;
//     命令插值与 md 文件头在段 2 一并翻转);
//   · **允许臂**:每个项目先经 main 的生产写端记一条「允许加载」。断言保持今天的样子(与在 OpenCode 里一样,AC-03),
//     只有 `-*` 与 `-opencode.config.agent` 两条改成会话照常(契约 B 唯一的「从不」,AC-04)。
// 时点:open(只打开位置)→ turn(一轮普通对话)→ tool(模型调写文件 / shell 工具)→ user(用户调斜杠命令、在输入框跑 shell、
// 开终端)。每臂内用例按这个顺序跑,后一条依赖前一条留下的标记;两臂各用各的标记目录与项目目录。
//
// 本文件由同名 `.test.ts` 宿主起独立的 `bun test` 子进程跑:沙箱改的 HOME / XDG_* 不出那个进程。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { allowProject, codepuppyEngine, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { engineGlobalConfigDirectory } from "./engine-paths"

type Arm = "unallowed" | "allowed"
const ARMS: readonly Arm[] = ["unallowed", "allowed"]

const sandbox = engineSandbox()
const model = scriptedModel()
const pluginLog = path.join(sandbox.root, "i12-plugin-options.log")
const outside = path.join(sandbox.root, "i12-outside")
const globalPlugin = path.join(sandbox.root, "i12-global-plugin")
const CANARY = "CP-I12-SECRET-CANARY-7f3a"
let running: Running | undefined

const write = (file: string, text: string, mode?: number) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  if (mode) fs.chmodSync(file, mode)
}
const markers = (arm: Arm) => path.join(sandbox.root, "i12-markers", arm)
/** 往这一臂的标记文件追加一行的 sh 片段。 */
const mark = (arm: Arm, name: string, extra = "") => `echo "ran ${extra}" >> '${path.join(markers(arm), name)}'`
const ran = (arm: Arm) => (fs.existsSync(markers(arm)) ? fs.readdirSync(markers(arm)).sort() : [])
const lines = (arm: Arm, name: string) => {
  const file = path.join(markers(arm), name)
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").map((line) => line.trimEnd()).filter(Boolean) : []
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const until = async (done: () => boolean, ms = 15_000) => {
  for (let waited = 0; waited < ms && !done(); waited += 100) await sleep(100)
}
/** 「没有发生」要等够:派生的程序(formatter、终端)在请求返回之后才起。 */
const settle = () => sleep(1_500)
/** 模块求值第一行写标记的 ES 模块(SDK 包探针)。 */
const moduleProbe = (arm: Arm, marker: string) =>
  `import { appendFileSync } from "node:fs"\nappendFileSync(${JSON.stringify(path.join(markers(arm), marker))}, "ran\\n")\nexport const createX = () => { throw new Error("i12") }\n`
/** md 文件头写成 `---javascript`:求值时往标记目录追加一行,再交回一份普通的文件头数据。 */
const jsFrontmatter = (arm: Arm, marker: string, data: string, body: string) =>
  `---javascript\n(require("node:fs").appendFileSync(${JSON.stringify(path.join(markers(arm), marker))}, "ran\\n"), ${data})\n---\n${body}\n`

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
const agentsAt = async (directory: string) => ((await at(directory, "GET", "/api/agent")).json?.data ?? []) as Array<{ id: string; mode?: string; system?: string; model?: { id: string; providerID: string }; permissions?: Array<{ action: string; resource: string; effect: string }> }>

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
async function turn(arm: Arm, directory: string, sessionID: string, text: string) {
  const asked: Ask[] = []
  await at(directory, "POST", `/api/session/${sessionID}/prompt`, { text })
  let done = false
  const waiting = at(directory, "POST", `/api/experimental/session/${sessionID}/wait`).finally(() => (done = true))
  const seen = new Set<string>()
  while (!done) {
    const pending = ((await at(directory, "GET", `/api/session/${sessionID}/permission`)).json?.data ?? []) as Array<{ id: string; action: string; resources: unknown }>
    for (const request of pending.filter((request) => !seen.has(request.id))) {
      seen.add(request.id)
      asked.push({ action: request.action, resources: request.resources, shellKeyLines: lines(arm, "shell-key").length })
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

// ── 夹具(每臂一套)──────────────────────────────────────────────────────────────────────────────────────────────────────────
type Projects = Record<
  "p1" | "ask" | "provider" | "model" | "shadow" | "nofmt" | "pluginOptions" | "removeAll" | "removeAgent" | "neutral" | "frontmatter",
  string
>
const projects = {} as Record<Arm, Projects>
const project = (arm: Arm, name: string) => path.join(sandbox.root, "projects", `i12-${arm}-${name}`)

/** P1 / ask 档项目共用的一份 opencode.json:mcp、formatter(自配,且打开内置)、lsp、shell、commands、instructions。 */
function commandProject(arm: Arm, directory: string) {
  write(path.join(directory, "tools", "cpshell"), `#!/bin/sh\necho "argc=$# $@" >> '${path.join(markers(arm), "shell-key")}'\nexec /bin/sh "$@"\n`, 0o755)
  // 内置 pint:composer.json 要求 laravel/pint ⇒ 内置格式化器跑项目里的 ./vendor/bin/pint(packages/core/src/formatter/builtins.ts)
  write(path.join(directory, "composer.json"), JSON.stringify({ "require-dev": { "laravel/pint": "^1" } }))
  write(path.join(directory, "vendor", "bin", "pint"), `#!/bin/sh\n${mark(arm, "formatter-builtin-pint", "$*")}\n`, 0o755)
  write(
    path.join(directory, "opencode.json"),
    JSON.stringify({
      mcp: { servers: { cpi12mcp: { type: "local", command: ["/bin/sh", "-c", `${mark(arm, "mcp-local")}; exec cat`] } } },
      formatter: { cpi12fmt: { command: ["/bin/sh", "-c", mark(arm, "formatter-config", "$0"), "$FILE"], extensions: [".txt"] } },
      lsp: { cpi12lsp: { command: ["/bin/sh", "-c", mark(arm, "lsp")], extensions: [".txt"] } },
      shell: path.join(directory, "tools", "cpshell"),
      commands: { cpi12cmd: { template: `hello !\`${mark(arm, "command-config-template")}\`` } },
      instructions: [path.join(outside, "secret.txt")],
    }),
  )
}

function fixture(arm: Arm, p1: string): Projects {
  const p: Projects = {
    p1,
    ask: project(arm, "ask"),
    provider: project(arm, "provider"),
    model: project(arm, "model"),
    shadow: project(arm, "shadow"),
    nofmt: project(arm, "nofmt"),
    pluginOptions: project(arm, "plugin-options"),
    removeAll: project(arm, "remove-all"),
    removeAgent: project(arm, "remove-agent"),
    neutral: project(arm, "neutral"),
    frontmatter: project(arm, "frontmatter"),
  }
  fs.mkdirSync(markers(arm), { recursive: true })
  fs.mkdirSync(p.p1, { recursive: true })
  commandProject(arm, p.p1)
  write(path.join(p.p1, ".opencode", "commands", "cpi12dir.md"), `---\ndescription: i12 dir command\n---\nhi !\`${mark(arm, "command-dir-template")}\`\n`)
  // 同一个项目在 Code Puppy 自己的项目文件里写本地 MCP —— ext 的信任门(packages/ext/src/project-config.ts)读的是同一条信任记录
  write(path.join(p.p1, ".codepuppy", "codepuppy.jsonc"), JSON.stringify({ mcp: { cpi12gated: { type: "local", command: ["/bin/sh", "-c", `${mark(arm, "mcp-codepuppy-jsonc")}; exec cat`] } } }))
  // 不是 opencode 配置键,一并测:项目自带 .git/config 的 core.fsmonitor
  execFileSync("git", ["init", "-q"], { cwd: p.p1 })
  execFileSync("git", ["config", "core.fsmonitor", mark(arm, "git-fsmonitor")], { cwd: p.p1 })

  // 「请求审批」档用的另一个同样配置的项目(会话 agent = codepuppy-ask)
  commandProject(arm, p.ask)

  // SDK 包:节点级 package 换成项目里的 file:// 模块;另声明一个新节点
  write(path.join(p.provider, "provider.mjs"), moduleProbe(arm, "provider-package"))
  write(path.join(p.provider, "new-provider.mjs"), moduleProbe(arm, "new-provider-package"))
  write(
    path.join(p.provider, "opencode.json"),
    JSON.stringify({
      providers: {
        codepuppy: { package: `file://${path.join(p.provider, "provider.mjs")}` },
        cpi12new: { name: "new", package: `file://${path.join(p.provider, "new-provider.mjs")}`, models: { x: { name: "x" } } },
      },
    }),
  )
  // 模型级 package
  write(path.join(p.model, "model.mjs"), moduleProbe(arm, "model-package"))
  write(path.join(p.model, "opencode.json"), JSON.stringify({ providers: { codepuppy: { models: { m: { package: `file://${path.join(p.model, "model.mjs")}` } } } } }))

  // 与出厂命令同名
  write(
    path.join(p.shadow, "opencode.json"),
    JSON.stringify({ commands: { review: { template: `r !\`${mark(arm, "command-shadow-review")}\`` }, init: { template: `i !\`${mark(arm, "command-shadow-init")}\`` } } }),
  )
  // 对照:pint 的条件都在,但项目没写 `formatter` 键
  write(path.join(p.nofmt, "composer.json"), JSON.stringify({ "require-dev": { "laravel/pint": "^1" } }))
  write(path.join(p.nofmt, "vendor", "bin", "pint"), `#!/bin/sh\n${mark(arm, "formatter-builtin-pint-without-key", "$*")}\n`, 0o755)

  // 插件:项目用自己的 options 重新声明用户全局插件;项目写 `-*`;项目写 `-opencode.config.agent`
  write(path.join(p.pluginOptions, "opencode.json"), JSON.stringify({ plugins: [{ package: globalPlugin, options: { who: "project" } }] }))
  write(path.join(p.removeAll, "opencode.json"), JSON.stringify({ plugins: ["-*"] }))
  write(path.join(p.removeAgent, "opencode.json"), JSON.stringify({ plugins: ["-opencode.config.agent"] }))
  fs.mkdirSync(p.neutral, { recursive: true })

  // md 文件头:四个读取点各一个 `---javascript`(agent、命令、技能、Code Puppy 显式层的 `.codepuppy/skills`);
  // 写了 `system` 与无效 `{env:}` 模型的 agent;v1 `mode` 名字空间与 `.opencode/modes/` 目录各覆盖一个出厂 subagent(general、explore)。
  write(path.join(p.frontmatter, ".opencode", "plugins", "x.js"), `import { appendFileSync } from "node:fs"\nappendFileSync(${JSON.stringify(path.join(markers(arm), "project-plugin"))}, "ran\\n")\nexport default { id: "cpi12.project", setup: async () => {} }\n`)
  write(path.join(p.frontmatter, ".opencode", "agents", "cpi12jsagent.md"), jsFrontmatter(arm, "frontmatter-agent", "{ description: 'i12 js agent' }", "I12-JS-AGENT-BODY"))
  write(path.join(p.frontmatter, ".opencode", "commands", "cpi12jscmd.md"), jsFrontmatter(arm, "frontmatter-command", "{ description: 'i12 js command' }", "I12-JS-COMMAND-BODY"))
  write(path.join(p.frontmatter, ".opencode", "skills", "cpi12jsskill", "SKILL.md"), jsFrontmatter(arm, "frontmatter-skill", "{ name: 'cpi12jsskill', description: 'i12 js skill' }", "I12-JS-SKILL-BODY"))
  write(path.join(p.frontmatter, ".codepuppy", "skills", "cpi12cpskill", "SKILL.md"), jsFrontmatter(arm, "frontmatter-codepuppy-skill", "{ name: 'cpi12cpskill', description: 'i12 cp skill' }", "I12-CP-SKILL-BODY"))
  write(
    path.join(p.frontmatter, "opencode.json"),
    JSON.stringify({
      agents: { cpi12envagent: { system: "I12-ENV-AGENT-PROMPT", model: "{env:CP_I12_UNSET_MODEL}" } },
      mode: { general: { prompt: "I12-MODE-GENERAL-PROMPT" } },
    }),
  )
  write(path.join(p.frontmatter, ".opencode", "modes", "explore.md"), "---\ndescription: i12 dir mode explore\n---\nI12-DIRMODE-PROMPT\n")
  // 同段 0 的实测文件头,加上原生控制字段与无效模型;目录覆盖已有 subagent,避免新 agent 默认 primary 干扰判据。
  write(path.join(p.frontmatter, ".opencode", "agents", "general.md"), '---\nsystem: ignored header\nmodel: codepuppy/m\nmode: primary\npermissions:\n  - action: edit\n    resource: CP-I12-MD-CONTROL\n    effect: allow\n---\nI12-MODE-GENERAL-PROMPT\n')
  write(path.join(p.frontmatter, ".opencode", "agents", "cpi12mdenvagent.md"), '---\nsystem: ignored header\nmodel: "{env:CP_I12_UNSET_MODEL}"\n---\nI12-MD-ENV-PROMPT\n')
  write(path.join(p.frontmatter, ".opencode", "commands", "cpi12controlcmd.md"), '---\ndescription: i12 controlled command\nagent: general\nmodel: codepuppy/m\nsubtask: true\n---\nI12-CONTROL-COMMAND-BODY\n')

  if (arm === "allowed") for (const directory of Object.values(p)) allowProject(directory)
  return p
}

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  delete process.env.CP_I12_UNSET_MODEL
  write(path.join(outside, "secret.txt"), `${CANARY}\n`)
  // 用户全局插件的声明也写进注入时读的那个全局目录:测试宿主交给引擎的全局目录是 engine-config/<id>,注入在构造宿主时就按
  // engineGlobalConfigDirectory 算好了放行名单(先例 mcp-server-derivation.engine.cases.ts 同样两处都写)。
  write(path.join(engineGlobalConfigDirectory(process.env, sandbox.home), "opencode.json"), JSON.stringify({ plugins: [{ package: globalPlugin, options: { who: "user" } }] }))
  const host = codepuppyEngine({ sandbox, name: "i12", modelBaseURL: model.baseURL })
  write(
    path.join(globalPlugin, "server.js"),
    `import { appendFileSync } from "node:fs"\nexport default { id: "cpi12.global", setup: async (ctx) => { appendFileSync(${JSON.stringify(pluginLog)}, JSON.stringify({ dir: ctx.location?.directory ?? null, options: ctx.options ?? null }) + "\\n") } }\n`,
  )
  write(path.join(host.slot.configDirectory, "opencode.json"), JSON.stringify({ plugins: [{ package: globalPlugin, options: { who: "user" } }] }))
  projects.unallowed = fixture("unallowed", host.projectDirectory)
  projects.allowed = fixture("allowed", project("allowed", "p1"))
  running = await host.start()
}, 120_000)

afterAll(async () => {
  await running?.close().catch(() => undefined)
  model.stop()
})

for (const arm of ARMS) {
  const allowed = arm === "allowed"
  describe(`I-12 / #1713 ${allowed ? "允许臂:与 OpenCode 一样全部生效" : "未允许臂:会运行程序的设置不生效"}`, () => {
    const p = () => projects[arm]

    test("open:只打开位置 ⇒ 允许臂:opencode.json 与 .codepuppy 的本地 MCP 都启动;未允许臂:一个都不启动", async () => {
      await open(p().p1)
      if (allowed) await until(() => ran(arm).includes("mcp-local") && ran(arm).includes("mcp-codepuppy-jsonc"))
      await sleep(1_000)
      expect(ran(arm)).toEqual(allowed ? ["mcp-codepuppy-jsonc", "mcp-local"] : [])
      const mcp = (((await at(p().p1, "GET", "/api/mcp")).json?.data ?? []) as Array<{ name: string }>).map((server) => server.name)
      if (allowed) expect(mcp).toEqual(expect.arrayContaining(["cpi12mcp", "cpi12gated"]))
      else expect(mcp).toEqual([])
    }, 60_000)

    test("turn:一轮普通对话不多跑命令;两臂 instructions 指向的项目外文件都照 OpenCode 原样进模型请求(读普通内容不设闸)", async () => {
      const before = ran(arm)
      const { id } = await session(p().p1)
      expect(await turn(arm, p().p1, id, "hello")).toEqual([])
      expect(ran(arm)).toEqual(before)
      expect(JSON.stringify(model.requests.at(-1)?.messages ?? [])).toContain(CANARY)
    }, 60_000)

    test("tool(默认档):模型写 .txt / .php、调 shell ⇒ 允许臂:项目的 formatter、./vendor/bin/pint、项目 shell;未允许臂:都不跑", async () => {
      const { id } = await session(p().p1)
      expect(await turn(arm, p().p1, id, call("write", { path: "notes.txt", content: "hi\n" }))).toEqual([])
      if (allowed) await until(() => ran(arm).includes("formatter-config"))
      else await settle()
      expect(lines(arm, "formatter-config")).toEqual(allowed ? [`ran ${path.join(p().p1, "notes.txt")}`] : [])
      expect(await turn(arm, p().p1, id, call("write", { path: "a.php", content: "<?php\n" }))).toEqual([])
      if (allowed) await until(() => ran(arm).includes("formatter-builtin-pint"))
      else await settle()
      expect(lines(arm, "formatter-builtin-pint")).toEqual(allowed ? [`ran ${path.join(p().p1, "a.php")}`] : [])
      expect(await turn(arm, p().p1, id, call("shell", { command: "echo cp-tool", description: "probe" }))).toEqual([])
      expect(lines(arm, "shell-key")).toEqual(allowed ? ["argc=2 -c echo cp-tool"] : [])
    }, 90_000)

    test("tool(请求审批档):审批框只写命令原文;批准之后 ⇒ 允许臂:跑项目 shell、写文件后跑项目 formatter;未允许臂:都不是项目的程序", async () => {
      await open(p().ask)
      const { id } = await session(p().ask, { agent: "codepuppy-ask" })
      const before = lines(arm, "shell-key").length
      const shellAsks = await turn(arm, p().ask, id, call("shell", { command: "echo cp-ask-tier", description: "probe" }))
      expect(shellAsks).toEqual([{ action: "shell", resources: ["echo cp-ask-tier"], shellKeyLines: before }])
      if (allowed) expect(lines(arm, "shell-key").at(-1)).toBe("argc=2 -c echo cp-ask-tier")
      else expect(lines(arm, "shell-key")).toEqual([])
      const formatted = lines(arm, "formatter-config").length
      const writeAsks = await turn(arm, p().ask, id, call("write", { path: "ask.txt", content: "hi\n" }))
      expect(writeAsks.map((ask) => [ask.action, ask.resources])).toEqual([["edit", ["ask.txt"]]])
      if (allowed) {
        await until(() => lines(arm, "formatter-config").length === formatted + 1)
        expect(lines(arm, "formatter-config").at(-1)).toBe(`ran ${path.join(p().ask, "ask.txt")}`)
      } else {
        await settle()
        expect(lines(arm, "formatter-config")).toEqual([])
      }
    }, 90_000)

    test("user:斜杠命令(配置 / `.opencode/commands/`)照常列出,未允许发模板原文、允许后插值;输入框 shell 与默认终端 ⇒ 允许臂项目 shell、未允许臂不是", async () => {
      const { id } = await session(p().p1)
      const names = (((await at(p().p1, "GET", "/api/command")).json?.data ?? []) as Array<{ name: string }>).map((command) => command.name)
      expect(names).toEqual(expect.arrayContaining(["cpi12cmd", "cpi12dir"]))
      for (const [name, marker] of [["cpi12cmd", "command-config-template"], ["cpi12dir", "command-dir-template"]]) {
        const before = model.requests.length
        expect((await at(p().p1, "POST", `/api/session/${id}/command`, { name, text: "" })).status).toBe(204)
        await at(p().p1, "POST", `/api/experimental/session/${id}/wait`)
        if (allowed) expect(ran(arm)).toContain(marker)
        else {
          expect(ran(arm)).not.toContain(marker)
          const sent = JSON.stringify(model.requests.slice(before).map((request) => request.messages))
          expect(sent).toContain("!`echo")
          expect(sent).toContain(marker)
        }
      }
      expect((await at(p().p1, "POST", `/api/session/${id}/shell`, { command: "echo cp-user" })).status).toBe(204)
      if (allowed) await until(() => lines(arm, "shell-key").some((line) => line.endsWith("echo cp-user")))
      expect((await at(p().p1, "POST", "/api/pty", { cwd: p().p1 })).status).toBe(200)
      if (allowed) await until(() => lines(arm, "shell-key").includes("argc=0"))
      else await settle()
      const shellLines = lines(arm, "shell-key")
      if (allowed) {
        // 两条模板插值、输入框 shell、默认终端(无参数启动)都经项目的 cpshell
        expect(shellLines.filter((line) => line.includes("command-config-template") || line.includes("command-dir-template"))).toHaveLength(2)
        expect(shellLines).toEqual(expect.arrayContaining(["argc=2 -c echo cp-user", "argc=0"]))
      } else expect(shellLines).toEqual([])
      await at(p().p1, "POST", `/api/session/${id}/abort`).catch(() => undefined)
    }, 90_000)

    test("user:项目的 review / init 顶替出厂命令(文字是内容),未允许发模板原文、允许后插值", async () => {
      await open(p().shadow)
      const { id } = await session(p().shadow)
      for (const name of ["review", "init"]) {
        const before = model.requests.length
        expect((await at(p().shadow, "POST", `/api/session/${id}/command`, { name, text: "" })).status).toBe(204)
        await at(p().shadow, "POST", `/api/experimental/session/${id}/wait`)
        if (allowed) expect(ran(arm)).toContain(`command-shadow-${name}`)
        else {
          expect(ran(arm)).not.toContain(`command-shadow-${name}`)
          const sent = JSON.stringify(model.requests.slice(before).map((request) => request.messages))
          expect(sent).toContain("!`echo")
          expect(sent).toContain(`command-shadow-${name}`)
        }
      }
      await at(p().shadow, "POST", `/api/session/${id}/abort`).catch(() => undefined)
    }, 60_000)

    test("turn:模型级 `package: file://…` ⇒ 允许臂:这一轮 import 项目里的模块;未允许臂:不 import。两臂节点级 package 都被注入盖过、新节点都被 provider.use 拒", async () => {
      await open(p().provider)
      const { id } = await session(p().provider)
      await turn(arm, p().provider, id, "hello")
      const fresh = await session(p().provider, { model: { id: "x", providerID: "cpi12new" } })
      if (fresh.status === 200) await turn(arm, p().provider, fresh.id, "hello")
      expect(ran(arm)).not.toContain("provider-package")
      expect(ran(arm)).not.toContain("new-provider-package")
      await open(p().model)
      const second = await session(p().model)
      await turn(arm, p().model, second.id, "hello")
      if (allowed) expect(ran(arm)).toContain("model-package")
      else expect(ran(arm)).not.toContain("model-package")
    }, 90_000)

    test("never:lsp 命令(引擎没有 LSP 运行时)、git core.fsmonitor、没写 formatter 键时的 pint;`.codepuppy` 的 MCP 与 OpenCode 配置同一个决定", async () => {
      await open(p().nofmt)
      const { id } = await session(p().nofmt)
      await turn(arm, p().nofmt, id, call("write", { path: "b.php", content: "<?php\n" }))
      await sleep(1_000)
      for (const marker of ["lsp", "git-fsmonitor", "formatter-builtin-pint-without-key"]) expect(ran(arm)).not.toContain(marker)
      if (allowed) expect(ran(arm)).toContain("mcp-codepuppy-jsonc")
      else expect(ran(arm)).not.toContain("mcp-codepuppy-jsonc")
    }, 60_000)

    test("插件:项目用自己的 options 重新声明用户全局插件 ⇒ 允许臂:项目的 options 生效;未允许臂:仍是用户的 options", async () => {
      await open(p().p1)
      await open(p().pluginOptions)
      await until(() => fs.existsSync(pluginLog) && fs.readFileSync(pluginLog, "utf8").includes(p().pluginOptions))
      const seen = fs.readFileSync(pluginLog, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { dir: string; options: unknown })
      expect(seen.find((entry) => entry.dir === p().p1)?.options).toEqual({ who: "user" })
      expect(seen.find((entry) => entry.dir === p().pluginOptions)?.options).toEqual({ who: allowed ? "project" : "user" })
    }, 60_000)

    test("插件:项目 `-*` ⇒ 两臂内置插件与用户全局插件都在,会话照常拿到回复(允许臂:唯一的「从不」;未允许臂:plugins 整个暂缓)", async () => {
      await open(p().neutral)
      expect(await plugins(p().neutral)).toEqual(expect.arrayContaining(["cpi12.global", "codepuppy.ext", "opencode.config.provider", "opencode.tool.shell"]))
      await open(p().removeAll)
      expect(await plugins(p().removeAll)).toEqual(expect.arrayContaining(["cpi12.global", "codepuppy.ext", "opencode.config.provider", "opencode.tool.shell"]))
      const { id } = await session(p().removeAll)
      const before = model.requests.length
      await turn(arm, p().removeAll, id, "hello")
      expect(model.requests.length).toBeGreaterThan(before)
    }, 60_000)

    test("插件:项目 `-opencode.config.agent` ⇒ 两臂只读档 agent 都在,用它开的会话照常运行,只读档照样拒 shell", async () => {
      await open(p().removeAgent)
      expect((await agentsAt(p().removeAgent)).map((agent) => agent.id)).toContain("codepuppy-readonly")
      const { id } = await session(p().removeAgent, { agent: "codepuppy-readonly" })
      const before = model.requests.length
      await turn(arm, p().removeAgent, id, call("shell", { command: mark(arm, "remove-agent-readonly-shell"), description: "probe" }))
      expect(model.requests.length).toBeGreaterThan(before)
      expect(ran(arm)).not.toContain("remove-agent-readonly-shell")
    }, 60_000)

    test("md 文件头:四个读取点未允许不求值、允许后照旧求值;两臂条目与正文照常可用", async () => {
      await open(p().frontmatter)
      const names = (route: string, key: "id" | "name") =>
        at(p().frontmatter, "GET", route).then((r) => ((r.json?.data ?? []) as Array<Record<string, string>>).map((item) => item[key]))
      if (allowed) expect(ran(arm)).toContain("project-plugin")
      else expect(ran(arm)).not.toContain("project-plugin")
      expect(await names("/api/agent", "id")).toContain("cpi12jsagent")
      expect(await names("/api/command", "name")).toContain("cpi12jscmd")
      expect(await names("/api/skill", "id")).toEqual(expect.arrayContaining(["cpi12jsskill", "cpi12cpskill"]))
      for (const marker of ["frontmatter-agent", "frontmatter-command", "frontmatter-skill", "frontmatter-codepuppy-skill"]) {
        if (allowed) expect(ran(arm)).toContain(marker)
        else expect(ran(arm)).not.toContain(marker)
      }
      expect((await agentsAt(p().frontmatter)).find((agent) => agent.id === "cpi12jsagent")?.system).toBe("I12-JS-AGENT-BODY")
      const skills = ((await at(p().frontmatter, "GET", "/api/skill")).json?.data ?? []) as Array<{ id: string; content: string }>
      expect(skills.find((skill) => skill.id === "cpi12jsskill")?.content).toBe("I12-JS-SKILL-BODY\n")
      expect(skills.find((skill) => skill.id === "cpi12cpskill")?.content).toBe("I12-CP-SKILL-BODY\n")
      const { id } = await session(p().frontmatter)
      const initial = (await at(p().frontmatter, "GET", `/api/session/${id}`)).json?.data
      const before = model.requests.length
      expect((await at(p().frontmatter, "POST", `/api/session/${id}/command`, { name: "cpi12jscmd", text: "" })).status).toBe(204)
      await at(p().frontmatter, "POST", `/api/experimental/session/${id}/wait`)
      expect(JSON.stringify(model.requests.slice(before).map((request) => request.messages))).toContain("I12-JS-COMMAND-BODY")
      if (!allowed) {
        // agent / model / subtask 暂缓后,命令仍在当前会话发送原正文,不切助手、不派子会话。
        expect((await at(p().frontmatter, "POST", `/api/session/${id}/command`, { name: "cpi12controlcmd", text: "" })).status).toBe(204)
        await at(p().frontmatter, "POST", `/api/experimental/session/${id}/wait`)
        const current = (await at(p().frontmatter, "GET", `/api/session/${id}`)).json?.data
        expect(current.agent).toBe(initial.agent)
        expect(current.model).toMatchObject({ id: "m", providerID: "codepuppy" })
        expect(JSON.stringify(model.requests.slice(before).map((request) => request.messages))).toContain("I12-CONTROL-COMMAND-BODY")
        expect(((await at(p().frontmatter, "GET", `/api/session?parentID=${id}`)).json?.data ?? [])).toEqual([])
      }
      if (allowed) {
        expect((await at(p().frontmatter, "POST", `/api/session/${id}/command`, { name: "cpi12controlcmd", text: "" })).status).toBe(204)
        const children = (await at(p().frontmatter, "GET", `/api/session?parentID=${id}`)).json?.data as Array<{ id: string; agent?: string }>
        expect(children).toHaveLength(1)
        expect(children[0].agent).toBe("general")
        await at(p().frontmatter, "POST", `/api/experimental/session/${children[0].id}/wait`)
        expect(JSON.stringify(model.requests.slice(before).map((request) => request.messages))).toContain("I12-CONTROL-COMMAND-BODY")
      }
    }, 60_000)

    test("agent:写了 `system` 又写了无效 `{env:}` 模型的 agent ⇒ 未允许臂:留下、用它的提示词;允许臂:与 OpenCode 一样整条不出现", async () => {
      const agents = await agentsAt(p().frontmatter)
      for (const [name, body] of [["cpi12envagent", "I12-ENV-AGENT-PROMPT"], ["cpi12mdenvagent", "I12-MD-ENV-PROMPT"]]) {
        const agent = agents.find((item) => item.id === name)
        if (allowed) expect(agent).toBeUndefined()
        else expect(agent?.system).toBe(body)
      }
    }, 60_000)

    test("agent:v1 `mode` 名字空间覆盖出厂 subagent general ⇒ 未允许臂:仍是 subagent、提示词生效;允许臂:primary。md agent 的模型与权限、`.opencode/modes/` 的 primary 同样只在允许后生效", async () => {
      const agents = await agentsAt(p().frontmatter)
      const general = agents.find((agent) => agent.id === "general")
      expect(general?.mode).toBe(allowed ? "primary" : "subagent")
      expect(general?.system).toBe("I12-MODE-GENERAL-PROMPT")
      expect(agents.find((agent) => agent.id === "explore")).toMatchObject({ mode: allowed ? "primary" : "subagent", system: "I12-DIRMODE-PROMPT" })
      if (allowed) {
        expect(general?.model).toMatchObject({ id: "m", providerID: "codepuppy" })
        expect(general?.permissions).toContainEqual({ action: "edit", resource: "CP-I12-MD-CONTROL", effect: "allow" })
      } else {
        expect(general?.model).toBeUndefined()
        expect(general?.permissions?.some((rule) => rule.resource === "CP-I12-MD-CONTROL")).toBe(false)
      }
    }, 60_000)
  })
}
