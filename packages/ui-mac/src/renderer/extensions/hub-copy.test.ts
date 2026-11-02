import { afterEach, expect, test } from "bun:test"
import { dict as en } from "../i18n/en"
import { dict as zh } from "../i18n/zh"
import { setLocale, t } from "../i18n"
import { extensionError, extensionWarning } from "./ext-presentation"
import { ownershipFromInstall } from "../../shared/ext-ownership"
import installed from "./testvectors/d5-installed-record.json"

afterEach(() => setLocale("en"))

test("reviewed copy interpolates names, dates and counts without exposing transaction IDs", () => {
  for (const locale of ["zh", "en"] as const) {
    setLocale(locale)
    expect(t("codepuppy.ext.importAgentDone", { name: "skill-creator" })).toContain("skill-creator")
    const grant = t("codepuppy.ext.grantedMeta", { date: "2026-10-13", tx: installed.transaction.id })
    expect(grant).toContain("2026-10-13")
    expect(grant).not.toContain(installed.transaction.id)
    expect(grant).not.toMatch(/\{\{?\w+\}?\}/)
    expect(t("codepuppy.ext.warning.invalidRecords", { count: 3 })).toContain("3")
  }
})

test("curation copy follows recorded origin, including a catalog entry that has since disappeared", () => {
  // D5 installed-record is an actual committed receipt from the diagnostic run.
  expect(ownershipFromInstall(installed).curated).toBe("codepuppy")
  expect(ownershipFromInstall({ ...installed, origin: "imported" }).curated).toBe("user")
  for (const dictionary of [zh, en]) {
    expect(dictionary["codepuppy.ext.ownNote"]).toContain("Code Puppy")
    expect(dictionary["codepuppy.ext.ownNoteSelfAdded"]).not.toContain("Code Puppy")
  }
})

test("local preview refusal codes keep size, expiry and in-flight states distinct in both locales", () => {
  // Codes are emitted by local-package-preview.ts; no external payload is synthesized.
  for (const locale of ["zh", "en"] as const) {
    setLocale(locale)
    expect(extensionError(undefined, "codepuppy.ext.error.localInstall", "preview-budget-bytes")).toContain("32 MiB")
    expect(extensionError(undefined, "codepuppy.ext.error.localInstall", "preview-budget-files")).toContain("2,000")
    expect(extensionError(undefined, "codepuppy.ext.error.localInstall", "unknown-preview")).toBe(t("codepuppy.ext.error.previewExpired"))
    expect(extensionError(undefined, "codepuppy.ext.error.localInstall", "install-in-flight")).toBe(t("codepuppy.ext.error.previewBusy"))
    expect(extensionError("unrecognized diagnostic", "codepuppy.ext.error.installUnknown")).toBe(t("codepuppy.ext.error.installUnknown"))
    expect(extensionError("constructor", "codepuppy.ext.error.installUnknown", "toString")).toBe(t("codepuppy.ext.error.installUnknown"))
    expect(extensionWarning("unrecognized diagnostic")).toBe(t("codepuppy.ext.error.warningUnknown"))
  }
})

test("all customization copy retains matching interpolation parameters in Chinese and English", () => {
  for (const key of Object.keys(en).filter((key) => /^codepuppy\.(ext|builtin|cloud\.consent)\./.test(key)) as Array<keyof typeof en>) {
    const placeholders = (copy: string) => [...copy.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()
    expect(placeholders(en[key]), key).toEqual(placeholders(zh[key]))
  }
})
