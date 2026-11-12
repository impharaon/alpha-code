// REQ-228 `#1420` 在 OpenCode 2 上(`#1662` parity B5;v1 版跑的是已删的 `packages/opencode/src/index.ts models --verbose`):
// 「这个模型能不能看图」走到**真引擎**的最终值 `capabilities.input.image`。看不了图的模型收到的图片被引擎换成说明;云端识图插件
// (`#1419`)也按它决定原样放行还是转写。所以只判 buildCodePuppyModelConfig 的产物不够 —— 这里把生产注入交给嵌进 sidecar 的引擎,
// 问它的 `GET /api/model`(每个模型的完整 2.x 形状,`capabilities.input` 是输入模态数组),逐个模型取它最终认的值。
//
// 期望值手写字面量(抄自 models.dev 2026-09-23 快照与 2026-10-31 直连带图实测,出处同 v1 版):直连能看图的是 qwen3.8-max / kimi-k3 /
// kimi-k2.6 / deepseek-flash;平台模型一个都不能(网关聊天入口拒收图片);自定义节点只有用户声明的那个。
// 手段自证:同一份注入只删掉每个模型的输入能力(内联文档与 models 底表两处)⇒ 直连能看图的全部退回 false —— 证明「能看」来自注入,
// 不是引擎自己知道。v1 的第二个反向臂(id 恰好叫 `openai` 的自定义节点从 models.dev 继承到 image:true)在 2.x 上没有对象:注入给
// 引擎的 models 底表是 Code Puppy 自己的投影(`materializeGovernedModelsBase`),引擎离线、不合并外来的 models.dev 行,这里改判
// 「同名 openai 节点没声明就不能看图」。
//
// 本文件由同名 `.test.ts` 宿主起独立 `bun test` 子进程跑。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, type Running } from "../../test-component/codepuppy-engine"
import { getModelCatalog } from "./codepuppy-models"
import { pinAppliedCatalog, writeCatalogSnapshot } from "./codepuppy-live-allowlist"
import { customProviderSecretName, secretFilePath } from "./codepuppy-secret-files"
import { writeCustomProviderTruth } from "./custom-provider-truth-write"

const sandbox = engineSandbox()
const model = scriptedModel()
const engines: Running[] = []

/** 手写期望:引擎应判「能看图」的全部 (provider, model)。 */
const EXPECTED_IMAGE = ["alibaba-byok/qwen3.8-max", "deepseek-byok/deepseek-flash", "moonshot-byok/kimi-k2.6", "moonshot-byok/kimi-k3", "my-vision/vl-a"]

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})
afterAll(async () => {
  for (const engine of engines) await engine.close().catch(() => undefined)
  model.stop()
})

/** 一台「装好了平台目录、全部直连 key、两条自定义节点」的机器(在注入之前把这些放到注入读的位置)。 */
function machine(name: string) {
  const userData = path.join(sandbox.root, `${name}-userdata`)
  const stateRoot = path.join(sandbox.root, `${name}-state`, "codepuppy-state")
  fs.mkdirSync(path.join(stateRoot, "env", "dev"), { recursive: true })
  const plant = (secret: string) => {
    fs.mkdirSync(path.dirname(secretFilePath(userData, secret)), { recursive: true })
    fs.writeFileSync(secretFilePath(userData, secret), `sk-fake-${secret}`, { mode: 0o600 })
  }
  for (const secret of ["CODEPUPPY_API_KEY", ...getModelCatalog(userData).byokProviders.map((provider) => provider.keyEnv)]) plant(secret)
  // `#1556` AC1:平台段只来自已应用快照 —— 用上游 V3 producer fixture 写 LKG 并钉住
  const v3 = JSON.parse(
    fs.readFileSync(path.join(import.meta.dir, "../../../codepuppy-contracts-consumer/vendor/alpha-platform-model-catalog/contracts/v3/fixtures/producer/model-catalog.json"), "utf8"),
  ).value
  writeCatalogSnapshot(userData, {
    fetchedAt: "2026-10-30T00:00:00Z",
    edition: v3.edition,
    pricingBasisModelId: v3.pricing_basis_model_id,
    models: v3.data.map((row: any) => ({ id: row.id, provider: row.provider, minPlan: row.min_plan, pricing: row.pricing_multiplier, display: row.display })),
  })
  pinAppliedCatalog(userData, 1)
  // 两条自定义记录:一条用户声明了 vl-a 能看图;一条 id 恰好与 models.dev 的 provider 同名、没声明任何东西
  writeCustomProviderTruth(
    path.join(stateRoot, "custom-providers", "dev.json"),
    [
      { id: "my-vision", name: "My Vision", compat: "openai", baseURL: "https://vision.invalid/v1", models: ["vl-a", "text-b"], imageInput: ["vl-a"] },
      { id: "openai", name: "Same id as models.dev", compat: "openai", baseURL: "https://proxy.invalid/v1", models: ["gpt-5.4"] },
    ],
    { mkdirSync: fs.mkdirSync, writeFileSync: fs.writeFileSync, renameSync: fs.renameSync, rmSync: fs.rmSync },
  )
  for (const id of ["my-vision", "openai"]) plant(customProviderSecretName(id))
  return codepuppyEngine({ sandbox, name, modelBaseURL: model.baseURL, platformModels: null })
}

/** `GET /api/model` 的一行(2.x 形状):`capabilities.input` 是输入模态的数组。 */
type Listed = { id: string; providerID: string; capabilities?: { input?: string[] } }

/** 注入里的每个 (provider, model) → 引擎最终认的 image 值;引擎没列出的记成 "<missing>"(不许静默当 false)。 */
async function verdicts(host: ReturnType<typeof machine>) {
  const engine = await host.start()
  engines.push(engine)
  const listed = ((await engine.send("GET", "/api/model")).json?.data ?? []) as Listed[]
  const injected = Object.entries(host.content.providers).flatMap(([provider, def]) => Object.keys((def as { models?: object }).models ?? {}).map((id) => `${provider}/${id}`))
  return Object.fromEntries(
    injected.map((key) => {
      const [provider, ...rest] = key.split("/")
      const input = listed.find((item) => item.providerID === provider && item.id === rest.join("/"))?.capabilities?.input
      return [key, Array.isArray(input) ? input.includes("image") : "<missing>"]
    }),
  ) as Record<string, boolean | "<missing>">
}

describe("REQ-228 #1420:真引擎的 capabilities.input.image —— 直连按目录、平台一律不能、自定义只认用户声明", () => {
  test("生产注入 ⇒ 引擎恰好判这五个能看图,其余(含全部平台模型、没声明的同名 openai 节点)都不能", async () => {
    const result = await verdicts(machine("image"))
    // 被测对象不是空集:平台、直连、自定义都真的进了引擎
    expect(Object.keys(result).filter((key) => key.startsWith("codepuppy/")).length, JSON.stringify(result)).toBeGreaterThanOrEqual(10)
    expect(Object.keys(result).filter((key) => key.includes("-byok/")).length).toBe(10)
    expect(Object.entries(result).filter(([, value]) => value === "<missing>")).toEqual([])
    expect(Object.entries(result).filter(([, value]) => value === true).map(([key]) => key).sort()).toEqual(EXPECTED_IMAGE)
    for (const [key, value] of Object.entries(result)) if (key.startsWith("codepuppy/")) expect({ key, image: value }).toEqual({ key, image: false })
    expect(result["openai/gpt-5.4"]).toBe(false)
  }, 90_000)

  test("手段自证:同一份注入只删掉每个模型的输入能力 ⇒ 直连与自定义里能看图的全部退回 false", async () => {
    const host = machine("image-stripped")
    const strip = (providers: Record<string, { models?: Record<string, { capabilities?: Record<string, unknown> }> }>) => {
      for (const def of Object.values(providers)) for (const item of Object.values(def.models ?? {})) delete item.capabilities?.input
    }
    strip(host.content.providers as never)
    const file = host.injection.models.file
    if (file) {
      const base = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { models?: Record<string, { capabilities?: Record<string, unknown>; modalities?: unknown }> }>
      for (const def of Object.values(base)) for (const item of Object.values(def.models ?? {})) {
        delete item.capabilities?.input
        delete item.modalities
      }
      fs.writeFileSync(file, JSON.stringify(base))
    }
    const result = await verdicts(host)
    expect(Object.entries(result).filter(([, value]) => value === true).map(([key]) => key)).toEqual([])
  }, 90_000)
})
