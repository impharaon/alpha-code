import { expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statfsSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { buildFenceAddon } from "../../scripts/build-fence-addon"
import { loadFenceAddon } from "./process-fence-apply"
import { runPackagedWindowProof } from "../../native/codepuppy-fence/test/packaged-window-build"

const root = process.env.CODEPUPPY_G0_ROOT!
const ui = resolve(import.meta.dir, "../..")
const fixtures = join(ui, "native/codepuppy-fence/test")
const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

// Signing output may contain the identity's name. Discard those lines before storing or displaying it.
const redact = (text: string) => text.split("\n").map((line) => /Developer ID Application|Authority=|signingIdentity=/.test(line) ? "[signing identity omitted]" : line).join("\n")
let prepared: { appDir: string; run: string; identityHash: string } | undefined
let windowReport: Awaited<ReturnType<typeof runPackagedWindowProof>> | undefined

test("G0 production addon, signed Electron main, production sidecar, positive and known-bad arms", async () => {
  mkdirSync(root, { recursive: true })
  const run = mkdtempSync(join(root, "g0-"))
  const preflight = buildFenceAddon({ out: join(run, "preflight/codepuppy_fence.node") })
  const addon = loadFenceAddon(preflight.out)
  expect(typeof addon.issueFileExtensionToProcess, "G0 missing production issueFileExtensionToProcess export").toBe("function")
  expect(typeof addon.consumeExtension, "G0 missing production consumeExtension export").toBe("function")

  const space = statfsSync(root)
  expect(Number(space.bavail) * Number(space.bsize), "G0 requires at least 8 GiB free before the build").toBeGreaterThanOrEqual(8 * 1024 ** 3)
  const keychain = join(process.env.CODEPUPPY_TEST_REAL_HOME!, "Library/Keychains/login.keychain-db")
  // Security's trust evaluation still uses HOME even with an explicit keychain. Only signing
  // tools use the account home; the packaged app and every utilityProcess get isolated roots.
  const identity = execFileSync("security", ["find-identity", "-v", "-p", "codesigning", keychain], { encoding: "utf8", env: { ...process.env, HOME: process.env.CODEPUPPY_TEST_REAL_HOME } })
    .split("\n").find((line) => line.includes("Developer ID Application"))?.match(/\b[0-9A-F]{40}\b/)?.[0]
  expect(identity, "G0 Developer ID identity hash not available").toBeDefined()
  const buildEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SENTRY_|APPLE_|GH_|GITHUB_|CSC_|ALPHA_)/.test(key) && !["NODE_ENV", "CODEPUPPY_SIGN", "CODEPUPPY_SIGN_IDENTITY"].includes(key)))
  const command = async (name: string, cmd: string[], env = buildEnv) => {
    const child = Bun.spawn({ cmd, cwd: ui, env, stdout: "pipe", stderr: "pipe" })
    const deadline = name === "runtime" ? setTimeout(() => child.kill("SIGKILL"), 600_000) : undefined
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    clearTimeout(deadline)
    const output = redact(`${stdout}${stderr}`)
    writeFileSync(join(run, `${name}.log`), output)
    const failure = name === "runtime" && existsSync(join(run, "result.json")) ? readFileSync(join(run, "result.json"), "utf8") : output
    expect(code, `${name} failed: ${failure.slice(-6000)}`).toBe(0)
    return output
  }
  await command("build", [process.execPath, "run", "build"], { ...buildEnv, OPENCODE_CHANNEL: "dev" })
  const packaged = join(run, "packaged")
  if (!process.env.CODEPUPPY_PACKAGED_APP) {
    const built = await Bun.build({ entrypoints: [join(fixtures, "packaged-main.ts")], target: "node", format: "esm", external: ["electron"] })
    expect(built.success, built.logs.map(String).join("\n")).toBe(true)
    const index = join(ui, "out/main/index.js")
    const original = readFileSync(index)
    const helper = join(ui, "out/main/chunks/assets/g0-issue-probe")
    await command("attack-build", ["/usr/bin/clang", "-O2", "-mmacosx-version-min=11.0", join(fixtures, "issue-probe.c"), "-lsandbox", "-o", helper])
    try {
      writeFileSync(index, new Uint8Array(await built.outputs[0]!.arrayBuffer()))
      await command("package", [process.execPath, "run", "package:mac", "--dir", "--publish", "never", "-c.mac.notarize=false", `-c.directories.output=${packaged}`], {
        ...buildEnv, HOME: process.env.CODEPUPPY_TEST_REAL_HOME, OPENCODE_CHANNEL: "dev", CODEPUPPY_SIGN: "1", CODEPUPPY_SIGN_IDENTITY: identity!, CSC_KEYCHAIN: keychain,
      })
    } finally {
      writeFileSync(index, original)
      rmSync(helper, { force: true })
    }
  }
  const appDir = process.env.CODEPUPPY_PACKAGED_APP ? resolve(process.env.CODEPUPPY_PACKAGED_APP) : join(packaged, "mac-arm64", readdirSync(join(packaged, "mac-arm64")).find((file) => file.endsWith(".app"))!)
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
    // Chromium cookie encryption otherwise consults the default keychain before app.ready.
    // This isolates that unrelated store; sandbox SPI, signatures and entitlements stay real.
    await command("runtime", [join(executables, executable), "--no-first-run", "--disable-background-networking", "--use-mock-keychain"], env)
  } finally {
    await command("unregister", [lsregister, "-u", appDir])
  }
  expect(existsSync(reportPath), "G0 packaged main did not leave its report").toBe(true)
  const report = JSON.parse(readFileSync(reportPath, "utf8"))
  expect(report.error, JSON.stringify(report)).toBeUndefined()
  expect(report.passed).toBe(true)
  expect(report.runtime.electron).toBe("42.3.3")
  expect(report.grantLatency.count).toBe(100)
  expect(report.grantLatency.samplesMs).toHaveLength(100)
  expect(report.grantLatency.p50Ms).toBeGreaterThan(0)
  expect(report.grantLatency.p99Ms).toBeGreaterThanOrEqual(report.grantLatency.p50Ms)
  expect(report.arms.granted.files.B).toEqual(["existing.txt", "new.txt"])
  expect(report.arms.granted.files.C).toEqual([])
  expect(report.arms.control.files.B).toEqual([])
  expect(report.arms.control.files.C).toEqual([])
  expect(report.arms.replay.files.B).toEqual([])
  expect(report.arms.selfIssue.files.C).toEqual([])
  expect(report.arms.badFileOnly.files.C.length).toBeGreaterThan(0)
  expect(report.arms.badNoDeny.files.C.length).toBeGreaterThan(0)
  writeFileSync(join(run, "signing.json"), JSON.stringify({ identityHash: identity, verifyExit: 0, runtimeFlag: "0x10000", appDir }, null, 2))
  prepared = { appDir, run, identityHash: identity! }
  console.log(`G0 PASS evidence=${run}`)
}, 1_800_000)

test("V4/V5/V6 production Chromium window: concrete opens, slow replies, reloads and residual reasons", async () => {
  expect(prepared, "G0 must pass before the window proof").toBeDefined()
  windowReport = await runPackagedWindowProof(prepared!)
  expect(windowReport.arms.slice(0, 12).map((arm: { name: string }) => arm.name), windowReport.error ?? "window arms").toEqual(["M1", "R1", "R2", "R3", "R4", "R5", "slow-open", "rewritten-reload", "honest-reload", "home-or-app-state", "grant-failed-native", "grant-failed-timeout"])
  console.log(`WINDOW PASS evidence=${prepared!.run}/window`)
}, 300_000)

test("AC-08 external deep link reaches the residual DOM then the picker makes that folder writable", () => {
  expect(windowReport, "window proof did not run").toBeDefined()
  expect(windowReport!.error, `window evidence=${prepared!.run}/window`).toBeUndefined()
  expect(windowReport!.appExitCode).toBe(0)
  expect(windowReport!.arms.slice(12).map((arm: { name: string }) => arm.name)).toEqual(["deep-link-before", "deep-link-after"])
})
