// Fast layer: the runner role decides which commands receive the launcher's preparation and environment (design §4.3).
import { expect, test } from "bun:test"
import { connectorPackageRunner } from "./codepuppy-command-head.js"

test("only uvx / uv tool run and npx / npm exec are package runners; native commands keep their own role", () => {
  expect(connectorPackageRunner(["uvx", "mcp-server-git@2026.6.16", "--repository", "/w"])).toBe("uv-tool")
  expect(connectorPackageRunner(["/opt/homebrew/bin/uv", "--offline", "tool", "run", "markitdown-mcp"])).toBe("uv-tool")
  expect(connectorPackageRunner(["npx", "-y", "@playwright/mcp@0.0.77"])).toBe("npm-exec")
  expect(connectorPackageRunner(["npm", "exec", "--yes", "pkg"])).toBe("npm-exec")
  expect(connectorPackageRunner(["npm", "--yes", "x", "pkg"])).toBe("npm-exec")
  expect(connectorPackageRunner(["C:\\Tools\\NPX.CMD", "-y", "pkg"], "win32")).toBe("npm-exec")
  expect(connectorPackageRunner(["C:\\uv\\uvx.exe", "pkg"], "win32")).toBe("uv-tool")
  for (const native of [["uv", "run", "server.py"], ["uv", "--", "tool", "run", "x"], ["npm", "run", "x"], ["node", "server.js"], ["python3", "-m", "tool"], ["/usr/local/bin/uvx-helper"], [], [42]])
    expect(connectorPackageRunner(native)).toBeUndefined()
})

// Integration layer: npm's own config parser is the oracle for where the subcommand starts.
test("npm options that take a value never stand in for the subcommand", async () => {
  // @ts-expect-error npm does not publish types for this internal config API.
  const { default: Config } = await import("@npmcli/config")
  // @ts-expect-error npm does not publish types for this internal config API.
  const { default: npm } = await import("@npmcli/config/lib/definitions/index.js")
  const official = async (args: string[]) => {
    const config = new Config({ ...npm, npmPath: import.meta.dir, cwd: import.meta.dir, env: {}, argv: [process.execPath, "npm", ...args], execPath: process.execPath, platform: process.platform, warn: false })
    await config.load()
    return config.parsedArgv.remain[0] as string | undefined
  }
  const cases = [
    ["--registry", "https://registry.npmjs.org", "exec", "--yes", "@playwright/mcp"],
    ["--loglevel", "warn", "x", "pkg"],
    ["--cache", "/tmp/npm-cache", "--yes", "exec", "pkg"],
    ["--registry=https://registry.npmjs.org", "exec", "pkg"],
    ["--yes", "true", "exec", "pkg"],
    ["-c", "echo", "exec"],
    ["--userconfig", "exec", "run", "x"],
    ["--prefix", "/w", "run", "start"],
  ]
  for (const args of cases) {
    const subcommand = await official(args)
    expect({ args, runner: connectorPackageRunner(["npm", ...args]) }).toEqual({ args, runner: subcommand === "exec" || subcommand === "x" ? "npm-exec" : undefined })
  }
  expect(connectorPackageRunner(["npm", "--registry", "https://registry.npmjs.org", "exec", "--yes", "@playwright/mcp"])).toBe("npm-exec")
})
