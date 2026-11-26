// User-level remembered sites. Reading and validation have no filesystem writes; only main imports the writer.
import { resolve } from "node:path"
import type { AppEnvironment } from "./codepuppy-environment"
import { hasEgressKeys, parseSiteKey, type RememberedSite } from "../shared/network-egress-wire"
import { isEgressHostShape } from "./network-egress-registry"

export const EGRESS_GRANTS_DIRNAME = "egress-grants"
export const EGRESS_GRANT_TRUTH_VERSION = 1
export function isEgressTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)
}
export type EgressGrantRecord = RememberedSite
export type EgressGrantTruthRead = { ok: true; absent: boolean; sites: RememberedSite[] } | { ok: false; reason: string }

export function egressGrantTruthPath(casBaseRoot: string, environment: AppEnvironment): string {
  return resolve(casBaseRoot, EGRESS_GRANTS_DIRNAME, `sites.${environment}.json`)
}

export function invalidEgressGrantList(entries: unknown): string | undefined {
  if (!Array.isArray(entries)) return "sites is not an array"
  const seen = new Set<string>()
  for (const [index, entry] of entries.entries()) {
    if (!hasEgressKeys(entry, ["site", "at"])) return `sites[${index}] has invalid fields`
    const site = parseSiteKey(entry.site)
    if (!site || !isEgressHostShape(site.value)) return `sites[${index}].site is invalid`
    if (!isEgressTimestamp(entry.at)) return `sites[${index}].at is not a UTC timestamp`
    const key = JSON.stringify(site)
    if (seen.has(key)) return `sites[${index}] duplicates an earlier site`
    seen.add(key)
  }
}

export function canonicalEgressGrantRecord(record: RememberedSite): RememberedSite {
  return { site: { kind: record.site.kind, value: record.site.value }, at: record.at }
}

export function readEgressGrantTruth(path: string, deps: { readFileSync(path: string, encoding: "utf8"): string; log(line: string): void }): EgressGrantTruthRead {
  const reject = (reason: string): EgressGrantTruthRead => { deps.log(`egress sites: ${path}: ${reason}`); return { ok: false, reason: `${path}: ${reason}` } }
  try {
    const parsed: unknown = JSON.parse(deps.readFileSync(path, "utf8"))
    if (!hasEgressKeys(parsed, ["v", "sites"]) || parsed.v !== EGRESS_GRANT_TRUTH_VERSION) return reject("invalid sites document")
    const bad = invalidEgressGrantList(parsed.sites)
    if (bad) return reject(bad)
    return { ok: true, absent: false, sites: (parsed.sites as RememberedSite[]).map(canonicalEgressGrantRecord) }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { ok: true, absent: true, sites: [] }
    return reject(error instanceof Error ? error.message : String(error))
  }
}
