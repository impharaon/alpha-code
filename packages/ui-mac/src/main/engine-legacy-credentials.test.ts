// `#1667`(#1662 L5,基线 §3 S2 / S7):数据目录里独立 OpenCode 的 `auth.json` 会在 OpenCode 2 第一次跑导入迁移时进凭证表 ⇒
// main 在 fork 之前拒绝(engine-legacy-credentials.ts)。这里判拒绝条件与 S7 的「同目录其它 OpenCode 数据」清单;
// 真引擎上的前提(迁移真的会导入)在 engine-legacy-credentials.cases.ts,本文件第一条起子进程跑它。
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { foreignOpenCodeData, LEGACY_CREDENTIAL_IMPORT_MIGRATION, legacyCredentialImportRefusal } from "./engine-legacy-credentials"

test("真引擎:auth.json 在迁移第一次跑时被导入;导过之后放行、新库仍拒绝(engine-legacy-credentials.cases.ts,1 条)", () => {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--timeout", "90000", join(import.meta.dir, "engine-legacy-credentials.cases.ts")],
    cwd: join(import.meta.dir, "../.."),
    env: process.env,
  })
  const output = `${result.stdout.toString()}${result.stderr.toString()}`
  if (result.exitCode !== 0) throw new Error(output)
  expect(output.match(/(\d+) fail\b/)?.[1], output).toBe("0")
  expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("1")
}, 300_000)

describe("拒绝条件", () => {
  const dataDir = "/data/opencode"
  const db = "/data/opencode/opencode.db"
  const exists = (present: string[]) => (path: string) => present.includes(path)

  test("没有 auth.json ⇒ 放行(不读库)", async () => {
    let read = false
    expect(await legacyCredentialImportRefusal({ dataDir, databasePath: db, exists: exists([]), readIds: async () => ((read = true), { ok: true, ids: [], legacy: false }) })).toBeUndefined()
    expect(read).toBe(false)
  })

  test("auth.json 在场、库里没有导入迁移(1.x 库)或库读不出 ⇒ 拒绝,原因点名文件与迁移", async () => {
    for (const read of [
      { ok: true as const, ids: ["20260720094009_permission-request-admission"], legacy: false },
      { ok: true as const, ids: [], legacy: true },
      { ok: false as const, kind: "error" as const, detail: "exit=14" },
      { ok: false as const, kind: "corrupt" as const, detail: "file is not a database" },
    ]) {
      const refusal = await legacyCredentialImportRefusal({ dataDir, databasePath: db, exists: exists([`${dataDir}/auth.json`]), readIds: async () => read })
      expect(refusal).toContain(`${dataDir}/auth.json`)
      expect(refusal).toContain(LEGACY_CREDENTIAL_IMPORT_MIGRATION)
    }
  })

  test("auth.json 在场但库还不存在 ⇒ 全新库走 schema bootstrap、不跑数据迁移,放行", async () => {
    expect(
      await legacyCredentialImportRefusal({
        dataDir,
        databasePath: db,
        exists: exists([`${dataDir}/auth.json`]),
        readIds: async () => ({ ok: false, kind: "missing", detail: "db file not found" }),
      }),
    ).toBeUndefined()
  })

  test("auth.json 在场但这个库上导入迁移已经跑过 ⇒ 不会再导入,放行", async () => {
    expect(
      await legacyCredentialImportRefusal({
        dataDir,
        databasePath: db,
        exists: exists([`${dataDir}/auth.json`]),
        readIds: async () => ({ ok: true, ids: [LEGACY_CREDENTIAL_IMPORT_MIGRATION], legacy: false }),
      }),
    ).toBeUndefined()
  })
})

describe("S7 同目录的其它 OpenCode 数据", () => {
  test("点名 auth.json 与别的渠道 / 分支的库,不点名这台引擎自己的库与它的 -wal / -shm,也不点名无关文件", () => {
    const names = ["opencode.db", "opencode.db-wal", "opencode-dev.db", "opencode-next.db", "auth.json", "mcp-auth.json", "log", "snapshot"]
    expect(foreignOpenCodeData("/d", "/d/opencode.db", () => names)).toEqual(["auth.json", "opencode-dev.db", "opencode-next.db"])
  })

  // 分类与「这处锚守不住什么」登记在 ./source-text-anchors.ts。
  test("ANCHOR (not a gate): server.ts 在 fork 之前(每种运行形态)调 legacyCredentialImportRefusal,拒绝即抛", () => {
    const source = readFileSync(join(import.meta.dir, "server.ts"), "utf8")
    const check = source.indexOf("const refusal = await legacyCredentialImportRefusal({ dataDir, databasePath })")
    const fork = source.indexOf("(options.fork ?? electronNs.utilityProcess.fork)(sidecar")
    expect(check).toBeGreaterThan(-1)
    expect(fork).toBeGreaterThan(check)
    expect(source).toContain("throw new Error(refusal)")
  })
})
