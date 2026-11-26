import { join } from "node:path"
import { engineScenario } from "./engine-scenario-host.cases.ts"

const host = {
  title: "三档 × R1–R12、三条委派入口与审批请求的整条路径与助手发起的安装(composer-tier-matrix.engine.cases.ts,30 条)",
  cases: "src/main/composer-tier-matrix.engine.cases.ts",
  pass: 30,
  args: ["--timeout", "90000"],
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
