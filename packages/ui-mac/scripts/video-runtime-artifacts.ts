import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { readFile, readdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileDigest } from "../resources/video-mcp/cache"
import type { VideoRuntime } from "../resources/video-mcp/runtime"
import { machOArchs } from "./target-arch"
import { VIDEO_DECLARATION_ID } from "../src/shared/video-service"
import licences from "../resources/video-runtime/licenses.json"

type VideoTarget = VideoRuntime["platform"]

export function videoBinaryTarget(data: Uint8Array): VideoTarget | undefined {
  if (machOArchs(data)?.includes("arm64")) return "darwin-arm64"
  if (data.length < 64) return undefined
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const pe = view.getUint32(60, true)
  if (
    data[0] === 0x4d &&
    data[1] === 0x5a &&
    pe <= data.length - 6 &&
    view.getUint32(pe, true) === 0x00004550 &&
    view.getUint16(pe + 4, true) === 0x8664
  )
    return "win32-x64"
  return undefined
}

export async function checkVideoRuntime(directory: string, target: VideoTarget) {
  const manifest = JSON.parse(await readFile(path.join(directory, "runtime.json"), "utf8")) as {
    platform: VideoTarget
    files: Record<string, string>
    components: Record<string, string>
    buildFingerprint: string
    buildIdentities: {speech:Record<string,string>;frames:Record<string,string>}
  }
  if (manifest.platform !== target) throw new Error("Video runtime target mismatch")
  const binaries = Object.keys(manifest.files).filter(
    (file) => /\.(node|dylib|dll|exe)$/.test(file) || file === manifest.components.ocr,
  )
  if (
    !binaries.some((file) => file.includes("sherpa")) ||
    !binaries.some((file) => file.includes("node-whisper")) ||
    !manifest.components.ocr
  )
    throw new Error("Video runtime native closure is incomplete")
  for (const [relative, sha256] of Object.entries(manifest.files)) {
    const file = path.resolve(directory, relative)
    if (!file.startsWith(path.resolve(directory) + path.sep) || (await fileDigest(file)) !== sha256)
      throw new Error(`Video runtime content mismatch: ${relative}`)
    if (binaries.includes(relative) && videoBinaryTarget(await readFile(file)) !== target)
      throw new Error(`Video runtime binary architecture mismatch: ${relative}`)
  }
  if (target === "darwin-arm64" && ((await stat(path.join(directory, manifest.components.ocr!))).mode & 0o111) === 0)
    throw new Error("Video OCR helper is not executable")
  await checkVideoRuntimeLicences(directory, manifest.files)
  return manifest
}

async function checkVideoRuntimeLicences(directory: string, files: Record<string, string>) {
  for (const licence of licences.licences) {
    const relative = `licenses/${licence.file}`
    if (files[relative] !== licence.sha256 || (await fileDigest(path.join(directory, relative))) !== licence.sha256)
      throw new Error(`Video runtime licence is missing or incomplete: ${licence.name}`)
  }
}

export async function writeVideoRuntimeInventory(
  directory: string,
  target: VideoTarget,
  components: Record<string, string>,
  buildFingerprint: string,
) {
  const files: Record<string, string> = {}
  async function visit(root: string) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const file = path.join(root, entry.name)
      if (entry.isDirectory()) {
        await visit(file)
        continue
      }
      const relative = path.relative(directory, file).split(path.sep).join("/")
      if (relative === "runtime.json") continue
      files[relative] = await fileDigest(file)
    }
  }
  await visit(directory)
  const native=Object.entries(files).filter(([file])=>/\.(node|dylib|dll|so|metallib)$/.test(file) || file === components.ocr)
  const buildIdentities={speech:Object.fromEntries(native.filter(([file])=>!file.startsWith("helpers/"))),frames:Object.fromEntries(native.filter(([file])=>file.startsWith("helpers/")))}
  await writeFile(
    path.join(directory, "runtime.json"),
    `${JSON.stringify({ platform: target, components, buildIdentities, files: Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))), buildFingerprint }, null, 2)}\n`,
  )
  return checkVideoRuntime(directory, target)
}

/** Called after child signatures, immediately before sealing the macOS parent.
 * Windows has no parent resource seal and calls it from afterSign instead. */
export function finalizeVideoSignatures(resources: string) {
  const directory = path.join(resources, "video-mcp")
  const manifestPath = path.join(directory, "runtime.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex")
  manifest.files = Object.fromEntries(
    Object.keys(manifest.files).map((relative) => {
      const file = path.resolve(directory, relative)
      if (!file.startsWith(path.resolve(directory) + path.sep))
        throw new Error("Video signature inventory escapes its resource root")
      return [relative, sha256(file)]
    }),
  )
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  const declarationPath = path.join(resources, "office-mcp/tools.json")
  const declaration = JSON.parse(readFileSync(declarationPath, "utf8"))
  declaration.formats[VIDEO_DECLARATION_ID].codeSha256 = Object.fromEntries(
    ["server.js", "speech-worker.js", "runtime.json", ...Object.keys(manifest.files)].map((relative) => [
      `video-mcp/${relative}`,
      sha256(path.join(directory, relative)),
    ]),
  )
  writeFileSync(declarationPath, `${JSON.stringify(declaration, null, 2)}\n`)
}
