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
let token = ""
for await (const chunk of process.stdin) { token += String(chunk); if (token.includes("\\n")) break }
const consumed = loadFenceAddon(addonPath).consumeExtension(token.trim())
process.stdout.write("CONSUMED " + consumed.handle + "\\n")
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

/** The attack script: every location × every operation, every spelling, every ancestor node. */
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

function fenced(profile: string, command: string[]) {
  const profileFile = join(run, `profile-${Math.random().toString(36).slice(2)}.sb`)
  writeFileSync(profileFile, profile)
  const result = spawnSync(process.execPath, ["-e", DRIVER, addon, profileFile, ws, ...command], { cwd: ws, encoding: "utf8", timeout: 120_000 })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
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

test("production: every attack on every protected location, every spelling and every ancestor node is refused with EPERM; afterwards nothing changed on disk", () => {
  build()
  const before = snapshot()
  const results = attack(plan.profile)
  const refused = [...results].filter(([, result]) => result !== "FAIL 1")
  expect(refused, JSON.stringify(Object.fromEntries(results), null, 1)).toEqual([])
  expect(results.size).toBeGreaterThan(200)
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

/** Run `command` fenced, after this process issued the fenced child a run-time grant (X1) for `directory`. */
async function granted(profile: string, directory: string, command: string[]) {
  build()
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
      const grant = loadFenceAddon(addon).issueFileExtensionToProcess(WORKSPACE_WRITE_EXTENSION_CLASS, realpathSync(directory), Number(pid))
      expect(grant.token, JSON.stringify(grant)).not.toBeNull()
      child.stdin.write(`${grant.token}\n`)
      child.stdin.flush()
    }
  }
  const status = await child.exited
  clearTimeout(timer)
  out += await new Response(child.stderr).text()
  expect(status, out).toBe(0)
  expect(out).toMatch(/^CONSUMED \d+$/m)
  const results = new Map<string, string>()
  for (const line of out.split("\n")) {
    const match = /^([\w-]+:[\w-]+)\t(OK|FAIL \d+)$/.exec(line)
    if (match) results.set(match[1]!, match[2]!)
  }
  return { results, out }
}

test("X1 (AC-02 at the fence): a grant for a folder that contains a protected location lets other files land and still refuses the protected one; known bad — X1 rendered after the protected blocks ⇒ the protected location is written", async () => {
  const command = (label: string) => ["/bin/sh", "-c", `mkdir -p '${join(configHome, "other-app")}' && echo x > '${join(configHome, "other-app", "x")}' && echo other-app-written; '${ops}' ${label} file '${join(xdgConfig, "opencode.json")}' '${ws}'; '${ops}' ${label}-anc ancestor '${xdgConfig}' '${ws}'`]
  const production = await granted(plan.profile, configHome, command("x1"))
  expect(production.out).toContain("other-app-written")
  for (const op of ["append", "truncate", "write-new-then-rename-over", "rename-workspace-file-over", "swap", "unlink"]) expect(production.results.get(`x1:${op}`), op).toBe("FAIL 1")
  expect(production.results.get("x1-anc:rename-ancestor-away")).toBe("FAIL 1")
  const bad = await granted(x1AfterBlocks(plan.profile), configHome, command("x1"))
  expect(bad.out).toContain("other-app-written")
  expect(bad.results.get("x1:append")).toBe("OK")
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
  ]
  const { status, out } = fenced(plan.profile, ["/bin/sh", "-c", writes.map((line, i) => `(${line}) && echo E2-${i}-OK || echo E2-${i}-FAIL`).join("\n")])
  expect(status, out).toBe(0)
  for (let i = 0; i < writes.length; i++) expect(out, `${writes[i]}\n${out}`).toContain(`E2-${i}-OK`)
  for (const file of [join(userData, "opencode", "locks", "l"), join(dataHome, "opencode", "opencode.db-wal"), join(cacheHome, "opencode", "pkg"), join(home, ".npm", "x"), join(userData, "uv-cache", "x"), join(ws, "x")])
    expect(existsSync(file), file).toBe(true)
  expect(readFileSync(join(userData, "other.txt"), "utf8")).toBe("other\ny\n")
  // R8 (outside the guarantee, design §1 (a) / §6): the write followed the user's link to its writable target
  expect(readFileSync(join(ws, "dotfiles-plugin", "x.js"), "utf8")).toBe("r8\n")
})
