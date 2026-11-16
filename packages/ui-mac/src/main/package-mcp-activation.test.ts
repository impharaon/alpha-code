import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { projectScopeIdentity } from "./ext-receipt-v2"
import { packageAppliesAt } from "./package-mcp-activation"

const scratch: string[] = []
afterEach(() => scratch.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

test("project MCP activation rechecks the Location identity, including aliases and missing roots", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "package-effect-")))
  scratch.push(root)
  const project = join(root, "project")
  const alias = join(root, "alias")
  mkdirSync(project)
  symlinkSync(project, alias)
  const identity = projectScopeIdentity(project)
  if (!identity.ok) throw Error(identity.reason)
  expect(packageAppliesAt({ effect: identity.scope }, alias)).toBe(true)
  expect(packageAppliesAt({ effect: identity.scope }, root)).toBe(false)
  rmSync(project, { recursive: true })
  expect(packageAppliesAt({ effect: identity.scope }, project)).toBe(false)
  expect(packageAppliesAt(undefined, root)).toBe(true)
})


test("project MCP does not treat a no-project home Location as a matching project", () => {
  const identity = projectScopeIdentity(homedir())
  if (!identity.ok) throw Error(identity.reason)
  expect(packageAppliesAt({ effect: identity.scope }, homedir())).toBe(false)
})
