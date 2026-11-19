import { expect, test } from "bun:test"
import fs from "node:fs"
import { join } from "node:path"

test.skipIf(process.platform !== "darwin")("generated profile protects the route file from the real engine tree", async () => {
  const child = Bun.spawn([process.execPath, "test", "--max-concurrency", "2", "--timeout", "120000", join(import.meta.dir, "endpoint-route-fence.engine.cases.ts")], {
    cwd: join(import.meta.dir, "../.."), env: process.env, stdout: "pipe", stderr: "pipe",
    ipc(message, subprocess) {
      const input = message as { type?: string; file?: string }
      if (input.type !== "route-direct" || !input.file?.startsWith(process.env.TMPDIR!)) return
      // This host is the unfenced main-process side. The engine child never acquires this write.
      fs.writeFileSync(`${input.file}.parent`, "direct", { mode: 0o600 })
      fs.renameSync(`${input.file}.parent`, input.file)
      subprocess.send({ type: "route-updated" })
    },
  })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  const output = stdout + stderr
  expect(code, output).toBe(0)
  expect(output).toContain("1 pass")
  expect(output).toContain("0 fail")
}, 180_000)
