// SPEC-engine-config-fence AC-01 (DESIGN-engine-config-fence E1 / E2): nothing the fenced process tree runs can create,
// change, replace, rename, delete, hard-link or clone a protected configuration location, nor create, rename or delete any
// ancestor directory node of one; a location that is itself a symlink protects its real target. Run only through
// process-fence-config-fence.test.ts.
//
// Production planner (planProcessFence: real paths, symlink targets, pre-created directories) + production render + production
// fence (fat .node from the production build script, applied by applyProcessFence in a bun child; everything that child spawns
// inherits the seatbelt). The attacks are config-fence-ops (native/codepuppy-fence/test/config-fence-ops.c), one line per attempt.
// Everything lives in a fake HOME / userData / state root under the worktree's node_modules/.cache (outside the fence:
// /private/tmp and $TMPDIR are W11/W12). The real HOME, user-data directory, ~/.config/opencode and ~/.opencode are never touched.
//
// Known-bad arms (each must flip, or the check proves nothing): the protected set removed with W2 / W6 restored; the protected
// blocks before the allow block; no ancestors block; X1 rendered after the protected blocks; a symlinked location rendered
// without its target. Outside the guarantee (R8, an explicit control, not a failure): a symlink the user placed INSIDE a
// protected directory, pointing at a writable place, still writes to its target.
//
// AC-08 (BR-07, DESIGN §4.8 / E11): the whole ~/.opencode is CF-9 — absent, no creation form makes it; present, nothing under it
// can be written (also under a run-time grant for it), reads work; the plan directory now lives under the engine data directory.
// Known bad: today's rows (W16 back, CF-9 out) — every creation and write lands; CF-9 out alone — a grant for it lets writes land.

import { beforeAll, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { buildFenceAddon } from "../../scripts/build-fence-addon"
import { loadFenceAddon } from "./process-fence-apply"
import { trialCompileProfile } from "./process-fence-compile"
import { planProcessFence, type ProcessFencePlan } from "./process-fence-plan"
import { processFenceRulesCover, processFenceWriteRules, WORKSPACE_WRITE_EXTENSION_CLASS } from "./process-fence-profile"

const run = process.env.CODEPUPPY_CONFIG_FENCE_TEST_ROOT!
const home = join(run, "home")
const appSupport = join(home, "Library", "Application Support")
const state = join(appSupport, "codepuppy-state")
const env = join(state, "env", "dev")
const userData = join(appSupport, "Code Puppy Data")
const ws = join(run, "ws")
const dataHome = join(home, ".local", "share")
const cacheHome = join(home, ".cache")
const configHome = join(home, ".config")
const xdgConfig = join(configHome, "opencode")
/** OPENCODE_CONFIG_DIR exported elsewhere: the engine's global config directory is not the XDG one, both are protected. */
const cfgDir = join(home, "cfg-dir", "opencode")
/** CF-6 is itself a symlink into the workspace: its real target must be protected too. */
const linkedTarget = join(ws, "linked-connections")
const ops = join(run, "config-fence-ops")
let addon = ""
let plan: ProcessFencePlan

const DRIVER = `
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { applyProcessFence } from ${JSON.stringify(join(import.meta.dir, "process-fence-apply.ts"))}
const [addonPath, profileFile, insideDir, ...command] = process.argv.slice(1)
applyProcessFence({ addonPath, profile: readFileSync(profileFile, "utf8") }, { insideDir })
process.exit(spawnSync(command[0], command.slice(1), { stdio: "inherit" }).status ?? 125)
`
/** The same runner, but it first receives a run-time grant (X1) issued by this unfenced process for its pid. */
const GRANT_DRIVER = `
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { applyProcessFence, loadFenceAddon } from ${JSON.stringify(join(import.meta.dir, "process-fence-apply.ts"))}
const [addonPath, profileFile, insideDir, ...command] = process.argv.slice(1)
applyProcessFence({ addonPath, profile: readFileSync(profileFile, "utf8") }, { insideDir })
process.stdout.write("PID " + process.pid + "\\n")
let input = ""
for await (const chunk of process.stdin) { input += String(chunk); if (input.includes("END\\n")) break }
for (const token of input.split("\\n").filter((line) => line && line !== "END")) {
  const consumed = loadFenceAddon(addonPath).consumeExtension(token.trim())
  process.stdout.write("CONSUMED " + consumed.handle + "\\n")
}
const result = spawnSync(command[0], command.slice(1), { encoding: "utf8" })
process.stdout.write(String(result.stdout) + String(result.stderr))
process.exit(result.status ?? 125)
`

/** A fresh fake tree (same paths every time, so one planned profile serves every arm). */
function build() {
  for (const directory of [home, ws]) rmSync(directory, { recursive: true, force: true })
  const put = (path: string, text: string) => {
    mkdirSync(join(path, ".."), { recursive: true })
    writeFileSync(path, text)
  }
  put(join(env, "codepuppy.jsonc"), '{ "mcp": {} }\n')
  put(join(state, "cas", "blob"), "cas\n")
  put(join(userData, "codepuppy-engine-config", "codepuppy-explicit.json"), "{}\n")
  put(join(userData, "codepuppy-engine-config", "models.json"), "{}\n")
  put(join(userData, "codepuppy-shell-env.json"), "{}\n")
  put(join(userData, "codepuppy.env"), "FAKE_KEY=fake-value-not-a-secret\n")
  put(join(userData, "codepuppy-endpoints.json"), "{}\n")
  put(join(userData, "opencode.settings"), "{}\n")
  put(join(userData, "opencode.updater"), "{}\n")
  put(join(userData, "default.dat"), "{}\n")
  put(join(userData, "opencode.global.dat"), "{}\n")
  put(join(userData, "other.txt"), "other\n")
  put(join(linkedTarget, "record.json"), "{}\n")
  symlinkSync(linkedTarget, join(userData, "codepuppy-connections"))
  put(join(xdgConfig, "opencode.json"), "{}\n")
  put(join(cfgDir, "opencode.json"), "{}\n")
  put(join(home, "opencode.json"), "{}\n")
  // R8 control: a symlink the user placed inside a protected directory, pointing at a writable place
  mkdirSync(join(ws, "dotfiles-plugin"), { recursive: true })
  symlinkSync(join(ws, "dotfiles-plugin"), join(xdgConfig, "plugin"))
  // E2: the places the engine and its children keep writing
  for (const directory of [join(userData, "opencode"), join(userData, "uv-cache"), join(dataHome, "opencode"), join(cacheHome, "opencode"), join(home, ".npm")])
    mkdirSync(directory, { recursive: true })
}

/** Files and directories whose bytes / listing / mode must be unchanged after a production arm (read outside the fence). */
function snapshot() {
  const files = [
    join(env, "codepuppy.jsonc"), join(state, "cas", "blob"), join(userData, "codepuppy-engine-config", "codepuppy-explicit.json"),
    join(userData, "codepuppy-engine-config", "models.json"), join(userData, "codepuppy-shell-env.json"), join(userData, "codepuppy.env"),
    join(userData, "codepuppy-endpoints.json"), join(userData, "opencode.settings"), join(userData, "opencode.updater"), join(userData, "default.dat"),
    join(linkedTarget, "record.json"), join(xdgConfig, "opencode.json"), join(cfgDir, "opencode.json"), join(home, "opencode.json"),
  ].map((file) => ({ file, text: readFileSync(file, "utf8"), mode: statSync(file).mode, ino: statSync(file).ino }))
  const listings = [state, env, join(userData, "codepuppy-engine-config"), linkedTarget, xdgConfig, cfgDir, userData, appSupport, home].map((directory) => ({
    directory, entries: readdirSync(directory).sort(), mode: statSync(directory).mode,
  }))
  const absent = [join(userData, "codepuppy-discovered-endpoints.json"), join(home, "opencode.jsonc"), join(userData, "new.dat"), join(home, ".opencode")].map((path) => ({
    path, present: existsSync(path) || (() => { try { lstatSync(path); return true } catch { return false } })(),
  }))
  return { files, listings, absent }
}

/** config-fence-ops: the operations each mode reports (one line each). A missing or extra line means the helper broke, not «refused». */
const OPS = {
  file: ["append", "truncate", "write-new-then-rename-over", "rename-workspace-file-over", "swap", "rename-away", "hardlink-alias", "chmod", "unlink"],
  dir: ["create-inside", "mkdir-child", "hardlink-into", "clone-into", "symlink-into", "rename-dir-away", "chmod-dir"],
  create: ["create", "symlink-at", "mkdir-at", "rename-into", "hardlink-at", "clone-at"],
  ancestor: ["rename-ancestor-away"],
  "create-dir": ["mkdir-p", "rename-dir-into", "clone-dir-at"],
  vol: ["vol-append", "vol-rename-over"],
} as const

/** The attack script: every location × every operation, every ancestor node, and the other spellings: a workspace symlink (cf2, cf4), letter case (cf3, cf4, cf5 new, cf7 .dat), the /System/Volumes/Data firmlink (cf2, cf8), /.vol/<dev>/<ino> (cf2, cf3, cf7 .dat). */
function matrix() {
  const calls: Array<[string, "file" | "dir" | "create" | "ancestor" | "vol", string]> = [
    ["cf1-jsonc", "file", join(env, "codepuppy.jsonc")],
    ["cf1-state", "dir", state],
    ["cf1-env", "dir", env],
    ["cf2-explicit", "file", join(userData, "codepuppy-engine-config", "codepuppy-explicit.json")],
    ["cf2-models", "file", join(userData, "codepuppy-engine-config", "models.json")],
    ["cf2-dir", "dir", join(userData, "codepuppy-engine-config")],
    ["cf3", "file", join(userData, "codepuppy-shell-env.json")],
    ["cf4", "file", join(userData, "codepuppy.env")],
    ["cf5", "file", join(userData, "codepuppy-endpoints.json")],
    ["cf5-discovered", "create", join(userData, "codepuppy-discovered-endpoints.json")],
    ["cf6-via-link", "file", join(userData, "codepuppy-connections", "record.json")],
    ["cf6-target-record", "file", join(linkedTarget, "record.json")],
    ["cf6-target-dir", "dir", linkedTarget],
    ["cf7-settings", "file", join(userData, "opencode.settings")],
    ["cf7-updater", "file", join(userData, "opencode.updater")],
    ["cf7-dat", "file", join(userData, "default.dat")],
    ["cf7-new-dat", "create", join(userData, "new.dat")],
    ["cf7-new-DAT", "create", join(userData, "NEW.DAT")],
    ["cf7-new-Dat", "create", join(userData, "x.Dat")],
    ["cf8-xdg", "file", join(xdgConfig, "opencode.json")],
    ["cf8-xdg-dir", "dir", xdgConfig],
    ["cf8-cfg", "file", join(cfgDir, "opencode.json")],
    ["cf8-cfg-dir", "dir", cfgDir],
    ["cf10-json", "file", join(home, "opencode.json")],
    ["cf10-jsonc", "create", join(home, "opencode.jsonc")],
    ["anc-userdata", "ancestor", userData],
    ["anc-appsupport", "ancestor", appSupport],
    ["anc-library", "ancestor", join(home, "Library")],
    ["anc-state-env", "ancestor", join(state, "env")],
    ["anc-config", "ancestor", configHome],
    ["anc-cfg-parent", "ancestor", join(home, "cfg-dir")],
    ["anc-home", "ancestor", home],
    // other spellings of the same objects: a symlink in the workspace, letter case, the Data-volume firmlink, /.vol/<dev>/<ino>
    ["spell-link-cf4", "file", join(ws, "via-userdata", "codepuppy.env")],
    ["spell-link-cf2", "file", join(ws, "via-userdata", "codepuppy-engine-config", "codepuppy-explicit.json")],
    ["spell-case-cf4", "file", join(appSupport, "CODE PUPPY DATA", "codepuppy.env")],
    ["spell-case-dat", "file", join(userData, "DEFAULT.DAT")],
    ["spell-case-cf3", "file", join(userData, "CODEPUPPY-SHELL-ENV.JSON")],
    ["spell-case-new-endpoints", "create", join(userData, "CODEPUPPY-DISCOVERED-ENDPOINTS.JSON")],
    ...(existsSync(`/System/Volumes/Data${userData}`)
      ? ([
          ["spell-firmlink-cf2", "file", `/System/Volumes/Data${join(userData, "codepuppy-engine-config", "codepuppy-explicit.json")}`],
          ["spell-firmlink-cf8", "file", `/System/Volumes/Data${join(xdgConfig, "opencode.json")}`],
        ] as const)
      : []),
    ["vol-cf2", "vol", join(userData, "codepuppy-engine-config", "codepuppy-explicit.json")],
    ["vol-cf3", "vol", join(userData, "codepuppy-shell-env.json")],
    ["vol-dat", "vol", join(userData, "default.dat")],
  ]
  return calls
}

function script(calls: ReturnType<typeof matrix>) {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
  return [`ln -sfn ${quote(userData)} ${quote(join(ws, "via-userdata"))} 2>/dev/null`, ...calls.map(([label, mode, path]) => [ops, label, mode, path, ws].map(quote).join(" "))].join("\n")
}

function fenced(profile: string, command: string[], inside = ws) {
  const profileFile = join(run, `profile-${Math.random().toString(36).slice(2)}.sb`)
  writeFileSync(profileFile, profile)
  const result = spawnSync(process.execPath, ["-e", DRIVER, addon, profileFile, inside, ...command], { cwd: inside, encoding: "utf8", timeout: 120_000 })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

/** label:op → "OK" | "FAIL <errno>" from config-fence-ops output. */
function parsed(out: string) {
  const results = new Map<string, string>()
  for (const line of out.split("\n")) {
    const match = /^([\w-]+:[\w-]+)\t(OK|FAIL \d+)$/.exec(line)
    if (match) results.set(match[1]!, match[2]!)
  }
  return results
}

/** A second fake machine (its own HOME, userData, state root and workspace) for the arms whose planner input differs. */
function tree(name: string) {
  const root = join(run, name)
  rmSync(root, { recursive: true, force: true })
  const t = { root, home: join(root, "home"), ws: join(root, "ws"), state: join(root, "home", "Library", "Application Support", "codepuppy-state"), userData: join(root, "home", "Library", "Application Support", "Code Puppy Data") }
  for (const directory of [t.home, t.ws, join(t.state, "env", "dev"), t.userData]) mkdirSync(directory, { recursive: true })
  return { ...t, env: join(t.state, "env", "dev") }
}

/** The production planner for such a machine (same deps as beforeAll). */
function planFor(t: ReturnType<typeof tree>, options: { userData?: string; envFile?: string; configHome?: string } = {}) {
  const userDataPath = options.userData ?? t.userData
  const config = options.configHome ?? join(t.home, ".config")
  return planProcessFence(
    {
      userDataPath,
      sidecarEnv: { HOME: t.home, XDG_DATA_HOME: join(t.home, ".local", "share"), XDG_CACHE_HOME: join(t.home, ".cache"), XDG_CONFIG_HOME: config, XDG_STATE_HOME: userDataPath },
      addon: { packaged: true, resourcesPath: join(run, "resources"), moduleDir: "/unused", exists: existsSync },
      egressProxyPort: 59999,
      carriedWorkspaces: [],
      engineConfigDirectory: join(config, "opencode"),
      ...(options.envFile ? { envFile: options.envFile } : {}),
    },
    {
      homeDir: () => t.home, codepuppyGlobalRoot: () => t.env, appStateRoot: () => t.state, realpath: (path) => realpathSync.native(path),
      defaultWorkspace: () => t.ws, readWorkspaces: () => [], isDirectory: (path) => statSync(path).isDirectory(),
      mkdirp: (path) => void mkdirSync(path, { recursive: true }), compile: trialCompileProfile, log: () => {},
    },
  )
}

/** Run the attack matrix under `profile`; label:op → "OK" | "FAIL <errno>". */
function attack(profile: string) {
  build()
  const calls = matrix()
  const { status, out } = fenced(profile, ["/bin/sh", "-c", script(calls)])
  expect(status, out).toBe(0)
  const results = new Map<string, string>()
  for (const line of out.split("\n")) {
    const match = /^([\w-]+:[\w-]+)\t(OK|FAIL \d+)$/.exec(line)
    if (match) results.set(match[1]!, match[2]!)
  }
  // every location answered: a missing label means the matrix itself broke (not «refused»)
  for (const [label] of calls) expect([...results.keys()].some((key) => key.startsWith(`${label}:`)), `${label}\n${out}`).toBe(true)
  // exactly the attempts the matrix asks for (final review 6b): a dropped operation in the helper, or a vol-stat failure, turns this red
  const expected = calls.flatMap(([label, mode]) => OPS[mode].map((op) => `${label}:${op}`))
  expect([...results.keys()].sort()).toEqual(expected.sort())
  const landed = [...results].filter(([, result]) => result === "OK").map(([key]) => key)
  console.log(`[E1] ${calls.length} locations / spellings, ${results.size} attempts, ${landed.length} landed${landed.length ? `: ${landed.join(" ")}` : ""}`)
  return results
}

const cfBlocks = (profile: string) => profile.indexOf("(deny file-write*\n", profile.indexOf("(allow network-outbound"))
const X1_LINE = `(allow file-write* (extension "${WORKSPACE_WRITE_EXTENSION_CLASS}"))`
/** Today's rows: the protected blocks gone, W2 (the environment root) and W6 (<XDG_CONFIG_HOME>/opencode) back in the allow block. */
const withoutProtectedSet = (profile: string) =>
  profile.slice(0, cfBlocks(profile)).replace(/^(.*; W3)$/m, `$1\n  (subpath "${env}")   ; W2\n  (subpath "${xdgConfig}")   ; W6`)
const blocksBeforeAllow = (profile: string) => {
  const blocks = profile.slice(cfBlocks(profile))
  return profile.slice(0, cfBlocks(profile)).replace("(deny file-write*)\n", `(deny file-write*)\n${blocks}`)
}
const withoutAncestors = (profile: string) => profile.split("\n").filter((line) => !line.includes("; CF 上级目录节点")).join("\n")
const x1AfterBlocks = (profile: string) => {
  const line = profile.split("\n").find((entry) => entry.startsWith(X1_LINE))!
  return `${profile.split("\n").filter((entry) => entry !== line).join("\n")}${line}\n`
}
/** CF-9 (DESIGN §4.1): the whole ~/.opencode. */
const dotOpencode = join(home, ".opencode")
/** CF-9 alone taken out of the protected block (W16 stays deleted). */
const withoutCf9 = (profile: string) => {
  const lines = profile.split("\n")
  const at = lines.flatMap((line, index) => (line.trim() === `(subpath "${dotOpencode}")` ? [index] : []))
  expect(at.length, profile).toBe(1)
  return lines.filter((_, index) => index !== at[0]).join("\n")
}
/** Today's rows for ~/.opencode (AC-08 known bad): W16 back in the allow block, no CF-9. */
const todaysRows = (profile: string) => withoutCf9(profile).replace(/^(.*; W15)$/m, `$1\n  (subpath "${dotOpencode}")   ; W16`)
const onDisk = (path: string) => {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}
/** A machine that already has ~/.opencode (an earlier version's plan folder among it); made outside the fence. */
function seedDotOpencode() {
  mkdirSync(join(dotOpencode, "plan"), { recursive: true })
  mkdirSync(join(dotOpencode, "plugin"), { recursive: true })
  writeFileSync(join(dotOpencode, "opencode.json"), "{}\n")
  writeFileSync(join(dotOpencode, "plan", "old.md"), "# old plan\n")
  writeFileSync(join(dotOpencode, "plugin", "p.js"), "export default {}\n")
}
const dotOpencodeState = () =>
  [dotOpencode, join(dotOpencode, "plan"), join(dotOpencode, "plugin"), join(dotOpencode, "opencode.json"), join(dotOpencode, "plan", "old.md"), join(dotOpencode, "plugin", "p.js")].map((path) => {
    const meta = statSync(path)
    return { path, mode: meta.mode, entries: meta.isDirectory() ? readdirSync(path).sort() : undefined, text: meta.isDirectory() ? undefined : readFileSync(path, "utf8") }
  })
const withoutLinkTarget = (profile: string) => profile.split("\n").filter((line) => line.trim() !== `(subpath "${realpathSync(linkedTarget)}")`).join("\n")

beforeAll(() => {
  build()
  const resources = join(run, "resources")
  addon = buildFenceAddon({ out: join(resources, "codepuppy-fence", "codepuppy_fence.node"), buildId: `config-fence-${Date.now()}` }).out
  const built = spawnSync("clang", [join(import.meta.dir, "../../native/codepuppy-fence/test/config-fence-ops.c"), "-o", ops], { encoding: "utf8" })
  expect(built.status, built.stderr).toBe(0)
  const log: string[] = []
  plan = planProcessFence(
    {
      userDataPath: userData,
      sidecarEnv: { HOME: home, XDG_DATA_HOME: dataHome, XDG_CACHE_HOME: cacheHome, XDG_CONFIG_HOME: configHome, XDG_STATE_HOME: userData },
      addon: { packaged: true, resourcesPath: resources, moduleDir: "/unused", exists: existsSync },
      egressProxyPort: 59999,
      carriedWorkspaces: [],
      engineConfigDirectory: cfgDir,
    },
    {
      homeDir: () => home, codepuppyGlobalRoot: () => env, appStateRoot: () => state, realpath: (path) => realpathSync.native(path),
      defaultWorkspace: () => ws, readWorkspaces: () => [], isDirectory: (path) => statSync(path).isDirectory(),
      mkdirp: (path) => void mkdirSync(path, { recursive: true }), compile: trialCompileProfile, log: (line) => void log.push(line),
    },
  )
  expect(plan.addonPath).toBe(addon)
}, 180_000)

test("layout: the fake tree is under no writable row except the workspace (W1) and userData (W3); the planner protected the symlinked location's real target", () => {
  const rules = processFenceWriteRules(plan.profile)
  for (const path of [home, appSupport, state, env, configHome, xdgConfig, cfgDir, run]) expect(processFenceRulesCover({ allow: rules.allow, deny: [] }, path), path).toBe(false)
  expect(processFenceRulesCover({ allow: rules.allow, deny: [] }, join(userData, "codepuppy.env"))).toBe(true)
  expect(processFenceRulesCover({ allow: rules.allow, deny: [] }, join(linkedTarget, "record.json"))).toBe(true)
  expect(plan.configFenceRoots).toContain(realpathSync(linkedTarget))
  expect(rules.deny).toContainEqual({ kind: "subpath", value: realpathSync(linkedTarget) })
  expect(plan.profile).not.toContain("; W2")
  expect(plan.profile).not.toContain("; W6")
})

test("production: every operation on every protected location and every ancestor node, and the other spellings (symlink, case, firmlink, /.vol on the locations listed in matrix()), is refused with EPERM; afterwards nothing changed on disk", () => {
  build()
  const before = snapshot()
  const results = attack(plan.profile)
  const refused = [...results].filter(([, result]) => result !== "FAIL 1")
  expect(refused, JSON.stringify(Object.fromEntries(results), null, 1)).toEqual([])
  // named, not incidental: a literal rule stops CREATING a file that does not exist yet (by every creation method); the *.dat rule matches
  // any letter case of the extension; ancestor nodes are frozen themselves (HOME among them)
  for (const label of ["cf5-discovered", "cf10-jsonc", "cf7-new-dat", "cf7-new-DAT", "cf7-new-Dat", "spell-case-new-endpoints"])
    for (const op of ["create", "symlink-at", "mkdir-at", "rename-into", "hardlink-at", "clone-at"]) expect(results.get(`${label}:${op}`), `${label}:${op}`).toBe("FAIL 1")
  for (const key of ["spell-case-dat:append", "cf7-dat:unlink", "anc-home:rename-ancestor-away", "anc-userdata:rename-ancestor-away", "anc-config:rename-ancestor-away"]) expect(results.get(key), key).toBe("FAIL 1")
  expect(results.size).toBe(matrix().reduce((sum, [, mode]) => sum + OPS[mode].length, 0))
  // attack() rebuilt the tree before running; the snapshot taken outside the fence afterwards must equal a fresh tree's
  const after = snapshot()
  expect(after.files.map(({ file, text, mode }) => ({ file, text, mode }))).toEqual(before.files.map(({ file, text, mode }) => ({ file, text, mode })))
  expect(after.listings).toEqual(before.listings)
  expect(after.absent).toEqual(before.absent)
})

test("known bad — the protected set removed, W2 / W6 restored (today's rows): the attacks on locations those rows cover land", () => {
  const results = attack(withoutProtectedSet(plan.profile))
  for (const label of ["cf1-jsonc", "cf2-explicit", "cf2-models", "cf3", "cf4", "cf5", "cf6-target-record", "cf7-settings", "cf7-updater", "cf7-dat", "cf8-xdg", "spell-case-cf4", "spell-link-cf4", "vol-cf3"])
    for (const op of label.startsWith("vol") ? ["vol-append", "vol-rename-over"] : ["append", "truncate", "write-new-then-rename-over", "rename-workspace-file-over", "swap", "unlink"])
      expect(results.get(`${label}:${op}`), `${label}:${op}`).toBe("OK")
  for (const label of ["cf2-dir", "cf8-xdg-dir", "cf6-target-dir", "cf1-env"]) expect(results.get(`${label}:create-inside`), label).toBe("OK")
  for (const label of ["cf7-new-dat", "cf7-new-DAT", "cf5-discovered"]) expect(results.get(`${label}:create`), label).toBe("OK")
  expect(results.get("anc-userdata:rename-ancestor-away")).toBe("OK")
  // positive controls for the helper (final review 6c): where nothing protects the location, EVERY operation of each mode succeeds —
  // so a «FAIL» in the production arm is the fence, not an operation that cannot work; the firmlink spellings reach the same objects
  for (const [label, mode] of [["cf3", "file"], ["cf2-dir", "dir"], ["cf5-discovered", "create"], ["spell-firmlink-cf2", "file"], ["spell-firmlink-cf8", "file"]] as const)
    if (mode !== "file" || !label.startsWith("spell-firmlink") || existsSync(`/System/Volumes/Data${userData}`))
      for (const op of OPS[mode]) expect(results.get(`${label}:${op}`), `${label}:${op}`).toBe("OK")
  // what today's rows never covered stays refused (HOME, the state root itself, an exported config directory): CF-10 is listed so the
  // guarantee does not depend on those details
  for (const key of ["cf10-json:append", "cf1-state:create-inside", "cf8-cfg:append"]) expect(results.get(key), key).toBe("FAIL 1")
})

test("known bad — the protected blocks rendered before the allow block: the later allow rows win and the attacks land", () => {
  const results = attack(blocksBeforeAllow(plan.profile))
  for (const label of ["cf2-explicit", "cf3", "cf4", "cf7-dat", "cf6-target-record"])
    for (const op of ["append", "write-new-then-rename-over", "unlink"]) expect(results.get(`${label}:${op}`), `${label}:${op}`).toBe("OK")
  expect(results.get("cf2-dir:create-inside")).toBe("OK")
})

test("known bad — no ancestors block: userData itself can be renamed away (and with it every protected file inside)", () => {
  expect(attack(plan.profile).get("anc-userdata:rename-ancestor-away")).toBe("FAIL 1")
  const results = attack(withoutAncestors(plan.profile))
  expect(results.get("anc-userdata:rename-ancestor-away")).toBe("OK")
  // the locations themselves stay protected; only the ancestor nodes came loose
  expect(results.get("cf4:append")).toBe("FAIL 1")
})

test("symlinked location: its real target is refused through either path; known bad — rendered without the target, a write through the target lands", () => {
  const production = attack(plan.profile)
  for (const key of ["cf6-via-link:append", "cf6-target-record:append", "cf6-target-record:unlink", "cf6-target-dir:create-inside"]) expect(production.get(key), key).toBe("FAIL 1")
  const bad = attack(withoutLinkTarget(plan.profile))
  expect(bad.get("cf6-target-record:append")).toBe("OK")
  expect(bad.get("cf6-target-dir:create-inside")).toBe("OK")
})

/** Run `command` fenced, after this process issued the fenced child `times` run-time grants (X1) for `directory`. */
async function granted(profile: string, directory: string, command: string[], times = 1, prepare?: () => void) {
  build()
  prepare?.()
  const profileFile = join(run, `profile-grant-${Math.random().toString(36).slice(2)}.sb`)
  writeFileSync(profileFile, profile)
  const child = Bun.spawn([process.execPath, "-e", GRANT_DRIVER, addon, profileFile, ws, ...command], { cwd: ws, stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  const timer = setTimeout(() => child.kill(), 60_000)
  const decoder = new TextDecoder()
  let out = ""
  let issued = false
  for await (const chunk of child.stdout) {
    out += decoder.decode(chunk, { stream: true })
    const pid = /^PID (\d+)$/m.exec(out)?.[1]
    if (pid && !issued) {
      issued = true
      for (let i = 0; i < times; i++) {
        const grant = loadFenceAddon(addon).issueFileExtensionToProcess(WORKSPACE_WRITE_EXTENSION_CLASS, realpathSync(directory), Number(pid))
        expect(grant.token, JSON.stringify(grant)).not.toBeNull()
        child.stdin.write(`${grant.token}\n`)
      }
      child.stdin.write("END\n")
      child.stdin.flush()
    }
  }
  const status = await child.exited
  clearTimeout(timer)
  out += await new Response(child.stderr).text()
  expect(status, out).toBe(0)
  expect(out.match(/^CONSUMED \d+$/gm)?.length, out).toBe(times)
  const results = new Map<string, string>()
  for (const line of out.split("\n")) {
    const match = /^([\w-]+:[\w-]+)\t(OK|FAIL \d+)$/.exec(line)
    if (match) results.set(match[1]!, match[2]!)
  }
  return { results, out }
}

test("X1 (AC-02 at the fence): ~/.config — itself an ancestor node, so it goes through the issue path — granted (and issued twice, harmlessly): other files land, the protected location is still refused; known bad — X1 rendered after the protected blocks ⇒ the protected location is written", async () => {
  // ${label}-cfghome renames the GRANTED ancestor node itself (final review 5): only the ancestors block (after X1) stops that
  const command = (label: string) => ["/bin/sh", "-c", `mkdir -p '${join(configHome, "other-app")}' && echo x > '${join(configHome, "other-app", "x")}' && echo other-app-written; '${ops}' ${label} file '${join(xdgConfig, "opencode.json")}' '${ws}'; '${ops}' ${label}-anc ancestor '${xdgConfig}' '${ws}'; '${ops}' ${label}-cfghome ancestor '${configHome}' '${ws}'`]
  // ~/.config is an ancestor node of <XDG_CONFIG_HOME>/opencode: its literal deny keeps it «not covered», so main issues for it and may
  // issue once more for a possibly consumed token (server.ts possiblyConsumed, D14) — two extensions for the same folder, consumed both
  expect(processFenceRulesCover(processFenceWriteRules(plan.profile), configHome)).toBe(false)
  const production = await granted(plan.profile, configHome, command("x1"), 2)
  expect(production.out).toContain("other-app-written")
  for (const op of ["append", "truncate", "write-new-then-rename-over", "rename-workspace-file-over", "swap", "unlink"]) expect(production.results.get(`x1:${op}`), op).toBe("FAIL 1")
  expect(production.results.get("x1-anc:rename-ancestor-away")).toBe("FAIL 1")
  expect(production.results.get("x1-cfghome:rename-ancestor-away")).toBe("FAIL 1")
  const bad = await granted(x1AfterBlocks(plan.profile), configHome, command("x1"))
  expect(bad.out).toContain("other-app-written")
  expect(bad.results.get("x1:append")).toBe("OK")
  expect(bad.results.get("x1-cfghome:rename-ancestor-away")).toBe("OK")
})

test("E2: under the same profile the engine and its children keep writing (state, database and -wal, logs, cache, ~/.npm, uv-cache, workspace, other userData files; mkdir -p on an existing protected directory); R8 control: a user's nested symlink inside a protected directory still writes to its target", () => {
  build()
  const writes = [
    `mkdir -p '${join(userData, "opencode", "locks")}' && echo x > '${join(userData, "opencode", "locks", "l")}'`,
    `echo x > '${join(dataHome, "opencode", "opencode.db")}' && echo x > '${join(dataHome, "opencode", "opencode.db-wal")}' && echo x > '${join(dataHome, "opencode", "opencode.db-shm")}'`,
    `mkdir -p '${join(dataHome, "opencode", "log")}' && echo x > '${join(dataHome, "opencode", "log", "a.log")}'`,
    `echo x > '${join(cacheHome, "opencode", "pkg")}' && echo x > '${join(home, ".npm", "x")}' && echo x > '${join(userData, "uv-cache", "x")}'`,
    `echo x > '${join(ws, "x")}' && echo x > '${join(userData, "new.txt")}' && mv '${join(userData, "new.txt")}' '${join(userData, "moved.txt")}' && rm '${join(userData, "moved.txt")}' && echo y >> '${join(userData, "other.txt")}'`,
    `mkdir -p '${xdgConfig}' '${cfgDir}' '${join(userData, "codepuppy-engine-config")}' '${state}'`,
    `'${process.execPath}' -e 'for (const d of process.argv.slice(1)) require("fs").mkdirSync(d, { recursive: true })' '${xdgConfig}' '${cfgDir}' '${join(userData, "codepuppy-engine-config")}'`,
    `echo r8 > '${join(xdgConfig, "plugin", "x.js")}'`,
    // the HOME node is frozen, its contents are not: the zsh history rename-over (W8) still works
    `echo h > '${join(home, ".zsh_history.new")}' && mv '${join(home, ".zsh_history.new")}' '${join(home, ".zsh_history")}'`,
  ]
  const { status, out } = fenced(plan.profile, ["/bin/sh", "-c", writes.map((line, i) => `(${line}) && echo E2-${i}-OK || echo E2-${i}-FAIL`).join("\n")])
  expect(status, out).toBe(0)
  for (let i = 0; i < writes.length; i++) expect(out, `${writes[i]}\n${out}`).toContain(`E2-${i}-OK`)
  for (const file of [join(userData, "opencode", "locks", "l"), join(dataHome, "opencode", "opencode.db-wal"), join(cacheHome, "opencode", "pkg"), join(home, ".npm", "x"), join(userData, "uv-cache", "x"), join(ws, "x")])
    expect(existsSync(file), file).toBe(true)
  expect(readFileSync(join(userData, "other.txt"), "utf8")).toBe("other\ny\n")
  // R8 (outside the guarantee, design §1 (a) / §6): the write followed the user's link to its writable target
  expect(readFileSync(join(ws, "dotfiles-plugin", "x.js"), "utf8")).toBe("r8\n")
  expect(readFileSync(join(home, ".zsh_history"), "utf8")).toBe("h\n")
})

test("AC-08 production (BR-07): ~/.opencode absent — a regular file, symlink, mkdir, mkdir -p, hard link, a file or a prepared directory renamed or cloned onto it are all refused and it is still absent; present — every write under it is refused (also under a run-time grant for it), reads work; the plan directory under the engine data directory is created lazily and written", async () => {
  // in the protected set as the whole directory, and nothing pre-created it
  expect(processFenceWriteRules(plan.profile).deny).toContainEqual({ kind: "subpath", value: dotOpencode })
  expect(processFenceWriteRules(plan.profile).allow.some((rule) => rule.value === dotOpencode)).toBe(false)
  expect(plan.configFenceRoots).toContain(dotOpencode)
  build()
  expect(onDisk(dotOpencode)).toBe(false)
  const planDir = join(dataHome, "opencode", "plan")
  const absent = fenced(plan.profile, [
    "/bin/sh",
    "-c",
    [
      `'${ops}' cf9 create '${dotOpencode}' '${ws}'`,
      `'${ops}' cf9-dir create-dir '${dotOpencode}' '${ws}'`,
      // the write tool's shape: missing parents created, then the file; and write-temp-then-rename over it
      `'${process.execPath}' -e 'const fs = require("fs"), p = require("path"), d = process.argv[1]; fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(p.join(d, "a.md"), "# plan a\\n"); fs.writeFileSync(p.join(d, ".b.tmp"), "# plan b\\n"); fs.renameSync(p.join(d, ".b.tmp"), p.join(d, "b.md")); console.log("PLAN-WRITTEN")' '${planDir}'`,
    ].join("\n"),
  ])
  expect(absent.status, absent.out).toBe(0)
  const created = parsed(absent.out)
  const creation = [...OPS.create.map((op) => `cf9:${op}`), ...OPS["create-dir"].map((op) => `cf9-dir:${op}`)]
  expect(creation.map((key) => [key, created.get(key)])).toEqual(creation.map((key) => [key, "FAIL 1"]))
  expect(onDisk(dotOpencode)).toBe(false)
  expect(absent.out).toContain("PLAN-WRITTEN")
  expect(readFileSync(join(planDir, "a.md"), "utf8")).toBe("# plan a\n")
  expect(readFileSync(join(planDir, "b.md"), "utf8")).toBe("# plan b\n")

  build()
  seedDotOpencode()
  const before = dotOpencodeState()
  const present = fenced(plan.profile, [
    "/bin/sh",
    "-c",
    [
      `'${ops}' cf9-old file '${join(dotOpencode, "plan", "old.md")}' '${ws}'`,
      `'${ops}' cf9-json file '${join(dotOpencode, "opencode.json")}' '${ws}'`,
      `'${ops}' cf9-root dir '${dotOpencode}' '${ws}'`,
      `'${ops}' cf9-plan dir '${join(dotOpencode, "plan")}' '${ws}'`,
      `'${ops}' cf9-plugin dir '${join(dotOpencode, "plugin")}' '${ws}'`,
      `cat '${join(dotOpencode, "plan", "old.md")}' && echo READ-OK`,
    ].join("\n"),
  ])
  expect(present.status, present.out).toBe(0)
  const writes = parsed(present.out)
  const expected = [
    ...["cf9-old", "cf9-json"].flatMap((label) => OPS.file.map((op) => `${label}:${op}`)),
    ...["cf9-root", "cf9-plan", "cf9-plugin"].flatMap((label) => OPS.dir.map((op) => `${label}:${op}`)),
  ]
  expect([...writes.keys()].sort()).toEqual([...expected].sort())
  expect(expected.map((key) => [key, writes.get(key)])).toEqual(expected.map((key) => [key, "FAIL 1"]))
  expect(present.out).toContain("# old plan\nREAD-OK")
  expect(dotOpencodeState()).toEqual(before)

  // a run-time grant (X1) for ~/.opencode itself does not open it: the protected blocks come after X1
  const grantedWrites = await granted(plan.profile, dotOpencode, ["/bin/sh", "-c", `'${ops}' x9 file '${join(dotOpencode, "plan", "old.md")}' '${ws}'; '${ops}' x9-dir dir '${dotOpencode}' '${ws}'`], 1, seedDotOpencode)
  for (const op of OPS.file) expect(grantedWrites.results.get(`x9:${op}`), `x9:${op}`).toBe("FAIL 1")
  for (const op of OPS.dir) expect(grantedWrites.results.get(`x9-dir:${op}`), `x9-dir:${op}`).toBe("FAIL 1")
  expect(readFileSync(join(dotOpencode, "plan", "old.md"), "utf8")).toBe("# old plan\n")
})

test("AC-08 known bad — today's rows (W16 back, CF-9 out): every creation form lands and writes under an existing ~/.opencode land; CF-9 out alone (W16 stays deleted): a run-time grant for ~/.opencode lets writes under it land", async () => {
  const today = todaysRows(plan.profile)
  expect(processFenceWriteRules(today).allow).toContainEqual({ kind: "subpath", value: dotOpencode })
  expect(processFenceWriteRules(today).deny.some((rule) => rule.value === dotOpencode)).toBe(false)
  build()
  const absent = fenced(today, ["/bin/sh", "-c", `'${ops}' cf9 create '${dotOpencode}' '${ws}'\n'${ops}' cf9-dir create-dir '${dotOpencode}' '${ws}'`])
  const created = parsed(absent.out)
  const creation = [...OPS.create.map((op) => `cf9:${op}`), ...OPS["create-dir"].map((op) => `cf9-dir:${op}`)]
  expect(creation.map((key) => [key, created.get(key)])).toEqual(creation.map((key) => [key, "OK"]))
  expect(onDisk(dotOpencode)).toBe(false) // the helper removed what each attempt made

  build()
  seedDotOpencode()
  const present = fenced(today, ["/bin/sh", "-c", `'${ops}' cf9-old file '${join(dotOpencode, "plan", "old.md")}' '${ws}'\n'${ops}' cf9-root dir '${dotOpencode}' '${ws}'`])
  const writes = parsed(present.out)
  for (const op of ["append", "truncate", "write-new-then-rename-over", "rename-workspace-file-over", "unlink"]) expect(writes.get(`cf9-old:${op}`), `cf9-old:${op}`).toBe("OK")
  for (const op of ["create-inside", "mkdir-child"]) expect(writes.get(`cf9-root:${op}`), `cf9-root:${op}`).toBe("OK")

  // the CF-9 line on its own: W16 stays deleted, so only a grant reaches ~/.opencode — and without CF-9 it opens it
  const loose = await granted(withoutCf9(plan.profile), dotOpencode, ["/bin/sh", "-c", `'${ops}' x9 file '${join(dotOpencode, "plan", "old.md")}' '${ws}'; '${ops}' x9-dir dir '${dotOpencode}' '${ws}'`], 1, seedDotOpencode)
  for (const op of ["append", "truncate", "write-new-then-rename-over", "unlink"]) expect(loose.results.get(`x9:${op}`), `x9:${op}`).toBe("OK")
  expect(loose.results.get("x9-dir:create-inside")).toBe("OK")
})

test("修订 2 A: CODEPUPPY_ENV_FILE inside a project — append (a platform URL), rename-over, delete and renaming a directory on its path are refused; a sibling file in the same folder lands; a file under a not-yet-existing directory plans fine and cannot be created; known bad — the row removed ⇒ the writes land", () => {
  const setup = () => {
    const t = tree("envfile")
    const envFile = join(t.ws, "proj", "conf", "cp.env")
    mkdirSync(join(t.ws, "proj", "conf"), { recursive: true })
    mkdirSync(join(t.ws, "proj2"), { recursive: true })
    writeFileSync(envFile, "CODEPUPPY_PLATFORM_URL=https://platform.example\n")
    return { t, envFile, conf: join(t.ws, "proj", "conf"), missing: join(t.ws, "proj2", "missing", "dir", "cp.env") }
  }
  const script = (x: ReturnType<typeof setup>) =>
    [
      `'${ops}' env file '${x.envFile}' '${x.t.ws}'`,
      `'${ops}' env-dir ancestor '${x.conf}' '${x.t.ws}'`,
      `echo x > '${join(x.conf, "other.txt")}' && echo SIBLING-OK || echo SIBLING-FAILED`,
      // last, so its effect is what is left on disk when it lands
      `echo 'CODEPUPPY_PLATFORM_URL=https://evil.invalid' >> '${x.envFile}' && echo APPENDED || echo APPEND-FAILED`,
    ].join("\n")
  const production = setup()
  const plan = planFor(production.t, { envFile: production.envFile })
  expect(processFenceWriteRules(plan.profile).deny).toContainEqual({ kind: "literal", value: realpathSync(production.envFile) })
  const refused = fenced(plan.profile, ["/bin/sh", "-c", script(production)], production.t.ws)
  const results = parsed(refused.out)
  expect(refused.out).toContain("APPEND-FAILED")
  expect(refused.out).toContain("SIBLING-OK")
  for (const op of ["append", "truncate", "write-new-then-rename-over", "rename-workspace-file-over", "swap", "rename-away", "hardlink-alias", "chmod", "unlink"]) expect(results.get(`env:${op}`), op).toBe("FAIL 1")
  expect(results.get("env-dir:rename-ancestor-away")).toBe("FAIL 1")
  expect(readFileSync(production.envFile, "utf8")).toBe("CODEPUPPY_PLATFORM_URL=https://platform.example\n")
  expect(existsSync(join(production.conf, "other.txt"))).toBe(true)
  // the parent directory does not exist yet: the plan does not fail, and the fenced tree cannot create the directory or the file
  const absent = setup()
  const absentPlan = planFor(absent.t, { envFile: absent.missing })
  const create = fenced(absentPlan.profile, ["/bin/sh", "-c", `mkdir -p '${join(absent.t.ws, "proj2", "missing", "dir")}' && echo MKDIR-OK || echo MKDIR-FAILED\n'${ops}' env-new create '${absent.missing}' '${absent.t.ws}'\nmkdir '${join(absent.t.ws, "proj2", "missing")}' && echo MKDIR1-OK || echo MKDIR1-FAILED\necho x > '${join(absent.t.ws, "proj2", "sibling.txt")}' && echo SIBLING2-OK`], absent.t.ws)
  expect(create.out).toContain("MKDIR-FAILED")
  expect(create.out).toContain("MKDIR1-FAILED")
  expect(create.out).toContain("SIBLING2-OK")
  expect(existsSync(join(absent.t.ws, "proj2", "missing"))).toBe(false)
  // known bad: the same machine without the row
  const bad = setup()
  const landed = fenced(planFor(bad.t).profile, ["/bin/sh", "-c", script(bad)], bad.t.ws)
  expect(landed.out).toContain("APPENDED")
  expect(parsed(landed.out).get("env:write-new-then-rename-over")).toBe("OK")
  expect(parsed(landed.out).get("env-dir:rename-ancestor-away")).toBe("OK")
  expect(readFileSync(bad.envFile, "utf8")).toContain("https://evil.invalid")
})

test("修订 2 B: XDG_CONFIG_HOME is a symlink inside a project — deleting and recreating it, ln -sfn, renaming it away and putting a directory there, renaming the project folder above it are all refused; ordinary writes in the project land; known bad — ancestors along the real path only ⇒ all four land and the engine would read another configuration", () => {
  const setup = () => {
    const t = tree("cfglink")
    const project = join(t.ws, "proj-b")
    const link = join(project, "cfglink")
    mkdirSync(join(t.ws, "real-cfg", "opencode"), { recursive: true })
    writeFileSync(join(t.ws, "real-cfg", "opencode", "opencode.json"), "{}")
    mkdirSync(join(t.ws, "evil", "opencode"), { recursive: true })
    writeFileSync(join(t.ws, "evil", "opencode", "opencode.json"), '{"plugin":["evil"]}')
    mkdirSync(project, { recursive: true })
    symlinkSync(join(t.ws, "real-cfg"), link)
    return { t, project, link }
  }
  const attacks = (x: ReturnType<typeof setup>) => ({
    "rm-and-relink": `rm '${x.link}' && ln -s '${join(x.t.ws, "evil")}' '${x.link}'`,
    "ln-sfn": `ln -sfn '${join(x.t.ws, "evil")}' '${x.link}'`,
    "rename-away-then-mkdir": `mv '${x.link}' '${x.link}.away' && mkdir '${x.link}'`,
    "rename-project": `mv '${x.project}' '${x.project}.away'`,
  })
  const arm = (transform: (profile: string) => string) => {
    const outcomes: Record<string, { ok: boolean; reads: string }> = {}
    for (const name of Object.keys(attacks(setup()))) {
      const x = setup()
      const plan = planFor(x.t, { configHome: x.link })
      const result = fenced(transform(plan.profile), ["/bin/sh", "-c", `(${attacks(x)[name as keyof ReturnType<typeof attacks>]}) && echo ATTACK-OK || echo ATTACK-FAILED`], x.t.ws)
      let reads = ""
      try {
        reads = readFileSync(join(x.link, "opencode", "opencode.json"), "utf8")
      } catch {}
      outcomes[name] = { ok: result.out.includes("ATTACK-OK"), reads }
    }
    return outcomes
  }
  const x = setup()
  const plan = planFor(x.t, { configHome: x.link })
  const deny = processFenceWriteRules(plan.profile).deny
  expect(deny).toContainEqual({ kind: "literal", value: realpathSync(x.project) + "/cfglink" })
  expect(deny).toContainEqual({ kind: "literal", value: realpathSync(x.project) })
  const ordinary = fenced(plan.profile, ["/bin/sh", "-c", `echo x > '${join(x.project, "note.txt")}' && mkdir '${join(x.project, "src")}' && echo ORDINARY-OK`], x.t.ws)
  expect(ordinary.out).toContain("ORDINARY-OK")
  const production = arm((profile) => profile)
  console.log(`[B production] ${JSON.stringify(production)}`)
  for (const [name, outcome] of Object.entries(production)) expect({ name, ...outcome }).toEqual({ name, ok: false, reads: "{}" })
  // known bad: drop the configured-path nodes from the ancestors block (the real-path ancestors stay)
  const realOnly = (profile: string) =>
    profile
      .split("\n")
      .map((line) => (line.includes("; CF 上级目录节点") ? line.replace(` (literal "${realpathSync(x.project)}/cfglink")`, "").replace(` (literal "${realpathSync(x.project)}")`, "") : line))
      .join("\n")
  expect(realOnly(plan.profile)).not.toContain(`(literal "${realpathSync(x.project)}")`)
  const bad = arm(realOnly)
  console.log(`[B known bad] ${JSON.stringify(bad)}`)
  for (const [name, outcome] of Object.entries(bad)) expect({ name, ok: outcome.ok }).toEqual({ name, ok: true })
  expect(bad["ln-sfn"]!.reads).toBe('{"plugin":["evil"]}')
  expect(bad["rm-and-relink"]!.reads).toBe('{"plugin":["evil"]}')
})

test("userData itself is a symlink living in a project: protected files are refused through the link and through the real directory; the link node and the folder above it cannot be removed or renamed; other files in both places land", () => {
  const t = tree("udlink")
  const real = join(t.ws, "ud-real")
  const apps = join(t.ws, "apps")
  const link = join(apps, "ud-link")
  mkdirSync(real, { recursive: true })
  mkdirSync(apps, { recursive: true })
  writeFileSync(join(real, "codepuppy.env"), "FAKE=1\n")
  writeFileSync(join(real, "default.dat"), "{}")
  symlinkSync(real, link)
  const plan = planFor(t, { userData: link })
  const result = fenced(
    plan.profile,
    [
      "/bin/sh",
      "-c",
      [
        `'${ops}' via-link file '${join(link, "codepuppy.env")}' '${t.ws}'`,
        `'${ops}' via-real file '${join(real, "codepuppy.env")}' '${t.ws}'`,
        `'${ops}' dat-real file '${join(real, "default.dat")}' '${t.ws}'`,
        `rm '${link}' && echo RM-OK || echo RM-FAILED`,
        `mv '${link}' '${link}.away' && echo MV-LINK-OK || echo MV-LINK-FAILED`,
        `mv '${apps}' '${apps}.away' && echo MV-APPS-OK || echo MV-APPS-FAILED`,
        `echo x > '${join(real, "other.txt")}' && echo x > '${join(apps, "new.txt")}' && echo OTHERS-OK`,
      ].join("\n"),
    ],
    t.ws,
  )
  const results = parsed(result.out)
  for (const label of ["via-link", "via-real", "dat-real"])
    for (const op of ["append", "write-new-then-rename-over", "rename-workspace-file-over", "unlink"]) expect(results.get(`${label}:${op}`), `${label}:${op}`).toBe("FAIL 1")
  for (const marker of ["RM-FAILED", "MV-LINK-FAILED", "MV-APPS-FAILED", "OTHERS-OK"]) expect(result.out, result.out).toContain(marker)
  expect(readFileSync(join(link, "codepuppy.env"), "utf8")).toBe("FAKE=1\n")
})

test("终审第 2 条: CODEPUPPY_ENV_FILE=/dev/null — the plan emits no row for it, so the fenced tree can still write /dev/null and spawn children with ignored stdio", () => {
  const t = tree("devnull")
  const plan = planFor(t, { envFile: "/dev/null" })
  const result = fenced(
    plan.profile,
    [
      "/bin/sh",
      "-c",
      [
        "echo x > /dev/null && echo DEVNULL-OK || echo DEVNULL-FAILED",
        "/usr/bin/true < /dev/null > /dev/null 2>&1 && echo REDIRECT-OK || echo REDIRECT-FAILED",
        `'${process.execPath}' -e 'const r = require("node:child_process").spawnSync("/usr/bin/true", [], { stdio: "ignore" }); console.log(r.status === 0 ? "SPAWN-IGNORE-OK" : "SPAWN-IGNORE-FAILED " + r.error)'`,
      ].join("\n"),
    ],
    t.ws,
  )
  console.log(`[devnull] ${result.out.split("\n").filter((line) => /-(OK|FAILED)/.test(line)).join(" | ")}`)
  for (const marker of ["DEVNULL-OK", "REDIRECT-OK", "SPAWN-IGNORE-OK"]) expect(result.out, result.out).toContain(marker)
  expect(processFenceWriteRules(plan.profile).deny.filter((rule) => rule.value.startsWith("/dev"))).toEqual([])
})

test("终审第 3 条: a two-hop link chain inside a project (XDG_CONFIG_HOME = W/a/b, W/a → W/real-a, W/real-a/b → the real config) — swapping W/real-a for a staged folder whose b points elsewhere is refused; known bad — without the real-location chain of each configured node the swap lands and the engine would read another configuration", () => {
  const setup = () => {
    const t = tree("twohop")
    const W = t.ws
    mkdirSync(join(W, "cfg-real", "opencode"), { recursive: true })
    writeFileSync(join(W, "cfg-real", "opencode", "opencode.json"), "{}")
    mkdirSync(join(W, "evil", "opencode"), { recursive: true })
    writeFileSync(join(W, "evil", "opencode", "opencode.json"), '{"plugin":["evil"]}')
    mkdirSync(join(W, "real-a"), { recursive: true })
    symlinkSync(join(W, "cfg-real"), join(W, "real-a", "b"))
    symlinkSync(join(W, "real-a"), join(W, "a"))
    return { t, W, configHome: join(W, "a", "b") }
  }
  const swap = (W: string) => `mkdir '${W}/stage' && ln -s '${W}/evil' '${W}/stage/b' && mv '${W}/real-a' '${W}/old' && mv '${W}/stage' '${W}/real-a'`
  const arm = (transform: (profile: string, W: string) => string) => {
    const x = setup()
    const plan = planFor(x.t, { configHome: x.configHome })
    const result = fenced(transform(plan.profile, realpathSync(x.W)), ["/bin/sh", "-c", `(${swap(x.W)}) && echo SWAP-OK || echo SWAP-FAILED`], x.t.ws)
    return { landed: result.out.includes("SWAP-OK"), reads: readFileSync(join(x.configHome, "opencode", "opencode.json"), "utf8"), profile: plan.profile, W: realpathSync(x.W) }
  }
  const production = arm((profile) => profile)
  console.log(`[two-hop production] ${JSON.stringify({ landed: production.landed, reads: production.reads })}`)
  expect({ landed: production.landed, reads: production.reads }).toEqual({ landed: false, reads: "{}" })
  expect(processFenceWriteRules(production.profile).deny).toContainEqual({ kind: "literal", value: `${production.W}/real-a` })
  // known bad: today's (pre-fix) computation — the configured path's nodes only, not the real-location chain of each node
  const withoutChain = (profile: string, W: string) => profile.split("\n").map((line) => (line.includes("; CF 上级目录节点") ? line.replace(` (literal "${W}/real-a")`, "") : line)).join("\n")
  const bad = arm(withoutChain)
  expect({ landed: bad.landed, reads: bad.reads }).toEqual({ landed: true, reads: '{"plugin":["evil"]}' })
})

test("确认审查 R2 第 1 条: CODEPUPPY_ENV_FILE is a project symlink to /dev/null — writes through it still reach /dev/null, but the link itself cannot be removed or replaced by a regular file", () => {
  const t = tree("devlink")
  const link = join(t.ws, "proj", "cp.env")
  mkdirSync(join(t.ws, "proj"), { recursive: true })
  symlinkSync("/dev/null", link)
  const plan = planFor(t, { envFile: link })
  const result = fenced(
    plan.profile,
    [
      "/bin/sh",
      "-c",
      [
        `echo x > '${link}' && echo THROUGH-OK || echo THROUGH-FAILED`,
        "echo x > /dev/null && echo DEVNULL-OK || echo DEVNULL-FAILED",
        `rm '${link}' && echo RM-OK || echo RM-FAILED`,
        `echo 'CODEPUPPY_PLATFORM_URL=https://evil.invalid' > '${join(t.ws, "proj", "evil.env")}' && mv '${join(t.ws, "proj", "evil.env")}' '${link}' && echo REPLACE-OK || echo REPLACE-FAILED`,
      ].join("\n"),
    ],
    t.ws,
  )
  console.log(`[devlink] ${result.out.split("\n").filter((line) => /-(OK|FAILED)$/.test(line)).join(" | ")}`)
  for (const marker of ["THROUGH-OK", "DEVNULL-OK", "RM-FAILED", "REPLACE-FAILED"]) expect(result.out, result.out).toContain(marker)
  expect(lstatSync(link).isSymbolicLink()).toBe(true)
})

test("OUTSIDE the guarantee (residual R10, a documented boundary like R8 — not asserted as refused): a symlink that appears only inside another link's stored target text (XDG_CONFIG_HOME = W/a, W/a → W/s/t, W/s → W/real-s) is not frozen; replacing W/s re-points the configuration", () => {
  const t = tree("r10")
  const W = t.ws
  mkdirSync(join(W, "real-s", "t", "opencode"), { recursive: true })
  writeFileSync(join(W, "real-s", "t", "opencode", "opencode.json"), "{}")
  mkdirSync(join(W, "evil-s", "t", "opencode"), { recursive: true })
  writeFileSync(join(W, "evil-s", "t", "opencode", "opencode.json"), '{"plugin":["evil"]}')
  symlinkSync(join(W, "real-s"), join(W, "s"))
  symlinkSync(join(W, "s", "t"), join(W, "a"))
  const plan = planFor(t, { configHome: join(W, "a") })
  const deny = processFenceWriteRules(plan.profile).deny
  // frozen: every node of the configured path, of the real path, and the real ancestor chain of each configured-path node …
  for (const node of [join(realpathSync(W), "a"), join(realpathSync(W), "real-s"), join(realpathSync(W), "real-s", "t")]) expect(deny, node).toContainEqual({ kind: "literal", value: node })
  // … but not W/s, which only appears inside W/a's target text (closure: INT-safety I-27, one component-wise resolution)
  expect(deny).not.toContainEqual({ kind: "literal", value: join(realpathSync(W), "s") })
  const result = fenced(plan.profile, ["/bin/sh", "-c", `rm '${join(W, "s")}' && ln -s '${join(W, "evil-s")}' '${join(W, "s")}' && echo R10-LANDED || echo R10-REFUSED`], W)
  console.log(`[R10 outside the guarantee] ${result.out.includes("R10-LANDED") ? "landed" : "refused"}; the engine would read ${readFileSync(join(W, "a", "opencode", "opencode.json"), "utf8")}`)
  // documents today's boundary: when I-27 closes it, this arm flips and must be rewritten as a refused arm
  expect(result.out).toContain("R10-LANDED")
  expect(readFileSync(join(W, "a", "opencode", "opencode.json"), "utf8")).toBe('{"plugin":["evil"]}')
})
