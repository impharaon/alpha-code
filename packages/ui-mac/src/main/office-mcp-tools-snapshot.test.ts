// #1565 AC1(REQ-236 §2.3):resources/office-mcp/tools.json 是 server.py 的 tools_for() 在构建期导出的、入库的清单。
// 引擎在文档工具连上之前把它当作这四个工具的声明定义(packages/opencode/src/mcp/codepuppy-first-party-mcp.ts);它与 server.py
// 一旦不同步,模型拿到的就是错的用法。判据:
//   · 由生产生成脚本重新生成,与入库内容逐字节相等,且生成前后 server.py 的字节不变;
//   · 只改 server.py 里一个 schema 字段,重新生成的工具定义就与入库内容不同(证明比的是 schema,不只是摘要)。
import { afterAll, beforeAll, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OFFICE_MCP_MANIFEST, OFFICE_MCP_SERVER, renderOfficeMcpTools } from "../../scripts/gen-office-mcp-tools"
import { buildVideoMcp } from "../../scripts/build-video-mcp"

const scratch = mkdtempSync(join(tmpdir(), "codepuppy-1565-snapshot-"))
const videoRoot = join(scratch, "video-mcp")
const runtimeRoot = join(scratch, "runtime")
mkdirSync(runtimeRoot)
// Our inventory format; the native format/target checks live in the artifact
// module tests. Snapshot generation must remain a light PR integration test.
writeFileSync(join(runtimeRoot, "helper.js"), "export const helper = 1\n")
writeFileSync(join(runtimeRoot, "runtime.json"), JSON.stringify({ files: { "helper.js": "digest-is-recomputed" } }))
beforeAll(() => buildVideoMcp(videoRoot))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")

test("regeneration preserves Office definitions and video source declaration without rebuilding native code", () => {
  const before = sha256(readFileSync(OFFICE_MCP_SERVER))
  const committed = JSON.parse(readFileSync(OFFICE_MCP_MANIFEST, "utf8"))
  const generated = JSON.parse(renderOfficeMcpTools(OFFICE_MCP_SERVER, videoRoot, runtimeRoot))
  const sourceHashes = (manifest: typeof generated) =>
    Object.fromEntries(
      ["video-mcp/server.js", "video-mcp/speech-worker.js"].map((file) => [
        file,
        manifest.formats.video.codeSha256[file],
      ]),
    )
  expect(sourceHashes(generated)).toEqual(sourceHashes(committed))
  expect(generated.formats.video.codeSha256["video-mcp/helper.js"]).toBe(
    sha256(readFileSync(join(runtimeRoot, "helper.js"))),
  )
  expect(generated.formats.video.codeSha256["video-mcp/runtime.json"]).toBe(
    sha256(readFileSync(join(runtimeRoot, "runtime.json"))),
  )
  // Platform binaries are built once by the producer and independently checked
  // before/after packaging; their bytes are neither faked nor rebuilt here.
  generated.formats.video.codeSha256 = {}
  committed.formats.video.codeSha256 = {}
  expect(generated).toEqual(committed)
  expect(sha256(readFileSync(OFFICE_MCP_SERVER))).toBe(before)
})

test("AC1: changing one schema field in server.py changes the exported tool definitions", () => {
  const source = readFileSync(OFFICE_MCP_SERVER, "utf8")
  // The preserved Excel reader's rows schema; changing it must affect the real generated definition.
  const field = `"rows":{"type":"integer","minimum":1}`
  expect(source.split(field)).toHaveLength(2)
  const edited = join(scratch, "server.py")
  writeFileSync(edited, source.replace(field, `"rows":{"type":"integer","minimum":2}`))
  type Manifest = { formats: Record<string, { tools: unknown[] }> }
  const committed = JSON.parse(readFileSync(OFFICE_MCP_MANIFEST, "utf8")) as Manifest
  const regenerated = JSON.parse(renderOfficeMcpTools(edited, videoRoot, runtimeRoot)) as Manifest
  expect(regenerated.formats.excel!.tools).not.toEqual(committed.formats.excel!.tools)
  expect(regenerated.formats.word!.tools).toEqual(committed.formats.word!.tools)
})
