import { afterEach, describe, expect, test } from "bun:test"
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { DOCUMENT_ASSET_BUILD_DIR, OFFICE_RUNTIME_BUILD_DIR, documentResources, documentRuntimeResources, officePythonPath, readDocumentAssets } from "./document-resources"
import { checkOfficeRuntime } from "../../scripts/target-arch"

const temporary: string[] = []
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe("document resources", () => {
  test("fixed runtime scripts survive the production extraResources copy", async () => {
    const { getConfig } = await import("../../electron-builder.config")
    const entries = getConfig("prod").extraResources
    if (!Array.isArray(entries)) throw Error("missing resources")
    const entry = entries.find((item) => typeof item !== "string" && item.to === "document-runtime/")
    if (!entry || typeof entry === "string") throw Error("runtime scripts not packaged")
    const root = mkdtempSync(join(tmpdir(), "document-fixed-scripts-")); temporary.push(root)
    cpSync(join(import.meta.dir, "../..", entry.from), join(root, entry.to), { recursive: true })
    const result = documentRuntimeResources(root)
    expect(readFileSync(result.verify, "utf8")).toContain("pypdfium2.PdfDocument")
    expect(readFileSync(result.render, "utf8")).toEqual(readFileSync(join(import.meta.dir, "../../resources/document-runtime/render_document.py"), "utf8"))
    expect(readFileSync(result.updateFields, "utf8")).toContain("getDocumentIndexes()")
    rmSync(result.verify)
    expect(() => documentRuntimeResources(root)).toThrow()
  })
  test.each([false, true])("verified resource projection, packaged=%s, preserves the supplied launcher Node", (packaged) => {
    const input = fixture(packaged)
    const result = documentResources(input)
    expect(result.node).toBe(process.execPath)
    expect(result.python).toBe(officePythonPath(join(input.packaged ? input.resourcesRoot : join(input.resourcesRoot, ".."), input.packaged ? "office-runtime" : `${OFFICE_RUNTIME_BUILD_DIR}/arm64`), "darwin"))
    expect(result.manifest.fonts).toHaveLength(4)
    expect(Object.keys(result.manifest.templates).sort()).toEqual(["docx", "pptx", "xlsx"])
    expect(result.nodeModules).toBe(join(input.packaged ? join(input.resourcesRoot, "document-assets") : join(input.resourcesRoot, "..", DOCUMENT_ASSET_BUILD_DIR), "node_modules"))
  })

  test.each(["interpreter", "font", "template", "digest", "font-licence", "npm-licence"])("rejects a missing or changed %s through the real projection", (fault) => {
    const input = fixture(true)
    const assets = join(input.resourcesRoot, "document-assets")
    const manifest = readDocumentAssets(assets)
    if (fault === "interpreter") rmSync(officePythonPath(join(input.resourcesRoot, "office-runtime"), "darwin"))
    if (fault === "font") rmSync(join(assets, manifest.fonts[0]!.path))
    if (fault === "template") rmSync(join(assets, manifest.templates.pptx.path))
    if (fault === "digest") writeFileSync(join(assets, manifest.templates.docx.path), "changed")
    if (fault.endsWith("licence")) {
      const removed = fault === "font-licence" ? "licenses/OFL-NotoSansSC.txt" : "node_modules/docx/LICENSE"
      rmSync(join(assets, removed))
      writeFileSync(join(assets, "assets.json"), JSON.stringify({ ...manifest, files: manifest.files.filter((file) => file.path !== removed) }))
    }
    expect(() => documentResources(input)).toThrow()
  })

  test("production asset FileSets survive the real electron-builder copier including root node_modules", async () => {
    const { getConfig } = await import("../../electron-builder.config")
    const builder = Bun.resolveSync("electron-builder", join(import.meta.dir, "../.."))
    const copier = await import(Bun.resolveSync("app-builder-lib/out/fileMatcher.js", dirname(builder)))
    const root = realpathSync(mkdtempSync(join(tmpdir(), "document-real-copier-"))); temporary.push(root)
    const entries = getConfig("prod").extraResources
    if (!Array.isArray(entries)) throw Error("missing resources")
    const source = join(import.meta.dir, "fixtures/document-assets")
    const matchers = entries.flatMap((entry) => typeof entry !== "string" && entry.from.startsWith(DOCUMENT_ASSET_BUILD_DIR + "/") ? [new copier.FileMatcher(join(source, entry.from.slice(DOCUMENT_ASSET_BUILD_DIR.length)), join(root, entry.to), (value: string) => value, entry.filter)] : [])
    await copier.copyFiles(matchers)
    expect(readDocumentAssets(join(root, "document-assets")).files.length).toBeGreaterThan(0)
    expect(readFileSync(join(root, "document-assets/node_modules/docx/LICENSE"))).toEqual(readFileSync(join(source, "node_modules/docx/LICENSE")))
  })
  test("afterPack rejects a packaged document asset tree without its npm closure", async () => {
    const { getConfig } = await import("../../electron-builder.config")
    const input = fixture(true)
    rmSync(join(input.resourcesRoot, "document-assets/node_modules"), { recursive: true })
    const afterPack = getConfig("prod").afterPack
    if (typeof afterPack !== "function") throw Error("missing afterPack")
    await expect(afterPack({ electronPlatformName: "win32", appOutDir: join(input.resourcesRoot, "..") } as never)).rejects.toThrow()
  })

  test("production packaging includes the one Office runtime and document asset roots", async () => {
    const { getConfig } = await import("../../electron-builder.config")
    const entries = getConfig("prod").extraResources
    if (!Array.isArray(entries)) throw new Error("missing resources")
    expect(entries.filter((entry) => typeof entry !== "string" && entry.to === "document-assets/")).toEqual([{ from: `${DOCUMENT_ASSET_BUILD_DIR}/`, to: "document-assets/" }])
    expect(entries.filter((entry) => typeof entry !== "string" && entry.to === "office-runtime/")).toHaveLength(1)
  })

  test("Windows interpreter layout and PE target use real pinned archive headers", () => {
    const root = mkdtempSync(join(tmpdir(), "office-pe-")); temporary.push(root)
    cpSync(join(import.meta.dir, "fixtures/office-python-win32-x64.header.bin"), join(root, "python.exe"))
    expect(officePythonPath(root, "win32")).toBe(join(root, "python.exe"))
    expect(checkOfficeRuntime(root, "x64", "win32")).toEqual([])
    const bytes = readFileSync(join(root, "python.exe"))
    bytes.writeUInt16LE(0x014c, bytes.readUInt32LE(60) + 4)
    writeFileSync(join(root, "python.exe"), bytes)
    expect(checkOfficeRuntime(root, "x64", "win32")[0]).toContain("expected win32-x64 PE")
    expect(() => officePythonPath(root, "linux")).toThrow("unsupported")
  })


})

function fixture(packaged: boolean) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "document-resources-"))); temporary.push(root)
  const resourcesRoot = join(root, "resources")
  const assets = packaged ? join(resourcesRoot, "document-assets") : join(root, DOCUMENT_ASSET_BUILD_DIR)
  cpSync(join(import.meta.dir, "fixtures/document-assets"), assets, { recursive: true })
  mkdirSync(join(assets, "node_modules"), { recursive: true })
  const runtime = packaged ? join(resourcesRoot, "office-runtime") : join(root, OFFICE_RUNTIME_BUILD_DIR, "arm64")
  mkdirSync(join(runtime, "bin"), { recursive: true })
  cpSync(join(import.meta.dir, "fixtures/office-python-darwin-arm64.header.bin"), officePythonPath(runtime, "darwin"))
  chmodSync(officePythonPath(runtime, "darwin"), 0o755)
  mkdirSync(join(resourcesRoot, "factory-skills", "office-docs"), { recursive: true })
  return { resourcesRoot, packaged, platform: "darwin" as const, node: process.execPath }
}
