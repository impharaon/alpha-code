import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises"
import { isAbsolute, join, relative, sep } from "node:path"
import {
  DOCUMENT_WORK_DIR,
  isDocumentCaller,
  isRenderRequest,
  isRenderResult,
  type DocumentCaller,
  type DocumentCheckReport,
  type RenderRequest,
} from "../../../util/src/codepuppy-document"

export const documentSha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
export const documentLocationKey = (location: DocumentCaller["location"]) =>
  JSON.stringify([location.directory, location.workspaceID ?? null])
export async function writeDocumentRecord(path: string, value: unknown) {
  const temporary = path + "." + randomUUID() + ".tmp"
  await writeFile(temporary, JSON.stringify(value))
  await rename(temporary, path)
}
export function documentRecordId(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw Error("invalid document record identity")
  return id
}
export async function documentCheckRoot(caller: DocumentCaller, id: string) {
  const directory = await realpath(caller.location.directory)
  const root = join(directory, DOCUMENT_WORK_DIR, documentRecordId(id))
  await mkdir(root, { recursive: true })
  if ((await realpath(root)) !== root) throw Error("document record escaped its workspace")
  return root
}
export type DocumentCheckIdentity = {
  caller: DocumentCaller
  request: RenderRequest
  originalSha256?: string
  correctionSha256?: string
}
export async function readDocumentCheck(caller: DocumentCaller, id: string): Promise<DocumentCheckIdentity> {
  const value = JSON.parse(await readFile(join(await documentCheckRoot(caller, id), "identity.json"), "utf8"))
  if (
    !isDocumentCaller(value.caller) ||
    !isRenderRequest(value.request) ||
    value.caller.sessionID !== caller.sessionID ||
    documentLocationKey(value.caller.location) !== documentLocationKey(caller.location)
  )
    throw Error("document check does not belong to this session and Location")
  return value
}
export async function documentReceipt(caller: DocumentCaller, report: DocumentCheckReport) {
  const identity = await readDocumentCheck(caller, report.checkId)
  const job = join(
    await documentCheckRoot(caller, report.checkId),
    String(report.revision),
    documentRecordId(report.renderId),
  )
  if ((await realpath(job)) !== job) throw Error("document render escaped its check")
  const value = JSON.parse(await readFile(join(job, "receipt.json"), "utf8"))
  if (!isRenderResult({ status: "rendered", receipt: value })) throw Error("invalid archived document receipt")
  const receipt = value as Extract<
    import("../../../util/src/codepuppy-document").RenderResult,
    { status: "rendered" }
  >["receipt"]
  if (
    receipt.id !== report.renderId ||
    receipt.checkId !== report.checkId ||
    receipt.revision !== report.revision ||
    receipt.sourcePath !== identity.request.path ||
    receipt.kind !== identity.request.kind ||
    (identity.correctionSha256 && report.revision !== 1)
  )
    throw Error("document report does not match its current render")
  if (
    documentSha256(await readFile(receipt.sourcePath)) !== receipt.sourceSha256 ||
    documentSha256(await readFile(receipt.artifactPath)) !== receipt.artifactSha256
  )
    throw Error("document source changed since rendering")
  for (const page of receipt.pages) {
    const inside = relative(job, await realpath(page.path))
    if (
      isAbsolute(inside) ||
      inside === ".." ||
      inside.startsWith(`..${sep}`) ||
      documentSha256(await readFile(page.path)) !== page.sha256
    )
      throw Error("document page changed since rendering")
  }
  return { receipt, job, identity }
}

export function requireDocumentCoverage(report: DocumentCheckReport, pageCount: number) {
  const coverage = [...report.inspectedPages, ...report.uninspected.map((item) => item.page)]
  if (
    coverage.length !== pageCount ||
    new Set(coverage).size !== pageCount ||
    coverage.some((page) => !Number.isSafeInteger(page) || page < 1 || page > pageCount)
  )
    throw Error("document check must account for each rendered page exactly once")
  if ([...report.observations, ...report.remaining].some((issue) => !coverage.includes(issue.page)))
    throw Error("document issue refers to an unknown page")
}
