import { join } from "node:path"
import { engineScenario } from "./engine-scenario-host.cases.ts"

const host = {
  title: "项目配置视图:九类、纯内容、两目录、热重载与停用作用点;D6 原生来源开关 / 移除 / 重新加入与项目信任(project-config-view.engine.cases.ts,11 条)",
  cases: "src/main/project-config-view.engine.cases.ts",
  pass: 11,
  args: ["--timeout", "120000"],
  timeout: 180_000,
}

engineScenario(host, () =>
  Bun.spawn([process.execPath, "test", ...host.args, join(import.meta.dir, "../..", host.cases)], {
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  }),
)
