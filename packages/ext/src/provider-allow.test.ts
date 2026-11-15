// `#1662` 供应商白名单(provider-allow.ts)的纯函数与放置时序。引擎里的端到端判据在
// packages/ui-mac/src/main/custom-provider-derivation.engine.cases.ts(全局配置目录的放行句压不过它、请求在发出之前被拒)。
import { afterEach, describe, expect, test } from "bun:test"
import {
  CONFIG_POLICY_PLUGIN,
  enforceProviderAllowList,
  providerAllowList,
  providerAllowTail,
  publishProviderAllowList,
  refuseOutsideProviderAllowList,
} from "./provider-allow"

const set = (...ids: string[]) => new Set(ids)
afterEach(() => publishProviderAllowList(undefined))
const editor = (ids: Array<[string, string]>) => {
  const records = new Map(ids.map(([id, activation]) => [id, { provider: { id, activation } }]))
  return { list: () => Array.from(records.values()), remove: (id: string) => void records.delete(id), ids: () => Array.from(records.keys()) }
}

describe("供应商白名单:集合、清单、请求", () => {
  test("`#1698` R30:注入经进程内交接发布放行集合(冻结、不进环境);没发布 ⇒ 本代不治理(不过滤、不拒);空集合 ⇒ 全部拿掉、全部拒", () => {
    expect(providerAllowList()).toBeUndefined()
    const ids = ["codepuppy", "my-openai"]
    publishProviderAllowList(ids)
    ids.push("exfil") // 发布的是一份冻结的副本,发布方事后改自己的数组不影响
    expect([...providerAllowList()!]).toEqual(["codepuppy", "my-openai"])
    expect(Object.isFrozen((globalThis as Record<symbol, unknown>)[Symbol.for("codepuppy.provider-allow")])).toBe(true)
    expect(process.env).not.toHaveProperty("CODEPUPPY_PROVIDER_ALLOW")
    publishProviderAllowList(undefined)
    expect(providerAllowList()).toBeUndefined()
    const absent = editor([["exfil", "enabled"]])
    expect(enforceProviderAllowList(absent, undefined)).toEqual([])
    expect(absent.ids()).toEqual(["exfil"])
    expect(() => refuseOutsideProviderAllowList({ model: { providerID: "exfil" } }, undefined)).not.toThrow()
    expect(() => refuseOutsideProviderAllowList({ model: { providerID: "codepuppy" } }, set())).toThrow()
  })

  test("集合外的一律拿掉,只把已配置的那些报出来;集合外的请求抛错且点名,集合内的放行", () => {
    const providers = editor([
      ["codepuppy", "enabled"],
      ["exfil-global", "enabled"],
      ["ollama", "auto"],
    ])
    expect(enforceProviderAllowList(providers, set("codepuppy"))).toEqual(["exfil-global"])
    expect(providers.ids()).toEqual(["codepuppy"])
    expect(() => refuseOutsideProviderAllowList({ model: { providerID: "exfil-global" } }, set("codepuppy"))).toThrow(
      `provider "exfil-global" is not in Code Puppy's allow list; the request was not sent`,
    )
    expect(() => refuseOutsideProviderAllowList({ model: { providerID: "codepuppy" } }, set("codepuppy"))).not.toThrow()
  })

  test("放置:插件清单里出现 opencode.config.policy 之前不登记;重放先登记新的再撤旧的;等不到就记一行、不登记", async () => {
    const order: string[] = []
    let plugins: string[] = ["codepuppy.ext"]
    let registered = 0
    const tail = providerAllowTail({
      transform: async () => {
        const id = ++registered
        order.push(`register ${id}`)
        return { dispose: async () => void order.push(`dispose ${id}`) }
      },
      activePlugins: async () => plugins,
      allowed: () => set("codepuppy"),
      log: (line) => void order.push(line),
      signal: new AbortController().signal,
      pollMs: 1,
    })
    const settled = tail.settle()
    await Bun.sleep(10)
    expect(order).toEqual([]) // 激活还没结束
    plugins = ["codepuppy.ext", CONFIG_POLICY_PLUGIN]
    await settled
    await tail.place()
    expect(order).toEqual(["register 1", "register 2", "dispose 1"])

    const lines: string[] = []
    await providerAllowTail({
      transform: async () => ({ dispose: async () => {} }),
      activePlugins: async () => ["codepuppy.ext"],
      allowed: () => undefined,
      log: (line) => void lines.push(line),
      signal: new AbortController().signal,
      pollMs: 1,
      settleTimeoutMs: 5,
    }).settle()
    expect(lines).toEqual([`[@codepuppy/ext] ${CONFIG_POLICY_PLUGIN} never appeared in the plugin list; the provider allow list is enforced on requests only`])
  })
})
