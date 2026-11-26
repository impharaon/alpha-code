import { expect, test } from "bun:test"

export function officialConnectorScenario(
  group: string,
  names: string[],
  spawn: (pattern: string) => ReturnType<typeof Bun.spawnSync>,
) {
  test.skipIf(process.platform !== "darwin")(
    `official connectors: ${group}`,
    () => {
      const pattern = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")
      const result = spawn(`^(?:${pattern})$`)
      const output = `${result.stdout.toString()}${result.stderr.toString()}`
      if (result.exitCode !== 0) throw new Error(output)
      expect(output).toMatch(new RegExp(`\\b${names.length} pass\\b`))
      expect(output).toMatch(/\b0 fail\b/)
    },
    180_000,
  )
}
