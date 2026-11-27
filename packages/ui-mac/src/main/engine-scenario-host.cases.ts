// Scenario hosts keep each mock/global-mutating cases file in its own child process.
import { expect, test } from "bun:test"

type Host = { title: string; cases: string; pass: number; args?: string[]; cwd?: string; timeout: number }

export function engineScenario(host: Host, spawn: () => Bun.Subprocess<"ignore", "pipe", "pipe">) {
  test.each([host])(
    "$title",
    async ({ pass, timeout }) => {
      const child = spawn()
      const guard = setTimeout(() => child.kill(), timeout)
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      clearTimeout(guard)
      const output = `${stdout}${stderr}`
      expect(exitCode, output).toBe(0)
      expect(output.match(/^\s*(\d+) fail$/m)?.[1], output).toBe("0")
      expect(output.match(/^\s*(\d+) pass$/m)?.[1], output).toBe(String(pass))
      expect(output.match(/Ran \d+ tests? across (\d+) files?/)?.[1], output).toBe("1")
    },
    660_000,
  )
}
