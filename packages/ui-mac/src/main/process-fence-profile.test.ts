// REQ-159 (`#1321`) —— 可写集单一权威的**形状**判据 + 并集裁剪规则 + 试编译封顶(纯逻辑,全平台跑)。
//
// 断言粒度纪律:profile 用**逐行全等**(不是「包含 deny」);并集用**顺序相等**(不是集合);
// 裁剪用一个「只在 ≤N 条时通过」的假编译器,断言丢的是尾部、丢到底仍失败要抛且带原因。
// XDG 解析对着引擎**真用的那份**取法逐输入交叉验证:OpenCode 2 的全局路径(@opencode/util/global)从
// `#global-roots` 取根,按 packages/util/package.json 的 imports 解析到 packages/util/src/global-roots.ts ——
// 基准是引擎的模块,不是本模块常量(非自指等价链)。v1 的 packages/core/src/global.ts 经 xdg-basedir 取根,随换代删了。

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { chmodSync, renameSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { readHomebrewInstallations, homebrewFenceLocations, resolveHomebrewExecutable } from "./homebrew-installation"
import { planProtectedLocations } from "./process-fence-plan"
import {
  COMPILE_BYTE_WALL,
  LOCAL_SIDECAR_SERVER_KEY,
  checkWorkspaceDirectory,
  configFenceLocations,
  MAX_WORKSPACES,
  WRITABLE_ROOT_IDS,
  assertEgressProxyPort,
  assertSeatbeltSafePath,
  processFenceRulesCover,
  processFenceWriteRules,
  renderProcessFenceProfile,
  resolvePackageManagerLocations,
  userConfigurationLocations,
  resolveEngineRoots,
  selectWorkspaceUnion,
  trimUntilCompiles,
  workspaceCandidatesFromStore,
  type ConfigFenceRule,
  type CredentialStoreRule,
  type ProcessFenceProfileInput,
  type ProcessFenceWriteRule,
  type WorkspaceUnionInput,
} from "./process-fence-profile"

const HOME = "/Users/alpha"
/** `#1390`:应用状态根 = 三个 env 根与 CAS 的父目录(codepuppy-environment.ts defaultCodePuppyBaseRoot)。 */
const STATE_ROOT = `${HOME}/Library/Application Support/codepuppy-state`
/** Virtual filesystem: inode identities are path names; real-disk arms below use actual stat. */
const noDisk = (p: string) => resolve(p)
const virtualStat = (p: string) => ({ dev: "fixture", ino: resolve(p) })
const roots = { home: HOME, dataHome: `${HOME}/.local/share`, cacheHome: `${HOME}/.cache`, configHome: `${HOME}/.config` }
const USER_DATA = `${HOME}/Library/Application Support/ai.opencode.desktop`
const GLOBAL = `${HOME}/Library/Application Support/codepuppy-state/env/prod`
/** SPEC-engine-config-fence:受保护配置集,由生产的位置清单给出(这里没有软链,真实路径 = 原路径;软链与真实路径的判据在 process-fence-plan.test.ts)。 */
const CF: ConfigFenceRule[] = configFenceLocations({ userDataPath: USER_DATA, appStateRoot: STATE_ROOT, codepuppyGlobalRoot: GLOBAL, engineConfigDirectory: `${HOME}/.config/opencode`, configHome: roots.configHome, home: HOME, dataHome: roots.dataHome })
/** DESIGN-stored-credentials-fence §4.5 的 C1 输入(已是真实路径;生产由 planCredentialStores 从 credentialStores() 算出)。 */
const OFFICIAL_RUNTIME = "/private/var/folders/xy/T/codepuppy-connectors-501-abcdef"
const C1: CredentialStoreRule[] = [
  { kind: "subpath", path: `${USER_DATA}/codepuppy-secrets` },
  { kind: "subpath", path: `${USER_DATA}/codepuppy-mcp-secrets` },
  { kind: "literal", path: `${USER_DATA}/codepuppy.env` },
  { kind: "literal", path: `${USER_DATA}/codepuppy-auth.json` },
  { kind: "literal", path: `${USER_DATA}/codepuppy-pkce.json` },
  { kind: "literal", path: `${USER_DATA}/codepuppy-byok-keys.json` },
  { kind: "subpath", path: `${USER_DATA}/Crashpad` },
  { kind: "subpath", path: OFFICIAL_RUNTIME },
]
const base: ProcessFenceProfileInput = {
  workspaces: [`${HOME}/code-puppy`, "/Users/alpha/app/alpha-code"],
  codepuppyGlobalRoot: GLOBAL,
  userDataPath: USER_DATA,
  stateHome: USER_DATA,
  roots,
  egressProxyPort: 4443,
  configFence: CF,
  homebrewFence: [], credentialStores: C1,
}

const locationInput = {
  platform: "darwin" as const,
  home: "/Users/puppy",
  userDataPath: "/Users/puppy/Library/Application Support/Code Puppy",
  configHome: "/Users/puppy/.config",
  appData: "/Users/puppy/Library/Application Support",
  localAppData: "/Users/puppy/Library/Caches",
  goInstallBin: null, xdgCacheHome: null, bunInstall: null,
}

describe("package manager locations", () => {
  test("Bun global locations follow the trusted user root before application XDG defaults", () => {
    for (const [xdgCacheHome, bunInstall, root] of [
      [null, null, `${locationInput.home}/.bun`],
      ["/user/cache", null, "/user/cache/.bun"],
      ["/user/cache", "/user/bun", "/user/bun"],
    ] as const) {
      const result = resolvePackageManagerLocations({ ...locationInput, xdgCacheHome, bunInstall })
      expect(result.writable.filter((entry) => entry.manager === "bun" && entry.purpose === "global-install").map((entry) => entry.rule)).toEqual([
        { kind: "subpath", value: `${root}/install/global` }, { kind: "subpath", value: `${root}/bin` },
      ])
      expect(result.env.BUN_INSTALL).toBe(bunInstall === null ? root : undefined)
      expect(result.env.BUN_INSTALL_CACHE_DIR).toBe(`${locationInput.userDataPath}/package-managers/bun/install-cache`)
    }
  })

  test("homebrew installation nodes stay protected while ordinary global bins remain writable", () => {
    const root = realpathSync(mkdtempSync(join(import.meta.dir, "../../node_modules/.cache/homebrew-identity-")))
    try {
      // Filesystem-only markers at the launcher/Library paths from frozen H1's real Homebrew layout.
      // Content is not parsed or executed; these are our probe files, not a replacement brew implementation.
      const prefix = join(root, "prefix")
      const repository = join(root, "repository")
      mkdirSync(join(prefix, "bin"), { recursive: true })
      mkdirSync(join(repository, "bin"), { recursive: true })
      mkdirSync(join(repository, "Library/Homebrew"), { recursive: true })
      writeFileSync(join(repository, "bin/brew"), "launcher marker")
      writeFileSync(join(repository, "Library/Homebrew/brew.sh"), "library marker")
      symlinkSync(join(repository, "bin/brew"), join(prefix, "bin/brew"))
      const installs = readHomebrewInstallations([prefix], [])
      expect(installs).toHaveLength(1)
      expect(installs[0]!.launcher.realPath).toBe(join(repository, "bin/brew"))
      expect(readHomebrewInstallations([prefix], [{ kind: "subpath", value: root }])).toEqual([])
      chmodSync(join(repository, "bin/brew"), 0o755)
      const selected = (program = "brew", path = `${prefix}/bin:/usr/bin:/bin`) => resolveHomebrewExecutable({ program, cwd: root, env: { PATH: path }, installations: installs })?.executable
      expect(selected()).toBe(join(repository, "bin/brew"))
      expect(selected(join(prefix, "bin/brew"))).toBe(join(repository, "bin/brew"))
      const shadow = join(root, "shadow")
      mkdirSync(shadow); writeFileSync(join(shadow, "brew"), "shadow", { mode: 0o755 })
      expect(selected("brew", `${shadow}:${prefix}/bin`)).toBeUndefined()
      renameSync(join(repository, "bin/brew"), join(repository, "bin/brew-old"))
      writeFileSync(join(repository, "bin/brew"), "updated launcher", { mode: 0o755 })
      expect(selected()).toBe(join(repository, "bin/brew"))
      const deny = planProtectedLocations(homebrewFenceLocations(installs), undefined, { realpath: realpathSync.native }).configFence
      const profile = renderProcessFenceProfile({ ...base, workspaces: [], homebrewFence: deny.filter((rule) => rule.kind !== "dat-files"), userWritableLocations: [{ kind: "subpath", value: join(prefix, "bin") }, { kind: "subpath", value: join(repository, "Library") }] })
      const rules = processFenceWriteRules(profile)
      expect(processFenceRulesCover(rules, join(prefix, "bin/npm-probe"), "file")).toBe(true)
      if (process.platform === "darwin") {
        const result = spawnSync("/usr/bin/sandbox-exec", ["-p", profile, "/usr/bin/python3", "-c", `import json, pathlib\nresult=[]\nfor p in ${JSON.stringify([join(repository, "bin/brew"), join(repository, "Library/Homebrew/brew.sh"), join(prefix, "bin/npm-probe")])}:\n try: pathlib.Path(p).write_text('probe'); result.append(True)\n except PermissionError: result.append(False)\nprint(json.dumps(result))`], { encoding: "utf8" })
        expect(result.status, result.stderr).toBe(0)
        expect(JSON.parse(result.stdout)).toEqual([false, false, true])
      }
      for (const path of [join(repository, "bin/brew"), join(repository, "Library/Homebrew/brew.sh"), repository]) expect(processFenceRulesCover(rules, path, "file"), path).toBe(false)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  test("fixed cache environment is separate from the real global install roots", () => {
    const cache = `${locationInput.userDataPath}/package-managers`
    const result = resolvePackageManagerLocations(locationInput)
    expect(result.env).toEqual({
      BUN_INSTALL: `${locationInput.home}/.bun`,
      BUN_INSTALL_CACHE_DIR: `${cache}/bun/install-cache`,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: `${cache}/bun/transpiler-cache`,
      pnpm_config_store_dir: `${cache}/pnpm/store`, npm_config_store_dir: `${cache}/pnpm/store`,
      pnpm_config_cache_dir: `${cache}/pnpm/cache`, npm_config_cache_dir: `${cache}/pnpm/cache`,
      pnpm_config_state_dir: `${cache}/pnpm/state`, npm_config_state_dir: `${cache}/pnpm/state`,
      PNPM_HOME: "/Users/puppy/Library/pnpm",
      YARN_CACHE_FOLDER: `${cache}/yarn/cache`, YARN_GLOBAL_FOLDER: `${cache}/yarn/berry`,
      npm_config_cache: `${cache}/npm/cache`, PIP_CACHE_DIR: `${cache}/pip/cache`,
      UV_CACHE_DIR: `${cache}/uv/cache`, UV_PYTHON_INSTALL_DIR: `${cache}/uv/python`,
      GOMODCACHE: `${cache}/go/mod`, GOCACHE: `${cache}/go/build`,
      CARGO_INSTALL_ROOT: "/Users/puppy/.cargo",
    })
    expect([...new Set(result.writable.filter((entry) => entry.purpose === "cache").map((entry) => entry.manager))].sort()).toEqual(["bun", "cargo", "go", "npm", "pip", "pnpm", "uv", "yarn"])
    expect(result.writable.filter((entry) => entry.purpose === "cache" && entry.manager !== "cargo").every((entry) => entry.rule.kind === "subpath" && entry.rule.value.startsWith(`${cache}/`))).toBe(true)
    expect(result.writable.filter((entry) => entry.manager === "cargo" && entry.purpose === "cache").map((entry) => entry.rule)).toEqual([
      ...["registry", "git"].map((name) => ({ kind: "subpath", value: `/Users/puppy/.cargo/${name}` })),
      ...[".package-cache", ".package-cache-mutate", ".global-cache", ".global-cache-journal"].map((name) => ({ kind: "literal", value: `/Users/puppy/.cargo/${name}` })),
    ])
    expect(result.env.CARGO_HOME).toBeUndefined()
    expect(result.writable.some((entry) => entry.purpose === "global-install" && entry.rule.value.startsWith(cache))).toBe(false)
  })

  test("Go cache GOPATH keeps the original queried install target and null stays unresolved", () => {
    const target = "/Users/puppy/custom-go/bin"
    const result = resolvePackageManagerLocations({ ...locationInput, goInstallBin: target })
    expect(result.env.GOPATH).toBe(`${locationInput.userDataPath}/package-managers/go/gopath`)
    expect(result.env.GOBIN).toBe(target)
    expect(result.writable).toContainEqual({ manager: "go", purpose: "cache", rule: { kind: "subpath", value: result.env.GOPATH! } })
    expect(result.writable.some((entry) => entry.purpose === "cache" && entry.rule.value === target)).toBe(false)
    const absent = resolvePackageManagerLocations(locationInput)
    expect(absent.env.GOPATH).toBeUndefined()
    expect(absent.env.GOBIN).toBeUndefined()
    expect(() => resolvePackageManagerLocations({ ...locationInput, goInstallBin: "relative" })).toThrow("absolute")
  })
  test("global subtrees and exact metadata do not grant the surrounding tool roots", () => {
    const result = resolvePackageManagerLocations(locationInput)
    for (const [manager, value] of [
      ["bun", "/Users/puppy/.bun/install/global"], ["bun", "/Users/puppy/.bun/bin"],
      ["pnpm", "/Users/puppy/Library/pnpm/global"], ["pnpm", "/Users/puppy/Library/pnpm/bin"], ["pnpm", "/Users/puppy/Library/pnpm/.tools"],
      ["yarn", "/Users/puppy/.config/yarn/global"], ["yarn", "/Users/puppy/.yarn/bin"],
      ["npm", "/opt/homebrew/lib/node_modules"], ["npm", "/usr/local/bin"], ["npm", "/Users/puppy/.npm-global/lib/node_modules"],
      ["pip", "/Users/puppy/Library/Python"], ["pip", "/Users/puppy/.local/bin"],
      ["uv", "/Users/puppy/.local/share/uv/tools"], ["uv", "/Users/puppy/.local/bin"],
      ["go", "/Users/puppy/go/bin"], ["cargo", "/Users/puppy/.cargo/bin"],
    ]) expect(result.writable).toContainEqual({ manager, purpose: "global-install", rule: { kind: "subpath", value } })
    for (const name of [".crates.toml", ".crates2.json"])
      expect(result.writable).toContainEqual({ manager: "cargo", purpose: "global-install", rule: { kind: "literal", value: `/Users/puppy/.cargo/${name}` } })
    for (const value of ["/Users/puppy", "/opt/homebrew", "/usr/local", "/Users/puppy/.local", "/Users/puppy/.cargo", "/Users/puppy/go", "/Users/puppy/Library/pnpm", "/Users/puppy/.rustup"])
      expect(result.writable.some((entry) => entry.rule.value === value), value).toBe(false)
  })

  test("pnpm root shims match one node, while stores remain outside the install rules", () => {
    const rules = resolvePackageManagerLocations(locationInput).writable.filter((entry) => entry.manager === "pnpm" && entry.rule.kind === "regex")
    expect(rules).toHaveLength(1)
    const pattern = new RegExp(rules[0]!.rule.value)
    expect(pattern.test("/Users/puppy/Library/pnpm/semver")).toBe(true)
    for (const path of ["/Users/puppy/Library/pnpm", "/Users/puppy/Library/pnpm/store/cache", "/Users/puppy/Library/pnpm-other/semver"])
      expect(pattern.test(path), path).toBe(false)
  })

  test("npm and Classic Yarn share version-manager templates without opening their roots", () => {
    const result = resolvePackageManagerLocations(locationInput)
    for (const manager of ["npm", "yarn"]) {
      const patterns = result.writable.filter((entry) => entry.manager === manager && entry.rule.kind === "regex").map((entry) => new RegExp(entry.rule.value))
      for (const root of [
        "/Users/puppy/.nvm/versions/node/v23.1.0", "/Users/puppy/.config/nvm/versions/node/v99.0.0",
        "/Users/puppy/Library/Application Support/fnm/node-versions/v23.1.0/installation",
        "/Users/puppy/.local/share/fnm/node-versions/v99.0.0/installation", "/Users/puppy/.fnm/node-versions/v23.1.0/installation",
        "/Users/puppy/.volta/tools/image/node/23.1.0", "/Users/puppy/.asdf/installs/nodejs/23.1.0",
        "/Users/puppy/.local/share/mise/installs/node/23.1.0",
      ]) {
        for (const suffix of ["bin/example", "lib/node_modules/example/index.js"])
          expect(patterns.some((pattern) => pattern.test(`${root}/${suffix}`)), `${manager}: ${root}/${suffix}`).toBe(true)
        for (const suffix of ["", "/etc/config", "/lib/node_modules-other/package"])
          expect(patterns.some((pattern) => pattern.test(`${root}${suffix}`)), `${manager}: ${root}${suffix}`).toBe(false)
      }
      for (const path of ["tools/image/packages", "tools/user/packages", "tools/user/bins", "tools/shared", "bin", "tmp", "log"])
        expect(result.writable).toContainEqual({ manager, purpose: "global-install", rule: { kind: "subpath", value: `/Users/puppy/.volta/${path}` }, onlyIfExisting: true })
    }
  })

  test("Linux locations and regex roots use the supplied paths literally", () => {
    const input = { ...locationInput, platform: "linux" as const, home: "/home/a.b+[c]", configHome: "/settings/a.b+[c]" }
    const result = resolvePackageManagerLocations(input)
    expect(result.env.PNPM_HOME).toBe("/home/a.b+[c]/.local/share/pnpm")
    const patterns = result.writable.filter((entry) => entry.rule.kind === "regex").map((entry) => new RegExp(entry.rule.value))
    expect(patterns.some((pattern) => pattern.test("/home/a.b+[c]/.nvm/versions/node/v1/bin/tool"))).toBe(true)
    expect(patterns.some((pattern) => pattern.test("/home/axbcccc/.nvm/versions/node/v1/bin/tool"))).toBe(false)
    expect(patterns.some((pattern) => pattern.test("/home/a.b+[c]/.local/lib/python3.14/site-packages/a.py"))).toBe(true)
    expect(patterns.some((pattern) => pattern.test("/home/a.b+[c]/.local/lib/other/a.py"))).toBe(false)
  })

  test("relative location inputs are rejected before producing any candidates", () => {
    for (const key of ["home", "userDataPath", "configHome", "appData", "localAppData"])
      expect(() => resolvePackageManagerLocations({ ...locationInput, [key]: "relative" }), key).toThrow("absolute")
  })
})

describe("user configuration locations", () => {
  test("ordinary files and Git locks are literal; only fish startup scripts have a directory rule", () => {
    const result = userConfigurationLocations(locationInput)
    for (const name of [".gitconfig", ".gitconfig.lock", ".zshenv", ".zprofile", ".zshrc", ".zlogin", ".zlogout", ".bashrc", ".bash_profile", ".bash_login", ".bash_logout", ".profile", ".npmrc", ".yarnrc", ".yarnrc.yml", ".bunfig.toml", ".cargo/config", ".cargo/config.toml", ".pip/pip.conf"])
      expect(result).toContainEqual({ kind: "literal", path: `/Users/puppy/${name}` })
    for (const name of ["git/config", "git/config.lock", "fish/config.fish", "pip/pip.conf", "uv/uv.toml"])
      expect(result).toContainEqual({ kind: "literal", path: `/Users/puppy/.config/${name}` })
    expect(result).toContainEqual({ kind: "literal", path: "/Users/puppy/Library/Application Support/pip/pip.conf" })
    expect(result).toContainEqual({ kind: "literal", path: "/Users/puppy/Library/Application Support/go/env" })
    expect(result.filter((rule) => rule.kind !== "literal")).toEqual([{ kind: "subpath", path: "/Users/puppy/.config/fish/conf.d" }])
    expect(result.every((rule) => rule.kind !== "dat-files")).toBe(true)
    expect(result.some((rule) => rule.kind !== "dat-files" && /opencode|codepuppy|zsh_sessions|zcompdump/.test(rule.path))).toBe(false)
  })

  test("Linux uses configHome for Go, and validates the same absolute input contract", () => {
    const result = userConfigurationLocations({ ...locationInput, platform: "linux" })
    expect(result).toContainEqual({ kind: "literal", path: "/Users/puppy/.config/go/env" })
    expect(result.some((rule) => rule.kind !== "dat-files" && rule.path.includes("Library"))).toBe(false)
    expect(() => userConfigurationLocations({ ...locationInput, configHome: "relative" })).toThrow("absolute")
  })
})
/** 一个受保护位置都没有的形状:只判别的行时用(空清单两块都不渲染)。 */
const noFence = () => [] as string[]

/** 上级目录节点(按首次出现,从父目录到 `/` 之前);末尾三个是 CF-11(工具策略目录,片 ③)带进来的。 */
const ANCESTORS = [`${HOME}/Library/Application Support`, `${HOME}/Library`, HOME, "/Users", `${STATE_ROOT}/env`, STATE_ROOT, USER_DATA, `${HOME}/.config`, `${HOME}/.local/share/opencode`, `${HOME}/.local/share`, `${HOME}/.local`]
/** 受保护集两块的逐行期望(独立字面量 —— 不从渲染器取):规则按清单顺序,上级目录按首次出现、从父目录到 `/` 之前。 */
const CF_LINES = [
  "(deny file-write*",
  `(subpath "${STATE_ROOT}")`,
  `(subpath "${GLOBAL}")`,
  `(subpath "${USER_DATA}/codepuppy-engine-config")`,
  `(literal "${USER_DATA}/codepuppy-shell-env.json")`,
  `(literal "${USER_DATA}/codepuppy.env")`,
  `(literal "${USER_DATA}/codepuppy-endpoints.json")`,
  `(literal "${USER_DATA}/codepuppy-discovered-endpoints.json")`,
  `(subpath "${USER_DATA}/codepuppy-connections")`,
  `(literal "${USER_DATA}/opencode.settings")`,
  `(literal "${USER_DATA}/opencode.updater")`,
  `(regex #"^/Users/alpha/Library/Application Support/ai\\.opencode\\.desktop/[^/]+\\.[dD][aA][tT]$")`,
  `(subpath "${HOME}/.config/opencode")`,
  `(subpath "${HOME}/.opencode")`,
  `(literal "${HOME}/opencode.json")`,
  `(literal "${HOME}/opencode.jsonc")`,
  `(subpath "${HOME}/.local/share/opencode/codepuppy-tool-policy"))`,
  `(deny file-write* ${ANCESTORS.map((p) => `(literal "${p}")`).join(" ")})`,
]
/** C1 两块的逐行期望(独立字面量):拒读拒写的存放点按清单顺序;上级目录按首次出现、从父目录到 `/` 之前。 */
const C1_ANCESTORS = [`${HOME}/Library/Application Support/ai.opencode.desktop`, `${HOME}/Library/Application Support`, `${HOME}/Library`, HOME, "/Users", "/private/var/folders/xy/T", "/private/var/folders/xy", "/private/var/folders", "/private/var", "/private"]
const C1_LINES = [
  "(deny file-read* file-write*",
  ...C1.map((rule, i) => `(${rule.kind} "${rule.path}")${i === C1.length - 1 ? ")" : ""}`),
  `(deny file-write* ${C1_ANCESTORS.map((p) => `(literal "${p}")`).join(" ")})`,
]
const C1_RULES: ProcessFenceWriteRule[] = [...C1.map((rule) => ({ kind: rule.kind, value: rule.path })), ...C1_ANCESTORS.map((value) => ({ kind: "literal" as const, value }))]
/** 同一份期望,写成解析器的 deny 规则(E9 往返)。 */
const CF_DENY: ProcessFenceWriteRule[] = [
  ...CF_LINES.slice(1, -1).map((line) => {
    const m = /^\((subpath|literal) "([^"]*)"\)\)?$|^\(regex #"([^"]*)"\)\)?$/.exec(line)!
    return m[3] !== undefined ? { kind: "regex" as const, value: m[3] } : { kind: m[1] as "subpath" | "literal", value: m[2]! }
  }),
  ...ANCESTORS.map((value) => ({ kind: "literal" as const, value })),
]

/** `#1334` Q1.2 的四行(逐字,独立字面量 —— 不从渲染器取);端口是唯一的参数。 */
const NETWORK_LINES = (port: number) => [
  "(deny network*)",
  '(allow network-bind (local ip "localhost:*"))',
  '(allow network-inbound (local ip "localhost:*"))',
  `(allow network-outbound (remote ip "localhost:${port}"))`,
]

/** 去掉每行的 `; Wn` 注释与多余空白,只比策略 token —— 注释在编译期被剥离(勘破 §6.5 第 9 行)。 */
const tokens = (profile: string) =>
  profile
    .split("\n")
    .map((l) => l.replace(/\s*;.*$/, "").trim())
    .filter(Boolean)

describe("renderProcessFenceProfile —— 勘破 §8.2 的行(W10/W19 已删,D15),逐行全等", () => {
  test("两个工作区 + 生产根:输出 = §8.2 形状(参数已代入),无多无少", () => {
    expect(tokens(renderProcessFenceProfile(base))).toEqual([
      "(version 1)",
      "(allow default)",
      "(deny file-write*)",
      "(allow file-write*",
      `(subpath "${HOME}/code-puppy")`,
      `(subpath "/Users/alpha/app/alpha-code")`,
      `(subpath "${HOME}/Library/Application Support/ai.opencode.desktop")`,
      `(subpath "${HOME}/.local/share/opencode")`,
      `(subpath "${HOME}/.cache/opencode")`,
      `(regex #"^/Users/alpha/\\.zsh_history")`,
      `(subpath "/private/tmp")`,
      `(subpath "/private/var/folders")`,
      `(literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr")`,
      `(literal "/dev/tty") (regex #"^/dev/fd/")`,
      `(literal "/dev/ptmx") (regex #"^/dev/ttys")`,
      ")",
      '(allow file-write* (extension "app.codepuppy.workspace-write"))',
      '(deny file-issue-extension generic-issue-extension mach-issue-extension iokit-issue-extension ipc-posix-issue-extension (extension-class "app.codepuppy.workspace-write"))',
      ...NETWORK_LINES(4443),
      ...CF_LINES,
      ...C1_LINES,
    ])
  })

  test("SPEC-engine-config-fence BR-01:受保护集两块在 N4 之后(也就在 X1 之后),之后再没有任何文件写的放行;空清单两块都不渲染;路径里的引号 / 相对路径拒绝渲染", () => {
    const lines = tokens(renderProcessFenceProfile(base))
    const x1 = lines.findIndex((l) => l.includes('(extension "app.codepuppy.workspace-write")'))
    const n4 = lines.findIndex((l) => l.startsWith("(allow network-outbound"))
    const cf = lines.indexOf("(deny file-write*", n4)
    expect(x1).toBeGreaterThan(-1)
    expect(cf).toBe(n4 + 1)
    expect(lines.slice(cf)).toEqual([...CF_LINES, ...C1_LINES]) // C1 是全文最后的文件规则(stored-credentials-fence §4.5)
    expect(lines.slice(cf).some((l) => l.startsWith("(allow"))).toBe(false)
    expect(tokens(renderProcessFenceProfile({ ...base, configFence: [], homebrewFence: [], credentialStores: [] })).at(-1)).toBe(NETWORK_LINES(4443).at(-1))
    // C1 单独在场(受保护集为空)时也紧接在网络行之后;C1 为空 ⇒ 两块都不渲染
    expect(tokens(renderProcessFenceProfile({ ...base, configFence: [] })).slice(-C1_LINES.length)).toEqual(C1_LINES)
    expect(tokens(renderProcessFenceProfile({ ...base, homebrewFence: [], credentialStores: [] })).slice(-CF_LINES.length)).toEqual(CF_LINES)
    expect(() => renderProcessFenceProfile({ ...base, configFence: [{ kind: "literal", path: '/Users/alpha/"x' }] })).toThrow(/configFence\[0\]/)
    expect(() => renderProcessFenceProfile({ ...base, configFence: [{ kind: "dat-files", dir: "relative" }] })).toThrow(/configFence\[0\]/)
  })

  test("修订 2 B:规则带配置路径上的节点(via)⇒ 上级目录块在它自己的真实路径节点之后再列这些节点,去重;往返原样读回;节点里的引号拒绝渲染", () => {
    const configFence = [
      { kind: "subpath" as const, path: "/r/cfg/opencode", via: ["/w/proj/link", "/w/proj"] },
      { kind: "literal" as const, path: "/w/other/x", via: ["/w/proj"] },
    ]
    const profile = renderProcessFenceProfile({ ...base, configFence, homebrewFence: [], credentialStores: [] })
    const ancestors = profile.split("\n").find((line) => line.includes("; CF 上级目录节点"))!
    expect(ancestors).toBe('(deny file-write* (literal "/r/cfg") (literal "/r") (literal "/w/proj/link") (literal "/w/proj") (literal "/w/other") (literal "/w"))      ; CF 上级目录节点')
    expect(processFenceWriteRules(profile).deny).toEqual([
      { kind: "subpath", value: "/r/cfg/opencode" },
      { kind: "literal", value: "/w/other/x" },
      ...["/r/cfg", "/r", "/w/proj/link", "/w/proj", "/w/other", "/w"].map((value) => ({ kind: "literal" as const, value })),
    ])
    expect(() => renderProcessFenceProfile({ ...base, configFence: [{ kind: "subpath", path: "/r/x", via: ['/w/"x'] }] })).toThrow(/configFence\[0\]/)
  })

  test("位置清单:CF-1–11(名字取 USER_DATA_LAYOUT 与 store 常量);两个引擎配置目录相同只列一份,用户导出 OPENCODE_CONFIG_DIR 时两份都列;整个 ~/.opencode 是 CF-9(subpath,排在 CF-8 之后、CF-10 之前,片 ④);工具策略目录 <XDG_DATA_HOME>/opencode/codepuppy-tool-policy 是 CF-11,排在最后(片 ③)", () => {
    const list = (engineConfigDirectory: string, dataHome = roots.dataHome) =>
      configFenceLocations({ userDataPath: USER_DATA, appStateRoot: STATE_ROOT, codepuppyGlobalRoot: GLOBAL, engineConfigDirectory, configHome: roots.configHome, home: HOME, dataHome })
    expect(list(`${HOME}/.config/opencode`).filter((rule) => rule.kind === "subpath" && rule.path.endsWith("/opencode"))).toEqual([{ kind: "subpath", path: `${HOME}/.config/opencode` }])
    expect(list("/Volumes/cfg/opencode").filter((rule) => rule.kind === "subpath" && rule.path.endsWith("/opencode"))).toEqual([
      { kind: "subpath", path: "/Volumes/cfg/opencode" },
      { kind: "subpath", path: `${HOME}/.config/opencode` },
    ])
    const paths = list(`${HOME}/.config/opencode`).map((rule) => (rule.kind === "dat-files" ? rule.dir : rule.path))
    expect(list(`${HOME}/.config/opencode`)).toContainEqual({ kind: "subpath", path: `${HOME}/.opencode`, neverCreate: true })
    // only CF-9 carries the marker (the pre-create skip is bound to that entry, not to a path string)
    expect(list(`${HOME}/.opencode`).filter((rule) => "neverCreate" in rule)).toEqual([{ kind: "subpath", path: `${HOME}/.opencode`, neverCreate: true }])
    expect(paths.indexOf(`${HOME}/.opencode`)).toBe(paths.indexOf(`${HOME}/.config/opencode`) + 1)
    expect(paths.indexOf(`${HOME}/opencode.json`)).toBe(paths.indexOf(`${HOME}/.opencode`) + 1)
    // CF-11 (片 ③):the tool policy directory under the engine data directory, last; it follows an exported XDG_DATA_HOME
    expect(list(`${HOME}/.config/opencode`).at(-1)).toEqual({ kind: "subpath", path: `${HOME}/.local/share/opencode/codepuppy-tool-policy` })
    expect(paths.indexOf(`${HOME}/.local/share/opencode/codepuppy-tool-policy`)).toBe(paths.indexOf(`${HOME}/opencode.jsonc`) + 1)
    expect(list(`${HOME}/.config/opencode`, "/Volumes/d").at(-1)).toEqual({ kind: "subpath", path: "/Volumes/d/opencode/codepuppy-tool-policy" })
  })

  test("`#1337` 网络行:Q1.2 四行逐字、顺序不变、deny 在前 allow 在后、N4 的端口就是传入的代理端口;只写加法(没有第二条 deny)", () => {
    // 受保护集两块渲染在 N4 之后(SPEC-engine-config-fence);网络行本身的形状在没有受保护集的形状上判,有受保护集时它们紧贴在两块之前
    expect(tokens(renderProcessFenceProfile({ ...base, egressProxyPort: 61234 })).slice(-(CF_LINES.length + C1_LINES.length + 4), -(CF_LINES.length + C1_LINES.length))).toEqual(NETWORK_LINES(61234))
    const out = tokens(renderProcessFenceProfile({ ...base, egressProxyPort: 61234, configFence: [], homebrewFence: [], credentialStores: [] }))
    expect(out.slice(-4)).toEqual(NETWORK_LINES(61234))
    expect(out.filter((l) => l.startsWith("(deny "))).toEqual([
      "(deny file-write*)",
      '(deny file-issue-extension generic-issue-extension mach-issue-extension iokit-issue-extension ipc-posix-issue-extension (extension-class "app.codepuppy.workspace-write"))',
      "(deny network*)",
    ])
    expect(out.filter((l) => /network-outbound/.test(l))).toEqual([`(allow network-outbound (remote ip "localhost:61234"))`])
    // DNS 刻意不放行:没有 mDNSResponder 那一行(`#1334` Q3:解析搬到代理那一侧)
    expect(renderProcessFenceProfile(base)).not.toContain("mDNSResponder")
  })

  test("`#1337` fail-closed:代理端口不是 1..65535 的整数 ⇒ 拒绝渲染(没有那扇门就没有 profile)", () => {
    for (const bad of [0, 65536, -1, 1.5, Number.NaN, "4443", undefined, null]) {
      expect(() => assertEgressProxyPort(bad), String(bad)).toThrow(/egress proxy port must be an integer in 1\.\.65535/)
      expect(() => renderProcessFenceProfile({ ...base, egressProxyPort: bad as number }), String(bad)).toThrow(/egress proxy port/)
    }
    expect(assertEgressProxyPort(1)).toBe(1)
    expect(assertEgressProxyPort(65535)).toBe(65535)
  })

  test("每一行都带 §8.2 的 id 注释,且 id 集合 = WRITABLE_ROOT_IDS 的键(登记簿只能点名存在的行)", () => {
    const ids = new Set(
      renderProcessFenceProfile({ ...base, userWritableLocations: [{ kind: "literal", value: `${HOME}/.gitconfig` }], packageManagerCaches: [{ kind: "literal", value: `${HOME}/.cargo/.package-cache` }] })
        .split("\n")
        // X2 is a deny rule, not a writable root.
        .map((l) => /;\s*(W\d+|X1)\b/.exec(l)?.[1])
        .filter((x): x is string => !!x),
    )
    expect([...ids].sort()).toEqual(Object.keys(WRITABLE_ROOT_IDS).sort())
    expect(Object.keys(WRITABLE_ROOT_IDS).sort()).toEqual(["W1", "W11", "W12", "W13", "W14", "W15", "W20", "W21", "W3", "W4", "W5", "W8", "X1"])
  })

  test("XDG 根跟着 env 走:用户导出 XDG_DATA_HOME 时 W4 指向它,不再是 ~/.local/share", () => {
    const custom = resolveEngineRoots({ XDG_DATA_HOME: "/Volumes/data/xdg" }, HOME)
    const out = tokens(renderProcessFenceProfile({ ...base, roots: custom }))
    expect(out).toContain(`(subpath "/Volumes/data/xdg/opencode")`)
    expect(out).not.toContain(`(subpath "${HOME}/.local/share/opencode")`)
  })

  test("state 根:等于 userDataPath 时不出第二行;用户导出 XDG_STATE_HOME 时多一行 W3", () => {
    // the allow rows only: the protected ancestors line (片 ③ adds <XDG_DATA_HOME>/opencode next to the state root) is not a W3 row
    expect(tokens(renderProcessFenceProfile(base)).filter((l) => l.startsWith("(subpath ") && l.includes("/opencode\")") && l.includes("state"))).toEqual([])
    const out = tokens(renderProcessFenceProfile({ ...base, stateHome: "/Volumes/data/state" }))
    expect(out).toContain(`(subpath "/Volumes/data/state/opencode")`)
  })

  test("HOME 里的正则元字符在 regex 行被转义(/Users/j.doe 的 `.` 不是「任意字符」)", () => {
    const out = renderProcessFenceProfile({ ...base, roots: { ...roots, home: "/Users/j.doe" } })
    expect(out).toContain(`(regex #"^/Users/j\\.doe/\\.zsh_history")`)
  })

  test("fail-closed:含引号 / 反斜杠 / 控制字符 / 相对路径的根一律拒绝渲染", () => {
    expect(() => assertSeatbeltSafePath('/Users/a"b', "x")).toThrow(/cannot carry/)
    expect(() => assertSeatbeltSafePath("/Users/a\\b", "x")).toThrow(/cannot carry/)
    expect(() => assertSeatbeltSafePath("/Users/a\nb", "x")).toThrow(/cannot carry/)
    expect(() => assertSeatbeltSafePath("relative/x", "x")).toThrow(/must be absolute/)
    expect(() => renderProcessFenceProfile({ ...base, workspaces: ['/ws/"evil'] })).toThrow(/workspace\[0\]/)
    // 控制组:正常路径(含空格)通过
    expect(assertSeatbeltSafePath("/Users/a b/c", "x")).toBe("/Users/a b/c")
  })
})

describe("签发判定的唯一来源:本代 apply 的 profile 解析回写规则,判据偏向判「覆盖」", () => {
  const ALLOW: ProcessFenceWriteRule[] = [
    { kind: "subpath", value: "/Users/alpha/code-puppy" },
    { kind: "subpath", value: "/Users/alpha/app/alpha-code" },
    { kind: "subpath", value: "/Users/alpha/Library/Application Support/ai.opencode.desktop" },
    { kind: "subpath", value: "/Users/alpha/.local/share/opencode" },
    { kind: "subpath", value: "/Users/alpha/.cache/opencode" },
    { kind: "regex", value: "^/Users/alpha/\\.zsh_history" },
    { kind: "subpath", value: "/private/tmp" },
    { kind: "subpath", value: "/private/var/folders" },
    { kind: "literal", value: "/dev/null" },
    { kind: "literal", value: "/dev/stdout" },
    { kind: "literal", value: "/dev/stderr" },
    { kind: "literal", value: "/dev/tty" },
    { kind: "regex", value: "^/dev/fd/" },
    { kind: "literal", value: "/dev/ptmx" },
    { kind: "regex", value: "^/dev/ttys" },
  ]

  test("E9 往返:生产渲染(含受保护集)→ 解析 ⇒ allow 逐条还原写块(W13 一行三条、W14/W15 literal + regex),deny 与渲染输入(规则 + 上级目录)逐条相等;X1 扩展行不算规则", () => {
    expect(processFenceWriteRules(renderProcessFenceProfile(base))).toEqual({ allow: ALLOW, deny: [...CF_DENY, ...C1_RULES] })
    expect(processFenceWriteRules(renderProcessFenceProfile({ ...base, homebrewFence: [], credentialStores: [] }))).toEqual({ allow: ALLOW, deny: CF_DENY })
    expect(processFenceWriteRules(renderProcessFenceProfile({ ...base, configFence: [], homebrewFence: [], credentialStores: [] }))).toEqual({ allow: ALLOW, deny: [] })
    expect(processFenceWriteRules("(version 1)(allow default)(deny file-write*)")).toEqual({ allow: [], deny: [] })
  })

  // DESIGN-stored-credentials-fence §4.5 / D11:C1 两块由唯一渲染点写在受保护集之后,表头 `(deny file-read* file-write*` 与 `(deny file-write*`;
  // 运行期放行的解析器认得这两种形状,deny 逐条等于两份输入(受保护集,再 C1)按出现顺序拼起来 —— C1 在场时新打开的项目照样签得出放行。
  test("E9 / D11 往返(受保护集 + C1,真渲染):deny 逐条等于两份输入按出现顺序拼起来;C1 的路径带引号即拒渲染", () => {
    expect(processFenceWriteRules(renderProcessFenceProfile(base))).toEqual({ allow: ALLOW, deny: [...CF_DENY, ...C1_RULES] })
    expect(() => renderProcessFenceProfile({ ...base, homebrewFence: [], credentialStores: [{ kind: "literal", path: '/x/"y' }] })).toThrow(/credentialStores\[0\]/)
  })

  test("文法只认渲染点写出的形状:其余任何含 file-write 的表头、条目或行都抛(调用方按「本代不签发」处理)", () => {
    const profile = renderProcessFenceProfile(base)
    const head = profile.slice(0, profile.indexOf("(deny network*)"))
    for (const bad of [
      '(version 1)\n(allow file-write* (subpath "/Users/alpha"))\n',
      '(version 1)\n(allow file-write*\n  (prefix "/Users/alpha") ; W1\n)\n',
      '(version 1)\n(allow file-write*\n  (subpath "/x") (require-not (vnode-type SYMLINK)) ; W1\n)\n',
      '(version 1)\n(allow file-write*\n  (subpath "/x") ; W1\n',
      // 拒写块的条目只有三种;多一个过滤器、一种别的写法、块内注释、空块、未收尾,都抛
      `${profile}(deny file-write* (subpath "/x") (require-not (vnode-type SYMLINK)))\n`,
      `${profile}(deny file-write* (prefix "/x"))\n`,
      `${profile}(deny file-write*\n  (subpath "/x") ; why\n  (literal "/y"))\n`,
      `${profile}(deny file-write*\n)\n`,
      `${profile}(deny file-write*)\n`,
      `${profile}(deny file-write*\n  (subpath "/x")\n`,
      `${profile}(deny file-write* (subpath "/x")) (allow default)\n`,
      // 别的表头:只写 data、写在别的位置、读写顺序反过来
      `${profile}(deny file-write-data (subpath "/x"))\n`,
      `${profile}  (deny file-write* (subpath "/x"))\n`,
      `${profile}(deny file-write* file-read* (subpath "/x"))\n`,
      // 拒写块之后再出现任何文件写的放行(含 X1 行):它会盖过受保护集,覆盖判定就不再成立
      `${profile}(allow file-write* (extension "app.codepuppy.workspace-write"))\n`,
      `${profile}(allow file-write*\n  (subpath "/x") ; W1\n)\n`,
      `${head}${profile.slice(profile.indexOf("(deny file-write*\n", profile.indexOf("(allow network-outbound")))}(allow file-write* (extension "app.codepuppy.workspace-write"))\n`,
      // 通配操作 `file*` 含写(审查 B 第 3 条):渲染点从不写它,写在 profile 任何位置都抛 —— 拒写块之后、放行块之前、与读操作并列
      `${profile}(allow file* (subpath "/x"))\n`,
      `${profile}(deny file* (subpath "/x"))\n`,
      `${profile}(allow file-read* file* (subpath "/x"))\n`,
      `(version 1)\n(allow file* (subpath "/x"))\n${profile.slice("(version 1)\n".length)}`,
      `${head}(allow file*\n  (subpath "/x")\n)\n${profile.slice(head.length)}`,
    ]) expect(() => processFenceWriteRules(bad), bad.slice(-160)).toThrow()
    // 读规则不受影响:读不改写集,渲染点今天不写读规则;兄弟设计 C1 的读写表头照收(上一个用例),单独的读规则照旧忽略
    expect(processFenceWriteRules(`${profile}(allow file-read* (subpath "/x"))\n(deny file-read-data (literal "/y"))\n`)).toEqual(processFenceWriteRules(profile))
  })

  test("覆盖判定:在 allow 下、且不在任何 deny 下才算覆盖;subpath / regex deny 盖住目录或其祖先,literal deny 只在等于目录时算;大小写折叠", () => {
    const rules = processFenceWriteRules(renderProcessFenceProfile(base))
    // Inside an allow root (any depth, any letter case) or under a regex row ⇒ covered; a sibling sharing a prefix ⇒ not.
    for (const covered of ["/Users/alpha/code-puppy", "/Users/alpha/code-puppy/deep/x", "/USERS/ALPHA/CODE-PUPPY/x", "/private/tmp/p", "/Users/alpha/.zsh_history-dir/p", `${USER_DATA}/uv-cache`])
      expect(processFenceRulesCover(rules, covered), covered).toBe(true)
    for (const outside of ["/Users/alpha/code-puppy2", "/Users/alpha/proj", "/Users/alpha", "/tmp/p", "/Users/alpha/Library/Application Support"])
      expect(processFenceRulesCover(rules, outside), outside).toBe(false)
    // 受保护位置与其内(W3 罩着 userData,受保护集把其中几处拿回来);userData 本身被 literal 冻结 ⇒ 不算覆盖(多签一次,X1 盖不过受保护集)
    for (const denied of [`${USER_DATA}/codepuppy-engine-config`, `${USER_DATA}/codepuppy-engine-config/x`, `${USER_DATA}/CODEPUPPY-CONNECTIONS/a`, `${USER_DATA}/default.dat`, USER_DATA])
      expect(processFenceRulesCover(rules, denied), denied).toBe(false)
    // A literal on an ancestor makes that ancestor writable, so everything below it counts as covered — an allow literal.
    expect(processFenceRulesCover({ allow: [{ kind: "literal", value: "/Users/alpha/p" }], deny: [] }, "/Users/alpha/p/q")).toBe(true)
    // …while a literal deny freezes only the node itself
    expect(processFenceRulesCover({ allow: [{ kind: "subpath", value: "/a" }], deny: [{ kind: "literal", value: "/a/b" }] }, "/a/b/c")).toBe(true)
    expect(processFenceRulesCover({ allow: [{ kind: "subpath", value: "/a" }], deny: [{ kind: "literal", value: "/a/b" }] }, "/a/b")).toBe(false)
    expect(processFenceRulesCover({ allow: [], deny: [] }, "/a")).toBe(false)
  })
})

describe("resolveEngineRoots == 引擎的 #global-roots(@opencode/util/global 的根)", () => {
  // global-roots.ts 在模块装载时读 process.env / os.homedir(),所以每个输入形状起一个子进程真 import 它。
  // 解析走 util 包自己的 imports 映射(与引擎装载同一条件),不写死文件路径。
  const utilRequire = createRequire(resolve(import.meta.dir, "../../../util/package.json"))
  const rootsPath = utilRequire.resolve("#global-roots")

  const viaEngine = (env: Record<string, string>, home: string) => {
    const res = spawnSync(
      process.execPath,
      ["-e", `import("${rootsPath}").then(m => { const r = m.roots("opencode"); console.log(JSON.stringify({ data: r.data, cache: r.cache, config: r.config })) })`],
      { env: { PATH: process.env.PATH ?? "", HOME: home, ...env }, encoding: "utf8" },
    )
    if (res.status !== 0) throw new Error(`#global-roots probe failed: ${res.stderr}`)
    return JSON.parse(res.stdout.trim()) as { data: string; cache: string; config: string }
  }

  test("输入形状域:未设 / 全设 / 只设一个 / 设成空串 —— 四种形状逐点一致", () => {
    const shapes: Array<Record<string, string>> = [
      {},
      { XDG_DATA_HOME: "/x/data", XDG_CACHE_HOME: "/x/cache", XDG_CONFIG_HOME: "/x/config" },
      { XDG_CACHE_HOME: "/only/cache" },
      { XDG_DATA_HOME: "" },
    ]
    for (const env of shapes) {
      const real = viaEngine(env, "/Users/xdg-probe")
      const ours = resolveEngineRoots(env, "/Users/xdg-probe")
      // profile 放行的是 `<根>/opencode`(W4–W6),引擎的根正是这三个目录。
      const app = (root: string) => join(root, "opencode")
      expect({ data: app(ours.dataHome), cache: app(ours.cacheHome), config: app(ours.configHome) }, JSON.stringify(env)).toEqual(real)
    }
  })
})

describe("selectWorkspaceUnion —— 并集裁剪规则(K=32,顺序 = 默认工作区 → recent → tab 栏 → info)", () => {
  const dirs = new Set([
    "/Users/alpha/code-puppy",
    "/Users/alpha/proj-a",
    "/Users/alpha/proj-b",
    "/Users/alpha/proj-c",
    "/Users/alpha/proj-recent",
    "/Volumes/ext/proj-x",
  ])
  const isDirectory = (p: string) => dirs.has(p)
  const sessionKey = (id: string) => `sidecar\n/session/${id}`
  const sources = {
    tabs: JSON.stringify([
      { type: "draft", draftID: "d1", server: "sidecar", directory: "/Users/alpha/proj-a" },
      { type: "session", server: "sidecar", sessionID: "s1" },
      { type: "draft", draftID: "d2", server: "wsl:ubuntu", directory: "/home/u/remote" },
      { type: "draft", draftID: "d3", server: "sidecar", directory: "/Users/alpha/proj-b" },
    ]),
    recent: JSON.stringify({ key: sessionKey("s9") }),
    info: {
      [sessionKey("s1")]: { directory: "/Users/alpha/proj-c" },
      [sessionKey("s9")]: { directory: "/Users/alpha/proj-recent" },
      "ssh:box\n/session/s2": { directory: "/home/u/other" },
      [sessionKey("gone")]: { directory: "/Users/alpha/deleted-project" },
      [sessionKey("home")]: { directory: "/Users/alpha" },
      [sessionKey("root")]: { directory: "/" },
      [sessionKey("users")]: { directory: "/Users" },
      [sessionKey("rel")]: { directory: "relative/path" },
    },
  }

  test("顺序:默认工作区第一,recent 第二,然后 tab 栏的 draft,再 info 的 session;非本地引擎 / 不存在 / HOME 及其祖先 / 相对路径逐条排除并给理由", () => {
    const union = selectWorkspaceUnion({ appStateRoot: STATE_ROOT, configFenceRoots: noFence, realpath: noDisk, stat: virtualStat, candidates: workspaceCandidatesFromStore(sources), defaultWorkspace: "/Users/alpha/code-puppy", homeDir: "/Users/alpha", isDirectory })
    expect(union.selected).toEqual([
      "/Users/alpha/code-puppy",
      "/Users/alpha/proj-recent",
      "/Users/alpha/proj-a",
      "/Users/alpha/proj-b",
      "/Users/alpha/proj-c",
    ])
    const reasons = Object.fromEntries(union.excluded.map((e) => [e.directory, e.reason]))
    expect(reasons["/Users/alpha/deleted-project"]).toMatch(/not a directory/)
    expect(reasons["/Users/alpha"]).toMatch(/HOME/)
    expect(reasons["/"]).toMatch(/HOME/)
    expect(reasons["/Users"]).toMatch(/HOME/)
    expect(reasons["relative/path"]).toMatch(/absolute/)
    // wsl / ssh 的目录根本不进候选(不是「排除」,是「不认」)
    expect(union.excluded.map((e) => e.directory)).not.toContain("/home/u/remote")
    expect(union.excluded.map((e) => e.directory)).not.toContain("/home/u/other")
  })

  test("去重:同一目录出现在 recent / tabs / info 三处只算一次", () => {
    const dup = {
      tabs: [{ type: "draft", draftID: "d", server: "sidecar", directory: "/Users/alpha/proj-a" }],
      recent: { key: "draft:d" },
      info: { [sessionKey("x")]: { directory: "/Users/alpha/proj-a/" } },
    }
    const union = selectWorkspaceUnion({ appStateRoot: STATE_ROOT, configFenceRoots: noFence, realpath: noDisk, stat: virtualStat, candidates: workspaceCandidatesFromStore(dup), defaultWorkspace: "/Users/alpha/code-puppy", homeDir: "/Users/alpha", isDirectory })
    expect(union.selected).toEqual(["/Users/alpha/code-puppy", "/Users/alpha/proj-a"])
  })

  test("K 封顶:超过 MAX_WORKSPACES 的候选被排除并点名;默认工作区永远不会被顶掉", () => {
    const many = Array.from({ length: MAX_WORKSPACES + 5 }, (_, i) => `/Users/alpha/many-${i}`)
    const isDir = (p: string) => p === "/Users/alpha/code-puppy" || many.includes(p)
    const union = selectWorkspaceUnion({ appStateRoot: STATE_ROOT, configFenceRoots: noFence, realpath: noDisk, stat: virtualStat,
      candidates: workspaceCandidatesFromStore({ tabs: many.map((d, i) => ({ type: "draft", draftID: `d${i}`, server: "sidecar", directory: d })), recent: undefined, info: undefined }),
      defaultWorkspace: "/Users/alpha/code-puppy",
      homeDir: "/Users/alpha",
      isDirectory: isDir,
    })
    expect(union.selected.length).toBe(MAX_WORKSPACES)
    expect(union.selected[0]).toBe("/Users/alpha/code-puppy")
    expect(union.excluded.filter((e) => /MAX_WORKSPACES/.test(e.reason)).map((e) => e.directory)).toEqual(many.slice(MAX_WORKSPACES - 1))
  })

  test("store 形状容错:非 JSON 字符串 / 非数组 tabs / 缺 info ⇒ 只剩默认工作区,不抛", () => {
    const union = selectWorkspaceUnion({ appStateRoot: STATE_ROOT, configFenceRoots: noFence, realpath: noDisk, stat: virtualStat,
      candidates: workspaceCandidatesFromStore({ tabs: "{not json", recent: 42, info: null }),
      defaultWorkspace: "/Users/alpha/code-puppy",
      homeDir: "/Users/alpha",
      isDirectory,
    })
    expect(union.selected).toEqual(["/Users/alpha/code-puppy"])
    expect(workspaceCandidatesFromStore({ tabs: undefined, recent: undefined, info: undefined })).toEqual([])
  })

  test("默认工作区本身不是目录 ⇒ selected 为空(planner 据此拒绝 fork)", () => {
    const union = selectWorkspaceUnion({ appStateRoot: STATE_ROOT, configFenceRoots: noFence, realpath: noDisk, stat: virtualStat, candidates: [], defaultWorkspace: "/Users/alpha/missing", homeDir: "/Users/alpha", isDirectory })
    expect(union.selected).toEqual([])
  })
})

// ── `#1390`:围栏的输入当时是 opencode.global.dat 的三个 tab 键,住在围栏可写的 W3 里,所以被围栏的引擎树自己就能往里
// 塞一条「最近打开的项目是 <appData>/codepuppy-state」,下一次启动它就进了可写集。这里钉住第一步:凡与应用状态根
// 相关(同一路径 / 在它之内 / 包含它)的候选一律排除,而且先 realpath 再比 —— APFS 大小写不敏感,词法比较会漏。
// `#1394` 把清单搬到了围栏写不到的真源之后,这条规则留作第二道闸:候选不管从哪来,状态根都进不来(候选形状经
// workspaceCandidatesFromStore 造,与写入侧同一顺序)。
// 期望值手写字面量;④ 用真盘 + 生产的 realpathSync.native,并带一个「不归一 ⇒ 洞」的对照臂先证明手段测得出已知的坏。
describe("`#1390` selectWorkspaceUnion —— 与应用状态根相关的候选一律排除,先 realpath 再比", () => {
  const APP_SUPPORT = `${HOME}/Library/Application Support`
  /** 票面复现用的那条伪造记录,逐字形状:draft tab + 本地 sidecar + 任意目录,recent.key 指向它。 */
  const forged = (directory: string) => ({
    tabs: [{ type: "draft", draftID: "forged", server: LOCAL_SIDECAR_SERVER_KEY, directory }],
    recent: { key: "draft:forged" },
    info: undefined,
  })
  const run = (directory: string, over: Partial<WorkspaceUnionInput> = {}) =>
    selectWorkspaceUnion({
      candidates: workspaceCandidatesFromStore(forged(directory)),
      defaultWorkspace: `${HOME}/code-puppy`,
      homeDir: HOME,
      appStateRoot: STATE_ROOT,
      configFenceRoots: noFence,
      realpath: noDisk, stat: virtualStat,
      // 盘上「都在」:排除只能来自状态根规则,不能借「不是目录」蒙混过关
      isDirectory: () => true,
      ...over,
    })

  test("① 指向状态根本身 ⇒ 进 excluded(理由点名状态根),不在 selected", () => {
    const union = run(STATE_ROOT)
    expect(union.selected).toEqual(["/Users/alpha/code-puppy"])
    expect(union.excluded).toEqual([
      {
        directory: "/Users/alpha/Library/Application Support/codepuppy-state",
        reason:
          "related to the app state root /Users/alpha/Library/Application Support/codepuppy-state (same path, inside it, or contains it) — the fence's own state must never be a workspace (#1390)",
      },
    ])
  })

  test("② 指向状态根的子目录(custom-providers / env/prod / cas)⇒ 同样排除 —— related 是双向的", () => {
    for (const child of [`${STATE_ROOT}/custom-providers`, `${STATE_ROOT}/env/prod`, `${STATE_ROOT}/cas`]) {
      const union = run(child)
      expect(union.selected, child).toEqual(["/Users/alpha/code-puppy"])
      expect(union.excluded, child).toEqual([{ directory: child, reason: expect.stringMatching(/app state root .* \(#1390\)$/) }])
    }
  })

  test("③ 指向状态根的祖先(~/Library/Application Support、~/Library)⇒ 排除 —— 票面实测那一条;HOME 本身仍走原来的 HOME 规则", () => {
    for (const ancestor of [APP_SUPPORT, `${HOME}/Library`]) {
      const union = run(ancestor)
      expect(union.selected, ancestor).toEqual(["/Users/alpha/code-puppy"])
      expect(union.excluded, ancestor).toEqual([{ directory: ancestor, reason: expect.stringMatching(/app state root/) }])
    }
    const home = run(HOME)
    expect(home.selected).toEqual(["/Users/alpha/code-puppy"])
    expect(home.excluded).toEqual([{ directory: "/Users/alpha", reason: "would put HOME inside the writable set (fence would be void)" }])
  })

  test("④ 归一化真的在起作用(真盘 + 生产的 realpathSync.native):软链 / 大小写变形指向状态根的祖先 —— 不归一时进 selected(洞),归一之后被排除", () => {
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), "ac1390-")))
    try {
      const home = join(base, "home")
      const appSupport = join(home, "Library", "Application Support")
      const state = join(appSupport, "codepuppy-state")
      const puppy = join(home, "code-puppy")
      for (const d of [join(state, "env", "prod"), join(state, "cas"), puppy]) mkdirSync(d, { recursive: true })
      const link = join(home, "link-to-app-support")
      symlinkSync(appSupport, link)
      const variant = join(home, "LIBRARY", "Application Support")
      const onDisk = (p: string) => {
        try {
          return statSync(p).isDirectory()
        } catch {
          return false
        }
      }
      const identity = (p: string) => p
      const real = (directory: string, realpath: (p: string) => string, stat?: WorkspaceUnionInput["stat"]) =>
        selectWorkspaceUnion({ candidates: workspaceCandidatesFromStore(forged(directory)), defaultWorkspace: puppy, homeDir: home, appStateRoot: state, configFenceRoots: noFence, realpath, stat, isDirectory: onDisk })

      // 软链臂(任何平台都量得到)。对照:不归一 ⇒ 软链落进 selected —— 这就是洞;归一 ⇒ 排除,理由点名状态根并写出它解析到哪
      expect(real(link, identity, virtualStat).selected).toEqual([puppy, link])
      const linked = real(link, realpathSync.native)
      expect(linked.selected).toEqual([puppy])
      expect(linked.excluded).toEqual([{ directory: link, reason: expect.stringMatching(/^related to the app state root .* \(resolves to .*\/home\/Library\/Application Support\) — .* \(#1390\)$/) }])

      // 大小写臂:只有大小写不敏感的卷(APFS 默认)上这条变形路径才在盘上;CI 的 ext4 上它根本不存在,陷阱不存在于此 —— 如实分支
      if (onDisk(variant)) {
        expect(real(variant, identity, virtualStat).selected).toEqual([puppy, variant]) // 洞:词法比较认不出它就是 …/Library/Application Support
        const cased = real(variant, realpathSync.native)
        expect(cased.selected).toEqual([puppy])
        expect(cased.excluded).toEqual([{ directory: variant, reason: expect.stringMatching(/^related to the app state root .* \(resolves to .*\/home\/Library\/Application Support\) — .* \(#1390\)$/) }])
      } else {
        console.log(`[#1390] case-variant arm not measurable on this volume (case-sensitive): ${variant} is not on disk`)
        expect(real(variant, realpathSync.native).selected).toEqual([puppy])
      }
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  test("⑤ 正样本:普通项目目录照常进 selected —— 状态根规则没有把正常工作区一起拒掉", () => {
    const union = selectWorkspaceUnion({
      candidates: workspaceCandidatesFromStore({
        tabs: [
          { type: "draft", draftID: "p", server: LOCAL_SIDECAR_SERVER_KEY, directory: `${HOME}/proj-a` },
          { type: "draft", draftID: "q", server: LOCAL_SIDECAR_SERVER_KEY, directory: `${HOME}/app/alpha-code` },
        ],
        recent: { key: "draft:p" },
        info: { "sidecar\n/session/s1": { directory: `${HOME}/Library/Mobile Documents/notes` } },
      }),
      defaultWorkspace: `${HOME}/code-puppy`,
      homeDir: HOME,
      appStateRoot: STATE_ROOT,
      configFenceRoots: noFence,
      realpath: noDisk, stat: virtualStat,
      isDirectory: () => true,
    })
    // ~/Library 之下但与 codepuppy-state 无关的目录(iCloud 文稿)也照常放行 —— 规则只认「相关」,不是「在 ~/Library 下」
    expect(union.selected).toEqual(["/Users/alpha/code-puppy", "/Users/alpha/proj-a", "/Users/alpha/app/alpha-code", "/Users/alpha/Library/Mobile Documents/notes"])
    expect(union.excluded).toEqual([])
  })
})

describe("SPEC-engine-config-fence BR-05:受保护配置位置本身与其内的文件夹不合格(原因 protected-config),包含它的文件夹照常", () => {
  const CONFIG = `${HOME}/.config/opencode`
  const input = (over: Partial<WorkspaceUnionInput> = {}) => ({
    homeDir: HOME, appStateRoot: STATE_ROOT, configFenceRoots: () => [CONFIG, GLOBAL], realpath: noDisk, stat: virtualStat, isDirectory: () => true, ...over,
  })

  test("同一对象 / 在其内 ⇒ protected-config 并点名位置;包含它 ⇒ 合格;状态根之内仍是 home-or-app-state(既有判定在前);根不在盘上 ⇒ 跳过", () => {
    for (const directory of [CONFIG, `${CONFIG}/plugin`, `${CONFIG}/plugin/deep`])
      expect(checkWorkspaceDirectory(input(), directory), directory).toEqual({ eligible: false, reason: "protected-config", detail: `inside the protected engine configuration location ${CONFIG}` })
    expect(checkWorkspaceDirectory(input(), `${HOME}/.config`)).toEqual({ eligible: true, directory: `${HOME}/.config` })
    expect(checkWorkspaceDirectory(input(), `${HOME}/.config/opencode-other`)).toEqual({ eligible: true, directory: `${HOME}/.config/opencode-other` })
    expect(checkWorkspaceDirectory(input(), `${GLOBAL}/x`)).toMatchObject({ eligible: false, reason: "home-or-app-state" })
    const missingRoot = (p: string) => {
      if (resolve(p) === CONFIG) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
      return resolve(p)
    }
    expect(checkWorkspaceDirectory(input({ realpath: missingRoot }), `${HOME}/proj`)).toEqual({ eligible: true, directory: `${HOME}/proj` })
    // 并集同一判法:真源里落在受保护位置之内的条目被排除并记账
    const union = selectWorkspaceUnion({ ...input(), candidates: [`${CONFIG}/plugin`, `${HOME}/proj`], defaultWorkspace: `${HOME}/code-puppy` })
    expect(union.selected).toEqual([`${HOME}/code-puppy`, `${HOME}/proj`])
    expect(union.excluded).toEqual([{ directory: `${CONFIG}/plugin`, reason: `inside the protected engine configuration location ${CONFIG}` }])
  })

  test("身份按 device + inode(真盘 + 生产的 realpathSync.native):软链、大小写变形、/System/Volumes/Data 写法都认得出同一个位置;每次判定现解析", () => {
    const tree = realpathSync.native(mkdtempSync(join(tmpdir(), "cf-eligibility-")))
    try {
      const home = join(tree, "home")
      const config = join(home, ".config", "opencode")
      const elsewhere = join(home, "dotfiles")
      for (const d of [join(config, "plugin"), join(home, "code-puppy"), elsewhere]) mkdirSync(d, { recursive: true })
      const link = join(home, "link-to-config")
      symlinkSync(config, link)
      const real = { homeDir: home, appStateRoot: join(tree, "state"), configFenceRoots: () => [config], realpath: (p: string) => realpathSync.native(p), isDirectory: (p: string) => statSync(p).isDirectory() }
      for (const directory of [config, join(config, "plugin"), link, join(link, "plugin")])
        expect(checkWorkspaceDirectory(real, directory), directory).toMatchObject({ eligible: false, reason: "protected-config" })
      const data = `/System/Volumes/Data${config}`
      if (statSync(data, { throwIfNoEntry: false })) {
        expect(checkWorkspaceDirectory(real, data)).toMatchObject({ eligible: false, reason: "protected-config" })
        expect(checkWorkspaceDirectory({ ...real, configFenceRoots: () => [data] }, join(config, "plugin"))).toMatchObject({ eligible: false, reason: "protected-config" })
      } else console.log(`[cf-eligibility] firmlink arm not measurable here: ${data} is not on disk`)
      const variant = join(home, ".CONFIG", "OPENCODE")
      if (statSync(variant, { throwIfNoEntry: false })) expect(checkWorkspaceDirectory(real, variant)).toMatchObject({ eligible: false, reason: "protected-config" })
      // 包含受保护位置的文件夹照常合格
      expect(checkWorkspaceDirectory(real, join(home, ".config"))).toEqual({ eligible: true, directory: join(home, ".config") })
      // 现解析:位置被换成别处的目录之后,原来的文件夹按新身份判,不沿用上一次的答案
      rmSync(config, { recursive: true })
      symlinkSync(elsewhere, config)
      expect(checkWorkspaceDirectory(real, elsewhere)).toMatchObject({ eligible: false, reason: "protected-config" })
      expect(checkWorkspaceDirectory({ ...real, configFenceRoots: () => [] }, elsewhere)).toEqual({ eligible: true, directory: elsewhere })
    } finally {
      rmSync(tree, { recursive: true, force: true })
    }
  })
})

describe("trimUntilCompiles —— 试编译封顶,从尾部丢,丢到底仍失败要抛", () => {
  const ws = ["/Users/alpha/code-puppy", "/Users/alpha/a", "/Users/alpha/b", "/Users/alpha/c"]
  const compileAllowing = (max: number, reason = "sandbox-exec: data object length 70173 exceeds maximum (65535)") => (profile: string) =>
    (profile.match(/; W1$/gm)?.length ?? 0) <= max ? ({ ok: true } as const) : ({ ok: false, reason } as const)

  test("编译器一次通过:不丢、attempts=1、profile 含全部工作区", () => {
    const r = trimUntilCompiles({ ...base, workspaces: ws }, compileAllowing(99))
    expect(r.dropped).toEqual([])
    expect(r.attempts).toBe(1)
    expect(r.workspaces).toEqual(ws)
    expect(tokens(r.profile).filter((l) => ws.some((w) => l === `(subpath "${w}")`)).length).toBe(4)
  })

  test("只放得下 2 个:丢 c 再丢 b,attempts=3,lastFailure 是编译器原文,剩下的 profile 里没有被丢的目录", () => {
    const r = trimUntilCompiles({ ...base, workspaces: ws }, compileAllowing(2))
    expect(r.dropped).toEqual(["/Users/alpha/c", "/Users/alpha/b"])
    expect(r.workspaces).toEqual(["/Users/alpha/code-puppy", "/Users/alpha/a"])
    expect(r.attempts).toBe(3)
    expect(r.lastFailure).toMatch(/exceeds maximum \(65535\)/)
    expect(tokens(r.profile)).not.toContain(`(subpath "/Users/alpha/c")`)
    expect(tokens(r.profile)).not.toContain(`(subpath "/Users/alpha/b")`)
    // SPEC-engine-config-fence E9:裁剪只丢工作区,受保护集原样(每次试编译都带着);stored-credentials-fence §4.5:C1 同样原样、仍在最后
    expect(tokens(r.profile).slice(-(CF_LINES.length + C1_LINES.length))).toEqual([...CF_LINES, ...C1_LINES])
  })

  test("默认工作区不可丢:字节墙丢到只剩 1 个仍失败 ⇒ 抛,消息带编译器原文与账目(fail-closed 到「引擎不起」)", () => {
    expect(() => trimUntilCompiles({ ...base, workspaces: ws }, compileAllowing(0))).toThrow(
      /minimum writable set \(1 workspace, 3 dropped, 4 attempts\): sandbox-exec: data object length 70173 exceeds maximum \(65535\)/,
    )
  })

  test("`#1337` 归因:失败原因不是字节墙(语法坏 / unbound variable)⇒ 一个工作区都不丢、attempts=1 即抛,消息点名「丢工作区救不了」", () => {
    const seen: number[] = []
    const syntaxBad = (profile: string) => {
      seen.push(profile.match(/; W1$/gm)?.length ?? 0)
      return { ok: false as const, reason: "sandbox-exec: unbound variable: host … line 25, column 33" }
    }
    expect(() => trimUntilCompiles({ ...base, workspaces: ws }, syntaxBad)).toThrow(
      /not the 65535-byte data-object wall — dropping workspaces cannot fix it, so none were dropped \(4 workspaces, 0 dropped, 1 attempt\): sandbox-exec: unbound variable: host/,
    )
    expect(seen).toEqual([4]) // 只试编了一次,而且是全并集
    // 字节墙的原文由 process-fence-compile.test.ts 对真编译器钉住;这里只核对判别式认得它、不认别的
    expect(COMPILE_BYTE_WALL.test("sandbox-exec: data object length 65574 exceeds maximum (65535)")).toBe(true)
    expect(COMPILE_BYTE_WALL.test("sandbox-exec: unbound variable: host")).toBe(false)
    expect(COMPILE_BYTE_WALL.test("profile compilation failed")).toBe(false)
  })
})

describe("控制组:判据能测出已知的坏", () => {
  test("少一行(去掉 W15)⇒ 逐行全等判据红", () => {
    const rendered = tokens(renderProcessFenceProfile(base)).filter((l) => !l.includes("/dev/ptmx"))
    expect(rendered).not.toEqual(tokens(renderProcessFenceProfile(base)))
  })
  test("`#1337` 少 N3(inbound)或多一条减法 deny ⇒ 网络行判据红(老勘破 §5 那两行 / 减法组合正是 `#1334` 实测的两种坏)", () => {
    const good = tokens(renderProcessFenceProfile({ ...base, configFence: [], homebrewFence: [], credentialStores: [] })) // 网络行的形状在没有受保护集的形状上判(见上)
    expect(good.slice(-4)).toEqual(NETWORK_LINES(4443))
    const sec5 = good.filter((l) => !l.includes("network-inbound"))
    expect(sec5.slice(-4)).not.toEqual(NETWORK_LINES(4443))
    const subtractive = [...good, '(deny network-outbound (remote ip "localhost:1234"))']
    expect(subtractive.filter((l) => l.startsWith("(deny "))).not.toEqual(["(deny file-write*)", "(deny network*)"])
  })
  test("放宽一行(HOME 整个进 subpath)⇒ 并集规则红", () => {
    const union = selectWorkspaceUnion({ appStateRoot: STATE_ROOT, configFenceRoots: noFence, realpath: noDisk, stat: virtualStat,
      candidates: workspaceCandidatesFromStore({ tabs: [{ type: "draft", draftID: "d", server: "sidecar", directory: "/Users/alpha" }], recent: undefined, info: undefined }),
      defaultWorkspace: join("/Users/alpha", "code-puppy"),
      homeDir: "/Users/alpha",
      isDirectory: () => true,
    })
    expect(union.selected).not.toContain("/Users/alpha")
  })
})


test("file targets match literal and regex entries exactly while directory grant coverage stays conservative", () => {
  for (const allow of [[{ kind: "literal" as const, value: "/parent" }], [{ kind: "regex" as const, value: "^/parent$" }]]) {
    expect(processFenceRulesCover({ allow, deny: [] }, "/parent/child")).toBe(true)
    expect(processFenceRulesCover({ allow, deny: [] }, "/parent/child", "file")).toBe(false)
    expect(processFenceRulesCover({ allow, deny: [] }, "/parent", "file")).toBe(true)
  }
  const allow = [{ kind: "subpath" as const, value: "/parent" }]
  expect(processFenceRulesCover({ allow, deny: [{ kind: "literal", value: "/parent" }] }, "/parent/child", "file")).toBe(true)
  expect(processFenceRulesCover({ allow, deny: [{ kind: "literal", value: "/parent/child" }] }, "/parent/child", "file")).toBe(false)
})
