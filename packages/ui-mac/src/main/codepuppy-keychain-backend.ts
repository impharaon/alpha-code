// The ONLY place alpha's key store (codepuppy-byok-keys.ts) touches Electron's safeStorage — REQ-226 `#1343`.
//
// Namespace import on purpose. bun's `mock.module("electron", …)` fixes the module's export-NAME set at the
// FIRST factory instantiated in the test process; later factories only update the values of those names and
// silently drop new ones (probe 2026-09-17: first factory `{a}`, second `{a, b}` ⇒ `import { b }` throws
// "Export named 'b' not found", namespace `.b` is undefined; bun's file order is not CLI order). With a named
// `import { safeStorage } from "electron"` every in-process consumer of the store would therefore link or
// fail depending on which unrelated test file's electron mock ran first. A namespace import always links;
// tests mock THIS module (one function, a key set we own) and the real store logic runs on top of it.
// Absent backend (no Electron, or a mock without safeStorage) ⇒ `undefined` ⇒ the store refuses (fail closed).
//
// `#1667`: and the import is LAZY (resolved on the first call, not when this module loads). An eager import — even a
// namespace one — instantiates the REAL electron module in any test process that merely imports this module's
// importers (codepuppy-config-injection → ext-disabled-injection → ext-curation-policy → remote-catalog →
// package-installability → official-connector-recipes → here). The real module is CJS whose only export is the binary
// path, so bun pins electron's export-name set to `{ default }`; every LATER test file's `mockElectron(...)` then
// cannot add `app` & co., and their `import { app } from "electron"` fails to link ("Export named 'app' not found",
// reported as an unhandled error between tests — seen when the config-injection tests run before
// codepuppy-sidecar-wiring / sidecar-stop / server in one `bun test`). `createRequire` honors `mock.module` (probed),
// and main's ESM bundle already carries the same createRequire shim (electron.vite.config.ts banner).

import { createRequire } from "node:module"
import type * as Electron from "electron"

export type KeychainBackend = Pick<typeof Electron.safeStorage, "isEncryptionAvailable" | "encryptString" | "decryptString">

const requireModule = createRequire(import.meta.url)

export function keychainBackend(): KeychainBackend | undefined {
  return (requireModule("electron") as typeof Electron).safeStorage
}
