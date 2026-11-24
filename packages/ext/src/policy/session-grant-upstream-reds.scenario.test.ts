// Upstream tests in three files are red by design and not taken over; this pins them. It runs only the pinned cases
// (by name) and requires each to be present and red, so an upstream rename, a removal, or a change that makes one pass
// again — any sign that our patch no longer decides these cases — is noticed. Two groups:
//   · I-05 contract A invariant 4 (design upgrade-fewer-takeovers §4; orchestrator ruling 甲, 2026-11-12): "allow for
//     this session" no longer writes the project's saved approvals, so tests asserting "an always reply writes a saved
//     approval" fail (10 cases).
//   · I-13 L1 (SPEC-engine-config-fence BR-02, DESIGN-engine-config-fence §4.6): saved approvals take no part in a
//     decision, so tests that seed one with `saved.add` / `saved.update` and expect it to allow fail (64 cases; every one
//     comes from a test body that seeds a saved approval, and none of them fails with L2 alone).
// The other cases of those upstream files are upstream's own behaviour and are not replayed here (ADR-0014). The
// tool-shell reds wait for an approval nobody gives; a 2 s per-case limit turns that wait into the red quickly, and a
// case that our patch stopped deciding would pass well inside it. Recorded in ADR-047 「精确接管面」 and the registry
// entries `permission-session-grant` and `engine-db-records-not-honoured`.
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

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Runs only the named cases of `files` (bun matches the pattern against each case's full name). */
function run(packageDir: string, files: string[], names: readonly string[]): Case[] {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "upstream-reds-")), "junit.xml")
  const pattern = names.map(escapeRegExp).join("|")
  const result = Bun.spawnSync({
    cmd: [process.execPath, "test", "--timeout", "2000", "--test-name-pattern", pattern, "--reporter=junit", "--reporter-outfile", out, ...files],
    cwd: path.join(REPO, packageDir),
    env: process.env,
  })
  if (!fs.existsSync(out)) throw new Error(`no junit report from ${packageDir}:\n${result.stdout.toString()}${result.stderr.toString()}`)
  return casesOf(fs.readFileSync(out, "utf8"), packageDir)
}

describe("[packages/core/src/permission.ts codepuppy(I-05, I-13 L1)] upstream tests that assert a project-level always write or a saved approval's effect are red by design", () => {
  test("the pinned upstream cases in those three files are present and red", () => {
    const core = [...KNOWN_RED["packages/core/test/permission.test.ts"]!, ...KNOWN_RED["packages/core/test/tool-shell.test.ts"]!]
    const cases = [
      ...run("packages/core", ["test/permission.test.ts", "test/tool-shell.test.ts"], core),
      ...run("packages/server", ["test/permission-saved.test.ts"], KNOWN_RED["packages/server/test/permission-saved.test.ts"]!),
    ]
    const missing: string[] = []
    const passing: string[] = []
    for (const [file, names] of Object.entries(KNOWN_RED))
      for (const name of names) {
        const found = cases.find((item) => item.file === file && item.name === name)
        if (!found) missing.push(`${file} › ${name}`)
        else if (!found.failed) passing.push(`${file} › ${name}`)
      }
    expect({ missing, passing }).toEqual({ missing: [], passing: [] })
  }, 240_000)
})
