import { randomUUID } from "node:crypto"
import { buildUnattendedLive, type UnattendedAck, type UnattendedLive } from "./codepuppy-sidecar-messages"

/** main 唯一名单。生产只由 executeTask / llmParseAutomation 登记和注销。 */
export function createUnattendedRuns() {
  const live = new Map<string, { agent?: string; promptID: string }>()
  const pending = new Map<number, { nonce: string; finish: (ready: boolean) => void }>()
  let connection: { post: (message: UnattendedLive) => void } | undefined
  let seq = 0

  function publish(wait: boolean, signal?: AbortSignal): Promise<boolean> {
    const target = connection
    if (!target || signal?.aborted) return Promise.resolve(false)
    const message = buildUnattendedLive({
      seq: ++seq,
      nonce: randomUUID(),
      sessions: [...live].map(([sessionID, entry]) => ({ sessionID, ...entry })),
    })
    return new Promise((resolve) => {
      const finish = (ready: boolean) => {
        if (timer) clearTimeout(timer)
        signal?.removeEventListener("abort", abort)
        pending.delete(message.seq)
        resolve(ready)
      }
      const abort = () => finish(false)
      const timer = wait ? setTimeout(abort, 20_000) : undefined
      if (wait) {
        pending.set(message.seq, { nonce: message.nonce, finish })
        signal?.addEventListener("abort", abort, { once: true })
      }
      try {
        target.post(message)
        if (!wait) finish(true)
      } catch {
        finish(false)
      }
    })
  }

  return {
    register(sessionID: string, entry: { agent?: string; promptID: string }, signal?: AbortSignal) {
      live.set(sessionID, entry)
      return publish(true, signal)
    },
    unregister(sessionID: string) {
      if (live.delete(sessionID)) void publish(false)
    },
    acknowledge(message: UnattendedAck) {
      const entry = pending.get(message.seq)
      if (entry?.nonce === message.nonce) entry.finish(true)
    },
    attach(post: (message: UnattendedLive) => void) {
      for (const entry of pending.values()) entry.finish(false)
      const target = { post }
      connection = target
      void publish(false)
      return (_reason: string) => {
        if (connection !== target) return
        connection = undefined
        for (const entry of pending.values()) entry.finish(false)
      }
    },
  }
}

export const unattendedRuns = createUnattendedRuns()
