import type { PackageDeclarationV1 } from "../shared/plugin-install"
import { readPackageLedgerStateV1 } from "./ext-receipt-v2"
import { resolveVerifiedPackageV1, type VerifiedPackageResolutionV1 } from "./package-installability"

export function createPackageDeclarationResolver(deps: { root(): string; catalog(): unknown }) {
  return function resolvePackageDeclarationsV1(
    packageId: string,
  ):
    | { ok: true; origin: "catalog"; verified: VerifiedPackageResolutionV1 }
    | { ok: true; origin: "installed"; declarations: PackageDeclarationV1[] }
    | { ok: false; reason: "not-installed" | "catalog-unavailable" } {
    const state = readPackageLedgerStateV1(deps.root(), { sideEffectFree: true })
    const graph = state.ok ? state.packageGraphs.find((graph) => graph.packageId === packageId) : undefined
    if (!state.ok || !graph) return { ok: false, reason: "not-installed" }
    const root = state.records.find((record) => record.kind === graph.root.kind && record.name === graph.root.name)
    if (root?.origin !== "catalog") return { ok: true, origin: "installed", declarations: graph.declarations ?? [] }
    const catalog = deps.catalog()
    if (!catalog) return { ok: false, reason: "catalog-unavailable" }
    return { ok: true, origin: "catalog", verified: resolveVerifiedPackageV1(catalog, packageId, root.version ?? "") }
  }
}
