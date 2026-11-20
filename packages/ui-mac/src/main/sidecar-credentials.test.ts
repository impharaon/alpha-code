// DESIGN-stored-credentials-fence §4.2:主进程 ↔ sidecar 凭据消息的合同、sidecar 侧请求方与 main 侧应答。值都是一眼可辨的假值。
import { describe, expect, test, vi } from "bun:test"
import {
  CREDENTIALS_PULL_TIMEOUT_MS,
  answerCredentialsMessage,
  createCredentialRequester,
  parseCredentialsMessage,
  parseCredentialsSidecarMessage,
  type CredentialsMessage,
} from "./sidecar-credentials"

const TABLE = { "/u/codepuppy-secrets/CODEPUPPY_API_KEY": { value: "FAKE-A", use: { kind: "inline" as const } } }

describe("合同", () => {
  test("main → sidecar:推送、回复表、回复错误三种形状;其余(坏表、多键、坏 id)⇒ undefined", () => {
    expect(parseCredentialsMessage({ type: "credentials", credentials: TABLE })).toEqual({ type: "credentials", credentials: TABLE })
    expect(parseCredentialsMessage({ type: "credentials", id: 2, credentials: {} })).toEqual({ type: "credentials", id: 2, credentials: {} })
    expect(parseCredentialsMessage({ type: "credentials", id: 2, error: "x" })).toEqual({ type: "credentials", id: 2, error: "x" })
    for (const bad of [
      { type: "credentials" },
      { type: "credentials", credentials: { "relative": { value: "FAKE-A", use: { kind: "inline" } } } },
      { type: "credentials", id: 0, credentials: {} },
      { type: "credentials", id: 1.5, credentials: {} },
      { type: "credentials", id: 2, credentials: {}, error: "x" },
      { type: "credentials", credentials: {}, extra: 1 },
      { type: "other", credentials: {} },
    ])
      expect(parseCredentialsMessage(bad)).toBeUndefined()
  })

  test("sidecar → main:request / unavailable;别的交还接收链", () => {
    expect(parseCredentialsSidecarMessage({ type: "credentials.request", id: 1 })).toEqual({ type: "credentials.request", id: 1 })
    expect(parseCredentialsSidecarMessage({ type: "credentials.unavailable", id: 1 })).toEqual({ type: "credentials.unavailable", id: 1 })
    for (const other of [{ type: "write-probe-result", id: 1 }, { type: "credentials.request", id: "1" }, { type: "credentials.request", id: 1, x: 1 }, null])
      expect(parseCredentialsSidecarMessage(other)).toBeUndefined()
  })
})

describe("sidecar 侧请求方", () => {
  test("每次 pull 各发一个请求、只认自己那个 id(不合并、不复用在途回复);已结束的 id 再来的回复不发布", async () => {
    const posted: Array<{ type: string; id: number }> = []
    const logged: string[] = []
    const requester = createCredentialRequester((message) => void posted.push(message), (line) => void logged.push(line))
    const first = requester.pull()
    const second = requester.pull()
    expect(posted).toEqual([{ type: "credentials.request", id: 1 }, { type: "credentials.request", id: 2 }])
    const newer = { "/u/codepuppy-secrets/X": { value: "FAKE-new", use: { kind: "inline" as const } } }
    requester.receive({ type: "credentials", id: 1, credentials: TABLE })
    requester.receive({ type: "credentials", id: 2, credentials: newer })
    expect(await first).toEqual(TABLE)
    expect(await second).toEqual(newer)
    requester.receive({ type: "credentials", id: 1, credentials: newer })
    expect(logged).toEqual(["Code Puppy credentials: reply 1 arrived after its pull ended — not published"])
  })

  test("比它新的请求的回复已经先到 ⇒ 旧回复不发布,那次拉取以错误结束(表不倒退)", async () => {
    const logged: string[] = []
    const requester = createCredentialRequester(() => {}, (line) => void logged.push(line))
    const first = requester.pull()
    const second = requester.pull()
    const newer = { "/u/codepuppy-secrets/X": { value: "FAKE-new", use: { kind: "inline" as const } } }
    requester.receive({ type: "credentials", id: 2, credentials: newer })
    requester.receive({ type: "credentials", id: 1, credentials: TABLE })
    expect(await second).toEqual(newer)
    await expect(first).rejects.toThrow("superseded by a newer reply")
    expect(logged).toEqual(["Code Puppy credentials: reply 1 arrived after the reply to a newer pull — not published"])
  })

  test("主进程回错误 ⇒ 以错误结束,不带值", async () => {
    const requester = createCredentialRequester(() => {}, () => {})
    const pulling = requester.pull()
    requester.receive({ type: "credentials", id: 1, error: "credential table unavailable" })
    await expect(pulling).rejects.toThrow("Code Puppy credentials: the main process could not read the credential table")
  })

  test("close() ⇒ 在途的以错误结束,之后的 pull 立刻以错误结束;发送抛 ⇒ 以错误结束", async () => {
    const requester = createCredentialRequester(() => {}, () => {})
    const pulling = requester.pull()
    requester.close("sidecar stopping")
    await expect(pulling).rejects.toThrow("channel closed (sidecar stopping)")
    await expect(requester.pull()).rejects.toThrow("channel closed (sidecar stopping)")
    const broken = createCredentialRequester(() => {
      throw new Error("port gone")
    }, () => {})
    await expect(broken.pull()).rejects.toThrow("the request could not be sent")
  })

  test(`${CREDENTIALS_PULL_TIMEOUT_MS} ms 没有回复 ⇒ 以错误结束并发 credentials.unavailable;之后迟到的回复不发布`, async () => {
    const posted: Array<{ type: string; id: number }> = []
    const requester = createCredentialRequester((message) => void posted.push(message), () => {})
    const started = Date.now()
    await expect(requester.pull()).rejects.toThrow("no reply from the main process")
    expect(Date.now() - started).toBeGreaterThanOrEqual(CREDENTIALS_PULL_TIMEOUT_MS - 50)
    expect(posted).toEqual([{ type: "credentials.request", id: 1 }, { type: "credentials.unavailable", id: 1 }])
  }, CREDENTIALS_PULL_TIMEOUT_MS + 5_000)
})

// ② 审查第 8 条(核实):sidecar 主线程被阻塞超过 10 秒后,Node 的事件循环先跑到期的计时器、再处理已经排在端口上的消息(本机实测:node 先计时器、
// bun 先消息)。计时器先让一次路(setImmediate)再判超时,已到的回复就先被处理,不会误发 credentials.unavailable、误触发重启。
test("超时的计时器先跑、已排在端口上的回复紧随其后 ⇒ 回复照常收下,不发 credentials.unavailable", async () => {
  vi.useFakeTimers()
  try {
    const posted: Array<{ type: string; id: number }> = []
    let deliver: () => void = () => {}
    const requester = createCredentialRequester((message) => {
      posted.push(message)
      if (message.type === "credentials.request") deliver = () => requester.receive({ type: "credentials", id: message.id, credentials: TABLE })
    }, () => {})
    const pulling = requester.pull()
    vi.advanceTimersByTime(CREDENTIALS_PULL_TIMEOUT_MS) // Node's order after a long block: the due timer runs first …
    deliver() // … then the reply that was already queued on the port
    vi.runAllTimers()
    expect(await pulling).toEqual(TABLE)
    expect(posted).toEqual([{ type: "credentials.request", id: 1 }])
  } finally {
    vi.useRealTimers()
  }
})

describe("main 侧应答", () => {
  const deps = (table: () => typeof TABLE) => {
    const posted: CredentialsMessage[] = []
    const respawns: number[] = []
    const logged: string[] = []
    return { posted, respawns, logged, deps: { table, post: (message: CredentialsMessage) => void posted.push(message), respawn: () => void respawns.push(1), log: (line: string) => void logged.push(line) } }
  }
  test("request ⇒ 同步回复整表;unavailable ⇒ 请求重启;别的消息不处理", () => {
    const d = deps(() => TABLE)
    expect(answerCredentialsMessage({ type: "credentials.request", id: 4 }, d.deps)).toBe(true)
    expect(d.posted).toEqual([{ type: "credentials", id: 4, credentials: TABLE }])
    expect(answerCredentialsMessage({ type: "credentials.unavailable", id: 5 }, d.deps)).toBe(true)
    expect(d.respawns).toHaveLength(1)
    expect(answerCredentialsMessage({ type: "write-probe-result", id: 1 }, d.deps)).toBe(false)
  })
  test("建表抛 ⇒ 回 error(不含值、不含路径)并请求重启", () => {
    const d = deps(() => {
      throw new Error("ENOTDIR: /u/codepuppy-mcp-secrets")
    })
    expect(answerCredentialsMessage({ type: "credentials.request", id: 6 }, d.deps)).toBe(true)
    expect(d.posted).toEqual([{ type: "credentials", id: 6, error: "credential table unavailable" }])
    expect(d.respawns).toHaveLength(1)
  })
})
