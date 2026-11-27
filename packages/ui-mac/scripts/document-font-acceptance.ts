#!/usr/bin/env bun
// AC-08 acceptance (#1761): a Word file that asks for 宋体, 黑体 and 微软雅黑 is rendered by the fixed renderer
// (resources/document-runtime/render_document.py) with a given LibreOffice, twice:
//   control — a private profile whose fontconfig lists only the system font directories (no bundled fonts, no
//             substitution table): what LibreOffice does without the app's font configuration;
//   product — the profile the app itself prepares for every render (prepareDocumentProfile / prepareDocumentFonts).
// document-font-check.py then reads the fonts PDFium reports per character of each paragraph. Exit 0 only when the
// product arm passes; both arms are printed. Needs the built Office runtime and document assets of this host.
//
//   bun ./scripts/document-font-acceptance.ts <soffice executable> <new output directory>
//
// Not a suite test: it needs a real LibreOffice. Windows (AC-15) runs the same script with that LibreOffice's
// program/soffice.com; control runs first there because the product arm copies the bundled fonts into that tree.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { DOCUMENT_ASSET_BUILD_DIR, OFFICE_RUNTIME_BUILD_DIR, officePythonPath } from "../src/shared/document-resources"
import { prepareDocumentFonts } from "../src/shared/document-runtime-fonts"

const [soffice, out] = process.argv.slice(2)
if (!soffice || !out) throw Error("usage: bun ./scripts/document-font-acceptance.ts <soffice executable> <new output directory>")
const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(scriptDir, "..")
const platform = process.platform === "win32" ? "win32" : "darwin"
const python = officePythonPath(join(packageDir, OFFICE_RUNTIME_BUILD_DIR, platform === "win32" ? "win32-x64" : "arm64"), platform)
const assets = join(packageDir, DOCUMENT_ASSET_BUILD_DIR)
const check = join(scriptDir, "document-font-check.py")
const python3 = (args: string[]) => spawnSync(python, ["-I", "-B", ...args], { encoding: "utf8" })

mkdirSync(out)
const source = join(resolve(out), "fonts.docx")
const made = python3([check, "make", source])
if (made.status !== 0) throw Error(`making the three-font Word file failed: ${made.stderr}`)

const report: Record<string, unknown> = {}
let productPassed = false
for (const arm of ["control", "product"] as const) {
  const jobRoot = join(resolve(out), arm)
  if (arm === "product") prepareDocumentFonts({ assets, runtimeRoot: dirname(dirname(soffice)), jobRoot, platform, home: homedir() })
  else {
    mkdirSync(join(jobRoot, "profile", "user"), { recursive: true })
    const system = ["/System/Library/Fonts", "/System/Library/Fonts/Supplemental", "/Library/Fonts", join(homedir(), "Library", "Fonts")]
    writeFileSync(join(jobRoot, "fonts.conf"), `<?xml version="1.0"?><fontconfig>${system.map((dir) => `<dir>${dir}</dir>`).join("")}<cachedir>${join(jobRoot, "font-cache")}</cachedir></fontconfig>`)
  }
  const job = join(jobRoot, "job")
  mkdirSync(job)
  writeFileSync(
    join(job, "render.json"),
    JSON.stringify({ kind: "docx", source, sourceSha256: createHash("sha256").update(readFileSync(source)).digest("hex"), dpi: 144, profileRoot: jobRoot, executable: soffice, version: "acceptance" }),
  )
  const rendered = python3([join(packageDir, "resources", "document-runtime", "render_document.py"), job])
  const render = JSON.parse(rendered.stdout || "null") as { status: string; pageCount?: number; renderer?: string; detail?: string } | null
  if (rendered.status !== 0 || render?.status !== "rendered") {
    report[arm] = { render: render ?? rendered.stderr }
    continue
  }
  const checked = python3([check, "check", join(job, "pdf", "source.pdf"), assets])
  report[arm] = { render: { renderer: render.renderer, pageCount: render.pageCount, pdf: join(job, "pdf", "source.pdf") }, fonts: JSON.parse(checked.stdout || "null") ?? checked.stderr }
  if (arm === "product") productPassed = checked.status === 0
}
console.log(JSON.stringify(report, null, 2))
process.exit(productPassed ? 0 : 1)
