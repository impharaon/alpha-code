import { testEgressDial } from "./egress-upstream-fixture"
import { afterEach, beforeEach, expect, mock, test } from "bun:test"
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { Database } from "bun:sqlite"
import { engineSandbox, assertEngineSandboxed, engineSlot } from "./engine-sandbox"
import { createRequire } from "node:module"

// `#1662`(OpenCode 2):v1 引擎 packages/opencode 随换代删除。「引擎真的那份 {file:} 实现」换成 2.x 的
// `@opencode/core/config/variable`(Effect,读文件走 FSUtil);MCP 客户端换成 2.x 引擎自己用的 `@modelcontextprotocol/client`。
async function substituteWithEngine(input: { type: "virtual"; source: string; dir: string; text: string }): Promise<string> {
  const { Effect } = await import("effect")
  const { ConfigVariable } = await import("@opencode/core/config/variable")
  const { AppNodeBuilder } = await import("@opencode/core/effect/app-node-builder")
  const { FSUtil } = await import("@opencode/util/fs-util")
  return Effect.runPromise(ConfigVariable.substitute(input).pipe(Effect.provide(AppNodeBuilder.build(FSUtil.node))))
}
const engineRequire = createRequire(resolve(import.meta.dir, "../../core/package.json"))

// The OS keychain boundary is replaced with real AES-GCM, not a plaintext/base64 stand-in.
const key = randomBytes(32)
let available = true
mock.module("../src/main/codepuppy-keychain-backend", () => ({
  keychainBackend: () => ({
    isEncryptionAvailable: () => available,
    encryptString: (value: string) => {
      const iv = randomBytes(12)
      const c = createCipheriv("aes-256-gcm", key, iv)
      return Buffer.concat([iv, c.update(value), c.final(), c.getAuthTag()])
    },
    decryptString: (value: Buffer) => {
      const c = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12))
      c.setAuthTag(value.subarray(-16))
      return Buffer.concat([c.update(value.subarray(12, -16)), c.final()]).toString()
    },
  }),
}))
const { initCodePuppyEnvironment, getCodePuppyEnvironment, __resetCodePuppyEnvironmentForTests } = await import(
  "../src/main/codepuppy-environment"
)
const { officialNodeCommand, DBHUB_READONLY_TOML } = await import("../src/main/official-connector-recipes")
const { planProcessFence } = await import("../src/main/process-fence-plan")
const { trialCompileProfile } = await import("../src/main/process-fence-compile")
const { useGenerationFence } = await import("../src/main/shell-env")
// Production projects a local connector only after an engine generation was planned; its Node check runs under that profile.
function installGenerationFence(base: string) {
  if (process.platform !== "darwin") return
  const fenceHome = join(base, "fence-home"), state = join(base, "fence-state"), userData = join(base, "fence-userData"), project = join(base, "fence-project")
  for (const dir of [fenceHome, state, userData, project]) mkdirSync(dir, { recursive: true })
  const plan = planProcessFence({ userDataPath: userData, sidecarEnv: { HOME: fenceHome },
    addon: { packaged: false, resourcesPath: "/unused", moduleDir: resolve(import.meta.dir, "../out/main"), exists: existsSync }, egressProxyPort: 4443, carriedWorkspaces: [], engineConfigDirectory: join(fenceHome, ".config/opencode"), homebrewFence: [], credentialStores: [],
  }, { homeDir: () => fenceHome, codepuppyGlobalRoot: () => join(state, "env/dev"), appStateRoot: () => state, realpath: realpathSync.native, defaultWorkspace: () => project, readWorkspaces: () => [], isDirectory: (p) => statSync(p).isDirectory(), mkdirp: (p) => void mkdirSync(p, { recursive: true }), compile: trialCompileProfile, log: () => {} })
  useGenerationFence({ profile: plan.profile, roots: { ...plan.roots, engineConfigDirectory: join(fenceHome, ".config/opencode") }, env: { HOME: fenceHome, PATH: "/usr/bin:/bin" } })
}
const {
  releaseOfficialConnectorResources,
  restoreCommittedOfficialConnectors,
  clearOfficialConnectorRuntime,
  officialConnectorConfig,
  officialConnectorPaths,
  officialRuntimeRoot,
  prepareOfficialConnector,
  removeOfficialConnector,
  restoreOfficialConnector,
} = await import("../src/main/official-connector-resources")
const { createPackageAdmissionCoordinator } = await import("../src/main/package-admission")
const { runExtensionTransaction, recoverExtensionTransactions } = await import("../src/main/ext-transaction")
const { findRecordV2, setDesiredStateV2 } = await import("../src/main/ext-receipt-v2")
const { decodePackageProfilePayloadV1, derivePayloadCapabilitiesV1 } = await import(
  "../src/shared/host-extension-package-contract/decoder"
)
const { evaluatePackageForHost } = await import("../src/main/package-installability")
const { createSidecarEnv } = await import("../src/main/sidecar-env")
import type {
  CodePuppyPackageEnvelopeV1,
  McpLocalPayloadV1,
  McpRemotePayloadV1,
} from "../src/shared/host-extension-package-contract/decoder"
let iso = "",
  root = "",
  home = ""
const pat = "github_pat_FAKE_aw256_CANARY_ONLY"
beforeEach(() => {
  available = true
  __resetCodePuppyEnvironmentForTests()
  delete process.env.CODEPUPPY_GLOBAL_DIR
  iso = mkdtempSync(join(tmpdir(), "official-connectors-"))
  home = join(iso, "home")
  mkdirSync(home)
  root = join(home, "state", "env", "dev")
  initCodePuppyEnvironment({
    isPackaged: false,
    channel: "dev",
    appDataDir: home,
    baseRoot: join(home, "state"),
    homeDir: home,
  })
  root = getCodePuppyEnvironment().mutableRoot
  installGenerationFence(iso)
})
afterEach(() => {
  clearOfficialConnectorRuntime()
  __resetCodePuppyEnvironmentForTests()
  rmSync(iso, { recursive: true, force: true })
})

// Source envelope: pinned alpha-web producer expected.mcp-remote.compiled.json.
// Only identities/payload/digests are changed to exercise this host's newly specified recipes.
// Recipe fields: github/github-mcp-server v2.0.2 docs/remote-server.md and
// docs/host-integration.md (Bearer PAT, readonly repos); DBHub v1.5.0 CLI + config/toml.
async function fixture(name: "github-official" | "dbhub-readonly" = "github-official") {
  const compiled = await Bun.file(
    resolve(
      import.meta.dir,
      "../../codepuppy-contracts-consumer/vendor/alpha-web-extension-package/expected.mcp-remote.compiled.json",
    ),
  ).json()
  const envelope = structuredClone(compiled.envelope) as CodePuppyPackageEnvelopeV1
  const payload: McpRemotePayloadV1 | McpLocalPayloadV1 =
    name === "github-official"
      ? {
          schema: "codepuppy.host-extension-package.payload.mcp-remote.v1",
          behavior: {
            officialRecipe: "github-remote-v1",
            url: "https://api.githubcopilot.com/mcp/",
            auth: "none",
            requiredSecrets: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
            headersTemplate: {
              Authorization: "Bearer {GITHUB_PERSONAL_ACCESS_TOKEN}",
              "X-MCP-Toolsets": "repos",
              "X-MCP-Readonly": "true",
            },
          },
        }
      : {
          schema: "codepuppy.host-extension-package.payload.mcp-local.v1",
          behavior: {
            officialRecipe: "dbhub-readonly-v1",
            command: ["npx", "-y", "@bytebase/dbhub@1.5.0", "--transport", "stdio"],
            environment: {},
            requiredSecrets: ["DSN"],
          },
        }
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  envelope.prelude.packageId = `package:${name}`
  envelope.root = `mcp:${name}`
  envelope.components = [
    {
      ...envelope.components[0]!,
      id: envelope.root,
      profileId: name === "github-official" ? "mcp-remote" : "mcp-local",
      capabilities: derivePayloadCapabilitiesV1(payload),
      payloadRef: {
        ...envelope.components[0]!.payloadRef,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
        mediaType: `application/vnd.codepuppy.host-extension-package.${name === "github-official" ? "mcp-remote" : "mcp-local"}.v1+json`,
      },
    },
  ]
  envelope.capabilities = envelope.components[0]!.capabilities
  return { envelope, bytes, payload }
}
async function install(version: string, value: string, refuseCommit = false) {
  const f = await fixture()
  const admit = createPackageAdmissionCoordinator({
    loadVerifiedCatalog: async () => ({
      source: "remote",
      catalog: { version: "1", entries: [{}], packages: [f.envelope] },
      snapshotDigest: "7".repeat(64),
    }),
    root: () => root,
    userDataPath: join(home, "userData"),
    casBaseRoot: () => join(home, "state"),
    environment: () => "dev",
    installability: { fetchPayload: async () => f.bytes },
    secretVersionId: () => version,
    transaction: (root, plan, hooks) =>
      runExtensionTransaction(
        root,
        plan,
        refuseCommit
          ? {
              ...hooks,
              commitReceipt: () => {
                throw Error("injected disk failure")
              },
            }
          : hooks,
      ),
  })
  const intent = { catalogId: f.envelope.prelude.packageId, scope: { scope: "global" }, attemptId: version }
  const preview = await admit(intent)
  if (preview.ok || !("authorization" in preview) || !("packageAuthorization" in preview))
    throw Error(JSON.stringify(preview))
  return admit({
    ...intent,
    grants: { secrets: { "mcp:github-official#GITHUB_PERSONAL_ACCESS_TOKEN": value } },
    authorization: {
      confirmed: Object.fromEntries(preview.authorization.map((item) => [item.key, item.requested])),
      binding: preview.packageAuthorization.binding,
    },
  })
}
function contents(dir: string): Buffer[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? contents(join(dir, entry.name)) : [readFileSync(join(dir, entry.name))],
  )
}

test("closed recipe and capability reject altered endpoint, argv, secret, auth and unknown recipe before installation", async () => {
  for (const name of ["github-official", "dbhub-readonly"] as const) {
    const f = await fixture(name)
    expect(
      decodePackageProfilePayloadV1(f.envelope.components[0]!.profileId, f.bytes, f.envelope.capabilities).ok,
    ).toBe(true)
    expect(
      decodePackageProfilePayloadV1(f.envelope.components[0]!.profileId, f.bytes, ["codepuppy.secret-prerequisite.v1"]).ok,
    ).toBe(false)
    for (const change of [
      { officialRecipe: "unknown" },
      { requiredSecrets: [] },
      ...(name === "github-official"
        ? [
            { url: "https://evil.invalid/" },
            { auth: { kind: "mcp-oauth", prerequisiteId: "auth", required: true } },
            { headersTemplate: { Authorization: "Bearer {GITHUB_PERSONAL_ACCESS_TOKEN}" } },
          ]
        : [
            { command: ["npx", "-y", "@bytebase/dbhub@0.12.0", "--readonly"] },
            { environment: { DSN: "sqlite:///secret.db" } },
          ]),
    ]) {
      const bytes = new TextEncoder().encode(
        JSON.stringify({ ...f.payload, behavior: { ...f.payload.behavior, ...change } }),
      )
      expect(
        decodePackageProfilePayloadV1(f.envelope.components[0]!.profileId, bytes, f.envelope.capabilities).ok,
      ).toBe(false)
    }
    const unknown = structuredClone(f.envelope)
    unknown.capabilities = ["codepuppy.unknown-official.v1"]
    unknown.components[0]!.capabilities = unknown.capabilities
    expect(
      (
        await evaluatePackageForHost(unknown, {
          fetchPayload: async () => {
            throw Error("must not fetch")
          },
        })
      ).verdict,
    ).toBe("update-required")
  }
})

test("encrypted HOME, 0600 ephemeral refs, no sidecar env values, restart and full cleanup preserve SQLite", () => {
  const dbfile = join(home, "user database.db")
  const db = new Database(dbfile)
  db.run("CREATE TABLE existing(id INTEGER)")
  db.close()
  const dsn = `sqlite://${dbfile}`
  for (const [name, value] of [
    ["github-official", pat],
    ["dbhub-readonly", dsn],
  ] as const) {
    prepareOfficialConnector(root, name, "v-one", value)
    const paths = officialConnectorPaths(root, name, "v-one")
    const config = officialConnectorConfig(root, name, "v-one")
    expect(readFileSync(join(paths.secret, "secret.enc")).includes(value)).toBe(false)
    expect(readFileSync(config.file, "utf8")).toBe(value)
    expect(statSync(config.file).mode & 0o777).toBe(0o600)
    expect(config.file.startsWith(home)).toBe(false)
    expect(contents(home).some((bytes) => bytes.includes(value))).toBe(false)
    expect(JSON.stringify(createSidecarEnv({ GITHUB_PERSONAL_ACCESS_TOKEN: pat, DSN: dsn }))).not.toContain(value)
    const oldRun = officialRuntimeRoot(root)
    clearOfficialConnectorRuntime()
    expect(existsSync(config.file)).toBe(false)
    expect(restoreOfficialConnector(root, name, "v-one").type).toBe(name === "github-official" ? "remote" : "local")
    clearOfficialConnectorRuntime([oldRun]) // late exit from the previous sidecar cannot erase the new generation
    expect(readFileSync(officialConnectorConfig(root, name, "v-one").file, "utf8")).toBe(value)
    removeOfficialConnector(root, name)
    expect(existsSync(paths.secret)).toBe(false)
    expect(existsSync(paths.config)).toBe(false)
  }
  expect(existsSync(dbfile)).toBe(true)
})

test("missing/ref-injected secrets, non-SQLite DSN, unavailable encryption and symlinked resources fail closed", async () => {
  for (const value of ["", " ", "{file:/etc/passwd}", "{env:TOKEN}", "bad\nheader"])
    expect(() => prepareOfficialConnector(root, "github-official", "v-bad", value)).toThrow("needs-reentry")
  for (const value of ["postgres://fake:fake@127.0.0.1/db", "sqlite://./db", "sqlite:///:memory:"])
    expect(() => prepareOfficialConnector(root, "dbhub-readonly", "v-bad", value)).toThrow("needs-reentry")
  available = false
  expect(() => prepareOfficialConnector(root, "github-official", "v-bad", pat)).toThrow("needs-reentry")
  const f = await fixture()
  expect((await evaluatePackageForHost(f.envelope, { fetchPayload: async () => f.bytes })).verdict).toBe("blocked")
  available = true
  const outside = join(iso, "outside")
  mkdirSync(outside, { mode: 0o700 })
  symlinkSync(outside, join(home, "state", "connector-secrets"))
  expect(() => prepareOfficialConnector(root, "github-official", "v-bad", pat)).toThrow("needs-reentry")
  expect(readdirSync(outside)).toEqual([])
})

test("deleted registered workspace does not block either recipe at installation", async () => {
  const { fenceWorkspaceTruthPath, writeWorkspaceTruth } = await import("../src/main/process-fence-workspaces")
  const workspace = join(home, "deleted-workspace")
  mkdirSync(workspace)
  writeWorkspaceTruth(fenceWorkspaceTruthPath(getCodePuppyEnvironment().casBaseRoot, "dev"), [workspace], {
    mkdirSync, writeFileSync, renameSync: require("node:fs").renameSync,
  })
  rmSync(workspace, { recursive: true })
  for (const name of ["github-official", "dbhub-readonly"] as const) {
    const f = await fixture(name)
    expect((await evaluatePackageForHost(f.envelope, { fetchPayload: async () => f.bytes })).verdict).toBe("compatible")
  }
})

test("real admission commits remote truth plus encrypted resource; failed replacement restores both and successful reentry retires old version", async () => {
  expect(await install("v-one", pat)).toMatchObject({ ok: true })
  const truth = join(home, "state", "mcp-servers", "dev.json")
  const before = readFileSync(truth, "utf8")
  expect(before).toContain("api.githubcopilot.com")
  expect(before).toContain("{file:")
  expect(before).not.toContain(pat)
  expect(contents(home).some((bytes) => bytes.includes(pat))).toBe(false)
  expect(await install("v-fail", pat + "REPLACEMENT", true)).toMatchObject({ ok: false })
  expect(readFileSync(truth, "utf8")).toBe(before)
  expect(existsSync(officialConnectorPaths(root, "github-official", "v-fail").secret)).toBe(false)
  expect(existsSync(officialConnectorPaths(root, "github-official", "v-one").secret)).toBe(true)
  expect(await install("v-two", pat + "NEW")).toMatchObject({ ok: true })
  expect(existsSync(officialConnectorPaths(root, "github-official", "v-one").secret)).toBe(false)
  expect(readFileSync(truth, "utf8")).toContain("v-two")
  expect(setDesiredStateV2(root, "mcp", "github-official", "enabled").ok).toBe(true)
  const old = officialConnectorConfig(root, "github-official", "v-two").file
  clearOfficialConnectorRuntime()
  restoreCommittedOfficialConnectors()
  expect(existsSync(old)).toBe(false)
  expect(readFileSync(truth, "utf8")).not.toContain(old)
})

test("desktop official package without an encrypted token stays pending after runtime restoration", async () => {
  const { installDesktopPackageV1, readPackageAuthorizationV1, savePackageSecretsV1 } = await import("../src/main/package-admission")
  const { resolveVerifiedPackageV1 } = await import("../src/main/package-installability")
  const f = await fixture()
  const catalog = { version: "r4-official", entries: [], packages: [f.envelope] }
  let version = 0
  const deps = {
    loadVerifiedCatalog: async () => ({ source: "remote" as const, catalog, snapshotDigest: "7".repeat(64) }),
    root: () => root, globalRoot: () => root, userDataPath: join(home, "userData"), casBaseRoot: () => join(home, "state"), environment: () => "dev" as const,
    installability: { fetchPayload: async () => f.bytes }, advisoryGate: () => ({ allowed: true as const }),
    resolvePackage: async (id: string, version: string) => ({ ...resolveVerifiedPackageV1(catalog, id, version), channel: "cache" as const }),
    secretVersionId: () => `v-desktop-r4-${version++}`,
  }
  expect(await installDesktopPackageV1("package:github-official", deps)).toMatchObject({ ok: true })
  clearOfficialConnectorRuntime()
  restoreCommittedOfficialConnectors()
  expect(await readPackageAuthorizationV1("package:github-official", deps)).toMatchObject({ ok: true, items: [{ kind: "secret", saved: false }] })
  expect(await savePackageSecretsV1({ packageId: "package:github-official", secrets: { "mcp:github-official#GITHUB_PERSONAL_ACCESS_TOKEN": pat } }, deps)).toMatchObject({ ok: true })
  expect(await readPackageAuthorizationV1("package:github-official", deps)).toMatchObject({ ok: true, items: [{ kind: "secret", saved: true }] })
})

// `#1724`(签名 0.2.1 实测):SQLite 包装好但还没填 DSN 时,投影只剩 `{ enabled: false }`,
// 2.x 引擎按「enabled-only legacy MCP entry」整条丢弃 —— 引擎里没有这个连接器,状态永远收不拢。
// 判据用引擎自己的归一化(`@opencode/core/config/normalize`),两次重启后仍要是完整定义;填了 DSN 后要能开起来。
test("desktop SQLite package without a DSN keeps an engine-visible definition across restarts and loads once the DSN is saved", async () => {
  const { installDesktopPackageV1, readPackageAuthorizationV1, savePackageSecretsV1 } = await import("../src/main/package-admission")
  const { resolveVerifiedPackageV1 } = await import("../src/main/package-installability")
  const { ConfigNormalize } = await import("@opencode/core/config/normalize")
  const f = await fixture("dbhub-readonly")
  const catalog = { version: "r4-official-sqlite", entries: [], packages: [f.envelope] }
  let version = 0
  const deps = {
    loadVerifiedCatalog: async () => ({ source: "remote" as const, catalog, snapshotDigest: "7".repeat(64) }),
    root: () => root, globalRoot: () => root, userDataPath: join(home, "userData"), casBaseRoot: () => join(home, "state"), environment: () => "dev" as const,
    installability: { fetchPayload: async () => f.bytes }, advisoryGate: () => ({ allowed: true as const }),
    resolvePackage: async (id: string, version: string) => ({ ...resolveVerifiedPackageV1(catalog, id, version), channel: "cache" as const }),
    secretVersionId: () => `v-desktop-sqlite-${version++}`,
  }
  const leaf = () => JSON.parse(readFileSync(join(root, "codepuppy.jsonc"), "utf8")).mcp["dbhub-readonly"] as Record<string, unknown>
  const engineKeeps = (value: Record<string, unknown>) => {
    const normalized = ConfigNormalize.normalize({ mcp: { "dbhub-readonly": value } })
    expect(normalized.diagnostics.map((item) => item.message)).not.toContain("omitted enabled-only legacy MCP entry")
    expect(normalized.type === "normalized" && JSON.stringify(normalized.encoded).includes("dbhub-readonly")).toBe(true)
  }
  expect(await installDesktopPackageV1("package:dbhub-readonly", deps)).toMatchObject({ ok: true })
  for (const _restart of [1, 2]) {
    clearOfficialConnectorRuntime()
    restoreCommittedOfficialConnectors()
    expect(leaf().enabled).toBe(false)
    engineKeeps(leaf())
  }
  expect(await readPackageAuthorizationV1("package:dbhub-readonly", deps)).toMatchObject({ ok: true, items: [{ kind: "secret", saved: false }] })
  const database = join(home, "sqlite-dsn-later.db")
  new Database(database).close()
  expect(await savePackageSecretsV1({ packageId: "package:dbhub-readonly", secrets: { "mcp:dbhub-readonly#DSN": `sqlite://${database}` } }, deps)).toMatchObject({ ok: true })
  // I-11(v9-R2):the save no longer materializes; the IPC requests convergence, whose credential step runs without an engine too.
  const { createManagedMcpConvergence } = await import("../src/main/package-mcp-activation")
  await createManagedMcpConvergence({ root: () => root, awaitServer: async () => { throw Error("no engine in this case") }, directory: () => home, userDataPath: () => join(home, "userData") })(["dbhub-readonly"])
  expect(await readPackageAuthorizationV1("package:dbhub-readonly", deps)).toMatchObject({ ok: true, items: [{ kind: "secret", saved: true }] })
  expect(leaf().enabled).not.toBe(false)
  engineKeeps(leaf())
  const { collectMcpFileRefPaths } = await import("../src/main/codepuppy-mcp-secrets")
  const refs = collectMcpFileRefPaths(leaf())
  expect(refs).toHaveLength(1)
  expect(readFileSync(refs[0]!, "utf8")).toBe(`sqlite://${database}`)
})

test("desktop official install and credential replacement do not publish a reserved remote name", async () => {
  const { installDesktopPackageV1, savePackageSecretsV1 } = await import("../src/main/package-admission")
  const { resolveVerifiedPackageV1 } = await import("../src/main/package-installability")
  const f = await fixture()
  const catalog = { version: "r4-official", entries: [], packages: [f.envelope] }
  const deps = {
    loadVerifiedCatalog: async () => ({ source: "remote" as const, catalog, snapshotDigest: "7".repeat(64) }),
    root: () => root, globalRoot: () => root, userDataPath: join(home, "userData"), casBaseRoot: () => join(home, "state"), environment: () => "dev" as const,
    installability: { fetchPayload: async () => f.bytes }, advisoryGate: () => ({ allowed: true as const }),
    resolvePackage: async (id: string, version: string) => ({ ...resolveVerifiedPackageV1(catalog, id, version), channel: "cache" as const }),
  }
  const installed = await installDesktopPackageV1("package:github-official", deps)
  expect(installed).toMatchObject({ ok: true })
  expect("warning" in installed ? installed.warning : undefined).toBeUndefined()
  const saved = await savePackageSecretsV1({ packageId: "package:github-official", secrets: { "mcp:github-official#GITHUB_PERSONAL_ACCESS_TOKEN": pat } }, deps)
  expect(saved).toMatchObject({ ok: true })
  expect("warning" in saved ? saved.warning : undefined).toBeUndefined()
})

test("prepared journal crash recovery removes only uncommitted official versions", async () => {
  prepareOfficialConnector(root, "github-official", "v-crash", pat)
  await expect(
    runExtensionTransaction(
      root,
      {
        items: [
          {
            key: "mcp--github-official",
            action: "config",
            config: {
              target: join(root, "codepuppy.jsonc"),
              edits: [{ keyPath: ["mcp", "github-official"], value: { enabled: false } }],
            },
          },
        ],
        prepared: [
          { kind: "mcp-secret-version", store: "official-connectors", server: "github-official", version: "v-crash" },
        ],
      },
      { populate: () => {}, probe: () => ({ healthy: true }), populatePrepared: () => {}, crashAt: "after-populate" },
    ),
  ).rejects.toThrow("simulated crash")
  expect(existsSync(officialConnectorPaths(root, "github-official", "v-crash").secret)).toBe(true)
  const recovered = await recoverExtensionTransactions(root, {
    pidAlive: () => false,
    probe: () => ({ healthy: true }),
    commitReceipt: () => {},
    releasePrepared: (resources) => releaseOfficialConnectorResources(join(home, "userData"), resources),
  })
  expect(recovered.ok).toBe(true)
  expect(recovered.reports.at(-1)?.action).toBe("aborted")
  expect(existsSync(officialConnectorPaths(root, "github-official", "v-crash").secret)).toBe(false)
})

test("DBHub 1.5.0 real stdio SELECT 1 succeeds, writes fail, only execute_sql exists, and uninstall preserves the database", async () => {
  // The production render (protected set empty: this case judges the TOML location only) grants all system temp writes, so a temp-only test cannot prove TOML protection.
  // `#1662`: under the shared test-isolation preload (I-08) both HOME and `userInfo().homedir` point into the
  // temp root, so the fixture lives in this package's git-ignored node_modules/.cache instead: outside every
  // writable root of the profile, and outside the developer's real HOME directories.
  const scratch = join(import.meta.dir, "..", "node_modules", ".cache")
  mkdirSync(scratch, { recursive: true })
  const ownedHome = mkdtempSync(join(scratch, "connector-256-fixture-"))
  try {
    __resetCodePuppyEnvironmentForTests()
    delete process.env.CODEPUPPY_GLOBAL_DIR
    home = ownedHome
    initCodePuppyEnvironment({
      isPackaged: false,
      channel: "dev",
      appDataDir: home,
      baseRoot: join(home, "state"),
      homeDir: home,
    })
    root = getCodePuppyEnvironment().mutableRoot
    mkdirSync(join(home, "project"))
    const database = join(home, "project", "sqlite sample.db")
    const db = new Database(database)
    db.run("CREATE TABLE original(id INTEGER)")
    db.close()
    const dsn = `sqlite://${database}`
    prepareOfficialConnector(root, "dbhub-readonly", "v-sqlite", dsn)
    const recipe = officialConnectorConfig(root, "dbhub-readonly", "v-sqlite")
    if (recipe.config.type !== "local") throw Error("wrong recipe")
    expect(recipe.config.command.join(" ")).not.toContain(dsn)
    expect(
      readFileSync(join(officialConnectorPaths(root, "dbhub-readonly", "v-sqlite").config, "dbhub.toml"), "utf8"),
    ).toBe(DBHUB_READONLY_TOML)
    // Consume the engine's actual {file:} implementation; no test-owned interpolation algorithm.
    const config = JSON.parse(
      await substituteWithEngine({
        type: "virtual",
        source: "official-test",
        dir: root,
        text: JSON.stringify(recipe.config),
      }),
    )
    const { Client } = await import(engineRequire.resolve("@modelcontextprotocol/client"))
    const { StdioClientTransport } = await import(engineRequire.resolve("@modelcontextprotocol/client/stdio"))
    const client = new Client({ name: "codepuppy-256-test", version: "1.0.0" })
    // Acquire the pinned npm fixture outside the fence, using only this test's empty npm
    // configs. Then run the real recipe offline inside the fence (no DB network permission).
    const npmEnv = {
      PATH: config.environment.PATH,
      HOME: home,
      npm_config_cache: join(tmpdir(), "codepuppy-256-npm-cache"),
      npm_config_userconfig: join(iso, "user.npmrc"),
      npm_config_globalconfig: join(iso, "global.npmrc"),
    }
    writeFileSync(npmEnv.npm_config_userconfig, "", { mode: 0o600 })
    writeFileSync(npmEnv.npm_config_globalconfig, "", { mode: 0o600 })
    const acquire = (offline: boolean) =>
      Bun.spawn({
        cmd: [
          config.command[0],
          config.command[1],
          ...(offline ? ["--offline"] : []),
          "--yes",
          "--package=@bytebase/dbhub@1.5.0",
          "--",
          config.command[0],
          "--version",
        ],
        env: npmEnv,
        stdout: "ignore",
        stderr: "ignore",
      }).exited
    if ((await acquire(true)) !== 0) expect(await acquire(false)).toBe(0)
    const fence = join(iso, "readonly.sb")
    if (process.platform === "darwin") {
      const { renderProcessFenceProfile, resolveEngineRoots } = await import("../src/main/process-fence-profile")
      writeFileSync(
        fence,
        renderProcessFenceProfile({
          workspaces: [join(home, "project")],
          codepuppyGlobalRoot: root,
          userDataPath: join(home, "userData"),
          stateHome: join(home, "userData"),
          roots: resolveEngineRoots({}, home),
          egressProxyPort: 9,
          configFence: [],
          credentialStores: [],
          homebrewFence: [],
        }),
      )
      const paths = officialConnectorPaths(root, "dbhub-readonly", "v-sqlite")
      const protectedFiles = [
        join(paths.config, "dbhub.toml"),
        join(paths.config, "work", ".env"),
        join(paths.secret, "secret.enc"),
      ]
      const probe = Bun.spawnSync({
        cmd: [
          "/usr/bin/sandbox-exec",
          "-f",
          fence,
          config.command[0],
          "-e",
          'const fs=require("node:fs"); console.log(JSON.stringify(process.argv.slice(1).map(p=>{try{fs.appendFileSync(p,"unsafe");return "written"}catch(e){return e.code}})))',
          ...protectedFiles,
        ],
        env: { PATH: process.env.PATH },
      })
      expect(probe.exitCode).toBe(0)
      expect(JSON.parse(probe.stdout.toString())).toEqual(["EPERM", "EPERM", "EPERM"])
    }
    const transport = new StdioClientTransport({
      command: process.platform === "darwin" ? "/usr/bin/sandbox-exec" : config.command[0],
      args: process.platform === "darwin" ? ["-f", fence, ...config.command] : config.command.slice(1),
      cwd: config.cwd,
      stderr: "pipe",
      env: {
        ...config.environment,
        ...npmEnv,
        npm_config_offline: "true",
      },
    })
    let diagnostic = ""
    transport.stderr?.on("data", (chunk: Buffer) => {
      diagnostic += chunk.toString()
    })
    try {
      await client.connect(transport)
      expect(client.getServerVersion()).toMatchObject({ version: "1.5.0" })
      const listed = await client.listTools()
      expect(listed.tools.map((tool: { name: string }) => tool.name)).toEqual(["execute_sql"])
      const selected = await client.callTool({ name: "execute_sql", arguments: { sql: "SELECT 1 AS aw256_ok" } })
      expect(selected.isError).not.toBe(true)
      expect(JSON.parse(selected.content[0].text).data.statements[0].rows).toEqual([{ aw256_ok: 1 }])
      const write = await client.callTool({
        name: "execute_sql",
        arguments: { sql: "CREATE TABLE aw256_should_not_exist(id INTEGER)" },
      })
      expect(write.isError).toBe(true)
      expect(JSON.parse(write.content[0].text).code).toBe("READONLY_VIOLATION")
      const independent = new Database(database, { readonly: true })
      expect(independent.query("SELECT name FROM sqlite_master WHERE name='aw256_should_not_exist'").all()).toEqual([])
      independent.close()
      expect(contents(home).some((bytes) => bytes.includes(dsn))).toBe(false)
    } catch (error) {
      throw Error(String(error) + " " + diagnostic.replaceAll(dsn, "[DSN]"))
    } finally {
      await client.close()
      await transport.close()
    }
    removeOfficialConnector(root, "dbhub-readonly")
    expect(existsSync(database)).toBe(true)
  } finally {
    clearOfficialConnectorRuntime()
    rmSync(ownedHome, { recursive: true, force: true })
  }
}, 120_000)

test("actual Node >=22.5, HOME/workspace exclusion, protected cwd and template tampering are enforced", () => {
  const previous = process.env.PATH
  const bin = join(iso, "node with spaces")
  mkdirSync(bin)
  writeFileSync(join(bin, "node"), '#!/bin/sh\nprintf "v22.4.0\\n"\n', { mode: 0o700 })
  writeFileSync(join(bin, "npx"), "#!/bin/sh\nexit 0\n", { mode: 0o700 })
  try {
    process.env.PATH = bin + ":/usr/bin:/bin"
    expect(() => officialNodeCommand()).toThrow("needs-reentry")
    writeFileSync(join(bin, "node"), '#!/bin/sh\nprintf "v22.5.0\\n"\n', { mode: 0o700 })
    expect(officialNodeCommand()[0]).toBe(join(bin, "node"))
  } finally {
    process.env.PATH = previous
  }
  const previousTmp = process.env.TMPDIR
  try {
    process.env.TMPDIR = process.env.HOME
    expect(() => officialRuntimeRoot(root)).toThrow("needs-reentry")
  } finally {
    process.env.TMPDIR = previousTmp
  }
  // Use the producer's real main-only workspace truth writer, also pinning the reader's path.
  const { fenceWorkspaceTruthPath, writeWorkspaceTruth } = require("../src/main/process-fence-workspaces")
  const truth = fenceWorkspaceTruthPath(getCodePuppyEnvironment().casBaseRoot, "dev")
  writeWorkspaceTruth(truth, [tmpdir()], { mkdirSync, writeFileSync, renameSync: require("node:fs").renameSync })
  expect(() => officialRuntimeRoot(root)).toThrow("needs-reentry")
  rmSync(truth)
  const file = join(home, 'quote " and \\ database.db')
  new Database(file).close()
  prepareOfficialConnector(root, "dbhub-readonly", "v-boundary", `sqlite://${file}`)
  const paths = officialConnectorPaths(root, "dbhub-readonly", "v-boundary")
  writeFileSync(join(paths.config, "work", ".env"), "DSN=must-not-load")
  expect(() => restoreOfficialConnector(root, "dbhub-readonly", "v-boundary")).toThrow("needs-reentry")
  rmSync(join(paths.config, "work", ".env"))
  chmodSync(join(paths.config, "dbhub.toml"), 0o600)
  writeFileSync(join(paths.config, "dbhub.toml"), DBHUB_READONLY_TOML.replace("readonly = true", "readonly = false"))
  expect(() => restoreOfficialConnector(root, "dbhub-readonly", "v-boundary")).toThrow("needs-reentry")
  const orphan = join(dirname(officialRuntimeRoot(root)), "2147483647-00000000-0000-0000-0000-000000000000")
  clearOfficialConnectorRuntime()
  mkdirSync(orphan, { mode: 0o700 })
  writeFileSync(join(orphan, "fake-secret"), pat, { mode: 0o600 })
  officialRuntimeRoot(root)
  expect(existsSync(orphan)).toBe(false)
})

// Protocol fixture copied from the official MCP 2025-06-18 lifecycle/tools examples;
// it is deliberately ExampleServer/get_weather, NOT fabricated GitHub repository output.
// https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle
// https://modelcontextprotocol.io/specification/2025-06-18/server/tools
// GitHub's exact endpoint/header recipe source: github/github-mcp-server v2.0.2
// docs/remote-server.md and docs/host-integration.md. Real PAT authorization is release evidence.
test("GitHub recipe decrypts through actual engine file substitution into HTTP headers and CONNECT permits only the official authority", async () => {
  await install("v-http", pat)
  expect(setDesiredStateV2(root, "mcp", "github-official", "enabled").ok).toBe(true)
  restoreCommittedOfficialConnectors()
  const recipe = officialConnectorConfig(root, "github-official", "v-http")
  const config = JSON.parse(
    await substituteWithEngine({
      type: "virtual",
      source: "official-test",
      dir: root,
      text: JSON.stringify(recipe.config),
    }),
  )
  expect(config.url).toBe("https://api.githubcopilot.com/mcp/")
  expect(config.oauth).toBe(false)
  const seen: Headers[] = []
  const result = {
    content: [{ type: "text", text: "Current weather in New York:\nTemperature: 72°F\nConditions: Partly cloudy" }],
    isError: false,
  }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      if (req.method !== "POST") return new Response(null, { status: 405 })
      seen.push(req.headers)
      const body = (await req.json()) as { id?: number; method: string }
      if (body.id === undefined) return new Response(null, { status: 202 })
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result:
          body.method === "initialize"
            ? {
                protocolVersion: "2025-06-18",
                capabilities: {
                  logging: {},
                  prompts: { listChanged: true },
                  resources: { subscribe: true, listChanged: true },
                  tools: { listChanged: true },
                },
                serverInfo: { name: "ExampleServer", title: "Example Server Display Name", version: "1.0.0" },
                instructions: "Optional instructions for the client",
              }
            : result,
      })
    },
  })
  const { Client, StreamableHTTPClientTransport } = await import(engineRequire.resolve("@modelcontextprotocol/client"))
  const client = new Client({ name: "official-doc-fixture", version: "1.0.0" })
  try {
    await client.connect(new StreamableHTTPClientTransport(server.url, { requestInit: { headers: config.headers } }))
    expect(await client.callTool({ name: "get_weather", arguments: { location: "New York" } })).toEqual(result)
    expect(seen.length).toBeGreaterThan(1)
    for (const headers of seen) {
      expect(headers.get("Authorization")).toBe(`Bearer ${pat}`)
      expect(headers.get("X-MCP-Toolsets")).toBe("repos")
      expect(headers.get("X-MCP-Readonly")).toBe("true")
    }
  } finally {
    await client.close()
    server.stop(true)
  }
  const { startEgressPolicyProxy } = await import("../src/main/network-egress-proxy")
  const { connect } = await import("node:net")
  const records: unknown[] = []
  const dialed: string[] = []
  const target = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket) {
        socket.end("fixture")
      },
    },
  })
  const proxy = await startEgressPolicyProxy({ resolveEgressRoutes: async () => [{ kind: "direct" }],
    log: (record) => {
      records.push(record)
    },
    dial: testEgressDial((host, port) => {
      dialed.push(`${host}:${port}`)
      return connect(target.port, "127.0.0.1")
    }),
  })
  const tunnel = (authority: string) =>
    new Promise<string>((done, reject) => {
      const socket = connect(proxy.port, "127.0.0.1", () =>
        socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`),
      )
      socket.once("data", (data) => {
        socket.destroy()
        done(data.toString())
      })
      socket.once("error", reject)
    })
  try {
    expect(await tunnel("api.githubcopilot.com:443")).toContain("200")
    expect(await tunnel("api.githubcopilot.com:444")).toContain("403")
    expect(dialed).toEqual(["api.githubcopilot.com:443"])
    expect(JSON.stringify(records)).not.toContain(pat)
  } finally {
    await proxy.close()
    target.stop(true)
  }
  expect(contents(home).some((bytes) => bytes.includes(pat))).toBe(false)
})

test("real IPC previews/cancels without secrets, installs both recipes, stops before cleanup and retries failed uninstall", async () => {
  type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
  const handlers = new Map<string, Handler>(),
    events: string[] = [],
    logs: unknown[] = []
  let current = await fixture()
  mock.module("electron", () => ({
    BrowserWindow: class {
      static fromWebContents() {
        return undefined
      }
    },
    dialog: {
      showMessageBox: async () => ({ response: 1, checkboxChecked: false }),
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    },
    ipcMain: { handle: (channel: string, handler: Handler) => handlers.set(channel, handler) },
  }))
  mock.module("../src/main/ipc", () => ({
    pickedFiles: {
      read: async () => {
        throw Error("unexpected picked file")
      },
    },
  }))
  mock.module("../src/main/logging", () => ({
    getLogger: () => ({
      log: (...args: unknown[]) => logs.push(args),
      warn: (...args: unknown[]) => logs.push(args),
      error: (...args: unknown[]) => logs.push(args),
    }),
  }))
  mock.module("../src/main/ext-advisory-gate", () => ({
    listAdvisoryBlockedFacts: () => ({ ids: [], fresh: true }),
    makeAdvisoryGate: () => () => ({ allowed: true }),
  }))
  mock.module("../src/main/remote-catalog", () => ({
    downloadRemoteAsset: async () => ({ ok: false, reason: "unexpected asset" }),
    readCachedCatalog: () => null,
    registerPackageCatalogReadIpcHandlers: () => {},
    refreshRemoteCatalog: async () => ({
      source: "remote",
      catalog: { version: "1", entries: [{}], packages: [current.envelope] },
      snapshotDigest: "7".repeat(64),
    }),
  }))
  mock.module("../src/main/ext-mcp-activation", () => ({
    verifyInstalledMcp: async (name: string) => ({ reference: name, status: "connected" }),
    probeProjectMcpActivation: async () => "unverifiable",
  }))
  const { registerExtIpcHandlers } = await import("../src/main/ext-ipc")
  const ready = registerExtIpcHandlers(
    join(home, "userData"),
    "dev",
    async () => ({ url: "http://127.0.0.1:39117", username: "opencode", password: "fake" }),
    home,
    {
      stop: async () => {
        events.push("stop")
        clearOfficialConnectorRuntime()
      },
      refresh: async () => {
        events.push("refresh")
        clearOfficialConnectorRuntime()
        try {
          restoreCommittedOfficialConnectors()
          return true
        } catch {
          return false
        }
      },
    },
    async () => undefined,
  )
  await ready.ledgerReady
  let busy = true
  const { createReloadScheduler } = await import("../../ext/src/reload-scheduler")
  // `#1662`(#1665):2.x 的调度器问进程内引擎的 `GET /api/session/active`(进程级忙闲),重载打 `POST /api/location/reload`;
  // 登记只认目录。v1 那种按实例的 `session.status` / `instance.dispose` 客户端已不存在。
  const scheduler = createReloadScheduler({
    engine: () => async (request: Request) => {
      const url = new URL(request.url)
      if (request.method === "GET" && url.pathname === "/api/session/active")
        return Response.json({ data: busy ? { ses_pending_approval: { type: "running" } } : {} })
      if (request.method === "POST" && url.pathname === "/api/location/reload") return new Response(null, { status: 204 })
      return new Response("not found", { status: 404 })
    },
    log: () => {}, error: () => {},
    report: (report) => ready.codepuppySidecar.receive({ type: "codepuppy.reload.report", ...report }, () => {}),
  })
  scheduler.register(home, {})
  ready.codepuppySidecar.attach((request) => scheduler.request(request))
  const original = globalThis.fetch
  // Catalog fetch is the external seam: production admission and both registered IPC bodies run.
  globalThis.fetch = (async () => new Response(current.bytes, { status: 200 })) as typeof fetch
  const dbfile = join(home, "ipc sqlite.db")
  new Database(dbfile).close()
  try {
    for (const name of ["github-official", "dbhub-readonly"] as const) {
      current = await fixture(name)
      const invoke = handlers.get("ext-install-catalog")!
      const intent = {
        catalogId: current.envelope.prelude.packageId,
        scope: { scope: "global" },
        attemptId: `ipc-${name}`,
      }
      const preview = (await invoke({}, intent)) as {
        authorization: { key: string; requested: string[] }[]
        packageAuthorization: { binding: unknown }
      }
      expect(preview.authorization.length).toBeGreaterThan(0)
      expect(events).toEqual([]) // cancelling here has no persistent secret and no process restart
      expect(existsSync(officialConnectorPaths(root, name, "unused").secret)).toBe(false)
      const variable = name === "github-official" ? "GITHUB_PERSONAL_ACCESS_TOKEN" : "DSN"
      const value = name === "github-official" ? pat : `sqlite://${dbfile}`
      const result = await invoke(
        {},
        {
          ...intent,
          grants: { secrets: { [`mcp:${name}#${variable}`]: value } },
          authorization: {
            confirmed: Object.fromEntries(preview.authorization.map((item) => [item.key, item.requested])),
            binding: preview.packageAuthorization.binding,
          },
        },
      )
      expect(result).toMatchObject({ ok: true, name, installedDisabled: true })
      expect(events).toEqual(["stop", "refresh"])
      events.length = 0
      const parent = join(getCodePuppyEnvironment().casBaseRoot, "connector-secrets", "dev", name)
      const versions = readdirSync(parent)
      expect(versions).toHaveLength(1)
      const paths = officialConnectorPaths(root, name, versions[0]!)
      const runtime = officialConnectorConfig(root, name, versions[0]!).file
      expect(readFileSync(runtime, "utf8")).toBe("") // disabled configs remain parseable without decrypting a secret
      expect(contents(home).some((bytes) => bytes.includes(value))).toBe(false)
      // I-11(design v9 §5「MCP 组件开关」):an official toggle is the durable write plus convergence — no reload
      // request and no restart, whether or not answers are running. The credential step follows the ledger intent.
      busy = true
      for (const [state, expected] of [["enabled", value], ["disabled", ""]] as const) {
        const toggled = await handlers.get("ext-set-install-state")!({}, { type: "mcp", name, scope: "global", state })
        expect(toggled).toMatchObject({ ok: true })
        expect(toggled).not.toHaveProperty("reason")
        await scheduler.settled()
        expect(events).toEqual([])
        expect(readFileSync(officialConnectorConfig(root, name, versions[0]!).file, "utf8")).toBe(expected)
      }
      busy = false
      // Make cleanup fail after configuration removal. The receipt must survive for retry.
      chmodSync(paths.secret, 0o755)
      expect(await handlers.get("ext-uninstall-package")!({}, `package:${name}`)).toMatchObject({ ok: false })
      expect(findRecordV2(root, "mcp", name)).not.toBeNull()
      chmodSync(paths.secret, 0o700)
      expect(await handlers.get("ext-uninstall-package")!({}, `package:${name}`)).toMatchObject({ ok: true })
      expect(events).toEqual(["stop", "refresh", "stop", "refresh"])
      events.length = 0
      expect(existsSync(paths.secret)).toBe(false)
      expect(existsSync(parent)).toBe(false)
      expect(existsSync(paths.config)).toBe(false)
      expect(existsSync(dbfile)).toBe(true)
      expect(JSON.stringify(logs)).not.toContain(value)
      if (name === "github-official")
        expect(readFileSync(join(home, "state", "mcp-servers", "dev.json"), "utf8")).not.toContain("github-official")
    }
  } finally {
    globalThis.fetch = original
  }
}, 30_000)

test("package-owned encrypted token replacement retires the old version and a failed ledger commit preserves the current value", async () => {
  const { installDesktopPackageV1, savePackageSecretsV1, readPackageAuthorizationV1 } = await import("../src/main/package-admission")
  const { resolveVerifiedPackageV1 } = await import("../src/main/package-installability")
  const { readPackageLedgerStateV1 } = await import("../src/main/ext-receipt-v2")
  const f = await fixture()
  const catalog = { version: "official-real", entries: [{}], packages: [f.envelope] }
  let version = 0
  const deps = {
    root: () => root, globalRoot: () => root, userDataPath: join(home, "userData"), casBaseRoot: () => join(home, "state"), environment: () => "dev" as const,
    loadVerifiedCatalog: async () => ({ source: "remote" as const, catalog, snapshotDigest: "d".repeat(64) }),
    installability: { fetchPayload: async () => f.bytes }, advisoryGate: () => ({ allowed: true as const }),
    resolvePackage: async (id: string, version: string) => ({ ...resolveVerifiedPackageV1(catalog, id, version), channel: "cache" as const }),
    secretVersionId: () => `v-owned-${version++}`,
  }
  expect(await installDesktopPackageV1("package:github-official", deps)).toMatchObject({ ok: true })
  const before = readPackageLedgerStateV1(root)
  const intent = (value: string) => ({ packageId: "package:github-official", secrets: { "mcp:github-official#GITHUB_PERSONAL_ACCESS_TOKEN": value } })
  expect(await savePackageSecretsV1(intent(pat), deps)).toEqual({ ok: true })
  expect(existsSync(join(officialConnectorPaths(root, "github-official", "v-owned-1").secret, "secret.enc"))).toBe(true)
  expect(await savePackageSecretsV1(intent(pat + "NEXT"), deps)).toEqual({ ok: true })
  expect(existsSync(officialConnectorPaths(root, "github-official", "v-owned-1").secret)).toBe(false)
  expect(existsSync(join(officialConnectorPaths(root, "github-official", "v-owned-2").secret, "secret.enc"))).toBe(true)
  expect(await savePackageSecretsV1(intent(pat + "FAILED"), { ...deps, transaction: (root, plan, hooks) => runExtensionTransaction(root, plan, { ...hooks, commitReceipt: () => { throw new Error("injected credential ledger failure") } }) })).toMatchObject({ ok: false })
  expect(readFileSync(officialConnectorConfig(root, "github-official", "v-owned-2").file, "utf8")).toBe(pat + "NEXT")
  expect(existsSync(join(officialConnectorPaths(root, "github-official", "v-owned-2").secret, "secret.enc"))).toBe(true)
  const after = readPackageLedgerStateV1(root)
  expect(after.ok && after.packageGraphs).toEqual(before.ok && before.packageGraphs)
  expect(after.ok && after.claims).toEqual(before.ok && before.claims)
  // A malformed user-edited runtime reference is pending, rather than an exception from the path authority.
  const { removeMcpServerRecord } = await import("../src/main/mcp-server-lifecycle")
  expect(removeMcpServerRecord("github-official").ok).toBe(true)
  writeFileSync(join(root, "codepuppy.jsonc"), JSON.stringify({ mcp: { "github-official": { type: "remote", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: `Bearer {file:${join(home, "invalid version", "GITHUB_PERSONAL_ACCESS_TOKEN")}}` } } } }))
  expect(await readPackageAuthorizationV1("package:github-official", deps)).toMatchObject({ ok: true, items: [{ kind: "secret", saved: false }] })
})


test("review official recipe installs, changes token and toggles through runtime add without engine reload", async () => {
  // Existing recipe cases deliberately exercise the real OS HOME boundary. Keep the engine's
  // process-global HOME/XDG setup in its own child, so those older controls retain their premise.
  if (process.env.CODEPUPPY_OFFICIAL_RUNTIME_CHILD !== "1") {
    const result = Bun.spawnSync({ cmd: [process.execPath, "test", "--max-concurrency", "2", "--test-name-pattern", "review official recipe", import.meta.path], cwd: resolve(import.meta.dir, ".."), env: { ...process.env, CODEPUPPY_OFFICIAL_RUNTIME_CHILD: "1" } })
    const output = result.stdout.toString() + result.stderr.toString()
    if (result.exitCode !== 0) throw Error(output)
    expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("1")
    return
  }
  const sandbox = engineSandbox()
  await assertEngineSandboxed(sandbox)
  const { buildEngineServerOptions } = await import("../src/main/engine-server-options")
  const { engineClient } = await import("../src/main/engine-client")
  const { startEngine } = await import("../engine/engine-embed")
  const { echoMcpHandler } = await import("../../core/test/fixture/mcp-echo")
  const { installDesktopPackageV1, savePackageSecretsV1 } = await import("../src/main/package-admission")
  const { resolveVerifiedPackageV1 } = await import("../src/main/package-installability")
  const { setPackageStateV1 } = await import("../src/main/ext-install-planner")
  const { createManagedMcpConvergence } = await import("../src/main/package-mcp-activation")
  const shipped = await Bun.file(join(import.meta.dir, "../src/renderer/extensions/codepuppy-catalog.json")).json()
  const envelope = shipped.packages.find((entry: CodePuppyPackageEnvelopeV1) => entry.prelude.packageId === "package:github-official")!
  // Unmodified pinned public payload, not a made-up third-party definition or a live PAT call.
  const bytes = await Bun.file(join(import.meta.dir, "../test-fixtures/plugin-helper/catalog/package-github-official.json")).bytes()
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(envelope.components[0].payloadRef.sha256)
  const catalog = { version: "official-runtime-proof", entries: [], packages: [envelope] }
  const deps = {
    loadVerifiedCatalog: async () => ({ source: "remote" as const, catalog, snapshotDigest: "7".repeat(64) }),
    root: () => root, globalRoot: () => root, userDataPath: join(home, "userData"), casBaseRoot: () => join(home, "state"), environment: () => "dev" as const,
    installability: { fetchPayload: async () => bytes }, advisoryGate: () => ({ allowed: true as const }),
    resolvePackage: async (id: string, version: string) => ({ ...resolveVerifiedPackageV1(catalog, id, version), channel: "cache" as const }),
  }
  const slot = engineSlot(sandbox, "official-runtime")
  const observer = join(iso, "observer")
  mkdirSync(observer)
  writeFileSync(join(observer, "server.js"), `
import {Schema} from ${JSON.stringify(import.meta.resolve("effect"))}
let setups=0
export default {id:"test.official-runtime",setup:async(ctx)=>{
 const setup=++setups
 await ctx.rpc.register({id:"official-runtime",methods:{tools:{input:Schema.Undefined,output:Schema.Unknown},call:{input:Schema.String,output:Schema.Unknown}},events:{}},{
 tools:async()=>({setup,names:(await ctx.tool.list()).filter(t=>t.options?.namespace==="github-official").map(t=>t.name)}),
 call:async(sessionID)=>(await ctx.tool.list()).find(t=>t.options?.namespace==="github-official").execute({message:"runtime official proof"},{sessionID,agent:"build",messageID:"msg_official",id:"call_official",signal:new AbortController().signal,progress:async()=>{}})
 })
}}`)
  const echo = echoMcpHandler()
  const originalFetch = globalThis.fetch
  let expected = pat
  let authenticated = 0
  globalThis.fetch = (async (input, init) => {
    const request = new Request(input, init)
    if (new URL(request.url).hostname !== "api.githubcopilot.com") return originalFetch(input, init)
    if (request.headers.get("authorization") !== `Bearer ${expected}`) return new Response(null, { status: 401 })
    authenticated++
    return echo.fetch(request)
  }) as typeof fetch
  const previous = process.cwd()
  process.chdir(slot.projectDirectory)
  let reloads = 0
  const engine = await startEngine(buildEngineServerOptions({ hostname: "127.0.0.1", port: 0, password: "official-runtime-proof", engineVersion: "test", databasePath: slot.databasePath, configDirectory: slot.configDirectory, config: { content: JSON.stringify({ plugins: [observer] }) }, models: { fetch: false }, filewatcher: false, platform: process.platform }), { packageManagerEnvironment: {}, projectTrust: () => true, onDispatch: dispatch => async request => { if (new URL(request.url).pathname.endsWith("/location/reload")) reloads++; return dispatch(request) } })
  try {
    const connection = { url: engine.url, username: "opencode", password: "official-runtime-proof" }
    const client = engineClient(connection)
    const session = await client.session.create({ permissions: [{ action: "*", resource: "*", effect: "allow" }] })
    for (const end = Date.now() + 10000; ; await Bun.sleep(20)) {
      if ((await client.plugin.list()).data.some(plugin => plugin.id === "test.official-runtime" && plugin.state.status === "active")) break
      if (Date.now() > end) throw Error("official runtime observer not active")
    }
    const tools = async () => (await client.rpc.call({ rpcID: "official-runtime", method: "tools" })).output as { setup: number; names: string[] }
    const waitForTools = async (present: boolean) => {
      for (const end = Date.now() + 10000; ; await Bun.sleep(25)) {
        if (((await tools()).names.length > 0) === present) return
        if (Date.now() > end) throw Error("Official tool inventory did not settle: " + JSON.stringify((await client.mcp.list()).data.map(server => ({ name: server.name, status: server.status.status }))))
      }
    }
    const before = await tools()
    expect(before.names).toEqual([])
    expect(await installDesktopPackageV1("package:github-official", deps)).toMatchObject({ ok: true })
    mkdirSync(deps.userDataPath, { recursive: true }) // main's userData always exists; the credential stores (none here) live in it
    const converge = createManagedMcpConvergence({ root: () => root, awaitServer: async () => connection, directory: () => slot.projectDirectory, userDataPath: () => deps.userDataPath })
    const apply = () => converge(["github-official"])
    await apply()
    expect((await tools()).names).toEqual([])
    const save = (value: string) => savePackageSecretsV1({ packageId: "package:github-official", secrets: { "mcp:github-official#GITHUB_PERSONAL_ACCESS_TOKEN": value } }, deps)
    expect(await save(pat)).toMatchObject({ ok: true })
    await apply()
    await waitForTools(true)
    expect((await tools()).names.length).toBeGreaterThan(0)
    expect((await client.rpc.call({ rpcID: "official-runtime", method: "call", input: session.id })).output.isError).not.toBe(true)
    expected = pat + "REPLACEMENT"
    const priorRequests = authenticated
    expect(await save(expected)).toMatchObject({ ok: true })
    await apply()
    expect(authenticated).toBeGreaterThan(priorRequests)
    await waitForTools(true)
    expect((await tools()).names.length).toBeGreaterThan(0)
    for (const state of ["disabled", "enabled"] as const) {
      expect(await setPackageStateV1({ packageId: "package:github-official", state }, deps)).toMatchObject({ ok: true })
      await apply()
      await waitForTools(state === "enabled")
      expect((await tools()).names.length > 0).toBe(state === "enabled")
    }
    expect((await tools()).setup).toBe(before.setup)
    expect(reloads).toBe(0)
  } finally { await engine.close(); process.chdir(previous); globalThis.fetch = originalFetch; await echo.close() }
}, 60000)

// ── I-11 方案 A(alpha-code#1724;design v9 §4.4 / §5):官方配方的开关只经 convergeManagedMcp ────────────────────
/** The unmodified pinned public package:github-official payload (same as the review case above). */
async function githubOfficialDeps(rootOf: () => string, homeOf: () => string) {
  const { resolveVerifiedPackageV1 } = await import("../src/main/package-installability")
  const shipped = await Bun.file(join(import.meta.dir, "../src/renderer/extensions/codepuppy-catalog.json")).json()
  const envelope = shipped.packages.find((entry: CodePuppyPackageEnvelopeV1) => entry.prelude.packageId === "package:github-official")!
  const bytes = await Bun.file(join(import.meta.dir, "../test-fixtures/plugin-helper/catalog/package-github-official.json")).bytes()
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(envelope.components[0].payloadRef.sha256)
  const catalog = { version: "i11-official", entries: [], packages: [envelope] }
  return {
    loadVerifiedCatalog: async () => ({ source: "remote" as const, catalog, snapshotDigest: "7".repeat(64) }),
    root: rootOf, globalRoot: rootOf, userDataPath: join(homeOf(), "userData"), casBaseRoot: () => getCodePuppyEnvironment().casBaseRoot, environment: () => "dev" as const,
    installability: { fetchPayload: async () => bytes }, advisoryGate: () => ({ allowed: true as const }),
    resolvePackage: async (id: string, version: string) => ({ ...resolveVerifiedPackageV1(catalog, id, version), channel: "cache" as const }),
  }
}

test("I-11 proof 7: a project-only dbhub whose SQLite file moved stays off in its matching project after startup; back in place, convergence turns it on", async () => {
  const { installDesktopPackageV1, savePackageSecretsV1 } = await import("../src/main/package-admission")
  const { resolveVerifiedPackageV1 } = await import("../src/main/package-installability")
  const { createManagedMcpConvergence } = await import("../src/main/package-mcp-activation")
  const { officialAvailabilityPublished } = await import("../src/main/official-connector-resources")
  const { projectScopeIdentity } = await import("../src/main/ext-receipt-v2")
  const { readPackageAllowSet } = await import("../../ext/src/gen-skill-paths")
  const { managedMcpAllowedHere } = await import("../../ext/src/package-scope")
  const f = await fixture("dbhub-readonly")
  const catalog = { version: "i11-project-sqlite", entries: [], packages: [f.envelope] }
  const project = join(home, "project-a")
  mkdirSync(project)
  const identity = projectScopeIdentity(project)
  if (!identity.ok) throw Error(identity.reason)
  const deps = {
    loadVerifiedCatalog: async () => ({ source: "remote" as const, catalog, snapshotDigest: "7".repeat(64) }),
    root: () => root, globalRoot: () => root, userDataPath: join(home, "userData"), casBaseRoot: () => join(home, "state"), environment: () => "dev" as const,
    installability: { fetchPayload: async () => f.bytes }, advisoryGate: () => ({ allowed: true as const }),
    resolvePackage: async (id: string, version: string) => ({ ...resolveVerifiedPackageV1(catalog, id, version), channel: "cache" as const }),
    effect: identity.scope,
  }
  expect(await installDesktopPackageV1("package:dbhub-readonly", deps)).toMatchObject({ ok: true })
  const database = join(home, "project-a.db")
  new Database(database).close()
  expect(await savePackageSecretsV1({ packageId: "package:dbhub-readonly", secrets: { "mcp:dbhub-readonly#DSN": `sqlite://${database}` } }, deps)).toMatchObject({ ok: true })
  const converge = createManagedMcpConvergence({ root: () => root, awaitServer: async () => { throw Error("no engine in this case") }, directory: () => home, userDataPath: () => join(home, "userData") })
  await converge(["dbhub-readonly"])
  const allowedInProject = () => managedMcpAllowedHere("dbhub-readonly", readPackageAllowSet(root), identity.scope.projectPath)
  expect(allowedInProject()).toBe(true)
  renameSync(database, database + ".moved")
  // The next generation's pre-fork recovery (server.ts): restore, then wait for the allow-set republish before forking.
  clearOfficialConnectorRuntime()
  restoreCommittedOfficialConnectors()
  await officialAvailabilityPublished()
  expect(findRecordV2(root, "mcp", "dbhub-readonly")?.desiredState).toBe("enabled")
  expect(readPackageAllowSet(root)?.scoped.some((entry) => entry.name === "dbhub-readonly")).toBe(false)
  expect(allowedInProject()).toBe(false)
  renameSync(database + ".moved", database)
  await converge(["dbhub-readonly"])
  expect(allowedInProject()).toBe(true)
})

test("I-11 ruling 1: a convergence parked across a startup recovery cannot leave a stale credential clear behind", async () => {
  const { installDesktopPackageV1, savePackageSecretsV1 } = await import("../src/main/package-admission")
  const { setPackageStateV1 } = await import("../src/main/ext-install-planner")
  const { createManagedMcpConvergence } = await import("../src/main/package-mcp-activation")
  const { officialAvailabilityPublished } = await import("../src/main/official-connector-resources")
  const { readMcpLeafStrict } = await import("../src/main/ext-config")
  const { collectMcpFileRefPaths } = await import("../src/main/codepuppy-mcp-secrets")
  const { readPackageAllowSet } = await import("../../ext/src/gen-skill-paths")
  const deps = await githubOfficialDeps(() => root, () => home)
  expect(await installDesktopPackageV1("package:github-official", deps)).toMatchObject({ ok: true })
  expect(await savePackageSecretsV1({ packageId: "package:github-official", secrets: { "mcp:github-official#GITHUB_PERSONAL_ACCESS_TOKEN": pat } }, deps)).toMatchObject({ ok: true })
  const credential = () => {
    const leaf = readMcpLeafStrict("github-official")
    if (!leaf.ok || !leaf.value) throw Error("official leaf missing")
    return readFileSync(collectMcpFileRefPaths(leaf.value)[0]!, "utf8")
  }
  const engine = Promise.withResolvers<{ url: string; username: string; password: string }>()
  mkdirSync(deps.userDataPath, { recursive: true }) // main's userData always exists; the credential stores (none here) live in it
  const converge = createManagedMcpConvergence({ root: () => root, awaitServer: () => engine.promise, directory: () => home, userDataPath: () => deps.userDataPath })
  // Run 1 reads the intent "disabled" when it starts and parks on the engine (it clears only after disconnecting).
  expect(await setPackageStateV1({ packageId: "package:github-official", state: "disabled" }, deps)).toMatchObject({ ok: true })
  const disabling = converge(["github-official"])
  await Bun.sleep(50)
  // The user turns it back on; that request is coalesced into one rerun behind run 1.
  expect(await setPackageStateV1({ packageId: "package:github-official", state: "enabled" }, deps)).toMatchObject({ ok: true })
  const enabling = converge(["github-official"])
  // A sidecar respawn's pre-fork recovery runs now, outside the queue: synchronous, by the ledger intent.
  clearOfficialConnectorRuntime()
  restoreCommittedOfficialConnectors()
  await officialAvailabilityPublished()
  expect(credential()).toBe(pat)
  engine.reject(Error("engine restarting"))
  await Promise.all([disabling, enabling])
  expect(credential()).toBe(pat)
  expect(readPackageAllowSet(root)?.mcp).toEqual(expect.arrayContaining([{ name: "github-official", enabled: true }]))
})

test("I-11 official GitHub engine: off at startup, on at runtime without a restart; a failed disable write keeps the credential; later Locations follow", async () => {
  if (process.env.CODEPUPPY_OFFICIAL_RUNTIME_CHILD !== "1") {
    const result = Bun.spawnSync({ cmd: [process.execPath, "test", "--test-name-pattern", "I-11 official GitHub engine", import.meta.path], cwd: resolve(import.meta.dir, ".."), env: { ...process.env, CODEPUPPY_OFFICIAL_RUNTIME_CHILD: "1" } })
    const output = result.stdout.toString() + result.stderr.toString()
    if (result.exitCode !== 0) throw Error(output)
    expect(output.match(/(\d+) pass\b/)?.[1], output).toBe("1")
    return
  }
  const fs = await import("node:fs")
  const { spyOn } = await import("bun:test")
  const { codepuppyEngine, probeSetups, scriptedModel } = await import("./codepuppy-engine")
  const { echoMcpHandler } = await import("../../core/test/fixture/mcp-echo")
  const { installDesktopPackageV1, savePackageSecretsV1 } = await import("../src/main/package-admission")
  const { setPackageStateV1 } = await import("../src/main/ext-install-planner")
  const { createManagedMcpConvergence } = await import("../src/main/package-mcp-activation")
  const { officialAvailabilityPublished } = await import("../src/main/official-connector-resources")
  const { readMcpLeafStrict } = await import("../src/main/ext-config")
  const { collectMcpFileRefPaths } = await import("../src/main/codepuppy-mcp-secrets")
  const sandbox = engineSandbox()
  await assertEngineSandboxed(sandbox)
  const name = "official-i11"
  __resetCodePuppyEnvironmentForTests()
  delete process.env.CODEPUPPY_GLOBAL_DIR
  initCodePuppyEnvironment({ isPackaged: false, channel: "dev", appDataDir: join(sandbox.root, `${name}-app`), baseRoot: join(sandbox.root, `${name}-state`, "codepuppy-state"), homeDir: sandbox.home })
  const globalRoot = getCodePuppyEnvironment().mutableRoot
  const deps = await githubOfficialDeps(() => globalRoot, () => join(sandbox.root, `${name}-app`))
  expect(await installDesktopPackageV1("package:github-official", deps)).toMatchObject({ ok: true })
  expect(await savePackageSecretsV1({ packageId: "package:github-official", secrets: { "mcp:github-official#GITHUB_PERSONAL_ACCESS_TOKEN": pat } }, deps)).toMatchObject({ ok: true })
  expect(await setPackageStateV1({ packageId: "package:github-official", state: "disabled" }, deps)).toMatchObject({ ok: true })
  // This generation's pre-fork recovery (server.ts) with the connector off.
  clearOfficialConnectorRuntime()
  restoreCommittedOfficialConnectors()
  await officialAvailabilityPublished()
  const echo = echoMcpHandler()
  const originalFetch = globalThis.fetch
  let unauthorized = 0
  let toolCalls = 0
  globalThis.fetch = (async (input, init) => {
    const request = new Request(input, init)
    if (new URL(request.url).hostname !== "api.githubcopilot.com") return originalFetch(input, init)
    if (request.headers.get("authorization") !== `Bearer ${pat}`) {
      unauthorized++
      return new Response(null, { status: 401 })
    }
    if (request.method === "POST" && (await request.clone().text()).includes('"tools/call"')) toolCalls++
    return echo.fetch(request)
  }) as typeof fetch
  const model = scriptedModel()
  const host = codepuppyEngine({ sandbox, name, modelBaseURL: model.baseURL })
  expect(host.injection.config.content).toContain("api.githubcopilot.com")
  const running = await host.start()
  try {
    const connection = { url: running.url, username: "opencode", password: `cp-${name}` }
    const converge = createManagedMcpConvergence({ root: () => globalRoot, awaitServer: async () => connection, directory: () => host.projectDirectory, userDataPath: () => host.userData })
    const at = (directory: string) => async (method: string, route: string, body?: unknown) => {
      const response = await running.fetch(new Request(`http://codepuppy-sidecar.invalid${route}`, {
        method, headers: { "x-opencode-directory": encodeURIComponent(directory), "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }))
      const raw = await response.text()
      return raw ? JSON.parse(raw) : undefined
    }
    const status = async (directory: string) => ((await at(directory)("GET", "/api/mcp"))?.data ?? []).find((server: { name: string }) => server.name === "github-official")?.status.status as string | undefined
    const settle = async (directory: string, want: string) => {
      let seen = await status(directory)
      for (const end = Date.now() + 15000; seen !== want && Date.now() < end; await Bun.sleep(100)) seen = await status(directory)
      return seen
    }
    const open = async (directory: string) => {
      fs.mkdirSync(directory, { recursive: true })
      return (await at(directory)("POST", "/api/session", { location: { directory }, model: { id: "m", providerID: "codepuppy" } })).data as { id: string }
    }
    const call = async (sessionID: string) => {
      const send = at(host.projectDirectory)
      await send("POST", `/api/session/${sessionID}/prompt`, { text: `CP-CALL ${JSON.stringify({ name: "execute", args: { code: 'return await tools["github-official"].echo({})' } })}` })
      await send("POST", `/api/experimental/session/${sessionID}/wait`)
      return toolCalls
    }
    const toggle = async (state: "enabled" | "disabled") => {
      const result = await setPackageStateV1({ packageId: "package:github-official", state }, deps)
      await converge(["github-official"])
      return result
    }
    const credential = () => {
      const leaf = readMcpLeafStrict("github-official")
      if (!leaf.ok || !leaf.value) throw Error("official leaf missing")
      return readFileSync(collectMcpFileRefPaths(leaf.value)[0]!, "utf8")
    }
    const session = await open(host.projectDirectory)
    expect(await settle(host.projectDirectory, "disabled")).toBe("disabled")
    const setups = probeSetups()
    // Proof 4 (official): off at startup → on at runtime → callable from the existing session; a later Location follows.
    expect(await toggle("enabled")).toMatchObject({ ok: true })
    expect(await settle(host.projectDirectory, "connected")).toBe("connected")
    expect(await call(session.id)).toBe(1)
    const later = join(sandbox.root, `${name}-later`)
    await open(later)
    expect(await settle(later, "connected")).toBe("connected")
    // Proof 8: the disable's config write fails after the ledger write; the ledger rolls back to on. The credential
    // must survive (clearing never follows the request's direction) and a Location loaded afterwards still connects.
    const rename = fs.renameSync
    let failed = 0
    const failing = spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === join(globalRoot, "codepuppy.jsonc") && failed++ === 0) throw new Error("injected config write failure")
      return rename(from, to)
    })
    try {
      expect((await toggle("disabled")).ok).toBe(false)
    } finally {
      failing.mockRestore()
    }
    expect(failed).toBe(1)
    expect(findRecordV2(globalRoot, "mcp", "github-official")?.desiredState).toBe("enabled")
    expect(credential()).toBe(pat)
    const third = join(sandbox.root, `${name}-third`)
    await open(third)
    expect(await settle(third, "connected")).toBe("connected")
    // Proof 4 (official), other direction: off → the existing session no longer reaches it.
    expect(await toggle("disabled")).toMatchObject({ ok: true })
    expect(await settle(host.projectDirectory, "disabled")).toBe("disabled")
    expect(await call(session.id)).toBe(1)
    expect(credential()).toBe("")
    expect(unauthorized).toBe(0)
    // Only the two Locations this test opened ran plugin setup; no existing Location was rebuilt.
    expect(probeSetups()).toBe(setups + 2)
  } finally {
    await running.close()
    model.stop()
    globalThis.fetch = originalFetch
    await echo.close()
  }
}, 120_000)
