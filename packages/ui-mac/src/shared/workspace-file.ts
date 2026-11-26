import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import type { DocumentArtifactRecord } from "../../../util/src/codepuppy-document"
import { lstatSync, realpathSync, type Stats } from "node:fs"
import { isAbsolute, relative, resolve, sep } from "node:path"
import type { FileViewerRefusal } from "./file-viewer"

function isSafeRelPath(rel: string): boolean {
  if (typeof rel !== "string" || rel.length === 0) return false
  if (rel.includes("\u0000")) return false
  if (rel.includes("\\")) return false
  if (rel.startsWith("/")) return false
  if (/^[A-Za-z]:/.test(rel)) return false
  return rel.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

export type ResolvedWorkspaceFile = {
  abs: string
  size: number
  dev: number
  ino: number
}

export type ResolveResult = { ok: true; file: ResolvedWorkspaceFile } | { ok: false; code: FileViewerRefusal }

/**
 * 把 (workspaceDir, relPath) 解析为一个已证明的普通文件:
 * 相对性 → join → lstat(拒 symlink 叶子、拒目录)→ realpath 全路径圈禁(拒父级 symlink 逃逸)。
 * 绝不返回散文原因 —— 拒绝码是枚举,绝对路径不出本模块。
 */
export function resolveWorkspaceFile(workspaceDir: string, relPath: string): ResolveResult {
  if (typeof workspaceDir !== "string" || workspaceDir.length === 0 || !isAbsolute(workspaceDir))
    return { ok: false, code: "invalid-path" }
  if (!isSafeRelPath(relPath)) return { ok: false, code: "invalid-path" }
  const abs = resolve(workspaceDir, ...relPath.split("/"))
  // join 后仍必须在 workspaceDir 词法范围内(防御性;safe rel 已保证,再钉一道)。
  if (abs !== workspaceDir && !abs.startsWith(workspaceDir + sep)) return { ok: false, code: "invalid-path" }

  let st: Stats
  try {
    st = lstatSync(abs)
  } catch {
    return { ok: false, code: "not-found" }
  }
  if (st.isSymbolicLink()) return { ok: false, code: "symlink" }
  if (st.isDirectory()) return { ok: false, code: "not-a-file" }
  if (!st.isFile()) return { ok: false, code: "not-a-file" }

  let realRoot: string
  let real: string
  try {
    realRoot = realpathSync(workspaceDir)
    real = realpathSync(abs)
  } catch {
    return { ok: false, code: "not-found" }
  }
  // 叶子已证非 symlink;这一步拒的是**父目录**经 symlink 指出 workspace 之外。
  if (real !== realRoot && !real.startsWith(realRoot + sep)) return { ok: false, code: "escapes-workspace" }

  return { ok: true, file: { abs, size: st.size, dev: st.dev, ino: st.ino } }
}

/** Rechecks actual files for failure/pending metadata; a requested output path alone never becomes an artifact. */
export async function resolveDocumentArtifact(
  workspace: string,
  value: Pick<DocumentArtifactRecord, "checkId" | "kind" | "sourcePath" | "artifactPath">,
) {
  const source = resolveWorkspaceFile(workspace, relative(workspace, value.sourcePath).split(sep).join("/"))
  const artifact = resolveWorkspaceFile(workspace, relative(workspace, value.artifactPath).split(sep).join("/"))
  if (!source.ok || !artifact.ok) return
  const sourceBytes = await readFile(source.file.abs)
  const artifactBytes = source.file.abs === artifact.file.abs ? sourceBytes : await readFile(artifact.file.abs)
  return {
    ...value,
    sourcePath: source.file.abs,
    artifactPath: artifact.file.abs,
    sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
    artifactSha256: createHash("sha256").update(artifactBytes).digest("hex"),
  }
}

/** Container identity for the fixed renderer, independent of preview byte/page budgets. */
export async function documentContainerKind(bytes: Uint8Array) {
  if (Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-") return "pdf" as const
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return
  const { ZipReader, Uint8ArrayReader } = await import("@zip.js/zip.js")
  const { OOXML_SUBTYPES } = await import("./ooxml")
  const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(bytes)), { useWebWorkers: false })
  try {
    const entries = await reader.getEntries()
    const names = new Set(entries.filter((entry) => !entry.directory).map((entry) => entry.filename))
    if (!names.has("[Content_Types].xml")) return
    const matches = (Object.keys(OOXML_SUBTYPES) as (keyof typeof OOXML_SUBTYPES)[]).filter((kind) =>
      names.has(OOXML_SUBTYPES[kind].mainPart),
    )
    return matches.length === 1 ? matches[0] : undefined
  } finally {
    await reader.close()
  }
}

export function documentPngInfo(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    bytes.length < 33 ||
    Buffer.from(bytes.subarray(0, 8)).toString("hex") !== "89504e470d0a1a0a" ||
    Buffer.from(bytes.subarray(12, 16)).toString() !== "IHDR"
  )
    throw Error("renderer did not produce a PNG image")
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (!width || !height) throw Error("renderer produced an empty PNG")
  return { width, height, sha256: createHash("sha256").update(bytes).digest("hex") }
}
