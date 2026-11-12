// REQ-237 `#1556` AC5 / AC7 的真引擎那一步,在 OpenCode 2 上(`#1662`;v1 版跑的是已删的 `packages/opencode/src/index.ts run`):
// byok-key-migration.test.ts 照生产 fork 的顺序把金库里那把 Key 走到盘上(initByokKeys → injectByokKeysIntoEnv → syncSecretFiles →
// pinAppliedCatalog),然后起本文件,把那份 userData 原样交过来。这里用生产 injectCodePuppyConfig 把它注入沙箱里的嵌入式引擎,
// 只把 deepseek-byok 的端点改指本地桩,用指定的模型建会话、发一句:桩收到的补全请求必须带着那把 Key(引擎经 `{file:}` 现读)。
// 输入走环境变量(宿主给):CODEPUPPY_TEST_BYOK_USERDATA / CODEPUPPY_TEST_BYOK_MODEL / CODEPUPPY_TEST_BYOK_KEY(刻意不像真密钥的测试值)。
// 单独跑本文件(没有宿主给的输入)当场失败,不静默通过。HOME / XDG 全在临时沙箱里。
import { afterAll, beforeAll, expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"
import { assertEngineSandboxed, engineSandbox } from "../../test-component/engine-sandbox"
import { codepuppyEngine, scriptedModel, type Running } from "../../test-component/codepuppy-engine"

const sandbox = engineSandbox()
const platform = scriptedModel()
const engines: Running[] = []
const seen: Array<{ path: string; authorization: string | null }> = []
const stub = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    seen.push({ path: new URL(request.url).pathname, authorization: request.headers.get("authorization") })
    await request.text()
    const chunk = (delta: Record<string, unknown>, finish: string | null) =>
      `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: "fake", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    return new Response(chunk({ role: "assistant", content: "ok" }, null) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  },
})

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
})
afterAll(async () => {
  for (const engine of engines) await engine.close().catch(() => undefined)
  platform.stop()
  stub.stop(true)
})

test("嵌入式引擎经 deepseek-byok 发出的补全请求带着金库里那把 Key", async () => {
  const source = process.env.CODEPUPPY_TEST_BYOK_USERDATA
  const model = process.env.CODEPUPPY_TEST_BYOK_MODEL
  const key = process.env.CODEPUPPY_TEST_BYOK_KEY
  if (!source || !model || !key) throw new Error("run through byok-key-migration.test.ts: it prepares the userData this case injects")
  const name = "byok"
  fs.cpSync(source, path.join(sandbox.root, `${name}-userdata`), { recursive: true })
  const host = codepuppyEngine({ sandbox, name, modelBaseURL: platform.baseURL })
  const node = host.content.providers["deepseek-byok"] as { settings: { baseURL: string; apiKey: string }; models: Record<string, unknown> } | undefined
  expect(Object.keys(node?.models ?? {})).toContain(model)
  expect(node!.settings.apiKey.startsWith("{file:")).toBe(true) // 注入里只有引用,明文不进配置
  expect(JSON.stringify(host.content)).not.toContain(key)
  node!.settings.baseURL = `http://127.0.0.1:${stub.port}/byok/v1`

  const engine = await host.start()
  engines.push(engine)
  const created = await engine.send("POST", "/api/session", { location: { directory: host.projectDirectory }, model: { id: model, providerID: "deepseek-byok" } })
  expect(created.status).toBe(200)
  const sessionID = created.json.data.id as string
  await engine.send("POST", `/api/session/${sessionID}/prompt`, { text: "hi" })
  await engine.send("POST", `/api/experimental/session/${sessionID}/wait`)
  const completions = seen.filter((entry) => entry.path.endsWith("/chat/completions"))
  expect(completions.length).toBeGreaterThan(0)
  for (const entry of completions) expect(entry.authorization).toBe(`Bearer ${key}`)
}, 90_000)
