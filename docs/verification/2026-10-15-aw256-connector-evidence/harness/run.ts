// Manual, explicitly authorized live evidence run. Exclusive results: never overwrite a run.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { Database } from "bun:sqlite"

const web = resolve(process.argv[2]!)
const electron = resolve(process.argv[3]!)
const host = resolve(import.meta.dir, "../../../..")
const directory = resolve(import.meta.dir, "..")
const results = join(directory, "results")
const sha256 = (bytes: Uint8Array | string) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
const save = (name: string, value: unknown) => {
  const text = JSON.stringify(value, null, 2) + "\n"
  assert.ok(!text.includes("github_pat_"), "SECRET_SCAN_REJECTED")
  writeFileSync(join(results, name), text, { flag: "wx" })
}
const git = (cwd: string, ...args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd })
  assert.equal(result.exitCode, 0)
  return result.stdout.toString().trim()
}
assert.equal(git(web, "rev-parse", "HEAD"), git(web, "rev-parse", "origin/main"))
assert.equal(git(web, "status", "--porcelain"), "")
assert.equal((await Bun.file(join(host, "packages/ui-mac/package.json")).json()).version, "0.1.20")
mkdirSync(results)
const temporary = mkdtempSync(join(directory, ".tmp-run-"))
const { canonicalJsonBytes } = await import(pathToFileURL(join(web, "scripts/lib/catalog-intake-core.mjs")).href)
const { catalogRuntimeDigest } = await import(pathToFileURL(join(web, "scripts/lib/curation-gate.mjs")).href)
const baseline = { startedAt: new Date().toISOString(), hostVersion: "0.1.20", hostCommit: git(host, "rev-parse", "HEAD"),
  declarationCommit: git(web, "rev-parse", "HEAD"), bunVersion: Bun.version, packages: [] as unknown[] }
try {
  for (const name of ["github-official", "dbhub-readonly"]) {
    const source = `catalog-src/packages/package.${name}/1.0.0`
    for (const action of ["validate", "preview"]) {
      const result = Bun.spawnSync(["node", "scripts/package-declaration.mjs", action, source], { cwd: web })
      assert.equal(result.exitCode, 0, result.stderr.toString())
      save(`${name}-${action}.json`, JSON.parse(result.stdout.toString()))
    }
    const preview = await Bun.file(join(results, `${name}-preview.json`)).json()
    const bytes = canonicalJsonBytes(preview.payloads[preview.envelope.root])
    assert.equal(sha256(bytes), preview.envelope.components[0].payloadRef.sha256)
    assert.ok(!bytes.toString().includes("github_pat_"))
    writeFileSync(join(results, `${name}-payload.json`), bytes, { flag: "wx" })
    baseline.packages.push({ name, packageId: preview.envelope.prelude.packageId, version: "1.0.0",
      digest: catalogRuntimeDigest(preview.envelope), payloadSha256: sha256(bytes), payloadBytes: bytes.length })
  }
  mkdirSync(join(temporary, "database"))
  const database = join(temporary, "database", "aw256.db")
  const db = new Database(database, { create: true })
  db.exec("PRAGMA user_version = 256")
  db.close()
  save("sqlite-created.json", { source: "fresh bun:sqlite database; no imported data or fabricated provider response",
    initialization: "PRAGMA user_version = 256", path: database, bytes: readFileSync(database).length,
    sha256: sha256(readFileSync(database)) })
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "install.ts")], outdir: temporary,
    target: "node", format: "esm", external: ["electron", "jsonc-parser"], naming: "install.mjs" })
  assert.ok(built.success, String(built.logs))
  symlinkSync(join(host, "packages/ui-mac/node_modules"), join(temporary, "node_modules"))
  writeFileSync(join(temporary, "bootstrap.cjs"), `const { app } = require("electron");
app.setName("Alpha AW256 Evidence");
app.setPath("userData", require("node:path").join(__dirname, "electron"));
const fail = error => { console.error(String(error).replace(/github_pat_[A-Za-z0-9_]+/g, "[REDACTED]")); app.exit(1); };
process.on("uncaughtException", fail);
import("./install.mjs").catch(fail);
`)
  const input = join(temporary, "input.json")
  writeFileSync(input, JSON.stringify({ results, temporary, database, baseline, bun: process.execPath,
    liveScript: join(import.meta.dir, "live.ts"), tokenPath: "/Users/tide/.config/code-puppy-verify/github-ro.token" }))
  const child = Bun.spawn([electron, join(temporary, "bootstrap.cjs"), input], {
    env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: "en_US.UTF-8" }, stdout: "pipe", stderr: "pipe" })
  const output = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  save("electron-process.json", { stdout: output[0], stderr: output[1], status: output[2] })
  assert.equal(output[2], 0, "installation/live run failed; see sanitized results")
  assert.equal((await Bun.file(join(results, "live-process.json")).json()).status, 0)
} finally {
  rmSync(temporary, { recursive: true, force: true })
  save("cleanup.json", { temporaryRootRemoved: temporary, databaseRemoved: true, completedAt: new Date().toISOString(),
    alphaWebWorktreeUnchanged: git(web, "status", "--porcelain") === "" })
}
