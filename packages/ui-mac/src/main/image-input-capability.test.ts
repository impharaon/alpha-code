// REQ-228 `#1420` 在 OpenCode 2 上(`#1662` parity B5):「这个模型能不能看图」走到真引擎的最终值。
// 宿主:真判据在 image-input-capability.engine.cases.ts(独立 `bun test` 子进程:沙箱里的嵌入式引擎 + 生产注入的模型目录)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("真引擎的 capabilities.input.image:直连按目录、平台一律不能、自定义只认用户声明;删掉注入的输入能力 ⇒ 全部退回不能(image-input-capability.engine.cases.ts,2 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "120000", join(import.meta.dir, "image-input-capability.engine.cases.ts")],
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
