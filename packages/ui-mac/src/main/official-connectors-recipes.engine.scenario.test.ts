import { resolve } from "node:path"
import { officialConnectorScenario } from "./official-connectors-scenario-host.cases.ts"

officialConnectorScenario(
  "recipes",
  [
    "closed recipe and capability reject altered endpoint, argv, secret, auth and unknown recipe before installation",
    "encrypted HOME, 0600 ephemeral refs, no sidecar env values, restart and full cleanup preserve SQLite",
    "missing/ref-injected secrets, non-SQLite DSN, unavailable encryption and symlinked resources fail closed",
    "deleted registered workspace does not block either recipe at installation",
    "real admission commits remote truth plus encrypted resource; failed replacement restores both and successful reentry retires old version",
    "desktop official package without an encrypted token stays pending after runtime restoration",
    "desktop SQLite package without a DSN keeps an engine-visible definition across restarts and loads once the DSN is saved",
    "desktop official install and credential replacement do not publish a reserved remote name",
    "prepared journal crash recovery removes only uncommitted official versions",
    "actual Node >=22.5, HOME/workspace exclusion, protected cwd and template tampering are enforced",
    "package-owned encrypted token replacement retires the old version and a failed ledger commit preserves the current value",
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
