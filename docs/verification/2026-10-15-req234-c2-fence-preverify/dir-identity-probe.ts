// #1530 revised C2 plan — seatbelt semantics for the config-fence target set: file literals, plugin/tool
// auto-load directories, directory identity, writable ancestors, and the C2-T recovery/ledger targets.
// Run from the worktree root: bun docs/verification/2026-10-15-req234-c2-fence-preverify/dir-identity-probe.ts
//
// Four arms, all derived from the PRODUCTION planner output (planProcessFence) on an isolated HOME tree:
//   head      the committed profile (any `(deny file-write* (...))` lines from the uncommitted draft are stripped)
//   draft     head + the draft's two lines (alpha.jsonc literal + six plugin(s) subpaths)
//   cand      head + the revised plan's deny set:
//               C2-F  13 file literals: <G>/alpha.jsonc, {HO}/opencode.json(c), {XO,D}/{config.json,opencode.json,
//                     opencode.jsonc,config}, <dataHome>/opencode/auth.json (finding 1), <G>/installs.json (finding 4)
//               C2-P  12 subpaths: {HO,XO,D}/{plugin,plugins} + {HO,XO,D}/{tool,tools} (finding 2)
//               C2-I   7 directory identities: D, ~/.opencode, <XDG>/opencode, <alphaGlobalRoot>, <userData>,
//                     <dataHome>/opencode (finding 1)
//               C2-T   1 subpath: <G>/ext-tx (finding 4 defense; <G>/installs.json is the C2-F literal above)
//   cand-ws   cand + a workspace W1 root <home>/wsroot whose child <home>/wsroot/xdg/opencode is C2-I-protected
//             (simulates XDG_CONFIG_HOME selected inside a workspace, finding 3): shows that protecting the
//             child's identity while its PARENT is a writable workspace is bypassable by renaming the parent.
// run1 already established that adding `(deny file-link …)` yields no difference (cand ≡ candlink); that arm is
// dropped. Every row is one sandbox-exec; the matrix + expectation check print at the end and land in
// dir-identity-results.json. No owner config is read; HOME is a temporary tree under this directory.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { basename, dirname, join, relative } from "node:path"
import { planProcessFence } from "../../../packages/ui-mac/src/main/process-fence-plan"
import { SANDBOX_EXEC, trialCompileProfile } from "../../../packages/ui-mac/src/main/process-fence-compile"

const here = import.meta.dir
const run = realpathSync(mkdtempSync(join(here, "fixture-")))
const home = join(run, "home")
const appState = join(home, "Library/Application Support/alpha-code-state")
const G = join(appState, "env/prod")
const U = join(home, "Library/Application Support/ai.opencode.desktop")
const D = join(U, "alpha-engine-config")
const HO = join(home, ".opencode")
const workspace = join(home, "code-puppy")
const wsroot = join(home, "wsroot") // finding 3: a second workspace W1 root
const wsXdg = join(wsroot, "xdg") // simulated XDG_CONFIG_HOME inside wsroot
const wsXdgOpencode = join(wsXdg, "opencode") // the protected child
const PYTHON = process.env.PROBE_PYTHON ?? "/usr/bin/python3"
const BUN = process.execPath

type Arm = "head" | "draft" | "cand" | "cand-ws"
const ARMS: Arm[] = ["head", "draft", "cand", "cand-ws"]
type Row = { id: string; arm: Arm; code: string }
const rows: Row[] = []
const failures: string[] = []

const proxy = createServer((socket) => socket.end("probe\n"))
await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve))
const address = proxy.address()
if (!address || typeof address === "string") throw new Error("proxy port")

try {
  ;[G, U, workspace, wsroot].forEach((p) => mkdirSync(p, { recursive: true }))
  const plan = planProcessFence(
    {
      userDataPath: U,
      sidecarEnv: { HOME: home },
      egressProxyPort: address.port,
      addon: { packaged: false, resourcesPath: "", moduleDir: "/Users/tide/app/alpha-code/packages/ui-mac/out/main", exists: existsSync },
    },
    {
      homeDir: () => home,
      alphaGlobalRoot: () => G,
      appStateRoot: () => appState,
      realpath: realpathSync.native,
      defaultWorkspace: () => workspace,
      readWorkspaces: () => [],
      isDirectory: (p) => existsSync(p) && statSync(p).isDirectory(),
      mkdirp: (p) => void mkdirSync(p, { recursive: true }),
      compile: (profile) => trialCompileProfile(profile, { tmpdir: () => run }),
      log: () => {},
    },
  )
  const XO = join(plan.roots.configHome, "opencode")
  const DH = join(plan.roots.dataHome, "opencode") // W4 root; now holds a config source (auth.json)
  const authJson = join(DH, "auth.json")
  const installsJson = join(G, "installs.json")
  const extTx = join(G, "ext-tx")
  const lines = plan.profile.split("\n")
  const draftDenies = lines.filter((l) => /^\(deny file-write\* \(/.test(l))
  const head = lines.filter((l) => !/^\(deny file-write\* \(/.test(l)).join("\n")
  if (head.split("\n").filter((l) => l.startsWith("(deny ")).length !== 2) throw new Error("head profile shape")

  const files = [
    join(G, "alpha.jsonc"),
    join(HO, "opencode.json"), join(HO, "opencode.jsonc"),
    ...["config.json", "opencode.json", "opencode.jsonc", "config"].map((n) => join(XO, n)),
    ...["config.json", "opencode.json", "opencode.jsonc", "config"].map((n) => join(D, n)),
    authJson,
    installsJson,
  ]
  const pluginDirs = [HO, XO, D].flatMap((p) => [join(p, "plugin"), join(p, "plugins")])
  const toolDirs = [HO, XO, D].flatMap((p) => [join(p, "tool"), join(p, "tools")])
  const autoDirs = [...pluginDirs, ...toolDirs]
  const dirs = [D, HO, XO, G, U, DH]
  const lit = (p: string) => `(literal "${p}")`
  const denyFiles = `(deny file-write* ${files.map(lit).join(" ")})`
  const denyAuto = `(deny file-write* ${autoDirs.map((p) => `(subpath "${p}")`).join(" ")})`
  const denyDirs = `(deny file-write* ${dirs.map(lit).join(" ")})`
  const denyExtTx = `(deny file-write* (subpath "${extTx}"))`
  const insert = (base: string, extra: string[]) => base.replace("(deny network*)", `${extra.join("\n")}\n(deny network*)`)
  const candDenies = [denyFiles, denyAuto, denyDirs, denyExtTx]
  // cand-ws (finding 3): <home>/wsroot is allowed as a W1 workspace; its grandchild <home>/wsroot/xdg/opencode
  // is identity-protected (C2-I). Ordering matters — seatbelt is last-match-wins, so the wsroot allow comes
  // BEFORE the child deny: the child stays denied while the parent xdg stays writable via wsroot. This mirrors
  // a real profile where wsroot is a W1 subpath in the allow block and the C2-I deny follows.
  const candWsProfile = insert(head, [...candDenies, `(allow file-write* (subpath "${wsroot}"))`, `(deny file-write* (literal "${wsXdgOpencode}"))`])
  const profiles: Record<Arm, string> = {
    head,
    draft: insert(head, draftDenies),
    cand: insert(head, candDenies),
    "cand-ws": candWsProfile,
  }
  const profileFile: Record<Arm, string> = { head: "", draft: "", cand: "", "cand-ws": "" }
  for (const arm of ARMS) {
    profileFile[arm] = join(run, `${arm}.sb`)
    writeFileSync(profileFile[arm], profiles[arm])
  }

  const env = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: home, TMPDIR: run }
  const codeOf = (r: ReturnType<typeof spawnSync>, stdoutJson: boolean): string => {
    if (r.error) return `spawn-error:${String(r.error)}`
    if (stdoutJson) {
      try {
        return JSON.parse(String(r.stdout).trim().split("\n").pop() ?? "").code
      } catch {
        return `bad-json:${String(r.stdout).trim()} ${String(r.stderr).trim()}`
      }
    }
    if (r.status === 0) return "OK"
    return /Operation not permitted/.test(String(r.stderr)) ? "EPERM" : `rc=${r.status}:${String(r.stderr).trim().slice(0, 80)}`
  }
  const sh = (arm: Arm, script: string, ...args: string[]) =>
    codeOf(spawnSync(SANDBOX_EXEC, ["-f", profileFile[arm], "/bin/sh", "-c", script, "--", ...args], { encoding: "utf8", timeout: 30_000, env }), false)
  const node = (arm: Arm, action: string, target: string, aux?: string) =>
    codeOf(spawnSync(SANDBOX_EXEC, ["-f", profileFile[arm], BUN, join(here, "fs-probe2.mjs"), action, target, ...(aux ? [aux] : [])], { encoding: "utf8", timeout: 30_000, env }), true)
  const py = (arm: Arm, ...args: string[]) =>
    codeOf(spawnSync(SANDBOX_EXEC, ["-f", profileFile[arm], PYTHON, "-I", "-B", join(here, "syscall-probe.py"), ...args], { encoding: "utf8", timeout: 30_000, env }), true)

  const wipe = () => rmSync(home, { recursive: true, force: true })
  const reset = () => {
    for (const p of [G, D, HO, XO, DH, workspace, wsXdgOpencode, extTx, join(U, "opencode/locks"), ...autoDirs]) mkdirSync(p, { recursive: true })
    for (const f of files) writeFileSync(f, "sentinel\n")
    for (const p of autoDirs) writeFileSync(join(p, "x.js"), "// sentinel\n")
    writeFileSync(join(extTx, "journal.json"), "{}\n")
    mkdirSync(join(U, "replacement-config"), { recursive: true })
    writeFileSync(join(U, "replacement-config/opencode.jsonc"), '{"mcp":{"x":{"command":["attacker"]}}}\n')
    mkdirSync(join(workspace, "stash-src"), { recursive: true })
    writeFileSync(join(workspace, "stash-src/opencode.jsonc"), '{"mcp":{"x":{"command":["attacker"]}}}\n')
    writeFileSync(join(workspace, "evil.json"), '{"mcp":{"x":{"command":["attacker"]}}}\n')
    writeFileSync(join(workspace, "evil.js"), "// evil\n")
  }
  const rel = (p: string) => relative(home, p)
  const PROTECTED = { cand: "EPERM", "cand-ws": "EPERM" } as const
  const ALL = (code: string): Partial<Record<Arm, string>> => ({ head: code, draft: code, cand: code, "cand-ws": code })

  type Scenario = { id: string; prep?: () => void; run: (arm: Arm) => string; expect: Partial<Record<Arm, string>> }
  const scenarios: Scenario[] = []
  const add = (s: Scenario) => scenarios.push(s)

  // C2-F — the 13 files
  for (const f of files) {
    const draftCode = f === join(G, "alpha.jsonc") ? "EPERM" : "OK" // draft only protects alpha.jsonc
    add({ id: `file-append:${rel(f)}`, run: (a) => node(a, "append", f), expect: { head: "OK", draft: draftCode, ...PROTECTED } })
    add({ id: `file-create:${rel(f)}`, prep: () => rmSync(f), run: (a) => node(a, "create", f), expect: { head: "OK", draft: draftCode, ...PROTECTED } })
    add({ id: `file-rename-over:${rel(f)}`, run: (a) => node(a, "rename", f, join(workspace, "evil.json")), expect: { head: "OK", draft: draftCode, ...PROTECTED } })
    add({ id: `file-symlink-into-place:${rel(f)}`, prep: () => rmSync(f), run: (a) => node(a, "symlink", f, join(workspace, "evil.json")), expect: { head: "OK", draft: draftCode, ...PROTECTED } })
    add({ id: `file-hardlink-out:${rel(f)}`, run: (a) => node(a, "link", join(workspace, `hl-${rel(f).replace(/\//g, "_")}`), f), expect: { head: "OK", draft: draftCode, ...PROTECTED } })
    add({ id: `file-renamex-swap:${rel(f)}`, run: (a) => py(a, "swap", join(workspace, "evil.json"), f), expect: { ...PROTECTED } })
    add({ id: `file-openat:${rel(f)}`, run: (a) => py(a, "openat", dirname(f), basename(f)), expect: { head: "OK", draft: f === join(G, "alpha.jsonc") ? "EPERM" : "OK", ...PROTECTED } })
  }
  // C2-I — directory identity (incl. DH = <dataHome>/opencode, finding 1). head/draft OK (seatbelt allows
  // these allow-subpath dirs and the user owns the tree); cand/cand-ws EPERM is the invariant asserted.
  for (const dir of dirs) {
    // Move the dir into the workspace (a W1-writable dest) so head=OK is a real "can steal the dir" result,
    // not an artifact of the .old sibling landing outside an allow subpath.
    add({ id: `dir-rename-away:${rel(dir)}`, run: (a) => sh(a, 'mv "$1" "$2"', dir, join(workspace, `stolen-${basename(dir)}`)), expect: { head: "OK", draft: "OK", ...PROTECTED } })
    add({ id: `dir-symlink-into-place:${rel(dir)}`, prep: () => rmSync(dir, { recursive: true, force: true }), run: (a) => node(a, "symlink", dir, workspace), expect: { ...PROTECTED } })
    add({ id: `dir-mkdir-absent:${rel(dir)}`, prep: () => rmSync(dir, { recursive: true, force: true }), run: (a) => node(a, "mkdir", dir), expect: { ...PROTECTED } })
    add({ id: `dir-rmdir-emptied:${rel(dir)}`, prep: () => { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir) }, run: (a) => node(a, "rmdir", dir), expect: { ...PROTECTED } })
    add({ id: `dir-renameat-into-place:${rel(dir)}`, prep: () => { rmSync(dir, { recursive: true, force: true }); mkdirSync(join(dirname(dir), "repl-src"), { recursive: true }) }, run: (a) => py(a, "renameat", dirname(dir), "repl-src", basename(dir)), expect: { ...PROTECTED } })
    // legitimate: recursive mkdir on an existing protected dir must stay OK
    add({ id: `dir-mkdirp-existing:${rel(dir)}`, run: (a) => node(a, "mkdirp", dir), expect: ALL("OK") })
  }
  // writes INSIDE DH (engine logs / db / repos) must stay allowed
  for (const p of [join(DH, "log/x"), join(DH, "x.db"), join(DH, "repos/x"), join(DH, "x.db-wal")]) {
    add({ id: `allow-inside-dataHome:${rel(p)}`, prep: () => mkdirSync(dirname(p), { recursive: true }), run: (a) => node(a, "create", p), expect: ALL("OK") })
  }
  // C2-P — plugin + tool auto-load dirs (finding 2)
  for (const p of autoDirs) {
    add({ id: `auto-create:${rel(join(p, "x2.js"))}`, run: (a) => node(a, "create", join(p, "x2.js")), expect: { head: "OK", draft: pluginDirs.includes(p) ? "EPERM" : "OK", ...PROTECTED } })
    add({ id: `auto-dir-symlink:${rel(p)}`, prep: () => rmSync(p, { recursive: true, force: true }), run: (a) => node(a, "symlink", p, workspace), expect: { head: "OK", draft: pluginDirs.includes(p) ? "EPERM" : "OK", ...PROTECTED } })
  }
  // C2-T — <G>/ext-tx (finding 4 defense)
  add({ id: `extTx-create-journal:${rel(join(extTx, "journal/evil.json"))}`, prep: () => mkdirSync(join(extTx, "journal"), { recursive: true }), run: (a) => node(a, "create", join(extTx, "journal/evil.json")), expect: { head: "OK", draft: "OK", ...PROTECTED } })
  add({ id: `extTx-create-staging:${rel(join(extTx, "staging/x/config-0.pre"))}`, prep: () => mkdirSync(join(extTx, "staging/x"), { recursive: true }), run: (a) => node(a, "create", join(extTx, "staging/x/config-0.pre")), expect: { head: "OK", draft: "OK", ...PROTECTED } })
  add({ id: `extTx-rename-away:${rel(extTx)}`, run: (a) => sh(a, 'mv "$1" "$2"', extTx, `${extTx}.old`), expect: { ...PROTECTED } })
  // directory-replacement of a config dir (stage2-options §3 reproduction) — still covered
  for (const [dir, stash] of [[D, join(U, "replacement-config")], [HO, join(workspace, "stash-src")]] as const) {
    add({ id: `dir-rename-into-place:${rel(dir)}`, prep: () => rmSync(dir, { recursive: true, force: true }), run: (a) => sh(a, 'mv "$1" "$2"', stash, dir), expect: { head: "OK", draft: "OK", ...PROTECTED } })
  }
  // allow-root ancestor swap (writable root moved into another writable root) — still EPERM in cand
  add({ id: `root-move-into-other-root:${rel(U)}->${rel(join(G, "stash"))}`, run: (a) => sh(a, 'mv "$1" "$2"', U, join(G, "stash")), expect: { ...PROTECTED } })

  // finding 3 — writable ANCESTOR (parent) of a protected dir. cand-ws grants <home>/wsroot as W1 and
  // protects <home>/wsroot/xdg/opencode's identity; renaming the PARENT xdg (NOT identity-protected) carries
  // opencode with it. In cand (no wsroot workspace) the parent is not writable → default-deny.
  add({
    id: `ancestor-parent-rename:${rel(wsXdg)} (child ${rel(wsXdgOpencode)} is identity-protected)`,
    run: (a) => sh(a, 'mv "$1" "$2"', wsXdg, `${wsXdg}.old`),
    expect: { "cand-ws": "OK", cand: "EPERM" },
  })
  add({
    id: `ancestor-child-still-denied:${rel(wsXdgOpencode)}`,
    run: (a) => sh(a, 'mv "$1" "$2"', wsXdgOpencode, `${wsXdgOpencode}.old`),
    expect: { "cand-ws": "EPERM" },
  })

  // compile per arm
  for (const arm of ARMS) {
    const r = spawnSync(SANDBOX_EXEC, ["-f", profileFile[arm], "/usr/bin/true"], { encoding: "utf8", env })
    rows.push({ id: "compile", arm, code: r.status === 0 ? "OK" : `rc=${r.status}:${String(r.stderr).trim()}` })
    if (r.status !== 0) failures.push(`compile:${arm} ${String(r.stderr).trim()}`)
  }
  for (const s of scenarios) {
    for (const arm of ARMS) {
      wipe()
      reset()
      s.prep?.()
      let code: string
      try {
        code = s.run(arm)
      } catch (error) {
        code = `threw:${error instanceof Error ? error.message : String(error)}`
      }
      rows.push({ id: s.id, arm, code })
      const want = s.expect[arm]
      if (want !== undefined && want !== code) failures.push(`${s.id} [${arm}] expected ${want} got ${code}`)
    }
  }

  const ids = [...new Set(rows.map((r) => r.id))]
  const width = Math.max(...ids.map((i) => i.length))
  console.log(`${"scenario".padEnd(width)} | ${ARMS.map((a) => a.padEnd(10)).join(" | ")}`)
  for (const id of ids) {
    const cells = ARMS.map((arm) => (rows.find((r) => r.id === id && r.arm === arm)?.code ?? "-").padEnd(10))
    console.log(`${id.padEnd(width)} | ${cells.join(" | ")}`)
  }
  console.log(`\nrows=${rows.length} scenarios=${scenarios.length} failures=${failures.length}`)
  for (const f of failures) console.log(`FAIL: ${f}`)
  writeFileSync(join(here, "dir-identity-results.json"), JSON.stringify({ generatedAt: new Date().toISOString(), roots: { home, G, U, D, HO, XO, DH, workspace, wsroot }, python: PYTHON, bun: BUN, profiles, rows, failures }, null, 2))
  console.log(failures.length ? "RESULT: expectations violated (see FAIL lines)" : "RESULT: all expectations hold")
} finally {
  proxy.close()
  rmSync(run, { recursive: true, force: true })
}
process.exit(failures.length ? 1 : 0)
