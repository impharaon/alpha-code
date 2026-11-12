// #223 R4/R5 —— 本地 `websearch` **工具**这一类的主权闸落在传输层;本文件是它的静态半场 + 纵深普查。
//
// ⚠️ R5 事实更正:R4 把下面这两条传输称为 web search 的**共同执行边界** —— 不成立。它们只覆盖
// 「本地 keyless websearch 工具」这一类。用户配置里的通用 Remote MCP
// (`{"mcp":{"exa":{"type":"remote","url":"…"}}}` → `exa_web_search_exa`)两条都不经过,它的钳制点
// 是 `packages/ext` 的 `tool.execute.before` 钩子(证据:
// `packages/opencode/test/tool/codepuppy-mcp-websearch-gate.test.ts`)。本文件的范围因此**只**是本地
// 工具那一类,别再据它声称 web search 已按类闭合。
//
// 演进史(写在这里免得下一轮又走回头路):
//   R2 收了 legacy `packages/opencode/src/tool/websearch.ts` 的 `execute` 首行。
//   R3 发现打包 sidecar 同时挂载 V2 Location 服务,`packages/core/src/tool/websearch.ts` 是第二份
//      活的同名注册,于是给它也加了首行闸,并加了下面这两张源码普查网当兜底。
//   R4 判普查网**可绕**,给出可执行构造:
//          const id = ["web", "search"].join("")
//          Tool.define(id, /* 调用既有 McpWebSearch.call */)
//      注册名是算出来的(Net A 看不见),传输复用已白名单的 `mcp-websearch.ts`(Net B 也看不见
//      新 URL),新叶子自然不读主权信号 —— 「两个已知实例加闸 + 源码盘点」不是类级规则。
//
// R4 的收口:闸下沉到**共同的执行边界**。本地 keyless web search 要出网只有两条出口,
// 两条都已按 ADR-035 收编为 alpha 全所有权,两条现在都在第一句读同一个信号:
//
//   packages/opencode/src/tool/mcp-websearch.ts  → `call()`      (legacy 引擎唯一的传输)
//   packages/core/src/tool/websearch.ts          → `callMcp()`   (V2 Core 那份副本的传输)
//
// 于是「换个注册名、复用传输」在**执行时**被拒,不需要被任何普查网看见。运行时证据(把 R4 那
// 段构造当变异种真跑一遍)在两个引擎包的 alpha 自有测试里:
//   packages/opencode/test/tool/codepuppy-websearch-failure.test.ts  · "R4 变异" 一组
//   packages/core/test/codepuppy-websearch-sovereignty.test.ts       · "R4 变异" 一组
//
// 本文件因此分成两部分:
//   ① 传输闸的位置锁(主判据的静态半场):两条出口的闸都必须排在构造请求之前。
//   ② 普查网(**纵深,不再是主判据**):抓「自带全新 HTTP 出口的副本」这一类 —— 上游 sync 带进
//      来的新工具是现实里唯一见过的形态,它会带字面量端点,两张网看得见。任何一张网变化 = 有人
//      加了新的 web search 执行面,停下来分类,而不是让它静默上线。

// ── 2026-11-12 I-09:OpenCode 2 上本文件剩下什么 ─────────────────────────────────────────────
// 上面说的两条传输(packages/opencode/src/tool/mcp-websearch.ts、packages/core/src/tool/websearch.ts)和两份叶子随
// OpenCode 2 换代删除(`44b6938b2a`)。2.x 的 websearch 注册与传输都是上游的(packages/core/src/tool/plugin/websearch.ts、
// packages/core/src/plugin/websearch/*),本仓不改上游文件;本地腿的主权判决改在 ext 的 `execute.before` 钩子第一句按工具名下
// (下面「云侧最终闸是 ext 执行钩子的第一句」照常判位置)。于是退役六条:
//   · 「<两条传输>:闸是出网出口的第一句」×2、「出网出口是导出的」—— 替代:packages/ext/src/plugin-host.test.ts
//     「权威 · 联网搜索准入(L5r)」(真宿主里 kill-switch 下 2.x 内置 websearch 与第三方 web search MCP 在 execute.before
//     被拒,反向臂不装 ext 即放行);
//   · 普查网三条(「全仓注册为 websearch 的工具恰好是这两份」「每一份注册的叶子闸…」「直接引用 Exa/Parallel 端点的文件…」)——
//     对象是本仓自己持有的副本,2.x 上本仓不再持有任何一份;按名字认出 web search 工具由 packages/ext/src/cloud-websearch-kill.test.ts
//     的 R6 / R7 两条(合法改名都命中、不相邻不命中)判。无对应用例:「上游 sync 带进来一份自带新端点的副本 ⇒ 停下来分类」
//     这张纵深网在 2.x 上没有对应物(新副本若起的名字认不出,ext 的名字判决关不掉它,见 `#1461`)。
// 「主权信道名…逐字一致」一条去掉两条传输的半句,其余照常判。
//
// ── 2026-11-12 `#1662` parity 第 9 项:普查网在 2.x 上重建 ────────────────────────────────────────
// 2.x 上能执行 web search 的地方都挂在同一个 `websearch` 工具后面(供应商经 `WebSearch.Service` 注册),主权判决在 ext 的
// execute.before 按工具名下;本仓自己持有的一份是 ext 的 exa 供应商(packages/ext/src/exa-websearch.ts,顶替上游那份)。纵深网照旧
// 只抓一件事:**新的执行面**(新注册一个供应商 / 新消费 WebSearch.Service / 新写一个供应商端点)出现时停下来分类,不让它静默上线。
//   网 A:生产源码里注册 web search 供应商或消费 WebSearch.Service 的文件,恰好是下面分好类的那些;
//   网 B:生产源码里写着某个供应商端点的文件,恰好是五份上游供应商、ext 的 exa 供应商与登记过的纯说明。
// 两张网各有一条已知的坏:往真树的文件集合里多放一个这样的文件,网必须点名它。

import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, test } from "bun:test"
import {
  CLOUD_MCP_ARM_ENV,
  CLOUD_MCP_DEF_ENV,
  CLOUD_MCP_SERVER_ENV,
  CLOUD_WEBSEARCH_DENY_ENV,
  LOCAL_WEBSEARCH_DENY_ENV,
} from "./cloud-web-search"

const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..", "..")
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8")

// ── 以下是纵深,不是主判据 ────────────────────────────────────────────────────

/**
 * 提到端点但**不出网**的文件。网 ② 抓的是「谁能打到 Exa/Parallel」,一段引用端点的**说明**不是
 * 执行面 —— 但它同样让集合变化,所以按「新增即分类」显式登记,并由下面那条断言证明它确实不出网
 * (零 HTTP / 零 MCP 调用原语)。#223 R5:ext 的闸在注释里引用了那份 exa remote MCP 配置示例。
 */
const DOCUMENTED_MENTIONS = [
  "packages/ext/src/cloud-websearch-kill.ts",
  // `#1415`:出网放行集合的静态半场要登记这两个目的地,否则登出 / BYOK 态下 `websearch` 每次
  // 都被我们自己的策略代理 403(该工具在那一态是广告给模型的)。注册表**不出网** —— 它只回答
  // 「这个 host:port 授权了吗」,由 main 进程的 CONNECT 代理来问;下面那条断言逐条证明它不含任何
  // 出网原语。值与真源不许漂由 network-egress-registry.test.ts 的 `#1415` 那一节从两条传输的
  // 源码派生后比对(注册表不自持第二份端点清单)。
  "packages/ui-mac/src/main/network-egress-registry.ts",
]
const EGRESS_PRIMITIVES = [/HttpClientRequest\./, /\bfetch\s*\(/, /\.callTool\s*\(/, /new\s+Request\s*\(/]

/** 生产源码:各包 `src/` 下 git 可见的 .ts / .tsx,去掉测试、cases 与类型声明。 */
function productionSources(): Array<{ path: string; text: string }> {
  const listed = Bun.spawnSync(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "packages"], { cwd: REPO_ROOT })
  return listed.stdout
    .toString()
    .split("\0")
    .filter((path) => /^packages\/[^/]+\/src\/.*\.tsx?$/.test(path) && !/\.(test|spec|cases)\.tsx?$|\.d\.ts$/.test(path))
    .map((path) => ({ path, text: read(path) }))
}
const sources = productionSources()

/** 网 A:注册 web search 供应商(上游 helper / 任何 `websearch.transform`)或消费 `WebSearch.Service` 的文件。 */
const WEBSEARCH_SURFACE = [/WebSearchProvider\.register\(/, /\bwebsearch\.transform\(/, /\bWebSearch\.Service\b/]
const surfaceOf = (files: Array<{ path: string; text: string }>) => files.filter((file) => WEBSEARCH_SURFACE.some((pattern) => pattern.test(file.text))).map((file) => file.path).sort()
const CLASSIFIED_SURFACE: Record<string, string> = {
  "packages/core/src/plugin/websearch/exa.ts": "上游 exa 供应商(ext 以同一个 id 顶替)",
  "packages/core/src/plugin/websearch/firecrawl.ts": "上游供应商,需要用户自己的 key",
  "packages/core/src/plugin/websearch/parallel.ts": "上游供应商",
  "packages/core/src/plugin/websearch/tavily.ts": "上游供应商,需要用户自己的 key",
  "packages/core/src/plugin/websearch/tinyfish.ts": "上游供应商",
  "packages/core/src/plugin/websearch/provider.ts": "上游供应商的注册 helper",
  "packages/core/src/plugin/provider/opencode.ts": "上游 OpenCode Console 的托管搜网,只在连了 Console 账户且远端配置开了它时注册",
  "packages/core/src/tool/plugin/websearch.ts": "唯一的 `websearch` 工具(ext 的 execute.before 按这个名字下主权判决)",
  "packages/core/src/config/plugin/websearch.ts": "用户配置的供应商选择",
  "packages/core/src/config/plugin/policy.ts": "托管策略删供应商后重载",
  "packages/core/src/plugin/host.ts": "插件上下文的 websearch 域(转交给服务)",
  "packages/core/src/plugin/internal.ts": "内置插件清单:把 WebSearch.Service 交给内置插件(供应商与工具都在上面列着)",
  "packages/plugin/src/promise/adapter.ts": "promise 插件适配层(转交给服务)",
  "packages/server/src/handlers/websearch.ts": "HTTP 路由 `/api/websearch`(转交给服务,同一个服务、同一批供应商)",
  "packages/ext/src/plugin.ts": "ext:默认选 exa、装 Code Puppy 的 exa 供应商(exa-websearch.ts)",
}

/** 网 B:写着某个供应商端点的文件。 */
const ENDPOINT = /mcp\.exa\.ai|search\.parallel\.ai|api\.tavily\.com|mcp\.firecrawl\.dev|agent\.tinyfish\.ai/
const endpointHolders = (files: Array<{ path: string; text: string }>) => files.filter((file) => ENDPOINT.test(file.text)).map((file) => file.path).sort()
const CLASSIFIED_ENDPOINTS = [
  "packages/core/src/plugin/websearch/exa.ts",
  "packages/core/src/plugin/websearch/firecrawl.ts",
  "packages/core/src/plugin/websearch/parallel.ts",
  "packages/core/src/plugin/websearch/tavily.ts",
  "packages/core/src/plugin/websearch/tinyfish.ts",
  "packages/ext/src/exa-websearch.ts",
  ...DOCUMENTED_MENTIONS,
]

describe("websearch 执行副本普查(#223 R3 · R4 起降为纵深)", () => {
  test("网 A:注册 web search 供应商或消费 WebSearch.Service 的生产文件,恰好是分好类的那些(新增即停下来分类)", () => {
    expect(surfaceOf(sources)).toEqual(Object.keys(CLASSIFIED_SURFACE).sort())
  })

  test("网 B:写着供应商端点的生产文件,恰好是五份上游供应商、ext 的 exa 供应商与登记过的纯说明", () => {
    expect(endpointHolders(sources)).toEqual([...CLASSIFIED_ENDPOINTS].sort())
  })

  test("已知的坏:多一个注册供应商的文件、多一个写着端点的文件,两张网都点名它", () => {
    const planted = { path: "packages/ext/src/planted-search.ts", text: 'await ctx.websearch.transform((editor) => editor.add({ id: "x" }))\nconst url = "https://mcp.exa.ai/mcp"' }
    expect(surfaceOf([...sources, planted])).toContain(planted.path)
    expect(surfaceOf([...sources, planted])).not.toEqual(Object.keys(CLASSIFIED_SURFACE).sort())
    expect(endpointHolders([...sources, planted])).toContain(planted.path)
    // 判官自检:真树确实扫到了文件(不是空集合对空集合)
    expect(sources.length).toBeGreaterThan(1000)
  })

  test("登记为「纯说明」的文件确实不出网(否则它就该按传输分类)", () => {
    for (const path of DOCUMENTED_MENTIONS) {
      const body = read(path)
      for (const pattern of EGRESS_PRIMITIVES)
        expect([path, pattern.source, pattern.test(body)]).toEqual([path, pattern.source, false])
    }
  })

  test("主权信道名在 ui-mac / ext / plugin 逐字一致;MCP authority 共享唯一核验源", () => {
    expect(LOCAL_WEBSEARCH_DENY_ENV).toBe("CODEPUPPY_LOCAL_WEBSEARCH_DENY")
    expect(CLOUD_WEBSEARCH_DENY_ENV).toBe("CODEPUPPY_CLOUD_WEBSEARCH_DENY")
    expect(CLOUD_MCP_ARM_ENV).toBe("CODEPUPPY_CLOUD_MCP_ARM")
    expect(read("packages/ext/src/cloud-websearch-kill.ts")).toContain(
      `export const CLOUD_WEBSEARCH_DENY_ENV = "${CLOUD_WEBSEARCH_DENY_ENV}"`,
    )
    const extGate = read("packages/ext/src/cloud-websearch-kill.ts")
    expect(extGate).toContain(`export const CLOUD_MCP_ARM_ENV = "${CLOUD_MCP_ARM_ENV}"`)
    // #878 gives the engine snapshot and ext sovereignty gate one verified-definition source.
    // The shared constants live in plugin; ext must explicitly re-export that exact source.
    const authority = read("packages/plugin/src/alpha-cloud-authority.ts")
    for (const [identifier, name] of [
      ["CLOUD_MCP_DEF_ENV", CLOUD_MCP_DEF_ENV],
      ["CLOUD_MCP_SERVER_ENV", CLOUD_MCP_SERVER_ENV],
    ]) {
      expect(authority).toContain(`export const ${identifier} = "${name}"`)
      expect(extGate).toContain(`${identifier},`)
    }
    // 2.x 的上游插件包名是 @opencode/plugin(v1 是 @opencode-ai/plugin)。
    expect(extGate).toContain('from "@opencode/plugin/alpha-cloud-authority"')
    // 本地判决在 ext 侧也必须逐字一致 —— R5 起 ext 的闸靠它拦第三方 web-search MCP。
    expect(read("packages/ext/src/cloud-websearch-kill.ts")).toContain(
      `export const LOCAL_WEBSEARCH_DENY_ENV = "${LOCAL_WEBSEARCH_DENY_ENV}"`,
    )
    // 两条判决都必须真的过得了 sidecar 白名单,否则闸在打包态恒不置位。
    const allowlist = read("packages/ui-mac/src/main/sidecar-env.ts")
    expect(allowlist).toContain(`"${LOCAL_WEBSEARCH_DENY_ENV}"`)
    expect(allowlist).toContain(`"${CLOUD_WEBSEARCH_DENY_ENV}"`)
    // 三个握手通道不在**固定**白名单里。⚠️ R5 事实更正:这**不等于**「外部 shell 伪造进不来」——
    // 逃生阀 CODEPUPPY_ENV_ALLOWLIST_EXTRA 点名即放行(它们都不是 credential-shaped),那半句 R4 的
    // 断言是错的,真实判据见 sidecar-env.test.ts 与 codepuppy-config-injection.test.ts 两条。
    for (const name of [CLOUD_MCP_ARM_ENV, CLOUD_MCP_DEF_ENV, CLOUD_MCP_SERVER_ENV])
      expect(allowlist).not.toContain(`"${name}"`)
  })

  // `#1667`(#1665 L3 交回):2.x 的执行钩子是 `context.tool.hook("execute.before", …)`(只有它允许失败,抛出即拒掉这次调用)。
  test("云侧最终闸是 ext 执行钩子的第一句(排在契约校验与 ctx.ask 之前)", () => {
    const plugin = read("packages/ext/src/plugin.ts")
    const hook = plugin.indexOf('context.tool.hook("execute.before"')
    expect(hook).toBeGreaterThanOrEqual(0)
    // #223 R7:归属实参从模块级默认值改成本实例闭包(`, process.env, mcpOwnership`),故只钉调用点。
    const gate = plugin.indexOf("assertWebSearchToolAllowed(event.tool", hook)
    const contract = plugin.indexOf("validateCloudToolInput(", hook)
    expect(gate).toBeGreaterThan(hook)
    expect(gate).toBeLessThan(contract)
    // 钩子体里闸之前没有别的语句(只允许注释)
    const body = plugin.slice(plugin.indexOf("{", hook) + 1, gate)
    expect(body.replace(/\/\/[^\n]*/g, "").trim()).toBe("")
  })

  // #223 R4:ext 装载回执必须排在项目配置之前 —— 项目配置的分支会失败,排在它们之后会让「项目 codepuppy.jsonc 读不了」
  // 顺带把云工具一起关掉。R5:回执从「翻开 enabled:false」改成「把定义装进配置」(`installCloudMcp`),位置要求不变。
  // `#1667`(#1665 L3 交回):2.x 没有整份 config 钩子,云 MCP 定义经本 Location 的 `context.mcp.transform` 编辑器装;
  // 回执是这个 transform 的第一句,排在项目 MCP 合并(`applyProjectMcp`,会抛)之前。
  test("ext 装载回执是 mcp.transform 的第一句(排在项目 MCP 合并之前)", () => {
    const plugin = read("packages/ext/src/plugin.ts")
    const transform = plugin.indexOf("context.mcp.transform((editor) => {")
    expect(transform).toBeGreaterThanOrEqual(0)
    const install = plugin.indexOf("installCloudMcp(editor)", transform)
    const project = plugin.indexOf("applyProjectMcp(editor", transform)
    expect(install).toBeGreaterThan(transform)
    expect(project).toBeGreaterThan(install)
    // 只找**语句**形态的 return(行首缩进后紧跟 return),否则注释里的字眼会误判位置。
    const firstReturn = transform + plugin.slice(transform).search(/\n\s*return[\s;]/)
    expect(install).toBeLessThan(firstReturn)
  })

  // #223 R5 Major:注入面在 kill-switch 下**不许**把真的云 server 定义写进配置 —— `MCP.connect()`
  // 会无条件把 `enabled:false` 复制成 `enabled:true`(`/mcp/:name/connect` 公开、产品 UI 在调)。
  // #223 R6 Major:但也不能只是「不写」—— 深合并里缺键不会删除 global / codepuppy.jsonc / 项目里
  // 先前来源的同名定义。唯一允许写进去的是那份中和条目 `WITHHELD_CLOUD_MCP`。
  // 行为证据在 packages/opencode/test/mcp/codepuppy-cloud-mcp-{revival,multisource}.test.ts;
  // 这里钉住静态形状:kill-switch 下写进 config.mcp 的**只能**是中和条目。
  test("kill-switch 分支写的是中和条目,真定义只经 ARM/DEF 托管", () => {
    const injection = read("packages/ui-mac/src/main/codepuppy-config-injection.ts")
    // `#1195` 起赋值是 platformPays 三分支(缺凭证 ⇒ 工厂给的无引用 disabled 形状),
    // 但 kill-switch 臂**必须**仍是中和条目且排在最前(缺凭证判定不得把真 URL 放回 kill-switch 态)。
    // `#1667`:2.x 的 MCP 条目在 `mcp.servers` 下(上游 `Config.Info` 的 `mcp.servers`)。
    const assign = injection.match(
      /config\.mcp = \{\n\s*\.\.\.config\.mcp,\n\s*servers: \{\n\s*\.\.\.config\.mcp\?\.servers,\n\s*\[CLOUD_MCP_SERVER_NAME\]: killSwitch\n\s*\? \{ \.\.\.WITHHELD_CLOUD_MCP \}\n\s*: platformPays\n\s*\? cloud\n\s*: materializeCloudMcpConfig\(mcpUrl, undefined\),\n\s*\},\n\s*\}/,
    )
    expect(assign).not.toBeNull()
    const branch = injection.indexOf("if (killSwitch) {")
    expect(branch).toBeGreaterThanOrEqual(0)
    const elseAt = injection.indexOf("\n      } else {", branch)
    expect(elseAt).toBeGreaterThan(branch)
    const body = injection.slice(branch, elseAt)
    expect(body).toContain(`process.env[CLOUD_MCP_ARM_ENV]`)
    // 这条分支绝不允许再往 config.mcp 里写第二次(真定义只走 ARM/DEF)。
    expect(body).not.toMatch(/config\.mcp\s*=/)
  })

  // #223 R6 Blocker:治理豁免绑定端点身份,所以 DEF 必须在**代付的两条分支**上都置位;
  // 而 ARM 只在 kill-switch 分支置位(ARM/DEF 缺一 ext 什么都不装,这条不变式仍在)。
  test("DEF 在代付两条分支都置位,ARM 只在 kill-switch 分支置位", () => {
    const injection = read("packages/ui-mac/src/main/codepuppy-config-injection.ts")
    const branch = injection.indexOf("if (killSwitch) {")
    const before = injection.slice(0, branch)
    expect(before).toContain("process.env[CLOUD_MCP_DEF_ENV] = JSON.stringify(cloud)")
    expect(before.lastIndexOf("process.env[CLOUD_MCP_ARM_ENV] = ")).toBe(-1)
  })
})
