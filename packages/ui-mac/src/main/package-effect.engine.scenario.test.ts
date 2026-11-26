import { join } from "node:path"
import { engineScenario } from "./engine-scenario-host.cases.ts"

const host = {
  title: "package effect isolation uses real engines and the config debounce window",
  cases: "src/main/package-effect.engine.cases.ts",
  pass: 5,
  args: ["--max-concurrency", "2", "--timeout", "180000"],
  timeout: 480_000,
}

engineScenario(host, () =>
  Bun.spawn([process.execPath, "test", ...host.args, join(import.meta.dir, "../..", host.cases)], {
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  }),
)
