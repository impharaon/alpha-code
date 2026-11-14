// `#1669` N01:经 Code Mode 读取的暂存附件,文件卡回到 0.1.26 的「已读取」。宿主:真判据在 attachment-codemode-read.engine.cases.ts
// (独立 `bun test` 子进程:沙箱里的嵌入式引擎 + 生产注入 + 真 ext + 真 stdio MCP 读取桩 → 生产引擎适配器 → 冻结归约器 → 时间线附件读取结果)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("Code Mode 读这个附件 ⇒ 已读取;读别的文件 ⇒ 没有读取;读取被拒 ⇒ 读取失败,两条入口(attachment-codemode-read.engine.cases.ts,3 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "attachment-codemode-read.engine.cases.ts")],
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
}, 300_000)
