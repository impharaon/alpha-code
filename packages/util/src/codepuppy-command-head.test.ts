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
