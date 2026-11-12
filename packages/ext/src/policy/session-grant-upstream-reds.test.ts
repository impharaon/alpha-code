// I-05 contract A invariant 4 (design upgrade-fewer-takeovers §4; orchestrator ruling 甲, 2026-11-12): "allow for this
// session" no longer writes the project's saved approvals, so upstream tests that assert "an always reply writes a
// saved approval" are red by design — they are not taken over. This pins that list: it runs the three upstream files
// and requires exactly these ten cases to fail and every other case to pass, so an upstream change to them, or a new
// red in those files, is noticed. Two `tool-shell.test.ts` cases were already red on this machine before I-05
// (`conditional substitutions respect once|always`); they may pass or fail. Recorded in ADR-047 「精确接管面」
// and the registry entry `permission-session-grant`.
//
// Reproduce: `cd packages/core && bun test test/permission.test.ts test/tool-shell.test.ts`;
//            `cd packages/server && bun test test/permission-saved.test.ts`.
import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const REPO = path.resolve(import.meta.dir, "../../../..")

/** `<package dir>/<test file>` → the case names expected to fail there (bun's junit `testcase name`). */
const KNOWN_RED: Record<string, readonly string[]> = {
  "packages/core/test/permission.test.ts": [
    "stores and removes saved resources for a project",
    ...[
      "numeric npm script prefix",
      "numeric AWS option prefix",
      "substitution prefix",
      "redirect prefix",
      "assignment redirect prefix",
      "PowerShell method prefix",
      "PowerShell tab prefix",
    ].map((fixture) => `${fixture}: always allow covers repeat execution and narrows prefix scope`),
  ],
  "packages/core/test/tool-shell.test.ts": ["declarations reuse approvals while substitutions retain reject/once/always behavior"],
  "packages/server/test/permission-saved.test.ts": ["edits saved permissions through PATCH"],
}

/** Red before I-05, unrelated to it; either outcome is accepted. */
const TOLERATED: Record<string, readonly string[]> = {
  "packages/core/test/tool-shell.test.ts": ["conditional substitutions respect once", "conditional substitutions respect always"],
}

type Case = { file: string; name: string; failed: boolean }

const unescape = (text: string) =>
  text.replace(/&(apos|quot|lt|gt|amp|#10);/g, (_, entity: string) => ({ apos: "'", quot: '"', lt: "<", gt: ">", amp: "&", "#10": "\n" })[entity]!)

/** Every testcase in a bun junit report; `prefix` turns the report's package-relative file into a repo path. */
function casesOf(xml: string, prefix: string): Case[] {
  return [...xml.matchAll(/<testcase name="([^"]*)"[^>]*?file="([^"]*)"[^>]*?(?:\/>|>([\s\S]*?)<\/testcase>)/g)].map((match) => ({
    file: `${prefix}/${match[2]}`,
    name: unescape(match[1]!),
    failed: (match[3] ?? "").includes("<failure"),
  }))
}

/** What differs from the pinned list; empty = exactly the known reds fail. */
function judge(cases: readonly Case[]): string[] {
  const problems: string[] = []
  for (const [file, names] of Object.entries(KNOWN_RED))
    for (const name of names) {
      const found = cases.find((item) => item.file === file && item.name === name)
      if (!found) problems.push(`known red missing (renamed or removed upstream?): ${file} › ${name}`)
      else if (!found.failed) problems.push(`known red now passes (upstream changed it?): ${file} › ${name}`)
    }
  for (const item of cases)
    if (item.failed && !KNOWN_RED[item.file]?.includes(item.name) && !TOLERATED[item.file]?.includes(item.name))
      problems.push(`new red: ${item.file} › ${item.name}`)
  return problems
}

function run(packageDir: string, files: string[]): Case[] {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "upstream-reds-")), "junit.xml")
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--reporter=junit", "--reporter-outfile", out, ...files],
    cwd: path.join(REPO, packageDir),
    env: process.env,
  })
  if (!fs.existsSync(out)) throw new Error(`no junit report from ${packageDir}:\n${result.stdout.toString()}${result.stderr.toString()}`)
  return casesOf(fs.readFileSync(out, "utf8"), packageDir)
}

describe("[packages/core/src/permission.ts codepuppy(I-05)] upstream tests that assert a project-level always write are red by design", () => {
  test("the judge is not empty: a new red, a known red that passes and a missing known red are each reported", () => {
    const clean: Case[] = Object.entries(KNOWN_RED).flatMap(([file, names]) => names.map((name) => ({ file, name, failed: true })))
    expect(judge(clean)).toEqual([])
    const [first, ...rest] = clean
    expect(judge([...clean, { file: first!.file, name: "some other case", failed: true }]).join("\n")).toContain("new red")
    expect(judge([{ ...first!, failed: false }, ...rest]).join("\n")).toContain("now passes")
    expect(judge(rest).join("\n")).toContain("missing")
    expect(judge([...clean, { file: "packages/core/test/tool-shell.test.ts", name: "conditional substitutions respect once", failed: true }])).toEqual([])
    // The parser reads bun's junit shape (entities in names, self-closing passes).
    const xml =
      '<testcase name="a &apos;b&apos;" classname="" file="test/x.test.ts" line="1" assertions="1" />' +
      '<testcase name="c" classname="" file="test/x.test.ts" line="2" assertions="1"><failure type="Error" message="m">m</failure></testcase>'
    expect(casesOf(xml, "packages/core")).toEqual([
      { file: "packages/core/test/x.test.ts", name: "a 'b'", failed: false },
      { file: "packages/core/test/x.test.ts", name: "c", failed: true },
    ])
  })

  test("exactly the ten pinned upstream cases fail in those three files; every other case passes", () => {
    const cases = [
      ...run("packages/core", ["test/permission.test.ts", "test/tool-shell.test.ts"]),
      ...run("packages/server", ["test/permission-saved.test.ts"]),
    ]
    expect(cases.length).toBeGreaterThan(150)
    expect(judge(cases)).toEqual([])
  }, 240_000)
})
