// alpha-code#1708(INT-safety I-10;ADR-040 后果 4):生产注入交给沙箱里的真 OpenCode 2 之后,项目范围的引擎插件一个都不执行,
// Code Puppy 的扩展与用户全局范围的插件照常加载。每个探针插件在模块求值的第一行写一个标记文件 —— 标记出现 = 那段脚本执行了。
//
//   · AC-01:项目 p1(HOME 下)的 `.opencode/plugins/x.js`、`.opencode/plugin/y.ts`、`opencode.json` 的相对路径 / 绝对路径 / 包名
//     三种条目,一个都不执行;同一个位置发一轮对话照常拿到回复。
//   · AC-02:项目 p2 自带一份「已同意」的 `.codepuppy/prefs.json`,结果相同。
//   · AC-04:p2 的 `opencode.json` 与 `.opencode/opencode.json` 都写 allow `plugin.use *`,仍不执行;p1 上级目录(HOME 与项目之间)
//     的 `.opencode/plugins/a.js` 不执行。
//   · AC-05:与 ext 同名的项目目录、与全局插件同名的项目文件、与用户全局的包同名的项目包(`<名字>@file:<项目里的目录>`)、
//     落进用户全局条目 `<root>/glob-*` 的项目路径 `<root>/glob-x` 都不执行。
//   · AC-03 补:用户在 codepuppy.jsonc 里自己 deny 的全局插件,改动前不加载,改动后仍不加载(我们的 allow 不盖过用户的 deny)。
//   · 按包名安装的用户全局插件(owner 2026-11-13「这个是否可以做成配置项进行配置,后续不用改代码」):用户在引擎的全局配置文件里
//     给这个包名写 allow `plugin.use` ⇒ 加载(运行中改也生效);代价:任何项目用 `<包名>@file:<项目目录>` 以这个名字运行自己的
//     代码也被放行;同样的 allow 写在 codepuppy.jsonc 里 ⇒ 不加载(显式文件里排在「拒绝全部」之前)。
//   · AC-03:ext(这里是一个放在固定路径上的桩)在两个项目里都是 active;全局配置目录里的插件文件、`opencode.json` 的相对 / 绝对
//     路径条目、HOME 一级 `~/.opencode/plugins/h.js` 照常执行;出厂命令 /init、/review 与出厂技能照常在。
//   · 已知的坏(也是改动前的实测):显式文件里去掉 `plugin.use` 语句 ⇒ 上面每一个项目标记都出现,全局的包名条目也执行。
//   · 层序的已知的坏:同一组语句只放进内联文档(排在项目配置之后)⇒ p2 自己写的 allow 胜出,它的插件执行。
// 三台引擎的顺序有讲究:包形式的插件按文件地址进模块缓存,同一进程里第二次装载不再求值(本地插件每次都重新求值),所以第一个真正
// 装载包的必须是「已知的坏」那台 —— 它排在生产注入那台(包全被拒、一个都没装载)之后、层序那台之前。
// 改动后用户全局的包名条目不再执行(只有精确路径能写成放行语句,见 engine-plugin-policy.ts),这一条在这里钉成实测。
//
// 本文件由同名 `.test.ts` 宿主起独立的 `bun test` 子进程跑:沙箱改的 HOME / XDG_* 不出那个进程。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import { homedir } from "node:os"
import * as path from "node:path"
import { assertEngineSandboxed, engineSandbox, engineSlot } from "../../test-component/engine-sandbox"
import { codepuppyEngine } from "../../test-component/codepuppy-engine"
import { buildEngineServerOptions } from "./engine-server-options"
import { withEngineAuthorization } from "./engine-authorization"
import { injectCodePuppyConfig, type CodePuppyConfigInjectionResult } from "./codepuppy-config-injection"
import { writeExplicitConfig } from "./engine-explicit-config"
import { customProviderSecretName, secretFilePath } from "./codepuppy-secret-files"
import { engineGlobalConfigDirectory } from "./engine-paths"
import { assertExtPluginActive } from "./sidecar-ext-ready"
import type { EngineFetch } from "./in-process-engine"

const sandbox = engineSandbox()
const PASSWORD = "cp-1708-plugin-policy"
const REPLY = "cp-1708 reply"
const engines: Array<{ close: () => Promise<void> }> = []
const root = path.join(sandbox.root, "cp-1708")
const userData = path.join(root, "userdata")
const ext = path.join(root, "app", "codepuppy-ext")
const p1 = path.join(sandbox.home, "work", "p1")
const p2 = path.join(root, "projects", "p2")
const p3 = path.join(root, "projects", "p3")
const neutral = path.join(root, "projects", "neutral")
const optinGlobal = path.join(root, "optin-config", "opencode")
let global = ""

const llm = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    if (!request.url.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
    const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
      `data: ${JSON.stringify({ id: "chatcmpl-cp-1708", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    return new Response(chunk({ role: "assistant", content: REPLY }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  },
})

/** 模块求值的第一行就写标记(写进本轮引擎的标记目录),再导出一个插件。 */
const probe = (marker: string, id: string) =>
  `import { appendFileSync } from "node:fs"\nimport { join } from "node:path"\nappendFileSync(join(process.env.CP_1708_MARKERS, ${JSON.stringify(marker)}), "ran\\n")\nexport default { id: ${JSON.stringify(id)}, setup: async () => {} }\n`
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
const directoryPlugin = (directory: string, marker: string) => write(path.join(directory, "server.js"), probe(marker, `cp1708.${marker}`))
const packagePlugin = (directory: string, name: string, marker: string) => {
  write(path.join(directory, "package.json"), JSON.stringify({ name, version: "1.0.0", type: "module", main: "index.js" }))
  write(path.join(directory, "index.js"), probe(marker, `cp1708.${marker}`))
}

const PROJECT_MARKERS = [
  "p1-plugins-js",
  "p1-plugin-ts",
  "p1-relative",
  "p1-absolute",
  "p1-package",
  "p1-lookalike-ext",
  "p1-lookalike-global",
  "p1-same-name-package",
  "p1-wildcard-lookalike",
  "ancestor",
  "p2-plugins-js",
  "p2-relative",
]
const USER_GLOBAL_MARKERS = ["ext", "global-file", "global-relative", "global-absolute", "home-file"]

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  process.env.CODEPUPPY_GLOBAL_DIR = path.join(root, "state", "codepuppy-state", "env", "dev")
  fs.mkdirSync(process.env.CODEPUPPY_GLOBAL_DIR, { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  // 生产 sidecar 用同一个函数算引擎的全局配置目录,并把它交给 start();这里同样。
  global = engineGlobalConfigDirectory(process.env, homedir())
  const { Global } = await import("@opencode/util/global")
  const npmCache = (spec: string) => path.join(Global.Path.cache, "npm", spec, "1000", "node_modules", spec.slice(0, spec.lastIndexOf("@")))

  // Code Puppy 的扩展(桩,固定路径)
  write(path.join(ext, "server.js"), probe("ext", "codepuppy.ext.stub"))
  // 用户全局:全局配置目录里的插件文件,opencode.json 的相对 / 绝对路径与包名条目;HOME 一级 ~/.opencode
  write(path.join(global, "plugins", "g.js"), probe("global-file", "cp1708.global-file"))
  directoryPlugin(path.join(global, "gdir"), "global-relative")
  directoryPlugin(path.join(root, "global-abs"), "global-absolute")
  packagePlugin(npmCache("cp-1708-global-pkg@1.0.0"), "cp-1708-global-pkg", "global-package")
  write(
    path.join(global, "opencode.json"),
    JSON.stringify({ plugins: ["./gdir", path.join(root, "global-abs"), "cp-1708-global-pkg@1.0.0", path.join(root, "glob-*")] }),
  )
  // 用户自己在 codepuppy.jsonc 里 deny 的一个全局插件:改动前后都不加载
  write(path.join(global, "plugins", "denied.js"), probe("global-user-denied", "cp1708.global-user-denied"))
  write(
    path.join(process.env.CODEPUPPY_GLOBAL_DIR, "codepuppy.jsonc"),
    JSON.stringify({ policies: [{ action: "plugin.use", resource: path.join(global, "plugins", "denied.js"), effect: "deny" }] }),
  )
  write(path.join(sandbox.home, ".opencode", "plugins", "h.js"), probe("home-file", "cp1708.home-file"))

  // p1:HOME 下的项目;它与 HOME 之间还有一级上级目录
  write(path.join(sandbox.home, "work", ".opencode", "plugins", "a.js"), probe("ancestor", "cp1708.ancestor"))
  write(path.join(p1, ".opencode", "plugins", "x.js"), probe("p1-plugins-js", "cp1708.p1-plugins-js"))
  write(path.join(p1, ".opencode", "plugin", "y.ts"), probe("p1-plugin-ts", "cp1708.p1-plugin-ts"))
  directoryPlugin(path.join(p1, "rel"), "p1-relative")
  directoryPlugin(path.join(root, "p1-outside"), "p1-absolute")
  packagePlugin(npmCache("cp-1708-project-pkg@1.0.0"), "cp-1708-project-pkg", "p1-package")
  directoryPlugin(path.join(p1, ".opencode", "plugins", path.basename(ext)), "p1-lookalike-ext")
  write(path.join(p1, ".opencode", "plugins", "g.js"), probe("p1-lookalike-global", "cp1708.p1-lookalike-global"))
  packagePlugin(path.join(p1, "evil"), "cp-1708-global-pkg", "p1-same-name-package")
  directoryPlugin(path.join(root, "glob-x"), "p1-wildcard-lookalike")
  write(
    path.join(p1, "opencode.json"),
    JSON.stringify({
      plugins: ["./rel", path.join(root, "p1-outside"), "cp-1708-project-pkg@1.0.0", `cp-1708-global-pkg@file:${path.join(p1, "evil")}`, path.join(root, "glob-x")],
    }),
  )

  // p2:自带「已同意」的信任记录,并在两份项目配置里都 allow plugin.use
  const allowAll = { policies: [{ action: "plugin.use", resource: "*", effect: "allow" }] }
  write(path.join(p2, ".codepuppy", "prefs.json"), JSON.stringify({ extensionsConsent: { version: 1, granted: true, decidedAt: "2026-11-13T00:00:00.000Z" } }))
  write(path.join(p2, ".opencode", "plugins", "z.js"), probe("p2-plugins-js", "cp1708.p2-plugins-js"))
  directoryPlugin(path.join(p2, "rel2"), "p2-relative")
  write(path.join(p2, "opencode.json"), JSON.stringify({ ...allowAll, plugins: ["./rel2"] }))
  write(path.join(p2, ".opencode", "opencode.json"), JSON.stringify(allowAll))

  // 按包名的用户全局插件(用另一个全局配置目录,不碰上面三台引擎的那一个);p3 用同名别名指向自己的目录
  packagePlugin(npmCache("cp-1708-optin-pkg@1.0.0"), "cp-1708-optin-pkg", "optin-global-package")
  packagePlugin(npmCache("cp-1708-cpjsonc-pkg@1.0.0"), "cp-1708-cpjsonc-pkg", "cpjsonc-allowed-package")
  packagePlugin(path.join(p3, "evil"), "cp-1708-optin-pkg", "p3-optin-alias")
  write(path.join(p3, "opencode.json"), JSON.stringify({ plugins: [`cp-1708-optin-pkg@file:${path.join(p3, "evil")}`] }))
  fs.mkdirSync(neutral, { recursive: true })

  // 出厂技能(经 CODEPUPPY_FACTORY_SKILL_DIRS 进显式文件的 skills)与一个可用的模型(自定义节点 → 本机桩)
  write(path.join(root, "factory", "cp-1708-factory-skill", "SKILL.md"), "---\nname: cp-1708-factory-skill\ndescription: factory probe\n---\n\nprobe\n")
  process.env.CODEPUPPY_FACTORY_SKILL_DIRS = JSON.stringify([path.join(root, "factory")])
  write(
    path.join(process.env.CODEPUPPY_GLOBAL_DIR, "..", "..", "custom-providers", "dev.json"),
    JSON.stringify({ v: 1, providers: [{ id: "cp-1708-model", name: "Probe", compat: "openai", baseURL: `http://127.0.0.1:${llm.port}/v1`, models: ["m"] }] }),
  )
  write(secretFilePath(userData, customProviderSecretName("cp-1708-model")), "sk-cp-1708-probe")
})

afterAll(async () => {
  for (const engine of engines.reverse()) await engine.close().catch(() => undefined)
  llm.stop(true)
})

async function engineWith(
  name: string,
  config: CodePuppyConfigInjectionResult["config"],
  modelsFile?: string,
  options: { configDirectory?: string; filewatcher?: boolean } = {},
) {
  const markers = path.join(root, "markers", name)
  fs.mkdirSync(markers, { recursive: true })
  process.env.CP_1708_MARKERS = markers
  const { startEngine } = await import("../../engine/engine-embed")
  const slot = engineSlot(sandbox, name)
  let fetch: EngineFetch | undefined
  const engine = await startEngine(
    buildEngineServerOptions({
      hostname: "127.0.0.1",
      port: 0,
      password: PASSWORD,
      engineVersion: "test",
      databasePath: slot.databasePath,
      configDirectory: options.configDirectory ?? global,
      config,
      models: { ...(modelsFile ? { file: modelsFile } : {}), fetch: false },
      filewatcher: options.filewatcher ?? false,
      platform: process.platform,
    }),
    { onDispatch: (dispatch) => (fetch = withEngineAuthorization(dispatch, PASSWORD)) },
  )
  engines.push(engine)
  const request = (directory: string, method: string, route: string, body?: unknown) =>
    fetch!(
      new Request(`http://codepuppy-sidecar.invalid${route}`, {
        method,
        headers: { "x-opencode-directory": encodeURIComponent(directory), "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
  const list = async (directory: string, route: string) =>
    ((await (await request(directory, "GET", route)).json()) as { data: Array<{ id: string; name?: string }> }).data
  /** 打开一个位置:插件清单出现并连续两次不变(本地插件与缓存里的包都装完)。 */
  const open = async (directory: string) => {
    let previous = ""
    for (let i = 0; i < 100; i++) {
      const current = JSON.stringify((await list(directory, "/api/plugin")).map((plugin) => plugin.id).sort())
      if (current !== "[]" && current === previous) return
      previous = current
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  const ran = () => fs.readdirSync(markers).sort()
  return { fetch: fetch!, request, list, open, ran }
}

/** 「去掉我们的语句」:同一份用户文件与同一层,只是不写 `#1708` 的 plugin.use(用户自己写的 policies 原样在)。 */
function explicitWithoutOurPluginPolicies(injection: CodePuppyConfigInjectionResult, name: string) {
  const file = path.join(root, `${name}.json`)
  writeExplicitConfig(file, injection.explicit!.userConfig, { ...injection.explicit!.layer, plugins: [] })
  return file
}

describe("alpha-code#1708 项目范围的引擎插件在 Code Puppy 里一律不执行", () => {
  let injection: CodePuppyConfigInjectionResult

  test("生产注入:项目插件一个都不执行(含自带「已同意」与自写 allow 的项目、上级目录、仿冒);ext 与用户全局的照常;发一轮对话拿到回复", async () => {
    injection = injectCodePuppyConfig(userData, ext, "stable")
    expect(injection.ok).toBe(true)
    const engine = await engineWith("after", injection.config, injection.models.file)
    await engine.open(p1)
    await engine.open(p2)
    await assertExtPluginActive(engine.fetch, p1, ext)
    await assertExtPluginActive(engine.fetch, p2, ext)
    const created = await engine.request(p1, "POST", "/api/session", { location: { directory: p1 }, model: { id: "m", providerID: "cp-1708-model" } })
    expect(created.status).toBe(200)
    const session = ((await created.json()) as { data: { id: string } }).data
    await engine.request(p1, "POST", `/api/session/${session.id}/prompt`, { text: "hello" })
    await engine.request(p1, "POST", `/api/experimental/session/${session.id}/wait`)
    const messages = JSON.stringify(await (await engine.request(p1, "GET", `/api/session/${session.id}/message`)).json())
    expect(messages).toContain(REPLY)
    expect((await engine.list(p1, "/api/command")).map((command) => command.name ?? command.id)).toEqual(expect.arrayContaining(["init", "review"]))
    expect((await engine.list(p1, "/api/skill")).map((skill) => skill.name ?? skill.id)).toContain("cp-1708-factory-skill")
    await new Promise((resolve) => setTimeout(resolve, 1_000))

    expect(engine.ran()).toEqual([...USER_GLOBAL_MARKERS].sort())
  }, 90_000)

  test("已知的坏(= 改动前的实测):显式文件里去掉 plugin.use ⇒ 每一个项目标记都出现,用户全局的包名条目也执行", async () => {
    const content = JSON.parse(injection.config.content) as { policies?: Array<{ action: string }> }
    const engine = await engineWith(
      "before",
      {
        content: JSON.stringify({ ...content, policies: (content.policies ?? []).filter((policy) => policy.action !== "plugin.use") }),
        file: explicitWithoutOurPluginPolicies(injection, "explicit-without-plugin-policies"),
      },
      injection.models.file,
    )
    await engine.open(p1)
    await engine.open(p2)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    expect(engine.ran()).toEqual([...PROJECT_MARKERS, ...USER_GLOBAL_MARKERS, "global-package"].sort())
  }, 90_000)

  test("层序的已知的坏:同一组 plugin.use 只放进内联文档(排在项目配置之后)⇒ p2 自写的 allow 胜出,它的插件执行;p1 没写 allow,仍不执行", async () => {
    const content = JSON.parse(injection.config.content) as { policies?: Array<{ action: string }> }
    const engine = await engineWith(
      "inline-only",
      {
        content: JSON.stringify({
          ...content,
          policies: [...(content.policies ?? []).filter((policy) => policy.action !== "plugin.use"), ...injection.explicit!.layer.plugins],
        }),
        file: explicitWithoutOurPluginPolicies(injection, "explicit-plugins-inline-only"),
      },
      injection.models.file,
    )
    await engine.open(p2)
    await engine.open(p1)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    const ran = engine.ran()
    expect(ran).toEqual(expect.arrayContaining(["p2-plugins-js", "p2-relative"]))
    expect(ran.filter((marker) => marker.startsWith("p1-") || marker === "ancestor")).toEqual([])
  }, 90_000)

  test("按包名的用户全局插件:allow 写在引擎全局配置文件里 ⇒ 加载(运行中改也生效),项目的同名别名随之加载;写在 codepuppy.jsonc 里 ⇒ 不加载", async () => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const until = async (done: () => boolean) => {
      for (let waited = 0; waited < 15_000 && !done(); waited += 200) await sleep(200)
    }
    const plugins = ["cp-1708-optin-pkg@1.0.0", "cp-1708-cpjsonc-pkg@1.0.0"]
    const allow = (resource: string) => ({ action: "plugin.use", resource, effect: "allow" })
    const globalFile = path.join(optinGlobal, "opencode.json")
    const codepuppyJsonc = path.join(process.env.CODEPUPPY_GLOBAL_DIR!, "codepuppy.jsonc")
    const saved = fs.readFileSync(codepuppyJsonc, "utf8")
    write(globalFile, JSON.stringify({ plugins }))
    write(codepuppyJsonc, JSON.stringify({ policies: [...(JSON.parse(saved) as { policies: unknown[] }).policies, allow("cp-1708-cpjsonc-pkg")] }))
    process.env.OPENCODE_CONFIG_DIR = optinGlobal
    try {
      const optin = injectCodePuppyConfig(userData, ext, "stable")
      const engine = await engineWith("optin", optin.config, optin.models.file, { configDirectory: optinGlobal, filewatcher: true })
      await engine.open(neutral)
      await sleep(1_000)
      // 今天的行为:按包名的全局条目不加载;codepuppy.jsonc 里的 allow 不起作用
      expect(engine.ran()).toEqual(["ext"])

      // 用户在引擎全局配置文件里给这个包名写 allow:引擎监听全局目录,运行中就加载
      write(globalFile, JSON.stringify({ plugins, policies: [allow("cp-1708-optin-pkg")] }))
      await until(() => engine.ran().includes("optin-global-package"))
      expect(engine.ran()).toContain("optin-global-package")
      // 代价:按名字放行 ⇒ 项目用同名别名指向自己的目录,它的代码也执行
      await engine.open(p3)
      await until(() => engine.ran().includes("p3-optin-alias"))
      expect(engine.ran()).toContain("p3-optin-alias")
      // codepuppy.jsonc 里那条 allow 仍不起作用
      expect(engine.ran()).not.toContain("cpjsonc-allowed-package")

      // 对照:同一个包,allow 写进引擎全局配置文件 ⇒ 加载(上面它不加载,是放行写错了地方,不是包装不上)
      write(globalFile, JSON.stringify({ plugins, policies: [allow("cp-1708-optin-pkg"), allow("cp-1708-cpjsonc-pkg")] }))
      await until(() => engine.ran().includes("cpjsonc-allowed-package"))
      expect(engine.ran()).toContain("cpjsonc-allowed-package")
    } finally {
      delete process.env.OPENCODE_CONFIG_DIR
      fs.writeFileSync(codepuppyJsonc, saved)
    }
  }, 120_000)

  test("测试宿主在注入后追加的重试插件按精确路径加载,项目里同名同 id 的插件不执行", async () => {
    const host = codepuppyEngine({ sandbox, name: "plugin-policy-host", modelBaseURL: `http://127.0.0.1:${llm.port}/v1`, ext: false })
    const retryNow = path.join(sandbox.root, "plugin-policy-host", "retry-now")
    const marker = path.join(sandbox.root, "host-retry-ran")
    const lookalikeMarker = path.join(sandbox.root, "project-retry-ran")
    // 来源:turn-failure.engine.cases.ts 的 retry-now 插件;仅加模块求值标记,证明项目的同 id 插件连第一行都没执行。
    const source = (file: string) => `import { appendFileSync } from "node:fs"
appendFileSync(${JSON.stringify(file)}, "ran\\n")
export default { id: "codepuppy.test.retry-now", setup: async (ctx) => {
  await ctx.session.hook("retry", (event) => { if (event.decision.retry) event.decision = { retry: true, delay: 0 } })
} }\n`
    write(path.join(retryNow, "server.js"), source(marker))
    write(path.join(host.projectDirectory, ".opencode", "plugins", "retry-now", "server.js"), source(lookalikeMarker))
    host.content.plugins.push(retryNow)
    const running = await host.start()
    try {
      const plugins = (await running.send("GET", "/api/plugin")).json.data as Array<{ id: string; state: { status: string } }>
      expect(plugins.find((plugin) => plugin.id === "codepuppy.test.retry-now")?.state.status).toBe("active")
      expect(fs.existsSync(marker)).toBe(true)
      expect(fs.existsSync(lookalikeMarker)).toBe(false)
      const policies = JSON.parse(fs.readFileSync(host.injection.config.file!, "utf8")).policies as Array<{ action: string; resource: string; effect: string }>
      expect(policies).toContainEqual({ action: "plugin.use", resource: retryNow, effect: "allow" })
      expect(policies.filter((policy) => policy.action === "plugin.use" && policy.effect === "allow").every((policy) => path.isAbsolute(policy.resource) && !/[*?]/.test(policy.resource))).toBe(true)
    } finally {
      await running.close()
    }
  }, 60_000)
})
