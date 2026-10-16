import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { join, resolve } from "node:path"
import type { HubViewDeps } from "../../../packages/ui-mac/src/main/hub-view"
import type { RemoteCatalogResult } from "../../../packages/ui-mac/src/main/remote-catalog"

const root = resolve(import.meta.dir, "../../..")
const scratch = mkdtempSync(join(import.meta.dir, ".runtime-"))
process.env.ALPHA_GLOBAL_DIR = join(scratch, "env/prod")
// The npm electron entry otherwise bootstraps a missing binary on import. No runtime is needed.
process.env.ELECTRON_OVERRIDE_DIST_PATH = scratch
mkdirSync(process.env.ALPHA_GLOBAL_DIR, { recursive: true })

try {
  const { refreshRemoteCatalog } = await import("../../../packages/ui-mac/src/main/remote-catalog")
  const { fetchPackagePayload } = await import("../../../packages/ui-mac/src/main/package-installability")
  const { channelStatePath, BUILTIN_CATALOG_PUBKEY_B64 } = await import(
    "../../../packages/ui-mac/src/main/catalog-channels"
  )
  const { createHubViewService } = await import("../../../packages/ui-mac/src/main/hub-view")
  const { buildHubViewReply, parseHubViewReply } = await import(
    "../../../packages/ui-mac/src/main/alpha-sidecar-messages"
  )
  const { createHubTools, HUB_PRICE_NOTE_MISSING } = await import("../../../packages/ext/src/hub-tools")
  const requests: Array<{ url: string; status: number; bytes: number; sha256: string }> = []
  const payloads: Array<{ id: string; holdUsd: number; payloadSha256: string; payloadBytes: number }> = []
  const fetched: RemoteCatalogResult[] = []
  const responseBytes = new Map<string, Uint8Array>()
  const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex")
  // Pass through to real fetch; reject credentials and writes before any request is sent.
  const publicFetch = (async (input, init) => {
    assert.equal(typeof input, "string")
    const url = new URL(String(input))
    assert.equal(url.origin, "https://codepuppy.cn")
    assert.ok(url.pathname.startsWith("/catalog/"))
    assert.equal(url.username + url.password, "")
    assert.equal(init?.method ?? "GET", "GET")
    assert.equal(new Headers(init?.headers).has("authorization"), false)
    assert.equal(new Headers(init?.headers).has("cookie"), false)
    const response = await fetch(input, { ...init, credentials: "omit" })
    const bytes = new Uint8Array(await response.clone().arrayBuffer())
    responseBytes.set(String(input), bytes)
    requests.push({ url: String(input), status: response.status, bytes: bytes.length, sha256: sha256(bytes) })
    return response
  }) as typeof fetch

  // This production closure is local to Electron initialization, not exported. Execute its
  // exact source without importing ext-ipc's application startup or copying its projection.
  const source = (await Bun.file(join(root, "packages/ui-mac/src/main/ext-ipc.ts")).text()).match(
    /  const resolveEffectiveCatalog = async \(\): Promise<\{[\s\S]+?\n  }\n/,
  )?.[0]
  assert.ok(source, "production resolveEffectiveCatalog closure must be present")
  const resolveEffectiveCatalog = new Function(
    "refreshRemoteCatalog",
    "userDataPath",
    "registryChannel",
    "bundledCatalogJson",
    new Bun.Transpiler({ loader: "ts" }).transformSync(source) + "\nreturn resolveEffectiveCatalog",
  )(
    async (userDataPath: string, channel: "stable") => {
      const result = await refreshRemoteCatalog(userDataPath, channel, {
        fetchImpl: publicFetch,
        packageInstallability: {
          fetchPayload: (ref) => fetchPackagePayload(ref, publicFetch),
          accepted(facts) {
            facts.components
              .filter((item) => item.payload.schema === "alpha.host-extension-package.payload.cloud.v1")
              .forEach((item) => {
                if (item.payload.schema !== "alpha.host-extension-package.payload.cloud.v1") return
                payloads.push({
                  id: item.component.id,
                  holdUsd: item.payload.behavior.holdUsd,
                  payloadSha256: item.component.payloadRef.sha256,
                  payloadBytes: item.component.payloadRef.bytes,
                })
              })
          },
        },
      })
      assert.equal(result.source, "remote", "fresh signed remote required; no cache/bundled fallback")
      assert.ok(result.source !== "none")
      assert.equal(result.via, "channel-stable")
      assert.equal(result.channel, "stable")
      assert.equal(result.version, "2026-10-15.3")
      assert.equal(result.error, undefined)
      assert.ok(result.snapshotDigest)
      fetched.push(result)
      return result
    },
    join(scratch, "catalog"),
    "stable",
    undefined,
  ) as HubViewDeps["resolveCatalog"]
  const catalog = await resolveEffectiveCatalog()
  assert.ok(catalog)
  assert.equal(fetched.length, 1)
  const service = createHubViewService({
    resolveCatalog: async () => catalog,
    advisoryBlocked: () => new Set(),
    seedDir: null,
    globalRoot: () => process.env.ALPHA_GLOBAL_DIR!,
    projectEntry: () => ({ ok: false, reason: "isolated browse-only directory" }),
    defaultDirectory: () => scratch,
    projectMcpState: async () => {
      throw new Error("no installed MCP may be probed")
    },
    awaitServer: async () => {
      throw new Error("no engine may be contacted")
    },
    pendingFor: () => undefined,
    fetch: publicFetch,
  })
  const tools = createHubTools({
    available: true,
    async view(input) {
      const reply = parseHubViewReply(buildHubViewReply(1, { view: await service.viewForAgent(input) }))
      assert.ok(reply && "view" in reply)
      return { ok: true, view: reply.view }
    },
    request: async () => {
      throw new Error("installation is forbidden")
    },
    report: () => {
      throw new Error("reload is forbidden")
    },
    onReloadRequest: () => {
      throw new Error("reload is forbidden")
    },
  })
  const ctx = {
    directory: scratch,
    worktree: scratch,
    sessionID: "ses_ac1533",
    messageID: "msg_ac1533",
    agent: "build",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {
      throw new Error("authorization is forbidden")
    },
  }
  const queries = await Promise.all(
    ["cloud:html", "cloud:image", "package:cloud-html", "package:cloud-image", "cloud"].map(async (query) => {
      const answer = await tools.hub_search.execute({ query }, ctx)
      assert.ok(typeof answer !== "string")
      assert.equal(answer.metadata.ok, true)
      return { query, output: answer.output }
    }),
  )
  const rows = queries[4]!.output
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))
  const priced = ["cloud:html", "cloud:image"].map((id, index) => {
    const payload = payloads.find((item) => item.id === id)
    assert.ok(payload, `${id}: real cloud@1 payload must have passed production integrity and decoding`)
    const pkg = catalog.packages?.find((item) => item.components.some((component) => component.componentId === id))
    assert.ok(pkg)
    const row = rows.find((item) => item.id === pkg.catalogId)
    assert.ok(row, `${id}: corresponding package row must appear`)
    assert.equal(row.priceNote, `预留 US$${payload.holdUsd.toFixed(2)},按实际用量结算;失败时已产生的费用仍会结算。`)
    assert.equal(JSON.parse(queries[index + 2]!.output).priceNote, row.priceNote)
    assert.equal(queries[index + 2]!.output.includes(HUB_PRICE_NOTE_MISSING), false)
    assert.equal(row.installed, false)
    return {
      ...payload,
      queryRowId: row.id,
      priceNote: row.priceNote,
      componentRowPresent: rows.some((item) => item.id === id),
    }
  })
  const missing = rows.filter((row) => row.type === "cloud" && row.priceNote === undefined).map((row) => row.id)
  assert.ok(missing.length > 0, "use real unpriced cloud entries; never fabricate a catalog row")
  assert.equal(queries[4]!.output.split("\n").at(-1), HUB_PRICE_NOTE_MISSING)
  assert.equal(queries[4]!.output.split("\n").filter((line) => line === HUB_PRICE_NOTE_MISSING).length, 1)
  const state = await Bun.file(channelStatePath(join(scratch, "catalog"))).text()
  await Bun.write(join(import.meta.dir, "signed-state.json"), state + "\n")
  await Promise.all(
    priced.map(async (item) => {
      const request = requests.find((request) => request.sha256 === item.payloadSha256)
      assert.ok(request)
      await Bun.write(
        join(import.meta.dir, `${item.id.replace(":", "-")}.payload.json`),
        responseBytes.get(request.url)!,
      )
    }),
  )
  const output = {
    observedAt: new Date().toISOString(),
    sourceCommit: Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root }).stdout.toString().trim(),
    hostVersion: (await Bun.file(join(root, "packages/ui-mac/package.json")).json()).version,
    catalogVersion: catalog.version,
    source: fetched[0]!.source,
    via: "channel-stable",
    signature:
      "PASS: built-in Ed25519 trust → coherent snapshot → stable → catalog; payload SHA-256 + byte length + cloud@1 decoder",
    builtinPublicKey: BUILTIN_CATALOG_PUBKEY_B64,
    snapshotDigest: fetched[0]!.source !== "none" ? fetched[0]!.snapshotDigest : undefined,
    resolverSourceSha256: sha256(source),
    requests: requests.sort((a, b) => a.url.localeCompare(b.url)),
    priced,
    missing,
    missingNotice: HUB_PRICE_NOTE_MISSING,
    queries,
    assertions: {
      packagePriceNotesMatchHoldUsd: true,
      pricedOnlyQueriesHaveNoMissingNotice: true,
      realUnpricedCloudEntriesHaveOneTrailingMissingNotice: true,
      requestedComponentRowsPresent: priced.every((item) => item.componentRowPresent),
    },
  }
  await Bun.write(join(import.meta.dir, "output.json"), JSON.stringify(output, null, 2) + "\n")
  console.log(JSON.stringify(output, null, 2))
  assert.ok(
    output.assertions.requestedComponentRowsPresent,
    "BLOCKED: cloud:html / cloud:image are package components, absent as uninstalled catalog rows; exact component queries have no matches",
  )
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
