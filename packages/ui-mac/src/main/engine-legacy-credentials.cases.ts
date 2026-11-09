// `#1667`(#1662 L5,基线 §3 S2,清点表 D5):独立 OpenCode 留在数据目录里的 `auth.json`,OpenCode 2 在已有的库上补跑导入迁移时
// 会把它整份导进 `credential` 表 —— 这条前提在沙箱里的真引擎上跑出来;再判 main 的拒绝条件恰好盖住这一种情况。
//
// 本文件由 engine-legacy-credentials.test.ts 宿主起独立 `bun test` 子进程跑:要在引擎的全局数据目录里放一个假 `auth.json`,
// 同一进程里后起的引擎都会读到它,所以单独一个进程。HOME / XDG 全在临时沙箱里,绝不碰 owner 的数据目录。
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { assertEngineSandboxed, engineSandbox, engineSlot } from "../../test-component/engine-sandbox"
import { buildEngineServerOptions } from "./engine-server-options"
import { withEngineAuthorization } from "./engine-authorization"
import { engineDataDirectory, legacyCredentialImportRefusal, LEGACY_CREDENTIAL_FILE, LEGACY_CREDENTIAL_IMPORT_MIGRATION } from "./engine-legacy-credentials"
import type { EngineFetch } from "./in-process-engine"

const sandbox = engineSandbox()
const engines: Array<{ close: () => Promise<void> }> = []
let dataDir = ""

beforeAll(async () => {
  await assertEngineSandboxed(sandbox)
  const { Global } = await import("@opencode/util/global")
  dataDir = Global.Path.data
  // main 用的推导与引擎自己的全局数据目录是同一个目录。
  expect(engineDataDirectory(process.env, sandbox.home)).toBe(dataDir)
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, LEGACY_CREDENTIAL_FILE), JSON.stringify({ "cp-l5-legacy-probe": { type: "api", key: "sk-cp-l5-not-a-real-key" } }))
})

afterAll(async () => {
  for (const engine of engines.reverse()) await engine.close().catch(() => undefined)
})

async function startOn(slot: ReturnType<typeof engineSlot>) {
  const { startEngine } = await import("../../engine/engine-embed")
  let fetch: EngineFetch | undefined
  const engine = await startEngine(
    buildEngineServerOptions({
      hostname: "127.0.0.1",
      port: 0,
      password: "cp-l5-legacy",
      engineVersion: "test",
      databasePath: slot.databasePath,
      configDirectory: slot.configDirectory,
      config: { content: "{}" },
      models: { fetch: false },
      filewatcher: false,
      platform: process.platform,
    }),
    { onDispatch: (dispatch) => (fetch = withEngineAuthorization(dispatch, "cp-l5-legacy")) },
  )
  const credentials = async () => {
    const response = await fetch!(new Request("http://codepuppy-sidecar.invalid/api/credential", { headers: { "x-opencode-directory": encodeURIComponent(slot.projectDirectory) } }))
    expect(response.status).toBe(200)
    return JSON.stringify(await response.json())
  }
  return { engine, credentials }
}

describe("S2 独立 OpenCode 的 auth.json 不进 Code Puppy 的凭证表", () => {
  test("前提(真引擎):全新库不导入;已有的库补跑导入迁移时整份导入 —— main 的判定恰好在后一种情况拒绝,导过之后放行", async () => {
    const slot = engineSlot(sandbox, "legacy-import")
    // ① 全新库:schema bootstrap 只登记迁移、不跑数据迁移 ⇒ 不导入;main 也放行(库还不存在)。
    expect(await legacyCredentialImportRefusal({ dataDir, databasePath: slot.databasePath })).toBeUndefined()
    const first = await startOn(slot)
    expect(await first.credentials()).not.toContain("cp-l5-legacy-probe")
    await first.engine.close()

    // ② 造出「已有的库、导入迁移还没跑过」(1.x 库升级时的形态):把那一行迁移记录删掉。main ⇒ 拒绝。
    const sqlite = Bun.spawnSync(["/usr/bin/sqlite3", slot.databasePath, `DELETE FROM migration WHERE id = '${LEGACY_CREDENTIAL_IMPORT_MIGRATION}';`])
    expect(sqlite.exitCode).toBe(0)
    const refusal = await legacyCredentialImportRefusal({ dataDir, databasePath: slot.databasePath })
    expect(refusal).toContain(join(dataDir, LEGACY_CREDENTIAL_FILE))

    // ③ 反向臂:不拒绝、照样起引擎 ⇒ 导入迁移补跑,独立 OpenCode 的凭证进了 Code Puppy 引擎的凭证表。
    const second = await startOn(slot)
    engines.push(second.engine)
    expect(await second.credentials()).toContain("cp-l5-legacy-probe")

    // ④ 导过之后库里有那一行 ⇒ 不会再导入 ⇒ main 放行。
    expect(await legacyCredentialImportRefusal({ dataDir, databasePath: slot.databasePath })).toBeUndefined()
  }, 60_000)
})
