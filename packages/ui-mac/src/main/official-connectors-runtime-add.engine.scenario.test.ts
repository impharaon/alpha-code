import { resolve } from "node:path"
import { officialConnectorScenario } from "./official-connectors-scenario-host.cases.ts"

officialConnectorScenario("runtime-add", (pattern) =>
  Bun.spawnSync({
    cmd: [
      process.execPath,
      "test",
      "--pass-with-no-tests",
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
