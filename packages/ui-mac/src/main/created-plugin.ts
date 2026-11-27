import { convertPluginTree } from "../shared/host-extension-package-contract/plugin-conversion.mjs"
import type { Capture } from "../shared/host-extension-package-contract/plugin-conversion"
import type { CreatedPluginDraftV1 } from "../shared/plugin-install"
import { sha256Hex } from "./ext-manifest-v2"
import { pluginRuntimeIdentity } from "./plugin-sources"

/** Assemble our draft in memory; capture/path/provider validation belongs to the shared converter. */
export async function convertCreatedPlugin(draft: CreatedPluginDraftV1) {
  try {
    const files = [{ path: ".claude-plugin/plugin.json", text: JSON.stringify({ name: draft.name, description: draft.description, version: "1.0.0" }) }, ...draft.files]
      .map((file) => ({ path: file.path, data: Buffer.from(file.text) }))
    const bytes = new Map(files.map((file) => [file.path, file.data]))
    const capture: Capture = {
      source: { kind: "created", locator: draft.name },
      materialization: "copy",
      nodes: files.map((file) => ({ kind: "file", path: file.path, mode: 0o644, bytes: file.data.length, digest: `sha256:${sha256Hex(file.data)}` })),
      readFile: async (path) => {
        const value = bytes.get(path)
        if (!value) throw Error("Draft file is absent")
        return value
      },
    }
    const converted = await convertPluginTree(capture)
    return { ok: true as const, capture, ...converted, runtimeIdentity: pluginRuntimeIdentity(converted.package) }
  } catch {
    return { ok: false as const, code: "invalid-draft" as const, detail: "Created plugin draft is invalid" }
  }
}
