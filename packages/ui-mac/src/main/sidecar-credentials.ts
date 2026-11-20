// DESIGN-stored-credentials-fence §4.2:主进程 ↔ sidecar 的凭据消息(既有窄通道)与两侧的小件。
//   main → sidecar:`credentials`(无 id = 续期推送 T2;有 id = 回复拉取,带表或带错误)
//   sidecar → main:`credentials.request`(拉取 P)、`credentials.unavailable`(这个 id 的拉取 10 秒没等到回复)
// sidecar.ts 顶层取 parentPort、测试 import 不了,所以合同与请求方、应答方住在这里;两侧与真引擎测试的「main」辅助方跑的是同一份代码。
// 不碰文件系统、不带 electron;任何一行日志都不含值。
import { parseCodePuppyCredentials, type CodePuppyCredentials } from "@opencode/util/codepuppy-credentials"

/** 拉取等待上限(设计 §4.1:代码常量,不是配置)。 */
export const CREDENTIALS_PULL_TIMEOUT_MS = 10_000

export type CredentialsMessage =
  | { type: "credentials"; credentials: CodePuppyCredentials }
  | { type: "credentials"; id: number; credentials: CodePuppyCredentials }
  | { type: "credentials"; id: number; error: string }
export type CredentialsRequest = { type: "credentials.request"; id: number }
export type CredentialsUnavailable = { type: "credentials.unavailable"; id: number }

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const validId = (id: unknown): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0

/** main → sidecar 的 `credentials`;形状不对 ⇒ undefined(调用方记一行、丢弃)。表经 parseCodePuppyCredentials 校验。 */
export function parseCredentialsMessage(value: unknown): CredentialsMessage | undefined {
  if (!record(value) || value.type !== "credentials") return
  const keys = Object.keys(value).sort().join(",")
  try {
    if (keys === "credentials,type") return { type: "credentials", credentials: parseCodePuppyCredentials(value.credentials) }
    if (keys === "credentials,id,type" && validId(value.id)) return { type: "credentials", id: value.id, credentials: parseCodePuppyCredentials(value.credentials) }
  } catch {
    return
  }
  if (keys === "error,id,type" && validId(value.id) && typeof value.error === "string") return { type: "credentials", id: value.id, error: value.error }
  return
}

/** sidecar → main 的两条;别的一律 undefined(交还接收链)。 */
export function parseCredentialsSidecarMessage(value: unknown): CredentialsRequest | CredentialsUnavailable | undefined {
  if (!record(value) || !validId(value.id) || Object.keys(value).length !== 2) return
  if (value.type === "credentials.request") return { type: "credentials.request", id: value.id }
  if (value.type === "credentials.unavailable") return { type: "credentials.unavailable", id: value.id }
  return
}

/**
 * sidecar 侧请求方:每次 pull 各发一个 `credentials.request`,只认自己那个 id 的回复。主进程回错误 ⇒ 以错误结束;10 秒没有回复 ⇒ 以错误结束并发
 * `credentials.unavailable`;close()(这一代在结束)⇒ 在途的都以错误结束。迟到的回复不发布、只记一行:它的拉取已结束,或者比它新的请求的回复已经
 * 先到(主进程按收到的顺序同步建表,先到的那份更新;发布旧的会让表倒退)—— 后一种让这次拉取以错误结束,这次装载不代入。
 */
export function createCredentialRequester(post: (message: CredentialsRequest | CredentialsUnavailable) => void, log: (line: string) => void = console.warn) {
  let next = 0
  let newest = 0
  let closed: string | undefined
  const pending = new Map<number, { resolve: (table: CodePuppyCredentials) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  const settle = (id: number) => {
    const entry = pending.get(id)
    if (entry) {
      clearTimeout(entry.timer)
      pending.delete(id)
    }
    return entry
  }
  return {
    pull(): Promise<CodePuppyCredentials> {
      if (closed !== undefined) return Promise.reject(new Error(`Code Puppy credentials: channel closed (${closed})`))
      const id = ++next
      return new Promise<CodePuppyCredentials>((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!settle(id)) return
          log(`Code Puppy credentials: pull ${id} had no reply within ${CREDENTIALS_PULL_TIMEOUT_MS} ms — this load uses no credential table`)
          reject(new Error("Code Puppy credentials: no reply from the main process"))
          try {
            post({ type: "credentials.unavailable", id })
          } catch {
            // the channel is gone; this generation is ending anyway
          }
        }, CREDENTIALS_PULL_TIMEOUT_MS)
        pending.set(id, { resolve, reject, timer })
        try {
          post({ type: "credentials.request", id })
        } catch {
          settle(id)
          reject(new Error("Code Puppy credentials: the request could not be sent"))
        }
      })
    },
    /** 回复拉取的那一种(带 id);推送由调用方直接发布。 */
    receive(message: Extract<CredentialsMessage, { id: number }>): void {
      const entry = settle(message.id)
      if (!entry) {
        log(`Code Puppy credentials: reply ${message.id} arrived after its pull ended — not published`)
        return
      }
      if ("error" in message) entry.reject(new Error("Code Puppy credentials: the main process could not read the credential table"))
      else if (message.id < newest) {
        log(`Code Puppy credentials: reply ${message.id} arrived after the reply to a newer pull — not published`)
        entry.reject(new Error("Code Puppy credentials: superseded by a newer reply"))
      } else {
        newest = message.id
        entry.resolve(message.credentials)
      }
    },
    close(reason: string): void {
      closed = reason
      for (const id of [...pending.keys()]) settle(id)?.reject(new Error(`Code Puppy credentials: channel closed (${reason})`))
    },
  }
}

/**
 * main 侧应答(server.ts 在 `child.on("message")` 上与写探针并列调用):`credentials.request` ⇒ 同步建表并回复(收到与回复之间没有 await),
 * 建表失败 ⇒ 回 `error` 并请求 `credential-change` 重启;`credentials.unavailable` ⇒ 请求同一个重启。不是这两条 ⇒ false(交还接收链)。
 */
export function answerCredentialsMessage(
  message: unknown,
  deps: { table: () => CodePuppyCredentials; post: (message: CredentialsMessage) => void; respawn: () => void; log: (line: string) => void },
): boolean {
  const parsed = parseCredentialsSidecarMessage(message)
  if (!parsed) return false
  if (parsed.type === "credentials.unavailable") {
    deps.log(`Code Puppy credentials: the engine's pull ${parsed.id} timed out — restarting the engine (credential-change)`)
    deps.respawn()
    return true
  }
  let table: CodePuppyCredentials
  try {
    table = deps.table()
  } catch (error) {
    deps.log(`Code Puppy credentials: the credential table could not be read for pull ${parsed.id} — restarting the engine (credential-change): ${error instanceof Error ? error.message : String(error)}`)
    deps.post({ type: "credentials", id: parsed.id, error: "credential table unavailable" })
    deps.respawn()
    return true
  }
  deps.post({ type: "credentials", id: parsed.id, credentials: table })
  return true
}
