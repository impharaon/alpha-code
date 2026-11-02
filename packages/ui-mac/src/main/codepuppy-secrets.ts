import * as fs from "node:fs"
import * as path from "node:path"
import { USER_DATA_LAYOUT } from "./user-data-layout"

// alpha-code secrets loader. Reads a plain KEY=VALUE file (".env" style) at main-process startup
// and fills any MISSING environment variables from it -- so app users can keep their API keys
// (EXA_API_KEY, PARALLEL_API_KEY, DEEPSEEK_API_KEY, ZHIPU_API_KEY, ...) in ONE file instead of
// exporting them in ~/.zshrc. Called from preferAppEnv() BEFORE the sidecar is forked, so the
// values ride into opencode through the same process.env the sidecar inherits (createSidecarEnv).
//
// Discipline (ADR-005/006/007): alpha's OWN file, zero upstream change. opencode itself does NOT
// read .env files; this is the alpha shim that bridges a file into process.env.
//
// Precedence (strongest first): a real shell `export` > $CODEPUPPY_ENV_FILE > <userData>/codepuppy.env.
// We NEVER overwrite a variable that is already set, so shell exports always win and earlier files
// win over later ones.
//
// File format: one `KEY=VALUE` per line. Blank lines and `#` comments are ignored. A leading
// `export ` is tolerated. Surrounding single/double quotes are stripped. Example codepuppy.env:
//   EXA_API_KEY=exa_xxx
//   DEEPSEEK_API_KEY=sk-xxx
//   # OPENCODE_WEBSEARCH_PROVIDER=exa   # pin the provider, optional
//
// Escape hatch: CODEPUPPY_SECRETS_DISABLE=1 skips loading entirely.

type SecretsLogger = { log: (message: string) => void }

export function loadCodePuppySecrets(userDataPath: string, logger?: SecretsLogger) {
  if (process.env.CODEPUPPY_SECRETS_DISABLE) return

  const candidates = [
    process.env.CODEPUPPY_ENV_FILE,
    path.join(userDataPath, USER_DATA_LAYOUT.envFile),
  ].filter((value): value is string => Boolean(value))

  for (const file of candidates) {
    let text: string
    try {
      text = fs.readFileSync(file, "utf8")
    } catch {
      continue // missing / unreadable -> try the next candidate
    }
    const count = applyEnvFile(text)
    logger?.log(`[server] Loaded ${count} secret(s) from ${file}`)
  }
}

function applyEnvFile(text: string): number {
  let count = 0
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    if (line.startsWith("export ")) line = line.slice("export ".length).trim()
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    if (!key || process.env[key]) continue // never override an already-set variable (shell wins)
    let value = line.slice(eq + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    )
      value = value.slice(1, -1)
    process.env[key] = value
    count++
  }
  return count
}
