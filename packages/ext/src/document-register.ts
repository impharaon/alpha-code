import type { Plugin } from "@opencode/plugin"
import type { PinnedFiles } from "../../util/src/codepuppy-pinned-files"
import { documentHost, type DocumentCaller, type DocumentHost } from "../../util/src/codepuppy-document"
import { createDocumentRenderer } from "./document-render"
import { createDocumentTool } from "./document-tool"
import { createDocumentRuntimeVerifier } from "./document-runtime-verify"

const locations = new Map<string, { render: ReturnType<typeof createDocumentRenderer> }>()
const key = (location: DocumentCaller["location"]) => JSON.stringify([location.directory, location.workspaceID ?? null])

/** Tool discovery does not wait for LO or evaluate a missing launcher provider. */
export function documentToolForLocation(location: DocumentCaller["location"]) {
  return createDocumentTool({
    location,
    host: documentHost,
    render: (...args) => {
      const registered = locations.get(key(location))
      if (!registered) throw Error("document Location resources were not registered before execution")
      return registered.render(...args)
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
    }
  },
) {
  const render = createDocumentRenderer({
    host: input.host,
    chromium: input.chromium,
    assets: input.resources.assets,
    documentRuntimeRoot: input.resources.documentRuntimeRoot,
    renderScript: input.resources.render,
  })
  const registration = { render }
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
    await cleanup()
  }
}
