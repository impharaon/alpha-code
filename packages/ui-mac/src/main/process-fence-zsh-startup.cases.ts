// SPEC-engine-config-fence BR-06 / AC-07 (DESIGN-engine-config-fence D15): nothing the fenced engine tree runs may plant
// content that a shell OUTSIDE the fence later executes. Apple Terminal's zsh sources `~/.zsh_sessions/<id>.session`;
// an rc with `compinit -C` sources `~/.zcompdump`. Run only through process-fence-zsh-startup.test.ts.
//
// "Production profile" below = the production render (renderProcessFenceProfile) with an empty protected set (configFence: [];
// this file judges the zsh rows only) + production fence (fat .node from the production build script, applied
// by applyProcessFence in a bun child; everything that child spawns inherits the seatbelt). Three arms in a fake HOME:
//   known bad  = the production profile with W10/W19 put back: the write lands and an unfenced zsh runs the marker;
//   production = the same writes are EPERM and the marker never runs;
//   app terminal = fenced `zsh -l` on a PTY with the sidecar-shaped environment, rc empty / compinit / compinit -C:
//                  the transcript is byte-identical under both profiles; with an oh-my-zsh-shaped rc (reconstruction)
//                  the production profile adds exactly one `rm: … Operation not permitted` line (known visible change).
// Everything lives under the worktree's node_modules/.cache (outside the fence: /private/tmp and $TMPDIR are W11/W12).
// The real HOME, its shell rc files and the Code Puppy user-data directory are never touched.

import { beforeAll, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { userInfo } from "node:os"
import { join } from "node:path"
import { buildFenceAddon } from "../../scripts/build-fence-addon"
import { processFenceRulesCover, processFenceWriteRules, renderProcessFenceProfile, resolveEngineRoots } from "./process-fence-profile"

const run = process.env.CODEPUPPY_ZSH_STARTUP_TEST_ROOT!
const home = join(run, "home")
const ws = join(run, "ws")
const markers = join(run, "markers")
const sessionFile = join(home, ".zsh_sessions", "x.session")
const dumpFile = join(home, ".zcompdump")
let addon = ""

// The fenced runner: production applyProcessFence on itself, then the command inherits the fence.
const DRIVER = `
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { applyProcessFence } from ${JSON.stringify(join(import.meta.dir, "process-fence-apply.ts"))}
const [addonPath, profileFile, insideDir, ...command] = process.argv.slice(1)
applyProcessFence({ addonPath, profile: readFileSync(profileFile, "utf8") }, { insideDir })
process.exit(spawnSync(command[0], command.slice(1), { stdio: "inherit" }).status ?? 125)
`

const production = renderProcessFenceProfile({
  workspaces: [ws], codepuppyGlobalRoot: join(run, "state"), userDataPath: join(run, "userData"), stateHome: join(run, "userData"),
  roots: resolveEngineRoots({}, home), egressProxyPort: 59999,
  // 本文件判 W10 / W19 两行;受保护配置集的判据在 process-fence-config-fence / process-fence-profile
  configFence: [],
  credentialStores: [],
})

/** Today's rows back in place, derived from the production text: W10 after W8, W19 = the W8 regex with the dump's name. */
function withZshRowsRestored(profile: string): string {
  const lines = profile.split("\n")
  const w8 = lines.findIndex((line) => /;\s*W8$/.test(line))
  if (w8 < 0) throw new Error("production profile has no W8 row")
  const w19 = lines[w8]!.replace("\\.zsh_history", "\\.zcompdump").replace(/W8$/, "W19")
  lines.splice(w8 + 1, 0, `  (subpath "${join(home, ".zsh_sessions")}")                       ; W10`, w19)
  return lines.join("\n")
}
const knownBad = withZshRowsRestored(production)
const profiles = { knownBad: join(run, "known-bad.sb"), production: join(run, "production.sb") }

const shellEnv = () => [`HOME=${home}`, `USER=${userInfo().username}`, `LOGNAME=${userInfo().username}`, "SHELL=/bin/zsh", "PATH=/usr/bin:/bin:/usr/sbin:/sbin", "LANG=en_US.UTF-8"]

function reset(rc?: string) {
  for (const directory of [home, ws, markers]) rmSync(directory, { recursive: true, force: true })
  for (const directory of [join(home, ".zsh_sessions"), ws, markers]) mkdirSync(directory, { recursive: true })
  if (rc !== undefined) writeFileSync(join(home, ".zshrc"), rc)
}

function fenced(profileFile: string, command: string[]) {
  const result = spawnSync(process.execPath, ["-e", DRIVER, addon, profileFile, ws, ...command], { cwd: ws, encoding: "utf8", timeout: 60_000 })
  return { status: result.status, out: `${result.stdout}${result.stderr}`.trim() }
}

/** A fenced shell writes `touch <marker>` into `target`. */
const plant = (profileFile: string, target: string, marker: string) =>
  fenced(profileFile, ["/bin/sh", "-c", 'echo "touch \\"$2\\"" > "$1" && echo OK', "sh", target, join(markers, marker)])

/** An unfenced interactive zsh with a clean, test-owned environment (no ZDOTDIR, HOME = the fake home). */
function unfencedZsh(extraEnv: string[]) {
  const result = spawnSync("/usr/bin/env", ["-i", ...shellEnv(), ...extraEnv, "/bin/zsh", "-i", "-c", "exit"], { cwd: ws, stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 })
  expect(result.status, String(result.stderr)).toBe(0)
}

const APPLE_TERMINAL = ["TERM_PROGRAM=Apple_Terminal", "TERM_SESSION_ID=x"]
const COMPINIT_C = 'autoload -Uz compinit\ncompinit -C -d "$HOME/.zcompdump"\n'

// `landed` is read before the unfenced shell runs: Apple Terminal's zsh saves its own session file on exit and
// `compinit -C` writes a missing dump, both outside the fence.
function sessionArm(profileFile: string) {
  reset()
  const write = plant(profileFile, sessionFile, "session-ran")
  const landed = existsSync(sessionFile)
  unfencedZsh(APPLE_TERMINAL)
  return { write, landed, executed: existsSync(join(markers, "session-ran")) }
}

function dumpArm(profileFile: string) {
  reset(COMPINIT_C)
  const write = plant(profileFile, dumpFile, "dump-ran")
  const landed = existsSync(dumpFile)
  unfencedZsh([])
  return { write, landed, executed: existsSync(join(markers, "dump-ran")) }
}

// Each command is typed after zsh's line editor announces it is ready (bracketed paste on), so the transcript does not
// depend on machine load. `whence -w compdef` shows whether the rc really ran compinit; the `touch` line shows the PTY
// shell really runs inside the fence. Bun's stdin pipe is a socket, which `script` refuses (tcgetattr: Operation not
// supported on socket); bash hands it a real pipe instead.
const TYPED = ["echo __READY__", 'ls -a "$HOME" | tr "\\n" " "; echo', "whence -w compdef", 'touch "$HOME/.fence-probe"', "exit 0"]
const LINE_EDITOR_READY = "\x1b[?2004h"

async function appTerminal(profileFile: string) {
  const transcript = join(ws, "pty.txt")
  const command = ["/usr/bin/env", "-i", ...shellEnv(), "TERM=xterm-256color", "OPENCODE_TERMINAL=1",
    "/bin/bash", "-c", 'exec /usr/bin/script -q "$0" /bin/zsh -l < <(exec /bin/cat)', transcript]
  const child = Bun.spawn([process.execPath, "-e", DRIVER, addon, profileFile, ws, ...command], { cwd: ws, stdin: "pipe", stdout: "pipe", stderr: "pipe" })
  const timer = setTimeout(() => child.kill(), 60_000)
  const decoder = new TextDecoder()
  let seen = ""
  let typed = 0
  for await (const chunk of child.stdout) {
    seen += decoder.decode(chunk, { stream: true })
    const ready = seen.split(LINE_EDITOR_READY).length - 1
    while (typed < Math.min(ready, TYPED.length)) {
      child.stdin.write(`${TYPED[typed++]}\n`)
      child.stdin.flush()
    }
  }
  const status = await child.exited
  clearTimeout(timer)
  child.stdin.end()
  const stderr = await new Response(child.stderr).text()
  expect({ status, typed }, `${stderr}\n${seen}`).toEqual({ status: 0, typed: TYPED.length })
  return readFileSync(transcript, "utf8")
}

beforeAll(() => {
  for (const directory of [join(run, "state"), join(run, "userData")]) mkdirSync(directory, { recursive: true })
  addon = buildFenceAddon({ out: join(run, "codepuppy_fence.node"), buildId: `zsh-startup-${Date.now()}` }).out
  writeFileSync(profiles.knownBad, knownBad)
  writeFileSync(profiles.production, production)
}, 120_000)

test("layout: the fake HOME and the run root are under no writable row of either profile; only the known-bad variant covers the session file and the dump", () => {
  const productionRules = processFenceWriteRules(production)
  const knownBadRules = processFenceWriteRules(knownBad)
  expect(knownBadRules.allow.length).toBe(productionRules.allow.length + 2)
  for (const rules of [productionRules, knownBadRules]) {
    expect(processFenceRulesCover(rules, home), home).toBe(false)
    expect(processFenceRulesCover(rules, run), run).toBe(false)
  }
  for (const target of [sessionFile, dumpFile]) {
    expect(processFenceRulesCover(knownBadRules, target), target).toBe(true)
    expect(processFenceRulesCover(productionRules, target), target).toBe(false)
  }
})

test("known bad (W10/W19 restored): both fenced writes land and an unfenced zsh executes what was planted", () => {
  const session = sessionArm(profiles.knownBad)
  const dump = dumpArm(profiles.knownBad)
  console.log(`AC-07 known bad: session ${JSON.stringify(session)}; dump ${JSON.stringify(dump)}`)
  expect(session).toEqual({ write: { status: 0, out: "OK" }, landed: true, executed: true })
  expect(dump).toEqual({ write: { status: 0, out: "OK" }, landed: true, executed: true })
})

test("production profile: both fenced writes are EPERM, nothing lands, the unfenced zsh executes nothing", () => {
  const session = sessionArm(profiles.production)
  const dump = dumpArm(profiles.production)
  console.log(`AC-07 production: session ${JSON.stringify(session)}; dump ${JSON.stringify(dump)}`)
  expect(session).toEqual({ write: { status: 1, out: `sh: ${sessionFile}: Operation not permitted` }, landed: false, executed: false })
  expect(dump).toEqual({ write: { status: 1, out: `sh: ${dumpFile}: Operation not permitted` }, landed: false, executed: false })
})

// oh-my-zsh's dump refresh, RECONSTRUCTED from the review's description (no oh-my-zsh copy on this machine; nothing is
// downloaded): oh-my-zsh.sh compares the dump's `#omz revision` / `#omz fpath` lines, on mismatch runs
// `command rm -f "$ZSH_COMPDUMP"`, then `compinit -i -d "$ZSH_COMPDUMP"`, then appends the two lines with
// `tee -a … &>/dev/null`. ZSH_COMPDUMP is fixed to `-x-5.9` here instead of `-<short host>-<zsh version>`.
const OMZ_DUMP = ".zcompdump-x-5.9"
const OMZ_RC = [
  `ZSH_COMPDUMP="\${ZDOTDIR:-$HOME}/${OMZ_DUMP}"`,
  'zcompdump_revision="#omz revision: test"',
  'zcompdump_fpath="#omz fpath: $fpath"',
  'if ! command grep -q -Fx "$zcompdump_revision" "$ZSH_COMPDUMP" 2>/dev/null \\',
  '   || ! command grep -q -Fx "$zcompdump_fpath" "$ZSH_COMPDUMP" 2>/dev/null; then',
  '  command rm -f "$ZSH_COMPDUMP"',
  "  zcompdump_refresh=1",
  "fi",
  "autoload -Uz compinit",
  'compinit -i -d "$ZSH_COMPDUMP"',
  "if (( $zcompdump_refresh )) \\",
  '  || ! command grep -q -Fx "$zcompdump_revision" "$ZSH_COMPDUMP" 2>/dev/null; then',
  '  tee -a "$ZSH_COMPDUMP" &>/dev/null <<EOF',
  "",
  "$zcompdump_revision",
  "$zcompdump_fpath",
  "EOF",
  "fi",
  "unset zcompdump_revision zcompdump_fpath zcompdump_refresh",
  "",
].join("\n")

test("app terminal, oh-my-zsh-shaped rc (reconstruction) — KNOWN VISIBLE CHANGE: the production profile prints exactly one extra startup line `rm: <dump>: Operation not permitted`, nothing else differs", async () => {
  // A dump as an earlier start leaves it: a real compinit dump (unfenced, fake HOME) + metadata for another fpath.
  const seed = () => {
    const made = spawnSync("/usr/bin/env", ["-i", ...shellEnv(), "/bin/zsh", "-fc", 'autoload -Uz compinit && compinit -i -d "$1"', "zsh", join(home, OMZ_DUMP)], { encoding: "utf8", timeout: 60_000 })
    expect(made.status, made.stderr).toBe(0)
    writeFileSync(join(home, OMZ_DUMP), "\n#omz revision: test\n#omz fpath: /not-this-fpath\n", { flag: "a" })
  }
  reset(OMZ_RC)
  seed()
  const before = await appTerminal(profiles.knownBad)
  reset(OMZ_RC)
  seed()
  const after = await appTerminal(profiles.production)
  console.log(`AC-07 app terminal rc=oh-my-zsh-shaped: known bad ${JSON.stringify(before)}`)
  console.log(`AC-07 app terminal rc=oh-my-zsh-shaped: production ${JSON.stringify(after)}`)
  expect(before).toContain("\r\ncompdef: function\r\n")
  expect(after).toBe(`rm: ${join(home, OMZ_DUMP)}: Operation not permitted\r\n${before}`)
}, 120_000)

test("app terminal shape: fenced login zsh on a PTY prints byte-identical output under both profiles for rc empty / compinit / compinit -C", async () => {
  for (const [name, rc] of [["none", undefined], ["compinit", "autoload -Uz compinit\ncompinit\n"], ["compinit-C", COMPINIT_C]] as const) {
    reset(rc)
    const before = await appTerminal(profiles.knownBad)
    reset(rc)
    const after = await appTerminal(profiles.production)
    const listing = after.match(/^\. \.\. .*$/m)?.[0]?.trim()
    console.log(`AC-07 app terminal rc=${name}: identical=${before === after} bytes=${after.length} home listing="${listing}"`)
    expect(after).toContain("__READY__\r\n")
    expect(after).toContain(`\r\ncompdef: ${rc === undefined ? "none" : "function"}\r\n`)
    expect(after).toContain(`touch: ${join(home, ".fence-probe")}: Operation not permitted`)
    expect(after, name).toBe(before)
  }
}, 120_000)
