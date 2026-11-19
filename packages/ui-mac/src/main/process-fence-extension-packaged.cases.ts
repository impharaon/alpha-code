import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statfsSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { buildFenceAddon } from "../../scripts/build-fence-addon"
import { loadFenceAddon } from "./process-fence-apply"

const root = process.env.CODEPUPPY_G0_ROOT!
const ui = resolve(import.meta.dir, "../..")
const fixtures = join(ui, "native/codepuppy-fence/test")
const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

// Signing output may contain the identity's name. Discard those lines before storing or displaying it.
const redact = (text: string) => text.split("\n").map((line) => /Developer ID Application|Authority=|signingIdentity=/.test(line) ? "[signing identity omitted]" : line).join("\n")

test("G0 production addon, signed Electron main, production sidecar, positive and known-bad arms", async () => {
  mkdirSync(root, { recursive: true })
  const run = mkdtempSync(join(root, "g0-"))
  const preflight = buildFenceAddon({ out: join(run, "preflight/codepuppy_fence.node") })
  const addon = loadFenceAddon(preflight.out)
  expect(typeof addon.issueFileExtensionToProcess, "G0 missing production issueFileExtensionToProcess export").toBe("function")
  expect(typeof addon.consumeExtension, "G0 missing production consumeExtension export").toBe("function")

  const space = statfsSync(root)
  expect(Number(space.bavail) * Number(space.bsize), "G0 requires at least 8 GiB free before the build").toBeGreaterThanOrEqual(8 * 1024 ** 3)
  const identity = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" })
    .split("\n").find((line) => line.includes("Developer ID Application"))?.match(/\b[0-9A-F]{40}\b/)?.[0]
  expect(identity, "G0 Developer ID identity hash not available").toBeDefined()
  const buildEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SENTRY_|APPLE_|GH_|GITHUB_|CSC_|ALPHA_)/.test(key) && !["NODE_ENV", "CODEPUPPY_SIGN", "CODEPUPPY_SIGN_IDENTITY"].includes(key)))
  const command = async (name: string, cmd: string[], env = buildEnv) => {
    const child = Bun.spawn({ cmd, cwd: ui, env, stdout: "pipe", stderr: "pipe" })
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    const output = redact(`${stdout}${stderr}`)
    writeFileSync(join(run, `${name}.log`), output)
    const failure = name === "runtime" && existsSync(join(run, "result.json")) ? readFileSync(join(run, "result.json"), "utf8") : output
    expect(code, `${name} failed: ${failure.slice(-6000)}`).toBe(0)
    return output
  }
  await command("build", [process.execPath, "run", "build"], { ...buildEnv, OPENCODE_CHANNEL: "dev" })
  const built = await Bun.build({ entrypoints: [join(fixtures, "packaged-main.ts")], target: "node", format: "esm", external: ["electron"] })
  expect(built.success, built.logs.map(String).join("\n")).toBe(true)
  const index = join(ui, "out/main/index.js")
  const original = readFileSync(index)
  const helper = join(ui, "out/main/chunks/assets/g0-issue-probe")
  await command("attack-build", ["/usr/bin/clang", "-O2", "-mmacosx-version-min=11.0", join(fixtures, "issue-probe.c"), "-lsandbox", "-o", helper])
  const packaged = join(run, "packaged")
  try {
    writeFileSync(index, new Uint8Array(await built.outputs[0]!.arrayBuffer()))
    await command("package", [process.execPath, "run", "package:mac", "--dir", "--publish", "never", "-c.mac.notarize=false", `-c.directories.output=${packaged}`], {
      ...buildEnv, OPENCODE_CHANNEL: "dev", CODEPUPPY_SIGN: "1", CODEPUPPY_SIGN_IDENTITY: identity!,
    })
  } finally {
    writeFileSync(index, original)
  }
  const appDir = join(packaged, "mac-arm64", readdirSync(join(packaged, "mac-arm64")).find((file) => file.endsWith(".app"))!)
  await command("verify", ["/usr/bin/codesign", "--verify", "--deep", "--strict", appDir])
  const signature = await command("signature", ["/usr/bin/codesign", "-d", "--verbose=4", appDir])
  expect(signature).toMatch(/flags=0x10000\(runtime\)/)
  const entitlements = await command("entitlements", ["/usr/bin/codesign", "-d", "--entitlements", ":-", appDir])
  const expectedEntitlements = readFileSync(join(ui, "resources/entitlements.plist"), "utf8")
  for (const key of expectedEntitlements.matchAll(/<key>([^<]+)<\/key>/g)) expect(entitlements).toContain(key[1]!)
  const executables = join(appDir, "Contents/MacOS")
  const executable = readdirSync(executables).find((file) => !file.startsWith("."))!
  const home = join(run, "runtime/home")
  const userData = join(run, "runtime/user-data")
  const tmp = join(run, "runtime/tmp")
  for (const dir of [home, userData, tmp]) mkdirSync(dir, { recursive: true })
  const reportPath = join(run, "result.json")
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, TMPDIR: tmp,
    XDG_DATA_HOME: join(home, "data"), XDG_CACHE_HOME: join(home, "cache"), XDG_CONFIG_HOME: join(home, "config"), XDG_STATE_HOME: join(home, "state"),
    CODEPUPPY_G0_RUN: run, CODEPUPPY_G0_REPORT: reportPath, CODEPUPPY_G0_USER_DATA: userData,
    NO_COLOR: "1",
  }
  try {
    await command("runtime", [join(executables, executable), "--no-first-run", "--disable-background-networking"], env)
  } finally {
    await command("unregister", [lsregister, "-u", appDir])
  }
  expect(existsSync(reportPath), "G0 packaged main did not leave its report").toBe(true)
  const report = JSON.parse(readFileSync(reportPath, "utf8"))
  expect(report.error, JSON.stringify(report)).toBeUndefined()
  expect(report.passed).toBe(true)
  expect(report.runtime.electron).toBe("42.3.3")
  expect(report.arms.granted.files.B).toEqual(["existing.txt", "new.txt"])
  expect(report.arms.granted.files.C).toEqual([])
  expect(report.arms.control.files.B).toEqual([])
  expect(report.arms.control.files.C).toEqual([])
  expect(report.arms.replay.files.B).toEqual([])
  expect(report.arms.selfIssue.files.C).toEqual([])
  expect(report.arms.badFileOnly.files.C.length).toBeGreaterThan(0)
  expect(report.arms.badNoDeny.files.C.length).toBeGreaterThan(0)
  writeFileSync(join(run, "signing.json"), JSON.stringify({ identityHash: identity, verifyExit: 0, runtimeFlag: "0x10000", appDir }, null, 2))
  console.log(`G0 PASS evidence=${run}`)
}, 1_800_000)
