import { join } from "node:path"
import { engineScenario } from "./engine-scenario-host.cases.ts"

const host = {
  title: "对话联网批准：真引擎、真围栏、站点记忆、即时撤销与模型说明",
  cases: "src/main/network-egress.engine.cases.ts",
  pass: process.platform === "darwin" ? 6 : 0,
  args: ["--max-concurrency", "2", "--timeout", "90000"],
  timeout: 240_000,
}

engineScenario(host, () =>
  Bun.spawn([process.execPath, "test", ...host.args, join(import.meta.dir, "../..", host.cases)], {
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  }),
)
