import { mkdir, realpath, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  DOCUMENT_WORK_DIR,
  type DocumentHost,
  type DocumentCaller,
  type DocumentEnvironment,
} from "../../../util/src/codepuppy-document"
import type { createDocumentRuntime } from "./document-runtime"
import { createDocumentChecks } from "./document-checks"
import { readDocumentCheck } from "../shared/document-check-records"
import { resolveDocumentArtifact } from "../shared/workspace-file"
import type { documentChromium } from "./document-chromium"

/** Composition consumes launcher-resolved resources. It never guesses a Node entry or acquires a second copy. */
export function createDocumentHost(input: {
  authorize: (caller: DocumentCaller) => Promise<void> | void
  resources: () => Promise<Omit<DocumentEnvironment, "renderState" | "workRoot" | "pythonEnvironment">>
  chromium: typeof documentChromium
  runtime: ReturnType<typeof createDocumentRuntime>
  documentRuntimeRoot: string
}) {
  const stored = createDocumentChecks({ root: input.documentRuntimeRoot, runtime: input.runtime })
  const running = new Map<Parameters<DocumentHost["chromiumRender"]>[0], AbortController>()
  const callers = new Set<string>()
  const checks = new Map<string, { caller: string; path: string; outputPath?: string; kind: string }>()
  const key = (caller: DocumentCaller) =>
    JSON.stringify([caller.location.directory, caller.location.workspaceID ?? null, caller.sessionID])
  const host: DocumentHost = {
    async pythonEnvironment(location) {
      return input.runtime.pythonEnvironment(location)
    },
    async environment(caller) {
      await input.authorize(caller)
      const directory = await realpath(caller.location.directory)
      const workRoot = join(directory, DOCUMENT_WORK_DIR)
      await mkdir(workRoot, { recursive: true })
      if ((await realpath(workRoot)) !== workRoot) throw Error("document work root is not owned by this workspace")
      await writeFile(join(workRoot, ".gitignore"), "*\n")
      callers.add(key(caller))
      const renderState = input.runtime.query(caller.location)
      return {
        ...(await input.resources()),
        workRoot,
        renderState,
        pythonEnvironment: await host.pythonEnvironment(caller.location),
      }
    },
    async chromiumRender(request) {
      await input.authorize(request.caller)
      if (!callers.has(key(request.caller))) throw Error("document caller did not establish its workspace")
      const archived = await readDocumentCheck(request.caller, request.checkId)
      if (archived.request.path !== request.request.path || archived.request.kind !== request.request.kind)
        throw Error("document archive identity mismatch")
      const existing = checks.get(request.checkId)
      if (
        existing &&
        (existing.caller !== key(request.caller) ||
          existing.path !== request.request.path ||
          existing.outputPath !== request.request.outputPath ||
          existing.kind !== request.request.kind)
      )
        throw Error("document check identity mismatch")
      checks.set(request.checkId, {
        caller: key(request.caller),
        path: request.request.path,
        outputPath: request.request.outputPath,
        kind: request.request.kind,
      })
      const controller = new AbortController()
      running.set(request, controller)
      try {
        return await input.chromium(request, controller.signal)
      } finally {
        running.delete(request)
      }
    },
    async defer(check) {
      await input.authorize({ location: check.location, sessionID: check.sessionID })
      const actual = await resolveDocumentArtifact(check.location.directory, check.artifact)
      if (
        !actual ||
        actual.sourceSha256 !== check.sourceSha256 ||
        actual.artifactSha256 !== check.artifact.artifactSha256
      )
        throw Error("deferred document artifact identity changed")
      await stored.defer(check)
    },
    async recordCheck(check) {
      await input.authorize(check.caller)
      await stored.recordCheck(check)
    },
    subscribeReady: stored.subscribeReady,
    subscribeRuntimeVerify: input.runtime.subscribeRuntimeVerify,
  }
  return {
    host,
    dispose: stored.dispose,
    cancelChromium: (request: Parameters<DocumentHost["chromiumRender"]>[0]) => running.get(request)?.abort(),
  }
}
