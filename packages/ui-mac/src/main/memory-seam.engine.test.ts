// `#1662` parity 第 4 项(ADR-045 接缝的前提探针):注入配置的 instructions 文件在嵌进 sidecar 的 OpenCode 2 上进上下文、删掉即不再生效。
// 宿主:真判据在 memory-seam.engine.cases.ts(独立 `bun test` 子进程:沙箱真引擎 + 本机模型桩)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("ADR-045 接缝在 OpenCode 2 上:进上下文、改写即更新、删掉即不再生效;不列进配置 ⇒ 0 段(memory-seam.engine.cases.ts,2 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "memory-seam.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("2")
}, 300_000)
