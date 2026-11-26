import { createHash } from "node:crypto"
import { readFile, realpath } from "node:fs/promises"
import { isAbsolute, join, relative, sep } from "node:path"
import { Effect, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { ChildProcessSpawner } from "effect/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "../../util/src/cross-spawn-spawner"
import { LayerNode } from "../../util/src/effect/layer-node"
import type { Location } from "../../schema/src/location"
import type { PinnedFiles } from "../../util/src/codepuppy-pinned-files"
import { isDocumentRuntimeVerifyTask, isDocumentRuntimeVerifyReceipt, sameDocumentVerifyRef, type DocumentRuntimeVerifyTask, type DocumentRuntimeVerifyReceipt } from "../../util/src/codepuppy-document"

/** Fixed preparation executor. Its caller is the owning Location's setup, never tool/model input. */
export function createDocumentRuntimeVerifier(input: {
  location: Location.Ref; sidecarGeneration: number; manifest: PinnedFiles
  python: string; script: string; templates: string; documentRuntimeRoot: string
}) {
  const attempts = new Map<string, { task: DocumentRuntimeVerifyTask; result: Promise<DocumentRuntimeVerifyReceipt> }>()
  return (task: DocumentRuntimeVerifyTask, signal: AbortSignal): Promise<DocumentRuntimeVerifyReceipt> => {
    const old = attempts.get(task.taskId)
    if (old && sameDocumentVerifyRef(old.task, task)) return old.result
    const result = (async (): Promise<DocumentRuntimeVerifyReceipt> => {
      let stderr = ""
      let exitCode: number | null = null
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 178_000)
      try {
        if (!isDocumentRuntimeVerifyTask(task) || task.sidecarGeneration !== input.sidecarGeneration || task.location.directory !== input.location.directory || task.location.workspaceID !== input.location.workspaceID || old) throw new Error("verification task identity mismatch")
        const pin = input.manifest.files.find((file) => file.id === task.pinId && file.sha256 === task.pinSha256 && file.family === "libreoffice")
        if (!pin) throw new Error("verification pin is not in the trusted manifest")
        await inside(input.documentRuntimeRoot, task.runtimeRoot)
        await inside(join(input.documentRuntimeRoot, "jobs"), task.jobRoot)
        const descriptor = JSON.parse(await readFile(join(task.jobRoot, "verify.json"), "utf8")) as { version: string; template: string; templateSha256: string }
        if (descriptor.version !== pin.version) throw new Error("verification version does not match the pin")
        await inside(input.templates, descriptor.template)
        if (createHash("sha256").update(await readFile(descriptor.template)).digest("hex") !== descriptor.templateSha256) throw new Error("verification template changed")
        const process = Effect.scoped(Effect.gen(function* () {
          const spawner = yield* ChildProcessSpawner
          const handle = yield* spawner.spawn(ChildProcess.make(input.python, ["-I", "-B", input.script, task.runtimeRoot, task.jobRoot], { cwd: input.location.directory, forceKillAfter: "2 seconds" }))
          return yield* Effect.all([
            Stream.runFold(Stream.decodeText(handle.stdout), () => "", (a, b) => a + b),
            Stream.runFold(Stream.decodeText(handle.stderr).pipe(Stream.tap((chunk) => Effect.sync(() => { stderr += chunk }))), () => "", (a, b) => a + b),
            handle.exitCode,
          ], { concurrency: "unbounded" })
        })).pipe(Effect.provide(LayerNode.compile(CrossSpawnSpawner.node)))
        const output = await Effect.runPromise(process, { signal: AbortSignal.any([signal, controller.signal]) })
        stderr = output[1]; exitCode = Number(output[2])
        if (signal.aborted) return { ...task, status: "cancelled", reason: "requested" }
        if (exitCode !== 0) return { ...task, status: "failed", reason: "conversion", detail: "fixed LibreOffice verification exited unsuccessfully", exitCode, stderr }
        const value = JSON.parse(output[0]) as Record<string, unknown>
        const receipt = { ...task, status: "completed", version: value.version, pdfPath: value.pdfPath, pdfSha256: value.pdfSha256, pageCount: value.pageCount }
        if (!isDocumentRuntimeVerifyReceipt(receipt) || receipt.status !== "completed" || receipt.version !== pin.version) throw new Error("invalid fixed verification output")
        await inside(task.jobRoot, receipt.pdfPath)
        if (createHash("sha256").update(await readFile(receipt.pdfPath)).digest("hex") !== receipt.pdfSha256) throw new Error("probe PDF digest mismatch")
        return receipt
      } catch (error) {
        if (signal.aborted) return { ...task, status: "cancelled", reason: "requested" }
        return { ...task, status: "failed", reason: controller.signal.aborted ? "timeout" : exitCode === null ? "spawn" : "invalid-result", detail: error instanceof Error ? error.message : String(error), exitCode, stderr }
      } finally { clearTimeout(timer) }
    })()
    if (!old) attempts.set(task.taskId, { task, result })
    return result
  }
}

async function inside(root: string, path: string) {
  const canonical = await realpath(root)
  const actual = await realpath(path)
  const child = relative(canonical, actual)
  if (!child || isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`)) throw new Error("fixed verification path escaped its trusted root")
  return actual
}
