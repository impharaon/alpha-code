import { expect, test } from "bun:test"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"

// G0 owns the isolated cases process: neither a native preflight nor an unsigned run can pass this host.
test.skipIf(process.platform !== "darwin" || process.env.CODEPUPPY_TEST_SIGNED_FENCE !== "1")("G0: signed packaged main grants the running production utilityProcess and its children", async () => {
  const base = resolve(import.meta.dir, "../../../../node_modules/.cache/project-writable")
  mkdirSync(join(base, "results"), { recursive: true })
  const run = realpathSync(mkdtempSync(join(base, "signed-fence-")))
  try {
    const child = Bun.spawn({
      cmd: [process.execPath, "test", "--timeout", "1800000", join(import.meta.dir, "process-fence-extension-packaged.cases.ts")],
      cwd: join(import.meta.dir, "../.."), env: { ...process.env, CODEPUPPY_G0_ROOT: run }, stdout: "pipe", stderr: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    const output = `${stdout}${stderr}`
    writeFileSync(join(base, "results", `${basename(run)}.log`), output.slice(-32768))
    console.log(output)
    expect(code, output).toBe(0)
    expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("3")
    expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  } finally {
    for (const entry of readdirSync(run, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      for (const file of ["result.json", "signing.json", "window/window-result.json", "window/signing.json"]) {
        const source = join(run, entry.name, file)
        if (existsSync(source)) copyFileSync(source, join(base, "results", `${basename(run)}-${file.replaceAll("/", "-")}`))
      }
      for (const file of ["verify.log", "signature.log", "entitlements.log", "runtime.log", "unregister.log", "window/unregister.log"]) {
        const source = join(run, entry.name, file)
        if (existsSync(source)) writeFileSync(join(base, "results", `${basename(run)}-${file.replaceAll("/", "-")}`), readFileSync(source, "utf8").slice(-32768))
      }
    }
    rmSync(run, { recursive: true, force: true })
  }
}, 2_200_000)
