export type DirectoryAccessTarget = { absolute: string; directory: string }
export type DirectoryAccessDescriptionInput = { server: string; sessionID: string; requestID: string; requestFingerprint: string; targets: readonly DirectoryAccessTarget[] }
export type DirectoryAccessDescription = { snapshotID: string; targets: readonly (DirectoryAccessTarget & { realTarget: string; realDirectory: string; dev: string; ino: string })[] }
export type DirectoryWriteApproval = Omit<DirectoryAccessDescriptionInput, "targets"> & { decisionID: string; decision: "once" | "always"; snapshotID: string }
export type DirectoryWriteApprovalResult = { outcome: "granted" | "no-fence" } | { outcome: "conflict" | "expired" } | { outcome: "failed"; reason: "home-or-app-state" | "protected-config" | "grant-failed" }

export function parseDirectoryAccessTargets(value: unknown): DirectoryAccessTarget[] | undefined {
  if (!Array.isArray(value)) return
  const absolute = (path: unknown): path is string => typeof path === "string" && !path.includes("\0") && (path.startsWith("/") || path.startsWith("\\\\") || /^[a-zA-Z]:[\\/]/.test(path))
  if (!value.every((target) => target && typeof target === "object" && Object.keys(target).length === 2 && absolute(target.absolute) && absolute(target.directory))) return
  return value.map((target) => ({ absolute: target.absolute, directory: target.directory }))
}

export function directoryAccessMetadata(value: unknown): { access: "read" | "write"; targets: DirectoryAccessTarget[] } | undefined {
  if (!value || typeof value !== "object" || !("directoryAccess" in value)) return
  const input = value.directoryAccess
  if (!input || typeof input !== "object" || !("access" in input) || (input.access !== "read" && input.access !== "write") || !("targets" in input) || Object.keys(input).length !== 2) return
  const targets = parseDirectoryAccessTargets(input.targets)
  return targets ? { access: input.access, targets } : undefined
}


export function parseDirectoryAccessDescriptionInput(value: unknown): DirectoryAccessDescriptionInput | undefined {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 5) return
  const fields = ["server", "sessionID", "requestID", "requestFingerprint"] as const
  if (!fields.every((field) => field in value && typeof value[field as keyof typeof value] === "string" && value[field as keyof typeof value])) return
  if (!("targets" in value)) return
  const targets = parseDirectoryAccessTargets(value.targets)
  const input = value as Record<string, string>
  return targets ? { server: input.server!, sessionID: input.sessionID!, requestID: input.requestID!, requestFingerprint: input.requestFingerprint!, targets } : undefined
}
export function parseDirectoryWriteApproval(value: unknown): DirectoryWriteApproval | undefined {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 7) return
  const input = value as Record<string, unknown>
  if (!["server", "sessionID", "requestID", "requestFingerprint", "decisionID", "snapshotID"].every((field) => typeof input[field] === "string" && input[field])) return
  if (input.decision !== "once" && input.decision !== "always") return
  return { ...input } as DirectoryWriteApproval
}
