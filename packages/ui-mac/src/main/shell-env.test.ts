import { expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { applyTrustedShellEnvironment, loadShellEnv, type ShellProbeFenceContext } from "./shell-env"
import { probeShellEnvAsync } from "./shell-env-cache"
import { planProcessFence } from "./process-fence-plan"
import { trialCompileProfile } from "./process-fence-compile"

test.skipIf(process.platform !== "darwin")("fenced shell probes: interactive and login fallback cannot write outside or redirect trusted roots", async () => {
  const base = resolve(import.meta.dir, "../../node_modules/.cache")
  mkdirSync(base, { recursive: true })
  const root = realpathSync(mkdtempSync(join(base, "shell-probe-")))
  const home = join(root, "home")
  const project = join(root, "project")
  const state = join(root, "state")
  const userData = join(root, "userData")
  for (const dir of [home, project, state, userData]) mkdirSync(dir)
  const marker = join(root, "escaped")
  try {
    const plan = planProcessFence({
      userDataPath: userData, sidecarEnv: { HOME: home },
      addon: { packaged: false, resourcesPath: "/unused", moduleDir: resolve(import.meta.dir, "../../out/main"), exists: existsSync },
      egressProxyPort: 4443, carriedWorkspaces: [], engineConfigDirectory: join(home, ".config", "opencode"), credentialStores: [],
    }, { homeDir: () => home, codepuppyGlobalRoot: () => join(state, "env", "dev"), appStateRoot: () => state, realpath: realpathSync.native, defaultWorkspace: () => project, readWorkspaces: () => [], isDirectory: (path) => statSync(path).isDirectory(), mkdirp: (path) => void mkdirSync(path, { recursive: true }), compile: trialCompileProfile, log: () => {} })
    const context: ShellProbeFenceContext = { profile: plan.profile, roots: { ...plan.roots, engineConfigDirectory: join(home, ".config", "opencode") }, env: {
      HOME: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", XDG_CONFIG_HOME: plan.roots.configHome, XDG_DATA_HOME: plan.roots.dataHome, XDG_CACHE_HOME: plan.roots.cacheHome, XDG_STATE_HOME: plan.roots.stateHome, OPENCODE_CONFIG_DIR: join(home, ".config", "opencode"),
    } }
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
    // Actual rc source owned by this test; no user's rc or external protocol stand-in.
    writeFileSync(join(home, ".zprofile"), `printf escaped > ${quote(marker)}\nexport XDG_CONFIG_HOME=${quote(project)} XDG_DATA_HOME=${quote(project)} OPENCODE_DB=${quote(join(project, "bad.db"))}\nexport PROBE_TOOL=$(command -v git)\n`)
    for (const rc of ["export PROBE_MODE=interactive\n", "exit 7\n"]) {
      writeFileSync(join(home, ".zshrc"), rc)
      for (const output of [loadShellEnv("/bin/zsh", { log: () => {} }, context), await probeShellEnvAsync("/bin/zsh", context)]) {
        expect(output).not.toBeNull()
        expect(output!.XDG_CONFIG_HOME).toBe(project)
        expect(output!.PROBE_TOOL).toBe("/usr/bin/git")
        expect(existsSync(marker)).toBe(false)
        const target: NodeJS.ProcessEnv = { OPENCODE_CONFIG: "/bad/from/cache" }
        applyTrustedShellEnvironment(target, output!, context)
        expect(target.XDG_CONFIG_HOME).toBe(context.roots.configHome)
        expect(target.XDG_DATA_HOME).toBe(context.roots.dataHome)
        expect(target.HOME).toBe(home)
        expect(target.OPENCODE_DB).toBeUndefined()
        expect(target.OPENCODE_CONFIG).toBeUndefined()
      }
    }
    expect(loadShellEnv("/bin/zsh", { log: () => {} }, { ...context, profile: "invalid-profile" })).toBeNull()
    expect(await probeShellEnvAsync("/bin/zsh", { ...context, profile: "invalid-profile" })).toBeNull()
    expect(existsSync(marker)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
