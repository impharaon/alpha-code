/**
 * Project-wide file change events (#1662 L4 Unit F; UI parity with the current release). Code Puppy 0.1.26 watched the
 * whole project, so files created or edited outside the app reached the file panel; OpenCode 2's LocationWatcher
 * watches only the VCS branch file. The re-taken packages/core/src/filesystem/location-watcher.ts adds one recursive
 * directory watch on the Location's folder when this switch is on, using what is defined here.
 *
 * The switch is the one 0.1.26 used and main still writes: ui-mac `src/main/server.ts` sets
 * `OPENCODE_EXPERIMENTAL_FILEWATCHER` to "true" unless the user exported another value (owner decision B12, recorded
 * there). The ignore list is 0.1.26's (`packages/core/src/filesystem/ignore.ts` before the switch to OpenCode 2), plus
 * the configured `watcher.ignore` entries, plus the home folder's protected directories when the Location is home.
 */
import { Protected } from "./protected.js"

export const PROJECT_WATCH_ENV = "OPENCODE_EXPERIMENTAL_FILEWATCHER"

/** Whether main turned the project watch on (the boolean spellings Effect's Config.boolean accepts). */
export function projectWatchEnabled(env: Record<string, string | undefined>): boolean {
  return ["true", "1", "yes", "on"].includes((env[PROJECT_WATCH_ENV] ?? "").trim().toLowerCase())
}

const FOLDERS = [
  "node_modules",
  "bower_components",
  ".pnpm-store",
  "vendor",
  ".npm",
  "dist",
  "build",
  "out",
  ".next",
  "target",
  "bin",
  "obj",
  ".git",
  ".svn",
  ".hg",
  ".vscode",
  ".idea",
  ".turbo",
  ".output",
  "desktop",
  ".sst",
  ".cache",
  ".webkit-cache",
  "__pycache__",
  ".pytest_cache",
  "mypy_cache",
  ".history",
  ".gradle",
]

const FILES = [
  "**/*.swp",
  "**/*.swo",
  "**/*.pyc",
  "**/.DS_Store",
  "**/Thumbs.db",
  "**/logs/**",
  "**/tmp/**",
  "**/temp/**",
  "**/*.log",
  "**/coverage/**",
  "**/.nyc_output/**",
]

/** What the project watch skips (Parcel ignore entries: folder names and globs, as 0.1.26 passed them). */
export function projectWatchIgnore(directory: string, configured: readonly string[]): string[] {
  return [...FILES, ...FOLDERS, ...configured, ...(Protected.isHome(directory) ? Protected.names() : [])]
}
