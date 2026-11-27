import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { packageManagerScanSource } from "../engine/package-manager-scan-transform"

export const PACKAGE_MANAGER_SCANNER = "virtual:codepuppy-shell-scan"
export const PACKAGE_MANAGER_SCANNER_SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), "../../core/src/shell/scan.ts")

export function packageManagerScannerCode() {
  const select = readFileSync(resolve(dirname(PACKAGE_MANAGER_SCANNER_SOURCE), "select.ts"), "utf8")
  const name = /export function name\(file: string\) \{\n  if \(process.platform === "win32"\)[^\n]*\n(  return [^\n]+)\n\}/.exec(select)
  if (!name) throw new Error("ShellSelect.name POSIX projection moved")
  // The permission authority's shell classes (ShellSelect META/ps), projected rather than restated.
  const meta = /\nconst META: Record<string, \{[^}]*\}> = \{\n[\s\S]*?\n\}\n/.exec(select)
  if (!meta || !select.includes("export function ps(file: string) {\n  return meta(file)?.ps === true\n}")) throw new Error("ShellSelect.ps projection moved")
  return `import path from "node:path"\n${packageManagerScanSource(readFileSync(PACKAGE_MANAGER_SCANNER_SOURCE, "utf8"))}\nexport function shellName(file: string) {\n${name[1]}\n}${meta[0]}export function shellPs(file: string) {\n  return META[shellName(file)]?.ps === true\n}\n`
}

export function packageManagerScannerPlugin() {
  // No "\0" prefix: vite's TypeScript transform skips "\0" ids, and this module is the scanner's TypeScript source.
  const module = "/virtual/codepuppy-shell-scan.ts"
  return {
    name: "codepuppy:package-manager-scanner",
    enforce: "pre" as const,
    resolveId(id: string) { if (id === PACKAGE_MANAGER_SCANNER) return module },
    load(id: string) { if (id === module) return packageManagerScannerCode() },
  }
}
