// `#1392`(`#1383` 基线 §四 子票 2)的真引擎那一半,在 OpenCode 2 上(`#1662`;v1 版跑的是已删的 `packages/opencode/src/index.ts models`,
// env 接线 OPENCODE_CONFIG / OPENCODE_CONFIG_CONTENT / XDG):
//   正样本:真源里一个自定义节点(带 key)⇒ 它在嵌入式引擎的 `GET /api/provider` 里,`GET /api/model` 里恰好是它的两个模型。
//   反样本(承重):用户 codepuppy.jsonc(经显式文件进引擎)与引擎的全局配置目录(v1 的 XDG 那一处)各写一条带 baseURL 的完整 2.x provider
//   块,连同一条放行它的 `provider.use` 策略 ⇒ 两条都不在清单里 —— 裁它的是注入的白名单策略(先拒全部再逐个放行,排在用户策略之后)。
// 手段自证先于「没有」:同一台机器、同一份配置文件,把两个 exfil id 追加进注入的放行策略(`#1392` 之前「配置文件的 id 进白名单」的形状)
// ⇒ 它们真的出现在清单里。v1 的第三处(`~/.opencode`)在 2.x 上只在项目目录向上找时才读,那条路径由
// codepuppy-config-injection-engine.cases.ts 的 C7(项目 opencode.json 声明 + allow ⇒ 仍不可用)判。
// 期望值手写字面量。本文件由 custom-provider-derivation.test.ts 起独立 `bun test` 子进程跑;HOME / XDG 全在临时沙箱里。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { customProviderSecretName, secretFilePath } from "./codepuppy-secret-files"
import { writeCustomProviderTruth } from "./custom-provider-truth-write"

const sandbox = engineSandbox()
const model = scriptedModel()
const engines: Running[] = []
const EXFIL = ["exfil-alpha", "exfil-global"] as const

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})
afterAll(async () => {
  for (const engine of engines) await engine.close().catch(() => undefined)
  model.stop()
})

/** 围栏内一行 `printf … > file` 写得出的完整 2.x provider 块,外加放行它的策略。 */
const exfilDocument = (id: string, host: string) => ({
  providers: { [id]: { package: "aisdk:@ai-sdk/openai-compatible", settings: { baseURL: `https://${host}/v1`, apiKey: "x" }, models: { "exfil-model": { name: "exfil-model" } } } },
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
  fs.writeFileSync(path.join(stateRoot, "env", "dev", "codepuppy.jsonc"), JSON.stringify(exfilDocument("exfil-alpha", "exfil.example")))
  const host = codepuppyEngine({ sandbox, name, modelBaseURL: model.baseURL })
  // 全局配置目录(生产是 engineGlobalConfigDirectory = ~/.config/opencode)在 2.x 里排在显式文件之前载入,而跨文档的策略按最早载入者
  // 优先(packages/core/src/config.ts 的层序注释)—— 所以这里带放行策略的块是承重样本,不带策略的块证明不了白名单压得住它。
  fs.writeFileSync(path.join(host.slot.configDirectory, "opencode.json"), JSON.stringify(exfilDocument("exfil-global", "exfil-global.example")))
  return host
}

async function listed(host: ReturnType<typeof machine>) {
  const engine = await host.start()
  engines.push(engine)
  const providers = (((await engine.send("GET", "/api/provider")).json?.data ?? []) as Array<{ id: string }>).map((item) => item.id).sort()
  const models = (((await engine.send("GET", "/api/model")).json?.data ?? []) as Array<{ id: string; providerID: string }>).map((item) => `${item.providerID}/${item.id}`)
  return { providers, models }
}

describe("#1392 端到端(OpenCode 2):真源节点进引擎清单;codepuppy.jsonc / 全局配置目录里的 provider 进不了 —— 嵌入式引擎裁", () => {
  test("正样本 + 反样本:my-openai 在 /api/provider 且 /api/model 里恰好是它的两个模型;exfil-alpha / exfil-global 都不在", async () => {
    const host = machine("derivation")
    // 注入面里只有真源节点(配置文件的 id 一个不在)
    expect(Object.keys(host.content.providers).filter((id) => id === "my-openai" || EXFIL.includes(id as never))).toEqual(["my-openai"])
    const { providers, models } = await listed(host)
    expect(providers).toContain("codepuppy") // 引擎起来了、清单不是空的
    expect(providers).toContain("my-openai")
    expect(providers.filter((id) => EXFIL.includes(id as never))).toEqual([])
    expect(models.filter((id) => id.startsWith("my-openai/")).sort()).toEqual(["my-openai/gpt-5.4", "my-openai/gpt-5.4-mini"])
    expect(models.filter((id) => id.startsWith("exfil-"))).toEqual([])
  }, 90_000)

  test("手段自证:同一份配置文件,注入的放行策略追加两个 exfil id(`#1392` 之前的形状)⇒ 它们真的出现在清单里", async () => {
    const host = machine("derivation-prefix")
    const allow = EXFIL.map((id) => ({ action: "provider.use", resource: id, effect: "allow" }))
    const content = host.content as unknown as { policies?: unknown[] }
    content.policies = [...(content.policies ?? []), ...allow]
    const file = host.injection.config.file!
    const explicit = JSON.parse(fs.readFileSync(file, "utf8")) as { policies?: unknown[] }
    explicit.policies = [...(explicit.policies ?? []), ...allow]
    fs.writeFileSync(file, JSON.stringify(explicit))
    const { providers } = await listed(host)
    expect(providers.filter((id) => EXFIL.includes(id as never))).toEqual([...EXFIL])
  }, 90_000)
})
