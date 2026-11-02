// Expose the RESOLVED backend endpoints to the renderer (read-only; no secrets). Lets the renderer
// stop baking the URLs and instead read main's resolution (env > pin > discovery > default), so a
// moved URL propagates without a renderer rebuild. See codepuppy-endpoints.ts.

import { ipcMain } from "electron"
import { resolveEndpoints } from "./codepuppy-endpoints"

export function registerEndpointsIpcHandlers() {
  ipcMain.handle("codepuppy-endpoints", () => resolveEndpoints())
}
