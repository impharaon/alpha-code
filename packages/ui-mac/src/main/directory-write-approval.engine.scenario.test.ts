// SPEC child-process-write-fence v7 AC-13 (design v6 §6): host for directory-write-approval.engine.cases.ts. The fence is
// installed in the engine child for its lifetime, so the cases run in their own `bun test` process; evidence (main and
// engine logs, the model's requests) is copied next to the results.
import { expect, test } from "bun:test"
import { basename, join, resolve } from "node:path"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"

test.skipIf(process.platform !== "darwin")("AC-13 after-the-fact folder approval on the real engine, fence, ext and main", async () => {
  const base = resolve(import.meta.dir, "../../../../node_modules/.cache/directory-write-approval")
  mkdirSync(join(base, "results"), { recursive: true })
  const run = realpathSync(mkdtempSync(join(base, "run-")))
  try {
    const child = Bun.spawn({ cmd: [process.execPath, "test", "--timeout", "180000", join(import.meta.dir, "directory-write-approval.engine.cases.ts")], cwd: join(import.meta.dir, "../.."), env: { ...process.env, CODEPUPPY_APPROVAL_TEST_ROOT: run }, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    const output = `${stdout}${stderr}`
    writeFileSync(join(base, "results", `${basename(run)}.log`), output.slice(-65536))
    expect(code, output).toBe(0)
    expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("7")
    expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  } finally {
    for (const file of ["main.log", "engine.log", "model-requests.json"]) if (existsSync(join(run, file))) copyFileSync(join(run, file), join(base, "results", `${basename(run)}-${file}`))
    rmSync(run, { recursive: true, force: true })
  }
}, 600_000)
