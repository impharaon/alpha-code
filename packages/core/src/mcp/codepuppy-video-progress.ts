import { VIDEO_PROGRESS_KEY, videoProgress, type VideoProgress } from "@opencode/schema/codepuppy-video-progress"

type Notification = { progress?: number; _meta?: Record<string, unknown> }

/** SDK request scope owns correlation. Never route by a server-supplied call ID. */
export async function withVideoProgress<T>(
  signal: AbortSignal,
  report: ((update: VideoProgress) => Promise<void>) | undefined,
  run: (onprogress: (notification: Notification) => void) => Promise<T>,
) {
  let active = true
  let pending = Promise.resolve()
  try {
    return await run((notification) => {
      const update = videoProgress(notification._meta?.[VIDEO_PROGRESS_KEY])
      if (!active || signal.aborted || !report || !update) return
      pending = pending.then(async () => {
        if (!signal.aborted) await report(update)
      })
    })
  } finally {
    active = false
    await pending
  }
}
