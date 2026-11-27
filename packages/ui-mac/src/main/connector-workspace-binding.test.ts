import { afterEach, beforeEach, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { persistMcp, readMcpLeafStrict } from "./ext-config"
import { bindConnectorWorkspace } from "./connector-workspace-binding"
import type { ReloadRequestInput } from "./reload-coordinator"

const keys = ["OPENCODE_CONFIG_DIR", "CODEPUPPY_OPENCODE_HOME", "CODEPUPPY_GLOBAL_DIR"] as const
let previous: Record<string, string | undefined> = {}
let root = ""
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "connector-workspace-"))
  previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  process.env.OPENCODE_CONFIG_DIR = path.join(root, "xdg")
  process.env.CODEPUPPY_OPENCODE_HOME = path.join(root, "home")
  process.env.CODEPUPPY_GLOBAL_DIR = path.join(root, "alpha")
})
afterEach(() => {
  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key]
    else process.env[key] = previous[key]
  }
  fs.rmSync(root, { recursive: true, force: true })
})

// Integration layer: the real config writer and strict leaf reader on an isolated global root.
test("R8 chosen folder replaces an explicit connector cwd through the existing writer and reloads", () => {
  const original = { type: "local", command: ["uvx", "git-mcp", "--repository", "."], environment: { GIT_MODE: "read" }, cwd: path.join(root, "missing-repository") }
  expect(persistMcp("git-tools", original).ok).toBe(true)
  const reloads: ReloadRequestInput[] = []
  const folder = path.join(root, "chosen")
  expect(bindConnectorWorkspace({ server: "git-tools", folder }, (request) => reloads.push(request))).toEqual({ kind: "cwd" })
  expect(readMcpLeafStrict("git-tools")).toEqual({ ok: true, value: { ...original, cwd: folder } })
  expect(reloads).toEqual([{ scope: "global", items: [{ id: "mcp:git-tools", scope: "global" }], reason: "connector git-tools working directory changed" }])
})

test("R8 a declaration without an explicit cwd follows the chosen Location and writes nothing", () => {
  const templated = { type: "local", command: ["uvx", "files-mcp", "{workspace}"] }
  expect(persistMcp("files", templated).ok).toBe(true)
  expect(persistMcp("workspace-cwd", { ...templated, cwd: "{workspace}" }).ok).toBe(true)
  const reloads: ReloadRequestInput[] = []
  for (const server of ["files", "workspace-cwd", "absent"])
    expect(bindConnectorWorkspace({ server, folder: path.join(root, "chosen") }, (request) => reloads.push(request))).toEqual({ kind: "location" })
  expect(readMcpLeafStrict("files")).toEqual({ ok: true, value: templated })
  expect(reloads).toEqual([])
})
