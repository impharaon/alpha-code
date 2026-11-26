import { join } from "node:path"
import { engineScenario } from "./engine-scenario-host.cases.ts"

const host = {
  title: "经包运行器启动的本地 MCP 首次下载超过默认握手时长仍能连上,坏的给出具名失败(真引擎)",
  cases: "src/main/runner-mcp-startup.engine.cases.ts",
  pass: 1,
  args: ["--timeout", "180000"],
  timeout: 300_000,
}

engineScenario(host, () =>
  Bun.spawn([process.execPath, "test", ...host.args, join(import.meta.dir, "../..", host.cases)], {
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  }),
)
