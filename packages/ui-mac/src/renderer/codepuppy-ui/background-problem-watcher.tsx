// 工具服务(连接器)连不上 → 「未恢复问题」入口(SPEC-error-message-lifetime v2 AC-01/05/06,`#1687`;
// owner 2026-11-12 选 A:连不上的连接器**不弹提示**,只进入口,重连后自动移除)。
//
// 无界面子组件,挂在 index.tsx。时机:第一次读 `mcp.status` 放在启动静默窗口结束之后(`startupQuietEnded`),
// 启动期不多发任何请求,窗口内失败又自己连上的什么都不留;之后在引擎事件 `mcp*` / 实例释放与运行时恢复
// `ready` 时重读。事件走自己的一条全局订阅:定制中心那条订阅活在 `useExtensions` 里、直到定制中心第一次
// 打开才建立(启动性能决定,`use-extensions.ts` 的 A2 lazy),没有可共享的应用级订阅。
//
// 只用入口那一半的公开入口:失败 = `putProblem({ attention: false })`,恢复 = `resolveProblem`。
// 需要重新登录(`needs_auth`)是要用户动手的项:条目上的操作就是去授权,做了即离开入口(R2),
// 授权后若仍要登录,下一次读状态会把它放回来。
import { createEffect, onCleanup, type Accessor } from "solid-js"
// CLIENT subpath only — the v2 barrel pulls Node-only deps that break the renderer (see ADR-008).
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import type { ServerInfo } from "../sidebar/use-projects"
import { isConnected, isDisabled, isPending, needsAuth } from "../extensions/use-extensions"
import { catalog } from "../extensions/catalog-source"
import { installedRowKey, openExtHubAt } from "../extensions/ext-hub-state"
import { extIpc } from "../extensions/ext-ipc"
import { subscribeRuntimeRecovery } from "../runtime-recovery"
import { t } from "../i18n"
import { putProblem } from "./problems"
import { resolveProblem, startupQuietEnded } from "./Toast"

type Client = ReturnType<typeof createOpencodeClient>

const keyOf = (name: string) => `connector\0${name}`

/** 第一方云服务的配置键(main `cloud-web-search.ts` 的 `CLOUD_MCP_SERVER_NAME`;renderer 其它处同样按字面量认它)。 */
const CLOUD_SERVER = "codepuppy"

/** main 注入配置时的判决:云服务此刻被 kill-switch 扣下。读不到按未扣下处理(与此前行为一致)。 */
async function cloudWithheld(): Promise<boolean> {
  try {
    return (await extIpc.cloudWithheld()) === true
  } catch {
    return false
  }
}

/** 用户认得的名字:随包目录里的显示名,找不到才用服务名。 */
function displayName(name: string): string {
  return catalog().entries.find((entry) => entry.type === "mcp" && entry.name === name)?.displayName ?? name
}

/** 「查看」:打开连接器页并定位到这个服务的那一行(`#1691`)。 */
function viewConnector(name: string) {
  openExtHubAt("connectors", installedRowKey("mcp", name))
}

export function BackgroundProblemWatcher(props: { server: Accessor<ServerInfo | undefined> }) {
  let disposed = false
  let generation = 0
  let client: Client | undefined
  /** 上一次读到时在入口里的服务名(下一次读不到或已恢复的,从入口移除)。 */
  let listed = new Set<string>()

  async function readStatus() {
    const c = client
    const gen = generation
    if (!c) return
    let data: Record<string, unknown> | undefined
    const withheld = cloudWithheld()
    try {
      const r = await c.mcp.status({} as never)
      if (r.error || !r.data) return
      data = r.data as Record<string, unknown>
    } catch {
      return
    }
    const skipCloud = await withheld
    if (disposed || gen !== generation) return
    const next = new Set<string>()
    for (const [name, info] of Object.entries(data)) {
      if (isConnected(info) || isDisabled(info) || isPending(info)) continue
      // 有意关闭的不是问题:被 kill-switch 扣下的云服务在定制中心补连后报 `failed`(2.x `connect` 不看
      // `disabled`),状态里没有区分字段,只能按 main 的判决跳过,不解释错误原文。
      if (skipCloud && name === CLOUD_SERVER) continue
      next.add(name)
      const title = displayName(name)
      if (needsAuth(info)) {
        putProblem({
          key: keyOf(name),
          title: t("codepuppy.problems.connectorNeedsAuth", { name: title }),
          action: {
            label: t("codepuppy.ext.mcpAuthorize"),
            run: () => void c.mcp.auth.authenticate({ name }).catch(() => undefined).then(() => readStatus()),
          },
          attention: true,
        })
        continue
      }
      putProblem({
        key: keyOf(name),
        title: t("codepuppy.problems.connectorFailed", { name: title }),
        action: { label: t("codepuppy.problems.view"), run: () => viewConnector(name) },
        attention: false,
      })
    }
    for (const name of listed) if (!next.has(name)) resolveProblem(keyOf(name))
    listed = next
  }

  async function follow(c: Client, signal: AbortSignal, gen: number) {
    try {
      const { stream } = await c.global.event({ signal } as never)
      for await (const event of stream as AsyncIterable<{ payload?: { type?: string } }>) {
        if (gen !== generation) break
        const type = event?.payload?.type ?? ""
        if (type.startsWith("mcp") || type === "server.instance.disposed") void readStatus()
      }
    } catch {
      /* aborted on cleanup / transient; SDK auto-reconnects */
    }
  }

  onCleanup(
    subscribeRuntimeRecovery((state) => {
      if (state.status === "ready") void readStatus()
    }),
  )
  onCleanup(() => {
    disposed = true
    generation++
  })

  createEffect(() => {
    const info = props.server()
    if (!info) return
    const gen = ++generation
    const abort = new AbortController()
    onCleanup(() => {
      abort.abort()
      if (gen === generation) client = undefined
    })
    void startupQuietEnded().then(() => {
      if (disposed || gen !== generation) return
      client = createOpencodeClient({ baseUrl: info.baseUrl, ...(info.fetch ? { fetch: info.fetch } : {}) })
      void readStatus()
      void follow(client, abort.signal, gen)
    })
  })

  return null
}
