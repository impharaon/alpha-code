#!/usr/bin/env bun
// Launches the windowless document-quality measurement host (scripts/document-quality/host.ts; plan 切片八「AC-01..03 实测」).
//
//   gate slot -- bunx electron-vite build --config scripts/document-quality/electron.vite.config.ts
//   bun ./scripts/document-quality-run.ts --evidence <dir> --key <key file> --endpoints <desktop discovered-endpoints json> \
//     --runs W1,P1,X1,... [--sample W1] [--cap-fen 3000] [--prior-max-run-fen 247] [--run-timeout-minutes 90] [--dry-run]
//
// The host runs from an APFS clone of the dev Electron.app whose Info.plist carries LSUIElement and its own bundle id: no Dock
// icon, no menu bar, no window, and the product's URL schemes are never registered (dev builds do not register them). The copy
// is unregistered from LaunchServices when the host exits. Every data root (HOME, XDG, userData, workspace) is under --evidence.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { parseArgs } from "node:util"
import type { HostInput } from "./document-quality/host"

const { values } = parseArgs({
  options: {
    evidence: { type: "string" },
    key: { type: "string" },
    endpoints: { type: "string" },
    runs: { type: "string" },
    sample: { type: "string" },
    "cap-fen": { type: "string", default: "3000" },
    "prior-max-run-fen": { type: "string", default: "247" },
    "run-timeout-minutes": { type: "string", default: "90" },
    "dry-run": { type: "boolean", default: false },
  },
})
if (!values.evidence || !values.key || !values.endpoints || !values.runs) throw new Error("--evidence, --key, --endpoints and --runs are required")
const packageRoot = path.resolve(import.meta.dir, "..")
const bundle = path.join(packageRoot, "out", "document-quality", "document-quality-host.js")
if (!existsSync(bundle)) throw new Error(`${bundle} is missing: build it first (see the header of this file)`)
mkdirSync(values.evidence, { recursive: true })
const evidence = realpathSync(values.evidence)
const discovered = JSON.parse(readFileSync(values.endpoints, "utf8")) as HostInput["endpoints"]
const input: HostInput = {
  evidence,
  keyFile: realpathSync(values.key),
  materials: path.join(packageRoot, "scripts", "document-quality"),
  runs: values.runs.split(","),
  ...(values.sample ? { sample: values.sample } : {}),
  capFen: Number(values["cap-fen"]),
  priorMaxRunFen: Number(values["prior-max-run-fen"]),
  runTimeoutMinutes: Number(values["run-timeout-minutes"]),
  endpoints: discovered,
  dryRun: values["dry-run"],
  foreignAgentRoots: [".claude", ".agents"].map((name) => path.join(homedir(), name)),
}
const inputFile = path.join(evidence, "input.json")
writeFileSync(inputFile, JSON.stringify(input, null, 1))

const electronPackage = path.dirname(createRequire(import.meta.url).resolve("electron/package.json"))
const source = path.join(electronPackage, "dist", "Electron.app")
const host = path.join(evidence, "host", "Electron.app")
const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { stdio: "inherit" })
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${result.status}`)
}
if (!existsSync(host)) {
  mkdirSync(path.dirname(host), { recursive: true })
  run("/bin/cp", ["-c", "-R", source, host])
  const plist = path.join(host, "Contents", "Info.plist")
  run("/usr/bin/plutil", ["-replace", "LSUIElement", "-bool", "YES", plist])
  run("/usr/bin/plutil", ["-replace", "CFBundleIdentifier", "-string", "cn.codepuppy.document-quality-host", plist])
}
const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

const roots = {
  HOME: path.join(evidence, "home"),
  XDG_DATA_HOME: path.join(evidence, "xdg", "data"),
  XDG_CONFIG_HOME: path.join(evidence, "xdg", "config"),
  XDG_CACHE_HOME: path.join(evidence, "xdg", "cache"),
  XDG_STATE_HOME: path.join(evidence, "xdg", "state"),
  // The engine discovers .claude/.agents/AGENTS.md in every ancestor of a Location. Under the real home that reaches the
  // operator's own skills and instructions, so the workspace lives under the system temp directory and is copied into the
  // evidence when the host exits.
  CODEPUPPY_USER_WORKSPACE_DIR: path.join(realpathSync(tmpdir()), `document-quality-${path.basename(evidence)}`, "workspace"),
  CODEPUPPY_OPENCODE_HOME: path.join(evidence, "opencode-home"),
}
for (const directory of Object.values(roots)) mkdirSync(directory, { recursive: true })
// Exported Code Puppy / OpenCode / XDG variables of the calling shell would steer the host off its evidence roots.
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(CODEPUPPY_|OPENCODE_|XDG_|DEV_PLATFORM_TOKEN$|ELECTRON_)/.test(name)))
const child = spawn(path.join(host, "Contents", "MacOS", "Electron"), [bundle], {
  cwd: evidence,
  env: { ...env, ...roots, DOCUMENT_QUALITY_INPUT: inputFile },
  stdio: ["ignore", "inherit", "inherit"],
})
const exitFile = path.join(evidence, "host-exit.json")
rmSync(exitFile, { force: true })
// The host records its exit code before app.exit; if Electron's shutdown parks the process, it is ended after a grace period.
const watcher = setInterval(() => {
  if (existsSync(exitFile)) setTimeout(() => child.kill("SIGKILL"), 15_000).unref()
  if (existsSync(exitFile)) clearInterval(watcher)
}, 1000)
const exited = await new Promise<number>((resolve) => child.once("exit", (exit, signal) => resolve(exit ?? (signal ? 128 : 1))))
clearInterval(watcher)
const code = existsSync(exitFile) ? (JSON.parse(readFileSync(exitFile, "utf8")) as { code: number }).code : exited
// Launching registers the copy and its nested helper apps; unregister every one of them.
const frameworks = path.join(host, "Contents", "Frameworks")
for (const bundle of [host, ...readdirSync(frameworks).filter((name) => name.endsWith(".app")).map((name) => path.join(frameworks, name))])
  spawnSync(lsregister, ["-u", bundle], { stdio: "ignore" })
const registered = spawnSync(lsregister, ["-dump"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).stdout.split("\n").filter((line) => line.startsWith("path:") && line.includes(host))
console.log(registered.length ? `WARNING: still registered: ${registered.join(" | ")}` : "host copy is not registered with LaunchServices")
spawnSync("/usr/bin/rsync", ["-a", "--exclude", "node_modules", `${roots.CODEPUPPY_USER_WORKSPACE_DIR}/`, path.join(evidence, "workspace")], { stdio: "inherit" })
process.exit(code)
