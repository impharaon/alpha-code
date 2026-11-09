import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import type { Plugin } from "@opencode/plugin"
import { registerPolicy } from "./policy-stub"
import {
  projectDirectoryIdentity,
  readProjectExtensionsConsent,
  requireCodePuppyGlobalRoot,
  withProjectDirectoryIdentity,
  type ProjectRoot,
} from "./project-config"
import { mergeProjectConfig } from "./project-config"
import { loadProjectPlugins } from "./plugin-fanout"
import { applyPromptTakeover } from "./codepuppy-prompts"
import { applyFactoryDeny, factoryDeniedSkills } from "./factory-deny"
import { rebrandSystem } from "./prompt-rebrand"
import { validateCloudToolInput, validateCloudToolOutput } from "./cloud-contract-hook"
import { platformOutputCap } from "./platform-output-cap"
import { platformCredentialHeader } from "./platform-credential-header"
import { byokOutputCap } from "./byok-output-cap"
// REQ-157 `#1284`:alpha 送进模型上下文的每段字都在 context-injection.ts 登记并声明上限。import 本身就是
// 一道闸 —— 任何片段超限,登记簿在模块装载时抛出,ext 整个装不上(2.x 记该插件 failed,`#1665` I4 让 sidecar 不报 ready),
// 而不是悄悄截一段发出去。
import { CLOUD_CONTRACT_REFUSED_ID, renderInventory, renderTemplate } from "./context-injection"
import {
  assertWebSearchToolAllowed,
  computeMcpOwnership,
  installCloudMcp,
  UNVERIFIED_MCP_OWNERSHIP,
  type McpOwnership,
} from "./cloud-websearch-kill"
import { createHubBridge, processParentPort, type HubBridge } from "./hub-bridge"
import { createHubTools, hubInstallEvaluate } from "./hub-tools"
import { createReloadScheduler, type ReloadScheduler } from "./reload-scheduler"
import { createCodePuppyTools } from "./codepuppy-tools"
import { applyAgents, applyProjectMcp, commandDefinitions } from "./engine-transforms"
import { modelFacts } from "./model-facts"
import { createCloudVisionHooks } from "./cloud-vision-hooks"
import { inProcessEngine } from "../../ui-mac/src/main/in-process-engine"

// ── `#1665` I2:进程级对象(定制中心桥 + 重载调度器)──────────────────────────────────────────────
// OpenCode 2 给**每个 Location** 各求值一次本模块(开工实测:两个目录 ⇒ 求值 2 次、setup 2 次;重载后再各 1 次;Node 下
// URL 还带递增的 `?__opencode_reload=`),没有一次与 sidecar 预载的 URL 是同一个模块记录。所以进程级对象挂在 globalThis 的
// 一个注册符号上:第一次求值创建,之后的求值直接复用 —— parentPort 上只挂一个监听,一条重载请求只入队一次。
// 监听仍在**模块求值时**挂上(sidecar 在 `start()` 之前预载本模块):main 只在 sidecar ready 那一刻重发排队的重载代际,
// 监听晚挂一步,那一批就丢了。
export const PROCESS_STATE_KEY = Symbol.for("codepuppy.ext.process")
export type ProcessState = { readonly hubBridge: HubBridge; readonly reloads: ReloadScheduler }

export function processState(): ProcessState {
  const holder = globalThis as { [PROCESS_STATE_KEY]?: ProcessState }
  const existing = holder[PROCESS_STATE_KEY]
  if (existing) return existing
  const hubBridge = createHubBridge(processParentPort())
  const reloads = createReloadScheduler({
    // I1 第 3 条:进程内引擎只在 setup 之后取(预载那次求值早于 `start()`)—— 调度器每轮现取。
    engine: inProcessEngine,
    report: (report) => hubBridge.report(report),
    log: (line) => console.log(line),
    error: (line) => console.error(line),
  })
  hubBridge.onReloadRequest((message) =>
    reloads.request({ generation: message.generation, scope: message.scope, reason: message.reason, force: message.force === true }),
  )
  const state: ProcessState = { hubBridge, reloads }
  holder[PROCESS_STATE_KEY] = state
  return state
}
processState()

/** L5r:没有任何选择时 Code Puppy 定的本地 keyless 搜网供应商(2.x 内置 `opencode.websearch.exa`,不需要密钥)。 */
const DEFAULT_WEBSEARCH_PROVIDER = "exa"

/** 会话事件:状态变了 ⇒ 请调度器重判(它自己问引擎的 active,不信事件里的快照)。 */
const RELOAD_POKE_EVENTS = ["session.idle", "session.status"] as const

const log = (line: string) => console.log(line)
const error = (line: string) => console.error(line)
const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/**
 * Code Puppy 后端隔离扩展 —— OpenCode 2 的 promise 插件(清点表 P1:`default` 导出 `{ id, setup }`,
 * `packages/plugin/src/promise/plugin.ts`)。由 sidecar 注入配置的 `plugins` 以**目录**登记(入口 `dist/server.js`)。
 *
 * `setup` 每个 Location 跑一次。次序是冻结接口(I3):第一句 `registerPolicy(context)`,让 L4 的执行闸排在 ext 自己的钩子
 * 与项目插件扇出之前;最后一句 `seal()`,让链尾那一段排在所有改写之后。`registerPolicy` 之后任何会因项目数据失败的步骤
 * 都就地吞掉并记日志 —— `setup` reject 会撤掉本插件已挂的闸。
 */
export const CodePuppyExt: Plugin.Plugin = {
  id: "codepuppy.ext",
  async setup(context) {
    const policy = await registerPolicy(context)
    const directory = context.location.directory
    const { hubBridge, reloads } = processState()
    const registration = {}
    reloads.register(directory, registration)
    const cleanups: Array<() => Promise<void> | void> = [() => reloads.unregister(directory, registration)]
    const cleanup = async () => {
      for (const run of cleanups.splice(0).reverse()) {
        try {
          await run()
        } catch (cause) {
          error(`[@codepuppy/ext] cleanup failed: ${describe(cause)}`)
        }
      }
    }
    try {
      // REQ-157 `#1284`:装载回执 —— 登记簿在 import 时已按上限校验过;这里只在 VERBOSE 下把库存打出来。
      if (process.env.CODEPUPPY_EXT_VERBOSE) log(`[@codepuppy/ext] context injections:\n${renderInventory()}`)
      // sidecar 初始化批次先复验 main 派生 root 的 canonical 身份;缺失、相对、退休根或 alias 都拒绝(环境错 = 结构性失败,让本插件 failed)。
      requireCodePuppyGlobalRoot()
      const projectRootFor = (target: string): ProjectRoot | null => {
        const identity = projectDirectoryIdentity(target)
        return identity.status === "project" ? identity : null
      }
      const project = projectRootFor(directory)

      // #223 R7:MCP 治理归属是**本 Location** 的状态 —— 由本 Location 的 mcp.transform 写、显式传给本 Location 的执行钩子;
      // 模块侧不留可变状态(I2 的进程级对象里只有桥与调度器)。没算出来 = 没有治理 server = 豁免不给(fail-closed)。
      let mcpOwnership: McpOwnership = UNVERIFIED_MCP_OWNERSHIP

      // ── 工具表(P8)──────────────────────────────────────────────────────────────────────────
      await context.tool.transform((editor) => {
        for (const tool of createCodePuppyTools({ context, reloads, projectRootFor, readConsent: readProjectExtensionsConsent }))
          editor.add(tool)
        for (const tool of createHubTools(hubBridge, context)) editor.add(tool)
      })

      // `#1419`(REQ-228):看不了图的模型 —— 图片送云端识图,模型可按编号 / 路径追问。登记簿按本 Location 建
      // (#223 R7 的纪律);能力真源是引擎目录里的模型(modelFacts);转写正文跨重启缓存在插件存储里。
      const vision = createCloudVisionHooks({
        directory,
        // 目录查不到(或查询失败)⇒ undefined ⇒ 按看不了图处理(基线 §2-B 第 6 条)。
        seesImages: (model) =>
          modelFacts(context, model).then(
            (facts) => facts.image,
            () => undefined,
          ),
        storage: { get: (key) => context.storage.get(key), set: (key, value) => context.storage.set(key, value) },
        error,
      })

      // ── 执行钩子(P7)────────────────────────────────────────────────────────────────────────
      await context.tool.hook("execute.before", async (event) => {
        // #223 R3→R5 / L5r:web search 主权判决 —— 抛出即拒掉这次调用(2.x 只有 execute.before 允许失败,抛出被转成
        // Tool.Error,只结束这一次调用)。命中面:任何 MCP server 上看起来是 web search 的工具,以及 2.x 内置的 `websearch`;
        // 治理云 server 的豁免按本 Location 核验过的端点身份判。理由与边界见 cloud-websearch-kill.ts。
        assertWebSearchToolAllowed(event.tool, process.env, mcpOwnership)
        validateCloudToolInput(event.tool, event.input, process.env, mcpOwnership)
        // `#1419`:模型追问 —— `codepuppy_vision` 的 image 由引用换成压缩后的 base64。
        await vision.toolBefore(event)
      })
      await context.tool.hook("execute.after", (event) => {
        if (event.status !== "completed") return
        // 2.x 的 execute.after 不允许失败(`packages/core/src/plugin/hooks.ts:23`):契约不符时把结果换成一句响亮的拒绝,
        // 不让一份没核过的结果原样回到模型。
        try {
          validateCloudToolOutput(event.tool, event.result, process.env, mcpOwnership)
        } catch (cause) {
          error(`[@codepuppy/ext] cloud tool ${event.tool} result refused: ${describe(cause)}`)
          event.result = { content: renderTemplate(CLOUD_CONTRACT_REFUSED_ID, { name: event.tool }), metadata: { codepuppy: { contractRefused: true } } }
        }
      })

      // ── 请求组装(P3 / P4 / P5 / P6)─────────────────────────────────────────────────────────
      const rebrandWarned = new Set<string>()
      await context.session.hook("context", async (event) => {
        // REQ-062 T1(路线A,ADR-015):系统提示词品牌转写 —— 精选子串对;失败 = 上游原样(外观级退化),绝不伤及请求。
        if (process.env.CODEPUPPY_PROMPT_REBRAND_DISABLE !== "1") {
          try {
            const r = rebrandSystem(event.system.map((part) => part.text))
            if (r.changed) event.system.splice(0, event.system.length, ...event.system.map((part, index) => ({ ...part, text: r.system[index]! })))
            for (const w of r.warnings) {
              if (rebrandWarned.has(w)) continue
              rebrandWarned.add(w)
              console.warn(`[@codepuppy/ext] prompt-rebrand: ${w}`)
            }
          } catch (cause) {
            error(`[@codepuppy/ext] prompt-rebrand failed: ${describe(cause)}`)
          }
        }
        // `#1419`:登记簿重建、审核拒绝结果的替换;看不了图 ⇒ 图换成转写块并追加一段登记过的说明(绝不抛)。
        await vision.context(event)
        // 输出上限两条腿,都只改这一次请求:平台代理节点**不发** max tokens(网关按 route 上限填,REQ-153);
        // 直连 BYOK 节点按逐模型实读上限抬(REQ-156);其余原样(上游算的那个数)。
        try {
          const facts = await modelFacts(context, event.model)
          if (platformOutputCap({ providerBaseURL: facts.baseURL, codepuppyBaseURL: process.env.CODEPUPPY_BASE_URL }).omit) {
            delete event.options.maxTokens
            return
          }
          const byok = byokOutputCap({
            engineProviderID: event.model.providerID,
            apiModelID: facts.modelID,
            providerBaseURL: facts.baseURL,
            current: event.options.maxTokens,
          })
          if (byok.raise) event.options.maxTokens = byok.value
        } catch (cause) {
          error(`[@codepuppy/ext] output cap skipped: ${describe(cause)}`)
        }
      })
      // REQ-236 `#1562`:平台代理节点的凭据每次请求现读,续期热应用不必重启引擎;读不到就抛,请求不发出。
      await context.session.hook("model.request", (event) => {
        const authorization = platformCredentialHeader({ providerBaseURL: event.baseURL, env: process.env })
        if (authorization) event.headers.authorization = authorization
      })

      // ── 配置域(C10 / L3r / M3)────────────────────────────────────────────────────────────
      // 项目 `.codepuppy/codepuppy.jsonc` + 出厂禁项 + 提示词接管,算成一份 v1 形状的小对象(既有纯函数),再按域翻译。
      // 每次 transform 重跑时现读(项目文件被 codepuppy_register 改过之后,重载即生效)。读不了 ⇒ 记日志、不加(项目数据不让 setup 失败)。
      const extConfig = () => {
        const cfg: Record<string, unknown> = {}
        try {
          if (project) {
            const present = withProjectDirectoryIdentity(project, (root) => existsSync(join(root, "codepuppy.jsonc")))
            if (!present.ok) error(`[@codepuppy/ext] project config refused: ${present.reason}`)
            else if (present.value) {
              // 信任门:项目自带可执行物(mcp、agent 的控制字段)只在项目已 consent 时加载。
              const trustExecutable = readProjectExtensionsConsent(project)
              const configRead = withProjectDirectoryIdentity(project, (root) => readFileSync(join(root, "codepuppy.jsonc"), "utf8"))
              if (trustExecutable === null) error("[@codepuppy/ext] project config refused: project alpha root identity drifted")
              else if (!configRead.ok) error(`[@codepuppy/ext] project config refused: ${configRead.reason}`)
              else {
                const { added, gatedExecutable } = mergeProjectConfig(cfg, configRead.value, { trustExecutable, directory: project.directory })
                if (gatedExecutable.length)
                  log(`[@codepuppy/ext] project has UNTRUSTED executable extensions (${gatedExecutable.join(", ")}) — not loaded until consent: ${directory}`)
                if (process.env.CODEPUPPY_EXT_VERBOSE && added.length) log(`[@codepuppy/ext] project config merged: ${added.join(", ")}`)
              }
            }
          }
          // REQ-067:上游默认禁项零明文 —— main 算 effective 名单经 env 传入;禁用由下面的 skill / permission 钩子执行。
          applyFactoryDeny(cfg, process.env.CODEPUPPY_FACTORY_DENY_SKILLS)
          // REQ-062 T3/T6:alpha 内容层接管(/init /review 模板 + general/explore/docs prompt),置于项目合并之后 ⇒ 项目同名让位。
          if (process.env.CODEPUPPY_PROMPT_REBRAND_DISABLE !== "1") applyPromptTakeover(cfg)
        } catch (cause) {
          error(`[@codepuppy/ext] project config failed: ${describe(cause)}`)
        }
        return cfg
      }

      await context.mcp.transform((editor) => {
        // #223 R5 / M3:云 MCP 的完整定义只由 ext 在这里装 —— 本句能执行 = 本 Location 的 ext 已装上、上面的执行闸已注册。
        try {
          const installed = installCloudMcp(editor)
          if (installed) log(`[@codepuppy/ext] cloud MCP server "${installed}" installed — the web search sovereignty gate is registered in this Location`)
        } catch (cause) {
          error(`[@codepuppy/ext] cloud MCP install failed: ${describe(cause)}`)
        }
        let merged = true
        try {
          applyProjectMcp(editor, extConfig().mcp, error)
        } catch (cause) {
          merged = false
          error(`[@codepuppy/ext] project MCP merge failed: ${describe(cause)}`)
        } finally {
          // #223 R6/R7:归属在本 Location 的 MCP 定义全部就位之后才算;合并中途出错 ⇒ fail-closed。
          mcpOwnership = merged ? computeMcpOwnership({ mcp: Object.fromEntries(editor.list()) }) : UNVERIFIED_MCP_OWNERSHIP
          if (process.env.CODEPUPPY_EXT_VERBOSE) log(`[@codepuppy/ext] MCP ownership (${directory}): ${JSON.stringify(mcpOwnership)}`)
        }
      })
      await context.agent.transform((editor) => {
        try {
          applyAgents(editor, extConfig().agent)
        } catch (cause) {
          error(`[@codepuppy/ext] agent transform failed: ${describe(cause)}`)
        }
      })
      await context.command.transform((editor) => {
        try {
          for (const definition of commandDefinitions(extConfig().command, context.session, error)) editor.add(definition)
        } catch (cause) {
          error(`[@codepuppy/ext] command transform failed: ${describe(cause)}`)
        }
      })
      // L5r(ADR-035 / ADR-046):本地 keyless 搜网由 Code Puppy 选供应商 —— 没有任何选择时定为 exa(keyless,v1 的本地腿之一),
      // 不让上游第一次搜网时弹它自己的「允许 OpenCode 搜网 / 选供应商」表单。用户配置的 `websearch` 由排在 ext 之后的
      // `opencode.config.websearch` 应用,照样优先;kill-switch 由上面的 execute.before 拒,与这里的选择无关。
      await context.websearch.transform((editor) => {
        if (editor.default.get() === undefined) editor.default.set(DEFAULT_WEBSEARCH_PROVIDER)
      })
      // REQ-067 / #1522:出厂禁用的技能 —— 从技能目录里拿掉(上游内置的那些在 ext 之前注册),并在权限评估里一律 deny
      // (覆盖之后才由配置目录装进来的同名技能)。
      await context.skill.transform((editor) => {
        for (const id of factoryDeniedSkills(process.env.CODEPUPPY_FACTORY_DENY_SKILLS)) editor.remove(id)
      })
      await context.permission.hook("evaluate", (event) => {
        // I10:定制中心安装恒弹框(自动化 agent 恒拒)。注册在 registerPolicy 之后 ⇒ 按注册顺序它说了算。
        hubInstallEvaluate(event)
        if (event.action === "skill" && event.resources.some((id) => factoryDeniedSkills(process.env.CODEPUPPY_FACTORY_DENY_SKILLS).includes(id)))
          event.effect = "deny"
      })

      // ── 会话事件(P12):状态变了 ⇒ 调度器重判 ───────────────────────────────────────────────
      const events = new AbortController()
      cleanups.push(() => events.abort())
      void (async () => {
        for await (const event of context.event.subscribe({ types: [...RELOAD_POKE_EVENTS], signal: events.signal })) {
          if (process.env.CODEPUPPY_EXT_VERBOSE) log(`[@codepuppy/ext] event: ${event.type}`)
          reloads.poke()
        }
      })().catch((cause) => {
        if (!events.signal.aborted) error(`[@codepuppy/ext] event subscription ended: ${describe(cause)}`)
      })

      // ── 项目插件扇出(P10):`.codepuppy/plugins/*.js`,信任门之后才加载;它们的钩子排在 ext 自己的之后、seal 之前 ──
      try {
        const consent = project ? readProjectExtensionsConsent(project) : false
        if (consent === null) error("[@codepuppy/ext] project plugin fan-out refused: project alpha root identity drifted")
        else
          cleanups.push(
            ...(await loadProjectPlugins(project?.root ?? "", context, consent, {
              verifyIdentity: () => !!project && withProjectDirectoryIdentity(project, () => true).ok,
              existsSync,
              readdirSync,
              importModule: (url) => import(url),
              pathToFileURL: (path) => pathToFileURL(path).href,
              join,
              log,
              error,
            })),
          )
      } catch (cause) {
        error(`[@codepuppy/ext] project plugin fan-out failed: ${describe(cause)}`)
      }
    } catch (cause) {
      await cleanup()
      throw cause
    }

    await policy.seal()
    return cleanup
  },
}

export default CodePuppyExt
