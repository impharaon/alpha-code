import type { EngineClient } from "./engine-client"
import { getLogger } from "./logging"

const POLL_MS = 250

/** 本次运行内只有一个不重叠的检查循环;global 表单仍须带项目位置取消。 */
export function watchAutomationElicitations(client: EngineClient, directory: string) {
  const controller = new AbortController()
  const inFlight = new Set<string>()
  let connector: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let active = check()

  async function check() {
    try {
      const page = await client.form.list({ location: { directory } }, { signal: controller.signal })
      if (controller.signal.aborted) return
      await Promise.all(
        page.data
          .filter((form) => form.metadata?.kind === "mcp-elicitation")
          .map(async (form) => {
            if (inFlight.has(form.id)) return
            inFlight.add(form.id)
            try {
              await client.session.form.cancel(
                { sessionID: form.sessionID, formID: form.id },
                {
                  headers: { "x-opencode-directory": encodeURIComponent(directory) },
                  signal: controller.signal,
                },
              )
              if (typeof form.metadata?.server === "string") connector ??= form.metadata.server
            } catch (error) {
              if (controller.signal.aborted) return
              if (
                error &&
                typeof error === "object" &&
                "_tag" in error &&
                (error._tag === "FormNotFoundError" || error._tag === "FormAlreadySettledError")
              )
                return
              getLogger().warn("automation: form cancellation failed", { formID: form.id, error: String(error) })
            } finally {
              inFlight.delete(form.id)
            }
          }),
      )
    } catch (error) {
      if (!controller.signal.aborted) getLogger().warn("automation: form listing failed", { error: String(error) })
    } finally {
      if (!controller.signal.aborted) {
        timer = setTimeout(() => {
          active = check()
        }, POLL_MS)
        timer.unref()
      }
    }
  }

  return {
    get connector() {
      return connector
    },
    async stop() {
      controller.abort()
      if (timer) clearTimeout(timer)
      await active
    },
  }
}
