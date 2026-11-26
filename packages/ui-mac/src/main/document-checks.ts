import { mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  isDeferredDocumentCheck,
  isDocumentCheckReport,
  isExcelRecalculateResult,
  type DocumentPythonProjection,
  type DocumentHost,
  type DeferredDocumentCheck,
} from "../../../util/src/codepuppy-document"
import {
  documentLocationKey,
  documentReceipt,
  documentRecordId,
  readDocumentCheck,
  requireDocumentCoverage,
  writeDocumentRecord,
} from "../shared/document-check-records"
import type { createDocumentRuntime } from "./document-runtime"

/** This feature's durable handoff records; Session scheduling stays with session.synthetic. */
export function createDocumentChecks(input: {
  root: string
  runtime: Pick<ReturnType<typeof createDocumentRuntime>, "subscribe" | "pythonEnvironment" | "query">
}) {
  const root = join(input.root, "checks")
  mkdirSync(root, { recursive: true })
  if (realpathSync(root) !== root) throw Error("document check storage escaped its runtime")
  const records = new Map<string, DeferredDocumentCheck>()
  const listeners = new Map<string, Parameters<DocumentHost["subscribeReady"]>[1]>()
  const running = new Map<string, object>()
  let ready = false
  let stopped = false
  for (const file of readdirSync(root).filter((name) => name.endsWith(".json"))) {
    const path = join(root, file)
    if (realpathSync(path) !== path) continue
    const value: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (!isDeferredDocumentCheck(value) || file !== value.id + ".json") throw Error("invalid saved document check")
    records.set(value.id, value)
  }
  const save = async (check: DeferredDocumentCheck) => {
    await writeDocumentRecord(join(root, documentRecordId(check.id) + ".json"), check)
    records.set(check.id, check)
  }
  const deliver = async (check: DeferredDocumentCheck) => {
    const listener = listeners.get(documentLocationKey(check.location))
    if (
      stopped ||
      !ready ||
      !listener ||
      running.has(check.id) ||
      !["waiting-runtime", "admitting"].includes(check.state)
    )
      return
    const attempt = {}
    running.set(check.id, attempt)
    try {
      const pending = { ...check, state: "admitting" as const }
      await save(pending)
      const admission = await listener(pending)
      if (
        stopped ||
        running.get(check.id) !== attempt ||
        records.get(check.id)?.state !== "admitting" ||
        admission.checkId !== check.id
      )
        return
      if (admission.status === "session-missing") await save({ ...pending, state: "complete" })
      if (admission.status === "admitted" && admission.notificationID === check.notificationID) {
        const missing = await readFile(check.request.path).then(
          () => undefined,
          (error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? error.message : undefined),
        )
        if (missing)
          await writeDocumentRecord(join(root, check.id + ".missing"), {
            reason: missing,
            sourcePath: check.request.path,
          })
        await save({ ...pending, state: missing ? "complete" : "admitted" })
      }
    } finally {
      if (running.get(check.id) === attempt) running.delete(check.id)
    }
  }
  const replay = () => {
    for (const check of records.values())
      void deliver(check).catch((error) => console.error("document check handoff failed", error))
  }
  const unsubscribe = input.runtime.subscribe((state) => {
    ready = state.phase === "ready"
    if (ready) replay()
  })
  const defer: DocumentHost["defer"] = async (check) => {
    const caller = { location: check.location, sessionID: check.sessionID }
    const identity = await readDocumentCheck(caller, check.id)
    if (
      check.id !== check.artifact.checkId ||
      identity.request.path !== check.request.path ||
      identity.request.kind !== check.request.kind ||
      identity.request.outputPath !== check.request.outputPath ||
      check.artifact.sourcePath !== check.request.path ||
      check.sourceSha256 !== check.artifact.sourceSha256
    )
      throw Error("deferred document identity mismatch")
    const existing = records.get(check.id)
    if (
      existing &&
      (existing.sessionID !== check.sessionID ||
        documentLocationKey(existing.location) !== documentLocationKey(check.location))
    )
      throw Error("deferred document owner changed")
    if (existing) return // Preserve the one durable notification ID, including admitted records.
    await save({
      ...check,
      location: {
        directory: check.location.directory,
        ...(check.location.workspaceID ? { workspaceID: check.location.workspaceID } : {}),
      },
      state: "waiting-runtime",
    })
    replay()
  }
  const recordCheck: DocumentHost["recordCheck"] = async ({ caller, checkId, report }) => {
    if (!isDocumentCheckReport(report) || report.checkId !== checkId) throw Error("invalid document check report")
    const { receipt, job } = await documentReceipt(caller, report)
    requireDocumentCoverage(report, receipt.pageCount)
    const evidence = JSON.parse(await readFile(join(job, "read-evidence.json"), "utf8"))
    if (
      evidence.sessionID !== caller.sessionID ||
      report.inspectedPages.some(
        (number) =>
          !evidence.views?.some(
            (view: { page: number; path: string; sha256: string; inspected: boolean }) =>
              view.page === number &&
              view.inspected === true &&
              view.path === receipt.pages[number - 1]?.path &&
              view.sha256 === receipt.pages[number - 1]?.sha256,
          ),
      )
    )
      throw Error("document inspection has no successful visual evidence")
    if (report.formulaCheck) {
      const environment = await input.runtime.pythonEnvironment(caller.location)
      const projection = JSON.parse(
        await readFile(environment.CODEPUPPY_DOCUMENT_HOST, "utf8"),
      ) as DocumentPythonProjection
      if (
        projection.status !== "active" ||
        documentLocationKey(projection.location) !== documentLocationKey(caller.location)
      )
        throw Error("formula host projection is not active for this Location")
      const result: unknown = JSON.parse(
        await readFile(
          join(
            projection.jobs.root,
            "recalculate-" + documentRecordId(report.formulaCheck.recalculationId),
            "receipt.json",
          ),
          "utf8",
        ),
      )
      if (
        !isExcelRecalculateResult(result) ||
        result.status !== "recalculated" ||
        result.path !== receipt.sourcePath ||
        result.resultSha256 !== receipt.sourceSha256 ||
        JSON.stringify(result.errors) !== JSON.stringify(report.formulaCheck.errors)
      )
        throw Error("formula check does not match the actual calculation receipt")
    }
    await writeDocumentRecord(join(job, "check.json"), report)
    const pending = records.get(checkId)
    if (pending) await save({ ...pending, ...(report.final ? { state: "complete" as const } : {}), report })
  }
  const subscribeReady: DocumentHost["subscribeReady"] = (location, listener) => {
    const key = documentLocationKey(location)
    listeners.set(key, listener)
    if ([...records.values()].some((check) => documentLocationKey(check.location) === key && ["waiting-runtime", "admitting"].includes(check.state))) input.runtime.query(location)
    replay()
    return () => {
      if (listeners.get(key) !== listener) return
      listeners.delete(key)
      for (const check of records.values()) if (documentLocationKey(check.location) === key) running.delete(check.id)
    }
  }
  for (const check of records.values()) if (["waiting-runtime", "admitting"].includes(check.state)) input.runtime.query(check.location)
  return {
    defer,
    recordCheck,
    subscribeReady,
    dispose() {
      stopped = true
      unsubscribe()
      listeners.clear()
      running.clear()
    },
  }
}
