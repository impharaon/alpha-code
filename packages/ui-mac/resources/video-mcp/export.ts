import { constants } from "node:fs"
import { copyFile, link, lstat, mkdir, readdir, realpath, rm, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { projectDirectoryIdentity } from "../../src/shared/project-directory-identity"
import {
  foldedArtifactNameKey,
  reserveArtifactSavedName,
  resolveProjectArtifactPath,
  sanitizeArtifactName,
} from "../../src/shared/project-artifact-path"
import type { TranscriptSegment } from "./contracts"
import { fail, type VideoRuntime } from "./runtime"
import type { Source } from "./source"

export function subtitleTime(ms: number, format: "srt" | "vtt") {
  const value = Math.max(0, Math.round(ms))
  return `${String(Math.floor(value / 3600000)).padStart(2, "0")}:${String(Math.floor(value / 60000) % 60).padStart(2, "0")}:${String(Math.floor(value / 1000) % 60).padStart(2, "0")}${format === "srt" ? "," : "."}${String(value % 1000).padStart(3, "0")}`
}

export function subtitleText(segments: readonly TranscriptSegment[], format: "srt" | "vtt") {
  return (
    (format === "vtt" ? "WEBVTT\n\n" : "") +
    segments
      .map(
        (segment, index) =>
          `${format === "srt" ? `${index + 1}\n` : ""}${subtitleTime(segment.startMs, format)} --> ${subtitleTime(segment.endMs, format)}\n${segment.text.replaceAll("-->", "→")}\n`,
      )
      .join("\n")
  )
}

export function transcriptText(segments: readonly TranscriptSegment[], format: "txt" | "md") {
  return (
    segments
      .map(
        (segment) =>
          `${format === "md" ? "- " : ""}[${subtitleTime(segment.startMs, "vtt")}]${segment.speaker ? ` ${segment.speaker}:` : ""} ${segment.text}`,
      )
      .join("\n") + "\n"
  )
}

export async function writeProjectOutput(
  source: Source,
  destination: string,
  fallbackName: string,
  content: { file: string } | { text: string },
  runtime: VideoRuntime,
) {
  const project = projectDirectoryIdentity(runtime.directory)
  if (project.status !== "project")
    fail("source_unreadable", "The current project location cannot be confirmed for this export.")
  const desired = path.resolve(project.directory, destination)
  const directory = await lstat(desired)
    .then((info) => (info.isDirectory() ? desired : path.dirname(desired)))
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return destination.endsWith(path.sep) ? desired : path.dirname(desired)
      throw error
    })
  const target = resolveProjectArtifactPath(
    project.directory,
    project.directory,
    path.relative(project.directory, directory),
  )
  if (!target) fail("source_unreadable", "The export target escapes the current project.")
  await mkdir(target, { recursive: true })
  const name = directory === desired ? fallbackName : path.basename(desired)
  const rawName = sanitizeArtifactName(name, fallbackName)
  const existingNames = new Set((await readdir(target)).map(foldedArtifactNameKey))
  const pending = path.join(target, `${randomUUID()}.part`)
  try {
    if ("file" in content) await copyFile(content.file, pending, constants.COPYFILE_EXCL)
    if ("text" in content) await writeFile(pending, content.text, { flag: "wx" })
    while (true) {
      runtime.signal.throwIfAborted()
      const chosen = reserveArtifactSavedName(target, rawName, randomUUID(), undefined, (candidate) =>
        existingNames.has(foldedArtifactNameKey(candidate)),
      )
      const output = path.join(target, chosen)
      const current = resolveProjectArtifactPath(
        project.directory,
        project.directory,
        path.relative(project.directory, output),
      )
      if (current !== output) fail("source_unreadable", "The export target changed while writing.")
      for (const original of source.aliases) {
        if (path.resolve(original.path) === output)
          fail("source_changed", "An export cannot overwrite its source media.")
        const originalReal = await realpath(original.path).catch(() => undefined)
        const outputReal = await realpath(output).catch(() => undefined)
        if (originalReal && originalReal === outputReal)
          fail("source_changed", "An export cannot overwrite its source media.")
      }
      try {
        await link(pending, output)
        return { path: output, bytes: (await lstat(output)).size }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
        existingNames.add(foldedArtifactNameKey(chosen))
      }
    }
  } finally {
    await rm(pending, { force: true })
  }
}
