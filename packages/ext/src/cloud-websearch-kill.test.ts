import { mkdtempSync, realpathSync } from "node:fs"
import { publishTestBootstrap, testBootstrap, testCloudMcp, unpublishTestBootstrap } from "../../ui-mac/test-component/codepuppy-bootstrap-fixture"
import { parseCodePuppyBootstrap, type CodePuppyBootstrap } from "../../util/src/codepuppy-bootstrap"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { Tool } from "../../core/src/tool.ts"
import { Session } from "../../schema/src/session.ts"
import { SessionMessage } from "../../schema/src/session-message.ts"
import CodePuppyExt from "./plugin"
import { activate, it } from "./plugin-host.harness"
import {
  assertWebSearchToolAllowed,
  cloudWebSearchDenied,
  computeMcpOwnership,
  installCloudMcp,
  isWebSearchToolId,
  localWebSearchDenied,
  type McpOwnership,
  WebSearchSovereigntyError,
  webSearchToolDenial,
} from "./cloud-websearch-kill"

/** alpha 自己写的那份云 server 定义的端点身份(`#1698` 起在启动文档的 cloudMcp 里;此前经 CODEPUPPY_CLOUD_MCP_DEF 过河)。 */
const CLOUD_URL = "https://cloud.example/mcp"

/**
 * `#1698`:web search 的主权判决只有一个信号 —— 启动文档的 `webSearch.killSwitch`(此前两个 deny 环境变量都恒等于它,`#1411`)。
 * 「只有本地信号置位」的信号漂移从此结构上不存在(单一字段、发布后冻结);治理 / 冒名的区分仍在,体现在拒绝理由上:
 * 治理云 server 的搜网工具拿到的是 GOVERNED_REASON,别的(冒名、第三方、归属有歧义)拿到点名「按名字认出的工具」的那一句。
 */
const doc = (killSwitch: boolean, cloud: string | false = "cloud") =>
  testBootstrap({ globalRoot: "/tmp/codepuppy-websearch-kill", killSwitch, ...(cloud ? { cloudMcp: testCloudMcp(CLOUD_URL, "/tmp/codepuppy-cloud-token", cloud) } : {}) })
/** kill-switch 开、云 MCP 在场。 */
const ON = doc(true)
/** 平台代付、无 kill-switch(`#1411` / [[ADR-046]] D1 / D6):云 server 的身份照常在文档里。 */
const PLATFORM_PAYS = doc(false)
/** 登出 / BYOK:没有云 MCP,kill-switch 关。 */
const OFF = doc(false, false)
const GOVERNED_REASON = "the Code Puppy web search kill switch (ADR-009 B2) is set"
/** kill-switch 下这个工具按治理云工具判(只拿 GOVERNED_REASON),还是按第三方判。 */
const governedUnderKill = (tool: string, ownership: McpOwnership) => webSearchToolDenial(tool, ON, ownership) === GOVERNED_REASON

/**
 * 引擎**合并完成后**的配置形状:alpha 注入的云 server + 用户自带的若干第三方 server。
 * ext 的 `config` 钩子拿到的就是这个对象,`computeMcpOwnership()` 从它核验端点身份。
 */
const engineConfig = (servers: Record<string, unknown> = {}) => ({
  mcp: {
    cloud: { type: "remote", url: CLOUD_URL, enabled: true },
    exa: { type: "remote", url: "https://mcp.exa.ai/mcp" },
    ...servers,
  },
})

/** 生产路径的归属快照(`config` 钩子里 `computeMcpOwnership(cfg)` 算出来、存进本实例闭包的同一个值)。 */
const owned = (bootstrap: CodePuppyBootstrap, servers?: Record<string, unknown>): McpOwnership =>
  computeMcpOwnership(engineConfig(servers), bootstrap.cloudMcp)

/** 治理云 server(本文件的测试 server 名 `cloud`)上平台公开的非搜网兄弟工具(alpha-code#1568:远端名只说动作)。 */
const siblingCloudTools = [
  "cloud_dispatch",
  "cloud_status",
  "cloud_await",
  "cloud_artifacts",
  "cloud_cancel",
  "cloud_web_fetch",
  "cloud_vision",
  "cloud_decide",
  "cloud_account_status",
]

describe("cloud web search kill switch", () => {
  test("#1507 AC1:搜网拒绝理由使用 Code Puppy,ADR 原因码不变", () => {
    expect(webSearchToolDenial("cloud_web_search", ON, owned(ON))).toBe("the Code Puppy web search kill switch (ADR-009 B2) is set")
    expect(webSearchToolDenial("exa_web_search_exa", ON, owned(ON))).toStartWith("the Code Puppy web search kill switch (ADR-009 B2) is set; it turns off Code Puppy's own web search tools ")
  })

  test("`#1698`:云侧与本地侧的判决都只看启动文档的 webSearch.killSwitch(取值规则在 main 的构建器:任意非空串即开)", () => {
    for (const denied of [cloudWebSearchDenied, localWebSearchDenied]) {
      expect(denied(OFF)).toBe(false)
      expect(denied(PLATFORM_PAYS)).toBe(false)
      expect(denied(ON)).toBe(true)
      expect(denied(doc(true, false))).toBe(true)
    }
  })

  test("命中云 web search,放过全部兄弟云工具(AC4:不误杀)", () => {
    expect(isWebSearchToolId("cloud_web_search")).toBe(true)
    // 平台改名也得继续命中 —— 闸不许写死单个字面量。
    expect(isWebSearchToolId("cloud_web_search_v2")).toBe(true)
    expect(isWebSearchToolId("websearch")).toBe(true)
    for (const tool of siblingCloudTools) expect(isWebSearchToolId(tool)).toBe(false)
    for (const tool of ["read", "bash", "codepuppy_ping", "cloud_search_jobs", "webfetch"])
      expect(isWebSearchToolId(tool)).toBe(false)
  })

  // #223 R5 Blocker:通用 Remote MCP 是第三条现存出口。`{"mcp":{"exa":{"type":"remote",
  // "url":"https://mcp.exa.ai/mcp"}}}` 产生的工具 id 带 server 前缀**和**工具名自带后缀。
  test("命中带前后缀的第三方形态(exa_web_search_exa 等)", () => {
    for (const tool of [
      "exa_web_search_exa",
      "exa_websearch",
      "brave_web_search",
      "my-search_web_search_v2",
      "tavily_web_search-preview",
    ])
      expect(isWebSearchToolId(tool)).toBe(true)
    for (const tool of ["exa_deep_researcher_start", "exa_company_research", "exa_crawling", "context7_query-docs"])
      expect(isWebSearchToolId(tool)).toBe(false)
  })

  // #223 R6 Blocker ①:R5 的判据只认 `web_search` 词根,下面四个**合法工具名**实测 denial:null。
  test("R6 回归:合法改名 search_web / web-search / websearchTool / brave-search 都命中", () => {
    for (const tool of [
      "my_search_web",
      "srv_web-search",
      "srv_websearchTool",
      "srv_brave-search",
      "brave-search_brave_web_search",
      "tavily_search",
      "srv_searchWeb",
    ])
      expect([tool, isWebSearchToolId(tool)]).toEqual([tool, true])
    // 误杀防线:带 search 但不是网页搜索的工具照常放行(AC4)。
    for (const tool of [
      "cloud_search_jobs",
      "gdrive_search_files",
      "code_search",
      "srv_semantic_search",
      "srv_search_replace",
    ])
      expect([tool, isWebSearchToolId(tool)]).toEqual([tool, false])
  })

  // #223 R7 out-of-round Minor:判据 ② 是「`search` 与引擎词**相邻**」,不是「同时出现」。
  // 按集合判时下面两个第三方工具都会命中 —— 误杀,与 AC4 反向。
  test("R7 回归:引擎词与 search 不相邻时不命中(brave_translate_and_search / internet_archive_search)", () => {
    for (const tool of [
      "brave_translate_and_search",
      "internet_archive_search",
      "exa_company_search_jobs",
      "online_docs_semantic_search",
    ])
      expect([tool, isWebSearchToolId(tool)]).toEqual([tool, false])
    // 相邻的那一类照旧命中(收窄没有把判据 ② 判空)。
    for (const tool of ["srv_brave_search", "srv_search_brave", "tavily_search", "srv_kagi-search", "srv_ddg_search"])
      expect([tool, isWebSearchToolId(tool)]).toEqual([tool, true])
  })

  // #223 R6 Blocker ①(诚实登记的天花板):非 ASCII 工具名经 `McpCatalog.sanitize` 后只剩下划线,
  // **任何**按名字的分类器都看不见它。ADR-009 已据此收窄宣称 —— 第三方 web-search MCP 不在保证内。
  test("R6 回归(已登记的漏):sanitize 抹平的非 ASCII 名分类不出来", () => {
    const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_")
    const toolId = `srv_${sanitize("网页搜索")}`
    expect(toolId).toBe("srv_____")
    expect(isWebSearchToolId(toolId)).toBe(false)
  })

  test("闸开时抛,闸关时全放行", () => {
    expect(() => assertWebSearchToolAllowed("cloud_web_search", ON, owned(ON))).toThrow(WebSearchSovereigntyError)
    expect(() => assertWebSearchToolAllowed("cloud_web_search", ON, owned(ON))).toThrow(/do not retry/)
    expect(() => assertWebSearchToolAllowed("cloud_web_search", OFF, owned(OFF))).not.toThrow()
    for (const tool of siblingCloudTools) {
      expect(() => assertWebSearchToolAllowed(tool, ON, owned(ON))).not.toThrow()
      expect(() => assertWebSearchToolAllowed(tool, OFF, owned(OFF))).not.toThrow()
    }
  })
})

// #223 R5 Blocker:主权判决必须覆盖**任何** MCP server 上的 web search,不只是 alpha 自己那个。
describe("第三方 MCP 上的 web search 同受主权判决(R5 Blocker)", () => {
  const thirdParty = ["exa_web_search_exa", "brave_web_search", "tavily_websearch"]

  // `#1443` 的「信号漂移」(只有本地信号置位)随 `#1698` 的单一 killSwitch 结构上消失;这里钉住 kill-switch 下两类工具各拿各的理由,
  // 兄弟云工具不误杀。
  test("kill-switch:第三方按第三方理由关(点名按名字认出),alpha 治理的云工具只拿治理理由;兄弟云工具不关", () => {
    for (const tool of thirdParty) {
      expect(() => assertWebSearchToolAllowed(tool, ON, owned(ON))).toThrow(WebSearchSovereigntyError)
      expect(() => assertWebSearchToolAllowed(tool, ON, owned(ON))).toThrow(/do not retry/)
      expect(governedUnderKill(tool, owned(ON))).toBe(false)
    }
    expect(governedUnderKill("cloud_web_search", owned(ON))).toBe(true)
    for (const tool of siblingCloudTools) expect(() => assertWebSearchToolAllowed(tool, ON, owned(ON))).not.toThrow()
  })

  test("kill-switch:第三方与云工具一起关", () => {
    for (const tool of [...thirdParty, "cloud_web_search"])
      expect(() => assertWebSearchToolAllowed(tool, ON, owned(ON))).toThrow(WebSearchSovereigntyError)
    for (const tool of siblingCloudTools) expect(() => assertWebSearchToolAllowed(tool, ON, owned(ON))).not.toThrow()
  })

  // 模型看得见的那句话(照 `#1411` 对 `LOCAL_WEBSEARCH_DENIED_MESSAGE` 的同形修正)。
  //
  // 非治理 server 那条分支的理由此前写「the platform pays for search, or the web search kill switch is
  // set」。`#1411` 起 main 只在 kill-switch 下置位两个 deny 信号、代付态一个都不置(真 fork 判据在
  // `ui-mac/src/main/server.test.ts`),于是到得了这个分支的产品态只剩 kill-switch —— 而上一条已经证明
  // 那一态治理云工具同样被关。「代付」与「除平台自己的以外」两个半句在唯一可达它的状态下都是假的。
  // 基线 S5:指不出在场的替代就明说没有。
  test("拒绝理由在唯一可达它的状态(kill-switch)下只点名 kill-switch,不串名代付、不指向任何替代", () => {
    // 读的是**抛出来的值**,不是文件正文 —— 正文匹配会被注释里的同形字样骗过去。
    const thrown = (tool: string): unknown => {
      try {
        assertWebSearchToolAllowed(tool, ON, owned(ON))
      } catch (error) {
        return error
      }
      return undefined
    }
    for (const tool of thirdParty) {
      const error = thrown(tool)
      expect(error).toBeInstanceOf(WebSearchSovereigntyError)
      const message = (error as Error).message
      // 说清是谁关的:kill-switch 是唯一能到这里的原因。
      expect(message.toLowerCase()).toContain("kill switch")
      // 不再串名一个到不了的原因,也不再暗示平台自己的工具还在。
      expect(message.toLowerCase()).not.toContain("platform pays")
      expect(message.toLowerCase()).not.toContain("pays for")
      expect(message).not.toContain("B1")
      expect(message.toLowerCase()).not.toContain("except")
      expect(message).not.toContain("cloud_web_search")
      // 仍必须让模型停手并自己说明 —— 否则它会把「能力被关掉」当成瞬时故障反复调用。
      expect(message).toContain("do not retry")
      expect(message).toContain("Answer without web search and say so")
    }
  })

  // `#1461` 实测(docs/verification/2026-09-27-1461-third-party-websearch-mcp-four-states/):同一个第三方
  // 插件、同一格 kill-switch env,工具名 `web_search` 被拒、`search` 照常搜到 DuckDuckGo 结果 —— 判据入口是
  // 工具名,认不出的结构上关不掉。于是「it turns off every web search tool — …, and this one alike」在它唯一
  // 可达的状态下是假话。这里钉住:事实收窄到「alpha 自己的腿 + 按名字认出的」;「别找替代」保留为指令,
  // 不再是穷尽的承诺。已知的坏:把文案改回带 `every web search tool` 的那句 ⇒ 第一条断言红。
  test("`#1461`:拒绝理由不再宣称关掉了每一个 web search 工具,只承认按名字认出的;仍叫模型别去找替代", () => {
    const thrown = (tool: string): unknown => {
      try {
        assertWebSearchToolAllowed(tool, ON, owned(ON))
      } catch (error) {
        return error
      }
      return undefined
    }
    for (const tool of thirdParty) {
      const error = thrown(tool)
      expect(error).toBeInstanceOf(WebSearchSovereigntyError)
      const lower = (error as Error).message.toLowerCase()
      // 全称声称出局:开关关不掉名字认不出的第三方搜网工具(`duck_search` 反向臂)。
      expect(lower).not.toContain("every web search tool")
      // 范围要说出来:被关的是按名字认出的那些。
      expect(lower).toMatch(/recogni[sz]e[sd]? .*by name/)
      // 「别去找替代」保留,但作为指令而不是「找也没用」的承诺(与 LOCAL_WEBSEARCH_DENIED_MESSAGE 同一句)。
      expect(lower).toContain("do not look for another web search tool")
    }
  })

  test("登出 / BYOK(两个信号都不置位):第三方 web search 照常可用", () => {
    for (const tool of thirdParty) expect(() => assertWebSearchToolAllowed(tool, OFF, owned(OFF))).not.toThrow()
  })

  // `#1443`([[ADR-046]] D6):平台代付**今天**的真实信号形状 —— 两个 deny 都缺席、云身份通道在场。
  // `#1411` 起本地 keyless `websearch` 在这一态活着,拦第三方护不住任何能力,于是它也放行。
  // 四种账户态的合成判据在 `ui-mac/src/main/server.test.ts` 的「`#1443` 用户自带的第三方
  // web-search MCP」—— 那一组的 env 来自真 fork,这一组只钉「见到这组信号该怎么判」。
  test("平台代付(两个信号都不置位):第三方 web search 与云工具一起可用", () => {
    for (const tool of [...thirdParty, "cloud_web_search"])
      expect(() => assertWebSearchToolAllowed(tool, PLATFORM_PAYS, owned(PLATFORM_PAYS))).not.toThrow()
    for (const tool of siblingCloudTools)
      expect(() => assertWebSearchToolAllowed(tool, PLATFORM_PAYS, owned(PLATFORM_PAYS))).not.toThrow()
  })

  test("治理例外只认启动文档点名的那个 server,不写死 \"cloud\" 字面量", () => {
    const renamed = doc(true, "alphacloud")
    const config = { mcp: { alphacloud: { type: "remote", url: CLOUD_URL }, cloud: { type: "remote", url: CLOUD_URL } } }
    const ownership = computeMcpOwnership(config, renamed.cloudMcp)
    expect(ownership).toEqual({ governed: ["alphacloud"], foreign: ["cloud"] })
    expect(governedUnderKill("alphacloud_web_search", ownership)).toBe(true)
    // 名字没对上就不是治理通道 —— 一个自称 cloud、甚至照抄了 alpha URL 的第三方 server 拿不到治理身份。
    expect(() => assertWebSearchToolAllowed("cloud_web_search", renamed, ownership)).toThrow(WebSearchSovereigntyError)
    expect(governedUnderKill("cloud_web_search", ownership)).toBe(false)
  })

  test("文档里没有云 server 时(登出态),kill-switch 下同名工具按第三方判,fail-closed", () => {
    const loggedOutKill = doc(true, false)
    expect(() => assertWebSearchToolAllowed("cloud_web_search", loggedOutKill, owned(loggedOutKill))).toThrow(WebSearchSovereigntyError)
    expect(governedUnderKill("cloud_web_search", owned(loggedOutKill))).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// #223 R6 Blocker ②:治理例外必须绑定**不可由 MCP 名称伪造的端点身份**。
//
// R5 的判据是 `tool.startsWith("${server}_")` —— 名字前缀,不是 server 身份。R6 实跑证明:
// 一个叫 `cloud_attacker` 的用户 server 上的 `web_search` 因此被当成治理云工具直接放行。
// 现在判据是「名字等于注入面点名的那个 **且** 配置里那条定义的 URL 与 alpha 自己写的逐字相同」,
// 并且工具归属的**任何歧义**都倒向 fail-closed。
// ─────────────────────────────────────────────────────────────────────────────
describe("治理豁免绑定端点身份,名字伪造不了(R6 Blocker)", () => {
  test("端点身份核验:URL 对上才算治理 server", () => {
    expect(owned(PLATFORM_PAYS)).toEqual({ governed: ["cloud"], foreign: ["exa"] })
    // 同名但换了 URL(managed / MDM 之类的后置来源覆盖回去)⇒ 不再是治理 server,fail-closed。
    const hijacked = computeMcpOwnership({ mcp: { cloud: { type: "remote", url: "https://attacker.example/mcp" } } }, ON.cloudMcp)
    expect(hijacked).toEqual({ governed: [], foreign: ["cloud"] })
    expect(() => assertWebSearchToolAllowed("cloud_web_search", ON, hijacked)).toThrow(WebSearchSovereigntyError)
    expect(governedUnderKill("cloud_web_search", hijacked)).toBe(false)
    // 文档里没有云 MCP ⇒ 没有可核验的身份,一个 server 都不治理(坏形状的定义在解析文档时就被拒,进不了这一层)。
    expect(owned(OFF).governed).toEqual([])
  })

  test("R6 回归:`cloud_attacker` 拿不到豁免(R5 下它被当成治理云工具放行)", () => {
    const servers = { cloud_attacker: { type: "remote", url: "https://attacker.example/mcp" } }
    const ownership = owned(ON, servers)
    expect(ownership.foreign).toContain("cloud_attacker")
    expect(() => assertWebSearchToolAllowed("cloud_attacker_web_search", ON, ownership)).toThrow(WebSearchSovereigntyError)
    expect(governedUnderKill("cloud_attacker_web_search", ownership)).toBe(false)
    // 真的治理云工具仍按治理云工具判(归属没有因此变成一刀切)。
    expect(governedUnderKill("cloud_web_search", ownership)).toBe(true)
  })

  test("R6 回归:`<server>_<tool>` 边界歧义倒向 fail-closed(cloud_web + search)", () => {
    // 一个叫 `cloud_web` 的 server 上的 `search` 与治理 server 上的 `web_search` 拼出同一个 id。
    const ownership = owned(ON, { cloud_web: { type: "remote", url: "https://attacker.example/mcp" } })
    expect(() => assertWebSearchToolAllowed("cloud_web_search", ON, ownership)).toThrow(WebSearchSovereigntyError)
    expect(governedUnderKill("cloud_web_search", ownership)).toBe(false)
  })

  test("R6 回归:运行时 `POST /mcp` 新装的 server(配置里没有)一律拿不到豁免", () => {
    const ownership = owned(ON)
    // 归属不在快照里 ⇒ 没有候选 ⇒ 治理身份不给。
    for (const tool of ["runtime_web_search", "cloudx_web_search", "cloud-2_web_search"]) {
      expect(() => assertWebSearchToolAllowed(tool, ON, ownership)).toThrow(WebSearchSovereigntyError)
      expect(governedUnderKill(tool, ownership)).toBe(false)
    }
  })

  // 诚实登记(R6 D-1 收窄后落在「用户自己新装的第三方 MCP」那一类):`POST /mcp` 用**同一个名字**
  // 替换掉已连的客户端后,上游没有任何接口把「当前活着的 server 定义」暴露给插件 —— 配置快照
  // 仍是 alpha 那份,ext 从名字上分辨不出来。收编它要动 handlers/mcp.ts / mcp/index.ts,不在本票范围。
  test("残留(登记,非闭合):同名 `POST /mcp` add 替换客户端后,豁免仍按配置快照给", () => {
    const ownership = owned(PLATFORM_PAYS)
    expect(() => assertWebSearchToolAllowed("cloud_web_search", PLATFORM_PAYS, ownership)).not.toThrow()
    // 但 kill-switch 下它照样被关 —— 治理身份不是「越过 kill-switch」。
    expect(() => assertWebSearchToolAllowed("cloud_web_search", ON, owned(ON))).toThrow(WebSearchSovereigntyError)
  })

  test("config 钩子没跑过 ⇒ 没有任何治理 server(模块默认值 fail-closed)", () => {
    // 不传 ownership:本实例的 config 钩子还没算出归属时,治理身份一律不给(默认实参 = UNVERIFIED)。
    expect(() => assertWebSearchToolAllowed("cloud_web_search", ON, { governed: [], foreign: [] })).toThrow(WebSearchSovereigntyError)
    expect(governedUnderKill("cloud_web_search", { governed: [], foreign: [] })).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// `#1665`(OpenCode 2):放行覆盖不了 kill-switch。2.x 的唯一咽喉是 `Tool.execute`:先触发 `execute.before`,再进工具自己的
// `execute`(那里面才有 `permission.assert`,`packages/core/src/tool.ts` run / `tool/mcp.ts`)。ext 的闸在 execute.before 里
// 抛出 ⇒ 调用被拒,工具的 execute(连同里面那一问与传输)一次都不发生 —— 任何 allow 规则、已批准的授权都插不进来。
// 下面在**真宿主**里注册一个会先问权限再「打传输」的 MCP 形态工具,在最有利于绕过的权限状态(评估恒 allow)下判。
// ─────────────────────────────────────────────────────────────────────────────
describe("放行覆盖不了 kill-switch(2.x 真宿主)", () => {
  afterEach(() => unpublishTestBootstrap())

  /** sidecar 在装 ext 之前发布启动文档(R14);这一格的 kill-switch 与云 MCP 就在里面。 */
  const run = (killSwitch: boolean) =>
    Effect.gen(function* () {
      publishTestBootstrap({
        globalRoot: realpathSync(mkdtempSync(join(tmpdir(), "codepuppy-ext-allow-"))),
        killSwitch,
        cloudMcp: testCloudMcp(CLOUD_URL, "/tmp/codepuppy-cloud-token", "cloud"),
      })
      const transport: string[] = []
      yield* activate({
        id: "test.mcp-shaped-tool",
        async setup(context) {
          await context.permission.hook("evaluate", (event) => void (event.effect = "allow"))
          await context.tool.transform((editor) => {
            for (const name of ["cloud_web_search", "cloud_status"])
              editor.add({
                name,
                description: name,
                input: { type: "object", properties: {}, additionalProperties: false },
                options: { codemode: false },
                execute: async () => {
                  transport.push(`callTool:${name}`)
                  return { content: "ok" }
                },
              })
          })
        },
      })
      yield* activate(CodePuppyExt)
      const tools = yield* Tool.Service
      const snapshot = yield* tools.snapshot()
      const call = (name: string) =>
        snapshot
          .execute({
            sessionID: Session.ID.make("ses_allow"),
            agent: "build" as never,
            messageID: SessionMessage.ID.make("msg_allow"),
            call: { type: "tool-call", id: `call_${name}`, name, input: {} },
          })
          .pipe(Effect.exit)
      return { transport, search: yield* call("cloud_web_search"), sibling: yield* call("cloud_status") }
    })

  it.live("kill-switch 下 cloud_web_search 到不了传输(评估恒 allow 也一样);兄弟云工具照常执行", () =>
    Effect.gen(function* () {
      const { transport, search, sibling } = yield* run(true)
      expect(Exit.isFailure(search)).toBe(true)
      expect(JSON.stringify(search)).toContain("kill switch")
      expect(Exit.isSuccess(sibling)).toBe(true)
      expect(transport).toEqual(["callTool:cloud_status"])
    }),
  )

  it.live("闸关时 cloud_web_search 照常执行(不是永久禁用)", () =>
    Effect.gen(function* () {
      const { transport, search } = yield* run(false)
      expect(Exit.isSuccess(search)).toBe(true)
      expect(transport).toContain("callTool:cloud_web_search")
    }),
  )
})

// `installCloudMcp`:注入面托管的云 MCP 定义只由 ext 装进 2.x 的 MCP 编辑器(清点表 M3;真宿主里的反向臂在 plugin-host.test.ts)。
describe("installCloudMcp 单元判据", () => {
  const tokenFile = join(tmpdir(), `codepuppy-ext-token-${process.pid}`)
  const editor = (initial: Record<string, unknown> = {}) => {
    const servers = new Map<string, unknown>(Object.entries(initial))
    return { servers, set: (name: string, config: unknown) => void servers.set(name, config) }
  }
  // `#1698`:要装的定义来自启动文档(main 用 materializeCloudMcpConfig 写的同一形状:`Bearer {file:…}` 认证头、`oauth:false`)。
  const armed = doc(true)
  const readToken = () => "tok-live"

  test("装的是完整定义(2.x 形状:没有 enabled 键),{file:} 引用在这一层解析,整条替换同名条目,别的条目不动", () => {
    const target = editor({ cloud: { type: "remote", url: "http://127.0.0.1:1/withheld", disabled: true }, other: { type: "local", command: ["x"], disabled: true } })
    expect(installCloudMcp(target, armed, readToken)).toBe("cloud")
    expect(target.servers.get("cloud")).toEqual({ type: "remote", url: CLOUD_URL, headers: { Authorization: "Bearer tok-live" }, oauth: false, codemode: false })
    expect(Object.keys(target.servers.get("cloud") as object).sort()).toEqual(["codemode", "headers", "oauth", "type", "url"])
    expect(target.servers.get("other")).toEqual({ type: "local", command: ["x"], disabled: true })
  })

  test("名字取启动文档点名的那个 server", () => {
    const target = editor()
    expect(installCloudMcp(target, doc(true, "alphacloud"), readToken)).toBe("alphacloud")
    expect(target.servers.has("alphacloud")).toBe(true)
  })

  test("只在 kill-switch 开且文档里有云 MCP 时装(cloudMcpArmed);缺一个就什么都不装", () => {
    for (const bootstrap of [doc(true, false), doc(false), doc(false, false)]) {
      const target = editor()
      expect(installCloudMcp(target, bootstrap, readToken)).toBeUndefined()
      expect(target.servers.size).toBe(0)
    }
  })

  test("坏定义(不是 remote / 认证头不是 {file:} 引用 / 多键)进不了启动文档:解析就拒,ext 装不到它", () => {
    const base = { ...armed, cloudMcp: undefined } as Record<string, unknown>
    for (const definition of [
      { type: "local", url: CLOUD_URL, headers: { Authorization: "Bearer {file:/t}" }, oauth: false, codemode: false },
      { type: "remote", url: CLOUD_URL, headers: { Authorization: "Bearer tok-literal" }, oauth: false, codemode: false },
      { type: "remote", url: CLOUD_URL, headers: { Authorization: "Bearer {file:/t}" }, oauth: false, codemode: false, enabled: true },
    ])
      expect(() => parseCodePuppyBootstrap({ ...base, cloudMcp: { name: "cloud", definition } })).toThrow(expect.objectContaining({ reason: "invalid" }))
  })

  test("带 {file:} 的定义在密钥文件读不到时 fail-closed:不装一个没有凭据的 server", () => {
    const target = editor()
    const missing = () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
    }
    expect(installCloudMcp(target, armed, missing)).toBeUndefined()
    expect(target.servers.size).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// #223 R7:治理归属是**每个 Location** 的,不串扰。2.x 下每个 Location 各跑一次 ext 的 `setup`(进程级单例里只有定制中心桥
// 与重载调度器),归属活在 setup 的闭包里,由本 Location 的 mcp.transform 写、本 Location 的 execute.before 读。
// 下面跑的是真的 `CodePuppyExt.setup`,两个 Location 各一份记账的插件 Context。判据 = B 的 foreign server 改不动 A 的判决。
// ─────────────────────────────────────────────────────────────────────────────
describe("跨 Location 隔离:治理归属按 setup 闭包,不串扰(#223 R7 Blocker)", () => {
  const GOVERNED = { type: "remote", url: CLOUD_URL } as const
  const FOREIGN = { type: "remote", url: "https://attacker.example/mcp" } as const

  beforeEach(() => {
    // kill-switch 下:治理云工具拿治理理由,归属有歧义的按第三方理由(`#1698` 前用「只有本地信号」的漂移态区分放行 / 拒绝)。
    publishTestBootstrap({
      globalRoot: realpathSync(mkdtempSync(join(tmpdir(), "codepuppy-ext-xtalk-"))),
      killSwitch: true,
      cloudMcp: testCloudMcp(CLOUD_URL, "/tmp/codepuppy-cloud-token", "cloud"),
    })
  })
  afterEach(() => unpublishTestBootstrap())

  /**
   * 一个 Location:记下注册的全部 execute.before 与 mcp.transform(ext 的 setup 先后装了 L4 策略的头与尾),其余注册吞掉。
   * 工具表里有被问的那个工具(策略按它认身份);裁决按宿主的链:execute.before 依注册顺序逐个跑。
   */
  const location = async (directory: string) => {
    const befores: Array<(event: Record<string, unknown>) => unknown> = []
    const mcpTransforms: Array<(editor: unknown) => void> = []
    const noop = async () => ({ dispose: async () => {} })
    const domain = (name: string) =>
      new Proxy({}, {
        get: (_t, method: string) => {
          if (name === "tool" && method === "hook") return async (hook: string, callback: never) => (hook === "execute.before" && befores.push(callback), { dispose: async () => {} })
          if (name === "tool" && method === "list") return async () => [{ id: "cloud_web_search", name: "cloud_web_search" }]
          // #1699 的规则回退会读 agent.get 的真实返回形状;保留该宿主原先的空规则输入。
          if (name === "agent" && method === "get") return async () => ({ data: { permissions: [] } })
          if (name === "plugin" && method === "list") return async () => ({ data: [] })
          // session.list 是分页接口(protocol groups/session.ts 的 SessionsResponse:`{ data, cursor }`)。
          if (name === "session" && method === "list") return async () => ({ data: [], cursor: {} })
          if (name === "mcp" && method === "transform") return async (callback: never) => (mcpTransforms.push(callback), { dispose: async () => {} })
          if (name === "event" && method === "subscribe") return () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) })
          return noop
        },
      })
    const context = new Proxy({ location: { directory, project: { id: "global", directory, canonical: directory } } }, {
      get: (target, key: string) => (key in target ? (target as Record<string, unknown>)[key] : domain(key)),
    })
    await CodePuppyExt.setup(context as never)
    return {
      configure: (servers: Record<string, unknown>) => {
        const map = new Map(Object.entries(servers))
        const editor = { list: () => Array.from(map), get: (n: string) => map.get(n), set: (n: string, c: unknown) => map.set(n, c), update: () => {}, remove: (n: string) => map.delete(n) }
        for (const transform of mcpTransforms) transform(editor)
      },
      verdict: async (tool: string) => {
        try {
          for (const before of befores) await before({ tool, input: {}, sessionID: "ses_xtalk", agent: "build", messageID: "msg_xtalk", id: "call_xtalk" })
          return null
        } catch (error) {
          // 治理云工具的拒绝理由只有那一句;第三方 / 有歧义的那一句点名「按名字认出的工具」
          return error instanceof Error ? (error.message.includes("by name") ? "third-party" : "governed") : String(error)
        }
      },
    }
  }

  test("B 记录一个 foreign `cloud_web` 后,A 的 cloud_web_search 仍按治理云工具判;反向同理", async () => {
    const a = await location(realpathSync(mkdtempSync(join(tmpdir(), "codepuppy-ext-projA-"))))
    const b = await location(realpathSync(mkdtempSync(join(tmpdir(), "codepuppy-ext-projB-"))))
    a.configure({ cloud: { ...GOVERNED } })
    expect(await a.verdict("cloud_web_search")).toBe("governed")
    b.configure({ cloud: { ...GOVERNED }, cloud_web: { ...FOREIGN } })
    expect(await b.verdict("cloud_web_search")).toBe("third-party")
    expect(await a.verdict("cloud_web_search")).toBe("governed")
    a.configure({ cloud: { ...GOVERNED } })
    expect(await b.verdict("cloud_web_search")).toBe("third-party")
    expect(await a.verdict("cloud_web_search")).toBe("governed")
  })
})
