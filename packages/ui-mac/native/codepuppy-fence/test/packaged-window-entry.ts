// Keep loader failures out of Electron's modal exception dialog in an unattended test copy.
import { app } from "electron"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
const fail = (error: unknown) => {
  writeFileSync(
    join(process.env.CODEPUPPY_WINDOW_RUN!, "window-result.json"),
    JSON.stringify({ error: error instanceof Error ? error.stack : String(error) }, null, 2),
  )
  app.exit(1)
}
process.on("uncaughtException", fail)
process.on("unhandledRejection", fail)
void import("./packaged-window-main").catch(fail)
