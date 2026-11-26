import { resolve } from "node:path"
import { officialConnectorScenario } from "./official-connectors-scenario-host.cases.ts"

officialConnectorScenario(
  "ipc",
  [
    "real IPC previews/cancels without secrets, installs both recipes, stops before cleanup and retries failed uninstall",
  ],
  (pattern) =>
    Bun.spawnSync({
      cmd: [
        process.execPath,
        "test",
        "--max-concurrency",
        "2",
        "--test-name-pattern",
        pattern,
        resolve(import.meta.dir, "../../test-component/official-connectors.cases.ts"),
      ],
      cwd: resolve(import.meta.dir, "../.."),
      env: process.env,
    }),
)
