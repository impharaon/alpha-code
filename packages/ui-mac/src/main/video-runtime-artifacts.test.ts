import { afterAll, expect, test } from "bun:test"
import { chmod, copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { checkVideoRuntime, videoBinaryTarget, writeVideoRuntimeInventory } from "../../scripts/video-runtime-artifacts"
import { writeVideoRuntimeFixture } from "./fixtures/video/runtime"
import licences from "../../resources/video-runtime/licenses.json"

// Integration layer: filesystem inventory wiring. Real header clips from the
// locked builds are documented beside the fixtures; no synthetic PE/Mach-O.
const root = await mkdtemp(path.join(tmpdir(), "video-runtime-artifacts-"))
afterAll(() => rm(root, { recursive: true, force: true }))
const fixtures = path.join(import.meta.dir, "fixtures/video/native-headers")

async function bundle(target: "darwin-arm64" | "win32-x64") {
  return writeVideoRuntimeFixture(path.join(root, target), target)
}

test("native inventory rejects a real wrong-platform header even when the content digest is current", async () => {
  expect(videoBinaryTarget(await readFile(path.join(fixtures, "darwin-arm64.bin")))).toBe("darwin-arm64")
  expect(videoBinaryTarget(await readFile(path.join(fixtures, "win32-x64.bin")))).toBe("win32-x64")
  const directory = await bundle("darwin-arm64")
  await copyFile(path.join(fixtures, "win32-x64.bin"), path.join(directory, "sherpa.node"))
  await expect(
    writeVideoRuntimeInventory(directory, "darwin-arm64", { ocr: "helpers/ocr" }, "fixture"),
  ).rejects.toThrow("architecture mismatch")
})

test("native inventory requires the full SenseVoice licence, content integrity and executable helper", async () => {
  const directory = await bundle("win32-x64")
  await writeFile(
    path.join(directory, "licenses/SenseVoiceSmall.txt"),
    "https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE\n",
  )
  // Regenerate the inventory too: a self-consistent hash of a link cannot stand
  // in for the full upstream licence checked against the source catalogue.
  await expect(writeVideoRuntimeInventory(directory, "win32-x64", { ocr: "helpers/ocr" }, "fixture")).rejects.toThrow(
    "licence is missing or incomplete",
  )
  const mac = await bundle("darwin-arm64")
  await writeFile(path.join(mac, "node-whisper.node"), "corrupt")
  await expect(checkVideoRuntime(mac, "darwin-arm64")).rejects.toThrow("content mismatch")
  const complete = await bundle("darwin-arm64")
  expect((await checkVideoRuntime(complete, "darwin-arm64")).files["licenses/SenseVoiceSmall.txt"]).toBe(
    licences.licences.find((entry) => entry.file === "SenseVoiceSmall.txt")!.sha256,
  )
  await chmod(path.join(complete, "helpers/ocr"), 0o644)
  await expect(checkVideoRuntime(complete, "darwin-arm64")).rejects.toThrow("not executable")
})

test("signature finalization binds changed native bytes before the parent resource seal", async () => {
  const { finalizeVideoSignatures } = await import("../../scripts/video-runtime-artifacts")
  const resources = path.join(root, "signed-resources")
  const directory = path.join(resources, "video-mcp")
  await cp(await bundle("darwin-arm64"), directory, { recursive: true })
  await mkdir(path.join(resources, "office-mcp"), { recursive: true })
  await writeFile(
    path.join(resources, "office-mcp/tools.json"),
    JSON.stringify({ formats: { video: { codeSha256: {} }, word: { tools: ["unchanged"] } } }),
  )
  for (const file of ["server.js", "speech-worker.js"]) await writeFile(path.join(directory, file), "export {}\n")
  // Change bytes at our hash boundary; the actual signer is checked once on a
  // copied bundle. This fixture does not pretend to contain a code signature.
  const native = path.join(directory, "node-whisper.node")
  await writeFile(native, Buffer.concat([await readFile(native), Buffer.from("signature-test-boundary")]))
  await expect(checkVideoRuntime(directory, "darwin-arm64")).rejects.toThrow("content mismatch")
  finalizeVideoSignatures(resources)
  const manifest = await checkVideoRuntime(directory, "darwin-arm64")
  const declaration = JSON.parse(await readFile(path.join(resources, "office-mcp/tools.json"), "utf8"))
  expect(declaration.formats.video.codeSha256["video-mcp/node-whisper.node"]).toBe(manifest.files["node-whisper.node"])
  expect(declaration.formats.video.codeSha256["video-mcp/runtime.json"]).toBeDefined()
  expect(declaration.formats.word.tools).toEqual(["unchanged"])
})
