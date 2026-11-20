// `#1667`(#1662 L5;编排器裁决 1667 评论 6738814516 第 2 条、C7 重裁 6741122824):引擎配置的**显式文件层**。
//
// OpenCode 2 的配置文档加载顺序(`packages/core/src/config.ts` 的 load 返回序):managedPolicies → integrated → wellknown →
// global → explicit(`start()` 的 `config.file`)→ direct → project → content(内联)→ managedSettings。设置项后加载的胜出,
// policy 先加载的胜出(`packages/core/src/managed-policy.ts`:文档倒序拼起来,`findLast` 命中)。于是:
//   · 出厂 `/init`、`/review` 与 `skills` 放这一层 ⇒ 项目里写的同名命令胜过出厂的,出厂的胜过上游内置的(v1 的「用户治理 >
//     出厂 > 上游内置」);
//   · provider 白名单的 `policies`(deny `*` + 逐个 allow,与内联文档里那份出自同一次 engineModelConfig 计算)放这一层 ⇒
//     比项目的 `opencode.json` / `.opencode/` 先加载,项目里写的 allow 盖不过它(L3 实测场景 D)。内联文档里那份保留为第二层。
//
// 这一个显式槽原本装的是当前环境的 `codepuppy.jsonc`(用户经 Code Puppy 装的 agent / command / mcp 的真源,REQ-059 G1)。
// 2.x 只有一个显式槽,所以这里每次启动把两样合成一份文件,放在 Code Puppy 自己的 userData 下(`codepuppy-engine-config/`):
// 用户文件原样在下,上面三样按「用户已有的同名命令不覆盖、skills 取并集、我们的 policies 排在用户的之后」合进去。
// `codepuppy.jsonc` 运行中被改(main 装东西、用户手改)、技能翻代 / 新装 / 停用时,main 的监听重写这份合成文件,引擎对显式
// 文件的监听再重载配置(`packages/core/src/config/watch.ts`),技能插件随配置更新重新取源 —— 都不用重启。用户文件解析不了:启动时只写我们这三样并记一行;运行中改坏
// 则保留上一份好的合成结果并记一行(不让一次手误把用户装的东西整份撤掉)。
// 已知边界:用户文件里**相对路径**的 `{file:./x}` 引用会按合成文件所在目录解析(Code Puppy 自己写的引用都是绝对路径)。
//
// SPEC-engine-config-fence BR-03(DESIGN-engine-config-fence §4.4):这份文件、模型底表与种子 `codepuppy.jsonc` 只由 **main** 写 ——
// fork 前 writeEngineConfigForFork 写一次,监听在 main 里跑;sidecar 只用同一对路径函数(explicitConfigPath / engineModelsPath)读。
// 这些位置随后进围栏 profile 末尾的拒写块,被围栏的引擎树写不到。写或删失败原样抛,server.ts 据此拒绝 fork。
import * as fs from "node:fs"
import * as path from "node:path"
import { parse as parseJsonc, type ParseError } from "jsonc-parser"
import type { CodePuppyBootstrap } from "@opencode/util/codepuppy-bootstrap"
import { applyPromptTakeover } from "../../../ext/src/codepuppy-prompts"
import { projectServerConfig } from "../../../ext/src/engine-transforms"
import { factorySkillPaths } from "../../../ext/src/factory-paths"
import { skillGenerationLiveDirs } from "../../../ext/src/gen-skill-paths"
import { CODEPUPPY_V2_CATALOG_READY_PROVIDER_ID } from "../shared/codepuppy-config"
import { PROJECT_HIDDEN_DIR } from "../shared/project-hidden-dir"
import { buildCodePuppyModelConfig, engineModelConfig, type CodePuppyModelConfig } from "./codepuppy-models"
import { readPackageLedgerStateV1 } from "./ext-receipt-v2"
import { USER_DATA_LAYOUT } from "./user-data-layout"

export const EXPLICIT_CONFIG_FILE = "codepuppy-explicit.json"

export type ExplicitPolicy = { action: string; resource: string; effect: string }
export type ExplicitCommand = { template: string; description?: string; subagent?: boolean }
/** main 写进显式层的几样(都出自注入那一次计算)。 */
export type ExplicitLayer = { policies: ExplicitPolicy[]; commands: Record<string, ExplicitCommand>; skills: string[] }

export function explicitConfigPath(userDataPath: string): string {
  return path.join(userDataPath, USER_DATA_LAYOUT.engineConfig, EXPLICIT_CONFIG_FILE)
}

/** 模型底表(#857):与显式文件同目录;main 写,sidecar 以「文件在」判这一代有没有底表。 */
export function engineModelsPath(userDataPath: string): string {
  return path.join(userDataPath, USER_DATA_LAYOUT.engineConfig, "models.json")
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)

/**
 * `#1724`(编排器裁决,DESIGN-plugin-helper-and-hub §10 方案 A):经包运行器启动的本地 MCP 第一次运行要先把包下载下来
 * (markitdown 经 uvx 约 100 MB,0.2.1 实测本机网络 166 s),默认 30 s 的握手时钟会先到,而且每次超时都杀掉下载重来。
 * 只放宽它们的 `timeout.startup`(目录 / 执行两段照旧);代价已接受:首次下载占着引擎的一个启动名额,真卡死的晚些报失败。
 */
export const RUNNER_FIRST_FETCH_STARTUP_MS = 300_000
const PACKAGE_RUNNERS = new Set(["uvx", "npx", "bunx", "pnpx"])
export function launchedByPackageRunner(config: { type?: unknown; command?: unknown }): boolean {
  return config.type === "local" && Array.isArray(config.command) && typeof config.command[0] === "string" && PACKAGE_RUNNERS.has(path.basename(config.command[0]))
}

/** v1 形状的 `mcp.<name>` 只有一个管三段的 `timeout` 数字,只放宽启动段就要用 2.x 原生的 `mcp.servers.<name>`(同名只出现在一边)。 */
function withRunnerStartup(mcp: Record<string, unknown>): Record<string, unknown> {
  const servers: Record<string, unknown> = isRecord(mcp.servers) ? { ...mcp.servers } : {}
  const next: Record<string, unknown> = {}
  for (const [name, leaf] of Object.entries(mcp)) {
    const config = name !== "servers" && name !== "timeout" && isRecord(leaf) && leaf.timeout === undefined && !(name in servers) && launchedByPackageRunner(leaf) ? projectServerConfig(leaf) : undefined
    if (config) servers[name] = { ...config, timeout: { startup: RUNNER_FIRST_FETCH_STARTUP_MS } }
    else if (name !== "servers") next[name] = leaf
  }
  return Object.keys(servers).length ? { ...next, servers } : next
}

/** 用户文件(可缺席)+ 我们这一层 ⇒ 显式文件的内容。用户文件解析不了 ⇒ 只放我们这一层,并给出原因。 */
export function composeExplicitDocument(userText: string | undefined, layer: ExplicitLayer): { document: Record<string, unknown>; userError?: string } {
  let user: Record<string, unknown> = {}
  let userError: string | undefined
  if (userText !== undefined) {
    const errors: ParseError[] = []
    const parsed: unknown = parseJsonc(userText, errors, { allowTrailingComma: true })
    if (errors.length || !isRecord(parsed)) userError = errors.length ? `JSONC parse error at offset ${errors[0]!.offset}` : "not a JSON object"
    else user = parsed
  }
  const document: Record<string, unknown> = { $schema: "https://opencode.ai/config.json", ...user }
  if (isRecord(user.mcp)) document.mcp = withRunnerStartup(user.mcp)
  // 用户文件的 skills 可能还是 v1 形状 `{ paths, urls }`(生产 boot 的 ensureSkillsPath 就这么写):按上游 normalize 的同一规则
  // 先摊成数组(paths 在前、urls 在后),再与出厂的取并集(审计 R1 第 3 条)。
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])
  const userSkills = isRecord(user.skills) ? [...strings(user.skills.paths), ...strings(user.skills.urls)] : strings(user.skills)
  const skills = [...new Set([...userSkills, ...layer.skills])]
  if (skills.length) document.skills = skills
  // 用户文件里已有的同名命令(v1 的 `command` 或 2.x 的 `commands`)不覆盖:同一份文档里 2.x 的键压过 v1 的键,出厂的不能借此挤掉用户的。
  const taken = new Set([...Object.keys(isRecord(user.command) ? user.command : {}), ...Object.keys(isRecord(user.commands) ? user.commands : {})])
  const factory = Object.fromEntries(Object.entries(layer.commands).filter(([name]) => !taken.has(name)))
  if (Object.keys(factory).length || isRecord(user.commands)) document.commands = { ...factory, ...(isRecord(user.commands) ? user.commands : {}) }
  // 同一份文档里后面的 policy 胜出(`findLast`):我们的排在用户文件里的之后。
  if (layer.policies.length) document.policies = [...(Array.isArray(user.policies) ? user.policies : []), ...layer.policies]
  return { document, ...(userError ? { userError } : {}) }
}

function writeAtomic(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, text, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

function readUser(userConfig: string | undefined): string | undefined {
  if (!userConfig) return undefined
  try {
    return fs.readFileSync(userConfig, "utf8")
  } catch {
    return undefined
  }
}

/** 启动时:合成并原子写出显式文件。返回用户文件的解析问题(有的话)。 */
export function writeExplicitConfig(file: string, userConfig: string | undefined, layer: ExplicitLayer, root: string): { userError?: string } {
  const { document, userError } = composeExplicitDocument(readUser(userConfig), layer)
  withdrawDisabledPackageCommands(document, root)
  writeAtomic(file, `${JSON.stringify(document, null, 2)}\n`)
  return userError ? { userError } : {}
}

/** 显式文件的输入里,运行中会变的那几个文件(相对当前环境根):用户文件、技能允许集、各技能键的 live 指针。 */
function isExplicitInput(name: string, userConfig: string | undefined, root: string): boolean {
  const relative = name.split(path.sep).join("/")
  if (userConfig && path.resolve(root, name) === path.resolve(userConfig)) return true
  return relative === "skills-enabled.json" || /^ext-store\/[^/]+\/current\.json$/.test(relative)
}

/**
 * 运行中:输入一变就重写显式文件(去抖 100ms)。输入 = 用户的 `codepuppy.jsonc`(main 装东西、用户手改),以及决定 `skills` 的
 * 技能允许集 `skills-enabled.json` 与各技能键的 `current.json`(翻代 / 新装 / 停用,`#1667` 编排器裁决 r3 第 1 条)—— 都在当前
 * 环境根下,所以只监听这一棵树(递归),按文件名筛。`skills` 每次由 `skills()` 现算(explicitSkillDirs,与 fork 前那一次同一个
 * 算法)。只在 main 里跑(server.ts 每代起、子进程退出时停)。用户文件改坏了 ⇒ 不重写(保留上一份好的)并记一行。返回停止函数。
 * 监听的是目录而不是文件:main 的原子写是 rename,盯文件本身会在第一次换名后失联。
 */
export function watchExplicitSources(input: {
  file: string
  root: string
  userConfig?: string
  layer: ExplicitLayer
  skills: () => string[]
  log: (line: string) => void
}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const allowSet = path.join(input.root, "skills-enabled.json")
  let lastAllowSet = readUser(allowSet)
  let lastUser = readUser(input.userConfig)
  let lastWritten = readUser(input.file)
  const refresh = () => {
    lastAllowSet = readUser(allowSet)
    const text = readUser(input.userConfig)
    const { document, userError } = composeExplicitDocument(text, { ...input.layer, skills: input.skills() })
    if (userError && text !== undefined && text !== lastUser) {
      input.log(`[alpha-code#1667] ${input.userConfig} is not valid (${userError}); keeping the previous engine config`)
      return
    }
    if (userError && text !== undefined) return
    withdrawDisabledPackageCommands(document, input.root)
    const next = `${JSON.stringify(document, null, 2)}\n`
    lastUser = text
    if (next === lastWritten) return
    try {
      writeAtomic(input.file, next)
      lastWritten = next
    } catch (error) {
      input.log(`[alpha-code#1667] could not rewrite ${input.file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(refresh, 100)
  }
  const refreshAllowSet = () => {
    if (readUser(allowSet) !== lastAllowSet) schedule()
  }
  let watcher: fs.FSWatcher | undefined
  try {
    watcher = fs.watch(input.root, { recursive: true }, (_event, name) => {
      if (name !== null && !isExplicitInput(String(name), input.userConfig, input.root)) return
      if (name === "skills-enabled.json") return refreshAllowSet()
      schedule()
    })
    // 监听跑在 main 里:一个没人接的 error 会成为 Electron main 进程的未捕获异常。记一行,应用照常(技能允许集还有 watchFile 兜底)。
    watcher.on("error", (error) => input.log(`[alpha-code#1667] stopped watching ${input.root} for engine config inputs: ${error instanceof Error ? error.message : String(error)}`))
  } catch (error) {
    input.log(`[alpha-code#1667] cannot watch ${input.root}: ${error instanceof Error ? error.message : String(error)}`)
  }
  // Atomic disable/enable writes can be coalesced by the recursive directory watcher. Observe the
  // allow-list file's state too, so a missed enable event cannot leave the explicit skills withdrawn.
  fs.watchFile(allowSet, { interval: 100 }, refreshAllowSet)
  return () => {
    clearTimeout(timer)
    watcher?.close()
    fs.unwatchFile(allowSet, refreshAllowSet)
  }
}

/** Package state is owned by the ledger root; runtime projections consume the same graph membership. */
export function disabledPackageComponents(root: string) {
  const state = readPackageLedgerStateV1(root, { sideEffectFree: true })
  if (!state.ok) {
    console.warn("package runtime projection could not read the installation ledger")
    return []
  }
  return state.packageGraphs.flatMap((graph) => state.records.find((record) => record.kind === graph.root.kind && record.name === graph.root.name)?.desiredState === "disabled" ? [graph.root, ...graph.children] : [])
}

function withdrawDisabledPackageCommands(document: Record<string, unknown>, root: string) {
  const names = new Set(disabledPackageComponents(root).filter((component) => component.kind === "command").map((component) => component.name))
  for (const key of ["command", "commands"]) {
    const entries = document[key]
    if (isRecord(entries)) document[key] = Object.fromEntries(Object.entries(entries).filter(([name]) => !names.has(name)))
  }
}

/**
 * `#1667`(编排器裁决 2026-11-12):项目技能目录。2.x 把显式文件里**相对**的 `skills` 条目按会话所在的项目目录解析
 * (`packages/core/src/config/plugin/skill.ts` 的 `sources()`)并监听它,所以这一条让每个项目看到、也只看到自己的
 * `.codepuppy/skills`(ecosystem-import 把项目导入的技能放在那里),导入后不用重启。v1 由 ext 合并项目 `codepuppy.jsonc` 的
 * `skills.paths`,不看 consent(ext `project-config.ts` 的信任门只管 mcp 与 agent 的控制字段);2.x 的插件接口没有加技能目录的挂点。
 * 与 v1 的三处差别(已裁决接受):① 目录在、项目 `codepuppy.jsonc` 里没写注册,也会加载;② 项目在 `skills.paths` 里写的其它条目
 * 不生效;③ ext 的项目身份检查不适用 —— 软链照跟,会话位置是 HOME 时读 `~/.codepuppy/skills`。
 */
export const PROJECT_SKILLS_ENTRY = `./${PROJECT_HIDDEN_DIR}/skills`

/**
 * `#1667`(编排器裁决 r3 第 1 条):显式文件 `skills` 的唯一算法 —— 出厂技能目录(main 启动时算好、`#1698` 起在启动文档的
 * `skills.factoryDirs`)+ 已启用技能当前那一代的真实目录(ext 的 skillGenerationLiveDirs:过账本 enabled 门、读 `current.json`)+ 项目技能目录
 * (PROJECT_SKILLS_ENTRY)。main 在 fork 前算一次,main 的监听在翻代 / 新装 / 停用时再算(watchExplicitSources);两处都从同一份启动文档
 * 取出厂目录与当前环境根(SPEC-engine-config-fence BR-03)。
 */
export function explicitSkillDirs(factoryDirs: readonly string[], root: string): string[] {
  return [
    ...new Set([
      ...factorySkillPaths(factoryDirs),
      ...skillGenerationLiveDirs(root),
      PROJECT_SKILLS_ENTRY,
    ]),
  ]
}

// #857:Code Puppy 的模型治理生效时,注入的 provider 表已经描述了每一个可用的内置 provider / 模型。让 ModelsDev 落回随包快照,
// 第一次请求还要先解码并物化 6,132 条无关条目(签名打包矩阵里 2.8-6.1 s)。所以从**同一份**投影机械地物化一份最小的
// models.dev 底表,经 `start()` 的 `models.file` 交给引擎(`#1667`;v1 时代经 `OPENCODE_MODELS_PATH`)。投影里缺了某个已启用的
// 用户 / 文件 provider 时 governedModelsBase 返回 {}、不带就绪标记 —— 这时不给文件,保留保守的晚到屏障,而不是先露出半套。
// 空底表也必须不给:ModelsDev 把磁盘上的 `{}` 当作有值,会绕过随包快照。这里不读也不写任何 key 字段。
// CODEPUPPY_MODELS_DISABLE 仍是真逃生门:那时根本不进这里。
// (2026-07-23 为 v2 读侧另写 `OPENCODE_CONFIG_DIR/opencode.json(c)` 的半代次桥已随 `#1667` 删除,清点表 C4:只剩一个代次,
// 配置只写一份,就是上面的注入。)
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
  base[CODEPUPPY_V2_CATALOG_READY_PROVIDER_ID] = {
    id: CODEPUPPY_V2_CATALOG_READY_PROVIDER_ID,
    name: "Code Puppy catalog readiness marker",
    env: [],
    models: {},
  }
  return base
}

export function materializeGovernedModelsBase(userDataPath: string, config: CodePuppyModelConfig): string | undefined {
  const dir = path.join(userDataPath, USER_DATA_LAYOUT.engineConfig)
  const modelsPath = engineModelsPath(userDataPath)
  const base = governedModelsBase(config)
  if (!Object.keys(base).length) {
    fs.rmSync(modelsPath, { force: true })
    return undefined
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(modelsPath, `${JSON.stringify(base, null, 2)}\n`, { mode: 0o600 })
  return modelsPath
}

/** fork 前写出的引擎配置文件;`userError` = 用户的 codepuppy.jsonc 解析不了(只写了 Code Puppy 那一层,调用方照旧记一行)。 */
export type EngineConfigFiles = { explicitConfig: string; models?: string; userError?: string }

/** 全新机器上 codepuppy.jsonc 的种子(与 0.2.6 注入写的同一份字节)。 */
const SEED_DOCUMENT = JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2)

/**
 * 只在 main 执行(DESIGN-engine-config-fence §4.4):codepuppy.jsonc 缺席且未置逃生阀(`userConfig` 缺席)时先写种子;再合成并原子写显式文件;
 * 有模型底表就写,没有(含 CODEPUPPY_MODELS_DISABLE、投影不全)就删掉上一代留下的 models.json —— 围栏内建不出它,所以 sidecar 以
 * 「文件在」判这一代有没有底表。任何 IO 错误原样抛(Node 的消息带路径与 errno,不带内容)。
 */
export function writeEngineConfigFiles(input: {
  userDataPath: string
  root: string
  userConfig?: string
  layer: ExplicitLayer
  models: CodePuppyModelConfig | undefined
}): EngineConfigFiles {
  // 引擎配置目录 0700(模型底表与显式文件都在里面);recursive 的 mode 只作用于新建的那一级。
  fs.mkdirSync(path.join(input.userDataPath, USER_DATA_LAYOUT.engineConfig), { recursive: true, mode: 0o700 })
  if (input.userConfig !== undefined) {
    fs.mkdirSync(path.dirname(input.userConfig), { recursive: true })
    if (!fs.existsSync(input.userConfig)) fs.writeFileSync(input.userConfig, SEED_DOCUMENT)
  }
  const explicitConfig = explicitConfigPath(input.userDataPath)
  const { userError } = writeExplicitConfig(explicitConfig, input.userConfig, input.layer, input.root)
  const models = input.models ? materializeGovernedModelsBase(input.userDataPath, input.models) : undefined
  if (!input.models) fs.rmSync(engineModelsPath(input.userDataPath), { force: true })
  return { explicitConfig, ...(models ? { models } : {}), ...(userError ? { userError } : {}) }
}

/**
 * main 的 fork 前一步(server.ts;测试宿主同序调用):显式层的三样从这一代的启动文档算 —— 平台地址、默认模型覆盖、逃生开关、出厂技能目录
 * 与当前环境根都取文档里 main 已判好的值,与 sidecar 注入读的是同一份。policies = 模型投影的 provider 白名单(内联文档里那份是第二层),
 * commands = 出厂 /init、/review(提示词逃生门置位时不写),skills = explicitSkillDirs。写完返回监听要的输入(除 log)。
 */
export function writeEngineConfigForFork(bootstrap: CodePuppyBootstrap) {
  const root = bootstrap.paths.globalRoot
  const userConfig = bootstrap.paths.userConfig
  const factoryDirs = bootstrap.skills.factoryDirs
  const models = buildCodePuppyModelConfig(bootstrap.paths.userData, {
    baseURL: bootstrap.platform.modelProxyBaseURL,
    defaultModel: bootstrap.platform.defaultModelOverride,
    disabled: bootstrap.switches.modelsDisabled,
  })
  const layer: ExplicitLayer = { policies: models ? engineModelConfig(models).policies : [], commands: {}, skills: explicitSkillDirs(factoryDirs, root) }
  // 出厂 /init、/review 的模板来自 ext 的 applyPromptTakeover(同一份文字),写成 `commands` 条目;`review` 在子任务里跑(2.x 原生键 `subagent`)。
  if (!bootstrap.switches.promptRebrandDisabled) {
    const takeover: { command?: Record<string, { template: string; description?: string; subtask?: boolean }> } = {}
    applyPromptTakeover(takeover)
    layer.commands = Object.fromEntries(
      Object.entries(takeover.command ?? {}).map(([name, { subtask, ...command }]) => [name, { ...command, ...(subtask ? { subagent: true } : {}) }]),
    )
  }
  const files = writeEngineConfigFiles({ userDataPath: bootstrap.paths.userData, root, ...(userConfig ? { userConfig } : {}), layer, models })
  return {
    files,
    watch: { file: files.explicitConfig, root, ...(userConfig ? { userConfig } : {}), layer, skills: () => explicitSkillDirs(factoryDirs, root) },
  }
}
