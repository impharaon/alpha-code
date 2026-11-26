import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  DocumentCaller,
  DocumentEnvironment,
  DocumentHost,
  RenderResult,
  DeferredDocumentCheck,
  DocumentRuntimeState,
} from "../../../util/src/codepuppy-document"
import { createDocumentRenderer } from "../../../ext/src/document-render"
import { subscribeDocumentChecks } from "../../../ext/src/document-check"
import { createDocumentChecks } from "./document-checks"
import { SessionMessage } from "../../../schema/src/session-message"
import { createDocumentHost } from "./document-host"
import { createDocumentMainBridge } from "./document-host-bridge"
import { createDocumentHostBridge } from "../../../ext/src/document-host-bridge"
import { createHubBridge, type HubPort } from "../../../ext/src/hub-bridge"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "document-host-")))
  roots.push(root)
  const caller = { location: { directory: root }, sessionID: "ses_document" } as DocumentCaller
  const resources = {
    python: process.execPath,
    node: process.execPath,
    nodeModules: root,
    skills: root,
    templates: root,
    fonts: root,
  }
  const runtime = {
    subscribe: () => () => {},
    query: () => ({ phase: "preparing", stage: "download" }),
    subscribeRuntimeVerify: () => async () => {},
    pythonEnvironment: async () => ({ CODEPUPPY_DOCUMENT_HOST: join(root, "host.json") }),
  } as never
  return { root, caller, resources, runtime }
}
describe("document host", () => {
  test("environment establishes the real private workspace and ignores generation preparation latency", async () => {
    const f = fixture()
    const value = createDocumentHost({
      authorize: (caller) => {
        if (caller.location.directory !== f.root) throw Error("workspace not authorized")
      },
      resources: async () => f.resources,
      runtime: f.runtime,
      chromium: async () => {
        throw Error("should not create a carrier")
      },
      documentRuntimeRoot: join(f.root, "runtime"),
    })
    await expect(
      value.host.environment({ ...f.caller, location: { directory: join(f.root, "unauthorized") } }),
    ).rejects.toThrow("workspace not authorized")
    const environment = await value.host.environment(f.caller)
    expect(environment.workRoot).toBe(join(f.root, ".document-output"))
    expect(readFileSync(join(environment.workRoot, ".gitignore"), "utf8")).toBe("*\n")
    expect(environment.renderState).toEqual({ phase: "preparing", stage: "download" })
    await expect(
      value.host.chromiumRender({
        caller: { ...f.caller, sessionID: "ses_other" as DocumentCaller["sessionID"] },
        checkId: "check",
        revision: 0,
        request: { kind: "html", path: join(f.root, "page.html") },
        sourceSha256: "a".repeat(64),
      }),
    ).rejects.toThrow("caller")
  })
  test("existing ID bridge validates generation, dispatches environment and cancels only the active Chromium request", async () => {
    const f = fixture()
    let cancelled = 0
    let begun!: () => void
    const started = new Promise<void>((resolve) => {
      begun = resolve
    })
    const pending = new Map<unknown, (value: RenderResult) => void>()
    const mainHost: DocumentHost = {
      pythonEnvironment: async () => ({ CODEPUPPY_DOCUMENT_HOST: join(f.root, "host.json") }),
      environment: async () => ({
        ...f.resources,
        workRoot: f.root, pythonEnvironment: { CODEPUPPY_DOCUMENT_HOST: join(f.root, "host.json") },
        renderState: { phase: "preparing", stage: "verify" },
      }),
      chromiumRender: async (request) => {
        begun()
        return new Promise((resolve) => pending.set(request, resolve))
      },
      defer: async () => {},
      recordCheck: async () => {},
      subscribeReady: () => () => {},
      subscribeRuntimeVerify: () => async () => {},
    }
    const main = createDocumentMainBridge(
      mainHost,
      { subscribe: () => () => {}, subscribeRuntimeVerify: mainHost.subscribeRuntimeVerify, invalidatePythonEnvironment() {} },
      7,
      (request) => {
        cancelled++
        pending.get(request)?.({ status: "failed", code: "timeout", detail: "cancelled" })
      },
    )
    let listener!: (event: { data: unknown }) => void
    const port: HubPort = {
      on: (_event, fn) => {
        listener = fn
      },
      postMessage: (message) => {
        main.receive(message, (reply) => listener({ data: reply }))
      },
    }
    const hub = createHubBridge(port, { log: () => {} })
    const sidecar = createDocumentHostBridge(hub, 7)
    expect((await sidecar.host.environment(f.caller)).renderState).toEqual({ phase: "preparing", stage: "verify" })
    expect(
      main.receive(
        {
          type: "codepuppy.document.host.request",
          id: 9,
          sidecarGeneration: 6,
          request: { operation: "environment", caller: f.caller },
        },
        () => {
          throw Error("old generation must not reply")
        },
      ),
    ).toBe(false)
    const controller = new AbortController()
    const rendered = sidecar.chromium(
      {
        caller: f.caller,
        checkId: "check",
        revision: 0,
        request: { kind: "html", path: join(f.root, "page.html") },
        sourceSha256: "a".repeat(64),
      },
      controller.signal,
    )
    await started
    controller.abort()
    await expect(rendered).rejects.toThrow("cancelled")
    expect(cancelled).toBe(1)
    await main.dispose()
  })
})

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return
    await Bun.sleep(5)
  }
  throw Error("document handoff did not settle")
}

async function pendingFixture() {
  const f = fixture()
  let state: DocumentRuntimeState = { phase: "preparing", stage: "download" }
  const listeners = new Set<(state: DocumentRuntimeState, sequence: number) => void>()
  const runtime = {
    query: () => state,
    pythonEnvironment: async () => ({ CODEPUPPY_DOCUMENT_HOST: join(f.root, "host.json") }),
    subscribeRuntimeVerify: () => async () => {},
    subscribe(listener: (state: DocumentRuntimeState, sequence: number) => void) { listeners.add(listener); listener(state, 1); return () => { listeners.delete(listener) } },
  }
  const options = { authorize: () => {}, resources: async () => f.resources, runtime: runtime as never, chromium: async (): Promise<RenderResult> => { throw Error("not an HTML case") }, documentRuntimeRoot: join(f.root, "runtime") }
  const main = createDocumentHost(options)
  const source = join(import.meta.dir, "fixtures/document-assets/templates/chinese-report.docx")
  const target = join(f.root, "report.docx")
  const fs = await import("node:fs/promises")
  await fs.copyFile(source, target)
  const render = createDocumentRenderer({ host: main.host, chromium: main.host.chromiumRender, assets: join(import.meta.dir, "fixtures/document-assets"), documentRuntimeRoot: options.documentRuntimeRoot, renderScript: "unused", recalculateScript: "unused" })
  const result = await render(f.caller, { kind: "docx", path: target })
  if (result.status !== "pending") throw Error(JSON.stringify(result))
  const path = join(options.documentRuntimeRoot, "checks", result.checkId + ".json")
  const saved = () => JSON.parse(readFileSync(path, "utf8")) as DeferredDocumentCheck
  return { ...f, options, main, target, saved, result, ready() { state = { phase: "ready", executable: "/owned/soffice", version: "fixture" }; for (const listener of listeners) listener(state, 2) } }
}

test("pending handoff survives restart and reconnect, retries its exact ID, and never re-admits an acknowledged input", async () => {
  const f = await pendingFixture()
  const original = f.saved()
  expect(original.state).toBe("waiting-runtime")
  expect(original.notificationID).toMatch(/^msg_/)
  expect(f.result.artifact.artifactPath).toBe(f.target)
  f.main.dispose()
  f.ready()
  const restarted = createDocumentChecks({ root: f.options.documentRuntimeRoot, runtime: f.options.runtime })
  const seen: DeferredDocumentCheck[] = []
  let resolve!: (value: { status: "admitted"; checkId: string; notificationID: DeferredDocumentCheck["notificationID"] }) => void
  const disconnect = restarted.subscribeReady(f.caller.location, (check) => {
    seen.push(check)
    return new Promise((done) => { resolve = done })
  })
  await until(() => seen.length === 1)
  expect(f.saved().state).toBe("admitting")
  disconnect()
  restarted.subscribeReady(f.caller.location, async (check) => {
    seen.push(check)
    return { status: "admitted", checkId: check.id, notificationID: check.notificationID }
  })
  resolve({ status: "admitted", checkId: original.id, notificationID: SessionMessage.ID.create() })
  await until(() => f.saved().state === "admitted")
  expect(seen.map((check) => check.notificationID)).toEqual([original.notificationID, original.notificationID])
  restarted.dispose()
  const again = createDocumentChecks({ root: f.options.documentRuntimeRoot, runtime: f.options.runtime })
  let calls = 0
  again.subscribeReady(f.caller.location, async (check) => { calls++; return { status: "admitted", checkId: check.id, notificationID: check.notificationID } })
  expect(calls).toBe(0)
  again.dispose()
})

test("admission rejects the wrong receipt and completes a deleted Session without recreating it", async () => {
  const f = await pendingFixture()
  f.main.dispose()
  f.ready()
  const stored = createDocumentChecks({ root: f.options.documentRuntimeRoot, runtime: f.options.runtime })
  let calls = 0
  const stop = stored.subscribeReady(f.caller.location, async (check) => { calls++; return { status: "admitted", checkId: check.id, notificationID: SessionMessage.ID.create() } })
  await until(() => calls === 1)
  expect(f.saved().state).toBe("admitting")
  stop()
  stored.subscribeReady(f.caller.location, async (check) => ({ status: "session-missing", checkId: check.id }))
  await until(() => f.saved().state === "complete")
  stored.dispose()
})

test("Location synthetic uses the existing queue admission and exact retry payload, with current-file instructions", async () => {
  const f = await pendingFixture()
  f.main.dispose()
  f.ready()
  const stored = createDocumentChecks({ root: f.options.documentRuntimeRoot, runtime: f.options.runtime })
  const requests: unknown[] = []
  const context = { location: f.caller.location, session: { synthetic: async (input: Record<string, unknown>) => {
    requests.push(input)
    // Application-owned callback contract, matching SessionInbox.Synthetic's fields (no mock server wire format).
    return { id: input.id, sessionID: input.sessionID, type: "synthetic", delivery: input.delivery, payload: { text: input.text, metadata: input.metadata }, time: { created: 0 } }
  } } }
  const stop = subscribeDocumentChecks(context as never, { subscribeReady: stored.subscribeReady } as DocumentHost)
  await until(() => f.saved().state === "admitted")
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ id: f.saved().notificationID, sessionID: f.caller.sessionID, delivery: "queue", resume: true, metadata: { checkId: f.saved().id, sourceSha256: f.saved().sourceSha256 } })
  expect((requests[0] as { text: string }).text).toContain("CURRENT file")
  expect((requests[0] as { text: string }).text).toContain(JSON.stringify(f.target))
  stop()
  stored.dispose()
})

test("missing file is reported to the original Session and kept as a completed local failure", async () => {
  const f = await pendingFixture()
  f.main.dispose()
  const fs = await import("node:fs/promises")
  await fs.unlink(f.target)
  f.ready()
  const stored = createDocumentChecks({ root: f.options.documentRuntimeRoot, runtime: f.options.runtime })
  stored.subscribeReady(f.caller.location, async (check) => ({ status: "admitted", checkId: check.id, notificationID: check.notificationID }))
  await until(() => f.saved().state === "complete")
  const failure = JSON.parse(readFileSync(join(f.options.documentRuntimeRoot, "checks", f.saved().id + ".missing"), "utf8"))
  expect(failure.sourcePath).toBe(f.target)
  expect(failure.reason).toContain("ENOENT")
  stored.dispose()
})

test("synthetic missing-session error and conflicting receipts use the frozen admission outcomes", async () => {
  const f = await pendingFixture()
  f.main.dispose()
  let listener!: Parameters<DocumentHost["subscribeReady"]>[1]
  const host = { subscribeReady: (_location: unknown, value: typeof listener) => { listener = value; return () => {} } } as DocumentHost
  subscribeDocumentChecks({ location: f.caller.location, session: { synthetic: async () => { throw { _tag: "SessionNotFoundError", sessionID: f.caller.sessionID, message: "Session not found" } } } } as never, host)
  expect(await listener(f.saved())).toEqual({ status: "session-missing", checkId: f.saved().id })
  subscribeDocumentChecks({ location: f.caller.location, session: { synthetic: async () => ({ id: "wrong", sessionID: f.caller.sessionID }) } } as never, host)
  expect(await listener(f.saved())).toEqual({ status: "conflict", checkId: f.saved().id })
})

test("existing main bridge replays an unacknowledged ready check on attach and verifies generation and notification ID", async () => {
  const f = await pendingFixture()
  f.main.dispose()
  f.ready()
  const stored = createDocumentChecks({ root: f.options.documentRuntimeRoot, runtime: f.options.runtime })
  const bridge = createDocumentMainBridge({ ...f.main.host, ...stored }, { ...f.options.runtime as object, invalidatePythonEnvironment() {} } as never, 7, () => {})
  const first: unknown[] = []
  const detach = bridge.attach((message) => first.push(message))
  bridge.receive({ type: "codepuppy.document.host.request", id: 1, sidecarGeneration: 7, request: { operation: "ready-register", location: f.caller.location } }, (message) => first.push(message))
  await until(() => first.some((value) => (value as { type: string }).type === "codepuppy.document.check-ready"))
  detach()
  const second: unknown[] = []
  bridge.attach((message) => second.push(message))
  await until(() => second.some((value) => (value as { type: string }).type === "codepuppy.document.check-ready"))
  const check = (second.find((value) => (value as { type: string }).type === "codepuppy.document.check-ready") as { check: DeferredDocumentCheck }).check
  expect(check.notificationID).toBe(f.saved().notificationID)
  bridge.receive({ type: "codepuppy.document.check-admission", sidecarGeneration: 6, location: check.location, admission: { status: "admitted", checkId: check.id, notificationID: check.notificationID } }, () => {})
  bridge.receive({ type: "codepuppy.document.check-admission", sidecarGeneration: 7, location: check.location, admission: { status: "admitted", checkId: check.id, notificationID: SessionMessage.ID.create() } }, () => {})
  expect(f.saved().state).toBe("admitting")
  bridge.receive({ type: "codepuppy.document.check-admission", sidecarGeneration: 7, location: check.location, admission: { status: "admitted", checkId: check.id, notificationID: check.notificationID } }, () => {})
  await until(() => f.saved().state === "admitted")
  await bridge.dispose()
  stored.dispose()
})
