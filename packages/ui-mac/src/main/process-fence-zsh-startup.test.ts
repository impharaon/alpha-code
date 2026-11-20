import { expect, test } from "bun:test"
import { basename, join, resolve } from "node:path"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"

// SPEC-engine-config-fence AC-07: host for process-fence-zsh-startup.cases.ts (fake HOME outside every fence root).
test.skipIf(process.platform !== "darwin")("AC-07 fenced writes to ~/.zsh_sessions and ~/.zcompdump: known bad lands and runs, production refuses, app terminal unchanged", async () => {
  const base = resolve(import.meta.dir, "../../../../node_modules/.cache/process-fence-zsh-startup")
  mkdirSync(join(base, "results"), { recursive: true })
  const run = realpathSync(mkdtempSync(join(base, "run-")))
  try {
    const child = Bun.spawn({ cmd: [process.execPath, "test", "--timeout", "120000", join(import.meta.dir, "process-fence-zsh-startup.cases.ts")], cwd: join(import.meta.dir, "../.."), env: { ...process.env, CODEPUPPY_ZSH_STARTUP_TEST_ROOT: run }, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    const output = `${stdout}${stderr}`
    writeFileSync(join(base, "results", `${basename(run)}.log`), output.slice(-32768))
    expect(code, output).toBe(0)
    expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("5")
    expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  } finally {
    rmSync(run, { recursive: true, force: true })
  }
}, 300_000)
