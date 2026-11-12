// `#1667`(#1662 L5,接口文档 I4 / 裁决书 R22):@codepuppy/ext 在初始目录上没装上,sidecar 就不报 ready。
//
// 为什么:2.x 下 Code Puppy 的执行闸、目录闸都挂在 ext 里(L4 的 `registerPolicy`)。v1 的闸在引擎核心,ext 装不上也还在;
// 2.x 里 ext 装不上 = 这个目录没有执行闸。所以判定与围栏装不上走同一条 fail-closed 路:sidecar 发 error IPC 并退出。
//
// 判据只读引擎自己的插件状态(`GET /api/plugin`,`packages/protocol/src/groups/plugin.ts`),按**目录**认 ext
// (编排器 2026-11-09 改形:2.x 只装目录形式的本地插件,`packages/core/src/config/plugin/source.ts` 遇文件路径直接丢弃):
// `source.type === "local" && source.path === extPluginDir && state.status === "active"`。不按 id 认,L3 的插件 id 不冻结;
// 同 id 的另一个插件抢先、ext 被当重复项丢掉,也表现为「找不到这一项」。
//
// 时机(实测,不是推断):Location 第一次被请求时才开始装插件,装完之前 `/api/plugin` 回空数组;装完那一刻整份清单(内置插件
// 九十多个 + 本地插件)一次性出现。所以这里轮询到清单非空再判;到点还是空的同样拒绝 —— 「没证明装上」就是没装上。
// 期限远小于 main 等 ready 的 60 s(server.ts 的 SIDECAR_START_STALL_TIMEOUT)。
import type { EngineFetch } from "./in-process-engine"

type PluginInfo = { source?: { type?: unknown; path?: unknown }; state?: { status?: unknown; error?: unknown } }

export const EXT_READY_DEADLINE_MS = 15_000
const POLL_MS = 50

export async function assertExtPluginActive(
  fetch: EngineFetch,
  directory: string,
  extPluginDir: string | undefined,
): Promise<void> {
  if (!extPluginDir)
    throw new Error("@codepuppy/ext was not resolved for this start — refusing ready: without ext the engine has no Code Puppy execution gate")
  const deadline = Date.now() + EXT_READY_DEADLINE_MS
  let plugins: PluginInfo[] = []
  for (;;) {
    const response = await fetch(
      new Request("http://codepuppy-sidecar.invalid/api/plugin", {
        headers: { "x-opencode-directory": encodeURIComponent(directory) },
      }),
    )
    if (!response.ok) throw new Error(`plugin status unavailable (${response.status}) — refusing ready without proof that @codepuppy/ext is active`)
    const body = (await response.json()) as { data?: unknown }
    plugins = Array.isArray(body.data) ? (body.data as PluginInfo[]) : []
    if (plugins.length > 0) break
    if (Date.now() >= deadline)
      throw new Error(`plugin inventory for ${directory} was never published — refusing ready without proof that @codepuppy/ext is active`)
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  const ext = plugins.find((plugin) => plugin.source?.type === "local" && plugin.source.path === extPluginDir)
  if (!ext) throw new Error(`@codepuppy/ext (${extPluginDir}) is not loaded in ${directory} — refusing ready: no Code Puppy execution gate`)
  if (ext.state?.status !== "active")
    throw new Error(
      `@codepuppy/ext (${extPluginDir}) failed to activate in ${directory}: ${JSON.stringify(ext.state?.error ?? ext.state)} — refusing ready: no Code Puppy execution gate`,
    )
}
