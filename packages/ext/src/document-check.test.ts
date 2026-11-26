import { afterEach, expect, test } from "bun:test"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createDocumentRenderer } from "./document-render"
import { createDocumentInspection } from "./document-check"
import { createDocumentChecks } from "../../ui-mac/src/main/document-checks"
import { documentCheckRoot, writeDocumentRecord } from "../../ui-mac/src/shared/document-check-records"
import { createDocumentPythonProjections } from "../../ui-mac/src/main/document-python"
import { documentSha256 } from "../../ui-mac/src/shared/document-check-records"
import type {
  DocumentCaller,
  DocumentCheckReport,
  DocumentHost,
  RenderReceipt,
} from "../../util/src/codepuppy-document"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "document-check-")))
  roots.push(root)
  const caller = { location: { directory: root }, sessionID: "ses_document" } as DocumentCaller
  const source = join(root, "report.pdf")
  copyFileSync(join(import.meta.dir, "../../ui-mac/src/main/fixtures/document-runtime/control.pdf"), source)
  mkdirSync(join(root, ".document-output"))
  const runtime = { subscribe: () => () => {}, query: () => ({ phase: "preparing", stage: "download" } as const), pythonEnvironment: async () => ({ CODEPUPPY_DOCUMENT_HOST: join(root, "host.json") }) }
  const stored = createDocumentChecks({ root: join(root, "runtime"), runtime })
  const host = {
    ...stored,
    environment: async () => ({
      python: process.execPath,
      workRoot: join(root, ".document-output"),
      renderState: { phase: "preparing", stage: "download" },
    }),
  } as unknown as DocumentHost
  const input = {
    host,
    assets: join(import.meta.dir, "../../ui-mac/src/main/fixtures/document-assets"),
    documentRuntimeRoot: join(root, "runtime"),
    renderScript: "unused",
    recalculateScript: "unused",
    chromium: host.chromiumRender,
    execute: async (job: string) => {
      const png = readFileSync(join(import.meta.dir, "../../ui-mac/src/main/fixtures/document-runtime/canvas-2-3.png"))
      mkdirSync(join(job, "pages"))
      const pages = [1, 2].map((number) => {
        const path = join(job, "pages", number + ".png")
        writeFileSync(path, png)
        return { number, path, sha256: documentSha256(png), width: 2, height: 3 }
      })
      return {
        stdout: JSON.stringify({
          status: "rendered",
          renderer: "pdfium",
          rendererVersion: "actual PNG fixture",
          pages,
          pageCount: 2,
        }),
        stderr: "",
        exitCode: 0,
      }
    },
  }
  const render = createDocumentRenderer(input)
  const first = await render(caller, { kind: "pdf", path: source })
  if (first.status !== "rendered") throw Error(JSON.stringify(first))
  const report = (receipt: RenderReceipt = first.receipt): DocumentCheckReport => ({
    checkId: receipt.checkId,
    renderId: receipt.id,
    revision: receipt.revision,
    final: false,
    inspectedPages: [1, 2],
    uninspected: [],
    observations: [{ page: 1, detail: "Long heading overlaps the chart." }],
    fixes: [],
    remaining: [],
  })
  return { root, caller, source, host, input, first: first.receipt, report, stored, runtime }
}

test("check records actual page evidence, preserves findings and never equates render with visual inspection", async () => {
  const f = await fixture()
  const inspection = createDocumentInspection()
  const partial = await inspection.check(f.caller, f.report(), f.host)
  expect(partial.inspectedPages).toEqual([])
  expect(partial.uninspected.map((item) => item.page)).toEqual([1, 2])
  inspection.observe(f.caller.sessionID, { ...f.first.pages[0]!, inspected: true })
  inspection.observe(f.caller.sessionID, {
    ...f.first.pages[1]!,
    inspected: false,
    reason: "Cloud vision refused this image.",
  })
  const failed = await inspection.check(f.caller, f.report(), f.host)
  expect(failed.inspectedPages).toEqual([1])
  expect(failed.uninspected).toEqual([{ page: 2, reason: "Cloud vision refused this image." }])
  inspection.observe(f.caller.sessionID, { ...f.first.pages[1]!, inspected: true })
  const report = {
    ...f.report(),
    final: true,
    fixes: ["Reduced heading size."],
    remaining: [{ page: 2, detail: "Small labels remain." }],
  }
  const complete = await inspection.check(f.caller, report, f.host)
  expect(complete).toEqual(report)
  expect(
    JSON.parse(readFileSync(join(f.root, ".document-output", f.first.checkId, "0", f.first.id, "check.json"), "utf8")),
  ).toEqual(report)
  await expect(inspection.check({ ...f.caller, sessionID: "ses_other" as never }, report, f.host)).rejects.toThrow(
    "belong",
  )
  f.stored.dispose()
})

test("coverage and current page/source hashes reject omitted, duplicate, stale and substituted evidence", async () => {
  const f = await fixture()
  const inspection = createDocumentInspection()
  for (const pages of [[1], [1, 1], [1, 3]])
    await expect(inspection.check(f.caller, { ...f.report(), inspectedPages: pages }, f.host)).rejects.toThrow(
      "each rendered page",
    )
  inspection.observe(f.caller.sessionID, { ...f.first.pages[0]!, sha256: "a".repeat(64), inspected: true })
  expect((await inspection.check(f.caller, f.report(), f.host)).inspectedPages).toEqual([])
  writeFileSync(f.first.pages[0]!.path, "not the rendered PNG")
  await expect(inspection.check(f.caller, f.report(), f.host)).rejects.toThrow("page changed")
  f.stored.dispose()
})

test("one correction persists across renderer recreation, and old screenshots cannot certify changed files", async () => {
  const f = await fixture()
  const before = readFileSync(f.source)
  writeFileSync(f.source, Buffer.concat([before, Buffer.from("\n% corrected heading\n")]))
  const inspection = createDocumentInspection()
  await expect(inspection.check(f.caller, f.report(), f.host)).rejects.toThrow("source changed")
  const renderer = createDocumentRenderer(f.input)
  expect((await renderer(f.caller, { kind: "pdf", path: f.source }, f.first.checkId)).status).toBe("failed")
  const corrected = await renderer(f.caller, { kind: "pdf", path: f.source }, f.first.checkId, 1)
  if (corrected.status !== "rendered") throw Error(JSON.stringify(corrected))
  for (const page of corrected.receipt.pages) inspection.observe(f.caller.sessionID, { ...page, inspected: true })
  expect(
    (
      await inspection.check(
        f.caller,
        { ...f.report(corrected.receipt), final: true, fixes: ["Reduced heading size."] },
        f.host,
      )
    ).uninspected,
  ).toEqual([])
  writeFileSync(f.source, Buffer.concat([before, Buffer.from("\n% second correction\n")]))
  const repeated = await createDocumentRenderer(f.input)(f.caller, { kind: "pdf", path: f.source }, f.first.checkId, 1)
  expect(repeated).toMatchObject({ status: "failed", code: "source-changed" })
  f.stored.dispose()
})


test("formula report consumes the owning live projection's calculation receipt and cannot hide its errors", async () => {
  const f = await fixture()
  const projections = createDocumentPythonProjections({ root: join(f.root, "runtime"), generation: 1, pin: { id: "libreoffice/darwin-arm64/fixture", family: "libreoffice", target: "darwin-arm64", version: "fixture", originUrl: "https://example.org/fixture.dmg", provenanceUrl: "https://example.org/source", sha256: "a".repeat(64), bytes: 1 }, assets: f.input.assets, resources: join(import.meta.dir, "../../ui-mac/resources"), platform: "darwin" })
  const environment = projections.environment(f.caller.location, "calculation", { phase: "ready", executable: "/owned/soffice", version: "fixture" })
  f.runtime.pythonEnvironment = async () => environment
  const projection = JSON.parse(readFileSync(environment.CODEPUPPY_DOCUMENT_HOST, "utf8"))
  const source = join(f.root, "sales.xlsx")
  copyFileSync(join(import.meta.dir, "../../ui-mac/src/main/fixtures/office-excel/cache-calculated.xlsx"), source)
  const sha256 = documentSha256(readFileSync(source))
  const receipt = { ...f.first, kind: "xlsx" as const, sourcePath: source, artifactPath: source, sourceSha256: sha256, artifactSha256: sha256 }
  const archive = await documentCheckRoot(f.caller, receipt.checkId)
  await writeDocumentRecord(join(archive, "identity.json"), { caller: f.caller, request: { kind: "xlsx", path: source }, originalSha256: sha256 })
  await writeDocumentRecord(join(archive, "0", receipt.id, "receipt.json"), receipt)
  // The check/receipt are application-owned contracts; the original file and #NAME? are from the pinned real LO fixture.
  const errors = [{ sheet: "Summary", cell: "K2", formula: "=#REF!", error: "#NAME?" }]
  const calculation = { status: "recalculated", id: "calculation", path: source, sourceSha256: sha256, resultSha256: sha256, formulaCount: 4, errors, diagnostics: [] }
  const job = join(projection.jobs.root, "recalculate-calculation")
  mkdirSync(job)
  await writeDocumentRecord(join(job, "receipt.json"), calculation)
  const inspection = createDocumentInspection()
  for (const page of receipt.pages) inspection.observe(f.caller.sessionID, { ...page, inspected: true })
  const report = { ...f.report(receipt), final: true, formulaCheck: { recalculationId: calculation.id, errors } }
  expect((await inspection.check(f.caller, report, f.host)).formulaCheck).toEqual(report.formulaCheck)
  await expect(inspection.check(f.caller, { ...report, formulaCheck: { recalculationId: calculation.id, errors: [] } }, f.host)).rejects.toThrow("actual calculation receipt")
  projections.dispose()
  f.stored.dispose()
})
