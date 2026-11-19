// Write-refusal model stop instruction, without a causal claim or UI marker. Real evidence lives in the isolated cases child.
// (独立 `bun test` 子进程:整个进程装真围栏 + 真引擎 + 真 ext + 本机模型桩;围栏装上不能拆,所以必须是子进程)。
import { expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const describeDarwin = process.platform === "darwin"

test.skipIf(!describeDarwin)("沙箱拒写:写文件工具与 shell 两条路径 + 项目外目标 + 可写项目对照(fence-write-denied.engine.cases.ts,4 条)", async () => {
  const root = join(process.env.CODEPUPPY_TEST_REAL_HOME ?? homedir(), ".cache/alpha-orch/2026-11-19/impl-project-writable")
  mkdirSync(root, { recursive: true })
  const scratch = mkdtempSync(join(root, "write-refusal-"))
  try {
    const child = Bun.spawn({
      cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "fence-write-denied.engine.cases.ts")],
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, CODEPUPPY_WRITE_REFUSAL_ROOT: scratch },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    const output = `${stdout}${stderr}`
    if (exitCode !== 0) throw new Error(output)
    expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
    expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("4")
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}, 300_000)
