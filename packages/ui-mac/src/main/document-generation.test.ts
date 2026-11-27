// Integration layer: the production document composition on one generation — real runtime, host and main bridge answering the
// real ext host bridge over a paired port — plus its connector-launch row (#1760 Q1). Only the LibreOffice download, unpack and
// fixed verification are controlled at their own boundaries; no Electron, LibreOffice or network.
import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { chmodSync, copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHubBridge, type HubPort } from "../../../ext/src/hub-bridge"
import { createDocumentHostBridge } from "../../../ext/src/document-host-bridge"
import { DOCUMENT_RUNTIME_LAUNCH_SERVER, type DocumentCaller, type DocumentRuntimeVerifyReceipt, type DocumentRuntimeVerifyTask } from "../../../util/src/codepuppy-document"
import type { PinnedFiles } from "../../../util/src/codepuppy-pinned-files"
import { createConnectorLaunchState } from "./connector-launch-state"
import { openDocumentGeneration } from "./document-generation"
import { officePythonPath } from "./document-resources"

const roots: string[] = []
const generations: ReturnType<typeof openDocumentGeneration>[] = []
afterEach(async () => {
  for (const generation of generations.splice(0)) await generation.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
// Our own manifest contract with a controlled file boundary, not a published release claim.
const pin = { id: "libreoffice/darwin-arm64/test-version", family: "libreoffice", target: "darwin-arm64", version: "test-version", originUrl: "https://github.com/test/test/releases/download/test-version/fixture.dmg", provenanceUrl: "https://example.org/fixture", sha256: "a".repeat(64), bytes: 1 } as const
const pdf = join(import.meta.dir, "fixtures/document-runtime/control.pdf")

test("one generation answers the ext host, shows its preparation as one launch row, and that row's retry restarts the real runtime", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "document-generation-"))); roots.push(root)
  const resourcesRoot = join(root, "resources")
  cpSync(join(import.meta.dir, "fixtures/document-assets"), join(resourcesRoot, "document-assets"), { recursive: true })
  mkdirSync(join(resourcesRoot, "document-assets", "node_modules"), { recursive: true })
  mkdirSync(join(resourcesRoot, "office-runtime", "bin"), { recursive: true })
  cpSync(join(import.meta.dir, "fixtures/office-python-darwin-arm64.header.bin"), officePythonPath(join(resourcesRoot, "office-runtime"), "darwin"))
  chmodSync(officePythonPath(join(resourcesRoot, "office-runtime"), "darwin"), 0o755)
  mkdirSync(join(resourcesRoot, "factory-skills", "office-docs"), { recursive: true })
  cpSync(join(import.meta.dir, "../../resources/document-runtime"), join(resourcesRoot, "document-runtime"), { recursive: true })
  const workspace = join(root, "workspace"); mkdirSync(workspace)
  const caller = { location: { directory: workspace }, sessionID: "ses_document" } as DocumentCaller
  let downloads = 0
  const launches = createConnectorLaunchState("3", {
    retry: async () => { throw Error("the document row must not restart a connector") },
    diagnostic: async () => ({ ok: false, error: "unavailable" }),
    openNetworkApproval: async () => ({ ok: false, error: "unavailable" }),
    chooseWorkspace: async () => ({ ok: false, error: "unavailable" }),
  })
  const generation = openDocumentGeneration({
    sidecarGeneration: 3, userData: root, resourcesRoot, packaged: true, platform: "darwin-arm64",
    documents: { python: process.execPath, assets: join(resourcesRoot, "document-assets"), templates: join(resourcesRoot, "document-assets", "templates"), documentRuntimeRoot: join(root, "document-runtime"), verify: "unused", render: "unused", recalculate: "unused", libreoffice: [pin] },
    manifest: { schemaVersion: 1, files: [pin] } satisfies PinnedFiles,
    diagnosticsRoot: join(root, "connector-runtime"),
    node: async () => process.execPath,
    // The first attempt meets a refused connection; the shared classifier must call it a download the user can retry.
    ensureFile: async (_id, _signal, progress) => {
      if (++downloads === 1) return { result: { ok: false, error: "network" }, failure: { kind: "connect", detail: "ECONNREFUSED relay" } }
      progress(1, 1)
      return { result: { ok: true, path: join(root, "fixture.dmg"), via: "cache" } }
    },
    extract: async ({ destination }) => { const file = join(destination, "LibreOffice.app/Contents/MacOS/soffice"); mkdirSync(join(file, ".."), { recursive: true }); writeFileSync(file, "extracted candidate") },
    writable: (directory) => directory === workspace,
    launches,
    chromium: async () => { throw Error("not an HTML case") },
  })
  generations.push(generation)
  let listener!: (event: { data: unknown }) => void
  const port: HubPort = { on: (_event, fn) => { listener = fn }, postMessage: (message) => { generation.receive(message, (reply) => listener({ data: reply })) } }
  const ext = createDocumentHostBridge(createHubBridge(port, { log: () => {} }), 3)
  generation.attach((message) => listener({ data: message }))
  // Location setup registers the fixed verification first (registerDocumentTools), as the ext plugin does.
  const verified: DocumentRuntimeVerifyTask[] = []
  const unregister = ext.host.subscribeRuntimeVerify(caller.location, async (task): Promise<DocumentRuntimeVerifyReceipt> => {
    verified.push(task)
    const pdfPath = join(task.jobRoot, "control.pdf")
    copyFileSync(pdf, pdfPath)
    return { ...task, status: "completed", version: pin.version, pdfPath, pdfSha256: createHash("sha256").update(readFileSync(pdf)).digest("hex"), pageCount: 1 }
  })

  await expect(ext.host.environment({ ...caller, location: { directory: root } } as DocumentCaller)).rejects.toThrow("not writable")
  const environment = await ext.host.environment(caller)
  expect(environment.node).toBe(process.execPath)
  expect(environment.workRoot).toBe(join(workspace, ".document-output"))
  const identity = { directory: workspace, server: DOCUMENT_RUNTIME_LAUNCH_SERVER, attempt: "document-runtime:3" }
  const row = async () => (await launches.api.list(workspace)).find((value) => value.identity.server === DOCUMENT_RUNTIME_LAUNCH_SERVER)
  await until(async () => (await row())?.state.phase === "failed")
  expect((await row())?.state).toEqual({ phase: "failed", failure: { kind: "download", detail: "ECONNREFUSED relay" }, diagnostic: "document-runtime:3" })

  expect(await launches.api.retry({ ...identity, attempt: "document-runtime:2" })).toEqual({ ok: false, error: "not-current" })
  expect(await launches.api.retry(identity)).toEqual({ ok: true })
  await until(async () => (await row())?.state.phase === "connected")
  expect(downloads).toBe(2)
  expect(verified).toHaveLength(1)
  await unregister()
})

test("an unpack failure gives the row's assistant entry the real diagnostic of this attempt", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "document-generation-"))); roots.push(root)
  const resourcesRoot = join(root, "resources")
  cpSync(join(import.meta.dir, "fixtures/document-assets"), join(resourcesRoot, "document-assets"), { recursive: true })
  mkdirSync(join(resourcesRoot, "document-assets", "node_modules"), { recursive: true })
  mkdirSync(join(resourcesRoot, "office-runtime", "bin"), { recursive: true })
  cpSync(join(import.meta.dir, "fixtures/office-python-darwin-arm64.header.bin"), officePythonPath(join(resourcesRoot, "office-runtime"), "darwin"))
  chmodSync(officePythonPath(join(resourcesRoot, "office-runtime"), "darwin"), 0o755)
  mkdirSync(join(resourcesRoot, "factory-skills", "office-docs"), { recursive: true })
  cpSync(join(import.meta.dir, "../../resources/document-runtime"), join(resourcesRoot, "document-runtime"), { recursive: true })
  const workspace = join(root, "workspace"); mkdirSync(workspace)
  const caller = { location: { directory: workspace }, sessionID: "ses_document" } as DocumentCaller
  const launches = createConnectorLaunchState("4", {
    retry: async () => ({ ok: false, error: "unavailable" }),
    diagnostic: async () => ({ ok: false, error: "unavailable" }),
    openNetworkApproval: async () => ({ ok: false, error: "unavailable" }),
    chooseWorkspace: async () => ({ ok: false, error: "unavailable" }),
  })
  const generation = openDocumentGeneration({
    sidecarGeneration: 4, userData: root, resourcesRoot, packaged: true, platform: "darwin-arm64",
    documents: { python: process.execPath, assets: join(resourcesRoot, "document-assets"), templates: join(resourcesRoot, "document-assets", "templates"), documentRuntimeRoot: join(root, "document-runtime"), verify: "unused", render: "unused", recalculate: "unused", libreoffice: [pin] },
    manifest: { schemaVersion: 1, files: [pin] } satisfies PinnedFiles,
    diagnosticsRoot: join(root, "connector-runtime"),
    node: async () => process.execPath,
    ensureFile: async (_id, _signal, progress) => { progress(1, 1); return { result: { ok: true, path: join(root, "fixture.dmg"), via: "cache" } } },
    extract: async () => { throw Error("hdiutil: attach failed - image not recognized") },
    writable: (directory) => directory === workspace,
    launches,
    chromium: async () => { throw Error("not an HTML case") },
  })
  generations.push(generation)
  let listener!: (event: { data: unknown }) => void
  const port: HubPort = { on: (_event, fn) => { listener = fn }, postMessage: (message) => { generation.receive(message, (reply) => listener({ data: reply })) } }
  const ext = createDocumentHostBridge(createHubBridge(port, { log: () => {} }), 4)
  generation.attach((message) => listener({ data: message }))
  const unregister = ext.host.subscribeRuntimeVerify(caller.location, async (task): Promise<DocumentRuntimeVerifyReceipt> => ({ ...task, status: "failed", error: "not reached" }) as never)
  await ext.host.environment(caller)
  const identity = { directory: workspace, server: DOCUMENT_RUNTIME_LAUNCH_SERVER, attempt: "document-runtime:4" }
  const row = async () => (await launches.api.list(workspace)).find((value) => value.identity.server === DOCUMENT_RUNTIME_LAUNCH_SERVER)
  await until(async () => (await row())?.state.phase === "failed")
  expect((await row())?.state).toMatchObject({ phase: "failed", failure: { kind: "unknown" }, diagnostic: "document-runtime:4" })
  const diagnostic = await generation.diagnostic(identity)
  if (!diagnostic.ok) throw Error("expected the attempt's diagnostic")
  expect(diagnostic.value).toMatchObject({ identity, stage: "packages", exitCode: null, signal: null })
  expect(diagnostic.value.stderr).toContain("hdiutil: attach failed - image not recognized")
  expect(JSON.parse(readFileSync(diagnostic.value.transcriptFile, "utf8")).stderr).toBe(diagnostic.value.stderr)
  expect(await generation.diagnostic({ ...identity, directory: root })).toEqual({ ok: false, error: "unavailable" })
  expect(await generation.diagnostic({ ...identity, attempt: "document-runtime:3" })).toEqual({ ok: false, error: "unavailable" })
  await unregister()
})

async function until(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (await check()) return
    await Bun.sleep(5)
  }
  throw Error("document generation did not settle")
}
