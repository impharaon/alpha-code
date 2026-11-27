// Fast: fixtures come from the production fileDiff formatter, with Node dotenv assignment syntax.
import { expect, test } from "bun:test"
import { fileDiff } from "../../core/src/tool/plugin/file-diff"
import { projectEnvDiff } from "./secret-diff"

test("env diff projects multiline RHS in both original formatter sides", () => {
  const before = 'KEY="first\ncontinued"\nPORT=3000\nKEY=second\nFLAG=0\n'
  const after = before.replace("FLAG=0", "FLAG=1").replace("first", "replacement")
  const raw = fileDiff(".env", before, after).patch!
  const safe = projectEnvDiff(raw, [before, after], (text) => text)
  for (const value of ["first", "continued", "second", "replacement"]) expect(safe.includes(value)).toBe(false)
  expect(safe).toContain(" PORT=3000")
  expect(safe).toContain("-FLAG=0")
  expect(safe).toContain("+FLAG=1")
  expect(safe.match(/^@@.*$/m)?.[0]).toBe(raw.match(/^@@.*$/m)?.[0])
})

test("env diff rejects rows that cannot be attributed to a file snapshot", () => {
  const raw = fileDiff(".env", "KEY=first\n", "KEY=second\n").patch!
  expect(() => projectEnvDiff(raw, ["KEY=unrelated\n"], (text) => text)).toThrow("source snapshot")
})
