import type { Plugin } from "@opencode/plugin"
import { join } from "node:path"
import {
  type DocumentCaller,
  type DocumentCheckReport,
  type DocumentHost,
  type DeferredDocumentCheck,
  type DocumentCheckAdmission,
} from "../../util/src/codepuppy-document"
import {
  documentReceipt,
  requireDocumentCoverage,
  writeDocumentRecord,
} from "../../ui-mac/src/shared/document-check-records"

type PageView = { path: string; sha256: string; inspected: boolean; reason?: string }
export function createDocumentInspection() {
  const sessions = new Map<string, Map<string, PageView>>()
  return {
    observe(sessionID: string, view: PageView) {
      const pages = sessions.get(sessionID) ?? new Map<string, PageView>()
      const key = JSON.stringify([view.path, view.sha256])
      if (!pages.get(key)?.inspected) pages.set(key, view)
      sessions.set(sessionID, pages)
    },
    async check(caller: DocumentCaller, report: DocumentCheckReport, host: DocumentHost) {
      const { receipt, job } = await documentReceipt(caller, report)
      requireDocumentCoverage(report, receipt.pageCount)
      const views = receipt.pages.map((page) => ({
        ...sessions.get(caller.sessionID)?.get(JSON.stringify([page.path, page.sha256])),
        page: page.number,
        path: page.path,
        sha256: page.sha256,
      }))
      const unavailable = views.filter((view) => report.inspectedPages.includes(view.page) && !view.inspected)
      const recorded = {
        ...report,
        inspectedPages: report.inspectedPages.filter((page) => !unavailable.some((view) => view.page === page)),
        uninspected: [
          ...report.uninspected,
          ...unavailable.map((view) => ({
            page: view.page,
            reason: view.reason ?? "This page has not been visually read in this session.",
          })),
        ],
      }
      await writeDocumentRecord(join(job, "read-evidence.json"), { sessionID: caller.sessionID, views })
      await host.recordCheck({ caller, checkId: report.checkId, report: recorded })
      return recorded
    },
  }
}

/** The existing plugin client owns durable admission and exact-ID retry. No local Session queue. */
export function subscribeDocumentChecks(context: Pick<Plugin.Context, "location" | "session">, host: DocumentHost) {
  return host.subscribeReady(
    context.location,
    async (check: DeferredDocumentCheck): Promise<DocumentCheckAdmission> => {
      const text = `Continue the previously authorized document visual check. The runtime is ready. Read the CURRENT file at ${JSON.stringify(check.request.path)}; if changed since SHA-256 ${check.sourceSha256}, explicitly state the version checked. If missing, report that in this session. Render with checkId ${JSON.stringify(check.id)} and revision ${check.revision}, Read every page (and use the existing vision tool when needed), record document.check. At most one correction round, then re-render and read all corrected pages. Compare the source hash before editing; preserve concurrent user edits. Deliver the file with the actual coverage, fixes and remaining problems. Do not claim work continued while the app was closed.`
      const metadata = { checkId: check.id, sourceSha256: check.sourceSha256 }
      try {
        const data = await context.session.synthetic({
          sessionID: check.sessionID,
          id: check.notificationID,
          text,
          metadata,
          delivery: "queue",
          resume: true,
        })
        if (
          data.id !== check.notificationID ||
          data.sessionID !== check.sessionID ||
          data.type !== "synthetic" ||
          data.delivery !== "queue" ||
          data.payload.text !== text ||
          data.payload.metadata?.checkId !== check.id ||
          data.payload.metadata?.sourceSha256 !== check.sourceSha256
        )
          return { status: "conflict", checkId: check.id }
        return { status: "admitted", checkId: check.id, notificationID: check.notificationID }
      } catch (error) {
        if (error && typeof error === "object" && "_tag" in error && error._tag === "Session.NotFoundError")
          return { status: "session-missing", checkId: check.id }
        throw error
      }
    },
  )
}
