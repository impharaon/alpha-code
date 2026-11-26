import { afterEach, expect, test } from "bun:test"
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { createSecretFiles, sourceVersion } from "./secret-files"
import { ProtectedFiles } from "../../schema/src/codepuppy-protected-files"

const owned: string[] = []
const fixture = (name: string) => new URL(`./fixtures/secret-files/${name}`, import.meta.url)
afterEach(async () => {
  for (const root of owned.splice(0)) await rm(root, { recursive: true, force: true })
})
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "secret-files-"))
  owned.push(root)
  await mkdir(path.join(root, "project"))
  await mkdir(path.join(root, "home"))
  const roots: ProtectedFiles.ProtectedRoots = {
    platform: "darwin",
    project: path.join(root, "project"),
    directory: path.join(root, "project"),
    home: path.join(root, "home"),
    appData: path.join(root, "home", "Library", "Application Support"),
    localAppData: path.join(root, "home", "Library"),
    pathVariables: {},
  }
  return { root, roots, files: createSecretFiles(roots) }
}
const contains = (files: ReturnType<typeof createSecretFiles>, value: string) =>
  files.values().some((bytes) => Buffer.from(bytes).equals(Buffer.from(value)))
// Grammar taken from Node's official dotenv fixture; test substitution changes only its RHS.
const env = async (value: string) =>
  (await Bun.file(fixture("node-env.txt")).text()).split("\n")[0].replace(/=.*/, `=${value}`) + "\n"

test("cache identity includes every stat axis", () => {
  const original = { dev: 1n, ino: 2n, size: 3n, mtimeNs: 4n, ctimeNs: 5n }
  for (const key of Object.keys(original) as (keyof typeof original)[])
    expect(sourceVersion(original)).not.toBe(sourceVersion({ ...original, [key]: original[key] + 1n }))
})

test("changed sources retain old values and discover new files", async () => {
  const { roots, files } = await setup()
  const first = randomUUID(),
    second = randomUUID(),
    third = randomUUID()
  await writeFile(path.join(roots.project, ".env"), await env(first))
  await files.refresh()
  expect(contains(files, first)).toBe(true)
  await writeFile(path.join(roots.project, ".env"), await env(second))
  await mkdir(path.join(roots.project, "new", "nested"), { recursive: true })
  await writeFile(path.join(roots.project, "new", "nested", ".env.local"), await env(third))
  await mkdir(path.join(roots.home, ".docker"))
  await copyFile(fixture("docker.json"), path.join(roots.home, ".docker", "config.json"))
  await files.refresh()
  for (const value of [first, second, third]) expect(contains(files, value)).toBe(true)
  await rm(path.join(roots.project, ".env"))
  await files.refresh()
  expect(contains(files, second)).toBe(true)
  files.dispose()
  expect(files.values()).toEqual([])
  await expect(files.refresh()).rejects.toThrow("released")
})

test("source aliases share protected identity", async () => {
  const { roots, files } = await setup()
  const value = randomUUID()
  await writeFile(path.join(roots.project, ".env"), await env(value))
  await symlink(roots.project, path.join(roots.project, "loop"))
  await symlink(path.join(roots.project, ".env"), path.join(roots.project, ".env.alias"))
  await files.refresh()
  expect(files.values().filter((bytes) => Buffer.from(bytes).equals(Buffer.from(value))).length).toBe(1)
})

test("capture leaves source files unchanged", async () => {
  const { roots, files } = await setup()
  const target = path.join(roots.project, ".env")
  await writeFile(target, await env(randomUUID()))
  const before = await readFile(target)
  await files.refresh()
  expect((await readFile(target)).equals(before)).toBe(true)
})

test("sqlite captures selected cells through a read-only main database", async () => {
  const { root, roots } = await setup()
  const bundle = await Bun.build({
    entrypoints: [path.join(import.meta.dir, "secret-files.ts")],
    target: "node",
    format: "esm",
  })
  expect(bundle.success).toBe(true)
  await writeFile(path.join(root, "collector.mjs"), await bundle.outputs[0].text())
  await writeFile(
    path.join(root, "audit-sqlite.mjs"),
    `
import { DatabaseSync } from 'node:sqlite';
export let denied = 0;
export class AuditedDatabase extends DatabaseSync {
 constructor(...args) { super(...args); let writable = false;
  try { this.exec('DELETE FROM access_tokens'); writable = true; } catch { denied++; }
  if (writable) throw new Error('Credential capture database accepted writes');
 }
}
export { AuditedDatabase as DatabaseSync };
`,
  )
  await writeFile(
    path.join(root, "driver.mjs"),
    `
import { DatabaseSync } from 'node:sqlite';
import { registerHooks } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSecretFiles } from './collector.mjs';
const roots = JSON.parse(process.argv[2]);
const directory = join(roots.home, '.config', 'gcloud'); mkdirSync(directory, {recursive:true});
const writer = new DatabaseSync(join(directory, 'access_tokens.db'));
writer.exec(readFileSync(process.argv[3], 'utf8')); writer.exec('PRAGMA journal_mode=WAL');
const first = 'fixture-first-sql-token', second = 'fixture-second-sql-token';
writer.prepare('INSERT INTO access_tokens(account_id,access_token,token_expiry) VALUES (?,?,?)').run('fixture-account', first, 'metadata-expiry');
// Audit the real production connection by attempting an actual write on that connection.
// The wrapper delegates construction/queries to Node SQLite; it is not a database substitute.
registerHooks({resolve(specifier, context, next) {
 if(specifier === 'node:sqlite' && context.parentURL?.endsWith('/collector.mjs')) return next(new URL('./audit-sqlite.mjs', import.meta.url).href,context);
 return next(specifier,context);
}});
const files = createSecretFiles(roots); await files.refresh();
writer.prepare('UPDATE access_tokens SET access_token=?').run(second); await files.refresh();
const values = files.values().map(value => Buffer.from(value).toString());
const audit = await import('./audit-sqlite.mjs');
console.log(JSON.stringify({first:values.includes(first),second:values.includes(second),metadata:values.includes('fixture-account')||values.includes('metadata-expiry'),denied:audit.denied>0}));
files.dispose(); writer.close();
`,
  )
  const child = Bun.spawn(
    ["node", path.join(root, "driver.mjs"), JSON.stringify(roots), new URL(fixture("gcloud.sql")).pathname],
    { stdout: "pipe", stderr: "pipe" },
  )
  const output = await new Response(child.stdout).text()
  const errors = await new Response(child.stderr).text()
  expect(await child.exited, errors).toBe(0)
  expect(JSON.parse(output)).toEqual({ first: true, second: true, metadata: false, denied: true })
})

// Integration on production Node; audit real filesystem calls, never substitute file data.
async function nodeCollector(root: string, roots: ProtectedFiles.ProtectedRoots, source: string) {
  const bundle = await Bun.build({ entrypoints: [path.join(import.meta.dir, "secret-files.ts")], target: "node", format: "esm" })
  expect(bundle.success).toBe(true)
  await writeFile(path.join(root, "collector.mjs"), await bundle.outputs[0].text())
  await writeFile(path.join(root, "driver.mjs"), source)
  const child = Bun.spawn(["node", path.join(root, "driver.mjs"), JSON.stringify(roots)], { stdout: "pipe", stderr: "pipe" })
  const [output, errors, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  expect(exit, errors).toBe(0)
  return JSON.parse(output)
}

test("realistic home collection never visits unrelated deep directories", async () => {
  const { root, roots } = await setup()
  for (const directory of ["Documents/unrelated/deep/tree", "Library/Unrelated/deep/tree", "Library/Keychains", ".aws", ".docker", ".kube"])
    await mkdir(path.join(roots.home, directory), { recursive: true })
  await copyFile(fixture("aws-credentials.ini"), path.join(roots.home, ".aws", "credentials"))
  await copyFile(fixture("docker.json"), path.join(roots.home, ".docker", "config.json"))
  await copyFile(fixture("kube.yaml"), path.join(roots.home, ".kube", "config"))
  await copyFile(fixture("kube-eks.yaml"), path.join(roots.home, ".kube", "eks"))
  roots.pathVariables = { KUBECONFIG: [path.join(roots.home, ".kube", "config"), path.join(roots.home, ".kube", "eks")].join(path.delimiter) }
  await writeFile(path.join(roots.home, "Library/Keychains", "login.keychain-db"), "fixture-encrypted-keychain")
  await writeFile(path.join(root, "audit.mjs"), `
import fs from 'node:fs/promises';export const visited=[];
export const stat=async (...args)=>{visited.push(String(args[0]));return fs.stat(...args)};
export const readdir=async (...args)=>{visited.push(String(args[0]));return fs.readdir(...args)};
export const readFile=fs.readFile,realpath=fs.realpath;
`)
  expect(await nodeCollector(root, roots, `
import {registerHooks} from 'node:module';
registerHooks({resolve(name,context,next){return next(name==='node:fs/promises'&&context.parentURL?.endsWith('/collector.mjs')?new URL('./audit.mjs',import.meta.url).href:name,context)}});
const {createSecretFiles}=await import('./collector.mjs');const roots=JSON.parse(process.argv[2]);
const files=createSecretFiles(roots);await files.refresh();await files.refresh();
const {visited}=await import('./audit.mjs');const values=files.values().map(v=>Buffer.from(v).toString());
console.log(JSON.stringify({unrelatedCalls:visited.filter(p=>p.includes('/Documents')||p.includes('/Library/Unrelated')).length,keychain:values.includes('fixture-encrypted-keychain'),aws:values.includes('fixture-secret-key'),kube:values.includes('fixture-kube-token')}));files.dispose();
`)).toEqual({ unrelatedCalls: 0, keychain: true, aws: true, kube: true })
})

test("Node collection includes protected files below dot directories", async () => {
  const { root, roots } = await setup()
  await mkdir(path.join(roots.project, ".devcontainer"))
  await writeFile(path.join(roots.project, ".devcontainer", ".env"), "KEY=fixture-dot-directory-token\n")
  expect(await nodeCollector(root, roots, `
import {createSecretFiles} from './collector.mjs';
const files=createSecretFiles(JSON.parse(process.argv[2]));await files.refresh();
console.log(JSON.stringify({captured:files.values().some(v=>Buffer.from(v).toString()==='fixture-dot-directory-token')}));files.dispose();
`)).toEqual({ captured: true })
})
