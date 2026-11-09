// Code Puppy authority registry judge (#1662 L4; coordinator instruction 2026-11-09). The registry
// (docs/architecture/codepuppy-authority-registry.json) lists every decision Code Puppy held before the OpenCode 2
// switch and how it is held now. This judge turns red when:
//   · a pre-switch takeover (the 49 paths `scripts/north-star-guard.sh --print-takeover` printed at the anchor
//     revision) maps to no entry;
//   · a held entry's mechanism file or one of its proof tests is missing, or the test name is not in that file;
//   · an entry is blocked (the decision is not re-held yet — the orchestrator must decide);
//   · an entry that existed when the registry was first committed is gone without a `retired` record carrying the
//     owner's words and a date.
// Each rule is first proven red on a synthetic registry, then applied to the real one.
import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const REPO = path.resolve(import.meta.dir, "../../../..")
const REGISTRY_REL = "docs/architecture/codepuppy-authority-registry.json"

interface Entry {
  readonly id: string
  readonly decision: string
  readonly takeovers?: readonly string[]
  readonly mechanism?: { readonly file: string; readonly ladder: string }
  readonly tests?: readonly { readonly file: string; readonly name: string }[]
  readonly retired?: { readonly quote: string; readonly date: string; readonly by: string }
  readonly blocked?: { readonly reason: string; readonly options: readonly string[] }
}
interface Registry {
  readonly anchor: { readonly takeoverListRevision: string }
  readonly entries: readonly Entry[]
}
interface World {
  readonly exists: (file: string) => boolean
  readonly read: (file: string) => string
  /** Takeover paths at the anchor revision. */
  readonly takeovers: readonly string[]
  /** Entry ids in the registry's first committed version. */
  readonly firstIds: readonly string[]
}

export function problems(registry: Registry, world: World): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of registry.entries) {
    if (seen.has(entry.id)) out.push(`duplicate id: ${entry.id}`)
    seen.add(entry.id)
    if (entry.retired) {
      if (!entry.retired.quote?.trim() || !entry.retired.by?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.retired.date ?? ""))
        out.push(`${entry.id}: retired without the owner's words, who and an ISO date`)
      continue
    }
    if (entry.blocked) {
      out.push(`${entry.id}: blocked — ${entry.blocked.reason}`)
      continue
    }
    if (!entry.mechanism?.file || !world.exists(entry.mechanism.file)) out.push(`${entry.id}: mechanism file missing (${entry.mechanism?.file ?? "none"})`)
    if (!entry.tests?.length) out.push(`${entry.id}: no proof test`)
    for (const proof of entry.tests ?? []) {
      if (!world.exists(proof.file)) out.push(`${entry.id}: test file missing (${proof.file})`)
      else if (!world.read(proof.file).includes(proof.name)) out.push(`${entry.id}: test not found in ${proof.file}: ${proof.name}`)
    }
  }
  const covered = new Set(registry.entries.flatMap((entry) => entry.takeovers ?? []))
  for (const takeover of world.takeovers) if (!covered.has(takeover)) out.push(`takeover not covered: ${takeover}`)
  for (const id of world.firstIds) if (!seen.has(id)) out.push(`entry deleted without a retired record: ${id}`)
  return out
}

function git(args: string[]) {
  const run = Bun.spawnSync(["git", ...args], { cwd: REPO })
  return { code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() }
}

function anchorTakeovers(revision: string): string[] {
  const guard = git(["show", `${revision}:scripts/north-star-guard.sh`])
  if (guard.code !== 0) throw new Error(`anchor revision ${revision} is not in this clone — measurement void, not a pass (${guard.err.trim()})`)
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "codepuppy-registry-")), "guard.sh")
  fs.writeFileSync(file, guard.out)
  const run = Bun.spawnSync(["bash", file, "--print-takeover"], { cwd: REPO })
  fs.rmSync(path.dirname(file), { recursive: true, force: true })
  if (run.exitCode !== 0) throw new Error(`anchor guard --print-takeover failed — measurement void: ${run.stderr.toString()}`)
  return run.stdout.toString().split("\n").filter(Boolean)
}

function firstCommittedIds(current: Registry): { ids: string[]; committed: boolean } {
  const log = git(["log", "--diff-filter=A", "--format=%H", "--", REGISTRY_REL])
  const first = log.out.trim().split("\n").filter(Boolean).at(-1)
  if (!first) return { ids: current.entries.map((entry) => entry.id), committed: false }
  const shown = git(["show", `${first}:${REGISTRY_REL}`])
  if (shown.code !== 0) throw new Error(`cannot read the first committed registry — measurement void: ${shown.err}`)
  return { ids: (JSON.parse(shown.out) as Registry).entries.map((entry) => entry.id), committed: true }
}

const realWorld = (registry: Registry): World => ({
  exists: (file) => fs.existsSync(path.join(REPO, file)),
  read: (file) => fs.readFileSync(path.join(REPO, file), "utf8"),
  takeovers: anchorTakeovers(registry.anchor.takeoverListRevision),
  firstIds: firstCommittedIds(registry).ids,
})

const REGISTRY = JSON.parse(fs.readFileSync(path.join(REPO, REGISTRY_REL), "utf8")) as Registry

describe("authority registry judge", () => {
  const files: Record<string, string> = { "mech.ts": "export {}", "proof.test.ts": 'test("holds the decision", () => {})' }
  const world = (over: Partial<World> = {}): World => ({
    exists: (file) => file in files,
    read: (file) => files[file] ?? "",
    takeovers: ["packages/x/taken.ts"],
    firstIds: ["held"],
    ...over,
  })
  const held: Entry = {
    id: "held",
    decision: "d",
    takeovers: ["packages/x/taken.ts"],
    mechanism: { file: "mech.ts", ladder: "L0" },
    tests: [{ file: "proof.test.ts", name: "holds the decision" }],
  }
  const registry = (entries: Entry[]): Registry => ({ anchor: { takeoverListRevision: "x" }, entries })

  test("the judge is not empty: every rule turns a synthetic registry red, and a clean one passes", () => {
    expect(problems(registry([held]), world())).toEqual([])
    expect(problems(registry([{ ...held, mechanism: { file: "gone.ts", ladder: "L0" } }]), world()).join("\n")).toContain("mechanism file missing")
    expect(problems(registry([{ ...held, tests: [{ file: "proof.test.ts", name: "renamed" }] }]), world()).join("\n")).toContain("test not found")
    expect(problems(registry([{ ...held, takeovers: [] }]), world()).join("\n")).toContain("takeover not covered: packages/x/taken.ts")
    expect(problems(registry([{ ...held, blocked: { reason: "no seam", options: [] } }]), world()).join("\n")).toContain("held: blocked")
    expect(problems(registry([{ ...held, retired: { quote: "", date: "2026-11-09", by: "owner" } }]), world()).join("\n")).toContain("retired without")
    expect(problems(registry([{ ...held, retired: { quote: "不要了", date: "2026-11-09", by: "owner" } }]), world())).toEqual([])
    expect(problems(registry([held, held]), world()).join("\n")).toContain("duplicate id")
  })

  test("deleting an entry is red unless it is retired with the owner's words", () => {
    const other: Entry = { ...held, id: "other", takeovers: [] }
    const before = world({ firstIds: ["held", "other"] })
    expect(problems(registry([held, other]), before)).toEqual([])
    expect(problems(registry([held]), before).join("\n")).toContain("entry deleted without a retired record: other")
  })

  test("the anchor is the real pre-switch list: 49 takeovers at the anchor revision", () => {
    const takeovers = anchorTakeovers(REGISTRY.anchor.takeoverListRevision)
    expect(takeovers).toHaveLength(49)
    expect(takeovers).toContain("packages/opencode/src/session/tools.ts")
  })

  test("deleting a real entry turns the real registry red", () => {
    const world = realWorld(REGISTRY)
    const victim = REGISTRY.entries.find((entry) => entry.id === "tool-policy-execution-gate")!
    const trimmed = { ...REGISTRY, entries: REGISTRY.entries.filter((entry) => entry !== victim) }
    const found = problems(trimmed, { ...world, firstIds: [...new Set([...world.firstIds, victim.id])] })
    expect(found.join("\n")).toContain(`entry deleted without a retired record: ${victim.id}`)
    expect(found.join("\n")).toContain("takeover not covered: packages/opencode/src/session/tools.ts")
  })

  test("the production registry: every pre-switch decision is held, retired by the owner, or this is red", () => {
    const found = problems(REGISTRY, realWorld(REGISTRY))
    expect(found, `Code Puppy authority not fully re-held on OpenCode 2:\n${found.join("\n")}`).toEqual([])
  })
})
