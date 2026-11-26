import { expect, test } from "bun:test"

// This is the complete partition; the recipes host also rejects every name outside it.
const GROUPS = {
  convergence: [
    "I-11 proof 7: a project-only dbhub whose SQLite file moved stays off in its matching project after startup; back in place, convergence turns it on",
    "I-11 ruling 1: a convergence parked across a startup recovery cannot leave a stale credential clear behind",
    "I-11 official GitHub engine: off at startup, on at runtime without a restart; a failed disable write keeps the credential; later Locations follow",
  ],
  dbhub: [
    "DBHub 1.5.0 real stdio SELECT 1 succeeds, writes fail, only execute_sql exists, and uninstall preserves the database",
  ],
  "github-transport": [
    "GitHub recipe decrypts through actual engine file substitution into HTTP headers and CONNECT permits only the official authority",
  ],
  ipc: [
    "real IPC previews/cancels without secrets, installs both recipes, stops before cleanup and retries failed uninstall",
  ],
  recipes: [
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
  "runtime-add": [
    "review official recipe installs, changes token and toggles through runtime add without engine reload",
  ],
}

export function officialConnectorScenario(
  group: keyof typeof GROUPS,
  spawn: (pattern: string) => ReturnType<typeof Bun.spawnSync>,
) {
  test.skipIf(process.platform !== "darwin")(
    `official connectors: ${group}`,
    () => {
      const runs = [{ names: GROUPS[group], remainder: false }]
      if (group === "recipes") runs.push({ names: Object.values(GROUPS).flat(), remainder: true })
      for (const run of runs) {
        const pattern = run.names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
        const result = spawn(run.remainder ? `^(?!(?:${pattern})$)` : `^(?:${pattern})$`)
        const output = `${result.stdout.toString()}${result.stderr.toString()}`
        if (result.exitCode !== 0) throw new Error(output)
        // Bun 1.4.4 reports an empty name-pattern match as "matched 0 tests", without a pass summary.
        const pass =
          output.match(/^\s*(\d+) pass$/m)?.[1] ??
          (run.remainder ? output.match(/matched (0) tests\. Searched 1 file\b/)?.[1] : undefined)
        expect(pass, output).toBe(String(run.remainder ? 0 : run.names.length))
        if (!run.remainder) expect(output).toMatch(/\b0 fail\b/)
      }
    },
    180_000,
  )
}
