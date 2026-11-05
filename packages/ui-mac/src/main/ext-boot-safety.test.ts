import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import fixture from "./fixtures/catalog-boot-0.1.24.json"
import { BUILTIN_CATALOG_PUBKEY_B64, CHANNEL_BASE_URL } from "./catalog-channels"
import { refreshRemoteCatalog } from "./remote-catalog"
import { readSessionGrantIdsSync } from "./ext-curation-policy"
import { reconcileDesiredStateAtBoot } from "./ext-install-planner"
import { findRecordV2, skillsEnabledPath, upsertRecordV2 } from "./ext-receipt-v2"
import { tryAcquireBundleLock } from "./ext-bundle-lock"
import { resolveBootExtensionSafety } from "./ext-boot-safety"

let root: string
const routes: Record<string, string> = fixture.routes
const target = JSON.parse(routes[`${CHANNEL_BASE_URL}/channels/stable.json`]!).target
// Entries/config commands come from the exact public signed response recorded in the fixture.
const catalog = JSON.parse(routes[target.url]!) as { entries: { id: string; name: string; installSpec: { command?: string[] } }[] }
const record = (name: string) => {
  const entry = catalog.entries.find((entry) => entry.name === name)!
  expect(upsertRecordV2(root, {
    id: entry.id, kind: "mcp", name, configKey: `mcp.${name}`, environment: "prod",
    scope: { kind: "global" }, origin: "catalog", desiredState: "enabled", installedAt: "2026-11-04T00:00:00Z",
  }).ok).toBe(true)
  return { type: "local", command: entry.installSpec.command }
}
const reconcile = () => reconcileDesiredStateAtBoot(root, { userDataPath: root, channel: "stable" })
const logs: Array<{ message: string; detail?: Record<string, unknown> }> = []
const warn = (message: string, detail?: Record<string, unknown>) => { logs.push({ message, detail }) }
const refresh = (fetchImpl = (async (url) => new Response(routes[String(url)] ?? "", { status: routes[String(url)] ? 200 : 404 })) as typeof fetch) =>
  refreshRemoteCatalog(root, "stable", { fetchImpl, builtinKeyB64: BUILTIN_CATALOG_PUBKEY_B64, now: () => Date.parse("2026-11-05T05:00:00Z") })
const networkMessage = "Code Puppy 要先取一次扩展目录,才能确认已启用的扩展是安全的。请联网后重新打开。"
const oldMessage = "扩展配置或历史桥接状态无法确认已经安全收敛(可能因磁盘空间、权限或配置文件损坏)。为避免旧桥或本应关闭的扩展被意外加载,已暂停启动。请检查磁盘与目录权限后重新打开应用;若持续出现,请联系支持并附上日志。"

beforeEach(() => {
  logs.length = 0
  root = mkdtempSync(join(tmpdir(), "boot-catalog-"))
  writeFileSync(join(root, "catalog-channel-state.json"), JSON.stringify(fixture.legacy))
  writeFileSync(join(root, "codepuppy.jsonc"), JSON.stringify({ mcp: { "codepuppy-word": record("codepuppy-word") } }))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

test("AC1: 0.1.24 unknown catalog refreshes once through full verification and boot proceeds without a dialog", async () => {
  expect(readSessionGrantIdsSync(root, "stable").ok).toBe(false)
  const initial = reconcile()
  expect(initial.curationUnknown).toBe(true)
  expect(initial.enforcementGap).toHaveLength(1)
  let calls = 0
  const result = await resolveBootExtensionSafety(initial, { refresh: () => { calls++; return refresh() }, reconcile, warn })
  expect(result).toBeNull()
  expect(calls).toBe(1)
  expect(readSessionGrantIdsSync(root, "stable").ok).toBe(true)
  expect(findRecordV2(root, "mcp", "codepuppy-word")?.desiredState).toBe("enabled")
  expect(logs.at(-1)?.detail?.result).toBe("completed")
  expect(logs.at(-1)?.detail).not.toHaveProperty("error")
  expect(logs.at(-1)?.detail).not.toHaveProperty("reasonClass")
})

test("AC2: 0.1.24 plus network failure remains closed with the network dialog", async () => {
  const result = await resolveBootExtensionSafety(reconcile(), {
    refresh: () => refresh((async () => { throw new Error("offline") }) as typeof fetch), reconcile, warn,
  })
  expect(readSessionGrantIdsSync(root, "stable").ok).toBe(false)
  expect(result?.title).toBe("需要联网确认扩展安全")
  expect(result?.message).toBe(networkMessage)
  expect(result?.gap).toHaveLength(1)
  expect(logs.at(-1)?.detail).toMatchObject({ result: "failed", reasonClass: "security" })
  expect(logs.at(-1)?.detail?.error).toContain("offline")
  // Exercise rejected refreshes too; use the real target URL with test-only credentials appended.
  await resolveBootExtensionSafety(reconcile(), {
    refresh: () => Promise.reject(new Error(`fetch failed: bearer TEST-ONLY-TOKEN ${target.url}?signature=TEST-ONLY-QUERY`)), reconcile, warn,
  })
  expect(logs.at(-1)?.detail).toMatchObject({ result: "failed", reasonClass: "unknown" })
  expect(logs.at(-1)?.detail?.error).toContain("fetch failed")
  expect(logs.at(-1)?.detail?.error).not.toContain("TEST-ONLY-TOKEN")
  expect(logs.at(-1)?.detail?.error).not.toContain("signature=")
  expect(logs.at(-1)?.detail?.error).not.toContain("TEST-ONLY-QUERY")
})

test("AC2: a tampered remote payload cannot make the real boot oracle pass", async () => {
  const result = await resolveBootExtensionSafety(reconcile(), {
    refresh: () => refresh((async (url) => new Response(routes[String(url)] + (String(url) === target.url ? " " : ""))) as typeof fetch),
    reconcile, warn,
  })
  expect(readSessionGrantIdsSync(root, "stable").ok).toBe(false)
  expect(result?.message).toBe(networkMessage)
  expect(logs.at(-1)?.detail).toMatchObject({ result: "failed", reasonClass: "security" })
  expect(logs.at(-1)?.detail?.error).toContain("MISMATCH")
})

test("AC3: 15-second timeout keeps the event loop responsive and returns the AC2 dialog", async () => {
  let finish!: (value: Awaited<ReturnType<typeof refresh>>) => void
  const pending = new Promise<Awaited<ReturnType<typeof refresh>>>((resolve) => { finish = resolve })
  let ticks = 0
  let reconciled = false
  const timer = setInterval(() => ticks++, 25)
  const started = performance.now()
  try {
    const result = await resolveBootExtensionSafety(reconcile(), {
      refresh: () => pending, reconcile: () => { reconciled = true; return reconcile() }, warn,
    })
    const elapsed = performance.now() - started
    console.log(`[1632] real timeout wait: ${Math.round(elapsed)}ms; event loop ticks: ${ticks}`)
    expect(elapsed).toBeGreaterThanOrEqual(14_900)
    expect(elapsed).toBeLessThan(16_500)
    expect(ticks).toBeGreaterThan(100)
    expect(reconciled).toBe(false)
    expect(result?.title).toBe("需要联网确认扩展安全")
    expect(result?.message).toBe(networkMessage)
    expect(logs.at(-1)?.detail?.result).toBe("timeout")
    expect(logs.at(-1)?.detail).not.toHaveProperty("error")
    expect(logs.at(-1)?.detail).not.toHaveProperty("reasonClass")
    finish(await refresh())
    expect((await pending).source).toBe("remote")
  } finally { clearInterval(timer) }
}, 17_000)

test("AC2: another gap including danglingBoot skips refresh and preserves the original refusal", async () => {
  const initial = reconcile()
  const held = tryAcquireBundleLock(root, { txId: "initial-lock-gap" })
  if (!held.ok) throw new Error(held.reason)
  try {
    for (const state of [reconcile(), { ...initial, enforcementGap: [...initial.enforcementGap!, "danglingBoot enforcement gap"] }]) {
      const result = await resolveBootExtensionSafety(state, {
        refresh: () => { throw new Error("must not refresh") }, reconcile: () => { throw new Error("must not reconcile") }, warn,
      })
      expect(result?.title).toBe("扩展安全状态无法确保")
      expect(result?.message).toBe(oldMessage)
      expect(result?.gap).toEqual(state.enforcementGap)
    }
  } finally { held.lock.release() }
})

test("AC2: lock busy during rejudgment is another gap and uses the original refusal", async () => {
  const initial = reconcile()
  const held = tryAcquireBundleLock(root, { txId: "concurrent-config-writer" })
  if (!held.ok) throw new Error(held.reason)
  try {
    const result = await resolveBootExtensionSafety(initial, { refresh, reconcile, warn })
    expect(result?.title).toBe("扩展安全状态无法确保")
    expect(result?.message).toBe(oldMessage)
    expect(result?.gap[0]).toContain("bundle lock unavailable")
  } finally { held.lock.release() }
})

test("AC1: verified session-grant enforcement is idempotent across two real reconciliations", async () => {
  expect((await refresh()).source).toBe("remote")
  writeFileSync(join(root, "codepuppy.jsonc"), JSON.stringify({ mcp: { "chrome-devtools": record("chrome-devtools") } }))
  const first = reconcile()
  expect(first.enforcementGap).toBeUndefined()
  expect(first.applied).toContain("mcp:chrome-devtools→disabled")
  expect(findRecordV2(root, "mcp", "chrome-devtools")?.desiredState).toBe("disabled")
  const files = [join(root, "installs.json"), join(root, "codepuppy.jsonc"), skillsEnabledPath(root)]
  const before = files.map((file) => readFileSync(file, "utf8"))
  const second = reconcile()
  expect(second.enforcementGap).toBeUndefined()
  expect(second.applied).toEqual([])
  expect(second.warnings.some((warning) => warning.includes("forced disabled"))).toBe(false)
  expect(files.map((file) => readFileSync(file, "utf8"))).toEqual(before)
})
