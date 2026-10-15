// Bundled only for this probe; this is a real unfenced Electron browser/main process.
import assert from "node:assert/strict"
import { appendFileSync, readFileSync } from "node:fs"
import { app } from "electron"
import { prepareConfigTx, applyConfigImage, restoreConfigImage } from "../../../packages/ui-mac/src/main/ext-config-tx"

const input = JSON.parse(readFileSync(process.argv[2], "utf8"))
app.setPath("userData", input.userData)
app.setPath("logs", input.logs)
assert.equal(process.type, "browser")
input.targets.forEach((target: string) => appendFileSync(target, "\n"))
// The MCP command is read from the repository's actual shipped catalog, not invented.
const catalog = JSON.parse(readFileSync(input.catalog, "utf8"))
const entry = catalog.entries.find((item: { id: string }) => item.id === "mcp:markitdown")
assert.equal(entry.installSpec.mcpType, "local")
const leaf = { type: entry.installSpec.mcpType, command: entry.installSpec.command, enabled: true }
const prepared = prepareConfigTx(input.targets[0], [{ keyPath: ["mcp", "markitdown"], value: leaf }])
assert(prepared.ok)
applyConfigImage(prepared.image)
assert.deepEqual(JSON.parse(readFileSync(input.targets[0], "utf8")).mcp.markitdown, leaf)
assert.deepEqual(restoreConfigImage(prepared.image), { ok: true, action: "restored" })
assert.equal(readFileSync(input.targets[0], "utf8"), prepared.image.preImage)
console.log(JSON.stringify({ processType: process.type, electron: process.versions.electron, append: 7, configApply: "OK", configRestore: "OK", catalogId: entry.id }))
app.exit(0)
