import { resolve } from "node:path"
import { officialConnectorScenario } from "./official-connectors-scenario-host.cases.ts"

officialConnectorScenario(
  "convergence",
  [
    "I-11 proof 7: a project-only dbhub whose SQLite file moved stays off in its matching project after startup; back in place, convergence turns it on",
    "I-11 ruling 1: a convergence parked across a startup recovery cannot leave a stale credential clear behind",
    "I-11 official GitHub engine: off at startup, on at runtime without a restart; a failed disable write keeps the credential; later Locations follow",
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
