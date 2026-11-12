// #1578 AC5 on OpenCode 2 — the extension's own tools are `codepuppy-bundled` only when the bundled manifest that main
// points at (`CODEPUPPY_EXT_BUNDLED_MANIFEST`) attests the exact module bytes and lists them. Moved from
// packages/opencode/test/plugin/codepuppy-bundled-plugin.test.ts (#1662 L4): the v1 loader verified a loaded plugin;
// on OpenCode 2 the policy lives inside the extension and verifies the module it was bundled into, so the cases now
// run against `bundledPluginTools` and the identity it feeds.
import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { readFileSync } from "node:fs"
import { bundledPluginTools, EXT_BUNDLED_MANIFEST_ENV } from "./bundled-plugin"
import { toolFacts } from "./identity"

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codepuppy-1578-plugin-")))
afterEach(() => undefined)

function writeModule(content = "export default { id: 'codepuppy-ext', setup() {} }\n") {
  const dir = path.join(scratch, crypto.randomUUID(), "codepuppy-ext")
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, "plugin.js")
  fs.writeFileSync(file, content)
  return file
}

function writeManifest(plugin: string, tools: string[], options: { extraByte?: boolean; readable?: Record<string, string> } = {}) {
  const dir = path.join(scratch, crypto.randomUUID())
  fs.mkdirSync(dir, { recursive: true })
  const bytes = Buffer.concat([fs.readFileSync(plugin), Buffer.from(options.extraByte ? " " : "")])
  const file = path.join(dir, "bundled-tools.json")
  const readable = options.readable ?? Object.fromEntries(tools.map((name) => [name, `codepuppy:${name.replace(/^codepuppy_/, "")}`]))
  fs.writeFileSync(file, JSON.stringify({ moduleSha256: createHash("sha256").update(bytes).digest("hex"), tools, readable }))
  return file
}

const facts = (bundled: ReturnType<typeof bundledPluginTools>, id: string, extOrigin: string) =>
  toolFacts({ id, name: id }, { early: new Set(), earlyAmbiguous: false, mcp: new Map(), bundled, extOrigin, env: {} })

describe("#1578 AC5 first-party extension tools", () => {
  test("listed own tools of a module whose digest matches get codepuppy-bundled; a project tool merged in does not", () => {
    const plugin = writeModule()
    const manifest = writeManifest(plugin, ["codepuppy_echo", "codepuppy_ping"])
    const bundled = bundledPluginTools({ source: "file", entry: pathToFileURL(plugin).href }, { [EXT_BUNDLED_MANIFEST_ENV]: manifest }, readFileSync)
    expect(bundled?.tools).toEqual(new Set(["codepuppy_echo", "codepuppy_ping"]))
    const own = facts(bundled, "codepuppy_ping", plugin)
    expect(own.identity).toEqual({ source: "plugin", origin: plugin, name: "codepuppy_ping" })
    expect(own.authority).toMatchObject({ kind: "codepuppy-bundled", bindingId: "plugin:codepuppy-ext" })
    expect(own.readable).toBe("codepuppy:ping")
    const project = facts(bundled, "lint_project", plugin)
    expect(project.identity).toEqual({ source: "plugin", origin: "", name: "lint_project" })
    expect(project.authority).toEqual({ kind: "not-asserted" })
  })

  test("a manifest attesting a module one byte different proves nothing", () => {
    const plugin = writeModule()
    const manifest = writeManifest(plugin, ["codepuppy_ping"], { extraByte: true })
    expect(bundledPluginTools({ source: "file", entry: plugin }, { [EXT_BUNDLED_MANIFEST_ENV]: manifest }, readFileSync)).toBeUndefined()
  })

  test("a manifest missing a listed tool's readable identifier proves nothing", () => {
    const plugin = writeModule()
    const manifest = writeManifest(plugin, ["codepuppy_ping", "codepuppy_echo"], { readable: { codepuppy_ping: "codepuppy:ping" } })
    expect(bundledPluginTools({ source: "file", entry: plugin }, { [EXT_BUNDLED_MANIFEST_ENV]: manifest }, readFileSync)).toBeUndefined()
  })

  test("without the injected manifest env, a correct manifest next to the module is not consulted", () => {
    const plugin = writeModule()
    fs.writeFileSync(path.join(path.dirname(plugin), "bundled-tools.json"), fs.readFileSync(writeManifest(plugin, ["codepuppy_ping"])))
    expect(bundledPluginTools({ source: "file", entry: plugin }, {}, readFileSync)).toBeUndefined()
  })

  test("an npm-sourced module with matching bytes is not bundled; the same bytes as a file module are", () => {
    const plugin = writeModule()
    const manifest = writeManifest(plugin, ["codepuppy_ping"])
    const env = { [EXT_BUNDLED_MANIFEST_ENV]: manifest }
    expect(bundledPluginTools({ source: "npm", entry: plugin }, env, readFileSync)).toBeUndefined()
    expect(bundledPluginTools({ source: "file", entry: plugin }, env, readFileSync)?.tools.has("codepuppy_ping")).toBe(true)
  })
})
