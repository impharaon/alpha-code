import { createHash } from "node:crypto"
import { accessSync, constants, readFileSync, realpathSync } from "node:fs"
import { isAbsolute, join, relative, resolve, sep } from "node:path"

export const DOCUMENT_ASSET_BUILD_DIR = join("native", "document-assets", "build")
export const OFFICE_RUNTIME_BUILD_DIR = join("native", "office-runtime", "build")

export type DocumentAssets = {
  schemaVersion: 1
  files: { path: string; sha256: string }[]
  fonts: { path: string; sha256: string; family: string; weight: number }[]
  templates: Record<"docx" | "xlsx" | "pptx", { path: string; sha256: string; version: string }>
}

export function officePythonPath(runtimeRoot: string, platform: string) {
  if (platform === "darwin") return join(runtimeRoot, "bin", "python3")
  if (platform === "win32") return join(runtimeRoot, "python.exe")
  throw new Error(`unsupported Office platform: ${platform}`)
}

export function readDocumentAssets(root: string): DocumentAssets {
  const value = JSON.parse(readFileSync(join(root, "assets.json"), "utf8")) as DocumentAssets
  if (value.schemaVersion !== 1 || !Array.isArray(value.files) || !Array.isArray(value.fonts) || !value.templates)
    throw new Error("invalid document assets manifest")
  const canonical = realpathSync(root)
  for (const file of value.files) {
    if (typeof file.path !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error("invalid document asset identity")
    const actual = realpathSync(resolve(root, file.path))
    const inside = relative(canonical, actual)
    if (isAbsolute(inside) || inside === ".." || inside.startsWith(`..${sep}`)) throw new Error(`document asset escaped resources: ${file.path}`)
    if (createHash("sha256").update(readFileSync(actual)).digest("hex") !== file.sha256) throw new Error(`document asset digest mismatch: ${file.path}`)
  }
  for (const required of ["licenses/OFL-NotoSansSC.txt", "licenses/OFL-NotoSerifSC.txt", "licenses/FONT-MODIFICATIONS.txt", "node_modules/docx/package.json", "node_modules/pptxgenjs/package.json"])
    if (!value.files.some((file) => file.path === required)) throw new Error(`missing document licence/package: ${required}`)
  for (const pkg of value.files.filter((file) => /(^|\/)node_modules\/.*\/package\.json$/.test(file.path))) {
    const directory = pkg.path.slice(0, -"package.json".length)
    const licence = value.files.some((file) => {
      if (!file.path.startsWith(directory)) return false
      const name = file.path.slice(directory.length)
      if (/^(LICENSE|LICENCE|COPYING|NOTICE)([.\/_-]|$)/i.test(name)) return true
      if (!/^README([._-]|$)/i.test(name)) return false
      const text = readFileSync(join(root, file.path), "utf8")
      return text.includes("Permission is hereby granted") && text.includes('THE SOFTWARE IS PROVIDED "AS IS"')
    })
    if (!licence) throw new Error(`missing npm licence: ${directory}`)
  }
  for (const item of [...value.fonts, ...Object.values(value.templates)])
    if (!value.files.some((file) => file.path === item.path && file.sha256 === item.sha256)) throw new Error(`unlisted document asset: ${item.path}`)
  for (const kind of ["docx", "xlsx", "pptx"] as const)
    if (!value.templates[kind]) throw new Error(`missing document template: ${kind}`)
  if (value.fonts.length !== 4) throw new Error("missing document font instance")
  return value
}

/** Node is supplied only after the launcher resolves its trusted assets. No Node path is derived here. */
export function documentResources(input: { resourcesRoot: string; packaged: boolean; platform: "darwin" | "win32"; node: string }) {
  const assets = input.packaged ? join(input.resourcesRoot, "document-assets") : join(input.resourcesRoot, "..", DOCUMENT_ASSET_BUILD_DIR)
  const runtime = input.packaged ? join(input.resourcesRoot, "office-runtime") : join(input.resourcesRoot, "..", OFFICE_RUNTIME_BUILD_DIR, input.platform === "darwin" ? "arm64" : "win32-x64")
  const manifest = readDocumentAssets(assets)
  const python = realpathSync(officePythonPath(runtime, input.platform))
  if (!isAbsolute(input.node)) throw new Error("launcher must provide an absolute Node entry")
  accessSync(input.node, constants.X_OK)
  accessSync(python, constants.X_OK)
  return {
    python,
    node: input.node,
    nodeModules: realpathSync(join(assets, "node_modules")),
    skills: realpathSync(join(input.resourcesRoot, "factory-skills", "office-docs")),
    fonts: realpathSync(join(assets, "fonts")),
    templates: realpathSync(join(assets, "templates")),
    manifest,
  }
}
