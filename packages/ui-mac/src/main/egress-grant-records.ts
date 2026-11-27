// Production binding is main-only; neither this module nor the atomic writer belongs in the sidecar closure.
import { readFileSync, mkdirSync, writeFileSync, renameSync, rmSync, appendFileSync, truncateSync } from "node:fs"
import { dirname } from "node:path"
import { createEgressPassLog, egressPassLine, egressPassPath, readEgressPasses } from "./network-egress-passes"
import { resolveCodePuppyStateBase } from "./codepuppy-environment"
import { egressGrantTruthPath, readEgressGrantTruth } from "./egress-grant-truth"
import { writeEgressGrantTruth } from "./egress-grant-truth-write"
import type { RememberedSite } from "../shared/network-egress-wire"

export function createEgressSiteStore(log: (line: string) => void) {
  const base = resolveCodePuppyStateBase("egress sites")
  const path = base.ok ? egressGrantTruthPath(base.casBaseRoot, base.environment) : undefined
  return {
    read: () => path ? readEgressGrantTruth(path, { readFileSync, log }) : { ok: false as const, reason: "egress site location unavailable" },
    write(sites: readonly RememberedSite[]) {
      if (!path) throw new Error("egress site location unavailable")
      writeEgressGrantTruth(path, sites, { mkdirSync, writeFileSync, renameSync, rmSync })
    },
  }
}

export function createEgressPassStore(log: (line: string) => void) {
  const base = resolveCodePuppyStateBase("egress passes")
  const path = base.ok ? egressPassPath(base.casBaseRoot, base.environment) : undefined
  return createEgressPassLog({
    read: () => path ? readEgressPasses(path, { readFileSync, log }) : { passes: [], persistence: "unreadable" },
    append(pass, repairBytes) {
      if (!path) throw new Error("egress pass location unavailable")
      mkdirSync(dirname(path), { recursive: true })
      if (repairBytes !== undefined) {
        // A failed first append can leave no file at all. Create it before repair.
        appendFileSync(path, "", { mode: 0o600 })
        truncateSync(path, repairBytes)
      }
      appendFileSync(path, egressPassLine(pass), { encoding: "utf8", mode: 0o600 })
    },
  }, log)
}
