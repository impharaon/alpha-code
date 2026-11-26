import { randomBytes, randomUUID, createHash, timingSafeEqual } from "node:crypto"
import { spawn, type ChildProcess } from "node:child_process"
import type { IncomingMessage, ServerResponse } from "node:http"
import { planPackageManagerExecution, packageManagerExecutionSource, type PackageManagerCommand } from "../../engine/package-manager-plan"
import type { PackageManagerExecutionLease, PreparedShellExecution } from "@opencode/plugin/codepuppy-package-manager"
import { resolveHomebrewExecutable, type HomebrewInstallation } from "./homebrew-installation"
import { loadPackageManagerNative, packageManagerHelperPath, type BoundShellProcess, type PackageManagerNative, type NativeHelperPeer, type PackageManagerNodeClaim, type PackageManagerNodeGrant } from "./package-manager-helper"
import type { PackageManagerCancelReason, PackageManagerControlHandler } from "./codepuppy-sidecar-messages"

type Node = {
  plan: PackageManagerCommand
  state: "pending" | "claimed" | "started" | "terminal"
  proof?: Buffer
  requesting?: boolean
  stop?: (reason: PackageManagerCancelReason) => void
}
type Execution = {
  generation: Generation
  nodes: Map<string, Node>
  env: Readonly<Record<string, string>>
  root?: BoundShellProcess
  bound: Promise<void>
  resolveBound(): void
}
type Authorization = { generation: Generation; executionID: string; nodeID: string }
type Generation = {
  active: boolean
  env: Readonly<Record<string, string>>
  installations: readonly HomebrewInstallation[]
  port: number
  helper: string
  native: PackageManagerNative
  serviceName: string
  service?: unknown
  jobs: Set<Promise<void>>
}
let quitting = false
const executions = new Map<string, Execution>()
// Only the hash and IDs survive Shell finish, so a replay can get the closed 409 response.
const authorizations = new Map<string, Authorization>()
const generations = new Set<Generation>()

export function openPackageManagerGeneration(input: {
  env: Readonly<Record<string, string>>; installations: readonly HomebrewInstallation[]; port: number; addon: string
}): { control: PackageManagerControlHandler; close(): Promise<void> } {
  if (quitting) throw new Error("package-manager: app-quitting")
  const generation: Generation = { active: true, env: input.env, installations: input.installations, port: input.port, helper: packageManagerHelperPath(input.addon), native: loadPackageManagerNative(input.addon), serviceName: `app.codepuppy.pm.${process.pid}.${randomUUID()}`, jobs: new Set() }
  generations.add(generation)
  const owned = (executionID: string) => {
    const execution = executions.get(executionID)
    if (execution?.generation === generation) return execution
  }
  let closing: Promise<void> | undefined
  return {
    control: async (request) => {
      if (!generation.active) return { ok: false, error: "unavailable" }
      if (request.op === "authorize") return { ok: true, lease: authorizePackageManagerExecution(request.input, generation) }
      const execution = owned(request.executionID)
      // Core's scope finalizer can finish an already completed Shell.
      if (!execution) return request.op === "finish" || request.op === "cancel" ? { ok: true } : { ok: false, error: "unavailable" }
      if (request.op === "bind") {
        if (execution.root) return { ok: false, error: "unavailable" }
        execution.root = generation.native.packageManagerProcessIdentity(request.pid)
        execution.resolveBound()
      }
      if (request.op === "finish" || request.op === "cancel") finishPackageManagerExecution(request.executionID, execution, request.op === "cancel" ? request.reason : "cancelled")
      return { ok: true }
    },
    close: () => closing ??= closePackageManagerGeneration(generation, "engine-disconnected"),
  }
}

function authorizePackageManagerExecution(input: PreparedShellExecution, generation: Generation): PackageManagerExecutionLease {
  const executionID = randomUUID()
  const env = Object.freeze({ ...generation.env })
  const nodes = planPackageManagerExecution({ manager: "homebrew", ...input, env }).filter((plan) => resolveHomebrewExecutable({ ...plan, env: nodeEnvironment(generation.env, plan), installations: generation.installations }))
  if (nodes.length && generation.service === undefined) generation.service = generation.native.startPackageManagerService(generation.serviceName, generation.helper, (claim, peer, reply) => {
    claimPackageManagerNode(claim, peer, generation).then(reply, () => reply({ kind: "error", error: "unauthorized" }))
  })
  const proofs = nodes.map(() => randomBytes(32))
  const privateInput = { fd: 3, data: Buffer.from(proofs.map((proof) => proof.toString("hex") + "\n").join("")) }
  const lease = { executionID, nodes: nodes.map((node) => ({ nodeID: node.nodeID })), helperService: generation.serviceName, executionSource: nodes.length ? packageManagerExecutionSource({ ...input, nodes, executionID, helperService: generation.serviceName, helper: generation.helper, privateInput }) : input.command, shellPrivateInput: privateInput }
  if (nodes.length) {
    const bound = Promise.withResolvers<void>()
    executions.set(executionID, { generation, env, nodes: new Map(nodes.map((plan, index) => [plan.nodeID, { plan, state: "pending", proof: proofs[index] }])), bound: bound.promise, resolveBound: () => bound.resolve() })
  }
  return lease
}

async function claimPackageManagerNode(claim: PackageManagerNodeClaim, peer: NativeHelperPeer, generation: Generation): Promise<PackageManagerNodeGrant> {
  const execution = executions.get(claim.executionID)
  if (!execution || !generation.active || execution.generation !== generation) return { kind: "error", error: "inactive-execution" }
  const node = execution.nodes.get(claim.nodeID)
  if (!node) return { kind: "error", error: "unauthorized" }
  if (node.state !== "pending") return { kind: "error", error: "node-consumed" }
  // Format precedes decoding/comparison. Neither a bad proof nor a bad peer consumes the real leaf.
  if (!/^[0-9a-f]{64}$/.test(claim.nodeProof) || !node.proof || !timingSafeEqual(Buffer.from(claim.nodeProof, "hex"), node.proof)) return { kind: "error", error: "unauthorized" }
  await execution.bound
  if (executions.get(claim.executionID) !== execution || !generation.active) return { kind: "error", error: "inactive-execution" }
  if (node.state !== "pending") return { kind: "error", error: "node-consumed" }
  if (!execution.root || !generation.native.packageManagerBoundDescendant(peer.pid, peer.pidversion, execution.root)) return { kind: "error", error: "unauthorized" }
  node.proof.fill(0); node.proof = undefined
  if (!resolveHomebrewExecutable({ ...node.plan, env: nodeEnvironment(execution.env, node.plan), installations: generation.installations })) { terminal(node); return { kind: "fenced" } }
  const authorization = randomBytes(32).toString("hex")
  node.state = "claimed"
  authorizations.set(digest(authorization), { generation, executionID: claim.executionID, nodeID: claim.nodeID })
  return { kind: "delegated", brokerPort: generation.port, authorization }
}

function nodeEnvironment(base: Readonly<Record<string, string>>, plan: PackageManagerCommand) {
  const env = { ...base, ...Object.fromEntries(plan.assignments.map((assignment) => [assignment.name, assignment.value])) }
  for (const key of Object.keys(env)) if (["BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS", "PS4"].includes(key) || key.startsWith("BASH_FUNC_") || key.startsWith("CODEPUPPY_PACKAGE_MANAGER_")) delete env[key]
  return env
}
function digest(value: string) { return createHash("sha256").update(value).digest("hex") }
function terminal(node: Node) { node.state = "terminal"; node.proof?.fill(0); node.proof = undefined }
function finishPackageManagerExecution(id: string, execution: Execution, reason: PackageManagerCancelReason) {
  executions.delete(id)
  execution.resolveBound()
  for (const node of execution.nodes.values()) { node.stop?.(reason); terminal(node) }
  execution.nodes.clear()
}
async function closePackageManagerGeneration(generation: Generation, reason: PackageManagerCancelReason) {
  generation.active = false
  for (const [id, execution] of executions) if (execution.generation === generation) finishPackageManagerExecution(id, execution, reason)
  if (generation.service !== undefined) { generation.native.closePackageManagerService(generation.service); generation.service = undefined }
  await Promise.all(generation.jobs)
  for (const [hash, record] of authorizations) if (record.generation === generation) authorizations.delete(hash)
  generations.delete(generation)
}
export async function stopPackageManagerExecutions() {
  quitting = true
  await Promise.all([...generations].map((generation) => closePackageManagerGeneration(generation, "app-quitting")))
}

/** Only the existing policy proxy calls this exact route. No execution materials come from HTTP. */
export async function handlePackageManagerProcess(req: IncomingMessage, res: ServerResponse) {
  const reject = (status: number, error: string) => {
    const body = JSON.stringify({ error })
    res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Connection: "close" }); res.end(body)
  }
  const token = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization ?? "")?.[1]
  const record = token ? authorizations.get(digest(token)) : undefined
  if (!record) return reject(401, "unauthorized")
  const execution = executions.get(record.executionID)
  if (!record.generation.active || !execution) return reject(409, "inactive-execution")
  const node = execution.nodes.get(record.nodeID)
  if (!node || node.state !== "claimed" || node.requesting) return reject(409, "node-consumed")
  node.requesting = true
  let pending = "", first = true, sequence = 0, child: ChildProcess | undefined, stopped: PackageManagerCancelReason | undefined, ended = false, invalid = false, eof = false
  const emit = (frame: object) => !res.destroyed && !res.writableEnded && res.write(JSON.stringify(frame) + "\n")
  const stop = (reason: PackageManagerCancelReason) => {
    if (stopped || ended) return
    stopped = reason
    if (child?.pid) signalGroup(child.pid, "SIGTERM")
    else terminal(node)
  }
  node.stop = stop
  req.once("aborted", () => stop("cancelled"))
  res.once("close", () => { if (!ended) stop("cancelled") })
  const badFrame = () => {
    terminal(node)
    if (first) { ended = true; reject(400, "invalid-request"); return }
    invalid = true
    stop("cancelled")
    // HTTP status is already 200. State the reason, suppress further child output, then close the stream.
    emit({ type: "stderr", seq: sequence++, dataBase64: Buffer.from("package-manager: invalid-request\n").toString("base64") })
    res.end()
  }
  try {
    for await (const chunk of req) {
      pending += chunk.toString("utf8")
      for (;;) {
        const newline = pending.indexOf("\n"); if (newline < 0) break
        const raw = pending.slice(0, newline); pending = pending.slice(newline + 1)
        let frame: unknown
        try { frame = JSON.parse(raw) } catch { badFrame(); return }
        if (!frame || typeof frame !== "object" || Array.isArray(frame)) { badFrame(); return }
        const value = frame as Record<string, unknown>
        if (first) {
          if (Object.keys(value).length !== 2 || typeof value.executionID !== "string" || typeof value.nodeID !== "string" || req.headers["content-type"] !== "application/x-ndjson") { badFrame(); return }
          if (value.executionID !== record.executionID || value.nodeID !== record.nodeID) { terminal(node); ended = true; return reject(403, "node-mismatch") }
          if (executions.get(record.executionID) !== execution || !record.generation.active) { ended = true; return reject(409, "inactive-execution") }
          if (node.state !== "claimed") { ended = true; return reject(409, "node-consumed") }
          // Validate already-arrived subsequent frames before spawning; future frames remain streaming.
          let bufferedEof = false
          for (const line of pending.split("\n").slice(0, -1)) {
            let value: unknown
            try { value = JSON.parse(line) } catch { badFrame(); return }
            if (bufferedEof || !stdinFrame(value)) { badFrame(); return }
            bufferedEof = value.type === "stdin-eof"
          }
          first = false
          const env = nodeEnvironment(execution.env, node.plan)
          const selected = resolveHomebrewExecutable({ ...node.plan, env, installations: execution.generation.installations })
          res.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", Connection: "close" })
          if (!selected) { terminal(node); ended = true; emit({ type: "fenced" }); res.end(); return }
          node.state = "started"
          child = spawn(selected.executable, [...node.plan.argv], { shell: false, cwd: node.plan.cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] })
          const job = Promise.withResolvers<void>()
          execution.generation.jobs.add(job.promise)
          void job.promise.finally(() => execution.generation.jobs.delete(job.promise))
          // Empty stdout is the start acknowledgement: helper has not yet consumed its original stdin.
          emit({ type: "stdout", seq: sequence++, dataBase64: "" })
          for (const type of ["stdout", "stderr"] as const) child[type]!.on("data", (bytes: Buffer) => {
            if (invalid || stopped) return
            if (!emit({ type, seq: sequence++, dataBase64: bytes.toString("base64") })) { child![type]!.pause(); res.once("drain", () => child?.[type]?.resume()) }
          })
          let closed = false, code: number | null = null, signal: NodeJS.Signals | null = null
          child.once("error", (error: NodeJS.ErrnoException) => { code = error.code === "ENOENT" ? 127 : 126; if (!invalid) emit({ type: "stderr", seq: sequence++, dataBase64: Buffer.from(error.message + "\n").toString("base64") }) })
          child.once("close", (exitCode, exitSignal) => { closed = true; if (exitCode !== null && exitCode >= 0) code = exitCode; signal = exitSignal })
          child.stdin!.on("error", () => {})
          let forceAt: number | undefined
          // Track the group even after its leader exits; grandchildren can ignore TERM and keep pipes open.
          const cleanup = setInterval(() => {
            const alive = child?.pid !== undefined && groupExists(child.pid)
            if ((stopped || closed) && alive) {
              if (forceAt === undefined) { signalGroup(child!.pid!, "SIGTERM"); forceAt = Date.now() + 3000 }
              if (Date.now() >= forceAt) signalGroup(child!.pid!, "SIGKILL")
            }
            if (!closed || alive) return
            clearInterval(cleanup); ended = true; terminal(node)
            if (!invalid) emit(stopped ? { type: "stopped", reason: stopped } : { type: "exit", exitCode: code ?? (signal ? null : 126), signal })
            res.end(); job.resolve()
          }, 20)
          continue
        }
        if (eof) { badFrame(); return }
        if (Object.keys(value).length === 1 && value.type === "stdin-eof") { eof = true; child?.stdin?.end(); continue }
        if (!stdinFrame(value) || value.type !== "stdin") { badFrame(); return }
        if (child?.stdin && !child.stdin.destroyed && !child.stdin.writableEnded && !child.stdin.write(Buffer.from(value.dataBase64, "base64"))) await new Promise<void>((resolve) => {
          const stream = child!.stdin!
          const done = () => { stream.off("drain", done); stream.off("close", done); resolve() }
          stream.once("drain", done); stream.once("close", done)
        })
      }
    }
    if (first || pending) { badFrame(); return }
    child?.stdin?.end()
  } catch { stop("cancelled"); if (!res.headersSent) reject(400, "invalid-request"); else res.destroy() }
}
function signalGroup(pid: number, signal: NodeJS.Signals) {
  try { process.kill(-pid, signal) } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error }
}
function groupExists(pid: number) {
  try { process.kill(-pid, 0); return true } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error }
}

function stdinFrame(value: unknown): value is { type: "stdin"; dataBase64: string } | { type: "stdin-eof" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const frame = value as Record<string, unknown>
  if (frame.type === "stdin-eof") return Object.keys(frame).length === 1
  return Object.keys(frame).length === 2 && frame.type === "stdin" && typeof frame.dataBase64 === "string" && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.dataBase64)
}
