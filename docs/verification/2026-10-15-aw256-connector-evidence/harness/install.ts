// Bundled for the real Electron main process; no mocked encryption or installer.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { lstatSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { app, safeStorage } from "electron"
import { initAlphaEnvironment } from "../../../../packages/ui-mac/src/main/alpha-environment"
import { createPackageAdmissionCoordinator } from "../../../../packages/ui-mac/src/main/package-admission"
import { runCatalogInstallWithPackagePreflight } from "../../../../packages/ui-mac/src/main/package-installability"
import { findRecordV2, setDesiredStateV2 } from "../../../../packages/ui-mac/src/main/ext-receipt-v2"
import { readCapabilityGrant } from "../../../../packages/ui-mac/src/main/ext-capability-grants"
import { readMcpLeafStrict } from "../../../../packages/ui-mac/src/main/ext-config"
import { clearOfficialConnectorRuntime, restoreCommittedOfficialConnectors } from "../../../../packages/ui-mac/src/main/official-connector-resources"
import type { AlphaPackageEnvelopeV1 } from "../../../../packages/ui-mac/src/shared/host-extension-package-contract/decoder"

const input = JSON.parse(readFileSync(process.argv[2]!, "utf8"))
app.setName("Alpha AW256 Evidence")
app.setPath("userData", join(input.temporary, "electron"))
app.setAppLogsPath(join(input.temporary, "electron-logs"))

async function main() {
  await app.whenReady()
  assert.ok(safeStorage.isEncryptionAvailable(), "real Electron secure storage required")
  const source = lstatSync(input.tokenPath)
  assert.ok(source.isFile() && !source.isSymbolicLink())
  assert.equal(source.mode & 0o777, 0o600)
  assert.equal(source.uid, process.getuid!())
  // The sole source credential read. Never put this value in argv or environment.
  const token = readFileSync(input.tokenPath, "utf8").trim()
  assert.ok(token.length > 30, "nonempty fine-grained PAT required")
  const dsn = `sqlite://${input.database}`
  const safe = (value: unknown) => {
    const text = JSON.stringify(value, null, 2) + "\n"
    if (text.includes(token) || text.includes("github_pat_") || text.includes(dsn))
      throw new Error("SECRET_SCAN_REJECTED")
    return text
  }
  const save = (name: string, value: unknown) => writeFileSync(join(input.results, name), safe(value), { flag: "wx" })
  const environment = initAlphaEnvironment({ isPackaged: false, channel: "dev", appDataDir: input.temporary,
    baseRoot: join(input.temporary, "state") })
  const root = environment.mutableRoot
  const candidates = []
  try {
    for (const name of ["github-official", "dbhub-readonly"]) {
      const started = performance.now()
      const compiled = JSON.parse(readFileSync(join(input.results, `${name}-preview.json`), "utf8"))
      const envelope = compiled.envelope as AlphaPackageEnvelopeV1
      const ref = envelope.components[0]!.payloadRef
      const bytes = new Uint8Array(readFileSync(join(input.results, `${name}-payload.json`)))
      assert.equal(bytes.length, ref.bytes)
      assert.equal(createHash("sha256").update(bytes).digest("hex"), ref.sha256)
      const catalog = { version: "aw256-preview", entries: [], packages: [envelope] }
      const loadVerifiedCatalog = async () => ({ source: "remote" as const, catalog,
        snapshotDigest: createHash("sha256").update(JSON.stringify(catalog)).digest("hex") })
      const installPackage = createPackageAdmissionCoordinator({ loadVerifiedCatalog, root: () => root,
        userDataPath: app.getPath("userData"), casBaseRoot: () => environment.casBaseRoot, environment: () => "dev",
        installability: { fetchPayload: async (requested) => {
          assert.equal(requested.url, ref.url)
          return bytes
        } } })
      const deps = { loadVerifiedCatalog, installPackage, installLegacy: async () => { throw Error("unexpected legacy install") } }
      const intent = { catalogId: envelope.prelude.packageId, scope: { scope: "global" as const }, attemptId: `aw256-${name}` }
      const preview = await runCatalogInstallWithPackagePreflight(intent, deps)
      save(`${name}-authorization.json`, preview)
      assert.ok(!preview.ok && "packageAuthorization" in preview, "authorization preview required")
      const authorization = preview.packageAuthorization
      const installed = await runCatalogInstallWithPackagePreflight({ ...intent,
        grants: { secrets: { [`mcp:${name}#${name === "github-official" ? "GITHUB_PERSONAL_ACCESS_TOKEN" : "DSN"}`]:
          name === "github-official" ? token : dsn } },
        authorization: { binding: authorization.binding,
          confirmed: Object.fromEntries(authorization.items.map((item) => [item.key, item.requested])) },
      }, deps)
      save(`${name}-install-result.json`, installed)
      assert.ok(installed.ok, "package installation failed; see safe result")
      const installedReceipt = findRecordV2(root, "mcp", name)
      assert.equal(installedReceipt?.origin, "catalog")
      // Same production state operation as enabling the freshly installed connector.
      assert.ok(setDesiredStateV2(root, "mcp", name, "enabled").ok)
      restoreCommittedOfficialConnectors()
      const leaf = readMcpLeafStrict(name)
      assert.ok(leaf.ok && leaf.value && leaf.value.enabled !== false)
      assert.ok(JSON.stringify(leaf.value).includes("{file:"))
      const receipt = findRecordV2(root, "mcp", name)
      const grant = readCapabilityGrant(root, `mcp--${name}`)
      assert.ok(grant)
      save(`${name}-config.json`, leaf.value)
      candidates.push({ name, installed, installedReceipt, receipt, grant, elapsedMs: Math.round(performance.now() - started) })
    }
    const scan = (directory: string): number => readdirSync(directory, { withFileTypes: true }).reduce((count, entry) => {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) return count + scan(file)
      assert.ok(entry.isFile(), "unexpected symlink in installation state")
      const bytes = readFileSync(file)
      assert.ok(!bytes.includes(token) && !bytes.includes("github_pat_") && !bytes.includes(dsn), "plaintext in persisted state")
      return count + 1
    }, 0)
    save("install.json", { ...input.baseline, encryption: { backend: "Electron safeStorage", available: true,
      electron: process.versions.electron }, candidates, ledger: JSON.parse(readFileSync(join(root, "installs.json"), "utf8")),
      persistedStateSecretScan: { files: scan(environment.casBaseRoot), pass: true } })
    const live = spawnSync(input.bun, [input.liveScript, input.results, input.temporary, input.database], {
      env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, ALPHA_GLOBAL_DIR: root },
      encoding: "utf8", timeout: 240_000, maxBuffer: 4 * 1024 * 1024,
    })
    save("live-process.json", { status: live.status, signal: live.signal, stdout: live.stdout, stderr: live.stderr })
    assert.equal(live.status, 0, "live MCP process failed; see sanitized live evidence")
  } catch (error) {
    const message = String(error).replaceAll(token, "[REDACTED]").replaceAll(dsn, "[SQLITE_DSN]")
    save("failure.json", { message: message.replace(/github_pat_[A-Za-z0-9_]+/g, "[REDACTED]") })
    throw Error("AW256_FAILED; see failure.json")
  } finally {
    clearOfficialConnectorRuntime()
  }
}

main().then(() => app.exit(0), () => app.exit(1))
