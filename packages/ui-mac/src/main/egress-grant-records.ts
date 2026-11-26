// Production binding is main-only; neither this module nor the atomic writer belongs in the sidecar closure.
import { readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs"
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
