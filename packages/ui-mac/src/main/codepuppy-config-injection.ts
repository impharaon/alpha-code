// #607:注入组合体的执行级可测面。injectCodePuppyConfig 与 materializeV2EngineConfig 从
// sidecar.ts 逐字搬来(含那层函数级 catch)。#613:catch 仍在(裸崩溃是票面明令禁止的另一种谎),
// 但失败不再只是进程内一行 warn —— 结果作为返回值交给 sidecar.ts,随 ready IPC 上报 main,
// 由终态生产者发布 "injection-failed"(与 ready/failed 并列,见 sidecar-generation.ts)。
//
// 为什么必须单独成模块:sidecar.ts 的第一个 import 就是 `node:module` 的 registerHooks
// (ADR-006 的 TS 解析桥),bun 1.3.14 未实现该 API —— 错误发生在 import 语句上,stub 任何东西
// 都救不了;其后顶层还有 `const parentPort = getParentPort()`,在非 utility process 中必抛。
// 于是「注入是否真的跑起来」全仓零覆盖,而函数级 catch 会把内部任何抛错静默吞掉
// (可见症状只是「模型全灰/正在同步」,2026-07-24 事故的表现)。抽出后本模块对 parentPort /
// registerHooks 零依赖,测试可 import 并**真实执行生产 composition**(codepuppy-config-injection.test.ts:
// 正向闸门锁 model/enabled_providers/provider/三个 alpha agent/{file:} ref,反向闸门锁 catch 的
// 真实爆炸半径 + 失败必须出声)。

import * as fs from "node:fs"
import * as path from "node:path"
// `#1299`(REQ-157):三个 alpha agent 的 description / prompt 是 alpha 的字,住在零依赖的
// codepuppy-agents.ts,由 packages/ext 的登记簿 import 并声明上限;这里只取,不再内联字面量。
import { CODEPUPPY_AGENT_TEXT } from "./codepuppy-agents"
import { CODEPUPPY_BEHAVIOR_MD } from "./codepuppy-behavior"
import { buildCodePuppyCapabilities, buildCodePuppyIdentity } from "./codepuppy-identity"
import { buildCodePuppyModelConfig, engineModelConfig, type CodePuppyModelConfig } from "./codepuppy-models"
// `#1195`(REQ-144 T2):`secretFileRef` 回来了 —— 云 MCP 的 Authorization 头装的是登录铸
// `mcp_access` token 的 `{file:…CODEPUPPY_MCP_TOKEN}` 引用(A6 通道,值不进 config 字面量)。
// `hasSecretFile` 同时是 ADR-009 的「平台代付」判据(见下方 `platformPays`,`#1195` 起换轴到
// 同一个 `CODEPUPPY_MCP_TOKEN` 文件 —— 凭证在场性与代付判据从此是同一件事)。
import { hasSecretFile, secretFileRef } from "./codepuppy-secret-files"
import {
  applyWebSearchDenies,
  CLOUD_MCP_ARM_ENV,
  CLOUD_MCP_DEF_ENV,
  CLOUD_MCP_SERVER_ENV,
  CLOUD_MCP_SERVER_NAME,
  CLOUD_WEB_SEARCH_TOOL_ID,
  LOCAL_WEB_SEARCH_TOOL_ID,
  WITHHELD_CLOUD_MCP,
} from "./cloud-web-search"
import { codepuppyGlobalRoot, codepuppyJsoncPath } from "./engine-config-truth"
import { injectDisabledOverrides } from "./ext-disabled-injection"
import { injectMcpDefaultDeny } from "./mcp-default-deny"
import { readMcpServerRecords } from "./mcp-server-records"
import { materializeCloudMcpConfig } from "./cloud-sidecar-config"
import type { ChannelName } from "./catalog-channels"
import { CODEPUPPY_V2_CATALOG_READY_PROVIDER_ID } from "../shared/codepuppy-config"
import { PROJECT_HIDDEN_DIR } from "../shared/project-hidden-dir"
import { USER_DATA_LAYOUT } from "./user-data-layout"
// `#1667`(#1665 L3 交回的接缝裁决 A / C,编排器 2026-11-09):出厂技能目录、技能生成的 live 目录与出厂 /init、/review 命令
// 由 main 写进这份内联配置文档(2.x 插件接口给不了等价挂点)。路径与命令内容仍以 ext 那三个纯函数为唯一来源,这里只引用。
import { injectFactorySkillPaths } from "../../../ext/src/factory-paths"
import { skillGenerationLiveDirs } from "../../../ext/src/gen-skill-paths"
import { explicitConfigPath, writeExplicitConfig, type ExplicitLayer } from "./engine-explicit-config"
import { applyPromptTakeover } from "../../../ext/src/codepuppy-prompts"

// Inject alpha-code's customizations into opencode via OPENCODE_CONFIG_CONTENT. This env var is
// MERGED with the user's global/project config — it does NOT replace it (opencode config.ts
// loads global config unconditionally and merges this as a "local" source), so untouched fields
// (auth, other instructions) are preserved. We layer two independent, separately-gated pieces:
//
//   1. Brand identity (CODEPUPPY_IDENTITY_DISABLE): a global instruction file written to
//      userDataPath (stable absolute path in both dev and the packaged .app) added to
//      `instructions`, so the agent calls itself "alpha-code". Now also carries per-session
//      capability facts (websearch / cloud dispatch) — see buildCodePuppyIdentity(caps). Behavior-neutral.
//   1b. Response guidance (CODEPUPPY_BEHAVIOR_DISABLE): a SEPARATE instruction file (codepuppy-behavior.ts)
//      that deliberately tunes agent behavior (Tier-3, ADR-015). Gated independently of identity and
//      carries a drift caveat — re-validate after every upstream prompt bump.
//   2. Curated model menu (CODEPUPPY_MODELS_DISABLE): provider allowlist + per-provider model
//      whitelist + custom/ALPHA gateways + default model. See codepuppy-models.ts for the shape and
//      the {env:VAR} key story.
//
//   4. B6(=G1):@codepuppy/ext 装载 —— main 解析好的自包含 bundle 绝对路径合并进 V1 `plugin`
//      (单数键,见 opencode-config-v1-schema)数组,保留用户自己的 plugin 列表。zod 跨实例路径
//      (ADR-006 caveat)的运行时证明 = codepuppy_ping 出现在工具表且能执行(真机批核验)。

// #613:注入失败的可上报形态(结构化,可过 IPC)。爆炸半径随抛点而异:最早(identity mkdir)
// = 整份注入丢失(OPENCODE_CONFIG_CONTENT / OPENCODE_CONFIG_DIR 双双缺席);最晚(v2 桥,
// R1 Blocker 1)= v1 已写出、但 picker 唯一读取的 v2 目录缺席。两端的用户可见症状同为
// 模型全灰,故一律 {ok:false} 上报 —— 不存在「可忽略的局部降级」。
export type CodePuppyConfigInjectionFailure = { message: string; stack?: string }
/**
 * `#1667`(#1662 L5,基线 §2.7):注入产物不再写进环境变量 —— H1 下引擎核心不读 `OPENCODE_CONFIG_CONTENT` /
 * `OPENCODE_CONFIG` / `OPENCODE_MODELS_PATH`(读它们的是不在路径上的上游 CLI 宿主)。结果里带着 sidecar 要放进
 * `start()` 选项的三样:`config.content`、`config.file`、`models.file`(engine-server-options.ts)。
 */
export type CodePuppyConfigInjectionOutput = {
  config: { content: string; file?: string }
  models: { file?: string }
  /**
   * `#1667`(编排器裁决 r1 第 2 条、C7 重裁):`config.file` 是 main 每次启动合成的显式文件(engine-explicit-config.ts)。
   * sidecar 据此监听用户的 `codepuppy.jsonc`,它一变就重写合成文件。注入失败时没有这一项(显式槽直接给用户文件)。
   */
  explicit?: { file: string; root: string; userConfig?: string; layer: ExplicitLayer }
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
 * `#1667`(编排器裁决 r3 第 1 条):显式文件 `skills` 的唯一算法 —— 出厂技能目录(main 启动时算好、经 CODEPUPPY_FACTORY_SKILL_DIRS
 * 传入)+ 已启用技能当前那一代的真实目录(ext 的 skillGenerationLiveDirs:过账本 enabled 门、读 `current.json`)+ 项目技能目录
 * (PROJECT_SKILLS_ENTRY)。注入时算一次,sidecar 的监听在翻代 / 新装 / 停用时再算(engine-explicit-config.ts 的 watchExplicitSources)。
 */
export function explicitSkillDirs(): string[] {
  return [
    ...new Set([
      ...injectFactorySkillPaths({}, process.env.CODEPUPPY_FACTORY_SKILL_DIRS),
      ...skillGenerationLiveDirs(codepuppyGlobalRoot()),
      PROJECT_SKILLS_ENTRY,
    ]),
  ]
}
export type CodePuppyConfigInjectionResult = CodePuppyConfigInjectionOutput &
  ({ ok: true } | { ok: false; error: CodePuppyConfigInjectionFailure })

// `#1667`(#1662 L5,清点表 C2,接口文档 I9):注入直接写 OpenCode 2 的配置键(`packages/schema/src/config.ts` 的 `Config.Info`),
// 不靠上游 normalize 的旧键兼容层(带诊断、语义不保证一一对应)。判据:codepuppy-config-injection.test.ts 用上游的
// normalize 与 `Config.Info` 解码这份产物,零诊断、零改写。
type PermissionRule = { action: string; resource: string; effect: "allow" | "deny" | "ask" }
type EngineAgent = {
  description?: string
  hidden?: boolean
  mode?: "primary" | "subagent" | "all"
  system?: string
  disabled?: boolean
  permissions?: PermissionRule[]
}
type EngineConfig = {
  $schema: string
  plugins: string[]
  experimental: Record<string, boolean>
  instructions?: string[]
  model?: string
  providers?: Record<string, unknown>
  policies?: Array<{ action: string; resource: string; effect: "allow" | "deny" }>
  agents?: Record<string, EngineAgent>
  permissions?: PermissionRule[]
  mcp?: { servers?: Record<string, unknown> }
}

/** 内置插件 `opencode.config.compatibility` 是 `.claude` 与 `.agents` 两类技能根的唯一装载者(裁决书 N3)。 */
export const ECOSYSTEM_COMPATIBILITY_PLUGIN = "opencode.config.compatibility"

/**
 * 正式渠道下 Code Puppy 对 2.x 五个实验开关的显式取值(裁决书 OOR-1:注入层压在项目与全局之上,显式值压过用户
 * `opencode.json` 的 `experimental.*` / `all_flags`)。`todo` 打开:会话页的任务清单卡要它(编排器 2026-11-09 裁决 U1,
 * #1668 评论 6736872128,可撤回);其余四个固定关。
 */
export const ENGINE_EXPERIMENTAL_FLAGS = {
  todo: true,
  schedules: false,
  media_blob: false,
  artifacts: false,
  background_compaction: false,
} as const

/**
 * 不论注入成败都要在的治理底线:
 *   · `plugins`:ext 的插件**目录**(2.x 只装目录形式的本地插件,接口文档 I2);外加移除指令 `-opencode.config.compatibility`
 *     —— S6 的唯一机制(裁决书 N3):不继承用户的 `~/.claude` / `~/.agents` / 项目 `.agents` 技能。逃生开关
 *     `CODEPUPPY_ECOSYSTEM_INHERIT=1` 置位时不写移除指令(ADR-024 §5,整机恢复上游继承)。
 *   · `experimental`:五个实验开关的显式值(见上)。
 */
function governanceFloor(extPluginPath: string | undefined): Pick<EngineConfig, "plugins" | "experimental"> {
  return {
    plugins: [
      ...(extPluginPath ? [extPluginPath] : []),
      ...(process.env.CODEPUPPY_ECOSYSTEM_INHERIT === "1" ? [] : [`-${ECOSYSTEM_COMPATIBILITY_PLUGIN}`]),
    ],
    experimental: { ...ENGINE_EXPERIMENTAL_FLAGS },
  }
}

/**
 * 把「动作 → 效果 | { 资源模式: 效果 }」的有序表展开成 2.x 的 `Permission.Ruleset`(有序数组,求值取最后一条命中)。
 * 动作名一律用 2.x 的工具名(`shell` / `subagent`,不是 v1 的 `bash` / `task`;I9)。
 */
function rules(table: Array<[string, PermissionRule["effect"] | Record<string, PermissionRule["effect"]>]>): PermissionRule[] {
  return table.flatMap(([action, value]) =>
    typeof value === "string"
      ? [{ action, resource: "*", effect: value }]
      : Object.entries(value).map(([resource, effect]) => ({ action, resource, effect })),
  )
}

/**
 * `#1687`(owner R4 选 A,编排器裁决接法 A):云服务此刻是否被 kill-switch 扣下 —— 即最近一次注入
 * 在配置里写的是中和条目 `WITHHELD_CLOUD_MCP`。值由下面写 `config.mcp` 的那一处**同一个判决**赋值,
 * 不另算;引擎跑的就是最近一次注入的配置,所以它与引擎眼里的云服务一致。renderer 经
 * `ext.cloudWithheld()` 只读取它:被扣下的云服务在定制中心补连后会报 `failed`(2.x `connect` 不看
 * `disabled`),状态里没有区分字段,「未恢复问题」入口靠这个值不把它当成故障。
 */
let cloudMcpWithheld = false

export function isCloudMcpWithheld(): boolean {
  return cloudMcpWithheld
}

export function injectCodePuppyConfig(
  userDataPath: string,
  extPluginPath?: string,
  registryChannel?: ChannelName,
): CodePuppyConfigInjectionResult {
  let file: string | undefined
  // 本轮没走到写云服务那一处(无云 URL / 注入失败)⇒ 配置里没有中和条目。
  cloudMcpWithheld = false
  try {
    // REQ-059 G1:引擎经 OPENCODE_CONFIG 加载当前环境的 codepuppy.jsonc(mcp/plugin/
    // provider/治理键)。文件通道 → dispose 重建重读文件 = 安装免重启;merge 序 XDG 后(压 provider)/
    // 项目前(可覆盖);junk 循环不扫单文件 → 当前环境根零引擎垃圾(T0 spike 判定)。全新机器 seed
    // {$schema},否则 loadFile 指向不存在文件。逃生 CODEPUPPY_JSONC_TRUTH_DISABLE / CODEPUPPY_LEGACY_INSTALL_ROOT
    // 不注入(回 REQ-018 home walk 行为,ext-config 写入目标也随之回退,两侧一致)。
    if (process.env.CODEPUPPY_JSONC_TRUTH_DISABLE !== "1" && process.env.CODEPUPPY_LEGACY_INSTALL_ROOT !== "1") {
      const truth = codepuppyJsoncPath()
      fs.mkdirSync(path.dirname(truth), { recursive: true })
      if (!fs.existsSync(truth)) {
        fs.writeFileSync(truth, JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2))
      }
      file = truth
    }

    const config: EngineConfig = { $schema: "https://opencode.ai/config.json", ...governanceFloor(extPluginPath) }
    // ADR-009 B1 的「平台代付」判据(云 MCP URL + 密钥文件同在)。caps 事实、云 MCP 注册与
    // web search 主权 deny 三处共用同一个判据,不许各算各的。`#1195` 起判据文件从
    // `CODEPUPPY_CLOUD_TOKEN`(错受众的 platform_access,只当在场性证据)换轴到
    // `CODEPUPPY_MCP_TOKEN`(登录铸 mcp_access)—— 它同时就是云 MCP 定义要引用的那份凭证,
    // 「代付成立」与「凭证可用」从此结构上不可能分叉。main 侧同一判据在
    // `server.ts` 的 `applyWebSearchSovereignty`,两处必须同轴。
    const platformPays = Boolean(process.env.CODEPUPPY_CLOUD_MCP_URL && hasSecretFile(userDataPath, "CODEPUPPY_MCP_TOKEN"))
    // ADR-009 B2 的能力总闸。main 在每次 fork 前用同一个表达式判过一次并把判决写进
    // `CODEPUPPY_CLOUD_WEBSEARCH_DENY`(server.ts);这里重算是因为注入面自己也要用(见下方云 MCP 注册)。
    const killSwitch = Boolean(process.env.CODEPUPPY_WEBSEARCH_DISABLE)
    // 云 MCP server 这一 fork 会不会以 `enabled:true` 注册。判据与下方真正写 `config.mcp` 的那个
    // 三分支**同一组输入**(kill-switch ⇒ 中和条目 `enabled:false`;代付 ⇒ 真定义 `enabled:true`;
    // 其余 ⇒ 无凭证 `enabled:false`)。identity 的云腿在场性读它,不另算一遍(`#1414` S4)。
    const mcpUrl = process.env.CODEPUPPY_CLOUD_MCP_URL
    const cloudMcpEnabled = Boolean(mcpUrl) && !killSwitch && platformPays
    // 只记录本轮函数自己新放进 mcp 的名字;继承来的 OPENCODE_CONFIG_CONTENT 不是治理授权。
    const injectedMcpNames = new Set<string>()

    const wantIdentity = !process.env.CODEPUPPY_IDENTITY_DISABLE
    const wantBehavior = !process.env.CODEPUPPY_BEHAVIOR_DISABLE
    if (wantIdentity || wantBehavior) {
      fs.mkdirSync(userDataPath, { recursive: true })
      const instructions: string[] = Array.isArray(config.instructions) ? config.instructions : []
      const addInstruction = (name: string, body: string) => {
        const file = path.join(userDataPath, name)
        fs.writeFileSync(file, body)
        if (!instructions.includes(file)) instructions.push(file)
      }

      if (wantIdentity) {
        // Capability facts the base prompt can't know — purely informational (ADR-009 / ADR-002).
        // The cloud token lives in the {file:} channel, never in this process's env (A6).
        //
        // `#1414` 基线 §三 **S4**(提示声称的能力必须与模型工具表里的在场性一致)。这里以前自己读
        // `CODEPUPPY_WEBSEARCH_DISABLE` + `OPENCODE_ENABLE_EXA` 再判「能不能搜网」—— 勘破 §6 点名的
        // **第四处各算各的**:与真闸不同源,于是可以「提示说有、工具表里没有」。改成**消费真闸的判决**:
        //   · 本地腿消失的那道闸 = `applyWebSearchDenies` 写的 permission deny(`cloud-web-search.ts:173`
        //     → 引擎 `Permission.disabled`,`opencode/src/session/llm/request.ts:234-244`)。拿一个空壳
        //     config 让**同一个函数、同一组入参**判一次再读判决,不手抄它的条件 —— 那条条件将来怎么改
        //     (`#1411` 正在改)这一行都跟着变。`denied.length === 0` 即早返回 ⇒ 空壳零副作用;
        //     diagnostic 传 no-op,免得同一条主权日志一次 fork 打两遍。
        //   · deny 之外还要先被引擎**注册**(`opencode/src/tool/registry.ts:63-70,335-338`
        //     的 `webSearchEnabled`),main 每次 fork 前落定的就是这组 keyless flag。**诚实边界**:
        //     上游 `enableExa` 还认 `OPENCODE_EXPERIMENTAL` umbrella 与 Zen provider,fork 前判不了
        //     ⇒ 这里只会**少报**(工具在而提示没说),不会多报。
        //   · 云腿在场性读上方的 `cloudMcpEnabled`(与写 `config.mcp` 那个三分支同源),外加它有没有被 deny。
        //   · `cloud.*` 那一行**刻意**仍只看代付:kill-switch 下完整定义经 ARM/DEF 托管给 ext,ext 真装上
        //     兄弟工具就在,而「ext 这一 fork 装没装」注入面判不了 —— 那一行的措辞本来就带条件。
        //   · `#1667`:v1 时代还读 `OPENCODE_ENABLE_EXA`;那个变量 2.x 无读者(清点表 E2),工具在不在场不再取决于它,读它只会说假话。
        const denyProbe: { permissions?: PermissionRule[] } = {}
        applyWebSearchDenies(denyProbe, { killSwitch, platformPays }, () => {})
        const deniedByGate = (toolId: string) => denyProbe.permissions?.some((rule) => rule.action === toolId && rule.effect === "deny") === true
        const cloudDispatch = platformPays
        const caps = buildCodePuppyCapabilities({
          localWebSearch: !deniedByGate(LOCAL_WEB_SEARCH_TOOL_ID),
          cloudWebSearch: !deniedByGate(CLOUD_WEB_SEARCH_TOOL_ID) && cloudMcpEnabled,
          cloudDispatch,
        })
        addInstruction(USER_DATA_LAYOUT.identity, buildCodePuppyIdentity(caps))
      }

      // Tier-3 behavioral tuning (ADR-015), independently gated. See codepuppy-behavior.ts for the drift caveat.
      if (wantBehavior) addInstruction(USER_DATA_LAYOUT.behavior, CODEPUPPY_BEHAVIOR_MD)

      config.instructions = instructions
    }

    // REQ-063:`<current-environment-root>/instructions/*.md` = 用户经导入门转换的全局指令(如 ~/.claude/CLAUDE.md
    // 快照)。存在即注入 —— 它们只在用户显式「导入」后出现,是 alpha 原生资产(非继承通道)。
    try {
      const instrDir = path.join(codepuppyGlobalRoot(), "instructions")
      const imported = fs.existsSync(instrDir)
        ? fs
            .readdirSync(instrDir)
            .filter((f) => f.endsWith(".md"))
            .sort()
            .map((f) => path.join(instrDir, f))
        : []
      if (imported.length) {
        const instructions: string[] = Array.isArray(config.instructions) ? config.instructions : []
        for (const f of imported) if (!instructions.includes(f)) instructions.push(f)
        config.instructions = instructions
      }
    } catch {
      /* unreadable dir → skip (imported instructions simply stay dark this fork) */
    }

    // `#1667`(C7 重裁):显式文件层要写的三样,出自这一次计算(engine-explicit-config.ts 抬头讲层序)。
    const layer: ExplicitLayer = { policies: [], commands: {}, skills: [] }
    const models = buildCodePuppyModelConfig(userDataPath)
    if (models) {
      // `#1667`:同一份投影,写成 2.x 的 `providers` / `policies`(`provider.use`)/ `model`(codepuppy-models.ts engineModelConfig)。
      // `policies` 写两处:显式文件那份比项目配置先加载、项目里的 allow 盖不过(第一层);内联这份是第二层。
      const engine = engineModelConfig(models)
      config.providers = engine.providers
      config.policies = engine.policies
      layer.policies = engine.policies
      if (engine.model) config.model = engine.model
    }

    //   4b. `#1667`(接缝裁决 A;编排器裁决 r1 第 2 条、r3 第 1 条):出厂技能目录与已安装技能当前那一代的**真实目录**写成显式文件的
    //       `skills`(explicitSkillDirs)。翻代 / 新装 / 停用时 sidecar 的监听重算并重写显式文件(engine-explicit-config.ts),
    //       2.x 的技能插件在配置更新时重新取源 —— 不重启就生效(沙箱真引擎实测)。不用软链(owner 2026-07-07「不用 symlink」)。
    layer.skills = explicitSkillDirs()

    //   4c. `#1667`(接缝裁决 C):出厂 /init、/review 的模板来自 ext 的 applyPromptTakeover(同一份文字),写成 `commands` 条目,
    //       由 core 自己的 `opencode.config.command` 实现模板文法与子任务(`review` 在子任务里跑:v1 的 `subtask: true`,2.x 原生键
    //       `subagent`)。逃生门与 ext 的提示词转写同一个:CODEPUPPY_PROMPT_REBRAND_DISABLE=1。
    //       写进显式文件(编排器裁决 r1 第 2 条):项目里的同名命令胜过它,它胜过上游内置的。
    if (process.env.CODEPUPPY_PROMPT_REBRAND_DISABLE !== "1") {
      const takeover: { command?: Record<string, { template: string; description?: string; subtask?: boolean }> } = {}
      applyPromptTakeover(takeover)
      layer.commands = Object.fromEntries(
        Object.entries(takeover.command ?? {}).map(([name, { subtask, ...command }]) => [name, { ...command, ...(subtask ? { subagent: true } : {}) }]),
      )
    }

    //   5. 自动化 readonly agent(REQ-021 A1.5 / ADR-022)。无人值守执行的硬前提 = 零 ask:
    //      permission 静态配死(V1 schema:pattern→action 对象,agent 级合并),不依赖运行时弹窗。
    //      read 全放但 *.env* 保持 deny(密钥文件不进上下文);edit/bash/外部目录一律 deny;
    //      question deny(无人在场没人答);doom_loop deny(异常循环直接断)。逃生:CODEPUPPY_AUTOMATION_DISABLE。
    if (!process.env.CODEPUPPY_AUTOMATION_DISABLE) {
      config.agents = {
        ...config.agents,
        "codepuppy-automation": {
          description: CODEPUPPY_AGENT_TEXT["codepuppy-automation"].description,
          // REQ-055:对选择器隐藏(上游 agent 原生 hidden 字段,仅影响可见列表;调度器按名 prompt 不受影响)
          hidden: true,
          mode: "primary",
          system: CODEPUPPY_AGENT_TEXT["codepuppy-automation"].prompt,
          permissions: rules([
            ["tool-policy-default", "ask"],
            ["read", { "*": "allow", "*.env*": "deny" }],
            ["glob", "allow"],
            ["grep", "allow"],
            ["list", "allow"],
            ["webfetch", "allow"],
            ["websearch", "allow"],
            ["skill", "allow"],
            ["edit", "deny"],
            ["shell", "deny"],
            ["external_directory", "deny"],
            ["doom_loop", "deny"],
            ["question", "deny"],
            ["subagent", "deny"],
          ]),
        },
      }
    }

    //   2b. REQ-028:交互只读 agent(composer「只读」档的真载体)。与 codepuppy-automation 的差异:
    //       交互场景有人在场 → question 允许;写/执行仍静态 deny —— 「真被 deny」而非 UI 文案。
    //       委派**会**破只读:子会话只继承父**会话**的 deny(上游 agent/subagent-permissions.ts),
    //       不继承本 agent 的规则,`general` 子任务照样能改文件、跑命令(REQ-236 方案 §1.3 F1)。
    //       所以 `task` 只放行同档自身(如以只读档运行的 `/review`),委派给其它助手一律 deny;
    //       点名助手 / 命令换助手 / 直接子任务三条入口在引擎 session/prompt.ts 按同一条规则问或拒。
    //       第三方 MCP 与插件工具每次询问(方案 §2.0 D1):身份轴闸用本规则集求值,设置里启用了也问。
    //       逃生:CODEPUPPY_READONLY_DISABLE。治理保护名单同 codepuppy-automation(X2,codepuppy-governance.ts)。
    if (!process.env.CODEPUPPY_READONLY_DISABLE) {
      config.agents = {
        ...config.agents,
        "codepuppy-readonly": {
          description: CODEPUPPY_AGENT_TEXT["codepuppy-readonly"].description,
          // REQ-055:对选择器隐藏;CodePuppyComposer 只读档改为提交时 agent 参数,不再依赖可见列表轮转
          hidden: true,
          mode: "primary",
          system: CODEPUPPY_AGENT_TEXT["codepuppy-readonly"].prompt,
          permissions: rules([
            ["read", { "*": "allow", "*.env*": "deny" }],
            ["glob", "allow"],
            ["grep", "allow"],
            ["list", "allow"],
            ["webfetch", "allow"],
            ["websearch", "allow"],
            ["skill", "allow"],
            ["edit", "deny"],
            ["shell", "deny"],
            ["external_directory", "deny"],
            ["subagent", { "*": "deny", "codepuppy-readonly": "allow" }],
            ["mcp:*", "ask"],
            ["plugin:*", "ask"],
          ]),
        },
      }
    }

    //   2d. `#1413`:交互「请求审批」agent(composer 权限档「请求审批」的真载体)。
    //       此前该档提交时**不带 agent**,落到引擎默认 agent `build`,而 build 的规则集基底是 `"*": "allow"` ——
    //       真 `Permission.ask` 实测 edit/bash 直接放行不弹框,「逐次询问」这个副标题是假的
    //       (docs/architecture/2026-09-23-runtime-permission-tiers.md §3)。
    //       语义 = build + edit/bash/task(派给其它助手)改成 ask,**别的一格都不动**:引擎对 config agent 的合成是
    //       `merge(defaults, user) + fromConfig(这里的 permission)`(agent/agent.ts config-agent 分支),
    //       而 build = `merge(defaults, {question: allow, plan_enter: allow}, user)`;所以这里要把 build 对 defaults
    //       的两条覆盖原样带上,否则「请求审批」会比「全部批准」少掉 question 工具。
    //       REQ-236(方案 §2.3):委派给其它助手(模型派子任务 / 点名 / 命令换助手 / 直接子任务)派出前
    //       也问一次 —— 子会话不继承本 agent 的 ask,不问就等于整段跳过「逐次询问」;同档自身不问。
    //       另把 defaults 里 `doom_loop` 与 `read *.env*` 的 ask **原样重写一遍**:agent 自己的键排在
    //       配置顶层 `permission` 之后,项目配置放宽不了它们(`*.env.example` 照 defaults 仍放行)。
    //       `external_directory`(R2:工作区外先问)不写在这里:写进配置会排在用户自己的规则之后、压过它们;由 ext 的 agent 变换
    //       插在引擎底座之后(packages/ext/src/external-directory-rule.ts,`#1662` parity)。
    //       没有 prompt(见 codepuppy-agents.ts 抬头:给了 prompt 就会顶掉整份底座)。
    //       不设逃生 env:composer 选了这档就发 `agent: "codepuppy-ask"`,agent 缺席 = 引擎具名报错(fail-closed),
    //       不是静默回到全放行。治理保护名单同 codepuppy-readonly(CODEPUPPY_INJECTED_AGENTS)。
    //       常驻闸:packages/opencode/test/permission/codepuppy-composer-tiers.test.ts(真 Agent + 真 Permission.ask)。
    config.agents = {
      ...config.agents,
      "codepuppy-ask": {
        description: CODEPUPPY_AGENT_TEXT["codepuppy-ask"].description,
        hidden: true,
        mode: "primary",
        permissions: rules([
          ["tool-policy-default", "ask"],
          ["question", "allow"],
          ["plan_enter", "allow"],
          // 与另外三个 alpha agent 同形:显式写 websearch allow(defaults 的 `*` 本来就 allow,求值结果不变),
          // 让 #223 的主权闸(applyWebSearchDenies 按 agent 钉 deny / keyless 下逐 agent 核 allow)对它一视同仁。
          ["websearch", "allow"],
          ["edit", "ask"],
          ["shell", "ask"],
          ["subagent", { "*": "ask", "codepuppy-ask": "allow" }],
          ["doom_loop", "ask"],
          ["read", { "*.env": "ask", "*.env.*": "ask", "*.env.example": "allow" }],
        ]),
      },
    }

    //   2c. REQ-024(自动化 A2):standard 可写档 agent。无人值守语义同 codepuppy-automation
    //       (question/task/doom_loop deny,零 ask 硬前提);差异 = edit allow + bash 受限 allow
    //       (破坏类命令模式 deny —— 模式黑名单**非穷尽**,UI 启用时有显式风险确认,不谎称安全)。
    if (!process.env.CODEPUPPY_AUTOMATION_DISABLE) {
      config.agents = {
        ...config.agents,
        "codepuppy-automation-standard": {
          description: CODEPUPPY_AGENT_TEXT["codepuppy-automation-standard"].description,
          // REQ-055:对选择器隐藏(同 codepuppy-automation)
          hidden: true,
          mode: "primary",
          system: CODEPUPPY_AGENT_TEXT["codepuppy-automation-standard"].prompt,
          permissions: rules([
            ["tool-policy-default", "ask"],
            ["read", { "*": "allow", "*.env*": "deny" }],
            ["glob", "allow"],
            ["grep", "allow"],
            ["list", "allow"],
            ["webfetch", "allow"],
            ["websearch", "allow"],
            ["skill", "allow"],
            ["edit", "allow"],
            [
              "shell",
              {
                "*": "allow",
                // 破坏类直呼(codex 审计加固:绝对路径/包装器/嵌套 shell/find -delete/git clean 常见绕法补拦;
                // 黑名单仍非穷尽 —— UI 风险确认与 agent prompt 如实声明,根治=沙箱化(后续)):
                "rm *": "deny",
                "*/rm *": "deny",
                "command *": "deny",
                "exec *": "deny",
                "env *": "deny",
                "xargs *": "deny",
                "sh *": "deny",
                "bash *": "deny",
                "zsh *": "deny",
                "eval *": "deny",
                "find * -delete*": "deny",
                "find * -exec *": "deny",
                "git clean*": "deny",
                "git reset --hard*": "deny",
                "sudo *": "deny",
                "chmod *": "deny",
                "chown *": "deny",
                "dd *": "deny",
                "mkfs*": "deny",
                "shutdown*": "deny",
                "reboot*": "deny",
                "kill *": "deny",
                "killall *": "deny",
                "git push*": "deny",
                "npm publish*": "deny",
                "curl * | *": "deny",
                "wget * | *": "deny",
              },
            ],
            ["external_directory", "deny"],
            ["doom_loop", "deny"],
            ["question", "deny"],
            ["subagent", "deny"],
          ]),
        },
      }
    }

    //   3. Cloud tool gateway (alpha-platform B). `#1195`(REQ-144 T2):凭证 = 登录铸的
    //      `mcp_access` token,经 A6 `{file:…CODEPUPPY_MCP_TOKEN}` 引用装进静态 Authorization header,
    //      `oauth:false` 把交互式 OAuth 那条路(被 ~10 分钟换血必然打断,`ac#721`/`ac#1044`)
    //      整个关掉。凭证文件缺席(登出 / alpha-web T1 未部署 / 信封未带字段)⇒ 写一份
    //      **无凭证通道**的 `enabled:false` 定义:不回退到 `CODEPUPPY_CLOUD_TOKEN` header(错受众)、
    //      不回退到交互式 OAuth(I6);条目本身必须在 —— 深合并里缺键不会删除继承来源的同名
    //      定义(#223 R6),`enabled:false` 的形状把它压掉。也绝不能发 `{file:}` 引用指向缺席
    //      文件:引擎对它 fail-loud 到整个 config 装载失败(`config/variable.ts` missing:"error")。
    //      `#1106` 的 doomed-connect 判据(镜像引擎 mcp-auth.json)随之就地退役:引擎不再持有
    //      云凭证,「boot 连接注定失败」的判据现在就是 platformPays 自己 —— 缺凭证 ⇒
    //      `enabled:false` ⇒ `MCP.create` 直接 DISABLED_RESULT,boot 零等待,形态不变。
    if (mcpUrl) {
      // #223 R4→R5 fail-closed:kill-switch 下 `cloud_web_search` 的**最终**闸住在 @codepuppy/ext
      // 的 tool.execute.before 钩子里(远端 MCP 无 per-tool 注册期过滤,permission deny 可被后置
      // allow 顶掉)。R3 用「extPluginPath 路径是否存在」判 ext 在不在场 —— R4 证明那不成立:
      // `OPENCODE_PURE=true` 让引擎整个跳过外部插件,bundle import 失败与插件初始化失败也都是
      // log-and-continue,三种情形下路径都还在而钩子不存在。
      //
      // R4 改成握手,但把定义先写成 `enabled:false` 再由 ext 翻开 —— **R5 判其为回归**:
      // `MCP.connect()`(`opencode/src/mcp/index.ts`)无条件把配置复制成 `enabled:true`,该能力
      // 公开为 `/mcp/:name/connect` 且产品 UI 真的在调,于是 ext 缺席时用户点一下就能把那份含
      // 完整 URL/header 的定义热连起来。`enabled:false` 从来不是「不可重开」。
      //
      // R5 形态:**完整定义根本不进配置**,只经 env 托管给 ext。
      //
      // #223 R6 Major:R5 只从继承来的 `OPENCODE_CONFIG_CONTENT` 对象里删掉 `mcp.cloud`,并据此
      // 声称「继承来的同名条目一并抹掉」—— 不成立。引擎另外还加载 XDG global、`OPENCODE_CONFIG`
      // (codepuppy.jsonc)、项目目录与 managed 配置,深合并里「缺少 cloud 键」**不会删除**先前来源的
      // 定义(`opencode/src/config/config.ts`)。所以这里改为写一份**中和条目**
      // (`WITHHELD_CLOUD_MCP`),用 later-wins 的标量覆盖把任何继承来的 `cloud` 的**连接控制字段**
      // (`type`/`url`/`enabled`/`oauth`;`headers`/`timeout` 会留下 —— #223 R7 措辞更正,它们已无处
      // 可发)压成一个连不上的 `127.0.0.1:1` 端点;ext 确认装载后由 `installCloudMcp()` 整条
      // 替换它。ext 缺席 ⇒ 留下的是中和条目 ⇒ `/connect` 连不上任何东西(连兄弟工具一起损失)——
      // 诚实降级,不是 AC4 的「误杀」:AC4 管的是闸生效时的正常态。
      // `#1195`:代付态的真定义带 `{file:…CODEPUPPY_MCP_TOKEN}` header;缺席态(platformPays=false)
      // 由同一工厂给出无引用的 `enabled:false` 形状(见 `cloud-sidecar-config.ts` 文件头)。
      // DEF 托管通道恒发**真定义**(带引用):ext 的 `installCloudMcp` 自己解析 `{file:}`,
      // 读不到时响亮不装(fail-closed)—— 治理身份通道不因凭证缺席而失明(#223 R6 Blocker)。
      const cloud = materializeCloudMcpConfig(mcpUrl, secretFileRef(userDataPath, "CODEPUPPY_MCP_TOKEN"))
      // ext 的闸靠这两个变量核验「哪个 MCP server 真的是 alpha 治理的云通道」——
      // #223 R6 Blocker:判据是 DEF 里那份定义的**端点身份**(URL),不再是名字前缀,所以 DEF 在
      // 代付的两条分支上都置位(ARM 只在 kill-switch 分支置位;ARM/DEF 缺一 ext 什么都不装)。
      process.env[CLOUD_MCP_SERVER_ENV] = CLOUD_MCP_SERVER_NAME
      process.env[CLOUD_MCP_DEF_ENV] = JSON.stringify(cloud)
      // 缺席 ⇒ enabled:false(`#1106` 的「boot 零等待」形态在新轴上保持:`MCP.create` 对
      // enabled:false 直接 DISABLED_RESULT)。kill-switch 优先:WITHHELD 分支形状不变
      // (它本身就是 enabled:false 的中和条目)。
      if (!killSwitch && !platformPays)
        console.log(
          `[alpha-code#1195] cloud MCP has no login-minted mcp_access credential (CODEPUPPY_MCP_TOKEN secret file absent) — injected a credential-free enabled:false definition; no fallback to CODEPUPPY_CLOUD_TOKEN or interactive OAuth`,
        )
      cloudMcpWithheld = killSwitch
      config.mcp = {
        ...config.mcp,
        servers: {
          ...config.mcp?.servers,
          [CLOUD_MCP_SERVER_NAME]: cloudMcpWithheld
            ? { ...WITHHELD_CLOUD_MCP }
            : platformPays
              ? cloud
              : materializeCloudMcpConfig(mcpUrl, undefined),
        },
      }
      injectedMcpNames.add(CLOUD_MCP_SERVER_NAME)
      if (killSwitch) {
        process.env[CLOUD_MCP_ARM_ENV] = CLOUD_MCP_SERVER_NAME
        console.error(
          `[alpha-code#223] web search kill switch is set — the cloud MCP server definition is WITHHELD from the engine config (a neutralised ${WITHHELD_CLOUD_MCP.url} entry overrides any inherited one); only a confirmed @codepuppy/ext load installs the real one via ${CLOUD_MCP_ARM_ENV}/${CLOUD_MCP_DEF_ENV}${extPluginPath ? "" : ", and no ext bundle path was resolved this fork so it will stay dark"}`,
        )
      } else {
        // 代付但无 kill-switch:云工具是权威通道,不需要闸,也就不该依赖 ext 是否装载。
        delete process.env[CLOUD_MCP_ARM_ENV]
      }
    } else {
      delete process.env[CLOUD_MCP_ARM_ENV]
      delete process.env[CLOUD_MCP_DEF_ENV]
      delete process.env[CLOUD_MCP_SERVER_ENV]
    }

    // Remote MCP config only toggles whole servers, but the engine's global permission layer filters
    // individual registered MCP tool IDs from both ordinary and code-mode tool sets. Deny only the
    // model-visible cloud_web_search ID and keep the cloud server plus sibling tools live.
    // #223:同一处也 deny 本地 `websearch` —— env 层的 keyless force-off 压不住
    // `OPENCODE_EXPERIMENTAL` umbrella(见 cloud-web-search.ts)。必须排在 agent 注入之后。
    applyWebSearchDenies(config, { killSwitch, platformPays })

    // `#1381`(`#1383` 基线 §四 子票 4):用户自配的**远程 MCP 服务器**从 main 才写得了的真源注入(mcp-server-records.ts:
    // `<appData>/codepuppy-state/mcp-servers/<env>.json`,位置由 CODEPUPPY_GLOBAL_DIR 逆映射,与自定义节点同一份解析)。整条注入
    // (type / url / headers)并显式 `enabled:true`:引擎原生仍会合并 codepuppy.jsonc(OPENCODE_CONFIG),同名的配置文件条目若在,
    // later-wins 让真源的连接字段赢;账本 disabled 由紧接着的 injectDisabledOverrides 压回 `enabled:false`(它排在后面正是为此)。
    // 放进 injectedMcpNames ⇒ 对 injectMcpDefaultDeny 而言它们是治理来源;codepuppy.jsonc 里不在真源的远程条目由它压成
    // enabled:false(基线 I1)。真源缺失 = 没有记录;坏了 = 一条不注入 + 一行原因。与平台云 MCP 同名的记录添加时已被拒
    // (ext-config.ts persistMcp),这里再挡一次,不让真源里的条目覆盖上面刚放好的云定义。判据:mcp-server-derivation.test.ts。
    for (const server of readMcpServerRecords((line) => console.error(line))) {
      if (injectedMcpNames.has(server.name)) {
        console.error(`[alpha-code#1381] remote MCP truth record "${server.name}" collides with a name this injection already governs — skipped`)
        continue
      }
      config.mcp = {
        ...config.mcp,
        servers: {
          ...config.mcp?.servers,
          [server.name]: { type: "remote", url: server.url, ...(server.headers ? { headers: server.headers } : {}) },
        },
      }
      injectedMcpNames.add(server.name)
    }

    // #395(Codex r11 pivot → 主权注入):把账本 disabled 的 mcp/agent 权威覆盖注入 OPENCODE_CONFIG_CONTENT
    // —— 它在引擎加载序 step 6(所有 in-scope 源之后:XDG / ~/.opencode / agent-md·plugin-script 自动
    // 发现目录 / 项目)。mergeDeep later-wins 使 alpha 的 `enabled:false`/`disable:true` **压过一切 in-scope
    // 源**,disabled 扩展永不被引擎加载 —— 无需逐源探测(探测器无底洞由此消除)。引擎 schema 显式允许
    // lone `{enabled:false}` mcp 叶(v1/config/config.ts:114)与 disable-only agent 叶(全 optional)。
    // plugin 是 union 无覆盖面,靠 codepuppy.jsonc 移除(无用户 = 无他源);cloud/skill 无此面。
    // 仅 global scope(项目 scope 由项目 config 面另管)。best-effort:账本不可读 → 跳过(codepuppy.jsonc
    // 投影仍在;主权注入是加固层)。#397:session-grant 记录在注入面强制按 disabled 处理
    // (持久 enable 非法;判定读已验 catalog,userDataPath/channel 由此传入)。channel 来自
    // StartCommand(main 冻结快照)—— 本进程调 catalogRegistryChannel() 必抛(见 StartCommand 注释),
    // 加固层的任何缺料只允许降级跳过,不允许波及上方 provider/identity/permission 注入。
    if (registryChannel) injectDisabledOverrides(config, { userDataPath, channel: registryChannel })
    else
      console.error(
        "[req104-397] registry channel missing from start command — skipping disabled-override injection (boot reconcile holds the fail-closed gate)",
      )

    // #535 / REQ-109 T6(基线 §② G1、§③):账本禁用覆盖落定后,枚举真实用户全局
    // XDG config 的三个文件。非治理 MCP 以末序 enabled:false 压住;治理 MCP 不复制、不改写。
    // 逐文件失败只 loud 跳过,不得破坏上方任何注入。
    injectMcpDefaultDeny(config, {
      codepuppyConfigPath: codepuppyJsoncPath(),
      injectedMcpNames,
    })

    const modelsFile = models ? materializeGovernedModelsBase(userDataPath, models) : undefined
    // 显式槽:用户的 codepuppy.jsonc(有的话)+ 上面那一层,合成一份写进 Code Puppy 自己的 userData(engine-explicit-config.ts)。
    const explicitFile = explicitConfigPath(userDataPath)
    const written = writeExplicitConfig(explicitFile, file, layer)
    if (written.userError) console.warn(`[alpha-code#1667] ${file} is not valid (${written.userError}); the engine sees only Code Puppy's explicit layer`)
    return {
      ok: true,
      config: { content: JSON.stringify(config), file: explicitFile },
      models: modelsFile ? { file: modelsFile } : {},
      explicit: { file: explicitFile, root: codepuppyGlobalRoot(), ...(file ? { userConfig: file } : {}), layer },
    }
  } catch (error) {
    // #613:catch 保留(sidecar 照常起,候选形态③),但失败必须离开本进程:
    // warn 是 #607 反向闸门锁住的进程内出声,返回值是送往 main/renderer 的结构化事实。
    console.warn("failed to inject alpha config", error)
    return {
      ok: false,
      error: error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) },
      // 注入失败也不让治理底线跟着丢:ext 目录、外部技能移除指令、五个实验开关照样写进去(governanceFloor)。
      // 没有 ext 的话 sidecar 的 I4 判定会拒绝 ready,而不是带着一个没有执行闸的引擎上线。
      config: { content: JSON.stringify({ $schema: "https://opencode.ai/config.json", ...governanceFloor(extPluginPath) }), ...(file ? { file } : {}) },
      models: {},
    }
  }
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

function materializeGovernedModelsBase(userDataPath: string, config: CodePuppyModelConfig): string | undefined {
  const dir = path.join(userDataPath, USER_DATA_LAYOUT.engineConfig)
  const modelsPath = path.join(dir, "models.json")
  const base = governedModelsBase(config)
  if (!Object.keys(base).length) {
    fs.rmSync(modelsPath, { force: true })
    return undefined
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(modelsPath, `${JSON.stringify(base, null, 2)}\n`, { mode: 0o600 })
  return modelsPath
}
