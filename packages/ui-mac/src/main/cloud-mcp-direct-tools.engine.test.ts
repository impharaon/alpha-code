// `#1662` 换代回归:云工具是模型的直接工具,云端生图 / 数据分析的结果回到桌面(跟踪、生图卡、产物行)。
// 宿主:真判据在 cloud-mcp-direct-tools.engine.cases.ts(独立 `bun test` 子进程:沙箱里的嵌入式引擎 + 生产注入 + 真 ext + 本机云 MCP 端点)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("云工具直接可调:工具表有 codepuppy_dispatch 等、生图派发 ⇒ 跟踪 + 生图卡、数据分析派发 ⇒ 跟踪且宿主用租户凭据存下真 PNG、调用记录带 codepuppy-cloud 权威、取产物 ⇒ 产物行(cloud-mcp-direct-tools.engine.cases.ts,6 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "120000", join(import.meta.dir, "cloud-mcp-direct-tools.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("6")
}, 400_000)
