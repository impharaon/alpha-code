import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, realpath, writeFile, rename } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path"
import type { BrowserWindow, Session } from "electron"
import {
  DOCUMENT_WORK_DIR,
  isRenderRequest,
  type DocumentCaller,
  type RenderRequest,
  type RenderResult,
  type RenderPage,
  type DocumentArtifactRecord,
} from "../../../util/src/codepuppy-document"
import { resolveWorkspaceFile, resolveDocumentArtifact, documentPngInfo } from "../shared/workspace-file"
import { hardenPreviewSession, hardenPreviewContents } from "./preview-isolation"
import { HTML_PREVIEW_SCHEME } from "../shared/html-preview"

const scheme = HTML_PREVIEW_SCHEME
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
// Local JS/CSS/data are supported; all network and navigation remain blocked by the shared session policy.
const csp = `default-src 'none'; script-src 'unsafe-inline' ${scheme}:; style-src 'unsafe-inline' ${scheme}:; img-src data: blob: ${scheme}:; font-src data: ${scheme}:; connect-src ${scheme}:; base-uri 'none'; frame-src 'none'; object-src 'none'`
const mime: Record<string, string> = {
  html: "text/html",
  css: "text/css",
  js: "text/javascript",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  svg: "image/svg+xml",
  gif: "image/gif",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
}
const ready = `(async () => {
  await document.fonts.ready;
  const results = await Promise.allSettled(Array.from(document.images, image => image.decode()));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const canvas = document.querySelector('canvas');
  const bounds = (canvas || document.body).getBoundingClientRect();
  const explicitWidth = canvas?.width || bounds.width;
  const explicitHeight = canvas?.height || bounds.height;
  return { width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), canvasWidth: explicitWidth || null, canvasHeight: explicitHeight || null, imageErrors: results.filter(result => result.status === 'rejected').length };
})()`

export async function renderDocumentChromium(
  input: { caller: DocumentCaller; checkId: string; revision: 0 | 1; request: RenderRequest; sourceSha256: string },
  electron: {
    create: (session: Session, width: number, height: number) => BrowserWindow
    session: () => Session
    version: string
    packaged: boolean
  },
  signal?: AbortSignal,
): Promise<RenderResult> {
  if (
    !input.checkId ||
    /[\\/]/.test(input.checkId) ||
    input.checkId === ".." ||
    input.checkId === "." ||
    !isRenderRequest(input.request) ||
    !["html", "design"].includes(input.request.kind)
  )
    return { status: "failed", code: "invalid-input", detail: "invalid Chromium document request" }
  const diagnostics: string[] = []
  let artifact: DocumentArtifactRecord | undefined
  let window: BrowserWindow | undefined
  let session: Session | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancelTimer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const abort = () => {
    timedOut = true
    window?.destroy()
  }
  signal?.addEventListener("abort", abort, { once: true })
  try {
    if (signal?.aborted) throw Error("document rendering cancelled")
    const source = resolveWorkspaceFile(
      input.caller.location.directory,
      relative(input.caller.location.directory, input.request.path).split(sep).join("/"),
    )
    if (!source.ok) return { status: "failed", code: "source-missing", detail: source.code }
    const snapshot = await readFile(source.file.abs)
    new TextDecoder("utf-8", { fatal: true }).decode(snapshot)
    if (snapshot.subarray(0, 5).toString() === "%PDF-" || snapshot.subarray(0, 2).toString() === "PK")
      throw Error("HTML request does not match the source format")
    if (digest(snapshot) !== input.sourceSha256)
      return { status: "failed", code: "source-changed", detail: "HTML source changed before capture" }
    if (input.request.kind === "html")
      artifact = {
        checkId: input.checkId,
        kind: "html",
        sourcePath: source.file.abs,
        sourceSha256: input.sourceSha256,
        artifactPath: source.file.abs,
        artifactSha256: input.sourceSha256,
      }
    const work = join(input.caller.location.directory, DOCUMENT_WORK_DIR)
    await mkdir(work, { recursive: true })
    if (relative(await realpath(input.caller.location.directory), await realpath(work)) !== DOCUMENT_WORK_DIR)
      throw Error("document work root escaped its workspace")
    if (input.request.kind === "design") {
      const parent = await realpath(dirname(input.request.outputPath!))
      const inside = relative(await realpath(input.caller.location.directory), parent)
      if (
        isAbsolute(inside) ||
        inside === ".." ||
        inside.startsWith(`..${sep}`) ||
        join(parent, basename(input.request.outputPath!)) === (await realpath(source.file.abs)) ||
        !input.request.outputPath!.toLowerCase().endsWith(".png")
      )
        throw Error("invalid design PNG target")
    }
    const id = randomUUID()
    const job = join(work, input.checkId, String(input.revision), id)
    await mkdir(job, { recursive: true })
    // The owning host validates checkId/Location; no user-supplied resource URL crosses this boundary.
    const token = randomUUID()
    session = electron.session()
    hardenPreviewSession(session, {
      scheme,
      packaged: electron.packaged,
      kind: "html",
      blocked: (url) => {
        diagnostics.push(`external reference blocked: ${new URL(url).protocol}`)
      },
    })
    const root = dirname(source.file.abs)
    const resources = new Map<string, Buffer>()
    await session.protocol.handle(scheme, async (request) => {
      const url = new URL(request.url)
      if (url.hostname !== token) return new Response("not found", { status: 404 })
      const raw = decodeURIComponent(url.pathname).slice(1)
      if (raw === "source.html")
        return new Response(new Uint8Array(snapshot), {
          headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": csp },
        })
      const resolved = resolveWorkspaceFile(root, raw)
      if (!resolved.ok) {
        diagnostics.push(`local reference unavailable: ${raw}`)
        return new Response("not found", { status: 404 })
      }
      const type = mime[raw.split(".").at(-1)?.toLowerCase() ?? ""]
      if (!type) return new Response("unsupported resource", { status: 403 })
      const bytes = resources.get(resolved.file.abs) ?? (await readFile(resolved.file.abs))
      resources.set(resolved.file.abs, bytes)
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": type, "Content-Security-Policy": csp } })
    })
    const viewport = input.request.viewport ?? { width: 1440, height: 900 }
    if (timedOut) throw Error("document rendering cancelled")
    window = electron.create(session, viewport.width, viewport.height)
    const contents = window.webContents
    hardenPreviewContents(contents, "document")
    contents.setBackgroundThrottling(false)
    const capture = async (): Promise<RenderResult> => {
      await contents.loadURL(`${scheme}://${token}/source.html`)
      const dimensions = (await contents.executeJavaScript(ready)) as {
        width: number
        height: number
        canvasWidth: number | null
        canvasHeight: number | null
        imageErrors: number
      }
      if (
        !Number.isFinite(dimensions.height) ||
        dimensions.height <= 0 ||
        !Number.isFinite(dimensions.width) ||
        dimensions.width <= 0
      )
        throw Error("invalid HTML document dimensions")
      if (dimensions.imageErrors) diagnostics.push(`${dimensions.imageErrors} image decode(s) failed`)
      const width =
        input.request.kind === "design" ? (input.request.viewport?.width ?? dimensions.canvasWidth) : viewport.width
      const height =
        input.request.kind === "design"
          ? (input.request.viewport?.height ?? dimensions.canvasHeight)
          : dimensions.height
      if (!width || !height)
        return {
          status: "failed",
          code: "invalid-input",
          detail: "design source has no declared canvas; specify its viewport",
        }
      const pages: RenderPage[] = []
      if (input.request.kind === "design") {
        window!.setContentSize(Math.ceil(width), Math.ceil(height))
        await contents.executeJavaScript(
          "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
        )
        const image = await contents.capturePage(
          { x: 0, y: 0, width: Math.ceil(width), height: Math.ceil(height) },
          { stayHidden: true, stayAwake: true },
        )
        const output = input.request.outputPath!
        const directory = await realpath(dirname(output))
        const actual = relative(await realpath(input.caller.location.directory), directory)
        if (isAbsolute(actual) || actual === ".." || actual.startsWith(`..${sep}`))
          throw Error("design PNG target escaped its workspace")
        if (!output.toLowerCase().endsWith(".png")) throw Error("design output must be a PNG file")
        const png = image.toPNG({ scaleFactor: 1 })
        const size = documentPngInfo(png)
        if (size.width !== Math.ceil(width) || size.height !== Math.ceil(height))
          throw Error("Chromium did not capture the complete canvas")
        const temporary = join(directory, `.${id}.png`)
        await writeFile(temporary, png)
        if (timedOut) throw Error("document capture timeout")
        await rename(temporary, output)
        const file = resolveWorkspaceFile(
          input.caller.location.directory,
          relative(input.caller.location.directory, output).split(sep).join("/"),
        )
        if (!file.ok) throw Error("design output was not created")
        artifact = {
          checkId: input.checkId,
          kind: "design",
          sourcePath: source.file.abs,
          sourceSha256: input.sourceSha256,
          artifactPath: file.file.abs,
          artifactSha256: digest(await readFile(file.file.abs)),
        }
        const path = join(job, "1.png")
        await writeFile(path, png)
        pages.push({
          number: 1,
          path,
          sha256: digest(png),
          width: image.getSize().width,
          height: image.getSize().height,
        })
      } else {
        for (let y = 0; y < height; y += viewport.height) {
          if (timedOut) throw Error("document capture timeout")
          const scroll = (await contents.executeJavaScript(
            `scrollTo(0, ${y}); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(scrollY))))`,
          )) as number
          const image = await contents.capturePage(
            { x: 0, y: y - scroll, width: viewport.width, height: Math.min(viewport.height, height - y) },
            { stayHidden: true, stayAwake: true },
          )
          const png = image.toPNG({ scaleFactor: 1 })
          const size = documentPngInfo(png)
          if (size.width !== viewport.width || size.height !== Math.min(viewport.height, height - y))
            throw Error("Chromium did not capture the complete page segment")
          const path = join(job, `${pages.length + 1}.png`)
          await writeFile(path, png)
          pages.push({
            number: pages.length + 1,
            path,
            sha256: digest(png),
            width: image.getSize().width,
            height: image.getSize().height,
          })
        }
      }
      if (timedOut) throw Error("document capture timeout")
      if (digest(await readFile(source.file.abs)) !== input.sourceSha256)
        return {
          status: "failed",
          code: "source-changed",
          detail: "HTML source changed during capture",
          ...(artifact ? { artifact: await resolveDocumentArtifact(input.caller.location.directory, artifact) } : {}),
        }
      const receipt = {
        ...artifact!,
        id,
        revision: input.revision,
        renderer: "chromium" as const,
        rendererVersion: electron.version,
        pages,
        pageCount: pages.length,
        template: null,
        diagnostics,
      }
      await writeFile(join(job, "receipt.json"), JSON.stringify(receipt))
      return { status: "rendered", receipt }
    }
    cancelTimer = setTimeout(() => {
      timedOut = true
      contents.stop()
    }, 178_000)
    return await Promise.race([
      capture(),
      new Promise<RenderResult>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true
          window?.destroy()
          resolve({
            status: "failed",
            code: "timeout",
            detail: "Chromium document rendering timeout",
            ...(artifact ? { artifact } : {}),
          })
        }, 180_000)
      }),
    ])
  } catch (error) {
    const current = artifact
      ? await resolveDocumentArtifact(input.caller.location.directory, artifact).catch(() => undefined)
      : undefined
    return {
      status: "failed",
      code: timedOut ? "timeout" : "raster",
      detail: error instanceof Error ? error.message : String(error),
      ...(current ? { artifact: current } : {}),
    }
  } finally {
    clearTimeout(timer)
    clearTimeout(cancelTimer)
    signal?.removeEventListener("abort", abort)
    if (window && !window.isDestroyed()) window.destroy()
    if (session) {
      session.protocol.unhandle(scheme)
      await session.clearStorageData().catch(() => {})
    }
  }
}

/** Loaded only inside the real main host. Unit tests use a facade and never start Electron. */
export async function documentChromium(input: Parameters<typeof renderDocumentChromium>[0], signal?: AbortSignal) {
  const { BrowserWindow, session, app } = await import("electron")
  return renderDocumentChromium(
    input,
    {
      packaged: app.isPackaged,
      version: process.versions.chrome ?? "unknown",
      session: () => session.fromPartition(`document-${randomUUID()}`),
      create: (session, width, height) =>
        new BrowserWindow({
          show: false,
          width,
          height,
          useContentSize: true,
          frame: false,
          webPreferences: {
            session,
            offscreen: true,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: false,
            backgroundThrottling: false,
            webSecurity: true,
          },
        }),
    },
    signal,
  )
}
