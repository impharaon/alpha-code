// SPEC-engine-config-fence AC-04 / AC-05 / AC-06 / AC-08 ③; DESIGN E3 / E5 / E6 / E8 / E11. Host for engine-config-fence.engine.cases.ts: the fence is
// process-lifetime, so each arm is its own `bun test` child (production, fresh, control, noprecreate). After the production arm this host —
// outside every fence — judges the system sandbox log for the run window: the engine process (the cases process: the engine is embedded in
// it) must have zero write denials on protected locations, while the attack commands (its fenced children) must have some — that is the
// calibration that the log was read at all (no log ⇒ red, never «zero»). The log is captured live with `log stream` while the production arm
// runs (test-component/sandbox-denial-stream.ts: attached and drained by marker refusals, either missing ⇒ red), not read back from the saved
// log afterwards — that has retention limits and on 2026-11-24 this machine's logd kept no kernel messages at all. The production window ends where its last test prints
// `CF-ENGINE-WINDOW-END` (片 ③): after that the conversation's write tool — which runs inside the engine process — attacks the tool policy
// document on purpose, and the host checks that this denial from the engine pid is in the log (the reading sees engine-pid denials at all).
// Under load the kernel can lose one sandbox report without trace (nightly 2026-11-25: refused with EPERM, nothing from the engine pid in a
// live, loss-free stream), so the cases attack again — each time a new name beside the document, about once a second, bounded — until this
// host acknowledges that an engine-pid refusal has come through; none through ⇒ the calibration is red, as before.
// Run-local state lives under the worktree's node_modules/.cache.
import { expect, test } from "bun:test"
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { startSandboxDenialStream, type StreamedLogEvent } from "../../test-component/sandbox-denial-stream"

type Deny = { kind: "subpath" | "literal" | "regex"; value: string }
type Meta = { pid: number; deny: Deny[]; sandboxRoot: string }
const ARMS = { production: 5, fresh: 2, control: 2, noprecreate: 1 } as const

const inProtected = (deny: readonly Deny[], path: string) =>
  deny.some((rule) => (rule.kind === "subpath" ? path === rule.value || path.startsWith(`${rule.value}/`) : rule.kind === "literal" ? path === rule.value : new RegExp(rule.value).test(path)))
const policyRulesOf = (deny: readonly Deny[]) => deny.filter((rule) => rule.kind === "subpath" && rule.value.endsWith("/codepuppy-tool-policy"))
/** The kernel's sandbox write refusals among `events` within `range` (open-ended without `to`). */
const denialsIn = (events: readonly StreamedLogEvent[], range: { from: Date; to?: Date }) =>
  events
    .filter((event) => event.timestamp >= range.from.getTime() && event.timestamp <= (range.to?.getTime() ?? Infinity))
    .flatMap((event) => {
      const match = /Sandbox: (\S+)\((\d+)\) deny\(1\) (file-write[\w-]*) (\/.*)$/.exec(event.message)
      return match ? [{ process: match[1]!, pid: Number(match[2]), operation: match[3]!, path: match[4]!.trim() }] : []
    })
/** 片 ③: the engine pid's write denials on the tool policy directory after the judged window (the write-tool attack). Read from complete
 *  output lines, so the host can also ask while the production arm runs: none until the arm has printed its pid and its window end. */
const engineDenialsAfterWindow = (output: string, events: readonly StreamedLogEvent[]) => {
  const meta = output.match(/^CF-ENGINE (\{.*\})\n/m)?.[1]
  const end = output.match(/^CF-ENGINE-WINDOW-END (\S+)\n/m)?.[1]
  if (!meta || !end) return []
  const { pid, deny } = JSON.parse(meta) as Meta
  return denialsIn(events, { from: new Date(Date.parse(end) + 1_000) }).filter((denial) => denial.pid === pid && inProtected(policyRulesOf(deny), denial.path))
}

// The test name is a registered literal (docs/architecture/codepuppy-authority-registry.json, plan-directory-in-engine-data): it stays as it
// was; 片 ③ (AC-05 and the tool policy rows of AC-04) lives in the production and control arms it runs.
test.skipIf(process.platform !== "darwin")("AC-04 / AC-06 / AC-08 real engine inside the production fence: attacks refused, ordinary work and restart fine, cold start on 0.2.6 data and a fresh machine, the plan file under the engine data directory with ~/.opencode never created; known-bad arms flip; no protected-location denial from the engine process", async () => {
  const base = resolve(import.meta.dir, "../../../../node_modules/.cache/engine-config-fence")
  rmSync(base, { recursive: true, force: true })
  mkdirSync(join(base, "results"), { recursive: true })
  const acknowledgement = join(base, "a3-engine-denial-seen")
  const outputs: Record<string, string> = {}
  let window: { from: Date; to: Date } | undefined
  let stream: Awaited<ReturnType<typeof startSandboxDenialStream>> | undefined
  let streamed: StreamedLogEvent[] = []
  try {
    for (const [arm, expected] of Object.entries(ARMS)) {
      // E5: the production arm's sandbox refusals, captured live (attached before the arm starts)
      if (arm === "production") stream = await startSandboxDenialStream({ predicate: 'eventMessage CONTAINS "deny(1) file-write"', markerRoot: join(base, "stream-markers") })
      const from = new Date(Date.now() - 1_000)
      const child = Bun.spawn({
        cmd: [process.execPath, "test", "--timeout", "240000", join(import.meta.dir, "engine-config-fence.engine.cases.ts")],
        cwd: join(import.meta.dir, "../.."),
        env: { ...process.env, CODEPUPPY_CF_ENGINE_ARM: arm, CODEPUPPY_CF_ENGINE_ROOT: join(base, "run"), CODEPUPPY_CF_ENGINE_A3_SEEN: acknowledgement },
        stdout: "pipe",
        stderr: "pipe",
      })
      let stdout = ""
      const reading = (async () => {
        const decoder = new TextDecoder()
        for await (const chunk of child.stdout) stdout += decoder.decode(chunk, { stream: true })
        stdout += decoder.decode()
      })()
      // 片 ③: the cases repeat the write-tool attack until this file exists — the same judgment as below, made on what has come through so far
      const acknowledging: ReturnType<typeof setInterval> | undefined =
        arm === "production"
          ? setInterval(() => {
              if (!engineDenialsAfterWindow(stdout, stream!.received()).length) return
              writeFileSync(acknowledgement, "")
              clearInterval(acknowledging)
            }, 100)
          : undefined
      const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited, reading])
      clearInterval(acknowledging)
      if (arm === "production") streamed = await stream!.stop() // drained before anything is judged
      const output = `${stdout}${stderr}`
      outputs[arm] = output
      writeFileSync(join(base, "results", `${arm}.log`), output.slice(-200_000))
      expect([arm, code], output.slice(-20_000)).toEqual([arm, 0])
      expect([arm, output.match(/(\d+) pass\b/)?.[1]], output.slice(-20_000)).toEqual([arm, String(expected)])
      expect([arm, output.match(/(\d+) fail\b/)?.[1]], output.slice(-20_000)).toEqual([arm, "0"])
      if (arm === "production") {
        const end = output.match(/^CF-ENGINE-WINDOW-END (\S+)$/m)?.[1]
        expect(end, "the production arm prints where the judged window ends").toBeDefined()
        // one second past the marker (the old whole-second `log show` bound, kept) still ends before the write tool (the cases wait 3 s after it)
        window = { from, to: new Date(Date.parse(end!) + 1_000) }
      }
    }

    // E5: the system sandbox log for the production run (streamed, drained above)
    const meta = JSON.parse(outputs.production!.match(/^CF-ENGINE (\{.*\})$/m)![1]!) as Meta
    // 片 ③:the window's last denial is the conversation's last shell command — a new document BESIDE the policy file (cases
    // shellPolicyAttacks prints its name); it must be among the captured refusals, not merely any denial in the tool policy directory,
    // because the fenced direct-write child (E6 known bad) writes there earlier (审查 R1 Minor). Everything judged in the window — the
    // settings-page writes through main, the direct write, the shell attacks — comes before it.
    const policyRules = policyRulesOf(meta.deny)
    expect(policyRules).toHaveLength(1)
    const besideName = outputs.production!.match(/^CF-ENGINE-A3-BESIDE (\S+)$/m)?.[1]
    expect(besideName, "the production arm prints the name of its last shell attack's target").toBeDefined()
    const besideTarget = join(policyRules[0]!.value, besideName!)
    const lastInWindow = (denial: { pid: number; path: string }) => denial.pid !== meta.pid && denial.path === besideTarget
    writeFileSync(join(base, "results", "log-stream.json"), JSON.stringify(streamed, null, 1))
    const denials = denialsIn(streamed, window!).filter((denial) => inProtected(meta.deny, denial.path))
    const fromEngine = denials.filter((denial) => denial.pid === meta.pid)
    const fromChildren = denials.filter((denial) => denial.pid !== meta.pid)
    writeFileSync(join(base, "results", "sandbox-denials.json"), JSON.stringify({ window, enginePid: meta.pid, fromEngine, fromChildren }, null, 1))
    console.log(`[E5] engine pid ${meta.pid}: ${fromEngine.length} protected-location write denials; its fenced children (the attacks): ${fromChildren.length}`)
    expect(fromChildren.length, "calibration: the attack commands' denials must be in the log, or the log was not read").toBeGreaterThan(0)
    expect(fromChildren.some(lastInWindow), `calibration: the window's last denial (the shell attack creating ${besideTarget}) must be in the log`).toBe(true)
    expect(fromEngine).toEqual([])

    // 片 ③:after the window end the write tool (inside the engine process) attacked the tool policy directory — that denial from the
    // engine pid must be in the log, or «zero from the engine» above could not have failed (the cases attacked until this was seen, bounded)
    const fromEngineAfter = engineDenialsAfterWindow(outputs.production!, streamed)
    writeFileSync(join(base, "results", "sandbox-denials-after-window.json"), JSON.stringify({ after: window!.to, enginePid: meta.pid, fromEngineAfter }, null, 1))
    console.log(`[A3] after the window: engine pid ${meta.pid} has ${fromEngineAfter.length} write denial(s) on the tool policy directory (the write tool)`)
    expect(fromEngineAfter.length, "calibration: the engine pid's own denial (the write-tool attack) must be readable").toBeGreaterThan(0)
  } finally {
    stream?.kill()
    rmSync(join(base, "run"), { recursive: true, force: true })
  }
}, 1_500_000)
