import { join } from "node:path"
import { engineScenario } from "./engine-scenario-host.cases.ts"

const host = {
  title:
    "项目自带「已同意」⇒ 项目插件不执行、项目 MCP 不启动;用户的记录同意 ⇒ 两样都生效;改成拒绝 ⇒ 都不再出现(project-consent-store.engine.cases.ts,2 条)",
  cases: "src/main/project-consent-store.engine.cases.ts",
  pass: 2,
  args: ["--timeout", "240000"],
  timeout: 400_000,
}

engineScenario(host, () =>
  Bun.spawn([process.execPath, "test", ...host.args, join(import.meta.dir, "../..", host.cases)], {
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  }),
)
