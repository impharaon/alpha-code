// `#1449` AC1 / `#1445` AC1(ADR-035 E7)在 OpenCode 2 上(`#1662` parity 第 1、2 项):Exa 的四种结局在模型面各是一句不同的话。
// 宿主:真判据在 websearch-honest.engine.cases.ts(独立 `bun test` 子进程:沙箱里的嵌入式引擎 + 生产注入 + 真 ext + 实抓件,不出网)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("Exa 结局诚实:出错 ⇒ 具名失败、D ⇒ 原文、零命中 ⇒ 没搜到、429 ⇒ 具名失败,两两不同;不装 ext ⇒ 塌成没搜到(websearch-honest.engine.cases.ts,7 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "websearch-honest.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("7")
}, 300_000)
