import { expect, test } from "bun:test"
import { basename, join, resolve } from "node:path"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"

// SPEC-engine-config-fence AC-01 (DESIGN E1 / E2): host for process-fence-config-fence.cases.ts. The fake HOME / userData / state
// root live under the worktree's node_modules/.cache — outside every fence root (/private/tmp and $TMPDIR are writable rows).
test.skipIf(process.platform !== "darwin")("AC-01 protected configuration locations: every attack and spelling refused under the production profile, each known-bad arm lands, E2 writes keep working", async () => {
  const base = resolve(import.meta.dir, "../../../../node_modules/.cache/process-fence-config-fence")
  mkdirSync(join(base, "results"), { recursive: true })
  const run = realpathSync(mkdtempSync(join(base, "run-")))
  try {
    const child = Bun.spawn({ cmd: [process.execPath, "test", "--timeout", "180000", join(import.meta.dir, "process-fence-config-fence.cases.ts")], cwd: join(import.meta.dir, "../.."), env: { ...process.env, CODEPUPPY_CONFIG_FENCE_TEST_ROOT: run }, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    const output = `${stdout}${stderr}`
    writeFileSync(join(base, "results", `${basename(run)}.log`), output.slice(-65536))
    expect(code, output).toBe(0)
    expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("8")
    expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  } finally {
    rmSync(run, { recursive: true, force: true })
  }
}, 600_000)
