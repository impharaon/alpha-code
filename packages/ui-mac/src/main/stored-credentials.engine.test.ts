// SPEC-stored-credentials-fence AC-02(功能部分)/ AC-05:引擎配置每次装载之前经生产凭据通道向 main 拉整表,只在封闭位置代入;运行中换版本、删掉、
// 表与盘不同、拉取回复被扣住、main 10 秒不回复、端口关闭。宿主:真判据在 stored-credentials.engine.cases.ts(独立 bun test 子进程:嵌入式引擎 +
// 生产注入 + 真 ext + 生产 createCredentialRequester / answerCredentialsMessage)。
import { expect, test } from "bun:test"
import { join } from "node:path"

test("凭据经装载前拉取从内存表来;运行中新增 / 删除 / 表与盘不同都按表;扣住的回复不让另一 Location 用旧值;超时与端口关闭不用旧表并请求 credential-change;存放点里一项读不出不挡引擎(stored-credentials.engine.cases.ts,4 条)", async () => {
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "200000", join(import.meta.dir, "stored-credentials.engine.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  if (exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("4")
}, 400_000)
