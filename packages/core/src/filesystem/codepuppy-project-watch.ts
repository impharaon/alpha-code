/**
 * Project-wide file change events (#1662 L4 Unit F; UI parity with the current release). Code Puppy 0.1.26 watched the
 * whole project, so files created or edited outside the app reached the file panel; OpenCode 2's LocationWatcher
 * watches only the VCS branch file. The re-taken packages/core/src/filesystem/location-watcher.ts adds one recursive
 * directory watch on the Location's folder when this switch is on, using what is defined here.
 *
 * The switch (`#1698`): the bootstrap document's `engine.filewatcher`, which the desktop main process judges once from
 * OPENCODE_EXPERIMENTAL_FILEWATCHER (on unless the user exported an off value; owner decision B12) — the same value that turns the
 * engine's own watcher on. Only a host without a document (the in-repo CLI) reads the variable, through the one compatibility
 * reader `codepuppyEngineSettings` (packages/util/src/codepuppy-bootstrap.ts). The ignore list is 0.1.26's
 * (`packages/core/src/filesystem/ignore.ts` before the switch to OpenCode 2), plus the configured `watcher.ignore` entries, plus
 * the home folder's protected directories when the Location is home.
 */
import { DOCUMENT_WORK_DIR } from "@opencode/util/codepuppy-document"
import { Protected } from "./protected.js"

const FOLDERS = [
  DOCUMENT_WORK_DIR,
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
