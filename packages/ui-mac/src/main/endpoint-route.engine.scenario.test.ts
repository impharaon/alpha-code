import { expect, test } from "bun:test"
import { join } from "node:path"

test("E1–E6 live-engine relay proofs run in six owned child processes", async () => {
  for (const name of ["E1", "E2", "E3", "E4", "E5", "E6"]) {
    const child = Bun.spawn([process.execPath, "test", "--max-concurrency", "2", "--test-name-pattern", `^${name} `, join(import.meta.dir, "endpoint-route.engine.cases.ts")], { cwd: join(import.meta.dir, "../.."), env: process.env, stdout: "pipe", stderr: "pipe" })
    const guard = setTimeout(() => child.kill(), name === "E4" ? 165_000 : name === "E1" ? 110_000 : 40_000)
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    clearTimeout(guard)
    const output = stdout + stderr
    expect(code, `${name}\n${output}`).toBe(0)
    expect(output).toContain("1 pass")
    expect(output).toContain("0 fail")
    for (const line of output.split("\n").filter((line) => line.startsWith("RELAY_EVIDENCE "))) console.log(line)
  }
}, 450_000)
