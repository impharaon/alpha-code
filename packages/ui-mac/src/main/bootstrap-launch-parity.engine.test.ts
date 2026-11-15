// `#1698`(DESIGN-upgrade-bootstrap-config,计划段 0):一次代表性启动里 main 交给 sidecar / ext / 引擎的决定,经真启动装配被观察到的
// 样子,与钉住的 bootstrap-launch-parity.record.json 逐项相同。启动配置迁移的各段只改 cases 里「sidecar 这一步」的接法,记录文件不改。
// 宿主:真判据在 bootstrap-launch-parity.engine.cases.ts(独立 `bun test` 子进程:main 的 preferAppEnv + spawnLocalServer 假 fork,
// 生产注入,沙箱里的嵌入式引擎 + 真 ext,本机模型桩与云 MCP 桩)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("决定记录:路径、通道、围栏、start() 选项、注入文档、引擎里的 ext / 供应商 / 云 MCP / 账户分区 / 出网归类、两个凭据头(bootstrap-launch-parity.engine.cases.ts,1 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "120000", join(import.meta.dir, "bootstrap-launch-parity.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("1")
}, 300_000)
