import { useConnectorLaunchSnapshots } from "../extensions/connector-launch-client"
import { connectorLaunchPresentation } from "../extensions/connector-launch-presentation"
import { runConnectorLaunchAction } from "../extensions/connector-launch-actions"
import { loadDefaultWorkspaceDir } from "./default-workspace"
import { activeSessionIdentity } from "./active-session-directory"
import { pushToast } from "./Toast"
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
import { createEffect, createResource, createSignal, onCleanup, type Accessor } from "solid-js"
// CLIENT subpath only — the v2 barrel pulls Node-only deps that break the renderer (see ADR-008).
import { createOpencodeClient } from "../../engine-adapter/contract/v1"
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
  const [status, setStatus] = createSignal<{ data: Record<string, unknown>; skipCloud: boolean }>({ data: {}, skipCloud: false })
  const [watching, setWatching] = createSignal(false)
  const [defaultDirectory] = createResource(watching, loadDefaultWorkspaceDir)
  const launch = useConnectorLaunchSnapshots(() => watching() ? activeSessionIdentity()?.directory ?? defaultDirectory() : undefined, props.server)
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
    setStatus({ data, skipCloud })
  }

  createEffect(() => {
    const current = status()
    const c = client
    if (!watching() || !c || disposed) return
    const next = new Set<string>()
    const snapshots = launch()
    const names = new Set([...Object.keys(current.data), ...snapshots.map((snapshot) => snapshot.identity.server)])
    for (const name of names) {
      const info = current.data[name]
      const snapshot = snapshots.find((value) => value.identity.server === name)
      if (snapshot) {
        const presentation = connectorLaunchPresentation(snapshot.state)
        if (!presentation.problem) continue
        const key = `connector\0${JSON.stringify([snapshot.identity.directory, snapshot.identity.server, snapshot.sidecarGeneration, snapshot.identity.attempt])}`
        next.add(key)
        putProblem({ key, title: `${displayName(name)} · ${presentation.reason}`, detail: presentation.detail, attention: false,
          ...(presentation.action ? { action: { label: presentation.action.label, run: () => { void runConnectorLaunchAction(snapshot, presentation.action!.kind, (server) => c.mcp.auth.authenticate({ name: server, directory: snapshot.identity.directory })).catch((error) => pushToast({ kind: "error", title: error instanceof Error ? error.message : String(error) })) } } } : {}),
        })
        continue
      }
      if (isConnected(info) || isDisabled(info) || isPending(info)) continue
      // 有意关闭的不是问题:被 kill-switch 扣下的云服务在定制中心补连后报 `failed`(2.x `connect` 不看
      // `disabled`),状态里没有区分字段,只能按 main 的判决跳过,不解释错误原文。
      if (current.skipCloud && name === CLOUD_SERVER) continue
      next.add(keyOf(name))
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
    for (const name of listed) if (!next.has(name)) resolveProblem(name)
    listed = next
  })

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
      if (gen === generation) {
        client = undefined
        setWatching(false)
        setStatus({ data: {}, skipCloud: false })
        for (const key of listed) resolveProblem(key)
        listed = new Set()
      }
    })
    void startupQuietEnded().then(() => {
      if (disposed || gen !== generation) return
      client = createOpencodeClient({ baseUrl: info.baseUrl, ...(info.fetch ? { fetch: info.fetch } : {}) })
      setWatching(true)
      void readStatus()
      void follow(client, abort.signal, gen)
    })
  })

  return null
}
