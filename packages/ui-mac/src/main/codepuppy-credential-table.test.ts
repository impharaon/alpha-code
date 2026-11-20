// SPEC-stored-credentials-fence §4.3 / §4.5(实现期修订 2,片 ③ 审查 Minor 1 / 3):main 的存放点清单 mainCredentialStores 与读表
// buildCredentialTable —— 测的就是这两个生产函数,不是另拼的一份清单。官方连接器运行期目录的路径恒按纯计算列入:工作区真源里有一个项目的文件夹包含系统临时
// 目录(这时物化路径上的可用性检查 officialRuntimeParent 抛,令牌写不出去)也照样在 C1 与表的清单里,计划照常渲染、不抛;之后那份项目关掉、
// 连接器写出明文,规则早已在 profile 里。只有算不出路径(没有环境根)时不列 —— 那时物化路径同样走不通。
import { afterAll, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { __resetCodePuppyEnvironmentForTests, initCodePuppyEnvironment, tryGetCodePuppyEnvironment } from "./codepuppy-environment"
import { buildCredentialTable, mainCredentialStores } from "./codepuppy-credential-table"
import { codepuppyGlobalRoot } from "./engine-config-truth"
import { officialRuntimeParent } from "./official-connector-recipes"
import { planProcessFence } from "./process-fence-plan"
import { processFenceWriteRules } from "./process-fence-profile"

const tmp = realpathSync.native(mkdtempSync(join(tmpdir(), "cp-credential-table-")))
const userData = join(tmp, "userdata")
const home = join(tmp, "home")
const savedGlobalDir = process.env.CODEPUPPY_GLOBAL_DIR
afterAll(() => {
  __resetCodePuppyEnvironmentForTests()
  if (savedGlobalDir === undefined) delete process.env.CODEPUPPY_GLOBAL_DIR
  else process.env.CODEPUPPY_GLOBAL_DIR = savedGlobalDir
  rmSync(tmp, { recursive: true, force: true })
})

/** 生产形状,独立写一遍:<realpath(tmpdir)>/codepuppy-connectors-<uid>-<sha256(环境根) 前 16 位>。 */
const runtimeDirectoryOf = (root: string) =>
  join(realpathSync.native(tmpdir()), `codepuppy-connectors-${process.getuid?.()}-${createHash("sha256").update(root).digest("hex").slice(0, 16)}`)

test("官方连接器运行期目录:没有环境根 ⇒ 不列;有环境根、而一个打开的项目文件夹包含系统临时目录(可用性检查此刻抛)⇒ 照样列入 C1 与表的清单,计划渲染不抛,目录里的令牌进表", () => {
  mkdirSync(userData, { recursive: true })
  __resetCodePuppyEnvironmentForTests()
  delete process.env.CODEPUPPY_GLOBAL_DIR
  expect(tryGetCodePuppyEnvironment()).toBeUndefined()
  expect(mainCredentialStores(userData).some((store) => store.table === "connector-by-run")).toBe(false)

  const environment = initCodePuppyEnvironment({ isPackaged: false, channel: "dev", appDataDir: tmp, baseRoot: join(tmp, "codepuppy-state"), homeDir: home })
  const root = codepuppyGlobalRoot()
  // the user has a project open whose folder contains the system temp directory (official-connector-recipes.ts: a workspace that
  // contains realpath(tmpdir)): the availability check on the materialising path throws now
  const project = dirname(realpathSync.native(tmpdir()))
  const truth = join(environment.casBaseRoot, "fence-workspaces", `${environment.environment}.json`)
  mkdirSync(dirname(truth), { recursive: true })
  writeFileSync(truth, JSON.stringify({ v: 1, workspaces: [project] }))
  expect(() => officialRuntimeParent(root)).toThrow(/official-connector-needs-reentry/)

  const runtime = runtimeDirectoryOf(root)
  const stores = mainCredentialStores(userData)
  expect(stores.filter((store) => store.table === "connector-by-run")).toEqual([{ path: runtime, kind: "dir", table: "connector-by-run" }])

  // the table reads that directory too (a token materialised there earlier, or after the project is closed, is in the next table)
  const token = join(runtime, `${process.pid}-00000000-0000-0000-0000-000000000000`, "github-official", "v1", "GITHUB_PERSONAL_ACCESS_TOKEN")
  mkdirSync(dirname(token), { recursive: true, mode: 0o700 })
  writeFileSync(token, "FAKE-CRED-runtime-table", { mode: 0o600 })
  try {
    expect(buildCredentialTable(userData, () => {})[token]?.value).toBe("FAKE-CRED-runtime-table")

    // the production planner takes the same list and renders it into C1 without throwing
    const plan = planProcessFence(
      {
        userDataPath: userData,
        sidecarEnv: { HOME: home },
        addon: { packaged: true, resourcesPath: tmp, moduleDir: tmp, exists: () => true },
        egressProxyPort: 59999,
        carriedWorkspaces: [],
        engineConfigDirectory: join(home, ".config", "opencode"),
        credentialStores: stores,
      },
      {
        homeDir: () => home,
        codepuppyGlobalRoot: () => root,
        appStateRoot: () => dirname(dirname(root)),
        realpath: (p) => realpathSync.native(p),
        defaultWorkspace: () => (mkdirSync(join(tmp, "default-workspace"), { recursive: true }), join(tmp, "default-workspace")),
        readWorkspaces: () => [project],
        isDirectory: (p) => statSync(p).isDirectory(),
        mkdirp: (p) => void mkdirSync(p, { recursive: true }),
        compile: () => ({ ok: true }),
        log: () => {},
      },
    )
    const c1 = plan.profile.slice(plan.profile.indexOf("(deny file-read* file-write*\n"))
    expect(c1).toContain(`(subpath "${runtime}")`)
    expect(processFenceWriteRules(plan.profile).deny).toContainEqual({ kind: "subpath", value: runtime })
  } finally {
    rmSync(runtime, { recursive: true, force: true })
  }
})
