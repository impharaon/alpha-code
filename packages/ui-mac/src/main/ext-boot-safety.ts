import type { BootReconcileOutcome } from "./ext-install-planner"
import type { RemoteCatalogResult } from "./remote-catalog"
import { sanitizeTransportError } from "./codepuppy-artifact-download"

export async function resolveBootExtensionSafety(
  state: Pick<BootReconcileOutcome, "enforcementGap" | "curationUnknown">,
  deps: {
    refresh: () => Promise<RemoteCatalogResult>
    reconcile: () => BootReconcileOutcome | Promise<BootReconcileOutcome>
    warn: (message: string, detail?: Record<string, unknown>) => void
    wait?: (ms: number) => Promise<void>
  },
) {
  if (state.curationUnknown && state.enforcementGap?.length === 1) {
    const started = Date.now()
    deps.warn("[1632] refreshing catalog before boot safety decision")
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = deps.wait
      ? deps.wait(15_000).then(() => ({ result: "timeout" as const }))
      : new Promise<{ result: "timeout" }>((resolve) => { timer = setTimeout(() => resolve({ result: "timeout" }), 15_000) })
    const result = await Promise.race([
      deps.refresh().then(
        (catalog) => catalog.source === "none"
          ? { result: "failed" as const, error: sanitizeTransportError(catalog.error), reasonClass: catalog.reasonClass }
          : { result: "completed" as const },
        (error: unknown) => ({ result: "failed" as const, error: sanitizeTransportError(error instanceof Error ? error.message : String(error)), reasonClass: "unknown" }),
      ),
      timeout,
    ]).finally(() => clearTimeout(timer))
    // The caller awaits ledger recovery and retirement; reconcile owns the global extension lock.
    if (result.result === "completed") state = await deps.reconcile()
    deps.warn("[1632] catalog boot refresh finished", {
      ...result, elapsedMs: Date.now() - started, blocked: !!state.enforcementGap?.length,
    })
  }
  if (!state.enforcementGap?.length) return null
  const unknown = state.curationUnknown && state.enforcementGap.length === 1
  return {
    gap: state.enforcementGap,
    title: unknown ? "需要联网确认扩展安全" : "扩展安全状态无法确保",
    message: unknown
      ? "Code Puppy 要先取一次扩展目录,才能确认已启用的扩展是安全的。请联网后重新打开。"
      : "扩展配置或历史桥接状态无法确认已经安全收敛(可能因磁盘空间、权限或配置文件损坏)。为避免旧桥或本应关闭的扩展被意外加载,已暂停启动。请检查磁盘与目录权限后重新打开应用;若持续出现,请联系支持并附上日志。",
  }
}
