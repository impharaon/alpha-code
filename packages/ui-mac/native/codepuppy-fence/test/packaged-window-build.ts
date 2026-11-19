// Host-only local packaging: keep signed native/framework bytes, replace the test entry,
// recompute ASAR integrity with electron-builder's ASAR dependency and re-sign the outer app.
import { expect } from "bun:test"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, statfsSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { ENGINE_ASSETS_DIR } from "../../../scripts/target-arch"
import { scriptedModel } from "../../../test-component/codepuppy-engine"

export async function runPackagedWindowProof(input: { appDir: string; run: string; identityHash: string }) {
  const ui = join(import.meta.dir, "../../..")
  const root = join(input.run, "window")
  mkdirSync(root, { recursive: true })
  const space = statfsSync(root)
  expect(Number(space.bavail) * Number(space.bsize), "window build requires 8 GiB free").toBeGreaterThanOrEqual(
    8 * 1024 ** 3,
  )
  const require = createRequire(join(ui, "package.json"))
  const builder = createRequire(require.resolve("electron-builder/package.json"))
  const lib = createRequire(builder.resolve("app-builder-lib/package.json"))
  const asar = lib("@electron/asar") as typeof import("@electron/asar")
  const command = (name: string, executable: string, args: string[], env = process.env) => {
    const result = spawnSync(executable, args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] })
    const safe = `${result.stdout ?? ""}${result.stderr ?? ""}`
      .split("\n")
      .map((line) => (/Developer ID Application|Authority=/.test(line) ? "[identity omitted]" : line))
      .join("\n")
    writeFileSync(join(root, `${name}.log`), safe)
    expect(result.status, `${name} exit ${result.status}: ${safe.slice(-3000)}`).toBe(0)
    return safe
  }
  const appDir = join(root, "WindowProof.app")
  command("copy", "/usr/bin/ditto", [input.appDir, appDir])
  const resources = join(appDir, "Contents/Resources")
  const stage = join(root, "stage")
  asar.extractAll(join(resources, "app.asar"), stage)
  // Renderer and preload come from this source build, including known-bad mutation arms.
  command("renderer", "/usr/bin/ditto", [join(ui, "out/renderer"), join(stage, "out/renderer")])
  command("preload", "/usr/bin/ditto", [join(ui, "out/preload"), join(stage, "out/preload")])
  const dependencies = require("./package.json").dependencies as Record<string, string>
  const built = await Bun.build({
    entrypoints: [join(import.meta.dir, "packaged-window-entry.ts")],
    target: "node",
    format: "esm",
    external: ["electron", ...Object.keys(dependencies).filter((name) => name !== "@codepuppy/contracts-consumer")],
    define: { "import.meta.env": JSON.stringify({ OPENCODE_CHANNEL: "dev", DEV: false, PROD: true }) },
  })
  expect(built.success, built.logs.map(String).join("\n")).toBe(true)
  writeFileSync(join(stage, "out/main/index.js"), new Uint8Array(await built.outputs[0]!.arrayBuffer()))
  await asar.createPackageWithOptions(stage, join(resources, "app.asar"), { unpackDir: ENGINE_ASSETS_DIR })
  asar.uncacheAll()
  const integrity = {
    "Resources/app.asar": {
      algorithm: "SHA256",
      hash: createHash("sha256")
        .update(asar.getRawHeader(join(resources, "app.asar")).headerString)
        .digest("hex"),
    },
  }
  command("integrity", "/usr/bin/plutil", [
    "-replace",
    "ElectronAsarIntegrity",
    "-json",
    JSON.stringify(integrity),
    join(appDir, "Contents/Info.plist"),
  ])
  command(
    "sign",
    "/usr/bin/codesign",
    [
      "--force",
      "--sign",
      input.identityHash,
      "--options",
      "runtime",
      "--entitlements",
      join(ui, "resources/entitlements.plist"),
      appDir,
    ],
    { ...process.env, HOME: process.env.CODEPUPPY_TEST_REAL_HOME },
  )
  command("verify", "/usr/bin/codesign", ["--verify", "--deep", "--strict", appDir])
  expect(command("signature", "/usr/bin/codesign", ["-d", "--verbose=4", appDir])).toMatch(/flags=0x10000\(runtime\)/)
  const entitlements = command("entitlements", "/usr/bin/codesign", ["-d", "--entitlements", ":-", appDir])
  for (const key of readFileSync(join(ui, "resources/entitlements.plist"), "utf8").matchAll(/<key>([^<]+)<\/key>/g))
    expect(entitlements).toContain(key[1]!)
  writeFileSync(
    join(root, "signing.json"),
    JSON.stringify({ identityHash: input.identityHash, verifyExit: 0, runtimeFlag: "0x10000" }, null, 2),
  )
  const home = join(root, "home"),
    tmp = join(root, "engine-data/tmp")
  const model = scriptedModel()
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    TMPDIR: tmp,
    XDG_DATA_HOME: join(home, "data"),
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_STATE_HOME: join(home, "state"),
    CODEPUPPY_WINDOW_RUN: root,
    CODEPUPPY_WINDOW_MODEL_URL: model.baseURL,
    SHELL: "/bin/sh",
    NO_COLOR: "1",
  }
  for (const directory of [
    home,
    tmp,
    ...[env.XDG_DATA_HOME, env.XDG_CACHE_HOME, env.XDG_CONFIG_HOME, env.XDG_STATE_HOME].map((path) =>
      join(path, "opencode"),
    ),
  ])
    mkdirSync(directory, { recursive: true })
  try {
    const executable = join(appDir, "Contents/MacOS", readdirSync(join(appDir, "Contents/MacOS"))[0]!)
    const child = Bun.spawn({
      cmd: [executable, "--no-first-run", "--disable-background-networking", "--use-mock-keychain"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    })
    const timeout = setTimeout(() => child.kill("SIGKILL"), 240_000)
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    clearTimeout(timeout)
    writeFileSync(join(root, "runtime.log"), `${stdout}${stderr}`)
    const resultPath = join(root, "window-result.json")
    expect(existsSync(resultPath), `no window report: ${stderr.slice(-2000)}`).toBe(true)
    const report = JSON.parse(readFileSync(resultPath, "utf8"))
    report.appExitCode = code
    report.modelRequestCount = model.requests.length
    expect(report.windowVisible).toBe(false)
    expect(model.requests.length).toBeGreaterThan(0)
    expect(report.inputs.length).toBeGreaterThan(0)
    expect(report.inputs.every((event: { trusted: boolean }) => event.trusted)).toBe(true)
    return report
  } finally {
    model.stop()
    command(
      "unregister",
      "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
      ["-u", appDir],
    )
  }
}
