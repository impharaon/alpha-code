// 0.2.4 验收第三轮 Unit 1 跟进:沙箱拒写的直说结果与只读标记。宿主:真判据在 fence-write-denied.engine.cases.ts
// (独立 `bun test` 子进程:整个进程装真围栏 + 真引擎 + 真 ext + 本机模型桩;围栏装上不能拆,所以必须是子进程)。
import { expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { join } from "node:path"

const describeDarwin = process.platform === "darwin"

test.skipIf(!describeDarwin)("沙箱拒写:写文件工具与 shell 两条路径 + 可写项目对照(fence-write-denied.engine.cases.ts,3 条)", async () => {
  const scratch = join(import.meta.dir, "../../node_modules/.cache/fence-write-denied")
  try {
    const child = Bun.spawn({
      cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "fence-write-denied.engine.cases.ts")],
      cwd: join(import.meta.dir, "../.."),
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    const output = `${stdout}${stderr}`
    if (exitCode !== 0) throw new Error(output)
    expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
    expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("3")
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}, 300_000)
