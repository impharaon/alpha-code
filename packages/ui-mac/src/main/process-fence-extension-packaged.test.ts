import { expect, test } from "bun:test"
import { mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// G0 owns the isolated cases process: neither a native preflight nor an unsigned run can pass this host.
test.skipIf(process.platform !== "darwin")("G0: signed packaged main grants the running production utilityProcess and its children", async () => {
  const scratch = process.env.CODEPUPPY_G0_ROOT ?? join(process.env.CODEPUPPY_TEST_REAL_HOME ?? homedir(), ".cache/alpha-orch/2026-11-19/impl-project-writable")
  mkdirSync(scratch, { recursive: true })
  const child = Bun.spawn({
    cmd: [process.execPath, "test", "--timeout", "1800000", join(import.meta.dir, "process-fence-extension-packaged.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: { ...process.env, CODEPUPPY_G0_ROOT: scratch },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = `${stdout}${stderr}`
  console.log(output)
  expect(code, output).toBe(0)
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("3")
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
}, 2_200_000)
