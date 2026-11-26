import { copyFileSync, mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { readDocumentAssets } from "./document-resources"

// §4.2 names are shared by fontconfig and the LO profile; never substitute individual glyphs.
const replacements = [
  ["宋体", "Noto Serif SC"], ["SimSun", "Noto Serif SC"],
  ["黑体", "Noto Sans SC"], ["SimHei", "Noto Sans SC"],
  ["微软雅黑", "Noto Sans SC"], ["Microsoft YaHei", "Noto Sans SC"],
] as const
const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

/** Creates a private job profile. Does not touch system/user LO configuration or install fonts. */
export function prepareDocumentFonts(input: { assets: string; runtimeRoot: string; jobRoot: string; platform: "darwin" | "win32"; home: string }) {
  const assets = realpathSync(input.assets)
  const manifest = readDocumentAssets(assets)
  const profile = join(input.jobRoot, "profile")
  mkdirSync(join(profile, "user"), { recursive: true })
  const property = (name: string, type: string, value: string) => `<prop oor:name="${name}" oor:type="xs:${type}"><value>${xml(value)}</value></prop>`
  const item = (path: string, content: string) => `<item oor:path="${path}">${content}</item>`
  const registry = [
    item("/org.openoffice.Office.Common/Font/Substitution", property("Replacement", "boolean", "true") + `<node oor:name="FontPairs">${replacements.map(([from, to], i) => `<node oor:name="_${i}" oor:op="replace">${property("ReplaceFont", "string", from)}${property("SubstituteFont", "string", to)}${property("Always", "boolean", "false")}${property("OnScreenOnly", "boolean", "false")}</node>`).join("")}</node>`),
    item("/org.openoffice.Office.Common/Security/Scripting", property("MacroSecurityLevel", "int", "3")),
    item("/org.openoffice.Office.Writer/Content/Update", property("Link", "int", "2")),
    item("/org.openoffice.Office.Calc/Content/Update", property("Link", "int", "0")),
    item("/org.openoffice.Office.Jobs/Jobs/UpdateCheck/Arguments", property("AutoCheckEnabled", "boolean", "false") + property("AutoDownloadEnabled", "boolean", "false")),
    item("/org.openoffice.Office.Update/Update", property("Enabled", "boolean", "false")),
  ].join("")
  writeFileSync(join(profile, "user", "registrymodifications.xcu"), `<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema">${registry}</oor:items>`)
  if (input.platform === "win32") {
    const destination = join(input.runtimeRoot, "share", "fonts", "truetype")
    mkdirSync(destination, { recursive: true })
    for (const font of manifest.fonts) copyFileSync(join(assets, font.path), join(destination, font.path.split("/").at(-1)!))
    return { profileUri: pathToFileURL(profile).href, environment: {} as Record<string, string> }
  }
  const cache = join(input.jobRoot, "font-cache")
  mkdirSync(cache, { recursive: true })
  const directories = [join(assets, "fonts"), "/System/Library/Fonts", "/System/Library/Fonts/Supplemental", "/Library/Fonts", join(input.home, "Library", "Fonts")]
  const file = join(input.jobRoot, "fonts.conf")
  writeFileSync(file, `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig>${directories.map((dir) => `<dir>${xml(dir)}</dir>`).join("")}<cachedir>${xml(cache)}</cachedir>${replacements.map(([from, to]) => `<alias binding="strong"><family>${xml(from)}</family><prefer><family>${xml(to)}</family></prefer></alias>`).join("")}</fontconfig>`)
  return { profileUri: pathToFileURL(profile).href, environment: { FONTCONFIG_FILE: file } }
}
