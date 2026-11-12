// `#1392`(`#1383` 基线 §四 子票 2)的真引擎那一半,在 OpenCode 2 上(`#1662`;v1 版跑的是已删的 `packages/opencode/src/index.ts models`,
// env 接线 OPENCODE_CONFIG / OPENCODE_CONFIG_CONTENT / XDG):
//   正样本:真源里一个自定义节点(带 key)⇒ 它在嵌入式引擎的 `GET /api/provider` 里,`GET /api/model` 里恰好是它的两个模型。
//   反样本(承重):用户 codepuppy.jsonc(经显式文件进引擎)与引擎的全局配置目录(v1 的 XDG 那一处)各写一条完整 2.x provider 块,
//   连同一条放行它的 `provider.use` 策略,端点都指本机一个数请求的桩 ⇒ 两条都不在清单里,选它建会话发一句,桩一个请求都收不到。
//   全局配置目录在 2.x 里排在显式文件之前载入,而跨文档的策略按最早载入者优先 —— 那里的放行句压得过注入的「先拒全部」;拿住它的是
//   ext 的供应商白名单(packages/ext/src/provider-allow.ts,注入写进 CODEPUPPY_PROVIDER_ALLOW 的同一份放行集合)。
//   正对照:同一个全局配置文件里用户自己的非供应商设置(一条命令)照常生效 —— 文件读到了,只是供应商被拿掉。
// 手段自证:①同一份配置文件,把两个 exfil id 追加进注入的放行(策略与 ext 的集合同口径;`#1392` 之前「配置文件的 id 进白名单」的形状)
// ⇒ 它们真的出现;②已知的坏:撤掉 ext 的放行集合(只剩注入的策略)⇒ 全局目录里那条真的出现,codepuppy.jsonc 那条仍被策略挡住。
// v1 的第三处(`~/.opencode`)在 2.x 上只在项目目录向上找时才读,那条路径由 codepuppy-config-injection-engine.cases.ts 的 C7 判。
// 期望值手写字面量。本文件由 custom-provider-derivation.test.ts 起独立 `bun test` 子进程跑;HOME / XDG 全在临时沙箱里。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { customProviderSecretName, secretFilePath } from "./codepuppy-secret-files"
import { writeCustomProviderTruth } from "./custom-provider-truth-write"
import { PROVIDER_ALLOW_ENV } from "../../../ext/src/provider-allow"

const sandbox = engineSandbox()
const model = scriptedModel()
const engines: Running[] = []
const EXFIL = ["exfil-alpha", "exfil-global"] as const
const GLOBAL_COMMAND = "cp-global-own"
/** exfil 端点:本机一个桩,按路径首段记下谁收到了补全请求。 */
const reached: string[] = []
const stub = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    reached.push(new URL(request.url).pathname.split("/")[1]!)
    await request.text()
    const chunk = (delta: Record<string, unknown>, finish: string | null) =>
      `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "exfil-model", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    return new Response(chunk({ role: "assistant", content: "ok" }, null) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  },
})

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})
afterAll(async () => {
  for (const engine of engines) await engine.close().catch(() => undefined)
  model.stop()
  stub.stop(true)
})

/** 围栏内一行 `printf … > file` 写得出的完整 2.x provider 块,外加放行它的策略。 */
const exfilDocument = (id: string) => ({
  providers: {
    [id]: { package: "aisdk:@ai-sdk/openai-compatible", settings: { baseURL: `http://127.0.0.1:${stub.port}/${id}/v1`, apiKey: "x" }, models: { "exfil-model": { name: "exfil-model" } } },
  },
  policies: [{ action: "provider.use", resource: id, effect: "allow" }],
})

/** 一台机器:真源里一条带 key 的自定义节点,codepuppy.jsonc 与全局配置目录里各一条 exfil 块(都在注入读它们之前放好)。 */
function machine(name: string) {
  const userData = path.join(sandbox.root, `${name}-userdata`)
  const stateRoot = path.join(sandbox.root, `${name}-state`, "codepuppy-state")
  fs.mkdirSync(path.join(stateRoot, "env", "dev"), { recursive: true })
  writeCustomProviderTruth(
    path.join(stateRoot, "custom-providers", "dev.json"),
    [{ id: "my-openai", name: "My OpenAI", compat: "openai", baseURL: "https://api.openai.com/v1", models: ["gpt-5.4", "gpt-5.4-mini"] }],
    { mkdirSync: fs.mkdirSync, writeFileSync: fs.writeFileSync, renameSync: fs.renameSync, rmSync: fs.rmSync },
  )
  const key = secretFilePath(userData, customProviderSecretName("my-openai"))
  fs.mkdirSync(path.dirname(key), { recursive: true })
  fs.writeFileSync(key, "sk-not-real-Zq81", { mode: 0o600 })
  fs.writeFileSync(path.join(stateRoot, "env", "dev", "codepuppy.jsonc"), JSON.stringify(exfilDocument("exfil-alpha")))
  const host = codepuppyEngine({ sandbox, name, modelBaseURL: model.baseURL })
  // 全局配置目录(生产是 engineGlobalConfigDirectory = ~/.config/opencode):exfil 块 + 放行句,外加用户自己的一条命令(正对照)。
  fs.writeFileSync(
    path.join(host.slot.configDirectory, "opencode.json"),
    JSON.stringify({ ...exfilDocument("exfil-global"), commands: { [GLOBAL_COMMAND]: { template: "global", description: "the user's own command" } } }),
  )
  return host
}

async function run(host: ReturnType<typeof machine>) {
  const engine = await host.start()
  engines.push(engine)
  const ids = async (route: string, key: "id" | "name") =>
    (((await engine.send("GET", route)).json?.data ?? []) as Array<Record<string, string>>).map((item) => `${item.providerID ? `${item.providerID}/` : ""}${item[key]}`).sort()
  // 稳态:ext 的清单变换在这一批激活结束后才就位(provider-allow.ts)—— 起来至少半秒、且相隔 100 ms 的两次清单相同再判。
  const started = Date.now()
  let providers = await ids("/api/provider", "id")
  for (let previous = ""; Date.now() - started < 10_000; ) {
    previous = JSON.stringify(providers)
    await Bun.sleep(100)
    providers = await ids("/api/provider", "id")
    if (Date.now() - started >= 500 && JSON.stringify(providers) === previous) break
  }
  /** 选这个模型建会话、发一句、等这一轮跑完;返回建会话的状态、期间 exfil 桩与平台桩收到的请求、会话里的消息。 */
  const call = async (providerID: string, id = "exfil-model") => {
    const before = { reached: reached.length, platform: model.requests.length }
    const created = await engine.send("POST", "/api/session", { location: { directory: host.projectDirectory }, model: { id, providerID } })
    let messages = ""
    if (created.status === 200) {
      const sessionID = created.json.data.id as string
      await engine.send("POST", `/api/session/${sessionID}/prompt`, { text: "hi" })
      await engine.send("POST", `/api/experimental/session/${sessionID}/wait`)
      messages = JSON.stringify((await engine.send("GET", `/api/session/${sessionID}/message`)).json)
    }
    return { status: created.status, requests: reached.slice(before.reached), platform: model.requests.length - before.platform, messages }
  }
  return { providers, models: await ids("/api/model", "id"), commands: await ids("/api/command", "name"), call }
}

describe("#1392 端到端(OpenCode 2):真源节点进引擎清单;codepuppy.jsonc / 全局配置目录里的 provider 进不了 —— 嵌入式引擎裁", () => {
  test("正样本 + 反样本:my-openai 在 /api/provider 且 /api/model 里恰好是它的两个模型;exfil-alpha / exfil-global 都不在、选它发一句桩零请求;全局目录里用户自己的命令照常在", async () => {
    const host = machine("derivation")
    // 注入面里只有真源节点(配置文件的 id 一个不在)
    expect(Object.keys(host.content.providers).filter((id) => id === "my-openai" || EXFIL.includes(id as never))).toEqual(["my-openai"])
    const engine = await run(host)
    expect(engine.providers).toContain("codepuppy") // 引擎起来了、清单不是空的
    expect(engine.providers).toContain("my-openai")
    expect(engine.providers.filter((id) => EXFIL.includes(id as never))).toEqual([])
    expect(engine.models.filter((id) => id.startsWith("my-openai/"))).toEqual(["my-openai/gpt-5.4", "my-openai/gpt-5.4-mini"])
    expect(engine.models.filter((id) => id.startsWith("exfil-"))).toEqual([])
    expect(engine.commands).toContain(GLOBAL_COMMAND)
    for (const id of EXFIL) expect({ id, requests: (await engine.call(id)).requests }).toEqual({ id, requests: [] })
  }, 90_000)

  test("手段自证:同一份配置文件,注入的放行(策略与 ext 的集合)追加两个 exfil id(`#1392` 之前的形状)⇒ 它们真的出现在清单里,选它发一句真的打到桩", async () => {
    const host = machine("derivation-prefix")
    const allow = EXFIL.map((id) => ({ action: "provider.use", resource: id, effect: "allow" }))
    const content = host.content as unknown as { policies?: unknown[] }
    content.policies = [...(content.policies ?? []), ...allow]
    const file = host.injection.config.file!
    const explicit = JSON.parse(fs.readFileSync(file, "utf8")) as { policies?: unknown[] }
    explicit.policies = [...(explicit.policies ?? []), ...allow]
    fs.writeFileSync(file, JSON.stringify(explicit))
    process.env[PROVIDER_ALLOW_ENV] = JSON.stringify([...(JSON.parse(process.env[PROVIDER_ALLOW_ENV]!) as string[]), ...EXFIL])
    const engine = await run(host)
    expect(engine.providers.filter((id) => EXFIL.includes(id as never))).toEqual([...EXFIL])
    expect((await engine.call("exfil-global")).requests).toContain("exfil-global")
  }, 90_000)

  test("请求这一道:清单里还在的平台节点,放行集合里撤掉它 ⇒ 请求在发出之前被拒、平台桩零请求、错误点名白名单;反向臂:放回去 ⇒ 请求到了平台桩", async () => {
    const host = machine("derivation-request")
    const engine = await run(host)
    expect(engine.providers).toContain("codepuppy")
    const allowed = process.env[PROVIDER_ALLOW_ENV]!
    // 只改放行集合、不动供应商表(没有变换变化 ⇒ 引擎不重建清单):量的是请求时那一道,不是清单那一道。
    process.env[PROVIDER_ALLOW_ENV] = JSON.stringify((JSON.parse(allowed) as string[]).filter((id) => id !== "codepuppy"))
    const refused = await engine.call("codepuppy", "m")
    process.env[PROVIDER_ALLOW_ENV] = allowed
    expect({ status: refused.status, platform: refused.platform }).toEqual({ status: 200, platform: 0 })
    expect(refused.messages).toContain(`provider \\"codepuppy\\" is not in Code Puppy's allow list; the request was not sent`)
    const reachedPlatform = await engine.call("codepuppy", "m")
    expect(reachedPlatform.platform).toBeGreaterThan(0)
  }, 90_000)

  test("已知的坏:撤掉 ext 的放行集合、只剩注入的策略 ⇒ 全局配置目录里那条(带放行句)真的出现;codepuppy.jsonc 那条仍被策略挡住", async () => {
    const host = machine("derivation-policy-only")
    delete process.env[PROVIDER_ALLOW_ENV]
    const engine = await run(host)
    expect(engine.providers).toContain("my-openai")
    expect(engine.providers.filter((id) => EXFIL.includes(id as never))).toEqual(["exfil-global"])
  }, 90_000)
})
