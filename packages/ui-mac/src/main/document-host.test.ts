import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
  DocumentCaller,
  DocumentEnvironment,
  DocumentHost,
  RenderResult,
} from "../../../util/src/codepuppy-document"
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
      defer: async () => {},
      recordCheck: async () => {},
      subscribeReady: () => () => {},
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
