export type PackageAllowSetV2 = {
  v: 2
  keys: string[]
  scoped: { kind: "skill" | "mcp"; name: string; projectPath: string }[]
}

export function decodePackageAllowSet(input: unknown): PackageAllowSetV2 | undefined {
  if (!object(input) || input.v !== 2 || !Array.isArray(input.keys) || !Array.isArray(input.scoped)) return
  if (!input.keys.every((key: unknown): key is string => typeof key === "string")) return
  if (!input.scoped.every((entry: unknown): entry is PackageAllowSetV2["scoped"][number] =>
    object(entry) && (entry.kind === "skill" || entry.kind === "mcp") &&
    typeof entry.name === "string" && typeof entry.projectPath === "string",
  )) return
  return { v: 2, keys: input.keys, scoped: input.scoped }
}

export function scopedPackageAllowedHere(
  kind: "skill" | "mcp",
  name: string,
  allowSet: PackageAllowSetV2 | undefined,
  projectRoot: string | undefined,
): boolean {
  if (!allowSet || !projectRoot) return false
  // Both paths come from their project identity owners; do not broaden a match by guessing a root.
  return allowSet.scoped.some((entry) => entry.kind === kind && entry.name === name && entry.projectPath === projectRoot)
}

/** Only for skills inside ext-store; factory, native and project skills bypass this predicate. */
export function managedSkillAllowedHere(
  skill: { key: string; name: string },
  allowSet: PackageAllowSetV2 | undefined,
  projectRoot: string | undefined,
): boolean {
  if (!allowSet) return false
  return allowSet.keys.includes(skill.key) || scopedPackageAllowedHere("skill", skill.name, allowSet, projectRoot)
}

function object(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input)
}
