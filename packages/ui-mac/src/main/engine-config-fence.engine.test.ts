// SPEC-engine-config-fence AC-04 (without tool policy) / AC-06; DESIGN E3 / E5 / E8. Host for engine-config-fence.engine.cases.ts: the fence is
// process-lifetime, so each arm is its own `bun test` child (production, fresh, control, noprecreate). After the production arm this host —
// outside every fence — reads the system sandbox log for the run window: the engine process (the cases process: the engine is embedded in
// it) must have zero write denials on protected locations, while the attack commands (its fenced children) must have some — that is the
// calibration that the log was read at all (no log ⇒ red, never «zero»). Run-local state lives under the worktree's node_modules/.cache.
import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

type Deny = { kind: "subpath" | "literal" | "regex"; value: string }
const ARMS = { production: 4, fresh: 1, control: 1, noprecreate: 1 } as const

/** `log show --start/--end` with an explicit offset (bun test runs with TZ=UTC, the log tool reads wall-clock time in its own zone). */
const stamp = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}+0000`
}

const inProtected = (deny: readonly Deny[], path: string) =>
  deny.some((rule) => (rule.kind === "subpath" ? path === rule.value || path.startsWith(`${rule.value}/`) : rule.kind === "literal" ? path === rule.value : new RegExp(rule.value).test(path)))

test.skipIf(process.platform !== "darwin")("AC-04 / AC-06 real engine inside the production fence: attacks refused, ordinary work and restart fine, cold start on 0.2.6 data and a fresh machine; known-bad arms flip; no protected-location denial from the engine process", async () => {
  const base = resolve(import.meta.dir, "../../../../node_modules/.cache/engine-config-fence")
  rmSync(base, { recursive: true, force: true })
  mkdirSync(join(base, "results"), { recursive: true })
  const outputs: Record<string, string> = {}
  let window: { from: Date; to: Date } | undefined
  try {
    for (const [arm, expected] of Object.entries(ARMS)) {
      const from = new Date(Date.now() - 1_000)
      const child = Bun.spawn({
        cmd: [process.execPath, "test", "--timeout", "240000", join(import.meta.dir, "engine-config-fence.engine.cases.ts")],
        cwd: join(import.meta.dir, "../.."),
        env: { ...process.env, CODEPUPPY_CF_ENGINE_ARM: arm, CODEPUPPY_CF_ENGINE_ROOT: join(base, "run") },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      const output = `${stdout}${stderr}`
      outputs[arm] = output
      writeFileSync(join(base, "results", `${arm}.log`), output.slice(-200_000))
      expect([arm, code], output.slice(-20_000)).toEqual([arm, 0])
      expect([arm, output.match(/(\d+) pass\b/)?.[1]], output.slice(-20_000)).toEqual([arm, String(expected)])
      expect([arm, output.match(/(\d+) fail\b/)?.[1]], output.slice(-20_000)).toEqual([arm, "0"])
      if (arm === "production") window = { from, to: new Date(Date.now() + 1_000) }
    }

    // E5: the system sandbox log for the production run
    const meta = JSON.parse(outputs.production!.match(/^CF-ENGINE (\{.*\})$/m)![1]!) as { pid: number; deny: Deny[]; sandboxRoot: string }
    // the kernel's reports reach the log store asynchronously: read until the calibration entries are there (bounded), then judge that read
    let denials: Array<{ process: string; pid: number; operation: string; path: string }> = []
    for (let attempt = 0; attempt < 10; attempt++) {
      await Bun.sleep(3_000)
      const shown = spawnSync("log", ["show", "--start", stamp(window!.from), "--end", stamp(window!.to), "--style", "compact", "--predicate", 'eventMessage CONTAINS "deny(1) file-write"'], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
      expect(shown.status, shown.stderr).toBe(0)
      writeFileSync(join(base, "results", "log-show.txt"), `${stamp(window!.from)} → ${stamp(window!.to)}\n${shown.stdout}`)
      denials = shown.stdout
        .split("\n")
        .flatMap((line) => {
          const match = /Sandbox: (\S+)\((\d+)\) deny\(1\) (file-write[\w-]*) (\/.*)$/.exec(line)
          return match ? [{ process: match[1]!, pid: Number(match[2]), operation: match[3]!, path: match[4]!.trim() }] : []
        })
        .filter((denial) => inProtected(meta.deny, denial.path))
      if (denials.some((denial) => denial.pid !== meta.pid)) break
    }
    const fromEngine = denials.filter((denial) => denial.pid === meta.pid)
    const fromChildren = denials.filter((denial) => denial.pid !== meta.pid)
    writeFileSync(join(base, "results", "sandbox-denials.json"), JSON.stringify({ window, enginePid: meta.pid, fromEngine, fromChildren }, null, 1))
    console.log(`[E5] engine pid ${meta.pid}: ${fromEngine.length} protected-location write denials; its fenced children (the attacks): ${fromChildren.length}`)
    expect(fromChildren.length, "calibration: the attack commands' denials must be in the log, or the log was not read").toBeGreaterThan(0)
    expect(fromEngine).toEqual([])
  } finally {
    rmSync(join(base, "run"), { recursive: true, force: true })
  }
}, 1_500_000)
