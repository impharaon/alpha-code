// Shared fixed-file data contract: domestic-cloud-connectivity §4.11 @ 86a58c7.
// The launcher owns manifest validation, cache paths and acquisition. No downloader lives here.
export type PinnedFamily = "python" | "libreoffice" | "speech-model" | "ffmpeg"
export type PinnedTarget = "darwin-arm64" | "darwin-x64" | "win32-x64" | "any"
export type PinnedFileId = `${PinnedFamily}/${PinnedTarget}/${string}`
export type PinnedFiles = {
  schemaVersion: 1
  files: readonly {
    id: PinnedFileId
    family: PinnedFamily
    target: PinnedTarget
    version: string
    originUrl: string
    sha256: string
    bytes: number
    provenanceUrl: string
  }[]
}
export type EnsurePinnedFileResult =
  | { ok: true; path: string; via: "cache" | "relay" | "origin" }
  | { ok: false; error: "unknown-file" | "network" | "integrity" | "disk" | "cancelled" }
