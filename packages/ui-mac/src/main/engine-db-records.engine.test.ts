// SPEC-engine-config-fence AC-03 host. The evidence is engine-db-records.engine.cases.ts, run as a separate `bun test`
// child: the whole child installs the production fence profile and the real .node (it cannot be removed again), then runs
// the real engine, real ext and a local model stub. Darwin only, as the fence is.
import { expect, test } from "bun:test"
import { rmSync } from "node:fs"
import { join } from "node:path"

test.skipIf(process.platform !== "darwin")("引擎库里植入的已存批准、会话行 allow、wellknown 缓存文档都不生效(engine-db-records.engine.cases.ts,3 条)", async () => {
  const scratch = join(import.meta.dir, "../../node_modules/.cache/engine-db-records")
  try {
    const child = Bun.spawn({
      cmd: [process.execPath, "test", "--timeout", "120000", join(import.meta.dir, "engine-db-records.engine.cases.ts")],
      cwd: join(import.meta.dir, "../.."),
      env: { ...process.env, CODEPUPPY_WRITE_REFUSAL_ROOT: scratch },
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
}, 420_000)
