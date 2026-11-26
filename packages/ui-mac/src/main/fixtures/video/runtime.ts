import { chmod, copyFile, cp, mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { writeVideoRuntimeInventory } from "../../../../scripts/video-runtime-artifacts"

/** Own inventory fixture; binaries are real captured headers, never executed.
 * Actual native loading/signing is a separate one-time build proof. */
export async function writeVideoRuntimeFixture(directory: string, target: "darwin-arm64" | "win32-x64") {
  await mkdir(path.join(directory, "helpers"), { recursive: true })
  const header = path.join(fileURLToPath(new URL(".", import.meta.url)), "native-headers", `${target}.bin`)
  for (const file of ["sherpa.node", "node-whisper.node", "helpers/ocr"])
    await copyFile(header, path.join(directory, file))
  await chmod(path.join(directory, "helpers/ocr"), 0o755)
  await cp(
    path.join(fileURLToPath(new URL(".", import.meta.url)), "../../../../resources/video-runtime/licenses"),
    path.join(directory, "licenses"),
    { recursive: true },
  )
  await writeVideoRuntimeInventory(directory, target, { ocr: "helpers/ocr" }, "fixture")
  return directory
}
