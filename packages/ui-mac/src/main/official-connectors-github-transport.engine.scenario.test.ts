import { resolve } from "node:path"
import { officialConnectorScenario } from "./official-connectors-scenario-host.cases.ts"

officialConnectorScenario(
  "github-transport",
  [
    "GitHub recipe decrypts through actual engine file substitution into HTTP headers and CONNECT permits only the official authority",
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
