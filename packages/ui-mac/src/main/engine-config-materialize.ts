// #1542: main-only seed / v2 projection. server.ts calls after secrets sync and before fork.
import fs from "node:fs"
import path from "node:path"
import { parse, type ParseError } from "jsonc-parser"
import { alphaJsoncPath } from "./engine-config-truth"
import { ALPHA_V2_CATALOG_READY_PROVIDER_ID } from "../shared/alpha-config"
import type { buildAlphaModelConfig } from "./alpha-models"

export function materializeEngineConfig(
  userDataPath: string,
  models: ReturnType<typeof buildAlphaModelConfig>,
  sidecarEnv: Record<string, string>,
) {
  // REQ-059 G1:引擎经 OPENCODE_CONFIG 加载当前环境的 alpha.jsonc(mcp/plugin/
  // provider/治理键)。文件通道 → dispose 重建重读文件 = 安装免重启;merge 序 XDG 后(压 provider)/
  // 项目前(可覆盖);junk 循环不扫单文件 → 当前环境根零引擎垃圾(T0 spike 判定)。全新机器 seed
  // {$schema},否则 loadFile 指向不存在文件。逃生 ALPHA_JSONC_TRUTH_DISABLE / ALPHA_LEGACY_INSTALL_ROOT
  // 不注入(回 REQ-018 home walk 行为,ext-config 写入目标也随之回退,两侧一致)。
  if (process.env.ALPHA_JSONC_TRUTH_DISABLE !== "1" && process.env.ALPHA_LEGACY_INSTALL_ROOT !== "1") {
    const truth = alphaJsoncPath()
    fs.mkdirSync(path.dirname(truth), { recursive: true })
    if (!fs.existsSync(truth)) {
      fs.writeFileSync(truth, JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2))
    }
    sidecarEnv.OPENCODE_CONFIG = truth
  }
  materializeV2EngineConfig(userDataPath, models ?? {}, Boolean(models), sidecarEnv)
}

// 2026-07-23 上游 sync 断层修补:v2 Config.Service(packages/core/config.ts)只读
// `OPENCODE_CONFIG_DIR ?? ~/.config/opencode` 目录下的 opencode.json/opencode.jsonc 文件 ——
// OPENCODE_CONFIG_CONTENT 与 OPENCODE_CONFIG(alpha.jsonc)它一概不读。而 picker 已切 v2
// `/api/model`(model-contract.ts → catalog.model.available()),于是 v1 注入再成功,v2 目录里
// 也没有 alpha/BYOK provider → 全部「当前不可用」。此桥把 v2 需要的最小子集物化成文件:
//   opencode.json  ← alpha.jsonc 去掉 `provider` 键后的拷贝(先加载)。`#1392` 之前是原样拷贝,理由是「用户自定义节点住在
//                    那里」;现在它们住在围栏写不到的真源里、经注入的 provider 表进 v2(下一行),而 v2 的 catalog 可用性
//                    (packages/core/src/catalog.ts available())**不看 enabled_providers** —— 原样拷贝会让配置文件里的 provider
//                    块(围栏内的引擎树写得了)直接出现在 picker 读的 v2 model.list 里。基线 I1:配置文件的 provider.* 不参与注入面。
//   opencode.jsonc ← { $schema, model, provider }(注入的 provider 表,后加载压过用户同名项)
// 并设 OPENCODE_CONFIG_DIR 指向该 alpha 自有目录。v1 加载读的是 Global.Path.config 静态路径,
// 不受此 env 影响;推理仍走 v1(有 {file:}/{env:} 解析),故 v2 文件一律剥掉 apiKey —— v2 无
// 变量解析,catalog 可用性判定也不需要 key(no-integration 路径)。
// 写入失败由 server.ts 拒绝 fork,半成品不交给引擎。
type V1ProjectedModel = { name?: unknown }
type V1ProjectedProvider = {
  name?: unknown
  npm?: unknown
  api?: unknown
  options?: { baseURL?: unknown }
  models?: unknown
}

function governedModelsBase(config: { enabled_providers?: unknown; provider?: unknown }): Record<string, unknown> {
  const enabled = Array.isArray(config.enabled_providers)
    ? config.enabled_providers.filter((id): id is string => typeof id === "string")
    : []
  const providers = (config.provider ?? {}) as Record<string, V1ProjectedProvider>

  // An enabled id without a complete provider/model projection is a user/file-owned provider.
  // Do not publish the early marker for a partial set: the renderer will keep waiting for the
  // ordinary ConfigProvider commit, which has already merged those file sources.
  if (
    enabled.some((id) => {
      const item = providers[id]
      return !item || !item.models || typeof item.models !== "object" || Array.isArray(item.models)
    })
  )
    return {}

  const base: Record<string, unknown> = {}
  for (const id of enabled) {
    const item = providers[id]!
    const npm = typeof item.npm === "string" ? item.npm : undefined
    const api =
      typeof item.options?.baseURL === "string"
        ? item.options.baseURL
        : typeof item.api === "string"
          ? item.api
          : undefined
    const modelProvider = npm || api ? { ...(npm ? { npm } : {}), ...(api ? { api } : {}) } : undefined
    const models = Object.fromEntries(
      Object.entries(item.models as Record<string, V1ProjectedModel>).map(([modelID, model]) => [
        modelID,
        {
          id: modelID,
          name: typeof model.name === "string" ? model.name : modelID,
          release_date: "1970-01-01",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: false,
          limit: { context: 0, output: 0 },
          modalities: { input: [], output: [] },
          ...(modelProvider ? { provider: modelProvider } : {}),
        },
      ]),
    )
    base[id] = {
      id,
      name: typeof item.name === "string" ? item.name : id,
      env: [],
      ...(api ? { api } : {}),
      ...(npm ? { npm } : {}),
      models,
    }
  }
  base[ALPHA_V2_CATALOG_READY_PROVIDER_ID] = {
    id: ALPHA_V2_CATALOG_READY_PROVIDER_ID,
    name: "Alpha catalog readiness marker",
    env: [],
    models: {},
  }
  return base
}

/** alpha.jsonc 解析后去掉 `provider` 键(见 v2 桥抬头);缺失 / 读失败 / 解析不出 / 不是对象 ⇒ undefined(调用方清掉旧拷贝)。 */
function alphaJsoncWithoutProviders(): Record<string, unknown> | undefined {
  let text: string
  try {
    text = fs.readFileSync(alphaJsoncPath(), "utf8")
  } catch {
    return undefined
  }
  const errors: ParseError[] = []
  const parsed: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length || !parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
  const { provider: _provider, ...rest } = parsed as Record<string, unknown>
  return rest
}

function materializeV2EngineConfig(
  userDataPath: string,
  config: { model?: unknown; enabled_providers?: unknown; provider?: unknown },
  governedModels: boolean,
  sidecarEnv: Record<string, string>,
) {
  const dir = path.join(userDataPath, "alpha-engine-config")
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const userCopy = path.join(dir, "opencode.json")
  const stripped = alphaJsoncWithoutProviders()
  if (stripped === undefined) fs.rmSync(userCopy, { force: true }) // 无真源(或读不出)则清掉旧拷贝,不留陈尸
  else fs.writeFileSync(userCopy, `${JSON.stringify(stripped, null, 2)}\n`, { mode: 0o600 })
  const provider: Record<string, unknown> = Object.fromEntries(
    Object.entries((config.provider ?? {}) as Record<string, { options?: Record<string, unknown> }>).map(
      ([id, def]) => {
        const { apiKey: _apiKey, ...options } = def.options ?? {}
        return [id, { ...def, ...(Object.keys(options).length ? { options } : { options: undefined }) }]
      },
    ),
  )
  provider[ALPHA_V2_CATALOG_READY_PROVIDER_ID] = {
    name: "Alpha catalog readiness marker",
    env: [],
  }
  const v2 = {
    $schema: "https://opencode.ai/config.json",
    ...(typeof config.model === "string" ? { model: config.model } : {}),
    provider,
  }
  fs.writeFileSync(path.join(dir, "opencode.jsonc"), JSON.stringify(v2, null, 2), { mode: 0o600 })
  sidecarEnv.OPENCODE_CONFIG_DIR = dir

  // #857:when Alpha model governance is active, every available built-in provider/model is already
  // described by the provider projection above. Letting ModelsDev fall through to the bundled
  // snapshot still makes the first V2 request decode and materialize 6,132 unrelated rows before
  // ConfigProvider commits (2.8-6.1s in the signed packaged matrix). Materialize a minimal ModelsDev
  // base mechanically from that SAME projection so the earlier ModelsDevPlugin commit carries the
  // exact governed identities and readiness marker. ConfigProvider remains authoritative for the
  // richer late metadata/variants. If an enabled user/file provider is absent from this in-memory
  // projection, governedModelsBase returns {} WITHOUT the marker, preserving the conservative late
  // barrier instead of exposing a partial first set. An empty base must also leave
  // OPENCODE_MODELS_PATH unset: ModelsDev treats an on-disk `{}` as truthy and would otherwise
  // short-circuit its bundled snapshot instead of reaching the conservative late barrier. No key
  // field is read or written here.
  // Preserve ALPHA_MODELS_DISABLE as a real escape hatch by leaving any inherited path untouched.
  if (governedModels) {
    const modelsPath = path.join(dir, "models.json")
    const base = governedModelsBase(config)
    if (Object.keys(base).length) {
      fs.writeFileSync(modelsPath, `${JSON.stringify(base, null, 2)}\n`, { mode: 0o600 })
      sidecarEnv.OPENCODE_MODELS_PATH = modelsPath
    } else {
      fs.rmSync(modelsPath, { force: true })
      delete sidecarEnv.OPENCODE_MODELS_PATH
    }
  }
}
