import { expect, test } from "bun:test"
import { basename, join, resolve } from "node:path"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"

test.skipIf(process.platform !== "darwin")("workspace identity: seeding, firmlinks, honest aliases and bounded filesystem resolution", async () => {
  // The Electron Node fixture resolves the UI package's real installed dependencies.
  const base = resolve(import.meta.dir, "../../node_modules/.cache/project-writable")
  mkdirSync(join(base, "results"), { recursive: true })
  const run = realpathSync(mkdtempSync(join(base, "identity-")))
  try {
    const child = Bun.spawn({ cmd: [process.execPath, "test", "--timeout", "30000", join(import.meta.dir, "workspace-identity.cases.ts")], cwd: join(import.meta.dir, "../.."), env: { ...process.env, CODEPUPPY_IDENTITY_TEST_ROOT: run }, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    const output = `${stdout}${stderr}`
    writeFileSync(join(base, "results", `${basename(run)}.log`), output.slice(-32768))
    expect(code, output).toBe(0)
    expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("7")
    expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  } finally {
    if (existsSync(join(run, "result.json"))) copyFileSync(join(run, "result.json"), join(base, "results", `${basename(run)}-result.json`))
    rmSync(run, { recursive: true, force: true })
  }
}, 90_000)
