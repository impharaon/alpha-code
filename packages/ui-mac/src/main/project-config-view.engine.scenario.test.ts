import { expect, test } from "bun:test"
import { join } from "node:path"
test("项目配置视图:九类、纯内容、两目录、热重载与停用作用点(project-config-view.engine.cases.ts,9 条)", async () => {
  const child = Bun.spawn({
    cmd: [
      process.execPath,
      "test",
      "--timeout",
      "120000",
      join(import.meta.dir, "project-config-view.engine.cases.ts"),
    ],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const output = stdout + stderr
  if (code !== 0) throw new Error(output)
  expect(output).toMatch(/\b9 pass\b/)
  expect(output).toMatch(/\b0 fail\b/)
}, 180_000)
