// REQ-159 (`#1321`) —— planner 的接线判据(假 store / 假 fs / 假编译器;electron-free,全平台跑)。
//
// 它守的是 main 侧那几条会静默出错的事:父目录预建(§6.3.1 第 3 条)、store 读挂不炸 boot 但出声、
// 试编译丢尾、原生模块缺失即拒、默认工作区不在盘上即拒。真编译器与真 profile 的判据在别的文件。

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { planConfigFence, planPackageManagerCaches, planUserWritableLocations, planProcessFence, planWritableLocations, type PlanProcessFenceDeps, type PlanProcessFenceInput } from "./process-fence-plan"
import { writableLocationTruthPath } from "./process-fence-workspaces"
import { SANDBOX_EXEC, trialCompileProfile } from "./process-fence-compile"
import { renderProcessFenceProfile, processFenceRulesCover, processFenceWriteRules, type ProcessFenceWriteRule } from "./process-fence-profile"
import { loadCodePuppySecrets, userEnvFile } from "./codepuppy-secrets"
import { credentialStores } from "./codepuppy-secret-files"

const describeDarwin = process.platform === "darwin" ? describe : describe.skip

const HOME = "/Users/alpha"
const USER_DATA = `${HOME}/Library/Application Support/ai.opencode.desktop`
const GLOBAL = `${HOME}/Library/Application Support/codepuppy-state/env/prod`
/** `#1390`:应用状态根 = GLOBAL 的父目录的父目录(三个 env 根与 CAS 的父)。 */
const STATE_ROOT = `${HOME}/Library/Application Support/codepuppy-state`
const ADDON = "/App/Contents/Resources/codepuppy-fence/codepuppy_fence.node"
const OFFICIAL_RUNTIME = "/private/var/folders/xy/T/codepuppy-connectors-501-ab"

function withLocationDisk(run: (disk: { root: string; home: string; state: string; protected: string; truthPath: string; eligibility: Parameters<typeof planWritableLocations>[0]["eligibility"] }) => void) {
  const base = resolve(import.meta.dir, "../../node_modules/.cache")
  mkdirSync(base, { recursive: true })
  const root = realpathSync(mkdtempSync(join(base, "writable-locations-")))
  const home = join(root, "home")
  const state = join(root, "state")
  const protectedRoot = join(home, ".config", "opencode")
  for (const dir of [home, state, protectedRoot]) mkdirSync(dir, { recursive: true })
  try {
    run({ root, home, state, protected: protectedRoot, truthPath: writableLocationTruthPath(state, "dev"), eligibility: { homeDir: home, appStateRoot: state, configFenceRoots: () => [protectedRoot], realpath: realpathSync.native, isDirectory: (path) => statSync(path).isDirectory(), stat: (path) => statSync(path, { bigint: true }) } })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe("planWritableLocations", () => {
  test("fixed installs and user files use identity truth and concrete version roots", () => {
    withLocationDisk((disk) => {
      // Existing real filesystem fixtures; system prefixes are excluded to keep this Mac untouched.
      const version = join(disk.home, ".nvm/versions/node/v24.0.0")
      mkdirSync(version, { recursive: true })
      const input = { platform: "darwin" as const, home: disk.home, userDataPath: join(disk.root, "ud"), configHome: join(disk.home, ".config"), appData: join(disk.home, "Library/Application Support"), localAppData: join(disk.home, "Library/Caches"), goInstallBin: null, xdgCacheHome: null, bunInstall: null, truthPath: disk.truthPath, eligibility: { ...disk.eligibility, configFenceRoots: () => [disk.protected, "/opt/homebrew", "/usr/local"] } }
      const first = planUserWritableLocations(input)
      const cover = (target: string) => processFenceRulesCover({ allow: first.rules, deny: [] }, target, "file")
      for (const target of [join(disk.home, ".bun/bin/cli"), join(version, "lib/node_modules/cli/package.json"), join(disk.home, ".gitconfig.lock"), join(disk.home, ".zshrc")]) expect(cover(target), target).toBe(true)
      for (const target of [disk.home, join(disk.home, ".nvm/arbitrary"), join(disk.home, ".config/git/other"), join(disk.home, "private")]) expect(cover(target), target).toBe(false)
      expect(existsSync(join(disk.home, ".zshrc"))).toBe(false)
      expect(existsSync(join(version, "bin"))).toBe(true)
      const other = join(disk.root, "other")
      mkdirSync(other)
      rmSync(join(disk.home, ".bun/bin"), { recursive: true })
      symlinkSync(other, join(disk.home, ".bun/bin"))
      symlinkSync(join(disk.protected, "settings"), join(disk.home, ".zshrc"))
      const next = planUserWritableLocations(input)
      expect(next.excluded).toContain(join(disk.home, ".bun/bin"))
      expect(next.excluded).toContain(join(disk.home, ".zshrc"))
      expect(processFenceRulesCover({ allow: next.rules, deny: [] }, join(other, "cli"), "file")).toBe(false)
    })
  })

  test("version-manager locations are bound only where that manager is already installed", () => {
    withLocationDisk((disk) => {
      const input = { platform: "darwin" as const, home: disk.home, userDataPath: join(disk.root, "ud"), configHome: join(disk.home, ".config"), appData: join(disk.home, "Library/Application Support"), localAppData: join(disk.home, "Library/Caches"), goInstallBin: null, xdgCacheHome: null, bunInstall: null, truthPath: disk.truthPath, eligibility: disk.eligibility }
      mkdirSync(join(disk.home, ".volta/bin"), { recursive: true })
      const plan = planUserWritableLocations(input)
      const cover = (target: string) => processFenceRulesCover({ allow: plan.rules, deny: [] }, target, "file")
      for (const missing of [".nvm", ".config/nvm", "Library/Application Support/fnm", ".local/share/fnm", ".fnm", ".asdf", ".local/share/mise", ".volta/tools", ".volta/tmp", ".volta/log"]) expect(existsSync(join(disk.home, missing)), missing).toBe(false)
      expect(cover(join(disk.home, ".volta/bin/tool"))).toBe(true)
      expect(cover(join(disk.home, ".asdf/shims/node"))).toBe(false)
      // Ordinary fixed install locations keep their existing binding.
      expect(cover(join(disk.home, ".bun/bin/cli"))).toBe(true)
      expect(cover(join(disk.home, ".local/lib/python3.12/site-packages/x"))).toBe(true)
    })
  })
  test("binds concrete directories and missing literal files without creating user files", () => {
    withLocationDisk((disk) => {
      const candidates = [{ sourcePath: join(disk.home, ".bun", "bin"), kind: "directory" as const }, { sourcePath: join(disk.home, ".config", "git", "config"), kind: "file" as const }]
      const result = planWritableLocations({ candidates: [...candidates, candidates[0]!], truthPath: disk.truthPath, eligibility: disk.eligibility })
      expect(result).toEqual({ locations: candidates.map((candidate) => ({ ...candidate, targetPath: candidate.sourcePath })), excluded: [] })
      expect(statSync(candidates[0]!.sourcePath).isDirectory()).toBe(true)
      expect(existsSync(candidates[1]!.sourcePath)).toBe(false)
      expect(statSync(join(disk.home, ".config", "git")).isDirectory()).toBe(true)
      const before = readFileSync(disk.truthPath, "utf8")
      expect(planWritableLocations({ candidates, truthPath: disk.truthPath, eligibility: disk.eligibility })).toEqual(result)
      expect(readFileSync(disk.truthPath, "utf8")).toBe(before)
      expect(planWritableLocations({ candidates: [], truthPath: disk.truthPath, eligibility: disk.eligibility }).locations).toEqual([])
      expect(readFileSync(disk.truthPath, "utf8")).toBe(before)
    })
  })

  test("accepts an initial legal symlink but never follows a re-point across planning calls", () => {
    withLocationDisk((disk) => {
      const a = join(disk.root, "a")
      const b = join(disk.root, "b")
      for (const dir of [a, b]) mkdirSync(dir)
      const sourcePath = join(disk.home, ".bun")
      symlinkSync(a, sourcePath)
      const input = { candidates: [{ sourcePath, kind: "directory" as const }], truthPath: disk.truthPath, eligibility: disk.eligibility }
      const first = planWritableLocations(input)
      expect(first.locations).toEqual([{ sourcePath, targetPath: a, kind: "directory" }])
      const before = readFileSync(disk.truthPath, "utf8")
      for (const target of [b, disk.home, disk.state, disk.protected]) {
        unlinkSync(sourcePath)
        symlinkSync(target, sourcePath)
        expect(planWritableLocations({ ...input, candidates: [] }).locations).toEqual([])
        expect(planWritableLocations(input), target).toEqual({ locations: [], excluded: [sourcePath] })
        expect(readFileSync(disk.truthPath, "utf8")).toBe(before)
      }
      unlinkSync(sourcePath)
      symlinkSync(a, sourcePath)
      expect(planWritableLocations(input)).toEqual(first)
    })
  })

  test("checks a missing directory below a symlink before creating it", () => {
    withLocationDisk((disk) => {
      const a = join(disk.root, "a")
      const b = join(disk.root, "b")
      for (const dir of [a, b]) mkdirSync(dir)
      const link = join(disk.home, ".bun")
      symlinkSync(a, link)
      const sourcePath = join(link, "bin")
      const input = { candidates: [{ sourcePath, kind: "directory" as const }], truthPath: disk.truthPath, eligibility: disk.eligibility }
      expect(planWritableLocations(input).locations).toEqual([{ sourcePath, targetPath: join(a, "bin"), kind: "directory" }])
      unlinkSync(link)
      symlinkSync(b, link)
      expect(planWritableLocations(input)).toEqual({ locations: [], excluded: [sourcePath] })
      expect(existsSync(join(b, "bin"))).toBe(false)
    })
  })

  test("file identities survive atomic replacement and reject symlink re-point", () => {
    withLocationDisk((disk) => {
      const file = join(disk.home, "shell-config")
      writeFileSync(file, "before")
      const sourcePath = join(disk.home, ".zshrc")
      symlinkSync(file, sourcePath)
      const input = { candidates: [{ sourcePath, kind: "file" as const }], truthPath: disk.truthPath, eligibility: disk.eligibility }
      const first = planWritableLocations(input)
      expect(first.locations).toEqual([{ sourcePath, targetPath: file, kind: "file" }])
      writeFileSync(`${file}.tmp`, "after")
      renameSync(`${file}.tmp`, file)
      expect(planWritableLocations(input)).toEqual(first)
      const other = join(disk.home, "other")
      writeFileSync(other, "unchanged")
      unlinkSync(sourcePath)
      symlinkSync(other, sourcePath)
      expect(planWritableLocations(input)).toEqual({ locations: [], excluded: [sourcePath] })
      expect(readFileSync(other, "utf8")).toBe("unchanged")
    })
  })

  test("protected targets are excluded before mkdir and an ordinary HOME file remains eligible", () => {
    withLocationDisk((disk) => {
      const candidates = [
        { sourcePath: disk.home, kind: "directory" as const },
        { sourcePath: disk.root, kind: "directory" as const },
        { sourcePath: join(disk.state, "new"), kind: "directory" as const },
        { sourcePath: join(disk.protected, "new"), kind: "directory" as const },
        { sourcePath: join(disk.protected, "config.json"), kind: "file" as const },
      ]
      const result = planWritableLocations({ candidates: [...candidates, { sourcePath: join(disk.home, ".gitconfig"), kind: "file" }], truthPath: disk.truthPath, eligibility: disk.eligibility })
      expect(result.excluded).toEqual(candidates.map((candidate) => candidate.sourcePath))
      expect(result.locations).toEqual([{ sourcePath: join(disk.home, ".gitconfig"), targetPath: join(disk.home, ".gitconfig"), kind: "file" }])
      expect(existsSync(join(disk.state, "new"))).toBe(false)
      expect(existsSync(join(disk.protected, "new"))).toBe(false)
    })
  })

  test("invalid or unreadable truth stops before preparing candidates", () => {
    withLocationDisk((disk) => {
      mkdirSync(join(disk.state, "fence-workspaces"))
      const sourcePath = join(disk.home, "not-created", "bin")
      const input = { candidates: [{ sourcePath, kind: "directory" as const }], truthPath: disk.truthPath, eligibility: disk.eligibility }
      writeFileSync(disk.truthPath, "broken")
      expect(() => planWritableLocations(input)).toThrow("writable location truth")
      expect(readFileSync(disk.truthPath, "utf8")).toBe("broken")
      expect(existsSync(sourcePath)).toBe(false)
      expect(() => planWritableLocations({ ...input, truthPath: disk.state })).toThrow("writable location truth")
      expect(existsSync(sourcePath)).toBe(false)
    })
  })
})

describe("package manager cache planning", () => {
  const inputFor = (disk: Parameters<Parameters<typeof withLocationDisk>[0]>[0]) => ({
    platform: "darwin" as const, goInstallBin: null, xdgCacheHome: null, bunInstall: null, home: disk.home, userDataPath: join(disk.root, "userData"), configHome: join(disk.home, ".config"),
    appData: join(disk.home, "Library", "Application Support"), localAppData: join(disk.home, "Library", "Caches"),
    truthPath: disk.truthPath, eligibility: disk.eligibility,
  })
  test("prepares and binds every cache before exposing one environment projection", () => {
    withLocationDisk((disk) => {
      const input = inputFor(disk)
      mkdirSync(input.userDataPath)
      const plan = planPackageManagerCaches(input)
      expect(plan.cacheEnv.GOCACHE).toBe(join(input.userDataPath, "package-managers", "go", "build"))
      expect(plan.env.PNPM_HOME).toBe(join(disk.home, "Library", "pnpm"))
      expect(plan.cacheEnv.PNPM_HOME).toBeUndefined()
      expect(plan.cacheEnv.CARGO_INSTALL_ROOT).toBeUndefined()
      expect(Object.keys(plan.cacheEnv)).toHaveLength(17)
      expect(plan.cacheEnv.BUN_INSTALL).toBe(join(disk.home, ".bun"))
      expect(plan.locations.filter((entry) => entry.kind === "directory").every((entry) => statSync(entry.targetPath).isDirectory())).toBe(true)
      expect(plan.env.CARGO_HOME).toBeUndefined()
      expect(plan.cacheEnv.CARGO_HOME).toBeUndefined()
      for (const entry of plan.locations.filter((entry) => entry.kind === "file")) expect(existsSync(entry.targetPath)).toBe(false)
      expect(planPackageManagerCaches(input)).toEqual(plan)
    })
  })
  test("paired GOBIN survives the cache projection without granting its installation directory", () => {
    withLocationDisk((disk) => {
      const input = { ...inputFor(disk), goInstallBin: join(disk.home, "original-go/bin") }
      mkdirSync(input.userDataPath)
      const plan = planPackageManagerCaches(input)
      expect(plan.cacheEnv.GOBIN).toBe(input.goInstallBin)
      expect(plan.cacheEnv.GOPATH).toBe(join(input.userDataPath, "package-managers/go/gopath"))
      expect(plan.rules.some((rule) => rule.value === input.goInstallBin)).toBe(false)
      expect(existsSync(input.goInstallBin)).toBe(false)
    })
  })
  test("an app-owned cache root replaced by a symlink is recreated in place; nothing is created outside", () => {
    withLocationDisk((disk) => {
      const input = inputFor(disk)
      mkdirSync(input.userDataPath)
      const outside = join(disk.root, "outside")
      mkdirSync(outside)
      symlinkSync(outside, join(input.userDataPath, "package-managers"))
      const plan = planPackageManagerCaches(input)
      expect(lstatSync(join(input.userDataPath, "package-managers")).isSymbolicLink()).toBe(false)
      expect(plan.cacheEnv.GOCACHE).toBe(join(input.userDataPath, "package-managers", "go", "build"))
      expect(plan.excluded).toEqual([])
      expect(readdirSync(outside)).toEqual([])
    })
  })
  test("one bad cache entry, plan still succeeds: an app-owned cache re-pointed at HOME keeps its first identity", () => {
    withLocationDisk((disk) => {
      const input = inputFor(disk)
      mkdirSync(input.userDataPath)
      const plan = planPackageManagerCaches(input)
      const before = readFileSync(disk.truthPath, "utf8"), homeBefore = readdirSync(disk.home).sort()
      rmSync(plan.cacheEnv.GOCACHE!, { recursive: true })
      symlinkSync(disk.home, plan.cacheEnv.GOCACHE!)
      expect(planPackageManagerCaches(input)).toEqual(plan)
      expect(lstatSync(plan.cacheEnv.GOCACHE!).isDirectory()).toBe(true)
      expect(readFileSync(disk.truthPath, "utf8")).toBe(before)
      expect(readdirSync(disk.home).sort()).toEqual(homeBefore)
    })
  })
  test("one unresolvable user path excludes only its own rule; a dangling Cargo configuration excludes only Cargo caches", () => {
    withLocationDisk((disk) => {
      const input = inputFor(disk)
      mkdirSync(input.userDataPath)
      const cargo = join(disk.home, ".cargo")
      mkdirSync(cargo)
      symlinkSync(join(disk.root, "missing-registry"), join(cargo, "registry"))
      const plan = planPackageManagerCaches(input)
      expect(plan.excluded).toEqual([join(cargo, "registry")])
      expect(plan.rules.some((rule) => rule.value.startsWith(cargo))).toBe(true)
      expect(plan.cacheEnv.GOCACHE).toBe(join(input.userDataPath, "package-managers", "go", "build"))
      unlinkSync(join(cargo, "registry"))
      symlinkSync(join(disk.root, "missing-config"), join(cargo, "config.toml"))
      const dangling = planPackageManagerCaches(input)
      expect(dangling.rules.some((rule) => rule.value.startsWith(cargo))).toBe(false)
      expect(dangling.excluded.length).toBeGreaterThan(0)
      expect(dangling.cacheEnv.GOCACHE).toBe(join(input.userDataPath, "package-managers", "go", "build"))
    })
  })
  test.skipIf(process.platform !== "darwin")("package manager cache rules deny old HOME caches and preserve CF/C1", () => {
    withLocationDisk((disk) => {
      const input = inputFor(disk)
      mkdirSync(input.userDataPath)
      const caches = planPackageManagerCaches(input)
      const project = join(disk.root, "project")
      mkdirSync(project)
      const protectedFile = join(caches.env.GOCACHE!, "protected")
      const credentialFile = join(caches.env.UV_CACHE_DIR!, "credential")
      for (const file of [protectedFile, credentialFile]) writeFileSync(file, "own-before")
      const profile = renderProcessFenceProfile({ workspaces: [project], packageManagerCaches: caches.rules,
        roots: { home: disk.home, configHome: input.configHome, dataHome: join(disk.home, ".local/share"), cacheHome: join(disk.home, ".cache") },
        userDataPath: input.userDataPath, stateHome: input.userDataPath, codepuppyGlobalRoot: disk.state, egressProxyPort: 4443,
        configFence: [{ kind: "literal", path: protectedFile }], homebrewFence: [], credentialStores: [{ kind: "literal", path: credentialFile }],
      })
      const attempt = (file: string) => spawnSync(SANDBOX_EXEC, ["-p", profile, "/bin/sh", "-c", 'printf changed > "$1"', "probe", file], { encoding: "utf8" })
      for (const file of [join(caches.env.GOCACHE!, "positive"), join(disk.home, ".cargo/registry/positive"), join(disk.home, ".cargo/.package-cache"), join(project, "positive")]) expect(attempt(file).status).toBe(0)
      for (const dir of [".npm", ".cache/bun", "Library/Caches/bun", ".cargo/bin"]) {
        const parent = join(disk.home, dir)
        mkdirSync(parent, { recursive: true })
        expect(attempt(join(parent, "negative")).status, dir).not.toBe(0)
        expect(existsSync(join(parent, "negative"))).toBe(false)
      }
      for (const file of [protectedFile, credentialFile]) expect(attempt(file).status).not.toBe(0)
      expect(readFileSync(protectedFile, "utf8")).toBe("own-before")
    })
  })
  test("Cargo preserves original files, binds external cache links and rejects reserved targets", () => {
    withLocationDisk((disk) => {
      const input = inputFor(disk)
      mkdirSync(input.userDataPath)
      const cargo = join(disk.home, ".cargo")
      mkdirSync(cargo)
      for (const name of ["config", "config.toml", "credentials", "credentials.toml"]) writeFileSync(join(cargo, name), `own-${name}`)
      const external = join(disk.root, "external-registry")
      mkdirSync(external)
      symlinkSync(external, join(cargo, "registry"))
      const plan = planPackageManagerCaches(input)
      expect(plan.rules).toContainEqual({ kind: "subpath", value: external })
      for (const name of ["config", "config.toml", "credentials", "credentials.toml"]) expect(readFileSync(join(cargo, name), "utf8")).toBe(`own-${name}`)
      expect(existsSync(join(input.userDataPath, "package-managers", "cargo"))).toBe(false)
      unlinkSync(join(cargo, "registry"))
      symlinkSync(join(cargo, "git"), join(cargo, "registry"))
      // The re-pointed link keeps no grant; every other cache is still planned.
      const repointed = planPackageManagerCaches(input)
      expect(repointed.excluded).toEqual([join(cargo, "registry")])
      expect(repointed.rules).not.toContainEqual({ kind: "subpath", value: external })
      expect(repointed.cacheEnv.GOCACHE).toBe(plan.cacheEnv.GOCACHE)
    })
    for (const name of ["", "bin", "bin/nested", ".crates.toml", ".crates2.json", "config", "config.toml", "credentials", "credentials.toml", "env"]) withLocationDisk((disk) => {
      const input = inputFor(disk)
      mkdirSync(input.userDataPath)
      const cargo = join(disk.home, ".cargo")
      mkdirSync(cargo)
      const target = join(cargo, name)
      if (name && !name.includes(".")) mkdirSync(target, { recursive: true })
      else if (name) writeFileSync(target, "own-reserved")
      const link = join(cargo, name.includes(".") ? ".package-cache" : "registry")
      symlinkSync(target, link)
      const plan = planPackageManagerCaches(input)
      expect(plan.excluded, name).toContain(link)
      expect(plan.rules.some((rule) => processFenceRulesCover({ allow: [rule], deny: [] }, target, "file")), name).toBe(false)
      if (name.includes(".")) expect(readFileSync(target, "utf8")).toBe("own-reserved")
    })
  })
})

test.skipIf(process.platform !== "darwin")("writable location truth stays fenced: production planner denies overwrite and rename; unfenced controls land", () => {
  withLocationDisk((disk) => {
    const project = join(disk.root, "project")
    const userData = join(disk.root, "userData")
    mkdirSync(project)
    const bound = planWritableLocations({ candidates: [{ sourcePath: join(disk.home, ".bun", "bin"), kind: "directory" }], truthPath: disk.truthPath, eligibility: disk.eligibility })
    expect(bound.locations).toHaveLength(1)
    const before = readFileSync(disk.truthPath, "utf8")
    const plan = planProcessFence({
      userDataPath: userData, sidecarEnv: { HOME: disk.home },
      addon: { packaged: false, resourcesPath: "/unused", moduleDir: resolve(import.meta.dir, "../../out/main"), exists: existsSync },
      egressProxyPort: 4443, carriedWorkspaces: [], engineConfigDirectory: disk.protected, homebrewFence: [], credentialStores: [],
    }, {
      homeDir: () => disk.home, codepuppyGlobalRoot: () => join(disk.state, "env", "dev"), appStateRoot: () => disk.state,
      realpath: realpathSync.native, defaultWorkspace: () => project, readWorkspaces: () => [],
      isDirectory: (path) => statSync(path).isDirectory(), stat: (path) => statSync(path, { bigint: true }), lstat: (path) => lstatSync(path, { bigint: true }),
      mkdirp: (path) => void mkdirSync(path, { recursive: true }), compile: trialCompileProfile, log: () => {},
    })
    const attempt = (fenced: boolean, command: string, args: string[]) => spawnSync(fenced ? SANDBOX_EXEC : command, fenced ? ["-p", plan.profile, command, ...args] : args, {
      encoding: "utf8", env: { HOME: disk.home, PATH: "/usr/bin:/bin" }, timeout: 10_000,
    })
    const overwrite = ["-c", 'printf compromised > "$1"', "truth-write", disk.truthPath]
    const moved = join(project, "stolen-truth.json")
    const rename = [disk.truthPath, moved]
    for (const [command, args] of [["/bin/sh", overwrite], ["/bin/mv", rename]] as const) {
      const denied = attempt(true, command, args)
      expect(denied.error).toBeUndefined()
      expect(denied.status).not.toBeNull()
      expect(denied.status).toBeGreaterThan(0)
      expect(denied.stderr.toLowerCase()).toContain("permitted")
      expect(readFileSync(disk.truthPath, "utf8")).toBe(before)
      expect(existsSync(moved)).toBe(false)
    }
    const marker = join(project, "marker")
    expect(attempt(true, "/bin/sh", ["-c", 'printf project > "$1"', "project-write", marker]).status).toBe(0)
    expect(readFileSync(marker, "utf8")).toBe("project")
    expect(attempt(false, "/bin/sh", overwrite).status).toBe(0)
    expect(readFileSync(disk.truthPath, "utf8")).toBe("compromised")
    writeFileSync(disk.truthPath, before)
    expect(attempt(false, "/bin/mv", rename).status).toBe(0)
    expect(existsSync(disk.truthPath)).toBe(false)
    expect(readFileSync(moved, "utf8")).toBe(before)
  })
})

function harness(overrides: Partial<PlanProcessFenceDeps> = {}, existing = new Set<string>([ADDON])) {
  const made: string[] = []
  const logs: string[] = []
  const dirs = new Set([`${HOME}/code-puppy`, `${HOME}/proj-a`, `${HOME}/proj-b`])
  const deps: PlanProcessFenceDeps = {
    homeDir: () => HOME,
    codepuppyGlobalRoot: () => GLOBAL,
    appStateRoot: () => STATE_ROOT,
    // 假盘上的路径不在盘上;这里用恒等让并集走词法比较(真 realpath 的判据在 process-fence-profile.test.ts ④)
    realpath: (p) => p,
    stat: (p) => ({ dev: "fixture", ino: p }),
    // the node itself, not followed: on the fake disk every spelling is its own object (a test that needs «same object under another
    // spelling» injects its own) — never the host's lstatSync on these fake paths (final review R2 item 3)
    lstat: (p) => ({ dev: "fixture", ino: p }),
    defaultWorkspace: () => `${HOME}/code-puppy`,
    // `#1394`:清单来自真源(顺序即优先级:recent 的 proj-b 在前),不再是 store 的三个键
    readWorkspaces: () => [`${HOME}/proj-b`, `${HOME}/proj-a`],
    isDirectory: (p) => dirs.has(p),
    mkdirp: (p) => void made.push(p),
    compile: () => ({ ok: true }),
    log: (l) => void logs.push(l),
    ...overrides,
  }
  const input: PlanProcessFenceInput = {
    userDataPath: USER_DATA,
    sidecarEnv: { HOME },
    addon: { packaged: true, resourcesPath: "/App/Contents/Resources", moduleDir: "/unused", exists: (p) => existing.has(p) },
    egressProxyPort: 4443,
    carriedWorkspaces: [],
    // SPEC-engine-config-fence:server.ts 交给启动文档的同一个值(engineGlobalConfigDirectory)
    engineConfigDirectory: `${HOME}/.config/opencode`,
    // SPEC-stored-credentials-fence §4.5:受保护集这几条只判自己那一轴,存放点清单空(空 ⇒ C1 两块不渲染);C1 的测试自己给 server.ts 交的那份
    homebrewFence: [], credentialStores: [],
  }
  return { deps, input, made, logs }
}

/** ENOENT 形状的 realpath 失败(位置不在盘上)。 */
const enoent = (p: string) => Object.assign(new Error(`ENOENT: no such file or directory, realpath '${p}'`), { code: "ENOENT" })
/** 独立于渲染器的上级目录算法:每个锚点从父目录起到 `/` 之前,按首次出现去重。 */
function ancestorsOf(anchors: string[]): string[] {
  const out: string[] = []
  for (const anchor of anchors) for (let a = anchor.slice(0, anchor.lastIndexOf("/")); a.length > 0; a = a.slice(0, a.lastIndexOf("/"))) if (!out.includes(a)) out.push(a)
  return out
}

describeDarwin("planProcessFence", () => {
  test("SPEC-stored-credentials-fence C1:存放点清单经 planCredentialStores 落到真实路径,渲染成 profile 最后两块(拒读拒写块 + 上级目录拒写块);日志带条数(存放点真实路径求不出 ⇒ planCredentialStores 抛:process-fence-credential-stores.test.ts)", () => {
    const h = harness()
    h.input.credentialStores = credentialStores({ userDataPath: USER_DATA, officialRuntimeParent: OFFICIAL_RUNTIME })
    const plan = planProcessFence(h.input, h.deps)
    const tail = plan.profile.trimEnd().split("\n").slice(-10)
    expect(tail[0]).toBe("(deny file-read* file-write*")
    expect(tail.slice(1, 9).map((line) => line.replace(/\)?\)\s*(;.*)?$/, "").trim())).toEqual([
      `(subpath "${USER_DATA}/codepuppy-secrets"`, `(subpath "${USER_DATA}/codepuppy-mcp-secrets"`, `(literal "${USER_DATA}/codepuppy.env"`,
      `(literal "${USER_DATA}/codepuppy-auth.json"`, `(literal "${USER_DATA}/codepuppy-pkce.json"`, `(literal "${USER_DATA}/codepuppy-byok-keys.json"`,
      `(subpath "${USER_DATA}/Crashpad"`, `(subpath "${OFFICIAL_RUNTIME}"`,
    ])
    expect(tail[9]!.startsWith("(deny file-write* ")).toBe(true)
    expect(h.logs.some((l) => /credentialStores=8 rules/.test(l))).toBe(true)
  })

  test("正向:并集 = 默认 → recent → tab 栏;父目录 W4/W5 与受保护目录预建;addonPath 解析到 extraResources;日志一行账", () => {
    const h = harness()
    const plan = planProcessFence(h.input, h.deps)
    expect(plan.workspaces).toEqual([`${HOME}/code-puppy`, `${HOME}/proj-b`, `${HOME}/proj-a`])
    expect(plan.addonPath).toBe(ADDON)
    expect(plan.dropped).toEqual([])
    expect(plan.attempts).toBe(1)
    expect(plan.profileBytes).toBe(Buffer.byteLength(plan.profile))
    // SPEC-engine-config-fence I4:围栏冻结的每个目录节点在 fork 前已存在(引擎 Global 的 mkdir 只会得到 EEXIST);~/.opencode 谁都不建
    expect(h.made).toEqual([
      `${HOME}/.local/share/opencode`, `${HOME}/.cache/opencode`,
      STATE_ROOT, GLOBAL, `${USER_DATA}/codepuppy-engine-config`, `${USER_DATA}/codepuppy-connections`, `${HOME}/.config/opencode`,
      // CF-11(片 ③):工具策略目录,像其它目录位置一样预建
      `${HOME}/.local/share/opencode/codepuppy-tool-policy`,
    ])
    expect(h.logs.some((l) => /process fence planned: workspaces=3 \(candidates=3, excluded=0, dropped=0\), egressProxyPort=4443, configFence=16 rules/.test(l))).toBe(true)
    // `#1337`:计划里的 profile 带着那扇门(N4 = 传入的代理端口),不是别的端口
    expect(plan.profile).toContain('(allow network-outbound (remote ip "localhost:4443"))')
    expect(plan.profile).toContain("(deny network*)")
    // ~/.opencode(CF-9,谁都不建,BR-07)、~/.zsh_sessions、bun 缓存(dev-only)刻意不建
    expect(h.made.some((d) => d.endsWith("/.opencode") || d.endsWith("/.zsh_sessions") || d.includes("bun"))).toBe(false)
  })

  test("`#1761` N5:计划的 profile 在 N4 之后、受保护集之前放行本用户 LibreOffice 单实例管道族的 bind/accept,紧跟拒绝这个 HOME 的默认 profile($HOME/Library/Application Support/LibreOffice/4)的确切管道名", () => {
    // HOME 取一个真实采样:LibreOffice 26.8.3.1 以这个 HOME 的默认 profile 启动时建的管道名就是下面的 hash(plan.md r5 证明 3 的采集记录)
    const home = "/private/tmp/lo1761-cap/home-ascii"
    const h = harness({ homeDir: () => home })
    h.input.sidecarEnv = { HOME: home }
    const uid = process.getuid!()
    const lines = planProcessFence(h.input, h.deps).profile.split("\n").map((line) => line.replace(/\s*;.*$/, "").trim())
    const n4 = lines.findIndex((line) => line.startsWith("(allow network-outbound"))
    expect(lines.slice(n4 + 1, n4 + 3)).toEqual([
      `(allow network-bind network-inbound (local unix-socket (path-regex #"^/private/tmp/OSL_PIPE_${uid}_SingleOfficeIPC_[0-9a-f]+$")))`,
      `(deny network-bind network-inbound (local unix-socket (path-literal "/private/tmp/OSL_PIPE_${uid}_SingleOfficeIPC_544bb8688380f4abd07fb835db5f64cb")))`,
    ])
    expect(lines[n4 + 3]).toBe("(deny file-write*")
  })

  // 代码审查 R1-1:LibreOffice 推算前先解析软链(bootstrap.cxx、file_url.cxx),计划器给的路径 = 已存在部分的真实路径 + 尚未创建的后缀。
  // 两个真实采样(plan.md r5 采集记录 2026-11-28):HOME 经系统软链 /tmp、HOME 本身是软链;假盘复现采样时的软链,profile 目录尚未创建
  test.each([
    { home: "/tmp/lo1761-cap2/home", link: ["/tmp", "/private/tmp"], pipe: "9dfde0baa068139ee9d12a3b8a3f96" },
    { home: "/private/tmp/lo1761-cap2/link-home", link: ["/private/tmp/lo1761-cap2/link-home", "/private/tmp/lo1761-cap2/real-home"], pipe: "b72d7575b186695ff1c06bc77a3f51d5" },
  ])("`#1761` N5:HOME 经软链($home)⇒ 拒绝行是 LibreOffice 解析软链后的那个管道名", ({ home, link, pipe }) => {
    const [from, to] = link as [string, string]
    const resolve = (p: string) => (p === from || p.startsWith(`${from}/`) ? to + p.slice(from.length) : p)
    const h = harness({
      homeDir: () => home,
      realpath: (p) => {
        if (p.startsWith(`${home}/Library`)) throw enoent(p) // the default profile is not created yet
        return resolve(p)
      },
    })
    h.input.sidecarEnv = { HOME: home }
    const uid = process.getuid!()
    const profile = planProcessFence(h.input, h.deps).profile
    expect(profile).toContain(`(deny network-bind network-inbound (local unix-socket (path-literal "/private/tmp/OSL_PIPE_${uid}_SingleOfficeIPC_${pipe}")))`)
  })

  test("用户导出 XDG_STATE_HOME ⇒ 多建 <state>/opencode,profile 多一行 W3;XDG_DATA_HOME 跟着 env", () => {
    const h = harness()
    h.input.sidecarEnv = { HOME, XDG_STATE_HOME: "/Volumes/s", XDG_DATA_HOME: "/Volumes/d" }
    const plan = planProcessFence(h.input, h.deps)
    expect(h.made).toContain("/Volumes/s/opencode")
    expect(h.made).toContain("/Volumes/d/opencode")
    // CF-11 follows the exported data home (where ext reads and main writes the tool policy)
    expect(h.made).toContain("/Volumes/d/opencode/codepuppy-tool-policy")
    expect(plan.configFenceRoots).toContain("/Volumes/d/opencode/codepuppy-tool-policy")
    expect(plan.profile).toContain(`(subpath "/Volumes/s/opencode")`)
    expect(plan.roots.stateHome).toBe("/Volumes/s")
  })

  test("`#1394` 真源拿不到(缺失 / 解析失败):不炸,并集退到默认工作区(fail-closed,不是「什么都可写」),日志点名原因", () => {
    for (const reason of ["workspace truth absent: /AS/codepuppy-state/fence-workspaces/prod.json", "workspace truth /AS/codepuppy-state/fence-workspaces/prod.json: not JSON (Unexpected token)"]) {
      const h = harness({
        readWorkspaces: () => {
          throw new Error(reason)
        },
      })
      const plan = planProcessFence(h.input, h.deps)
      expect(plan.workspaces).toEqual([`${HOME}/code-puppy`])
      expect(plan.profile.match(/; W1$/gm)?.length).toBe(1)
      expect(h.logs).toContain(`process fence: workspace truth unavailable — workspace union falls back to the default workspace only: ${reason}`)
    }
  })

  test("试编译只放得下 2 个 ⇒ 丢掉最旧的(尾部),日志写明丢了谁与编译器原文", () => {
    const h = harness({
      compile: (profile) => ((profile.match(/; W1$/gm)?.length ?? 0) <= 2 ? { ok: true } : { ok: false, reason: "data object length 70173 exceeds maximum (65535)" }),
    })
    const plan = planProcessFence(h.input, h.deps)
    expect(plan.workspaces).toEqual([`${HOME}/code-puppy`, `${HOME}/proj-b`])
    expect(plan.dropped).toEqual([`${HOME}/proj-a`])
    expect(plan.attempts).toBe(2)
    expect(h.logs.some((l) => l.includes("dropped=1") && l.includes(`${HOME}/proj-a`) && l.includes("exceeds maximum"))).toBe(true)
  })

  test("fail-closed ①:字节墙之外的编译失败 ⇒ 一个工作区都不丢就抛,原因原文可读,且点名「不是并集大小」(`#1337` 归因)", () => {
    const h = harness({ compile: () => ({ ok: false, reason: "sandbox-exec: unbound variable: host … line 25, column 33" }) })
    expect(() => planProcessFence(h.input, h.deps)).toThrow(/not the 65535-byte data-object wall.*none were dropped \(3 workspaces, 0 dropped, 1 attempt\): sandbox-exec: unbound variable: host/)
  })

  test("fail-closed ①′:字节墙丢到只剩默认工作区仍编不过 ⇒ 抛「最小可写集」,账目可读", () => {
    const h = harness({ compile: () => ({ ok: false, reason: "sandbox-exec: data object length 70173 exceeds maximum (65535)" }) })
    expect(() => planProcessFence(h.input, h.deps)).toThrow(/minimum writable set \(1 workspace, 2 dropped, 3 attempts\): .*exceeds maximum/)
  })

  test("fail-closed ④(`#1337`):代理端口不合法 ⇒ 不产计划(围栏没有那扇门就不许装)", () => {
    const h = harness()
    for (const bad of [0, 65536, 1.5, Number.NaN]) {
      h.input.egressProxyPort = bad
      expect(() => planProcessFence(h.input, h.deps), String(bad)).toThrow(/egress proxy port must be an integer in 1\.\.65535/)
    }
  })

  test("fail-closed ②:原生模块不在 ⇒ 抛并点名路径(打包漏了 extraResources 就是这一格)", () => {
    const h = harness({}, new Set())
    expect(() => planProcessFence(h.input, h.deps)).toThrow(new RegExp(`native module missing at ${ADDON.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))
  })

  test("fail-closed ③:默认工作区不在盘上 ⇒ 抛(不代建)", () => {
    const h = harness({ isDirectory: () => false })
    expect(() => planProcessFence(h.input, h.deps)).toThrow(/default workspace is not a directory/)
    expect(h.made).not.toContain(`${HOME}/code-puppy`)
  })

  test("`#1390` 真源里一条记录指向应用状态根的祖先 ⇒ 仍不进 workspaces、不进 profile,进 excluded,且 planned 那行日志如实记账(第二道闸不因清单搬家而拆,`#1394`)", () => {
    const forged = `${HOME}/Library/Application Support`
    const h = harness({
      readWorkspaces: () => [forged],
      // 盘上「都在」:排除只能来自状态根规则
      isDirectory: () => true,
    })
    const plan = planProcessFence(h.input, h.deps)
    expect(plan.workspaces).toEqual([`${HOME}/code-puppy`])
    expect(plan.profile).not.toContain(`(subpath "${forged}")`)
    expect(plan.excluded).toEqual([
      {
        directory: "/Users/alpha/Library/Application Support",
        reason:
          "related to the app state root /Users/alpha/Library/Application Support/codepuppy-state (same path, inside it, or contains it) — the fence's own state must never be a workspace (#1390)",
      },
    ])
    const planned = h.logs.find((l) => l.startsWith("process fence planned:"))
    expect(planned).toContain("workspaces=1 (candidates=2, excluded=1, dropped=0)")
    expect(planned).toContain("— excluded: /Users/alpha/Library/Application Support (related to the app state root /Users/alpha/Library/Application Support/codepuppy-state")
  })

  test("SPEC-engine-config-fence E9:计划出的 profile 带受保护集两块(N4 之后),解析回来 deny = 计划给的规则 + 全部上级目录;configFenceRoots = 其中的目录位置", () => {
    const h = harness()
    const plan = planProcessFence(h.input, h.deps)
    const cf = planConfigFence({ userDataPath: USER_DATA, appStateRoot: STATE_ROOT, codepuppyGlobalRoot: GLOBAL, engineConfigDirectory: `${HOME}/.config/opencode`, roots: plan.roots }, { realpath: (p) => p, mkdirp: () => {}, lstat: (p) => ({ dev: "fixture", ino: p }) })
    const asRule = (rule: (typeof cf.configFence)[number]): ProcessFenceWriteRule =>
      rule.kind === "dat-files" ? { kind: "regex", value: `^${rule.dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/[^/]+\\.[dD][aA][tT]$` } : { kind: rule.kind, value: rule.path }
    const anchors = cf.configFence.map((rule) => (rule.kind === "dat-files" ? `${rule.dir}/x` : rule.path))
    expect(processFenceWriteRules(plan.profile).deny).toEqual([...cf.configFence.map(asRule), ...ancestorsOf(anchors).map((value) => ({ kind: "literal" as const, value }))])
    expect(plan.profile.indexOf("(deny file-write*\n", plan.profile.indexOf("(allow network-outbound"))).toBeGreaterThan(0)
    expect(plan.configFenceRoots).toEqual([STATE_ROOT, GLOBAL, `${USER_DATA}/codepuppy-engine-config`, `${USER_DATA}/codepuppy-connections`, `${HOME}/.config/opencode`, `${HOME}/.opencode`, `${HOME}/.local/share/opencode/codepuppy-tool-policy`])
    expect(plan.configFenceRoots).toEqual(cf.configFenceRoots)
  })

  test("真实路径:每个位置写成「真实上级目录 + 名字」;位置本身是软链 ⇒ 再加它的真实目标(同一种规则);不在盘上(ENOENT)⇒ 只写位置;别的 realpath 错误 ⇒ 抛(拒 fork)", () => {
    const REAL_UD = "/Volumes/data/userdata"
    const TARGET = `${HOME}/dotfiles/engine-config`
    const realpath = (p: string) => {
      if (p === `${USER_DATA}/codepuppy-engine-config`) return TARGET
      if (p === `${USER_DATA}/codepuppy.env`) throw enoent(p)
      return p.startsWith(USER_DATA) ? REAL_UD + p.slice(USER_DATA.length) : p
    }
    const h = harness({ realpath })
    const plan = planProcessFence(h.input, h.deps)
    const deny = processFenceWriteRules(plan.profile).deny
    // 软链位置:链本身(真实上级目录 + 名字)与真实目标都在
    expect(deny).toContainEqual({ kind: "subpath", value: `${REAL_UD}/codepuppy-engine-config` })
    expect(deny).toContainEqual({ kind: "subpath", value: TARGET })
    expect(plan.configFenceRoots).toContain(TARGET)
    // 不在盘上的 literal 只写「真实上级目录 + 名字」(literal 对尚不存在的文件同样挡住新建)
    expect(deny).toContainEqual({ kind: "literal", value: `${REAL_UD}/codepuppy.env` })
    // 经软链的 userData:规则里只有真实路径;链路径只以节点出现在上级目录块里 —— 链节点本身与它上面配置路径上的目录(修订 2 B)
    expect(deny.filter((rule) => rule.kind !== "literal" && rule.value.includes(USER_DATA))).toEqual([])
    expect(deny.filter((rule) => rule.kind === "literal" && rule.value.includes(USER_DATA))).toEqual([{ kind: "literal", value: USER_DATA }])
    for (const node of [`${HOME}/Library/Application Support`, `${HOME}/Library`]) expect(deny).toContainEqual({ kind: "literal", value: node })
    expect(deny).toContainEqual({ kind: "regex", value: "^/Volumes/data/userdata/[^/]+\\.[dD][aA][tT]$" })
    // 别的 realpath 错误 ⇒ 抛(既有「计划失败 ⇒ 拒 fork」路径)
    const denied = harness({ realpath: (p) => { if (p === `${HOME}/opencode.json`) throw Object.assign(new Error("EACCES"), { code: "EACCES" }); return p } })
    expect(() => planProcessFence(denied.input, denied.deps)).toThrow(/EACCES/)
  })

  test("环境根恒列(在状态根之内时多一条冗余规则);用户导出 OPENCODE_CONFIG_DIR ⇒ 两个配置目录都列都预建", () => {
    const outside = harness({ codepuppyGlobalRoot: () => "/Volumes/dev/codepuppy-env" })
    outside.input.engineConfigDirectory = "/Volumes/cfg/opencode"
    const plan = planProcessFence(outside.input, outside.deps)
    expect(plan.configFenceRoots).toEqual([STATE_ROOT, "/Volumes/dev/codepuppy-env", `${USER_DATA}/codepuppy-engine-config`, `${USER_DATA}/codepuppy-connections`, "/Volumes/cfg/opencode", `${HOME}/.config/opencode`, `${HOME}/.opencode`, `${HOME}/.local/share/opencode/codepuppy-tool-policy`])
    expect(outside.made).toContain("/Volumes/cfg/opencode")
    expect(outside.made.some((d) => d.endsWith("/.opencode"))).toBe(false)
  })

  // DESIGN-engine-config-fence 实现期修订 2 A:CODEPUPPY_ENV_FILE 指向的那份并入 CF-4(literal + 上级目录节点),这一项从不让计划失败
  test("修订 2 A:设置了 CODEPUPPY_ENV_FILE ⇒ 那份文件一条 literal(真实路径)加它的上级目录节点;不设 ⇒ 规则不变", () => {
    const unset = planProcessFence(harness().input, harness().deps)
    const set = harness()
    set.input.envFile = `${HOME}/secrets/cp.env`
    const plan = planProcessFence(set.input, set.deps)
    const deny = processFenceWriteRules(plan.profile).deny
    expect(deny).toContainEqual({ kind: "literal", value: `${HOME}/secrets/cp.env` })
    expect(deny).toContainEqual({ kind: "literal", value: `${HOME}/secrets` })
    expect(processFenceWriteRules(unset.profile).deny.some((rule) => rule.value.includes("/secrets"))).toBe(false)
    expect(set.logs.some((line) => /configFence=17 rules/.test(line))).toBe(true)
    // 与 <userData>/codepuppy.env 是同一份 ⇒ 不重复
    const same = harness()
    same.input.envFile = `${USER_DATA}/codepuppy.env`
    expect(processFenceWriteRules(planProcessFence(same.input, same.deps).profile).deny.filter((rule) => rule.value === `${USER_DATA}/codepuppy.env`)).toHaveLength(1)
    // 本身是软链 ⇒ 再加真实目标
    const linked = harness({ realpath: (p) => (p === `${HOME}/secrets/cp.env` ? `${HOME}/dotfiles/cp.env` : p) })
    linked.input.envFile = `${HOME}/secrets/cp.env`
    const linkedDeny = processFenceWriteRules(planProcessFence(linked.input, linked.deps).profile).deny
    expect(linkedDeny).toContainEqual({ kind: "literal", value: `${HOME}/secrets/cp.env` })
    expect(linkedDeny).toContainEqual({ kind: "literal", value: `${HOME}/dotfiles/cp.env` })
  })

  test("修订 2 A:上级目录不在盘上 ⇒ 取最深一级已存在祖先的真实路径接上余下部分,计划照常;任何解析错误、引号路径都不让计划失败", () => {
    // 最深一级已存在的祖先 ~/secret-root 是指到别处的软链
    const missing = harness({
      realpath: (p) => {
        if (p.startsWith(`${HOME}/secret-root/missing`)) throw enoent(p)
        return p === `${HOME}/secret-root` ? "/Volumes/secret" : p
      },
    })
    missing.input.envFile = `${HOME}/secret-root/missing/dir/cp.env`
    const deny = processFenceWriteRules(planProcessFence(missing.input, missing.deps).profile).deny
    expect(deny).toContainEqual({ kind: "literal", value: "/Volumes/secret/missing/dir/cp.env" })
    expect(deny).toContainEqual({ kind: "literal", value: "/Volumes/secret/missing/dir" })
    expect(deny).toContainEqual({ kind: "literal", value: "/Volumes/secret/missing" })
    const failing = harness({ realpath: (p) => { if (p.includes("/odd/")) throw Object.assign(new Error("EACCES"), { code: "EACCES" }); return p } })
    failing.input.envFile = `${HOME}/odd/x/cp.env`
    expect(processFenceWriteRules(planProcessFence(failing.input, failing.deps).profile).deny).toContainEqual({ kind: "literal", value: `${HOME}/odd/x/cp.env` })
    const quoted = harness()
    quoted.input.envFile = `${HOME}/we"ird/cp.env`
    expect(() => planProcessFence(quoted.input, quoted.deps)).not.toThrow()
  })

  test("终审第 2 条:CODEPUPPY_ENV_FILE=/dev/null(或别的 /dev 下的路径)⇒ 不出这一行 —— 拒写 /dev/null 会让引擎与子进程的 >/dev/null、忽略的 stdio 全部失败", () => {
    const baseline = processFenceWriteRules(planProcessFence(harness().input, harness().deps).profile).deny
    for (const envFile of ["/dev/null", "/dev/fd/3", "/dev/stdout"]) {
      const h = harness()
      h.input.envFile = envFile
      const deny = processFenceWriteRules(planProcessFence(h.input, h.deps).profile).deny
      expect([envFile, deny]).toEqual([envFile, baseline])
    }
    // 确认审查 R2 第 1 条:env 文件是指到 /dev/null 的软链(项目里的 cp.env → /dev/null)⇒ 只丢落在 /dev 下的那条(真实目标);链节点自己的
    // literal 与它路径上的节点照留 —— 否则对话删掉这条链、写一个普通文件,主进程下次启动就读它
    const linked = harness({ realpath: (p) => (p === `${HOME}/proj-a/cp.env` ? "/dev/null" : p) })
    linked.input.envFile = `${HOME}/proj-a/cp.env`
    const linkedDeny = processFenceWriteRules(planProcessFence(linked.input, linked.deps).profile).deny
    expect(linkedDeny).toContainEqual({ kind: "literal", value: `${HOME}/proj-a/cp.env` })
    expect(linkedDeny).toContainEqual({ kind: "literal", value: `${HOME}/proj-a` })
    expect(linkedDeny.filter((rule) => rule.value === "/dev" || rule.value.startsWith("/dev/"))).toEqual([])
  })

  test("修订 2 A:文件在工作区里 ⇒ 工作区照常可写,只有那份文件与它路径上的目录节点被拒;同一文件夹里别的文件、子文件夹照常", () => {
    const h = harness()
    h.input.envFile = `${HOME}/proj-a/conf/cp.env`
    const plan = planProcessFence(h.input, h.deps)
    expect(plan.workspaces).toContain(`${HOME}/proj-a`)
    const rules = processFenceWriteRules(plan.profile)
    expect(rules.deny).toContainEqual({ kind: "literal", value: `${HOME}/proj-a/conf/cp.env` })
    expect(processFenceRulesCover(rules, `${HOME}/proj-a/conf/other`)).toBe(true)
    expect(processFenceRulesCover(rules, `${HOME}/proj-a/src`)).toBe(true)
    // 路径上的目录节点本身(运行期放行按既有上级目录节点处理:走签发路径)
    expect(processFenceRulesCover(rules, `${HOME}/proj-a/conf`)).toBe(false)
    expect(processFenceRulesCover(rules, `${HOME}/proj-a`)).toBe(false)
  })

  test("修订 2 A:一个来源 —— 计划器与主进程读的是同一份:相对路径按主进程当前目录解析,loadCodePuppySecrets 读的正是 userEnvFile 给的那份", () => {
    expect(userEnvFile({})).toBeUndefined()
    expect(userEnvFile({ CODEPUPPY_ENV_FILE: "" })).toBeUndefined()
    expect(userEnvFile({ CODEPUPPY_ENV_FILE: "/abs/cp.env" })).toBe("/abs/cp.env")
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), "cf-envfile-")))
    const previous = { cwd: process.cwd(), file: process.env.CODEPUPPY_ENV_FILE, disable: process.env.CODEPUPPY_SECRETS_DISABLE, probe: process.env.CF13_ENV_FILE_PROBE }
    try {
      process.chdir(cwd)
      mkdirSync(join(cwd, "rel"))
      writeFileSync(join(cwd, "rel", "cp.env"), "CF13_ENV_FILE_PROBE=read\n")
      delete process.env.CODEPUPPY_SECRETS_DISABLE
      delete process.env.CF13_ENV_FILE_PROBE
      process.env.CODEPUPPY_ENV_FILE = "rel/cp.env"
      expect(userEnvFile(process.env)).toBe(resolve(cwd, "rel/cp.env"))
      loadCodePuppySecrets(join(cwd, "no-user-data"))
      expect(process.env.CF13_ENV_FILE_PROBE).toBe("read")
    } finally {
      process.chdir(previous.cwd)
      for (const [name, value] of [["CODEPUPPY_ENV_FILE", previous.file], ["CODEPUPPY_SECRETS_DISABLE", previous.disable], ["CF13_ENV_FILE_PROBE", previous.probe]] as const)
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  // 实现期修订 2 B:上级目录节点沿真实路径与配置路径(未解析)各算一遍 —— 配置路径上住在项目里的软链节点与它上面的项目文件夹也冻结
  test("修订 2 B:XDG_CONFIG_HOME 是项目里的软链 ⇒ 链节点本身与它上面的项目文件夹进上级目录块;规则只有真实路径;项目本身照常可写,只是走签发路径", () => {
    const link = `${HOME}/proj-a/cfglink`
    const realpath = (p: string) => (p === link || p.startsWith(`${link}/`) ? `${HOME}/real-cfg${p.slice(link.length)}` : p)
    const h = harness({ realpath })
    h.input.sidecarEnv = { HOME, XDG_CONFIG_HOME: link }
    h.input.engineConfigDirectory = `${link}/opencode`
    const plan = planProcessFence(h.input, h.deps)
    const rules = processFenceWriteRules(plan.profile)
    expect(rules.deny).toContainEqual({ kind: "subpath", value: `${HOME}/real-cfg/opencode` })
    expect(rules.deny).toContainEqual({ kind: "literal", value: link })
    expect(rules.deny).toContainEqual({ kind: "literal", value: `${HOME}/proj-a` })
    expect(rules.deny.filter((rule) => rule.kind !== "literal" && rule.value.includes("cfglink"))).toEqual([])
    // 链下面的节点按身份就是真实路径上的那一个,不另列
    expect(rules.deny.filter((rule) => rule.value.startsWith(`${link}/`))).toEqual([])
    expect(new Set(rules.deny.map((rule) => `${rule.kind}:${rule.value}`)).size).toBe(rules.deny.length)
    expect(plan.workspaces).toContain(`${HOME}/proj-a`)
    expect(processFenceRulesCover(rules, `${HOME}/proj-a`)).toBe(false)
    expect(processFenceRulesCover(rules, `${HOME}/proj-a/src`)).toBe(true)
    expect(plan.configFenceRoots).toContain(`${HOME}/real-cfg/opencode`)
  })

  test("终审第 3 条:两跳软链(配置路径 W/a/b,W/a → W/real-a,W/real-a/b → 真实目录)⇒ 每个配置路径节点所在真实位置的上级链也冻结(W/real-a 在内)", () => {
    const W = `${HOME}/proj-a`
    const realpath = (p: string) => {
      for (const [from, to] of [[`${W}/a/b`, `${W}/cfg-real`], [`${W}/real-a/b`, `${W}/cfg-real`], [`${W}/a`, `${W}/real-a`]] as const)
        if (p === from || p.startsWith(`${from}/`)) return to + p.slice(from.length)
      return p
    }
    const h = harness({ realpath })
    h.input.sidecarEnv = { HOME, XDG_CONFIG_HOME: `${W}/a/b` }
    h.input.engineConfigDirectory = `${W}/a/b/opencode`
    const deny = processFenceWriteRules(planProcessFence(h.input, h.deps).profile).deny
    expect(deny).toContainEqual({ kind: "subpath", value: `${W}/cfg-real/opencode` })
    for (const node of [`${W}/a`, `${W}/real-a/b`, `${W}/real-a`, W]) expect(deny, node).toContainEqual({ kind: "literal", value: node })
    expect(new Set(deny.map((rule) => `${rule.kind}:${rule.value}`)).size).toBe(deny.length)
  })

  test("终审第 4 条:配置路径上一个写不进 profile 的节点(名字里有引号的软链)只丢那一个节点 —— env 文件的 literal 照留;配置目录位置照常计划,不因它拒 fork", () => {
    const quoted = `${HOME}/My "dots"`
    const realpath = (p: string) => (p === quoted || p.startsWith(`${quoted}/`) ? `${HOME}/proj-a/dots${p.slice(quoted.length)}` : p)
    const env = harness({ realpath })
    env.input.envFile = `${quoted}/cp.env`
    const envDeny = processFenceWriteRules(planProcessFence(env.input, env.deps).profile).deny
    expect(envDeny).toContainEqual({ kind: "literal", value: `${HOME}/proj-a/dots/cp.env` })
    expect(envDeny.some((rule) => rule.value.includes('"'))).toBe(false)
    const cfg = harness({ realpath })
    cfg.input.sidecarEnv = { HOME, XDG_CONFIG_HOME: quoted }
    cfg.input.engineConfigDirectory = `${quoted}/opencode`
    const plan = planProcessFence(cfg.input, cfg.deps)
    const deny = processFenceWriteRules(plan.profile).deny
    expect(deny).toContainEqual({ kind: "subpath", value: `${HOME}/proj-a/dots/opencode` })
    expect(deny.some((rule) => rule.value.includes('"'))).toBe(false)
  })

  test("终审第 6a 条:节点按 device + inode 判「同一对象」,不按小写字符串 —— 区分大小写的卷上,指向只差大小写的兄弟目录的软链节点照样冻结", () => {
    const link = `${HOME}/proj-a/Cfg`
    const sibling = `${HOME}/proj-a/cfg`
    const realpath = (p: string) => (p === link || p.startsWith(`${link}/`) ? sibling + p.slice(link.length) : p)
    const lstat = (p: string) => ({ dev: 1, ino: p === link ? "link-inode" : `dir:${p}` })
    const h = harness({ realpath, lstat })
    h.input.sidecarEnv = { HOME, XDG_CONFIG_HOME: link }
    h.input.engineConfigDirectory = `${link}/opencode`
    const deny = processFenceWriteRules(planProcessFence(h.input, h.deps).profile).deny
    expect(deny).toContainEqual({ kind: "subpath", value: `${sibling}/opencode` })
    expect(deny).toContainEqual({ kind: "literal", value: link })
  })

  test("确认审查 R2 残留 R11:写不进 profile 的路径(配置路径节点、env 文件本身)不被冻结 —— 计划时一行日志逐个点名(只写路径),不是静默", () => {
    const quoted = `${HOME}/My "dots"`
    const realpath = (p: string) => (p === quoted || p.startsWith(`${quoted}/`) ? `${HOME}/proj-a/dots${p.slice(quoted.length)}` : p)
    const h = harness({ realpath })
    h.input.sidecarEnv = { HOME, XDG_CONFIG_HOME: quoted }
    h.input.engineConfigDirectory = `${quoted}/opencode`
    h.input.envFile = `${HOME}/we"ird/cp.env`
    planProcessFence(h.input, h.deps)
    const lines = h.logs.filter((line) => line.includes("cannot be written into the profile"))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(JSON.stringify(quoted))
    expect(lines[0]).toContain(JSON.stringify(`${HOME}/we"ird/cp.env`))
    // nothing unexpressible ⇒ no such line
    const plain = harness()
    planProcessFence(plain.input, plain.deps)
    expect(plain.logs.some((line) => line.includes("cannot be written into the profile"))).toBe(false)
  })

  test("修订 2 B:两种写法指同一个节点按身份去重(大小写变体 ⇒ 只列真实写法);配置路径与真实路径相同 ⇒ 规则与上级目录块不变", () => {
    const upper = `${HOME}/PROJ-A`
    const realpath = (p: string) => {
      if (p === `${upper}/cfglink` || p.startsWith(`${upper}/cfglink/`)) return `${HOME}/real-cfg${p.slice(`${upper}/cfglink`.length)}`
      return p === upper || p.startsWith(`${upper}/`) ? `${HOME}/proj-a${p.slice(upper.length)}` : p
    }
    // node identity (not followed): a case variant is the same object; the link node is its own object
    const lstat = (p: string) => ({ dev: 1, ino: p === `${HOME}/proj-a/cfglink` ? "link" : p.toLowerCase() })
    const h = harness({ realpath, lstat })
    h.input.sidecarEnv = { HOME, XDG_CONFIG_HOME: `${upper}/cfglink` }
    h.input.engineConfigDirectory = `${upper}/cfglink/opencode`
    const deny = processFenceWriteRules(planProcessFence(h.input, h.deps).profile).deny
    expect(deny).toContainEqual({ kind: "literal", value: `${HOME}/proj-a/cfglink` })
    expect(deny).toContainEqual({ kind: "literal", value: `${HOME}/proj-a` })
    expect(deny.filter((rule) => rule.value.includes("PROJ-A"))).toEqual([])
    const plain = harness()
    const plan = planProcessFence(plain.input, plain.deps)
    const cf = planConfigFence({ userDataPath: USER_DATA, appStateRoot: STATE_ROOT, codepuppyGlobalRoot: GLOBAL, engineConfigDirectory: `${HOME}/.config/opencode`, roots: plan.roots }, { realpath: (p) => p, mkdirp: () => {}, lstat: (p) => ({ dev: "fixture", ino: p }) })
    expect(cf.configFence.some((rule) => "via" in rule)).toBe(false)
  })

  test("修订 2 C:预建的目录位置本身是坏掉的软链 ⇒ 预建抛错、计划失败(拒 fork,预期失败);不跳过预建", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "cf-dangling-")))
    try {
      const home = join(base, "home")
      mkdirSync(join(home, ".config"), { recursive: true })
      require("node:fs").symlinkSync(join(base, "gone"), join(home, ".config", "opencode"))
      expect(() =>
        planConfigFence(
          { userDataPath: join(base, "ud"), appStateRoot: join(base, "state"), codepuppyGlobalRoot: join(base, "state", "env", "dev"), engineConfigDirectory: join(home, ".config", "opencode"), roots: { home, dataHome: join(home, ".local", "share"), cacheHome: join(home, ".cache"), configHome: join(home, ".config") } },
          { realpath: (p) => realpathSync.native(p), mkdirp: (p) => void mkdirSync(p, { recursive: true }) },
        ),
      // 生产的 Electron Node 报 ENOENT(设计证据 r4/C-mkdir.out);bun 的递归 mkdir 对同一个坏软链报 EEXIST。两者都抛 ⇒ 计划失败
      ).toThrow(/ENOENT|EEXIST/)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test("审查 R1 Minor(编排器裁决):用户经 OPENCODE_CONFIG_DIR 亲自把 ~/.opencode 指定为引擎全局配置目录 ⇒ 它按 CF-8 照常预建,大小写变体同样;只有 CF-9 那一条从不预建", () => {
    for (const engineConfigDirectory of [`${HOME}/.opencode`, `${HOME}/.OPENCODE`]) {
      const h = harness()
      h.input.engineConfigDirectory = engineConfigDirectory
      const plan = planProcessFence(h.input, h.deps)
      expect([engineConfigDirectory, h.made.filter((d) => d === engineConfigDirectory)]).toEqual([engineConfigDirectory, [engineConfigDirectory]])
      expect(plan.configFenceRoots).toContain(engineConfigDirectory)
    }
    // the default machine: nothing names ~/.opencode as a configuration directory ⇒ nobody creates it
    const plain = harness()
    planProcessFence(plain.input, plain.deps)
    expect(plain.made).not.toContain(`${HOME}/.opencode`)
  })

  test("审查 R1:CF-9 本身是用户建的软链(BR-01)—— 指向目录 / 指向文件 ⇒ 链本身与真实目标各成一条规则、目标进资格判定的根;坏链 ⇒ 当作不存在,只保护链本身;三种都不抛、都不预建", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "cf9-link-")))
    try {
      const home = join(base, "home")
      const dot = join(home, ".opencode")
      mkdirSync(join(home, "dotfiles", "oc"), { recursive: true })
      writeFileSync(join(home, "afile"), "x")
      const plan = (target: string) => {
        rmSync(dot, { force: true })
        symlinkSync(target, dot)
        const made: string[] = []
        const result = planConfigFence(
          { userDataPath: join(base, "ud"), appStateRoot: join(base, "state"), codepuppyGlobalRoot: join(base, "state", "env", "dev"), engineConfigDirectory: join(home, ".config", "opencode"), roots: { home, dataHome: join(home, ".local", "share"), cacheHome: join(home, ".cache"), configHome: join(home, ".config") } },
          { realpath: (p) => realpathSync.native(p), mkdirp: (p) => void (made.push(p), mkdirSync(p, { recursive: true })) },
        )
        const mine = result.configFence.filter((rule) => rule.kind === "subpath" && (rule.path === dot || rule.path.startsWith(join(home, "dotfiles")) || rule.path === join(home, "afile") || rule.path === join(home, "gone")))
        return { ...result, made, mine }
      }
      const dir = plan(join(home, "dotfiles", "oc"))
      expect(dir.mine).toEqual([{ kind: "subpath", path: dot }, { kind: "subpath", path: join(home, "dotfiles", "oc") }])
      expect(dir.configFenceRoots).toEqual(expect.arrayContaining([dot, join(home, "dotfiles", "oc")]))
      expect(dir.made).not.toContain(dot)
      const file = plan(join(home, "afile"))
      expect(file.mine).toEqual([{ kind: "subpath", path: dot }, { kind: "subpath", path: join(home, "afile") }])
      expect(file.made).not.toContain(dot)
      const dangling = plan(join(home, "gone"))
      expect(dangling.mine).toEqual([{ kind: "subpath", path: dot }])
      expect(dangling.made).not.toContain(dot)
      expect(existsSync(join(home, "gone"))).toBe(false)
      expect(lstatSync(dot).isSymbolicLink()).toBe(true)
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test("BR-05:真源里一条记录落在受保护配置位置之内 ⇒ 不进 workspaces、不进 profile,进 excluded 并点名位置;~/.opencode 本身与其内同样(CF-9,BR-07)", () => {
    const h = harness({ readWorkspaces: () => [`${HOME}/.config/opencode/plugin`, `${HOME}/.opencode`, `${HOME}/.opencode/proj`, `${HOME}/proj-a`], isDirectory: () => true })
    const plan = planProcessFence(h.input, h.deps)
    expect(plan.workspaces).toEqual([`${HOME}/code-puppy`, `${HOME}/proj-a`])
    expect(plan.excluded).toEqual([
      { directory: `${HOME}/.config/opencode/plugin`, reason: `inside the protected engine configuration location ${HOME}/.config/opencode` },
      { directory: `${HOME}/.opencode`, reason: `inside the protected engine configuration location ${HOME}/.opencode` },
      { directory: `${HOME}/.opencode/proj`, reason: `inside the protected engine configuration location ${HOME}/.opencode` },
    ])
    expect(plan.profile).not.toContain(`(subpath "${HOME}/.config/opencode/plugin")`)
    expect(plan.profile).not.toMatch(/\(subpath "[^"]*\/\.opencode(\/proj)?"\)\s+; W1$/m)
  })

  test("dev 形态:addonPath 解析到 native/codepuppy-fence/build/(相对 out/main)", () => {
    const h = harness({}, new Set(["/repo/packages/ui-mac/native/codepuppy-fence/build/codepuppy_fence.node"]))
    h.input.addon = { packaged: false, resourcesPath: "/unused", moduleDir: "/repo/packages/ui-mac/out/main", exists: (p) => p === "/repo/packages/ui-mac/native/codepuppy-fence/build/codepuppy_fence.node" }
    expect(planProcessFence(h.input, h.deps).addonPath).toBe("/repo/packages/ui-mac/native/codepuppy-fence/build/codepuppy_fence.node")
  })
})
