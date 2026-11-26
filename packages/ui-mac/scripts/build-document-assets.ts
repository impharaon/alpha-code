#!/usr/bin/env bun
import { $ } from "bun"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { OFFICE_RUNTIME_LOCK_DIR, buildOfficeRuntime, downloadOfficeBuildFile } from "./build-office-runtime"
import { DOCUMENT_ASSET_BUILD_DIR, officePythonPath, readDocumentAssets, type DocumentAssets } from "../src/main/document-resources"

const packageDir = resolve(import.meta.dir, "..")
const source = join(packageDir, "resources", "document-assets")
const output = join(packageDir, DOCUMENT_ASSET_BUILD_DIR)
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")

export async function buildDocumentAssets() {
  const stamp = createHash("sha256").update(["package.json", "package-lock.json", "fonts.lock.json", "build-requirements.lock"].map((file) => readFileSync(join(source, file))).concat([readFileSync(import.meta.filename), readFileSync(join(import.meta.dir, "build-document-templates.py")), readFileSync(join(OFFICE_RUNTIME_LOCK_DIR, "office-runtime.lock")), readFileSync(join(OFFICE_RUNTIME_LOCK_DIR, process.platform === "win32" ? "requirements-win32-x64.lock" : "requirements-arm64.lock"))]).map((bytes) => createHash("sha256").update(bytes).digest("hex")).join(":" )).digest("hex")
  if (existsSync(join(output, ".stamp")) && readFileSync(join(output, ".stamp"), "utf8") === stamp) {
    readDocumentAssets(output)
    console.log(`[document-assets] verified existing ${output}`)
    return output
  }
  const runtime = buildOfficeRuntime()
  const python = officePythonPath(runtime.dir, process.platform)
  const staging = `${output}.staging`
  const tools = mkdtempSync(join(tmpdir(), "codepuppy-document-build-"))
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  try {
    for (const file of ["package.json", "package-lock.json"]) cpSync(join(source, file), join(staging, file))
    await $`npm ci --ignore-scripts --no-audit --no-fund --prefix ${staging}`
    // https@1.0.0 publishes only package.json; require("https") resolves to the trusted Node builtin.
    rmSync(join(staging, "node_modules", "https"), { recursive: true })
    run("uv", ["pip", "install", "--python", python, "--target", join(tools, "site"), "--require-hashes", "-r", join(source, "build-requirements.lock")])
    const fonts = JSON.parse(readFileSync(join(source, "fonts.lock.json"), "utf8")) as { fontTools: string; commit: string; sources: { path: string; url: string; sha256: string }[]; instances: DocumentAssets["fonts"] }
    const configuration = { ...fonts, sources: fonts.sources.map((entry) => ({ ...entry, local: downloadOfficeBuildFile(entry) })) }
    const config = join(tools, "fonts.json")
    writeFileSync(config, JSON.stringify(configuration))
    // Generate the native TOC/heading relationship through the locked Word library, not a hand-written empty field.
    const toc = join(tools, "native-toc.docx")
    run(process.execPath, ["-e", 'const d = require(process.argv[1]); const doc = new d.Document({sections:[{children:[new d.TableOfContents("目录",{headingStyleRange:"1-3",hyperlink:true}),new d.Paragraph({heading:d.HeadingLevel.HEADING_1,text:"正文"})]}]}); await Bun.write(process.argv[2], await d.Packer.toBuffer(doc))', join(staging, "node_modules", "docx"), toc])
    run(python, ["-I", "-B", "-c", "import sys,runpy; sys.path.insert(0,sys.argv.pop(1)); script=sys.argv.pop(1); runpy.run_path(script,run_name='__main__')", join(tools, "site"), join(import.meta.dir, "build-document-templates.py"), staging, config, toc])
    const instances = JSON.parse(readFileSync(join(staging, "instances.json"), "utf8")) as DocumentAssets["fonts"]
    if (fonts.instances.length !== 4 || JSON.stringify(instances) !== JSON.stringify(fonts.instances)) throw new Error("generated fonts disagree with the pinned instances")
    rmSync(join(staging, "instances.json"))
    mkdirSync(join(staging, "licenses"), { recursive: true })
    for (const entry of configuration.sources.filter((entry) => entry.path.endsWith("/LICENSE")))
      cpSync(entry.local, join(staging, "licenses", `OFL-Noto${entry.path.startsWith("Sans") ? "Sans" : "Serif"}SC.txt`))
    cpSync(join(source, "fonts.lock.json"), join(staging, "licenses", "font-sources.json"))
    writeFileSync(join(staging, "licenses", "FONT-MODIFICATIONS.txt"), `Code Puppy, 2026-11-26. Noto source ${fonts.commit}. FontTools ${fonts.fontTools}; wght=400/700, static TrueType, explicit regular/bold style names. Original OFL and copyrights retained. No Reserved Font Name declared in these source licences.\n`)
    const files = [...new Bun.Glob("**/*").scanSync({ cwd: staging, onlyFiles: true, dot: true })].sort().map((path) => ({ path, sha256: digest(join(staging, path)) }))
    const templates = Object.fromEntries(([['docx', 'chinese-report.docx'], ['xlsx', 'chinese-analysis.xlsx'], ['pptx', 'chinese-presentation.pptx']] as const).map(([kind, name]) => [kind, { path: `templates/${name}`, version: kind === "docx" ? "2" : "1", sha256: digest(join(staging, "templates", name)) }]))
    writeFileSync(join(staging, "assets.json"), JSON.stringify({ schemaVersion: 1, files, fonts: instances, templates }, null, 2) + "\n")
    readDocumentAssets(staging)
    writeFileSync(join(staging, ".stamp"), stamp)
    rmSync(output, { recursive: true, force: true })
    renameSync(staging, output)
    console.log(`[document-assets] ${files.length} verified files, 4 fonts, 3 templates at ${output}`)
    return output
  } finally {
    rmSync(tools, { recursive: true, force: true })
    rmSync(staging, { recursive: true, force: true })
  }
}

function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.status !== 0) throw new Error(`${command} failed: ${result.status ?? result.error?.message}`)
}

if (import.meta.main) await buildDocumentAssets()
