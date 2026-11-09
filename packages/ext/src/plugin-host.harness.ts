// `#1665` 退出条件「ext 的测试在 2.x 插件宿主里跑(不是替身)」的宿主:上游 core 自己的插件测试层(`PluginTestLayer`,
// `packages/core/test/plugin/fixture.ts`)+ 真的 `PluginHost.make` 与 promise 适配器(`PluginPromise.fromPromise`)。
// 钩子链(`PluginHooks`)、工具注册表(`Tool`)、agent / command / skill / provider / model 的 transform 都是上游的真服务;
// 只有上游测试层自己也替掉的那几样(权限的问答、MCP 连接)是桩 —— 与上游插件测试同一个口径。
//
// MCP:上游测试层的 MCP 服务对 transform 不回调(没有 server 可重建),这里换成一个按 2.x `MCPEditor` 接口记账的服务,
// 让 ext 的 mcp.transform 真被宿主调用(`installCloudMcp` / 项目 MCP / 归属计算走的都是生产代码)。
//
// 文件名带 `.harness.ts`:它 import 上游的测试目录,不进 ext 的 typecheck(tsconfig exclude),也不是一个测试文件。

import type { Plugin as PromisePlugin } from "@opencode/plugin"
import { Effect } from "effect"
import { Mcp } from "../../core/src/mcp/index.ts"
import { Plugin } from "../../core/src/plugin.ts"
import { PluginHost } from "../../core/src/plugin/host.ts"
import { PluginPromise } from "../../core/src/plugin/promise.ts"
import { testEffect } from "../../core/test/lib/effect.ts"
import { emptyMcp } from "../../core/test/fixture/mcp.ts"
import { PluginTestLayer } from "../../core/test/plugin/fixture.ts"

export const it = testEffect(PluginTestLayer)

/** 记账的 MCP 编辑器状态:ext 的 mcp.transform 每次被宿主调用,都在 `servers` 上重放。 */
export function recordingMcp(initial: Record<string, unknown> = {}) {
  const servers = new Map<string, unknown>(Object.entries(initial))
  const callbacks: Array<(editor: unknown) => void> = []
  const editor = {
    list: () => Array.from(servers),
    get: (name: string) => servers.get(name),
    set: (name: string, config: unknown) => void servers.set(name, structuredClone(config)),
    update: (name: string, update: (config: unknown) => void) => {
      const current = servers.get(name)
      if (current) update(current)
    },
    remove: (name: string) => void servers.delete(name),
  }
  const service = Mcp.Service.of({
    ...emptyMcp,
    transform: (callback: (editor: unknown) => void) =>
      Effect.sync(() => {
        callbacks.push(callback)
        callback(editor)
        return { dispose: Effect.void }
      }),
  } as unknown as Parameters<typeof Mcp.Service.of>[0])
  return { servers, service, rerun: () => callbacks.forEach((callback) => callback(editor)) }
}

/** 在真宿主里激活一个 promise 插件(ext 本体或测试用的旁路插件)。 */
export const activate = (plugin: PromisePlugin.Plugin, options: { mcp?: ReturnType<typeof recordingMcp> } = {}) =>
  Effect.gen(function* () {
    const plugins = yield* Plugin.Service
    const host = yield* PluginHost.make(plugins, plugin.id)
    yield* PluginPromise.fromPromise(plugin).effect(host)
  }).pipe(options.mcp ? Effect.provideService(Mcp.Service, options.mcp.service) : (effect) => effect)
