import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BrowserWindow, Session } from "electron"
import { renderDocumentChromium } from "./document-chromium"
import type { DocumentCaller } from "../../../util/src/codepuppy-document"
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "document-chromium-")))
  roots.push(root)
  const path = join(root, "page.html")
  writeFileSync(path, '<!doctype html><html><body style="width:8px;height:4px">中文</body></html>')
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex")
  const caller = { location: { directory: root }, sessionID: "ses_document" } as DocumentCaller
  const captures: { x: number; y: number; width: number; height: number }[] = []
  const scripts: string[] = []
  const events = new Map<string, (event: { preventDefault(): void }) => void>()
  let handler!: (request: Request) => Promise<Response>
  let network!: (details: { url: string }, callback: (value: { cancel: boolean }) => void) => void
  let permissions!: (...args: unknown[]) => unknown
  let opened = 0
  let destroyed = false
  let fail = false
  const session = {
    setPermissionRequestHandler() {},
    setPermissionCheckHandler: (fn: typeof permissions) => {
      permissions = fn
    },
    setDevicePermissionHandler() {},
    on: (name: string, callback: (event: { preventDefault(): void }) => void) => events.set(name, callback),
    webRequest: {
      onBeforeRequest: (fn: typeof network) => {
        network = fn
      },
    },
    protocol: {
      handle: (_scheme: string, fn: typeof handler) => {
        handler = fn
      },
      unhandle() {},
    },
    clearStorageData: async () => {},
  } as unknown as Session
  const facade = {
    version: "test Chromium geometry facade",
    packaged: true,
    session: () => session,
    create: () => {
      opened++
      return {
        isDestroyed: () => destroyed,
        destroy: () => {
          destroyed = true
        },
        setContentSize() {},
        webContents: {
          setWindowOpenHandler() {},
          on: (name: string, callback: (event: { preventDefault(): void }) => void) => events.set(name, callback),
          setBackgroundThrottling: (value: boolean) => expect(value).toBe(false),
          stop() {},
          loadURL: async (url: string) => {
            const response = await handler(new Request(url))
            expect(response.status).toBe(200)
            expect(await response.text()).toContain("中文")
          },
          executeJavaScript: async (script: string) => {
            scripts.push(script)
            if (script.includes("document.fonts.ready"))
              return { width: 2, height: 8, canvasWidth: 8, canvasHeight: 4, imageErrors: 1 }
            const match = script.match(/scrollTo\(0, (\d+)\)/)
            return match ? Math.min(Number(match[1]), 5) : undefined
          },
          capturePage: async (rect: (typeof captures)[number]) => {
            if (fail) throw Error("actual capture failure")
            captures.push(rect)
            const fixtures = join(import.meta.dir, "fixtures/document-runtime")
            const png = readFileSync(join(fixtures, `canvas-${rect.width}-${rect.height}.png`))
            return { toPNG: () => png, getSize: () => ({ width: rect.width, height: rect.height }) }
          },
        },
      } as unknown as BrowserWindow
    },
  }
  return {
    root,
    path,
    caller,
    digest,
    captures,
    scripts,
    facade,
    events,
    network: () => network,
    permissions: () => permissions,
    opened: () => opened,
    destroyed: () => destroyed,
    fail: () => {
      fail = true
    },
  }
}
describe("document Chromium", () => {
  test("captures the full scroll height including a clamped final scroll; shares isolation and waits for fonts/images/two frames", async () => {
    const f = fixture()
    const result = await renderDocumentChromium(
      {
        caller: f.caller,
        checkId: "check",
        revision: 0,
        request: { kind: "html", path: f.path, viewport: { width: 2, height: 3 } },
        sourceSha256: f.digest,
      },
      f.facade,
    )
    expect(result.status).toBe("rendered")
    if (result.status !== "rendered") throw Error(JSON.stringify(result))
    expect(result.receipt.pageCount).toBe(3)
    expect(f.captures.map(({ y, height }) => [y, height])).toEqual([
      [0, 3],
      [0, 3],
      [1, 2],
    ])
    expect(result.receipt.artifactPath).toBe(f.path)
    expect(result.receipt.diagnostics).toContain("1 image decode(s) failed")
    expect(f.scripts[0]).toContain("document.fonts.ready")
    expect(f.scripts[0]).toContain("Promise.allSettled")
    expect(f.scripts[0]).toContain("requestAnimationFrame(() => requestAnimationFrame")
    let cancel = false
    f.network()({ url: "https://example.org/image.png" }, (value) => {
      cancel = value.cancel
    })
    expect(cancel).toBe(true)
    expect(f.permissions()()).toBe(false)
    let prevented = false
    f.events.get("will-navigate")!({
      preventDefault: () => {
        prevented = true
      },
    })
    expect(prevented).toBe(true)
    expect(f.destroyed()).toBe(true)
  })
  test("exports the complete source canvas as a real PNG and records both actual files", async () => {
    const f = fixture()
    const outputPath = join(f.root, "poster.png")
    const result = await renderDocumentChromium(
      {
        caller: f.caller,
        checkId: "poster",
        revision: 0,
        request: { kind: "design", path: f.path, outputPath },
        sourceSha256: f.digest,
      },
      f.facade,
    )
    expect(result.status).toBe("rendered")
    if (result.status !== "rendered") throw Error(JSON.stringify(result))
    expect(f.captures).toEqual([{ x: 0, y: 0, width: 8, height: 4 }])
    expect(result.receipt.sourcePath).toBe(f.path)
    expect(result.receipt.artifactPath).toBe(outputPath)
    expect(createHash("sha256").update(readFileSync(outputPath)).digest("hex")).toBe(result.receipt.artifactSha256)
  })
  test("a failed design capture never reports the requested nonexistent PNG as an artifact", async () => {
    const f = fixture()
    f.fail()
    const result = await renderDocumentChromium(
      {
        caller: f.caller,
        checkId: "poster",
        revision: 0,
        request: { kind: "design", path: f.path, outputPath: join(f.root, "missing.png") },
        sourceSha256: f.digest,
      },
      f.facade,
    )
    expect(result.status).toBe("failed")
    if (result.status !== "failed") throw Error("not failed")
    expect(result.artifact).toBeUndefined()
  })
  test("a symlinked work root is refused before creating a carrier", async () => {
    const f = fixture()
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "document-outside-")))
    roots.push(outside)
    symlinkSync(outside, join(f.root, ".document-output"))
    const result = await renderDocumentChromium(
      {
        caller: f.caller,
        checkId: "poster",
        revision: 0,
        request: { kind: "html", path: f.path },
        sourceSha256: f.digest,
      },
      f.facade,
    )
    expect(result.status).toBe("failed")
    expect(f.opened()).toBe(0)
  })
})
