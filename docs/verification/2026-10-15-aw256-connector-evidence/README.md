---
title: GitHub official and DBHub SQLite package installation evidence
kind: verification
status: frozen
owners:
  - alpha-code maintainers
last_reviewed: 2026-10-15
---

# alpha-web#256: official connector evidence on 0.1.20

Evidence for [alpha-web#256](https://github.com/jinjunnn/alpha-web/issues/256).
Documentation impact: evidence only. This is the authorized pre-publication installation seam;
no product code, alpha-web file, release hold, signature, channel or deployment was changed.
The run occurred on **2026-10-15 America/New_York**, **2026-10-16 UTC**; JSON dates use UTC.

## Baselines and actual installation

- Host: `18254b877a0eb72141bdec1b35b86b46639c855e`, `packages/ui-mac` **0.1.20**.
- Producer: alpha-web `c44c61d1c9c4131b60026e9b1009b6cc6fe56791`, equal to local `origin/main`.
- Runtime: macOS arm64, Electron **42.3.3**, Bun **1.3.14**, DBHub child Node **22.22.3**.
- Inputs are the producer's actual `catalog-src/packages/package.{github-official,dbhub-readonly}/1.0.0`
  declarations. [run.ts](harness/run.ts) runs the existing `validate` and `preview` commands,
  uses producer `canonicalJsonBytes`, and checks each payload's declared SHA-256 and byte length.
  The saved previews and payloads are the actual CLI output; no response fixture is fabricated.
- [install.ts](harness/install.ts) runs the production `runCatalogInstallWithPackagePreflight`,
  admission coordinator and transaction under real Electron `safeStorage`. Only candidate catalog
  lookup and payload fetching are injected. The candidate snapshot digest is local evidence,
  not a signed or published channel digest.
- The first pass obtains the same authorization/prerequisite preview used by the installation
  window. The second submits its binding and capability confirmations with `grants.secrets`.
  The supplied PAT is read in process from the specified 0600 file; no other service credential
  is read. Neither PAT nor DSN enters a command argument or the sidecar environment.
- Both installs return `ok: true`, initially `installedDisabled: true`. The production
  `setDesiredStateV2` / `restoreCommittedOfficialConnectors` operations then enable them.
  [install.json](results/install.json) contains the actual V3 ledger, both installed and enabled
  receipts (`origin=catalog`, transaction `committed`), and grants read back from disk.
  Installation plus enable took **185 ms** (GitHub) and **275 ms** (DBHub).
- Both grants contain `alpha.official-connectors.v1` and `alpha.secret-prerequisite.v1`.
  Saved configurations contain only `{file:}` references. The production secret implementation
  writes encrypted persistent state and short-lived runtime projections outside HOME.
  A scan of all **14 persistent state files** found neither the PAT nor the full SQLite DSN.

| Package @ 1.0.0 | `catalogRuntimeDigest` | Payload SHA-256 / bytes |
| --- | --- | --- |
| `package:github-official` | `60033458d9658bd728d6e6738dbeb32c158afdd5cc53c1df67e68522073cee35` | `1fc0f27012ab19a53eace30fe4cfe05c8ae65c02f46809745509a5cc544d7582` / 429 |
| `package:dbhub-readonly` | `2e66496db945f20d588bd818143500a38fdefd6dd329ff79ca70ec7bef42d298` | `349bdddf84b69691cc8a18198e8279022eb26242f6820037a66c53305af464ac` / 313 |

## Live calls

[live.ts](harness/live.ts) consumes each installed configuration using the engine's real
`ConfigVariable.substitute`, then the existing MCP SDK's production transport type.
This proves the requested tree-level install/use seam. It does not claim packaged GUI
search visibility, UI screenshots, or a full sidecar CONNECT-proxy integration test.

**GitHub:** Streamable HTTP to `https://api.githubcopilot.com/mcp/`, `X-MCP-Toolsets: repos`,
`X-MCP-Readonly: true`, with the PAT resolved into the Authorization header in process.
[Actual tools/call](results/github-official-calls.json):
`search_repositories({query:"repo:github/github-mcp-server",perPage:1})` returned
`total_count:1`, `full_name:"github/github-mcp-server"`,
`html_url:"https://github.com/github/github-mcp-server"`, `private:false`, `archived:false`.
The call took **701 ms**; initialization/list/call together took **3,253 ms**.
Actual hosted `serverInfo.version` was
`github-mcp-server/remote-c91af86fab613fa50f4f34159186e6a61e89c381`;
this is not asserted to be a pinned downloadable server release.

**DBHub:** the installed command uses `@bytebase/dbhub@1.5.0`, stdio, and the unchanged
production readonly TOML. The actual server reported **1.5.0**, above **0.22.6**.
Only `execute_sql` was exposed. [Actual tools/call results](results/dbhub-readonly-calls.json):

- `SELECT 1 AS aw256_ok` → `[{"aw256_ok":1}]`, **3 ms**.
- `CREATE TABLE aw256_should_not_exist(id INTEGER)` → `isError:true`,
  `code:"READONLY_VIOLATION"`, **1 ms**. Actual error:
  `Read-only mode is enabled. Only the following SQL operations are allowed: select, with, explain, pragma`.

The **67,472 ms** DBHub interval includes fetching the exact npm package, starting the server,
initialization and calls. Fetching used empty npm configs and an isolated npm cache; execution
used offline npm under `sandbox-exec` with the production `renderProcessFenceProfile`.
The database directory was writable in the fence, so the write rejection came from DBHub's
readonly policy. No database network permission was granted.
[Startup/TOML evidence](results/dbhub-startup.json) records Node, command and template hash.

The real file database was freshly created inside this evidence directory's temporary subdirectory
using `bun:sqlite` and `PRAGMA user_version = 256`; it contained no user data.
An [independent SQLite query](results/dbhub-independent-check.json) found no created table.
The database SHA-256 remained
`e0a5a1c84e6347690d5794c9d6659b16569bd36c2a823fdc1166b802ea6867a1`.
[Cleanup](results/cleanup.json) records removal of the temporary database, installation state,
Electron data and npm cache; production runtime secret projections were cleared first.
The supplied PAT source file was retained.

## Publication gate

[gate.mjs](harness/gate.mjs) ran **from the alpha-web worktree**, importing its unchanged
production gate functions. [curation-gate.json](results/curation-gate.json) records **PASS**
for the complete current published catalog plus these two candidates: **29 entries, 3 packages**.
The checks cover exact declaration/intake binding, child and root curation, license and declared
surface, stable review freshness, pinned versions, exact runtime digests and install/use status,
and signed advisory state including schema, expiry, snapshot binding and HEAD rollback protection.
The authenticated advisory document at this baseline has no active records; none were removed.

A control using the existing runtime-verification file rejects **both candidates** as unverified.
Only an evidence file in a temporary overlay is replaced with the two new records for the passing
check; other records and the actual curation inputs are unchanged. No waiver is supplied.
`build-catalog.mjs --check` itself acquires a filesystem publish lock, so this read-only harness
calls its existing gate functions directly instead of writing that lock in the frozen worktree.
This is a candidate-admission conclusion, not a publication or release-hold change.

## Runtime-verification records (copy both members)

The following object is identical to [runtime-records.json](results/runtime-records.json).
Replace the two same-named members in alpha-web `catalog-src/intake/runtime-verification.json`;
the enclosing braces here make the snippet valid standalone JSON.

```json
{
  "package:github-official": {
    "version": "1.0.0",
    "digest": "60033458d9658bd728d6e6738dbeb32c158afdd5cc53c1df67e68522073cee35",
    "install": "pass",
    "use": "pass",
    "method": "package-install",
    "verifiedAt": "2026-10-16",
    "logSha256": "4023fd59a710a9244f185739a58962be05ea0211d4fd23d38030aa2e8c40d51c",
    "installationEvidence": {
      "repo": "jinjunnn/alpha-code",
      "hostCommit": "18254b877a0eb72141bdec1b35b86b46639c855e",
      "hostVersion": "0.1.20",
      "file": "docs/verification/2026-10-15-aw256-connector-evidence/results/install.json",
      "sha256": "b4131b8517e3cbd9a0cf6e426c5f2150e0a93cd94015045c1f5b64eee9768528",
      "method": "runCatalogInstallWithPackagePreflight; real Electron safeStorage; grants.secrets; committed receipt"
    },
    "runtimeEvidence": {
      "method": "tools/call",
      "serverInfo": {
        "name": "github-mcp-server",
        "version": "github-mcp-server/remote-c91af86fab613fa50f4f34159186e6a61e89c381"
      },
      "file": "docs/verification/2026-10-15-aw256-connector-evidence/results/github-official-calls.json",
      "elapsedMs": 3253,
      "repository": "github/github-mcp-server",
      "query": "repo:github/github-mcp-server"
    }
  },
  "package:dbhub-readonly": {
    "version": "1.0.0",
    "digest": "2e66496db945f20d588bd818143500a38fdefd6dd329ff79ca70ec7bef42d298",
    "install": "pass",
    "use": "pass",
    "method": "package-install",
    "verifiedAt": "2026-10-16",
    "logSha256": "d85afd5cbb8b6544b58183542fbdf902e9350ceacd7aeae56a768122d2564866",
    "installationEvidence": {
      "repo": "jinjunnn/alpha-code",
      "hostCommit": "18254b877a0eb72141bdec1b35b86b46639c855e",
      "hostVersion": "0.1.20",
      "file": "docs/verification/2026-10-15-aw256-connector-evidence/results/install.json",
      "sha256": "b4131b8517e3cbd9a0cf6e426c5f2150e0a93cd94015045c1f5b64eee9768528",
      "method": "runCatalogInstallWithPackagePreflight; real Electron safeStorage; grants.secrets; committed receipt"
    },
    "runtimeEvidence": {
      "method": "tools/call",
      "serverInfo": {
        "name": "DBHub MCP Server",
        "version": "1.5.0"
      },
      "file": "docs/verification/2026-10-15-aw256-connector-evidence/results/dbhub-readonly-calls.json",
      "elapsedMs": 67472,
      "serverVersion": "1.5.0",
      "select": "SELECT 1 AS aw256_ok",
      "result": [
        {
          "aw256_ok": 1
        }
      ],
      "write": "CREATE TABLE aw256_should_not_exist(id INTEGER)",
      "writeError": "READONLY_VIOLATION",
      "tableCreated": false
    }
  }
}
```

## Reproduction and retained attempts

Run from this alpha-code worktree (the result directory must not already exist):

```sh
bun docs/verification/2026-10-15-aw256-connector-evidence/harness/run.ts \
  /Users/tide/app/alpha-web/.worktrees/catalog-resign-2026-10-17 \
  /Users/tide/app/alpha-code/node_modules/.bun/electron@42.3.3+759ce506b1ed1a42/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron
```

Then run from that alpha-web worktree:

```sh
node /Users/tide/app/alpha-code/.worktrees/256-evidence/docs/verification/2026-10-15-aw256-connector-evidence/harness/gate.mjs
```

The harness is manual, uses real network requests, and is not part of the repository gate.
All result/log writes reject the fine-grained PAT prefix before writing; known secret values are
also scanned or redacted in process. Final evidence files were scanned again before commit.
Proof SHA-256 bindings, JSON parsing, unchanged database bytes and absence of all temporary roots
passed, as did `git diff --check` and the README's relative-link check.
The [strict portfolio documentation check](results/docs-contract.json), mapped to this worktree,
reports 35 pre-existing `docs/evidence/2026-10-10-req229-230-visual/` layout errors. All 35 paths
already exist at the host baseline; none are in this change's allowed scope, so they are retained.

[Repository gate outcome](results/local-gate.json): `gate run` did **not** pass. Typechecks,
contracts/ext tests, seed assets and documentation links passed; ui-mac had **5,663 pass / 3 fail**.
The three failures are missing worktree runtime artifacts: Electron `path.txt`/`dist` and
`packages/ui-mac/native/alpha-fence/build/alpha_fence.node`. They were not repaired outside scope.
The run was terminated with **exit 143 during stage 9/14** after inspection showed that stage 11
would read other BYOK credentials from environment/userData, contrary to this brief's hard limit.
That credential-check stage was not entered. The test child tree was stopped and its temporary
probe worktree removed. This is an incomplete full gate, separate from the passing connector
installation/call evidence and alpha-web admission check. The orchestrator must prepare the
runtime artifacts and resolve the broader credential-check scope before rerunning it.

Earlier attempts are retained, not counted as a passing DBHub run:

- [01](attempts/01-bundle-load/electron-process.json): Bun's bundled jsonc-parser could not load
  `./impl/format`; no PAT read or installation occurred. Fixed by retaining Node package loading.
- [02](attempts/02-module-resolution/electron-process.json): that external package was not resolvable
  from the temporary bundle; no PAT read or installation occurred. Fixed with a temporary module
  resolution link and a bootstrap that exits on load errors.
- [03](attempts/03-npm-cache-placement/live-failure.json): both installs and GitHub succeeded, but
  offline DBHub startup returned `ENOTCACHED` because the custom cache was outside the fence's
  writable roots. Moved only the isolated cache to the existing HOME/.npm writable root and
  reran both installs/calls. Product fence, recipe, TOML, and package bytes were unchanged.

No blocker remains for the requested installation/call evidence. The orchestrator owns review,
push, release-hold removal, signing, publication and deployment.
