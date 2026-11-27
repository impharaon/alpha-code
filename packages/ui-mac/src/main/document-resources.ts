import { join } from "node:path"
import type { DocumentBootstrap } from "../../../util/src/codepuppy-bootstrap"
import type { PinnedFiles } from "../../../util/src/codepuppy-pinned-files"
import { documentAssetResources, documentRuntimeResources } from "../shared/document-resources"
import { USER_DATA_LAYOUT } from "./user-data-layout"

export { DOCUMENT_ASSET_BUILD_DIR, OFFICE_RUNTIME_BUILD_DIR, officePythonPath, readDocumentAssets, documentResources, documentRuntimeResources, type DocumentAssets } from "../shared/document-resources"

/** #1761 §4.8 bootstrap projection: bundled paths and the trusted LibreOffice pins, resolved by the same authorities as the host. */
export function documentBootstrap(input: { userData: string; resourcesRoot: string; packaged: boolean; platform: NodeJS.Platform; manifest: PinnedFiles }): DocumentBootstrap {
  if (input.platform !== "darwin" && input.platform !== "win32") throw new Error(`no document resources for ${input.platform}`)
  const resources = documentAssetResources({ resourcesRoot: input.resourcesRoot, packaged: input.packaged, platform: input.platform })
  const scripts = documentRuntimeResources(input.resourcesRoot)
  return {
    python: resources.python,
    assets: resources.assets,
    templates: resources.templates,
    documentRuntimeRoot: join(input.userData, USER_DATA_LAYOUT.documentRuntime),
    verify: scripts.verify,
    render: scripts.render,
    recalculate: scripts.recalculate,
    libreoffice: input.manifest.files.filter((file) => file.family === "libreoffice"),
  }
}
