// Electron Node's libc spelling is the input sample: Bun canonicalises firmlinks differently.
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, realpathSync } from "node:fs"
import { join } from "node:path"
import { bootFenceWorkspaceTruth, writeWorkspaceTruth } from "./process-fence-workspaces"
import { planProcessFence } from "./process-fence-plan"

const root = process.env.CODEPUPPY_IDENTITY_TEST_ROOT!
const home = join(root, "home"), state = join(root, "state"), A = join(root, "A")
const alternate = `/System/Volumes/Data${home}`
const fs = { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync }
writeWorkspaceTruth(join(root, "firmlink-node.json"), [], fs)
const tracker = await bootFenceWorkspaceTruth({ truthPath: join(root, "firmlink-node.json"), store: { tabs: [], recent: undefined, info: undefined }, fs, log: () => {}, onWritableChanged: () => {}, eligibility: { homeDir: home, appStateRoot: state, configFenceRoots: () => [], realpath: realpathSync.native, isDirectory: (path) => statSync(path).isDirectory() } })
const registered = await tracker.userOpened.register({ server: "sidecar", directory: alternate })
let issues = 0
const runtime = await tracker.probeWrite({ server: "sidecar", directory: alternate }, {
  fenced: true, grantWrite: async () => { issues++; return { outcome: "granted" } }, probeWrite: async () => ({ outcome: "denied" }), generationWrites: () => false,
} as unknown as Parameters<typeof tracker.probeWrite>[1])
const planned = await planProcessFence({ userDataPath: join(root, "install"), sidecarEnv: {}, egressProxyPort: 59999, addon: { packaged: true, resourcesPath: root, moduleDir: root, exists: () => true }, carriedWorkspaces: [], engineConfigDirectory: join(home, ".config", "opencode") }, {
  homeDir: () => home, appStateRoot: () => state, codepuppyGlobalRoot: () => join(state, "env/dev"), defaultWorkspace: () => A,
  readWorkspaces: () => [alternate], realpath: realpathSync.native, isDirectory: (path) => statSync(path).isDirectory(), mkdirp: (path) => void mkdirSync(path, { recursive: true }), compile: () => ({ ok: true }), log: () => {},
})
console.log(JSON.stringify({ registered, runtime, issues, workspaces: planned.workspaces, alternate, rawRealpath: realpathSync.native(alternate), sameDevice: statSync(home, { bigint: true }).dev === statSync(alternate, { bigint: true }).dev, sameInode: statSync(home, { bigint: true }).ino === statSync(alternate, { bigint: true }).ino }))
