// #1713 / ADR-040 后果 4:项目来源的引擎插件跟随生产信任记录;用户全局来源照 OpenCode 原样加载。
// 样本沿用 #1708 真引擎探针的目录、包缓存、同名别名与通配路径写法。每个插件求值第一行写标记,断言实际执行。
// 允许臂先跑;两臂的包使用不同版本与缓存地址,避免模块缓存把第二次装载伪装成「没有执行」。
// 本文件由同名 .test.ts 在独立子进程中运行,所有 HOME、配置、包缓存、模型请求都在沙箱里。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox, engineSlot } from "../../test-component/engine-sandbox"
import { allowProject } from "../../test-component/codepuppy-engine"
import { buildEngineServerOptions } from "./engine-server-options"
import { withEngineAuthorization } from "./engine-authorization"
import { injectCodePuppyConfig, type CodePuppyConfigInjectionResult } from "./codepuppy-config-injection"
import { writeExplicitConfig } from "./engine-explicit-config"
import { customProviderSecretName, secretFilePath } from "./codepuppy-secret-files"
import { assertExtPluginActive } from "./sidecar-ext-ready"
import type { EngineFetch } from "./in-process-engine"
import { engineProjectTrust } from "./engine-project-trust"
import { codepuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import { publishTestBootstrap } from "../../test-component/codepuppy-bootstrap-fixture"

const sandbox = engineSandbox()
const PASSWORD = "cp-1713-plugin-trust"
const REPLY = "cp-1713 reply"
const engines: Array<{ close: () => Promise<void> }> = []
const root = path.join(sandbox.root, "cp-1713-plugins")
const userData = path.join(root, "userdata")
const ext = path.join(root, "app", "codepuppy-ext")
const globalRoot = path.join(root, "state", "codepuppy-state", "env", "dev")
const global = path.join(sandbox.home, ".config", "opencode")

const llm = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    if (!request.url.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
    const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
      `data: ${JSON.stringify({ id: "chatcmpl-cp-1713", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    return new Response(chunk({ role: "assistant", content: REPLY }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  },
})

const probe = (marker: string, id: string) =>
  `import { appendFileSync } from "node:fs"\nimport { join } from "node:path"\nappendFileSync(join(process.env.CP_1713_MARKERS, ${JSON.stringify(marker)}), "ran\\n")\nexport default { id: ${JSON.stringify(id)}, setup: async () => {} }\n`
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
const directoryPlugin = (directory: string, marker: string) => write(path.join(directory, "server.js"), probe(marker, `cp1713.${marker}`))
const packagePlugin = (directory: string, name: string, marker: string) => {
  write(path.join(directory, "package.json"), JSON.stringify({ name, version: "1.0.0", type: "module", main: "index.js" }))
  write(path.join(directory, "index.js"), probe(marker, `cp1713.${marker}`))
}
const PROJECT_MARKERS = [
  "p1-plugins-js", "p1-plugin-ts", "p1-relative", "p1-absolute", "p1-package", "p1-file-url",
  "p1-lookalike-ext", "p1-lookalike-global", "p1-same-name-package", "p1-wildcard-lookalike", "ancestor", "p2-plugins-js", "p2-relative",
]
const USER_GLOBAL_MARKERS = ["ext", "global-file", "global-relative", "global-absolute", "global-package", "user-package", "home-file", "global-wildcard-literal"]

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  fs.mkdirSync(globalRoot, { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  write(path.join(ext, "server.js"), probe("ext", "codepuppy.ext.stub"))
  write(path.join(global, "plugins", "g.js"), probe("global-file", "cp1713.global-file"))
  directoryPlugin(path.join(global, "gdir"), "global-relative")
  directoryPlugin(path.join(root, "global-abs"), "global-absolute")
  directoryPlugin(path.join(root, "glob-*"), "global-wildcard-literal")
  write(path.join(global, "plugins", "denied.js"), probe("global-user-denied", "cp1713.global-user-denied"))
  write(path.join(sandbox.home, ".opencode", "plugins", "h.js"), probe("home-file", "cp1713.home-file"))
  write(path.join(root, "factory", "cp-1713-factory-skill", "SKILL.md"), "---\nname: cp-1713-factory-skill\ndescription: factory probe\n---\n\nprobe\n")
  publishTestBootstrap({ globalRoot, userData, engineConfigDirectory: global, engine: { filewatcher: false }, factoryDirs: [path.join(root, "factory")] })
  write(path.join(globalRoot, "..", "..", "custom-providers", "dev.json"), JSON.stringify({ v: 1, providers: [{ id: "cp-1713-model", name: "Probe", compat: "openai", baseURL: `http://127.0.0.1:${llm.port}/v1`, models: ["m"] }] }))
  write(secretFilePath(userData, customProviderSecretName("cp-1713-model")), "sk-cp-1713-probe")
})

afterAll(async () => {
  for (const engine of engines.reverse()) await engine.close().catch(() => undefined)
  llm.stop(true)
})

async function fixture(arm: "allowed" | "unallowed") {
  const p1 = path.join(sandbox.home, "work", arm, "p1")
  const p2 = path.join(root, "projects", arm, "p2")
  const version = arm === "allowed" ? "1.0.0" : "2.0.0"
  const { Global } = await import("@opencode/util/global")
  const npmCache = (name: string) => path.join(Global.Path.cache, "npm", `${name}@${version}`, "1000", "node_modules", name)
  packagePlugin(npmCache("cp-1713-global-pkg"), "cp-1713-global-pkg", "global-package")
  packagePlugin(npmCache("cp-1713-user-pkg"), "cp-1713-user-pkg", "user-package")
  packagePlugin(npmCache("cp-1713-project-pkg"), "cp-1713-project-pkg", "p1-package")
  write(path.join(global, "opencode.json"), JSON.stringify({ plugins: ["./gdir", path.join(root, "global-abs"), `cp-1713-global-pkg@${version}`, path.join(root, "glob-*")] }))
  const userConfig = path.join(globalRoot, "codepuppy.jsonc")
  write(userConfig, JSON.stringify({ plugins: [`cp-1713-user-pkg@${version}`], policies: [{ action: "plugin.use", resource: path.join(global, "plugins", "denied.js"), effect: "deny" }] }))

  write(path.join(sandbox.home, "work", arm, ".opencode", "plugins", "a.js"), probe("ancestor", "cp1713.ancestor"))
  write(path.join(p1, ".opencode", "plugins", "x.js"), probe("p1-plugins-js", "cp1713.p1-plugins-js"))
  write(path.join(p1, ".opencode", "plugin", "y.ts"), probe("p1-plugin-ts", "cp1713.p1-plugin-ts"))
  directoryPlugin(path.join(p1, "rel"), "p1-relative")
  directoryPlugin(path.join(root, arm, "p1-outside"), "p1-absolute")
  directoryPlugin(path.join(p1, "file-url"), "p1-file-url")
  directoryPlugin(path.join(p1, ".opencode", "plugins", path.basename(ext)), "p1-lookalike-ext")
  write(path.join(p1, ".opencode", "plugins", "g.js"), probe("p1-lookalike-global", "cp1713.p1-lookalike-global"))
  packagePlugin(path.join(p1, "evil"), "cp-1713-global-pkg", "p1-same-name-package")
  directoryPlugin(path.join(root, `glob-${arm}`), "p1-wildcard-lookalike")
  write(path.join(p1, "opencode.json"), JSON.stringify({ plugins: ["./rel", path.join(root, arm, "p1-outside"), `cp-1713-project-pkg@${version}`, `cp-1713-global-pkg@file:${path.join(p1, "evil")}`, path.join(root, `glob-${arm}`), `file://${path.join(p1, "file-url")}`] }))
  // 原 #1708 的实际探针输入:项目自带「已同意」,并在两份文档里自写 allow;它们不是生产信任记录。
  const allowAll = { policies: [{ action: "plugin.use", resource: "*", effect: "allow" }] }
  write(path.join(p2, ".codepuppy", "prefs.json"), JSON.stringify({ extensionsConsent: { version: 1, granted: true, decidedAt: "2026-11-13T00:00:00.000Z" } }))
  write(path.join(p2, ".opencode", "plugins", "z.js"), probe("p2-plugins-js", "cp1713.p2-plugins-js"))
  directoryPlugin(path.join(p2, "rel2"), "p2-relative")
  write(path.join(p2, "opencode.json"), JSON.stringify({ ...allowAll, plugins: ["./rel2"] }))
  write(path.join(p2, ".opencode", "opencode.json"), JSON.stringify(allowAll))
  if (arm === "allowed") {
    allowProject(p1)
    allowProject(p2)
  }
  return { p1, p2 }
}

async function engineWith(name: string, config: CodePuppyConfigInjectionResult["config"], modelsFile?: string) {
  const markers = path.join(root, "markers", name)
  fs.mkdirSync(markers, { recursive: true })
  process.env.CP_1713_MARKERS = markers
  const { startEngine } = await import("../../engine/engine-embed")
  const slot = engineSlot(sandbox, name)
  let fetch: EngineFetch | undefined
  const engine = await startEngine(buildEngineServerOptions({
    hostname: "127.0.0.1", port: 0, password: PASSWORD, engineVersion: "test", databasePath: slot.databasePath,
    configDirectory: global, config, models: { ...(modelsFile ? { file: modelsFile } : {}), fetch: false }, filewatcher: false, platform: process.platform,
  }), { onDispatch: (dispatch) => (fetch = withEngineAuthorization(dispatch, PASSWORD)), projectTrust: engineProjectTrust })
  engines.push(engine)
  const request = (directory: string, method: string, route: string, body?: unknown) => fetch!(new Request(`http://codepuppy-sidecar.invalid${route}`, {
    method, headers: { "x-opencode-directory": encodeURIComponent(directory), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
  const list = async (directory: string, route: string) => ((await (await request(directory, "GET", route)).json()) as { data: Array<{ id: string; name?: string }> }).data
  const open = async (directory: string) => {
    let previous = ""
    for (let i = 0; i < 100; i++) {
      const current = JSON.stringify((await list(directory, "/api/plugin")).map((plugin) => plugin.id).sort())
      if (current !== "[]" && current === previous) return
      previous = current
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  return { fetch: fetch!, request, list, open, ran: () => fs.readdirSync(markers).sort() }
}

for (const arm of ["allowed", "unallowed"] as const) {
  describe(`#1713 插件 ${arm === "allowed" ? "允许" : "未允许"}臂`, () => {
    let projects: Awaited<ReturnType<typeof fixture>>
    let injection: CodePuppyConfigInjectionResult
    let engine: Awaited<ReturnType<typeof engineWith>>

    test("项目插件:目录、配置条目、自带已同意、自写 allow、上级目录与同名 / 包名 / 通配路径按生产信任生效", async () => {
      projects = await fixture(arm)
      injection = injectCodePuppyConfig(userData, ext, "stable", codepuppyBootstrap().paths.userConfig ?? null)
      expect(injection.ok).toBe(true)
      engine = await engineWith(arm, injection.config, injection.models.file)
      await engine.open(projects.p1)
      await engine.open(projects.p2)
      const ran = engine.ran().filter((marker) => PROJECT_MARKERS.includes(marker))
      expect(ran).toEqual(arm === "allowed" ? [...PROJECT_MARKERS].sort() : [])
    }, 90_000)

    test("用户全局:目录、HOME 一级、包名与 codepuppy.jsonc 插件都执行;扩展、出厂命令 / 技能与对话照常", async () => {
      const ran = engine.ran()
      expect(ran).toEqual(expect.arrayContaining(USER_GLOBAL_MARKERS))
      for (const directory of [projects.p1, projects.p2]) await assertExtPluginActive(engine.fetch, directory, ext)
      expect((await engine.list(projects.p1, "/api/command")).map((command) => command.name ?? command.id)).toEqual(expect.arrayContaining(["init", "review"]))
      expect((await engine.list(projects.p1, "/api/skill")).map((skill) => skill.name ?? skill.id)).toContain("cp-1713-factory-skill")
      const created = await engine.request(projects.p1, "POST", "/api/session", { location: { directory: projects.p1 }, model: { id: "m", providerID: "cp-1713-model" } })
      expect(created.status).toBe(200)
      const session = ((await created.json()) as { data: { id: string } }).data
      await engine.request(projects.p1, "POST", `/api/session/${session.id}/prompt`, { text: "hello" })
      await engine.request(projects.p1, "POST", `/api/experimental/session/${session.id}/wait`)
      expect(JSON.stringify(await (await engine.request(projects.p1, "GET", `/api/session/${session.id}/message`)).json())).toContain(REPLY)
    }, 90_000)

    test("用户的 plugin.use deny 仍生效;反向臂:只去掉用户的 deny ⇒ 同一个全局插件执行", async () => {
      expect(engine.ran()).not.toContain("global-user-denied")
      const file = path.join(root, `${arm}-without-user-deny.json`)
      // 同一用户文件与同一层,只去掉用户的 deny;其余字段(含用户插件)原样。
      const user = JSON.parse(fs.readFileSync(injection.explicit!.userConfig!, "utf8")) as { policies?: unknown[] }
      const userFile = path.join(root, `${arm}-user-without-deny.json`)
      write(userFile, JSON.stringify({ ...user, policies: [] }))
      writeExplicitConfig(file, userFile, injection.explicit!.layer)
      const opposite = await engineWith(`${arm}-without-user-deny`, { ...injection.config, file }, injection.models.file)
      await opposite.open(projects.p1)
      expect(opposite.ran()).toContain("global-user-denied")
    }, 90_000)
  })
}
