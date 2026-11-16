import { createHash } from "node:crypto"
import sample from "./hub-package.fixture.json"
import type { CodePuppyPackageEnvelopeV1 } from "../src/shared/host-extension-package-contract/decoder"

// Unmodified producer catalog/payload/skill bytes from the commit and paths in sample.source.
// Only catalog verification and outbound HTTP are replaced by the harness; every digest is real.
export function hubPackageFixture() {
  const files = new Map(sample.files.map((file) => [file.path, new TextEncoder().encode(file.content)]))
  const packages = structuredClone(sample.packages) as CodePuppyPackageEnvelopeV1[]
  const fetchBytes = async (ref: { url: string; bytes: number; sha256: string }) => {
    const bytes = files.get(`public${new URL(ref.url).pathname}`)
    if (!bytes || bytes.byteLength !== ref.bytes || createHash("sha256").update(bytes).digest("hex") !== ref.sha256)
      throw new Error(`producer fixture digest mismatch: ${ref.url}`)
    return bytes
  }
  return {
    packages,
    catalog: { version: sample.source.commit, entries: [], packages },
    fetchBytes,
    async verify() {
      for (const component of packages.flatMap((entry) => entry.components)) {
        const payload = JSON.parse(new TextDecoder().decode(await fetchBytes(component.payloadRef)))
        for (const file of payload.behavior.files ?? []) await fetchBytes(file)
      }
    },
  }
}
