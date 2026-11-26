import { join } from "node:path"
import { engineScenario } from "./engine-scenario-host.cases.ts"

const host = {
  title:
    "I-12 / #1713 未允许与允许两臂:opencode.json 的 mcp / formatter / shell / commands / 模型级 package / 插件指令 / md 文件头的执行时点(project-config-commands.engine.cases.ts,28 条)",
  cases: "src/main/project-config-commands.engine.cases.ts",
  pass: 28,
  args: ["--timeout", "120000"],
  timeout: 600_000,
}

engineScenario(host, () =>
  Bun.spawn([process.execPath, "test", ...host.args, join(import.meta.dir, "../..", host.cases)], {
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  }),
)
