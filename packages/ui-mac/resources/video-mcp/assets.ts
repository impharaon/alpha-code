import { copyFile, mkdir, readFile, rename, rm } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { z } from "zod"
import pins from "../pinned-files.json"
import { defaultOcrLanguages, defaultOcrPins, modelRoles, videoRecipes } from "./asset-recipes"
import { cachePath, digest, fileDigest, publish, readPublished, withMediaLock } from "./cache"
import { fail, type ComponentName, type VideoRuntime } from "./runtime"

// Consumer of VIDEO-L1-v2, not a PinnedFiles parser or downloader. Only the
// protected producer's ids occur in requests; URLs/targets never cross here.
export const preparedFilesResult = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), files: z.array(z.strictObject({ id: z.string(), path: z.string() })) }),
  z.strictObject({
    ok: z.literal(false),
    error: z.enum(["unknown-file", "network", "integrity", "disk", "cancelled"]),
  }),
])
export type VideoInvocation = { directory: string; cacheRoot: string; bundleDirectory: string }
export type BundledVideoRuntime = {
  platform: VideoRuntime["platform"]
  files: Record<string, string>
  components: Record<string, string>
}

export function videoInvocation(args: readonly string[], bundleDirectory: string): VideoInvocation | undefined {
  if (!args.length) return undefined
  if (args.length !== 3 || args[1] !== "--cache-root" || !path.isAbsolute(args[0]!) || !path.isAbsolute(args[2]!))
    fail("processing_failed", "The trusted video invocation is missing its absolute project/cache arguments.")
  return { directory: args[0]!, cacheRoot: args[2]!, bundleDirectory }
}

export async function createVideoRuntime(
  input: VideoInvocation,
  call: {
    signal: AbortSignal
    meta: Record<string, unknown> | undefined
    ensure: (
      ids: readonly string[],
      metadata: Record<string, unknown>,
      options: { signal: AbortSignal; timeout: number },
    ) => Promise<z.infer<typeof preparedFilesResult>>
  },
): Promise<VideoRuntime> {
  const platform = `${process.platform}-${process.arch}`
  if (platform !== "darwin-arm64" && platform !== "win32-x64")
    fail("processing_failed", "This video runtime was not built for the current platform.")
  const bundled = await readFile(path.join(input.bundleDirectory, "runtime.json"), "utf8")
    .then((text) => JSON.parse(text) as BundledVideoRuntime)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT")
        fail("component_download_failed", "The bundled video native runtime has not been prepared.")
      throw error
    })
  if (bundled.platform !== platform)
    fail("processing_failed", "The bundled video native runtime has the wrong target platform.")
  for (const [relative, expected] of Object.entries(bundled.files)) {
    const absolute = bundleFile(relative)
    if ((await fileDigest(absolute)) !== expected)
      fail("component_download_failed", "A bundled video dependency failed its content check.")
  }
  const recipe = digest(
    JSON.stringify({
      algorithm: "video-local-v1",
      pins: pins.files
        .filter((pin) => pin.target === "any" || pin.target === platform)
        .map((pin) => [pin.id, pin.sha256]),
      bundled: bundled.files,
    }),
  )
  const runtime: VideoRuntime = {
    directory: input.directory,
    cacheRoot: input.cacheRoot,
    recipe,
    platform,
    signal: call.signal,
    progress: () => {},
    component,
  }
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy
  if (proxy) runtime.egressProxy = proxy
  return runtime

  function bundleFile(relative: string) {
    const root = path.resolve(input.bundleDirectory)
    const file = path.resolve(root, relative)
    if (path.isAbsolute(relative) || file === root || !file.startsWith(root + path.sep))
      fail("processing_failed", "The bundled video dependency path escapes its resource root.")
    return file
  }

  async function ensure(ids: readonly string[]) {
    call.signal.throwIfAborted()
    const token = call.meta?.["codepuppy/pinned-files.call"]
    const deadline = call.meta?.["codepuppy/pinned-files.deadline"]
    if (typeof token !== "string" || !token || !Number.isSafeInteger(deadline))
      fail("component_download_failed", "The managed video call has no trusted preparation association.")
    const remaining = (deadline as number) - Date.now()
    if (remaining <= 0) fail("processing_failed", "The original video tool execution budget has elapsed.")
    const metadata = { "codepuppy/pinned-files.call": token, "codepuppy/pinned-files.deadline": deadline }
    const result = await call.ensure([...new Set(ids)], metadata, { signal: call.signal, timeout: remaining })
    if (!result.ok) {
      if (result.error === "cancelled") fail("cancelled", "Video component preparation was cancelled.")
      if (result.error === "disk") fail("disk_full", "There is not enough space to prepare the video component.")
      fail("component_download_failed", `The trusted component preparer reported ${result.error}.`)
    }
    call.signal.throwIfAborted()
    return ids.map((id) => {
      const file = result.files.find((file) => file.id === id)
      if (!file || !path.isAbsolute(file.path))
        fail("component_download_failed", "The component preparer did not return every requested entry.")
      return file
    })
  }

  async function component(name: ComponentName) {
    if (name === "node") return { path: process.execPath, digest: await fileDigest(process.execPath) }
    if (typeof name === "string" && name in bundled.components) {
      const relative = bundled.components[name]!
      const sha256 = bundled.files[relative]
      if (!sha256) fail("component_download_failed", "The bundled video entry is not in its content inventory.")
      return { path: bundleFile(relative), digest: sha256 }
    }
    if (name === "ocr-model" || typeof name === "object")
      return ocrModels(typeof name === "object" ? name.script : undefined)
    if (name === "ffmpeg" || name === "ffprobe") {
      const id =
        videoRecipes.find((recipe) => recipe.id.startsWith(`ffmpeg/${platform}/`))?.id ??
        fail("component_download_failed", "The codec recipe is missing.")
      const pin =
        pins.files.find((pin) => pin.id === id) ??
        fail("component_download_failed", "The pinned video codec archive is absent from this build.")
      const files = await ensure([id])
      return {
        path: path.join(files[0]!.path, "bin", name + (platform === "win32-x64" ? ".exe" : "")),
        digest: digest(`${pin.sha256}:${name}`),
      }
    }
    if (name === "python") {
      const id =
        videoRecipes.find((recipe) => recipe.id.startsWith(`python/${platform}/`))?.id ??
        fail("component_download_failed", "The launcher Python recipe is missing.")
      const pin =
        pins.files.find((pin) => pin.id === id) ??
        fail("component_download_failed", "The launcher's pinned Python entry is absent from this build.")
      const files = await ensure([id])
      return { path: files[0]!.path, digest: pin.sha256 }
    }
    const role = modelRoles[name as keyof typeof modelRoles]
    if (!role) fail("component_download_failed", "This video component has no protected asset recipe.")
    const pin =
      pins.files.find((pin) => pin.id === role.id) ??
      fail("component_download_failed", "The requested video model is absent from the pinned-file list.")
    const files = await ensure([role.id])
    return {
      path: role.member ? path.join(files[0]!.path, role.member) : files[0]!.path,
      digest: digest(`${pin.sha256}:${role.member}`),
    }
  }

  async function ocrModels(script: string | undefined) {
    const ids = script
      ? pins.files
          .filter((pin) => pin.family === "ocr-model" && pin.id.endsWith(`/script-${script}`))
          .map((pin) => pin.id)
      : defaultOcrPins().map((pin) => pin.id)
    if (!ids.length) fail("component_download_failed", "No pinned OCR model matches the detected script.")
    const key = digest(JSON.stringify(ids.map((id) => [id, pins.files.find((pin) => pin.id === id)?.sha256])))
    const root = cachePath(runtime, "ocr-models", key)
    const complete = path.join(root, "complete.json")
    if (await readPublished(complete)) return { path: root, digest: key }
    return withMediaLock(runtime, `ocr-models:${key}`, async () => {
      if (await readPublished(complete)) return { path: root, digest: key }
      const entries = await ensure(ids)
      await mkdir(root, { recursive: true })
      const outputs: string[] = []
      for (const [index, entry] of entries.entries()) {
        const filename = script
          ? path.join("script", `${script}.traineddata`)
          : `${defaultOcrLanguages[index]}.traineddata`
        const target = path.join(root, filename)
        await mkdir(path.dirname(target), { recursive: true })
        const pending = `${target}.${randomUUID()}.part`
        try {
          await copyFile(entry.path, pending)
          await rename(pending, target)
        } finally {
          await rm(pending, { force: true })
        }
        outputs.push(target)
      }
      await publish(complete, { ids }, outputs)
      return { path: root, digest: key }
    })
  }
}
