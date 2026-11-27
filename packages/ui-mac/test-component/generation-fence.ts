// Production plans an engine generation (server.ts planProductionFence → useGenerationFence) before it projects a local
// official connector; officialNodeCommand then runs its Node check under that profile and refuses without one (#1814).
// Cases that seed or restore a local connector without the production planner install the same planned profile here.
import { existsSync, mkdirSync, realpathSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { trialCompileProfile } from "../src/main/process-fence-compile"
import { planProcessFence } from "../src/main/process-fence-plan"
import { useGenerationFence } from "../src/main/shell-env"

export function installGenerationFence(base: string) {
  if (process.platform !== "darwin") return
  const fenceHome = join(base, "fence-home"), state = join(base, "fence-state"), userData = join(base, "fence-userData"), project = join(base, "fence-project")
  for (const dir of [fenceHome, state, userData, project]) mkdirSync(dir, { recursive: true })
  const plan = planProcessFence({ userDataPath: userData, sidecarEnv: { HOME: fenceHome },
    addon: { packaged: false, resourcesPath: "/unused", moduleDir: resolve(import.meta.dir, "../out/main"), exists: existsSync }, egressProxyPort: 4443, carriedWorkspaces: [], engineConfigDirectory: join(fenceHome, ".config/opencode"), homebrewFence: [], credentialStores: [],
  }, { homeDir: () => fenceHome, codepuppyGlobalRoot: () => join(state, "env/dev"), appStateRoot: () => state, realpath: realpathSync.native, defaultWorkspace: () => project, readWorkspaces: () => [], isDirectory: (p) => statSync(p).isDirectory(), mkdirp: (p) => void mkdirSync(p, { recursive: true }), compile: trialCompileProfile, log: () => {} })
  useGenerationFence({ profile: plan.profile, roots: { ...plan.roots, engineConfigDirectory: join(fenceHome, ".config/opencode") }, env: { HOME: fenceHome, PATH: "/usr/bin:/bin" } })
}
