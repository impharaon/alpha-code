import { resolve } from "node:path"
import { officialConnectorScenario } from "./official-connectors-scenario-host.cases.ts"

officialConnectorScenario(
  "dbhub",
  [
    "DBHub 1.5.0 real stdio SELECT 1 succeeds, writes fail, only execute_sql exists, and uninstall preserves the database",
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
