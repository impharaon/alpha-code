// north-star:codepuppy-owned — S-04 revisions are selected before native trust and parsing.
import { Effect } from "effect"
import { packageRuntime, type ConfigSource, type RuntimeLocation } from "@opencode/plugin/codepuppy-package-runtime"

export function createPluginConfigRevisionReader(location: RuntimeLocation) {
  const revisions = new Map<string, { observed: string | undefined; accepted: string | undefined; occurrenceId: string }>()
  let ready = false
  return {
    ready() { ready = true },
    select: Effect.fn("PluginConfig.selectRevision")(function* (filePath: string, source: ConfigSource, text: string | undefined) {
      const previous = revisions.get(filePath)
      if (previous && previous.observed === text && previous.accepted === text) return text
      const occurrenceId = previous && previous.observed === text ? previous.occurrenceId : crypto.randomUUID()
      const runtime = ready ? packageRuntime(location) : undefined
      const result = runtime ? yield* Effect.promise(() => runtime.beforeConfigChange({ occurrenceId, source, filePath })) : { apply: true }
      const accepted = result.apply || source === "policy_settings" ? text : previous?.accepted
      revisions.set(filePath, { observed: text, accepted, occurrenceId })
      return accepted
    }),
  }
}
