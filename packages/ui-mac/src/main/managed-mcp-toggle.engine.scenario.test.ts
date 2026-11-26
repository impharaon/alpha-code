import { join } from "node:path"
import { engineScenario } from "./engine-scenario-host.cases.ts"

const host = {
  title: "managed MCP toggles converge per connector on the real engine with production injection and the real ext",
  cases: "test-component/managed-mcp-toggle.engine.cases.ts",
  pass: 7,
  args: ["--timeout", "180000"],
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
