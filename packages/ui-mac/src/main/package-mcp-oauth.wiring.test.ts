import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  type CodePuppyPackageEnvelopeV1,
  type PackageProfilePayloadV1,
} from "../shared/host-extension-package-contract/decoder"
import type { PackageAdmissionBindingV1 } from "../shared/package-admission"
import {
  PACKAGE_MCP_OAUTH_REASON_CODES_V1,
  PACKAGE_MCP_OAUTH_RETRYABLE_REASONS_V1,
} from "../shared/package-mcp-oauth"
import type { PackageMcpOauthEngineV1 } from "./package-mcp-oauth"
import { createPackageAdmissionCoordinator } from "./package-admission"
import { evaluatePackageForHost } from "./package-installability"
import { runExtensionTransaction } from "./ext-transaction"
import { uninstallPackageV1, type PackageArtifactInstallersV1 } from "./ext-package-uninstall"

const snapshotDigest = "7".repeat(64)
const COMPONENT_ID = "mcp:oauth-remote"
const SERVICE_ID = "oauth-remote"
const CATALOG_ID = "package:oauth-remote-mcp"
const PREREQUISITE_ID = `${COMPONENT_ID}#provider-oauth`
const SIGNED_URL = "https://mcp.example.com/"
const OTHER_URL = "https://evil.example.net/"
const TOKEN_CANARY = "REQ128_MCP_OAUTH_TOKEN_4f1c9a"

let tmp = ""
let root = ""
let userData = ""
const previousRoot = process.env.CODEPUPPY_GLOBAL_DIR

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "package-mcp-oauth-"))
  root = join(tmp, "root")
  userData = join(tmp, "user-data")
  mkdirSync(root, { recursive: true })
  process.env.CODEPUPPY_GLOBAL_DIR = root
})

afterEach(() => {
  if (previousRoot === undefined) delete process.env.CODEPUPPY_GLOBAL_DIR
  else process.env.CODEPUPPY_GLOBAL_DIR = previousRoot
  rmSync(tmp, { recursive: true, force: true })
})

/** A host-owned v2 package whose remote MCP authorises through the engine's OAuth stack. */
function fixture(
  options: { required?: boolean; url?: string; catalogId?: string; componentId?: string } = {},
) {
  const componentId = options.componentId ?? COMPONENT_ID
  const payload = {
    schema: "codepuppy.host-extension-package.payload.mcp-remote.v1",
    behavior: {
      url: options.url ?? SIGNED_URL,
      headersTemplate: {},
      requiredSecrets: [],
      auth: {
        kind: "mcp-oauth",
        prerequisiteId: "provider-oauth",
        required: options.required ?? true,
        label: "Provider account",
      },
    },
  } as unknown as PackageProfilePayloadV1
  const bytes = new TextEncoder().encode(`${JSON.stringify(payload, null, 2)}\n`)
  const envelope = {
    schema: "codepuppy.host-extension-package.v1",
    prelude: { packageId: options.catalogId ?? CATALOG_ID, version: "1.0.0" },
    presentation: { displayName: "OAuth Remote MCP", description: "Engine-OAuth-authorised remote MCP." },
    root: componentId,
    components: [
      {
        id: componentId,
        required: true,
        dependencies: [],
        profileId: "mcp-remote",
        profileVersion: 1,
        capabilities: ["codepuppy.mcp-oauth.v1"],
        payloadRef: {
          sha256: createHash("sha256").update(bytes).digest("hex"),
          bytes: bytes.byteLength,
          mediaType: "application/vnd.codepuppy.host-extension-package.mcp-remote.v1+json",
          url: "https://alphacodeone.com/catalog/assets/mcp.oauth-remote/1.0.0/alpha-package/payload.json",
        },
      },
    ],
    capabilities: ["codepuppy.mcp-oauth.v1"],
  } as unknown as CodePuppyPackageEnvelopeV1
  return { envelope, bytes }
}

/**
 * The fake engine implements the load-bearing semantics of the real readiness probe, not just its
 * shape: `add` answers `connected` only when a stored credential was granted for this exact name
 * *and* URL (the engine keys credentials on name + URL). Token values exist only in here — nothing
 * admission returns may carry the canary.
 */
function fakeEngine(script: { addFails?: boolean } = {}) {
  const calls: string[] = []
  const tokens = new Map<string, { serverUrl: string; secret: string }>()
  const engine: PackageMcpOauthEngineV1 = {
    add: async (name, config) => {
      calls.push(`add:${name}:${config.url}`)
      if (script.addFails) return { ok: false, reason: "engine unreachable" }
      const entry = tokens.get(name)
      return { ok: true, status: entry && entry.serverUrl === config.url ? "connected" : "needs_auth" }
    },
  }
  return { engine, calls, tokens }
}

function confirmation(preview: {
  authorization: Array<{ key: string; requested: string[] }>
  packageAuthorization: { binding: PackageAdmissionBindingV1 }
}) {
  return {
    confirmed: Object.fromEntries(preview.authorization.map((item) => [item.key, item.requested])),
    binding: preview.packageAuthorization.binding,
  }
}

function admissionCoordinator(options: {
  envelope: CodePuppyPackageEnvelopeV1
  bytes: Uint8Array
  engine?: PackageMcpOauthEngineV1
  onTransaction: () => void
  failTransaction?: boolean
}) {
  return createPackageAdmissionCoordinator({
    loadVerifiedCatalog: async () => ({
      source: "remote",
      catalog: { version: "1", entries: [{}], packages: [options.envelope] },
      snapshotDigest,
    }),
    root: () => root,
    userDataPath: userData,
    casBaseRoot: () => userData,
    environment: () => "dev",
    installability: { fetchPayload: async () => options.bytes },
    ...(options.engine ? { mcpOauthEngine: options.engine } : {}),
    transaction: async (...args) => {
      options.onTransaction()
      if (options.failTransaction) return { ok: false as const, stage: "populate" as const, reason: "injected local install failure" }
      return runExtensionTransaction(...args)
    },
  })
}

async function install(options: {
  envelope: CodePuppyPackageEnvelopeV1
  bytes: Uint8Array
  engine?: PackageMcpOauthEngineV1
  attemptId: string
  failTransaction?: boolean
}) {
  let transactionCalls = 0
  const admit = admissionCoordinator({
    envelope: options.envelope,
    bytes: options.bytes,
    ...(options.engine ? { engine: options.engine } : {}),
    onTransaction: () => transactionCalls++,
    ...(options.failTransaction ? { failTransaction: true } : {}),
  })
  const preview = await admit({ catalogId: options.envelope.prelude.packageId, scope: { scope: "global" }, attemptId: options.attemptId })
  if (preview.ok || preview.stage !== "authorize") throw new Error(`expected preview: ${JSON.stringify(preview)}`)
  const outcome = await admit({
    catalogId: options.envelope.prelude.packageId,
    scope: { scope: "global" },
    attemptId: options.attemptId,
    authorization: confirmation(preview),
  })
  return { outcome, transactionCalls }
}

function uninstallInstallers(calls: string[]): PackageArtifactInstallersV1 {
  return {
    removeFsInstall: (type, name) => {
      calls.push(`removeFsInstall:${type}:${name}`)
      return { ok: true, files: [] }
    },
    removeMcpConfig: (name) => {
      calls.push(`removeMcpConfig:${name}`)
      return { ok: true }
    },
    removeCommandConfig: (name) => {
      calls.push(`removeCommandConfig:${name}`)
      return { ok: true }
    },
    removeMcpSecretsStrict: (name) => {
      calls.push(`removeMcpSecretsStrict:${name}`)
      return { ok: true }
    },
    releaseCodePuppyConnectionBindings: (componentId) => {
      calls.push(`releaseCodePuppyConnectionBindings:${componentId}`)
      return { ok: true }
    },
    removeInstallGrants: (_root, keys) => {
      calls.push(`removeInstallGrants:${keys.join(",")}`)
      return { ok: true, removed: [] }
    },
    removePluginPath: (name, absJsPath) => {
      calls.push(`removePluginPath:${name}:${absJsPath}`)
      return { ok: true }
    },
  }
}

describe("vocabulary", () => {
  test("every non-ready reason code except profile-invalid is retryable, and every code is named once", () => {
    const retryable = new Set<string>(PACKAGE_MCP_OAUTH_RETRYABLE_REASONS_V1)
    const terminalOnly = PACKAGE_MCP_OAUTH_REASON_CODES_V1.filter(
      (code) => !retryable.has(code) && code !== "mcp-oauth-ready",
    )
    // `mcp-oauth-profile-invalid` needs a new package; everything else must be retryable with a
    // fresh attempt, or "fail closed" turns into "stuck forever".
    expect(terminalOnly).toEqual(["mcp-oauth-profile-invalid"])
    expect(new Set(PACKAGE_MCP_OAUTH_REASON_CODES_V1).size).toBe(PACKAGE_MCP_OAUTH_REASON_CODES_V1.length)
  })
})

describe("the browse surface sees the signed OAuth prerequisite", () => {
  /**
   * Before this ticket the mcp-oauth declaration decoded but reached no view: a required OAuth
   * package presented itself as ready and the installer ran. This pins the honest verdict.
   */
  test("the production evaluator lists the prerequisite as required-action", async () => {
    const { envelope, bytes } = fixture()
    const view = await evaluatePackageForHost(envelope, { fetchPayload: async () => bytes })
    expect(view.verdict).toBe("compatible")
    expect(view.action.reasonCode).toBe("package-prerequisite-required")
    expect(view.prerequisites).toEqual({
      status: "required-action",
      items: [{ prerequisiteId: PREREQUISITE_ID, label: "Provider account", required: true }],
    })
  })
})

describe("admission asks the engine, and required OAuth gates the installer", () => {
  test("a required OAuth prerequisite that is not ready stops the install with zero transaction calls", async () => {
    const fake = fakeEngine()
    const { envelope, bytes } = fixture()
    const { outcome, transactionCalls } = await install({ envelope, bytes, engine: fake.engine, attemptId: "attempt-required-missing" })
    expect(outcome).toMatchObject({ ok: false, reason: "package admission: mcp-oauth-required" })
    expect(transactionCalls).toBe(0)
  })

  test("an absent engine seam is refused for a required prerequisite, never treated as ready", async () => {
    const { envelope, bytes } = fixture()
    const { outcome, transactionCalls } = await install({ envelope, bytes, attemptId: "attempt-no-seam" })
    expect(outcome).toMatchObject({ ok: false, reason: "package admission: mcp-oauth-engine-unavailable" })
    expect(transactionCalls).toBe(0)
  })

  test("an unreachable engine is refused for a required prerequisite", async () => {
    const fake = fakeEngine({ addFails: true })
    const { envelope, bytes } = fixture()
    const { outcome, transactionCalls } = await install({ envelope, bytes, engine: fake.engine, attemptId: "attempt-engine-down" })
    expect(outcome).toMatchObject({ ok: false, reason: "package admission: mcp-oauth-engine-unavailable" })
    expect(transactionCalls).toBe(0)
  })

  test("a ready engine lets the install through, probed against the signed URL", async () => {
    const fake = fakeEngine()
    fake.tokens.set(SERVICE_ID, { serverUrl: SIGNED_URL, secret: TOKEN_CANARY })
    const { envelope, bytes } = fixture()
    const { outcome, transactionCalls } = await install({ envelope, bytes, engine: fake.engine, attemptId: "attempt-ready" })
    expect(outcome).toMatchObject({ ok: true, kind: "mcp", name: SERVICE_ID })
    expect(outcome).not.toHaveProperty("mcpOauthUnavailable")
    expect(transactionCalls).toBe(1)
    expect(fake.calls).toEqual([`add:${SERVICE_ID}:${SIGNED_URL}`])
    // The durable config binds the signed URL — the same binding the engine's token store enforces.
    const config = JSON.parse(readFileSync(join(root, "codepuppy.jsonc"), "utf8"))
    expect(config.mcp[SERVICE_ID].url).toBe(SIGNED_URL)
    // No token byte reaches the ledger or the config.
    for (const file of ["codepuppy.jsonc", "installs.json"])
      expect(readFileSync(join(root, file), "utf8")).not.toContain(TOKEN_CANARY)
  })

  /**
   * Token↔server binding, end to end: the token was minted for the signed URL of version A. An
   * envelope now pointing somewhere else re-probes against *its* URL, the engine's name + URL
   * credential binding answers needs_auth, and the required gate refuses. A token can never follow a package
   * to a server it was not granted for.
   */
  test("a token bound to another URL does not satisfy a tampered envelope", async () => {
    const fake = fakeEngine()
    fake.tokens.set(SERVICE_ID, { serverUrl: SIGNED_URL, secret: TOKEN_CANARY })
    const moved = fixture({ url: OTHER_URL })
    const { outcome, transactionCalls } = await install({
      envelope: moved.envelope,
      bytes: moved.bytes,
      engine: fake.engine,
      attemptId: "attempt-moved-url",
    })
    expect(outcome).toMatchObject({ ok: false, reason: "package admission: mcp-oauth-required" })
    expect(transactionCalls).toBe(0)
    expect(fake.calls).toEqual([`add:${SERVICE_ID}:${OTHER_URL}`])
  })

  test("an optional OAuth prerequisite that is not ready installs unavailable and disabled", async () => {
    const fake = fakeEngine()
    const { envelope, bytes } = fixture({ required: false })
    const { outcome, transactionCalls } = await install({ envelope, bytes, engine: fake.engine, attemptId: "attempt-optional" })
    expect(outcome).toMatchObject({ ok: true, kind: "mcp", mcpOauthUnavailable: true, activateMcp: [] })
    expect(transactionCalls).toBe(1)
    const config = JSON.parse(readFileSync(join(root, "codepuppy.jsonc"), "utf8"))
    expect(config.mcp[SERVICE_ID].enabled).toBe(false)
  })
})

describe("credentials outlive local installs", () => {
  test("a failed local install retains the engine-side credential for reuse", async () => {
    const fake = fakeEngine()
    fake.tokens.set(SERVICE_ID, { serverUrl: SIGNED_URL, secret: TOKEN_CANARY })

    const { envelope, bytes } = fixture()
    const { outcome, transactionCalls } = await install({
      envelope,
      bytes,
      engine: fake.engine,
      attemptId: "attempt-install-fails",
      failTransaction: true,
    })
    expect(outcome).toMatchObject({ ok: false, reason: "injected local install failure" })
    expect(transactionCalls).toBe(1)
    // The consent already granted at the provider is not a rollbackable local side effect: the
    // token entry survives, and a retry needs no second browser round.
    expect(fake.tokens.get(SERVICE_ID)).toEqual({ serverUrl: SIGNED_URL, secret: TOKEN_CANARY })
    const retry = await install({ envelope, bytes, engine: fake.engine, attemptId: "attempt-install-retry" })
    expect(retry.outcome).toMatchObject({ ok: true, kind: "mcp", name: SERVICE_ID })
    expect(retry.transactionCalls).toBe(1)
  })

  /**
   * Uninstall is structurally incapable of revoking: its installer surface has no OAuth verb and
   * it holds no engine handle. This pins the observable half — a full install/uninstall round trip
   * leaves the engine's call log and token store byte-identical.
   */
  test("package uninstall does not revoke the shared engine credential", async () => {
    const fake = fakeEngine()
    fake.tokens.set(SERVICE_ID, { serverUrl: SIGNED_URL, secret: TOKEN_CANARY })
    const { envelope, bytes } = fixture()
    const installed = await install({ envelope, bytes, engine: fake.engine, attemptId: "attempt-then-uninstall" })
    expect(installed.outcome).toMatchObject({ ok: true, kind: "mcp" })
    const callsAfterInstall = [...fake.calls]

    const uninstallCalls: string[] = []
    const outcome = uninstallPackageV1(CATALOG_ID, {
      globalRoot: () => root,
      installers: uninstallInstallers(uninstallCalls),
    })
    expect(outcome.ok).toBe(true)
    expect(fake.calls).toEqual(callsAfterInstall)
    expect(fake.tokens.get(SERVICE_ID)).toEqual({ serverUrl: SIGNED_URL, secret: TOKEN_CANARY })
  })
})
