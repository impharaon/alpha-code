import { createHash } from "node:crypto"
import { join } from "node:path"
import { gunzipSync } from "node:zlib"
import provenance from "./provenance.json"
import { fixtureFetch } from "../source-fetch"
export const entrypointsRoot = import.meta.dir
export { provenance }
export async function verifyEntrySamples() {
  for (const file of provenance.files) {
    const stored = await Bun.file(join(entrypointsRoot, file.path)).bytes()
    const raw = "encoding" in file && file.encoding === "gzip" ? gunzipSync(stored) : stored
    if (raw.length !== file.bytes || createHash("sha256").update(raw).digest("hex") !== file.sha256)
      throw Error("Recorded source digest differs: " + file.path)
  }
}
export async function entrypointsFetch(input: string | URL | Request): Promise<Response> {
  const address = String(input)
  const url = new URL(address)
  if (url.hostname === "registry.npmjs.org" && url.pathname === "/-/v1/search" && url.searchParams.get("text") === provenance.opencode.name + " keywords:opencode-plugin") {
    const page = await Bun.file(join(entrypointsRoot, "npm-search.json")).json()
    // Controlled membership taken from the real response, never an invented npm record.
    const objects = page.objects.filter((item: { package: { name: string } }) => item.package.name === provenance.opencode.name)
    if (objects.length !== 1 || objects[0].package.version !== provenance.opencode.version) throw Error("Pinned npm search precondition changed")
    return Response.json({ ...page, objects, total: objects.length })
  }
  const file = provenance.files.find(file => file.url === address)
  if (file) {
    const stored = await Bun.file(join(entrypointsRoot, file.path)).bytes()
    return new Response("encoding" in file && file.encoding === "gzip" ? gunzipSync(stored) : stored, { status: file.status })
  }
  return fixtureFetch(input)
}
