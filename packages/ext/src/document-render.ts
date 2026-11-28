import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import { basename, isAbsolute, join, relative, sep } from "node:path"
import { homedir } from "node:os"
import {
  documentCheckRoot,
  readDocumentCheck,
  writeDocumentRecord,
  type DocumentCheckIdentity,
} from "../../ui-mac/src/shared/document-check-records"
import { SessionMessage } from "@opencode/schema/session-message"
import {
  DOCUMENT_WORK_DIR,
  documentRecord,
  isExcelRecalculateResult,
  isRenderRequest,
  type DocumentCaller,
  type DocumentHost,
  type DocumentArtifactRecord,
  type RenderRequest,
  type RenderResult,
  type RenderPage,
} from "../../util/src/codepuppy-document"
import {
  resolveWorkspaceFile,
  resolveDocumentArtifact,
  documentContainerKind,
  documentPngInfo,
} from "../../ui-mac/src/shared/workspace-file"
import { readDocumentAssets } from "../../ui-mac/src/shared/document-resources"
import { prepareDocumentProfile } from "../../ui-mac/src/shared/document-runtime-fonts"
import { runDocumentPython } from "./document-process"

export function createDocumentRenderer(input: {
  host: DocumentHost
  chromium: (input: Parameters<DocumentHost["chromiumRender"]>[0], signal: AbortSignal) => Promise<RenderResult>
  assets: string
  documentRuntimeRoot: string
  renderScript: string
  recalculateScript: string
  execute?: (
    jobRoot: string,
    python: string,
    signal: AbortSignal,
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
}) {
  return async (
    caller: DocumentCaller,
    request: RenderRequest,
    checkId?: string,
    revision: 0 | 1 = 0,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<RenderResult> => {
    // Business validation happens before filesystem calls or environment acquisition.
    if (
      !isRenderRequest(request) ||
      (revision !== 0 && revision !== 1) ||
      (checkId !== undefined && (typeof checkId !== "string" || !checkId))
    )
      return { status: "failed", code: "invalid-input", detail: "invalid document render parameters" }
    if (revision === 1 && !checkId)
      return { status: "failed", code: "invalid-input", detail: "revision 1 requires its original checkId" }
    let previous: DocumentCheckIdentity | undefined
    if (checkId) {
      try {
        previous = await readDocumentCheck(caller, checkId)
      } catch {
        // The tool allocates checkId (design §4.4); an unknown one is still rejected, but the detail is what the model needs
        // to recover on its next call.
        return {
          status: "failed",
          code: "invalid-input",
          detail:
            "unknown checkId: the tool assigns it. For the first render of a file, omit checkId and revision; reuse the returned receipt.checkId only for its revision 1 correction render in this session",
        }
      }
      if (
        previous.request.path !== request.path ||
        previous.request.kind !== request.kind ||
        previous.request.outputPath !== request.outputPath
      )
        return { status: "failed", code: "invalid-input", detail: "document artifact identity changed" }
    }
    let artifact: DocumentArtifactRecord | undefined
    const failed = async (
      code: Extract<RenderResult, { status: "failed" }>["code"],
      detail: string,
    ): Promise<RenderResult> => {
      const current = artifact
        ? await resolveDocumentArtifact(caller.location.directory, artifact).catch(() => undefined)
        : undefined
      return { status: "failed", code, detail, ...(current ? { artifact: current } : {}) }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 178_000)
    const combined = AbortSignal.any([signal, controller.signal])
    let deadline: ReturnType<typeof setTimeout> | undefined
    const id = checkId ?? randomUUID()
    const operation = async (): Promise<RenderResult> => {
      try {
        const rel = relative(caller.location.directory, request.path).split(sep).join("/")
        const source = resolveWorkspaceFile(caller.location.directory, rel)
        if (!source.ok) return { status: "failed", code: "source-missing", detail: source.code }
        const bytes = await readFile(source.file.abs)
        if (!["html", "design"].includes(request.kind)) {
          try {
            if ((await documentContainerKind(bytes)) !== request.kind)
              return {
                status: "failed",
                code: "invalid-input",
                detail: "requested kind does not match the source container",
              }
          } catch (error) {
            return {
              status: "failed",
              code: "invalid-input",
              detail: error instanceof Error ? error.message : String(error),
            }
          }
        }
        const digest = createHash("sha256").update(bytes).digest("hex")
        if (request.kind !== "design")
          artifact = {
            checkId: id,
            kind: request.kind,
            sourcePath: source.file.abs,
            sourceSha256: digest,
            artifactPath: source.file.abs,
            artifactSha256: digest,
          }
        const environment = await input.host.environment(caller)
        if (combined.aborted) throw Error("document rendering timeout")
        const work = join(caller.location.directory, DOCUMENT_WORK_DIR)
        if ((await realpath(environment.workRoot)) !== (await realpath(work)))
          throw Error("document work root does not match the Location")
        if (
          (previous?.correctionSha256 && (revision !== 1 || previous.correctionSha256 !== digest)) ||
          (revision === 0 && previous?.originalSha256 && previous.originalSha256 !== digest)
        )
          return failed("source-changed", "the single correction round requires revision 1 and cannot be repeated")
        const identity = {
          ...previous,
          caller: {
            location: {
              directory: caller.location.directory,
              ...(caller.location.workspaceID ? { workspaceID: caller.location.workspaceID } : {}),
            },
            sessionID: caller.sessionID,
          },
          request,
        }
        const archive = await documentCheckRoot(caller, id)
        await writeDocumentRecord(join(archive, "identity.json"), identity)
        const renderId = randomUUID()
        const job = join(work, id, String(revision), renderId)
        if (request.kind === "html" || request.kind === "design") {
          const result = await input.chromium(
            { caller, checkId: id, revision, request, sourceSha256: digest },
            combined,
          )
          if (result.status === "rendered")
            await writeDocumentRecord(join(archive, "identity.json"), {
              ...identity,
              ...(revision === 0
                ? { originalSha256: result.receipt.sourceSha256 }
                : { correctionSha256: result.receipt.sourceSha256 }),
            })
          return result
        }
        if (
          createHash("sha256")
            .update(await readFile(source.file.abs))
            .digest("hex") !== digest
        )
          return failed("source-changed", "source changed while resolving the document environment")
        if (request.kind !== "pdf" && environment.renderState.phase !== "ready") {
          const record = artifact!
          await input.host.defer({
            id,
            location: caller.location,
            sessionID: caller.sessionID,
            notificationID: SessionMessage.ID.create(),
            request,
            sourceSha256: digest,
            artifact: record,
            revision,
            state: "waiting-runtime",
          })
          return { status: "pending", checkId: id, artifact: record, runtime: environment.renderState }
        }
        const diagnostics: string[] = []
        const calculated = request.kind !== "xlsx" ? undefined : await (async () => {
          try {
            const output = await runDocumentPython({
              operation: "recalculate",
              python: environment.python,
              script: input.recalculateScript,
              directory: caller.location.directory,
              path: source.file.abs,
              environment: environment.pythonEnvironment,
            }, combined)
            if (output.exitCode !== 0) throw Error(output.stderr || "Excel calculation exited without a receipt")
            const result: unknown = JSON.parse(output.stdout)
            if (!isExcelRecalculateResult(result)) throw Error("Excel calculation did not produce a receipt")
            return result
          } catch (error) {
            diagnostics.push("Excel recalculation did not complete: " + String(error))
          }
        })()
        if (isExcelRecalculateResult(calculated) && calculated.status !== "recalculated") {
          if (calculated.status === "pending") {
            const artifact = await resolveDocumentArtifact(caller.location.directory, {
              checkId: id,
              kind: request.kind,
              sourcePath: source.file.abs,
              artifactPath: source.file.abs,
            })
            if (!artifact || artifact.sourceSha256 !== digest)
              return failed("source-changed", "Excel source changed while waiting for runtime")
            await input.host.defer({
              id,
              location: caller.location,
              sessionID: caller.sessionID,
              notificationID: SessionMessage.ID.create(),
              request,
              sourceSha256: digest,
              artifact,
              revision,
              state: "waiting-runtime",
            })
            return { status: "pending", checkId: id, artifact, runtime: calculated.runtime }
          }
          if (calculated.code === "source-changed") return failed("source-changed", calculated.detail)
          diagnostics.push("Excel recalculation did not complete: " + calculated.detail)
        }
        if (
          isExcelRecalculateResult(calculated) &&
          calculated.status === "recalculated" &&
          ((await realpath(calculated.path)) !== (await realpath(source.file.abs)) ||
            calculated.sourceSha256 !== digest ||
            typeof calculated.resultSha256 !== "string")
        )
          return failed("source-changed", "Excel source changed before calculation")
        const renderedDigest = calculated?.status === "recalculated" ? calculated.resultSha256 : digest
        if (calculated?.status === "recalculated")
          diagnostics.push(
            JSON.stringify({
              recalculationId: calculated.id,
              errors: calculated.errors,
              diagnostics: calculated.diagnostics,
            }),
          )
        if (artifact) artifact = { ...artifact, sourceSha256: renderedDigest, artifactSha256: renderedDigest }
        await mkdir(job, { recursive: true })
        const profileRoot = join(input.documentRuntimeRoot, "jobs", renderId)
        if (request.kind !== "pdf")
          prepareDocumentProfile({
            assets: input.assets,
            jobRoot: profileRoot,
            platform: process.platform === "darwin" ? "darwin" : "win32",
            home: homedir(),
          })
        await writeFile(
          join(job, "render.json"),
          JSON.stringify({
            kind: request.kind,
            source: source.file.abs,
            sourceSha256: renderedDigest,
            dpi: request.dpi ?? 144,
            profileRoot,
            ...(environment.renderState.phase === "ready"
              ? { executable: environment.renderState.executable, version: environment.renderState.version }
              : {}),
          }),
        )
        const execution = input.execute
          ? input.execute(job, environment.python, combined)
          : runDocumentPython(
              {
                operation: "render",
                python: environment.python,
                script: input.renderScript,
                directory: caller.location.directory,
                jobRoot: job,
              },
              combined,
            )
        const output = await execution
        if (combined.aborted) throw Error("document rendering cancelled or timed out")
        if (output.exitCode !== 0) return failed("conversion", `exit ${output.exitCode}: ${output.stderr}`)
        const result: unknown = JSON.parse(output.stdout)
        if (!documentRecord(result)) throw Error("invalid fixed renderer output")
        if (result.status === "failed")
          return failed(
            ["invalid-input", "source-changed", "conversion", "raster", "disk"].includes(String(result.code))
              ? (result.code as "conversion")
              : "raster",
            String(result.detail),
          )
        if (
          result.status !== "rendered" ||
          result.renderer !== (request.kind === "pdf" ? "pdfium" : "libreoffice-pdfium") ||
          typeof result.rendererVersion !== "string" ||
          !Array.isArray(result.pages) ||
          !result.pages.length ||
          result.pageCount !== result.pages.length
        )
          throw Error("renderer omitted pages or source identity")
        const pages: RenderPage[] = []
        for (const [index, value] of result.pages.entries()) {
          if (
            !documentRecord(value) ||
            value.number !== index + 1 ||
            typeof value.path !== "string" ||
            !Number.isSafeInteger(value.width) ||
            Number(value.width) <= 0 ||
            !Number.isSafeInteger(value.height) ||
            Number(value.height) <= 0
          )
            throw Error("invalid rendered page")
          const path = await realpath(value.path)
          const inside = relative(await realpath(job), path)
          if (isAbsolute(inside) || inside === ".." || inside.startsWith(`..${sep}`))
            throw Error("rendered page escaped its job")
          const png = await readFile(path)
          const info = documentPngInfo(png)
          if (info.width !== value.width || info.height !== value.height || info.sha256 !== value.sha256)
            throw Error("rendered page identity mismatch")
          pages.push({
            number: index + 1,
            path,
            sha256: String(value.sha256),
            width: Number(value.width),
            height: Number(value.height),
          })
        }
        if (
          createHash("sha256")
            .update(await readFile(source.file.abs))
            .digest("hex") !== renderedDigest
        )
          return failed("source-changed", "source changed during rendering")
        const assets = readDocumentAssets(input.assets)
        const template = request.kind === "pdf" ? undefined : assets.templates[request.kind]
        const known = template && result.templateSource === `bundled:${basename(template.path).replace(/\.[^.]+$/, "")}`
        const receipt = {
          ...artifact!,
          id: renderId,
          revision,
          renderer: request.kind === "pdf" ? ("pdfium" as const) : ("libreoffice-pdfium" as const),
          rendererVersion: result.rendererVersion,
          pages,
          pageCount: pages.length,
          template: known
            ? { source: "bundled" as const, path: join(input.assets, template.path), sha256: template.sha256 }
            : null,
          diagnostics: [
            ...diagnostics,
            ...(Array.isArray(result.diagnostics)
              ? result.diagnostics.filter((v): v is string => typeof v === "string")
              : []),
            ...(output.stderr ? [output.stderr] : []),
          ],
        }
        await writeDocumentRecord(join(job, "receipt.json"), receipt)
        await writeDocumentRecord(join(archive, "identity.json"), {
          ...identity,
          ...(revision === 0 ? { originalSha256: renderedDigest } : { correctionSha256: renderedDigest }),
        })
        return { status: "rendered", receipt }
      } catch (error) {
        return failed(
          combined.aborted || (error instanceof Error && /timeout/.test(error.message)) ? "timeout" : "raster",
          error instanceof Error ? error.message : String(error),
        )
      }
    }
    try {
      return await Promise.race([
        operation(),
        new Promise<RenderResult>((resolve) => {
          deadline = setTimeout(() => {
            controller.abort()
            resolve({
              status: "failed",
              code: "timeout",
              detail: "document rendering timeout",
              ...(artifact ? { artifact } : {}),
            })
          }, 180_000)
        }),
      ])
    } finally {
      clearTimeout(timer)
      clearTimeout(deadline)
    }
  }
}
