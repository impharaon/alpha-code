import type { Plugin } from "@opencode/plugin"
import type { PinnedFiles } from "../../util/src/codepuppy-pinned-files"
import { documentHost, type DocumentCaller, type DocumentHost } from "../../util/src/codepuppy-document"
import { createDocumentInspection, subscribeDocumentChecks } from "./document-check"
import { createDocumentRenderer } from "./document-render"
import { createDocumentTool } from "./document-tool"
import { createDocumentRuntimeVerifier } from "./document-runtime-verify"

const locations = new Map<
  string,
  {
    render: ReturnType<typeof createDocumentRenderer>
    inspection: ReturnType<typeof createDocumentInspection>
    active: Set<string>
  }
>()
const key = (location: DocumentCaller["location"]) => JSON.stringify([location.directory, location.workspaceID ?? null])

/** Tool discovery does not wait for LO or evaluate a missing launcher provider. */
export function documentToolForLocation(location: DocumentCaller["location"]) {
  return createDocumentTool({
    location,
    host: () => {
      const host = documentHost()
      const active = locations.get(key(location))?.active
      return {
        ...host,
        environment: async (caller) => {
          const result = await host.environment(caller)
          active?.add(caller.sessionID)
          return result
        },
        recordCheck: async (value) => {
          await host.recordCheck(value)
          if (value.report.final) active?.delete(value.caller.sessionID)
        },
      }
    },
    check: (caller, report, host) => {
      const registered = locations.get(key(location))
      if (!registered) throw Error("document Location resources were not registered before execution")
      return registered.inspection.check(caller, report, host)
    },
    render: async (...args) => {
      const registered = locations.get(key(location))
      if (!registered) throw Error("document Location resources were not registered before execution")
      const result = await registered.render(...args)
      if (result.status === "pending") registered.active.delete(args[0].sessionID)
      return result
    },
  })
}

/** Called by the document bootstrap consumer with the launcher/main's verified projection, not model data. */
export async function registerDocumentTools(
  context: Plugin.Context,
  input: {
    host: DocumentHost
    chromium: Parameters<typeof createDocumentRenderer>[0]["chromium"]
    sidecarGeneration: number
    manifest: PinnedFiles
    resources: {
      python: string
      assets: string
      templates: string
      documentRuntimeRoot: string
      verify: string
      render: string
      recalculate: string
    }
  },
) {
  const active = new Set<string>()
  const render = createDocumentRenderer({
    host: {
      ...input.host,
      environment: async (caller) => {
        const result = await input.host.environment(caller)
        active.add(caller.sessionID)
        return result
      },
    },
    chromium: input.chromium,
    assets: input.resources.assets,
    documentRuntimeRoot: input.resources.documentRuntimeRoot,
    renderScript: input.resources.render,
    recalculateScript: input.resources.recalculate,
  })
  const registration = { render, inspection: createDocumentInspection(), active }
  const stopReady = subscribeDocumentChecks(context, input.host)
  const cleanup = input.host.subscribeRuntimeVerify(
    context.location,
    createDocumentRuntimeVerifier({
      location: context.location,
      sidecarGeneration: input.sidecarGeneration,
      manifest: input.manifest,
      python: input.resources.python,
      templates: input.resources.templates,
      script: input.resources.verify,
      documentRuntimeRoot: input.resources.documentRuntimeRoot,
    }),
  )
  locations.set(key(context.location), registration)
  return async () => {
    if (locations.get(key(context.location)) === registration) locations.delete(key(context.location))
    stopReady()
    await cleanup()
  }
}

export function recordDocumentPageView(
  location: DocumentCaller["location"],
  sessionID: string,
  view: Parameters<ReturnType<typeof createDocumentInspection>["observe"]>[1],
) {
  locations.get(key(location))?.inspection.observe(sessionID, view)
}

export function documentSessionActive(location: DocumentCaller["location"], sessionID: string) {
  return locations.get(key(location))?.active.has(sessionID) === true
}
