import { createHash, randomUUID } from "node:crypto"
import { cp, mkdir, mkdtemp, readFile, realpath, rename, stat, writeFile } from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { isAbsolute, join, relative, sep } from "node:path"
import { homedir } from "node:os"
import type { Location } from "../../../schema/src/location"
import type { LauncherPlatform, ConnectorLaunchFailure, PinnedFileDelivery } from "../../../util/src/codepuppy-connector-launch"
import type { PinnedFiles, PinnedFileId } from "../../../util/src/codepuppy-pinned-files"
import { isDocumentRuntimeVerifyReceipt, sameDocumentVerifyRef, type DocumentRuntimeState, type DocumentRuntimeVerifyTask, type DocumentRuntimeVerifyReceipt } from "../../../util/src/codepuppy-document"
import { prepareDocumentFonts } from "./document-runtime-fonts"
import { readDocumentAssets } from "./document-resources"
import { USER_DATA_LAYOUT } from "./user-data-layout"

const execute = promisify(execFile)
const executable = (root: string, platform: LauncherPlatform) => join(root, platform === "darwin-arm64" ? "LibreOffice.app/Contents/MacOS/soffice" : "program/soffice.com")
const key = (location: Location.Ref) => JSON.stringify([location.directory, location.workspaceID ?? null])

/** Consumers supply #1760's validated manifest and ID-only acquisition/classification authorities. */
export function createDocumentRuntime(input: {
  manifest: PinnedFiles; platform: LauncherPlatform; userData: string; assets: string; resources: string; python: string; sidecarGeneration: number
  ensureFile: (id: PinnedFileId, signal: AbortSignal, progress: (received: number, total: number) => void) => Promise<PinnedFileDelivery>
  classifyFailure: (delivery: PinnedFileDelivery) => ConnectorLaunchFailure
  extract?: typeof extractDocumentRuntime
}) {
  const pin = input.manifest.files.find((file) => file.family === "libreoffice" && file.target === input.platform)
  if (!pin) throw new Error(`no published LibreOffice pin for ${input.platform}`)
  const selected = pin
  const root = join(input.userData, USER_DATA_LAYOUT.documentRuntime)
  const destination = join(root, "libreoffice", input.platform, selected.version)
  const registrations = new Map<string, { id: string; location: Location.Ref; run: (task: DocumentRuntimeVerifyTask, signal: AbortSignal) => Promise<DocumentRuntimeVerifyReceipt> }>()
  const requests = new Set<string>()
  const listeners = new Set<(state: DocumentRuntimeState, sequence: number) => void>()
  const controller = new AbortController()
  let state: DocumentRuntimeState = { phase: "preparing", stage: "download" }
  let sequence = 0
  let preparation: Promise<void> | undefined
  let candidate: string | undefined
  let active: { task: DocumentRuntimeVerifyTask; abort: AbortController; settled: Promise<void>; cancelled: boolean } | undefined
  let disposed = false
  const publish = (next: DocumentRuntimeState) => {
    if (disposed) return
    state = next
    sequence++
    for (const listener of listeners) listener(state, sequence)
  }
  const fail = (error: unknown) => publish({ phase: "failed", failure: { kind: "unknown", detail: error instanceof Error ? error.message : String(error) } })
  const dispatch = () => {
    if (disposed || active || !candidate || state.phase !== "preparing" || state.stage !== "verify") return
    const registration = [...registrations.values()].find((entry) => requests.has(key(entry.location)))
    if (!registration) return
    const task: DocumentRuntimeVerifyTask = { kind: "libreoffice", taskId: randomUUID(), registrationId: registration.id, sidecarGeneration: input.sidecarGeneration, location: registration.location, pinId: selected.id, pinSha256: selected.sha256, runtimeRoot: candidate, jobRoot: join(root, "jobs", randomUUID()) }
    const abort = new AbortController()
    const attempt = { task, abort, settled: Promise.resolve(), cancelled: false }
    active = attempt
    attempt.settled = (async () => {
      let cancelTimer: ReturnType<typeof setTimeout> | undefined
      let deadline: ReturnType<typeof setTimeout> | undefined
      try {
        await mkdir(task.jobRoot, { recursive: true })
        const manifest = readDocumentAssets(input.assets)
        prepareDocumentFonts({ assets: input.assets, runtimeRoot: task.runtimeRoot, jobRoot: task.jobRoot, platform: input.platform === "darwin-arm64" ? "darwin" : "win32", home: homedir() })
        await writeFile(join(task.jobRoot, "verify.json"), JSON.stringify({ version: selected.version, template: join(input.assets, manifest.templates.docx.path), templateSha256: manifest.templates.docx.sha256 }))
        if (attempt.cancelled || disposed) return
        cancelTimer = setTimeout(() => abort.abort(), 178_000)
        const receipt = await Promise.race([
          registration.run(task, abort.signal),
          new Promise<never>((_, reject) => { deadline = setTimeout(() => { abort.abort(); reject(new Error("LibreOffice verification timeout (180000ms)")) }, 180_000) }),
        ])
        if (attempt.cancelled || disposed || active !== attempt || !registrations.has(key(registration.location))) return
        if (!isDocumentRuntimeVerifyReceipt(receipt) || !sameDocumentVerifyRef(task, receipt)) throw new Error("LibreOffice verification receipt identity mismatch")
        if (receipt.status === "cancelled") {
          if (abort.signal.aborted) throw new Error("LibreOffice verification timeout")
          return
        }
        if (receipt.status === "failed") throw new Error(`${receipt.reason}: ${receipt.detail}; exit=${receipt.exitCode}; stderr=${receipt.stderr}`)
        if (receipt.version !== selected.version) throw new Error("LibreOffice verification version mismatch")
        const canonical = await realpath(task.runtimeRoot)
        if (canonical !== task.runtimeRoot) throw new Error("LibreOffice candidate changed during verification")
        const pdf = await realpath(receipt.pdfPath)
        const inside = relative(await realpath(task.jobRoot), pdf)
        if (isAbsolute(inside) || inside === ".." || inside.startsWith(`..${sep}`)) throw new Error("LibreOffice probe PDF escaped its job")
        const bytes = await readFile(pdf)
        if (!bytes.length || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) || createHash("sha256").update(bytes).digest("hex") !== receipt.pdfSha256) throw new Error("LibreOffice probe PDF identity mismatch")
        await stat(executable(canonical, input.platform))
        if (attempt.cancelled || disposed) return
        if (canonical !== destination) {
          await mkdir(join(destination, ".."), { recursive: true })
          await rename(canonical, destination)
        }
        await writeFile(join(destination, "document-runtime.json"), JSON.stringify({ pinId: selected.id, pinSha256: selected.sha256, fonts: manifest.fonts, version: receipt.version }))
        candidate = destination
        if (attempt.cancelled || disposed || !registrations.has(key(registration.location))) return
        publish({ phase: "ready", version: receipt.version, executable: executable(destination, input.platform) })
      } catch (error) {
        if (!attempt.cancelled && !disposed) fail(error)
      } finally {
        clearTimeout(cancelTimer); clearTimeout(deadline)
        if (active === attempt) active = undefined
        if (attempt.cancelled && !disposed) dispatch()
      }
    })()
  }
  const prepare = async () => {
    try {
      const delivery = await input.ensureFile(selected.id, controller.signal, (received, total) => publish({ phase: "preparing", stage: "download", received, total }))
      if (disposed) return
      if (!delivery.result.ok) {
        if (delivery.result.error !== "cancelled") publish({ phase: "failed", failure: input.classifyFailure(delivery) })
        return
      }
      publish({ phase: "preparing", stage: "extract" })
      await mkdir(root, { recursive: true })
      const prior = await readFile(join(destination, "document-runtime.json"), "utf8").then((value) => JSON.parse(value) as { pinId: string; pinSha256: string }).catch(() => undefined)
      if (prior?.pinId === selected.id && prior.pinSha256 === selected.sha256) candidate = await realpath(destination)
      if (!candidate) {
        const staging = await mkdtemp(join(root, "libreoffice-candidate-"))
        await (input.extract ?? extractDocumentRuntime)({ archive: delivery.result.path, destination: staging, platform: input.platform, python: input.python, resources: input.resources, signal: controller.signal })
        candidate = await realpath(staging)
      }
      if (disposed) return
      publish({ phase: "preparing", stage: "verify" })
      dispatch()
    } catch (error) { if (!disposed) fail(error) }
  }
  return {
    query(location: Location.Ref) {
      requests.add(key(location))
      if (!preparation && !disposed) preparation = prepare()
      dispatch()
      return state
    },
    subscribe(listener: (state: DocumentRuntimeState, sequence: number) => void) { listeners.add(listener); listener(state, sequence); return () => { listeners.delete(listener) } },
    subscribeRuntimeVerify(location: Location.Ref, run: (task: DocumentRuntimeVerifyTask, signal: AbortSignal) => Promise<DocumentRuntimeVerifyReceipt>) {
      const identity = key(location)
      if (registrations.has(identity)) throw new Error("duplicate document verification registration")
      registrations.set(identity, { id: randomUUID(), location, run })
      dispatch()
      return async () => {
        registrations.delete(identity); requests.delete(identity)
        if (active?.task.registrationId && key(active.task.location) === identity) {
          const attempt = active
          attempt.cancelled = true; attempt.abort.abort()
          await attempt.settled
        }
      }
    },
    async dispose() {
      disposed = true; controller.abort()
      registrations.clear(); requests.clear(); listeners.clear()
      if (active) { active.cancelled = true; active.abort.abort(); await active.settled }
      await preparation
    },
  }
}

export async function extractDocumentRuntime(input: { archive: string; destination: string; platform: LauncherPlatform; python: string; resources: string; signal: AbortSignal }) {
  if (input.platform === "win32-x64") {
    await execute(input.python, ["-I", "-B", join(input.resources, "document-runtime", "extract_msi.py"), input.archive, input.destination], { signal: input.signal })
    return
  }
  const mount = await mkdtemp(join(input.destination, "mount-"))
  let attached = false
  try {
    await execute("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount, input.archive], { signal: input.signal })
    attached = true
    await cp(join(mount, "LibreOffice.app"), join(input.destination, "LibreOffice.app"), { recursive: true, dereference: false, verbatimSymlinks: true, preserveTimestamps: true })
  } finally {
    if (attached) await execute("/usr/bin/hdiutil", ["detach", mount])
  }
}
