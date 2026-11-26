import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { packageManagerScanSource } from "../engine/package-manager-scan-transform"

export const PACKAGE_MANAGER_SCANNER = "virtual:codepuppy-shell-scan"
export const PACKAGE_MANAGER_SCANNER_SOURCE = resolve(import.meta.dirname, "../../core/src/shell/scan.ts")

export function packageManagerScannerCode() {
  const select = readFileSync(resolve(dirname(PACKAGE_MANAGER_SCANNER_SOURCE), "select.ts"), "utf8")
  const name = /export function name\(file: string\) \{\n  if \(process.platform === "win32"\)[^\n]*\n(  return [^\n]+)\n\}/.exec(select)
  if (!name) throw new Error("ShellSelect.name POSIX projection moved")
  return `import path from "node:path"\n${packageManagerScanSource(readFileSync(PACKAGE_MANAGER_SCANNER_SOURCE, "utf8"))}\nexport function shellName(file: string) {\n${name[1]}\n}`
}

export function packageManagerScannerPlugin() {
  const module = "\0codepuppy-shell-scan.ts"
  return {
    name: "codepuppy:package-manager-scanner",
    enforce: "pre" as const,
    resolveId(id: string) { if (id === PACKAGE_MANAGER_SCANNER) return module },
    load(id: string) { if (id === module) return packageManagerScannerCode() },
  }
}
