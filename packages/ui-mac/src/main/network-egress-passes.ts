import { resolve } from "node:path"
import { hasEgressKeys, isEgressSequence, parseSessionRef, type EgressPass, type EgressPassSummary } from "../shared/network-egress-wire"
import { EGRESS_GRANTS_DIRNAME, isEgressTimestamp } from "./egress-grant-truth"
import { admitUserEgressGrant } from "./network-egress-grants"
import type { AppEnvironment } from "./codepuppy-environment"

export function egressPassPath(base: string, environment: AppEnvironment): string {
  return resolve(base, EGRESS_GRANTS_DIRNAME, `passes.${environment}.jsonl`)
}

function parsePass(value: unknown): EgressPass | undefined {
  if (!hasEgressKeys(value, ["event", "id", "at", "destination", "basis", "attribution", "sessions", "tierRevision"]) || value.event !== "egress.policy-pass" || value.basis !== "allow-all") return
  if (typeof value.id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}:[1-9][0-9]*$/.test(value.id) || !isEgressTimestamp(value.at) || !isEgressSequence(value.tierRevision)) return
  if (!hasEgressKeys(value.destination, ["host", "port"]) || !admitUserEgressGrant(value.destination.host, value.destination.port)) return
  if (!hasEgressKeys(value.attribution, ["kind"]) || value.attribution.kind !== "unknown" || !Array.isArray(value.sessions) || !value.sessions.length) return
  if (value.sessions.some((entry) => !hasEgressKeys(entry, ["session", "tier"]) || entry.tier !== "allow" || !parseSessionRef(entry.session))) return
  return value as EgressPass
}

export const egressPassLine = (pass: EgressPass) => JSON.stringify(pass) + "\n"

export function readEgressPasses(path: string, deps: { readFileSync(path: string, encoding: "utf8"): string; log(line: string): void }): { passes: EgressPass[]; persistence: "ok" | "unreadable"; completeBytes?: number; partialTail?: boolean } {
  const passes: EgressPass[] = []
  let completeBytes = 0
  try {
    const text = deps.readFileSync(path, "utf8")
    const lines = text.split("\n")
    for (const line of lines.slice(0, -1)) {
      const pass = parsePass(JSON.parse(line))
      if (!pass) throw new Error("invalid policy-pass record")
      passes.push(pass)
      completeBytes += Buffer.byteLength(line + "\n")
    }
    if (lines.at(-1) !== "") {
      deps.log("egress passes: incomplete final policy-pass record")
      return { passes, persistence: "unreadable", completeBytes, partialTail: true }
    }
    return { passes, persistence: "ok", completeBytes }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { passes, persistence: "ok", completeBytes }
    deps.log("egress passes: unreadable or incomplete policy-pass log")
    return { passes, persistence: "unreadable" as const }
  }
}

export function createEgressPassLog(store: { read(): ReturnType<typeof readEgressPasses>; append(pass: EgressPass, repairBytes?: number): void }, log: (line: string) => void) {
  const memory = new Map<string, EgressPass>()
  const initial = store.read()
  const writable = initial.persistence === "ok" || initial.partialTail === true
  let completeBytes = initial.completeBytes ?? 0
  let repairBytes = initial.partialTail ? completeBytes : undefined
  return {
    record(pass: EgressPass) {
      if (memory.has(pass.id)) return
      if (!parsePass(pass)) { log("egress passes: invalid policy-pass record"); return }
      memory.set(pass.id, structuredClone(pass))
      try {
        if (!writable) throw new Error("invalid log")
        store.append(pass, repairBytes)
        completeBytes += Buffer.byteLength(egressPassLine(pass))
        repairBytes = undefined
      } catch {
        // A failed append may have written a partial line. The single writer knows
        // the last complete byte offset; the next append repairs only that tail.
        repairBytes = completeBytes
        log("egress passes: append failed; policy pass retained for this run")
      }
    },
    snapshot() {
      const disk = store.read()
      const ids = new Set(disk.passes.map((pass) => pass.id))
      const persistence: "ok" | "unreadable" | "write-failed" = disk.persistence === "unreadable" ? "unreadable" : [...memory.keys()].some((id) => !ids.has(id)) ? "write-failed" : "ok"
      const summaries = new Map<string, EgressPassSummary>()
      for (const pass of new Map([...disk.passes.map((pass) => [pass.id, pass] as const), ...memory]).values()) {
        const destination = { host: pass.destination.host.toLowerCase(), port: pass.destination.port }
        const key = JSON.stringify(destination)
        const summary = summaries.get(key)
        if (!summary) { summaries.set(key, { destination, firstAt: pass.at, lastAt: pass.at, count: 1 }); continue }
        summary.count++
        if (Date.parse(pass.at) < Date.parse(summary.firstAt)) summary.firstAt = pass.at
        if (Date.parse(pass.at) > Date.parse(summary.lastAt)) summary.lastAt = pass.at
      }
      return { passes: [...summaries.values()], persistence }
    },
  }
}
