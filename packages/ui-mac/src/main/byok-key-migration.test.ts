// REQ-237 `#1556` AC5(方案 §2.3 读者迁移表 / I11)—— 迁移前已配置的 BYOK Key 在目录格式迁移后仍然可用。
//
// 迁移把 `keyEnv` / `baseURL` / `compat` 从随包目录搬进 App 内置适配器表(byok-adapters.ts),随包 BYOK 段改成
// ByokCatalogV1 形状。四个直接读者若仍读旧字段,已存的 Key 会**静默**失效:映射不到 env ⇒ 不物化;更糟的是
// syncSecretFiles 的清理分支会把「不在 wanted 集」的既有密钥文件删掉 ⇒ 已配好的直连全部不可执行。
//
// 这里照生产 fork 的顺序走一遍(index.ts 启动 → server.ts spawnLocalServer):
//   钥匙串里一把**真实存储格式**的 Key(codepuppy-byok-keys.json `{v:1, enc}`,与 persist() 写出的同形)
//   → initByokKeys → injectByokKeysIntoEnv → syncSecretFiles → pinAppliedCatalog → buildCodePuppyModelConfig
//   → 真引擎发一次请求(`#1662` 起是嵌入式 OpenCode 2:byok-key-migration.engine.cases.ts 在独立 `bun test` 子进程里拿这份 userData
//     走生产 injectCodePuppyConfig 进沙箱里的引擎;v1 版跑的是已删的 `packages/opencode/src/index.ts run`),
// 断言:引擎配置里有这个 provider、`{file:}` 指向的文件在、本地桩收到的鉴权头就是这把 Key;迁移前就在盘上的
// 密钥文件在前后两次 fork 里都没被清理分支删掉。只把注入里该 provider 的 baseURL 改指本地桩;其余全是生产函数。
//
// 先红后绿:把 codepuppy-secret-files.ts 的 secretEnvVars 改回只含平台三项(BYOK 读者没迁好时的效果),第一条断言
// 「removed 不含 DEEPSEEK_API_KEY」转红;把 codepuppy-byok-keys.ts 的 keyEnvFor 改成返回 undefined,物化那一步转红。

import { afterAll, beforeAll, expect, mock, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const flip = (input: Uint8Array): Buffer => {
  const out = Buffer.alloc(input.length)
  for (let i = 0; i < input.length; i++) out[i] = input[i]! ^ 0x5a
  return out
}
mock.module("./codepuppy-keychain-backend", () => ({
  keychainBackend: () => ({
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => flip(Buffer.from(value, "utf8")),
    decryptString: (value: Buffer) => flip(value).toString("utf8"),
  }),
}))
mock.module("./logging", () => ({
  getLogger: () => ({ log: () => {}, warn: () => {}, error: () => {} }),
  write: () => {},
  rotateServerLogs: () => {},
}))
const { clearByokKeys, getByokKey, initByokKeys, injectByokKeysIntoEnv } = await import("./codepuppy-byok-keys")
const { secretFilePath, secretFileRef, syncSecretFiles } = await import("./codepuppy-secret-files")
const { pinAppliedCatalog, writeByokCatalogLkg } = await import("./codepuppy-live-allowlist")
const { buildCodePuppyModelConfig, getModelCatalog } = await import("./codepuppy-models")
const { buildModelPickerRows } = await import("../renderer/codepuppy-ui/model-picker-core")
const bundled = (await import("./codepuppy-models.json")).default.byokCatalog

// 刻意不像真密钥的测试值;它只出现在本进程起的本地桩上。
const STORED_KEY = "test-stored-key-not-real-Zq81-1556"
const MANAGED = ["DEEPSEEK_API_KEY", "CODEPUPPY_MODELS_DISABLE", "CODEPUPPY_BASE_URL", "CODEPUPPY_DEFAULT_MODEL", "CODEPUPPY_GLOBAL_DIR", "OPENCODE_CONFIG_DIR"]
const saved: Record<string, string | undefined> = {}
let root = ""
let userData = ""

beforeAll(() => {
  for (const key of MANAGED) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "byok-key-migration-")))
  userData = path.join(root, "userdata")
  fs.mkdirSync(userData, { recursive: true })
  process.env.CODEPUPPY_GLOBAL_DIR = path.join(root, "codepuppy-global", "codepuppy-state", "env", "dev")
  fs.mkdirSync(process.env.CODEPUPPY_GLOBAL_DIR, { recursive: true })
  process.env.OPENCODE_CONFIG_DIR = path.join(root, "config-dir")
  fs.mkdirSync(process.env.OPENCODE_CONFIG_DIR, { recursive: true })
})

afterAll(() => {
  clearByokKeys()
  for (const key of MANAGED) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  fs.rmSync(root, { recursive: true, force: true })
})

test("`#1556` AC5:迁移前已存的 BYOK Key → 物化为密钥文件、注入引擎配置、真引擎请求带上它;既有密钥文件两次 fork 都不被删", async () => {
  // ① 迁移前的盘面:钥匙串金库(persist() 写出的形状)+ 上一版 fork 留下的密钥文件。
  fs.writeFileSync(
    path.join(userData, "codepuppy-byok-keys.json"),
    JSON.stringify({ v: 1, enc: flip(Buffer.from(JSON.stringify({ deepseek: STORED_KEY }), "utf8")).toString("base64") }),
    { mode: 0o600 },
  )
  const keyFile = secretFilePath(userData, "DEEPSEEK_API_KEY")
  fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 })
  fs.writeFileSync(keyFile, STORED_KEY, { mode: 0o600 })

  // ② 新版启动:读金库 → 按适配器表的 Key 名注入 main env → fork 前物化 → 钉住目录 → 装配引擎配置。
  initByokKeys(userData)
  expect(getByokKey("deepseek")).toBe(STORED_KEY)
  injectByokKeysIntoEnv()
  expect(process.env.DEEPSEEK_API_KEY).toBe(STORED_KEY)
  for (const generation of [1, 2]) {
    const sync = syncSecretFiles(userData, process.env, {})
    expect({ generation, written: sync.written.includes("DEEPSEEK_API_KEY"), removed: sync.removed }).toEqual({
      generation,
      written: true,
      removed: [],
    })
    expect(fs.readFileSync(keyFile, "utf8")).toBe(STORED_KEY)
    pinAppliedCatalog(userData, generation)
  }

  const config = buildCodePuppyModelConfig(userData)!
  expect(config.enabled_providers).toContain("deepseek-byok")
  const node = config.provider["deepseek-byok"] as { options: { baseURL: string; apiKey: string }; models: Record<string, unknown> }
  expect(node.options.apiKey).toBe(secretFileRef(userData, "DEEPSEEK_API_KEY"))
  expect(fs.existsSync(keyFile)).toBe(true)
  expect(JSON.stringify(config)).not.toContain(STORED_KEY) // 配置里只有 {file:} 引用(A6)

  // ③ 真引擎发一次请求:只把这个 provider 的端点改指本地桩,鉴权头必须是金库里那把 Key。
  await engineRequest("deepseek-v4-pro")
}, 300_000)

// `#1556` AC7 的本地代理(正式证据是共享 RC 回归 T23 格「发布一次 BYOK 目录变化 → 同一打包客户端拉取 → picker 出现 →
// 真实发送」,要等平台部署 V3 后在打包客户端上做):远程目录在已有 provider 上新增一个模型,经采纳落成 LKG、下一次 fork
// 钉住之后,它出现在 picker 的可选行里,真引擎用这把已存的 Key 经它发出请求。采纳规则本身在 byok-catalog-adopt.cases.ts。
test("`#1556` AC7(本地代理):远程目录新增的模型 → 钉住 → picker 可选 → 真引擎经它带 Key 发出请求", async () => {
  const added = "deepseek-v5-preview"
  const doc = structuredClone(bundled)
  doc.catalog_version += 1
  doc.providers.find((provider) => provider.id === "deepseek")!.models.push({ id: added, name: "DeepSeek V5 Preview", image_input: false } as never)
  expect(writeByokCatalogLkg(userData, doc as never)).toBe(true)
  syncSecretFiles(userData, process.env, {})
  pinAppliedCatalog(userData, 3)

  const catalog = getModelCatalog(userData)
  const row = buildModelPickerRows({
    catalog: { ...catalog, liveSync: { status: "static" }, pricingBasisModelId: null, applied: { platformFetchedAt: null, byokVersion: doc.catalog_version }, downloaded: { platformFetchedAt: null, byokVersion: doc.catalog_version } },
    models: [],
    listState: "ready",
    keyStatusState: "ready",
    keyStatus: { deepseek: { configured: true, source: "keychain" } },
    accountState: "out",
    sessionScoped: false,
    query: "",
  }).find((candidate) => candidate.key === `deepseek:${added}`)
  expect(row).toMatchObject({ availability: "available", model: { id: added, providerID: "deepseek-byok", name: "DeepSeek V5 Preview" } })

  const config = buildCodePuppyModelConfig(userData)!
  expect(Object.keys((config.provider["deepseek-byok"] as { models: Record<string, unknown> }).models)).toContain(added)
  await engineRequest(added)
}, 300_000)

/**
 * 一次真引擎请求(`#1662`:嵌入式 OpenCode 2,byok-key-migration.engine.cases.ts 在独立子进程里跑 —— 沙箱要在上游模块装载之前改指
 * HOME / XDG):把本进程按生产顺序走到盘上的 userData 原样交过去,子进程注入、改端点、发一句,断言桩收到的鉴权头就是这把 Key。
 */
async function engineRequest(model: string) {
  const env = Object.fromEntries(Object.entries({ ...process.env, ...saved }).filter((entry): entry is [string, string] => entry[1] !== undefined))
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "120000", path.join(import.meta.dir, "byok-key-migration.engine.cases.ts")],
    cwd: path.join(import.meta.dir, "../.."),
    env: { ...env, CODEPUPPY_TEST_BYOK_USERDATA: userData, CODEPUPPY_TEST_BYOK_MODEL: model, CODEPUPPY_TEST_BYOK_KEY: STORED_KEY },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("1")
}
