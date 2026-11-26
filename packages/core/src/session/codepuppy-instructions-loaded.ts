import { packageRuntime, type PackageRuntimeHandlers } from "@opencode/plugin/codepuppy-package-runtime"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import type { Database } from "../database/database.js"
import type { InstructionDiscovery } from "../instruction-discovery.js"
import type { SessionSchema } from "./schema.js"
import { SessionTable } from "./sql.js"

export const notifyInstructionsLoaded = Effect.fn("CodePuppy.instructionsLoaded")(function* (
  db: Database.Interface["db"],
  sessionID: SessionSchema.ID,
  files: readonly InstructionDiscovery.File[],
  occurrenceId: string,
  loadReason: Parameters<PackageRuntimeHandlers["instructionsLoaded"]>[0]["loadReason"],
) {
  const sources = files.filter(file => file.source)
  if (!sources.length) return
  const session = yield* db
    .select({ directory: SessionTable.directory, workspaceID: SessionTable.workspace_id, parentID: SessionTable.parent_id })
    .from(SessionTable)
    .where(eq(SessionTable.id, sessionID))
    .get()
    .pipe(Effect.orDie)
  if (!session) return
  const runtime = packageRuntime({ directory: session.directory, ...(session.workspaceID ? { workspaceID: session.workspaceID } : {}) })
  if (!runtime) return
  for (const file of sources) {
    const source = file.source!
    yield* Effect.tryPromise(() =>
      runtime.instructionsLoaded({
        sessionID,
        occurrenceId: occurrenceId + ":" + file.path,
        filePath: file.path,
        memoryType: source.scope,
        loadReason,
        ...(session.parentID ? { parentSessionId: session.parentID, agentId: sessionID } : {}),
      }),
    ).pipe(
      Effect.catchCause(cause => Effect.logWarning("package InstructionsLoaded hook failed", { sessionID, file: file.path, cause })),
      // Informational delivery outlives admission; the package runner owns process cancellation.
      Effect.forkDetach({ startImmediately: true }),
    )
  }
})
