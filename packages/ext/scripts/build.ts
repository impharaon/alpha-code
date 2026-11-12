#!/usr/bin/env bun
// Bundle @codepuppy/ext into a SELF-CONTAINED ESM file the embedded Electron-Node
// server can load without resolving raw TS at runtime. See .claude/rules/DECISIONS.md ADR-006.
//
// Why bundle at all:
//   The desktop server runs under Electron's Node. Node type-strips `.ts` but does NOT
//   remap `.js`→`.ts` import specifiers. `@opencode/plugin` ships only TS source whose
//   files import each other with `.js` specifiers (the nodenext convention), so loading it
//   raw under Node dies with ERR_MODULE_NOT_FOUND (.../tool.js from .../index.ts).
//   Bundling inlines `@opencode/plugin` (+ the effect it pulls in) into one plain `.js`,
//   so the server only ever imports already-resolved JS.
import { createHash } from "node:crypto"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { TOOL_TEXT } from "../src/context-injection"

const pkgDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
process.chdir(pkgDir)
rmSync("dist", { recursive: true, force: true })

const result = await Bun.build({
  entrypoints: ["./src/plugin.ts"],
  outdir: "./dist",
  target: "node", // Node-compatible output; Node built-ins stay external automatically
  format: "esm",
  sourcemap: "linked",
  // `#1665` (I2, seam change 2026-11-09): OpenCode 2 loads a configured local plugin only by its DIRECTORY
  // (`packages/core/src/config/plugin/source.ts` drops a file path with a warning) and resolves the server
  // entry by the conventional name `server` inside it (`packages/plugin/src/host.ts` resolve()). `dist/` has
  // no package.json, so the entry file must be `server.js`; main lists the directory in `plugins`.
  naming: "server.js",
  // No `external`: inline EVERYTHING (incl. @opencode/plugin + effect) so the embedded
  // Node server never has to resolve a raw `.ts` at runtime — the whole point of ADR-006.
  //
  // `#1662`: jsonc-parser (ui-mac/src/shared/project-jsonc.ts) is resolved to its ESM entry. Its `main` is a UMD whose
  // factory calls `require("./impl/format")` at run time; inlined, that path points next to dist/server.js and Electron's
  // node refuses to load the ext ("Cannot find module './impl/format'"), so the sidecar never reports ready
  // (net-failure-real-stack.test.ts loads this bundle there). Its `module` entry is plain ESM that bundles whole.
  plugins: [
    {
      name: "codepuppy:jsonc-parser-esm",
      setup(build) {
        build.onResolve({ filter: /^jsonc-parser$/ }, (args) => ({
          path: Bun.resolveSync("jsonc-parser/lib/esm/main.js", path.dirname(args.importer)),
        }))
      },
    },
  ],
  //
  // Known G1 caveat: the opencode server bundle carries its OWN zod/effect copy, so the
  // schemas this plugin builds (via `tool.schema`) live on a DIFFERENT instance than the
  // server's. opencode's tool ingestion must treat plugin schemas structurally. Validate
  // when wiring G1: load ext → `codepuppy_ping` appears in the tool list AND executes.
})

if (!result.success) {
  console.error("[@codepuppy/ext] bundle failed:")
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

// #1578 AC5 (REQ-236 §2.6-7): the trusted bundled manifest, shipped next to server.js (electron-builder `codepuppy-ext/`).
// The engine gives `codepuppy-bundled` only to these tool names, and only when the plugin module it loaded hashes to this
// digest (packages/opencode/src/plugin/codepuppy-bundled-plugin.ts). Tool names = TOOL_TEXT's keys, which
// src/context-injection.test.ts pins to the real CodePuppyExt's own tool set; project plugins merged in at runtime are
// never listed.
// #1568 AC5: `readable` = each listed tool's display identifier (`codepuppy:<action>`), declared in TOOL_TEXT.
const manifest = {
  moduleSha256: createHash("sha256").update(readFileSync("dist/server.js")).digest("hex"),
  tools: Object.keys(TOOL_TEXT).sort(),
  readable: Object.fromEntries(Object.entries(TOOL_TEXT).map(([name, text]) => [name, text.readable])),
}
writeFileSync("dist/bundled-tools.json", `${JSON.stringify(manifest, null, 2)}\n`)

const outputs = result.outputs.map((o) => path.relative(pkgDir, o.path)).join(", ")
console.log(`[@codepuppy/ext] bundled → ${outputs}, dist/bundled-tools.json`)
