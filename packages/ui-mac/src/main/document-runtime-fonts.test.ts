import { afterEach, describe, expect, test } from "bun:test"
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { prepareDocumentFonts } from "./document-runtime-fonts"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "document-fonts-&-"))); roots.push(root)
  const assets = join(root, "assets")
  cpSync(join(import.meta.dir, "fixtures/document-assets"), assets, { recursive: true })
  return { assets, runtimeRoot: join(root, "lo"), jobRoot: join(root, "job & 中文"), home: join(root, "user & home") }
}
describe("document runtime fonts", () => {
  test("mac profile and fontconfig use escaped private paths, all families and print substitutions", () => {
    const input = fixture()
    const result = prepareDocumentFonts({ ...input, platform: "darwin" })
    const config = readFileSync(result.environment.FONTCONFIG_FILE!, "utf8")
    expect(config).toContain("&amp;")
    expect(config).toContain("/System/Library/Fonts/Supplemental")
    expect(config).toContain("<cachedir>")
    const profile = readFileSync(join(input.jobRoot, "profile/user/registrymodifications.xcu"), "utf8")
    for (const family of ["宋体", "SimSun", "黑体", "SimHei", "微软雅黑", "Microsoft YaHei"]) {
      expect(config).toContain(`<family>${family}</family>`)
      expect(profile).toContain(`<value>${family}</value>`)
    }
    expect(profile.match(/oor:name="Always"[^>]*><value>false/g)).toHaveLength(6)
    expect(profile.match(/oor:name="OnScreenOnly"[^>]*><value>false/g)).toHaveLength(6)
    expect(profile).toContain('oor:name="Replacement" oor:type="xs:boolean"><value>true')
    expect(decodeURI(new URL(result.profileUri).pathname)).toBe(join(input.jobRoot, "profile"))
    expect(profile).toContain('oor:name="MacroSecurityLevel" oor:type="xs:int"><value>3')
    expect(profile).toContain('/org.openoffice.Office.Jobs/Jobs/UpdateCheck/Arguments')
    expect(profile).toContain('oor:name="AutoCheckEnabled" oor:type="xs:boolean"><value>false')
  })
  test("Windows uses the four actual private TTF instances and no fontconfig environment", () => {
    const input = fixture()
    expect(prepareDocumentFonts({ ...input, platform: "win32" }).environment).toEqual({})
    const manifest = JSON.parse(readFileSync(join(input.assets, "assets.json"), "utf8"))
    for (const font of manifest.fonts) expect(readFileSync(join(input.runtimeRoot, "share/fonts/truetype", font.path.split("/").at(-1)))).toEqual(readFileSync(join(input.assets, font.path)))
  })
  test("changed font bytes cannot be published as a configured runtime", () => {
    const input = fixture()
    rmSync(join(input.assets, "fonts/NotoSansSC-Regular.ttf"))
    expect(() => prepareDocumentFonts({ ...input, platform: "darwin" })).toThrow()
  })
})
