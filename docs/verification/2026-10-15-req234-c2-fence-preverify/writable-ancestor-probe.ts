// #1530 revised C2 plan — R2 findings 1 & 2: protect the WRITABLE-ANCESTOR identity of each fenced
// target, derived from the ACTUAL allow roots (W1–W19), instead of excluding workspaces from the union.
// Run from the worktree root: bun docs/verification/2026-10-15-req234-c2-fence-preverify/writable-ancestor-probe.ts
//
// Why: `resolveEngineRoots` honors XDG_* from the sidecar env, so `<dataHome>`/`<configHome>` can resolve
// INSIDE a writable allow root (W3=<userData>, or a W1 workspace). Then renaming that intermediate dir and
// symlinking it back writes the protected file through the new resolved path (R2 finding 1). And excluding
// the workspace (the R1 attempt) breaks startup when XDG sits under the default workspace (R2 finding 2).
// Fix: lock the identity of every directory strictly between a covering writable root and a protected
// target; leave the workspace itself writable. This probe implements the proposed helper and checks three
// topologies × {head, cand}. Results in writable-ancestor-results.json. No owner config read; HOME is a temp tree.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { join, relative } from "node:path"
import { planProcessFence } from "../../../packages/ui-mac/src/main/process-fence-plan"
import { SANDBOX_EXEC, trialCompileProfile } from "../../../packages/ui-mac/src/main/process-fence-compile"

const here = import.meta.dir
const BUN = process.execPath

// Proposed production helper (mirrored here; C2-b implements it in process-fence-profile.ts).
// writableRoots = the rendered W1–W19 allow subpaths. targets = the C2-F/P/I/T protected paths.
// Returns the identities of intermediate dirs that are strictly inside a writable root and strictly
// above a protected target (i.e. renameable carriers). Deterministic; derived, not guessed.
function writableAncestorIdentities(writableRoots: readonly string[], targets: readonly string[]): string[] {
  const inside = (parent: string, child: string) => {
    const rel = relative(parent, child)
    return rel !== "" && !rel.startsWith("..") && !rel.startsWith("/")
  }
  const out = new Set<string>()
  for (const t of targets) {
    const covering = writableRoots.filter((r) => inside(r, t)).sort((a, b) => b.length - a.length)[0] // nearest
    if (!covering) continue
    // every ancestor dir D with covering ⊊ D ⊊ t  (t's parent and up, stopping above covering)
    let d = join(t, "..")
    while (d !== covering && inside(covering, d)) {
      out.add(d)
      d = join(d, "..")
    }
  }
  return [...out].sort()
}

type Topo = { name: string; xdg: Record<string, string>; note: string }
const topos: Topo[] = [
  { name: "default", xdg: {}, note: "XDG under HOME (not writable) — helper should add nothing" },
  { name: "xdg-data-under-U", xdg: { XDG_DATA_HOME: "<U>/xdg" }, note: "finding 1: dataHome inside W3" },
  { name: "xdg-config-under-ws", xdg: { XDG_CONFIG_HOME: "<WS>/.config" }, note: "finding 2: configHome inside the default workspace" },
]

type Row = { topo: string; id: string; arm: "head" | "cand"; code: string }
const rows: Row[] = []
const failures: string[] = []
const helperOut: Record<string, string[]> = {}

async function run(topo: Topo) {
  const run = realpathSync(mkdtempSync(join(here, "fixture-")))
  const home = join(run, "home")
  const appState = join(home, "Library/Application Support/alpha-code-state")
  const G = join(appState, "env/prod")
  const U = join(home, "Library/Application Support/ai.opencode.desktop")
  const workspace = join(home, "code-puppy")
  const xdg = Object.fromEntries(Object.entries(topo.xdg).map(([k, v]) => [k, v.replace("<U>", U).replace("<WS>", workspace)]))
  ;[G, U, workspace].forEach((p) => mkdirSync(p, { recursive: true }))
  const srv = createServer((s) => s.end())
  await new Promise<void>((res) => srv.listen(0, "127.0.0.1", res))
  const proxy = { port: (srv.address() as { port: number }).port, close: () => srv.close() }
  try {
    const plan = planProcessFence(
      { userDataPath: U, sidecarEnv: { HOME: home, ...xdg }, egressProxyPort: proxy.port, addon: { packaged: false, resourcesPath: "", moduleDir: "/Users/tide/app/alpha-code/packages/ui-mac/out/main", exists: existsSync } },
      { homeDir: () => home, alphaGlobalRoot: () => G, appStateRoot: () => appState, realpath: realpathSync.native, defaultWorkspace: () => workspace, readWorkspaces: () => [], isDirectory: (p) => existsSync(p) && statSync(p).isDirectory(), mkdirp: (p) => void mkdirSync(p, { recursive: true }), compile: (pf) => trialCompileProfile(pf, { tmpdir: () => run }), log: () => {} },
    )
    // finding 2 positive: the default workspace is still selected (union non-empty).
    if (!plan.profile.includes(`(subpath "${workspace}")`)) failures.push(`${topo.name}: default workspace NOT selected — planner would refuse fork (finding 2 regression)`)

    const D = join(U, "alpha-engine-config")
    const HO = join(home, ".opencode")
    const XO = join(plan.roots.configHome, "opencode")
    const DH = join(plan.roots.dataHome, "opencode")
    const authJson = join(DH, "auth.json")
    const files = [join(G, "alpha.jsonc"), authJson, join(G, "installs.json"), join(HO, "opencode.jsonc"), join(XO, "opencode.jsonc"), join(D, "opencode.jsonc")]
    const baseDirs = [D, HO, XO, G, U, DH]
    const targets = [...files, ...baseDirs, join(G, "ext-tx")]

    // allow roots = rendered W1–W19 subpaths
    const writableRoots = [...plan.profile.matchAll(/\(subpath "([^"]+)"\)\s*;\sW/g)].map((m) => m[1])
    const ancestors = writableAncestorIdentities(writableRoots, targets)
    helperOut[topo.name] = ancestors.map((p) => relative(home, p))

    const lit = (p: string) => `(literal "${p}")`
    const candDenies = [
      `(deny file-write* ${files.map(lit).join(" ")})`,
      `(deny file-write* ${[HO, XO, D].flatMap((p) => [join(p, "plugin"), join(p, "plugins"), join(p, "tool"), join(p, "tools")]).map((p) => `(subpath "${p}")`).join(" ")})`,
      `(deny file-write* ${[...baseDirs, ...ancestors].map(lit).join(" ")})`, // C2-I + writable ancestors, SAME line
      `(deny file-write* (subpath "${join(G, "ext-tx")}"))`,
    ]
    if (candDenies.length !== 4) failures.push(`${topo.name}: expected exactly 4 new deny lines, got ${candDenies.length}`)
    const head = plan.profile
    const cand = head.replace("(deny network*)", `${candDenies.join("\n")}\n(deny network*)`)
    const pf = { head: join(run, "head.sb"), cand: join(run, "cand.sb") }
    writeFileSync(pf.head, head)
    writeFileSync(pf.cand, cand)

    const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, TMPDIR: run }
    const sh = (arm: "head" | "cand", script: string, ...args: string[]) => {
      const r = spawnSync(SANDBOX_EXEC, ["-f", pf[arm], "/bin/sh", "-c", script, "--", ...args], { encoding: "utf8", timeout: 30_000, env })
      return r.status === 0 ? "OK" : /Operation not permitted/.test(String(r.stderr)) ? "EPERM" : `rc=${r.status}`
    }
    const node = (arm: "head" | "cand", action: string, target: string, aux?: string) => {
      const r = spawnSync(SANDBOX_EXEC, ["-f", pf[arm], BUN, join(here, "fs-probe2.mjs"), action, target, ...(aux ? [aux] : [])], { encoding: "utf8", timeout: 30_000, env })
      try { return JSON.parse(String(r.stdout).trim().split("\n").pop()!).code } catch { return `bad:${String(r.stdout)}${String(r.stderr)}` }
    }
    const reset = () => {
      rmSync(home, { recursive: true, force: true })
      for (const p of [G, D, HO, XO, DH, workspace, join(G, "ext-tx")]) mkdirSync(p, { recursive: true })
      for (const f of files) { mkdirSync(join(f, ".."), { recursive: true }); writeFileSync(f, "sentinel\n") }
    }
    const scn: { id: string; run: (a: "head" | "cand") => string; expect?: Partial<Record<"head" | "cand", string>> }[] = []
    // the renameable intermediate (if any) must be locked in cand; demonstrably bypassable in head
    for (const anc of ancestors) {
      scn.push({ id: `ancestor-rename:${relative(home, anc)}`, run: (a) => sh(a, 'mv "$1" "$2"', anc, `${anc}.old`), expect: { head: "OK", cand: "EPERM" } })
    }
    // the protected file is unreachable in cand even via the (now-locked) ancestor path
    scn.push({ id: `auth.json-write`, run: (a) => node(a, "append", authJson), expect: { head: "OK", cand: "EPERM" } })
    // finding 2 positive: normal writes under the workspace and under U stay allowed in cand
    scn.push({ id: `workspace-write`, run: (a) => node(a, "create", join(workspace, "probe.txt")), expect: { head: "OK", cand: "OK" } })
    scn.push({ id: `userData-ordinary-write`, run: (a) => node(a, "create", join(U, "probe.txt")), expect: { head: "OK", cand: "OK" } })

    for (const s of scn) {
      for (const arm of ["head", "cand"] as const) {
        reset()
        const code = s.run(arm)
        rows.push({ topo: topo.name, id: s.id, arm, code })
        const want = s.expect?.[arm]
        if (want !== undefined && want !== code) failures.push(`${topo.name}/${s.id} [${arm}] expected ${want} got ${code}`)
      }
    }
  } finally {
    proxy.close()
    rmSync(run, { recursive: true, force: true })
  }
}

for (const t of topos) await run(t)

console.log("helper writableAncestorIdentities() output per topology:")
for (const [k, v] of Object.entries(helperOut)) console.log(`  ${k}: [${v.join(", ")}]`)
console.log("")
const width = Math.max(...rows.map((r) => `${r.topo}/${r.id}`.length))
console.log(`${"topology/scenario".padEnd(width)} | head | cand`)
for (const r of rows.filter((_, i, a) => a.findIndex((x) => x.topo === _.topo && x.id === _.id) === i)) {
  const h = rows.find((x) => x.topo === r.topo && x.id === r.id && x.arm === "head")?.code ?? "-"
  const c = rows.find((x) => x.topo === r.topo && x.id === r.id && x.arm === "cand")?.code ?? "-"
  console.log(`${`${r.topo}/${r.id}`.padEnd(width)} | ${h.padEnd(4)} | ${c}`)
}
console.log(`\nrows=${rows.length} failures=${failures.length}`)
for (const f of failures) console.log(`FAIL: ${f}`)
writeFileSync(join(here, "writable-ancestor-results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), helperOut, rows, failures }, null, 2))
console.log(failures.length ? "RESULT: expectations violated" : "RESULT: all expectations hold")
process.exit(failures.length ? 1 : 0)
