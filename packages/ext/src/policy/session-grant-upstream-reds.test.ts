// Upstream tests in three files are red by design and not taken over; this pins exactly which. It runs the three
// upstream files and requires exactly the listed cases to fail and every other case to pass, so an upstream change to
// them, or a new red in those files, is noticed. Two groups:
//   · I-05 contract A invariant 4 (design upgrade-fewer-takeovers §4; orchestrator ruling 甲, 2026-11-12): "allow for
//     this session" no longer writes the project's saved approvals, so tests asserting "an always reply writes a saved
//     approval" fail (10 cases).
//   · I-13 L1 (SPEC-engine-config-fence BR-02, DESIGN-engine-config-fence §4.6): saved approvals take no part in a
//     decision, so tests that seed one with `saved.add` / `saved.update` and expect it to allow fail (64 cases; every one
//     comes from a test body that seeds a saved approval, and none of them fails with L2 alone).
// Two `tool-shell.test.ts` cases were already red on this machine before I-05 (`conditional substitutions respect
// once|always`); they may pass or fail. Recorded in ADR-047 「精确接管面」 and the registry entries
// `permission-session-grant` and `engine-db-records-not-honoured`.
//
// Reproduce: `cd packages/core && bun test test/permission.test.ts test/tool-shell.test.ts`;
//            `cd packages/server && bun test test/permission-saved.test.ts`.
import { describe, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const REPO = path.resolve(import.meta.dir, "../../../..")

/**
 * I-13 L1: saved approvals take no part in a decision. Each case seeds one (`saved.add` / `saved.update`) and expects it
 * to allow: in `permission.test.ts` the evaluation then asks or reaches the configured rule instead; in `tool-shell.test.ts`
 * the command waits for an approval nobody gives and the case times out.
 */
const I13_SAVED_APPROVALS_IGNORED: Record<string, readonly string[]> = {
  "packages/core/test/tool-shell.test.ts": [
    "pipeline redirect keeps the redirect target visible to exact approval and denial",
    "zsh: for value (a b) printf %s \"$value\"",
    "zsh: for value (a b) { printf %s \"$value\"; }",
    "zsh: for value ($(printf a)) do printf %s \"$value\"; done",
    "bash: probe() for value in a b; do printf %s \"$value\"; done; probe",
    "bash: printf %s \"$(probe() case value in (value) printf hello;; esac; probe)\"",
    "bash: quoted heredoc reuses existing approvals",
    "bash: heredoc substitution reuses existing approvals",
    "bash: loop with a conditional reuses existing approvals",
    "bash: function and case reuses existing approvals",
    "bash: parameter fallback reuses existing approvals",
    "bash: arithmetic statement reuses existing approvals",
    "bash: ANSI-C quoting reuses existing approvals",
    "zsh: quoted heredoc reuses existing approvals",
    "zsh: heredoc substitution reuses existing approvals",
    "zsh: loop with a conditional reuses existing approvals",
    "zsh: function and case reuses existing approvals",
    "zsh: parameter fallback reuses existing approvals",
    "zsh: arithmetic statement reuses existing approvals",
    "zsh: ANSI-C quoting reuses existing approvals"
  ],
  "packages/core/test/permission.test.ts": [
    "merges session rules after agent rules and before saved approvals",
    "uses saved bash approvals while preserving configured deny precedence",
    "edits saved approvals and enforces the edited rule",
    "timed command preserves wrapper approvals: saved wildcard",
    "timed command preserves wrapper approvals: saved command approvals",
    "timed command preserves wrapper approvals: exact saved approvals",
    "coprocess command preserves wrapper approvals: saved wildcard",
    "coprocess command preserves wrapper approvals: saved command approvals",
    "coprocess command preserves wrapper approvals: exact saved approvals",
    "declarations and unset: saved wildcard",
    "declarations and unset: saved command approvals",
    "declarations and unset: exact saved approvals",
    "declarations and unset: configured deny despite saved wildcard",
    "export with an approved command substitution: saved wildcard",
    "export with an approved command substitution: saved command approvals",
    "export with an approved command substitution: exact saved approvals",
    "export with an approved command substitution: configured deny despite saved wildcard",
    "export retains checks on the command substitution: saved wildcard",
    "export retains checks on the command substitution: saved command approvals",
    "export retains checks on the command substitution: exact saved approvals",
    "redirect after a conditional list: saved wildcard",
    "redirect after a conditional list: saved command approvals",
    "redirect after a pipeline: saved wildcard",
    "redirect after a pipeline: saved command approvals",
    "assignment redirect followed by a command: saved wildcard",
    "assignment redirect with an approved command substitution: saved wildcard",
    "substitution in a saved prefix: saved wildcard",
    "substitution in a saved prefix: saved command approvals",
    "substitution in a saved prefix: exact saved approvals",
    "standalone PowerShell scriptblock caller: saved wildcard",
    "standalone PowerShell scriptblock caller: saved command approvals",
    "standalone PowerShell scriptblock caller: exact saved approvals",
    "standalone PowerShell scriptblock caller: configured deny despite saved wildcard",
    "tab-separated PowerShell command: saved wildcard",
    "PowerShell equals-joined argument: saved wildcard",
    "PowerShell equals-joined argument: configured deny despite saved wildcard",
    "trailing redirect after list operator: saved wildcard",
    "trailing redirect after list operator: saved command approvals",
    "commandless redirect write: saved wildcard",
    "commandless redirect write: saved command approvals",
    "commandless redirect write: exact saved approvals",
    "PowerShell .NET method invocation: saved wildcard",
    "PowerShell .NET method invocation: saved command approvals",
    "PowerShell .NET method invocation: exact saved approvals"
  ]
}

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
    ...I13_SAVED_APPROVALS_IGNORED["packages/core/test/permission.test.ts"]!,
  ],
  "packages/core/test/tool-shell.test.ts": [
    "declarations reuse approvals while substitutions retain reject/once/always behavior",
    ...I13_SAVED_APPROVALS_IGNORED["packages/core/test/tool-shell.test.ts"]!,
  ],
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

describe("[packages/core/src/permission.ts codepuppy(I-05, I-13 L1)] upstream tests that assert a project-level always write or a saved approval's effect are red by design", () => {
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

  test("exactly the pinned upstream cases fail in those three files; every other case passes", () => {
    const cases = [
      ...run("packages/core", ["test/permission.test.ts", "test/tool-shell.test.ts"]),
      ...run("packages/server", ["test/permission-saved.test.ts"]),
    ]
    expect(cases.length).toBeGreaterThan(150)
    expect(judge(cases)).toEqual([])
  }, 240_000)
})
