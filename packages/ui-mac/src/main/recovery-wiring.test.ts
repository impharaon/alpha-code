import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (file: string) => readFileSync(join(import.meta.dir, file), "utf8")

describe("REQ-090 Recovery wiring ratchet", () => {

  test("the boot host uses its own minimal preload and explicit Electron isolation", () => {
    const windows = read("windows.ts")
    const start = windows.indexOf("export function createRecoveryWindow(")
    const recovery = windows.slice(start, windows.indexOf("export function registerRendererProtocol", start))
    expect(recovery).toContain('preload: join(root, "../preload/recovery.js")')
    expect(recovery).toContain("contextIsolation: true")
    expect(recovery).toContain("nodeIntegration: false")
    expect(recovery).toContain("sandbox: true")
    expect(recovery).toContain("webviewTag: false")
    expect(recovery).toContain('loadWindow(win, "recovery.html")')
  })

  test("startup DbSafety branches contain no native prompt and runtime Recovery has one mount", () => {
    const boot = read("db-safety-boot.ts").split("// ── 菜单动作")[0]!
    expect(boot).not.toContain("dialog.showMessageBox")
    expect(boot).not.toContain("dialog.showErrorBox")
    const renderer = read("../renderer/index.tsx")
    expect(renderer.match(/recovery: RuntimeRecoveryHost/g)).toHaveLength(1)
    expect(renderer.match(/<RecoverySurface \/>/g)).toHaveLength(1)
  })

})
