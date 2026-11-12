// `#1662` 供应商白名单(provider-allow.ts)的纯函数与放置时序。引擎里的端到端判据在
// packages/ui-mac/src/main/custom-provider-derivation.engine.cases.ts(全局配置目录的放行句压不过它、请求在发出之前被拒)。
import { describe, expect, test } from "bun:test"
import {
  CONFIG_POLICY_PLUGIN,
  enforceProviderAllowList,
  PROVIDER_ALLOW_ENV,
  providerAllowList,
  providerAllowTail,
  refuseOutsideProviderAllowList,
} from "./provider-allow"

const env = (value: string | undefined) => (value === undefined ? {} : { [PROVIDER_ALLOW_ENV]: value })
const editor = (ids: Array<[string, string]>) => {
  const records = new Map(ids.map(([id, activation]) => [id, { provider: { id, activation } }]))
  return { list: () => Array.from(records.values()), remove: (id: string) => void records.delete(id), ids: () => Array.from(records.keys()) }
}

describe("供应商白名单:集合、清单、请求", () => {
  test("没写 ⇒ 本代不治理(不过滤、不拒);写坏了 ⇒ 空集合(全部拿掉、全部拒)", () => {
    expect(providerAllowList(env(undefined))).toBeUndefined()
    expect([...providerAllowList(env('["codepuppy","my-openai"]'))!]).toEqual(["codepuppy", "my-openai"])
    for (const bad of ["not json", '{"a":1}', '["ok", 3]']) expect(providerAllowList(env(bad))!.size).toBe(0)
    const absent = editor([["exfil", "enabled"]])
    expect(enforceProviderAllowList(absent, env(undefined))).toEqual([])
    expect(absent.ids()).toEqual(["exfil"])
    expect(() => refuseOutsideProviderAllowList({ model: { providerID: "exfil" } }, env(undefined))).not.toThrow()
    expect(() => refuseOutsideProviderAllowList({ model: { providerID: "codepuppy" } }, env("nope"))).toThrow()
  })

  test("集合外的一律拿掉,只把已配置的那些报出来;集合外的请求抛错且点名,集合内的放行", () => {
    const providers = editor([
      ["codepuppy", "enabled"],
      ["exfil-global", "enabled"],
      ["ollama", "auto"],
    ])
    expect(enforceProviderAllowList(providers, env('["codepuppy"]'))).toEqual(["exfil-global"])
    expect(providers.ids()).toEqual(["codepuppy"])
    expect(() => refuseOutsideProviderAllowList({ model: { providerID: "exfil-global" } }, env('["codepuppy"]'))).toThrow(
      `provider "exfil-global" is not in Code Puppy's allow list; the request was not sent`,
    )
    expect(() => refuseOutsideProviderAllowList({ model: { providerID: "codepuppy" } }, env('["codepuppy"]'))).not.toThrow()
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
      env: env('["codepuppy"]'),
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
      env: {},
      log: (line) => void lines.push(line),
      signal: new AbortController().signal,
      pollMs: 1,
      settleTimeoutMs: 5,
    }).settle()
    expect(lines).toEqual([`[@codepuppy/ext] ${CONFIG_POLICY_PLUGIN} never appeared in the plugin list; the provider allow list is enforced on requests only`])
  })
})
