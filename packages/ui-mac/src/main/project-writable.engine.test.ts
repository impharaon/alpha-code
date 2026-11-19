import { expect, test } from "bun:test"
import { basename, join, resolve } from "node:path"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"

test.skipIf(process.platform !== "darwin")("V3/V4/V5 real engine, fence and main grant wiring", async () => {
  const base = resolve(import.meta.dir, "../../../../node_modules/.cache/project-writable")
  mkdirSync(join(base, "results"), { recursive: true })
  const run = realpathSync(mkdtempSync(join(base, "project-writable.engine-")))
  try {
    const child = Bun.spawn({ cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "project-writable.engine.cases.ts")], cwd: join(import.meta.dir, "../.."), env: { ...process.env, CODEPUPPY_WRITABLE_TEST_ROOT: run }, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    const output = `${stdout}${stderr}`
    writeFileSync(join(base, "results", `${basename(run)}.log`), output.slice(-32768))
    expect(code, output).toBe(0)
    expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("9")
    expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  } finally {
    for (const file of ["proof.json", "events.json", "result.json"]) if (existsSync(join(run, file))) copyFileSync(join(run, file), join(base, "results", `${basename(run)}-${file}`))
    rmSync(run, { recursive: true, force: true })
  }
}, 300_000)
