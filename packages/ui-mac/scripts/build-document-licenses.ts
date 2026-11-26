import { createHash } from "node:crypto"
import { cp, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { PinnedFiles } from "../../util/src/codepuppy-pinned-files"

/** Build input comes from the launcher's verified pin material, never from another downloader. */
export async function buildDocumentLicenses(pin: PinnedFiles["files"][number], runtimeRoot: string, destination: string) {
  if (pin.family !== "libreoffice") throw new Error("expected the selected LibreOffice pin")
  const root = await realpath(runtimeRoot)
  const source = pin.target === "darwin-arm64" ? join(root, "LibreOffice.app", "Contents", "Resources") : root
  await mkdir(destination, { recursive: true })
  const files: { path: string; sha256: string }[] = []
  // Preserve all original licence/notice trees, not only a link to the MPL homepage.
  const copy = async (directory: string, relative = "") => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = join(relative, entry.name)
      if (entry.isDirectory()) { await copy(join(directory, entry.name), name); continue }
      if (!/^(licen[sc]e|notice|copying|copyright|credits)([._-]|$)/i.test(entry.name)) continue
      const bytes = await readFile(join(source, name))
      await mkdir(join(destination, name, ".."), { recursive: true })
      await cp(join(source, name), join(destination, name))
      files.push({ path: name, sha256: createHash("sha256").update(bytes).digest("hex") })
    }
  }
  await copy(source)
  if (!files.some((file) => /^LICENSE([.]|$)/i.test(file.path)) || !files.some((file) => /^NOTICE([.]|$)/i.test(file.path))) throw new Error("LibreOffice original licence/notice missing")
  await writeFile(join(destination, "source.json"), JSON.stringify({ pinId: pin.id, pinSha256: pin.sha256, bytes: pin.bytes, originUrl: pin.originUrl, provenanceUrl: pin.provenanceUrl, files }, null, 2) + "\n")
}
