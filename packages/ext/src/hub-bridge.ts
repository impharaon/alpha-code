import { parseVideoBridgeReply, type VideoBridgeRequest, type VideoBridgeReply } from "../../ui-mac/src/shared/video-understanding"
import type { PackageAuthorizationResultV1 } from "../../ui-mac/src/shared/package-admission"
import type { PluginSourceIdV1, SourceSearchResultV1 } from "../../ui-mac/src/main/plugin-sources"
import { PLUGIN_SOURCE_SEARCH_REPLY_TIMEOUT_MS } from "../../ui-mac/src/shared/plugin-source-timing"
// hub-bridge — REQ-234 `#1531`(基线 docs/design/2026-10-14-req234-hub-agent-install-baseline.md §2.2 / §2.6)。
//
// ext 这一侧的 parentPort 请求簿记:agent 的三个定制中心工具经它向 main 问「这个目录的三档视图」与「某次安装请求走到哪一步」,
// main 经它把重载请求交给 ext 调度器、ext 经它把重载结局报回去。合同只有一份 —— ui-mac 的 codepuppy-sidecar-messages.ts
// (相对路径 import,与 context-injection.ts 引 ui-mac 内容模块同一先例;该文件不依赖 electron / node:fs)。
//
// 形制同 main 侧的 workspace-write-probe:请求带自增 id、应答按 id 结算、超时答「无法判断」。三条纪律:
//   · 监听在**模块装载时**就挂上(createHubBridge 的同步部分)—— main 只在 sidecar ready 那一刻重发排队的重载代际,
//     监听晚挂一步,那一批就丢了;
//   · 只认 `codepuppy.*`,其余原样不理(sidecar.ts 的 start / stop / write-probe 照旧由它自己处理,两边互不改对方的分支);
//   · 应答形状不对 = 丢弃 + 记一行,请求按超时结算 —— 不带着半个视图去回答 agent。
// 取不到 parentPort(CLI / 测试宿主)⇒ `available: false`,三个工具如实说「本宿主不可用」,不猜。

import { createUnattendedState } from "./policy/unattended"
import type { ToolPolicyWriter } from "./policy/resolver"
import {
  buildToolPolicyWriteRequest,
  parseToolPolicyWriteReply,
  buildPackageAuthorizationQuery,
  parsePackageAuthorizationReply,
  buildUnattendedAck,
  buildSourcesSearchRequest,
  buildHubInstallRequest,
  parseSourcesSearchReply,
  parseHubInstallReply,
  type HubInstallRequest,
  parseUnattendedLive,
  buildHubRequestQuery,
  buildHubViewRequest,
  buildReloadReport,
  isCodePuppySidecarMessage,
  parseHubRequestReply,
  parseHubViewReply,
  parseReloadRequest,
  type HubRequestRecord,
  type HubView,
  type ReloadOutcome,
  type ReloadRequestMessage,
  type ReloadScope,
} from "../../ui-mac/src/main/codepuppy-sidecar-messages"

/** Electron utilityProcess 的 `process.parentPort` 里本模块用到的那两样。 */
export type HubPort = {
  postMessage(message: unknown): void
  on(event: "message", listener: (event: { data: unknown }) => void): void
}

export type BridgeFailure = { ok: false; reason: "unavailable" | "timeout" | "error"; detail: string }

/** BR-10:审批卡上「要装什么」—— main 在搜索结果里给出的名称与真实来源(自制插件为 `created`)。 */
export type HubInstallSubject = { readonly name: string; readonly source: PluginSourceIdV1 | "created" }

type VideoAction = VideoBridgeRequest extends infer Request ? Request extends VideoBridgeRequest ? Omit<Request,"type"|"id"> : never : never

export type HubBridge = {
  video(input: VideoAction): Promise<VideoBridgeReply | BridgeFailure>
  readonly unattended: ReturnType<typeof createUnattendedState>
  readonly available: boolean
  view(input: { directory: string; sessionID?: string; agent?: string; query?: string }): Promise<{ ok: true; view: HubView } | BridgeFailure>
  search(input: { directory: string; query: string }): Promise<{ ok: true; result: SourceSearchResultV1 } | BridgeFailure>
  install(input: Omit<HubInstallRequest, "type" | "id">): Promise<{ ok: true; accepted: true } | BridgeFailure>
  request(requestId: string): Promise<{ ok: true; record: HubRequestRecord | null } | BridgeFailure>
  packageAuthorization(packageId: string): Promise<PackageAuthorizationResultV1 | BridgeFailure>
  /** 本进程里 main 搜索答过的候选(目录条目与 main 铸的编号)的名称与来源;没答过 ⇒ undefined。 */
  installSubject(id: string): HubInstallSubject | undefined
  report(input: { generation: number; scope: ReloadScope; outcome: ReloadOutcome; directories: string[]; error?: string }): void
  /** main → ext 的重载请求交给谁。只能挂一个(调度器);挂上之前到达的请求按序缓存,挂上时补交。 */
  onReloadRequest(handler: (message: ReloadRequestMessage) => void): void
  /**
   * SPEC-engine-config-fence BR-03(DESIGN-engine-config-fence §4.5):工具策略文档的写者 —— main 写、写完再回复,走本桥同一个监听、同一个 id 空间
   * 与超时。只在有 parentPort 时有;main 回 error、超时、应答形状不对或发不出去 ⇒ 记一行并抛(存储包成 ToolPolicyWriteError("io"))。
   */
  readonly toolPolicy?: ToolPolicyWriter
}

const DEFAULT_TIMEOUT_MS = 20_000
/** 记住的候选条数上界(内存健壮性,不是用户限制):超出时忘掉最早的;忘掉的编号再装时请模型重新搜索。 */
const REMEMBERED_SUBJECTS = 2048

export function createHubBridge(
  port: HubPort | undefined,
  options: { timeoutMs?: number; log?: (line: string) => void } = {},
): HubBridge {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const log = options.log ?? ((line: string) => console.error(line))
  const pending = new Map<number, { settle: (message: unknown) => void; timer: ReturnType<typeof setTimeout> }>()
  const early: ReloadRequestMessage[] = []
  let reloadHandler: ((message: ReloadRequestMessage) => void) | undefined
  let seq = 0
  const unattended = createUnattendedState()
  const subjects = new Map<string, HubInstallSubject>()
  const remember = (result: SourceSearchResultV1) => {
    for (const candidate of result.candidates) {
      subjects.delete(candidate.id)
      subjects.set(candidate.id, { name: candidate.displayName, source: candidate.source })
    }
    for (const id of subjects.keys()) {
      if (subjects.size <= REMEMBERED_SUBJECTS) break
      subjects.delete(id)
    }
  }

  port?.on("message", (event) => {
    const message = event?.data
    if (!isCodePuppySidecarMessage(message)) return
    const type = (message as { type: string }).type
    if (type === "codepuppy.unattended.live") {
      const parsed = parseUnattendedLive(message)
      if (!parsed) return log(`[@codepuppy/ext] dropped a malformed unattended snapshot`)
      if (unattended.install(parsed)) port?.postMessage(buildUnattendedAck(parsed.seq, parsed.nonce))
      return
    }
    if (type === "codepuppy.reload.request") {
      const parsed = parseReloadRequest(message)
      if (!parsed) return log(`[@codepuppy/ext] hub bridge: dropped a malformed reload request`)
      if (reloadHandler) return reloadHandler(parsed)
      early.push(parsed)
      return
    }
    const id = (message as { id?: unknown }).id
    const entry = typeof id === "number" ? pending.get(id) : undefined
    if (!entry) return log(`[@codepuppy/ext] hub bridge: ${type.slice(0, 80)} for no pending request ignored`)
    pending.delete(id as number)
    clearTimeout(entry.timer)
    entry.settle(message)
  })

  const ask = <T>(build: (id: number) => unknown, parse: (message: unknown) => T | undefined, budget = timeoutMs): Promise<T | BridgeFailure> => {
    if (!port) return Promise.resolve({ ok: false, reason: "unavailable", detail: "no parent port in this engine host" })
    const id = ++seq
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve({ ok: false, reason: "timeout", detail: "the app did not answer in time" })
      }, budget)
      pending.set(id, {
        timer,
        settle: (message) => {
          const parsed = parse(message)
          if (parsed === undefined) {
            log(`[@codepuppy/ext] hub bridge: dropped a malformed reply to request ${id}`)
            return resolve({ ok: false, reason: "error", detail: "the app sent a malformed answer" })
          }
          resolve(parsed)
        },
      })
      try {
        port.postMessage(build(id))
      } catch (error) {
        pending.delete(id)
        clearTimeout(timer)
        log(`[@codepuppy/ext] hub bridge: request ${id} could not be posted: ${error instanceof Error ? error.message : String(error)}`)
        resolve({ ok: false, reason: "unavailable", detail: "the app could not be reached" })
      }
    })
  }

  const writeToolPolicy = async (build: (id: number) => unknown): Promise<{ backup?: string }> => {
    const result = await ask(build, (message) => {
      const reply = parseToolPolicyWriteReply(message)
      if (!reply) return
      return "error" in reply
        ? { ok: false as const, reason: "error" as const, detail: reply.error }
        : { ok: true as const, ...(reply.backup !== undefined ? { backup: reply.backup } : {}) }
    })
    if (!result.ok) {
      log(`[@codepuppy/ext] tool policy write: ${result.reason} — ${result.detail}`)
      throw new Error(`the app could not write the tool policy document: ${result.detail}`)
    }
    return result.backup !== undefined ? { backup: result.backup } : {}
  }

  return {
    video: (input) => ask((id)=>({type:"codepuppy.video.understand",id,...input}),parseVideoBridgeReply),
    unattended,
    available: !!port,
    ...(port
      ? {
          toolPolicy: {
            save: async (partition, records) => void (await writeToolPolicy((id) => buildToolPolicyWriteRequest({ id, op: "save", partition, records }))),
            reset: (partition) => writeToolPolicy((id) => buildToolPolicyWriteRequest({ id, op: "reset", partition })),
          } satisfies ToolPolicyWriter,
        }
      : {}),
    view: (input) =>
      ask(
        (id) => buildHubViewRequest({ id, ...input }),
        (message) => {
          const reply = parseHubViewReply(message)
          if (!reply) return
          return "view" in reply
            ? { ok: true as const, view: reply.view }
            : { ok: false as const, reason: "error" as const, detail: "the app could not compute the view" }
        },
      ),
    search: (input) => ask((id) => buildSourcesSearchRequest({ id, ...input }), (message) => { const reply = parseSourcesSearchReply(message); if (!reply) return; if (!("result" in reply)) return { ok: false as const, reason: "error" as const, detail: reply.error }; remember(reply.result); return { ok: true as const, result: reply.result } }, options.timeoutMs ?? PLUGIN_SOURCE_SEARCH_REPLY_TIMEOUT_MS),
    install: (input) => ask((id) => buildHubInstallRequest({ id, ...input }), (message) => { const reply = parseHubInstallReply(message); if (!reply) return; return "accepted" in reply ? { ok: true as const, accepted: true as const } : { ok: false as const, reason: "error" as const, detail: reply.error } }),
    request: (requestId) =>
      ask(
        (id) => buildHubRequestQuery(id, requestId),
        (message) => {
          const reply = parseHubRequestReply(message)
          if (!reply) return
          return "record" in reply
            ? { ok: true as const, record: reply.record }
            : { ok: false as const, reason: "error" as const, detail: "the app could not read the request" }
        },
      ),
    packageAuthorization: (packageId) => ask((id) => buildPackageAuthorizationQuery(id, packageId), (message) => parsePackageAuthorizationReply(message)?.result),
    installSubject: (id) => subjects.get(id),
    report(input) {
      if (!port) return
      try {
        port.postMessage(buildReloadReport(input))
      } catch (error) {
        log(`[@codepuppy/ext] hub bridge: reload report for generation ${input.generation} could not be posted: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    onReloadRequest(handler) {
      reloadHandler = handler
      for (const message of early.splice(0)) handler(message)
    },
  }
}

/** 本引擎进程的 parentPort(Electron utilityProcess);CLI / 测试宿主里没有。 */
export function processParentPort(): HubPort | undefined {
  const port = (process as unknown as { parentPort?: HubPort }).parentPort
  return port && typeof port.postMessage === "function" && typeof port.on === "function" ? port : undefined
}
