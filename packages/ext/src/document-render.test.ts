import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDocumentRenderer } from "./document-render"
import { createDocumentTool } from "./document-tool"
import type { DocumentHost, DocumentCaller, DeferredDocumentCheck } from "../../util/src/codepuppy-document"
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "document-render-")))
  roots.push(root)
  const assets = join(root, "assets")
  cpSync(join(import.meta.dir, "../../ui-mac/src/main/fixtures/document-assets"), assets, { recursive: true })
  const source = join(root, "report.pdf")
  copyFileSync(join(import.meta.dir, "../../ui-mac/src/main/fixtures/document-runtime/control.pdf"), source)
  mkdirSync(join(root, ".document-output"))
  const caller = { location: { directory: root }, sessionID: "ses_document" } as DocumentCaller
  const deferred: DeferredDocumentCheck[] = []
  let queried = 0
  const host: DocumentHost = {
    pythonEnvironment: async () => ({ CODEPUPPY_DOCUMENT_HOST: join(root, "host.json") }),
    environment: async () => {
      queried++
      return {
        python: process.execPath,
        node: process.execPath,
        nodeModules: join(assets, "node_modules"),
        skills: assets,
        templates: join(assets, "templates"),
        fonts: join(assets, "fonts"),
        workRoot: join(root, ".document-output"), pythonEnvironment: { CODEPUPPY_DOCUMENT_HOST: join(root, "host.json") },
        renderState: { phase: "preparing", stage: "download", received: 1, total: 100 },
      }
    },
    chromiumRender: async () => {
      throw Error("not a Chromium case")
    },
    defer: async (check) => {
      deferred.push(check)
    },
    recordCheck: async () => {
      throw Error("inspection belongs to slice 6")
    },
    subscribeReady: () => () => {},
    subscribeRuntimeVerify: () => async () => {},
  }
  const execute = async (job: string) => {
    mkdirSync(join(job, "pages"))
    const png = readFileSync(join(import.meta.dir, "../../ui-mac/src/main/fixtures/document-runtime/canvas-2-3.png"))
    const pages = [1, 2].map((number) => {
      const path = join(job, "pages", number + ".png")
      writeFileSync(path, png)
      return { number, path, width: 2, height: 3, sha256: createHash("sha256").update(png).digest("hex") }
    })
    return {
      stdout: JSON.stringify({
        status: "rendered",
        renderer: "pdfium",
        rendererVersion: "component fixture",
        pages,
        pageCount: pages.length,
        diagnostics: [],
      }),
      stderr: "",
      exitCode: 0,
    }
  }
  const input = {
    host,
    assets,
    documentRuntimeRoot: join(root, "runtime"),
    renderScript: join(root, "fixed-render.py"),
    recalculateScript: join(root, "fixed-recalculate.py"),
    chromium: host.chromiumRender,
    execute,
  }
  return { root, source, caller, input, deferred, queried: () => queried }
}
describe("document render", () => {
  test("invalid business parameters do no filesystem/environment work", async () => {
    const f = fixture()
    const render = createDocumentRenderer(f.input)
    for (const request of [
      { kind: "pdf", path: f.source, dpi: Infinity },
      { kind: "design", path: f.source },
      { kind: "pdf", path: "relative" },
      { kind: "pdf", path: f.source, viewport: { width: 0, height: 3 } },
    ])
      expect((await render(f.caller, request as never)).status).toBe("failed")
    expect(f.queried()).toBe(0)
  })
  test("mismatched Office/PDF containers fail before the environment is queried", async () => {
    const f = fixture()
    const render = createDocumentRenderer(f.input)
    expect(await render(f.caller, { kind: "docx", path: f.source })).toMatchObject({
      status: "failed",
      code: "invalid-input",
    })
    expect(f.queried()).toBe(0)
  })
  test("validates every returned page and binds rerenders/corrections to the owning session and artifact", async () => {
    const f = fixture()
    const render = createDocumentRenderer(f.input)
    const result = await render(f.caller, { kind: "pdf", path: f.source })
    expect(result.status).toBe("rendered")
    if (result.status !== "rendered") throw Error(JSON.stringify(result))
    expect(result.receipt.pageCount).toBe(2)
    const correction = await render(f.caller, { kind: "pdf", path: f.source }, result.receipt.checkId, 1)
    expect(correction.status).toBe("rendered")
    const foreign = await render(
      { ...f.caller, sessionID: "ses_other" as DocumentCaller["sessionID"] },
      { kind: "pdf", path: f.source },
      result.receipt.checkId,
      1,
    )
    expect(foreign).toMatchObject({ status: "failed", code: "invalid-input" })
  })
  test("pending Office artifacts persist before return and are included in normal completed tool metadata", async () => {
    const f = fixture()
    const source = join(f.root, "report.docx")
    copyFileSync(join(f.input.assets, "templates/chinese-report.docx"), source)
    const tool = createDocumentTool({
      host: () => f.input.host,
      location: f.caller.location,
      render: createDocumentRenderer(f.input),
    })
    const result = await tool.execute({ action: "render", request: { kind: "docx", path: source } }, {
      sessionID: f.caller.sessionID,
      signal: new AbortController().signal,
      progress: async () => {},
    } as never)
    expect(JSON.parse(String(result.content))).toMatchObject({ status: "pending" })
    expect(f.deferred).toHaveLength(1)
    expect(result.metadata).toMatchObject({
      codepuppyDocument: { schemaVersion: 1, artifact: { sourcePath: source, artifactPath: source } },
    })
    expect(JSON.parse(String(result.content)).status).toBe("pending")
  })
  test("wrong page digest returns failure while preserving the actual current artifact", async () => {
    const f = fixture()
    const render = createDocumentRenderer({
      ...f.input,
      execute: async (job, python, signal) => {
        const output = await f.input.execute(job)
        const value = JSON.parse(output.stdout)
        value.pages[1].sha256 = "a".repeat(64)
        return { ...output, stdout: JSON.stringify(value) }
      },
    })
    const result = await render(f.caller, { kind: "pdf", path: f.source })
    expect(result).toMatchObject({ status: "failed", code: "raster", artifact: { artifactPath: f.source } })
  })
})
